// Persistence (spec §10). v1 is local only: three personal bests under the keys
// the spec names, read once when the page loads and written once when a run
// ends.
//
// Nothing here is ever called from inside a frame. That is not an optimisation
// — `localStorage` is synchronous and blocks the main thread, so a read or a
// write on the update path would be a stall in the middle of the physics — and
// it is why the whole API is two functions taking a plain key/value store: the
// shell holds the values in memory for the length of a run, and this module is
// touched at the two edges of one.
//
// It is also the only file in the project that knows the browser has a disk.
// /src/sim is forbidden from it by CLAUDE.md, and the renderer has no business
// with it; keeping it here means "is persistence in the loop?" is a question
// about one import rather than about the whole codebase.

/**
 * The persisted keys of spec §10.
 *
 * Namespaced so that a browser profile that has played other things on the same
 * origin is not a problem, and flat rather than one JSON blob because that is
 * how the spec writes them — a value per record, individually readable, which
 * is also what makes a corrupt one cost only itself.
 */
export const STORAGE_KEY = {
  score: 'kitesurf.pb.score',
  jump: 'kitesurf.pb.jump',
  distance: 'kitesurf.pb.distance',
  /**
   * Reserved by spec §10 for the best run's input trace, replayable against the
   * deterministic sim. Nothing writes it yet: a run is already fully described
   * by `(seed, inputTrace)` and the sim is ready to replay one, but there is no
   * ghost to draw and no leaderboard to validate against, and a key written
   * before either exists is a format decision made with nothing to check it.
   * Named here so the namespace is claimed and so the next session that needs
   * it does not have to go back to the spec for the string.
   */
  ghost: 'kitesurf.ghost.best',
} as const

/**
 * The three personal bests of spec §8.4, in the units they are earned in:
 * points, metres of landed apex, metres of water.
 *
 * Zero means "never set". No run scores or travels a negative amount, so there
 * is no value a real record could take that this would swallow — and a fresh
 * player and one whose storage was cleared are the same player, which is what
 * lets the markers simply not be drawn rather than needing a flag of their own.
 */
export interface Records {
  score: number
  jump: number
  distance: number
}

/**
 * The two methods of the Web Storage API this needs, and nothing else.
 *
 * Structural rather than the DOM `Storage` type so that the caller can hand in
 * anything shaped like one: `localStorage` satisfies it, and so does a counting
 * fake in a headless test, which is how "never touched inside the loop" is
 * asserted rather than assumed.
 */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** A player with no history: every marker unset. */
export function noRecords(): Records {
  return { score: 0, jump: 0, distance: 0 }
}

/**
 * One stored number, or 0 for anything unusable.
 *
 * Everything that comes back out of storage is a string somebody could have
 * edited, and every one of these values is drawn into the world — a NaN would
 * put the jump line at an undrawable y and an Infinity would put the buoy at
 * the end of the sea. `Number.isFinite` and a floor at zero is the whole guard,
 * and it treats a corrupt value exactly like a missing one.
 */
function readNumber(store: KeyValueStore, key: string): number {
  const raw = store.getItem(key)
  if (raw === null) return 0

  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Reads the three records (spec §10). Called once, when the page loads.
 *
 * A null store — see `browserStorage` — is a player whose browser will not keep
 * anything, and they get a game with no records rather than no game.
 */
export function loadRecords(store: KeyValueStore | null): Records {
  const records = noRecords()
  if (store === null) return records

  try {
    records.score = readNumber(store, STORAGE_KEY.score)
    records.jump = readNumber(store, STORAGE_KEY.jump)
    records.distance = readNumber(store, STORAGE_KEY.distance)
  } catch {
    // A store can throw on read as well as on write — Safari's private mode is
    // the usual one. Whatever was read before the throw stands; the rest stays
    // at zero, which is the same state as never having played.
  }
  return records
}

/**
 * Writes the three records (spec §10). Called once, on the frame a run ends.
 *
 * Swallows a failing store rather than reporting it. The write can throw on a
 * full quota or a locked-down profile, and there is nothing useful to do about
 * it: the records are already correct in memory for the rest of the session, so
 * the player loses their history at the next reload and nothing before then.
 * Losing the run as well, to an exception thrown out of the frame that ended
 * it, would be strictly worse.
 */
export function saveRecords(store: KeyValueStore | null, records: Records): void {
  if (store === null) return

  try {
    store.setItem(STORAGE_KEY.score, `${records.score}`)
    store.setItem(STORAGE_KEY.jump, `${records.jump}`)
    store.setItem(STORAGE_KEY.distance, `${records.distance}`)
  } catch {
    // Deliberately silent — see above.
  }
}

/**
 * The browser's own store, or null where there is not one to be had.
 *
 * Reaching for `localStorage` is itself what throws in a blocked profile, not
 * just using it, so the access is inside the try. This is the one line of the
 * project that names the global, which is what keeps every other module in the
 * app testable with a fake.
 */
export function browserStorage(): KeyValueStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
