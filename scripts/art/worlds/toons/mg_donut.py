"""Donut Dash (Cartoon Coast, Homer's minigame): a cheerful donut factory and its sprites.

    bpyenv/bin/python scripts/art/worlds/toons/mg_donut.py factory|sprites [--preview]

Camera elevation 38 degrees, ground 1:1 with screen pixels. Five conveyor belts run down from
little ovens against the back wall to drop edges over the factory floor, where the players run
with their boxes. Pastel candy colours, frosting vats in the four player colours, no lettering.
  factory  -> scene_toons_donut.webp (1920 x 1080, opaque)
  sprites  -> mg/toons_donut.webp + .json: donuts frosted in the four player colours, a rainbow
              sprinkle donut, a burnt donut, broccoli and the pastry box (white: tinted in game)
Layout (must match src/game/worlds/toons/games/donutDashLogic.ts): belt centres x 352/656/960/
1264/1568, each belt's surface runs from screen y 183 (the oven mouth) to 545 (the drop edge),
130 px wide; the floor players run on spans y 690..975, x 140..1780 and is kept clear.
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mg_common as C  # noqa: E402
from mg_common import SW, SH, col, gy, wp  # noqa: E402

import lib  # noqa: E402
import mg_dress as dress  # noqa: E402
import props  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('what', choices=['factory', 'sprites'])
p.add_argument('--preview', action='store_true')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

ELEV = 38.0
WALL_ROW = 300
BELT_X = [352, 656, 960, 1264, 1568]
BELT_W = 1.3            # world units (130 px)
BELT_TOP = (360, 2.25)  # (ground row, height) at the oven mouth  -> screen y 183
BELT_END = (640, 1.2)   # (ground row, height) at the drop edge  -> screen y 545
FROSTING = ['#22c3d6', '#ff6b5e', '#8bd346', '#ffb020']


def floor_material():
    """Pastel checker tiles (strawberry and cream) with a soft sheen."""
    m = lib.NT('factory_floor')
    X, Y, Z = m.sep(m.position())
    fx = m.math('FLOOR', m.math('DIVIDE', X, 0.8))
    fy = m.math('FLOOR', m.math('DIVIDE', Y, 0.8))
    s = m.math('FLOORED_MODULO', m.math('ADD', fx, fy), 2.0)
    c = m.mix(s, col('#fff4e8'), col('#ffc2d6'))
    n = m.noise(5.0, 3, 0.5, m.position())
    c = m.mult(c, m.mix(n.outputs['Fac'], col('#eee2dc'), col('#ffffff')))
    c = m.mult(c, m.mix(m.ao(0.9, 8), col('#6a5a70'), col('#ffffff')))
    m.bsdf(c, 0.3, coat=0.5)
    return m.mat


def wall_material():
    """Cream tiles above a mint wainscot."""
    m = lib.NT('factory_wall')
    X, Y, Z = m.sep(m.position())
    fx = m.math('FRACT', m.math('DIVIDE', X, 0.4))
    fz = m.math('FRACT', m.math('DIVIDE', Z, 0.3))
    grout = m.math('MAXIMUM', m.maprange(m.math('MINIMUM', fx, m.math('SUBTRACT', 1.0, fx)), 0.04, 0.0), m.maprange(m.math('MINIMUM', fz, m.math('SUBTRACT', 1.0, fz)), 0.05, 0.0))
    low = m.maprange(Z, 1.25, 1.2)
    c = m.mix(low, col('#fff3dc'), col('#8fe0cf'))
    c = m.mix(m.math('MULTIPLY', grout, 0.6), c, col('#d9c7b8'))
    c = m.mult(c, m.mix(m.ao(0.8, 8), col('#6f6878'), col('#ffffff')))
    m.bsdf(c, 0.45, normal=m.bump(grout, 0.2, 0.02), coat=0.3)
    return m.mat


def belt_point(t: float):
    """World point on a belt's centreline (t 0 at the oven mouth, 1 at the drop edge), x = 0."""
    (r0, z0), (r1, z1) = BELT_TOP, BELT_END
    return Vector((0.0, gy(r0 + (r1 - r0) * t), z0 + (z1 - z0) * t))


