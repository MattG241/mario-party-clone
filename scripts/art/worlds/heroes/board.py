"""Hero Heights board art: a floating skyline district at night (terrain tiles + landmark sprites).

    node scripts/art/worlds/citykit/export.mjs heroes > scripts/art/worlds/heroes/board.json
    <bpy python> scripts/art/worlds/heroes/board.py --plan              (layout map, no render)
    <bpy python> scripts/art/worlds/heroes/board.py --preview           (quarter-size test render)
    <bpy python> scripts/art/worlds/heroes/board.py --export [--bands 4] (the board: tiles, props, manifest)

Landmarks are original homages: a gothic clock tower with gargoyles and a searchlight (west), a
gleaming tech spire with a glowing core (north-east) and a friendly neighbourhood block with a
web-strung water tower (east); subway-entrance portals, neon signs of our own, rooftop gardens.
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
OUT = os.path.join(kit.ROOT, 'art-out', 'heroes')
DATA = os.path.join(HERE, 'board.json')

# Landmarks (rendered as their own depth-sorted sprites). fw/fd: half width / half depth of the
# footprint in board px (grows the block under it); h: screen height (layout map only).
LANDMARKS = [
    dict(id='clocktower', kind='clocktower', x=380, y=1330, s=1.0, fw=118, fd=70, h=700, tex='observatory'),
    dict(id='techspire', kind='crystal_gen', x=2600, y=690, s=1.0, fw=130, fd=70, h=740, tex='crystal-generator'),
    dict(id='watertower', kind='watertower', x=3470, y=1250, s=1.3, fw=118, fd=70, h=420, tex='windmill'),
    dict(id='billboard', kind='billboard', x=1640, y=1985, s=1.0, fw=160, fd=24, h=260, tex=''),
    dict(id='bandstand', kind='bandstand', x=2080, y=1980, s=1.0, fw=92, fd=56, h=190, tex='', depth_y=1880),
    dict(id='lab', kind='lab', x=2372, y=708, s=1.0, fw=70, fd=44, h=170, tex=''),
    dict(id='garden-tree', kind='tree', x=1200, y=745, s=1.0, fw=70, fd=40, h=220, tex='tree-twist'),
    dict(id='cart', kind='stall', x=2740, y=1880, s=1.0, fw=70, fd=40, h=170, tex='stall'),
    dict(id='gate', kind='gate', x=1835, y=1995, s=1.0, tex='prism-gate'),
    dict(id='lights-neon', kind='bunting', x=2585, y=1932, s=1.0, width=250, tex='bunting'),
]
# street lamps beside the walkways (their glow gets a halo and a light pool at night)
for i, (lx, ly, st) in enumerate([(1545, 1990, 'double'), (1205, 1850, 'hook'), (705, 1770, 'hook'), (1555, 725, 'classic'), (2745, 800, 'classic'),
                                  (3345, 1790, 'classic'), (1935, 1455, 'double'), (700, 1170, 'hook')]):
    LANDMARKS.append(dict(id=f'lamp-{i}', kind='lantern', x=lx, y=ly, s=1.0, style=st, tex='lantern', fw=26, fd=12, no_ground=True))
# subway entrances behind the four portals
for pid in ('hl2', 'hr3', 'hf3', 'hn2'):
    LANDMARKS.append(dict(id=f'subway-{pid}', kind='lantern', node=pid, s=1.0, tex=''))
RELIC_GATES = ['hl3', 'hr2', 'ht3', 'hf2', 'hx2']

# Block looks by any space of the group: surface, facade and facade height.
LOOKS = {
    'hp0': dict(surface='plaza', facade='brick', fh=2.5),
    'hg0': dict(surface='gothic', facade='stone', fh=2.2),
    'hl1': dict(surface='gothic', facade='stone', fh=2.6),
    'hr0': dict(surface='garden', facade='brick', fh=2.4),
    'ht0': dict(surface='tech', facade='glass', fh=2.8),
    'hk0': dict(surface='block', facade='brick', fh=2.4),
    'hn0': dict(surface='neonrow', facade='deco', fh=2.3),
    # the Sky Rail's middle stop is a little station block (Mimi waits on its platform)
    'hx3': dict(surface='plaza', facade='deco', fh=1.8, block=True, grow=0.8),
}
DECK_STYLE = {  # crossing style by region of either end
    'Belfry Stairs': 'iron', 'Steel Skybridge': 'girder', 'Web Line': 'web', 'Sky Rail': 'rail',
}


def node_region(b, nid):
    return b.nodes[nid].get('region', '')


def build_city():
    b = kit.CityBoard(DATA, OUT, LANDMARKS, island_for=LOOKS)
    for lm in LANDMARKS:
        if lm.get('node'):
            # beside the portal, on the side away from its walkway (and behind it)
            n = b.nodes[lm['node']]
            prev = [e['from'] for e in b.edges if e['to'] == lm['node']][0]
            nxt = [e['to'] for e in b.edges if e['from'] == lm['node']][0]
            tx, ty = b.nodes[nxt]['x'] - b.nodes[prev]['x'], b.nodes[nxt]['y'] - b.nodes[prev]['y']
            L = math.hypot(tx, ty) or 1.0
            px_, py_ = ty / L, -tx / L
            if py_ > 0:
                px_, py_ = -px_, -py_
            lm['x'], lm['y'] = n['x'] + px_ * 86, n['y'] + py_ * 86 + 20
            lm['fw'], lm['fd'] = 56, 30
            lm['owner'] = lm['node']
    # extra ground: Mimi's station platform, Ora's bandstand, the tower backdrops
    b.extra_rects += [
        (2040, 1490, 150, 92, 0, 'hx3'),
        (2085, 1935, 110, 72, 0, 'hp0'),
        (1330, 640, 300, 70, 0, 'hr2'),
        (2830, 760, 150, 70, 0, 'ht3'),
        (3420, 1150, 110, 110, 0, 'hf1'),
        (560, 1180, 130, 90, 0, 'hl4'),
    ]
    return b


# ------------------------------------------------------------------------------------------
# Landmarks
def clock_tower(bx, by, s=1.0):
    """Gothic clock tower: buttressed shaft, rose window, a big glowing clock, gargoyles at the
    corners, an open belfry, a slate spire and a searchlight on its balcony."""
    P = Parts('clocktower')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.75 * s  # the footprint sits behind the anchor
    STONE, DARK, TRIM = col('#6a6474'), col('#4c4756'), col('#948d9c')
    w = 1.3 * s
    # plinth and shaft
    v, f = lib.box((x, y, 0.2 * s), (w + 0.3 * s, w + 0.3 * s, 0.4 * s))
    P['stone'].add(v, f, TRIM)
    v, f = lib.box((x, y, 2.8 * s), (w, w, 4.8 * s))
    P['stone'].add(v, f, STONE)
    for (dx, dy) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        # corner buttresses stepping in as they rise
        for k, (z0, z1, t) in enumerate(((0.4, 2.2, 0.26), (2.2, 3.8, 0.2), (3.8, 5.2, 0.15))):
            v, f = lib.box((x + dx * (w / 2 + t / 2 - 0.04) * 1.0, y + dy * (w / 2 + t / 2 - 0.04), (z0 + z1) / 2 * s), (t * s, t * s, (z1 - z0) * s))
            P['stone'].add(v, f, TRIM if k % 2 else STONE)
        v, f = lib.prism((x + dx * w / 2, y + dy * w / 2, 5.2 * s), 0.1 * s, 0.5 * s, sides=4, tip=0.8)
        P['stone'].add(v, f, TRIM)
    # string courses
    for zz in (0.4, 2.2, 3.8, 5.2):
        v, f = lib.box((x, y, zz * s), (w + 0.08 * s, w + 0.08 * s, 0.1 * s))
        P['stone'].add(v, f, TRIM)
    front = y - w / 2 - 0.01 * s
    # pointed windows with warm light (two tiers) and a rose window
    def arch_window(cx, z0, wd, ht, glow):
        pts = []
        for k in range(9):
            a = math.pi - k / 8 * math.pi
            pts.append((math.cos(a) * wd / 2, ht + math.sin(a) * wd * 0.7))
        poly = [(-wd / 2, 0.0)] + pts + [(wd / 2, 0.0)]
        verts = [(px_, py_, 0.0) for (px_, py_) in poly]
        faces = [tuple(range(len(verts)))[::-1], tuple(range(len(verts)))]
        P['glow'].add(facing(verts, (cx, front, z0)), faces[1:], col(glow))
        rim = [(px_, py_, -0.01) for (px_, py_) in poly] + [(poly[0][0], poly[0][1], -0.01)]
        v2, f2 = lib.tube(facing(rim, (cx, front, z0)), 0.03 * s, 5)
        P['stone'].add(v2, f2, TRIM)
    for dx in (-0.32, 0.32):
        arch_window(x + dx * s, 0.8 * s, 0.26 * s, 0.7 * s, '#ffc06a')
        arch_window(x + dx * s, 4.1 * s, 0.22 * s, 0.5 * s, '#ffcf7a')
    rose = []
    for k in range(24):
        a = k / 24 * math.tau
        rose.append((math.cos(a) * 0.34 * s, math.sin(a) * 0.34 * s))
    verts = [(px_, py_, 0.0) for (px_, py_) in rose]
    P['glow'].add(facing(verts, (x, front, 3.0 * s)), [tuple(range(24))], col('#ff9a5a'))
    for k in range(8):
        a = k / 8 * math.tau
        spoke = [(0.0, 0.0, -0.012), (math.cos(a) * 0.34 * s, math.sin(a) * 0.34 * s, -0.012)]
        v, f = lib.tube(facing(spoke, (x, front, 3.0 * s)), 0.018 * s, 4)
        P['stone'].add(v, f, TRIM)
    for k, cc in enumerate(['#ff5a5a', '#4de8ff', '#ffcf4a', '#b27bff'] * 2):
        a = (k + 0.5) / 8 * math.tau
        v, f = lib.blob((x + math.cos(a) * 0.2 * s, front - 0.02, 3.0 * s + math.sin(a) * 0.2 * s), 0.05 * s, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col(cc))
    ring = [(math.cos(k / 24 * math.tau) * 0.36 * s, math.sin(k / 24 * math.tau) * 0.36 * s, -0.012) for k in range(25)]
    v, f = lib.tube(facing(ring, (x, front, 3.0 * s)), 0.035 * s, 6)
    P['stone'].add(v, f, TRIM)
    # clock stage (a little wider) with the big clock face
    cw = w + 0.24 * s
    v, f = lib.box((x, y, 5.95 * s), (cw, cw, 1.5 * s))
    P['stone'].add(v, f, DARK)
    v, f = lib.box((x, y, 6.75 * s), (cw + 0.12 * s, cw + 0.12 * s, 0.12 * s))
    P['stone'].add(v, f, TRIM)
    cf = y - cw / 2 - 0.02 * s
    face = []
    for k in range(40):
        a = k / 40 * math.tau
        face.append((math.cos(a) * 0.56 * s, math.sin(a) * 0.56 * s, 0.0))
    P['softglow'].add(facing(face, (x, cf, 5.95 * s)), [tuple(range(40))], col('#fff1c8'))
    rim = [(math.cos(k / 40 * math.tau) * 0.6 * s, math.sin(k / 40 * math.tau) * 0.6 * s, -0.01) for k in range(41)]
    v, f = lib.tube(facing(rim, (x, cf, 5.95 * s)), 0.05 * s, 6)
    P['metal'].add(v, f, col('#d8a640'))
    for k in range(12):
        a = k / 12 * math.tau
        mark = [(math.cos(a) * 0.44 * s, math.sin(a) * 0.44 * s, -0.012), (math.cos(a) * 0.52 * s, math.sin(a) * 0.52 * s, -0.012)]
        v, f = lib.tube(facing(mark, (x, cf, 5.95 * s)), 0.02 * s, 4)
        P['metal'].add(v, f, col('#3a2e2a'))
    for (a, L, r) in ((math.radians(62), 0.42, 0.028), (math.radians(160), 0.3, 0.036)):
        hand = [(0.0, 0.0, -0.02), (math.cos(a) * L * s, math.sin(a) * L * s, -0.02)]
        v, f = lib.tube(facing(hand, (x, cf, 5.95 * s)), r * s, 5)
        P['metal'].add(v, f, col('#2a2226'))
    # gargoyles on the clock stage's front corners and on the belfry
    for dx in (-1, 1):
        cp.gargoyle(P, (x + dx * (cw / 2 + 0.02)) * PX, -(y - cw / 2 + 0.05) * PX * COSB, 6.82 * s, None, face=-dx, s=1.25 * s)
        cp.gargoyle(P, (x + dx * (w / 2 + 0.12)) * PX, -(y - w / 2 - 0.02) * PX * COSB, 5.2 * s, None, face=-dx, s=1.05 * s)
    # belfry: four piers round an open lantern
    bw = w - 0.1 * s
    for (dx, dy) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        v, f = lib.box((x + dx * bw / 2 * 0.86, y + dy * bw / 2 * 0.86, 7.3 * s), (0.2 * s, 0.2 * s, 1.0 * s))
        P['stone'].add(v, f, STONE)
        v, f = lib.prism((x + dx * bw / 2 * 0.86, y + dy * bw / 2 * 0.86, 7.8 * s), 0.1 * s, 0.7 * s, sides=4, tip=0.85)
        P['stone'].add(v, f, TRIM)
    v, f = lib.blob((x, y, 7.25 * s), 0.25 * s, rough=0.0, subdiv=2)
    P['glow'].add(v, f, col('#ffd48a'))  # the bell lit from inside
    v, f = lib.box((x, y, 7.85 * s), (bw, bw, 0.12 * s))
    P['stone'].add(v, f, TRIM)
    # slate spire and finial
    v, f = lib.lathe([(bw * 0.72, 0.0), (bw * 0.5, 0.6 * s), (0.02 * s, 2.3 * s)], 4, (x, y, 7.9 * s))
    v = lib.transform([(vx - x, vy - y, vz) for (vx, vy, vz) in v], (x, y, 0.0), rot=(0.0, 0.0, math.pi / 4))
    P['stone'].add(v, f, col('#3e3a4c'))
    v, f = lib.tube([(x, y, 10.1 * s), (x, y, 10.6 * s)], 0.03 * s, 6)
    P['metal'].add(v, f, col('#d8a640'))
    v, f = lib.blob((x, y, 10.62 * s), 0.07 * s, rough=0.0, subdiv=1)
    P['metal'].add(v, f, col('#f2c14e'))
    # the searchlight on a balcony at the clock stage, beaming up into the night
    sx_, sy_ = x + cw / 2 + 0.28 * s, y - 0.1 * s
    v, f = lib.box((sx_ - 0.1 * s, sy_, 5.3 * s), (0.5 * s, 0.6 * s, 0.08 * s))
    P['stone'].add(v, f, TRIM)
    for k in range(5):
        v, f = lib.cylinder((sx_ + 0.1 * s - 0.2 * s + 0.1 * k * s, sy_ - 0.3 * s, 5.34 * s), 0.015 * s, 0.015 * s, 0.22 * s, 5)
        P['metal'].add(v, f, col('#2e2c36'))
    lamp = lib.transform(lib.cylinder((0, 0, 0), 0.16 * s, 0.2 * s, 0.34 * s, 14)[0], (sx_, sy_, 5.55 * s), rot=(math.radians(-35), math.radians(28), 0))
    _, lf = lib.cylinder((0, 0, 0), 0.16 * s, 0.2 * s, 0.34 * s, 14)
    P['metal'].add(lamp, lf, col('#3a3642'))
    lens = lib.transform(lib.cylinder((0, 0, 0.34 * s), 0.18 * s, 0.18 * s, 0.02 * s, 14)[0], (sx_, sy_, 5.55 * s), rot=(math.radians(-35), math.radians(28), 0))
    P['neon'].add(lens, lf, col('#fff4c8'))
    obs = P.build()
    # a soft beam (a translucent emissive cone) rising up and to the right
    beam = cp.beam_object('clock_beam', Vector((sx_, sy_, 5.6 * s)), Vector((0.9, 0.25, 1.0)).normalized(), 3.4 * s, 0.14 * s, 0.75 * s, '#fff6d8')
    return obs + [beam]


def tech_spire(bx, by, s=1.0):
    """A gleaming glass tower with red-and-gold fins, light bands, a landing pad and a glowing core
    in its crown."""
    P = Parts('techspire')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.7 * s
    WHITE, RED, GOLD = col('#e8edf4'), col('#c8363c'), col('#f2c14e')
    # podium
    v, f = lib.box((x, y, 0.3 * s), (2.2 * s, 1.4 * s, 0.6 * s))
    P['paint'].add(v, f, WHITE)
    v, f = lib.box((x, y - 0.71 * s, 0.32 * s), (1.2 * s, 0.02, 0.36 * s))
    P['glow'].add(v, f, col('#bfe8ff'))  # lobby glass
    obs = []
    # the glass shaft: a tapering box with the tower facade material (lit window grid)
    H = 7.2 * s
    w0, w1 = 1.34 * s, 1.0 * s
    d0, d1 = 1.1 * s, 0.84 * s
    verts = [(x - w0 / 2, y - d0 / 2, 0.6 * s), (x + w0 / 2, y - d0 / 2, 0.6 * s), (x + w0 / 2, y + d0 / 2, 0.6 * s), (x - w0 / 2, y + d0 / 2, 0.6 * s),
             (x - w1 / 2, y - d1 / 2, H), (x + w1 / 2, y - d1 / 2, H), (x + w1 / 2, y + d1 / 2, H), (x - w1 / 2, y + d1 / 2, H)]
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]
    shaft = lib.mesh_object('techspire_shaft', verts, faces, smooth=False)
    shaft.data.materials.append(kit.facade_material('techshaft', 'glass', 0.0, zmin=0.9 * s, zmax=H - 0.25 * s))
    obs.append(shaft)
    # red-and-gold fins up the front corners, light bands every level
    for dx in (-1, 1):
        pts = [(x + dx * (w0 / 2 + 0.02), y - d0 / 2 - 0.02, 0.6 * s), (x + dx * (w1 / 2 + 0.02), y - d1 / 2 - 0.02, H + 0.3 * s)]
        v, f = lib.tube(pts, 0.07 * s, 6)
        P['paint'].add(v, f, RED)
        pts = [(x + dx * (w0 / 2 - 0.06), y - d0 / 2 - 0.05, 0.6 * s), (x + dx * (w1 / 2 - 0.06), y - d1 / 2 - 0.05, H)]
        v, f = lib.tube(pts, 0.03 * s, 5)
        P['metal'].add(v, f, GOLD)
    for k in range(1, 5):
        t = k / 5
        zz = 0.6 * s + (H - 0.6 * s) * t
        wz = w0 + (w1 - w0) * t
        dz = d0 + (d1 - d0) * t
        ring = [(x - wz / 2 - 0.01, y - dz / 2 - 0.01, zz), (x + wz / 2 + 0.01, y - dz / 2 - 0.01, zz), (x + wz / 2 + 0.01, y + dz / 2, zz)]
        v, f = lib.tube(ring, 0.025 * s, 5)
        P['neon'].add(v, f, col('#7fe8ff'))
    # crown: a collar, the glowing core in a gold ring, the landing pad and the mast
    v, f = lib.box((x, y, H + 0.12 * s), (w1 + 0.3 * s, d1 + 0.3 * s, 0.24 * s))
    P['paint'].add(v, f, WHITE)
    v, f = lib.cylinder((x, y, H + 0.24 * s), 0.34 * s, 0.26 * s, 0.9 * s, 16)
    P['glass'].add(v, f, col('#9fc4e6'))
    v, f = lib.blob((x, y - 0.12 * s, H + 0.72 * s), 0.4 * s, rough=0.0, subdiv=3)
    P['neon'].add(v, f, col('#b8f8ff'))
    torus = []
    for k in range(33):
        a = k / 32 * math.tau
        torus.append((math.cos(a) * 0.46 * s, math.sin(a) * 0.46 * s, 0.0))
    v, f = lib.tube(facing(torus, (x, y - 0.1 * s, H + 0.72 * s)), 0.05 * s, 8)
    P['metal'].add(v, f, GOLD)
    v, f = lib.lathe([(0.3 * s, 0.0), (0.12 * s, 0.3 * s), (0.02 * s, 1.0 * s)], 12, (x, y, H + 1.14 * s))
    P['paint'].add(v, f, WHITE)
    v, f = lib.blob((x, y, H + 2.18 * s), 0.05 * s, rough=0.0, subdiv=1)
    P['neon'].add(v, f, col('#ff3a3a'))
    # landing pad cantilevered to the right
    px_, pz_ = x + w1 / 2 + 0.42 * s, H - 0.9 * s
    v, f = lib.cylinder((px_, y - 0.1 * s, pz_ - 0.12 * s), 0.52 * s, 0.56 * s, 0.22 * s, 24)
    P['paint'].add(v, f, col('#5a6478'))
    v, f = lib.box((px_ - 0.42 * s, y - 0.1 * s, pz_ - 0.02 * s), (0.5 * s, 0.4 * s, 0.2 * s))
    P['paint'].add(v, f, WHITE)
    for dy in (-0.25, 0.1):
        v, f = lib.tube([(px_ - 0.1 * s, y + dy * s, pz_ - 0.12 * s), (x + w1 / 2 - 0.05 * s, y + dy * s, pz_ - 0.9 * s)], 0.035 * s, 6)
        P['paint'].add(v, f, WHITE)
    ring = [(px_ + math.cos(k / 24 * math.tau) * 0.44 * s, y - 0.1 * s + math.sin(k / 24 * math.tau) * 0.44 * s, pz_ + 0.105 * s) for k in range(25)]
    v, f = lib.tube(ring, 0.018 * s, 4)
    P['neon'].add(v, f, col('#ffcf4a'))
    for k in range(8):
        a = k / 8 * math.tau
        v, f = lib.blob((px_ + math.cos(a) * 0.5 * s, y - 0.1 * s + math.sin(a) * 0.5 * s, pz_ + 0.12 * s), 0.03 * s, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col('#ff5a5a' if k % 2 else '#fff4c8'))
    return P.build() + obs


def water_tower(bx, by, s=1.0):
    """The friendly neighbourhood water tower on a brick stair hut, strung with webs."""
    P = Parts('watertower')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.55 * s
    BRICK = col('#9a4a3c')
    v, f = lib.box((x - 0.3 * s, y + 0.1 * s, 0.4 * s), (1.0 * s, 0.8 * s, 0.8 * s))
    P['paint'].add(v, f, BRICK)
    v, f = lib.box((x - 0.3 * s, y + 0.1 * s, 0.82 * s), (1.08 * s, 0.88 * s, 0.06 * s))
    P['stone'].add(v, f, col('#cdbfb0'))
    v, f = lib.box((x - 0.45 * s, y - 0.31 * s, 0.3 * s), (0.26 * s, 0.02, 0.5 * s))
    P['paint'].add(v, f, col('#2f5fae'))  # a blue door
    # red-and-blue striped awning over it
    for k in range(4):
        q = [(x - 0.62 * s + k * 0.085 * s, y - 0.33 * s, 0.62 * s), (x - 0.535 * s + k * 0.085 * s, y - 0.33 * s, 0.62 * s),
             (x - 0.535 * s + k * 0.085 * s, y - 0.52 * s, 0.52 * s), (x - 0.62 * s + k * 0.085 * s, y - 0.52 * s, 0.52 * s)]
        P['paint'].add(q, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#d8343f' if k % 2 == 0 else '#2f5fae'))
    v, f = lib.box((x - 0.05 * s, y - 0.31 * s, 0.5 * s), (0.2 * s, 0.02, 0.18 * s))
    P['glow'].add(v, f, col('#ffd48a'))
    # steel legs and braces
    top = 2.0 * s
    legs = [(x + 0.1 * s + dx * 0.36 * s, y + 0.1 * s + dy * 0.36 * s) for (dx, dy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for (lx, ly) in legs:
        v, f = lib.tube([(lx, ly, 0.84 * s), (lx * 0.9 + (x + 0.1 * s) * 0.1, ly * 0.9 + (y + 0.1 * s) * 0.1, top)], 0.04 * s, 6)
        P['metal'].add(v, f, col('#3e3a44'))
    for k in range(4):
        a, bq = legs[k], legs[(k + 1) % 4]
        v, f = lib.tube([(a[0], a[1], 1.0 * s), (bq[0], bq[1], 1.8 * s)], 0.016 * s, 4)
        P['metal'].add(v, f, col('#3e3a44'))
        v, f = lib.tube([(bq[0], bq[1], 1.0 * s), (a[0], a[1], 1.8 * s)], 0.016 * s, 4)
        P['metal'].add(v, f, col('#3e3a44'))
    # the wooden tank with steel hoops and a conical cap
    tx, ty = x + 0.1 * s, y + 0.1 * s
    v, f = lib.lathe([(0.58 * s, 0.0), (0.58 * s, 1.0 * s), (0.62 * s, 1.04 * s), (0.2 * s, 1.36 * s), (0.02 * s, 1.44 * s)], 24, (tx, ty, top))
    P['wood'].add(v, f, col('#8a6444'))
    for zz in (0.12, 0.42, 0.72, 0.96):
        v, f = lib.lathe([(0.595 * s, 0.0), (0.595 * s, 0.035 * s)], 24, (tx, ty, top + zz * s), cap_bottom=False, cap_top=False)
        P['metal'].add(v, f, col('#3a3640'))
    for k in range(12):
        a = k / 12 * math.tau
        v, f = lib.box((tx + math.cos(a) * 0.585 * s, ty + math.sin(a) * 0.585 * s, top + 0.5 * s), (0.012, 0.012, 0.98 * s), rot_z=a)
        P['wood'].add(v, f, col('#6e4e34'))
    v, f = lib.tube([(tx, ty, top + 1.44 * s), (tx, ty, top + 1.64 * s)], 0.015 * s, 5)
    P['metal'].add(v, f, col('#3a3640'))
    v, f = lib.blob((tx, ty, top + 1.66 * s), 0.035 * s, rough=0.0, subdiv=1)
    P['neon'].add(v, f, col('#ff3a3a'))
    # webs: a radial web on the tank's face, strands to the roof and to the cap
    WEB = col('#f2f5ff')
    cx_, cz_ = tx, top + 0.55 * s
    front = ty - 0.6 * s
    spokes = 10
    for k in range(spokes):
        a = k / spokes * math.tau
        L = 0.5 * s if k % 2 else 0.46 * s
        v, f = lib.tube([(cx_, front, cz_), (cx_ + math.cos(a) * L, front + 0.02, cz_ + math.sin(a) * L)], 0.009 * s, 4)
        P['softglow'].add(v, f, WEB)
    for r in (0.12, 0.22, 0.32, 0.42):
        pts = []
        for k in range(spokes + 1):
            a = k / spokes * math.tau
            rr = r * s * (1.0 - 0.08 * (k % 2))
            pts.append((cx_ + math.cos(a) * rr, front + 0.015, cz_ + math.sin(a) * rr))
        v, f = lib.tube(pts, 0.007 * s, 4)
        P['softglow'].add(v, f, WEB)
    for (ax_, ay_, az_) in ((x - 1.2 * s, y - 0.9 * s, 0.0), (x + 1.1 * s, y - 0.8 * s, 0.0), (x - 0.9 * s, y + 0.6 * s, 0.84 * s), (x + 0.9 * s, y + 0.7 * s, 0.0)):
        pts = []
        for k in range(9):
            t = k / 8
            sag = math.sin(t * math.pi) * 0.12 * s
            pts.append((tx + (ax_ - tx) * t, ty + (ay_ - ty) * t, top + 1.0 * s + (az_ - top - 1.0 * s) * t - sag))
        v, f = lib.tube(pts, 0.009 * s, 4)
        P['softglow'].add(v, f, WEB)
    # potted plants and a little string of lights on the hut
    rnd = random.Random(5)
    cp.string_lights(P, (x - 0.8 * s) * PX, -(y - 0.3 * s) * PX * COSB, (x + 0.2 * s) * PX, -(y - 0.3 * s) * PX * COSB, rnd, h=0.8 * s, sag=0.12, posts=False, n=8)
    return P.build()


def billboard(bx, by, s=1.0):
    """Midtown Plaza's neon billboard: the district's name over a skyline outline and stars."""
    P = Parts('billboard')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.1 * s
    for dx in (-1.1, 0.0, 1.1):
        v, f = lib.box((x + dx * s, y + 0.08 * s, 0.6 * s), (0.08 * s, 0.08 * s, 1.2 * s))
        P['metal'].add(v, f, col('#3a3642'))
    wd, ht, z0 = 3.2 * s, 1.5 * s, 1.1 * s
    q = [(-wd / 2, 0.0, 0.0), (wd / 2, 0.0, 0.0), (wd / 2, ht, 0.0), (-wd / 2, ht, 0.0)]
    qb = [(px_, py_, 0.1 * s) for (px_, py_, _) in q]
    P['matte'].add(facing(q + qb, (x, y, z0)), [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], col('#1c1a2a'))
    frame = [(-wd / 2, 0.0, -0.01), (wd / 2, 0.0, -0.01), (wd / 2, ht, -0.01), (-wd / 2, ht, -0.01), (-wd / 2, 0.0, -0.01)]
    v, f = lib.tube(facing(frame, (x, y, z0)), 0.035 * s, 5)
    P['metal'].add(v, f, col('#8a8494'))
    loc = (x, y - 0.02 * s, z0)
    cp.neon_text(P, 'HERO HEIGHTS', (x, y - 0.03 * s, z0 + 1.1 * s), 0.36 * s, cp.NEON['gold'])
    # a skyline outline and stars
    sky = [(-1.4, 0.18), (-1.4, 0.5), (-1.1, 0.5), (-1.1, 0.75), (-0.8, 0.75), (-0.8, 0.45), (-0.5, 0.45), (-0.5, 0.85), (-0.35, 0.95), (-0.2, 0.85),
           (-0.2, 0.5), (0.1, 0.5), (0.1, 0.7), (0.4, 0.7), (0.4, 0.4), (0.7, 0.4), (0.7, 0.8), (1.0, 0.8), (1.0, 0.55), (1.4, 0.55), (1.4, 0.18)]
    cp.neon_shape(P, [(px_ * s, py_ * s) for (px_, py_) in sky], (loc[0], loc[1], loc[2]), cp.NEON['cyan'], r=0.022 * s, closed=False)
    for (sx_, sz_, r) in ((-1.2, 1.12, 0.12), (1.22, 1.08, 0.1)):
        cp.neon_shape(P, cp.star_pts(r * s, r * 0.45 * s), (x + sx_ * s, y - 0.03 * s, z0 + sz_ * s), cp.NEON['pink'], r=0.018 * s)
    # two little spotlights on the top edge
    for dx in (-0.9, 0.9):
        v, f = lib.cylinder((x + dx * s, y - 0.25 * s, z0 + ht + 0.05 * s), 0.06 * s, 0.08 * s, 0.12 * s, 10)
        P['metal'].add(v, f, col('#3a3642'))
    return P.build()


def bandstand(bx, by, s=1.0):
    """Ora's bandstand: a round stage, slim posts, a domed canopy with lights and a star on top."""
    P = Parts('bandstand')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.45 * s
    v, f = lib.lathe([(0.82 * s, 0.0), (0.82 * s, 0.18 * s), (0.78 * s, 0.2 * s), (0.0, 0.2 * s)], 32, (x, y, 0))
    P['wood'].add(v, f, col('#8a5a3a'))
    v, f = lib.lathe([(0.84 * s, 0.15 * s), (0.86 * s, 0.15 * s), (0.86 * s, 0.2 * s), (0.84 * s, 0.2 * s)], 32, (x, y, 0))
    P['metal'].add(v, f, col('#f2c14e'))
    for k in range(6):
        a = k / 6 * math.tau + math.pi / 6
        if math.sin(a) < -0.3:
            continue  # keep the front open
        px_, py_ = x + math.cos(a) * 0.72 * s, y + math.sin(a) * 0.72 * s
        v, f = lib.cylinder((px_, py_, 0.2 * s), 0.03 * s, 0.03 * s, 1.4 * s, 8)
        P['metal'].add(v, f, col('#e8e2d8'))
    v, f = lib.lathe([(0.9 * s, 0.0), (0.7 * s, 0.25 * s), (0.3 * s, 0.45 * s), (0.02 * s, 0.52 * s)], 24, (x, y, 1.6 * s))
    P['paint'].add(v, f, col('#2f7a8a'))
    for k in range(18):
        a = k / 18 * math.tau
        v, f = lib.blob((x + math.cos(a) * 0.9 * s, y + math.sin(a) * 0.9 * s, 1.58 * s), 0.035 * s, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col(['#fff1b8', '#ff9ad2', '#9fe8ff'][k % 3]))
    cp.neon_shape(P, cp.star_pts(0.16 * s, 0.07 * s), (x, y, 2.28 * s), cp.NEON['gold'], r=0.02 * s)
    kit.point_light(x, y - 0.1 * s, 1.4 * s, color='#ffd9a0', energy=60.0, radius=0.2)
    return P.build()


