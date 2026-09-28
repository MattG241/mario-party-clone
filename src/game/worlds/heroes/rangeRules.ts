// Repulsor Range: the test range's targets (drones on flight paths, pop-up discs, armoured heavies,
// the rare gold drone) and the civilian balloons you must never hit; reticle handling, blasts,
// scoring with combos, the spawn schedule and the CPU marksman. Pure (no Phaser): unit tested and
// simulated. Screen px, px/s, ms.

export type TargetKind = 'drone' | 'zip' | 'heavy' | 'disc' | 'gold' | 'balloon';

export const RANGE = {
  /** Where targets fly (the sky over the deck). */
  X0: 110,
  X1: 1810,
  Y0: 170,
  Y1: 740,
  /** Deck line: pop-up discs rise from here; the hover pads sit below it. */
  DECK_Y: 770,
  PAD_Y: 900,
  /** Reticle: top speed, how quickly it gets there (1/s), and its bounds. */
  RET_MAX: 1250,
  RET_K: 13,
  RET_CHARGE_K: 0.6,
  RX0: 60,
  RX1: 1860,
  RY0: 150,
  RY1: 820,
  /** Quick blast: reach round the reticle and the cooldown between shots. */
  QUICK_R: 30,
  QUICK_CD: 230,
  /** Charged blast: hold A past CHARGE_DELAY; full after CHARGE_MS; fires on release from MIN charge. */
  CHARGE_DELAY: 160,
  CHARGE_MS: 900,
  CHARGE_MIN: 0.35,
  BIG_R0: 90,
  BIG_R1: 200,
  BIG_CD: 450,
  /** Combo: hits keep it alive for this long; every COMBO_STEP hits adds one to the multiplier (to MAX). */
  COMBO_MS: 2600,
  COMBO_STEP: 6,
  COMBO_MAX: 3,
  /** A civilian balloon hit costs this, breaks the combo, and the balloon can't be hit again for a moment. */
  BALLOON_COST: 3,
  BALLOON_SAFE_MS: 700,
} as const;

export const KINDS: Record<TargetKind, { r: number; hp: number; pts: number }> = {
  drone: { r: 42, hp: 1, pts: 1 },
  zip: { r: 36, hp: 1, pts: 2 },
  heavy: { r: 62, hp: 3, pts: 4 },
  disc: { r: 52, hp: 1, pts: 1 },
  gold: { r: 40, hp: 1, pts: 5 },
  balloon: { r: 58, hp: 99, pts: -RANGE.BALLOON_COST },
};

export interface Target {
  id: number;
  kind: TargetKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  age: number;
  /** Ms left before it leaves (discs sink, zippers warp out). */
  life: number;
  /** Path: base height, sway amplitude and frequency, phase. */
  baseY: number;
  amp: number;
  freq: number;
  phase: number;
  /** Zippers: hover time left and the next point to dart to. */
  wait: number;
  tx: number;
  ty: number;
  hops: number;
  /** Balloons: can't be hit again until this runs out. */
  safe: number;
  dead: boolean;
}

/** Hover-pad x for each of n players (spread across the deck). */
export function padX(i: number, n: number): number {
  const xs: Record<number, number[]> = { 1: [960], 2: [720, 1200], 3: [560, 960, 1360], 4: [480, 800, 1120, 1440] };
  return (xs[n] ?? xs[4])[i] ?? 960;
}

/** Spawn interval (ms): busier with more players, and in the final swarm. */
export function spawnInterval(players: number, storm: boolean): number {
  const base = 900 - (players - 2) * 70;
  return storm ? base * 0.6 : base;
}

export function maxTargets(players: number, storm: boolean): number {
  return 5 + players + (storm ? 3 : 0);
}

