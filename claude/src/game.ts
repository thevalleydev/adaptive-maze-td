import { config, view, TowerKind, TOWER_DEFS, TOWER_ORDER, ENEMY_DEFS, DamageType, DAMAGE_TYPE_LABEL } from './config';
import { TILE, COLS, ROWS } from './grid';
import { Pt } from './astar';
import { World } from './world';
import { audio } from './audio';
import { seedToCode } from './rng';
import * as scores from './scoreClient';

// Armor ring colours — matched to the tower whose damage type they resist, so a
// hardened creep visibly "reads" as immune to that colour of fire.
const ARMOR_COLOR: Record<DamageType, string> = {
  kinetic: '#1f6feb', // vs Gun
  blast: '#d29922', // vs Cannon
  frost: '#3fd6ff', // vs Frost
};

// Thin presentation layer: owns a World (all simulation lives there), draws it,
// and forwards mouse/keyboard input. No game logic here — see world.ts.
export class Game {
  world: World;
  selectedKind: TowerKind = 'gun';
  hover: Pt | null = null;
  fps = 0;
  onSeedChange?: (seed: number | null) => void;
  learnBanner = '';
  learnTimer = 0;

  // --- Score DB ---
  record: scores.Record | null = null; // this seed's best, from the score server
  newBestThisRun = false;
  private runRecorded = false;

  ctx: CanvasRenderingContext2D;

  // Previous observable state, diffed each frame to fire SFX from the
  // presentation layer (so world.ts stays Audio/DOM-free + deterministic).
  private prev = { kills: 0, leaks: 0, shots: 0, reachedTarget: false, gameOver: false, awaitingLevelUp: false };

  // Convenience getters so the panel/stats code reads naturally.
  get money() {
    return Math.floor(this.world.money);
  }
  get kills() {
    return this.world.kills;
  }
  get leaks() {
    return this.world.leaks;
  }
  get lives() {
    return this.world.lives;
  }
  get wave() {
    return this.world.wave;
  }
  get waveActive() {
    return this.world.waveActive;
  }
  get enemies() {
    return this.world.enemies;
  }
  get towers() {
    return this.world.towers;
  }

  get seed() {
    return this.world.seed;
  }
  get started() {
    return this.world.started;
  }
  get awaitingLevelUp() {
    return this.world.awaitingLevelUp;
  }
  get levelUpOptions() {
    return this.world.levelUpOptions;
  }
  get evolution() {
    return this.world.evolution;
  }

  start() {
    this.world.start();
  }
  chooseLevelUp(i: number) {
    this.world.chooseLevelUp(i);
  }

  reset() {
    this.world.reset(); // replay the same seed
    this.runRecorded = false;
    this.newBestThisRun = false;
    this.refreshRecord();
  }

  newRun(seed: number) {
    this.world.loadSeed(seed);
    this.onSeedChange?.(seed);
    this.runRecorded = false;
    this.newBestThisRun = false;
    this.refreshRecord();
  }

  // Fetch this seed's best from the score server (or local fallback) for the HUD.
  refreshRecord() {
    if (this.world.seed === null) {
      this.record = null;
      return;
    }
    scores.getRecord(seedToCode(this.world.seed)).then((r) => (this.record = r));
  }

  // Persist the finished run once, when death ends it.
  private recordRun() {
    if (this.world.seed === null) return;
    const code = seedToCode(this.world.seed);
    scores.postRun(this.world.runSummary(code)).then((r) => {
      this.newBestThisRun = r.newBest;
      this.refreshRecord();
    });
  }

