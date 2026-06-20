import { config, view, sliders, Config, TOWER_ORDER, TOWER_DEFS } from './config';
import { Game } from './game';

export function buildPanel(panel: HTMLElement, game: Game) {
  const towerButtons = TOWER_ORDER.map((k) => {
    const d = TOWER_DEFS[k];
    return `<button class="tower-btn" data-kind="${k}" style="border-left:4px solid ${d.color}">
      <b>${d.hotkey}</b> ${d.name} <span class="muted">$${d.cost}</span></button>`;
  }).join('');

  panel.innerHTML = `
    <h1>Adaptive Maze TD</h1>
    <div class="hint">Left-click: build &middot; Right-click: sell &middot; keys 1/2/3 pick tower</div>
    <div class="hint">Towers ARE the maze. Killing builds pressure &rarr; tiles &amp; <b>your own guns</b> crack &rarr; collapse reroutes the path &amp; wrecks adjacent towers. Crowding the spawn cooks itself.</div>

    <h2>Towers</h2>
    <div id="towers">${towerButtons}</div>
    <div id="tower-desc" class="hint"></div>

    <h2>Live stats</h2>
    <div id="stats"></div>

    <h2>View</h2>
    <div class="toggle-row">
      <label><input type="checkbox" id="t-heat" checked> heatmap</label>
      <label><input type="checkbox" id="t-path" checked> path</label>
      <label><input type="checkbox" id="t-wreck" checked> collapse wrecks towers</label>
      <label><input type="checkbox" id="t-pause"> pause</label>
    </div>
    <button id="reset">Reset map</button>

    <h2>Tuning</h2>
    <div id="sliders"></div>
  `;

  const statsEl = panel.querySelector('#stats')!;
  const slidersEl = panel.querySelector('#sliders')!;
  const descEl = panel.querySelector('#tower-desc')!;
  const towerBtns = Array.from(panel.querySelectorAll<HTMLButtonElement>('.tower-btn'));

  for (const btn of towerBtns) {
    btn.addEventListener('click', () => {
      game.selectedKind = btn.dataset.kind as typeof game.selectedKind;
    });
  }

  for (const [key, label, min, max, step] of sliders) {
    const row = document.createElement('div');
    row.className = 'row';
    const val = config[key] as number;
    row.innerHTML = `
      <label>${label}</label>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${val}" />
      <span class="val">${fmt(val)}</span>`;
    const input = row.querySelector('input')!;
    const valSpan = row.querySelector('.val')!;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      (config[key] as Config[typeof key]) = v;
      valSpan.textContent = fmt(v);
    });
    slidersEl.appendChild(row);
  }

  bindToggle(panel, '#t-heat', (v) => (view.showHeatmap = v));
  bindToggle(panel, '#t-path', (v) => (view.showPath = v));
  bindToggle(panel, '#t-wreck', (v) => (view.collapseWrecksTowers = v));
  bindToggle(panel, '#t-pause', (v) => (view.paused = v));
  panel.querySelector('#reset')!.addEventListener('click', () => game.reset());

  return () => {
    for (const btn of towerBtns) {
      btn.style.outline = btn.dataset.kind === game.selectedKind ? '2px solid #58a6ff' : 'none';
    }
    const d = TOWER_DEFS[game.selectedKind];
    const extra = d.splashRadius
      ? ` · splash ${d.splashRadius}`
      : d.slowAmount
        ? ` · slow x${d.slowAmount} (${d.slowDuration}s)`
        : '';
    descEl.textContent = `${d.name}: dmg ${d.damage} · range ${d.range} · ${d.fireRate}/s${extra}`;

    statsEl.textContent =
      `wave     ${game.wave}${game.waveActive ? ' (active)' : ''}\n` +
      `lives    ${game.lives}\n` +
      `money    ${game.money}\n` +
      `kills    ${game.kills}\n` +
      `leaks    ${game.leaks}\n` +
      `enemies  ${game.enemies.length}\n` +
      `towers   ${game.towers.length}\n` +
      `fps      ${game.fps.toFixed(0)}`;
  };
}

function bindToggle(panel: HTMLElement, sel: string, set: (v: boolean) => void) {
  const el = panel.querySelector(sel) as HTMLInputElement;
  el.addEventListener('change', () => set(el.checked));
}

function fmt(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
