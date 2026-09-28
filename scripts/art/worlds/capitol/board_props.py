"""Capitol Gardens' modelled pieces: generic civic-park architecture and garden features (original
designs; no flags, seals, emblems or signage). The basketball court and the putting green are built
to the same footprint so neither outranks the other.

Landmark builders return Blender objects (rendered as depth-sorted sprites); structure builders add
geometry to material builders (props.mats() keys plus the board's scatter keys) for the terrain.
Positions are board px of the ground anchor at z = 0.
"""
from __future__ import annotations

import math
import random

from mathutils import Vector

import lib
import props
from lib import board_to_world, col
from props import Prop

MARBLE = '#f4f1ea'
MARBLE_SH = '#e3ddd1'
TRIM = '#ffffff'
DOME = '#eef0f2'
ROOF = '#8b9aa8'
GOLD = '#f2c14e'
IRON = '#3a3f47'
FEST = ['#ff6b5e', '#f4b83b', '#1fa5a0', '#fff4dc']  # the game's festival colours


def _at(bx, by):
    return board_to_world(bx, by, 0.0)


def column(mb, x, y, z0, h, r, colour=MARBLE, sides=12):
    """A classical column: square base, a slightly tapering shaft and a capital."""
    v, f = lib.box((x, y, z0 + r * 0.35), (r * 2.6, r * 2.6, r * 0.7))
    mb.add(v, f, col(MARBLE_SH))
    v, f = lib.cylinder((x, y, z0 + r * 0.7), r, r * 0.86, h - r * 1.5, sides)
    mb.add(v, f, col(colour))
    v, f = lib.lathe([(r * 0.9, 0.0), (r * 1.25, r * 0.4), (r * 1.25, r * 0.55), (0.0, r * 0.55)], sides, (x, y, z0 + h - r * 0.8))
    mb.add(v, f, col(colour))


def hipped(mb, x, y, z0, w, d, h, colour):
    """A plain hipped roof over a w x d rectangle (ridge along x)."""
    r = max(0.0, (w - d) / 2)
    verts = [(x - w / 2, y - d / 2, z0), (x + w / 2, y - d / 2, z0), (x + w / 2, y + d / 2, z0), (x - w / 2, y + d / 2, z0),
             (x - r, y, z0 + h), (x + r, y, z0 + h)]
    faces = [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4), (3, 2, 1, 0)]
    mb.add(verts, faces, col(colour))


def pediment(mb, x, y, z0, w, h, depth, colour=MARBLE):
    """A triangular pediment (facing -Y) with a cornice."""
    tri = [(x - w / 2, y - depth / 2, z0), (x + w / 2, y - depth / 2, z0), (x, y - depth / 2, z0 + h)]
    mb.add(tri, [(0, 1, 2), (2, 1, 0)], col(colour))
    for side in (-1, 1):
        a = Vector((x + side * w / 2 * 1.06, y - depth / 2 - 0.03, z0 - 0.02))
        b = Vector((x, y - depth / 2 - 0.03, z0 + h + 0.05))
        v, f = lib.tube([tuple(a), tuple(b)], 0.05, 6)
        mb.add(v, f, col(TRIM))
    # roof slopes behind it
    for side in (-1, 1):
        q = [(x + side * w / 2, y - depth / 2, z0), (x, y - depth / 2, z0 + h), (x, y + depth / 2, z0 + h), (x + side * w / 2, y + depth / 2, z0)]
        mb.add(q, [(0, 1, 2, 3), (3, 2, 1, 0)], col(ROOF))


