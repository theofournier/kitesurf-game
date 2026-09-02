import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { createCamera, updateCamera } from '../../src/render/camera.ts'
import {
  SPRAY_MAX,
  createEffects,
  drawAltitudeShadow,
  drawSpray,
  drawVerdict,
  reasonLabel,
  updateEffects,
  verdictColor,
  type Effects,
} from '../../src/render/effects.ts'
import { PALETTE } from '../../src/render/palette.ts'
import { createView, type RenderView } from '../../src/render/view.ts'
import { LAND_REASON, type LandReason } from '../../src/sim/rider.ts'

const W = 1200
const H = 800
const FRAME = 1 / 60

function frameCamera(altitude = 0) {
  const camera = createCamera()
  updateCamera(camera, W, H, 0, altitude, FRAME)
  return camera
}

function frameView(altitude = 0): RenderView {
  const view = createView()
  view.width = W
  view.height = H
  view.altitude = altitude
  view.wind = TUNING.WIND_BASE
  return view
}

/** Records what actually reached the canvas, so the three verdicts can be told apart. */
function recorder() {
  const fills: number[][] = []
  const styles: string[] = []
  const texts: string[] = []
  const xs: number[] = []
  const noop = () => {}

  // One px per character: enough for the layout to be checked without a font.
  const CHAR_W = 1

  const ctx = {
    fillRect: (...args: number[]) => void fills.push(args),
    fillText: (text: string, x: number) => {
      texts.push(text)
      xs.push(x)
    },
    measureText: (text: string) => ({ width: text.length * CHAR_W }),
    ellipse: noop,
    beginPath: noop,
    fill: noop,
    stroke: noop,
    set fillStyle(value: string) {
      styles.push(value)
    },
    get fillStyle() {
      return ''
    },
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
  }

  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, styles, texts, xs }
}

/** Fires one landing of `quality` and returns the effects state it produced. */
function landed(
  quality: number,
  fx: Effects = createEffects(),
  reason: LandReason = LAND_REASON.NONE,
) {
  const view = frameView()
  view.landingQuality = quality
  view.landingReason = reason
  view.landings = fx.seen + 1

  updateEffects(fx, frameCamera(), view, FRAME)
  return { fx, view }
}

const CLEAN = TUNING.CLEAN_QUALITY
const SKETCHY = TUNING.SKETCHY_QUALITY
const WIPEOUT = 0

