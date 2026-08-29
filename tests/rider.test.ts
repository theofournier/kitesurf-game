import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning.ts'
import { WINDOW_MAX, driveFactor, windPower } from '../src/sim/kite.ts'
import { DT, createInput } from '../src/sim/loop.ts'
import {
  createRiderState,
  drag,
  driveAccel,
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
