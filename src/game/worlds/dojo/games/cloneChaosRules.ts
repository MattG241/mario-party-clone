// Clone Chaos's rules, free of Phaser so they can be unit tested: each round's plan (how many clones,
// how fast they move, which tricks they play), the shuffle itself, how a CPU keeps (or loses) track of
// the real ninja, the points for a pick, and how a marker steps between clones.
import type { NavDir } from '../../../input/buttons';
import type { Random } from '../../../util/Random';
import { ROWS, SPOTS, spotDist } from './cloneChaosLayout';

export const ROUNDS = 5;
/** Points for a correct pick, plus up to SPEED_POINTS for locking in quickly (the last round doubles). */
export const BASE_POINTS = 2;
export const SPEED_POINTS = 3;
/** Lock in within these times (ms from when picking opens) for +3, +2 or +1. */
export const SPEED_STEPS: readonly number[] = [1100, 2200, 3300];

export type MoveKind = 'swap' | 'hop' | 'rotate' | 'double';
export type Trick = 'smoke' | 'decoy' | 'blackout';

export interface RoundPlan {
  round: number;
  clones: number;
  moves: number;
  /** How long one move (a leap) takes. */
  moveMs: number;
  kinds: MoveKind[];
  tricks: Trick[];
  /** Time to pick before the smoke clears. */
  pickMs: number;
  /** Longest leap allowed (screen px, rows weighted a little). */
  reach: number;
  double: boolean;
}

const TABLE: Omit<RoundPlan, 'round' | 'double'>[] = [
  { clones: 5, moves: 5, moveMs: 760, kinds: ['swap'], tricks: [], pickMs: 4500, reach: 430 },
  { clones: 6, moves: 6, moveMs: 660, kinds: ['swap', 'hop', 'rotate'], tricks: [], pickMs: 4300, reach: 520 },
  { clones: 7, moves: 7, moveMs: 580, kinds: ['swap', 'hop', 'rotate', 'double'], tricks: ['smoke', 'decoy'], pickMs: 4100, reach: 620 },
  { clones: 8, moves: 8, moveMs: 510, kinds: ['swap', 'hop', 'rotate', 'double'], tricks: ['smoke', 'decoy', 'blackout'], pickMs: 3900, reach: 720 },
  { clones: 9, moves: 9, moveMs: 460, kinds: ['swap', 'hop', 'rotate', 'double'], tricks: ['smoke', 'decoy', 'blackout'], pickMs: 3800, reach: 820 },
];

export function roundPlan(round: number): RoundPlan {
  const r = Math.min(ROUNDS, Math.max(1, Math.round(round)));
  return { round: r, ...TABLE[r - 1], kinds: [...TABLE[r - 1].kinds], tricks: [...TABLE[r - 1].tricks], double: r === ROUNDS };
}

/** occ[spot] = the clone standing there (0 is the real ninja), or -1 for an empty spot. */
export type Occupancy = number[];

export interface Step {
  kind: MoveKind;
  /** swap [a, b] · hop [from, to] · rotate [a, b, c] (a to b, b to c, c to a) · double [a, b, c, d] (a<->b, c<->d). */
  spots: number[];
  trick?: Trick;
  /** Where the clone doing the decoy trick stands (a decoy step only). */
  decoy?: number;
}

/** A clone's leap within a step. */
export interface Leap {
  clone: number;
  from: number;
  to: number;
}

/** The starting line-up: `clones` spots taken (every row used), the real ninja (clone 0) on one of them. */
export function initialOccupancy(rng: Random, clones: number): Occupancy {
  const occ: Occupancy = SPOTS.map(() => -1);
  const byRow = ROWS.map((_, row) => SPOTS.filter((s) => s.row === row).map((s) => s.id));
  const chosen: number[] = byRow.map((ids) => rng.pick(ids));
  const rest = rng.shuffle(SPOTS.map((s) => s.id).filter((id) => !chosen.includes(id)));
  while (chosen.length < Math.min(clones, SPOTS.length)) chosen.push(rest.shift()!);
  const ids = rng.shuffle(Array.from({ length: chosen.length }, (_, i) => i));
  chosen.forEach((spot, i) => (occ[spot] = ids[i]));
  return occ;
}

