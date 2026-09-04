// The records, standing in the world (spec §8.4).
//
// The spec is specific about this and it is the whole design of the feature:
// the distance PB and the jump PB are *not* HUD numbers. A number in the corner
// is something you check between runs. A buoy on the horizon is something you
// watch approach, and a line in the sky is something you can see you are going
// to clear while you are still rising — the records become part of the water
// rather than part of the readout, and beating one is a thing that happens in
// front of you rather than a figure that changes.
//
// So neither marker carries any text at all. If a player has to read a label to
// know what the line is, the line has failed at the one job it has.
//
// Breaking one flashes and the run continues (§8.4). There is no pause, no
// banner and no interruption: the marker lights up as it goes past and then
// stays there, dimmed, as the fact it now is.
//
// Colour and geometry live here rather than in TUNING for the same reason
// palette.ts gives — nothing in this file changes what the sim does or how the
// game plays. Everything is drawn straight out of a preallocated struct, so a
// frame allocates nothing.
import { TUNING } from '../config/tuning.ts'
import { screenX, type Camera } from './camera.ts'
import { PALETTE } from './palette.ts'
import type { Records } from '../platform/storage.ts'
import type { RenderView } from './view.ts'

/**
 * Seconds a broken record flashes for. Shorter than a tier banner and about as
 * long as a landing verdict: it is an event, not an announcement, and the run
 * is still going on around it.
 */
export const RECORD_FLASH_TIME = 1.1

/** The distance marker: a thin pole with a ball on it, standing in the water. */
const MARKER_H_M = 2.2
const POLE_W = 3
const BALL_R = 7
/** How much wider the flash draws the marker at its brightest. */
const FLASH_GROW = 2.4

/**
 * The jump line, dashed by repetition rather than by `setLineDash` — the dash
 * pattern that API takes is an array, and an array per frame is an allocation
 * on the render path.
 */
const DASH = 20
const DASH_GAP = 16
const LINE_H = 2
/** How far off the top of the frame the line is still worth drawing, px. */
const LINE_MARGIN = 40

/**
 * The two PBs of spec §8.4 as the world sees them, plus the state of each one's
 * flash.
 *
 * The values are a snapshot taken when the run starts and they do not move
 * during it. That is deliberate: the marker is the line to beat, and a line
 * that crept upward as the run improved on it would be a line nobody could ever
 * pass. What this run does about them is settled after it ends.
 */
export interface RecordMarks {
  /** Distance PB, m. 0 for a player who has none yet — nothing is drawn. */
  distance: number
  /** Jump PB, m, on the same terms. */
  jump: number
  /** Seconds left of each marker's break flash. */
  distanceFlash: number
  jumpFlash: number
  /** Whether this run has already gone past each one. */
  passedDistance: boolean
  passedJump: boolean
}

export function createRecordMarks(): RecordMarks {
  return resetRecordMarks({} as RecordMarks, null)
}

/**
 * Points the markers at `records` and clears every flash, in place — the
 * restart of spec §10. A null `records` is a run with nothing to beat.
 */
export function resetRecordMarks(marks: RecordMarks, records: Records | null): RecordMarks {
  marks.distance = records === null ? 0 : records.distance
  marks.jump = records === null ? 0 : records.jump
  marks.distanceFlash = 0
  marks.jumpFlash = 0
  marks.passedDistance = false
  marks.passedJump = false
  return marks
}

/**
 * Fires each marker's flash the moment the run passes it, and decays the ones
 * already burning.
 *
 * The two are broken by different things, and the difference is the spec's.
 * Distance is passed and never given back, so the buoy going by *is* the record
 * falling. Height is not: §8.4 counts a jump only if it was landed, so this
 * fires on the altitude crossing the line — the moment the player can see it
 * happen, and the moment the drama is in — while whether it counted is settled
 * at the touchdown by `score.bestJump`, which is what the run is measured on
 * when it ends. An air that clears the line and then wipes out lit it up on the
 * way past and did not beat it, which is exactly what it felt like.
 *
 * `dt` is real frame time. None of this is physics.
 */
