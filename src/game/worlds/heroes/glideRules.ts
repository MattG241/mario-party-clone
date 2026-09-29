// Rooftop Glide: the night skyline's layout, the cape-glider flight model, the sweeping searchlights
// and the CPU pilot. Pure (no Phaser), so the flight and the CPUs can be unit tested and simulated.
// Screen space throughout: x right, y down, px and px/s, times in ms.
//
// The rooftop heights, vents and searchlight lamps must match the rendered arena
// (scripts/art/worlds/heroes/mg_rooftop.py, ROOFS / VENTS / LIGHTS there).

export interface Roof {
  x0: number;
  x1: number;
  /** Screen y of the roof deck (where feet stand). */
  y: number;
}

export interface Vent {
  x: number;
  /** Roof deck under the vent (the updraft rises from here). */
  y: number;
  /** Half the width of the updraft column. */
  half: number;
}

export interface Lamp {
  x: number;
  /** The lamp's lens (the beam's apex). */
  y: number;
  /** Largest swing either side of straight up (radians). */
  sweep: number;
  /** Seconds per full back-and-forth sweep. */
  period: number;
  /** Starting phase (radians). */
  phase: number;
}

/** The skyline, left to right: a tall tower at each end frames the flight space. */
export const ROOFS: readonly Roof[] = [
  { x0: -200, x1: 232, y: 604 },
  { x0: 232, x1: 522, y: 826 },
  { x0: 522, x1: 760, y: 700 },
  { x0: 760, x1: 1152, y: 884 },
  { x0: 1152, x1: 1400, y: 722 },
  { x0: 1400, x1: 1690, y: 834 },
  { x0: 1690, x1: 2120, y: 620 },
];

/** Rooftop vents: hot air rising from each carries a gliding cape up. */
export const VENTS: readonly Vent[] = [
  { x: 377, y: 826, half: 74 },
  { x: 956, y: 884, half: 78 },
  { x: 1545, y: 834, half: 74 },
];

/** Searchlights on the two middle towers. */
export const LAMPS: readonly Lamp[] = [
  { x: 641, y: 662, sweep: 0.95, period: 13, phase: 0.6 },
  { x: 1276, y: 684, sweep: 0.95, period: 11.5, phase: 3.4 },
];

export const GLIDE = {
  /** Top of the flight space (an open canopy then just clears the HUD strip) and the side walls. */
  CEIL: 238,
  WALL_L: 70,
  WALL_R: 1850,
  /** Diving: gravity and top falling speed. */
  GRAV: 1500,
  DIVE_MAX: 950,
  /** Gliding: the steady sink, and how fast speed settles towards it (1/s). */
  SINK: 88,
  GLIDE_K: 4.6,
  /** Gliding speed: stick at rest, and stick pushed all the way. */
  GLIDE_MIN: 175,
  GLIDE_MAX: 440,
  /** Slowest drift with the cape open inside an updraft. */
  HOVER_MIN: 40,
  /** Diving along with the stick pushed. */
  DIVE_H: 540,
  STEER_K: 3.2,
  DIVE_STEER_K: 1.5,
  /** Opening the cape out of a fast dive swoops you up: from this speed, this share of it, capped. */
  SWOOP_MIN: 270,
  SWOOP_K: 0.8,
  SWOOP_MAX: 720,
  /** Updrafts: lift while gliding in one (and a little while diving through). */
  UPDRAFT_ACC: 3000,
  UPDRAFT_VMAX: 560,
  UPDRAFT_DIVE_ACC: 650,
  /** Leaping off a roof, running along one, and the landing speed that jars you. */
  LEAP_VY: 760,
  LEAP_VX: 280,
  RUN: 380,
  HARD_LAND: 700,
  LAND_STUN_MS: 240,
  /** Caught in a searchlight: dazed this long, then flashing (safe) this long. */
  STUN_MS: 850,
  INVULN_MS: 1500,
  /** Pick-up reach from the body's centre. */
  REACH: 60,
  /** The body's centre sits this far above the feet. */
  BODY: 62,
} as const;

/** Searchlight cone: half-angle and reach. */
export const BEAM_HALF = 0.085;
/** Held in a beam this long (ms) and you're caught: brushing its edge only sets off the alarm. */
export const CATCH_MS = 300;
export const BEAM_LEN = 1300;
/** A body this wide still counts as caught at the cone's edge. */
export const BODY_R = 26;

