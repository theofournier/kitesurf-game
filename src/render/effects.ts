// Landing feedback (build plan session 5): what a touchdown looks like.
//
// The landing table (spec §3.7) only exists for the player if clean, sketchy
// and wipeout are unmistakable from the screen alone. Three channels carry it,
// and each one is legible on its own:
//
//   colour  — green, amber, red, on the wash, the spray and the word
//   spray   — a tight bright sheet, a dull scuff, a chaotic blowup
//   shake   — a tap, a jolt, a slam
//
// Plus what the sim itself does: a sketchy landing visibly bleeds speed, and a
// wipeout stops the world scrolling dead for the relaunch beat.
//
// Everything is pooled and preallocated. A frame allocates nothing, and the
// spray is driven by a seeded Rng rather than Math.random, so a replay of the
// same run draws the same frame — the same reasoning as the line tremble.
import { TUNING } from '../config/tuning.ts'
import { LAND_REASON, type LandReason } from '../sim/rider.ts'
import { Rng } from '../sim/rng.ts'
import type { Camera } from './camera.ts'
import { PALETTE } from './palette.ts'
import type { RenderView } from './view.ts'

/**
 * Spray pool size. The debug sliders are bounded by this, so asking for more
 * particles than the pool holds is not expressible.
 */
export const SPRAY_MAX = 64

/** Floats per particle: x, y, vx, vy, life, size. */
const STRIDE = 6

/** Spray physics, px-space. Effect anatomy, not gameplay — see palette.ts. */
const SPRAY_GRAVITY = 1100
const SPRAY_DRAG = 1.8
const SPRAY_FADE = 0.35

/**
 * The shape of each verdict's spray.
 *
 * `spread` is the fan half-angle as a fraction of a quarter turn: 0.3 is a
 * tight vertical sheet, 1 is everything from straight up to flat sideways.
 * `slow` is the low end of the launch-speed range, so a small number gives a
 * ragged burst and a large one a uniform sheet.
 */
interface SprayProfile {
  speed: number
  slow: number
  spread: number
  size: number
  life: number
}

const CLEAN_SPRAY: SprayProfile = { speed: 320, slow: 0.55, spread: 0.32, size: 3, life: 0.55 }
const SKETCHY_SPRAY: SprayProfile = { speed: 190, slow: 0.3, spread: 0.62, size: 3, life: 0.5 }
const WIPEOUT_SPRAY: SprayProfile = { speed: 260, slow: 0.15, spread: 1, size: 5, life: 0.95 }

/** Verdict wash and word. */
const WASH_ALPHA = 0.22
const LABEL_PX = 30
const LABEL_FONT = `bold ${LABEL_PX}px system-ui, -apple-system, sans-serif`
const LABEL_RISE = 46
const LABEL_LIFT = 34
const CLEAN_LABEL = 'CLEAN'
const SKETCHY_LABEL = 'SKETCHY'
const WIPEOUT_LABEL = 'WIPEOUT'

/**
 * The reason line: what the sim's LandReason looks like to the player, in the
 * words the tutorial would use rather than the ones the landing table does.
 *
 * Shown next to SKETCHY only. CLEAN has no reason, and a wipeout already reads
 * as one thing gone wrong; sketchy is the verdict where the player is left
 * asking which half of the row they missed.
 */
const REASON_LABEL: Record<LandReason, string> = {
  [LAND_REASON.NONE]: '',
  [LAND_REASON.KITE_HIGH]: 'KITE TOO HIGH',
  [LAND_REASON.KITE_LOW]: 'KITE TOO LOW',
  [LAND_REASON.HARD]: 'DOWN TOO FAST',
}

/** The reason sits beside the word: smaller, quieter, on the same baseline. */
const REASON_PX = 14
const REASON_FONT = `${REASON_PX}px system-ui, -apple-system, sans-serif`
const REASON_GAP = 10
const REASON_ALPHA = 0.75

/** The clean-landing shockwave: a ring opening along the waterline. */
const RING_R = 130
const RING_WIDTH = 3
/** How flat the ring lies: it is a wave on the water, not a halo. */
const RING_FLATTEN = 0.3

/** Altitude shadow on the water. */
const SHADOW_W = 40
const SHADOW_H = 7

/** Shake jitter frequency is the frame rate; only its amplitude is tuned. */
const SHAKE_MIN = 0.05

/**
 * Seed for the spray stream. Any constant does — it only has to be the same
 * one on every replay of a run.
 */
const SPRAY_SEED = 0x5eed

