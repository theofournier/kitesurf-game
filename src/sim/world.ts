// The world the rider travels through: wind, waves, obstacles (spec §7.1, §9).
// Waves and spawning land in later sessions; this is the wind curve everything
// else scales from.
//
// Pure: no clock, no DOM. Randomness will arrive as an injected Rng.
import { TUNING } from '../config/tuning.ts'

/**
 * Sentinel for "no override": take the wind from the curve. Zero is safe as a
 * sentinel because a run at 0kt is not a run — the kite does not fly.
 */
export const WIND_AUTO = 0

/**
 * Wind at a distance into the run, kt (spec §7.1).
 *
 * Wind rises with distance, never with time, so slowing down to farm is never
 * the optimal play. The tier curve is a later session; until then every run is
 * tier 1, which is the wind the whole tuning pass is done at.
 *
 * `override` forces a wind regardless of distance. It exists because
 * WIND_BASE cannot be turned into a wind by itself: it is the reference every
 * other wind is measured against, so `windPower` divides by it and `slewRate`
 * subtracts it, and a run held at exactly WIND_BASE is algebraically identical
 * at 12kt and at 35kt. Feeling tier 2–4 before the curve exists therefore needs
 * a second number, not a bigger WIND_BASE. It lives on SimState rather than in
 * a module variable so the sim stays a pure function of its state and a replay
 * still reproduces the run it recorded.
 */
export function windAt(_distance: number, override: number = WIND_AUTO): number {
  if (override > WIND_AUTO) return override
  return TUNING.WIND_BASE
}
