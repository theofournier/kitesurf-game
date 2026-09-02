import { beforeEach, describe, expect, it } from 'vitest'
import { axisFromPoint, createAnchor, type Anchor } from '../../src/input/axis.ts'
import {
  arcSlop,
  createTouchInput,
  loadZoneWidth,
  MIN_TARGET,
  roleAt,
  TOUCH_ROLE,
  type TouchInput,
} from '../../src/input/touch.ts'
import { TUNING } from '../../src/config/tuning.ts'
import { createInput, type RiderInput } from '../../src/sim/loop.ts'
import { createFakeCanvas, pointerEvent, type FakeCanvas } from './fakeDom.ts'

/** A landscape phone, and the rider where the camera puts it on one. */
const WIDTH = 800
const HEIGHT = 400
const ANCHOR_X = 160
const ANCHOR_Y = 258

function landscapeAnchor(facing = 1): Anchor {
  const anchor = createAnchor()
  anchor.x = ANCHOR_X
  anchor.y = ANCHOR_Y
  anchor.facing = facing
  return anchor
}

/** A point on the window arc at `axis`, in canvas CSS pixels. */
function onArc(anchor: Anchor, axis: number, radius = TUNING.LINE_RADIUS): [number, number] {
  const rad = (axis * 90 * Math.PI) / 180
  return [anchor.x + Math.sin(rad) * radius * anchor.facing, anchor.y - Math.cos(rad) * radius]
}

describe('touch targets (spec §5.3)', () => {
  it('never lets the arc band fall under the 44px minimum', () => {
    expect(arcSlop() * 2).toBeGreaterThanOrEqual(MIN_TARGET)
  })

  it('never lets the load zone fall under the 44px minimum', () => {
    expect(loadZoneWidth(WIDTH)).toBeGreaterThanOrEqual(MIN_TARGET)
    expect(loadZoneWidth(60)).toBeGreaterThanOrEqual(MIN_TARGET)
  })

  it('gives the load zone the ahead third of a real screen', () => {
    expect(loadZoneWidth(WIDTH)).toBe(WIDTH * TUNING.TOUCH_LOAD_ZONE)
    expect(loadZoneWidth(WIDTH) / WIDTH).toBeCloseTo(1 / 3, 2)
  })
})

describe('roleAt', () => {
  const anchor = landscapeAnchor()

  it('claims the load anywhere in the third ahead of the rider', () => {
    expect(roleAt(anchor, WIDTH, 600, 40)).toBe(TOUCH_ROLE.LOAD)
    expect(roleAt(anchor, WIDTH, 600, 200)).toBe(TOUCH_ROLE.LOAD)
    expect(roleAt(anchor, WIDTH, 790, 390)).toBe(TOUCH_ROLE.LOAD)
  })

  it('mirrors the load zone when riding left (spec §6.5)', () => {
    const left = landscapeAnchor(-1)
    expect(roleAt(left, WIDTH, 100, 200)).toBe(TOUCH_ROLE.LOAD)
    expect(roleAt(left, WIDTH, 600, 200)).not.toBe(TOUCH_ROLE.LOAD)
  })

  it('claims steering all along the arc, including the part off the top', () => {
    for (let axis = 0; axis <= 1.0001; axis += 0.1) {
      const [x, y] = onArc(anchor, Math.min(axis, 1))
      expect(roleAt(anchor, WIDTH, x, y)).toBe(TOUCH_ROLE.STEER)
    }
  })

  it('has generous slop either side of the drawn line', () => {
    const slop = arcSlop()
    const [nearX, nearY] = onArc(anchor, 0.5, TUNING.LINE_RADIUS - slop + 1)
    const [farX, farY] = onArc(anchor, 0.5, TUNING.LINE_RADIUS + slop - 1)
    expect(roleAt(anchor, WIDTH, nearX, nearY)).toBe(TOUCH_ROLE.STEER)
    expect(roleAt(anchor, WIDTH, farX, farY)).toBe(TOUCH_ROLE.STEER)
  })

  it('claims nothing from a thumb resting on the rider or off past the arc', () => {
    expect(roleAt(anchor, WIDTH, ANCHOR_X, ANCHOR_Y)).toBe(TOUCH_ROLE.NONE)
    const [x, y] = onArc(anchor, 0.5, TUNING.LINE_RADIUS + arcSlop() + 1)
    expect(roleAt(anchor, WIDTH, x, y)).toBe(TOUCH_ROLE.NONE)
  })
})

