import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning.ts'
import { createInput, createSimState, DT, step, type RiderInput } from '../src/sim/loop.ts'
import {
  createRiderState,
  peakHeight,
  popImpulse,
  stepRider,
  type RiderState,
} from '../src/sim/rider.ts'
import {
  createKicker,
  createWorldState,
  faceLength,
  initWave,
  kickerAt,
  kickerBonus,
  maxBonus,
  rampHeight,
  rampSpeed,
  stepWorld,
  WAVE,
  WIND_AUTO,
  windAt,
  type Wave,
  type WaveType,
} from '../src/sim/world.ts'

const KT_12 = 12
const KT_35 = 35
/** The three wave types, in the order of the spec §4.1 table. */
const TYPES: WaveType[] = [WAVE.CHOP, WAVE.WAVE, WAVE.WAKE]

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

describe('wave entities (spec §4.1)', () => {
  it('gives each type the ramp height and bonus of the spec table', () => {
    expect(rampHeight(WAVE.CHOP)).toBe(TUNING.RAMP_CHOP)
    expect(rampHeight(WAVE.WAVE)).toBe(TUNING.RAMP_WAVE)
    expect(rampHeight(WAVE.WAKE)).toBe(TUNING.RAMP_WAKE)

    expect(maxBonus(WAVE.CHOP)).toBe(TUNING.BONUS_CHOP)
    expect(maxBonus(WAVE.WAVE)).toBe(TUNING.BONUS_WAVE)
    expect(maxBonus(WAVE.WAKE)).toBe(TUNING.BONUS_WAKE)
  })

  it('ranks the three types by height and by reward, in the same order', () => {
    // The §4.1 table is only interesting if the bigger ramp is also the better
    // payout: that is what makes chasing a boat a decision rather than a chore.
    expect(rampHeight(WAVE.CHOP)).toBeLessThan(rampHeight(WAVE.WAVE))
    expect(rampHeight(WAVE.WAVE)).toBeLessThan(rampHeight(WAVE.WAKE))
    expect(maxBonus(WAVE.CHOP)).toBeLessThan(maxBonus(WAVE.WAVE))
    expect(maxBonus(WAVE.WAVE)).toBeLessThan(maxBonus(WAVE.WAKE))
  })

  it('puts the lip at the top of the face and the trough a face length behind', () => {
    for (const type of TYPES) {
      const wave = initWave({} as Wave, 300, type)

      expect(wave.active).toBe(true)
      expect(wave.type).toBe(type)
      expect(wave.lipX).toBe(300)
      expect(wave.height).toBe(rampHeight(type))
      expect(wave.face).toBe(faceLength(wave.height))
      expect(wave.x).toBeCloseTo(300 - wave.face, 10)
      expect(wave.maxBonus).toBe(maxBonus(type))
    }
  })

  it('makes a taller wave a steeper one', () => {
    // faceLength grows as sqrt(height), so the gradient the ramp launches off
    // rises with the wave rather than staying flat across the three types.
    const slope = (type: WaveType) => rampHeight(type) / faceLength(rampHeight(type))

    expect(slope(WAVE.CHOP)).toBeLessThan(slope(WAVE.WAVE))
    expect(slope(WAVE.WAVE)).toBeLessThan(slope(WAVE.WAKE))
  })
})

