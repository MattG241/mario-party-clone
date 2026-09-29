"""Original trailer score for Gleamtrail, synthesised offline (numpy + scipy, no samples).

    python3 scripts/dev/trailer/music.py <out.wav>

A bright festival piece in G major at 124 BPM, arranged to the trailer edit (edit.py imports
BPM/BAR and the section bars from here, so cuts land on the beat):

    bars  0-1   cold open: the countdown. A hit on each number (beats 2, 3, 4), GO! on bar 1,
                two more hits, a snare pickup
    bars  2-3   title hit: brass chord, crash, pad, glockenspiel twinkles
    bars  4-15  groove (the guests, the select screen, the board): marimba hook, bass, claps,
                pizzicato offbeats; glockenspiel and tambourine join as it goes
    bars 16-17  build (final round, minigame time): pedal bass, snare roll, riser
    bars 18-27  chorus (minigame montage): brass hook, four-on-the-floor, crashes; the last two
                bars are fills for the rapid-fire cuts
    bar  28     FINISH!: one big hit and the band stops
    bars 29-30  drumroll under the ceremony, a riser
    bar  31     the winner lands: cymbal and a brass fanfare
    bars 32-35  end card: the final chord rings out

Instruments are simple physical/additive models (modal marimba and glockenspiel, additive plucks,
detuned additive brass and pad, synthesised drums) mixed through a convolution reverb and a gentle
bus compressor.
"""
from __future__ import annotations

import math
import sys

import numpy as np
from scipy import signal

SR = 48000
BPM = 124.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
EIGHTH = BEAT / 2
# Section starts (bars), shared with edit.py.
COLD, TITLE, GROOVE, BUILD, CHORUS, FINISH, ROLL, WINNER, END = 0, 2, 4, 16, 18, 28, 29, 31, 32
N_BARS = 37  # 36 bars of music + the final chord ringing out
RNG = np.random.default_rng(7)


def midi_hz(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


def t_of(bar: float, eighth: float = 0.0) -> float:
    return bar * BAR + eighth * EIGHTH


# ------------------------------------------------------------------------------------------
# Filters and helpers
def sos(kind: str, f, order: int = 2):
    return signal.butter(order, f, btype=kind, fs=SR, output='sos')


def filt(x, kind, f, order=2):
    return signal.sosfilt(sos(kind, f, order), x)


def env_ad(n: int, attack: float, tau: float) -> np.ndarray:
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0.0, 1.0)
    return a * np.exp(-np.maximum(t - attack, 0.0) / tau)


def env_asr(n: int, attack: float, sustain_len: float, release: float) -> np.ndarray:
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0.0, 1.0)
    r = np.clip(1.0 - (t - sustain_len) / max(release, 1e-4), 0.0, 1.0)
    return a * np.where(t > sustain_len, r, 1.0) ** 1.5


def partials(f: float, n: int, ratios, amps, taus, attack=0.002, detune_cents=0.0, phase_rand=True) -> np.ndarray:
    t = np.arange(n) / SR
    out = np.zeros(n)
    for r, a, tau in zip(ratios, amps, taus):
        fr = f * r * 2.0 ** (detune_cents / 1200.0)
        if fr >= SR * 0.45:
            continue
        ph = RNG.uniform(0, math.tau) if phase_rand else 0.0
        out += a * np.sin(math.tau * fr * t + ph) * np.exp(-t / tau)
    att = np.clip(t / attack, 0.0, 1.0)
    return out * att


# ------------------------------------------------------------------------------------------
# Instruments (each returns a mono array starting at the note onset)
def marimba(m: float, vel: float = 1.0) -> np.ndarray:
    f = midi_hz(m)
    tau = 1.1 * (262.0 / f) ** 0.55
    n = int(SR * min(3.0, tau * 5))
    x = partials(f, n, [1.0, 3.99, 10.1], [1.0, 0.32, 0.08], [tau, tau * 0.22, tau * 0.07], attack=0.0015)
    click = filt(RNG.standard_normal(int(0.006 * SR)), 'bandpass', [1500, 5000]) * np.hanning(int(0.006 * SR)) * 0.25
    x[: len(click)] += click
    return x * vel * 0.5


def glock(m: float, vel: float = 1.0) -> np.ndarray:
    f = midi_hz(m)
    n = int(SR * 2.6)
    x = partials(f, n, [1.0, 2.76, 5.40, 8.93], [1.0, 0.38, 0.2, 0.08], [1.6, 0.6, 0.3, 0.15], attack=0.001)
    return x * vel * 0.33


