// Pure rules behind the Dojo Summit's board events (kept apart from the presentation so they can be
// unit tested): the training montage's lucky streak, the tournament bout and the smoke-bomb shuffle.
import type { Random } from '../../util/Random';

/** Chance to land each rep of a training montage (each harder than the last). */
export const TRAINING_ODDS = [0.9, 0.75, 0.6, 0.45, 0.3] as const;
/** Coins each landed rep pays (a perfect five-rep streak pays 15). */
export const TRAINING_PAY = [2, 2, 3, 3, 5] as const;

/** Drills for a montage at the falls or on the boulder grounds (one per rep). */
export const DRILLS = {
  falls: ['Stance under the falls', 'Stepping-stone dash', 'Log balance', 'Current push', 'Splash kick'],
  boulders: ['Boulder lift', 'Push-up flurry', 'Mountain sprint', 'Boulder toss', 'Peak punch'],
} as const;

/** Reps keep coming while the luck holds; the streak ends at the first slip. */
export function trainingStreak(rng: Random): { reps: number; coins: number } {
  let reps = 0;
  let coins = 0;
  for (let i = 0; i < TRAINING_ODDS.length; i++) {
    if (rng.next() >= TRAINING_ODDS[i]) break;
    reps++;
    coins += TRAINING_PAY[i];
  }
  return { reps, coins };
}

/** Most coins a bout's winner takes from the loser. */
export const BOUT_PURSE = 5;

/** Each fighter's flurry (1–10 hits); a tie goes to one sudden-death exchange, then it's a draw. */
export function boutFlurries(rng: Random): { a: number; b: number; winner: 'a' | 'b' | 'draw' } {
  let a = rng.int(1, 10);
  let b = rng.int(1, 10);
  if (a === b) {
    a += rng.int(1, 3);
    b += rng.int(1, 3);
  }
  return { a, b, winner: a > b ? 'a' : b > a ? 'b' : 'draw' };
}

/** Who a CPU challenges: the rival with the most coins (the first of them on a tie). */
export function pickChallenger<T extends { slot: number; chips: number }>(rivals: readonly T[]): T {
  return rivals.reduce((best, o) => (o.chips > best.chips ? o : best), rivals[0]);
}

/**
 * A random derangement of 0..n-1 (nobody keeps their own index) for the smoke-bomb shuffle: entry i
 * is whose place player i takes. n < 2 returns the identity.
 */
export function derangement(n: number, rng: Random): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return idx;
  for (let tries = 0; tries < 24; tries++) {
    const p = rng.shuffle([...idx]);
    if (p.every((v, i) => v !== i)) return p;
  }
  // Fallback (vanishingly rare): everyone steps one place along.
  return idx.map((i) => (i + 1) % n);
}
