import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning.ts'
import {
  WINDOW_MAX,
  WINDOW_MIN,
  createKiteState,
  driveFactor,
  liftFactor,
  slewRate,
  stepKite,
  targetFromInput,
  windPower,
} from '../src/sim/kite.ts'
import { DT } from '../src/sim/loop.ts'
import { Rng } from '../src/sim/rng.ts'

/** Runs the kite at a fixed target for `seconds`, returning the frame count. */
function hold(kite: ReturnType<typeof createKiteState>, target: number, wind: number, seconds: number): number {
  const frames = Math.round(seconds / DT)
  for (let i = 0; i < frames; i++) stepKite(kite, target, wind, DT)
  return frames
}

/** Frames until the kite first reaches `angle`, or -1 within the budget. */
function framesToReach(target: number, wind: number, angle: number, budget: number): number {
  const kite = createKiteState()
  for (let i = 1; i <= budget; i++) {
    stepKite(kite, target, wind, DT)
    if (kite.angle >= angle - 1e-9) return i
  }
  return -1
}

/** Peak of driveFactor, scanned at 0.01deg resolution. */
function drivePeakDeg(): number {
  let best = 0
  let bestAt = 0
  for (let deg = 0; deg <= 9000; deg++) {
    const v = driveFactor(deg / 100)
    if (v > best) {
      best = v
      bestAt = deg / 100
    }
  }
  return bestAt
}

const KT_12 = 12
const KT_35 = 35

describe('slewRate', () => {
  it('is BASE_SLEW at tier 1', () => {
    expect(slewRate(KT_12)).toBeCloseTo(TUNING.BASE_SLEW, 10)
  })

  it('is approximately 145 deg/s at 35kt', () => {
    // 90 * (1 + 23/40) = 141.75, which is the "~145 deg/s" of spec §3.2.
    expect(Math.abs(slewRate(KT_35) - 145)).toBeLessThan(5)
  })
})

describe('windPower', () => {
  it('is 1 at tier 1 and scales linearly above it', () => {
    expect(windPower(KT_12)).toBeCloseTo(1, 10)
    expect(windPower(KT_35)).toBeCloseTo(35 / 12, 10)
  })
})

describe('stepKite slew', () => {
  it('travels 0 -> 90 at 12kt in 1.0s, within one frame', () => {
    const frames = framesToReach(WINDOW_MAX, KT_12, WINDOW_MAX, 240)
    expect(frames).toBeGreaterThan(0)
    expect(Math.abs(frames - 60)).toBeLessThanOrEqual(1)
  })

  it('travels the same sweep faster at 35kt', () => {
    const fast = framesToReach(WINDOW_MAX, KT_35, WINDOW_MAX, 240)
    expect(fast).toBeGreaterThan(0)
    expect(fast).toBeLessThan(60)
  })

  it('does not snap: one step moves at most slewRate * dt', () => {
    const kite = createKiteState()
    stepKite(kite, WINDOW_MAX, KT_12, DT)
    expect(kite.angle).toBeCloseTo(slewRate(KT_12) * DT, 10)
  })

  it('settles exactly on the target and stays there', () => {
    const kite = createKiteState()
    hold(kite, 40, KT_12, 3)
    expect(kite.angle).toBe(40)
    expect(kite.settle).toBe(0)
  })
})

