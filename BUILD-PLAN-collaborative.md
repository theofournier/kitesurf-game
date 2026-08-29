# Build Plan — You + Claude Code

**Companion to** `kitesurf-game-spec.md`
**Division of labour** Claude Code writes all code and tests. You play the game and own every tuning value.
**Format** One session per step. Each has a prompt to paste, a verification check, and your part.

---

## How this works

**Claude Code's job:** implement systems from the spec, write unit tests for everything assertable, keep the sim headless and deterministic, wire up the debug panel.

**Your job:** play the game, decide whether it feels right, and set every number in `tuning.ts`. Claude Code never touches tuning values — it will try, and the prompts below tell it not to. This split matters because the agent can produce a mathematically correct game that is completely dead, and it cannot detect that.

### Session rhythm

One step per session. `/clear` between steps — accumulated debugging context from step 3 makes the agent reason about superseded code in step 4. Starting fresh and re-reading the spec costs a few thousand tokens and is always worth it.

Branch per step: `git checkout -b s04-pop`. A bad session is then one `git checkout` away from gone.

### Setup, once

```bash
mkdir kitesurf && cd kitesurf && git init
# copy kitesurf-game-spec.md and this file into the root
git add . && git commit -m "docs: spec and build plan"
claude
```

---

# Part 1 — Foundations

## Session 0 — Bootstrap

```
Read kitesurf-game-spec.md, sections 11 and 12.

Scaffold the project:
- Vite + TypeScript (vanilla-ts template)
- Add vitest and tweakpane as dev dependencies
- Scripts: dev, build, test, test:watch
- Directory structure exactly as in spec §11.3
- /src/config/tuning.ts containing the TUNING object from spec §12,
  copied verbatim with no adjustments
- /src/sim/rng.ts — seeded mulberry32, no global state
- /src/sim/loop.ts — fixed timestep accumulator, pure step(state, input, dt)

Write tests:
- Two Rng(12345) instances produce identical 1000-value sequences
- 100 step() calls at dt=1/60 advance a counter to exactly 100

Then write CLAUDE.md at the repo root containing:
- /src/sim is pure: no DOM, no canvas, no window, no Date.now(), no Math.random()
- Fixed 60Hz timestep, never tie physics to frame rate
- All constants live in /src/config/tuning.ts, never inline a magic number
- No physics library, no game engine, Canvas 2D only
- Zero allocation in the update loop
- NEVER adjust a TUNING value to make a test pass. The human owns those
  values. If a test disagrees with a value, the test or the formula is
  wrong — report the conflict instead.
- One task per commit, run npm test before every commit

Do not build any game logic yet.
```

**Check:** `npm test` passes. `npx tsc --noEmit` clean. `CLAUDE.md` contains the tuning rule verbatim.

---

## Session 1 — Debug panel first

```
Read CLAUDE.md.

Build the debug panel before any game logic. Behind ?debug=1:
- Tweakpane with a live slider for every numeric value in TUNING
- Sliders write directly to the TUNING object at runtime
- Sensible min/max per value (roughly 0.25x to 4x the default)
- A "copy values" button that dumps current TUNING as pasteable TypeScript
- A readout panel, empty for now, that will show sim state

Also set up the canvas: DPR capped at 2, resize handling, 60fps render loop
wired to the fixed-step accumulator from loop.ts.
```

**Check:** `?debug=1` shows sliders. The copy button produces valid TypeScript.

**Why first:** you are about to spend most of your project time adjusting numbers. Doing that through code edits and reloads will cost you a week and most of your enthusiasm.

---

# Part 2 — The wind window

## Session 2 — Kite and drive

