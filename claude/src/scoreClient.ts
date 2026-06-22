import type { RunSummary } from './world';
import * as local from './scores';

// Talks to the local score server (npm run scores). If it's not running, falls
// back to localStorage so the game still works offline — you just lose the
// cross-run analytics until the server is up.
const BASE = 'http://localhost:8787';

export interface Record {
  bestWave: number;
  bestKills: number;
  runs: number;
}

export async function postRun(summary: RunSummary): Promise<{ newBest: boolean }> {
  try {
    const r = await fetch(`${BASE}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(summary),
    });
    return await r.json();
  } catch {
    return local.recordRun(summary.seed, summary.wave, summary.kills);
  }
}

export async function getRecord(seedCode: string): Promise<Record | null> {
  try {
    const r = await fetch(`${BASE}/record?seed=${encodeURIComponent(seedCode)}`);
    const rec = (await r.json()) as Record;
    return rec.runs > 0 ? rec : null;
  } catch {
    const rec = local.getRecord(seedCode);
    return rec ? { bestWave: rec.bestWave, bestKills: rec.bestKills, runs: rec.runs } : null;
  }
}
