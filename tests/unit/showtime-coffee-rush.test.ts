import { describe, expect, it } from 'vitest';
import { angleDiff, coffeePoints, gradeShot, gradeSwirl, orderTarget, patienceMs, pourRate, ROUND_MS, SHOT, SWIRL, swirlPeriod, swirlStart } from '../../src/game/worlds/showtime/coffeeRushRules';
import { Random } from '../../src/game/util/Random';

describe('coffee rush: the shot', () => {
  it('grades a release against the fill line', () => {
    expect(gradeShot(0.6, 0.6)).toBe('perfect');
    expect(gradeShot(0.6 + SHOT.perfect, 0.6)).toBe('perfect');
    expect(gradeShot(0.6 - SHOT.good, 0.6)).toBe('good');
    expect(gradeShot(0.6 + SHOT.good + 0.01, 0.6)).toBe('over');
    expect(gradeShot(0.3, 0.6)).toBe('weak');
    expect(gradeShot(1, 0.8)).toBe('spill');
  });

  it('fills faster and makes customers less patient as the round goes on', () => {
    expect(pourRate(ROUND_MS)).toBeGreaterThan(pourRate(0));
    expect(1 / pourRate(0)).toBeCloseTo(1700);
    expect(patienceMs(ROUND_MS)).toBeLessThan(patienceMs(0));
    expect(patienceMs(-500)).toBe(patienceMs(0));
    expect(swirlPeriod(ROUND_MS)).toBeLessThan(swirlPeriod(0));
  });

  it('draws fill lines a player can hit: inside the cup with room for the whole GOOD band', () => {
    const rng = new Random(9);
    for (let i = 0; i < 200; i++) {
      const t = orderTarget(rng);
      expect(t - SHOT.good).toBeGreaterThan(0.2);
      expect(t + SHOT.good).toBeLessThan(1);
    }
  });
});

describe('coffee rush: the milk swirl', () => {
  it('measures angles the short way round', () => {
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(720, 0)).toBe(0);
  });

  it('grades a tap by how near the heart the milk is', () => {
    expect(gradeSwirl(100, 100)).toBe('perfect');
    expect(gradeSwirl(100 + SWIRL.perfect, 100)).toBe('perfect');
    expect(gradeSwirl(100 - SWIRL.good, 100)).toBe('good');
    expect(gradeSwirl(100 + SWIRL.good + 1, 100)).toBe('messy');
    expect(gradeSwirl(5, 355)).toBe('perfect');
  });

  it('always starts the milk well away from the heart (there is a wind-up)', () => {
    const rng = new Random(4);
    for (let i = 0; i < 200; i++) {
      const s = swirlStart(rng);
      expect(angleDiff(s.start, s.heart)).toBeGreaterThanOrEqual(119.9);
    }
  });
});

describe('coffee rush: scoring', () => {
  it('pays 3 a coffee, plus 1 for each perfect part, doubled in rush hour', () => {
    expect(coffeePoints('good', 'messy', false)).toBe(3);
    expect(coffeePoints('perfect', 'good', false)).toBe(4);
    expect(coffeePoints('perfect', 'perfect', false)).toBe(5);
    expect(coffeePoints('perfect', 'perfect', true)).toBe(10);
    // More coffees still win: three sloppy ones beat two perfect ones.
    expect(3 * coffeePoints('good', 'messy', false)).toBeGreaterThan(2 * coffeePoints('perfect', 'perfect', false) - 1);
  });
});
