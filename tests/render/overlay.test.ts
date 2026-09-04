// The two screens either side of a run (spec §8.4, §10): the direction select
// and the game-over card, both drawn over a scene that is still there.
import { describe, expect, it } from 'vitest'
import {
  createOverlay,
  createRecordBreaks,
  drawGameOver,
  drawSelect,
  type RecordBreaks,
} from '../../src/render/overlay.ts'
import { createView, type RenderView } from '../../src/render/view.ts'
import { noRecords, type Records } from '../../src/platform/storage.ts'

const W = 1200
const H = 800

interface Fill {
  x: number
  y: number
  w: number
  h: number
}

/** Runs one overlay pass and reports what it said and what it covered. */
function pass(run: (ctx: CanvasRenderingContext2D, view: RenderView) => void) {
  const texts: string[] = []
  const fills: Fill[] = []
  const ctx = {
    fillText: (text: string) => void texts.push(text),
    fillRect: (x: number, y: number, w: number, h: number) => void fills.push({ x, y, w, h }),
    fillStyle: '',
    font: '',
    textAlign: 'left',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D

  const view = createView()
  view.width = W
  view.height = H
  run(ctx, view)

  // Each label is drawn twice, once for its halo — the set is what was said.
  return { said: new Set(texts), fills }
}

/** The game-over card for a run, against the records it was measured on. */
function card(
  build: (view: RenderView) => void,
  records: Records = noRecords(),
  breaks: RecordBreaks = createRecordBreaks(),
) {
  return pass((ctx, view) => {
    build(view)
    drawGameOver(ctx, createOverlay(), view, records, breaks)
  })
}

describe('the game-over card (spec §8.4)', () => {
  it('says the run is over, and shows the total with both sub-stats', () => {
    const { said } = card((view) => {
      view.x = 1842.6
      view.score.total = 12480.4
      view.score.bestJump = 8.44
    })

    expect(said).toContain('RUN OVER')
    // Rounded on the way to the screen, the same as the HUD: the sim keeps the
    // exact value, and this is a readout of the number rather than the number.
    expect(said).toContain('12480')
    expect(said).toContain('8.4m')
    expect(said).toContain('1843m')
  })

  it('names the two sub-stats the spec asks for', () => {
    const { said } = card(() => {})

    expect(said).toContain('BEST JUMP')
    expect(said).toContain('DISTANCE')
    expect(said).toContain('SCORE')
  })

  it('shows what each one was up against', () => {
    const { said } = card(() => {}, { score: 9300, jump: 7.1, distance: 2400 })

    expect(said).toContain('PB 9300')
    expect(said).toContain('PB 7.1m')
    expect(said).toContain('PB 2400m')
  })

  it('badges only the records this run actually beat', () => {
    const breaks = { score: false, jump: true, distance: false }
    const { said } = card(() => {}, { score: 9300, jump: 7.1, distance: 2400 }, breaks)

    expect(said).toContain('NEW BEST')
    // The two that stood are still showing the number to beat, so the card
    // answers "did anything move?" without being read closely.
    expect(said).toContain('PB 9300')
    expect(said).toContain('PB 2400m')
    expect(said).not.toContain('PB 7.1m')
  })

  it('offers the restart in one line, and no confirm dialog', () => {
    const { said } = card(() => {})
    const prompt = [...said].find((text) => text.includes('AGAIN'))

    expect(prompt).toBe('ANY KEY OR TAP TO RIDE AGAIN')
    // Nothing to agree to, nothing to decline.
    expect([...said].some((text) => /YES|NO|CONFIRM|ARE YOU SURE/.test(text))).toBe(false)
  })

  it('draws over the scene rather than instead of it', () => {
    const { fills } = card(() => {})
    const scrim = fills.filter((f) => f.x === 0 && f.y === 0 && f.w === W && f.h === H)

    // One wash over the whole frame and nothing else: the crash is still there
    // underneath, which is the half of the card the player is looking at.
    expect(scrim.length).toBe(1)
    expect(fills.length).toBe(1)
  })
})

describe('the direction select (spec §6.5)', () => {
  function select(records: Records = noRecords()) {
    return pass((ctx, view) => drawSelect(ctx, createOverlay(), view, records))
  }

  it('offers exactly two sides, and says how to pick one', () => {
    const { said } = select()

    expect(said).toContain('←  RIDE LEFT')
    expect(said).toContain('RIDE RIGHT  →')
    expect(said).toContain('arrow keys, or tap a side of the screen')
  })

  it('shows the records the markers are about to stand for', () => {
    const { said } = select({ score: 9300, jump: 7.1, distance: 2400 })

    expect(said).toContain('PB 9300')
    expect(said).toContain('PB 7.1m')
    expect(said).toContain('PB 2400m')
  })

  it('says nothing about records to a player who has none', () => {
    // A row of zeroes would teach a first-time player that the buoy and the
    // line in the sky mean nothing.
    expect([...select().said].some((text) => text.startsWith('PB'))).toBe(false)
  })
})

describe('the string cache', () => {
  it('rebuilds a label only when the number a player can read has moved', () => {
    const overlay = createOverlay()
    const view = createView()
    view.width = W
    view.height = H
    view.x = 1842.6
    view.score.total = 12480.4

    const noop = () => {}
    const ctx = {
      fillText: noop,
      fillRect: noop,
      fillStyle: '',
      font: '',
      textAlign: 'left',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D
    const records = noRecords()

    drawGameOver(ctx, overlay, view, records, createRecordBreaks())
    const score = overlay.score
    const distance = overlay.distance

    // A card sitting on screen for a minute is 3600 frames of the same numbers.
    view.score.total = 12480.49
    view.x = 1842.61
    drawGameOver(ctx, overlay, view, records, createRecordBreaks())
    expect(overlay.score).toBe(score)
    expect(overlay.distance).toBe(distance)

    view.score.total = 12481
    drawGameOver(ctx, overlay, view, records, createRecordBreaks())
    expect(overlay.score).not.toBe(score)
  })
})
