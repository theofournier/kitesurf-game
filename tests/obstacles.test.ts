import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning.ts'
import { drivePeakAngle } from '../src/sim/kite.ts'
import { createSimState, DT, step, type RiderInput, type SimState } from '../src/sim/loop.ts'
import {
  boatSternX,
  createObstacle,
  deckHeight,
  farEdge,
  hitObstacle,
  hits,
  initBoat,
  initObstacle,
  obstacleLength,
  OBSTACLE,
  topAt,
  topHeight,
  type Obstacle,
  type ObstacleType,
} from '../src/sim/obstacles.ts'
import { clearable, speedFloor } from '../src/sim/fairness.ts'
import { initWave, WAVE } from '../src/sim/world.ts'

const KT_12 = 12
const TIERS = [12, 18, 25, 35]
/** Past every horizon the generator will ever reach in one of these fixtures. */
const FAR = 1e9

describe('obstacles (spec §9.1)', () => {
  it('gives each object the height of the spec table', () => {
    expect(deckHeight(OBSTACLE.BUOY)).toBe(TUNING.BUOY_H)
    expect(deckHeight(OBSTACLE.BOAT)).toBe(TUNING.BOAT_HULL_H)
    expect(deckHeight(OBSTACLE.PIER)).toBe(TUNING.PIER_H)

    // Only the boat is two heights: 2.4m of hull under a 4m mast.
    expect(topHeight(OBSTACLE.BOAT)).toBe(TUNING.BOAT_MAST_H)
    expect(topHeight(OBSTACLE.BUOY)).toBe(TUNING.BUOY_H)
    expect(topHeight(OBSTACLE.PIER)).toBe(TUNING.PIER_H)
  })

  it('ranks the three by how much has to be cleared', () => {
    expect(topHeight(OBSTACLE.BUOY)).toBeLessThan(topHeight(OBSTACLE.PIER))
    expect(topHeight(OBSTACLE.PIER)).toBeLessThan(topHeight(OBSTACLE.BOAT))
  })

  it('draws the silhouette a boat actually has', () => {
    const boat = initBoat(createObstacle(), 100)
    const stern = boatSternX(100)

    expect(stern).toBe(100 + TUNING.BOAT_WAKE_LEAD)
    expect(topAt(boat, stern - 0.01)).toBe(0)
    expect(topAt(boat, stern)).toBe(TUNING.BOAT_HULL_H)
    expect(topAt(boat, boat.mastX)).toBe(TUNING.BOAT_MAST_H)
    expect(topAt(boat, farEdge(boat))).toBe(TUNING.BOAT_HULL_H)
    expect(topAt(boat, farEdge(boat) + 0.01)).toBe(0)
    // The lip the boat belongs to, which is what the fairness gate measures to.
    expect(boat.gateX).toBe(100)
  })

  it('gives a buoy and a pier the length the spec table implies', () => {
    for (const type of [OBSTACLE.BUOY, OBSTACLE.PIER] as ObstacleType[]) {
      const obstacle = initObstacle(createObstacle(), 50, type)
      expect(obstacle.len).toBe(obstacleLength(type))
      expect(obstacle.mastH).toBe(0)
      // Nothing to launch off: the gate is the object itself.
      expect(obstacle.gateX).toBe(obstacle.x)
    }
  })

  it('is nothing at all while its slot is out of play', () => {
    const obstacle = initObstacle(createObstacle(), 50, OBSTACLE.PIER)
    obstacle.active = false
    expect(topAt(obstacle, 51)).toBe(0)
    expect(hits(obstacle, 49, 0, 55, 0)).toBe(false)
  })
})

