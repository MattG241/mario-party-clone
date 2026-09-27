// Relic Relay: pure course logic (no Phaser), shared by the scene and the unit tests.
// The layout constants here are the ones to align the rendered course with.
import type { Random } from '../../util/Random';

// --- Course layout (screen px; orthographic 3/4 view) ------------------------------------------
/** Lane centrelines, back (top of screen) to front. */
export const LANE_Y = [430, 570, 710, 850];
export const START_X = 170;
export const GOAL_X = 1750;
/** Hedge centrelines: the outer edges and between the lanes. */
export const HEDGE_Y = [360, 500, 640, 780, 920];
/** Half-width of a dirt lane on screen. */
export const LANE_HALF = 52;
/** Across-lane world offsets are foreshortened by this much on screen. */
export const DEPTH_K = 0.707;
/** Lanes used for each player count (fewer players take the middle lanes). */
export const LANES_FOR: Record<number, number[]> = { 1: [1], 2: [1, 2], 3: [1, 2, 3], 4: [0, 1, 2, 3] };
export const COURSE_M = 100;
export const PX_PER_M = (GOAL_X - START_X) / COURSE_M;
/** Where finished runners jog to and celebrate. */
export const FINISH_REST_X = GOAL_X + 62;

// --- Hazard geometry -----------------------------------------------------------------------------
/** Runner hit box (half-width along the lane, height). */
export const BODY_HALF = 16;
export const BODY_H = 118;
/** Length of a log run: logs drop out of a crate at its far end and roll back towards the start. */
export const LOG_ZONE = 240;
/** Mace pendulum: pivot height above the lane, rope length, swing amplitude (rad), ball radius. */
export const MACE_PIVOT_H = 240;
export const MACE_ROPE = 165;
export const MACE_AMP = 1.0;
export const MACE_BALL_R = 26;
/** Share of the swing along the lane (the rest is across it), so the arc reads on screen. */
export const MACE_ALONG = 0.25;
export const MACE_ACROSS = Math.sqrt(1 - MACE_ALONG * MACE_ALONG);
/** Across-lane reach of the runner's body (world px) for the mace test. */
export const BODY_DEPTH = 14;
/** Half-width of the danger strip painted across the lane at each mace. */
export const MACE_STRIP = 58;
/** Spring pad trigger half-width, and the shortest launch distance. */
export const SPRING_HALF = 34;
export const SPRING_DIST = 320;
export const SPRING_MIN_REACH = 200;

export type ObstacleKind = 'log' | 'mace' | 'spring';

export interface CourseObstacle {
  kind: ObstacleKind;
  /** Log zone: logs roll from x1 down to x0. Mace/spring: centre x. */
  x: number;
  x0: number;
  x1: number;
  /** Log release interval / mace swing period (ms) / spring launch distance (px). */
  period: number;
  /** Timing offset (ms). */
  phase: number;
}

const TEMPLATES: ObstacleKind[][] = [
  ['log', 'mace', 'spring', 'log', 'mace'],
  ['mace', 'log', 'spring', 'mace', 'log'],
  ['log', 'spring', 'mace', 'log', 'mace'],
  ['mace', 'spring', 'log', 'mace', 'log'],
  ['log', 'mace', 'log', 'spring', 'mace'],
];

/**
 * The obstacle course, identical for every lane: two log runs, two mace gates and a spring,
 * in one of a few orders, with seeded spacing and timing.
 */
