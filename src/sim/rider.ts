// Rider physics (spec §3.3 – §3.7). Drive, the load the player builds against
// it, the pop that spends it, the air it buys, and what the touchdown is worth.
//
// The phase machine is the spine of a run:
//
//     RIDING → LOADING → AIRBORNE → LANDING | WIPEOUT → RIDING
//
// Pure: mutates a preallocated RiderState in place, allocates nothing per step.
import { TUNING } from '../config/tuning.ts'
import {
  createKiteState,
  driveFactor,
  liftFactor,
  stepKite,
  targetFromInput,
  windPower,
  type KiteState,
} from './kite.ts'
import { NO_KICKER, type Kicker } from './kicker.ts'
import type { RiderInput } from './loop.ts'

/**
 * Float dust on the overload timer. STALL_GRACE is 24 steps of DT exactly, and
 * 24 additions of 1/60 do not land on 0.4 — this keeps "more than STALL_GRACE"
 * from firing a step early on rounding alone. Not a gameplay value, so not a
 * TUNING one — same reasoning as ANGLE_EPS in kite.ts.
 */
const OVERLOAD_EPS = 1e-9

/**
 * The phases of a run (spec §3.7). Strings rather than an enum because they go
 * straight into the debug readout and into test failure messages, and reading
 * one out of this object allocates nothing.
 */
export const PHASE = {
  /** On the water, not edging. */
  RIDING: 'RIDING',
  /** On the water with the input held: building load against the edge. */
  LOADING: 'LOADING',
  /** Off the water, between the pop and the touchdown. */
  AIRBORNE: 'AIRBORNE',
  /** The beat after a landing that scored — clean or sketchy. */
  LANDING: 'LANDING',
  /**
   * The beat after a landing that did not: kite down in the water, speed gone,
   * and the relaunch of §7.2 to fly before the run can carry on.
   */
  WIPEOUT: 'WIPEOUT',
} as const

export type Phase = (typeof PHASE)[keyof typeof PHASE]

/**
 * Why a touchdown missed the clean row (spec §3.7). Strings for the same reason
 * the phases are: they go straight into the debug readout and into test
 * failure messages, and reading one out of this object allocates nothing.
 *
 * A landing misses on the kite angle, on the descent, or on both, and the
 * feedback only has room for one word — so these name the kite first. It is
 * where the player's hands were in the last half second, while the descent is
 * what the whole air already decided.
 */
export const LAND_REASON = {
  /** Nothing missed: the landing was clean. */
  NONE: 'NONE',
  /** Kite still up toward zenith, below the clean band — nothing pulling. */
  KITE_HIGH: 'KITE_HIGH',
  /** Kite dumped out toward the edge of the window, past the clean band. */
  KITE_LOW: 'KITE_LOW',
  /** Kite where it should be, but down faster than the air's budget allowed. */
  HARD: 'HARD',
} as const

export type LandReason = (typeof LAND_REASON)[keyof typeof LAND_REASON]

