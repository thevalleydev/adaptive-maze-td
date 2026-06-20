/**
 * Enemy entity – moves along a tile path, adds pressure, can be damaged.
 */
export class Enemy {
  constructor(id, path, tileSize, stats = {}) {
    this.id       = id;
    this.tileSize = tileSize;

    this.path      = [...path];
    this.pathIndex = 0;  // index of the tile we're currently heading *toward*

    // World-space position starts at the centre of the spawn tile
    const t0 = path[0];
    this.wx = t0.x * tileSize + tileSize * 0.5;
    this.wy = t0.y * tileSize + tileSize * 0.5;

    this.speed           = stats.speed           ?? 80;   // px/s
    this.maxHp           = stats.hp              ?? 80;
    this.hp              = this.maxHp;
    this.pressurePerStep = stats.pressurePerStep ?? 2.0;
    this.reward          = stats.reward          ?? 10;

    this.dead    = false;
    this.reached = false;  // reached the exit tile
  }

  /**
   * Advance the enemy along its path.
   * @param {number}   dt        – frame delta in ms
   * @param {Grid}     grid      – for adding pressure
   * @param {Function} onChanged – called when a tile type changes (triggers repath)
   */
  update(dt, grid, onChanged) {
    if (this.dead || this.reached) return;

    const nextNode = this.path[this.pathIndex + 1];
    if (!nextNode) { this.reached = true; return; }

    const tx = nextNode.x * this.tileSize + this.tileSize * 0.5;
    const ty = nextNode.y * this.tileSize + this.tileSize * 0.5;

    const dx   = tx - this.wx;
    const dy   = ty - this.wy;
    const dist = Math.hypot(dx, dy);
    const step = this.speed * dt * 0.001;

    if (dist <= step) {
      // Snap to tile centre and advance
      this.wx = tx;
      this.wy = ty;
      this.pathIndex++;

      const changed = grid.addPressure(nextNode.x, nextNode.y, this.pressurePerStep);
      if (changed) onChanged?.(nextNode.x, nextNode.y);

      if (this.pathIndex >= this.path.length - 1) this.reached = true;
    } else {
      this.wx += (dx / dist) * step;
      this.wy += (dy / dist) * step;
    }
  }

  takeDamage(amount) {
    this.hp -= amount;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
  }

  /**
   * Update this enemy's path after the grid changes.
   * Finds where the enemy currently is in the new path.
   */
  repath(newPath) {
    if (!newPath?.length) return;

    const tx = Math.floor(this.wx / this.tileSize);
    const ty = Math.floor(this.wy / this.tileSize);

    // Try to find current tile in the new path
    let idx = newPath.findIndex(n => n.x === tx && n.y === ty);

    if (idx < 0) {
      // Fallback: nearest tile in the new path by distance
      let minDist = Infinity;
      for (let i = 0; i < newPath.length; i++) {
        const d = Math.hypot(newPath[i].x - tx, newPath[i].y - ty);
        if (d < minDist) { minDist = d; idx = i; }
      }
    }

    this.path      = [...newPath];
    this.pathIndex = Math.max(0, Math.min(idx, newPath.length - 2));
  }
}
