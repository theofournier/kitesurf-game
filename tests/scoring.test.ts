// Scoring (spec §8): the formula, the two multipliers, and the one property the
// whole architecture exists to buy — that a run is a function of its seed and
// its input trace and of nothing else.
import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning.ts'
import { createInput, createSimState, DT, step, type RiderInput } from '../src/sim/loop.ts'
import { initBoat, initObstacle, OBSTACLE } from '../src/sim/obstacles.ts'
import { PHASE } from '../src/sim/rider.ts'
import { Rng } from '../src/sim/rng.ts'
import {
  clearanceBonus,
  createScoreState,
  creditLanding,
  isTrick,
  jumpScore,
  noteClearance,
  stepScore,
} from '../src/sim/scoring.ts'
import { tierMult } from '../src/sim/wind.ts'
import { kickerBonus } from '../src/sim/world.ts'

const TIER_1 = tierMult(1)
/** A jump big enough that the combo and the bonus have something to multiply. */
const REF_APEX = 4
/** The smallest kicker there is, and the one the combo is meant to live on. */
const CHOP = TUNING.BONUS_CHOP
/** Flat water: a pop the water under the board did nothing for (spec §4.2). */
const FLAT = 1
const FAR = 1e9
/**
 * How far a level-held rider still falls inside one step, m. The clearance is
 * measured off the swept path, and gravity acts inside the step whatever the
 * fixture does at the top of it — so a pass held at a gap arrives a hair under
 * it rather than exactly on it.
 */
const FALL = TUNING.GRAVITY * DT * DT

/** A fresh score with `combo` already built, as a run in progress would have. */
function scoreAt(combo: number, distance = 0) {
  const score = createScoreState()
  score.combo = combo
  score.comboX = distance
  return score
}

describe('the jump formula (spec §8.1)', () => {
  it('is apex^HEIGHT_EXP * HEIGHT_K, times the four multipliers', () => {
    const apex = 3
    const expected =
      apex ** TUNING.HEIGHT_EXP * TUNING.HEIGHT_K * TUNING.CLEAN_QUALITY * 4 * 1.25 * 2.5

    expect(jumpScore(apex, TUNING.CLEAN_QUALITY, 4, 1.25, 2.5)).toBeCloseTo(expected, 10)
  })

  it('is superlinear in height: one huge send beats two safe ones', () => {
    // The arcade feel of §8.1, stated as the inequality it has to satisfy.
    const huge = jumpScore(8, TUNING.CLEAN_QUALITY, 1, 1, TIER_1)
    const safe = jumpScore(4, TUNING.CLEAN_QUALITY, 1, 1, TIER_1)

    expect(huge).toBeGreaterThan(2 * safe)
  })

  it('pays a sketchy landing less and a wipeout nothing', () => {
    const clean = jumpScore(REF_APEX, TUNING.CLEAN_QUALITY, 1, 1, TIER_1)
    const sketchy = jumpScore(REF_APEX, TUNING.SKETCHY_QUALITY, 1, 1, TIER_1)

    expect(sketchy).toBeCloseTo(clean * TUNING.SKETCHY_QUALITY, 10)
    expect(jumpScore(REF_APEX, 0, 1, 1, TIER_1)).toBe(0)
    expect(jumpScore(0, TUNING.CLEAN_QUALITY, 1, 1, TIER_1)).toBe(0)
  })

  it('pays the same air four times as much at tier 4 as at tier 1', () => {
    const low = jumpScore(REF_APEX, TUNING.CLEAN_QUALITY, 1, 1, tierMult(1))
    const high = jumpScore(REF_APEX, TUNING.CLEAN_QUALITY, 1, 1, tierMult(4))

    expect(high / low).toBeCloseTo(tierMult(4) / tierMult(1), 10)
  })

  it('adds the distance trickle to the sum of the jumps', () => {
    const score = createScoreState()
    creditLanding(score, REF_APEX, TUNING.CLEAN_QUALITY, CHOP, 200, TIER_1, 1)
    stepScore(score, 200)

    expect(score.jumps).toBeGreaterThan(0)
    expect(score.total).toBeCloseTo(score.jumps + 200 * TUNING.DIST_PER_M, 10)
  })
})

