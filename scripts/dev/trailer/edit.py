"""Cut the Gleamtrail trailer from recorded gameplay (scripts/dev/record.mjs + shots.json) and the
score (music.py): beat-synced cuts, punch-in zooms, flashes, a spiral wipe, an animated logo reveal,
callouts and an end card, encoded with ffmpeg.

    python3 scripts/dev/trailer/edit.py <rawDir> <music.wav> <out.mp4> [--preview] [--from S --to S]

<rawDir> holds one folder of 30 fps JPEG frames per shot. --preview renders at half size and fast
settings; --from/--to render only part of the timeline (for checking a section); --still t1,t2
writes single frames (<out>_<t>.png) instead of a video.
"""
from __future__ import annotations

import math
import os
import subprocess
import sys
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
from music import BAR, BEAT  # noqa: E402  (cuts land on the score's beats)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
W, H, FPS = 1920, 1080, 30
INK = (22, 32, 58)
FONT = os.path.join(ROOT, 'art-out', 'logo', 'fredoka-700.ttf')
LOGO = os.path.join(ROOT, 'public', 'assets', 'rendered', 'ui_logo.webp')

args = [a for a in sys.argv[1:] if not a.startswith('--')]
RAW, MUSIC, OUT = args[0], args[1], args[2]
PREVIEW = '--preview' in sys.argv


