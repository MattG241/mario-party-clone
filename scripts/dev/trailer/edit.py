"""Cut the Gleamtrail trailer from recorded gameplay (scripts/dev/record.mjs + shots.json) and the
score (music.py): beat-synced cuts, punch-in zooms, flashes, a spiral wipe, an animated logo reveal,
a roster of the guests, callouts and an end card, with the game's own sound effects under the score
(SFX_DIR, from sfx_render.mjs), encoded with ffmpeg.

    python3 scripts/dev/trailer/edit.py <rawDir> <music.wav> <out.mp4> [--preview] [--from S --to S]

<rawDir> holds one folder of 30 fps JPEG frames per shot. --preview renders at half size and fast
settings; --from/--to render only part of the timeline (for checking a section); --still t1,t2
writes single frames (<out>_<t>.png) instead of a video. The cut list is edl.json (or $EDL): times
are [bar, beat] on the score's grid.

Guest poses come from the character renders (scripts/art/characters.py, art-out/chars or $POSES):
<id>/victory_<n>.png at any supersampling (the frame is 389 px at 1x).

Environment: FFMPEG (the ffmpeg binary), SFX_DIR (rendered effects; without it the score plays
alone), SFX_GAIN (effects level, default 1.8), EDL, POSES, CRF (final quality, default 17) and
AUDIO_FADE (seconds; by default the sound fades with a closing fadeout overlay).
"""
from __future__ import annotations

import json
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
POSES = os.environ.get('POSES', os.path.join(ROOT, 'art-out', 'chars'))

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
@lru_cache(maxsize=None)
def shot_len(shot: str) -> int:
    d = os.path.join(RAW, shot)
    return len([f for f in os.listdir(d) if f.endswith('.jpg')])


@lru_cache(maxsize=48)
def src_frame(shot: str, idx: int) -> Image.Image:
    idx = max(0, min(shot_len(shot) - 1, idx))
    return Image.open(os.path.join(RAW, shot, f'f{idx:05d}.jpg')).convert('RGB')


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
        a, rr, ry, sc = rnd.uniform(0, math.tau), rnd.uniform(0.7, 1.0), rnd.uniform(0.8, 1.3), rnd.uniform(0.6, 1.1)
        if t0 < u < t0 + 0.7:
            px = cx + math.cos(a) * width * 0.52 * rr
            py = cy + math.sin(a) * 110 * ry
            q = (u - t0) / 0.7
            paste_scaled(base, sparkle(64), px, py, math.sin(math.pi * q) * sc, 1.0, rot=q * 90)
    if sub and u > 0.55:
        s = title_sprite('FESTIVAL OF THE SPIRAL ISLES', 56)
        q = ease_out_cubic((u - 0.55) / 0.35)
        paste_scaled(base, s, cx, cy + width * 0.135 + (1 - q) * 30, 1.0, q)


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


def draw_tag(base, u, dur, text, color, y=980):
    """Minigame name: a capsule sliding in from the left with a dot in the game's colour."""
    if u < 0 or u > dur:
        return
    sp = capsule(text.upper(), 46, dot=color)
    q = ease_out_cubic(u / 0.28)
    out = clamp01((dur - u) / 0.14)
    x = -sp.width / 2 + (sp.width + 70) * q
    paste_scaled(base, sp, x, y, 1.0, out)


