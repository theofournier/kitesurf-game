// Persistence (spec §10): the three keys, what comes back out of them, and what
// happens when the browser will not play along.
import { describe, expect, it } from 'vitest'
import {
  browserStorage,
  loadRecords,
  noRecords,
  saveRecords,
  STORAGE_KEY,
  type KeyValueStore,
} from '../../src/platform/storage.ts'

/** A store that remembers what it was asked, so a test can count the asking. */
function fakeStore(seed: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(seed))
  const reads: string[] = []
  const writes: string[] = []

  const store: KeyValueStore = {
    getItem(key) {
      reads.push(key)
      return data.has(key) ? data.get(key)! : null
    },
    setItem(key, value) {
      writes.push(key)
      data.set(key, value)
    },
  }

  return { store, data, reads, writes }
}

/** A store that throws on everything, the way a locked-down profile does. */
const HOSTILE: KeyValueStore = {
  getItem(): string | null {
    throw new Error('nope')
  },
  setItem(): void {
    throw new Error('nope')
  },
}

describe('the keys of spec §10', () => {
  it('is exactly the namespaced set the spec writes', () => {
    expect(STORAGE_KEY.score).toBe('kitesurf.pb.score')
    expect(STORAGE_KEY.jump).toBe('kitesurf.pb.jump')
    expect(STORAGE_KEY.distance).toBe('kitesurf.pb.distance')
    expect(STORAGE_KEY.ghost).toBe('kitesurf.ghost.best')
  })
})

describe('loadRecords', () => {
  it('reads the three personal bests', () => {
    const { store } = fakeStore({
      [STORAGE_KEY.score]: '18400',
      [STORAGE_KEY.jump]: '9.25',
      [STORAGE_KEY.distance]: '2310',
    })

    expect(loadRecords(store)).toEqual({ score: 18400, jump: 9.25, distance: 2310 })
  })

  it('reads each key exactly once', () => {
    const { store, reads } = fakeStore()
    loadRecords(store)
    expect(reads).toEqual([STORAGE_KEY.score, STORAGE_KEY.jump, STORAGE_KEY.distance])
  })

  it('gives a player with no history a clean sheet', () => {
    expect(loadRecords(fakeStore().store)).toEqual(noRecords())
  })

  it('treats a corrupt value exactly like a missing one', () => {
    // Every one of these would otherwise be drawn into the world: a NaN puts
    // the sky line at an undrawable y, an Infinity puts the buoy past the end
    // of the sea, and a negative record can never be beaten.
    for (const raw of ['', 'NaN', 'Infinity', '-1', 'null', 'undefined', '{}', '1e999']) {
      const { store } = fakeStore({ [STORAGE_KEY.jump]: raw })
      expect(loadRecords(store).jump, raw).toBe(0)
    }
  })

  it('survives a store that throws, and a browser with no store at all', () => {
    expect(loadRecords(HOSTILE)).toEqual(noRecords())
    expect(loadRecords(null)).toEqual(noRecords())
  })
})

describe('saveRecords', () => {
  it('writes the three keys and nothing else', () => {
    const { store, data, writes } = fakeStore()
    saveRecords(store, { score: 1200, jump: 6.5, distance: 880 })

    expect(writes).toEqual([STORAGE_KEY.score, STORAGE_KEY.jump, STORAGE_KEY.distance])
    expect(data.get(STORAGE_KEY.score)).toBe('1200')
    expect(data.get(STORAGE_KEY.jump)).toBe('6.5')
    expect(data.get(STORAGE_KEY.distance)).toBe('880')
  })

  it('round-trips what it wrote', () => {
    const { store } = fakeStore()
    const records = { score: 4321.5, jump: 7.125, distance: 1999 }

    saveRecords(store, records)
    expect(loadRecords(store)).toEqual(records)
  })

  it('swallows a failing store rather than throwing out of the frame', () => {
    // The write lands on the one frame a run ends. An exception escaping it
    // would cost the player the run as well as the record.
    expect(() => saveRecords(HOSTILE, noRecords())).not.toThrow()
    expect(() => saveRecords(null, noRecords())).not.toThrow()
  })
})

describe('browserStorage', () => {
  it('is null where there is no browser to ask', () => {
    // Headless: `window` does not exist, which is the same answer a blocked
    // profile gives — and the game has to start either way.
    expect(browserStorage()).toBeNull()
  })
})