export function spotOf(occ: Occupancy, clone: number): number {
  return occ.indexOf(clone);
}

export function leapsOf(occ: Occupancy, s: Step): Leap[] {
  const [a, b, c, d] = s.spots;
  switch (s.kind) {
    case 'swap':
      return [
        { clone: occ[a], from: a, to: b },
        { clone: occ[b], from: b, to: a },
      ];
    case 'hop':
      return [{ clone: occ[a], from: a, to: b }];
    case 'rotate':
      return [
        { clone: occ[a], from: a, to: b },
        { clone: occ[b], from: b, to: c },
        { clone: occ[c], from: c, to: a },
      ];
    case 'double':
      return [
        { clone: occ[a], from: a, to: b },
        { clone: occ[b], from: b, to: a },
        { clone: occ[c], from: c, to: d },
        { clone: occ[d], from: d, to: c },
      ];
  }
}

export function applyStep(occ: Occupancy, s: Step): void {
  const leaps = leapsOf(occ, s);
  for (const l of leaps) occ[l.from] = -1;
  for (const l of leaps) occ[l.to] = l.clone;
}

/** A spot near `from` (weighted towards the nearest), among `pool`, within `reach` if any is. */
function nearPick(rng: Random, from: number, pool: number[], reach: number): number | null {
  const opts = pool.filter((id) => id !== from);
  if (!opts.length) return null;
  const within = opts.filter((id) => spotDist(from, id) <= reach);
  const list = within.length ? within : [opts.reduce((b, id) => (spotDist(from, id) < spotDist(from, b) ? id : b), opts[0])];
  return rng.weighted(list.map((id) => ({ item: id, weight: 1 / (60 + spotDist(from, id)) })));
}

/**
 * The shuffle for a round: `plan.moves` steps, starting from `occ` (which is left untouched). The real
 * ninja is in a little over half of the moves, no move simply undoes the last one, and from round 3 a
 * few moves carry a trick (never the first, at most two a round).
 */
export function planShuffle(rng: Random, plan: RoundPlan, start: Occupancy): Step[] {
  const occ = start.slice();
  const steps: Step[] = [];
  const weights: Record<MoveKind, number> = { swap: 3, hop: 1.4, rotate: 1.2, double: 1 };
  let tricks = 0;
  let last = '';
  for (let i = 0; i < plan.moves; i++) {
    const taken = occ.map((c, id) => (c >= 0 ? id : -1)).filter((id) => id >= 0);
    const empty = occ.map((c, id) => (c < 0 ? id : -1)).filter((id) => id >= 0);
    const real = spotOf(occ, 0);
    let step: Step | null = null;
    for (let tries = 0; tries < 12 && !step; tries++) {
      const kinds = plan.kinds.filter((k) => (k === 'hop' ? empty.length > 0 : k === 'rotate' ? taken.length >= 3 : k === 'double' ? taken.length >= 4 : true));
      const kind = rng.weighted(kinds.map((k) => ({ item: k, weight: weights[k] })));
      const a = rng.chance(0.56) ? real : rng.pick(taken);
      if (kind === 'swap') {
        const b = nearPick(rng, a, taken, plan.reach);
        if (b !== null) step = { kind, spots: [a, b] };
      } else if (kind === 'hop') {
        const b = nearPick(rng, a, empty, plan.reach);
        if (b !== null) step = { kind, spots: [a, b] };
      } else if (kind === 'rotate') {
        const b = nearPick(rng, a, taken, plan.reach);
        const c = b === null ? null : nearPick(rng, b, taken.filter((id) => id !== a), plan.reach);
        if (b !== null && c !== null) step = { kind, spots: [a, b, c] };
      } else {
        const b = nearPick(rng, a, taken, plan.reach);
        const rest = taken.filter((id) => id !== a && id !== b);
        const c = rest.length ? rng.pick(rest) : null;
        const d = c === null ? null : nearPick(rng, c, rest, plan.reach);
        if (b !== null && c !== null && d !== null) step = { kind, spots: [a, b, c, d] };
      }
      // never undo the move just made
      if (step) {
        const sig = [...step.spots].sort((x, y) => x - y).join(',');
        if ((step.kind === 'swap' || step.kind === 'double') && sig === last) step = null;
        else last = sig;
      }
    }
    if (!step) {
      const [a, b] = taken;
      step = { kind: 'swap', spots: [a, b] };
    }
    if (plan.tricks.length && i > 0 && tricks < 2 && rng.chance(0.34)) {
      step.trick = rng.pick(plan.tricks);
      tricks++;
      if (step.trick === 'decoy') {
        const idle = taken.filter((id) => !step!.spots.includes(id));
        if (idle.length) step.decoy = rng.pick(idle);
        else step.trick = undefined;
      }
    }
    steps.push(step);
    applyStep(occ, step);
  }
  return steps;
}