/** Which kind to launch next (weights shift towards the gold drone in the swarm). */
export function pickKind(roll: number, storm: boolean): TargetKind {
  const table: [TargetKind, number][] = [
    ['drone', 40],
    ['disc', 18],
    ['zip', 16],
    ['heavy', 10],
    ['gold', storm ? 7 : 2],
  ];
  const total = table.reduce((a, [, w]) => a + w, 0);
  let x = roll * total;
  for (const [k, w] of table) {
    x -= w;
    if (x < 0) return k;
  }
  return 'drone';
}

let nextId = 1;

/** A fresh target of `kind`, placed and set on its path. `rnd` gives 0..1. */
export function makeTarget(kind: TargetKind, rnd: () => number): Target {
  const k = KINDS[kind];
  const t: Target = { id: nextId++, kind, x: 0, y: 0, vx: 0, vy: 0, r: k.r, hp: k.hp, age: 0, life: 99999, baseY: 0, amp: 0, freq: 0, phase: rnd() * Math.PI * 2, wait: 0, tx: 0, ty: 0, hops: 0, safe: 0, dead: false };
  const fromLeft = rnd() < 0.5;
  switch (kind) {
    case 'drone':
    case 'heavy':
    case 'gold': {
      const speed = kind === 'heavy' ? 90 + rnd() * 35 : kind === 'gold' ? 360 + rnd() * 60 : 170 + rnd() * 90;
      t.x = fromLeft ? RANGE.X0 - 80 : RANGE.X1 + 80;
      t.baseY = RANGE.Y0 + 40 + rnd() * (RANGE.Y1 - RANGE.Y0 - 120);
      t.y = t.baseY;
      t.vx = fromLeft ? speed : -speed;
      t.amp = kind === 'heavy' ? 14 : 30 + rnd() * 50;
      t.freq = kind === 'gold' ? 1.2 : 0.5 + rnd() * 0.45;
      break;
    }
    case 'zip':
      t.x = RANGE.X0 + 120 + rnd() * (RANGE.X1 - RANGE.X0 - 240);
      t.y = RANGE.Y0 + 60 + rnd() * (RANGE.Y1 - RANGE.Y0 - 160);
      t.tx = t.x;
      t.ty = t.y;
      t.wait = 700 + rnd() * 400;
      t.hops = 3 + Math.floor(rnd() * 2);
      break;
    case 'disc':
      t.x = RANGE.X0 + 140 + rnd() * (RANGE.X1 - RANGE.X0 - 280);
      t.baseY = RANGE.Y1 - 100 - rnd() * 110;
      t.y = RANGE.DECK_Y + 40;
      t.life = 2600;
      break;
    case 'balloon':
      t.x = RANGE.X0 + 100 + rnd() * (RANGE.X1 - RANGE.X0 - 200);
      t.y = 1150;
      t.vy = -(70 + rnd() * 40);
      t.amp = 26 + rnd() * 20;
      t.freq = 0.35 + rnd() * 0.2;
      t.baseY = t.x;
      break;
  }
  return t;
}

