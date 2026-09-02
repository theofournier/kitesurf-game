// The aiming reticle the desktop pointer wears (spec §5.2).
//
// A CSS cursor rather than something drawn into the frame. The OS composites
// it, so it never lags a sweep by the frame a drawn marker would cost, it is
// free of the render loop entirely — and, the reason it matters here, it is
// still on screen when a send carries the hand off the canvas, which is exactly
// when the player needs to see where their hand went.
import { PALETTE } from './palette.ts'

/**
 * Cursor box, CSS px. Kept well under 32: above that a cursor is silently
 * dropped on some platforms, and the fallback keyword is what would show.
 * Even, so the hotspot lands on whole pixels.
 */
const SIZE = 26
const CENTRE = SIZE / 2

/** Reticle geometry, px from the centre. */
const RING_R = 6.0
const TICK_INNER = 9.0
const TICK_OUTER = 11.2
const DOT_R = 1.05

/**
 * The light stroke, and the dark rim under it that keeps it legible anywhere.
 *
 * A narrow, nearly opaque rim, not a wide soft one. Wide and faint washes out
 * against wave foam — the brightest thing in the frame, and the exact thing the
 * hand is aiming at through a send — leaving a grey smudge with no edge. It
 * also bleeds: at half opacity the rim under the ring and the rim under the
 * ticks overlap in the gap between them, compositing to a darker band that
 * fills the reticle in and welds the ticks onto the ring. Kept under
 * `TICK_INNER - RING_R`, the two never touch and the shape survives on sky,
 * on sea and on foam alike.
 */
const STROKE = 1.3
const HALO = 2.9
const HALO_OPACITY = 0.82

/**
 * The dot's own rim, as a stroke width. The ring and the ticks want the full
 * halo; the dot is 2px across and would swallow it, closing the middle of the
 * reticle into a dark blob over the one point the cursor is meant to mark.
 */
const DOT_HALO = 1.6

/** Four ticks on the axes, standing off the ring. */
const TICKS =
  `M${CENTRE} ${CENTRE - TICK_OUTER}V${CENTRE - TICK_INNER}` +
  `M${CENTRE} ${CENTRE + TICK_INNER}V${CENTRE + TICK_OUTER}` +
  `M${CENTRE - TICK_OUTER} ${CENTRE}H${CENTRE - TICK_INNER}` +
  `M${CENTRE + TICK_INNER} ${CENTRE}H${CENTRE + TICK_OUTER}`

/**
 * The reticle at one weight: ring, ticks, centre dot. Drawn twice — dark and
 * wide first, then light and narrow over it — which is what makes the rim.
 *
 * The dot carries `dotWidth` rather than the group's, because the two passes
 * disagree about it: the light pass wants the same weight everywhere, and the
 * dark one wants the dot's rim held back to DOT_HALO.
 *
 * Colours are given as hex with a separate opacity rather than as `rgba()`,
 * because these are SVG presentation attributes rather than canvas styles.
 */
function reticle(colour: string, width: number, dotWidth: number, opacity: number): string {
  return (
    `<g fill='none' stroke='${colour}' stroke-width='${width}'` +
    ` stroke-opacity='${opacity}' stroke-linecap='round'>` +
    `<circle cx='${CENTRE}' cy='${CENTRE}' r='${RING_R}'/>` +
    `<path d='${TICKS}'/>` +
    `<circle cx='${CENTRE}' cy='${CENTRE}' r='${DOT_R}' stroke-width='${dotWidth}'` +
    ` fill='${colour}' fill-opacity='${opacity}'/>` +
    `</g>`
  )
}

const SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' width='${SIZE}' height='${SIZE}'` +
  ` viewBox='0 0 ${SIZE} ${SIZE}'>` +
  reticle(PALETTE.cursorHalo, HALO, DOT_HALO, HALO_OPACITY) +
  reticle(PALETTE.cursor, STROKE, STROKE, 1) +
  `</svg>`

/**
 * The whole `cursor` property value: the reticle, its hotspot, and a fallback.
 *
 * The hotspot is the centre of the ring — an aiming control points from where
 * it looks like it points. The trailing `crosshair` is not decoration: a cursor
 * image that fails to load or is refused takes the keyword instead, and without
 * one the browser falls back to the arrow, which is the thing this replaced.
 *
 * Built once at module load. Nothing here runs per frame.
 */
export const CURSOR_CSS = `url("data:image/svg+xml,${encodeURIComponent(SVG)}") ${CENTRE} ${CENTRE}, crosshair`
