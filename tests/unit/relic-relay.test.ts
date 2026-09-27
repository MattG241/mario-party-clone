import { describe, expect, it } from 'vitest';
import {
  buildCourse,
  GOAL_X,
  LANE_Y,
  LANES_FOR,
  MACE_AMP,
  MACE_STRIP,
  maceBall,
  maceHits,
  ordinal,
  raceScore,
  SPRING_MIN_REACH,
  START_X,
  strideClear,
  type CourseObstacle,
} from '../../src/game/minigames/games/relicRelayLogic';
import { Random } from '../../src/game/util/Random';

describe('relic relay course', () => {
  it('uses the specified lanes and the middle ones for fewer players', () => {
    expect(LANE_Y).toEqual([430, 570, 710, 850]);
    expect(START_X).toBe(170);
    expect(GOAL_X).toBe(1750);
    expect(LANES_FOR[2]).toEqual([1, 2]);
    expect(LANES_FOR[4]).toEqual([0, 1, 2, 3]);
  });

  it('is deterministic for a seed and varies between seeds', () => {
    expect(buildCourse(new Random(42))).toEqual(buildCourse(new Random(42)));
    const layouts = new Set(Array.from({ length: 12 }, (_, s) => JSON.stringify(buildCourse(new Random(s + 1)))));
    expect(layouts.size).toBeGreaterThan(6);
  });

  it('lays out two log runs, two maces and a spring in order, inside the course, without overlaps', () => {
    for (let seed = 1; seed < 60; seed++) {
      const c = buildCourse(new Random(seed));
      expect(c.filter((o) => o.kind === 'log').length).toBe(2);
      expect(c.filter((o) => o.kind === 'mace').length).toBe(2);
      expect(c.filter((o) => o.kind === 'spring').length).toBe(1);
      expect(c[0].x0).toBeGreaterThan(START_X + 150);
      expect(c[c.length - 1].x1).toBeLessThan(GOAL_X - 60);
      for (let i = 1; i < c.length; i++) expect(c[i].x0).toBeGreaterThan(c[i - 1].x1 + 20);
      for (const o of c) {
        if (o.kind === 'log') expect(o.period).toBeGreaterThanOrEqual(1150);
        if (o.kind === 'mace') expect(o.period).toBeGreaterThanOrEqual(3600);
      }
    }
  });

  it('springs throw you clean over the obstacle that follows', () => {
    for (let seed = 1; seed < 60; seed++) {
      const c = buildCourse(new Random(seed));
      const i = c.findIndex((o) => o.kind === 'spring');
      const next = c[i + 1];
      expect(next).toBeDefined();
      expect(c[i].period).toBeGreaterThanOrEqual(SPRING_MIN_REACH);
      expect(c[i].x + c[i].period).toBeGreaterThan(next.x1);
      const after = c[i + 2];
      if (after) expect(c[i].x + c[i].period).toBeLessThan(after.x0);
    }
  });
});

describe('relic relay maces', () => {
  const mace: CourseObstacle = { kind: 'mace', x: 800, x0: 732, x1: 868, period: 3600, phase: 0 };
  // With phase 0 the ball is at the bottom at t=0, at an extreme at t=period/4.
  it('hits a runner under the pivot as the ball sweeps through the lane', () => {
    const b = maceBall(mace, 0);
    expect(Math.abs(b.w)).toBeLessThan(1);
    expect(maceHits(mace, 0, 800, 0)).toBe(true);
    expect(maceHits(mace, 0, 800 + MACE_STRIP + 30, 0)).toBe(false);
    // A high enough jump clears it.
    expect(maceHits(mace, 0, 800, 110)).toBe(false);
  });

  it('is harmless while swung out over the hedges', () => {
    const t = mace.period / 4;
    const b = maceBall(mace, t);
    expect(b.w).toBeGreaterThan(100);
    expect(maceHits(mace, t, 800, 0)).toBe(false);
    expect(Math.abs(Math.asin(b.w / Math.hypot(b.w, b.ax, 0)) - 0)).toBeGreaterThan(0);
    expect(MACE_AMP).toBeGreaterThan(0.5);
  });

  it('judges a crossing window: leaving as the ball swings out is safe, just before it returns is not', () => {
    const speed = 120;
    // Start right after the ball has passed (t = 150 ms): the full half-swing is ahead.
    expect(strideClear(mace, 800 - MACE_STRIP - 30, speed, 1, speed, 9, 150)).toBe(true);
    // Start so that the runner would reach the pivot just as the ball comes back through it.
    const reach = (MACE_STRIP + 30) / speed;
    expect(strideClear(mace, 800 - MACE_STRIP - 30, speed, 1, speed, 9, mace.period / 2 - reach * 1000)).toBe(false);
  });
});

describe('relic relay scoring', () => {
  it('ranks finishers by time, then distance with a parcel bonus', () => {
    const first = raceScore({ finished: true, doneAt: 21000, x: 1800, carrying: true });
    const second = raceScore({ finished: true, doneAt: 25500, x: 1800, carrying: true });
    const near = raceScore({ finished: false, doneAt: 0, x: 1600, carrying: false });
    const nearWithParcel = raceScore({ finished: false, doneAt: 0, x: 1500, carrying: true });
    const far = raceScore({ finished: false, doneAt: 0, x: 600, carrying: true });
    expect(first.score).toBeGreaterThan(second.score);
    expect(second.score).toBeGreaterThan(nearWithParcel.score);
    expect(nearWithParcel.score).toBeGreaterThan(near.score);
    expect(near.score).toBeGreaterThan(far.score);
    expect(first.label).toBe('21.0 s');
    expect(near.label).toContain('no parcel');
  });

  it('formats ordinals', () => {
    expect([1, 2, 3, 4].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th']);
  });
});
