// Web Swing: the skyline course (anchor points along a street canyon), the web-swinging pendulum,
// the release judgement and the CPU swinger. Pure (no Phaser), so the physics and the CPUs can be
// unit tested and simulated. World x runs along the course; y is screen y (the camera only scrolls
// sideways). px, px/s, ms.
import { Random } from '../../util/Random';

export const SWING = {
  GRAV: 1500,
  /** Air drag (1/s) and top speed. */
  DRAG: 0.12,
  MAX_SPEED: 1050,
  /** Steering in the air with the stick. */
  AIR_CTRL: 340,
  /** A web reaches this far (and no shorter than MIN_ROPE). */
  RANGE: 640,
  MIN_ROPE: 150,
  /** Swinging below the anchor you pump a little speed along the arc (the fling does the rest). */
  PUMP: 180,
  /** Long webs reel in towards REEL_TO. */
  REEL: 300,
  REEL_TO: 420,
  /**
   * Release window: the angle of travel above the horizontal (degrees) as you let go. Letting go as
   * the swing starts to rise flings you furthest (PERFECT); a steeper or flatter release is GOOD;
   * still falling is too EARLY, nearly at the top too LATE.
   */
  PERFECT_LO: 5,
  PERFECT_HI: 28,
  GOOD_LO: 0,
  GOOD_HI: 45,
  PERFECT_BOOST: 1.1,
  PERFECT_ADD: 90,
  GOOD_BOOST: 1.03,
  /** The street: touch it and you're down, then a web zips you back up. */
  STREET_Y: 985,
  DOWN_MS: 650,
  ZIP_MS: 560,
  ZIP_TO_Y: 560,
  /** Start rooftop. */
  ROOF_Y: 700,
  ROOF_END: 640,
  RUN: 520,
  JUMP_VY: 760,
  /** The body's centre sits this far above the feet. */
  BODY: 60,
  /** Finish tower: its front edge, and the roof the winners land on. */
  FINISH_ROOF_Y: 520,
} as const;

export type AnchorKind = 'cornice' | 'mast' | 'tank' | 'crane';

export interface Anchor {
  x: number;
  y: number;
  kind: AnchorKind;
}

export interface Course {
  anchors: Anchor[];
  /** x of the finish tower's front: cross it and you're home. */
  finish: number;
}

/** Course length (to the finish tower) and the anchors' spacing and heights. */
export const COURSE_LEN = 29000;
const FIRST_X = 760;
const GAP_MIN = 330;
const GAP_MAX = 500;
const Y_HI = 215;
const Y_LO = 420;

/**
 * A seeded course: anchors every GAP_MIN..GAP_MAX px at varied heights, now and then a long gap
 * (reachable with a good release) or a low one; the last anchors lead up to the finish tower.
 */
export function buildCourse(rng: Random): Course {
  const anchors: Anchor[] = [];
  let x = FIRST_X;
  let prevY = 300;
  const kinds: AnchorKind[] = ['cornice', 'mast', 'tank', 'crane'];
  const last = COURSE_LEN - 200;
  while (x < last - 340) {
    let y = Math.round(rng.range(Y_HI, Y_LO));
    // keep neighbours from jumping more than ~170 px in height
    y = Math.max(prevY - 170, Math.min(prevY + 170, y));
    anchors.push({ x: Math.round(x), y, kind: rng.pick(kinds) });
    prevY = y;
    const long = rng.chance(0.12);
    x += long ? rng.range(520, 580) : rng.range(GAP_MIN, GAP_MAX);
  }
  // The last one, high on the finish tower's shoulder, swings you home (with one more in between if
  // the gap would be too wide).
  const prev = anchors[anchors.length - 1];
  if (last - prev.x > 540) anchors.push({ x: Math.round((prev.x + last) / 2), y: Math.round(Math.max(Y_HI, Math.min(Y_LO, (prev.y + 250) / 2))), kind: rng.pick(kinds) });
  anchors.push({ x: last, y: 250, kind: 'cornice' });
  return { anchors, finish: COURSE_LEN };
}

