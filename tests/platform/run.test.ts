// The run lifecycle of spec §8.4 and §10: SELECT → RIDING → OVER → RIDING, the
// records that survive between them, and the two promises build plan session 10
// makes about how it is wired — that a restart is instant, and that persistence
// never touches the update loop.
import { describe, expect, it } from 'vitest'
import { advanceRun, createRun, DIRECTION, RUN, startRun } from '../../src/platform/run.ts'
import { loadRecords, saveRecords, type KeyValueStore } from '../../src/platform/storage.ts'
import { DT } from '../../src/sim/loop.ts'

const W = 1200
const H = 800
const SEED = 0xc0ffee

/** Frames of a wide-open ride before a test gives up waiting for a crash. */
const PATIENCE = 60_000

/** A session sized like a real viewport, waiting on the direction select. */
function session(records = { score: 0, jump: 0, distance: 0 }) {
  const run = createRun(records)
  run.view.width = W
  run.view.height = H
  return run
}

/**
 * Rides until a fatal crash, and returns the frames it took.
 *
 * The kite is parked near the drive peak and the load is never held, so the
 * rider simply goes forward on the water and meets the first thing in it.
 * Contact is fatal (spec §7.2) and the board is at altitude 0, so every
 * obstacle in the generator's range ends this run — which makes it the shortest
 * honest path to the OVER state.
 */
function rideToCrash(run: ReturnType<typeof session>): number {
  run.input.kiteTarget = 0.5

  for (let frame = 1; frame <= PATIENCE; frame++) {
    if (advanceRun(run, DT)) return frame
  }
  throw new Error('the rider never hit anything')
}

/** A store that counts every read and write, and refuses to be ignored. */
function countingStore() {
  const data = new Map<string, string>()
  const log = { reads: 0, writes: 0 }

  const store: KeyValueStore = {
    getItem(key) {
      log.reads++
      return data.has(key) ? data.get(key)! : null
    },
    setItem(key, value) {
      log.writes++
      data.set(key, value)
    },
  }

  return { store, log }
}

describe('the run lifecycle', () => {
  it('waits on the direction select before anything moves (spec §6.5)', () => {
    const run = session()
    expect(run.phase).toBe(RUN.SELECT)

    for (let i = 0; i < 120; i++) advanceRun(run, DT)

    expect(run.state.tick).toBe(0)
    expect(run.state.rider.x).toBe(0)
  })

  it('rides the direction it was given, as a mirror of the world', () => {
    const left = session()
    startRun(left, DIRECTION.LEFT, SEED)
    advanceRun(left, DT)
    expect(left.view.facing).toBe(DIRECTION.LEFT)

    const right = session()
    startRun(right, DIRECTION.RIGHT, SEED)
    advanceRun(right, DT)
    expect(right.view.facing).toBe(DIRECTION.RIGHT)

    // Same seed, opposite ways: the direction is a fact about the camera, so
    // the water underneath has to be identical.
    expect(left.state.rider.x).toBe(right.state.rider.x)
  })

  it('ends exactly once, on the frame the crash lands', () => {
    const run = session()
    startRun(run, DIRECTION.RIGHT, SEED)
    rideToCrash(run)

    expect(run.phase).toBe(RUN.OVER)
    expect(run.state.over).toBe(true)
    // Every frame after it is a frame that did not end anything.
    for (let i = 0; i < 240; i++) expect(advanceRun(run, DT)).toBe(false)
  })

  it('keeps the scene running under the game-over card', () => {
    const run = session()
    startRun(run, DIRECTION.RIGHT, SEED)
    rideToCrash(run)

    // The state a rider who hit something on the way down out of a landing
    // leaves behind: a verdict still on screen and the frame still moving.
    run.effects.flash = 0.5
    run.effects.shake = 12
    const tick = run.state.tick

    for (let i = 0; i < 30; i++) advanceRun(run, DT)

    // The sim stopped where the rider did (spec §7.2)...
    expect(run.state.tick).toBe(tick)
    // ...and the frame did not: the crash is still shaking itself out under an
    // overlay drawn over a live scene, not over a frozen screenshot.
    expect(run.effects.flash).toBeLessThan(0.5)
    expect(run.effects.shake).toBeLessThan(12)
  })
})