```
Read kitesurf-game-spec.md §3.2 and §3.3, and CLAUDE.md.

Implement in /src/sim/kite.ts and /src/sim/rider.ts:
- Kite slew toward kiteTarget at slewRate, with wind scaling (§3.2)
- Overshoot: sweeps over 60 degrees carry ~8 degrees past target and
  settle within 0.2s. Sweeps under 60 degrees never overshoot.
- driveFactor and liftFactor exactly as specified (§3.3)
- Speed integration with quadratic drag

Tests:
- From theta=0, target=90, at 12kt: reaches 90 in 1.0s +/- 1 frame
- slewRate at 35kt is approximately 145 deg/s
- driveFactor(0) is approximately 0
- driveFactor peaks between 45 and 55 degrees
- liftFactor(0) = 1, liftFactor(90) approximately 0
- Held at theta=50 at 12kt from rest, speed converges to within 10% of
  terminal in under 8s without oscillating
- Terminal speed at 35kt does not exceed MAX_SPEED
- kiteAngle never leaves [0, 90]

No rendering in this session.
```

**Check:** all tests green, `/src/sim` has zero DOM references.

---

## Session 3 — Draw it

```
Read kitesurf-game-spec.md §5.2, §6.2, §6.3, §6.4.

Minimal renderer, grey boxes only, no art:
- Horizon line, water line, scrolling water texture to convey speed
- Rider as a 48px rectangle anchored at 30% screen width
- Kite as a quad on a fixed 264px radius arc above the rider
- The window arc drawn faintly — it is both the visual and the control surface
- Two kite lines as quadratic Beziers with sag proportional to inverse
  tension: slack and curved at zenith, dead straight when loaded (§6.3)
- Mouse input per §5.2: absolute mapping, pointer angle clamped to arc,
  system cursor hidden, faint ghost marker showing target position

Wire the debug readout to show: kiteAngle, kiteTarget, speed, wind.
```

**Check:** 60fps. Kite tracks the mouse with visible lag. Lines visibly slacken at zenith.

---

## ▶ YOUR TURN 1 — Does the window have weight?

Play for twenty minutes. Just sweep the kite. No jumping exists yet.

**The question:** does moving the kite from 3 o'clock to 12 and back feel like moving something with mass?

Open `?debug=1` and work these three sliders:

| Symptom | Slider | Direction |
|---|---|---|
| Kite feels floaty, weightless | `BASE_SLEW` | down |
| Kite feels sluggish, unresponsive | check `DRAG_K` first, then `BASE_SLEW` | down / up |
| Speed changes feel mushy | `DRIVE_K` up, `DRAG_K` down | — |
| Speed changes too abruptly | `DRAG_K` up | — |

When it feels right, hit the copy button and:

```
Persist these TUNING values, replacing the current ones:

[paste]

Commit as "S03.tune: window feel from playtest". Do not change anything else.
```

**Do not skip this.** Everything downstream inherits this feel.

---

# Part 3 — The trick loop ⚠️ kill gate ahead

## Session 4 — Load and pop

```
Read kitesurf-game-spec.md §3.4 and §3.5.

Implement:
- Load accumulation while input held, scaled by speed (§3.4)
- Stall: holding past 1.0 for more than STALL_GRACE drops speed 40%,
  resets load, forfeits the pop
- Pop impulse on release (§3.5)
- Flat-water height hard-capped at FLAT_POP_CAP

Input: space or LMB, support both. Steering stays always-on — the load
input must not gate steering.

Tests:
- Load at zero speed accumulates approximately 0
- Load at MAX_SPEED reaches 1.0 in approximately 0.71s
- Load caps at 1.0
- Holding past 1.0 for over 0.4s triggers stall with all its effects
- Release at theta=90 with load=1.0 gives near-zero impulse
- Release at theta=0 with load=0 gives zero impulse
- Flat-water peak height never exceeds FLAT_POP_CAP at any wind
- Peak height is monotonically increasing in load for fixed theta
```

**Check:** the last test is the important one — it proves load actually matters.

---

## Session 5 — Air and landing

