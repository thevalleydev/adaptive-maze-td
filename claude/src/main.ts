import { Game } from './game';
import { buildPanel } from './ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;

const game = new Game(canvas);
const refreshStats = buildPanel(panel, game);

let last = performance.now();
let frames = 0;
let fpsTimer = 0;

function frame(now: number) {
  let dt = (now - last) / 1000;
  last = now;
  // Clamp dt so an alt-tab pause doesn't fast-forward the whole sim.
  if (dt > 0.1) dt = 0.1;

  game.update(dt);
  game.render();

  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    game.fps = frames / fpsTimer;
    frames = 0;
    fpsTimer = 0;
  }
  refreshStats();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
