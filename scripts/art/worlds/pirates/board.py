"""Pirate Cove board diorama: a floating slab of tropical sea holding the harbour and palm beach, the
tangerine terrace, the treasure-cave crags, the waterfall lagoon, the dojo isle and the lighthouse
point round a turquoise cove where a galleon lies moored.

    bpyenv/bin/python scripts/art/worlds/pirates/board.py --plan              (layout maps only)
    bpyenv/bin/python scripts/art/worlds/pirates/board.py --preview           (quarter-scale test)
    bpyenv/bin/python scripts/art/worlds/pirates/board.py --bands 4 --band 0  (one band of the final)
    bpyenv/bin/python scripts/art/worlds/pirates/board.py --bands 4 --stitch --export
    bpyenv/bin/python scripts/art/worlds/pirates/board.py --props-only

Run Blender steps through the shared lock (scratchpad/cool/with-blender-lock). Board data comes from
board.json (node scripts/art/worlds/sea_export.mjs pirates).
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import sea_kit as K  # noqa: E402

import festival  # noqa: E402
import lib  # noqa: E402
import props  # noqa: E402
import terrain  # noqa: E402
from lib import board_to_world, col  # noqa: E402

import board_props as BP  # noqa: E402
import bpy  # noqa: E402


def args():
    p = argparse.ArgumentParser()
    p.add_argument('--preview', action='store_true')
    p.add_argument('--plan', action='store_true', help='write the layout maps (plan.png) and exit')
    p.add_argument('--scale', type=float, default=None)
    p.add_argument('--samples', type=int, default=None)
    p.add_argument('--out', default=os.path.join(lib.ROOT, 'art-out', 'pirates'))
    p.add_argument('--bands', type=int, default=1)
    p.add_argument('--band', type=int, default=-1)
    p.add_argument('--stitch', action='store_true', help='stitch rendered bands (no render)')
    p.add_argument('--export', action='store_true', help='slice the terrain into tiles, render props, shadow, manifest')
    p.add_argument('--props-only', action='store_true')
    p.add_argument('--only', default='', help='with --props-only: comma-separated prop ids')
    p.add_argument('--crop', default='', help='x0,y0,x1,y1 board px region to render (test)')
    p.add_argument('--dry', action='store_true', help='build the scene and landmarks, then stop (no render)')
    return p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])


A = args()
SCALE = A.scale or (0.25 if A.preview else 1.0)
SAMPLES = A.samples or (8 if A.preview else 12)
B = K.Board(os.path.join(HERE, 'board.json'))
B.frame = (-120, -60, B.W + 240, B.H + 280)
N = B.nodes
OUT = A.out
os.makedirs(OUT, exist_ok=True)
lib.seeded(11)


def xy(i):
    return N[i]['x'], N[i]['y']


# ------------------------------------------------------------------------------------------
# Layout: where the land is
ISLAND_RUNS = [
    ['m1', 'm2', 'm3', 'm4', 'm5', 's0', 's1', 's2', 'b0', 'b1', 'b2', 'b3', 'b4', 'b5', 't0', 't1', 't2', 't3', 't4'],
    ['t5', 'k0', 'k1', 'k2', 'k3'],
    ['l0', 'l1', 'l2', 'l3', 'l4'],
    ['z0', 'z1', 'z2', 'z3', 'z4', 'e0', 'o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'm0'],
    ['c2', 'c3'],
]
# extra land (x, y, r): the harbour quay, the beach, the terrace, the crags, the lagoon cliff, the dojo
# hill and the lighthouse point
EXTRA_LAND = [
    (2150, 1935, 150), (1960, 1960, 120), (2330, 1880, 120), (2600, 1760, 110), (2720, 1660, 95),
    (1560, 2180, 110), (1360, 2160, 120), (1180, 2120, 120), (1010, 2050, 110), (860, 1960, 100),
    (560, 1500, 140), (540, 1330, 140), (580, 1170, 130), (620, 1030, 110), (650, 1700, 100),
    (700, 420, 165), (880, 360, 150), (1060, 320, 140), (700, 600, 110),
    (1500, 340, 150), (1680, 305, 175), (1880, 340, 150), (1650, 420, 120), (2050, 400, 110),
    (2330, 360, 140), (2520, 360, 150), (2700, 470, 120), (2810, 720, 90),
    (3330, 1240, 175), (3420, 1330, 140), (3300, 1420, 120), (3180, 870, 100), (3060, 1560, 90),
    (2020, 1495, 70), (2080, 1455, 70),
]
# little rocky islets in the cove, each with a palm or two (no spaces on them)
ISLETS = [(1480, 850, 70), (2260, 830, 62), (1290, 1640, 58), (2420, 1560, 50), (1880, 1060, 46)]
EXTRA_LAND += ISLETS
# water cut through the land (a, b, width px): channels the footbridges and stones cross
CHANNELS = [('t4', 't5', 54), ('k3', 'l0', 70), ('l4', 'z0', 50), ('m0', 'm1', 56)]
# the lagoon pool at the foot of the falls (centre, radii px)
POOL = (1650, 405, 92, 46)
FALLS_LIP = (1650, 300)  # board px of the cliff lip where the falls tip over
RAISE = [  # mesas (x, y, rx, ry, height in world units): cliffs and hills, never near a trail
    (700, 370, 190, 140, 1.7), (980, 270, 230, 110, 2.1), (1650, 225, 300, 115, 2.5),
    (1330, 330, 120, 80, 1.3), (1960, 290, 150, 90, 1.5), (2580, 300, 190, 90, 1.1), (3380, 1100, 120, 70, 0.9),
]
ROCKY = [(840, 460, 330), (1650, 260, 330), (3420, 1250, 200), (2700, 380, 180)] + [(x, y, r + 40) for (x, y, r) in ISLETS]  # rocky coasts

# Landmark sprites (tex = placeholder decoration each one replaces in game)
GALLEON = BP.Galleon(1170, 1880, 1285)
LANDMARKS = [
    dict(id='galleon-rig', kind='rig', x=1520, y=1285, tex='', depth_y=1250),
    dict(id='lighthouse', kind='lighthouse', x=3372, y=1300, s=1.0, tex='observatory', manifest_kind='lantern'),
    dict(id='dojo', kind='dojo', x=2460, y=372, s=1.1, tex='workshop'),
    dict(id='map-room', kind='map_room', x=500, y=1420, s=0.95, tex='stall'),
    dict(id='cave', kind='cave', x=950, y=352, s=1.0, tex=''),
    dict(id='stall-fish', kind='stall', x=2665, y=1640, s=1.35, stripe=('#1fa5a0', '#fff4dc'), tex='stall'),
    dict(id='stall-fruit', kind='stall', x=2525, y=1725, s=1.25, stripe=('#ff6b5e', '#fff4dc'), tex='stall'),
    dict(id='house-a', kind='house', x=1790, y=1945, s=1.1, wall='#ffd8a8', roof='#d9583b', tex=''),
    dict(id='house-b', kind='house', x=2300, y=1850, s=1.05, wall='#bfe6ff', roof='#3f7fd9', tex='', flip=True),
    dict(id='house-c', kind='house', x=2440, y=1790, s=0.95, wall='#fff0b8', roof='#2e8a6a', tex=''),
    dict(id='crane', kind='crane', x=2100, y=1868, s=1.0, tex=''),
    dict(id='stage', kind='stage', x=1975, y=1935, s=1.15, tex='', depth_y=1880),
    dict(id='lantern-1', kind='lantern', x=1810, y=2040, s=1.6, tex='lantern'),
    dict(id='lantern-2', kind='lantern', x=2290, y=1960, s=1.6, tex='lantern'),
    dict(id='lantern-3', kind='lantern', x=700, y=560, s=1.5, tex='lantern'),
    dict(id='lantern-4', kind='lantern', x=1790, y=452, s=1.5, tex='lantern'),
    dict(id='lantern-5', kind='lantern', x=2560, y=1795, s=1.6, tex='lantern'),
    dict(id='lantern-6', kind='lantern', x=3000, y=1470, s=1.5, tex='lantern'),
    dict(id='bunting-harbour', kind='bunting', x=2060, y=1985, s=1.4, width=210, tex='bunting'),
    dict(id='tangerine-tree', kind='tangerine', x=560, y=1215, s=1.35, tex='tree-twist'),
]
SHRINE_SKIP = {'d1'}  # the galleon's gate has a pedestal but no mosaic on the deck
for g in B.data['relicGates']:
    gx, gy = xy(g)
    if g == 'd1':
        LANDMARKS.append(dict(id=f'pedestal-{g}', kind='pedestal', x=gx, y=gy - 60, s=1.0, tex='relic-pedestal', z=BP.DECK_Z))
    else:
        LANDMARKS.append(dict(id=f'pedestal-{g}', kind='pedestal', x=gx, y=gy - 85, s=1.0, tex='relic-pedestal'))

EDGE_ART = {
    't5>r0': 'bridge', 'r0>r1': 'bridge', 'r1>r2': 'bridge', 'r2>l0': 'bridge',
    't4>t5': 'footbridge', 'l4>z0': 'footbridge', 'm0>m1': 'footbridge',
    'k3>l0': 'stones',
    't3>c0': 'jetty', 'c0>c1': 'jetty',
    'c1>d0': 'gangplank', 'd3>c2': 'gangplank',
    'd0>d1': 'deck', 'd1>d2': 'deck', 'd2>d3': 'deck',
    'c3>c4': 'reef', 'c4>c5': 'reef', 'c5>f0': 'reef', 'e0>f0': 'reef', 'f0>f1': 'reef', 'f1>f2': 'reef', 'f2>m0': 'reef',
}
REEF_NODES = ['c4', 'c5', 'f0', 'f1', 'f2']
JETTY_NODES = ['c0', 'c1']
DECK_NODES = ['d0', 'd1', 'd2', 'd3']


def edge_art(a, b):
    return EDGE_ART.get(f'{a}>{b}', 'path')


def keep_out(pad0=95.0, pad1=175.0):
    """0 near any space or trail, 1 far from them (so raised terrain never lifts a trail)."""
    f = B.zeros()
    for (x, y) in B.path_pts:
        B.disc(f, x, y, pad0, soft=2)
    d = np.asarray(K.ndimage.distance_transform_edt(f < 0.5) * K.GRID, np.float32)
    return np.clip((d - 0.0) / (pad1 - pad0), 0, 1)


def build_layout():
    land = B.zeros()
    for run in ISLAND_RUNS:
        B.blob_chain(land, run, 128, soft=14)
    for (x, y, r) in EXTRA_LAND:
        B.disc(land, x, y, r, soft=30)
    land = B.wobble(B.smooth(land, 10), amp=0.35, scale=140.0, seed=3.0)
    for (a, b, w) in CHANNELS:
        (ax, ay), (bx, by) = xy(a), xy(b)
        mx, my = (ax + bx) / 2, (ay + by) / 2
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        nx, ny = -dy / L, dx / L
        cut = B.zeros()
        B.capsule(cut, mx - nx * 260, my - ny * 260, mx + nx * 260, my + ny * 260, w / 2, soft=6)
        land = np.minimum(land, 1 - cut)
    px, py, prx, pry = POOL
    pool = B.zeros()
    B.disc(pool, px, py, prx, soft=8, sy=pry / prx)
    mask = land > 0.5
    # every space must stand on ground (or on its jetty, reef stone or deck)
    water_nodes = set(REEF_NODES + JETTY_NODES + DECK_NODES + ['r0', 'r1', 'r2'])
    sd = B.sdf(mask)
    for i, n in N.items():
        if i in water_nodes:
            continue
        d = B.at(sd, n['x'], n['y'])
        if d < 64:
            print('WARNING: space', i, 'only', round(d), 'px inside the shore')
    # rocky banks: channels and rocky coasts
    bank = B.zeros()
    for (a, b, w) in CHANNELS:
        (ax, ay), (bx, by) = xy(a), xy(b)
        B.capsule(bank, ax, ay, bx, by, 150, soft=40)
    for (x, y, r) in ROCKY:
        B.disc(bank, x, y, r, soft=60)
    # raised terrain (mesas), away from every trail
    ko = keep_out()
    raise_z = B.zeros()
    for (x, y, rx, ry, h) in RAISE:
        d = np.sqrt(((B.xx - x) / rx) ** 2 + ((B.yy - y) / ry) ** 2)
        m = K.smoothstep((1.0 - d) / 0.4) * h
        np.maximum(raise_z, m.astype(np.float32), out=raise_z)
    raise_z *= ko
    raise_z *= np.clip(sd / 60.0, 0, 1)  # never up to the shoreline
    raise_z = B.smooth(raise_z, 6)
    # the pool: carve the ground down under the pool water
    raise_z -= pool * 0.42
    return mask, sd, bank, raise_z, pool, ko


def build_zones(mask, sd, pool, bank):
    sand = B.zeros()
    # Palm Beach: all of the south shore's sand, the sandbar, and beaches round the cove
    for i in ['b0', 'b1', 'b2', 'b3', 'b4', 's2']:
        x, y = xy(i)
        B.disc(sand, x, y + 70, 150, soft=40)
    B.disc(sand, 2020, 1440, 190, soft=30)
    sand = np.maximum(sand, np.clip(1 - sd / 90.0, 0, 1) * (sd > -1) * (1 - np.clip(bank, 0, 1)))
    rockg = B.zeros()
    for (x, y, r) in [(860, 470, 260), (3400, 1260, 150), (1650, 250, 240)]:
        B.disc(rockg, x, y, r, soft=80)
    paving = B.zeros()
    for (x, y, r) in [(2080, 1990, 170), (2280, 1940, 140), (1930, 2020, 120), (2700, 1740, 150), (2560, 1830, 120)]:
        B.disc(paving, x, y, r, soft=30)
    paving *= (sd > 20)
    trail = B.path_field(width=86, styles=('path',), node_r=76)
    lush = B.zeros()
    for (x, y, r) in [(1650, 380, 380), (900, 420, 300), (2550, 420, 250), (560, 1300, 250)]:
        B.disc(lush, x, y, r, soft=120)
    # sea map: distance from land (and the jetty / stones / hull, which get a foam ring too)
    solid = mask.copy()
    extra_foam = B.zeros()
    for i in REEF_NODES:
        x, y = xy(i)
        B.disc(extra_foam, x, y, 70, soft=20, sy=0.8)
    hull = B.zeros()
    B.capsule(hull, 1190, 1322, 1860, 1322, 105, soft=10)
    B.disc(hull, 1900, 1322, 80, soft=10)
    dist = K.ndimage.distance_transform_edt(~(solid | (extra_foam > 0.5) | (hull > 0.5))) * K.GRID
    # smooth the grid's stair steps out of the distance so the shore foam runs clean
    dist = K.ndimage.gaussian_filter(dist.astype(np.float32), 1.6)
    seamap = np.clip(dist / 420.0, 0, 1).astype(np.float32)
    shallows = B.zeros()
    for (x, y, r) in [(2450, 1300, 260), (2750, 1300, 220), (2020, 1480, 200), (1100, 700, 160)]:
        B.disc(shallows, x, y, r, soft=120)
    foam = B.zeros()
    return sand, rockg, paving, trail, lush, seamap, shallows, foam


def slab_mask():
    f = B.zeros()
    cx, cy, ax, ay, e = 1930, 1200, 1775, 1140, 2.7
    d = (np.abs((B.xx - cx) / ax) ** e + np.abs((B.yy - cy) / ay) ** e) ** (1 / e)
    f = np.clip((1 - d) * 60 + 0.5, 0, 1).astype(np.float32)
    f = B.wobble(f, amp=0.25, scale=260.0, seed=7.0)
    return f > 0.5


def plan():
    mask, sd, bank, raise_z, pool, ko = build_layout()
    sand, rockg, paving, trail, lush, seamap, shallows, foam = build_zones(mask, sd, pool, bank)
    sl = slab_mask()
    h, w = mask.shape
    img = np.zeros((h, w, 3), np.float32)
    img[sl] = (0.15, 0.55, 0.8)
    img[sl & (seamap < 0.08)] = (0.4, 0.85, 0.85)
    img[mask] = (0.35, 0.7, 0.3)
    img[mask & (sand > 0.5)] = (0.93, 0.85, 0.6)
    img[mask & (paving > 0.5)] = (0.8, 0.75, 0.7)
    img[mask & (trail > 0.5)] = (0.85, 0.7, 0.45)
    img[mask & (bank > 0.5) & (sd < 20)] = (0.5, 0.45, 0.45)
    r = np.clip(raise_z / 2.5, 0, 1)
    img = img * (1 - r[..., None] * 0.6) + np.array([0.55, 0.5, 0.45]) * r[..., None] * 0.6
    img[pool > 0.5] = (0.3, 0.8, 0.9)
    im = Image.fromarray((img * 255).astype(np.uint8), "RGB")
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    k = 1 / K.GRID
    for e in B.edges:
        a, b = N[e['from']], N[e['to']]
        d.line([a['x'] * k, a['y'] * k, b['x'] * k, b['y'] * k], fill=(255, 255, 255), width=1)
    for n in N.values():
        d.ellipse([n['x'] * k - 4, n['y'] * k - 3, n['x'] * k + 4, n['y'] * k + 3], fill=(255, 60, 60))
    for lm in LANDMARKS:
        d.rectangle([lm['x'] * k - 3, lm['y'] * k - 3, lm['x'] * k + 3, lm['y'] * k + 3], outline=(255, 255, 0))
    d.ellipse([2020 * k - 4, 1500 * k - 4, 2020 * k + 4, 1500 * k + 4], outline=(255, 0, 255))
    # where the game stands its NPCs (BoardManager): they need ground under their feet
    spots = {'ora': (B.data['hostSpot']['x'], B.data['hostSpot']['y']), 'mimi': (2020, 1500)}
    for i, n in N.items():
        if n['type'] == 'market':
            spots[f'shop@{i} (pipper +78,-52)'] = (n['x'] + 78, n['y'] - 52)
            spots[f'shop@{i} (wrench -70,-58)'] = (n['x'] - 70, n['y'] - 58)
    for k, (x, y) in spots.items():
        print('NPC', k, (x, y), 'inside shore by', round(B.at(sd, x, y)), 'px')
    im.save(os.path.join(OUT, 'plan.png'))
    print('wrote', os.path.join(OUT, 'plan.png'))


# ------------------------------------------------------------------------------------------
# Scene
def build_scene():
    mask, sd, bank, raise_z, pool, ko = build_layout()
    sand, rockg, paving, trail, lush, seamap, shallows, foam = build_zones(mask, sd, pool, bank)
    zpath = K.save_map(os.path.join(OUT, 'zones.png'), [sand, rockg, paving], size=(B.W // 2, B.H // 2))
    epath = K.save_map(os.path.join(OUT, 'extra.png'), [trail, lush, B.zeros()], size=(B.W // 2, B.H // 2))
    spath = K.save_map(os.path.join(OUT, 'sea.png'), [seamap, shallows, foam], size=(B.W // 2, B.H // 2))
    K.setup_scene(SAMPLES)
    pal = dict(
        grass=[(0.28, '#2b7a24'), (0.42, '#3a922c'), (0.55, '#52aa36'), (0.68, '#74c040'), (0.82, '#a2d355')],
        lush=[(0.28, '#185e22'), (0.42, '#23752a'), (0.55, '#328c33'), (0.68, '#4ca33c'), (0.82, '#70b548')],
        sand=[(0.25, '#e9cf98'), (0.5, '#f2dcaa'), (0.75, '#f8e8c2')],
        rock=[(0.25, '#7c6a5c'), (0.42, '#978270'), (0.58, '#b09a84'), (0.72, '#8c7c80'), (0.86, '#a89aa2')],
        trail=[(0.3, '#e0bf82'), (0.5, '#ebcd94'), (0.7, '#f4dcaa')],
        paving=[(0.0, '#d8c8ae'), (0.5, '#e8dcc4'), (1.0, '#cdb89a')],
        fringe='#f2e2b4', flowers=0.9,
    )
    land_m = K.land_material(B, zpath, epath, pal)
    sea_m = K.water_material(B, spath)
    rock_m = K.rock_material()
    # land
    valid = sd > -34
    K.heightfield(B, K.land_heights(B, sd, bank, raise_z), valid, 'land', land_m)
    # the pool's water and the falls pouring into it
    px, py, prx, pry = POOL
    pool_mb = lib.MeshBuilder()
    c = board_to_world(px, py, -0.12)
    v, f = lib.lathe([(prx / 100.0 + 0.1, 0.0), (0.0, 0.0)], 40, (c.x, c.y, -0.12), cap_bottom=False, cap_top=False, squash_y=(pry / prx) / lib.COSB)
    pool_mb.add(v, f, (1, 1, 1, 1))
    pool_mb.build('pool', K.pond_material(), smooth=False)
    # the sea slab, its falls over the rim
    ob, ring, nrm = K.slab(B, slab_mask(), rock_m, sea_m)
    water = lib.MeshBuilder()
    picks = []
    for k in range(len(ring)):
        if nrm[k][1] > 0.92 and 700 < ring[k][0] < 3200 and k % 3 == 0:
            picks.append(k)
    rnd = random.Random(5)
    picks = sorted(rnd.sample(picks, min(3, len(picks))))
    K.rim_falls(B, ring, nrm, picks, water, rnd, width=0.72)
    water.build('falls', lib.falls_material('falls', K.WATER_Z + 0.04, K.WATER_Z - 3.6), smooth=True)
    lagoon = lib.MeshBuilder()
    top_z = lagoon_falls(lagoon, raise_z)
    lagoon.build('lagoon_falls', lib.falls_material('lagoon_falls', top_z, -0.35), smooth=True)
    mats = scatter_mats()
    scatter(mask, sd, raise_z, sand, paving, trail, mats)
    trails_over_water(mats)
    sea_life(mats)
    ship_hull(mats)
    shrines(mats)
    return mask, sd


def lagoon_falls(water, raise_z):
    """The lagoon's waterfall: a ribbon from the cliff lip down into the pool, foam at both ends."""
    lx, ly = FALLS_LIP
    top_z = K.sample(raise_z, np.array([lx]), np.array([ly - 12]))[0]
    w0 = board_to_world(lx, ly, top_z - 0.02)
    px, py, _, _ = POOL
    foot = board_to_world(px, py - 20, -0.1)
    cols, rows = 10, 20
    verts, faces = [], []
    for j in range(rows + 1):
        t = j / rows
        yy = w0.y + (foot.y - w0.y) * min(1.0, t * 1.4) ** 0.5
        z = w0.z + (foot.z - w0.z) * t ** 1.25
        for i in range(cols + 1):
            u = (i / cols * 2 - 1) * (0.34 + 0.12 * t)
            bulge = 0.06 * (1 - (i / cols * 2 - 1) ** 2)
            verts.append((w0.x + u, yy - bulge, z))
    for j in range(rows):
        for i in range(cols):
            a = j * (cols + 1) + i
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    water.add(verts, faces, (1, 1, 1, 1))
    rnd = random.Random(3)
    for k in range(8):
        v, f = lib.blob((foot.x + rnd.uniform(-0.4, 0.4), foot.y + rnd.uniform(-0.1, 0.15), -0.08), rnd.uniform(0.07, 0.13), squash=(1.3, 1.0, 0.5), rough=0.3, subdiv=1, seed=k)
        water.add(v, f, (1, 1, 1, 1))
    for k in range(5):
        v, f = lib.blob((w0.x + (k - 2) * 0.12, w0.y - 0.02, w0.z + 0.01), 0.06, squash=(1.2, 1.0, 0.5), rough=0.3, subdiv=1, seed=k + 9)
        water.add(v, f, (1, 1, 1, 1))
    print('lagoon falls: lip screen', (lx, round(ly - w0.z * 100 * lib.SINB)), 'splash screen', (px, round(py - 20 + 0.1 * 100 * lib.SINB)))
    return w0.z


