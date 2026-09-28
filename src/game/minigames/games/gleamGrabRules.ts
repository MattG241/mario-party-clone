// Gleam Grab's pure rules (no Phaser here, so they can be unit tested): catch streaks and the
// chip storm of the last ten seconds.

/** Catches at most this far apart (game ms) keep a streak going. */
export const STREAK_GAP = 1200;

/** The chip storm: the last this-many ms of the round rain chips harder. */
export const STORM_MS = 10000;

/** Landed chips stay this long (ms) before vanishing; storm chips go sooner, so the floor never floods. */
export const CHIP_LIFE = 4500;
export const STORM_CHIP_LIFE = 3200;

/** Streak length after a catch at `now`, given the previous streak and when its last catch was. */
export function nextStreak(prev: number, lastAt: number, now: number): number {
  return prev > 0 && now - lastAt <= STREAK_GAP ? prev + 1 : 1;
}

/** Streak lengths that earn a call-out ("x3 STREAK!"): 3, 5, 7, 10, then every five. */
export function streakCallout(n: number): boolean {
  return n === 3 || n === 5 || n === 7 || (n >= 10 && n % 5 === 0);
}

/** The catch chime climbs a semitone per catch in a streak, up to an octave. */
export function streakPitch(n: number): number {
  return Math.pow(2, Math.min(12, Math.max(0, n - 1)) / 12);
}

/**
 * Milliseconds until the next drop: busier as the round goes on (progress 0..1), and busier still
 * in the storm.
 */
export function spawnInterval(progress: number, storm: boolean): number {
  const base = 620 - Math.min(1, Math.max(0, progress)) * 300;
  return storm ? base * 0.65 : base;
}

/** Chance that a drop is a golden chip (a touch likelier in the storm). */
export function goldChance(storm: boolean): number {
  return storm ? 0.12 : 0.09;
}
