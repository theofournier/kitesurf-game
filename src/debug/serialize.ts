// Dumps live TUNING values back out as the TypeScript that produced them, so a
// tuning session ends in a paste rather than in transcribing numbers by hand.
//
// Pure: no DOM. The panel handles the clipboard, this only builds the string.
import { TUNING } from '../config/tuning.ts'
import { TUNING_SCHEMA, type TuningKey } from './schema.ts'

const HEADER = 'export const TUNING = {'
const FOOTER = '}'
const INDENT = '  '
/** Spaces between the longest entry and the trailing-comment column. */
const COMMENT_GAP = 2
/**
 * Significant digits kept when printing. Enough to survive any slider value,
 * few enough to strip the 0.30000000000000004 that float arithmetic leaves
 * behind.
 */
const PRECISION = 12
/** Group heading for constants the schema does not yet know about. */
const ORPHAN_GROUP = 'not in the debug schema'

export type TuningValues = Record<string, number | number[]>

/** Prints a number as a human would type it, without float noise. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  return String(Number(value.toPrecision(PRECISION)))
}

function formatValue(value: number | number[]): string {
  if (Array.isArray(value)) {
    let out = '['
    for (let i = 0; i < value.length; i++) {
      out += (i > 0 ? ', ' : '') + formatNumber(value[i])
    }
    return out + ']'
  }
  return formatNumber(value)
}

interface Entry {
  /** Group heading, or null to continue the previous group. */
  heading: string | null
  body: string
  comment?: string
}

/**
 * Serialises `values` as a pasteable `export const TUNING` literal, preserving
 * the section headings and trailing comments of tuning.ts.
 *
 * Any key the schema does not cover is still emitted, under its own heading —
 * a dump that silently dropped a constant would lose tuning work. The schema
 * coverage test is what stops that heading from ever appearing.
 */
export function serializeTuning(values: TuningValues = TUNING as TuningValues): string {
  const entries: Entry[] = []
  const seen = new Set<string>()

  for (const group of TUNING_SCHEMA) {
    let heading: string | null = group.title

    for (const slot of group.slots) {
      const key = slot.key as string
      if (!(key in values)) continue

      seen.add(key)
      entries.push({
        heading,
        body: `${INDENT}${key}: ${formatValue(values[key])},`,
        comment: slot.comment,
      })
      heading = null
    }
  }

  let orphanHeading: string | null = ORPHAN_GROUP
  for (const key of Object.keys(values)) {
    if (seen.has(key)) continue

    entries.push({
      heading: orphanHeading,
      body: `${INDENT}${key}: ${formatValue(values[key])},`,
    })
    orphanHeading = null
  }

  let column = 0
  for (const entry of entries) {
    if (entry.body.length > column) column = entry.body.length
  }
  column += COMMENT_GAP

  const lines: string[] = [HEADER]
  let first = true

  for (const entry of entries) {
    if (entry.heading !== null) {
      if (!first) lines.push('')
      lines.push(`${INDENT}// ${entry.heading}`)
    }
    lines.push(entry.comment ? `${entry.body.padEnd(column)}// ${entry.comment}` : entry.body)
    first = false
  }

  lines.push(FOOTER)
  return lines.join('\n') + '\n'
}

/** The keys the schema claims to cover. Used by the coverage test. */
export function schemaKeys(): TuningKey[] {
  const keys: TuningKey[] = []
  for (const group of TUNING_SCHEMA) {
    for (const slot of group.slots) keys.push(slot.key)
  }
  return keys
}
