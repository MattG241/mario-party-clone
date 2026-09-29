// Procedural sound effects built from oscillators and filtered noise.
// Each recipe schedules its voices on the given AudioContext starting at time `t`.

export type SfxKey =
  | 'menuMove'
  | 'confirm'
  | 'cancel'
  | 'error'
  | 'join'
  | 'leave'
  | 'ready'
  | 'pause'
  | 'dialTick'
  | 'dialStop'
  | 'step'
  | 'chipGain'
  | 'chipLose'
  | 'itemGet'
  | 'itemUse'
  | 'jump'
  | 'land'
  | 'hit'
  | 'portal'
  | 'eventAlert'
  | 'victory'
  | 'defeat'
  | 'countdown'
  | 'go'
  | 'finish'
  | 'drumroll'
  | 'cymbal'
  | 'relic'
  | 'whoosh'
  | 'pop'
  | 'splash'
  | 'explosion'
  | 'bounce'
  | 'shop'
  | 'trap'
  | 'shield'
  | 'crack'
  | 'rumble'
  | 'fanfare'
  | 'cheer'
  // Minigame "big moments" (BaseMinigame) and minigame juice.
  | 'countHit'
  | 'crowdRoar'
  | 'crowdCheer'
  | 'finalCall'
  | 'tick'
  | 'stamp'
  | 'crown'
  | 'streak'
  | 'goldChip'
  | 'fuse'
  | 'warn'
  | 'alarm'
  | 'sweep'
  | 'nearMiss';

export interface Voice {
  ctx: AudioContext;
  out: AudioNode;
  noise: AudioBuffer;
}

type OscType = OscillatorType;

function env(g: GainNode, t: number, vol: number, attack: number, dur: number, release = 0.05): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + Math.max(0.002, attack));
  g.gain.setValueAtTime(Math.max(0.0002, vol), t + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

export function tone(
  v: Voice,
  t: number,
  o: { type?: OscType; freq: number; to?: number; dur: number; vol?: number; attack?: number; release?: number; detune?: number; vibrato?: number; pan?: number },
): void {
  const { ctx } = v;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
  if (o.detune) osc.detune.setValueAtTime(o.detune, t);
  const g = ctx.createGain();
  env(g, t, o.vol ?? 0.2, o.attack ?? 0.005, o.dur, o.release ?? Math.min(0.08, o.dur * 0.5));
  let node: AudioNode = osc;
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 7;
    lg.gain.value = o.vibrato;
    lfo.connect(lg).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + o.dur + 0.05);
  }
  node.connect(g);
  node = g;
  if (o.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    node.connect(p);
    node = p;
  }
  node.connect(v.out);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

export function noise(
  v: Voice,
  t: number,
  o: { dur: number; vol?: number; filter?: BiquadFilterType; freq?: number; to?: number; q?: number; attack?: number },
): void {
  const { ctx } = v;
  const src = ctx.createBufferSource();
  src.buffer = v.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? 'lowpass';
  f.frequency.setValueAtTime(o.freq ?? 1200, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t + o.dur);
  f.Q.value = o.q ?? 0.8;
  const g = ctx.createGain();
  env(g, t, o.vol ?? 0.2, o.attack ?? 0.004, o.dur, Math.min(0.1, o.dur * 0.6));
  src.connect(f).connect(g).connect(v.out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + o.dur + 0.05);
}

const N = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

function arp(v: Voice, t: number, notes: number[], step: number, o: { type?: OscType; vol?: number; dur?: number } = {}): void {
  notes.forEach((m, i) => tone(v, t + i * step, { type: o.type ?? 'triangle', freq: N(m), dur: o.dur ?? step * 1.8, vol: o.vol ?? 0.16 }));
}

