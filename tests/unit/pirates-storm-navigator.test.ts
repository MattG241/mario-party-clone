import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  BAY,
  bayMeasure,
  boomAngle,
  inIrons,
  keepInBay,
  sailEfficiency,
  splitLoss,
  strikeLoss,
  tackHeading,
  TREASURE_VALUE,
  treasureKind,
} from '../../src/game/worlds/pirates/games/stormNavigatorRules';

const D = Math.PI / 180;

describe('storm navigator: sailing', () => {
  it('sails best across the wind and stalls heading into it', () => {
    const wind = 0; // blowing toward +x
    const across = sailEfficiency(90 * D, wind);
    const withIt = sailEfficiency(0, wind);
    const into = sailEfficiency(180 * D, wind);
    expect(across).toBeCloseTo(1, 1);
    expect(withIt).toBeGreaterThan(0.6);
    expect(withIt).toBeLessThan(across);
    expect(into).toBeLessThan(0.15);
    expect(inIrons(170 * D, wind)).toBe(true);
    expect(inIrons(100 * D, wind)).toBe(false);
    // symmetric either side of the wind
    expect(sailEfficiency(-120 * D, wind)).toBeCloseTo(sailEfficiency(120 * D, wind));
  });

  it('tacks either side of the no-go zone, keeping to its tack', () => {
    const wind = 0;
    // straight upwind is out: pick a tack
    const up = tackHeading(Math.PI, wind);
    expect(up.tack).not.toBe(0);
    expect(inIrons(up.heading, wind)).toBe(false);
    // keeps the tack it's on while the bearing is still upwind
    const keep = tackHeading(Math.PI - 0.1, wind, -1);
    expect(keep.tack).toBe(-1);
    // a bearing across the wind is sailed straight
    const cross = tackHeading(80 * D, wind);
    expect(cross.tack).toBe(0);
    expect(cross.heading).toBeCloseTo(80 * D);
  });

  it('swings the boom out to the side the wind pushes', () => {
    const heading = 0;
    // wind blowing toward +y (down-screen, the boat's right side): the boom swings right of the stern
    const b = boomAngle(heading, Math.PI / 2, 0);
    expect(angleDelta(b, Math.PI)).toBeLessThan(0);
    const c = boomAngle(heading, -Math.PI / 2, 0);
    expect(angleDelta(c, Math.PI)).toBeGreaterThan(0);
  });
});

describe('storm navigator: the bay', () => {
  it('knows the open water, and pulls strays back in', () => {
    const cx = (BAY.x0 + BAY.x1) / 2;
    const cy = (BAY.y0 + BAY.y1) / 2;
    expect(bayMeasure(cx, cy)).toBeLessThan(0.01);
    expect(bayMeasure(BAY.x1 + 50, cy)).toBeGreaterThan(1);
    const p = { x: BAY.x1 + 200, y: cy };
    expect(keepInBay(p)).toBe(true);
    expect(bayMeasure(p.x, p.y)).toBeLessThanOrEqual(1.0001);
    const q = { x: cx, y: cy };
    expect(keepInBay(q)).toBe(false);
  });
});

describe('storm navigator: treasure', () => {
  it('values pouches 1, chests 3, golden chests 5', () => {
    expect(TREASURE_VALUE.pouch).toBe(1);
    expect(TREASURE_VALUE.chest).toBe(3);
    expect(TREASURE_VALUE.goldchest).toBe(5);
    expect(treasureKind(0.05, false)).toBe('goldchest');
    expect(treasureKind(0.05, true)).toBe('chest');
    expect(treasureKind(0.9, false)).toBe('pouch');
  });

  it('takes about a third in a lightning strike, and scatters it in pieces', () => {
    expect(strikeLoss(0)).toBe(0);
    expect(strikeLoss(1)).toBe(1);
    expect(strikeLoss(10)).toBe(3);
    expect(strikeLoss(40)).toBe(4);
    const parts = splitLoss(7);
    expect(parts.reduce((a, k) => a + TREASURE_VALUE[k], 0)).toBe(7);
    expect(splitLoss(2)).toEqual(['pouch', 'pouch']);
  });
});
