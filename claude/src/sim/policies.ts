import { World } from '../world';
import { TowerKind } from '../config';
import { ROWS } from '../grid';

// A policy decides how the "player" acts. onStart runs once before wave 1;
// onTick runs every simulated frame. `sells` counts reactive relocations — our
// proxy for "did this player have to intervene", which is the whole question.
export interface Policy {
  name: string;
  sells: number;
  onStart(world: World): void;
  onTick(world: World, dt: number): void;
}

export interface PlacedTower {
  x: number;
  y: number;
  kind: TowerKind;
}

// A vertical wall of towers at column x, leaving the given gap rows open.
function wall(x: number, gapRows: number[], kind: TowerKind): PlacedTower[] {
  const out: PlacedTower[] = [];
  for (let y = 0; y < ROWS; y++) if (!gapRows.includes(y)) out.push({ x, y, kind });
  return out;
}

// Fixed layouts to evaluate. Each lists its killer guns FIRST so the incremental
// builder spends early money on damage, then fills the maze walls.
export const LAYOUTS: Record<string, PlacedTower[]> = {
  // One tight chokepoint mid-map.
  choke: [
    { x: 12, y: 8, kind: 'gun' }, { x: 12, y: 10, kind: 'gun' },
    { x: 14, y: 8, kind: 'gun' }, { x: 14, y: 10, kind: 'gun' },
    { x: 11, y: 9, kind: 'frost' }, { x: 15, y: 9, kind: 'cannon' },
    ...wall(13, [9], 'gun'),
  ],
  // Two offset walls -> a serpentine lane (more exposure time).
  doubleWall: [
    { x: 8, y: 4, kind: 'gun' }, { x: 8, y: 6, kind: 'gun' },
    { x: 17, y: 12, kind: 'gun' }, { x: 17, y: 14, kind: 'gun' },
    { x: 12, y: 9, kind: 'cannon' }, { x: 12, y: 8, kind: 'frost' },
    ...wall(9, [5], 'gun'),
    ...wall(16, [13], 'gun'),
  ],
  // The user's strategy: box the spawn at the buffer edge with two close walls.
  spawnBox: [
    { x: 4, y: 8, kind: 'gun' }, { x: 4, y: 10, kind: 'gun' },
    { x: 6, y: 8, kind: 'gun' }, { x: 6, y: 10, kind: 'gun' },
    { x: 5, y: 9, kind: 'cannon' },
    ...wall(3, [7], 'gun'),
    ...wall(5, [11], 'gun'),
  ],
};

// Builds a fixed layout incrementally as money allows, then never touches it
// again. This is the "relaxed / autopilot" baseline — the wave it dies on is the
// headline answer to "how long before you must get quick and intelligent".
export class StaticPolicy implements Policy {
  name: string;
  sells = 0;
  private plan: PlacedTower[];
  private idx = 0;

  constructor(layoutName: keyof typeof LAYOUTS) {
    this.name = `static:${layoutName}`;
    this.plan = LAYOUTS[layoutName];
  }

  onStart(world: World) {
    this.build(world);
  }
  onTick(world: World) {
    this.build(world);
  }

  private build(world: World) {
    while (this.idx < this.plan.length) {
      const p = this.plan[this.idx];
      if (!world.canBuildOn(p.x, p.y)) {
        this.idx++;
        continue;
      }
      if (world.money < world.towerCost(p.kind)) break; // wait for income
      world.tryPlaceTower(p.x, p.y, p.kind);
      this.idx++;
    }
  }
}

// Actively adapts: relocate any tower about to be wrecked, and keep the current
// lane covered with guns on the coolest available ground. The "skilled" upper
// bound — the gap vs. StaticPolicy is the skill headroom.
export class ReactivePolicy implements Policy {
  name = 'reactive';
  sells = 0;
  private timer = 0;

  onStart() {}

  onTick(world: World, dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;

    // 1. Relocate towers next to an imminent collapse (salvage > getting wrecked).
    for (const t of [...world.towers]) {
      if (world.neighborCollapsing(t.x, t.y) && world.trySellTower(t.x, t.y)) this.sells++;
    }

    // 2. Spend spare money covering the path on the coolest tiles.
    let guard = 30;
    while (world.money > 60 && guard-- > 0) {
      const spot = this.bestSpot(world);
      if (!spot || !world.tryPlaceTower(spot.x, spot.y, 'gun')) break;
    }
  }

  private bestSpot(world: World): { x: number; y: number } | null {
    const path = world.previewPath;
    if (!path) return null;
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (const p of path) {
      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (!world.canBuildOn(x, y)) continue;
        const score = 100 - world.maxNeighborPressure(x, y); // prefer cool ground
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best;
  }
}
