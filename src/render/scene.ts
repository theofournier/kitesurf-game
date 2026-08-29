// Frame assembly: the order the layers go down in, and nothing else.
import type { Camera } from './camera.ts'
import { drawGhostMarker, drawKite, drawWindowArc } from './drawKite.ts'
import { drawRider } from './drawRider.ts'
import { drawSky, drawWater } from './layers.ts'
import type { RenderView } from './view.ts'

/**
 * Draws one frame.
 *
 * Back to front: sky, water, then the window arc and its ghost marker — both
 * behind the rider, because they are the surface the kite flies on rather than
 * objects in the scene — then the rider, then the lines and the kite over the
 * top of everything.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: RenderView,
): void {
  drawSky(ctx, view.width, camera)
  drawWater(ctx, view.width, view.height, camera)

  drawWindowArc(ctx, camera)
  drawGhostMarker(ctx, camera, view)

  drawRider(ctx, camera)
  drawKite(ctx, camera, view)
}
