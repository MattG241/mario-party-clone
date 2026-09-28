// Free Throw Frenzy: the court layout and the shot rules (no Phaser here, so they can be unit tested).
//
// The court is seen through an orthographic camera COURT_ELEV degrees above the ground (as its
// render, scripts/art/worlds/sports/mg_court.py): a ground point (x, gy) is on screen at (x, gy) and a
// height z (world px, 100 = 1 m) lifts it by z * SINB. Depths along the ground are squashed by COSB.

/** Camera elevation of the court render, degrees (keep in step with mg_court.py). */
export const COURT_ELEV = 34;
const BETA = ((90 - COURT_ELEV) * Math.PI) / 180;
export const COSB = Math.cos(BETA);
export const SINB = Math.sin(BETA);

/** The hoop at rest: the ground point under the rim's centre (screen px) and the rim (world px). */
export const HOOP = { x: 960, gy: 560, rimZ: 305, rimR: 40 };
/** The backboard stands this far (world px) behind the rim's centre, from z0 to z1, BOARD_W wide. */
export const BOARD = { back: 52, z0: 290, z1: 412, w: 200 };
export const BALL_R = 17;
/** Every shooter stands this far (world px) from the hoop at rest, so every spot is equally hard. */
export const SHOOT_R = 520;
/** Where the ball leaves the hands (world px above the ground, at the top of the jump). */
export const RELEASE_Z = 200;
/** Flight time of a shot, ms, and how high its arc rises above the straight line (world px). */
export const FLIGHT_MS = 900;
export const ARC_H = 290;

/** Round length and the rack: five balls, the last one golden (worth double). */
export const ROUND_MS = 45000;
export const RACK = 5;
/** The final stretch: the hoop slides along its track (amplitude px, period ms, ramp-in ms). */
export const SLIDE_AMP = 230;
export const SLIDE_PERIOD = 4000;
export const SLIDE_RAMP = 900;

/** The power bar sweeps 0 -> 1 in POWER_MS, the aim needle -1 -> 1 in AIM_MS (golden balls: faster). */
export const POWER_MS = 900;
export const AIM_MS = 800;
export const GOLD_SPEED = 1.2;
/** Half-widths of the green (make) and bright (swish) zones: power in bar units, aim in needle units. */
export const POWER_MAKE = 0.075;
export const POWER_SWISH = 0.026;
export const AIM_MAKE = 0.16;
export const AIM_SWISH = 0.055;
/** The swish zone as a share of the make zone (the same on both meters). */
export const SWISH_K = POWER_SWISH / POWER_MAKE;
/** Aim needle full scale (degrees either side), for turning a direction into needle units. */
export const AIM_RANGE = 32;

export type ShotOutcome = 'swish' | 'rim-in' | 'bank' | 'rim-out' | 'board-out' | 'short' | 'wide';

/** Shooter angles (degrees from straight at the camera) for n players, symmetric about the hoop. */
export function spotAngles(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-30, 30];
  if (n === 3) return [-50, 0, 50];
  return [-60, -20, 20, 60];
}

/** Shooting spot of player index i of n (ground point on screen). */
export function shooterSpot(i: number, n: number): { x: number; gy: number } {
  const a = ((spotAngles(n)[i] ?? 0) * Math.PI) / 180;
  return { x: HOOP.x + Math.sin(a) * SHOOT_R, gy: HOOP.gy + Math.cos(a) * SHOOT_R * COSB };
}

/** Triangle wave: 0 at u = 0, 1 at u = 1, 0 again at u = 2 (and so on). */
export function pingPong(u: number): number {
  const m = ((u % 2) + 2) % 2;
  return m <= 1 ? m : 2 - m;
}

/** Hoop x at game time t (ms since GO) when the slide began at t0 (null: it hasn't). */
export function hoopXAt(t: number, t0: number | null): number {
  if (t0 === null || t <= t0) return HOOP.x;
  const tau = t - t0;
  const amp = SLIDE_AMP * Math.min(1, tau / SLIDE_RAMP);
  return HOOP.x + amp * Math.sin((tau / SLIDE_PERIOD) * Math.PI * 2);
}

/** Ground distance (world px) from a shooting spot to a hoop at x. */
export function hoopDistance(sx: number, sgy: number, hx: number): number {
  return Math.hypot(hx - sx, (HOOP.gy - sgy) / COSB);
}

/**
 * The centre of the power bar's green zone for a shot: the rest distance needs POWER_BASE, a
 * further hoop needs more (the final stretch's sliding hoop moves it), plus this shot's jitter.
 */
export const POWER_BASE = 0.6;
const POWER_PER_PX = 0.0011;
export function powerTarget(dist: number, jitter: number): number {
  return clamp(POWER_BASE + jitter + (dist - SHOOT_R) * POWER_PER_PX, 0.14, 0.88);
}

/**
 * The centre of the aim needle's green zone: the angle between the shooter's straight line (to the
 * hoop at rest) and the line to where the hoop will be when the ball gets there.
 */
export function aimTarget(sx: number, sgy: number, hx: number): number {
  const d = (HOOP.gy - sgy) / COSB;
  const rest = Math.atan2(HOOP.x - sx, d);
  const now = Math.atan2(hx - sx, d);
  return clamp(((now - rest) * 180) / Math.PI / AIM_RANGE, -0.84, 0.84);
}

/**
 * What a shot does, from where each meter stopped relative to its zone: ep = power error and
 * ea = aim error, each in units of its green half-width (so |e| <= 1 is inside the green).
 * Both in the green: a basket (both in the bright middles: a swish). Slightly long but straight:
 * off the glass and in. Otherwise a miss of some kind.
 */
export function shotOutcome(ep: number, ea: number): ShotOutcome {
  const ap = Math.abs(ep);
  const aa = Math.abs(ea);
  if (ap <= SWISH_K && aa <= SWISH_K) return 'swish';
  if (ap <= 1 && aa <= 1) return 'rim-in';
  if (ep > 1 && ep <= 1.9 && aa <= 0.6) return 'bank';
  if (ap <= 1.9 && aa <= 1.9) return 'rim-out';
  if (ep > 1.9 && aa <= 1.9) return 'board-out';
  if (ep < -1.9) return 'short';
  return 'wide';
}

export function isBasket(o: ShotOutcome): boolean {
  return o === 'swish' || o === 'rim-in' || o === 'bank';
}

/** Points for a shot: a basket 2, a swish 3; +1 in the final stretch; the golden ball doubles it. */
export function shotPoints(o: ShotOutcome, golden: boolean, finalStretch: boolean): number {
  const base = o === 'swish' ? 3 : isBasket(o) ? 2 : 0;
  if (!base) return 0;
  return (base + (finalStretch ? 1 : 0)) * (golden ? 2 : 1);
}

/** The ball in the rack a shot uses (0-based): the last one of each rack is golden. */
export function isGoldenBall(shotIndex: number): boolean {
  return shotIndex % RACK === RACK - 1;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
