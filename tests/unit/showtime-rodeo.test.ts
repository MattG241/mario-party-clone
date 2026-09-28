import { describe, expect, it } from 'vitest';
import { buildBucks, COMBO_GAP, FALL_PENALTY_MS, gapMs, LEAN_MIN, ridesOut, rideLabel, rideScore, ROUND_MS, WILD_MS, wildness, windMs } from '../../src/game/worlds/showtime/rodeoRules';

describe('rhinestone rodeo: the bucking schedule', () => {
  it('is the same for a seed (every pony bucks together) and differs across seeds', () => {
    expect(buildBucks(3)).toEqual(buildBucks(3));
    expect(buildBucks(3)).not.toEqual(buildBucks(4));
  });

  it('fits the round, in order, never overlapping, every buck telegraphed', () => {
    for (const seed of [1, 7, 42, 999, 0xabcdef]) {
      const bucks = buildBucks(seed);
      expect(bucks.length).toBeGreaterThan(15);
      expect(bucks[0].windAt).toBeGreaterThan(1000);
      expect(bucks[bucks.length - 1].snapAt).toBeLessThan(ROUND_MS);
      for (let i = 0; i < bucks.length; i++) {
        const b = bucks[i];
        expect(b.snapAt - b.windAt, `seed ${seed} buck ${i}`).toBeGreaterThanOrEqual(300);
        if (i > 0) expect(b.windAt - bucks[i - 1].snapAt).toBeGreaterThanOrEqual(COMBO_GAP);
      }
    }
  });

  it('never tips the same way more than three times running', () => {
    for (const seed of [2, 5, 11, 1234]) {
      let run = 0;
      let last = 0;
      for (const b of buildBucks(seed)) {
        run = b.dir === last ? run + 1 : 1;
        last = b.dir;
        expect(run).toBeLessThanOrEqual(3);
      }
    }
  });

  it('gets wilder: shorter wind-ups and gaps, more combinations, fastest in the wild ride', () => {
    expect(wildness(0)).toBe(0);
    expect(wildness(ROUND_MS - WILD_MS)).toBeGreaterThan(1);
    expect(windMs(1)).toBeLessThan(windMs(0));
    expect(gapMs(1)).toBeLessThan(gapMs(0));
    const bucks = buildBucks(8);
    const early = bucks.filter((b) => b.snapAt < 15000);
    const late = bucks.filter((b) => b.windAt > ROUND_MS - WILD_MS);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(late.map((b) => b.snapAt - b.windAt))).toBeLessThan(avg(early.map((b) => b.snapAt - b.windAt)));
    expect(late.length / (WILD_MS / 1000)).toBeGreaterThan(early.length / 15);
  });
});

describe('rhinestone rodeo: riding and scoring', () => {
  it('rides out a buck only when leaning its way', () => {
    expect(ridesOut(-1, -1)).toBe(true);
    expect(ridesOut(LEAN_MIN, 1)).toBe(true);
    expect(ridesOut(LEAN_MIN - 0.01, 1)).toBe(false);
    expect(ridesOut(0, -1)).toBe(false);
    expect(ridesOut(1, -1)).toBe(false);
  });

  it('scores time in the saddle less a penalty per fall, never below zero', () => {
    expect(rideScore(30000, 0)).toBe(30000);
    expect(rideScore(30000, 2)).toBe(30000 - 2 * FALL_PENALTY_MS);
    expect(rideScore(1000, 3)).toBe(0);
    expect(rideLabel(23999)).toBe('23s');
  });
});
