import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { createCamera, updateCamera } from '../../src/render/camera.ts'
import { drawWater } from '../../src/render/layers.ts'

const W = 1200
const H = 800

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Records the rectangles one water pass lays down. */
function water(riderX: number) {
  const rects: Rect[] = []
  const ctx = {
    fillRect: (x: number, y: number, w: number, h: number) => void rects.push({ x, y, w, h }),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D

  const camera = createCamera()
  updateCamera(camera, W, H, riderX, 0, 1)
  drawWater(ctx, W, H, camera)

  return { rects, camera }
}

/** The scrolling streaks, grouped into rows by screen height, top row first. */
function rows(rects: Rect[]): Map<number, Rect[]> {
  const grouped = new Map<number, Rect[]>()
  for (const rect of rects) {
    if (rect.w >= W) continue // a full-width fill is a band, not a streak
    const row = grouped.get(rect.y) ?? []
    row.push(rect)
    grouped.set(rect.y, row)
  }
  return new Map([...grouped].sort((a, b) => a[0] - b[0]))
}

/**
 * How far a row scrolled between two frames, measured against the pattern's
 * own spacing — a streak that has wrapped off the edge would otherwise read as
 * a jump the other way.
 */
function shift(before: Rect[], after: Rect[]): number {
  const spacing = TUNING.WATER_BAND_M * TUNING.WORLD_SCALE
  return (((before[0].x - after[0].x) % spacing) + spacing) % spacing
}

describe('drawWater', () => {
  it('fills the sea from the horizon to the bottom of the frame', () => {
    const { rects, camera } = water(0)
    const bands = rects.filter((r) => r.x === 0 && r.w === W)

    expect(bands.some((r) => r.y === camera.horizonY)).toBe(true)
    expect(bands.some((r) => r.y === camera.waterY && r.h === H - camera.waterY)).toBe(true)
  })

  it('scrolls every band as the rider covers ground', () => {
    // The rider is pinned on screen, so the texture moving is the only thing
    // conveying speed at all (spec §6.4).
    const before = rows(water(0).rects)
    const after = rows(water(1).rects)

    expect(before.size).toBeGreaterThan(0)
    for (const [y, row] of before) {
      expect(shift(row, after.get(y)!)).toBeGreaterThan(0)
    }
  })

  it('scrolls near water faster than far water, at the parallax factors', () => {
    const metre = 1
    const before = [...rows(water(0).rects).values()]
    const after = [...rows(water(metre).rects).values()]

    const shifts = before.map((row, i) => shift(row, after[i]))
    const perMetre = TUNING.WORLD_SCALE * metre

    expect(shifts[0]).toBeCloseTo(TUNING.PARALLAX_FAR * perMetre, 6)
    expect(shifts.at(-1)).toBeCloseTo(TUNING.PARALLAX_NEAR * perMetre, 6)

    for (let i = 1; i < shifts.length; i++) {
      expect(shifts[i]).toBeGreaterThanOrEqual(shifts[i - 1])
    }
  })

  it('holds the pattern across both edges, however far the run has gone', () => {
    const spacing = TUNING.WATER_BAND_M * TUNING.WORLD_SCALE

    for (const riderX of [0, 0.7, 13.3, 5000]) {
      for (const row of rows(water(riderX).rects).values()) {
        // The streaks are a repeating pattern, so what matters is that it runs
        // off both edges: no phase may leave a gap wider than its own spacing
        // where the frame ends. The row is drawn while `x < width`, so the last
        // streak starts within one spacing of the right edge — and lands on it
        // exactly when the phase is zero, which is a covered frame and not a
        // bare one.
        const xs = row.map((r) => r.x)
        expect(Math.min(...xs)).toBeLessThanOrEqual(0)
        expect(Math.max(...xs)).toBeGreaterThanOrEqual(W - spacing)
      }
    }
  })
})
