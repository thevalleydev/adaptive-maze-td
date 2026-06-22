import { TOWERS } from '../config.js';

/** Smoothly interpolate between two angles (handles wrap-around). */
function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * Math.min(1, t);
}

/**
 * Tower entity – targets the furthest-along enemy in range and fires.
 * Supports types (basic, sniper, slow), upgrade levels 1–3, barrel aim
 * animation, and muzzle flash.
 */
export class Tower {
  constructor(col, row, tileSize, type = 'basic') {
    this.col  = col;
    this.row  = row;
    this.type = type;

    this.wx = col * tileSize + tileSize * 0.5;
    this.wy = row * tileSize + tileSize * 0.5;

    const cfg     = TOWERS[type] ?? TOWERS.basic;
    this.baseCost   = cfg.cost;
    this.range      = cfg.range;
    this.damage     = cfg.damage;
    this.fireRate   = cfg.fireRate;
    this.color      = cfg.color;
    this.damageType = cfg.damageType ?? 'physical';
    this.cooldown   = 0;

    // Upgrade state
    this.level = 1;

    // Animation state
    this.aimAngle    = -Math.PI / 2; // radians; -PI/2 = pointing up
    this.muzzleFlash = 0;            // ms remaining for muzzle flash
  }

  /** Cost to reach the next level, or null if already max. */
  upgradeCost() {
    if (this.level >= 3) return null;
    // Lv1→2: 1.2× base,  Lv2→3: 2.5× base  (was 0.75× and 1.0×)
    return Math.floor(this.baseCost * (this.level === 1 ? 1.2 : 2.5));
  }

  /** Boost stats and increment level. Returns false if already max. */
  upgrade() {
    if (this.level >= 3) return false;
    this.level++;
    // Smaller per-level gains than before (×1.25 dmg, ×1.10 range, ×1.15 rate)
    this.damage   = Math.round(this.damage   * 1.25);
    this.range   *= 1.10;
    this.fireRate = Math.round(this.fireRate * 1.15 * 100) / 100;
    return true;
  }

  /**
   * @param {number}  dt      – frame delta in ms
   * @param {Enemy[]} enemies – live enemy list
   * @returns {{ from:{x,y}, to:{x,y}, color:number } | null} shot or null
   */
  update(dt, enemies) {
    // Always track the best target for aiming (even while on cooldown)
    const target = this._findTarget(enemies);

    if (target) {
      const targetAngle = Math.atan2(target.wy - this.wy, target.wx - this.wx);
      this.aimAngle = lerpAngle(this.aimAngle, targetAngle, dt * 0.009);
    }

    // Decay muzzle flash
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);

    // Fire when cooldown expires
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown > 0 || !target) return null;

    // Tag the enemy for kill attribution
    target.lastHitBy = this.type;

    // Evasion: evasive enemies have a chance to dodge sniper shots
    if (this.type === 'sniper' && target.evasionChance > 0 && Math.random() < target.evasionChance) {
      this.muzzleFlash = 110;
      this.cooldown    = 1000 / this.fireRate;
      return { from: { x: this.wx, y: this.wy }, to: { x: target.wx, y: target.wy }, color: 0x334433, miss: true };
    }

    target.takeDamage(this.damage, this.damageType);

    if (this.type === 'slow') {
      const cfg = TOWERS.slow;
      target.applySlow(cfg.slowFactor, cfg.slowDuration);
    }

    this.muzzleFlash = 110;
    this.cooldown    = 1000 / this.fireRate;
    return { from: { x: this.wx, y: this.wy }, to: { x: target.wx, y: target.wy }, color: this.color };
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
