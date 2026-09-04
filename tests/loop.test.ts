import { describe, expect, it } from 'vitest'
import {
  DT,
  DEFAULT_SEED,
  advance,
  createAccumulator,
  createInput,
  createSimState,
  resetSimState,
  step,
  type SimState,
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

/**
 * A state with the retired pool slots dropped.
 *
 * A slot that is not in play holds whatever the last object in it held — that
 * is what recycling *is*, and every reader in the sim and the renderer alike
 * guards on `active` before touching one. So a world that has been used and
 * reset is allowed to differ from a virgin one in exactly those slots and
 * nowhere else, which is the comparison below.
 */
function inPlay(state: SimState) {
  return {
    ...state,
    world: {
      ...state.world,
      waves: state.world.waves.filter((wave) => wave.active),
      obstacles: state.world.obstacles.filter((obstacle) => obstacle.active),
    },
  }
}

describe('resetSimState', () => {
  it('leaves a used run indistinguishable from a fresh one (spec §10)', () => {
    // The whole restart rests on this. `createSimState` is written in terms of
    // the reset precisely so the two cannot drift, and this is the assertion
    // that says so out loud — a single field left behind is a run that begins
    // somewhere the first one did not.
    const used = createSimState(DEFAULT_SEED)
    const input = createInput()
    input.kiteTarget = 0.5

    for (let i = 0; i < 900; i++) step(used, input, DT)
    expect(used.rider.x).toBeGreaterThan(0)
    expect(used.world.waves.some((wave) => wave.active)).toBe(true)

    resetSimState(used, DEFAULT_SEED)
    expect(inPlay(used)).toEqual(inPlay(createSimState(DEFAULT_SEED)))
  })

  it('empties both pools, so nothing from the last run is still in the water', () => {
    const used = createSimState(DEFAULT_SEED)
    const input = createInput()
    input.kiteTarget = 0.5

    for (let i = 0; i < 900; i++) step(used, input, DT)
    resetSimState(used, DEFAULT_SEED)

    expect(used.world.waves.some((wave) => wave.active)).toBe(false)
    expect(used.world.obstacles.some((obstacle) => obstacle.active)).toBe(false)
  })

  it('re-seeds the world, so a seed always lays down the same water', () => {
    const state = createSimState(1)
    resetSimState(state, 7)

    expect(inPlay(state).world).toEqual(inPlay(createSimState(7)).world)
  })
})
