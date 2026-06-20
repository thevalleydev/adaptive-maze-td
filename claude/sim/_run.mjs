// src/sim/run.ts
import { writeFileSync, mkdirSync } from "fs";

// src/config.ts
var config = {
  pressureRate: 9,
  decayRate: 1.5,
  crackThreshold: 30,
  collapseThreshold: 80,
  telegraphDuration: 2.5,
  pressureAvoidance: 3,
  pressurePerDamage: 0.1,
  pressurePerKill: 6,
  pressureTowerDebuff: 0.55,
  betweenWaveDecay: 0.5,
  crackHealMargin: 10,
  crackedCost: 1.5,
  collapsedCost: 40,
  crackedSpeedMult: 0.85,
  collapsedSpeedMult: 0.45,
  rubbleHealTime: 12,
  spawnInterval: 0.7,
  interWaveTime: 5,
  waveBaseCount: 8,
  waveCountGrowth: 2,
  waveHpGrowth: 0.25,
  targetWave: 12,
  enemySpeed: 2.4,
  enemyHp: 60,
  spawnBuffer: 2,
  killRewardMult: 1,
  towerCostGrowth: 0.08
};
var view = {
  showHeatmap: true,
  showPath: true,
  paused: false,
  collapseWrecksTowers: true
  // a tile collapsing destroys towers on adjacent tiles
};
var TOWER_DEFS = {
  gun: { name: "Gun", cost: 50, damage: 18, range: 2.6, fireRate: 2, color: "#1f6feb", hotkey: "1" },
  frost: {
    name: "Frost",
    cost: 70,
    damage: 5,
    range: 2.3,
    fireRate: 1.5,
    color: "#3fd6ff",
    slowAmount: 0.5,
    slowDuration: 1.2,
    hotkey: "2"
  },
  cannon: {
    name: "Cannon",
    cost: 95,
    damage: 14,
    range: 2.9,
    fireRate: 0.8,
    color: "#d29922",
    splashRadius: 1.4,
    hotkey: "3"
  }
};
var ENEMY_DEFS = {
  runner: { name: "Runner", hpMult: 0.5, speedMult: 1.7, reward: 6, pressureMult: 0.8, color: "#f0c43e", radius: 0.2 },
  grunt: { name: "Grunt", hpMult: 1, speedMult: 1, reward: 8, pressureMult: 1, color: "#f0883e", radius: 0.26 },
  brute: { name: "Brute", hpMult: 3.2, speedMult: 0.62, reward: 18, pressureMult: 1.7, color: "#d9533b", radius: 0.34 }
};

