import { config, view, sliders, Config, TOWER_ORDER, TOWER_DEFS } from './config';
import { Game } from './game';
import { audio } from './audio';
import { randomSeed, codeToSeed, seedToCode } from './rng';

export function buildPanel(panel: HTMLElement, game: Game) {
  const towerButtons = TOWER_ORDER.map((k) => {
    const d = TOWER_DEFS[k];
    return `<button class="tower-btn" data-kind="${k}" style="border-left:4px solid ${d.color}">
      <b>${d.hotkey}</b> ${d.name} <span class="cost" data-kind="${k}"></span></button>`;
  }).join('');

  panel.innerHTML = `
    <div id="panel-head"><h1>Adaptive Maze TD</h1><button id="settings-btn" title="Settings &amp; tuning">⚙</button></div>
    <div class="hint">Left-click empty: build &middot; left-click your tower: <b>upgrade</b> &middot; right-click: sell &middot; keys 1-5</div>

    <div class="toggle-row"><button id="start-btn">▶ Start</button></div>
    <div id="levelup"></div>

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
  `;

  // Settings/tuning live in a modal so the main panel never grows a long scroll.
  const modalBody = document.querySelector('#modal-body') as HTMLElement;
  modalBody.innerHTML = `
    <h2>View</h2>
    <div class="toggle-row">
      <label><input type="checkbox" id="t-heat" checked> heatmap</label>
      <label><input type="checkbox" id="t-path" checked> path</label>
      <label><input type="checkbox" id="t-wreck" checked> collapse wrecks towers</label>
      <label><input type="checkbox" id="t-adapt" checked> creeps adapt</label>
      <label><input type="checkbox" id="t-mute"> mute audio</label>
      <label><input type="checkbox" id="t-pause"> pause</label>
    </div>

    <h2>Tuning</h2>
    <div id="sliders" class="sliders-grid"></div>
  `;

  const statsEl = panel.querySelector('#stats')!;
  const slidersEl = modalBody.querySelector('#sliders')!;
  const descEl = panel.querySelector('#tower-desc')!;
  const towerBtns = Array.from(panel.querySelectorAll<HTMLButtonElement>('.tower-btn'));
  const seedIn = panel.querySelector('#seed-in') as HTMLInputElement;
  const startBtn = panel.querySelector('#start-btn') as HTMLButtonElement;
  const levelupEl = panel.querySelector('#levelup')!;
  startBtn.addEventListener('click', () => {
    audio.resume();
    game.start();
  });

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

  bindToggle(modalBody, '#t-heat', (v) => (view.showHeatmap = v));
  bindToggle(modalBody, '#t-path', (v) => (view.showPath = v));
  bindToggle(modalBody, '#t-wreck', (v) => (view.collapseWrecksTowers = v));
  bindToggle(modalBody, '#t-adapt', (v) => (view.enemyAdaptation = v));
  bindToggle(modalBody, '#t-pause', (v) => (view.paused = v));

  // Mute reflects the persisted audio state and writes back through it.
  const muteEl = modalBody.querySelector('#t-mute') as HTMLInputElement;
  muteEl.checked = audio.muted;
  muteEl.addEventListener('change', () => audio.setMuted(muteEl.checked));

  // Settings modal open/close (gear button, ✕, backdrop click, Esc).
  const overlay = document.querySelector('#modal-overlay') as HTMLElement;
  const openModal = () => (overlay.hidden = false);
  const closeModal = () => (overlay.hidden = true);
  panel.querySelector('#settings-btn')!.addEventListener('click', openModal);
  document.querySelector('#modal-close')!.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeModal();
  });

  let levelUpRendered = -1; // rebuild option buttons only when they change

  return () => {
    const money = game.money;

    // Start button (prep only).
    startBtn.style.display = game.started ? 'none' : 'block';

    // Level-up offer.
    if (game.awaitingLevelUp) {
      const sig = game.levelUpOptions.map((o) => o.label).join('|');
      if (sig !== String(levelUpRendered)) {
        levelUpRendered = sig as unknown as number;
        levelupEl.innerHTML =
          `<div class="hint" style="color:#f0c43e">★ LEVEL UP — choose one:</div>` +
          game.levelUpOptions
            .map((o, i) => `<button class="lvl-btn" data-i="${i}">${o.label}</button>`)
            .join('');
        for (const b of Array.from(levelupEl.querySelectorAll<HTMLButtonElement>('.lvl-btn'))) {
          b.addEventListener('click', () => game.chooseLevelUp(Number(b.dataset.i)));
        }
      }
    } else if (levelUpRendered !== -1) {
      levelupEl.innerHTML = '';
      levelUpRendered = -1;
    }

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

    const ev = game.evolution;
    const creeps = ev.bomb
      ? 'CLIMB + BOMB'
      : ev.climb
        ? `climb · frustration ${ev.frustration}/${config.frustrationToBomb}`
        : 'naive';

    statsEl.textContent =
      `seed     ${game.seed === null ? '—' : seedToCode(game.seed)}\n` +
      `wave     ${game.wave}${game.waveActive ? ' (active)' : ''}\n` +
      `lives    ${game.lives}\n` +
      `money    ${money}\n` +
      `kills    ${game.kills}\n` +
      `leaks    ${game.leaks}\n` +
      `towers   ${game.towers.length}\n` +
      `creeps   ${creeps}\n` +
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
