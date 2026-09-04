// The world the rider travels through: wind, the waves that are the only way
// past the flat-water cap, and the lethal furniture between them (spec §7.1,
// §9).
//
// Everything in it comes out of one seeded stream, laid down in order of
// position, so a run is reproducible from its seed alone — which is what buys
// ghosts, replays and server-side replay validation.
//
// Pure: no clock, no DOM. Randomness comes from the Rng on WorldState.
import { TUNING } from '../config/tuning.ts'
import { clearable, earliestFair, runout } from './fairness.ts'
import { clearKicker, WAVE, type Kicker, type WaveType } from './kicker.ts'
import {
  createObstacle,
  initBoat,
  initObstacle,
  OBSTACLE,
  type Obstacle,
  type ObstacleType,
} from './obstacles.ts'
import { Rng } from './rng.ts'
import { tierWind, WIND_AUTO, windAt } from './wind.ts'

// The kicker struct and the three wave types live in kicker.ts so that rider.ts
// can have them without importing the world (see the note there). They are part
// of this module's surface all the same: a wave is what carries a kicker.
export { clearKicker, createKicker, NO_KICKER, WAVE, type Kicker, type WaveType } from './kicker.ts'

// The wind curve lives in wind.ts so that scoring.ts can price a jump by the
// tier it was taken in without importing the sea it was taken off. It is part
// of this module's surface all the same: the wind is what lays the sea out.
export { tierAt, tierMult, WIND_AUTO, windAt } from './wind.ts'

/**
 * How many waves can be in play at once. A pool bound, not a gameplay value —
 * the spawn horizon and WAVE_GAP_MIN are what actually decide the density, and
 * this only has to be comfortably above what that pair can ask for.
 */
const WAVE_POOL = 16

/**
 * How many obstacles can be in play at once. A pool bound like WAVE_POOL, and
 * comfortably above what the generator can ask for: nothing is committed past
 * the spawn horizon, so what is in play spans RECYCLE_M behind the rider to
 * SPAWN_AHEAD_S of riding ahead of them — 162m, against a minimum obstacle gap
 * that never drops below 60m even at tier 4.
 */
const OBSTACLE_POOL = 8

/** Metres behind the rider a wave is kept before its slot is recycled. */
const RECYCLE_M = 30

/**
 * Seconds of MAX_SPEED riding the generator keeps filled ahead of the rider.
 * Well past WAVE_LEAD, so a wave always exists in the world before the moment
 * it has to be telegraphed on screen.
 */
const SPAWN_AHEAD_S = 6

/**
 * One kicker in the world (spec §4.1).
 *
 * `x` is the trough where the face starts and `lipX` the top of it — the point
 * the release is timed against. Both are stored rather than derived per read
 * because the renderer and the timing both want them every step.
 */
export interface Wave {
  /** False for a pooled slot that is not in play. */
  active: boolean
  type: WaveType
  /** World x where the face starts, m. */
  x: number
  /** World x of the lip: the top of the face, and the point pops are timed to. */
  lipX: number
  /** Ramp height, m (spec §4.1). */
  height: number
  /** Length of the face, trough to lip, m. */
  face: number
  /** What a perfectly timed release off this wave multiplies the pop by (§4.1). */
  maxBonus: number
}

export interface WorldState {
  /** Fixed pool. Recycled behind the rider, never reallocated. */
  waves: Wave[]
  /** Fixed pool of lethal objects (spec §9.1). Recycled the same way. */
  obstacles: Obstacle[]
  /**
   * World x of the next lip, drawn but not yet placed — so the world is filled
   * with waves everywhere below it.
   *
   * Held rather than redrawn because the two streams are committed in order of
   * position and the comparison has to see both candidates: a draw that were
   * repeated whenever the other stream went first would make the run depend on
   * how it was flown rather than on its seed.
   */
  spawnX: number
  /** The same, for the next obstacle: the gate it will be measured against. */
  obstacleX: number
  /**
   * World x the rider is next able to act from, m: where the last obstacle's
   * jump puts them back on the water (`runout`). The gap of spec §9.2 is
   * measured from here, not from the obstacle itself — see fairness.ts.
   */
  clearX: number
  rng: Rng
}

/** Ramp height of a wave type, m (spec §4.1). */
export function rampHeight(type: WaveType): number {
  if (type === WAVE.WAKE) return TUNING.RAMP_WAKE
  if (type === WAVE.WAVE) return TUNING.RAMP_WAVE
  return TUNING.RAMP_CHOP
}

/** Perfect-timing bonus of a wave type (spec §4.1). */
export function maxBonus(type: WaveType): number {
  if (type === WAVE.WAKE) return TUNING.BONUS_WAKE
  if (type === WAVE.WAVE) return TUNING.BONUS_WAVE
  return TUNING.BONUS_CHOP
}

