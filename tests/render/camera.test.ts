import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { createCamera, damping, screenX, updateCamera } from '../../src/render/camera.ts'

const W = 1200
const H = 800
const FRAME = 1 / 60

/** Runs the camera to rest at a fixed rider altitude. */
function settle(altitude: number, riderX = 0, seconds = 3, height = H) {
  const camera = createCamera()
  const frames = Math.round(seconds / FRAME)
  for (let i = 0; i < frames; i++) {
    updateCamera(camera, W, height, riderX, altitude, FRAME)
  }
  return camera
}

/** A landscape phone, which is the viewport the framing has to survive. */
const PHONE_H = 400

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

  it('lets the kite leave the top of the frame at the apex of a big air', () => {
    // Spec §6.4: at the peak of a big air the kite exits the frame — let it,
    // and draw the lines running off after it. Nothing may clamp it back in,
    // so the test is that the top of the window arc goes above the frame while
    // the rider is still comfortably inside it.
    const air = settle(16, 0, 3, PHONE_H)
    expect(air.harnessY - TUNING.LINE_RADIUS).toBeLessThan(0)

    expect(air.feetY).toBeGreaterThan(0)
    expect(air.feetY).toBeLessThan(PHONE_H)
  })

  it('keeps climbing with altitude rather than topping out', () => {
    // A clamp anywhere in the follow would flatten the read exactly where the
    // height matters most, so the response stays linear all the way up.
    const four = settle(4)
    const twelve = settle(12)
    const twenty = settle(20)

    expect(four.feetY - twelve.feetY).toBeGreaterThan(0)
    expect(twelve.feetY - twenty.feetY).toBeCloseTo(four.feetY - twelve.feetY, 1)
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
