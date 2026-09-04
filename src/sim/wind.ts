// The wind curve and the tiers cut out of it (spec §7.1).
//
// Wind scales with *distance, not time*, because a wind that scaled with time
// would make slowing down and farming the optimal play. It rises continuously —
// there is no step at a boundary — and the tiers exist only for feedback and
// for the score multiplier:
//
//     tier 1   0–500m     12kt   1.0x
//     tier 2   500–1500m  18kt   1.5x
//     tier 3   1500–3000m 25kt   2.5x
//     tier 4   3000m+     35kt+  4.0x
//
// The headline wind of each tier is the wind at the moment it begins, and the
// curve runs straight between one and the next: tier 1 is a ride from 12kt to
// 18kt, and it is the boundary — not the whole tier — that is worth 18.
//
// A leaf module: TUNING and nothing else. world.ts lays the sea out with it and
// scoring.ts prices a jump with it, and neither of those can import the other.
//
// Pure: closed forms over a fixed table. No clock, no randomness, no state.
import { TUNING } from '../config/tuning.ts'

/**
 * Sentinel for "no override": take the wind from the curve. Zero is safe as a
 * sentinel because a run at 0kt is not a run — the kite does not fly.
 */
export const WIND_AUTO = 0

/**
 * The lowest and highest tier the table describes. Fixed at module load rather
 * than read per call: the debug sliders can move every number in the tier table
 * but not how many of them there are.
 */
export const TIER_MIN = 1
export const TIER_MAX = TUNING.TIER_DIST.length + 1

/** Holds a tier inside the table, so a caller may ask about any distance. */
function clampTier(tier: number): number {
  if (tier < TIER_MIN) return TIER_MIN
  return tier > TIER_MAX ? TIER_MAX : tier
}

/**
 * Which tier a distance falls in, 1..4 (spec §7.1).
 *
 * A boundary belongs to the tier it opens: 500m is the first metre of tier 2,
 * which is what makes the tier table's ranges read as written.
 */
export function tierAt(distance: number): number {
  const bounds = TUNING.TIER_DIST
  let tier = TIER_MIN

  for (let i = 0; i < bounds.length; i++) {
    if (distance >= bounds[i]) tier = i + 2
  }

  return tier
}

/** Where a tier begins, metres. Zero for tier 1, which begins at the start. */
export function tierStart(tier: number): number {
  const at = clampTier(tier)
  return at <= TIER_MIN ? 0 : TUNING.TIER_DIST[at - 2]
}

/** The headline wind of a tier, kt: the wind at the moment it begins. */
export function tierWind(tier: number): number {
  const at = clampTier(tier)
  return at <= TIER_MIN ? TUNING.WIND_BASE : TUNING.TIER_WIND[at - 2]
}

/**
 * What a jump taken in a tier is multiplied by (spec §7.1, §8.1).
 *
 * The multiplier is the tier's and not the wind's: it steps at the boundary
 * while everything else about the wind slides, so crossing one is an event the
 * score can be felt through rather than a number that quietly drifts.
 */
export function tierMult(tier: number): number {
  return TUNING.TIER_MULT[clampTier(tier) - 1]
}

/**
 * Wind at a distance into the run, kt (spec §7.1).
 *
 * Piecewise linear between the tier boundaries, so the wind at every boundary
 * is exactly that tier's headline number and every metre between two of them
 * interpolates. Past the last boundary the table says "35kt+" and this keeps
 * climbing, but toward WIND_TOP rather than without limit — WIND_TOP_M is the
 * distance past the boundary that closes half of what is left, so the open tier
 * gets harder for as long as a run lasts without eventually asking the physics
 * for a wind it was never tuned at.
 *
 * `override` forces a wind regardless of distance. It exists because WIND_BASE
 * cannot be turned into a wind by itself: it is the reference every other wind
 * is measured against, so `windPower` divides by it and `slewRate` subtracts
 * it, and a run held at exactly WIND_BASE is algebraically identical at 12kt
 * and at 35kt. Feeling one tier without riding to it therefore needs a second
 * number, not a bigger WIND_BASE. It lives on SimState rather than in a module
 * variable so the sim stays a pure function of its state and a replay still
 * reproduces the run it recorded.
 */
export function windAt(distance: number, override: number = WIND_AUTO): number {
  if (override > WIND_AUTO) return override

  const bounds = TUNING.TIER_DIST
  if (!(distance > 0)) return TUNING.WIND_BASE

  const last = bounds.length - 1
  if (distance >= bounds[last]) {
    const top = tierWind(TIER_MAX)
    const past = distance - bounds[last]
    return top + (TUNING.WIND_TOP - top) * (past / (past + TUNING.WIND_TOP_M))
  }

  let fromX = 0
  let fromWind = TUNING.WIND_BASE

  for (let i = 0; i <= last; i++) {
    if (distance < bounds[i]) {
      const span = bounds[i] - fromX
      const t = span > 0 ? (distance - fromX) / span : 1
      return fromWind + (TUNING.TIER_WIND[i] - fromWind) * t
    }
    fromX = bounds[i]
    fromWind = TUNING.TIER_WIND[i]
  }

  return fromWind
}

/**
 * How far up the whole curve a wind sits, 0..1: 0 at WIND_BASE and 1 at the
 * ceiling the open tier climbs toward.
 *
 * The one continuous readout of "how bad is it out here", for feedback that has
 * to slide rather than step — the water darkening under a rider who is still
 * two hundred metres from the next boundary.
 */
export function windFraction(wind: number): number {
  const span = TUNING.WIND_TOP - TUNING.WIND_BASE
  if (!(span > 0)) return 0

  const t = (wind - TUNING.WIND_BASE) / span
  if (t < 0) return 0
  return t > 1 ? 1 : t
}