/** Move a target along its path; returns false once it has left the range. */
export function stepTarget(t: Target, dt: number, rnd: () => number): boolean {
  const s = dt / 1000;
  t.age += dt;
  if (t.safe > 0) t.safe -= dt;
  switch (t.kind) {
    case 'drone':
    case 'heavy':
    case 'gold':
      t.x += t.vx * s;
      t.y = t.baseY + Math.sin((t.age / 1000) * Math.PI * 2 * t.freq + t.phase) * t.amp;
      return t.vx > 0 ? t.x < RANGE.X1 + 120 : t.x > RANGE.X0 - 120;
    case 'zip': {
      if (t.wait > 0) {
        t.wait -= dt;
        t.vx = 0;
        t.vy = 0;
        t.y += Math.sin(t.age / 180) * 0.4;
        if (t.wait <= 0) {
          if (t.hops <= 0) return false;
          t.hops--;
          t.tx = Math.max(RANGE.X0 + 80, Math.min(RANGE.X1 - 80, t.x + (rnd() - 0.5) * 700));
          t.ty = Math.max(RANGE.Y0 + 50, Math.min(RANGE.Y1 - 80, t.y + (rnd() - 0.5) * 420));
        }
        return true;
      }
      const dx = t.tx - t.x;
      const dy = t.ty - t.y;
      const d = Math.hypot(dx, dy);
      const step = 1900 * s;
      if (d <= step) {
        t.x = t.tx;
        t.y = t.ty;
        t.wait = 650 + rnd() * 450;
        t.vx = 0;
        t.vy = 0;
      } else {
        t.vx = (dx / d) * 1900;
        t.vy = (dy / d) * 1900;
        t.x += (dx / d) * step;
        t.y += (dy / d) * step;
      }
      return true;
    }
    case 'disc': {
      t.life -= dt;
      const rise = Math.min(1, t.age / 320);
      const sink = t.life < 320 ? Math.max(0, t.life / 320) : 1;
      const k = Math.min(rise, sink);
      t.y = RANGE.DECK_Y + 40 + (t.baseY - RANGE.DECK_Y - 40) * (1 - (1 - k) * (1 - k));
      t.vy = 0;
      return t.life > 0;
    }
    case 'balloon':
      t.y += t.vy * s;
      t.x = t.baseY + Math.sin((t.age / 1000) * Math.PI * 2 * t.freq + t.phase) * t.amp;
      return t.y > -160;
  }
}

/** Does a blast of radius `r` at (x, y) touch the target? (Discs count a hit near the middle as a bullseye.) */
export function blastHits(t: Target, x: number, y: number, r: number): boolean {
  if (t.dead || (t.kind === 'balloon' && t.safe > 0)) return false;
  const reach = t.kind === 'balloon' ? t.r * 0.85 : t.r * 0.9;
  return Math.hypot(t.x - x, t.y - y) < r + reach;
}

export function isBullseye(t: Target, x: number, y: number): boolean {
  return t.kind === 'disc' && Math.hypot(t.x - x, t.y - y) < 18;
}

/** Score multiplier for a combo count. */
export function comboMult(combo: number): number {
  return Math.min(RANGE.COMBO_MAX, 1 + Math.floor(combo / RANGE.COMBO_STEP));
}

/** Charge level (0..1) after holding A for `held` ms. */
export function chargeLevel(held: number): number {
  return Math.max(0, Math.min(1, (held - RANGE.CHARGE_DELAY) / RANGE.CHARGE_MS));
}

export function bigRadius(charge: number): number {
  return RANGE.BIG_R0 + (RANGE.BIG_R1 - RANGE.BIG_R0) * charge;
}

// --- The marksman (one player's shooting state, shared by people and CPUs) -------------------

export interface Gunner {
  /** Reticle position and velocity. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  cd: number;
  /** A held A: time held (ms) and whether it can still become a charged blast. */
  held: number;
  charging: boolean;
  combo: number;
  comboT: number;
}

export function newGunner(x: number): Gunner {
  return { x, y: 460, vx: 0, vy: 0, cd: 0, held: 0, charging: false, combo: 0, comboT: 0 };
}

export interface RangeInput {
  stickX: number;
  stickY: number;
  holdA: boolean;
  pressA: boolean;
}

export type Shot = { kind: 'quick' | 'big'; x: number; y: number; r: number; charge: number } | null;