def pluck(m: float, vel: float = 1.0, tau: float = 0.3, bright: float = 1.0) -> np.ndarray:
    """Additive plucked string (pizzicato for short tau, harp for long)."""
    f = midi_hz(m)
    n = int(SR * min(3.0, tau * 6))
    ks = np.arange(1, 13)
    amps = (1.0 / ks ** 1.25) * np.exp(-(ks - 1) / (5.0 * bright))
    taus = tau / (1.0 + 0.55 * (ks - 1))
    x = partials(f, n, ks, amps, taus, attack=0.0015)
    return x * vel * 0.42


def bass(m: float, dur: float, vel: float = 1.0) -> np.ndarray:
    f = midi_hz(m)
    n = int(SR * (dur + 0.12))
    t = np.arange(n) / SR
    body = np.sin(math.tau * f * t) + 0.35 * np.sin(math.tau * 2 * f * t + 0.3) + 0.12 * np.sin(math.tau * 3 * f * t + 0.9)
    e = env_asr(n, 0.004, dur, 0.1) * (0.62 + 0.38 * np.exp(-t / 0.14))
    return body * e * vel * 0.34


def brass(m: float, dur: float, vel: float = 1.0) -> np.ndarray:
    """Two detuned additive saw voices with a swelling brightness and delayed vibrato."""
    f = midi_hz(m)
    n = int(SR * (dur + 0.18))
    t = np.arange(n) / SR
    vib = 1.0 + 0.0065 * np.sin(math.tau * 5.4 * t) * np.clip((t - 0.18) / 0.25, 0.0, 1.0)
    bright = 3.0 + 9.0 * np.clip(t / 0.07, 0.0, 1.0) * (0.75 + 0.25 * np.exp(-t / 0.4))
    out = np.zeros(n)
    for det in (-7.0, 6.0):
        fv = f * 2.0 ** (det / 1200.0) * vib
        ph = np.cumsum(fv) / SR * math.tau
        for k in range(1, 22):
            if f * k > SR * 0.42:
                break
            out += (1.0 / k) * np.exp(-k / bright) * np.sin(k * ph)
    e = env_asr(n, 0.035, dur, 0.16)
    return out * e * vel * 0.25


def pad(m: float, dur: float, vel: float = 1.0) -> np.ndarray:
    f = midi_hz(m)
    n = int(SR * (dur + 0.9))
    t = np.arange(n) / SR
    out = np.zeros(n)
    for det in (-9.0, -3.0, 4.0, 10.0):
        ph = math.tau * f * 2.0 ** (det / 1200.0) * t + RNG.uniform(0, math.tau)
        for k in range(1, 9):
            out += (1.0 / k ** 1.4) * np.sin(k * ph)
    e = env_asr(n, 0.45, dur, 0.85)
    return out * e * vel * 0.028


def kick(vel=1.0):
    n = int(SR * 0.45)
    t = np.arange(n) / SR
    fr = 48.0 + 115.0 * np.exp(-t / 0.035)
    ph = np.cumsum(fr) / SR * math.tau
    body = np.sin(ph) * np.exp(-t / 0.22)
    click = filt(RNG.standard_normal(n), 'highpass', 3000) * np.exp(-t / 0.004) * 0.35
    return (body + click) * vel * 0.8


def snare(vel=1.0):
    n = int(SR * 0.35)
    t = np.arange(n) / SR
    tone = np.sin(math.tau * 190 * t) * np.exp(-t / 0.05) * 0.5
    noise = filt(RNG.standard_normal(n), 'bandpass', [1200, 7500]) * np.exp(-t / 0.13)
    return (tone + noise) * vel * 0.6


def clap(vel=1.0):
    n = int(SR * 0.4)
    t = np.arange(n) / SR
    e = np.zeros(n)
    for k, d in enumerate((0.0, 0.011, 0.022, 0.034)):
        e += np.where(t >= d, np.exp(-(t - d) / (0.008 if k < 3 else 0.12)), 0.0)
    x = filt(RNG.standard_normal(n), 'bandpass', [900, 4200]) * e
    return x * vel * 1.0


def hat(vel=1.0, open_=False):
    n = int(SR * (0.32 if open_ else 0.08))
    t = np.arange(n) / SR
    x = filt(RNG.standard_normal(n), 'highpass', 7200) * np.exp(-t / (0.11 if open_ else 0.022))
    return x * vel * 0.26