describe('landing feedback (build plan session 5)', () => {
  it('fires nothing until a landing happens', () => {
    const fx = createEffects()
    const view = frameView()

    for (let i = 0; i < 60; i++) updateEffects(fx, frameCamera(), view, FRAME)

    expect(fx.count).toBe(0)
    expect(fx.flash).toBe(0)
    expect(fx.shake).toBe(0)
  })

  it('fires once per landing, on the counter rather than on the phase', () => {
    // The landing beat lasts many frames. Firing on the phase would restart the
    // burst on every one of them.
    const { fx, view } = landed(CLEAN)
    const first = fx.count

    // Half a second on: the burst is thinning out, not being thrown again.
    for (let i = 0; i < 30; i++) updateEffects(fx, frameCamera(), view, FRAME)
    expect(fx.count).toBeLessThan(first)

    view.landings += 1
    updateEffects(fx, frameCamera(), view, FRAME)
    expect(fx.count).toBe(first)
  })

  it('gives each verdict its own colour', () => {
    expect(verdictColor(CLEAN)).toBe(PALETTE.clean)
    expect(verdictColor(SKETCHY)).toBe(PALETTE.sketchy)
    expect(verdictColor(WIPEOUT)).toBe(PALETTE.wipeout)

    expect(new Set([PALETTE.clean, PALETTE.sketchy, PALETTE.wipeout]).size).toBe(3)
  })

  it('shakes harder the worse the landing was', () => {
    // The one channel that reads even with your eyes off the rider.
    const clean = landed(CLEAN).fx.shake
    const sketchy = landed(SKETCHY).fx.shake
    const wipeout = landed(WIPEOUT).fx.shake

    expect(sketchy).toBeGreaterThan(clean)
    expect(wipeout).toBeGreaterThan(sketchy)
    expect(clean).toBeGreaterThan(0)
  })

  it('settles the shake back to nothing', () => {
    const { fx, view } = landed(WIPEOUT)

    for (let i = 0; i < 180; i++) updateEffects(fx, frameCamera(), view, FRAME)

    expect(fx.shake).toBe(0)
    expect(fx.shakeX).toBe(0)
    expect(fx.shakeY).toBe(0)
  })

  it('throws a different amount of spray for each verdict', () => {
    expect(landed(CLEAN).fx.count).toBe(TUNING.SPRAY_CLEAN)
    expect(landed(SKETCHY).fx.count).toBe(TUNING.SPRAY_SKETCHY)
    expect(landed(WIPEOUT).fx.count).toBe(TUNING.SPRAY_WIPEOUT)
  })

  it('never asks the pool for more particles than it holds', () => {
    const fx = createEffects()
    const view = frameView()
    view.landings = 1
    view.landingQuality = WIPEOUT

    const asked = TUNING.SPRAY_WIPEOUT
    try {
      TUNING.SPRAY_WIPEOUT = SPRAY_MAX * 10
      updateEffects(fx, frameCamera(), view, FRAME)
      expect(fx.count).toBe(SPRAY_MAX)
      expect(fx.spray).toHaveLength(SPRAY_MAX * 6)
    } finally {
      TUNING.SPRAY_WIPEOUT = asked
    }
  })

  it('clears the spray once it has fallen back into the water', () => {
    const { fx, view } = landed(WIPEOUT)
    expect(fx.count).toBeGreaterThan(0)

    for (let i = 0; i < 180; i++) updateEffects(fx, frameCamera(), view, FRAME)
    expect(fx.count).toBe(0)
  })

  it('holds the verdict on screen for FLASH_TIME and no longer', () => {
    const { fx, view } = landed(SKETCHY)
    expect(fx.flash).toBeCloseTo(TUNING.FLASH_TIME - FRAME, 6)

    const frames = Math.ceil(TUNING.FLASH_TIME / FRAME)
    for (let i = 0; i < frames; i++) updateEffects(fx, frameCamera(), view, FRAME)
    expect(fx.flash).toBe(0)
  })

  it('never allocates a new pool, whatever it is asked to do', () => {
    const fx = createEffects()
    const pool = fx.spray
    const view = frameView()

    for (let i = 1; i <= 20; i++) {
      view.landings = i
      view.landingQuality = i % 3 === 0 ? WIPEOUT : i % 2 === 0 ? SKETCHY : CLEAN
      for (let f = 0; f < 30; f++) updateEffects(fx, frameCamera(), view, FRAME)
    }

    expect(fx.spray).toBe(pool)
  })

  it('is deterministic: the same landing draws the same burst', () => {
    const a = landed(CLEAN).fx
    const b = landed(CLEAN).fx

    expect(Array.from(a.spray)).toEqual(Array.from(b.spray))
    expect(a.shakeX).toBe(b.shakeX)
  })
})

