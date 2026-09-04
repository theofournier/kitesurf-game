// Wind has to reach the physics. It is easy for it not to: WIND_BASE is the
// reference every wind term is measured against, so a run held at exactly
// WIND_BASE is identical at any value of it — `windPower` divides it out and
// `slewRate` subtracts it away. These are the tests that catch a wind number
// that moves on screen while the game underneath it does not.
import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning.ts'
import { slewRate, windPower } from '../src/sim/kite.ts'
import { createInput, createSimState, DT, step } from '../src/sim/loop.ts'
import {
  TIER_MAX,
  tierAt,
  tierMult,
  tierStart,
  tierWind,
  WIND_AUTO,
  windAt,
  windFraction,
} from '../src/sim/wind.ts'

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

  it('starts a run at tier 1 and has already left it by the end of one', () => {
    // With no override the wind comes from the curve, and the curve is a
    // function of distance: the first step of a run is at WIND_BASE and ten
    // seconds of riding is enough to feel it climb (spec §7.1).
    const auto = ride(createSimState().windOverride)

    expect(auto.windOverride).toBe(WIND_AUTO)
    expect(windAt(0)).toBe(TUNING.WIND_BASE)
    expect(auto.rider.x).toBeGreaterThan(0)
    expect(auto.wind).toBeGreaterThan(TUNING.WIND_BASE)
    // A step behind the rider's final position, because `state.wind` is read at
    // the top of a step and the rider moves inside it.
    expect(auto.wind).toBeCloseTo(windAt(auto.rider.x), 1)
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

/**
 * The tier table of spec §7.1, read straight off the spec:
 *
 *     tier 1   0–500m     12kt   1.0x
 *     tier 2   500–1500m  18kt   1.5x
 *     tier 3   1500–3000m 25kt   2.5x
 *     tier 4   3000m+     35kt+  4.0x
 */
const TIERS = [
  { tier: 1, at: 0, wind: 12, mult: 1.0 },
  { tier: 2, at: 500, wind: 18, mult: 1.5 },
  { tier: 3, at: 1500, wind: 25, mult: 2.5 },
  { tier: 4, at: 3000, wind: 35, mult: 4.0 },
]

describe('the tier table (spec §7.1)', () => {
  it('puts every boundary of the spec table where the spec puts it', () => {
    for (const row of TIERS) {
      expect(tierAt(row.at), `${row.at}m`).toBe(row.tier)
      expect(tierStart(row.tier)).toBe(row.at)
      expect(tierWind(row.tier)).toBe(row.wind)
      expect(tierMult(row.tier)).toBe(row.mult)
      expect(windAt(row.at), `${row.at}m`).toBeCloseTo(row.wind, 10)
    }
  })

  it('gives a boundary to the tier it opens, not to the one it closes', () => {
    // 500m is the first metre of tier 2, which is what makes the spec's ranges
    // read as written — and what keeps the score multiplier from stepping a
    // metre late.
    expect(tierAt(499.99)).toBe(1)
    expect(tierAt(500)).toBe(2)
    expect(tierAt(1499.99)).toBe(2)
    expect(tierAt(1500)).toBe(3)
    expect(tierAt(2999.99)).toBe(3)
    expect(tierAt(3000)).toBe(4)
  })

  it('has no fifth tier to fall off the end of, however long the run', () => {
    expect(tierAt(1e6)).toBe(TIER_MAX)
    expect(tierMult(TIER_MAX + 3)).toBe(tierMult(TIER_MAX))
    expect(tierMult(-2)).toBe(tierMult(1))
  })

  it('pays a jump more in every tier than in the one below it', () => {
    for (let tier = 2; tier <= TIER_MAX; tier++) {
      expect(tierMult(tier)).toBeGreaterThan(tierMult(tier - 1))
    }
  })
})

describe('the wind curve (spec §7.1)', () => {
  it('interpolates continuously, with no step at a boundary', () => {
    // "Wind interpolates continuously; tiers exist for feedback and scoring."
    // A metre either side of a boundary is a hair of wind either side of it —
    // the multiplier steps there, the wind does not.
    for (const row of TIERS.slice(1)) {
      const before = windAt(row.at - 0.001)
      const after = windAt(row.at + 0.001)
      expect(after - before).toBeLessThan(0.01)
      expect(after).toBeGreaterThan(before)
    }
  })

  it('rises with distance and never with time', () => {
    let previous = 0
    for (let x = 0; x <= 12000; x += 25) {
      const wind = windAt(x)
      expect(wind, `${x}m`).toBeGreaterThan(previous)
      previous = wind
    }

    // The whole point of keying it to distance: a rider who dawdles gets the
    // same wind at the same place as one who does not, so there is nothing to
    // farm by slowing down.
    const parked = createSimState()
    const input = createInput()
    for (let i = 0; i < 600; i++) step(parked, input, DT)

    expect(parked.rider.x).toBe(0)
    expect(parked.wind).toBe(TUNING.WIND_BASE)
    expect(parked.tier).toBe(1)
  })

  it('keeps climbing past the last boundary, toward a ceiling it never reaches', () => {
    // Spec §7.1's tier 4 is "35kt+", so the open tier stays open.
    const boundary = windAt(3000)
    expect(windAt(4000)).toBeGreaterThan(boundary)
    expect(windAt(30000)).toBeGreaterThan(windAt(4000))

    for (const x of [3000, 6000, 30000, 1e7]) {
      expect(windAt(x), `${x}m`).toBeLessThan(TUNING.WIND_TOP)
    }

    // WIND_TOP_M past the boundary closes half the gap to the ceiling.
    const half = (boundary + TUNING.WIND_TOP) / 2
    expect(windAt(3000 + TUNING.WIND_TOP_M)).toBeCloseTo(half, 10)
  })

  it('holds at WIND_BASE at and before the start line', () => {
    expect(windAt(0)).toBe(TUNING.WIND_BASE)
    expect(windAt(-50)).toBe(TUNING.WIND_BASE)
  })

  it('reads out as a 0..1 fraction of the whole curve, for feedback', () => {
    expect(windFraction(TUNING.WIND_BASE)).toBe(0)
    expect(windFraction(TUNING.WIND_TOP)).toBe(1)
    expect(windFraction(TUNING.WIND_TOP + 10)).toBe(1)
    expect(windFraction(0)).toBe(0)
    expect(windFraction(windAt(1500))).toBeGreaterThan(windFraction(windAt(500)))
  })
})

describe('the tier the sim is riding in', () => {
  /** Puts a rider `at` metres in and takes one step, so the sim reads the curve. */
  function at(distance: number) {
    const state = createSimState()
    state.rider.x = distance
    step(state, createInput(), DT)
    return state
  }

  it('tracks the rider distance rather than the clock', () => {
    for (const row of TIERS) {
      const state = at(row.at + 10)

      expect(state.tier, `${row.at}m`).toBe(row.tier)
      expect(state.wind, `${row.at}m`).toBeCloseTo(windAt(row.at + 10), 10)
    }
  })

  it('is overridden whole, tier and all, by the debug wind', () => {
    // The override is a wind, not a tier: it changes what the physics feels
    // without moving the rider up the table, because the table is distance.
    const state = createSimState()
    state.windOverride = 35
    step(state, createInput(), DT)

    expect(state.wind).toBe(35)
    expect(state.tier).toBe(1)
  })
})
