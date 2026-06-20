# Adaptive Maze TD — Pressure Prototype (v0.1)

A ruthlessly-scoped prototype built to answer **one question**:

> When the path shifts under pressure and I have to move a tower, does that feel
> *cool* or *annoying*?

Everything not serving that question (currency depth, upgrades, waves, multiple
tower/enemy types, the 5 game modes, terraformer/vent towers) is deliberately
cut. Towers are colored squares; enemies are dots.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

- **Left-click** an empty tile to build a tower (\$50). **Right-click** a tower to sell.
- **Towers *are* the maze** — they block the path (placement is rejected if it would fully seal the route).
- The right-hand panel has live sliders for every tuning knob and toggles for the heatmap / path preview / pause.

## The core idea this prototype is testing

Pressure doesn't kill you directly — **it erodes your fire lanes.** Enemies add
pressure to tiles they walk. Concentrating flow through a tight choke = max
damage, but pressure spikes there fast:

`normal → cracked (reversible) → collapsing (2s telegraph, reversible) → collapsed (permanent rubble)`

Collapsed tiles aren't impassable — they're expensive, slow rubble. So a
collapse doesn't softlock the map; it **reroutes the flow around your guns**,
quietly invalidating the maze you built. The telegraph + always-on heatmap make
it legible ("readable chaos"), and the reversible stages mean relocating/venting
*before* the timer ends actually saves the tile.

### What to watch for (does it feel cool?)

1. Build a tight choke and watch pressure climb red on the heatmap.
2. A tile starts pulsing (collapsing) — you have ~2s.
3. It collapses; the dashed path preview snaps to a new route.
4. Your towers are now aimed at dead ground. Do you feel clever relocating, or
   cheated? **That reaction is the entire result of this prototype.**

## Tuning notes

The defaults in `src/config.ts` are a starting guess, not balanced. The fastest
way to find the feel is to drag sliders live:
- **Pressure/sec ↑ + Decay/sec ↓** → faster, more aggressive collapses.
- **Telegraph (s)** → how much reaction time the player gets.
- **Avoid pressure** → how strongly enemies self-spread off hot tiles.
- **Rubble cost / Rubble speed** → whether enemies route *around* collapses or trudge through them.

## Architecture

| File | Responsibility |
|------|----------------|
| `src/config.ts` | All live-tunable knobs + slider metadata |
| `src/grid.ts` | Tiles, pressure accrual/decay, crack/collapse state machine, costs |
| `src/astar.ts` | 4-dir cost-aware A* (binary heap); rubble is costly, not blocked |
| `src/entities.ts` | `Enemy` (event-driven + low-freq repath), `Tower` (targets furthest-along) |
| `src/game.ts` | Loop, spawning, input, build validation, rendering |
| `src/ui.ts` | Slider/toggle panel + stats readout |
| `src/main.ts` | rAF loop, dt clamp, FPS |
| `src/smoketest.ts` | Headless sim of the DOM-free core (`esbuild ... && node`) |

### Key implementation decisions
- **Event-driven repath:** enemies only re-run A* when the graph version bumps
  (collapse / tower edit) or on a staggered ~1.2s timer — no per-frame jitter.
- **`graphVersion` bumps only on collapse**, not on crack/heal, so a tile
  oscillating at a threshold doesn't thrash every enemy's path.
- **Collapse = expensive rubble, never a hard wall** → the map is always
  solvable; no softlocks.

## Next experiments (in order)

1. **Vent tool** — click-drag to dump pressure in an area. The first real
   "adapt" verb; only worth adding once base collapse feels right.
2. **Sapper enemy** — adds bonus pressure, to stress the system intentionally.
3. **Shortcut collapse** — let collapse *open* a bypass through a player wall
   (the scarier, more aggressive version of the threat).
4. Only then: economy depth, upgrades, waves, more archetypes.