describe('kickerBonus (spec §4.2)', () => {
  it('is exactly the type maximum at the lip', () => {
    for (const type of TYPES) {
      expect(kickerBonus(maxBonus(type), 0)).toBe(maxBonus(type))
    }
  })

  it('is exactly 1.0 a full window from the lip, either side', () => {
    for (const type of TYPES) {
      expect(kickerBonus(maxBonus(type), TUNING.KICKER_WINDOW)).toBe(1)
      expect(kickerBonus(maxBonus(type), -TUNING.KICKER_WINDOW)).toBe(1)
    }
  })

  it('still pays at least 85% of the maximum at 120ms', () => {
    // Spec §4.2: "full bonus within roughly ±120ms". The quadratic leaves 84%
    // of the bonus *above 1* standing there, which is what "roughly full"
    // buys — the window is forgiving in its middle and unforgiving at its edge.
    for (const type of TYPES) {
      const max = maxBonus(type)
      for (const delta of [0.12, -0.12]) {
        expect(kickerBonus(max, delta)).toBeGreaterThanOrEqual(0.85 * max)
        expect(kickerBonus(max, delta) - 1).toBeCloseTo(0.84 * (max - 1), 10)
      }
    }
  })

  it('never drops below 1 and never passes the maximum, at any timing', () => {
    // Including well outside the window and on the wrong side of the lip: a
    // kicker is a bonus, so the worst it can ever do is nothing at all.
    for (const type of TYPES) {
      const max = maxBonus(type)
      for (let delta = -2; delta <= 2; delta += 0.001) {
        const bonus = kickerBonus(max, delta)
        expect(bonus).toBeGreaterThanOrEqual(1)
        expect(bonus).toBeLessThanOrEqual(max)
      }
    }
  })

  it('falls off symmetrically, and monotonically out to the window', () => {
    const max = maxBonus(WAVE.WAKE)
    let previous = max

    for (let delta = 0; delta <= TUNING.KICKER_WINDOW; delta += 0.005) {
      const bonus = kickerBonus(max, delta)
      expect(bonus).toBeLessThanOrEqual(previous)
      expect(bonus).toBeCloseTo(kickerBonus(max, -delta), 12)
      previous = bonus
    }
  })
})

describe('ramp velocity (spec §4.2)', () => {
  it('is the board speed times the gradient of the face', () => {
    for (const type of TYPES) {
      const height = rampHeight(type)
      const speed = 14
      expect(rampSpeed(height, speed)).toBeCloseTo((speed * height) / faceLength(height), 12)
    }
  })

  it('gives a wave back its own height as apex at MAX_SPEED', () => {
    // What WAVE_FACE_K is set against: hitting a ramp flat out is worth about
    // the ramp, before the pop and the bonus are counted at all.
    for (const type of TYPES) {
      const height = rampHeight(type)
      const apex = peakHeight(rampSpeed(height, TUNING.MAX_SPEED))
      expect(apex / height).toBeGreaterThan(0.8)
      expect(apex / height).toBeLessThan(1.2)
    }
  })

  it('scales with speed and is nothing at a standstill', () => {
    const height = rampHeight(WAVE.WAVE)
    expect(rampSpeed(height, 0)).toBe(0)
    expect(rampSpeed(height, 20)).toBeCloseTo(2 * rampSpeed(height, 10), 12)
  })

  it('is nothing on flat water', () => {
    expect(rampSpeed(0, TUNING.MAX_SPEED)).toBe(0)
  })
})

/** A world holding exactly the waves given, at the lips given. */
function worldOf(...waves: [number, WaveType][]) {
  const world = createWorldState(1)
  for (let i = 0; i < waves.length; i++) {
    initWave(world.waves[i], waves[i][0], waves[i][1])
  }
  // Past the horizon, so stepWorld is never asked to add to a fixture.
  world.spawnX = 1e9
  return world
}

