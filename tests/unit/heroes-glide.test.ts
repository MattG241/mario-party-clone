import { describe, expect, it } from 'vitest';
import { CPU_SKILL_TABLE } from './heroes-fixtures';
import {
  BEAM_HALF,
  CATCH_MS,
  clueInterval,
  GLIDE,
  glideCpu,
  inBeam,
  LAMPS,
  maxClues,
  newBeams,
  newBrain,
  newEvents,
  newFlyer,
  roofAt,
  ROOFS,
  spot,
  stepBeams,
  stepFlyer,
  tokenSpot,
  VENTS,
  type Flyer,
  type FlyInput,
  type GlideClue,
} from '../../src/game/worlds/heroes/glideRules';
import { Random } from '../../src/game/util/Random';

const DT = 1000 / 60;

function fly(f: Flyer, inp: Partial<FlyInput>, ms: number): void {
  const ev = newEvents();
  const full: FlyInput = { stickX: 0, holdA: false, pressA: false, ...inp };
  for (let t = 0; t < ms; t += DT) {
    stepFlyer(f, full, DT, ev);
    full.pressA = false;
  }
}

function airborne(x: number, y: number, mode: 'glide' | 'dive' = 'glide'): Flyer {
  const f = newFlyer(x);
  f.x = x;
  f.y = y;
  f.mode = mode;
  f.vx = 300;
  f.vy = mode === 'glide' ? GLIDE.SINK : 0;
  return f;
}

describe('rooftop glide: the skyline', () => {
  it('covers the whole width with roofs, and every vent and lamp sits on one', () => {
    for (let i = 1; i < ROOFS.length; i++) expect(ROOFS[i].x0).toBe(ROOFS[i - 1].x1);
    expect(ROOFS[0].x0).toBeLessThanOrEqual(0);
    expect(ROOFS[ROOFS.length - 1].x1).toBeGreaterThanOrEqual(1920);
    for (const v of VENTS) expect(roofAt(v.x)).toBe(v.y);
    for (const l of LAMPS) expect(roofAt(l.x)).toBeGreaterThan(l.y);
  });

  it('places clues in open sky, clear of each other', () => {
    const rng = new Random(3);
    const placed: { x: number; y: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const s = tokenSpot(() => rng.next(), placed, i % 4 === 0);
      expect(s.y).toBeGreaterThanOrEqual(GLIDE.CEIL);
      expect(s.y).toBeLessThan(roofAt(s.x) - 100);
      placed.push(s);
    }
  });
});

