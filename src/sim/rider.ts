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
  /** The beat after a landing that did not: kite down, speed gone (§7.2). */
  WIPEOUT: 'WIPEOUT',
} as const

export type Phase = (typeof PHASE)[keyof typeof PHASE]

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
    phase: PHASE.RIDING,
    recover: 0,
    apex: 0,
    airTime: 0,
    descentRate: 0,
    landingQuality: 0,
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
 * Speed a kite parked at `theta` settles at — where drive balances drag — held
 * to MAX_SPEED, which spec §3.1 makes the ceiling on the state variable itself.
 *
 * At the drive peak the unlimited balance is ~15 m/s at 12kt and ~26 m/s at
 * 35kt, so the ceiling is what the top tier actually rides against.
 */
export function terminalSpeed(theta: number, wind: number): number {
  const balance = Math.sqrt((driveFactor(theta) * windPower(wind) * TUNING.DRIVE_K) / TUNING.DRAG_K)
  return balance > TUNING.MAX_SPEED ? TUNING.MAX_SPEED : balance
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
 * The landing table (spec §3.7), evaluated at touchdown. Returns
 * `landingQuality`: 1.0 clean, 0.4 sketchy, 0 wipeout.
 *
 * `descent` is the descent rate, positive downward. The rows are tested in the
 * spec's order and anything that matches neither is a wipeout, which covers
 * both of the spec's explicit wipeout rows — a kite still parked at zenith
 * (θ < 20) and a descent at or past HARD_LAND — plus the case its table leaves
 * out, a kite dumped past the sketchy band with a gentle descent. Landing with
 * the kite at the edge of the window is a wipeout for the same reason landing
 * with it at zenith is: it is not pulling in the direction of travel.
 *
 * Redirecting the kite back toward the direction of travel before touchdown is
 * the third timing window of the game, after load duration and send timing.
 */
export function landingQuality(theta: number, descent: number): number {
  if (
    theta >= TUNING.CLEAN_BAND[0] &&
    theta <= TUNING.CLEAN_BAND[1] &&
    descent < TUNING.SOFT_LAND
  ) {
    return TUNING.CLEAN_QUALITY
  }

  if (
    theta >= TUNING.SKETCHY_BAND[0] &&
    theta <= TUNING.SKETCHY_BAND[1] &&
    descent < TUNING.HARD_LAND
  ) {
    return TUNING.SKETCHY_QUALITY
  }

  return 0
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

/** Spends the load on the release edge (spec §3.5). */
function release(rider: RiderState, wind: number): void {
  const forfeit = rider.popForfeit || rider.airborne
  const impulse = forfeit ? 0 : popImpulse(rider.load, rider.kite.angle, wind)

  if (impulse > 0) {
    rider.vSpeed = impulse
    rider.airborne = true
    rider.apex = 0
    rider.airTime = 0
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
  const quality = landingQuality(rider.kite.angle, descent)

  rider.altitude = 0
  rider.vSpeed = 0
  rider.airborne = false
  rider.descentRate = descent
  rider.landingQuality = quality
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
 * making. Drive is absent at every kite angle — you cannot accelerate in the
 * air — so `speed` is untouched here and the jump carries the speed it left on.
 */
function stepAir(rider: RiderState, wind: number, dt: number): void {
  rider.vSpeed -= TUNING.GRAVITY * dt
  rider.vSpeed += floatAccel(rider.kite.angle, wind) * dt
  rider.altitude += rider.vSpeed * dt
  rider.airTime += dt
  if (rider.altitude > rider.apex) rider.apex = rider.altitude

  if (rider.altitude <= 0) touchdown(rider)
}

/** One step on the water (spec §3.3, §3.4): drive against drag, and load. */
function stepWater(rider: RiderState, input: RiderInput, wind: number, dt: number): void {
  // The relaunch beat is dead time by design: the kite is in the water, so
  // there is nothing to drive against and nothing to edge against either.
  if (rider.phase === PHASE.WIPEOUT) return

  let speed = rider.speed + driveAccel(rider.kite.angle, rider.speed, wind) * dt
  if (speed < 0) speed = 0
  else if (speed > TUNING.MAX_SPEED) speed = TUNING.MAX_SPEED
  rider.speed = speed

  if (input.loading) buildLoad(rider, dt)
}

/**
 * Phase bookkeeping (spec §3.7), run last so it sees the step it is describing.
 *
 * The air and the two recovery beats own the phase outright; on the water it is
 * only ever a readout of whether the player is edging. LANDING and WIPEOUT are
 * entered by `touchdown` and left here, when their beat runs out.
 */
function stepPhase(rider: RiderState, input: RiderInput, dt: number): void {
  if (rider.airborne) {
    rider.phase = PHASE.AIRBORNE
    rider.recover = 0
    return
  }

  if (rider.recover > 0) {
    rider.recover -= dt
    if (rider.recover > 0) return
    rider.recover = 0
  }

  rider.phase = input.loading ? PHASE.LOADING : PHASE.RIDING
}

/**
 * Advance the rider one fixed step.
 *
 * The kite slews first and always: steering is live every frame and the load
 * input never gates it (spec §5.2) — including through the air, where it is the
 * only control left, and through a wipeout, where steering the kite back is the
 * whole of the relaunch beat.
 */
export function stepRider(rider: RiderState, input: RiderInput, wind: number, dt: number): void {
  stepKite(rider.kite, targetFromInput(input.kiteTarget), wind, dt)

  if (rider.airborne) stepAir(rider, wind, dt)
  else stepWater(rider, input, wind, dt)

  if (rider.loading && !input.loading) release(rider, wind)
  rider.loading = input.loading

  stepPhase(rider, input, dt)
  rider.x += rider.speed * dt
}