def conveyor(bx: float, mats: dict):
    """One belt: a dark rubber band over steel rollers, pink side rails, legs to the floor."""
    x = bx / 100
    a, b = belt_point(0.0), belt_point(1.0)
    a.x = b.x = x
    d = b - a
    L = d.length
    fwd = d.normalized()
    up = Vector((0, 0, 1)) - fwd * fwd.z
    up.normalize()
    side = Vector((1, 0, 0))
    hw = BELT_W / 2
    th = 0.12
    band = lib.MeshBuilder()
    pts = []
    for s in (0.0, L):
        c = a + fwd * s
        pts += [c - side * hw, c + side * hw, c - side * hw - up * th, c + side * hw - up * th]
    verts = [tuple(q) for q in pts]
    faces = [(0, 1, 5, 4), (6, 7, 3, 2), (0, 4, 6, 2), (1, 3, 7, 5), (0, 2, 3, 1), (4, 5, 7, 6)]
    band.add(verts, faces, col('#3b4150'))
    band.build(f'belt_{int(bx)}', mats['rubber'])
    steel, paint = lib.MeshBuilder(), lib.MeshBuilder()
    for s in (0.0, L):
        c = a + fwd * s - up * th / 2
        v, f = lib.cylinder((0, 0, 0), th * 0.75, th * 0.75, BELT_W + 0.08, 18)
        v = lib.transform(v, loc=(c.x - hw - 0.04, c.y, c.z), rot=(0.0, math.pi / 2, 0.0))
        steel.add(v, f, col('#c9d2dc'))
    for sgn in (-1, 1):
        r0 = a + side * sgn * (hw + 0.05) + up * 0.06
        r1 = b + side * sgn * (hw + 0.05) + up * 0.06
        v, f = lib.tube([tuple(r0), tuple(r1)], 0.06, 10)
        paint.add(v, f, col('#ff8fb1'))
        for t in (0.35, 1.0):
            q = a + d * t + side * sgn * (hw - 0.05)
            v, f = lib.cylinder((q.x, q.y, 0.0), 0.06, 0.06, max(0.1, q.z - th), 10)
            steel.add(v, f, col('#aeb8c4'))
            v, f = lib.cylinder((q.x, q.y, 0.0), 0.12, 0.12, 0.05, 12)
            steel.add(v, f, col('#8e98a6'))
    steel.build(f'belt_steel_{int(bx)}', mats['steel'])
    paint.build(f'belt_rails_{int(bx)}', mats['paint'])


def oven(bx: float, mats: dict, rnd):
    """A rounded pastel oven with a glowing mouth the belt runs out of, a dial and a chimney."""
    x = bx / 100
    y0, y1 = gy(WALL_ROW), gy(BELT_TOP[0] + 4)
    body = lib.MeshBuilder()
    v, f = C.rounded_slab((x, (y0 + y1) / 2, 1.7), 2.3, abs(y0 - y1), 3.4, 0.35)
    body.add(v, f, col('#7fd8c8'))
    v, f = C.rounded_slab((x, (y0 + y1) / 2, 3.45), 2.45, abs(y0 - y1) + 0.12, 0.16, 0.38)
    body.add(v, f, col('#ff8fb1'))
    body.build(f'oven_{int(bx)}', mats['paint'])
    trim = lib.MeshBuilder()
    # the mouth: a dark recess with an orange glow, framed in chrome
    mz = BELT_TOP[1] + 0.32
    v, f = lib.box((x, y1 - 0.02, mz), (BELT_W + 0.35, 0.05, 0.85))
    trim.add(v, f, col('#dfe6ee'))
    trim.build(f'oven_trim_{int(bx)}', mats['steel'])
    mouth = lib.MeshBuilder()
    v, f = lib.box((x, y1 - 0.05, mz), (BELT_W + 0.15, 0.05, 0.68))
    mouth.add(v, f, col('#ff9a3c'))
    mouth.build(f'oven_mouth_{int(bx)}', mats['heat'])
    dial = lib.MeshBuilder()
    v, f = lib.cylinder((0, 0, 0), 0.2, 0.2, 0.05, 24)
    v = lib.transform(v, loc=(x + 0.78, y1 - 0.03, 3.0), rot=(math.pi / 2, 0.0, 0.0))
    dial.add(v, f, col('#fff8ee'))
    v, f = lib.box((x + 0.78 + 0.06, y1 - 0.07, 3.03), (0.14, 0.02, 0.03))
    dial.add(v, f, col('#ff5a4a'))
    for k in range(3):
        v, f = lib.blob((x - 0.75 + k * 0.22, y1 - 0.05, 3.02), 0.06, rough=0.0, subdiv=1)
        dial.add(v, f, col(['#ff5a4a', '#ffd23f', '#8bd346'][k]))
    dial.build(f'oven_dial_{int(bx)}', mats['gloss'])
    chim = lib.MeshBuilder()
    v, f = lib.cylinder((x + 0.55, (y0 + y1) / 2 + 0.2, 3.5), 0.16, 0.16, 1.6, 14)
    chim.add(v, f, col('#c9d2dc'))
    chim.build(f'chimney_{int(bx)}', mats['steel'])


