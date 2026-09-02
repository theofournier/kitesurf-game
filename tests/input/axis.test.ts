import { describe, expect, it } from 'vitest'
import { axisFromOffset, axisFromPoint, createAnchor } from '../../src/input/axis.ts'

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

describe('axisFromPoint', () => {
  const anchor = { x: 160, y: 258, facing: 1 }

  it('flips the screen y axis, which points down', () => {
    expect(axisFromPoint(anchor, 160, 58)).toBe(0) // 200px above the rider is zenith
    expect(axisFromPoint(anchor, 260, 158)).toBeCloseTo(0.5, 12) // up and ahead
    expect(axisFromPoint(anchor, 60, 158)).toBe(0) // up and behind, clamped
  })

  it('puts the window edge straight ahead of the rider', () => {
    expect(axisFromPoint(anchor, 460, 258)).toBe(1)
  })

  it('mirrors with the frame when riding left (spec §6.5)', () => {
    const left = { x: 160, y: 258, facing: -1 }
    expect(axisFromPoint(left, 160 - 300, 258)).toBe(1)
    expect(axisFromPoint(left, 160 + 300, 258)).toBe(0)
    expect(axisFromPoint(left, 160 - 200, 58)).toBeCloseTo(axisFromPoint(anchor, 360, 58), 12)
  })

  it('starts a fresh anchor riding right at the origin', () => {
    expect(createAnchor()).toEqual({ x: 0, y: 0, facing: 1 })
  })
})
