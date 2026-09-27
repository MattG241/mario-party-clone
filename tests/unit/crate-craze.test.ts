import { describe, expect, it } from 'vitest';
import {
  applyFriction,
  boxBoxContact,
  boxHalfPlane,
  boxInside,
  circleBoxContact,
  containBox,
  cornerCut,
  cornerRect,
  detourPoint,
  pushSpot,
  resolve,
  segmentDistance,
  zoneIndex,
  zoneSlots,
  zoneTotals,
  type Body,
} from '../../src/game/minigames/games/crateCrazeLogic';

const body = (x: number, y: number, vx = 0, vy = 0): Body => ({ x, y, vx, vy });
const FLOOR = { x: 240, y: 0, w: 1440, h: 900 };

describe('crate craze contacts', () => {
  it('detects a circle touching a box side and points the normal at the box', () => {
    const c = circleBoxContact(100, 0, 30, 160, 0, 50);
    expect(c).not.toBeNull();
    expect(c!.nx).toBeCloseTo(1);
    expect(c!.ny).toBeCloseTo(0);
    expect(c!.depth).toBeCloseTo(20);
    expect(circleBoxContact(70, 0, 30, 160, 0, 50)).toBeNull();
  });

  it('pushes a circle whose centre is inside a box out through the nearest side', () => {
    const c = circleBoxContact(155, 40, 30, 160, 0, 50);
    expect(c).toEqual({ nx: 0, ny: -1, depth: 40 });
  });

  it('uses the least-penetration axis for two boxes', () => {
    const c = boxBoxContact(0, 0, 50, 90, 20, 50);
    expect(c).toEqual({ nx: 1, ny: 0, depth: 10 });
    expect(boxBoxContact(0, 0, 50, 101, 0, 50)).toBeNull();
  });

  it('separates bodies and conserves momentum in a perfectly inelastic push', () => {
    const player = body(0, 0, 400, 0);
    const crate = body(70, 0, 0, 0);
    const imp = resolve(player, 1, crate, 1.6, { nx: 1, ny: 0, depth: 10 }, 0);
    expect(imp).toBeCloseTo(400);
    expect(player.vx).toBeCloseTo(crate.vx);
    expect(player.vx * 1 + crate.vx * 1.6).toBeCloseTo(400);
    // Heavier crate moves less during the positional correction.
    expect(Math.abs(crate.x - 70)).toBeLessThan(Math.abs(player.x));
  });

  it('treats Infinity mass as immovable', () => {
    const player = body(0, 0, 300, 0);
    const wall = body(60, 0, 0, 0);
    resolve(player, 1, wall, Infinity, { nx: 1, ny: 0, depth: 8 }, 0);
    expect(wall.x).toBe(60);
    expect(player.x).toBeCloseTo(-8);
    expect(player.vx).toBeCloseTo(0);
  });
});

describe('crate craze motion', () => {
  it('friction slows a crate to a stop without reversing it', () => {
    const k = body(0, 0, 300, 0);
    for (let i = 0; i < 100; i++) applyFriction(k, 1500, 1.2, 0.016);
    expect(k.vx).toBe(0);
    const slow = body(0, 0, 10, 0);
    applyFriction(slow, 1500, 1.2, 0.1);
    expect(slow.vx).toBe(0);
  });

  it('keeps crates inside the yard and bounces them off the fence', () => {
    const k = body(250, 400, -500, 0);
    const hit = containBox(k, 50, FLOOR, 0.3);
    expect(hit).toBe(500);
    expect(k.x).toBe(290);
    expect(k.vx).toBeCloseTo(150);
  });

  it('slides crates along a corner planter instead of wedging them', () => {
    const cut = cornerCut(FLOOR, 0, 190);
    const k = body(300, 60, -200, -200);
    const hit = boxHalfPlane(k, 50, cut, 0);
    expect(hit).toBeGreaterThan(0);
    // After resolution the box no longer penetrates and has no velocity into the planter.
    const lo = k.x * cut.nx + k.y * cut.ny - 50 * (Math.abs(cut.nx) + Math.abs(cut.ny));
    expect(lo).toBeGreaterThanOrEqual(cut.d - 1e-6);
    expect(k.vx * cut.nx + k.vy * cut.ny).toBeGreaterThanOrEqual(-1e-6);
  });
});

describe('crate craze zones', () => {
  const zones = [0, 1, 2, 3].map((c) => cornerRect(FLOOR, c, 330, 270));

  it('places zones in the four corners', () => {
    expect(zones[0]).toEqual({ x: 240, y: 0, w: 330, h: 270 });
    expect(zones[1]).toEqual({ x: 1350, y: 0, w: 330, h: 270 });
    expect(zones[2]).toEqual({ x: 240, y: 630, w: 330, h: 270 });
    expect(zones[3]).toEqual({ x: 1350, y: 630, w: 330, h: 270 });
  });

  it('only counts crates fully inside a zone (with tolerance)', () => {
    expect(boxInside(400, 150, 52, zones[0])).toBe(true);
    expect(boxInside(530, 150, 52, zones[0])).toBe(false);
    expect(boxInside(520, 150, 52, zones[0], 6)).toBe(true);
    expect(zoneIndex(1500, 800, 52, zones)).toBe(3);
    expect(zoneIndex(960, 450, 52, zones)).toBe(-1);
    expect(zoneIndex(1500, 800, 52, [zones[0], null, zones[2], null])).toBe(-1);
  });

  it('totals crate points per zone', () => {
    const totals = zoneTotals(
      [
        { zone: 0, points: 1 },
        { zone: 0, points: 3 },
        { zone: 2, points: 1 },
        { zone: -1, points: 3 },
      ],
      4,
    );
    expect(totals).toEqual([4, 0, 1, 0]);
  });

  it('packs slots deepest-first and fully inside the zone', () => {
    const slots = zoneSlots(zones[3], 3, 105, 3, 2, 3);
    expect(slots).toHaveLength(6);
    expect(slots[0].x).toBeGreaterThan(slots[5].x);
    expect(slots[0].y).toBeGreaterThan(slots[5].y);
    for (const s of slots) expect(boxInside(s.x, s.y, 52.5, zones[3])).toBe(true);
  });
});

describe('crate craze CPU geometry', () => {
  it('stands behind a crate on the far side from the goal', () => {
    const s = pushSpot(500, 500, 300, 500, 90);
    expect(s.x).toBeCloseTo(590);
    expect(s.y).toBeCloseTo(500);
    expect(s.dx).toBeCloseTo(-1);
  });

  it('walks around a crate on the side it is already on', () => {
    const d = detourPoint(400, 530, 500, 500, -1, 0, 100);
    expect(d.y).toBeGreaterThan(500);
    expect(d.x).toBeGreaterThan(500);
  });

  it('measures distance to a segment', () => {
    expect(segmentDistance(5, 5, 0, 0, 10, 0)).toBeCloseTo(5);
    expect(segmentDistance(-3, 4, 0, 0, 10, 0)).toBeCloseTo(5);
  });
});
