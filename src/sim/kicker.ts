// The three kickers, and what the water under the board is worth to a pop
// taken right now (spec §4.1, §4.2).
//
// Its own module because this is the boundary between the rider and the world:
// the rider spends a kicker without knowing what a wave is, and the world fills
// one in without knowing what a pop is. Keeping the struct here is also what
// lets /src/sim stay an acyclic graph — rider.ts needs it, world.ts needs the
// spawn fairness of §9.2, and that fairness is written in the rider's own
// formulas. world.ts re-exports everything below, so nothing outside has to
// know the type moved.
//
// Pure: a preallocated struct and the two functions that reset it.

/**
 * The three kickers (spec §4.1). Strings for the same reason PHASE is: they go
 * straight into the debug readout, and reading one out of this object
 * allocates nothing.
 */
export const WAVE = {
  /** 0.3m. Frequent, low reward, good for combo upkeep. */
  CHOP: 'chop',
  /** 1.0m. The bread-and-butter kicker. */
  WAVE: 'wave',
  /** 1.8m. The highest air in the game — and it sits beside a lethal boat. */
  WAKE: 'wake',
} as const

export type WaveType = (typeof WAVE)[keyof typeof WAVE]

/**
 * What the water under the rider is worth to a pop taken right now.
 *
 * Preallocated and filled in place: `stepRider` reads one of these on the
 * release edge, and the loop owns the single instance.
 */
export interface Kicker {
  /** Multiplier on the pop impulse, 1 on flat water (spec §4.2). */
  bonus: number
  /** Upward velocity the face adds on takeoff, m/s. Not scaled by `bonus`. */
  ramp: number
  /** Seconds from the lip: negative approaching it, positive past it. */
  delta: number
  /** Which wave that came off, or null on flat water. */
  type: WaveType | null
}

export function createKicker(): Kicker {
  return { bonus: 1, ramp: 0, delta: 0, type: null }
}

/** Flat water: what every pop taken away from a wave is worth. */
export const NO_KICKER: Kicker = Object.freeze(createKicker())

/** Resets a kicker to flat water, in place. */
export function clearKicker(out: Kicker): Kicker {
  out.bonus = 1
  out.ramp = 0
  out.delta = 0
  out.type = null
  return out
}
