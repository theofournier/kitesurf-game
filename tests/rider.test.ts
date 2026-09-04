import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning.ts'
import { WINDOW_MAX, driveFactor, liftFactor, slewRate, windPower } from '../src/sim/kite.ts'
import { DT, createInput, type RiderInput } from '../src/sim/loop.ts'
import {
  PHASE,
  airAccel,
  ballisticDescent,
  carveDrag,
  createRiderState,
  descentBudget,
  drag,
  driveAccel,
  floatAccel,
  LAND_REASON,
  landingQuality,
  landingReason,
  loadRate,
  peakHeight,
  popImpulse,
  stepRider,
  terminalSpeed,
  type RiderState,
} from '../src/sim/rider.ts'

const KT_12 = 12
const KT_35 = 35

/** A kite angle inside the sketchy band but outside the clean one (spec §3.7). */
const SKETCHY_ANGLE = 25

/**
 * The apex whose no-float descent is exactly SOFT_LAND, so `descentBudget` on
 * the clean row returns SOFT_LAND itself. The landing table is written against
 * this air, which pins the rows to the constants the human tunes.
 */
const REF_APEX = TUNING.SOFT_LAND ** 2 / (2 * TUNING.GRAVITY)

/** Input that parks the kite at `theta`, held there by the caller's stepping. */
function inputAt(theta: number) {
  const input = createInput()
  input.kiteTarget = theta / WINDOW_MAX
  return input
}

/**
 * Runs a rider with the kite already parked at `theta` — the kite is placed
 * there rather than slewed to it, so the speed curve under test is not mixed
 * with the travel time.
 */
function parkedAt(theta: number) {
  const rider = createRiderState()
  rider.kite.angle = theta
  rider.kite.target = theta
  rider.kite.aim = theta
  return rider
}

describe('drag', () => {
  it('is quadratic in speed', () => {
    expect(drag(10)).toBeCloseTo(TUNING.DRAG_K * 100, 10)
    expect(drag(20)).toBeCloseTo(4 * drag(10), 10)
  })
})

describe('driveAccel', () => {
  it('is drive minus drag, exactly as spec §3.3 writes it', () => {
    const expected = driveFactor(50) * windPower(KT_12) * TUNING.DRIVE_K - drag(8)
    expect(driveAccel(50, 8, KT_12)).toBeCloseTo(expected, 10)
  })

  it('does not accelerate at zenith', () => {
    expect(driveAccel(0, 0, KT_12)).toBeCloseTo(0, 10)
  })

  it('is stronger at 35kt than at 12kt for the same angle', () => {
    expect(driveAccel(50, 0, KT_35)).toBeGreaterThan(driveAccel(50, 0, KT_12))
  })
})

describe('speed integration', () => {
  it('converges to within 10% of terminal at theta=50, 12kt, in under 8s, without oscillating', () => {
    const rider = parkedAt(50)
    const input = inputAt(50)
    const terminal = terminalSpeed(50, KT_12)
    const budget = Math.round(8 / DT)

    let previous = rider.speed
    let reachedAt = -1

    for (let i = 1; i <= budget; i++) {
      stepRider(rider, input, KT_12, DT)

      // Monotone approach: never a step backwards, never past terminal.
      expect(rider.speed).toBeGreaterThanOrEqual(previous)
      expect(rider.speed).toBeLessThanOrEqual(terminal + 1e-9)
      previous = rider.speed

      if (reachedAt < 0 && rider.speed >= terminal * 0.9) reachedAt = i
    }

    expect(reachedAt).toBeGreaterThan(0)
    expect(reachedAt * DT).toBeLessThan(8)
  })

  it('holds the kite at 50deg while it converges', () => {
    const rider = parkedAt(50)
    const input = inputAt(50)
    for (let i = 0; i < 480; i++) stepRider(rider, input, KT_12, DT)
    expect(rider.kite.angle).toBeCloseTo(50, 6)
  })

  it('does not exceed MAX_SPEED at 35kt, at any angle', () => {
    for (let theta = 0; theta <= 90; theta += 5) {
      const rider = parkedAt(theta)
      const input = inputAt(theta)
      for (let i = 0; i < 1800; i++) {
        stepRider(rider, input, KT_35, DT)
        expect(rider.speed).toBeLessThanOrEqual(TUNING.MAX_SPEED)
      }
      expect(rider.speed).toBeLessThanOrEqual(terminalSpeed(theta, KT_35) + 1e-9)
    }
  })

  it('rides against the MAX_SPEED ceiling at 35kt near the drive peak', () => {
    // Unlimited, the balance at 35kt is ~26 m/s, so the top tier is capped by
    // the spec §3.1 range on speed rather than by drag.
    const rider = parkedAt(70.53)
    const input = inputAt(70.53)
    for (let i = 0; i < 1800; i++) stepRider(rider, input, KT_35, DT)
    expect(rider.speed).toBe(TUNING.MAX_SPEED)
  })

  it('stays well below MAX_SPEED at 12kt', () => {
    const rider = parkedAt(70.53)
    const input = inputAt(70.53)
    for (let i = 0; i < 1800; i++) stepRider(rider, input, KT_12, DT)
    expect(rider.speed).toBeLessThan(TUNING.MAX_SPEED)
    expect(rider.speed).toBeCloseTo(terminalSpeed(70.53, KT_12), 3)
  })

  it('never drives the rider backwards', () => {
    const rider = createRiderState()
    const input = inputAt(0)
    for (let i = 0; i < 600; i++) {
      stepRider(rider, input, KT_12, DT)
      expect(rider.speed).toBeGreaterThanOrEqual(0)
    }
  })

  it('bleeds speed back down when the kite is parked at zenith', () => {
    const rider = parkedAt(70)
    const fast = inputAt(70)
    for (let i = 0; i < 600; i++) stepRider(rider, fast, KT_12, DT)
    const cruising = rider.speed
    expect(cruising).toBeGreaterThan(5)

    const zenith = inputAt(0)
    for (let i = 0; i < 600; i++) stepRider(rider, zenith, KT_12, DT)
    expect(rider.speed).toBeLessThan(cruising)
  })
})

describe('terminalSpeed', () => {
  it('is where drive balances drag, below the ceiling', () => {
    const v = terminalSpeed(50, KT_12)
    expect(v).toBeLessThan(TUNING.MAX_SPEED)
    expect(driveAccel(50, v, KT_12)).toBeCloseTo(0, 10)
  })

  it('is 0 at zenith', () => {
    expect(terminalSpeed(0, KT_12)).toBeCloseTo(0, 10)
  })

  it('is capped at MAX_SPEED', () => {
    for (let theta = 0; theta <= 90; theta += 1) {
      expect(terminalSpeed(theta, KT_35)).toBeLessThanOrEqual(TUNING.MAX_SPEED)
    }
  })
})