def scatter_mats():
    return dict(
        grass=terrain.scatter_mat('grass', rough=0.8, sheen=0.15, ao=0.3),
        flower=terrain.scatter_mat('flower', rough=0.55, sheen=0.3),
        leaf=terrain.leaf_material('leaf', ao=0.5),
        palm=terrain.leaf_material('palm', ao=0.4, scale=14.0, sun='#e8f59a', shade='#1f5a2a'),
        wood=terrain.scatter_mat('wood', rough=0.8, ao=0.3),
        rock=terrain.scatter_mat('rock', rough=0.85, ao=0.4),
        cloth=terrain.scatter_mat('cloth', rough=0.6, ao=0.25),
        fruit=terrain.scatter_mat('fruit', rough=0.45, sheen=0.2),
        deck=K.wood_deck_material(),
        paving=terrain.paving_material(),
    )


def scatter(mask, sd, raise_z, sand, paving, trail, mats):
    rnd = random.Random(21)
    grass, flowers, leaves, palms, wood, rocks, cloth, fruit, shells = (lib.MeshBuilder() for _ in range(9))
    ys, xs = np.nonzero(mask)

    def pick(min_edge=10, max_edge=1e9, path_clear=0.05, node_r=80, flat=True, tries=40):
        for _ in range(tries):
            j = rnd.randrange(len(xs))
            bx = xs[j] * K.GRID + rnd.uniform(0, K.GRID)
            by = ys[j] * K.GRID + rnd.uniform(0, K.GRID)
            d = B.at(sd, bx, by)
            if d < min_edge or d > max_edge or B.at(trail, bx, by) > path_clear:
                continue
            if node_r and B.near_node(bx, by, node_r):
                continue
            if flat and B.at(raise_z, bx, by) > 0.05:
                continue
            if near_landmark(bx, by):
                continue
            return bx, by
        return None

    def z_at(bx, by):
        return float(K.sample(raise_z, np.array([bx]), np.array([by]))[0])

    area = len(xs) * K.GRID * K.GRID
    # palms: along the beaches and round the cove, only where they never hide a trail
    n_palm = 0
    for _ in range(int(area / 9000)):
        pt = pick(min_edge=30, max_edge=150, path_clear=0.0, node_r=110)
        if not pt:
            continue
        bx, by = pt
        if not B.canopy_clear(bx, by, 110, 190):
            continue
        K.palm(palms, wood, fruit, bx, by, rnd, rnd.uniform(0.85, 1.15))
        n_palm += 1
    # jungle trees and palms on the raised crags and hills
    for _ in range(int(area / 26000)):
        pt = pick(min_edge=40, path_clear=0.0, node_r=120, flat=False)
        if not pt:
            continue
        bx, by = pt
        z = z_at(bx, by)
        if z < 0.4 or not B.canopy_clear(bx, by - z * 61.6, 110, 200):
            continue
        if rnd.random() < 0.5:
            K.palm(palms, wood, fruit, bx, by, rnd, rnd.uniform(0.8, 1.0), z0=z)
        else:
            n0 = len(leaves.v)
            terrain.bush(leaves, bx, by, rnd, rnd.uniform(0.9, 1.4))
            leaves.v[n0:] = [(vx, vy, vz + z) for (vx, vy, vz) in leaves.v[n0:]]
    # tangerine grove on the terrace
    grove = [(470, 1180), (560, 1120), (640, 1060), (470, 1280), (590, 1330), (500, 1580), (600, 1560)]
    for (bx, by) in grove:
        if B.near_node(bx, by, 95) or not B.canopy_clear(bx, by, 80, 130):
            continue
        K.fruit_tree(leaves, wood, fruit, bx, by, rnd, rnd.uniform(0.85, 1.0))
    # tufts, flowers, bushes, rocks
    for _ in range(int(area / (26 * 26))):
        j = rnd.randrange(len(xs))
        bx = xs[j] * K.GRID + rnd.uniform(0, K.GRID)
        by = ys[j] * K.GRID + rnd.uniform(0, K.GRID)
        if B.at(sd, bx, by) < 40 or B.at(trail, bx, by) > 0.3 or B.at(sand, bx, by) > 0.5 or B.at(paving, bx, by) > 0.4:
            continue
        terrain.grass_tuft(grass, bx, by, rnd, rnd.uniform(0.8, 1.3))
    for _ in range(int(area / 30000)):
        pt = pick(min_edge=50, path_clear=0.02, node_r=85)
        if pt and B.at(sand, *pt) < 0.4 and B.at(paving, *pt) < 0.3:
            festival_flowers(flowers, leaves, *pt, rnd)
    for _ in range(int(area / 30000)):
        pt = pick(min_edge=30, max_edge=160, path_clear=0.01, node_r=92)
        if pt and B.canopy_clear(pt[0], pt[1], 40, 60):
            terrain.bush(leaves, *pt, rnd, rnd.uniform(0.7, 1.15), berries=flowers)
    for _ in range(int(area / 26000)):
        pt = pick(min_edge=6, max_edge=70, path_clear=0.08, node_r=70, flat=False)
        if pt:
            terrain.rock(rocks, *pt, rnd, rnd.uniform(0.9, 1.6), moss=B.at(sand, *pt) < 0.5)
    # beach life: shells, starfish, parasols and towels, driftwood
    for _ in range(int(area / 7000)):
        pt = pick(min_edge=14, max_edge=90, path_clear=0.05, node_r=66)
        if pt and B.at(sand, *pt) > 0.6:
            K.shell(shells, *pt, rnd, z=-0.12 * (1 - min(1, B.at(sd, *pt) / 58.0)))
    for (bx, by, stripe) in [(1470, 2195, ('#ff6b5e', '#fff4dc')), (1290, 2170, ('#1fa5a0', '#fff4dc')), (1110, 2120, ('#f4b83b', '#fff4dc')),
                             (2000, 1560, ('#8e5cd9', '#fff4dc'))]:
        if not B.near_node(bx, by, 75):
            K.parasol(cloth, wood, bx, by, rnd, stripe=stripe, s=1.0)
    for _ in range(10):
        pt = pick(min_edge=10, max_edge=60, path_clear=0.05, node_r=70)
        if pt and B.at(sand, *pt) > 0.6:
            K.driftwood(wood, *pt, rnd)
    # harbour clutter: crates and barrels on the quay, a rowboat, bollards
    for (bx, by) in [(2230, 1905), (2255, 1925), (1880, 1960), (2780, 1610), (2600, 1690), (2470, 1660)]:
        if not B.near_node(bx, by, 70):
            (terrain.crate if rnd.random() < 0.6 else terrain.barrel)(wood, bx, by, rnd)
    B_ = {k: lib.MeshBuilder() for k in ('cloth', 'wood', 'paint', 'metal', 'glow', 'flowers', 'leaves', 'fruit', 'glass', 'rocks')}
    for (bx, by, yaw, s, hull) in [(2180, 1790, 0.25, 1.2, '#e8604c'), (1340, 1880, -0.4, 1.1, '#3f7fd9'), (3000, 1720, 0.6, 1.1, '#f4b83b')]:
        # rowboats float on the sea: author at the ground, then drop to the water line
        n0 = {k: len(mb.v) for k, mb in B_.items()}
        festival.rowboat(B_, bx, by + K.WATER_Z * 100 * lib.SINB, yaw, rnd, s=s, hull=hull)
        for k, mb in B_.items():
            mb.v[n0[k]:] = [(vx, vy, vz + K.WATER_Z + 0.03) for (vx, vy, vz) in mb.v[n0[k]:]]
    fest_mat = dict(cloth=mats['cloth'], paint=mats['cloth'], wood=mats['wood'], metal=props.mats()['metal'], glow=props.mats()['glow'])
    for k, mb in B_.items():
        mb.build(f'fest_{k}', fest_mat.get(k, mats['leaf']))
    grass.build('grass', mats['grass'], smooth=False)
    flowers.build('flowers', mats['flower'])
    leaves.build('leaves', mats['leaf'])
    palms.build('palms', mats['palm'])
    wood.build('wood', mats['wood'])
    rocks.build('rocks', mats['rock'])
    cloth.build('cloth', mats['cloth'])
    fruit.build('fruit', mats['fruit'])
    shells.build('shells', mats['flower'])
    print('palms', n_palm)


