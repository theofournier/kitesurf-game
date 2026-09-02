import { describe, expect, it } from 'vitest'
import { CURSOR_CSS } from '../../src/render/cursor.ts'
import { PALETTE } from '../../src/render/palette.ts'

/** The `url("...")` payload, decoded back into the SVG source. */
function svg(): string {
  const match = /^url\("data:image\/svg\+xml,(.*)"\)/.exec(CURSOR_CSS)!
  return decodeURIComponent(match[1])
}

describe('CURSOR_CSS', () => {
  it('is a data URI with a hotspot and a keyword fallback', () => {
    // The fallback is what shows if the image is ever refused. Without it the
    // browser reaches for the arrow, which is the thing the reticle replaced.
    expect(CURSOR_CSS).toMatch(/^url\("data:image\/svg\+xml,.+"\) \d+ \d+, crosshair$/)
  })

  it('puts the hotspot at the centre of the box it draws', () => {
    const [, x, y] = /"\) (\d+) (\d+), /.exec(CURSOR_CSS)!
    const size = Number(/width='(\d+)'/.exec(svg())![1])

    expect(Number(x)).toBe(size / 2)
    expect(Number(y)).toBe(size / 2)
  })

  it('encodes the payload, so a hex colour cannot cut the URI short', () => {
    // A raw '#' would end the URI and start a fragment: the cursor would
    // silently become the fallback, which is a bug you cannot see.
    const payload = CURSOR_CSS.slice(0, CURSOR_CSS.lastIndexOf('"'))
    expect(payload).not.toContain('#')
    expect(svg()).toContain(PALETTE.cursor)
    expect(svg()).toContain(PALETTE.cursorHalo)
  })

  it('stays inside the size a cursor is reliably shown at', () => {
    expect(Number(/width='(\d+)'/.exec(svg())![1])).toBeLessThanOrEqual(32)
  })

  it('draws the reticle twice, so the light stroke carries a dark halo', () => {
    // On sky it reads by its dark edge and on water by its light one; either
    // alone vanishes against half the frame.
    expect(svg().match(/<circle/g)).toHaveLength(4)
  })
})