/**
 * Length of the face a ramp of `height` metres presents, m:
 *
 *     face = WAVE_FACE_K * sqrt(height)
 *
 * Sub-linear in the height, so a taller wave is also a steeper one: chop is a
 * 0.3m rise over 2.7m of water and a boat wake a 1.8m rise over 6.7m. That
 * slope is what `rampSpeed` launches off, so the drawn face and the velocity it
 * gives are the same number seen twice — a wave cannot look mellow and kick
 * hard, or the reverse.
 */
export function faceLength(height: number): number {
  return height > 0 ? TUNING.WAVE_FACE_K * Math.sqrt(height) : 0
}

/**
 * The upward velocity the face itself gives on takeoff, m/s (spec §4.2).
 *
 * A rider going up a slope of gradient `height / face` at `speed` is already
 * travelling upward at `speed * gradient` when they leave the lip. That is all
 * this is, and it is why it is separate from `kickerBonus`: the bonus grades
 * the timing and multiplies the pop, the ramp is the water under the board and
 * pays out whether or not the pop was any good.
 *
 * WAVE_FACE_K is set so that at MAX_SPEED a wave gives very nearly its own
 * height back as apex — 1.8m off a boat wake — which is the reference the
 * constant was picked against rather than a law of the formula.
 */
export function rampSpeed(height: number, speed: number): number {
  const face = faceLength(height)
  if (face <= 0 || speed <= 0) return 0
  return (speed * height) / face
}

/**
 * The lip-timing bonus (spec §4.2):
 *
 *     kickerBonus = 1 + (maxBonus - 1) * max(0, 1 - (Δt / KICKER_WINDOW)^2)
 *
 * `delta` is signed — negative before the lip, positive after — because the
 * debug readout wants to say which way the miss went, but only its magnitude
 * reaches the curve. Full bonus at the lip, nothing at all a window either
 * side, and ~84% of the bonus still standing at ±120ms: wide enough to be
 * learnable, narrow enough that hitting it is the skill peak of the game.
 */
export function kickerBonus(max: number, delta: number): number {
  // Named `half` rather than `window`: shadowing a DOM global inside the sim
  // reads as a mistake even when it is not, and the purity check in
  // tests/sim/purity.test.ts has no way to tell the two apart.
  const half = TUNING.KICKER_WINDOW
  const t = (delta < 0 ? -delta : delta) / half
  if (!(t < 1)) return 1
  return 1 + (max - 1) * (1 - t * t)
}

function createWave(): Wave {
  return {
    active: false,
    type: WAVE.CHOP,
    x: 0,
    lipX: 0,
    height: 0,
    face: 0,
    maxBonus: 1,
  }
}

/** Puts a pooled slot into play as a `type` wave with its lip at `lipX`. */
export function initWave(wave: Wave, lipX: number, type: WaveType): Wave {
  const height = rampHeight(type)
  const face = faceLength(height)

  wave.active = true
  wave.type = type
  wave.lipX = lipX
  wave.x = lipX - face
  wave.height = height
  wave.face = face
  wave.maxBonus = maxBonus(type)
  return wave
}

export function createWorldState(seed: number): WorldState {
  const waves: Wave[] = []
  for (let i = 0; i < WAVE_POOL; i++) waves.push(createWave())

  const obstacles: Obstacle[] = []
  for (let i = 0; i < OBSTACLE_POOL; i++) obstacles.push(createObstacle())

  // Only the pools are built here. Everything else about a fresh world is what
  // `resetWorldState` says it is, so a first run and a restarted one lay down
  // the same water from the same seed.
  const rng = new Rng(seed)
  return resetWorldState({ waves, obstacles, spawnX: 0, obstacleX: 0, clearX: 0, rng }, seed)
}

/**
 * Empties the world and re-seeds it, in place (spec §10's restart).
 *
 * The pools are kept and their slots simply retired: they are the only
 * allocation this module ever makes, and a restart that rebuilt them would be
 * paying for sixteen waves and eight obstacles to get back exactly what it
 * already had. What makes the reset a reset is the rng — a stream put back to
 * `seed` lays down the same sea it laid down the first time, which is the whole
 * of what "a run is (seed, inputTrace)" means.
 */
export function resetWorldState(world: WorldState, seed: number): WorldState {
  for (let i = 0; i < world.waves.length; i++) world.waves[i].active = false
  for (let i = 0; i < world.obstacles.length; i++) world.obstacles[i].active = false

  world.rng.setState(seed)
  world.clearX = 0
  // Both streams start with a candidate in hand, drawn here so that the first
  // step of a run has the same two-candidate comparison to make as every step
  // after it. The wind is tier 1 at the start of every run by definition of the
  // curve, so the first obstacle gap is drawn at WIND_BASE.
  world.spawnX = world.rng.range(TUNING.WAVE_GAP_MIN, TUNING.WAVE_GAP_MAX)
  world.obstacleX = obstacleGap(world.rng, TUNING.WIND_BASE)
  return world
}