describe('distance', () => {
  it('integrates speed, so distance is what the run is measured in', () => {
    const rider = parkedAt(50)
    rider.speed = 10

    const input = inputAt(50)
    for (let i = 0; i < 60; i++) stepRider(rider, input, KT_12, DT)

    // Speed is still accelerating toward terminal, so the distance covered is
    // at least a second at the speed it started with.
    expect(rider.x).toBeGreaterThan(10)
    expect(rider.x).toBeLessThan(rider.speed)
  })

  it('never runs backwards, whatever the kite is doing', () => {
    const rider = createRiderState()
    const input = inputAt(0)

    let last = 0
    for (let i = 0; i < 600; i++) {
      stepRider(rider, input, KT_12, DT)
      expect(rider.x).toBeGreaterThanOrEqual(last)
      last = rider.x
    }
  })

  it('starts on the water', () => {
    expect(createRiderState().altitude).toBe(0)
  })
})

/** A rider parked at `theta` and pinned at MAX_SPEED by the 35kt drive ceiling. */
function atFullSpeed() {
  const rider = parkedAt(70.53)
  rider.speed = TUNING.MAX_SPEED
  return rider
}

/** Input holding the load with the kite pointed at `theta`. */
function loadingAt(theta: number) {
  const input = inputAt(theta)
  input.loading = true
  return input
}

/**
 * Holds the edge until the load goes full, and returns the step it did on.
 *
 * The carve scrubs the speed the load builds against (spec §3.4), so this is no
 * longer the flat `1 / LOAD_RATE` a pinned speed would give — every test that
 * needs to be at full load asks for it rather than counting it out.
 */
function stepToFullLoad(rider: RiderState, input: RiderInput, wind: number): number {
  for (let i = 1; i <= 600; i++) {
    stepRider(rider, input, wind, DT)
    if (rider.load >= 1) return i
  }
  throw new Error('the load never reached 1')
}

/**
 * Pops a rider carrying `load` with the kite parked at `theta`, then flies it to
 * touchdown with the kite aimed at `airTheta` — which it slews to, exactly as it
 * would under a player's thumb. `pin` teleports the kite there instead, for the
 * tests that want the float term isolated from the travel time.
 */
function fly(load: number, theta: number, wind: number, airTheta = theta, pin = false) {
  const rider = parkedAt(theta)
  rider.load = load
  rider.loading = true

  const input = inputAt(theta)
  stepRider(rider, input, wind, DT) // input.loading is false: the release edge
  expect(rider.airborne).toBe(true)

  const air = inputAt(airTheta)
  if (pin) {
    rider.kite.angle = airTheta
    rider.kite.target = airTheta
    rider.kite.aim = airTheta
  }

  const launchSpeed = rider.speed
  let peak = 0
  let steps = 0
  // The last speed the air itself produced. Read before each step so it survives
  // the one that lands, where the landing table spends it (spec §3.7).
  let landingSpeed = rider.speed
  for (; steps < 6000 && rider.airborne; steps++) {
    landingSpeed = rider.speed
    stepRider(rider, air, wind, DT)
    if (rider.altitude > peak) peak = rider.altitude
  }

  expect(rider.airborne).toBe(false)
  return { rider, peak, hangtime: steps * DT, impulse: rider.lastPop, launchSpeed, landingSpeed }
}

describe('load (spec §3.4)', () => {
  it('accumulates approximately nothing at zero speed', () => {
    // Zenith makes no drive, so the rider never leaves a standstill and there
    // is no edge to load against.
    const rider = createRiderState()
    const input = loadingAt(0)
    for (let i = 0; i < 600; i++) stepRider(rider, input, KT_12, DT)

    expect(rider.speed).toBeCloseTo(0, 10)
    expect(rider.load).toBeCloseTo(0, 10)
  })

  it('scales with speed, exactly as spec §3.4 writes it', () => {
    expect(loadRate(0)).toBe(0)
    expect(loadRate(TUNING.MAX_SPEED)).toBeCloseTo(TUNING.LOAD_RATE, 10)
    expect(loadRate(TUNING.MAX_SPEED / 2)).toBeCloseTo(TUNING.LOAD_RATE / 2, 10)
  })

  it('reaches 1.0 a little slower than 0.71s, because the carve scrubs what it builds against', () => {
    const rider = atFullSpeed()
    const input = loadingAt(70.53)

    let fullAt = -1
    let previous = rider.speed
    for (let i = 1; i <= 240 && fullAt < 0; i++) {
      stepRider(rider, input, KT_35, DT)
      // Even at the 35kt drive peak, where drive alone outruns drag and pins the
      // rider on the MAX_SPEED ceiling, the edge takes back more than it makes.
      expect(rider.speed).toBeLessThanOrEqual(previous)
      previous = rider.speed
      if (rider.load >= 1) fullAt = i
    }

    // 1/LOAD_RATE is the time it would take against a speed that never moved.
    // The carve is what puts the real number on the far side of it (spec §3.4).
    const ideal = 1 / TUNING.LOAD_RATE
    expect(fullAt).toBeGreaterThan(0)
    expect(fullAt * DT).toBeGreaterThan(ideal)
    expect(fullAt * DT).toBeLessThan(ideal * 1.2)
    expect(rider.speed).toBeLessThan(TUNING.MAX_SPEED)
  })

  it('caps at 1.0', () => {
    const rider = atFullSpeed()
    const input = loadingAt(70.53)

    // Short of the stall, so the cap is what is holding it and not the reset.
    const steps = Math.floor((1 / TUNING.LOAD_RATE + TUNING.STALL_GRACE) / DT)
    for (let i = 0; i < steps; i++) {
      stepRider(rider, input, KT_35, DT)
      expect(rider.load).toBeLessThanOrEqual(1)
    }

    expect(rider.load).toBe(1)
    expect(rider.popForfeit).toBe(false)
  })

  it('is spent by the release, whatever it was worth', () => {
    const rider = atFullSpeed()
    const holding = loadingAt(70.53)
    for (let i = 0; i < 20; i++) stepRider(rider, holding, KT_35, DT)
    expect(rider.load).toBeGreaterThan(0)

    stepRider(rider, inputAt(70.53), KT_35, DT)
    expect(rider.load).toBe(0)
  })

  it('does not build in the air', () => {
    const rider = parkedAt(0)
    rider.load = 1
    rider.loading = true
    stepRider(rider, inputAt(0), KT_12, DT)
    expect(rider.airborne).toBe(true)

    const input = loadingAt(0)
    for (let i = 0; i < 30 && rider.airborne; i++) {
      stepRider(rider, input, KT_12, DT)
      expect(rider.load).toBe(0)
    }
  })
})