/** Roof deck height under x (the lowest floor there is, for the flight model). */
export function roofAt(x: number): number {
  for (const r of ROOFS) if (x >= r.x0 && x < r.x1) return r.y;
  return ROOFS[x < 0 ? 0 : ROOFS.length - 1].y;
}

/** The vent whose updraft column holds (x, y), or -1. */
export function ventAt(x: number, y: number): number {
  for (let i = 0; i < VENTS.length; i++) {
    const v = VENTS[i];
    if (Math.abs(x - v.x) <= v.half && y <= v.y && y >= GLIDE.CEIL - 10) return i;
  }
  return -1;
}

/** Updraft strength at height y (full low down, easing off near the top of the sky). */
export function updraftStrength(y: number): number {
  const u = (y - GLIDE.CEIL) / 240;
  return u >= 1 ? 1 : Math.max(0.3, 0.3 + 0.7 * u);
}

export type FlyMode = 'glide' | 'dive' | 'roof' | 'stun';

export interface Flyer {
  /** Body centre. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: 1 | -1;
  mode: FlyMode;
  stunT: number;
  invuln: number;
  landStun: number;
  /** In an updraft last step (for the "caught the thermal" moment). */
  lifted: number;
  /** Still rising from a leap: the jump runs its course before the cape takes over. */
  rise: boolean;
}

export interface FlyInput {
  stickX: number;
  holdA: boolean;
  pressA: boolean;
}

/** What happened during one step (the scene turns these into effects). */
export interface FlyEvents {
  leap: boolean;
  /** Upward speed of a swoop out of a dive (0 = none). */
  swoop: number;
  openCape: boolean;
  closeCape: boolean;
  /** Impact speed of a landing (0 = none). */
  land: number;
  hardLand: boolean;
  bonk: boolean;
  /** Entered an updraft (its index + 1; 0 = none). */
  updraft: number;
}

export function newFlyer(x: number): Flyer {
  return { x, y: roofAt(x) - GLIDE.BODY, vx: 0, vy: 0, face: x < 960 ? 1 : -1, mode: 'roof', stunT: 0, invuln: 0, landStun: 0, lifted: -1, rise: false };
}

export function clearEvents(e: FlyEvents): FlyEvents {
  e.leap = false;
  e.swoop = 0;
  e.openCape = false;
  e.closeCape = false;
  e.land = 0;
  e.hardLand = false;
  e.bonk = false;
  e.updraft = 0;
  return e;
}

export function newEvents(): FlyEvents {
  return clearEvents({} as FlyEvents);
}

/** Approach factor for an exponential settle at `rate` per second over `s` seconds. */
function k(rate: number, s: number): number {
  return 1 - Math.exp(-rate * s);
}

/** Feet height of the body centre y. */
function feet(y: number): number {
  return y + GLIDE.BODY;
}

/**
 * One step of the glider. Holding A keeps the cape open (a slow, steady glide the stick steers);
 * letting go folds it (a dive that builds speed); opening it again mid-dive swoops you up.
 * Updrafts lift an open cape; roofs are landed on (press A to leap off again).
 */
