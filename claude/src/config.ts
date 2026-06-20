// All live-tunable knobs. Bound to sliders in ui.ts so the "feel" can be dialed
// in seconds without a recompile. This is the heart of the prototype: the whole
// point is to find numbers where the path shifting under pressure feels *cool*.

export interface Config {
  // --- Pressure ---
  pressureRate: number; // pressure added per enemy per second on its current tile
  decayRate: number; // pressure lost per tile per second (linear)
  crackThreshold: number; // pressure at which a tile cracks (reversible)
  collapseThreshold: number; // pressure at which a tile begins to collapse
  telegraphDuration: number; // seconds a tile spends "collapsing" before it goes
  pressureAvoidance: number; // how strongly enemies path around high-pressure tiles

  // --- Damage -> pressure coupling (the core "watch it fight back" loop) ---
  // Killing enemies is what destabilizes the ground beneath your killbox, so a
  // strong chokepoint cooks itself toward collapse and forces relocation.
  pressurePerDamage: number; // pressure added to a target's tile per point of damage dealt
  pressurePerKill: number; // burst of pressure dumped on the tile where an enemy dies

  // --- Pressure vs. towers ---
  // Pressure doesn't just crack the ground; it degrades your guns. A clustered
  // killbox slows its own fire and gets wrecked when adjacent ground collapses.
  pressureTowerDebuff: number; // max fraction of fire rate lost at full local pressure (0..1)

  // --- Decay model ---
  // Pressure should BUILD within a wave and mostly clear BETWEEN waves, so cracks
  // persist long enough to threaten collapse instead of healing mid-wave.
  betweenWaveDecay: number; // fraction of all pressure removed when a wave clears (0..1)
  crackHealMargin: number; // a crack only heals once pressure < crackThreshold - this (hysteresis)

  // --- Terrain cost / speed ---
  crackedCost: number;
  collapsedCost: number;
  crackedSpeedMult: number;
  collapsedSpeedMult: number;

  // --- Terrain regeneration ---
  // Collapsed rubble "fills back in" so the map keeps churning and a once-solved
  // lane becomes dangerous again. 0 = permanent (old behaviour, for A/B).
  rubbleHealTime: number; // seconds before a collapsed tile reverts to normal

  // --- Waves / run goal ---
  spawnInterval: number; // seconds between spawns within a wave
  interWaveTime: number; // breather between waves
  waveBaseCount: number; // enemies in wave 1
  waveCountGrowth: number; // extra enemies added per wave
  waveHpGrowth: number; // fractional HP increase per wave (0.25 = +25%/wave)
  targetWave: number; // survive (clear) this wave to WIN the run

  // --- Enemies ---
  enemySpeed: number; // base tiles per second (scaled per enemy type)
  enemyHp: number; // base HP at wave 1 (scaled per enemy type)

  // --- Building / economy ---
  spawnBuffer: number; // no-build radius (tiles) around the spawn mouth
  killRewardMult: number; // global multiplier on kill rewards (lower = tighter economy)
  towerCostGrowth: number; // each extra tower of a kind costs +this fraction of base
}

export const config: Config = {
  pressureRate: 9,
  decayRate: 1.5,
  crackThreshold: 30,
  collapseThreshold: 55,
  telegraphDuration: 2.5,
  pressureAvoidance: 3,

  pressurePerDamage: 0.1,
  pressurePerKill: 12,

  pressureTowerDebuff: 0.55,

  betweenWaveDecay: 0.35,
  crackHealMargin: 10,

  crackedCost: 1.5,
  collapsedCost: 40,
  crackedSpeedMult: 0.85,
  collapsedSpeedMult: 0.45,

  rubbleHealTime: 12,

  spawnInterval: 0.7,
  interWaveTime: 5,
  waveBaseCount: 8,
  waveCountGrowth: 1,
  waveHpGrowth: 0.18,
  targetWave: 12,

  enemySpeed: 2.4,
  enemyHp: 50,

  spawnBuffer: 2,
  killRewardMult: 1,
  towerCostGrowth: 0.08,
};

// View toggles (not part of the tuning model, but live).
export const view = {
  showHeatmap: true,
  showPath: true,
  paused: false,
  collapseWrecksTowers: true, // a tile collapsing destroys towers on adjacent tiles
};