describe('stall (spec §3.4)', () => {
  /** Holds the load for `steps` past the step the load went full. */
  function holdPastFull(steps: number) {
    const rider = atFullSpeed()
    const input = loadingAt(70.53)
    stepToFullLoad(rider, input, KT_35)
    for (let i = 0; i < steps; i++) stepRider(rider, input, KT_35, DT)
    return { rider, input }
  }

  it('does not fire while the hold is still inside the grace', () => {
    const inside = Math.floor(TUNING.STALL_GRACE / DT)
    const { rider } = holdPastFull(inside)

    expect(rider.overload).toBeLessThanOrEqual(TUNING.STALL_GRACE + 1e-9)
    expect(rider.load).toBe(1)
    // Off the ceiling: a full edge held past full load is still scrubbing.
    expect(rider.speed).toBeLessThan(TUNING.MAX_SPEED)
    expect(rider.popForfeit).toBe(false)
  })

  it('drops speed 40%, resets load and forfeits the pop past the grace', () => {
    const past = Math.floor(TUNING.STALL_GRACE / DT) + 1
    const inside = holdPastFull(past - 1).rider.speed
    const { rider, input } = holdPastFull(past)

    // The cut is 40% of the speed the carve left, not of MAX_SPEED, and the step
    // it fires on runs its own drive and carve first — so the observable ratio
    // sits just under STALL_SPEED_LOSS rather than exactly on it.
    const kept = rider.speed / inside
    expect(kept).toBeLessThan(1 - TUNING.STALL_SPEED_LOSS)
    expect(kept).toBeGreaterThan(1 - TUNING.STALL_SPEED_LOSS - 0.02)
    expect(rider.load).toBe(0)
    expect(rider.overload).toBe(0)
    expect(rider.popForfeit).toBe(true)

    // The forfeit survives holding on, and the release it finally gets is dead:
    // no impulse, no air, however good the kite position is.
    for (let i = 0; i < 30; i++) stepRider(rider, input, KT_35, DT)
    expect(rider.popForfeit).toBe(true)

    rider.kite.angle = 0
    stepRider(rider, inputAt(70.53), KT_35, DT)
    expect(rider.lastPop).toBe(0)
    expect(rider.airborne).toBe(false)
    expect(rider.vSpeed).toBe(0)
    expect(rider.popForfeit).toBe(false)
  })

  it('clears the forfeit on release, so the next hold pops normally', () => {
    const past = Math.floor(TUNING.STALL_GRACE / DT) + 1
    const { rider } = holdPastFull(past)

    stepRider(rider, inputAt(70.53), KT_35, DT) // dead release
    rider.load = 1
    rider.loading = true
    rider.kite.angle = 0
    stepRider(rider, inputAt(0), KT_35, DT)

    expect(rider.lastPop).toBeGreaterThan(0)
    expect(rider.airborne).toBe(true)
  })
})

describe('popImpulse (spec §3.5)', () => {
  it('is near zero on release at the edge of the window, however loaded', () => {
    expect(popImpulse(1, WINDOW_MAX, KT_12)).toBeCloseTo(0, 10)
    expect(popImpulse(1, WINDOW_MAX, KT_35)).toBeCloseTo(0, 10)
  })

  it('is zero with no load, however good the kite position', () => {
    expect(popImpulse(0, 0, KT_12)).toBe(0)
    expect(popImpulse(0, 0, KT_35)).toBe(0)
  })

  it('follows the spec formula below the flat-water ceiling', () => {
    // A small pop is nowhere near the cap, so it is the bare product.
    const expected = 0.05 * liftFactor(20) * TUNING.POP_K * windPower(KT_12)
    expect(popImpulse(0.05, 20, KT_12)).toBeCloseTo(expected, 3)
  })

  it('scales with the kicker bonus, which is what beats the flat cap', () => {
    const flat = popImpulse(1, 0, KT_12)
    expect(popImpulse(1, 0, KT_12, TUNING.BONUS_WAVE)).toBeCloseTo(flat * TUNING.BONUS_WAVE, 10)
    expect(peakHeight(popImpulse(1, 0, KT_12, TUNING.BONUS_WAKE))).toBeGreaterThan(
      TUNING.FLAT_POP_CAP,
    )
  })
})

describe('flat-water height (spec §3.5, §4.4)', () => {
  it('never exceeds FLAT_POP_CAP, at any wind, load or release angle', () => {
    for (let wind = KT_12; wind <= 40; wind += 0.5) {
      for (let theta = 0; theta <= WINDOW_MAX; theta += 1) {
        for (let load = 0; load <= 1; load += 0.1) {
          const height = peakHeight(popImpulse(load, theta, wind))
          expect(height).toBeLessThan(TUNING.FLAT_POP_CAP)
        }
      }
    }
  })

  it('never exceeds FLAT_POP_CAP in flight either, at any wind', () => {
    // The ceiling is on the pop (spec §3.5). Float is a separate term added
    // over the top of it in the air (§3.6), so it is measured with the kite
    // dropped out of the window, which is the only way to fly the pop alone.
    for (let wind = KT_12; wind <= 40; wind += 1) {
      expect(fly(1, 0, wind, WINDOW_MAX, true).peak).toBeLessThan(TUNING.FLAT_POP_CAP)
    }
  })

  it('is lifted over the ceiling only by float, and at tier 1 not past it', () => {
    // Holding the kite at zenith for the whole air is the only way to beat the
    // capped pop on flat water, and at the wind the game is tuned at it does
    // not get there: a wave, not a kite, is how you get real height (§4).
    //
    // Float scales with windPower, so the same hold at 35kt clears 8m. That is
    // unreachable today — windAt() is flat at tier 1 until the tier curve
    // lands — but it is the second half of the FLOAT_K conflict noted below.
    const held = fly(1, 0, KT_12, 0, true).peak
    const dropped = fly(1, 0, KT_12, WINDOW_MAX, true).peak

    expect(held).toBeGreaterThan(dropped)
    expect(held).toBeLessThan(TUNING.FLAT_POP_CAP)
  })

  it('rises with wind, and lands near the spec §4.4 flat-water ceilings', () => {
    const low = peakHeight(popImpulse(1, 0, KT_12))
    const high = peakHeight(popImpulse(1, 0, KT_35))
    expect(high).toBeGreaterThan(low)
    // Spec §4.4 wants ~2.5m flat at low wind and ~5m at high. The asymptotic
    // ceiling lands the low end on the nose and leaves the high end just short
    // of the cap it can never quite reach, which is the point of it.
    expect(low).toBeCloseTo(2.5, 0)
    expect(high).toBeGreaterThan(4)
    expect(high).toBeLessThan(TUNING.FLAT_POP_CAP)
  })

  it('is monotonically increasing in load, for a fixed release angle', () => {
    for (const theta of [0, 10, 25, 40]) {
      for (const wind of [KT_12, 20, KT_35]) {
        let previous = -1
        for (let load = 0; load <= 1 + 1e-9; load += 0.05) {
          const height = peakHeight(popImpulse(load, theta, wind))
          expect(height).toBeGreaterThan(previous)
          previous = height
        }
      }
    }
  })

  it('is monotonically increasing in load in flight too', () => {
    let previous = -1
    for (let load = 0.1; load <= 1 + 1e-9; load += 0.1) {
      const { peak } = fly(load, 0, KT_12)
      expect(peak).toBeGreaterThan(previous)
      previous = peak
    }
  })
})

