import { beforeEach, describe, expect, it } from 'vitest'
import { createAnchor, axisFromPoint } from '../../src/input/axis.ts'
import { createDesktopInput, type DesktopInput } from '../../src/input/desktop.ts'
import { createInput, type RiderInput } from '../../src/sim/loop.ts'
import { createFakeCanvas, keyEvent, pointerEvent, type FakeCanvas } from './fakeDom.ts'

const WIDTH = 800
const HEIGHT = 400

describe('createDesktopInput', () => {
  let canvas: FakeCanvas
  let scope: EventTarget
  let input: RiderInput
  let adapter: DesktopInput
  const anchor = createAnchor()

  beforeEach(() => {
    canvas = createFakeCanvas(WIDTH, HEIGHT)
    scope = new EventTarget()
    input = createInput()
    anchor.x = 160
    anchor.y = 258
    anchor.facing = 1
    adapter = createDesktopInput(canvas, input, anchor, scope)
  })

  function move(clientX: number, clientY: number, pointerType = 'mouse'): void {
    scope.dispatchEvent(pointerEvent('pointermove', { clientX, clientY, pointerType }))
  }

  it('writes the shared mapping into kiteTarget on every move', () => {
    move(360, 58)
    expect(input.kiteTarget).toBe(axisFromPoint(anchor, 360, 58))
    move(460, 258)
    expect(input.kiteTarget).toBe(1)
  })

  it('invents no target before the first move', () => {
    adapter.refresh()
    expect(input.kiteTarget).toBe(0)
  })

  it('holds the last angle when the pointer stops reporting', () => {
    move(360, 58)
    const held = input.kiteTarget
    scope.dispatchEvent(new Event('blur'))
    expect(input.kiteTarget).toBe(held)
  })

  it('recomputes from the same pointer when the anchor moves under it', () => {
    move(360, 58)
    anchor.y = 158
    adapter.refresh()
    expect(input.kiteTarget).toBe(axisFromPoint(anchor, 360, 58))
  })

  it('loads on either the left button or space, and holds while either is down', () => {
    canvas.dispatchEvent(pointerEvent('pointerdown', { button: 0 }))
    expect(input.loading).toBe(true)
    scope.dispatchEvent(keyEvent('keydown', 'Space'))
    scope.dispatchEvent(pointerEvent('pointerup', { button: 0 }))
    expect(input.loading).toBe(true)
    scope.dispatchEvent(keyEvent('keyup', 'Space'))
    expect(input.loading).toBe(false)
  })

  it('ignores other buttons and other keys', () => {
    canvas.dispatchEvent(pointerEvent('pointerdown', { button: 2 }))
    scope.dispatchEvent(keyEvent('keydown', 'KeyW'))
    expect(input.loading).toBe(false)
  })

  it('releases a held load when the tab loses focus', () => {
    scope.dispatchEvent(keyEvent('keydown', 'Space'))
    expect(input.loading).toBe(true)
    scope.dispatchEvent(new Event('blur'))
    expect(input.loading).toBe(false)
  })

  it('leaves finger pointers to the touch adapter', () => {
    move(360, 58)
    const held = input.kiteTarget
    move(460, 258, 'touch')
    canvas.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch' }))
    expect(input.kiteTarget).toBe(held)
    expect(input.loading).toBe(false)
  })

  it('stops listening once disposed', () => {
    move(360, 58)
    const held = input.kiteTarget
    adapter.dispose()
    move(460, 258)
    scope.dispatchEvent(keyEvent('keydown', 'Space'))
    expect(input.kiteTarget).toBe(held)
    expect(input.loading).toBe(false)
  })
})