def draw_endcard(base, u):
    draw_logo(base, u, cx=960, cy=360, width=1100, sub=False)
    if u > 0.45:
        q = ease_out_cubic((u - 0.45) / 0.35)
        paste_scaled(base, title_sprite('FESTIVAL OF THE SPIRAL ISLES', 60), 960, 540 + (1 - q) * 24, 1.0, q)
    chips = [capsule(txt, 38, dot=col) for txt, col in (('1–4 PLAYERS', (31, 165, 160)), ('8 MINIGAMES', (244, 184, 59)), ('LOCAL MULTIPLAYER', (255, 107, 94)))]
    margin, gap = 24, 18  # capsule sprites carry a 24 px shadow margin on each side
    total = sum(c.width - 2 * margin for c in chips) + gap * (len(chips) - 1)
    x = 960 - total / 2
    for i, sp in enumerate(chips):
        w = sp.width - 2 * margin
        t0 = 0.8 + i * 0.12
        if u > t0:
            paste_scaled(base, sp, x + w / 2, 676, ease_out_back((u - t0) / 0.3, 2.0), clamp01((u - t0) / 0.1))
        x += w + gap
    if u > 1.3:
        q = ease_out_back((u - 1.3) / 0.35, 1.8)
        a = clamp01((u - 1.3) / 0.1)
        paste_scaled(base, title_sprite('PLAY FREE IN YOUR BROWSER', 44), 960, 812, 0.7 + 0.3 * q, a)
        paste_scaled(base, capsule('mattg241.github.io/mario-party-clone', 48, bg=(255, 200, 61), fg=INK), 960, 900, 0.6 + 0.4 * q, a)
    if u > 1.8:
        note = fine_print('Guest characters are fan-made tributes for private, non-commercial play and belong to their respective owners.')
        paste_scaled(base, note, 960, 1040, 1.0, clamp01((u - 1.8) / 0.4) * 0.9)


@lru_cache(maxsize=4)
def fine_print(text: str, size: int = 24) -> Image.Image:
    """Small white text with a soft shadow, for the end card's note."""
    f = font(size)
    box = f.getbbox(text)
    w, h = box[2] - box[0] + 24, box[3] - box[1] + 24
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    sh = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((12 - box[0], 14 - box[1]), text, font=f, fill=(10, 17, 32, 160))
    im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(2)))
    ImageDraw.Draw(im).text((12 - box[0], 12 - box[1]), text, font=f, fill=(255, 250, 241, 235))
    return im


# ------------------------------------------------------------------------------------------
# The guests: a page of slanted colour panels per bar, each guest landing on an eighth note in
# their victory pose with their name. Panel colours cycle through the festival palette (not the
# characters' own colours), so every guest gets the same treatment.
GUESTS = {
    'luffy': 'LUFFY', 'zoro': 'ZORO', 'nami': 'NAMI', 'goku': 'GOKU', 'naruto': 'NARUTO',
    'batman': 'BATMAN', 'spiderman': 'SPIDER-MAN', 'ironman': 'IRON MAN', 'sonic': 'SONIC',
    'spongebob': 'SPONGEBOB', 'homer': 'HOMER', 'elvis': 'ELVIS', 'sabrina': 'SABRINA CARPENTER',
    'chappell': 'CHAPPELL ROAN', 'sandler': 'ADAM SANDLER', 'obama': 'BARACK OBAMA', 'trump': 'DONALD TRUMP',
}
PAGES = [['luffy', 'zoro', 'nami', 'goku', 'naruto'], ['batman', 'spiderman', 'ironman', 'sonic'],
         ['spongebob', 'homer', 'elvis', 'sabrina'], ['chappell', 'sandler', 'obama', 'trump']]
FESTIVAL = [(31, 165, 160), (255, 107, 94), (244, 184, 59), (142, 92, 217), (92, 168, 255), (108, 194, 74)]
SLANT = 70
POSE_K = 2.05  # display pixels per 1x frame pixel (keeps the guests' relative sizes)
FEET = (194.5, 304.0)  # where the feet sit in a 1x frame (scripts/art/characters.py)
FEET_Y = 880


@lru_cache(maxsize=48)
def pose(cid: str, i: int) -> Image.Image | None:
    path = os.path.join(POSES, cid, f'victory_{i}.png')
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert('RGBA')
    k = POSE_K * 389 / im.width
    out = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
    if k > 1.05:  # a lower-resolution render: a touch of sharpening after the upscale
        out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    return out


@lru_cache(maxsize=24)
def panel_bg(color: tuple, pw: int) -> Image.Image:
    """A guest's panel: their colour, lighter towards the top."""
    c = np.array(color, np.float32)
    t = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    top, bot = c + (255 - c) * 0.34, c * 0.72
    col_ = top * (1 - t) + bot * t
    arr = np.repeat(col_[:, None, :], pw, axis=1).reshape(H, pw, 3)
    return Image.fromarray(arr.astype(np.uint8), 'RGB').convert('RGBA')


