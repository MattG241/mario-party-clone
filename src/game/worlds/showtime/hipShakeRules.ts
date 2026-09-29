// Hip-Shake Hustle's pure rules (no Phaser, so they can be unit tested): the dance chart everyone
// performs, how a press is judged against it, streak multipliers and points.
import { Random } from '../../util/Random';

/** Tempo of the backing band: 120 beats a minute. */
export const BPM = 120;
export const BEAT_MS = 60000 / BPM;
/** The first note lands on this beat after GO (the band plays a bar on its own first). */
export const FIRST_BEAT = 4;
/** Beats in a round of 45 s at this tempo. */
export const ROUND_BEATS = 90;

/** Dance moves: the four directions (stick or D-pad) and the pose (A). */
export type Move = 'L' | 'R' | 'U' | 'D' | 'A';
export const MOVES: readonly Move[] = ['L', 'R', 'U', 'D', 'A'];

export interface Note {
  /** Beat after GO (quarter notes; halves are eighth notes). */
  beat: number;
  /** When it should be hit, ms after GO. */
  t: number;
  move: Move;
}

export type Section = 'warm' | 'groove' | 'hot' | 'encore';

/** The four parts of the routine, by the beat they start on. */
export const SECTIONS: readonly { from: number; section: Section }[] = [
  { from: 0, section: 'warm' },
  { from: 24, section: 'groove' },
  { from: 44, section: 'hot' },
  { from: 68, section: 'encore' },
];

export function sectionAt(beat: number): Section {
  let s: Section = 'warm';
  for (const e of SECTIONS) if (beat >= e.from) s = e.section;
  return s;
}

/** Rhythms (beat offsets inside a four-beat bar) each part draws its bars from. */
const RHYTHMS: Record<Section, number[][]> = {
  warm: [
    [0, 2],
    [0, 1, 2],
    [0, 2, 3],
  ],
  groove: [
    [0, 1, 2, 3],
    [0, 1, 2],
    [0, 2, 3],
    [0, 1, 3],
  ],
  hot: [
    [0, 1, 1.5, 2, 3],
    [0, 0.5, 1, 2, 3],
    [0, 1, 2, 2.5, 3],
    [0, 1, 2, 3],
  ],
  encore: [
    [0, 0.5, 1, 2, 2.5, 3],
    [0, 1, 1.5, 2, 3],
    [0, 0.5, 1, 1.5, 2, 3],
    [0, 1, 2, 2.5, 3],
  ],
};

/** Step patterns: dance figures read in order onto a bar's rhythm (the last step repeats if short). */
const FIGURES: Record<Section, Move[][]> = {
  warm: [
    ['L', 'R', 'L', 'R'],
    ['R', 'L', 'R', 'L'],
    ['L', 'L', 'R', 'R'],
  ],
  groove: [
    ['L', 'R', 'L', 'R'],
    ['U', 'D', 'U', 'D'],
    ['L', 'U', 'R', 'D'],
    ['R', 'U', 'L', 'D'],
    ['L', 'L', 'R', 'R'],
    ['U', 'U', 'D', 'D'],
  ],
  hot: [
    ['L', 'R', 'R', 'L', 'U'],
    ['U', 'D', 'D', 'U', 'L'],
    ['L', 'U', 'R', 'D', 'L'],
    ['R', 'L', 'L', 'R', 'D'],
    ['D', 'U', 'L', 'R', 'U'],
  ],
  encore: [
    ['L', 'L', 'R', 'U', 'U', 'D'],
    ['R', 'R', 'L', 'D', 'D', 'U'],
    ['L', 'R', 'U', 'D', 'L', 'R'],
    ['U', 'D', 'L', 'L', 'R', 'R'],
  ],
};

/** Bars whose last step is replaced by the pose (A): the end of each part, and more often later. */
function poseBar(bar: number, section: Section, lastOfSection: boolean): boolean {
  if (lastOfSection) return true;
  if (section === 'groove') return bar % 3 === 1;
  if (section === 'hot') return bar % 2 === 1;
  return section === 'encore';
}

/**
 * The routine for one round: bars of four beats from FIRST_BEAT, each a rhythm and a dance figure
 * drawn (seeded) from its part of the routine, busier as it goes; poses (A) close bars now and
 * then; the finale is one last pose. Everybody dances the same chart.
 */
export function buildChart(seed: number, roundBeats: number = ROUND_BEATS): Note[] {
  const rng = new Random(seed ^ 0x51f7);
  const out: Note[] = [];
  // The last full bar must end well before the buzzer (the finale pose closes it).
  const lastBar = Math.floor((roundBeats - 8 - FIRST_BEAT) / 4);
  for (let bar = 0; bar <= lastBar; bar++) {
    const start = FIRST_BEAT + bar * 4;
    const section = sectionAt(start);
    const nextSection = sectionAt(start + 4);
    const lastOfSection = nextSection !== section || bar === lastBar;
    const rhythm = rng.pick(RHYTHMS[section]);
    const figure = rng.pick(FIGURES[section]);
    const pose = poseBar(bar, section, lastOfSection);
    rhythm.forEach((off, i) => {
      let move = figure[Math.min(i, figure.length - 1)];
      const last = i === rhythm.length - 1;
      if (last && pose) move = 'A';
      out.push({ beat: start + off, t: (start + off) * BEAT_MS, move });
    });
  }
  // The finale: a big pose two beats after the last bar.
  const finale = FIRST_BEAT + (lastBar + 1) * 4 + 2;
  if (finale <= roundBeats - 2) out.push({ beat: finale, t: finale * BEAT_MS, move: 'A' });
  return out;
}

