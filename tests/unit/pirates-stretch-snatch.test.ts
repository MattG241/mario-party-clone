import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  clampAim,
  distToSegment,
  FOOD_VALUE,
  haulPoints,
  leadTarget,
  MAX_HAUL,
  onTable,
  segmentsCross,
  serveKind,
  spinSpeed,
  tableTarget,
  toLocal,
} from '../../src/game/worlds/pirates/games/stretchSnatchRules';

describe('stretch & snatch: hauls', () => {
  it('scores fruit 1, drumsticks 2, golden roasts 5', () => {
    expect(FOOD_VALUE.apple).toBe(1);
    expect(FOOD_VALUE.pineapple).toBe(1);
    expect(FOOD_VALUE.meat).toBe(2);
    expect(FOOD_VALUE.roast).toBe(5);
  });

  it('adds a bonus point for a full hand of three', () => {
    expect(MAX_HAUL).toBe(3);
    expect(haulPoints([])).toBe(0);
    expect(haulPoints(['apple'])).toBe(1);
    expect(haulPoints(['apple', 'meat'])).toBe(3);
    expect(haulPoints(['apple', 'meat', 'roast'])).toBe(9);
  });

  it('serves mostly fruit, a drumstick about a quarter of the time', () => {
    expect(serveKind(0.1, 0.5, 0)).toBe('meat');
    expect(serveKind(0.5, 0.0, 0)).toBe('apple');
    expect(serveKind(0.5, 0.999, 0)).toBe('pineapple');
    // later in the round drumsticks come a little more often
    expect(serveKind(0.3, 0.5, 1)).toBe('meat');
    expect(serveKind(0.3, 0.5, 0)).not.toBe('meat');
  });

  it('keeps more food out for more players, and spins up over the round', () => {
    expect(tableTarget(4)).toBeGreaterThan(tableTarget(2));
    expect(spinSpeed(1, false)).toBeGreaterThan(spinSpeed(0, false));
    expect(spinSpeed(0.5, true)).toBeGreaterThan(spinSpeed(0.5, false));
  });
});

describe('stretch & snatch: arm geometry', () => {
  it('finds genuine crossings only', () => {
    const x = segmentsCross(-100, 0, 100, 0, 0, -100, 0, 100);
    expect(x).not.toBeNull();
    expect(x!.x).toBeCloseTo(0);
    expect(x!.y).toBeCloseTo(0);
    // parallel, touching at an end, and short of each other
    expect(segmentsCross(0, 0, 100, 0, 0, 10, 100, 10)).toBeNull();
    expect(segmentsCross(0, 0, 100, 0, 100, 0, 100, 100)).toBeNull();
    expect(segmentsCross(0, 0, 40, 0, 50, -10, 50, 10)).toBeNull();
  });

  it('measures distance to an arm', () => {
    expect(distToSegment(50, 30, 0, 0, 100, 0)).toBeCloseTo(30);
    expect(distToSegment(-40, 30, 0, 0, 100, 0)).toBeCloseTo(50);
    expect(distToSegment(0, 0, 5, 5, 5, 5)).toBeCloseTo(Math.hypot(5, 5));
  });

  it('keeps the aim facing the table', () => {
    expect(clampAim(0.2, 0, 1)).toBeCloseTo(0.2);
    expect(clampAim(2, 0, 1)).toBeCloseTo(1);
    expect(clampAim(-2, 0, 1)).toBeCloseTo(-1);
    // wraps round the back correctly
    expect(angleDelta(clampAim(Math.PI - 0.1, Math.PI, 0.5), Math.PI - 0.1)).toBeCloseTo(0);
  });

  it('turns items with the table, and back to local coordinates', () => {
    const p = onTable(100, 0, Math.PI / 2);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(100);
    const l = toLocal(p.x, p.y, Math.PI / 2);
    expect(l.r).toBeCloseTo(100);
    expect(angleDelta(l.a, 0)).toBeCloseTo(0);
  });

  it('leads a target on the spinning table', () => {
    const sh = { x: -400, y: 0 };
    const still = leadTarget(sh, 150, 0, 0, 0, 960, 0, 640);
    expect(still).not.toBeNull();
    expect(still!.x).toBeCloseTo(150);
    expect(still!.len).toBeCloseTo(550);
    // spinning: the meeting point is further round in the spin's direction
    const spin = leadTarget(sh, 150, 0, 0, 0.8, 960, 0.25, 640);
    expect(spin).not.toBeNull();
    expect(spin!.y).toBeGreaterThan(10);
    // out of reach
    expect(leadTarget(sh, 150, 0, 0, 0, 960, 0, 400)).toBeNull();
  });
});
