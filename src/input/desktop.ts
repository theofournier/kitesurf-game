// Mouse and keyboard → RiderInput (spec §5.2).
//
// An adapter, nothing more: it writes the same two-field struct every other
// platform writes, and holds no game logic of its own. The pointer→arc mapping
// is exported separately so it can be tested without a DOM.
import { CURSOR_CSS } from '../render/cursor.ts'
import { WINDOW_MAX, WINDOW_MIN } from '../sim/kite.ts'
import type { RiderInput } from '../sim/loop.ts'

const RAD2DEG = 180 / Math.PI

/** Where on screen the rider is, in CSS pixels, and which way it is riding. */
export interface Anchor {
  x: number
  y: number
  /** +1 riding right, -1 riding left — the world mirror of spec §6.5. */
  facing: number
}

export interface DesktopInput {
  /** Recompute the target from the last pointer position. Call after a resize. */
  refresh(): void
  dispose(): void
}

export function createAnchor(): Anchor {
  return { x: 0, y: 0, facing: 1 }
}

/**
 * Pointer offset from the rider → position along the window arc, 0..1.
 *
 * Absolute mapping, not pointer-lock deltas (spec §5.2): the angle from the
 * rider to the pointer *is* the kite position, so where your hand is on the
 * desk is where the kite is on the arc. Distance is ignored — only the angle
 * matters, since the kite orbits at a fixed radius (spec §6.2).
 *
 * `dx` is measured in the direction of travel and `dyUp` upward, so both are
 * positive toward the front of the window. Straight up is zenith (0), straight
 * ahead is the edge of the window (1), and anything outside the quarter — the
 * pointer behind the rider, or below the waterline — clamps to whichever end it
 * is nearest.
 */
export function axisFromOffset(dx: number, dyUp: number): number {
  // atan2(x, y) rather than the usual (y, x): the angle is measured from
  // straight up, which is how the window is defined (spec §3.1).
  const deg = Math.atan2(dx, dyUp) * RAD2DEG
  if (!(deg > WINDOW_MIN)) return 0
  if (deg >= WINDOW_MAX) return 1
  return deg / WINDOW_MAX
}

/**
 * Attaches mouse and keyboard listeners that drive `input`.
 *
 * `input` and `anchor` are owned by the caller and are never replaced, only
 * written — the loop reads the same object every frame and nothing allocates.
 *
 * The system cursor stays visible, wearing the reticle from
 * [render/cursor.ts](../render/cursor.ts), which is a deliberate
 * departure from spec §5.2's "system cursor hidden". A send sweeps the hand
 * from the edge of the window up to zenith, and hands overshoot: the pointer
 * carries behind the rider, where the mapping clamps and the kite stops
 * answering. With nothing drawn there — the ghost marker only lives on the arc
 * — the player had no idea how far past the end their hand had gone, or which
 * way to bring it back. The OS cursor is the one marker that is always on
 * screen, including off the canvas entirely, and it is composited rather than
 * drawn, so it costs the frame nothing. A reticle rather than an arrow: its
 * hotspot is its own centre, which is what an aiming control wants. Its
 * appearance is the one part of this adapter that is a drawn thing, so it lives
 * with the rest of the drawing.
 *
 * It follows from that cursor that the pointer is tracked on `window` rather
 * than on the canvas. The canvas fills the viewport, so a send that sweeps past
 * zenith runs the pointer off the left edge — and the angle out there is a
 * perfectly good angle, with a visible cursor sitting on it. Watching only the
 * canvas made that a cliff: the position went unrecorded and the target snapped
 * to an arc endpoint the hand had not asked for. Off the canvas is just another
 * position now. Off the browser entirely reports nothing at all, so the target
 * simply holds where the hand left it, which is what the cursor out there is
 * still showing.
 */
export function createDesktopInput(
  canvas: HTMLCanvasElement,
  input: RiderInput,
  anchor: Anchor,
): DesktopInput {
  const previousCursor = canvas.style.cursor
  canvas.style.cursor = CURSOR_CSS

  // Last pointer position in CSS pixels, kept so the target can be recomputed
  // when the anchor moves under a still pointer — a resize, or the rider
  // rising in frame.
  let pointerX = 0
  let pointerY = 0
  /**
   * Whether a pointer has ever been seen. Only false before the first move:
   * once there is a position it is never given up, because the alternative is
   * inventing a target the hand did not ask for.
   */
  let hasPointer = false

  /** True while the pop key or button is down. Either alone holds the load. */
  let keyDown = false
  let buttonDown = false

  function applyPointer(): void {
    if (!hasPointer) return
    const rect = canvas.getBoundingClientRect()
    const dx = (pointerX - rect.left - anchor.x) * anchor.facing
    const dyUp = anchor.y - (pointerY - rect.top)
    input.kiteTarget = axisFromOffset(dx, dyUp)
  }

  function onPointerMove(event: PointerEvent): void {
    pointerX = event.clientX
    pointerY = event.clientY
    hasPointer = true
    applyPointer()
  }

  function setLoading(): void {
    input.loading = keyDown || buttonDown
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    buttonDown = true
    setLoading()
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.button !== 0) return
    buttonDown = false
    setLoading()
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'Space' || event.repeat) return
    // Space scrolls the page by default, which is not what a load looks like.
    event.preventDefault()
    keyDown = true
    setLoading()
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.code !== 'Space') return
    keyDown = false
    setLoading()
  }

  function onBlur(): void {
    // A held key that is released while the tab is elsewhere never reports its
    // keyup, and the rider would load forever.
    keyDown = false
    buttonDown = false
    setLoading()
  }

  window.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  return {
    refresh: applyPointer,

    dispose(): void {
      window.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      canvas.style.cursor = previousCursor
    },
  }
}