export interface RiderState {
  kite: KiteState
  /** Horizontal speed, m/s. Held in 0..MAX_SPEED (spec §3.1). */
  speed: number
  /**
   * Distance travelled, metres. Monotonic — the rider never goes backwards —
   * and it is what wind, scoring and generation are all keyed off (spec §7.1).
   */
  x: number
  /** Height above water, metres (spec §3.1). 0 whenever on the water. */
  altitude: number
  /** Vertical velocity, m/s (spec §3.1). Set by the pop, spent by gravity. */
  vSpeed: number
  /** Stored edge tension, 0..1 (spec §3.4). Builds while held, spent on pop. */
  load: number
  /** Seconds held past a full load. Past STALL_GRACE the edge catches. */
  overload: number
  /** True between the pop and touchdown. */
  airborne: boolean
  /**
   * True from a stall until the input is released: the pop that hold was
   * building is gone, and holding on cannot win it back (spec §3.4).
   */
  popForfeit: boolean
  /** Whether the load input was held last step, so a release is an edge. */
  loading: boolean
  /** Impulse of the most recent pop, m/s. Read by debug and feedback only. */
  lastPop: number
  /** Kicker bonus that pop was taken with, 1 on flat water (spec §4.2). */
  lastKicker: number
  /**
   * How far off the lip that pop was, s — negative early, positive late. The
   * one number that answers "why did I miss?", so the debug panel gets it.
   */
  lastLip: number
  /** Which of the five phases the rider is in (spec §3.7). */
  phase: Phase
  /** Seconds left of a LANDING or WIPEOUT beat. 0 in every other phase. */
  recover: number
  /** Highest altitude of the current air, m. Held after touchdown. */
  apex: number
  /** Seconds since the pop. Held after touchdown as that air's hangtime. */
  airTime: number
  /** Descent rate at the last touchdown, m/s, positive downward (spec §3.7). */
  descentRate: number
  /** What the last touchdown was worth, 0..1 (spec §3.7). */
  landingQuality: number
  /** Why that touchdown was not clean, NONE when it was (spec §3.7). */
  landingReason: LandReason
  /**
   * Touchdowns evaluated so far. Every air increments it exactly once, which is
   * both the guarantee the landing table is applied once and the edge the
   * renderer fires its feedback off.
   */
  landings: number
}

export function createRiderState(): RiderState {
  return {
    kite: createKiteState(),
    speed: 0,
    x: 0,
    altitude: 0,
    vSpeed: 0,
    load: 0,
    overload: 0,
    airborne: false,
    popForfeit: false,
    loading: false,
    lastPop: 0,
    lastKicker: 1,
    lastLip: 0,
    phase: PHASE.RIDING,
    recover: 0,
    apex: 0,
    airTime: 0,
    descentRate: 0,
    landingQuality: 0,
    landingReason: LAND_REASON.NONE,
    landings: 0,
  }
}

/** Quadratic drag, m/s² (spec §3.3): `drag(speed) = DRAG_K * speed²`. */
export function drag(speed: number): number {
  return TUNING.DRAG_K * speed * speed
}

/**
 * Forward acceleration, m/s² (spec §3.3):
 *
 *     accel = driveFactor(θ) * windPower * DRIVE_K - drag(speed)
 */
export function driveAccel(theta: number, speed: number, wind: number): number {
  return driveFactor(theta) * windPower(wind) * TUNING.DRIVE_K - drag(speed)
}

/**
 * Horizontal acceleration in the air, m/s² (spec §3.6).
 *
 * The same drive-against-drag balance as the water, weakened by AIR_DRIVE_MIX:
 * with the board out of the water there is much less to push against and much
 * less holding you back. The sign is the point. A kite parked at 12 o'clock
 * makes no drive at all, so the whole term is drag and the air costs speed —
 * that is the price of the hangtime `floatAccel` buys at the same angle.
 * Dropping the kite toward the drive peak pulls the rider forward again and the
 * air is close to free. Height or speed, chosen with the one control left.
 *
 * Being a fraction of `driveAccel` and not a term of its own, the air can never
 * carry the rider past the terminal speed the same kite position would hold on
 * the water: a jump is somewhere to spend speed or to hold it, never a faster
 * way to travel.
 */
export function airAccel(theta: number, speed: number, wind: number): number {
  return TUNING.AIR_DRIVE_MIX * driveAccel(theta, speed, wind)
}

/**
 * The extra drag of an edge, m/s² (spec §3.4):
 *
 *     carveDrag(load, speed) = CARVE_DRAG_K * load * speed²
 *
 * Carving is how board speed becomes line tension, so it has to be paid for out
 * of board speed while it happens. CARVE_DRAG_K sits at DRAG_K, so a full edge
 * doubles the drag term and a light one barely registers.
 *
 * This is the counter-pressure the load was missing: holding for a bigger pop
 * means popping off a slower board, and a slower board loads slower still,
 * because `loadRate` scales with speed. The hold is no longer free until the
 * stall — it gets more expensive the longer it runs.
 */
