/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * Every gameplay-affecting random decision (Orbit Dial results, events, item rewards, CPU
 * variation, relic placement) draws from a match-owned Random so a match can be replayed
 * exactly from its seed. The whole generator state is a single uint32, which makes it trivial
 * to serialise into a save file.
 */
export class Random {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Current internal state (store this to resume the sequence later). */
  get state(): number {
    return this.s;
  }

  set state(value: number) {
    this.s = value >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Random.pick called with an empty list');
    return items[Math.floor(this.next() * items.length)];
  }

  /** Weighted pick; weights must be >= 0 and not all zero. */
  weighted<T>(entries: readonly { item: T; weight: number }[]): T {
    const total = entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
    if (total <= 0) throw new Error('Random.weighted called with no positive weights');
    let roll = this.next() * total;
    for (const e of entries) {
      roll -= Math.max(0, e.weight);
      if (roll < 0) return e.item;
    }
    return entries[entries.length - 1].item;
  }

  /** Fisher–Yates shuffle (in place, returns the same array). */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /** A new independent generator derived from this one (advances this generator once). */
  fork(): Random {
    return new Random(Math.floor(this.next() * 4294967296));
  }
}

/** A fresh seed for a new match. */
export function randomSeed(): number {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
  if (g.crypto?.getRandomValues) {
    return g.crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