def festival_flowers(flowers, leaves, bx, by, rnd):
    """Hibiscus-bright flower clumps."""
    cols = [col(c) for c in rnd.sample(['#ff4f6a', '#ffb13b', '#ff7ac8', '#fff4dc', '#ffd23f'], 2)]
    for _ in range(rnd.randint(6, 12)):
        fx, fy = bx + rnd.gauss(0, 16), by + rnd.gauss(0, 11)
        p = board_to_world(fx, fy, 0.0)
        h = rnd.uniform(0.06, 0.14)
        terrain.flower(flowers, p.x, p.y, h, rnd.choice(cols), rnd.uniform(0.04, 0.06))
        if rnd.random() < 0.7:
            v, f = lib.blob((p.x + rnd.uniform(-0.04, 0.04), p.y, 0.03), 0.055, squash=(1.4, 1, 0.3), rough=0.1, subdiv=1)
            leaves.add(v, f, col(rnd.choice(['#2f8a2c', '#3f9b33', '#237a2a'])))


def near_landmark(bx, by, pad=0.0):
    for lm in LANDMARKS:
        r = {'rig': 0, 'lighthouse': 120, 'dojo': 150, 'map_room': 120, 'cave': 150, 'stall': 80, 'house': 70, 'crane': 60,
             'stage': 90, 'lantern': 34, 'bunting': 0, 'tangerine': 70, 'pedestal': 50}.get(lm['kind'], 60)
        if r and (bx - lm['x']) ** 2 + (by - lm['y']) ** 2 < (r + pad) ** 2:
            return True
    if 1150 < bx < 1920 and 1200 < by < 1440:  # the galleon
        return True
    return False


