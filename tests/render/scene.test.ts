import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { createCamera, updateCamera } from '../../src/render/camera.ts'
import { drawScene } from '../../src/render/scene.ts'
import { createView } from '../../src/render/view.ts'

const W = 1200
const H = 800

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Records the fills of one frame — enough to see whether the water moves. */
function frameAt(riderX: number) {
  const rects: Rect[] = []
  const noop = () => {}
  const ctx = {
    fillRect: (x: number, y: number, w: number, h: number) => void rects.push({ x, y, w, h }),
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    beginPath: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D

  const camera = createCamera()
  updateCamera(camera, W, H, riderX, 0, 1)

  const view = createView()
  view.width = W
  view.height = H
  view.x = riderX
  view.wind = TUNING.WIND_BASE

  drawScene(ctx, camera, view)
  return { rects, camera }
}

describe('drawScene', () => {
  it('paints sky and water across the whole frame', () => {
    const { rects, camera } = frameAt(0)
    const bands = rects.filter((r) => r.x === 0 && r.w === W)

    expect(bands.some((r) => r.y === 0 && r.h === camera.horizonY)).toBe(true)
    expect(bands.some((r) => r.y === camera.waterY && r.h === H - camera.waterY)).toBe(true)
  })

  it('draws the rider at the anchor, standing on the waterline', () => {
    // Everything else in the frame is positioned relative to these two, so
    // this is the assembly test: the layers agree on where the rider is.
    const { rects, camera } = frameAt(42)
    const rider = rects.find((r) => r.h === TUNING.RIDER_H)!

    expect(rider.x + rider.w * 0.5).toBeCloseTo(camera.anchorX, 6)
    expect(rider.y + rider.h).toBeCloseTo(camera.waterY, 6)
  })
})
