"""Original 3D landmarks for Gleamtrail boards (modelled in code, rendered with the board lights).

Each builder takes a board position (the prop's ground anchor) and returns the Blender objects it
created. Colours come from per-vertex attributes so one material per surface type is enough.
"""
from __future__ import annotations

import math
import random

import bpy
from mathutils import Vector

import lib
from lib import MeshBuilder, board_to_world, col

_MATS: dict = {}


def mats() -> dict:
    if _MATS:
        return _MATS
    _MATS['stone'] = stone_material('stone', 3.2)
    _MATS['stone_big'] = stone_material('stone_big', 1.1)
    return _finish_mats()


def stone_material(name: str, brick_scale: float):
    """Stone: per-vertex tint x brick pattern in world space (courses run horizontally)."""
    m = lib.NT(name)
    pos = m.position()
    br = m.node('ShaderNodeTexBrick')
    br.inputs['Scale'].default_value = brick_scale
    br.inputs['Mortar Size'].default_value = 0.025
    br.inputs['Color1'].default_value = col('#fff8ee')
    br.inputs['Color2'].default_value = col('#e6dccb')
    br.inputs['Mortar'].default_value = col('#9d8f80')
    # Courses run horizontally on walls: feed (x + y, z) into the brick texture.
    sx, sy, sz = m.sep(pos)
    comb = m.node('ShaderNodeCombineXYZ')
    m.link(m.math('ADD', sx, m.math('MULTIPLY', sy, 0.8)), comb.inputs['X'])
    m.link(sz, comb.inputs['Y'])
    m.link(comb.outputs['Vector'], br.inputs['Vector'])
    n = m.noise(4.0, 4, 0.6, pos)
    c = m.mult(m.attr('col'), br.outputs['Color'])
    c = m.mult(c, m.mix(n.outputs['Fac'], col('#d9d0c4'), col('#ffffff')))
    ao = m.ao(0.5, 8)
    c = m.mult(c, m.mix(ao, col('#6d6272'), col('#ffffff')))
    m.bsdf(c, 0.82, normal=m.bump(br.outputs['Fac'], 0.25, 0.02))
    return m.mat


def _finish_mats() -> dict:
    # Metal (brass / gold / iron) — colour from attribute.
    m = lib.NT('metal')
    b = m.bsdf(m.attr('col'), 0.28, coat=0.3)
    b.inputs['Metallic'].default_value = 1.0
    _MATS['metal'] = m.mat
    # Painted / plastered / cloth / wood surfaces.
    _MATS['paint'] = lib.attr_mat('paint', rough=0.62, ao=0.45)
    m = lib.NT('wood')
    pos = m.position()
    wv = m.node('ShaderNodeTexWave')
    wv.wave_type = 'RINGS'
    wv.inputs['Scale'].default_value = 3.0
    wv.inputs['Distortion'].default_value = 8.0
    m.link(pos, wv.inputs['Vector'])
    c = m.mult(m.attr('col'), m.mix(wv.outputs['Fac'], col('#c9b39a'), col('#ffffff')))
    c = m.mult(c, m.mix(m.ao(0.4, 8), col('#5a4a50'), col('#ffffff')))
    m.bsdf(c, 0.72)
    _MATS['wood'] = m.mat
    _MATS['leaf'] = lib.attr_mat('leaf2', rough=0.78, ao=0.5)
    # Glowing surfaces (crystals, lanterns, windows).
    m = lib.NT('glow')
    cc = m.attr('col')
    m.bsdf(cc, 0.2, emission=cc, emission_strength=2.6, coat=0.5)
    _MATS['glow'] = m.mat
    m = lib.NT('crystal2')
    cc = m.attr('col')
    m.bsdf(cc, 0.08, emission=cc, emission_strength=1.4, coat=0.8, transmission=0.3)
    _MATS['crystal'] = m.mat
    return _MATS


class Prop:
    """Collects per-material builders for one landmark."""

    def __init__(self, name: str):
        self.name = name
        self.b = {k: MeshBuilder() for k in ('stone', 'metal', 'paint', 'wood', 'leaf', 'glow', 'crystal')}

    def build(self) -> list:
        obs = []
        for k, mb in self.b.items():
            ob = mb.build(f'{self.name}_{k}', mats()[k], smooth=k not in ('crystal',))
            if ob is not None:
                obs.append(ob)
        return obs


BRASS = col('#e0a93f')
GOLD = col('#f2c14e')
IRON = col('#6b6f7a')
TEAL = col('#1fa5a0')
CREAM = col('#fff4dc')
WOOD = col('#9a643a')
DARKWOOD = col('#5e3b22')


def _at(bx, by):
    return board_to_world(bx, by, 0.0)