describe('the combo (spec §8.2)', () => {
  it('builds one per clean landing and caps at COMBO_CAP', () => {
    const score = createScoreState()
    expect(score.combo).toBe(1)

    for (let i = 1; i <= TUNING.COMBO_CAP + 5; i++) {
      creditLanding(score, REF_APEX, TUNING.CLEAN_QUALITY, CHOP, i, TIER_1, i)
    }

    expect(score.combo).toBe(TUNING.COMBO_CAP)
  })

  it('pays a jump at the combo it was taken at, not the one it earns', () => {
    // The first clean landing of a run is worth 1x, the second 2x.
    const score = createScoreState()
    const single = jumpScore(REF_APEX, TUNING.CLEAN_QUALITY, 1, 1, TIER_1)

    creditLanding(score, REF_APEX, TUNING.CLEAN_QUALITY, CHOP, 0, TIER_1, 1)
    expect(score.lastJump).toBeCloseTo(single, 10)
    expect(score.combo).toBe(2)

    creditLanding(score, REF_APEX, TUNING.CLEAN_QUALITY, CHOP, 0, TIER_1, 2)
    expect(score.lastJump).toBeCloseTo(2 * single, 10)
  })

  it('walks the ladder up and back down again', () => {
    const score = createScoreState()
    const climb = [2, 3, 4, 5]
    for (const expected of climb) {
      creditLanding(score, REF_APEX, TUNING.CLEAN_QUALITY, CHOP, 0, TIER_1, score.landings + 1)
      expect(score.combo).toBe(expected)
    }

    for (const expected of [4, 3, 2, 1, 1]) {
      creditLanding(score, REF_APEX, TUNING.SKETCHY_QUALITY, CHOP, 0, TIER_1, score.landings + 1)
      expect(score.combo).toBe(expected)
    }
  })

  it('is built by a kicker jump and never by a flat one', () => {
    // A flat-water hop is not a trick (spec §3.5 caps it at FLAT_POP_CAP for
    // exactly that reason), so it neither builds the combo nor holds it. It
    // still scores, at whatever the rider is carrying.
    const score = scoreAt(4)
    creditLanding(score, REF_APEX, TUNING.CLEAN_QUALITY, FLAT, 10, TIER_1, 1)

    expect(score.lastJump).toBeCloseTo(
      jumpScore(REF_APEX, TUNING.CLEAN_QUALITY, 4, 1, TIER_1),
      10,
    )
    expect(score.combo).toBe(4)
    expect(score.comboX).toBe(0)

    // The ruler was never pushed out, so the flat hop bought no time either.
    stepScore(score, TUNING.COMBO_DECAY_M)
    expect(score.combo).toBe(3)

    // The smallest kicker in the game is enough, which is what chop is for.
    creditLanding(score, REF_APEX, TUNING.CLEAN_QUALITY, CHOP, 500, TIER_1, 2)
    expect(score.combo).toBe(4)
    expect(score.comboX).toBe(500)
  })

  it('is not taken by a flat landing either, however scrappy', () => {
    // The other half of the same rule. A flat hop is not a trick, so it does
    // not move the combo in either direction — the ladder is for kickers, and
    // a rider bobbing over chop-free water is neither building nor spending.
    const score = scoreAt(5, 200)
    creditLanding(score, REF_APEX, TUNING.SKETCHY_QUALITY, FLAT, 210, TIER_1, 1)

    expect(score.combo).toBe(5)
    expect(score.comboX).toBe(200)
  })

  it('counts any kicker as a trick and flat water as none', () => {
    expect(isTrick(FLAT)).toBe(false)
    expect(isTrick(TUNING.BONUS_CHOP)).toBe(true)
    expect(isTrick(TUNING.BONUS_WAVE)).toBe(true)
    expect(isTrick(TUNING.BONUS_WAKE)).toBe(true)
    // A lip missed by a whole KICKER_WINDOW pays 1x, and 1x is flat water as
    // far as the pop is concerned (spec §4.2).
    expect(isTrick(kickerBonus(TUNING.BONUS_WAKE, TUNING.KICKER_WINDOW))).toBe(false)
  })

  it('still resets to 1x on a wipeout off flat water', () => {
    // The one thing that happens off any water: a botched landing costs the
    // whole combo whether or not there was a wave under the takeoff.
    const score = scoreAt(7)
    creditLanding(score, REF_APEX, 0, FLAT, 40, TIER_1, 1)

    expect(score.combo).toBe(1)
    expect(score.comboX).toBe(40)
  })

  it('costs a rung on a sketchy landing and the lot on a wipeout', () => {
    // The three-step ladder: clean up one, sketchy down one, wipeout all the
    // way down. The jump is still paid at the combo it was taken at — the
    // sketchy landing below scores at 6x and leaves 5x standing.
    const score = scoreAt(6)
    creditLanding(score, REF_APEX, TUNING.SKETCHY_QUALITY, CHOP, 0, TIER_1, 1)

    expect(score.lastJump).toBeCloseTo(
      jumpScore(REF_APEX, TUNING.SKETCHY_QUALITY, 6, 1, TIER_1),
      10,
    )
    expect(score.combo).toBe(5)

    creditLanding(score, REF_APEX, 0, CHOP, 0, TIER_1, 2)
    expect(score.combo).toBe(1)
    expect(score.lastJump).toBe(0)
  })

  it('cannot take a sketchy landing below 1x', () => {
    const score = createScoreState()
    for (let i = 1; i <= 3; i++) {
      creditLanding(score, REF_APEX, TUNING.SKETCHY_QUALITY, CHOP, i, TIER_1, i)
    }

    expect(score.combo).toBe(1)
  })

  it('buys the decay ruler back even when it costs a rung', () => {
    // A scrappy landing is still a landed trick: it pays its rung and the
    // ruler restarts from it. Charging the rung and leaving the ruler where it
    // was would take two multipliers off the same mistake.
    const score = scoreAt(5)
    stepScore(score, TUNING.COMBO_DECAY_M - 10)
    expect(score.combo).toBe(5)

    creditLanding(score, REF_APEX, TUNING.SKETCHY_QUALITY, CHOP, TUNING.COMBO_DECAY_M - 10, TIER_1, 1)
    expect(score.combo).toBe(4)

    stepScore(score, TUNING.COMBO_DECAY_M + 100)
    expect(score.combo).toBe(4)
  })

  it('decays exactly 1 per COMBO_DECAY_M without a landed trick', () => {
    // Spec §8.2, to the metre: the ruler is distance, so the combo a rider is
    // carrying is a function of where they last landed and nothing else.
    const score = scoreAt(TUNING.COMBO_CAP)
    const from = 0

    for (let dropped = 1; dropped < TUNING.COMBO_CAP; dropped++) {
      const at = from + dropped * TUNING.COMBO_DECAY_M

      stepScore(score, at - 1e-9)
      expect(score.combo, `${at - 1}m`).toBe(TUNING.COMBO_CAP - dropped + 1)

      stepScore(score, at)
      expect(score.combo, `${at}m`).toBe(TUNING.COMBO_CAP - dropped)
    }

    // And it stops at 1x: there is no such thing as a negative combo.
    stepScore(score, 1e6)
    expect(score.combo).toBe(1)
  })

  it('decays on distance rather than on a clock', () => {
    // Two riders, the same water, one taking twice as long over it. The rule is
    // the anti-stalling one of §7.1: time cannot be farmed.
    const quick = scoreAt(5)
    const slow = scoreAt(5)

    for (let i = 0; i <= 300; i++) stepScore(quick, i)
    for (let i = 0; i <= 600; i++) stepScore(slow, i / 2)

    expect(quick.combo).toBe(slow.combo)
    expect(quick.combo).toBe(3)
  })

  it('restarts the ruler from the landing, not from the last decay', () => {
    const score = scoreAt(4)

    stepScore(score, TUNING.COMBO_DECAY_M)
    expect(score.combo).toBe(3)

    creditLanding(score, REF_APEX, TUNING.CLEAN_QUALITY, CHOP, 500, TIER_1, 1)
    expect(score.combo).toBe(4)

    stepScore(score, 500 + TUNING.COMBO_DECAY_M - 1e-9)
    expect(score.combo).toBe(4)
    stepScore(score, 500 + TUNING.COMBO_DECAY_M)
    expect(score.combo).toBe(3)
  })
})

