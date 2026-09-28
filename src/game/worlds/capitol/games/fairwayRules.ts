// Fairway Frenzy: the putting green, its slopes, the ball physics and the scoring (no Phaser here,
// so they can be unit tested; the CPU golfers plan their shots with the same simulation).
//
// The green is seen through an orthographic camera GREEN_ELEV degrees above the ground (as its render,
// scripts/art/worlds/sports/mg_green.py). World coordinates: x = screen x, y = depth along the ground,
// so a ground point is on screen at (x, y * COSB); a height z lifts it by z * SINB. Units: world px
// (100 = 1 m), seconds.

/** Camera elevation of the green render, degrees (keep in step with mg_green.py). */
export const GREEN_ELEV = 55;
const BETA = ((90 - GREEN_ELEV) * Math.PI) / 180;
export const COSB = Math.cos(BETA);
export const SINB = Math.sin(BETA);

export interface Vec {
  x: number;
  y: number;
}

/** The green's outline on screen: a soft-lobed ellipse (keep in step with mg_green.py). */
export const GREEN = { cx: 960, cy: 616, rx: 500, ry: 255 };
/** The fringe (a band of longer grass) and the playable lawn around it (outline scale factors). */
export const FRINGE_K = 1.075;
/** The playable area: an ellipse on screen; the ball bounces softly off its edge (a low hedge). */
export const BOUNDS = { cx: 960, cy: 616, rx: 830, ry: 410 };
/** Sand bunkers (screen ellipses). */
export const BUNKERS = [
  { cx: 505, cy: 862, rx: 104, ry: 50 },
  { cx: 1425, cy: 364, rx: 110, ry: 50 },
];

/** Outline radius (in units of the green's radii) in direction a (screen angle). */
export function outlineK(a: number): number {
  return 1 + 0.05 * Math.sin(3 * a + 0.6) + 0.035 * Math.sin(5 * a + 2.1);
}

export type Surface = 'green' | 'fringe' | 'rough' | 'sand';

/** What the ball is sitting on at world point (x, y). */
export function surfaceAt(x: number, y: number): Surface {
  const sy = y * COSB;
  for (const b of BUNKERS) {
    const dx = (x - b.cx) / b.rx;
    const dy = (sy - b.cy) / b.ry;
    if (dx * dx + dy * dy <= 1) return 'sand';
  }
  const dx = (x - GREEN.cx) / GREEN.rx;
  const dy = (sy - GREEN.cy) / GREEN.ry;
  const r = Math.sqrt(dx * dx + dy * dy);
  const k = outlineK(Math.atan2(dy, dx));
  if (r <= k) return 'green';
  if (r <= k * FRINGE_K) return 'fringe';
  return 'rough';
}

/** Rolling friction (deceleration, px/s²) on each surface. */
export const FRICTION: Record<Surface, number> = { green: 190, fringe: 330, rough: 560, sand: 1500 };

/** Slopes: gentle hills and hollows (world px of height) on a green that falls towards the camera. */
export const BUMPS = [
  { x: 700, sy: 520, amp: 16, sx: 190, sw: 150 },
  { x: 1215, sy: 700, amp: -14, sx: 220, sw: 160 },
  { x: 990, sy: 440, amp: 9, sx: 300, sw: 110 },
  { x: 820, sy: 790, amp: -8, sx: 160, sw: 120 },
];
/** Height lost per world px towards the camera (the green's overall tilt). */
export const TILT = 0.018;
/**
 * Slope pull: acceleration = -G_SLOPE * gradient. A ball slower than STOP_V comes to rest wherever
 * the slope pulls less than the surface's rolling friction (everywhere on this green: the steepest
 * pull is about 110 px/s², the green's friction 190).
 */
export const G_SLOPE = 1500;
export const STOP_V = 7;

/** Height of the ground at world (x, y). */
export function heightAt(x: number, y: number): number {
  let h = -TILT * (y - GREEN.cy / COSB);
  for (const b of BUMPS) {
    const dx = (x - b.x) / b.sx;
    const dy = (y - b.sy / COSB) / (b.sw / COSB);
    h += b.amp * Math.exp(-0.5 * (dx * dx + dy * dy));
  }
  return h;
}

/** Ground gradient at world (x, y), written into `out`. */
export function gradAt(x: number, y: number, out: Vec): Vec {
  let gx = 0;
  let gy = -TILT;
  for (const b of BUMPS) {
    const sw = b.sw / COSB;
    const dx = x - b.x;
    const dy = y - b.sy / COSB;
    const e = b.amp * Math.exp(-0.5 * ((dx * dx) / (b.sx * b.sx) + (dy * dy) / (sw * sw)));
    gx -= (e * dx) / (b.sx * b.sx);
    gy -= (e * dy) / (sw * sw);
  }
  out.x = gx;
  out.y = gy;
  return out;
}

