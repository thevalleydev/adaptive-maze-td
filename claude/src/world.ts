import { config, view, TowerKind, TOWER_DEFS, TOWER_ORDER, EnemyKind, ENEMY_DEFS, DamageType, DAMAGE_TYPES } from './config';
import { Grid, COLS, ROWS } from './grid';
import { findPath, Pt } from './astar';
import { Enemy, Tower, ShotLine } from './entities';
import { RNG } from './rng';

export interface Shot extends ShotLine {
  ttl: number;
}

export interface LevelUpOption {
  kind: 'cheaper' | 'stronger';
  tower: TowerKind;
  label: string;
}

function makeMods(): Record<TowerKind, number> {
  const m = {} as Record<TowerKind, number>;
  for (const k of TOWER_ORDER) m[k] = 1;
  return m;
}

// The entire simulation — state + update logic, with NO rendering or DOM/input.
// Both the browser game (via Game) and the headless sim run this exact code, so
// balance numbers measured in the sim are the numbers the player experiences.
export class World {
  grid = new Grid();
  enemies: Enemy[] = [];
  towers: Tower[] = [];
  shots: Shot[] = [];

  money = 300;
  kills = 0;
  leaks = 0;

  // --- Waves / run state ---
  wave = 0;
  waveActive = false;
  spawnQueue: EnemyKind[] = [];
  currentWaveHp = config.enemyHp;
  spawnTimer = 0;
  betweenTimer = 2; // initial breather before wave 1
  lives = 12;
  gameOver = false;
  reachedTarget = false; // crossed targetWave — milestone, not an end; play continues

  started = false; // prep phase until the player hits Start

  // --- Creep evolution (arms race) ---
  evolution = { climb: false, bomb: false, frustration: 0, armor: null as DamageType | null };
  justLearned: 'climb' | 'bomb' | 'armor' | null = null; // set the frame an ability is learned (UI banner)
  // Damage dealt per type since the last armor adaptation. When one type both
  // crosses the threshold AND dominates, the swarm hardens against it; the tally
  // then resets so the next over-reliance is measured fresh.
  private dmgByType: Record<DamageType, number> = { kinetic: 0, blast: 0, frost: 0 };

  // --- Player level-ups (per-run roguelite mods) ---
  statMod: Record<TowerKind, number> = makeMods(); // damage multiplier per tower kind
  costMod: Record<TowerKind, number> = makeMods(); // cost multiplier per tower kind
  levelUpsTaken = 0;
  awaitingLevelUp = false;
  levelUpOptions: LevelUpOption[] = [];

  previewPath: Pt[] | null = null;
  previewVersion = -1;

  // null = "classic" centered empty map (used by the sim); a number generates a
  // deterministic map (spawn/exit + rock obstacles) so every run is reproducible.
  seed: number | null = null;

  constructor(seed: number | null = null) {
    this.seed = seed;
    this.reset();
  }

  loadSeed(seed: number | null) {
    this.seed = seed;
    this.reset();
  }

  private applyGeneration() {
    if (this.seed === null) return; // classic centered map, no rocks
    const rng = new RNG(this.seed);
    const g = this.grid;
    g.spawn = { x: 0, y: 2 + rng.int(ROWS - 4) };
    g.exit = { x: COLS - 1, y: 2 + rng.int(ROWS - 4) };
    const target = Math.floor(ROWS * COLS * config.rockDensity);
    let placed = 0;
    let attempts = 0;
    while (placed < target && attempts < target * 12) {
      attempts++;
      const x = rng.int(COLS);
      const y = rng.int(ROWS);
      const t = g.at(x, y);
      if (!t || t.rock) continue;
      if (g.isSpawnOrExit(x, y) || this.nearSpawn(x, y)) continue;
      t.rock = true;
      if (!findPath(g, g.spawn, g.exit)) {
        t.rock = false; // keep the map solvable
        continue;
      }
      placed++;
    }
  }

  // --- Building -------------------------------------------------------------
  nearSpawn(x: number, y: number): boolean {
    return Math.max(Math.abs(x - this.grid.spawn.x), Math.abs(y - this.grid.spawn.y)) <= config.spawnBuffer;
  }