export function stepFlyer(f: Flyer, inp: FlyInput, dt: number, out: FlyEvents): void {
  clearEvents(out);
  const s = dt / 1000;
  if (f.invuln > 0) f.invuln = Math.max(0, f.invuln - dt);
  if (f.mode === 'roof') {
    stepRoof(f, inp, dt, s, out);
    return;
  }
  const px = f.x;
  const py = f.y;
  if (f.mode === 'stun') {
    f.rise = false;
    f.stunT -= dt;
    f.vy = Math.min(GLIDE.DIVE_MAX * 0.8, f.vy + GLIDE.GRAV * 0.8 * s);
    f.vx *= Math.exp(-1.6 * s);
  } else {
    const glide = inp.holdA;
    if (glide && f.mode === 'dive') {
      out.openCape = true;
      if (f.vy > GLIDE.SWOOP_MIN) {
        const up = Math.min(GLIDE.SWOOP_MAX, GLIDE.SWOOP_K * f.vy);
        f.vy = -up;
        f.rise = false;
        f.vx = clampAbs(f.vx + f.face * up * 0.18, GLIDE.GLIDE_MAX * 1.3);
        out.swoop = up;
      }
      f.mode = 'glide';
    } else if (!glide && f.mode === 'glide') {
      out.closeCape = true;
      f.mode = 'dive';
    }
    if (Math.abs(inp.stickX) > 0.25) f.face = inp.stickX > 0 ? 1 : -1;
    const vent = ventAt(f.x, f.y);
    if (f.rise && f.vy >= 0) f.rise = false;
    if (f.mode === 'glide') {
      // In an updraft an open cape hangs in the rising air (let go of the stick to rise straight up).
      const slow = vent >= 0 ? GLIDE.HOVER_MIN : GLIDE.GLIDE_MIN;
      const spd = slow + (GLIDE.GLIDE_MAX - slow) * Math.min(1, Math.abs(inp.stickX));
      f.vx += (f.face * spd - f.vx) * k(GLIDE.STEER_K, s);
      if (f.rise) f.vy += GLIDE.GRAV * s;
      else f.vy += (GLIDE.SINK - f.vy) * k(GLIDE.GLIDE_K, s);
    } else {
      const target = Math.abs(inp.stickX) > 0.25 ? f.face * GLIDE.DIVE_H : f.vx;
      f.vx += (target - f.vx) * k(GLIDE.DIVE_STEER_K, s);
      f.vy = Math.min(GLIDE.DIVE_MAX, f.vy + GLIDE.GRAV * s);
    }
    if (vent >= 0) {
      const lift = updraftStrength(f.y);
      if (f.mode === 'glide') f.vy = Math.max(-GLIDE.UPDRAFT_VMAX, f.vy - GLIDE.UPDRAFT_ACC * lift * s);
      else f.vy -= GLIDE.UPDRAFT_DIVE_ACC * lift * s;
      if (f.lifted !== vent) out.updraft = vent + 1;
    }
    f.lifted = vent;
  }
  let nx = f.x + f.vx * s;
  let ny = f.y + f.vy * s;
  if (ny < GLIDE.CEIL) {
    ny = GLIDE.CEIL;
    if (f.vy < 0) f.vy = 0;
  }
  if (nx < GLIDE.WALL_L) {
    nx = GLIDE.WALL_L;
    f.vx = Math.abs(f.vx) * 0.35;
    f.face = 1;
    out.bonk = true;
  } else if (nx > GLIDE.WALL_R) {
    nx = GLIDE.WALL_R;
    f.vx = -Math.abs(f.vx) * 0.35;
    f.face = -1;
    out.bonk = true;
  }
  const floorNew = roofAt(nx);
  if (feet(ny) >= floorNew) {
    if (feet(py) <= floorNew + 3) {
      // Came down onto this roof.
      ny = floorNew - GLIDE.BODY;
      out.land = Math.max(1, f.vy);
      if (f.vy > GLIDE.HARD_LAND && f.mode !== 'stun') {
        out.hardLand = true;
        f.landStun = GLIDE.LAND_STUN_MS;
      }
      if (f.mode === 'stun') f.vx *= 0.3;
      f.vy = 0;
      // (A dazed glider lands still dazed: the roof step counts the rest of the daze down.)
      f.mode = 'roof';
    } else {
      // Flew into the side of a taller building: bounce back off its wall.
      nx = px;
      f.vx = -f.vx * 0.3;
      f.face = f.vx >= 0 ? 1 : -1;
      out.bonk = true;
      if (feet(ny) >= roofAt(nx)) {
        ny = roofAt(nx) - GLIDE.BODY;
        out.land = Math.max(1, f.vy);
        f.vy = 0;
        f.mode = 'roof';
      }
    }
  }
  f.x = nx;
  f.y = ny;
  if (f.mode === 'stun' && f.stunT <= 0) {
    f.stunT = 0;
    f.mode = inp.holdA ? 'glide' : 'dive';
  }
}

