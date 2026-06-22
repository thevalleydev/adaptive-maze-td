import { config, DamageType, EnemyKind, ENEMY_DEFS, TowerKind, TOWER_DEFS } from './config';
import { Grid } from './grid';
import { findPath, Pt } from './astar';

let enemyId = 0;

export class Enemy {
  id = enemyId++;
  kind: EnemyKind;
  x: number; // tile-space float position (center of tile = integer coords)
  y: number;
  hp: number;
  maxHp: number;
  path: Pt[] = [];
  pathIndex = 1; // index of the next waypoint we're walking toward
  knownVersion = -1; // last graphVersion we pathed against
  repathTimer: number; // low-frequency repath so enemies drift around pressure
  slowFactor = 1; // current speed multiplier from frost (1 = unaffected)
  slowTimer = 0;
  dead = false;
  leaked = false;
  armorType: DamageType | null = null; // hardened vs this damage type (set at spawn)

  // --- Adaptation state ---
  blocked = false; // no route at current ability (player sealed the path) — idles
  climbing = false; // currently traversing a structure tile (slow, no damage to it)
  everClimbed = false; // has had to climb — feeds the bomb-frustration metric
  bombing = false; // a bomber pausing to destroy a wall ahead
  bombTimer = 0;
  bombTarget: Pt | null = null;
  bombedTile: Pt | null = null; // set when a bomb completes; World destroys & clears it

  constructor(grid: Grid, kind: EnemyKind, hp: number, armorType: DamageType | null = null) {
    this.kind = kind;
    this.x = grid.spawn.x;
    this.y = grid.spawn.y;
    this.maxHp = hp;
    this.hp = hp;
    this.armorType = armorType;
    // Stagger so the whole pack doesn't re-path on the same frame.
    this.repathTimer = 0.6 + (this.id % 7) * 0.12;
  }

  get def() {
    return ENEMY_DEFS[this.kind];
  }

  applySlow(factor: number, duration: number) {
    // Keep the strongest active slow.
    this.slowFactor = Math.min(this.slowFactor, factor);
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  private repath(grid: Grid, wallCost: number) {
    const from = { x: Math.round(this.x), y: Math.round(this.y) };
    const p = findPath(grid, from, grid.exit, wallCost);
    if (p && p.length) {
      this.path = p;
      this.pathIndex = p.length > 1 ? 1 : 0;
      this.blocked = false;
    } else {
      this.path = [];
      this.pathIndex = 0;
      this.blocked = true; // no route at this ability level
    }
    this.knownVersion = grid.graphVersion;
  }

  update(dt: number, grid: Grid, opts: { wallCost?: number; bombLearned?: boolean; onBlocked?: () => void } = {}) {
    if (this.dead || this.leaked) return;
    const wallCost = opts.wallCost ?? Infinity;

    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowFactor = 1;
    }

    // Repath on graph change, on a low-frequency tick, or while blocked (so a
    // newly-learned ability or a bombed-open gap is picked up promptly).
    this.repathTimer -= dt;
    if (this.knownVersion !== grid.graphVersion || this.repathTimer <= 0 || this.blocked) {
      this.repath(grid, wallCost);
      this.repathTimer = 1.2;
    }

    if (this.blocked) {
      // The player sealed the path. Ask the swarm to adapt (learn to climb); idle
      // this frame — next frame the finite wallCost yields a route.
      opts.onBlocked?.();
      return;
    }
    if (this.pathIndex >= this.path.length) {
      this.leaked = true; // reached the exit
      return;
    }

    // Bombing: a bomber that has learned to bomb stops at a wall ahead and
    // destroys it rather than climbing over.
    const nextWp = this.path[this.pathIndex];
    const nextTile = grid.at(nextWp.x, nextWp.y);
    const nextIsStructure = !!nextTile && nextTile.blocked && !nextTile.rock;
    if (nextIsStructure && this.def.bomber && opts.bombLearned) {
      this.bombing = true;
      this.bombTarget = { x: nextWp.x, y: nextWp.y };
      this.bombTimer += dt;
      if (this.bombTimer >= config.bombTime) {
        this.bombedTile = { x: nextWp.x, y: nextWp.y }; // World destroys it
        this.bombing = false;
        this.bombTimer = 0;
      }
      return; // stationary while bombing
    }
    this.bombing = false;
    this.bombTimer = 0;

    const tile = grid.at(Math.round(this.x), Math.round(this.y));
    const onStructure = !!tile && tile.blocked && !tile.rock;
    this.climbing = onStructure;
    if (onStructure) this.everClimbed = true;
    // Pressure only accrues on real ground (not while clambering over a wall).
    if (tile && !onStructure) grid.addPressure(tile.x, tile.y, config.pressureRate * this.def.pressureMult * dt);

    const terrain = tile ? grid.speedMult(tile) : 1;
    const climbMul = onStructure ? config.climbSpeedMult : 1;
    const speed = config.enemySpeed * this.def.speedMult * terrain * this.slowFactor * climbMul;
    let budget = speed * dt;

    while (budget > 0 && this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex];
      const dx = wp.x - this.x;
      const dy = wp.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= budget) {
        this.x = wp.x;
        this.y = wp.y;
        budget -= dist;
        this.pathIndex++;
      } else {
        this.x += (dx / dist) * budget;
        this.y += (dy / dist) * budget;
        budget = 0;
      }
    }

    if (this.pathIndex >= this.path.length) {
      if (Math.round(this.x) === grid.exit.x && Math.round(this.y) === grid.exit.y) {
        this.leaked = true;
      }
    }
  }
}

