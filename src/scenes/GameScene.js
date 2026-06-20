import Phaser from 'phaser';
import {
  COLS, ROWS, TILE, UI_W, W, H,
  SPAWN, EXIT, PRESSURE, ECONOMY, WAVE,
} from '../config.js';
import { Grid, TileType } from '../systems/Grid.js';
import { Pathfinder }     from '../systems/Pathfinder.js';
import { Enemy }          from '../entities/Enemy.js';
import { Tower }          from '../entities/Tower.js';

// ── Tile colours ─────────────────────────────────────────────────────────────
const TC = {
  [TileType.NORMAL]:    0x2d4a2d,
  [TileType.SPAWN]:     0x005577,
  [TileType.EXIT]:      0x660044,
  [TileType.TOWER]:     0x1b2d3e,
  [TileType.CRACKED]:   0x5c3a1a,
  [TileType.COLLAPSED]: 0x111111,
};

export class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  // ────────────────────────────────────────────────────────────────────────────
  create() {
    // Core systems
    this.grid = new Grid();
    this.pf   = new Pathfinder(this.grid);
    this.path = this.pf.find(SPAWN.col, SPAWN.row, EXIT.col, EXIT.row);

    // Game state
    this.towers       = [];
    this.enemies      = [];
    this.shots        = [];   // visual "bullet flash" lines drawn this frame
    this.gold         = ECONOMY.START_GOLD;
    this.lives        = ECONOMY.LIVES;
    this.wave         = 0;
    this.waveActive   = false;
    this.pendingSpawn = 0;
    this.spawnTimer   = 0;
    this.nextEnemyId  = 0;
    this.gameRunning  = true;

    // UI state
    this.placingTower  = false;
    this.demolishMode  = false;
    this.showPressure  = true;
    this.hovCol        = -1;
    this.hovRow        = -1;
    this.notifTimer    = 0;

    // ── Graphics layers (draw order = creation order) ────────────────────────
    this.gTiles    = this.add.graphics();
    this.gPressure = this.add.graphics();
    this.gPath     = this.add.graphics();
    this.gTowers   = this.add.graphics();
    this.gEntities = this.add.graphics();

    // ── Static UI panel ───────────────────────────────────────────────────────
    const panel = this.add.graphics();
    panel.fillStyle(0x090f1c, 1);
    panel.fillRect(COLS * TILE, 0, UI_W, H);
    panel.lineStyle(1, 0x334466, 1);
    panel.lineBetween(COLS * TILE, 0, COLS * TILE, H);

    // ── Spawn / Exit labels ───────────────────────────────────────────────────
    this.add.text(SPAWN.col * TILE + 4, SPAWN.row * TILE + 2, 'S',
      { fontSize: '13px', fill: '#66ddff', fontStyle: 'bold' });
    this.add.text(EXIT.col  * TILE + 4, EXIT.row  * TILE + 2, 'E',
      { fontSize: '13px', fill: '#ff88cc', fontStyle: 'bold' });

    // ── HUD text ──────────────────────────────────────────────────────────────
    const px = COLS * TILE + 14;
    this.add.text(px, 10, '⚡ Adaptive Maze TD',
      { fontSize: '14px', fill: '#8899ff', fontStyle: 'bold' });

    this.txtGold   = this.add.text(px, 38, '',
      { fontSize: '15px', fill: '#ffd700' });
    this.txtLives  = this.add.text(px, 60, '',
      { fontSize: '15px', fill: '#ff8888' });
    this.txtWave   = this.add.text(px, 82, '',
      { fontSize: '15px', fill: '#88ddff' });
    this.txtStatus = this.add.text(px, 116, '',
      { fontSize: '12px', fill: '#cccccc', wordWrap: { width: UI_W - 28 } });

    // ── Buttons ───────────────────────────────────────────────────────────────
    this.btnTower  = this._btn(px, 208, '🔧 Place Tower [$30]', '#4488ff', '#0d1e33',
      () => this._togglePlace());
    this.btnDemol  = this._btn(px, 258, '🔨 Demolish',           '#ff8844', '#2a1000',
      () => this._toggleDemolish());
    this.btnWave   = this._btn(px, 308, '▶  Start Wave',         '#44ff88', '#0d2211',
      () => this._startWave());
    this.btnPres   = this._btn(px, 358, '🌡 Pressure: ON',        '#ffaa44', '#221100',
      () => this._togglePressure());

    // ── Legend ────────────────────────────────────────────────────────────────
    this.add.text(px, H - 196,
      'Controls:\n' +
      '  Click  – place/demolish\n' +
      '  P      – pressure overlay\n' +
      '  ESC    – cancel mode\n\n' +
      'Demolish:\n' +
      '  Tower  – remove (50% refund)\n' +
      '  Black  – clear collapsed tile\n\n' +
      'Tile key:\n' +
      '  ■ Green   – normal\n' +
      '  ■ Brown   – cracked\n' +
      '  ■ Black   – collapsed\n' +
      '  ■ Dark    – tower\n' +
      '  Cyan line – enemy path',
      { fontSize: '11px', fill: '#778899', lineSpacing: 2 });

    // ── Floating notification (centred over grid) ────────────────────────────
    this.txtNotif = this.add.text(COLS * TILE / 2, 18, '',
      { fontSize: '20px', fill: '#ff4444', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0.5, 0)
      .setDepth(20);

    // ── Mode banner (bottom of grid, always visible when a mode is active) ───
    this.txtMode = this.add.text(COLS * TILE / 2, H - 6, '',
      { fontSize: '13px', fill: '#ffffff', fontStyle: 'bold',
        backgroundColor: '#000000cc', padding: { x: 14, y: 5 } })
      .setOrigin(0.5, 1)
      .setDepth(18);

    // ── Collapse flash graphics (above everything) ────────────────────────────
    this.gFlash = this.add.graphics().setDepth(15);

    // ── Input ─────────────────────────────────────────────────────────────────
    this.input.on('pointermove', ptr => {
      this.hovCol = Math.floor(ptr.x / TILE);
      this.hovRow = Math.floor(ptr.y / TILE);
    });
    this.input.on('pointerdown', ptr => this._onPointerDown(ptr));
    this.input.keyboard.on('keydown-P',   () => this._togglePressure());
    this.input.keyboard.on('keydown-ESC', () => {
      if (this.placingTower) this._togglePlace();
      else if (this.demolishMode) this._toggleDemolish();
    });

    // Initial render
    this._drawTiles();
    this._drawPath();
    this._refreshHUD();
  }

  // ── Button factory ────────────────────────────────────────────────────────
  _btn(x, y, label, fg, bg, cb) {
    const b = this.add.text(x, y, label, {
      fontSize: '13px', fill: fg, backgroundColor: bg,
      padding: { x: 10, y: 7 },
    }).setInteractive({ useHandCursor: true });
    b.on('pointerdown', cb);
    b.on('pointerover',  () => b.setAlpha(0.75));
    b.on('pointerout',   () => b.setAlpha(1));
    return b;
  }

  // ── UI helpers ────────────────────────────────────────────────────────────
  _togglePlace() {
    this.demolishMode = false;
    this.btnDemol.setStyle({ fill: '#ff8844' });
    this.placingTower = !this.placingTower;
    this.btnTower.setStyle({ fill: this.placingTower ? '#ffff44' : '#4488ff' });
    if (this.placingTower) {
      this._setStatus(`Tower: $${ECONOMY.TOWER_COST}\nClick an empty tile.`);
      this.txtMode.setText('🔧  BUILDING — green tiles are buildable  ·  ESC to cancel')
        .setStyle({ fill: '#88ff88' });
    } else {
      this._setStatus('');
      this.txtMode.setText('');
    }
  }

  _toggleDemolish() {
    this.placingTower = false;
    this.btnTower.setStyle({ fill: '#4488ff' });
    this.demolishMode = !this.demolishMode;
    this.btnDemol.setStyle({ fill: this.demolishMode ? '#ffff44' : '#ff8844' });
    if (this.demolishMode) {
      this._setStatus('Demolish mode:\nClick tower → sell (50% refund)\nClick collapsed → clear tile');
      this.txtMode.setText('🔨  DEMOLISH — orange tiles can be removed  ·  ESC to cancel')
        .setStyle({ fill: '#ffaa44' });
    } else {
      this._setStatus('');
      this.txtMode.setText('');
    }
  }

  _togglePressure() {
    this.showPressure = !this.showPressure;
    this.btnPres.setText(`🌡 Pressure: ${this.showPressure ? 'ON' : 'OFF'}`);
    if (!this.showPressure) this.gPressure.clear();
  }

  _setStatus(msg) { this.txtStatus.setText(msg); }

  _notify(msg, ms = 2200) {
    this.txtNotif.setText(msg);
    this.notifTimer = ms;
  }

  _refreshHUD() {
    this.txtGold.setText(`💰 Gold:  $${this.gold}`);
    this.txtLives.setText(`❤  Lives: ${this.lives}`);
    this.txtWave.setText(`🌊 Wave:  ${this.wave}`);
  }

  // ── Wave management ───────────────────────────────────────────────────────
  _startWave() {
    if (this.waveActive || !this.gameRunning) return;
    if (!this.path?.length) {
      this._setStatus('⚠ No path to exit!\nRemove a tower first.');
      return;
    }
    this.wave++;
    this.waveActive   = true;
    this.pendingSpawn = WAVE.BASE_COUNT + (this.wave - 1) * WAVE.COUNT_INCR;
    this.spawnTimer   = 0;
    this.btnWave.setStyle({ fill: '#556655' });
    this._setStatus(`Wave ${this.wave}\n${this.pendingSpawn} enemies incoming!`);
    this._notify(`⚔ Wave ${this.wave}!`, 1500);
  }

  _spawnEnemy() {
    if (!this.path?.length) return;
    const e = new Enemy(this.nextEnemyId++, this.path, TILE, {
      speed:           68 + this.wave * 7,
      hp:              55 + this.wave * 28,
      pressurePerStep: PRESSURE.PER_STEP * (1 + (this.wave - 1) * 0.08),
      reward:          ECONOMY.KILL_REWARD,
    });
    this.enemies.push(e);
  }

  _repath() {
    let p = this.pf.find(SPAWN.col, SPAWN.row, EXIT.col, EXIT.row);

    // If a collapse just sealed the only path, revert the blocking tile(s) to
    // cracked so the game never permanently deadlocks. The tile stays at high
    // pressure and cost — it still hurts, just doesn't fully seal.
    if (!p && this.path) {
      for (const node of this.path) {
        const cell = this.grid.get(node.x, node.y);
        if (cell?.type === TileType.COLLAPSED) {
          cell.type     = TileType.CRACKED;
          cell.pressure = PRESSURE.COLLAPSE_AT - 1; // keep near-collapse pressure
        }
      }
      p = this.pf.find(SPAWN.col, SPAWN.row, EXIT.col, EXIT.row);
      if (p) this._notify('⚠ Critical path held — barely standing!', 2800);
    }

    this.path = p;
    for (const e of this.enemies) e.repath(p);
  }

  _waveEnd() {
    this.waveActive = false;
    const bonus = 20 + this.wave * 8;
    this.gold += bonus;
    this.grid.dissipate();
    this._repath();
    this.btnWave.setStyle({ fill: '#44ff88' });
    this._setStatus(`Wave ${this.wave} complete!\n+$${bonus} bonus\nPressure fading…`);
    this._notify(`✔ Wave ${this.wave} Done  +$${bonus}`, 2200);
  }

  _gameOver() {
    this.gameRunning = false;
    this.waveActive  = false;
    this._notify('💀 GAME OVER', 999999);
    this._setStatus('Lives depleted.\nRefresh to restart.');
    this.time.delayedCall(400, () => this.scene.pause());
  }

  // ── Pointer input ────────────────────────────────────────────────────────
  _onPointerDown(ptr) {
    if (!this.gameRunning) return;

    const col = Math.floor(ptr.x / TILE);
    const row = Math.floor(ptr.y / TILE);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;

    if (this.demolishMode) {
      this._handleDemolish(col, row);
      return;
    }

    if (!this.placingTower) return;
    this._handlePlace(col, row);
  }

  _handleDemolish(col, row) {
    const cell = this.grid.get(col, row);
    if (!cell) return;

    if (cell.type === TileType.TOWER) {
      // Remove the tower object, restore tile, refund 50%
      this.towers = this.towers.filter(t => !(t.col === col && t.row === row));
      cell.type     = TileType.NORMAL;
      cell.pressure = 0;
      const refund = Math.floor(ECONOMY.TOWER_COST * 0.5);
      this.gold += refund;
      this._repath();
      this._setStatus(`Tower sold.\n+$${refund} refund`);
      return;
    }

    if (cell.type === TileType.COLLAPSED) {
      // Clear the rubble — free recovery action
      cell.type     = TileType.NORMAL;
      cell.pressure = 0;
      this._repath();
      this._setStatus('Collapsed tile cleared.');
      return;
    }

    this._setStatus('Nothing to demolish here.');
  }

  _handlePlace(col, row) {
    if (this.gold < ECONOMY.TOWER_COST) {
      this._setStatus('💰 Not enough gold!');
      return;
    }
    const cell = this.grid.get(col, row);
    if (!cell || (cell.type !== TileType.NORMAL && cell.type !== TileType.CRACKED)) {
      this._setStatus('❌ Cannot place here.');
      return;
    }

    // Tentatively place, then verify a path still exists
    this.grid.placeTower(col, row);
    const testPath = this.pf.find(SPAWN.col, SPAWN.row, EXIT.col, EXIT.row);
    if (!testPath) {
      this.grid.get(col, row).type = TileType.NORMAL; // revert
      this._setStatus('🚫 Would block all paths!');
      return;
    }

    // Commit placement
    this.gold -= ECONOMY.TOWER_COST;
    this.towers.push(new Tower(col, row, TILE));
    this.path = testPath;
    for (const e of this.enemies) e.repath(testPath);
    this._setStatus(`Tower placed!\n💰 $${this.gold} remaining`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  update(_time, delta) {
    if (!this.gameRunning) return;

    // Notification timer
    if (this.notifTimer > 0) {
      this.notifTimer -= delta;
      if (this.notifTimer <= 0) this.txtNotif.setText('');
    }

    // ── Spawn ────────────────────────────────────────────────────────────────
    if (this.waveActive && this.pendingSpawn > 0) {
      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0) {
        this._spawnEnemy();
        this.pendingSpawn--;
        this.spawnTimer = WAVE.SPAWN_DELAY;
      }
    }

    // ── Update enemies, detect tile changes ──────────────────────────────────
    let needRepath = false;
    let collapseFlashes = [];
    let towersDestroyed = 0;
    for (const e of this.enemies) {
      e.update(delta, this.grid, (cx, cy) => {
        needRepath = true;
        const c = this.grid.get(cx, cy);
        if (c?.type === TileType.COLLAPSED) {
          collapseFlashes.push({ x: cx, y: cy });
          towersDestroyed += this._splashTowers(cx, cy, collapseFlashes);
        }
      });
    }
    if (needRepath) this._repath();

    // Brief white flash on collapsed tiles (and any towers they took with them)
    if (collapseFlashes.length) {
      this._flashCollapse(collapseFlashes);
      const msg = towersDestroyed > 0
        ? `💥 Collapse! ${towersDestroyed} tower${towersDestroyed > 1 ? 's' : ''} destroyed!`
        : '💥 Tile Collapsed!';
      this._notify(msg, 2200);
    }

    // ── Handle exits & deaths ─────────────────────────────────────────────────
    for (const e of this.enemies) {
      if (e.reached) {
        this.lives--;
        e.dead = true;
        if (this.lives <= 0) { this._gameOver(); return; }
      }
    }
    this.enemies = this.enemies.filter(e => !e.dead && !e.reached);

    // ── Towers shoot ─────────────────────────────────────────────────────────
    this.shots = [];
    for (const t of this.towers) {
      const shot = t.update(delta, this.enemies);
      if (shot) this.shots.push(shot);
    }

    // Collect gold for enemies killed this frame
    this.enemies = this.enemies.filter(e => {
      if (e.dead) { this.gold += e.reward; return false; }
      return true;
    });

    // ── Wave complete? ────────────────────────────────────────────────────────
    if (this.waveActive && this.pendingSpawn === 0 && this.enemies.length === 0) {
      this._waveEnd();
    }

    // ── Render ────────────────────────────────────────────────────────────────
    this._drawTiles();
    if (this.showPressure) this._drawPressure(); else this.gPressure.clear();
    this._drawPath();
    this._drawTowers();
    this._drawEntities();
    this._refreshHUD();
  }

  // ── Collapse splash: destroy all towers adjacent to a collapsed tile ────────
  // Returns the number of towers destroyed.
  _splashTowers(col, row, flashList) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = col + dx, ny = row + dy;
        const cell = this.grid.get(nx, ny);
        if (!cell || cell.type !== TileType.TOWER) continue;

        // Destroy this tower — no refund, it was caught in the collapse
        this.towers = this.towers.filter(t => !(t.col === nx && t.row === ny));
        cell.type     = TileType.CRACKED;           // rubble, not clean ground
        cell.pressure = PRESSURE.CRACK_AT + 5;      // stays visually damaged
        flashList.push({ x: nx, y: ny });
        count++;
      }
    }
    return count;
  }

  // ── Collapse flash ────────────────────────────────────────────────────────
  _flashCollapse(tiles) {
    const g = this.gFlash;
    g.clear();
    for (const { x, y } of tiles) {
      g.fillStyle(0xffffff, 0.7);
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
    this.time.delayedCall(120, () => g.clear());
  }

  // ── Draw: tiles ──────────────────────────────────────────────────────────
  _drawTiles() {
    const g = this.gTiles;
    g.clear();

    const isHovInGrid = this.hovCol >= 0 && this.hovCol < COLS &&
                        this.hovRow >= 0 && this.hovRow < ROWS;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const cell  = this.grid.cells[y][x];
        const color = TC[cell.type] ?? 0x2d4a2d;

        // Base tile
        g.fillStyle(color, 1);
        g.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);

        // Grid line
        g.lineStyle(0.5, 0x1c3a1c, 0.6);
        g.strokeRect(x * TILE, y * TILE, TILE, TILE);

        const isPlaceable    = cell.type === TileType.NORMAL || cell.type === TileType.CRACKED;
        const isDemolishable = cell.type === TileType.TOWER  || cell.type === TileType.COLLAPSED;

        // ── Zone tinting: show the entire interactive area at a glance ─────
        if (this.placingTower && isPlaceable) {
          g.fillStyle(0x44ff44, 0.10);
          g.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
        }
        if (this.demolishMode && isDemolishable) {
          g.fillStyle(0xff8800, 0.18);
          g.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
        }

        // ── Hover feedback ────────────────────────────────────────────────
        const isHov = isHovInGrid && x === this.hovCol && y === this.hovRow;
        if (!isHov) continue;

        if (this.placingTower) {
          const canPlace = isPlaceable && this.gold >= ECONOMY.TOWER_COST;
          const hc = canPlace ? 0x44ff44 : 0xff2222;
          g.fillStyle(hc, 0.35);
          g.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
          g.lineStyle(2, hc, 1);
          g.strokeRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4);
        } else if (this.demolishMode) {
          const hc = isDemolishable ? 0xff8800 : 0x555555;
          g.fillStyle(hc, isDemolishable ? 0.40 : 0.15);
          g.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
          if (isDemolishable) {
            g.lineStyle(2, 0xff8800, 1);
            g.strokeRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4);
          }
        }
      }
    }
  }

  // ── Draw: pressure heat-map ───────────────────────────────────────────────
  _drawPressure() {
    const g = this.gPressure;
    g.clear();
    const { CRACK_AT, COLLAPSE_AT } = PRESSURE;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const p = this.grid.cells[y][x].pressure;
        if (p < 3) continue;

        let color, alpha;
        if (p < CRACK_AT) {
          const t = p / CRACK_AT;
          color = 0xffee00;
          alpha = t * 0.45;
        } else if (p < COLLAPSE_AT) {
          const t = (p - CRACK_AT) / (COLLAPSE_AT - CRACK_AT);
          // Interpolate yellow → red manually
          const g2 = Math.round(238 * (1 - t));
          color = (0xff << 16) | (g2 << 8) | 0;
          alpha = 0.45 + t * 0.30;
        } else {
          color = 0xff1100;
          alpha = 0.75;
        }

        g.fillStyle(color, alpha);
        g.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
      }
    }
  }

  // ── Draw: A* path preview ──────────────────────────────────────────────────
  _drawPath() {
    const g = this.gPath;
    g.clear();
    if (!this.path || this.path.length < 2) {
      // No path – warn visually
      g.fillStyle(0xff0000, 0.12);
      g.fillRect(0, 0, COLS * TILE, ROWS * TILE);
      return;
    }

    g.lineStyle(2.5, 0x00eeff, 0.55);
    g.beginPath();
    const s = this.path[0];
    g.moveTo(s.x * TILE + TILE / 2, s.y * TILE + TILE / 2);
    for (let i = 1; i < this.path.length; i++) {
      const n = this.path[i];
      g.lineTo(n.x * TILE + TILE / 2, n.y * TILE + TILE / 2);
    }
    g.strokePath();

    // Node dots
    g.fillStyle(0x00eeff, 0.35);
    for (const n of this.path) {
      g.fillCircle(n.x * TILE + TILE / 2, n.y * TILE + TILE / 2, 3);
    }
  }

  // ── Draw: towers ──────────────────────────────────────────────────────────
  _drawTowers() {
    const g = this.gTowers;
    g.clear();

    for (const t of this.towers) {
      const px = t.col * TILE, py = t.row * TILE;
      const hw = TILE / 2;
      const cx = px + hw, cy = py + hw;

      // Outer glow ring (makes towers distinct from collapsed black tiles)
      g.lineStyle(1.5, 0x3366aa, 0.5);
      g.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);

      // Tower base plate
      g.fillStyle(0x1e3a5a, 1);
      g.fillRect(px + 5, py + 5, TILE - 10, TILE - 10);

      // Gun barrel
      g.fillStyle(0x6699cc, 1);
      g.fillRect(cx - 3, py + 6, 6, hw - 3);

      // Centre hub
      g.fillStyle(0xaaddff, 1);
      g.fillCircle(cx, cy, 5);
      g.fillStyle(0x1e3a5a, 1);
      g.fillCircle(cx, cy, 2);

      // Range ring: always faint, brighter on hover
      const isHov = this.hovCol === t.col && this.hovRow === t.row;
      g.lineStyle(1, 0x4499ff, isHov ? 0.45 : 0.12);
      g.strokeCircle(t.wx, t.wy, t.range);
    }
  }

  // ── Draw: enemies + bullet flashes ───────────────────────────────────────
  _drawEntities() {
    const g = this.gEntities;
    g.clear();

    // Bullet flash lines
    for (const s of this.shots) {
      g.lineStyle(1.5, 0xffff55, 0.85);
      g.beginPath();
      g.moveTo(s.from.x, s.from.y);
      g.lineTo(s.to.x, s.to.y);
      g.strokePath();
      // Impact dot
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(s.to.x, s.to.y, 3);
    }

    // Enemies
    for (const e of this.enemies) {
      const r = TILE * 0.27;

      // Shadow
      g.fillStyle(0x000000, 0.3);
      g.fillCircle(e.wx + 2, e.wy + 3, r);

      // Body
      const pct = e.hp / e.maxHp;
      const bodyColor = pct > 0.5
        ? 0xdd2222
        : pct > 0.25 ? 0xff7700 : 0xff0066;
      g.fillStyle(bodyColor, 1);
      g.fillCircle(e.wx, e.wy, r);

      // HP bar
      const bw = TILE * 0.72, bh = 4;
      const bx = e.wx - bw / 2, by = e.wy - r - 8;
      g.fillStyle(0x331111, 0.85);
      g.fillRect(bx, by, bw, bh);
      g.fillStyle(0x22ee44, 0.9);
      g.fillRect(bx, by, bw * pct, bh);
    }
  }
}