export const BALL_R = 9;
export const CUP_R = 16;
/** A ball this slow (px/s) rolling over the middle of the cup drops in; faster, it lips out. */
export const CAPTURE_V = 225;
/** How close to the cup's middle a rolling ball must pass to drop, and a chip must land to go straight in. */
export const CAPTURE_R = CUP_R - 3;
export const DUNK_R = CUP_R - 6;

/** Chips: carry (world px) for a power 0..1, flight time (s) and arc height (world px). */
export function chipCarry(p: number): number {
  return 60 + p * 720;
}
export function chipTime(carry: number): number {
  return 0.5 + carry / 1500;
}
export function chipApex(carry: number): number {
  return 40 + carry * 0.32;
}
/** Share of a chip's speed it keeps as it lands (the rest bites into the turf). */
export const BITE = 0.5;
/** A chip's first bounce kicks it up to this far off line (radians) and +-BOUNCE_SPEED of its speed. */
export const BOUNCE_TURN = 0.34;
export const BOUNCE_SPEED = 0.24;

/** The landing kick: turn and scale a landing velocity by two random numbers in 0..1. */
export function bounceKick(v: RollBall, r1: number, r2: number): void {
  const a = (r1 * 2 - 1) * BOUNCE_TURN;
  const k = 1 + (r2 * 2 - 1) * BOUNCE_SPEED;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const vx = v.vx * c - v.vy * s;
  const vy = v.vx * s + v.vy * c;
  v.vx = vx * k;
  v.vy = vy * k;
}
/** Wind: px/s² of drift per strength point, on the ball while it is in the air. */
export const WIND_ACCEL = 40;
/** Putts: distance the ball would roll on flat green for a power 0..1. */
export function puttDistance(p: number): number {
  return 20 + p * 700;
}
export function puttSpeed(p: number): number {
  return Math.sqrt(2 * FRICTION.green * puttDistance(p));
}

export interface RollBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const tmpG: Vec = { x: 0, y: 0 };

/**
 * One rolling step of dt seconds: the slope's pull (scaled by slopeK), rolling friction for the
 * surface under it and a soft bounce off the lawn's edge. Returns false once the ball is at rest.
 */
export function rollStep(b: RollBall, dt: number, slopeK = 1): boolean {
  gradAt(b.x, b.y, tmpG);
  const ax = -G_SLOPE * slopeK * tmpG.x;
  const ay = -G_SLOPE * slopeK * tmpG.y;
  const f = FRICTION[surfaceAt(b.x, b.y)];
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < STOP_V && Math.hypot(ax, ay) < f) {
    b.vx = 0;
    b.vy = 0;
    return false;
  }
  b.vx += ax * dt;
  b.vy += ay * dt;
  const sp2 = Math.hypot(b.vx, b.vy);
  const dec = f * dt;
  if (sp2 <= dec) {
    b.vx = 0;
    b.vy = 0;
  } else {
    b.vx -= (b.vx / sp2) * dec;
    b.vy -= (b.vy / sp2) * dec;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  keepInBounds(b);
  return true;
}

/** The lawn's edge: a ball rolling off it is turned back in, losing most of its speed. */
export function keepInBounds(b: RollBall): void {
  const dx = (b.x - BOUNDS.cx) / BOUNDS.rx;
  const dy = (b.y * COSB - BOUNDS.cy) / BOUNDS.ry;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r <= 1) return;
  // Pull back onto the edge and reflect the outward part of the velocity.
  b.x = BOUNDS.cx + (dx / r) * BOUNDS.rx;
  b.y = (BOUNDS.cy + (dy / r) * BOUNDS.ry) / COSB;
  let nx = dx / BOUNDS.rx;
  let ny = (dy / BOUNDS.ry) * COSB;
  const nl = Math.hypot(nx, ny) || 1;
  nx /= nl;
  ny /= nl;
  const vn = b.vx * nx + b.vy * ny;
  if (vn > 0) {
    b.vx = (b.vx - 1.3 * vn * nx) * 0.5;
    b.vy = (b.vy - 1.3 * vn * ny) * 0.5;
  }
}

export type ShotKind = 'chip' | 'putt';

/** A ball on the tee chips; otherwise it putts on the green or fringe and chips from rough or sand. */
export function shotKind(strokes: number, x: number, y: number): ShotKind {
  if (strokes === 0) return 'chip';
  const s = surfaceAt(x, y);
  return s === 'green' || s === 'fringe' ? 'putt' : 'chip';
}

export interface SimResult {
  holed: boolean;
  x: number;
  y: number;
  /** Seconds until it dropped or came to rest. */
  t: number;
}

