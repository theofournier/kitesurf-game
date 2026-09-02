# Kitesurf — Design & Technical Spec

**Version** 1.0 (v1 scope)
**Genre** Endless arcade score-chase, 2D side-view
**Platforms** Web (desktop + mobile browser), single codebase
**Status** Pre-prototype

---

## 1. Pitch

A 2D side-scrolling kitesurfing game. You ride left or right across an endless ocean, working the kite through the wind window to build speed, loading your edge, and launching off wave faces for big air. Wind increases with distance travelled. Hit a boat and the run is over.

The whole game rests on one real-world tension: **a kite low in the window gives you power and speed, a kite at zenith gives you lift but no drive. You cannot have both at once.** Every mechanic is an expression of that trade.

---

## 2. Design pillars

1. **The kite position dial is the game.** Speed and lift are opposite ends of one continuous input. The player is always choosing.
2. **Two inputs, deep timing.** Kite angle and load/release. All depth comes from timing, not from button count.
3. **Wind is the difficulty curve.** Escalating wind makes the existing mechanic spicier rather than adding new systems.
4. **Send everything.** Botched tricks cost tempo, not the run. Only obstacles are lethal.

---

## 3. Physics model

### 3.1 State variables

| Variable | Range | Meaning |
|---|---|---|
| `kiteAngle` θ | 0° (zenith / 12 o'clock) → 90° (edge of window / 3 or 9) | Current kite position on the window arc |
| `kiteTarget` | same | Where the player is pointing |
| `speed` | 0 → `MAX_SPEED` | Rider horizontal velocity (m/s) |
| `load` | 0 → 1 | Stored edge tension, builds while input held |
| `altitude` | 0 → ~18m | Height above water |
| `vSpeed` | — | Vertical velocity |
| `wind` | 12 → 35+ kt | Derived from distance |

### 3.2 Kite slew

The kite does not snap to the pointer. It travels toward `kiteTarget` at a max angular rate:

```
slewRate = BASE_SLEW * (1 + (wind - 12) / 40)     // deg/sec
kiteAngle += clamp(kiteTarget - kiteAngle, ±slewRate * dt)
```

`BASE_SLEW = 90 deg/s` at 12kt, rising to ~145 deg/s at 35kt.

**This travel time is the core skill gate.** You must send the kite up *before* you want to leave the water. Edge hard, then reach for 12, and you are already late.

Allow a small overshoot on fast sweeps (>60° of travel): the kite carries ~8° past target and settles back over ~200ms. This produces the "sending it" feel and rewards a smooth sweep over a panic flick.

### 3.3 Drive and lift

```
driveFactor(θ) = sin(θ) * cos(θ * 0.5)      // peaks ~50°, ~0 at zenith
liftFactor(θ)  = cos(θ)^1.5                 // max at zenith, ~0 at edge
```

```
accel = driveFactor(θ) * windPower * DRIVE_K - drag(speed)
drag(speed) = DRAG_K * speed^2
```

### 3.4 Load

While input is held and the rider is on the water:

```
load += LOAD_RATE * (speed / MAX_SPEED) * dt
```

Load only builds meaningfully at speed, which requires the kite low. Load is capped at 1.0.

**Carving costs speed while it happens.** The edge that builds the load is also extra drag on the board, proportional to how hard it is loaded:

```
drag += CARVE_DRAG_K * load * speed²          // while the input is held
```

`CARVE_DRAG_K` sits at `DRAG_K`, so a full edge doubles the drag term and a light one barely registers. This is the continuous counter-pressure on the load, ahead of the stall's cliff: holding for a bigger pop means popping off a slower board, and a slower board loads slower still, because the rate above scales with speed. The hold gets more expensive the longer it runs rather than being free right up to `STALL_GRACE`.

**Over-load penalty:** holding past 1.0 for more than `STALL_GRACE` (0.4s) triggers a stall — the edge catches, speed drops 40%, load resets to 0, and pop is forfeited. Without this, the optimal play is to always hold maximum.

### 3.5 Pop

On release:

```
popImpulse = load * liftFactor(θ_release) * POP_K * windPower * kickerBonus
```

The two terms fight each other. Load requires speed (kite low). Lift requires zenith. The player must ride low, dig the edge, whip the kite up, and release in the narrow moment where load is still high and the kite has arrived.

**Flat-water pop is capped** at roughly 5m regardless of execution. See §4.

### 3.6 Air phase

Ballistic, with limited kite influence:

```
vSpeed -= GRAVITY * dt
vSpeed += liftFactor(θ) * FLOAT_K * windPower * dt     // hangtime modifier
```

`FLOAT_K` is tuned so that holding the kite at zenith for the whole air extends hangtime by **~15%** versus dropping it immediately. Weak-to-moderate float: pop timing remains king, but the arc is steerable enough to make clearing an obstacle a real decision.

Horizontal speed keeps following the kite while airborne, at `AIR_DRIVE_MIX` of its strength on the water:

```
speed += AIR_DRIVE_MIX * (driveFactor(θ) * windPower * DRIVE_K - drag(speed)) * dt
```

`driveFactor` is 0 at zenith, so a kite parked at 12 o'clock makes no drive and the whole term is drag: the air **costs** speed, and that is the price of the hangtime the line above is buying at the same angle. Dropping the kite toward the drive peak pulls the rider forward again and the air is close to free. **Height or speed, chosen with the one control left** — this is what makes the kite angle matter between the pop and the touchdown rather than only at each end.

Because it is a fraction of the water balance rather than a term of its own, the air converges on the same terminal speed the kite position would hold on the water and never passes it. **A jump is somewhere to spend speed or hold it, never a faster way to travel.**

### 3.7 Landing

Evaluated at touchdown (`altitude <= 0`):

| Condition | Result | `landingQuality` |
|---|---|---|
| θ in 35°–75° band, descent rate < `budget(SOFT_LAND)` | Clean | 1.0 |
| θ in 20°–85°, descent rate < `budget(HARD_LAND)` | Sketchy — speed −25%, combo held | 0.4 |
| θ < 20° (kite still parked at zenith) | Wipeout | 0 |
| Descent rate ≥ `budget(HARD_LAND)` | Wipeout | 0 |

**The descent thresholds scale with the air.** A ballistic arc lands at the speed it left, so descent rate is very nearly the pop impulse — and a *flat* threshold on it is therefore a flat ceiling on height. At `SOFT_LAND` = 8 m/s that ceiling is 3.3m of apex, below every kicker in §4; at `HARD_LAND` = 14 m/s everything over 10m is an unavoidable wipeout. That turns §4's "every record jump comes off a wave face" into a trap and puts the landing table directly at odds with an `apex^1.5` score.

So each threshold becomes a budget, blended in the exponent against the descent the air would have made with no float at all:

```
ballisticDescent(apex) = sqrt(2 * GRAVITY * apex)
budget(t, apex)        = t^(1 - LAND_FORGIVE) * ballisticDescent(apex)^LAND_FORGIVE
```

`LAND_FORGIVE` = 0 is the flat cap; 1 is a pure ratio asking exactly as much of a 2m hop as of a 40m one. At **0.8** the budget grows with the air but more slowly than the descent does: every size of send stays landable, and each larger one demands more of the float on the way down.

What this grades is **how much lift the kite was carrying through the descent** — the one thing the air leaves under the player's control. Landing at the low end of the clean band keeps most of the float (`liftFactor` is 0.74 at 35°, 0.13 at 75°) and touches down soft; landing at the high end trades that away for the drive that holds speed (§3.6).

The player must **redirect the kite back toward the direction of travel before touchdown**. This is the third timing window (after load duration and send timing) and it comes free from the existing input. On the biggest airs it is the binding one: a 48m wake hit at 35kt lands clean only if the kite is held up almost to the water and then swept into the low end of the band.

**Known bind:** a wave-sized air at 12kt (~7m) is sketchy however it is flown. `BASE_SLEW` is 90°/s there and the air is short, so the redirect that would buy the descent budget cannot also reach the clean band in time. Landable, never nailed — widening `CLEAN_BAND`, raising `BASE_SLEW` or raising `LAND_FORGIVE` would open it.

---

## 4. Waves and kickers

**Kickers are required for the biggest airs.** Flat-water pop is capped low; every record jump comes off a wave face.

### 4.1 Wave types

| Type | Ramp height | `kickerBonus` (perfect) | Notes |
|---|---|---|---|
| Chop | 0.3m | 1.15× | Frequent, low reward, good for combo upkeep |
| Wave | 1.0m | 1.6× | The bread-and-butter kicker |
| Boat wake | 1.8m | 2.4× | Highest air in the game — and it sits beside a lethal boat |

### 4.2 Lip timing

Each wave has a **lip** — a point on its face where the ramp is steepest. Bonus scales with how close the pop release lands to the lip:

```
Δt = |t_release - t_lip|
kickerBonus = 1 + (maxBonus - 1) * max(0, 1 - (Δt / WINDOW)^2)
WINDOW = 0.30s   // full falloff to 1.0 at ±300ms
```

Full bonus within roughly ±120ms. The wave also contributes its own upward ramp velocity on takeoff, independent of the bonus.

### 4.3 Why this works

The player must converge **three things at one instant**: load near maximum, kite arriving at zenith, and the rider at the lip. Waves approach on a visible schedule, so the whole approach becomes a setup problem — get speed early, start the sweep at the right distance out, release at the lip. This is the skill peak of the game and the reason to chase boats.

### 4.4 Height ceilings (12kt → 35kt)

| Launch | Low wind | High wind |
|---|---|---|
| Flat water | 2.5m | 5m |
| Wave | 5m | 11m |
| Boat wake, perfect | 7m | 15m |

---

## 5. Controls

### 5.1 Abstract input layer

All platforms produce the same struct. Everything else is an adapter. **No platform-specific game logic.**

```ts
interface RiderInput {
  kiteTarget: number   // 0..1, normalised position along window arc
  loading: boolean     // held = building load, release = pop
}
```

### 5.2 Desktop

- **Steering is always on. No button.** Kite position is the speed dial and must be live every frame.
- Mouse position → angle from rider to pointer → clamped to the window arc → `kiteTarget`. Absolute mapping, not pointer-lock deltas, so hand position corresponds to kite position.
- Pointer tracked across the whole window, on the canvas or off it. The angle is well defined outside the frame, and a send sweeps the hand past zenith and off the edge as a matter of course. **Never snap the target to an arc endpoint** — that reads as the kite ignoring the hand. Off the browser entirely reports nothing, so the target holds the last angle it was given.
- **System cursor visible, as a crosshair.** It is the only marker that survives leaving the canvas, and it is what tells the player how far past the end of the window a sweep has carried — hiding it made a long send unrecoverable, because the clamp ate the overshoot and nothing on screen said so. A faint ghost marker on the arc shows the target the kite is being given.
- **Space or LMB** → `loading`. Support both.

### 5.3 Mobile (two-thumb, landscape)

- **Left thumb** drags along the window arc → `kiteTarget`. Same absolute mapping. The arc is drawn in-world (§6.2), so it doubles as the control affordance — no separate widget.
- **Right thumb** holds anywhere in the right third → `loading`. Release to pop.
- Touch targets minimum 44px. Generous hit slop on the arc.

### 5.4 Required web setup

```css
touch-action: none;
overscroll-behavior: none;
user-select: none;
```

- Orientation lock to landscape (with a rotate-prompt fallback).
- Audio context unlocked on first touch.
- `devicePixelRatio` capped at 2.
- **Test on a low-end Android device in week one, not week ten.**

---

## 6. Framing and rendering

### 6.1 Two scales

Never mix these:

- `WORLD_SCALE` — water, rider, obstacles, waves, jump altitude. Physically consistent. **26px per world metre**, rider 48px tall (1.8m).
- `LINE_SCALE` — kite lines only. Compressed.

### 6.2 Compressed lines

Real 24m lines are ~13 rider-heights and unusable in frame. Compress to **5.5 rider-heights = 264px** fixed radius. The kite orbits the rider at that radius.

- Kite drawn ~90px wide — deliberately larger than perspective-correct so it reads at a glance.
- The window arc is a faint 264px-radius quarter circle above the rider. This is both the visual and the control surface.
- The kite is a UI element wearing a costume. Treat it as such.

### 6.3 Line sag

Two 1px lines from rider hands to kite tips, drawn as quadratic Béziers. Control-point offset is proportional to **inverse tension**:

- Depowered at zenith → visibly slack and curved
- Loaded and edging → dead straight and taut

This communicates load better than any meter. Add subtle line tremble at high wind for tier feedback.

### 6.4 Camera

- **Horizontal:** rider anchored at ~30% screen width (in direction of travel).
- **Vertical:** follows rider altitude at **0.6×**, damped. The rider visibly rises in frame, water recedes, horizon stays in view as reference.
- At peak of a big air the kite will exit frame. **Let it.** Draw lines running off-screen. That is what it looks like up there, and it reads as height.
- Parallax layers (sky, horizon, mid-water, foreground spray) do most of the work selling altitude.

### 6.5 Riding direction

Chosen before the run. Implemented as a **horizontal mirror of the world**, not duplicated logic or art. No toeside/heelside distinction in v1.

---

## 7. Run structure

Endless. Ends only on a fatal collision.

### 7.1 Wind tiers

Wind scales with **distance, not time** — otherwise the optimal strategy is to slow down and farm.

| Tier | Distance | Wind | Score mult | Visual |
|---|---|---|---|---|
| 1 | 0–500m | 12kt | 1.0× | Flat water, pale sky, sparse chop |
| 2 | 500–1500m | 18kt | 1.5× | Whitecaps, more waves, light spray |
| 3 | 1500–3000m | 25kt | 2.5× | Dark water, heavy spray, wind noise |
| 4 | 3000m+ | 35kt+ | 4.0× | Barely controllable, kite fighting you |

Wind interpolates continuously; tiers exist for feedback and scoring. Each tier transition is an event: sky colour, water tint, spray density, audio.

Wind affects: `driveFactor` output, `liftFactor` output, `slewRate`, obstacle density, wave frequency.

**Key consequence:** at high wind the kite pulls hard even at zenith, so parking it up there to send becomes genuinely dangerous. Difficulty comes from the core mechanic getting harder, not from density alone.

### 7.2 Crash types

**Wipeout** — botched landing, stall, over-load.
- All speed lost, combo reset to 1×, load reset
- **Relaunch beat:** kite is down in the water. Player must steer it back to the window edge. ~2s, mild skill check.
- Run continues.

**Fatal** — contact with boat, buoy, or pier.
- Run over.

This split is what makes endless work. Sending tricks is encouraged (worst case is lost tempo). Obstacle contact is lethal. Risk lives in the line, not in the trick.

---

## 8. Scoring

### 8.1 Formula

```
jumpScore = (peakHeight ^ 1.5) * 10
          * landingQuality
          * combo
          * clearanceBonus
          * windMult

totalScore = Σ jumpScore + (distance * 1)
```

- **Height superlinear** — one huge send always beats two safe ones. This is the arcade feel.
- **Distance pays a trickle** (1 pt/m) so cruising isn't literally zero, but real points come from jumps. Distance pays off *indirectly* by getting you into high wind.

### 8.2 Combo

- +1 per clean landing, cap 10×
- Resets to 1× on wipeout
- **Decays on distance without a landed trick** (−1 per 150m), not on a timer — same anti-stalling logic

### 8.3 Clearance bonus

Vertical near-miss. Passing within 0.75m above any obstacle:

```
clearanceBonus = 1 + 0.5 * (1 - clearance / 0.75)
```

Also extends the combo window. This gives obstacles a reason to exist beyond killing you, and makes the greedy arc visibly different from the safe one.

### 8.4 Records (sub-stats)

Displayed on the game-over screen alongside total score:

- **Best jump** (metres)
- **Max distance** (metres)

Both rendered as **in-world markers**, not HUD numbers:

- Distance PB → a marker buoy in the water at that distance. You watch it approach and pass.
- Jump PB → a thin horizontal line in the sky, visible during every air. You can see whether you'll beat it while still rising.

Breaking one mid-run flashes and continues. No interruption.

---

## 9. Obstacles and generation

### 9.1 Objects

| Object | Height | Lethal | Notes |
|---|---|---|---|
| Buoy | 0.5m | Yes | Low, easy to clear, punishes cruising |
| Boat | 2.4m hull, 4m mast | Yes | Generates the boat-wake kicker ahead of it |
| Pier | 3m wall | Yes | Rare, tier 3+, forces a committed send |
| Wave / chop | ramp | No | Kicker |

### 9.2 Generation rules

Procedural, seeded per run (deterministic sim → free ghosts and replays).

**Fairness guarantee — non-negotiable:** every spawned obstacle must be clearable given the rider's *current* speed and a reasonable reaction window. Before committing a spawn, verify:

```
timeToImpact = gap / currentSpeed
timeToImpact >= REACTION_MIN + popSetupTime(currentSpeed)
```

If it fails, push the spawn further out. An unavoidable death in an endless runner destroys trust in the game instantly.

**Boat clusters:** a boat always spawns with its wake kicker positioned so that a well-timed pop off the wake clears the boat. The greedy line and the safe line are the same line executed differently.

**Density** scales with wind tier. Minimum gap shrinks; maximum gap shrinks faster, so the rhythm tightens.

---

## 10. Persistence

**v1: local only.** `localStorage`, keyed:

```
kitesurf.pb.score
kitesurf.pb.jump
kitesurf.pb.distance
kitesurf.ghost.best     // input trace, replayable against deterministic sim
```

**Later: server leaderboard.** Design for it now — since the sim is deterministic and seeded, a run is fully described by `(seed, inputTrace)`. Server-side replay validation is therefore possible without trusting the client. Do not ship a score-submission endpoint that trusts a raw number.

---

## 11. Technical

### 11.1 Stack

- **TypeScript** + **Vite**
- **Canvas 2D** to start. Migrate to **Pixi (WebGL)** only if parallax layers and particle counts force it.
- **No physics library.** Matter.js / Planck will fight the arcade feel and there are no rigid-body needs.

### 11.2 Loop

Fixed timestep with accumulator, interpolated rendering:

```ts
const DT = 1 / 60
accumulator += frameTime
while (accumulator >= DT) {
  simulate(DT)
  accumulator -= DT
}
render(accumulator / DT)   // interpolation alpha
```

Deterministic sim is load-bearing — it gives ghosts, replays, and server validation for free. **Painful to retrofit.**

### 11.3 Architecture

```
/src
  /sim          pure, deterministic, no DOM, no rendering
    rider.ts    physics state machine
    kite.ts     slew, angle, window
    world.ts    spawning, waves, obstacles
    scoring.ts
  /input
    desktop.ts  → RiderInput
    touch.ts    → RiderInput
  /render
    layers.ts   parallax
    draw*.ts
  /config
    tuning.ts   ALL constants, single object
```

The `sim` module must be runnable headless — this is what makes replay validation and automated tuning possible.

### 11.4 Non-negotiables

- All tuning constants in one exported config object.
- **Tweakpane sliders behind a debug flag.** You will spend most of your time tuning, not coding.
- Zero per-frame allocation in the update loop. Pre-allocate and pool.
- No `localStorage` reads in the loop.

---

## 12. Tuning constants (starting values)

```ts
export const TUNING = {
  // kite
  BASE_SLEW: 90,          // deg/s at 12kt
  SLEW_WIND_SCALE: 40,
  OVERSHOOT_DEG: 8,
  OVERSHOOT_SETTLE: 0.2,  // s

  // drive
  DRIVE_K: 12,
  DRAG_K: 0.04,
  MAX_SPEED: 22,          // m/s at 35kt
  AIR_DRIVE_MIX: 0.35,    // share of the drive/drag balance that still applies airborne

  // load
  LOAD_RATE: 1.4,         // per second at max speed
  CARVE_DRAG_K: 0.04,     // extra drag per unit of load — at DRAG_K, a full edge doubles drag
  STALL_GRACE: 0.4,       // s

  // pop
  POP_K: 9.5,
  FLAT_POP_CAP: 5.0,      // m
  GRAVITY: 9.81,
  FLOAT_K: 1.6,           // ~15% hangtime swing

  // kicker
  KICKER_WINDOW: 0.30,    // s
  BONUS_CHOP: 1.15,
  BONUS_WAVE: 1.60,
  BONUS_WAKE: 2.40,

  // landing
  CLEAN_BAND: [35, 75],   // deg
  SKETCHY_BAND: [20, 85],
  SOFT_LAND: 8,           // m/s descent
  HARD_LAND: 14,
  LAND_FORGIVE: 0.8,      // 0 = flat descent cap, 1 = same demand at every apex

  // scoring
  HEIGHT_EXP: 1.5,
  HEIGHT_K: 10,
  DIST_PER_M: 1,
  COMBO_CAP: 10,
  COMBO_DECAY_M: 150,
  CLEARANCE_M: 0.75,

  // render
  WORLD_SCALE: 26,        // px per metre
  LINE_RADIUS: 264,       // px, compressed
  RIDER_H: 48,            // px
  CAM_ALT_FOLLOW: 0.6,

  // generation
  REACTION_MIN: 0.55,     // s
}
```

All of these will move. That is the point of putting them in one place.

---

## 13. Milestones

**M1 — Grey box, mouse only.** Rider on a line, kite on an arc, speed from kite angle. No art, no obstacles. *Gate: does working the window feel good on its own?*

**M2 — Load, pop, air, land.** Still grey boxes. Full trick loop with landing evaluation. *Gate: is this fun with rectangles? If not, no amount of art will save it. Most projects die by skipping this gate.*

**M3 — Kickers.** Waves, lip timing, the three-way convergence. *Gate: does nailing a wake pop feel like an achievement?*

**M4 — Touch adapter, phone test.** Two-thumb scheme on real hardware. *Gate: is the arc drag precise enough with a thumb?*

**M5 — Full loop.** Obstacles, crashes, relaunch, wind tiers, scoring, records, restart. Playable game.

**M6 — Art, audio, juice, PBs, ghosts.**

**M7 — Server leaderboard with replay validation.**

Restart must be **under 500ms, one key or tap, no confirm dialog.** Score summary overlays the still-running scene.

---

## 14. Open items for v1

- Art direction and rider animation set (undefined — M6)
- Audio design; wind noise as a tier cue is the one confirmed idea
- Whether the mouse drives kite angle directly or drives the *bar* with the kite lagging behind. Functionally similar since slew already provides lag. **Rule: if the kite ever feels disconnected from the hand, reduce lag before reducing anything else.**
- Whether 5.5 rider-heights of line reads as kiting or as a toy kite on a short string. If too short, lengthen the line *and* shrink the rider — the eye reads the ratio, not the pixel count.
- Tutorial / onboarding. Probably a silent first 200m at 12kt with prompts.
