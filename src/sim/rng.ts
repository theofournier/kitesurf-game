// Seeded mulberry32. No global state: every stream is an explicit instance, so
// a run is reproducible from its seed alone (spec §9.2, §10).

/** Deterministic PRNG. Two instances with the same seed yield the same stream. */
export class Rng {
  private s: number

  constructor(seed: number) {
    // Coerce to uint32 so any integer seed maps into the generator's domain.
    this.s = seed >>> 0
  }

  /** Next float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Next float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Next integer in [min, max). */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max))
  }

  /** Current internal state, for snapshotting a stream mid-run. */
  getState(): number {
    return this.s
  }

  /** Restore a state captured with getState(). */
  setState(state: number): void {
    this.s = state >>> 0
  }
}