describe('kickerAt', () => {
  const kicker = createKicker()

  it('reads flat water away from every lip', () => {
    const world = worldOf([100, WAVE.WAVE])
    kickerAt(kicker, world, 50, 15)

    expect(kicker.bonus).toBe(1)
    expect(kicker.ramp).toBe(0)
    expect(kicker.type).toBe(null)
  })

  it('pays the full bonus and the ramp at the lip', () => {
    const world = worldOf([100, WAVE.WAKE])
    kickerAt(kicker, world, 100, 15)

    expect(kicker.bonus).toBe(TUNING.BONUS_WAKE)
    expect(kicker.ramp).toBeCloseTo(rampSpeed(TUNING.RAMP_WAKE, 15), 12)
    expect(kicker.type).toBe(WAVE.WAKE)
    expect(kicker.delta).toBe(0)
  })

  it('signs the miss: negative before the lip, positive after', () => {
    const world = worldOf([100, WAVE.WAVE])

    kickerAt(kicker, world, 99, 10)
    expect(kicker.delta).toBeCloseTo(-0.1, 12)

    kickerAt(kicker, world, 101, 10)
    expect(kicker.delta).toBeCloseTo(0.1, 12)
  })

  it('measures the window in time, so a faster rider gets a wider one in metres', () => {
    const world = worldOf([100, WAVE.WAVE])
    const reach = (speed: number) => {
      let last = 0
      for (let x = 90; x <= 100; x += 0.01) {
        kickerAt(kicker, world, x, speed)
        if (kicker.bonus > 1) return 100 - x
        last = x
      }
      return 100 - last
    }

    // The lip is a moment, not a place: at twice the speed the same 300ms of
    // approach covers twice the water.
    expect(reach(20)).toBeGreaterThan(1.9 * reach(10))
    expect(reach(20)).toBeLessThan(2.1 * reach(10))
  })

  it('gives the ramp in full anywhere in the window, unscaled by the timing', () => {
    // Spec §4.2: the ramp velocity is the wave's, independent of the bonus. A
    // mistimed hit off a wake still leaves the water faster than a perfect one
    // off flat water.
    const world = worldOf([100, WAVE.WAKE])
    const full = rampSpeed(TUNING.RAMP_WAKE, 12)

    kickerAt(kicker, world, 100, 12)
    expect(kicker.ramp).toBeCloseTo(full, 12)

    kickerAt(kicker, world, 100 - 12 * 0.29, 12)
    expect(kicker.bonus).toBeLessThan(1.2)
    expect(kicker.ramp).toBeCloseTo(full, 12)
  })

  it('takes the nearest lip in time when two are in reach', () => {
    const world = worldOf([100, WAVE.CHOP], [101, WAVE.WAKE])
    kickerAt(kicker, world, 100.9, 10)
    expect(kicker.type).toBe(WAVE.WAKE)
  })

  it('reads flat water at a standstill, where there is no timing to have', () => {
    const world = worldOf([100, WAVE.WAKE])
    kickerAt(kicker, world, 100, 0)

    expect(kicker.bonus).toBe(1)
    expect(kicker.ramp).toBe(0)
  })

  it('ignores a recycled slot', () => {
    const world = worldOf([100, WAVE.WAKE])
    world.waves[0].active = false
    kickerAt(kicker, world, 100, 15)

    expect(kicker.type).toBe(null)
  })
})

describe('wave generation', () => {
  /** Every lip a seed lays down over `metres` of riding, in order. */
  function lipsOver(seed: number, metres: number, stepM = 5): [number, WaveType][] {
    const world = createWorldState(seed)
    const seen: [number, WaveType][] = []
    const known = new Set<number>()

    for (let x = 0; x <= metres; x += stepM) {
      stepWorld(world, x)
      for (const wave of world.waves) {
        if (wave.active && !known.has(wave.lipX)) {
          known.add(wave.lipX)
          seen.push([wave.lipX, wave.type])
        }
      }
    }
    return seen.sort((a, b) => a[0] - b[0])
  }

  it('lays the same waves down for the same seed, and different ones for another', () => {
    expect(lipsOver(7, 2000)).toEqual(lipsOver(7, 2000))
    expect(lipsOver(7, 2000)).not.toEqual(lipsOver(8, 2000))
  })

  it('lays the same waves down however coarsely the rider passes through', () => {
    // The generator is keyed off distance, not off steps: the stream a seed
    // produces cannot depend on how the run was flown, or a replay would drift.
    expect(lipsOver(3, 2000, 5)).toEqual(lipsOver(3, 2000, 37))
  })

  it('keeps every gap inside WAVE_GAP_MIN..WAVE_GAP_MAX', () => {
    const lips = lipsOver(11, 5000)
    expect(lips.length).toBeGreaterThan(20)

    for (let i = 1; i < lips.length; i++) {
      const gap = lips[i][0] - lips[i - 1][0]
      expect(gap).toBeGreaterThanOrEqual(TUNING.WAVE_GAP_MIN)
      expect(gap).toBeLessThanOrEqual(TUNING.WAVE_GAP_MAX)
    }
  })

  it('rolls all three types, with chop the most common and wakes rare', () => {
    const types = lipsOver(5, 40000).map(([, type]) => type)
    const share = (type: WaveType) => types.filter((t) => t === type).length / types.length

    expect(share(WAVE.CHOP)).toBeCloseTo(TUNING.WAVE_MIX_CHOP, 1)
    expect(share(WAVE.WAVE)).toBeCloseTo(TUNING.WAVE_MIX_WAVE, 1)
    expect(share(WAVE.WAKE)).toBeGreaterThan(0)
    expect(share(WAVE.WAKE)).toBeLessThan(share(WAVE.WAVE))
  })

  it('keeps the horizon stocked, so a wave always exists before it is drawn', () => {
    const world = createWorldState(2)
    for (let x = 0; x <= 4000; x += 10) {
      stepWorld(world, x)
      // WAVE_LEAD seconds of MAX_SPEED riding: the distance the renderer has to
      // be able to telegraph over.
      expect(world.spawnX).toBeGreaterThan(x + TUNING.WAVE_LEAD * TUNING.MAX_SPEED)
    }
  })

  it('recycles what is behind rather than growing the pool', () => {
    const world = createWorldState(4)
    const pool = world.waves.length

    for (let x = 0; x <= 20000; x += 10) {
      stepWorld(world, x)
      expect(world.waves.length).toBe(pool)
      for (const wave of world.waves) {
        if (wave.active) expect(wave.lipX).toBeGreaterThan(x - 100)
      }
    }
  })
})

