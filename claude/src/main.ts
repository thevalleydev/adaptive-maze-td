import { Game } from './game';
import { buildPanel } from './ui';
import { codeToSeed, seedToCode, randomSeed } from './rng';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;

function readSeedFromUrl(): number {
  const p = new URLSearchParams(location.search).get('seed');
  return p ? codeToSeed(p) : randomSeed();
}

function writeSeedToUrl(seed: number | null) {
  const u = new URL(location.href);
  if (seed === null) u.searchParams.delete('seed');
  else u.searchParams.set('seed', seedToCode(seed));
  history.replaceState(null, '', u);
}

const seed = readSeedFromUrl();
const game = new Game(canvas, seed);
game.onSeedChange = writeSeedToUrl;
writeSeedToUrl(seed);

const refreshStats = buildPanel(panel, game);

// Fixed-timestep loop: the simulation advances in fixed dt steps regardless of
// framerate, so a run is deterministic given its seed + inputs — the basis for
// reproducible maps and (later) action replay.
const FIXED = 1 / 60;
let last = performance.now();
let acc = 0;
let frames = 0;
let fpsTimer = 0;

function frame(now: number) {
  let elapsed = (now - last) / 1000;
  last = now;
  if (elapsed > 0.25) elapsed = 0.25; // don't spiral after a tab-out
  acc += elapsed;
  while (acc >= FIXED) {
    game.update(FIXED);
    acc -= FIXED;
  }
  game.render();

  frames++;
  fpsTimer += elapsed;
  if (fpsTimer >= 0.5) {
    game.fps = frames / fpsTimer;
    frames = 0;
    fpsTimer = 0;
  }
  refreshStats();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