// src/grid.ts
var COLS = 26;
var ROWS = 18;
var Grid = class {
  cols = COLS;
  rows = ROWS;
  tiles = [];
  spawn = { x: 0, y: Math.floor(ROWS / 2) };
  exit = { x: COLS - 1, y: Math.floor(ROWS / 2) };
  // Bumped whenever traversability OR cost changes, so enemies know to re-path.
  graphVersion = 0;
  // Tiles that collapsed this frame — the game uses these to wreck adjacent towers.
  justCollapsed = [];
  constructor() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        this.tiles.push({ x, y, blocked: false, state: "normal", pressure: 0, collapseTimer: 0, rubbleAge: 0 });
      }
    }
  }
  idx(x, y) {
    return y * this.cols + x;
  }
  at(x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    return this.tiles[this.idx(x, y)];
  }
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }
  isSpawnOrExit(x, y) {
    return x === this.spawn.x && y === this.spawn.y || x === this.exit.x && y === this.exit.y;
  }
  // Movement cost of entering a tile. Collapsed tiles are deliberately NOT
  // impassable — they're expensive rubble. This guarantees a path always
  // exists (no softlock) while still pushing the flow to reroute around them.
  enterCost(t) {
    let c = 1;
    if (t.state === "cracked") c += config.crackedCost;
    if (t.state === "collapsing") c += config.crackedCost;
    if (t.state === "collapsed") c += config.collapsedCost;
    c += config.pressureAvoidance * (t.pressure / config.collapseThreshold);
    return c;
  }
  speedMult(t) {
    if (t.state === "collapsed") return config.collapsedSpeedMult;
    if (t.state === "cracked" || t.state === "collapsing") return config.crackedSpeedMult;
    return 1;
  }
  // Advance pressure, cracking and collapse for every tile. Called each frame.
  // NOTE: we only bump graphVersion on *collapse* (a real cost/traversability
  // jump). Crack/heal oscillation near a threshold would otherwise force every
  // enemy to re-path every frame. Enemies still drift around pressure via their
  // own low-frequency periodic repath (see Enemy.update).
  update(dt) {
    let changed = false;
    this.justCollapsed.length = 0;
    for (const t of this.tiles) {
      if (t.pressure > 0 && t.state !== "collapsed") {
        t.pressure = Math.max(0, t.pressure - config.decayRate * dt);
      }
      switch (t.state) {
        case "normal":
          if (t.pressure >= config.crackThreshold) t.state = "cracked";
          break;
        case "cracked":
          if (t.pressure >= config.collapseThreshold) {
            t.state = "collapsing";
            t.collapseTimer = config.telegraphDuration;
          } else if (t.pressure < config.crackThreshold - config.crackHealMargin) {
            t.state = "normal";
          }
          break;
        case "collapsing":
          if (t.pressure < config.collapseThreshold) {
            t.state = "cracked";
            t.collapseTimer = 0;
          } else {
            t.collapseTimer -= dt;
            if (t.collapseTimer <= 0) {
              t.state = "collapsed";
              t.rubbleAge = 0;
              changed = true;
              this.justCollapsed.push(t);
            }
          }
          break;
        case "collapsed":
          if (config.rubbleHealTime > 0) {
            t.rubbleAge += dt;
            if (t.rubbleAge >= config.rubbleHealTime) {
              t.state = "normal";
              t.pressure = 0;
              changed = true;
            }
          }
          break;
      }
    }
    if (changed) this.graphVersion++;
  }
  // Applied once when a wave clears: the bulk of pressure dissipation. Keeps
  // cracks alive through a wave while letting the map cool during the breather.
  dissipate(fraction) {
    for (const t of this.tiles) {
      if (t.state !== "collapsed") t.pressure *= 1 - fraction;
    }
  }
  addPressure(x, y, amount) {
    const t = this.at(x, y);
    if (t && t.state !== "collapsed") t.pressure += amount;
  }
  setBlocked(x, y, blocked) {
    const t = this.at(x, y);
    if (!t) return;
    t.blocked = blocked;
    this.graphVersion++;
  }
};

// src/astar.ts
function findPath(grid, start, goal) {
  const startT = grid.at(start.x, start.y);
  const goalT = grid.at(goal.x, goal.y);
  if (!startT || !goalT) return null;
  const n = grid.cols * grid.rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const fScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  const startIdx = grid.idx(start.x, start.y);
  gScore[startIdx] = 0;
  fScore[startIdx] = h(start.x, start.y);
  const heap = [startIdx];
  const less = (a, b) => fScore[a] < fScore[b];
  const push = (i) => {
    heap.push(i);
    let c2 = heap.length - 1;
    while (c2 > 0) {
      const p = c2 - 1 >> 1;
      if (less(heap[c2], heap[p])) {
        [heap[c2], heap[p]] = [heap[p], heap[c2]];
        c2 = p;
      } else break;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let p = 0;
      for (; ; ) {
        const l = 2 * p + 1;
        const r = 2 * p + 2;
        let s = p;
        if (l < heap.length && less(heap[l], heap[s])) s = l;
        if (r < heap.length && less(heap[r], heap[s])) s = r;
        if (s === p) break;
        [heap[p], heap[s]] = [heap[s], heap[p]];
        p = s;
      }
    }
    return top;
  };
  const goalIdx = grid.idx(goal.x, goal.y);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];
  while (heap.length) {
    const cur = pop();
    if (cur === goalIdx) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % grid.cols;
    const cy = cur / grid.cols | 0;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nt = grid.at(nx, ny);
      if (!nt || nt.blocked) continue;
      const ni = grid.idx(nx, ny);
      if (closed[ni]) continue;
      const tentative = gScore[cur] + grid.enterCost(nt);
      if (tentative < gScore[ni]) {
        cameFrom[ni] = cur;
        gScore[ni] = tentative;
        fScore[ni] = tentative + h(nx, ny);
        push(ni);
      }
    }
  }
  if (cameFrom[goalIdx] === -1 && goalIdx !== startIdx) return null;
  const path = [];
  let c = goalIdx;
  while (c !== -1) {
    path.push({ x: c % grid.cols, y: c / grid.cols | 0 });
    if (c === startIdx) break;
    c = cameFrom[c];
  }
  path.reverse();
  return path;
}

