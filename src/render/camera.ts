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
  return { x: 0, alt: 0, anchorX: 0, feetY: 0, harnessY: 0, waterY: 0, horizonY: 0 }
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
