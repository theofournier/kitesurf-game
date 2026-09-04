// The run lifecycle (spec §8.4, §10): pick a direction, ride, crash, ride
// again.
//
//     SELECT ──direction──► RIDING ──fatal crash──► OVER ──any key──► RIDING
//
// A run is one seed and everything the shell holds about it, and this module
// owns the whole of that: the sim, the two records it is being measured
// against, and every piece of presentation state that has to go back to zero
// with it. It is the shell of spec §11.3 rather than the sim because a
// direction, a personal best and a restart are all things the sim is
// deliberately ignorant of — the sim's job is that `(seed, inputTrace)`
// describes a run completely, and that is only true while nothing in it knows
// what run number this is.
//
// It also owns the update half of a frame, which is what makes the two claims
// of build plan session 10 checkable rather than asserted. `advanceRun` is
// everything a frame does except draw, it runs headless, and it does not import
// storage — so "localStorage is never read or written inside the update loop"
// is a property of the module graph, and "a restart takes under 500ms" is a
// property of one function a test can call and time.
//
// Nothing here allocates per frame. Every struct is built once by `createRun`
// and reset in place by `startRun`, which is the same discipline the sim keeps
// and for a second reason besides: the debug panel and the input adapters hold
// references to these objects, so a restart that replaced them would leave half
// the app pointed at the run before it.
import {
  advance,
  createAccumulator,
  createInput,
  createSimState,
  DEFAULT_SEED,
  resetAccumulator,
  resetInput,
  resetSimState,
  type Accumulator,
  type RiderInput,
  type SimState,
} from '../sim/loop.ts'
import { createCamera, resetCamera, updateCamera, type Camera } from '../render/camera.ts'
import { createEffects, resetEffects, updateEffects, type Effects } from '../render/effects.ts'
import { createHud, resetHud, type Hud } from '../render/hud.ts'
import {
  createOverlay,
  createRecordBreaks,
  resetOverlay,
  resetRecordBreaks,
  type Overlay,
  type RecordBreaks,
} from '../render/overlay.ts'
import {
  createRecordMarks,
  resetRecordMarks,
  updateRecordMarks,
  type RecordMarks,
} from '../render/records.ts'
import {
  captureSnapshot,
  createSnapshot,
  createView,
  interpolateView,
  resetSnapshot,
  type RenderView,
  type Snapshot,
} from '../render/view.ts'
import { noRecords, type Records } from './storage.ts'

/**
 * The three states a session is ever in. Strings for the same reason PHASE is:
 * they go straight into the debug readout and into test failure messages.
 */
export const RUN = {
  /** Before a run: the direction of spec §6.5 has not been chosen yet. */
  SELECT: 'SELECT',
  /** A run in progress. The only state the sim advances in. */
  RIDING: 'RIDING',
  /** After a fatal crash (spec §7.2). The scene keeps drawing underneath. */
  OVER: 'OVER',
} as const

export type RunPhase = (typeof RUN)[keyof typeof RUN]

/** The two directions of spec §6.5, as the sign the world is mirrored by. */
export const DIRECTION = { LEFT: -1, RIGHT: 1 } as const

/** Everything one session of the game holds. */
export interface RunSession {
  phase: RunPhase
  /** Which way the current run is going, +1 or -1 (spec §6.5). */
  direction: number
  /** The seed the current run was started on — half of `(seed, inputTrace)`. */
  seed: number
  /**
   * The records the current run is being measured against: the PBs as they
   * stood when it started. Fixed for the length of the run, because the marker
   * in the water is a line to beat and a line that moved as you improved on it
   * is a line nobody could pass.
   */
  records: Records
  /**
   * The same records with this run folded in, once it has ended. This is what
   * gets persisted, and what the next run's `records` are copied from.
   */
  best: Records
  /** Which of the three this run beat. Read by the game-over card. */
  breaks: RecordBreaks
  state: SimState
  input: RiderInput
  accumulator: Accumulator
  camera: Camera
  view: RenderView
  effects: Effects
  hud: Hud
  overlay: Overlay
  marks: RecordMarks
  /**
   * The two sim snapshots the render interpolates between: `previous` is the
   * state before the most recent step, `pending` the one being captured for the
   * step about to run. Swapped rather than copied, so a frame allocates nothing.
   */
  previous: Snapshot
  pending: Snapshot
  /** Fixed steps taken on the most recent frame. Debug readout only. */
  steps: number
}

/** Copies one record set over another, in place. */
function copyRecords(into: Records, from: Records): Records {
  into.score = from.score
  into.jump = from.jump
  into.distance = from.distance
  return into
}

/**
 * Builds a session around the records loaded from storage (spec §10), waiting
 * on the direction select.
 *
 * `records` is read once, by the caller, before this — the only read the whole
 * program makes. Everything after it works off the copy held here.
 */