```
Read kitesurf-game-spec.md §3.6, §3.7, §6.4.

Implement:
- Air phase with float: kite at zenith extends hangtime, kite dropped
  shortens it (§3.6)
- No horizontal acceleration while airborne at any kite angle
- Landing evaluation state machine (§3.7):
  RIDING -> LOADING -> AIRBORNE -> (LANDING | WIPEOUT) -> RIDING
- Camera vertical follow at 0.6x altitude, damped (§6.4)
- Kite allowed to exit frame at apex with lines running off-screen
- Debug readout: altitude, vSpeed, load, state

Tests:
- Same pop, kite at zenith for whole air vs dropped immediately:
  hangtime differs by 15% +/- 3%
- Horizontal speed never increases while airborne
- Table-driven test covering every row of the §3.7 landing table:
  clean, sketchy, kite-parked wipeout, hard-descent wipeout
- Landing state is entered exactly once per air, never twice

Add clear visual feedback for landing quality — this must be readable
without the debug HUD. Clean vs sketchy vs wipeout should be obvious
from the screen alone.
```

**Check:** a 4m jump and a 12m jump are visually distinguishable without reading the number.

---

## ▶ YOUR TURN 2 — ⚠️ THE KILL GATE

Play a full session. Ten minutes minimum, properly.

**The question: is this fun with rectangles?** No waves, no obstacles, no score, no art.

If the answer is no, **do not continue building.** This is where most abandoned game projects kept going anyway. The failure is almost always one of three things:

**Pop timing has no window** — if any release produces a similar jump, there's no skill in it.
```
The pop has no timing window — releasing at different moments produces
similar heights, so there's no skill expression. Diagnose at the formula
level. Consider: raising the liftFactor exponent, making load decay after
its peak, or narrowing the useful theta band on release.

Propose changes to formulas, not to TUNING values. Explain the reasoning
before writing code.
```

**Landing is invisible** — if you can't tell clean from sketchy without the HUD, the mechanic doesn't exist for the player. This is a feedback problem, not a physics one.
```
Landing quality isn't readable from the screen. Add feedback that makes
clean, sketchy, and wipeout unmistakable without the debug HUD:
screen shake scaled to landing quality, a speed-loss visual on sketchy,
spray particles on clean. No physics changes.
```

**Height doesn't read** — tune `CAM_ALT_FOLLOW` before touching any physics.

### The tuning session

This is your first long one. Expect an hour. Work in this order — later values depend on earlier ones:

1. `POP_K` — get maximum flat-water height to roughly 5m
2. `LOAD_RATE` — how long a full edge takes. Too fast and there's no commitment; too slow and it's tedious
3. `STALL_GRACE` — how punishing over-holding is
4. `FLOAT_K` — should give about 15% hangtime swing, no more. If air feels too controllable, lower it
5. `SOFT_LAND` / `HARD_LAND` and the landing bands — how forgiving touchdown is
6. `CAM_ALT_FOLLOW` — last, purely visual

Then persist and commit as `S05.tune`.

**Done when:** you fail a landing and immediately want to try again.

---

# Part 4 — Kickers

## Session 6 — Waves and lip timing

```
Read kitesurf-game-spec.md §4 in full.

Implement:
- Wave entities: position, type (chop / wave / wake), ramp height, lip position
- kickerBonus from release timing relative to the lip (§4.2)
- Wave contributes its own upward ramp velocity on takeoff, separate
  from the bonus multiplier
- Rendering: waves visible well ahead, with the lip clearly telegraphed —
  a foam line, colour shift, or highlight on the steepest part of the face

Tests:
- kickerBonus at delta-t = 0 equals the type's max bonus exactly
- At delta-t = 0.30s, bonus = 1.0
- At delta-t = 0.12s, bonus is at least 85% of max
- Bonus is never below 1.0 or above max
- Height ceilings match the §4.4 table within 10%, at both 12kt and 35kt,
  for all three wave types
- At MAX_SPEED, a wave is on screen at least 1.5s before its lip is reached
```

---

## ▶ YOUR TURN 3 — Does nailing a wake pop feel earned?

The three-way convergence — load near max, kite arriving at zenith, rider at the lip — is the skill peak of the whole game.