describe('contact (spec §7.2, fatal)', () => {
  const buoy = initObstacle(createObstacle(), 100, OBSTACLE.BUOY)

  it('is a hit at water level and a pass above the top', () => {
    expect(hits(buoy, 99, 0, 101, 0)).toBe(true)
    expect(hits(buoy, 99, TUNING.BUOY_H, 101, TUNING.BUOY_H)).toBe(false)
  })

  it('catches a step that jumps clean over the object', () => {
    // A buoy is 0.8m of water and a step at MAX_SPEED covers 0.37m, so a
    // point-sampled test is already within a factor of two of missing one. The
    // sweep has to see an object nothing landed inside of.
    expect(hits(buoy, 99.9, 0, 100.9, 0)).toBe(true)
    expect(hits(buoy, 99.9, 0, 200, 0)).toBe(true)
  })

  it('judges the lowest point of the crossing, not the ends of the step', () => {
    // Coming down steeply: above the buoy when the step began, under its top by
    // the time the path reaches it.
    expect(hits(buoy, 99, 4, 100.2, 0.2)).toBe(true)
    // Climbing away: below the top at the start of the step, over it at the buoy.
    expect(hits(buoy, 99, 0, 100.5, 3)).toBe(false)
  })

  it('hits a mast the hull would have let through', () => {
    const boat = initBoat(createObstacle(), 0)
    const overHull = TUNING.BOAT_HULL_H + 0.5

    expect(hits(boat, boat.mastX - 1, overHull, boat.mastX + 1, overHull)).toBe(true)
    expect(hits(boat, boat.x, overHull, boat.mastX - 0.5, overHull)).toBe(false)
  })

  it('reports the object rather than a boolean, and null for a clean pass', () => {
    const pool = [initObstacle(createObstacle(), 100, OBSTACLE.BUOY)]
    expect(hitObstacle(pool, 99, 0, 101, 0)).toBe(pool[0])
    expect(hitObstacle(pool, 99, 9, 101, 9)).toBe(null)
  })
})

/** Input struct reused across a run, so a flown line allocates nothing. */
function input(kiteTarget: number, loading: boolean, out: RiderInput): RiderInput {
  out.kiteTarget = kiteTarget
  out.loading = loading
  return out
}

/**
 * A world holding one boat and the wake that launches it, and nothing else:
 * the generator is parked past every horizon so the fixture stays the fixture.
 */
function boatFixture(wind: number, lipX: number): SimState {
  const state = createSimState(1)
  state.windOverride = wind
  state.wind = wind

  const world = state.world
  world.spawnX = FAR
  world.obstacleX = FAR
  for (const wave of world.waves) wave.active = false
  for (const obstacle of world.obstacles) obstacle.active = false

  initWave(world.waves[0], lipX, WAVE.WAKE)
  initBoat(world.obstacles[0], lipX)
  return state
}

/** Points the kite at `theta` without slewing it there — a fixture, not a move. */
function parkKite(state: SimState, theta: number): void {
  state.rider.kite.angle = theta
  state.rider.kite.target = theta
  state.rider.kite.aim = theta
}

/**
 * Flies a rider over the boat in `state` and returns the obstacle they hit, or
 * null if they got over it.
 *
 * The line is the one spec §9.2 promises: a full edge released at the lip. What
 * happens after the release is the sim's business — every step goes through
 * `step`, and the answer comes from `state.hit` rather than from any arithmetic
 * this test does.
 */
function flyBoat(state: SimState, pop: boolean, holdKite: number): Obstacle | null {
  const boat = state.world.obstacles[0]
  const lipX = boat.gateX
  const out: RiderInput = { kiteTarget: 0, loading: false }
  const rider = state.rider

  // At the lip with a full edge and the kite at zenith: the pop of §3.5 taken
  // at the moment §4.2 pays the most for.
  if (pop) {
    rider.load = 1
    rider.loading = true
    parkKite(state, 0)
  }

  for (let i = 0; i < 2000; i++) {
    // Release on the first step at or past the lip, then steer wherever the
    // test asked and leave the air to gravity.
    const loading = pop && rider.x < lipX
    const target = rider.x < lipX ? 0 : holdKite / 90
    step(state, input(target, loading, out), DT)

    if (state.hit !== null) return state.hit
    if (rider.x > farEdge(boat) + 5) return null
    if (rider.speed <= 0 && !rider.airborne) return null
  }
  return null
}