def trails_over_water(mats):
    """Jetty, gangplanks, footbridges, reef stones and stepping stones; rope-bridge anchor posts."""
    rnd = random.Random(33)
    wood, rocks, tops = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    for e in B.edges:
        a, b = e['from'], e['to']
        art = edge_art(a, b)
        (ax, ay), (bx, by) = xy(a), xy(b)
        if art == 'jetty':
            K.jetty(wood, (ax, ay), (bx, by), rnd, width=0.5)
        elif art == 'footbridge':
            K.jetty(wood, (ax, ay), (bx, by), rnd, width=0.44, posts_to=-0.9)
        elif art == 'gangplank':
            if a in DECK_NODES:
                s = (ax + 55, BP.deck_ground_y(ay) + 55)
                K.ramp_plank(wood, s, (bx - 20, by - 10), BP.DECK_Z, 0.0, rnd)
            else:
                K.ramp_plank(wood, (ax + 25, ay + 15), (bx - 40, BP.deck_ground_y(by) + 40), 0.0, BP.DECK_Z, rnd)
        elif art in ('reef', 'stones'):
            L = math.hypot(bx - ax, by - ay)
            n = max(1, int(L / 62))
            for k in range(n):
                t = (k + 0.5) / n
                sx, sy = ax + (bx - ax) * t, ay + (by - ay) * t
                if any(math.hypot(sx - N[i]['x'], sy - N[i]['y']) < 70 for i in (a, b)):
                    continue
                K.reef_stone(rocks, tops, sx, sy, rnd, r=0.2)
        elif art == 'bridge' and (a == 't5' or b == 'l0'):
            # anchor posts where the rope bridge leaves the land (the game draws the bridge itself)
            L = math.hypot(bx - ax, by - ay)
            ux, uy = (bx - ax) / L, (by - ay) / L
            qx, qy = (ax + ux * 62, ay + uy * 62) if a == 't5' else (bx - ux * 62, by - uy * 62)
            for sgn in (-1, 1):
                p = board_to_world(qx - uy * 34 * sgn, qy + ux * 34 * sgn, 0.0)
                v, f = lib.cylinder((p.x, p.y, -0.3), 0.055, 0.045, 0.95, 8)
                wood.add(v, f, col('#6e4a2c'))
                v, f = lib.blob((p.x, p.y, 0.66), 0.06, rough=0.0, subdiv=1)
                wood.add(v, f, col('#8a5e3a'))
    for i in REEF_NODES:
        x, y = xy(i)
        K.reef_stone(rocks, tops, x, y, rnd, r=0.6, top='#dcc9a0')
    for i in JETTY_NODES:
        x, y = xy(i)
        p = board_to_world(x, y, 0.0)
        for k in range(7):
            v, f = lib.box((p.x - 0.36 + k * 0.12, p.y, -0.02), (0.11, 1.4, 0.05))
            wood.add(v, f, col(rnd.choice(['#b98a55', '#a87a48', '#c49660'])))
        for (dx, dy) in [(-0.42, -0.62), (0.42, -0.62), (-0.42, 0.62), (0.42, 0.62)]:
            v, f = lib.cylinder((p.x + dx, p.y + dy, K.WATER_Z - 0.6), 0.045, 0.045, 0.75, 8)
            wood.add(v, f, col('#6e4a2c'))
    wood.build('water_wood', mats['wood'])
    rocks.build('reef_rocks', mats['rock'])
    tops.build('reef_tops', mats['paving'], smooth=False)