export interface Effects {
  /** Touchdowns already reacted to. A change in `view.landings` is the event. */
  seen: number
  /** The verdict being shown, 0..1 (spec §3.7). */
  quality: number
  /** Why that verdict was not clean — the reason drawn beside the word. */
  reason: LandReason
  /** Seconds left of the verdict wash and word. */
  flash: number
  /** Current shake amplitude, px, and the offset it produced this frame. */
  shake: number
  shakeX: number
  shakeY: number
  /** Live particles at the front of the pool. */
  count: number
  spray: Float32Array
  rng: Rng
}

export function createEffects(): Effects {
  return {
    seen: 0,
    quality: 0,
    reason: LAND_REASON.NONE,
    flash: 0,
    shake: 0,
    shakeX: 0,
    shakeY: 0,
    count: 0,
    spray: new Float32Array(SPRAY_MAX * STRIDE),
    rng: new Rng(SPRAY_SEED),
  }
}

/** Whether a quality reads as clean, sketchy or a wipeout (spec §3.7). */
function isClean(quality: number): boolean {
  return quality >= TUNING.CLEAN_QUALITY
}

function profileFor(quality: number): SprayProfile {
  if (isClean(quality)) return CLEAN_SPRAY
  return quality > 0 ? SKETCHY_SPRAY : WIPEOUT_SPRAY
}

/** The verdict colour: the one channel that needs no learning. */
export function verdictColor(quality: number): string {
  if (isClean(quality)) return PALETTE.clean
  return quality > 0 ? PALETTE.sketchy : PALETTE.wipeout
}

function sprayColor(quality: number): string {
  if (isClean(quality)) return PALETTE.sprayClean
  return quality > 0 ? PALETTE.spraySketchy : PALETTE.sprayWipeout
}

function verdictLabel(quality: number): string {
  if (isClean(quality)) return CLEAN_LABEL
  return quality > 0 ? SKETCHY_LABEL : WIPEOUT_LABEL
}

/** The reason to draw beside the word: sketchy landings only, '' otherwise. */
export function reasonLabel(quality: number, reason: LandReason): string {
  if (isClean(quality) || quality <= 0) return ''
  return REASON_LABEL[reason]
}

function sprayCount(quality: number): number {
  const asked = isClean(quality)
    ? TUNING.SPRAY_CLEAN
    : quality > 0
      ? TUNING.SPRAY_SKETCHY
      : TUNING.SPRAY_WIPEOUT
  const count = Math.round(asked)
  if (count < 0) return 0
  return count > SPRAY_MAX ? SPRAY_MAX : count
}

function shakeFor(quality: number): number {
  if (isClean(quality)) return TUNING.SHAKE_CLEAN
  return quality > 0 ? TUNING.SHAKE_SKETCHY : TUNING.SHAKE_WIPEOUT
}

/**
 * Fires one landing's worth of feedback from the board, at the point the rider
 * actually met the water.
 */
function land(fx: Effects, camera: Camera, view: RenderView): void {
  const quality = view.landingQuality
  const profile = profileFor(quality)
  const count = sprayCount(quality)

  fx.seen = view.landings
  fx.quality = quality
  fx.reason = view.landingReason
  fx.flash = TUNING.FLASH_TIME
  fx.shake = shakeFor(quality)
  fx.count = count

  // Reseeding per landing rather than running one stream keeps the burst a
  // function of which landing it is, not of how many frames came before it.
  fx.rng.setState(SPRAY_SEED + view.landings)

  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + fx.rng.range(-1, 1) * profile.spread * Math.PI * 0.5
    const speed = profile.speed * fx.rng.range(profile.slow, 1)
    const p = i * STRIDE
    fx.spray[p] = camera.anchorX
    fx.spray[p + 1] = camera.feetY
    fx.spray[p + 2] = Math.cos(angle) * speed
    fx.spray[p + 3] = Math.sin(angle) * speed
    fx.spray[p + 4] = profile.life * fx.rng.range(1 - SPRAY_FADE, 1)
    fx.spray[p + 5] = profile.size * fx.rng.range(SPRAY_FADE, 1)
  }
}

/**
 * Advance the feedback one frame.
 *
 * `dt` is real frame time: none of this is physics, and nothing downstream of
 * it reaches the sim.
 */
