// Cloud Rider's rules, free of Phaser so they can be unit tested: the sky course's patterns (ring
// trails, energy orbs, storm clouds and wind gusts), the course speed, what things are worth and who
// bumps whom when two riders collide.
import type { Random } from '../../../util/Random';

/** Screen band the collectibles and storms use (their centres), and where new patterns appear. */
export const COURSE = {
  /** Highest and lowest ring centres. */
  top: 200,
  bottom: 800,
  /** Storm clouds keep their centres inside this band (so there is always room above or below). */
  stormTop: 230,
  stormBottom: 780,
  /** New patterns start this far right (off screen, so storm and gust warnings get time to show). */
  spawnX: 2780,
  /** Gap between rings in a trail (px). */
  ringGap: 108,
} as const;

export const WORTH = { ring: 1, orb: 3 } as const;
/** Half the distance between the two storms of a corridor (their centres). */
const STORM_GAP = 185;
/** Rings knocked loose from a rider who is rammed / zapped (never more than they have). */
export const DROP = { bump: 2, zap: 1 } as const;
/** Bonus for flying through every ring of a trail of at least PERFECT_MIN rings on your own. */
export const PERFECT_BONUS = 2;
export const PERFECT_MIN = 5;

export type ItemKind = 'ring' | 'orb' | 'storm';

export interface CourseItem {
  kind: ItemKind;
  /** Distance behind the pattern's leading edge (px). */
  dx: number;
  y: number;
  /** Ring trail it belongs to, within the pattern (-1 for none). */
  trail: number;
}

export interface GustPlan {
  /** Band centre and half-height (screen px). */
  y: number;
  half: number;
  /** -1 blows upwards, 1 downwards. */
  dir: -1 | 1;
  /** It should be blowing when the course has advanced this far past the pattern's start (px). */
  atDx: number;
}

export interface CoursePattern {
  name: string;
  items: CourseItem[];
  /** Course length the pattern occupies before the next may begin (px). */
  length: number;
  gust?: GustPlan;
}

/** Course speed (px/s) at round progress t (0..1); the final stretch runs a little faster. */
export function courseSpeed(t: number, rush: boolean): number {
  const k = Math.min(1, Math.max(0, t));
  return 560 + 150 * k + (rush ? 50 : 0);
}

export function clampY(y: number, lo: number = COURSE.top, hi: number = COURSE.bottom): number {
  return Math.min(hi, Math.max(lo, y));
}

function trailPts(ys: number[], trail: number, dx0 = 0): CourseItem[] {
  return ys.map((y, i) => ({ kind: 'ring' as const, dx: dx0 + i * COURSE.ringGap, y: clampY(y), trail }));
}

function line(y: number, n: number, trail: number, dx0 = 0): CourseItem[] {
  return trailPts(Array.from({ length: n }, () => y), trail, dx0);
}

function arc(y: number, n: number, amp: number, trail: number, dx0 = 0): CourseItem[] {
  return trailPts(Array.from({ length: n }, (_, i) => y - amp * Math.sin((Math.PI * i) / (n - 1))), trail, dx0);
}

function wave(y: number, n: number, amp: number, periods: number, trail: number, dx0 = 0): CourseItem[] {
  return trailPts(Array.from({ length: n }, (_, i) => y + amp * Math.sin((Math.PI * 2 * periods * i) / (n - 1))), trail, dx0);
}

function dive(y0: number, y1: number, n: number, trail: number, dx0 = 0): CourseItem[] {
  return trailPts(Array.from({ length: n }, (_, i) => y0 + ((y1 - y0) * i) / (n - 1)), trail, dx0);
}

const span = (items: CourseItem[]) => items.reduce((m, it) => Math.max(m, it.dx), 0);
const mid = (COURSE.top + COURSE.bottom) / 2;