export function updateRecordMarks(marks: RecordMarks, view: RenderView, dt: number): void {
  if (marks.distance > 0 && !marks.passedDistance && view.x >= marks.distance) {
    marks.passedDistance = true
    marks.distanceFlash = RECORD_FLASH_TIME
  }

  if (marks.jump > 0 && !marks.passedJump && view.altitude >= marks.jump) {
    marks.passedJump = true
    marks.jumpFlash = RECORD_FLASH_TIME
  }

  if (marks.distanceFlash > 0) {
    marks.distanceFlash -= dt
    if (marks.distanceFlash < 0) marks.distanceFlash = 0
  }

  if (marks.jumpFlash > 0) {
    marks.jumpFlash -= dt
    if (marks.jumpFlash < 0) marks.jumpFlash = 0
  }
}

/** 0 with no flash running, 1 at the instant one fires. */
function fade(flash: number): number {
  return flash > 0 ? flash / RECORD_FLASH_TIME : 0
}

/**
 * What a marker is drawn in: white while it is breaking, its own pale blue
 * before that, and dimmed once it is behind the run.
 */
function markColor(flash: number, passed: boolean): string {
  if (flash > 0) return PALETTE.recordFlash
  return passed ? PALETTE.recordDim : PALETTE.record
}

/**
 * The distance PB: a marker buoy in the water at that distance (spec §8.4).
 *
 * Deliberately unlike the lethal furniture beside it. A thin pole and a ball,
 * in the cold pale blue of the HUD's own accents rather than the warm solid
 * bodies of drawObstacles.ts, because the one read a player must never get
 * wrong at speed is which silhouettes end the run. This one is only a line on
 * the water.
 */
function drawDistanceMarker(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: RenderView,
  marks: RecordMarks,
): void {
  if (!(marks.distance > 0)) return

  const x = screenX(camera, marks.distance)
  if (x < -BALL_R * FLASH_GROW || x > view.width + BALL_R * FLASH_GROW) return

  const burn = fade(marks.distanceFlash)
  const grow = 1 + (FLASH_GROW - 1) * burn
  const tall = MARKER_H_M * TUNING.WORLD_SCALE
  const top = camera.waterY - tall

  ctx.fillStyle = markColor(marks.distanceFlash, marks.passedDistance)
  ctx.fillRect(x - POLE_W * 0.5, top, POLE_W, tall)

  ctx.beginPath()
  ctx.arc(x, top, BALL_R * grow, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * The jump PB: a thin horizontal line in the sky at that height (spec §8.4).
 *
 * Full width and level, because it is an altitude and not a place — it is over
 * every metre of water the rider could take off from, which is what makes it
 * readable from inside a jump that has not finished rising yet.
 */
function drawJumpLine(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: RenderView,
  marks: RecordMarks,
): void {
  if (!(marks.jump > 0)) return

  const y = camera.waterY - marks.jump * TUNING.WORLD_SCALE
  if (y < -LINE_MARGIN || y > view.height + LINE_MARGIN) return

  const burn = fade(marks.jumpFlash)
  const thick = LINE_H * (1 + (FLASH_GROW - 1) * burn)

  ctx.fillStyle = markColor(marks.jumpFlash, marks.passedJump)
  // Phased with the camera so the dashes travel with the water rather than
  // crawling against it, which would read as a screen overlay instead of a
  // thing hanging in the world.
  const span = DASH + DASH_GAP
  const scrolled = camera.x * TUNING.WORLD_SCALE
  const phase = ((-scrolled % span) + span) % span

  for (let x = phase - span; x < view.width; x += span) {
    ctx.fillRect(x, y - thick * 0.5, DASH, thick)
  }
}

/** Both markers, in the world, under everything that can end the run. */
export function drawRecords(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: RenderView,
  marks: RecordMarks,
): void {
  drawJumpLine(ctx, camera, view, marks)
  drawDistanceMarker(ctx, camera, view, marks)
}