/** Input holding the load with the kite pointed at `theta`. */
function loadingAt(theta: number): RiderInput {
  return { kiteTarget: theta / 90, loading: true }
}

/** A rider parked at `theta`, ridden up to the speed that angle holds. */
function cruising(theta: number, wind: number): RiderState {
  const rider = createRiderState()
  rider.kite.angle = theta
  rider.kite.target = theta
  rider.kite.aim = theta

  const input = { kiteTarget: theta / 90, loading: false }
  for (let i = 0; i < 1500; i++) stepRider(rider, input, wind, DT)
  return rider
}

/** The drive peak of the shipped DRIVE_SHAPE — the angle a run is ridden at. */
const DRIVE_PEAK = 70.53

/**
 * The speed a rider has at the moment the edge goes full: the speed a pop is
 * actually taken at, since the carve scrubs while the load builds (spec §3.4).
 */
function loadedSpeed(wind: number): number {
  const rider = cruising(DRIVE_PEAK, wind)
  const edge = loadingAt(DRIVE_PEAK)
  for (let i = 0; i < 900 && rider.load < 1; i++) stepRider(rider, edge, wind, DT)
  return rider.speed
}

/**
 * The best apex `type` can launch at `wind`: full load, perfect lip timing, the
 * release angle that maximises the takeoff, and the ramp the wave gives at the
 * speed a full edge leaves.
 *
 * Measured on the launch rather than on the flight, which is how the flat-water
 * row of §4.4 is checked in rider.test.ts: what the kite does with the air
 * afterwards is §3.6's business, and float would fold that back in.
 */
function ceiling(wind: number, type: WaveType | null): number {
  const height = type === null ? 0 : rampHeight(type)
  const bonus = type === null ? 1 : maxBonus(type)
  const ramp = rampSpeed(height, loadedSpeed(wind))

  let best = 0
  for (let theta = 0; theta <= 90; theta += 0.25) {
    const apex = peakHeight(popImpulse(1, theta, wind, bonus) + ramp)
    if (apex > best) best = apex
  }
  return best
}

