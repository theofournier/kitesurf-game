// Sky, horizon and water (spec §6.4). Parallax bands do most of the work of
// selling speed and altitude, so they land before any art does.
//
// Every function draws into a caller-owned context and allocates nothing.
import { TUNING } from '../config/tuning.ts'
import type { Camera } from './camera.ts'
import { PALETTE } from './palette.ts'

/** Streak geometry, in px. Grey-box shorthand for chop, not a tuning value. */
const STREAK_LEN = 26
const STREAK_H = 2
/** Where the far band ends, as a fraction of horizon → waterline. */
const FAR_BAND = 0.45
/** Rows of streaks per band, and how far below the waterline the near band runs. */
const BAND_ROWS = 3
const NEAR_BAND_PX = 190

/**
 * One row of streaks scrolling at `parallax` times the rider's own plane.
 *
 * The row is drawn from a phase offset rather than from a list of positions:
 * the streaks are a repeating pattern in world space, so the only state needed
 * is where the pattern currently starts. Nothing is allocated and nothing is
 * kept between frames.
 */
function drawStreakRow(
  ctx: CanvasRenderingContext2D,
  width: number,
  y: number,
  length: number,
  camX: number,
  parallax: number,
): void {
  const spacing = TUNING.WATER_BAND_M * TUNING.WORLD_SCALE
  const scrolled = camX * TUNING.WORLD_SCALE * parallax
  // Two modulos: the first can return a negative remainder, and a negative
  // phase would leave a gap at the left edge.
  const phase = ((-scrolled % spacing) + spacing) % spacing

  for (let x = phase - spacing; x < width; x += spacing) {
    ctx.fillRect(x, y, length, STREAK_H)
  }
}

/** Sky above the horizon, sea below it. Flat fills: the shape is the point. */
export function drawSky(ctx: CanvasRenderingContext2D, width: number, camera: Camera): void {
  ctx.fillStyle = PALETTE.sky
  ctx.fillRect(0, 0, width, camera.horizonY)

  ctx.fillStyle = PALETTE.horizon
  ctx.fillRect(0, camera.horizonY, width, 1)
}

/**
 * The water: a far plane below the horizon, the rider's own surface, and the
 * bands of chop between and in front of them.
 *
 * The three bands scroll at PARALLAX_FAR/MID/NEAR times the rider's speed.
 * That spread is the whole speed cue at this stage — the rider does not move
 * on screen, so all of the motion has to come from what passes them.
 */
export function drawWater(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: Camera,
): void {
  const horizon = camera.horizonY
  const water = camera.waterY

  ctx.fillStyle = PALETTE.seaFar
  ctx.fillRect(0, horizon, width, Math.max(0, water - horizon))
  ctx.fillStyle = PALETTE.sea
  ctx.fillRect(0, water, width, Math.max(0, height - water))

  const gap = water - horizon
  const farEnd = horizon + gap * FAR_BAND

  ctx.fillStyle = PALETTE.streakFar
  for (let row = 0; row < BAND_ROWS; row++) {
    const t = (row + 1) / (BAND_ROWS + 1)
    drawStreakRow(ctx, width, horizon + gap * FAR_BAND * t, STREAK_LEN * 0.5, camera.x, TUNING.PARALLAX_FAR)
  }

  ctx.fillStyle = PALETTE.streakMid
  for (let row = 0; row < BAND_ROWS; row++) {
    const t = (row + 1) / (BAND_ROWS + 1)
    drawStreakRow(ctx, width, farEnd + (water - farEnd) * t, STREAK_LEN, camera.x, TUNING.PARALLAX_MID)
  }

  // The waterline: the rider's own plane, and the line altitude is measured
  // against. It moves down the screen as the camera climbs.
  ctx.fillStyle = PALETTE.waterline
  ctx.fillRect(0, water, width, 1)

  ctx.fillStyle = PALETTE.streakNear
  for (let row = 0; row < BAND_ROWS; row++) {
    const t = (row + 1) / BAND_ROWS
    drawStreakRow(
      ctx,
      width,
      water + NEAR_BAND_PX * t * t,
      STREAK_LEN * (1 + t),
      camera.x,
      TUNING.PARALLAX_NEAR,
    )
  }
}