# ------------------------------------------------------------------------------------------
def domed_hall(bx, by, s=1.0) -> list:
    """A grand domed hall: a stepped plinth, a long marble block with tall windows, a columned
    portico and pediment, a colonnaded drum, a ribbed dome and a small lantern with a gold finial."""
    p = _at(bx, by)
    P = Prop('domed_hall')
    x, y = p.x, p.y
    W, D = 2.9 * s, 1.5 * s
    # plinth and the front stair
    v, f = lib.box((x, y, 0.1 * s), (W + 0.3 * s, D + 0.4 * s, 0.2 * s))
    P.b['stone'].add(v, f, col('#e6e1d6'))
    for k in range(4):
        v, f = lib.box((x, y - D / 2 - 0.22 * s - 0.12 * k * s, (0.17 - 0.045 * k) * s), (1.3 * s - 0.05 * k * s, 0.14 * s, 0.07 * s))
        P.b['stone'].add(v, f, col('#ece7dd'))
    # main block with windows
    bh = 1.05 * s
    v, f = lib.box((x, y, 0.2 * s + bh / 2), (W, D, bh))
    P.b['paint'].add(v, f, col(MARBLE))
    v, f = lib.box((x, y, 0.2 * s + bh + 0.05 * s), (W + 0.1 * s, D + 0.1 * s, 0.1 * s))
    P.b['paint'].add(v, f, col(TRIM))
    for i in range(10):
        wx = x - W / 2 + W * (i + 0.5) / 10
        if abs(wx - x) < 0.75 * s:
            continue
        v, f = lib.box((wx, y - D / 2 - 0.01, 0.2 * s + bh * 0.52), (0.14 * s, 0.03, 0.46 * s))
        P.b['glow'].add(v, f, col('#bcd6ee'))
        v, f = lib.box((wx, y - D / 2 - 0.02, 0.2 * s + bh * 0.8), (0.2 * s, 0.04, 0.05 * s))
        P.b['paint'].add(v, f, col(TRIM))
    # portico: six columns, entablature, pediment
    pw, pd = 1.5 * s, 0.5 * s
    py = y - D / 2 - pd / 2
    for i in range(6):
        cx = x - pw / 2 + pw * i / 5
        column(P.b['paint'], cx, py - pd * 0.3, 0.2 * s, bh, 0.07 * s)
    v, f = lib.box((x, py, 0.2 * s + bh + 0.06 * s), (pw + 0.24 * s, pd + 0.1 * s, 0.14 * s))
    P.b['paint'].add(v, f, col(TRIM))
    pediment(P.b['paint'], x, py, 0.2 * s + bh + 0.13 * s, pw + 0.24 * s, 0.38 * s, pd + 0.1 * s)
    # drum with a ring of pilaster columns
    zt = 0.2 * s + bh + 0.1 * s
    v, f = lib.lathe([(0.95 * s, 0.0), (0.95 * s, 0.12 * s), (0.82 * s, 0.12 * s)], 36, (x, y + 0.05 * s, zt))
    P.b['paint'].add(v, f, col(MARBLE_SH))
    zt += 0.12 * s
    v, f = lib.lathe([(0.72 * s, 0.0), (0.72 * s, 0.62 * s)], 36, (x, y + 0.05 * s, zt), cap_bottom=False, cap_top=False)
    P.b['paint'].add(v, f, col(MARBLE))
    for k in range(16):
        a = k / 16 * math.tau
        column(P.b['paint'], x + math.cos(a) * 0.8 * s, y + 0.05 * s + math.sin(a) * 0.8 * s, zt, 0.62 * s, 0.04 * s, sides=8)
    v, f = lib.lathe([(0.9 * s, 0.62 * s), (0.9 * s, 0.7 * s), (0.0, 0.7 * s)], 36, (x, y + 0.05 * s, zt))
    P.b['paint'].add(v, f, col(TRIM))
    zt += 0.7 * s
    # ribbed dome
    R = 0.78 * s
    prof = [(R * math.cos(t), zt + R * 1.12 * math.sin(t)) for t in [i / 14 * math.pi / 2 for i in range(15)]]
    prof[-1] = (0.0, prof[-1][1])
    v, f = lib.lathe(prof, 40, (x, y + 0.05 * s, 0), cap_bottom=False, cap_top=False)
    P.b['paint'].add(v, f, col(DOME))
    for k in range(12):
        a = k / 12 * math.tau
        pts = [(x + math.cos(a) * (R + 0.015) * math.cos(t), y + 0.05 * s + math.sin(a) * (R + 0.015) * math.cos(t), zt + (R + 0.015) * 1.12 * math.sin(t))
               for t in [i / 10 * math.pi / 2 * 0.92 for i in range(11)]]
        v, f = lib.tube(pts, 0.025 * s, 5)
        P.b['paint'].add(v, f, col(TRIM))
    # lantern and finial
    zl = zt + R * 1.12 - 0.05 * s
    for k in range(8):
        a = k / 8 * math.tau
        v, f = lib.cylinder((x + math.cos(a) * 0.14 * s, y + 0.05 * s + math.sin(a) * 0.14 * s, zl), 0.02 * s, 0.02 * s, 0.26 * s, 6)
        P.b['paint'].add(v, f, col(MARBLE))
    v, f = lib.lathe([(0.19 * s, 0.26 * s), (0.19 * s, 0.3 * s), (0.12 * s, 0.4 * s), (0.0, 0.44 * s)], 16, (x, y + 0.05 * s, zl))
    P.b['paint'].add(v, f, col(DOME))
    v, f = lib.lathe([(0.04 * s, 0.44 * s), (0.02 * s, 0.62 * s), (0.0, 0.64 * s)], 10, (x, y + 0.05 * s, zl))
    P.b['metal'].add(v, f, col(GOLD))
    v, f = lib.blob((x, y + 0.05 * s, zl + 0.66 * s), 0.05 * s, rough=0.0, subdiv=2)
    P.b['metal'].add(v, f, col(GOLD))
    return P.build()


