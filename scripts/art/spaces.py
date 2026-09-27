"""Board spaces as small 3D pieces: an enamel disc with a painted icon, set into a stone socket.

    .artenv/bin/python scripts/art/spaces.py [--preview]

Rendered from the board camera (52 degrees) so they share the terrain's perspective instead of
reading as flat stickers. Writes public/assets/rendered/spaces/space_<type>.webp plus
spaces.json ({scale, anchor}) — the anchor is the disc centre inside each image.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
import props  # noqa: E402
from lib import board_to_world, col  # noqa: E402

import bpy  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--preview', action='store_true')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

SCALE = 2.0
OUT = os.path.join(lib.ROOT, 'art-out', 'spaces')
PUB = os.path.join(lib.ROOT, 'public', 'assets', 'rendered', 'spaces')
os.makedirs(OUT, exist_ok=True)
os.makedirs(PUB, exist_ok=True)

# (side, top, highlight) colours per type — the same families as the UI legend.
TYPES = {
    'gleam': ('#197a9d', '#39c7ea', '#8fe7f8'),
    'festival': ('#b85a16', '#ff9a2e', '#ffc978'),
    'mischief': ('#56308c', '#9b5de5', '#c7a0ff'),
    'market': ('#a67a18', '#f2c14e', '#ffe39a'),
    'portal': ('#18867b', '#34cdbd', '#9bf2e8'),
    'relic': ('#6f8fb0', '#dcefff', '#ffffff'),
    'event': ('#8d856f', '#e9e2cf', '#fff9ea'),
    'start': ('#0f6f6b', '#1fa5a0', '#79dcd5'),
}
R_TOP = 0.5
IMG = 512


def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def spiral(d, cx, cy, r0, r1, turns, width, fill):
    pts = []
    for i in range(160):
        t = i / 159
        a = t * turns * math.tau
        r = r0 + (r1 - r0) * t
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    d.line(pts, fill=fill, width=width, joint='curve')


def star(d, cx, cy, r_out, r_in, n, fill, outline=None, width=0, rot=-math.pi / 2):
    pts = []
    for k in range(n * 2):
        r = r_out if k % 2 == 0 else r_in
        a = rot + k * math.pi / n
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    d.polygon(pts, fill=fill, outline=outline, width=width)


def icon_texture(kind, top, hl):
    """Top-down enamel face: base colour, a lighter inner disc, the type's icon (supersampled)."""
    S = IMG * 2
    im = Image.new('RGBA', (S, S), rgb(top) + (255,))
    d = ImageDraw.Draw(im)
    c = S / 2
    d.ellipse([c - S * 0.4, c - S * 0.4, c + S * 0.4, c + S * 0.4], fill=tuple(int(a * 0.55 + b * 0.45) for a, b in zip(rgb(top), rgb(hl))) + (255,))
    d.ellipse([c - S * 0.47, c - S * 0.47, c + S * 0.47, c + S * 0.47], outline=(255, 255, 255, 120), width=int(S * 0.012))
    ink = (43, 35, 64, 255)
    gold, gold_d = (244, 184, 59, 255), (201, 138, 27, 255)
    if kind == 'gleam':
        hexp = [(c + math.cos(math.pi / 6 + k * math.pi / 3) * S * 0.26, c + math.sin(math.pi / 6 + k * math.pi / 3) * S * 0.26) for k in range(6)]
        d.polygon(hexp, fill=gold, outline=gold_d, width=int(S * 0.02))
        spiral(d, c, c, S * 0.015, S * 0.15, 2.3, int(S * 0.035), (17, 122, 119, 255))
    elif kind == 'festival':
        star(d, c, c, S * 0.3, S * 0.13, 8, (255, 224, 138, 255), outline=(184, 90, 22, 255), width=int(S * 0.018))
        star(d, c, c, S * 0.14, S * 0.07, 8, (255, 255, 255, 255), rot=-math.pi / 2 + math.pi / 8)
    elif kind == 'mischief':
        spiral(d, c, c, S * 0.02, S * 0.27, 1.7, int(S * 0.05), (255, 255, 255, 255))
        for (dx, dy, r) in [(0.24, -0.2, 0.05), (-0.26, 0.18, 0.04), (0.22, 0.24, 0.03)]:
            star(d, c + dx * S, c + dy * S, r * S, r * S * 0.4, 4, (255, 240, 170, 255))
    elif kind == 'market':
        # a little shop: striped awning over a counter with a coin
        aw = [(c - S * 0.26, c - S * 0.08), (c + S * 0.26, c - S * 0.08), (c + S * 0.2, c - S * 0.24), (c - S * 0.2, c - S * 0.24)]
        d.polygon(aw, fill=(255, 107, 94, 255))
        for k in range(-2, 3, 2):
            x0 = c + k * S * 0.052
            d.polygon([(x0 - S * 0.05, c - S * 0.08), (x0 + S * 0.05, c - S * 0.08), (x0 + S * 0.04, c - S * 0.24), (x0 - S * 0.04, c - S * 0.24)], fill=(255, 244, 220, 255))
        for k in range(6):
            x0 = c - S * 0.26 + k * S * 0.104
            d.ellipse([x0, c - S * 0.12, x0 + S * 0.104, c - S * 0.04], fill=(255, 107, 94, 255))
        d.rounded_rectangle([c - S * 0.22, c - S * 0.02, c + S * 0.22, c + S * 0.2], radius=int(S * 0.03), fill=(201, 139, 80, 255), outline=ink, width=int(S * 0.01))
        d.ellipse([c - S * 0.09, c + S * 0.0, c + S * 0.09, c + S * 0.18], fill=gold, outline=gold_d, width=int(S * 0.015))
    elif kind == 'portal':
        for k, rr in enumerate([0.3, 0.22, 0.14, 0.07]):
            d.ellipse([c - rr * S, c - rr * S, c + rr * S, c + rr * S], outline=(255, 255, 255, 255) if k % 2 == 0 else (17, 122, 119, 255), width=int(S * 0.035))
    elif kind == 'relic':
        gem = [(c, c - S * 0.3), (c + S * 0.2, c - S * 0.1), (c + S * 0.13, c + S * 0.27), (c - S * 0.13, c + S * 0.27), (c - S * 0.2, c - S * 0.1)]
        d.polygon(gem, fill=(92, 225, 255, 255), outline=(40, 120, 170, 255), width=int(S * 0.018))
        d.polygon([(c, c - S * 0.3), (c + S * 0.2, c - S * 0.1), (c, c - S * 0.02), (c - S * 0.2, c - S * 0.1)], fill=(200, 246, 255, 255))
        d.line([(c, c - S * 0.02), (c, c + S * 0.27)], fill=(40, 120, 170, 255), width=int(S * 0.012))
    elif kind == 'event':
        d.rounded_rectangle([c - S * 0.06, c - S * 0.28, c + S * 0.06, c + S * 0.08], radius=int(S * 0.05), fill=(255, 107, 60, 255))
        d.ellipse([c - S * 0.065, c + S * 0.14, c + S * 0.065, c + S * 0.27], fill=(255, 107, 60, 255))
    elif kind == 'start':
        d.rounded_rectangle([c - S * 0.16, c - S * 0.3, c - S * 0.12, c + S * 0.28], radius=int(S * 0.02), fill=(255, 244, 220, 255))
        d.polygon([(c - S * 0.12, c - S * 0.3), (c + S * 0.24, c - S * 0.18), (c - S * 0.12, c - S * 0.04)], fill=(255, 107, 94, 255))
        star(d, c + S * 0.02, c - S * 0.17, S * 0.05, S * 0.022, 5, (255, 240, 170, 255))
    im = im.resize((IMG, IMG), Image.LANCZOS)
    path = os.path.join(OUT, f'face_{kind}.png')
    im.save(path)
    return path


