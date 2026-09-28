"""Showtime Strip board art: a neon entertainment boulevard at night (terrain tiles + landmark sprites).

    node scripts/art/worlds/citykit/export.mjs showtime > scripts/art/worlds/showtime/board.json
    <bpy python> scripts/art/worlds/showtime/board.py --plan              (layout map, no render)
    <bpy python> scripts/art/worlds/showtime/board.py --preview --show-props
    <bpy python> scripts/art/worlds/showtime/board.py --export [--bands 4]

Original homages, no names or logos: a 1950s rock'n'roll diner with its own little stage, a pastel
café beside a pop concert stage with a heart backdrop, a pink honky-tonk saloon with rhinestones and
a rodeo corral, a comedy club next to an ice rink, the grand marquee theatre, a fountain and two
spinning prize wheels round Fountain Circle.
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'citykit'))
import kit  # noqa: E402
import cityprops as cp  # noqa: E402
from kit import GRID, Parts, board_to_world, col, facing, lib  # noqa: E402
from lib import COSB, PX, Vector  # noqa: E402


def args():
    return kit.add_args(argparse.ArgumentParser()).parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])


A = args()
SCALE = A.scale or (0.25 if A.preview else 1.0)
SAMPLES = A.samples or (6 if A.preview else 12)
OUT = os.path.join(kit.ROOT, 'art-out', 'showtime')
DATA = os.path.join(HERE, 'board.json')

LANDMARKS = [
    # the theatre carries the id the Neon Surge effect pulses (BoardScene's 'surge' fx looks for it)
    dict(id='crystal-gen', kind='theatre', x=1800, y=1085, s=1.0, fw=232, fd=78, h=640, tex='observatory', owner='sl2'),
    dict(id='fountain', kind='fountain', x=1800, y=1748, s=1.0, fw=112, fd=50, h=170, tex='crystal-generator', owner='sf0'),
    dict(id='bandstand', kind='bandstand', x=1575, y=1545, s=1.0, fw=86, fd=50, h=180, tex='', depth_y=1440, owner='sf0'),
    dict(id='cafe', kind='cafe', x=1185, y=895, s=1.0, fw=150, fd=66, h=250, tex='stall', owner='sl4'),
    dict(id='popstage', kind='popstage', x=815, y=868, s=1.0, fw=165, fd=66, h=300, tex='bunting', owner='sl6'),
    dict(id='drivein', kind='drivein', x=800, y=1368, s=1.0, fw=136, fd=26, h=300, tex='', owner='sl10'),
    dict(id='diner', kind='diner', x=1010, y=1768, s=1.0, fw=190, fd=66, h=250, tex='workshop', owner='sl15'),
    dict(id='saloon', kind='saloon', x=2700, y=852, s=1.0, fw=205, fd=72, h=300, tex='workshop', owner='sr6'),
    dict(id='comedy', kind='comedy', x=3190, y=1566, s=1.0, fw=96, fd=54, h=280, tex='', owner='sa4'),
    dict(id='wheel-stand', kind='wheelstand', x=2700, y=1800, s=1.0, fw=84, fd=40, h=280, tex='windmill', owner='sr11'),
    dict(id='wheel-stand-2', kind='wheelstand', x=2892, y=1760, s=0.8, fw=68, fd=34, h=230, tex='windmill', owner='sr10'),
    dict(id='gate', kind='gate', x=2378, y=1095, s=1.0, tex='prism-gate'),
    dict(id='merch', kind='stall', x=3440, y=1228, s=1.0, fw=60, fd=36, h=160, tex='', owner='sa2'),
    dict(id='pennants-diner', kind='bunting', x=1300, y=1812, s=1.0, width=230, tex=''),
]
RELIC_GATES = ['sl6', 'sl12', 'sr5', 'sa4', 'sv2']

LOOKS = {
    'sf0': dict(surface='boulevard', facade='deco', fh=2.4),
    'sl2': dict(surface='marquee', facade='deco', fh=2.6),
    'sr2': dict(surface='marquee', facade='deco', fh=2.6),
    'sl4': dict(surface='pastel', facade='pastel', fh=2.3),
    'sl8': dict(surface='boulevard', facade='brick', fh=2.3),
    'sl13': dict(surface='checker', facade='pastel', fh=2.2),
    'sr4': dict(surface='western', facade='western', fh=2.3),
    'sr8': dict(surface='boulevard', facade='brick', fh=2.4),
    'sa1': dict(surface='boulevard', facade='brick', fh=2.4),
    'sr10': dict(surface='boulevard', facade='deco', fh=2.3),
    'sr14': dict(surface='pastel', facade='pastel', fh=2.0),
}
DECK_STYLE = {'VIP Walk': 'carpet', 'Ice Rink': 'boards'}


def build_city():
    b = kit.CityBoard(DATA, OUT, LANDMARKS, island_for=LOOKS)
    b.extra_rects += [
        (2040, 1500, 120, 80, 0, 'sf0'),     # Mimi's corner of Fountain Circle
        (1575, 1510, 110, 80, 0, 'sf0'),     # Ora's bandstand
        (1800, 1715, 170, 96, 0, 'sf0'),     # the fountain
        (1960, 1020, 170, 110, 0, 'sr2'),    # the theatre's right half joins the right flank
        (1640, 1020, 170, 110, 0, 'sl2'),
        (860, 1420, 250, 150, 0, 'sl10'),    # the drive-in lot
        (1010, 1690, 230, 110, 0, 'sl15'),   # behind the diner
        (2700, 1745, 200, 80, 0, 'sr11'),    # the prize wheels' stands
        (2890, 1710, 110, 70, 0, 'sr10'),
        (3430, 1240, 90, 70, 0, 'sa2'),      # Pipper's merch cart
        (3180, 1480, 120, 120, 0, 'sa4'),    # the comedy club
        (3010, 900, 120, 70, 0, 'sr7'),      # the rodeo corral
    ]
    # street lamps with halos, spread along the walkways (behind them)
    for i, (lx, ly) in enumerate(auto_lamp_spots(b, 9)):
        lm = dict(id=f'lamp-{i}', kind='lantern', x=lx, y=ly, s=1.0, tex='lantern', fw=26, fd=12, no_ground=True)
        LANDMARKS.append(lm)
    return b


def auto_lamp_spots(b, count):
    """Spots beside the walkways (behind them), clear of spaces, landmarks, crossings and each other."""
    cands = []
    for e in b.edges:
        if e['style'] != 'path':
            continue
        na, nb = b.nodes[e['from']], b.nodes[e['to']]
        mx, my = (na['x'] + nb['x']) / 2, (na['y'] + nb['y']) / 2
        L = math.hypot(nb['x'] - na['x'], nb['y'] - na['y']) or 1
        nx, ny = -(nb['y'] - na['y']) / L, (nb['x'] - na['x']) / L
        if ny > 0:
            nx, ny = -nx, -ny
        cands.append((mx + nx * 78, my + ny * 78))
    rnd = random.Random(9)
    rnd.shuffle(cands)
    out = []
    for (x, y) in cands:
        if b.near_node(x, y, 96) or b.near_landmark(x, y, 36) or any(math.hypot(x - ox, y - oy) < 380 for (ox, oy) in out):
            continue
        if any(math.hypot(x - lm['x'], y - lm['y']) < 90 for lm in LANDMARKS):
            continue
        out.append((x, y))
        if len(out) >= count:
            break
    return out


# ------------------------------------------------------------------------------------------
# Landmarks
def _box(P, kind, c, size, color, rz=0.0):
    v, f = lib.box(c, size, rot_z=rz)
    P[kind].add(v, f, col(color) if isinstance(color, str) else color)


def _bulbs_line(P, a, b_, n, colors=('#fff1b8', '#ffd07a'), r=0.03):
    for k in range(n + 1):
        t = k / n
        v, f = lib.blob((a[0] + (b_[0] - a[0]) * t, a[1] + (b_[1] - a[1]) * t, a[2] + (b_[2] - a[2]) * t), r, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col(colors[k % len(colors)]))


def theatre(bx, by, s=1.0):
    """The grand marquee theatre: an art-deco front, a stepped tower with a vertical blade sign, a
    V-shaped marquee canopy ringed with chaser bulbs, poster boxes and two searchlights."""
    P = Parts('theatre')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.85 * s
    WALL, WALL2, GOLD = '#4f3a5e', '#5f4570', '#f2c14e'
    W_, D_, H_ = 4.4 * s, 1.6 * s, 4.2 * s
    front = y - D_ / 2
    _box(P, 'paint', (x, y, H_ / 2), (W_, D_, H_), WALL)
    _box(P, 'paint', (x, y, H_ + 0.06 * s), (W_ + 0.12 * s, D_ + 0.12 * s, 0.12 * s), GOLD)
    # stepped central tower
    for k, (tw, tz0, tz1) in enumerate(((2.0, H_, H_ + 1.0), (1.5, H_ + 1.0, H_ + 1.8), (1.0, H_ + 1.8, H_ + 2.4))):
        _box(P, 'paint', (x, y + 0.1 * s, (tz0 + tz1) / 2 * s if False else (tz0 + tz1) / 2), (tw * s, (D_ - 0.3 * s * (k + 1)), (tz1 - tz0)), WALL2 if k % 2 else WALL)
        _box(P, 'metal', (x, y + 0.1 * s, tz1 + 0.04 * s), (tw * s + 0.1 * s, (D_ - 0.3 * s * (k + 1)) + 0.1 * s, 0.08 * s), GOLD)
    cp.neon_shape(P, cp.star_pts(0.34 * s, 0.14 * s), (x, y - 0.3 * s, H_ + 2.95 * s), cp.NEON['gold'], r=0.03 * s)
    # gold pilasters (fluted) across the front
    for k in range(9):
        px_ = x - W_ / 2 + 0.25 * s + k * (W_ - 0.5 * s) / 8
        if abs(px_ - x) < 1.0 * s:
            continue
        v, f = lib.box((px_, front - 0.04 * s, H_ / 2), (0.14 * s, 0.08 * s, H_ - 0.2 * s))
        P['metal'].add(v, f, col(GOLD))
    # lit windows on the upper floor and poster boxes by the doors
    for k in range(6):
        px_ = x - W_ / 2 + 0.55 * s + k * (W_ - 1.1 * s) / 5
        if abs(px_ - x) < 1.1 * s:
            continue
        _box(P, 'glow', (px_, front - 0.02 * s, 3.2 * s), (0.34 * s, 0.02, 0.5 * s), '#ffd48a')
    for k, cc in enumerate(['#ff5ab4', '#4de8ff', '#ffcf4a', '#b27bff']):
        px_ = x + (-1.75 + k * 0.5 + (1.5 if k > 1 else 0)) * s
        _box(P, 'metal', (px_, front - 0.03 * s, 1.0 * s), (0.4 * s, 0.03, 0.62 * s), GOLD)
        _box(P, 'glow', (px_, front - 0.05 * s, 1.0 * s), (0.32 * s, 0.02, 0.52 * s), cc)
        cp.neon_shape(P, cp.star_pts(0.1 * s, 0.045 * s), (px_, front - 0.07 * s, 1.05 * s), cp.NEON['white'], r=0.012 * s)
    # entrance: a tall glowing archway with doors
    arch = []
    for k in range(13):
        a = math.pi - k / 12 * math.pi
        arch.append((math.cos(a) * 0.8 * s, 1.4 * s + math.sin(a) * 0.6 * s))
    poly = [(-0.8 * s, 0.0)] + arch + [(0.8 * s, 0.0)]
    verts = [(px_, py_, 0.0) for (px_, py_) in poly]
    P['glow'].add(facing(verts, (x, front - 0.02 * s, 0.0)), [tuple(range(len(verts)))], col('#ffcf8a'))
    for dx in (-0.4, 0.0, 0.4):
        v, f = lib.box((x + dx * s, front - 0.03 * s, 0.7 * s), (0.02, 0.02, 1.4 * s))
        P['metal'].add(v, f, col(GOLD))
    # the marquee canopy: a shallow V projecting over the entrance, bulbs round its edges, "TONIGHT"
    cz = 2.25 * s
    tip = (x, front - 1.0 * s)
    lft = (x - 1.3 * s, front - 0.05 * s)
    rgt = (x + 1.3 * s, front - 0.05 * s)
    for (p0, p1) in ((lft, tip), (tip, rgt)):
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        L = math.hypot(dx, dy)
        mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        rz = math.atan2(dy, dx)
        v, f = lib.box((mid[0], mid[1], cz), (L, 0.08 * s, 0.62 * s), rot_z=rz)
        P['paint'].add(v, f, col('#fff4e0'))
        for zz in (cz - 0.34 * s, cz + 0.34 * s):
            _bulbs_line(P, (p0[0], p0[1] - 0.05 * s, zz), (p1[0], p1[1] - 0.05 * s, zz), int(L / (0.13 * s)), colors=('#fff1b8', '#ffcf4a', '#ff9ad2'), r=0.035 * s)
    v = [(lft[0], lft[1], cz + 0.33 * s), (tip[0], tip[1], cz + 0.33 * s), (rgt[0], rgt[1], cz + 0.33 * s), (x, front, cz + 0.33 * s)]
    P['paint'].add(v, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#3a2a48'))
    # letters on both faces of the V (the left face reads to the camera best)
    for (p0, p1, word) in ((lft, tip, 'TONIGHT'), (tip, rgt, 'LIVE!')):
        mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - 0.06 * s)
        yaw = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        cp.neon_text(P, word, (mid[0], mid[1], cz - 0.02 * s), 0.3 * s, cp.NEON['pink'] if word == 'TONIGHT' else cp.NEON['cyan'], yaw=yaw)
    # vertical blade sign above the canopy
    bz0, bz1 = cz + 0.5 * s, H_ + 1.6 * s
    _box(P, 'paint', (x, front - 0.35 * s, (bz0 + bz1) / 2), (0.5 * s, 0.14 * s, bz1 - bz0), '#2a1f36')
    for (zz, ch) in zip([bz1 - 0.45 * s - k * 0.62 * s for k in range(5)], 'GRAND'):
        cp.neon_text(P, ch, (x, front - 0.44 * s, zz), 0.44 * s, cp.NEON['gold'])
    for side in (-1, 1):
        _bulbs_line(P, (x + side * 0.27 * s, front - 0.43 * s, bz0 + 0.05 * s), (x + side * 0.27 * s, front - 0.43 * s, bz1 - 0.05 * s), int((bz1 - bz0) / (0.16 * s)), r=0.03 * s)
    # front steps
    for k in range(3):
        _box(P, 'stone', (x, front - 0.12 * s - k * 0.12 * s, 0.1 * s - k * 0.035 * s), (2.0 * s + k * 0.3 * s, 0.14 * s, 0.07 * s), '#d9cfc4')
    obs = P.build()
    # two searchlights on the roof corners, beams crossing up into the night
    beams = []
    for side in (-1, 1):
        o = Vector((x + side * 1.8 * s, y, H_ + 0.25 * s))
        v, f = lib.cylinder((o.x, o.y, o.z - 0.2 * s), 0.14 * s, 0.14 * s, 0.22 * s, 12)
        beams.append(cp.beam_object(f'theatre_beam_{side}', o, Vector((-side * 0.5, 0.15, 1.0)).normalized(), 3.2 * s, 0.1 * s, 0.6 * s, '#fff2cf'))
    return obs + beams


def fountain(bx, by, s=1.0):
    """Fountain Circle's fountain: a round basin with lit water, tiered bowls, arcs of spray and a
    golden star on top."""
    P = Parts('fountain')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.6 * s
    v, f = lib.lathe([(1.1 * s, 0.0), (1.12 * s, 0.26 * s), (1.02 * s, 0.3 * s), (1.0 * s, 0.12 * s), (0.0, 0.12 * s)], 48, (x, y, 0))
    P['stone'].add(v, f, col('#e7dccf'))
    v, f = lib.cylinder((x, y, 0.2 * s), 0.99 * s, 0.99 * s, 0.02, 48)
    P['glow'].add(v, f, col('#4fb8ff'))  # lit pool water
    ring = [(x + math.cos(k / 36 * math.tau) * 0.9 * s, y + math.sin(k / 36 * math.tau) * 0.9 * s, 0.215 * s) for k in range(37)]
    v, f = lib.tube(ring, 0.02 * s, 5)
    P['neon'].add(v, f, col('#9fe8ff'))
    v, f = lib.lathe([(0.22 * s, 0.0), (0.14 * s, 0.9 * s), (0.1 * s, 1.5 * s)], 16, (x, y, 0.2 * s))
    P['stone'].add(v, f, col('#ddd1c3'))
    for (zb, rb) in ((0.95, 0.55), (1.55, 0.32)):
        v, f = lib.lathe([(0.12 * s, 0.0), (rb * s, 0.12 * s), (rb * s * 1.04, 0.2 * s), (0.0, 0.16 * s)], 28, (x, y, zb * s))
        P['stone'].add(v, f, col('#eee4d8'))
        v, f = lib.cylinder((x, y, zb * s + 0.17 * s), rb * s * 0.95, rb * s * 0.95, 0.015, 28)
        P['glow'].add(v, f, col('#7fd0ff'))
    # arcs of water from the top bowl and the rim
    for k in range(10):
        a = k / 10 * math.tau
        pts = []
        for i in range(9):
            t = i / 8
            r = 0.3 * s + t * 0.45 * s
            pts.append((x + math.cos(a) * r, y + math.sin(a) * r, 1.8 * s + 0.35 * s * math.sin(t * math.pi) - t * 0.75 * s))
        v, f = lib.tube(pts, 0.025 * s, 5)
        P['softglow'].add(v, f, col('#cfefff'))
    for k in range(14):
        a = k / 14 * math.tau
        pts = []
        for i in range(7):
            t = i / 6
            r = 1.0 * s - t * 0.4 * s
            pts.append((x + math.cos(a) * r, y + math.sin(a) * r, 0.3 * s + 0.5 * s * math.sin(t * math.pi)))
        v, f = lib.tube(pts, 0.018 * s, 5)
        P['softglow'].add(v, f, col('#dff6ff'))
    star = cp.star_pts(0.26 * s, 0.11 * s)
    verts = [(px_, py_, 0.0) for (px_, py_) in star] + [(px_, py_, 0.06 * s) for (px_, py_) in star]
    n = len(star)
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    P['metal'].add(facing(verts, (x, y, 2.05 * s)), faces, col('#f2c14e'))
    return P.build()


def bandstand(bx, by, s=1.0):
    P = Parts('bandstand')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.42 * s
    v, f = lib.lathe([(0.78 * s, 0.0), (0.78 * s, 0.18 * s), (0.74 * s, 0.2 * s), (0.0, 0.2 * s)], 32, (x, y, 0))
    P['wood'].add(v, f, col('#9a4a6a'))
    v, f = lib.lathe([(0.8 * s, 0.15 * s), (0.82 * s, 0.15 * s), (0.82 * s, 0.2 * s), (0.8 * s, 0.2 * s)], 32, (x, y, 0))
    P['metal'].add(v, f, col('#f2c14e'))
    for k in range(6):
        a = k / 6 * math.tau + math.pi / 6
        if math.sin(a) < -0.3:
            continue
        v, f = lib.cylinder((x + math.cos(a) * 0.68 * s, y + math.sin(a) * 0.68 * s, 0.2 * s), 0.03 * s, 0.03 * s, 1.35 * s, 8)
        P['metal'].add(v, f, col('#f2c14e'))
    v, f = lib.lathe([(0.86 * s, 0.0), (0.66 * s, 0.24 * s), (0.28 * s, 0.42 * s), (0.02 * s, 0.5 * s)], 24, (x, y, 1.55 * s))
    P['paint'].add(v, f, col('#e85aa8'))
    for k in range(18):
        a = k / 18 * math.tau
        v, f = lib.blob((x + math.cos(a) * 0.86 * s, y + math.sin(a) * 0.86 * s, 1.53 * s), 0.035 * s, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col(['#fff1b8', '#ffcf4a', '#9fe8ff'][k % 3]))
    cp.neon_shape(P, cp.note_pts(0.2 * s), (x, y, 2.3 * s), cp.NEON['gold'], r=0.02 * s)
    return P.build()


def cafe(bx, by, s=1.0):
    """The pastel café: a two-storey pink front with a striped awning, big warm windows, a neon
    coffee cup and CAFE sign, flower boxes and parasols outside."""
    P = Parts('cafe')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.75 * s
    W_, D_, H_ = 2.6 * s, 1.3 * s, 2.5 * s
    front = y - D_ / 2
    _box(P, 'paint', (x, y, H_ / 2), (W_, D_, H_), '#f2b6c9')
    _box(P, 'paint', (x, y, H_ + 0.08 * s), (W_ + 0.14 * s, D_ + 0.14 * s, 0.16 * s), '#fff4ea')
    # scalloped roof trim (little mint bumps)
    for k in range(14):
        px_ = x - W_ / 2 + 0.1 * s + k * (W_ - 0.2 * s) / 13
        v, f = lib.blob((px_, front - 0.06 * s, H_ + 0.02 * s), 0.07 * s, rough=0.0, subdiv=1)
        P['paint'].add(v, f, col('#a9dcc9'))
    # windows (ground floor big and warm, upper floor small)
    for dx in (-0.85, 0.85):
        _box(P, 'glow', (x + dx * s, front - 0.02 * s, 0.75 * s), (0.7 * s, 0.02, 0.9 * s), '#ffd9a8')
        _box(P, 'paint', (x + dx * s, front - 0.03 * s, 0.75 * s), (0.04 * s, 0.02, 0.92 * s), '#fff4ea')
    for dx in (-0.9, -0.3, 0.3, 0.9):
        _box(P, 'glow', (x + dx * s, front - 0.02 * s, 1.95 * s), (0.32 * s, 0.02, 0.42 * s), '#ffe6c0')
    _box(P, 'glow', (x, front - 0.02 * s, 0.55 * s), (0.5 * s, 0.02, 1.0 * s), '#ffc98a')  # door
    # striped awning over the ground floor
    n = 10
    for k in range(n):
        x0 = x - W_ / 2 + k * W_ / n
        x1 = x0 + W_ / n
        q = [(x0, front - 0.02 * s, 1.45 * s), (x1, front - 0.02 * s, 1.45 * s), (x1, front - 0.55 * s, 1.18 * s), (x0, front - 0.55 * s, 1.18 * s)]
        P['paint'].add(q, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#a9dcc9' if k % 2 else '#fff4ea'))
        v, f = lib.blob(((x0 + x1) / 2, front - 0.57 * s, 1.15 * s), 0.05 * s, squash=(1.2, 0.5, 0.8), rough=0.0, subdiv=1)
        P['paint'].add(v, f, col('#a9dcc9' if k % 2 else '#fff4ea'))
    cp.neon_text(P, 'CAFE', (x, front - 0.06 * s, 1.72 * s), 0.34 * s, cp.NEON['pink'], backing='#fff4ea', pad=0.06)
    # a neon coffee cup with steam on the roof corner
    cup = [(-0.16, 0.2), (-0.12, -0.12), (0.12, -0.12), (0.16, 0.2)]
    cp.neon_shape(P, [(px_ * s, py_ * s) for (px_, py_) in cup], (x + 0.95 * s, front + 0.1 * s, H_ + 0.35 * s), cp.NEON['cyan'], r=0.022 * s, closed=False)
    handle = [(0.16 + 0.07 * math.cos(a), 0.05 + 0.08 * math.sin(a)) for a in [(-math.pi / 2 + k / 8 * math.pi) for k in range(9)]]
    cp.neon_shape(P, [(px_ * s, py_ * s) for (px_, py_) in handle], (x + 0.95 * s, front + 0.1 * s, H_ + 0.35 * s), cp.NEON['cyan'], r=0.018 * s, closed=False)
    for k in range(2):
        steam = [(-0.05 + k * 0.09 + 0.03 * math.sin(t * 6), 0.26 + t * 0.3) for t in [i / 6 for i in range(7)]]
        cp.neon_shape(P, [(px_ * s, py_ * s) for (px_, py_) in steam], (x + 0.95 * s, front + 0.1 * s, H_ + 0.35 * s), cp.NEON['white'], r=0.012 * s, closed=False)
    # flower boxes under the upper windows
    rnd = random.Random(21)
    for dx in (-0.9, -0.3, 0.3, 0.9):
        _box(P, 'wood', (x + dx * s, front - 0.08 * s, 1.68 * s), (0.36 * s, 0.12 * s, 0.08 * s), '#fff4ea')
        for k in range(4):
            v, f = lib.blob((x + dx * s - 0.12 * s + k * 0.08 * s, front - 0.1 * s, 1.75 * s), 0.04 * s, rough=0.0, subdiv=1)
            P['paint'].add(v, f, col(rnd.choice(['#ff8fb1', '#ffe066', '#ffffff', '#c9a3ff'])))
    return P.build()


def pop_stage(bx, by, s=1.0):
    """The pop concert stage: a pastel deck under a silver truss with coloured lights, speaker
    stacks, a big neon heart backdrop with sparkles and a microphone at the front."""
    P = Parts('popstage')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.7 * s
    W_, D_ = 3.0 * s, 1.4 * s
    front = y - D_ / 2
    _box(P, 'paint', (x, y, 0.2 * s), (W_, D_, 0.4 * s), '#b9b2e6')
    _box(P, 'paint', (x, y, 0.41 * s), (W_ - 0.1 * s, D_ - 0.1 * s, 0.02 * s), '#e7e2ff')
    _bulbs_line(P, (x - W_ / 2, front - 0.02 * s, 0.34 * s), (x + W_ / 2, front - 0.02 * s, 0.34 * s), 20, colors=('#ff9ad2', '#fff1b8', '#9fe8ff'), r=0.03 * s)
    # backdrop wall with the neon heart and sparkles
    _box(P, 'paint', (x, y + 0.6 * s, 1.6 * s), (W_ - 0.3 * s, 0.1 * s, 2.4 * s), '#3a2a58')
    cp.neon_shape(P, cp.heart_pts(0.72 * s), (x, y + 0.5 * s, 1.75 * s), cp.NEON['pink'], r=0.045 * s)
    cp.neon_shape(P, cp.heart_pts(0.5 * s), (x, y + 0.5 * s, 1.8 * s), '#ffd0ec', r=0.025 * s)
    for (sx_, sz_, r) in ((-1.05, 2.4, 0.13), (1.05, 2.3, 0.11), (-0.9, 1.05, 0.09), (0.95, 1.1, 0.1), (0.0, 2.75, 0.08)):
        cp.neon_shape(P, cp.star_pts(r * s, r * 0.4 * s, n=4), (x + sx_ * s, y + 0.5 * s, sz_ * s), cp.NEON['white'], r=0.014 * s)
    # truss: two towers and a top beam carrying lights
    for dx in (-1, 1):
        for k in range(8):
            z0 = 0.4 * s + k * 0.32 * s
            v, f = lib.box((x + dx * (W_ / 2 - 0.1 * s), front + 0.1 * s, z0 + 0.16 * s), (0.12 * s, 0.12 * s, 0.32 * s))
            P['chrome'].add(v, f, col('#c9ced8'))
    _box(P, 'chrome', (x, front + 0.1 * s, 3.05 * s), (W_, 0.14 * s, 0.14 * s), '#c9ced8')
    for k, cc in enumerate(['#ff5ab4', '#4de8ff', '#ffcf4a', '#b27bff', '#ff5ab4', '#4de8ff']):
        px_ = x - W_ / 2 + 0.4 * s + k * (W_ - 0.8 * s) / 5
        v, f = lib.cylinder((px_, front + 0.05 * s, 2.82 * s), 0.09 * s, 0.07 * s, 0.18 * s, 12)
        P['metal'].add(v, f, col('#2a2630'))
        v, f = lib.cylinder((px_, front + 0.05 * s, 2.8 * s), 0.08 * s, 0.08 * s, 0.01, 12)
        P['neon'].add(v, f, col(cc))
    # speaker stacks and the mic
    for dx in (-1, 1):
        for k in range(2):
            _box(P, 'matte', (x + dx * (W_ / 2 + 0.3 * s), y - 0.1 * s, 0.25 * s + k * 0.5 * s), (0.5 * s, 0.5 * s, 0.48 * s), '#221e28')
            v, f = lib.cylinder((0, 0, 0), 0.14 * s, 0.14 * s, 0.02, 16)
            v = lib.transform(v, (x + dx * (W_ / 2 + 0.3 * s), y - 0.36 * s, 0.25 * s + k * 0.5 * s), rot=(math.pi / 2, 0, 0))
            P['metal'].add(v, f, col('#5a5662'))
    v, f = lib.cylinder((x, front + 0.2 * s, 0.42 * s), 0.012 * s, 0.012 * s, 0.9 * s, 6)
    P['chrome'].add(v, f, col('#c9ced8'))
    v, f = lib.blob((x, front + 0.2 * s, 1.36 * s), 0.05 * s, rough=0.0, subdiv=1)
    P['chrome'].add(v, f, col('#e8ecf2'))
    return P.build()


def drive_in(bx, by, s=1.0):
    """A drive-in movie screen (blank and glowing) on a frame, with a little starburst sign."""
    P = Parts('drivein')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.1 * s
    for dx in (-1.2, -0.4, 0.4, 1.2):
        v, f = lib.box((x + dx * s, y + 0.15 * s, 1.1 * s), (0.08 * s, 0.08 * s, 2.2 * s))
        P['wood'].add(v, f, col('#5a4a3e'))
        v, f = lib.tube([(x + dx * s, y + 0.15 * s, 1.8 * s), (x + dx * s, y + 0.7 * s, 0.0)], 0.03 * s, 5)
        P['wood'].add(v, f, col('#5a4a3e'))
    _box(P, 'paint', (x, y, 2.05 * s), (2.9 * s, 0.1 * s, 1.5 * s), '#e8e4dc')
    _box(P, 'softglow', (x, y - 0.06 * s, 2.05 * s), (2.7 * s, 0.02, 1.32 * s), '#d8e8ff')
    burst = cp.star_pts(0.34 * s, 0.14 * s, n=8)
    cp.neon_shape(P, burst, (x + 1.55 * s, y - 0.05 * s, 3.0 * s), cp.NEON['orange'], r=0.022 * s)
    return P.build()


def diner(bx, by, s=1.0):
    """The rock'n'roll diner: a chrome diner car with a teal stripe and a band of warm windows, a
    rooftop DINER sign with an arrow, a little outdoor stage with a mic and guitar, and a pink car."""
    P = Parts('diner')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.7 * s
    L, D_, H_ = 3.4 * s, 1.3 * s, 1.25 * s
    front = y - D_ / 2
    # the car body: a box with rounded ends (half cylinders)
    _box(P, 'chrome', (x, y, 0.2 * s + H_ / 2), (L - D_, D_, H_), '#dfe4ea')
    for side in (-1, 1):
        verts, faces = lib.cylinder((0, 0, 0), D_ / 2, D_ / 2, H_, 24)
        verts = [(vx + x + side * (L - D_) / 2, vy + y, vz + 0.2 * s) for (vx, vy, vz) in verts]
        P['chrome'].add(verts, faces, col('#dfe4ea'))
    _box(P, 'paint', (x, y, 0.1 * s), (L - 0.2 * s, D_ - 0.1 * s, 0.2 * s), '#3a3440')
    # barrel roof
    for k in range(9):
        a0, a1 = k / 9 * math.pi, (k + 1) / 9 * math.pi
        q = []
        for (a, sx_) in ((a0, -1), (a1, -1), (a1, 1), (a0, 1)):
            q.append((x + sx_ * (L - D_) / 2, y - math.cos(a) * D_ / 2 * 1.02, 0.2 * s + H_ + math.sin(a) * 0.22 * s))
        P['paint'].add(q, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#e8e2d8'))
    # stripes and windows along the front
    _box(P, 'paint', (x, front - 0.01 * s, 0.42 * s), (L - D_, 0.02, 0.1 * s), '#2fb7a8')
    _box(P, 'paint', (x, front - 0.01 * s, 1.32 * s), (L - D_, 0.02, 0.08 * s), '#d8343f')
    for k in range(7):
        px_ = x - (L - D_) / 2 + 0.2 * s + k * (L - D_ - 0.4 * s) / 6
        _box(P, 'glow', (px_, front - 0.015 * s, 0.9 * s), (0.26 * s, 0.02, 0.5 * s), '#ffd9a8')
    _box(P, 'glow', (x + 0.2 * s, front - 0.02 * s, 0.7 * s), (0.34 * s, 0.03, 0.9 * s), '#ffc98a')  # door
    for k in range(3):
        _box(P, 'stone', (x + 0.2 * s, front - 0.12 * s - k * 0.1 * s, 0.15 * s - k * 0.05 * s), (0.6 * s, 0.12 * s, 0.05 * s), '#cfc6ba')
    # rooftop sign: DINER in red neon over a white board, with a gold arrow
    sb = cp.sign_board(P, (x - 0.3 * s) * PX, -(y + 0.1 * s) * PX * COSB, 0.2 * s + H_ + 0.25 * s, 1.9 * s, 0.6 * s, backing='#fff4ea')
    cp.neon_text(P, 'DINER', (sb[0], sb[1] - 0.06 * s, sb[2]), 0.42 * s, cp.NEON['red'])
    arrow = [(y_ * 0.18 * s, -x_ * 0.18 * s) for (x_, y_) in [(-1.0, -0.22), (0.3, -0.22), (0.3, -0.55), (1.0, 0.0), (0.3, 0.55), (0.3, 0.22), (-1.0, 0.22)]]
    cp.neon_shape(P, arrow, (sb[0] + 1.15 * s, sb[1] - 0.06 * s, sb[2] - 0.1 * s), cp.NEON['gold'], r=0.02 * s)
    # the little stage at the right end: deck, star backdrop, mic stand, guitar and an amp
    sx_ = x + L / 2 + 0.55 * s
    _box(P, 'wood', (sx_, y, 0.12 * s), (1.0 * s, 1.0 * s, 0.24 * s), '#6a3a3a')
    _bulbs_line(P, (sx_ - 0.5 * s, y - 0.51 * s, 0.2 * s), (sx_ + 0.5 * s, y - 0.51 * s, 0.2 * s), 8, colors=('#fff1b8', '#ff9ad2'), r=0.028 * s)
    _box(P, 'paint', (sx_, y + 0.45 * s, 0.9 * s), (1.0 * s, 0.06 * s, 1.3 * s), '#2a2036')
    cp.neon_shape(P, cp.star_pts(0.3 * s, 0.13 * s), (sx_, y + 0.41 * s, 1.05 * s), cp.NEON['gold'], r=0.028 * s)
    v, f = lib.cylinder((sx_ - 0.1 * s, y - 0.2 * s, 0.24 * s), 0.012 * s, 0.012 * s, 0.75 * s, 6)
    P['chrome'].add(v, f, col('#c9ced8'))
    v, f = lib.blob((sx_ - 0.1 * s, y - 0.2 * s, 1.02 * s), 0.05 * s, rough=0.0, subdiv=1)
    P['chrome'].add(v, f, col('#e8ecf2'))
    body = [(0.0, 0.0), (0.1, 0.06), (0.12, 0.16), (0.07, 0.22), (0.1, 0.32), (0.06, 0.4), (-0.06, 0.4), (-0.1, 0.32), (-0.07, 0.22), (-0.12, 0.16), (-0.1, 0.06)]
    gv = [(px_ * s * 1.3, py_ * s * 1.3, 0.0) for (px_, py_) in body] + [(px_ * s * 1.3, py_ * s * 1.3, 0.04 * s) for (px_, py_) in body]
    n = len(body)
    gf = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    P['paint'].add(facing(gv, (sx_ + 0.25 * s, y - 0.1 * s, 0.3 * s), lean=0.35), gf, col('#d8343f'))
    neck = [(0.0, 0.52 * s * 1.3, 0.0), (0.0, 1.0 * s * 1.1, 0.0)]
    v, f = lib.tube(facing(neck, (sx_ + 0.25 * s, y - 0.1 * s, 0.3 * s), lean=0.35), 0.018 * s, 5)
    P['wood'].add(v, f, col('#3a2a20'))
    _box(P, 'matte', (sx_ + 0.3 * s, y + 0.15 * s, 0.45 * s), (0.36 * s, 0.24 * s, 0.42 * s), '#2a2630')
    return P.build()


def saloon(bx, by, s=1.0):
    """The pink honky-tonk saloon: a western false front studded with rhinestones, a balcony,
    swinging doors, a neon cowboy hat and stars, and a rodeo corral with barrels and a toy bull."""
    P = Parts('saloon')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.75 * s
    W_, D_, H_ = 3.2 * s, 1.4 * s, 2.0 * s
    front = y - D_ / 2
    PINK, TRIM = '#e07aa0', '#fff0f4'
    _box(P, 'paint', (x, y, H_ / 2), (W_, D_, H_), PINK)
    # the false front, taller, with a stepped top
    ff = [(-W_ / 2, 0.0), (W_ / 2, 0.0), (W_ / 2, 2.4 * s), (W_ * 0.3, 2.4 * s), (W_ * 0.3, 2.75 * s), (-W_ * 0.3, 2.75 * s), (-W_ * 0.3, 2.4 * s), (-W_ / 2, 2.4 * s)]
    verts = [(px_, py_, 0.0) for (px_, py_) in ff] + [(px_, py_, 0.08 * s) for (px_, py_) in ff]
    n = len(ff)
    faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    P['paint'].add(facing(verts, (x, front - 0.1 * s, 0.0)), faces, col(PINK))
    trim = [(px_, py_, -0.01) for (px_, py_) in ff] + [(ff[0][0], ff[0][1], -0.01)]
    v, f = lib.tube(facing(trim, (x, front - 0.1 * s, 0.0)), 0.04 * s, 5)
    P['paint'].add(v, f, col(TRIM))
    # rhinestones: sparkling studs along the false front's edges and in a band
    rnd = random.Random(31)
    for k in range(46):
        t = k / 45
        px_ = -W_ / 2 + 0.1 * s + t * (W_ - 0.2 * s)
        for zz in (2.28 * s, 1.62 * s):
            v, f = lib.blob((x + px_, front - 0.15 * s, zz), 0.028 * s, rough=0.0, subdiv=1)
            P['neon'].add(v, f, col(rnd.choice(['#ffffff', '#ffd0ec', '#bff6ff', '#fff1b8'])))
    cp.neon_text(P, 'SALOON', (x, front - 0.16 * s, 1.95 * s), 0.34 * s, cp.NEON['white'])
    # balcony with railing over the doors
    _box(P, 'wood', (x, front - 0.45 * s, 1.18 * s), (W_ - 0.2 * s, 0.7 * s, 0.08 * s), '#8a5a4a')
    for k in range(17):
        px_ = x - W_ / 2 + 0.2 * s + k * (W_ - 0.4 * s) / 16
        v, f = lib.cylinder((px_, front - 0.78 * s, 1.22 * s), 0.018 * s, 0.018 * s, 0.3 * s, 5)
        P['wood'].add(v, f, col(TRIM))
    v, f = lib.tube([(x - W_ / 2 + 0.2 * s, front - 0.78 * s, 1.52 * s), (x + W_ / 2 - 0.2 * s, front - 0.78 * s, 1.52 * s)], 0.025 * s, 5)
    P['wood'].add(v, f, col(TRIM))
    for dx in (-1.35, -0.45, 0.45, 1.35):
        v, f = lib.cylinder((x + dx * s, front - 0.78 * s, 0.0), 0.035 * s, 0.035 * s, 1.16 * s, 8)
        P['wood'].add(v, f, col(TRIM))
    # doors and windows (warm light) and the swinging doors
    _box(P, 'glow', (x, front - 0.12 * s, 0.6 * s), (0.7 * s, 0.02, 1.1 * s), '#ffc98a')
    for dx in (-0.17, 0.17):
        _box(P, 'wood', (x + dx * s, front - 0.14 * s, 0.6 * s), (0.3 * s, 0.03, 0.5 * s), '#b0705a')
    for dx in (-1.05, 1.05):
        _box(P, 'glow', (x + dx * s, front - 0.12 * s, 0.7 * s), (0.6 * s, 0.02, 0.6 * s), '#ffd9a8')
        _box(P, 'glow', (x + dx * s, front - 0.12 * s, 2.05 * s), (0.34 * s, 0.02, 0.34 * s), '#ffe6c0')
    # a neon cowboy hat and two stars on the roof
    hat = [(-0.62, 0.0), (-0.45, 0.1), (-0.3, 0.12), (-0.26, 0.42), (-0.12, 0.5), (0.0, 0.44), (0.12, 0.5), (0.26, 0.42), (0.3, 0.12), (0.45, 0.1), (0.62, 0.0), (0.4, -0.06), (-0.4, -0.06)]
    cp.neon_shape(P, [(px_ * s, py_ * s) for (px_, py_) in hat], (x, front + 0.2 * s, 3.0 * s), cp.NEON['pink'], r=0.035 * s)
    for dx in (-1.25, 1.25):
        cp.neon_shape(P, cp.star_pts(0.2 * s, 0.085 * s), (x + dx * s, front - 0.1 * s, 2.72 * s), cp.NEON['gold'], r=0.022 * s)
    # the rodeo corral to the right: a round fence, barrels and a toy bull
    cx_, cy_ = x + W_ / 2 + 1.05 * s, y - 0.2 * s
    for k in range(20):
        a = k / 20 * math.tau
        if math.sin(a) < -0.6:
            continue  # the gate faces the camera
        px_, py_ = cx_ + math.cos(a) * 0.8 * s, cy_ + math.sin(a) * 0.6 * s
        v, f = lib.cylinder((px_, py_, 0.0), 0.03 * s, 0.03 * s, 0.34 * s, 6)
        P['wood'].add(v, f, col('#9a6a4a'))
    for zz in (0.16, 0.3):
        pts = [(cx_ + math.cos(a) * 0.8 * s, cy_ + math.sin(a) * 0.6 * s, zz * s) for a in [(-0.3 * math.pi + k / 24 * 1.6 * math.pi) for k in range(25)]]
        v, f = lib.tube(pts, 0.02 * s, 5)
        P['wood'].add(v, f, col('#b07a55'))
    for (dx, dy, cc) in ((-0.4, 0.1, '#e07aa0'), (0.35, 0.2, '#f2c14e'), (0.0, 0.35, '#e07aa0')):
        v, f = lib.lathe([(0.1 * s, 0.0), (0.11 * s, 0.12 * s), (0.1 * s, 0.24 * s), (0.0, 0.24 * s)], 12, (cx_ + dx * s, cy_ + dy * s, 0.0))
        P['paint'].add(v, f, col(cc))
    bull = (cx_ + 0.05 * s, cy_ - 0.1 * s)
    v, f = lib.blob((bull[0], bull[1], 0.32 * s), 0.2 * s, squash=(1.3, 0.8, 0.75), rough=0.05, subdiv=2)
    P['paint'].add(v, f, col('#f4e6f0'))
    v, f = lib.blob((bull[0] - 0.26 * s, bull[1] - 0.04 * s, 0.4 * s), 0.1 * s, rough=0.05, subdiv=2)
    P['paint'].add(v, f, col('#f4e6f0'))
    for side in (-1, 1):
        v, f = lib.tube([(bull[0] - 0.28 * s, bull[1] + side * 0.05 * s, 0.48 * s), (bull[0] - 0.3 * s, bull[1] + side * 0.14 * s, 0.56 * s)], 0.015 * s, 5)
        P['metal'].add(v, f, col('#f2c14e'))
    v, f = lib.cylinder((bull[0], bull[1], 0.0), 0.05 * s, 0.05 * s, 0.14 * s, 8)
    P['metal'].add(v, f, col('#c9ced8'))
    for k in range(12):
        a = k / 12 * math.tau
        v, f = lib.blob((bull[0] + math.cos(a) * 0.16 * s, bull[1] + math.sin(a) * 0.1 * s, 0.34 * s + math.sin(a * 2) * 0.04 * s), 0.018 * s, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col(rnd.choice(['#ffffff', '#ffd0ec', '#bff6ff'])))  # rhinestone saddle
    cp.string_lights(P, (x - W_ / 2) * PX, -(front - 0.8 * s) * PX * COSB, (x + W_ / 2) * PX, -(front - 0.8 * s) * PX * COSB, rnd, h=1.12 * s, sag=0.1, posts=False, n=12,
                     colors=('#ffd0ec', '#fff1b8', '#ff5ab4'))
    return P.build()


def comedy_club(bx, by, s=1.0):
    """The comedy club by the rink: a brick front with a lit marquee board, a big window onto a
    one-mic stage in a spotlight, and a neon pair of crossed hockey sticks."""
    P = Parts('comedy')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.6 * s
    W_, D_, H_ = 1.9 * s, 1.2 * s, 2.4 * s
    front = y - D_ / 2
    _box(P, 'paint', (x, y, H_ / 2), (W_, D_, H_), '#8d4a3c')
    _box(P, 'stone', (x, y, H_ + 0.05 * s), (W_ + 0.1 * s, D_ + 0.1 * s, 0.1 * s), '#cdbfb0')
    # marquee board with COMEDY
    _box(P, 'paint', (x, front - 0.2 * s, 1.72 * s), (1.7 * s, 0.1 * s, 0.46 * s), '#fff4dc')
    _bulbs_line(P, (x - 0.85 * s, front - 0.26 * s, 1.97 * s), (x + 0.85 * s, front - 0.26 * s, 1.97 * s), 14, r=0.026 * s)
    _bulbs_line(P, (x - 0.85 * s, front - 0.26 * s, 1.47 * s), (x + 0.85 * s, front - 0.26 * s, 1.47 * s), 14, r=0.026 * s)
    cp.neon_text(P, 'COMEDY', (x, front - 0.27 * s, 1.72 * s), 0.3 * s, cp.NEON['red'])
    # the window onto the stage: a spotlit circle on a brick wall and a mic stand
    _box(P, 'glow', (x - 0.35 * s, front - 0.02 * s, 0.75 * s), (0.9 * s, 0.02, 0.9 * s), '#5a3a48')
    spot = [(math.cos(k / 24 * math.tau) * 0.3 * s, math.sin(k / 24 * math.tau) * 0.3 * s, 0.0) for k in range(24)]
    P['glow'].add(facing(spot, (x - 0.35 * s, front - 0.04 * s, 0.72 * s)), [tuple(range(24))], col('#ffe6b0'))
    mic = [(0.0, -0.3 * s, -0.01), (0.0, 0.1 * s, -0.01)]
    v, f = lib.tube(facing(mic, (x - 0.35 * s, front - 0.05 * s, 0.72 * s)), 0.01 * s, 5)
    P['metal'].add(v, f, col('#2a2630'))
    _box(P, 'glow', (x + 0.6 * s, front - 0.02 * s, 0.55 * s), (0.36 * s, 0.03, 0.9 * s), '#ffc98a')  # door
    # crossed hockey sticks in neon on the upper wall
    for side in (-1, 1):
        stick = [(-side * 0.35, 0.35), (side * 0.2, -0.25), (side * 0.38, -0.3)]
        cp.neon_shape(P, [(px_ * s, py_ * s) for (px_, py_) in stick], (x, front - 0.03 * s, 2.55 * s), cp.NEON['cyan'] if side < 0 else cp.NEON['white'], r=0.025 * s, closed=False)
    v, f = lib.cylinder((0, 0, 0), 0.08 * s, 0.08 * s, 0.04 * s, 16)
    v = lib.transform(v, (x, front - 0.06 * s, 2.25 * s), rot=(math.pi / 2, 0, 0))
    P['matte'].add(v, f, col('#1b1a20'))
    return P.build()


def wheel_stand(bx, by, s=1.0):
    """A prize-wheel booth: an A-frame with a bulb-lit marquee top and the pointer (the wheel itself
    is a separate sprite that spins)."""
    P = Parts('wheelstand')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.3 * s
    hub = wheel_hub(x, y, s)
    for dx in (-1, 1):
        v, f = lib.tube([(x + dx * 0.55 * s, y + 0.1 * s, 0.0), (x + dx * 0.12 * s, hub.y + 0.08 * s, hub.z)], 0.05 * s, 8)
        P['paint'].add(v, f, col('#d8343f'))
    _box(P, 'paint', (x, y + 0.1 * s, 0.25 * s), (1.2 * s, 0.4 * s, 0.5 * s), '#f2c14e')
    _bulbs_line(P, (x - 0.6 * s, y - 0.12 * s, 0.45 * s), (x + 0.6 * s, y - 0.12 * s, 0.45 * s), 8, colors=('#fff1b8', '#ff5ab4'), r=0.03 * s)
    cp.neon_text(P, 'SPIN!', (x, y - 0.13 * s, 0.24 * s), 0.2 * s, cp.NEON['red'])
    return P.build()


def wheel_pointer(bx, by, s=1.0):
    """The pointer at the top of the wheel (its own sprite, drawn over the spinning face)."""
    P = Parts('wheelpointer')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.3 * s
    hub = wheel_hub(x, y, s)
    top = hub + wheel_up() * (0.92 * s)
    tri = [(top.x - 0.1 * s, top.y - 0.12, top.z + 0.2 * s), (top.x + 0.1 * s, top.y - 0.12, top.z + 0.2 * s), (top.x, top.y - 0.12, top.z - 0.1 * s)]
    v = tri + [(px_, py_ + 0.04, pz_) for (px_, py_, pz_) in tri]
    P['metal'].add(v, [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], col('#f2c14e'))
    v, f = lib.blob((top.x, top.y - 0.1, top.z + 0.24 * s), 0.06 * s, rough=0.0, subdiv=1)
    P['neon'].add(v, f, col('#fff1b8'))
    return P.build()


def wheel_up():
    view = Vector((0.0, lib.SINB, -lib.COSB))
    right = Vector((1, 0, 0))
    return view.cross(right).normalized() * -1


def wheel_hub(x, y, s):
    return Vector((x, y - 0.05, 1.6 * s))


def wheel_face(bx, by, s=1.0):
    """The wheel itself: coloured wedges, a gold rim studded with bulbs and a star hub, modelled in
    the plane facing the camera so it can spin in 2D round its hub."""
    P = Parts('wheelface')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.3 * s
    hub = wheel_hub(x, y, s)
    view = Vector((0.0, lib.SINB, -lib.COSB))
    right = Vector((1, 0, 0))
    up = wheel_up()
    R = 0.9 * s
    n = 12
    cols = ['#ff5ab4', '#ffcf4a', '#4de8ff', '#8dff6a', '#b27bff', '#ff9a3c']
    for k in range(n):
        a0, a1 = k / n * math.tau, (k + 1) / n * math.tau
        pts = [hub - view * 0.02]
        for j in range(5):
            a = a0 + (a1 - a0) * j / 4
            pts.append(hub - view * 0.02 + (right * math.cos(a) + up * math.sin(a)) * R)
        verts = [tuple(p) for p in pts]
        faces = [tuple(range(len(verts))), tuple(range(len(verts)))[::-1]]
        P['paint'].add(verts, faces, col(cols[k % len(cols)]))
        a = a0
        spoke = [tuple(hub - view * 0.03), tuple(hub - view * 0.03 + (right * math.cos(a) + up * math.sin(a)) * R)]
        v, f = lib.tube(spoke, 0.012 * s, 4)
        P['metal'].add(v, f, col('#fff4dc'))
    rim = [tuple(hub - view * 0.03 + (right * math.cos(k / 48 * math.tau) + up * math.sin(k / 48 * math.tau)) * R) for k in range(49)]
    v, f = lib.tube(rim, 0.05 * s, 6)
    P['metal'].add(v, f, col('#f2c14e'))
    for k in range(24):
        a = k / 24 * math.tau
        q = hub - view * 0.08 + (right * math.cos(a) + up * math.sin(a)) * (R + 0.01)
        v, f = lib.blob(tuple(q), 0.035 * s, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col('#fff1b8' if k % 2 else '#ff9ad2'))
    star = cp.star_pts(0.2 * s, 0.09 * s)
    sv = [tuple(hub - view * 0.06 + right * px_ + up * py_) for (px_, py_) in star]
    P['metal'].add(sv, [tuple(range(len(sv))), tuple(range(len(sv)))[::-1]], col('#f2c14e'))
    return P.build(), hub


def vip_gate(bx, by, s=1.0):
    """The VIP rope: brass stanchions, a red velvet rope and a glowing star arch."""
    P = Parts('gate')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y
    for dx in (-0.6, 0.6):
        v, f = lib.cylinder((x + dx * s, y, 0.0), 0.06 * s, 0.05 * s, 1.5 * s, 10)
        P['metal'].add(v, f, col('#f2c14e'))
        v, f = lib.blob((x + dx * s, y, 1.55 * s), 0.08 * s, rough=0.0, subdiv=2)
        P['neon'].add(v, f, col('#fff1b8'))
    arch = []
    for k in range(17):
        a = math.pi - k / 16 * math.pi
        arch.append((x + math.cos(a) * 0.6 * s, y, 1.5 * s + math.sin(a) * 0.35 * s))
    v, f = lib.tube(arch, 0.035 * s, 6)
    P['metal'].add(v, f, col('#f2c14e'))
    cp.neon_shape(P, cp.star_pts(0.2 * s, 0.085 * s), (x, y - 0.05 * s, 1.95 * s), cp.NEON['gold'], r=0.024 * s)
    cp.neon_text(P, 'VIP', (x, y - 0.06 * s, 1.52 * s), 0.18 * s, cp.NEON['pink'])
    for dx in (-0.3, 0.3):
        v, f = lib.cylinder((x + dx * s, y, 0.0), 0.03 * s, 0.025 * s, 0.4 * s, 8)
        P['metal'].add(v, f, col('#f2c14e'))
    rope = [(x - 0.3 * s + t * 0.6 * s, y - 0.01, 0.36 * s - 0.08 * s * math.sin(t * math.pi)) for t in [i / 10 for i in range(11)]]
    v, f = lib.tube(rope, 0.022 * s, 6)
    P['paint'].add(v, f, col('#8a1030'))
    return P.build()


def merch_cart(bx, by, s=1.0):
    P = Parts('merch')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.25 * s
    _box(P, 'paint', (x, y, 0.42 * s), (0.9 * s, 0.5 * s, 0.5 * s), '#8e5cd9')
    _box(P, 'glow', (x, y - 0.26 * s, 0.5 * s), (0.7 * s, 0.02, 0.22 * s), '#ffd48a')
    for dx in (-0.3, 0.3):
        v, f = lib.cylinder((0, 0, 0), 0.14 * s, 0.14 * s, 0.05, 14)
        v = lib.transform(v, (x + dx * s, y - 0.26 * s, 0.16 * s), rot=(math.pi / 2, 0, 0))
        P['matte'].add(v, f, col('#2a2630'))
    for dx in (-0.42, 0.42):
        v, f = lib.cylinder((x + dx * s, y - 0.2 * s, 0.66 * s), 0.02 * s, 0.02 * s, 0.6 * s, 6)
        P['metal'].add(v, f, col('#d9d4cc'))
    for k in range(6):
        q = [(x - 0.5 * s + k * (1.0 / 6) * s, y - 0.45 * s, 1.18 * s), (x - 0.5 * s + (k + 1) * (1.0 / 6) * s, y - 0.45 * s, 1.18 * s),
             (x - 0.5 * s + (k + 1) * (1.0 / 6) * s, y + 0.1 * s, 1.34 * s), (x - 0.5 * s + k * (1.0 / 6) * s, y + 0.1 * s, 1.34 * s)]
        P['paint'].add(q, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#8e5cd9' if k % 2 else '#fff4dc'))
    cp.neon_shape(P, cp.note_pts(0.14 * s), (x, y - 0.1 * s, 1.52 * s), cp.NEON['gold'], r=0.016 * s)
    return P.build()


def pennants(bx, by, width, s=1.0):
    """Bunting of little triangular pennants between two poles, with bulbs between the flags."""
    P = Parts('pennants')
    a = board_to_world(bx - width / 2, by, 0.0)
    b_ = board_to_world(bx + width / 2, by, 0.0)
    Hh = 1.55 * s
    for q in (a, b_):
        v, f = lib.cylinder((q.x, q.y, 0.0), 0.035 * s, 0.03 * s, Hh + 0.05, 8)
        P['metal'].add(v, f, col('#2e2c36'))
        v, f = lib.blob((q.x, q.y, Hh + 0.08 * s), 0.06 * s, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col('#fff1b8'))
    cols = ['#ff5ab4', '#ffcf4a', '#4de8ff', '#b27bff', '#8dff6a', '#ff9a3c']
    n = 11
    pts = [(a.x + (b_.x - a.x) * (i / (n * 2)), a.y + (b_.y - a.y) * (i / (n * 2)), Hh - 0.05 - math.sin(i / (n * 2) * math.pi) * 0.32 * s) for i in range(n * 2 + 1)]
    v, f = lib.tube(pts, 0.01 * s, 4)
    P['metal'].add(v, f, col('#26242c'))
    for k in range(n):
        p0, p1 = Vector(pts[2 * k]), Vector(pts[2 * k + 2])
        mid = (p0 + p1) / 2
        tip = Vector((mid.x, mid.y - 0.02, mid.z - 0.28 * s))
        P['paint'].add([tuple(p0), tuple(p1), tuple(tip)], [(0, 1, 2), (2, 1, 0)], col(cols[k % len(cols)]))
        v, f = lib.blob(tuple(p1 - Vector((0, 0, 0.03))), 0.026 * s, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col('#fff1b8'))
    return P.build()


def build_landmarks(b):
    built = {}
    for lm in LANDMARKS:
        k, x, y, s = lm['kind'], lm['x'], lm['y'], lm.get('s', 1.0)
        lid = lm['id']
        if k == 'theatre':
            obs = theatre(x, y, s)
        elif k == 'fountain':
            obs = fountain(x, y, s)
        elif k == 'bandstand':
            obs = bandstand(x, y, s)
        elif k == 'cafe':
            obs = cafe(x, y, s)
        elif k == 'popstage':
            obs = pop_stage(x, y, s)
        elif k == 'drivein':
            obs = drive_in(x, y, s)
        elif k == 'diner':
            obs = diner(x, y, s)
        elif k == 'saloon':
            obs = saloon(x, y, s)
        elif k == 'comedy':
            obs = comedy_club(x, y, s)
        elif k == 'wheelstand':
            obs = wheel_stand(x, y, s)
            face, hub = wheel_face(x, y, s)
            wid = lid.replace('stand', 'face')
            hb = lib.world_to_board(hub)
            built[wid] = (dict(id=wid, kind='sails', x=x, y=y, tex='', hub=[hb[0], hb[1]]), face)
            pid = lid.replace('stand', 'pointer')
            built[pid] = (dict(id=pid, kind='pointer', x=x, y=y, tex='', depth_y=y + 8), wheel_pointer(x, y, s))
        elif k == 'gate':
            obs = vip_gate(x, y, s)
        elif k == 'stall':
            obs = merch_cart(x, y, s)
        elif k == 'bunting':
            obs = pennants(x, y, lm['width'], s)
        elif k == 'lantern':
            P = Parts(lid)
            cp.street_lamp(P, x, y, random.Random(int(x)), style='double', glow='#fff0cf', energy=70.0, h=1.15)
            obs = P.build()
        else:
            continue
        built[lid] = (lm, obs)
    sys.path.insert(0, kit.ART)
    import props as sprops
    sprops.use_board_look()
    for g in RELIC_GATES:
        n = b.nodes[g]
        lm = dict(id=f'pedestal-{g}', kind='pedestal', x=n['x'], y=n['y'] - 85, tex='relic-pedestal')
        built[lm['id']] = (lm, sprops.pedestal(lm['x'], lm['y'], 1.0))
    return built


# ------------------------------------------------------------------------------------------
# Terrain dressing
def cafe_table(P: Parts, bx, by, rnd):
    p = board_to_world(bx, by, 0.0)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.015, 0.015, 0.2, 6)
    P['metal'].add(v, f, col('#e8e2d8'))
    v, f = lib.cylinder((p.x, p.y, 0.2), 0.12, 0.12, 0.02, 14)
    P['paint'].add(v, f, col('#fff4ea'))
    v, f = lib.cylinder((p.x, p.y, 0.2), 0.012, 0.012, 0.45, 6)
    P['metal'].add(v, f, col('#e8e2d8'))
    v, f = lib.lathe([(0.3, 0.0), (0.0, 0.12)], 12, (p.x, p.y, 0.6))
    P['paint'].add(v, f, col(rnd.choice(['#f2b6c9', '#a9dcc9', '#f4d6a0', '#b9b2e6'])))
    for a in (0.3, 2.5):
        v, f = lib.box((p.x + math.cos(a) * 0.2, p.y + math.sin(a) * 0.16, 0.1), (0.1, 0.1, 0.02))
        P['metal'].add(v, f, col('#e8e2d8'))


def hay(P: Parts, bx, by, rnd):
    p = board_to_world(bx, by, 0.0)
    v, f = lib.box((p.x, p.y, 0.09), (0.3, 0.2, 0.18), rot_z=rnd.uniform(-0.4, 0.4))
    P['wood'].add(v, f, col(rnd.choice(['#e0b85a', '#d4a94a'])))


def barrel(P: Parts, bx, by, rnd):
    p = board_to_world(bx, by, 0.0)
    v, f = lib.lathe([(0.09, 0.0), (0.105, 0.12), (0.09, 0.24), (0.0, 0.24)], 12, (p.x, p.y, 0.0))
    P['wood'].add(v, f, col(rnd.choice(['#8a5a3a', '#7a4a2e'])))


def spotlight_stand(P: Parts, bx, by, rnd, glow='#fff2cf'):
    p = board_to_world(bx, by, 0.0)
    for k in range(3):
        a = k / 3 * math.tau
        v, f = lib.tube([(p.x, p.y, 0.3), (p.x + math.cos(a) * 0.12, p.y + math.sin(a) * 0.12, 0.0)], 0.012, 4)
        P['metal'].add(v, f, col('#2e2c36'))
    v, f = lib.cylinder((p.x, p.y, 0.28), 0.07, 0.09, 0.16, 12)
    P['metal'].add(v, f, col('#2e2c36'))
    v, f = lib.cylinder((p.x, p.y - 0.02, 0.44), 0.075, 0.075, 0.01, 12)
    P['neon'].add(v, f, col(glow))


def scatter_block(P: Parts, b, ids, mask, dist, look, rnd):
    ys, xs = mask.nonzero()
    if not len(xs):
        return
    area = len(xs) * GRID * GRID
    surface = look.get('surface', 'boulevard')

    def pick(min_edge=14, path_clear=0.02, node_r=92, lm_pad=34):
        for _ in range(50):
            j = rnd.randrange(len(xs))
            bx = xs[j] * GRID + rnd.uniform(0, GRID)
            by = ys[j] * GRID + rnd.uniform(0, GRID)
            if kit.dist_at(dist, bx, by) < min_edge or b.pmask_at(bx, by) > path_clear or b.near_node(bx, by, node_r) or b.near_landmark(bx, by, lm_pad):
                continue
            return bx, by
        return None

    def many(fn, per, **kw):
        for _ in range(int(area / per)):
            pt = pick(**kw)
            if pt:
                fn(*pt)

    tall_ok = lambda bx, by, h: b.canopy_clear(bx, by, 60, h)  # noqa: E731
    if surface in ('boulevard', 'checker', 'marquee'):
        many(lambda bx, by: cp.palm(P, bx, by, rnd, 1.0, glow=rnd.choice([None, '#ff5ab4', '#4de8ff'])) if tall_ok(bx, by, 150) else None, 30000, min_edge=24)
        many(lambda bx, by: cp.planter(P, bx, by, rnd, 1.0), 22000)
        many(lambda bx, by: cp.bench(P, bx, by, rnd, color='#6a3a5a'), 30000)
        many(lambda bx, by: cp.bollard(P, bx, by, glow='#ffd0ec'), 14000, min_edge=8, path_clear=0.3, node_r=70)
    if surface in ('boulevard', 'checker'):
        many(lambda bx, by: cp.car50s(P, bx, by, rnd, color=rnd.choice(['#ff8fb1', '#7fd6c9', '#f4d6a0', '#d8343f', '#b9b2e6']), rz=rnd.choice([0.0, math.pi])), 40000, min_edge=30)
        many(lambda bx, by: cp.jukebox(P, bx, by, rnd, 0.8) if tall_ok(bx, by, 60) else None, 60000)
    if surface == 'checker':
        many(lambda bx, by: cp.jukebox(P, bx, by, rnd, 0.9) if tall_ok(bx, by, 60) else None, 30000)
    if surface == 'marquee':
        many(lambda bx, by: spotlight_stand(P, bx, by, rnd), 24000)
    if surface == 'pastel':
        many(lambda bx, by: cafe_table(P, bx, by, rnd) if tall_ok(bx, by, 50) else None, 11000, node_r=86)
        many(lambda bx, by: cp.planter(P, bx, by, rnd, 1.0), 14000)
        many(lambda bx, by: cp.potted_tree(P, bx, by, rnd, 1.0, palette=('#2a6e4a', '#9ad98a')) if tall_ok(bx, by, 90) else None, 24000)
    if surface == 'western':
        many(lambda bx, by: hay(P, bx, by, rnd), 12000)
        many(lambda bx, by: barrel(P, bx, by, rnd), 12000)
        many(lambda bx, by: cp.planter(P, bx, by, rnd, 0.9), 30000)


FACADE_WORDS = {
    'boulevard': ['LIVE', 'TICKETS', 'RECORDS', 'DANCE', 'ARCADE'],
    'pastel': ['SWEETS', 'BAKERY', 'FLOWERS'],
    'checker': ['SHAKES', 'BURGERS', 'RECORDS'],
    'western': ['BOOTS', 'RODEO', 'HATS'],
    'marquee': ['TICKETS', 'TONIGHT'],
    'ice': ['SKATE'],
}


def deck_style(na, nb):
    return DECK_STYLE.get(na.get('region'), DECK_STYLE.get(nb.get('region'), 'neon'))


def block_extras(P: Parts, b, ids, ring, nrm, look, rnd):
    cp.facade_signs(P, ring, nrm, FACADE_WORDS.get(look.get('surface'), ['LIVE']), rnd, count=2 if len(ids) > 2 else 1)


def stage_floor(P: Parts, b, ids, color, edge, rnd):
    """A stage deck laid flush under a stage's spaces, ringed with little bulbs."""
    xs = [b.nodes[i]['x'] for i in ids]
    ys = [b.nodes[i]['y'] for i in ids]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    hw = (max(xs) - min(xs)) / 2 + 95
    hh = (max(ys) - min(ys)) / 2 + 64
    c = board_to_world(cx, cy, 0.0)
    poly = kit.rounded_rect(c.x, c.y, hw / PX, kit.depth_units(hh), 0.25, seg=4)
    n = len(poly)
    verts = [(x, y, 0.012) for (x, y) in poly]
    P['paint'].add(verts, [tuple(range(n))], col(color))
    for k in range(0, n, 2):
        x, y = poly[k]
        v, f = lib.blob((x, y, 0.03), 0.028, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col(edge if k % 4 else '#fff1b8'))


