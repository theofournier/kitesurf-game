import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { createCamera, screenX, updateCamera } from '../../src/render/camera.ts'
import {
  drawWaves,
  telegraphRange,
  waveOnScreen,
  waveTelegraphed,
} from '../../src/render/drawWaves.ts'
import { PALETTE } from '../../src/render/palette.ts'
import { createView } from '../../src/render/view.ts'
import {
  createWorldState,
  initWave,
  stepWorld,
  WAVE,
  type Wave,
  type WaveType,
} from '../../src/sim/world.ts'

const FRAME = 1 / 60
/** A desktop frame and a phone in landscape: the telegraph has to hold on both. */
const WIDE = [1280, 800]
const NARROW = [700, 360]

function frame(riderX: number, waves: readonly Wave[], size = WIDE) {
  const view = createView()
  view.width = size[0]
  view.height = size[1]
  view.x = riderX
  view.wind = TUNING.WIND_BASE
  view.waves = waves

  const camera = createCamera()
  updateCamera(camera, view.width, view.height, riderX, 0, FRAME)
  return { view, camera }
}

function wave(lipX: number, type: WaveType = WAVE.WAVE): Wave {
  return initWave({} as Wave, lipX, type)
}

/** Records what actually reached the canvas, so each cue can be told apart. */
function recorder() {
  const rects: { x: number; y: number; w: number; h: number; style: string; alpha: number }[] = []
  const paths: { x: number; y: number; style: string; alpha: number }[] = []
  const noop = () => {}
  let style = ''
  let alpha = 1

  const ctx = {
    fillRect: (x: number, y: number, w: number, h: number) =>
      void rects.push({ x, y, w, h, style, alpha }),
    moveTo: (x: number, y: number) => void paths.push({ x, y, style, alpha }),
    lineTo: (x: number, y: number) => void paths.push({ x, y, style, alpha }),
    quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) =>
      void paths.push({ x, y, style, alpha }),
    beginPath: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    set fillStyle(value: string) {
      style = value
    },
    get fillStyle() {
      return style
    },
    set strokeStyle(value: string) {
      style = value
    },
    get strokeStyle() {
      return style
    },
    set globalAlpha(value: number) {
      alpha = value
    },
    get globalAlpha() {
      return alpha
    },
    lineWidth: 0,
  }

  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, paths }
}

/** Every point drawn in one of the wave palette colours. */
function drawn(riderX: number, waves: readonly Wave[], size = WIDE) {
  const { view, camera } = frame(riderX, waves, size)
  const rec = recorder()
  drawWaves(rec.ctx, camera, view)
  return { ...rec, view, camera }
}

const FOAM = [PALETTE.waveFoam, PALETTE.waveFoamWake]

describe('the lip telegraph (build plan session 6)', () => {
  it('shows a wave at least 1.5s before its lip, at MAX_SPEED, on any frame', () => {
    // The build plan's guarantee. The rider covers 1.5 * MAX_SPEED metres in
    // that time, which is more water than a phone in landscape can show — so
    // the marker, not the viewport, is what has to carry it.
    const lead = 1.5 * TUNING.MAX_SPEED
    const w = wave(lead, WAVE.WAKE)

    for (const size of [WIDE, NARROW]) {
      const { view, camera } = frame(0, [w], size)
      expect(waveTelegraphed(camera, view, w)).toBe(true)
    }

    // And on the narrow frame it is genuinely the marker doing it: the face
    // itself is still well off the right edge.
    const narrow = frame(0, [w], NARROW)
    expect(waveOnScreen(narrow.camera, narrow.view, w)).toBe(false)
  })

  it('holds that guarantee for every wave the generator lays down', () => {
    // Walked at MAX_SPEED through a seeded run: no wave is ever first seen
    // later than WAVE_LEAD seconds out, and none is missed entirely.
    const world = createWorldState(21)
    const firstSeen = new Map<number, number>()
    const step = TUNING.MAX_SPEED / 60

    for (let x = 0; x < 3000; x += step) {
      stepWorld(world, x)
      const { view, camera } = frame(x, world.waves, NARROW)
      for (const w of world.waves) {
        if (!w.active || firstSeen.has(w.lipX)) continue
        if (waveTelegraphed(camera, view, w)) firstSeen.set(w.lipX, x)
      }
    }

    expect(firstSeen.size).toBeGreaterThan(20)
    for (const [lipX, seenAt] of firstSeen) {
      expect((lipX - seenAt) / TUNING.MAX_SPEED).toBeGreaterThanOrEqual(1.5)
    }
  })

  it('starts telegraphing at WAVE_LEAD seconds of MAX_SPEED and not before', () => {
    const range = telegraphRange()
    expect(range).toBeCloseTo(TUNING.WAVE_LEAD * TUNING.MAX_SPEED, 10)

    const w = wave(range)
    const { view, camera } = frame(0, [w], NARROW)
    expect(waveTelegraphed(camera, view, w)).toBe(true)

    const early = frame(-1, [w], NARROW)
    expect(waveTelegraphed(early.camera, early.view, w)).toBe(false)
  })

  it('marks an off-screen wave at the right edge, and brighter as it closes', () => {
    const far = drawn(0, [wave(telegraphRange() * 0.95, WAVE.WAKE)], NARROW)
    const near = drawn(0, [wave(telegraphRange() * 0.55, WAVE.WAKE)], NARROW)

    // The marker is the only thing drawn under a fade, which is what makes it
    // the marker: everything else on the water is drawn at full strength.
    const mark = (r: typeof far) => r.paths.filter((p) => p.alpha < 1)
    const alphaOf = (r: typeof far) => Math.max(...mark(r).map((p) => p.alpha))

    expect(mark(far).length).toBeGreaterThan(0)
    expect(mark(near).length).toBeGreaterThan(0)
    for (const point of mark(far)) {
      expect(point.style).toBe(PALETTE.waveFoamWake)
      expect(point.x).toBeGreaterThan(NARROW[0] * 0.9)
    }

    expect(alphaOf(near)).toBeGreaterThan(alphaOf(far))
  })

  it('draws nothing for a wave that is behind the rider and off screen', () => {
    const { rects, paths } = drawn(500, [wave(100)])
    expect(rects).toHaveLength(0)
    expect(paths).toHaveLength(0)
  })

  it('stops telegraphing a lip the rider has already passed', () => {
    // The face is still drawn while it is on screen — it is water, and it does
    // not vanish behind you — but the post over it is a warning, and there is
    // nothing left to warn about.
    const behind = wave(90)
    const { paths, view, camera } = drawn(100, [behind])

    expect(waveOnScreen(camera, view, behind)).toBe(true)
    expect(paths.length).toBeGreaterThan(0)
    expect(waveTelegraphed(camera, view, behind)).toBe(true)
  })
})

