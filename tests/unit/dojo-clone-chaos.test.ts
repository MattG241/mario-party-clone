import { describe, expect, it } from 'vitest';
import { ROWS, SPOTS, START_SPOT } from '../../src/game/worlds/dojo/games/cloneChaosLayout';
import {
  applyStep,
  initialOccupancy,
  leapsOf,
  navFrom,
  navToward,
  pickPoints,
  planShuffle,
  ROUNDS,
  roundPlan,
  spotOf,
  trackStep,
  type Occupancy,
} from '../../src/game/worlds/dojo/games/cloneChaosRules';
import { Random } from '../../src/game/util/Random';

const cloneIds = (occ: Occupancy) => occ.filter((c) => c >= 0).sort((a, b) => a - b);

describe('Clone Chaos layout', () => {
  it('has a spot per ridge, in rows back to front, and starts the markers in the middle', () => {
    expect(SPOTS.length).toBe(ROWS.reduce((n, r) => n + r.xs.length, 0));
    expect(new Set(SPOTS.map((s) => s.id)).size).toBe(SPOTS.length);
    for (let i = 1; i < ROWS.length; i++) expect(ROWS[i].y).toBeGreaterThan(ROWS[i - 1].y);
    expect(SPOTS[START_SPOT].row).toBe(1);
    expect(SPOTS[START_SPOT].x).toBe(960);
  });
});

describe('Clone Chaos rounds', () => {
  it('get busier and faster, and only the last counts double', () => {
    for (let r = 1; r <= ROUNDS; r++) {
      const p = roundPlan(r);
      expect(p.clones).toBeLessThanOrEqual(SPOTS.length - 3);
      expect(p.double).toBe(r === ROUNDS);
      if (r > 1) {
        const q = roundPlan(r - 1);
        expect(p.clones).toBeGreaterThanOrEqual(q.clones);
        expect(p.moveMs).toBeLessThan(q.moveMs);
        expect(p.tricks.length).toBeGreaterThanOrEqual(q.tricks.length);
      }
    }
    expect(roundPlan(1).tricks).toEqual([]);
  });

  it('start with every clone on its own spot, every row used, the real ninja among them', () => {
    for (let seed = 1; seed < 40; seed++) {
      const n = roundPlan((seed % ROUNDS) + 1).clones;
      const occ = initialOccupancy(new Random(seed), n);
      expect(cloneIds(occ)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(spotOf(occ, 0)).toBeGreaterThanOrEqual(0);
      for (let row = 0; row < ROWS.length; row++) expect(SPOTS.some((s) => s.row === row && occ[s.id] >= 0)).toBe(true);
    }
  });

  it('shuffle clones only between valid spots, keep every clone, and move the real one often', () => {
    let realMoves = 0;
    let moves = 0;
    for (let seed = 1; seed < 60; seed++) {
      const rng = new Random(seed);
      const plan = roundPlan((seed % ROUNDS) + 1);
      const occ = initialOccupancy(rng, plan.clones);
      const steps = planShuffle(rng, plan, occ);
      expect(steps.length).toBe(plan.moves);
      const cur = occ.slice();
      let tricks = 0;
      for (const s of steps) {
        expect(plan.kinds).toContain(s.kind);
        for (const id of s.spots) expect(id >= 0 && id < SPOTS.length).toBe(true);
        expect(new Set(s.spots).size).toBe(s.spots.length);
        const leaps = leapsOf(cur, s);
        for (const l of leaps) expect(l.clone).toBeGreaterThanOrEqual(0);
        if (s.kind === 'hop') expect(cur[s.spots[1]]).toBe(-1);
        if (leaps.some((l) => l.clone === 0)) realMoves++;
        moves++;
        if (s.trick) {
          tricks++;
          expect(plan.tricks).toContain(s.trick);
          if (s.trick === 'decoy') expect(s.spots).not.toContain(s.decoy);
        }
        applyStep(cur, s);
        expect(cloneIds(cur)).toEqual(cloneIds(occ));
      }
      expect(tricks).toBeLessThanOrEqual(2);
    }
    expect(realMoves / moves).toBeGreaterThan(0.4);
  });

  it('never simply undo the swap just made', () => {
    for (let seed = 1; seed < 40; seed++) {
      const rng = new Random(seed);
      const plan = roundPlan(1);
      const steps = planShuffle(rng, plan, initialOccupancy(rng, plan.clones));
      for (let i = 1; i < steps.length; i++) {
        const a = [...steps[i - 1].spots].sort().join();
        const b = [...steps[i].spots].sort().join();
        if (steps[i].kind === 'swap' && steps[i - 1].kind === 'swap') expect(b).not.toBe(a);
      }
    }
  });
});

describe('Clone Chaos CPUs and scoring', () => {
  it('a flawless watcher always ends on the real ninja; a careless one often does not', () => {
    let careless = 0;
    let runs = 0;
    for (let seed = 1; seed < 80; seed++) {
      const rng = new Random(seed);
      const plan = roundPlan(5);
      const occ = initialOccupancy(rng, plan.clones);
      const steps = planShuffle(rng, plan, occ);
      const r2 = new Random(seed * 7);
      let perfect = 0;
      let sloppy = 0;
      const cur = occ.slice();
      for (const s of steps) {
        perfect = trackStep(perfect, cur, s, plan, 0, () => r2.next());
        sloppy = trackStep(sloppy, cur, s, plan, 0.3, () => r2.next());
        applyStep(cur, s);
      }
      expect(perfect).toBe(0);
      runs++;
      if (sloppy !== 0) careless++;
    }
    expect(careless / runs).toBeGreaterThan(0.2);
  });

  it('score 2 for a right pick plus up to 3 for speed, double in the final round, nothing when wrong', () => {
    expect(pickPoints(false, 100, false)).toBe(0);
    expect(pickPoints(true, 0, false)).toBe(5);
    expect(pickPoints(true, 1100, false)).toBe(5);
    expect(pickPoints(true, 1500, false)).toBe(4);
    expect(pickPoints(true, 3000, false)).toBe(3);
    expect(pickPoints(true, 4000, false)).toBe(2);
    expect(pickPoints(true, null, false)).toBe(2);
    expect(pickPoints(true, 0, true)).toBe(10);
  });

  it('markers step between clones in the pushed direction and can reach any clone', () => {
    const all = SPOTS.map((s) => s.id);
    // along a row
    const mid = SPOTS.filter((s) => s.row === 1).map((s) => s.id);
    expect(navFrom(mid[2], 'left', all)).toBe(mid[1]);
    expect(navFrom(mid[2], 'right', all)).toBe(mid[3]);
    expect(navFrom(mid[0], 'left', all)).toBe(mid[0]);
    // between rows: up goes to the back row, down to the front
    expect(SPOTS[navFrom(mid[2], 'up', all)].row).toBe(0);
    expect(SPOTS[navFrom(mid[2], 'down', all)].row).toBe(2);
    for (let seed = 1; seed < 30; seed++) {
      const occ = initialOccupancy(new Random(seed), roundPlan((seed % ROUNDS) + 1).clones);
      const taken = occ.map((c, id) => (c >= 0 ? id : -1)).filter((id) => id >= 0);
      for (const from of taken) {
        for (const to of taken) {
          let at = from;
          for (let k = 0; k < 12 && at !== to; k++) {
            const d = navToward(at, to, taken);
            if (!d) break;
            at = navFrom(at, d, taken);
          }
          expect(at, `${from} -> ${to}`).toBe(to);
        }
      }
    }
  });
});