describe('air (spec §3.6)', () => {
  it('carries the pop up and back to the water', () => {
    const rider = parkedAt(0)
    rider.load = 1
    rider.loading = true
    const input = inputAt(0)

    stepRider(rider, input, KT_12, DT)
    expect(rider.airborne).toBe(true)
    expect(rider.vSpeed).toBeCloseTo(popImpulse(1, 0, KT_12), 10)

    let steps = 0
    while (rider.airborne && steps < 6000) {
      stepRider(rider, input, KT_12, DT)
      expect(rider.altitude).toBeGreaterThanOrEqual(0)
      steps++
    }

    expect(rider.airborne).toBe(false)
    expect(rider.altitude).toBe(0)
    expect(rider.vSpeed).toBe(0)

    // Ballistic against gravity less the float the kite is making, which here
    // is a full FLOAT_K: the kite never left zenith.
    const net = TUNING.GRAVITY - floatAccel(0, KT_12)
    expect(steps * DT).toBeCloseTo((2 * popImpulse(1, 0, KT_12)) / net, 1)
  })

  it('adds lift as spec §3.6 writes it, and never enough to beat gravity', () => {
    for (let theta = 0; theta <= WINDOW_MAX; theta += 1) {
      for (const wind of [KT_12, KT_35]) {
        expect(floatAccel(theta, wind)).toBeCloseTo(
          liftFactor(theta) * TUNING.FLOAT_K * windPower(wind),
          10,
        )
        expect(floatAccel(theta, wind)).toBeLessThan(TUNING.GRAVITY)
      }
    }
  })

  it('makes no float at all with the kite at the edge of the window', () => {
    expect(floatAccel(WINDOW_MAX, KT_35)).toBeCloseTo(0, 10)
  })

  it('extends the air with the kite held up and cuts it short with the kite dropped', () => {
    // The gameplay claim of §3.6: the arc is steerable enough for clearing an
    // obstacle to be a real decision. Both airs are the same pop; the only
    // difference is where the thumb went afterwards.
    const held = fly(1, 0, KT_12, 0)
    const dropped = fly(1, 0, KT_12, WINDOW_MAX)

    expect(held.impulse).toBeCloseTo(dropped.impulse, 10)
    expect(held.hangtime).toBeGreaterThan(dropped.hangtime)
    expect(held.peak).toBeGreaterThan(dropped.peak)
  })

  /**
   * Spec §3.6 asks for a ~15% hangtime swing between a kite held at zenith and
   * one dropped immediately, and the answer depends on what "dropped
   * immediately" means. At FLOAT_K = 2.0 the two honest readings are:
   *
   *   kite teleported to the window edge   →  26.5% (this test)
   *   kite slewed there, as a thumb does   →  11.7% on a full-load tier-1 pop,
   *                                           rising toward 26.5% as the air
   *                                           gets longer and the ~1s of slew
   *                                           matters less
   *
   * So the spec's number now sits between them: FLOAT_K would have to be ~1.15
   * to land the teleported reading on 15% and ~2.34 to land the slewed one
   * there, and 2.0 is nearer the second. The conflict is no longer "the value
   * is wrong" but "the spec does not say which of the two it means", so this
   * stays marked rather than tuned to fit — the value is the human's.
   */
  it.fails('extends hangtime by 15% ±3% versus dropping the kite (spec §3.6)', () => {
    const held = fly(1, 0, KT_12, 0, true)
    const dropped = fly(1, 0, KT_12, WINDOW_MAX, true)
    const swing = held.hangtime / dropped.hangtime - 1

    expect(swing).toBeGreaterThan(0.12)
    expect(swing).toBeLessThan(0.18)
  })

  it('swings hangtime by the amount FLOAT_K currently buys, in the same direction', () => {
    // The characterisation half of the test above: the shape of the mechanic is
    // right and this pins the number, so tuning FLOAT_K is a visible change.
    // It has been: the band was 18–23% at FLOAT_K = 1.6 and is 24–29% at 2.0.
    const held = fly(1, 0, KT_12, 0, true)
    const dropped = fly(1, 0, KT_12, WINDOW_MAX, true)
    const swing = held.hangtime / dropped.hangtime - 1

    expect(swing).toBeGreaterThan(0.24)
    expect(swing).toBeLessThan(0.29)

    // The float is a hangtime modifier, not a second engine: the ideal
    // no-float flight is 2v/g and the held one is 2v over what is left of g.
    const ballistic = (2 * held.impulse) / TUNING.GRAVITY
    expect(dropped.hangtime).toBeCloseTo(ballistic, 1)
  })

  it('costs speed with the kite at 12 and gives it back with the kite low', () => {
    // The airborne trade of §3.6, on one pop flown three ways. Parking at zenith
    // buys the longest air and pays for it; the drive peak buys the shortest and
    // rides away on the speed it kept.
    const zenith = fly(1, 0, KT_12, 0, true)
    const middle = fly(1, 0, KT_12, 55, true)
    const low = fly(1, 0, KT_12, 70.53, true)

    expect(zenith.impulse).toBeCloseTo(low.impulse, 10)
    expect(zenith.launchSpeed).toBeCloseTo(low.launchSpeed, 10)

    // Monotonic in the kite angle: the lower the kite, the more speed survives.
    expect(zenith.landingSpeed).toBeLessThan(middle.landingSpeed)
    expect(middle.landingSpeed).toBeLessThan(low.landingSpeed)

    // And the hangtime runs the other way, which is what makes it a choice.
    expect(zenith.hangtime).toBeGreaterThan(middle.hangtime)
    expect(middle.hangtime).toBeGreaterThan(low.hangtime)
  })

  it('is the same balance as the water, weakened by AIR_DRIVE_MIX', () => {
    for (let theta = 0; theta <= WINDOW_MAX; theta += 1) {
      for (const wind of [KT_12, KT_35]) {
        for (const speed of [0, 8, TUNING.MAX_SPEED]) {
          expect(airAccel(theta, speed, wind)).toBeCloseTo(
            TUNING.AIR_DRIVE_MIX * driveAccel(theta, speed, wind),
            10,
          )
        }
      }
    }
  })

  it('only ever decelerates with the kite at 12 o\'clock, at any speed or wind', () => {
    expect(airAccel(0, 0, KT_35)).toBeCloseTo(0, 10)
    for (const speed of [1, 8, TUNING.MAX_SPEED]) {
      expect(airAccel(0, speed, KT_12)).toBeLessThan(0)
      expect(airAccel(0, speed, KT_35)).toBeLessThan(0)
    }
  })

  it('never carries the rider past the terminal speed of the angle being flown', () => {
    // The air is somewhere to spend speed or hold it, never a faster way to
    // travel: airAccel is a fraction of driveAccel, so it turns over at exactly
    // the speed the same kite position would settle at on the water.
    for (const wind of [KT_12, KT_35]) {
      for (const airTheta of [35, 55, 70.53, WINDOW_MAX]) {
        const rider = parkedAt(70.53)
        for (let i = 0; i < 900; i++) stepRider(rider, inputAt(70.53), wind, DT)

        rider.load = 1
        rider.loading = true
        rider.kite.angle = 0
        stepRider(rider, inputAt(0), wind, DT)
        expect(rider.airborne).toBe(true)

        const ceiling = Math.max(terminalSpeed(airTheta, wind), rider.speed)
        const input = inputAt(airTheta)
        while (rider.airborne) {
          rider.kite.angle = airTheta
          rider.kite.target = airTheta
          rider.kite.aim = airTheta
          stepRider(rider, input, wind, DT)
          if (rider.airborne) expect(rider.speed).toBeLessThanOrEqual(ceiling + 1e-9)
        }
      }
    }
  })
})