export function carveDrag(load: number, speed: number): number {
  return TUNING.CARVE_DRAG_K * load * speed * speed
}

/**
 * Speed a kite parked at `theta` settles at — where drive balances drag — held
 * to MAX_SPEED, which spec §3.1 makes the ceiling on the state variable itself.
 *
 * At the drive peak the unlimited balance is ~15 m/s at 12kt and ~26 m/s at
 * 35kt, so the ceiling is what the top tier actually rides against.
 */
export function terminalSpeed(theta: number, wind: number): number {
  const balance = driveBalance(theta, wind)
  return balance > TUNING.MAX_SPEED ? TUNING.MAX_SPEED : balance
}

/**
 * The same balance without the MAX_SPEED ceiling, m/s: the asymptote of
 * `driveAccel` at this kite position rather than the speed the game allows.
 *
 * Separate from `terminalSpeed` because the spin-up time in fairness.ts is a
 * closed form in this asymptote — `speed = balance * tanh(...)` — and the
 * clamped value would put the asymptote below a speed the rider can actually
 * reach, making a reachable obstacle look unreachable.
 */
export function driveBalance(theta: number, wind: number): number {
  return Math.sqrt((driveFactor(theta) * windPower(wind) * TUNING.DRIVE_K) / TUNING.DRAG_K)
}

/**
 * Load gained per second at `speed`, 1/s (spec §3.4):
 *
 *     load += LOAD_RATE * (speed / MAX_SPEED) * dt
 *
 * Zero at a standstill and full only at full speed, which is what ties the pop
 * to the kite being low: you cannot build an edge you are not riding against.
 */
export function loadRate(speed: number): number {
  return TUNING.LOAD_RATE * (speed / TUNING.MAX_SPEED)
}

/** Ballistic apex of a pop of `impulse` m/s, metres: `v² / 2g`. */
export function peakHeight(impulse: number): number {
  return (impulse * impulse) / (2 * TUNING.GRAVITY)
}

/** The impulse that reaches an apex of `height` metres — inverse of the above. */
export function impulseForHeight(height: number): number {
  return Math.sqrt(2 * TUNING.GRAVITY * height)
}

/**
 * The flat-water ceiling (spec §3.5, §4.4), applied to an uncapped impulse.
 *
 * A hard clamp would make every good pop identical to every perfect one, so the
 * ceiling is asymptotic instead: apex `h` becomes `CAP * h / (h + CAP)`, which
 * is strictly increasing, always below FLAT_POP_CAP, and barely touches a pop
 * that was never near the cap. It lands the flat-water numbers spec §4.4 asks
 * for — ~2.4m at 12kt and ~4.4m at 35kt against a 5m ceiling — with better
 * execution still reading as more height right up to the top.
 */
export function capFlatImpulse(impulse: number): number {
  const cap = TUNING.FLAT_POP_CAP
  if (cap <= 0) return 0
  return impulse * Math.sqrt(cap / (peakHeight(impulse) + cap))
}

/**
 * The uncapped impulse that `capFlatImpulse` turns into `capped` — its exact
 * inverse, and Infinity for anything at or above the ceiling.
 *
 * The ceiling is asymptotic, so "what pop do I need?" has an answer for every
 * height under FLAT_POP_CAP and no answer at all at or above it. That is the
 * shape the spawn fairness of §9.2 needs: a pier is 3m of wall, and whether
 * flat water can be made to clear it is the whole of why §9.1 marks it tier 3+.
 */
export function uncapFlatImpulse(capped: number): number {
  const cap = TUNING.FLAT_POP_CAP
  if (cap <= 0 || capped <= 0) return 0
  const apex = peakHeight(capped)
  if (apex >= cap) return Infinity
  return capped * Math.sqrt(cap / (cap - apex))
}