export interface ShotLine {
  from: Pt;
  to: Pt;
  splash?: number; // radius, for rendering an AoE ring
}

export class Tower {
  kind: TowerKind;
  x: number;
  y: number;
  level = 1;
  cooldown = 0;
  targetId: number | null = null;
  // Presentation-only: current barrel bearing in radians (0 = pointing right).
  // The renderer eases this toward the live target; the sim never reads it.
  aimAngle = 0;

  constructor(x: number, y: number, kind: TowerKind) {
    this.x = x;
    this.y = y;
    this.kind = kind;
  }

  get def() {
    return TOWER_DEFS[this.kind];
  }

  // Per-level upgrade scaling.
  get damage() {
    return this.def.damage * (1 + 0.6 * (this.level - 1));
  }
  get fireRateEff() {
    return this.def.fireRate * (1 + 0.15 * (this.level - 1));
  }
  get rangeEff() {
    return this.def.range + 0.25 * (this.level - 1);
  }
  get ventRateEff() {
    return (this.def.ventRate ?? 0) * (1 + 0.5 * (this.level - 1));
  }

  // Highest pressure in the tower's 4-neighbourhood. The tower itself sits on a
  // blocked tile that never accrues pressure, so we read the ground around it.
  private localPressure(grid: Grid): number {
    let m = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const t = grid.at(this.x + dx, this.y + dy);
      if (t) m = Math.max(m, t.pressure);
    }
    return m;
  }

  update(dt: number, enemies: Enemy[], grid: Grid, dmgMul = 1, tally?: Partial<Record<DamageType, number>>): ShotLine | null {
    const def = this.def;

    // Vent tower: drain pressure from a SQUARE area (binary — every tile in the
    // square is fully vented). The counter to collapse; lets you hold a killbox.
    if (def.ventRate) {
      const ext = Math.max(1, Math.round(def.ventRadius ?? def.range));
      const rate = this.ventRateEff;
      for (let dy = -ext; dy <= ext; dy++) {
        for (let dx = -ext; dx <= ext; dx++) {
          const t = grid.at(this.x + dx, this.y + dy);
          if (t && t.pressure > 0) t.pressure = Math.max(0, t.pressure - rate * dt);
        }
      }
      return null;
    }

    if (def.structural) return null; // walls are inert blockers — no targeting

    this.cooldown -= dt;

    // Pressure degrades fire rate — a clustered killbox chokes itself.
    const frac = Math.min(1, this.localPressure(grid) / config.collapseThreshold);
    const effRate = Math.max(0.05, this.fireRateEff * (1 - config.pressureTowerDebuff * frac));

    const inRange = (e: Enemy) => Math.hypot(e.x - this.x, e.y - this.y) <= this.rangeEff;
    // Sniper re-acquires every shot so it always tracks the current biggest threat;
    // other towers stick to their target (furthest-along) until it dies or escapes.
    const strongest = def.targetMode === 'strongest';
    let target = strongest ? undefined : enemies.find((e) => e.id === this.targetId && !e.dead && !e.leaked && inRange(e));
    if (!target) {
      this.targetId = null;
      let best: Enemy | undefined;
      let bestScore = -1;
      for (const e of enemies) {
        if (e.dead || e.leaked || !inRange(e)) continue;
        const score = strongest ? e.hp : e.pathIndex;
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
      }
      target = best;
      if (target) this.targetId = target.id;
    }

    if (!target || this.cooldown > 0) return null;
    this.cooldown = 1 / effRate;

    const dmg = this.damage * dmgMul; // output before any enemy armor
    const type = def.damageType;
    const hit = (e: Enemy) => {
      // Armor negates a fraction of this type's damage; the ground only feels
      // what actually lands. The tally records OUTPUT (pre-armor), so leaning on
      // one type keeps it "dominant" even once the swarm has hardened to it.
      const applied = type && e.armorType === type ? dmg * (1 - config.armorResist) : dmg;
      e.hp -= applied;
      grid.addPressure(Math.round(e.x), Math.round(e.y), config.pressurePerDamage * applied);
      if (def.slowAmount && def.slowDuration) e.applySlow(def.slowAmount, def.slowDuration);
      if (e.hp <= 0) e.dead = true;
      if (type && tally) tally[type] = (tally[type] ?? 0) + dmg;
    };

    hit(target);
    if (def.splashRadius) {
      for (const e of enemies) {
        if (e === target || e.dead || e.leaked) continue;
        if (Math.hypot(e.x - target.x, e.y - target.y) <= def.splashRadius) hit(e);
      }
    }

    return { from: { x: this.x, y: this.y }, to: { x: target.x, y: target.y }, splash: def.splashRadius };
  }
}
