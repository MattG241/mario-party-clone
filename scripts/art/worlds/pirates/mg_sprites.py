"""Sprite atlases for the three Pirate Cove minigames (transparent renders, packed per game).

    bpyenv/bin/python scripts/art/worlds/pirates/mg_sprites.py [snatch|slash|storm|all] [--preview]
    python3 scripts/build-lite.py --image mg/pirates_snatch.webp mg/pirates_slash.webp mg/pirates_storm.webp

Writes public/assets/rendered/mg/pirates_<game>.webp + .json (Phaser JSON-hash atlas; every frame keeps
its full render canvas as sourceSize, so a sprite's origin 0.5, 0.5 is its anchor: the point where it
touches the table / chute / water). Each group is lit and viewed like its arena:
  snatch  ortho 50 deg, 100 px per unit (the deck): table top (straight down), food, the octopus cook,
          rolling pin, gull frames
  slash   ortho 25 deg (the harbour camera's view of the cut line), 300 px per metre: barrel and golden
          barrel roll frames, crate tumble frames, flying fish, bomb
  storm   ortho 55 deg, 100 px per unit (the bay): the dinghy at 16 headings, treasure, weather vane,
          and the whirlpool (generated, not rendered)
"""
from __future__ import annotations

import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import mg_kit as K  # noqa: E402
from mg_kit import col  # noqa: E402

import lib  # noqa: E402
import mg_dress as dress  # noqa: E402
import props  # noqa: E402
from lib import MeshBuilder  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

A = K.parse(['snatch', 'slash', 'storm', 'all'])
MG = os.path.join(K.PUB, 'mg')
TMP = os.path.join(K.OUT, 'sprites')
os.makedirs(MG, exist_ok=True)
os.makedirs(TMP, exist_ok=True)


# ------------------------------------------------------------------------------------------
# Scene per sprite
def fresh(light):
    K.start(8 if A.preview else 20)
    sc = bpy.context.scene
    sc.render.film_transparent = True
    sc.view_settings.exposure = -0.1
    light()


def ortho_cam(elev, canvas, ppu, target=(0.0, 0.0, 0.0)):
    """Ortho camera looking at `target` from `elev` degrees above the horizon (from -Y), so that
    `ppu` pixels = 1 unit and the target lands in the centre of a canvas x canvas (w, h) render."""
    sc = bpy.context.scene
    w, h = canvas
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.sensor_fit = 'HORIZONTAL' if w >= h else 'VERTICAL'
    cd.ortho_scale = max(w, h) / ppu
    cd.clip_start = 0.05
    cd.clip_end = 300.0
    ob = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(ob)
    sc.camera = ob
    e = math.radians(elev)
    fwd = Vector((0.0, math.cos(e), -math.sin(e)))
    ob.location = Vector(target) - fwd * 60.0
    ob.rotation_euler = (math.radians(90.0 - elev), 0.0, 0.0)
    k = 0.5 if A.preview else 1.0
    sc.render.resolution_x = int(w * k)
    sc.render.resolution_y = int(h * k)
    return ob


def render(name):
    path = os.path.join(TMP, f'{name}.png')
    if A.dry:
        print('dry:', name, len(bpy.data.objects), 'objects')
        return None
    lib.render_to(path)
    return path


def deck_light():
    dress.festival_light(key=3.4, elev=46, az=-38, fill=0.85, angle=3.0, key_col='#ffe3ba', zenith='#8cc6ff', horizon='#ffe8c8')


def harbour_light():
    lib.world_light(0.9, zenith='#8fb8f0', horizon='#ffd9b0', ground='#b09a80')
    lib.sun(energy=3.3, elevation=26, azimuth=28, angle=3.0, color='#ffd8a4')


def storm_light():
    lib.world_light(1.15, zenith='#9aaec6', horizon='#b4c0cc', ground='#5a646e')
    lib.sun(energy=1.8, elevation=58, azimuth=-20, angle=8.0, color='#dde8f4')


def gloss():
    return K.m()['glossy']


# ------------------------------------------------------------------------------------------
# Stretch & Snatch
def food_apple(mb, leaf):
    v, f = lib.lathe([(0.0, 0.0), (0.2, 0.03), (0.3, 0.14), (0.31, 0.3), (0.24, 0.44), (0.1, 0.47), (0.0, 0.42)], 24, (0, 0, 0))
    mb.add(v, f, lambda vv: col('#d8302a') if vv[0] * 0.6 + vv[2] < 0.36 else col('#ee5a3a'))
    v, f = lib.tube([(0, 0, 0.4), (0.03, 0, 0.56)], 0.022, 6)
    mb.add(v, f, col('#6b4428'))
    leaf.add([(0.03, 0, 0.52), (0.2, -0.02, 0.62), (0.26, 0.0, 0.55), (0.1, 0.02, 0.5)], [(0, 1, 2, 3), (3, 2, 1, 0)], col('#5dbb3a'))


