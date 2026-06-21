# Adaptive Maze TD — Claude prototype

A pressure/collapse tower-defense prototype. This file is the canonical context for
any session working in this folder. (Built by Claude in parallel with a Copilot effort
in a sibling folder — keep all Claude work under `claude/`.)

## Design goal (don't lose this)

- A **bounded run of ~10–15 waves** with a **win condition** (clear `targetWave`, default
  12). NOT endless survival — the user wants short, intense, replayable runs.
- The difficulty must come from the **pressure/collapse mechanic**, NOT a vanilla
  tower-DPS-vs-HP race. Killing builds pressure → tiles crack → collapse → the path
  reroutes off your guns AND collapses wreck adjacent towers. "Build the maze, watch it
  fight back." If collapses never fire in real play, the concept has failed — verify they
  do in the mid-game.

### Pillars
The map is alive · readable chaos (always-on heatmap, telegraphed collapse) · no solved
layouts (a static killbox should cook itself and force relocation).

## How to run

```bash
npm install
npm run dev      # browser game at http://localhost:5173
npm run sim            # headless balance sim @ current defaults, all policies
npm run sim -- --sweep # parameter sweep -> console table + sim/results.{csv,json}
npm run sim -- --layout choke --policy static   # single layout/policy
```

Smoke test of the DOM-free core: `npx esbuild src/smoketest.ts --bundle --platform=node
--format=esm --outfile=_smoke.mjs && node _smoke.mjs`. Typecheck: `npx tsc --noEmit`.

## Architecture

- `src/world.ts` — **all simulation state + logic** (waves, spawning, pressure, collapse,
  economy, win/lose). No DOM. The browser game and the sim run this exact code.
- `src/game.ts` — thin presentation layer over a `World`: canvas rendering + mouse/keyboard
  input only. No game logic.
- `src/grid.ts` — tiles, pressure decay model, crack/collapse state machine, rubble
  regeneration, A* costs.
- `src/astar.ts` — 4-dir cost-aware A* (rubble is costly, not impassable → no softlocks).
- `src/entities.ts` — `Enemy` (event-driven + periodic repath), `Tower` (targets
  furthest-along; pressure degrades fire rate; splash/slow).
- `src/config.ts` — every tunable knob + slider metadata + `TOWER_DEFS` / `ENEMY_DEFS`.
- `src/ui.ts` — slider/toggle panel.
- `src/rng.ts` — seeded PRNG (mulberry32) + seed/code helpers. Map generation uses it.
- `src/sim/` — `policies.ts` (Static layouts incl. the user's spawnBox, + a Reactive bot),
  `metrics.ts` (per-run stats + difficulty-wall detection), `sweep.ts`, `run.ts` (CLI).

Determinism: the core has no `Math.random`/`Date`; map gen uses a seeded RNG and the
browser loop is **fixed-timestep** (`main.ts`), so a run is reproducible from its seed.
The sim constructs `new World()` (seed `null` = classic centered empty map, no rocks).

Seeded runs: `?seed=<code>` in the URL (or the panel's New/Replay/seed input). A seed
fixes the spawn/exit positions, scattered rock obstacles, and is the basis for shareable
maps + future daily challenges. Upgrades: click your own tower to level it up (per-level
+dmg/+rate/+range; Vent gets +drain). Vent tower (key 4) drains nearby pressure — the
counter to collapse.

## Balance model & findings (from the sim)

- **Static / relaxed play hits a hard wall around wave ~6** across all tunings (it dies to
  leaks once the ramp outpaces a fixed maze). So "you must start adapting" lands ~wave 5.
- **Skilled adaptive play** (the Reactive bot: relocate towers before they're wrecked, keep
  the lane covered on cool ground) can reach wave 12.
- **`towerCostGrowth` cleanly controls whether skilled play can finish:** 0 ≈ comfortable
  win, ~0.08 ≈ knife's-edge (1 life), ~0.12 ≈ falls short at wave 9–11.
- Collapse must actually fire mid-game. The levers that activate it: `pressurePerKill`,
  `collapseThreshold` (lower = fires sooner), `betweenWaveDecay` (lower = pressure carries
  across waves). Earlier defaults had it tuned out of existence.

When tuning, re-run `npm run sim -- --sweep` and check: static dies ~6, reactive reaches the
target but barely, and collapses/cracks are non-zero in mid/late waves.

## Deferred / next ideas

- **Heat-meter + Vent tower**: make tower stress a direct, visible per-tower meter (firing +
  local pressure → heat → jams), with a Vent tower that cools it. This is the legible
  version of "pressure erodes your hardware" and the obvious counter-verb. Measure current
  mechanics first, then add.
- Juicier collapse FX; smarter Reactive policy; more enemy/tower variety.

## Collaboration note

Exploratory design collaboration — prefer focused prose questions or a stated
recommendation over rigid multiple-choice prompts.
