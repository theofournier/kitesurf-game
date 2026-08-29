// The wind window: where the kite is, how fast it gets there, and what it pulls
// when it arrives (spec §3.2, §3.3).
//
// Pure: every function returns a number or mutates a preallocated KiteState in
// place. No allocation, no clock, no randomness.
import { TUNING } from '../config/tuning.ts'

/**
 * The window arc, in degrees: 0 is zenith (12 o'clock), 90 is the edge of the
 * window (3 or 9 o'clock). These define the coordinate system (spec §3.1)
 * rather than tune the feel of it, which is why they are not TUNING values —
 * same reasoning as MAX_FRAME_TIME in loop.ts.
 */
export const WINDOW_MIN = 0
export const WINDOW_MAX = 90

const DEG2RAD = Math.PI / 180

/**
 * Arrival tolerance, in degrees. The slew lands on its aim by an exact
 * subtraction, so this only absorbs float dust — it is not a deadzone.
 */
const ANGLE_EPS = 1e-9

/**
 * Kite state. `angle` and `target` are the two spec §3.1 variables; the rest is
 * the bookkeeping the overshoot needs, kept here so the sim allocates nothing
 * per step.
 */
export interface KiteState {
  /** Current position on the window arc, degrees from zenith. Always 0..90. */
  angle: number
  /** Where the player is pointing, degrees. Always 0..90. */
  target: number
  /** What the slew is actually driving at: `target`, or the overshoot past it. */
  aim: number
  /**
   * Degrees of the current sweep: travel in one unbroken direction, counting
   * only frames where the kite was moving at its full slew rate. A pointer the
   * kite can keep up with is being steered, not swept, and earns no overshoot;
   * a sweep that outruns the kite accumulates here whether it arrived as one
   * jump or as a fast drag.
   */
  run: number
  /** Direction of the last movement: -1, 0 or +1. */
  dir: number
  /** Seconds left in the settle-back. 0 while slewing. */
  settle: number
  /** Angle the settle-back started from. */
  settleFrom: number
  /** True while carrying past `target` toward the overshoot `aim`. */
  overshooting: boolean
}

export function createKiteState(angle: number = WINDOW_MIN): KiteState {
  const start = clampAngle(angle)
  return {
    angle: start,
    target: start,
    aim: start,
    run: 0,
    dir: 0,
    settle: 0,
    settleFrom: start,
    overshooting: false,
  }
}

/** Holds an angle inside the window. The kite can never leave 0..90 (spec §3.1). */
export function clampAngle(deg: number): number {
  if (deg < WINDOW_MIN) return WINDOW_MIN
  if (deg > WINDOW_MAX) return WINDOW_MAX
  return deg
}

/** Maps the platform-neutral 0..1 input axis onto the window arc (spec §5.1). */
export function targetFromInput(axis: number): number {
  return clampAngle(axis * WINDOW_MAX)
}

/**
 * Max angular rate of the kite, deg/s (spec §3.2). 90 deg/s at 12kt, ~142 at
 * 35kt. This travel time is the core skill gate — the kite has to be sent
 * before you want to leave the water.
 */
export function slewRate(wind: number): number {
  return TUNING.BASE_SLEW * (1 + (wind - TUNING.WIND_BASE) / TUNING.SLEW_WIND_SCALE)
}

/**
 * Wind as a multiple of tier 1, the term that scales drive and lift with the
 * tier (spec §7.1). 1.0 at 12kt, ~2.9 at 35kt.
 */
export function windPower(wind: number): number {
  return wind / TUNING.WIND_BASE
}

/**
 * Forward pull as a function of window position (spec §3.3):
 *
 *     driveFactor(θ) = sin(θ) * cos(θ * DRIVE_SHAPE)
 *
 * Zero at zenith, where the kite only lifts. DRIVE_SHAPE is the spec's literal
 * 0.5; it is a TUNING value because it is what moves the peak (0.5 → 70.5°,
 * 0.88 → 50°), and the spec's own comment and its formula disagree about where
 * the peak belongs. See tests/kite.test.ts.
 */
