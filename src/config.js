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
  START_GOLD:  150,
  KILL_REWARD: 10,
  TOWER_COST:  30,
  LIVES:       20,
};

// ── Waves ───────────────────────────────────────────────────────────────────
export const WAVE = {
  SPAWN_DELAY: 850,   // ms between enemy spawns
  BASE_COUNT:  5,     // enemies in wave 1
  COUNT_INCR:  3,     // extra enemies per wave
};