def lab_kiosk(bx, by, s=1.0):
    """Wrench's gadget lab kiosk beside the Tech Spire: a white pod with a glowing screen."""
    P = Parts('lab')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.3 * s
    v, f = lib.lathe([(0.55 * s, 0.0), (0.58 * s, 0.5 * s), (0.5 * s, 0.9 * s), (0.25 * s, 1.1 * s), (0.0, 1.15 * s)], 24, (x, y, 0))
    P['paint'].add(v, f, col('#e8edf4'))
    v, f = lib.box((x, y - 0.56 * s, 0.55 * s), (0.5 * s, 0.02, 0.32 * s))
    P['glow'].add(v, f, col('#7fe8ff'))
    v, f = lib.lathe([(0.59 * s, 0.0), (0.59 * s, 0.05 * s)], 24, (x, y, 0.72 * s), cap_bottom=False, cap_top=False)
    P['neon'].add(v, f, col('#7fe8ff'))
    cp.antenna(P, (x + 0.15 * s) * PX, -(y + 0.1 * s) * PX * COSB, random.Random(3), h=0.7 * s)
    for dx in (-0.22, 0.0, 0.22):
        v, f = lib.blob((x + dx * s, y - 0.58 * s, 0.3 * s), 0.035 * s, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col(['#ff5a5a', '#ffcf4a', '#8dff6a'][int(dx * 10) % 3]))
    return P.build()