def food_orange(mb, leaf):
    v, f = lib.blob((0, 0, 0.27), 0.28, squash=(1.0, 1.0, 0.94), rough=0.03, freq=6.0, subdiv=3)
    mb.add(v, f, col('#ff9a1c'))
    v, f = lib.blob((0, 0, 0.53), 0.04, rough=0.0, subdiv=1)
    mb.add(v, f, col('#5a7a22'))
    leaf.add([(0.02, 0, 0.54), (0.18, 0.05, 0.6), (0.22, 0.02, 0.54)], [(0, 1, 2), (2, 1, 0)], col('#4fa832'))


def food_grapes(mb, leaf):
    rnd = random.Random(4)
    for k in range(16):
        layer = k // 6
        a = k * 2.4
        r = 0.16 - layer * 0.05
        v, f = lib.blob((math.cos(a) * r, math.sin(a) * r * 0.8, 0.12 + layer * 0.14 + rnd.uniform(-0.02, 0.02)), 0.1, rough=0.0, subdiv=2)
        mb.add(v, f, col(rnd.choice(['#7b3fb0', '#8e4cc4', '#6a33a0'])))
    v, f = lib.tube([(0, 0, 0.42), (0.02, 0.0, 0.58)], 0.02, 6)
    mb.add(v, f, col('#6b4428'))
    leaf.add([(0.0, 0, 0.5), (0.24, -0.04, 0.6), (0.3, 0.0, 0.46), (0.1, 0.02, 0.44)], [(0, 1, 2, 3), (3, 2, 1, 0)], col('#5dbb3a'))


def food_banana(mb, leaf):
    for k in range(3):
        pts = []
        for i in range(11):
            t = i / 10
            a = -0.9 + 1.8 * t
            pts.append((math.sin(a) * 0.34, -0.06 + k * 0.08, 0.08 + (1 - math.cos(a)) * 0.2 + k * 0.05))
        v, f = lib.tube(pts, lambda t: 0.035 + 0.055 * math.sin(math.pi * min(1.0, t * 1.05)), 10)
        mb.add(v, f, col('#f5d33a'))
    v, f = lib.cylinder((0.33, 0.02, 0.36), 0.03, 0.025, 0.08, 6)
    mb.add(v, f, col('#5a4422'))


def food_pineapple(mb, leaf):
    """A pineapple: a squat golden body with a criss-cross of scales and a spiky green crown."""
    v, f = lib.lathe([(0.0, 0.0), (0.16, 0.02), (0.22, 0.12), (0.23, 0.26), (0.19, 0.4), (0.1, 0.46), (0.0, 0.47)], 24, (0, 0, 0))

    def scales(vv):
        a = math.atan2(vv[1], vv[0])
        k = int((a + math.pi) / math.tau * 12 + vv[2] * 14) + int((a + math.pi) / math.tau * 12 - vv[2] * 14)
        return col('#e7a526') if k % 2 else col('#c98218')
    mb.add(v, f, scales)
    for k in range(9):
        a = k / 9 * math.tau
        tilt = 0.18 if k % 2 else 0.1
        pts = [(math.cos(a) * 0.03, math.sin(a) * 0.03, 0.44), (math.cos(a) * tilt, math.sin(a) * tilt, 0.72 - (k % 2) * 0.08)]
        v, f = lib.tube(pts, lambda t: 0.045 * (1 - t) + 0.005, 6)
        leaf.add(v, f, col('#3f9a3a' if k % 2 else '#5dbb3a'))


