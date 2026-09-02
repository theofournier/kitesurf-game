// Mouse and keyboard → RiderInput (spec §5.2).
//
// An adapter, nothing more: it writes the same two-field struct every other
// platform writes, and holds no game logic of its own. The point→arc mapping is
// not here at all — it lives in [axis.ts](axis.ts), shared with touch, so the
// two platforms cannot drift apart.
import { axisFromPoint, type Anchor } from './axis.ts'
import { CURSOR_CSS } from '../render/cursor.ts'
import type { RiderInput } from '../sim/loop.ts'

export interface DesktopInput {
  /** Recompute the target from the last pointer position. Call after a resize. */
  refresh(): void
  dispose(): void
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
 * It follows from that cursor that the pointer is tracked on `scope` — the
 * window — rather than on the canvas. The canvas fills the viewport, so a send
 * that sweeps past zenith runs the pointer off the left edge — and the angle
 * out there is a perfectly good angle, with a visible cursor sitting on it.
 * Watching only the canvas made that a cliff: the position went unrecorded and
 * the target snapped to an arc endpoint the hand had not asked for. Off the
 * canvas is just another position now. Off the browser entirely reports nothing
 * at all, so the target simply holds where the hand left it, which is what the
 * cursor out there is still showing.
 *
 * Pointer events arrive here for fingers too, and those belong to the touch
 * adapter: they are dropped on sight, so both adapters can be live at once on a
 * hybrid device without fighting over the same struct.
 *
 * `scope` is the window in the app and a stand-in under test — the only reason
 * it is a parameter is that an adapter which reaches for a global cannot be
 * driven headless, and the parity test in tests/input/parity.test.ts has to
 * drive this one for real.
 */
export function createDesktopInput(
  canvas: HTMLCanvasElement,
  input: RiderInput,
  anchor: Anchor,
  scope: EventTarget = window,
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
    input.kiteTarget = axisFromPoint(anchor, pointerX - rect.left, pointerY - rect.top)
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerType === 'touch') return
    pointerX = event.clientX
    pointerY = event.clientY
    hasPointer = true
    applyPointer()
  }

  function setLoading(): void {
    input.loading = keyDown || buttonDown
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'touch' || event.button !== 0) return
    buttonDown = true
    setLoading()
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerType === 'touch' || event.button !== 0) return
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

  // Cast at the boundary: addEventListener is typed by event name on Window but
  // not on the bare EventTarget the test passes in.
  const move = onPointerMove as EventListener
  const down = onPointerDown as EventListener
  const up = onPointerUp as EventListener
  const keyPress = onKeyDown as EventListener
  const keyRelease = onKeyUp as EventListener

  scope.addEventListener('pointermove', move)
  canvas.addEventListener('pointerdown', down)
  scope.addEventListener('pointerup', up)
  scope.addEventListener('keydown', keyPress)
  scope.addEventListener('keyup', keyRelease)
  scope.addEventListener('blur', onBlur)

  return {
    refresh: applyPointer,

    dispose(): void {
      scope.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerdown', down)
      scope.removeEventListener('pointerup', up)
      scope.removeEventListener('keydown', keyPress)
      scope.removeEventListener('keyup', keyRelease)
      scope.removeEventListener('blur', onBlur)
      canvas.style.cursor = previousCursor
    },
  }
}