def obelisk(bx, by, s=1.0) -> list:
    """A tall stone obelisk: a three-step base, a tapering square shaft and a pyramid cap."""
    p = _at(bx, by)
    P = Prop('obelisk')
    x, y = p.x, p.y
    for k, (w, h) in enumerate([(1.0, 0.12), (0.8, 0.12), (0.6, 0.12)]):
        v, f = lib.box((x, y, (0.06 + 0.12 * k) * s), (w * s, w * s, h * s))
        P.b['stone'].add(v, f, col(['#dcd6ca', '#e4dfd4', '#ebe6dc'][k]))
    z0 = 0.36 * s
    H = 3.9 * s
    b0, b1 = 0.21 * s, 0.14 * s
    verts = [(x - b0, y - b0, z0), (x + b0, y - b0, z0), (x + b0, y + b0, z0), (x - b0, y + b0, z0),
             (x - b1, y - b1, z0 + H), (x + b1, y - b1, z0 + H), (x + b1, y + b1, z0 + H), (x - b1, y + b1, z0 + H),
             (x, y, z0 + H + 0.26 * s)]
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 8), (5, 6, 8), (6, 7, 8), (7, 4, 8), (3, 2, 1, 0)]
    P.b['paint'].add(verts, faces, lambda vv: col('#f2efe8') if vv[2] < z0 + H * 0.5 else col('#f7f5f0'))
    return P.build()


def mansion(bx, by, s=1.0) -> list:
    """A white columned mansion: a two-storey main block with rows of tall windows and dark shutters,
    a central portico of four columns under a pediment, lower side wings, a balustraded roof edge
    and chimneys."""
    p = _at(bx, by)
    P = Prop('mansion')
    x, y = p.x, p.y
    W, D, H = 2.2 * s, 1.15 * s, 1.35 * s
    v, f = lib.box((x, y, 0.07 * s), (W + 1.7 * s, D + 0.3 * s, 0.14 * s))
    P.b['stone'].add(v, f, col('#e3ddd1'))
    v, f = lib.box((x, y, 0.14 * s + H / 2), (W, D, H))
    P.b['paint'].add(v, f, col(MARBLE))
    for sx in (-1, 1):
        v, f = lib.box((x + sx * (W / 2 + 0.42 * s), y + 0.08 * s, 0.14 * s + 0.45 * s), (0.84 * s, D * 0.8, 0.9 * s))
        P.b['paint'].add(v, f, col('#f1ede5'))
        v, f = lib.box((x + sx * (W / 2 + 0.42 * s), y + 0.08 * s, 0.14 * s + 0.93 * s), (0.9 * s, D * 0.86, 0.06 * s))
        P.b['paint'].add(v, f, col(TRIM))
        for k in range(3):
            wx = x + sx * (W / 2 + 0.16 * s + 0.26 * k * s)
            v, f = lib.box((wx, y + 0.08 * s - D * 0.4 - 0.01, 0.14 * s + 0.42 * s), (0.12 * s, 0.03, 0.4 * s))
            P.b['glow'].add(v, f, col('#c9def0'))
    # two rows of windows with shutters on the main block
    for row, zc in enumerate((0.45, 1.0)):
        for i in range(7):
            wx = x - W / 2 + W * (i + 0.5) / 7
            if abs(wx - x) < 0.45 * s:
                continue
            v, f = lib.box((wx, y - D / 2 - 0.01, 0.14 * s + zc * s), (0.14 * s, 0.03, 0.36 * s))
            P.b['glow'].add(v, f, col('#c9def0'))
            for sh in (-1, 1):
                v, f = lib.box((wx + sh * 0.12 * s, y - D / 2 - 0.015, 0.14 * s + zc * s), (0.06 * s, 0.03, 0.36 * s))
                P.b['wood'].add(v, f, col('#3c5a6e'))
    # cornice and balustrade
    v, f = lib.box((x, y, 0.14 * s + H + 0.05 * s), (W + 0.12 * s, D + 0.12 * s, 0.1 * s))
    P.b['paint'].add(v, f, col(TRIM))
    for i in range(24):
        bxp = x - W / 2 + W * i / 23
        v, f = lib.cylinder((bxp, y - D / 2 - 0.02, 0.14 * s + H + 0.1 * s), 0.025 * s, 0.025 * s, 0.16 * s, 6)
        P.b['paint'].add(v, f, col(TRIM))
    v, f = lib.box((x, y - D / 2 - 0.02, 0.14 * s + H + 0.28 * s), (W, 0.07 * s, 0.05 * s))
    P.b['paint'].add(v, f, col(TRIM))
    # low hipped roof and chimneys
    hipped(P.b['paint'], x, y, 0.14 * s + H + 0.1 * s, W * 0.94, D * 0.9, 0.32 * s, '#9aa6b2')
    for sx in (-1, 1):
        v, f = lib.box((x + sx * W * 0.34, y + 0.1 * s, 0.14 * s + H + 0.45 * s), (0.16 * s, 0.14 * s, 0.4 * s))
        P.b['stone'].add(v, f, col('#e6e1d6'))
    # central portico
    pw, pd = 1.1 * s, 0.55 * s
    py = y - D / 2 - pd / 2
    for i in range(4):
        cx = x - pw / 2 + pw * i / 3
        column(P.b['paint'], cx, py - pd * 0.3, 0.14 * s, H - 0.05 * s, 0.075 * s)
    v, f = lib.box((x, py, 0.14 * s + H), (pw + 0.22 * s, pd + 0.1 * s, 0.14 * s))
    P.b['paint'].add(v, f, col(TRIM))
    pediment(P.b['paint'], x, py, 0.14 * s + H + 0.07 * s, pw + 0.22 * s, 0.34 * s, pd + 0.1 * s)
    # front door
    v, f = lib.box((x, y - D / 2 - 0.015, 0.14 * s + 0.35 * s), (0.3 * s, 0.03, 0.62 * s))
    P.b['wood'].add(v, f, col('#6e4a2c'))
    v, f = lib.box((x, y - D / 2 - 0.02, 0.14 * s + 0.76 * s), (0.36 * s, 0.03, 0.14 * s))
    P.b['glow'].add(v, f, col('#ffe7b0'))
    # front steps
    for k in range(3):
        v, f = lib.box((x, py - pd * 0.5 - 0.1 * s - 0.1 * k * s, (0.12 - 0.04 * k) * s), (pw + 0.1 * s, 0.12 * s, 0.05 * s))
        P.b['stone'].add(v, f, col('#ece7dd'))
    return P.build()


