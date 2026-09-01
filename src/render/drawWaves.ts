// Waves and the lip telegraph (spec §4, build plan session 6).
//
// The lip is a 300ms window on a face that takes a fifth of a second to ride
// up, so the whole of the skill in §4.2 depends on the player knowing where it
// is well before they get there. Three cues carry that, largest first:
//
//   the face   — a lit slab of water rising to a crest, so the ramp is visible
//   the foam   — a bright cap on the steepest part of the face: that is the lip
//   the guide  — a line dropped from the nearest lip into the water in front of
//                the rider, so the timing is a distance rather than a guess
//
// Plus an edge marker for a wave that is still off the right of the frame. That
// is what makes the WAVE_LEAD guarantee viewport-independent: on a narrow phone
// the world runs out of screen long before it runs out of warning.
//
// Allocates nothing: every wave is drawn straight out of the sim's pool.
import { TUNING } from '../config/tuning.ts'
import { WAVE, type Wave } from '../sim/world.ts'
import { screenX, type Camera } from './camera.ts'
import { PALETTE } from './palette.ts'
import type { RenderView } from './view.ts'

/** How far past the frame a face is still worth drawing, px. */
const MARGIN = 90
/** The shoulder behind the lip, as a multiple of the face length. */
const BACK = 0.6
/**
 * Where the control point of the face sits, as a share of the face length back
 * from the lip. Low, so the curve hugs the water most of the way out and then
 * stands up: the steepest part of the face is the last bit before the crest,
 * which is what makes "the lip" a place rather than a rule.
 */
const FACE_BEND = 0.3
/**
 * Where the foam starts on the face, as a parameter along the same curve the
 * face is drawn from. Two thirds of the way up, which is the part of the face
 * standing up steeply enough to launch off.
 */
const FOAM_FROM = 0.66
/** How thick the foam is drawn, px. */
const FOAM_W = 3.5
/** Crest highlight, px. */
const CAP_W = 9
const CAP_H = 2.5
/** The post above the crest, px at full urgency. */
const POST_H = 22
const POST_W = 2
/** The guide dropped from the nearest lip into the near water, px. */
const GUIDE_H = 150
const GUIDE_W = 1.5
/** Edge marker: px from the right edge, and the size of the chevron. */
const MARK_INSET = 20
const MARK_W = 13
const MARK_H = 9
/** Floor on the marker's alpha, so a wave never fades to invisible mid-approach. */
const MARK_MIN_ALPHA = 0.25

/**
 * How far out a wave starts being telegraphed, m.
 *
 * A distance rather than a time, so the guarantee holds at every speed at once:
 * WAVE_LEAD seconds at MAX_SPEED is more than WAVE_LEAD seconds at any speed
 * the rider can actually be doing.
 */
export function telegraphRange(): number {
  return TUNING.WAVE_LEAD * TUNING.MAX_SPEED
}

/** True while any part of the wave's own face falls inside the frame. */
export function waveOnScreen(camera: Camera, view: RenderView, wave: Wave): boolean {
  if (!wave.active) return false
  const left = screenX(camera, wave.x)
  const right = screenX(camera, wave.lipX + wave.face * BACK)
  return right > -MARGIN && left < view.width + MARGIN
}

/**
 * True while the wave is showing on screen at all — as its own face, or as the
 * edge marker standing in for it while it is still off the right of the frame.
 *
 * This is the build plan's visibility guarantee in one predicate, and it is
 * what the 1.5s test asserts against.
 */
export function waveTelegraphed(camera: Camera, view: RenderView, wave: Wave): boolean {
  if (!wave.active) return false
  const ahead = wave.lipX - view.x
  if (ahead > 0 && ahead <= telegraphRange()) return true
  return waveOnScreen(camera, view, wave)
}

/** 0 a full telegraph range out, 1 at the lip. */
function urgency(view: RenderView, wave: Wave): number {
  const ahead = wave.lipX - view.x
  if (ahead <= 0) return 1
  const range = telegraphRange()
  return ahead >= range ? 0 : 1 - ahead / range
}

/** Scratch point for the face curve. Module-level, so drawing allocates nothing. */
const point = { x: 0, y: 0 }

/**
 * A point on the face at parameter `t`: the quadratic through the trough, the
 * bend, and the lip. Written into the module's scratch point.
 */
function facePoint(
  t: number,
  trough: number,
  bend: number,
  lip: number,
  water: number,
  crest: number,
): void {
  const u = 1 - t
  point.x = u * u * trough + 2 * u * t * bend + t * t * lip
  point.y = u * u * water + 2 * u * t * water + t * t * crest
}

function faceColor(wave: Wave): string {
  return wave.type === WAVE.WAKE ? PALETTE.waveFaceWake : PALETTE.waveFace
}

function foamColor(wave: Wave): string {
  return wave.type === WAVE.WAKE ? PALETTE.waveFoamWake : PALETTE.waveFoam
}

/**
 * One wave: the face from trough to lip, the shoulder behind it, and the foam
 * that says where the lip is.
 *
 * Drawn in the rider's own plane at WORLD_SCALE, so a 1.8m boat wake is 1.8m of
 * screen against a rider who is the same height they always are. Nothing here
 * displaces the rider — the water is flat as far as the physics is concerned
 * (§4.2 is a takeoff bonus, not a surface) — so the face is a launch ramp drawn
 * where the launch happens rather than a solid the board rides over.
 */
