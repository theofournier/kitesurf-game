// Entry point: canvas surface, fixed-step loop, optional debug panel.
// Wiring only — game logic lands in /src/sim and drawing in /src/render.
import { advance, createAccumulator, createInput, createSimState } from './sim/loop.ts'

/** Beyond 2x, retina costs fill rate for no visible gain (spec §5.4). */
const MAX_DPR = 2
const MS_PER_SECOND = 1000
/** Placeholder clear colour until the parallax layers land. Matches index.html. */
const CLEAR_COLOR = '#0b1a24'
/** Exponential smoothing for the debug fps readout. */
const FPS_SMOOTHING = 0.1

const debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1'

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const ctx = canvas.getContext('2d', { alpha: false })!

const state = createSimState()
const input = createInput()
const accumulator = createAccumulator()

/** Canvas size in CSS pixels — the coordinate space every draw call works in. */
let viewWidth = 0
let viewHeight = 0

/**
 * Watched in the debug panel. Loop diagnostics for now; sim state joins them as
 * the sim modules land. Pre-allocated, and only written when the panel is up,
 * so the loop stays allocation-free either way.
 */
const readout = { fps: 0, tick: 0, time: 0, steps: 0, alpha: 0 }

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
  viewWidth = canvas.clientWidth
  viewHeight = canvas.clientHeight

  const width = Math.round(viewWidth * dpr)
  const height = Math.round(viewHeight * dpr)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  // Resizing the backing store resets the context, so the transform is
  // re-applied on every resize rather than once at startup.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
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
 * `_alpha` is the interpolation factor between the last two sim steps — unread
 * until there is something to interpolate, but in the signature now so the
 * call site never has to change (spec §11.2).
 */
function render(_alpha: number): void {
  ctx.fillStyle = CLEAR_COLOR
  ctx.fillRect(0, 0, viewWidth, viewHeight)
}

let previousTime = 0

function frame(now: number): void {
  requestAnimationFrame(frame)

  // The first frame has no previous timestamp to measure against; a zero
  // frame time simply advances the accumulator by nothing.
  const frameTime = previousTime === 0 ? 0 : (now - previousTime) / MS_PER_SECOND
  previousTime = now

  const steps = advance(accumulator, state, input, frameTime)
  render(accumulator.alpha)

  if (debugEnabled) {
    if (frameTime > 0) {
      readout.fps += (1 / frameTime - readout.fps) * FPS_SMOOTHING
    }
    readout.tick = state.tick
    readout.time = state.time
    readout.steps = steps
    readout.alpha = accumulator.alpha
  }
}

new ResizeObserver(resize).observe(canvas)
resize()
watchDpr()
requestAnimationFrame(frame)

if (debugEnabled) {
  // Dynamic so Tweakpane lands in its own chunk and never ships to players.
  void import('./debug/panel.ts').then((panel) => panel.createDebugPanel(readout))
}