def garden_gate(bx, by, s=1.0) -> list:
    """The Cherry Avenue's garden gate: two stone piers topped with urns of flowers and an openwork
    iron arch between them (the arch stands open; the key opens the way)."""
    p = _at(bx, by)
    P = Prop('garden_gate')
    x, y = p.x, p.y
    for sx in (-1, 1):
        px = x + sx * 0.7 * s
        v, f = lib.box((px, y, 0.5 * s), (0.28 * s, 0.28 * s, 1.0 * s))
        P.b['stone'].add(v, f, col('#ebe6dc'))
        v, f = lib.box((px, y, 1.04 * s), (0.34 * s, 0.34 * s, 0.08 * s))
        P.b['stone'].add(v, f, col('#f4f0e8'))
        v, f = lib.lathe([(0.06 * s, 0.0), (0.12 * s, 0.1 * s), (0.1 * s, 0.2 * s), (0.13 * s, 0.24 * s)], 14, (px, y, 1.08 * s))
        P.b['stone'].add(v, f, col('#e3ddd1'))
        for k in range(5):
            a = k / 5 * math.tau
            v, f = lib.blob((px + math.cos(a) * 0.07 * s, y + math.sin(a) * 0.07 * s, 1.36 * s), 0.07 * s, rough=0.2, subdiv=1, seed=k)
            P.b['leaf'].add(v, f, col(['#ff5d73', '#ff8fa8', '#ffd1dc'][k % 3]))
    pts = [(x + math.cos(t) * 0.7 * s, y, 1.1 * s + math.sin(t) * 0.42 * s) for t in [i / 16 * math.pi for i in range(17)]]
    v, f = lib.tube(pts, 0.035 * s, 6)
    P.b['metal'].add(v, f, col(IRON))
    pts2 = [(x + math.cos(t) * 0.6 * s, y, 1.1 * s + math.sin(t) * 0.33 * s) for t in [i / 16 * math.pi for i in range(17)]]
    v, f = lib.tube(pts2, 0.025 * s, 6)
    P.b['metal'].add(v, f, col(IRON))
    for k in range(7):
        t = (k + 0.5) / 7 * math.pi
        a = (x + math.cos(t) * 0.6 * s, y, 1.1 * s + math.sin(t) * 0.33 * s)
        b = (x + math.cos(t) * 0.7 * s, y, 1.1 * s + math.sin(t) * 0.42 * s)
        v, f = lib.tube([a, b], 0.018 * s, 5)
        P.b['metal'].add(v, f, col(IRON))
    v, f = lib.blob((x, y, 1.58 * s), 0.06 * s, rough=0.0, subdiv=2)
    P.b['metal'].add(v, f, col(GOLD))
    return P.build()