describe('landing feedback, drawn', () => {
  it('names the verdict on screen, in its own colour', () => {
    for (const [quality, word] of [
      [CLEAN, 'CLEAN'],
      [SKETCHY, 'SKETCHY'],
      [WIPEOUT, 'WIPEOUT'],
    ] as const) {
      const { fx, view } = landed(quality)
      const { ctx, texts, styles } = recorder()

      drawVerdict(ctx, frameCamera(), view, fx)

      expect(texts).toEqual([word])
      expect(styles).toContain(verdictColor(quality))
    }
  })

  it('says why a sketchy landing was sketchy, beside the word', () => {
    const { fx, view } = landed(SKETCHY, createEffects(), LAND_REASON.KITE_HIGH)
    const { ctx, texts, xs } = recorder()

    drawVerdict(ctx, frameCamera(), view, fx)

    expect(texts).toEqual(['SKETCHY', reasonLabel(SKETCHY, LAND_REASON.KITE_HIGH)])
    expect(texts[1]).not.toBe('')
    // Beside it, not under it: the reason starts to the right of the word.
    expect(xs[1]).toBeGreaterThan(xs[0])
  })

  it('gives every reason its own words', () => {
    const words = new Set<string>()
    for (const reason of [LAND_REASON.KITE_HIGH, LAND_REASON.KITE_LOW, LAND_REASON.HARD]) {
      words.add(reasonLabel(SKETCHY, reason))
    }
    expect(words.size).toBe(3)
    expect(words).not.toContain('')
  })

  it('draws the word alone on a clean landing and a wipeout', () => {
    for (const quality of [CLEAN, WIPEOUT]) {
      const { fx, view } = landed(quality, createEffects(), LAND_REASON.KITE_HIGH)
      const { ctx, texts } = recorder()

      drawVerdict(ctx, frameCamera(), view, fx)
      expect(texts).toHaveLength(1)
    }
  })

  it('centres the word and its reason as one line', () => {
    const { fx, view } = landed(SKETCHY, createEffects(), LAND_REASON.HARD)
    const camera = frameCamera()
    const { ctx, texts, xs } = recorder()

    drawVerdict(ctx, camera, view, fx)

    // The recorder measures one px per character, so the line runs from the
    // first x to the end of the second word.
    const end = xs[1] + texts[1].length
    expect((xs[0] + end) * 0.5).toBeCloseTo(camera.anchorX, 6)
  })

  it('washes the whole frame in the verdict colour', () => {
    const { fx, view } = landed(WIPEOUT)
    const { ctx, fills } = recorder()

    drawVerdict(ctx, frameCamera(), view, fx)
    expect(fills).toContainEqual([0, 0, W, H])
  })

  it('draws nothing once the verdict has expired', () => {
    const { fx, view } = landed(CLEAN)
    fx.flash = 0

    const { ctx, fills, texts } = recorder()
    drawVerdict(ctx, frameCamera(), view, fx)

    expect(fills).toHaveLength(0)
    expect(texts).toHaveLength(0)
  })

  it('draws one mark per live spray particle and none when the pool is empty', () => {
    const { fx } = landed(CLEAN)
    const busy = recorder()
    drawSpray(busy.ctx, fx)
    expect(busy.fills).toHaveLength(fx.count)

    fx.count = 0
    const idle = recorder()
    drawSpray(idle.ctx, fx)
    expect(idle.fills).toHaveLength(0)
  })

  it('leaves the context alpha as it found it', () => {
    const { fx, view } = landed(WIPEOUT)
    const { ctx } = recorder()

    drawSpray(ctx, fx)
    expect(ctx.globalAlpha).toBe(1)

    drawVerdict(ctx, frameCamera(), view, fx)
    expect(ctx.globalAlpha).toBe(1)
  })
})

describe('altitude shadow', () => {
  it('shrinks toward nothing as the rider climbs', () => {
    // The height cue that does not move with the camera: a 4m air and a 12m
    // air leave visibly different marks on the water.
    const low = recorder()
    drawAltitudeShadow(low.ctx, frameCamera(4), frameView(4))

    const high = recorder()
    drawAltitudeShadow(high.ctx, frameCamera(12), frameView(12))

    expect(low.ctx.globalAlpha).toBe(1)
    expect(low.styles).toContain(PALETTE.shadow)
    expect(high.styles).toContain(PALETTE.shadow)
  })

  it('is gone entirely past SHADOW_FADE_M', () => {
    const { ctx, styles } = recorder()
    drawAltitudeShadow(ctx, frameCamera(TUNING.SHADOW_FADE_M + 1), frameView(TUNING.SHADOW_FADE_M + 1))
    expect(styles).toHaveLength(0)
  })
})
