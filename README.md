# Kitesurf

A 2D side-view endless kitesurfing game. Ride an endless ocean, work the kite through
the wind window to build speed, load your edge, and launch off wave faces. Wind rises
with distance. Hit a boat and the run is over.

The core tension: **a kite low in the window gives power and speed, a kite at zenith
gives lift but no drive.** You cannot have both.

Canvas 2D, TypeScript, Vite. No game engine, no physics library.

## Getting started

```bash
npm install
npm run dev
```

## Commands

| | |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck + production build |
| `npm test` | vitest, single run |
| `npm run test:watch` | vitest, watch mode |

## Layout

```
/src
  /sim      pure, deterministic simulation — no DOM, no rendering
  /input    platform adapters, all producing the same RiderInput
  /render   canvas drawing and parallax layers
  /config   tuning.ts — all constants
  /debug    live tuning panel
/tests      vitest, mirrors /src
```

## Architecture notes

- **`/src/sim` is pure.** No DOM, no `Math.random()`, no `Date.now()`. It runs headless
  in Node, and a run is fully described by `(seed, inputTrace)` — which is what makes
  ghosts, replays, and replay validation possible.
- **Fixed 60Hz timestep.** Physics advances only in `DT = 1/60` increments; rendering
  interpolates with the leftover alpha.
- **All constants live in [src/config/tuning.ts](src/config/tuning.ts).**

## Docs

- [kitesurf-game-spec.md](kitesurf-game-spec.md) — design and technical spec (source of truth)
- [BUILD-PLAN-collaborative.md](BUILD-PLAN-collaborative.md) — build order
- [CLAUDE.md](CLAUDE.md) — working agreement and hard rules
