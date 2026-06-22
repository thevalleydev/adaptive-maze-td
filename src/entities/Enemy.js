import { MASTER } from '../config.js';

/**
 * Enemy entity – moves along a tile path, adds pressure, can be damaged.
 *
 * Traits (armor, heat, evasion) are NOT pre-assigned — they grow organically
 * from combat experience.  Each hit from a tower type builds the corresponding
 * resistance, at a rate scaled by `adaptRate` (set by the Creep Master).
 */
export class Enemy {
  constructor(id, path, tileSize, stats = {}) {
    this.id       = id;
    this.tileSize = tileSize;

    this.path      = [...path];
    this.pathIndex = 0;

    const t0 = path[0];
    this.wx = t0.x * tileSize + tileSize * 0.5;
    this.wy = t0.y * tileSize + tileSize * 0.5;

    this.speed           = stats.speed           ?? 80;
    this.maxHp           = stats.hp              ?? 80;
    this.hp              = this.maxHp;
    this.pressurePerStep = stats.pressurePerStep ?? 2.0;
    this.reward          = stats.reward          ?? 10;

    this.dead    = false;
    this.reached = false;

    // Slow debuff state
    this.slowTimer  = 0;
    this.slowFactor = 1.0;

    // ── Creep Master / organic evolution ─────────────────────────────────────
    this.creepType  = stats.creepType  ?? 'normal';
    this.lastHitBy  = null;    // tower type of most recent hit (for kill tracking)
    this.mode       = 'normal'; // 'normal' | 'bomber'
    this.bomberTarget = null;

    // Adaptation rate — higher = faster organic learning this wave
    // Driven by Creep Master pressure (ancestral memory)
    this.adaptRate = stats.adaptRate ?? 1.0;

    // Generational head-start: small inherited resistance from ancestors
    // (a fraction of max cap, set at spawn based on Creep Master pressure)
    this.armorBuildup   = stats.armorBuildup   ?? 0;
    this.heatBuildup    = stats.heatBuildup    ?? 0;
    this.evasionBuildup = stats.evasionBuildup ?? 0;

    // Live trait values — derived from buildup, updated on every relevant event
    this.armorFactor   = this.armorBuildup;
    this.heatLevel     = this.heatBuildup;
    this.evasionChance = this.evasionBuildup;

    this.heatBurstTimer = 0;
  }

  /**
   * Deal damage and evolve resistance organically.
   * Physical hits grow armor; sniper hits additionally grow evasion.
   */
  takeDamage(amount, damageType = 'physical') {
    if (damageType === 'physical') {
      this.armorBuildup = Math.min(MASTER.ARMOR_MAX,
        this.armorBuildup + MASTER.ARMOR_PER_HIT * this.adaptRate);
      this.armorFactor  = this.armorBuildup;

      if (this.lastHitBy === 'sniper') {
        this.evasionBuildup = Math.min(MASTER.EVASION_MAX,
          this.evasionBuildup + MASTER.EVASION_PER_SNIPE * this.adaptRate);
        this.evasionChance  = this.evasionBuildup;
      }
    }

    const reduced = (damageType === 'physical' && this.armorFactor > 0)
      ? amount * (1 - this.armorFactor)
      : amount;
    this.hp -= reduced;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
  }

  /** Apply a slow debuff — also grows heat resistance organically. */
  applySlow(factor, durationMs) {
    this.heatBuildup = Math.min(MASTER.HEAT_MAX,
      this.heatBuildup + MASTER.HEAT_PER_SLOW * this.adaptRate);
    this.heatLevel   = this.heatBuildup;

    // Heat resistance dilutes the slow effect
    const eff = this.heatLevel > 0
      ? 1 - (1 - factor) * (1 - this.heatLevel)
      : factor;
    if (eff < this.slowFactor || durationMs > this.slowTimer) {
      this.slowFactor = Math.min(this.slowFactor, eff);
      this.slowTimer  = Math.max(this.slowTimer, durationMs);
    }
  }

  update(dt, grid, onChanged) {
    if (this.dead || this.reached) return;

    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) {
        this.slowTimer  = 0;
        this.slowFactor = 1.0;
        if (this.heatLevel > 0) this.heatBurstTimer = 700;
      }
    }
    if (this.heatBurstTimer > 0) this.heatBurstTimer = Math.max(0, this.heatBurstTimer - dt);

    const nextNode = this.path[this.pathIndex + 1];
    if (!nextNode) { this.reached = true; return; }

    const tx = nextNode.x * this.tileSize + this.tileSize * 0.5;
    const ty = nextNode.y * this.tileSize + this.tileSize * 0.5;
    const dx = tx - this.wx, dy = ty - this.wy;
    const dist = Math.hypot(dx, dy);
    const burstMult = (this.heatBurstTimer > 0) ? 1.30 : 1.0;
    const step = this.speed * this.slowFactor * burstMult * dt * 0.001;

    if (dist <= step) {
      this.wx = tx; this.wy = ty;
      this.pathIndex++;
      const changed = grid.addPressure(nextNode.x, nextNode.y, this.pressurePerStep);
      if (changed) onChanged?.(nextNode.x, nextNode.y);
      if (this.pathIndex >= this.path.length - 1) this.reached = true;
    } else {
      this.wx += (dx / dist) * step;
      this.wy += (dy / dist) * step;
    }
  }

  repath(newPath) {
    if (!newPath?.length) return;
    this.path      = [...newPath];
    this.pathIndex = 0;
  }
}
