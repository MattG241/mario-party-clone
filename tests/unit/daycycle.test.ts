import { describe, expect, it } from 'vitest';
import { dayName, dayTime, lerpColor, lookAt, mulColor } from '../../src/game/board/DayCycle';

describe('festival day cycle', () => {
  it('runs from morning to sunset over the rounds before the finale', () => {
    const turn = { kind: 'turn' as const, index: 0 };
    expect(dayTime(1, 10, turn, 4)).toBe(0);
    const times = Array.from({ length: 9 }, (_, i) => dayTime(i + 1, 10, turn, 4));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(dayTime(9, 10, turn, 4)).toBeCloseTo(0.82, 5);
  });

  it('turns the final round into a dusk that deepens with every turn', () => {
    expect(dayTime(10, 10, { kind: 'roundStart' }, 4)).toBeCloseTo(0.9, 5);
    expect(dayTime(10, 10, { kind: 'turn', index: 0 }, 4)).toBeCloseTo(0.9, 5);
    expect(dayTime(10, 10, { kind: 'turn', index: 3 }, 4)).toBeCloseTo(1, 5);
    expect(dayTime(10, 10, { kind: 'minigame' }, 4)).toBe(1);
    // Short matches still reach the finale's dusk.
    expect(dayTime(1, 1, { kind: 'turn', index: 0 }, 2)).toBeGreaterThanOrEqual(0.9);
  });

  it('blends the look between moments and keeps the spaces lighter than the land', () => {
    const noon = lookAt(0.3);
    // Exactly on a key: fully that key's sky (either as the base or a complete blend into it).
    expect(noon.skyMix === 1 ? noon.skyB : noon.skyA).toBe('clear');
    expect(noon.land).toBe(0xffffff);
    expect(noon.glow).toBe(0);
    // (lookAt reuses one object, so read each result before the next call.)
    const golden = lookAt(0.7);
    expect([golden.skyA, golden.skyB]).toEqual(['golden', 'sunset']);
    expect(golden.skyMix).toBeCloseTo(0.5, 5);
    const night = lookAt(1);
    expect(night.glow).toBe(1);
    expect(night.sun).toBe(0);
    const lum = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
    for (const t of [0, 0.2, 0.5, 0.7, 0.85, 0.95, 1]) {
      const l = lookAt(t);
      expect(lum(l.spaces)).toBeGreaterThanOrEqual(lum(l.land));
      expect(l.skyMix).toBeGreaterThanOrEqual(0);
      expect(l.skyMix).toBeLessThanOrEqual(1);
    }
    // Out-of-range times clamp.
    expect(lookAt(-1).t).toBe(0);
    expect(lookAt(2).t).toBe(1);
  });

  it('mixes and multiplies colours channel by channel', () => {
    expect(lerpColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(lerpColor(0x102030, 0x102030, 0.7)).toBe(0x102030);
    expect(mulColor(0xffffff, 0x123456)).toBe(0x123456);
    expect(mulColor(0x808080, 0xff0000)).toBe(0x800000);
  });

  it('names each stretch of the day for the round banner', () => {
    expect(dayName(0)).toBe('MORNING');
    expect(dayName(0.3)).toBe('MIDDAY');
    expect(dayName(0.62)).toBe('GOLDEN HOUR');
    expect(dayName(0.82)).toBe('SUNSET');
    expect(dayName(0.95)).toBe('NIGHTFALL');
    // A ten-round match reaches golden hour before the finale and ends its daylight at sunset.
    const names = Array.from({ length: 9 }, (_, i) => dayName(dayTime(i + 1, 10, { kind: 'roundStart' }, 4)));
    expect(names).toContain('GOLDEN HOUR');
    expect(names[names.length - 1]).toBe('SUNSET');
  });
});
