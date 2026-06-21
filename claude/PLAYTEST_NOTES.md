# Playtest notes & design log

Chronological log of playtest feedback and decisions. Newest first.

## Status
- ✅ **Phase 1 (foundation)**: fixed-timestep loop + seeded map generation (spawn/exit +
  rock obstacles) + seed in URL + New/Replay/seed-input controls.
- ✅ **Phase 2**: tower **upgrades** (click own tower; per-level +dmg/+rate/+range) and the
  **Vent** tower (key 4 — drains nearby pressure, the counter to collapse).
- ✅ UX: tower buttons show live per-type cost and grey out when unaffordable.
- ⬜ Next: run **stats** screen → **action replay** (seed + input log) → unlocks → daily/leaderboards.

## Retention: why no urge to beat the high score? (KEY ISSUE)
Player reached wave 30 with no pull to replay. Root cause: every run is
byte-for-byte identical (fixed map/waves/towers, deterministic pressure), so a
replay is a re-run, not a fresh challenge — and the score buys nothing.

Direction (agreed): add run variety + a reason to chase the number.
1. **Seeded run variety (priority):** randomize map, spawn/exit, enemy mix, and
   pressure hotspots from a SEED. On-theme — the "living map" should fight back
   differently each run. State already lives in `World`, so this slots in cleanly.
2. Meta-progression / unlocks at milestones (new towers/enemies/maps/modifiers).
3. Per-run stakes + payoff (milestone mini-boss, visible high score, reward juice).
4. **Tower upgrades** (design doc: 3–5 tiers, optional branching). Adds build depth
   AND a money sink that competes with thick walls (helps the snowball problem).
   Synergy: an upgraded tower is costlier to lose, so collapse/relocation matters more.
5. **A 4th tower type.** Recommend the **Vent** (pressure manager) — the counter-verb to
   the collapse threat; completes the core loop and adds a real strategic dimension.
   Alt if a 4th *attacker* is preferred: armor-break (vs compounding HP), chain-lightning,
   or long-range sniper.
6. **Run stats** — end-of-run summary + lifetime profile (kills by type, towers built/lost,
   collapses caused, peak pressure, $ earned/spent, wave reached, time survived). The sim's
   `Metrics` interface already enumerates most of these — reuse it.
7. **Action replay** — record `seed + timestamped input events`; a replay is just the
   deterministic sim re-run against that log. Tiny + shareable, and makes leaderboard runs
   *verifiable* (replay the log on its seed → confirm the score).

### Keystone insight
Seeded variety, fair competition, stats, replays, and verifiable leaderboards are ONE
system built on **determinism** = seed + fixed timestep + input log. The core is already
`Math.random`/`Date`-free; the ONE gap is the browser loop uses a variable dt
(`main.ts`). Switching to a fixed-timestep accumulator makes replays bit-exact and unlocks
the whole cluster.

### Competition concern (user) + resolution
Pure randomization makes high scores unfair (easy vs brutal seeds). Resolution:
randomization is **seeded**, so every random map is a reproducible, shareable map.
Modes that fall out of one system:
- **Random / Endless** — new seed each run (novelty).
- **Daily Challenge** — one global seed per day; everyone competes on the same
  generated map (fair leaderboard — the "Wordle hook").
- **Shared seed** — enter/share a seed code or URL to replay any map or challenge
  a friend ("beat my run on seed X").

Requirement: generation must use a **seeded PRNG** (the core already has no
`Math.random`/`Date`, so determinism — and the sim's reproducibility — is preserved).
Caveat: real-time play means same-seed runs are a fair *challenge* (identical
map+waves), not bit-identical replays unless we later record inputs.

## Cannon felt worthless
DPS 11 (14×0.8) vs Gun 36 at higher cost; splash dead because grouping enemies
builds pressure → collapse → wrecked towers. Reworked into a heavy hitter:
dmg 14→45, fireRate 0.8→0.85 (≈38 DPS, ~Gun parity), splash 1.4→1.6, cost 95→85.

## Difficulty / scaling
- Static play walls ~wave 6; reactive sim bot ~wave 8; human reached wave 30 →
  linear HP scaling lets good players go nearly forever. Switched HP to
  **compounding** (`World.startWave`), `waveHpGrowth` now 0.12 (~5.5× @15, ~26× @30).
- Target wave 15 is a **milestone, not an end** — endless continues until death.
- The sim bot is a weak proxy for a skilled human (8 vs 30); treat its numbers as a
  floor for competent play, not a ceiling.