def garden_tree(bx, by, s=1.0):
    P = Parts('gardentree')
    c = board_to_world(bx, by, 0.0)
    v, f = lib.box((c.x, c.y - 0.2, 0.18 * s), (1.0 * s, 0.7 * s, 0.36 * s))
    P['wood'].add(v, f, col('#7a5234'))
    rnd = random.Random(11)
    import terrain
    terrain.tree_round(P['leaf'], P['wood'], bx, by - 16, rnd, 1.25 * s, palette=('#1b5e34', '#63bf4e'), crown=True)
    return P.build()


def food_cart(bx, by, s=1.0):
    """Pipper's cart: a little wagon with a striped awning, a glowing counter and lights."""
    P = Parts('cart')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.25 * s
    v, f = lib.box((x, y, 0.42 * s), (0.9 * s, 0.5 * s, 0.5 * s))
    P['paint'].add(v, f, col('#8e5cd9'))
    v, f = lib.box((x, y - 0.26 * s, 0.5 * s), (0.7 * s, 0.02, 0.22 * s))
    P['glow'].add(v, f, col('#ffd48a'))
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
    cp.string_lights(P, (x - 0.5 * s) * PX, -(y - 0.45 * s) * PX * COSB, (x + 0.5 * s) * PX, -(y - 0.45 * s) * PX * COSB, random.Random(7), h=1.15 * s, sag=0.08, posts=False, n=6)
    cp.neon_shape(P, cp.star_pts(0.12 * s, 0.05 * s), (x, y - 0.1 * s, 1.5 * s), cp.NEON['gold'], r=0.018 * s)
    return P.build()