export type SwingMode = 'roof' | 'air' | 'swing' | 'down' | 'zip' | 'done';

export interface Swinger {
  /** Body centre. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  mode: SwingMode;
  /** Anchor index while swinging (-1 = none), and the rope's length. */
  anchor: number;
  rope: number;
  /** Timer for 'down' and 'zip'; a zip runs from zipFrom, zipDX along and up to ZIP_TO_Y. */
  t: number;
  zipFrom: { x: number; y: number };
  zipDX: number;
  face: 1 | -1;
  /** Swings chained since the last fall (for the combo call-outs). */
  chain: number;
}

export interface SwingInput {
  stickX: number;
  holdA: boolean;
  pressA: boolean;
}

export type Release = 'perfect' | 'good' | 'early' | 'late' | 'back' | null;

export interface SwingEvents {
  /** A web took hold (anchor index + 1; 0 = none) — or missed (no anchor in reach). */
  attach: number;
  miss: boolean;
  release: Release;
  jump: boolean;
  /** Hit the street (speed at impact; 0 = none). */
  down: number;
  zipped: boolean;
  /** Back up after a zip. */
  up: boolean;
}

export function newEvents(): SwingEvents {
  return { attach: 0, miss: false, release: null, jump: false, down: 0, zipped: false, up: false };
}

function clearEvents(e: SwingEvents): void {
  e.attach = 0;
  e.miss = false;
  e.release = null;
  e.jump = false;
  e.down = 0;
  e.zipped = false;
  e.up = false;
}

export function newSwinger(x: number): Swinger {
  return { x, y: SWING.ROOF_Y - SWING.BODY, vx: 0, vy: 0, mode: 'roof', anchor: -1, rope: 0, t: 0, zipFrom: { x, y: 0 }, zipDX: 140, face: 1, chain: 0 };
}

/**
 * The anchor a web shot from (x, y) would catch: the nearest one in reach that is above you and not
 * behind you (a little bias to ones ahead), or -1. `from` narrows the search to indices near `hint`.
 */
