import Phaser from 'phaser';
import {
  COLS, ROWS, TILE, UI_W, W, H,
  SPAWN, EXIT, PRESSURE, ECONOMY, WAVE, TOWERS, ENEMY, MASTER, CREEP_TYPES,
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
    this.kills        = 0;
    this.wave         = 0;
    this.waveActive   = false;
    this.pendingSpawn = 0;
    this.spawnTimer   = 0;
    this.nextEnemyId  = 0;
    this.gameRunning  = true;

    // Kill tracker — reset each wave, used by Creep Master AI
    this.waveKills = { basic: 0, sniper: 0, slow: 0 };

    // Creep Master adaptive state — pressures scale 0–100, traits are proportional
    this.masterState = {
      physicalPressure: 0,
      slowPressure:     0,
      sniperPressure:   0,
      escalation:       0,
      // Track last milestone crossed per trait for taunt triggers
      _milestones: { physical: 0, slow: 0, sniper: 0 },
    };
    this.pendingBomber = false;

    // UI state
    this.placingTower      = false;
    this.selectedTowerType = 'basic';
    this.demolishMode      = false;
    this.showPressure      = true;
    this.hovCol            = -1;
    this.hovRow            = -1;
    this.notifTimer        = 0;

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
    this.add.text(px, 8, '⚡ Adaptive Maze TD',
      { fontSize: '14px', fill: '#8899ff', fontStyle: 'bold' });

    this.txtGold    = this.add.text(px, 30, '', { fontSize: '14px', fill: '#ffd700' });
    this.txtLives   = this.add.text(px, 48, '', { fontSize: '14px', fill: '#ff8888' });
    this.txtWave    = this.add.text(px, 66, '', { fontSize: '14px', fill: '#88ddff' });
    this.txtKills   = this.add.text(px, 84, '', { fontSize: '12px', fill: '#aaddaa' });
    this.txtEnemies = this.add.text(px, 99, '', { fontSize: '12px', fill: '#ffcc88' });

    // ── Divider ───────────────────────────────────────────────────────────────
    const divider = (y) => {
      const d = this.add.graphics();
      d.lineStyle(1, 0x334466, 0.5);
      d.lineBetween(px, y, px + UI_W - 20, y);
    };
    divider(115);

    // Status area — reserved 78px so buttons below never shift
    this.txtStatus = this.add.text(px, 119, '',
      { fontSize: '12px', fill: '#cccccc', wordWrap: { width: UI_W - 28 } });

    // ── Buttons ───────────────────────────────────────────────────────────────
    divider(200);
    this.add.text(px, 204, 'TOWERS', { fontSize: '10px', fill: '#556677' });
    this.btnBasic  = this._btn(px, 216, `[1] 🔧 Basic  $${TOWERS.basic.cost}`,  '#4488ff', '#0d1e33',
      () => this._selectTowerType('basic'));
    this.btnSniper = this._btn(px, 250, `[2] 🎯 Sniper $${TOWERS.sniper.cost}`, '#44cc44', '#0d2211',
      () => this._selectTowerType('sniper'));
    this.btnSlow   = this._btn(px, 284, `[3] ❄  Slow   $${TOWERS.slow.cost}`,  '#88aaff', '#0d1030',
      () => this._selectTowerType('slow'));

    divider(320);
    this.btnDemol  = this._btn(px, 325, '[D] 🔨 Demolish',   '#ff8844', '#2a1000',
      () => this._toggleDemolish());
    this.btnWave   = this._btn(px, 359, '[↵] Start Wave',    '#44ff88', '#0d2211',
      () => this._startWave());
    this.btnPres   = this._btn(px, 393, '[P] Pressure: ON',  '#ffaa44', '#221100',
      () => this._togglePressure());

    // ── Creep Master panel ────────────────────────────────────────────────────
    divider(428);
    this.add.text(px, 433, '👿 CREEP MASTER',
      { fontSize: '12px', fill: '#ff4444', fontStyle: 'bold' });
    this.txtMasterTaunt  = this.add.text(px, 451, '"…watching your every move…"',
      { fontSize: '10px', fill: '#cc5555', wordWrap: { width: UI_W - 28 } });
    this.txtMasterTraits = this.add.text(px, 479, 'No adaptations yet',
      { fontSize: '10px', fill: '#ffaa44', lineSpacing: 2 });

    // Highlight the default selected type
    this._highlightTowerButtons();

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
    this.input.keyboard.on('keydown-ONE',   () => this._selectTowerType('basic'));
    this.input.keyboard.on('keydown-TWO',   () => this._selectTowerType('sniper'));
    this.input.keyboard.on('keydown-THREE', () => this._selectTowerType('slow'));
    this.input.keyboard.on('keydown-D',     () => this._toggleDemolish());
    this.input.keyboard.on('keydown-U',     () => this._upgradeHoveredTower());
    this.input.keyboard.on('keydown-ESC', () => {
      if (this.placingTower) { this.placingTower = false; this._highlightTowerButtons(); this._setStatus(''); this.txtMode.setText(''); }
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

  /** Highlight the active tower-type button; dim the others. */
  _highlightTowerButtons() {
    const map = { basic: this.btnBasic, sniper: this.btnSniper, slow: this.btnSlow };
    const colors = { basic: '#4488ff', sniper: '#44cc44', slow: '#88aaff' };
    for (const [type, btn] of Object.entries(map)) {
      const active = this.placingTower && this.selectedTowerType === type;
      btn.setStyle({ fill: active ? '#ffff44' : colors[type] });
    }
  }

  /** Select a tower type and enter (or stay in) placing mode. */
  _selectTowerType(type) {
    this.demolishMode = false;
    this.btnDemol.setStyle({ fill: '#ff8844' });
    const wasSameType = this.placingTower && this.selectedTowerType === type;
    this.selectedTowerType = type;
    this.placingTower = !wasSameType;
    this._highlightTowerButtons();
    if (this.placingTower) {
      const cfg = TOWERS[type];
      this._setStatus(`${cfg.label}: $${cfg.cost}\n${this._towerStatLine(type)}\nClick an empty tile.`);
      this.txtMode.setText('🔧  BUILDING — green tiles are buildable  ·  ESC to cancel')
        .setStyle({ fill: '#88ff88' });
    } else {
      this._setStatus('');
      this.txtMode.setText('');
    }
  }

  /** One-line stat summary for a tower type. */
  _towerStatLine(type) {
    const cfg = TOWERS[type];
    const base = `Dmg ${cfg.damage}  Range ${cfg.range}px  ${cfg.fireRate}/s`;
    if (type === 'slow') return base + '  Slows on hit';
    return base;
  }

  _toggleDemolish() {
    this.placingTower = false;
    this._highlightTowerButtons();
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
    this.btnPres.setText(`[P] Pressure: ${this.showPressure ? 'ON' : 'OFF'}`);
    if (!this.showPressure) this.gPressure.clear();
  }

  _upgradeHoveredTower() {
    const t = this.towers.find(t => t.col === this.hovCol && t.row === this.hovRow);
    if (!t) return;
    const cost = t.upgradeCost();
    if (cost === null) { this._setStatus('Already max level!'); return; }
    if (this.gold < cost) { this._setStatus(`💰 Need $${cost} to upgrade!`); return; }
    this.gold -= cost;
    t.upgrade();
    this._notify(`⬆ ${TOWERS[t.type].label} → Lv${t.level}!`, 1500);
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
    this.txtKills.setText(`☠ Kills:  ${this.kills}`);
    if (this.waveActive) {
      const remaining = this.pendingSpawn + this.enemies.length;
      this.txtEnemies.setText(`⚠ Enemies: ${remaining}`);
    } else {
      this.txtEnemies.setText('');
    }
  }

  // ── Wave management ───────────────────────────────────────────────────────
  _startWave() {
    if (this.waveActive || !this.gameRunning) return;
    if (!this.path?.length) {
      this._setStatus('⚠ No path to exit!\nRemove a tower first.');
      return;
    }
    this.wave++;
    this.waveActive    = true;
    this.pendingSpawn  = WAVE.BASE_COUNT + (this.wave - 1) * WAVE.COUNT_INCR;
    this.pendingBomber = this.masterState.escalation >= 2;
    if (this.pendingBomber) this.pendingSpawn++;  // bomber is the last enemy
    this.spawnTimer = 0;
    this.btnWave.setStyle({ fill: '#556655' });

    // Pre-wave announcement
    const { physicalPressure, slowPressure, sniperPressure } = this.masterState;
    const traitBits = [];
    if (physicalPressure > 10) traitBits.push(`🛡${Math.round(physicalPressure)}%`);
    if (slowPressure     > 10) traitBits.push(`🔥${Math.round(slowPressure)}%`);
    if (sniperPressure   > 10) traitBits.push(`👻${Math.round(sniperPressure)}%`);
    let waveLabel = `⚔ Wave ${this.wave}`;
    if (traitBits.length) waveLabel += '  ' + traitBits.join(' ');
    if (this.pendingBomber) waveLabel += '  💣';
    this._notify(waveLabel + '!', 2800);
    this._setStatus(`Wave ${this.wave}\n${this.pendingSpawn} enemies incoming!`);

    // Airstrike at max escalation
    if (this.masterState.escalation >= 3 && this.towers.length > 0) {
      this._triggerAirstrike();
    }
  }

  _spawnEnemy(creepTypeName = 'normal') {
    if (!this.path?.length) return;

    // Spawn bomber as the final enemy in the wave
    if (this.pendingBomber && this.pendingSpawn === 1) {
      this._spawnBomber();
      this.pendingBomber = false;
      return;
    }

    const waveNum  = this.wave;
    const typeCfg  = CREEP_TYPES[creepTypeName] ?? CREEP_TYPES.normal;
    const { physicalPressure, slowPressure, sniperPressure } = this.masterState;
    const maxPressure = Math.max(physicalPressure, slowPressure, sniperPressure);

    // adaptRate: how quickly THIS creep learns from damage this wave
    // Higher Creep Master pressure = creeps have stronger ancestral instincts
    const adaptRate = 1.0 + (maxPressure / 100) * MASTER.PRESSURE_BOOST;

    // Generational head-start: small inherited resistance (fraction of max cap)
    // proportional to which strategy dominated recent waves
    const H = MASTER.HEADSTART_FRAC;
    const armorBuildup   = (physicalPressure / 100) * MASTER.ARMOR_MAX   * H;
    const heatBuildup    = (slowPressure     / 100) * MASTER.HEAT_MAX    * H;
    const evasionBuildup = (sniperPressure   / 100) * MASTER.EVASION_MAX * H;

    const e = new Enemy(this.nextEnemyId++, this.path, TILE, {
      speed:           (ENEMY.BASE_SPEED + waveNum * ENEMY.SPEED_INCR) * typeCfg.speedMult,
      hp:              (ENEMY.BASE_HP    + waveNum * ENEMY.HP_INCR)    * typeCfg.hpMult,
      pressurePerStep: PRESSURE.PER_STEP * (1 + (waveNum - 1) * ENEMY.PRESSURE_SCALE) * typeCfg.pressureMult,
      reward:          ECONOMY.KILL_REWARD * typeCfg.rewardMult,
      creepType:       creepTypeName,
      adaptRate,
      armorBuildup,
      heatBuildup,
      evasionBuildup,
    });

    this.enemies.push(e);
  }

  // ── Creep Master AI ──────────────────────────────────────────────────────────

  /** Called at end of each wave. Continuously adjusts pressure; traits scale proportionally. */
  _analyzeWave() {
    const { waveKills, masterState } = this;
    const total = (waveKills.basic ?? 0) + (waveKills.sniper ?? 0) + (waveKills.slow ?? 0);
    if (total === 0) { this._masterIdle(); return; }

    const physPct   = ((waveKills.basic ?? 0) + (waveKills.sniper ?? 0)) / total;
    const slowPct   = (waveKills.slow   ?? 0) / total;
    const sniperPct = (waveKills.sniper ?? 0) / total;

    const G = MASTER.PRESSURE_GAIN;
    const D = MASTER.PRESSURE_DECAY;

    const clamp = v => Math.max(0, Math.min(100, v));
    const prev = { ...masterState };

    masterState.physicalPressure = clamp(masterState.physicalPressure + (physPct   > 0.5 ? G : -D));
    masterState.slowPressure     = clamp(masterState.slowPressure     + (slowPct   > 0.5 ? G : -D));
    masterState.sniperPressure   = clamp(masterState.sniperPressure   + (sniperPct > 0.4 ? G : -D));

    // Escalation ticks every N waves
    if (this.wave % MASTER.ESCALATION_EVERY === 0) {
      masterState.escalation = Math.min(3, masterState.escalation + 1);
    }

    // Detect milestone crossings (25 / 50 / 75 / 100) for taunts
    const crossedMilestone = (now, before) => {
      for (const m of [25, 50, 75, 100]) {
        if (now >= m && before < m) return m;
      }
      return null;
    };

    const armorMilestone  = crossedMilestone(masterState.physicalPressure, prev.physicalPressure);
    const heatMilestone   = crossedMilestone(masterState.slowPressure,     prev.slowPressure);
    const evasionMilestone = crossedMilestone(masterState.sniperPressure,  prev.sniperPressure);

    this._masterTaunt(
      armorMilestone  ? { trait: 'armor',   milestone: armorMilestone }  : null,
      heatMilestone   ? { trait: 'heated',  milestone: heatMilestone }   : null,
      evasionMilestone? { trait: 'evasive', milestone: evasionMilestone }: null,
      physPct, slowPct
    );
    this._updateMasterTraitsUI();
  }

  _masterIdle() {
    const lines = [
      '"Hmm. No kills yet? Interesting strategy."',
      '"My creeps got through… or you have NO towers?"',
      '"This is too easy. I\'m not even trying yet."',
    ];
    this.txtMasterTaunt.setText(lines[this.wave % lines.length]);
  }

  _masterTaunt(armorEv, heatEv, evasionEv, physPct, slowPct) {
    const milestoneTaunts = {
      armor: {
        25:  '"A few bullets? My boys are toughening up… 💪"',
        50:  '"Halfway armored. Your guns are losing their edge."',
        75:  '"REINFORCED LEGION. Physical dmg barely tickles now."',
        100: '"FULL ARMOR. Your gun towers are basically decorations. 🛡"',
      },
      heated: {
        25:  '"A bit chilly. My boys are building heat tolerance."',
        50:  '"Freeze? Inconvenient at best. My creeps run HOT now."',
        75:  '"Your slow is almost pointless. They barely notice. 🔥"',
        100: '"FULL HEAT IMMUNITY. Slow towers are WASTED on my horde."',
      },
      evasive: {
        25:  '"A sniper? My scouts are learning your bullet patterns."',
        50:  '"Your snipers are missing more and more. Getting predictable."',
        75:  '"DODGE MASTERS. Your snipers might as well be pointing at the sky. 👻"',
        100: '"FULL EVASION. Snipers are worthless against my scouts."',
      },
    };
    const reactionTaunts = [
      '"Studying your every move…"',
      '"Interesting. I\'ll remember that."',
      '"My creeps adapt. Do you?"',
      '"You can\'t out-strategize ME."',
      '"Every kill teaches me something."',
      '"See you next wave… 😈"',
    ];

    // Pick the most significant milestone event to taunt about
    const ev = armorEv ?? heatEv ?? evasionEv;
    let taunt;
    if (ev) {
      taunt = milestoneTaunts[ev.trait]?.[ev.milestone] ?? reactionTaunts[0];
      const label = { armor: '🛡 ARMOR', heated: '🔥 HEAT', evasive: '👻 EVASION' }[ev.trait];
      const pct = ev.milestone;
      this.time.delayedCall(2600, () =>
        this._notify(`👿 ${label} ${pct}% — resistance growing!`, 3200)
      );
    } else {
      taunt = reactionTaunts[Math.floor(Math.random() * reactionTaunts.length)];
    }
    this.txtMasterTaunt.setText(taunt);
  }

  _updateMasterTraitsUI() {
    const { physicalPressure, slowPressure, sniperPressure, escalation } = this.masterState;

    const bar = pct => '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));

    const lines = [
      `🛡 ${bar(physicalPressure)} ${Math.round(physicalPressure)}%`,
      `🔥 ${bar(slowPressure)}  ${Math.round(slowPressure)}%`,
      `👻 ${bar(sniperPressure)} ${Math.round(sniperPressure)}%`,
    ];
    if (escalation >= 2) lines.push('💣 BOMBERS ACTIVE');
    if (escalation >= 3) lines.push('☄  AIRSTRIKES ACTIVE');
    this.txtMasterTraits.setText(lines.join('\n'));
  }

  /** Spawn a bomber — a slow, tanky enemy that destroys the first tower it touches. */
  _spawnBomber() {
    if (!this.path?.length) return;
    const waveNum = this.wave;
    const e = new Enemy(this.nextEnemyId++, this.path, TILE, {
      speed:           (ENEMY.BASE_SPEED + waveNum * ENEMY.SPEED_INCR) * MASTER.BOMBER_SPEED_MULT,
      hp:              (ENEMY.BASE_HP    + waveNum * ENEMY.HP_INCR)    * MASTER.BOMBER_HP_MULT,
      pressurePerStep: PRESSURE.PER_STEP * 2,
      reward:          ECONOMY.KILL_REWARD * 3,
    });
    e.mode = 'bomber';

    // Tag the nearest tower as target (for display)
    if (this.towers.length > 0) {
      const sx = SPAWN.col * TILE + TILE * 0.5;
      const sy = SPAWN.row * TILE + TILE * 0.5;
      e.bomberTarget = this.towers.reduce((best, t) => {
        const d = Math.hypot(t.wx - sx, t.wy - sy);
        return (!best || d < best.d) ? { t, d } : best;
      }, null)?.t ?? null;
    }

    this.enemies.push(e);
    this._notify('💣 BOMBER INBOUND! Protect your towers!', 3200);
  }

  /** Destroy a tower object (no refund). Used by bomber and airstrike. */
  _destroyTower(tower) {
    this.towers = this.towers.filter(t => t !== tower);
    const cell = this.grid.get(tower.col, tower.row);
    if (cell) {
      cell.type     = TileType.CRACKED;
      cell.pressure = PRESSURE.CRACK_AT + 5;
    }
    this._flashCollapse([{ x: tower.col, y: tower.row }]);
    this._repath();
  }

  /** Airstrike: 3-second warning then a random tower is obliterated. */
  _triggerAirstrike() {
    if (this.towers.length === 0) return;
    const target = this.towers[Math.floor(Math.random() * this.towers.length)];
    this._notify('☄ AIRSTRIKE INCOMING! (3s)', 2200);
    this.time.delayedCall(3000, () => {
      if (!this.gameRunning) return;
      if (!this.towers.includes(target)) return;  // already gone
      this._destroyTower(target);
      this._notify(`☄ AIRSTRIKE! ${TOWERS[target.type]?.label ?? 'Tower'} obliterated!`, 3000);
    });
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
    for (const e of this.enemies) this._repathEnemy(e);
  }

  /**
   * Compute an individual A* path from this enemy's current tile to the exit
   * and hand it to the enemy. This prevents enemies from cutting through newly
   * placed towers or collapsed tiles to reach a global path.
   */
  _repathEnemy(enemy) {
    const tx = Math.floor(enemy.wx / TILE);
    const ty = Math.floor(enemy.wy / TILE);

    // Try pathing directly from the enemy's current tile
    let p = this.pf.find(tx, ty, EXIT.col, EXIT.row);

    if (!p) {
      // Current tile may be impassable (just collapsed / tower placed on it).
      // Try the four cardinal neighbours to find a walkable escape tile.
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        p = this.pf.find(tx + dx, ty + dy, EXIT.col, EXIT.row);
        if (p) break;
      }
    }

    if (p) enemy.repath(p);
    // If still no path, the enemy is fully trapped — leave their current path
    // in place; the anti-deadlock logic in _repath() will handle it.
  }

  _waveEnd() {
    this.waveActive = false;
    const bonus = ECONOMY.WAVE_BONUS_BASE + this.wave * ECONOMY.WAVE_BONUS_INCR;
    this.gold += bonus;
    this.grid.dissipate();
    this._repath();
    this._analyzeWave();
    this.waveKills = { basic: 0, sniper: 0, slow: 0 };
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
      const towerObj = this.towers.find(t => t.col === col && t.row === row);
      this.towers = this.towers.filter(t => !(t.col === col && t.row === row));
      cell.type     = TileType.NORMAL;
      cell.pressure = 0;
      const sellCost = towerObj ? TOWERS[towerObj.type]?.cost ?? ECONOMY.TOWER_COST : ECONOMY.TOWER_COST;
      const refund = Math.floor(sellCost * 0.5);
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
    const type = this.selectedTowerType;
    const cost = TOWERS[type].cost;
    if (this.gold < cost) {
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
    this.gold -= cost;
    this.towers.push(new Tower(col, row, TILE, type));
    this.path = testPath;
    for (const e of this.enemies) this._repathEnemy(e);
    this._setStatus(`${TOWERS[type].label} placed!\n💰 $${this.gold} remaining`);
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

    // ── Bomber detonation: destroy the nearest tower the bomber touches ───────
    for (const e of this.enemies) {
      if (e.mode !== 'bomber' || e.dead) continue;
      for (const t of this.towers) {
        if (Math.hypot(e.wx - t.wx, e.wy - t.wy) < TILE * 1.5) {
          this._destroyTower(t);
          e.dead = true;
          this._notify(`💥 BOMBER OBLITERATED a ${TOWERS[t.type]?.label ?? 'tower'}!`, 3000);
          break;
        }
      }
    }

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

    // Collect gold for enemies killed this frame; tally kill type for Creep Master
    this.enemies = this.enemies.filter(e => {
      if (e.dead) {
        this.gold += e.reward;
        this.kills++;
        if (e.lastHitBy && e.mode !== 'bomber') {
          this.waveKills[e.lastHitBy] = (this.waveKills[e.lastHitBy] ?? 0) + 1;
        }
        return false;
      }
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

    let hoveredTower = null;

    for (const t of this.towers) {
      const px = t.col * TILE, py = t.row * TILE;
      const hw = TILE / 2;
      const cx = px + hw, cy = py + hw;
      const isHov = this.hovCol === t.col && this.hovRow === t.row;
      if (isHov) hoveredTower = t;

      // ── Per-type base + range ring ──────────────────────────────────────
      if (t.type === 'sniper') {
        g.lineStyle(1.5, 0x33aa33, 0.55);
        g.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
        g.fillStyle(0x1a2e1a, 1);
        g.fillRect(px + 5, py + 5, TILE - 10, TILE - 10);
        g.lineStyle(1, 0x44cc44, isHov ? 0.50 : 0.14);
        g.strokeCircle(t.wx, t.wy, t.range);

      } else if (t.type === 'slow') {
        g.lineStyle(1.5, 0x8899ff, 0.55);
        g.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
        g.fillStyle(0x141830, 1);
        g.fillRect(px + 5, py + 5, TILE - 10, TILE - 10);
        // Icy pulse ring (larger when muzzle flash active)
        const discR = t.muzzleFlash > 0 ? hw - 4 : hw - 7;
        g.fillStyle(0x5566cc, 0.85);
        g.fillCircle(cx, cy, discR);
        g.lineStyle(1, 0x8899ff, isHov ? 0.50 : 0.14);
        g.strokeCircle(t.wx, t.wy, t.range);

      } else {
        g.lineStyle(1.5, 0x3366aa, 0.5);
        g.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
        g.fillStyle(0x1e3a5a, 1);
        g.fillRect(px + 5, py + 5, TILE - 10, TILE - 10);
        g.lineStyle(1, 0x4499ff, isHov ? 0.45 : 0.12);
        g.strokeCircle(t.wx, t.wy, t.range);
      }

      // ── Rotating barrel (Basic & Sniper) ─────────────────────────────────
      if (t.type !== 'slow') {
        const barrelLen  = t.type === 'sniper' ? hw - 1 : hw - 3;
        const barrelW    = t.type === 'sniper' ? 3 : 5;
        const barrelColor = t.type === 'sniper' ? 0x44aa44 : 0x6699cc;

        // Tip position for muzzle flash
        const tipX = cx + Math.cos(t.aimAngle) * barrelLen;
        const tipY = cy + Math.sin(t.aimAngle) * barrelLen;

        g.save();
        g.translateCanvas(cx, cy);
        g.rotateCanvas(t.aimAngle + Math.PI / 2); // +PI/2: local "up" → aim direction
        g.fillStyle(barrelColor, 1);
        g.fillRect(-barrelW / 2, -barrelLen, barrelW, barrelLen);
        g.restore();

        // Muzzle flash
        if (t.muzzleFlash > 0) {
          const flashAlpha = t.muzzleFlash / 110;
          g.fillStyle(0xffffff, flashAlpha * 0.9);
          g.fillCircle(tipX, tipY, 5 * flashAlpha);
          g.fillStyle(0xffee44, flashAlpha * 0.7);
          g.fillCircle(tipX, tipY, 3 * flashAlpha);
        }
      } else {
        // Slow: muzzle flash as expanding icy ring
        if (t.muzzleFlash > 0) {
          const flashAlpha = t.muzzleFlash / 110;
          g.lineStyle(2, 0xaabbff, flashAlpha * 0.8);
          g.strokeCircle(cx, cy, (hw - 2) * (1.2 - flashAlpha * 0.2));
        }
      }

      // ── Hub dot (drawn on top of barrel) ─────────────────────────────────
      const hubColor  = t.type === 'sniper' ? 0x88ee88 : t.type === 'slow' ? 0xaabbff : 0xaaddff;
      const hubBg     = t.type === 'sniper' ? 0x1a2e1a : t.type === 'slow' ? 0x141830 : 0x1e3a5a;
      g.fillStyle(hubColor, 1);
      g.fillCircle(cx, cy, 5);
      g.fillStyle(hubBg, 1);
      g.fillCircle(cx, cy, 2);

      // ── Upgrade level pips (bottom-centre of tile) ────────────────────────
      if (t.level > 1) {
        const pipColor = t.type === 'sniper' ? 0x88ee88 : t.type === 'slow' ? 0xaabbff : 0xaaddff;
        const pips = t.level - 1;
        const spacing = 6;
        const startX = cx - (pips - 1) * spacing / 2;
        for (let i = 0; i < pips; i++) {
          g.fillStyle(pipColor, 1);
          g.fillCircle(startX + i * spacing, py + TILE - 6, 3);
        }
      }
    }

    // ── Hovered tower info ────────────────────────────────────────────────
    if (hoveredTower && !this.placingTower && !this.demolishMode) {
      const cfg      = TOWERS[hoveredTower.type];
      const sell     = Math.floor(TOWERS[hoveredTower.type].cost * 0.5 * hoveredTower.level);
      const upCost   = hoveredTower.upgradeCost();
      const upLine   = upCost !== null ? `[U] Upgrade: $${upCost}` : 'Max level ★★★';
      const slowLine = hoveredTower.type === 'slow' ? '  Slows on hit' : '';
      this._setStatus(
        `${cfg.label}  Lv${hoveredTower.level}\n` +
        `Dmg ${Math.round(hoveredTower.damage)}  Range ${Math.round(hoveredTower.range)}px\n` +
        `Fire ${hoveredTower.fireRate}/s${slowLine}\n` +
        `Sell: $${sell}\n${upLine}`
      );
    } else if (!this.placingTower && !this.demolishMode) {
      this._setStatus('');
    }
  }

  // ── Draw: enemies + bullet flashes ───────────────────────────────────────
  _drawEntities() {
    const g = this.gEntities;
    g.clear();

    // Bullet flash lines (colored per tower type)
    for (const s of this.shots) {
      const lineColor = s.color ?? 0xffff55;
      g.lineStyle(1.5, lineColor, 0.85);
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
      const typeCfg   = CREEP_TYPES[e.creepType] ?? CREEP_TYPES.normal;
      const isBomber  = e.mode === 'bomber';
      // Fix: 0.27 is the base radius fraction; radiusMult scales the type; bombers are 40% larger
      const baseR     = TILE * 0.27 * typeCfg.radiusMult * (isBomber ? 1.4 : 1.0);
      const isSlowed  = e.slowTimer > 0;
      const isHeatBurst = e.heatBurstTimer > 0;

      // ── Bomber: draw targeting line + reticle on nearest tower ─────────────
      if (isBomber && this.towers.length > 0) {
        const nearest = this.towers.reduce((best, t) => {
          const d = Math.hypot(e.wx - t.wx, e.wy - t.wy);
          return (!best || d < best.d) ? { t, d } : best;
        }, null);
        if (nearest) {
          const pulse = 0.35 + 0.55 * Math.abs(Math.sin(Date.now() * 0.004));
          // Dashed targeting line
          g.lineStyle(2, 0xff3300, pulse * 0.8);
          g.lineBetween(e.wx, e.wy, nearest.t.wx, nearest.t.wy);
          // Reticle on the targeted tower
          g.lineStyle(2, 0xff3300, pulse);
          g.strokeCircle(nearest.t.wx, nearest.t.wy, TILE * 0.58);
          g.lineStyle(1.5, 0xffaa00, pulse * 0.6);
          g.strokeCircle(nearest.t.wx, nearest.t.wy, TILE * 0.70);
        }
      }

      // Shadow
      g.fillStyle(0x000000, 0.3);
      g.fillCircle(e.wx + 2, e.wy + 3, baseR);

      // ── Trait aura rings (intensity proportional to buildup) ──────────────
      if (isSlowed) {
        g.lineStyle(2, 0x8899ff, 0.70);
        g.strokeCircle(e.wx, e.wy, baseR + 3);
      }
      if (e.armorBuildup > 0.02) {
        const a = 0.25 + e.armorBuildup * 0.8;
        g.lineStyle(2 + e.armorBuildup * 3, 0xccddee, a);
        g.strokeCircle(e.wx, e.wy, baseR + 5);
      }
      if (e.heatBuildup > 0.02) {
        const glowA = isHeatBurst ? 0.80 : 0.20 + e.heatBuildup * 0.60;
        g.fillStyle(isHeatBurst ? 0xff5500 : 0xff9944, glowA);
        g.fillCircle(e.wx, e.wy, baseR + 5);
      }
      if (isBomber) {
        g.lineStyle(2, 0xff2200, 0.80);
        g.strokeCircle(e.wx, e.wy, baseR + 4);
      }

      // Body — base color from creepType
      const pct = e.hp / e.maxHp;
      let bodyColor;
      if (isBomber)         bodyColor = 0xcc1100;
      else if (isSlowed)    bodyColor = 0x8855cc;
      else if (isHeatBurst) bodyColor = 0xff5500;
      else                  bodyColor = pct > 0.5 ? typeCfg.color
                                      : pct > 0.25 ? 0xff7700 : 0xff0066;

      // Evasive enemies flicker
      const alpha = (e.evasionBuildup > 0.05)
        ? 0.40 + 0.60 * Math.abs(Math.sin(Date.now() * 0.006 + e.id))
        : 1.0;
      g.fillStyle(bodyColor, alpha);
      g.fillCircle(e.wx, e.wy, baseR);

      // Bomber 💣 label above
      if (isBomber) {
        g.lineStyle(1.5, 0xffdd00, 0.9);
        const s = baseR * 0.5;
        g.lineBetween(e.wx - s, e.wy - s, e.wx + s, e.wy + s);
        g.lineBetween(e.wx + s, e.wy - s, e.wx - s, e.wy + s);
      }

      // HP bar
      const bw = TILE * 0.72, bh = 4;
      const bx = e.wx - bw / 2, by = e.wy - baseR - 8;
      g.fillStyle(0x331111, 0.85);
      g.fillRect(bx, by, bw, bh);
      g.fillStyle(isBomber ? 0xff6600 : 0x22ee44, 0.9);
      g.fillRect(bx, by, bw * pct, bh);
    }
  }
}
