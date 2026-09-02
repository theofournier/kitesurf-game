// Two-thumb touch → RiderInput (spec §5.3).
//
// Landscape, both thumbs down at once, and neither one is a button that moves.
// The left thumb rides the window arc — the same arc the renderer already draws
// (spec §6.2), so the control affordance is the thing it controls, and there is
// no widget to invent. The right third is the load, held anywhere in it, because
// a thumb that has to find a target is a thumb that is not watching the lip.
//
// The mapping is not here: it is [axis.ts](axis.ts), shared with desktop. What
// is here is *which finger is doing what*, which is the only question touch asks
// that a mouse does not.
import { axisFromPoint, type Anchor } from './axis.ts'
import { TUNING } from '../config/tuning.ts'
import type { RiderInput } from '../sim/loop.ts'

/**
 * The smallest a touch target is allowed to be, px (spec §5.3). A floor, not a
 * dial — it is an ergonomic minimum every platform's guidelines agree on, so it
 * does not belong in TUNING with the values that set feel. TOUCH_ARC_SLOP and
 * TOUCH_LOAD_ZONE are free to be more generous than this, and both are; this is
 * what stops either from ever being less.
 */
export const MIN_TARGET = 44

/** No touch is currently filling a role. A pointer id is never negative. */
const NO_TOUCH = -1

/** What a finger is doing. Exactly two roles, because there are two thumbs. */
export const TOUCH_ROLE = {
  NONE: 0,
  STEER: 1,
  LOAD: 2,
} as const

export type TouchRole = (typeof TOUCH_ROLE)[keyof typeof TOUCH_ROLE]

export interface TouchInput {
  /** Recompute the target from the last thumb position. Call after a resize. */
  refresh(): void
  dispose(): void
}

/**
 * Half-thickness of the arc's touch band, px.
 *
 * "Generous hit slop" is doing real work here: on a phone in landscape the arc
 * has a 264px radius on a screen barely 350px tall, so zenith sits off the top
 * of the frame. A band this wide (180px through, by default) means the thumb
 * reaches every angle on the arc without having to trace the drawn line — it
 * only has to be roughly the right *direction* from the rider, which is all the
 * mapping reads anyway.
 */
export function arcSlop(): number {
  const slop = TUNING.TOUCH_ARC_SLOP
  return slop > MIN_TARGET / 2 ? slop : MIN_TARGET / 2
}

/**
 * Width of the load zone, px: the ahead-side share of the screen, floored at a
 * thumb's width so it is a real target on the narrowest phone.
 */
export function loadZoneWidth(width: number): number {
  const share = width * TUNING.TOUCH_LOAD_ZONE
  return share > MIN_TARGET ? share : MIN_TARGET
}

/**
 * Which role a finger landing at `x, y` claims. Canvas CSS pixels.
 *
 * The load zone is tested first and wins outright: "anywhere in the right
 * third" has to mean anywhere, or the player has to look at their thumb. It is
 * the third *ahead* of the rider rather than literally the right of the screen,
 * so it mirrors with the frame when riding left (spec §6.5) and stays the
 * downwind hand.
 *
 * Everything else claims steering if it is inside the arc band. The band is a
 * full annulus, not just the drawn quarter: a thumb below the waterline or
 * behind the rider is at a well-defined angle that the mapping clamps to an arc
 * end, which is exactly what the same gesture does with a mouse.
 */
export function roleAt(anchor: Anchor, width: number, x: number, y: number): TouchRole {
  const along = anchor.facing > 0 ? x : width - x
  if (along >= width - loadZoneWidth(width)) return TOUCH_ROLE.LOAD

  const slop = arcSlop()
  const inner = TUNING.LINE_RADIUS - slop
  const outer = TUNING.LINE_RADIUS + slop
  const dx = x - anchor.x
  const dy = y - anchor.y
  const d2 = dx * dx + dy * dy
  if (inner > 0 && d2 < inner * inner) return TOUCH_ROLE.NONE
  if (d2 > outer * outer) return TOUCH_ROLE.NONE
  return TOUCH_ROLE.STEER
}

/**
 * Attaches touch listeners that drive `input`.
 *
 * Two thumbs, tracked independently by pointer id in two scalar slots rather
 * than a map — there are exactly two roles, so a third finger has nowhere to go
 * and is ignored rather than stealing a role that is already filled. Steering
 * and loading never interfere: the load thumb can come and go mid-sweep and the
 * steering thumb keeps its angle, which is the whole point of a control scheme
 * where the send and the pop happen at the same instant.
 *
 * Once a thumb has claimed the arc it is followed anywhere on the screen,
 * including out of the band and off the canvas. The band decides who is
 * steering; after that the mapping is absolute and unbounded, same as the
 * desktop pointer, and a drag that carries past zenith is a real angle rather
 * than a clamp. Lifting the thumb holds the last angle it gave, for the same
 * reason the mouse leaving the browser does: inventing a target nobody asked
 * for is worse than holding still.
 *
 * Everything binds to the canvas, which fills the viewport, and every claimed
 * pointer is captured — so this adapter never touches `window` and runs headless
 * under test.
 */
export function createTouchInput(
  canvas: HTMLCanvasElement,
  input: RiderInput,
  anchor: Anchor,
): TouchInput {
  let steerId = NO_TOUCH
  let loadId = NO_TOUCH

  // Last steering position in canvas CSS pixels, kept so the target survives
  // the anchor moving under a still thumb — a resize, or the rider rising.
  let steerX = 0
  let steerY = 0

  function applySteer(): void {
    if (steerId === NO_TOUCH) return
    input.kiteTarget = axisFromPoint(anchor, steerX, steerY)
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch') return
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const role = roleAt(anchor, rect.width, x, y)

    if (role === TOUCH_ROLE.LOAD) {
      if (loadId !== NO_TOUCH) return
      loadId = event.pointerId
      input.loading = true
    } else if (role === TOUCH_ROLE.STEER) {
      if (steerId !== NO_TOUCH) return
      steerId = event.pointerId
      steerX = x
      steerY = y
      applySteer()
    } else {
      return
    }

    // The finger is ours now: capture keeps its moves and its lift coming here
    // even if it wanders off the element, and the default action — the
    // synthetic mouse events the desktop adapter would otherwise see — is not
    // wanted. `touch-action: none` (spec §5.4) handles the scrolling.
    canvas.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== steerId) return
    const rect = canvas.getBoundingClientRect()
    steerX = event.clientX - rect.left
    steerY = event.clientY - rect.top
    applySteer()
  }

  /** A lift, a cancel, or a capture lost to the system are all the same event. */
  function onPointerEnd(event: PointerEvent): void {
    if (event.pointerId === steerId) {
      steerId = NO_TOUCH
    } else if (event.pointerId === loadId) {
      loadId = NO_TOUCH
      input.loading = false
    }
  }

  const down = onPointerDown as EventListener
  const move = onPointerMove as EventListener
  const end = onPointerEnd as EventListener

  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)

  return {
    refresh: applySteer,

    dispose(): void {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', end)
      canvas.removeEventListener('pointercancel', end)
      if (loadId !== NO_TOUCH) input.loading = false
      steerId = NO_TOUCH
      loadId = NO_TOUCH
    },
  }
}
