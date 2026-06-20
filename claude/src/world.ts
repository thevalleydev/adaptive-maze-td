import { config, view, TowerKind, TOWER_DEFS, EnemyKind, ENEMY_DEFS } from './config';
import { Grid } from './grid';
import { findPath, Pt } from './astar';
import { Enemy, Tower, ShotLine } from './entities';

export interface Shot extends ShotLine {
  ttl: number;
}

// The entire simulation — state + update logic, with NO rendering or DOM/input.
// Both the browser game (via Game) and the headless sim run this exact code, so
// balance numbers measured in the sim are the numbers the player experiences.
export class World {
  grid = new Grid();
  enemies: Enemy[] = [];
  towers: Tower[] = [];
  shots: Shot[] = [];

  money = 250;
  kills = 0;
  leaks = 0;

  // --- Waves / run state ---
  wave = 0;
  waveActive = false;
  spawnQueue: EnemyKind[] = [];
  currentWaveHp = config.enemyHp;
  spawnTimer = 0;
  betweenTimer = 2; // initial breather before wave 1
  lives = 20;
  gameOver = false;
  gameWon = false;

  previewPath: Pt[] | null = null;
  previewVersion = -1;

  // --- Building -------------------------------------------------------------
  nearSpawn(x: number, y: number): boolean {
    return Math.max(Math.abs(x - this.grid.spawn.x), Math.abs(y - this.grid.spawn.y)) <= config.spawnBuffer;
  }

  canBuildOn(x: number, y: number): boolean {
    const t = this.grid.at(x, y);
    if (!t) return false;
    if (t.blocked) return false;
    if (this.grid.isSpawnOrExit(x, y)) return false;
    if (t.state === 'collapsed') return false;
    if (this.nearSpawn(x, y)) return false; // can't wall the mouth shut
    return true;
  }

  // Cost escalates with how many of that kind you already own, so thick walls
  // must be earned rather than spammed once the economy snowballs.
  towerCost(kind: TowerKind): number {
    const owned = this.towers.reduce((n, t) => n + (t.kind === kind ? 1 : 0), 0);
    return Math.round(TOWER_DEFS[kind].cost * (1 + config.towerCostGrowth * owned));
  }

  tryPlaceTower(x: number, y: number, kind: TowerKind): boolean {
    if (!this.canBuildOn(x, y)) return false;
    const cost = this.towerCost(kind);
    if (this.money < cost) return false;

    // Tentatively block, verify a path still exists (towers form the maze).
    this.grid.setBlocked(x, y, true);
    if (!findPath(this.grid, this.grid.spawn, this.grid.exit)) {
      this.grid.setBlocked(x, y, false);
      return false;
    }
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
    this.currentWaveHp = config.enemyHp * (1 + (this.wave - 1) * config.waveHpGrowth);
    this.spawnTimer = 0;
    this.waveActive = true;
  }

  reset() {
    this.grid = new Grid();
    this.enemies = [];
    this.towers = [];
    this.shots = [];
    this.money = 250;
    this.kills = 0;
    this.leaks = 0;
    this.wave = 0;
    this.waveActive = false;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.betweenTimer = 2;
    this.lives = 20;
    this.gameOver = false;
    this.gameWon = false;
    this.previewVersion = -1;
  }

  // --- Per-frame simulation -------------------------------------------------
  update(dt: number) {
    if (this.gameOver || this.gameWon) return;

    // Wave state machine.
    if (this.waveActive) {
      if (this.spawnQueue.length > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnTimer = config.spawnInterval;
          const kind = this.spawnQueue.shift()!;
          const hp = this.currentWaveHp * ENEMY_DEFS[kind].hpMult;
          this.enemies.push(new Enemy(this.grid, kind, hp));
        }
      } else if (this.enemies.length === 0) {
        // Wave cleared: dump the bulk of pressure (the breather cools the map),
        // then either win the run or queue the next wave.
        this.waveActive = false;
        this.grid.dissipate(config.betweenWaveDecay);
        if (this.wave >= config.targetWave) this.gameWon = true;
        else this.betweenTimer = config.interWaveTime;
      }
    } else {
      this.betweenTimer -= dt;
      if (this.betweenTimer <= 0) this.startWave();
    }

    this.grid.update(dt);

    // A collapse takes out towers on the ground next to it — clustering punished.
    if (view.collapseWrecksTowers && this.grid.justCollapsed.length) {
      for (const t of this.grid.justCollapsed) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          this.destroyTowerAt(t.x + dx, t.y + dy);
        }
      }
    }

    for (const e of this.enemies) e.update(dt, this.grid);

    for (const t of this.towers) {
      const shot = t.update(dt, this.enemies, this.grid);
      if (shot) this.shots.push({ ...shot, ttl: 0.06 });
    }

    // Reap.
    for (const e of this.enemies) {
      if (e.dead) {
        this.kills++;
        this.money += ENEMY_DEFS[e.kind].reward * config.killRewardMult;
        this.grid.addPressure(Math.round(e.x), Math.round(e.y), config.pressurePerKill);
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

    // Recompute the preview path only when the graph changes.
    if (this.previewVersion !== this.grid.graphVersion) {
      this.previewPath = findPath(this.grid, this.grid.spawn, this.grid.exit);
      this.previewVersion = this.grid.graphVersion;
    }
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
