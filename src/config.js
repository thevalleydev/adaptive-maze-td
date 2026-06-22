// ── Grid dimensions ────────────────────────────────────────────────────────
export const COLS = 20;
export const ROWS = 13;
export const TILE = 42;       // px per tile

// ── Canvas layout ───────────────────────────────────────────────────────────
export const UI_W = 224;      // right-side panel width
export const W    = COLS * TILE + UI_W;
export const H    = ROWS * TILE;

// ── Special tiles ───────────────────────────────────────────────────────────
export const SPAWN = { col: 0,       row: Math.floor(ROWS / 2) };  // col 0,  row 6
export const EXIT  = { col: COLS - 1, row: Math.floor(ROWS / 2) }; // col 19, row 6

// ── Pressure system ─────────────────────────────────────────────────────────
export const PRESSURE = {
  PER_STEP:    2.0,   // pressure added each time an enemy steps onto a tile
  CRACK_AT:    45,    // tile cracks  → higher path cost, visual damage
  COLLAPSE_AT: 80,    // tile collapses → impassable, forces reroute
  DISSIPATE:   0.40,  // fraction removed at end of each wave
};

// ── Economy ──────────────────────────────────────────────────────────────────
export const ECONOMY = {
  START_GOLD:       150,
  KILL_REWARD:        8,   // was 10 — less gold per kill
  TOWER_COST:        30,
  LIVES:             20,
  WAVE_BONUS_BASE:   15,   // gold bonus at end of each wave: BASE + wave * INCR
  WAVE_BONUS_INCR:    5,   // was 8 — slower gold ramp between waves
};

// ── Waves ───────────────────────────────────────────────────────────────────
export const WAVE = {
  SPAWN_DELAY: 700,    // was 850 — faster spawning = more pressure
  BASE_COUNT:    6,    // was 5 — more enemies from the start
  COUNT_INCR:    4,    // was 3 — ramps faster each wave
};

// ── Enemy scaling ────────────────────────────────────────────────────────────
// Enemy stats per wave:  stat = BASE + wave * INCR
export const ENEMY = {
  BASE_SPEED:     70,   // was 68
  SPEED_INCR:      9,   // was 7  — enemies get faster faster
  BASE_HP:        65,   // was 55
  HP_INCR:        42,   // was 28 — HP ramps much harder
  PRESSURE_SCALE: 0.10, // was 0.08
};

// ── Tower types ──────────────────────────────────────────────────────────────
export const TOWERS = {
  basic: {
    label:      '🔧 Basic',
    cost:       30,
    range:      130,
    damage:     22,
    fireRate:   1.2,
    color:      0x4488ff,
    damageType: 'physical',
  },
  sniper: {
    label:      '🎯 Sniper',
    cost:       50,
    range:      230,
    damage:     65,
    fireRate:   0.45,
    color:      0x44cc44,
    damageType: 'physical',
  },
  slow: {
    label:        '❄ Slow',
    cost:         40,
    range:        110,
    damage:       10,
    fireRate:     2.0,
    color:        0x88aaff,
    damageType:   'cold',
    slowFactor:   0.55,  // target moves at 55% speed
    slowDuration: 1500,  // ms
  },
};

// ── Creep types ───────────────────────────────────────────────────────────────
// Each type defines stat multipliers and which traits it can organically develop.
// Add new entries here to introduce new creep archetypes.
export const CREEP_TYPES = {
  normal: {
    label:       'Creep',
    color:        0xdd2222,
    radiusMult:   1.0,    // fraction of TILE * 0.27
    speedMult:    1.0,
    hpMult:       1.0,
    rewardMult:   1.0,
    pressureMult: 1.0,
    // Which traits this type can organically develop (subset of armor/heated/evasive)
    canAdapt:    ['armor', 'heated', 'evasive'],
  },
  // Future types — uncomment and tune to add new archetypes:
  // tank: {
  //   label: 'Tank', color: 0x886644, radiusMult: 1.5,
  //   speedMult: 0.50, hpMult: 3.5, rewardMult: 2.5, pressureMult: 2.0,
  //   canAdapt: ['armor'],
  // },
  // scout: {
  //   label: 'Scout', color: 0xaadd22, radiusMult: 0.75,
  //   speedMult: 2.0, hpMult: 0.45, rewardMult: 0.8, pressureMult: 0.4,
  //   canAdapt: ['evasive'],
  // },
};

// ── Creep Master ──────────────────────────────────────────────────────────────
export const MASTER = {
  // Organic per-hit buildup rates (how fast a creep adapts mid-combat)
  ARMOR_PER_HIT:      0.022,  // physical damage event → armor buildup
  EVASION_PER_SNIPE:  0.055,  // sniper hit → evasion buildup
  HEAT_PER_SLOW:      0.09,   // slow application → heat buildup
  // Hard caps on each trait (0–1)
  ARMOR_MAX:          0.55,
  HEAT_MAX:           0.72,
  EVASION_MAX:        0.40,
  // Pressure amplifies adaptRate at spawn (ancestral memory)
  // adaptRate = 1.0 + (maxPressure / 100) * PRESSURE_BOOST
  PRESSURE_BOOST:     1.8,    // at full pressure, adaptation is 2.8× faster
  // Starting buildup fraction given to spawns (generational head-start)
  HEADSTART_FRAC:     0.18,   // 18% of max cap transferred from pressure to spawn buildup
  ESCALATION_EVERY:   3,
  BOMBER_HP_MULT:     3.0,
  BOMBER_SPEED_MULT:  0.55,
};
