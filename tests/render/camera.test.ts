import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { createCamera, damping, screenX, updateCamera } from '../../src/render/camera.ts'

const W = 1200
const H = 800
const FRAME = 1 / 60

/** Runs the camera to rest at a fixed rider altitude. */
function settle(altitude: number, riderX = 0, seconds = 3) {
  const camera = createCamera()
  const frames = Math.round(seconds / FRAME)
  for (let i = 0; i < frames; i++) {
    updateCamera(camera, W, H, riderX, altitude, FRAME)
  }
  return camera
}

describe('updateCamera', () => {
  it('anchors the rider at ANCHOR_X of the width', () => {
    const camera = settle(0, 137)
    expect(camera.anchorX).toBeCloseTo(W * TUNING.ANCHOR_X, 10)
    expect(screenX(camera, 137)).toBeCloseTo(camera.anchorX, 10)
  })

  it('scrolls the world past a rider who never moves on screen', () => {
    const near = settle(0, 100)
    const far = settle(0, 400)

    expect(far.anchorX).toBeCloseTo(near.anchorX, 10)
    expect(far.x - near.x).toBeCloseTo(300, 10)
  })

  it('follows altitude at CAM_ALT_FOLLOW, so the rider rises in frame', () => {
    const ground = settle(0)
    const air = settle(10)

    expect(air.alt).toBeCloseTo(10 * TUNING.CAM_ALT_FOLLOW, 2)

    // The rider climbs the leftover fraction of the altitude, the water recedes
    // by the camera's own share, and between them they account for all of it.
    const climbed = (ground.feetY - air.feetY) / TUNING.WORLD_SCALE
    const receded = (air.waterY - ground.waterY) / TUNING.WORLD_SCALE
    expect(climbed).toBeCloseTo(10 * (1 - TUNING.CAM_ALT_FOLLOW), 2)
    expect(receded).toBeCloseTo(10 * TUNING.CAM_ALT_FOLLOW, 2)
    expect(climbed + receded).toBeCloseTo(10, 2)
  })

  it('keeps the horizon fixed as the reference the altitude reads against', () => {
    expect(settle(18).horizonY).toBe(settle(0).horizonY)
  })

  it('damps rather than snapping to the altitude target', () => {
    const camera = createCamera()
    updateCamera(camera, W, H, 0, 10, FRAME)

    expect(camera.alt).toBeGreaterThan(0)
    expect(camera.alt).toBeLessThan(10 * TUNING.CAM_ALT_FOLLOW)
  })

  it('hangs the harness on the rider, below the top of the box', () => {
    const camera = settle(0)
    expect(camera.harnessY).toBeGreaterThan(camera.feetY - TUNING.RIDER_H)
    expect(camera.harnessY).toBeLessThan(camera.feetY)
  })
})

describe('damping', () => {
  it('closes the same fraction of the gap per second at any frame rate', () => {
    // Two frame rates, one second of real time: the whole point of the
    // exponential form is that these agree.
    let slow = 0
    for (let i = 0; i < 30; i++) slow += (1 - slow) * damping(4, 1 / 30)

    let fast = 0
    for (let i = 0; i < 240; i++) fast += (1 - fast) * damping(4, 1 / 240)

    expect(slow).toBeCloseTo(fast, 6)
  })

  it('never overshoots, however long the frame', () => {
    expect(damping(8, 10)).toBeLessThanOrEqual(1)
    expect(damping(8, 0)).toBe(0)
  })
})