@lru_cache(maxsize=24)
def panel_mask(i: int, n: int, pw: int) -> Image.Image:
    m = Image.new('L', (pw, H), 0)
    # the outer panels run square to the screen edges, so no corner is left uncovered
    left = [(0, 0), (0, H)] if i == 0 else [(SLANT * 2, 0), (0, H)]
    right = [(pw, H), (pw, 0)] if i == n - 1 else [(pw - SLANT * 2, H), (pw, 0)]
    ImageDraw.Draw(m).polygon([left[0], right[1], right[0], left[1]], fill=255)
    return m


def rays(size, cx, cy, angle, n=12, alpha=0.16) -> Image.Image:
    im = Image.new('RGBA', size, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    R = 1600
    for k in range(n):
        a0 = angle + k * math.tau / n
        a1 = a0 + math.pi / n
        d.polygon([(cx, cy), (cx + math.cos(a0) * R, cy + math.sin(a0) * R), (cx + math.cos(a1) * R, cy + math.sin(a1) * R)], fill=(255, 255, 255, int(255 * alpha)))
    return im


def draw_page(base, u, page: int, step: float):
    """One page of guests: panels land every `step` seconds, alternately from above and below."""
    ids = PAGES[page]
    n = len(ids)
    colw = W / n
    pw = int(colw + SLANT * 2)
    first = sum(len(p) for p in PAGES[:page])
    for i, cid in enumerate(ids):
        q = u - i * step
        if q < 0:
            continue
        k = ease_out_back(q / 0.3, 1.25)
        dy = int((1 - k) * (-H if (first + i) % 2 == 0 else H))
        color = FESTIVAL[(first + i) % len(FESTIVAL)]
        layer = panel_bg(color, pw).copy()
        layer.alpha_composite(rays((pw, H), pw / 2, 600, u * 0.35 + i, alpha=0.13))
        seq = (0, 1, 2, 3, 2)  # the game's victory order, holding on 2
        fi = seq[min(len(seq) - 1, int(max(0.0, q - 0.08) * 8))]
        hero = pose(cid, fi)
        hk = ease_out_back((q - 0.06) / 0.28, 1.8)
        if hero is not None and hk > 0.02:
            sh = Image.new('RGBA', (pw, H), (0, 0, 0, 0))
            ImageDraw.Draw(sh).ellipse((pw / 2 - 120, FEET_Y - 20, pw / 2 + 120, FEET_Y + 16), fill=(10, 17, 32, 80))
            layer.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)))
            hs = hero.resize((max(1, int(hero.width * hk)), max(1, int(hero.height * hk))), Image.BICUBIC) if abs(hk - 1) > 0.01 else hero
            fx, fy = pw / 2, FEET_Y
            layer.alpha_composite(hs, (int(fx - FEET[0] * POSE_K * hk), int(fy - FEET[1] * POSE_K * hk)))
        x0 = int(i * colw - SLANT)
        base.paste(layer, (x0, dy), panel_mask(i, n, pw))
        if i > 0:  # a slim white seam along the panel's left edge
            ImageDraw.Draw(base).line([(x0 + SLANT * 2, dy), (x0, dy + H)], fill=(255, 255, 255, 255), width=6)
        if q > 0.16:
            cq = ease_out_back((q - 0.16) / 0.3, 2.0)
            name = GUESTS[cid]
            size = 38 if len(name) <= 13 else (34 if n <= 4 else 30)
            paste_scaled(base, capsule(name, size, dot=color), i * colw + colw / 2, 980 + dy, 0.6 + 0.4 * cq, clamp01((q - 0.16) / 0.1))


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


@lru_cache(maxsize=2)
def letterbox_mask(h: int) -> Image.Image:
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, h), fill=(0, 0, 0, 255))
    d.rectangle((0, H - h, W, H), fill=(0, 0, 0, 255))
    return im