describe('carveDrag (spec §3.4)', () => {
  it('is quadratic in speed and linear in load', () => {
    expect(carveDrag(1, 10)).toBeCloseTo(TUNING.CARVE_DRAG_K * 100, 10)
    expect(carveDrag(1, 20)).toBeCloseTo(4 * carveDrag(1, 10), 10)
    expect(carveDrag(0.5, 10)).toBeCloseTo(carveDrag(1, 10) / 2, 10)
  })

  it('costs nothing before there is an edge to carve against', () => {
    expect(carveDrag(0, TUNING.MAX_SPEED)).toBe(0)
    expect(carveDrag(1, 0)).toBe(0)
  })

  it('scrubs speed while the load builds, and only while it is held', () => {
    // Two riders at the same cruise, one edging and one not. Same kite angle,
    // same wind — the only difference is the thumb on the load.
    const carving = parkedAt(70.53)
    const cruising = parkedAt(70.53)
    for (let i = 0; i < 900; i++) {
      stepRider(carving, inputAt(70.53), KT_12, DT)
      stepRider(cruising, inputAt(70.53), KT_12, DT)
    }
    const cruise = carving.speed

    for (let i = 0; i < 90; i++) {
      stepRider(carving, loadingAt(70.53), KT_12, DT)
      stepRider(cruising, inputAt(70.53), KT_12, DT)
    }

    expect(carving.load).toBeGreaterThan(0)
    expect(carving.speed).toBeLessThan(cruise)
    expect(carving.speed).toBeLessThan(cruising.speed)
    // The control rider is untouched: still on terminal, still going nowhere but
    // forward. Only the thumb on the load costs anything.
    expect(cruising.speed).toBeGreaterThanOrEqual(cruise)
    expect(cruising.speed).toBeCloseTo(terminalSpeed(70.53, KT_12), 2)

    // Letting the edge go puts the speed back: the scrub is the carve, not a
    // permanent tax on having carved.
    const scrubbed = carving.speed
    for (let i = 0; i < 300; i++) stepRider(carving, inputAt(70.53), KT_12, DT)
    expect(carving.speed).toBeGreaterThan(scrubbed)
    // Back on terminal, to within what quadratic drag has closed in 5 seconds.
    expect(carving.speed).toBeCloseTo(terminalSpeed(70.53, KT_12), 1)
  })

  it('settles the carve at the terminal speed of the heavier drag', () => {
    // A full edge doubles the drag term, so the equilibrium it holds is the
    // ordinary terminal over sqrt(1 + CARVE_DRAG_K/DRAG_K).
    const rider = parkedAt(70.53)
    rider.load = 1
    const input = loadingAt(70.53)
    for (let i = 0; i < 1800; i++) {
      // Pinned full: the equilibrium under test is the one a held edge holds.
      rider.load = 1
      rider.overload = 0
      stepRider(rider, input, KT_12, DT)
    }

    const expected =
      terminalSpeed(70.53, KT_12) / Math.sqrt(1 + TUNING.CARVE_DRAG_K / TUNING.DRAG_K)
    expect(rider.speed).toBeCloseTo(expected, 2)
  })
})

describe('landing table (spec §3.7)', () => {
  const [CLEAN_LO, CLEAN_HI] = TUNING.CLEAN_BAND
  const [SKETCHY_LO, SKETCHY_HI] = TUNING.SKETCHY_BAND

  // Both budgets at REF_APEX, where the clean one is SOFT_LAND exactly.
  const SOFT = descentBudget(TUNING.SOFT_LAND, REF_APEX)
  const HARD = descentBudget(TUNING.HARD_LAND, REF_APEX)

  /** Every row of the spec §3.7 table, plus the case the table leaves out. */
  const rows: [string, number, number, number][] = [
    // [name, kite angle at touchdown, descent rate, landingQuality] — all at REF_APEX
    ['clean, mid band and soft', 55, SOFT - 1, TUNING.CLEAN_QUALITY],
    ['clean, at the low edge of the band', CLEAN_LO, 0, TUNING.CLEAN_QUALITY],
    ['clean, at the high edge of the band', CLEAN_HI, SOFT - 0.1, TUNING.CLEAN_QUALITY],
    ['sketchy, in band but landed hard', 55, SOFT, TUNING.SKETCHY_QUALITY],
    ['sketchy, kite low of the clean band', SKETCHY_LO, 1, TUNING.SKETCHY_QUALITY],
    ['sketchy, kite past the clean band', SKETCHY_HI, 1, TUNING.SKETCHY_QUALITY],
    ['sketchy, just inside the sketchy budget', 55, HARD - 0.1, TUNING.SKETCHY_QUALITY],
    ['wipeout, kite still parked at zenith', 0, 1, 0],
    ['wipeout, kite just under the sketchy band', SKETCHY_LO - 0.1, 0, 0],
    ['wipeout, descent at the sketchy budget', 55, HARD, 0],
    ['wipeout, descent past the sketchy budget', 55, HARD + 10, 0],
    ['wipeout, kite dumped past the sketchy band', WINDOW_MAX, 0, 0],
  ]

  it.each(rows)('%s', (_name, theta, descent, expected) => {
    expect(landingQuality(theta, descent, REF_APEX)).toBe(expected)
  })

  /** Why each of those rows was not clean — same inputs, same order. */
  const reasons: [string, number, number, string][] = [
    // [name, kite angle at touchdown, descent rate, landingReason] — all at REF_APEX
    ['clean landings have no reason', 55, SOFT - 1, LAND_REASON.NONE],
    ['kite still up toward zenith', SKETCHY_LO, 1, LAND_REASON.KITE_HIGH],
    ['kite dumped out toward the edge', SKETCHY_HI, 1, LAND_REASON.KITE_LOW],
    ['in band, down too fast', 55, SOFT, LAND_REASON.HARD],
    ['a wipeout gets the same reason a sketchy landing would', 55, HARD + 10, LAND_REASON.HARD],
    ['the kite comes first when both missed', SKETCHY_LO, HARD + 10, LAND_REASON.KITE_HIGH],
  ]

  it.each(reasons)('%s', (_name, theta, descent, expected) => {
    expect(landingReason(theta, descent, REF_APEX)).toBe(expected)
  })

  it('gives a reason to exactly the landings that were not clean', () => {
    for (const theta of [0, SKETCHY_LO, CLEAN_LO, 55, CLEAN_HI, SKETCHY_HI, 90]) {
      for (const descent of [0, SOFT - 0.1, SOFT, HARD, HARD + 5]) {
        const clean = landingQuality(theta, descent, REF_APEX) === TUNING.CLEAN_QUALITY
        expect(landingReason(theta, descent, REF_APEX) === LAND_REASON.NONE).toBe(clean)
      }
    }
  })

  it('is SOFT_LAND itself on the air the constants are written for', () => {
    // LAND_FORGIVE blends between the flat threshold and the ballistic descent,
    // so where the two agree the blend has to return them both.
    expect(ballisticDescent(REF_APEX)).toBeCloseTo(TUNING.SOFT_LAND, 10)
    expect(descentBudget(TUNING.SOFT_LAND, REF_APEX)).toBeCloseTo(TUNING.SOFT_LAND, 10)

    const hardApex = TUNING.HARD_LAND ** 2 / (2 * TUNING.GRAVITY)
    expect(descentBudget(TUNING.HARD_LAND, hardApex)).toBeCloseTo(TUNING.HARD_LAND, 10)
  })

  it('lands at the speed it left, so a flat cap would be a height cap', () => {
    // The defect the budget exists to fix, stated as the test that would have
    // caught it: a ballistic air arrives at its launch impulse, so judging that
    // number against a constant is judging the height against a constant.
    for (const impulse of [4, 8, 12, 20]) {
      expect(ballisticDescent(peakHeight(impulse))).toBeCloseTo(impulse, 10)
    }
  })

  it('grows the budget with the air, but slower than the descent grows', () => {
    let previousBudget = 0
    let previousShare = Number.POSITIVE_INFINITY
    for (const apex of [1, 3, 8, 15, 30, 60]) {
      const budget = descentBudget(TUNING.SOFT_LAND, apex)
      // Absolutely more forgiving as the air gets bigger: nothing is barred by
      // size the way a flat SOFT_LAND barred everything over 3.3m.
      expect(budget).toBeGreaterThan(previousBudget)
      previousBudget = budget

      // But a shrinking share of the descent that apex makes unavoidable, so a
      // bigger send asks for more of the float on the way down.
      const share = budget / ballisticDescent(apex)
      expect(share).toBeLessThan(previousShare)
      previousShare = share
      expect(share).toBeGreaterThan(0)
    }
  })

  it('leaves the sketchy budget above the clean one at every apex', () => {
    for (let apex = 0.5; apex <= 60; apex += 0.5) {
      expect(descentBudget(TUNING.HARD_LAND, apex)).toBeGreaterThan(
        descentBudget(TUNING.SOFT_LAND, apex),
      )
    }
  })

  it('pays clean, sketchy and nothing, in that order', () => {
    expect(TUNING.CLEAN_QUALITY).toBeGreaterThan(TUNING.SKETCHY_QUALITY)
    expect(TUNING.SKETCHY_QUALITY).toBeGreaterThan(0)
  })

  it('is what the touchdown actually applies, for every row', () => {
    // The table above tests the function; this tests that the air ends by
    // running it on the kite angle and descent the flight really had.
    for (const [, theta, descent] of rows) {
      const rider = createRiderState()
      rider.airborne = true
      rider.altitude = 0.001
      rider.vSpeed = -descent
      rider.apex = REF_APEX
      rider.kite.angle = theta
      rider.kite.target = theta
      rider.kite.aim = theta

      stepRider(rider, inputAt(theta), KT_12, DT)

      expect(rider.airborne).toBe(false)
      expect(rider.landingQuality).toBe(landingQuality(theta, rider.descentRate, REF_APEX))
      expect(rider.landingReason).toBe(landingReason(theta, rider.descentRate, REF_APEX))
    }
  })
})