describe('the records of spec §8.4', () => {
  it('measures a run against the bests it started with, not against itself', () => {
    const run = session({ score: 10, jump: 0.5, distance: 50 })
    startRun(run, DIRECTION.RIGHT, SEED)
    rideToCrash(run)

    // The marker in the water is a line to beat: it cannot creep upward as the
    // run improves on it, or nobody could ever pass it.
    expect(run.records).toEqual({ score: 10, jump: 0.5, distance: 50 })
    expect(run.marks.distance).toBe(50)
  })

  it('folds a beaten record into the bests and hands it to the next run', () => {
    const run = session()
    startRun(run, DIRECTION.RIGHT, SEED)
    rideToCrash(run)

    const distance = run.state.rider.x
    expect(run.breaks.distance).toBe(true)
    expect(run.best.distance).toBe(distance)

    startRun(run, DIRECTION.RIGHT, SEED)
    expect(run.records.distance).toBe(distance)
    expect(run.marks.distance).toBe(distance)
    expect(run.breaks.distance).toBe(false)
  })

  it('leaves a record that was not beaten where it stood', () => {
    const run = session({ score: 1e9, jump: 99, distance: 1e6 })
    startRun(run, DIRECTION.RIGHT, SEED)
    rideToCrash(run)

    expect(run.breaks).toEqual({ score: false, jump: false, distance: false })
    expect(run.best).toEqual({ score: 1e9, jump: 99, distance: 1e6 })
  })

  it('takes the jump PB from landed airs only (spec §8.4)', () => {
    const run = session()
    startRun(run, DIRECTION.RIGHT, SEED)
    rideToCrash(run)

    // `score.bestJump` is the sim's own landed-only number; the run must report
    // that rather than the highest the rider ever got, so an air they did not
    // ride away from cannot become a personal best.
    expect(run.best.jump).toBe(Math.max(run.state.score.bestJump, run.records.jump))
  })

  it('draws no marker for a player who has never finished a run', () => {
    const run = session()
    startRun(run, DIRECTION.RIGHT, SEED)

    expect(run.marks.distance).toBe(0)
    expect(run.marks.jump).toBe(0)
  })
})

describe('the restart', () => {
  it('puts every last thing back, and nothing bleeds through', () => {
    const run = session()
    startRun(run, DIRECTION.RIGHT, SEED)
    rideToCrash(run)

    startRun(run, DIRECTION.LEFT, SEED + 1)

    expect(run.phase).toBe(RUN.RIDING)
    expect(run.direction).toBe(DIRECTION.LEFT)
    expect(run.seed).toBe(SEED + 1)

    expect(run.state.tick).toBe(0)
    expect(run.state.over).toBe(false)
    expect(run.state.hit).toBeNull()
    expect(run.state.rider.x).toBe(0)
    expect(run.state.score.total).toBe(0)
    expect(run.state.world.waves.some((wave) => wave.active)).toBe(false)
    expect(run.state.world.obstacles.some((obstacle) => obstacle.active)).toBe(false)

    // The edge detectors are the ones that would bite: both fire off a sim
    // counter that has just gone back to its starting value.
    expect(run.effects.seen).toBe(0)
    expect(run.effects.tier).toBe(1)
    expect(run.effects.shake).toBe(0)
    expect(run.effects.count).toBe(0)
    expect(run.camera.alt).toBe(0)
    expect(run.previous.x).toBe(0)
    expect(run.pending.x).toBe(0)
    expect(run.accumulator.acc).toBe(0)
    expect(run.marks.passedDistance).toBe(false)
    expect(run.marks.jumpFlash).toBe(0)
    expect(run.input.loading).toBe(false)
  })

  it('reuses every struct rather than replacing it', () => {
    // The debug panel binds straight to `state.windOverride` and the renderer
    // reads the wave pool by reference. A restart that swapped these objects
    // would leave half the app pointed at the run before it.
    const run = session()
    const held = {
      state: run.state,
      rider: run.state.rider,
      waves: run.state.world.waves,
      input: run.input,
      view: run.view,
      camera: run.camera,
      effects: run.effects,
    }

    startRun(run, DIRECTION.RIGHT, SEED)
    rideToCrash(run)
    startRun(run, DIRECTION.RIGHT, SEED)

    expect(run.state).toBe(held.state)
    expect(run.state.rider).toBe(held.rider)
    expect(run.state.world.waves).toBe(held.waves)
    expect(run.input).toBe(held.input)
    expect(run.view).toBe(held.view)
    expect(run.camera).toBe(held.camera)
    expect(run.effects).toBe(held.effects)
  })

  it('keeps the viewport, which belongs to the window and not to the run', () => {
    const run = session()
    startRun(run, DIRECTION.RIGHT, SEED)
    expect(run.view.width).toBe(W)
    expect(run.view.height).toBe(H)
  })

  it('holds the debug wind override across runs', () => {
    // It belongs to the tuning session, which is the one thing that restarts
    // over and over — and the slider is bound to this field by reference, so
    // clearing it here would silently disagree with what the human can see.
    const run = session()
    startRun(run, DIRECTION.RIGHT, SEED)
    run.state.windOverride = 28

    startRun(run, DIRECTION.RIGHT, SEED)
    expect(run.state.windOverride).toBe(28)
  })

  it('replays the same water from the same seed', () => {
    const run = session()
    startRun(run, DIRECTION.RIGHT, SEED)
    const first = rideToCrash(run)
    const distance = run.state.rider.x
    const score = run.state.score.total

    startRun(run, DIRECTION.RIGHT, SEED)
    const second = rideToCrash(run)

    expect(second).toBe(first)
    expect(run.state.rider.x).toBe(distance)
    expect(run.state.score.total).toBe(score)
  })

  it('is under 500ms, measured (build plan session 10)', () => {
    const run = session()
    startRun(run, DIRECTION.RIGHT, SEED)
    // Restart the worst case: a run long enough that both pools are full and
    // the camera, the effects and the string caches are all carrying state.
    rideToCrash(run)

    let worst = 0
    for (let i = 0; i < 20; i++) {
      const from = performance.now()
      // Everything that stands between the key going down and the first frame
      // of the new run being ready to draw. No confirm dialog, no reload, no
      // allocation — which is why this has three orders of magnitude of room.
      startRun(run, DIRECTION.RIGHT, SEED + i)
      advanceRun(run, DT)
      const took = performance.now() - from

      if (took > worst) worst = took
      rideToCrash(run)
    }

    expect(worst).toBeLessThan(500)
  })
})

