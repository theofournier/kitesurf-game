// The guarantee of spec §9.2, checked two ways.
//
// The fuzz asserts the inequality itself over ten thousand seeded worlds: no
// spawn, anywhere, at any speed, ever comes out closer than
// `REACTION_MIN + popSetupTime` allows. That catches a generator that forgets
// to push a spawn out, or measures from the wrong place, or lets one stream get
// ahead of the other.
//
// It cannot catch a `popSetupTime` that is simply wrong, because the generator
// and the assertion would be wrong together. So the second half of this file
// stops doing arithmetic and flies the line instead: a scripted rider, through
// the real `step`, given exactly the time the model says the line needs, and
// asked to get over the thing.
import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning.ts'
import {
  arrivalSpeed,
  cheapestRelease,
  clearable,
  launchBonus,
  loadFor,
  minSafeGap,
  popSetupTime,
  requiredImpulse,
  riseTime,
  runout,
  speedFloor,
  spinUpTime,
} from '../src/sim/fairness.ts'
import { drivePeakAngle, slewRate } from '../src/sim/kite.ts'
import { createSimState, DT, step, type RiderInput, type SimState } from '../src/sim/loop.ts'
import {
  farEdge,
  initBoat,
  initObstacle,
  OBSTACLE,
  type Obstacle,
  type ObstacleType,
} from '../src/sim/obstacles.ts'
import { createRiderState, popImpulse, stepRider } from '../src/sim/rider.ts'
import { Rng } from '../src/sim/rng.ts'
import { tierAt, WIND_AUTO, windAt } from '../src/sim/wind.ts'
import { createWorldState, initWave, stepWorld, WAVE } from '../src/sim/world.ts'

const TIERS = [12, 18, 25, 35]
const FAR = 1e9

/** One obstacle as the generator committed it, and where the rider was then. */
interface Spawn {
  type: ObstacleType
  /** The point the pop has to be set up by: a wake lip, or the object itself. */
  gateX: number
  /** Where the rider was standing when this spawn was committed. */
  riderX: number
}

/**
 * Every obstacle a seed lays down over `metres`, in the order they were
 * committed, each tagged with where the rider was at the time.
 *
 * The rider is pumped through in fixed jumps rather than ridden, because what
 * the generator lays down is a function of position alone — which is itself one
 * of the things asserted below.
 */
function spawnsOver(seed: number, wind: number, metres: number, stepM: number): Spawn[] {
  const world = createWorldState(seed)
  const seen: Spawn[] = []
  const known = new Set<number>()

  for (let x = 0; x <= metres; x += stepM) {
    stepWorld(world, x, wind)
    for (const obstacle of world.obstacles) {
      if (!obstacle.active || known.has(obstacle.gateX)) continue
      known.add(obstacle.gateX)
      seen.push({ type: obstacle.type, gateX: obstacle.gateX, riderX: x })
    }
  }

  return seen.sort((a, b) => a.gateX - b.gateX)
}

