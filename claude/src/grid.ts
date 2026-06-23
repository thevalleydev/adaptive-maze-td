import { config } from './config';

export const TILE = 40; // px per tile
export const COLS = 22;
export const ROWS = 15;

export type TileState = 'normal' | 'cracked' | 'collapsing' | 'collapsed';

export interface Tile {
  x: number;
  y: number;
  blocked: boolean; // true = tower occupies it; never traversable (cleared on sell)
  rock: boolean; // natural obstacle from map generation; permanent, can't build on
  state: TileState;
  pressure: number;
  collapseTimer: number; // counts down while state === 'collapsing'
  rubbleAge: number; // seconds spent collapsed; heals back to normal at rubbleHealTime
}

// A tile is impassable if a tower blocks it or it's natural rock.
export function isWall(t: Tile): boolean {
  return t.blocked || t.rock;
}

export class Grid {
  cols = COLS;
  rows = ROWS;
  tiles: Tile[] = [];
  spawn = { x: 0, y: Math.floor(ROWS / 2) };
  exit = { x: COLS - 1, y: Math.floor(ROWS / 2) };

  // Bumped whenever traversability OR cost changes, so enemies know to re-path.
  graphVersion = 0;

  // Tiles that collapsed this frame — the game uses these to wreck adjacent towers.
  justCollapsed: Tile[] = [];

  constructor() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        this.tiles.push({ x, y, blocked: false, rock: false, state: 'normal', pressure: 0, collapseTimer: 0, rubbleAge: 0 });
      }
    }
  }

  idx(x: number, y: number) {
    return y * this.cols + x;
  }

  at(x: number, y: number): Tile | null {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    return this.tiles[this.idx(x, y)];
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  isSpawnOrExit(x: number, y: number) {
    return (x === this.spawn.x && y === this.spawn.y) || (x === this.exit.x && y === this.exit.y);
  }

  // Movement cost of entering a tile. Collapsed tiles are deliberately NOT
  // impassable — they're expensive rubble. This guarantees a path always
  // exists (no softlock) while still pushing the flow to reroute around them.
  // Terrain-only entry cost. The pressure term (avoid vs. seek) is applied in
  // findPath via its pressureBias so it can differ per creep.
  enterCost(t: Tile): number {
    let c = 1;
    if (t.state === 'cracked') c += config.crackedCost;
    if (t.state === 'collapsing') c += config.crackedCost;
    if (t.state === 'collapsed') c += config.collapsedCost;
    return c;
  }

  speedMult(t: Tile): number {
    if (t.state === 'collapsed') return config.collapsedSpeedMult;
    if (t.state === 'cracked' || t.state === 'collapsing') return config.crackedSpeedMult;
    return 1;
  }

  // Advance pressure, cracking and collapse for every tile. Called each frame.
  // NOTE: we only bump graphVersion on *collapse* (a real cost/traversability
  // jump). Crack/heal oscillation near a threshold would otherwise force every
  // enemy to re-path every frame. Enemies still drift around pressure via their
  // own low-frequency periodic repath (see Enemy.update).
  update(dt: number) {
    let changed = false; // a collapse OR a heal — both change traversability/cost
    this.justCollapsed.length = 0;
    for (const t of this.tiles) {
      // Low continuous decay. The bulk of dissipation happens between waves
      // (see World), so within a wave pressure accumulates toward collapse.
      if (t.pressure > 0 && t.state !== 'collapsed') {
        t.pressure = Math.max(0, t.pressure - config.decayRate * dt);
      }

      switch (t.state) {
        case 'normal':
          if (t.pressure >= config.crackThreshold) t.state = 'cracked';
          break;
        case 'cracked':
          if (t.pressure >= config.collapseThreshold) {
            t.state = 'collapsing';
            t.collapseTimer = config.telegraphDuration;
          } else if (t.pressure < config.crackThreshold - config.crackHealMargin) {
            t.state = 'normal'; // hysteresis: heal only after a real drop, not a dip
          }
          break;
        case 'collapsing':
          // Recoverable: if pressure drops below the line during the telegraph,
          // the collapse is averted. This is what makes venting/relocating matter.
          if (t.pressure < config.collapseThreshold) {
            t.state = 'cracked';
            t.collapseTimer = 0;
          } else {
            t.collapseTimer -= dt;
            if (t.collapseTimer <= 0) {
              t.state = 'collapsed';
              t.rubbleAge = 0;
              changed = true;
              this.justCollapsed.push(t);
            }
          }
          break;
        case 'collapsed':
          // Rubble fills back in so the map keeps churning (0 = permanent).
          if (config.rubbleHealTime > 0) {
            t.rubbleAge += dt;
            if (t.rubbleAge >= config.rubbleHealTime) {
              t.state = 'normal';
              t.pressure = 0;
              changed = true;
            }
          }
          break;
      }
    }
    if (changed) this.graphVersion++;
  }

  // Applied once when a wave clears: the bulk of pressure dissipation. Keeps
  // cracks alive through a wave while letting the map cool during the breather.
  dissipate(fraction: number) {
    for (const t of this.tiles) {
      if (t.state !== 'collapsed') t.pressure *= 1 - fraction;
    }
  }

  addPressure(x: number, y: number, amount: number) {
    const t = this.at(x, y);
    if (t && t.state !== 'collapsed') t.pressure += amount;
  }

  setBlocked(x: number, y: number, blocked: boolean) {
    const t = this.at(x, y);
    if (!t) return;
    t.blocked = blocked;
    this.graphVersion++;
  }
}