/** Move the reticle and work the trigger: a quick blast on the press, a charged one on release. */
export function stepGunner(g: Gunner, inp: RangeInput, dt: number): Shot {
  const s = dt / 1000;
  const slow = g.charging && g.held > RANGE.CHARGE_DELAY ? RANGE.RET_CHARGE_K : 1;
  let ix = inp.stickX;
  let iy = inp.stickY;
  const m = Math.hypot(ix, iy);
  if (m > 1) {
    ix /= m;
    iy /= m;
  }
  const k = 1 - Math.exp(-RANGE.RET_K * s);
  g.vx += (ix * RANGE.RET_MAX * slow - g.vx) * k;
  g.vy += (iy * RANGE.RET_MAX * slow - g.vy) * k;
  g.x = Math.max(RANGE.RX0, Math.min(RANGE.RX1, g.x + g.vx * s));
  g.y = Math.max(RANGE.RY0, Math.min(RANGE.RY1, g.y + g.vy * s));
  if (g.cd > 0) g.cd -= dt;
  if (g.comboT > 0) {
    g.comboT -= dt;
    if (g.comboT <= 0) g.combo = 0;
  }
  let shot: Shot = null;
  if (inp.pressA) {
    g.held = 0;
    g.charging = true;
    if (g.cd <= 0) {
      g.cd = RANGE.QUICK_CD;
      shot = { kind: 'quick', x: g.x, y: g.y, r: RANGE.QUICK_R, charge: 0 };
    }
  } else if (inp.holdA && g.charging) {
    g.held += dt;
  } else if (!inp.holdA && g.charging) {
    const c = chargeLevel(g.held);
    g.charging = false;
    g.held = 0;
    if (c >= RANGE.CHARGE_MIN) {
      g.cd = RANGE.BIG_CD;
      shot = { kind: 'big', x: g.x, y: g.y, r: bigRadius(c), charge: c };
    }
  }
  return shot;
}

/** Register the hits of a shot: points (with the combo) for targets, the cost of any balloon. */
export function scoreHits(g: Gunner, hits: readonly { kind: TargetKind; killed: boolean; bullseye: boolean }[]): { points: number; balloon: boolean } {
  let points = 0;
  let balloon = false;
  for (const h of hits) {
    if (h.kind === 'balloon') {
      balloon = true;
      continue;
    }
    g.combo++;
    g.comboT = RANGE.COMBO_MS;
    if (h.killed) points += (KINDS[h.kind].pts + (h.bullseye ? 1 : 0)) * comboMult(g.combo);
  }
  if (balloon) {
    g.combo = 0;
    g.comboT = 0;
    points -= RANGE.BALLOON_COST;
  }
  return { points, balloon };
}

// --- CPU marksman ----------------------------------------------------------------------------

export interface RangeSkill {
  reaction: number;
  accuracy: number;
  mistake: number;
  aimNoise: number;
  think: number;
}

export interface RangeBrain {
  think: number;
  tid: number;
  /** Aim error (px), re-rolled each think, and how long before it may fire at a new target. */
  ox: number;
  oy: number;
  settle: number;
  /** Charging a big blast at this target. */
  charge: boolean;
  /** Blind to balloons for this shot (a slip). */
  careless: boolean;
  holding: boolean;
}

export function newBrain(): RangeBrain {
  return { think: 0, tid: -1, ox: 0, oy: 0, settle: 0, charge: false, careless: false, holding: false };
}

/** Is a balloon within `r` (plus its size) of (x, y)? */
export function balloonNear(targets: readonly Target[], x: number, y: number, r: number): boolean {
  for (const t of targets) if (t.kind === 'balloon' && !t.dead && t.safe <= 0 && Math.hypot(t.x - x, t.y - y) < r + t.r * 0.85 + 12) return true;
  return false;
}

/** Targets (not balloons) within `r` of (x, y). */
export function clusterAt(targets: readonly Target[], x: number, y: number, r: number): number {
  let n = 0;
  for (const t of targets) if (t.kind !== 'balloon' && !t.dead && Math.hypot(t.x - x, t.y - y) < r) n++;
  return n;
}

/**
 * The CPU marksman: picks a target worth the reticle's trip (not one another CPU is on, not one
 * behind a balloon), leads it, fires when on it, and charges a big blast for armoured heavies and
 * tight clusters. Weaker marksmen aim wider, settle slower and sometimes forget the balloons.
 */