// src/entities.ts
var enemyId = 0;
var Enemy = class {
  id = enemyId++;
  kind;
  x;
  // tile-space float position (center of tile = integer coords)
  y;
  hp;
  maxHp;
  path = [];
  pathIndex = 1;
  // index of the next waypoint we're walking toward
  knownVersion = -1;
  // last graphVersion we pathed against
  repathTimer;
  // low-frequency repath so enemies drift around pressure
  slowFactor = 1;
  // current speed multiplier from frost (1 = unaffected)
  slowTimer = 0;
  dead = false;
  leaked = false;
  constructor(grid, kind, hp) {
    this.kind = kind;
    this.x = grid.spawn.x;
    this.y = grid.spawn.y;
    this.maxHp = hp;
    this.hp = hp;
    this.repathTimer = 0.6 + this.id % 7 * 0.12;
  }
  get def() {
    return ENEMY_DEFS[this.kind];
  }
  applySlow(factor, duration) {
    this.slowFactor = Math.min(this.slowFactor, factor);
    this.slowTimer = Math.max(this.slowTimer, duration);
  }
  repath(grid) {
    const from = { x: Math.round(this.x), y: Math.round(this.y) };
    const p = findPath(grid, from, grid.exit);
    if (p && p.length) {
      this.path = p;
      this.pathIndex = p.length > 1 ? 1 : 0;
    }
    this.knownVersion = grid.graphVersion;
  }
  update(dt, grid) {
    if (this.dead || this.leaked) return;
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowFactor = 1;
    }
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
        this.x += dx / dist * budget;
        this.y += dy / dist * budget;
        budget = 0;
      }
    }
    if (this.pathIndex >= this.path.length) {
      if (Math.round(this.x) === grid.exit.x && Math.round(this.y) === grid.exit.y) {
        this.leaked = true;
      }
    }
  }
};
var Tower = class {
  kind;
  x;
  y;
  cooldown = 0;
  targetId = null;
  constructor(x, y, kind) {
    this.x = x;
    this.y = y;
    this.kind = kind;
  }
  get def() {
    return TOWER_DEFS[this.kind];
  }
  // Highest pressure in the tower's 4-neighbourhood. The tower itself sits on a
  // blocked tile that never accrues pressure, so we read the ground around it.
  localPressure(grid) {
    let m = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const t = grid.at(this.x + dx, this.y + dy);
      if (t) m = Math.max(m, t.pressure);
    }
    return m;
  }
  update(dt, enemies, grid) {
    this.cooldown -= dt;
    const def = this.def;
    const frac = Math.min(1, this.localPressure(grid) / config.collapseThreshold);
    const effRate = Math.max(0.05, def.fireRate * (1 - config.pressureTowerDebuff * frac));
    const inRange = (e) => Math.hypot(e.x - this.x, e.y - this.y) <= def.range;
    let target = enemies.find((e) => e.id === this.targetId && !e.dead && !e.leaked && inRange(e));
    if (!target) {
      this.targetId = null;
      let best;
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
    const hit = (e) => {
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
};

// src/world.ts
var World = class {
  grid = new Grid();
  enemies = [];
  towers = [];
  shots = [];
  money = 250;
  kills = 0;
  leaks = 0;
  // --- Waves / run state ---
  wave = 0;
  waveActive = false;
  spawnQueue = [];
  currentWaveHp = config.enemyHp;
  spawnTimer = 0;
  betweenTimer = 2;
  // initial breather before wave 1
  lives = 20;
  gameOver = false;
  gameWon = false;
  previewPath = null;
  previewVersion = -1;
  // --- Building -------------------------------------------------------------
  nearSpawn(x, y) {
    return Math.max(Math.abs(x - this.grid.spawn.x), Math.abs(y - this.grid.spawn.y)) <= config.spawnBuffer;
  }
  canBuildOn(x, y) {
    const t = this.grid.at(x, y);
    if (!t) return false;
    if (t.blocked) return false;
    if (this.grid.isSpawnOrExit(x, y)) return false;
    if (t.state === "collapsed") return false;
    if (this.nearSpawn(x, y)) return false;
    return true;
  }
  // Cost escalates with how many of that kind you already own, so thick walls
  // must be earned rather than spammed once the economy snowballs.
  towerCost(kind) {
    const owned = this.towers.reduce((n, t) => n + (t.kind === kind ? 1 : 0), 0);
    return Math.round(TOWER_DEFS[kind].cost * (1 + config.towerCostGrowth * owned));
  }
  tryPlaceTower(x, y, kind) {
    if (!this.canBuildOn(x, y)) return false;
    const cost = this.towerCost(kind);
    if (this.money < cost) return false;
    this.grid.setBlocked(x, y, true);
    if (!findPath(this.grid, this.grid.spawn, this.grid.exit)) {
      this.grid.setBlocked(x, y, false);
      return false;
    }
    this.towers.push(new Tower(x, y, kind));
    this.money -= cost;
    return true;
  }
  trySellTower(x, y) {
    const i = this.towers.findIndex((t) => t.x === x && t.y === y);
    if (i === -1) return false;
    this.money += Math.floor(TOWER_DEFS[this.towers[i].kind].cost * 0.7);
    this.towers.splice(i, 1);
    this.grid.setBlocked(x, y, false);
    return true;
  }
  destroyTowerAt(x, y) {
    const i = this.towers.findIndex((t) => t.x === x && t.y === y);
    if (i === -1) return;
    this.money += Math.floor(TOWER_DEFS[this.towers[i].kind].cost * 0.5);
    this.towers.splice(i, 1);
    this.grid.setBlocked(x, y, false);
  }
  // --- Wave control ---------------------------------------------------------
  startWave() {
    this.wave++;
    const count = Math.round(config.waveBaseCount + (this.wave - 1) * config.waveCountGrowth);
    const q = [];
    for (let i = 0; i < count; i++) {
      if (this.wave >= 3 && i % 5 === 4) q.push("brute");
      else if (i % 3 === 0) q.push("runner");
      else q.push("grunt");
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
  update(dt) {
    if (this.gameOver || this.gameWon) return;
    if (this.waveActive) {
      if (this.spawnQueue.length > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnTimer = config.spawnInterval;
          const kind = this.spawnQueue.shift();
          const hp = this.currentWaveHp * ENEMY_DEFS[kind].hpMult;
          this.enemies.push(new Enemy(this.grid, kind, hp));
        }
      } else if (this.enemies.length === 0) {
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
    if (view.collapseWrecksTowers && this.grid.justCollapsed.length) {
      for (const t of this.grid.justCollapsed) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
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
    if (this.previewVersion !== this.grid.graphVersion) {
      this.previewPath = findPath(this.grid, this.grid.spawn, this.grid.exit);
      this.previewVersion = this.grid.graphVersion;
    }
  }
  // --- Read helpers (used by render + policies) -----------------------------
  maxNeighborPressure(x, y) {
    let m = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const t = this.grid.at(x + dx, y + dy);
      if (t) m = Math.max(m, t.pressure);
    }
    return m;
  }
  neighborCollapsing(x, y) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const t = this.grid.at(x + dx, y + dy);
      if (t && t.state === "collapsing") return true;
    }
    return false;
  }
};

// src/sim/metrics.ts
function runGame(policy, opts = {}) {
  const dt = opts.dt ?? 1 / 60;
  const maxSteps = (opts.maxSeconds ?? 900) / dt;
  const world = new World();
  policy.onStart(world);
  let firstLeakWave = null;
  let prevLeaks = 0;
  let collapses = 0;
  let towersWrecked = 0;
  let cracksPersisted = false;
  let wavesCleared = 0;
  let prevWaveActive = false;
  let steps = 0;
  while (!world.gameOver && !world.gameWon && steps < maxSteps) {
    policy.onTick(world, dt);
    const snap = world.towers.map((t) => t.x * 1e3 + t.y);
    world.update(dt);
    collapses += world.grid.justCollapsed.length;
    for (const key of snap) {
      if (!world.towers.some((t) => t.x * 1e3 + t.y === key)) towersWrecked++;
    }
    if (world.leaks > prevLeaks) {
      if (firstLeakWave === null) firstLeakWave = world.wave;
      prevLeaks = world.leaks;
    }
    if (prevWaveActive && !world.waveActive) wavesCleared = world.wave;
    prevWaveActive = world.waveActive;
    if (!world.waveActive && world.wave > 0 && world.grid.tiles.some((t) => t.state === "cracked" || t.state === "collapsing")) {
      cracksPersisted = true;
    }
    steps++;
  }
  if (world.gameWon) wavesCleared = config.targetWave;
  return {
    policy: policy.name,
    won: world.gameWon,
    reachedWave: world.wave,
    wavesCleared,
    firstLeakWave,
    livesRemaining: world.lives,
    kills: world.kills,
    collapses,
    towersWrecked,
    finalTowers: world.towers.length,
    finalMoney: Math.floor(world.money),
    interventions: policy.sells,
    cracksPersisted
  };
}

// src/sim/policies.ts
function wall(x, gapRows, kind) {
  const out = [];
  for (let y = 0; y < ROWS; y++) if (!gapRows.includes(y)) out.push({ x, y, kind });
  return out;
}
var LAYOUTS = {
  // One tight chokepoint mid-map.
  choke: [
    { x: 12, y: 8, kind: "gun" },
    { x: 12, y: 10, kind: "gun" },
    { x: 14, y: 8, kind: "gun" },
    { x: 14, y: 10, kind: "gun" },
    { x: 11, y: 9, kind: "frost" },
    { x: 15, y: 9, kind: "cannon" },
    ...wall(13, [9], "gun")
  ],
  // Two offset walls -> a serpentine lane (more exposure time).
  doubleWall: [
    { x: 8, y: 4, kind: "gun" },
    { x: 8, y: 6, kind: "gun" },
    { x: 17, y: 12, kind: "gun" },
    { x: 17, y: 14, kind: "gun" },
    { x: 12, y: 9, kind: "cannon" },
    { x: 12, y: 8, kind: "frost" },
    ...wall(9, [5], "gun"),
    ...wall(16, [13], "gun")
  ],
  // The user's strategy: box the spawn at the buffer edge with two close walls.
  spawnBox: [
    { x: 4, y: 8, kind: "gun" },
    { x: 4, y: 10, kind: "gun" },
    { x: 6, y: 8, kind: "gun" },
    { x: 6, y: 10, kind: "gun" },
    { x: 5, y: 9, kind: "cannon" },
    ...wall(3, [7], "gun"),
    ...wall(5, [11], "gun")
  ]
};
var StaticPolicy = class {
  name;
  sells = 0;
  plan;
  idx = 0;
  constructor(layoutName) {
    this.name = `static:${layoutName}`;
    this.plan = LAYOUTS[layoutName];
  }
  onStart(world) {
    this.build(world);
  }
  onTick(world) {
    this.build(world);
  }
  build(world) {
    while (this.idx < this.plan.length) {
      const p = this.plan[this.idx];
      if (!world.canBuildOn(p.x, p.y)) {
        this.idx++;
        continue;
      }
      if (world.money < world.towerCost(p.kind)) break;
      world.tryPlaceTower(p.x, p.y, p.kind);
      this.idx++;
    }
  }
};
var ReactivePolicy = class {
  name = "reactive";
  sells = 0;
  timer = 0;
  onStart() {
  }
  onTick(world, dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    for (const t of [...world.towers]) {
      if (world.neighborCollapsing(t.x, t.y) && world.trySellTower(t.x, t.y)) this.sells++;
    }
    let guard = 30;
    while (world.money > 60 && guard-- > 0) {
      const spot = this.bestSpot(world);
      if (!spot || !world.tryPlaceTower(spot.x, spot.y, "gun")) break;
    }
  }
  bestSpot(world) {
    const path = world.previewPath;
    if (!path) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const p of path) {
      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0]
      ]) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (!world.canBuildOn(x, y)) continue;
        const score = 100 - world.maxNeighborPressure(x, y);
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best;
  }
};

