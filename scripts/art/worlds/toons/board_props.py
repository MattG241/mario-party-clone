"""Cartoon Coast's landmarks, modelled in code (original designs: no logos, lettering or copied
buildings). Builders take a board anchor and a scale and return the objects of a props.Prop."""
from __future__ import annotations

import math

import numpy as np
from mathutils import Vector

import lib
import props
from lib import board_to_world, col

WHITE = col('#fbf8f0')
WOOD_D = col('#5e3b22')
GOLD = col('#f2c14e')


def _w(bx, by, z=0.0):
    return board_to_world(bx, by, z)


def loop_the_loop(bx, by, R=1.55, s=1.0, tall=1.75) -> list:
    """A giant loop-the-loop facing the camera: a tall oval of checkered track standing on its edge
    (taller than wide, so it reads as upright from the board camera), gold rails along both lips,
    red lattice towers holding its sides, run-in ramps and a gold star on top. The trail passes
    through its foot."""
    P = props.Prop('loop')
    p = _w(bx, by)
    x, y = p.x, p.y
    Rx = R * s
    Rz = R * tall * s
    width = 0.42 * s  # track width (across, along world y)
    n = 80

    def pt(t, grow=0.0):
        return x + math.cos(t) * (Rx + grow), Rz + math.sin(t) * (Rz + grow)
    ts = [-math.pi / 2 + k / n * math.tau for k in range(n + 1)]
    faces = [(k * 2, k * 2 + 1, k * 2 + 3, k * 2 + 2) for k in range(n)]
    faces2 = faces + [tuple(reversed(f)) for f in faces]
    verts = []
    for t in ts:
        cx, cz = pt(t)
        verts += [(cx, y - width / 2, cz), (cx, y + width / 2, cz)]

    def checker(vv):
        t = math.atan2((vv[2] - Rz) / Rz, (vv[0] - x) / Rx)
        seg = int((t + math.pi) / math.tau * 40)
        side = 0 if vv[1] < y else 1
        return col('#2f7de1') if (seg + side) % 2 == 0 else WHITE
    P.b['paint'].add(verts, faces2, checker)
    verts2 = []
    for t in ts:
        cx, cz = pt(t, 0.1 * s)
        verts2 += [(cx, y - width / 2, cz), (cx, y + width / 2, cz)]
    P.b['paint'].add(verts2, faces2, col('#1c4f99'))
    # side walls between the track and its underside, so the band has thickness
    for dy in (-width / 2, width / 2):
        wv = []
        for t in ts:
            a_, b_ = pt(t), pt(t, 0.1 * s)
            wv += [(a_[0], y + dy, a_[1]), (b_[0], y + dy, b_[1])]
        P.b['paint'].add(wv, faces2, col('#e8eef8'))
        rim = [(pt(t, -0.02 * s)[0], y + dy, pt(t, -0.02 * s)[1]) for t in ts]
        v, f = lib.tube(rim, 0.04 * s, 6)
        P.b['metal'].add(v, f, GOLD)
    # lattice towers under both sides of the oval
    for sgn in (-1, 1):
        tx = x + sgn * Rx * 1.02
        top = Rz * 0.95
        for dy in (-0.16 * s, 0.16 * s):
            v, f = lib.cylinder((tx, y + dy, 0.0), 0.05 * s, 0.045 * s, top, 8)
            P.b['paint'].add(v, f, col('#e8483b'))
        for k in range(5):
            z0 = k * top / 5
            v, f = lib.tube([(tx, y - 0.16 * s, z0), (tx, y + 0.16 * s, z0 + top / 5)], 0.018 * s, 5)
            P.b['paint'].add(v, f, col('#c83a30'))
        v, f = lib.lathe([(0.26 * s, 0.0), (0.26 * s, 0.1 * s), (0.0, 0.1 * s)], 14, (tx, y, 0.0))
        P.b['stone'].add(v, f, col('#d8cbb8'))
    # run-in ramps along the trail at both feet
    for sgn in (-1, 1):
        rv = []
        for k in range(9):
            t = k / 8
            xx = x + sgn * (0.1 + t * 0.9) * s
            zz = 0.02 + 0.12 * (1 - t) * s
            rv += [(xx, y - width / 2, zz), (xx, y + width / 2, zz)]
        P.b['paint'].add(rv, [(k * 2, k * 2 + 1, k * 2 + 3, k * 2 + 2) for k in range(8)] + [(k * 2 + 2, k * 2 + 3, k * 2 + 1, k * 2) for k in range(8)], col('#2f7de1'))
    # a big gold star on top (original: just a star)
    sx, sz = x, 2 * Rz + 0.34 * s
    pts = []
    for k in range(10):
        a = math.pi / 2 + k * math.pi / 5
        r = (0.3 if k % 2 == 0 else 0.13) * s
        pts.append((sx + math.cos(a) * r, y - 0.03, sz + math.sin(a) * r))
    verts = [(sx, y - 0.05, sz)] + pts
    faces = [(0, i + 1, (i + 1) % 10 + 1) for i in range(10)]
    P.b['metal'].add(verts, faces + [tuple(reversed(f)) for f in faces], GOLD)
    return P.build()


