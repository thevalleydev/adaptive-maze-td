/**
 * A* pathfinder operating on a Grid instance.
 * Returns an ordered array of { x, y } tile positions, or null if no path exists.
 */
export class Pathfinder {
  constructor(grid) {
    this.grid = grid;
  }

  /**
   * Find a path from (sx,sy) to (ex,ey).
   * jitter adds per-tile cost noise (0–jitter fraction) so each call returns a
   * slightly different route — enemies spread across the maze rather than
   * marching single-file along one optimal line.
   */
  find(sx, sy, ex, ey, jitter = 0) {
    const g    = this.grid;
    const cols = g.cols;

    // Encode a tile position as a single integer key
    const key  = (x, y) => y * cols + x;
    const heur = (x, y) => Math.abs(x - ex) + Math.abs(y - ey);

    const open   = new Map();  // key → { x, y }
    const closed = new Set();
    const gScore = new Map();
    const fScore = new Map();
    const parent = new Map();  // key → parent key

    const sk = key(sx, sy);
    gScore.set(sk, 0);
    fScore.set(sk, heur(sx, sy));
    open.set(sk, { x: sx, y: sy });

    const DIRS = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
      { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    ];

    while (open.size > 0) {
      // Pick the open node with the lowest f-score
      let curK = null, lowest = Infinity;
      for (const k of open.keys()) {
        const f = fScore.get(k) ?? Infinity;
        if (f < lowest) { lowest = f; curK = k; }
      }
      if (curK === null) break;

      const cur = open.get(curK);
      open.delete(curK);
      closed.add(curK);

      if (cur.x === ex && cur.y === ey) {
        // Reconstruct path by tracing parents back to start
        const path = [];
        let k = curK;
        while (k !== undefined) {
          path.unshift({ x: k % cols, y: Math.floor(k / cols) });
          k = parent.get(k);
        }
        return path;
      }

      for (const { dx, dy } of DIRS) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= g.rows) continue;

        const nk = key(nx, ny);
        if (closed.has(nk)) continue;

        const moveCost = g.cost(nx, ny) * (jitter > 0 ? (1 + Math.random() * jitter) : 1);
        if (moveCost === Infinity) continue;

        const tentG = (gScore.get(curK) ?? 0) + moveCost;
        if (tentG < (gScore.get(nk) ?? Infinity)) {
          parent.set(nk, curK);
          gScore.set(nk, tentG);
          fScore.set(nk, tentG + heur(nx, ny));
          open.set(nk, { x: nx, y: ny });
        }
      }
    }

    return null; // No path found
  }
}