export const SFX: Record<SfxKey, (v: Voice, t: number, p: number) => void> = {
  menuMove: (v, t) => tone(v, t, { type: 'triangle', freq: 820, to: 980, dur: 0.05, vol: 0.12 }),
  confirm: (v, t) => {
    tone(v, t, { type: 'sine', freq: N(76), dur: 0.08, vol: 0.18 });
    tone(v, t + 0.06, { type: 'sine', freq: N(83), dur: 0.14, vol: 0.18 });
    tone(v, t + 0.06, { type: 'triangle', freq: N(95), dur: 0.1, vol: 0.05 });
  },
  cancel: (v, t) => tone(v, t, { type: 'triangle', freq: 540, to: 300, dur: 0.14, vol: 0.16 }),
  error: (v, t) => {
    tone(v, t, { type: 'square', freq: 180, dur: 0.1, vol: 0.08 });
    tone(v, t + 0.11, { type: 'square', freq: 150, dur: 0.14, vol: 0.08 });
  },
  join: (v, t, p) => arp(v, t, [67, 71, 74, 79].map((m) => m + Math.round((p - 1) * 6)), 0.05, { type: 'triangle', vol: 0.15 }),
  leave: (v, t) => arp(v, t, [74, 69, 62], 0.06, { type: 'triangle', vol: 0.12 }),
  ready: (v, t) => {
    arp(v, t, [72, 76, 79], 0.04, { type: 'sine', vol: 0.14, dur: 0.3 });
    tone(v, t + 0.12, { type: 'triangle', freq: N(84), dur: 0.35, vol: 0.1 });
  },
  pause: (v, t) => {
    tone(v, t, { type: 'sine', freq: N(72), dur: 0.12, vol: 0.14 });
    tone(v, t + 0.08, { type: 'sine', freq: N(67), dur: 0.16, vol: 0.14 });
  },
  dialTick: (v, t, p) => tone(v, t, { type: 'square', freq: 1150 * p, dur: 0.018, vol: 0.05 }),
  dialStop: (v, t) => {
    tone(v, t, { type: 'sine', freq: N(84), dur: 0.6, vol: 0.18, release: 0.4 });
    tone(v, t, { type: 'sine', freq: N(91), dur: 0.45, vol: 0.08, release: 0.3 });
    noise(v, t, { dur: 0.05, vol: 0.08, filter: 'highpass', freq: 4000 });
  },
  step: (v, t, p) => {
    tone(v, t, { type: 'sine', freq: 190 * p, to: 110 * p, dur: 0.07, vol: 0.16 });
    noise(v, t, { dur: 0.03, vol: 0.05, filter: 'bandpass', freq: 900 });
  },
  chipGain: (v, t, p) => {
    tone(v, t, { type: 'sine', freq: N(88) * p, dur: 0.07, vol: 0.13 });
    tone(v, t + 0.055, { type: 'sine', freq: N(93) * p, dur: 0.16, vol: 0.13 });
    tone(v, t + 0.055, { type: 'triangle', freq: N(100) * p, dur: 0.08, vol: 0.04 });
  },
  chipLose: (v, t) => {
    tone(v, t, { type: 'square', freq: 760, to: 330, dur: 0.18, vol: 0.07 });
    tone(v, t + 0.1, { type: 'triangle', freq: 520, to: 220, dur: 0.2, vol: 0.1 });
  },
  itemGet: (v, t) => arp(v, t, [72, 76, 79, 84, 88], 0.045, { type: 'triangle', vol: 0.14 }),
  itemUse: (v, t) => {
    tone(v, t, { type: 'sine', freq: 500, to: 1200, dur: 0.18, vol: 0.12 });
    noise(v, t + 0.05, { dur: 0.2, vol: 0.05, filter: 'highpass', freq: 3000 });
  },
  jump: (v, t, p) => tone(v, t, { type: 'sine', freq: 300 * p, to: 720 * p, dur: 0.13, vol: 0.14 }),
  land: (v, t) => {
    noise(v, t, { dur: 0.08, vol: 0.14, filter: 'lowpass', freq: 500 });
    tone(v, t, { type: 'sine', freq: 130, to: 70, dur: 0.1, vol: 0.14 });
  },
  hit: (v, t) => {
    noise(v, t, { dur: 0.14, vol: 0.18, filter: 'bandpass', freq: 1300, q: 1.2 });
    tone(v, t, { type: 'square', freq: 220, to: 70, dur: 0.16, vol: 0.09 });
  },
  portal: (v, t) => {
    tone(v, t, { type: 'sine', freq: 260, to: 1040, dur: 0.7, vol: 0.12, vibrato: 18 });
    tone(v, t + 0.1, { type: 'triangle', freq: 520, to: 1560, dur: 0.6, vol: 0.06, vibrato: 30 });
    noise(v, t, { dur: 0.7, vol: 0.05, filter: 'bandpass', freq: 800, to: 4000, q: 3 });
  },
  eventAlert: (v, t) => {
    for (const m of [69, 73, 76]) tone(v, t, { type: 'sawtooth', freq: N(m), dur: 0.34, vol: 0.05, attack: 0.03 });
    for (const m of [74, 78, 81]) tone(v, t + 0.2, { type: 'sawtooth', freq: N(m), dur: 0.45, vol: 0.05, attack: 0.03 });
  },
  victory: (v, t) => {
    arp(v, t, [72, 76, 79, 84], 0.11, { type: 'square', vol: 0.07, dur: 0.2 });
    for (const m of [72, 76, 79, 84]) tone(v, t + 0.46, { type: 'triangle', freq: N(m), dur: 0.8, vol: 0.08 });
  },
  defeat: (v, t) => {
    const notes = [67, 66, 65, 64];
    notes.forEach((m, i) => tone(v, t + i * 0.22, { type: 'triangle', freq: N(m), to: i === 3 ? N(62) : undefined, dur: i === 3 ? 0.6 : 0.22, vol: 0.12, vibrato: i === 3 ? 6 : 0 }));
  },
  countdown: (v, t) => tone(v, t, { type: 'sine', freq: 880, dur: 0.16, vol: 0.17 }),
  go: (v, t) => {
    tone(v, t, { type: 'square', freq: 1320, dur: 0.3, vol: 0.07 });
    for (const m of [72, 76, 79]) tone(v, t, { type: 'triangle', freq: N(m + 12), dur: 0.4, vol: 0.07 });
  },
  finish: (v, t) => {
    noise(v, t, { dur: 0.5, vol: 0.12, filter: 'highpass', freq: 5000 });
    arp(v, t, [79, 76, 72], 0.07, { type: 'square', vol: 0.06, dur: 0.14 });
  },
  drumroll: (v, t) => {
    for (let i = 0; i < 24; i++) noise(v, t + i * 0.045, { dur: 0.04, vol: 0.04 + i * 0.004, filter: 'bandpass', freq: 1800, q: 0.9 });
  },
  cymbal: (v, t) => noise(v, t, { dur: 1.2, vol: 0.14, filter: 'highpass', freq: 6000 }),
  relic: (v, t) => {
    for (let i = 0; i < 6; i++) tone(v, t + i * 0.07, { type: 'sine', freq: N(84 + [0, 4, 7, 11, 14, 19][i]), dur: 0.9 - i * 0.08, vol: 0.09 });
    tone(v, t, { type: 'triangle', freq: 330, to: 990, dur: 0.6, vol: 0.06, vibrato: 12 });
  },
  whoosh: (v, t) => noise(v, t, { dur: 0.28, vol: 0.13, filter: 'bandpass', freq: 400, to: 2400, q: 1.4, attack: 0.08 }),
  pop: (v, t, p) => tone(v, t, { type: 'sine', freq: 620 * p, to: 1300 * p, dur: 0.05, vol: 0.14 }),
  splash: (v, t) => {
    noise(v, t, { dur: 0.35, vol: 0.18, filter: 'lowpass', freq: 3500, to: 400 });
    tone(v, t, { type: 'sine', freq: 500, to: 150, dur: 0.18, vol: 0.06 });
  },
  explosion: (v, t) => {
    noise(v, t, { dur: 0.8, vol: 0.3, filter: 'lowpass', freq: 900, to: 90 });
    tone(v, t, { type: 'sine', freq: 90, to: 40, dur: 0.5, vol: 0.25 });
  },
  bounce: (v, t) => tone(v, t, { type: 'sine', freq: 200, to: 620, dur: 0.22, vol: 0.14, vibrato: 25 }),
  shop: (v, t) => {
    tone(v, t, { type: 'sine', freq: N(88), dur: 0.3, vol: 0.12 });
    tone(v, t + 0.07, { type: 'sine', freq: N(92), dur: 0.35, vol: 0.12 });
    noise(v, t, { dur: 0.06, vol: 0.06, filter: 'highpass', freq: 5000 });
  },
  trap: (v, t) => {
    noise(v, t, { dur: 0.09, vol: 0.2, filter: 'bandpass', freq: 2200, q: 2 });
    tone(v, t, { type: 'square', freq: 160, to: 90, dur: 0.14, vol: 0.1 });
  },
  shield: (v, t) => {
    tone(v, t, { type: 'sine', freq: 900, to: 1500, dur: 0.4, vol: 0.1, vibrato: 40 });
    tone(v, t + 0.05, { type: 'triangle', freq: 1800, dur: 0.3, vol: 0.04 });
  },
  crack: (v, t) => {
    noise(v, t, { dur: 0.12, vol: 0.2, filter: 'highpass', freq: 1500 });
    noise(v, t + 0.1, { dur: 0.3, vol: 0.12, filter: 'lowpass', freq: 800, to: 200 });
  },
  rumble: (v, t) => noise(v, t, { dur: 0.9, vol: 0.16, filter: 'lowpass', freq: 220, to: 120 }),
  fanfare: (v, t) => {
    const seq: [number, number, number][] = [
      [72, 0, 0.14],
      [72, 0.15, 0.1],
      [72, 0.26, 0.1],
      [77, 0.38, 0.5],
    ];
    for (const [m, dt, d] of seq) {
      tone(v, t + dt, { type: 'square', freq: N(m), dur: d, vol: 0.06 });
      tone(v, t + dt, { type: 'sawtooth', freq: N(m - 12), dur: d, vol: 0.04 });
    }
    for (const m of [77, 81, 84]) tone(v, t + 0.38, { type: 'triangle', freq: N(m), dur: 0.8, vol: 0.07 });
  },
  cheer: (v, t) => {
    for (let i = 0; i < 5; i++) noise(v, t + i * 0.09, { dur: 0.35, vol: 0.05, filter: 'bandpass', freq: 1400 + i * 300, q: 2 });
    arp(v, t, [79, 84, 88], 0.08, { type: 'triangle', vol: 0.08 });
  },
  // --- Minigame big moments ---------------------------------------------------------------------
  // A floor-tom hit for "3, 2, 1": a pitched body that drops fast, a beater click and a short skin
  // rattle. The rate lifts the pitch a little on each number.
  countHit: (v, t, p) => {
    tone(v, t, { type: 'sine', freq: 150 * p, to: 58 * p, dur: 0.34, vol: 0.34, attack: 0.002, release: 0.24 });
    tone(v, t, { type: 'triangle', freq: 310 * p, to: 120 * p, dur: 0.1, vol: 0.12, attack: 0.001 });
    noise(v, t, { dur: 0.08, vol: 0.15, filter: 'bandpass', freq: 1900, q: 0.9 });
    noise(v, t, { dur: 0.26, vol: 0.09, filter: 'lowpass', freq: 420, to: 110 });
  },
  // Many voices at once: overlapping formant-band noise swelling in, with a couple of whistles.
  crowdRoar: (v, t) => {
    [480, 820, 1250, 1900, 2800].forEach((f, i) => noise(v, t + i * 0.025, { dur: 1.05 - i * 0.06, vol: 0.07, filter: 'bandpass', freq: f, to: f * 1.12, q: 1.6, attack: 0.12 }));
    noise(v, t, { dur: 0.9, vol: 0.05, filter: 'lowpass', freq: 700, attack: 0.1 });
    tone(v, t + 0.12, { type: 'sine', freq: 1900, to: 2600, dur: 0.32, vol: 0.035, vibrato: 30 });
    tone(v, t + 0.3, { type: 'sine', freq: 2300, to: 1700, dur: 0.28, vol: 0.03 });
  },
  // A longer cheer for the finish: the roar plus scattered claps and whistles.
  crowdCheer: (v, t) => {
    [520, 900, 1400, 2100, 3000].forEach((f, i) => noise(v, t + i * 0.03, { dur: 1.7 - i * 0.1, vol: 0.065, filter: 'bandpass', freq: f, to: f * 0.92, q: 1.4, attack: 0.15 }));
    for (let i = 0; i < 16; i++) noise(v, t + 0.08 + i * 0.085 + Math.random() * 0.03, { dur: 0.03, vol: 0.055, filter: 'bandpass', freq: 2000 + Math.random() * 1400, q: 1.2 });
    tone(v, t + 0.2, { type: 'sine', freq: 2000, to: 2800, dur: 0.35, vol: 0.035, vibrato: 25 });
    tone(v, t + 0.6, { type: 'sine', freq: 2400, to: 1900, dur: 0.3, vol: 0.03 });
  },
  // "FINAL 10 SECONDS!": a rising brass triplet and a held, bright chord.
  finalCall: (v, t) => {
    const seq: [number, number][] = [
      [74, 0],
      [77, 0.08],
      [81, 0.16],
    ];
    for (const [m, dt] of seq) {
      tone(v, t + dt, { type: 'square', freq: N(m), dur: 0.09, vol: 0.06 });
      tone(v, t + dt, { type: 'sawtooth', freq: N(m - 12), dur: 0.09, vol: 0.035 });
    }
    for (const m of [81, 85, 88]) tone(v, t + 0.26, { type: 'sawtooth', freq: N(m), dur: 0.5, vol: 0.034, attack: 0.02, vibrato: 5 });
    noise(v, t + 0.26, { dur: 0.35, vol: 0.045, filter: 'highpass', freq: 5000 });
  },
  // A soft woodblock tick (the last seconds of a timed round).
  tick: (v, t, p) => {
    tone(v, t, { type: 'sine', freq: 1250 * p, to: 1080 * p, dur: 0.05, vol: 0.12, attack: 0.001 });
    noise(v, t, { dur: 0.025, vol: 0.05, filter: 'bandpass', freq: 3200, q: 2 });
  },
  // A rubber stamp landing: a low thud and a paper slap ("OUT!", "FINISH!").
  stamp: (v, t) => {
    tone(v, t, { type: 'sine', freq: 115, to: 45, dur: 0.28, vol: 0.3, attack: 0.001 });
    noise(v, t, { dur: 0.07, vol: 0.2, filter: 'bandpass', freq: 1100, q: 0.8 });
    noise(v, t, { dur: 0.2, vol: 0.08, filter: 'lowpass', freq: 600, to: 150 });
  },
  // The leader's crown changing heads: a small glittering two-note shimmer.
  crown: (v, t) => {
    tone(v, t, { type: 'triangle', freq: N(91), dur: 0.12, vol: 0.06 });
    tone(v, t + 0.07, { type: 'triangle', freq: N(96), dur: 0.22, vol: 0.06 });
    noise(v, t, { dur: 0.22, vol: 0.025, filter: 'highpass', freq: 7000 });
  },
  // A catch streak: a sparkling run up (the rate lifts it with the streak).
  streak: (v, t, p) => {
    [84, 88, 91, 96].forEach((m, i) => tone(v, t + i * 0.045, { type: 'triangle', freq: N(m) * p, dur: 0.16, vol: 0.08 }));
    tone(v, t + 0.18, { type: 'sine', freq: N(100) * p, dur: 0.3, vol: 0.05, vibrato: 12 });
  },
  // A golden chip: a richer, brighter jingle than a plain one.
  goldChip: (v, t) => {
    [88, 92, 95, 100].forEach((m, i) => tone(v, t + i * 0.04, { type: 'sine', freq: N(m), dur: 0.2, vol: 0.1 }));
    tone(v, t + 0.16, { type: 'triangle', freq: N(104), dur: 0.35, vol: 0.05, vibrato: 10 });
    noise(v, t, { dur: 0.3, vol: 0.035, filter: 'highpass', freq: 6000 });
  },
  // A fizzing fuse (a fake capsule has landed and is about to burst).
  fuse: (v, t) => {
    noise(v, t, { dur: 0.7, vol: 0.045, filter: 'highpass', freq: 4500, attack: 0.02 });
    noise(v, t, { dur: 0.7, vol: 0.03, filter: 'bandpass', freq: 2500, to: 5200, q: 3 });
  },
  // A short warning pip (the rate climbs as the danger gets closer).
  warn: (v, t, p) => tone(v, t, { type: 'square', freq: 1040 * p, dur: 0.06, vol: 0.045 }),
  // A two-tone alarm ("SPEED UP!").
  alarm: (v, t) => {
    for (let i = 0; i < 3; i++) {
      tone(v, t + i * 0.2, { type: 'square', freq: 880, dur: 0.09, vol: 0.05 });
      tone(v, t + i * 0.2 + 0.1, { type: 'square', freq: 660, dur: 0.09, vol: 0.05 });
    }
    tone(v, t, { type: 'sawtooth', freq: 220, to: 330, dur: 0.6, vol: 0.028 });
  },
  // A bright rising swish (a light sweeping across a stage).
  sweep: (v, t) => noise(v, t, { dur: 0.6, vol: 0.08, filter: 'bandpass', freq: 600, to: 5200, q: 2.2, attack: 0.12 }),
  // A near miss: a close whoosh and a bright ding.
  nearMiss: (v, t, p) => {
    noise(v, t, { dur: 0.18, vol: 0.1, filter: 'bandpass', freq: 900, to: 3200, q: 1.6, attack: 0.03 });
    tone(v, t + 0.06, { type: 'sine', freq: N(93) * p, dur: 0.22, vol: 0.09 });
    tone(v, t + 0.06, { type: 'triangle', freq: N(100) * p, dur: 0.12, vol: 0.03 });
  },
};

/** Subtitle captions for sounds that carry meaning. */
export const SFX_CAPTIONS: Partial<Record<SfxKey, string>> = {
  dialStop: '[Orbit Dial chimes]',
  chipGain: '[Coins jingle]',
  chipLose: '[Coins scatter]',
  itemGet: '[Item fanfare]',
  portal: '[Portal hums]',
  eventAlert: '[Festival horn sounds]',
  victory: '[Victory fanfare]',
  defeat: '[Deflated trombone]',
  countdown: '[Countdown beep]',
  go: '[Starting whistle: GO!]',
  finish: '[Finish whistle]',
  drumroll: '[Drumroll]',
  relic: '[Star Coin shimmers]',
  explosion: '[Boom!]',
  splash: '[Splash!]',
  trap: '[Snare snaps shut]',
  shield: '[Bubble shield pops up]',
  crack: '[Wood cracks]',
  rumble: '[Ground rumbles]',
  fanfare: '[Trumpet fanfare]',
  cheer: '[Crowd cheers]',
  crowdRoar: '[Crowd roars]',
  crowdCheer: '[Crowd cheers]',
  finalCall: '[Hurry-up fanfare]',
  goldChip: '[Golden coin chimes]',
  alarm: '[Alarm blares]',
};
