// The two screens either side of a run (spec §8.4, §10): pick a direction, and
// what the run was worth once it ends.
//
// Both are drawn *over the scene*, not instead of it. The canvas keeps running
// underneath — the sea keeps its parallax under the select screen, and the
// frame a fatal crash left behind keeps shaking and settling its spray under
// the game-over card. A run that ends by cutting to a different screen throws
// away the one thing the player wants to look at, which is where they died.
//
// The game-over card carries the records as *numbers*, and that is not a
// contradiction of §8.4's "in-world markers, not HUD numbers". The markers are
// how you race a record while you are riding; this is the scoreboard you read
// once the riding has stopped, and the spec asks for the sub-stats "displayed
// on the game-over screen" in as many words.
//
// Every string is cached against the rounded number that produced it, the same
// way the HUD does it, so a card sitting on screen for a minute allocates
// nothing after its first frame.
import { label } from './hud.ts'
import { PALETTE } from './palette.ts'
import type { Records } from '../platform/storage.ts'
import type { RenderView } from './view.ts'

const TITLE_PX = 42
const TITLE_FONT = `bold ${TITLE_PX}px system-ui, -apple-system, sans-serif`
const VALUE_PX = 28
const VALUE_FONT = `bold ${VALUE_PX}px system-ui, -apple-system, sans-serif`
const HEAD_PX = 12
const HEAD_FONT = `bold ${HEAD_PX}px system-ui, -apple-system, sans-serif`
const SUB_PX = 13
const SUB_FONT = `${SUB_PX}px system-ui, -apple-system, sans-serif`
const PROMPT_PX = 15
const PROMPT_FONT = `bold ${PROMPT_PX}px system-ui, -apple-system, sans-serif`

/** The card's vertical rhythm, px, measured from the title's baseline. */
const HEAD_DROP = 62
const VALUE_DROP = 92
const SUB_DROP = 116
const PROMPT_DROP = 168
const HINT_DROP = 192

/**
 * How far the outer two columns sit from the middle one, px, and the share of
 * the frame they are held inside on a narrow one.
 *
 * A landscape phone is 667px across before anything else, and three columns
 * pinned at a fixed 190px would run off both ends of it.
 */
const COL_GAP = 190
const COL_GAP_MAX = 0.28

/** Where the block sits down the frame. */
const TITLE_Y = 0.3

const OVER_LABEL = 'RUN OVER'
const TITLE_LABEL = 'KITESURF'
const CHOOSE_LABEL = 'PICK A SIDE'
const LEFT_LABEL = '←  RIDE LEFT'
const RIGHT_LABEL = 'RIDE RIGHT  →'
const CHOOSE_HINT = 'arrow keys, or tap a side of the screen'
/**
 * The restart, in one line (build plan session 10: one key or tap, no confirm
 * dialog). Both inputs are named because the same build runs on both, and a
 * player who has to guess which one this screen wants has already been asked
 * for a confirmation.
 */
const AGAIN_LABEL = 'ANY KEY OR TAP TO RIDE AGAIN'
const AGAIN_HINT = '← → to ride the other way'
const NEW_LABEL = 'NEW BEST'

const HEAD_SCORE = 'SCORE'
const HEAD_JUMP = 'BEST JUMP'
const HEAD_DISTANCE = 'DISTANCE'

/** Metres are shown to a tenth: a jump PB moves in decimetres, not in metres. */
const METRE_ROUND = 10

/**
 * The card's formatted text and the rounded numbers behind it.
 *
 * Six strings, three of them the run's and three the records it was measured
 * against, each rebuilt only when the number a player can read has moved.
 */
export interface Overlay {
  score: string
  scoreValue: number
  jump: string
  jumpValue: number
  distance: string
  distanceValue: number
  pbScore: string
  pbScoreValue: number
  pbJump: string
  pbJumpValue: number
  pbDistance: string
  pbDistanceValue: number
}

/** Which of the three records a run beat (spec §8.4). */
export interface RecordBreaks {
  score: boolean
  jump: boolean
  distance: boolean
}

export function createOverlay(): Overlay {
  return resetOverlay({} as Overlay)
}

/** Empties the string cache, in place — NaN sentinels, as in the HUD. */
export function resetOverlay(overlay: Overlay): Overlay {
  overlay.score = ''
  overlay.scoreValue = Number.NaN
  overlay.jump = ''
  overlay.jumpValue = Number.NaN
  overlay.distance = ''
  overlay.distanceValue = Number.NaN
  overlay.pbScore = ''
  overlay.pbScoreValue = Number.NaN
  overlay.pbJump = ''
  overlay.pbJumpValue = Number.NaN
  overlay.pbDistance = ''
  overlay.pbDistanceValue = Number.NaN
  return overlay
}

export function createRecordBreaks(): RecordBreaks {
  return resetRecordBreaks({} as RecordBreaks)
}

/** Nothing beaten yet — every run starts here. */
export function resetRecordBreaks(breaks: RecordBreaks): RecordBreaks {
  breaks.score = false
  breaks.jump = false
  breaks.distance = false
  return breaks
}

/** Where the outer columns sit, held inside a narrow frame. */
function columnGap(view: RenderView): number {
  const room = view.width * COL_GAP_MAX
  return room < COL_GAP ? room : COL_GAP
}

/** The dark wash that lifts an overlay off the scene it is drawn over. */
function scrim(ctx: CanvasRenderingContext2D, view: RenderView): void {
  ctx.fillStyle = PALETTE.scrim
  ctx.fillRect(0, 0, view.width, view.height)
}