def terrain_extras(P: Parts, b, masks, block_info, rnd):
    # stage decks under the three stages (the Spotlight Solo pays whoever stands on one)
    stage_floor(P, b, ['sl14', 'sl15'], '#2a2438', '#ff5a5a', rnd)
    stage_floor(P, b, ['sl5', 'sl6'], '#d9c9f2', '#ff9ad2', rnd)
    stage_floor(P, b, ['sr1', 'sr2'], '#6b1a2e', '#ffcf4a', rnd)
    # the ice rink: an ice pad inside white boards (open where the walkways come in), markings, goals
    si = [b.nodes[i] for i in ('si1', 'si2', 'si3')]
    cx = sum(n['x'] for n in si) / 3
    y0, y1 = si[0]['y'] - 70, si[2]['y'] + 62
    c = board_to_world(cx, (y0 + y1) / 2, 0.0)
    hw, hh = 1.3, kit.depth_units((y1 - y0) / 2)
    poly = kit.rounded_rect(c.x, c.y, hw, hh, 0.55, seg=6)
    ice = lib.mesh_object('rink_ice', [(x, y, 0.004) for (x, y) in poly], [tuple(range(len(poly)))], smooth=False)
    ice.data.materials.append(kit.surface_material('rink', 'ice', b.pm_path, b.W, b.H))
    doors = [board_to_world(si[0]['x'], y0 - 10, 0.0), board_to_world(si[2]['x'], y1 + 10, 0.0)]
    for k in range(len(poly)):
        a, bq = poly[k], poly[(k + 1) % len(poly)]
        mx, my = (a[0] + bq[0]) / 2, (a[1] + bq[1]) / 2
        if any(math.hypot(mx - d.x, my - d.y) < 0.62 for d in doors):
            continue
        L = math.hypot(bq[0] - a[0], bq[1] - a[1])
        v, f = lib.box((mx, my, 0.1), (L + 0.01, 0.05, 0.2), rot_z=math.atan2(bq[1] - a[1], bq[0] - a[0]))
        P['paint'].add(v, f, col('#f7fbff'))
        v, f = lib.box((mx, my, 0.205), (L + 0.01, 0.06, 0.02), rot_z=math.atan2(bq[1] - a[1], bq[0] - a[0]))
        P['paint'].add(v, f, col('#d8343f'))
    for (yy, cc) in ((si[1]['y'], '#e84a4a'), (si[1]['y'] - 95, '#4a7ae8'), (si[1]['y'] + 95, '#4a7ae8')):
        a = board_to_world(cx - 120, yy, 0.0)
        bq = board_to_world(cx + 120, yy, 0.0)
        v, f = lib.box(((a.x + bq.x) / 2, (a.y + bq.y) / 2, 0.006), (bq.x - a.x, 0.06, 0.004))
        P['paint'].add(v, f, col(cc))
    c0 = board_to_world(cx, si[1]['y'], 0.0)
    ring = [(c0.x + math.cos(k / 32 * math.tau) * 0.7, c0.y + math.sin(k / 32 * math.tau) * 0.55, 0.008) for k in range(33)]
    v, f = lib.tube(ring, 0.02, 4)
    P['paint'].add(v, f, col('#4a7ae8'))
    for n_, dy in ((si[0], -80), (si[2], 70)):
        g = board_to_world(n_['x'] + 95, n_['y'] + dy * 0.2, 0.0)
        v, f = lib.box((g.x, g.y, 0.12), (0.34, 0.22, 0.24))
        P['glass'].add(v, f, col('#f4f8ff'))
        pts = [(g.x - 0.17, g.y - 0.11, 0.0), (g.x - 0.17, g.y - 0.11, 0.24), (g.x + 0.17, g.y - 0.11, 0.24), (g.x + 0.17, g.y - 0.11, 0.0)]
        v, f = lib.tube(pts, 0.018, 5)
        P['paint'].add(v, f, col('#e84a4a'))
    # Star Coin pads behind each gate
    for g in RELIC_GATES:
        n = b.nodes[g]
        cp.star_pad(P, n['x'], n['y'] - 40, rnd, glow='#ff9ad2')
    # the drive-in lot: rows of little 50s cars facing the screen
    lot_rnd = random.Random(55)
    for row, yy in enumerate((1450, 1535)):
        for k in range(4):
            xx = 700 + k * 75 + row * 30
            if b.inside_any(masks, xx, yy) and not b.near_node(xx, yy, 90) and b.pmask_at(xx, yy) < 0.02:
                cp.car50s(P, xx, yy, lot_rnd, color=lot_rnd.choice(['#ff8fb1', '#7fd6c9', '#f4d6a0', '#d8343f', '#b9b2e6', '#ffffff']), rz=math.pi / 2 + lot_rnd.uniform(-0.1, 0.1), s=0.9)


def main():
    b = build_city()
    kit.city_main(A, b, OUT, SCALE, SAMPLES, deck_style=deck_style, scatter_block=scatter_block, block_extras=block_extras,
                  terrain_extras=terrain_extras, build_landmarks=build_landmarks, lamp_glow='#fff0cf', lamp_styles=('double', 'classic'), sky=0.45, moon=1.3)


if __name__ == '__main__':
    main()