  canBuildOn(x: number, y: number): boolean {
    const t = this.grid.at(x, y);
    if (!t) return false;
    if (t.blocked || t.rock) return false;
    if (this.grid.isSpawnOrExit(x, y)) return false;
    if (t.state === 'collapsed') return false;
    if (this.nearSpawn(x, y)) return false; // can't wall the mouth shut
    return true;
  }

  // Cost to take the tower on this tile to its next level (null if max/none).
  upgradeCostAt(x: number, y: number): number | null {
    const t = this.towers.find((tw) => tw.x === x && tw.y === y);
    if (!t || TOWER_DEFS[t.kind].structural || t.level >= config.maxTowerLevel) return null;
    return Math.round(TOWER_DEFS[t.kind].cost * t.level * config.upgradeCostMult);
  }

  tryUpgradeTower(x: number, y: number): boolean {
    const t = this.towers.find((tw) => tw.x === x && tw.y === y);
    const cost = this.upgradeCostAt(x, y);
    if (!t || cost === null || this.money < cost) return false;
    this.money -= cost;
    t.level++;
    return true;
  }

  // Cost escalates with how many of that kind you already own, so thick walls
  // must be earned rather than spammed once the economy snowballs.
  towerCost(kind: TowerKind): number {
    const def = TOWER_DEFS[kind];
    const mod = this.costMod[kind] ?? 1;
    if (def.structural) return Math.max(1, Math.round(def.cost * mod)); // walls: flat, spammable
    const owned = this.towers.reduce((n, t) => n + (t.kind === kind ? 1 : 0), 0);
    return Math.max(1, Math.round(def.cost * (1 + config.towerCostGrowth * owned) * mod));
  }

  tryPlaceTower(x: number, y: number, kind: TowerKind): boolean {
    if (!this.canBuildOn(x, y)) return false;
    const cost = this.towerCost(kind);
    if (this.money < cost) return false;
    // No path-existence check: you MAY seal the path. The creeps will adapt
    // (learn to climb, then bomb) — see the evolution logic in update().
    this.grid.setBlocked(x, y, true);
    this.towers.push(new Tower(x, y, kind));
    this.money -= cost;
    return true;
  }

  trySellTower(x: number, y: number): boolean {
    const i = this.towers.findIndex((t) => t.x === x && t.y === y);
    if (i === -1) return false;
    this.money += Math.floor(TOWER_DEFS[this.towers[i].kind].cost * 0.7);
    this.towers.splice(i, 1);
    this.grid.setBlocked(x, y, false);
    return true;
  }

  private destroyTowerAt(x: number, y: number) {
    const i = this.towers.findIndex((t) => t.x === x && t.y === y);
    if (i === -1) return;
    // Salvage: a wrecked tower refunds half its base cost so a collapse costs
    // you your *position*, not your whole economy.
    this.money += Math.floor(TOWER_DEFS[this.towers[i].kind].cost * 0.5);
    this.towers.splice(i, 1);
    this.grid.setBlocked(x, y, false);
  }

  // --- Prep / Start ---------------------------------------------------------
  start() {
    if (!this.started) {
      this.started = true;
      this.betweenTimer = 1; // brief "get ready" before wave 1
    }
  }

  // --- Creep evolution ------------------------------------------------------
  effectiveWallCost(): number {
    if (!view.enemyAdaptation) return Infinity;
    return this.evolution.climb ? config.wallCostClimb : Infinity;
  }
  private learnClimb() {
    if (!this.evolution.climb) {
      this.evolution.climb = true;
      this.justLearned = 'climb';
    }
  }
  private learnBomb() {
    if (!this.evolution.bomb) {
      this.evolution.bomb = true;
      this.justLearned = 'bomb';
    }
  }
  private bombStructure(x: number, y: number) {
    const i = this.towers.findIndex((t) => t.x === x && t.y === y);
    if (i !== -1) this.towers.splice(i, 1); // bombed = no salvage; defend it or lose it
    this.grid.setBlocked(x, y, false);
  }

