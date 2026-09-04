// The fairness guarantee of spec §9.2, and the only reason obstacles are
// allowed to exist:
//
//     timeToImpact >= REACTION_MIN + popSetupTime(currentSpeed)
//
// An unavoidable death in an endless runner destroys trust in the game
// instantly, so every spawn is checked against this before it is committed and
// pushed further out until it passes.
//
// The spec states the inequality against the speed the rider happens to have.
// That is not enough on its own: a spawn commits a full spawn horizon ahead of
// the rider, and in the seconds it takes to get there the player can add
// fifteen metres a second to the speed the gap was measured against. So what is
// enforced here is the stronger claim —
//
//     every spawn is fair at *every* speed the rider could meet it at,
//     not only at the one they had when it spawned
//
// — which implies the spec's version for any `currentSpeed`, and needs no
// knowledge of the rider at all. `minSafeGap` is that guarantee as a distance.
//
// Every simplification below leans the same way — toward granting more room
// than the line actually needs — because the cost of the two errors is not
// symmetric. A gate that is too generous spaces an obstacle further out than it
// had to; a gate that is too clever kills a player who did everything right.
//
//   the ramp velocity of a face (§4.2) is never counted, because it only ever
//   adds to a pop, so a spawn that is fair without it is fair with it;
//
//   the air is treated as ballistic, because `floatAccel` is never negative, so
//   the kite can only hold the rider up for longer than these arcs assume;
//
//   the edge is built before the kite is sent rather than during, because
//   overlapping them costs board speed and the load is charged for that;
//
//   the edge is priced at the slowest speed it could be built at, and the send
//   at the speed it leaves the rider with, rather than at the speed they
//   started with. `carveDrag` is a real bill and the model has to pay it.
//
// Pure: closed forms and one bounded scan over the window arc. No clock, no
// randomness, no state.
import { TUNING } from '../config/tuning.ts'
import { drivePeakAngle, liftFactor, slewRate, windPower, WINDOW_MAX, WINDOW_MIN } from './kite.ts'
import { boatImpulseNeeded, OBSTACLE, topHeight, type ObstacleType } from './obstacles.ts'
import { driveBalance, impulseForHeight, loadRate, popImpulse, uncapFlatImpulse } from './rider.ts'

/**
 * Degrees between samples when scanning the window for the cheapest release
 * angle. A precision value rather than a gameplay one, so it lives here rather
 * than in TUNING — same reasoning as PEAK_SCAN_STEP in kite.ts.
 *
 * A scan rather than a solve because LIFT_EXP and DRIVE_SHAPE are live sliders
 * and the shape of the cost curve moves with them. Coarsening it is safe in the
 * one direction that matters: a wider step can only miss the true best line and
 * report a slightly dearer one, which spaces a spawn further out than it had
 * to rather than closer than it may.
 */
const LINE_SCAN_STEP = 0.5

/**
 * Float dust on a full edge. At the very bottom of a boat's speed band the line
 * that clears it is the strongest one in the game, so the load it asks for is
 * 1 give or take an ulp, and a load of 1.0000000001 is a full load rather than
 * an impossible one — same reasoning as OVERLOAD_EPS in rider.ts.
 */
const FULL_LOAD_EPS = 1e-9

/**
 * Float dust on the gap itself, m. `minSafeGap` is derived through square roots
 * and an arctanh and is exactly tight at MAX_SPEED, so a spawn pushed to
 * precisely the gap it needs has to land a hair the safe side of it: a
 * nanometre is nothing to a spawn and six orders of magnitude more than the
 * last bit of a distance this size.
 */
const GAP_EPS = 1e-9

/**
 * The pop the rider has to make to get over `type`, m/s, taken from `speed`.
 *
 * A buoy and a pier are a height: clear the top of them by CLEAR_MARGIN. A boat
 * is a shape flown over from a fixed distance behind, so what it asks for
 * depends on how fast the lip is crossed — see `boatImpulseNeeded`.
 */
