// Slider metadata for every number in TUNING (spec §11.4).
//
// Pure: no DOM, no Tweakpane. The panel reads this to build its controls and
// the dump reads it for grouping and comments, which keeps both honest and
// lets the whole thing be unit-tested headless.
import { TUNING } from '../config/tuning.ts'

export type TuningKey = keyof typeof TUNING

/**
 * Default slider bounds, as a multiple of the constant's shipped value. Wide
 * enough to find the shape of a curve, narrow enough that the slider still has
 * useful resolution. These are debug-tool constants, not gameplay values, so
 * they live here rather than in TUNING — same reasoning as MAX_FRAME_TIME.
 */
const AUTO_MIN_FACTOR = 0.25
const AUTO_MAX_FACTOR = 4

/** Slider granularity: roughly this many notches across the full range. */
const STEP_DIVISIONS = 500

/** Per-number overrides. Anything omitted falls back to the factors above. */
export interface FieldSpec {
  label?: string
  min?: number
  max?: number
  step?: number
}

export interface TuningSlot {
  key: TuningKey
  /** Trailing comment, reproduced verbatim by the copy-values dump. */
  comment?: string
  /** One entry per number in the value: length 1 for scalars, 2 for bands. */
  fields?: FieldSpec[]
}

export interface TuningGroup {
  title: string
  slots: TuningSlot[]
}

/**
 * Mirrors the order and the section comments of tuning.ts, so the copy-values
 * dump can be pasted straight back over the object it came from.
 */
export const TUNING_SCHEMA: TuningGroup[] = [
  {
    title: 'kite',
    slots: [
      { key: 'BASE_SLEW', comment: 'deg/s at 12kt' },
      { key: 'SLEW_WIND_SCALE' },
      { key: 'OVERSHOOT_DEG' },
      { key: 'OVERSHOOT_SETTLE', comment: 's' },
    ],
  },
  {
    title: 'drive',
    slots: [
      { key: 'DRIVE_K' },
      { key: 'DRAG_K' },
      { key: 'MAX_SPEED', comment: 'm/s at 35kt' },
    ],
  },
  {
    title: 'load',
    slots: [
      { key: 'LOAD_RATE', comment: 'per second at max speed' },
      { key: 'STALL_GRACE', comment: 's' },
    ],
  },
  {
    title: 'pop',
    slots: [
      { key: 'POP_K' },
      { key: 'FLAT_POP_CAP', comment: 'm' },
      { key: 'GRAVITY' },
      { key: 'FLOAT_K', comment: '~15% hangtime swing' },
    ],
  },
  {
    title: 'kicker',
    slots: [
      { key: 'KICKER_WINDOW', comment: 's' },
      // A kicker never penalises, so 1x is the floor for all three bonuses.
      { key: 'BONUS_CHOP', fields: [{ min: 1 }] },
      { key: 'BONUS_WAVE', fields: [{ min: 1 }] },
      { key: 'BONUS_WAKE', fields: [{ min: 1 }] },
    ],
  },
  {
    title: 'landing',
    slots: [
      {
        key: 'CLEAN_BAND',
        comment: 'deg',
        // Landing angles: a quarter-to-quadruple range is meaningless, the
        // physical range of the value is 0..90.
        fields: [
          { label: 'CLEAN_BAND lo', min: 0, max: 90, step: 1 },
          { label: 'CLEAN_BAND hi', min: 0, max: 90, step: 1 },
        ],
      },
      {
        key: 'SKETCHY_BAND',
        fields: [
          { label: 'SKETCHY_BAND lo', min: 0, max: 90, step: 1 },
          { label: 'SKETCHY_BAND hi', min: 0, max: 90, step: 1 },
        ],
      },
      { key: 'SOFT_LAND', comment: 'm/s descent' },
      { key: 'HARD_LAND' },
    ],
  },
  {
    title: 'scoring',
    slots: [
      { key: 'HEIGHT_EXP' },
      { key: 'HEIGHT_K' },
      { key: 'DIST_PER_M' },
      // A combo multiplier cap below 1x would score negative progress.
      { key: 'COMBO_CAP', fields: [{ min: 1, max: 40, step: 1 }] },
      { key: 'COMBO_DECAY_M' },
      { key: 'CLEARANCE_M' },
    ],
  },
  {
    title: 'render',
    slots: [
      { key: 'WORLD_SCALE', comment: 'px per metre', fields: [{ step: 1 }] },
      { key: 'LINE_RADIUS', comment: 'px, compressed', fields: [{ step: 1 }] },
      { key: 'RIDER_H', comment: 'px', fields: [{ step: 1 }] },
      // A camera follow factor is a 0..1 blend; above 1 it overshoots.
      { key: 'CAM_ALT_FOLLOW', fields: [{ min: 0, max: 1 }] },
    ],
  },
  {
    title: 'generation',
    slots: [{ key: 'REACTION_MIN', comment: 's' }],
  },
]

