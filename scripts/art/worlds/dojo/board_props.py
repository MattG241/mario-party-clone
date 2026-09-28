"""Dojo Summit's modelled pieces (original designs, generic mountain-dojo motifs; no signage).

Landmark builders return Blender objects (rendered as depth-sorted sprites); structure builders add
geometry to material builders (props.mats() keys) for the terrain render. Positions are board px of
the ground anchor at z = 0; the board script lifts everything onto its island's height.
"""
from __future__ import annotations

import math
import random

from mathutils import Vector

import lib
import props
from lib import board_to_world, col
from props import Prop

VERMILION = '#d8452e'
VERMILION_DK = '#a8321f'
TILE = ['#3d4b5e', '#46566b', '#36434f', '#4f6075']
PLASTER = '#f6efe0'
TIMBER = '#5a3a26'
GOLD = '#f2c14e'
STONE = '#cfc8bb'
STONE_DK = '#a79f93'


def _at(bx, by):
    return board_to_world(bx, by, 0.0)


# ------------------------------------------------------------------------------------------
# Roofs
def hip_roof(mb, x, y, z0, w, d, h, over=0.25, upturn=0.12, n=10, pal=TILE, rnd=None, thick=0.07):
    """A tiled hip roof over a w x d body (world units) whose eave sits at z0: a concave pyramid with
    upturned corners and rows of tiles (alternating shades), plus an eave band underneath."""
    rnd = rnd or random.Random(3)
    W, D = w / 2 + over, d / 2 + over
    verts, faces, cols = [], [], []
    for j in range(n + 1):
        for i in range(n + 1):
            u, v = i / n * 2 - 1, j / n * 2 - 1
            m = max(abs(u), abs(v))
            zz = z0 + h * (1 - m) ** 0.75 + upturn * (abs(u) * abs(v)) ** 3 + upturn * 0.35 * m ** 6
            verts.append((x + u * W, y + v * D, zz))
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            faces.append((a, a + 1, a + n + 2, a + n + 1))
    for q in range(len(verts)):
        cols.append(None)
    # colour per vertex by tile row (distance to the rim), so rows read from the board camera
    out_cols = []
    for (vx, vy, vz) in verts:
        u, v = (vx - x) / W, (vy - y) / D
        m = max(abs(u), abs(v))
        row = int(m * n * 0.9)
        out_cols.append(col(pal[row % len(pal)]))
    mb.add(verts, faces, lambda vv, _c=iter(out_cols): next(_c))
    # eave band (the roof's thickness) all round
    ring = []
    for i in range(n + 1):
        ring.append(i)
    for j in range(1, n + 1):
        ring.append(j * (n + 1) + n)
    for i in range(n - 1, -1, -1):
        ring.append(n * (n + 1) + i)
    for j in range(n - 1, 0, -1):
        ring.append(j * (n + 1))
    bv, bf = [], []
    for k, idx in enumerate(ring):
        vx, vy, vz = verts[idx]
        bv.append((vx, vy, vz))
        bv.append((vx, vy, vz - thick))
    L = len(ring)
    for k in range(L):
        a, b = 2 * k, 2 * ((k + 1) % L)
        bf.append((a, b, b + 1, a + 1))
        bf.append((a + 1, b + 1, b, a))
    mb.add(bv, bf, col('#2b3440'))


