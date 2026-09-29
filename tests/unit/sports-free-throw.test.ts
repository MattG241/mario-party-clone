import { describe, expect, it } from 'vitest';
import {
  aimTarget,
  HOOP,
  hoopDistance,
  hoopXAt,
  isBasket,
  isGoldenBall,
  pingPong,
  powerTarget,
  POWER_BASE,
  RACK,
  SHOOT_R,
  shooterSpot,
  shotOutcome,
  shotPoints,
  SLIDE_AMP,
  spotAngles,
  SWISH_K,
} from '../../src/game/worlds/capitol/games/freeThrowRules';

describe('free throw: the court', () => {
  it('puts every shooter the same distance from the hoop, mirrored about it', () => {
    for (let n = 1; n <= 4; n++) {
      const angles = spotAngles(n);
      expect(angles).toHaveLength(n);
      expect(angles.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
      for (let i = 0; i < n; i++) {
        const s = shooterSpot(i, n);
        expect(hoopDistance(s.x, s.gy, HOOP.x)).toBeCloseTo(SHOOT_R, 3);
      }
    }
  });

  it('aims straight while the hoop rests, and mirrored shooters read mirrored zones as it slides', () => {
    const a = shooterSpot(0, 4);
    const b = shooterSpot(3, 4);
    expect(aimTarget(a.x, a.gy, HOOP.x)).toBeCloseTo(0);
    expect(aimTarget(a.x, a.gy, HOOP.x + 150)).toBeCloseTo(-aimTarget(b.x, b.gy, HOOP.x - 150));
    expect(aimTarget(a.x, a.gy, HOOP.x + 150)).toBeGreaterThan(0);
    expect(powerTarget(SHOOT_R, 0)).toBeCloseTo(POWER_BASE);
    expect(powerTarget(SHOOT_R + 200, 0)).toBeGreaterThan(POWER_BASE);
    // Always fully on the bar.
    expect(powerTarget(5000, 0.2)).toBeLessThanOrEqual(0.88);
    expect(powerTarget(0, -0.2)).toBeGreaterThanOrEqual(0.14);
  });

  it('keeps the hoop still until the slide, then eases it in within its track', () => {
    expect(hoopXAt(30000, null)).toBe(HOOP.x);
    expect(hoopXAt(30000, 35000)).toBe(HOOP.x);
    let max = 0;
    for (let t = 35000; t < 45000; t += 50) max = Math.max(max, Math.abs(hoopXAt(t, 35000) - HOOP.x));
    expect(max).toBeLessThanOrEqual(SLIDE_AMP + 1e-6);
    expect(max).toBeGreaterThan(SLIDE_AMP * 0.9);
    // The first moments after it starts are gentle.
    expect(Math.abs(hoopXAt(35100, 35000) - HOOP.x)).toBeLessThan(10);
  });

  it('sweeps its meters as a triangle wave', () => {
    expect(pingPong(0)).toBe(0);
    expect(pingPong(0.5)).toBeCloseTo(0.5);
    expect(pingPong(1)).toBe(1);
    expect(pingPong(1.25)).toBeCloseTo(0.75);
    expect(pingPong(2)).toBe(0);
    expect(pingPong(3.5)).toBeCloseTo(0.5);
  });
});

describe('free throw: shots', () => {
  it('turns meter errors into outcomes', () => {
    expect(shotOutcome(0, 0)).toBe('swish');
    expect(shotOutcome(SWISH_K * 0.9, -SWISH_K * 0.9)).toBe('swish');
    expect(shotOutcome(0.9, 0)).toBe('rim-in');
    expect(shotOutcome(-0.95, 0.95)).toBe('rim-in');
    expect(shotOutcome(1.5, 0.2)).toBe('bank');
    expect(shotOutcome(1.5, 1.2)).toBe('rim-out');
    expect(shotOutcome(-1.5, 0)).toBe('rim-out');
    expect(shotOutcome(3, 0.3)).toBe('board-out');
    expect(shotOutcome(-3, 0)).toBe('short');
    expect(shotOutcome(0, 3)).toBe('wide');
    for (const o of ['swish', 'rim-in', 'bank'] as const) expect(isBasket(o)).toBe(true);
    for (const o of ['rim-out', 'board-out', 'short', 'wide'] as const) expect(isBasket(o)).toBe(false);
  });

  it('scores 2 a basket and 3 a swish, +1 in the final stretch, doubled by the golden ball', () => {
    expect(shotPoints('rim-in', false, false)).toBe(2);
    expect(shotPoints('bank', false, false)).toBe(2);
    expect(shotPoints('swish', false, false)).toBe(3);
    expect(shotPoints('swish', true, false)).toBe(6);
    expect(shotPoints('rim-in', false, true)).toBe(3);
    expect(shotPoints('swish', true, true)).toBe(8);
    expect(shotPoints('rim-out', true, true)).toBe(0);
    expect(shotPoints('short', false, false)).toBe(0);
  });

  it('makes the last ball of every rack golden', () => {
    const golden = Array.from({ length: RACK * 3 }, (_, i) => isGoldenBall(i));
    expect(golden.filter(Boolean)).toHaveLength(3);
    expect(golden[RACK - 1]).toBe(true);
    expect(golden[0]).toBe(false);
    expect(golden[RACK]).toBe(false);
  });
});
