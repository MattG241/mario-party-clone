// Crate Craze physics, scoring and CPU geometry, kept free of Phaser so it can be unit-tested.
//
// Everything here works in "floor units": x is screen x, y is depth measured from the back fence
// (screen y = floor top + y * depth scale). Footprints are therefore true squares (crates) and
// circles (players), so collisions are isotropic even though the yard is seen at 3/4.

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Contact normal (unit, from the first body to the second) and penetration depth. */
export interface Contact {
  nx: number;
  ny: number;
  depth: number;
}

/** Half-plane obstacle: points with p·n < d are inside it (n points back into the yard). */
export interface HalfPlane {
  nx: number;
  ny: number;
  d: number;
}

/** Circle (centre a, radius r) against an axis-aligned square (centre b, half size h). */
export function circleBoxContact(ax: number, ay: number, r: number, bx: number, by: number, h: number): Contact | null {
  const qx = Math.max(bx - h, Math.min(ax, bx + h));
  const qy = Math.max(by - h, Math.min(ay, by + h));
  const dx = qx - ax;
  const dy = qy - ay;
  const d2 = dx * dx + dy * dy;
  if (d2 > 1e-9) {
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  // Circle centre inside the square: leave through the nearest side.
  const left = ax - (bx - h);
  const right = bx + h - ax;
  const top = ay - (by - h);
  const bottom = by + h - ay;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { nx: 1, ny: 0, depth: left + r };
  if (m === right) return { nx: -1, ny: 0, depth: right + r };
  if (m === top) return { nx: 0, ny: 1, depth: top + r };
  return { nx: 0, ny: -1, depth: bottom + r };
}

/** Two axis-aligned squares (least-penetration axis). */
export function boxBoxContact(ax: number, ay: number, ah: number, bx: number, by: number, bh: number): Contact | null {
  const dx = bx - ax;
  const dy = by - ay;
  const px = ah + bh - Math.abs(dx);
  const py = ah + bh - Math.abs(dy);
  if (px <= 0 || py <= 0) return null;
  if (px < py) return { nx: dx < 0 ? -1 : 1, ny: 0, depth: px };
  return { nx: 0, ny: dy < 0 ? -1 : 1, depth: py };
}

/** Two circles. */
export function circleContact(ax: number, ay: number, ar: number, bx: number, by: number, br: number): Contact | null {
  const dx = bx - ax;
  const dy = by - ay;
  const d2 = dx * dx + dy * dy;
  const r = ar + br;
  if (d2 >= r * r) return null;
  const d = Math.sqrt(d2);
  if (d < 1e-6) return { nx: 1, ny: 0, depth: r };
  return { nx: dx / d, ny: dy / d, depth: r - d };
}

/**
 * Push two bodies apart along a contact (split by inverse mass; Infinity = immovable) and apply an
 * impulse to their closing velocity with restitution e. Returns the closing speed before impact.
 */
export function resolve(a: Body, ma: number, b: Body, mb: number, c: Contact, e: number): number {
  const ia = 1 / ma;
  const ib = 1 / mb;
  const sum = ia + ib;
  if (sum <= 0) return 0;
  const corr = c.depth / sum;
  a.x -= c.nx * corr * ia;
  a.y -= c.ny * corr * ia;
  b.x += c.nx * corr * ib;
  b.y += c.ny * corr * ib;
  const vn = (b.vx - a.vx) * c.nx + (b.vy - a.vy) * c.ny;
  if (vn >= 0) return 0;
  const j = (-(1 + e) * vn) / sum;
  a.vx -= j * ia * c.nx;
  a.vy -= j * ia * c.ny;
  b.vx += j * ib * c.nx;
  b.vy += j * ib * c.ny;
  return -vn;
}

/** Keep a square inside a rect, bouncing off the walls. Returns the impact speed (0 = no hit). */
export function containBox(b: Body, h: number, r: Rect, e: number): number {
  let hit = 0;
  if (b.x - h < r.x) {
    b.x = r.x + h;
    if (b.vx < 0) {
      hit = Math.max(hit, -b.vx);
      b.vx = -b.vx * e;
    }
  } else if (b.x + h > r.x + r.w) {
    b.x = r.x + r.w - h;
    if (b.vx > 0) {
      hit = Math.max(hit, b.vx);
      b.vx = -b.vx * e;
    }
  }
  if (b.y - h < r.y) {
    b.y = r.y + h;
    if (b.vy < 0) {
      hit = Math.max(hit, -b.vy);
      b.vy = -b.vy * e;
    }
  } else if (b.y + h > r.y + r.h) {
    b.y = r.y + r.h - h;
    if (b.vy > 0) {
      hit = Math.max(hit, b.vy);
      b.vy = -b.vy * e;
    }
  }
  return hit;
}

/** Keep a circle inside a rect (players simply stop at the fence). */
export function containCircle(b: Body, rad: number, r: Rect): void {
  if (b.x - rad < r.x) {
    b.x = r.x + rad;
    b.vx = Math.max(0, b.vx);
  } else if (b.x + rad > r.x + r.w) {
    b.x = r.x + r.w - rad;
    b.vx = Math.min(0, b.vx);
  }
  if (b.y - rad < r.y) {
    b.y = r.y + rad;
    b.vy = Math.max(0, b.vy);
  } else if (b.y + rad > r.y + r.h) {
    b.y = r.y + r.h - rad;
    b.vy = Math.min(0, b.vy);
  }
}

/** Push a square out of a half-plane obstacle (it slides along the edge). Returns impact speed. */
export function boxHalfPlane(b: Body, h: number, hp: HalfPlane, e: number): number {
  const lo = b.x * hp.nx + b.y * hp.ny - h * (Math.abs(hp.nx) + Math.abs(hp.ny));
  const pen = hp.d - lo;
  if (pen <= 0) return 0;
  b.x += hp.nx * pen;
  b.y += hp.ny * pen;
  const vn = b.vx * hp.nx + b.vy * hp.ny;
  if (vn >= 0) return 0;
  b.vx -= (1 + e) * vn * hp.nx;
  b.vy -= (1 + e) * vn * hp.ny;
  return -vn;
}

export function circleHalfPlane(b: Body, rad: number, hp: HalfPlane): void {
  const pen = hp.d - (b.x * hp.nx + b.y * hp.ny - rad);
  if (pen <= 0) return;
  b.x += hp.nx * pen;
  b.y += hp.ny * pen;
  const vn = b.vx * hp.nx + b.vy * hp.ny;
  if (vn < 0) {
    b.vx -= vn * hp.nx;
    b.vy -= vn * hp.ny;
  }
}

/** Sliding friction (constant deceleration) plus light drag; never reverses the motion. */
export function applyFriction(b: Body, decel: number, drag: number, dtS: number): void {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp <= 1e-6) {
    b.vx = 0;
    b.vy = 0;
    return;
  }
  const next = Math.max(0, sp * Math.exp(-drag * dtS) - decel * dtS);
  const f = next / sp;
  b.vx *= f;
  b.vy *= f;
}

