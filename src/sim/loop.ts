// Fixed-timestep accumulator (spec §11.2). Physics is never tied to frame rate.
import { TUNING } from '../config/tuning.ts'
import { createRiderState, stepRider, type RiderState } from './rider.ts'
import { WIND_AUTO, windAt } from './world.ts'

/** Simulation timestep. The sim only ever advances in exactly this increment. */
export const DT = 1 / 60

/**
 * Ceiling on a single frame's elapsed time before it is fed to the accumulator.
 * A loop-safety guard against the spiral of death after a tab stall — not a
 * gameplay value, which is why it does not live in TUNING.
 */
export const MAX_FRAME_TIME = 0.25

/** The one input struct every platform adapter produces (spec §5.1). */
export interface RiderInput {
  kiteTarget: number // 0..1, normalised position along window arc
  loading: boolean // held = building load, release = pop
}

/** Simulation state. Game state lands here as the sim modules are built. */
export interface SimState {
  tick: number
  time: number
  rider: RiderState
  /** Wind at the rider's distance, kt. Derived, never integrated (spec §7.1). */
  wind: number
  /**
   * Debug: forces `wind` to a fixed kt, ignoring distance. WIND_AUTO leaves the
   * curve alone, and that is what every run starts on — a recorded run replays
   * the wind it was ridden at because the override travels with the state.
   */
  windOverride: number
}

/** Leftover frame time between fixed steps, plus the render interpolation alpha. */
export interface Accumulator {
  acc: number
  alpha: number
}

export function createSimState(): SimState {
  return {
    tick: 0,
    time: 0,
    rider: createRiderState(),
    wind: TUNING.WIND_BASE,
    windOverride: WIND_AUTO,
  }
}

export function createInput(): RiderInput {
  return { kiteTarget: 0, loading: false }
}

export function createAccumulator(): Accumulator {
  return { acc: 0, alpha: 0 }
}

/**
 * Advance the simulation by exactly one fixed timestep.
 *
 * Pure in the sense that matters for determinism and replay: the next state is
 * a function of (state, input, dt) alone — no clock, no Math.random, no DOM.
 * It mutates `state` in place and returns it rather than allocating, because
 * the update loop must not allocate (spec §11.4).
 */
export function step(state: SimState, input: RiderInput, dt: number): SimState {
  state.tick += 1
  state.time += dt
  state.wind = windAt(state.rider.x, state.windOverride)
  stepRider(state.rider, input, state.wind, dt)
  return state
}

/**
 * Feed one frame's elapsed time to the accumulator, running as many fixed steps
 * as it covers. Returns the number of steps taken; `a.alpha` is left holding the
 * render interpolation alpha.
 */
export function advance(
  a: Accumulator,
  state: SimState,
  input: RiderInput,
  frameTime: number,
  dt: number = DT,
): number {
  a.acc += frameTime > MAX_FRAME_TIME ? MAX_FRAME_TIME : frameTime

  let steps = 0
  while (a.acc >= dt) {
    step(state, input, dt)
    a.acc -= dt
    steps += 1
  }

  a.alpha = a.acc / dt
  return steps
}
