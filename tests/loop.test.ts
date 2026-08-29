import { describe, expect, it } from 'vitest'
import {
  DT,
  advance,
  createAccumulator,
  createInput,
  createSimState,
  step,
} from '../src/sim/loop.ts'

describe('step', () => {
  it('advances the tick counter to exactly 100 over 100 calls at dt = 1/60', () => {
    const state = createSimState()
    const input = createInput()

    for (let i = 0; i < 100; i++) {
      step(state, input, 1 / 60)
    }

    expect(state.tick).toBe(100)
  })
})

describe('advance', () => {
  it('runs one fixed step per DT of frame time', () => {
    const acc = createAccumulator()
    const state = createSimState()
    const input = createInput()

    expect(advance(acc, state, input, DT * 3)).toBe(3)
    expect(state.tick).toBe(3)
  })

  it('carries leftover time across frames instead of dropping it', () => {
    const acc = createAccumulator()
    const state = createSimState()
    const input = createInput()

    advance(acc, state, input, DT * 0.6)
    expect(state.tick).toBe(0)

    advance(acc, state, input, DT * 0.6)
    expect(state.tick).toBe(1)
  })

  it('leaves alpha as the fractional remainder for render interpolation', () => {
    const acc = createAccumulator()
    const state = createSimState()
    const input = createInput()

    advance(acc, state, input, DT * 1.5)
    expect(acc.alpha).toBeCloseTo(0.5, 10)
  })
})