describe('landing a kicker air (spec §3.7, §4)', () => {
  /**
   * Flies an air of `impulse` — a pop off a kicker, which is how spec §4 says
   * the big ones happen — with the kite held at zenith for `holdFrac` of the
   * flight and then steered to `landTheta`. The kite slews at its own rate, so
   * a redirect asked for too late simply does not arrive.
   */
  function sendAndLand(impulse: number, wind: number, landTheta: number, holdFrac: number) {
    const rider = createRiderState()
    rider.speed = 15
    rider.airborne = true
    rider.vSpeed = impulse

    // The float-extended flight, which is what the redirect is timed against.
    const flight = (2 * impulse) / (TUNING.GRAVITY - floatAccel(0, wind))
    let t = 0
    while (rider.airborne && t < 30) {
      stepRider(rider, inputAt(t > flight * holdFrac ? landTheta : 0), wind, DT)
      t += DT
    }

    expect(rider.airborne).toBe(false)
    return rider
  }

  /** The best flat-water pop the wind allows, times a kicker bonus (spec §4.2). */
  function kickerImpulse(wind: number, bonus: number) {
    let best = 0
    for (let theta = 0; theta <= WINDOW_MAX; theta += 0.5) {
      const impulse = popImpulse(1, theta, wind, bonus)
      if (impulse > best) best = impulse
    }
    return best
  }

  it('lands the biggest air in the game clean, flown down on the float', () => {
    // A 35kt wake hit: the ×2.4 of spec §4.2 on the best pop 35kt allows. Under
    // a flat SOFT_LAND/HARD_LAND this air was not landable by anyone — it
    // arrives far past HARD_LAND however it is flown, so it was an automatic
    // wipeout and the biggest kicker in the game was a pure trap.
    const rider = sendAndLand(kickerImpulse(KT_35, TUNING.BONUS_WAKE), KT_35, 35, 0.9)

    expect(rider.apex).toBeGreaterThan(40)
    expect(rider.descentRate).toBeGreaterThan(TUNING.HARD_LAND)
    expect(rider.landingQuality).toBe(TUNING.CLEAN_QUALITY)
  })

  it('still wipes that air out for flying it down on a kite out of the lift', () => {
    // Same pop, same wind, flown down with the kite at 70deg instead of 35: the
    // float is spent going up instead of coming down, and the descent blows the
    // budget its own apex set. The size of the send is landable; flying it
    // badly is not.
    //
    // The kite is inside CLEAN_BAND at touchdown and the landing is still lost,
    // which is the point of `descentBudget`: what the table grades on an air
    // this size is not where the kite ended up but how much lift it was
    // carrying on the way down (`liftFactor` is 0.74 at 35deg and 0.20 at 70).
    const rider = sendAndLand(kickerImpulse(KT_35, TUNING.BONUS_WAKE), KT_35, 70, 0.6)

    expect(rider.apex).toBeGreaterThan(40)
    expect(rider.kite.angle).toBeLessThan(TUNING.CLEAN_BAND[1])
    expect(rider.landingReason).toBe(LAND_REASON.HARD)
    expect(rider.landingQuality).toBe(0)
    expect(rider.phase).toBe(PHASE.WIPEOUT)
  })

  const KICKERS: [string, number][] = [
    ['flat', 1],
    ['chop', TUNING.BONUS_CHOP],
    ['wave', TUNING.BONUS_WAVE],
    ['wake', TUNING.BONUS_WAKE],
  ]

  /** The best and worst verdict over a spread of ways to fly the same pop. */
  function spread(wind: number, bonus: number) {
    const impulse = kickerImpulse(wind, bonus)
    let best = 0
    let worst = 1
    for (const landTheta of [35, 45, 55, 70]) {
      for (const holdFrac of [0, 0.3, 0.6, 0.9]) {
        const quality = sendAndLand(impulse, wind, landTheta, holdFrac).landingQuality
        if (quality > best) best = quality
        if (quality < worst) worst = quality
      }
    }
    return { best, worst }
  }

  it('leaves every kicker at every tier landable', () => {
    // The claim the budget exists to make good on: some way of flying it scores,
    // at every kicker and every wind. The height cap the flat gate hid inside
    // the landing table is gone, and §4's "every record jump comes off a wave
    // face" is a strategy rather than a trap.
    for (const wind of [KT_12, 20, KT_35]) {
      for (const [, bonus] of KICKERS) {
        expect(spread(wind, bonus).best).toBeGreaterThan(0)
      }
    }
  })

  it('makes none of them free', () => {
    // Every kicker at every tier has a way of being flown that scores less than
    // its best — the flip side of the test above, and together they say that
    // the verdict is earned rather than handed out.
    //
    // This had one exception at FLOAT_K = 1.6: a 7m air at 12kt was sketchy
    // however it was flown, because the redirect that would buy the descent
    // budget could not also reach CLEAN_BAND inside so short an air. The
    // exception was pinned here "so tuning that opens it up says so", and
    // FLOAT_K = 2.0 opened it up — a 12kt wave hit now has a clean line in it.
    for (const wind of [KT_12, 20, KT_35]) {
      for (const [name, bonus] of KICKERS) {
        const { best, worst } = spread(wind, bonus)
        expect(worst, `${wind}kt ${name}`).toBeLessThan(best)
      }
    }
  })

  it('leaves the biggest kicker at tier 1 landable, and never nailable', () => {
    // Where the bind went instead. The clean budget grows like apex^0.425 and
    // the descent it is measured against like apex^0.5, so every larger send
    // asks for more of the float to be kept for the way down — and a boat wake
    // taken at 12kt is a bigger send than 12kt has the float to fly down.
    //
    // Which is the right shape for it. At tier 1 the biggest kicker in the game
    // is something to be got away with; taking the same wake to tier 4, where
    // there is nearly three times the float in the descent, is what turns it
    // into something to be nailed (§4.4, §7.1).
    const { best, worst } = spread(KT_12, TUNING.BONUS_WAKE)

    expect(best).toBe(TUNING.SKETCHY_QUALITY)
    expect(worst).toBe(0)
    expect(spread(KT_35, TUNING.BONUS_WAKE).best).toBe(TUNING.CLEAN_QUALITY)
  })
})