def vat(x, y, frosting, mats, rnd, h=1.7, r=0.52):
    """A steel frosting vat, brimming with icing in one of the player colours, with a paddle."""
    c = wp(x, y)
    st, ic = lib.MeshBuilder(), lib.MeshBuilder()
    v, f = lib.lathe([(r * 0.9, 0.0), (r, 0.1), (r, h), (r * 1.06, h + 0.06), (r * 0.94, h + 0.06), (r * 0.94, h - 0.1)], 32, (c.x, c.y, 0.0), cap_top=False)
    st.add(v, f, col('#d4dbe3'))
    for zz in (0.35, h - 0.35):
        v, f = C.torus((c.x, c.y, zz), r + 0.01, 0.03, 36, 8, axis='z')
        st.add(v, f, col('#aeb8c4'))
    v, f = lib.blob((c.x, c.y, h - 0.06), r * 0.93, squash=(1, 1, 0.12), rough=0.12, freq=3.0, subdiv=3, seed=x)
    ic.add(v, f, col(frosting))
    for k in range(3):
        a = rnd.uniform(0, math.tau)
        v, f = lib.blob((c.x + math.cos(a) * r * 0.95, c.y + math.sin(a) * r * 0.95, h - 0.25), 0.08, squash=(0.9, 0.9, 2.4), rough=0.1, subdiv=1)
        ic.add(v, f, col(frosting))
    v, f = lib.tube([(c.x - 0.1, c.y, h - 0.1), (c.x + 0.25, c.y + 0.1, h + 0.9)], 0.04, 8)
    st.add(v, f, col('#b07a45'))
    st.build(f'vat_{int(x)}', mats['steel'])
    ic.build(f'icing_{int(x)}', mats['icing'])


def big_donut(x, y, z, s, mats, frosting='#ff8fb1'):
    """A giant decorative donut standing upright against the wall (no lettering)."""
    c = wp(x, y)
    d, fr, sp = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    v, f = C.torus((c.x, c.y, z), 0.55 * s, 0.26 * s, 48, 16, axis='y')
    d.add(v, f, col('#e8a456'))
    v, f = C.torus((c.x, c.y - 0.05 * s, z), 0.55 * s, 0.27 * s, 48, 16, axis='y')
    v = [(vx, min(vy, c.y - 0.02 * s), vz) for (vx, vy, vz) in v]
    fr.add(v, f, col(frosting))
    rnd = random.Random(int(x))
    for k in range(40):
        a = rnd.uniform(0, math.tau)
        rr = 0.55 * s + rnd.uniform(-0.18, 0.18) * s
        q = (c.x + math.cos(a) * rr, c.y - 0.3 * s, z + math.sin(a) * rr)
        v, f = lib.blob(q, 0.03 * s, squash=(2.2, 0.8, 0.8), rough=0.0, subdiv=1)
        v = lib.transform([(vx - q[0], vy - q[1], vz - q[2]) for (vx, vy, vz) in v], loc=q, rot=(0.0, rnd.uniform(0, math.pi), 0.0))
        sp.add(v, f, col(rnd.choice(['#ffffff', '#5ce1ff', '#ffd23f', '#8bd346', '#c49bff'])))
    d.build(f'bigdonut_{int(x)}', mats['dough'])
    fr.build(f'bigdonut_icing_{int(x)}', mats['icing'])
    sp.build(f'bigdonut_sprinkles_{int(x)}', mats['gloss'])


