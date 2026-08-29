import { describe, expect, it } from 'vitest'
import { Rng } from '../src/sim/rng.ts'

describe('Rng', () => {
  it('produces identical 1000-value sequences from the same seed', () => {
    const a = new Rng(12345)
    const b = new Rng(12345)

    const seqA: number[] = []
    const seqB: number[] = []
    for (let i = 0; i < 1000; i++) {
      seqA.push(a.next())
      seqB.push(b.next())
    }

    expect(seqA).toEqual(seqB)
  })

  it('stays inside [0, 1)', () => {
    const rng = new Rng(12345)
    for (let i = 0; i < 1000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('produces different sequences from different seeds', () => {
    const a = new Rng(12345)
    const b = new Rng(54321)
    const seqA = Array.from({ length: 1000 }, () => a.next())
    const seqB = Array.from({ length: 1000 }, () => b.next())

    expect(seqA).not.toEqual(seqB)
  })
})