def rose_arbor(bx, by, s=1.0) -> list:
    """A white trellis arch smothered in climbing roses."""
    p = _at(bx, by)
    P = Prop('rose_arbor')
    x, y = p.x, p.y
    rnd = random.Random(8)
    for sx in (-1, 1):
        for sy in (-1, 1):
            v, f = lib.box((x + sx * 0.45 * s, y + sy * 0.18 * s, 0.6 * s), (0.05 * s, 0.05 * s, 1.2 * s))
            P.b['paint'].add(v, f, col(TRIM))
    for sy in (-1, 1):
        pts = [(x + math.cos(t) * 0.45 * s, y + sy * 0.18 * s, 1.2 * s + math.sin(t) * 0.3 * s) for t in [i / 12 * math.pi for i in range(13)]]
        v, f = lib.tube(pts, 0.03 * s, 6)
        P.b['paint'].add(v, f, col(TRIM))
    for k in range(40):
        t = rnd.uniform(0, 1)
        if rnd.random() < 0.5:
            a = t * math.pi
            q = (x + math.cos(a) * 0.45 * s, y + rnd.uniform(-0.22, 0.22) * s, 1.2 * s + math.sin(a) * 0.3 * s)
        else:
            sx = rnd.choice((-1, 1))
            q = (x + sx * 0.45 * s, y + rnd.uniform(-0.22, 0.22) * s, t * 1.2 * s)
        v, f = lib.blob(q, rnd.uniform(0.06, 0.1) * s, rough=0.25, subdiv=1, seed=k)
        P.b['leaf'].add(v, f, col(rnd.choice(['#3f8f35', '#4e9e3c', '#2f7a2d'])))
        if rnd.random() < 0.55:
            v, f = lib.blob((q[0], q[1] - 0.05 * s, q[2] + 0.03 * s), 0.04 * s, rough=0.1, subdiv=1, seed=k + 50)
            P.b['paint'].add(v, f, col(rnd.choice(['#ff4f6d', '#ff8fa8', '#ffffff', '#ff6b8a'])))
    return P.build()


def bandstand(bx, by, s=1.0) -> list:
    """A round white bandstand platform (the host stands on it) with a railing, steps and two
    pennant poles in the festival colours."""
    p = _at(bx, by)
    P = Prop('bandstand')
    x, y = p.x, p.y
    v, f = lib.lathe([(0.86 * s, 0.0), (0.86 * s, 0.22 * s), (0.82 * s, 0.26 * s), (0.0, 0.26 * s)], 36, (x, y, 0))
    P.b['paint'].add(v, f, col(MARBLE))
    v, f = lib.lathe([(0.87 * s, 0.14 * s), (0.88 * s, 0.14 * s), (0.88 * s, 0.2 * s), (0.87 * s, 0.2 * s)], 36, (x, y, 0))
    P.b['metal'].add(v, f, col(GOLD))
    for k in range(22):
        a = k / 22 * math.tau
        if math.sin(a) < -0.55:
            continue  # open at the front
        v, f = lib.cylinder((x + math.cos(a) * 0.8 * s, y + math.sin(a) * 0.8 * s, 0.26 * s), 0.018 * s, 0.018 * s, 0.26 * s, 6)
        P.b['paint'].add(v, f, col(TRIM))
    pts = [(x + math.cos(a) * 0.8 * s, y + math.sin(a) * 0.8 * s, 0.52 * s) for a in [math.radians(-57 + i * 7) for i in range(1, 51)] if math.sin(a) >= -0.55]
    v, f = lib.tube(pts, 0.022 * s, 6)
    P.b['paint'].add(v, f, col(TRIM))
    for k in range(3):
        v, f = lib.box((x, y - 0.86 * s - 0.1 * s - 0.1 * k * s, (0.2 - 0.07 * k) * s), (0.6 * s, 0.12 * s, 0.06 * s))
        P.b['stone'].add(v, f, col('#ece7dd'))
    for k, a in enumerate((2.3, 0.84)):
        px, py = x + math.cos(a) * 0.74 * s, y + math.sin(a) * 0.74 * s
        v, f = lib.cylinder((px, py, 0.26 * s), 0.03 * s, 0.025 * s, 1.2 * s, 8)
        P.b['metal'].add(v, f, col(GOLD))
        tri = [(px, py, 1.44 * s), (px, py, 1.14 * s), (px + (0.4 if k else -0.4) * s, py, 1.29 * s)]
        P.b['paint'].add(tri, [(0, 1, 2), (2, 1, 0)], col(FEST[k * 2]))
    return P.build()


def lamp_post_sprite(bx, by, s=1.0) -> list:
    """A black iron park lamp with a white glass globe."""
    p = _at(bx, by)
    P = Prop('lamp')
    lamp(P.b, p.x, p.y, s)
    return P.build()


