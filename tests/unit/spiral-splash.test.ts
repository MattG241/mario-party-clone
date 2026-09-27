import { describe, expect, it } from 'vitest';
import { closestApproach, currentAt, hopTarget, insideEllipse, nearestGap, padGap, padUnder, survivorScore } from '../../src/game/minigames/games/spiralSplashLogic';

const CURRENT = { split: 310, inner: 0.13, outer: -0.085, breathe: 0, breatheRate: 0.35 };

describe('spiral splash pads', () => {
  const pads = [
    { x: 0, y: 0, r: 95 },
    { x: 260, y: 0, r: 95 },
    { x: -400, y: 300, r: 95 },
  ];

  it('finds the pad under a point, preferring the one it is deepest inside', () => {
    expect(padUnder(pads, 10, 5)).toBe(0);
    expect(padUnder(pads, 250, 10)).toBe(1);
    expect(padUnder(pads, 130, 0)).toBe(-1);
    expect(padUnder(pads, 97, 0, 4)).toBe(0);
  });

  it('hops to the first pad in reach along the stick direction', () => {
    const h = hopTarget(pads, 0, 90, 0, 1, 0, 240, 30);
    expect(h).not.toBeNull();
    expect(h!.pad).toBe(1);
    // Lands at least `inset` inside the target's rim.
    expect(Math.hypot(h!.x - 260, h!.y)).toBeLessThanOrEqual(95 - 30 + 1e-6);
    expect(h!.dist).toBeLessThanOrEqual(240);
  });

  it('refuses a hop when nothing is in reach', () => {
    expect(hopTarget(pads, 0, 0, -90, 0, -1, 240, 30)).toBeNull();
    expect(hopTarget(pads, 0, 90, 0, 1, 0, 60, 30)).toBeNull();
    expect(hopTarget(pads, 0, 90, 0, 0, 0, 240, 30)).toBeNull();
  });

  it('forgives a stick direction that is a little off the pad', () => {
    // Pad 1 sits straight right; aim 25 degrees upwards of it.
    const a = (-25 * Math.PI) / 180;
    expect(hopTarget(pads, 0, 90, 0, Math.cos(a), Math.sin(a), 240, 30)).toBeNull();
    const h = hopTarget(pads, 0, 90, 0, Math.cos(a), Math.sin(a), 240, 30, 0.52);
    expect(h?.pad).toBe(1);
  });

  it('measures gaps between pads', () => {
    expect(padGap(pads[0], pads[1])).toBeCloseTo(70);
    expect(nearestGap(pads, 0)).toBeCloseTo(70);
    expect(nearestGap([pads[0]], 0)).toBe(Infinity);
  });
});

describe('spiral splash currents', () => {
  it('turns the inner and outer rings in opposite directions', () => {
    const inner = currentAt(150, 0, 0, CURRENT);
    const outer = currentAt(480, 0, 0, CURRENT);
    expect(Math.sign(inner.vy)).toBe(1);
    expect(Math.sign(outer.vy)).toBe(-1);
    // Purely tangential without breathing.
    expect(inner.vx).toBeCloseTo(0);
    expect(currentAt(0, 0, 0, CURRENT)).toEqual({ vx: 0, vy: 0 });
  });

  it('breathes pads in and out over time', () => {
    const o = { ...CURRENT, breathe: 14 };
    const a = currentAt(200, 0, 0, o);
    const b = currentAt(200, 0, Math.PI / 2 / 0.35, o);
    expect(a.vx).toBeCloseTo(0);
    expect(b.vx).toBeCloseTo(14);
  });
});

describe('spiral splash blasts and ranking', () => {
  it('computes the closest approach of a blast to a player', () => {
    const c = closestApproach(0, 0, 100, 0, 50, 20);
    expect(c.t).toBeCloseTo(0.5);
    expect(c.d).toBeCloseTo(20);
    const past = closestApproach(0, 0, 100, 0, -50, 0);
    expect(past.t).toBe(0);
  });

  it('checks the pond ellipse', () => {
    expect(insideEllipse(700, 0, 760, 560)).toBe(true);
    expect(insideEllipse(700, 0, 760, 560, 80)).toBe(false);
    expect(insideEllipse(0, 600, 760, 560)).toBe(false);
  });

  it('ranks survivors by lives, then hits', () => {
    expect(survivorScore(3, 0)).toBeGreaterThan(survivorScore(2, 40));
    expect(survivorScore(2, 5)).toBeGreaterThan(survivorScore(2, 4));
    expect(survivorScore(1, 500)).toBe(199);
  });
});
