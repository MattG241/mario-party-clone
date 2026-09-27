import { describe, expect, it } from 'vitest';
import {
  BRANCH_GAP,
  GRAB_STANCE,
  GRAB_STEP_DY,
  generateTower,
  MAX_GAP,
  PLAY_X0,
  PLAY_X1,
  ROW_DY,
  ROW_JITTER,
  START_Y,
  SUMMIT_REACH,
  SUMMIT_Y,
  towerScore,
} from '../../src/game/minigames/games/TumbleTowerLayout';
import { Random } from '../../src/game/util/Random';

describe('tumble tower layout', () => {
  it('always builds a climbable route from the floor to the summit', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const planks = generateTower(new Random(seed));
      expect(planks[0].kind).toBe('ground');
      expect(planks[0].y).toBe(START_Y);
      const summit = planks[planks.length - 1];
      expect(summit.kind).toBe('summit');
      expect(summit.y).toBe(SUMMIT_Y);
      const route = planks.filter((p) => p.main);
      for (let i = 1; i < route.length - 1; i++) {
        const lo = route[i - 1];
        const hi = route[i];
        const rise = lo.y - hi.y;
        expect(rise).toBeGreaterThan(0);
        if (hi.grabRow) {
          // Tall step: grab-only, with room on the plank below to stand beside the ledge's end.
          expect(rise).toBeLessThanOrEqual(GRAB_STEP_DY);
          const roomL = hi.x - hi.w / 2 - (lo.x - lo.w / 2);
          const roomR = lo.x + lo.w / 2 - (hi.x + hi.w / 2);
          expect(Math.max(roomL, roomR)).toBeGreaterThanOrEqual(GRAB_STANCE);
        } else {
          expect(rise).toBeLessThanOrEqual(ROW_DY + ROW_JITTER + 0.001);
          const gap = Math.abs(hi.x - lo.x) - (hi.w + lo.w) / 2;
          expect(gap).toBeLessThanOrEqual(MAX_GAP + 0.001);
        }
      }
      const last = route[route.length - 2];
      expect(last.y - SUMMIT_Y).toBeLessThanOrEqual(SUMMIT_REACH);
      expect(last.x + last.w / 2).toBeGreaterThan(summit.x - summit.w / 2);
      expect(last.x - last.w / 2).toBeLessThan(summit.x + summit.w / 2);
      // Side branches sit within a hop of a route plank at about the same height.
      for (const b of planks.filter((p) => !p.main)) {
        const near = route.some((r) => Math.abs(r.y - b.y) <= 30 && Math.abs(r.x - b.x) - (r.w + b.w) / 2 <= BRANCH_GAP[1] + 0.001);
        expect(near).toBe(true);
      }
      for (const p of planks) {
        if (p.kind === 'ground' || p.kind === 'summit') continue;
        expect(p.x - p.w / 2 - p.amp).toBeGreaterThanOrEqual(PLAY_X0 - 0.001);
        expect(p.x + p.w / 2 + p.amp).toBeLessThanOrEqual(PLAY_X1 + 0.001);
      }
    }
  });

  it('mixes in moving, tipping and crumbling planks', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const kinds = generateTower(new Random(seed)).map((p) => p.kind);
      expect(kinds.filter((k) => k === 'moving' || k === 'tipping' || k === 'crumble').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('ranks by height, then by who got there first', () => {
    expect(towerScore(1800, 30000)).toBeGreaterThan(towerScore(1700, 1000));
    expect(towerScore(1800, 20000)).toBeGreaterThan(towerScore(1800, 25000));
  });
});