**The question:** when you hit it, does it feel like an achievement? When you miss, is it clear *why*?

If misses feel arbitrary, the lip telegraph is too weak. **Fix the rendering, not `KICKER_WINDOW`.** Widening the window makes the game easier without making it clearer, and trades away your skill ceiling to patch a visibility bug.

```
Misses feel random — I can't tell why I missed the lip. Strengthen the
telegraph: make the lip position unmistakable as the wave approaches.
Do not change KICKER_WINDOW.
```

Tune the three bonus values so the gap between wave and wake feels worth chasing. Commit as `S06.tune`.

---

# Part 5 — Mobile

## Session 7 — Input abstraction and touch

```
Read kitesurf-game-spec.md §5.1, §5.3, §5.4.

First refactor: both input adapters must emit the RiderInput struct (§5.1).
The sim must not know which platform it is on.

Test: driving the sim with a synthetic RiderInput trace produces results
identical to a mouse-driven trace with the same values. Assert that no
window or document reference exists anywhere under /src/sim.

Then build the two-thumb touch adapter (§5.3):
- Left thumb drags along the window arc, absolute mapping, generous hit slop
- Right third held anywhere sets loading
- Two simultaneous touches tracked independently
- 44px minimum targets

Plus all of §5.4: touch-action none, overscroll-behavior none, user-select
none, orientation lock with rotate prompt fallback, audio context unlocked
on first touch, DPR capped at 2.
```

---

## ▶ YOUR TURN 4 — Phone test

**On real low-end Android hardware. Not Chrome's device emulator.**

**The question:** does thumb drag give enough angular precision for the lip timing window?

Check that nothing scrolls, zooms, or pull-to-refreshes. If precision is short:

```
Thumb precision isn't sufficient for lip timing. Implement a non-linear
arc mapping with more angular resolution near zenith, where the timing
window matters, and less at the window edge. Keep the mapping absolute.
```

Finding this out now rather than in month three is the entire reason this step sits here.

---

# Part 6 — The run

## Session 8 — Obstacles and fair spawning

```
Read kitesurf-game-spec.md §9.

Implement obstacles (§9.1) and the procedural spawn generator (§9.2),
seeded per run.

The fairness guarantee is the most important part of this session.
Every spawn must satisfy:
  timeToImpact >= REACTION_MIN + popSetupTime(currentSpeed)
If a candidate spawn fails, push it further out.

Every boat spawns with its wake kicker positioned so that a well-timed
pop off the wake clears the boat.

Tests:
- Fuzz: 10,000 seeded runs at randomised speeds and wind tiers. Assert
  ZERO spawns violate the fairness inequality. No tolerance.
- Assert by simulation, not by construction, that a perfect wake pop
  clears its boat — actually run the sim and check.

Show me your approach before writing code.
```

**Check:** read its plan before it starts. This is the subtlest logic in the project, and player-controlled speed makes it much harder than a constant-speed runner.

---

## Session 9 — Tiers, crashes, scoring

```
Read kitesurf-game-spec.md §7 and §8.

Implement:
- Wind tiers scaling on distance, continuous interpolation, tier
  boundaries for feedback and scoring (§7.1)
- Wipeout vs fatal crash split (§7.2), including the relaunch beat:
  kite down in the water, steer it back to the window edge, ~2s
- Scoring, combo, clearance bonus (§8)

Tests:
- Combo decays exactly 1 per 150m without a landed trick
- clearanceBonus at exactly 0.75m clearance = 1.0; at 0m = 1.5
- Same seed plus same input trace produces an identical score,
  asserted across 100 runs
```

---

## Session 10 — Run lifecycle

```
Read kitesurf-game-spec.md §8.4 and §10.

Implement:
- Records as world objects (§8.4): a marker buoy at distance PB, a
  horizontal line in the sky at jump PB. Both visible during play.
  Breaking one flashes and continues — no interruption.
- localStorage persistence with the keys in §10
- Direction select -> run -> game over overlay -> restart
- Restart under 500ms, one key or tap, no confirm dialog
- Game over overlay draws over the still-running scene

Tests:
- Measured restart latency under 500ms
- localStorage is never read or written inside the update loop
```

