import { TOWERS, UPGRADE_BRANCHES } from '../config.js';

/** Smoothly interpolate between two angles (handles wrap-around). */
function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * Math.min(1, t);
}

/**
 * Tower entity – targets the furthest-along enemy in range and fires.
 * Supports 5 upgrade levels with a branching specialization at level 3.
 */
export class Tower {
  constructor(col, row, tileSize, type = 'basic') {
    this.col  = col;
    this.row  = row;
    this.type = type;

    this.wx = col * tileSize + tileSize * 0.5;
    this.wy = row * tileSize + tileSize * 0.5;

    const cfg       = TOWERS[type] ?? TOWERS.basic;
    this.baseCost   = cfg.cost;
    this.range      = cfg.range;
    this.damage     = cfg.damage;
    this.fireRate   = cfg.fireRate;
    this.color      = cfg.color;
    this.damageType = cfg.damageType ?? 'physical';
    this.cooldown   = 0;

    // Slow tower — use config values by default, branches can override
    this.slowFactor   = cfg.slowFactor   ?? 1.0;
    this.slowDuration = cfg.slowDuration ?? 0;

    // Upgrade / branch state
    this.level  = 1;
    this.branch = null;   // null | 'A' | 'B'

    // Branch special flags
    this.armorPierce       = 0;     // 0–1: fraction of armor buildup to ignore
    this.executeThreshold  = 0;     // hp fraction below which executeMult applies
    this.executeMult       = 1;
    this.aoeMode           = false; // Blizzard: slow ALL enemies in range each shot

    // Vent branch extras
    this.ventDrain         = cfg.ventDrain    ?? 0;
    this.ventInterval      = cfg.ventInterval ?? 0;

    // Animation state
    this.aimAngle    = -Math.PI / 2;
    this.muzzleFlash = 0;
  }

  /** True when the tower needs a branch chosen before continuing upgrades. */
  needsBranch() {
    return this.level === 3 && this.branch === null && UPGRADE_BRANCHES[this.type] != null;
  }

  /**
   * Cost to reach the next level.
   * Returns null when already max (level 5) or branch is needed first.
   */
  upgradeCost() {
    if (this.needsBranch()) return null;   // must choose branch; handled separately
    if (this.level >= 5) return null;
    // Costs per transition: 1→2: ×1.2,  2→3: ×2.5,  3→4: ×2.0,  4→5: ×3.5
    const mults = [null, 1.2, 2.5, 2.0, 3.5];
    return Math.floor(this.baseCost * mults[this.level]);
  }

  /** Cost to choose a branch (called once at level 3). */
  branchCost() { return Math.floor(this.baseCost * 2.0); }

  /**
   * Apply a branch specialization.  The branch changes stats immediately and
   * sets flags for special behaviour in update().
   */
  chooseBranch(branch) {
    const cfg = UPGRADE_BRANCHES[this.type]?.[branch];
    if (!cfg || this.branch) return false;
    this.branch = branch;

    if (cfg.dmgMult)      this.damage    = Math.round(this.damage   * cfg.dmgMult);
    if (cfg.rateMult)     this.fireRate  = Math.round(this.fireRate  * cfg.rateMult * 100) / 100;
    if (cfg.rangeMult)    this.range    *= cfg.rangeMult;
    if (cfg.slowFactor)   this.slowFactor   = cfg.slowFactor;
    if (cfg.slowDuration) this.slowDuration = cfg.slowDuration;
    if (cfg.armorPierce)       this.armorPierce      = cfg.armorPierce;
    if (cfg.executeThreshold)  this.executeThreshold = cfg.executeThreshold;
    if (cfg.executeMult)       this.executeMult      = cfg.executeMult;
    if (cfg.aoeMode)           this.aoeMode          = true;
    if (cfg.ventDamage)        this.ventDamage       = cfg.ventDamage;
    if (cfg.drainMult)         this.ventDrain        = Math.round(this.ventDrain * cfg.drainMult);
    if (cfg.intervalMult)      this.ventInterval     = Math.round(this.ventInterval * cfg.intervalMult);
    return true;
  }

