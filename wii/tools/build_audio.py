#!/usr/bin/env python3
"""Render the Wii edition's music loops and sound effects offline.

    python3 wii/tools/build_audio.py            (needs numpy + soundfile)
    python3 wii/tools/build_audio.py --music    (only the music)
    python3 wii/tools/build_audio.py --sfx      (only the sound effects)

The web game synthesises all of its audio at runtime with WebAudio (src/game/audio/music.ts and
src/game/audio/sfx.ts). The Wii plays files instead, so this is an offline port of those recipes:
the same seeded step sequencer (mulberry32; same tracks, seeds, melodies, instruments, envelopes,
drums and swing) and the same oscillator + filtered-noise sound effects. The WebAudio pieces they
rely on are reproduced in numpy: band-limited oscillators (normalised like the browser's built-in
waves), biquad filters (the spec's formulas, Q in dB for low/high-pass) and
setValueAtTime / exponentialRampToValueAtTime automation.

Writes
  wii/data/music/<name>.ogg   44.1 kHz mono Ogg Vorbis. A whole number of the track's 8-bar loop
                              (~45-75 s); note tails that run past the end are folded back onto the
                              start, so Mix_PlayMusic(music, -1) loops seamlessly.
  wii/data/sfx/<name>.wav     48 kHz mono 16-bit PCM, silence trimmed. The list is every name passed
                              to app.audio.sfx(...) in wii/src (scanned at run time), each mapped onto
                              the closest web recipe (SFX_MAP / aliases below).
"""
from __future__ import annotations

import argparse
import math
import os
import re
import sys
import zlib

import numpy as np
import soundfile as sf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WII = os.path.join(ROOT, 'wii')
SRC = os.path.join(WII, 'src')
MUSIC_DIR = os.path.join(WII, 'data', 'music')
SFX_DIR = os.path.join(WII, 'data', 'sfx')

MUSIC_SR = 44100
SFX_SR = 48000
MUSIC_PEAK_DB = -3.0          # each loop is normalised to this peak
LOOP_SECONDS = (45.0, 75.0)   # loop length window; the cycle count closest to 60 s inside it wins
VORBIS_QUALITY = 0.4          # libvorbis quality (-q 4)

# Wii file name -> web MusicKey.
MUSIC_FILES = [
    ('title', 'menu'),
    ('board', 'board'),
    ('final', 'boardFinal'),
    ('minigame', 'minigame'),
    ('results', 'results'),
]

# SFX level: one gain for every recipe, so the web's relative sfx levels (and the per-call volumes the
# C++ mirrors from it) are kept. 2.0 puts the loudest effects (dice, crack) near -3 dBFS, like the music
# peaks. That is ~3 dB under the web's nominal sfx:music balance (sfxVolume 0.8 vs musicVolume
# 0.6 * 0.55, against Mix_VolumeMusic 60% here), which leaves headroom: SDL_mixer just sums and
# clips, while the web runs everything through a compressor.
SFX_GAIN = 2.0
SFX_PEAK_LIMIT = 0.95         # safety: a file louder than this is scaled down (and reported)
SFX_TRIM_DB = -66.0           # trailing/leading samples below this are trimmed


# =================================================================================================
# WebAudio primitives
# =================================================================================================

def mtof(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69) / 12)


class Random:
    """mulberry32, bit-exact with src/game/util/Random.ts."""
    M = 0xFFFFFFFF

    def __init__(self, seed: int):
        self.s = seed & self.M

    def next(self) -> float:
        M = self.M
        self.s = (self.s + 0x6D2B79F5) & M
        t = self.s
        t = ((t ^ (t >> 15)) * (t | 1)) & M
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & M)) & M)) & M
        return ((t ^ (t >> 14)) & M) / 4294967296.0

    def chance(self, p: float) -> bool:
        return self.next() < p

    def pick(self, items):
        return items[int(math.floor(self.next() * len(items)))]


def automation(events, times: np.ndarray, default: float = 1.0) -> np.ndarray:
    """AudioParam timeline with setValueAtTime ('set') and exponentialRampToValueAtTime ('exp').

    events: (kind, time, value) in insertion order. Events are applied sorted by time (ties keep
    insertion order); a ramp runs from the previous event's time and value to its own.
    """
    order = sorted(range(len(events)), key=lambda i: (events[i][1], i))
    out = np.full(times.shape, float(default))
    prev_t, prev_v = -1e9, float(default)
    for i in order:
        kind, et, ev = events[i]
        seg = (times >= prev_t) & (times < et)
        if kind == 'exp' and et > prev_t and prev_v > 0 and ev > 0:
            out[seg] = prev_v * (ev / prev_v) ** ((times[seg] - prev_t) / (et - prev_t))
        else:
            out[seg] = prev_v
        prev_t, prev_v = et, float(ev)
    out[times >= prev_t] = prev_v
    return out


# --- Oscillators --------------------------------------------------------------------------------

