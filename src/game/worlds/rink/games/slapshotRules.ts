// Slapshot Showdown: the rink, its four goals, puck and skater collisions and the scoring (no Phaser
// here, so they can be unit tested).
//
// The rink is seen through an orthographic camera RINK_ELEV degrees above the ice (as its render,
// scripts/art/worlds/sports/mg_rink.py). World coordinates: x = screen x, y = depth along the ice, so
// an ice point is on screen at (x, y * COSB); a height z lifts it by z * SINB. Units: world px, seconds.

/** Camera elevation of the rink render, degrees (keep in step with mg_rink.py). */
export const RINK_ELEV = 62;
const BETA = ((90 - RINK_ELEV) * Math.PI) / 180;
export const COSB = Math.cos(BETA);
export const SINB = Math.sin(BETA);

export interface Vec {
  x: number;
  y: number;
}
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** The ice: a rounded square (world px) centred on screen (960, 628). */
export const RINK = { cx: 960, cy: 628 / COSB, half: 450, corner: 130 };
/** Goals: mouth width, net depth (towards the boards) and how far the goal line sits inside the boards. */
export const GOAL = { w: 180, d: 52, inset: 60, post: 8 };
export const PUCK_R = 13;
export const SKATER_R = 34;

/** Rink sides, in the order goals are handed out: left, right, top (far), bottom (near). */
export type Side = 0 | 1 | 2 | 3;
export const LEFT: Side = 0;
export const RIGHT: Side = 1;
export const TOP: Side = 2;
export const BOTTOM: Side = 3;

/** The goal each player guards, by player count (2: face to face; 3: plus the near end; 4: every side). */
export function goalSides(n: number): Side[] {
  if (n <= 1) return [BOTTOM];
  if (n === 2) return [LEFT, RIGHT];
  if (n === 3) return [LEFT, RIGHT, BOTTOM];
  return [LEFT, RIGHT, TOP, BOTTOM];
}

export interface GoalGeom {
  side: Side;
  /** Centre of the mouth on the goal line (world). */
  mx: number;
  my: number;
  /** Unit vector pointing out of the rink through this goal (into the net). */
  nx: number;
  ny: number;
  /** Unit vector along the goal line. */
  tx: number;
  ty: number;
  /** The frame: two posts and three net walls (back, and a side each), as segments (world). */
  posts: Vec[];
  walls: [Vec, Vec][];
}

export function goalGeom(side: Side): GoalGeom {
  const { cx, cy, half } = RINK;
  const off = half - GOAL.inset;
  const nx = side === LEFT ? -1 : side === RIGHT ? 1 : 0;
  const ny = side === TOP ? -1 : side === BOTTOM ? 1 : 0;
  const tx = -ny;
  const ty = nx;
  const mx = cx + nx * off;
  const my = cy + ny * off;
  const hw = GOAL.w / 2;
  const p1 = { x: mx + tx * hw, y: my + ty * hw };
  const p2 = { x: mx - tx * hw, y: my - ty * hw };
  const b1 = { x: p1.x + nx * GOAL.d, y: p1.y + ny * GOAL.d };
  const b2 = { x: p2.x + nx * GOAL.d, y: p2.y + ny * GOAL.d };
  return { side, mx, my, nx, ny, tx, ty, posts: [p1, p2], walls: [[b1, b2], [p1, b1], [p2, b2]] };
}

/**
 * Keep a circle of radius r inside the rounded-square boards, reflecting its velocity with
 * restitution e. Returns the speed of the impact (0 when it didn't touch).
 */
export function boards(b: Body, r: number, e: number): number {
  const { cx, cy, half, corner } = RINK;
  const lim = half - r;
  const cr = corner - r;
  const inner = half - corner;
  let dx = b.x - cx;
  let dy = b.y - cy;
  let hit = 0;
  if (Math.abs(dx) > inner && Math.abs(dy) > inner) {
    // In a corner: stay within the corner's arc.
    const ox = Math.sign(dx) * inner;
    const oy = Math.sign(dy) * inner;
    const qx = dx - ox;
    const qy = dy - oy;
    const d = Math.hypot(qx, qy);
    if (d > cr && d > 0) {
      const nx = qx / d;
      const ny = qy / d;
      dx = ox + nx * cr;
      dy = oy + ny * cr;
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) {
        b.vx -= (1 + e) * vn * nx;
        b.vy -= (1 + e) * vn * ny;
        hit = vn;
      }
    }
  } else {
    if (dx > lim || dx < -lim) {
      dx = Math.sign(dx) * lim;
      if (b.vx * Math.sign(dx) > 0) {
        hit = Math.abs(b.vx);
        b.vx = -b.vx * e;
      }
    }
    if (dy > lim || dy < -lim) {
      dy = Math.sign(dy) * lim;
      if (b.vy * Math.sign(dy) > 0) {
        hit = Math.max(hit, Math.abs(b.vy));
        b.vy = -b.vy * e;
      }
    }
  }
  b.x = cx + dx;
  b.y = cy + dy;
  return hit;
}

