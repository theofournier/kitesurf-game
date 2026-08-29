// Rider physics (spec §3.3). The state machine — load, pop, air, landing —
// lands here in later sessions; this session is the kite and the speed it
// drives.
//
// Pure: mutates a preallocated RiderState in place, allocates nothing per step.
import { TUNING } from '../config/tuning.ts'
import {
  createKiteState,
  driveFactor,
  stepKite,
  targetFromInput,
  windPower,
  type KiteState,
} from './kite.ts'
import type { RiderInput } from './loop.ts'

export interface RiderState {
  kite: KiteState
  /** Horizontal speed, m/s. Held in 0..MAX_SPEED (spec §3.1). */
  speed: number
}

export function createRiderState(): RiderState {
  return { kite: createKiteState(), speed: 0 }
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
 * Advance the rider one fixed step: slew the kite toward where the player is
 * pointing, then integrate speed against drag at the angle that produced.
 */
export function stepRider(rider: RiderState, input: RiderInput, wind: number, dt: number): void {
  stepKite(rider.kite, targetFromInput(input.kiteTarget), wind, dt)

  let speed = rider.speed + driveAccel(rider.kite.angle, rider.speed, wind) * dt
  if (speed < 0) speed = 0
  else if (speed > TUNING.MAX_SPEED) speed = TUNING.MAX_SPEED
  rider.speed = speed
}
