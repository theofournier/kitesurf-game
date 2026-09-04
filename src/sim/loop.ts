// Fixed-timestep accumulator (spec §11.2). Physics is never tied to frame rate.
import { TUNING } from '../config/tuning.ts'
import { createRiderState, stepRider, type RiderState } from './rider.ts'
import { hitObstacle, nearestClearance, type Obstacle } from './obstacles.ts'
import {
  createScoreState,
  creditLanding,
  noteClearance,
  stepScore,
  type ScoreState,
} from './scoring.ts'
import { tierAt, tierMult, WIND_AUTO, windAt } from './wind.ts'
import {
  createKicker,
  createWorldState,
  kickerAt,
  stepWorld,
  type Kicker,
  type WorldState,
} from './world.ts'

/** Simulation timestep. The sim only ever advances in exactly this increment. */
export const DT = 1 / 60

/**
 * Ceiling on a single frame's elapsed time before it is fed to the accumulator.
 * A loop-safety guard against the spiral of death after a tab stall — not a
 * gameplay value, which is why it does not live in TUNING.
 */
export const MAX_FRAME_TIME = 0.25

/**
 * The seed every run starts on until the run structure owns one (spec §10).
 * Fixed rather than clock-derived because the sim may not read a clock, and
 * because a repeatable stream of waves is what a tuning session needs.
 */
export const DEFAULT_SEED = 0x5eed

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
  /** Waves, obstacles and the seeded stream that lays them down (spec §9.2). */
  world: WorldState
  /**
   * What the water under the board is worth to a pop this step (spec §4.2).
   * Recomputed every step into the same struct, so the loop allocates nothing.
   */
  kicker: Kicker
  /** Wind at the rider's distance, kt. Derived, never integrated (spec §7.1). */
  wind: number
  /**
   * Which of the four tiers that distance falls in, 1..4. Derived from `x` like
   * the wind is, and the multiplier a jump is scored at (spec §7.1, §8.1).
   */
  tier: number
  /** The run's score, its combo and its records (spec §8). */
  score: ScoreState
  /**
   * The obstacle the rider ran into on this step, or null for a clean pass
   * (spec §9.1). Held after the crash, so what ended the run can be named.
   */
  hit: Obstacle | null
  /**
   * True once the rider has hit something (spec §7.2). Contact with a boat, a
   * buoy or a pier is fatal and the run is over: `step` does nothing at all
   * from here, so the world the crash happened in is exactly what the game-over
   * screen draws over.
   *
   * The other crash, a wipeout, is not this: it costs the speed and the combo
   * and hands the kite back after the relaunch beat. That split is what makes
   * endless work — risk lives in the line, not in the trick.
   */
  over: boolean
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

export function createSimState(seed: number = DEFAULT_SEED): SimState {
  return {
    tick: 0,
    time: 0,
    rider: createRiderState(),
    world: createWorldState(seed),
    kicker: createKicker(),
    wind: TUNING.WIND_BASE,
    tier: tierAt(0),
    score: createScoreState(),
    hit: null,
    over: false,
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
  // A fatal crash ends the run outright (spec §7.2). Nothing moves after it:
  // the tick, the clock and the score all stop where the rider did.
  if (state.over) return state

  state.tick += 1
  state.time += dt
  state.wind = windAt(state.rider.x, state.windOverride)
  state.tier = tierAt(state.rider.x)

  // The kicker is read at the top of the step, from the position and speed the
  // rider arrived with, and the release inside stepRider spends it. That leaves
  // the lip timing at most one step stale against a 300ms window — a twentieth
  // of it — and keeps the rider from having to know what a wave is.
  stepWorld(state.world, state.rider.x, state.windOverride)
  kickerAt(state.kicker, state.world, state.rider.x, state.rider.speed)

  // Where the step started, so contact is a swept test over the whole of it
  // rather than a sample at the end: at MAX_SPEED a step covers 0.37m and a
  // buoy is 0.8m wide.
  const fromX = state.rider.x
  const fromAlt = state.rider.altitude

  stepRider(state.rider, input, state.wind, dt, state.kicker)

  // Scored off the same swept path the collision test uses, and before it: the
  // metre the rider travelled into a boat is a metre they travelled, and an air
  // that shaved a mast on the way is owed the near miss whichever way it ends.
  noteClearance(
    state.score,
    nearestClearance(state.world.obstacles, fromX, fromAlt, state.rider.x, state.rider.altitude),
    state.rider.x,
  )
  if (state.rider.landings !== state.score.landings) {
    creditLanding(
      state.score,
      state.rider.apex,
      state.rider.landingQuality,
      state.rider.lastKicker,
      state.rider.x,
      tierMult(state.tier),
      state.rider.landings,
    )
  }
  stepScore(state.score, state.rider.x)

  state.hit = hitObstacle(
    state.world.obstacles,
    fromX,
    fromAlt,
    state.rider.x,
    state.rider.altitude,
  )
  if (state.hit !== null) state.over = true

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