/** Push a circle out of a segment (from either side), reflecting its velocity. Returns the impact speed. */
export function segment(b: Body, r: number, a: Vec, c: Vec, e: number): number {
  const sx = c.x - a.x;
  const sy = c.y - a.y;
  const L2 = sx * sx + sy * sy || 1;
  let u = ((b.x - a.x) * sx + (b.y - a.y) * sy) / L2;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const px = a.x + sx * u;
  const py = a.y + sy * u;
  const dx = b.x - px;
  const dy = b.y - py;
  const d = Math.hypot(dx, dy);
  if (d >= r || d < 1e-6) return 0;
  const nx = dx / d;
  const ny = dy / d;
  b.x = px + nx * r;
  b.y = py + ny * r;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return 0;
  b.vx -= (1 + e) * vn * nx;
  b.vy -= (1 + e) * vn * ny;
  return -vn;
}

/** Bounce a circle off a goal's posts and net walls. Returns the hardest impact speed. */
export function goalFrame(b: Body, r: number, g: GoalGeom, e: number): number {
  let hit = 0;
  for (const p of g.posts) hit = Math.max(hit, segment(b, r + GOAL.post, p, p, e));
  for (const [a, c] of g.walls) hit = Math.max(hit, segment(b, r + 3, a, c, e));
  return hit;
}

/** Did the puck's centre cross this goal's line between the posts, heading into the net? */
export function crossedGoal(px: number, py: number, x: number, y: number, g: GoalGeom): boolean {
  const before = (px - g.mx) * g.nx + (py - g.my) * g.ny;
  const after = (x - g.mx) * g.nx + (y - g.my) * g.ny;
  if (before > 0 || after <= 0) return false;
  const along = (x - g.mx) * g.tx + (y - g.my) * g.ty;
  return Math.abs(along) < GOAL.w / 2 - PUCK_R * 0.5;
}

/**
 * Aim assist, the same for everyone (an eight-way keyboard can still pick a corner): a shot from
 * (px, py) already heading between some goal's posts is left alone; one missing a mouth by less than
 * ASSIST radians is turned onto the nearest point inside the posts. `own` (the shooter's goal) is
 * skipped. Reads and writes unit vectors; `out` may be `aim`.
 */
export const ASSIST = 0.24;
export function assistAim(aim: Vec, px: number, py: number, goals: readonly GoalGeom[], own: Side | -1, out: Vec): Vec {
  const ax = aim.x;
  const ay = aim.y;
  let best = ASSIST;
  let tx = 0;
  let ty = 0;
  for (const g of goals) {
    if (g.side === own) continue;
    const inset = GOAL.w / 2 - 26;
    const x1 = g.mx + g.tx * inset - px;
    const y1 = g.my + g.ty * inset - py;
    const x2 = g.mx - g.tx * inset - px;
    const y2 = g.my - g.ty * inset - py;
    const c12 = x1 * y2 - y1 * x2;
    const between = (x1 * ay - y1 * ax) * c12 >= 0 && (ax * y2 - ay * x2) * c12 >= 0 && ax * (x1 + x2) + ay * (y1 + y2) > 0;
    if (between) {
      out.x = ax;
      out.y = ay;
      return out;
    }
    for (let k = 0; k < 2; k++) {
      const ex = k ? x2 : x1;
      const ey = k ? y2 : y1;
      const d = Math.hypot(ex, ey) || 1;
      const off = Math.acos(Math.max(-1, Math.min(1, (ax * ex + ay * ey) / d)));
      if (off < best) {
        best = off;
        tx = ex / d;
        ty = ey / d;
      }
    }
  }
  out.x = best < ASSIST ? tx : ax;
  out.y = best < ASSIST ? ty : ay;
  return out;
}

/** Points for a goal: the shooter +2 (not for an own goal), the goal's owner -1 (never below zero). */
export const GOAL_POINTS = 2;
export const CONCEDE_POINTS = 1;
export function scoreGoal(scores: number[], shooter: number, owner: number): void {
  if (shooter >= 0 && shooter !== owner) scores[shooter] += GOAL_POINTS;
  if (owner >= 0) scores[owner] = Math.max(0, scores[owner] - CONCEDE_POINTS);
}

/** Shot speed (px/s) for a wind-up of 0..1: a tap is a pass, a full wind-up a rocket. */
export function shotSpeed(charge: number): number {
  return 620 + 1180 * Math.max(0, Math.min(1, charge));
}
export const WINDUP_MS = 750;
/** The puck on the ice: constant friction (px/s²) plus a little drag (1/s); board bounce. */
export const PUCK_FRICTION = 95;
export const PUCK_DRAG = 0.22;
export const PUCK_BOUNCE = 0.82;

/** One slide step for the puck (no collisions). */
export function slide(b: Body, dt: number): void {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > 0) {
    const k = Math.max(0, sp - PUCK_FRICTION * dt) / sp;
    const d = Math.exp(-PUCK_DRAG * dt);
    b.vx *= k * d;
    b.vy *= k * d;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}

/**
 * Where a sliding puck will be after t seconds (ignoring walls), for CPUs leading a loose puck: the
 * exact solution of dv/dt = -F - D v (constant friction plus drag), which slide() integrates.
 */
export function predict(b: Body, t: number, out: Vec): Vec {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < 1) {
    out.x = b.x;
    out.y = b.y;
    return out;
  }
  const F = PUCK_FRICTION;
  const D = PUCK_DRAG;
  const tStop = Math.log(1 + (D * sp) / F) / D;
  const tt = Math.min(t, tStop);
  const dist = ((sp + F / D) * (1 - Math.exp(-D * tt))) / D - (F / D) * tt;
  out.x = b.x + (b.vx / sp) * dist;
  out.y = b.y + (b.vy / sp) * dist;
  return out;
}

/** Round length, and the second puck that drops in for the final stretch. */
export const ROUND_MS = 60000;