def food_melon(mb, leaf):
    """A fat watermelon wedge: green rind, pale band, red flesh with seeds."""
    R, W = 0.36, 0.2
    verts, faces, cols = [], [], []
    n = 12
    for i in range(n + 1):
        a = math.pi * i / n
        for (r, c) in [(R, '#3e9a3a'), (R * 0.9, '#d8f0a8'), (R * 0.84, '#ef4a4a')]:
            verts.append((math.cos(a) * r, -W / 2, math.sin(a) * r * 1.0))
            cols.append(col(c))
    # back face copy
    off = len(verts)
    for i in range(off):
        x, y, z = verts[i]
        verts.append((x, W / 2, z))
        cols.append(cols[i])
    for i in range(n):
        a0, a1 = i * 3, (i + 1) * 3
        faces.append((a0, a1, off + a1, off + a0))  # rind outer
        faces.append((a0 + 2, a1 + 2, a1 + 1, a0 + 1))
        faces.append((off + a0 + 2, off + a0 + 1, off + a1 + 1, off + a1 + 2))
    centre_f = len(verts)
    verts += [(0, -W / 2, 0.0), (0, W / 2, 0.0)]
    cols += [col('#ef4a4a'), col('#ef4a4a')]
    for i in range(n):
        faces.append((centre_f, i * 3 + 2, (i + 1) * 3 + 2))
        faces.append((centre_f + 1, off + (i + 1) * 3 + 2, off + i * 3 + 2))
    base = len(mb.v)
    mb.v.extend(verts)
    mb.f.extend([tuple(j + base for j in fc) for fc in faces])
    mb.c.extend(cols)
    for k in range(7):
        a = 0.35 + k * 0.35
        v, f = lib.blob((math.cos(a) * 0.2, -W / 2 - 0.01, math.sin(a) * 0.2), 0.025, squash=(1, 0.4, 1.4), rough=0.0, subdiv=1)
        mb.add(v, f, col('#2a1a14'))


def food_meat(mb, leaf):
    """A cartoon drumstick: a big glossy meat bulb on a white bone with a knobbly end."""
    v, f = lib.blob((-0.08, 0, 0.24), 0.26, squash=(1.25, 1.0, 0.9), rough=0.08, subdiv=3, seed=3)
    mb.add(v, f, lambda vv: col('#b5602a') if vv[2] > 0.3 else col('#8f4520'))
    v, f = lib.tube([(0.12, 0, 0.22), (0.4, 0, 0.3)], 0.055, 10)
    mb.add(v, f, col('#f5eedc'))
    for dy in (-0.05, 0.05):
        v, f = lib.blob((0.42, dy, 0.31), 0.07, rough=0.0, subdiv=2)
        mb.add(v, f, col('#fbf6ea'))


def food_roast(mb, leaf):
    """The golden roast: a plump glazed roast bird, drumsticks up with paper frills, on a gold platter
    ringed with garnish."""
    v, f = lib.lathe([(0.0, 0.0), (0.46, 0.0), (0.52, 0.03), (0.52, 0.07), (0.44, 0.06), (0.0, 0.06)], 32, (0, 0, 0))
    mb.add(v, f, col('#f2c14e'))
    v, f = lib.blob((-0.04, 0, 0.24), 0.3, squash=(1.3, 1.02, 0.78), rough=0.05, subdiv=3, seed=9)
    mb.add(v, f, lambda vv: col('#f0a43a') if vv[2] > 0.34 else col('#cf7a22'))
    for s in (-1, 1):
        v, f = lib.blob((0.2, s * 0.17, 0.26), 0.13, squash=(1.2, 0.9, 1.0), rough=0.05, subdiv=2)
        mb.add(v, f, col('#e08a2a'))
        v, f = lib.tube([(0.26, s * 0.18, 0.32), (0.36, s * 0.2, 0.5)], 0.04, 8)
        mb.add(v, f, col('#fbf6ea'))
        v, f = lib.lathe([(0.05, 0.0), (0.075, 0.04), (0.06, 0.08), (0.0, 0.09)], 10, (0.37, s * 0.2, 0.5))
        mb.add(v, f, col('#ffffff'))
    for k in range(10):
        a = k / 10 * math.tau
        v, f = lib.blob((math.cos(a) * 0.42, math.sin(a) * 0.42, 0.08), 0.055, rough=0.1, subdiv=1)
        leaf.add(v, f, col('#5dbb3a' if k % 2 else '#e84b3c'))


FOODS = {'apple': food_apple, 'orange': food_orange, 'grapes': food_grapes, 'banana': food_banana, 'pineapple': food_pineapple, 'meat': food_meat, 'roast': food_roast}


