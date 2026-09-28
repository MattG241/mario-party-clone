import { describe, expect, it } from 'vitest';
import { GAME_HEIGHT, GAME_WIDTH } from '../../src/game/constants';
import { ROSTER_TOP, rosterLayout } from '../../src/game/ui/rosterLayout';

describe('rosterLayout', () => {
  for (const n of [4, 8, 12, 13, 17, 20]) {
    it(`fits ${n} tiles on screen without overlaps`, () => {
      const l = rosterLayout(n);
      expect(l.pos).toHaveLength(n);
      expect(l.rows).toBe(n <= 12 ? 1 : 2);
      for (const p of l.pos) {
        expect(p.x - l.w / 2).toBeGreaterThanOrEqual(30);
        expect(p.x + l.w / 2).toBeLessThanOrEqual(GAME_WIDTH - 30);
        expect(p.y + l.h / 2).toBeLessThanOrEqual(GAME_HEIGHT - 6);
        if (l.rows === 2) expect(p.y - l.h / 2).toBeGreaterThanOrEqual(ROSTER_TOP - 1);
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = l.pos[i];
          const b = l.pos[j];
          const apart = Math.abs(a.x - b.x) >= l.w || Math.abs(a.y - b.y) >= l.h;
          expect(apart).toBe(true);
        }
      }
      // Tiles stay readable on a TV.
      expect(l.w).toBeGreaterThanOrEqual(100);
    });
  }
});