def factory():
    C.start(ELEV, 22, A.preview, sun_elev=52, sun_az=-30, key=3.2, fill=1.05, key_col='#fff0dc', zenith='#b9dcff', horizon='#fff2e2', ground='#e0c8c8')
    C.camera(0, 0, SW, SH, A.preview)
    rnd = random.Random(12)
    mats = {
        'rubber': C.mat_gloss('rubber', 0.55, 0.1),
        'steel': C.mat_metal('steel', 0.3),
        'paint': C.mat_gloss('f_paint', 0.4, 0.35),
        'gloss': C.mat_gloss('f_gloss', 0.25, 0.8),
        'heat': C.mat_glow('oven_heat', 2.6),
        'icing': C.mat_gloss('icing', 0.2, 0.9, subsurface=0.1),
        'dough': C.mat_matte('dough', 0.65, 0.35, sheen=0.3),
    }
    x0, x1 = -1.0, 20.2
    lib.mesh_object('floor', [(x0, gy(WALL_ROW), 0.0), (x1, gy(WALL_ROW), 0.0), (x1, gy(1400), 0.0), (x0, gy(1400), 0.0)], [(3, 2, 1, 0)], smooth=False, material=floor_material())
    wy = gy(WALL_ROW)
    lib.mesh_object('wall', [(x0, wy, 0.0), (x1, wy, 0.0), (x1, wy, 6.0), (x0, wy, 6.0)], [(0, 1, 2, 3)], smooth=False, material=wall_material())
    for bx in BELT_X:
        oven(bx, mats, rnd)
        conveyor(bx, mats)
    # colourful frosting pipes running along the wall into the ovens
    pipes = lib.MeshBuilder()
    for k, colr in enumerate(FROSTING):
        zz = 3.95 + k * 0.16
        v, f = lib.tube([(x0, wy - 0.25 - k * 0.02, zz), (x1, wy - 0.25 - k * 0.02, zz)], 0.06, 10)
        pipes.add(v, f, col(colr))
    for bx in BELT_X:
        v, f = lib.tube([(bx / 100 - 0.6, wy - 0.3, 3.95), (bx / 100 - 0.6, wy - 0.3, 3.45)], 0.07, 10)
        pipes.add(v, f, col('#d4dbe3'))
    pipes.build('pipes', mats['gloss'])
    # frosting vats in the four player colours, flour sacks and stacked boxes at the sides
    for (vx, vy, colr) in [(88, 470, FROSTING[0]), (205, 575, FROSTING[1]), (1715, 575, FROSTING[2]), (1832, 470, FROSTING[3])]:
        vat(vx, vy, colr, mats, rnd)
    boxes = lib.MeshBuilder()
    for (bx, by, n) in [(60, 760, 3), (1860, 760, 3), (95, 910, 2), (1830, 910, 2)]:
        c = wp(bx, by)
        for k in range(n):
            v, f = C.rounded_slab((c.x + rnd.uniform(-0.05, 0.05), c.y, 0.2 + k * 0.4), 0.9, 0.6, 0.38, 0.05)
            boxes.add(v, f, col(rnd.choice(['#ffd6e4', '#fff2d6', '#d6f5ee'])))
    boxes.build('boxes', mats['paint'])
    sacks = lib.MeshBuilder()
    for (sx, sy) in [(160, 1020), (1760, 1020)]:
        c = wp(sx, sy)
        v, f = lib.blob((c.x, c.y, 0.35), 0.4, squash=(1.0, 0.8, 0.9), rough=0.12, subdiv=3, seed=sx)
        sacks.add(v, f, col('#efe2c8'))
    sacks.build('sacks', mats['dough'])
    # giant decorative donuts on the wall in the free corners above the vats
    big_donut(140, WALL_ROW + 2, 3.05, 1.0, mats, '#ff8fb1')
    big_donut(1780, WALL_ROW + 2, 3.05, 1.0, mats, '#8fe0cf')
    path = C.render('donut_factory')
    im = Image.open(path).convert('RGB')
    im = C.upscale_preview(im, (SW, SH))
    if A.preview:
        im.save(os.path.join(C.OUT, 'donut_factory_preview.png'))
        return
    C.save_webp(im, 'scene_toons_donut.webp')