def octopus_cook(expr):
    """An original ship's cook: a round coral octopus with a tall chef's hat, a neckerchief and
    curling tentacles. expr: idle | shout | happy (eyes, mouth and tentacle pose change)."""
    body, dark, white, glowm = MeshBuilder(), MeshBuilder(), MeshBuilder(), MeshBuilder()
    skin = '#f07a5a'
    v, f = lib.blob((0, 0, 1.25), 0.62, squash=(1.0, 0.92, 1.05), rough=0.03, subdiv=3, seed=2)
    body.add(v, f, lambda vv: col('#f59878') if vv[1] < -0.3 and vv[2] > 1.2 else col(skin))
    # tentacles: eight curling tubes round the base
    rnd = random.Random(8)
    for k in range(8):
        a = k / 8 * math.tau + 0.2
        pts = []
        lift = 0.0
        if expr == 'shout' and k in (1, 6):
            lift = 0.9
        if expr == 'happy' and k in (2, 5):
            lift = 0.6
        for i in range(12):
            t = i / 11
            r = 0.35 + t * 0.7
            curl = t * t * 1.6
            pts.append((math.cos(a + curl * 0.4) * r, math.sin(a + curl * 0.4) * r * 0.9, max(0.06, 0.75 - t * 0.75 + lift * t * 1.2 + 0.18 * math.sin(t * math.pi * 2 + k))))
        v, f = lib.tube(pts, lambda t: 0.16 * (1 - t) + 0.04, 10)
        body.add(v, f, col(skin))
        for i in range(2, 11, 2):
            p = Vector(pts[i])
            v, f = lib.blob((p.x, p.y, p.z - 0.08), 0.035 * (1.2 - i / 12), rough=0.0, subdiv=1)
            white.add(v, f, col('#ffd7c4'))
    # face: eyes, brows, mouth
    for s in (-1, 1):
        v, f = lib.blob((s * 0.2, -0.54, 1.35), 0.13, squash=(1.0, 0.5, 1.2), rough=0.0, subdiv=2)
        white.add(v, f, col('#ffffff'))
        v, f = lib.blob((s * 0.19, -0.6, 1.33 if expr != 'happy' else 1.36), 0.065, squash=(1.0, 0.5, 1.1), rough=0.0, subdiv=2)
        dark.add(v, f, col('#1d1720'))
        brow_z = 1.55 if expr != 'shout' else 1.5
        tilt = 0.06 if expr == 'shout' else -0.02
        v, f = lib.tube([(s * 0.08, -0.6, brow_z - (tilt if s < 0 else -tilt) * -1), (s * 0.3, -0.56, brow_z + tilt)], 0.03, 6)
        dark.add(v, f, col('#6a2a20'))
    if expr == 'shout':
        v, f = lib.blob((0, -0.58, 1.06), 0.13, squash=(1.3, 0.4, 1.0), rough=0.0, subdiv=2)
        dark.add(v, f, col('#5a1a1a'))
    else:
        pts = [(math.sin(a) * 0.18, -0.6 + abs(math.sin(a)) * 0.04, 1.12 - math.cos(a) * 0.07) for a in [(-1.2 + 2.4 * i / 10) for i in range(11)]]
        v, f = lib.tube(pts, 0.025, 6)
        dark.add(v, f, col('#6a2020'))
    for s in (-1, 1):
        v, f = lib.blob((s * 0.34, -0.5, 1.18), 0.07, squash=(1, 0.4, 0.7), rough=0.0, subdiv=1)
        body.add(v, f, col('#ff9a9a'))
    # neckerchief and chef's hat
    v, f = lib.lathe([(0.56, 0.0), (0.6, 0.06), (0.56, 0.12)], 24, (0, 0, 0.82))
    white.add(v, f, col('#3fa7d6'))
    v, f = lib.cylinder((0, 0, 1.72), 0.36, 0.4, 0.28, 24)
    white.add(v, f, col('#fbfaf6'))
    for k in range(6):
        a = k / 6 * math.tau
        v, f = lib.blob((math.cos(a) * 0.22, math.sin(a) * 0.2, 2.2), 0.24, rough=0.05, subdiv=2, seed=k)
        white.add(v, f, col('#ffffff'))
    v, f = lib.blob((0, 0, 2.3), 0.28, rough=0.05, subdiv=2)
    white.add(v, f, col('#ffffff'))
    body.build('octo', gloss())
    dark.build('octo_dark', gloss())
    white.build('octo_white', K.m()['cloth'])
    glowm.build('octo_glow', props.mats()['glow'])


def rolling_pin():
    mb = MeshBuilder()
    v, f = lib.cylinder((-0.36, 0, 0), 0.13, 0.13, 0.72, 20)
    v = [(z, y, x) for (x, y, z) in v]
    mb.add(v, f, col('#e6b87a'))
    for s in (-1, 1):
        v, f = lib.cylinder((0, 0, 0), 0.045, 0.045, 0.22, 10)
        v = [(s * (0.36 + z), y, x) for (x, y, z) in v]
        mb.add(v, f, col('#b0763c'))
        v, f = lib.blob((s * 0.6, 0, 0), 0.06, rough=0.0, subdiv=1)
        mb.add(v, f, col('#b0763c'))
    mb.build('pin', props.mats()['wood'])