function stepRoof(f: Flyer, inp: FlyInput, dt: number, s: number, out: FlyEvents): void {
  f.lifted = -1;
  if (f.stunT > 0) {
    f.stunT = Math.max(0, f.stunT - dt);
    f.vx *= Math.exp(-8 * s);
  } else if (f.landStun > 0) {
    f.landStun = Math.max(0, f.landStun - dt);
    f.vx *= Math.exp(-10 * s);
  } else {
    f.vx += (inp.stickX * GLIDE.RUN - f.vx) * k(12, s);
    if (Math.abs(inp.stickX) > 0.2) f.face = inp.stickX > 0 ? 1 : -1;
    if (inp.pressA) {
      f.vy = -GLIDE.LEAP_VY;
      f.vx = f.face * Math.max(Math.abs(f.vx), GLIDE.LEAP_VX);
      f.mode = inp.holdA ? 'glide' : 'dive';
      f.rise = true;
      out.leap = true;
      f.y -= 2;
      return;
    }
  }
  const px = f.x;
  let nx = Math.max(GLIDE.WALL_L, Math.min(GLIDE.WALL_R, f.x + f.vx * s));
  const here = roofAt(px);
  const there = roofAt(nx);
  if (there < here - 2) {
    // A taller building's wall: stop at it.
    nx = px;
    f.vx = 0;
  }
  f.x = nx;
  if (there > here + 2) {
    // Walked off the edge.
    f.mode = f.stunT > 0 ? 'stun' : inp.holdA ? 'glide' : 'dive';
    f.vy = 60;
  } else f.y = roofAt(f.x) - GLIDE.BODY;
}

function clampAbs(v: number, max: number): number {
  return v > max ? max : v < -max ? -max : v;
}

// --- Searchlights ----------------------------------------------------------------------------

export interface Beam {
  lamp: Lamp;
  /** Running phase (radians): the angle is sweep * sin(phase). */
  phase: number;
  /** Current angle from straight up (radians, positive = to the right). */
  angle: number;
}

export function newBeams(): Beam[] {
  return LAMPS.map((lamp) => ({ lamp, phase: lamp.phase, angle: lamp.sweep * Math.sin(lamp.phase) }));
}

/** Angular speed of a beam's phase (radians per second) at a given speed-up. */
export function beamOmega(b: Beam, speed: number): number {
  return ((Math.PI * 2) / b.lamp.period) * speed;
}

export function stepBeams(beams: readonly Beam[], dt: number, speed: number): void {
  for (const b of beams) {
    b.phase += beamOmega(b, speed) * (dt / 1000);
    b.angle = b.lamp.sweep * Math.sin(b.phase);
  }
}

/** Angle a beam will point at `ahead` seconds from now. */
export function beamAngleAhead(b: Beam, ahead: number, speed: number): number {
  return b.lamp.sweep * Math.sin(b.phase + beamOmega(b, speed) * ahead);
}

/** Is (x, y) inside a searchlight cone pointing at `angle`? `margin` widens it (radians). */
export function inBeam(lamp: Lamp, angle: number, x: number, y: number, margin = 0): boolean {
  const dx = x - lamp.x;
  const dy = y - lamp.y;
  const d = Math.hypot(dx, dy);
  if (d < 50 || d > BEAM_LEN) return false;
  const pa = Math.atan2(dx, -dy);
  return Math.abs(pa - angle) < BEAM_HALF + BODY_R / d + margin;
}

/** Caught in a searchlight: dazed (falling, or stuck where you stand on a roof), then safe for a while. */
export function spot(f: Flyer): void {
  f.stunT = GLIDE.STUN_MS;
  f.invuln = GLIDE.STUN_MS + GLIDE.INVULN_MS;
  f.landStun = 0;
  if (f.mode !== 'roof') {
    f.mode = 'stun';
    f.vy = Math.min(f.vy, -160);
  }
}

// --- Clue tokens -----------------------------------------------------------------------------

export interface TokenSpot {
  x: number;
  y: number;
  gold: boolean;
}

/** Where a new clue may appear: open sky, clear of the others and the lamps' lenses. */
export function tokenSpot(rnd: () => number, others: readonly { x: number; y: number }[], gold: boolean): TokenSpot {
  let best: TokenSpot = { x: 960, y: 360, gold };
  let bestGap = -1;
  for (let tries = 0; tries < 12; tries++) {
    const x = 150 + rnd() * 1620;
    const top = GLIDE.CEIL + 36;
    const bottom = gold ? 380 : roofAt(x) - 120;
    const y = top + rnd() * Math.max(10, bottom - top);
    let gap = 9999;
    for (const o of others) gap = Math.min(gap, Math.hypot(o.x - x, o.y - y));
    for (const l of LAMPS) gap = Math.min(gap, Math.hypot(l.x - x, l.y - y) + 60);
    if (gap > 150) return { x, y, gold };
    if (gap > bestGap) {
      bestGap = gap;
      best = { x, y, gold };
    }
  }
  return best;
}

