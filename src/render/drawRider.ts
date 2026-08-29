// The rider: one 48px grey box on a board (spec §6.1, build plan session 3).
//
// Three poses, because the phase machine (spec §3.7) has to be readable from
// the rider's own silhouette and not only from the effects over the top of it:
// upright while riding, compressed through the landing beat, and face-down in
// the water through a wipeout.
import { TUNING } from '../config/tuning.ts'
import { PHASE } from '../sim/rider.ts'
import type { Camera } from './camera.ts'
import { PALETTE } from './palette.ts'
import type { RenderView } from './view.ts'

/** Box proportions, in multiples of RIDER_H. A placeholder body, not tuning. */
const BODY_W = 0.34
const BOARD_W = 1.3
const BOARD_H = 0.1

/** How far the landing beat compresses the body: a stomp, not a squat. */
const CROUCH = 0.82
/** Where the wipeout leaves the board, in multiples of RIDER_H, and its tilt. */
const WIPEOUT_BOARD_X = 0.55
const WIPEOUT_BOARD_TILT = -0.9 // radians

/**
 * The wipeout pose: the rider on their face in the water with the board thrown
 * clear. Read together with the world scrolling to a dead stop (§7.2 takes all
 * the speed), this is the crash, told without a word of text.
 */
function drawWipeout(ctx: CanvasRenderingContext2D, camera: Camera): void {
  const height = TUNING.RIDER_H
  const bodyW = height * BODY_W
  const boardW = height * BOARD_W
  const boardH = height * BOARD_H

  // The board, up on its edge where it was ripped off the feet.
  ctx.save()
  ctx.translate(camera.anchorX + height * WIPEOUT_BOARD_X, camera.feetY)
  ctx.rotate(WIPEOUT_BOARD_TILT)
  ctx.fillStyle = PALETTE.board
  ctx.fillRect(-boardW * 0.5, -boardH * 0.5, boardW, boardH)
  ctx.restore()

  // The body, lying along the surface — the long axis is horizontal now, which
  // is the whole of the read at a glance.
  ctx.fillStyle = PALETTE.rider
  ctx.fillRect(camera.anchorX - height * 0.5, camera.feetY - bodyW, height, bodyW)

  ctx.fillStyle = PALETTE.riderDark
  ctx.fillRect(camera.anchorX - height * 0.5, camera.feetY - bodyW, boardH, bodyW)
}

export function drawRider(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: RenderView,
): void {
  if (view.phase === PHASE.WIPEOUT) {
    drawWipeout(ctx, camera)
    return
  }

  const height = TUNING.RIDER_H * (view.phase === PHASE.LANDING ? CROUCH : 1)
  const bodyW = TUNING.RIDER_H * BODY_W
  const boardW = TUNING.RIDER_H * BOARD_W
  const boardH = TUNING.RIDER_H * BOARD_H

  ctx.fillStyle = PALETTE.board
  ctx.fillRect(camera.anchorX - boardW * 0.5, camera.feetY - boardH * 0.5, boardW, boardH)

  ctx.fillStyle = PALETTE.rider
  ctx.fillRect(camera.anchorX - bodyW * 0.5, camera.feetY - height, bodyW, height)

  // A darker band at the harness, so the point the lines pull on is visible.
  ctx.fillStyle = PALETTE.riderDark
  ctx.fillRect(camera.anchorX - bodyW * 0.5, camera.harnessY - boardH * 0.5, bodyW, boardH)
}