# ------------------------------------------------------------------------------------------
def donut(mb_dough, mb_icing, mb_spr, x, y, frosting, sprinkles, rnd, burnt=False):
    c = wp(x, y)
    R, r = 0.34, 0.15
    zc = r
    v, f = C.torus((c.x, c.y, zc), R, r, 48, 18, axis='z')
    mb_dough.add(v, f, col('#3a2418') if burnt else lambda q: lib.lerp_col(col('#c9803c'), col('#f0bb70'), max(0.0, min(1.0, (q[2] - 0.02) / (2 * r)))))
    if burnt:
        for k in range(22):
            a = rnd.uniform(0, math.tau)
            q = (c.x + math.cos(a) * R, c.y + math.sin(a) * R, zc + r * 0.9)
            v, f = lib.blob(q, rnd.uniform(0.02, 0.04), rough=0.0, subdiv=1)
            mb_spr.add(v, f, col(rnd.choice(['#6b6560', '#8a8580', '#1d120c'])))
        return
    # icing: a shell over the top half with a wavy drip edge
    v, f = C.torus((c.x, c.y, zc), R, r * 1.07, 48, 18, axis='z')
    out = []
    for (vx, vy, vz) in v:
        a = math.atan2(vy - c.y, vx - c.x)
        edge = zc + 0.01 + 0.035 * math.sin(a * 7) + 0.02 * math.sin(a * 13 + 1.0)
        out.append((vx, vy, max(vz, edge)))
    mb_icing.add(out, f, col(frosting))
    for k in range(sprinkles):
        a = rnd.uniform(0, math.tau)
        rr = R + rnd.uniform(-0.1, 0.1)
        q = (c.x + math.cos(a) * rr, c.y + math.sin(a) * rr, zc + math.sqrt(max(0.0, (r * 1.07) ** 2 - (rr - R) ** 2)) + 0.005)
        v, f = lib.blob((0, 0, 0), 0.016, squash=(2.6, 0.9, 0.9), rough=0.0, subdiv=1)
        v = lib.transform(v, loc=q, rot=(0.0, 0.0, rnd.uniform(0, math.pi)))
        mb_spr.add(v, f, col(rnd.choice(['#ffffff', '#ff6fa8', '#ffe066', '#5ce1ff', '#8bd346', '#c49bff', '#ff8a3a'])))