def sky_gate(bx, by, s=1.0):
    """The Sky Rail turnstile: a steel station arch with a glowing keyhole emblem."""
    P = Parts('gate')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y
    for dx in (-0.62, 0.62):
        v, f = lib.box((x + dx * s, y, 0.75 * s), (0.18 * s, 0.24 * s, 1.5 * s))
        P['paint'].add(v, f, col('#3d4a66'))
        v, f = lib.box((x + dx * s, y - 0.125 * s, 0.75 * s), (0.06 * s, 0.01, 1.3 * s))
        P['neon'].add(v, f, col('#7fe8ff'))
    v, f = lib.box((x, y, 1.58 * s), (1.6 * s, 0.26 * s, 0.26 * s))
    P['paint'].add(v, f, col('#2c3650'))
    ring = [(math.cos(k / 24 * math.tau) * 0.2 * s, math.sin(k / 24 * math.tau) * 0.2 * s) for k in range(24)]
    cp.neon_shape(P, ring, (x, y - 0.15 * s, 1.58 * s), cp.NEON['cyan'], r=0.025 * s)
    key = [(-0.05, -0.12), (0.05, -0.12), (0.03, 0.0), (0.07, 0.05), (0.0, 0.11), (-0.07, 0.05), (-0.03, 0.0)]
    cp.neon_shape(P, [(px_ * s, py_ * s) for (px_, py_) in key], (x, y - 0.15 * s, 1.58 * s), cp.NEON['gold'], r=0.016 * s)
    # turnstile arms
    for dx in (-0.3, 0.3):
        v, f = lib.cylinder((x + dx * s, y, 0.0), 0.06 * s, 0.06 * s, 0.5 * s, 10)
        P['metal'].add(v, f, col('#c9ced8'))
        for k in range(3):
            a = k / 3 * math.tau
            v, f = lib.tube([(x + dx * s, y, 0.42 * s), (x + dx * s + math.cos(a) * 0.22 * s, y + math.sin(a) * 0.22 * s, 0.4 * s)], 0.018 * s, 5)
            P['metal'].add(v, f, col('#c9ced8'))
    return P.build()


