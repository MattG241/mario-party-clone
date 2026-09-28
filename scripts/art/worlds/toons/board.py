"""Cartoon Coast board diorama: a floating slab of bright sea holding a sunny coast - the Boardwalk
and its beach, the Palm Dunes, rolling checkered hills with a giant loop-the-loop, Maple Street's
houses, garage and donut shop, the park, the Cliff Road, and Bubble Bay's sea-floor town (a
pineapple house and a tiki-stone hut half under the water) out in the bay.

    bpyenv/bin/python scripts/art/worlds/toons/board.py --plan | --dry | --preview
    bpyenv/bin/python scripts/art/worlds/toons/board.py --bands 4 --band 0   (one band of the final)
    bpyenv/bin/python scripts/art/worlds/toons/board.py --bands 4 --stitch --export
    bpyenv/bin/python scripts/art/worlds/toons/board.py --props-only

Run Blender steps through the shared lock (scratchpad/cool/with-blender-lock). Board data comes from
board.json (node scripts/art/worlds/sea_export.mjs toons).
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import sea_kit as K  # noqa: E402

import festival  # noqa: E402
import lib  # noqa: E402
import props  # noqa: E402
import terrain  # noqa: E402
from lib import board_to_world, col  # noqa: E402

import board_props as TP  # noqa: E402
import bpy  # noqa: E402


def args():
    p = argparse.ArgumentParser()
    p.add_argument('--preview', action='store_true')
    p.add_argument('--plan', action='store_true')
    p.add_argument('--dry', action='store_true')
    p.add_argument('--scale', type=float, default=None)
    p.add_argument('--samples', type=int, default=None)
    p.add_argument('--out', default=os.path.join(lib.ROOT, 'art-out', 'toons'))
    p.add_argument('--bands', type=int, default=1)
    p.add_argument('--band', type=int, default=-1)
    p.add_argument('--stitch', action='store_true')
    p.add_argument('--export', action='store_true')
    p.add_argument('--props-only', action='store_true')
    p.add_argument('--only', default='')
    p.add_argument('--crop', default='')
    return p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])


A = args()
SCALE = A.scale or (0.25 if A.preview else 1.0)
SAMPLES = A.samples or (8 if A.preview else 12)
B = K.Board(os.path.join(HERE, 'board.json'))
B.frame = (-120, -60, B.W + 240, B.H + 280)
N = B.nodes
OUT = A.out
os.makedirs(OUT, exist_ok=True)
lib.seeded(12)
MIMI = (2020, 1500)


def xy(i):
    return N[i]['x'], N[i]['y']


# ------------------------------------------------------------------------------------------
# Layout
LAND_NODES = [i for i in N if not i.startswith('y')]
BAY_NODES = ['y0', 'y1', 'y2', 'y3', 'y4', 'y5']
INTERIOR = [(1000, 1850), (880, 1300), (1000, 1000), (1500, 880), (2100, 700), (2800, 700), (2920, 1100), (2820, 1600), (2400, 1900), (1600, 2000)]
EXTRA_LAND = [
    (1700, 640, 150), (2000, 520, 150), (2300, 450, 150), (2620, 420, 170), (2850, 520, 140), (1880, 560, 130),
    (1000, 500, 180), (1250, 470, 170), (1480, 560, 150), (800, 700, 150), (650, 920, 140),
    (640, 1280, 160), (640, 1600, 150), (790, 1900, 130),
    (1200, 2090, 130), (1500, 2170, 150), (1850, 2180, 150), (2150, 2130, 140), (2350, 2110, 140), (2560, 1950, 120),
    (2960, 1250, 80), (2930, 1480, 80), (2750, 1720, 90),
]
ISLETS = [(3130, 960, 92), (3235, 1095, 130), (3275, 1260, 95), (3240, 1430, 95), (3130, 1565, 92), (2975, 1650, 92), (3440, 1070, 118)]
RAISE = [  # rolling hills (x, y, rx, ry, height)
    (1470, 1470, 300, 180, 1.35), (2260, 1300, 260, 170, 1.2), (1900, 1140, 190, 110, 0.95), (2520, 1580, 190, 110, 1.0),
    (1230, 1660, 190, 120, 1.0), (1060, 440, 230, 110, 1.4), (620, 1060, 110, 150, 1.0), (1700, 1750, 170, 90, 0.8),
]
CHECKER = [(1500, 1450, 420), (2250, 1350, 380), (1100, 520, 320), (1250, 1650, 240), (2500, 1600, 230), (1900, 1150, 250)]
ROCKY = [(2990, 1200, 260)]
LANDMARKS = [
    dict(id='loop', kind='loop', x=1170, y=1062, s=1.0, R=1.55, tex='', depth_y=1062),
    dict(id='pineapple-house', kind='pineapple', x=3440, y=1080, s=1.05, tex='workshop'),
    dict(id='tiki-hut', kind='tiki', x=3450, y=1445, s=1.25, tex=''),
    dict(id='family-house', kind='house', x=2640, y=400, s=0.95, tex='workshop'),
    dict(id='donut-shop', kind='donut', x=2430, y=455, s=1.0, tex='stall'),
    dict(id='garage', kind='garage', x=1880, y=560, s=1.0, tex=''),
    dict(id='house-west', kind='house', x=2090, y=470, s=0.8, wall='#bfe6ff', roof='#8a4a3a', door='#2e8a6a', tex=''),
    dict(id='house-east', kind='house', x=2870, y=560, s=0.75, wall='#ffc8d8', roof='#4e5362', door='#3f7fd9', tex=''),
    dict(id='ferris', kind='ferris', x=2330, y=2140, s=1.3, tex=''),
    dict(id='stall-a', kind='stall', x=1500, y=1945, s=1.3, stripe=('#2f7de1', '#fff4dc'), tex='stall'),
    dict(id='stall-b', kind='stall', x=1650, y=1935, s=1.25, stripe=('#ff6f91', '#fff4dc'), tex='stall'),
    dict(id='stage', kind='stage', x=1905, y=1950, s=1.15, tex='', depth_y=1900),
    dict(id='lantern-1', kind='lantern', x=1400, y=1965, s=1.6, tex='lantern'),
    dict(id='lantern-2', kind='lantern', x=2110, y=1950, s=1.6, tex='lantern'),
    dict(id='lantern-3', kind='lantern', x=2190, y=700, s=1.5, tex='lantern'),
    dict(id='lantern-4', kind='lantern', x=2690, y=700, s=1.5, tex='lantern'),
    dict(id='lantern-5', kind='lantern', x=2990, y=1300, s=1.5, tex='lantern'),
    dict(id='bunting-boardwalk', kind='bunting', x=1860, y=1980, s=1.4, width=200, tex='bunting'),
    dict(id='park-tree', kind='tree', x=2420, y=930, s=1.25, tex='tree-twist'),
]
PEDESTAL_ONLY = {'y1'}
for g in B.data['relicGates']:
    gx, gy = xy(g)
    LANDMARKS.append(dict(id=f'pedestal-{g}', kind='pedestal', x=gx, y=gy - (70 if g in PEDESTAL_ONLY else 85), s=1.0, tex='relic-pedestal'))


def keep_out(pad0=100.0, pad1=190.0):
    f = B.zeros()
    for (x, y) in B.path_pts:
        B.disc(f, x, y, pad0, soft=2)
    B.disc(f, MIMI[0], MIMI[1], 110, soft=2)
    d = np.asarray(K.ndimage.distance_transform_edt(f < 0.5) * K.GRID, np.float32)
    return np.clip(d / (pad1 - pad0), 0, 1)


def build_layout():
    land = B.zeros()
    for e in B.edges:
        if e['from'] in LAND_NODES and e['to'] in LAND_NODES:
            B.blob_chain(land, [e['from'], e['to']], 130, soft=14)
    B.polygon(land, INTERIOR, blur=40)
    for (x, y, r) in EXTRA_LAND:
        B.disc(land, x, y, r, soft=30)
    land = B.wobble(B.smooth(land, 10), amp=0.35, scale=150.0, seed=5.0)
    for (x, y, r) in ISLETS:
        isl = B.zeros()
        B.disc(isl, x, y, r, soft=18, sy=0.85)
        land = np.maximum(land, B.wobble(isl, amp=0.2, scale=60.0, seed=x * 0.01))
    mask = land > 0.5
    sd = B.sdf(mask)
    for i, n in N.items():
        d = B.at(sd, n['x'], n['y'])
        if d < 64:
            print('WARNING: space', i, 'only', round(d), 'px inside the shore')
    bank = B.zeros()
    for (x, y, r) in ROCKY:
        B.disc(bank, x, y, r, soft=80)
    ko = keep_out()
    raise_z = B.zeros()
    for (x, y, rx, ry, h) in RAISE:
        d = np.sqrt(((B.xx - x) / rx) ** 2 + ((B.yy - y) / ry) ** 2)
        m = K.smoothstep((1.0 - d) / 0.75) * h  # gentle, rolling slopes
        raise_z += m.astype(np.float32)
    raise_z *= ko
    raise_z *= np.clip(sd / 80.0, 0, 1)
    raise_z = B.smooth(raise_z, 8)
    return mask, sd, bank, raise_z


def build_zones(mask, sd, bank):
    sand = B.zeros()
    for i in ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'g4']:
        x, y = xy(i)
        B.disc(sand, x, y + 90, 150, soft=40)
    for i in ['w6', 'h0', 'h1', 'h2', 'h3']:
        x, y = xy(i)
        B.disc(sand, x - 90, y, 150, soft=50)
    for (x, y, r) in ISLETS:
        B.disc(sand, x, y, r + 20, soft=10)
    sand = np.maximum(sand, np.clip(1 - sd / 80.0, 0, 1) * (sd > -1) * (1 - np.clip(bank, 0, 1)))
    rockg = B.zeros()
    paving = B.zeros()
    street = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']
    for a, b in zip(street, street[1:]):
        (ax, ay), (bx, by) = xy(a), xy(b)
        B.capsule(paving, ax, ay, bx, by, 52, soft=6)
    for (x, y, r) in [(1905, 1950, 110)]:
        B.disc(paving, x, y, r, soft=20)
    trail = B.path_field(width=86, styles=('path',), node_r=76)
    lush = B.zeros()
    for (x, y, r) in [(2480, 900, 260), (2150, 850, 160)]:
        B.disc(lush, x, y, r, soft=100)
    checker = B.zeros()
    for (x, y, r) in CHECKER:
        B.disc(checker, x, y, r, soft=60)
    checker *= np.clip(1 - trail * 2, 0, 1)
    dist = K.ndimage.distance_transform_edt(~mask) * K.GRID
    # smooth the grid's stair steps out of the distance so the shore foam runs clean
    dist = K.ndimage.gaussian_filter(dist.astype(np.float32), 1.6)
    seamap = np.clip(dist / 420.0, 0, 1).astype(np.float32)
    shallows = B.zeros()
    for (x, y, r) in [(3250, 1250, 330), (1800, 2250, 300)]:
        B.disc(shallows, x, y, r, soft=140)
    foam = B.zeros()
    return sand, rockg, paving, trail, lush, checker, seamap, shallows, foam


def slab_mask():
    cx, cy, ax, ay, e = 1960, 1215, 1765, 1140, 2.7
    d = (np.abs((B.xx - cx) / ax) ** e + np.abs((B.yy - cy) / ay) ** e) ** (1 / e)
    f = np.clip((1 - d) * 60 + 0.5, 0, 1).astype(np.float32)
    return B.wobble(f, amp=0.25, scale=260.0, seed=9.0) > 0.5


def plan():
    mask, sd, bank, raise_z = build_layout()
    sand, rockg, paving, trail, lush, checker, seamap, shallows, foam = build_zones(mask, sd, bank)
    sl = slab_mask()
    img = np.zeros(mask.shape + (3,), np.float32)
    img[sl] = (0.15, 0.55, 0.8)
    img[sl & (seamap < 0.08)] = (0.4, 0.85, 0.85)
    img[mask] = (0.35, 0.72, 0.3)
    img[mask & (checker > 0.5)] = (0.45, 0.8, 0.35)
    img[mask & (sand > 0.5)] = (0.93, 0.85, 0.6)
    img[mask & (paving > 0.5)] = (0.8, 0.78, 0.74)
    img[mask & (trail > 0.5)] = (0.85, 0.7, 0.45)
    r = np.clip(raise_z / 1.5, 0, 1)
    img = img * (1 - r[..., None] * 0.5) + np.array([0.2, 0.45, 0.15]) * r[..., None] * 0.5
    im = Image.fromarray((img * 255).astype(np.uint8), 'RGB')
    d = ImageDraw.Draw(im)
    k = 1 / K.GRID
    for e in B.edges:
        a, b = N[e['from']], N[e['to']]
        d.line([a['x'] * k, a['y'] * k, b['x'] * k, b['y'] * k], fill=(255, 255, 255), width=1)
    for n in N.values():
        d.ellipse([n['x'] * k - 4, n['y'] * k - 3, n['x'] * k + 4, n['y'] * k + 3], fill=(255, 60, 60))
    for lm in LANDMARKS:
        d.rectangle([lm['x'] * k - 3, lm['y'] * k - 3, lm['x'] * k + 3, lm['y'] * k + 3], outline=(255, 255, 0))
    d.ellipse([MIMI[0] * k - 4, MIMI[1] * k - 4, MIMI[0] * k + 4, MIMI[1] * k + 4], outline=(255, 0, 255))
    # where the game stands its NPCs (BoardManager): they need ground under their feet
    spots = {'ora': (B.data['hostSpot']['x'], B.data['hostSpot']['y']), 'mimi': MIMI}
    for i, n in N.items():
        if n['type'] == 'market':
            spots[f'shop@{i} (pipper +78,-52)'] = (n['x'] + 78, n['y'] - 52)
            spots[f'shop@{i} (wrench -70,-58)'] = (n['x'] - 70, n['y'] - 58)
    for k, (x, y) in spots.items():
        print('NPC', k, (x, y), 'inside shore by', round(B.at(sd, x, y)), 'px')
    im.save(os.path.join(OUT, 'plan.png'))
    print('wrote', os.path.join(OUT, 'plan.png'))


# ------------------------------------------------------------------------------------------
# Materials: checkered lawns on the hills (two greens) and checkered soil on their banks
def checker_lawn(m, pos, grass, mask):
    X, Y, _ = m.sep(pos)
    sx = m.math('FLOOR', m.math('MULTIPLY', X, 1.6))
    sy = m.math('FLOOR', m.math('MULTIPLY', Y, 1.6 * 1.27))
    parity = m.math('MODULO', m.math('ABSOLUTE', m.math('ADD', sx, sy)), 2.0)
    light = m.mix(0.5, grass, lib.col('#b8ef6a'))
    dark = m.mult(grass, lib.col('#c8e0b0'))
    chk = m.mix(parity, dark, light)
    return m.mix(m.maprange(mask, 0.35, 0.65), grass, chk)


def build_scene():
    mask, sd, bank, raise_z = build_layout()
    sand, rockg, paving, trail, lush, checker, seamap, shallows, foam = build_zones(mask, sd, bank)
    zpath = K.save_map(os.path.join(OUT, 'zones.png'), [sand, rockg, paving], size=(B.W // 2, B.H // 2))
    epath = K.save_map(os.path.join(OUT, 'extra.png'), [trail, lush, checker], size=(B.W // 2, B.H // 2))
    spath = K.save_map(os.path.join(OUT, 'sea.png'), [seamap, shallows, foam], size=(B.W // 2, B.H // 2))
    K.setup_scene(SAMPLES, sky=0.9, sun_energy=3.8)
    pal = dict(
        grass=[(0.28, '#3a9a2a'), (0.42, '#4cb032'), (0.55, '#62c23a'), (0.68, '#84d248'), (0.82, '#aee05c')],
        lush=[(0.28, '#2a8030'), (0.42, '#36963a'), (0.55, '#48aa42'), (0.68, '#62bc4c'), (0.82, '#86cc5a')],
        sand=[(0.25, '#f2d9a0'), (0.5, '#f8e4b4'), (0.75, '#fdf0cc')],
        rock=[(0.25, '#b0703c'), (0.42, '#c8864a'), (0.58, '#dca062'), (0.72, '#b8784a'), (0.86, '#d09868')],
        trail=[(0.3, '#e8c890'), (0.5, '#f0d6a2'), (0.7, '#f7e2b8')],
        paving=[(0.0, '#d8d4cc'), (0.5, '#e8e4dc'), (1.0, '#cfc8bc')], mortar='#a8a298',
        fringe='#f6e8bc', flowers=1.2,
    )
    land_m = K.land_material(B, zpath, epath, pal, special=checker_lawn)
    sea_m = K.water_material(B, spath, pal={'ramp': [(0.0, '#9af8ea'), (0.05, '#5ce8da'), (0.18, '#36d0e0'), (0.45, '#26aee6'), (1.0, '#1c84d0')]})
    rock_m = K.rock_material(pal=[(0.25, '#8a5a3a'), (0.42, '#a8704a'), (0.58, '#c08a5c'), (0.72, '#9a7070'), (0.86, '#b8988e')])
    K.heightfield(B, K.land_heights(B, sd, bank, raise_z, beach_w=64.0), sd > -34, 'land', land_m)
    ob, ring, nrm = K.slab(B, slab_mask(), rock_m, sea_m)
    water = lib.MeshBuilder()
    picks = [k for k in range(len(ring)) if nrm[k][1] > 0.92 and 800 < ring[k][0] < 3200 and k % 3 == 0]
    rnd = random.Random(6)
    picks = sorted(rnd.sample(picks, min(3, len(picks))))
    K.rim_falls(B, ring, nrm, picks, water, rnd, width=0.72)
    water.build('falls', lib.falls_material('falls', K.WATER_Z + 0.04, K.WATER_Z - 3.6), smooth=True)
    mats = scatter_mats()
    scatter(mask, sd, raise_z, sand, paving, trail, checker, mats)
    over_water(mats)
    boardwalk(mats)
    shrines(mats)


def scatter_mats():
    return dict(
        grass=terrain.scatter_mat('grass', rough=0.8, sheen=0.15, ao=0.3),
        flower=terrain.scatter_mat('flower', rough=0.55, sheen=0.3),
        leaf=terrain.leaf_material('leaf', ao=0.5),
        palm=terrain.leaf_material('palm', ao=0.4, scale=14.0, sun='#eaf7a0', shade='#1f5a2a'),
        wood=terrain.scatter_mat('wood', rough=0.8, ao=0.3),
        rock=terrain.scatter_mat('rock', rough=0.85, ao=0.4),
        cloth=terrain.scatter_mat('cloth', rough=0.6, ao=0.25),
        fruit=terrain.scatter_mat('fruit', rough=0.45, sheen=0.2),
        paving=terrain.paving_material(),
        glass=glass_mat(),
    )


def glass_mat():
    m = lib.NT('bubble_glass')
    c = m.attr('col')
    b = m.bsdf(c, 0.05, emission=c, emission_strength=0.35, coat=1.0, transmission=0.4, alpha=0.75)
    return m.mat


def near_landmark(bx, by, pad=0.0):
    for lm in LANDMARKS:
        r = {'loop': 0, 'pineapple': 110, 'tiki': 100, 'house': 150, 'donut': 120, 'garage': 110, 'ferris': 150, 'stall': 80,
             'stage': 90, 'lantern': 34, 'bunting': 0, 'tree': 80, 'pedestal': 50}.get(lm['kind'], 60)
        if r and (bx - lm['x']) ** 2 + (by - lm['y']) ** 2 < (r + pad) ** 2:
            return True
    if abs(bx - 1170) < 200 and 980 < by < 1100:  # the loop's footprint
        return True
    if (bx - MIMI[0]) ** 2 + (by - MIMI[1]) ** 2 < 70 ** 2:
        return True
    return False


def scatter(mask, sd, raise_z, sand, paving, trail, checker, mats):
    rnd = random.Random(31)
    grass, flowers, leaves, palms, wood, rocks, cloth, fruit, shells = (lib.MeshBuilder() for _ in range(9))
    ys, xs = np.nonzero(mask)

    def pick(min_edge=10, max_edge=1e9, path_clear=0.05, node_r=80, tries=40):
        for _ in range(tries):
            j = rnd.randrange(len(xs))
            bx = xs[j] * K.GRID + rnd.uniform(0, K.GRID)
            by = ys[j] * K.GRID + rnd.uniform(0, K.GRID)
            d = B.at(sd, bx, by)
            if d < min_edge or d > max_edge or B.at(trail, bx, by) > path_clear:
                continue
            if node_r and B.near_node(bx, by, node_r):
                continue
            if near_landmark(bx, by):
                continue
            return bx, by
        return None

    def z_at(bx, by):
        return float(K.sample(raise_z, np.array([bx]), np.array([by]))[0])

    def lift(mb, n0, z):
        if z:
            mb.v[n0:] = [(vx, vy, vz + z) for (vx, vy, vz) in mb.v[n0:]]

    area = len(xs) * K.GRID * K.GRID
    # palms on the dunes and the beach, round trees in the suburb and the park; the checkered hills
    # stay open (a palm here and there)
    for _ in range(int(area / 26000)):
        pt = pick(min_edge=30, path_clear=0.0, node_r=115)
        if not pt:
            continue
        bx, by = pt
        z = z_at(bx, by)
        if B.at(paving, bx, by) > 0.3 or not B.canopy_clear(bx, by - z * 61.6, 110, 200):
            continue
        on_hills = B.at(checker, bx, by) > 0.3 or z > 0.25
        if on_hills and rnd.random() > 0.12:
            continue
        if B.at(sand, bx, by) > 0.4 or on_hills or rnd.random() < 0.3:
            K.palm(palms, wood, fruit, bx, by, rnd, rnd.uniform(0.85, 1.15), z0=z)
        else:
            n0l, n0w = len(leaves.v), len(wood.v)
            terrain.tree_round(leaves, wood, bx, by, rnd, rnd.uniform(0.8, 1.0), crown=True)
            lift(leaves, n0l, z)
            lift(wood, n0w, z)
    # sunflowers and flower clumps on the hills and lawns
    for _ in range(int(area / 24000)):
        pt = pick(min_edge=40, path_clear=0.02, node_r=85)
        if not pt or B.at(sand, *pt) > 0.4 or B.at(paving, *pt) > 0.3:
            continue
        z = z_at(*pt)
        n0f, n0l = len(flowers.v), len(leaves.v)
        if B.at(checker, *pt) > 0.5 and rnd.random() < 0.6:
            sunflower(flowers, leaves, *pt, rnd)
        else:
            flower_clump(flowers, leaves, *pt, rnd)
        lift(flowers, n0f, z)
        lift(leaves, n0l, z)
    for _ in range(int(area / (28 * 28))):
        j = rnd.randrange(len(xs))
        bx = xs[j] * K.GRID + rnd.uniform(0, K.GRID)
        by = ys[j] * K.GRID + rnd.uniform(0, K.GRID)
        if B.at(sd, bx, by) < 40 or B.at(trail, bx, by) > 0.3 or B.at(sand, bx, by) > 0.5 or B.at(paving, bx, by) > 0.4 or B.at(checker, bx, by) > 0.4:
            continue
        n0 = len(grass.v)
        terrain.grass_tuft(grass, bx, by, rnd, rnd.uniform(0.8, 1.3))
        lift(grass, n0, z_at(bx, by))
    for _ in range(int(area / 34000)):
        pt = pick(min_edge=30, path_clear=0.01, node_r=92)
        if pt and B.canopy_clear(pt[0], pt[1], 40, 60) and B.at(sand, *pt) < 0.4:
            n0 = len(leaves.v)
            terrain.bush(leaves, *pt, rnd, rnd.uniform(0.7, 1.1), berries=flowers)
            lift(leaves, n0, z_at(*pt))
    for _ in range(int(area / 40000)):
        pt = pick(min_edge=4, max_edge=80, path_clear=0.08, node_r=70)
        if pt:
            terrain.rock(rocks, *pt, rnd, rnd.uniform(0.9, 1.5), moss=False)
    for _ in range(int(area / 9000)):
        pt = pick(min_edge=14, max_edge=90, path_clear=0.05, node_r=66)
        if pt and B.at(sand, *pt) > 0.6:
            K.shell(shells, *pt, rnd, z=-0.12 * (1 - min(1, B.at(sd, *pt) / 64.0)))
    for (bx, by, stripe) in [(1400, 2180, ('#ff6f91', '#fff4dc')), (1620, 2195, ('#2f7de1', '#fff4dc')), (1980, 2195, ('#ffd23f', '#fff4dc')),
                             (1230, 2130, ('#8bd346', '#fff4dc')), (650, 1500, ('#ff6b5e', '#fff4dc'))]:
        if not B.near_node(bx, by, 80):
            K.parasol(cloth, wood, bx, by, rnd, stripe=stripe)
    # park: benches and flower beds; street: picket fences, trees
    Bf = {k: lib.MeshBuilder() for k in ('cloth', 'wood', 'paint', 'metal', 'glow', 'flowers', 'leaves', 'fruit', 'glass', 'rocks')}
    for (bx, by, yaw) in [(2330, 880, 0.2), (2660, 900, -0.2), (2150, 1920, 0.0)]:
        if not B.near_node(bx, by, 70):
            festival.bench(Bf, bx, by, yaw, rnd)
    festival.flower_beds(Bf, 2500, 960, 3, 1, rnd)
    festival.food_cart(Bf, 2560, 2020, ('#ff6f91', '#fff4dc'), rnd)
    fmat = dict(cloth=mats['cloth'], paint=mats['cloth'], wood=mats['wood'], metal=props.mats()['metal'], glow=props.mats()['glow'], flowers=mats['flower'])
    for k, mb in Bf.items():
        mb.build(f'fest_{k}', fmat.get(k, mats['leaf']))
    for mbn, mb, mat in [('grass', grass, mats['grass']), ('flowers', flowers, mats['flower']), ('leaves', leaves, mats['leaf']), ('palms', palms, mats['palm']),
                         ('wood', wood, mats['wood']), ('rocks', rocks, mats['rock']), ('cloth', cloth, mats['cloth']), ('fruit', fruit, mats['fruit']),
                         ('shells', shells, mats['flower'])]:
        mb.build(mbn, mat, smooth=mbn != 'grass')


def sunflower(flowers, leaves, bx, by, rnd):
    p = board_to_world(bx, by, 0.0)
    h = rnd.uniform(0.45, 0.7)
    v, f = lib.tube([(p.x, p.y, 0.0), (p.x, p.y, h)], 0.018, 6)
    leaves.add(v, f, col('#3f8f2c'))
    for sgn in (-1, 1):
        v, f = lib.blob((p.x + sgn * 0.06, p.y, h * 0.45), 0.05, squash=(1.5, 0.6, 0.4), rough=0.0, subdiv=1)
        leaves.add(v, f, col('#4aa83a'))
    for k in range(10):
        a = k / 10 * math.tau
        v, f = lib.blob((p.x + math.cos(a) * 0.075, p.y - 0.01, h + math.sin(a) * 0.075), 0.04, squash=(1.0, 0.4, 1.0), rough=0.0, subdiv=1)
        flowers.add(v, f, col('#ffd23f'))
    v, f = lib.blob((p.x, p.y - 0.02, h), 0.05, squash=(1.0, 0.5, 1.0), rough=0.0, subdiv=1)
    flowers.add(v, f, col('#8a4a1e'))


def flower_clump(flowers, leaves, bx, by, rnd):
    cols = [col(c) for c in rnd.sample(['#ff4f6a', '#ffb13b', '#ff7ac8', '#fff4dc', '#ffd23f', '#8fd3ff'], 2)]
    for _ in range(rnd.randint(6, 12)):
        fx, fy = bx + rnd.gauss(0, 16), by + rnd.gauss(0, 11)
        p = board_to_world(fx, fy, 0.0)
        terrain.flower(flowers, p.x, p.y, rnd.uniform(0.06, 0.14), rnd.choice(cols), rnd.uniform(0.04, 0.06))
        if rnd.random() < 0.7:
            v, f = lib.blob((p.x + rnd.uniform(-0.04, 0.04), p.y, 0.03), 0.055, squash=(1.4, 1, 0.3), rough=0.1, subdiv=1)
            leaves.add(v, f, col(rnd.choice(['#3f9b33', '#4aa83a', '#2f8a2c'])))


def over_water(mats):
    """Stepping stones across Bubble Bay, coral, jellyfish and drifting bubbles."""
    rnd = random.Random(41)
    rocks, tops, coral, glass, frill = (lib.MeshBuilder() for _ in range(5))
    for e in B.edges:
        a, b = e['from'], e['to']
        if e['style'] != 'steps':
            continue
        (ax, ay), (bx, by) = xy(a), xy(b)
        L = math.hypot(bx - ax, by - ay)
        n = max(1, int(L / 62))
        for k in range(n):
            t = (k + 0.5) / n
            sx, sy = ax + (bx - ax) * t, ay + (by - ay) * t
            if any(math.hypot(sx - N[i]['x'], sy - N[i]['y']) < 88 for i in (a, b)):
                continue
            K.reef_stone(rocks, tops, sx, sy, rnd, r=0.2, top='#f6dfae')
    for _ in range(26):
        bx, by = rnd.uniform(3050, 3560), rnd.uniform(850, 1800)
        if B.near_node(bx, by, 80) or any(math.hypot(bx - x, by - y) < r + 10 for (x, y, r) in ISLETS):
            continue
        TP.coral(coral, bx, by, rnd, rnd.uniform(0.8, 1.3))
    for (bx, by) in [(3380, 1260), (3420, 1330), (3160, 1340), (3350, 1180), (3100, 1250)]:
        TP.jellyfish(glass, frill, bx, by, rnd, rnd.uniform(0.9, 1.2))
    for _ in range(18):
        bx, by = rnd.uniform(3100, 3550), rnd.uniform(900, 1750)
        p = board_to_world(bx, by, K.WATER_Z)
        v, f = lib.blob((p.x, p.y, K.WATER_Z + rnd.uniform(0.05, 0.9)), rnd.uniform(0.03, 0.07), rough=0.0, subdiv=2)
        glass.add(v, f, col('#d8f6ff'))
    rocks.build('bay_rocks', mats['rock'])
    tops.build('bay_tops', mats['paving'], smooth=False)
    coral.build('coral', mats['flower'])
    glass.build('bubbles', mats['glass'])
    frill.build('jelly_frills', mats['flower'])


def boardwalk(mats):
    """A plank boardwalk along the beach trail, with rails on the sea side."""
    rnd = random.Random(51)
    wood = lib.MeshBuilder()
    run = ['g4', 'w0', 'w1', 'w2', 'w3', 'w4']
    for a, b in zip(run, run[1:]):
        K.jetty(wood, xy(a), xy(b), rnd, width=1.15, z=0.03, rails=False, posts_to=-0.1)
    for a, b in zip(run, run[1:]):
        (ax, ay), (bx, by) = xy(a), xy(b)
        pa, pb = board_to_world(ax, ay + 58, 0.0), board_to_world(bx, by + 58, 0.0)
        for t in np.linspace(0, 1, 5)[:-1]:
            q = pa + (pb - pa) * t
            v, f = lib.cylinder((q.x, q.y, 0.0), 0.025, 0.025, 0.3, 6)
            wood.add(v, f, col('#fbf8f0'))
        v, f = lib.tube([(pa.x, pa.y, 0.28), (pb.x, pb.y, 0.28)], 0.02, 6)
        wood.add(v, f, col('#fbf8f0'))
    wood.build('boardwalk', mats['wood'])


def shrines(mats):
    rnd = random.Random(99)
    paving, gold, glass, crystals = (lib.MeshBuilder() for _ in range(4))
    for g in B.data['relicGates']:
        if g in PEDESTAL_ONLY:
            continue
        x, y = xy(g)
        terrain.shrine_platform(paving, gold, glass, crystals, x, y - 40, rnd)
    paving.build('shrine_paving', mats['paving'], smooth=False)
    gold.build('shrine_gold', props.mats()['metal'])
    glass.build('shrine_glow', props.mats()['crystal'], smooth=False)
    crystals.build('shrine_crystals', props.mats()['crystal'], smooth=False)


def build_landmarks():
    built = {}
    for lm in LANDMARKS:
        k = lm['kind']
        s = lm.get('s', 1.0)
        if k == 'loop':
            obs = TP.loop_the_loop(lm['x'], lm['y'], lm['R'], s)
        elif k == 'pineapple':
            obs = TP.pineapple_house(lm['x'], lm['y'], s)
        elif k == 'tiki':
            obs = TP.tiki_hut(lm['x'], lm['y'], s)
        elif k == 'house':
            obs = TP.family_house(lm['x'], lm['y'], s, wall=lm.get('wall', '#ffe08a'), roof=lm.get('roof', '#5a5f6e'), door=lm.get('door', '#d9483b'))
        elif k == 'donut':
            obs = TP.donut_shop(lm['x'], lm['y'], s)
        elif k == 'garage':
            obs = TP.garage(lm['x'], lm['y'], s)
        elif k == 'ferris':
            Bf = {kk: lib.MeshBuilder() for kk in ('cloth', 'wood', 'paint', 'metal', 'glow', 'flowers', 'leaves', 'fruit', 'glass', 'rocks')}
            festival.ferris_wheel(Bf, lm['x'], lm['y'], s, random.Random(3))
            P = props.Prop('ferris')
            for kk, mb in Bf.items():
                dst = {'cloth': 'paint', 'paint': 'paint', 'wood': 'wood', 'metal': 'metal', 'glow': 'glow'}.get(kk, 'paint')
                base = len(P.b[dst].v)
                P.b[dst].v.extend(mb.v)
                P.b[dst].f.extend([tuple(i + base for i in fc) for fc in mb.f])
                P.b[dst].c.extend(mb.c)
            obs = P.build()
        elif k == 'stall':
            obs = props.stall(lm['x'], lm['y'], s, stripe=lm['stripe'], crate=True)
        elif k == 'stage':
            obs = props.stage(lm['x'], lm['y'], s)
        elif k == 'lantern':
            obs = props.lantern(lm['x'], lm['y'], s)
        elif k == 'bunting':
            obs = props.bunting(lm['x'], lm['y'], lm.get('width', 240), s)
        elif k == 'tree':
            P = props.Prop('park_tree')
            terrain.tree_round(P.b['leaf'], P.b['wood'], lm['x'], lm['y'], random.Random(5), s, crown=True)
            obs = P.build()
        else:
            obs = props.pedestal(lm['x'], lm['y'], s)
        built[lm['id']] = (lm, obs)
    for _, obs in built.values():
        for o in obs:
            lib.shadow_only(o)
    return built


def main():
    if A.plan:
        plan()
        return
    if A.stitch:
        K.stitch_bands(B.frame, SCALE, A.bands, os.path.join(OUT, 'terrain.png'))
        K.crisp(os.path.join(OUT, 'terrain.png'))
        if A.export:
            export_terrain()
        return
    build_scene()
    terrain_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    built = build_landmarks()
    lib.camera_for_region(*B.frame, scale=SCALE)
    if A.dry:
        me = sum(len(o.data.vertices) for o in bpy.context.scene.objects if o.type == 'MESH')
        print('dry run ok:', len(bpy.context.scene.objects), 'objects', me, 'vertices', len(built), 'landmarks')
        return
    if A.crop:
        x0, y0, x1, y1 = [float(v) for v in A.crop.split(',')]
        lib.set_border((x0, y0, x1, y1), B.frame)
        lib.render_to(os.path.join(OUT, 'crop.png'))
        K.crisp(os.path.join(OUT, 'crop.png'))
        return
    if A.props_only:
        K.render_props(B, built, terrain_objs, B.frame, SCALE, OUT, only={t for t in A.only.split(',') if t})
        return
    if A.band >= 0:
        K.render_bands(B.frame, SCALE, A.bands, os.path.join(OUT, 'terrain.png'), only=A.band)
        return
    path = os.path.join(OUT, 'preview.png' if A.preview else 'terrain.png')
    if A.bands > 1:
        K.render_bands(B.frame, SCALE, A.bands, path)
    else:
        lib.render_to(path)
    K.crisp(path)
    if A.preview:
        for o in terrain_objs:
            o.hide_render = True
        for _, obs in built.values():
            for o in obs:
                o.visible_camera = True
        lib.render_to(os.path.join(OUT, 'preview_props.png'))
        base = Image.open(path).convert('RGBA')
        base.alpha_composite(Image.open(os.path.join(OUT, 'preview_props.png')).convert('RGBA'))
        base.save(os.path.join(OUT, 'preview_full.png'))
        print('wrote preview_full.png')
    if A.export:
        export_terrain()
        K.render_props(B, built, terrain_objs, B.frame, SCALE, OUT)


def export_terrain():
    K.export_tiles(os.path.join(OUT, 'terrain.png'), B.id, B.frame[:2], SCALE)
    K.island_shadow(os.path.join(OUT, 'terrain.png'), B.id)


main()
