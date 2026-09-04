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
 * How much of the tier wash the top of the curve lays on. The sky takes less
 * than the water: a sky washed as hard as the sea loses the horizon, which is
 * the one line the whole frame is composed around.
 */
const TINT_SKY = 0.55
const TINT_SEA = 0.4

/**
 * Lays the tier wash over a band already drawn (spec §7.1).
 *
 * `tint` is `windFraction`: 0 in the flat water of tier 1 and 1 at the top of
 * the curve, sliding with every metre rather than stepping at a boundary. The
 * alpha is restored on the way out, so nothing downstream inherits it.
 */
function wash(
  ctx: CanvasRenderingContext2D,
  colour: string,
  alpha: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (!(alpha > 0) || !(h > 0)) return

  ctx.globalAlpha = alpha
  ctx.fillStyle = colour
  ctx.fillRect(x, y, w, h)
  ctx.globalAlpha = 1
}

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

/**
 * Sky above the horizon, sea below it. Flat fills: the shape is the point.
 *
 * `bleed` widens the flats past the frame on every side. The landing shake
 * translates the whole world (see scene.ts), and a flat that stopped at the
 * frame edge would leave a bare sliver there for as long as the shake lasted.
 */
export function drawSky(
  ctx: CanvasRenderingContext2D,
  width: number,
  camera: Camera,
  bleed = 0,
  tint = 0,
): void {
  ctx.fillStyle = PALETTE.sky
  ctx.fillRect(-bleed, -bleed, width + bleed * 2, camera.horizonY + bleed)
  wash(ctx, PALETTE.tierSky, tint * TINT_SKY, -bleed, -bleed, width + bleed * 2, camera.horizonY + bleed)

  ctx.fillStyle = PALETTE.horizon
  ctx.fillRect(-bleed, camera.horizonY, width + bleed * 2, 1)
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
  bleed = 0,
  tint = 0,
): void {
  const horizon = camera.horizonY
  const water = camera.waterY
  const wide = width + bleed * 2

  ctx.fillStyle = PALETTE.seaFar
  ctx.fillRect(-bleed, horizon, wide, Math.max(0, water - horizon))
  ctx.fillStyle = PALETTE.sea
  ctx.fillRect(-bleed, water, wide, Math.max(0, height - water) + bleed)

  // The tier wash goes under the streaks, not over them: dark water with the
  // same bright chop on it is what "whitecaps, heavy spray" has to look like
  // before there is any art (spec §7.1).
  wash(ctx, PALETTE.tierSea, tint * TINT_SEA, -bleed, horizon, wide, height - horizon + bleed)

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
  ctx.fillRect(-bleed, water, wide, 1)

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
