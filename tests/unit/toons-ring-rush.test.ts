import { describe, expect, it } from 'vitest';
import {
  BUZZER_Z,
  GRAVITY,
  isHazard,
  JUMP_V,
  LANES,
  laneValue,
  minHazardGap,
  RING_DZ,
  ringsBumped,
  ringsLost,
  RushCourse,
  scrollSpeed,
  SPRING_V,
  type CourseItem,
} from '../../src/game/worlds/toons/games/ringRushLogic';
import { Random } from '../../src/game/util/Random';

function course(seed: number, chunks: number, fever = false): { items: CourseItem[]; speeds: number[] } {
  const c = new RushCourse(new Random(seed), 1200);
  const items: CourseItem[] = [];
  const speeds: number[] = [];
  for (let k = 0; k < chunks; k++) {
    const intensity = k / chunks;
    const speed = scrollSpeed(intensity * 45000, fever);
    for (const it of c.nextChunk(speed, intensity, fever)) {
      items.push(it);
      speeds.push(speed);
    }
  }
  return { items, speeds };
}

describe('Ring Rush rules', () => {
  it('knocks loose half your rings (at least one, at most eight) on a hit', () => {
    expect(ringsLost(0)).toBe(0);
    expect(ringsLost(1)).toBe(1);
    expect(ringsLost(5)).toBe(3);
    expect(ringsLost(12)).toBe(6);
    expect(ringsLost(40)).toBe(8);
    expect(ringsBumped(1)).toBe(1);
    expect(ringsBumped(9)).toBe(2);
  });

  it('speeds up over the round', () => {
    expect(scrollSpeed(0, false)).toBeLessThan(scrollSpeed(30000, false));
    expect(scrollSpeed(45000, true)).toBeGreaterThan(scrollSpeed(45000, false));
    expect(scrollSpeed(99999, false)).toBe(scrollSpeed(45000, false));
  });

  it('lays a course with valid lanes and items ahead of the start', () => {
    for (const seed of [1, 2, 3, 99, 1234]) {
      const { items } = course(seed, 60);
      expect(items.length).toBeGreaterThan(200);
      for (const it of items) {
        expect(it.lane).toBeGreaterThanOrEqual(0);
        expect(it.lane).toBeLessThan(LANES);
        expect(it.wx).toBeGreaterThan(900);
        expect(it.z).toBeGreaterThanOrEqual(0);
      }
      expect(items.some((i) => i.kind === 'crawler')).toBe(true);
      expect(items.some((i) => i.kind === 'buzzer')).toBe(true);
      expect(items.some((i) => i.kind === 'spring')).toBe(true);
    }
  });

  it('keeps every hazard beatable in its own lane (spacing per lane)', () => {
    for (const seed of [5, 6, 7, 8, 42]) {
      const { items, speeds } = course(seed, 80);
      const byLane = new Map<number, { it: CourseItem; speed: number }[]>();
      items.forEach((it, i) => {
        if (!isHazard(it.kind)) return;
        const list = byLane.get(it.lane) ?? [];
        list.push({ it, speed: speeds[i] });
        byLane.set(it.lane, list);
      });
      for (const list of byLane.values()) {
        list.sort((a, b) => a.it.wx - b.it.wx);
        for (let i = 1; i < list.length; i++) {
          const gap = list[i].it.wx - list[i - 1].it.wx;
          expect(gap).toBeGreaterThanOrEqual(minHazardGap(list[i].it.kind, list[i - 1].it.kind, list[i].speed) - 1);
        }
      }
    }
  });

  it('never walls off all four lanes at once', () => {
    for (const seed of [11, 12, 13]) {
      const { items } = course(seed, 80);
      const hz = items.filter((i) => isHazard(i.kind));
      for (const h of hz) {
        const lanes = new Set(hz.filter((o) => Math.abs(o.wx - h.wx) < 120).map((o) => o.lane));
        expect(lanes.size).toBeLessThan(LANES);
      }
    }
  });

  it('hangs arc rings where a jump over the crawler actually passes', () => {
    const { items, speeds } = course(21, 80);
    const T = (2 * JUMP_V) / GRAVITY;
    items.forEach((cr, i) => {
      if (cr.kind !== 'crawler') return;
      const speed = speeds[i];
      // the rings in its lane within one jump's reach are on (or just under) the jump's arc
      const arc = items.filter((r) => r.kind === 'ring' && r.lane === cr.lane && Math.abs(r.wx - cr.wx) < (speed * T) / 2 && r.z > 0);
      for (const r of arc) {
        const t = (r.wx - (cr.wx - (speed * T) / 2)) / speed;
        const z = JUMP_V * t - (GRAVITY * t * t) / 2;
        // spring arcs are taller than a jump: only check the rings a jump could reach
        if (r.z > (JUMP_V * JUMP_V) / (2 * GRAVITY) + 10) continue;
        expect(Math.abs(z - r.z)).toBeLessThan(RING_DZ);
      }
    });
    expect(SPRING_V).toBeGreaterThan(JUMP_V);
    expect(BUZZER_Z).toBeGreaterThan(40);
  });

  it('values ring lanes and shies away from a buzzer when the dash is not ready', () => {
    const seen = [
      { lane: 0, dx: 200, kind: 'ring' as const, z: 0 },
      { lane: 0, dx: 270, kind: 'ring' as const, z: 0 },
      { lane: 1, dx: 300, kind: 'buzzer' as const, z: BUZZER_Z },
      { lane: 1, dx: 380, kind: 'ring' as const, z: 0 },
    ];
    expect(laneValue(seen, 0, 900, 0, 600)).toBeGreaterThan(laneValue(seen, 2, 900, 0, 600));
    // with the dash ready the buzzer lane is still worth less than a clear ring lane...
    expect(laneValue(seen, 1, 900, 0, 600)).toBeLessThan(laneValue(seen, 0, 900, 0, 600));
    // ...and much worse when the dash is on cooldown
    expect(laneValue(seen, 1, 900, 5000, 600)).toBeLessThan(laneValue(seen, 1, 900, 0, 600));
  });
});
