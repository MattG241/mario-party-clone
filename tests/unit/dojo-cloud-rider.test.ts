import { describe, expect, it } from 'vitest';
import { burstPower, COURSE, courseSpeed, nextPattern, patternWeights, resolveBump, ringsLost } from '../../src/game/worlds/dojo/games/cloudRiderRules';
import { Random } from '../../src/game/util/Random';

describe('Cloud Rider course', () => {
  it('keeps every ring and orb inside the flight band and storms inside theirs', () => {
    for (let seed = 1; seed < 80; seed++) {
      const rng = new Random(seed);
      let prev: string | undefined;
      for (let i = 0; i < 30; i++) {
        const t = i / 30;
        const p = nextPattern(rng, t, i > 24, prev);
        prev = p.name;
        expect(p.length).toBeGreaterThan(0);
        for (const it of p.items) {
          expect(it.dx).toBeGreaterThanOrEqual(0);
          if (it.kind === 'storm') {
            expect(it.y).toBeGreaterThanOrEqual(COURSE.stormTop - 60);
            expect(it.y).toBeLessThanOrEqual(COURSE.stormBottom + 60);
          } else {
            expect(it.y).toBeGreaterThanOrEqual(COURSE.top);
            expect(it.y).toBeLessThanOrEqual(COURSE.bottom);
          }
        }
        if (p.gust) {
          expect(p.gust.y - p.gust.half).toBeGreaterThanOrEqual(COURSE.top - 60);
          expect(p.gust.y + p.gust.half).toBeLessThanOrEqual(COURSE.bottom + 60);
        }
      }
    }
  });

  it('never puts a ring inside a storm cloud', () => {
    for (let seed = 1; seed < 120; seed++) {
      const rng = new Random(seed);
      for (let i = 0; i < 12; i++) {
        const p = nextPattern(rng, 0.2 + i * 0.06, false);
        const storms = p.items.filter((it) => it.kind === 'storm');
        for (const it of p.items) {
          if (it.kind === 'storm') continue;
          for (const s of storms) {
            const dx = (it.dx - s.dx) / 190;
            const dy = (it.y - s.y) / 120;
            expect(dx * dx + dy * dy, `${p.name}`).toBeGreaterThan(1);
          }
        }
      }
    }
  });

  it('opens gently, brings hazards in later, and the ring rush has none', () => {
    const early = patternWeights(0, false).map((w) => w.item);
    expect(early).not.toContain('storm');
    expect(early).not.toContain('gust');
    const late = patternWeights(0.7, false).map((w) => w.item);
    expect(late).toContain('storm');
    expect(late).toContain('gust');
    const rush = patternWeights(0.9, true).map((w) => w.item);
    expect(rush).not.toContain('storm');
    expect(rush).not.toContain('stormGap');
  });

  it('spaces hazards out (never two hazard patterns in a row) and is repeatable from a seed', () => {
    const hazards = new Set(['storm', 'stormGap', 'orbStorm', 'gust']);
    const run = (seed: number) => {
      const rng = new Random(seed);
      const names: string[] = [];
      let prev: string | undefined;
      for (let i = 0; i < 40; i++) {
        prev = nextPattern(rng, 0.3 + (i / 40) * 0.6, false, prev).name;
        names.push(prev);
      }
      return names;
    };
    for (let seed = 1; seed < 30; seed++) {
      const names = run(seed);
      for (let i = 1; i < names.length; i++) expect(hazards.has(names[i]) && hazards.has(names[i - 1])).toBe(false);
      expect(run(seed)).toEqual(names);
    }
  });

  it('speeds up over the round', () => {
    expect(courseSpeed(1, false)).toBeGreaterThan(courseSpeed(0, false));
    expect(courseSpeed(1, true)).toBeGreaterThan(courseSpeed(1, false));
  });
});

describe('Cloud Rider bumps and bursts', () => {
  it('a burst rams a rider who is not guarded; two bursts clash; nothing else happens', () => {
    expect(resolveBump({ bursting: true, guarded: false }, { bursting: false, guarded: false })).toBe('a');
    expect(resolveBump({ bursting: false, guarded: false }, { bursting: true, guarded: false })).toBe('b');
    expect(resolveBump({ bursting: true, guarded: false }, { bursting: true, guarded: false })).toBe('clash');
    expect(resolveBump({ bursting: true, guarded: false }, { bursting: false, guarded: true })).toBeNull();
    expect(resolveBump({ bursting: false, guarded: false }, { bursting: false, guarded: false })).toBeNull();
  });

  it('knocks loose at most what a rider has', () => {
    expect(ringsLost(0, 'bump')).toBe(0);
    expect(ringsLost(1, 'bump')).toBe(1);
    expect(ringsLost(10, 'bump')).toBe(3);
    expect(ringsLost(10, 'zap')).toBe(2);
  });

  it('gives even a tap some push, and a full charge the most', () => {
    expect(burstPower(0)).toBeGreaterThan(0.3);
    expect(burstPower(1)).toBe(1);
    expect(burstPower(2)).toBe(1);
    expect(burstPower(0.5)).toBeGreaterThan(burstPower(0.2));
  });
});
