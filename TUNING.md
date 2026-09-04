# Tuning reference

Every constant in [tuning.ts](src/config/tuning.ts), what it does, and what moves when
you change it. [tuning.ts](src/config/tuning.ts) is the live source of truth for the
*values*; spec §12 is the snapshot they started from and has been left to drift on
purpose, so where the two disagree the code is right. This document explains them, and
every derived figure in it is computed from the shipped values.

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
| `TIER_DIST` | [500, 1500, 3000] m | Where tiers 2, 3 and 4 begin |
| `TIER_WIND` | [18, 25, 35] kt | The wind at each of those boundaries |
| `TIER_MULT` | [1.0, 1.5, 2.5, 4.0] | Score multiplier of each tier |
| `WIND_TOP` | 45 kt | Ceiling the open tier climbs toward and never reaches |
| `WIND_TOP_M` | 3000 m | Distance past the last boundary that closes half of that gap |

`WIND_BASE` is used by [windPower()](src/sim/kite.ts#L97) (divides by it),
[slewRate()](src/sim/kite.ts#L89) (subtracts it) and [windAt()](src/sim/wind.ts#L103).
Because everything is expressed *relative* to it, raising `WIND_BASE` alone changes
nothing about a tier-1 run — it just redefines what "12kt" means. To feel one tier without
riding to it, use the `windOverride` on `SimState` (`WIND_AUTO` = take the curve), not
this constant.

The rest is the spec §7.1 tier table, split into the three columns the sim actually reads.
[windAt()](src/sim/wind.ts#L103) is piecewise linear through `(0, WIND_BASE)` and the
`TIER_DIST`/`TIER_WIND` pairs, so **the tabled wind is the wind at the moment a tier
begins** and every metre between two boundaries interpolates:

| Distance | 0 | 250 | 500 | 1000 | 1500 | 2250 | 3000 | 4500 | 6000 | 12000 |
|---|---|---|---|---|---|---|---|---|---|---|
| Wind | 12.0 | 15.0 | **18.0** | 21.5 | **25.0** | 30.0 | **35.0** | 38.3 | 40.0 | 42.5 |

Past the last boundary the curve keeps climbing asymptotically —
`wind = 35 + (WIND_TOP - 35) * d / (d + WIND_TOP_M)`, where `d` is metres past it — so
tier 4 goes on getting harder for as long as a run lasts without eventually handing the
physics a wind nothing was tuned at. `WIND_TOP_M` is the half-life: 3000m past the
boundary sits halfway between 35kt and `WIND_TOP`.

**Wind scales with distance, never with time.** That is the whole anti-farming rule of
§7.1 — a rider who dawdles meets the same wind in the same place — and the combo decay of
`COMBO_DECAY_M` is keyed the same way for the same reason.

[tierAt()](src/sim/wind.ts#L49) gives a boundary to the tier it *opens*, so 500m is the
first metre of tier 2. Only [tierMult()](src/sim/wind.ts#L79) steps there; everything else
about the wind slides. What each tier is worth, at a full-load pop:

| Tier | Wind | Mult | `windPower` | `slewRate` | Terminal at drive peak | Flat apex → score | Wake apex → score |
|---|---|---|---|---|---|---|---|
| 1 | 12kt | 1.0× | 1.00 | 90.0 deg/s | 15.2 m/s | 2.40m → 37 | 13.80m → 513 |
| 2 | 18kt | 1.5× | 1.50 | 103.5 deg/s | 18.6 m/s | 3.37m → 93 | 19.42m → 1284 |
| 3 | 25kt | 2.5× | 2.08 | 119.3 deg/s | 21.9 m/s | 4.00m → 200 | 23.03m → 2763 |
| 4 | 35kt | 4.0× | 2.92 | 141.8 deg/s | 22.0 m/s (capped) | 4.43m → 373 | 25.54m → 5162 |

`TIER_MULT` is the smallest of the four levers on that last column and the only explicit
one: between tier 1 and tier 4 it multiplies a jump by 4, while wind acting through the
pop multiplies the same jump's *height* — and `HEIGHT_EXP` turns that into 10× on flat
water and 14× off a wake. Raising `TIER_MULT` to make deep runs pay is nearly always the
wrong dial; the height curve already does it.

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

The overshoot ([stepKite()](src/sim/kite.ts#L216)) is what produces the "sending it"
feel. It arms only when the *unbroken* sweep in one direction exceeds
`OVERSHOOT_MIN_SWEEP`, counting only frames where the kite was actually pinned at its
slew rate — a pointer the kite can keep up with is being steered, not swept, and earns
nothing. A reversal resets the run. The kite then carries `OVERSHOOT_DEG` past the
target and eases back linearly over `OVERSHOOT_SETTLE`. Note the overshoot is clamped to
the window, so a sweep that ends at 0 or 90 cannot overshoot at all.

`TENSION_SPEED_MIX` shapes [lineTension()](src/sim/kite.ts#L188), which is what the
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
found by a scan, memoised on the constant, in [drivePeak()](src/sim/kite.ts#L157).
`LIFT_EXP` sharpens or flattens how quickly lift falls off the zenith — at 1.5, lift is
0.74 at 35° and 0.13 at 75°, which is exactly the trade the landing band grades.

`DRIVE_K` and `DRAG_K` together set the speed a parked kite settles at
([terminalSpeed()](src/sim/rider.ts#L218)): at the drive peak that is ~15.2 m/s at 12kt
and ~26.0 m/s at 35kt — so at tier 4 the `MAX_SPEED` ceiling is what the rider actually
rides against. Both scale speed as a square root, so doubling `DRIVE_K` is only ~1.4×
the top speed.

`AIR_DRIVE_MIX` applies the *same* balance airborne at 35% strength
([airAccel()](src/sim/rider.ts#L189)). Because it is a fraction of the water
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

Past 1.0 the grace timer runs ([buildLoad()](src/sim/rider.ts#L457)); past
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
| `FLOAT_K` | 2.0 | Upward acceleration the kite makes at zenith, per unit windPower |

```
popImpulse = capFlat(load * liftFactor(θ) * POP_K * windPower) * kickerBonus
peakHeight = impulse² / (2 * GRAVITY)
```

`POP_K` is the master height dial for everything that is not a kicker. A perfect
flat-water pop (load 1, zenith) is 9.5 m/s at 12kt — 4.6m of raw apex, which the cap
then brings down.

`FLAT_POP_CAP` is not a hard clamp: a clamp would make every good pop identical to every
perfect one. [capFlatImpulse()](src/sim/rider.ts#L268) is asymptotic —
`h → CAP * h / (h + CAP)` — strictly increasing, always below the cap, and barely
touching a pop that was never near it. Shipped values land flat water at **2.40m at
12kt** and **4.43m at 35kt** against the 5m ceiling, matching spec §4.4. The cap is
applied *before* the kicker bonus, because it is flat water that is capped: a wave is
how you beat it.

`FLOAT_K` is the air's only steering ([floatAccel()](src/sim/rider.ts#L315)):
`liftFactor(θ) * FLOAT_K * windPower`, max at zenith and always well under `GRAVITY` —
2.0 m/s² is 20% of it at tier 1, and 5.83 m/s² (59%) at 35kt. Push it much higher and the
kite stops being a hangtime modifier and becomes a second engine.

Spec §3.6 targets a ~15% hangtime swing between holding zenith and dropping the kite, and
the shipped value brackets that number rather than hitting it, because "dropping the kite"
has two honest readings:

| Reading | Swing | `FLOAT_K` that would land it on 15% |
|---|---|---|
| Kite teleported to the window edge | 26.5% | ~1.15 |
| Kite *slewed* there, as a thumb does | 11.7% | ~2.34 |

2.0 is the nearer of the two to the thumb-driven reading, which is the one a player
actually experiences. The gap is pinned by a characterisation test in
[tests/rider.test.ts](tests/rider.test.ts): moving `FLOAT_K` will fail it on purpose, and
the band in the test is what gets re-pinned — never the constant.

`GRAVITY` is physical, not a feel dial — but it is in `TUNING` because every height,
descent and budget formula reads it, and moon-gravity is a legitimate experiment.

---

## Kicker

| Param | Value | Meaning |
|---|---|---|
| `KICKER_WINDOW` | 0.30 s | Release-timing window around the wave lip |
| `BONUS_CHOP` | 1.15× | Perfect-timing bonus off chop |
| `BONUS_WAVE` | 1.60× | Perfect-timing bonus off a wave |
| `BONUS_WAKE` | 2.40× | Perfect-timing bonus off a boat wake |
| `RAMP_CHOP` | 0.3 m | Ramp height of chop (spec §4.1) |
| `RAMP_WAVE` | 1.0 m | …of a wave |
| `RAMP_WAKE` | 1.8 m | …of a boat wake |
| `WAVE_FACE_K` | 5 | Metres of face per √metre of ramp height |

```
Δt          = |t_release - t_lip|
kickerBonus = 1 + (maxBonus - 1) * max(0, 1 - (Δt / KICKER_WINDOW)²)
```

Full falloff to 1.0× at ±300ms, with roughly full bonus inside ±120ms. The quadratic
falloff is what makes the release *timing* — not just the release *angle* — a skill.

The bonus multiplies the *impulse*, so apex scales with the **square** of it: `BONUS_WAKE`
at 12kt is 2.4² = 5.8× the flat apex. Against spec §4.4's height ceilings that is
generous — 13.8m where §4.4 wants ~7m off that launch at tier 1 — so **the bonuses, or the
point at which they are applied, are the first thing to reach for if the big airs feel
silly.** They are also what the landing budget is stretched by: a 12kt wake air is
survivable and never clean (see `LAND_FORGIVE`), which is the shape the current numbers
give it.

The three ramps are the spec §4.1 table, and the face they present is
`WAVE_FACE_K * sqrt(height)` — sub-linear, so a taller wave is also a steeper one:

| Wave | Ramp | Face | Ramp velocity at `MAX_SPEED` | Apex from the ramp alone | Full 12kt pop | Full 35kt pop |
|---|---|---|---|---|---|---|
| Chop | 0.3m | 2.74m | 2.41 m/s | 0.30m | 3.17m | 5.86m |
| Wave | 1.0m | 5.00m | 4.40 m/s | 0.99m | 6.13m | 11.35m |
| Wake | 1.8m | 6.71m | 5.90 m/s | 1.78m | 13.80m | 25.54m |

`WAVE_FACE_K` is set so that at `MAX_SPEED` a wave gives very nearly its own height back
as apex — the reference it was picked against, not a law of the formula. The ramp velocity
is added *after* the flat-water cap and pays out whether or not the pop was any good: the
bonus grades the timing, the ramp is the water under the board. Lowering `WAVE_FACE_K`
makes every wave steeper and kickier at once, which is the one dial that changes what a
wave *is* rather than what it is worth.

---

## Landing

| Param | Value | Meaning |
|---|---|---|
| `CLEAN_BAND` | [35, 75] deg | θ band that can score a clean touchdown |
| `SKETCHY_BAND` | [20, 85] deg | θ band that survives at all |
| `SOFT_LAND` | 8 m/s | Descent-rate threshold for clean, at the reference apex |
| `HARD_LAND` | 14 m/s | Descent-rate threshold for surviving, at the reference apex |
| `LAND_FORGIVE` | 0.85 | 0 = flat descent cap, 1 = same demand at every apex |
| `CLEAN_QUALITY` | 1.0 | `landingQuality` of a clean touchdown |
| `SKETCHY_QUALITY` | 0.4 | `landingQuality` of a sketchy one |
| `SKETCHY_SPEED_LOSS` | 0.25 | Share of speed a sketchy landing takes away |
| `LAND_RECOVER` | 0.25 s | The landing beat before riding resumes |
| `WIPEOUT_RECOVER` | 2.0 s | Minimum relaunch beat with the kite in the water |
| `RELAUNCH_ANGLE` | 80 deg | How far out the kite has to be dragged before it flies again |
| `RELAUNCH_SLEW` | 0.4 | Share of the slew rate a kite in the water drags at |

```
ballisticDescent(apex) = sqrt(2 * GRAVITY * apex)
budget(t, apex)        = t^(1 - LAND_FORGIVE) * ballisticDescent(apex)^LAND_FORGIVE
```

Evaluated at touchdown by [landingQuality()](src/sim/rider.ts#L401): θ inside
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
| 3m | 7.67 | 7.72 | 8.40 |
| 5m | 9.90 | 9.59 | 10.43 |
| 10m | 14.01 | 12.88 | 14.01 |
| 20m | 19.81 | 17.29 | 18.80 |
| 40m | 28.01 | 23.21 | 25.25 |

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
[rider.ts](src/sim/rider.ts#L372) and [effects.ts](src/render/effects.ts#L162), and
`quality > 0` separates sketchy from wipeout. Keep the ordering
`CLEAN > SKETCHY > 0` or the verdict colours, spray and speed penalty all decouple from
the physics.

The two recover timers are dead beats, not penalties in themselves: `LAND_RECOVER` is
the crouch before riding resumes, `WIPEOUT_RECOVER` is the relaunch with the kite down —
no drive and no load until it is back in the window (spec §7.2). Speed is already gone by
then; this is the tempo cost that makes sending tricks worth the risk anyway.

The relaunch is not a timer alone. The kite lies where the crash left it and drags toward
the player's aim at `RELAUNCH_SLEW` of its flying rate, and the run resumes only once
`WIPEOUT_RECOVER` has run out **and** the kite has reached `RELAUNCH_ANGLE` — the edge of
the window, where a real one is relaunched from. From a kite parked at zenith, the far end
of the window and the wipeout the landing table hands out most often, the drag is 2.22s at
12kt and 1.41s at 35kt, so the beat spec §7.2 calls "~2s" is 2.0–2.25s for a player who
steers straight away, and open-ended for one who does not. That is the mild skill check:
`RELAUNCH_SLEW` sets how expensive it is to fumble, `RELAUNCH_ANGLE` how far off the aim
has to be to count as fumbling. Both are floored above zero in the slider schema — a kite
that could never come back out of the water would be a soft-lock.

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
jumpScore      = peakHeight^HEIGHT_EXP * HEIGHT_K * landingQuality * combo
               * clearanceBonus * windMult
totalScore     = Σ jumpScore + distance * DIST_PER_M
clearanceBonus = 1 + 0.5 * (1 - clearance / CLEARANCE_M)
```

`windMult` is `TIER_MULT` for the tier the landing happened in (see **Wind**).

`HEIGHT_EXP > 1` is the arcade feel: one huge send always beats two safe ones — doubling
the apex pays 2.83×. `HEIGHT_K` only sets the size of the numbers.

`DIST_PER_M` is a deliberate trickle so that cruising is not literally zero, and it is
worth seeing how thin a trickle it is against the jumps. At tier 1 a metre of water pays
1 and a perfect flat pop pays 37, so the opening stretch of a run is mostly distance; a
wake hit is 513 at tier 1 and 5162 at tier 4. That is the intended shape — distance pays
off *indirectly*, by carrying the rider into wind where the jumps are worth an order of
magnitude more.

### The combo ladder

[creditLanding()](src/sim/scoring.ts#L179) moves the combo one rung per landing, and the
jump is paid at the combo it was **taken** at — so the first clean landing of a run scores
at 1× and the second at 2×:

| Landing | Combo |
|---|---|
| Clean | +1, to `COMBO_CAP` |
| Sketchy | −1, floor 1× |
| Wipeout | straight back to 1× |

Two rules gate that (spec §8.2):

- **Only kicker jumps move it, either way.** [isTrick()](src/sim/scoring.ts#L149) is
  `kickerBonus > 1`, so any wave counts — chop's 1.15× is enough — and flat water counts
  for nothing. A flat hop scores at whatever combo is standing and neither builds it,
  holds it nor costs it. This is why `WAVE_MIX_CHOP` is the largest share in the
  generator: the combo has to have something to live on.
- **`COMBO_DECAY_M` is a ruler, not a timer.** −1 per 150m since the last *trick* landing
  ([stepScore()](src/sim/scoring.ts#L235)), so slowing down cannot farm it — the same
  anti-farming logic as the wind curve. A near miss inside `CLEARANCE_M` also pushes the
  ruler out (spec §8.3), and so does a landing that cost a rung: charging the rung *and*
  leaving the ruler behind would take two multipliers off one mistake.

At `COMBO_CAP` = 10 and `COMBO_DECAY_M` = 150m, holding a full combo means landing a
trick every 150m for 1350m — which is most of the way to tier 3. Lower the cap and the
ladder tops out before the wind does; raise the decay distance and the combo stops being
something the rider has to keep feeding.

`CLEARANCE_M` is the near-miss band ([clearanceBonus()](src/sim/scoring.ts#L91)): 1.0× at
exactly 0.75m of air over the highest point of an obstacle, rising linearly to **1.5× at
zero clearance**, and 1.0× for an air that passed over nothing. The smallest of an air's
clearances is what gets paid, once, at the touchdown. It is measured off the same swept
path the fatal collision test uses, against the same silhouette — a boat is measured from
its mast, not its deck — so contact is exactly this gap going negative. That is the whole
of why obstacles are worth flying *close to* rather than merely over.

---

## Render

| Param | Value | Meaning |
|---|---|---|
| `WORLD_SCALE` | 26 px/m | The physical scale: water, rider, altitude, obstacles |
| `LINE_RADIUS` | 264 px | The compressed scale: fixed radius the kite orbits at |
| `RIDER_H` | 48 px | Rider height (1.8m at `WORLD_SCALE`) |
| `CAM_ALT_FOLLOW` | 0.6 | Fraction of rider altitude the camera follows |
| `CAM_DAMP` | 8 /s | How fast the camera catches its altitude target |
| `ANCHOR_X` | 0.2 | Rider screen position, fraction of width |
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
`SPRAY_MAX` in [effects.ts](src/render/effects.ts#L193), which is a pool size, not a
tuning value: raising `SPRAY_WIPEOUT` past it buys nothing.

`SHADOW_FADE_M` fades the rider's shadow on the water as altitude climbs. The camera
follow sells height by moving the frame; the shadow sells it by leaving a mark that does
*not* move, so a 4m air and a 12m air are told apart by something other than the shape of
the parallax.

---

## Touch

| Param | Value | Meaning |
|---|---|---|
| `TOUCH_ARC_SLOP` | 90 px | Hit slop either side of the window arc, for the steering thumb |
| `TOUCH_LOAD_ZONE` | 0.333 | Share of the width, ahead of the rider, that holds the load |

Both are read by [touch.ts](src/input/touch.ts) and only decide *which role a finger
claims* on touchdown — neither touches the mapping. Once a thumb has claimed the arc it
is followed anywhere on screen by the same absolute angle mapping the mouse uses, so
widening the slop makes the control easier to grab, never less precise.

`TOUCH_ARC_SLOP` is a half-thickness: the default gives a band 180px through, centred on
`LINE_RADIUS`. It is genuinely load-bearing rather than a nicety. On a phone in landscape
the arc's 264px radius is most of the screen height, so zenith sits above the top edge:
at 360px tall the reachable strip for a full send is the top ~55px of the frame. Widening
the slop pulls the inner edge of the band down toward the rider and makes that send
easier to start; narrowing it demands the thumb trace the drawn line. **This is the value
to reach for first if the phone test says the send is awkward.**

`TOUCH_LOAD_ZONE` is the spec's "right third" (§5.3) — the third *ahead* of the rider, so
it mirrors with the frame when riding left. A hold anywhere inside it loads; nothing in
there is a target the player has to find.

Both are floored at the 44px minimum touch target by `MIN_TARGET` in
[touch.ts](src/input/touch.ts), which is not a tuning value: it is an ergonomic
minimum, so dragging either slider down cannot produce a target smaller than a thumb.

---

## Generation

| Param | Value | Meaning |
|---|---|---|
| `REACTION_MIN` | 0.55 s | Minimum reaction window guaranteed before any obstacle |
| `WAVE_GAP_MIN` | 55 m | Closest two wave lips may be |
| `WAVE_GAP_MAX` | 140 m | Furthest apart |
| `WAVE_MIX_CHOP` | 0.55 | Share of waves that are chop |
| `WAVE_MIX_WAVE` | 0.35 | Share that are waves — boat wakes take the remaining 0.10 |
| `WAVE_LEAD` | 2.5 s | Seconds of warning a wave gets before its lip |
| `OBSTACLE_GAP_MIN` | 110 m | Closest two obstacles may be drawn, at tier 1 |
| `OBSTACLE_GAP_MAX` | 320 m | Furthest apart, at tier 1 |
| `DENSITY_MIN_EXP` | 0.5 | How hard wind shrinks the minimum gap |
| `DENSITY_MAX_EXP` | 1.2 | …the maximum, which shrinks faster |
| `OBSTACLE_MIX_PIER` | 0.25 | Share of free-standing obstacles that are piers, where the water allows |
| `PIER_TIER` | 3 | First tier whose wind may carry a pier (spec §9.1) |

```
timeToImpact = gap / currentSpeed
timeToImpact >= REACTION_MIN + popSetupTime(currentSpeed)
```

The fairness guarantee (spec §9.2, non-negotiable): every spawned obstacle must be
clearable. If the check fails, the spawn is pushed further out. An unavoidable death in an
endless runner destroys trust in the game instantly.

What [fairness.ts](src/sim/fairness.ts) actually enforces is stronger than the spec's
line, and `REACTION_MIN` is the only tuning value in it — the rest is derived from the
physics constants above. The gap is required to be fair at **every speed the rider could
arrive at**, not just the one they had when it spawned, because a spawn commits a horizon
ahead and the player can add 15 m/s in the seconds it takes to get there.
[minSafeGap()](src/sim/fairness.ts#L407) is that guarantee as a distance, and it falls as
the wind rises because every term of the line — spin up, build the edge, steer the kite,
climb — is cheaper in more wind:

| Obstacle | 12kt | 18kt | 25kt | 35kt | Runout |
|---|---|---|---|---|---|
| Buoy | 53m | 42m | 36m | 32m | 10m |
| Boat | 68m | 56m | 49m | 43m | 49m |
| Pier | — | — | 59m | 50m | 19m |

Runout ([runout()](src/sim/fairness.ts#L437)) is why the gate is measured from where the
*last* obstacle's jump puts the rider back on the water rather than from the obstacle
itself: an obstacle forty metres past a boat is an unavoidable death by landing.

Because the wind now rises with distance, a spawn is committed in one wind and ridden in
another. The gate is therefore priced at the wind where the **approach starts**, which is
the weakest wind anywhere on the line to it — the only reading that cannot promise a rider
more pop than the water they are actually crossing will give them.

`REACTION_MIN` is the one number in the inequality that is a *feel* value rather than a
consequence. It buys the "I saw it" beat before the line even starts, and everything else
is the line itself ([popSetupTime()](src/sim/fairness.ts#L370)). Raising it spaces every
obstacle in the game further out, at every tier, in metres proportional to `MAX_SPEED`.

The two density exponents shrink the draw range as the wind gets up, and the maximum
shrinks faster than the minimum — which tightens the *rhythm* rather than merely speeding
it up. A loose, sparse sea becomes a drumbeat:

| Wind | Draw range |
|---|---|
| 12kt | 110–320m |
| 18kt | 90–197m |
| 25kt | 76–133m |
| 35kt | 64–89m |
| 40kt | 60–75m |

The fairness floor is applied after the draw and always wins, so shrinking these cannot
produce an unfair spawn — only a wall of obstacles at exactly the minimum safe gap.

`WAVE_MIX_CHOP` and `WAVE_MIX_WAVE` split the same 1.0 and whatever they leave is the boat
wake share, currently 0.10. Chop dominates because it is what the combo lives on
(see **Scoring**); wakes are rare because a boat wake is the biggest air in the game and
stops being an event if it is on every corner. `WAVE_LEAD` is the telegraph budget: the
generator keeps the world stocked far enough ahead that a wave always exists before the
moment it has to be drawn.

`PIER_TIER` is spec §9.1's "rare, tier 3+", enforced as the wind that tier opens at rather
than as a distance — the same thing under the curve (25kt is exactly 1500m) and the right
thing under a wind override. It is needed *as well as* the physics:
[clearable()](src/sim/fairness.ts#L329) turns true for a pier at 19.12kt, which the curve
reaches around 660m, and a 3m wall whose only line is the strongest pop in the game is not
what tier 2 is for.

---

## Obstacles

| Param | Value | Meaning |
|---|---|---|
| `BUOY_H` | 0.5 m | Lethal height of a buoy |
| `BUOY_LEN` | 0.8 m | Water it occupies |
| `BOAT_HULL_H` | 2.4 m | Hull height |
| `BOAT_MAST_H` | 4 m | Mast height — the tallest thing in the game |
| `BOAT_LEN` | 8 m | Stern to bow |
| `BOAT_MAST_AT` | 0.5 | Share of the hull length the mast stands at |
| `BOAT_WAKE_LEAD` | 8 m | From the wake lip to the stern |
| `PIER_H` | 3 m | Wall height |
| `PIER_LEN` | 4 m | Water it occupies |
| `CLEAR_MARGIN` | 0.5 m | Air a spawn has to be clearable by |

The spec §9.1 table, plus the geometry the fairness gate measures against. Every one of
these is read three times over — by [topAt()](src/sim/obstacles.ts#L151) for the collision
test, by the clearance bonus of §8.3, and by the renderer — so the silhouette a player
sees, the thing that kills them and the thing that pays a near miss cannot disagree.

`BOAT_WAKE_LEAD` is the real decision here. A boat is never placed without the wake that
launches it, and this is the arc a pop has to span: fast, and the stern is fractions of a
second past the lip, so the demand is a near-vertical climb; slow, and the bow is seconds
away, so the demand is a long hang. The lead distance balances the two, and it is what
makes the greedy line and the safe line the same line.

`CLEAR_MARGIN` is the honesty margin on the whole fairness model — every required impulse
is solved for the top of the silhouette *plus* this. Raising it spaces obstacles further
out; dropping it to zero makes the guarantee exact, which is to say fair only to a
player who flies the perfect line.

---

## Derived figures at a glance

At the shipped values, for sanity-checking a change:

| Quantity | 12kt | 35kt |
|---|---|---|
| `windPower` | 1.0 | 2.92 |
| `slewRate` | 90 deg/s | 141.8 deg/s |
| Terminal speed at the drive peak | 15.2 m/s | 26.0 → capped to 22 m/s |
| Perfect flat-water apex | 2.40m | 4.43m |
| Perfect boat-wake apex | 13.80m | 25.54m |
| Float at zenith | 2.0 m/s² (20% of g) | 5.83 m/s² (59% of g) |
| Score multiplier | 1.0× | 4.0× |
| A perfect flat pop, scored | 37 | 373 |
| A perfect wake pop, scored | 513 | 5162 |
| Nearest a buoy may spawn | 53m | 32m |
| Nearest a boat may spawn | 68m | 43m |
| Drive peak θ | 70.5° | — |
| Time to full load at `MAX_SPEED` | 0.71s | — |
| Distance the wind reaches this at | 0m | 3000m |

Every figure here is computed from the shipped constants rather than remembered; if you
change a value, the fastest way to regenerate them is a throwaway test that prints them,
since the sim runs headless in Node.