---

## ▶ YOUR TURN 5 — Is the run shape right?

Play until you reach 3000m. Several times.

**The questions:** does the difficulty curve hold across a long run? Is tier 4 exciting or just unfair? Do you play five runs in a row without meaning to?

Tune obstacle density per tier and the tier multipliers. **Tune for someone in their first three minutes, not for you** — you have hundreds of runs of muscle memory by now and you are the worst possible judge of this game's difficulty.

---

# Part 7 — Presentation

## Session 11 — Parallax and water
## Session 12 — Rider sprite and animation
## Session 13 — Audio and juice

```
Read kitesurf-game-spec.md §6.

[one system per session — parallax layers and water, then rider sprite
and animation states, then audio and juice]

Juice priority: screen shake on landing, speed lines at high wind,
particle burst on pop, PB marker flash, tier transition sting,
camera punch at apex.

Audio: wind noise rising with tier is the primary feedback channel.

Profile before and after. Report the frame budget. Pool all particles —
zero allocation in the update loop, per CLAUDE.md.
```

**Your part:** profile on the cheap Android phone, not the emulator. Particles are where 60fps goes to die.

---

## Session 14 — Ship

```
Landing page, meta tags, favicon, and a tutorial: a silent first 200m
at 12kt with at most two prompts. Build for production and verify
bundle size.
```

Put it on itch.io. Post it where kiters are — r/kitesurfing, kite forums, Instagram kite accounts. That audience already knows what a wind window is and will immediately understand why the mechanic works.

Server leaderboard only if people actually play. Your sim is deterministic, so `(seed, inputTrace)` replay validation is already possible.

---

# Reference

## Diagnostic prompts

Keep these for when something feels wrong but you can't name the cause.

```
[System] feels [sensation]. Diagnose at the formula level before
proposing anything. Do not change TUNING values — I own those.
Explain your reasoning before writing code.
```

```
Show me the current values of [X, Y, Z] and explain how each one
affects [sensation]. I want to tune this myself.
```

```
This test passes but the game feels wrong. Is the test asserting the
right thing? Check the test against the spec, not against the code.
```

## Tuning workflow

Run `?debug=1`, adjust one slider at a time, play ten seconds between changes. Changing several at once means you learn nothing about which one mattered. When it feels right, copy and persist:

```
Persist these TUNING values, replacing the current ones:

[paste]

Commit as "SXX.tune: [what changed]". Change nothing else.
```

## Standing rules to enforce

Claude Code will drift on these. Reinforcing them in the moment is cheap.

1. **Never adjust a TUNING value to make a test pass.** Green tests with wrecked feel is the worst failure mode available here.
2. **Never add a dependency without asking.** A physics library will seem plausible to it and will destroy the arcade feel.
3. **Never put DOM access in `/src/sim`.** Session 7's parity test and any future replay validation both depend on it running headless.
4. **No art before Session 11.** Sprites make you reluctant to change mechanics.
5. **Verify tests actually ran** — `git log` plus a manual `npm test` takes ten seconds.

## Time split

| Part | Sessions | Your time | Agent time |
|---|---|---|---|
| Foundations | 0–1 | low | 3–4h |
| Wind window | 2–3 | 1h playtest | 4–6h |
| Trick loop ⚠️ | 4–5 | **2–3h tuning** | 6–8h |
| Kickers | 6 | 1–2h tuning | 5–7h |
| Mobile | 7 | 1h on device | 4–6h |
| The run | 8–10 | 2h tuning | 10–14h |
| Presentation | 11–13 | 2h profiling | 15–20h |
| Ship | 14 | — | 3–5h |

Your total is roughly 10–12 hours of focused play and tuning. That small number is doing most of the work in this project — it's the only input the agent cannot generate.
