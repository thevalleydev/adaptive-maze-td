import { COLS, ROWS, SPAWN, EXIT, PRESSURE } from '../config.js';

// ── Tile types ───────────────────────────────────────────────────────────────
export const TileType = {
  NORMAL:    0,
  SPAWN:     1,
  EXIT:      2,
  TOWER:     3,
  CRACKED:   4,
  COLLAPSED: 5,
};

// Base movement cost per type.
// CRACKED is modestly cheaper than NORMAL — enemies have a slight preference for
// worn ground, but it's not so extreme that all traffic piles onto one tile.
// COLLAPSED is the cheapest (breach) — enemies rush through open holes.
const BASE_COST = [1.0, 1.0, 1.0, Infinity, 0.85, 0.25];

export class Grid {
  constructor() {
    this.cols = COLS;
    this.rows = ROWS;

    // 2-D array of cell objects: { type, pressure }
    this.cells = Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: COLS }, (__, x) => ({ type: TileType.NORMAL, pressure: 0 }))
    );

    this.cells[SPAWN.row][SPAWN.col].type = TileType.SPAWN;
    this.cells[EXIT.row][EXIT.col].type   = TileType.EXIT;
  }

  get(x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return null;
    return this.cells[y][x];
  }

  /** A* movement cost for tile (x,y).
   *  Collapsed tiles are fixed-cost breaches (enemies always rush them).
   *  Cracked tiles get a gentle pressure bonus — slightly preferred over normal,
   *  but not so dramatically cheaper that all traffic concentrates on one tile. */
  cost(x, y) {
    const c = this.get(x, y);
    if (!c) return Infinity;
    const base = BASE_COST[c.type];
    if (base === undefined || base === Infinity) return Infinity;
    if (c.type === TileType.COLLAPSED) return base; // fixed cost — no pressure modifier
    return Math.max(0.6, base - c.pressure * 0.005);
  }

  isWalkable(x, y) {
    return this.cost(x, y) < Infinity;
  }

  /**
   * Place a tower at (x,y).
   * Returns false if the tile already has something that blocks placement.
   */
  placeTower(x, y) {
    const c = this.get(x, y);
    if (!c) return false;
    if (c.type !== TileType.NORMAL && c.type !== TileType.CRACKED) return false;
    c.type = TileType.TOWER;
    return true;
  }

  /**
   * Add pressure to tile (x,y).
   * Returns true if the tile's *type* changed (triggers a repath).
   */
  addPressure(x, y, amount) {
    const c = this.get(x, y);
    if (!c) return false;
    // Immovable / protected tiles
    if (c.type === TileType.TOWER    ||
        c.type === TileType.COLLAPSED ||
        c.type === TileType.SPAWN    ||
        c.type === TileType.EXIT) return false;

    c.pressure = Math.min(c.pressure + amount, 100);

    if (c.pressure >= PRESSURE.COLLAPSE_AT && c.type !== TileType.COLLAPSED) {
      c.type = TileType.COLLAPSED;
      return true;
    }
    if (c.pressure >= PRESSURE.CRACK_AT && c.type === TileType.NORMAL) {
      c.type = TileType.CRACKED;
      return true;
    }
    return false;
  }

  /** Called at wave end – reduces all tile pressure and heals lightly cracked tiles. */
  dissipate() {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const c = this.cells[y][x];
        c.pressure = Math.max(0, c.pressure * (1 - PRESSURE.DISSIPATE));
        // Restore cracked tiles when pressure drops far enough.
        // 0.60 threshold (vs previous 0.45) means tiles recover after ~2 waves
        // of reduced traffic rather than requiring 3+ idle waves.
        if (c.type === TileType.CRACKED && c.pressure < PRESSURE.CRACK_AT * 0.60) {
          c.type = TileType.NORMAL;
        }
        // Collapsed tiles remain collapsed (permanent structural damage)
      }
    }
  }

  /**
   * In-wave pressure bleed: slowly drain pressure from all passable tiles.
   * Tiles that enemies stop using recover; only sustained heavy traffic collapses.
   * Does NOT change tile type — un-cracking only happens via dissipate() at wave end.
   */
  bleedPressure(rate) {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const c = this.cells[y][x];
        if (c.type === TileType.TOWER  ||
            c.type === TileType.SPAWN  ||
            c.type === TileType.EXIT) continue;
        c.pressure = Math.max(0, c.pressure - rate);
      }
    }
  }
}
