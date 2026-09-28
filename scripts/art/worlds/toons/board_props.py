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


def loop_the_loop(bx, by, R=1.9, s=1.0) -> list:
    """A giant loop-the-loop facing the camera: a checkered track band standing on its edge, gold
    rails along both lips, chunky supports and a run-in ramp at each foot. The trail passes through
    its bottom."""
    P = props.Prop('loop')
    p = _w(bx, by)
    x, y = p.x, p.y
    R *= s
    width = 0.42 * s  # track width (across, along world y)
    n = 72
    verts, faces = [], []
    for k in range(n + 1):
        t = -math.pi / 2 + k / n * math.tau  # start at the bottom
        cx, cz = x + math.cos(t) * R, R + math.sin(t) * R
        for dy in (-width / 2, width / 2):
            verts.append((cx, y + dy, cz))
    for k in range(n):
        a = k * 2
        faces.append((a, a + 1, a + 3, a + 2))
    # checker: alternating squares along the track, two tones across it
    def checker(vv):
        t = math.atan2(vv[2] - R, vv[0] - x)
        seg = int((t + math.pi) / math.tau * 36)
        side = 0 if vv[1] < y else 1
        return col('#2f7de1') if (seg + side) % 2 == 0 else WHITE
    P.b['paint'].add(verts, faces + [tuple(reversed(f)) for f in faces], checker)
    # inner surface thickness: a second band slightly outside (the underside of the track)
    verts2 = []
    for k in range(n + 1):
        t = -math.pi / 2 + k / n * math.tau
        cx, cz = x + math.cos(t) * (R + 0.1 * s), R + math.sin(t) * (R + 0.1 * s)
        for dy in (-width / 2, width / 2):
            verts2.append((cx, y + dy, cz))
    P.b['paint'].add(verts2, faces + [tuple(reversed(f)) for f in faces], col('#1c4f99'))
    for dy in (-width / 2, width / 2):
        rim = [(x + math.cos(t) * (R - 0.02), y + dy, R + math.sin(t) * (R - 0.02)) for t in np.linspace(-math.pi / 2, 1.5 * math.pi, 73)]
        v, f = lib.tube(rim, 0.04 * s, 6)
        P.b['metal'].add(v, f, GOLD)
    # supports: two stout pillars under the loop's sides and a cross beam
    for sgn in (-1, 1):
        px_ = x + sgn * R * 0.72
        v, f = lib.cylinder((px_, y, 0.0), 0.12 * s, 0.09 * s, R * 0.35, 12)
        P.b['paint'].add(v, f, col('#e8483b'))
        v, f = lib.lathe([(0.2 * s, 0.0), (0.2 * s, 0.08 * s), (0.0, 0.08 * s)], 14, (px_, y, 0.0))
        P.b['stone'].add(v, f, col('#d8cbb8'))
    # ramps leading in and out along the trail (low wedges at both feet)
    for sgn in (-1, 1):
        verts, faces = [], []
        for k in range(9):
            t = k / 8
            xx = x + sgn * (0.15 + t * 0.9) * s
            zz = 0.02 + 0.1 * (1 - t) * s
            verts += [(xx, y - width / 2, zz), (xx, y + width / 2, zz)]
        for k in range(8):
            a = k * 2
            faces.append((a, a + 1, a + 3, a + 2))
        P.b['paint'].add(verts, faces + [tuple(reversed(f)) for f in faces], col('#2f7de1'))
    # a big gold star badge on the top of the loop (original, just a star)
    sx, sz = x, 2 * R + 0.28 * s
    pts = []
    for k in range(10):
        a = math.pi / 2 + k * math.pi / 5
        r = (0.26 if k % 2 == 0 else 0.11) * s
        pts.append((sx + math.cos(a) * r, y - 0.02, sz + math.sin(a) * r))
    verts = [(sx, y - 0.04, sz)] + pts
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


def tiki_hut(bx, by, s=1.0, sink=0.55) -> list:
    """A carved tiki-stone head used as a hut, half sunk in the bay: a heavy brow, a wide nose, a
    broad grin, window eyes and a round door low in the chin, with bubbles rising beside it."""
    P = props.Prop('tiki')
    p = _w(bx, by)
    x, y = p.x, p.y
    z0 = -sink * s
    H, Wd, D = 2.2 * s, 0.9 * s, 0.75 * s
    v, f = lib.box((x, y, z0 + H / 2), (Wd, D, H))
    P.b['stone'].add(v, f, col('#9aa3a6'))
    v, f = lib.box((x, y - D / 2 - 0.06 * s, z0 + H * 0.72), (Wd * 1.04, 0.14 * s, 0.14 * s))  # brow
    P.b['stone'].add(v, f, col('#868f92'))
    verts = [(x - 0.12 * s, y - D / 2, z0 + H * 0.66), (x + 0.12 * s, y - D / 2, z0 + H * 0.66), (x + 0.16 * s, y - D / 2 - 0.18 * s, z0 + H * 0.42),
             (x - 0.16 * s, y - D / 2 - 0.18 * s, z0 + H * 0.42)]
    P.b['stone'].add(verts, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#7e878a'))  # nose
    for sgn in (-1, 1):  # window eyes with a warm light
        v, f = lib.box((x + sgn * 0.24 * s, y - D / 2 - 0.01, z0 + H * 0.6), (0.18 * s, 0.03, 0.13 * s))
        P.b['glow'].add(v, f, col('#ffe29a'))
    v, f = lib.box((x, y - D / 2 - 0.01, z0 + H * 0.34), (0.5 * s, 0.03, 0.06 * s))  # the grin
    P.b['paint'].add(v, f, col('#4a4f52'))
    verts = [(x, y - D / 2 - 0.02, z0 + H * 0.12)] + [(x + math.cos(t) * 0.16 * s, y - D / 2 - 0.02, z0 + H * 0.12 + math.sin(t) * 0.2 * s) for t in np.linspace(0, math.pi, 12)]
    P.b['wood'].add(verts, [(0, i + 1, i + 2) for i in range(11)] + [(0, i + 2, i + 1) for i in range(11)], col('#6a4a30'))
    # ears and a flat cap
    for sgn in (-1, 1):
        v, f = lib.box((x + sgn * (Wd / 2 + 0.05 * s), y, z0 + H * 0.55), (0.1 * s, 0.3 * s, 0.5 * s))
        P.b['stone'].add(v, f, col('#8a9396'))
    v, f = lib.box((x, y, z0 + H + 0.05 * s), (Wd * 1.1, D * 1.1, 0.1 * s))
    P.b['stone'].add(v, f, col('#7e878a'))
    # bubbles rising beside it
    rng = np.random.default_rng(4)
    for k in range(14):
        bx_ = x + (rng.random() - 0.5) * 1.4 * s
        by_ = y - 0.2 * s - rng.random() * 0.5 * s
        bz = 0.05 + rng.random() * 1.9 * s
        v, f = lib.blob((bx_, by_, bz), (0.03 + rng.random() * 0.06) * s, rough=0.0, subdiv=2)
        P.b['crystal'].add(v, f, col('#d8f6ff'))
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