export function requiredImpulse(type: ObstacleType, speed: number): number {
  if (type === OBSTACLE.BOAT) return boatImpulseNeeded(speed)
  return impulseForHeight(topHeight(type) + TUNING.CLEAR_MARGIN)
}

/** What the water at the launch multiplies the pop by: the wake, for a boat. */
export function launchBonus(type: ObstacleType): number {
  return type === OBSTACLE.BOAT ? TUNING.BONUS_WAKE : 1
}

/**
 * The load a release at `theta` needs to make `impulse`, or more than 1 when
 * this angle cannot make it at all (spec §3.5, inverted).
 */
export function loadFor(impulse: number, theta: number, wind: number, bonus: number): number {
  const lift = liftFactor(theta)
  if (lift <= 0) return Infinity

  const flat = uncapFlatImpulse(impulse / bonus)
  if (!Number.isFinite(flat)) return Infinity

  return flat / (lift * TUNING.POP_K * windPower(wind))
}

/**
 * A floor on the board speed an edge is built at, m/s.
 *
 * `loadRate` scales with speed and carving costs speed, so a rider holding an
 * edge is loading more slowly the longer they hold it — that is the whole point
 * of CARVE_DRAG_K, and a load time worked out at the speed the rider *started*
 * at would be a promise the sim does not keep.
 *
 * With the kite still down at the drive peak, a full edge doubles the drag term
 * and so settles at the balance divided by root two. Above that the rider is
 * slowing toward it and below it they are speeding up, so it is a floor on the
 * whole build either way, and it is reached only at the very end of a build
 * that started fast — which makes it a comfortable one.
 */
function loadSpeed(speed: number, wind: number): number {
  const carved = Math.sqrt(1 + TUNING.CARVE_DRAG_K / TUNING.DRAG_K)
  const settled = driveBalance(drivePeakAngle(), wind) / carved
  return speed < settled ? speed : settled
}

/** Seconds of edging to reach `load` from `speed` (spec §3.4). */
function loadTime(load: number, speed: number, wind: number): number {
  const rate = loadRate(loadSpeed(speed, wind))
  return rate > 0 ? load / rate : Infinity
}

/**
 * What is left of `speed` after `time` of holding a full edge with the kite out
 * of the drive, m/s: `v / (1 + k·v·t)`, the solution of `dv/dt = -k·v²` with
 * both the plain drag and a full carve on it.
 *
 * The send is the expensive part of a line. The kite makes no drive at zenith
 * and the edge is still in the water, so the last stretch before a release is
 * ridden on the speed the rider brought to it. What that costs only matters to
 * a boat, whose wake has to be crossed fast enough for the arc to span the
 * hull — but there it matters a great deal.
 */
function afterSend(speed: number, time: number): number {
  const k = TUNING.DRAG_K + TUNING.CARVE_DRAG_K
  return speed / (1 + k * speed * time)
}

/** The speed to arrive at a send with, to still be doing `speed` at the end of it. */
function beforeSend(speed: number, time: number): number {
  const k = TUNING.DRAG_K + TUNING.CARVE_DRAG_K
  const decay = k * speed * time
  return decay < 1 ? speed / (1 - decay) : Infinity
}

/** Seconds for the kite to travel from where a rider carrying speed holds it. */
function slewTime(theta: number, wind: number): number {
  const from = drivePeakAngle()
  const travel = theta > from ? theta - from : from - theta
  return travel / slewRate(wind)
}

/**
 * Seconds from a cold start to a release that makes `impulse`, if the line is
 * flown as well as it can be.
 *
 * Cold means the honest worst case: no load stored, and the kite down at the
 * drive peak, which is where a rider carrying speed is holding it — and a rider
 * carrying speed is exactly the one with the least time.
 *
 * The edge is built first and the kite sent afterwards, and the two are added
 * rather than overlapped. Overlapping them is quicker on a clock and slower in
 * the water: a kite climbing toward zenith is a kite out of the drive, and an
 * edge held behind one is being built on a board that is losing speed, which
 * `loadRate` charges for. Loading with the kite still down and sending it once
 * the edge is there is both the natural line and the one whose cost can be
 * stated honestly.
 *
 * The two ends of it pull opposite ways across the window — a release near
 * zenith gets the most lift out of the least load but takes the longest to
 * steer to, one out near the drive peak is a flick away but needs an edge the
 * rider may not have time to build — so the cheapest line is somewhere in
 * between and is found by scanning for it.
 */