def subway_entrance(bx, by, s=1.0):
    """A subway entrance: railings round a stairwell, two globe lamps and a little arrow sign."""
    P = Parts('subway')
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - 0.1 * s
    GREEN = col('#2f6a4e')
    # the stairwell (dark steps going down, seen through the opening)
    for k in range(5):
        v, f = lib.box((x, y + 0.1 * s + k * 0.08 * s, -0.04 * s - k * 0.08 * s), (0.62 * s, 0.1 * s, 0.05 * s))
        P['stone'].add(v, f, col('#6d6874'))
    # railings on three sides
    for (a, b_) in (((-0.36, -0.1), (-0.36, 0.45)), ((0.36, -0.1), (0.36, 0.45)), ((-0.36, 0.45), (0.36, 0.45))):
        p0 = (x + a[0] * s, y + a[1] * s)
        p1 = (x + b_[0] * s, y + b_[1] * s)
        for zz in (0.18, 0.36):
            v, f = lib.tube([(p0[0], p0[1], zz * s), (p1[0], p1[1], zz * s)], 0.018 * s, 5)
            P['metal'].add(v, f, GREEN)
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        for k in range(int(L / (0.16 * s)) + 1):
            t = k / max(1, int(L / (0.16 * s)))
            v, f = lib.cylinder((p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, 0.0), 0.012 * s, 0.012 * s, 0.36 * s, 5)
            P['metal'].add(v, f, GREEN)
    for dx in (-0.36, 0.36):
        v, f = lib.cylinder((x + dx * s, y - 0.1 * s, 0.0), 0.03 * s, 0.025 * s, 0.9 * s, 8)
        P['metal'].add(v, f, GREEN)
        v, f = lib.blob((x + dx * s, y - 0.1 * s, 0.98 * s), 0.08 * s, rough=0.0, subdiv=2)
        P['neon'].add(v, f, col('#b8ffd8' if dx < 0 else '#fff1c8'))
    # a sign bar with a neon down-arrow
    v, f = lib.box((x, y + 0.45 * s, 0.62 * s), (0.7 * s, 0.05 * s, 0.2 * s))
    P['paint'].add(v, f, GREEN)
    arrow = [(y_ * 0.1 * s, -x_ * 0.1 * s) for (x_, y_) in [(-1.0, -0.22), (0.3, -0.22), (0.3, -0.55), (1.0, 0.0), (0.3, 0.55), (0.3, 0.22), (-1.0, 0.22)]]
    cp.neon_shape(P, arrow, (x, y + 0.42 * s, 0.62 * s), cp.NEON['white'], r=0.012 * s)
    return P.build()


