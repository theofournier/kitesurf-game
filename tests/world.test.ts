import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning.ts'
import { WIND_AUTO, windAt } from '../src/sim/world.ts'

describe('windAt', () => {
  it('is flat at tier 1 until the tier curve lands', () => {
    for (const distance of [0, 100, 500, 1500, 3000, 12000]) {
      expect(windAt(distance)).toBe(TUNING.WIND_BASE)
    }
  })

  it('returns the override at every distance', () => {
    for (const distance of [0, 500, 3000]) {
      expect(windAt(distance, 25)).toBe(25)
    }
  })

  it('takes the curve when the override is off', () => {
    expect(windAt(0, WIND_AUTO)).toBe(TUNING.WIND_BASE)
  })

  it('ignores a negative override rather than becalming the run', () => {
    expect(windAt(0, -5)).toBe(TUNING.WIND_BASE)
  })
})