/** Spawn interval (ms) for clue tokens: a little busier with more players, twice as busy in the storm. */
export function clueInterval(players: number, storm: boolean): number {
  const base = 1350 - (players - 2) * 110;
  return storm ? base * 0.5 : base;
}

/** Most clues in the sky at once. */
export function maxClues(players: number, storm: boolean): number {
  return 4 + players + (storm ? 3 : 0);
}

// --- CPU pilot -------------------------------------------------------------------------------

export interface GlideSkill {
  reaction: number;
  accuracy: number;
  mistake: number;
  aimNoise: number;
  think: number;
}

export interface GlideBrain {
  think: number;
  /** Target clue id (-1 = none) and its position. */
  tid: number;
  tx: number;
  ty: number;
  /** 'seek' a clue; 'climb' an updraft first (vent index in `vent`). */
  mode: 'seek' | 'climb';
  vent: number;
  /** Diving towards the target (with hysteresis). */
  diving: boolean;
  /** Dodging a searchlight: time left, and whether to dive or turn. */
  evade: number;
  evadeDive: boolean;
  evadeFace: number;
  evadeStick: number;
  /** A searchlight threat noticed but not yet reacted to (reaction delay), and ignored ones. */
  notice: number;
  ignore: number;
  /** Still wary after dodging a beam: the next threat is seen at once. */
  wary: number;
  /** On a roof: wait before leaping (reaction). */
  roofWait: number;
  /** Stick wobble (re-rolled each think). */
  wobble: number;
}

export function newBrain(): GlideBrain {
  return { think: 0, tid: -1, tx: 960, ty: 400, mode: 'seek', vent: -1, diving: false, evade: 0, evadeDive: false, evadeFace: 1, evadeStick: 1, notice: -1, ignore: 0, wary: 0, roofWait: -1, wobble: 0 };
}

export interface GlideClue {
  id: number;
  x: number;
  y: number;
  value: number;
  /** Ms before it vanishes. */
  life: number;
}

export interface GlideView {
  clues: readonly GlideClue[];
  beams: readonly Beam[];
  beamSpeed: number;
  /** Clue ids other CPUs are chasing (spread out instead of piling on one). */
  claimed: ReadonlySet<number>;
  /** Other gliders' positions (a rival right next to a clue makes it less worth it). */
  rivals: readonly { x: number; y: number }[];
  /** How long (ms) this glider has already been lit by a beam. */
  lock: number;
}

/** Glide slope (px of sink per px travelled) at full speed. */
export const GLIDE_SLOPE = GLIDE.SINK / GLIDE.GLIDE_MAX;

/** Rough seconds to reach a clue from (x, y): the flight, plus a climb in the nearest updraft if it is above the glide line. */
export function clueCost(x: number, y: number, c: { x: number; y: number }): { t: number; vent: number } {
  const dx = Math.abs(c.x - x);
  const glideY = y + GLIDE_SLOPE * dx;
  if (c.y >= glideY - 40) return { t: dx / GLIDE.GLIDE_MAX + Math.max(0, c.y - glideY) / 900, vent: -1 };
  // Needs height: ride the updraft that makes the shortest trip.
  let best = { t: Infinity, vent: -1 };
  VENTS.forEach((v, i) => {
    const toVent = Math.abs(v.x - x) / GLIDE.GLIDE_MAX;
    const atVentY = Math.min(v.y - 40, y + GLIDE_SLOPE * Math.abs(v.x - x));
    const climbTo = c.y - 70 - GLIDE_SLOPE * Math.abs(c.x - v.x);
    const climb = Math.max(0, atVentY - Math.max(GLIDE.CEIL, climbTo)) / (GLIDE.UPDRAFT_VMAX * 0.8);
    const t = toVent + climb + Math.abs(c.x - v.x) / GLIDE.GLIDE_MAX + 0.4;
    if (t < best.t) best = { t, vent: i };
  });
  return best;
}

