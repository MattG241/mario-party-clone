import { describe, expect, it } from 'vitest';
import { BEAT_MS, buildChart, DanceCard, FIRST_BEAT, gradeOffset, hitPoints, JUDGE, LATE_BIAS, multiplier, ROUND_BEATS, sectionAt, swoonLevel, type Note } from '../../src/game/worlds/showtime/hipShakeRules';

describe('hip-shake: the chart', () => {
  it('is the same for a seed and different across seeds', () => {
    expect(buildChart(5)).toEqual(buildChart(5));
    expect(buildChart(5)).not.toEqual(buildChart(6));
  });

  it('fits the round: starts after the intro bar, ends before the buzzer, notes in order and never closer than an eighth', () => {
    for (const seed of [1, 5, 99, 12345, 0xdeadbeef]) {
      const notes = buildChart(seed);
      expect(notes.length).toBeGreaterThan(60);
      expect(notes[0].beat).toBeGreaterThanOrEqual(FIRST_BEAT);
      expect(notes[notes.length - 1].beat).toBeLessThanOrEqual(ROUND_BEATS - 2);
      for (let i = 1; i < notes.length; i++) expect(notes[i].beat - notes[i - 1].beat, `seed ${seed} note ${i}`).toBeGreaterThanOrEqual(0.5);
      for (const n of notes) expect(n.t).toBe(n.beat * BEAT_MS);
    }
  });

  it('gets busier: the warm-up uses only the two swivels, later parts every move, and ends on a pose', () => {
    const notes = buildChart(42);
    const warm = notes.filter((n) => sectionAt(n.beat) === 'warm');
    expect(new Set(warm.filter((n) => n.move !== 'A').map((n) => n.move))).toEqual(new Set(['L', 'R']));
    const later = notes.filter((n) => sectionAt(n.beat) !== 'warm');
    expect(new Set(later.map((n) => n.move)).size).toBe(5);
    expect(notes[notes.length - 1].move).toBe('A');
    const density = (s: string) => notes.filter((n) => sectionAt(n.beat) === s).length / 20;
    expect(density('encore')).toBeGreaterThan(density('warm'));
  });
});

describe('hip-shake: judging', () => {
  it('grades by distance from the beat', () => {
    expect(gradeOffset(0)).toBe('perfect');
    expect(gradeOffset(-JUDGE.perfect)).toBe('perfect');
    expect(gradeOffset(JUDGE.perfect + 1)).toBe('good');
    expect(gradeOffset(-JUDGE.good)).toBe('good');
    expect(gradeOffset(JUDGE.good + 1)).toBe('bad');
    expect(gradeOffset(JUDGE.catch + 1)).toBeNull();
  });

  it('multiplies every 8 in a row, up to x4; poses and the encore double', () => {
    expect([0, 7, 8, 15, 16, 24, 80].map(multiplier)).toEqual([1, 1, 2, 2, 3, 4, 4]);
    expect(hitPoints('perfect', 0, false, false)).toBe(3);
    expect(hitPoints('good', 0, false, false)).toBe(1);
    expect(hitPoints('perfect', 8, false, false)).toBe(6);
    expect(hitPoints('perfect', 24, true, true)).toBe(48);
    expect([8, 16, 7, 0].map(swoonLevel)).toEqual([1, 2, 0, 0]);
  });

  const chart: Note[] = [0, 1, 2, 3, 4].map((b) => ({ beat: b, t: b * 500, move: b % 2 ? 'R' : 'L' }));

  it('scores hits on the beat and keeps the streak', () => {
    const card = new DanceCard(chart);
    const r = card.press('L', LATE_BIAS, false);
    expect(r.kind).toBe('hit');
    expect(card.score).toBe(3);
    expect(card.streak).toBe(1);
    expect(card.press('R', 500 + LATE_BIAS + 80, false).kind).toBe('hit');
    expect(card.goods).toBe(1);
    expect(card.streak).toBe(2);
  });

  it('breaks the streak on a wrong move, a miss or a press with nothing to hit (mashing never pays)', () => {
    const card = new DanceCard(chart);
    card.press('L', LATE_BIAS, false);
    expect(card.press('L', 500 + LATE_BIAS, false).kind).toBe('wrong');
    expect(card.streak).toBe(0);
    expect(card.state[1]).toBe(2);
    card.press('L', 1000 + LATE_BIAS, false);
    expect(card.streak).toBe(1);
    expect(card.press('L', 1250 + LATE_BIAS, false).kind).toBe('whiff');
    expect(card.streak).toBe(0);
    // Note 3 goes by untouched.
    const missed: number[] = [];
    card.sweep(1500 + LATE_BIAS + JUDGE.catch + 1, missed);
    expect(missed).toEqual([3]);
    expect(card.misses).toBe(2);
  });

  it('forgives a bounce right after a hit', () => {
    const card = new DanceCard(chart);
    card.press('L', LATE_BIAS, false);
    expect(card.press('R', LATE_BIAS + 40, false).kind).toBe('bounce');
    expect(card.streak).toBe(1);
  });

  it('takes each note once', () => {
    const card = new DanceCard(chart);
    expect(card.press('L', LATE_BIAS, false).kind).toBe('hit');
    expect(card.press('L', LATE_BIAS + 150, false).kind).not.toBe('hit');
    expect(card.perfects).toBe(1);
  });
});
