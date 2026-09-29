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
p.add_argument('--base', action='store_true', help='render the pieces without their icons (space_<type>_base.webp)')
p.add_argument('--only', default='', help='comma-separated space types to re-render')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

SCALE = 2.0
OUT = os.path.join(lib.ROOT, 'art-out', 'spaces')
PUB = os.path.join(lib.ROOT, 'public', 'assets', 'rendered', 'spaces')
os.makedirs(OUT, exist_ok=True)
os.makedirs(PUB, exist_ok=True)

# (side, top, highlight) colours per type — the same families as the UI legend.
TYPES = {
    'gleam': ('#1a44a8', '#3b7cf0', '#9ec2ff'),  # Blue Space
    'festival': ('#b85a16', '#ff9a2e', '#ffc978'),
    'mischief': ('#96202c', '#e63d4d', '#ff9ea6'),  # Bad Luck Space (red)
    'market': ('#a67a18', '#f2c14e', '#ffe39a'),
    'portal': ('#18867b', '#34cdbd', '#9bf2e8'),
    'relic': ('#6f8fb0', '#dcefff', '#ffffff'),
    'event': ('#1e7a36', '#3ec35c', '#a8efb6'),  # Happening Space (green)
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
    if A.base:
        pass  # plain enamel face (shown under a character standing on the space)
    elif kind == 'gleam':
        # a little stack of chips with a plus: "you gain chips" at a glance (no spiral here)
        for k, dy in enumerate([0.16, 0.06, -0.04]):
            cy_ = c + dy * S
            d.ellipse([c - S * 0.2, cy_ - S * 0.075, c + S * 0.2, cy_ + S * 0.085], fill=gold_d)
            d.ellipse([c - S * 0.2, cy_ - S * 0.095, c + S * 0.2, cy_ + S * 0.065], fill=gold, outline=gold_d, width=int(S * 0.01))
        d.rounded_rectangle([c - S * 0.03, c - S * 0.3, c + S * 0.03, c - S * 0.1], radius=int(S * 0.02), fill=(255, 255, 255, 255))
        d.rounded_rectangle([c - S * 0.1, c - S * 0.23, c + S * 0.1, c - S * 0.17], radius=int(S * 0.02), fill=(255, 255, 255, 255))
    elif kind == 'festival':
        star(d, c, c, S * 0.3, S * 0.13, 8, (255, 224, 138, 255), outline=(184, 90, 22, 255), width=int(S * 0.018))
        star(d, c, c, S * 0.14, S * 0.07, 8, (255, 255, 255, 255), rot=-math.pi / 2 + math.pi / 8)
    elif kind == 'mischief':
        # a grumpy storm cloud with a zig-zag bolt
        cloud_c = (74, 44, 120, 255)
        for (dx, dy, r) in [(-0.12, -0.06, 0.13), (0.02, -0.12, 0.15), (0.15, -0.05, 0.12), (0.0, -0.02, 0.14)]:
            d.ellipse([c + (dx - r) * S, c + (dy - r) * S, c + (dx + r) * S, c + (dy + r) * S], fill=cloud_c)
        bolt = [(0.02, 0.02), (-0.08, 0.2), (0.0, 0.2), (-0.06, 0.34), (0.12, 0.13), (0.03, 0.13), (0.1, 0.02)]
        d.polygon([(c + x * S, c + y * S) for (x, y) in bolt], fill=(255, 224, 102, 255), outline=(200, 140, 20, 255))
        for (dx, dy) in [(-0.08, -0.07), (0.08, -0.07)]:
            d.ellipse([c + (dx - 0.022) * S, c + (dy - 0.022) * S, c + (dx + 0.022) * S, c + (dy + 0.022) * S], fill=(255, 255, 255, 255))
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
        # two chasing arrows around a glowing core: "warp"
        d.ellipse([c - S * 0.1, c - S * 0.1, c + S * 0.1, c + S * 0.1], fill=(230, 255, 250, 255))
        wdt = int(S * 0.05)
        for k in range(2):
            a0 = k * 180 + 20
            d.arc([c - S * 0.26, c - S * 0.26, c + S * 0.26, c + S * 0.26], a0, a0 + 130, fill=(255, 255, 255, 255), width=wdt)
            ah = math.radians(a0 + 130)
            tip = (c + math.cos(ah + 0.28) * S * 0.26, c + math.sin(ah + 0.28) * S * 0.26)
            b1 = (c + math.cos(ah) * S * 0.34, c + math.sin(ah) * S * 0.34)
            b2 = (c + math.cos(ah) * S * 0.18, c + math.sin(ah) * S * 0.18)
            d.polygon([tip, b1, b2], fill=(255, 255, 255, 255))
    elif kind == 'relic':
        # the Star Coin: a thick gold coin stamped with a big star
        d.ellipse([c - S * 0.3, c - S * 0.27, c + S * 0.3, c + S * 0.33], fill=gold_d)
        d.ellipse([c - S * 0.3, c - S * 0.31, c + S * 0.3, c + S * 0.29], fill=gold, outline=gold_d, width=int(S * 0.018))
        d.ellipse([c - S * 0.235, c - S * 0.246, c + S * 0.235, c + S * 0.224], outline=(255, 224, 138, 255), width=int(S * 0.014))
        star(d, c, c - S * 0.005, S * 0.2, S * 0.085, 5, (255, 247, 210, 255), outline=gold_d, width=int(S * 0.013))
    elif kind == 'event':
        # a bold white "!" with a soft darker drop, on rose enamel
        for dy, fill in ((S * 0.012, (150, 30, 66, 255)), (0, (255, 255, 255, 255))):
            d.rounded_rectangle([c - S * 0.065, c - S * 0.29 + dy, c + S * 0.065, c + S * 0.08 + dy], radius=int(S * 0.055), fill=fill)
            d.ellipse([c - S * 0.07, c + S * 0.14 + dy, c + S * 0.07, c + S * 0.28 + dy], fill=fill)
    elif kind == 'start':
        d.rounded_rectangle([c - S * 0.16, c - S * 0.3, c - S * 0.12, c + S * 0.28], radius=int(S * 0.02), fill=(255, 244, 220, 255))
        d.polygon([(c - S * 0.12, c - S * 0.3), (c + S * 0.24, c - S * 0.18), (c - S * 0.12, c - S * 0.04)], fill=(255, 107, 94, 255))
        star(d, c + S * 0.02, c - S * 0.17, S * 0.05, S * 0.022, 5, (255, 240, 170, 255))
    im = im.resize((IMG, IMG), Image.LANCZOS)
    path = os.path.join(OUT, f'face_{kind}{"_base" if A.base else ""}.png')
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
    m.bsdf(img.outputs['Color'], 0.24, normal=m.bump(lum.outputs['Val'], 0.2, 0.01), coat=0.85)
    return m.mat


lib.BETA = math.radians(90 - 52)
lib.COSB, lib.SINB = math.cos(lib.BETA), math.sin(lib.BETA)
meta = {'scale': SCALE}
names = A.only.split(',') if A.only else (['gleam'] if A.preview else list(TYPES))
for kind in names:
    side, top, hl = TYPES[kind]
    lib.reset(12 if A.preview else 48)
    props._MATS.clear()  # the factory reset removed the cached prop materials
    lib.world_light(0.8)
    lib.sun(energy=3.6, elevation=40, azimuth=-35, angle=2.5, color='#ffe9c9')
    BX, BY = 200.0, 200.0
    region = (BX - 80, BY - 62, 160, 124)
    lib.camera_for_region(*region, scale=SCALE)
    c = board_to_world(BX, BY, 0.0)
    P = props.Prop(f'space_{kind}')
    # a thin cream bevel lip set into the path (no stone socket: the disc reads as an inlay, and
    # the shadow-catcher floor gives it a soft contact shadow)
    v, f = lib.lathe([(0.575, 0.0), (0.575, 0.03), (0.555, 0.052), (0.525, 0.056), (0.51, 0.05)], 64, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    P.b['paint'].add(v, f, col('#fff4dc'))
    # enamel body: a short coloured side band under the glossy domed face
    v, f = lib.lathe([(0.51, 0.05), (R_TOP + 0.005, 0.07), (R_TOP, 0.078)], 64, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    P.b['paint'].add(v, f, col(side))
    P.build()
    rings = [(R_TOP, 0.078), (R_TOP * 0.8, 0.09), (R_TOP * 0.5, 0.097), (0.0, 0.1)]
    v, f = lib.lathe(rings, 64, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    lib.mesh_object(f'face_{kind}', v, f, smooth=True, material=face_material(f'face_{kind}', icon_texture(kind, top, hl)))
    floor = lib.mesh_object('floor', *lib.lathe([(1.2, 0.0), (0.0, 0.0)], 48, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False), smooth=False,
                            material=lib.simple_mat('floor', '#b8a888'))
    floor.is_shadow_catcher = True
    suffix = '_base' if A.base else ''
    path = os.path.join(OUT, f'space_{kind}{suffix}.png')
    lib.render_to(path)
    im = Image.open(path).convert('RGBA')
    meta['anchor'] = [(BX - region[0]) * SCALE, (BY - region[1]) * SCALE]
    meta['size'] = [im.width, im.height]
    if not A.preview:
        im.save(os.path.join(PUB, f'space_{kind}{suffix}.webp'), 'WEBP', quality=92, method=6)
    print('space', kind, suffix, im.size)
if not A.preview and not A.base:
    with open(os.path.join(PUB, 'spaces.json'), 'w') as fh:
        json.dump(meta, fh)
    print('wrote spaces', meta)