describe('createTouchInput', () => {
  let canvas: FakeCanvas
  let input: RiderInput
  let adapter: TouchInput
  const anchor = landscapeAnchor()

  beforeEach(() => {
    canvas = createFakeCanvas(WIDTH, HEIGHT)
    input = createInput()
    anchor.x = ANCHOR_X
    anchor.y = ANCHOR_Y
    anchor.facing = 1
    adapter = createTouchInput(canvas, input, anchor)
  })

  function touch(type: string, pointerId: number, x: number, y: number): void {
    canvas.dispatchEvent(
      pointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y }),
    )
  }

  const LOAD_POINT: [number, number] = [700, 300]

  it('steers by absolute angle, the same mapping the mouse uses', () => {
    const [x, y] = onArc(anchor, 0.4)
    touch('pointerdown', 1, x, y)
    expect(input.kiteTarget).toBeCloseTo(0.4, 10)
    expect(input.kiteTarget).toBe(axisFromPoint(anchor, x, y))
  })

  it('follows a drag along the arc', () => {
    let [x, y] = onArc(anchor, 0.9)
    touch('pointerdown', 1, x, y)
    for (const axis of [0.7, 0.5, 0.25, 0]) {
      ;[x, y] = onArc(anchor, axis)
      touch('pointermove', 1, x, y)
      expect(input.kiteTarget).toBeCloseTo(axis, 10)
    }
  })

  it('holds the last angle when the thumb lifts', () => {
    const [x, y] = onArc(anchor, 0.6)
    touch('pointerdown', 1, x, y)
    const held = input.kiteTarget
    touch('pointerup', 1, x, y)
    touch('pointermove', 1, ...onArc(anchor, 0))
    expect(input.kiteTarget).toBe(held)
  })

  it('sets loading from a hold anywhere in the right third, and pops on release', () => {
    touch('pointerdown', 2, ...LOAD_POINT)
    expect(input.loading).toBe(true)
    touch('pointermove', 2, 780, 60)
    expect(input.loading).toBe(true)
    touch('pointerup', 2, 780, 60)
    expect(input.loading).toBe(false)
  })

  it('tracks two thumbs independently', () => {
    const [steerX, steerY] = onArc(anchor, 0.8)
    touch('pointerdown', 1, steerX, steerY)
    touch('pointerdown', 2, ...LOAD_POINT)
    expect(input.loading).toBe(true)

    // The send: the left thumb sweeps to zenith while the right one still holds.
    const [zenithX, zenithY] = onArc(anchor, 0)
    touch('pointermove', 1, zenithX, zenithY)
    expect(input.kiteTarget).toBeCloseTo(0, 10)
    expect(input.loading).toBe(true)

    // The pop: the right thumb lifts and the steering is untouched.
    touch('pointerup', 2, ...LOAD_POINT)
    expect(input.loading).toBe(false)
    expect(input.kiteTarget).toBeCloseTo(0, 10)
  })

  it('does not let the load thumb move the kite, or the steering thumb load', () => {
    touch('pointerdown', 2, ...LOAD_POINT)
    touch('pointermove', 2, ...onArc(anchor, 0))
    expect(input.kiteTarget).toBe(0)

    const [x, y] = onArc(anchor, 0.5)
    touch('pointerdown', 1, x, y)
    touch('pointerup', 2, ...LOAD_POINT)
    expect(input.loading).toBe(false)
    expect(input.kiteTarget).toBeCloseTo(0.5, 10)
  })

  it('ignores a third finger rather than letting it steal a filled role', () => {
    const [x, y] = onArc(anchor, 0.5)
    touch('pointerdown', 1, x, y)
    touch('pointerdown', 3, ...onArc(anchor, 0))
    expect(input.kiteTarget).toBeCloseTo(0.5, 10)

    touch('pointerdown', 2, ...LOAD_POINT)
    touch('pointerdown', 4, 750, 100)
    touch('pointerup', 4, 750, 100)
    expect(input.loading).toBe(true)
  })

  it('follows a claimed thumb outside the band it was claimed in', () => {
    const [x, y] = onArc(anchor, 0.5)
    touch('pointerdown', 1, x, y)
    // Well inside the inner edge of the band, and in the load third — neither
    // matters once the thumb is ours.
    touch('pointermove', 1, 600, 250)
    expect(input.kiteTarget).toBe(axisFromPoint(anchor, 600, 250))
    expect(input.loading).toBe(false)
  })

  it('captures each claimed thumb so a lift off the element still arrives', () => {
    touch('pointerdown', 1, ...onArc(anchor, 0.5))
    touch('pointerdown', 2, ...LOAD_POINT)
    expect(canvas.captured).toEqual([1, 2])
  })

  it('claims nothing from a thumb that lands on neither target', () => {
    touch('pointerdown', 1, ANCHOR_X, ANCHOR_Y)
    touch('pointermove', 1, ...onArc(anchor, 1))
    expect(input.kiteTarget).toBe(0)
    expect(input.loading).toBe(false)
    expect(canvas.captured).toEqual([])
  })

  it('leaves mouse pointers to the desktop adapter', () => {
    const [x, y] = onArc(anchor, 0.5)
    canvas.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y }),
    )
    expect(input.kiteTarget).toBe(0)
  })

  it('drops a cancelled load rather than leaving the rider edging forever', () => {
    touch('pointerdown', 2, ...LOAD_POINT)
    touch('pointercancel', 2, ...LOAD_POINT)
    expect(input.loading).toBe(false)
  })

  it('stops listening once disposed, and lets go of the load', () => {
    touch('pointerdown', 1, ...onArc(anchor, 0.5))
    touch('pointerdown', 2, ...LOAD_POINT)
    const held = input.kiteTarget
    adapter.dispose()
    touch('pointermove', 1, ...onArc(anchor, 0))
    expect(input.loading).toBe(false)
    expect(input.kiteTarget).toBe(held)
  })
})