def tamb(vel=1.0):
    n = int(SR * 0.16)
    t = np.arange(n) / SR
    jing = 0.6 + 0.4 * np.sin(math.tau * 60 * t)
    x = filt(RNG.standard_normal(n), 'bandpass', [5500, 11000]) * np.exp(-t / 0.045) * jing
    return x * vel * 0.22


def crash(vel=1.0, length=2.2):
    n = int(SR * length)
    t = np.arange(n) / SR
    x = filt(RNG.standard_normal(n), 'highpass', 3200) * np.exp(-t / (length / 3.2))
    x += filt(RNG.standard_normal(n), 'bandpass', [5000, 12000]) * np.exp(-t / 0.35) * 0.6
    return x * vel * 0.22


def tom(m, vel=1.0):
    n = int(SR * 0.5)
    t = np.arange(n) / SR
    f0 = midi_hz(m)
    fr = f0 * (1.0 + 0.5 * np.exp(-t / 0.04))
    x = np.sin(np.cumsum(fr) / SR * math.tau) * np.exp(-t / 0.2)
    return x * vel * 0.55


def riser(length: float, vel=1.0):
    n = int(SR * length)
    t = np.arange(n) / SR
    u = t / length
    noise = RNG.standard_normal(n)
    # sweep a band-pass through the noise in short blocks (centre 300 Hz -> 9 kHz)
    out = np.zeros(n)
    blk = 2048
    for i in range(0, n, blk):
        c = 300.0 * (30.0 ** (i / n))
        lo, hi = c * 0.7, min(c * 1.5, SR * 0.45)
        out[i:i + blk] = filt(noise[max(0, i - 512):i + blk], 'bandpass', [lo, hi])[-len(noise[i:i + blk]):]
    tone = np.sin(np.cumsum(220.0 * (4.0 ** u)) / SR * math.tau) * 0.15
    return (out + tone) * (u ** 2.2) * vel * 0.5


def impact(vel=1.0):
    n = int(SR * 3.0)
    t = np.arange(n) / SR
    boom = np.sin(np.cumsum(38.0 + 40.0 * np.exp(-t / 0.08)) / SR * math.tau) * np.exp(-t / 0.9)
    return boom * vel * 0.9


def whoosh(length=0.6, vel=1.0):
    n = int(SR * length)
    t = np.arange(n) / SR
    u = t / length
    x = RNG.standard_normal(n)
    out = np.zeros(n)
    blk = 1024
    for i in range(0, n, blk):
        c = 500.0 * (12.0 ** (4 * (i / n) * (1 - i / n)))
        seg = filt(x[max(0, i - 256):i + blk], 'bandpass', [c * 0.6, min(c * 1.6, SR * 0.45)])
        out[i:i + blk] = seg[-len(x[i:i + blk]):]
    return out * np.sin(math.pi * u) ** 2 * vel * 0.35


# ------------------------------------------------------------------------------------------
class Mix:
    def __init__(self, seconds: float):
        self.n = int(SR * seconds)
        self.buses: dict[str, np.ndarray] = {}
        self.cfg: dict[str, tuple[float, float]] = {}

    def bus(self, name: str, pan: float = 0.0, send: float = 0.2):
        if name not in self.buses:
            self.buses[name] = np.zeros((2, self.n))
            self.cfg[name] = (pan, send)

    def add(self, name: str, x: np.ndarray, t: float, pan: float | None = None, gain: float = 1.0):
        s = int(round(t * SR))
        if s >= self.n or s + len(x) <= 0:
            return
        x = x[: self.n - s]
        p = self.cfg[name][0] if pan is None else pan
        a = (p + 1.0) * math.pi / 4.0
        self.buses[name][0, s:s + len(x)] += x * math.cos(a) * gain
        self.buses[name][1, s:s + len(x)] += x * math.sin(a) * gain

    def report(self, t0: float, t1: float):
        a, b = int(t0 * SR), int(t1 * SR)
        for name, bus in sorted(self.buses.items(), key=lambda kv: -np.sqrt(np.mean(kv[1][:, a:b] ** 2))):
            r = np.sqrt(np.mean(bus[:, a:b] ** 2)) + 1e-12
            print(f'  {name:8s} {20 * np.log10(r):6.1f} dB rms')

    def render(self, automation=None) -> np.ndarray:
        dry = np.zeros((2, self.n))
        send = np.zeros((2, self.n))
        for name, b in self.buses.items():
            dry += b
            send += b * self.cfg[name][1]
        wet = reverb(send)
        out = dry + wet * 0.9
        if automation is not None:
            out = out * automation(self.n)
        out = compress(out)
        out = np.tanh(out * 1.1) / 1.1
        peak = np.max(np.abs(out)) + 1e-9
        return out * (10 ** (-1.0 / 20) / peak)