/**
 * Vertical impulse on release, m/s (spec §3.5):
 *
 *     popImpulse = load * liftFactor(θ_release) * POP_K * windPower * kickerBonus
 *
 * The two terms fight: load needs speed and so needs the kite low, lift needs
 * the kite at zenith. The flat-water ceiling is applied before the kicker
 * bonus, because it is flat water that is capped — a wave is how you beat it.
 */
export function popImpulse(load: number, theta: number, wind: number, kickerBonus = 1): number {
  const flat = load * liftFactor(theta) * TUNING.POP_K * windPower(wind)
  return capFlatImpulse(flat) * kickerBonus
}

/**
 * Upward acceleration the kite makes while airborne, m/s² (spec §3.6):
 *
 *     vSpeed += liftFactor(θ) * FLOAT_K * windPower * dt
 *
 * Max at zenith, ~0 at the edge of the window, and always well under GRAVITY —
 * float is a hangtime modifier, never a second engine. Holding the kite up
 * stretches the air; dropping it cuts it short. That, and nothing else, is what
 * makes the arc steerable enough for clearing an obstacle to be a decision.
 */
export function floatAccel(theta: number, wind: number): number {
  return liftFactor(theta) * TUNING.FLOAT_K * windPower(wind)
}

/**
 * The descent a no-float air of `apex` metres arrives at, m/s: `sqrt(2 g h)`.
 *
 * A ballistic arc lands at exactly the speed it left, so this is what every
 * jump would touch down at if the kite made no lift at all. It is the reference
 * the landing budget is measured against, and it is why a flat descent cap
 * cannot work: descent is very nearly the pop impulse, so a fixed threshold on
 * it is a fixed ceiling on apex.
 */
export function ballisticDescent(apex: number): number {
  return Math.sqrt(2 * TUNING.GRAVITY * apex)
}

/**
 * How much descent a `threshold` row of the landing table allows an air that
 * reached `apex` metres, m/s (spec §3.7):
 *
 *     budget = threshold^(1 - LAND_FORGIVE) * ballisticDescent(apex)^LAND_FORGIVE
 *
 * A flat threshold makes the table a disguised height cap. A ballistic air
 * arrives at the speed it left, so SOFT_LAND alone bars a clean landing above
 * 3.3m of apex and HARD_LAND alone makes anything over 10m an unavoidable
 * wipeout — below every kicker in spec §4, and unmoved by any amount of skill.
 * That is the wrong shape for a game that scores apex^1.5 and tells the player
 * to go and hit a wave.
 *
 * So the budget is blended, in the exponent, between the flat threshold and the
 * descent the air would have made with no float at all. LAND_FORGIVE picks the
 * blend: 0 is the flat cap, 1 is a pure ratio that asks exactly as much of a 2m
 * hop as of a 40m one. In between, the budget grows with the air but more
 * slowly than the descent does — every size of send stays landable, and each
 * larger one asks for more of the float on the way down.
 *
 * What that grades is how much lift the kite was carrying through the descent,
 * which is the one thing the air leaves the player in control of. Landing at
 * the low end of CLEAN_BAND keeps most of the float (`liftFactor` is 0.74 at
 * 35deg and 0.13 at 75deg) and touches down soft; landing at the high end
 * trades that away for the drive that holds speed (§3.6). That is the choice
 * the table exists to ask.
 */
export function descentBudget(threshold: number, apex: number): number {
  const forgive = TUNING.LAND_FORGIVE
  return threshold ** (1 - forgive) * ballisticDescent(apex) ** forgive
}

/**
 * The clean row of the landing table (spec §3.7): kite inside the clean band
 * and a descent inside the budget that apex allows.
 *
 * Stated once, because both what a landing is worth and why it was not clean
 * are answers about this same condition, and two copies of it could drift into
 * showing a reason for a landing that scored clean.
 */