  // Mono-tower counter: once you've poured enough of ONE damage type into the
  // swarm and it dominates your output, the swarm hardens against that type.
  // Spreading damage across types keeps any one below the dominance line — so
  // a diverse defense never triggers it, and pivoting to a new mono-tower just
  // moves the armor. Re-measures from zero after each adaptation.
  private maybeEvolveArmor() {
    let top: DamageType = 'kinetic';
    let total = 0;
    for (const t of DAMAGE_TYPES) {
      total += this.dmgByType[t];
      if (this.dmgByType[t] > this.dmgByType[top]) top = t;
    }
    if (this.dmgByType[top] < config.armorDamageThreshold) return;
    if (total <= 0 || this.dmgByType[top] / total < config.armorDominance) return;
    if (this.evolution.armor !== top) {
      this.evolution.armor = top;
      this.justLearned = 'armor';
    }
    for (const t of DAMAGE_TYPES) this.dmgByType[t] = 0; // re-measure the next over-reliance
  }

  // --- Player level-ups -----------------------------------------------------
  private grantLevelUp() {
    this.awaitingLevelUp = true;
    const rng = new RNG((this.seed ?? 1) ^ ((this.levelUpsTaken + 1) * 0x9e3779b1));
    const pool: LevelUpOption[] = [];
    for (const k of ['gun', 'frost', 'cannon'] as TowerKind[]) {
      pool.push({ kind: 'stronger', tower: k, label: `+${Math.round((config.levelUpBuff - 1) * 100)}% ${TOWER_DEFS[k].name} dmg` });
      pool.push({ kind: 'cheaper', tower: k, label: `−${Math.round((1 - config.levelUpDiscount) * 100)}% ${TOWER_DEFS[k].name} cost` });
    }
    const opts: LevelUpOption[] = [];
    while (opts.length < 3 && pool.length) opts.push(pool.splice(rng.int(pool.length), 1)[0]);
    this.levelUpOptions = opts;
  }

  chooseLevelUp(i: number) {
    const o = this.levelUpOptions[i];
    if (!o) return;
    if (o.kind === 'stronger') this.statMod[o.tower] *= config.levelUpBuff;
    else this.costMod[o.tower] *= config.levelUpDiscount;
    this.levelUpsTaken++;
    this.awaitingLevelUp = false;
    this.levelUpOptions = [];
  }

  // --- Wave control ---------------------------------------------------------
  private startWave() {
    this.wave++;
    const count = Math.round(config.waveBaseCount + (this.wave - 1) * config.waveCountGrowth);
    const q: EnemyKind[] = [];
    for (let i = 0; i < count; i++) {
      if (this.wave >= 3 && i % 5 === 4) q.push('brute');
      else if (i % 3 === 0) q.push('runner');
      else q.push('grunt');
    }
    this.spawnQueue = q;
    // Compounding HP: a linear ramp gets outpaced by a player who keeps adding
    // towers (space is finite, so DPS plateaus). Exponential growth guarantees
    // that even a maxed defense eventually drowns — death comes, the only
    // question is which wave.
    this.currentWaveHp = config.enemyHp * Math.pow(1 + config.waveHpGrowth, this.wave - 1);
    this.spawnTimer = 0;
    this.waveActive = true;
  }

  reset() {
    this.grid = new Grid();
    this.applyGeneration();
    this.enemies = [];
    this.towers = [];
    this.shots = [];
    this.money = 300;
    this.kills = 0;
    this.leaks = 0;
    this.wave = 0;
    this.waveActive = false;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.betweenTimer = 2;
    this.lives = 12;
    this.gameOver = false;
    this.reachedTarget = false;
    this.started = false;
    this.evolution = { climb: false, bomb: false, frustration: 0, armor: null };
    this.justLearned = null;
    this.dmgByType = { kinetic: 0, blast: 0, frost: 0 };
    this.statMod = makeMods();
    this.costMod = makeMods();
    this.levelUpsTaken = 0;
    this.awaitingLevelUp = false;
    this.levelUpOptions = [];
    this.previewVersion = -1;
  }

  // --- Per-frame simulation -------------------------------------------------
  update(dt: number) {
    if (this.gameOver) return; // only death ends the run; the target is endless beyond
    this.justLearned = null;

    // Sim only runs once the player hits Start (prep phase before that). Preview
    // still recomputes below so building during prep updates the route.
    if (this.started) {
      this.simStep(dt);
    }

    // Preview the ground route (Infinity = no climbing); null if fully sealed.
    if (this.previewVersion !== this.grid.graphVersion) {
      this.previewPath = findPath(this.grid, this.grid.spawn, this.grid.exit);
      this.previewVersion = this.grid.graphVersion;
    }
  }