  /** Boost stats and increment level (levels 1→5). */
  upgrade() {
    if (this.needsBranch() || this.level >= 5) return false;
    this.level++;
    // Levels 1-3: bigger gains.  Levels 4-5 (post-branch): smaller top-ups.
    const big = this.level <= 3;
    this.damage   = Math.round(this.damage   * (big ? 1.30 : 1.20));
    this.range   *= (big ? 1.10 : 1.07);
    this.fireRate = Math.round(this.fireRate * (big ? 1.15 : 1.10) * 100) / 100;
    return true;
  }

  /**
   * @param {number}  dt      – frame delta in ms
   * @param {Enemy[]} enemies – live enemy list
   * @returns shot object, array of shots (aoe), or null
   */
  update(dt, enemies) {
    // Vent towers don't target or shoot — pressure drain is handled in GameScene
    if (this.type === 'vent') {
      this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
      return null;
    }

    // Blizzard AoE: slow all enemies in range simultaneously
    if (this.aoeMode) return this._updateAoe(dt, enemies);

    // Standard single-target behaviour
    const target = this._findTarget(enemies);
    if (target) {
      const targetAngle = Math.atan2(target.wy - this.wy, target.wx - this.wx);
      this.aimAngle = lerpAngle(this.aimAngle, targetAngle, dt * 0.009);
    }

    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
    this.cooldown    = Math.max(0, this.cooldown - dt);
    if (this.cooldown > 0 || !target) return null;

    target.lastHitBy = this.type;

    // Evasion dodge (sniper only)
    if (this.type === 'sniper' && target.evasionChance > 0 && Math.random() < target.evasionChance) {
      this.muzzleFlash = 110;
      this.cooldown    = 1000 / this.fireRate;
      return { from: { x: this.wx, y: this.wy }, to: { x: target.wx, y: target.wy }, color: 0x334433, miss: true };
    }

    // Effective damage: execute bonus or armor pierce
    let dmg = this.damage;
    if (this.executeThreshold > 0 && (target.hp / target.maxHp) < this.executeThreshold) {
      dmg = Math.round(dmg * this.executeMult);
    }

    target.takeDamage(dmg, this.damageType, this.armorPierce);

    if (this.type === 'slow') {
      target.applySlow(this.slowFactor, this.slowDuration);
    }

    this.muzzleFlash = 110;
    this.cooldown    = 1000 / this.fireRate;
    return { from: { x: this.wx, y: this.wy }, to: { x: target.wx, y: target.wy }, color: this.color };
  }

  /** Blizzard mode: fire at all enemies in range each tick. */
  _updateAoe(dt, enemies) {
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
    this.cooldown    = Math.max(0, this.cooldown - dt);
    if (this.cooldown > 0) return null;

    const inRange = enemies.filter(e => !e.dead && !e.reached &&
      Math.hypot(e.wx - this.wx, e.wy - this.wy) <= this.range);
    if (inRange.length === 0) return null;

    const shots = [];
    for (const e of inRange) {
      e.lastHitBy = this.type;
      e.takeDamage(this.damage, this.damageType);
      e.applySlow(this.slowFactor, this.slowDuration);
      shots.push({ from: { x: this.wx, y: this.wy }, to: { x: e.wx, y: e.wy }, color: 0x88ccff });
    }

    // Aim at the closest in-range target for visual
    const nearest = inRange.reduce((a, b) =>
      Math.hypot(a.wx - this.wx, a.wy - this.wy) < Math.hypot(b.wx - this.wx, b.wy - this.wy) ? a : b);
    this.aimAngle = Math.atan2(nearest.wy - this.wy, nearest.wx - this.wx);
    this.muzzleFlash = 110;
    this.cooldown    = 1000 / this.fireRate;
    return shots;
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
