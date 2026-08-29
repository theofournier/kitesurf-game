import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning.ts'
import { WINDOW_MAX, driveFactor, liftFactor, windPower } from '../src/sim/kite.ts'
import { DT, createInput } from '../src/sim/loop.ts'
import {
  PHASE,
  createRiderState,
  drag,
  driveAccel,
  floatAccel,
  landingQuality,
  loadRate,
  peakHeight,
  popImpulse,
  stepRider,
  terminalSpeed,
} from '../src/sim/rider.ts'

const KT_12 = 12
const KT_35 = 35

/** A kite angle inside the sketchy band but outside the clean one (spec §3.7). */
const SKETCHY_ANGLE = 25

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

  let peak = 0
  let steps = 0
  for (; steps < 6000 && rider.airborne; steps++) {
    stepRider(rider, air, wind, DT)
    if (rider.altitude > peak) peak = rider.altitude
  }

  expect(rider.airborne).toBe(false)
  return { rider, peak, hangtime: steps * DT, impulse: rider.lastPop }
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

  it('reaches 1.0 in ~0.71s at MAX_SPEED', () => {
    const rider = atFullSpeed()
    const input = loadingAt(70.53)

    let fullAt = -1
    for (let i = 1; i <= 120 && fullAt < 0; i++) {
      stepRider(rider, input, KT_35, DT)
      // The 35kt drive at the peak outruns drag, so the ceiling holds the
      // rider at exactly MAX_SPEED and the load builds at exactly LOAD_RATE.
      expect(rider.speed).toBe(TUNING.MAX_SPEED)
      if (rider.load >= 1) fullAt = i
    }

    const expected = 1 / TUNING.LOAD_RATE
    expect(fullAt * DT).toBeCloseTo(expected, 2)
    // Within the step the fixed timestep can resolve, and never early.
    expect(fullAt * DT).toBeGreaterThanOrEqual(expected)
    expect((fullAt - 1) * DT).toBeLessThan(expected)
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
  const fullAt = Math.ceil(1 / TUNING.LOAD_RATE / DT)

  /** Holds the load for `steps` past the step the load went full. */
  function holdPastFull(steps: number) {
    const rider = atFullSpeed()
    const input = loadingAt(70.53)
    for (let i = 0; i < fullAt + steps; i++) stepRider(rider, input, KT_35, DT)
    return { rider, input }
  }

  it('does not fire while the hold is still inside the grace', () => {
    const inside = Math.floor(TUNING.STALL_GRACE / DT)
    const { rider } = holdPastFull(inside)

    expect(rider.overload).toBeLessThanOrEqual(TUNING.STALL_GRACE + 1e-9)
    expect(rider.load).toBe(1)
    expect(rider.speed).toBe(TUNING.MAX_SPEED)
    expect(rider.popForfeit).toBe(false)
  })

  it('drops speed 40%, resets load and forfeits the pop past the grace', () => {
    const past = Math.floor(TUNING.STALL_GRACE / DT) + 1
    const { rider, input } = holdPastFull(past)

    expect(rider.speed).toBeCloseTo(TUNING.MAX_SPEED * (1 - TUNING.STALL_SPEED_LOSS), 6)
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
   * one dropped immediately. FLOAT_K = 1.6 does not produce that number under
   * either honest reading of "dropped immediately":
   *
   *   kite teleported to the window edge   →  20.5% (this test)
   *   kite slewed there, as a thumb does   →   8.7% on a full-load tier-1 pop,
   *                                            rising toward 20.5% as the air
   *                                            gets longer and the ~1s of slew
   *                                            matters less
   *
   * FLOAT_K would have to be ~1.28 to land the first reading on 15%. The value
   * is the human's, so this stays marked as a known conflict rather than being
   * tuned to fit — see the session-5 report.
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
    const held = fly(1, 0, KT_12, 0, true)
    const dropped = fly(1, 0, KT_12, WINDOW_MAX, true)
    const swing = held.hangtime / dropped.hangtime - 1

    expect(swing).toBeGreaterThan(0.18)
    expect(swing).toBeLessThan(0.23)

    // The float is a hangtime modifier, not a second engine: the ideal
    // no-float flight is 2v/g and the held one is 2v over what is left of g.
    const ballistic = (2 * held.impulse) / TUNING.GRAVITY
    expect(dropped.hangtime).toBeCloseTo(ballistic, 1)
  })

  it('never accelerates the rider horizontally, at any kite angle', () => {
    // Speed is built with the kite low and the input free — a long hold would
    // stall long before the rider got up to speed, and forfeit the pop.
    const rider = parkedAt(70)
    const fast = inputAt(70)
    for (let i = 0; i < 600; i++) stepRider(rider, fast, KT_12, DT)

    rider.load = 1
    rider.loading = true
    rider.kite.angle = 0
    stepRider(rider, inputAt(0), KT_12, DT)
    expect(rider.airborne).toBe(true)

    // Sweep the kite across the whole window during the air. Nowhere in it —
    // least of all the drive peak — is there any acceleration to be had.
    const launch = rider.speed
    let steps = 0
    while (rider.airborne) {
      const theta = (steps * WINDOW_MAX * 2) / 60 // a full sweep out and back
      stepRider(rider, inputAt(theta % WINDOW_MAX), KT_12, DT)
      if (rider.airborne) expect(rider.speed).toBe(launch)
      steps++
    }
  })

  it('holds the speed it left the water with, whatever the wind', () => {
    for (const wind of [KT_12, KT_35]) {
      const rider = parkedAt(50)
      for (let i = 0; i < 600; i++) stepRider(rider, inputAt(50), wind, DT)

      rider.load = 1
      rider.loading = true
      rider.kite.angle = 0
      stepRider(rider, inputAt(0), wind, DT)

      const launch = rider.speed
      const input = inputAt(TUNING.CLEAN_BAND[0] + 5)
      while (rider.airborne) {
        stepRider(rider, input, wind, DT)
        if (rider.airborne) expect(rider.speed).toBe(launch)
      }
    }
  })
})