def pineapple_house(bx, by, s=1.0, z0=0.0) -> list:
    """A pineapple-shaped house: a tall golden ellipsoid with a criss-cross pattern, a crown of long
    spiky leaves, a round porthole window, a round-topped door and a little stone step."""
    P = props.Prop('pineapple')
    p = _w(bx, by, z0)
    x, y = p.x, p.y
    H, R = 1.6 * s, 0.6 * s
    prof = [(0.0, 0.0)] + [(R * math.sin(t) * (1.0 - 0.08 * math.cos(t)), H * (1 - math.cos(t)) / 2) for t in np.linspace(0.12, math.pi - 0.2, 14)] + [(0.0, H * 0.99)]
    v, f = lib.lathe(prof, 32, (x, y, z0))

    def pattern(vv):
        a = math.atan2(vv[1] - y, vv[0] - x)
        h = (vv[2] - z0) / H
        u, w = a * 5.1 + h * 9.0, a * 5.1 - h * 9.0
        line = min(abs(u - round(u)), abs(w - round(w)))
        if line < 0.07:
            return col('#9a5a1e')
        return col('#f7b42c') if (math.floor(u) + math.floor(w)) % 2 else col('#ffc84a')
    P.b['paint'].add(v, f, pattern)
    # crown of leaves
    for k in range(11):
        a = k / 11 * math.tau
        L = (0.6 + 0.25 * (k % 3 == 0)) * s
        base = (x, y, z0 + H * 0.96)
        tip = (x + math.cos(a) * L * 0.55, y + math.sin(a) * L * 0.55, z0 + H + L * 0.85)
        side = Vector((-math.sin(a), math.cos(a), 0.0)) * 0.1 * s
        verts = [(base[0] + side.x, base[1] + side.y, base[2]), (base[0] - side.x, base[1] - side.y, base[2]), tip]
        P.b['leaf'].add(verts, [(0, 1, 2), (2, 1, 0)], col('#3fae3a' if k % 2 else '#2f8a2c'))
    # round door and porthole on the camera side, seated on the curved wall
    def surface_y(xx, zz):
        h = min(max((zz - z0) / H, 0.02), 0.98)
        t = math.acos(1 - 2 * h)
        r = R * math.sin(t) * (1.0 - 0.08 * math.cos(t))
        return y - math.sqrt(max(0.0, r * r - (xx - x) ** 2)) - 0.012

    def disc_on(xx, zz, r, colour, mb, lift=0.0):
        py = surface_y(xx, zz) - lift
        verts = [(xx, py, zz)] + [(xx + math.cos(t) * r, py, zz + math.sin(t) * r) for t in np.linspace(0, math.tau, 20, endpoint=False)]
        faces = [(0, 1 + i, 1 + (i + 1) % 20) for i in range(20)]
        mb.add(verts, faces + [tuple(reversed(fc)) for fc in faces], colour)
    dy = surface_y(x, z0 + 0.2 * s)
    door = [(x - 0.14 * s, dy, z0), (x + 0.14 * s, dy, z0), (x + 0.14 * s, dy, z0 + 0.34 * s), (x - 0.14 * s, dy, z0 + 0.34 * s)]
    P.b['wood'].add(door, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#8a5a34'))
    disc_on(x, z0 + 0.34 * s, 0.14 * s, col('#8a5a34'), P.b['wood'])
    disc_on(x - 0.22 * s, z0 + 0.9 * s, 0.13 * s, col('#7a8a99'), P.b['metal'])
    disc_on(x - 0.22 * s, z0 + 0.9 * s, 0.1 * s, col('#bfe8ff'), P.b['glow'], lift=0.006)
    v, f = lib.box((x, y - R - 0.05 * s, z0 + 0.03 * s), (0.4 * s, 0.14 * s, 0.06 * s))
    P.b['stone'].add(v, f, col('#b8aca0'))
    return P.build()


def tiki_hut(bx, by, s=1.0, sink=0.5) -> list:
    """A carved tiki-stone head used as a hut, half sunk in the bay: a rounded crown, a heavy brow,
    big glowing window eyes, a broad flat nose, a wide grin, ears, a round door in the chin and a
    ring of bubbles rising round it."""
    P = props.Prop('tiki')
    p = _w(bx, by)
    x, y = p.x, p.y
    z0 = -sink * s
    H, Wd, D = 2.3 * s, 0.95 * s, 0.8 * s
    stone, dark, light = col('#a7b3a8'), col('#6f7d74'), col('#c9d3c6')
    # the head: a rounded block (lathe with an oval section), wider at the jaw
    prof = [(0.0, 0.0), (0.5, 0.0), (0.52, 0.35), (0.5, 0.7), (0.47, 0.85), (0.4, 0.95), (0.22, 1.0), (0.0, 1.0)]
    v, f = lib.lathe([(r * Wd, z * H) for (r, z) in prof], 20, (x, y, z0), squash_y=D / Wd)
    P.b['stone'].add(v, f, lambda vv: light if vv[2] > z0 + H * 0.96 else stone)
    fy = y - D / 2 * 1.02  # the face plane
    # brow ridge, nose, lips
    v, f = lib.box((x, fy - 0.08 * s, z0 + H * 0.74), (Wd * 0.95, 0.2 * s, 0.14 * s))
    P.b['stone'].add(v, f, light)
    nose = [(x - 0.1 * s, fy, z0 + H * 0.7), (x + 0.1 * s, fy, z0 + H * 0.7), (x + 0.2 * s, fy - 0.24 * s, z0 + H * 0.46), (x - 0.2 * s, fy - 0.24 * s, z0 + H * 0.46)]
    P.b['stone'].add(nose, [(0, 1, 2, 3), (3, 2, 1, 0)], light)
    P.b['stone'].add([(x - 0.2 * s, fy - 0.24 * s, z0 + H * 0.46), (x + 0.2 * s, fy - 0.24 * s, z0 + H * 0.46), (x + 0.16 * s, fy, z0 + H * 0.44), (x - 0.16 * s, fy, z0 + H * 0.44)],
                     [(0, 1, 2, 3), (3, 2, 1, 0)], dark)
    v, f = lib.box((x, fy - 0.03 * s, z0 + H * 0.34), (0.62 * s, 0.1 * s, 0.1 * s))
    P.b['paint'].add(v, f, col('#3f4a44'))
    v, f = lib.box((x, fy - 0.05 * s, z0 + H * 0.3), (0.5 * s, 0.1 * s, 0.05 * s))
    P.b['stone'].add(v, f, light)
    # window eyes (lit) with dark frames
    for sgn in (-1, 1):
        v, f = lib.box((x + sgn * 0.25 * s, fy - 0.01, z0 + H * 0.6), (0.24 * s, 0.05 * s, 0.17 * s))
        P.b['paint'].add(v, f, dark)
        v, f = lib.box((x + sgn * 0.25 * s, fy - 0.035, z0 + H * 0.6), (0.18 * s, 0.03, 0.12 * s))
        P.b['glow'].add(v, f, col('#ffe29a'))
    # ears
    for sgn in (-1, 1):
        v, f = lib.blob((x + sgn * (Wd * 0.52), y, z0 + H * 0.58), 0.16 * s, squash=(0.45, 0.8, 1.6), rough=0.1, subdiv=2)
        P.b['stone'].add(v, f, stone)
    # the round door low in the chin (just above the water)
    dz = z0 + H * 0.12 + 0.12 * s
    verts = [(x, fy - 0.02, dz)] + [(x + math.cos(t) * 0.17 * s, fy - 0.02, dz + math.sin(t) * 0.2 * s) for t in np.linspace(0, math.pi, 12)]
    P.b['wood'].add(verts, [(0, i + 1, i + 2) for i in range(11)] + [(0, i + 2, i + 1) for i in range(11)], col('#6a4a30'))
    v, f = lib.box((x, fy - 0.02, dz - 0.12 * s), (0.34 * s, 0.03, 0.24 * s))
    P.b['wood'].add(v, f, col('#6a4a30'))
    # moss where it meets the water
    for k in range(10):
        a = k / 10 * math.tau
        v, f = lib.blob((x + math.cos(a) * Wd * 0.52, y + math.sin(a) * D * 0.52, -0.3), 0.1 * s, squash=(1.4, 1.2, 0.5), rough=0.2, subdiv=1, seed=k)
        P.b['leaf'].add(v, f, col('#4f9a4a'))
    # bubbles rising round it
    rng = np.random.default_rng(4)
    for k in range(16):
        bx_ = x + (rng.random() - 0.5) * 1.8 * s
        by_ = y - 0.3 * s - rng.random() * 0.6 * s
        bz = -0.2 + rng.random() * 2.2 * s
        v, f = lib.blob((bx_, by_, bz), (0.03 + rng.random() * 0.06) * s, rough=0.0, subdiv=2)
        P.b['crystal'].add(v, f, col('#e4f8ff'))
    return P.build()


def family_house(bx, by, s=1.0, wall='#ffe08a', roof='#5a5f6e', door='#d9483b') -> list:
    """A cheerful two-storey suburban house: butter-yellow walls, white trim, a dark roof with a
    chimney, a red front door with a little porch roof, lit windows, an attached garage and a lawn
    with a picket fence and a mailbox."""
    P = props.Prop('family_house')
    p = _w(bx, by)
    x, y = p.x, p.y
    Wd, D, Hh = 1.5 * s, 1.0 * s, 1.35 * s
    v, f = lib.box((x, y, Hh / 2), (Wd, D, Hh))
    P.b['paint'].add(v, f, col(wall))
    roof_c = col(roof)
    roof_side = tuple(c * 0.85 for c in roof_c[:3]) + (1.0,)
    for sgn in (-1, 1):  # hip roof slopes front/back
        verts = [(x - Wd / 2 - 0.1 * s, y + sgn * (D / 2 + 0.12 * s), Hh), (x + Wd / 2 + 0.1 * s, y + sgn * (D / 2 + 0.12 * s), Hh),
                 (x + Wd / 2 - 0.3 * s, y, Hh + 0.62 * s), (x - Wd / 2 + 0.3 * s, y, Hh + 0.62 * s)]
        P.b['paint'].add(verts, [(0, 1, 2, 3), (3, 2, 1, 0)], roof_c)
    for sgn in (-1, 1):
        tri = [(x + sgn * (Wd / 2 + 0.1 * s), y - D / 2 - 0.12 * s, Hh), (x + sgn * (Wd / 2 + 0.1 * s), y + D / 2 + 0.12 * s, Hh),
               (x + sgn * (Wd / 2 - 0.3 * s), y, Hh + 0.62 * s)]
        P.b['paint'].add(tri, [(0, 1, 2), (2, 1, 0)], roof_side)
    v, f = lib.box((x + 0.45 * s, y + 0.15 * s, Hh + 0.55 * s), (0.2 * s, 0.2 * s, 0.6 * s))
    P.b['stone'].add(v, f, col('#b8604a'))
    # trim band between the floors
    v, f = lib.box((x, y - D / 2 - 0.01, Hh * 0.52), (Wd + 0.02, 0.03, 0.05 * s))
    P.b['paint'].add(v, f, WHITE)
    # door and porch
    v, f = lib.box((x - 0.2 * s, y - D / 2 - 0.015, 0.3 * s), (0.26 * s, 0.03, 0.58 * s))
    P.b['wood'].add(v, f, col(door))
    v, f = lib.box((x - 0.2 * s, y - D / 2 - 0.2 * s, 0.68 * s), (0.5 * s, 0.4 * s, 0.05 * s))
    P.b['paint'].add(v, f, WHITE)
    for dx in (-0.4, 0.0):
        v, f = lib.cylinder((x + dx * s, y - D / 2 - 0.36 * s, 0.0), 0.025 * s, 0.025 * s, 0.68 * s, 6)
        P.b['paint'].add(v, f, WHITE)
    # windows (lit) with white frames, two floors
    for (dx, zz) in [(0.35, 0.36), (-0.45, 0.95), (0.0, 0.95), (0.45, 0.95)]:
        v, f = lib.box((x + dx * s, y - D / 2 - 0.02, zz * s), (0.3 * s, 0.03, 0.3 * s))
        P.b['paint'].add(v, f, WHITE)
        v, f = lib.box((x + dx * s, y - D / 2 - 0.03, zz * s), (0.24 * s, 0.03, 0.24 * s))
        P.b['glow'].add(v, f, col('#fff0c0'))
    # attached garage with a white roll door
    gx = x + Wd / 2 + 0.45 * s
    v, f = lib.box((gx, y + 0.05 * s, 0.4 * s), (0.9 * s, 0.9 * s, 0.8 * s))
    P.b['paint'].add(v, f, col(wall))
    v, f = lib.box((gx, y + 0.05 * s, 0.84 * s), (0.98 * s, 0.98 * s, 0.08 * s))
    P.b['paint'].add(v, f, roof_c)
    for k in range(5):
        v, f = lib.box((gx, y - 0.41 * s, (0.1 + k * 0.12) * s), (0.7 * s, 0.03, 0.1 * s))
        P.b['paint'].add(v, f, WHITE if k % 2 else col('#ece6d8'))
    # picket fence along the front of the lawn and a mailbox
    fy = y - D / 2 - 0.75 * s
    for k in range(15):
        fx = x - Wd / 2 - 0.3 * s + k * 0.2 * s
        if abs(fx - (x - 0.2 * s)) < 0.25 * s:
            continue  # gap for the front walk
        verts = [(fx - 0.035 * s, fy, 0.0), (fx + 0.035 * s, fy, 0.0), (fx + 0.035 * s, fy, 0.3 * s), (fx, fy, 0.36 * s), (fx - 0.035 * s, fy, 0.3 * s)]
        P.b['paint'].add(verts, [(0, 1, 2, 3, 4), (4, 3, 2, 1, 0)], WHITE)
    for zz in (0.1, 0.24):
        v, f = lib.box((x - Wd / 2 - 0.3 * s + 1.4 * s, fy + 0.01, zz * s), (2.8 * s, 0.02, 0.04 * s))
        P.b['paint'].add(v, f, WHITE)
    v, f = lib.cylinder((x + 0.35 * s, fy - 0.08 * s, 0.0), 0.02 * s, 0.02 * s, 0.34 * s, 6)
    P.b['wood'].add(v, f, WOOD_D)
    v, f = lib.box((x + 0.35 * s, fy - 0.08 * s, 0.4 * s), (0.18 * s, 0.1 * s, 0.1 * s))
    P.b['paint'].add(v, f, col('#3f7fd9'))
    return P.build()


def donut_shop(bx, by, s=1.0) -> list:
    """A little mint-green bakery with big lit windows and a striped awning, a GIANT pink-frosted
    donut with sprinkles standing on its roof."""
    P = props.Prop('donut_shop')
    p = _w(bx, by)
    x, y = p.x, p.y
    Wd, D, Hh = 1.4 * s, 0.9 * s, 0.85 * s
    v, f = lib.box((x, y, Hh / 2), (Wd, D, Hh))
    P.b['paint'].add(v, f, col('#bff0dc'))
    v, f = lib.box((x, y, Hh + 0.05 * s), (Wd + 0.1 * s, D + 0.1 * s, 0.1 * s))
    P.b['paint'].add(v, f, WHITE)
    v, f = lib.box((x, y - D / 2 - 0.01, 0.42 * s), (Wd * 0.8, 0.03, 0.4 * s))
    P.b['glow'].add(v, f, col('#fff0c0'))
    v, f = lib.box((x + 0.45 * s, y - D / 2 - 0.02, 0.3 * s), (0.24 * s, 0.03, 0.56 * s))
    P.b['wood'].add(v, f, col('#ff8fb1'))
    for k in range(8):  # striped awning
        verts = [(x - Wd / 2 + k * Wd / 8, y - D / 2, 0.72 * s), (x - Wd / 2 + (k + 1) * Wd / 8, y - D / 2, 0.72 * s),
                 (x - Wd / 2 + (k + 1) * Wd / 8, y - D / 2 - 0.3 * s, 0.6 * s), (x - Wd / 2 + k * Wd / 8, y - D / 2 - 0.3 * s, 0.6 * s)]
        P.b['paint'].add(verts, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#ff6f91') if k % 2 else WHITE)
    # the giant donut on a short post, facing the camera
    cz = Hh + 0.2 * s + 0.62 * s
    v, f = lib.cylinder((x, y + 0.1 * s, Hh + 0.1 * s), 0.05 * s, 0.05 * s, 0.25 * s, 8)
    P.b['metal'].add(v, f, col('#9aa3a6'))
    Rr, rr = 0.5 * s, 0.22 * s
    nu, nv = 36, 16
    verts, faces = [], []
    for i in range(nu):
        u = i / nu * math.tau
        for j in range(nv):
            w = j / nv * math.tau
            px_ = x + (Rr + rr * math.cos(w)) * math.cos(u)
            pz = cz + (Rr + rr * math.cos(w)) * math.sin(u)
            py_ = y + 0.1 * s + rr * math.sin(w)
            verts.append((px_, py_, pz))
    for i in range(nu):
        for j in range(nv):
            a = i * nv + j
            b = ((i + 1) % nu) * nv + j
            c = ((i + 1) % nu) * nv + (j + 1) % nv
            d = i * nv + (j + 1) % nv
            faces.append((a, b, c, d))
    from terrain import orient

    def outward(cc):
        u = math.atan2(cc.z - cz, cc.x - x)
        return cc - Vector((x + Rr * math.cos(u), y + 0.1 * s, cz + Rr * math.sin(u)))
    faces = orient(faces, verts, outward)

    def frosting(vv):
        front = vv[1] < y + 0.1 * s - rr * 0.15
        if not front:
            return col('#e0a060')
        h = math.sin(vv[0] * 47.0) * math.cos(vv[2] * 53.0)
        if h > 0.93:
            return col(['#ffffff', '#4fd1ff', '#ffd23f', '#8bd346'][int(abs(vv[0] * 91 + vv[2] * 37)) % 4])
        return col('#ff8fc4')
    P.b['paint'].add(verts, faces, frosting)
    return P.build()


def garage(bx, by, s=1.0) -> list:
    """A tinkerer's garage: a boxy workshop with an open roll door, a workbench, a tyre stack and a
    toolbox."""
    P = props.Prop('garage')
    p = _w(bx, by)
    x, y = p.x, p.y
    Wd, D, Hh = 1.2 * s, 0.9 * s, 0.9 * s
    v, f = lib.box((x, y, Hh / 2), (Wd, D, Hh))
    P.b['paint'].add(v, f, col('#cfe3f0'))
    v, f = lib.box((x, y, Hh + 0.06 * s), (Wd + 0.12 * s, D + 0.12 * s, 0.12 * s))
    P.b['paint'].add(v, f, col('#e8483b'))
    v, f = lib.box((x, y - D / 2 - 0.01, 0.36 * s), (0.8 * s, 0.03, 0.7 * s))
    P.b['paint'].add(v, f, col('#2a2f38'))
    v, f = lib.box((x, y - D / 2 - 0.02, 0.76 * s), (0.84 * s, 0.05, 0.14 * s))
    P.b['paint'].add(v, f, WHITE)
    v, f = lib.box((x - 0.15 * s, y - D / 2 + 0.2 * s, 0.26 * s), (0.5 * s, 0.2 * s, 0.05 * s))
    P.b['wood'].add(v, f, col('#b07a45'))
    v, f = lib.box((x + 0.2 * s, y - D / 2 + 0.2 * s, 0.1 * s), (0.2 * s, 0.14 * s, 0.2 * s))
    P.b['paint'].add(v, f, col('#e8483b'))
    for k in range(3):
        v, f = lib.lathe([(0.1 * s, 0.0), (0.16 * s, 0.02 * s), (0.16 * s, 0.08 * s), (0.1 * s, 0.1 * s)], 14, (x - Wd / 2 - 0.25 * s, y - 0.1 * s, k * 0.1 * s), cap_bottom=False, cap_top=False)
        P.b['paint'].add(v, f, col('#2a2a2e'))
    v, f = lib.cylinder((x + Wd / 2 - 0.1 * s, y - D / 2 - 0.05 * s, Hh * 0.8), 0.04 * s, 0.04 * s, 0.06 * s, 8)
    P.b['glow'].add(v, f, col('#ffe29a'))
    return P.build()


def jellyfish(mb_glass, mb_frill, bx, by, rnd, s=1.0, z=-0.28):
    """A pink jellyfish bobbing at the surface: a glassy dome and dangling frills."""
    p = _w(bx, by, z)
    v, f = lib.blob((p.x, p.y, z + 0.06 * s), 0.14 * s, squash=(1, 1, 0.6), rough=0.05, subdiv=2)
    mb_glass.add(v, f, col(rnd.choice(['#ff9ad0', '#d9a6ff', '#ffb3c8'])))
    for k in range(5):
        a = k / 5 * math.tau
        pts = [(p.x + math.cos(a) * 0.08 * s, p.y + math.sin(a) * 0.08 * s, z + 0.02), (p.x + math.cos(a) * 0.1 * s, p.y + math.sin(a) * 0.1 * s, z - 0.12 * s)]
        v, f = lib.tube(pts, 0.01 * s, 4)
        mb_frill.add(v, f, col('#ff7ab8'))


def coral(mb, bx, by, rnd, s=1.0, z=-0.25):
    """A clump of branching coral poking out of the shallows."""
    p = _w(bx, by, z)
    c = col(rnd.choice(['#ff7a6b', '#ff9ad0', '#ffb347', '#c49bff', '#ff5f8f']))
    for k in range(rnd.randint(4, 7)):
        a = rnd.uniform(0, math.tau)
        L = rnd.uniform(0.12, 0.3) * s
        base = (p.x + rnd.uniform(-0.06, 0.06), p.y + rnd.uniform(-0.05, 0.05), z - 0.05)
        tip = (base[0] + math.cos(a) * L * 0.4, base[1] + math.sin(a) * L * 0.4, z + L)
        v, f = lib.tube([base, tip], lambda t: (0.035 - 0.02 * t) * s, 6)
        mb.add(v, f, c)
        v, f = lib.blob(tip, 0.03 * s, rough=0.0, subdiv=1)
        mb.add(v, f, c)