def sea_life(mats):
    """Coral round the reef stones and the sandbar, a channel buoy off the harbour, drifting barrels."""
    rnd = random.Random(61)
    coral, paint, wood = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    for i in REEF_NODES + ['c2', 'c3']:
        x, y = xy(i)
        for _ in range(3):
            a = rnd.uniform(0, math.tau)
            r = rnd.uniform(85, 130)
            cx, cy = x + math.cos(a) * r, y + math.sin(a) * r * 0.8
            if B.near_node(cx, cy, 80) or B.near_path(cx, cy, 55):
                continue
            K.coral(coral, cx, cy, rnd, rnd.uniform(0.8, 1.2))
    for (bx, by) in [(2230, 1640), (1180, 1700), (2900, 1860)]:
        K.buoy(paint, bx, by)
    for (bx, by) in [(1450, 1560), (2350, 1450), (980, 1450), (2600, 1450)]:
        K.floating_barrel(wood, bx, by, rnd)
    coral.build('coral', mats['flower'])
    paint.build('buoys', mats['cloth'])
    wood.build('drift_barrels', mats['wood'])


def ship_hull(mats):
    """The galleon's hull and deck go into the terrain (people walk on the deck)."""
    P = BP_HullProp('galleon_hull', mats['deck'])
    GALLEON.hull(P)
    BP.feast_table(P, 1640, BP.deck_ground_y(1255), s=1.05)
    P.build()