def gable_roof(mb, x, y, z0, w, d, h, over=0.18, pal=('#c8553d', '#d8653f', '#b84a36'), rnd=None, axis='x'):
    """Pitched roof of tile rows (ridge along x): two sloping planes with overhangs and a ridge cap."""
    rnd = rnd or random.Random(5)
    rows = 6
    for side in (-1, 1):
        for k in range(rows):
            t0, t1 = k / rows, (k + 1) / rows + 0.04
            ya = y + side * (d / 2 + over) * (1 - t0)
            yb = y + side * (d / 2 + over) * (1 - min(1.0, t1))
            za = z0 + h * t0
            zb = z0 + h * min(1.0, t1)
            q = [(x - w / 2 - over, ya, za), (x + w / 2 + over, ya, za), (x + w / 2 + over, yb, zb), (x - w / 2 - over, yb, zb)]
            mb.add(q, [(0, 1, 2, 3)] if side < 0 else [(3, 2, 1, 0)], col(rnd.choice(pal)))
            lip = [(x - w / 2 - over, ya, za), (x + w / 2 + over, ya, za), (x + w / 2 + over, ya, za - 0.05), (x - w / 2 - over, ya, za - 0.05)]
            mb.add(lip, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#5a2418'))
    v, f = lib.box((x, y, z0 + h + 0.02), (w + 2 * over + 0.04, 0.08, 0.06))
    mb.add(v, f, col('#6b2a1c'))
    # gable ends
    for sx in (-1, 1):
        tri = [(x + sx * w / 2, y - d / 2, z0), (x + sx * w / 2, y + d / 2, z0), (x + sx * w / 2, y, z0 + h * 0.95)]
        mb.add(tri, [(0, 1, 2), (2, 1, 0)], col(PLASTER))


# ------------------------------------------------------------------------------------------
# Landmarks (sprites)
def pagoda(bx, by, s=1.0) -> list:
    """The summit dojo: a three-tier pagoda on a stone plinth, vermilion posts, plaster panels, dark
    tiled roofs with upturned eaves, a golden spire and lanterns under the eaves."""
    p = _at(bx, by)
    P = Prop('pagoda')
    x, y = p.x, p.y
    rnd = random.Random(12)
    # plinth: two stone steps and a front stair
    v, f = lib.box((x, y, 0.1 * s), (2.9 * s, 2.5 * s, 0.2 * s))
    P.b['stone'].add(v, f, col('#d9d2c6'))
    v, f = lib.box((x, y, 0.28 * s), (2.5 * s, 2.15 * s, 0.18 * s))
    P.b['stone'].add(v, f, col('#e6dfd3'))
    for k in range(3):
        v, f = lib.box((x, y - (1.25 + 0.14 * k) * s, (0.3 - 0.1 * k) * s), (0.9 * s, 0.14 * s, 0.1 * s))
        P.b['stone'].add(v, f, col('#d4ccc0'))
    z = 0.37 * s
    tiers = [(1.75, 0.95), (1.4, 0.72), (1.08, 0.64)]
    for ti, (w, h) in enumerate(tiers):
        w *= s
        h *= s
        d = w * 0.9
        # plaster body
        v, f = lib.box((x, y, z + h / 2), (w, d, h))
        P.b['paint'].add(v, f, col(PLASTER))
        # vermilion posts at the corners and along the front
        for i in range(5):
            px = x - w / 2 + w * i / 4
            v, f = lib.box((px, y - d / 2 - 0.02 * s, z + h / 2), (0.1 * s, 0.1 * s, h))
            P.b['paint'].add(v, f, col(VERMILION))
        for sx in (-1, 1):
            v, f = lib.box((x + sx * w / 2, y, z + h / 2), (0.1 * s, d, h))
            P.b['paint'].add(v, f, col(VERMILION_DK))
        # lintel and base beams
        for zz in (z + h - 0.05 * s, z + 0.05 * s):
            v, f = lib.box((x, y - d / 2 - 0.03 * s, zz), (w + 0.06 * s, 0.08 * s, 0.08 * s))
            P.b['wood'].add(v, f, col(TIMBER))
        # doors (ground tier) or lattice windows (upper tiers), warm light inside
        if ti == 0:
            v, f = lib.box((x, y - d / 2 - 0.035 * s, z + h * 0.42), (0.55 * s, 0.05 * s, h * 0.74))
            P.b['wood'].add(v, f, col('#7a4a2c'))
            for sx in (-1, 1):
                v, f = lib.box((x + sx * 0.52 * s, y - d / 2 - 0.035 * s, z + h * 0.55), (0.3 * s, 0.04 * s, h * 0.4))
                P.b['glow'].add(v, f, col('#ffd79a'))
        else:
            for sx in (-1, 0, 1):
                v, f = lib.box((x + sx * w * 0.28, y - d / 2 - 0.035 * s, z + h * 0.5), (w * 0.16, 0.04 * s, h * 0.45))
                P.b['glow'].add(v, f, col('#ffe0a8'))
        # balcony railing on the upper tiers
        if ti > 0:
            for i in range(9):
                px = x - w / 2 - 0.12 * s + (w + 0.24 * s) * i / 8
                v, f = lib.box((px, y - d / 2 - 0.14 * s, z + 0.12 * s), (0.035 * s, 0.035 * s, 0.24 * s))
                P.b['paint'].add(v, f, col(VERMILION))
            v, f = lib.box((x, y - d / 2 - 0.14 * s, z + 0.24 * s), (w + 0.26 * s, 0.04 * s, 0.04 * s))
            P.b['paint'].add(v, f, col(VERMILION_DK))
        # roof
        rz = z + h
        hip_roof(P.b['paint'], x, y, rz, w, d, 0.42 * s * (1 - ti * 0.1), over=0.34 * s, upturn=0.16 * s, rnd=rnd)
        # lanterns hanging from the front eave corners
        for sx in (-1, 1):
            lx, ly = x + sx * (w / 2 + 0.22 * s), y - d / 2 - 0.3 * s
            v, f = lib.tube([(lx, ly, rz - 0.02 * s), (lx, ly, rz - 0.14 * s)], 0.01 * s, 4)
            P.b['wood'].add(v, f, col(TIMBER))
            v, f = lib.blob((lx, ly, rz - 0.24 * s), 0.1 * s, squash=(1, 1, 1.25), rough=0.0, subdiv=2)
            P.b['glow'].add(v, f, col('#ff7a4a'))
        z = rz + 0.16 * s
    # spire: a golden rod with rings and a jewel
    top = z + 0.3 * s
    v, f = lib.lathe([(0.16 * s, z - 0.05 * s), (0.12 * s, z + 0.12 * s), (0.05 * s, z + 0.2 * s)], 12, (x, y, 0))
    P.b['metal'].add(v, f, col(GOLD))
    v, f = lib.cylinder((x, y, z), 0.035 * s, 0.03 * s, 1.1 * s, 8)
    P.b['metal'].add(v, f, col(GOLD))
    for k in range(6):
        rr = (0.13 - 0.012 * k) * s
        zz = z + (0.3 + 0.1 * k) * s
        v, f = lib.lathe([(rr, zz), (rr, zz + 0.035 * s), (0.02 * s, zz + 0.035 * s)], 16, (x, y, 0), cap_bottom=True)
        P.b['metal'].add(v, f, col('#e8b640'))
    v, f = lib.blob((x, y, z + 1.14 * s), 0.08 * s, squash=(1, 1, 1.3), rough=0.0, subdiv=2)
    P.b['crystal'].add(v, f, col('#ffcf6e'))
    _ = top
    return P.build()


def shrine_gate(bx, by, s=1.0) -> list:
    """A vermilion shrine gate: two pillars on black footings, a tie beam and a curved lintel with
    a black cap. (The key gate at the foot of the Cherry Stairs.)"""
    p = _at(bx, by)
    P = Prop('shrine_gate')
    x, y = p.x, p.y
    for sx in (-1, 1):
        v, f = lib.cylinder((x + sx * 0.72 * s, y, 0.0), 0.1 * s, 0.085 * s, 1.75 * s, 14)
        P.b['paint'].add(v, f, col(VERMILION))
        v, f = lib.cylinder((x + sx * 0.72 * s, y, 0.0), 0.13 * s, 0.12 * s, 0.18 * s, 14)
        P.b['paint'].add(v, f, col('#2a2226'))
    v, f = lib.box((x, y, 1.36 * s), (1.86 * s, 0.1 * s, 0.13 * s))
    P.b['paint'].add(v, f, col(VERMILION))
    v, f = lib.box((x, y - 0.06 * s, 1.52 * s), (0.2 * s, 0.05 * s, 0.26 * s))
    P.b['paint'].add(v, f, col('#2a2226'))
    pts = [(x + u * 1.2 * s, y, (1.72 + 0.16 * abs(u) ** 2.4) * s) for u in [i / 12 * 2 - 1 for i in range(13)]]
    v, f = lib.tube(pts, 0.1 * s, 8)
    P.b['paint'].add(v, f, col(VERMILION))
    pts2 = [(x + u * 1.3 * s, y, (1.84 + 0.2 * abs(u) ** 2.4) * s) for u in [i / 12 * 2 - 1 for i in range(13)]]
    v, f = lib.tube(pts2, 0.07 * s, 8)
    P.b['paint'].add(v, f, col('#2a2226'))
    return P.build()


def noodle_stall(bx, by, s=1.0) -> list:
    """A noodle stall: wooden counter under a little tiled roof, short cloth curtains along the front
    eave, red paper lanterns, a steaming pot and bowls, stools at the ends. No signage."""
    p = _at(bx, by)
    P = Prop('noodle_stall')
    x, y = p.x, p.y
    W, D = 1.5 * s, 0.75 * s
    # back wall and counter
    v, f = lib.box((x, y + D * 0.35, 0.6 * s), (W, 0.08 * s, 1.2 * s))
    P.b['wood'].add(v, f, col('#8a5a34'))
    v, f = lib.box((x, y - D * 0.1, 0.3 * s), (W, D * 0.5, 0.6 * s))
    P.b['wood'].add(v, f, col('#a8703f'))
    v, f = lib.box((x, y - D * 0.14, 0.62 * s), (W + 0.08 * s, D * 0.62, 0.05 * s))
    P.b['wood'].add(v, f, col('#c99a62'))
    # posts and roof
    for sx in (-1, 1):
        for sy in (-1, 1):
            v, f = lib.box((x + sx * W / 2, y + sy * D * 0.4, 0.65 * s), (0.06 * s, 0.06 * s, 1.3 * s))
            P.b['wood'].add(v, f, col(TIMBER))
    gable_roof(P.b['paint'], x, y, 1.28 * s, W, D, 0.34 * s, over=0.16 * s, pal=('#3d4b5e', '#46566b', '#36434f'))
    # cloth curtains hanging from the front eave (plain indigo panels)
    for i in range(5):
        cx = x - W / 2 + W * (i + 0.5) / 5
        q = [(cx - W / 11, y - D / 2 - 0.1 * s, 1.24 * s), (cx + W / 11, y - D / 2 - 0.1 * s, 1.24 * s),
             (cx + W / 11, y - D / 2 - 0.1 * s, 0.98 * s), (cx - W / 11, y - D / 2 - 0.1 * s, 0.98 * s)]
        P.b['paint'].add(q, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#2f4a86' if i % 2 else '#27407a'))
    # red paper lanterns at the front corners
    for sx in (-1, 1):
        lx, ly = x + sx * (W / 2 + 0.05 * s), y - D / 2 - 0.12 * s
        v, f = lib.tube([(lx, ly, 1.28 * s), (lx, ly, 1.12 * s)], 0.01 * s, 4)
        P.b['wood'].add(v, f, col(TIMBER))
        v, f = lib.blob((lx, ly, 0.98 * s), 0.13 * s, squash=(1, 1, 1.3), rough=0.0, subdiv=2)
        P.b['glow'].add(v, f, col('#ff5a3c'))
    # steaming pot, bowls
    v, f = lib.lathe([(0.2 * s, 0.0), (0.22 * s, 0.05 * s), (0.22 * s, 0.26 * s), (0.2 * s, 0.28 * s)], 16, (x + 0.35 * s, y + 0.02 * s, 0.64 * s))
    P.b['metal'].add(v, f, col('#9aa3ad'))
    for k in range(3):
        v, f = lib.blob((x + 0.35 * s + 0.05 * k * s, y, (1.0 + 0.16 * k) * s), (0.12 - 0.02 * k) * s, rough=0.3, subdiv=2, seed=k)
        P.b['paint'].add(v, f, col('#ffffff'))
    for k in range(3):
        v, f = lib.lathe([(0.0, 0.0), (0.05 * s, 0.0), (0.09 * s, 0.07 * s), (0.08 * s, 0.075 * s), (0.0, 0.03 * s)], 12,
                         (x - 0.45 * s + k * 0.24 * s, y - D * 0.3, 0.65 * s))
        P.b['paint'].add(v, f, col(['#f4efe6', '#e9564a', '#f4efe6'][k]))
    # stools at the ends
    for sx in (-1, 1):
        v, f = lib.cylinder((x + sx * (W / 2 + 0.22 * s), y - D * 0.4, 0.0), 0.1 * s, 0.1 * s, 0.34 * s, 10)
        P.b['wood'].add(v, f, col('#6e4a2c'))
        v, f = lib.cylinder((x + sx * (W / 2 + 0.22 * s), y - D * 0.4, 0.34 * s), 0.13 * s, 0.13 * s, 0.05 * s, 12)
        P.b['paint'].add(v, f, col('#e9564a'))
    return P.build()


def stone_lantern(bx, by, s=1.0) -> list:
    """A garden stone lantern: hexagonal base, shaft, a glowing fire box, a roof with upturned corners
    and a jewel on top."""
    p = _at(bx, by)
    P = Prop('stone_lantern')
    x, y = p.x, p.y
    stone = col('#bdb6ab')
    v, f = lib.lathe([(0.2 * s, 0.0), (0.2 * s, 0.08 * s), (0.14 * s, 0.12 * s), (0.0, 0.12 * s)], 6, (x, y, 0))
    P.b['stone'].add(v, f, stone)
    v, f = lib.lathe([(0.075 * s, 0.1 * s), (0.065 * s, 0.62 * s)], 8, (x, y, 0), cap_bottom=False)
    P.b['stone'].add(v, f, stone)
    v, f = lib.lathe([(0.12 * s, 0.6 * s), (0.17 * s, 0.66 * s), (0.17 * s, 0.7 * s), (0.0, 0.7 * s)], 6, (x, y, 0))
    P.b['stone'].add(v, f, stone)
    v, f = lib.box((x, y, 0.82 * s), (0.2 * s, 0.2 * s, 0.22 * s))
    P.b['glow'].add(v, f, col('#ffc56a'))
    for sx in (-1, 1):
        for sy in (-1, 1):
            v, f = lib.box((x + sx * 0.1 * s, y + sy * 0.1 * s, 0.82 * s), (0.05 * s, 0.05 * s, 0.24 * s))
            P.b['stone'].add(v, f, stone)
    v, f = lib.lathe([(0.3 * s, 0.94 * s), (0.28 * s, 0.99 * s), (0.12 * s, 1.08 * s), (0.04 * s, 1.14 * s), (0.0, 1.15 * s)], 6, (x, y, 0), cap_bottom=True)
    v = [(vx, vy, vz + (0.035 * s if abs(vz - 0.94 * s) < 1e-6 else 0.0)) for (vx, vy, vz) in v]
    P.b['stone'].add(v, f, col('#aaa397'))
    v, f = lib.blob((x, y, 1.2 * s), 0.06 * s, squash=(1, 1, 1.3), rough=0.0, subdiv=2)
    P.b['stone'].add(v, f, stone)
    return P.build()


def paper_lantern_post(bx, by, s=1.0) -> list:
    """A wooden post with a round red paper lantern hanging from its arm."""
    p = _at(bx, by)
    P = Prop('paper_lantern')
    x, y = p.x, p.y
    v, f = lib.cylinder((x, y, 0), 0.045 * s, 0.035 * s, 1.45 * s, 8)
    P.b['wood'].add(v, f, col('#4a3024'))
    v, f = lib.box((x + 0.13 * s, y, 1.4 * s), (0.32 * s, 0.045 * s, 0.045 * s))
    P.b['wood'].add(v, f, col('#4a3024'))
    lx = x + 0.26 * s
    v, f = lib.tube([(lx, y, 1.4 * s), (lx, y, 1.28 * s)], 0.01 * s, 4)
    P.b['wood'].add(v, f, col('#4a3024'))
    v, f = lib.blob((lx, y, 1.12 * s), 0.14 * s, squash=(1, 1, 1.2), rough=0.0, subdiv=2)
    P.b['glow'].add(v, f, col('#ff6a3d'))
    for dz in (1.27, 0.97):
        v, f = lib.cylinder((lx, y, dz * s), 0.07 * s, 0.07 * s, 0.03 * s, 10)
        P.b['wood'].add(v, f, col('#2a2226'))
    return P.build()


def cottage(bx, by, s=1.0) -> list:
    """The Cloud Isle's little hut: pale yellow walls, a terracotta roof, a round window, a blue door
    and a tiny porch step."""
    p = _at(bx, by)
    P = Prop('cottage')
    x, y = p.x, p.y
    W, D, Hh = 1.2 * s, 0.9 * s, 0.8 * s
    v, f = lib.box((x, y, Hh / 2), (W, D, Hh))
    P.b['paint'].add(v, f, col('#f7e3a1'))
    v, f = lib.box((x, y, 0.04 * s), (W + 0.1 * s, D + 0.1 * s, 0.08 * s))
    P.b['stone'].add(v, f, col('#d6cbb8'))
    gable_roof(P.b['paint'], x, y, Hh, W, D, 0.55 * s, over=0.16 * s)
    v, f = lib.box((x - 0.2 * s, y - D / 2 - 0.02 * s, 0.33 * s), (0.28 * s, 0.05 * s, 0.56 * s))
    P.b['wood'].add(v, f, col('#3f7ec7'))
    v, f = lib.lathe([(0.0, 0.0), (0.13 * s, 0.0), (0.13 * s, 0.03 * s), (0.0, 0.03 * s)], 16)
    v = lib.transform(v, (x + 0.28 * s, y - D / 2 - 0.02 * s, 0.5 * s), rot=(math.pi / 2, 0, 0))
    P.b['glow'].add(v, f, col('#ffe6a8'))
    v, f = lib.box((x - 0.2 * s, y - D / 2 - 0.14 * s, 0.04 * s), (0.44 * s, 0.22 * s, 0.08 * s))
    P.b['wood'].add(v, f, col('#9c6a3a'))
    return P.build()


def palm(bx, by, s=1.0, lean=0.35) -> list:
    """A palm tree: a banded, curving trunk, drooping fronds and a few coconuts."""
    p = _at(bx, by)
    P = Prop('palm')
    x, y = p.x, p.y
    pts = []
    for k in range(12):
        t = k / 11
        pts.append((x + lean * s * t ** 1.6, y - 0.05 * s * t, 2.2 * s * t))
    v, f = lib.tube(pts, lambda t: (0.09 - 0.035 * t) * s, 10)
    P.b['wood'].add(v, f, lambda vv: col('#8a6440') if int(vv[2] / (0.16 * s)) % 2 else col('#a57d52'))
    top = Vector(pts[-1])
    for k in range(8):
        a = k / 8 * math.tau + 0.3
        L = (0.95 + 0.15 * math.sin(k * 1.7)) * s
        blade = []
        for i in range(10):
            t = i / 9
            blade.append(top + Vector((math.cos(a) * L * t, math.sin(a) * L * t * 0.8, 0.25 * s * math.sin(t * math.pi * 0.8) - 0.55 * s * t * t)))
        for i in range(9):
            a0, a1 = blade[i], blade[i + 1]
            wdt = 0.13 * s * math.sin((i + 0.5) / 9 * math.pi) + 0.02 * s
            side = Vector((-math.sin(a), math.cos(a), 0)) * wdt
            q = [tuple(a0 - side), tuple(a0 + side), tuple(a1 + side * 0.9), tuple(a1 - side * 0.9)]
            P.b['leaf'].add(q, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#3f9b3a' if k % 2 else '#5bb244'))
    for k in range(3):
        a = k / 3 * math.tau
        v, f = lib.blob((top.x + math.cos(a) * 0.1 * s, top.y + math.sin(a) * 0.08 * s, top.z - 0.1 * s), 0.07 * s, rough=0.0, subdiv=1)
        P.b['wood'].add(v, f, col('#5e3b22'))
    return P.build()


def bunting(bx, by, width, s=1.0):
    """Festival pennants in the game's colours (props.bunting)."""
    return props.bunting(bx, by, width, s)


# ------------------------------------------------------------------------------------------
# Structures (baked into the terrain)
def village_house(B, bx, by, rnd, s=1.0, facing=0.0, two_storey=False, deck=None):
    """A village house: plaster walls with a dark timber frame, a paper-screen front, a tiled hip
    roof. `deck` (a height above the ground) gives it a flat plank roof terrace instead, walled with a
    low tiled eave, for the rooftop run."""
    p = _at(bx, by)
    x, y = p.x, p.y
    W = rnd.uniform(1.05, 1.3) * s
    D = rnd.uniform(0.8, 0.95) * s
    Hh = (deck if deck is not None else rnd.uniform(0.85, 1.0) * s)
    v, f = lib.box((x, y, Hh / 2), (W, D, Hh))
    B['paint'].add(v, f, col(PLASTER))
    v, f = lib.box((x, y, 0.06 * s), (W + 0.06 * s, D + 0.06 * s, 0.12 * s))
    B['stone'].add(v, f, col('#8d857a'))
    for dx in (-0.5, -0.17, 0.17, 0.5):
        v, f = lib.box((x + dx * W, y - D / 2 - 0.015, Hh / 2), (0.06 * s, 0.05 * s, Hh))
        B['wood'].add(v, f, col(TIMBER))
    for zz in (Hh * 0.55, Hh - 0.04):
        v, f = lib.box((x, y - D / 2 - 0.02, zz), (W + 0.02, 0.05 * s, 0.06 * s))
        B['wood'].add(v, f, col(TIMBER))
    # paper screens and a door
    v, f = lib.box((x - 0.17 * W, y - D / 2 - 0.03, Hh * 0.28), (0.3 * W, 0.03, Hh * 0.5))
    B['wood'].add(v, f, col('#b58556'))
    v, f = lib.box((x + 0.25 * W, y - D / 2 - 0.03, Hh * 0.3), (0.26 * W, 0.03, Hh * 0.36))
    B['glow'].add(v, f, col('#fbe7bf'))
    if deck is not None:
        # plank terrace with a low tiled parapet eave
        v, f = lib.box((x, y, Hh + 0.02), (W + 0.12 * s, D + 0.12 * s, 0.05 * s))
        B['wood'].add(v, f, col('#b07a45'))
        for sy in (-1, 1):
            v, f = lib.box((x, y + sy * (D / 2 + 0.1 * s), Hh - 0.04), (W + 0.3 * s, 0.16 * s, 0.07 * s))
            B['paint'].add(v, f, col(TILE[0]))
        for sx in (-1, 1):
            v, f = lib.box((x + sx * (W / 2 + 0.1 * s), y, Hh - 0.04), (0.16 * s, D + 0.3 * s, 0.07 * s))
            B['paint'].add(v, f, col(TILE[1]))
        return
    z = Hh
    if two_storey:
        hip_roof(B['paint'], x, y, z, W, D, 0.12 * s, over=0.22 * s, upturn=0.04 * s, n=6, rnd=rnd)
        v, f = lib.box((x, y, z + 0.1 * s + 0.3 * s), (W * 0.75, D * 0.75, 0.6 * s))
        B['paint'].add(v, f, col(PLASTER))
        v, f = lib.box((x, y - D * 0.375 - 0.02, z + 0.42 * s), (W * 0.5, 0.03, 0.22 * s))
        B['glow'].add(v, f, col('#fbe7bf'))
        z = z + 0.7 * s
        W, D = W * 0.75, D * 0.75
    hip_roof(B['paint'], x, y, z, W, D, 0.38 * s, over=0.22 * s, upturn=0.08 * s, n=8, rnd=rnd)


def tournament_ring(B, bx, by, s=1.0, w=3.0, d=2.1):
    """The tournament ring: a raised square of pale stone tiles with a darker kerb, stairs at the
    front, squat corner posts and two tall banner poles (plain festival colours) at the back."""
    p = _at(bx, by)
    x, y = p.x, p.y
    W, D, Hh = w * s, d * s, 0.3 * s
    v, f = lib.box((x, y, Hh / 2), (W + 0.16 * s, D + 0.16 * s, Hh))
    B['stone_big'].add(v, f, col('#b9b1a4'))
    v, f = lib.box((x, y, Hh + 0.015 * s), (W, D, 0.03 * s))
    B['stone'].add(v, f, col('#eee8dc'))
    # front stairs
    for k in range(3):
        v, f = lib.box((x, y - D / 2 - 0.08 * s - 0.14 * k * s, Hh - (k + 1) * 0.08 * s), (1.0 * s, 0.16 * s, 0.08 * s))
        B['stone'].add(v, f, col('#d9d2c6'))
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = x + sx * W / 2, y + sy * D / 2
            v, f = lib.cylinder((px, py, Hh), 0.1 * s, 0.09 * s, 0.34 * s, 10)
            B['stone'].add(v, f, col('#cfc8bb'))
            v, f = lib.blob((px, py, Hh + 0.4 * s), 0.1 * s, rough=0.0, subdiv=2)
            B['metal'].add(v, f, col(GOLD))
    banners = ['#ff6b5e', '#1fa5a0']
    for k, sx in enumerate((-1, 1)):
        px, py = x + sx * (W / 2 + 0.25 * s), y + D / 2 + 0.1 * s
        v, f = lib.cylinder((px, py, 0.0), 0.05 * s, 0.04 * s, 2.3 * s, 8)
        B['wood'].add(v, f, col('#4a3024'))
        v, f = lib.box((px + sx * 0.2 * s * 0 - 0.0, py, 2.25 * s), (0.5 * s, 0.04 * s, 0.04 * s))
        B['wood'].add(v, f, col('#4a3024'))
        q = [(px - 0.22 * s, py - 0.03 * s, 2.22 * s), (px + 0.22 * s, py - 0.03 * s, 2.22 * s), (px + 0.22 * s, py - 0.03 * s, 1.2 * s), (px - 0.22 * s, py - 0.03 * s, 1.2 * s)]
        B['paint'].add(q, [(0, 1, 2, 3), (3, 2, 1, 0)], col(banners[k]))
        v, f = lib.box((px, py - 0.035 * s, 1.24 * s), (0.44 * s, 0.02 * s, 0.08 * s))
        B['paint'].add(v, f, col('#f4b83b'))


def boulder(mb, bx, by, rnd, r=0.4, rope=None):
    """A big round training boulder (optionally bound with a rope)."""
    p = _at(bx, by)
    v, f = lib.blob((p.x, p.y, r * 0.75), r, squash=(1.05, 1.0, 0.88), rough=0.18, freq=1.6, subdiv=3, seed=rnd.random() * 99)
    base = col(rnd.choice(['#a39a92', '#9a918a', '#b0a79c']))
    mb.add(v, f, lambda vv: lib.lerp_col(base, col('#6fa84a'), 0.7) if vv[2] > r * 1.45 else base)
    if rope is not None:
        pts = [(p.x + math.cos(a) * r * 1.02, p.y + math.sin(a) * r * 1.0, r * 0.8 + 0.04 * math.sin(a * 2)) for a in [i / 24 * math.tau for i in range(25)]]
        v, f = lib.tube(pts, 0.035, 6)
        rope.add(v, f, col('#d8b878'))


def stone_weights(B, bx, by, rnd, s=1.0):
    """A training weight: a wooden bar with a stone disc at each end, resting on two blocks."""
    p = _at(bx, by)
    x, y = p.x, p.y
    a = rnd.uniform(-0.4, 0.4)
    dx, dy = math.cos(a) * 0.45 * s, math.sin(a) * 0.45 * s
    v, f = lib.tube([(x - dx * 1.2, y - dy * 1.2, 0.22 * s), (x + dx * 1.2, y + dy * 1.2, 0.22 * s)], 0.03 * s, 8)
    B['wood'].add(v, f, col('#8a5a34'))
    for sgn in (-1, 1):
        v, f = lib.cylinder((0, 0, -0.06 * s), 0.2 * s, 0.2 * s, 0.12 * s, 16)
        v = lib.transform(v, (x + sgn * dx, y + sgn * dy, 0.22 * s), rot=(0, math.pi / 2, a))
        B['stone'].add(v, f, col('#8f877d'))


def training_post(B, bx, by, rnd, s=1.0):
    """A wooden training dummy: a thick post with three pegs, wrapped with straw rope bands."""
    p = _at(bx, by)
    x, y = p.x, p.y
    v, f = lib.cylinder((x, y, 0), 0.1 * s, 0.09 * s, 1.1 * s, 12)
    B['wood'].add(v, f, col('#9c6a3a'))
    for (zz, ang) in ((0.85, 0.3), (0.72, math.pi - 0.3), (0.45, -math.pi / 2 + 0.2)):
        v, f = lib.tube([(x, y, zz * s), (x + math.cos(ang) * 0.3 * s, y + math.sin(ang) * 0.3 * s, zz * s)], 0.03 * s, 6)
        B['wood'].add(v, f, col('#7a4f2c'))
    for zz in (0.25, 0.95):
        v, f = lib.cylinder((x, y, zz * s), 0.105 * s, 0.105 * s, 0.07 * s, 12)
        B['wood'].add(v, f, col('#d8b878'))


def bamboo_clump(B, bx, by, rnd, s=1.0, n=None):
    """A clump of bamboo: jointed green canes with leaf tufts at the top."""
    p = _at(bx, by)
    for _ in range(n or rnd.randint(7, 12)):
        ox, oy = rnd.gauss(0, 0.14) * s, rnd.gauss(0, 0.1) * s
        h = rnd.uniform(1.2, 2.1) * s
        lean = (rnd.uniform(-0.1, 0.1) * s, rnd.uniform(-0.06, 0.06) * s)
        r = rnd.uniform(0.022, 0.035) * s
        segs = max(3, int(h / 0.28))
        c0 = col(rnd.choice(['#6aa83a', '#7bb846', '#5a9a34']))
        for k in range(segs):
            t0, t1 = k / segs, (k + 1) / segs
            a = (p.x + ox + lean[0] * t0 * t0, p.y + oy + lean[1] * t0 * t0, h * t0)
            b = (p.x + ox + lean[0] * t1 * t1, p.y + oy + lean[1] * t1 * t1, h * t1 - 0.01)
            v, f = lib.tube([a, b], r, 6)
            B['leaf_plain'].add(v, f, c0)
            v, f = lib.cylinder((b[0], b[1], b[2] - 0.01), r * 1.2, r * 1.2, 0.02, 6)
            B['leaf_plain'].add(v, f, col('#4a7a2a'))
        top = (p.x + ox + lean[0], p.y + oy + lean[1], h)
        for _k in range(4):
            v, f = lib.blob((top[0] + rnd.uniform(-0.12, 0.12) * s, top[1] + rnd.uniform(-0.08, 0.08) * s, top[2] - rnd.uniform(0.0, 0.3) * s),
                            rnd.uniform(0.08, 0.13) * s, squash=(1.6, 1.0, 0.5), rough=0.3, subdiv=1, seed=rnd.random() * 30)
            B['leaves'].add(v, f, col(rnd.choice(['#5aa83a', '#79c24a', '#4a9a32'])))


def rock_spire(mb, bx, by, rnd, h=2.4, r=0.5, moss=None):
    """A craggy rock column (stacked lumpy blocks narrowing upwards), moss on the ledges."""
    p = _at(bx, by)
    z = 0.0
    k = 0
    while z < h:
        rr = r * (1.0 - 0.45 * z / h) * rnd.uniform(0.85, 1.1)
        hh = rnd.uniform(0.35, 0.55)
        ox, oy = rnd.uniform(-0.06, 0.06), rnd.uniform(-0.05, 0.05)
        v, f = lib.blob((p.x + ox, p.y + oy, z + hh * 0.5), rr, squash=(1.0, 0.9, hh / rr * 0.62), rough=0.3, freq=2.2, subdiv=2, seed=rnd.random() * 90)
        base = col(rnd.choice(['#8f8a86', '#9d9690', '#85807e']))
        top_z = z + hh * 0.85
        mb.add(v, f, lambda vv, tz=top_z, b=base: lib.lerp_col(b, col('#5e9a44'), 0.8) if (vv[2] > tz and moss is not False) else b)
        z += hh * 0.8
        k += 1
    return z