export function setupTime(impulse: number, wind: number, speed: number, bonus: number): number {
  const theta = cheapestRelease(impulse, wind, speed, bonus)
  if (theta < 0) return Infinity

  return loadTime(loadAt(impulse, theta, wind, bonus), speed, wind) + slewTime(theta, wind)
}

/** The load a release at `theta` spends, held to the full edge it cannot pass. */
function loadAt(impulse: number, theta: number, wind: number, bonus: number): number {
  const load = loadFor(impulse, theta, wind, bonus)
  return load > 1 ? 1 : load
}

/**
 * The release angle the cheapest line uses, degrees, or -1 when no release in
 * the window makes `impulse` at all.
 *
 * Separate from the cost so that a test can fly the very line the gate was
 * priced on. A fairness model checked only against itself is worth nothing; the
 * one thing that can falsify it is the sim, and the sim needs to be told where
 * to put the kite.
 */
export function cheapestRelease(
  impulse: number,
  wind: number,
  speed: number,
  bonus: number,
): number {
  let best = Infinity
  let at = -1

  for (let theta = WINDOW_MIN; theta <= WINDOW_MAX; theta += LINE_SCAN_STEP) {
    const load = loadFor(impulse, theta, wind, bonus)
    if (load > 1 + FULL_LOAD_EPS) continue

    const cost = loadTime(load > 1 ? 1 : load, speed, wind) + slewTime(theta, wind)
    if (cost < best) {
      best = cost
      at = theta
    }
  }

  return at
}

/**
 * Seconds spent accelerating from `from` to `to`, m/s, with the kite parked at
 * the drive peak (spec §3.3).
 *
 * `driveAccel` is `A - k·v²`, whose solution is a tanh, so this is exact rather
 * than integrated: `v(t) = balance · tanh(atanh(v₀/balance) + t·A/balance)`,
 * turned around for t. Infinite for a speed at or past the balance, which is
 * the honest answer — no amount of time gets a rider there.
 */
export function spinUpTime(from: number, to: number, wind: number): number {
  if (to <= from) return 0

  const balance = driveBalance(drivePeakAngle(), wind)
  if (!(to < balance)) return Infinity

  const accel = balance * balance * TUNING.DRAG_K
  const start = from > 0 ? Math.atanh(from / balance) : 0
  return (balance / accel) * (Math.atanh(to / balance) - start)
}

/**
 * The slowest the board can be going and still have a line over `type`, m/s.
 *
 * Zero for anything cleared off flat water: a pop needs load, not speed, and
 * the time it takes to build that load at a crawl is already `setupTime`'s
 * business. A boat is different — the arc has to span a hull from a fixed
 * distance behind it, and below some board speed no arc does, however big.
 *
 * Solved rather than searched. Each part of the silhouette asks for
 * `h·v/d + g·d/(2v) <= P`, a quadratic in v whose roots bracket the speeds that
 * clear it; the band that clears the whole boat is the intersection of the
 * three. The discriminant `P² - 2gh` is non-negative exactly when a pop of P
 * reaches h at all, which is the same feasibility question asked at the top.
 */
function boatSpeedBand(wind: number, out: { min: number; max: number }): void {
  const power = popImpulse(1, WINDOW_MIN, wind, TUNING.BONUS_WAKE)
  const lead = TUNING.BOAT_WAKE_LEAD

  out.min = 0
  out.max = Infinity

  for (let i = 0; i < 3; i++) {
    const along = i === 0 ? 0 : i === 1 ? TUNING.BOAT_LEN * TUNING.BOAT_MAST_AT : TUNING.BOAT_LEN
    const height =
      (i === 1 ? TUNING.BOAT_MAST_H : TUNING.BOAT_HULL_H) + TUNING.CLEAR_MARGIN
    const distance = lead + along

    const disc = power * power - 2 * TUNING.GRAVITY * height
    if (disc < 0) {
      out.min = Infinity
      out.max = 0
      return
    }

    const root = Math.sqrt(disc)
    const scale = distance / (2 * height)
    const lo = (power - root) * scale
    const hi = (power + root) * scale
    if (lo > out.min) out.min = lo
    if (hi < out.max) out.max = hi
  }
}