describe('rooftop glide: flight', () => {
  it('glides slowly with the cape open and dives fast without it', () => {
    const g = airborne(700, 300);
    fly(g, { holdA: true, stickX: 1 }, 1000);
    const d = airborne(700, 300, "dive");
    fly(d, { holdA: false, stickX: 1 }, 400);
    expect(g.y - 300).toBeLessThan(120);
    expect(g.x - 700).toBeGreaterThan(300);
    expect(d.y - 300).toBeGreaterThan(110);
    expect(d.vy).toBeGreaterThan(500);
  });

  it('swoops up when the cape opens out of a fast dive, without gaining height for free', () => {
    const f = airborne(300, 250, 'dive');
    fly(f, { holdA: false }, 400);
    const low = f.y;
    const ev = newEvents();
    stepFlyer(f, { stickX: 0, holdA: true, pressA: true }, DT, ev);
    expect(ev.swoop).toBeGreaterThan(0);
    expect(f.vy).toBeLessThan(0);
    let top = f.y;
    for (let t = 0; t < 800; t += DT) {
      stepFlyer(f, { stickX: 0, holdA: true, pressA: false }, DT, ev);
      top = Math.min(top, f.y);
    }
    expect(top).toBeLessThan(low - 40);
    expect(top).toBeGreaterThan(250);
  });

  it('rises in an updraft, hanging in it with the stick at rest', () => {
    const v = VENTS[1];
    const f = airborne(v.x, v.y - 200);
    f.vx = 0;
    fly(f, { holdA: true }, 1000);
    expect(f.y).toBeLessThan(v.y - 500);
    expect(Math.abs(f.x - v.x)).toBeLessThan(v.half);
  });

  it('lands on roofs, leaps off with A and bounces off taller walls', () => {
    const f = airborne(900, 700, 'dive');
    f.vx = 0;
    fly(f, {}, 1500);
    expect(f.mode).toBe('roof');
    expect(f.y + GLIDE.BODY).toBe(roofAt(900));
    fly(f, { holdA: true, pressA: true }, 200);
    expect(f.mode).toBe('glide');
    expect(f.y + GLIDE.BODY).toBeLessThan(roofAt(900) - 100);
    // Flying low into the side of the taller building on the right bounces back.
    const w = airborne(1120, roofAt(1120) - GLIDE.BODY - 20);
    w.vx = 400;
    const ev = newEvents();
    let bonked = false;
    for (let t = 0; t < 400; t += DT) {
      stepFlyer(w, { stickX: 1, holdA: true, pressA: false }, DT, ev);
      bonked ||= ev.bonk;
    }
    expect(bonked).toBe(true);
    expect(w.x).toBeLessThan(1152);
  });

  it('a searchlight catch dazes a glider, then keeps it safe for a while', () => {
    const f = airborne(600, 400);
    spot(f);
    expect(f.mode).toBe('stun');
    fly(f, { holdA: true }, GLIDE.STUN_MS + 50);
    expect(f.mode === 'glide' || f.mode === 'roof').toBe(true);
    expect(f.invuln).toBeGreaterThan(0);
  });

  it('beams catch what is inside the cone and nothing outside it', () => {
    const l = LAMPS[0];
    expect(inBeam(l, 0, l.x, l.y - 400)).toBe(true);
    expect(inBeam(l, 0, l.x + 400 * Math.tan(BEAM_HALF * 3), l.y - 400)).toBe(false);
    expect(inBeam(l, 0.5, l.x + 400 * Math.sin(0.5), l.y - 400 * Math.cos(0.5))).toBe(true);
  });
});

type Level = 'easy' | 'normal' | 'hard';