# ------------------------------------------------------------------------------------------
# Structures (baked)
def lamp(B, x, y, s=1.0):
    v, f = lib.lathe([(0.09 * s, 0.0), (0.07 * s, 0.1 * s), (0.035 * s, 0.14 * s)], 10, (x, y, 0))
    B['metal'].add(v, f, col(IRON))
    v, f = lib.cylinder((x, y, 0.1 * s), 0.028 * s, 0.022 * s, 1.1 * s, 8)
    B['metal'].add(v, f, col(IRON))
    v, f = lib.blob((x, y, 1.3 * s), 0.1 * s, rough=0.0, subdiv=2)
    B['glow'].add(v, f, col('#fff8e8'))
    v, f = lib.lathe([(0.06 * s, 0.0), (0.03 * s, 0.05 * s)], 10, (x, y, 1.39 * s))
    B['metal'].add(v, f, col(IRON))


def fountain(B, bx, by, s=1.0):
    """A round fountain: a stone basin of water, a two-tier centre piece and arcs of spray."""
    p = _at(bx, by)
    x, y = p.x, p.y
    R = 0.62 * s
    v, f = lib.lathe([(R + 0.06 * s, 0.0), (R + 0.06 * s, 0.2 * s), (R - 0.02 * s, 0.22 * s), (R - 0.04 * s, 0.1 * s), (0.0, 0.1 * s)], 44, (x, y, 0), squash_y=1.0)
    B['stone'].add(v, f, col('#ebe6dc'))
    v, f = lib.lathe([(R - 0.04 * s, 0.16 * s), (0.0, 0.16 * s)], 44, (x, y, 0), cap_bottom=False, cap_top=False)
    B['ponds'].add(v, f, (1, 1, 1, 1))
    v, f = lib.lathe([(0.12 * s, 0.1 * s), (0.08 * s, 0.5 * s), (0.3 * s, 0.56 * s), (0.3 * s, 0.62 * s), (0.08 * s, 0.64 * s), (0.06 * s, 0.9 * s),
                      (0.16 * s, 0.94 * s), (0.16 * s, 0.98 * s), (0.0, 1.0 * s)], 24, (x, y, 0))
    B['stone'].add(v, f, col('#f1ede5'))
    for (zr, rr, n, h) in [(1.0, 0.03, 1, 0.3), (0.62, 0.26, 8, 0.14)]:
        for k in range(n):
            a = k / max(1, n) * math.tau
            sx, sy = x + math.cos(a) * rr * s, y + math.sin(a) * rr * s
            pts = []
            for i in range(9):
                t = i / 8
                reach = (0.0 if n == 1 else 0.28) * s * t
                pts.append((sx + math.cos(a) * reach, sy + math.sin(a) * reach, zr * s + h * s * math.sin(t * math.pi) * 1.4 + (0.3 * s * (1 - t) if n == 1 else 0) - (0.3 * s * t if n == 1 else 0.5 * s * t * t)))
            v, f = lib.tube(pts, 0.025 * s, 6)
            B['water'].add(v, f, (1, 1, 1, 1))


def reflecting_pool(B, x0, y0, x1, y1):
    """A long rectangular pool (board px corners) with a pale stone kerb."""
    a = _at(x0, y0)
    b = _at(x1, y1)
    cx, cy = (a.x + b.x) / 2, (a.y + b.y) / 2
    w, d = abs(b.x - a.x), abs(b.y - a.y)
    v, f = lib.box((cx, cy, 0.03), (w + 0.2, d + 0.2, 0.06))
    B['stone'].add(v, f, col('#ebe6dc'))
    v, f = lib.box((cx, cy, 0.035), (w, d, 0.02))
    B['ponds'].add(v, f, (1, 1, 1, 1))
    for (px, py) in ((cx - w / 2 - 0.1, cy), (cx + w / 2 + 0.1, cy)):
        v, f = lib.box((px, py, 0.06), (0.14, d + 0.34, 0.12))
        B['stone'].add(v, f, col('#e3ddd1'))


