# Kitesurf — working agreement

A 2D side-view endless kitesurfing game. Canvas 2D, TypeScript, Vite.
The design and technical spec is [kitesurf-game-spec.md](kitesurf-game-spec.md); the
build order is [BUILD-PLAN-collaborative.md](BUILD-PLAN-collaborative.md). The spec is
the source of truth — when this file and the spec disagree, the spec wins.

## Hard rules

**`/src/sim` is pure.** No DOM, no canvas, no `window`, no `Date.now()`, no
`Math.random()`. Nothing in `/src/sim` may import from `/src/render` or `/src/input`.
The sim must run headless in Node. This is what buys ghosts, replays, and
server-side replay validation, and it is painful to retrofit — a run is fully
described by `(seed, inputTrace)`. Randomness comes from a seeded `Rng` instance
([src/sim/rng.ts](src/sim/rng.ts)) passed in explicitly; never a module-level one.

**Fixed 60Hz timestep. Never tie physics to frame rate.** The sim advances only in
`DT = 1/60` increments through the accumulator in [src/sim/loop.ts](src/sim/loop.ts).
Rendering interpolates with the leftover alpha. No `dt` from `requestAnimationFrame`
ever reaches a physics formula directly.

**All constants live in [src/config/tuning.ts](src/config/tuning.ts).** Never inline a
magic number. If a formula needs a value, it gets a named entry in `TUNING` first.

**NEVER adjust a TUNING value to make a test pass.** The human owns those values. If a
test disagrees with a value, the test or the formula is wrong — report the conflict
instead of editing the constant.

**No physics library, no game engine. Canvas 2D only.** No Matter.js, no Planck, no
Phaser. Pixi/WebGL is a later migration decision, not a default.

**Zero allocation in the update loop.** Pre-allocate and pool. No object/array literals,
no closures, no `map`/`filter`/`spread` on a hot path. Sim functions mutate
pre-allocated state in place rather than returning fresh objects. No `localStorage`
reads in the loop.

## Working style

- **One task per commit.** Small, self-contained, described in the message.
- **Run `npm test` before every commit.** A red test is a stop, not a warning.

## Layout (spec §11.3)

```
/src
  /sim          pure, deterministic, no DOM, no rendering
    rider.ts    physics state machine
    kite.ts     slew, angle, window
    world.ts    spawning, waves, obstacles
    scoring.ts
    rng.ts      seeded mulberry32
    loop.ts     fixed-timestep accumulator, step()
  /input
    axis.ts     the one screen-point → 0..1 mapping both adapters share
    desktop.ts  → RiderInput
    touch.ts    → RiderInput
  /platform     the web shell of spec §5.4: orientation lock, audio unlock
  /render
    layers.ts   parallax
    draw*.ts
  /config
    tuning.ts   ALL constants, single object
/tests          vitest, mirrors /src
```

Every platform adapter produces the same `RiderInput` struct. No platform-specific
game logic anywhere.

## Commands

| | |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck + production build |
| `npm test` | vitest, single run |
| `npm run test:watch` | vitest, watch mode |