/**
 * Which kicker the next roll of the stream asks for. Chop dominates so the
 * combo has something to live on, and a boat wake is rare because it is the
 * biggest air in the game — it stops being an event if it is on every corner.
 */
function rollType(rng: Rng): WaveType {
  const roll = rng.next()
  if (roll < TUNING.WAVE_MIX_CHOP) return WAVE.CHOP
  if (roll < TUNING.WAVE_MIX_CHOP + TUNING.WAVE_MIX_WAVE) return WAVE.WAVE
  return WAVE.WAKE
}

/** First slot not in play, or -1 when the pool is full. */
function freeSlot(pool: readonly { active: boolean }[]): number {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].active) return i
  }
  return -1
}

/**
 * How far the next obstacle is drawn, m (spec §9.2's density rule).
 *
 * Both ends of the range shrink with the wind, and the maximum shrinks faster
 * than the minimum — that is what tightens the rhythm rather than merely
 * speeding it up. At tier 1 the draw is 110–320m and at tier 4 it is 64–89m: a
 * loose, sparse sea becomes a drumbeat.
 *
 * The fairness floor is applied afterwards, at the commit, and always wins.
 */
function obstacleGap(rng: Rng, wind: number): number {
  const scale = wind > 0 ? TUNING.WIND_BASE / wind : 1
  const min = TUNING.OBSTACLE_GAP_MIN * scale ** TUNING.DENSITY_MIN_EXP
  const max = TUNING.OBSTACLE_GAP_MAX * scale ** TUNING.DENSITY_MAX_EXP
  return rng.range(min, max > min ? max : min)
}

/**
 * Whether the water is heavy enough to lay a pier in (spec §9.1: "rare, tier
 * 3+").
 *
 * Two claims, and they are different ones. `clearable` is pure physics — can a
 * pop in this wind get over 3m of wall at all — and it turns true at 19.1kt,
 * which the curve reaches around 660m. That is the middle of tier 2, and a wall
 * that can *only* be cleared by the single strongest line in the game is not
 * what tier 2 is for. So the tier the spec asks for is asked for as well: not
 * as a distance, but as the wind that tier opens at, which is the same thing
 * under the curve (25kt is exactly 1500m) and the right thing under a wind
 * override, where the tier table has no distance to speak of.
 */
function pierWater(wind: number): boolean {
  return wind >= tierWind(TUNING.PIER_TIER) && clearable(OBSTACLE.PIER, wind)
}

/**
 * Which of the two free-standing obstacles the stream asks for next.
 *
 * A pier that this water cannot take is not rolled away and retried, it is
 * simply not a pier: the draw is spent either way, so what the water allows
 * changes what comes out of the stream without changing the stream itself.
 */
function rollObstacleType(rng: Rng, wind: number): ObstacleType {
  const roll = rng.next()
  if (roll < TUNING.OBSTACLE_MIX_PIER && pierWater(wind)) return OBSTACLE.PIER
  return OBSTACLE.BUOY
}

/**
 * The wind a spawn's fairness is judged in, kt.
 *
 * Not the wind where the object stands, and not the rider's either: the wind at
 * `clearX`, where the line to it starts. The fairness gate prices a whole line —
 * spin up, build the edge, steer the kite, climb — and every one of those terms
 * is cheaper in more wind. Wind rises with distance (spec §7.1), so the weakest
 * wind anywhere on that approach is the wind at the beginning of it, and pricing
 * the line there is the only reading that cannot promise a rider more pop than
 * the water they are actually crossing will give them.
 *
 * It is a function of the world rather than of the rider for the same reason
 * every other draw here is: the rider's own wind would make what the stream
 * lays down depend on how far into a frame the generator happened to be called,
 * which is the one thing a replay cannot survive.
 */
function gateWind(world: WorldState, override: number): number {
  return windAt(world.clearX, override)
}

/**
 * Gives a committed wake the boat that made it (spec §9.2).
 *
 * A boat is never placed on its own. §4.1 calls the 1.8m kicker a boat wake and
 * says it sits beside a lethal boat, so that is exactly what it is: the wake is
 * the launch and the boat is the reason to take it, and the two are positioned
 * as one object by `initBoat`. A wake whose lip is too close behind the last
 * obstacle to be a fair launch simply carries no boat — that is what "push it
 * further out" means for a pair that cannot be moved apart.
 */
