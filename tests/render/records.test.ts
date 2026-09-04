// The records as world objects (spec §8.4): a buoy at the distance PB, a line
// in the sky at the jump PB, both visible during play, and a break that flashes
// and lets the run carry on.
import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { createCamera, updateCamera } from '../../src/render/camera.ts'
import {
  createRecordMarks,
  drawRecords,
  RECORD_FLASH_TIME,
  resetRecordMarks,
  updateRecordMarks,
} from '../../src/render/records.ts'
import { createView } from '../../src/render/view.ts'

const W = 1200
const H = 800

interface Rect {
  x: number
  y: number
  w: number
  h: number
  style: string
}

interface Arc {
  x: number
  y: number
  r: number
  style: string
}

/** Records what one pass of the markers lays down. */
function draw(marks: ReturnType<typeof createRecordMarks>, riderX: number, altitude = 0) {
  const rects: Rect[] = []
  const arcs: Arc[] = []
  const noop = () => {}
  const ctx = {
    fillRect: (x: number, y: number, w: number, h: number) =>
      void rects.push({ x, y, w, h, style: ctx.fillStyle }),
    arc: (x: number, y: number, r: number) => void arcs.push({ x, y, r, style: ctx.fillStyle }),
    beginPath: noop,
    fill: noop,
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D & { fillStyle: string }

  const camera = createCamera()
  updateCamera(camera, W, H, riderX, altitude, 1)

  const view = createView()
  view.width = W
  view.height = H
  view.x = riderX
  view.altitude = altitude

  drawRecords(ctx, camera, view, marks)
  return { rects, arcs, camera }
}

/** Marks with both records set, at the start of a run. */
function marksAt(distance: number, jump: number) {
  return resetRecordMarks(createRecordMarks(), { score: 0, jump, distance })
}

describe('the distance marker (spec §8.4)', () => {
  it('stands in the water at the personal best, and is watched past', () => {
    const marks = marksAt(400, 0)

    // Approaching: ahead of the rider, so right of the anchor on screen.
    const ahead = draw(marks, 380)
    expect(ahead.arcs.length).toBe(1)
    expect(ahead.arcs[0].x).toBeGreaterThan(ahead.camera.anchorX)

    // Alongside: exactly at the anchor, because that is where the rider is.
    const beside = draw(marks, 400)
    expect(beside.arcs[0].x).toBeCloseTo(beside.camera.anchorX, 6)

    // Past: behind the rider, and still drawn, receding out of the frame.
    const behind = draw(marks, 405)
    expect(behind.arcs[0].x).toBeLessThan(behind.camera.anchorX)
    expect(draw(marks, 460).arcs).toEqual([])
  })

  it('stands on the water, not floating over it', () => {
    const { rects, camera } = draw(marksAt(400, 0), 400)
    const pole = rects[rects.length - 1]

    expect(pole.y + pole.h).toBeCloseTo(camera.waterY, 6)
  })

  it('is not drawn for a player who has no distance record yet', () => {
    const { rects, arcs } = draw(marksAt(0, 0), 400)
    expect(rects).toEqual([])
    expect(arcs).toEqual([])
  })
})

describe('the jump line (spec §8.4)', () => {
  it('hangs level across the frame at the height of the record', () => {
    const { rects, camera } = draw(marksAt(0, 6), 0)
    const y = camera.waterY - 6 * TUNING.WORLD_SCALE

    expect(rects.length).toBeGreaterThan(1)
    // One height, all the way across: it is an altitude, not a place, which is
    // what makes it readable from inside a jump that is still rising.
    for (const dash of rects) expect(dash.y + dash.h * 0.5).toBeCloseTo(y, 6)
    // The dash pattern runs edge to edge: one starts at or before the left of
    // the frame, and the last one is within a single period of the right — a
    // dashed line can end in a gap, but never in a stretch of nothing.
    const starts = rects.map((r) => r.x)
    const period = starts[1] - starts[0]
    expect(Math.min(...starts)).toBeLessThanOrEqual(0)
    expect(Math.max(...starts)).toBeGreaterThan(W - period)
  })

  it('rises up the frame as the rider climbs toward it', () => {
    const ground = draw(marksAt(0, 6), 0)
    const air = draw(marksAt(0, 6), 0, 4)

    // The camera follows altitude at CAM_ALT_FOLLOW, so a line at a fixed
    // height comes *down* the screen toward a rider who is coming up to it.
    expect(air.rects[0].y).toBeGreaterThan(ground.rects[0].y)
  })

  it('is not drawn for a player who has no jump record yet', () => {
    expect(draw(marksAt(0, 0), 0).rects).toEqual([])
  })

  it('is dropped once it is off the frame entirely', () => {
    // A 400m record would put the line kilometres above the sky. Drawing it is
    // pointless; the guard is what keeps a huge PB off the fill rate.
    expect(draw(marksAt(0, 400), 0).rects).toEqual([])
  })
})

describe('breaking a record', () => {
  it('flashes when the distance goes past, and the run continues', () => {
    const marks = marksAt(400, 0)
    const view = createView()

    view.x = 399
    updateRecordMarks(marks, view, 1 / 60)
    expect(marks.passedDistance).toBe(false)
    expect(marks.distanceFlash).toBe(0)

    view.x = 401
    updateRecordMarks(marks, view, 1 / 60)
    expect(marks.passedDistance).toBe(true)
    expect(marks.distanceFlash).toBeGreaterThan(0)
  })

  it('flashes when an air crosses the line', () => {
    const marks = marksAt(0, 6)
    const view = createView()

    view.altitude = 5.9
    updateRecordMarks(marks, view, 1 / 60)
    expect(marks.jumpFlash).toBe(0)

    view.altitude = 6.1
    updateRecordMarks(marks, view, 1 / 60)
    expect(marks.jumpFlash).toBeGreaterThan(0)
  })

  it('fires once and burns out, rather than flashing again on the way back', () => {
    const marks = marksAt(0, 6)
    const view = createView()

    view.altitude = 7
    updateRecordMarks(marks, view, 1 / 60)
    view.altitude = 0
    for (let i = 0; i < 6; i++) updateRecordMarks(marks, view, 1 / 60)
    view.altitude = 7
    updateRecordMarks(marks, view, 1 / 60)

    // Still counting down from the one break, not restarted by the second pass.
    expect(marks.jumpFlash).toBeLessThan(RECORD_FLASH_TIME)
    expect(marks.jumpFlash).toBeGreaterThan(0)
  })

  it('decays to nothing and leaves the marker standing, dimmed', () => {
    const marks = marksAt(400, 0)
    const view = createView()
    view.x = 401

    updateRecordMarks(marks, view, 1 / 60)
    const flashing = draw(marks, 401).arcs[0]

    updateRecordMarks(marks, view, RECORD_FLASH_TIME)
    expect(marks.distanceFlash).toBe(0)
    const spent = draw(marks, 401).arcs[0]

    // Brighter and bigger while it breaks, still there afterwards — the run is
    // never interrupted, and the marker becomes a fact rather than a target.
    expect(flashing.r).toBeGreaterThan(spent.r)
    expect(flashing.style).not.toBe(spent.style)
    expect(spent.r).toBeGreaterThan(0)
  })
})