def gull(frame):
    """A round cartoon gull seen from above-front: white body, grey wings (up / level / down),
    a yellow beak with a red dot, black wing tips."""
    body, dark = MeshBuilder(), MeshBuilder()
    v, f = lib.blob((0, 0, 0), 0.22, squash=(1.0, 1.5, 0.9), rough=0.0, subdiv=3)
    body.add(v, f, col('#fbfbf8'))
    v, f = lib.blob((0, -0.3, 0.08), 0.13, rough=0.0, subdiv=2)
    body.add(v, f, col('#ffffff'))
    v, f = lib.lathe([(0.05, 0.0), (0.0, 0.14)], 8, (0, 0, 0))
    v = [(x, -0.4 - z, 0.06 + y) for (x, y, z) in v]
    dark.add(v, f, col('#f5c030'))
    for s in (-1, 1):
        v, f = lib.blob((s * 0.06, -0.38, 0.14), 0.025, rough=0.0, subdiv=1)
        dark.add(v, f, col('#1d1720'))
    lift = {0: 0.5, 1: 0.05, 2: -0.35}[frame]
    for s in (-1, 1):
        pts = [(s * 0.12, 0.0, 0.04), (s * 0.4, 0.05, 0.04 + lift * 0.45), (s * 0.7, 0.12, 0.04 + lift)]
        verts = []
        for i, p in enumerate(pts):
            w = 0.2 - i * 0.05
            verts += [(p[0], p[1] - w, p[2]), (p[0], p[1] + w, p[2])]
        faces = [(0, 2, 3, 1), (2, 4, 5, 3)]
        faces += [tuple(reversed(fc)) for fc in faces]
        body.add(verts, faces, lambda vv: col('#2a2a30') if abs(vv[0]) > 0.6 else col('#a9b2bd'))
    v, f = lib.blob((0, 0.34, -0.02), 0.1, squash=(1.3, 1.0, 0.4), rough=0.0, subdiv=1)
    body.add(v, f, col('#c9d0d8'))
    body.build('gull', K.m()['cloth'])
    dark.build('gull_beak', gloss())


def snatch_sprites():
    frames = {}
    # the table top, straight down (the game spins it, squashed to the deck's 50 degree view)
    fresh(deck_light)
    ortho_cam(89.9, (600, 600), 100.0)
    tex = K.table_texture(os.path.join(K.OUT, 'table_top.png'))
    K.disc_uv_object('table_top', (0, 0, 0), 2.9, K.image_material('table_top_mat', tex, rough=0.55))
    frames['table'] = render('snatch_table')
    for name, fn in FOODS.items():
        fresh(deck_light)
        ortho_cam(50.0, (180, 200), 100.0, target=(0, 0, 0.0))
        mb, leaf = MeshBuilder(), MeshBuilder()
        fn(mb, leaf)
        mb.build(name, gloss())
        leaf.build(name + '_leaf', K.m()['leaf'])
        frames[name] = render(f'snatch_{name}')
    for expr in ('idle', 'shout', 'happy'):
        fresh(deck_light)
        ortho_cam(50.0, (360, 560), 100.0, target=(0, 0, 0.0))
        octopus_cook(expr)
        frames[f'cook_{expr}'] = render(f'snatch_cook_{expr}')
    fresh(deck_light)
    ortho_cam(50.0, (180, 90), 100.0)
    rolling_pin()
    frames['pin'] = render('snatch_pin')
    for fr in range(3):
        fresh(deck_light)
        ortho_cam(50.0, (180, 150), 100.0)
        gull(fr)
        frames[f'gull_{fr}'] = render(f'snatch_gull_{fr}')
    return frames


# ------------------------------------------------------------------------------------------
# Triple Slash
def barrel_roll(golden, angle):
    wood, metal = MeshBuilder(), MeshBuilder()
    r, h = 0.3, 0.62
    # lying along X, rolling about X by `angle`
    K.barrel(wood, metal, 0, 0, 0, r=r, h=h, rot=(0.0, 0.0, 0.0), tint='#b8783f' if not golden else '#c98a3a', hoop='#50525a' if not golden else '#ffd24a', staves=12)
    for mb in (wood, metal):
        out = []
        for (x, y, z) in mb.v:
            z -= h / 2
            # stand -> lie along X, then roll about X
            x2, y2, z2 = z, y, -x
            ca, sa = math.cos(angle), math.sin(angle)
            y3 = y2 * ca - z2 * sa
            z3 = y2 * sa + z2 * ca
            out.append((x2, y3, z3 + r))
        mb.v = out
    wood.build('barrel', props.mats()['wood'])
    metal.build('hoops', props.mats()['metal'] if golden else K.m()['iron'])


