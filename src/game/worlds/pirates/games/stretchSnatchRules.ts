// Stretch & Snatch: the pure rules (Phaser-free, unit-tested in tests/unit/pirates-stretch-snatch.test.ts).
// Table-plane coordinates: origin at the table's centre, +x right, +y towards the camera, in screen px
// across (depth is squashed on screen; see StretchSnatch.ts).

export type FoodKind = 'apple' | 'orange' | 'grapes' | 'banana' | 'pineapple' | 'meat' | 'roast';

export const FRUITS: readonly FoodKind[] = ['apple', 'orange', 'grapes', 'banana', 'pineapple'];

/** Points per item: fruit 1, a drumstick 2, the golden roast 5. */
export const FOOD_VALUE: Record<FoodKind, number> = { apple: 1, orange: 1, grapes: 1, banana: 1, pineapple: 1, meat: 2, roast: 5 };

/** Items one fist can carry; a full fist earns a bonus point. */
export const MAX_HAUL = 3;
export const FULL_HAND_BONUS = 1;

/** Points for a haul brought home: its items plus the full-hand bonus. */
export function haulPoints(kinds: readonly FoodKind[]): number {
  let n = 0;
  for (const k of kinds) n += FOOD_VALUE[k];
  return n + (kinds.length >= MAX_HAUL ? FULL_HAND_BONUS : 0);
}

/** What the cook serves next: mostly fruit, a drumstick about one time in four (a touch more late on). */
export function serveKind(roll: number, pick: number, progress: number): FoodKind {
  const meat = 0.24 + 0.08 * Math.min(1, Math.max(0, progress));
  if (roll < meat) return 'meat';
  return FRUITS[Math.min(FRUITS.length - 1, Math.floor(pick * FRUITS.length))];
}

/** How many items the cook keeps on the table for this many players. */
export function tableTarget(players: number): number {
  return 7 + 2 * Math.max(1, Math.min(4, players));
}

/** The table's spin (rad/s) at this point of the round: it winds up as the feast goes on. */
export function spinSpeed(progress: number, frenzy: boolean): number {
  const p = Math.min(1, Math.max(0, progress));
  return (0.42 + 0.3 * p) * (frenzy ? 1.3 : 1);
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * Where two segments AB and CD cross, or null. Touching at an end point (or running along the same
 * line) doesn't count: arms only tangle when they genuinely cross.
 */
export function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): Pt | null {
  const rX = bx - ax;
  const rY = by - ay;
  const sX = dx - cx;
  const sY = dy - cy;
  const den = rX * sY - rY * sX;
  if (Math.abs(den) < 1e-9) return null;
  const qpX = cx - ax;
  const qpY = cy - ay;
  const t = (qpX * sY - qpY * sX) / den;
  const u = (qpX * rY - qpY * rX) / den;
  const eps = 1e-6;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return { x: ax + rX * t, y: ay + rY * t };
}

/** Distance from P to the segment AB. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/** Smallest signed difference a - b, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Keep an aim within `maxDev` radians of facing the table's centre (`toCentre`). */
export function clampAim(angle: number, toCentre: number, maxDev: number): number {
  const d = angleDelta(angle, toCentre);
  if (d > maxDev) return toCentre + maxDev;
  if (d < -maxDev) return toCentre - maxDev;
  return toCentre + d;
}

/** Where an item sitting at local polar (r, a) is when the table has turned to `tableAngle`. */
export function onTable(r: number, a: number, tableAngle: number, out: Pt = { x: 0, y: 0 }): Pt {
  out.x = r * Math.cos(a + tableAngle);
  out.y = r * Math.sin(a + tableAngle);
  return out;
}

/**
 * Where a fist launched from `sh` should aim to meet an item at local polar (r, a) on a table turning
 * at `omega` rad/s, reaching at `speed` px/s after a `delay` (s) before launch. Returns the meeting
 * point and the reach length, or null if it's out of reach. Two refinement passes are plenty: the table
 * turns slowly next to how fast a fist flies.
 */
export interface Lead {
  x: number;
  y: number;
  len: number;
  t: number;
}

export function leadTarget(sh: Pt, r: number, a: number, tableAngle: number, omega: number, speed: number, delay: number, maxLen: number, out: Lead = { x: 0, y: 0, len: 0, t: 0 }): Lead | null {
  let t = delay;
  let x = 0;
  let y = 0;
  let len = 0;
  for (let i = 0; i < 3; i++) {
    const ang = a + tableAngle + omega * t;
    x = r * Math.cos(ang);
    y = r * Math.sin(ang);
    len = Math.hypot(x - sh.x, y - sh.y);
    t = delay + len / speed;
  }
  if (len > maxLen) return null;
  out.x = x;
  out.y = y;
  out.len = len;
  out.t = t;
  return out;
}

/** Local polar coordinates of a table-plane point once the table has turned to `tableAngle`. */
export function toLocal(x: number, y: number, tableAngle: number): { r: number; a: number } {
  return { r: Math.hypot(x, y), a: Math.atan2(y, x) - tableAngle };
}
