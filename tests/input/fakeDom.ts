// The smallest DOM an input adapter needs, built on node's own EventTarget.
//
// Both adapters take the element and the global scope they listen on as
// arguments rather than reaching for globals, which is what lets them be driven
// here with no jsdom and no browser — the same property the sim has, for the
// same reason.
export type FakeCanvas = HTMLCanvasElement & { captured: number[] }

/** A canvas-shaped EventTarget with a fixed bounding rect. */
export function createFakeCanvas(
  width: number,
  height: number,
  left = 0,
  top = 0,
): FakeCanvas {
  const rect = {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect

  const captured: number[] = []

  return Object.assign(new EventTarget(), {
    style: { cursor: '' },
    clientWidth: width,
    clientHeight: height,
    captured,
    getBoundingClientRect: () => rect,
    setPointerCapture(id: number): void {
      captured.push(id)
    },
    releasePointerCapture(id: number): void {
      const at = captured.indexOf(id)
      if (at >= 0) captured.splice(at, 1)
    },
  }) as unknown as FakeCanvas
}

export interface PointerProps {
  pointerId?: number
  pointerType?: string
  button?: number
  clientX?: number
  clientY?: number
}

/** A PointerEvent as far as the adapters are concerned: the six fields they read. */
export function pointerEvent(type: string, props: PointerProps = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: 0,
    clientY: 0,
    ...props,
  })
}

export function keyEvent(type: string, code: string, repeat = false): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code, repeat })
}