describe('what the last touchdown did', () => {
  it('remembers how high the air went, alongside what it scored', () => {
    const score = createScoreState()
    expect(score.lastApex).toBe(0)

    creditLanding(score, 6.4, TUNING.CLEAN_QUALITY, CHOP, 0, TIER_1, 1)
    expect(score.lastApex).toBe(6.4)
    expect(score.lastJump).toBeGreaterThan(0)
  })

  it('remembers an air the rider did not ride away from', () => {
    // Not the same question as the record of §8.4: `bestJump` counts landed
    // airs only, while this is a readout of what just happened — and a 9m send
    // that ended in a wipeout is still a 9m send.
    const score = createScoreState()
    creditLanding(score, 9.2, 0, CHOP, 0, TIER_1, 1)

    expect(score.lastApex).toBe(9.2)
    expect(score.bestJump).toBe(0)
    expect(score.lastJump).toBe(0)
  })

  it('is replaced by the next air, not accumulated', () => {
    const score = createScoreState()
    creditLanding(score, 9.2, TUNING.CLEAN_QUALITY, CHOP, 0, TIER_1, 1)
    creditLanding(score, 2.1, TUNING.CLEAN_QUALITY, CHOP, 0, TIER_1, 2)

    expect(score.lastApex).toBe(2.1)
    // The record it beat stands, which is the difference between the two.
    expect(score.bestJump).toBe(9.2)
  })
})