// --- Judging ---------------------------------------------------------------------------------
/** Timing windows (ms either side of the note). */
export const JUDGE = { perfect: 55, good: 115, catch: 200 } as const;
/**
 * Presses are compared with the note time plus this much: players hear the band a moment after it
 * plays (audio and TV latency), so an honest on-the-beat press lands a touch late.
 */
export const LATE_BIAS = 25;
/** A second press this soon after a hit is a bounce, not a new move (no penalty). */
export const BOUNCE_MS = 110;

export type Grade = 'perfect' | 'good' | 'bad';

/** Grade of a press `dt` ms from a note (bias already removed), or null outside the catch window. */
export function gradeOffset(dt: number): Grade | null {
  const a = Math.abs(dt);
  if (a <= JUDGE.perfect) return 'perfect';
  if (a <= JUDGE.good) return 'good';
  if (a <= JUDGE.catch) return 'bad';
  return null;
}

/** Streak multiplier: x1, then one more every 8 hits in a row, up to x4. */
export function multiplier(streak: number): number {
  return 1 + Math.min(3, Math.floor(Math.max(0, streak) / 8));
}

/** Points for a hit: PERFECT 3, GOOD 1, times the multiplier; poses count double, and so does the encore. */
export function hitPoints(grade: 'perfect' | 'good', streakBefore: number, pose: boolean, encore: boolean): number {
  const base = grade === 'perfect' ? 3 : 1;
  return base * multiplier(streakBefore) * (pose ? 2 : 1) * (encore ? 2 : 1);
}

/** When a streak reaches a multiple of 8 the crowd swoons (returns the level: 1 at 8, 2 at 16, ...). */
export function swoonLevel(streak: number): number {
  return streak > 0 && streak % 8 === 0 ? streak / 8 : 0;
}

export type PressResult =
  | { kind: 'hit'; index: number; grade: 'perfect' | 'good'; points: number; streak: number; swoon: number; dt: number }
  | { kind: 'bad'; index: number; dt: number }
  | { kind: 'wrong'; index: number }
  | { kind: 'whiff' }
  | { kind: 'bounce' };

/**
 * One dancer's scorecard against the shared chart: which notes they have taken, their streak and
 * their points. Times are ms after GO.
 */
export class DanceCard {
  score = 0;
  streak = 0;
  best = 0;
  perfects = 0;
  goods = 0;
  misses = 0;
  /** 0 = open, 1 = hit, 2 = missed. */
  readonly state: Uint8Array;
  /** Index of the first note still open (everything before it is settled). */
  private head = 0;
  private lastHitAt = -1e9;

  constructor(readonly notes: readonly Note[]) {
    this.state = new Uint8Array(notes.length);
  }

  /** The open note nearest to time t within the catch window, or -1. */
  nearest(t: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = this.head; i < this.notes.length; i++) {
      const n = this.notes[i];
      const d = t - (n.t + LATE_BIAS);
      if (d < -JUDGE.catch) break;
      if (this.state[i] !== 0 || d > JUDGE.catch) continue;
      if (Math.abs(d) < bestD) {
        bestD = Math.abs(d);
        best = i;
      }
    }
    return best;
  }

  /** A press of `move` at time t (encore: double points). */
  press(move: Move, t: number, encore: boolean): PressResult {
    const i = this.nearest(t);
    if (i < 0) {
      if (t - this.lastHitAt < BOUNCE_MS) return { kind: 'bounce' };
      this.breakStreak();
      return { kind: 'whiff' };
    }
    const n = this.notes[i];
    const dt = t - (n.t + LATE_BIAS);
    if (n.move !== move) {
      if (t - this.lastHitAt < BOUNCE_MS) return { kind: 'bounce' };
      this.settle(i, 2);
      this.misses++;
      this.breakStreak();
      return { kind: 'wrong', index: i };
    }
    const g = gradeOffset(dt);
    if (g === 'perfect' || g === 'good') {
      const pts = hitPoints(g, this.streak, n.move === 'A', encore);
      this.settle(i, 1);
      this.streak++;
      this.best = Math.max(this.best, this.streak);
      this.score += pts;
      if (g === 'perfect') this.perfects++;
      else this.goods++;
      this.lastHitAt = t;
      return { kind: 'hit', index: i, grade: g, points: pts, streak: this.streak, swoon: swoonLevel(this.streak), dt };
    }
    this.settle(i, 2);
    this.misses++;
    this.breakStreak();
    return { kind: 'bad', index: i, dt };
  }

  /** Notes whose window closed by time t without a press: marked missed (streak broken). Returns how many. */
  sweep(t: number, out?: number[]): number {
    let n = 0;
    for (let i = this.head; i < this.notes.length; i++) {
      if (this.notes[i].t + LATE_BIAS + JUDGE.catch >= t) break;
      if (this.state[i] === 0) {
        this.settle(i, 2);
        this.misses++;
        this.breakStreak();
        out?.push(i);
        n++;
      }
    }
    return n;
  }

  private settle(i: number, s: 1 | 2): void {
    this.state[i] = s;
    while (this.head < this.notes.length && this.state[this.head] !== 0) this.head++;
  }

  private breakStreak(): void {
    this.streak = 0;
  }
}
