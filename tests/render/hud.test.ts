// The run readout of spec §7.1 and §8: the tier, the score, the combo, and the
// two things that only appear when something has happened — the tier banner and
// the word a fatal crash ends on.
import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { createCamera, updateCamera } from '../../src/render/camera.ts'
import { createEffects, TIER_FLASH_TIME } from '../../src/render/effects.ts'
import { createHud, drawHud, tierLabel } from '../../src/render/hud.ts'
import { createView } from '../../src/render/view.ts'
import { PHASE } from '../../src/sim/rider.ts'

const W = 1200
const H = 800

/** Records the text one HUD pass lays down, and where each piece went. */
function lay(build: (view: ReturnType<typeof createView>) => void, tierFlash = 0, flash = 0) {
  const said: { text: string; x: number; y: number }[] = []
  const noop = () => {}
  const ctx = {
    fillText: (text: string, x: number, y: number) => void said.push({ text, x, y }),
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

  const camera = createCamera()
  updateCamera(camera, W, H, view.x, view.altitude, 1)

  drawHud(ctx, createHud(), camera, view, fx)
  return { said, camera }
}

/** Just what one HUD pass said. Each label is drawn twice, once for its halo. */
function draw(build: (view: ReturnType<typeof createView>) => void, tierFlash = 0, flash = 0) {
  return new Set(lay(build, tierFlash, flash).said.map((one) => one.text))
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

describe('the height of the last air (in the corner)', () => {
  it('reports the peak of the air that just finished', () => {
    const said = draw((view) => {
      view.score.landings = 1
      view.score.lastApex = 6.44
    })

    expect(said).toContain('LAST 6.4m')
  })

  it('says nothing before the first air of a run has landed', () => {
    // A run that opens on "LAST 0.0m" is telling the player about a jump they
    // have not taken.
    const fresh = draw(() => {})
    expect([...fresh].some((text) => text.startsWith('LAST'))).toBe(false)
  })

  it('holds through the next air rather than resetting under it', () => {
    // The live number beside the rider is the one that tracks the air in
    // progress; this one is what the *last* one came to, and it has to still be
    // there while the next is being flown.
    const said = draw((view) => {
      view.score.landings = 3
      view.score.lastApex = 6.4
      view.altitude = 2.1
    })

    expect(said).toContain('LAST 6.4m')
    expect(said).toContain('2.1m')
  })

  it('reports a height the rider did not ride away from', () => {
    // `bestJump` is the record of §8.4 and counts landed airs only. This is a
    // readout of what just happened, and a big send that ended badly is still
    // a big send the player wants to be told about.
    const said = draw((view) => {
      view.score.landings = 1
      view.score.lastApex = 9.2
      view.score.bestJump = 4
      view.landingQuality = 0
    })

    expect(said).toContain('LAST 9.2m')
  })

  it('sits under the combo, in the run readout', () => {
    const { said } = lay((view) => {
      view.score.landings = 1
      view.score.lastApex = 6.4
      view.score.combo = 5
    })
    const combo = said.findLast((one) => one.text === '5x')!
    const last = said.findLast((one) => one.text === 'LAST 6.4m')!

    expect(last.x).toBe(combo.x)
    expect(last.y).toBeGreaterThan(combo.y)
  })
})

describe('the height of the air (beside the rider)', () => {
  /**
   * What the height readout said this frame, and where, or null for silence.
   *
   * The last match rather than the first: `label` lays a dark halo down at a
   * one-pixel offset before the text itself, so it is the second of the pair
   * that sits where the number really is.
   */
  function altitude(build: (view: ReturnType<typeof createView>) => void) {
    const { said, camera } = lay(build)
    return { at: said.findLast((one) => /^\d+\.\dm$/.test(one.text)) ?? null, camera }
  }

  it('says how high the rider is, to a tenth of a metre', () => {
    expect(altitude((view) => void (view.altitude = 6.44)).at?.text).toBe('6.4m')
    expect(altitude((view) => void (view.altitude = 12.06)).at?.text).toBe('12.1m')
  })

  it('says nothing at all while the board is on the water', () => {
    // A 0.0m that is on screen more often than not is a number nobody reads —
    // and both a takeoff and a touchdown cross zero.
    expect(altitude((view) => void (view.altitude = 0)).at).toBeNull()
    expect(altitude((view) => void (view.altitude = 0.05)).at).toBeNull()
    expect(altitude((view) => void (view.altitude = 1)).at).not.toBeNull()
  })

  it('sits beside the rider rather than in a corner of the frame', () => {
    const { at, camera } = altitude((view) => void (view.altitude = 8))

    // Close enough to the rider to be read as part of them, and above the board
    // so the landing spray does not come up through it.
    expect(Math.abs(at!.x - camera.anchorX)).toBeLessThan(100)
    expect(at!.y).toBeLessThan(camera.feetY)
    expect(camera.feetY - at!.y).toBeLessThan(TUNING.RIDER_H)
  })

  it('travels with the rider up the frame', () => {
    const low = altitude((view) => void (view.altitude = 2))
    const high = altitude((view) => void (view.altitude = 12))

    // The camera follows altitude at CAM_ALT_FOLLOW, so the rider visibly rises
    // in frame (spec §6.4) and the number rises with them.
    expect(high.at!.y).toBeLessThan(low.at!.y)
    expect(high.camera.feetY).toBeLessThan(low.camera.feetY)
  })

  it('stays on the empty side of the rider when the run mirrors (spec §6.5)', () => {
    const right = altitude((view) => {
      view.altitude = 8
      view.facing = 1
    })
    const left = altitude((view) => {
      view.altitude = 8
      view.facing = -1
    })

    // Behind the rider is the side away from the water they are about to land
    // on, and it changes sides when the run does. The text itself is drawn
    // outside the world mirror, so it reads forwards either way.
    expect(right.at!.x).toBeLessThan(right.camera.anchorX)
    expect(left.at!.x).toBeGreaterThan(W - left.camera.anchorX)
    expect(left.at!.x).toBe(W - right.at!.x)
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

    const camera = createCamera()
    updateCamera(camera, W, H, view.x, view.altitude, 1)

    drawHud(ctx, hud, camera, view, createEffects())
    const stat = hud.stat
    const score = hud.score

    // A frame's worth of drift under the rounding: the same strings come back,
    // by identity, so the frame allocated nothing to say the same thing twice.
    view.wind = 18.3
    view.speed = 12.31
    view.x = 100.4
    view.score.total = 40.4
    drawHud(ctx, hud, camera, view, createEffects())

    expect(hud.stat).toBe(stat)
    expect(hud.score).toBe(score)

    view.x = 101.9
    drawHud(ctx, hud, camera, view, createEffects())
    expect(hud.stat).not.toBe(stat)
    expect(hud.stat).toBe('18kt · 12.3m/s · 102m')
  })
})