def sprites():
    C.start(ELEV, 40, A.preview, sun_elev=52, sun_az=-30, key=3.3, fill=1.0)
    dough = C.mat_matte('d_dough', 0.62, 0.35, sheen=0.35)
    icing = C.mat_gloss('d_icing', 0.18, 0.9, subsurface=0.1)
    spr = C.mat_gloss('d_sprinkles', 0.25, 0.7)
    cells = {}
    rnd = random.Random(5)
    names = ['donut_cyan', 'donut_coral', 'donut_green', 'donut_amber', 'donut_rainbow', 'donut_burnt']
    fr = FROSTING + ['#fffaf2', None]
    row = 150.0
    for i, name in enumerate(names):
        x = 90.0 + i * 150
        mb_d, mb_i, mb_s = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
        donut(mb_d, mb_i, mb_s, x, row, fr[i], 60 if name == 'donut_rainbow' else 22, rnd, burnt=name == 'donut_burnt')
        mb_d.build(name + '_d', dough if name != 'donut_burnt' else C.mat_matte('burnt', 0.85, 0.3))
        mb_i.build(name + '_i', icing)
        mb_s.build(name + '_s', spr)
        cells[name] = (x - 65, row - 65, 130, 100, x, row)
    # broccoli
    x = 90.0 + 6 * 150
    c = wp(x, row)
    st, fl = lib.MeshBuilder(), lib.MeshBuilder()
    v, f = lib.cylinder((c.x, c.y, 0.0), 0.09, 0.07, 0.34, 12)
    st.add(v, f, col('#a8d86a'))
    for k in range(9):
        a = k / 9 * math.tau
        rr = 0.0 if k == 0 else rnd.uniform(0.12, 0.2)
        q = (c.x + math.cos(a) * rr, c.y + math.sin(a) * rr * 0.7, 0.42 + rnd.uniform(-0.03, 0.06) - rr * 0.3)
        v, f = lib.blob(q, rnd.uniform(0.11, 0.15), rough=0.35, freq=6.0, subdiv=2, seed=k * 3.1)
        fl.add(v, f, lambda qq: lib.lerp_col(col('#2f7d2a'), col('#6cc24a'), max(0.0, min(1.0, (qq[2] - 0.3) / 0.35))))
    st.build('broc_stem', C.mat_matte('broc_stem', 0.6, 0.3))
    fl.build('broc_florets', C.mat_matte('broc', 0.75, 0.5, sheen=0.3))
    cells['broccoli'] = (x - 60, row - 75, 120, 100, x, row)
    # the pastry box (white card, open top, lid folded up at the back)
    x = 90.0 + 7 * 150 + 20
    c = wp(x, row)
    bx = lib.MeshBuilder()
    w, d, h, t = 1.1, 0.72, 0.42, 0.03
    for (cx, cy, cz, sx, sy, sz) in [(0, 0, t / 2, w, d, t), (0, -d / 2, h / 2, w, t, h), (0, d / 2, h / 2, w, t, h), (-w / 2, 0, h / 2, t, d, h), (w / 2, 0, h / 2, t, d, h)]:
        v, f = lib.box((c.x + cx, c.y + cy, cz), (sx, sy, sz))
        bx.add(v, f, col('#fbfaf6'))
    lid = [(c.x - w / 2, c.y + d / 2, h), (c.x + w / 2, c.y + d / 2, h), (c.x + w / 2, c.y + d / 2 + 0.12, h + 0.55), (c.x - w / 2, c.y + d / 2 + 0.12, h + 0.55)]
    bx.add(lid, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#f3f1ea'))
    # a stripe band round the box (it takes the tint strongest)
    for (cx, cy, sx, sy) in [(0, -d / 2 - 0.012, w + 0.01, 0.01)]:
        v, f = lib.box((c.x + cx, c.y + cy, h * 0.55), (sx, sy, 0.1))
        bx.add(v, f, col('#e8e2d6'))
    bx.build('box', C.mat_matte('card', 0.7, 0.35))
    cells['box'] = (x - 88, row - 120, 176, 155, x, row)
    W, H = 1400, 260
    C.camera(0, 0, W, H, A.preview)
    path = C.render('donut_sprites')
    im = Image.open(path).convert('RGBA')
    im = C.upscale_preview(im, (W, H))
    frames = {}
    for name, (x, y, w2, h2, ax, ay) in cells.items():
        img, (ox, oy) = C.crop_alpha(im, (int(x), int(y), int(x + w2), int(y + h2)))
        frames[name] = (img, (ax - ox, ay - oy))
    if A.preview:
        im.save(os.path.join(C.OUT, 'donut_sprites_preview.png'))
        return
    C.pack_atlas('toons_donut', frames, width=768)
    C.save_icon(frames['donut_coral'][0], 'donut')
    C.save_icon(frames['broccoli'][0], 'broccoli')
    # the box as players carry it: tinted in a player colour, a couple of donuts peeking out
    box = C.tint_rgb(frames['box'][0], (1.0, 0.56, 0.69))
    dn = frames['donut_coral'][0]
    d = dn.resize((max(1, dn.width // 2), max(1, dn.height // 2)), Image.LANCZOS)
    icon = Image.new('RGBA', (box.width + 20, box.height + 40), (0, 0, 0, 0))
    icon.alpha_composite(d, (icon.width // 2 - d.width + 8, 18))
    icon.alpha_composite(d, (icon.width // 2 - 6, 12))
    icon.alpha_composite(box, (10, 40))
    C.save_icon(icon.crop(icon.getbbox()), 'box')


{'factory': factory, 'sprites': sprites}[A.what]()