/**
 * Lands a rider from a standing pop with the kite redirected to `airTheta`,
 * forced onto the water at `descent` m/s so every row of the table is
 * reachable without having to find a flight that produces it.
 */
function land(theta: number, descent: number, speed = 10, apex = REF_APEX) {
  const rider = parkedAt(theta)
  rider.speed = speed
  rider.airborne = true
  rider.altitude = 0.001
  rider.vSpeed = -descent
  // The descent is judged against the air it came off (spec §3.7), and this
  // touchdown is synthesized rather than flown, so it is given one.
  rider.apex = apex

  stepRider(rider, inputAt(theta), KT_12, DT)
  return rider
}

describe('landing consequences (spec §3.7, §7.2)', () => {
  it('leaves a clean landing riding at full speed', () => {
    const rider = land(55, 2, 10)

    expect(rider.landingQuality).toBe(TUNING.CLEAN_QUALITY)
    expect(rider.phase).toBe(PHASE.LANDING)
    // A clean landing takes nothing — the only thing between 10 m/s and the
    // touchdown is the one step of air the helper flies (spec §3.6).
    expect(rider.speed).toBeCloseTo(10 + airAccel(55, 10, KT_12) * DT, 6)
  })

  it('takes SKETCHY_SPEED_LOSS off a sketchy one, and keeps the rider riding', () => {
    const rider = land(SKETCHY_ANGLE, 2, 10)

    const entry = 10 + airAccel(SKETCHY_ANGLE, 10, KT_12) * DT
    expect(rider.landingQuality).toBe(TUNING.SKETCHY_QUALITY)
    expect(rider.phase).toBe(PHASE.LANDING)
    expect(rider.speed).toBeCloseTo(entry * (1 - TUNING.SKETCHY_SPEED_LOSS), 6)
  })

  it('takes all the speed on a wipeout (spec §7.2)', () => {
    const rider = land(0, 2, 10)

    expect(rider.landingQuality).toBe(0)
    expect(rider.phase).toBe(PHASE.WIPEOUT)
    expect(rider.speed).toBe(0)
    expect(rider.load).toBe(0)
  })

  /**
   * Steers a downed kite at `target` degrees until it flies again, and reports
   * how long the relaunch took. Everything is asserted from inside the beat:
   * the kite is in the water, so there is no drive to be had, no edge to load
   * and no ground covered, however hard the player holds the input.
   */
  function relaunch(rider: RiderState, target: number, cap = 600) {
    const held = loadingAt(target)
    let steps = 0

    while (rider.phase === PHASE.WIPEOUT && steps < cap) {
      expect(rider.speed).toBe(0)
      expect(rider.load).toBe(0)
      expect(rider.x).toBe(0)
      stepRider(rider, held, KT_12, DT)
      steps++
    }

    return steps * DT
  }

  it('holds the rider still through the relaunch beat, then rides again', () => {
    // Spec §7.2: the kite is down in the water, the player steers it back to
    // the edge of the window, and the whole beat is about two seconds. The
    // wipeout below parks it at zenith — the far end of the window and the
    // longest drag the game can ask for — so this is the slow case.
    const rider = land(0, 2, 10)
    const beat = relaunch(rider, WINDOW_MAX)

    expect(beat).toBeGreaterThanOrEqual(TUNING.WIPEOUT_RECOVER)
    expect(beat).toBeLessThan(TUNING.WIPEOUT_RECOVER + 0.5)
    expect(rider.phase).toBe(PHASE.LOADING)
    expect(rider.kite.angle).toBeGreaterThanOrEqual(TUNING.RELAUNCH_ANGLE)

    for (let i = 0; i < 60; i++) stepRider(rider, loadingAt(WINDOW_MAX), KT_12, DT)
    expect(rider.speed).toBeGreaterThan(0)
  })

  it('leaves the kite in the water until it is steered out to the edge', () => {
    // The mild skill check of §7.2. A player who never takes the kite out to
    // the window edge never gets it flying, and the timer alone does not hand
    // it back: ten seconds of holding the kite mid-window is ten seconds down.
    const rider = land(0, 2, 10)
    const stuck = relaunch(rider, TUNING.RELAUNCH_ANGLE - 10)

    expect(stuck).toBe(10)
    expect(rider.phase).toBe(PHASE.WIPEOUT)
    expect(rider.recover).toBe(0)

    // And it is the kite that was missing, not the time: taking it out to the
    // edge from here relaunches on the drag alone.
    const rest = relaunch(rider, WINDOW_MAX)
    expect(rest).toBeGreaterThan(0)
    expect(rest).toBeLessThan(TUNING.WIPEOUT_RECOVER)
    expect(rider.phase).toBe(PHASE.LOADING)
  })

  it('drags the kite back at RELAUNCH_SLEW of the rate it flies at', () => {
    // A kite being pulled through water is not a kite being flown, and the
    // difference is what makes the beat cost anything at all.
    const rider = land(0, 2, 10)
    const before = rider.kite.angle

    stepRider(rider, loadingAt(WINDOW_MAX), KT_12, DT)
    expect(rider.phase).toBe(PHASE.WIPEOUT)
    expect(rider.kite.angle - before).toBeCloseTo(
      slewRate(KT_12) * TUNING.RELAUNCH_SLEW * DT,
      10,
    )
  })

  it('records the descent rate the landing was judged on', () => {
    // One step of gravity, less the float the kite was still making, separates
    // the drop it was set falling at from the rate it arrived at — and it is
    // the arrival rate the table reads.
    const rider = land(55, 6.5)
    const net = TUNING.GRAVITY - floatAccel(55, KT_12)
    expect(rider.descentRate).toBeCloseTo(6.5 + net * DT, 6)
  })

  it('keeps the apex of the air it just finished', () => {
    const flight = fly(1, 0, KT_12, 45)
    expect(flight.rider.apex).toBeCloseTo(flight.peak, 10)
    expect(flight.rider.airTime).toBeCloseTo(flight.hangtime, 6)
  })
})

