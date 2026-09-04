// Frame assembly: the order the layers go down in, and nothing else.
import type { Camera } from './camera.ts'
import { drawAltitudeShadow, drawSpray, drawVerdict, type Effects } from './effects.ts'
import { drawGhostMarker, drawKite, drawWindowArc } from './drawKite.ts'
import { drawRider } from './drawRider.ts'
import { drawSky, drawWater } from './layers.ts'
import { drawObstacles } from './drawObstacles.ts'
import { drawWaves } from './drawWaves.ts'
import type { RenderView } from './view.ts'

/**
 * Draws one frame.
 *
 * Back to front: sky, water, the waves standing on it, the lethal furniture
 * standing in front of them, the rider's shadow on the water, then the window arc and its ghost marker — both behind the rider, because
 * they are the surface the kite flies on rather than objects in the scene —
 * then the rider, then the lines and the kite over the top of everything, then
 * the spray.
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
): void {
  ctx.save()
  ctx.translate(fx.shakeX, fx.shakeY)

  // The flats are drawn a shake wider than the frame on every side, so the
  // translate never uncovers a bare edge.
  drawSky(ctx, view.width, camera, fx.shake, view.windTint)
  drawWater(ctx, view.width, view.height, camera, fx.shake, view.windTint)
  drawWaves(ctx, camera, view)
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