export function rangeCpu(b: RangeBrain, g: Gunner, targets: readonly Target[], claimed: ReadonlySet<number>, sk: RangeSkill, dt: number, rnd: () => number, inp: RangeInput): RangeInput {
  inp.stickX = 0;
  inp.stickY = 0;
  inp.pressA = false;
  inp.holdA = b.holding;
  b.think -= dt;
  if (b.settle > 0) b.settle -= dt;
  let t: Target | undefined;
  for (const q of targets) if (q.id === b.tid && !q.dead) t = q;
  if (b.think <= 0 || !t) {
    b.think = sk.think * (0.8 + rnd() * 0.4);
    const n = sk.aimNoise * 46;
    b.ox = (rnd() - 0.5) * 2 * n;
    b.oy = (rnd() - 0.5) * 2 * n;
    b.careless = rnd() < sk.mistake * 1.3;
    const pick = choose(targets, g, claimed, sk, rnd, b.tid);
    if (pick && (!t || pick.id !== t.id)) {
      b.tid = pick.id;
      b.settle = sk.reaction * (0.3 + rnd() * 0.3);
      b.charge = pick.kind === 'heavy' || clusterAt(targets, pick.x, pick.y, 130) >= 3;
    }
    t = pick ?? undefined;
  }
  if (!t) {
    if (b.holding) b.holding = false;
    inp.holdA = false;
    return inp;
  }
  const lead = 0.1 + sk.reaction / 3000;
  const ax = t.x + t.vx * lead + b.ox;
  const ay = t.y + t.vy * lead + b.oy;
  const dx = ax - g.x;
  const dy = ay - g.y;
  const d = Math.hypot(dx, dy);
  const gain = Math.min(1, d / 150);
  if (d > 4) {
    inp.stickX = (dx / d) * gain;
    inp.stickY = (dy / d) * gain;
  }
  const onTarget = Math.hypot(t.x - g.x, t.y - g.y) < t.r * 0.8 + 8;
  if (b.charge) {
    // Hold to charge while closing in; let go when charged, on target, and clear of balloons.
    if (!b.holding) {
      if (b.settle <= 0 && g.cd <= 0 && (b.careless || !balloonNear(targets, g.x, g.y, RANGE.QUICK_R))) {
        inp.pressA = true;
        b.holding = true;
      }
    } else {
      const c = chargeLevel(g.held);
      const r = bigRadius(c);
      if (c >= 0.85 && onTarget && (b.careless || !balloonNear(targets, g.x, g.y, r))) b.holding = false;
      else if (c >= 1 && !onTarget && d > 300) b.holding = false;
    }
    inp.holdA = b.holding;
    return inp;
  }
  if (b.holding) {
    b.holding = false;
    inp.holdA = false;
    return inp;
  }
  if (b.settle <= 0 && g.cd <= 0 && onTarget && (b.careless || !balloonNear(targets, g.x, g.y, RANGE.QUICK_R))) {
    inp.pressA = true;
    b.holding = true;
    inp.holdA = true;
    b.settle = 60;
  }
  return inp;
}

function choose(targets: readonly Target[], g: Gunner, claimed: ReadonlySet<number>, sk: RangeSkill, rnd: () => number, current: number): Target | null {
  let best: Target | null = null;
  let bestScore = -Infinity;
  const blunder = rnd() < sk.mistake;
  for (const t of targets) {
    if (t.kind === 'balloon' || t.dead) continue;
    if (t.x < RANGE.RX0 || t.x > RANGE.RX1 || t.y > RANGE.RY1) continue;
    const d = Math.hypot(t.x - g.x, t.y - g.y);
    let score = (KINDS[t.kind].pts + 1) / (1 + d / 420) - (claimed.has(t.id) ? 0.9 : 0) - (balloonNear(targets, t.x, t.y, 20) ? 1.2 * sk.accuracy : 0);
    // Leaving soon (a disc sinking, a drone at the far edge): less worth the trip.
    if (t.kind === 'disc' && t.life < 700) score -= 0.8;
    if (t.kind !== 'zip' && t.kind !== 'disc' && (t.vx > 0 ? t.x > RANGE.X1 - 120 : t.x < RANGE.X0 + 120)) score -= 0.6;
    if (t.id === current) score += 0.3;
    if (blunder) score = rnd();
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}
