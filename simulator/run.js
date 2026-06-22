/**
 * Headless difficulty simulator for Adaptive Maze TD.
 *
 * Runs the game's pure-JS logic (Grid, Pathfinder, Enemy, Tower) with no
 * Phaser dependency.  Each strategy is tested for up to MAX_WAVES waves and
 * per-wave stats are printed in a table.
 *
 * Usage:
 *   node simulator/run.js
 *   node simulator/run.js --waves 20
 *   node simulator/run.js --strategy mixed-maze
 *   node simulator/run.js --strategy all        (runs every strategy)
 */

import { Grid, TileType }  from '../src/systems/Grid.js';
import { Pathfinder }      from '../src/systems/Pathfinder.js';
import { Enemy }           from '../src/entities/Enemy.js';
import { Tower }           from '../src/entities/Tower.js';
import {
  COLS, ROWS, TILE, SPAWN, EXIT,
  PRESSURE, ECONOMY, WAVE, TOWERS, ENEMY,
} from '../src/config.js';

// ── Simulation resolution ─────────────────────────────────────────────────────
const SIM_DT       = 50;                   // ms per tick (50 ms ≈ 20fps, fast but accurate)
const MAX_TICKS    = (5 * 60 * 1000) / SIM_DT; // 5-minute ceiling per wave

// ── CLI args ──────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const MAX_WAVES = Number(args[args.indexOf('--waves') + 1] || 15);
const RUN_STRAT = args[args.indexOf('--strategy') + 1] || 'all';

// ─────────────────────────────────────────────────────────────────────────────
//  STRATEGIES
//  Each strategy is a buy-list executed in order.  Between waves the simulator
//  spends available gold on the next item(s) in the list until gold runs out.
//  Towers whose placement would block the only path are automatically skipped.
// ─────────────────────────────────────────────────────────────────────────────
//
//  Grid layout reference (20 cols × 13 rows, spawn=(0,6) exit=(19,6)):
//
//    col:   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19
//    row 0  S  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
//    row 6  >spawn                                              exit>   E
//    row12  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
//
//  Zig-zag maze pattern (half-walls alternating top/bottom):
//    col  4: rows 7-12   forces path UP  through rows 0-6
//    col  8: rows 0-5    forces path DOWN through rows 6-12
//    col 12: rows 7-12   forces path UP
//    col 16: rows 0-5    forces path DOWN → exit at row 6

