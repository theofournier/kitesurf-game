// Wind has to reach the physics. It is easy for it not to: WIND_BASE is the
// reference every wind term is measured against, so a run held at exactly
// WIND_BASE is identical at any value of it — `windPower` divides it out and
// `slewRate` subtracts it away. These are the tests that catch a wind number
// that moves on screen while the game underneath it does not.
import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning.ts'
import { slewRate, windPower } from '../src/sim/kite.ts'
import { createInput, createSimState, DT, step } from '../src/sim/loop.ts'

const RIDE_SECONDS = 10
/** Low on the arc: near the drive peak, so speed is the sensitive readout. */
const DRIVE_TARGET = 0.78

function ride(windOverride: number) {
  const state = createSimState()
  const input = createInput()
  input.kiteTarget = DRIVE_TARGET
  state.windOverride = windOverride

  for (let i = 0; i < RIDE_SECONDS / DT; i++) step(state, input, DT)
  return state
}

describe('wind reaches the sim', () => {
  it('drives the rider harder at tier 4 than at tier 1', () => {
    const low = ride(TUNING.WIND_BASE)
    const high = ride(35)

    expect(high.wind).toBe(35)
    expect(high.rider.speed).toBeGreaterThan(low.rider.speed)
    expect(high.rider.x).toBeGreaterThan(low.rider.x)
  })

  it('swings the kite faster at tier 4 than at tier 1', () => {
    expect(slewRate(35)).toBeGreaterThan(slewRate(TUNING.WIND_BASE))
    expect(windPower(35)).toBeGreaterThan(windPower(TUNING.WIND_BASE))
  })

  it('rides tier 1 by default, with no override set', () => {
    const auto = ride(createSimState().windOverride)
    const tier1 = ride(TUNING.WIND_BASE)

    expect(auto.wind).toBe(TUNING.WIND_BASE)
    expect(auto.rider.speed).toBe(tier1.rider.speed)
  })

  it('keeps speed monotonic in wind across the tier table', () => {
    let previous = 0
    for (const wind of [12, 18, 25, 35]) {
      const speed = ride(wind).rider.speed
      expect(speed).toBeGreaterThan(previous)
      previous = speed
    }
  })
})
