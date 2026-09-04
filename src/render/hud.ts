// The run readout: which tier the rider is in, how fast the wind and the board
// are moving, what the run is worth, and what the combo is standing at
// (spec §7.1, §8).
//
// It stays deliberately thin. Spec §8.4 puts the *records* in the world rather
// than in a HUD — a buoy at the distance PB, a line in the sky at the jump PB —
// and that is a later session's work; nothing here is allowed to grow into it.
// What is here is the live state of the two multipliers the player is steering
// with, plus the tier banner that spec §7.1 asks a boundary to announce itself
// with.
//
// Every string it draws is cached against the rounded number that produced it,
// so a frame that changes nothing allocates nothing — the same reasoning as the
// spray pool, applied to text.
import { TUNING } from '../config/tuning.ts'
import { PHASE } from '../sim/rider.ts'
import { TIER_FLASH_TIME, verdictColor, type Effects } from './effects.ts'
import { PALETTE } from './palette.ts'
import type { RenderView } from './view.ts'

/** Where the readout sits, px from the top-left of the frame. */
const PAD = 18
const LINE = 20

/**
 * How far right of the combo the jump score sits, px. A fixed slot rather than
 * a measured one: the combo is never wider than "10x", and measuring text every
 * frame to place a label that is up for less than a second is not a trade worth
 * making.
 */
const JUMP_X = 46
/** How far the jump score drifts up as it fades. */
const JUMP_RISE = 12
/** Tenths of a m/s: what the speed readout is rounded to before it is drawn. */
const SPEED_ROUND = 10

const TIER_PX = 15
const TIER_FONT = `bold ${TIER_PX}px system-ui, -apple-system, sans-serif`
const SCORE_PX = 26
const SCORE_FONT = `bold ${SCORE_PX}px system-ui, -apple-system, sans-serif`
const SMALL_PX = 13
const SMALL_FONT = `${SMALL_PX}px system-ui, -apple-system, sans-serif`

/** The banner: centred, high, and out of the way of the rider's own line. */
const BANNER_PX = 34
const BANNER_FONT = `bold ${BANNER_PX}px system-ui, -apple-system, sans-serif`
const BANNER_Y = 0.22
const BANNER_RISE = 26

/** The word a fatal crash leaves on screen (spec §7.2). */
const OVER_PX = 40
const OVER_FONT = `bold ${OVER_PX}px system-ui, -apple-system, sans-serif`
const OVER_LABEL = 'RUN OVER'

/**
 * The one instruction in the game (spec §7.2).
 *
 * The relaunch is a skill check, and a skill check the player cannot see is
 * just a stalled game: the kite is in the water, nothing is moving, and until
 * they take it out to the edge of the window nothing will. Everything else the
 * player learns by doing; this they have to be told once.
 */
const RELAUNCH_LABEL = 'STEER THE KITE TO THE EDGE'
const RELAUNCH_PX = 16
const RELAUNCH_FONT = `bold ${RELAUNCH_PX}px system-ui, -apple-system, sans-serif`
const RELAUNCH_Y = 0.3

/**
 * Tier names, indexed by tier. A fixed table rather than a formatted string:
 * there are only ever four of them, and this way the common case draws without
 * touching the allocator at all.
 */
const TIER_LABEL = ['TIER 1', 'TIER 1', 'TIER 2', 'TIER 3', 'TIER 4']

/**
 * The formatted text of one frame, and the rounded numbers it was built from.
 *
 * A HUD is numbers, and numbers become strings — but they only become *new*
 * strings when the number a player can actually read has changed. At 60fps the
 * wind moves a whole knot every few seconds and the score every few frames, so
 * this is the difference between a handful of strings a second and several
 * hundred.
 */
export interface Hud {
  stat: string
  statWind: number
  statSpeed: number
  statX: number
  score: string
  scoreValue: number
  combo: string
  comboValue: number
  jump: string
  jumpValue: number
  banner: string
  bannerWind: number
  over: string
  overValue: number
}

export function createHud(): Hud {
  return {
    stat: '',
    statWind: Number.NaN,
    statSpeed: Number.NaN,
    statX: Number.NaN,
    score: '',
    scoreValue: Number.NaN,
    combo: '',
    comboValue: Number.NaN,
    jump: '',
    jumpValue: Number.NaN,
    banner: '',
    bannerWind: Number.NaN,
    over: '',
    overValue: Number.NaN,
  }
}

/** The tier label for a tier, held inside the table however the table moves. */
export function tierLabel(tier: number): string {
  const at = tier < 1 ? 1 : tier >= TIER_LABEL.length ? TIER_LABEL.length - 1 : tier
  return TIER_LABEL[at]
}

/** Draws `text` with the dark halo that keeps it legible over sky and sea. */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  colour: string,
): void {
  ctx.font = font
  ctx.fillStyle = PALETTE.hudShadow
  ctx.fillText(text, x + 1, y + 1)
  ctx.fillStyle = colour
  ctx.fillText(text, x, y)
}