function drawFace(ctx: CanvasRenderingContext2D, camera: Camera, wave: Wave): void {
  const water = camera.waterY
  const trough = screenX(camera, wave.x)
  const lip = screenX(camera, wave.lipX)
  const crest = water - wave.height * TUNING.WORLD_SCALE
  const span = lip - trough
  const back = lip + span * BACK
  const bend = lip - span * FACE_BEND

  ctx.fillStyle = faceColor(wave)
  ctx.beginPath()
  ctx.moveTo(trough, water)
  ctx.quadraticCurveTo(bend, water, lip, crest)
  ctx.lineTo(back, water)
  ctx.closePath()
  ctx.fill()

  // The foam: a bright stroke down the steepest part of the face, ending on the
  // crest. This is the mark the release is timed to, so it is the brightest
  // thing on the water — and it is the tail of the very same curve, split at
  // FOAM_FROM, so it sits on the face rather than near it.
  facePoint(FOAM_FROM, trough, bend, lip, water, crest)
  const fromX = point.x
  const fromY = point.y

  ctx.strokeStyle = foamColor(wave)
  ctx.lineWidth = FOAM_W
  ctx.beginPath()
  ctx.moveTo(fromX, fromY)
  ctx.quadraticCurveTo(
    bend + (lip - bend) * FOAM_FROM,
    water + (crest - water) * FOAM_FROM,
    lip,
    crest,
  )
  ctx.stroke()

  ctx.fillStyle = foamColor(wave)
  ctx.fillRect(lip - CAP_W * 0.5, crest - CAP_H, CAP_W, CAP_H)
}

/**
 * The post over the crest: a tick that grows out of the lip as the wave closes.
 * Height carries the countdown, so the cue is loudest in the last half second —
 * exactly where the release decision is.
 */
function drawPost(ctx: CanvasRenderingContext2D, camera: Camera, wave: Wave, near: number): void {
  const crest = camera.waterY - wave.height * TUNING.WORLD_SCALE
  const lip = screenX(camera, wave.lipX)
  const height = POST_H * near

  ctx.fillStyle = foamColor(wave)
  ctx.fillRect(lip - POST_W * 0.5, crest - CAP_H - height, POST_W, height)
}

/**
 * The guide: the nearest lip dropped into the water in front of the rider.
 *
 * Only the next wave gets one. It answers the one question the face alone
 * cannot — how far away the lip is, in the same plane the rider is riding in —
 * and a second one on screen would turn that answer back into a guess.
 */
function drawGuide(ctx: CanvasRenderingContext2D, camera: Camera, wave: Wave): void {
  const lip = screenX(camera, wave.lipX)

  ctx.fillStyle = PALETTE.waveGuide
  ctx.fillRect(lip - GUIDE_W * 0.5, camera.waterY, GUIDE_W, GUIDE_H)
}

/**
 * The edge marker: a chevron pinned inside the right edge for a wave that has
 * not reached the frame yet, at the height its crest will be.
 *
 * Without it the warning a player gets is however many metres of water the
 * viewport happens to show, which on a phone in landscape is under a second at
 * full speed. With it the warning is WAVE_LEAD, on every screen.
 */
function drawMarker(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: RenderView,
  wave: Wave,
  near: number,
): void {
  const x = view.width - MARK_INSET
  const y = camera.waterY - wave.height * TUNING.WORLD_SCALE - MARK_H

  ctx.globalAlpha = MARK_MIN_ALPHA + (1 - MARK_MIN_ALPHA) * near
  ctx.fillStyle = foamColor(wave)
  ctx.beginPath()
  ctx.moveTo(x, y - MARK_H)
  ctx.lineTo(x + MARK_W, y)
  ctx.lineTo(x, y + MARK_H)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
}

/**
 * Draws every wave in play, plus the telegraph for the ones still off screen.
 *
 * The pool is walked twice — once for the faces, once for the markers and the
 * single guide — so the markers never end up under a face drawn after them.
 */
export function drawWaves(ctx: CanvasRenderingContext2D, camera: Camera, view: RenderView): void {
  const waves = view.waves
  const right = view.width - MARK_INSET

  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i]
    if (waveOnScreen(camera, view, wave)) drawFace(ctx, camera, wave)
  }

  // The next lip ahead of the rider: the only one that gets a guide, and the
  // one the player is being asked to time.
  let next: Wave | null = null
  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i]
    if (!wave.active || wave.lipX <= view.x) continue
    if (next === null || wave.lipX < next.lipX) next = wave
  }

  const range = telegraphRange()
  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i]
    if (!wave.active) continue

    // Only what is still ahead is telegraphed. A lip the rider has already
    // ridden past is a fact, not a warning, and dressing it up as one would be
    // noise on the exact frames the next wave needs the player's attention.
    const ahead = wave.lipX - view.x
    if (ahead <= 0 || ahead > range) continue

    const near = urgency(view, wave)
    if (screenX(camera, wave.lipX) > right) drawMarker(ctx, camera, view, wave, near)
    else if (waveOnScreen(camera, view, wave)) drawPost(ctx, camera, wave, near)
  }

  if (next !== null && waveOnScreen(camera, view, next)) drawGuide(ctx, camera, next)
}
