// Frame assembly: the order the layers go down in, and nothing else.
import type { Camera } from './camera.ts'
import { drawAltitudeShadow, drawSpray, drawVerdict, type Effects } from './effects.ts'
import { drawGhostMarker, drawKite, drawWindowArc } from './drawKite.ts'
import { drawRider } from './drawRider.ts'
import { drawSky, drawWater } from './layers.ts'
import { drawObstacles } from './drawObstacles.ts'
import { drawRecords, type RecordMarks } from './records.ts'
import { drawWaves } from './drawWaves.ts'
import type { RenderView } from './view.ts'

/**
 * Draws one frame.
 *
 * Back to front: sky, water, the waves standing on it, the records hanging over
 * both, the lethal furniture in front of them, the rider's shadow on the water,
 * then the window arc and its ghost marker — both behind the rider, because
 * they are the surface the kite flies on rather than objects in the scene —
 * then the rider, then the lines and the kite over the top of everything, then
 * the spray.
 *
 * The record markers go under the obstacles rather than over them. They are the
 * one thing in the water that cannot end a run (spec §8.4), so nothing they
 * draw is ever allowed to sit in front of something that can.
 *
 * Riding left is a horizontal mirror of the finished frame and nothing else
 * (spec §6.5) — one transform around the whole world, never a second set of
 * signs threaded through the drawing. Everything downstream is written as if
 * riding right, which is why the edge markers, the load zone and the parallax
 * all mirror for free and cannot disagree about which way "ahead" is. Only the
 * verdict word sits outside it, because text in a mirror is text backwards.
 *
 * The whole world is drawn inside the landing shake; only the verdict wash and
 * word sit outside it, so the one thing the player has to read is the one thing
 * that is not moving. Nothing clamps the kite into the frame: at the apex of a
 * big air it leaves the top of the screen with its lines running off after it,
 * and that is what the height is supposed to look like (spec §6.4).
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: RenderView,
  fx: Effects,
  marks: RecordMarks | null = null,
): void {
  ctx.save()
  if (view.facing < 0) {
    ctx.translate(view.width, 0)
    ctx.scale(-1, 1)
  }
  ctx.translate(fx.shakeX, fx.shakeY)

  // The flats are drawn a shake wider than the frame on every side, so the
  // translate never uncovers a bare edge.
  drawSky(ctx, view.width, camera, fx.shake, view.windTint)
  drawWater(ctx, view.width, view.height, camera, fx.shake, view.windTint)
  drawWaves(ctx, camera, view)
  if (marks !== null) drawRecords(ctx, camera, view, marks)
  drawObstacles(ctx, camera, view)
  drawAltitudeShadow(ctx, camera, view)

  drawWindowArc(ctx, camera)
  drawGhostMarker(ctx, camera, view)

  drawRider(ctx, camera, view)
  drawKite(ctx, camera, view)
  drawSpray(ctx, fx)

  ctx.restore()

  drawVerdict(ctx, camera, view, fx)
}
