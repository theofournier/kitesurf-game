import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { formatNumber, serializeTuning, type TuningValues } from '../../src/debug/serialize.ts'

/** Evaluates a dump back into an object, which is what "pasteable" means. */
function evaluate(source: string): TuningValues {
  const literal = source.replace('export const TUNING = ', 'return ')
  return new Function(literal)() as TuningValues
}

/** A detached copy, so no test can mutate the constants the game runs on. */
function clone(): TuningValues {
  const copy: TuningValues = {}
  for (const key of Object.keys(TUNING) as (keyof typeof TUNING)[]) {
    const value = TUNING[key]
    copy[key] = Array.isArray(value) ? value.slice() : value
  }
  return copy
}

describe('serializeTuning', () => {
  it('round-trips the live values through valid TypeScript', () => {
    expect(evaluate(serializeTuning())).toEqual({ ...TUNING })
  })

  it('emits a declaration that can be pasted over tuning.ts', () => {
    const lines = serializeTuning().trimEnd().split('\n')
    expect(lines[0]).toBe('export const TUNING = {')
    expect(lines.at(-1)).toBe('}')
  })

  it('dumps edited values, not the shipped ones', () => {
    const edited = clone()
    edited.BASE_SLEW = 137.5
    edited.CLEAN_BAND = [40, 70]

    const parsed = evaluate(serializeTuning(edited))
    expect(parsed.BASE_SLEW).toBe(137.5)
    expect(parsed.CLEAN_BAND).toEqual([40, 70])
  })

  it('keeps the section headings of tuning.ts, in order', () => {
    const dump = serializeTuning()
    const headings = dump.match(/^ {2}\/\/ \w+$/gm)!.map((line) => line.trim())

    expect(headings).toEqual([
      '// kite',
      '// drive',
      '// load',
      '// pop',
      '// kicker',
      '// landing',
      '// scoring',
      '// render',
      '// generation',
    ])
  })

  it('keeps the trailing unit comments', () => {
    const dump = serializeTuning()
    expect(dump).toContain('BASE_SLEW: 90,')
    expect(dump).toMatch(/BASE_SLEW: 90, +\/\/ deg\/s at 12kt/)
    expect(dump).toMatch(/CLEAN_BAND: \[35, 75\], +\/\/ deg/)
  })

  it('aligns every trailing comment on one column', () => {
    const columns = new Set<number>()
    for (const line of serializeTuning().split('\n')) {
      const at = line.indexOf('//')
      // Section headings are comments too, but they sit at the indent.
      if (at > 0 && line.slice(0, at).includes(':')) columns.add(at)
    }
    expect(columns.size).toBe(1)
  })

  it('never drops a constant the schema has not caught up with', () => {
    const extended = clone()
    extended.BRAND_NEW_CONSTANT = 3

    const parsed = evaluate(serializeTuning(extended))
    expect(parsed.BRAND_NEW_CONSTANT).toBe(3)
  })
})

describe('formatNumber', () => {
  it('strips the float noise a slider leaves behind', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(1.15 * 3)).toBe('3.45')
  })

  it('prints integers without a decimal point', () => {
    expect(formatNumber(264)).toBe('264')
    expect(formatNumber(0)).toBe('0')
  })

  it('preserves values a slider can actually produce', () => {
    for (const value of [9.81, 0.04, 0.0002, 137.5, 1.6]) {
      expect(Number(formatNumber(value))).toBe(value)
    }
  })
})
