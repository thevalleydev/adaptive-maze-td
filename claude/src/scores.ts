// Per-seed score persistence (localStorage, no server). Each seeded map remembers
// your best run, so a "random" map doubles as a replayable, score-chaseable one.
// Presentation-layer only — never touched by World/sim, so determinism is intact.

export interface SeedRecord {
  bestWave: number;
  bestKills: number;
  runs: number;
}

const KEY = 'amtd.scores.v1';

function loadAll(): Record<string, SeedRecord> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, SeedRecord>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage may be unavailable (private mode) — fail silent */
  }
}

export function getRecord(seedCode: string): SeedRecord | null {
  return loadAll()[seedCode] ?? null;
}

// Record a finished run for a seed. Returns whether it set a new best (by wave,
// then kills as tiebreak).
export function recordRun(seedCode: string, wave: number, kills: number): { newBest: boolean } {
  const all = loadAll();
  const cur = all[seedCode] ?? { bestWave: 0, bestKills: 0, runs: 0 };
  const newBest = wave > cur.bestWave || (wave === cur.bestWave && kills > cur.bestKills);
  all[seedCode] = {
    bestWave: Math.max(cur.bestWave, wave),
    bestKills: Math.max(cur.bestKills, kills),
    runs: cur.runs + 1,
  };
  saveAll(all);
  return { newBest };
}