def court(B, bx, by, s=1.0):
    """A basketball court: a painted surface with white lines (centre circle, keys, three-point
    arcs), a hoop at each end and a ball."""
    p = _at(bx, by)
    x, y = p.x, p.y
    W, D = 2.5 * s, 1.5 * s
    v, f = lib.box((x, y, 0.015), (W + 0.3 * s, D + 0.3 * s, 0.03))
    B['paint'].add(v, f, col('#c46b3c'))
    v, f = lib.box((x, y, 0.032), (W, D, 0.01))
    B['paint'].add(v, f, col('#3d7fb8'))
    for sx in (-1, 1):
        v, f = lib.box((x + sx * W * 0.39, y, 0.036), (W * 0.22, D * 0.34, 0.006))
        B['paint'].add(v, f, col('#c46b3c'))
    line = col('#ffffff')

    def seg(a, b, w=0.025):
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1.0
        v, f = lib.box(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.041), (L + w, w, 0.004), rot_z=math.atan2(dy, dx))
        B['paint'].add(v, f, line)

    hx, hy = W / 2, D / 2
    for (a, b) in [((x - hx, y - hy), (x + hx, y - hy)), ((x - hx, y + hy), (x + hx, y + hy)), ((x - hx, y - hy), (x - hx, y + hy)), ((x + hx, y - hy), (x + hx, y + hy)), ((x, y - hy), (x, y + hy))]:
        seg(a, b)
    for (r, n) in [(0.22 * s, 20)]:
        pts = [(x + math.cos(t) * r, y + math.sin(t) * r) for t in [i / n * math.tau for i in range(n + 1)]]
        for i in range(n):
            seg(pts[i], pts[i + 1])
    for sx in (-1, 1):
        ex = x + sx * hx
        k0, k1 = ex - sx * W * 0.28, ex
        for (a, b) in [((k0, y - D * 0.17), (k1, y - D * 0.17)), ((k0, y + D * 0.17), (k1, y + D * 0.17)), ((k0, y - D * 0.17), (k0, y + D * 0.17))]:
            seg(a, b)
        n = 18
        arc = [(ex - sx * math.cos(t) * W * 0.36, y + math.sin(t) * D * 0.42) for t in [-math.pi / 2 + i / n * math.pi for i in range(n + 1)]]
        for i in range(n):
            seg(arc[i], arc[i + 1])
        # hoop: a post, an arm, a backboard and an orange rim
        post = (ex + sx * 0.18 * s, y)
        v, f = lib.cylinder((post[0], post[1], 0.0), 0.045 * s, 0.04 * s, 1.25 * s, 10)
        B['metal'].add(v, f, col('#5b6470'))
        v, f = lib.box((ex + sx * 0.06 * s, y, 1.2 * s), (0.26 * s, 0.05 * s, 0.05 * s))
        B['metal'].add(v, f, col('#5b6470'))
        v, f = lib.box((ex - sx * 0.02 * s, y, 1.28 * s), (0.04 * s, 0.5 * s, 0.32 * s))
        B['paint'].add(v, f, col('#ffffff'))
        v, f = lib.box((ex - sx * 0.035 * s, y, 1.24 * s), (0.02 * s, 0.18 * s, 0.13 * s))
        B['paint'].add(v, f, col('#e05a3a'))
        v, f = lib.lathe([(0.1 * s, 0.0), (0.11 * s, 0.0), (0.11 * s, 0.015 * s), (0.1 * s, 0.015 * s)], 16, (ex - sx * 0.16 * s, y, 1.16 * s), cap_bottom=False, cap_top=False)
        B['metal'].add(v, f, col('#ff6a2a'))
    v, f = lib.blob((x + 0.42 * s, y + 0.22 * s, 0.08 * s), 0.07 * s, rough=0.0, subdiv=2)
    B['paint'].add(v, f, lambda vv: col('#e8692a') if abs(vv[0] - (x + 0.42 * s)) > 0.01 else col('#3a2418'))


def putting_green(B, bx, by, s=1.0, flag='#ff6b5e'):
    """A putting green the same size as the court: a rounded patch of close-cut grass with a fringe,
    a hole with a flagstick (a plain pennant in a festival colour), a sand bunker and a couple of balls."""
    p = _at(bx, by)
    x, y = p.x, p.y
    W, D = 2.5 * s, 1.5 * s
    rnd = random.Random(4)
    n = 48
    ring = []
    for k in range(n):
        a = k / n * math.tau
        r = 1.0 + 0.08 * math.sin(a * 3 + 0.6) + 0.05 * math.sin(a * 5)
        ring.append((math.cos(a) * r, math.sin(a) * r))
    for (scale, z, c) in [(1.12, 0.012, '#5aa83c'), (1.0, 0.022, '#86d05a')]:
        verts = [(x, y, z)] + [(x + u * W / 2 * scale, y + v * D / 2 * scale, z) for (u, v) in ring]
        faces = [(0, i + 1, (i + 1) % n + 1) for i in range(n)]
        B['grass_flat'].add(verts, faces, col(c))
    # mown stripes
    for i in range(-3, 4):
        verts = [(x + i * W * 0.12 - W * 0.04, y - D * 0.38, 0.024), (x + i * W * 0.12 + W * 0.04, y - D * 0.38, 0.024),
                 (x + i * W * 0.12 + W * 0.04, y + D * 0.38, 0.024), (x + i * W * 0.12 - W * 0.04, y + D * 0.38, 0.024)]
        if abs(i * W * 0.12) < W * 0.42:
            B['grass_flat'].add(verts, [(0, 1, 2, 3)], col('#93d964'))
    # bunker
    bxw, byw = x - W * 0.3, y + D * 0.28
    verts = [(bxw, byw, 0.026)] + [(bxw + math.cos(a) * 0.36 * s * (1 + 0.1 * math.sin(a * 3)), byw + math.sin(a) * 0.2 * s, 0.026) for a in [k / 24 * math.tau for k in range(24)]]
    B['grass_flat'].add(verts, [(0, i + 1, (i + 1) % 24 + 1) for i in range(24)], col('#ecd9a6'))
    # hole, cup and flagstick
    hx, hy = x + W * 0.18, y - D * 0.08
    v, f = lib.lathe([(0.055 * s, 0.0), (0.0, 0.0)], 16, (hx, hy, 0.028), cap_bottom=False, cap_top=False)
    B['paint'].add(v, f, col('#1d2a1a'))
    v, f = lib.cylinder((hx, hy, 0.0), 0.014 * s, 0.012 * s, 1.35 * s, 6)
    B['paint'].add(v, f, col('#ffffff'))
    tri = [(hx, hy, 1.35 * s), (hx, hy, 1.08 * s), (hx + 0.42 * s, hy, 1.22 * s)]
    B['paint'].add(tri, [(0, 1, 2), (2, 1, 0)], col(flag))
    for (ox, oy) in [(-0.3, -0.1), (0.05, 0.2)]:
        v, f = lib.blob((x + ox * s, y + oy * s, 0.05 * s), 0.035 * s, rough=0.0, subdiv=2)
        B['paint'].add(v, f, col('#ffffff'))
    _ = rnd


