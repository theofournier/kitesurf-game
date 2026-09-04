// Entry point: canvas surface, the frame, the input adapters, the lifecycle
// keys, and the one read and the one write of spec §10's persistence.
//
// Wiring only. Game logic lives in /src/sim, drawing in /src/render, and the
// run lifecycle in [platform/run.ts](platform/run.ts) — which owns everything a
// frame updates, so what is left here is the half that genuinely needs a
// browser: a canvas, a device pixel ratio, listeners, and localStorage.
import { createAnchor } from './input/axis.ts'
import { createDesktopInput } from './input/desktop.ts'
import { createTouchInput } from './input/touch.ts'
import { unlockAudioOnFirstGesture } from './platform/audio.ts'
import { lockLandscape } from './platform/orientation.ts'
import { advanceRun, createRun, DIRECTION, RUN, startRun } from './platform/run.ts'
import { browserStorage, loadRecords, saveRecords } from './platform/storage.ts'
import { LAND_REASON, PHASE } from './sim/rider.ts'
import { WIND_AUTO } from './sim/world.ts'
import { mirrorX } from './render/camera.ts'
import { drawHud } from './render/hud.ts'
import { drawGameOver, drawSelect } from './render/overlay.ts'
import { drawScene } from './render/scene.ts'
import type { SimState } from './sim/loop.ts'

/** Beyond 2x, retina costs fill rate for no visible gain (spec §5.4). */
const MAX_DPR = 2
const MS_PER_SECOND = 1000
/** Exponential smoothing for the debug fps readout. */
const FPS_SMOOTHING = 0.1
/**
 * Range of the debug wind override, kt. Spans the spec §7.1 tier table and the
 * ceiling the open tier climbs toward, and bottoms out at WIND_AUTO — the off
 * position, where the wind comes from the curve. A debug-tool bound, not a
 * gameplay value, so it lives here rather than in TUNING.
 */
const WIND_SLIDER_MAX = 45
const WIND_SLIDER_STEP = 0.5

/**
 * Keys that are not "any key" (build plan session 10: one key or tap restarts).
 *
 * A modifier held down on its own is a player reaching for a shortcut, not a
 * player asking for another run, and restarting under their hand would take the
 * shortcut away from them.
 */
const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'Tab',
])

const debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1'

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const ctx = canvas.getContext('2d', { alpha: false })!

/**
 * The one read of spec §10, made before the first frame and never repeated.
 * Everything after this works off the copy the session holds, which is what
 * keeps a synchronous, main-thread-blocking API off the update path.
 */
const store = browserStorage()
const session = createRun(loadRecords(store))

/**
 * Both adapters are live at once and write the same struct (spec §5.1). They do
 * not overlap: the desktop one drops pointer events whose type is 'touch' and
 * the touch one takes only those, so a laptop with a touchscreen answers to
 * whichever the player reaches for without either adapter knowing the other
 * exists.
 */
const anchor = createAnchor()
const desktop = createDesktopInput(canvas, session.input, anchor)
const touch = createTouchInput(canvas, session.input, anchor)

/**
 * A seed for the next run.
 *
 * The clock is the shell's to read, never the sim's — a run stays fully
 * described by `(seed, inputTrace)` precisely because the seed is handed in
 * from out here. Without this every run of a session would be the same water,
 * which is a fine way to tune a wave and a poor way to play five runs in a row.
 */
function nextSeed(): number {
  return Date.now() >>> 0
}

/** Starts a run, and saves nothing: the write happens when one ends. */
function ride(direction: number): void {
  startRun(session, direction, nextSeed())
  // The rider moved out from under a pointer that did not, and the target is
  // measured from the rider.
  desktop.refresh()
  touch.refresh()
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
  session.view.width = canvas.clientWidth
  session.view.height = canvas.clientHeight

  const width = Math.round(session.view.width * dpr)
  const height = Math.round(session.view.height * dpr)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  // Resizing the backing store resets the context, so the transform is
  // re-applied on every resize rather than once at startup.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // The rider moved under a pointer that did not: the target angle is measured
  // from the anchor, so it has to be recomputed from the same pointer position.
  desktop.refresh()
  touch.refresh()
}

// devicePixelRatio changes without the CSS size changing when a window moves
// between displays, which no resize event reports. The media query has to be
// rebuilt each time because it tests one specific ratio.
let dprQuery: MediaQueryList | null = null

function onDprChange(): void {
  resize()
  watchDpr()
}

function watchDpr(): void {
  dprQuery?.removeEventListener('change', onDprChange)
  dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  dprQuery.addEventListener('change', onDprChange)
}