/** Rebuilds the cached strings, and only the ones whose number has moved. */
function format(hud: Hud, view: RenderView): void {
  const wind = Math.round(view.wind)
  // Board speed to a tenth. Whole m/s is too coarse to see an edge scrubbing
  // speed off, and the decimals below a tenth are noise at any refresh rate.
  const speed = Math.round(view.speed * SPEED_ROUND)
  const x = Math.round(view.x)
  if (wind !== hud.statWind || speed !== hud.statSpeed || x !== hud.statX) {
    hud.statWind = wind
    hud.statSpeed = speed
    hud.statX = x
    hud.stat = `${wind}kt · ${(speed / SPEED_ROUND).toFixed(1)}m/s · ${x}m`
  }

  const total = Math.round(view.score.total)
  if (total !== hud.scoreValue) {
    hud.scoreValue = total
    hud.score = `${total}`
  }

  if (view.score.combo !== hud.comboValue) {
    hud.comboValue = view.score.combo
    hud.combo = `${view.score.combo}x`
  }

  const jump = Math.round(view.score.lastJump)
  if (jump !== hud.jumpValue) {
    hud.jumpValue = jump
    hud.jump = `+${jump}`
  }

  if (wind !== hud.bannerWind) {
    hud.bannerWind = wind
    hud.banner = `${wind}kt`
  }

  if (view.over && total !== hud.overValue) {
    hud.overValue = total
    hud.over = `${total} · ${x}m`
  }
}

/**
 * Draws the run readout and, while one is running, the tier banner.
 *
 * Everything is rounded on the way to the screen. A score counting through its
 * own decimals reads as noise, and the sim keeps the exact value anyway — this
 * is a readout of the number, not the number.
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  hud: Hud,
  view: RenderView,
  fx: Effects,
): void {
  format(hud, view)
  ctx.textAlign = 'left'

  const top = PAD + TIER_PX
  label(ctx, tierLabel(view.tier), PAD, top, TIER_FONT, PALETTE.hud)
  label(ctx, hud.stat, PAD, top + LINE, SMALL_FONT, PALETTE.hudDim)
  label(ctx, hud.score, PAD, top + LINE + SCORE_PX + 8, SCORE_FONT, PALETTE.hud)

  // The combo is only news while it is standing above 1x — at 1x there is
  // nothing to lose and nothing to say.
  const comboY = top + LINE * 2 + SCORE_PX + 8
  if (view.score.combo > 1) {
    label(ctx, hud.combo, PAD, comboY, TIER_FONT, PALETTE.tierFlash)
  }

  drawJump(ctx, hud, view, fx, comboY)
  drawTierBanner(ctx, hud, view, fx)
  drawRelaunch(ctx, view)
  drawGameOver(ctx, hud, view)
}

/**
 * What the jump just landed was worth, beside the combo it was paid at.
 *
 * Up for the same beat as the landing verdict and in the same colour, because
 * they are two halves of one answer: the word says how the landing went and
 * this says what it bought. Without it the score is a number that jumps by
 * hundreds with nothing to attribute it to — which of the four multipliers
 * moved is exactly what a player is trying to learn.
 *
 * A wipeout has nothing to show: it scored zero, and the word WIPEOUT has
 * already said so.
 */
function drawJump(
  ctx: CanvasRenderingContext2D,
  hud: Hud,
  view: RenderView,
  fx: Effects,
  y: number,
): void {
  if (fx.flash <= 0 || !(view.score.lastJump > 0)) return

  const fade = fx.flash / TUNING.FLASH_TIME
  ctx.globalAlpha = fade < 0.4 ? fade / 0.4 : 1
  label(
    ctx,
    hud.jump,
    PAD + JUMP_X,
    y - (1 - fade) * JUMP_RISE,
    TIER_FONT,
    verdictColor(fx.quality),
  )
  ctx.globalAlpha = 1
}

/** The relaunch prompt, up for exactly as long as the kite is in the water. */
function drawRelaunch(ctx: CanvasRenderingContext2D, view: RenderView): void {
  if (view.phase !== PHASE.WIPEOUT || view.over) return

  ctx.textAlign = 'center'
  label(ctx, RELAUNCH_LABEL, view.width * 0.5, view.height * RELAUNCH_Y, RELAUNCH_FONT, PALETTE.hud)
  ctx.textAlign = 'left'
}

/** The tier transition of spec §7.1, announced once, drifting up as it fades. */
function drawTierBanner(
  ctx: CanvasRenderingContext2D,
  hud: Hud,
  view: RenderView,
  fx: Effects,
): void {
  if (fx.tierFlash <= 0) return

  const fade = fx.tierFlash / TIER_FLASH_TIME
  const y = view.height * BANNER_Y - (1 - fade) * BANNER_RISE

  ctx.textAlign = 'center'
  ctx.globalAlpha = fade < 0.5 ? fade * 2 : 1
  label(ctx, tierLabel(fx.tier), view.width * 0.5, y, BANNER_FONT, PALETTE.tierFlash)
  label(ctx, hud.banner, view.width * 0.5, y + LINE, SMALL_FONT, PALETTE.hud)
  ctx.globalAlpha = 1
  ctx.textAlign = 'left'
}

/**
 * What a fatal crash leaves on the screen (spec §7.2).
 *
 * A placeholder for the game-over screen of §8.4, which owns the records, the
 * restart and the overlay proper. It is here because a run that ends has to say
 * so: the sim stops dead on contact, and a frozen frame with no word on it
 * reads as a bug rather than as a crash.
 */
function drawGameOver(ctx: CanvasRenderingContext2D, hud: Hud, view: RenderView): void {
  if (!view.over) return

  ctx.textAlign = 'center'
  label(ctx, OVER_LABEL, view.width * 0.5, view.height * 0.5, OVER_FONT, PALETTE.over)
  label(ctx, hud.over, view.width * 0.5, view.height * 0.5 + LINE + 8, SMALL_FONT, PALETTE.hud)
  ctx.textAlign = 'left'
}