class BP_HullProp(props.Prop):
    def __init__(self, name, deck_mat):
        super().__init__(name)
        self.deck = lib.MeshBuilder()
        self.deck_mat = deck_mat

    def build(self):
        obs = super().build()
        ob = self.deck.build(f'{self.name}_deck', self.deck_mat, smooth=False)
        if ob is not None:
            obs.append(ob)
        return obs


def shrines(mats):
    rnd = random.Random(1234)
    paving, gold, glass, crystals = (lib.MeshBuilder() for _ in range(4))
    for g in B.data['relicGates']:
        if g in SHRINE_SKIP:
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
        if k == 'rig':
            P = props.Prop('galleon_rig')
            GALLEON.rig(P)
            obs = P.build()
        elif k == 'lighthouse':
            obs = BP.lighthouse(lm['x'], lm['y'], s)
        elif k == 'dojo':
            obs = BP.dojo(lm['x'], lm['y'], s)
        elif k == 'map_room':
            obs = BP.map_room(lm['x'], lm['y'], s)
        elif k == 'cave':
            obs = BP.cave_mouth(lm['x'], lm['y'], s)
        elif k == 'stall':
            obs = props.stall(lm['x'], lm['y'], s, stripe=lm['stripe'], crate=True)
        elif k == 'house':
            obs = BP.harbour_house(lm['x'], lm['y'], s, wall=lm['wall'], roof=lm['roof'], flip=lm.get('flip', False))
        elif k == 'crane':
            obs = BP.crane(lm['x'], lm['y'], s)
        elif k == 'stage':
            obs = props.stage(lm['x'], lm['y'], s)
        elif k == 'lantern':
            obs = props.lantern(lm['x'], lm['y'], s)
        elif k == 'bunting':
            obs = props.bunting(lm['x'], lm['y'], lm.get('width', 240), s)
        elif k == 'tangerine':
            P = props.Prop('tangerine_tree')
            rnd = random.Random(8)
            K.fruit_tree(P.b['leaf'], P.b['wood'], P.b['paint'], lm['x'], lm['y'], rnd, s)
            obs = P.build()
        elif lm.get('z'):
            # the galleon's pedestal stands on the deck: build it where the deck shows at its anchor
            obs = props.pedestal(lm['x'], BP.deck_ground_y(lm['y']), s)
            for o in obs:
                o.location.z += lm['z']
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
        composite_preview(path, built, terrain_objs)
    if A.export:
        export_terrain()
        K.render_props(B, built, terrain_objs, B.frame, SCALE, OUT)


def export_terrain():
    K.export_tiles(os.path.join(OUT, 'terrain.png'), B.id, B.frame[:2], SCALE)
    K.island_shadow(os.path.join(OUT, 'terrain.png'), B.id)


def composite_preview(path, built, terrain_objs):
    """Preview only: render the landmark sprites too and lay them over the terrain in depth order."""
    for o in terrain_objs:
        o.hide_render = True
    for _, obs in built.values():
        for o in obs:
            o.visible_camera = True
    lib.render_to(os.path.join(OUT, 'preview_props.png'))
    base = Image.open(path).convert('RGBA')
    over = Image.open(os.path.join(OUT, 'preview_props.png')).convert('RGBA')
    base.alpha_composite(over)
    base.save(os.path.join(OUT, 'preview_full.png'))
    print('wrote preview_full.png')


main()