# ------------------------------------------------------------------------------------------
def scatter_block(P: Parts, b: kit.CityBoard, ids, mask, dist, look, rnd):
    """Rooftop clutter for one block, kept off the walkway, the spaces and the landmarks."""
    ys, xs = mask.nonzero()
    if not len(xs):
        return
    area = len(xs) * GRID * GRID
    surface = look.get('surface', 'roof')

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
    if surface in ('roof', 'block', 'neonrow', 'plaza', 'gothic', 'tech'):
        many(lambda bx, by: cp.hvac(P, bx, by, rnd, 1.0 if surface != 'tech' else 0.9), 26000)
        many(lambda bx, by: cp.vent(P, bx, by, rnd), 16000)
    if surface in ('roof', 'block', 'gothic', 'neonrow'):
        many(lambda bx, by: cp.skylight(P, bx, by, rnd), 34000)
        many(lambda bx, by: cp.chimney(P, bx, by, rnd) if tall_ok(bx, by, 60) else None, 30000)
        many(lambda bx, by: cp.antenna(P, bx, by, rnd) if tall_ok(bx, by, 100) else None, 60000)
        many(lambda bx, by: cp.dish(P, bx, by, rnd), 50000)
    if surface == 'block':
        many(lambda bx, by: cp.water_tank(P, bx, by, rnd, 0.9) if tall_ok(bx, by, 80) else None, 45000)
        many(lambda bx, by: cp.crate_stack(P, bx, by, rnd), 30000)
        many(lambda bx, by: cp.planter(P, bx, by, rnd), 26000)
        for _ in range(3):
            pt = pick(min_edge=30, path_clear=0.0, node_r=110)
            if pt and tall_ok(pt[0], pt[1], 60):
                cp.laundry(P, pt[0] - 40, pt[1], pt[0] + 40, pt[1] - 10, rnd)
    if surface == 'garden':
        many(lambda bx, by: cp.planter(P, bx, by, rnd, 1.1), 9000, node_r=84)
        many(lambda bx, by: cp.bush_round(P, bx, by, rnd, 1.0), 9000, node_r=84)
        many(lambda bx, by: cp.tree_city(P, bx, by, rnd, 1.0, palette=('#1b5e34', '#63bf4e')) if tall_ok(bx, by, 120) else None, 22000)
        many(lambda bx, by: cp.greenhouse(P, bx, by, rnd) if tall_ok(bx, by, 60) else None, 60000)
        many(lambda bx, by: cp.bench(P, bx, by, rnd), 40000)
    if surface == 'plaza':
        many(lambda bx, by: cp.planter(P, bx, by, rnd, 1.0), 16000)
        many(lambda bx, by: cp.potted_tree(P, bx, by, rnd, 1.0) if tall_ok(bx, by, 90) else None, 22000)
        many(lambda bx, by: cp.bench(P, bx, by, rnd), 26000)
        many(lambda bx, by: cp.bollard(P, bx, by), 12000, min_edge=8, path_clear=0.3, node_r=70)
    if surface == 'gothic':
        many(lambda bx, by: cp.crate_stack(P, bx, by, rnd), 40000)
    if surface == 'tech':
        many(lambda bx, by: cp.solar_panel(P, bx, by, rnd), 9000)
        many(lambda bx, by: cp.pylon_lights(P, bx, by, rnd), 12000, min_edge=8, path_clear=0.3, node_r=70)
    if surface == 'neonrow':
        many(lambda bx, by: cp.vending(P, bx, by, rnd, glow=rnd.choice(['#9fe8ff', '#ffd48a', '#ff9ad2'])), 30000)
        many(lambda bx, by: cp.crate_stack(P, bx, by, rnd), 36000)


