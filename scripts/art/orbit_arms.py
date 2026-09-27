"""Orbit Dodge sweeping arms, pre-rendered from the arena camera at 64 angles.

    .artenv/bin/python scripts/art/orbit_arms.py [--preview] [--angles 64] [--scale 0.6]

The arena (scenes.py orbit) uses a 25-degree orthographic view centred on (960, 598); the arms are
modelled in the same space and rendered one angle at a time with a shadow-catcher floor, so each
frame carries the arm's soft shadow. Frames are trimmed and packed into a Phaser atlas:
public/assets/rendered/orbit_arms.webp + orbit_arms.json (frame names low_00..low_63, high_00..).
Each frame's sourceSize is the whole screen (scaled), so drawing it at (0, 0) puts it in place.
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
from PIL import Image  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--preview', action='store_true')
p.add_argument('--angles', type=int, default=64)
p.add_argument('--scale', type=float, default=0.6)
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

SW, SH = 1920, 1080
CX, CY = 960, 598          # platform centre (screen px), as in OrbitDodge.ts
REACH = 6.25               # arm length in world units (tip at RX + 120 px)
HIGH_Z = 1.66              # 150 px lift at 25 degrees: 150 / (100 * sin 65)
OUT = os.path.join(lib.ROOT, 'art-out', 'orbit_arms')
os.makedirs(OUT, exist_ok=True)

lib.BETA = math.radians(90 - 25)
lib.COSB, lib.SINB = math.cos(lib.BETA), math.sin(lib.BETA)
sc = lib.reset(8 if A.preview else 24)
lib.world_light(0.85)
lib.sun(energy=3.4, elevation=48, azimuth=-30, angle=3.0)
lib.camera_for_region(0, 0, SW, SH, scale=A.scale)
c = board_to_world(CX, CY, 0.0)

# Shadow-catcher floor matching the platform top (only the arm's shadow shows in the frames).
floor = lib.mesh_object('floor', *lib.lathe([(6.4, 0.0), (0.0, 0.0)], 96, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False), smooth=False,
                        material=lib.simple_mat('floor_mat', '#d8cfc2'))
floor.is_shadow_catcher = True


def build_low():
    """Spiked log lying on the floor: red/yellow hazard bands, brass collars, golden spikes."""
    P = props.Prop('arm_low')
    r = 0.24
    segs = 11
    L = (REACH - 0.4) / segs
    for k in range(segs):
        v, f = lib.cylinder((0, 0, 0), r, r, L, sides=20)
        v = lib.transform(v, loc=(c.x + 0.35 + k * L, c.y, r + 0.02), rot=(0.0, math.pi / 2, 0.0))
        P.b['paint'].add(v, f, col('#d9452a' if k % 2 == 0 else '#ffc93a'))
    for t in (0.2, 0.5, 0.8):
        v, f = lib.cylinder((0, 0, 0), r + 0.03, r + 0.03, 0.12, sides=20)
        v = lib.transform(v, loc=(c.x + 0.35 + (REACH - 0.4) * t, c.y, r + 0.02), rot=(0.0, math.pi / 2, 0.0))
        P.b['metal'].add(v, f, col('#e0a93f'))
    for i in range(7):
        x = c.x + 0.9 + i * 0.78
        for side in (-1, 1):
            v, f = lib.prism((x, c.y + side * 0.1, r * 2 - 0.02), 0.07, 0.34, sides=6, tip=0.05, tilt=(side * 0.35, 0.0))
            P.b['metal'].add(v, f, col('#ffd86b'))
    # end cap knob
    v, f = lib.blob((c.x + REACH - 0.02, c.y, r + 0.02), r * 1.15, rough=0.0, subdiv=2)
    P.b['metal'].add(v, f, col('#e0a93f'))
    return P.build()


def build_high():
    """Raised crystal beam with a spiked orb at the tip (duck under it)."""
    P = props.Prop('arm_high')
    r = 0.15
    segs = 11
    L = (REACH - 0.6) / segs
    for k in range(segs):
        v, f = lib.cylinder((0, 0, 0), r, r, L, sides=16)
        v = lib.transform(v, loc=(c.x + 0.35 + k * L, c.y, HIGH_Z), rot=(0.0, math.pi / 2, 0.0))
        P.b['paint'].add(v, f, col('#6f35c4' if k % 2 == 0 else '#e6d0ff'))
    for t in (0.25, 0.55, 0.85):
        v, f = lib.cylinder((0, 0, 0), r + 0.03, r + 0.03, 0.1, sides=16)
        v = lib.transform(v, loc=(c.x + 0.35 + (REACH - 0.6) * t, c.y, HIGH_Z), rot=(0.0, math.pi / 2, 0.0))
        P.b['metal'].add(v, f, col('#e0a93f'))
    tip = (c.x + REACH - 0.25, c.y, HIGH_Z)
    v, f = lib.blob(tip, 0.36, rough=0.05, subdiv=3)
    P.b['crystal'].add(v, f, col('#8a4fe0'))
    for k in range(12):
        a = k / 12 * math.tau
        el = (k % 3 - 1) * 0.7
        dx, dy, dz = math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)
        v, f = lib.cylinder((0, 0, 0), 0.075, 0.006, 0.3, sides=6)
        v = lib.transform(v, loc=(tip[0] + dx * 0.28, tip[1] + dy * 0.28, tip[2] + dz * 0.28), rot=(-math.asin(dy), math.atan2(dx, dz), 0.0))
        P.b['metal'].add(v, f, col('#ffd86b'))
    return P.build()


def rotate(objs, ang):
    for o in objs:
        o.rotation_euler = (0.0, 0.0, ang)
        o.location = (c.x - (c.x * math.cos(ang) - c.y * math.sin(ang)), c.y - (c.x * math.sin(ang) + c.y * math.cos(ang)), 0.0)


def screen_bbox(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys = [], []
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            w = o.matrix_world @ v.co
            bx, by = lib.world_to_board(w)
            xs.append(bx)
            ys.append(by)
            # its shadow falls on the floor behind/right: include a margin
        ev.to_mesh_clear()
    return min(xs), min(ys), max(xs), max(ys)


low = build_low()
high = build_high()
frames = []
rx, ry = sc.render.resolution_x, sc.render.resolution_y
n = 8 if A.preview else A.angles
for kind, objs in (('low', low), ('high', high)):
    for o in (high if kind == 'low' else low):
        o.hide_render = True
    for o in objs:
        o.hide_render = False
    for i in range(n):
        # Game angle convention: screen position = centre + (cos a * RX, sin a * RY), i.e. +a turns
        # clockwise on screen. World Y points up-screen, so the model turns by -a around Z.
        ang = i / n * math.tau
        rotate(objs, -ang)
        bpy.context.view_layer.update()
        x0, y0, x1, y1 = screen_bbox(objs)
        # shadow margin (sun from front-left: shadows fall right and up on screen)
        x0, y0, x1, y1 = x0 - 30, y0 - 60, x1 + 110, y1 + 40
        px0, px1 = max(0, math.floor(x0 * A.scale)), min(rx, math.ceil(x1 * A.scale))
        py0, py1 = max(0, math.floor(y0 * A.scale)), min(ry, math.ceil(y1 * A.scale))
        sc.render.use_border = True
        sc.render.use_crop_to_border = True
        sc.render.border_min_x, sc.render.border_max_x = px0 / rx, px1 / rx
        sc.render.border_min_y, sc.render.border_max_y = 1 - py1 / ry, 1 - py0 / ry
        path = os.path.join(OUT, f'{kind}_{i:02d}.png')
        lib.render_to(path)
        im = Image.open(path).convert('RGBA')
        bb = im.getchannel('A').getbbox() or (0, 0, 1, 1)
        im = im.crop(bb)
        frames.append((f'{kind}_{i:02d}', im, px0 + bb[0], py0 + bb[1]))
        print('frame', kind, i, im.size)

# Shelf-pack into one atlas.
frames.sort(key=lambda f: -f[1].height)
W = 2048
x = y = shelf = 0
placed = []
for name, im, ox, oy in frames:
    if x + im.width > W:
        x, y, shelf = 0, y + shelf + 2, 0
    placed.append((name, im, ox, oy, x, y))
    x += im.width + 2
    shelf = max(shelf, im.height)
H = y + shelf
atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
out = {'frames': {}, 'meta': {'image': 'orbit_arms.webp', 'size': {'w': W, 'h': H}, 'scale': A.scale}}
for name, im, ox, oy, ax, ay in placed:
    atlas.paste(im, (ax, ay))
    out['frames'][name] = {
        'frame': {'x': ax, 'y': ay, 'w': im.width, 'h': im.height},
        'rotated': False,
        'trimmed': True,
        'spriteSourceSize': {'x': ox, 'y': oy, 'w': im.width, 'h': im.height},
        'sourceSize': {'w': rx, 'h': ry},
    }
if not A.preview:
    pub = os.path.join(lib.ROOT, 'public', 'assets', 'rendered')
    atlas.save(os.path.join(pub, 'orbit_arms.webp'), 'WEBP', quality=90, method=6)
    with open(os.path.join(pub, 'orbit_arms.json'), 'w') as fh:
        json.dump(out, fh)
    print('wrote orbit_arms atlas', W, H, len(placed))
else:
    atlas.save(os.path.join(OUT, 'atlas_preview.png'))
    print('preview atlas', W, H)