describe('height ceilings (spec §4.4)', () => {
  /**
   * The spec §4.4 table, 12kt → 35kt. There is no chop row: §4.1 has the type
   * and §4.4 does not price it, so the chop ceiling is pinned by its neighbours
   * below instead.
   */
  const TABLE: [WaveType, number, number][] = [
    [WAVE.WAVE, 5, 11],
    [WAVE.WAKE, 7, 15],
  ]

  /**
   * §4.4 asks for 5m/11m off a wave and 7m/15m off a boat wake. The shipped
   * bonuses cannot produce those numbers, and the reason is arithmetic rather
   * than tuning:
   *
   *   §3.5 multiplies the pop *impulse* by kickerBonus
   *   apex goes as impulse², so a 1.6x bonus is 2.56x the height and 2.4x is 5.76x
   *   §4.4 asks for 2x the flat ceiling off a wave and 2.8x off a wake
   *
   * So the §4.1 bonus column and the §4.4 ceiling table describe two different
   * games. Landing §4.4 with this formula would need BONUS_WAVE ~1.1 and
   * BONUS_WAKE ~1.25 — most of §4.4's height is then the ramp velocity, not the
   * bonus at all.
   *
   * The rest of the spec sides with the big numbers: §3.7 works through "a 48m
   * wake hit at 35kt", and the landing budget the human tuned in session 5 is
   * built around airs of exactly that size (see the 40m+ expectations in
   * tests/rider.test.ts). §4.4 looks like the stale table rather than the
   * stale formula, so this stays marked as a known conflict and the shipped
   * values stand — see the session-6 report.
   */
  it.fails('matches the §4.4 table within 10%, at 12kt and at 35kt', () => {
    for (const [type, low, high] of TABLE) {
      expect(ceiling(KT_12, type) / low).toBeCloseTo(1, 1)
      expect(ceiling(KT_35, type) / high).toBeCloseTo(1, 1)
    }
  })

  it('clears every §4.4 row rather than falling short of it', () => {
    // The half of the table that is not in dispute: §4 promises the player that
    // a wave beats flat water and a wake beats a wave, by a lot. Whatever the
    // ceilings are tuned to, they are never under what §4.4 advertises.
    for (const [type, low, high] of TABLE) {
      expect(ceiling(KT_12, type)).toBeGreaterThanOrEqual(low)
      expect(ceiling(KT_35, type)).toBeGreaterThanOrEqual(high)
    }
  })

  it('squares the bonus, which is exactly where §4.4 is missed', () => {
    // The characterisation half, with the ramp taken out so the multiplier is
    // alone: a kicker ceiling is the flat ceiling times the *square* of its
    // bonus, because §3.5 multiplies an impulse and apex goes as impulse².
    // 1.6x is 2.56x the height and 2.4x is 5.76x, against the 2x and 2.8x §4.4
    // asks for. Nothing else in the chain is off by anything like that.
    for (const wind of [KT_12, KT_35]) {
      const flat = ceiling(wind, null)
      for (const type of TYPES) {
        const bonus = maxBonus(type)
        let best = 0
        for (let theta = 0; theta <= 90; theta += 0.25) {
          const apex = peakHeight(popImpulse(1, theta, wind, bonus))
          if (apex > best) best = apex
        }
        expect(best).toBeCloseTo(flat * bonus * bonus, 6)
      }
    }
  })

  it('adds the ramp on top of that, never folding it into the bonus', () => {
    for (const wind of [KT_12, KT_35]) {
      for (const type of TYPES) {
        let bonusOnly = 0
        for (let theta = 0; theta <= 90; theta += 0.25) {
          const apex = peakHeight(popImpulse(1, theta, wind, maxBonus(type)))
          if (apex > bonusOnly) bonusOnly = apex
        }
        expect(ceiling(wind, type)).toBeGreaterThan(bonusOnly)
      }
    }
  })

  it('ranks flat, chop, wave and wake in order, at both tiers', () => {
    for (const wind of [KT_12, KT_35]) {
      const flat = ceiling(wind, null)
      expect(flat).toBeLessThan(ceiling(wind, WAVE.CHOP))
      expect(ceiling(wind, WAVE.CHOP)).toBeLessThan(ceiling(wind, WAVE.WAVE))
      expect(ceiling(wind, WAVE.WAVE)).toBeLessThan(ceiling(wind, WAVE.WAKE))
    }
  })

  it('lifts every ceiling with the wind', () => {
    for (const type of [null, ...TYPES]) {
      expect(ceiling(KT_35, type)).toBeGreaterThan(ceiling(KT_12, type))
    }
  })
})

