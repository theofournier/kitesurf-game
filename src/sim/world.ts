// The world the rider travels through: wind, waves, obstacles (spec §7.1, §9).
// Obstacles land in a later session; this is the wind curve everything else
// scales from, and the waves that are the only way past the flat-water cap.
//
// Pure: no clock, no DOM. Randomness comes from the Rng on WorldState, so a
// run is reproducible from its seed alone.
import { TUNING } from '../config/tuning.ts'
import { Rng } from './rng.ts'

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
 * How many waves can be in play at once. A pool bound, not a gameplay value —
 * the spawn horizon and WAVE_GAP_MIN are what actually decide the density, and
 * this only has to be comfortably above what that pair can ask for.
 */
const WAVE_POOL = 16

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
  /** World x the generator has filled up to, m — the last lip it placed. */
  spawnX: number
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
  const window = TUNING.KICKER_WINDOW
  const t = (delta < 0 ? -delta : delta) / window
  if (!(t < 1)) return 1
  return 1 + (max - 1) * (1 - t * t)
}

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

function clearKicker(out: Kicker): Kicker {
  out.bonus = 1
  out.ramp = 0
  out.delta = 0
  out.type = null
  return out
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
  return { waves, spawnX: 0, rng: new Rng(seed) }
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
function freeSlot(world: WorldState): number {
  for (let i = 0; i < world.waves.length; i++) {
    if (!world.waves[i].active) return i
  }
  return -1
}

/**
 * Keeps the world stocked with waves around `riderX`: recycles what is behind,
 * fills the horizon ahead.
 *
 * The generator is keyed off distance rather than time, so the stream of waves
 * a seed produces is the same however the run is flown — that is what makes a
 * replay replay. The fair-spawn rules of spec §9.2 belong to obstacles and land
 * with them; waves are never lethal, so a gap and a weighted roll is the whole
 * of the generation they need for now.
 */
export function stepWorld(world: WorldState, riderX: number): void {
  const behind = riderX - RECYCLE_M
  for (let i = 0; i < world.waves.length; i++) {
    const wave = world.waves[i]
    if (wave.active && wave.lipX < behind) wave.active = false
  }

  const horizon = riderX + TUNING.MAX_SPEED * SPAWN_AHEAD_S
  while (world.spawnX < horizon) {
    const slot = freeSlot(world)
    // Pool full: leave the horizon short rather than dropping a wave from the
    // stream, so the same seed still lays down the same waves in the same order.
    if (slot < 0) return
    const lipX = world.spawnX + world.rng.range(TUNING.WAVE_GAP_MIN, TUNING.WAVE_GAP_MAX)
    initWave(world.waves[slot], lipX, rollType(world.rng))
    world.spawnX = lipX
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
