import { World } from '../world';
import { TowerKind, TOWER_DEFS } from '../config';
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

// A wall segment from yFrom to yTo (inclusive), emitted in that order so the
// incremental builder can anchor to a map edge first and stay functional.
function seg(x: number, yFrom: number, yTo: number, kind: TowerKind): PlacedTower[] {
  const out: PlacedTower[] = [];
  const step = yFrom <= yTo ? 1 : -1;
  for (let y = yFrom; y !== yTo + step; y += step) {
    if (y >= 0 && y < ROWS) out.push({ x, y, kind });
  }
  return out;
}

// Fixed layouts to evaluate. Walls are EDGE-ANCHORED so a partial build still
// forces a real detour (a mid-map wall does nothing until fully spanning).
export const LAYOUTS: Record<string, PlacedTower[]> = {
  // Edge-anchored serpentine: lane coverage FIRST, then extend each wall to its
  // edge so a partial build still funnels.
  serpentine: [
    { x: 4, y: 9, kind: 'cannon' }, { x: 7, y: 9, kind: 'gun' }, { x: 7, y: 8, kind: 'gun' }, { x: 7, y: 10, kind: 'gun' },
    ...seg(7, 7, 0, 'gun'), { x: 7, y: 11, kind: 'gun' }, // top wall to edge
    { x: 10, y: 13, kind: 'frost' }, { x: 13, y: 9, kind: 'gun' },
    ...seg(13, 17, 6, 'gun'), // bottom wall to edge
    { x: 16, y: 5, kind: 'cannon' }, { x: 19, y: 9, kind: 'gun' },
    ...seg(19, 11, 0, 'gun'), { x: 22, y: 9, kind: 'gun' }, // top wall to edge
  ],
  // One tight chokepoint: a full wall at x=13 with a single gap, built outward
  // from the lane, with a dedicated killbox around the gap.
  choke: [
    { x: 12, y: 8, kind: 'gun' }, { x: 12, y: 10, kind: 'gun' },
    { x: 14, y: 8, kind: 'gun' }, { x: 14, y: 10, kind: 'gun' },
    { x: 11, y: 9, kind: 'frost' }, { x: 15, y: 9, kind: 'cannon' },
    ...seg(13, 8, 0, 'gun'), ...seg(13, 10, 17, 'gun'),
  ],
  // The user's strategy: box the spawn at the buffer edge with two close walls.
  spawnBox: [
    { x: 4, y: 8, kind: 'gun' }, { x: 4, y: 10, kind: 'gun' },
    { x: 6, y: 8, kind: 'gun' }, { x: 6, y: 10, kind: 'gun' },
    { x: 5, y: 9, kind: 'cannon' },
    ...seg(3, 7, 0, 'gun'), ...seg(3, 11, 17, 'gun'),
    ...seg(5, 11, 17, 'gun'), ...seg(5, 7, 0, 'gun'),
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

// Fully seals the path with a cheap wall (no gap) and puts guns just behind it
// to slaughter climbers — to verify the creep evolution: they should learn to
// climb (forced), then escalate to bombing (frustrated). Builds incrementally.
export class SealPolicy implements Policy {
  name = 'seal';
  sells = 0;
  onStart(world: World) {
    this.build(world);
  }
  onTick(world: World) {
    this.build(world);
  }
  private build(world: World) {
    for (let y = 0; y < ROWS; y++) world.tryPlaceTower(13, y, 'wall'); // full seal FIRST, no gap
    // Guns near the spawn/exit row first (that's where climbers cross) so the
    // affordable ones actually kill — building frustration toward bombing.
    const cy = world.grid.exit.y;
    const order = [0, -1, 1, -2, 2, -3, 3, -4, 4].map((d) => cy + d);
    for (const y of order) world.tryPlaceTower(12, y, 'gun');
    for (const y of order) world.tryPlaceTower(11, y, 'gun');
  }
}

// Spams a SINGLE tower kind on cool ground along the open lane and never
// diversifies — the pure mono-tower build. Used to verify the armor evolution:
// the swarm should harden against that tower's damage type. (Defaults to gun =
// kinetic; pass a kind to confirm other types trigger their own armor.)
export class MonoPolicy implements Policy {
  name: string;
  sells = 0;
  private kind: TowerKind;
  private timer = 0;

  constructor(kind: TowerKind = 'gun') {
    this.kind = kind;
    this.name = `mono:${kind}`;
  }

  onStart() {}

  onTick(world: World, dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    let guard = 30;
    while (world.money > TOWER_DEFS[this.kind].cost && guard-- > 0) {
      const spot = bestLanePlacement(world);
      if (!spot || !world.tryPlaceTower(spot.x, spot.y, this.kind)) break;
    }
  }
}

// Coolest buildable tile that can still SEE the lane from a set-back perch — for
// the long-range sniper. Scans every buildable tile, keeps those within sniper
// range of some path tile, and prefers cool ground a little back from the lane
// (out of the collapse blast). Returns null if nothing in range is buildable.
function bestSniperPerch(world: World): { x: number; y: number } | null {
  const path = world.previewPath;
  if (!path) return null;
  const range = TOWER_DEFS.sniper.range;
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  for (let y = 0; y < world.grid.rows; y++) {
    for (let x = 0; x < world.grid.cols; x++) {
      if (!world.canBuildOn(x, y)) continue;
      let minDist = Infinity;
      for (const p of path) minDist = Math.min(minDist, Math.hypot(p.x - x, p.y - y));
      if (minDist > range) continue; // can't reach the lane from here
      // Cool ground first; among cool tiles, prefer the ones set back from the lane.
      const score = (100 - world.maxNeighborPressure(x, y)) + 2 * minDist;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

// Skilled reactive play (relocate before collapse, cover the lane), but allowed
// to keep up to `sniperCap` snipers on set-back cool ground. Probe question: does
// the long-range sniper meaningfully shift the brute/leak math vs. gun-only?
export class SniperBackedPolicy implements Policy {
  name = 'sniper-backed';
  sells = 0;
  private timer = 0;
  private sniperCap = 2;

  onStart() {}

  onTick(world: World, dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;

    // 1. Relocate towers next to an imminent collapse (same as reactive).
    for (const t of [...world.towers]) {
      if (world.neighborCollapsing(t.x, t.y) && world.trySellTower(t.x, t.y)) this.sells++;
    }

    // 2. Maintain the sniper perches — buy one when affordable and under the cap.
    const snipers = world.towers.filter((t) => t.kind === 'sniper').length;
    if (snipers < this.sniperCap && world.money >= world.towerCost('sniper')) {
      const perch = bestSniperPerch(world);
      if (perch) world.tryPlaceTower(perch.x, perch.y, 'sniper');
    }

    // 3. Spend the rest covering the lane with guns on cool ground.
    let guard = 30;
    while (world.money > 60 && guard-- > 0) {
      const spot = bestLanePlacement(world);
      if (!spot || !world.tryPlaceTower(spot.x, spot.y, 'gun')) break;
    }
  }
}

// Reactive play that deliberately ROTATES damage types (gun→cannon→frost) so no
// single type dominates. Probe question: does a well-rounded defense dodge the
// armor evolution entirely? (Expect the armor column to stay 'n'.)
export class DiversifiedPolicy implements Policy {
  name = 'diversified';
  sells = 0;
  private timer = 0;
  private next = 0;
  private rotation: TowerKind[] = ['gun', 'cannon', 'frost'];

  onStart() {}

  onTick(world: World, dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;

    for (const t of [...world.towers]) {
      if (world.neighborCollapsing(t.x, t.y) && world.trySellTower(t.x, t.y)) this.sells++;
    }

    let guard = 30;
    while (guard-- > 0) {
      const kind = this.rotation[this.next % this.rotation.length];
      if (world.money < world.towerCost(kind)) break;
      const spot = bestLanePlacement(world);
      if (!spot || !world.tryPlaceTower(spot.x, spot.y, kind)) break;
      this.next++;
    }
  }
}

// Pick the coolest buildable tile adjacent to the current preview path — shared
// by the mono and reactive policies.
function bestLanePlacement(world: World): { x: number; y: number } | null {
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
      const score = 100 - world.maxNeighborPressure(x, y);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
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