def partials(kind: str, count: int) -> np.ndarray:
    """Fourier sine coefficients b_1..b_count of the built-in OscillatorNode waves."""
    n = np.arange(1, count + 1, dtype=float)
    b = np.zeros(count)
    if kind == 'sine':
        b[0] = 1.0
    elif kind == 'square':
        b = np.where(n % 2 == 1, 4.0 / (n * np.pi), 0.0)
    elif kind == 'sawtooth':
        b = 2.0 / (n * np.pi) * np.where(n % 2 == 1, 1.0, -1.0)
    elif kind == 'triangle':
        sign = np.where(((n - 1) // 2) % 2 == 0, 1.0, -1.0)
        b = np.where(n % 2 == 1, 8.0 / (np.pi * np.pi * n * n) * sign, 0.0)
    else:
        raise ValueError(kind)
    return b


TABLE_SIZE = 4096
_NORM: dict[str, float] = {}


def wave_norm(kind: str) -> float:
    """Browsers normalise each built-in wave by the peak of its full-band table (Gibbs overshoot)."""
    if kind not in _NORM:
        b = partials(kind, TABLE_SIZE // 2 - 1)
        spec = np.zeros(TABLE_SIZE // 2 + 1, dtype=complex)
        spec[1:len(b) + 1] = -1j * b * (TABLE_SIZE / 2)
        _NORM[kind] = 1.0 / np.max(np.abs(np.fft.irfft(spec, TABLE_SIZE)))
    return _NORM[kind]


def biquad_coeffs(kind: str, f0, q: float, sr: int):
    """WebAudio BiquadFilterNode coefficients (normalised by a0). f0 may be an array."""
    f0 = np.minimum(np.asarray(f0, dtype=float), sr / 2)
    w0 = 2 * np.pi * f0 / sr
    cw, sw = np.cos(w0), np.sin(w0)
    if kind in ('lowpass', 'highpass'):
        alpha = sw / (2 * 10 ** (q / 20))  # Q in dB
    else:
        alpha = sw / (2 * q)
    if kind == 'lowpass':
        b0 = (1 - cw) / 2
        b1 = 1 - cw
        b2 = b0
    elif kind == 'highpass':
        b0 = (1 + cw) / 2
        b1 = -(1 + cw)
        b2 = b0
    elif kind == 'bandpass':
        b0 = alpha
        b1 = 0 * cw
        b2 = -alpha
    else:
        raise ValueError(kind)
    a0 = 1 + alpha
    return b0 / a0, b1 / a0, b2 / a0, (-2 * cw) / a0, (1 - alpha) / a0


def biquad_response(c, w: np.ndarray) -> np.ndarray:
    b0, b1, b2, a1, a2 = (float(k) for k in c)
    z1, z2 = np.exp(-1j * w), np.exp(-2j * w)
    return (b0 + b1 * z1 + b2 * z2) / (1 + a1 * z1 + a2 * z2)


def biquad_run(x: np.ndarray, c) -> np.ndarray:
    """Direct-form biquad; coefficients may be scalars or per-sample arrays."""
    xs = x.tolist()
    y = [0.0] * len(xs)
    x1 = x2 = y1 = y2 = 0.0
    if all(np.ndim(k) == 0 for k in c):
        b0, b1, b2, a1, a2 = (float(k) for k in c)
        for i, xi in enumerate(xs):
            yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2, x1, y2, y1 = x1, xi, y1, yi
            y[i] = yi
    else:
        b0, b1, b2, a1, a2 = (np.broadcast_to(np.asarray(k, dtype=float), x.shape).tolist() for k in c)
        for i, xi in enumerate(xs):
            yi = b0[i] * xi + b1[i] * x1 + b2[i] * x2 - a1[i] * y1 - a2[i] * y2
            x2, x1, y2, y1 = x1, xi, y1, yi
            y[i] = yi
    return np.asarray(y)


_TABLES: dict = {}


def wavetable(kind: str, f: float, sr: int, lowpass: float | None = None) -> np.ndarray:
    """One band-limited period (TABLE_SIZE + 1 guard point) for a fixed-pitch note.

    With a lowpass the filter's steady-state response is applied to every partial, which is what a
    BiquadFilterNode does to a stationary oscillator (its onset transient sits under the attack).
    """
    key = (kind, round(f, 6), sr, lowpass)
    tab = _TABLES.get(key)
    if tab is None:
        count = max(1, min(TABLE_SIZE // 2 - 1, int(math.ceil(sr / 2 / f)) - 1))
        b = partials(kind, count) * wave_norm(kind)
        spec = np.zeros(TABLE_SIZE // 2 + 1, dtype=complex)
        coef = -1j * b * (TABLE_SIZE / 2)
        if lowpass:
            k = np.arange(1, count + 1)
            coef = coef * biquad_response(biquad_coeffs('lowpass', lowpass, 1.0, sr), 2 * np.pi * k * f / sr)
        spec[1:count + 1] = coef
        tab = np.fft.irfft(spec, TABLE_SIZE)
        tab = np.append(tab, tab[0])
        _TABLES[key] = tab
    return tab


def osc_fixed(kind: str, f: float, phase: np.ndarray, sr: int, lowpass: float | None = None) -> np.ndarray:
    tab = wavetable(kind, f, sr, lowpass)
    x = (phase % 1.0) * TABLE_SIZE
    i = np.minimum(x.astype(np.int64), TABLE_SIZE - 1)  # (tiny negative phase % 1.0 can give 1.0)
    frac = x - i
    return tab[i] * (1 - frac) + tab[i + 1] * frac


def osc_swept(kind: str, phase: np.ndarray, freq: np.ndarray, sr: int) -> np.ndarray:
    """Additive synthesis for a moving pitch; partials fade out as they approach Nyquist."""
    if kind == 'sine':
        return np.sin(2 * np.pi * phase)
    nyq = sr / 2
    count = max(1, min(4000, int(math.ceil(nyq / max(1.0, float(np.min(freq)))))))
    b = partials(kind, count) * wave_norm(kind)
    out = np.zeros_like(phase)
    for k in range(1, count + 1):
        if b[k - 1] == 0.0:
            continue
        w = np.clip((nyq - k * freq) / (0.08 * nyq), 0.0, 1.0)
        if not w.any():
            continue
        out += b[k - 1] * w * np.sin(2 * np.pi * k * phase)
    return out


class Bus:
    """A mono mix buffer that grows as voices are added."""

    def __init__(self, sr: int, seconds: float):
        self.sr = sr
        self.buf = np.zeros(int(seconds * sr))
        self.end = 0

    def span(self, t0: float, t1: float):
        n0 = int(math.ceil(t0 * self.sr - 1e-9))
        n1 = max(n0, int(math.ceil(t1 * self.sr - 1e-9)))
        return n0, np.arange(n0, n1) / self.sr

    def add(self, n0: int, x: np.ndarray) -> None:
        n1 = n0 + len(x)
        if n1 > len(self.buf):
            self.buf = np.concatenate([self.buf, np.zeros(n1 - len(self.buf) + self.sr)])
        self.buf[n0:n1] += x
        self.end = max(self.end, n1)


def white_noise(rng: np.random.Generator, sr: int) -> np.ndarray:
    """The AudioManager's 2 s noise buffer (Math.random() * 2 - 1)."""
    return rng.random(2 * sr) * 2 - 1


# =================================================================================================
# Music (port of src/game/audio/music.ts)
# =================================================================================================

def S(s: str) -> list[int]:
    return [0 if c == '.' else int(c) for c in s]


TRACKS = {
    'menu': dict(
        bpm=100, key=65, progression=[(0, 'maj'), (9, 'min'), (5, 'maj'), (7, 'maj')],
        lead=('triangle', 0.09, 0.32), counter=None,
        bass=('triangle', 0.12, S('1.......5.......')), pad=0.025,
        kick=S('3.......2.......'), snare=S('................'), hat=S('..1...1...1...1.'),
        rhythms=[S('1.1.1...1.1.1...'), S('1...1.1.1...1...')], seed=11, swing=0.08),
    'board': dict(
        bpm=112, key=67, progression=[(0, 'maj'), (9, 'min'), (5, 'maj'), (7, 'maj')],
        lead=('sine', 0.11, 0.18), counter=('triangle', 0.035),
        bass=('triangle', 0.13, S('1...5...1...5.8.')), pad=0.018,
        kick=S('3.......3.......'), snare=S('....2.......2...'), hat=S('1.1.1.1.1.1.1.1.'),
        rhythms=[S('1.1.1.1.1...1.1.'), S('1..1..1.1.1.1...')], seed=23, swing=0.12),
    'boardFinal': dict(
        bpm=124, key=69, progression=[(0, 'maj'), (9, 'min'), (5, 'maj'), (7, 'maj')],
        lead=('square', 0.055, 0.16), counter=('triangle', 0.05),
        bass=('sawtooth', 0.06, S('1.1.5.5.1.1.5.8.')), pad=0.022,
        kick=S('3...3...3...3...'), snare=S('....3.......3..2'), hat=S('1111111111111111'),
        rhythms=[S('1.1.1.1.1.1.1.1.'), S('1.11.1.11.1.1...')], seed=23, swing=0.04),
    'minigame': dict(
        bpm=140, key=62, progression=[(0, 'min'), (10, 'maj'), (8, 'maj'), (7, 'maj')],
        lead=('square', 0.05, 0.12), counter=('triangle', 0.045),
        bass=('sawtooth', 0.06, S('1.1.1.1.1.1.1.8.')), pad=0.0,
        kick=S('3...3...3...3...'), snare=S('....3.......3...'), hat=S('.1.1.1.1.1.1.1.1'),
        rhythms=[S('1.1.11.11.1.1...'), S('1.1.1.1.11.11.1.')], seed=37, swing=0.0),
    'results': dict(
        bpm=96, key=72, progression=[(0, 'maj'), (5, 'maj'), (7, 'maj'), (0, 'maj')],
        lead=('triangle', 0.1, 0.3), counter=None,
        bass=('triangle', 0.12, S('1...5...8...5...')), pad=0.03,
        kick=S('3.......3.......'), snare=S('....2.......2...'), hat=S('1...1...1...1...'),
        rhythms=[S('1...1.1.1.......'), S('1.1.1...1...1...')], seed=41, swing=0.06),
    'final': dict(
        bpm=120, key=70, progression=[(0, 'maj'), (9, 'min'), (3, 'maj'), (5, 'maj')],
        lead=('square', 0.055, 0.2), counter=('triangle', 0.05),
        bass=('triangle', 0.14, S('1.5.8.5.1.5.8.5.')), pad=0.03,
        kick=S('3...3...3...3...'), snare=S('....3.......3...'), hat=S('1.1.1.1.1.1.1.1.'),
        rhythms=[S('1.1.1.1.1.1.1...'), S('1...1.1.1.1.1.1.')], seed=53, swing=0.05),
}

MAJOR = [0, 2, 4, 5, 7, 9, 11]


def compose(d: dict) -> list[list[tuple[int, int, int]]]:
    """The seeded melody: per bar a list of (step, midi, len). Mirrors compose() in music.ts."""
    rng = Random(d['seed'])
    key, prog = d['key'], d['progression']
    bars = len(prog) * 2

    def scale(deg: int) -> int:
        return key + (deg // 7) * 12 + MAJOR[deg % 7]

    out = []
    deg = 2
    for bar in range(bars):
        root, q = prog[bar % len(prog)]
        chord = [x % 12 for x in (root, root + (4 if q == 'maj' else 3), root + 7)]
        rhythm = d['rhythms'][(bar >> 1) % len(d['rhythms'])]
        onsets = [i for i, v in enumerate(rhythm) if v]
        notes = []
        for k, step in enumerate(onsets):
            if step % 4 == 0:
                best, best_d = deg, 99
                for dd in range(deg - 3, deg + 4):
                    if (scale(dd) - key) % 12 in chord and abs(dd - deg) < best_d:
                        best_d, best = abs(dd - deg), dd
                deg = best + ((2 if rng.chance(0.5) else -2) if rng.chance(0.25) else 0)
            else:
                deg += rng.pick([-1, -1, 1, 1, 2, -2, 0])
            deg = max(-2, min(9, deg))
            if bar % 4 == 3 and k == len(onsets) - 1:
                deg = 7 * int(math.floor(deg / 7 + 0.5))
            nxt = onsets[k + 1] if k + 1 < len(onsets) else 16
            notes.append((step, scale(deg), max(1, min(4, nxt - step))))
        out.append(notes)
    return out


def loop_cycles(d: dict) -> int:
    cycle = len(d['progression']) * 2 * 16 * 60.0 / d['bpm'] / 4
    lo, hi = LOOP_SECONDS
    options = [n for n in range(1, 20) if lo <= n * cycle <= hi] or [max(1, round(60.0 / cycle))]
    return min(options, key=lambda n: abs(n * cycle - 60.0))


def render_track(name: str, sr: int = MUSIC_SR, cycles: int | None = None, fold: bool = True):
    """Render `cycles` passes of the track's 8-bar loop. Returns (samples, seconds, cycles)."""
    d = TRACKS[name]
    notes = compose(d)
    cycles = cycles or loop_cycles(d)
    total_steps = cycles * len(notes) * 16
    n_loop = int(round(total_steps * 60.0 / d['bpm'] / 4 * sr))
    step_dur = n_loop / sr / total_steps  # nudged (< 1 sample per loop) so the loop is whole samples
    rng = np.random.default_rng(zlib.crc32(name.encode()))
    noise = white_noise(rng, sr)
    # Drum noise through the snare / hat filters (steady state: run over two copies, keep the second).
    snare_noise = biquad_run(np.tile(noise, 2), biquad_coeffs('bandpass', 1800, 1.0, sr))[len(noise):]
    hat_noise = biquad_run(np.tile(noise, 2), biquad_coeffs('highpass', 7000, 1.0, sr))[len(noise):]
    bus = Bus(sr, n_loop / sr + 5)

    def voice(t, f, dur, kind, vol, attack, release, lowpass=None):
        n0, ts = bus.span(t, t + dur + release + 0.05)
        wave = osc_fixed(kind, f, f * (ts - t), sr, lowpass)
        env = automation([('set', t, 1e-4), ('exp', t + attack, vol),
                          ('set', t + max(attack, dur - release), vol), ('exp', t + dur + release, 1e-4)], ts)
        bus.add(n0, wave * env)

    def kick(t, v):
        n0, ts = bus.span(t, t + 0.2)
        f = automation([('set', t, 140.0), ('exp', t + 0.12, 45.0)], ts)
        phase = f[0] * (ts[0] - t) + np.concatenate([[0.0], np.cumsum(f[:-1])]) / sr
        g = automation([('set', t, 0.28 * v), ('exp', t + 0.16, 1e-4)], ts)
        bus.add(n0, np.sin(2 * np.pi * phase) * g)

    def noise_hit(t, dur, vol, src):
        n0, ts = bus.span(t, t + dur + 0.02)
        off = int(rng.random() * sr)  # src.start(t, Math.random())
        g = automation([('set', t, vol), ('exp', t + dur, 1e-4)], ts)
        bus.add(n0, src[off:off + len(ts)] * g)

    for i in range(total_steps):
        s = i % 16
        bar = (i // 16) % len(notes)
        t = i * step_dur + (d['swing'] * step_dur if s % 2 == 1 else 0.0)
        root, q = d['progression'][bar % len(d['progression'])]
        third = 4 if q == 'maj' else 3
        bass_root = d['key'] - 24 + root
        if d['kick'][s]:
            kick(t, d['kick'][s] / 3)
        if d['snare'][s]:
            noise_hit(t, 0.14, 0.12 * d['snare'][s] / 3, snare_noise)
        if d['hat'][s]:
            noise_hit(t, 0.04, 0.045 * d['hat'][s] / 3, hat_noise)
        btype, bvol, bpat = d['bass']
        bp = bpat[s]
        if bp:
            m = bass_root + (7 if bp == 5 else 12 if bp == 8 else 0)
            voice(t, mtof(m), step_dur * 1.8, btype, bvol, 0.01, 0.12)
        if s == 0 and d['pad'] > 0:
            for iv in (0, third, 7):
                voice(t, mtof(d['key'] - 12 + root + iv), step_dur * 15, 'sawtooth', d['pad'], 0.25, 0.4, 900.0)
        ltype, lvol, ldecay = d['lead']
        for step, midi, ln in notes[bar]:
            if step == s:
                voice(t, mtof(midi), max(step_dur * ln * 0.9, ldecay), ltype, lvol, 0.008, ldecay)
                if d['counter'] and ln >= 2:
                    ctype, cvol = d['counter']
                    voice(t, mtof(midi - 12 + third), step_dur * ln * 0.8, ctype, cvol, 0.02, 0.1)

    buf = bus.buf[:max(bus.end, n_loop)]
    out = buf[:n_loop].copy()
    if fold:
        tail = buf[n_loop:]
        assert len(tail) < n_loop
        out[:len(tail)] += tail  # the next pass starts while these notes ring out
    return out, n_loop / sr, cycles


# =================================================================================================
# Sound effects (port of src/game/audio/sfx.ts)
# =================================================================================================

class Voice:
    def __init__(self, sr: int, seed: int):
        self.sr = sr
        self.rng = np.random.default_rng(seed)
        self.noise = white_noise(self.rng, sr)
        self.bus = Bus(sr, 3.0)
        self.gain = 1.0  # the per-recipe 'out' gain (AudioManager play volume)


def _env(t, vol, attack, dur, release):
    v = max(0.0002, vol)
    return [('set', t, 1e-4), ('exp', t + max(0.002, attack), v),
            ('set', t + max(attack, dur - release), v), ('exp', t + dur, 1e-4)]


def tone(v: Voice, t: float, freq: float, dur: float, type: str = 'sine', to: float | None = None,
         vol: float = 0.2, attack: float = 0.005, release: float | None = None, detune: float = 0.0,
         vibrato: float = 0.0) -> None:
    sr = v.sr
    n0, ts = v.bus.span(t, t + dur + 0.05)
    ev = [('set', t, freq)]
    if to:
        ev.append(('exp', t + dur, max(20.0, to)))
    f = automation(ev, ts)
    if detune:
        f = f * 2 ** (detune / 1200)
    if vibrato:
        f = f + vibrato * np.sin(2 * np.pi * 7 * (ts - t))
    phase = f[0] * (ts[0] - t) + np.concatenate([[0.0], np.cumsum(f[:-1])]) / sr
    if not to and not vibrato:
        wave = osc_fixed(type, float(f[0]), phase, sr)
    else:
        wave = osc_swept(type, phase, f, sr)
    rel = min(0.08, dur * 0.5) if release is None else release
    g = automation(_env(t, vol, attack, dur, rel), ts)
    v.bus.add(n0, wave * g * v.gain)


def noise(v: Voice, t: float, dur: float, vol: float = 0.2, filter: str = 'lowpass', freq: float = 1200.0,
          to: float | None = None, q: float = 0.8, attack: float = 0.004) -> None:
    sr = v.sr
    n0, ts = v.bus.span(t, t + dur + 0.05)
    off = int(v.rng.random() * 1.5 * sr)  # src.start(t, Math.random() * 1.5), looping
    src = v.noise[(off + np.arange(len(ts))) % len(v.noise)]
    if to:
        fc = automation([('set', t, freq), ('exp', t + dur, max(30.0, to))], ts)
    else:
        fc = freq
    y = biquad_run(src, biquad_coeffs(filter, fc, q, sr))
    g = automation(_env(t, vol, attack, dur, min(0.1, dur * 0.6)), ts)
    v.bus.add(n0, y * g * v.gain)


def N(m: float) -> float:
    return mtof(m)


def arp(v: Voice, t: float, notes, step: float, type: str = 'triangle', vol: float = 0.16, dur: float | None = None) -> None:
    for i, m in enumerate(notes):
        tone(v, t + i * step, type=type, freq=N(m), dur=dur if dur is not None else step * 1.8, vol=vol)


def _fanfare(v, t, p):
    for m, dt, d in [(72, 0, 0.14), (72, 0.15, 0.1), (72, 0.26, 0.1), (77, 0.38, 0.5)]:
        tone(v, t + dt, type='square', freq=N(m), dur=d, vol=0.06)
        tone(v, t + dt, type='sawtooth', freq=N(m - 12), dur=d, vol=0.04)
    for m in (77, 81, 84):
        tone(v, t + 0.38, type='triangle', freq=N(m), dur=0.8, vol=0.07)


def _defeat(v, t, p):
    for i, m in enumerate([67, 66, 65, 64]):
        tone(v, t + i * 0.22, type='triangle', freq=N(m), to=N(62) if i == 3 else None,
             dur=0.6 if i == 3 else 0.22, vol=0.12, vibrato=6 if i == 3 else 0)


def _crowd_cheer(v, t, p):
    for i, f in enumerate([520, 900, 1400, 2100, 3000]):
        noise(v, t + i * 0.03, dur=1.7 - i * 0.1, vol=0.065, filter='bandpass', freq=f, to=f * 0.92, q=1.4, attack=0.15)
    for i in range(16):
        noise(v, t + 0.08 + i * 0.085 + v.rng.random() * 0.03, dur=0.03, vol=0.055, filter='bandpass',
              freq=2000 + v.rng.random() * 1400, q=1.2)
    tone(v, t + 0.2, freq=2000, to=2800, dur=0.35, vol=0.035, vibrato=25)
    tone(v, t + 0.6, freq=2400, to=1900, dur=0.3, vol=0.03)


def _alarm(v, t, p):
    for i in range(3):
        tone(v, t + i * 0.2, type='square', freq=880, dur=0.09, vol=0.05)
        tone(v, t + i * 0.2 + 0.1, type='square', freq=660, dur=0.09, vol=0.05)
    tone(v, t, type='sawtooth', freq=220, to=330, dur=0.6, vol=0.028)


def _final_call(v, t, p):
    for m, dt in [(74, 0), (77, 0.08), (81, 0.16)]:
        tone(v, t + dt, type='square', freq=N(m), dur=0.09, vol=0.06)
        tone(v, t + dt, type='sawtooth', freq=N(m - 12), dur=0.09, vol=0.035)
    for m in (81, 85, 88):
        tone(v, t + 0.26, type='sawtooth', freq=N(m), dur=0.5, vol=0.034, attack=0.02, vibrato=5)
    noise(v, t + 0.26, dur=0.35, vol=0.045, filter='highpass', freq=5000)


def _multi(*fns):
    def run(v, t, p):
        for fn in fns:
            fn(v, t, p)
    return run


L = lambda fn: fn  # noqa: E731  (readability: recipes below are one-liners like the TS table)

SFX = {
    'menuMove': L(lambda v, t, p: tone(v, t, type='triangle', freq=820, to=980, dur=0.05, vol=0.12)),
    'confirm': _multi(
        lambda v, t, p: tone(v, t, freq=N(76), dur=0.08, vol=0.18),
        lambda v, t, p: tone(v, t + 0.06, freq=N(83), dur=0.14, vol=0.18),
        lambda v, t, p: tone(v, t + 0.06, type='triangle', freq=N(95), dur=0.1, vol=0.05)),
    'cancel': L(lambda v, t, p: tone(v, t, type='triangle', freq=540, to=300, dur=0.14, vol=0.16)),
    'error': _multi(
        lambda v, t, p: tone(v, t, type='square', freq=180, dur=0.1, vol=0.08),
        lambda v, t, p: tone(v, t + 0.11, type='square', freq=150, dur=0.14, vol=0.08)),
    'join': L(lambda v, t, p: arp(v, t, [m + round((p - 1) * 6) for m in (67, 71, 74, 79)], 0.05, type='triangle', vol=0.15)),
    'leave': L(lambda v, t, p: arp(v, t, [74, 69, 62], 0.06, type='triangle', vol=0.12)),
    'ready': _multi(
        lambda v, t, p: arp(v, t, [72, 76, 79], 0.04, type='sine', vol=0.14, dur=0.3),
        lambda v, t, p: tone(v, t + 0.12, type='triangle', freq=N(84), dur=0.35, vol=0.1)),
    'pause': _multi(
        lambda v, t, p: tone(v, t, freq=N(72), dur=0.12, vol=0.14),
        lambda v, t, p: tone(v, t + 0.08, freq=N(67), dur=0.16, vol=0.14)),
    'dialTick': L(lambda v, t, p: tone(v, t, type='square', freq=1150 * p, dur=0.018, vol=0.05)),
    'dialStop': _multi(
        lambda v, t, p: tone(v, t, freq=N(84), dur=0.6, vol=0.18, release=0.4),
        lambda v, t, p: tone(v, t, freq=N(91), dur=0.45, vol=0.08, release=0.3),
        lambda v, t, p: noise(v, t, dur=0.05, vol=0.08, filter='highpass', freq=4000)),
    'step': _multi(
        lambda v, t, p: tone(v, t, freq=190 * p, to=110 * p, dur=0.07, vol=0.16),
        lambda v, t, p: noise(v, t, dur=0.03, vol=0.05, filter='bandpass', freq=900)),
    'chipGain': _multi(
        lambda v, t, p: tone(v, t, freq=N(88) * p, dur=0.07, vol=0.13),
        lambda v, t, p: tone(v, t + 0.055, freq=N(93) * p, dur=0.16, vol=0.13),
        lambda v, t, p: tone(v, t + 0.055, type='triangle', freq=N(100) * p, dur=0.08, vol=0.04)),
    'chipLose': _multi(
        lambda v, t, p: tone(v, t, type='square', freq=760, to=330, dur=0.18, vol=0.07),
        lambda v, t, p: tone(v, t + 0.1, type='triangle', freq=520, to=220, dur=0.2, vol=0.1)),
    'itemGet': L(lambda v, t, p: arp(v, t, [72, 76, 79, 84, 88], 0.045, type='triangle', vol=0.14)),
    'itemUse': _multi(
        lambda v, t, p: tone(v, t, freq=500, to=1200, dur=0.18, vol=0.12),
        lambda v, t, p: noise(v, t + 0.05, dur=0.2, vol=0.05, filter='highpass', freq=3000)),
    'jump': L(lambda v, t, p: tone(v, t, freq=300 * p, to=720 * p, dur=0.13, vol=0.14)),
    'land': _multi(
        lambda v, t, p: noise(v, t, dur=0.08, vol=0.14, filter='lowpass', freq=500),
        lambda v, t, p: tone(v, t, freq=130, to=70, dur=0.1, vol=0.14)),
    'hit': _multi(
        lambda v, t, p: noise(v, t, dur=0.14, vol=0.18, filter='bandpass', freq=1300, q=1.2),
        lambda v, t, p: tone(v, t, type='square', freq=220, to=70, dur=0.16, vol=0.09)),
    'portal': _multi(
        lambda v, t, p: tone(v, t, freq=260, to=1040, dur=0.7, vol=0.12, vibrato=18),
        lambda v, t, p: tone(v, t + 0.1, type='triangle', freq=520, to=1560, dur=0.6, vol=0.06, vibrato=30),
        lambda v, t, p: noise(v, t, dur=0.7, vol=0.05, filter='bandpass', freq=800, to=4000, q=3)),
    'eventAlert': _multi(
        *[(lambda m: lambda v, t, p: tone(v, t, type='sawtooth', freq=N(m), dur=0.34, vol=0.05, attack=0.03))(m) for m in (69, 73, 76)],
        *[(lambda m: lambda v, t, p: tone(v, t + 0.2, type='sawtooth', freq=N(m), dur=0.45, vol=0.05, attack=0.03))(m) for m in (74, 78, 81)]),
    'victory': _multi(
        lambda v, t, p: arp(v, t, [72, 76, 79, 84], 0.11, type='square', vol=0.07, dur=0.2),
        *[(lambda m: lambda v, t, p: tone(v, t + 0.46, type='triangle', freq=N(m), dur=0.8, vol=0.08))(m) for m in (72, 76, 79, 84)]),
    'defeat': _defeat,
    'countdown': L(lambda v, t, p: tone(v, t, freq=880, dur=0.16, vol=0.17)),
    'go': _multi(
        lambda v, t, p: tone(v, t, type='square', freq=1320, dur=0.3, vol=0.07),
        *[(lambda m: lambda v, t, p: tone(v, t, type='triangle', freq=N(m + 12), dur=0.4, vol=0.07))(m) for m in (72, 76, 79)]),
    'finish': _multi(
        lambda v, t, p: noise(v, t, dur=0.5, vol=0.12, filter='highpass', freq=5000),
        lambda v, t, p: arp(v, t, [79, 76, 72], 0.07, type='square', vol=0.06, dur=0.14)),
    'drumroll': L(lambda v, t, p: [noise(v, t + i * 0.045, dur=0.04, vol=0.04 + i * 0.004, filter='bandpass', freq=1800, q=0.9) for i in range(24)]),
    'cymbal': L(lambda v, t, p: noise(v, t, dur=1.2, vol=0.14, filter='highpass', freq=6000)),
    'relic': _multi(
        lambda v, t, p: [tone(v, t + i * 0.07, freq=N(84 + [0, 4, 7, 11, 14, 19][i]), dur=0.9 - i * 0.08, vol=0.09) for i in range(6)],
        lambda v, t, p: tone(v, t, type='triangle', freq=330, to=990, dur=0.6, vol=0.06, vibrato=12)),
    'whoosh': L(lambda v, t, p: noise(v, t, dur=0.28, vol=0.13, filter='bandpass', freq=400, to=2400, q=1.4, attack=0.08)),
    'pop': L(lambda v, t, p: tone(v, t, freq=620 * p, to=1300 * p, dur=0.05, vol=0.14)),
    'splash': _multi(
        lambda v, t, p: noise(v, t, dur=0.35, vol=0.18, filter='lowpass', freq=3500, to=400),
        lambda v, t, p: tone(v, t, freq=500, to=150, dur=0.18, vol=0.06)),
    'explosion': _multi(
        lambda v, t, p: noise(v, t, dur=0.8, vol=0.3, filter='lowpass', freq=900, to=90),
        lambda v, t, p: tone(v, t, freq=90, to=40, dur=0.5, vol=0.25)),
    'bounce': L(lambda v, t, p: tone(v, t, freq=200, to=620, dur=0.22, vol=0.14, vibrato=25)),
    'shop': _multi(
        lambda v, t, p: tone(v, t, freq=N(88), dur=0.3, vol=0.12),
        lambda v, t, p: tone(v, t + 0.07, freq=N(92), dur=0.35, vol=0.12),
        lambda v, t, p: noise(v, t, dur=0.06, vol=0.06, filter='highpass', freq=5000)),
    'trap': _multi(
        lambda v, t, p: noise(v, t, dur=0.09, vol=0.2, filter='bandpass', freq=2200, q=2),
        lambda v, t, p: tone(v, t, type='square', freq=160, to=90, dur=0.14, vol=0.1)),
    'shield': _multi(
        lambda v, t, p: tone(v, t, freq=900, to=1500, dur=0.4, vol=0.1, vibrato=40),
        lambda v, t, p: tone(v, t + 0.05, type='triangle', freq=1800, dur=0.3, vol=0.04)),
    'crack': _multi(
        lambda v, t, p: noise(v, t, dur=0.12, vol=0.2, filter='highpass', freq=1500),
        lambda v, t, p: noise(v, t + 0.1, dur=0.3, vol=0.12, filter='lowpass', freq=800, to=200)),
    'rumble': L(lambda v, t, p: noise(v, t, dur=0.9, vol=0.16, filter='lowpass', freq=220, to=120)),
    'fanfare': _fanfare,
    'cheer': _multi(
        lambda v, t, p: [noise(v, t + i * 0.09, dur=0.35, vol=0.05, filter='bandpass', freq=1400 + i * 300, q=2) for i in range(5)],
        lambda v, t, p: arp(v, t, [79, 84, 88], 0.08, type='triangle', vol=0.08)),
    'countHit': _multi(
        lambda v, t, p: tone(v, t, freq=150 * p, to=58 * p, dur=0.34, vol=0.34, attack=0.002, release=0.24),
        lambda v, t, p: tone(v, t, type='triangle', freq=310 * p, to=120 * p, dur=0.1, vol=0.12, attack=0.001),
        lambda v, t, p: noise(v, t, dur=0.08, vol=0.15, filter='bandpass', freq=1900, q=0.9),
        lambda v, t, p: noise(v, t, dur=0.26, vol=0.09, filter='lowpass', freq=420, to=110)),
    'crowdRoar': _multi(
        lambda v, t, p: [noise(v, t + i * 0.025, dur=1.05 - i * 0.06, vol=0.07, filter='bandpass', freq=f, to=f * 1.12, q=1.6, attack=0.12)
                         for i, f in enumerate([480, 820, 1250, 1900, 2800])],
        lambda v, t, p: noise(v, t, dur=0.9, vol=0.05, filter='lowpass', freq=700, attack=0.1),
        lambda v, t, p: tone(v, t + 0.12, freq=1900, to=2600, dur=0.32, vol=0.035, vibrato=30),
        lambda v, t, p: tone(v, t + 0.3, freq=2300, to=1700, dur=0.28, vol=0.03)),
    'crowdCheer': _crowd_cheer,
    'finalCall': _final_call,
    'tick': _multi(
        lambda v, t, p: tone(v, t, freq=1250 * p, to=1080 * p, dur=0.05, vol=0.12, attack=0.001),
        lambda v, t, p: noise(v, t, dur=0.025, vol=0.05, filter='bandpass', freq=3200, q=2)),
    'stamp': _multi(
        lambda v, t, p: tone(v, t, freq=115, to=45, dur=0.28, vol=0.3, attack=0.001),
        lambda v, t, p: noise(v, t, dur=0.07, vol=0.2, filter='bandpass', freq=1100, q=0.8),
        lambda v, t, p: noise(v, t, dur=0.2, vol=0.08, filter='lowpass', freq=600, to=150)),
    'crown': _multi(
        lambda v, t, p: tone(v, t, type='triangle', freq=N(91), dur=0.12, vol=0.06),
        lambda v, t, p: tone(v, t + 0.07, type='triangle', freq=N(96), dur=0.22, vol=0.06),
        lambda v, t, p: noise(v, t, dur=0.22, vol=0.025, filter='highpass', freq=7000)),
    'streak': _multi(
        lambda v, t, p: [tone(v, t + i * 0.045, type='triangle', freq=N(m) * p, dur=0.16, vol=0.08) for i, m in enumerate([84, 88, 91, 96])],
        lambda v, t, p: tone(v, t + 0.18, freq=N(100) * p, dur=0.3, vol=0.05, vibrato=12)),
    'goldChip': _multi(
        lambda v, t, p: [tone(v, t + i * 0.04, freq=N(m), dur=0.2, vol=0.1) for i, m in enumerate([88, 92, 95, 100])],
        lambda v, t, p: tone(v, t + 0.16, type='triangle', freq=N(104), dur=0.35, vol=0.05, vibrato=10),
        lambda v, t, p: noise(v, t, dur=0.3, vol=0.035, filter='highpass', freq=6000)),
    'fuse': _multi(
        lambda v, t, p: noise(v, t, dur=0.7, vol=0.045, filter='highpass', freq=4500, attack=0.02),
        lambda v, t, p: noise(v, t, dur=0.7, vol=0.03, filter='bandpass', freq=2500, to=5200, q=3)),
    'warn': L(lambda v, t, p: tone(v, t, type='square', freq=1040 * p, dur=0.06, vol=0.045)),
    'alarm': _alarm,
    'sweep': L(lambda v, t, p: noise(v, t, dur=0.6, vol=0.08, filter='bandpass', freq=600, to=5200, q=2.2, attack=0.12)),
    'nearMiss': _multi(
        lambda v, t, p: noise(v, t, dur=0.18, vol=0.1, filter='bandpass', freq=900, to=3200, q=1.6, attack=0.03),
        lambda v, t, p: tone(v, t + 0.06, freq=N(93) * p, dur=0.22, vol=0.09),
        lambda v, t, p: tone(v, t + 0.06, type='triangle', freq=N(100) * p, dur=0.12, vol=0.03)),
}

# Wii sfx name -> web recipe, or a layered list of (recipe, volume, delay s, rate) for names the web
# build has no single recipe for. Web recipe names (any case, '_'/'-' ignored) also work directly.
SFX_MAP: dict[str, str | list] = {
    'move': 'menuMove',
    'confirm': 'confirm',
    'back': 'cancel',
    'cancel': 'cancel',
    'error': 'error',
    'tick': 'tick',
    'go': 'go',
    'finish': 'finish',
    'fanfare': 'fanfare',
    'coin': 'chipGain',
    'bad': 'chipLose',
    'step': 'step',
    'dice': 'dialStop',
    'land': 'land',
    'whoosh': 'whoosh',
    'item': 'itemGet',
    'event': 'eventAlert',
    'jump': 'jump',
    'bounce': 'bounce',
    'crack': 'crack',
    'hit': 'hit',
    'pop': 'pop',
    'cheer': 'cheer',
    'warn': 'warn',
    'alarm': 'alarm',
    # No web recipe of these names: layered the way the web minigames voice the same moments.
    'dash': [('whoosh', 0.75, 0.0, 1.0), ('bounce', 0.35, 0.0, 1.0)],   # RingRush's dash
    'bump': [('land', 0.8, 0.0, 1.0), ('hit', 0.4, 0.0, 1.0)],          # Slapshot / RooftopGlide knocks
    # Likely future names.
    'select': 'confirm', 'ok': 'confirm', 'accept': 'confirm', 'start': 'confirm',
    'cursor': 'menuMove', 'nav': 'menuMove', 'click': 'dialTick', 'roll': 'dialTick', 'spin': 'dialTick',
    'buzz': 'error', 'wrong': 'error', 'fail': 'chipLose', 'lose': 'defeat', 'win': 'victory',
    'coins': 'chipGain', 'gold': 'goldChip', 'star': 'relic', 'warp': 'portal', 'teleport': 'portal',
    'beep': 'countdown', 'count': 'countHit', 'boom': 'explosion', 'explode': 'explosion',
    'thud': 'land', 'throw': 'whoosh', 'swing': 'whoosh', 'swish': 'whoosh', 'slash': 'whoosh',
    'catch': 'pop', 'grab': 'pop', 'collect': 'chipGain', 'stomp': 'stamp', 'slam': 'stamp',
    'hurry': 'finalCall', 'crowd': 'crowdRoar', 'roar': 'crowdRoar', 'water': 'splash',
    'combo': 'streak', 'block': 'shield', 'snap': 'trap', 'break': 'crack', 'shake': 'rumble',
    'whistle': 'finish', 'buy': 'shop', 'shine': 'crown', 'leader': 'crown', 'fizz': 'fuse',
}
FALLBACK = 'pop'


def _norm_name(s: str) -> str:
    return re.sub(r'[_\-]', '', s).lower()


def resolve_sfx(name: str) -> tuple[list, bool]:
    """Layers [(recipe, volume, delay, rate)] for a Wii name, and whether it is a fallback guess."""
    spec = SFX_MAP.get(name)
    if spec is None:
        web = {_norm_name(k): k for k in SFX}
        spec = web.get(_norm_name(name))
        if spec is None:
            spec = {_norm_name(k): v for k, v in SFX_MAP.items()}.get(_norm_name(name))
    guessed = spec is None
    if guessed:
        spec = FALLBACK
    if isinstance(spec, str):
        spec = [(spec, 1.0, 0.0, 1.0)]
    return spec, guessed


def render_sfx(name: str, sr: int = SFX_SR) -> tuple[np.ndarray, bool]:
    layers, guessed = resolve_sfx(name)
    v = Voice(sr, zlib.crc32(name.encode()))
    for recipe, vol, delay, rate in layers:
        v.gain = vol
        SFX[recipe](v, delay, rate)
    x = v.bus.buf[:v.bus.end] * SFX_GAIN
    return x, guessed


def trim(x: np.ndarray, sr: int) -> np.ndarray:
    thr = 10 ** (SFX_TRIM_DB / 20)
    loud = np.nonzero(np.abs(x) > thr)[0]
    if len(loud) == 0:
        return x[:1]
    x = x[loud[0]:loud[-1] + 1].copy()
    fade = min(len(x), int(0.004 * sr))
    x[-fade:] *= np.linspace(1.0, 0.0, fade)
    return x


def scan_sfx_names() -> list[str]:
    """Every string literal inside an sfx(...) call in wii/src (ternaries included)."""
    names = set()
    for dirpath, _, files in os.walk(SRC):
        for fn in files:
            if not fn.endswith(('.cpp', '.h', '.hpp', '.cc', '.inl')):
                continue
            with open(os.path.join(dirpath, fn), encoding='utf-8', errors='replace') as f:
                text = f.read()
            for m in re.finditer(r'\bsfx\(', text):
                end = text.find(';', m.end())
                call = text[m.end():end if end >= 0 else len(text)]
                names.update(re.findall(r'"([A-Za-z0-9_-]+)"', call))
    return sorted(names)


# =================================================================================================
# Output
# =================================================================================================

def peak_db(x: np.ndarray) -> float:
    p = float(np.max(np.abs(x))) if len(x) else 0.0
    return 20 * math.log10(p) if p > 0 else -math.inf


def loop_seam(x: np.ndarray) -> float:
    """|x[0] - x[-1]| relative to the 99.9th percentile of sample-to-sample steps (<~1 is seamless)."""
    steps = np.abs(np.diff(x))
    return float(abs(x[0] - x[-1]) / (np.percentile(steps, 99.9) + 1e-12))


def write_ogg(path: str, x: np.ndarray, sr: int) -> None:
    # libsndfile's Vorbis quality is 1 - compression_level. Written in blocks: one big write call
    # crashes some libsndfile builds' Vorbis encoder.
    with sf.SoundFile(path, 'w', sr, 1, format='OGG', subtype='VORBIS', compression_level=1.0 - VORBIS_QUALITY) as f:
        for i in range(0, len(x), 8192):
            f.write(x[i:i + 8192])


def build_music(rows: list) -> list[float]:
    os.makedirs(MUSIC_DIR, exist_ok=True)
    gains = []
    for fname, key in MUSIC_FILES:
        x, secs, cycles = render_track(key)
        gain = 10 ** (MUSIC_PEAK_DB / 20) / float(np.max(np.abs(x)))
        gains.append(gain)
        x = (x * gain).astype(np.float32)
        path = os.path.join(MUSIC_DIR, fname + '.ogg')
        write_ogg(path, x, MUSIC_SR)
        y, _ = sf.read(path, dtype='float32')
        info = (f'{key}, {cycles}x8 bars, {secs:.1f} s, gain {gain:.2f}, peak {peak_db(x):.1f} dBFS '
                f'(decoded {peak_db(y):.1f}), rms {20 * math.log10(float(np.sqrt(np.mean(x ** 2)))):.1f} dBFS, '
                f'seam {loop_seam(x):.2f} (decoded {loop_seam(y):.2f}), {len(y) - len(x):+d} samples after decode')
        rows.append((os.path.relpath(path, ROOT), os.path.getsize(path), info))
    return gains


def build_sfx(rows: list, extra: list[str]) -> list[str]:
    os.makedirs(SFX_DIR, exist_ok=True)
    names = sorted(set(scan_sfx_names()) | set(extra))
    guessed = []
    for name in names:
        x, guess = render_sfx(name)
        if guess:
            guessed.append(name)
        x = trim(x, SFX_SR)
        note = ''
        pk = float(np.max(np.abs(x)))
        if pk > SFX_PEAK_LIMIT:
            x *= SFX_PEAK_LIMIT / pk
            note = f', limited from {20 * math.log10(pk):.1f} dBFS'
        pcm = np.clip(np.round(x * 32767), -32768, 32767).astype(np.int16)
        path = os.path.join(SFX_DIR, name + '.wav')
        sf.write(path, pcm, SFX_SR, subtype='PCM_16')
        layers, _ = resolve_sfx(name)
        src = ' + '.join(r if v == 1.0 else f'{r}*{v:g}' for r, v, _, _ in layers)
        rows.append((os.path.relpath(path, ROOT), os.path.getsize(path),
                     f'{src}{" (FALLBACK)" if guess else ""}, {len(x) / SFX_SR * 1000:.0f} ms, peak {peak_db(x):.1f} dBFS{note}'))
    return guessed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--music', action='store_true', help='only render the music')
    ap.add_argument('--sfx', action='store_true', help='only render the sound effects')
    ap.add_argument('names', nargs='*', help='extra sfx names to render besides those found in wii/src')
    args = ap.parse_args()
    both = not args.music and not args.sfx
    rows: list = []
    guessed: list[str] = []
    if args.music or both:
        build_music(rows)
    if args.sfx or both:
        guessed = build_sfx(rows, args.names)
    width = max(len(r[0]) for r in rows) if rows else 10
    total = 0
    for path, size, info in rows:
        total += size
        print(f'{path:<{width}}  {size / 1024:8.1f} KB  {info}')
    print(f'{"total":<{width}}  {total / 1024:8.1f} KB  ({len(rows)} files)')
    if guessed:
        print('WARNING: no recipe for ' + ', '.join(guessed) + f' (used "{FALLBACK}"); add them to SFX_MAP', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