/** True when the whole footprint of a square lies inside the rect (tol = allowed overhang). */
export function boxInside(x: number, y: number, h: number, r: Rect, tol = 0): boolean {
  return x - h >= r.x - tol && x + h <= r.x + r.w + tol && y - h >= r.y - tol && y + h <= r.y + r.h + tol;
}

/** Index of the zone that fully contains the square, or -1. Zones may be null (slot not in play). */
export function zoneIndex(x: number, y: number, h: number, zones: readonly (Rect | null)[], tol = 0): number {
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (z && boxInside(x, y, h, z, tol)) return i;
  }
  return -1;
}

/** Points banked in each zone. */
export function zoneTotals(crates: readonly { zone: number; points: number }[], zoneCount: number): number[] {
  const out = new Array<number>(zoneCount).fill(0);
  for (const c of crates) if (c.zone >= 0 && c.zone < zoneCount) out[c.zone] += c.points;
  return out;
}

/** Corner index of a slot: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right. */
export function cornerRect(floor: Rect, corner: number, w: number, h: number): Rect {
  const right = corner % 2 === 1;
  const bottom = corner >= 2;
  return { x: right ? floor.x + floor.w - w : floor.x, y: bottom ? floor.y + floor.h - h : floor.y, w, h };
}

/** The floor corner point (on the fences) that a zone hugs. */
export function cornerPoint(floor: Rect, corner: number): { x: number; y: number } {
  return { x: corner % 2 === 1 ? floor.x + floor.w : floor.x, y: corner >= 2 ? floor.y + floor.h : floor.y };
}

/** Diagonal planter across an unused corner, so crates slide out instead of wedging there. */
export function cornerCut(floor: Rect, corner: number, leg: number): HalfPlane {
  const sx = corner % 2 === 1 ? -1 : 1;
  const sy = corner >= 2 ? -1 : 1;
  const k = Math.SQRT1_2;
  const c = cornerPoint(floor, corner);
  return { nx: sx * k, ny: sy * k, d: (sx * c.x + sy * c.y) * k + leg * k };
}

/**
 * Crate slots inside a corner zone (a cols × rows grid packed against the fences), ordered
 * deepest-first so the corner fills before the open edges.
 */
export function zoneSlots(zone: Rect, corner: number, size: number, cols: number, rows: number, gap = 2): { x: number; y: number }[] {
  const right = corner % 2 === 1;
  const bottom = corner >= 2;
  const out: { x: number; y: number; k: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = gap + size / 2 + c * (size + gap);
      const oy = gap + size / 2 + r * (size + gap);
      out.push({ x: right ? zone.x + zone.w - ox : zone.x + ox, y: bottom ? zone.y + zone.h - oy : zone.y + oy, k: r + c });
    }
  }
  return out.sort((a, b) => a.k - b.k).map(({ x, y }) => ({ x, y }));
}

/** Where to stand to push a crate at (cx, cy) towards (gx, gy): on its far side, `standoff` back. */
export function pushSpot(cx: number, cy: number, gx: number, gy: number, standoff: number): { x: number; y: number; dx: number; dy: number } {
  const ddx = gx - cx;
  const ddy = gy - cy;
  const m = Math.hypot(ddx, ddy) || 1;
  const dx = ddx / m;
  const dy = ddy / m;
  return { x: cx - dx * standoff, y: cy - dy * standoff, dx, dy };
}

/**
 * Waypoint for walking around a crate to reach its far side without shoving it the wrong way:
 * beside the crate (on the side the walker is already on) and a little behind it, so the final
 * approach to the push spot doesn't clip the crate's corner.
 */
export function detourPoint(px: number, py: number, cx: number, cy: number, dx: number, dy: number, clearance: number): { x: number; y: number } {
  const perpX = -dy;
  const perpY = dx;
  const side = (px - cx) * perpX + (py - cy) * perpY >= 0 ? 1 : -1;
  return { x: cx + perpX * side * clearance - dx * clearance * 0.85, y: cy + perpY * side * clearance - dy * clearance * 0.85 };
}

/** Distance from point p to the segment a→b. */
export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2)) : 0;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}
