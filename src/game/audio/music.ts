// A tiny look-ahead step sequencer that plays procedurally composed festival loops.
// Melodies are generated from a seed per track (so each loop is stable) using chord tones on
// strong beats and scale steps in between.
import { Random } from '../util/Random';

export type MusicKey = 'menu' | 'board' | 'boardFinal' | 'minigame' | 'results' | 'final';

type Quality = 'maj' | 'min';
interface TrackDef {
  bpm: number;
  key: number; // MIDI note of the tonic (lead octave)
  progression: [number, Quality][]; // chord roots in semitones above the key
  lead: { type: OscillatorType; vol: number; decay: number };
  counter?: { type: OscillatorType; vol: number };
  bass: { type: OscillatorType; vol: number; pattern: number[] }; // 0 rest, 1 root, 5 fifth, 8 octave
  pad: number; // pad volume (0 = none)
  drums: { kick: number[]; snare: number[]; hat: number[] };
  rhythms: number[][]; // 16-step templates: 1 = note, 0 = rest/sustain
  seed: number;
  swing: number;
}

const S = (s: string) => s.split('').map((c) => (c === '.' ? 0 : Number(c)));

const TRACKS: Record<MusicKey, TrackDef> = {
  menu: {
    bpm: 100,
    key: 65, // F
    progression: [
      [0, 'maj'],
      [9, 'min'],
      [5, 'maj'],
      [7, 'maj'],
    ],
    lead: { type: 'triangle', vol: 0.09, decay: 0.32 },
    bass: { type: 'triangle', vol: 0.12, pattern: S('1.......5.......') },
    pad: 0.025,
    drums: { kick: S('3.......2.......'), snare: S('........'.padEnd(16, '.')), hat: S('..1...1...1...1.') },
    rhythms: [S('1.1.1...1.1.1...'), S('1...1.1.1...1...')],
    seed: 11,
    swing: 0.08,
  },
  board: {
    bpm: 112,
    key: 67, // G
    progression: [
      [0, 'maj'],
      [9, 'min'],
      [5, 'maj'],
      [7, 'maj'],
    ],
    lead: { type: 'sine', vol: 0.11, decay: 0.18 },
    counter: { type: 'triangle', vol: 0.035 },
    bass: { type: 'triangle', vol: 0.13, pattern: S('1...5...1...5.8.') },
    pad: 0.018,
    drums: { kick: S('3.......3.......'), snare: S('....2.......2...'), hat: S('1.1.1.1.1.1.1.1.') },
    rhythms: [S('1.1.1.1.1...1.1.'), S('1..1..1.1.1.1...')],
    seed: 23,
    swing: 0.12,
  },
  boardFinal: {
    bpm: 124,
    key: 69, // A (a step up for the final round)
    progression: [
      [0, 'maj'],
      [9, 'min'],
      [5, 'maj'],
      [7, 'maj'],
    ],
    lead: { type: 'square', vol: 0.055, decay: 0.16 },
    counter: { type: 'triangle', vol: 0.05 },
    bass: { type: 'sawtooth', vol: 0.06, pattern: S('1.1.5.5.1.1.5.8.') },
    pad: 0.022,
    drums: { kick: S('3...3...3...3...'), snare: S('....3.......3..2'), hat: S('1111111111111111') },
    rhythms: [S('1.1.1.1.1.1.1.1.'), S('1.11.1.11.1.1...')],
    seed: 23,
    swing: 0.04,
  },
  minigame: {
    bpm: 140,
    key: 62, // D
    progression: [
      [0, 'min'],
      [10, 'maj'],
      [8, 'maj'],
      [7, 'maj'],
    ],
    lead: { type: 'square', vol: 0.05, decay: 0.12 },
    counter: { type: 'triangle', vol: 0.045 },
    bass: { type: 'sawtooth', vol: 0.06, pattern: S('1.1.1.1.1.1.1.8.') },
    pad: 0.0,
    drums: { kick: S('3...3...3...3...'), snare: S('....3.......3...'), hat: S('.1.1.1.1.1.1.1.1') },
    rhythms: [S('1.1.11.11.1.1...'), S('1.1.1.1.11.11.1.')],
    seed: 37,
    swing: 0,
  },
  results: {
    bpm: 96,
    key: 72, // C
    progression: [
      [0, 'maj'],
      [5, 'maj'],
      [7, 'maj'],
      [0, 'maj'],
    ],
    lead: { type: 'triangle', vol: 0.1, decay: 0.3 },
    bass: { type: 'triangle', vol: 0.12, pattern: S('1...5...8...5...') },
    pad: 0.03,
    drums: { kick: S('3.......3.......'), snare: S('....2.......2...'), hat: S('1...1...1...1...') },
    rhythms: [S('1...1.1.1.......'), S('1.1.1...1...1...')],
    seed: 41,
    swing: 0.06,
  },
  final: {
    bpm: 120,
    key: 70, // Bb
    progression: [
      [0, 'maj'],
      [9, 'min'],
      [3, 'maj'],
      [5, 'maj'],
    ],
    lead: { type: 'square', vol: 0.055, decay: 0.2 },
    counter: { type: 'triangle', vol: 0.05 },
    bass: { type: 'triangle', vol: 0.14, pattern: S('1.5.8.5.1.5.8.5.') },
    pad: 0.03,
    drums: { kick: S('3...3...3...3...'), snare: S('....3.......3...'), hat: S('1.1.1.1.1.1.1.1.') },
    rhythms: [S('1.1.1.1.1.1.1...'), S('1...1.1.1.1.1.1.')],
    seed: 53,
    swing: 0.05,
  },
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const freq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Note {
  step: number;
  midi: number;
  len: number;
}

function compose(def: TrackDef): Note[][] {
  const rng = new Random(def.seed);
  const bars = def.progression.length * 2;
  const out: Note[][] = [];
  const scale = (deg: number) => {
    const oct = Math.floor(deg / 7);
    return def.key + oct * 12 + MAJOR[((deg % 7) + 7) % 7];
  };
  let deg = 2;
  for (let bar = 0; bar < bars; bar++) {
    const [root, q] = def.progression[bar % def.progression.length];
    const chord = [root, root + (q === 'maj' ? 4 : 3), root + 7].map((x) => ((x % 12) + 12) % 12);
    const rhythm = def.rhythms[(bar >> 1) % def.rhythms.length];
    const notes: Note[] = [];
    const onsets = rhythm.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    onsets.forEach((step, k) => {
      const strong = step % 4 === 0;
      if (strong) {
        // Move to the nearest chord tone.
        let best = deg;
        let bestD = 99;
        for (let d = deg - 3; d <= deg + 3; d++) {
          const pc = ((scale(d) - def.key) % 12 + 12) % 12;
          if (chord.includes(pc) && Math.abs(d - deg) < bestD) {
            bestD = Math.abs(d - deg);
            best = d;
          }
        }
        deg = best + (rng.chance(0.25) ? (rng.chance(0.5) ? 2 : -2) : 0);
      } else {
        deg += rng.pick([-1, -1, 1, 1, 2, -2, 0]);
      }
      deg = Math.max(-2, Math.min(9, deg));
      // Cadence: end of each 4-bar phrase lands on the tonic.
      if (bar % 4 === 3 && k === onsets.length - 1) deg = 7 * Math.round(deg / 7);
      const next = onsets[k + 1] ?? 16;
      notes.push({ step, midi: scale(deg), len: Math.max(1, Math.min(4, next - step)) });
    });
    out.push(notes);
  }
  return out;
}

class TrackPlayer {
  private notes: Note[][];
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  readonly gain: GainNode;
  private timer: number | null = null;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private def: TrackDef,
    private noiseBuf: AudioBuffer,
  ) {
    this.notes = compose(def);
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.0001;
    this.gain.connect(dest);
  }

  start(fadeIn: number): void {
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(0.0001, t);
    this.gain.gain.exponentialRampToValueAtTime(1, t + Math.max(0.05, fadeIn));
    this.nextTime = t + 0.08;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop(fadeOut: number): void {
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(Math.max(0.0001, this.gain.gain.value), t);
    this.gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, fadeOut));
    window.setTimeout(() => {
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null;
      this.gain.disconnect();
    }, fadeOut * 1000 + 200);
  }

  private schedule(): void {
    const stepDur = 60 / this.def.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.14) {
      const swing = this.step % 2 === 1 ? this.def.swing * stepDur : 0;
      this.playStep(this.nextTime + swing, stepDur);
      this.nextTime += stepDur;
      this.step++;
      if (this.step >= 16) {
        this.step = 0;
        this.bar = (this.bar + 1) % this.notes.length;
      }
    }
  }

  private playStep(t: number, stepDur: number): void {
    const d = this.def;
    const s = this.step;
    const [root, q] = d.progression[this.bar % d.progression.length];
    const bassRoot = d.key - 24 + root;
    // Drums
    if (d.drums.kick[s]) this.kick(t, d.drums.kick[s] / 3);
    if (d.drums.snare[s]) this.snare(t, d.drums.snare[s] / 3);
    if (d.drums.hat[s]) this.hat(t, d.drums.hat[s] / 3);
    // Bass
    const bp = d.bass.pattern[s];
    if (bp) {
      const m = bassRoot + (bp === 5 ? 7 : bp === 8 ? 12 : 0);
      this.voice(t, freq(m), stepDur * 1.8, d.bass.type, d.bass.vol, 0.01, 0.12);
    }
    // Pad on bar start
    if (s === 0 && d.pad > 0) {
      const third = q === 'maj' ? 4 : 3;
      for (const iv of [0, third, 7]) this.voice(t, freq(d.key - 12 + root + iv), stepDur * 15, 'sawtooth', d.pad, 0.25, 0.4, 900);
    }
    // Lead
    for (const n of this.notes[this.bar]) {
      if (n.step === s) {
        this.voice(t, freq(n.midi), Math.max(stepDur * n.len * 0.9, d.lead.decay), d.lead.type, d.lead.vol, 0.008, d.lead.decay);
        if (d.counter && n.len >= 2) this.voice(t, freq(n.midi - 12 + (q === 'maj' ? 4 : 3)), stepDur * n.len * 0.8, d.counter.type, d.counter.vol, 0.02, 0.1);
      }
    }
  }

  private voice(t: number, f: number, dur: number, type: OscillatorType, vol: number, attack: number, release: number, lowpass?: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    let n: AudioNode = o;
    if (lowpass) {
      const f2 = ctx.createBiquadFilter();
      f2.type = 'lowpass';
      f2.frequency.value = lowpass;
      o.connect(f2);
      n = f2;
    }
    n.connect(g).connect(this.gain);
    o.start(t);
    o.stop(t + dur + release + 0.05);
  }

  private kick(t: number, v: number): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.28 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.gain);
    o.start(t);
    o.stop(t + 0.2);
  }

  private noiseHit(t: number, dur: number, vol: number, type: BiquadFilterType, f: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(this.gain);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  private snare(t: number, v: number): void {
    this.noiseHit(t, 0.14, 0.12 * v, 'bandpass', 1800);
  }

  private hat(t: number, v: number): void {
    this.noiseHit(t, 0.04, 0.045 * v, 'highpass', 7000);
  }
}

export class MusicEngine {
  private current: { key: MusicKey; player: TrackPlayer } | null = null;

  constructor(
    private ctx: AudioContext,
    private dest: AudioNode,
    private noiseBuf: AudioBuffer,
  ) {}

  get currentKey(): MusicKey | null {
    return this.current?.key ?? null;
  }

  play(key: MusicKey, fade = 0.8): void {
    if (this.current?.key === key) return;
    this.current?.player.stop(fade);
    const player = new TrackPlayer(this.ctx, this.dest, TRACKS[key], this.noiseBuf);
    player.start(fade);
    this.current = { key, player };
  }

  stop(fade = 0.8): void {
    this.current?.player.stop(fade);
    this.current = null;
  }
}