export function updateEffects(fx: Effects, camera: Camera, view: RenderView, dt: number): void {
  if (view.landings !== fx.seen) land(fx, camera, view)

  if (fx.flash > 0) {
    fx.flash -= dt
    if (fx.flash < 0) fx.flash = 0
  }

  // Exponential decay, then a fresh jitter each frame — a shake that eased
  // smoothly would read as a camera move rather than as an impact.
  fx.shake *= Math.exp(-TUNING.SHAKE_DECAY * dt)
  if (fx.shake < SHAKE_MIN) fx.shake = 0
  fx.shakeX = fx.rng.range(-fx.shake, fx.shake)
  fx.shakeY = fx.rng.range(-fx.shake, fx.shake)

  const drag = Math.exp(-SPRAY_DRAG * dt)
  let live = 0
  for (let i = 0; i < fx.count; i++) {
    const p = i * STRIDE
    const life = fx.spray[p + 4] - dt
    if (life <= 0) continue

    const vx = fx.spray[p + 2] * drag
    const vy = fx.spray[p + 3] * drag + SPRAY_GRAVITY * dt

    // Compacting to the front of the pool keeps the draw loop contiguous and
    // costs one copy of a dead particle's slot, never an allocation.
    const q = live * STRIDE
    fx.spray[q] = fx.spray[p] + vx * dt
    fx.spray[q + 1] = fx.spray[p + 1] + vy * dt
    fx.spray[q + 2] = vx
    fx.spray[q + 3] = vy
    fx.spray[q + 4] = life
    fx.spray[q + 5] = fx.spray[p + 5]
    live++
  }
  fx.count = live
}

/** The spray, drawn in the shaken world space it was thrown into. */
export function drawSpray(ctx: CanvasRenderingContext2D, fx: Effects): void {
  if (fx.count === 0) return

  const profile = profileFor(fx.quality)
  ctx.fillStyle = sprayColor(fx.quality)

  for (let i = 0; i < fx.count; i++) {
    const p = i * STRIDE
    const size = fx.spray[p + 5]
    ctx.globalAlpha = fx.spray[p + 4] / profile.life
    ctx.fillRect(fx.spray[p] - size * 0.5, fx.spray[p + 1] - size * 0.5, size, size)
  }

  ctx.globalAlpha = 1
}

/**
 * The verdict: a colour wash over the frame, the word, and — on a clean
 * landing only — a ring opening from the board.
 *
 * Drawn outside the shake so the word stays readable while the frame is still
 * moving under it.
 */
export function drawVerdict(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: RenderView,
  fx: Effects,
): void {
  if (fx.flash <= 0) return

  const fade = fx.flash / TUNING.FLASH_TIME
  const color = verdictColor(fx.quality)

  ctx.fillStyle = color
  ctx.globalAlpha = WASH_ALPHA * fade * fade
  ctx.fillRect(0, 0, view.width, view.height)

  if (isClean(fx.quality)) {
    ctx.strokeStyle = color
    ctx.globalAlpha = fade * fade
    ctx.lineWidth = RING_WIDTH
    ctx.beginPath()
    const r = RING_R * (1 - fade)
    ctx.ellipse(camera.anchorX, camera.feetY, r, r * RING_FLATTEN, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  const label = verdictLabel(fx.quality)
  const reason = reasonLabel(fx.quality, fx.reason)
  const y = camera.feetY - LABEL_RISE - LABEL_LIFT * (1 - fade)

  ctx.globalAlpha = fade
  ctx.fillStyle = color
  ctx.font = LABEL_FONT

  if (reason === '') {
    ctx.textAlign = 'center'
    ctx.fillText(label, camera.anchorX, y)
  } else {
    // Word and reason are centred as one line rather than the word staying put
    // and the reason hanging off it, so the verdict reads as a single phrase.
    const labelWidth = ctx.measureText(label).width
    ctx.font = REASON_FONT
    const left = (labelWidth + REASON_GAP + ctx.measureText(reason).width) * 0.5

    ctx.textAlign = 'left'
    ctx.font = LABEL_FONT
    ctx.fillText(label, camera.anchorX - left, y)

    ctx.font = REASON_FONT
    ctx.globalAlpha = fade * REASON_ALPHA
    ctx.fillText(reason, camera.anchorX - left + labelWidth + REASON_GAP, y)
  }

  ctx.globalAlpha = 1
}

/**
 * The rider's shadow on the water: a flat ellipse that shrinks and fades as the
 * altitude climbs.
 *
 * The camera follow (spec §6.4) sells the height by moving the frame; this
 * sells it by leaving a mark that does not move, so a 4m air and a 12m air are
 * told apart by something other than the shape of the parallax.
 */
export function drawAltitudeShadow(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: RenderView,
): void {
  const fade = 1 - view.altitude / TUNING.SHADOW_FADE_M
  if (fade <= 0) return

  ctx.fillStyle = PALETTE.shadow
  ctx.globalAlpha = fade * fade
  ctx.beginPath()
  ctx.ellipse(camera.anchorX, camera.waterY, SHADOW_W * fade, SHADOW_H * fade, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
}
