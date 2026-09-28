// Storm Navigator: the pure rules (Phaser-free, unit-tested in tests/unit/pirates-storm-navigator.test.ts) -
// sailing against the wind, the bay's shoreline, tacking, and what the storm takes from you.
// World coordinates: x right, y toward the camera, in screen px across (depth is squashed on screen).

/** The open water (screen px, a rounded rectangle): keep in step with BAY in scripts/art/worlds/pirates/mg_stormbay.py. */
export const BAY = { x0: 170, y0: 180, x1: 1750, y1: 1000 };
/** The lighthouse lamp room, where the weather vane turns (screen px). */
export const LIGHT = { x: 1822, y: 318 };

/** Smallest signed difference a - b, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** The sail's pull by the angle off the wind (0 = wind right behind, PI = sailing straight into it). */
const POLAR: readonly [number, number][] = [
  [0, 0.72],
  [45, 0.96],
  [90, 1.0],
  [120, 0.86],
  [135, 0.62],
  [145, 0.28],
  [155, 0.1],
  [180, 0.06],
];

/**
 * How well a boat heading `heading` sails in a wind blowing toward `wind` (0..1): best across the wind,
 * good with it, and next to nothing heading straight into it (the no-go zone, inside ~30 degrees).
 */
export function sailEfficiency(heading: number, wind: number): number {
  const deg = (Math.abs(angleDelta(heading, wind)) * 180) / Math.PI;
  for (let i = 1; i < POLAR.length; i++) {
    const [a1, e1] = POLAR[i];
    if (deg <= a1) {
      const [a0, e0] = POLAR[i - 1];
      const t = (deg - a0) / (a1 - a0);
      const s = t * t * (3 - 2 * t);
      return e0 + (e1 - e0) * s;
    }
  }
  return POLAR[POLAR.length - 1][1];
}

/** Whether a heading is in irons (too close to the wind to sail). */
export function inIrons(heading: number, wind: number): boolean {
  return sailEfficiency(heading, wind) < 0.3;
}

/**
 * The heading to sail toward a bearing: straight there if the wind allows, else the closer of the two
 * tacks either side of the no-go zone (`prefer` keeps the current tack, -1 / 1, so a boat doesn't dither).
 */
export function tackHeading(bearing: number, wind: number, prefer = 0): { heading: number; tack: number } {
  const off = angleDelta(bearing, wind + Math.PI);
  const limit = (40 * Math.PI) / 180;
  if (Math.abs(off) >= limit) return { heading: bearing, tack: 0 };
  const side = prefer !== 0 ? prefer : off >= 0 ? 1 : -1;
  return { heading: wind + Math.PI + side * limit * 1.25, tack: side };
}

/**
 * The boom's direction for a boat on `heading` in `wind`: it swings out to the side the wind pushes
 * (further out the more the wind comes from behind), and flaps near the centre line in irons.
 */
export function boomAngle(heading: number, wind: number, flutter: number): number {
  const rel = angleDelta(wind, heading);
  const alpha = Math.abs(rel);
  if (inIrons(heading, wind)) return heading + Math.PI + flutter * 0.35;
  const out = Math.min(1.35, Math.max(0.18, (Math.PI - alpha) * 0.5));
  return heading + Math.PI - Math.sign(rel || 1) * out;
}

/** Superellipse measure of a screen point against the bay (< 1 inside). */
export function bayMeasure(x: number, y: number): number {
  const cx = (BAY.x0 + BAY.x1) / 2;
  const cy = (BAY.y0 + BAY.y1) / 2;
  const u = (x - cx) / ((BAY.x1 - BAY.x0) / 2);
  const v = (y - cy) / ((BAY.y1 - BAY.y0) / 2);
  return u ** 4 + v ** 4;
}

/** Pull a screen point back inside the bay (with `margin` px to spare); true if it had strayed. */
export function keepInBay(p: { x: number; y: number }, margin = 0): boolean {
  const cx = (BAY.x0 + BAY.x1) / 2;
  const cy = (BAY.y0 + BAY.y1) / 2;
  const rx = (BAY.x1 - BAY.x0) / 2 - margin;
  const ry = (BAY.y1 - BAY.y0) / 2 - margin;
  const u = (p.x - cx) / rx;
  const v = (p.y - cy) / ry;
  const m = u ** 4 + v ** 4;
  if (m <= 1) return false;
  const k = 1 / Math.pow(m, 0.25);
  p.x = cx + u * k * rx;
  p.y = cy + v * k * ry;
  return true;
}

export type TreasureKind = 'pouch' | 'chest' | 'goldchest';
export const TREASURE_VALUE: Record<TreasureKind, number> = { pouch: 1, chest: 3, goldchest: 5 };

/** What bobs up next: mostly pouches, chests fairly often, a golden chest now and then (never two at once). */
export function treasureKind(roll: number, goldOut: boolean): TreasureKind {
  if (!goldOut && roll < 0.08) return 'goldchest';
  return roll < 0.4 ? 'chest' : 'pouch';
}

/** How much treasure a lightning strike knocks overboard: about a third, at least 1, at most 4. */
export function strikeLoss(held: number): number {
  if (held <= 0) return 0;
  return Math.min(4, Math.max(1, Math.round(held * 0.3)));
}

/** How many pieces a scattered haul becomes (a golden chest's 5 is too much to scatter as one). */
export function splitLoss(points: number): TreasureKind[] {
  const out: TreasureKind[] = [];
  let left = points;
  while (left >= 3 && out.length < 2) {
    out.push('chest');
    left -= 3;
  }
  while (left > 0) {
    out.push('pouch');
    left -= 1;
  }
  return out;
}