/** Scratch band, so the band solve allocates nothing. */
const band = { min: 0, max: Infinity }

/**
 * The slowest board speed a line over `type` can be started at, m/s.
 *
 * Zero for anything cleared off flat water. For a boat it is the bottom of the
 * band *plus what the send costs*: the last three quarters of a second before
 * the lip are ridden with the kite out of the drive and the edge still in, so a
 * rider who arrives at the bottom of the band crosses the lip below it. What
 * has to be true at the lip is therefore a stronger thing to ask for before the
 * send, and this asks for it.
 */
export function speedFloor(type: ObstacleType, wind: number): number {
  if (type !== OBSTACLE.BOAT) return 0
  boatSpeedBand(wind, band)
  return beforeSend(band.min, slewTime(WINDOW_MIN, wind))
}

/** The speed a boat's wake is actually crossed at, having sent the kite. */
export function arrivalSpeed(type: ObstacleType, wind: number, speed: number): number {
  if (type !== OBSTACLE.BOAT) return speed
  return afterSend(speed, slewTime(WINDOW_MIN, wind))
}

/**
 * Whether `type` can be cleared at all in this wind — the gate that has to be
 * asked before the timing one, because pushing a spawn further out cannot help
 * with an object no pop in this wind gets over.
 *
 * This is where spec §9.1's "pier: rare, tier 3+" comes from. A pier wants 3.5m
 * of apex with the margin, and flat water gives 2.40m at 12kt, 3.37m at 18kt
 * and 4.00m at 25kt: the rule is not written down anywhere below, it is what
 * the flat-water ceiling of §3.5 does to a 3m wall.
 */
export function clearable(type: ObstacleType, wind: number): boolean {
  if (type === OBSTACLE.BOAT) {
    boatSpeedBand(wind, band)
    // The floor is the one `speedFloor` reports, cost of the send included:
    // asking a rider to spin up past MAX_SPEED is asking the impossible. And
    // MAX_SPEED has to be inside the band at the other end too, because a rider
    // is always free to arrive flat out and a boat that punishes that is a trap.
    const floor = beforeSend(band.min, slewTime(WINDOW_MIN, wind))
    return floor <= TUNING.MAX_SPEED && TUNING.MAX_SPEED <= band.max
  }

  const need = requiredImpulse(type, TUNING.MAX_SPEED)
  return loadFor(need, WINDOW_MIN, wind, 1) <= 1
}

/**
 * Seconds from the launch to being over the obstacle.
 *
 * Zero for a boat: the launch *is* the wake lip, and clearing the hull from
 * there is BOAT_WAKE_LEAD's job rather than the timing's. For everything else
 * the cheapest sufficient arc peaks at exactly the height it has to clear, so
 * the crossing is at the apex and the climb takes `v₀/g`.
 */
export function riseTime(type: ObstacleType): number {
  if (type === OBSTACLE.BOAT) return 0
  return requiredImpulse(type, TUNING.MAX_SPEED) / TUNING.GRAVITY
}

/**
 * Spec §9.2's `popSetupTime`, in seconds: everything between deciding to go and
 * being above the obstacle, for a rider travelling at `speed`.
 *
 *     spin up if the line needs more board speed than this
 *   + build the edge and steer the kite, which happen at once
 *   + climb to the top of the obstacle
 *
 * Not a bound and not a budget — the shortest a well-flown line can be. That is
 * the quantity the inequality wants: fairness is a promise that a player who
 * plays well gets over the thing, and grading the promise against a line nobody
 * would fly would make the guarantee mean less than it says.
 */