describe('the clearance bonus (spec §8.3)', () => {
  it('is 1.0 at exactly CLEARANCE_M and 1.5 at nothing at all', () => {
    // The two numbers the spec writes down.
    expect(clearanceBonus(TUNING.CLEARANCE_M)).toBe(1)
    expect(clearanceBonus(0)).toBe(1.5)
  })

  it('runs straight between them, and pays nothing above the band', () => {
    for (let gap = 0; gap <= TUNING.CLEARANCE_M; gap += 0.05) {
      const expected = 1 + 0.5 * (1 - gap / TUNING.CLEARANCE_M)
      expect(clearanceBonus(gap), `${gap}m`).toBeCloseTo(expected, 10)
    }

    expect(clearanceBonus(TUNING.CLEARANCE_M + 1e-9)).toBe(1)
    expect(clearanceBonus(4)).toBe(1)
    expect(clearanceBonus(Infinity)).toBe(1)
  })

  it('holds at 1.5 through the sliver below zero that is already a crash', () => {
    expect(clearanceBonus(-0.5)).toBe(1.5)
  })

  it('pays the closest pass of the air, once, at the touchdown', () => {
    const score = createScoreState()
    noteClearance(score, 2, 0)
    noteClearance(score, 0.15, 10)
    noteClearance(score, 0.6, 20)

    creditLanding(score, REF_APEX, TUNING.CLEAN_QUALITY, CHOP, 30, TIER_1, 1)

    expect(score.lastBonus).toBeCloseTo(clearanceBonus(0.15), 10)
    expect(score.lastJump).toBeCloseTo(
      jumpScore(REF_APEX, TUNING.CLEAN_QUALITY, 1, clearanceBonus(0.15), TIER_1),
      10,
    )

    // And the next air starts clean: a near miss is not a season ticket.
    expect(score.clearance).toBe(Infinity)
  })

  it('extends the combo window at the moment of the pass', () => {
    // "Also extends the combo window" (§8.3). The rider is 140m past their last
    // landing with a 10m gap to go before the combo drops; threading an
    // obstacle buys the whole ruler back.
    const score = scoreAt(5)
    stepScore(score, TUNING.COMBO_DECAY_M - 10)
    expect(score.combo).toBe(5)

    noteClearance(score, 0.2, TUNING.COMBO_DECAY_M - 10)
    stepScore(score, TUNING.COMBO_DECAY_M + 100)
    expect(score.combo).toBe(5)
  })

  it('is not extended by an air that passed nowhere near anything', () => {
    const score = scoreAt(5)
    noteClearance(score, 12, 10)
    stepScore(score, TUNING.COMBO_DECAY_M)

    expect(score.combo).toBe(4)
  })
})