/** Heights for k trails spread over the band, jittered. */
function lanes(rng: Random, k: number): number[] {
  const out: number[] = [];
  const h = COURSE.bottom - COURSE.top;
  for (let i = 0; i < k; i++) out.push(COURSE.top + ((i + 0.5) / k) * h + rng.range(-40, 40));
  return out;
}

type Builder = (rng: Random, rush: boolean) => Omit<CoursePattern, 'length'> & { length?: number };

const PATTERNS: Record<string, Builder> = {
  pair: (rng) => {
    const [a, b] = lanes(rng, 2);
    return { name: 'pair', items: [...line(a, 5, 0), ...line(b, 5, 1, rng.pick([0, COURSE.ringGap * 2]))] };
  },
  arcs: (rng) => {
    const [a, b] = lanes(rng, 2);
    const up = rng.chance(0.5);
    return { name: 'arcs', items: [...arc(a + 60, 6, up ? 150 : -120, 0), ...line(b, 5, 1, COURSE.ringGap)] };
  },
  wave: (rng) => {
    const y = rng.range(mid - 80, mid + 80);
    return { name: 'wave', items: wave(y, 8, rng.range(170, 230), 1, 0) };
  },
  dive: (rng) => {
    const down = rng.chance(0.5);
    const [a, b] = down ? [COURSE.top + 20, COURSE.bottom - 20] : [COURSE.bottom - 20, COURSE.top + 20];
    const items = dive(a, b, 7, 0);
    // a short trail on the far side of where the dive starts
    items.push(...line(down ? COURSE.bottom - 60 : COURSE.top + 60, 3, 1, 0));
    return { name: 'dive', items };
  },
  orbTrail: (rng) => {
    const y = rng.range(COURSE.top + 40, COURSE.bottom - 40);
    const items = line(y, 5, 0);
    items.push({ kind: 'orb', dx: 5 * COURSE.ringGap + 30, y, trail: -1 });
    const other = y < mid ? rng.range(mid + 120, COURSE.bottom) : rng.range(COURSE.top, mid - 120);
    items.push(...arc(other, 5, 90, 1, COURSE.ringGap));
    return { name: 'orbTrail', items };
  },
  storm: (rng) => {
    const y = rng.range(COURSE.stormTop, COURSE.stormBottom);
    // rings curve round the storm on its roomier side, and another trail runs on the other side
    const above = y - COURSE.top > COURSE.bottom - y;
    const dodge = above ? y - 250 : y + 250;
    const items: CourseItem[] = [{ kind: 'storm', dx: 2 * COURSE.ringGap, y, trail: -1 }];
    items.push(...arc(dodge, 5, above ? 70 : -70, 0));
    // a short trail on the far side too, when there's room for one clear of the cloud
    const far = above ? y + 260 : y - 260;
    if (far >= COURSE.top && far <= COURSE.bottom) items.push(...line(far, 3, 1, COURSE.ringGap));
    return { name: 'storm', items };
  },
  stormGap: (rng) => {
    const gap = rng.range(COURSE.stormTop + STORM_GAP, COURSE.stormBottom - STORM_GAP);
    const items: CourseItem[] = [
      { kind: 'storm', dx: 2 * COURSE.ringGap, y: gap - STORM_GAP, trail: -1 },
      { kind: 'storm', dx: 2 * COURSE.ringGap, y: gap + STORM_GAP, trail: -1 },
    ];
    items.push(...line(gap, 5, 0));
    if (rng.chance(0.5)) items.push({ kind: 'orb', dx: 5 * COURSE.ringGap + 30, y: gap, trail: -1 });
    return { name: 'stormGap', items };
  },
  gust: (rng) => {
    const y = rng.range(COURSE.top + 150, COURSE.bottom - 150);
    const dir: -1 | 1 = y < mid ? 1 : -1;
    const items = line(y, 6, 0);
    const far = dir > 0 ? Math.max(COURSE.top, y - 280) : Math.min(COURSE.bottom, y + 280);
    items.push(...line(far, 3, 1, COURSE.ringGap * 2));
    return { name: 'gust', items, gust: { y, half: 150, dir, atDx: 0 } };
  },
  orbStorm: (rng) => {
    // a ring trail leads into the corridor between two staggered storms, with an orb inside it
    const y = rng.range(COURSE.stormTop + STORM_GAP, COURSE.stormBottom - STORM_GAP);
    const items: CourseItem[] = line(y, 3, 0);
    items.push(
      { kind: 'storm', dx: 3.5 * COURSE.ringGap, y: y - STORM_GAP, trail: -1 },
      { kind: 'storm', dx: 4.6 * COURSE.ringGap, y: y + STORM_GAP, trail: -1 },
      { kind: 'orb', dx: 4.05 * COURSE.ringGap, y, trail: -1 },
    );
    return { name: 'orbStorm', items };
  },
  rush: (rng) => {
    const ys = lanes(rng, 3);
    const items = [...line(ys[0], 6, 0), ...wave(ys[1], 6, 60, 1, 1, COURSE.ringGap / 2), ...line(ys[2], 6, 2)];
    if (rng.chance(0.6)) items.push({ kind: 'orb', dx: 6 * COURSE.ringGap + 20, y: rng.pick(ys), trail: -1 });
    return { name: 'rush', items };
  },
};