/** A 45 s round of four CPU gliders (the scene's clue and searchlight rules, without the visuals). */
function simulate(levels: readonly Level[], seed: number): { clues: number[]; spotted: number[] } {
  const rng = new Random(seed);
  const rnd = () => rng.next();
  const n = levels.length;
  const flyers = [300, 1620, 860, 1060].slice(0, n).map((x) => newFlyer(x));
  const brains = flyers.map(() => newBrain());
  const inputs: FlyInput[] = flyers.map(() => ({ stickX: 0, holdA: false, pressA: false }));
  const ev = newEvents();
  const beams = newBeams();
  const clues: GlideClue[] = [];
  let nextId = 1;
  let spawnT = 0;
  const score = flyers.map(() => 0);
  const spotted = flyers.map(() => 0);
  const lock = flyers.map(() => 0);
  const claimed = new Set<number>();
  for (let t = 0; t < 45000; t += DT) {
    const storm = t > 35000;
    stepBeams(beams, DT, storm ? 1.3 : 1);
    spawnT -= DT;
    if (spawnT <= 0 && clues.length < maxClues(n, storm)) {
      spawnT = clueInterval(n, storm);
      const gold = rng.chance(storm ? 0.22 : 0.12);
      const s = tokenSpot(rnd, clues, gold);
      clues.push({ id: nextId++, x: s.x, y: s.y, value: gold ? 3 : 1, life: gold ? 7000 : 9000 });
    }
    for (let i = 0; i < n; i++) {
      claimed.clear();
      brains.forEach((b, j) => j !== i && b.tid >= 0 && claimed.add(b.tid));
      const rivals = flyers.filter((_, j) => j !== i);
      glideCpu(brains[i], flyers[i], { clues, beams, beamSpeed: storm ? 1.3 : 1, claimed, rivals, lock: lock[i] }, CPU_SKILL_TABLE[levels[i]], DT, rnd, inputs[i]);
      stepFlyer(flyers[i], inputs[i], DT, ev);
      const f = flyers[i];
      if (f.invuln <= 0 && f.mode !== 'stun') {
        const lit = beams.some((b) => inBeam(b.lamp, b.angle, f.x, f.y));
        lock[i] = lit ? lock[i] + DT : 0;
        if (lock[i] >= CATCH_MS) {
          lock[i] = 0;
          spot(f);
          spotted[i]++;
          if (score[i] > 0) score[i]--;
        }
      }
    }
    // As in the scene: each clue goes to the nearest glider in reach (never a dazed one).
    for (let c = clues.length - 1; c >= 0; c--) {
      let best = -1;
      let bestD: number = GLIDE.REACH;
      flyers.forEach((f, i) => {
        if (f.mode === 'stun') return;
        const d = Math.hypot(clues[c].x - f.x, clues[c].y - f.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        score[best] += clues[c].value;
        clues.splice(c, 1);
      }
    }
    for (let c = clues.length - 1; c >= 0; c--) {
      clues[c].life -= DT;
      if (clues[c].life <= 0) clues.splice(c, 1);
    }
  }
  return { clues: score, spotted };
}

describe('rooftop glide: CPU pilots', () => {
  it('collect clues at every difficulty; better pilots get more and are caught less', () => {
    // A mixed lobby, every pilot taking each starting roof in turn.
    const lobby: Level[] = ['hard', 'normal', 'easy', 'easy'];
    const total = { hard: { clues: 0, spotted: 0, n: 0 }, normal: { clues: 0, spotted: 0, n: 0 }, easy: { clues: 0, spotted: 0, n: 0 } };
    for (let seed = 1; seed <= 12; seed++) {
      const rot = seed % 4;
      const levels = lobby.map((_, i) => lobby[(i + rot) % 4]);
      const r = simulate(levels, seed);
      levels.forEach((lv, i) => {
        total[lv].clues += r.clues[i];
        total[lv].spotted += r.spotted[i];
        total[lv].n++;
      });
    }
    const avg = (lv: Level) => ({ clues: total[lv].clues / total[lv].n, spotted: total[lv].spotted / total[lv].n });
    const easy = avg('easy');
    const normal = avg('normal');
    const hard = avg('hard');
    // eslint-disable-next-line no-console
    console.log('glide CPU averages (clues, times spotted):', { easy, normal, hard });
    expect(easy.clues).toBeGreaterThan(4);
    expect(normal.clues).toBeGreaterThan(easy.clues * 1.2);
    expect(hard.clues).toBeGreaterThan(normal.clues * 0.9);
    expect(hard.spotted).toBeLessThan(easy.spotted);
    expect(normal.spotted).toBeLessThan(easy.spotted + 0.5);
    expect(hard.spotted).toBeLessThan(4.5);
  });

  it('give equal pilots an even chance from every starting roof', () => {
    const seats = [0, 0, 0, 0];
    for (let seed = 1; seed <= 16; seed++) {
      const r = simulate(['normal', 'normal', 'normal', 'normal'], seed);
      r.clues.forEach((v, i) => (seats[i] += v / 16));
    }
    // eslint-disable-next-line no-console
    console.log('glide seats:', seats.map((v) => v.toFixed(1)));
    const mean = seats.reduce((a, b) => a + b, 0) / 4;
    for (const v of seats) expect(Math.abs(v - mean) / mean).toBeLessThan(0.25);
  });

  it('play a two-player round sensibly too', () => {
    const r = simulate(['normal', 'normal'], 11);
    for (const c of r.clues) expect(c).toBeGreaterThan(5);
  });
});
