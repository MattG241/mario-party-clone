import { describe, expect, it } from 'vitest';
import {
  BOUNDS,
  bounceKick,
  BUNKERS,
  closestToPin,
  COSB,
  cupOf,
  CUPS,
  FRICTION,
  G_SLOPE,
  GREEN,
  gradAt,
  heightAt,
  holeAt,
  holePoints,
  HOLES,
  keepInBounds,
  rollStep,
  ROUND_MS,
  searchShot,
  shotKind,
  simulateShot,
  surfaceAt,
  TEE_DIST,
  teeOf,
  windFor,
} from '../../src/game/worlds/capitol/games/fairwayRules';

const W = (sx: number, sy: number) => ({ x: sx, y: sy / COSB });

describe('fairway: the green', () => {
  it('knows green, fringe, rough and sand', () => {
    expect(surfaceAt(GREEN.cx, GREEN.cy / COSB)).toBe('green');
    const b = BUNKERS[0];
    expect(surfaceAt(b.cx, b.cy / COSB)).toBe('sand');
    expect(surfaceAt(GREEN.cx + GREEN.rx * 1.06, GREEN.cy / COSB)).toBe('fringe');
    expect(surfaceAt(GREEN.cx + GREEN.rx * 1.4, GREEN.cy / COSB)).toBe('rough');
  });

  it('has a gradient that matches its height field', () => {
    const g = { x: 0, y: 0 };
    for (const [sx, sy] of [
      [700, 520],
      [1100, 640],
      [880, 760],
      [1300, 450],
    ]) {
      const p = W(sx, sy);
      gradAt(p.x, p.y, g);
      const e = 0.5;
      expect(g.x).toBeCloseTo((heightAt(p.x + e, p.y) - heightAt(p.x - e, p.y)) / (2 * e), 4);
      expect(g.y).toBeCloseTo((heightAt(p.x, p.y + e) - heightAt(p.x, p.y - e)) / (2 * e), 4);
    }
  });

  it('never pulls harder than the green holds, so every ball comes to rest', () => {
    const g = { x: 0, y: 0 };
    let worst = 0;
    for (let sx = GREEN.cx - GREEN.rx; sx <= GREEN.cx + GREEN.rx; sx += 20) {
      for (let sy = GREEN.cy - GREEN.ry; sy <= GREEN.cy + GREEN.ry; sy += 20) {
        const p = W(sx, sy);
        if (surfaceAt(p.x, p.y) !== 'green') continue;
        gradAt(p.x, p.y, g);
        worst = Math.max(worst, G_SLOPE * Math.hypot(g.x, g.y));
      }
    }
    expect(worst).toBeLessThan(FRICTION.green * 0.8);
    const b = { ...W(1000, 600), vx: 400, vy: -150 };
    let steps = 0;
    while (rollStep(b, 1 / 120) && steps < 5000) steps++;
    expect(steps).toBeLessThan(5000);
    expect(Math.hypot(b.vx, b.vy)).toBe(0);
  });

  it('turns a ball back at the edge of the lawn', () => {
    const b = { x: BOUNDS.cx + BOUNDS.rx + 40, y: BOUNDS.cy / COSB, vx: 300, vy: 0 };
    keepInBounds(b);
    expect(b.x).toBeLessThanOrEqual(BOUNDS.cx + BOUNDS.rx + 1e-6);
    expect(b.vx).toBeLessThan(0);
  });
});