export function createRun(records: Records = noRecords()): RunSession {
  const session: RunSession = {
    phase: RUN.SELECT,
    direction: DIRECTION.RIGHT,
    seed: DEFAULT_SEED,
    records: copyRecords(noRecords(), records),
    best: copyRecords(noRecords(), records),
    breaks: createRecordBreaks(),
    state: createSimState(),
    input: createInput(),
    accumulator: createAccumulator(),
    camera: createCamera(),
    view: createView(),
    effects: createEffects(),
    hud: createHud(),
    overlay: createOverlay(),
    marks: createRecordMarks(),
    previous: createSnapshot(),
    pending: createSnapshot(),
    steps: 0,
  }

  resetRecordMarks(session.marks, session.records)
  return session
}

/**
 * Starts a run, and is also the restart (build plan session 10: one key or tap,
 * no confirm dialog).
 *
 * There is only the one function because there is only the one thing: a fresh
 * run is a fresh run whether it is the first of the session or the ninth. Every
 * struct is reset in place, so the cost is a few dozen field writes and two
 * pool sweeps — well inside the 500ms budget, and the reason the budget is
 * never in danger is that nothing here allocates.
 *
 * The records the new run is measured against are the best of every run before
 * it, which is why `best` is copied into `records` here rather than at the end
 * of the last one: a run beats the marker it was drawn against, and the next
 * run's marker is where this one left it.
 */
export function startRun(
  session: RunSession,
  direction: number,
  seed: number = DEFAULT_SEED,
): RunSession {
  session.phase = RUN.RIDING
  session.direction = direction < 0 ? DIRECTION.LEFT : DIRECTION.RIGHT
  session.seed = seed

  copyRecords(session.records, session.best)
  resetRecordBreaks(session.breaks)

  resetSimState(session.state, seed)
  resetInput(session.input)
  resetAccumulator(session.accumulator)
  resetSnapshot(session.previous)
  resetSnapshot(session.pending)

  resetCamera(session.camera)
  resetEffects(session.effects)
  resetHud(session.hud)
  resetOverlay(session.overlay)
  resetRecordMarks(session.marks, session.records)

  // The view needs no reset: `interpolateView` overwrites every field of it
  // that is not the viewport size or the direction, and both of those are set
  // from outside — the size by the resize handler, the direction right here.
  session.view.facing = session.direction
  session.steps = 0
  return session
}

/**
 * Closes a run out: which records fell, and what the new bests are.
 *
 * Called on the one frame a fatal crash lands. It settles the numbers in memory
 * and nothing else — writing them to disk is the caller's, once, which is what
 * keeps storage off the update path entirely.
 *
 * The jump PB comes from `score.bestJump` rather than from the highest air the
 * run had, because spec §8.4 counts only landed jumps: an air the rider did not
 * ride away from is not a jump they made, however high it went. The sky marker
 * flashing on the way past is a different question, and records.ts answers it.
 */
function endRun(session: RunSession): void {
  const score = session.state.score
  const distance = session.state.rider.x

  session.phase = RUN.OVER
  session.breaks.score = score.total > session.records.score
  session.breaks.jump = score.bestJump > session.records.jump
  session.breaks.distance = distance > session.records.distance

  if (session.breaks.score) session.best.score = score.total
  if (session.breaks.jump) session.best.jump = score.bestJump
  if (session.breaks.distance) session.best.distance = distance
}

/**
 * Advances one frame: the fixed-step sim, then everything the drawing reads.
 *
 * Returns true on the single frame a run ended on, which is the caller's cue to
 * persist the records — the one write the program makes, and the reason this
 * returns a flag instead of writing them itself.
 *
 * The sim only advances while a run is riding. Everything else does so in every
 * phase, and that is the point of it: the game-over card is drawn over a scene
 * that is still alive, with the shake still dying away and the spray from the
 * crash still falling. Freezing the whole frame at the moment of impact would
 * turn a crash into a hang.
 *
 * `frameTime` is real elapsed seconds. It reaches the accumulator, the camera
 * damping and the effects, and no physics formula — the sim only ever advances
 * in DT (spec §11.2).
 */
export function advanceRun(session: RunSession, frameTime: number): boolean {
  const riding = session.phase === RUN.RIDING

  captureSnapshot(session.pending, session.state)
  session.steps = riding
    ? advance(session.accumulator, session.state, session.input, frameTime)
    : 0

  // On a frame that ran no step there is nothing new to interpolate from, and
  // `previous` must keep pointing at the step before the current state.
  if (session.steps > 0) {
    const spent = session.previous
    session.previous = session.pending
    session.pending = spent
  }

  interpolateView(session.view, session.previous, session.state, session.accumulator.alpha)
  session.view.facing = session.direction

  updateCamera(
    session.camera,
    session.view.width,
    session.view.height,
    session.view.x,
    session.view.altitude,
    frameTime,
  )
  updateEffects(session.effects, session.camera, session.view, frameTime)
  updateRecordMarks(session.marks, session.view, frameTime)

  if (riding && session.state.over) {
    endRun(session)
    return true
  }
  return false
}