/** Rebuilds the cached strings, and only the ones whose number has moved. */
function format(overlay: Overlay, view: RenderView, records: Records): void {
  const score = Math.round(view.score.total)
  if (score !== overlay.scoreValue) {
    overlay.scoreValue = score
    overlay.score = `${score}`
  }

  const jump = Math.round(view.score.bestJump * METRE_ROUND)
  if (jump !== overlay.jumpValue) {
    overlay.jumpValue = jump
    overlay.jump = `${(jump / METRE_ROUND).toFixed(1)}m`
  }

  const distance = Math.round(view.x)
  if (distance !== overlay.distanceValue) {
    overlay.distanceValue = distance
    overlay.distance = `${distance}m`
  }

  const pbScore = Math.round(records.score)
  if (pbScore !== overlay.pbScoreValue) {
    overlay.pbScoreValue = pbScore
    overlay.pbScore = `PB ${pbScore}`
  }

  const pbJump = Math.round(records.jump * METRE_ROUND)
  if (pbJump !== overlay.pbJumpValue) {
    overlay.pbJumpValue = pbJump
    overlay.pbJump = `PB ${(pbJump / METRE_ROUND).toFixed(1)}m`
  }

  const pbDistance = Math.round(records.distance)
  if (pbDistance !== overlay.pbDistanceValue) {
    overlay.pbDistanceValue = pbDistance
    overlay.pbDistance = `PB ${pbDistance}m`
  }
}

/**
 * One column of the card: what it is, what this run did, and the record behind
 * it — replaced by NEW BEST in the landing green when this run took it.
 *
 * The badge stands where the PB was rather than beside it. A player glancing at
 * the card is looking for one thing, which is whether anything moved, and three
 * slots that either say a number or say NEW BEST answer that without being
 * read.
 */
function column(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  head: string,
  value: string,
  pb: string,
  beaten: boolean,
): void {
  label(ctx, head, x, top + HEAD_DROP, HEAD_FONT, PALETTE.hudDim)
  label(ctx, value, x, top + VALUE_DROP, VALUE_FONT, PALETTE.hud)
  label(
    ctx,
    beaten ? NEW_LABEL : pb,
    x,
    top + SUB_DROP,
    SUB_FONT,
    beaten ? PALETTE.fresh : PALETTE.hudDim,
  )
}

/**
 * The game-over card (spec §8.4): the total, the two sub-stats, and what each
 * one was up against.
 *
 * `records` is the baseline the run was measured against — the PBs as they
 * stood when it started — so the card can show what was beaten and by how much.
 */
export function drawGameOver(
  ctx: CanvasRenderingContext2D,
  overlay: Overlay,
  view: RenderView,
  records: Records,
  breaks: RecordBreaks,
): void {
  format(overlay, view, records)
  scrim(ctx, view)

  const mid = view.width * 0.5
  const top = view.height * TITLE_Y
  const gap = columnGap(view)

  ctx.textAlign = 'center'
  label(ctx, OVER_LABEL, mid, top, TITLE_FONT, PALETTE.over)

  column(ctx, mid - gap, top, HEAD_SCORE, overlay.score, overlay.pbScore, breaks.score)
  column(ctx, mid, top, HEAD_JUMP, overlay.jump, overlay.pbJump, breaks.jump)
  column(ctx, mid + gap, top, HEAD_DISTANCE, overlay.distance, overlay.pbDistance, breaks.distance)

  label(ctx, AGAIN_LABEL, mid, top + PROMPT_DROP, PROMPT_FONT, PALETTE.tierFlash)
  label(ctx, AGAIN_HINT, mid, top + HINT_DROP, SUB_FONT, PALETTE.hudDim)
  ctx.textAlign = 'left'
}

/**
 * The direction select (spec §6.5): the one choice made before a run, and the
 * only screen in the game that waits for the player.
 *
 * The records are on it as one quiet line. They are what the buoy and the sky
 * line are about to mean, and a player who has never seen either has no way to
 * know what the marker sliding past them was.
 */
export function drawSelect(
  ctx: CanvasRenderingContext2D,
  overlay: Overlay,
  view: RenderView,
  records: Records,
): void {
  format(overlay, view, records)
  scrim(ctx, view)

  const mid = view.width * 0.5
  const top = view.height * TITLE_Y
  const gap = columnGap(view)

  ctx.textAlign = 'center'
  label(ctx, TITLE_LABEL, mid, top, TITLE_FONT, PALETTE.hud)
  label(ctx, CHOOSE_LABEL, mid, top + HEAD_DROP, HEAD_FONT, PALETTE.hudDim)

  label(ctx, LEFT_LABEL, mid - gap, top + VALUE_DROP, VALUE_FONT, PALETTE.tierFlash)
  label(ctx, RIGHT_LABEL, mid + gap, top + VALUE_DROP, VALUE_FONT, PALETTE.tierFlash)
  label(ctx, CHOOSE_HINT, mid, top + SUB_DROP + 8, SUB_FONT, PALETTE.hudDim)

  // Nothing to show a player who has never finished a run, and an empty row of
  // zeroes would only teach them that the markers mean nothing.
  if (records.score > 0 || records.jump > 0 || records.distance > 0) {
    label(ctx, overlay.pbScore, mid - gap, top + PROMPT_DROP, SUB_FONT, PALETTE.record)
    label(ctx, overlay.pbJump, mid, top + PROMPT_DROP, SUB_FONT, PALETTE.record)
    label(ctx, overlay.pbDistance, mid + gap, top + PROMPT_DROP, SUB_FONT, PALETTE.record)
  }
  ctx.textAlign = 'left'
}