def hedge(B, ax, ay, bx, by, h=0.2, w=0.2, colour='#2f7a33'):
    """A clipped box hedge between two board points."""
    a = _at(ax, ay)
    b = _at(bx, by)
    L = (b - a).length
    v, f = lib.box(((a.x + b.x) / 2, (a.y + b.y) / 2, h / 2), (L, w, h), rot_z=math.atan2(b.y - a.y, b.x - a.x))
    B['hedges'].add(v, f, col(colour))


def rose_bed(B, bx, by, rnd, rx=60, ry=26, n=12):
    """A bed of rose bushes (board px ellipse) inside a clipped hedge border."""
    for _ in range(n):
        a = rnd.uniform(0, math.tau)
        r = math.sqrt(rnd.random())
        p = _at(bx + math.cos(a) * rx * r * 0.8, by + math.sin(a) * ry * r * 0.8)
        v, f = lib.blob((p.x, p.y, 0.1), rnd.uniform(0.08, 0.12), squash=(1, 1, 0.8), rough=0.25, subdiv=1, seed=rnd.random() * 40)
        B['hedges'].add(v, f, col(rnd.choice(['#2f7a2d', '#3f8f35', '#357f30'])))
        for _k in range(3):
            q = (p.x + rnd.uniform(-0.07, 0.07), p.y + rnd.uniform(-0.07, 0.07), 0.16 + rnd.uniform(0, 0.05))
            v, f = lib.blob(q, 0.035, rough=0.15, subdiv=1, seed=rnd.random() * 40)
            B['flowers'].add(v, f, col(rnd.choice(['#e8324f', '#ff5d73', '#ff8fa8', '#ffffff', '#ffd1dc', '#d81f3f'])))
    n2 = 28
    pts = [(bx + math.cos(t) * rx, by + math.sin(t) * ry) for t in [i / n2 * math.tau for i in range(n2 + 1)]]
    for i in range(n2):
        hedge(B, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], h=0.12, w=0.1)


def cypress(B, bx, by, rnd, s=1.0):
    """A tall narrow cypress (formal garden accent)."""
    p = _at(bx, by)
    h = rnd.uniform(1.5, 1.9) * s
    v, f = lib.cylinder((p.x, p.y, 0), 0.05 * s, 0.04 * s, 0.25 * s, 6)
    B['trunks'].add(v, f, col('#5e3b22'))
    v, f = lib.blob((p.x, p.y, 0.2 * s + h / 2), 0.26 * s, squash=(1, 1, h / (0.52 * s)), rough=0.15, freq=2.4, subdiv=3, seed=rnd.random() * 50)
    B['leaves'].add(v, f, lambda vv: lib.lerp_col(col('#1f5a2e'), col('#4f9a45'), max(0.0, min(1.0, (vv[2] - 0.2 * s) / h))))


def bench(B, bx, by, s=1.0, rot=0.0):
    p = _at(bx, by)
    for (ox, oz, w, h) in [(0.0, 0.2, 0.55, 0.04), (0.0, 0.36, 0.55, 0.12)]:
        v, f = lib.box((p.x, p.y + (0.0 if oz < 0.3 else 0.09) * s, oz * s), (w * s, (0.16 if oz < 0.3 else 0.03) * s, h * s), rot_z=rot)
        B['wood'].add(v, f, col('#9c6a3a'))
    for sx in (-1, 1):
        v, f = lib.box((p.x + sx * 0.24 * s, p.y, 0.1 * s), (0.04 * s, 0.16 * s, 0.2 * s), rot_z=rot)
        B['metal'].add(v, f, col(IRON))
