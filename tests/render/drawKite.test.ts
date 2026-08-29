import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { createCamera, updateCamera } from '../../src/render/camera.ts'
import { drawGhostMarker, drawKite } from '../../src/render/drawKite.ts'
import { createView, type RenderView } from '../../src/render/view.ts'

const W = 1200
const H = 800

interface Op {
  op: string
  args: number[]
}

/**
 * A recording stand-in for the 2D context. The draw functions are geometry
 * with a paint call at the end, and the geometry is the part worth testing —
 * this is what lets that happen in Node, with no canvas anywhere.
 */
function recorder() {
  const ops: Op[] = []
  const record =
    (op: string) =>
    (...args: number[]) =>
      void ops.push({ op, args })

  const ctx = {
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    arc: record('arc'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  }

  return { ops, ctx: ctx as unknown as CanvasRenderingContext2D }
}

function framed() {
  const camera = createCamera()
  updateCamera(camera, W, H, 0, 0, 1)
  return camera
}

function viewAt(angle: number, tension: number): RenderView {
  const view = createView()
  view.width = W
  view.height = H
  view.kiteAngle = angle
  view.kiteTarget = angle
  view.wind = TUNING.WIND_BASE
  view.tension = tension
  return view
}

/**
 * The kite quad's two tips. The quad is the last path drawn — the lines go
 * down first, under it — and runs tip, nose, tip, tail.
 */
function tips(ops: Op[]) {
  let start = -1
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].op === 'moveTo') start = i
  }

  const corners = [ops[start].args]
  for (let i = start + 1; i < ops.length && ops[i].op === 'lineTo'; i++) {
    corners.push(ops[i].args)
  }

  return { a: corners[0], b: corners[2] }
}

/** Midpoint of the two tips: where on the arc the kite is. */
function kiteCentre(ops: Op[]) {
  const { a, b } = tips(ops)
  return { x: (a[0] + b[0]) * 0.5, y: (a[1] + b[1]) * 0.5 }
}

/** Control-point drop of each line below the straight hand→tip chord. */
function sags(ops: Op[]): number[] {
  const out: number[] = []
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].op !== 'quadraticCurveTo') continue
    const [cx, cy, tipX, tipY] = ops[i].args
    const [handX, handY] = ops[i - 1].args
    void cx
    void tipX
    void handX
    out.push(cy - (handY + tipY) * 0.5)
  }
  return out
}

describe('drawKite', () => {
  it('flies the kite on the compressed radius, straight above the harness at zenith', () => {
    const camera = framed()
    const { ops, ctx } = recorder()
    drawKite(ctx, camera, viewAt(0, 0))

    const centre = kiteCentre(ops)
    expect(centre.x).toBeCloseTo(camera.anchorX, 6)
    expect(centre.y).toBeCloseTo(camera.harnessY - TUNING.LINE_RADIUS, 6)
  })

  it('puts the edge of the window level with the harness, ahead of the rider', () => {
    const camera = framed()
    const { ops, ctx } = recorder()
    drawKite(ctx, camera, viewAt(90, 1))

    const centre = kiteCentre(ops)
    expect(centre.x).toBeCloseTo(camera.anchorX + TUNING.LINE_RADIUS, 6)
    expect(centre.y).toBeCloseTo(camera.harnessY, 6)
  })

  it('keeps the kite on the arc at every window position', () => {
    const camera = framed()
    for (let angle = 0; angle <= 90; angle += 5) {
      const { ops, ctx } = recorder()
      drawKite(ctx, camera, viewAt(angle, 0.5))

      const centre = kiteCentre(ops)
      const dx = centre.x - camera.anchorX
      const dy = centre.y - camera.harnessY
      expect(Math.hypot(dx, dy)).toBeCloseTo(TUNING.LINE_RADIUS, 6)
    }
  })

  it('draws the kite the width the spec asks for', () => {
    const camera = framed()
    const { ops, ctx } = recorder()
    drawKite(ctx, camera, viewAt(35, 0.5))

    const { a, b } = tips(ops)
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(TUNING.KITE_W, 6)
  })

  it('runs two lines from the hands to the two tips', () => {
    const camera = framed()
    const { ops, ctx } = recorder()
    drawKite(ctx, camera, viewAt(45, 0.5))

    expect(ops.filter((o) => o.op === 'quadraticCurveTo')).toHaveLength(2)
  })

  it('bellies the lines when depowered and pulls them straight under load', () => {
    const camera = framed()

    const slack = recorder()
    drawKite(slack.ctx, camera, viewAt(0, 0))
    const loaded = recorder()
    drawKite(loaded.ctx, camera, viewAt(50, 1))

    // Spec §6.3: sag is proportional to inverse tension. Slack and curved at
    // zenith, dead straight on the edge.
    for (const sag of sags(slack.ops)) expect(sag).toBeCloseTo(TUNING.LINE_SAG, 6)
    for (const sag of sags(loaded.ops)) expect(sag).toBeCloseTo(0, 6)
  })

  it('slackens the lines monotonically as tension falls away', () => {
    const camera = framed()
    let previous = -1

    for (let tension = 1; tension >= 0; tension -= 0.1) {
      const { ops, ctx } = recorder()
      drawKite(ctx, camera, viewAt(45, tension))
      const sag = sags(ops)[0]
      expect(sag).toBeGreaterThan(previous)
      previous = sag
    }
  })

  it('trembles above tier 1 and holds still at tier 1', () => {
    const camera = framed()

    const calm = viewAt(45, 0.5)
    const gusting = viewAt(45, 0.5)
    gusting.wind = TUNING.WIND_BASE * 2

    // Tremble is driven by sim time, so it is the same in every replay of the
    // same run — and at tier 1 there is none at all.
    for (const time of [0, 0.017, 0.033]) {
      calm.time = time
      gusting.time = time

      const still = recorder()
      drawKite(still.ctx, camera, calm)
      const shaken = recorder()
      drawKite(shaken.ctx, camera, gusting)

      expect(sags(still.ops)[0]).toBeCloseTo(TUNING.LINE_SAG * 0.5, 6)
      if (time > 0) expect(sags(shaken.ops)[0]).not.toBeCloseTo(TUNING.LINE_SAG * 0.5, 6)
    }
  })
})

describe('drawGhostMarker', () => {
  it('marks the target position on the arc, not the kite position', () => {
    const camera = framed()
    const view = viewAt(0, 0)
    view.kiteTarget = 90

    const { ops, ctx } = recorder()
    drawGhostMarker(ctx, camera, view)

    const [x, y] = ops.find((o) => o.op === 'arc')!.args
    expect(x).toBeCloseTo(camera.anchorX + TUNING.LINE_RADIUS, 6)
    expect(y).toBeCloseTo(camera.harnessY, 6)
  })
})
