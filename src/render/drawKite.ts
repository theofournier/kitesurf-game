// The kite, its window arc, and the lines between (spec §6.2, §6.3).
//
// "The kite is a UI element wearing a costume." It orbits the rider at a fixed
// compressed radius, which is why none of this uses WORLD_SCALE: the kite is
// drawn on the line scale and nothing else is.
import { TUNING } from '../config/tuning.ts'
import { WINDOW_MAX, windPower } from '../sim/kite.ts'
import type { Camera } from './camera.ts'
import { PALETTE } from './palette.ts'
import type { RenderView } from './view.ts'

const DEG2RAD = Math.PI / 180
const TAU = Math.PI * 2

/** Kite silhouette, in multiples of KITE_W: how far it bows out and in. */
const KITE_NOSE = 0.17
const KITE_TAIL = 0.09
/** Bar width, px — how far apart the two lines leave the rider's hands. */
const BAR_W = 34
/** Ghost marker radius, px (spec §5.2). */
const GHOST_R = 7
const ARC_WIDTH = 2
const LINE_WIDTH = 1
const KITE_EDGE_WIDTH = 1.5
/** Half a turn of phase between the two lines, so they never tremble in unison. */
const TREMBLE_PHASE = Math.PI

/**
 * Screen position of a window angle, written into `outX`/`outY` of the module's
 * scratch point. Zenith is straight up from the harness and 90° is straight
 * ahead, which is the window as spec §3.1 defines it, drawn as it is flown.
 */
const point = { x: 0, y: 0 }
/** Unit tangent along the arc at the last `arcPoint` — the kite's span axis. */
const tangent = { x: 0, y: 0 }
/** Unit radial at the last `arcPoint`, pointing away from the rider. */
const radial = { x: 0, y: 0 }

function arcPoint(camera: Camera, deg: number, radius: number): void {
  const rad = deg * DEG2RAD
  const sin = Math.sin(rad)
  const cos = Math.cos(rad)

  point.x = camera.anchorX + radius * sin
  point.y = camera.harnessY - radius * cos
  tangent.x = cos
  tangent.y = sin
  radial.x = sin
  radial.y = -cos
}

/**
 * The window arc: a faint quarter circle at the compressed line radius.
 *
 * This is the control surface as much as it is scenery — on touch it is what
 * the thumb drags along (spec §5.3) — so it is drawn before anything that sits
 * on it and never brighter than the kite.
 */
export function drawWindowArc(ctx: CanvasRenderingContext2D, camera: Camera): void {
  ctx.strokeStyle = PALETTE.arc
  ctx.lineWidth = ARC_WIDTH
  ctx.beginPath()
  // Canvas angles run from +x with y down: -90° is straight up (zenith) and 0°
  // is straight ahead (the edge of the window).
  ctx.arc(camera.anchorX, camera.harnessY, TUNING.LINE_RADIUS, -Math.PI / 2, 0)
  ctx.stroke()
}

/** The faint marker showing where the pointer is asking the kite to go (§5.2). */
export function drawGhostMarker(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: RenderView,
): void {
  arcPoint(camera, view.kiteTarget, TUNING.LINE_RADIUS)

  ctx.strokeStyle = PALETTE.ghost
  ctx.lineWidth = LINE_WIDTH
  ctx.beginPath()
  ctx.arc(point.x, point.y, GHOST_R, 0, TAU)
  ctx.stroke()
}

/**
 * Sag of one line, px: the control-point offset of its quadratic Bézier.
 *
 * Proportional to inverse tension (spec §6.3) — a depowered kite at zenith
 * leaves the lines visibly bellied, and a loaded edge pulls them dead straight.
 * This reads load better than any meter would, so it is worth getting right
 * before anything else about the kite is.
 *
 * Above tier 1 the line also trembles, which is the same channel carrying the
 * wind tier. It is driven by sim time rather than a clock, so two runs of the
 * same replay draw the same frame.
 */
function lineSag(view: RenderView, phase: number): number {
  const slack = TUNING.LINE_SAG * (1 - view.tension)
  const gust = windPower(view.wind) - 1
  if (gust <= 0) return slack

  const tremble =
    Math.sin(view.time * TAU * TUNING.LINE_TREMBLE_HZ + phase) * TUNING.LINE_TREMBLE * gust
  return slack + tremble
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  handX: number,
  handY: number,
  tipX: number,
  tipY: number,
  sag: number,
): void {
  ctx.beginPath()
  ctx.moveTo(handX, handY)
  // The control point sits at the midpoint, dropped by the sag: gravity is what
  // an unloaded line answers to.
  ctx.quadraticCurveTo((handX + tipX) * 0.5, (handY + tipY) * 0.5 + sag, tipX, tipY)
  ctx.stroke()
}

/**
 * The kite and its two lines.
 *
 * The quad is drawn ~90px across — deliberately larger than perspective would
 * give it, so the window position reads at a glance (spec §6.2). Its span lies
 * along the arc, so it banks as it flies, and the lines run to its tips.
 */
export function drawKite(ctx: CanvasRenderingContext2D, camera: Camera, view: RenderView): void {
  const angle = view.kiteAngle > WINDOW_MAX ? WINDOW_MAX : view.kiteAngle
  arcPoint(camera, angle, TUNING.LINE_RADIUS)

  const centreX = point.x
  const centreY = point.y
  const half = TUNING.KITE_W * 0.5
  const tipAX = centreX + tangent.x * half
  const tipAY = centreY + tangent.y * half
  const tipBX = centreX - tangent.x * half
  const tipBY = centreY - tangent.y * half

  // Hands are spread along the same axis as the kite's span, so the two lines
  // stay parallel — that is what a bar does.
  const barHalf = BAR_W * 0.5
  const handAX = camera.anchorX + tangent.x * barHalf
  const handAY = camera.harnessY + tangent.y * barHalf
  const handBX = camera.anchorX - tangent.x * barHalf
  const handBY = camera.harnessY - tangent.y * barHalf

  ctx.strokeStyle = PALETTE.line
  ctx.lineWidth = LINE_WIDTH
  drawLine(ctx, handAX, handAY, tipAX, tipAY, lineSag(view, 0))
  drawLine(ctx, handBX, handBY, tipBX, tipBY, lineSag(view, TREMBLE_PHASE))

  const noseX = centreX + radial.x * TUNING.KITE_W * KITE_NOSE
  const noseY = centreY + radial.y * TUNING.KITE_W * KITE_NOSE
  const tailX = centreX - radial.x * TUNING.KITE_W * KITE_TAIL
  const tailY = centreY - radial.y * TUNING.KITE_W * KITE_TAIL

  ctx.beginPath()
  ctx.moveTo(tipAX, tipAY)
  ctx.lineTo(noseX, noseY)
  ctx.lineTo(tipBX, tipBY)
  ctx.lineTo(tailX, tailY)
  ctx.closePath()

  ctx.fillStyle = PALETTE.kite
  ctx.fill()
  ctx.strokeStyle = PALETTE.kiteEdge
  ctx.lineWidth = KITE_EDGE_WIDTH
  ctx.stroke()
}