function isClean(theta: number, descent: number, apex: number): boolean {
  return (
    theta >= TUNING.CLEAN_BAND[0] &&
    theta <= TUNING.CLEAN_BAND[1] &&
    descent < descentBudget(TUNING.SOFT_LAND, apex)
  )
}

/**
 * The landing table (spec §3.7), evaluated at touchdown. Returns
 * `landingQuality`: 1.0 clean, 0.4 sketchy, 0 wipeout.
 *
 * `descent` is the descent rate, positive downward, and `apex` the height the
 * air reached — the descent is only ever judged against what that apex makes
 * unavoidable, via `descentBudget`. The rows are tested in the spec's order and
 * anything that matches neither is a wipeout, which covers both of the spec's
 * explicit wipeout rows — a kite still parked at zenith (θ < 20) and a descent
 * past the sketchy budget — plus the case its table leaves out, a kite dumped
 * past the sketchy band with a gentle descent. Landing with the kite at the
 * edge of the window is a wipeout for the same reason landing with it at zenith
 * is: it is not pulling in the direction of travel.
 *
 * Redirecting the kite back toward the direction of travel before touchdown is
 * the third timing window of the game, after load duration and send timing, and
 * with the budget scaled to the air it is the one the biggest jumps live on.
 *
 * `apex` is the apex of a real air, so it is always above zero where the sim
 * calls this: a pop that made no height never left the water (§3.5).
 */
export function landingQuality(theta: number, descent: number, apex: number): number {
  if (isClean(theta, descent, apex)) {
    return TUNING.CLEAN_QUALITY
  }

  if (
    theta >= TUNING.SKETCHY_BAND[0] &&
    theta <= TUNING.SKETCHY_BAND[1] &&
    descent < descentBudget(TUNING.HARD_LAND, apex)
  ) {
    return TUNING.SKETCHY_QUALITY
  }

  return 0
}

/**
 * Why a touchdown missed the clean row, for the same `(theta, descent, apex)`
 * `landingQuality` grades (spec §3.7).
 *
 * The verdict alone says a landing was sketchy; this says which of the two
 * things the clean row asks for was the one that was not there, so the player
 * can tell "the kite was still overhead" from "that air was always going to
 * hurt". Wipeouts get a reason on the same terms — a wipeout is a sketchy
 * landing that also missed the wider row.
 */
export function landingReason(theta: number, descent: number, apex: number): LandReason {
  if (isClean(theta, descent, apex)) return LAND_REASON.NONE
  if (theta < TUNING.CLEAN_BAND[0]) return LAND_REASON.KITE_HIGH
  if (theta > TUNING.CLEAN_BAND[1]) return LAND_REASON.KITE_LOW
  return LAND_REASON.HARD
}

/**
 * Integrates one step of horizontal acceleration, holding `speed` inside the
 * spec §3.1 range. The water and the air both go through here so the ceiling
 * and the floor are stated once.
 */
function applySpeed(rider: RiderState, accel: number, dt: number): void {
  const speed = rider.speed + accel * dt
  rider.speed = speed < 0 ? 0 : speed > TUNING.MAX_SPEED ? TUNING.MAX_SPEED : speed
}

/**
 * The edge catches (spec §3.4): speed drops by STALL_SPEED_LOSS, the load is
 * gone, and so is the pop it was building. Without this the optimal play is to
 * hold maximum at all times.
 */
function stall(rider: RiderState): void {
  rider.speed *= 1 - TUNING.STALL_SPEED_LOSS
  rider.load = 0
  rider.overload = 0
  rider.popForfeit = true
}

/** Builds load for one step while the input is held on the water (spec §3.4). */
function buildLoad(rider: RiderState, dt: number): void {
  if (rider.load < 1) {
    const load = rider.load + loadRate(rider.speed) * dt
    rider.load = load > 1 ? 1 : load
    return
  }

  // Already full: the grace timer is what the player is spending now.
  rider.overload += dt
  if (rider.overload > TUNING.STALL_GRACE + OVERLOAD_EPS) stall(rider)
}