/**
 * The CPU pilot: chooses a clue worth the trip (climbing an updraft first when it sits above the
 * glide line), glides or dives to meet it, swoops up into ones just above, leaps off roofs, and
 * dodges searchlights it sees coming. Skill sets how far ahead it reads the beams, how quickly it
 * reacts and how often it slips up. Returns the buttons to press this frame.
 */
export function glideCpu(b: GlideBrain, f: Flyer, view: GlideView, sk: GlideSkill, dt: number, rnd: () => number, inp: FlyInput): FlyInput {
  inp.stickX = 0;
  inp.holdA = false;
  inp.pressA = false;
  b.think -= dt;
  let target: GlideClue | undefined;
  for (const c of view.clues) if (c.id === b.tid) target = c;
  // Re-plan on the pilot's own rhythm, or at once when the clue it was after is gone.
  if (b.think <= 0 || !target) {
    b.think = sk.think * (0.8 + rnd() * 0.4);
    b.wobble = (rnd() - 0.5) * sk.aimNoise * 0.5;
    pickClue(b, f, view, sk, rnd);
    target = undefined;
    for (const c of view.clues) if (c.id === b.tid) target = c;
  }
  if (target) {
    b.tx = target.x;
    b.ty = target.y;
  }
  if (f.mode === 'roof') {
    b.diving = false;
    b.evade = 0;
    inp.stickX = b.tx >= f.x ? 1 : -1;
    if (b.roofWait < 0) b.roofWait = sk.reaction * (0.6 + rnd() * 0.6);
    b.roofWait -= dt;
    if (b.roofWait <= 0) {
      b.roofWait = -1;
      inp.pressA = true;
      inp.holdA = true;
    }
    return inp;
  }
  b.roofWait = -1;
  steerTo(b, f, !!target, sk, inp);
  if (f.mode === 'stun' || f.invuln > 0) return inp;
  // Searchlights: fly the intended course forward against the beams' sweeps `look` seconds ahead
  // (further for better pilots). A threat is noticed after the pilot's reaction time (at once while
  // still wary from the last one), and weaker pilots now and then miss it altogether.
  const look = 0.25 + sk.accuracy * 0.55;
  if (b.ignore > 0) b.ignore -= dt;
  if (b.wary > 0) b.wary -= dt;
  if (b.evade > 0) {
    b.evade -= dt;
    inp.stickX = b.evadeFace * Math.max(0.3, b.evadeStick);
    inp.holdA = !b.evadeDive;
    return inp;
  }
  if (b.ignore > 0) return inp;
  const face = Math.abs(inp.stickX) > 0.25 ? (inp.stickX > 0 ? 1 : -1) : f.face;
  const hanging = ventAt(f.x, f.y) >= 0 && inp.holdA;
  const lock = courseLock(f, view, face, !inp.holdA, hanging ? Math.abs(inp.stickX) : Math.max(0.35, Math.abs(inp.stickX)), hanging ? look + 0.5 : look, view.lock);
  if (lock < CATCH_MS * 0.85) {
    b.notice = -1;
    return inp;
  }
  if (b.notice < 0) b.notice = b.wary > 0 ? 0 : sk.reaction * (0.5 + rnd() * 0.5);
  b.notice -= dt;
  if (b.notice > 0) return inp;
  b.notice = -1;
  if (b.wary <= 0 && rnd() < sk.mistake * 1.4) {
    b.ignore = 900;
    return inp;
  }
  planEvade(b, f, view, look);
  b.wary = 900;
  inp.stickX = b.evadeFace * Math.max(0.3, b.evadeStick);
  inp.holdA = !b.evadeDive;
  return inp;
}