describe('the fairness guarantee (spec §9.2)', () => {
  /**
   * Ten thousand seeded runs at randomised speeds and wind tiers, asserting
   * that every spawn satisfies
   *
   *     timeToImpact >= REACTION_MIN + popSetupTime(currentSpeed)
   *
   * twice over: measured from the rider, and measured from where the previous
   * obstacle's jump puts them back on the water. An obstacle forty metres past
   * a boat is unavoidable however much warning it had.
   *
   * The speed is drawn fresh per spawn and is never told to the generator. That
   * is the point of the whole design: the gap is fair at every speed the rider
   * could arrive at, not only at the one they happened to have when it
   * committed, because in the six seconds between the two they can add fifteen
   * metres a second to it.
   *
   * No tolerance. The comparison is `>=` against the raw value.
   */
  it('is never violated, over 10,000 seeded runs', () => {
    const rng = new Rng(0xfa12)
    const violations: string[] = []
    const counts: Record<string, number> = { buoy: 0, boat: 0, pier: 0 }

    for (let run = 0; run < 10_000; run++) {
      const wind = rng.next() < 0.4 ? TIERS[rng.int(0, TIERS.length)] : rng.range(12, 40)
      const spawns = spawnsOver(run, wind, 600, 30)

      let clear = 0
      for (const spawn of spawns) {
        counts[spawn.type] += 1

        // A fresh speed per spawn, with MAX_SPEED itself drawn often: that is
        // where the bound is exactly tight, so it is where a mistake shows.
        const speed = rng.next() < 0.1 ? TUNING.MAX_SPEED : rng.range(0.05, TUNING.MAX_SPEED)
        const setup = popSetupTime(spawn.type, wind, speed)
        const need = speed * (TUNING.REACTION_MIN + setup)

        if (!Number.isFinite(setup)) {
          violations.push(`${spawn.type} at ${wind.toFixed(1)}kt has no line at all`)
        } else if (spawn.gateX - spawn.riderX < need) {
          violations.push(
            `run ${run} ${spawn.type} at ${wind.toFixed(1)}kt: ` +
              `${(spawn.gateX - spawn.riderX).toFixed(3)}m from the rider, needs ${need.toFixed(3)}m ` +
              `at ${speed.toFixed(2)}m/s`,
          )
        } else if (spawn.gateX - clear < need) {
          violations.push(
            `run ${run} ${spawn.type} at ${wind.toFixed(1)}kt: ` +
              `${(spawn.gateX - clear).toFixed(3)}m past the last landing, needs ${need.toFixed(3)}m ` +
              `at ${speed.toFixed(2)}m/s`,
          )
        }

        clear = spawn.gateX + runout(spawn.type)
      }
    }

    expect(violations.slice(0, 5)).toEqual([])
    // And it looked at a real spread of obstacles rather than an empty sea.
    expect(counts.buoy).toBeGreaterThan(10_000)
    expect(counts.boat).toBeGreaterThan(1_000)
    expect(counts.pier).toBeGreaterThan(1_000)
    // Ten thousand worlds is a slow test by the standards of this suite and a
    // fast one by the standards of the thing it is checking.
  }, 60_000)

  it('holds at every speed at once, which is what makes it survive acceleration', () => {
    // `minSafeGap` claims to be the largest `v * (REACTION_MIN + popSetupTime(v))`
    // gets over the whole speed range, by a closed form rather than a search.
    // This is that claim, checked against the search it replaces.
    for (const wind of [12, 15, 18, 22, 25, 30, 35, 40]) {
      for (const type of [OBSTACLE.BUOY, OBSTACLE.BOAT, OBSTACLE.PIER] as ObstacleType[]) {
        if (!clearable(type, wind)) continue
        const gap = minSafeGap(type, wind)

        for (let speed = 0.05; speed <= TUNING.MAX_SPEED; speed += 0.05) {
          const need = speed * (TUNING.REACTION_MIN + popSetupTime(type, wind, speed))
          expect(need, `${type} at ${wind}kt, ${speed.toFixed(2)}m/s`).toBeLessThanOrEqual(gap)
        }
      }
    }
  })

  /**
   * The same guarantee, on the wind curve rather than on a fixed wind.
   *
   * This is the case tiers introduce and the fixed-wind fuzz above cannot see:
   * a spawn is committed in one wind and ridden at another, because the wind
   * rises with every metre of the approach (spec §7.1). Every term of
   * `popSetupTime` gets *cheaper* in more wind, so the honest question is
   * whether the gap holds at the weakest wind anywhere on the line to it —
   * which is the wind at the start of the approach, and is what the generator
   * prices the gate at.
   *
   * Scanned across the approach rather than asserted at that one point, so a
   * `minSafeGap` that stopped being monotonic in wind would fail here rather
   * than quietly agreeing with the generator.
   */
  it('holds all the way up the wind curve, where a spawn is ridden in more wind than it was laid in', () => {
    const SAMPLES = 8

    for (let seed = 0; seed < 40; seed++) {
      let clear = 0

      for (const spawn of spawnsOver(seed, WIND_AUTO, 8000, 25)) {
        let need = 0
        for (let i = 0; i <= SAMPLES; i++) {
          const at = clear + ((spawn.gateX - clear) * i) / SAMPLES
          const gap = minSafeGap(spawn.type, windAt(at))
          if (gap > need) need = gap
        }

        expect(
          spawn.gateX - clear,
          `seed ${seed}: ${spawn.type} at ${spawn.gateX.toFixed(0)}m, ` +
            `${windAt(clear).toFixed(1)}kt at the start of the line`,
        ).toBeGreaterThanOrEqual(need)
        expect(spawn.gateX - spawn.riderX).toBeGreaterThanOrEqual(need)

        clear = spawn.gateX + runout(spawn.type)
      }
    }
  })

  it('leaves the rider a gap far wider than the guarantee, because the horizon is wider', () => {
    // The rider half of the inequality is enforced by the spawn horizon rather
    // than by the gate: nothing is committed inside it, and it is three times
    // the largest gap any obstacle asks for. This is the margin that leaves.
    for (const wind of TIERS) {
      for (const spawn of spawnsOver(99, wind, 3000, 10)) {
        expect(spawn.gateX - spawn.riderX).toBeGreaterThan(minSafeGap(spawn.type, wind))
      }
    }
  })
})