/**
 * Spends the load on the release edge (spec §3.5), off whatever water is under
 * the board (spec §4.2).
 *
 * The kicker arrives as a struct rather than as a wave, so the rider still
 * knows nothing about the world it is riding through: the bonus multiplies the
 * pop inside `popImpulse`, where the flat-water ceiling is applied before it,
 * and the face's own ramp velocity is added on top of the finished impulse
 * because it is water under the board rather than anything the kite did.
 *
 * The ramp only ever adds to a pop, it never makes one: a release with nothing
 * stored is not a takeoff, and hitting a wake with no load should leave the
 * rider on the water rather than hand them a free hop.
 */
function release(rider: RiderState, wind: number, kicker: Kicker): void {
  const forfeit = rider.popForfeit || rider.airborne
  const bonus = forfeit ? 1 : kicker.bonus
  const impulse = forfeit ? 0 : popImpulse(rider.load, rider.kite.angle, wind, bonus)

  if (impulse > 0) {
    rider.vSpeed = impulse + kicker.ramp
    rider.airborne = true
    rider.apex = 0
    rider.airTime = 0
    rider.lastKicker = bonus
    rider.lastLip = kicker.delta
  }

  rider.lastPop = impulse
  rider.load = 0
  rider.overload = 0
  rider.popForfeit = false
}

/**
 * Touchdown (spec §3.7). Runs on the one step where the air ends, and is the
 * only place `landings` moves — the landing table is applied exactly once per
 * air, whatever the descent did afterwards.
 */
function touchdown(rider: RiderState): void {
  const descent = -rider.vSpeed
  // `apex` is this air's, not the last one's: stepAir raises it on the way up
  // and only calls in here once the altitude has come back to the water.
  const quality = landingQuality(rider.kite.angle, descent, rider.apex)

  rider.altitude = 0
  rider.vSpeed = 0
  rider.airborne = false
  rider.descentRate = descent
  rider.landingQuality = quality
  rider.landingReason = landingReason(rider.kite.angle, descent, rider.apex)
  rider.landings += 1

  if (quality <= 0) {
    // Wipeout (spec §7.2): all speed lost, and the kite is in the water for the
    // relaunch beat — no drive and no load until it is back in the window.
    rider.speed = 0
    rider.load = 0
    rider.overload = 0
    rider.popForfeit = false
    rider.phase = PHASE.WIPEOUT
    rider.recover = TUNING.WIPEOUT_RECOVER
    return
  }

  // Sketchy: the edge bites badly and costs speed, but the trick still counts.
  if (quality < TUNING.CLEAN_QUALITY) rider.speed *= 1 - TUNING.SKETCHY_SPEED_LOSS
  rider.phase = PHASE.LANDING
  rider.recover = TUNING.LAND_RECOVER
}

/**
 * One step of the air (spec §3.6): ballistic, plus whatever float the kite is
 * making, plus what the same kite position does to horizontal speed.
 *
 * The two pull opposite ways on purpose. Holding the kite up floats the air out
 * and bleeds speed; dropping it cuts the air short and drives the speed back.
 * That trade is the whole of the airborne decision, and it is why the kite
 * angle matters between the pop and the touchdown rather than only at each end.
 */
function stepAir(rider: RiderState, wind: number, dt: number): void {
  rider.vSpeed -= TUNING.GRAVITY * dt
  rider.vSpeed += floatAccel(rider.kite.angle, wind) * dt
  applySpeed(rider, airAccel(rider.kite.angle, rider.speed, wind), dt)
  rider.altitude += rider.vSpeed * dt
  rider.airTime += dt
  if (rider.altitude > rider.apex) rider.apex = rider.altitude

  if (rider.altitude <= 0) touchdown(rider)
}