# ------------------------------------------------------------------------------------------
def observatory(bx, by, s=1.0) -> list:
    """The Spiral Observatory: tapered stone tower wrapped by a golden spiral, brass dome, telescope."""
    p = _at(bx, by)
    P = Prop('observatory')
    x, y = p.x, p.y
    # plinth steps
    v, f = lib.lathe([(1.5 * s, 0.0), (1.5 * s, 0.18 * s), (1.32 * s, 0.18 * s), (1.32 * s, 0.34 * s)], 32, (x, y, 0))
    P.b['stone'].add(v, f, col('#e8ddd0'))
    # tower body
    prof = [(1.08 * s, 0.34 * s), (1.02 * s, 1.5 * s), (0.94 * s, 3.0 * s), (0.86 * s, 4.3 * s)]
    v, f = lib.lathe(prof, 32, (x, y, 0), cap_bottom=False)
    P.b['stone'].add(v, f, col('#f3eadc'))
    # balcony slab + railing
    v, f = lib.lathe([(0.84 * s, 4.25 * s), (1.28 * s, 4.25 * s), (1.28 * s, 4.42 * s), (0.84 * s, 4.42 * s)], 32, (x, y, 0))
    P.b['stone'].add(v, f, col('#d9cdbd'))
    for k in range(18):
        a = k / 18 * math.tau
        v, f = lib.cylinder((x + math.cos(a) * 1.2 * s, y + math.sin(a) * 1.2 * s, 4.42 * s), 0.03 * s, 0.03 * s, 0.34 * s, 6)
        P.b['metal'].add(v, f, BRASS)
    v, f = lib.lathe([(1.18 * s, 4.74 * s), (1.24 * s, 4.74 * s), (1.24 * s, 4.8 * s), (1.18 * s, 4.8 * s)], 32, (x, y, 0))
    P.b['metal'].add(v, f, BRASS)
    # upper drum: cream plaster with a teal band
    v, f = lib.lathe([(0.84 * s, 4.42 * s), (0.84 * s, 5.2 * s)], 32, (x, y, 0), cap_bottom=False, cap_top=False)
    P.b['paint'].add(v, f, CREAM)
    v, f = lib.lathe([(0.87 * s, 5.0 * s), (0.87 * s, 5.2 * s), (0.95 * s, 5.2 * s), (0.95 * s, 5.28 * s), (0.0, 5.28 * s)], 32, (x, y, 0), cap_bottom=True)
    P.b['paint'].add(v, f, TEAL)
    # brass dome with ribs
    dome = [(0.95 * s * math.cos(t), 5.28 * s + 0.95 * s * math.sin(t)) for t in [i / 10 * math.pi / 2 for i in range(11)]]
    dome[-1] = (0.0, dome[-1][1])
    v, f = lib.lathe(dome, 32, (x, y, 0), cap_bottom=False, cap_top=False)
    P.b['metal'].add(v, f, GOLD)
    for k in range(8):
        a = k / 8 * math.tau + 0.2
        pts = [(x + math.cos(a) * 0.97 * s * math.cos(t), y + math.sin(a) * 0.97 * s * math.cos(t), 5.28 * s + 0.97 * s * math.sin(t))
               for t in [i / 8 * math.pi / 2 for i in range(9)]]
        v, f = lib.tube(pts, 0.035 * s, 6)
        P.b['metal'].add(v, f, BRASS)
    # finial + crystal
    v, f = lib.lathe([(0.12 * s, 6.2 * s), (0.08 * s, 6.45 * s), (0.02 * s, 6.5 * s)], 12, (x, y, 0))
    P.b['metal'].add(v, f, BRASS)
    v, f = lib.prism((x, y, 6.45 * s), 0.14 * s, 0.7 * s, sides=6, tip=0.4)
    P.b['crystal'].add(v, f, col('#5ce1ff'))
    # telescope poking out towards the upper right
    tel = [(0.0, 0.0, 0.0), (0.0, 0.0, 1.9 * s)]
    v, f = lib.tube(tel, lambda t: (0.2 - 0.07 * t) * s, 14)
    v = lib.transform(v, (x + 0.35 * s, y + 0.1 * s, 5.55 * s), rot=(math.radians(-10), math.radians(52), 0))
    P.b['metal'].add(v, f, BRASS)
    v, f = lib.lathe([(0.24 * s, 0.0), (0.24 * s, 0.12 * s)], 16)
    v = lib.transform(v, (x + 0.35 * s, y + 0.1 * s, 5.55 * s), rot=(math.radians(-10), math.radians(52), 0))
    P.b['metal'].add(v, f, IRON)
    # golden spiral ribbon wrapping the tower (the "suncoil")
    pts = []
    turns = 2.2
    for i in range(160):
        t = i / 159
        a = t * turns * math.tau - 1.0
        z = (0.55 + t * 3.55) * s
        r = (1.08 - 0.22 * t) * s + 0.07 * s
        pts.append((x + math.cos(a) * r, y + math.sin(a) * r, z))
    v, f = lib.tube(pts, 0.075 * s, 8)
    P.b['metal'].add(v, f, GOLD)
    # windows (glowing) facing the camera side (-Y)
    for (zc, a) in [(1.3, -1.9), (2.3, -1.35), (3.3, -1.95), (5.0, -1.57), (2.0, -2.5), (3.6, -0.9)]:
        r = (1.02 - 0.03 * zc) * s
        cx, cy = x + math.cos(a) * r, y + math.sin(a) * r
        v, f = lib.box((cx, cy, zc * s), (0.22 * s, 0.1 * s, 0.34 * s), rot_z=a + math.pi / 2)
        P.b['glow'].add(v, f, col('#ffd27a'))
        v, f = lib.box((cx, cy, (zc + 0.2) * s), (0.3 * s, 0.12 * s, 0.07 * s), rot_z=a + math.pi / 2)
        P.b['metal'].add(v, f, BRASS)
    # door
    v, f = lib.box((x, y - 1.06 * s, 0.75 * s), (0.5 * s, 0.14 * s, 0.8 * s))
    P.b['wood'].add(v, f, DARKWOOD)
    v, f = lib.box((x, y - 1.1 * s, 1.2 * s), (0.62 * s, 0.1 * s, 0.1 * s))
    P.b['metal'].add(v, f, BRASS)
    return P.build()