def reverb(x: np.ndarray) -> np.ndarray:
    ln = int(SR * 2.4)
    t = np.arange(ln) / SR
    irs = []
    for ch in range(2):
        noise = RNG.standard_normal(ln)
        ir = noise * np.exp(-t * 6.9 / 1.9)
        ir = filt(ir, 'lowpass', 7000)
        ir[: int(0.018 * SR)] = 0.0  # pre-delay
        irs.append(ir / np.sqrt(np.sum(ir ** 2)))
    return np.stack([signal.fftconvolve(x[c], irs[c])[: x.shape[1]] for c in range(2)]) * 0.55


def compress(x: np.ndarray, thresh_db=-11.0, ratio=1.8) -> np.ndarray:
    level = np.sqrt(signal.lfilter([1 - 0.9990], [1, -0.9990], np.mean(x ** 2, axis=0)) + 1e-12)
    db = 20 * np.log10(level)
    over = np.maximum(db - thresh_db, 0.0)
    gr_db = over * (1 - 1 / ratio)
    gr = 10 ** (-gr_db / 20)
    # smooth the gain (fast attack, slow release) with a one-pole follower
    g = signal.lfilter([1 - 0.9995], [1, -0.9995], gr)
    return x * g


# ------------------------------------------------------------------------------------------
# Score
G, A_, B, C, D, E, Fs = 67, 69, 71, 72, 74, 76, 78  # G4..F#5
CHORDS = {'G': (43, [55, 59, 62]), 'Em': (40, [52, 55, 59]), 'C': (48, [52, 55, 60]), 'D': (50, [54, 57, 62]),
          'Am': (45, [57, 60, 64]), 'Bm': (47, [54, 59, 62])}

# per-bar chords: a name, or two names for a split bar (beats 1-2, beats 3-4)
CHART = (['Em', ('C', 'D')] +                                     # 0-1 cold open
         ['G', ('C', 'D')] +                                       # 2-3 title
         ['G', 'Em', 'C', 'D', 'G', 'Em', ('C', 'D'), 'G'] +       # 4-11 groove
         ['G', 'Em', 'C', 'D'] +                                   # 12-15 groove
         ['C', 'D'] +                                              # 16-17 build
         ['G', 'D', 'Em', 'C', 'G', 'D', ('C', 'D'), 'G'] +        # 18-25 chorus
         ['G', ('C', 'D')] +                                       # 26-27 chorus fills
         ['G'] +                                                   # 28 FINISH!
         ['Em', ('C', 'D')] +                                      # 29-30 drumroll
         ['G'] +                                                   # 31 the winner
         ['G'] * 5)                                                # 32-36 end card
assert len(CHART) == N_BARS

