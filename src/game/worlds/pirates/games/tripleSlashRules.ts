// Triple Slash: the pure rules (Phaser-free, unit-tested in tests/unit/pirates-triple-slash.test.ts) - the
// harbour camera, the chute lanes, the shared note chart, timing grades and scoring.

/**
 * The harbour's pinhole camera and cargo chutes, in metres (keep in step with
 * scripts/art/worlds/pirates/mg_harbour.py): the camera at (0, 0, camH) pitched `pitch` degrees down,
 * `focal` px across a 1920 px screen. Chute i runs on the floor (z = floorZ) from (nearX[i], yNear) at
 * the players to (farX[i], yFar) at the ship; its three lanes sit `lane` m apart across it.
 */
export const HARBOUR = {
  camH: 3.5,
  pitch: 15,
  focal: 1300,
  floorZ: 0.3,
  yNear: 4.62,
  yCut: 7.0,
  yFar: 32.3,
  nearX: [-2.872, -0.957, 0.957, 2.872] as readonly number[],
  farX: [-3.548, -1.183, 1.183, 3.548] as readonly number[],
  lane: 0.6,
} as const;

const PITCH = (HARBOUR.pitch * Math.PI) / 180;
const COS_P = Math.cos(PITCH);
const SIN_P = Math.sin(PITCH);

export interface Proj {
  x: number;
  y: number;
  /** Screen px per metre at that depth. */
  s: number;
}

/** Screen position (1920 x 1080) of a world point, and the scale there. */
export function project(X: number, Y: number, Z: number, out: Proj = { x: 0, y: 0, s: 0 }): Proj {
  const dz = Z - HARBOUR.camH;
  const zc = Y * COS_P - dz * SIN_P;
  const yc = Y * SIN_P + dz * COS_P;
  const k = HARBOUR.focal / zc;
  out.x = 960 + X * k;
  out.y = 540 - yc * k;
  out.s = k;
  return out;
}

/**
 * World X of lane `lane` (0 left, 1 centre, 2 right; fractional between) of chute `chute` at depth Y.
 * The chutes are straight and nearly parallel, so the lane offset is taken straight across X.
 */
export function laneX(chute: number, lane: number, Y: number): number {
  const t = (Y - HARBOUR.yNear) / (HARBOUR.yFar - HARBOUR.yNear);
  const cx = HARBOUR.nearX[chute] + (HARBOUR.farX[chute] - HARBOUR.nearX[chute]) * t;
  return cx + (lane - 1) * HARBOUR.lane;
}

/** Which chutes the players take: the middle ones for two, the left three for three. */
export function chutesFor(players: number): number[] {
  if (players <= 1) return [1];
  if (players === 2) return [1, 2];
  if (players === 3) return [0, 1, 2];
  return [0, 1, 2, 3];
}

// --- The chart ---------------------------------------------------------------------------------------
export type NoteKind = 'barrel' | 'crate' | 'fish' | 'bomb' | 'gold';

export interface Note {
  /** When it crosses the cut line, ms after GO. */
  t: number;
  /** The lane it crosses in (0 left, 1 centre, 2 right). */
  lane: number;
  kind: NoteKind;
  /** The lane it starts down (a flying fish can hop across one lane on the way). */
  from: number;
}

export interface ChartOpts {
  duration: number;
  /** ms per beat, and from `fastFrom` ms the quicker beat of the final stretch. */
  beat: number;
  fastBeat: number;
  fastFrom: number;
  /** First crossing, ms after GO. */
  start: number;
}

/**
 * The round's notes, shared by every player (so it's a fair race of timing). It opens with a note every
 * other beat, settles into one a beat with doubles, then adds off-beats, lane-hopping fish and the odd
 * triple for the quick final stretch. Bombs never come in triples; two notes never crowd one lane.
 */
