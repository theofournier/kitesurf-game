import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { createCamera, screenX, updateCamera } from '../../src/render/camera.ts'
import {
  drawObstacles,
  obstacleOnScreen,
  obstacleRange,
  obstacleTelegraphed,
} from '../../src/render/drawObstacles.ts'
import { PALETTE } from '../../src/render/palette.ts'
import { createView } from '../../src/render/view.ts'
import { minSafeGap } from '../../src/sim/fairness.ts'
import {
  createObstacle,
  initBoat,
  initObstacle,
  OBSTACLE,
  type Obstacle,
  type ObstacleType,
} from '../../src/sim/obstacles.ts'
import { createWorldState, stepWorld } from '../../src/sim/world.ts'

const FRAME = 1 / 60
/** A desktop frame and a phone in landscape: the telegraph has to hold on both. */
const WIDE = [1280, 800]
const NARROW = [700, 360]
const TIERS = [12, 18, 25, 35]

function frame(riderX: number, obstacles: readonly Obstacle[], wind = TUNING.WIND_BASE, size = WIDE) {
  const view = createView()
  view.width = size[0]
  view.height = size[1]
  view.x = riderX
  view.wind = wind
  view.obstacles = obstacles

  const camera = createCamera()
  updateCamera(camera, view.width, view.height, riderX, 0, FRAME)
  return { view, camera }
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

function drawn(riderX: number, obstacles: readonly Obstacle[], wind = TUNING.WIND_BASE, size = WIDE) {
  const { view, camera } = frame(riderX, obstacles, wind, size)
  const rec = recorder()
  drawObstacles(rec.ctx, camera, view)
  return { ...rec, view, camera }
}

function buoy(x: number): Obstacle {
  return initObstacle(createObstacle(), x, OBSTACLE.BUOY)
}

describe('drawing an obstacle (spec §9.1)', () => {
  it('stands each object up at the height the sim says it is', () => {
    for (const type of [OBSTACLE.BUOY, OBSTACLE.PIER] as ObstacleType[]) {
      const obstacle = initObstacle(createObstacle(), 20, type)
      const { rects, camera } = drawn(10, [obstacle])
      const body = rects.find((r) => r.style === PALETTE.hull)

      expect(body).toBeDefined()
      expect(camera.waterY - body!.y).toBeCloseTo(obstacle.height * TUNING.WORLD_SCALE, 6)
      expect(body!.w).toBeCloseTo(obstacle.len * TUNING.WORLD_SCALE, 6)
    }
  })

  it('gives a boat its mast, taller than the hull it stands on', () => {
    const boat = initBoat(createObstacle(), 20)
    const { rects, camera } = drawn(10, [boat])
    const bodies = rects.filter((r) => r.style === PALETTE.hull)
    const heights = bodies.map((r) => (camera.waterY - r.y) / TUNING.WORLD_SCALE)

    expect(heights.length).toBe(2)
    expect(Math.min(...heights)).toBeCloseTo(TUNING.BOAT_HULL_H, 6)
    expect(Math.max(...heights)).toBeCloseTo(TUNING.BOAT_MAST_H, 6)
  })

  it('caps every object with the lit line the jump has to beat', () => {
    const { rects } = drawn(10, [buoy(20)])
    expect(rects.some((r) => r.style === PALETTE.hullTop)).toBe(true)
  })

  it('draws nothing at all for a slot out of play', () => {
    const gone = buoy(20)
    gone.active = false
    expect(drawn(10, [gone]).rects).toHaveLength(0)
  })
})

describe('the obstacle telegraph', () => {
  /**
   * The visibility half of spec §9.2. The gate reserves `minSafeGap` metres in
   * front of every spawn on the promise that the player can use them, and a
   * player cannot use metres they are looking at an empty sea through. On a
   * phone in landscape the viewport is barely thirty metres of water, so this
   * is carried by the edge marker rather than by the frame.
   */
  it('shows every obstacle from at least the gap its own spawn gate reserved', () => {
    for (const wind of TIERS) {
      const world = createWorldState(17)
      const firstSeen = new Map<number, { type: ObstacleType; at: number }>()
      const step = TUNING.MAX_SPEED / 60

      for (let x = 0; x < 3000; x += step) {
        stepWorld(world, x, wind)
        const { view, camera } = frame(x, world.obstacles, wind, NARROW)
        for (const obstacle of world.obstacles) {
          if (!obstacle.active || firstSeen.has(obstacle.gateX)) continue
          if (obstacleTelegraphed(camera, view, obstacle)) {
            firstSeen.set(obstacle.gateX, { type: obstacle.type, at: x })
          }
        }
      }

      expect(firstSeen.size).toBeGreaterThan(5)
      for (const [gateX, seen] of firstSeen) {
        // Less one step of the walk: the rider is sampled every DT, so the
        // frame that first shows an object can be up to one step past the
        // metre it became visible on. That is this test's resolution, not the
        // telegraph's.
        expect(gateX - seen.at, `${seen.type} at ${wind}kt`).toBeGreaterThanOrEqual(
          minSafeGap(seen.type, wind) - step,
        )
      }
    }
  })

  it('reserves nothing it cannot show: the range covers the gate for every type', () => {
    for (const wind of TIERS) {
      for (const type of [OBSTACLE.BUOY, OBSTACLE.BOAT, OBSTACLE.PIER] as ObstacleType[]) {
        const obstacle =
          type === OBSTACLE.BOAT
            ? initBoat(createObstacle(), 100)
            : initObstacle(createObstacle(), 100, type)

        expect(obstacleRange(obstacle, wind)).toBeGreaterThanOrEqual(minSafeGap(type, wind))
      }
    }
  })

  it('marks an object that is still off the right of the frame', () => {
    // Far enough out to be off a narrow screen and inside the telegraph range.
    const far = buoy(45)
    const { rects, paths, camera, view } = drawn(0, [far], TUNING.WIND_BASE, NARROW)

    expect(obstacleOnScreen(camera, view, far)).toBe(false)
    expect(obstacleTelegraphed(camera, view, far)).toBe(true)

    expect(paths.filter((p) => p.style === PALETTE.hullMark).length).toBeGreaterThan(0)
    expect(rects).toHaveLength(0)
    expect(screenX(camera, far.x)).toBeGreaterThan(view.width)
  })

  it('stops marking one the rider has already ridden past', () => {
    const behind = buoy(10)
    const { paths } = drawn(40, [behind], TUNING.WIND_BASE, NARROW)
    expect(paths.filter((p) => p.style === PALETTE.hullMark)).toHaveLength(0)
  })

  it('gets louder as the object closes', () => {
    const near = buoy(45)
    const far = buoy(75)
    const alphaOf = (obstacle: Obstacle) => {
      const { paths } = drawn(0, [obstacle], TUNING.WIND_BASE, NARROW)
      return paths.filter((p) => p.style === PALETTE.hullMark)[0]?.alpha ?? 0
    }

    expect(alphaOf(near)).toBeGreaterThan(alphaOf(far))
  })
})
