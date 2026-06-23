// Headless sim of the DOM-free core: spawn enemies, walk them, build a wall of
// "towers" to force a chokepoint, and confirm pressure -> collapse -> repath all
// fire without throwing. Run via tsc emit + node (see the bash invocation).
import { config } from './config';
import { Grid } from './grid';
import { findPath } from './astar';
import { Enemy, Tower } from './entities';
import { World } from './world';

const grid = new Grid();

// Force a vertical wall with a single 1-tile gap to create a hard chokepoint,
// so all flow funnels through one tile and pressure spikes fast.
const wallX = Math.floor(grid.cols / 2);
const gapY = grid.spawn.y;
for (let y = 0; y < grid.rows; y++) {
  if (y === gapY) continue;
  grid.setBlocked(wallX, y, true);
}

// Sanity: a path must exist through the gap.
const p0 = findPath(grid, grid.spawn, grid.exit);
if (!p0) throw new Error('no initial path through the gap');
console.log(`initial path length: ${p0.length}`);

// Crank pressure so we actually reach collapse within the sim window.
config.pressureRate = 40;
config.decayRate = 2;
config.spawnInterval = 0.25;
config.waveBaseCount = 200; // one long wave for the test

const enemies: Enemy[] = [];
let spawnTimer = 0;
let toSpawn = config.waveBaseCount;
const dt = 1 / 60;
let leaks = 0;
let cracked = false;
let collapsing = false;
let collapsed = false;
let maxPressure = 0;

for (let frame = 0; frame < 60 * 25; frame++) {
  spawnTimer -= dt;
  if (spawnTimer <= 0 && toSpawn > 0) {
    spawnTimer = config.spawnInterval;
    enemies.push(new Enemy(grid, 'grunt', config.enemyHp));
    toSpawn--;
  }
  grid.update(dt);
  for (const e of enemies) e.update(dt, grid);

  for (const e of enemies) {
    if (e.leaked) leaks++;
  }
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].leaked) enemies.splice(i, 1);
  }

  for (const t of grid.tiles) {
    maxPressure = Math.max(maxPressure, t.pressure);
    if (t.state === 'cracked') cracked = true;
    if (t.state === 'collapsing') collapsing = true;
    if (t.state === 'collapsed') collapsed = true;
  }
}

console.log(
  JSON.stringify(
    {
      framesRun: 60 * 25,
      leaks,
      maxPressure: Math.round(maxPressure),
      graphVersion: grid.graphVersion,
      sawCracked: cracked,
      sawCollapsing: collapsing,
      sawCollapsed: collapsed,
      enemiesAlive: enemies.length,
    },
    null,
    2,
  ),
);

if (!cracked) throw new Error('FAIL: never cracked');
if (!collapsed) throw new Error('FAIL: never collapsed');
if (leaks === 0) throw new Error('FAIL: nothing ever reached the exit');
console.log('SCENARIO 1 (collapse cycle) PASSED\n');

// --- Scenario 2: crowding a chokepoint self-destructs --------------------------
// Cram gun towers around the single gap and confirm the collapse mechanic wrecks
// them — i.e. you cannot just clump guns and win forever.
const g2 = new Grid();
const wx = Math.floor(g2.cols / 2);
const gy = g2.spawn.y;
for (let y = 0; y < g2.rows; y++) {
  if (y !== gy) g2.setBlocked(wx, y, true);
}
const towers: Tower[] = [];
const place = (x: number, y: number) => {
  g2.setBlocked(x, y, true);
  if (!findPath(g2, g2.spawn, g2.exit)) {
    g2.setBlocked(x, y, false);
    return;
  }
  towers.push(new Tower(x, y, 'gun'));
};
// Flank the chokepoint on the open diagonals (path stays open through the gap).
place(wx - 1, gy - 1);
place(wx - 1, gy + 1);
place(wx + 1, gy - 1);
place(wx + 1, gy + 1);
const initialTowers = towers.length;

const e2: Enemy[] = [];
let st2 = 0;
let toSpawn2 = 300;
let wrecked = 0;