// src/sim/sweep.ts
var SWEEP_AXES = {
  rubbleHealTime: [0, 12],
  towerCostGrowth: [0, 0.12],
  pressureRate: [9, 14],
  killRewardMult: [1, 0.6]
};
function makePolicies() {
  return [
    ...Object.keys(LAYOUTS).map((l) => new StaticPolicy(l)),
    new ReactivePolicy()
  ];
}
function cartesian(axes) {
  let combos = [{}];
  for (const [key, values] of axes) {
    const next = [];
    for (const c of combos) for (const v of values) next.push({ ...c, [key]: v });
    combos = next;
  }
  return combos;
}
function runSweep() {
  const axes = Object.entries(SWEEP_AXES);
  const combos = cartesian(axes);
  const rows = [];
  const original = { ...config };
  for (const combo of combos) {
    Object.assign(config, combo);
    for (const policy of makePolicies()) {
      const m = runGame(policy);
      rows.push({
        ...m,
        rubbleHealTime: config.rubbleHealTime,
        towerCostGrowth: config.towerCostGrowth,
        pressureRate: config.pressureRate,
        killRewardMult: config.killRewardMult
      });
    }
  }
  Object.assign(config, original);
  return rows;
}

// src/sim/run.ts
var argv = process.argv.slice(2);
var has = (flag) => argv.includes(flag);
var val = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : void 0;
};
function pad(s, n) {
  return String(s).padEnd(n);
}
if (has("--sweep")) {
  console.log(`Sweeping\u2026 target=wave ${config.targetWave}
`);
  const rows = runSweep();
  const hdr = ["policy", "heal", "cost+", "pRate", "rwd", "won", "cleared", "wall", "lives", "wrecked", "cracks"];
  const widths = [16, 5, 6, 6, 5, 4, 8, 5, 6, 8, 7];
  console.log(hdr.map((h, i) => pad(h, widths[i])).join(""));
  console.log("-".repeat(widths.reduce((a, b) => a + b, 0)));
  const sorted = [...rows].sort((a, b) => a.wavesCleared - b.wavesCleared || a.policy.localeCompare(b.policy));
  for (const r of sorted) {
    console.log(
      [
        pad(r.policy, widths[0]),
        pad(r.rubbleHealTime, widths[1]),
        pad(r.towerCostGrowth, widths[2]),
        pad(r.pressureRate, widths[3]),
        pad(r.killRewardMult, widths[4]),
        pad(r.won ? "Y" : "n", widths[5]),
        pad(r.wavesCleared, widths[6]),
        pad(r.firstLeakWave ?? "-", widths[7]),
        pad(r.livesRemaining, widths[8]),
        pad(r.towersWrecked, widths[9]),
        pad(r.cracksPersisted ? "Y" : "n", widths[10])
      ].join("")
    );
  }
  mkdirSync("sim", { recursive: true });
  writeFileSync("sim/results.json", JSON.stringify(rows, null, 2));
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => r[c]).join(","))].join("\n");
  writeFileSync("sim/results.csv", csv);
  console.log(`
Wrote sim/results.json and sim/results.csv (${rows.length} runs)`);
} else {
  const layout = val("--layout");
  const policyArg = val("--policy");
  const policies = policyArg === "reactive" ? [new ReactivePolicy()] : layout ? [new StaticPolicy(layout)] : [...Object.keys(LAYOUTS).map((l) => new StaticPolicy(l)), new ReactivePolicy()];
  console.log(`Single run @ defaults \xB7 target=wave ${config.targetWave}
`);
  const hdr = ["policy", "won", "cleared", "wall", "lives", "kills", "collapse", "wrecked", "moves", "cracks"];
  const widths = [16, 4, 8, 5, 6, 6, 9, 8, 6, 7];
  console.log(hdr.map((h, i) => pad(h, widths[i])).join(""));
  console.log("-".repeat(widths.reduce((a, b) => a + b, 0)));
  for (const p of policies) {
    const r = runGame(p);
    console.log(
      [
        pad(r.policy, widths[0]),
        pad(r.won ? "Y" : "n", widths[1]),
        pad(r.wavesCleared, widths[2]),
        pad(r.firstLeakWave ?? "-", widths[3]),
        pad(r.livesRemaining, widths[4]),
        pad(r.kills, widths[5]),
        pad(r.collapses, widths[6]),
        pad(r.towersWrecked, widths[7]),
        pad(r.interventions, widths[8]),
        pad(r.cracksPersisted ? "Y" : "n", widths[9])
      ].join("")
    );
  }
}
