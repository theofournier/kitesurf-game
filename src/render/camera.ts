// Camera framing (spec §6.4). Pure arithmetic on a preallocated struct — it
// touches no canvas, so it is unit-testable headless.
import { TUNING } from '../config/tuning.ts'

/**
 * Height up the rider's body where the lines converge, as a fraction of
 * RIDER_H — the harness, and so the centre of the window arc. Anatomy of a
 * grey box, not a tuning value.
 */
const HARNESS_H = 0.62

export interface Camera {
  /** World x at the left edge of the view, metres. */
  x: number
  /** Camera altitude, metres. Follows the rider at CAM_ALT_FOLLOW, damped. */
  alt: number
  /** Screen x of the rider, px. */
  anchorX: number
  /** Screen y of the rider's board, px. */
  feetY: number
  /** Screen y of the harness — where the lines meet and the arc is centred. */
  harnessY: number
  /** Screen y of the water surface in the rider's plane, px. */
  waterY: number
  /** Screen y of the horizon, px. Fixed: it is the altitude reference. */
  horizonY: number
}

export function createCamera(): Camera {
  return resetCamera({} as Camera)
}

/**
 * Points the camera back at a rider standing at the origin, in place — the
 * restart of spec §10.
 *
 * `alt` is the only field that carries anything over: everything else is
 * recomputed from scratch by the next `updateCamera`, while the altitude
 * follow is integrated and would otherwise start the new run easing down from
 * wherever the last one crashed.
 */
export function resetCamera(camera: Camera): Camera {
  camera.x = 0
  camera.alt = 0
  camera.anchorX = 0
  camera.feetY = 0
  camera.harnessY = 0
  camera.waterY = 0
  camera.horizonY = 0
  return camera
}

/**
 * A screen x, mirrored if the run is going left (spec §6.5).
 *
 * The world itself is mirrored by a transform on the context — one flip of the
 * whole frame, never a second set of signs through the drawing code. This is
 * for the handful of things that live *outside* that transform and still have
 * to line up with it: the input anchor, and any text, which would otherwise be
 * drawn backwards.
 */
export function mirrorX(width: number, facing: number, x: number): number {
  return facing < 0 ? width - x : x
}

/**
 * Frame-rate independent exponential approach: the fraction of the remaining
 * gap to close over `dt` at rate `perSecond`. This runs on render frames, not
 * sim steps, which is exactly why it cannot be a raw per-frame lerp.
 */
export function damping(perSecond: number, dt: number): number {
  return 1 - Math.exp(-perSecond * dt)
}

/**
 * Point the camera at the rider.
 *
 * Horizontal: the rider is pinned at ANCHOR_X of the width, in the direction of
 * travel, and the world scrolls past. Vertical: the camera follows altitude at
 * CAM_ALT_FOLLOW, so a rider 10m up has climbed 4m of screen while the water
 * has receded 6m — the rider visibly rises, and the horizon does not move at
 * all, which is what makes the height read (spec §6.4).
 *
 * Everything here is drawn as if riding right. Riding left is a horizontal
 * mirror of the finished frame, never a second set of signs (spec §6.5).
 *
 * `dt` is real frame time, not the sim step: only the damping uses it, and no
 * physics is downstream of this.
 */
export function updateCamera(
  camera: Camera,
  width: number,
  height: number,
  riderX: number,
  riderAlt: number,
  dt: number,
): void {
  const target = riderAlt * TUNING.CAM_ALT_FOLLOW
  camera.alt += (target - camera.alt) * damping(TUNING.CAM_DAMP, dt)

  camera.anchorX = width * TUNING.ANCHOR_X
  camera.x = riderX - camera.anchorX / TUNING.WORLD_SCALE

  const rest = height * TUNING.WATERLINE_Y
  camera.waterY = rest + camera.alt * TUNING.WORLD_SCALE
  camera.feetY = rest - (riderAlt - camera.alt) * TUNING.WORLD_SCALE
  camera.harnessY = camera.feetY - TUNING.RIDER_H * HARNESS_H
  camera.horizonY = height * TUNING.HORIZON_Y
}

/** World metres → screen px. */
export function screenX(camera: Camera, worldX: number): number {
  return (worldX - camera.x) * TUNING.WORLD_SCALE
}
