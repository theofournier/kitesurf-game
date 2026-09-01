# Tuning reference

Every constant in [tuning.ts](src/config/tuning.ts), what it does, and what moves when
you change it. The spec ([kitesurf-game-spec.md](kitesurf-game-spec.md) §12) owns the
starting values; this document explains them.

**These values are owned by the human.** Never edit one to make a test pass — if a test
and a constant disagree, the test or the formula is wrong (see [CLAUDE.md](CLAUDE.md)).

Every entry is also a live slider in the debug panel; the ranges and the grouping come
from [schema.ts](src/debug/schema.ts), which mirrors the order of `TUNING` so the
panel's copy-values dump can be pasted straight back over the object.

Notation: **θ** is the kite angle in degrees, 0 = zenith (12 o'clock), 90 = the edge of
the window. `windPower = wind / WIND_BASE` — 1.0 at tier 1, ~2.92 at 35kt.

---

## Wind

| Param | Value | Meaning |
|---|---|---|
| `WIND_BASE` | 12 kt | Tier-1 wind: the reference every other wind is measured against |

Used by [windPower()](src/sim/kite.ts#L97) (divides by it), [slewRate()](src/sim/kite.ts#L89)
(subtracts it) and [windAt()](src/sim/world.ts#L30). Because everything is expressed
*relative* to it, raising `WIND_BASE` alone changes nothing about a tier-1 run — it just
redefines what "12kt" means. To feel tier 2–4 before the wind curve exists, use the
`wind` override on `SimState` (`WIND_AUTO` = no override), not this constant.

---

## Kite

| Param | Value | Meaning |
|---|---|---|
| `BASE_SLEW` | 90 deg/s | Kite angular travel rate at `WIND_BASE` |
| `SLEW_WIND_SCALE` | 40 | Knots of extra wind that add one `BASE_SLEW` of rate |
| `OVERSHOOT_DEG` | 8 deg | How far a fast sweep carries past its target |
| `OVERSHOOT_SETTLE` | 0.2 s | Time to ease back from the overshoot onto the target |
| `OVERSHOOT_MIN_SWEEP` | 60 deg | Sweep length above which an overshoot is earned |
| `TENSION_SPEED_MIX` | 0.6 | Share of line tension that comes from speed, not window position |

```
slewRate = BASE_SLEW * (1 + (wind - WIND_BASE) / SLEW_WIND_SCALE)
```

→ 90 deg/s at 12kt, 141.75 deg/s at 35kt. **This travel time is the core skill gate**
(spec §3.2): the kite has to be sent before you want to leave the water. Raising
`BASE_SLEW` makes the game more forgiving everywhere — including the known bind in spec
§3.7, where a wave-sized air at 12kt cannot be redirected into the clean band in time.
Lowering `SLEW_WIND_SCALE` makes high wind feel twitchier relative to tier 1.

The overshoot ([stepKite()](src/sim/kite.ts#L186)) is what produces the "sending it"
feel. It arms only when the *unbroken* sweep in one direction exceeds
`OVERSHOOT_MIN_SWEEP`, counting only frames where the kite was actually pinned at its
slew rate — a pointer the kite can keep up with is being steered, not swept, and earns
nothing. A reversal resets the run. The kite then carries `OVERSHOOT_DEG` past the
target and eases back linearly over `OVERSHOOT_SETTLE`. Note the overshoot is clamped to
the window, so a sweep that ends at 0 or 90 cannot overshoot at all.

`TENSION_SPEED_MIX` shapes [lineTension()](src/sim/kite.ts#L164), which is what the
rendered line sag reads:

```
tension = (driveFactor(θ) / drivePeak) * windPower * (1 - MIX + MIX * speed / MAX_SPEED)
```

At 0 the lines only care where the kite is; at 1 a stationary rider always has slack
lines however low the kite is. Tension follows *drive*, not lift — a kite parked at
zenith is depowered and visibly slack, whatever lift it is making.

---

## Drive

| Param | Value | Meaning |
|---|---|---|
| `DRIVE_K` | 12 | Forward acceleration scale |
| `DRIVE_SHAPE` | 0.5 | θ multiplier inside `driveFactor` — sets where drive peaks |
| `LIFT_EXP` | 1.5 | Exponent in `liftFactor` |
| `DRAG_K` | 0.04 | Quadratic water drag coefficient |
| `MAX_SPEED` | 22 m/s | Hard ceiling on rider speed (spec §3.1) |
| `AIR_DRIVE_MIX` | 0.35 | Share of the water drive/drag balance that still applies airborne |

```
driveFactor(θ) = sin(θ) * cos(θ * DRIVE_SHAPE)     // 0 at zenith
liftFactor(θ)  = cos(θ) ^ LIFT_EXP                 // max at zenith, ~0 at the edge
accel          = driveFactor(θ) * windPower * DRIVE_K - DRAG_K * speed²
```

These two curves are the whole tension of the game: **drive needs the kite low, lift
needs it at zenith.**

`DRIVE_SHAPE` is a TUNING value rather than the spec's inline `0.5` because it is the
only thing that moves the peak: 0.5 puts it at 70.5°, 0.88 puts it at 50°. The spec's
prose ("peaks ~50°") and its formula disagree, so the number is exposed and the peak is
found by a scan, memoised on the constant, in [drivePeak()](src/sim/kite.ts#L138).
`LIFT_EXP` sharpens or flattens how quickly lift falls off the zenith — at 1.5, lift is
0.74 at 35° and 0.13 at 75°, which is exactly the trade the landing band grades.

`DRIVE_K` and `DRAG_K` together set the speed a parked kite settles at
([terminalSpeed()](src/sim/rider.ts#L179)): at the drive peak that is ~15.2 m/s at 12kt
and ~26.0 m/s at 35kt — so at tier 4 the `MAX_SPEED` ceiling is what the rider actually
rides against. Both scale speed as a square root, so doubling `DRIVE_K` is only ~1.4×
the top speed.

`AIR_DRIVE_MIX` applies the *same* balance airborne at 35% strength
([airAccel()](src/sim/rider.ts#L150)). Because it is a fraction of the water
balance rather than a term of its own, the air converges on the same terminal speed and
never passes it: **a jump is somewhere to spend speed or hold it, never a faster way to
travel.** At zenith `driveFactor` is 0, so the whole term is drag and the air costs
speed — that is the price of the hangtime `FLOAT_K` is buying at the same angle. Raising
this makes the height-or-speed choice sharper in both directions.

---

## Load

| Param | Value | Meaning |
|---|---|---|
| `LOAD_RATE` | 1.4 /s | Load gained per second at `MAX_SPEED` |
| `CARVE_DRAG_K` | 0.04 | Extra drag per unit of load, while the edge is held |
| `STALL_GRACE` | 0.4 s | How long load may sit at 1.0 before the edge catches |
| `STALL_SPEED_LOSS` | 0.4 | Share of speed a stall takes away |

```
load  += LOAD_RATE * (speed / MAX_SPEED) * dt        // capped at 1.0
drag  += CARVE_DRAG_K * load * speed²                // while the input is held
```

Load is zero at a standstill and full only at full speed: you cannot build an edge you
are not riding against. At `MAX_SPEED` a full load takes 0.71s.

`CARVE_DRAG_K` sits deliberately *at* `DRAG_K`, so a full edge doubles the drag term and
a light one barely registers. This is the continuous counter-pressure that keeps the
hold from being free right up to the stall: holding for a bigger pop means popping off a
slower board, and a slower board loads slower still, because the rate above scales with
speed. Terminal speed under a full edge is `1/sqrt(1 + CARVE_DRAG_K/DRAG_K)` = 0.71× the
free-riding one.

Past 1.0 the grace timer runs ([buildLoad()](src/sim/rider.ts#L359)); past
`STALL_GRACE` the edge catches: speed drops by `STALL_SPEED_LOSS`, load resets to 0, and
**the pop is forfeited** until the next edge. Without this, the optimal play is to always
hold maximum.

---

## Pop

| Param | Value | Meaning |
|---|---|---|
| `POP_K` | 9.5 | Vertical impulse scale |
| `FLAT_POP_CAP` | 5.0 m | Asymptotic ceiling on flat-water apex |
| `GRAVITY` | 9.81 m/s² | Standard gravity |
| `FLOAT_K` | 1.6 | Upward acceleration the kite makes at zenith, per unit windPower |

```
popImpulse = capFlat(load * liftFactor(θ) * POP_K * windPower) * kickerBonus
peakHeight = impulse² / (2 * GRAVITY)
```

`POP_K` is the master height dial for everything that is not a kicker. A perfect
flat-water pop (load 1, zenith) is 9.5 m/s at 12kt — 4.6m of raw apex, which the cap
then brings down.

`FLAT_POP_CAP` is not a hard clamp: a clamp would make every good pop identical to every
perfect one. [capFlatImpulse()](src/sim/rider.ts#L216) is asymptotic —
`h → CAP * h / (h + CAP)` — strictly increasing, always below the cap, and barely
touching a pop that was never near it. Shipped values land flat water at **2.40m at
12kt** and **4.43m at 35kt** against the 5m ceiling, matching spec §4.4. The cap is
applied *before* the kicker bonus, because it is flat water that is capped: a wave is
how you beat it.

`FLOAT_K` is the air's only steering ([floatAccel()](src/sim/rider.ts#L246)):
`liftFactor(θ) * FLOAT_K * windPower`, max at zenith and always well under `GRAVITY` —
1.6 m/s² is 16% of it, so holding zenith for a whole air stretches hangtime by ~19% over
dropping the kite immediately (spec §3.6 targets ~15%). Push it much higher and the kite
stops being a hangtime modifier and becomes a second engine.

`GRAVITY` is physical, not a feel dial — but it is in `TUNING` because every height,
descent and budget formula reads it, and moon-gravity is a legitimate experiment.

---

## Kicker

| Param | Value | Meaning |
|---|---|---|
| `KICKER_WINDOW` | 0.30 s | Release-timing window around the wave lip |
| `BONUS_CHOP` | 1.15× | Perfect-timing bonus off chop (0.3m ramp) |
| `BONUS_WAVE` | 1.60× | Perfect-timing bonus off a wave (1.0m ramp) |
| `BONUS_WAKE` | 2.40× | Perfect-timing bonus off a boat wake (1.8m ramp) |

```
Δt          = |t_release - t_lip|
kickerBonus = 1 + (maxBonus - 1) * max(0, 1 - (Δt / KICKER_WINDOW)²)
```

Full falloff to 1.0× at ±300ms, with roughly full bonus inside ±120ms. The quadratic
falloff is what makes the release *timing* — not just the release *angle* — a skill.

**Not wired yet.** Waves do not exist in [world.ts](src/sim/world.ts), so nothing reads
`KICKER_WINDOW` and the bonuses only reach `popImpulse` through tests. When they land,
note that the bonus multiplies the *impulse*, so apex scales with the **square** of it:
`BONUS_WAKE` at 12kt is 2.4² = 5.8× the flat apex, i.e. ~13.8m against spec §4.4's 7m
target for that launch. Either the bonuses or their point of application will need a
pass then.

---

## Landing

| Param | Value | Meaning |
|---|---|---|
| `CLEAN_BAND` | [35, 75] deg | θ band that can score a clean touchdown |
| `SKETCHY_BAND` | [20, 85] deg | θ band that survives at all |
| `SOFT_LAND` | 8 m/s | Descent-rate threshold for clean, at the reference apex |
| `HARD_LAND` | 14 m/s | Descent-rate threshold for surviving, at the reference apex |
| `LAND_FORGIVE` | 0.8 | 0 = flat descent cap, 1 = same demand at every apex |
| `CLEAN_QUALITY` | 1.0 | `landingQuality` of a clean touchdown |
| `SKETCHY_QUALITY` | 0.4 | `landingQuality` of a sketchy one |
| `SKETCHY_SPEED_LOSS` | 0.25 | Share of speed a sketchy landing takes away |
| `LAND_RECOVER` | 0.25 s | The landing beat before riding resumes |
| `WIPEOUT_RECOVER` | 2.0 s | Relaunch beat with the kite in the water |

```
ballisticDescent(apex) = sqrt(2 * GRAVITY * apex)
budget(t, apex)        = t^(1 - LAND_FORGIVE) * ballisticDescent(apex)^LAND_FORGIVE
```

Evaluated at touchdown by [landingQuality()](src/sim/rider.ts#L316): θ inside
`CLEAN_BAND` **and** descent under `budget(SOFT_LAND, apex)` → clean; θ inside
`SKETCHY_BAND` and descent under `budget(HARD_LAND, apex)` → sketchy; anything else is a
wipeout.

The budget is the important idea. A ballistic arc lands at the speed it left, so descent
rate is very nearly the pop impulse — a *flat* threshold on it would be a flat ceiling on
height, putting the landing table at odds with an `apex^1.5` score. Blending against
`ballisticDescent` in the exponent lets the budget grow with the air, but more slowly
than the descent does:

| Apex | Ballistic descent | Clean budget | Sketchy budget |
|---|---|---|---|
| 3m | 7.67 | 7.74 | 8.65 |
| 5m | 9.90 | 9.49 | 10.61 |
| 10m | 14.01 | 12.52 | 14.01 |
| 20m | 19.81 | 16.52 | 18.48 |

Each threshold's own reference apex is where it exactly equals the ballistic descent:
3.26m for `SOFT_LAND`, 9.99m for `HARD_LAND`. Below that, a no-float arc lands inside the
budget for free; above it, float on the way down is mandatory — **every send stays
landable, and each larger one demands more of the float.** What that grades is how much
lift the kite was carrying through the descent, the one thing the air leaves under the
player's control: the low end of `CLEAN_BAND` keeps most of the float and touches down
soft, the high end trades it for the drive that holds speed.

`LAND_FORGIVE` is the single dial for landing difficulty on big airs: at 0 the budgets
become flat caps (and a height game becomes unplayable), at 1 a 40m send asks exactly
what a 2m hop does.

`CLEAN_QUALITY` and `SKETCHY_QUALITY` are the score multipliers from spec §3.7, but they
are also the *classifier* — `quality >= CLEAN_QUALITY` is the clean test in both
[rider.ts](src/sim/rider.ts#L420) and [effects.ts](src/render/effects.ts#L118), and
`quality > 0` separates sketchy from wipeout. Keep the ordering
`CLEAN > SKETCHY > 0` or the verdict colours, spray and speed penalty all decouple from
the physics.

The two recover timers are dead beats, not penalties in themselves: `LAND_RECOVER` is
the crouch before riding resumes, `WIPEOUT_RECOVER` is the relaunch with the kite down —
no drive and no load until it is back in the window (spec §7.2). Speed is already gone by
then; this is the tempo cost that makes sending tricks worth the risk anyway.

---

## Scoring

| Param | Value | Meaning |
|---|---|---|
| `HEIGHT_EXP` | 1.5 | Exponent on peak height |
| `HEIGHT_K` | 10 | Points scale on a jump |
| `DIST_PER_M` | 1 | Points per metre travelled |
| `COMBO_CAP` | 10 | Maximum combo multiplier |
| `COMBO_DECAY_M` | 150 m | Distance without a landed trick that costs 1× of combo |
| `CLEARANCE_M` | 0.75 m | Vertical near-miss distance that pays a bonus |

```
jumpScore     = peakHeight^HEIGHT_EXP * HEIGHT_K * landingQuality * combo
              * clearanceBonus * windMult
totalScore    = Σ jumpScore + distance * DIST_PER_M
clearanceBonus = 1 + 0.5 * (1 - clearance / CLEARANCE_M)
```

`HEIGHT_EXP > 1` is the arcade feel: one huge send always beats two safe ones. `HEIGHT_K`
only sets the size of the numbers. `DIST_PER_M` is a deliberate trickle so cruising is
not literally zero — distance is meant to pay off *indirectly*, by carrying the rider
into higher wind.

Both combo rules key on **distance, not time** (`COMBO_DECAY_M`: −1 per 150m without a
landed trick), the same anti-farming logic as the wind curve.

**Not wired yet** — [scoring.ts](src/sim/scoring.ts) is a stub, and nothing reads any of
these six constants. Wind tier multipliers (spec §7.1) are not in `TUNING` at all yet.

---

## Render

| Param | Value | Meaning |
|---|---|---|
| `WORLD_SCALE` | 26 px/m | The physical scale: water, rider, altitude, obstacles |
| `LINE_RADIUS` | 264 px | The compressed scale: fixed radius the kite orbits at |
| `RIDER_H` | 48 px | Rider height (1.8m at `WORLD_SCALE`) |
| `CAM_ALT_FOLLOW` | 0.6 | Fraction of rider altitude the camera follows |
| `CAM_DAMP` | 8 /s | How fast the camera catches its altitude target |
| `ANCHOR_X` | 0.3 | Rider screen position, fraction of width |
| `HORIZON_Y` | 0.42 | Horizon line, fraction of height |
| `WATERLINE_Y` | 0.72 | Waterline at altitude 0, fraction of height |
| `KITE_W` | 90 px | Span of the kite quad |
| `LINE_SAG` | 44 px | Control-point drop at zero tension |
| `LINE_TREMBLE` | 3 px | Tremble amplitude per unit of `windPower` above tier 1 |
| `LINE_TREMBLE_HZ` | 13 Hz | Tremble frequency |
| `WATER_BAND_M` | 4 m | World distance between water texture streaks |
| `PARALLAX_FAR` | 0.15 | Scroll rate of the far water band, × rider speed |
| `PARALLAX_MID` | 0.45 | Mid band |
| `PARALLAX_NEAR` | 1.15 | Near band — over 1.0, so it outruns the rider |

**Never mix the two scales** (spec §6.1). `WORLD_SCALE` is physically consistent and
converts metres to pixels for everything that exists in the world. `LINE_RADIUS` is a
deliberate lie: real 24m lines are ~13 rider-heights and unusable in frame, so they are
compressed to 5.5 rider-heights and the kite is drawn larger than perspective-correct so
it reads at a glance. The kite is a UI element wearing a costume.

`CAM_ALT_FOLLOW` at 0.6 means the rider visibly rises in frame (the remaining 0.4) while
the water recedes (0.6) — both halves of the altitude read, with the horizon staying in
view as a reference. `CAM_DAMP` is an exponential rate, not a lerp factor, so it is
frame-rate independent. At the peak of a big air the kite leaves the frame: let it.

`LINE_SAG` scales with `1 - tension` ([lineSag()](src/render/drawKite.ts#L96)), so a
depowered kite bellies the lines and a loaded edge pulls them dead straight. This
communicates load better than any meter, which is why it is worth getting right before
anything else about the kite. Above tier 1 the same lines tremble at
`LINE_TREMBLE * (windPower - 1)` pixels, `LINE_TREMBLE_HZ` times a second, driven by sim
time so a replay draws the same frame twice.

The three parallax rates are multiples of rider speed, and the ordering is the whole
effect. `PARALLAX_NEAR > 1` on purpose: foreground water outrunning the rider is what
sells speed at the bottom of the frame.

---

## Feedback

| Param | Value | Meaning |
|---|---|---|
| `SHAKE_CLEAN` | 3 px | Screen shake on a clean landing |
| `SHAKE_SKETCHY` | 9 px | …on a sketchy one |
| `SHAKE_WIPEOUT` | 20 px | …on a wipeout |
| `SHAKE_DECAY` | 6 /s | How fast the shake dies away |
| `SPRAY_CLEAN` | 26 | Spray particles thrown by a clean landing |
| `SPRAY_SKETCHY` | 14 | …by a sketchy one |
| `SPRAY_WIPEOUT` | 44 | …by a wipeout |
| `FLASH_TIME` | 0.9 s | How long the landing verdict holds on screen |
| `SHADOW_FADE_M` | 14 m | Altitude over which the water shadow fades out |

The three-way split is the point: all nine values are read through the same
clean/sketchy/wipeout test as `landingQuality`, so the frame tells you what the sim
decided before the score does.

Shake decays exponentially and re-jitters every frame — a shake that eased smoothly
would read as a camera move rather than an impact. Spray counts are clamped to
`SPRAY_MAX` in [effects.ts](src/render/effects.ts#L151), which is a pool size, not a
tuning value: raising `SPRAY_WIPEOUT` past it buys nothing.

`SHADOW_FADE_M` fades the rider's shadow on the water as altitude climbs. The camera
follow sells height by moving the frame; the shadow sells it by leaving a mark that does
*not* move, so a 4m air and a 12m air are told apart by something other than the shape of
the parallax.

---

## Generation

| Param | Value | Meaning |
|---|---|---|
| `REACTION_MIN` | 0.55 s | Minimum reaction window guaranteed before any obstacle |

```
timeToImpact = gap / currentSpeed
timeToImpact >= REACTION_MIN + popSetupTime(currentSpeed)
```

The fairness guarantee (spec §9.2, non-negotiable): every spawned obstacle must be
clearable given the rider's *current* speed. If the check fails, the spawn is pushed
further out. An unavoidable death in an endless runner destroys trust in the game
instantly.

**Not wired yet** — obstacle generation is a later session, and nothing reads this
constant.

---

## Not yet wired

For orientation, the constants that exist ahead of their systems:

| Group | Constants | Waiting on |
|---|---|---|
| kicker | `KICKER_WINDOW` (bonuses reach `popImpulse` only from tests) | waves in [world.ts](src/sim/world.ts) |
| scoring | all six | [scoring.ts](src/sim/scoring.ts) |
| generation | `REACTION_MIN` | obstacle spawning |

Also missing from `TUNING` entirely: the wind-tier curve and its score multipliers
(spec §7.1), and wave ramp heights (spec §4.1).

---

## Derived figures at a glance

At the shipped values, for sanity-checking a change:

| Quantity | 12kt | 35kt |
|---|---|---|
| `windPower` | 1.0 | 2.92 |
| `slewRate` | 90 deg/s | 141.8 deg/s |
| Terminal speed at the drive peak | 15.2 m/s | 26.0 → capped to 22 m/s |
| Perfect flat-water apex | 2.40m | 4.43m |
| Drive peak θ | 70.5° | — |
| Time to full load at `MAX_SPEED` | 0.71s | — |
| Float at zenith | 1.6 m/s² (16% of g) | 4.7 m/s² (48% of g) |