/**
 * A CPU watching one step: it follows the clone it believes is real. When that clone is in the move it
 * may lose it to another clone in the same move (more likely the faster the round and under smoke or in
 * the dark); a decoy may draw its eye. `mistake` is the CPU's error rate (CPU_SKILL); `rand` gives 0..1.
 * Returns the clone it now believes is real.
 */
export function trackStep(belief: number, occBefore: Occupancy, s: Step, plan: RoundPlan, mistake: number, rand: () => number): number {
  const leaps = leapsOf(occBefore, s);
  const involved = leaps.map((l) => l.clone).filter((c) => c >= 0);
  if (involved.includes(belief)) {
    const speed = 760 / plan.moveMs;
    const trick = s.trick === 'smoke' ? 1.7 : s.trick === 'blackout' ? 1.9 : 1;
    const kind = s.kind === 'rotate' ? 1.35 : s.kind === 'double' ? 1.3 : s.kind === 'hop' ? 0.5 : 1;
    const others = involved.filter((c) => c !== belief);
    if (others.length && rand() < mistake * 0.85 * speed * trick * kind) return others[Math.floor(rand() * others.length) % others.length];
    return belief;
  }
  if (s.trick === 'decoy' && s.decoy !== undefined && occBefore[s.decoy] >= 0 && rand() < mistake * 0.6) return occBefore[s.decoy];
  return belief;
}

/** Points for a pick: nothing if wrong; otherwise base plus speed (a pick left to the timeout gets the base only). */
export function pickPoints(correct: boolean, lockMs: number | null, double: boolean): number {
  if (!correct) return 0;
  const speed = lockMs === null ? 0 : SPEED_STEPS.filter((t) => lockMs <= t).length;
  const pts = BASE_POINTS + Math.min(SPEED_POINTS, speed);
  return double ? pts * 2 : pts;
}

/** The clone a marker moves to from `from` when pushed in `dir` (staying put if there is none that way). */
export function navFrom(from: number, dir: NavDir, candidates: readonly number[]): number {
  const p = SPOTS[from];
  let best = from;
  let bestScore = Infinity;
  for (const id of candidates) {
    if (id === from) continue;
    const q = SPOTS[id];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 20) continue;
    // mostly straight ahead; sideways drift costs more (ties go to the left-most, then the top-most)
    const score = along + across * 1.8 + (q.x + q.y) * 1e-4;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/** The first push on the shortest way from `from` to `target` through the clones (null once there, or if unreachable). */
export function navToward(from: number, target: number, candidates: readonly number[]): NavDir | null {
  if (from === target) return null;
  const dirs = ['left', 'right', 'up', 'down'] as const;
  const first = new Map<number, NavDir>();
  const queue: number[] = [from];
  const seen = new Set<number>([from]);
  while (queue.length) {
    const at = queue.shift()!;
    for (const dir of dirs) {
      const to = navFrom(at, dir, candidates);
      if (seen.has(to)) continue;
      seen.add(to);
      first.set(to, at === from ? dir : first.get(at)!);
      if (to === target) return first.get(to)!;
      queue.push(to);
    }
  }
  return null;
}
