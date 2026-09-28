// Rhinestone Rodeo's pure rules (no Phaser, so they can be unit tested): the bucking schedule every
// pony follows, what counts as leaning the right way, and the ride score.
import { Random } from '../../util/Random';

export const ROUND_MS = 45000;
/** The last this-many ms are the wild ride (the final stretch): the bucks come fastest. */
export const WILD_MS = 10000;

/** -1: the pony tips back (lean left, stick left); +1: it tips forward (lean right). */
export type Lean = -1 | 1;

export interface Buck {
  /** When the pony starts winding up (ms after GO), and when it bucks. */
  windAt: number;
  snapAt: number;
  /** The way it tips while winding up: the way to lean. */
  dir: Lean;
  /** Place in a quick combination (0 = the first or only buck). */
  combo: number;
}

/** Stick deflection that counts as leaning. */
export const LEAN_MIN = 0.45;
/** Each fall costs this much ride time, on top of the time spent climbing back on. */
export const FALL_PENALTY_MS = 2000;
/** A combination's next wind-up starts this soon after the previous buck. */
export const COMBO_GAP = 170;
/** After the buzzer's last buck the pony needs this long to settle (no buck snaps in the final moment). */
const END_MARGIN = 700;

/** How wild the ride is at time t: 0 at GO rising to 1 by the wild ride, then a notch more. */
export function wildness(t: number, roundMs: number = ROUND_MS): number {
  const wildAt = roundMs - WILD_MS;
  return t >= wildAt ? 1.15 : Math.max(0, t / wildAt);
}

/** Length of a wind-up (the telegraph): 1.15 s at first, 0.55 s by the wild ride, 0.52 s during it. */
export function windMs(w: number): number {
  return w > 1 ? 520 : Math.round(1150 - 600 * w);
}

/** Pause between one buck and the next wind-up: 1.5 s at first, 0.7 s by the wild ride. */
export function gapMs(w: number): number {
  return w > 1 ? 620 : Math.round(1500 - 800 * w);
}

/** Chance that a buck is the start of a quick combination. */
export function comboChance(w: number): number {
  return Math.min(0.6, 0.12 + 0.4 * w);
}

/**
 * The schedule every pony bucks to (seeded, so it is the same for all riders: a fair ride). The
 * direction is random but never the same more than three times running; combinations of two (and,
 * once it's wild, three) come with shorter wind-ups.
 */
export function buildBucks(seed: number, roundMs: number = ROUND_MS): Buck[] {
  const rng = new Random(seed ^ 0x2b0d);
  const out: Buck[] = [];
  let t = 1400;
  let last: Lean = 1;
  let run = 0;
  for (let guard = 0; guard < 400; guard++) {
    const w = wildness(t, roundMs);
    let n = 1;
    if (rng.next() < comboChance(w)) n = w > 0.6 && rng.next() < 0.35 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const wind = Math.round(windMs(w) * (k === 0 ? 1 : 0.62));
      let dir: Lean = rng.next() < 0.5 ? -1 : 1;
      if (dir === last && run >= 3) dir = dir === 1 ? -1 : 1;
      run = dir === last ? run + 1 : 1;
      last = dir;
      const snapAt = t + wind;
      if (snapAt > roundMs - END_MARGIN) return out;
      out.push({ windAt: t, snapAt, dir, combo: k });
      t = snapAt + (k < n - 1 ? COMBO_GAP : Math.round(gapMs(w) * rng.range(0.8, 1.2)));
    }
  }
  return out;
}

/** Does a rider leaning `lean` (-1..1, from the stick) ride out a buck that tipped `dir`? */
export function ridesOut(lean: number, dir: Lean): boolean {
  return lean * dir >= LEAN_MIN;
}

/** Ride score: time in the saddle less the penalty for each fall (never below zero). */
export function rideScore(saddleMs: number, falls: number): number {
  return Math.max(0, Math.round(saddleMs) - falls * FALL_PENALTY_MS);
}

/** The ride score as the HUD shows it: whole seconds. */
export function rideLabel(score: number): string {
  return `${Math.floor(score / 1000)}s`;
}
