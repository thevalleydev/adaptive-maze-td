import { config, EnemyKind, ENEMY_DEFS, TowerKind, TOWER_DEFS } from './config';
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

  constructor(grid: Grid, kind: EnemyKind, hp: number) {
    this.kind = kind;
    this.x = grid.spawn.x;
    this.y = grid.spawn.y;
    this.maxHp = hp;
    this.hp = hp;
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

  private repath(grid: Grid) {
    const from = { x: Math.round(this.x), y: Math.round(this.y) };
    const p = findPath(grid, from, grid.exit);
    if (p && p.length) {
      this.path = p;
      this.pathIndex = p.length > 1 ? 1 : 0;
    }
    this.knownVersion = grid.graphVersion;
  }

  update(dt: number, grid: Grid) {
    if (this.dead || this.leaked) return;

    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowFactor = 1;
    }

    // Event-driven repath when the graph changes (collapse / tower edits),
    // plus a low-frequency tick so enemies steer around the pressure gradient.
    this.repathTimer -= dt;
    if (this.knownVersion !== grid.graphVersion || this.repathTimer <= 0) {
      this.repath(grid);
      this.repathTimer = 1.2;
    }
    if (this.pathIndex >= this.path.length) {
      this.leaked = true;
      return;
    }

    const tile = grid.at(Math.round(this.x), Math.round(this.y));
    if (tile) grid.addPressure(tile.x, tile.y, config.pressureRate * this.def.pressureMult * dt);

    const terrain = tile ? grid.speedMult(tile) : 1;
    const speed = config.enemySpeed * this.def.speedMult * terrain * this.slowFactor;
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
  cooldown = 0;
  targetId: number | null = null;

  constructor(x: number, y: number, kind: TowerKind) {
    this.x = x;
    this.y = y;
    this.kind = kind;
  }

  get def() {
    return TOWER_DEFS[this.kind];
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

  update(dt: number, enemies: Enemy[], grid: Grid): ShotLine | null {
    this.cooldown -= dt;
    const def = this.def;

    // Pressure degrades fire rate — a clustered killbox chokes itself.
    const frac = Math.min(1, this.localPressure(grid) / config.collapseThreshold);
    const effRate = Math.max(0.05, def.fireRate * (1 - config.pressureTowerDebuff * frac));

    const inRange = (e: Enemy) => Math.hypot(e.x - this.x, e.y - this.y) <= def.range;
    let target = enemies.find((e) => e.id === this.targetId && !e.dead && !e.leaked && inRange(e));
    if (!target) {
      this.targetId = null;
      let best: Enemy | undefined;
      let bestProg = -1;
      for (const e of enemies) {
        if (e.dead || e.leaked || !inRange(e)) continue;
        if (e.pathIndex > bestProg) {
          bestProg = e.pathIndex;
          best = e;
        }
      }
      target = best;
      if (target) this.targetId = target.id;
    }

    if (!target || this.cooldown > 0) return null;
    this.cooldown = 1 / effRate;

    const hit = (e: Enemy) => {
      e.hp -= def.damage;
      grid.addPressure(Math.round(e.x), Math.round(e.y), config.pressurePerDamage * def.damage);
      if (def.slowAmount && def.slowDuration) e.applySlow(def.slowAmount, def.slowDuration);
      if (e.hp <= 0) e.dead = true;
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