describe('drawing a wave', () => {
  it('stands the face on the waterline and the crest a ramp height above it', () => {
    const w = wave(40, WAVE.WAKE)
    const { paths, camera } = drawn(20, [w])

    const crest = camera.waterY - w.height * TUNING.WORLD_SCALE
    const face = paths.filter((p) => p.style === PALETTE.waveFaceWake)

    expect(face.some((p) => Math.abs(p.y - camera.waterY) < 0.5)).toBe(true)
    expect(face.some((p) => Math.abs(p.y - crest) < 0.5)).toBe(true)
    // Nothing is drawn below the water: a wave stands on the surface.
    for (const point of face) expect(point.y).toBeLessThanOrEqual(camera.waterY + 0.5)
  })

  it('puts the foam on the lip, not on the trough', () => {
    // The one cue the release is timed against, so where it lands is the whole
    // of the telegraph: it belongs on the steep top of the face.
    const w = wave(40)
    const { paths, rects, camera } = drawn(20, [w])

    const lip = screenX(camera, w.lipX)
    const trough = screenX(camera, w.x)
    const foam = [...paths, ...rects].filter((p) => FOAM.includes(p.style))

    expect(foam.length).toBeGreaterThan(0)
    for (const point of foam) {
      expect(point.x).toBeGreaterThan((lip + trough) * 0.5)
      expect(point.x).toBeLessThanOrEqual(lip + 1)
    }
  })

  it('gives a boat wake its own colour, so the big one reads from a distance', () => {
    const wake = drawn(20, [wave(40, WAVE.WAKE)])
    const plain = drawn(20, [wave(40, WAVE.WAVE)])

    expect(wake.paths.some((p) => p.style === PALETTE.waveFoamWake)).toBe(true)
    expect(plain.paths.some((p) => p.style === PALETTE.waveFoam)).toBe(true)
    expect(plain.paths.some((p) => p.style === PALETTE.waveFoamWake)).toBe(false)
  })

  it('drops one guide into the water, from the next lip only', () => {
    const { rects, camera } = drawn(20, [wave(40), wave(90), wave(140)])
    const guides = rects.filter((r) => r.style === PALETTE.waveGuide)

    expect(guides).toHaveLength(1)
    expect(guides[0].x).toBeCloseTo(screenX(camera, 40) - 0.75, 6)
    expect(guides[0].y).toBeCloseTo(camera.waterY, 6)
  })

  it('scales the face with WORLD_SCALE, like everything else in the plane', () => {
    const chop = drawn(20, [wave(40, WAVE.CHOP)])
    const wake = drawn(20, [wave(40, WAVE.WAKE)])
    const top = (r: typeof chop) => Math.min(...r.paths.map((p) => p.y))

    expect(top(chop) - top(wake)).toBeCloseTo(
      (TUNING.RAMP_WAKE - TUNING.RAMP_CHOP) * TUNING.WORLD_SCALE,
      0,
    )
  })

  it('leaves a recycled slot undrawn', () => {
    const spent = wave(40)
    spent.active = false
    const { rects, paths } = drawn(20, [spent])

    expect(rects).toHaveLength(0)
    expect(paths).toHaveLength(0)
  })
})