/** One step on the water (spec §3.3, §3.4): drive against drag and edge, and load. */
function stepWater(rider: RiderState, input: RiderInput, wind: number, dt: number): void {
  // The relaunch beat is dead time by design: the kite is in the water, so
  // there is nothing to drive against and nothing to edge against either.
  if (rider.phase === PHASE.WIPEOUT) return

  // The edge is read at the load it has already built, before this step adds to
  // it, so the scrub follows the carve rather than leading it by a frame.
  let accel = driveAccel(rider.kite.angle, rider.speed, wind)
  if (input.loading) accel -= carveDrag(rider.load, rider.speed)
  applySpeed(rider, accel, dt)

  if (input.loading) buildLoad(rider, dt)
}

/**
 * Whether the kite is back out of the water (spec §7.2).
 *
 * A relaunch is not a timer alone. The kite is lying in the water where the
 * crash left it, and it flies again only when the player has dragged it out to
 * the edge of the window — which is where a real one is relaunched from, and
 * which is what makes the beat a mild skill check rather than a pause. The
 * WIPEOUT_RECOVER beat is the floor under it: the kite is not going anywhere
 * for that long however quickly the player reacts.
 *
 * Dragged at RELAUNCH_SLEW of the flying rate, the trip from a kite parked at
 * zenith — the wipeout the landing table hands out most often — is about as
 * long as the beat itself, so a player who steers straight away spends the ~2s
 * the spec asks for and one who does not spends as long as they take.
 */
function relaunched(rider: RiderState): boolean {
  return rider.recover <= 0 && rider.kite.angle >= TUNING.RELAUNCH_ANGLE
}

/**
 * Phase bookkeeping (spec §3.7), run last so it sees the step it is describing.
 *
 * The air and the two recovery beats own the phase outright; on the water it is
 * only ever a readout of whether the player is edging. LANDING and WIPEOUT are
 * entered by `touchdown` and left here — a landing when its beat runs out, a
 * wipeout when the kite is flying again.
 */
function stepPhase(rider: RiderState, input: RiderInput, dt: number): void {
  if (rider.airborne) {
    rider.phase = PHASE.AIRBORNE
    rider.recover = 0
    return
  }

  if (rider.recover > 0) {
    rider.recover -= dt
    if (rider.recover < 0) rider.recover = 0
  }

  if (rider.phase === PHASE.WIPEOUT) {
    if (!relaunched(rider)) return
  } else if (rider.recover > 0) {
    return
  }

  rider.phase = input.loading ? PHASE.LOADING : PHASE.RIDING
}

/**
 * Advance the rider one fixed step.
 *
 * The kite slews first and always: steering is live every frame and the load
 * input never gates it (spec §5.2) — including through the air, where it is the
 * only control left, and through a wipeout, where steering the kite back to the
 * edge of the window is the whole of the relaunch beat. It travels at
 * RELAUNCH_SLEW of its usual rate while it is down there: a kite being dragged
 * through water is not a kite being flown.
 *
 * `kicker` is what the water under the board is worth this step (spec §4.2).
 * It defaults to flat water, so every caller that has no world — every physics
 * test, and the sim before waves existed — reads exactly as it did.
 */
export function stepRider(
  rider: RiderState,
  input: RiderInput,
  wind: number,
  dt: number,
  kicker: Kicker = NO_KICKER,
): void {
  const down = rider.phase === PHASE.WIPEOUT
  stepKite(
    rider.kite,
    targetFromInput(input.kiteTarget),
    wind,
    dt,
    down ? TUNING.RELAUNCH_SLEW : 1,
  )

  if (rider.airborne) stepAir(rider, wind, dt)
  else stepWater(rider, input, wind, dt)

  if (rider.loading && !input.loading) release(rider, wind, kicker)
  rider.loading = input.loading

  stepPhase(rider, input, dt)
  rider.x += rider.speed * dt
}