export function popSetupTime(type: ObstacleType, wind: number, speed: number): number {
  const floor = speedFloor(type, wind)
  const at = speed < floor ? floor : speed
  const spin = spinUpTime(speed, floor, wind)
  const need = requiredImpulse(type, arrivalSpeed(type, wind, at))
  const core = setupTime(need, wind, at, launchBonus(type))
  return spin + core + riseTime(type)
}

/**
 * The gap a spawn of `type` has to leave, metres — the fairness guarantee as a
 * distance, and the one number the generator enforces.
 *
 * This is `max over v of v · (REACTION_MIN + popSetupTime(v))`, which has a
 * closed form rather than needing a search, because every term is either flat
 * or rising in v once multiplied by it:
 *
 *   v · REACTION_MIN        rises with v, so it is largest at MAX_SPEED
 *   v · loadTime(load, v)   is `load · MAX_SPEED / LOAD_RATE` — flat in v,
 *                           because `loadRate` is itself proportional to v
 *   v · slewTime            rises with v: the kite takes as long either way
 *   v · riseTime            rises with v: the climb is the same climb
 *   v · spinUpTime(v)       is zero above the floor and bounded below it by
 *                           `floor · spinUpTime(0 → floor)`, since the spin-up
 *                           only gets shorter as v approaches the floor
 *
 * and `v · max(a(v), b)` is `max(v·a(v), v·b)`, so the max of the sum is at
 * MAX_SPEED plus that one spin-up term.
 *
 * The line the bound is taken on has to be sufficient at *every* speed, not
 * just at MAX_SPEED. For a buoy or a pier the cheapest line is: what they ask
 * for does not depend on how fast it is ridden at, so the same release clears
 * them at any speed. A boat asks for more at both ends of its band, and at the
 * bottom of it there is nothing left over — so its bound is taken on the
 * strongest line in the game, a full edge released at zenith, which is
 * sufficient across the whole band by definition of the band.
 */
export function minSafeGap(type: ObstacleType, wind: number): number {
  const top = TUNING.MAX_SPEED
  const floor = speedFloor(type, wind)
  const spin = floor * spinUpTime(0, floor, wind)

  const core =
    type === OBSTACLE.BOAT
      ? loadTime(1, top, wind) + slewTime(WINDOW_MIN, wind)
      : setupTime(requiredImpulse(type, top), wind, top, 1)

  return top * (TUNING.REACTION_MIN + core + riseTime(type)) + spin
}

/**
 * Metres past the gate before the rider is back on the water and able to act
 * again — where the *next* spawn's gap has to be measured from.
 *
 * The spec's inequality measures from the rider, which is right up until the
 * rider is airborne over the last obstacle. Clearing one costs a jump, and a
 * jump lands somewhere: an obstacle forty metres past a boat is an unavoidable
 * death by landing, which is the very thing §9.2 exists to prevent. So this is
 * the earliest a player can possibly be back down — the ballistic fall of the
 * smallest arc that clears the thing, since holding float only ever lands them
 * later and dumping the kite is always available.
 *
 * Largest at MAX_SPEED, like everything else here: the arc a boat demands grows
 * with speed and so does the ground covered under it. Wind does not come into
 * it: what the arc has to be is a matter of geometry, and how long it hangs is
 * a matter of gravity.
 */
export function runout(type: ObstacleType): number {
  const impulse = requiredImpulse(type, TUNING.MAX_SPEED)
  const airTime = (2 * impulse) / TUNING.GRAVITY
  return TUNING.MAX_SPEED * (airTime - riseTime(type))
}

/**
 * The earliest world x a spawn of `type` may be committed at, given the last
 * point the rider is able to act from — their own position, or where the last
 * obstacle put them back on the water.
 *
 * The whole of §9.2's "if it fails, push it further out", in one function.
 */
export function earliestFair(from: number, type: ObstacleType, wind: number): number {
  return from + minSafeGap(type, wind) + GAP_EPS
}
