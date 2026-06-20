/**
 * Tower entity – targets the furthest-along enemy in range and fires.
 * Returns a shot descriptor { from, to } when it fires (for visual flash).
 */
export class Tower {
  constructor(col, row, tileSize, stats = {}) {
    this.col = col;
    this.row = row;
    // World-space centre of this tower's tile
    this.wx = col * tileSize + tileSize * 0.5;
    this.wy = row * tileSize + tileSize * 0.5;

    this.range    = stats.range    ?? 130;  // px
    this.damage   = stats.damage   ?? 22;
    this.fireRate = stats.fireRate ?? 1.2;  // shots per second
    this.cooldown = 0;                      // ms until next shot
  }

  /**
   * @param {number}  dt      – frame delta in ms
   * @param {Enemy[]} enemies – live enemy list
   * @returns {{ from:{x,y}, to:{x,y} } | null}
   */
  update(dt, enemies) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown > 0) return null;

    const target = this._findTarget(enemies);
    if (!target) return null;

    target.takeDamage(this.damage);
    this.cooldown = 1000 / this.fireRate;
    return { from: { x: this.wx, y: this.wy }, to: { x: target.wx, y: target.wy } };
  }

  /** Target the enemy furthest along its path within range. */
  _findTarget(enemies) {
    let best = null, bestProgress = -1;
    for (const e of enemies) {
      if (e.dead || e.reached) continue;
      const d = Math.hypot(e.wx - this.wx, e.wy - this.wy);
      if (d <= this.range && e.pathIndex > bestProgress) {
        bestProgress = e.pathIndex;
        best = e;
      }
    }
    return best;
  }
}
