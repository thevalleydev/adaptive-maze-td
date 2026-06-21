import { config, view, TowerKind, TOWER_DEFS, TOWER_ORDER, ENEMY_DEFS } from './config';
import { TILE, COLS, ROWS } from './grid';
import { Pt } from './astar';
import { World } from './world';

// Thin presentation layer: owns a World (all simulation lives there), draws it,
// and forwards mouse/keyboard input. No game logic here — see world.ts.
export class Game {
  world: World;
  selectedKind: TowerKind = 'gun';
  hover: Pt | null = null;
  fps = 0;
  onSeedChange?: (seed: number | null) => void;

  ctx: CanvasRenderingContext2D;

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

  reset() {
    this.world.reset(); // replay the same seed
  }

  newRun(seed: number) {
    this.world.loadSeed(seed);
    this.onSeedChange?.(seed);
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
      const r = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / TILE);
      const y = Math.floor((e.clientY - r.top) / TILE);
      if (e.button === 0) {
        // Click your own tower to upgrade it; an empty tile to build.
        if (this.world.towers.some((t) => t.x === x && t.y === y)) this.world.tryUpgradeTower(x, y);
        else this.world.tryPlaceTower(x, y, this.selectedKind);
      } else if (e.button === 2) this.world.trySellTower(x, y);
    });
    window.addEventListener('keydown', (e) => {
      const t = TOWER_ORDER.find((k) => TOWER_DEFS[k].hotkey === e.key);
      if (t) this.selectedKind = t;
    });
  }

  update(dt: number) {
    if (view.paused) return;
    this.world.update(dt);
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
      } else {
        ctx.fillStyle = def.color;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(cx, cy, TILE * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
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
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * def.radius, 0, Math.PI * 2);
      ctx.fill();
      if (e.slowFactor < 1) {
        ctx.strokeStyle = '#3fd6ff';
        ctx.lineWidth = 2;
        ctx.stroke();
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
    if (world.wave === 0) status = `GET READY…  goal: survive to wave ${tgt}`;
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
      ctx.fillText('press "Reset map" to play again', W / 2, (ROWS * TILE) / 2 + 40);
    }
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
