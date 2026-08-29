// The bridge between sim state and drawing: one preallocated struct holding
// everything a frame needs, interpolated between the last two sim steps.
//
// The renderer never reads SimState directly. That keeps the interpolation in
// one place and keeps every draw function a pure function of a plain struct.
import { lineTension } from '../sim/kite.ts'
import type { SimState } from '../sim/loop.ts'

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
  speed: number
  wind: number
  /** Line load, 0..1 (spec §6.3). */
  tension: number
}

export function createSnapshot(): Snapshot {
  return { x: 0, altitude: 0, kiteAngle: 0, kiteTarget: 0, time: 0 }
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
    speed: 0,
    wind: 0,
    tension: 0,
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
  view.tension = lineTension(view.kiteAngle, view.speed, view.wind)
}