export function buildChart(rand: () => number, o: ChartOpts): Note[] {
  const notes: Note[] = [];
  const lastInLane = [-1e9, -1e9, -1e9];
  let lastGold = -1e9;
  let t = o.start;
  let prevLane = 1;
  const pickLane = (avoid: number[]): number => {
    const free = [0, 1, 2].filter((l) => !avoid.includes(l));
    if (!free.length) return -1;
    return free[Math.floor(rand() * free.length)];
  };
  const kindAt = (time: number, allowBomb: boolean): NoteKind => {
    const r = rand();
    if (allowBomb && time > 4000 && r < 0.14) return 'bomb';
    if (time > 5000 && time - lastGold > 4500 && r < 0.19) {
      lastGold = time;
      return 'gold';
    }
    if (time > 7000 && r < 0.36) return 'fish';
    return r < 0.62 ? 'crate' : 'barrel';
  };
  const add = (time: number, lane: number, kind: NoteKind, beat: number) => {
    if (time - lastInLane[lane] < beat * 0.45) return false;
    let from = lane;
    if (kind === 'fish' && time > 15000 && rand() < 0.45) {
      const side = lane === 0 ? 1 : lane === 2 ? -1 : rand() < 0.5 ? -1 : 1;
      from = lane + side;
    }
    notes.push({ t: Math.round(time), lane, kind, from });
    lastInLane[lane] = time;
    return true;
  };
  while (t < o.duration - 250) {
    const beat = t >= o.fastFrom ? o.fastBeat : o.beat;
    const late = t / o.duration;
    const phase = t < 10000 ? 0 : t < 20000 ? 1 : t < o.fastFrom ? 2 : 3;
    // how many lanes this beat: doubles from 14 s, the odd triple in the final stretch
    let count = 1;
    const r = rand();
    if (phase === 3 && r < 0.08) count = 3;
    else if ((phase === 1 && t > 14000 && r < 0.16) || (phase === 2 && r < 0.26) || (phase === 3 && r < 0.34)) count = 2;
    const used: number[] = [];
    for (let k = 0; k < count; k++) {
      // a lone note tends to move to a new lane (a gentle zig-zag reads well)
      const lane = count === 1 && rand() < 0.7 ? pickLane([prevLane]) : pickLane(used);
      if (lane < 0) break;
      const kind = kindAt(t, count < 3 && !(count === 2 && used.length === 1 && notes[notes.length - 1]?.kind === 'bomb'));
      if (add(t, lane, kind, beat)) used.push(lane);
    }
    if (used.length) prevLane = used[used.length - 1];
    // an off-beat note in another lane, now and then, once the round has warmed up
    if (phase >= 2 && count === 1 && rand() < 0.2 + 0.1 * late) {
      const lane = pickLane(used);
      if (lane >= 0) add(t + beat / 2, lane, kindAt(t + beat / 2, false), beat);
    }
    t += phase === 0 ? beat * 2 : beat;
  }
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  return notes;
}

// --- Timing and scoring ------------------------------------------------------------------------------
export type Grade = 'perfect' | 'good' | 'ok';

/** Half-widths (ms) of the timing windows round each crossing. */
export const WINDOW: Record<Grade, number> = { perfect: 55, good: 115, ok: 170 };
/** A bomb goes off if slashed this close to its crossing. */
export const BOMB_WINDOW = 140;
export const BOMB_PENALTY = 5;
export const DODGE_POINTS = 1;

/** The grade for a slash `dt` ms off a crossing (null: too far off to count). */
export function judge(dt: number): Grade | null {
  const a = Math.abs(dt);
  if (a <= WINDOW.perfect) return 'perfect';
  if (a <= WINDOW.good) return 'good';
  if (a <= WINDOW.ok) return 'ok';
  return null;
}

/** Combo multiplier: x2 from 5 in a row, x3 from 15, x4 from 30. */
export function comboMult(combo: number): number {
  return combo >= 30 ? 4 : combo >= 15 ? 3 : combo >= 5 ? 2 : 1;
}

/** Points for a clean slice: the grade, plus a bonus for fish and golden barrels, times the combo. */
export function slicePoints(grade: Grade, kind: NoteKind, combo: number): number {
  const base = grade === 'perfect' ? 3 : grade === 'good' ? 2 : 1;
  const bonus = kind === 'gold' ? 3 : kind === 'fish' ? 1 : 0;
  return (base + bonus) * comboMult(combo);
}

/** The lane a note is in at progress u (0 at the far end, 1 at the cut): fish hop between 45% and 65%. */
export function laneAt(n: Note, u: number): number {
  if (n.from === n.lane) return n.lane;
  const k = Math.min(1, Math.max(0, (u - 0.45) / 0.2));
  const e = k * k * (3 - 2 * k);
  return n.from + (n.lane - n.from) * e;
}
