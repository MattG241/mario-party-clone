import { describe, expect, it } from 'vitest';
import { CPU_SKILL_TABLE } from './heroes-fixtures';
import {
  blastHits,
  chargeLevel,
  comboMult,
  KINDS,
  makeTarget,
  maxTargets,
  newBrain,
  newGunner,
  padX,
  pickKind,
  RANGE,
  rangeCpu,
  scoreHits,
  spawnInterval,
  stepGunner,
  stepTarget,
  type RangeInput,
  type Target,
  type TargetKind,
} from '../../src/game/worlds/heroes/rangeRules';
import { Random } from '../../src/game/util/Random';

const DT = 1000 / 60;

describe('repulsor range: rules', () => {
  it('spreads the hover pads across the deck for any number of players', () => {
    for (let n = 1; n <= 4; n++) {
      const xs = Array.from({ length: n }, (_, i) => padX(i, n));
      for (let i = 1; i < n; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1] + 250);
      expect(xs.reduce((a, b) => a + b, 0) / n).toBeCloseTo(960, 0);
    }
  });

  it('fires a quick blast on the press and a charged one on release after holding', () => {
    const g = newGunner(960);
    const shot = stepGunner(g, { stickX: 0, stickY: 0, holdA: true, pressA: true }, DT);
    expect(shot?.kind).toBe('quick');
    let big = null;
    for (let t = 0; t < 1200; t += DT) stepGunner(g, { stickX: 0, stickY: 0, holdA: true, pressA: false }, DT);
    big = stepGunner(g, { stickX: 0, stickY: 0, holdA: false, pressA: false }, DT);
    expect(big?.kind).toBe('big');
    expect(big?.r).toBeCloseTo(RANGE.BIG_R1, 0);
    // A short tap never becomes a big blast.
    const h = newGunner(960);
    stepGunner(h, { stickX: 0, stickY: 0, holdA: true, pressA: true }, DT);
    stepGunner(h, { stickX: 0, stickY: 0, holdA: true, pressA: false }, DT);
    expect(stepGunner(h, { stickX: 0, stickY: 0, holdA: false, pressA: false }, DT)).toBeNull();
    expect(chargeLevel(RANGE.CHARGE_DELAY)).toBe(0);
    expect(chargeLevel(RANGE.CHARGE_DELAY + RANGE.CHARGE_MS)).toBe(1);
  });

  it('builds combos with hits, and a balloon costs points and the combo', () => {
    const g = newGunner(960);
    let total = 0;
    for (let i = 0; i < 12; i++) total += scoreHits(g, [{ kind: 'drone', killed: true, bullseye: false }]).points;
    expect(g.combo).toBe(12);
    expect(comboMult(12)).toBe(3);
    expect(total).toBe(5 * 1 + 6 * 2 + 1 * 3);
    const r = scoreHits(g, [{ kind: 'balloon', killed: false, bullseye: false }]);
    expect(r.balloon).toBe(true);
    expect(r.points).toBe(-RANGE.BALLOON_COST);
    expect(g.combo).toBe(0);
    expect(comboMult(100)).toBe(RANGE.COMBO_MAX);
  });

  it('flies every kind of target through the range and out again', () => {
    const rng = new Random(9);
    const rnd = () => rng.next();
    for (const kind of ['drone', 'zip', 'heavy', 'disc', 'gold', 'balloon'] as TargetKind[]) {
      const t = makeTarget(kind, rnd);
      let seen = false;
      let alive = true;
      for (let ms = 0; ms < 40000 && alive; ms += DT) {
        alive = stepTarget(t, DT, rnd);
        if (t.x > RANGE.X0 && t.x < RANGE.X1 && t.y > RANGE.Y0 - 80 && t.y < RANGE.DECK_Y) seen = true;
      }
      expect(seen, kind).toBe(true);
      expect(alive, kind).toBe(false);
    }
  });

  it('only hits what the blast touches, and a startled balloon is safe for a moment', () => {
    const rnd = () => 0.5;
    const t = makeTarget('drone', rnd);
    t.x = 500;
    t.y = 400;
    expect(blastHits(t, 500 + KINDS.drone.r, 400, RANGE.QUICK_R)).toBe(true);
    expect(blastHits(t, 500 + KINDS.drone.r + RANGE.QUICK_R + 10, 400, RANGE.QUICK_R)).toBe(false);
    const b = makeTarget('balloon', rnd);
    b.x = 700;
    b.y = 400;
    b.safe = 300;
    expect(blastHits(b, 700, 400, 100)).toBe(false);
  });

  it('keeps the schedule sensible', () => {
    expect(spawnInterval(4, false)).toBeLessThan(spawnInterval(2, false));
    expect(spawnInterval(2, true)).toBeLessThan(spawnInterval(2, false));
    expect(maxTargets(4, true)).toBeGreaterThan(maxTargets(4, false));
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const k = pickKind(i / 1000, false);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts.drone).toBeGreaterThan(counts.heavy);
    expect(counts.gold).toBeGreaterThan(0);
  });
});

