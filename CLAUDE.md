# Repo guardrail — TWO SEPARATE VARIANTS

This repo contains two unrelated game variants. **All active work happens ONLY in `claude/`** (the TypeScript variant: towers gun/cannon/frost/vent/wall, headless sim in `claude/src/sim/`, co-evolution mechanics). Its own instructions live in `claude/CLAUDE.md`.

The root `src/` tree (`src/config.js`, `src/entities/`, `src/scenes/`) is a SEPARATE, older Phaser JS prototype. **Do not edit it, typecheck it, run it, or include it in commits** unless the user explicitly names the `src/` prototype.

**Rule:** Scope every edit, typecheck (`cd claude && npx tsc --noEmit`), sim run, and commit to `claude/` only. If a task seems to touch root `src/`, stop and confirm with the user first.