def windmill(bx, by, s=1.0):
    """Returns (body objects, sail objects, hub world position)."""
    p = _at(bx, by)
    P = Prop('windmill')
    x, y = p.x, p.y
    v, f = lib.lathe([(0.62 * s, 0.0), (0.58 * s, 0.25 * s), (0.5 * s, 1.9 * s), (0.46 * s, 2.3 * s)], 24, (x, y, 0))
    P.b['stone'].add(v, f, col('#efe4d4'))
    v, f = lib.lathe([(0.56 * s, 2.3 * s), (0.56 * s, 2.36 * s), (0.0, 3.05 * s)], 24, (x, y, 0))
    P.b['paint'].add(v, f, col('#d9534a'))
    v, f = lib.box((x, y - 0.5 * s, 0.35 * s), (0.34 * s, 0.1 * s, 0.6 * s))
    P.b['wood'].add(v, f, DARKWOOD)
    for zc in (1.1, 1.7):
        v, f = lib.box((x + 0.12 * s, y - 0.5 * s, zc * s), (0.18 * s, 0.08 * s, 0.24 * s))
        P.b['glow'].add(v, f, col('#ffd27a'))
    hub = Vector((x, y - 0.62 * s, 2.35 * s))
    v, f = lib.cylinder((hub.x, hub.y + 0.12 * s, hub.z), 0.12 * s, 0.12 * s, 0.0001, 12)
    body = P.build()
    # Sails: a plane facing the camera so they can spin in 2D around the hub.
    S = Prop('windmill_sails')
    view = Vector((0.0, lib.SINB, -lib.COSB))
    right = Vector((1, 0, 0))
    up = view.cross(right).normalized() * -1
    for k in range(4):
        a = k / 4 * math.tau + 0.4
        d = right * math.cos(a) + up * math.sin(a)
        n = right * math.cos(a + math.pi / 2) + up * math.sin(a + math.pi / 2)
        L = 1.35 * s
        # spar
        v, f = lib.tube([tuple(hub), tuple(hub + d * L)], 0.035 * s, 6)
        S.b['wood'].add(v, f, DARKWOOD)
        # lattice sail (cloth panel)
        c0 = hub + d * 0.3 * s
        c1 = hub + d * L
        w = 0.32 * s
        quad = [tuple(c0), tuple(c1), tuple(c1 + n * w), tuple(c0 + n * w)]
        S.b['paint'].add(quad, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#fff4dc'))
        for t in (0.35, 0.55, 0.75, 0.95):
            q0 = hub + d * L * t
            v, f = lib.tube([tuple(q0 - view * 0.01), tuple(q0 + n * w - view * 0.01)], 0.015 * s, 5)
            S.b['wood'].add(v, f, WOOD)
    v, f = lib.lathe([(0.16 * s, 0.0), (0.16 * s, 0.1 * s), (0.0, 0.16 * s)], 12)
    v = lib.transform(v, tuple(hub - view * 0.05), rot=(math.radians(90) + lib.BETA, 0, 0))
    S.b['metal'].add(v, f, BRASS)
    return body, S.build(), hub


def workshop(bx, by, s=1.0) -> list:
    p = _at(bx, by)
    P = Prop('workshop')
    x, y = p.x, p.y
    W, D, Hh = 1.5 * s, 1.0 * s, 1.05 * s
    v, f = lib.box((x, y, Hh / 2), (W, D, Hh))
    P.b['paint'].add(v, f, col('#fbf1de'))
    # timber frame
    for dx in (-W / 2, -W / 6, W / 6, W / 2):
        v, f = lib.box((x + dx, y - D / 2 - 0.02, Hh / 2), (0.08 * s, 0.06 * s, Hh))
        P.b['wood'].add(v, f, WOOD)
    v, f = lib.box((x, y - D / 2 - 0.02, Hh - 0.04), (W + 0.1, 0.07 * s, 0.08 * s))
    P.b['wood'].add(v, f, WOOD)
    # pitched roof of individual clay tiles (colour-jittered, slightly uneven) so it reads as a
    # textured roof rather than a flat block
    ridge = Hh + 0.62 * s
    o = 0.16 * s
    courses = 7
    across = 11
    rt = random.Random(11)
    pal = ['#c8553d', '#d8653f', '#b84a36', '#e07048', '#c95e45']
    for side in (-1, 1):
        for k in range(courses):
            t0, t1 = k / courses, (k + 1) / courses + 0.05
            ya = y + side * (D / 2 + o) * (1 - t0)
            yb = y + side * (D / 2 + o) * (1 - min(1.0, t1))
            za = Hh - 0.05 + (ridge - Hh + 0.05) * t0
            zb = Hh - 0.05 + (ridge - Hh + 0.05) * min(1.0, t1)
            off = (k % 2) * 0.5
            for j in range(across + 1):
                xa = x - W / 2 - o + (j - off) * (W + 2 * o) / across
                xb = xa + (W + 2 * o) / across * 0.96
                xa, xb = max(xa, x - W / 2 - o), min(xb, x + W / 2 + o)
                if xb - xa < 0.02:
                    continue
                lift = 0.035 * s + rt.uniform(-0.008, 0.012) * s
                quad = [(xa, ya, za + lift), (xb, ya, za + lift), (xb, yb, zb + lift), (xa, yb, zb + lift)]
                face = [(0, 1, 2, 3)] if side < 0 else [(3, 2, 1, 0)]
                c = rt.choice(pal)
                P.b['paint'].add(quad, face, col(c))
                lip = [(xa, ya, za + lift), (xb, ya, za + lift), (xb, ya, za + lift - 0.06 * s), (xa, ya, za + lift - 0.06 * s)]
                P.b['paint'].add(lip, [(0, 1, 2, 3), (3, 2, 1, 0)], lib.lerp_col(col(c), col('#5a2418'), 0.45))
    # stone foundation band
    v, f = lib.box((x, y, 0.09 * s), (W + 0.08 * s, D + 0.08 * s, 0.18 * s))
    P.b['stone'].add(v, f, col('#b9ab98'))
    # lean-to shed on the right with its own slanted roof (breaks up the box silhouette)
    sx0 = x + W / 2
    v, f = lib.box((sx0 + 0.28 * s, y + 0.1 * s, 0.33 * s), (0.56 * s, 0.7 * s, 0.66 * s))
    P.b['wood'].add(v, f, col('#a8744a'))
    lean = [(sx0 - 0.02, y - 0.3 * s, 0.86 * s), (sx0 + 0.66 * s, y - 0.3 * s, 0.66 * s), (sx0 + 0.66 * s, y + 0.5 * s, 0.66 * s), (sx0 - 0.02, y + 0.5 * s, 0.86 * s)]
    P.b['wood'].add(lean, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#6b4428'))
    # brass water tank on stilts behind the workshop
    tx, ty = x - W / 2 + 0.2 * s, y + D / 2 + 0.35 * s
    for (dx, dy) in [(-0.15, -0.15), (0.15, -0.15), (-0.15, 0.15), (0.15, 0.15)]:
        v, f = lib.cylinder((tx + dx * 0.7 * s, ty + dy * 0.7 * s, 0.0), 0.02 * s, 0.02 * s, 0.95 * s, 6)
        P.b['wood'].add(v, f, DARKWOOD)
    v, f = lib.lathe([(0.14 * s, 0.0), (0.15 * s, 0.03 * s), (0.15 * s, 0.26 * s), (0.11 * s, 0.32 * s), (0.0, 0.34 * s)], 18, (tx, ty, 0.95 * s), cap_bottom=True)
    P.b['metal'].add(v, f, BRASS)
    # window boxes with flowers
    for wx in (x + 0.35 * s,):
        v, f = lib.box((wx, y - D / 2 - 0.08 * s, 0.44 * s), (0.4 * s, 0.1 * s, 0.08 * s))
        P.b['wood'].add(v, f, DARKWOOD)
        for k in range(5):
            v, f = lib.blob((wx - 0.16 * s + k * 0.08 * s, y - D / 2 - 0.08 * s, 0.5 * s), 0.035 * s, rough=0.0, subdiv=1)
            P.b['paint'].add(v, f, col(['#ff5a6e', '#ffd166', '#ffffff', '#ff9ecb', '#c49bff'][k]))
    # brass ridge cap
    v, f = lib.tube([(x - W / 2 - o, y, ridge + 0.05), (x + W / 2 + o, y, ridge + 0.05)], 0.06 * s, 10)
    P.b['metal'].add(v, f, BRASS)
    # glowing skylight on the camera-facing slope
    sy = y - (D / 2 + o) * 0.45
    sz = Hh - 0.05 + (ridge - Hh + 0.05) * 0.55 + 0.06
    v, f = lib.box((x - 0.25 * s, sy, sz), (0.36 * s, 0.26 * s, 0.1 * s))
    P.b['glow'].add(v, f, col('#ffd27a'))
    v, f = lib.box((x - 0.25 * s, sy, sz + 0.05), (0.44 * s, 0.34 * s, 0.05 * s))
    P.b['metal'].add(v, f, BRASS)
    # brass pipes running along the front wall
    for zz in (0.2, 0.9):
        v, f = lib.tube([(x - W / 2 + 0.05, y - D / 2 - 0.06, zz * s), (x + W / 2 - 0.05, y - D / 2 - 0.06, zz * s)], 0.03 * s, 8)
        P.b['metal'].add(v, f, BRASS)
    # gable ends
    P.b['paint'].add([(x - W / 2, y - D / 2, Hh), (x - W / 2, y + D / 2, Hh), (x - W / 2, y, ridge - 0.02)], [(0, 1, 2)], col('#fbf1de'))
    P.b['paint'].add([(x + W / 2, y - D / 2, Hh), (x + W / 2, y + D / 2, Hh), (x + W / 2, y, ridge - 0.02)], [(0, 2, 1)], col('#fbf1de'))
    # chimney with brass pipe
    v, f = lib.box((x + 0.45 * s, y + 0.15 * s, ridge + 0.1 * s), (0.22 * s, 0.22 * s, 0.6 * s))
    P.b['stone'].add(v, f, col('#c9b8a6'))
    v, f = lib.cylinder((x + 0.45 * s, y + 0.15 * s, ridge + 0.4 * s), 0.09 * s, 0.11 * s, 0.25 * s, 12)
    P.b['metal'].add(v, f, BRASS)
    # door + windows
    v, f = lib.box((x - 0.3 * s, y - D / 2 - 0.03, 0.38 * s), (0.34 * s, 0.06 * s, 0.7 * s))
    P.b['wood'].add(v, f, DARKWOOD)
    v, f = lib.box((x + 0.35 * s, y - D / 2 - 0.03, 0.62 * s), (0.34 * s, 0.05 * s, 0.3 * s))
    P.b['glow'].add(v, f, col('#ffd27a'))
    # big gear on the side wall
    gx, gy, gz = x - W / 2 - 0.06 * s, y + 0.1 * s, 0.62 * s
    teeth = 12
    R = 0.36 * s
    for k in range(teeth):
        a = k / teeth * math.tau
        v, f = lib.box((gx, gy + math.cos(a) * R, gz + math.sin(a) * R), (0.06 * s, 0.12 * s, 0.12 * s))
        P.b['metal'].add(v, f, BRASS)
    v, f = lib.cylinder((0, 0, 0), R * 0.9, R * 0.9, 0.07 * s, 20)
    v = lib.transform(v, (gx - 0.035 * s, gy, gz), rot=(0, math.radians(90), 0))
    P.b['metal'].add(v, f, BRASS)
    v, f = lib.cylinder((0, 0, 0), R * 0.3, R * 0.3, 0.1 * s, 12)
    v = lib.transform(v, (gx - 0.06 * s, gy, gz), rot=(0, math.radians(90), 0))
    P.b['metal'].add(v, f, IRON)
    # crates outside
    for (dx, dy, sz) in [(0.9, -0.55, 0.3), (1.05, -0.2, 0.24)]:
        v, f = lib.box((x + dx * s, y + dy * s, sz / 2 * s), (sz * s, sz * s, sz * s), rot_z=0.2)
        P.b['wood'].add(v, f, col('#b07a45'))
    return P.build()


def stall(bx, by, s=1.0, stripe=('#8e5cd9', '#fff4dc')) -> list:
    p = _at(bx, by)
    P = Prop('stall')
    x, y = p.x, p.y
    W, D = 1.4 * s, 0.8 * s
    for (dx, dy) in [(-W / 2, -D / 2), (W / 2, -D / 2), (-W / 2, D / 2), (W / 2, D / 2)]:
        v, f = lib.cylinder((x + dx, y + dy, 0), 0.05 * s, 0.05 * s, 1.35 * s if dy > 0 else 1.15 * s, 8)
        P.b['wood'].add(v, f, WOOD)
    # counter
    v, f = lib.box((x, y - D / 2 + 0.12 * s, 0.4 * s), (W - 0.05, 0.3 * s, 0.8 * s))
    P.b['wood'].add(v, f, col('#b07a45'))
    v, f = lib.box((x, y - D / 2 + 0.12 * s, 0.82 * s), (W + 0.05, 0.38 * s, 0.06 * s))
    P.b['wood'].add(v, f, DARKWOOD)
    # goods on the counter
    rnd = random.Random(3)
    for k in range(6):
        gx = x - W / 2 + 0.2 * s + k * 0.2 * s
        if k % 2 == 0:
            v, f = lib.lathe([(0.06 * s, 0), (0.07 * s, 0.1 * s), (0.04 * s, 0.16 * s)], 10, (gx, y - D / 2 + 0.1 * s, 0.85 * s))
            P.b['glow'].add(v, f, col(rnd.choice(['#5ce1ff', '#ff8fb1', '#ffe066', '#c49bff'])))
        else:
            v, f = lib.prism((gx, y - D / 2 + 0.12 * s, 0.85 * s), 0.05 * s, 0.2 * s)
            P.b['crystal'].add(v, f, col(rnd.choice(['#5ce1ff', '#c49bff'])))
    # striped canopy: a gently billowing cloth (with thickness) and rounded scalloped flaps
    segs = 8
    z0, z1 = 1.12 * s, 1.38 * s
    yf, yb = y - D / 2 - 0.22 * s, y + D / 2 + 0.05
    rows = 6
    for k in range(segs):
        xa = x - W / 2 - 0.1 * s + k * (W + 0.2 * s) / segs
        xb = xa + (W + 0.2 * s) / segs
        c = col(stripe[k % 2])
        verts, faces = [], []
        for r in range(rows + 1):
            t = r / rows
            yy = yf + (yb - yf) * t
            zz = z0 + (z1 - z0) * t + 0.07 * s * math.sin(math.pi * t)
            for xx in (xa, (xa + xb) / 2, xb):
                sag = -0.025 * s if xx == (xa + xb) / 2 else 0.0
                verts.append((xx, yy, zz + sag))
        for r in range(rows):
            for i in range(2):
                a = r * 3 + i
                faces.append((a, a + 1, a + 4, a + 3))
        n0 = len(verts)
        verts += [(vx, vy, vz - 0.025 * s) for (vx, vy, vz) in verts[:n0]]
        faces += [tuple(n0 + q for q in reversed(fc)) for fc in faces[:len(faces)]]
        P.b['paint'].add(verts, faces, c)
        # rounded flap hanging from the front edge
        mid = (xa + xb) / 2
        rr = (xb - xa) / 2
        fan = [(mid, yf, z0)] + [(mid + math.cos(a) * rr, yf - 0.005, z0 - math.sin(a) * rr * 0.9) for a in [math.pi * j / 8 for j in range(9)]]
        ff = [(0, j + 1, j + 2) for j in range(8)]
        P.b['paint'].add(fan, ff + [tuple(reversed(t)) for t in ff], c)
    # ridge pole and brass finials
    v, f = lib.cylinder((0, 0, 0), 0.035 * s, 0.035 * s, W + 0.3 * s, 8)
    v = lib.transform(v, loc=(x - W / 2 - 0.15 * s, yb, z1 + 0.02 * s), rot=(0.0, math.pi / 2, 0.0))
    P.b['wood'].add(v, f, DARKWOOD)
    for dx in (-W / 2 - 0.15 * s, W / 2 + 0.15 * s):
        v, f = lib.blob((x + dx, yb, z1 + 0.02 * s), 0.06 * s, rough=0.0, subdiv=2)
        P.b['metal'].add(v, f, BRASS)
    # a fruit basket on the counter and a crate + barrel beside the stall
    v, f = lib.lathe([(0.0, 0.0), (0.1 * s, 0.01), (0.13 * s, 0.07 * s), (0.12 * s, 0.08 * s)], 14, (x + W * 0.28, y - D / 2 + 0.12 * s, 0.85 * s), cap_bottom=False, cap_top=False)
    P.b['wood'].add(v, f, col('#c28a4a'))
    for j in range(5):
        a = j / 5 * math.tau
        v, f = lib.blob((x + W * 0.28 + math.cos(a) * 0.05 * s, y - D / 2 + 0.12 * s + math.sin(a) * 0.04 * s, 0.93 * s), 0.045 * s, rough=0.0, subdiv=1)
        P.b['paint'].add(v, f, col(['#ff5a4a', '#ffb33a', '#8bd346', '#ff5a4a', '#ffd23f'][j]))
    v, f = lib.box((x + W / 2 + 0.28 * s, y - 0.1 * s, 0.16 * s), (0.3 * s, 0.3 * s, 0.32 * s), rot_z=0.3)
    P.b['wood'].add(v, f, col('#b07a45'))
    v, f = lib.lathe([(0.12 * s, 0.0), (0.14 * s, 0.15 * s), (0.12 * s, 0.3 * s), (0.0, 0.3 * s)], 14, (x - W / 2 - 0.26 * s, y + 0.05 * s, 0.0), cap_bottom=False)
    P.b['wood'].add(v, f, col('#9a6436'))
    # sign
    v, f = lib.box((x, y - D / 2 - 0.22 * s, z0 + 0.22 * s), (0.6 * s, 0.05 * s, 0.22 * s))
    P.b['wood'].add(v, f, col('#f2c14e'))
    return P.build()


def twist_tree(bx, by, s=1.0) -> list:
    p = _at(bx, by)
    P = Prop('twist_tree')
    x, y = p.x, p.y
    # two intertwined trunks
    for ph in (0.0, math.pi):
        pts = []
        for i in range(40):
            t = i / 39
            a = t * 1.6 * math.tau + ph
            r = (0.26 - 0.12 * t) * s
            pts.append((x + math.cos(a) * r, y + math.sin(a) * r, t * 3.1 * s))
        v, f = lib.tube(pts, lambda t: (0.24 - 0.12 * t) * s, 10)
        P.b['wood'].add(v, f, col('#8a5530'))
    # roots
    for k in range(5):
        a = k / 5 * math.tau + 0.3
        pts = [(x + math.cos(a) * 0.15 * s, y + math.sin(a) * 0.15 * s, 0.35 * s), (x + math.cos(a) * 0.45 * s, y + math.sin(a) * 0.45 * s, 0.08 * s),
               (x + math.cos(a) * 0.7 * s, y + math.sin(a) * 0.7 * s, 0.0)]
        v, f = lib.tube(pts, lambda t: (0.12 - 0.08 * t) * s, 8)
        P.b['wood'].add(v, f, col('#7a4a2a'))
    # big canopy of lumps
    rnd = random.Random(11)
    low, high = col('#1f7a2a'), col('#8fd24e')
    cz = 3.4 * s
    R = 1.45 * s
    puffs = [(0, 0, 0.1, 1.0)] + [(math.cos(a) * R * 0.62, math.sin(a) * R * 0.5, rnd.uniform(-0.25, 0.2) * R, rnd.uniform(0.55, 0.72))
                                   for a in [k / 7 * math.tau + 0.2 for k in range(7)]]
    for (ox, oy, oz, rr) in puffs:
        r = R * rr
        v, f = lib.blob((x + ox, y + oy, cz + oz), r, squash=(1, 1, 0.82), rough=0.15, freq=1.7, subdiv=3, seed=rnd.random() * 40)

        def shade(vv, zc=cz + oz, r=r):
            t = max(0.0, min(1.0, (vv[2] - zc) / (r * 1.1) + 0.5))
            return lib.lerp_col(low, high, t * t)

        P.b['leaf'].add(v, f, shade)
    # hanging lanterns
    for (dx, dy, dz) in [(-0.9, -0.5, -0.55), (0.7, -0.6, -0.7), (0.1, -0.9, -0.85), (1.05, 0.1, -0.5)]:
        lx, ly, lz = x + dx * s, y + dy * s, cz + dz * s
        v, f = lib.tube([(lx, ly, lz + 0.35 * s), (lx, ly, lz + 0.1 * s)], 0.01 * s, 4)
        P.b['wood'].add(v, f, DARKWOOD)
        v, f = lib.lathe([(0.02, 0.0), (0.1 * s, 0.05 * s), (0.1 * s, 0.14 * s), (0.02, 0.2 * s)], 12, (lx, ly, lz - 0.1 * s))
        P.b['glow'].add(v, f, col('#ffb347'))
    return P.build()


def crystal_gen(bx, by, s=1.0) -> list:
    p = _at(bx, by)
    P = Prop('crystal_gen')
    x, y = p.x, p.y
    v, f = lib.lathe([(0.7 * s, 0.0), (0.7 * s, 0.2 * s), (0.55 * s, 0.3 * s), (0.5 * s, 0.55 * s), (0.62 * s, 0.62 * s), (0.62 * s, 0.7 * s), (0.0, 0.7 * s)], 8, (x, y, 0))
    P.b['metal'].add(v, f, BRASS)
    for k in range(8):
        a = k / 8 * math.tau
        v, f = lib.box((x + math.cos(a) * 0.52 * s, y + math.sin(a) * 0.52 * s, 0.42 * s), (0.08 * s, 0.08 * s, 0.26 * s), rot_z=a)
        P.b['metal'].add(v, f, IRON)
    rnd = random.Random(5)
    for k in range(5):
        a = k / 5 * math.tau
        rr = 0 if k == 0 else 0.22 * s
        h = (1.6 if k == 0 else rnd.uniform(0.7, 1.05)) * s
        v, f = lib.prism((x + math.cos(a) * rr, y + math.sin(a) * rr, 0.65 * s), (0.22 if k == 0 else 0.13) * s, h,
                         tilt=(0.0 if k == 0 else math.sin(a) * 0.35, 0.0 if k == 0 else math.cos(a) * 0.35), twist=rnd.random())
        P.b['crystal'].add(v, f, col('#5ce1ff' if k % 2 == 0 else '#9ff3ff'))
    # pipes
    for side in (-1, 1):
        pts = [(x + side * 0.55 * s, y, 0.3 * s), (x + side * 0.85 * s, y + 0.1 * s, 0.35 * s), (x + side * 0.95 * s, y + 0.15 * s, 0.0)]
        v, f = lib.tube(pts, 0.06 * s, 8)
        P.b['metal'].add(v, f, BRASS)
    return P.build()


def lantern(bx, by, s=1.0) -> list:
    p = _at(bx, by)
    P = Prop('lantern')
    x, y = p.x, p.y
    v, f = lib.cylinder((x, y, 0), 0.05 * s, 0.04 * s, 1.5 * s, 8)
    P.b['wood'].add(v, f, DARKWOOD)
    v, f = lib.box((x + 0.12 * s, y, 1.45 * s), (0.34 * s, 0.05 * s, 0.05 * s))
    P.b['wood'].add(v, f, DARKWOOD)
    lx = x + 0.26 * s
    v, f = lib.tube([(lx, y, 1.45 * s), (lx, y, 1.3 * s)], 0.01 * s, 4)
    P.b['wood'].add(v, f, DARKWOOD)
    v, f = lib.lathe([(0.03 * s, 0.0), (0.13 * s, 0.07 * s), (0.14 * s, 0.18 * s), (0.1 * s, 0.26 * s), (0.03 * s, 0.3 * s)], 14, (lx, y, 1.0 * s))
    P.b['glow'].add(v, f, col('#ffb347'))
    v, f = lib.lathe([(0.05 * s, 0.0), (0.05 * s, 0.03 * s)], 10, (lx, y, 0.98 * s))
    P.b['metal'].add(v, f, BRASS)
    return P.build()


def bunting(bx, by, width=300.0, s=1.0) -> list:
    """Two poles with a string of pennants between them, spanning `width` board px."""
    P = Prop('bunting')
    a = _at(bx - width / 2, by)
    b = _at(bx + width / 2, by)
    Hh = 1.7 * s
    for q in (a, b):
        v, f = lib.cylinder((q.x, q.y, 0), 0.045 * s, 0.035 * s, Hh, 8)
        P.b['wood'].add(v, f, DARKWOOD)
        v, f = lib.blob((q.x, q.y, Hh + 0.04 * s), 0.07 * s, rough=0.0, subdiv=1)
        P.b['metal'].add(v, f, GOLD)
    cols = ['#ff6b5e', '#f4b83b', '#1fa5a0', '#8e5cd9', '#5ce1ff', '#6cc24a']
    n = 12
    pts = []
    for i in range(n * 2 + 1):
        t = i / (n * 2)
        sag = math.sin(t * math.pi) * 0.35 * s
        pts.append((a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, Hh - 0.05 - sag))
    v, f = lib.tube(pts, 0.012 * s, 5)
    P.b['wood'].add(v, f, col('#6b4a2a'))
    for k in range(n):
        p0 = Vector(pts[2 * k])
        p1 = Vector(pts[2 * k + 2])
        mid = (p0 + p1) / 2
        tip = Vector((mid.x, mid.y - 0.02, mid.z - 0.32 * s))
        tri = [tuple(p0), tuple(p1), tuple(tip)]
        P.b['paint'].add(tri, [(0, 1, 2), (2, 1, 0)], col(cols[k % len(cols)]))
    return P.build()


def gate(bx, by, s=1.0) -> list:
    """Stone arch with a crystal keystone (the bars are drawn in-game)."""
    p = _at(bx, by)
    P = Prop('gate')
    x, y = p.x, p.y
    for side in (-1, 1):
        v, f = lib.box((x + side * 0.55 * s, y, 0.7 * s), (0.3 * s, 0.34 * s, 1.4 * s))
        P.b['stone'].add(v, f, col('#e8ddd0'))
        v, f = lib.box((x + side * 0.55 * s, y, 0.08 * s), (0.4 * s, 0.44 * s, 0.16 * s))
        P.b['stone'].add(v, f, col('#d4c7b6'))
    pts = [(x + math.cos(t) * 0.55 * s, y, 1.4 * s + math.sin(t) * 0.55 * s) for t in [i / 20 * math.pi for i in range(21)]]
    v, f = lib.tube(pts, 0.17 * s, 10)
    P.b['stone'].add(v, f, col('#efe5d8'))
    v, f = lib.prism((x, y - 0.12 * s, 1.85 * s), 0.12 * s, 0.4 * s)
    P.b['crystal'].add(v, f, col('#c49bff'))
    return P.build()


def pedestal(bx, by, s=1.0) -> list:
    p = _at(bx, by)
    P = Prop('pedestal')
    v, f = lib.lathe([(0.34 * s, 0.0), (0.34 * s, 0.08 * s), (0.22 * s, 0.14 * s), (0.18 * s, 0.5 * s), (0.28 * s, 0.56 * s), (0.28 * s, 0.62 * s), (0.0, 0.62 * s)], 16, (p.x, p.y, 0))
    P.b['stone'].add(v, f, col('#f1e8da'))
    v, f = lib.lathe([(0.29 * s, 0.6 * s), (0.29 * s, 0.64 * s)], 16, (p.x, p.y, 0), cap_bottom=False)
    P.b['metal'].add(v, f, GOLD)
    return P.build()


def stage(bx, by, s=1.0) -> list:
    """Round festival dais with pennant poles, where the host stands."""
    p = _at(bx, by)
    P = Prop('stage')
    x, y = p.x, p.y
    v, f = lib.lathe([(0.82 * s, 0.0), (0.82 * s, 0.2 * s), (0.78 * s, 0.24 * s), (0.0, 0.24 * s)], 32, (x, y, 0))
    P.b['wood'].add(v, f, col('#b07a45'))
    v, f = lib.lathe([(0.84 * s, 0.17 * s), (0.86 * s, 0.17 * s), (0.86 * s, 0.22 * s), (0.84 * s, 0.22 * s)], 32, (x, y, 0))
    P.b['metal'].add(v, f, GOLD)
    # planks pattern: dark rings
    for r in (0.3, 0.55):
        v, f = lib.lathe([(r * s, 0.241 * s), ((r + 0.02) * s, 0.241 * s)], 32, (x, y, 0), cap_bottom=False, cap_top=False)
        P.b['wood'].add(v, f, DARKWOOD)
    cols = ['#ff6b5e', '#1fa5a0', '#f4b83b', '#8e5cd9']
    for k, a in enumerate((2.3, 0.84)):
        px, py = x + math.cos(a) * 0.72 * s, y + math.sin(a) * 0.72 * s
        v, f = lib.cylinder((px, py, 0.2 * s), 0.03 * s, 0.025 * s, 1.1 * s, 8)
        P.b['wood'].add(v, f, DARKWOOD)
        tri = [(px, py, 1.28 * s), (px, py, 1.02 * s), (px + (0.34 if k else -0.34) * s, py, 1.15 * s)]
        P.b['paint'].add(tri, [(0, 1, 2), (2, 1, 0)], col(cols[k]))
    return P.build()


# ------------------------------------------------------------------------------------------
# Story props (mid-sized scenery that gives each region a sense of place)
def skyboat(bx, by, s=1.0) -> list:
    """A little festival sky-boat moored at the docks: wooden hull, striped balloon, lanterns."""
    p = _at(bx, by)
    P = Prop('skyboat')
    x, y = p.x, p.y
    z0 = 0.55 * s
    L, Wd = 1.7 * s, 0.62 * s
    # hull: a spindle revolved around Z, laid along X, narrowed and cut flat for the deck
    prof = [(0.0, -L / 2), (0.16 * s, -L / 2 + 0.08 * s), (0.3 * s, -L / 4), (0.33 * s, 0.0), (0.3 * s, L / 4), (0.18 * s, L / 2 - 0.08 * s), (0.02 * s, L / 2)]
    v, f = lib.lathe(prof, 20, (0, 0, 0), cap_bottom=False, cap_top=False)
    v = lib.transform(v, loc=(x, y, z0), rot=(0.0, math.pi / 2, 0.0), scale=(1.0, Wd / (0.66 * s), 1.0))
    v = [(vx, vy, min(vz, z0 + 0.06 * s)) for (vx, vy, vz) in v]
    P.b['wood'].add(v, f, lambda vv: col('#8a5a34') if vv[2] < z0 - 0.12 * s else col('#b07a45'))
    # deck rail and gold trim
    rail = [(x - L / 2 + 0.2 * s, y, z0 + 0.1 * s), (x + L / 2 - 0.2 * s, y, z0 + 0.1 * s)]
    v, f = lib.tube(rail, 0.02 * s, 6)
    P.b['metal'].add(v, f, BRASS)
    # mast, balloon (striped gores) and rigging
    v, f = lib.cylinder((x, y, z0), 0.035 * s, 0.03 * s, 1.1 * s, 8)
    P.b['wood'].add(v, f, DARKWOOD)
    bz = z0 + 1.45 * s
    gores = 12
    for k in range(gores):
        a0, a1 = k / gores * math.tau, (k + 1) / gores * math.tau
        verts, faces = [], []
        rows = 10
        for r in range(rows + 1):
            t = r / rows
            el = -math.pi / 2 + t * math.pi
            rr = math.cos(el) * 0.62 * s
            zz = bz + math.sin(el) * 0.5 * s
            for a in (a0, a1):
                verts.append((x + math.cos(a) * rr * 1.25, y + math.sin(a) * rr, zz))
        for r in range(rows):
            i = r * 2
            faces.append((i, i + 1, i + 3, i + 2))
        P.b['paint'].add(verts, faces, col('#ff6b5e' if k % 2 == 0 else '#fff4dc'))
    for (dx, dy) in [(-0.5, -0.2), (0.5, -0.2), (-0.5, 0.2), (0.5, 0.2)]:
        v, f = lib.tube([(x + dx * s * 0.9, y + dy * s, z0 + 0.06 * s), (x + dx * s * 0.7, y + dy * s * 0.8, bz - 0.45 * s)], 0.008 * s, 4)
        P.b['wood'].add(v, f, DARKWOOD)
    # propeller at the stern and hanging lanterns
    v, f = lib.box((x - L / 2 - 0.04 * s, y, z0 + 0.02 * s), (0.04 * s, 0.4 * s, 0.07 * s))
    P.b['metal'].add(v, f, BRASS)
    for dx in (-0.45, 0.45):
        v, f = lib.blob((x + dx * s, y - 0.3 * s, z0 + 0.3 * s), 0.07 * s, rough=0.0, subdiv=2)
        P.b['glow'].add(v, f, col('#ffd27a'))
    return P.build()


def well(bx, by, s=1.0) -> list:
    """Round stone well with a little shingled roof and a bucket."""
    p = _at(bx, by)
    P = Prop('well')
    x, y = p.x, p.y
    v, f = lib.lathe([(0.42 * s, 0.0), (0.42 * s, 0.42 * s), (0.34 * s, 0.46 * s), (0.34 * s, 0.1 * s), (0.0, 0.1 * s)], 24, (x, y, 0.0), cap_bottom=False, cap_top=False)
    P.b['stone'].add(v, f, col('#d9ccba'))
    v, f = lib.lathe([(0.33 * s, 0.12 * s), (0.0, 0.12 * s)], 24, (x, y, 0.0), cap_bottom=False, cap_top=False)
    P.b['glow'].add(v, f, col('#3fb0d8'))
    for dx in (-0.36, 0.36):
        v, f = lib.cylinder((x + dx * s, y, 0.4 * s), 0.035 * s, 0.035 * s, 0.75 * s, 8)
        P.b['wood'].add(v, f, DARKWOOD)
    roof_z = 1.15 * s
    for side in (-1, 1):
        quad = [(x - 0.44 * s, y + side * 0.3 * s, roof_z - 0.1 * s), (x + 0.44 * s, y + side * 0.3 * s, roof_z - 0.1 * s), (x + 0.44 * s, y, roof_z + 0.3 * s), (x - 0.44 * s, y, roof_z + 0.3 * s)]
        P.b['paint'].add(quad, [(0, 1, 2, 3)] if side < 0 else [(3, 2, 1, 0)], col('#c8553d'))
    v, f = lib.tube([(x - 0.36 * s, y, 0.95 * s), (x + 0.36 * s, y, 0.95 * s)], 0.03 * s, 8)
    P.b['wood'].add(v, f, WOOD)
    v, f = lib.lathe([(0.07 * s, 0.0), (0.09 * s, 0.14 * s), (0.0, 0.14 * s)], 10, (x + 0.1 * s, y - 0.05 * s, 0.62 * s), cap_bottom=True, cap_top=False)
    P.b['wood'].add(v, f, col('#9a643a'))
    return P.build()


def flower_cart(bx, by, s=1.0) -> list:
    """Two-wheeled cart heaped with flower pots."""
    p = _at(bx, by)
    P = Prop('flower_cart')
    x, y = p.x, p.y
    v, f = lib.box((x, y, 0.4 * s), (0.9 * s, 0.5 * s, 0.22 * s))
    P.b['wood'].add(v, f, col('#b07a45'))
    for dy in (-0.27, 0.27):
        v, f = lib.cylinder((0, 0, 0), 0.24 * s, 0.24 * s, 0.05 * s, 16)
        v = lib.transform(v, loc=(x - 0.1 * s, y + dy * s, 0.24 * s), rot=(math.pi / 2, 0.0, 0.0))
        P.b['wood'].add(v, f, DARKWOOD)
    v, f = lib.tube([(x + 0.45 * s, y - 0.18 * s, 0.42 * s), (x + 0.95 * s, y - 0.18 * s, 0.2 * s)], 0.025 * s, 6)
    P.b['wood'].add(v, f, WOOD)
    v, f = lib.tube([(x + 0.45 * s, y + 0.18 * s, 0.42 * s), (x + 0.95 * s, y + 0.18 * s, 0.2 * s)], 0.025 * s, 6)
    P.b['wood'].add(v, f, WOOD)
    rnd = random.Random(4)
    for k in range(9):
        px = x - 0.33 * s + (k % 3) * 0.33 * s
        py = y - 0.15 * s + (k // 3) * 0.15 * s
        v, f = lib.lathe([(0.06 * s, 0.0), (0.075 * s, 0.1 * s)], 10, (px, py, 0.51 * s), cap_bottom=True, cap_top=False)
        P.b['paint'].add(v, f, col('#c8653d'))
        v, f = lib.blob((px, py, 0.66 * s), 0.08 * s, rough=0.2, subdiv=2, seed=k * 3)
        P.b['paint'].add(v, f, col(rnd.choice(['#ff5a6e', '#ffd166', '#ffffff', '#ff9ecb', '#c49bff', '#ff8a3a'])))
    return P.build()


def mine_entrance(bx, by, s=1.0) -> list:
    """Timber-framed crystal mine mouth with rails and an ore cart full of crystals."""
    p = _at(bx, by)
    P = Prop('mine')
    x, y = p.x, p.y
    # rocky mound
    v, f = lib.blob((x, y + 0.2 * s, 0.25 * s), 0.9 * s, squash=(1.2, 0.8, 0.75), rough=0.25, freq=1.8, subdiv=3, seed=7)
    P.b['stone'].add(v, f, col('#8a7a8e'))
    # dark opening and timber frame on the camera side
    v, f = lib.box((x, y - 0.55 * s, 0.35 * s), (0.62 * s, 0.1 * s, 0.7 * s))
    P.b['paint'].add(v, f, col('#1a1420'))
    for dx in (-0.34, 0.34):
        v, f = lib.box((x + dx * s, y - 0.62 * s, 0.4 * s), (0.1 * s, 0.1 * s, 0.8 * s))
        P.b['wood'].add(v, f, WOOD)
    v, f = lib.box((x, y - 0.62 * s, 0.82 * s), (0.86 * s, 0.12 * s, 0.1 * s))
    P.b['wood'].add(v, f, WOOD)
    # rails and a cart with crystals
    for dx in (-0.12, 0.12):
        v, f = lib.box((x + dx * s, y - 1.05 * s, 0.02 * s), (0.03 * s, 0.9 * s, 0.03 * s))
        P.b['metal'].add(v, f, IRON)
    v, f = lib.box((x, y - 1.15 * s, 0.25 * s), (0.42 * s, 0.34 * s, 0.24 * s))
    P.b['metal'].add(v, f, col('#7a5a3a'))
    rnd = random.Random(9)
    for k in range(6):
        v, f = lib.prism((x + rnd.uniform(-0.14, 0.14) * s, y - 1.15 * s + rnd.uniform(-0.1, 0.1) * s, 0.34 * s), 0.05 * s, rnd.uniform(0.15, 0.3) * s,
                         tilt=(rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4)))
        P.b['crystal'].add(v, f, col(rnd.choice(['#5ce1ff', '#c49bff', '#8ff0ff'])))
    return P.build()


def weather_vane(bx, by, s=1.0) -> list:
    """Tall pole with a brass arrow vane and spinning cups (windy ledge)."""
    p = _at(bx, by)
    P = Prop('vane')
    x, y = p.x, p.y
    v, f = lib.cylinder((x, y, 0.0), 0.05 * s, 0.035 * s, 1.9 * s, 8)
    P.b['wood'].add(v, f, DARKWOOD)
    v, f = lib.box((x + 0.12 * s, y, 1.85 * s), (0.6 * s, 0.03 * s, 0.05 * s))
    P.b['metal'].add(v, f, BRASS)
    v, f = lib.prism((x + 0.45 * s, y, 1.85 * s), 0.07 * s, 0.14 * s, sides=3, tilt=(0.0, math.pi / 2))
    P.b['metal'].add(v, f, BRASS)
    v, f = lib.box((x - 0.2 * s, y, 1.88 * s), (0.02 * s, 0.03 * s, 0.22 * s))
    P.b['metal'].add(v, f, BRASS)
    for k in range(3):
        a = k / 3 * math.tau
        v, f = lib.blob((x + math.cos(a) * 0.18 * s, y + math.sin(a) * 0.18 * s, 1.6 * s), 0.06 * s, squash=(1, 1, 0.7), rough=0.0, subdiv=1)
        P.b['metal'].add(v, f, col('#e0a93f'))
    return P.build()


def bench(bx, by, s=1.0) -> list:
    p = _at(bx, by)
    P = Prop('bench')
    x, y = p.x, p.y
    v, f = lib.box((x, y, 0.24 * s), (0.7 * s, 0.22 * s, 0.05 * s))
    P.b['wood'].add(v, f, col('#b07a45'))
    v, f = lib.box((x, y + 0.1 * s, 0.42 * s), (0.7 * s, 0.04 * s, 0.2 * s))
    P.b['wood'].add(v, f, col('#a06a3a'))
    for dx in (-0.3, 0.3):
        v, f = lib.box((x + dx * s, y, 0.12 * s), (0.05 * s, 0.2 * s, 0.24 * s))
        P.b['metal'].add(v, f, IRON)
    return P.build()
