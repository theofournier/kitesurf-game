// Scoring (spec §8): what a jump is worth, what a run is worth, and the two
// multipliers that make the greedy line score differently from the safe one.
//
//     jumpScore  = apex^HEIGHT_EXP * HEIGHT_K
//                * landingQuality * combo * clearanceBonus * windMult
//     totalScore = Σ jumpScore + distance * DIST_PER_M
//
// Height is superlinear, so one huge send always beats two safe ones — that is
// the arcade feel, and it is why the whole game points at a wave. Distance pays
// a trickle so cruising is not literally zero, but it pays off mostly
// indirectly, by carrying the rider into wind worth four times as much.
//
// Both of the multipliers the player controls decay on *distance* rather than
// on a clock, for the same reason the wind scales on distance (spec §7.1):
// anything measured in seconds can be farmed by riding slowly.
//
// Pure: mutates a preallocated ScoreState in place and allocates nothing per
// step. A leaf module — TUNING and nothing else. The tier multiplier arrives as
// a number (wind.ts owns it) and the apex as a number (rider.ts owns it), so
// scoring knows about neither the sea nor the rider crossing it.
import { TUNING } from '../config/tuning.ts'

/** A run's score, and everything the two multipliers need to remember. */
export interface ScoreState {
  /** Σ jumpScore + the distance trickle: the number on the game-over screen. */
  total: number
  /** Just the jumps, so the distance half can be told from the earned half. */
  jumps: number
  /**
   * The multiplier the next landing scores at, 1..COMBO_CAP (spec §8.2). Built
   * a rung at a time by clean landings and spent a rung at a time by scrappy
   * ones — see `creditLanding` for the ladder.
   */
  combo: number
  /**
   * World x the combo was last credited or last decayed at, m — the ruler the
   * decay is measured against. Reset by a landing and by a near miss, which is
   * what "extends the combo window" means in spec §8.3.
   */
  comboX: number
  /**
   * The closest the current air has come to the top of an obstacle, m, or
   * Infinity for an air that has passed over nothing. Held across the whole
   * air and spent at the touchdown, because a near miss is a thing the *jump*
   * did rather than a thing the step did.
   */
  clearance: number
  /** What the last touchdown scored. Read by the debug panel and the HUD. */
  lastJump: number
  /** The clearance multiplier that jump was paid at, 1..1.5 (spec §8.3). */
  lastBonus: number
  /**
   * How high the last air went, m — whether or not the rider rode away from it.
   *
   * Not the same question as `bestJump`, and deliberately so. That one is the
   * record of spec §8.4 and counts landed airs only; this is a readout of what
   * just happened, and a 9m send that ended in a wipeout is still a 9m send the
   * player wants to be told about. Kept beside `lastJump` and `lastBonus`
   * because the three are one answer: how high, what it was worth, and why.
   */
  lastApex: number
  /** Highest apex landed so far, m — the jump PB of spec §8.4. */
  bestJump: number
  /**
   * Touchdowns already scored. The landing table is applied once per air by
   * `rider.landings`, and this is the edge that keeps the scoring to the same
   * count — the same pattern the landing feedback uses in render/effects.ts.
   */
  landings: number
}

export function createScoreState(): ScoreState {
  return resetScoreState({} as ScoreState)
}

/**
 * Puts a score back to the start of a run, in place (spec §10's restart).
 *
 * `bestJump` goes with it: it is this run's best landed air, and the PB it is
 * measured against outlives the run somewhere the sim cannot see (spec §8.4).
 */
export function resetScoreState(score: ScoreState): ScoreState {
  score.total = 0
  score.jumps = 0
  score.combo = 1
  score.comboX = 0
  score.clearance = Infinity
  score.lastJump = 0
  score.lastBonus = 1
  score.lastApex = 0
  score.bestJump = 0
  score.landings = 0
  return score
}

/**
 * The near-miss multiplier for a vertical clearance of `gap` metres (§8.3):
 *
 *     clearanceBonus = 1 + 0.5 * (1 - clearance / CLEARANCE_M)
 *
 * 1.5x for shaving the top of a boat, 1.0x at exactly CLEARANCE_M above it, and
 * 1.0x for anything higher or for an air that passed over nothing at all. It is
 * held at 1.5 below zero clearance, which is a case that only exists for a
 * fraction of one step: a gap below zero is contact, and contact is fatal.
 *
 * This is what gives obstacles a reason to exist beyond killing the player, and
 * it is the whole of why the greedy arc looks different from the safe one — the
 * safe one is drawn well over the top of the mast and scores nothing extra for
 * it.
 */
export function clearanceBonus(gap: number): number {
  const span = TUNING.CLEARANCE_M
  if (!(span > 0) || !(gap < span)) return 1

  const bonus = 1 + 0.5 * (1 - gap / span)
  return bonus > 1.5 ? 1.5 : bonus
}

/**
 * What one landed air is worth (spec §8.1).
 *
 * Zero for a wipeout, because `landingQuality` is zero for one: a botched
 * landing costs the trick, the combo and the tempo, and the run continues.
 * That, and only that, is what makes sending tricks the encouraged play — the
 * worst case of a jump is lost time, never a lost run (§7.2).
 */