function placeBoat(world: WorldState, lipX: number, wind: number): void {
  if (!clearable(OBSTACLE.BOAT, wind)) return
  if (lipX < earliestFair(world.clearX, OBSTACLE.BOAT, wind)) return

  const slot = freeSlot(world.obstacles)
  if (slot < 0) return

  initBoat(world.obstacles[slot], lipX)
  world.clearX = lipX + runout(OBSTACLE.BOAT)
}

/**
 * Places the pending wave, and returns false if the pool has no room for it.
 *
 * The false is a stall, not a skip: leaving the horizon short keeps the stream
 * in step, where dropping a wave from it would give the same seed two different
 * worlds depending on how full the pool happened to be.
 */
function commitWave(world: WorldState, override: number): boolean {
  const slot = freeSlot(world.waves)
  if (slot < 0) return false

  const lipX = world.spawnX
  const type = rollType(world.rng)
  initWave(world.waves[slot], lipX, type)
  if (type === WAVE.WAKE) placeBoat(world, lipX, gateWind(world, override))

  world.spawnX = lipX + world.rng.range(TUNING.WAVE_GAP_MIN, TUNING.WAVE_GAP_MAX)
  return true
}

/**
 * Places the pending obstacle, pushing it out until the fairness gate of §9.2
 * passes. Returns false if the pool has no room, on the same terms as waves.
 */
function commitObstacle(world: WorldState, override: number): boolean {
  const slot = freeSlot(world.obstacles)
  if (slot < 0) return false

  const wind = gateWind(world, override)
  const type = rollObstacleType(world.rng, wind)
  // Rolled where the candidate stood, placed where the gate allows.
  const at = Math.max(world.obstacleX, earliestFair(world.clearX, type, wind))

  initObstacle(world.obstacles[slot], at, type)
  world.clearX = at + runout(type)
  // The next gap is drawn in the wind where that obstacle stands: density is a
  // property of the water it is laid in (spec §9.2), not of the line to it.
  world.obstacleX = at + obstacleGap(world.rng, windAt(at, override))
  return true
}

/**
 * Keeps the world stocked around `riderX`: recycles what is behind, fills the
 * horizon ahead with waves and with the lethal furniture between them.
 *
 * The generator is keyed off distance rather than time, so the stream a seed
 * produces is the same however the run is flown — that is what makes a replay
 * replay. `override` is the run's wind override rather than its current wind
 * for the same reason: the wind a spawn is judged in is the wind at the spawn's
 * own position, which the rider's progress cannot move.
 *
 * Waves and obstacles come out of one rng in strict order of position, never
 * two streams taking turns. Two would be simpler to read and impossible to
 * replay: the fairness gate makes each spawn depend on what has already been
 * committed, so the order the draws happen in has to be a function of the world
 * and not of which stream the frame boundary happened to fall in.
 */
export function stepWorld(world: WorldState, riderX: number, override: number = WIND_AUTO): void {
  const behind = riderX - RECYCLE_M
  for (let i = 0; i < world.waves.length; i++) {
    const wave = world.waves[i]
    if (wave.active && wave.lipX < behind) wave.active = false
  }
  for (let i = 0; i < world.obstacles.length; i++) {
    const obstacle = world.obstacles[i]
    if (obstacle.active && obstacle.x + obstacle.len < behind) obstacle.active = false
  }

  const horizon = riderX + TUNING.MAX_SPEED * SPAWN_AHEAD_S
  while (world.spawnX < horizon || world.obstacleX < horizon) {
    if (world.spawnX <= world.obstacleX) {
      if (!commitWave(world, override)) return
    } else if (!commitObstacle(world, override)) {
      return
    }
  }
}

/**
 * Fills `out` with what the water at `x` is worth to a pop at `speed`.
 *
 * The nearest lip in time wins, and anything a full KICKER_WINDOW away is flat
 * water. WAVE_GAP_MIN is far longer than a window is wide at any rideable
 * speed, so "nearest" is a formality rather than a contest.
 *
 * A standing rider is on flat water by definition: with no speed there is no
 * time to a lip and nothing to ride up the face.
 */
export function kickerAt(out: Kicker, world: WorldState, x: number, speed: number): Kicker {
  clearKicker(out)
  if (speed <= 0) return out

  let nearest: Wave | null = null
  let delta = 0
  let best = TUNING.KICKER_WINDOW

  for (let i = 0; i < world.waves.length; i++) {
    const wave = world.waves[i]
    if (!wave.active) continue
    const dt = (x - wave.lipX) / speed
    const gap = dt < 0 ? -dt : dt
    if (gap < best) {
      best = gap
      delta = dt
      nearest = wave
    }
  }

  if (nearest === null) return out

  out.bonus = kickerBonus(nearest.maxBonus, delta)
  out.ramp = rampSpeed(nearest.height, speed)
  out.delta = delta
  out.type = nearest.type
  return out
}
