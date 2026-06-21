import { World } from '../world';
import { config } from '../config';
import { Policy } from './policies';

export interface Metrics {
  policy: string;
  won: boolean;
  reachedWave: number;
  wavesCleared: number;
  firstLeakWave: number | null; // the "difficulty wall": first wave that costs lives
  livesRemaining: number;
  kills: number;
  collapses: number;
  towersWrecked: number;
  finalTowers: number;
  finalMoney: number;
  interventions: number; // reactive relocations the policy performed
  cracksPersisted: boolean; // did a crack ever survive into a between-wave breather?
  learnedClimb: boolean; // did the swarm learn to climb (was it forced)?
  learnedBomb: boolean; // did it escalate to bombing?
}

// Run one headless game under a policy until win / loss / time cap.
export function runGame(policy: Policy, opts: { dt?: number; maxSeconds?: number } = {}): Metrics {
  const dt = opts.dt ?? 1 / 60;
  const maxSteps = (opts.maxSeconds ?? 900) / dt;

  const world = new World();
  policy.onStart(world);
  world.start(); // leave the prep phase so waves run

  let firstLeakWave: number | null = null;
  let prevLeaks = 0;
  let collapses = 0;
  let towersWrecked = 0;
  let cracksPersisted = false;
  let wavesCleared = 0;
  let prevWaveActive = false;
  let steps = 0;

  // For measurement we stop at the target milestone (success) or death. The
  // browser game keeps playing past the target; the sim only cares if it got there.
  while (!world.gameOver && !world.reachedTarget && steps < maxSteps) {
    if (world.awaitingLevelUp) world.chooseLevelUp(0); // headless: take the first offer
    policy.onTick(world, dt);

    // Snapshot tower positions AFTER the policy acts; anything missing after the
    // world step was wrecked by a collapse (not sold by the policy).
    const snap = world.towers.map((t) => t.x * 1000 + t.y);
    world.update(dt);
    collapses += world.grid.justCollapsed.length;
    for (const key of snap) {
      if (!world.towers.some((t) => t.x * 1000 + t.y === key)) towersWrecked++;
    }

    if (world.leaks > prevLeaks) {
      if (firstLeakWave === null) firstLeakWave = world.wave;
      prevLeaks = world.leaks;
    }
    if (prevWaveActive && !world.waveActive) wavesCleared = world.wave;
    prevWaveActive = world.waveActive;
    if (
      !world.waveActive &&
      world.wave > 0 &&
      world.grid.tiles.some((t) => t.state === 'cracked' || t.state === 'collapsing')
    ) {
      cracksPersisted = true;
    }
    steps++;
  }

  if (world.reachedTarget) wavesCleared = config.targetWave;

  return {
    policy: policy.name,
    won: world.reachedTarget,
    reachedWave: world.wave,
    wavesCleared,
    firstLeakWave,
    livesRemaining: world.lives,
    kills: world.kills,
    collapses,
    towersWrecked,
    finalTowers: world.towers.length,
    finalMoney: Math.floor(world.money),
    interventions: policy.sells,
    cracksPersisted,
    learnedClimb: world.evolution.climb,
    learnedBomb: world.evolution.bomb,
  };
}