/** A world with one obstacle in it and the generator parked past every horizon. */
function fixture(seed: number) {
  const state = createSimState(seed)
  state.world.spawnX = FAR
  state.world.obstacleX = FAR
  for (const wave of state.world.waves) wave.active = false
  for (const obstacle of state.world.obstacles) obstacle.active = false
  return state
}

describe('a near miss through the loop (spec §8.3)', () => {
  /** Flies a rider over `x` at `apex` metres and returns the clearance scored. */
  function flyOver(build: (state: ReturnType<typeof fixture>) => number, altitude: number) {
    const state = fixture(4)
    const gate = build(state)
    const input: RiderInput = { kiteTarget: 1, loading: false }

    state.rider.x = gate - 20
    state.rider.speed = 12
    state.rider.altitude = altitude
    state.rider.airborne = true
    state.rider.apex = altitude
    // Held level: the clearance under test is the one this altitude gives, not
    // whatever a ballistic arc would have happened to leave.
    for (let i = 0; i < 200 && state.rider.x < gate + 20; i++) {
      state.rider.vSpeed = 0
      state.rider.altitude = altitude
      step(state, input, DT)
    }

    return state
  }

  it('measures a buoy from the top of it', () => {
    const clear = 0.3
    const state = flyOver((s) => {
      initObstacle(s.world.obstacles[0], 100, OBSTACLE.BUOY)
      return 100
    }, TUNING.BUOY_H + clear)

    expect(state.over).toBe(false)
    expect(state.score.clearance).toBeLessThanOrEqual(clear)
    expect(state.score.clearance).toBeGreaterThan(clear - FALL)
  })

  it('measures a boat from its mast, not its deck', () => {
    // The silhouette is one shape (§9.1) and the near miss is measured against
    // all of it: shaving the hull while the mast goes by underneath is not a
    // pass, it is a crash.
    const clear = 0.4
    const state = flyOver((s) => {
      initBoat(s.world.obstacles[0], 100)
      return s.world.obstacles[0].mastX
    }, TUNING.BOAT_MAST_H + clear)

    expect(state.over).toBe(false)
    expect(state.score.clearance).toBeLessThanOrEqual(clear)
    expect(state.score.clearance).toBeGreaterThan(clear - FALL)
  })

  it('leaves an air over open water with no bonus at all', () => {
    const state = flyOver(() => 100, 3)

    expect(state.score.clearance).toBe(Infinity)
    expect(clearanceBonus(state.score.clearance)).toBe(1)
  })
})

describe('the fatal half of the crash split (spec §7.2)', () => {
  it('ends the run on contact and stops the sim dead', () => {
    const state = fixture(5)
    initObstacle(state.world.obstacles[0], 40, OBSTACLE.PIER)
    state.rider.speed = 15

    const input = createInput()
    input.kiteTarget = 0.78
    for (let i = 0; i < 600 && !state.over; i++) step(state, input, DT)

    expect(state.over).toBe(true)
    expect(state.hit?.type).toBe(OBSTACLE.PIER)

    const tick = state.tick
    const x = state.rider.x
    const total = state.score.total
    for (let i = 0; i < 60; i++) step(state, input, DT)

    expect(state.tick).toBe(tick)
    expect(state.rider.x).toBe(x)
    expect(state.score.total).toBe(total)
  })

  it('keeps the run going through a wipeout, which is the whole split', () => {
    // Spec §7.2: the worst case of a botched trick is lost tempo. Sending is
    // encouraged; only the furniture is lethal.
    const state = fixture(6)
    const input = createInput()
    state.rider.airborne = true
    state.rider.altitude = 0.001
    state.rider.vSpeed = -12
    state.rider.apex = 6
    state.rider.speed = 14
    state.score.combo = 7

    step(state, input, DT)

    expect(state.rider.landingQuality).toBe(0)
    expect(state.over).toBe(false)
    expect(state.score.combo).toBe(1)
    expect(state.score.lastJump).toBe(0)

    // And the run picks up again once the kite is out of the water: the relaunch
    // beat costs tempo, which is the whole price of a botched trick.
    const relaunch: RiderInput = { kiteTarget: 1, loading: false }
    let steps = 0
    while (state.rider.phase === PHASE.WIPEOUT && steps < 600) {
      expect(state.rider.x).toBe(state.score.comboX)
      step(state, relaunch, DT)
      steps++
    }

    expect(steps * DT).toBeLessThan(TUNING.WIPEOUT_RECOVER + 0.5)
    expect(state.rider.phase).toBe(PHASE.RIDING)

    for (let i = 0; i < 120; i++) step(state, { kiteTarget: 0.78, loading: false }, DT)
    expect(state.rider.speed).toBeGreaterThan(0)
    expect(state.over).toBe(false)
  })
})

