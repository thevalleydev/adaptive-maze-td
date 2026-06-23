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
  PER_STEP:       3.2,   // pressure added each time an enemy steps onto a tile
  CRACK_AT:        30,   // tile cracks  → preferred path, visual damage
  COLLAPSE_AT:     80,   // tile collapses → passable breach, forces reroute
  DISSIPATE:      0.40,  // fraction removed at end of each wave (higher = faster natural recovery)
  BLEED_RATE:      2.5,  // pressure removed per in-wave bleed tick (unused tiles recover mid-wave)
  BLEED_INTERVAL: 6000,  // ms between in-wave bleed ticks
  PATH_JITTER:    0.20,  // per-tile cost noise — each enemy finds a slightly different route
};

// ── Economy ──────────────────────────────────────────────────────────────────
export const ECONOMY = {
  START_GOLD:       200,
  KILL_REWARD:       10,
  TOWER_COST:        30,
  LIVES:             20,
  WAVE_BONUS_BASE:   25,
  WAVE_BONUS_INCR:    6,
  REPAIR_COST:       25,  // cost to restore a cracked tile (mid-wave only)
};

// ── Waves ───────────────────────────────────────────────────────────────────
export const WAVE = {
  SPAWN_DELAY: 900,    // ms between enemy spawns
  BASE_COUNT:    5,
  COUNT_INCR:    3,
};

// ── Enemy scaling ────────────────────────────────────────────────────────────
// Enemy stats per wave:  stat = BASE + wave * INCR
export const ENEMY = {
  BASE_SPEED:     60,
  SPEED_INCR:      7,
  BASE_HP:        80,   // wave 1 = 160hp, wave 5 = 280hp
  HP_INCR:        32,
  PRESSURE_SCALE: 0.10,
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
  vent: {
    label:        '💨 Vent',
    cost:         45,
    range:        105,  // ~2.5 tile radius
    damage:       0,
    fireRate:     0,
    color:        0x44ffcc,
    damageType:   'none',
    ventDrain:    3,    // pressure removed per tile per vent tick
    ventInterval: 2500, // ms between vent ticks
  },
};

// ── Upgrade branches (chosen at level 3) ──────────────────────────────────────
// Each tower type has two specialization paths — A and B.
// Choosing a branch costs 2× the tower's base cost.
// After branching, levels 4-5 apply branch-specific boosts.
export const UPGRADE_BRANCHES = {
  basic: {
    A: { name: '🔥 Cannon',   desc: '×2 dmg  ×0.5 rate — slow heavy hits', dmgMult: 2.0, rateMult: 0.5 },
    B: { name: '⚡ Minigun',  desc: '×2.5 rate  ×0.5 dmg — spray & pray',  dmgMult: 0.5, rateMult: 2.5 },
  },
  sniper: {
    A: { name: '🛡 Anti-Armor', desc: '×1.5 dmg · 80% armor pierce',         dmgMult: 1.5, armorPierce: 0.80 },
    B: { name: '💀 Execute',    desc: '×3 dmg vs targets below 30% HP',      executeMult: 3.0, executeThreshold: 0.30 },
  },
  slow: {
    A: { name: '🧊 Deep Freeze', desc: '30% speed · 4s · much stronger slow', slowFactor: 0.30, slowDuration: 4000 },
    B: { name: '❄ Blizzard',    desc: '+30% range · slows ALL enemies in range', rangeMult: 1.3, aoeMode: true },
  },
  vent: {
    A: { name: '🌬 Cyclone',    desc: '×2.5 drain · 2.5× faster ticking',   drainMult: 2.5, intervalMult: 0.4 },
    B: { name: '⚡ Shockwave',  desc: 'Each vent tick deals 8 damage',        ventDamage: 8 },
  },
};
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
