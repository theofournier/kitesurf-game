// The rider: one 48px grey box on a board (spec §6.1, build plan session 3).
import { TUNING } from '../config/tuning.ts'
import type { Camera } from './camera.ts'
import { PALETTE } from './palette.ts'

/** Box proportions, in multiples of RIDER_H. A placeholder body, not tuning. */
const BODY_W = 0.34
const BOARD_W = 1.3
const BOARD_H = 0.1

export function drawRider(ctx: CanvasRenderingContext2D, camera: Camera): void {
  const height = TUNING.RIDER_H
  const bodyW = height * BODY_W
  const boardW = height * BOARD_W
  const boardH = height * BOARD_H

  ctx.fillStyle = PALETTE.board
  ctx.fillRect(camera.anchorX - boardW * 0.5, camera.feetY - boardH * 0.5, boardW, boardH)

  ctx.fillStyle = PALETTE.rider
  ctx.fillRect(camera.anchorX - bodyW * 0.5, camera.feetY - height, bodyW, height)

  // A darker band at the harness, so the point the lines pull on is visible.
  ctx.fillStyle = PALETTE.riderDark
  ctx.fillRect(camera.anchorX - bodyW * 0.5, camera.harnessY - boardH * 0.5, bodyW, boardH)
}