export function driveFactor(theta: number): number {
  return Math.sin(theta * DEG2RAD) * Math.cos(theta * TUNING.DRIVE_SHAPE * DEG2RAD)
}

/**
 * Lift as a function of window position (spec §3.3):
 *
 *     liftFactor(θ) = cos(θ) ^ LIFT_EXP
 *
 * Max at zenith, ~0 at the edge of the window.
 */
export function liftFactor(theta: number): number {
  const c = Math.cos(theta * DEG2RAD)
  return c <= 0 ? 0 : c ** TUNING.LIFT_EXP
}

/**
 * Advance the kite one fixed step toward `targetDeg`.
 *
 * The kite never snaps: it travels at `slewRate`. A sweep longer than
 * OVERSHOOT_MIN_SWEEP carries OVERSHOOT_DEG past the target and settles back
 * over OVERSHOOT_SETTLE, which is what makes a smooth sweep read as "sending
 * it" and a panic flick read as a panic flick (spec §3.2).
 *
 * The overshoot is aimed at a clamped angle, so a sweep to the very edge of the
 * window has nowhere to carry to and simply arrives — `angle` stays in 0..90
 * under every input.
 */
export function stepKite(kite: KiteState, targetDeg: number, wind: number, dt: number): void {
  const target = clampAngle(targetDeg)

  // A new target abandons an overshoot in flight: the player is steering again,
  // and settling back to an angle they have already left would fight them.
  if (target !== kite.target) {
    kite.target = target
    kite.aim = target
    kite.settle = 0
    kite.overshooting = false
  }

  if (kite.settle > 0) {
    kite.settle -= dt
    if (kite.settle <= 0) {
      kite.settle = 0
      kite.angle = kite.target
    } else {
      const remaining = kite.settle / TUNING.OVERSHOOT_SETTLE
      kite.angle = kite.target + (kite.settleFrom - kite.target) * remaining
    }
    return
  }

  const maxStep = slewRate(wind) * dt
  let delta = kite.aim - kite.angle
  const remaining = delta < 0 ? -delta : delta
  // Whether the kite is pinned at its slew rate this frame, i.e. still behind
  // the pointer. Captured before the overshoot re-aims below.
  const sweeping = remaining > maxStep

  // Arm the overshoot on the frame the kite would otherwise land on the target,
  // so the sweep flows straight through instead of pausing for a frame.
  if (
    !kite.overshooting &&
    remaining > 0 &&
    remaining <= maxStep &&
    kite.run + remaining > TUNING.OVERSHOOT_MIN_SWEEP
  ) {
    const dir = delta > 0 ? 1 : -1
    const aim = clampAngle(kite.target + dir * TUNING.OVERSHOOT_DEG)
    if (aim !== kite.target) {
      kite.aim = aim
      kite.overshooting = true
      delta = aim - kite.angle
    }
  }

  const stepDeg = delta > maxStep ? maxStep : delta < -maxStep ? -maxStep : delta

  if (stepDeg !== 0) {
    const dir = stepDeg > 0 ? 1 : -1
    // A reversal starts a new sweep: only travel in one direction counts.
    if (dir !== kite.dir) {
      kite.run = 0
      kite.dir = dir
    }
    kite.angle = clampAngle(kite.angle + stepDeg)
    if (sweeping) kite.run += stepDeg > 0 ? stepDeg : -stepDeg
  }

  const gap = kite.aim - kite.angle
  if ((gap < 0 ? -gap : gap) <= ANGLE_EPS) {
    kite.angle = kite.aim
    if (kite.overshooting) {
      kite.overshooting = false
      kite.settleFrom = kite.angle
      kite.settle = TUNING.OVERSHOOT_SETTLE
      kite.aim = kite.target
    }
    kite.run = 0
    kite.dir = 0
  }
}
