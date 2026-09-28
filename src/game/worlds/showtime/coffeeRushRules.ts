// Coffee Rush's pure rules (no Phaser, so they can be unit tested): grading a pulled shot against
// the cup's fill line, grading the milk swirl, what a coffee is worth and how patient customers are.
import type { Random } from '../../util/Random';

export const ROUND_MS = 50000;
/** The last this-many ms are rush hour: every coffee is worth double. */
export const RUSH_MS = 10000;

/** How close to the fill line (as a share of the cup) counts as PERFECT or GOOD. */
export const SHOT = { perfect: 0.045, good: 0.11 } as const;
/** How close to the heart's middle (degrees either side) the milk swirl must be tapped. */
export const SWIRL = { perfect: 13, good: 32 } as const;
/** The swirl gives up (a messy pour) after this many laps without a tap. */
export const SWIRL_LAPS = 2;
/** Taps in the first moments of a swirl are ignored (so a double tap after the shot can't trigger it). */
export const SWIRL_GRACE_MS = 220;

export type ShotGrade = 'perfect' | 'good' | 'weak' | 'over' | 'spill';
export type SwirlGrade = 'perfect' | 'good' | 'messy';

/** A shot released at `level` (0..1 of the cup) against the fill line `target`. A full cup (1) overflows. */
export function gradeShot(level: number, target: number): ShotGrade {
  if (level >= 1) return 'spill';
  const d = level - target;
  // (a hair of slack so a release exactly on a band's edge isn't lost to rounding)
  if (Math.abs(d) <= SHOT.perfect + 1e-9) return 'perfect';
  if (Math.abs(d) <= SHOT.good + 1e-9) return 'good';
  return d < 0 ? 'weak' : 'over';
}

/** Smallest angle between two directions, in degrees (0..180). */
export function angleDiff(a: number, b: number): number {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

export function gradeSwirl(dotAngle: number, heartAngle: number): SwirlGrade {
  const d = angleDiff(dotAngle, heartAngle);
  if (d <= SWIRL.perfect) return 'perfect';
  if (d <= SWIRL.good) return 'good';
  return 'messy';
}

/** A served coffee: 2, plus 1 for a PERFECT shot and 1 for PERFECT latte art; double in rush hour. */
export function coffeePoints(shot: 'perfect' | 'good', swirl: SwirlGrade, rush: boolean): number {
  const pts = 2 + (shot === 'perfect' ? 1 : 0) + (swirl === 'perfect' ? 1 : 0);
  return rush ? pts * 2 : pts;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/** How long (ms) a customer waits before leaving: patient early on, hurried by the end. */
export function patienceMs(elapsed: number): number {
  return Math.round(lerp(11500, 7500, elapsed / ROUND_MS));
}

/** How fast the cup fills while the shot is pulled (share of the cup per ms): a full cup takes 1.7 s, then 1.35 s. */
export function pourRate(elapsed: number): number {
  return 1 / lerp(1700, 1350, elapsed / ROUND_MS);
}

/** Time for one lap of the milk swirl (ms). */
export function swirlPeriod(elapsed: number): number {
  return Math.round(lerp(1150, 860, elapsed / ROUND_MS));
}

/** A new cup's fill line: somewhere between a short and a tall pour. */
export function orderTarget(rng: Random): number {
  return Math.round(rng.range(0.42, 0.86) * 100) / 100;
}

/** Where the swirl's heart sits and where the milk starts: at least a third of a lap apart, so there is always a wind-up. */
export function swirlStart(rng: Random): { heart: number; start: number } {
  const heart = rng.range(0, 360);
  const start = (heart + rng.range(120, 240)) % 360;
  return { heart, start };
}