/**
 * The lifecycle keys: which way to ride, and how to ride again.
 *
 * At the select screen only the two arrows mean anything, because the screen is
 * asking a question with two answers. At the game-over card everything means
 * "again" — that is build plan session 10's one key, no confirm dialog — and
 * the arrows keep their meaning on top of it, so a player who wants the other
 * side does not have to go back through a menu to get it.
 */
function onLifecycleKey(event: KeyboardEvent): void {
  // A held key repeats. The phase check below would swallow the repeats anyway,
  // but a restart is not something to leave resting on that.
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return

  const left = event.code === 'ArrowLeft' || event.code === 'KeyA'
  const right = event.code === 'ArrowRight' || event.code === 'KeyD'

  if (session.phase === RUN.SELECT) {
    if (left) ride(DIRECTION.LEFT)
    else if (right) ride(DIRECTION.RIGHT)
    return
  }

  if (session.phase !== RUN.OVER || MODIFIER_CODES.has(event.code)) return
  ride(left ? DIRECTION.LEFT : right ? DIRECTION.RIGHT : session.direction)
}

/**
 * The same, by thumb (spec §5.3).
 *
 * At the select screen the side of the screen tapped is the side ridden, which
 * needs no legend beyond the two words already on it. At the game-over card any
 * tap goes again.
 *
 * Bound after both input adapters so it runs after them: they will have set the
 * load from this very tap, and `startRun` drops it — a tap that restarts the
 * game is a tap, not the beginning of an edge.
 */
function onLifecyclePointer(event: PointerEvent): void {
  if (session.phase === RUN.SELECT) {
    const rect = canvas.getBoundingClientRect()
    ride(event.clientX - rect.left < rect.width * 0.5 ? DIRECTION.LEFT : DIRECTION.RIGHT)
    return
  }

  if (session.phase === RUN.OVER) ride(session.direction)
}

/**
 * Watched in the debug panel: the values the window is tuned against (build
 * plan session 3), what the load and pop are doing (session 4), the air and the
 * landing verdict (session 5), the kicker the last pop came off and how far from
 * the lip it went (session 6), then the loop diagnostics. Pre-allocated, and
 * only written when the panel is up, so the loop stays allocation-free either
 * way — `state` is seeded with a phase name so the panel builds a string
 * monitor for it rather than a numeric one.
 *
 * `lipDelta` is the miss on the last pop and `lipAhead` the one being set up
 * right now, both in seconds: negative early, positive late. Between them they
 * answer the question the build plan's turn 3 asks the telegraph to answer.
 *
 * `obstacle` is the metres left to the next thing that has to be jumped, and
 * `hit` the one that ended the run — contact is fatal (spec §7.2), so `over`
 * goes with it. Then the run structure of session 9: which tier the distance
 * has reached, and the score, combo and near-miss bonus that tier is paying
 * (§7.1, §8). Last the lifecycle of session 10: which of the three states the
 * session is in, which way it is riding, the seed it is riding on, and the two
 * records standing in the water (§8.4, §10). Pre-allocated, and only written
 * when the panel is up, so the loop stays allocation-free either way — `state`,
 * `reason`, `hit`, `over` and `run` are seeded with strings so the panel builds
 * string monitors for them rather than numeric ones.
 */
const readout = {
  kiteAngle: 0,
  kiteTarget: 0,
  speed: 0,
  wind: 0,
  load: 0,
  state: PHASE.RIDING as string,
  altitude: 0,
  vSpeed: 0,
  apex: 0,
  airTime: 0,
  descent: 0,
  quality: 0,
  reason: LAND_REASON.NONE as string,
  lastPop: 0,
  kicker: 1,
  lipDelta: 0,
  lipAhead: 0,
  obstacle: 0,
  hit: 'none' as string,
  tier: 0,
  score: 0,
  combo: 0,
  lastJump: 0,
  clearBonus: 0,
  bestJump: 0,
  over: 'no' as string,
  run: RUN.SELECT as string,
  facing: 1,
  seed: 0,
  pbJump: 0,
  pbDistance: 0,
  fps: 0,
  tick: 0,
  time: 0,
  steps: 0,
  alpha: 0,
}

/**
 * Metres from the rider to the gate of the next obstacle ahead — a wake lip for
 * a boat, the object itself otherwise — or Infinity with nothing in front.
 *
 * Walks the pool rather than caching: it is eight slots once a frame, on the
 * render side of the loop where a debug readout belongs.
 */
