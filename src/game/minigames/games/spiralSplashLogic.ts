// Spiral Splash geometry, currents and ranking, kept free of Phaser so it can be unit-tested.
//
// World units: x is screen px from the pond centre, y is depth from the pond centre (screen y =
// centre + y * depth scale). Lily pads are true circles in these units.

export interface Disc {
  x: number;
  y: number;
  r: number;
}

/** Index of the pad under a point (the one it is deepest inside), or -1. `tol` widens every rim. */
export function padUnder(pads: readonly Disc[], x: number, y: number, tol = 0): number {
  let best = -1;
  let bestM = -Infinity;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    const m = p.r + tol - Math.hypot(x - p.x, y - p.y);
    if (m >= 0 && m > bestM) {
      bestM = m;
      best = i;
    }
  }
  return best;
}

export interface CurrentOpts {
  /** Radius of the shear band between the inner and outer rings. */
  split: number;
  /** Angular speed (rad/s) of the inner and outer rings (opposite signs = counter-rotating). */
  inner: number;
  outer: number;
  /** Radial breathing: speed amplitude (units/s) and rate (rad/s). */
  breathe: number;
  breatheRate: number;
}

/**
 * Velocity of the pond's current at a point: two counter-rotating rings (the "spiral") with a
 * smooth shear band between them and a slow radial breathing, so pads drift together and apart.
 */
export function currentAt(x: number, y: number, tSec: number, o: CurrentOpts): { vx: number; vy: number } {
  const r = Math.hypot(x, y);
  if (r < 1e-6) return { vx: 0, vy: 0 };
  const a = Math.atan2(y, x);
  const blend = 0.5 + 0.5 * Math.tanh((r - o.split) / 60);
  const w = o.inner * (1 - blend) + o.outer * blend;
  const vt = w * r;
  const vr = o.breathe * Math.sin(tSec * o.breatheRate + a * 2);
  const cx = x / r;
  const cy = y / r;
  return { vx: -cy * vt + cx * vr, vy: cx * vt + cy * vr };
}

/**
 * Where a hop from (x, y) along (dx, dy) lands: the first point on the ray (within `range`) that is
 * at least `inset` inside a pad other than `from`. With `spread` (radians) it also tries rays up to
 * that far either side of the stick direction (nearest angle first), so 8-way keyboard input can
 * still reach pads that sit between two directions. Null when no pad is in reach.
 */
export function hopTarget(
  pads: readonly Disc[],
  from: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  range: number,
  inset: number,
  spread = 0,
  step = 8,
): { pad: number; x: number; y: number; dist: number } | null {
  const m = Math.hypot(dx, dy);
  if (m < 1e-6) return null;
  const base = Math.atan2(dy, dx);
  const tries = spread > 0 ? [0, spread / 3, -spread / 3, (2 * spread) / 3, (-2 * spread) / 3, spread, -spread] : [0];
  for (const off of tries) {
    const ux = Math.cos(base + off);
    const uy = Math.sin(base + off);
    for (let s = step; s <= range; s += step) {
      const px = x + ux * s;
      const py = y + uy * s;
      for (let i = 0; i < pads.length; i++) {
        if (i === from) continue;
        const p = pads[i];
        if (p.r - inset > 0 && Math.hypot(px - p.x, py - p.y) <= p.r - inset) return { pad: i, x: px, y: py, dist: s };
      }
    }
  }
  return null;
}

/** Closest approach of a point moving at (vx, vy) to a fixed point: time (s, ≥ 0) and distance. */
export function closestApproach(bx: number, by: number, vx: number, vy: number, px: number, py: number): { t: number; d: number } {
  const rx = px - bx;
  const ry = py - by;
  const v2 = vx * vx + vy * vy;
  const t = v2 > 0 ? Math.max(0, (rx * vx + ry * vy) / v2) : 0;
  return { t, d: Math.hypot(rx - vx * t, ry - vy * t) };
}

/** Is (x, y) inside the origin-centred ellipse (rx, ry) shrunk by `margin`? */
export function insideEllipse(x: number, y: number, rx: number, ry: number, margin = 0): boolean {
  const ax = rx - margin;
  const ay = ry - margin;
  if (ax <= 0 || ay <= 0) return false;
  return (x * x) / (ax * ax) + (y * y) / (ay * ay) <= 1;
}

/** Edge-to-edge gap between two pads (negative when they overlap). */
export function padGap(a: Disc, b: Disc): number {
  return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
}

/** Smallest gap from a pad to any other pad (Infinity when alone). */
export function nearestGap(pads: readonly Disc[], i: number): number {
  let best = Infinity;
  for (let j = 0; j < pads.length; j++) if (j !== i) best = Math.min(best, padGap(pads[i], pads[j]));
  return best;
}

/** Tie-break score for players still dry at the time cap: lives first, then hits landed. */
export function survivorScore(lives: number, hits: number): number {
  return lives * 100 + Math.min(99, hits);
}