type Level = 'easy' | 'normal' | 'hard';

/** A 45 s round of CPU marksmen (the scene's spawning and hit rules, without the visuals). */
function simulate(levels: readonly Level[], seed: number): { score: number[]; balloons: number[] } {
  const rng = new Random(seed);
  const rnd = () => rng.next();
  const n = levels.length;
  const gunners = levels.map((_, i) => newGunner(padX(i, n)));
  const brains = levels.map(() => newBrain());
  const inputs: RangeInput[] = levels.map(() => ({ stickX: 0, stickY: 0, holdA: false, pressA: false }));
  const score = levels.map(() => 0);
  const balloons = levels.map(() => 0);
  const targets: Target[] = [];
  const claimed = new Set<number>();
  let spawnT = 600;
  let balloonT = 2500;
  for (let t = 0; t < 45000; t += DT) {
    const storm = t > 35000;
    spawnT -= DT;
    balloonT -= DT;
    const live = targets.filter((q) => q.kind !== 'balloon').length;
    if (spawnT <= 0) {
      spawnT = spawnInterval(n, storm);
      if (live < maxTargets(n, storm)) targets.push(makeTarget(pickKind(rnd(), storm), rnd));
    }
    if (balloonT <= 0) {
      balloonT = 3600 + rnd() * 1400;
      if (targets.filter((q) => q.kind === 'balloon').length < 3) targets.push(makeTarget('balloon', rnd));
    }
    for (let i = targets.length - 1; i >= 0; i--) if (!stepTarget(targets[i], DT, rnd) || targets[i].dead) targets.splice(i, 1);
    for (let i = 0; i < n; i++) {
      claimed.clear();
      brains.forEach((b, j) => j !== i && b.tid >= 0 && claimed.add(b.tid));
      rangeCpu(brains[i], gunners[i], targets, claimed, CPU_SKILL_TABLE[levels[i]], DT, rnd, inputs[i]);
      const shot = stepGunner(gunners[i], inputs[i], DT);
      if (!shot) continue;
      const hits: { kind: TargetKind; killed: boolean; bullseye: boolean }[] = [];
      for (const q of targets) {
        if (!blastHits(q, shot.x, shot.y, shot.r)) continue;
        if (q.kind === 'balloon') {
          q.safe = RANGE.BALLOON_SAFE_MS;
          hits.push({ kind: 'balloon', killed: false, bullseye: false });
          continue;
        }
        q.hp -= shot.kind === 'big' ? 3 : 1;
        const killed = q.hp <= 0;
        if (killed) q.dead = true;
        hits.push({ kind: q.kind, killed, bullseye: false });
      }
      const r = scoreHits(gunners[i], hits);
      score[i] = Math.max(0, score[i] + r.points);
      if (r.balloon) balloons[i]++;
    }
  }
  return { score, balloons };
}

describe('repulsor range: CPU marksmen', () => {
  it('score at every difficulty, the better ones more, and rarely hit balloons', () => {
    const lobby: Level[] = ['hard', 'normal', 'easy', 'easy'];
    const tot = { hard: { s: 0, b: 0, n: 0 }, normal: { s: 0, b: 0, n: 0 }, easy: { s: 0, b: 0, n: 0 } };
    for (let seed = 1; seed <= 8; seed++) {
      const rot = seed % 4;
      const levels = lobby.map((_, i) => lobby[(i + rot) % 4]);
      const r = simulate(levels, seed);
      levels.forEach((lv, i) => {
        tot[lv].s += r.score[i];
        tot[lv].b += r.balloons[i];
        tot[lv].n++;
      });
    }
    const avg = (lv: Level) => ({ score: tot[lv].s / tot[lv].n, balloons: tot[lv].b / tot[lv].n });
    const easy = avg('easy');
    const normal = avg('normal');
    const hard = avg('hard');
    // eslint-disable-next-line no-console
    console.log('range CPU averages:', { easy, normal, hard });
    expect(easy.score).toBeGreaterThan(8);
    expect(normal.score).toBeGreaterThan(easy.score);
    expect(hard.score).toBeGreaterThan(normal.score);
    expect(hard.balloons).toBeLessThan(easy.balloons + 0.3);
    expect(hard.balloons).toBeLessThan(1.2);
  });
});
