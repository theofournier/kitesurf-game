// The bridge between sim state and drawing: one preallocated struct holding
// everything a frame needs, interpolated between the last two sim steps.
//
// The renderer never reads SimState directly. That keeps the interpolation in
// one place and keeps every draw function a pure function of a plain struct.
import { lineTension } from '../sim/kite.ts'
import type { SimState } from '../sim/loop.ts'
import type { Obstacle } from '../sim/obstacles.ts'
import { LAND_REASON, PHASE, type LandReason, type Phase } from '../sim/rider.ts'
import { createScoreState, type ScoreState } from '../sim/scoring.ts'
import { windFraction } from '../sim/wind.ts'
import type { Wave } from '../sim/world.ts'

/** What a view holds before the first frame: no world, so nothing in it. */
const NO_WAVES: readonly Wave[] = []
const NO_OBSTACLES: readonly Obstacle[] = []

/** The sim values worth interpolating: everything that moves on screen. */
export interface Snapshot {
  x: number
  altitude: number
  kiteAngle: number
  kiteTarget: number
  time: number
}

export interface RenderView extends Snapshot {
  /** Viewport size in CSS px — the coordinate space every draw call works in. */
  width: number
  height: number
  /**
   * Which way the run is going: +1 right, -1 left (spec §6.5).
   *
   * Chosen before the run and never touched by the sim, which has no idea a
   * direction exists — riding left is a horizontal mirror of the finished
   * frame, so this is a fact about the camera and not about the water. That is
   * why `interpolateView` leaves it alone: the shell sets it when the run
   * starts and it holds for the length of it.
   */
  facing: number
  speed: number
  wind: number
  /** Which of the four tiers the rider is in, 1..4 (spec §7.1). */
  tier: number
  /**
   * How far up the whole wind curve this run has got, 0..1. The sliding half of
   * the tier feedback — the water darkens with every metre, where the tier
   * banner and the score multiplier step at the boundary.
   */
  windTint: number
  /** The run's score, its combo and its records, by reference (spec §8). */
  score: ScoreState
  /** True once a fatal crash has ended the run (spec §7.2). */
  over: boolean
  /** Line load, 0..1 (spec §6.3). */
  tension: number
  /** Which phase of a run the rider is in (spec §3.7). */
  phase: Phase
  /** Vertical velocity, m/s. Positive up. */
  vSpeed: number
  /** Highest altitude of the current or most recent air, m. */
  apex: number
  /** What the last touchdown scored, 0..1 (spec §3.7). */
  landingQuality: number
  /** Why that touchdown was not clean, NONE when it was (spec §3.7). */
  landingReason: LandReason
  /**
   * Touchdowns so far. The landing feedback fires on this changing rather than
   * on the phase, so a landing is reacted to exactly once even if two frames
   * fall inside the same beat.
   */
  landings: number
  /**
   * The world's wave pool, by reference (spec §4).
   *
   * Not interpolated and not copied: a wave does not move, so the only thing
   * animating it is the camera, and copying the pool every frame would be an
   * allocation on the render path for no motion at all. The renderer treats it
   * as read-only, which is the same contract every other field here has.
   */
  waves: readonly Wave[]
  /** The world's obstacle pool (spec §9.1), by reference and on the same terms. */
  obstacles: readonly Obstacle[]
}

export function createSnapshot(): Snapshot {
  return resetSnapshot({} as Snapshot)
}

/**
 * Puts a snapshot back to the first frame of a run, in place (spec §10).
 *
 * Both snapshots have to go together with the sim: they are what the frame
 * interpolates *from*, so one left holding the crash that ended the last run
 * would draw a single frame of the rider streaking back across the world from
 * wherever they died.
 */
export function resetSnapshot(snapshot: Snapshot): Snapshot {
  snapshot.x = 0
  snapshot.altitude = 0
  snapshot.kiteAngle = 0
  snapshot.kiteTarget = 0
  snapshot.time = 0
  return snapshot
}

export function createView(): RenderView {
  return {
    x: 0,
    altitude: 0,
    kiteAngle: 0,
    kiteTarget: 0,
    time: 0,
    width: 0,
    height: 0,
    facing: 1,
    speed: 0,
    wind: 0,
    tier: 1,
    windTint: 0,
    score: createScoreState(),
    over: false,
    tension: 0,
    phase: PHASE.RIDING,
    vSpeed: 0,
    apex: 0,
    landingQuality: 0,
    landingReason: LAND_REASON.NONE,
    landings: 0,
    waves: NO_WAVES,
    obstacles: NO_OBSTACLES,
  }
}

/** Copies the interpolatable values out of the sim, in place. */
export function captureSnapshot(snapshot: Snapshot, state: SimState): void {
  snapshot.x = state.rider.x
  snapshot.altitude = state.rider.altitude
  snapshot.kiteAngle = state.rider.kite.angle
  snapshot.kiteTarget = state.rider.kite.target
  snapshot.time = state.time
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/**
 * Fills `view` with the frame to draw: the sim state, rewound by `1 - alpha`
 * of a step toward `previous` (spec §11.2).
 *
 * The sim runs at a fixed 60Hz and the display does not, so a frame almost
 * never lands on a step boundary. Interpolating is what keeps a 144Hz monitor
 * from showing 60Hz judder — and it is the only place the leftover alpha is
 * allowed to touch anything.
 */
export function interpolateView(
  view: RenderView,
  previous: Snapshot,
  state: SimState,
  alpha: number,
): void {
  view.x = lerp(previous.x, state.rider.x, alpha)
  view.altitude = lerp(previous.altitude, state.rider.altitude, alpha)
  view.kiteAngle = lerp(previous.kiteAngle, state.rider.kite.angle, alpha)
  view.kiteTarget = lerp(previous.kiteTarget, state.rider.kite.target, alpha)
  view.time = lerp(previous.time, state.time, alpha)

  // Not interpolated: neither is a position, and both are read for their value
  // rather than for their motion.
  view.speed = state.rider.speed
  view.wind = state.wind
  view.tier = state.tier
  view.windTint = windFraction(state.wind)
  view.score = state.score
  view.over = state.over
  view.phase = state.rider.phase
  view.vSpeed = state.rider.vSpeed
  view.apex = state.rider.apex
  view.landingQuality = state.rider.landingQuality
  view.landingReason = state.rider.landingReason
  view.landings = state.rider.landings
  view.waves = state.world.waves
  view.obstacles = state.world.obstacles
  view.tension = lineTension(view.kiteAngle, view.speed, view.wind)
}
