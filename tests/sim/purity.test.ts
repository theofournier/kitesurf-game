// The hard rule, enforced (CLAUDE.md, spec §11.4).
//
// /src/sim is pure: no DOM, no clock, no unseeded randomness, and no import
// that reaches into rendering or input. This is what buys ghosts, replays and
// server-side replay validation, and it is painful to retrofit — so it is
// checked mechanically rather than by review.
import { describe, expect, it } from 'vitest'

/**
 * Every source file under /src/sim, read as text.
 *
 * Through Vite's glob rather than node's fs: it needs no @types/node, it is
 * resolved at build time so a new file in /src/sim is picked up without this
 * test being told about it, and it keeps the test itself as free of platform
 * API as the code it is checking.
 */
const SOURCES = import.meta.glob('../../src/sim/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const FILES = Object.keys(SOURCES).sort()

/** Just the file name, for a readable test title. */
function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * Source with comments stripped. Necessary rather than fussy: half the prose in
 * /src/sim is about the *wind window*, and a bare /\bwindow\b/ over the raw
 * text hits every one of those sentences.
 */
function uncomment(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/**
 * The same, with string literals blanked too, so the global scan reads code and
 * only code. Comments go first: prose is full of apostrophes, and blanking
 * strings before removing them turns "the rider's line" into a string literal
 * that swallows the rest of the file.
 */
function code(source: string): string {
  return uncomment(source)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

/** Every global the sim is not allowed to reach for, and why it is banned. */
const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bwindow\b/, reason: 'DOM: the sim must run headless in Node' },
  { pattern: /\bdocument\b/, reason: 'DOM: the sim must run headless in Node' },
  { pattern: /\bnavigator\b/, reason: 'DOM: the sim must run headless in Node' },
  { pattern: /\blocalStorage\b/, reason: 'persistence is the shell’s job' },
  { pattern: /\bDate\b/, reason: 'a clock breaks determinism' },
  { pattern: /\bperformance\b/, reason: 'a clock breaks determinism' },
  { pattern: /Math\s*\.\s*random/, reason: 'randomness comes from a seeded Rng' },
  { pattern: /\brequestAnimationFrame\b/, reason: 'the sim does not know about frames' },
  { pattern: /\bcanvas\b/i, reason: 'rendering is not the sim’s concern' },
]

describe('/src/sim is pure', () => {
  it('has files to check', () => {
    expect(FILES.length).toBeGreaterThan(0)
  })

  for (const path of FILES) {
    describe(basename(path), () => {
      const source = SOURCES[path]
      const body = code(source)

      for (const { pattern, reason } of FORBIDDEN) {
        it(`does not reference ${String(pattern)} — ${reason}`, () => {
          expect(body).not.toMatch(pattern)
        })
      }

      it('imports nothing from /src/render, /src/input or /src/debug', () => {
        // Read off the comment-free source: what is left is every static and
        // dynamic module specifier the file actually names.
        // Some sim files import nothing at all, which is the purest case.
        for (const [, specifier] of uncomment(source).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
          expect(specifier).not.toMatch(/render|input|debug/)
        }
      })
    })
  }
})
