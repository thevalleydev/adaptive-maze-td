// Tiny local score server: real SQLite (Node's built-in node:sqlite), no deps.
// The game POSTs a run summary; we store the full record (towers built/used,
// upgrades, level-ups, evolution, outcome) so we can later query "what wins".
//
// Run:  npm run scores   (from claude/)   → http://localhost:8787
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(HERE, 'scores.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER, seed TEXT, outcome TEXT,
    wave INTEGER, kills INTEGER, leaks INTEGER, livesLeft INTEGER, durationSec INTEGER,
    upgrades INTEGER, towersBuilt TEXT, towersFinal TEXT, levelUps TEXT, evolution TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_runs_seed ON runs(seed);
`);

const bestStmt = db.prepare(
  `SELECT MAX(wave) bestWave, MAX(kills) bestKills, COUNT(*) runs FROM runs WHERE seed = ?`,
);
const insertStmt = db.prepare(
  `INSERT INTO runs (ts,seed,outcome,wave,kills,leaks,livesLeft,durationSec,upgrades,towersBuilt,towersFinal,levelUps,evolution)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);
const topStmt = db.prepare(
  `SELECT ts,seed,outcome,wave,kills,durationSec,upgrades,towersBuilt,levelUps,evolution
   FROM runs ORDER BY wave DESC, kills DESC LIMIT 25`,
);
const summaryStmt = db.prepare(
  `SELECT COUNT(*) runs, SUM(outcome='reached') reached, MAX(wave) maxWave, ROUND(AVG(wave),1) avgWave FROM runs`,
);
const perSeedStmt = db.prepare(
  `SELECT seed, COUNT(*) runs, MAX(wave) bestWave, MAX(kills) bestKills FROM runs GROUP BY seed ORDER BY bestWave DESC, bestKills DESC LIMIT 30`,
);
const topBySeedStmt = db.prepare(
  `SELECT ts,seed,outcome,wave,kills,durationSec,upgrades,towersBuilt,levelUps,evolution
   FROM runs WHERE seed = ? ORDER BY wave DESC, kills DESC LIMIT 50`,
);

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
// Compact a {kind:count} map → "gun×8 wall×4" (non-zero only).
const towerSummary = (json) => {
  try {
    return (
      Object.entries(JSON.parse(json || '{}'))
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}×${n}`)
        .join(' ') || '—'
    );
  } catch {
    return '—';
  }
};
const evoSummary = (json) => {
  try {
    const e = JSON.parse(json || '{}');
    const t = [e.climb && 'climb', e.bomb && 'bomb', e.seek && 'seek', e.armor && `armor:${e.armor}`].filter(Boolean);
    return t.join('+') || 'naive';
  } catch {
    return '—';
  }
};

function renderPage(seedFilter) {
  const sum = summaryStmt.get() || {};
  const winRate = sum.runs ? Math.round((100 * (sum.reached || 0)) / sum.runs) : 0;
  const seeds = perSeedStmt.all();
  const top = seedFilter ? topBySeedStmt.all(seedFilter) : topStmt.all();

  const seedRows = seeds
    .map(
      (s) =>
        `<tr><td class="mono">${esc(s.seed)}</td><td>${s.runs}</td><td class="hi">${s.bestWave}</td><td>${s.bestKills}</td>
         <td><a href="/?seed=${encodeURIComponent(s.seed)}">runs ▸</a></td></tr>`,
    )
    .join('');

  const runRows = top
    .map(
      (r) =>
        `<tr>
          <td class="mono">${esc(r.seed)}</td>
          <td class="${r.outcome === 'reached' ? 'win' : 'loss'}">${r.outcome === 'reached' ? '★ reached' : 'died'}</td>
          <td class="hi">${r.wave}</td><td>${r.kills}</td><td>${r.durationSec}s</td><td>${r.upgrades}</td>
          <td class="dim">${esc(towerSummary(r.towersBuilt))}</td>
          <td class="dim">${esc(evoSummary(r.evolution))}</td>
        </tr>`,
    )
    .join('');

  return `<!doctype html><meta charset="utf-8"><title>Adaptive Maze TD — Scores</title>
<meta http-equiv="refresh" content="15">
<style>
  body{background:#0d1117;color:#c9d1d9;font:13px ui-monospace,Menlo,Consolas,monospace;margin:0;padding:24px;}
  h1{color:#58a6ff;font-size:18px;margin:0 0 4px;} h2{color:#8b949e;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:24px 0 8px;}
  .sum{color:#c9d1d9;margin-bottom:8px;} .sum b{color:#3fb950;}
  table{border-collapse:collapse;width:100%;} th,td{text-align:left;padding:5px 10px;border-bottom:1px solid #21262d;}
  th{color:#8b949e;font-weight:normal;} .mono{color:#79c0ff;} .hi{color:#f0c43e;font-weight:bold;} .dim{color:#8b949e;}
  .win{color:#3fb950;} .loss{color:#f85149;} a{color:#58a6ff;} .empty{color:#8b949e;margin:16px 0;}
</style>
<h1>Adaptive Maze TD — Scores</h1>
<div class="sum">${sum.runs || 0} runs &middot; <b>${winRate}%</b> reached target &middot; best wave <b>${sum.maxWave || 0}</b> &middot; avg ${sum.avgWave || 0} &middot; <span class="dim">auto-refreshes</span></div>
${seeds.length ? '' : '<div class="empty">No runs yet — play a game with the score server running.</div>'}
<h2>Best per seed</h2>
<table><tr><th>seed</th><th>runs</th><th>best wave</th><th>best kills</th><th></th></tr>${seedRows}</table>
<h2>Top runs${seedFilter ? ` — seed <span class="mono">${esc(seedFilter)}</span> · <a href="/">all</a>` : ''}</h2>
<table><tr><th>seed</th><th>outcome</th><th>wave</th><th>kills</th><th>time</th><th>upg</th><th>towers built</th><th>evolution</th></tr>${runRows}</table>`;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'content-type': 'application/json',
};
const send = (res, code, body) => res.writeHead(code, cors).end(JSON.stringify(body));

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/scores')) {
    return res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
      .end(renderPage(url.searchParams.get('seed') || undefined));
  }

  if (req.method === 'GET' && url.pathname === '/record') {
    const r = bestStmt.get(url.searchParams.get('seed') ?? '');
    return send(res, 200, { bestWave: r?.bestWave ?? 0, bestKills: r?.bestKills ?? 0, runs: r?.runs ?? 0 });
  }

  if (req.method === 'GET' && url.pathname === '/stats') {
    return send(res, 200, { top: topStmt.all() });
  }

  if (req.method === 'POST' && url.pathname === '/runs') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const s = JSON.parse(body);
        const prev = bestStmt.get(s.seed);
        const newBest = s.wave > (prev?.bestWave ?? 0) || (s.wave === (prev?.bestWave ?? 0) && s.kills > (prev?.bestKills ?? 0));
        insertStmt.run(
          Date.now(), s.seed, s.outcome, s.wave, s.kills, s.leaks, s.livesLeft, s.durationSec,
          s.upgrades, JSON.stringify(s.towersBuilt), JSON.stringify(s.towersFinal),
          JSON.stringify(s.levelUps), JSON.stringify(s.evolution),
        );
        send(res, 200, { newBest });
      } catch (e) {
        send(res, 400, { error: String(e) });
      }
    });
    return;
  }

  send(res, 404, { error: 'not found' });
});

const PORT = 8787;
server.listen(PORT, () => console.log(`score DB → http://localhost:${PORT}  (db: ${join(HERE, 'scores.db')})`));
