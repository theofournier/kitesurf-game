// The run readout of spec §7.1 and §8: the tier, the score, the combo, and the
// two things that only appear when something has happened — the tier banner and
// the word a fatal crash ends on.
import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { createEffects, TIER_FLASH_TIME } from '../../src/render/effects.ts'
import { createHud, drawHud, tierLabel } from '../../src/render/hud.ts'
import { createView } from '../../src/render/view.ts'
import { PHASE } from '../../src/sim/rider.ts'

const W = 1200
const H = 800

/** Records the text one HUD pass lays down. */
function draw(build: (view: ReturnType<typeof createView>) => void, tierFlash = 0, flash = 0) {
  const texts: string[] = []
  const noop = () => {}
  const ctx = {
    fillText: (text: string) => void texts.push(text),
    fillRect: noop,
    fillStyle: '',
    font: '',
    textAlign: 'left',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D

  const view = createView()
  view.width = W
  view.height = H
  view.wind = TUNING.WIND_BASE
  build(view)

  const fx = createEffects()
  fx.tier = view.tier
  fx.tierFlash = tierFlash
  fx.flash = flash
  fx.quality = TUNING.CLEAN_QUALITY

  drawHud(ctx, createHud(), view, fx)
  // Each label is drawn twice, once for its halo — the set is what was said.
  return new Set(texts)
}

describe('drawHud', () => {
  it('names the tier the rider is in', () => {
    for (const tier of [1, 2, 3, 4]) {
      expect(draw((view) => void (view.tier = tier))).toContain(tierLabel(tier))
    }
  })

  it('holds a tier off the end of the table inside it', () => {
    expect(tierLabel(0)).toBe(tierLabel(1))
    expect(tierLabel(99)).toBe(tierLabel(4))
  })

  it('shows the score, rounded, with the wind, the board speed and the distance', () => {
    const texts = draw((view) => {
      view.x = 812.4
      view.wind = 18.6
      view.speed = 14.27
      view.score.total = 1234.56
    })

    expect(texts).toContain('1235')
    expect(texts).toContain('19kt · 14.3m/s · 812m')
  })

  it('says nothing about a 1x combo and shows every one above it', () => {
    expect(draw((view) => void (view.score.combo = 1))).not.toContain('1x')
    expect(draw((view) => void (view.score.combo = 4))).toContain('4x')
  })

  it('shows what the last jump scored, for as long as its verdict is up', () => {
    // The flash is the landing verdict's own beat (spec §3.7), so the score and
    // the word go up and come down together.
    const landed = draw((view) => void (view.score.lastJump = 1540.4), 0, TUNING.FLASH_TIME)
    const later = draw((view) => void (view.score.lastJump = 1540.4))

    expect(landed).toContain('+1540')
    expect(later).not.toContain('+1540')
  })

  it('shows nothing for a wipeout, which scored nothing', () => {
    const wiped = draw((view) => void (view.score.lastJump = 0), 0, TUNING.FLASH_TIME)

    expect(wiped).not.toContain('+0')
  })

  it('announces a tier transition only while the banner is running', () => {
    const quiet = draw((view) => void (view.tier = 3))
    const banner = draw((view) => {
      view.tier = 3
      view.wind = 25
    }, TIER_FLASH_TIME)

    expect(quiet).not.toContain('25kt')
    expect(banner).toContain('TIER 3')
    expect(banner).toContain('25kt')
  })

  it('asks for the kite back for as long as it is in the water (spec §7.2)', () => {
    const riding = draw((view) => void (view.phase = PHASE.RIDING))
    const down = draw((view) => void (view.phase = PHASE.WIPEOUT))

    expect(riding).not.toContain('STEER THE KITE TO THE EDGE')
    expect(down).toContain('STEER THE KITE TO THE EDGE')
  })

  // What a run that ended says is the game-over card's, in overlay.test.ts. The
  // HUD is the readout of a run in progress, and this is the assertion that it
  // has not grown a second one: nothing in it changes when the run ends.
  it('leaves the end of a run to the overlay (spec §8.4)', () => {
    const running = draw((view) => {
      view.x = 640.2
      view.score.total = 900
    })
    const over = draw((view) => {
      view.over = true
      view.x = 640.2
      view.score.total = 900
    })

    expect(over).toEqual(running)
    expect(over).not.toContain('RUN OVER')
  })
})

describe('the string cache', () => {
  it('rebuilds a label only when the number a player can read has moved', () => {
    const hud = createHud()
    const view = createView()
    view.width = W
    view.height = H
    view.wind = 18.2
    view.speed = 12.34
    view.x = 100.1
    view.score.total = 40.2

    const noop = () => {}
    const ctx = {
      fillText: noop,
      fillRect: noop,
      fillStyle: '',
      font: '',
      textAlign: 'left',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D

    drawHud(ctx, hud, view, createEffects())
    const stat = hud.stat
    const score = hud.score

    // A frame's worth of drift under the rounding: the same strings come back,
    // by identity, so the frame allocated nothing to say the same thing twice.
    view.wind = 18.3
    view.speed = 12.31
    view.x = 100.4
    view.score.total = 40.4
    drawHud(ctx, hud, view, createEffects())

    expect(hud.stat).toBe(stat)
    expect(hud.score).toBe(score)

    view.x = 101.9
    drawHud(ctx, hud, view, createEffects())
    expect(hud.stat).not.toBe(stat)
    expect(hud.stat).toBe('18kt · 12.3m/s · 102m')
  })
})