for (let frame = 0; frame < 60 * 25; frame++) {
  st2 -= dt;
  if (st2 <= 0 && toSpawn2 > 0) {
    st2 = config.spawnInterval;
    e2.push(new Enemy(g2, 'grunt', config.enemyHp));
    toSpawn2--;
  }
  g2.update(dt);
  // Wreck towers adjacent to anything that just collapsed.
  for (const t of g2.justCollapsed) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const i = towers.findIndex((tw) => tw.x === t.x + dx && tw.y === t.y + dy);
      if (i !== -1) {
        g2.setBlocked(towers[i].x, towers[i].y, false);
        towers.splice(i, 1);
        wrecked++;
      }
    }
  }
  for (const en of e2) en.update(dt, g2);
  for (const tw of towers) tw.update(dt, e2, g2);
  for (const en of e2) {
    if (en.dead) g2.addPressure(Math.round(en.x), Math.round(en.y), config.pressurePerKill);
  }
  for (let i = e2.length - 1; i >= 0; i--) {
    if (e2[i].dead || e2[i].leaked) e2.splice(i, 1);
  }
}

console.log(
  JSON.stringify({ initialTowers, towersWrecked: wrecked, towersRemaining: towers.length }, null, 2),
);
if (wrecked === 0) throw new Error('FAIL: a crammed killbox never self-destructed');
console.log('SCENARIO 2 (crowding self-destructs) PASSED\n');

// --- Scenario 3: crack-seeking pathfinding -------------------------------------
// On an open grid, make one tile on the straight line very hot. A normal creep
// (positive pressure bias) should route AROUND it; a crack-seeker (negative bias)
// should route THROUGH it.
const g3 = new Grid();
const row = g3.spawn.y;
const midX = Math.floor(g3.cols / 2);
g3.at(midX, row)!.pressure = config.collapseThreshold; // max heat on the lane
const through = (p: { x: number; y: number }[] | null) => !!p && p.some((t) => t.x === midX && t.y === row);
const avoidPath = findPath(g3, g3.spawn, g3.exit, Infinity, config.pressureAvoidance);
const seekPath = findPath(g3, g3.spawn, g3.exit, Infinity, -config.crackLure);
console.log(JSON.stringify({ avoidThroughHot: through(avoidPath), seekThroughHot: through(seekPath) }));
if (through(avoidPath)) throw new Error('FAIL: normal creep walked through the hot tile');
if (!through(seekPath)) throw new Error('FAIL: crack-seeker did not steer into the hot tile');
console.log('SCENARIO 3 (crack-seeking pathfinding) PASSED\n');

// --- Scenario 4: sapper pressure caves in ground that normal walking wouldn't ---
// Drive one tile for 6s with either sapper pressure (seeker actively caving it
// in) or plain movement pressure (a normal creep loitering). The sapper should
// collapse it; the walker should not.
// Restore realistic rates (scenario 1 cranked the shared config singleton).
config.pressureRate = 9;
config.decayRate = 1.5;
const g4 = new Grid();
const sapTile = { x: 10, y: g4.spawn.y };
// Seconds until the tile collapses under a steady pressure rate (Infinity = none).
const timeToCollapse = (rate: number): number => {
  const t = g4.at(sapTile.x, sapTile.y)!;
  t.state = 'normal';
  t.pressure = 0;
  t.collapseTimer = 0;
  t.rubbleAge = 0;
  for (let f = 0; f < 60 * 30; f++) {
    g4.addPressure(t.x, t.y, rate * dt);
    g4.update(dt);
    if ((t.state as string) === 'collapsed') return f * dt;
  }
  return Infinity;
};
// A normal creep deposits movement pressure; a sapper adds the sap bonus on top.
const walkSec = timeToCollapse(config.pressureRate);
const sapSec = timeToCollapse(config.pressureRate + config.sapRate);
console.log(JSON.stringify({ sapSec: +sapSec.toFixed(1), walkSec: +walkSec.toFixed(1) }));
if (!isFinite(sapSec)) throw new Error('FAIL: sapper never collapsed the tile');
if (sapSec >= walkSec) throw new Error('FAIL: sapper did not collapse faster than plain walking');
console.log('SCENARIO 4 (sapper caves in ground faster) PASSED\n');

// --- Scenario 5: lane-structured map generation ---------------------------------
// Every seeded map must be solvable and actually carve some lane structure (rock).
let solvable = 0;
let structured = 0;
const seeds = [1, 7, 42, 100, 2025, 88888];
for (const seed of seeds) {
  const w = new World(seed);
  if (findPath(w.grid, w.grid.spawn, w.grid.exit)) solvable++;
  if (w.grid.tiles.some((t) => t.rock)) structured++;
}
console.log(JSON.stringify({ solvable: `${solvable}/${seeds.length}`, structured: `${structured}/${seeds.length}` }));
if (solvable < seeds.length) throw new Error('FAIL: a generated lane map was unsolvable');
if (structured < seeds.length) throw new Error('FAIL: a generated map had no lane structure');
console.log('SCENARIO 5 (lane map generation) PASSED');