/** One slider: a single number, addressed by key plus index into the value. */
export interface ResolvedField {
  key: TuningKey
  /** Index within the value. Always 0 for a scalar. */
  index: number
  isArray: boolean
  label: string
  min: number
  max: number
  step: number
}

export interface ResolvedGroup {
  title: string
  fields: ResolvedField[]
}

/** Flattens a TUNING value to the numbers it holds. */
export function numbersOf(value: number | number[]): number[] {
  return Array.isArray(value) ? value.slice() : [value]
}

/**
 * The shipped values, snapshotted at module load. Slider bounds are derived
 * from these rather than from live TUNING, so dragging a slider never moves
 * the range out from under itself.
 */
const DEFAULTS: ReadonlyMap<TuningKey, readonly number[]> = new Map(
  (Object.keys(TUNING) as TuningKey[]).map((key) => [key, numbersOf(TUNING[key])]),
)

const NO_OVERRIDES: FieldSpec = {}

/**
 * Rounds a raw step up to the nearest 1, 2 or 5 times a power of ten, so the
 * slider lands on numbers a human would type.
 */
export function autoStep(min: number, max: number): number {
  const range = max - min
  if (!(range > 0)) return 1

  const raw = range / STEP_DIVISIONS
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalised = raw / magnitude
  const nice = normalised < 1.5 ? 1 : normalised < 3.5 ? 2 : normalised < 7.5 ? 5 : 10
  return nice * magnitude
}

function resolveField(
  slot: TuningSlot,
  index: number,
  defaultValue: number,
  isArray: boolean,
): ResolvedField {
  const spec = slot.fields?.[index] ?? NO_OVERRIDES
  const a = spec.min ?? defaultValue * AUTO_MIN_FACTOR
  const b = spec.max ?? defaultValue * AUTO_MAX_FACTOR
  const min = Math.min(a, b)
  const max = Math.max(a, b)

  return {
    key: slot.key,
    index,
    isArray,
    label: spec.label ?? (isArray ? `${slot.key}[${index}]` : slot.key),
    min,
    max,
    step: spec.step ?? autoStep(min, max),
  }
}

/** Builds the slider list, grouped exactly as the panel folders present it. */
export function resolveGroups(): ResolvedGroup[] {
  const groups: ResolvedGroup[] = []

  for (const group of TUNING_SCHEMA) {
    const fields: ResolvedField[] = []

    for (const slot of group.slots) {
      const defaults = DEFAULTS.get(slot.key) ?? []
      const isArray = Array.isArray(TUNING[slot.key])
      for (let i = 0; i < defaults.length; i++) {
        fields.push(resolveField(slot, i, defaults[i], isArray))
      }
    }

    groups.push({ title: group.title, fields })
  }

  return groups
}

/** Every slider, ungrouped. */
export function resolveFields(): ResolvedField[] {
  return resolveGroups().flatMap((group) => group.fields)
}
