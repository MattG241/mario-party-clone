import { describe, expect, it } from 'vitest';
import {
  beltSpeed,
  bestTarget,
  catches,
  FLOOR,
  inCatch,
  isBad,
  landingPoint,
  pickItem,
  scoreDelta,
  spawnRate,
  SPEEDUP_MS,
  type Target,
} from '../../src/game/worlds/toons/games/donutDashLogic';
import { Random } from '../../src/game/util/Random';

describe('Donut Dash rules', () => {
  it('speeds the belts up in steps, and a little more in the rush', () => {
    expect(beltSpeed(SPEEDUP_MS + 1, false)).toBeGreaterThan(beltSpeed(0, false));
    expect(beltSpeed(SPEEDUP_MS * 2 + 1, false)).toBeGreaterThan(beltSpeed(SPEEDUP_MS + 1, false));
    // two speed-ups, then the rush
    expect(beltSpeed(SPEEDUP_MS * 3 + 1, false)).toBe(beltSpeed(SPEEDUP_MS * 2 + 1, false));
    expect(beltSpeed(44000, true)).toBeGreaterThan(beltSpeed(44000, false));
    expect(spawnRate(40000, 4, false)).toBeGreaterThan(spawnRate(0, 4, false));
    expect(spawnRate(0, 4, false)).toBeGreaterThan(spawnRate(0, 1, false));
  });

  it('mostly makes donuts in the players’ colours, some decoys, rainbows and things to dodge', () => {
    const rng = new Random(3);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const p = pickItem(rng, [0, 2], false);
      const key = p.kind === 'donut' ? `donut${p.colour}` : p.kind;
      counts[key] = (counts[key] ?? 0) + 1;
      if (p.kind === 'donut') expect(p.colour).toBeGreaterThanOrEqual(0);
      else expect(p.colour).toBe(-1);
    }
    expect(counts.donut0).toBeGreaterThan(900);
    expect(counts.donut2).toBeGreaterThan(900);
    expect((counts.donut1 ?? 0) + (counts.donut3 ?? 0)).toBeGreaterThan(200);
    expect(counts.rainbow).toBeGreaterThan(150);
    expect(counts.broccoli + counts.burnt).toBeGreaterThan(500);
    // with all four colours in play there are no decoys
    for (let i = 0; i < 500; i++) {
      const p = pickItem(rng, [0, 1, 2, 3], true);
      if (p.kind === 'donut') expect([0, 1, 2, 3]).toContain(p.colour);
    }
  });

  it('lands everything on the floor', () => {
    const rng = new Random(9);
    for (let i = 0; i < 1000; i++) {
      const b = i % 5;
      const p = landingPoint(rng, b, beltSpeed(i * 50, i % 2 === 0));
      expect(p.x).toBeGreaterThanOrEqual(FLOOR.x0);
      expect(p.x).toBeLessThanOrEqual(FLOOR.x1);
      expect(p.y).toBeGreaterThanOrEqual(FLOOR.y0);
      expect(p.y).toBeLessThanOrEqual(FLOOR.y1);
    }
  });

  it('lets only the matching colour catch a donut; anyone gets rainbows and bad luck', () => {
    const mine = { kind: 'donut' as const, colour: 1 };
    const theirs = { kind: 'donut' as const, colour: 2 };
    const rainbow = { kind: 'rainbow' as const, colour: -1 };
    const broccoli = { kind: 'broccoli' as const, colour: -1 };
    expect(catches(mine, 1)).toBe(true);
    expect(catches(theirs, 1)).toBe(false);
    expect(catches(rainbow, 3)).toBe(true);
    expect(catches(broccoli, 0)).toBe(true);
    expect(scoreDelta(mine, 1)).toBe(1);
    expect(scoreDelta(rainbow, 1)).toBe(2);
    expect(scoreDelta(broccoli, 1)).toBe(-1);
    expect(isBad(broccoli)).toBe(true);
    expect(isBad({ kind: 'burnt', colour: -1 })).toBe(true);
    expect(isBad(rainbow)).toBe(false);
  });

  it('catches within the flattened zone round the feet', () => {
    expect(inCatch(500, 800, 500, 800)).toBe(true);
    expect(inCatch(560, 800, 500, 800)).toBe(true);
    expect(inCatch(500, 860, 500, 800)).toBe(false);
    expect(inCatch(600, 800, 500, 800)).toBe(false);
  });

  it('picks a reachable, worthwhile target', () => {
    const targets: Target[] = [
      { x: 1500, y: 800, t: 300, value: 1 }, // too far to reach in time
      { x: 620, y: 820, t: 700, value: 1 },
      { x: 700, y: 820, t: 800, value: 2 }, // a rainbow a little further
      { x: 520, y: 800, t: 200, value: 0 }, // not ours
    ];
    expect(bestTarget(500, 800, 440, targets)).toBe(2);
    expect(bestTarget(500, 800, 440, targets.slice(0, 2))).toBe(1);
    expect(bestTarget(500, 800, 440, [targets[0]])).toBe(-1);
  });
});