# hook melodies: (eighth position, midi, length in eighths)
HOOK_A = [
    [(0, B, 1), (1, D, 1), (2, 79, 2), (4, Fs, 1), (5, E, 1), (6, D, 2)],
    [(0, E, 1), (1, D, 1), (2, B, 2), (4, 67, 1), (5, 69, 1), (6, B, 2)],
    [(0, C, 1), (1, E, 1), (2, 79, 2), (4, 81, 1), (5, 79, 1), (6, E, 2)],
    [(0, Fs, 2), (2, 81, 2), (4, 79, 1), (5, Fs, 1), (6, E, 1), (7, D, 1)],
    [(0, B, 1), (1, D, 1), (2, 79, 2), (4, Fs, 1), (5, E, 1), (6, D, 2)],
    [(0, E, 1), (1, D, 1), (2, B, 2), (4, D, 1), (5, E, 1), (6, 79, 2)],
    [(0, 79, 2), (2, E, 1), (3, 79, 1), (4, Fs, 2), (6, 81, 2)],
    [(0, 79, 4), (4, D, 1), (5, B, 1), (6, 67, 2)],
]
HOOK_C = [
    [(0, B, 1), (1, D, 1), (2, 79, 2), (4, Fs, 1), (5, E, 1), (6, D, 2)],
    [(0, 81, 2), (2, Fs, 1), (3, E, 1), (4, D, 2), (6, E, 1), (7, Fs, 1)],
    [(0, 79, 2), (2, E, 1), (3, D, 1), (4, B, 2), (6, D, 1), (7, E, 1)],
    [(0, E, 2), (2, 79, 2), (4, 84, 2), (6, 83, 1), (7, 81, 1)],
    [(0, 79, 1), (1, 81, 1), (2, 83, 2), (4, 81, 1), (5, 79, 1), (6, D, 2)],
    [(0, 81, 2), (2, Fs, 2), (4, D, 1), (5, E, 1), (6, Fs, 2)],
    [(0, E, 1), (1, 79, 1), (2, 84, 2), (4, 81, 2), (6, Fs, 1), (7, 81, 1)],
    [(0, 79, 6), (6, D, 1), (7, B, 1)],
]
# The winner's fanfare (bar 31): three voices of "da-da-da-DAAA" and a climb.
FANFARE = [
    [(0, D, 1), (1, D, 1), (2, D, 1), (3, 79, 3), (6, 81, 1), (7, 83, 1)],
    [(0, B, 1), (1, B, 1), (2, B, 1), (3, D, 3), (6, Fs, 1), (7, 79, 1)],
    [(0, 67, 1), (1, 67, 1), (2, 67, 1), (3, B, 3), (6, D, 1), (7, D, 1)],
]


def chord_at(bar: int, eighth: float) -> str:
    c = CHART[bar]
    if isinstance(c, tuple):
        return c[0] if eighth < 4 else c[1]
    return c


