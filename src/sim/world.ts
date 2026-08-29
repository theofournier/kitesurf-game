// The world the rider travels through: wind, waves, obstacles (spec §7.1, §9).
// Waves and spawning land in later sessions; this is the wind curve everything
// else scales from.
//
// Pure: no clock, no DOM. Randomness will arrive as an injected Rng.
import { TUNING } from '../config/tuning.ts'

/**
 * Wind at a distance into the run, kt (spec §7.1).
 *
 * Wind rises with distance, never with time, so slowing down to farm is never
 * the optimal play. The tier curve is a later session; until then every run is
 * tier 1, which is the wind the whole tuning pass is done at.
 */
export function windAt(_distance: number): number {
  return TUNING.WIND_BASE
}