  constructor(canvas: HTMLCanvasElement, seed: number | null = null) {
    this.world = new World(seed);
    canvas.width = COLS * TILE;
    canvas.height = ROWS * TILE;
    this.ctx = canvas.getContext('2d')!;

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.hover = {
        x: Math.floor((e.clientX - r.left) / TILE),
        y: Math.floor((e.clientY - r.top) / TILE),
      };
    });
    canvas.addEventListener('mouseleave', () => (this.hover = null));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      audio.resume(); // first gesture unlocks WebAudio
      const r = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / TILE);
      const y = Math.floor((e.clientY - r.top) / TILE);
      if (e.button === 0) {
        // Click your own tower to upgrade it; an empty tile to build.
        if (this.world.towers.some((t) => t.x === x && t.y === y)) {
          if (this.world.tryUpgradeTower(x, y)) audio.upgrade();
        } else if (this.world.tryPlaceTower(x, y, this.selectedKind)) audio.build();
      } else if (e.button === 2) {
        if (this.world.trySellTower(x, y)) audio.sell();
      }
    });
    window.addEventListener('keydown', (e) => {
      const t = TOWER_ORDER.find((k) => TOWER_DEFS[k].hotkey === e.key);
      if (t) this.selectedKind = t;
    });

    this.refreshRecord(); // load this seed's best for the HUD
  }

  update(dt: number) {
    if (view.paused) return;
    this.world.update(dt);
    if (this.world.justLearned) {
      const jl = this.world.justLearned;
      this.learnBanner =
        jl === 'climb'
          ? 'THE SWARM LEARNED TO CLIMB'
          : jl === 'bomb'
            ? 'THE SWARM LEARNED TO BOMB'
            : jl === 'seek'
              ? 'THE SWARM LEARNED TO EXPLOIT CRACKS'
              : `THE SWARM HARDENED VS ${(DAMAGE_TYPE_LABEL[this.world.evolution.armor ?? 'kinetic']).toUpperCase()}`;
      this.learnTimer = 3.5;
    }
    if (this.learnTimer > 0) this.learnTimer -= dt;
    if (this.world.gameOver && !this.runRecorded) {
      this.runRecorded = true;
      this.recordRun();
    }
    this.emitSounds();
  }

  // Diff the world's observable state against last frame and fire SFX. Keeps all
  // audio out of world.ts (which the headless sim shares).
  private emitSounds() {
    const w = this.world;
    if (w.shotsFired > this.prev.shots) audio.shoot();
    if (w.kills > this.prev.kills) audio.kill();
    if (w.leaks > this.prev.leaks) audio.leak();
    if (w.grid.justCollapsed.length) audio.collapse();
    if (this.world.justLearned) audio.evolve();
    if (w.awaitingLevelUp && !this.prev.awaitingLevelUp) audio.levelUp();
    if (w.reachedTarget && !this.prev.reachedTarget) audio.win(); // milestone fanfare
    if (w.gameOver && !this.prev.gameOver) audio.lose(); // death always ends the run

    this.prev.shots = w.shotsFired;
    this.prev.kills = w.kills;
    this.prev.leaks = w.leaks;
    this.prev.awaitingLevelUp = w.awaitingLevelUp;
    this.prev.reachedTarget = w.reachedTarget;
    this.prev.gameOver = w.gameOver;
  }

  render() {
    const ctx = this.ctx;
    const world = this.world;
    ctx.clearRect(0, 0, COLS * TILE, ROWS * TILE);

    // --- Tiles ---
    for (const t of world.grid.tiles) {
      const px = t.x * TILE;
      const py = t.y * TILE;

      let base = '#0e141b';
      if ((t.x + t.y) % 2 === 0) base = '#111923';
      ctx.fillStyle = base;
      ctx.fillRect(px, py, TILE, TILE);

      if (t.rock) {
        // Natural obstacle — impassable, can't build on. Build the maze around it.
        ctx.fillStyle = '#3a3f47';
        ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
        ctx.fillStyle = '#4b515a';
        ctx.fillRect(px + 6, py + 5, TILE - 14, TILE - 13);
        continue;
      }

      if (view.showHeatmap && t.pressure > 0 && t.state !== 'collapsed') {
        const frac = Math.min(1, t.pressure / config.collapseThreshold);
        ctx.fillStyle = `rgba(255, ${Math.round(160 - 140 * frac)}, 40, ${0.12 + 0.5 * frac})`;
        ctx.fillRect(px, py, TILE, TILE);
      }

      if (t.state === 'cracked') {
        ctx.strokeStyle = 'rgba(255,180,90,0.8)';
        this.drawCracks(px, py, 1);
      } else if (t.state === 'collapsing') {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
        ctx.fillStyle = `rgba(255,70,40,${0.25 + 0.4 * pulse})`;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = 'rgba(255,90,60,1)';
        this.drawCracks(px, py, 2);
      } else if (t.state === 'collapsed') {
        ctx.fillStyle = '#1c0f0a';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#2a1610';
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2, TILE * 0.32, 0, Math.PI * 2);
        ctx.fill();
        // Healing rubble: a ring that fills as it nears reverting to normal.
        if (config.rubbleHealTime > 0) {
          const p = Math.min(1, t.rubbleAge / config.rubbleHealTime);
          ctx.strokeStyle = 'rgba(120,160,90,0.5)';
          ctx.beginPath();
          ctx.arc(px + TILE / 2, py + TILE / 2, TILE * 0.32, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // No-build buffer shading around spawn.
    if (config.spawnBuffer > 0) {
      for (const t of world.grid.tiles) {
        if (world.nearSpawn(t.x, t.y) && !world.grid.isSpawnOrExit(t.x, t.y)) {
          ctx.fillStyle = 'rgba(80,90,110,0.12)';
          ctx.fillRect(t.x * TILE, t.y * TILE, TILE, TILE);
        }
      }
    }

    this.marker(world.grid.spawn, '#3fb950', 'S');
    this.marker(world.grid.exit, '#f85149', 'E');

    // --- Path preview ---
    if (view.showPath && world.previewPath && world.previewPath.length > 1) {
      ctx.strokeStyle = 'rgba(88,166,255,0.55)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      world.previewPath.forEach((p, i) => {
        const cx = p.x * TILE + TILE / 2;
        const cy = p.y * TILE + TILE / 2;
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }

    // --- Towers ---
    for (const t of world.towers) {
      const cx = t.x * TILE + TILE / 2;
      const cy = t.y * TILE + TILE / 2;
      const def = TOWER_DEFS[t.kind];
      if (def.structural) {
        // Wall: a solid block (no weapon).
        ctx.fillStyle = def.color;
        ctx.fillRect(t.x * TILE + 2, t.y * TILE + 2, TILE - 4, TILE - 4);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.strokeRect(t.x * TILE + 2.5, t.y * TILE + 2.5, TILE - 5, TILE - 5);
        // Brick courses so a wall reads as masonry, not a flat panel.
        ctx.strokeStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.moveTo(t.x * TILE + 3, cy);
        ctx.lineTo(t.x * TILE + TILE - 3, cy);
        ctx.moveTo(cx, t.y * TILE + 3);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      } else {
        // Ease the barrel toward the tower's live target so it points where it
        // shoots. targetId persists between shots, so the turret keeps tracking
        // while reloading and only drifts free once nothing is in range.
        const tgt = t.targetId != null ? world.enemies.find((e) => e.id === t.targetId && !e.dead && !e.leaked) : undefined;
        if (tgt) {
          const desired = Math.atan2(tgt.y * TILE + TILE / 2 - cy, tgt.x * TILE + TILE / 2 - cx);
          // Shortest-arc ease (frame-rate-light constant; turrets are snappy but not instant).
          let d = desired - t.aimAngle;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          t.aimAngle += d * 0.3;
        }
        this.drawTowerSilhouette(t.kind, cx, cy, def.color, t.aimAngle);
        if (def.ventRate) {
          // Square coverage ring — matches exactly the tiles it vents.
          const ext = Math.max(1, Math.round(def.ventRadius ?? def.range));
          ctx.strokeStyle = 'rgba(126,224,192,0.4)';
          ctx.strokeRect((t.x - ext) * TILE + 1, (t.y - ext) * TILE + 1, (2 * ext + 1) * TILE - 2, (2 * ext + 1) * TILE - 2);
        } else {
          const frac = Math.min(1, world.maxNeighborPressure(t.x, t.y) / config.collapseThreshold);
          if (frac > 0.05) {
            ctx.fillStyle = `rgba(255,40,30,${0.5 * frac})`;
            ctx.beginPath();
            ctx.arc(cx, cy, TILE * 0.34, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      // Upgrade-level pips.
      if (t.level > 1) {
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < t.level - 1; i++) {
          ctx.beginPath();
          ctx.arc(cx - 5 + i * 5, cy + TILE * 0.32, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (view.collapseWrecksTowers && world.neighborCollapsing(t.x, t.y)) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 80);
        ctx.strokeStyle = `rgba(255,60,40,${0.45 + 0.55 * pulse})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, TILE * 0.46, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = '#ffdd55';
        ctx.font = `bold ${TILE * 0.5}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', cx, cy);
      }
    }

    // --- Enemies ---
    for (const e of world.enemies) {
      const cx = e.x * TILE + TILE / 2;
      const cy = e.y * TILE + TILE / 2;
      const def = ENEMY_DEFS[e.kind];
      // Bombing target tile telegraph (drawn under the enemy).
      if (e.bombing && e.bombTarget) {
        const tx = e.bombTarget.x * TILE;
        const ty = e.bombTarget.y * TILE;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 70);
        ctx.fillStyle = `rgba(255,120,40,${0.25 + 0.45 * pulse})`;
        ctx.fillRect(tx, ty, TILE, TILE);
      }
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * def.radius, 0, Math.PI * 2);
      ctx.fill();
      if (e.climbing) {
        // Scaling a wall — dashed light outline.
        ctx.strokeStyle = 'rgba(220,220,230,0.95)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
      } else if (e.slowFactor < 1) {
        ctx.strokeStyle = '#3fd6ff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (e.bombing) {
        // Fuse arc filling toward detonation.
        const p = Math.min(1, e.bombTimer / config.bombTime);
        ctx.strokeStyle = 'rgba(255,140,40,0.95)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, TILE * 0.4, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (e.armorType) {
        // Hardened plating: a heavy ring in the resisted type's colour, with
        // short radial "plates" so it reads as armour, not another status glow.
        const col = ARMOR_COLOR[e.armorType];
        const r = TILE * (def.radius + 0.16);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          ctx.lineTo(cx + Math.cos(a) * (r + TILE * 0.07), cy + Math.sin(a) * (r + TILE * 0.07));
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }
      const w = TILE * 0.6;
      ctx.fillStyle = '#30363d';
      ctx.fillRect(cx - w / 2, cy - TILE * 0.46, w, 3);
      ctx.fillStyle = '#3fb950';
      ctx.fillRect(cx - w / 2, cy - TILE * 0.46, w * Math.max(0, e.hp / e.maxHp), 3);
    }

    // --- Shots ---
    for (const s of world.shots) {
      ctx.strokeStyle = 'rgba(255,255,180,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.from.x * TILE + TILE / 2, s.from.y * TILE + TILE / 2);
      ctx.lineTo(s.to.x * TILE + TILE / 2, s.to.y * TILE + TILE / 2);
      ctx.stroke();
      if (s.splash) {
        ctx.strokeStyle = 'rgba(255,200,90,0.6)';
        ctx.beginPath();
        ctx.arc(s.to.x * TILE + TILE / 2, s.to.y * TILE + TILE / 2, s.splash * TILE, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.lineWidth = 1;

    // --- Hover / build-or-upgrade preview ---
    if (this.hover && world.grid.inBounds(this.hover.x, this.hover.y)) {
      const hx = this.hover.x;
      const hy = this.hover.y;
      const px = hx * TILE;
      const py = hy * TILE;
      const existing = world.towers.find((t) => t.x === hx && t.y === hy);

      if (existing) {
        const sdef = TOWER_DEFS[existing.kind];
        if (sdef.structural) {
          // Wall: selectable for sell only (no upgrade).
          ctx.strokeStyle = 'rgba(150,150,150,0.7)';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
          ctx.lineWidth = 1;
        } else {
          // Upgrade preview: current range + cost/MAX label.
          const up = world.upgradeCostAt(hx, hy);
          const ok = up !== null && this.money >= up;
          ctx.strokeStyle = up === null ? 'rgba(150,150,150,0.7)' : ok ? 'rgba(63,185,80,0.9)' : 'rgba(248,81,73,0.9)';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
          ctx.strokeStyle = `${sdef.color}99`;
          ctx.beginPath();
          ctx.arc(px + TILE / 2, py + TILE / 2, existing.rangeEff * TILE, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 1;
          ctx.fillStyle = up === null ? '#8b949e' : ok ? '#3fb950' : '#f85149';
          ctx.font = `bold 12px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(up === null ? 'MAX' : `↑ $${up}`, px + TILE / 2, py - 1);
        }
      } else {
        const def = TOWER_DEFS[this.selectedKind];
        const ok = world.canBuildOn(hx, hy) && this.money >= world.towerCost(this.selectedKind);
        ctx.strokeStyle = ok ? 'rgba(63,185,80,0.9)' : 'rgba(248,81,73,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
        // Coverage preview: square for Vent, circle for attackers, none for walls.
        ctx.strokeStyle = ok ? def.color : 'rgba(248,81,73,0.3)';
        ctx.globalAlpha = 0.6;
        if (def.ventRate) {
          const ext = Math.max(1, Math.round(def.ventRadius ?? def.range));
          ctx.strokeRect((hx - ext) * TILE, (hy - ext) * TILE, (2 * ext + 1) * TILE, (2 * ext + 1) * TILE);
        } else if (def.range > 0) {
          ctx.beginPath();
          ctx.arc(px + TILE / 2, py + TILE / 2, def.range * TILE, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
      }
    }

    this.renderHud();
  }

  private renderHud() {
    const ctx = this.ctx;
    const world = this.world;
    const W = COLS * TILE;

    ctx.fillStyle = 'rgba(5,7,10,0.7)';
    ctx.fillRect(0, 0, W, 26);
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 15px monospace';

    const tgt = config.targetWave;
    const left = world.spawnQueue.length + world.enemies.length;
    let status: string;
    if (!world.started) status = `PREP · build your maze, then press ▶ Start  (goal: wave ${tgt})`;
    else if (world.wave === 0) status = `GET READY…  goal: survive to wave ${tgt}`;
    else if (world.reachedTarget)
      status = world.waveActive
        ? `WAVE ${world.wave}  ·  ENDLESS ★${tgt}  ·  ${left} left`
        : `WAVE ${world.wave} CLEARED  ·  ENDLESS ★${tgt}  ·  next in ${Math.ceil(world.betweenTimer)}s`;
    else if (world.waveActive) status = `WAVE ${world.wave}/${tgt}  ·  ${left} left`;
    else status = `WAVE ${world.wave}/${tgt} CLEARED  ·  next in ${Math.ceil(world.betweenTimer)}s`;

    ctx.fillStyle = '#58a6ff';
    ctx.textAlign = 'left';
    ctx.fillText(status, 10, 14);

    const def = TOWER_DEFS[this.selectedKind];
    ctx.textAlign = 'center';
    ctx.fillStyle = def.color;
    ctx.fillText(`▶ ${def.name} ($${world.towerCost(this.selectedKind)})`, W / 2, 14);

    ctx.fillStyle = world.lives <= 5 ? '#f85149' : '#3fb950';
    ctx.textAlign = 'right';
    ctx.fillText(`♥ ${world.lives}   $ ${this.money}`, W - 10, 14);

    // Transient "the swarm evolved" banner.
    if (this.learnTimer > 0) {
      ctx.fillStyle = 'rgba(217,83,59,0.9)';
      ctx.fillRect(0, 30, W, 30);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`⚠ ${this.learnBanner} ⚠`, W / 2, 45);
    }

    if (world.gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, W, ROWS * TILE);
      ctx.textAlign = 'center';
      ctx.font = 'bold 34px monospace';
      const made = world.reachedTarget;
      ctx.fillStyle = made ? '#3fb950' : '#f85149';
      ctx.fillText(made ? 'TARGET CLEARED!' : 'GAME OVER', W / 2, (ROWS * TILE) / 2 - 16);
      ctx.fillStyle = '#c9d1d9';
      ctx.font = '15px monospace';
      const passed = made ? ` · ★ passed wave ${config.targetWave}` : ` · target was ${config.targetWave}`;
      ctx.fillText(`died on wave ${world.wave} · ${world.kills} kills${passed}`, W / 2, (ROWS * TILE) / 2 + 16);
      if (this.newBestThisRun) {
        ctx.fillStyle = '#f0c43e';
        ctx.font = 'bold 17px monospace';
        ctx.fillText('★ NEW BEST FOR THIS SEED ★', W / 2, (ROWS * TILE) / 2 + 40);
      } else if (this.record) {
        ctx.fillStyle = '#8b949e';
        ctx.fillText(`seed best: wave ${this.record.bestWave} · ${this.record.bestKills} kills`, W / 2, (ROWS * TILE) / 2 + 40);
      }
      ctx.fillStyle = '#c9d1d9';
      ctx.fillText('press "Reset map" to play again', W / 2, (ROWS * TILE) / 2 + 62);
    }
  }

  // Per-kind tower shapes so type reads at a glance (color alone is hard to tell
  // apart). Each draws a filled body in the tower's colour with a light outline.
  private drawTowerSilhouette(kind: TowerKind, cx: number, cy: number, color: string, aim = 0) {
    const ctx = this.ctx;
    const r = TILE * 0.32;

    // Soft mounting shadow grounds every tower against the board.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 3, r * 1.05, r * 0.68, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;

    if (kind === 'gun') {
      // Turret: a barrel that tracks the target, emerging from under a domed cap.
      const blen = r + 5;
      const bw = 5;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(aim);
      ctx.fillStyle = '#0b0f14'; // casing
      ctx.fillRect(-3, -bw / 2 - 1, blen + 3, bw + 2);
      ctx.fillStyle = this.shade(color, -0.08); // barrel
      ctx.fillRect(-3, -bw / 2, blen, bw);
      ctx.fillStyle = '#0b0f14'; // muzzle band
      ctx.fillRect(blen - 3, -bw / 2 - 1, 3, bw + 2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; // top highlight
      ctx.fillRect(0, -bw / 2 + 0.5, blen - 4, 1);
      ctx.restore();
      this.drawDome(cx, cy, r * 0.8, color);
    } else if (kind === 'cannon') {
      // Squat mortar: a thick bored barrel that also tracks, on a low hub.
      const blen = r + 4;
      const bw = 8;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(aim);
      ctx.fillStyle = '#0b0f14';
      ctx.fillRect(-2, -bw / 2 - 1, blen + 2, bw + 2);
      ctx.fillStyle = this.shade(color, -0.08);
      ctx.fillRect(-2, -bw / 2, blen, bw);
      ctx.fillStyle = '#0b0f14'; // bore
      ctx.beginPath();
      ctx.arc(blen - 1, 0, bw * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      this.drawDome(cx, cy, r * 0.6, color);
    } else if (kind === 'sniper') {
      // Long thin rifle barrel on a small mount, with a scope nub — reads as reach.
      const blen = r + 11;
      const bw = 3;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(aim);
      ctx.fillStyle = '#0b0f14'; // casing
      ctx.fillRect(-2, -bw / 2 - 1, blen + 2, bw + 2);
      ctx.fillStyle = this.shade(color, -0.05); // barrel
      ctx.fillRect(-2, -bw / 2, blen, bw);
      ctx.fillStyle = '#0b0f14'; // scope sitting atop the breech
      ctx.fillRect(r * 0.1, -bw / 2 - 3, 5, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; // barrel highlight
      ctx.fillRect(0, -bw / 2 + 0.5, blen - 4, 1);
      ctx.restore();
      this.drawDome(cx, cy, r * 0.55, color);
    } else if (kind === 'frost') {
      // Six-armed snowflake on a cold glow, turning slowly so it reads as active.
      const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, r * 1.15);
      glow.addColorStop(0, 'rgba(63,214,255,0.45)');
      glow.addColorStop(1, 'rgba(63,214,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.15, 0, Math.PI * 2);
      ctx.fill();
      this.drawDome(cx, cy, r * 0.4, color);
      const spin = performance.now() / 2600;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + spin;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        // little barbs
        ctx.moveTo(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6);
        ctx.lineTo(cx + Math.cos(a + 0.5) * r * 0.85, cy + Math.sin(a + 0.5) * r * 0.85);
        ctx.moveTo(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6);
        ctx.lineTo(cx + Math.cos(a - 0.5) * r * 0.85, cy + Math.sin(a - 0.5) * r * 0.85);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    } else {
      // Vent: a domed body with a spinning fan grate — the legible "cooling" verb.
      this.drawDome(cx, cy, r * 0.85, color);
      const spin = performance.now() / 1400;
      ctx.strokeStyle = '#0b0f14';
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + spin;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.22, cy + Math.sin(a) * r * 0.22);
        ctx.lineTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
    ctx.lineWidth = 1;
  }

  // Lighten (amt>0) or darken (amt<0) a #rrggbb colour toward white/black.
  private shade(hex: string, amt: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const t = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    const ch = (shift: number) => {
      const c = (n >> shift) & 0xff;
      return Math.round((t - c) * p) + c;
    };
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  // A shaded circular dome: lit from the upper-left so towers read as 3D caps.
  private drawDome(cx: number, cy: number, rad: number, color: string) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(cx - rad * 0.35, cy - rad * 0.4, rad * 0.1, cx, cy, rad);
    g.addColorStop(0, this.shade(color, 0.45));
    g.addColorStop(0.55, color);
    g.addColorStop(1, this.shade(color, -0.35));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  private drawCracks(px: number, py: number, lw: number) {
    const ctx = this.ctx;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(px + TILE * 0.2, py + TILE * 0.15);
    ctx.lineTo(px + TILE * 0.5, py + TILE * 0.55);
    ctx.lineTo(px + TILE * 0.35, py + TILE * 0.85);
    ctx.moveTo(px + TILE * 0.5, py + TILE * 0.55);
    ctx.lineTo(px + TILE * 0.8, py + TILE * 0.7);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  private marker(p: Pt, color: string, label: string) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(p.x * TILE, p.y * TILE, TILE, TILE);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = `bold ${TILE * 0.5}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, p.x * TILE + TILE / 2, p.y * TILE + TILE / 2);
  }
}