// --- Tower types -------------------------------------------------------------
export type TowerKind = 'gun' | 'frost' | 'cannon';

export interface TowerDef {
  name: string;
  cost: number;
  damage: number;
  range: number;
  fireRate: number; // shots/sec at zero pressure
  color: string;
  hotkey: string;
  splashRadius?: number; // cannon: AoE radius in tiles
  slowAmount?: number; // frost: speed multiplier applied to hit enemies (e.g. 0.5)
  slowDuration?: number; // frost: seconds the slow lasts
}

export const TOWER_DEFS: Record<TowerKind, TowerDef> = {
  gun: { name: 'Gun', cost: 50, damage: 18, range: 2.6, fireRate: 2.0, color: '#1f6feb', hotkey: '1' },
  frost: {
    name: 'Frost',
    cost: 70,
    damage: 5,
    range: 2.3,
    fireRate: 1.5,
    color: '#3fd6ff',
    slowAmount: 0.5,
    slowDuration: 1.2,
    hotkey: '2',
  },
  cannon: {
    name: 'Cannon',
    cost: 95,
    damage: 14,
    range: 2.9,
    fireRate: 0.8,
    color: '#d29922',
    splashRadius: 1.4,
    hotkey: '3',
  },
};

export const TOWER_ORDER: TowerKind[] = ['gun', 'frost', 'cannon'];

// --- Enemy types -------------------------------------------------------------
export type EnemyKind = 'runner' | 'grunt' | 'brute';

export interface EnemyDef {
  name: string;
  hpMult: number;
  speedMult: number;
  reward: number;
  pressureMult: number; // movement-pressure contribution multiplier
  color: string;
  radius: number; // fraction of a tile
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  runner: { name: 'Runner', hpMult: 0.5, speedMult: 1.7, reward: 6, pressureMult: 0.8, color: '#f0c43e', radius: 0.2 },
  grunt: { name: 'Grunt', hpMult: 1.0, speedMult: 1.0, reward: 8, pressureMult: 1.0, color: '#f0883e', radius: 0.26 },
  brute: { name: 'Brute', hpMult: 3.2, speedMult: 0.62, reward: 18, pressureMult: 1.7, color: '#d9533b', radius: 0.34 },
};

// Slider metadata: [key, label, min, max, step]
export const sliders: [keyof Config, string, number, number, number][] = [
  ['pressureRate', 'Pressure / sec', 0, 30, 0.5],
  ['decayRate', 'Decay / sec', 0, 20, 0.5],
  ['crackThreshold', 'Crack at', 5, 100, 1],
  ['collapseThreshold', 'Collapse at', 10, 150, 1],
  ['telegraphDuration', 'Telegraph (s)', 0, 5, 0.1],
  ['pressureAvoidance', 'Avoid pressure', 0, 10, 0.5],
  ['pressurePerDamage', 'Pressure/dmg', 0, 1, 0.01],
  ['pressurePerKill', 'Pressure/kill', 0, 50, 1],
  ['pressureTowerDebuff', 'Tower debuff', 0, 1, 0.05],
  ['betweenWaveDecay', 'Wave-end decay', 0, 1, 0.05],
  ['crackHealMargin', 'Crack hysteresis', 0, 40, 1],
  ['collapsedCost', 'Rubble cost', 1, 100, 1],
  ['collapsedSpeedMult', 'Rubble speed x', 0.1, 1, 0.05],
  ['rubbleHealTime', 'Rubble heal (s)', 0, 60, 1],
  ['spawnInterval', 'Spawn gap (s)', 0.1, 3, 0.1],
  ['interWaveTime', 'Wave break (s)', 0, 15, 0.5],
  ['waveBaseCount', 'Wave 1 count', 1, 40, 1],
  ['waveCountGrowth', 'Count growth', 0, 10, 1],
  ['waveHpGrowth', 'HP growth/wave', 0, 1, 0.05],
  ['targetWave', 'Win at wave', 5, 30, 1],
  ['enemySpeed', 'Enemy speed', 0.5, 6, 0.1],
  ['enemyHp', 'Enemy HP (w1)', 10, 300, 5],
  ['spawnBuffer', 'No-build radius', 0, 5, 1],
  ['killRewardMult', 'Reward x', 0, 2, 0.05],
  ['towerCostGrowth', 'Cost growth', 0, 0.5, 0.01],
];
