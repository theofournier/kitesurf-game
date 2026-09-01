// Slider metadata for every number in TUNING (spec §11.4).
//
// Pure: no DOM, no Tweakpane. The panel reads this to build its controls and
// the dump reads it for grouping and comments, which keeps both honest and
// lets the whole thing be unit-tested headless.
import { TUNING } from '../config/tuning.ts'
import { SPRAY_MAX } from '../render/effects.ts'

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
    title: 'wind',
    slots: [{ key: 'WIND_BASE', comment: 'kt, tier 1 — the wind every other value scales from' }],
  },
  {
    title: 'kite',
    slots: [
      { key: 'BASE_SLEW', comment: 'deg/s at 12kt' },
      { key: 'SLEW_WIND_SCALE' },
      { key: 'OVERSHOOT_DEG' },
      { key: 'OVERSHOOT_SETTLE', comment: 's' },
      // A sweep length is an arc of the window: 0..90, same as the landing bands.
      {
        key: 'OVERSHOOT_MIN_SWEEP',
        comment: 'deg of travel above which a sweep overshoots',
        fields: [{ min: 0, max: 90, step: 1 }],
      },
      // A share of a whole is a 0..1 blend.
      {
        key: 'TENSION_SPEED_MIX',
        comment: 'share of line tension that comes from speed, not window position',
        fields: [{ min: 0, max: 1 }],
      },
    ],
  },
  {
    title: 'drive',
    slots: [
      { key: 'DRIVE_K' },
      { key: 'DRIVE_SHAPE', comment: 'theta multiplier in driveFactor — sets where drive peaks' },
      { key: 'LIFT_EXP', comment: 'exponent in liftFactor' },
      { key: 'DRAG_K' },
      { key: 'MAX_SPEED', comment: 'm/s at 35kt' },
      // A share of the water balance, so the air can never outrun the water.
      {
        key: 'AIR_DRIVE_MIX',
        comment: 'share of the drive/drag balance that still applies airborne',
        fields: [{ min: 0, max: 1 }],
      },
    ],
  },
  {
    title: 'load',
    slots: [
      { key: 'LOAD_RATE', comment: 'per second at max speed' },
      {
        key: 'CARVE_DRAG_K',
        comment: 'extra drag per unit of load — at DRAG_K, a full edge doubles drag',
      },
      { key: 'STALL_GRACE', comment: 's' },
      // A share of the speed the rider had is a 0..1 fraction.
      {
        key: 'STALL_SPEED_LOSS',
        comment: 'share of speed the edge catch takes away',
        fields: [{ min: 0, max: 1 }],
      },
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
      // Ramp heights are the spec §4.1 table. A wave with no height is not a
      // wave, so they stop just above zero rather than at it.
      { key: 'RAMP_CHOP', comment: 'm of ramp height (spec §4.1)', fields: [{ min: 0.05 }] },
      { key: 'RAMP_WAVE', fields: [{ min: 0.05 }] },
      { key: 'RAMP_WAKE', fields: [{ min: 0.05 }] },
      {
        key: 'WAVE_FACE_K',
        comment: 'm of face per sqrt(m) of ramp height — the slope the face launches off',
        // A face shorter than a board is a wall, not a ramp: the slope this
        // gives is what the ramp velocity comes off, so it cannot go to zero.
        fields: [{ min: 1 }],
      },
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
      // A blend between two shapes of gate, so it is a 0..1 fraction.
      {
        key: 'LAND_FORGIVE',
        comment: '0 = flat descent cap, 1 = same demand at every apex',
        fields: [{ min: 0, max: 1 }],
      },
      // The two qualities are what the spec §3.7 table pays out: 0..1, and
      // clean is the top of the scale by definition.
      {
        key: 'CLEAN_QUALITY',
        comment: 'landingQuality of a clean touchdown (spec §3.7)',
        fields: [{ min: 0, max: 1 }],
      },
      { key: 'SKETCHY_QUALITY', fields: [{ min: 0, max: 1 }] },
      {
        key: 'SKETCHY_SPEED_LOSS',
        comment: 'share of speed a sketchy landing takes away',
        fields: [{ min: 0, max: 1 }],
      },
      { key: 'LAND_RECOVER', comment: 's, the landing beat before riding resumes' },
      { key: 'WIPEOUT_RECOVER', comment: 's, relaunch beat with the kite down (spec §7.2)' },
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
      { key: 'CAM_DAMP', comment: '1/s, how fast the camera catches its altitude target' },
      // The three screen-fraction values are 0..1 by construction: a fraction
      // of the viewport, not a length that can be scaled.
      {
        key: 'ANCHOR_X',
        comment: 'rider screen position, fraction of width',
        fields: [{ min: 0, max: 1 }],
      },
      { key: 'HORIZON_Y', comment: 'fraction of height', fields: [{ min: 0, max: 1 }] },
      {
        key: 'WATERLINE_Y',
        comment: 'fraction of height, rider at altitude 0',
        fields: [{ min: 0, max: 1 }],
      },
      { key: 'KITE_W', comment: 'px, span of the kite quad', fields: [{ step: 1 }] },
      { key: 'LINE_SAG', comment: 'px, control-point drop at zero tension', fields: [{ step: 1 }] },
      // Tremble starts at nothing: tier 1 lines are meant to be still.
      {
        key: 'LINE_TREMBLE',
        comment: 'px of tremble per unit of wind above tier 1',
        fields: [{ min: 0 }],
      },
      { key: 'LINE_TREMBLE_HZ', comment: 'tremble frequency' },
      { key: 'WATER_BAND_M', comment: 'm between water texture streaks' },
      // Parallax factors are multiples of rider speed; 1 is the rider's own plane.
      {
        key: 'PARALLAX_FAR',
        comment: 'scroll rate of the far water band, x rider speed',
        fields: [{ min: 0, max: 2 }],
      },
      { key: 'PARALLAX_MID', fields: [{ min: 0, max: 2 }] },
      { key: 'PARALLAX_NEAR', fields: [{ min: 0, max: 2 }] },
    ],
  },
  {
    title: 'feedback',
    slots: [
      // Shake and spray are how the landing table reads without the HUD, so
      // they start at nothing: a zero here is a legitimate "turn it off".
      {
        key: 'SHAKE_CLEAN',
        comment: 'px of screen shake on a clean landing',
        fields: [{ min: 0, max: 40 }],
      },
      { key: 'SHAKE_SKETCHY', fields: [{ min: 0, max: 40 }] },
      { key: 'SHAKE_WIPEOUT', fields: [{ min: 0, max: 40 }] },
      { key: 'SHAKE_DECAY', comment: '1/s, how fast the shake dies away' },
      {
        key: 'SPRAY_CLEAN',
        comment: 'spray particles thrown by a clean landing',
        fields: [{ min: 0, max: SPRAY_MAX, step: 1 }],
      },
      { key: 'SPRAY_SKETCHY', fields: [{ min: 0, max: SPRAY_MAX, step: 1 }] },
      { key: 'SPRAY_WIPEOUT', fields: [{ min: 0, max: SPRAY_MAX, step: 1 }] },
      { key: 'FLASH_TIME', comment: 's the landing verdict holds on screen' },
      {
        key: 'SHADOW_FADE_M',
        comment: 'm of altitude over which the water shadow fades out',
        fields: [{ min: 1 }],
      },
    ],
  },
  {
    title: 'generation',
    slots: [
      { key: 'REACTION_MIN', comment: 's' },
      { key: 'WAVE_GAP_MIN', comment: 'm between one lip and the next' },
      { key: 'WAVE_GAP_MAX' },
      // The two shares are a split of the same 1.0: whatever they leave is the
      // share of boat wakes.
      {
        key: 'WAVE_MIX_CHOP',
        comment: 'share of waves that are chop',
        fields: [{ min: 0, max: 1 }],
      },
      {
        key: 'WAVE_MIX_WAVE',
        comment: 'share that are waves — boat wakes take the rest',
        fields: [{ min: 0, max: 1 }],
      },
      // The build plan's floor: a wave is on screen at least 1.5s before its
      // lip, at any speed. The slider cannot be dragged under the guarantee.
      {
        key: 'WAVE_LEAD',
        comment: 's of warning a wave gets before its lip',
        fields: [{ min: 1.5 }],
      },
    ],
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
