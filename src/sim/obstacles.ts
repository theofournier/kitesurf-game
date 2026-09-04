// The lethal furniture of spec §9.1: what is in the water, how tall it is, and
// what counts as hitting it.
//
// A leaf module — TUNING and nothing else. The geometry here is what fairness.ts
// measures a spawn against and what world.ts lays down, and neither of those can
// be checked without it being stated in one place first.
//
// Pure: preallocated structs, mutated in place. No clock, no randomness.
import { TUNING } from '../config/tuning.ts'

/**
 * The three objects of spec §9.1. Strings for the same reason PHASE and WAVE
 * are: they go straight into the debug readout and into test failure messages,
 * and reading one out of this object allocates nothing.
 */
export const OBSTACLE = {
  /** 0.5m. Low, easy to clear, punishes cruising. */
  BUOY: 'buoy',
  /** 2.4m of hull under a 4m mast, and the wake kicker that gets you over it. */
  BOAT: 'boat',
  /** 3m wall. Rare, tier 3+, forces a committed send. */
  PIER: 'pier',
} as const

export type ObstacleType = (typeof OBSTACLE)[keyof typeof OBSTACLE]

/**
 * One lethal object in the water (spec §9.1).
 *
 * The silhouette is a deck — `x`, `len`, `height` — plus, on a boat, a mast:
 * a zero-width lethal line standing on the hull at `mastX`. Zero width is
 * exact rather than sloppy, because the collision test sweeps the rider's path
 * across an interval rather than sampling it at points; a mast is hit when the
 * path crosses its x below its top, and grazing it is not a rounding question.
 */
export interface Obstacle {
  /** False for a pooled slot that is not in play. */
  active: boolean
  type: ObstacleType
  /** World x of the near edge — the side the rider arrives from, m. */
  x: number
  /** How much water the deck occupies, m. */
  len: number
  /** Height of the deck, m. */
  height: number
  /** World x of the mast. Equal to `x` on anything that has none. */
  mastX: number
  /** Height of the mast, m. 0 on anything that has none. */
  mastH: number
  /**
   * The world x the rider's pop has to be set up by (spec §9.2): the lip of the
   * wake for a boat, the object's own near edge for anything else.
   *
   * Stored rather than derived because it is what the fairness gate was
   * measured to when the spawn was committed, and a test that re-derives it
   * would be checking its own arithmetic instead of the generator's.
   */
  gateX: number
}

/** Height of the deck of a `type`, m (spec §9.1). */
export function deckHeight(type: ObstacleType): number {
  if (type === OBSTACLE.BOAT) return TUNING.BOAT_HULL_H
  if (type === OBSTACLE.PIER) return TUNING.PIER_H
  return TUNING.BUOY_H
}

/** Height of the tallest part of a `type`, m: the mast, on a boat. */
export function topHeight(type: ObstacleType): number {
  return type === OBSTACLE.BOAT ? TUNING.BOAT_MAST_H : deckHeight(type)
}

/** How much water a `type` occupies, m (spec §9.1). */
export function obstacleLength(type: ObstacleType): number {
  if (type === OBSTACLE.BOAT) return TUNING.BOAT_LEN
  if (type === OBSTACLE.PIER) return TUNING.PIER_LEN
  return TUNING.BUOY_LEN
}

export function createObstacle(): Obstacle {
  return {
    active: false,
    type: OBSTACLE.BUOY,
    x: 0,
    len: 0,
    height: 0,
    mastX: 0,
    mastH: 0,
    gateX: 0,
  }
}

/**
 * Puts a pooled slot into play as a buoy or a pier with its near edge at `x`.
 *
 * Not for boats: a boat without its wake is exactly the unavoidable death spec
 * §9.2 forbids, so the only way to make one is `initBoat`, off a lip.
 */
export function initObstacle(obstacle: Obstacle, x: number, type: ObstacleType): Obstacle {
  obstacle.active = true
  obstacle.type = type
  obstacle.x = x
  obstacle.len = obstacleLength(type)
  obstacle.height = deckHeight(type)
  obstacle.mastX = x
  obstacle.mastH = 0
  obstacle.gateX = x
  return obstacle
}

/** World x of a boat's stern, given the lip of the wake that launches it. */
export function boatSternX(lipX: number): number {
  return lipX + TUNING.BOAT_WAKE_LEAD
}

/**
 * Puts a pooled slot into play as the boat belonging to the wake at `lipX`
 * (spec §9.2).
 *
 * The two are one object as far as the generator is concerned: the wake is what
 * makes the boat clearable, so the boat is positioned from the lip and the
 * fairness gate is measured to the lip rather than to the hull. The greedy line
 * and the safe line are the same line.
 */
export function initBoat(obstacle: Obstacle, lipX: number): Obstacle {
  const stern = boatSternX(lipX)

  obstacle.active = true
  obstacle.type = OBSTACLE.BOAT
  obstacle.x = stern
  obstacle.len = TUNING.BOAT_LEN
  obstacle.height = TUNING.BOAT_HULL_H
  obstacle.mastX = stern + TUNING.BOAT_LEN * TUNING.BOAT_MAST_AT
  obstacle.mastH = TUNING.BOAT_MAST_H
  obstacle.gateX = lipX
  return obstacle
}