export function pickAnchor(anchors: readonly Anchor[], x: number, y: number, hint = 0): number {
  let best = -1;
  let bestScore = Infinity;
  const i0 = Math.max(0, firstAnchorAfter(anchors, x - SWING.RANGE, hint));
  for (let i = i0; i < anchors.length; i++) {
    const a = anchors[i];
    if (a.x > x + SWING.RANGE) break;
    if (a.x < x - 60 || a.y > y - 70) continue;
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < SWING.MIN_ROPE || d > SWING.RANGE) continue;
    const score = d - 0.55 * (a.x - x);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Index of the first anchor at or beyond x (anchors are sorted by x), searching from `hint`. */
export function firstAnchorAfter(anchors: readonly Anchor[], x: number, hint = 0): number {
  let i = Math.max(0, Math.min(anchors.length - 1, hint));
  while (i > 0 && anchors[i - 1].x >= x) i--;
  while (i < anchors.length && anchors[i].x < x) i++;
  return i;
}

/** Judge a release by the angle of travel above the horizontal (degrees) while moving forward. */
export function judgeRelease(vx: number, vy: number): Release {
  if (vx <= 40) return 'back';
  const deg = (Math.atan2(-vy, vx) * 180) / Math.PI;
  if (deg >= SWING.PERFECT_LO && deg <= SWING.PERFECT_HI) return 'perfect';
  if (deg >= SWING.GOOD_LO && deg <= SWING.GOOD_HI) return 'good';
  return deg < SWING.GOOD_LO ? 'early' : 'late';
}

function attach(s: Swinger, anchors: readonly Anchor[], out: SwingEvents): boolean {
  const i = pickAnchor(anchors, s.x, s.y, s.anchor >= 0 ? s.anchor : 0);
  if (i < 0) {
    out.miss = true;
    return false;
  }
  const a = anchors[i];
  s.anchor = i;
  s.rope = Math.hypot(a.x - s.x, a.y - s.y);
  s.mode = 'swing';
  out.attach = i + 1;
  // The web's snap takes out some of the speed straight away from the anchor (it goes taut).
  const nx = (s.x - a.x) / s.rope;
  const ny = (s.y - a.y) / s.rope;
  const vr = s.vx * nx + s.vy * ny;
  if (vr > 0) {
    s.vx -= vr * nx * 0.7;
    s.vy -= vr * ny * 0.7;
  }
  return true;
}

function capSpeed(s: Swinger): void {
  const v = Math.hypot(s.vx, s.vy);
  if (v > SWING.MAX_SPEED) {
    s.vx *= SWING.MAX_SPEED / v;
    s.vy *= SWING.MAX_SPEED / v;
  }
}

/**
 * One step of a swinger. Press A to web the nearest anchor in reach; hold to swing (you pump speed
 * through the bottom of the arc); let go to fly on, ideally near the top of the forward swing.
 * Touching the street knocks you down; a web then zips you back up.
 */
export function stepSwinger(s: Swinger, inp: SwingInput, course: Course, dt: number, out: SwingEvents): void {
  clearEvents(out);
  const sec = dt / 1000;
  const A = course.anchors;
  if (Math.abs(inp.stickX) > 0.3) s.face = inp.stickX > 0 ? 1 : -1;
  switch (s.mode) {
    case 'done':
      return;
    case 'down':
      s.t -= dt;
      s.vx = 0;
      s.vy = 0;
      if (s.t <= 0) {
        s.mode = 'zip';
        s.t = SWING.ZIP_MS;
        s.zipFrom.x = s.x;
        s.zipFrom.y = s.y;
        s.zipDX = 140;
        out.zipped = true;
      }
      return;
    case 'zip': {
      s.t -= dt;
      const u = 1 - Math.max(0, s.t) / SWING.ZIP_MS;
      const e = 1 - (1 - u) * (1 - u) * (1 - u);
      s.x = s.zipFrom.x + s.zipDX * e;
      s.y = s.zipFrom.y + (SWING.ZIP_TO_Y - s.zipFrom.y) * e;
      if (s.t <= 0) {
        s.mode = 'air';
        s.vx = 420;
        s.vy = -260;
        s.anchor = -1;
        out.up = true;
      }
      return;
    }
    case 'roof': {
      s.vx += (inp.stickX * SWING.RUN - s.vx) * (1 - Math.exp(-10 * sec));
      if (inp.pressA && !attach(s, A, out)) {
        s.mode = 'air';
        s.vy = -SWING.JUMP_VY;
        s.vx = Math.max(s.vx, 260);
        out.jump = true;
        return;
      }
      if (modeOf(s) === 'swing') return;
      s.x += s.vx * sec;
      if (s.x > SWING.ROOF_END) {
        s.mode = 'air';
        s.vy = 0;
      } else {
        s.x = Math.max(60, s.x);
        s.y = SWING.ROOF_Y - SWING.BODY;
      }
      return;
    }
    case 'air': {
      if (inp.pressA && attach(s, A, out)) break;
      s.vx += inp.stickX * SWING.AIR_CTRL * sec;
      s.vy += SWING.GRAV * sec;
      const k = Math.exp(-SWING.DRAG * sec);
      s.vx *= k;
      s.vy *= k;
      capSpeed(s);
      s.x += s.vx * sec;
      s.y += s.vy * sec;
      if (s.y < 150) {
        s.y = 150;
        if (s.vy < 0) s.vy = 0;
      }
      break;
    }
    case 'swing':
      break;
  }
  if (s.mode === 'swing') {
    if (!inp.holdA) {
      out.release = judgeRelease(s.vx, s.vy);
      releaseBoost(s, out.release);
      s.mode = 'air';
      s.chain++;
      s.x += s.vx * sec;
      s.y += s.vy * sec;
    } else stepPendulum(s, A[s.anchor], inp, sec);
  }
  if (s.y + SWING.BODY >= SWING.STREET_Y && modeOf(s) !== 'roof') {
    out.down = Math.hypot(s.vx, s.vy) || 1;
    s.y = SWING.STREET_Y - SWING.BODY;
    s.mode = 'down';
    s.t = SWING.DOWN_MS;
    s.anchor = -1;
    s.chain = 0;
    s.vx = 0;
    s.vy = 0;
  }
  const m = modeOf(s);
  if (s.x >= course.finish && m !== 'down' && m !== 'zip') s.mode = 'done';
}

/** A swinger's mode, read afresh (the step changes it on the way through). */
function modeOf(s: Swinger): SwingMode {
  return s.mode;
}

function releaseBoost(s: Swinger, r: Release): void {
  if (r === 'perfect') {
    const v = Math.hypot(s.vx, s.vy) || 1;
    s.vx = s.vx * SWING.PERFECT_BOOST + (s.vx / v) * SWING.PERFECT_ADD;
    s.vy = s.vy * SWING.PERFECT_BOOST + (s.vy / v) * SWING.PERFECT_ADD;
  } else if (r === 'good') {
    s.vx *= SWING.GOOD_BOOST;
    s.vy *= SWING.GOOD_BOOST;
  }
  capSpeed(s);
}

/** Pendulum on an inextensible (but slack-able) web, with pumping through the bottom and a reel-in. */
function stepPendulum(s: Swinger, a: Anchor, inp: SwingInput, sec: number): void {
  s.vy += SWING.GRAV * sec;
  let dx = s.x - a.x;
  let dy = s.y - a.y;
  let d = Math.hypot(dx, dy) || 1;
  // Pump along the direction of travel while below the anchor (stick forward pumps a little harder).
  if (dy > 0) {
    const tx = -dy / d;
    const ty = dx / d;
    const vt = s.vx * tx + s.vy * ty;
    if (Math.abs(vt) > 40) {
      const push = SWING.PUMP * (dy / d) * (1 + 0.25 * Math.max(0, inp.stickX * Math.sign(vt * tx)));
      s.vx += Math.sign(vt) * tx * push * sec;
      s.vy += Math.sign(vt) * ty * push * sec;
    }
  }
  if (s.rope > SWING.REEL_TO) s.rope = Math.max(SWING.REEL_TO, s.rope - SWING.REEL * sec);
  capSpeed(s);
  s.x += s.vx * sec;
  s.y += s.vy * sec;
  dx = s.x - a.x;
  dy = s.y - a.y;
  d = Math.hypot(dx, dy) || 1;
  if (d > s.rope) {
    const nx = dx / d;
    const ny = dy / d;
    s.x = a.x + nx * s.rope;
    s.y = a.y + ny * s.rope;
    const vr = s.vx * nx + s.vy * ny;
    if (vr > 0) {
      s.vx -= vr * nx;
      s.vy -= vr * ny;
    }
  }
}

// --- Race standing ---------------------------------------------------------------------------

/** Pull a straggler back into the picture: a web zip from where they are to `toX`, up high. */
export function catchUp(s: Swinger, toX: number): void {
  s.mode = 'zip';
  s.t = SWING.ZIP_MS;
  s.zipFrom.x = s.x;
  s.zipFrom.y = s.y;
  s.zipDX = toX - s.x;
  s.anchor = -1;
}

/** Race score: finishers by time (sooner is better), then everyone else by distance. */
export function raceScore(done: boolean, doneAt: number, x: number): { score: number; label: string } {
  if (done) return { score: 100000 - doneAt, label: `${(doneAt / 1000).toFixed(1)} s` };
  const pct = Math.max(0, Math.min(99, Math.floor((x / COURSE_LEN) * 100)));
  return { score: Math.max(0, Math.round(x)), label: `${pct}% of the way` };
}

export function ordinal(n: number): string {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}

// --- CPU swinger -----------------------------------------------------------------------------

export interface SwingSkill {
  reaction: number;
  accuracy: number;
  mistake: number;
  aimNoise: number;
  think: number;
}

export interface SwingBrain {
  /** Release angle aimed for on this swing (degrees), and a slip planned for it. */
  aim: number;
  /** Wait before acting on the start roof (reaction). */
  wait: number;
  /** A late web (a slip, decided once per flight): hold off attaching until this low. */
  lateY: number;
  planned: boolean;
  swingId: number;
  holding: boolean;
}

export function newBrain(): SwingBrain {
  return { aim: 40, wait: -1, lateY: 0, planned: false, swingId: -1, holding: false };
}

/**
 * The CPU swinger: webs the next anchor when it sits well ahead and above, releases near the top of
 * the forward swing at an angle it aims for (worse swingers aim wider of the sweet spot, react
 * later and now and then let go far too early or web too late and hit the street).
 */
export function swingCpu(b: SwingBrain, s: Swinger, course: Course, sk: SwingSkill, dt: number, rnd: () => number, inp: SwingInput): SwingInput {
  inp.stickX = 1;
  inp.pressA = false;
  inp.holdA = b.holding;
  const A = course.anchors;
  if (s.mode !== 'air') b.planned = false;
  switch (s.mode) {
    case 'roof': {
      if (b.wait < 0) b.wait = sk.reaction * (0.7 + rnd() * 0.6);
      b.wait -= dt;
      const i = pickAnchor(A, s.x, s.y);
      if (b.wait <= 0 && i >= 0 && A[i].x - s.x > 80) press(b, inp);
      return inp;
    }
    case 'swing': {
      if (b.swingId !== s.anchor) {
        // A new swing: pick the release angle to aim for (and, sometimes, a slip).
        b.swingId = s.anchor;
        // Better swingers aim lower in the window (a flatter, faster fling) and closer to it.
        const spread = 3 + sk.aimNoise * 28;
        b.aim = 24 - 14 * sk.accuracy + (rnd() - 0.5) * 2 * spread;
        if (rnd() < sk.mistake) b.aim = rnd() < 0.5 ? -12 + rnd() * 10 : 50 + rnd() * 14;
      }
      const deg = (Math.atan2(-s.vy, s.vx) * 180) / Math.PI;
      // Reaction: the CPU lets go a little after it sees the angle (the angle keeps climbing).
      const lag = (sk.reaction / 1000) * 0.25 * Math.max(1, Math.hypot(s.vx, s.vy) / 900) * 40;
      const ready = s.vx > 60 && deg >= b.aim - lag;
      // Never ride a swing into the street.
      const a = A[s.anchor];
      const low = s.y > SWING.STREET_Y - 120 && s.vy > 0 && a.y > s.y - 200;
      if (ready || low) b.holding = false;
      inp.holdA = b.holding;
      return inp;
    }
    case 'air': {
      b.swingId = -1;
      const i = pickAnchor(A, s.x, s.y);
      if (i < 0) {
        b.holding = false;
        inp.holdA = false;
        return inp;
      }
      const a = A[i];
      const ahead = a.x - s.x;
      const up = s.y - a.y;
      // A good catch: the anchor ahead and above at a decent angle, and falling (or about to).
      const angle = Math.atan2(ahead, up);
      const good = angle > 0.25 && angle < 1.05 && s.vy > -120;
      const urgent = s.y > 700 && s.vy > 0;
      if (!b.planned) {
        b.planned = true;
        b.lateY = rnd() < sk.mistake * 0.5 ? 800 + rnd() * 120 : 0;
      }
      const slip = b.lateY > 0 && s.y < b.lateY;
      if ((good || urgent) && !slip) {
        b.lateY = 0;
        press(b, inp);
      } else {
        b.holding = false;
        inp.holdA = false;
      }
      return inp;
    }
    default:
      b.holding = false;
      inp.holdA = false;
      return inp;
  }
}

function press(b: SwingBrain, inp: SwingInput): void {
  if (!b.holding) inp.pressA = true;
  b.holding = true;
  inp.holdA = true;
}
