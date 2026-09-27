import { describe, expect, it } from 'vitest';
import { Random } from '../../src/game/util/Random';

describe('seeded Random', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Random(12345);
    const b = new Random(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new Random(1);
    const b = new Random(2);
    expect(Array.from({ length: 10 }, () => a.next())).not.toEqual(Array.from({ length: 10 }, () => b.next()));
  });

  it('can resume from a saved state', () => {
    const a = new Random(99);
    for (let i = 0; i < 17; i++) a.next();
    const saved = a.state;
    const expected = Array.from({ length: 10 }, () => a.int(1, 10));
    const resumed = new Random(0);
    resumed.state = saved;
    expect(Array.from({ length: 10 }, () => resumed.int(1, 10))).toEqual(expected);
  });

  it('keeps int() within inclusive bounds and covers the range', () => {
    const r = new Random(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(1, 10);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
      seen.add(v);
    }
    expect(seen.size).toBe(10);
  });

  it('shuffles into a permutation', () => {
    const r = new Random(3);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = r.shuffle([...arr]);
    expect(out.slice().sort()).toEqual(arr);
  });

  it('respects weights', () => {
    const r = new Random(11);
    let heavy = 0;
    for (let i = 0; i < 1000; i++) if (r.weighted([{ item: 'a', weight: 9 }, { item: 'b', weight: 1 }]) === 'a') heavy++;
    expect(heavy).toBeGreaterThan(820);
    expect(() => r.weighted([{ item: 'x', weight: 0 }])).toThrow();
  });

  it('forks independent generators deterministically', () => {
    const a = new Random(5).fork();
    const b = new Random(5).fork();
    expect(a.next()).toBe(b.next());
  });
});