def face_material(name, img_path):
    m = lib.NT(name)
    tc = m.node('ShaderNodeTexCoord')
    img = m.node('ShaderNodeTexImage')
    img.image = bpy.data.images.load(img_path)
    img.extension = 'EXTEND'
    img.interpolation = 'Cubic'
    m.link(tc.outputs['Generated'], img.inputs['Vector'])
    lum = m.node('ShaderNodeRGBToBW')
    m.link(img.outputs['Color'], lum.inputs['Color'])
    m.bsdf(img.outputs['Color'], 0.32, normal=m.bump(lum.outputs['Val'], 0.25, 0.01), coat=0.45)
    return m.mat


lib.BETA = math.radians(90 - 52)
lib.COSB, lib.SINB = math.cos(lib.BETA), math.sin(lib.BETA)
meta = {'scale': SCALE}
names = ['gleam'] if A.preview else list(TYPES)
for kind in names:
    side, top, hl = TYPES[kind]
    lib.reset(12 if A.preview else 48)
    lib.world_light(0.8)
    lib.sun(energy=3.6, elevation=40, azimuth=-35, angle=2.5, color='#ffe9c9')
    BX, BY = 200.0, 200.0
    region = (BX - 80, BY - 62, 160, 124)
    lib.camera_for_region(*region, scale=SCALE)
    c = board_to_world(BX, BY, 0.0)
    P = props.Prop(f'space_{kind}')
    # stone socket sitting on the ground (a shadow-catcher floor shows its contact shadow)
    v, f = lib.lathe([(0.66, 0.0), (0.66, 0.05), (0.62, 0.075), (0.555, 0.075), (0.54, 0.05)], 48, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    P.b['stone'].add(v, f, col('#e6dccb'))
    # enamel body: coloured side band, domed top (separate object so it can carry the icon)
    v, f = lib.lathe([(0.54, 0.02), (R_TOP + 0.02, 0.1), (R_TOP, 0.12)], 48, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    P.b['paint'].add(v, f, col(side))
    P.build()
    rings = [(R_TOP, 0.12), (R_TOP * 0.8, 0.135), (R_TOP * 0.5, 0.143), (0.0, 0.146)]
    v, f = lib.lathe(rings, 64, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    lib.mesh_object(f'face_{kind}', v, f, smooth=True, material=face_material(f'face_{kind}', icon_texture(kind, top, hl)))
    floor = lib.mesh_object('floor', *lib.lathe([(1.2, 0.0), (0.0, 0.0)], 48, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False), smooth=False,
                            material=lib.simple_mat('floor', '#b8a888'))
    floor.is_shadow_catcher = True
    path = os.path.join(OUT, f'space_{kind}.png')
    lib.render_to(path)
    im = Image.open(path).convert('RGBA')
    meta['anchor'] = [(BX - region[0]) * SCALE, (BY - region[1]) * SCALE]
    meta['size'] = [im.width, im.height]
    if not A.preview:
        im.save(os.path.join(PUB, f'space_{kind}.webp'), 'WEBP', quality=92, method=6)
    print('space', kind, im.size)
if not A.preview:
    with open(os.path.join(PUB, 'spaces.json'), 'w') as fh:
        json.dump(meta, fh)
    print('wrote spaces', meta)