# ------------------------------------------------------------------------------------------
# Timeline
MG = {  # shot -> (name, colour)
    'mg_gleam': ('Gleam Grab', (244, 184, 59)), 'mg_orbit': ('Orbit Dodge', (142, 92, 217)), 'mg_crate': ('Crate Craze', (154, 99, 52)),
    'mg_skybridge': ('Skybridge Scramble', (92, 168, 255)), 'mg_totem': ('Totem Tug', (255, 107, 94)), 'mg_splash': ('Spiral Splash', (63, 198, 232)),
    'mg_relay': ('Relic Relay', (196, 155, 255)), 'mg_tower': ('Tumble Tower', (108, 194, 74)),
}

SEGMENTS = []
OVERLAYS = []


def seg(start, end, shot, src, z0=1.0, z1=1.04, focus=(0.5, 0.5), flash=0.0, speed=1.0, punch=0.0, mute=False, sfx=1.0):
    SEGMENTS.append(dict(start=start, end=end, shot=shot, src=src, z0=z0, z1=z1, focus=focus, flash=flash, speed=speed, punch=punch, mute=mute, sfx=sfx))


def ov(start, end, kind, **kw):
    OVERLAYS.append(dict(start=start, end=end, kind=kind, **kw))


def load_edl():
    """The cut list (edl.json, or $EDL): bars/beats on the score's grid, in-points in shot seconds."""
    path = os.environ.get('EDL') or os.path.join(os.path.dirname(__file__), 'edl.json')
    edl = json.load(open(path))
    for s in edl['segments']:
        seg(bar(*s['start']), bar(*s['end']), s['shot'], s['src'], s.get('z0', 1.0), s.get('z1', 1.04), tuple(s.get('focus', (0.5, 0.5))),
            s.get('flash', 0.0), s.get('speed', 1.0), s.get('punch', 0.0), s.get('mute', False), s.get('sfx', 1.0))
    for o in edl['overlays']:
        kw = {k: v for k, v in o.items() if k not in ('start', 'end', 'kind')}
        ov(bar(*o['start']), bar(*o['end']), o['kind'], **kw)
    return edl


def seg_image(s, t):
    """A segment's picture at timeline time t: its footage at the right source time and zoom."""
    u = t - s['start']
    p = u / max(1e-6, s['end'] - s['start'])
    z = s['z0'] + (s['z1'] - s['z0']) * ease_in_out(p)
    if s['punch']:
        z *= 1.0 + s['punch'] * (1.0 - ease_out_cubic(u / 0.3))
    return footage(s['shot'], s['src'] + u * s['speed'], z, s['focus'])


def render_frame(t: float) -> Image.Image:
    active = [s for s in SEGMENTS if s['start'] <= t < s['end']]
    base = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    for s in active[-1:]:
        base.paste(seg_image(s, t), (0, 0))
        white_flash(base, s['flash'] * (1 - clamp01((t - s['start']) / 0.28)))
    for o in OVERLAYS:
        if not (o['start'] <= t < o['end']):
            continue
        u = t - o['start']
        dur = o['end'] - o['start']
        k = o['kind']
        if k == 'logo':
            draw_logo(base, u, o.get('cx', 960), o.get('cy', 430), o.get('width', 1060))
        elif k == 'callout':
            draw_callout(base, u, dur, o['text'], o.get('sub'), o.get('cx', 960), o.get('cy', 190), o.get('size', 112))
        elif k == 'tag':
            name, col = MG[o['shot']]
            draw_tag(base, u, dur, name, col, o.get('y', 980))
        elif k == 'endcard':
            draw_endcard(base, u)
        elif k == 'page':
            # the previous page stays up underneath until the new panels have swept over it
            if o['page'] > 0 and o.get('under', True):
                draw_page(base, 99.0, o['page'] - 1, 0.0)
            draw_page(base, u, o['page'], o.get('step', BEAT / 2))
        elif k == 'fadein':
            white_flash(base, 1 - clamp01(u / dur), (0, 0, 0))
        elif k == 'fadeout':
            white_flash(base, clamp01(u / dur), (0, 0, 0))
        elif k == 'flash':
            white_flash(base, o.get('a', 0.9) * (1 - clamp01(u / dur)), tuple(o.get('color', (255, 255, 255))))
        elif k == 'black':
            white_flash(base, o.get('a', 1.0), (0, 0, 0))
        elif k == 'letterbox':
            e = ease_out_cubic(u / 0.35)
            if not o.get('hold'):
                e = min(e, ease_out_cubic((dur - u) / 0.35))
            hgt = int(o.get('h', 90) * e)
            if hgt > 0:
                base.alpha_composite(letterbox_mask(hgt))
        elif k == 'spiral':
            # reveal the next segment through a spiral-edged circle over the previous one
            prev = [s for s in SEGMENTS if s['end'] <= t + 1e-6 and s['end'] >= o['start'] - 1e-6]
            if prev:
                s = prev[-1]
                im = seg_image(dict(s, end=s['end'] + dur), t).convert('RGBA')
                mask = spiral_wipe_mask(ease_in_out(u / dur))
                inv = Image.fromarray(255 - np.asarray(mask))
                base.paste(im, (0, 0), inv)
        elif k == 'blur':
            r = o.get('r', 8) * ease_in_out(u / o.get('ramp', 0.001)) if o.get('ramp') else o.get('r', 8)
            if r > 0.3:
                base = base.filter(ImageFilter.GaussianBlur(r))
            white_flash(base, o.get('dim', 0.15) * (ease_in_out(u / o['ramp']) if o.get('ramp') else 1.0), (10, 17, 32))
    return base.convert('RGB')


