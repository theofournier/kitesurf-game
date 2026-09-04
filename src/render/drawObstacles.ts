// The lethal furniture, drawn (spec §9.1).
//
// Grey-box shapes until session 11, but the telegraph is not a placeholder: an
// obstacle the player cannot see yet is an obstacle they cannot be expected to
// clear, and spec §9.2's whole promise is that they can. So every object here
// starts showing at least as far out as the gap the spawn gate reserved for it,
// as its own silhouette where the frame reaches and as an edge marker where it
// does not — which is what makes the guarantee hold on a phone in landscape as
// well as on a desktop.
//
// Allocates nothing: every object is drawn straight out of the sim's pool.
import { TUNING } from '../config/tuning.ts'
import { minSafeGap } from '../sim/fairness.ts'
import { farEdge, type Obstacle } from '../sim/obstacles.ts'
import { screenX, type Camera } from './camera.ts'
import { telegraphRange } from './drawWaves.ts'
import { PALETTE } from './palette.ts'
import type { RenderView } from './view.ts'

/** How far past the frame an object is still worth drawing, px. */
const MARGIN = 90
/** The lit top edge of a silhouette, px. */
const TOP_H = 3
/** The mast, px: thin, and the reason a boat is not a 2.4m obstacle. */
const MAST_W = 3
/** Edge marker: px from the right edge, and the size of the chevron. */
const MARK_INSET = 20
const MARK_W = 13
const MARK_H = 9
/** Floor on the marker's alpha, so an obstacle never fades out mid-approach. */
const MARK_MIN_ALPHA = 0.35

/**
 * How far out an obstacle starts being telegraphed, m.
 *
 * The larger of the wave lead and the gap the fairness gate reserved for this
 * kind of object: a spawn is committed no closer than `minSafeGap`, so showing
 * it from exactly there means the player sees it for the whole of the window
 * the guarantee is written against. Derived rather than tuned, so a change to
 * the physics that lengthens a send lengthens the warning with it.
 */
export function obstacleRange(obstacle: Obstacle, wind: number): number {
  const gate = minSafeGap(obstacle.type, wind)
  const wave = telegraphRange()
  return gate > wave ? gate : wave
}

/** True while any part of the object falls inside the frame. */
export function obstacleOnScreen(camera: Camera, view: RenderView, obstacle: Obstacle): boolean {
  if (!obstacle.active) return false
  const left = screenX(camera, obstacle.x)
  const right = screenX(camera, farEdge(obstacle))
  return right > -MARGIN && left < view.width + MARGIN
}

/**
 * True while the obstacle is showing at all — as its own silhouette, or as the
 * edge marker standing in for it while it is still off the right of the frame.
 *
 * This is the visibility half of the fairness guarantee, in one predicate.
 */
export function obstacleTelegraphed(camera: Camera, view: RenderView, obstacle: Obstacle): boolean {
  if (!obstacle.active) return false
  const ahead = obstacle.gateX - view.x
  if (ahead > 0 && ahead <= obstacleRange(obstacle, view.wind)) return true
  return obstacleOnScreen(camera, view, obstacle)
}

/** 0 a full telegraph range out, 1 at the gate. */
function urgency(view: RenderView, obstacle: Obstacle): number {
  const ahead = obstacle.gateX - view.x
  if (ahead <= 0) return 1
  const range = obstacleRange(obstacle, view.wind)
  return ahead >= range ? 0 : 1 - ahead / range
}

/** A box in world metres, drawn in the rider's own plane. */
function box(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  x: number,
  len: number,
  height: number,
  style: string,
): void {
  const left = screenX(camera, x)
  const width = len * TUNING.WORLD_SCALE
  const tall = height * TUNING.WORLD_SCALE

  ctx.fillStyle = style
  ctx.fillRect(left, camera.waterY - tall, width < MAST_W ? MAST_W : width, tall)
}

/**
 * One object: its body, and the lit line along the top of it.
 *
 * Drawn at WORLD_SCALE in the same plane as the rider, so a 4m mast is 4m of
 * screen against a rider who is the same height they always are — the height
 * the jump has to beat is the height it looks.
 */
function drawBody(ctx: CanvasRenderingContext2D, camera: Camera, obstacle: Obstacle): void {
  box(ctx, camera, obstacle.x, obstacle.len, obstacle.height, PALETTE.hull)

  if (obstacle.mastH > 0) {
    box(ctx, camera, obstacle.mastX, 0, obstacle.mastH, PALETTE.hull)
    // The mast gets its own cap: it is the part of a boat that decides the jump.
    const top = camera.waterY - obstacle.mastH * TUNING.WORLD_SCALE
    ctx.fillStyle = PALETTE.hullTop
    ctx.fillRect(screenX(camera, obstacle.mastX) - MAST_W, top, MAST_W * 3, TOP_H)
  }

  const deck = camera.waterY - obstacle.height * TUNING.WORLD_SCALE
  ctx.fillStyle = PALETTE.hullTop
  ctx.fillRect(screenX(camera, obstacle.x), deck, obstacle.len * TUNING.WORLD_SCALE, TOP_H)
}

/**
 * The edge marker: a chevron pinned inside the right edge for an object that
 * has not reached the frame yet, at the height its top will be.
 *
 * Without it the warning a player gets is however many metres of water the
 * viewport happens to show, which on a phone in landscape is under a second at
 * full speed — far less than the gap the spawn gate reserved.
 */
function drawMarker(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: RenderView,
  obstacle: Obstacle,
  near: number,
): void {
  const top = obstacle.mastH > 0 ? obstacle.mastH : obstacle.height
  const x = view.width - MARK_INSET
  const y = camera.waterY - top * TUNING.WORLD_SCALE - MARK_H

  ctx.globalAlpha = MARK_MIN_ALPHA + (1 - MARK_MIN_ALPHA) * near
  ctx.fillStyle = PALETTE.hullMark
  ctx.beginPath()
  ctx.moveTo(x, y - MARK_H)
  ctx.lineTo(x + MARK_W, y)
  ctx.lineTo(x, y + MARK_H)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
}

/** Draws every obstacle in play, plus the telegraph for the ones still off screen. */
export function drawObstacles(ctx: CanvasRenderingContext2D, camera: Camera, view: RenderView): void {
  const obstacles = view.obstacles
  const right = view.width - MARK_INSET

  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i]
    if (obstacleOnScreen(camera, view, obstacle)) drawBody(ctx, camera, obstacle)
  }

  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i]
    if (!obstacle.active) continue

    // Only what is still ahead is telegraphed: an object already ridden past is
    // a fact rather than a warning, and dressing it up as one would be noise on
    // exactly the frames the next one needs to be read on.
    const ahead = obstacle.gateX - view.x
    if (ahead <= 0 || ahead > obstacleRange(obstacle, view.wind)) continue
    if (screenX(camera, obstacle.x) > right) {
      drawMarker(ctx, camera, view, obstacle, urgency(view, obstacle))
    }
  }
}