/** The stick and cape for heading to the brain's target: up an updraft first when climbing, then glide, dive or swoop to it. */
function steerTo(b: GlideBrain, f: Flyer, hasTarget: boolean, sk: GlideSkill, inp: FlyInput): void {
  let gx = b.tx;
  if (b.mode === 'climb' && b.vent >= 0) {
    const v = VENTS[b.vent];
    // Up the updraft until the clue can be glided to, then over to it.
    const need = b.ty - 60 - GLIDE_SLOPE * Math.abs(b.tx - v.x);
    if (f.y <= Math.max(GLIDE.CEIL + 8, need) || !hasTarget) b.mode = 'seek';
    else {
      gx = v.x;
      const dx = gx - f.x;
      inp.stickX = Math.abs(dx) < 16 ? -f.face * 0.15 : Math.sign(dx) * Math.min(1, Math.abs(dx) / 60 + 0.25);
      inp.holdA = true;
      return;
    }
  }
  const dx = gx - f.x;
  const dy = b.ty - f.y;
  inp.stickX = Math.abs(dx) < 10 ? 0 : Math.max(-1, Math.min(1, Math.sign(dx) * (0.35 + Math.abs(dx) / 160) + b.wobble));
  // Glide or dive: dive when the clue is well under the glide line; swoop up into ones just above.
  // (Weaker pilots are timid divers: they glide down the long way round.)
  const run = Math.max(40, Math.abs(dx));
  const need = dy / run;
  const slope = GLIDE.SINK / Math.max(120, Math.abs(f.vx));
  const nerve = 0.8 + Math.max(0, 0.78 - sk.accuracy) * 4;
  if (b.diving) {
    if (need < slope + 0.12 || (dy < 40 && f.vy > GLIDE.SWOOP_MIN)) b.diving = false;
  } else if (need > slope + nerve && dy > 90) b.diving = true;
  inp.holdA = !b.diving;
}

function pickClue(b: GlideBrain, f: Flyer, view: GlideView, sk: GlideSkill, rnd: () => number): void {
  let best: GlideClue | null = null;
  let bestScore = -Infinity;
  let bestVent = -1;
  const blunder = rnd() < sk.mistake;
  for (const c of view.clues) {
    const cost = clueCost(f.x, f.y, c);
    if (cost.t * 1000 > c.life - 200) continue;
    let rival = 9999;
    for (const r of view.rivals) rival = Math.min(rival, Math.hypot(r.x - c.x, r.y - c.y));
    const mine = Math.hypot(f.x - c.x, f.y - c.y);
    // Better pilots steer clear of clues a beam will be sweeping over when they arrive, and of
    // updrafts a beam is about to wash over.
    const risk = exposure(view, c.x, c.y, cost.t) + (cost.vent >= 0 ? ventExposure(view, cost.vent, f.x, f.y, c.y) : 0);
    let score = c.value * 1.6 - cost.t - (rival < mine * 0.7 ? 0.9 : 0) - (view.claimed.has(c.id) ? 1.2 : 0) - risk * sk.accuracy * 0.9;
    if (blunder) score = rnd();
    if (c.id === b.tid) score += 0.7;
    if (score > bestScore) {
      bestScore = score;
      best = c;
      bestVent = cost.vent;
    }
  }
  if (!best) {
    // Nothing worth chasing: drift towards the middle, high up (the likeliest place for the next clue).
    b.tid = -1;
    b.tx = 960;
    b.ty = 420;
    b.mode = f.y > 560 ? 'climb' : 'seek';
    b.vent = f.y > 560 ? nearestVent(f.x) : -1;
    return;
  }
  if (best.id !== b.tid) b.diving = false;
  b.tid = best.id;
  b.tx = best.x;
  b.ty = best.y;
  b.mode = bestVent >= 0 ? 'climb' : 'seek';
  b.vent = bestVent;
}

const ETA_SPREAD = [-0.3, 0, 0.3] as const;

/** How many beams will be over (x, y) around `eta` seconds from now (0..3 samples, summed over beams). */
function exposure(view: GlideView, x: number, y: number, eta: number): number {
  let n = 0;
  for (const bm of view.beams) {
    for (const dt of ETA_SPREAD) {
      const a = Math.max(0, eta + dt);
      if (inBeam(bm.lamp, beamAngleAhead(bm, a, view.beamSpeed), x, y, 0.05)) n++;
    }
  }
  return n;
}

/** Beam exposure of a climb up vent `v` from height `fromY` to about `toY` (sampled along the way). */
function ventExposure(view: GlideView, v: number, fromX: number, fromY: number, toY: number): number {
  const vent = VENTS[v];
  const top = Math.max(GLIDE.CEIL, toY - 70);
  const start = Math.min(fromY, vent.y - 60);
  const climb = Math.max(0.2, (start - top) / (GLIDE.UPDRAFT_VMAX * 0.85));
  let n = 0;
  for (let i = 0; i <= 4; i++) {
    const u = i / 4;
    const y = start + (top - start) * u;
    const t = Math.abs(vent.x - fromX) / GLIDE.GLIDE_MAX + climb * u;
    for (const bm of view.beams) if (inBeam(bm.lamp, beamAngleAhead(bm, t, view.beamSpeed), vent.x, y, 0.05)) n++;
  }
  return n * 0.6;
}

