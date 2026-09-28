import { describe, expect, it } from 'vitest';
import { CPU_SKILL_TABLE } from './heroes-fixtures';
import {
  buildCourse,
  COURSE_LEN,
  judgeRelease,
  newBrain,
  newEvents,
  newSwinger,
  pickAnchor,
  raceScore,
  stepSwinger,
  SWING,
  swingCpu,
  type Course,
  type Swinger,
  type SwingInput,
} from '../../src/game/worlds/heroes/swingRules';
import { Random } from '../../src/game/util/Random';

const DT = 1000 / 60;

describe('web swing: the course', () => {
  it('leads to the finish with every gap in reach of a web', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const c = buildCourse(new Random(seed));
      expect(c.finish).toBe(COURSE_LEN);
      for (let i = 1; i < c.anchors.length; i++) {
        const a = c.anchors[i - 1];
        const b = c.anchors[i];
        expect(b.x).toBeGreaterThan(a.x);
        expect(b.x - a.x).toBeLessThanOrEqual(600);
        expect(b.y).toBeGreaterThanOrEqual(200);
        expect(b.y).toBeLessThanOrEqual(430);
      }
      // The first anchor can be webbed from the start rooftop.
      expect(pickAnchor(c.anchors, 400, SWING.ROOF_Y - SWING.BODY)).toBeGreaterThanOrEqual(0);
    }
  });

  it('judges releases by the angle of travel', () => {
    const at = (deg: number, v = 1000) => judgeRelease(Math.cos((deg * Math.PI) / 180) * v, -Math.sin((deg * Math.PI) / 180) * v);
    expect(at(16)).toBe('perfect');
    expect(at(38)).toBe('good');
    expect(at(-20)).toBe('early');
    expect(at(62)).toBe('late');
    expect(judgeRelease(-300, -300)).toBe('back');
  });

  it('scores finishers by time, then the rest by distance', () => {
    expect(raceScore(true, 30000, 0).score).toBeGreaterThan(raceScore(true, 31000, 0).score);
    expect(raceScore(true, 49000, 0).score).toBeGreaterThan(raceScore(false, 0, COURSE_LEN - 1).score);
    expect(raceScore(false, 0, 9000).score).toBeGreaterThan(raceScore(false, 0, 8000).score);
  });
});

describe('web swing: swinging', () => {
  it('webs an anchor from the roof, swings forward and flies on when released', () => {
    const course = buildCourse(new Random(4));
    const s = newSwinger(400);
    const ev = newEvents();
    stepSwinger(s, { stickX: 1, holdA: true, pressA: true }, course, DT, ev);
    expect(s.mode).toBe('swing');
    expect(ev.attach).toBeGreaterThan(0);
    let t = 0;
    while (t < 3000 && !(s.vx > 300 && s.vy < -100)) {
      stepSwinger(s, { stickX: 1, holdA: true, pressA: false }, course, DT, ev);
      t += DT;
    }
    expect(s.vx).toBeGreaterThan(300);
    stepSwinger(s, { stickX: 1, holdA: false, pressA: false }, course, DT, ev);
    expect(s.mode).toBe('air');
    expect(ev.release === 'perfect' || ev.release === 'good').toBe(true);
  });

  it('drops to the street without a web, then zips back up', () => {
    const course = buildCourse(new Random(4));
    const s: Swinger = { ...newSwinger(3000), mode: 'air', y: 600, vx: 200, vy: 0 };
    const ev = newEvents();
    let downed = false;
    let up = false;
    for (let t = 0; t < 3000 && !up; t += DT) {
      stepSwinger(s, { stickX: 0, holdA: false, pressA: false }, course, DT, ev);
      downed ||= ev.down > 0;
      up ||= ev.up;
    }
    expect(downed).toBe(true);
    expect(up).toBe(true);
    expect(s.mode).toBe('air');
    expect(s.y).toBeLessThan(SWING.STREET_Y - 300);
  });
});

type Level = 'easy' | 'normal' | 'hard';

/** One CPU racing the course alone: its finish time (ms), or its distance when the 50 s run out. */
function race(level: Level, seed: number, course: Course): { done: boolean; t: number; x: number; falls: number; perfect: number } {
  const rng = new Random(seed * 7 + 1);
  const rnd = () => rng.next();
  const s = newSwinger(300);
  const b = newBrain();
  const ev = newEvents();
  const inp: SwingInput = { stickX: 0, holdA: false, pressA: false };
  let falls = 0;
  let perfect = 0;
  for (let t = 0; t < 50000; t += DT) {
    swingCpu(b, s, course, CPU_SKILL_TABLE[level], DT, rnd, inp);
    stepSwinger(s, inp, course, DT, ev);
    if (ev.down) falls++;
    if (ev.release === 'perfect') perfect++;
    if (s.mode === 'done') return { done: true, t, x: s.x, falls, perfect };
  }
  return { done: false, t: 50000, x: s.x, falls, perfect };
}

describe('web swing: CPU swingers', () => {
  it('race the course at every difficulty, the better ones faster', () => {
    const levels: Level[] = ['easy', 'normal', 'hard'];
    const stats = Object.fromEntries(levels.map((l) => [l, { t: 0, x: 0, done: 0, falls: 0, perfect: 0, n: 0 }]));
    for (let seed = 1; seed <= 10; seed++) {
      const course = buildCourse(new Random(seed));
      for (const l of levels) {
        const r = race(l, seed, course);
        const st = stats[l];
        st.t += r.t;
        st.x += r.x;
        st.done += r.done ? 1 : 0;
        st.falls += r.falls;
        st.perfect += r.perfect;
        st.n++;
      }
    }
    const avg = (l: Level) => ({ t: Math.round(stats[l].t / stats[l].n), x: Math.round(stats[l].x / stats[l].n), done: stats[l].done / stats[l].n, falls: stats[l].falls / stats[l].n, perfect: stats[l].perfect / stats[l].n });
    const easy = avg('easy');
    const normal = avg('normal');
    const hard = avg('hard');
    // eslint-disable-next-line no-console
    console.log('swing CPU averages:', { easy, normal, hard });
    expect(hard.done).toBeGreaterThanOrEqual(0.9);
    expect(normal.done).toBeGreaterThanOrEqual(0.6);
    expect(hard.t).toBeLessThan(normal.t);
    expect(normal.t).toBeLessThan(easy.t);
    expect(easy.x).toBeGreaterThan(COURSE_LEN * 0.6);
    expect(hard.t).toBeGreaterThan(24000);
  });
});