# ------------------------------------------------------------------------------------------
# Sound: the score plus the game's own effects (sfx.json from record.mjs, rendered to WAV by
# sfx_render.mjs into $SFX_DIR), each laid at the moment it happened in the footage on screen.
SFX_DIR = os.environ.get('SFX_DIR', '')
SFX_GAIN = float(os.environ.get('SFX_GAIN', '1.8'))  # after level_fx: about 10 dB under the score


@lru_cache(maxsize=None)
def sfx_events(shot: str):
    f = os.path.join(RAW, shot, 'sfx.json')
    return json.load(open(f))['events'] if os.path.exists(f) else []


@lru_cache(maxsize=None)
def sfx_wave(key: str, rate):
    import wave
    f = os.path.join(SFX_DIR, f'{key}@{rate}.wav')
    if not os.path.exists(f):
        return None
    w = wave.open(f)
    return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768


def level_fx(fx: np.ndarray, sr: int, thr_db: float = -18.0, ratio: float = 3.0, tc: float = 0.02) -> np.ndarray:
    """Even out the effects bus before it goes under the score: a gentle RMS compressor, so the
    footsteps and pops stay audible while the big hits (countdown, FINISH!) do not jump out."""
    from scipy import signal
    a = 1.0 - math.exp(-1.0 / (tc * sr))
    rms = np.sqrt(np.maximum(signal.lfilter([a], [1.0, a - 1.0], fx.astype(np.float64) ** 2), 1e-12))
    thr = 10 ** (thr_db / 20)
    gain = (np.maximum(rms, thr) / thr) ** (1.0 / ratio - 1.0)
    return (fx * gain).astype(np.float32)


def limit(x: np.ndarray, sr: int, ceiling: float = 0.891, hold: float = 0.03, ramp: float = 0.01) -> np.ndarray:
    """Look-ahead peak limiter (-1 dBFS): the gain each sample needs, held over the neighbouring
    `hold` seconds and smoothed over `ramp`, so it is already down when a peak arrives and comes
    back up without clicks."""
    from scipy import ndimage
    need = np.minimum(1.0, ceiling / np.maximum(np.abs(x).max(axis=1), 1e-9))
    if need.min() >= 1.0:
        return x
    nh, nr = int(hold * sr), int(ramp * sr)
    g = ndimage.minimum_filter1d(need, 2 * nh + 1, mode='nearest')
    g = ndimage.uniform_filter1d(g, 2 * nr + 1, mode='nearest')  # nr <= nh keeps g <= need
    return x * np.minimum(g, need)[:, None]