/**
 * Every source file the update loop is made of, read as text.
 *
 * Through Vite's glob for the same reasons tests/sim/purity.test.ts gives: it
 * needs no @types/node, and a new file in any of these directories is picked up
 * without this test being told about it. The options are repeated rather than
 * hoisted because the glob is resolved at build time and will only take an
 * object literal.
 */
const LOOP_SOURCES: Record<string, string> = {
  ...(import.meta.glob('../../src/sim/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob('../../src/render/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob('../../src/platform/run.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>),
}

/**
 * Source with comments and string literals blanked, so the scan reads code and
 * only code — half the prose in these files is *about* keeping persistence out
 * of the loop, and a bare text search would hit every sentence of it.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

describe('persistence stays out of the update loop (spec §10)', () => {
  // The structural half of the claim below: the behavioural tests show that a
  // run does not touch the disk, and these show that it could not.
  it('is unreachable from anything a frame runs', () => {
    for (const path of Object.keys(LOOP_SOURCES).sort()) {
      const body = code(LOOP_SOURCES[path])

      expect(body, path).not.toMatch(/\blocalStorage\b/)
      expect(body, path).not.toMatch(/\bsessionStorage\b/)
      // Not even at one remove: the three functions that do the touching are
      // named nowhere the loop can call them from.
      expect(body, path).not.toMatch(/\bloadRecords\b/)
      expect(body, path).not.toMatch(/\bsaveRecords\b/)
      expect(body, path).not.toMatch(/\bbrowserStorage\b/)
    }
  })

  it('is never touched across a whole run, start to crash', () => {
    const { store, log } = countingStore()
    // The one read the program makes, before the first frame.
    const run = session(loadRecords(store))
    const afterLoad = { ...log }

    startRun(run, DIRECTION.RIGHT, SEED)
    const frames = rideToCrash(run)
    // And every frame after the crash, under the game-over card.
    for (let i = 0; i < 600; i++) advanceRun(run, DT)

    expect(frames).toBeGreaterThan(100)
    expect(log).toEqual(afterLoad)
  })

  it('is not touched by a restart either', () => {
    const { store, log } = countingStore()
    const run = session(loadRecords(store))
    const afterLoad = { ...log }

    for (let i = 0; i < 10; i++) {
      startRun(run, DIRECTION.RIGHT, SEED + i)
      rideToCrash(run)
    }

    // Ten runs, ten sets of records folded in, and the disk has heard nothing:
    // the write is the shell's, on the frame `advanceRun` reports the end.
    expect(log).toEqual(afterLoad)
  })

  it('is written exactly once per run, by the shell, when one ends', () => {
    const { store, log } = countingStore()
    const run = session(loadRecords(store))
    const reads = log.reads

    startRun(run, DIRECTION.RIGHT, SEED)
    run.input.kiteTarget = 0.5

    let writes = 0
    for (let frame = 0; frame < PATIENCE && run.phase !== RUN.OVER; frame++) {
      // This is the shell's frame, in miniature — the whole of what main.ts
      // does with storage.
      if (advanceRun(run, DT)) {
        saveRecords(store, run.best)
        writes++
      }
    }

    expect(writes).toBe(1)
    expect(log.reads).toBe(reads)
    expect(log.writes).toBe(3)
    expect(loadRecords(store).distance).toBe(run.state.rider.x)
  })
})
