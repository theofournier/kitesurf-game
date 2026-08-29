import { describe, expect, it } from 'vitest'
import { TUNING } from '../../src/config/tuning.ts'
import { autoStep, numbersOf, resolveFields, resolveGroups } from '../../src/debug/schema.ts'
import { schemaKeys } from '../../src/debug/serialize.ts'

describe('TUNING_SCHEMA coverage', () => {
  it('has an entry for every key in TUNING', () => {
    // A constant with no schema entry gets no slider, which is the whole point
    // of building the panel first. Adding a TUNING key should fail here.
    expect(schemaKeys().slice().sort()).toEqual(Object.keys(TUNING).sort())
  })

  it('lists no key twice', () => {
    const keys = schemaKeys()
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('produces one slider per number, so bands get two', () => {
    const fields = resolveFields()

    for (const key of Object.keys(TUNING) as (keyof typeof TUNING)[]) {
      const arity = numbersOf(TUNING[key]).length
      expect(fields.filter((f) => f.key === key)).toHaveLength(arity)
    }

    expect(fields.filter((f) => f.key === 'CLEAN_BAND')).toHaveLength(2)
  })

  it('gives every slider a unique label', () => {
    const labels = resolveFields().map((f) => f.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('resolved slider bounds', () => {
  const fields = resolveFields()

  it('brackets the shipped value between min and max', () => {
    for (const field of fields) {
      const value = numbersOf(TUNING[field.key])[field.index]
      expect(field.min, field.label).toBeLessThanOrEqual(value)
      expect(field.max, field.label).toBeGreaterThanOrEqual(value)
    }
  })

  it('leaves room to move in both directions', () => {
    for (const field of fields) {
      expect(field.max, field.label).toBeGreaterThan(field.min)
      expect(field.step, field.label).toBeGreaterThan(0)
      expect(field.step, field.label).toBeLessThanOrEqual(field.max - field.min)
    }
  })

  it('defaults to a quarter-to-quadruple range', () => {
    const slew = fields.find((f) => f.key === 'BASE_SLEW')!
    expect(slew.min).toBeCloseTo(TUNING.BASE_SLEW * 0.25, 10)
    expect(slew.max).toBeCloseTo(TUNING.BASE_SLEW * 4, 10)
  })

  it('honours overrides where a quarter-to-quadruple range is meaningless', () => {
    const clean = fields.filter((f) => f.key === 'CLEAN_BAND')
    for (const field of clean) {
      expect(field.min).toBe(0)
      expect(field.max).toBe(90)
    }

    const follow = fields.find((f) => f.key === 'CAM_ALT_FOLLOW')!
    expect(follow.max).toBe(1)

    for (const key of ['BONUS_CHOP', 'BONUS_WAVE', 'BONUS_WAKE'] as const) {
      expect(fields.find((f) => f.key === key)!.min).toBe(1)
    }
  })

  it('marks array-valued constants so the panel binds by index', () => {
    for (const field of fields) {
      expect(field.isArray, field.label).toBe(Array.isArray(TUNING[field.key]))
    }
  })
})

describe('autoStep', () => {
  it('lands on 1, 2 or 5 times a power of ten', () => {
    for (const [min, max] of [
      [0, 1],
      [22.5, 360],
      [0.01, 0.16],
      [66, 1056],
    ]) {
      const step = autoStep(min, max)
      const mantissa = step / 10 ** Math.floor(Math.log10(step))
      expect(Math.round(mantissa), `${min}..${max}`).toBeOneOf([1, 2, 5])
    }
  })

  it('keeps at least a hundred notches across the range', () => {
    for (const [min, max] of [
      [0, 1],
      [22.5, 360],
      [0.01, 0.16],
    ]) {
      expect((max - min) / autoStep(min, max)).toBeGreaterThanOrEqual(100)
    }
  })

  it('falls back to 1 for a degenerate range', () => {
    expect(autoStep(5, 5)).toBe(1)
  })
})

describe('resolveGroups', () => {
  it('names every folder and fills it', () => {
    for (const group of resolveGroups()) {
      expect(group.title).not.toBe('')
      expect(group.fields.length).toBeGreaterThan(0)
    }
  })
})