def build() -> np.ndarray:
    mix = Mix(N_BARS * BAR + 0.5)
    for name, pan, send in [('marimba', -0.15, 0.22), ('glock', 0.25, 0.4), ('pluck', 0.3, 0.25), ('harp', -0.3, 0.35), ('bass', 0.0, 0.03),
                            ('brass', 0.05, 0.28), ('pad', 0.0, 0.45), ('kick', 0.0, 0.04), ('snare', 0.05, 0.18), ('clap', -0.05, 0.2),
                            ('hat', 0.3, 0.08), ('tamb', -0.35, 0.1), ('crash', 0.0, 0.2), ('tom', 0.0, 0.15), ('fx', 0.0, 0.35)]:
        mix.bus(name, pan, send)

    def play_hook(start_bar, hook, inst, octave=0, vel=1.0):
        for i, bar_notes in enumerate(hook):
            for (pos, m, ln) in bar_notes:
                t = t_of(start_bar + i, pos)
                if inst == 'marimba':
                    mix.add('marimba', marimba(m + octave, vel * (1.0 if pos % 2 == 0 else 0.85)), t)
                elif inst == 'brass':
                    mix.add('brass', brass(m + octave, ln * EIGHTH * 0.92, vel), t)
                elif inst == 'glock':
                    mix.add('glock', glock(m + octave, vel), t)

    def bass_bar(bar, pattern):
        for pos, deg, ln in pattern:
            root, _ = CHORDS[chord_at(bar, pos)]
            m = root + {0: 0, 5: 7, 8: 12}[deg]
            mix.add('bass', bass(m, ln * EIGHTH * 0.9), t_of(bar, pos))

    def pads(bar, vel=1.0):
        for half in ((0, 4),) if not isinstance(CHART[bar], tuple) else ((0, 2), (2, 2)):
            name = chord_at(bar, half[0] * 2)
            _, tri = CHORDS[name]
            for m in tri:
                mix.add('pad', pad(m, half[1] * BEAT * 0.98, vel), t_of(bar, half[0] * 2))

    def offbeat_pluck(bar, vel=0.8):
        for pos in (1, 3, 5, 7):
            _, tri = CHORDS[chord_at(bar, pos)]
            for k, m in enumerate(tri):
                mix.add('pluck', pluck(m + 12, vel * (0.9 if k else 1.0), tau=0.18), t_of(bar, pos) + k * 0.004)

    def drums_groove(bar, full=False, fill=False, tamb_on=False):
        for b in range(4):
            if full or b in (0, 2):
                mix.add('kick', kick(1.0 if b % 2 == 0 else 0.9), t_of(bar, b * 2))
            if b in (1, 3):
                mix.add('clap', clap(1.0), t_of(bar, b * 2))
                if full:
                    mix.add('snare', snare(0.55), t_of(bar, b * 2))
        for e in range(8):
            if full:
                if e % 2:
                    mix.add('hat', hat(0.9, open_=True), t_of(bar, e))
            else:
                mix.add('hat', hat(0.85 if e % 2 else 0.55), t_of(bar, e))
        if full or tamb_on:
            for s16 in range(16):
                mix.add('tamb', tamb(0.9 if s16 % 4 == 2 else 0.5), t_of(bar, s16 / 2))
        if not full and bar % 2 == 1:
            mix.add('kick', kick(0.7), t_of(bar, 7))
        if fill:
            for k, m in enumerate((50, 47, 45, 43)):
                mix.add('tom', tom(m, 0.9), t_of(bar, 6 + k * 0.5))

    def stab(t, chord, vel=1.0, low=True):
        """An orchestral hit: kick, a timpani-ish low tom, a short brass chord and the bass."""
        root, tri = CHORDS[chord]
        mix.add('kick', kick(vel), t)
        if low:
            mix.add('tom', tom(root + 12, 0.9 * vel), t)
        for m in tri + [tri[0] + 12]:
            mix.add('brass', brass(m, 0.3, 0.75 * vel), t)
        mix.add('bass', bass(root, 0.35, vel), t)

    def reverse_crash(into_bar, length=1.3, gain=0.75):
        rev = crash(1.0, length)[::-1]
        mix.add('crash', rev, t_of(into_bar) - len(rev) / SR, gain=gain)

    # --- bars 0-1: cold open. A shimmer out of black, then the countdown: 3, 2, 1 on beats 2-4,
    # each hit a step higher; GO! lands on bar 1, two more hits carry the flurry of cuts.
    for i, m in enumerate([79, 83, 86, 91, 95]):
        mix.add('glock', glock(m, 0.22 + 0.05 * i), t_of(COLD, i * 0.35), pan=-0.5 + 0.25 * i)
    mix.add('fx', riser(2 * BAR, 0.75), t_of(COLD))
    pads(COLD, vel=0.55)
    pads(COLD + 1, vel=0.7)
    for k, e in enumerate((2, 4, 6)):
        stab(t_of(COLD, e), chord_at(COLD, e), 0.72 + 0.1 * k)
        mix.add('crash', crash(0.3 + 0.1 * k, 0.9), t_of(COLD, e))
        mix.add('hat', hat(0.6), t_of(COLD, e + 1))
    mix.add('fx', impact(0.9), t_of(COLD + 1))
    mix.add('crash', crash(1.0, 2.0), t_of(COLD + 1))
    stab(t_of(COLD + 1), 'C', 1.0)
    mix.add('clap', clap(0.8), t_of(COLD + 1, 2))
    for e in (4, 6):
        stab(t_of(COLD + 1, e), 'D', 0.85, low=False)
        mix.add('crash', crash(0.45, 0.8), t_of(COLD + 1, e))
    for i in range(4):  # a sixteenth-note snare pickup into the title
        mix.add('snare', snare(0.45 + 0.13 * i), t_of(COLD + 1, 6 + i * 0.5))
    reverse_crash(TITLE, 1.4, 0.7)

    # --- bars 2-3: title hit
    mix.add('fx', impact(1.0), t_of(TITLE))
    mix.add('crash', crash(1.1, 2.6), t_of(TITLE))
    mix.add('kick', kick(1.0), t_of(TITLE))
    for m in (55, 59, 62, 67, 71):
        mix.add('brass', brass(m, BEAT * 1.6, 0.95), t_of(TITLE))
    mix.add('bass', bass(43, BEAT * 1.8, 1.0), t_of(TITLE))
    pads(TITLE, vel=1.0)
    pads(TITLE + 1, vel=0.9)
    for bar in (TITLE, TITLE + 1):
        for i in range(6):
            pos = RNG.choice([1, 2, 3, 4, 5, 6, 7]) + RNG.uniform(-0.1, 0.1)
            mix.add('glock', glock(RNG.choice([79, 83, 86, 91, 88]), 0.4), t_of(bar, pos), pan=RNG.uniform(-0.7, 0.7))
        for pos in (0, 2, 4, 6):
            _, tri = CHORDS[chord_at(bar, pos)]
            mix.add('pluck', pluck(tri[0] + 12, 0.5, tau=0.25), t_of(bar, pos))
    mix.add('kick', kick(0.7), t_of(TITLE + 1))
    for k, m in enumerate((50, 47, 45, 43)):
        mix.add('tom', tom(m, 0.7), t_of(TITLE + 1, 6 + k * 0.5))

    # --- bars 4-15: groove (the guests, the select screen, the board)
    play_hook(GROOVE, HOOK_A, 'marimba', 0, 1.0)
    play_hook(GROOVE + 4, HOOK_A[4:], 'glock', 12, 0.35)
    play_hook(GROOVE + 8, HOOK_A[:4], 'marimba', 0, 1.0)
    play_hook(GROOVE + 8, HOOK_A[:4], 'glock', 12, 0.4)
    for bar in range(GROOVE, BUILD):
        bass_bar(bar, [(0, 0, 2), (2, 0, 1), (3, 5, 1), (4, 0, 2), (6, 8, 1), (7, 5, 1)])
        offbeat_pluck(bar, 0.4)
        drums_groove(bar, full=False, fill=(bar in (GROOVE + 3, GROOVE + 7, BUILD - 1)), tamb_on=bar >= GROOVE + 4)
        if bar >= GROOVE + 4:
            pads(bar, vel=0.6)

    # --- bars 16-17: build
    for bar in (BUILD, BUILD + 1):
        for e in range(8):
            mix.add('bass', bass(50 if bar == BUILD + 1 else 48, EIGHTH * 0.8, 0.9), t_of(bar, e))
        for b in range(4):
            mix.add('kick', kick(0.9), t_of(bar, b * 2))
        pads(bar, vel=0.8)
    for i in range(8):
        mix.add('snare', snare(0.3 + 0.03 * i), t_of(BUILD, i))
    for i in range(16):
        mix.add('snare', snare(0.5 + 0.03 * i), t_of(BUILD + 1, i / 2))
    for k, m in enumerate([67, 69, 71, 72, 74, 76, 78, 79, 81, 83, 84, 86, 88, 90, 91, 93]):
        mix.add('marimba', marimba(m, 0.7 + 0.02 * k), t_of(BUILD, k))
    mix.add('fx', riser(2 * BAR, 1.0), t_of(BUILD))
    reverse_crash(CHORUS, 1.2, 0.7)

    # --- bars 18-27: chorus (the minigame montage); the last two bars are fills for fast cuts
    def chorus(start, hook, fill_last=True):
        play_hook(start, hook, 'brass', 0, 1.0)
        play_hook(start, hook, 'marimba', 12, 0.55)
        for i, bar in enumerate(range(start, start + len(hook))):
            bass_bar(bar, [(e, 0 if e % 2 == 0 else 8, 1) for e in range(6)] + [(6, 5, 1), (7, 8, 1)])
            pads(bar, vel=1.0)
            drums_groove(bar, full=True, fill=fill_last and i == len(hook) - 1)
            if i % 2 == 0:
                mix.add('crash', crash(0.9), t_of(bar))
            for pos in (0, 3, 6):
                _, tri = CHORDS[chord_at(bar, pos)]
                mix.add('glock', glock(tri[-1] + 24, 0.22), t_of(bar, pos), pan=0.4)
    chorus(CHORUS, HOOK_C)
    chorus(CHORUS + 8, [HOOK_C[0], HOOK_C[6]])
    for bar in (CHORUS + 8, CHORUS + 9):  # a tom on every beat: one per rapid-fire cut
        for b in range(4):
            mix.add('tom', tom(55 - b * 2, 0.55), t_of(bar, b * 2))
    reverse_crash(FINISH, 1.0, 0.8)

    # --- bar 28: FINISH! One big hit, then the band stops (a heartbeat under the tails).
    mix.add('fx', impact(1.0), t_of(FINISH))
    mix.add('crash', crash(1.2, 3.0), t_of(FINISH))
    mix.add('kick', kick(1.0), t_of(FINISH))
    for m in (55, 59, 62, 67, 71, 74):
        mix.add('brass', brass(m, BEAT * 1.1, 1.0), t_of(FINISH))
    mix.add('bass', bass(43, BEAT * 1.6, 1.0), t_of(FINISH))
    for e in (4, 6):
        mix.add('tom', tom(40, 0.45), t_of(FINISH, e))

    # --- bars 29-30: the ceremony's drumroll, the lights racing; a riser into the winner
    pads(ROLL, vel=0.9)
    pads(ROLL + 1, vel=1.0)
    mix.add('bass', bass(40, BAR * 0.95, 0.7), t_of(ROLL))
    mix.add('bass', bass(48, BAR * 0.45, 0.8), t_of(ROLL + 1))
    mix.add('bass', bass(50, BAR * 0.45, 0.9), t_of(ROLL + 1, 4))
    for i in range(16):
        mix.add('snare', snare(0.18 + 0.02 * i), t_of(ROLL, i / 2))
    for i in range(32):
        mix.add('snare', snare(0.34 + 0.015 * i), t_of(ROLL + 1, i / 4))
    for b in range(8):
        mix.add('tom', tom(40 + (b // 4) * 2, 0.35 + 0.05 * b), t_of(ROLL + b // 4, (b % 4) * 2))
    mix.add('fx', riser(2 * BAR, 0.9), t_of(ROLL))
    reverse_crash(WINNER, 1.2, 0.8)

    # --- bar 31: the winner lands: cymbal, fanfare, the band back for one bar
    mix.add('fx', impact(0.9), t_of(WINNER))
    mix.add('crash', crash(1.1, 2.4), t_of(WINNER))
    for voice in FANFARE:
        for (pos, m, ln) in voice:
            mix.add('brass', brass(m, ln * EIGHTH * 0.9, 0.95), t_of(WINNER, pos))
    pads(WINNER, vel=1.0)
    bass_bar(WINNER, [(e, 0 if e % 2 == 0 else 8, 1) for e in range(8)])
    drums_groove(WINNER, full=True, fill=True)
    for i, m in enumerate((79, 83, 86, 91)):
        mix.add('glock', glock(m, 0.35), t_of(WINNER, 3 + i * 0.5), pan=-0.4 + 0.25 * i)

    # --- bars 32-36: end card, the final chord ringing out
    mix.add('fx', impact(1.0), t_of(END))
    mix.add('crash', crash(1.2, 3.4), t_of(END))
    mix.add('kick', kick(1.0), t_of(END))
    for m in (55, 59, 62, 67, 71, 74, 79):
        note = brass(m, BAR * 2.0, 0.9)
        mix.add('brass', note * np.exp(-np.arange(len(note)) / SR / 2.2), t_of(END))  # dies away under the pad
    for m in (55, 59, 62, 67):
        mix.add('pad', pad(m, BAR * 3.4, 1.2), t_of(END))
    mix.add('bass', bass(43, BAR * 2.0, 1.0), t_of(END))
    for i, m in enumerate((79, 83, 86, 91, 95)):
        mix.add('glock', glock(m, 0.5), t_of(END, 1 + i * 0.5), pan=-0.5 + 0.25 * i)
    # a soft twinkle as the end card's lines appear, and one last chime
    for i, m in enumerate((86, 91, 95, 98)):
        mix.add('glock', glock(m, 0.28), t_of(END + 1, 2 + i), pan=0.5 - 0.3 * i)
    for m in (79, 86, 91):
        mix.add('harp', pluck(m - 12, 0.5, tau=1.4, bright=1.3), t_of(END + 2, 4))
    if REPORT:
        print('groove levels:')
        mix.report(t_of(GROOVE), t_of(BUILD))
        print('chorus levels:')
        mix.report(t_of(CHORUS), t_of(FINISH))

    # section dynamics (dB by bar, linear in between): quiet open, full choruses, a dip for the roll
    points = [(0, -6.0), (0.9, -4.0), (1, -2.0), (2, -1.5), (4, -3.0), (16, -3.0), (18, 0.0), (27.9, 0.0), (28, 0.5), (28.5, -1.5),
              (29, -5.0), (30.9, -2.0), (31, 0.0), (32, 0.5), (34, 0.5), (36.5, -9.0), (N_BARS, -14.0)]

    def automation(n):
        tb = np.arange(n) / SR / BAR
        db = np.interp(tb, [p[0] for p in points], [p[1] for p in points])
        return 10 ** (db / 20)
    return mix.render(automation)


REPORT = '--report' in sys.argv


def write_wav(path: str, x: np.ndarray):
    from scipy.io import wavfile
    wavfile.write(path, SR, (np.clip(x.T, -1, 1) * 32767).astype(np.int16))


if __name__ == '__main__':
    out = next((a for a in sys.argv[1:] if not a.startswith('--')), 'trailer_music.wav')
    audio = build()
    write_wav(out, audio)
    print('wrote', out, f'{audio.shape[1] / SR:.1f}s', 'peak', float(np.max(np.abs(audio))))
