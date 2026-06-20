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

// Base movement cost per type. Infinity = impassable.
const BASE_COST = [1, 1, 1, Infinity, 2.5, Infinity];

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

  /** A* movement cost for tile (x,y). High pressure increases cost. */
  cost(x, y) {
    const c = this.get(x, y);
    if (!c) return Infinity;
    const base = BASE_COST[c.type];
    if (base === undefined || base === Infinity) return Infinity;
    return base + c.pressure * 0.04;
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
        // Restore cracked tiles when pressure drops far enough
        if (c.type === TileType.CRACKED && c.pressure < PRESSURE.CRACK_AT * 0.45) {
          c.type = TileType.NORMAL;
        }
        // Collapsed tiles remain collapsed (permanent structural damage)
      }
    }
  }
}