FACADE_WORDS = {
    'plaza': ['NEWS', 'HOTEL', 'OPEN 24', 'RADIO'],
    'gothic': ['BOOKS', 'CLOCKS', 'ANTIQUES'],
    'garden': ['FLOWERS', 'GREENS'],
    'tech': ['LABS', 'ROBOTS'],
    'block': ['PIZZA', 'DELI', 'LAUNDRY', 'COMICS'],
    'neonrow': ['ARCADE', 'NOODLES', 'KARAOKE', 'TOYS', 'DANCE'],
}



def gargoyle_rim(P: Parts, ring, nrm, rnd, every=5):
    """Little gargoyles perched along the camera-facing rim of the gothic blocks."""
    for k in range(0, len(ring), every):
        if nrm[k][1] < 0.6 or rnd.random() < 0.45:
            continue
        bx, by = ring[k] - nrm[k] * 10
        cp.gargoyle(P, bx, by, 0.14, rnd, face=rnd.choice([-1, 1]), s=0.8)


def build_landmarks(b):
    built = {}
    for lm in LANDMARKS:
        k, x, y, s = lm['kind'], lm['x'], lm['y'], lm.get('s', 1.0)
        lid = lm['id']
        if lid == 'clocktower':
            obs = clock_tower(x, y, s)
        elif lid == 'techspire':
            obs = tech_spire(x, y, s)
        elif lid == 'watertower':
            obs = water_tower(x, y, s)
        elif lid == 'billboard':
            obs = billboard(x, y, s)
        elif lid == 'bandstand':
            obs = bandstand(x, y, s)
        elif lid == 'lab':
            obs = lab_kiosk(x, y, s)
        elif lid == 'garden-tree':
            obs = garden_tree(x, y, s)
        elif lid == 'cart':
            obs = food_cart(x, y, s)
        elif lid == 'gate':
            obs = sky_gate(x, y, s)
        elif k == 'bunting':
            P = Parts(lid)
            half = lm['width'] / 2
            cp.string_lights(P, x - half, y, x + half, y, random.Random(len(lid)), h=1.35, sag=0.3)
            obs = P.build()
        elif lid.startswith('subway-'):
            obs = subway_entrance(x, y, s)
        elif k == 'lantern':
            P = Parts(lid)
            cp.street_lamp(P, x, y, random.Random(int(x)), style=lm.get('style', 'classic'), energy=70.0)
            obs = P.build()
        else:
            continue
        built[lid] = (lm, obs)
    # Star Coin cradles (Suncoil's pedestal) behind each relic gate
    sys.path.insert(0, kit.ART)
    import props as sprops
    sprops.use_board_look()
    for g in RELIC_GATES:
        n = b.nodes[g]
        lm = dict(id=f'pedestal-{g}', kind='pedestal', x=n['x'], y=n['y'] - 85, tex='relic-pedestal')
        built[lm['id']] = (lm, sprops.pedestal(lm['x'], lm['y'], 1.0))
    return built