describe('what a spawn is allowed to be (spec §9.1, §9.2)', () => {
  it('puts piers at tier 3 and up (spec §9.1)', () => {
    // §9.1 says "rare, tier 3+". The physics nearly says it on its own: a pier
    // is 3m of wall and wants 3.5m of apex with the margin, and flat water
    // gives 2.40m at 12kt, 3.37m at 18kt and 4.00m at 25kt — so the tier the
    // spec asks for is very close to what the flat-water ceiling of §3.5 does
    // to a 3m wall.
    expect(clearable(OBSTACLE.PIER, 12)).toBe(false)
    expect(clearable(OBSTACLE.PIER, 18)).toBe(false)
    expect(clearable(OBSTACLE.PIER, 25)).toBe(true)
    expect(clearable(OBSTACLE.PIER, 35)).toBe(true)

    // Nearly, but not quite: it turns true at 19.1kt, which the continuous
    // curve of §7.1 reaches around 660m — the middle of tier 2, where the only
    // line over a pier is the strongest one in the game. So the generator asks
    // for the tier as well, and the spec's table is what holds.
    for (const wind of [12, 18, 19.5, 24.9]) {
      for (const spawn of spawnsOver(5, wind, 6000, 20)) {
        expect(spawn.type, `${wind}kt`).not.toBe(OBSTACLE.PIER)
      }
    }
    expect(spawnsOver(5, 25, 6000, 20).some((s) => s.type === OBSTACLE.PIER)).toBe(true)
  })

  it('lays its first pier no earlier than tier 3, riding the curve', () => {
    // The same rule seen from the water rather than from the wind: with no
    // override, every pier in a run is past the tier 3 boundary.
    for (let seed = 0; seed < 20; seed++) {
      for (const spawn of spawnsOver(seed, WIND_AUTO, 8000, 20)) {
        if (spawn.type !== OBSTACLE.PIER) continue
        expect(tierAt(spawn.gateX), `seed ${seed}`).toBeGreaterThanOrEqual(TUNING.PIER_TIER)
      }
    }
  })

  it('makes buoys and boats clearable at every tier', () => {
    for (const wind of TIERS) {
      expect(clearable(OBSTACLE.BUOY, wind)).toBe(true)
      expect(clearable(OBSTACLE.BOAT, wind)).toBe(true)
      expect(speedFloor(OBSTACLE.BOAT, wind)).toBeGreaterThan(0)
      expect(speedFloor(OBSTACLE.BUOY, wind)).toBe(0)
    }
  })

  it('tightens the rhythm as the wind gets up (spec §9.2 density)', () => {
    const density = (wind: number) => spawnsOver(21, wind, 20_000, 50).length
    const tier1 = density(12)
    const tier4 = density(35)

    expect(tier4).toBeGreaterThan(tier1 * 1.5)
  })

  it('never lets two obstacles overlap, whatever the density does', () => {
    for (const wind of TIERS) {
      const world = createWorldState(31)
      for (let x = 0; x <= 20_000; x += 25) {
        stepWorld(world, x, wind)
        for (const a of world.obstacles) {
          for (const b of world.obstacles) {
            if (a === b || !a.active || !b.active) continue
            expect(a.x >= farEdge(b) || b.x >= farEdge(a)).toBe(true)
          }
        }
      }
    }
  })

  it('gives every boat the wake that launches it (spec §9.2)', () => {
    // Checked on the step the boat first appears. Both are recycled behind the
    // rider, and the wake goes first because it is a boat length further back —
    // so a boat still in play with no wake left is a boat already ridden past.
    for (const wind of TIERS) {
      const world = createWorldState(41)
      const known = new Set<number>()
      let boats = 0

      for (let x = 0; x <= 8000; x += 20) {
        stepWorld(world, x, wind)
        for (const obstacle of world.obstacles) {
          if (!obstacle.active || obstacle.type !== OBSTACLE.BOAT) continue
          if (known.has(obstacle.gateX)) continue
          known.add(obstacle.gateX)
          boats += 1

          const wake = world.waves.find(
            (wave) => wave.active && wave.type === WAVE.WAKE && wave.lipX === obstacle.gateX,
          )
          expect(wake, `boat at ${obstacle.x} has no wake`).toBeDefined()
          expect(obstacle.x).toBe(obstacle.gateX + TUNING.BOAT_WAKE_LEAD)
        }
      }

      expect(boats).toBeGreaterThan(0)
    }
  })

  it('lays down the same world however coarsely the rider passes through', () => {
    // The obstacle stream is committed in order of position out of the same rng
    // as the waves, so this is the property that makes a replay a replay.
    // `riderX` is left out of the comparison: it is not part of the world, it
    // is a note of which pump happened to notice the spawn.
    const laid = (stepM: number) =>
      spawnsOver(7, 25, 3000, stepM).map(({ type, gateX }) => ({ type, gateX }))

    expect(laid(17)).toEqual(laid(1))
    expect(laid(71)).toEqual(laid(1))
    expect(spawnsOver(8, 25, 3000, 1).map((s) => s.gateX)).not.toEqual(
      spawnsOver(7, 25, 3000, 1).map((s) => s.gateX),
    )
  })

  it('keeps the obstacle stream stocked to the horizon, so the pool never starves', () => {
    const world = createWorldState(4)
    for (let x = 0; x <= 20_000; x += 10) {
      stepWorld(world, x, 35)
      expect(world.obstacleX).toBeGreaterThanOrEqual(x + TUNING.MAX_SPEED * TUNING.WAVE_LEAD)
      expect(world.obstacles.length).toBe(8)
    }
  })
})

