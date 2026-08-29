import { describe, expect, it } from 'vitest'
import { axisFromOffset } from '../../src/input/desktop.ts'

describe('axisFromOffset', () => {
  it('maps straight up to zenith and straight ahead to the window edge', () => {
    expect(axisFromOffset(0, 100)).toBe(0)
    expect(axisFromOffset(100, 0)).toBe(1)
  })

  it('is an absolute mapping: the pointer angle is the kite position', () => {
    expect(axisFromOffset(100, 100)).toBeCloseTo(0.5, 10)
    expect(axisFromOffset(1, Math.sqrt(3))).toBeCloseTo(30 / 90, 10)
  })

  it('ignores distance, because the kite orbits at a fixed radius', () => {
    expect(axisFromOffset(5, 5)).toBeCloseTo(axisFromOffset(5000, 5000), 10)
  })

  it('clamps to the nearest endpoint outside the quarter', () => {
    expect(axisFromOffset(-200, 100)).toBe(0) // behind the rider
    expect(axisFromOffset(-200, -100)).toBe(0) // behind and below
    expect(axisFromOffset(200, -100)).toBe(1) // ahead, below the waterline
  })

  it('holds the axis inside 0..1 for any offset', () => {
    for (let dx = -300; dx <= 300; dx += 17) {
      for (let dy = -300; dy <= 300; dy += 17) {
        const axis = axisFromOffset(dx, dy)
        expect(axis).toBeGreaterThanOrEqual(0)
        expect(axis).toBeLessThanOrEqual(1)
      }
    }
  })
})
