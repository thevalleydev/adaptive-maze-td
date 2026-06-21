import { config, view, sliders, Config, TOWER_ORDER, TOWER_DEFS } from './config';
import { Game } from './game';
import { randomSeed, codeToSeed, seedToCode } from './rng';

export function buildPanel(panel: HTMLElement, game: Game) {
  const towerButtons = TOWER_ORDER.map((k) => {
    const d = TOWER_DEFS[k];
    return `<button class="tower-btn" data-kind="${k}" style="border-left:4px solid ${d.color}">
      <b>${d.hotkey}</b> ${d.name} <span class="cost" data-kind="${k}"></span></button>`;
  }).join('');

  panel.innerHTML = `
    <h1>Adaptive Maze TD</h1>
    <div class="hint">Left-click empty: build &middot; left-click your tower: <b>upgrade</b> &middot; right-click: sell &middot; keys 1-4</div>

    <h2>Seed</h2>
    <div class="row seed-row">
      <input id="seed-in" type="text" spellcheck="false" />
      <button id="seed-play">Play</button>
    </div>
    <div class="toggle-row">
      <button id="seed-new">🎲 New seed</button>
      <button id="seed-replay">↻ Replay</button>
    </div>

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

    <h2>Tuning</h2>
    <div id="sliders"></div>
  `;

  const statsEl = panel.querySelector('#stats')!;
  const slidersEl = panel.querySelector('#sliders')!;
  const descEl = panel.querySelector('#tower-desc')!;
  const towerBtns = Array.from(panel.querySelectorAll<HTMLButtonElement>('.tower-btn'));
  const seedIn = panel.querySelector('#seed-in') as HTMLInputElement;

  for (const btn of towerBtns) {
    btn.addEventListener('click', () => {
      game.selectedKind = btn.dataset.kind as typeof game.selectedKind;
    });
  }

  // Seed controls.
  const syncSeedInput = () => {
    if (document.activeElement !== seedIn) seedIn.value = game.seed === null ? '' : seedToCode(game.seed);
  };
  panel.querySelector('#seed-play')!.addEventListener('click', () => {
    if (seedIn.value.trim()) game.newRun(codeToSeed(seedIn.value.trim()));
  });
  panel.querySelector('#seed-new')!.addEventListener('click', () => game.newRun(randomSeed()));
  panel.querySelector('#seed-replay')!.addEventListener('click', () => game.reset());
  syncSeedInput();

  for (const [key, label, min, max, step] of sliders) {
    const row = document.createElement('div');
    row.className = 'row';
    const valNum = config[key] as number;
    row.innerHTML = `
      <label>${label}</label>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${valNum}" />
      <span class="val">${fmt(valNum)}</span>`;
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

  return () => {
    const money = game.money;
    // Per-tower live cost + affordability + selection.
    for (const btn of towerBtns) {
      const kind = btn.dataset.kind as keyof typeof TOWER_DEFS;
      const cost = game.world.towerCost(kind);
      btn.querySelector('.cost')!.textContent = `$${cost}`;
      btn.classList.toggle('unaffordable', money < cost);
      btn.style.outline = kind === game.selectedKind ? '2px solid #58a6ff' : 'none';
    }

    const d = TOWER_DEFS[game.selectedKind];
    descEl.textContent = d.blurb;

    syncSeedInput();

    statsEl.textContent =
      `seed     ${game.seed === null ? '—' : seedToCode(game.seed)}\n` +
      `wave     ${game.wave}${game.waveActive ? ' (active)' : ''}\n` +
      `lives    ${game.lives}\n` +
      `money    ${money}\n` +
      `kills    ${game.kills}\n` +
      `leaks    ${game.leaks}\n` +
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