def mix_audio(t0: float, t1: float, path: str) -> str:
    """Write the score with the footage's sound effects mixed in (t0..t1) to a WAV at path."""
    import wave
    w = wave.open(MUSIC)
    sr, ch = w.getframerate(), w.getnchannels()
    music = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, ch).astype(np.float32) / 32768
    fx = np.zeros(len(music), np.float32)
    # full-screen graphics hide the footage, so its sounds go too
    muted = [(o['start'], o['end']) for o in OVERLAYS if o['kind'] in ('page', 'endcard', 'black')]
    placed = 0
    for sg in SEGMENTS:
        if sg['mute']:
            continue
        dur = sg['end'] - sg['start']
        for fi, key, rate, vol in sfx_events(sg['shot']):
            ts = fi / FPS
            if not (sg['src'] <= ts < sg['src'] + dur * sg['speed']):
                continue
            t = sg['start'] + (ts - sg['src']) / sg['speed']
            if any(a <= t < b for a, b in muted):
                continue
            wv = sfx_wave(key, rate)
            if wv is None:
                continue
            i = int(t * sr)
            n = min(len(wv), len(fx) - i)
            if n > 0:
                fx[i:i + n] += wv[:n] * vol * sg['sfx']
                placed += 1
    # effects the edit adds for its own graphics (a whoosh as a panel lands, say)
    for o in OVERLAYS:
        if o['kind'] != 'sfx':
            continue
        wv = sfx_wave(o['key'], o.get('rate', 1))
        if wv is None:
            print(f"missing effect {o['key']}@{o.get('rate', 1)} (render it with EXTRA_SFX)")
            continue
        i = int(o['start'] * sr)
        n = min(len(wv), len(fx) - i)
        if n > 0:
            fx[i:i + n] += wv[:n] * o.get('vol', 1.0)
            placed += 1
    mix = music + (level_fx(fx, sr) * SFX_GAIN)[:, None]
    peak = float(np.abs(mix).max())
    mix = limit(mix, sr)
    seg_ = mix[int(t0 * sr):int(t1 * sr)]
    # the sound fades with the picture when a fadeout ends the render (AUDIO_FADE=seconds overrides)
    ends = [o['end'] - o['start'] for o in OVERLAYS if o['kind'] == 'fadeout' and abs(o['end'] - t1) < 1e-3]
    fade = int(min(len(seg_), sr * float(os.environ.get('AUDIO_FADE', ends[-1] if ends else 0))))
    if fade:
        seg_ = seg_.copy()
        seg_[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    out = wave.open(path, 'wb')
    out.setnchannels(ch)
    out.setsampwidth(2)
    out.setframerate(sr)
    out.writeframes((np.clip(seg_, -1, 1) * 32767).astype(np.int16).tobytes())
    out.close()
    print(f'mixed {placed} sound effects (peak before limit {20 * math.log10(max(peak, 1e-9)):.1f} dBFS)')
    return path


def main():
    edl = load_edl()
    if '--still' in sys.argv:
        # render single frames for checking the graphics: --still t1,t2,... (seconds); OUT is a prefix
        for tt in sys.argv[sys.argv.index('--still') + 1].split(','):
            render_frame(float(tt)).save(f'{OUT}_{float(tt):06.2f}.png')
        return
    end = bar(*edl['length']) if 'length' in edl else max(s['end'] for s in SEGMENTS + OVERLAYS)
    t0, t1 = opt('--from', 0.0), opt('--to', end)
    ff = os.environ.get('FFMPEG', 'ffmpeg')
    size = (W // 2, H // 2) if PREVIEW else (W, H)
    audio_in, audio_ss = MUSIC, t0
    if SFX_DIR:
        audio_in, audio_ss = mix_audio(t0, t1, OUT + '.mix.wav'), 0.0
    cmd = [ff, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{size[0]}x{size[1]}', '-r', str(FPS), '-i', '-',
           '-ss', f'{audio_ss:.3f}', '-t', f'{t1 - t0:.3f}', '-i', audio_in,
           '-c:v', 'libx264', '-preset', 'veryfast' if PREVIEW else 'slow', '-crf', '26' if PREVIEW else os.environ.get('CRF', '17'), '-pix_fmt', 'yuv420p',
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