describe('the pieces the guarantee is built out of', () => {
  it('inverts the pop: the load loadFor asks for makes the impulse it was asked about', () => {
    for (const wind of TIERS) {
      for (const impulse of [2, 4, 6, 8, 10, 14]) {
        for (const theta of [0, 20, 45]) {
          const load = loadFor(impulse, theta, wind, 1)
          if (!(load <= 1)) continue
          expect(popImpulse(load, theta, wind)).toBeCloseTo(impulse, 9)
        }
      }
    }
  })

  it('has no load at all for a height past the flat-water ceiling', () => {
    const overCap = Math.sqrt(2 * TUNING.GRAVITY * TUNING.FLAT_POP_CAP)
    expect(loadFor(overCap, 0, 35, 1)).toBe(Infinity)
  })

  it('times the spin-up the way the sim actually accelerates', () => {
    // `spinUpTime` is the closed form of `dv/dt = A - k·v²`. This is the same
    // question put to the sim: park the kite at the drive peak and count the
    // steps it really takes.
    const peak = drivePeakAngle()
    const cruise: RiderInput = { kiteTarget: peak / 90, loading: false }

    for (const wind of TIERS) {
      for (const target of [4, 8, 12]) {
        const rider = createRiderState()
        rider.kite.angle = peak
        rider.kite.target = peak
        rider.kite.aim = peak

        let steps = 0
        while (rider.speed < target && steps < 6000) {
          stepRider(rider, cruise, wind, DT)
          steps += 1
        }

        expect(spinUpTime(0, target, wind)).toBeCloseTo(steps * DT, 1)
      }
    }
  })

  it('costs nothing to spin up to a speed already carried', () => {
    expect(spinUpTime(10, 4, 12)).toBe(0)
    expect(spinUpTime(10, 10, 12)).toBe(0)
  })

  it('asks the impossible of nobody: no line is priced at a load over a full edge', () => {
    for (const wind of [12, 18, 25, 35]) {
      for (const type of [OBSTACLE.BUOY, OBSTACLE.BOAT, OBSTACLE.PIER] as ObstacleType[]) {
        if (!clearable(type, wind)) continue
        const need = requiredImpulse(type, TUNING.MAX_SPEED)
        const theta = cheapestRelease(need, wind, TUNING.MAX_SPEED, launchBonus(type))

        expect(theta).toBeGreaterThanOrEqual(0)
        expect(loadFor(need, theta, wind, launchBonus(type))).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })
})

/** Input struct reused across a run, so a flown line allocates nothing. */
function input(kiteTarget: number, loading: boolean, out: RiderInput): RiderInput {
  out.kiteTarget = kiteTarget
  out.loading = loading
  return out
}

/**
 * A world holding one obstacle of `type` and, for a boat, the wake that
 * launches it — with the rider standing exactly `minSafeGap` short of the gate,
 * which is the tightest spawn the generator is ever allowed to commit.
 */
function tightestSpawn(type: ObstacleType, wind: number, speed: number): SimState {
  const state = createSimState(3)
  state.windOverride = wind
  state.wind = wind

  const world = state.world
  world.spawnX = FAR
  world.obstacleX = FAR
  for (const wave of world.waves) wave.active = false
  for (const obstacle of world.obstacles) obstacle.active = false

  const gate = 400
  if (type === OBSTACLE.BOAT) {
    initWave(world.waves[0], gate, WAVE.WAKE)
    initBoat(world.obstacles[0], gate)
  } else {
    initObstacle(world.obstacles[0], gate, type)
  }

  const peak = drivePeakAngle()
  state.rider.x = gate - minSafeGap(type, wind)
  state.rider.speed = speed
  state.rider.kite.angle = peak
  state.rider.kite.target = peak
  state.rider.kite.aim = peak
  return state
}

/**
 * Flies the line `popSetupTime` was priced on, after burning REACTION_MIN doing
 * nothing at all, and returns what the rider hit.
 *
 * `lead` is the one thing left to the player: how long before the send to bury
 * the edge. Everything else is the model's — the release angle it costed, the
 * load it asked for, the send timed to land the kite there, the release at the
 * gate. A negative `lead` never edges at all, which is the control.
 *
 * That one parameter has to be searched rather than computed because the sim
 * punishes both ways of getting it wrong and the rider's speed is moving the
 * whole time: commit early and the edge fills, sits past STALL_GRACE and the
 * pop is forfeit (spec §3.4); commit late and the load is short at the lip.
 * What `popSetupTime` claims is that *some* moment works inside the budget, so
 * that is what gets asked.
 */
function flyTheLine(state: SimState, type: ObstacleType, lead: number): Obstacle | null {
  const wind = state.windOverride
  const rider = state.rider
  const gate = state.world.obstacles[0].gateX
  const bonus = launchBonus(type)
  const rise = riseTime(type)
  const peak = drivePeakAngle()
  const out: RiderInput = { kiteTarget: peak / 90, loading: false }

  // The reaction window: the spawn is there, and the player has not moved yet.
  for (let i = 0; i < Math.round(TUNING.REACTION_MIN / DT); i++) {
    step(state, input(peak / 90, false, out), DT)
    if (state.hit !== null) return state.hit
  }

  // The line, chosen once at the speed the rider reacted at, the way a player
  // commits to a send rather than re-deciding it every frame.
  const floor = speedFloor(type, wind)
  const at = Math.max(rider.speed, floor)
  const need = requiredImpulse(type, arrivalSpeed(type, wind, at))
  const theta = cheapestRelease(need, wind, at, bonus)
  const steer = Math.abs(peak - theta) / slewRate(wind)

  for (let i = 0; i < 4000; i++) {
    const speed = rider.speed > 0.05 ? rider.speed : 0.05
    const toGate = (gate - rider.x) / speed

    // Bury the edge, send the kite, release at the gate — in that order, and
    // the hold runs unbroken from the first to the last, because letting go of
    // it early *is* the pop.
    const loading = lead >= 0 && !rider.airborne && toGate <= rise + steer + lead && toGate > rise
    const target = toGate <= rise + steer ? theta : peak

    step(state, input(target / 90, loading, out), DT)
    if (state.hit !== null) return state.hit
    if (rider.x > farEdge(state.world.obstacles[0]) + 2) return null
  }
  return null
}

describe('flying the line the model priced (spec §9.2)', () => {
  /**
   * The test that can actually falsify `popSetupTime`.
   *
   * Everything else in this file shares its arithmetic with the generator, so
   * the two can only ever agree. Here the rider is put exactly `minSafeGap`
   * short of the gate — the closest the generator may ever commit one — given
   * the reaction window to waste, and then flown through the real sim on the
   * budget the model claims is enough. What comes back is `state.hit`.
   */
  const APPROACHES = [4, 8, 12, 16, 20, TUNING.MAX_SPEED]

  /** The earliest edge that gets over it, or -1 if nothing inside the gap does. */
  function fliesIt(type: ObstacleType, wind: number, speed: number): number {
    for (let lead = 0; lead <= 4; lead += 0.05) {
      const state = tightestSpawn(type, wind, speed)
      if (flyTheLine(state, type, lead) === null) return lead
    }
    return -1
  }

  it('gets over every obstacle from the tightest gap the generator can commit', () => {
    for (const wind of TIERS) {
      for (const type of [OBSTACLE.BUOY, OBSTACLE.BOAT, OBSTACLE.PIER] as ObstacleType[]) {
        if (!clearable(type, wind)) continue

        for (const speed of APPROACHES) {
          const lead = fliesIt(type, wind, speed)
          expect(lead, `no line over a ${type} at ${wind}kt approached at ${speed}m/s`).toBeGreaterThanOrEqual(0)
        }
      }
    }
  }, 30_000)

  it('is lethal to the same rider who never buries the edge', () => {
    // The control. Without it the test above proves only that the fixtures are
    // reachable, not that anything in them had to be jumped.
    for (const wind of TIERS) {
      for (const type of [OBSTACLE.BUOY, OBSTACLE.BOAT, OBSTACLE.PIER] as ObstacleType[]) {
        if (!clearable(type, wind)) continue

        const state = tightestSpawn(type, wind, TUNING.MAX_SPEED)
        expect(flyTheLine(state, type, -1)?.type, `${type} at ${wind}kt`).toBe(type)
      }
    }
  })
})