describe('landing table (spec §3.7)', () => {
  const [CLEAN_LO, CLEAN_HI] = TUNING.CLEAN_BAND
  const [SKETCHY_LO, SKETCHY_HI] = TUNING.SKETCHY_BAND

  /** Every row of the spec §3.7 table, plus the case the table leaves out. */
  const rows: [string, number, number, number][] = [
    // [name, kite angle at touchdown, descent rate, landingQuality]
    ['clean, mid band and soft', 55, TUNING.SOFT_LAND - 1, TUNING.CLEAN_QUALITY],
    ['clean, at the low edge of the band', CLEAN_LO, 0, TUNING.CLEAN_QUALITY],
    ['clean, at the high edge of the band', CLEAN_HI, TUNING.SOFT_LAND - 0.1, TUNING.CLEAN_QUALITY],
    ['sketchy, in band but landed hard', 55, TUNING.SOFT_LAND, TUNING.SKETCHY_QUALITY],
    ['sketchy, kite low of the clean band', SKETCHY_LO, 1, TUNING.SKETCHY_QUALITY],
    ['sketchy, kite past the clean band', SKETCHY_HI, 1, TUNING.SKETCHY_QUALITY],
    ['sketchy, just inside HARD_LAND', 55, TUNING.HARD_LAND - 0.1, TUNING.SKETCHY_QUALITY],
    ['wipeout, kite still parked at zenith', 0, 1, 0],
    ['wipeout, kite just under the sketchy band', SKETCHY_LO - 0.1, 0, 0],
    ['wipeout, descent at HARD_LAND', 55, TUNING.HARD_LAND, 0],
    ['wipeout, descent past HARD_LAND', 55, TUNING.HARD_LAND + 10, 0],
    ['wipeout, kite dumped past the sketchy band', WINDOW_MAX, 0, 0],
  ]

  it.each(rows)('%s', (_name, theta, descent, expected) => {
    expect(landingQuality(theta, descent)).toBe(expected)
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
      rider.kite.angle = theta
      rider.kite.target = theta
      rider.kite.aim = theta

      stepRider(rider, inputAt(theta), KT_12, DT)

      expect(rider.airborne).toBe(false)
      expect(rider.landingQuality).toBe(landingQuality(theta, rider.descentRate))
    }
  })
})

/**
 * Lands a rider from a standing pop with the kite redirected to `airTheta`,
 * forced onto the water at `descent` m/s so every row of the table is
 * reachable without having to find a flight that produces it.
 */
function land(theta: number, descent: number, speed = 10) {
  const rider = parkedAt(theta)
  rider.speed = speed
  rider.airborne = true
  rider.altitude = 0.001
  rider.vSpeed = -descent

  stepRider(rider, inputAt(theta), KT_12, DT)
  return rider
}

describe('landing consequences (spec §3.7, §7.2)', () => {
  it('leaves a clean landing riding at full speed', () => {
    const rider = land(55, 2, 10)

    expect(rider.landingQuality).toBe(TUNING.CLEAN_QUALITY)
    expect(rider.phase).toBe(PHASE.LANDING)
    expect(rider.speed).toBeCloseTo(10, 6)
  })

  it('takes SKETCHY_SPEED_LOSS off a sketchy one, and keeps the rider riding', () => {
    const rider = land(SKETCHY_ANGLE, 2, 10)

    expect(rider.landingQuality).toBe(TUNING.SKETCHY_QUALITY)
    expect(rider.phase).toBe(PHASE.LANDING)
    expect(rider.speed).toBeCloseTo(10 * (1 - TUNING.SKETCHY_SPEED_LOSS), 6)
  })

  it('takes all the speed on a wipeout (spec §7.2)', () => {
    const rider = land(0, 2, 10)

    expect(rider.landingQuality).toBe(0)
    expect(rider.phase).toBe(PHASE.WIPEOUT)
    expect(rider.speed).toBe(0)
    expect(rider.load).toBe(0)
  })

  it('holds the rider still through the relaunch beat, then rides again', () => {
    const rider = land(0, 2, 10)
    const held = loadingAt(50)

    // The kite is in the water: no drive to be had and no edge to load, for as
    // long as the beat lasts.
    let steps = 0
    while (rider.phase === PHASE.WIPEOUT && steps < 600) {
      expect(rider.speed).toBe(0)
      expect(rider.load).toBe(0)
      expect(rider.x).toBe(0)
      stepRider(rider, held, KT_12, DT)
      steps++
    }

    expect(steps * DT).toBeCloseTo(TUNING.WIPEOUT_RECOVER, 1)
    expect(rider.phase).toBe(PHASE.LOADING)

    for (let i = 0; i < 60; i++) stepRider(rider, held, KT_12, DT)
    expect(rider.speed).toBeGreaterThan(0)
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
    const steps = Math.ceil(1 / TUNING.LOAD_RATE / DT) + Math.floor(TUNING.STALL_GRACE / DT) + 1
    for (let i = 0; i < steps; i++) stepRider(rider, input, KT_35, DT)
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