export function jumpScore(
  apex: number,
  quality: number,
  combo: number,
  bonus: number,
  windMult: number,
): number {
  if (!(apex > 0) || quality <= 0) return 0
  return apex ** TUNING.HEIGHT_EXP * TUNING.HEIGHT_K * quality * combo * bonus * windMult
}

/**
 * Records the closest the step just taken came to the top of an obstacle
 * (spec §8.3).
 *
 * Two things happen at a near miss and they are deliberately different. The
 * clearance itself is kept as the smallest of the air, and paid out once at the
 * touchdown; the combo window is extended immediately, at the moment of the
 * pass, because a player threading obstacles is doing the thing the combo is
 * there to reward whether or not the air they are in ends well.
 */
export function noteClearance(score: ScoreState, gap: number, distance: number): void {
  if (gap < score.clearance) score.clearance = gap
  if (gap < TUNING.CLEARANCE_M) score.comboX = distance
}

/**
 * Whether an air counts as a trick, from the kicker bonus its pop was taken
 * with (spec §4.2): anything off a wave, and nothing off flat water.
 *
 * A flat-water hop is not a trick. It is what a rider does between them — the
 * pop is capped at FLAT_POP_CAP by §3.5 precisely so that flat water is never
 * where the height is — and a combo that could be built and held on flat hops
 * would be a combo about pressing the button rather than about reading the
 * water. Chop is common in the generator for exactly this reason ("chop
 * dominates so the combo has something to live on", world.ts), and 1.15x is all
 * it takes to count.
 *
 * `kicker` is the bonus the pop was multiplied by, so 1 means the water under
 * the board did nothing — flat, or a lip missed by a whole KICKER_WINDOW, which
 * is the same thing as far as the pop is concerned.
 */
export function isTrick(kicker: number): boolean {
  return kicker > 1
}

/**
 * Scores one touchdown and moves the combo (spec §8.1, §8.2, §7.2).
 *
 * The jump is paid at the combo it was *taken* at and the combo moves
 * afterwards, so the first clean landing of a run scores at 1x and the second
 * at 2x. Paying the increment to the jump that earned it would make the first
 * landing worth as much as the second, which is not what a combo is.
 *
 * A trick off a kicker moves the combo one rung of a three-step ladder:
 *
 *     clean    +1, to COMBO_CAP
 *     sketchy  -1, to a floor of 1
 *     wipeout  straight back to 1
 *
 * The middle rung is why it is a ladder rather than a switch. A landing that
 * only just stayed on its feet should not be free for as long as it is not an
 * outright wipeout, and a combo that could only go up or all the way down would
 * have nothing to say about the long middle of the landing table (§3.7) — which
 * is where most landings live. Costing a rung makes the 10x something that has
 * to be flown for the whole way up.
 *
 * A flat hop scores at whatever combo is standing and moves nothing at all,
 * up or down: it is not a trick (see `isTrick`), so it neither builds the combo
 * nor holds it nor costs it. A wipeout resets off any water, kicker or not —
 * that one is the crash, not the trick.
 */
export function creditLanding(
  score: ScoreState,
  apex: number,
  quality: number,
  kicker: number,
  distance: number,
  windMult: number,
  landings: number,
): void {
  const bonus = clearanceBonus(score.clearance)
  const value = jumpScore(apex, quality, score.combo, bonus, windMult)

  score.landings = landings
  score.lastBonus = bonus
  score.lastJump = value
  score.lastApex = apex
  score.jumps += value
  score.clearance = Infinity

  if (quality <= 0) {
    score.combo = 1
    score.comboX = distance
    return
  }

  // The PB is a landed height (spec §8.4): an air the rider did not ride away
  // from is not a jump they made, however high it went.
  if (apex > score.bestJump) score.bestJump = apex
  if (!isTrick(kicker)) return

  if (quality >= TUNING.CLEAN_QUALITY) {
    if (score.combo < TUNING.COMBO_CAP) score.combo += 1
  } else if (score.combo > 1) {
    score.combo -= 1
  }

  // Either way it was a landed trick, so the decay ruler restarts here. A
  // sketchy landing costs its rung and buys the distance back: charging it the
  // rung *and* leaving the ruler where it was would take two multipliers off
  // the same mistake.
  score.comboX = distance
}

/**
 * Advances the score by one step of riding: the distance trickle, and the combo
 * decay of spec §8.2.
 *
 * The decay is a ruler rather than a timer — one multiplier per COMBO_DECAY_M
 * of water crossed without a landed trick — so it costs the same to a rider
 * dawdling as to one flat out, and there is no way to sit on a 10x.
 *
 * The total is recomputed rather than accumulated because the distance half of
 * it is exactly `distance * DIST_PER_M` at every moment: adding a step's worth
 * every step would be the same number reached through thousands of roundings,
 * and a score that depended on the step count would be a score two replays of
 * the same run could disagree about.
 */
export function stepScore(score: ScoreState, distance: number): void {
  const ruler = TUNING.COMBO_DECAY_M

  if (ruler > 0) {
    while (score.combo > 1 && distance - score.comboX >= ruler) {
      score.combo -= 1
      score.comboX += ruler
    }
  }

  score.total = score.jumps + distance * TUNING.DIST_PER_M
}