function nearestVent(x: number): number {
  let best = 0;
  VENTS.forEach((v, i) => {
    if (Math.abs(v.x - x) < Math.abs(VENTS[best].x - x)) best = i;
  });
  return best;
}

/** Escape plans a pilot weighs up: which way to face, dive or glide, and how hard on the stick. */
const PLANS: readonly { turn: boolean; dive: boolean; stick: number }[] = [
  { turn: false, dive: false, stick: 1 },
  { turn: true, dive: false, stick: 1 },
  { turn: false, dive: true, stick: 1 },
  { turn: true, dive: true, stick: 1 },
  { turn: false, dive: false, stick: 0 },
  { turn: true, dive: false, stick: 0 },
];

/**
 * Fly a plan forward in coarse steps against the beams' future sweeps and return the longest time
 * (ms) it would sit in a beam: CATCH_MS or more means caught. `lock0` is time already spent lit.
 */
function courseLock(f: Flyer, view: GlideView, face: number, dive: boolean, stick: number, horizon: number, lock0: number): number {
  let x = f.x;
  let y = f.y;
  let vx = f.vx;
  let vy = f.vy;
  let lock = lock0;
  let worst = lock0;
  const h = 0.04;
  for (let t = h; t <= horizon + 1e-6; t += h) {
    const vent = ventAt(x, y);
    if (dive) {
      vx += ((stick > 0.25 ? face * GLIDE.DIVE_H : vx) - vx) * k(GLIDE.DIVE_STEER_K, h);
      vy = Math.min(GLIDE.DIVE_MAX, vy + GLIDE.GRAV * h);
    } else {
      const slow = vent >= 0 ? GLIDE.HOVER_MIN : GLIDE.GLIDE_MIN;
      vx += ((slow + (GLIDE.GLIDE_MAX - slow) * stick) * face - vx) * k(GLIDE.STEER_K, h);
      vy += (GLIDE.SINK - vy) * k(GLIDE.GLIDE_K, h);
      if (vent >= 0) vy = Math.max(-GLIDE.UPDRAFT_VMAX, vy - GLIDE.UPDRAFT_ACC * updraftStrength(y) * h);
    }
    x = Math.max(GLIDE.WALL_L, Math.min(GLIDE.WALL_R, x + vx * h));
    y = Math.max(GLIDE.CEIL, Math.min(roofAt(x) - GLIDE.BODY, y + vy * h));
    let lit = false;
    for (const bm of view.beams) if (inBeam(bm.lamp, beamAngleAhead(bm, t, view.beamSpeed), x, y, 0.02)) lit = true;
    lock = lit ? lock + h * 1000 : 0;
    if (lock > worst) worst = lock;
    if (worst >= CATCH_MS) return worst;
  }
  return worst;
}

/**
 * Choose the escape that sits in the beams least over the next moments (crossing a beam against its
 * sweep is often quicker than fleeing it); ties go to plans that keep height and head for the target.
 */
function planEvade(b: GlideBrain, f: Flyer, view: GlideView, look: number): void {
  let pick = PLANS[0];
  let best = Infinity;
  const toward = b.tx >= f.x ? 1 : -1;
  for (const o of PLANS) {
    const face = o.turn ? -f.face : f.face;
    const lock = courseLock(f, view, face, o.dive, o.stick, look + 0.45, view.lock);
    // Any plan that stays clear will do: then keep heading for the clue, and keep height.
    const safe = lock < CATCH_MS * 0.7;
    const cost = (safe ? lock * 0.1 : 1000 + lock) + (face !== toward ? 100 : 0) + (o.dive ? 40 : 0) + (o.stick < 0.5 ? 20 : 0);
    if (cost < best) {
      best = cost;
      pick = o;
    }
  }
  b.evade = 240;
  b.evadeDive = pick.dive;
  b.evadeFace = pick.turn ? -f.face : f.face;
  b.evadeStick = pick.stick;
}