def opt(name, default):
    return float(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def bar(b: float, beat: float = 0.0) -> float:
    return b * BAR + beat * BEAT


# ------------------------------------------------------------------------------------------
# Easing
def clamp01(x):
    return max(0.0, min(1.0, x))


def ease_out_back(x, s=1.9):
    x = clamp01(x) - 1.0
    return 1.0 + x * x * ((s + 1) * x + s)


def ease_out_cubic(x):
    return 1.0 - (1.0 - clamp01(x)) ** 3


def ease_in_out(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


# ------------------------------------------------------------------------------------------
# Footage
@lru_cache(maxsize=48)
def src_frame(shot: str, idx: int) -> Image.Image:
    d = os.path.join(RAW, shot)
    n = len([f for f in os.listdir(d) if f.endswith('.jpg')])
    idx = max(0, min(n - 1, idx))
    return Image.open(os.path.join(d, f'f{idx:05d}.jpg')).convert('RGB')


def footage(shot: str, t: float, zoom: float = 1.0, focus=(0.5, 0.5)) -> Image.Image:
    im = src_frame(shot, int(round(t * FPS)))
    if zoom > 1.0005:
        cw, ch = W / zoom, H / zoom
        cx = min(max(focus[0] * W, cw / 2), W - cw / 2)
        cy = min(max(focus[1] * H, ch / 2), H - ch / 2)
        im = im.resize((W, H), Image.BICUBIC, box=(cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2))
    return im


# ------------------------------------------------------------------------------------------
# Graphics
@lru_cache(maxsize=16)
def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size)


@lru_cache(maxsize=64)
def title_sprite(text: str, size: int, fill=(255, 255, 255), stroke=INK) -> Image.Image:
    """White display type with a slim ink outline and a soft drop shadow (the game's title style).
    Letters get a little extra spacing, and every outline is drawn before any fill, so thick
    outlines never close up pairs like "IV"."""
    f = font(size)
    sw = max(3, size // 16)
    track = size * 0.045
    xs, x = [], 0.0
    for ch in text:
        xs.append(x)
        x += f.getlength(ch) + track
    asc, desc = f.getmetrics()
    pad = size // 2
    w, h = int(x - track + pad * 2), int(asc + desc + pad * 2)
    def layer(color, stroke_on, dy=0):
        im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        for ch, cx in zip(text, xs):
            if stroke_on:
                d.text((pad + cx, pad + dy), ch, font=f, fill=color, stroke_width=sw, stroke_fill=color)
            else:
                d.text((pad + cx, pad + dy), ch, font=f, fill=color)
        return im
    shadow = layer((10, 17, 32, 120), True, size // 10).filter(ImageFilter.GaussianBlur(size / 14))
    out = Image.alpha_composite(shadow, layer(stroke + (255,), True))
    return Image.alpha_composite(out, layer(fill + (255,), False))


@lru_cache(maxsize=64)
def capsule(text: str, size: int, bg=(255, 250, 241), fg=INK, dot=None) -> Image.Image:
    """A rounded label in the game's card style: warm white face, slim darker lip, soft shadow."""
    f = font(size)
    box = f.getbbox(text)
    tw, th = box[2] - box[0], box[3] - box[1]
    padx, pady = int(size * 0.75), int(size * 0.42)
    dot_w = int(size * 0.9) if dot else 0
    w, h = tw + padx * 2 + dot_w, th + pady * 2
    lip = max(3, h // 14)
    m = 24
    im = Image.new('RGBA', (w + m * 2, h + lip + m * 2), (0, 0, 0, 0))
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((m, m + lip + 6, m + w, m + h + lip + 6), radius=h // 2, fill=(10, 17, 32, 90))
    im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(8)))
    d = ImageDraw.Draw(im)
    lipc = tuple(int(c * 0.84) for c in bg)
    d.rounded_rectangle((m, m + lip, m + w, m + h + lip), radius=h // 2, fill=lipc + (255,))
    d.rounded_rectangle((m, m, m + w, m + h), radius=h // 2, fill=bg + (255,))
    if dot:
        r = size * 0.28
        cx, cy = m + padx * 0.7 + r, m + h / 2
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=dot + (255,))
    d.text((m + padx + dot_w - box[0], m + pady - box[1]), text, font=f, fill=fg + (255,))
    return im


def paste_scaled(base: Image.Image, sprite: Image.Image, cx: float, cy: float, scale: float = 1.0, alpha: float = 1.0, rot: float = 0.0):
    if scale <= 0.01 or alpha <= 0.01:
        return
    sp = sprite
    if abs(scale - 1.0) > 0.002:
        sp = sp.resize((max(1, int(sp.width * scale)), max(1, int(sp.height * scale))), Image.BICUBIC)
    if rot:
        sp = sp.rotate(rot, resample=Image.BICUBIC, expand=True)
    if alpha < 0.999:
        a = sp.getchannel('A').point(lambda v: int(v * alpha))
        sp = sp.copy()
        sp.putalpha(a)
    base.alpha_composite(sp, (int(cx - sp.width / 2), int(cy - sp.height / 2)))


@lru_cache(maxsize=4)
def logo_sprite(width: int) -> Image.Image:
    im = Image.open(LOGO).convert('RGBA')
    return im.resize((width, int(im.height * width / im.width)), Image.LANCZOS)


@lru_cache(maxsize=8)
def sparkle(size: int, color=(255, 246, 200)) -> Image.Image:
    s = size * 4
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = s / 2
    pts = []
    for k in range(8):
        a = k * math.pi / 4
        r = s * 0.48 if k % 2 == 0 else s * 0.1
        pts.append((c + math.cos(a) * r, c + math.sin(a) * r))
    d.polygon(pts, fill=color + (255,))
    glow = im.filter(ImageFilter.GaussianBlur(s / 10))
    out = Image.alpha_composite(glow, im)
    return out.resize((size, size), Image.LANCZOS)


def white_flash(base: Image.Image, a: float, color=(255, 255, 255)):
    if a <= 0.01:
        return
    base.alpha_composite(Image.new('RGBA', base.size, color + (int(255 * clamp01(a)),)))


# ------------------------------------------------------------------------------------------
# Overlay elements (each draws at local time u seconds since its start)
def draw_logo(base, u, cx=960, cy=430, width=1060, sub=True):
    k = ease_out_back(u / 0.5, 1.6)
    lg = logo_sprite(width)
    paste_scaled(base, lg, cx, cy, 0.35 + 0.65 * k, clamp01(u / 0.12))
    # a bright band sweeping across the logo, masked to its artwork
    if 0.55 < u < 1.25:
        p = (u - 0.55) / 0.7
        band = Image.new('L', lg.size, 0)
        bd = ImageDraw.Draw(band)
        x = -200 + p * (lg.width + 400)
        bd.polygon([(x, 0), (x + 90, 0), (x - 60, lg.height), (x - 150, lg.height)], fill=170)
        band = band.filter(ImageFilter.GaussianBlur(14))
        m = Image.fromarray((np.asarray(band, np.float32) * np.asarray(lg.getchannel('A'), np.float32) / 255).astype(np.uint8))
        shine = Image.new('RGBA', lg.size, (255, 255, 255, 0))
        shine.putalpha(m)
        base.alpha_composite(shine, (int(cx - lg.width / 2), int(cy - lg.height / 2)))
    rnd = np.random.default_rng(3)
    for i in range(9):
        t0 = 0.15 + i * 0.09
        if t0 < u < t0 + 0.7:
            a = rnd.uniform(0, math.tau)
            px = cx + math.cos(a) * width * 0.52 * rnd.uniform(0.7, 1.0)
            py = cy + math.sin(a) * 110 * rnd.uniform(0.8, 1.3)
            q = (u - t0) / 0.7
            paste_scaled(base, sparkle(64), px, py, math.sin(math.pi * q) * rnd.uniform(0.6, 1.1), 1.0, rot=q * 90)
        else:
            rnd.uniform(0, math.tau), rnd.uniform(0.7, 1.0), rnd.uniform(0.8, 1.3), rnd.uniform(0.6, 1.1)
    if sub and u > 0.55:
        s = title_sprite('FESTIVAL OF THE SPIRAL ISLES', 56)
        q = ease_out_cubic((u - 0.55) / 0.35)
        paste_scaled(base, s, cx, cy + 150 + (1 - q) * 30, 1.0, q)


def draw_callout(base, u, dur, text, sub=None, cx=960, cy=190, size=112):
    if u < 0 or u > dur:
        return
    kin = ease_out_back(u / 0.32, 2.2)
    kout = clamp01((dur - u) / 0.16)
    scale = (0.55 + 0.45 * kin) * (0.85 + 0.15 * kout)
    paste_scaled(base, title_sprite(text, size), cx, cy, scale, min(clamp01(u / 0.08), kout))
    if sub:
        q = ease_out_cubic((u - 0.12) / 0.3)
        paste_scaled(base, capsule(sub, 40), cx, cy + size * 0.95, 1.0, min(q, kout))


def draw_tag(base, u, dur, text, color):
    """Minigame name: a capsule sliding in from the left with a dot in the game's colour."""
    if u < 0 or u > dur:
        return
    sp = capsule(text.upper(), 46, dot=color)
    q = ease_out_cubic(u / 0.28)
    out = clamp01((dur - u) / 0.14)
    x = -sp.width / 2 + (sp.width / 2 + 70 + sp.width / 2) * q
    paste_scaled(base, sp, x - sp.width / 2 + sp.width / 2, 980, 1.0, out)


def draw_endcard(base, u):
    draw_logo(base, u, cx=960, cy=390, width=1000, sub=False)
    if u > 0.45:
        q = ease_out_cubic((u - 0.45) / 0.35)
        paste_scaled(base, title_sprite('FESTIVAL OF THE SPIRAL ISLES', 58), 960, 540 + (1 - q) * 24, 1.0, q)
    chips = [('1–4 PLAYERS', (31, 165, 160)), ('LOCAL MULTIPLAYER', (255, 107, 94)), ('8 MINIGAMES', (244, 184, 59))]
    xs = [560, 960, 1360]
    for i, (txt, col) in enumerate(chips):
        t0 = 0.8 + i * 0.12
        if u > t0:
            paste_scaled(base, capsule(txt, 38, dot=col), xs[i], 680, ease_out_back((u - t0) / 0.3, 2.0), clamp01((u - t0) / 0.1))
    if u > 1.3:
        q = ease_out_back((u - 1.3) / 0.35, 1.8)
        paste_scaled(base, capsule('PLAY NOW IN YOUR BROWSER', 46, bg=(255, 200, 61), fg=INK), 960, 840, 0.6 + 0.4 * q, clamp01((u - 1.3) / 0.1))


def spiral_wipe_mask(p: float) -> Image.Image:
    """A growing circle with a spiral edge (the Spiral Isles motif) revealing the next shot."""
    m = Image.new('L', (W, H), 0)
    if p <= 0:
        return m
    d = ImageDraw.Draw(m)
    R = p * math.hypot(W, H) * 0.56
    pts = []
    for k in range(180):
        a = k / 180 * math.tau
        r = R * (1.0 + 0.06 * math.sin(a * 6 + p * 8))
        pts.append((W / 2 + math.cos(a + p * 2) * r, H / 2 + math.sin(a + p * 2) * r))
    d.polygon(pts, fill=255)
    return m.filter(ImageFilter.GaussianBlur(3))


# ------------------------------------------------------------------------------------------
# Timeline
MG = {  # shot -> (name, colour)
    'mg_gleam': ('Gleam Grab', (244, 184, 59)), 'mg_orbit': ('Orbit Dodge', (142, 92, 217)), 'mg_crate': ('Crate Craze', (154, 99, 52)),
    'mg_skybridge': ('Skybridge Scramble', (92, 168, 255)), 'mg_totem': ('Totem Tug', (255, 107, 94)), 'mg_splash': ('Spiral Splash', (63, 198, 232)),
    'mg_relay': ('Relic Relay', (196, 155, 255)), 'mg_tower': ('Tumble Tower', (108, 194, 74)),
}

# (start, end, shot, source in-point, zoom from, zoom to, focus, flash-in)
SEGMENTS = []
OVERLAYS = []


def seg(start, end, shot, src, z0=1.0, z1=1.04, focus=(0.5, 0.5), flash=0.0, speed=1.0):
    SEGMENTS.append(dict(start=start, end=end, shot=shot, src=src, z0=z0, z1=z1, focus=focus, flash=flash, speed=speed))


def ov(start, end, kind, **kw):
    OVERLAYS.append(dict(start=start, end=end, kind=kind, **kw))


def load_edl():
    """The cut list (edl.json, or $EDL): bars/beats on the score's grid, in-points in shot seconds."""
    import json
    path = os.environ.get('EDL') or os.path.join(os.path.dirname(__file__), 'edl.json')
    edl = json.load(open(path))
    for s in edl['segments']:
        seg(bar(*s['start']), bar(*s['end']), s['shot'], s['src'], s.get('z0', 1.0), s.get('z1', 1.04), tuple(s.get('focus', (0.5, 0.5))), s.get('flash', 0.0), s.get('speed', 1.0))
    for o in edl['overlays']:
        kw = {k: v for k, v in o.items() if k not in ('start', 'end', 'kind')}
        ov(bar(*o['start']), bar(*o['end']), o['kind'], **kw)
    return edl


def render_frame(t: float) -> Image.Image:
    active = [s for s in SEGMENTS if s['start'] <= t < s['end']]
    base = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    for s in active[-1:]:
        u = t - s['start']
        p = u / max(1e-6, s['end'] - s['start'])
        z = s['z0'] + (s['z1'] - s['z0']) * ease_in_out(p)
        im = footage(s['shot'], s['src'] + u * s['speed'], z, s['focus'])
        base.paste(im, (0, 0))
        white_flash(base, s['flash'] * (1 - clamp01(u / 0.28)))
    for o in OVERLAYS:
        if not (o['start'] <= t < o['end']):
            continue
        u = t - o['start']
        dur = o['end'] - o['start']
        k = o['kind']
        if k == 'logo':
            draw_logo(base, u)
        elif k == 'callout':
            draw_callout(base, u, dur, o['text'], o.get('sub'), o.get('cx', 960), o.get('cy', 190), o.get('size', 112))
        elif k == 'tag':
            name, col = MG[o['shot']]
            draw_tag(base, u, dur, name, col)
        elif k == 'endcard':
            draw_endcard(base, u)
        elif k == 'fadein':
            white_flash(base, 1 - clamp01(u / dur), (0, 0, 0))
        elif k == 'fadeout':
            white_flash(base, clamp01(u / dur), (0, 0, 0))
        elif k == 'flash':
            white_flash(base, o.get('a', 0.9) * (1 - clamp01(u / dur)))
        elif k == 'spiral':
            # reveal the next segment through a spiral-edged circle over the previous one
            prev = [s for s in SEGMENTS if s['end'] <= t + 1e-6 and s['end'] >= o['start'] - 1e-6]
            if prev:
                s = prev[-1]
                im = footage(s['shot'], s['src'] + (t - s['start']) * s['speed'], s['z1'], s['focus']).convert('RGBA')
                mask = spiral_wipe_mask(ease_in_out(u / dur))
                inv = Image.fromarray(255 - np.asarray(mask))
                base.paste(im, (0, 0), inv)
        elif k == 'blur':
            base = base.filter(ImageFilter.GaussianBlur(o.get('r', 8)))
            white_flash(base, o.get('dim', 0.15), (10, 17, 32))
    return base.convert('RGB')


def main():
    load_edl()
    if '--still' in sys.argv:
        # render single frames for checking the graphics: --still t1,t2,... (seconds); OUT is a prefix
        for tt in sys.argv[sys.argv.index('--still') + 1].split(','):
            render_frame(float(tt)).save(f'{OUT}_{float(tt):06.2f}.png')
        return
    t0, t1 = opt('--from', 0.0), opt('--to', max(s['end'] for s in SEGMENTS + OVERLAYS))
    ff = os.environ.get('FFMPEG', 'ffmpeg')
    size = (W // 2, H // 2) if PREVIEW else (W, H)
    cmd = [ff, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{size[0]}x{size[1]}', '-r', str(FPS), '-i', '-',
           '-ss', f'{t0:.3f}', '-t', f'{t1 - t0:.3f}', '-i', MUSIC,
           '-c:v', 'libx264', '-preset', 'veryfast' if PREVIEW else 'slow', '-crf', '26' if PREVIEW else '16', '-pix_fmt', 'yuv420p',
           '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = int(round((t1 - t0) * FPS))
    for i in range(n):
        im = render_frame(t0 + i / FPS)
        if PREVIEW:
            im = im.resize(size, Image.BILINEAR)
        proc.stdin.write(im.tobytes())
        if i % 150 == 0:
            print(f'frame {i}/{n}', flush=True)
    proc.stdin.close()
    proc.wait()
    print('wrote', OUT)


if __name__ == '__main__':
    main()