function gapToNextObstacle(state: SimState): number {
  const obstacles = state.world.obstacles
  let nearest = Infinity

  for (let i = 0; i < obstacles.length; i++) {
    if (!obstacles[i].active) continue
    const ahead = obstacles[i].gateX - state.rider.x
    if (ahead > 0 && ahead < nearest) nearest = ahead
  }

  return nearest
}

let previousTime = 0

function frame(now: number): void {
  requestAnimationFrame(frame)

  // The first frame has no previous timestamp to measure against; a zero
  // frame time simply advances the accumulator by nothing.
  const frameTime = previousTime === 0 ? 0 : (now - previousTime) / MS_PER_SECOND
  previousTime = now

  // The one write of spec §10, on the one frame a run ends. Everything the card
  // about to be drawn needs is already in memory; this is only the disk
  // catching up, and it is why storage never appears on the update path.
  if (advanceRun(session, frameTime)) saveRecords(store, session.best)

  const { camera, effects, view } = session

  // The input maps the pointer to an angle around the point the lines converge
  // on, which is where the camera has just put it — mirrored with the rest of
  // the world when the run is going left (spec §6.5).
  anchor.x = mirrorX(view.width, session.direction, camera.anchorX)
  anchor.y = camera.harnessY
  anchor.facing = session.direction

  drawScene(ctx, camera, view, effects, session.marks)

  // The readout is a readout of a run: there is nothing for it to say before
  // one has started, and the select screen is quieter without it.
  if (session.phase !== RUN.SELECT) drawHud(ctx, session.hud, view, effects)

  if (session.phase === RUN.SELECT) {
    drawSelect(ctx, session.overlay, view, session.records)
  } else if (session.phase === RUN.OVER) {
    drawGameOver(ctx, session.overlay, view, session.records, session.breaks)
  }

  if (debugEnabled) {
    const state = session.state
    if (frameTime > 0) {
      readout.fps += (1 / frameTime - readout.fps) * FPS_SMOOTHING
    }
    readout.kiteAngle = state.rider.kite.angle
    readout.kiteTarget = state.rider.kite.target
    readout.speed = state.rider.speed
    readout.wind = state.wind
    readout.load = state.rider.load
    readout.state = state.rider.phase
    readout.altitude = state.rider.altitude
    readout.vSpeed = state.rider.vSpeed
    readout.apex = state.rider.apex
    readout.airTime = state.rider.airTime
    readout.descent = state.rider.descentRate
    readout.quality = state.rider.landingQuality
    readout.reason = state.rider.landingReason
    readout.lastPop = state.rider.lastPop
    readout.kicker = state.rider.lastKicker
    readout.lipDelta = state.rider.lastLip
    readout.lipAhead = state.kicker.delta
    readout.obstacle = gapToNextObstacle(state)
    if (state.hit !== null) readout.hit = state.hit.type
    readout.tier = state.tier
    readout.score = state.score.total
    readout.combo = state.score.combo
    readout.lastJump = state.score.lastJump
    readout.clearBonus = state.score.lastBonus
    readout.bestJump = state.score.bestJump
    readout.over = state.over ? 'RUN OVER' : 'no'
    readout.run = session.phase
    readout.facing = session.direction
    readout.seed = session.seed
    readout.pbJump = session.records.jump
    readout.pbDistance = session.records.distance
    readout.tick = state.tick
    readout.time = state.time
    readout.steps = session.steps
    readout.alpha = session.accumulator.alpha
  }
}

new ResizeObserver(resize).observe(canvas)
resize()
watchDpr()

// Bound after the two input adapters, so the lifecycle handler runs after them
// and `startRun` has the last word on what the player is holding.
window.addEventListener('keydown', onLifecycleKey)
canvas.addEventListener('pointerdown', onLifecyclePointer)

// Spec §5.4. The lock is best-effort — the rotate prompt in index.html is the
// half that always works — and the audio context can only be opened from inside
// a gesture, so the first one the player makes is the one that opens it.
lockLandscape()
unlockAudioOnFirstGesture(window)

requestAnimationFrame(frame)

if (debugEnabled) {
  // Dynamic so Tweakpane lands in its own chunk and never ships to players.
  void import('./debug/panel.ts').then((panel) =>
    panel.createDebugPanel(readout, [
      {
        target: session.state,
        key: 'windOverride',
        label: `wind kt (${WIND_AUTO} = curve)`,
        min: WIND_AUTO,
        max: WIND_SLIDER_MAX,
        step: WIND_SLIDER_STEP,
      },
    ]),
  )
}
