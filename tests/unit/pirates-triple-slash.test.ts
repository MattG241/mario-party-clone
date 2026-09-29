import { describe, expect, it } from 'vitest';
import { Random } from '../../src/game/util/Random';
import { beatTimes, buildChart, chutesFor, comboMult, HARBOUR, judge, laneAt, laneX, project, slicePoints, WINDOW } from '../../src/game/worlds/pirates/games/tripleSlashRules';

const BEAT = 60000 / 140;
const opts = { duration: 40000, beat: BEAT, fastBeat: BEAT / 1.12, fastFrom: 30000, start: 2200 };

describe('triple slash: the harbour camera', () => {
  it('puts the cut line, the players and the ship where the arena draws them', () => {
    const cut = project(0, HARBOUR.yCut, HARBOUR.floorZ);
    const feet = project(0, HARBOUR.yNear, HARBOUR.floorZ);
    const far = project(0, HARBOUR.yFar, HARBOUR.floorZ);
    expect(cut.y).toBeGreaterThan(740);
    expect(cut.y).toBeLessThan(780);
    expect(feet.y).toBeGreaterThan(990);
    expect(feet.y).toBeLessThan(1020);
    expect(far.y).toBeGreaterThan(310);
    expect(far.y).toBeLessThan(345);
    // things grow as they come closer
    expect(feet.s).toBeGreaterThan(cut.s);
    expect(cut.s).toBeGreaterThan(far.s * 3);
  });

  it('keeps every chute on screen and its lanes apart', () => {
    for (let c = 0; c < 4; c++) {
      for (const Y of [HARBOUR.yNear, HARBOUR.yCut, HARBOUR.yFar]) {
        const l = project(laneX(c, 0, Y), Y, HARBOUR.floorZ);
        const r = project(laneX(c, 2, Y), Y, HARBOUR.floorZ);
        expect(l.x).toBeGreaterThan(0);
        expect(r.x).toBeLessThan(1920);
        expect(r.x - l.x).toBeGreaterThan(Y === HARBOUR.yFar ? 30 : 150);
      }
    }
    expect(chutesFor(1)).toEqual([1]);
    expect(chutesFor(2)).toEqual([1, 2]);
    expect(chutesFor(4)).toEqual([0, 1, 2, 3]);
  });
});

describe('triple slash: the chart', () => {
  const chart = buildChart(() => new Random(7).next(), opts);
  const rng = new Random(11);
  const real = buildChart(() => rng.next(), opts);

  it('is sorted, inside the round, and uses every lane', () => {
    expect(chart.length).toBeGreaterThan(10);
    expect(real.length).toBeGreaterThan(45);
    expect(real.length).toBeLessThan(140);
    for (let i = 1; i < real.length; i++) expect(real[i].t).toBeGreaterThanOrEqual(real[i - 1].t);
    expect(real[0].t).toBeGreaterThanOrEqual(opts.start);
    expect(real[real.length - 1].t).toBeLessThan(opts.duration);
    expect(new Set(real.map((n) => n.lane)).size).toBe(3);
  });

  it('never crowds one lane, and never puts a bomb in a triple', () => {
    for (let lane = 0; lane < 3; lane++) {
      const ts = real.filter((n) => n.lane === lane).map((n) => n.t);
      for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(BEAT / 1.12 * 0.45 - 1);
    }
    const byTime = new Map<number, number>();
    for (const n of real) byTime.set(n.t, (byTime.get(n.t) ?? 0) + 1);
    for (const n of real) if (byTime.get(n.t) === 3) expect(n.kind).not.toBe('bomb');
  });

  it('gets busier as the round goes on', () => {
    const early = real.filter((n) => n.t < 10000).length;
    const late = real.filter((n) => n.t >= 30000).length;
    expect(late).toBeGreaterThan(early);
    expect(real.some((n) => n.kind === 'bomb')).toBe(true);
    expect(real.some((n) => n.kind === 'fish')).toBe(true);
  });

  it('lands every crossing on a drum beat (or exactly between two)', () => {
    const beats = beatTimes(opts);
    expect(beats[0]).toBeLessThan(opts.start);
    for (const n of real) {
      const i = beats.findIndex((b) => b >= n.t - 1);
      const onBeat = Math.abs(beats[i] - n.t) <= 1;
      const half = i > 0 && Math.abs((beats[i - 1] + beats[i]) / 2 - n.t) <= 1;
      expect(onBeat || half, `note at ${n.t}`).toBe(true);
    }
  });

  it('lets a fish hop only to a neighbouring lane', () => {
    for (const n of real) expect(Math.abs(n.from - n.lane)).toBeLessThanOrEqual(1);
    const hop = { t: 0, lane: 2, kind: 'fish' as const, from: 1 };
    expect(laneAt(hop, 0)).toBe(1);
    expect(laneAt(hop, 1)).toBe(2);
    expect(laneAt(hop, 0.55)).toBeGreaterThan(1);
    expect(laneAt(hop, 0.55)).toBeLessThan(2);
  });
});

describe('triple slash: timing and points', () => {
  it('grades a slash by how close it is to the crossing', () => {
    expect(judge(0)).toBe('perfect');
    expect(judge(-WINDOW.perfect)).toBe('perfect');
    expect(judge(WINDOW.perfect + 1)).toBe('good');
    expect(judge(-WINDOW.good)).toBe('good');
    expect(judge(WINDOW.ok)).toBe('ok');
    expect(judge(WINDOW.ok + 1)).toBeNull();
  });

  it('multiplies by the combo and rewards fish and gold', () => {
    expect(comboMult(0)).toBe(1);
    expect(comboMult(5)).toBe(2);
    expect(comboMult(15)).toBe(3);
    expect(comboMult(30)).toBe(4);
    expect(slicePoints('perfect', 'barrel', 1)).toBe(3);
    expect(slicePoints('good', 'fish', 1)).toBe(3);
    expect(slicePoints('perfect', 'gold', 5)).toBe(12);
  });
});