export function buildCourse(rng: Random): CourseObstacle[] {
  const order = rng.pick(TEMPLATES);
  const widths: Record<ObstacleKind, number> = { log: LOG_ZONE, mace: MACE_STRIP * 2 + 20, spring: SPRING_HALF * 2 };
  const first = START_X + 200;
  const last = GOAL_X - 110;
  const total = order.reduce((s, k) => s + widths[k], 0);
  // Minimum gaps: a spring sits close to what it lets you fly over, and the landing after that
  // obstacle gets room to breathe. The remaining slack is shared out at random.
  const mins: number[] = order.map((_, i) => (i === 0 ? 0 : order[i - 1] === 'spring' ? 30 : i >= 2 && order[i - 2] === 'spring' ? 120 : 60));
  const slack = Math.max(0, last - first - total - mins.reduce((a, b) => a + b, 0));
  const weights = order.map((_, i) => (i === 0 ? 0 : order[i - 1] === 'spring' ? 0.15 : rng.range(0.8, 1.2)));
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = first;
  const out: CourseObstacle[] = [];
  order.forEach((kind, i) => {
    cursor += mins[i] + (slack * weights[i]) / wsum;
    const w = widths[kind];
    const x0 = Math.round(cursor);
    const x1 = Math.round(cursor + w);
    const x = Math.round(cursor + w / 2);
    if (kind === 'log') out.push({ kind, x, x0, x1, period: Math.round(rng.range(1150, 1600)), phase: Math.round(rng.range(0, 1100)) });
    else if (kind === 'mace') out.push({ kind, x, x0, x1, period: Math.round(rng.range(3600, 4200)), phase: Math.round(rng.range(0, 3000)) });
    else out.push({ kind, x, x0, x1, period: 0, phase: 0 });
    cursor += w;
  });
  // A spring flings you clean over whatever follows it (its "period" holds the launch distance).
  out.forEach((o, i) => {
    if (o.kind !== 'spring') return;
    const next = out[i + 1];
    o.period = Math.round(Math.min(480, Math.max(SPRING_MIN_REACH, next ? next.x1 + 50 - o.x : SPRING_DIST)));
  });
  return out;
}

/** Swing angle of a mace at a moment (ms since GO). */
export function maceAngle(m: CourseObstacle, t: number): number {
  return MACE_AMP * Math.sin(((t + m.phase) / m.period) * Math.PI * 2);
}

/** Ball position relative to the lane: along (x offset), across (world px) and height. */
export function maceBall(m: CourseObstacle, t: number): { ax: number; w: number; h: number } {
  const th = maceAngle(m, t);
  const s = Math.sin(th) * MACE_ROPE;
  return { ax: s * MACE_ALONG, w: s * MACE_ACROSS, h: MACE_PIVOT_H - Math.cos(th) * MACE_ROPE };
}

/** Would a runner at (x, z) be struck by this mace at time t? */
export function maceHits(m: CourseObstacle, t: number, x: number, z: number): boolean {
  const b = maceBall(m, t);
  return Math.abs(m.x + b.ax - x) < BODY_HALF + MACE_BALL_R && Math.abs(b.w) < BODY_DEPTH + MACE_BALL_R && b.h - MACE_BALL_R < z + BODY_H && b.h + MACE_BALL_R > z;
}

/** Ordinal label: 1st, 2nd, 3rd, 4th. */
export function ordinal(n: number): string {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}

/**
 * Would a runner setting off now from x (velocity vx, accelerating towards `speed` at rate `accel`
 * per second) cross the mace strip untouched? Tested with a little slack either side so a slightly
 * late start still clears.
 */
export function strideClear(m: CourseObstacle, x: number, vx: number, dir: number, speed: number, accel: number, t0: number): boolean {
  const far = dir > 0 ? m.x + MACE_STRIP + 24 : m.x - MACE_STRIP - 24;
  const step = 0.04;
  const k = 1 - Math.exp(-accel * step);
  let px = x;
  let v = vx * dir;
  for (let tt = 0; tt < 3; tt += step) {
    v += (speed - v) * k;
    px += dir * v * step;
    const t = t0 + tt * 1000;
    if (maceHits(m, t, px, 0) || maceHits(m, t, px - 12, 0) || maceHits(m, t, px + 12, 0)) return false;
    if (dir > 0 ? px >= far : px <= far) return true;
  }
  return false;
}

/** Final ranking score: finishers by time (earlier is better), then distance (+ a parcel bonus). */
export function raceScore(r: { finished: boolean; doneAt: number; x: number; carrying: boolean }): { score: number; label: string } {
  if (r.finished) return { score: 100000 - r.doneAt, label: `${(r.doneAt / 1000).toFixed(1)} s` };
  const m = Math.max(0, Math.round((r.x - START_X) / PX_PER_M));
  return { score: Math.max(0, r.x - START_X) + (r.carrying ? 200 : 0), label: r.carrying ? `${m} m` : `${m} m (no parcel)` };
}