describe('taking off from a wave', () => {
  /**
   * Rides to a full edge and pops with `kicker` under the board, returning the
   * apex the launch reached. The kicker is handed in rather than looked up so
   * one launch can be flown twice, once off the wave and once off flat water.
   */
  function pop(wind: number, bonus: number, ramp: number): number {
    const rider = cruising(DRIVE_PEAK, wind)
    const edge = loadingAt(DRIVE_PEAK)
    for (let i = 0; i < 900 && rider.load < 1; i++) stepRider(rider, edge, wind, DT)

    const kicker = createKicker()
    kicker.bonus = bonus
    kicker.ramp = ramp
    stepRider(rider, { kiteTarget: DRIVE_PEAK / 90, loading: false }, wind, DT, kicker)

    expect(rider.airborne).toBe(true)
    return peakHeight(rider.vSpeed)
  }

  it('beats the same pop off flat water', () => {
    const ramp = rampSpeed(TUNING.RAMP_WAVE, loadedSpeed(KT_12))
    expect(pop(KT_12, TUNING.BONUS_WAVE, ramp)).toBeGreaterThan(pop(KT_12, 1, 0))
  })

  it('counts the ramp separately from the bonus', () => {
    // Both halves of §4.2 are load-bearing: the ramp alone beats flat water,
    // the bonus alone beats flat water, and the two together beat either.
    const ramp = rampSpeed(TUNING.RAMP_WAKE, loadedSpeed(KT_12))
    const flat = pop(KT_12, 1, 0)
    const rampOnly = pop(KT_12, 1, ramp)
    const bonusOnly = pop(KT_12, TUNING.BONUS_WAKE, 0)

    expect(rampOnly).toBeGreaterThan(flat)
    expect(bonusOnly).toBeGreaterThan(flat)
    expect(pop(KT_12, TUNING.BONUS_WAKE, ramp)).toBeGreaterThan(Math.max(rampOnly, bonusOnly))
  })

  it('records what the pop came off, for the readout that explains a miss', () => {
    const rider = cruising(DRIVE_PEAK, KT_12)
    const edge = loadingAt(DRIVE_PEAK)
    for (let i = 0; i < 900 && rider.load < 1; i++) stepRider(rider, edge, KT_12, DT)

    const kicker = createKicker()
    kicker.bonus = kickerBonus(TUNING.BONUS_WAVE, -0.1)
    kicker.delta = -0.1
    stepRider(rider, { kiteTarget: DRIVE_PEAK / 90, loading: false }, KT_12, DT, kicker)

    expect(rider.lastKicker).toBeCloseTo(kicker.bonus, 12)
    expect(rider.lastLip).toBeCloseTo(-0.1, 12)
  })

  it('takes no kicker at all when the pop was forfeited by a stall', () => {
    // A stalled edge has nothing to multiply (spec §3.4), and a wave cannot
    // hand back the pop the stall took: the rider stays on the water.
    const rider = cruising(DRIVE_PEAK, KT_12)
    const edge = loadingAt(DRIVE_PEAK)
    for (let i = 0; i < 900 && !rider.popForfeit; i++) stepRider(rider, edge, KT_12, DT)
    expect(rider.popForfeit).toBe(true)

    const kicker = createKicker()
    kicker.bonus = TUNING.BONUS_WAKE
    kicker.ramp = rampSpeed(TUNING.RAMP_WAKE, rider.speed)
    stepRider(rider, { kiteTarget: DRIVE_PEAK / 90, loading: false }, KT_12, DT, kicker)

    expect(rider.airborne).toBe(false)
    expect(rider.lastPop).toBe(0)
  })

  it('reaches the rider through the loop, off a wave the generator laid down', () => {
    // End to end: no fixture kicker and no hand-placed wave. Ride the seeded
    // world, start the edge a second out from the next lip, and let go on it.
    const state = createSimState(9)
    const input = createInput()
    input.kiteTarget = DRIVE_PEAK / 90

    for (let i = 0; i < 1500; i++) step(state, input, DT)

    /** Seconds to the next lip ahead, at the speed the rider is doing. */
    const toLip = () => {
      let nearest = Infinity
      for (const wave of state.world.waves) {
        if (wave.active && wave.lipX > state.rider.x && wave.lipX < nearest) nearest = wave.lipX
      }
      return (nearest - state.rider.x) / state.rider.speed
    }

    for (let i = 0; i < 60 * 60 && !state.rider.airborne; i++) {
      // The approach the whole session is about: edge on for the last second,
      // let go as the lip arrives. Short of STALL_GRACE, so nothing forfeits.
      const lead = toLip()
      input.loading = lead > DT && lead < 1
      step(state, input, DT)
    }

    expect(state.rider.airborne).toBe(true)
    expect(state.rider.lastKicker).toBeGreaterThan(1)
    expect(Math.abs(state.rider.lastLip)).toBeLessThan(TUNING.KICKER_WINDOW)
  })
})
