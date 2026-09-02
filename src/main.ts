// Entry point: canvas surface, fixed-step loop, input adapter, optional debug
// panel. Wiring only — game logic lives in /src/sim and drawing in /src/render.
import { createAnchor } from './input/axis.ts'
import { createDesktopInput } from './input/desktop.ts'
import { createTouchInput } from './input/touch.ts'
import { unlockAudioOnFirstGesture } from './platform/audio.ts'
import { lockLandscape } from './platform/orientation.ts'
import { advance, createAccumulator, createInput, createSimState } from './sim/loop.ts'
import { LAND_REASON, PHASE } from './sim/rider.ts'
import { WIND_AUTO } from './sim/world.ts'
import { createCamera, updateCamera } from './render/camera.ts'
import { createEffects, updateEffects } from './render/effects.ts'
import { drawScene } from './render/scene.ts'
import { captureSnapshot, createSnapshot, createView, interpolateView } from './render/view.ts'

/** Beyond 2x, retina costs fill rate for no visible gain (spec §5.4). */
const MAX_DPR = 2
const MS_PER_SECOND = 1000
/** Exponential smoothing for the debug fps readout. */
const FPS_SMOOTHING = 0.1
/**
 * Range of the debug wind override, kt. Spans the spec §7.1 tier table with
 * room above tier 4, and bottoms out at WIND_AUTO — the off position, where
 * the wind comes from the curve. A debug-tool bound, not a gameplay value, so
 * it lives here rather than in TUNING.
 */
const WIND_SLIDER_MAX = 40
const WIND_SLIDER_STEP = 0.5

const debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1'

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const ctx = canvas.getContext('2d', { alpha: false })!

const state = createSimState()
const input = createInput()
const accumulator = createAccumulator()

const camera = createCamera()
const view = createView()
const effects = createEffects()
/**
 * The two sim snapshots the render interpolates between: `previous` is the
 * state before the most recent step, `pending` is the one being captured for
 * the step about to run. They are swapped rather than copied, so a frame still
 * allocates nothing.
 */
let previous = createSnapshot()
let pending = createSnapshot()

/**
 * Both adapters are live at once and write the same struct (spec §5.1). They do
 * not overlap: the desktop one drops pointer events whose type is 'touch' and
 * the touch one takes only those, so a laptop with a touchscreen answers to
 * whichever the player reaches for without either adapter knowing the other
 * exists.
 */
const anchor = createAnchor()
const desktop = createDesktopInput(canvas, input, anchor)
const touch = createTouchInput(canvas, input, anchor)

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
  view.width = canvas.clientWidth
  view.height = canvas.clientHeight

  const width = Math.round(view.width * dpr)
  const height = Math.round(view.height * dpr)
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
  fps: 0,
  tick: 0,
  time: 0,
  steps: 0,
  alpha: 0,
}

let previousTime = 0

function frame(now: number): void {
  requestAnimationFrame(frame)

  // The first frame has no previous timestamp to measure against; a zero
  // frame time simply advances the accumulator by nothing.
  const frameTime = previousTime === 0 ? 0 : (now - previousTime) / MS_PER_SECOND
  previousTime = now

  captureSnapshot(pending, state)
  const steps = advance(accumulator, state, input, frameTime)
  // On a frame that ran no step there is nothing new to interpolate from, and
  // `previous` must keep pointing at the step before the current state.
  if (steps > 0) {
    const spent = previous
    previous = pending
    pending = spent
  }

  interpolateView(view, previous, state, accumulator.alpha)
  updateCamera(camera, view.width, view.height, view.x, view.altitude, frameTime)

  // The input maps the pointer to an angle around the point the lines converge
  // on, which is where the camera has just put it.
  anchor.x = camera.anchorX
  anchor.y = camera.harnessY

  updateEffects(effects, camera, view, frameTime)
  drawScene(ctx, camera, view, effects)

  if (debugEnabled) {
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
    readout.tick = state.tick
    readout.time = state.time
    readout.steps = steps
    readout.alpha = accumulator.alpha
  }
}

new ResizeObserver(resize).observe(canvas)
resize()
watchDpr()

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
        target: state,
        key: 'windOverride',
        label: `wind kt (${WIND_AUTO} = curve)`,
        min: WIND_AUTO,
        max: WIND_SLIDER_MAX,
        step: WIND_SLIDER_STEP,
      },
    ]),
  )
}