const sim: RollBall = { x: 0, y: 0, vx: 0, vy: 0 };

/**
 * Where a shot ends up, ignoring the other balls: the chip's flight (with wind), then the roll. The
 * planner reads the green through slopeK and windK (1 = a perfect read).
 */
export function simulateShot(x: number, y: number, kind: ShotKind, angle: number, power: number, wind: Vec, cup: Vec, slopeK = 1, windK = 1, step = 1 / 60): SimResult {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let t = 0;
  if (kind === 'chip') {
    const C = chipCarry(power);
    const T = chipTime(C);
    const v = C / T;
    const wx = wind.x * windK;
    const wy = wind.y * windK;
    sim.x = x + dx * C + 0.5 * wx * T * T;
    sim.y = y + dy * C + 0.5 * wy * T * T;
    sim.vx = (dx * v + wx * T) * BITE;
    sim.vy = (dy * v + wy * T) * BITE;
    t = T;
    if (Math.hypot(sim.x - cup.x, sim.y - cup.y) < DUNK_R) return { holed: true, x: cup.x, y: cup.y, t };
    keepInBounds(sim);
  } else {
    const v = puttSpeed(power);
    sim.x = x;
    sim.y = y;
    sim.vx = dx * v;
    sim.vy = dy * v;
  }
  for (let i = 0; i < 600; i++) {
    const moving = rollStep(sim, step, slopeK);
    t += step;
    const d = Math.hypot(sim.x - cup.x, sim.y - cup.y);
    if (d < CAPTURE_R && Math.hypot(sim.vx, sim.vy) < CAPTURE_V) return { holed: true, x: cup.x, y: cup.y, t };
    if (!moving) break;
  }
  return { holed: false, x: sim.x, y: sim.y, t };
}

/** Points for holing out in n strokes (x2 in the final stretch). */
export function holePoints(strokes: number, double: boolean): number {
  const base = strokes <= 1 ? 5 : strokes === 2 ? 3 : strokes === 3 ? 2 : 0;
  return base * (double ? 2 : 1);
}
export const MAX_STROKES = 3;
/** The bonus for the ball resting closest to the pin when a hole's time runs out. */
export const CLOSEST_POINTS = 2;

/** Round length and the three holes' windows (ms since GO); between them, a short break. */
export const ROUND_MS = 50000;
export const HOLES = [
  { start: 0, end: 15500 },
  { start: 17000, end: 32500 },
  { start: 34000, end: 50000 },
];
/** Each hole's cup (screen px on the green). */
export const CUPS = [
  { x: 960, sy: 616 },
  { x: 1070, sy: 660 },
  { x: 850, sy: 575 },
];
/** Every tee is this far (world px) from its hole's cup, one per quadrant. */
export const TEE_DIST = 540;
const TEE_ANGLES = [205, 335, 155, 25].map((d) => (d * Math.PI) / 180);

/** Cup of hole h in world coordinates. */
export function cupOf(h: number): Vec {
  const c = CUPS[Math.max(0, Math.min(CUPS.length - 1, h))];
  return { x: c.x, y: c.sy / COSB };
}

/** Tee of player index i on hole h (world): the quadrants rotate from hole to hole. */
export function teeOf(h: number, i: number): Vec {
  const cup = cupOf(h);
  const a = TEE_ANGLES[(i + h) % 4];
  return { x: cup.x + Math.cos(a) * TEE_DIST, y: cup.y + Math.sin(a) * TEE_DIST };
}

/** Which hole is on at game time t, and whether it is in play or in the break after it. */
export function holeAt(t: number): { hole: number; playing: boolean } {
  for (let h = 0; h < HOLES.length; h++) {
    if (t < HOLES[h].end) return { hole: h, playing: t >= HOLES[h].start };
  }
  return { hole: HOLES.length - 1, playing: false };
}

/** The unholed ball resting closest to the pin (index into balls), or -1: it must have been hit this attempt. */
export function closestToPin(balls: readonly { x: number; y: number; strokes: number; holed: boolean }[], cup: Vec): number {
  let best = -1;
  let bestD = Infinity;
  balls.forEach((b, i) => {
    if (b.holed || b.strokes < 1) return;
    const d = Math.hypot(b.x - cup.x, b.y - cup.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Wind for hole h from a random source: direction (world angle) and strength 0..3 (the last hole blows harder). */
export function windFor(h: number, rnd: () => number): { angle: number; strength: number; vec: Vec } {
  const angle = rnd() * Math.PI * 2;
  const strength = h === HOLES.length - 1 ? 2 + Math.floor(rnd() * 2) : Math.floor(rnd() * 3.2);
  const k = strength * WIND_ACCEL;
  return { angle, strength, vec: { x: Math.cos(angle) * k, y: Math.sin(angle) * k } };
}
