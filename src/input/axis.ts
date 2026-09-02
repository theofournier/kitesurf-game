// The one mapping every platform shares: a point on screen → the 0..1 axis of
// RiderInput (spec §5.1).
//
// This file is the whole reason an "input abstraction" exists. Desktop and
// touch differ in how a point arrives — a pointer that is always there versus a
// thumb that comes and goes — but not in what a point *means*, and the moment
// the two grow separate arithmetic the sim starts being able to tell which
// platform it is on. So there is exactly one implementation, and both adapters
// call it.
//
// Pure: no DOM, no clock. It sits in /src/input rather than /src/sim only
// because the sim has no business knowing about screens.
import { WINDOW_MAX, WINDOW_MIN } from '../sim/kite.ts'

const RAD2DEG = 180 / Math.PI

/** Where on screen the rider is, in CSS pixels, and which way it is riding. */
export interface Anchor {
  x: number
  y: number
  /** +1 riding right, -1 riding left — the world mirror of spec §6.5. */
  facing: number
}

export function createAnchor(): Anchor {
  return { x: 0, y: 0, facing: 1 }
}

/**
 * Offset from the rider → position along the window arc, 0..1.
 *
 * Absolute mapping, not deltas (spec §5.2, §5.3): the angle from the rider to
 * the point *is* the kite position, so where your hand or thumb is is where the
 * kite is on the arc. Distance is ignored — only the angle matters, since the
 * kite orbits at a fixed radius (spec §6.2).
 *
 * `dx` is measured in the direction of travel and `dyUp` upward, so both are
 * positive toward the front of the window. Straight up is zenith (0), straight
 * ahead is the edge of the window (1), and anything outside the quarter — the
 * point behind the rider, or below the waterline — clamps to whichever end it
 * is nearest.
 */
export function axisFromOffset(dx: number, dyUp: number): number {
  // atan2(x, y) rather than the usual (y, x): the angle is measured from
  // straight up, which is how the window is defined (spec §3.1).
  const deg = Math.atan2(dx, dyUp) * RAD2DEG
  if (!(deg > WINDOW_MIN)) return 0
  if (deg >= WINDOW_MAX) return 1
  return deg / WINDOW_MAX
}

/**
 * A point in canvas CSS pixels → the same 0..1 axis.
 *
 * The screen y axis points down and the window's points up, and the whole frame
 * mirrors when riding left (spec §6.5) — both of which are handled here, once,
 * so that no adapter carries a sign of its own.
 */
export function axisFromPoint(anchor: Anchor, x: number, y: number): number {
  return axisFromOffset((x - anchor.x) * anchor.facing, anchor.y - y)
}