/** World x just past the far edge of an obstacle: where it stops being lethal. */
export function farEdge(obstacle: Obstacle): number {
  return obstacle.x + obstacle.len
}

/**
 * Height of the silhouette at a world x, m — 0 anywhere the obstacle is not.
 *
 * The one place the shape of an object is stated, so the collision test, the
 * clearance bonus of §8.3 and the renderer cannot disagree about what "over the
 * boat" means.
 */
export function topAt(obstacle: Obstacle, x: number): number {
  if (!obstacle.active) return 0
  if (obstacle.mastH > 0 && x === obstacle.mastX) return obstacle.mastH
  if (x < obstacle.x || x > farEdge(obstacle)) return 0
  return obstacle.height
}

/**
 * The lowest the rider's board gets while crossing `[bx0, bx1]`, m, on a path
 * that runs from `(fromX, fromAlt)` to `(toX, toAlt)`. Infinity when the path
 * does not reach that stretch of water at all.
 *
 * Swept rather than sampled: at MAX_SPEED a step covers 0.37m and a buoy is
 * 0.8m wide, so point-sampling the rider's position would already be within a
 * factor of two of tunnelling straight through one. Altitude is linear in x
 * across a single step — the same assumption the renderer interpolates under —
 * so the minimum over the crossing is at one of its two ends.
 */
function lowestOver(
  fromX: number,
  fromAlt: number,
  toX: number,
  toAlt: number,
  bx0: number,
  bx1: number,
): number {
  const lo = fromX > bx0 ? fromX : bx0
  const hi = toX < bx1 ? toX : bx1
  if (lo > hi) return Infinity

  const span = toX - fromX
  // Standing still: the whole step happens at one x, so both altitudes count.
  if (span <= 0) return fromAlt < toAlt ? fromAlt : toAlt

  const rate = (toAlt - fromAlt) / span
  const at0 = fromAlt + (lo - fromX) * rate
  const at1 = fromAlt + (hi - fromX) * rate
  return at0 < at1 ? at0 : at1
}

/** True if the path crosses `obstacle` below the top of it (spec §7.2, fatal). */
export function hits(
  obstacle: Obstacle,
  fromX: number,
  fromAlt: number,
  toX: number,
  toAlt: number,
): boolean {
  if (!obstacle.active) return false

  if (lowestOver(fromX, fromAlt, toX, toAlt, obstacle.x, farEdge(obstacle)) < obstacle.height) {
    return true
  }

  if (obstacle.mastH <= 0) return false
  return lowestOver(fromX, fromAlt, toX, toAlt, obstacle.mastX, obstacle.mastX) < obstacle.mastH
}

/**
 * The first obstacle the step just taken ran into, or null for a clean pass.
 *
 * A query, not a verdict: what contact costs is spec §7.2's business, and the
 * run structure that ends on it lands with the tiers.
 */
export function hitObstacle(
  obstacles: readonly Obstacle[],
  fromX: number,
  fromAlt: number,
  toX: number,
  toAlt: number,
): Obstacle | null {
  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i]
    if (hits(obstacle, fromX, fromAlt, toX, toAlt)) return obstacle
  }
  return null
}

/**
 * The smallest takeoff impulse that clears a boat from its own wake lip, m/s,
 * for a rider crossing the lip at `speed`.
 *
 * Ballistic on purpose. `floatAccel` is never negative, so the kite can only
 * ever hold the rider up for longer than this — the arc a player actually flies
 * is at worst the one solved for here, whatever they do with the kite after the
 * pop. Solving `v0*t - g*t²/2 >= h` at the three places the silhouette is
 * highest gives `v0 >= (h + g*t²/2) / t`, and the binding one is whichever
 * needs the most: the stern early in the climb, the mast at the top of it, the
 * bow on the way back down.
 *
 * The shape of this in `speed` is why BOAT_WAKE_LEAD is a real decision. Fast,
 * and the stern is only fractions of a second past the lip, so the demand is a
 * near-vertical climb; slow, and the bow is seconds away, so the demand is a
 * long hang. The lead distance is what balances the two.
 */
export function boatImpulseNeeded(speed: number): number {
  if (speed <= 0) return Infinity

  const lead = TUNING.BOAT_WAKE_LEAD
  const clear = TUNING.CLEAR_MARGIN
  const hull = TUNING.BOAT_HULL_H + clear
  const mast = TUNING.BOAT_MAST_H + clear

  let need = 0
  for (let i = 0; i < 3; i++) {
    const along = i === 0 ? 0 : i === 1 ? TUNING.BOAT_LEN * TUNING.BOAT_MAST_AT : TUNING.BOAT_LEN
    const height = i === 1 ? mast : hull
    const t = (lead + along) / speed
    const at = (height + (TUNING.GRAVITY * t * t) / 2) / t
    if (at > need) need = at
  }
  return need
}