describe('fairway: shots and holes', () => {
  it('chips from the tee and off the green, putts on it', () => {
    const c = W(GREEN.cx, GREEN.cy);
    expect(shotKind(0, c.x, c.y)).toBe('chip');
    expect(shotKind(1, c.x, c.y)).toBe('putt');
    const b = BUNKERS[1];
    expect(shotKind(2, b.cx, b.cy / COSB)).toBe('chip');
  });

  it('can hole a short putt with the right weight (and not with a wild one)', () => {
    const cup = cupOf(0);
    const start = { x: cup.x - 150, y: cup.y };
    const angle = Math.atan2(cup.y - start.y, cup.x - start.x);
    let holed = false;
    for (let a = -0.3; a <= 0.3 && !holed; a += 0.01) {
      for (let p = 0.05; p <= 0.6 && !holed; p += 0.01) holed = simulateShot(start.x, start.y, 'putt', angle + a, p, { x: 0, y: 0 }, cup).holed;
    }
    expect(holed).toBe(true);
    expect(simulateShot(start.x, start.y, 'putt', angle, 1, { x: 0, y: 0 }, cup).holed).toBe(false);
  });

  it("lets a CPU that reads the green perfectly find a putt that drops", () => {
    const cup = cupOf(1);
    const start = { x: cup.x + 90, y: cup.y - 160 };
    const plan = { angle: 0, power: 0 };
    const search = searchShot(start.x, start.y, 'putt', { x: 0, y: 0 }, cup, 1, plan);
    let pauses = 0;
    while (!search.next().done) pauses++;
    expect(pauses).toBeGreaterThan(3);
    expect(simulateShot(start.x, start.y, 'putt', plan.angle, plan.power, { x: 0, y: 0 }, cup).holed).toBe(true);
  });

  it('puts every tee the same distance from its cup, on the lawn', () => {
    for (let h = 0; h < HOLES.length; h++) {
      const cup = cupOf(h);
      expect(surfaceAt(cup.x, cup.y)).toBe('green');
      for (let i = 0; i < 4; i++) {
        const t = teeOf(h, i);
        expect(Math.hypot(t.x - cup.x, t.y - cup.y)).toBeCloseTo(TEE_DIST, 3);
        const dx = (t.x - BOUNDS.cx) / BOUNDS.rx;
        const dy = (t.y * COSB - BOUNDS.cy) / BOUNDS.ry;
        expect(dx * dx + dy * dy).toBeLessThan(1);
      }
    }
    expect(CUPS).toHaveLength(HOLES.length);
  });

  it('scores 5, 3 and 2 by strokes, doubled at the end', () => {
    expect([1, 2, 3, 4].map((s) => holePoints(s, false))).toEqual([5, 3, 2, 0]);
    expect([1, 2, 3].map((s) => holePoints(s, true))).toEqual([10, 6, 4]);
  });

  it('runs three holes with breaks, ending with the round', () => {
    expect(holeAt(0)).toEqual({ hole: 0, playing: true });
    expect(holeAt(HOLES[0].end + 100)).toEqual({ hole: 1, playing: false });
    expect(holeAt(HOLES[1].start + 10)).toEqual({ hole: 1, playing: true });
    expect(holeAt(ROUND_MS - 1)).toEqual({ hole: 2, playing: true });
    expect(HOLES[HOLES.length - 1].end).toBe(ROUND_MS);
  });

  it('gives the closest-to-the-pin bonus only to a ball that is in play', () => {
    const cup = { x: 0, y: 0 };
    const balls = [
      { x: 5, y: 0, strokes: 0, holed: false },
      { x: 0, y: 1, strokes: 2, holed: true },
      { x: 40, y: 0, strokes: 1, holed: false },
      { x: 30, y: 0, strokes: 3, holed: false },
    ];
    expect(closestToPin(balls, cup)).toBe(3);
    expect(closestToPin([{ x: 1, y: 1, strokes: 0, holed: false }], cup)).toBe(-1);
  });

  it('blows harder on the final hole', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 20; k++) {
      expect(windFor(HOLES.length - 1, rnd).strength).toBeGreaterThanOrEqual(2);
      expect(windFor(0, rnd).strength).toBeLessThanOrEqual(3);
    }
  });

  it('kicks a landing chip a little off line, never wildly', () => {
    const v = { x: 0, y: 0, vx: 300, vy: 0 };
    bounceKick(v, 1, 1);
    const sp = Math.hypot(v.vx, v.vy);
    expect(sp).toBeGreaterThan(300);
    expect(sp).toBeLessThan(400);
    expect(Math.abs(Math.atan2(v.vy, v.vx))).toBeLessThan(0.5);
  });
});