def deck_style(na, nb):
    return DECK_STYLE.get(na.get('region'), DECK_STYLE.get(nb.get('region'), 'foot'))


def block_extras(P: Parts, b, ids, ring, nrm, look, rnd):
    cp.facade_signs(P, ring, nrm, FACADE_WORDS.get(look.get('surface'), ['OPEN']), rnd, count=2 if len(ids) > 2 else 1)
    if look.get('surface') == 'gothic':
        gargoyle_rim(P, ring, nrm, rnd)


def terrain_extras(P: Parts, b, masks, block_info, rnd):
    # skyline: taller buildings on the backs of the northern blocks (never over a trail)
    tower_mats = {st: kit.facade_material(f'tower_{st}', st, 0.0, zmin=0.35, zmax=5.0) for st in ('brick', 'stone', 'glass', 'deco')}
    for (tx, ty, w, d, hh, st) in ((1180, 640, 1.0, 0.7, 3.2, 'brick'), (1500, 610, 0.9, 0.7, 4.2, 'deco'), (2880, 720, 0.9, 0.7, 3.6, 'glass'),
                                   (3050, 760, 0.8, 0.6, 2.6, 'brick'), (520, 1150, 0.9, 0.7, 2.4, 'stone'), (3440, 1080, 0.7, 0.6, 2.2, 'brick')):
        if b.canopy_clear(tx, ty, w * PX / 2 + 10, hh * 61.6 + 60) and b.inside_any(masks, tx, ty):
            cp.backdrop_tower(P, tower_mats, tx, ty, rnd, w, d, hh, st)
        else:
            print('skip tower', tx, ty)
    # where the Star Coin waits: a pad behind each gate
    for g in RELIC_GATES:
        n = b.nodes[g]
        cp.star_pad(P, n['x'], n['y'] - 40, rnd)


def main():
    b = build_city()
    kit.city_main(A, b, OUT, SCALE, SAMPLES, deck_style=deck_style, scatter_block=scatter_block, block_extras=block_extras,
                  terrain_extras=terrain_extras, build_landmarks=build_landmarks)


import bpy  # noqa: E402

if __name__ == '__main__':
    main()