const STRATEGIES = {

  // ── 0: Bare — no towers ──────────────────────────────────────────────────
  'bare': {
    label: 'Bare — no towers (raw enemy scaling test)',
    buyList: [],
  },

  // ── 1: Basic wall — just a few basics near the path ──────────────────────
  'basic-wall': {
    label: 'Basic wall — 6 basic towers flanking the direct path',
    buyList: [
      // Two columns of 3 towers flanking the path row
      { col: 5,  row: 4, type: 'basic' }, { col: 5,  row: 5, type: 'basic' },
      { col: 5,  row: 7, type: 'basic' }, { col: 5,  row: 8, type: 'basic' },
      { col: 10, row: 4, type: 'basic' }, { col: 10, row: 8, type: 'basic' },
      { col: 15, row: 5, type: 'basic' }, { col: 15, row: 7, type: 'basic' },
    ],
  },

  // ── 2: Mixed maze — complete walls one at a time, then support towers ────────
  'mixed-maze': {
    label: 'Mixed maze — completes zig-zag walls one at a time + support',
    buyList: [
      // Wall A: col 4, rows 12→7 (bottom half)  — complete before moving on
      { col: 4, row: 12, type: 'basic' }, { col: 4, row: 11, type: 'basic' },
      { col: 4, row: 10, type: 'basic' }, { col: 4, row:  9, type: 'basic' },
      { col: 4, row:  8, type: 'basic' }, { col: 4, row:  7, type: 'basic' },
      // Wall B: col 8, rows 0→5 (top half)
      { col: 8, row:  0, type: 'basic' }, { col: 8, row:  1, type: 'basic' },
      { col: 8, row:  2, type: 'basic' }, { col: 8, row:  3, type: 'basic' },
      { col: 8, row:  4, type: 'basic' }, { col: 8, row:  5, type: 'basic' },
      // Wall C: col 12, rows 12→7
      { col: 12, row: 12, type: 'basic' }, { col: 12, row: 11, type: 'basic' },
      { col: 12, row: 10, type: 'basic' }, { col: 12, row:  9, type: 'basic' },
      { col: 12, row:  8, type: 'basic' }, { col: 12, row:  7, type: 'basic' },
      // Wall D: col 16, rows 0→5
      { col: 16, row:  0, type: 'basic' }, { col: 16, row:  1, type: 'basic' },
      { col: 16, row:  2, type: 'basic' }, { col: 16, row:  3, type: 'basic' },
      { col: 16, row:  4, type: 'basic' }, { col: 16, row:  5, type: 'basic' },
      // Support: snipers at elbow corners once walls are up
      { col: 3,  row:  1, type: 'sniper' }, { col: 9,  row: 11, type: 'sniper' },
      { col: 11, row:  1, type: 'sniper' }, { col: 15, row: 11, type: 'sniper' },
      // Slow towers at path choke points
      { col: 5,  row:  0, type: 'slow' },  { col: 7,  row: 12, type: 'slow' },
      { col: 13, row:  0, type: 'slow' },  { col: 15, row: 12, type: 'slow' },
    ],
  },

  // ── 3: Sniper-slow — high-value tower focus, lighter wall ────────────────
  'sniper-slow': {
    label: 'Sniper + Slow — fewer walls, high-DPS towers',
    buyList: [
      { col: 5,  row:  7, type: 'basic' }, { col: 5,  row:  8, type: 'basic' },
      { col: 5,  row:  9, type: 'basic' }, { col: 5,  row: 10, type: 'basic' },
      { col: 10, row:  3, type: 'basic' }, { col: 10, row:  4, type: 'basic' },
      { col: 10, row:  5, type: 'basic' }, { col: 10, row:  4, type: 'basic' },
      { col: 15, row:  7, type: 'basic' }, { col: 15, row:  8, type: 'basic' },
      { col: 3,  row:  3, type: 'sniper' }, { col: 7,  row:  9, type: 'sniper' },
      { col: 11, row:  3, type: 'sniper' }, { col: 14, row:  9, type: 'sniper' },
      { col: 4,  row:  6, type: 'slow'   }, { col: 9,  row:  6, type: 'slow'   },
      { col: 13, row:  6, type: 'slow'   }, { col: 17, row:  6, type: 'slow'   },
    ],
  },

  // ── 4: Greedy maze — greedily maximises path length each wave (basic only) ─
  'greedy-maze': {
    label: 'Greedy maze — max 25 towers, picks placement to maximise path length',
    buyList: [],
    greedy: 'basic',
    maxTowers: 25,
  },

  // ── 5: Greedy mixed — greedy maze + sniper/slow after maze is saturated ────
  'greedy-mixed': {
    label: 'Greedy mixed — 20 basic maze walls then sniper/slow support',
    buyList: [],
    greedy: 'basic',
    maxTowers: 20,
    // Once maxTowers is reached, leftover gold buys support towers (handled below)
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  GameSim — runs one full playthrough with a given strategy
// ─────────────────────────────────────────────────────────────────────────────
class GameSim {
  constructor(strategy) {
    this.strategy  = strategy;
    this.grid      = new Grid();
    this.pf        = new Pathfinder(this.grid);
    this.path      = this.pf.find(SPAWN.col, SPAWN.row, EXIT.col, EXIT.row);
    this.gold      = ECONOMY.START_GOLD;
    this.lives     = ECONOMY.LIVES;
    this.wave      = 0;
    this.kills     = 0;
    this.towers    = [];
    this.buyQueue  = [...strategy.buyList]; // items yet to be purchased
    this.nextId    = 0;

    // Spend starting gold immediately
    this._processBuyQueue();
  }

  // ── Tower management ───────────────────────────────────────────────────────
  _tryPlace(col, row, type) {
    const cost = TOWERS[type]?.cost;
    if (cost === undefined || this.gold < cost) return false;
    const cell = this.grid.get(col, row);
    if (!cell || (cell.type !== TileType.NORMAL && cell.type !== TileType.CRACKED)) return false;

    this.grid.placeTower(col, row);
    const testPath = this.pf.find(SPAWN.col, SPAWN.row, EXIT.col, EXIT.row);
    if (!testPath) {
      this.grid.get(col, row).type = TileType.NORMAL; // revert
      return false; // would block path
    }
    this.gold -= cost;
    this.towers.push(new Tower(col, row, TILE, type));
    this.path = testPath;
    return true;
  }

  _processBuyQueue() {
    while (this.buyQueue.length > 0) {
      const next = this.buyQueue[0];
      if (this.gold < TOWERS[next.type]?.cost) break;
      this.buyQueue.shift();
      this._tryPlace(next.col, next.row, next.type);
    }
  }

  /**
   * Greedy maze builder.
   * Pass 1: find the tile whose placement gives the longest A* path.
   * Pass 2 (fallback): if no single tile lengthens the path, find the open
   *   tile that is ADJACENT to an existing tower — this extends walls toward
   *   a complete barrier which will pay off on future placements.
   * Repeats until gold runs out or no valid move exists.
   */
  _greedyBuild(towerType = 'basic') {
    const cost     = TOWERS[towerType]?.cost ?? 30;
    const maxTow   = this.strategy.maxTowers ?? Infinity;
    while (this.gold >= cost && this.towers.length < maxTow) {
      let bestCol = -1, bestRow = -1, bestLen = this.path.length;
      let wallCol = -1, wallRow = -1, wallBestAdj = -1;

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const cell = this.grid.get(x, y);
          if (!cell || cell.type !== TileType.NORMAL) continue;

          // Tentative placement
          cell.type = TileType.TOWER;
          const p = this.pf.find(SPAWN.col, SPAWN.row, EXIT.col, EXIT.row);
          cell.type = TileType.NORMAL;

          if (!p) continue; // would block path

          if (p.length > bestLen) {
            bestLen = p.length;
            bestCol = x; bestRow = y;
          }

          // Wall-extension fallback: prefer tiles with the most adjacent towers
          const adjCount = this._adjacentTowerCount(x, y);
          if (adjCount > wallBestAdj) {
            wallBestAdj = adjCount;
            wallCol = x; wallRow = y;
          }
        }
      }

      // Use best lengthening move; fall back to wall-extension
      const col = bestCol !== -1 ? bestCol : wallCol;
      const row = bestCol !== -1 ? bestRow : wallRow;
      if (col === -1) break;
      if (!this._tryPlace(col, row, towerType)) break;
    }
  }

  _adjacentTowerCount(x, y) {
    let n = 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      if (this.grid.get(x + dx, y + dy)?.type === TileType.TOWER) n++;
    }
    return n;
  }

  // ── Per-enemy repath (mirrors GameScene._repathEnemy) ─────────────────────
  _repathEnemy(enemy) {
    const tx = Math.floor(enemy.wx / TILE);
    const ty = Math.floor(enemy.wy / TILE);
    let p = this.pf.find(tx, ty, EXIT.col, EXIT.row);
    if (!p) {
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        p = this.pf.find(tx + dx, ty + dy, EXIT.col, EXIT.row);
        if (p) break;
      }
    }
    if (p) enemy.repath(p);
  }

  // ── Global repath (mirrors GameScene._repath) ─────────────────────────────
  _repath(enemies) {
    let p = this.pf.find(SPAWN.col, SPAWN.row, EXIT.col, EXIT.row);
    if (!p && this.path) {
      for (const node of this.path) {
        const cell = this.grid.get(node.x, node.y);
        if (cell?.type === TileType.COLLAPSED) {
          cell.type     = TileType.CRACKED;
          cell.pressure = PRESSURE.COLLAPSE_AT - 1;
        }
      }
      p = this.pf.find(SPAWN.col, SPAWN.row, EXIT.col, EXIT.row);
    }
    if (p) {
      this.path = p;
      for (const e of enemies) this._repathEnemy(e);
    }
  }

  // ── Simulate one wave; returns stats object ───────────────────────────────
  simulateWave() {
    // Greedy strategies rebuild between waves
    if (this.strategy.greedy) {
      this._greedyBuild(this.strategy.greedy);
    }

    this.wave++;
    const count       = WAVE.BASE_COUNT + (this.wave - 1) * WAVE.COUNT_INCR;
    const enemyStats  = {
      speed:           ENEMY.BASE_SPEED + this.wave * ENEMY.SPEED_INCR,
      hp:              ENEMY.BASE_HP    + this.wave * ENEMY.HP_INCR,
      pressurePerStep: PRESSURE.PER_STEP * (1 + (this.wave - 1) * ENEMY.PRESSURE_SCALE),
      reward:          ECONOMY.KILL_REWARD,
    };

    let enemies    = [];
    let spawnTimer = 0;
    let remaining  = count;
    let waveKills  = 0;
    let waveEscape = 0;
    let collapses  = 0;

    for (let tick = 0; tick < MAX_TICKS; tick++) {
      // ── Spawn ──────────────────────────────────────────────────────────────
      spawnTimer -= SIM_DT;
      if (spawnTimer <= 0 && remaining > 0 && this.path?.length) {
        enemies.push(new Enemy(this.nextId++, this.path, TILE, enemyStats));
        remaining--;
        spawnTimer = WAVE.SPAWN_DELAY;
      }

      // ── Move enemies ───────────────────────────────────────────────────────
      let needRepath = false;
      for (const e of enemies) {
        e.update(SIM_DT, this.grid, (cx, cy) => {
          needRepath = true;
          const c = this.grid.get(cx, cy);
          if (c?.type === TileType.COLLAPSED) collapses++;
        });
      }
      if (needRepath) this._repath(enemies);

      // ── Towers fire ────────────────────────────────────────────────────────
      for (const t of this.towers) t.update(SIM_DT, enemies);

      // ── Exits & kills ──────────────────────────────────────────────────────
      enemies = enemies.filter(e => {
        if (e.reached) {
          waveEscape++;
          this.lives--;
          e.dead = true;
          return false;
        }
        if (e.dead) {
          waveKills++;
          this.kills++;
          this.gold += e.reward;
          return false;
        }
        return true;
      });

      if (this.lives <= 0) {
        return { count, kills: waveKills, escaped: waveEscape, collapses, pathLen: this.path?.length ?? 0, gameOver: true };
      }

      if (remaining === 0 && enemies.length === 0) {
        this.grid.dissipate();
        const bonus = ECONOMY.WAVE_BONUS_BASE + this.wave * ECONOMY.WAVE_BONUS_INCR;
        this.gold += bonus;
        const p = this.pf.find(SPAWN.col, SPAWN.row, EXIT.col, EXIT.row);
        if (p) this.path = p;
        this._processBuyQueue();
        return { count, kills: waveKills, escaped: waveEscape, collapses, bonus, pathLen: this.path?.length ?? 0, gameOver: false };
      }
    }
    return { count, kills: waveKills, escaped: waveEscape + remaining + enemies.length, collapses, pathLen: this.path?.length ?? 0, gameOver: false, timeout: true };
  }

  // ── Run all waves ──────────────────────────────────────────────────────────
  run(maxWaves) {
    const rows = [];
    for (let i = 0; i < maxWaves; i++) {
      const r = this.simulateWave();
        rows.push({ wave: this.wave, lives: this.lives, gold: this.gold, towers: this.towers.length, pathLen: r.pathLen, ...r });
      if (r.gameOver) break;
    }
    return rows;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pretty printing
// ─────────────────────────────────────────────────────────────────────────────
function pad(str, n, right = false) {
  str = String(str);
  return right ? str.padStart(n) : str.padEnd(n);
}

function printTable(rows) {
  const HDR = ['Wave', 'Count', 'Killed', 'Escaped', 'Lives', 'Gold', 'Towers', 'PathLen', 'Result'];
  const W   = [5, 6, 8, 8, 6, 7, 7, 8, 16];
  const sep = W.map(w => '─'.repeat(w)).join('─┼─');

  console.log('  ' + HDR.map((h, i) => pad(h, W[i])).join(' │ '));
  console.log('  ' + sep);

  for (const r of rows) {
    const killPct = Math.round((r.kills / r.count) * 100);
    const result  = r.gameOver
      ? '✗ GAME OVER'
      : r.escaped === 0
        ? '✓ Perfect'
        : r.timeout
          ? '⏱ Timeout'
          : `⚠ ${r.escaped} leaked`;

    const livesStr = r.lives <= 5 ? `!${r.lives}!` : String(r.lives);

    console.log('  ' + [
      pad(r.wave,                    W[0], true),
      pad(r.count,                   W[1], true),
      pad(`${r.kills}(${killPct}%)`, W[2]),
      pad(r.escaped,                 W[3], true),
      pad(livesStr,                  W[4], true),
      pad(`$${r.gold}`,              W[5], true),
      pad(r.towers,                  W[6], true),
      pad(r.pathLen ?? '?',          W[7], true),
      pad(result,                    W[8]),
    ].join(' │ '));
  }
}

function assess(rows, strategy) {
  const survived = rows.filter(r => !r.gameOver).length;
  const total    = rows.length;
  const allPerfect  = rows.every(r => r.escaped === 0);
  const totalLeaked = rows.reduce((s, r) => s + r.escaped, 0);
  const diedWave = rows.find(r => r.gameOver)?.wave ?? null;

  console.log('');
  console.log('  ── Assessment ───────────────────────────────────────────────');

  if (allPerfect) {
    console.log('  ★ TOO EASY — zero leaks through all waves.');
    console.log('    Suggestions: ↑ ENEMY.HP_INCR, ↑ ENEMY.SPEED_INCR, ↑ WAVE.COUNT_INCR');
  } else if (diedWave !== null && diedWave <= 5) {
    console.log(`  ✗ TOO HARD — game over on wave ${diedWave}.`);
    console.log('    Suggestions: ↓ ENEMY.HP_INCR, ↓ ENEMY.SPEED_INCR, ↑ ECONOMY.START_GOLD');
  } else if (diedWave !== null) {
    console.log(`  ~ GOOD CHALLENGE — survived ${survived - 1} waves, died on wave ${diedWave}.`);
    if (totalLeaked > ECONOMY.LIVES * 0.5) {
      console.log('    Consider: slightly ↓ ENEMY.HP_INCR for more breathing room in mid-game');
    }
  } else {
    console.log(`  ~ Survived all ${total} waves. ${totalLeaked} total leaks.`);
    if (totalLeaked < 5) {
      console.log('    Suggestions: ↑ ENEMY.HP_INCR or ↑ WAVE.COUNT_INCR to add late-game pressure');
    }
  }
  console.log('');
  console.log(`  Total kills: ${rows.reduce((s, r) => s + r.kills, 0)}  |  Total leaked: ${totalLeaked}  |  Waves: ${survived}/${MAX_WAVES}`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────
function runStrategy(key) {
  const strat = STRATEGIES[key];
  if (!strat) { console.error(`Unknown strategy: ${key}`); return; }

  const width = 76;
  console.log('');
  console.log('╔' + '═'.repeat(width) + '╗');
  console.log('║  ADAPTIVE MAZE TD — DIFFICULTY SIMULATOR' + ' '.repeat(width - 42) + '║');
  console.log('╠' + '═'.repeat(width) + '╣');
  console.log(`║  Strategy : ${pad(strat.label, width - 14)}║`);
  console.log(`║  Waves    : ${pad(MAX_WAVES, width - 14)}║`);
  console.log(`║  Sim tick : ${pad(SIM_DT + ' ms', width - 14)}║`);
  console.log('╚' + '═'.repeat(width) + '╝');
  console.log('');

  const sim  = new GameSim(strat);
  console.log(`  Towers placed at start: ${sim.towers.length} (gold after purchase: $${sim.gold})`);
  console.log('');

  const rows = sim.run(MAX_WAVES);
  printTable(rows);
  assess(rows, strat);
}

const toRun = RUN_STRAT === 'all' ? Object.keys(STRATEGIES) : [RUN_STRAT];
for (const key of toRun) runStrategy(key);