describe('stepKite overshoot', () => {
  it('carries OVERSHOOT_DEG past the target on a sweep over OVERSHOOT_MIN_SWEEP', () => {
    const kite = createKiteState()
    const target = 70 // a 70deg sweep from zenith
    let peak = 0

    for (let i = 0; i < 180; i++) {
      stepKite(kite, target, KT_12, DT)
      if (kite.angle > peak) peak = kite.angle
    }

    expect(peak).toBeCloseTo(target + TUNING.OVERSHOOT_DEG, 6)
  })

  it('settles back onto the target within OVERSHOOT_SETTLE', () => {
    const kite = createKiteState()
    const target = 70

    // Reach the top of the overshoot.
    let frames = 0
    while (!(kite.settle > 0) && frames < 240) {
      stepKite(kite, target, KT_12, DT)
      frames++
    }
    expect(kite.settle).toBeGreaterThan(0)
    expect(kite.angle).toBeCloseTo(target + TUNING.OVERSHOOT_DEG, 6)

    // From there, back on target inside the settle window, monotonically.
    const settleFrames = Math.round(TUNING.OVERSHOOT_SETTLE / DT)
    let previous = kite.angle
    for (let i = 0; i < settleFrames; i++) {
      stepKite(kite, target, KT_12, DT)
      expect(kite.angle).toBeLessThanOrEqual(previous + 1e-9)
      previous = kite.angle
    }
    expect(kite.angle).toBeCloseTo(target, 6)
  })

  it('never overshoots a sweep under OVERSHOOT_MIN_SWEEP', () => {
    for (const target of [10, 30, 55, TUNING.OVERSHOOT_MIN_SWEEP - 0.5]) {
      const kite = createKiteState()
      for (let i = 0; i < 240; i++) {
        stepKite(kite, target, KT_12, DT)
        expect(kite.angle).toBeLessThanOrEqual(target + 1e-9)
      }
      expect(kite.angle).toBeCloseTo(target, 6)
    }
  })

  it('overshoots a long sweep back toward zenith too', () => {
    const kite = createKiteState(WINDOW_MAX)
    let low = WINDOW_MAX

    for (let i = 0; i < 180; i++) {
      stepKite(kite, 20, KT_12, DT)
      if (kite.angle < low) low = kite.angle
    }

    expect(low).toBeCloseTo(20 - TUNING.OVERSHOOT_DEG, 6)
    expect(kite.angle).toBeCloseTo(20, 6)
  })

  it('counts a fast drag, not just a jump, as a sweep', () => {
    // A real pointer sweep is a run of targets, not one jump. Dragged out to
    // 70deg in 0.3s the kite cannot keep up, so it is sweeping and it carries.
    const kite = createKiteState()
    let peak = 0

    for (let i = 0; i < 18; i++) {
      stepKite(kite, (i + 1) * (70 / 18), KT_12, DT)
      if (kite.angle > peak) peak = kite.angle
    }
    for (let i = 0; i < 120; i++) {
      stepKite(kite, 70, KT_12, DT)
      if (kite.angle > peak) peak = kite.angle
    }

    expect(peak).toBeCloseTo(70 + TUNING.OVERSHOOT_DEG, 6)
    expect(kite.angle).toBeCloseTo(70, 6)
  })

  it('does not overshoot a pointer the kite can keep up with', () => {
    // Steering, not sweeping: the target creeps out to 80deg over a second,
    // slower than the slew rate, so the kite tracks it and never carries past.
    const kite = createKiteState()

    for (let i = 0; i < 60; i++) {
      stepKite(kite, (i + 1) * (80 / 60), KT_12, DT)
      expect(kite.angle).toBeLessThanOrEqual(80 + 1e-9)
    }
    for (let i = 0; i < 120; i++) {
      stepKite(kite, 80, KT_12, DT)
      expect(kite.angle).toBeLessThanOrEqual(80 + 1e-9)
    }

    expect(kite.angle).toBeCloseTo(80, 6)
  })

  it('has nowhere to carry to at the edge of the window', () => {
    const kite = createKiteState()
    hold(kite, WINDOW_MAX, KT_12, 3)
    expect(kite.angle).toBe(WINDOW_MAX)
    expect(kite.settle).toBe(0)
  })

  it('abandons the settle when the player steers again', () => {
    const kite = createKiteState()
    let frames = 0
    while (!(kite.settle > 0) && frames < 240) {
      stepKite(kite, 70, KT_12, DT)
      frames++
    }

    stepKite(kite, 30, KT_12, DT)
    expect(kite.settle).toBe(0)
    hold(kite, 30, KT_12, 3)
    expect(kite.angle).toBeCloseTo(30, 6)
  })
})

describe('kiteAngle bounds', () => {
  it('never leaves 0..90 under a deterministic storm of inputs', () => {
    const rng = new Rng(12345)
    const kite = createKiteState()

    for (let i = 0; i < 20000; i++) {
      // Flick to a new random target every few frames, at a random wind.
      const target = targetFromInput(rng.next())
      const wind = rng.range(12, 45)
      const frames = rng.int(1, 40)
      for (let f = 0; f < frames; f++) {
        stepKite(kite, target, wind, DT)
        expect(kite.angle).toBeGreaterThanOrEqual(WINDOW_MIN)
        expect(kite.angle).toBeLessThanOrEqual(WINDOW_MAX)
      }
      i += frames
    }
  })

  it('clamps input outside the 0..1 axis onto the window', () => {
    expect(targetFromInput(-1)).toBe(WINDOW_MIN)
    expect(targetFromInput(2)).toBe(WINDOW_MAX)
    expect(targetFromInput(0.5)).toBeCloseTo(45, 10)
  })
})

describe('driveFactor', () => {
  it('is ~0 at zenith', () => {
    expect(driveFactor(0)).toBeCloseTo(0, 10)
  })

  it('is positive across the rest of the window', () => {
    for (let deg = 1; deg <= 90; deg++) expect(driveFactor(deg)).toBeGreaterThan(0)
  })

  // CONFLICT, spec §3.3: the formula `sin(θ) * cos(θ * 0.5)` is annotated
  // "peaks ~50°", and the build plan asks for a peak in 45..55. It does not
  // peak there — analytically the maximum is at 2*atan(1/sqrt(2)) = 70.53°.
  // The formula is implemented as written (the spec is the source of truth),
  // and the 0.5 is exposed as TUNING.DRIVE_SHAPE so the peak is one value away.
  // The human owns that value; see the next test for where it has to go.
  it('peaks at 70.53deg with the shipped DRIVE_SHAPE, not the ~50deg the comment claims', () => {
    expect(TUNING.DRIVE_SHAPE).toBe(0.5)
    expect(drivePeakDeg()).toBeCloseTo(70.53, 1)
  })

  it('peaks between 45 and 55deg when DRIVE_SHAPE is raised to 0.88', () => {
    const shipped = TUNING.DRIVE_SHAPE
    try {
      TUNING.DRIVE_SHAPE = 0.88
      const peak = drivePeakDeg()
      expect(peak).toBeGreaterThan(45)
      expect(peak).toBeLessThan(55)
    } finally {
      TUNING.DRIVE_SHAPE = shipped
    }
  })
})

describe('liftFactor', () => {
  it('is 1 at zenith', () => {
    expect(liftFactor(0)).toBe(1)
  })

  it('is ~0 at the edge of the window', () => {
    expect(liftFactor(90)).toBeCloseTo(0, 10)
  })

  it('falls monotonically from zenith to edge', () => {
    let previous = liftFactor(0)
    for (let deg = 1; deg <= 90; deg++) {
      const value = liftFactor(deg)
      expect(value).toBeLessThan(previous)
      previous = value
    }
  })

  it('never goes negative outside the window', () => {
    expect(liftFactor(120)).toBe(0)
  })
})