describe('phase machine (spec §3.7)', () => {
  it('starts on the water, riding', () => {
    const rider = createRiderState()
    expect(rider.phase).toBe(PHASE.RIDING)
    expect(rider.altitude).toBe(0)
    expect(rider.landings).toBe(0)
  })

  it('walks RIDING → LOADING → AIRBORNE → LANDING → RIDING', () => {
    const rider = atFullSpeed()
    const seen: string[] = []
    const record = () => {
      if (seen[seen.length - 1] !== rider.phase) seen.push(rider.phase)
    }

    stepRider(rider, inputAt(70.53), KT_35, DT)
    record()

    // Edge and sweep the kite to zenith.
    for (let i = 0; i < 20; i++) {
      stepRider(rider, loadingAt(0), KT_35, DT)
      record()
    }

    // Release: the pop. Then redirect back toward the direction of travel and
    // ride the air out.
    const air = inputAt(50)
    stepRider(rider, air, KT_35, DT)
    record()
    expect(rider.airborne).toBe(true)

    while (rider.airborne) {
      stepRider(rider, air, KT_35, DT)
      record()
    }

    // Then let the landing beat run out.
    for (let i = 0; i < 60; i++) {
      stepRider(rider, air, KT_35, DT)
      record()
    }

    expect(seen).toEqual([PHASE.RIDING, PHASE.LOADING, PHASE.AIRBORNE, PHASE.LANDING, PHASE.RIDING])
  })

  it('goes to WIPEOUT rather than LANDING when the table pays nothing', () => {
    const rider = land(0, 2)
    expect(rider.phase).toBe(PHASE.WIPEOUT)
    expect(rider.landingQuality).toBe(0)
  })

  it('reads the load input while the rider is on the water', () => {
    // Two riders rather than one released mid-test: a release is a pop, and a
    // pop is the AIRBORNE transition rather than a return to RIDING.
    const held = createRiderState()
    const free = createRiderState()

    for (let i = 0; i < 30; i++) {
      stepRider(held, loadingAt(50), KT_12, DT)
      stepRider(free, inputAt(50), KT_12, DT)
    }

    expect(held.phase).toBe(PHASE.LOADING)
    expect(free.phase).toBe(PHASE.RIDING)
  })

  it('enters a landing exactly once per air, never twice', () => {
    const rider = atFullSpeed()
    const air = inputAt(50)

    for (let jump = 1; jump <= 3; jump++) {
      // Ride up to speed, edge, send, release.
      for (let i = 0; i < 240; i++) stepRider(rider, inputAt(70.53), KT_35, DT)
      for (let i = 0; i < 20; i++) stepRider(rider, loadingAt(0), KT_35, DT)
      stepRider(rider, air, KT_35, DT)
      expect(rider.airborne).toBe(true)
      expect(rider.landings).toBe(jump - 1)

      let landedOn = -1
      let steps = 0
      while (rider.airborne) {
        stepRider(rider, air, KT_35, DT)
        if (rider.landings === jump && landedOn < 0) landedOn = steps
        steps++
      }

      // One step of the air raised it, and no step after that moves it again.
      expect(rider.landings).toBe(jump)
      expect(landedOn).toBe(steps - 1)

      for (let i = 0; i < 300; i++) {
        stepRider(rider, air, KT_35, DT)
        expect(rider.landings).toBe(jump)
      }
    }
  })

  it('does not re-land a rider sitting on the water', () => {
    const rider = land(55, 2)
    expect(rider.landings).toBe(1)

    for (let i = 0; i < 600; i++) stepRider(rider, inputAt(55), KT_12, DT)
    expect(rider.landings).toBe(1)
  })

  it('cancels a landing beat that is interrupted by another pop', () => {
    const rider = land(55, 2)
    expect(rider.phase).toBe(PHASE.LANDING)

    rider.load = 1
    rider.loading = true
    rider.kite.angle = 0
    stepRider(rider, inputAt(0), KT_12, DT)

    expect(rider.phase).toBe(PHASE.AIRBORNE)
    expect(rider.recover).toBe(0)
  })
})


describe('steering (spec §5.2)', () => {
  it('is live whether the load input is held or not', () => {
    const held = createRiderState()
    const free = createRiderState()

    for (let i = 0; i < 60; i++) {
      stepRider(held, loadingAt(WINDOW_MAX), KT_12, DT)
      stepRider(free, inputAt(WINDOW_MAX), KT_12, DT)
    }

    expect(held.kite.angle).toBeCloseTo(WINDOW_MAX, 6)
    expect(held.kite.angle).toBeCloseTo(free.kite.angle, 10)
  })

  it('keeps steering through a stall, and through the air', () => {
    const rider = atFullSpeed()
    const input = loadingAt(70.53)
    stepToFullLoad(rider, input, KT_35)
    const grace = Math.floor(TUNING.STALL_GRACE / DT) + 1
    for (let i = 0; i < grace; i++) stepRider(rider, input, KT_35, DT)
    expect(rider.popForfeit).toBe(true)

    const zenith = loadingAt(0)
    for (let i = 0; i < 60; i++) stepRider(rider, zenith, KT_35, DT)
    expect(rider.kite.angle).toBeCloseTo(0, 6)

    // The forfeit costs this release; the next one is live.
    stepRider(rider, inputAt(0), KT_35, DT)
    rider.load = 1
    rider.loading = true
    stepRider(rider, inputAt(0), KT_35, DT)
    expect(rider.airborne).toBe(true)

    const edge = inputAt(WINDOW_MAX)
    for (let i = 0; i < 30 && rider.airborne; i++) stepRider(rider, edge, KT_35, DT)
    expect(rider.kite.angle).toBeGreaterThan(0)
  })
})