/** Which patterns may come up, by round progress (weights). */
export function patternWeights(t: number, rush: boolean): { item: string; weight: number }[] {
  if (rush) return [
    { item: 'rush', weight: 5 },
    { item: 'orbTrail', weight: 2 },
    { item: 'wave', weight: 1 },
    { item: 'gust', weight: 1 },
  ];
  const w: { item: string; weight: number }[] = [
    { item: 'pair', weight: 3 },
    { item: 'arcs', weight: 2 },
  ];
  if (t >= 0.12) w.push({ item: 'wave', weight: 2 }, { item: 'dive', weight: 1.5 }, { item: 'orbTrail', weight: 1.5 }, { item: 'storm', weight: 2 });
  if (t >= 0.32) w.push({ item: 'gust', weight: 1.6 }, { item: 'stormGap', weight: 1.4 });
  if (t >= 0.5) w.push({ item: 'orbStorm', weight: 1.2 });
  return w;
}

/**
 * The next stretch of course. `prev` is the last pattern's name (no two alike in a row, and hazards
 * are spaced out).
 */
export function nextPattern(rng: Random, t: number, rush: boolean, prev?: string): CoursePattern {
  const hazards = new Set(['storm', 'stormGap', 'orbStorm', 'gust']);
  const opts = patternWeights(t, rush).filter((o) => o.item !== prev && !(prev && hazards.has(prev) && hazards.has(o.item)));
  const name = rng.weighted(opts.length ? opts : patternWeights(t, rush));
  const p = PATTERNS[name](rng, rush);
  const length = p.length ?? span(p.items) + (hazards.has(name) ? 520 : 400);
  return { name: p.name, items: p.items, length, gust: p.gust };
}

/** Rings actually lost when knocked loose (never more than the rider has). */
export function ringsLost(score: number, kind: keyof typeof DROP): number {
  return Math.max(0, Math.min(score, DROP[kind]));
}

export interface BumpState {
  bursting: boolean;
  /** Can't be bumped (just hit, or recovering). */
  guarded: boolean;
}

/**
 * Two riders touching: a bursting rider rams one who isn't (who then loses rings); two bursting riders
 * clash and bounce apart; otherwise nothing happens (they just jostle). Guarded riders can't be rammed.
 */
export function resolveBump(a: BumpState, b: BumpState): 'a' | 'b' | 'clash' | null {
  if (a.bursting && b.bursting) return 'clash';
  if (a.bursting && !b.guarded) return 'a';
  if (b.bursting && !a.guarded) return 'b';
  return null;
}

/** Burst strength for a charge of 0..1: a tap still gives a little hop forward. */
export function burstPower(charge: number): number {
  return 0.42 + 0.58 * Math.min(1, Math.max(0, charge));
}
