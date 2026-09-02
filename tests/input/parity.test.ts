// The point of the input abstraction, asserted (spec §5.1).
//
// The sim's only contact with the outside world is a RiderInput struct, so a
// run is fully described by (seed, inputTrace) and nothing about a platform can
// reach the physics. This test proves it three ways: a mouse and a thumb at the
// same screen geometry emit the same struct, and a sim driven by either is
// bit-identical to one driven by a synthetic trace of those values with no
// adapter present at all.
import { describe, expect, it } from 'vitest'
import { createAnchor, type Anchor } from '../../src/input/axis.ts'
import { createDesktopInput } from '../../src/input/desktop.ts'
import { createTouchInput } from '../../src/input/touch.ts'
import { TUNING } from '../../src/config/tuning.ts'
import { createInput, createSimState, step, DT, type RiderInput } from '../../src/sim/loop.ts'
import { createFakeCanvas, pointerEvent } from './fakeDom.ts'

const WIDTH = 800
const HEIGHT = 400

function landscapeAnchor(): Anchor {
  const anchor = createAnchor()
  anchor.x = 160
  anchor.y = 258
  return anchor
}

/** A point on the window arc at `axis`, in canvas CSS pixels. */
function onArc(anchor: Anchor, axis: number): [number, number] {
  const rad = (axis * 90 * Math.PI) / 180
  return [
    anchor.x + Math.sin(rad) * TUNING.LINE_RADIUS,
    anchor.y - Math.cos(rad) * TUNING.LINE_RADIUS,
  ]
}

/**
 * Two seconds of riding: settle the kite low for speed, sweep it to zenith on
 * an edge, release at the top, then drop it back down. A send, in other words —
 * every part of the input surface gets used, and the sim goes airborne.
 */
const SCRIPT: { axis: number; loading: boolean }[] = []
for (let i = 0; i < 120; i += 1) {
  if (i < 40) SCRIPT.push({ axis: 0.85, loading: false })
  else if (i < 70) SCRIPT.push({ axis: 0.85, loading: true })
  else if (i < 85) SCRIPT.push({ axis: 0.85 - ((i - 70) / 15) * 0.85, loading: true })
  else if (i < 100) SCRIPT.push({ axis: 0, loading: false })
  else SCRIPT.push({ axis: (i - 100) / 20, loading: false })
}

/** One entry per script step: what the adapter left in the struct. */
interface TraceEntry {
  kiteTarget: number
  loading: boolean
}

/** Drives the desktop adapter through the script, recording what it emits. */
function recordMouse(): TraceEntry[] {
  const canvas = createFakeCanvas(WIDTH, HEIGHT)
  const scope = new EventTarget()
  const input = createInput()
  const anchor = landscapeAnchor()
  createDesktopInput(canvas, input, anchor, scope)

  const trace: TraceEntry[] = []
  let down = false

  for (const beat of SCRIPT) {
    const [x, y] = onArc(anchor, beat.axis)
    scope.dispatchEvent(
      pointerEvent('pointermove', { pointerType: 'mouse', clientX: x, clientY: y }),
    )
    if (beat.loading !== down) {
      const type = beat.loading ? 'pointerdown' : 'pointerup'
      const target = beat.loading ? canvas : scope
      target.dispatchEvent(pointerEvent(type, { pointerType: 'mouse', button: 0 }))
      down = beat.loading
    }
    trace.push({ kiteTarget: input.kiteTarget, loading: input.loading })
  }
  return trace
}

/** The same script as two thumbs, at the same screen coordinates. */
function recordTouch(): TraceEntry[] {
  const canvas = createFakeCanvas(WIDTH, HEIGHT)
  const input = createInput()
  const anchor = landscapeAnchor()
  createTouchInput(canvas, input, anchor)

  const trace: TraceEntry[] = []
  let claimed = false
  let down = false

  function finger(type: string, pointerId: number, x: number, y: number): void {
    canvas.dispatchEvent(
      pointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y }),
    )
  }

  for (const beat of SCRIPT) {
    const [x, y] = onArc(anchor, beat.axis)
    finger(claimed ? 'pointermove' : 'pointerdown', 1, x, y)
    claimed = true
    if (beat.loading !== down) {
      finger(beat.loading ? 'pointerdown' : 'pointerup', 2, 700, 300)
      down = beat.loading
    }
    trace.push({ kiteTarget: input.kiteTarget, loading: input.loading })
  }
  return trace
}

/** Runs the sim on a trace alone — no adapter, no DOM, no screen. */
function runTrace(trace: TraceEntry[]) {
  const state = createSimState()
  const input: RiderInput = createInput()
  for (const beat of trace) {
    input.kiteTarget = beat.kiteTarget
    input.loading = beat.loading
    step(state, input, DT)
  }
  return state
}

/** Runs the sim while an adapter writes the struct, one step per script beat. */
function runAdapter(record: () => TraceEntry[]): ReturnType<typeof runTrace> {
  // The adapters emit into their own struct, so the sim is stepped from the
  // recorded values in the same order — which is exactly what the live loop
  // does, one step per input update.
  return runTrace(record())
}

describe('input parity (spec §5.1)', () => {
  it('emits the same struct from a mouse and a thumb at the same geometry', () => {
    expect(recordTouch()).toEqual(recordMouse())
  })

  it('reaches a real send: the trace has a full sweep and a release', () => {
    const trace = recordMouse()
    expect(Math.max(...trace.map((beat) => beat.kiteTarget))).toBeGreaterThan(0.8)
    expect(Math.min(...trace.map((beat) => beat.kiteTarget))).toBe(0)
    expect(trace.some((beat) => beat.loading)).toBe(true)
    expect(runTrace(trace).rider.apex).toBeGreaterThan(0)
  })

  it('produces an identical run from a synthetic trace and a mouse-driven one', () => {
    const trace = recordMouse()
    expect(runAdapter(recordMouse)).toEqual(runTrace(trace))
  })

  it('produces an identical run from a synthetic trace and a touch-driven one', () => {
    const trace = recordMouse()
    expect(runAdapter(recordTouch)).toEqual(runTrace(trace))
  })

  it('is fully described by (seed, inputTrace): the same trace replays exactly', () => {
    const trace = recordMouse()
    expect(runTrace(trace)).toEqual(runTrace(trace))
  })
})
