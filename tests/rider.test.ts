import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning.ts'
import { WINDOW_MAX, driveFactor, liftFactor, windPower } from '../src/sim/kite.ts'
import { DT, createInput } from '../src/sim/loop.ts'
import {
  createRiderState,
  drag,
  driveAccel,
  loadRate,
  peakHeight,
  popImpulse,
  stepRider,
  terminalSpeed,
} from '../src/sim/rider.ts'

const KT_12 = 12
const KT_35 = 35

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
 * Pops a rider carrying `load` with the kite parked at `theta`, then flies it
 * to touchdown. Returns the apex reached and the impulse that produced it.
 */
function fly(load: number, theta: number, wind: number) {
  const rider = parkedAt(theta)
  rider.load = load
  rider.loading = true

  const input = inputAt(theta)
  stepRider(rider, input, wind, DT) // input.loading is false: the release edge

  let peak = 0
  for (let i = 0; i < 6000 && rider.airborne; i++) {
    stepRider(rider, input, wind, DT)
    if (rider.altitude > peak) peak = rider.altitude
  }

  expect(rider.airborne).toBe(false)
  return { peak, impulse: rider.lastPop }
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
    for (let wind = KT_12; wind <= 40; wind += 1) {
      expect(fly(1, 0, wind).peak).toBeLessThan(TUNING.FLAT_POP_CAP)
    }
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

describe('air (spec §3.6, in outline until session 5)', () => {
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
    // Ballistic: up and down again in 2v/g.
    expect(steps * DT).toBeCloseTo((2 * popImpulse(1, 0, KT_12)) / TUNING.GRAVITY, 1)
  })

  it('never accelerates the rider horizontally in the air', () => {
    // Speed is built with the kite low and the input free — a long hold would
    // stall long before the rider got up to speed, and forfeit the pop.
    const rider = parkedAt(70)
    const fast = inputAt(70)
    for (let i = 0; i < 600; i++) stepRider(rider, fast, KT_12, DT)

    rider.load = 1
    rider.loading = true
    rider.kite.angle = 0
    const input = inputAt(0)
    stepRider(rider, input, KT_12, DT)
    expect(rider.airborne).toBe(true)

    const launch = rider.speed
    while (rider.airborne) {
      stepRider(rider, input, KT_12, DT)
      expect(rider.speed).toBe(launch)
    }
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
