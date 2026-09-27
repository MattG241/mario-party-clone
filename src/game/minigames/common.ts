// Shared movement helpers for minigames: responsive acceleration, moderate friction, no
// floatiness. All times in milliseconds, speeds in px/s.

export interface Mover {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SteerOpts {
  maxSpeed: number;
  /** Approach rate toward the target velocity while there is input (1/s). */
  accel: number;
  /** Decay rate when there is no input (1/s). */
  friction: number;
}

export const DEFAULT_STEER: SteerOpts = { maxSpeed: 430, accel: 14, friction: 8 };

/** Move toward the stick's target velocity with exponential smoothing. */
export function steer(m: Mover, ix: number, iy: number, dtMs: number, o: SteerOpts = DEFAULT_STEER): void {
  const s = dtMs / 1000;
  const mag = Math.hypot(ix, iy);
  if (mag > 1) {
    ix /= mag;
    iy /= mag;
  }
  const has = mag > 0.05;
  const rate = has ? o.accel : o.friction;
  const k = 1 - Math.exp(-rate * s);
  m.vx += (ix * o.maxSpeed - m.vx) * k;
  m.vy += (iy * o.maxSpeed - m.vy) * k;
  m.x += m.vx * s;
  m.y += m.vy * s;
}

/** Apply velocity without steering (knockback, dashes). */
export function drift(m: Mover, dtMs: number, damping = 6): void {
  const s = dtMs / 1000;
  const k = Math.exp(-damping * s);
  m.vx *= k;
  m.vy *= k;
  m.x += m.vx * s;
  m.y += m.vy * s;
}

/** Push two circles apart; heavier movers budge less. */
export function separate(a: Mover, b: Mover, minDist: number, weightA = 1, weightB = 1): boolean {
  const dx = b.x - a.x;
  const dy = (b.y - a.y) * 1.6;
  const d = Math.hypot(dx, dy);
  if (d >= minDist || d === 0) return false;
  const push = (minDist - d) / d;
  const total = weightA + weightB;
  a.x -= dx * push * (weightB / total);
  a.y -= (dy / 1.6) * push * (weightB / total);
  b.x += dx * push * (weightA / total);
  b.y += (dy / 1.6) * push * (weightA / total);
  return true;
}

export function clampRect(m: Mover, x: number, y: number, w: number, h: number): boolean {
  let hit = false;
  if (m.x < x) {
    m.x = x;
    m.vx = Math.abs(m.vx) * 0.2;
    hit = true;
  } else if (m.x > x + w) {
    m.x = x + w;
    m.vx = -Math.abs(m.vx) * 0.2;
    hit = true;
  }
  if (m.y < y) {
    m.y = y;
    m.vy = Math.abs(m.vy) * 0.2;
    hit = true;
  } else if (m.y > y + h) {
    m.y = y + h;
    m.vy = -Math.abs(m.vy) * 0.2;
    hit = true;
  }
  return hit;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Smallest signed angle difference a−b in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