/**
 * One run of `steps` from `seed`, flown by a seeded pretend player.
 *
 * The trace is a function of the seed alone — a second Rng, nothing read from
 * the sim — so "the same seed and the same input trace" is exactly what two
 * calls with the same seed produce, and comparing them compares the sim rather
 * than the pilot.
 */
function fly(seed: number, steps: number) {
  const state = createSimState(seed)
  const input = createInput()
  const pilot = new Rng(seed ^ 0x9e3779b9)

  let until = 0
  let leg = 0
  let target = 0.78

  for (let i = 0; i < steps; i++) {
    if (i >= until) {
      // The three legs of a jump, on lengths and angles the pilot's own stream
      // picks: bury the edge with the kite low, send it up and let go, then
      // bring it back down through the landing band to ride away.
      leg = (leg + 1) % 3
      target =
        leg === 0 ? pilot.range(0.65, 0.95) : leg === 1 ? pilot.range(0, 0.3) : pilot.range(0.42, 0.8)
      until = i + Math.round(pilot.range(leg === 0 ? 14 : 20, leg === 0 ? 34 : 55))
    }

    input.kiteTarget = target
    input.loading = leg === 0
    step(state, input, DT)
  }

  return state
}

describe('determinism (spec §11.4)', () => {
  const RUNS = 100
  const STEPS = 60 * 30

  it('scores a run identically from the same seed and the same input trace', () => {
    // The property the whole of /src/sim is arranged around: a run is fully
    // described by (seed, inputTrace). If this can fail, ghosts, replays and
    // server-side replay validation are all worth nothing.
    let landed = 0
    let scored = 0
    const totals = new Set<number>()

    for (let seed = 1; seed <= RUNS; seed++) {
      const a = fly(seed, STEPS)
      const b = fly(seed, STEPS)

      expect(b.score.total, `seed ${seed}`).toBe(a.score.total)
      expect(b.score.jumps, `seed ${seed}`).toBe(a.score.jumps)
      expect(b.score.combo, `seed ${seed}`).toBe(a.score.combo)
      expect(b.score.bestJump, `seed ${seed}`).toBe(a.score.bestJump)
      expect(b.rider.x, `seed ${seed}`).toBe(a.rider.x)
      expect(b.rider.landings, `seed ${seed}`).toBe(a.rider.landings)
      expect(b.tick, `seed ${seed}`).toBe(a.tick)
      expect(b.over, `seed ${seed}`).toBe(a.over)

      totals.add(a.score.total)
      if (a.rider.landings > 0) landed += 1
      if (a.score.jumps > 0) scored += 1
    }

    // The assertion above is only worth anything if the runs it compares are
    // real ones: they have to jump, they have to score, and they have to differ
    // from each other or a hundred zeroes would pass.
    expect(landed).toBeGreaterThan(RUNS * 0.9)
    expect(scored).toBeGreaterThan(RUNS * 0.5)
    expect(totals.size).toBeGreaterThan(RUNS * 0.9)
  })

  it('gives two different seeds two different runs', () => {
    const a = fly(1, STEPS)
    const b = fly(2, STEPS)

    expect(b.rider.x).not.toBe(a.rider.x)
  })
})