describe('clearing a boat off its own wake (spec §9.2)', () => {
  /**
   * The spec's promise, checked by flying it: *a boat always spawns with its
   * wake kicker positioned so that a well-timed pop off the wake clears the
   * boat*.
   *
   * Asserted by simulation rather than by construction on purpose. The geometry
   * that positions the two is `BOAT_WAKE_LEAD` and the arithmetic that priced
   * it is `boatImpulseNeeded`, and a test written in either of those would only
   * be checking that the same formula equals itself. So the rider is put on the
   * water at a speed, the pop goes through `stepRider`, the air goes through
   * `stepAir`, and the verdict is whatever `hitObstacle` says on the step the
   * boat goes past.
   *
   * The kite is dumped to the edge of the window on the way up, which is the
   * *worst* air the release can lead to: `floatAccel` is zero out there, so
   * nothing holds the rider up and the arc is the bare ballistic one. Anything
   * the player does with the kite instead of that makes the air longer.
   */
  it('clears at every speed the boat is meant to be clearable at, at every tier', () => {
    for (const wind of TIERS) {
      const floor = speedFloor(OBSTACLE.BOAT, wind)
      expect(clearable(OBSTACLE.BOAT, wind)).toBe(true)

      for (let speed = floor; speed <= TUNING.MAX_SPEED; speed += 0.5) {
        const state = boatFixture(wind, 40)
        state.rider.speed = speed
        state.rider.x = 40

        const hit = flyBoat(state, true, 90)
        expect(hit, `${wind}kt at ${speed.toFixed(2)}m/s hit the ${hit?.type}`).toBe(null)
      }
    }
  })

  it('clears with room to spare when the kite is held up instead of dumped', () => {
    for (const wind of TIERS) {
      const state = boatFixture(wind, 40)
      state.rider.speed = TUNING.MAX_SPEED
      state.rider.x = 40
      expect(flyBoat(state, true, 0)).toBe(null)
    }
  })

  it('is lethal to the same rider taking no pop at all', () => {
    // The control. Without it the test above proves only that the fixture is
    // reachable, not that anything in it is dangerous.
    for (const wind of TIERS) {
      const state = boatFixture(wind, 40)
      state.rider.speed = TUNING.MAX_SPEED
      state.rider.x = 40
      parkKite(state, drivePeakAngle())

      expect(flyBoat(state, false, drivePeakAngle())?.type).toBe(OBSTACLE.BOAT)
    }
  })

  it('keeps its speed floor on the safe side of where the boat really stops being clearable', () => {
    // Slow enough, and no pop gets an arc across sixteen metres of hull however
    // well it is timed — which is what `speedFloor` is about, and what the
    // spin-up term of `popSetupTime` exists to pay for.
    //
    // The floor is solved ballistically and the kite is not ballistic, so the
    // real limit sits below it: the float carried on the way out to the edge of
    // the window is worth a metre or so a second of board speed. That is the
    // direction the error has to point. A gate that asked for less speed than
    // the sim needs would be the unavoidable death §9.2 forbids; one that asks
    // for a little more only ever spaces a boat further out than it had to.
    const wind = KT_12
    const floor = speedFloor(OBSTACLE.BOAT, wind)

    let fatal = 0
    for (let speed = 0.5; speed < floor; speed += 0.1) {
      const state = boatFixture(wind, 40)
      state.rider.speed = speed
      state.rider.x = 40
      if (flyBoat(state, true, 90) !== null) fatal = speed
    }

    expect(fatal).toBeGreaterThan(0)
    expect(fatal).toBeLessThan(floor)
  })
})