def crate_tumble(angle):
    mb = MeshBuilder()
    K.crate(mb, 0, 0, -0.29, s=0.58, rot=0.0)
    out = []
    ca, sa = math.cos(angle), math.sin(angle)
    for (x, y, z) in mb.v:
        y2 = y * ca - z * sa
        z2 = y * sa + z * ca
        out.append((x, y2, z2 + 0.29 * (abs(ca) + abs(sa))))
    mb.v = out
    mb.build('crate', props.mats()['wood'])


def flying_fish(frame):
    """A chubby flying fish (turquoise back, silver belly) with wide wing fins, heading toward the
    camera and a little to the left."""
    body, fins, dark = MeshBuilder(), MeshBuilder(), MeshBuilder()
    v, f = lib.blob((0, 0, 0), 0.2, squash=(0.8, 1.9, 0.85), rough=0.0, subdiv=3)
    body.add(v, f, lambda vv: col('#2bb3c8') if vv[2] > -0.02 else col('#dfeef2'))
    tail = [(0, 0.34, 0.0), (0.16, 0.6, 0.12), (0.0, 0.52, 0.0), (-0.16, 0.6, 0.12)]
    fins.add(tail, [(0, 1, 2), (0, 2, 3), (2, 1, 0), (3, 2, 0)], col('#1f8fa8'))
    lift = 0.22 if frame == 0 else -0.08
    for s in (-1, 1):
        wing = [(s * 0.12, -0.12, 0.02), (s * 0.62, 0.02, 0.02 + lift), (s * 0.58, 0.26, lift * 0.6), (s * 0.12, 0.12, 0.0)]
        fins.add(wing, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#7fe0ee'))
        v, f = lib.blob((s * 0.1, -0.26, 0.07), 0.045, rough=0.0, subdiv=1)
        dark.add(v, f, col('#ffffff'))
        v, f = lib.blob((s * 0.11, -0.29, 0.075), 0.024, rough=0.0, subdiv=1)
        dark.add(v, f, col('#1d1720'))
    for mb in (body, fins, dark):
        mb.v = lib.transform(mb.v, rot=(0.0, 0.0, math.radians(-20)))
    body.build('fish', gloss())
    fins.build('fins', K.m()['cloth'])
    dark.build('eyes', gloss())


def bomb():
    body, fuse, glow = MeshBuilder(), MeshBuilder(), MeshBuilder()
    v, f = lib.blob((0, 0, 0.27), 0.27, rough=0.0, subdiv=3)
    body.add(v, f, col('#2a2c34'))
    v, f = lib.cylinder((0, 0, 0.5), 0.09, 0.09, 0.08, 14)
    body.add(v, f, col('#4a4d58'))
    v, f = lib.tube([(0, 0, 0.56), (0.05, 0.0, 0.66), (0.12, 0.02, 0.7)], 0.02, 6)
    fuse.add(v, f, col('#c9a06a'))
    v, f = lib.blob((-0.1, -0.2, 0.38), 0.05, squash=(1, 0.5, 1.4), rough=0.0, subdiv=1)
    glow.add(v, f, col('#ffffff'))
    bm = lib.NT('bomb_black')
    bb = bm.bsdf(bm.mult(bm.attr('col'), bm.mix(bm.ao(0.3, 6), col('#50505a'), col('#ffffff'))), 0.32, coat=0.5, spec=0.5)
    del bb
    body.build('bomb', bm.mat)
    fuse.build('fuse', K.m()['rope'])
    glow.build('shine', K.m()['cloth'])


def slash_sprites():
    frames = {}
    for golden in (False, True):
        for k in range(8):
            fresh(harbour_light)
            ortho_cam(25.0, (230, 420), 300.0)
            barrel_roll(golden, k / 8 * math.tau / 3)
            frames[f"{'gold' if golden else 'barrel'}_{k}"] = render(f"slash_{'gold' if golden else 'barrel'}_{k}")
    for k in range(4):
        fresh(harbour_light)
        ortho_cam(25.0, (260, 440), 300.0)
        crate_tumble(k / 4 * math.pi / 2)
        frames[f'crate_{k}'] = render(f'slash_crate_{k}')
    for k in range(2):
        fresh(harbour_light)
        ortho_cam(25.0, (300, 260), 300.0)
        flying_fish(k)
        frames[f'fish_{k}'] = render(f'slash_fish_{k}')
    fresh(harbour_light)
    ortho_cam(25.0, (230, 480), 300.0)
    bomb()
    frames['bomb'] = render('slash_bomb')
    return frames


# ------------------------------------------------------------------------------------------
# Storm Navigator
MAST_TOP = 1.95
MAST_FOOT = 0.18


def dinghy(heading_deg):
    """A little sailing dinghy: clinker hull, thwart seats, a mast (the game draws the sail in the
    player's colour), rotated to face `heading_deg` (0 = screen right, 90 = toward the camera)."""
    hull, trim, metal = MeshBuilder(), MeshBuilder(), MeshBuilder()
    L, B = 0.7, 0.3
    verts, faces, cols = [], [], []
    st = 16
    prof = [(0.0, -0.08), (0.55, -0.04), (0.9, 0.06), (1.0, 0.2)]
    for i in range(st + 1):
        u = -1 + 2 * i / st
        b = B * max(0.0, 1 - abs(u) ** (2.2 if u > 0 else 5)) ** 0.6
        for s in (-1, 1):
            for (py, pz) in prof:
                verts.append((u * L, s * py * b, pz + 0.05 * u * u))
                cols.append(col('#9a5a32') if pz > 0.1 else col('#7a4428'))
    rows = len(prof)
    per = rows * 2
    for i in range(st):
        for s in range(2):
            for j in range(rows - 1):
                a = i * per + s * rows + j
                b = a + per
                faces.append((a, b, b + 1, a + 1) if s == 0 else (a, a + 1, b + 1, b))
    base = len(hull.v)
    hull.v.extend(verts)
    hull.f.extend([tuple(x + base for x in fc) for fc in faces])
    hull.c.extend(cols)
    # inner floor and thwarts
    v, f = lib.box((0, 0, 0.02), (1.1, 0.4, 0.03))
    trim.add(v, f, col('#c8935a'))
    for x in (-0.3, 0.25):
        v, f = lib.box((x, 0, 0.14), (0.1, 0.52, 0.04))
        trim.add(v, f, col('#d9a468'))
    # gunwale band in cream
    v, f = lib.box((0, 0, 0.21), (0.02, 0.02, 0.02))
    trim.add(v, f, col('#f1e3c2'))
    # mast
    v, f = lib.cylinder((0.12, 0, MAST_FOOT), 0.03, 0.022, MAST_TOP - MAST_FOOT, 8)
    trim.add(v, f, col('#6b4428'))
    v, f = lib.blob((0.12, 0, MAST_TOP + 0.02), 0.035, rough=0.0, subdiv=1)
    metal.add(v, f, col('#f2c14e'))
    a = math.radians(-heading_deg)
    for mb in (hull, trim, metal):
        mb.v = lib.transform(mb.v, rot=(0.0, 0.0, a))
    hull.build('dinghy', props.mats()['wood'])
    trim.build('dinghy_trim', props.mats()['wood'])
    metal.build('dinghy_metal', props.mats()['metal'])


def treasure(kind):
    wood, metal, glowm = MeshBuilder(), MeshBuilder(), MeshBuilder()
    if kind == 'pouch':
        v, f = lib.blob((0, 0, 0.18), 0.22, squash=(1.0, 1.0, 0.9), rough=0.12, subdiv=2, seed=4)
        wood.add(v, f, col('#c0925a'))
        v, f = lib.lathe([(0.08, 0.0), (0.05, 0.06), (0.1, 0.14), (0.0, 0.16)], 10, (0, 0, 0.36))
        wood.add(v, f, col('#a8783e'))
        for k in range(5):
            a = k / 5 * math.tau
            v, f = lib.cylinder((math.cos(a) * 0.16, math.sin(a) * 0.1 - 0.12, 0.3 + (k % 2) * 0.03), 0.07, 0.07, 0.02, 12)
            metal.add(v, f, col('#ffd24a'))
    else:
        gold = kind == 'goldchest'
        body = '#c9962f' if gold else '#8a4a26'
        band = '#fff0a0' if gold else '#d8a441'
        v, f = lib.box((0, 0, 0.14), (0.56, 0.38, 0.28))
        wood.add(v, f, col(body))
        lid = lib.cylinder((0, 0, 0), 0.19, 0.19, 0.56, 16)
        lv = [(z - 0.28, y, x * 0.8 + 0.28) for (x, y, z) in lid[0]]
        lv = [(x, y, z) for (x, y, z) in lv]
        wood.add([(x, y, max(0.28, z)) for (x, y, z) in lv], lid[1], col(body))
        for dx in (-0.2, 0.2):
            v, f = lib.box((dx, 0, 0.2), (0.05, 0.4, 0.42))
            metal.add(v, f, col(band))
        v, f = lib.box((0, -0.2, 0.3), (0.1, 0.03, 0.12))
        metal.add(v, f, col(band))
        if gold:
            for k in range(6):
                a = k / 6 * math.tau
                v, f = lib.blob((math.cos(a) * 0.12, math.sin(a) * 0.08, 0.5), 0.05, rough=0.0, subdiv=1)
                glowm.add(v, f, col('#fff6c0'))
    wood.build('t_wood', props.mats()['wood'] if kind != 'pouch' else K.m()['cloth'])
    metal.build('t_metal', props.mats()['metal'])
    glowm.build('t_glow', props.mats()['glow'])


def vane():
    """A brass weather vane arrow, seen straight down: a fish-tailed arrow pointing along +X."""
    mb = MeshBuilder()
    pts = [(0.9, 0.0), (0.55, 0.22), (0.55, 0.08), (-0.55, 0.08), (-0.8, 0.3), (-0.7, 0.0), (-0.8, -0.3), (-0.55, -0.08), (0.55, -0.08), (0.55, -0.22)]
    top = [(x, y, 0.05) for (x, y) in pts]
    bot = [(x, y, 0.0) for (x, y) in pts]
    n = len(pts)
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    mb.add(top + bot, faces, col('#e0a93f'))
    v, f = lib.blob((0, 0, 0.08), 0.1, rough=0.0, subdiv=2)
    mb.add(v, f, col('#f2c14e'))
    mb.build('vane', props.mats()['metal'])


def storm_sprites():
    frames = {}
    for k in range(16):
        fresh(storm_light)
        ortho_cam(55.0, (240, 380), 100.0)
        dinghy(k * 22.5)
        frames[f'boat_{k:02d}'] = render(f'storm_boat_{k:02d}')
    for kind in ('pouch', 'chest', 'goldchest'):
        fresh(storm_light)
        ortho_cam(55.0, (240, 260), 160.0)
        treasure(kind)
        frames[kind] = render(f'storm_{kind}')
    fresh(storm_light)
    ortho_cam(89.9, (200, 80), 100.0)
    vane()
    frames['vane'] = render('storm_vane')
    frames['whirl'] = K.vortex_texture(os.path.join(TMP, 'storm_whirl.png'), size=384)
    return frames


# ------------------------------------------------------------------------------------------
# Packing
def pack(name, frames, pad=3):
    """Trim each render, shelf-pack them into one sheet and write the Phaser JSON-hash atlas."""
    from PIL import Image
    items = []
    for key, path in frames.items():
        if path is None:
            continue
        im = Image.open(path).convert('RGBA')
        if A.preview:
            im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
        box = im.getbbox() or (0, 0, 1, 1)
        items.append((key, im.crop(box), box, im.size))
    items.sort(key=lambda it: -it[1].height)
    W = 2048
    x = y = row_h = 0
    placed = []
    for key, im, box, size in items:
        if x + im.width + pad > W:
            x = 0
            y += row_h + pad
            row_h = 0
        placed.append((key, im, box, size, x, y))
        x += im.width + pad
        row_h = max(row_h, im.height)
    H = y + row_h
    sheet = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out = {'frames': {}, 'meta': {'app': 'mg_sprites.py', 'image': f'{name}.webp', 'size': {'w': W, 'h': H}, 'scale': '1'}}
    for key, im, box, size, px, py in placed:
        sheet.paste(im, (px, py))
        out['frames'][key] = {
            'frame': {'x': px, 'y': py, 'w': im.width, 'h': im.height},
            'rotated': False,
            'trimmed': True,
            'spriteSourceSize': {'x': box[0], 'y': box[1], 'w': im.width, 'h': im.height},
            'sourceSize': {'w': size[0], 'h': size[1]},
        }
    sheet.save(os.path.join(MG, f'{name}.webp'), 'WEBP', quality=92, method=6)
    with open(os.path.join(MG, f'{name}.json'), 'w') as fh:
        json.dump(out, fh, indent=0)
    print('packed', name, len(placed), 'frames', W, 'x', H)


def main():
    todo = ['snatch', 'slash', 'storm'] if A.what == 'all' else [A.what]
    for what in todo:
        frames = {'snatch': snatch_sprites, 'slash': slash_sprites, 'storm': storm_sprites}[what]()
        if not A.dry:
            pack(f'pirates_{what}', frames)


main()