  private simStep(dt: number) {
    // Wave state machine.
    if (this.waveActive) {
      if (this.spawnQueue.length > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnTimer = config.spawnInterval;
          const kind = this.spawnQueue.shift()!;
          const hp = this.currentWaveHp * ENEMY_DEFS[kind].hpMult;
          // Hardened creeps inherit the current armor; in-flight creeps keep theirs.
          this.enemies.push(new Enemy(this.grid, kind, hp, this.evolution.armor));
        }
      } else if (this.enemies.length === 0) {
        // Wave cleared: cool the map, flag the milestone, maybe grant a level-up,
        // then queue the next wave (the run only ends on death).
        this.waveActive = false;
        this.grid.dissipate(config.betweenWaveDecay);
        if (this.wave >= config.targetWave) this.reachedTarget = true;
        if (this.wave % config.levelUpEvery === 0) this.grantLevelUp();
        this.betweenTimer = config.interWaveTime;
      }
    } else if (!this.awaitingLevelUp) {
      // Hold the next wave until the player picks their level-up reward.
      this.betweenTimer -= dt;
      if (this.betweenTimer <= 0) this.startWave();
    }

    this.grid.update(dt);

    // A collapse wrecks nearby structures — towers within 1 tile, WALLS within 2.
    if (view.collapseWrecksTowers && this.grid.justCollapsed.length) {
      for (const ct of this.grid.justCollapsed) {
        for (const tw of [...this.towers]) {
          const md = Math.abs(tw.x - ct.x) + Math.abs(tw.y - ct.y);
          const reach = TOWER_DEFS[tw.kind].structural ? 2 : 1;
          if (md <= reach) this.destroyTowerAt(tw.x, tw.y);
        }
      }
    }

    // Creep adaptation inputs (only when enabled).
    const adapt = view.enemyAdaptation;
    const wallCost = this.effectiveWallCost();
    const opts = adapt
      ? { wallCost, bombLearned: this.evolution.bomb, onBlocked: () => this.learnClimb() }
      : {};
    for (const e of this.enemies) e.update(dt, this.grid, opts);

    // A finished bomb destroys the structure it targeted (opens a gap).
    for (const e of this.enemies) {
      if (e.bombedTile) {
        this.bombStructure(e.bombedTile.x, e.bombedTile.y);
        e.bombedTile = null;
      }
    }

    for (const t of this.towers) {
      const shot = t.update(dt, this.enemies, this.grid, this.statMod[t.kind] ?? 1, this.dmgByType);
      if (shot) this.shots.push({ ...shot, ttl: 0.06 });
    }
    if (view.enemyAdaptation) this.maybeEvolveArmor();

    // Reap.
    for (const e of this.enemies) {
      if (e.dead) {
        this.kills++;
        this.money += ENEMY_DEFS[e.kind].reward * config.killRewardMult;
        this.grid.addPressure(Math.round(e.x), Math.round(e.y), config.pressurePerKill);
        // Killing forced climbers builds frustration → escalation to bombing.
        if (adapt && this.evolution.climb && !this.evolution.bomb && e.everClimbed) {
          this.evolution.frustration++;
          if (this.evolution.frustration >= config.frustrationToBomb) this.learnBomb();
        }
      } else if (e.leaked) {
        this.leaks++;
        if (--this.lives <= 0) {
          this.lives = 0;
          this.gameOver = true;
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead && !e.leaked);

    for (const s of this.shots) s.ttl -= dt;
    this.shots = this.shots.filter((s) => s.ttl > 0);
  }

  // --- Read helpers (used by render + policies) -----------------------------
  maxNeighborPressure(x: number, y: number): number {
    let m = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const t = this.grid.at(x + dx, y + dy);
      if (t) m = Math.max(m, t.pressure);
    }
    return m;
  }

  neighborCollapsing(x: number, y: number): boolean {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const t = this.grid.at(x + dx, y + dy);
      if (t && t.state === 'collapsing') return true;
    }
    return false;
  }
}
