"""Capitol Gardens board diorama: a stately civic park on one broad floating isle, with a few little
garden islets drifting round it.

    <bpyenv>/bin/python scripts/art/worlds/capitol/board.py --plan        (island plan, no render)
    <bpyenv>/bin/python scripts/art/worlds/capitol/board.py --preview     (quarter-size look)
    <bpyenv>/bin/python scripts/art/worlds/capitol/board.py --export      (full render: tiles, sprites, shadow)

Board data comes from scripts/art/worlds/capitol/board.json:
    node scripts/art/worlds/export-world-board.mjs capitol > scripts/art/worlds/capitol/board.json

The basketball court and the putting green mirror each other across the park's centre line (x = 1800):
same footprint, same dressing, same standing.
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
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
import landkit as K  # noqa: E402
import lib  # noqa: E402
import terrain  # noqa: E402
from lib import col  # noqa: E402


def args():
    p = argparse.ArgumentParser()
    p.add_argument('--preview', action='store_true')
    p.add_argument('--scale', type=float, default=None)
    p.add_argument('--samples', type=int, default=None)
    p.add_argument('--out', default=os.path.join(lib.ROOT, 'art-out', 'capitol'))
    p.add_argument('--export', action='store_true', help='slice into WebP tiles and render the sprites')
    p.add_argument('--props-only', action='store_true')
    p.add_argument('--only', default='', help='with --props-only: comma-separated sprite ids')
    p.add_argument('--crop', default='', help='x0,y0,x1,y1 board px region to render')
    p.add_argument('--plan', action='store_true', help='write the island plan (plan.png) and exit')
    p.add_argument('--dry', action='store_true', help='build the whole scene but render nothing (script check)')
    return p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])


A = args()
SCALE = A.scale or (0.25 if A.preview else 1.0)
SAMPLES = A.samples or (8 if A.preview else 12)
B = K.Board(os.path.join(HERE, 'board.json'))
N = B.nodes
lib.seeded(17)
AXIS = 1800  # the park's centre line

HALL = (1260, 470)
OBELISK = (1850, 520)
MANSION = (2455, 560)
FOUNTAIN = (2410, 958)
POOL = (1190, 858, 2290, 990)  # x0, y0, x1, y1
COURT = (560, 1255)
GREEN = (2 * AXIS - COURT[0], COURT[1])
BANDSTAND = (2010, 1946)
MIMI = (2020, 1500)

LANDMARKS = [
    dict(id='hall', kind='hall', x=HALL[0], y=HALL[1], s=1.3, tex='observatory'),
    dict(id='obelisk', kind='obelisk', x=OBELISK[0], y=OBELISK[1], s=1.15, tex=''),
    dict(id='mansion', kind='mansion', x=MANSION[0], y=MANSION[1], s=1.2, tex='workshop'),
    dict(id='gate', kind='gate', x=1725, y=2032, s=1.0, tex='prism-gate'),
    dict(id='arbor', kind='arbor', x=1185, y=1745, s=1.0, tex=''),
    dict(id='bandstand', kind='stage', x=BANDSTAND[0], y=BANDSTAND[1], s=1.0, tex='', depth_y=BANDSTAND[1] - 66),
    dict(id='bunting-promenade', kind='bunting', x=2560, y=1610, s=1.1, width=200, tex='bunting'),
    dict(id='bunting-green', kind='bunting', x=2280, y=1850, s=1.05, width=180, tex=''),
    dict(id='bunting-hall', kind='bunting', x=1645, y=572, s=1.05, width=150, tex=''),
    dict(id='bunting-mansion', kind='bunting', x=2105, y=598, s=1.05, width=170, tex=''),
    dict(id='lamp-gate-w', kind='lamp', x=1560, y=2025, s=1.0, tex='lantern'),
    dict(id='lamp-gate-e', kind='lamp', x=2170, y=2040, s=1.0, tex=''),
    dict(id='lamp-avenue', kind='lamp', x=1690, y=1385, s=1.0, tex=''),
]
RELIC_GATES = B.data['relicGates']
SHRINES = []
for _g in RELIC_GATES:
    SHRINES.append((N[_g]['x'], N[_g]['y'] - 40, _g))
    LANDMARKS.append(dict(id=f'pedestal-{_g}', kind='pedestal', x=N[_g]['x'], y=N[_g]['y'] - 85, s=1.0, tex='relic-pedestal'))

# Discs that widen the park under its landmarks (mirrored pairs for the court and the green).
DISCS = [
    (HALL[0], HALL[1] - 20, 270), (HALL[0] - 260, HALL[1] + 80, 190), (HALL[0] + 250, HALL[1] + 60, 180),
    (OBELISK[0], OBELISK[1] - 20, 185),
    (MANSION[0], MANSION[1] - 20, 260), (MANSION[0] - 250, MANSION[1] + 70, 180), (MANSION[0] + 250, MANSION[1] + 80, 190),
    (COURT[0], COURT[1], 235), (COURT[0] - 20, COURT[1] - 130, 150), (COURT[0] - 10, COURT[1] + 150, 150), (COURT[0] - 130, COURT[1], 175),
    (GREEN[0], GREEN[1], 235), (GREEN[0] + 20, GREEN[1] - 130, 150), (GREEN[0] + 10, GREEN[1] + 150, 150), (GREEN[0] + 130, GREEN[1], 175),
    (870, 1860, 200), (700, 1980, 150), (2080, 1950, 150), (2330, 2060, 150), (1320, 2160, 150), (2900, 1600, 150), (700, 1580, 150),
]
ISLETS = [
    ([(360, 840, 98)], 0.25, 1),
    ([(3240, 800, 92)], 0.15, 2),
    ([(3360, 1880, 96)], -0.3, 3),
    ([(270, 1700, 80)], -0.15, 4),
]
PATH_PTS = B.path_points()


def canopy_clear(bx, by, width, height):
    m = (np.abs(PATH_PTS[:, 0] - bx) < width) & (PATH_PTS[:, 1] < by + 22) & (PATH_PTS[:, 1] > by - height)
    return not m.any()


def in_box(bx, by, cx, cy, hw, hh):
    return abs(bx - cx) < hw and abs(by - cy) < hh


def near_landmark(bx, by, pad=0.0):
    for lm in LANDMARKS:
        rr = {'hall': 0, 'obelisk': 70, 'mansion': 0, 'gate': 110, 'arbor': 70, 'stage': 100, 'bunting': 0, 'lamp': 30, 'pedestal': 40}.get(lm['kind'], 60)
        if lm['kind'] == 'bunting':
            half = lm.get('width', 240) / 2
            if any((bx - px) ** 2 + (by - lm['y']) ** 2 < (30 + pad) ** 2 for px in (lm['x'] - half, lm['x'] + half)):
                return True
            continue
        if rr and (bx - lm['x']) ** 2 + (by - lm['y']) ** 2 < (rr + pad) ** 2:
            return True
    for (sx, sy, _) in SHRINES:
        if ((bx - sx) / (95 + pad)) ** 2 + ((by - sy) / (70 + pad)) ** 2 < 1.0:
            return True
    if in_box(bx, by, HALL[0], HALL[1] + 20, 220 + pad, 150 + pad) or in_box(bx, by, MANSION[0], MANSION[1] + 30, 250 + pad, 150 + pad):
        return True
    if in_box(bx, by, (POOL[0] + POOL[2]) / 2, (POOL[1] + POOL[3]) / 2, (POOL[2] - POOL[0]) / 2 + 20 + pad, (POOL[3] - POOL[1]) / 2 + 20 + pad):
        return True
    if (bx - FOUNTAIN[0]) ** 2 + ((by - FOUNTAIN[1]) * 1.25) ** 2 < (95 + pad) ** 2:
        return True
    for (cx, cy) in (COURT, GREEN):
        if in_box(bx, by, cx, cy, 165 + pad, 95 + pad):
            return True
    if (bx - MIMI[0] - 40) ** 2 + (by - MIMI[1] - 50) ** 2 < (80 + pad) ** 2:
        return True
    return False


def near_node(bx, by, r):
    return any((bx - n['x']) ** 2 + (by - n['y']) ** 2 < r * r for n in N.values())


def plan_islands():
    comps = B.components()
    owner = {}
    for (cx, cy, r) in DISCS:
        nearest = min(N.values(), key=lambda n: math.hypot(cx - n['x'], cy - n['y']))
        owner.setdefault(nearest['id'], []).append((cx, cy, r))
    items = []
    for ids in comps:
        discs = [d for i in ids for d in owner.get(i, [])]
        items.append((ids, K.island_mask(B, ids, discs=discs, node_r=130)))
    for (discs, z, seed) in ISLETS:
        items.append(([], K.disc_mask(B, discs, lobes=2, seed=seed)))
    merged = K.separate(B, items)
    out = []
    islet_i = 0
    from scipy import ndimage
    for ids, m in merged:
        if ids:
            out.append(dict(ids=ids, mask=ndimage.binary_fill_holes(m), key='park', z=0.0, theme='park'))
        else:
            z = ISLETS[islet_i][1] if islet_i < len(ISLETS) else 0.0
            islet_i += 1
            out.append(dict(ids=[], mask=m, key=f'islet{islet_i}', z=z, theme='islet'))
    return out


def frame_of(islands):
    ys, xs = [], []
    for isl in islands:
        yy, xx = np.nonzero(isl['mask'])
        xs += [xx.min() * K.GRID, xx.max() * K.GRID]
        ys += [yy.min() * K.GRID, yy.max() * K.GRID]
    x0, x1 = min(xs) - 90, max(xs) + 90
    y0, y1 = min(ys) - 300, max(ys) + 470
    return (int(x0), int(y0), int(x1 - x0), int(y1 - y0))


def plan_map(islands):
    k = 0.25
    img = Image.new('RGB', (int(B.W * k), int(B.H * k)), (46, 60, 88))
    px = np.asarray(img).copy()
    for i, isl in enumerate(islands):
        m = np.asarray(Image.fromarray(isl['mask'].astype(np.uint8) * 255).resize(img.size, Image.NEAREST)) > 127
        px[m] = [(100, 160, 90), (120, 150, 110)][i % 2]
    img = Image.fromarray(px)
    d = ImageDraw.Draw(img)
    for e in B.edges:
        a, b = N[e['from']], N[e['to']]
        d.line([(a['x'] * k, a['y'] * k), (b['x'] * k, b['y'] * k)], fill=(240, 230, 200), width=2)
    for n in N.values():
        d.ellipse([n['x'] * k - 3, n['y'] * k - 3, n['x'] * k + 3, n['y'] * k + 3], fill=(230, 40, 40))
    x0, y0, x1, y1 = POOL
    d.rectangle([x0 * k, y0 * k, x1 * k, y1 * k], outline=(80, 170, 255))
    for (cx, cy) in (COURT, GREEN):
        d.rectangle([(cx - 140) * k, (cy - 71) * k, (cx + 140) * k, (cy + 71) * k], outline=(255, 160, 60))
    d.ellipse([(FOUNTAIN[0] - 68) * k, (FOUNTAIN[1] - 54) * k, (FOUNTAIN[0] + 68) * k, (FOUNTAIN[1] + 54) * k], outline=(80, 170, 255))
    for lm in LANDMARKS:
        d.rectangle([lm['x'] * k - 3, lm['y'] * k - 3, lm['x'] * k + 3, lm['y'] * k + 3], outline=(255, 230, 0))
        d.text((lm['x'] * k + 4, lm['y'] * k - 4), lm['id'][:10], fill=(255, 240, 120))
    d.ellipse([MIMI[0] * k - 5, MIMI[1] * k - 5, MIMI[0] * k + 5, MIMI[1] * k + 5], outline=(255, 0, 255), width=2)
    fx, fy, fw, fh = frame_of(islands)
    d.rectangle([fx * k, fy * k, (fx + fw) * k, (fy + fh) * k], outline=(255, 255, 255))
    os.makedirs(A.out, exist_ok=True)
    img.save(os.path.join(A.out, 'plan.png'))
    print('plan', os.path.join(A.out, 'plan.png'), 'frame', (fx, fy, fw, fh), 'islands', len(islands))


PARK = dict(grass=[(0.28, '#3d8c2c'), (0.42, '#4d9e35'), (0.55, '#5fae3f'), (0.68, '#78c04b'), (0.82, '#9ad25d')],
            trail=[(0.3, '#ddd3be'), (0.5, '#e8e0cf'), (0.7, '#f3ecdf')],
            rock=[(0.25, '#86705d'), (0.4, '#a0876e'), (0.55, '#bca285'), (0.7, '#998b90'), (0.85, '#b2a8ad')],
            soil=('#6b4a30', '#8c6440'), flowers=0.7, stripes=0.38, paving=0.9, edge='#f6f0e2', crack='#6a5a54', rock_tint='#6b6690')


def main():
    import bpy
    import props
    import board_props as BP

    islands = plan_islands()
    if A.plan:
        plan_map(islands)
        return
    K.setup_render(SAMPLES)
    props.use_board_look()
    # a clear, sunny afternoon over the gardens
    lib.world_light(0.85, zenith='#9ccfff', horizon='#fff2dc', ground='#b9b09a')
    lib.sun(energy=3.7, elevation=52, azimuth=-35, angle=3.2, color='#fff3de')
    out = A.out
    os.makedirs(out, exist_ok=True)

    plazas = [(1850, 2085, 230, 78), (1320, 640, 210, 48), (2450, 772, 160, 44), (FOUNTAIN[0], FOUNTAIN[1], 120, 80), (1850, 612, 120, 42),
              (N['x4']['x'], N['x4']['y'] - 30, 150, 60)]
    pm_path, pm = K.path_mask(B, out, B.edges, width=92, extra=plazas)

    mats = props.mats()
    grass_m = terrain.scatter_mat('grass', rough=0.8, sheen=0.15, ao=0.3)
    flat_m = terrain.scatter_mat('grass_flat', rough=0.7, sheen=0.25, ao=0.25)
    flower_m = terrain.scatter_mat('flower', rough=0.55, sheen=0.3)
    leaf_m = terrain.leaf_material('leaf', ao=0.5)
    hedge_m = terrain.leaf_material('hedge', ao=0.45, scale=16.0, sun='#cfe98f', shade='#1b4a2c')
    flora_m = terrain.leaf_material('flora', ao=0.5, sun='#fff6f0', shade='#8a3a5a', gaps='#c298a8', ao_tint='#6d3a52')
    wood_m = terrain.scatter_mat('trunks', rough=0.8, ao=0.3)
    rock_m = terrain.scatter_mat('rock', rough=0.85, ao=0.4)
    G = K.Builders(['grass', 'grass_flat', 'flowers', 'leaves', 'hedges', 'flora', 'trunks', 'rocks', 'water', 'ponds', 'paving',
                    'stone', 'stone_big', 'metal', 'paint', 'wood', 'glow', 'crystal'])
    for idx, isl in enumerate(islands):
        top = K.top_material(f"top_{isl['key']}", pm_path, B.W, B.H, PARK, z_top=isl['z'])
        ob, dist, under, ring, nrm = K.build_island(B, isl['ids'] or ['islet'], isl['mask'], f"island_{idx}_{isl['key']}", top, z=isl['z'],
                                                     depth_k=1.0 if isl['theme'] == 'park' else 0.8)
        isl.update(dist=dist, under=under, ring=ring, nrm=nrm)
        scatter(isl, pm, G, BP)

    gardens(islands, G, BP, pm)

    for (sx, sy, g) in SHRINES:
        L = G.local()
        terrain.shrine_platform(L['paving'], L['metal'], L['glow'], L['crystal'], sx, sy, random.Random(int(sx) * 7 + int(sy)))
        G.merge(L, 0.0)

    built_mats = dict(grass=grass_m, grass_flat=flat_m, flowers=flower_m, leaves=leaf_m, hedges=hedge_m, flora=flora_m, trunks=wood_m, rocks=rock_m,
                      water=lib.falls_material('spray', 1.4, 0.0), ponds=pool_material(), paving=terrain.paving_material())
    for k, mb in G.items():
        mb.build(f'terrain_{k}', built_mats.get(k) or mats[k], smooth=k not in ('grass', 'grass_flat', 'crystal', 'stone', 'stone_big', 'paint'))

    terrain_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    built = {}
    for lm in LANDMARKS:
        k = lm['kind']
        if k == 'hall':
            obs = BP.domed_hall(lm['x'], lm['y'], lm['s'])
        elif k == 'obelisk':
            obs = BP.obelisk(lm['x'], lm['y'], lm['s'])
        elif k == 'mansion':
            obs = BP.mansion(lm['x'], lm['y'], lm['s'])
        elif k == 'gate':
            obs = BP.garden_gate(lm['x'], lm['y'], lm['s'])
        elif k == 'arbor':
            obs = BP.rose_arbor(lm['x'], lm['y'], lm['s'])
        elif k == 'stage':
            obs = BP.bandstand(lm['x'], lm['y'], lm['s'])
        elif k == 'bunting':
            obs = props.bunting(lm['x'], lm['y'], lm['width'], lm['s'])
        elif k == 'lamp':
            obs = BP.lamp_post_sprite(lm['x'], lm['y'], lm['s'])
        else:
            obs = props.pedestal(lm['x'], lm['y'], lm['s'])
        for o in obs:
            lib.shadow_only(o)
        built[lm['id']] = (lm, obs)
    bpy.context.view_layer.update()

    frame = frame_of(islands)
    print('frame', frame, flush=True)
    lib.camera_for_region(*frame, scale=SCALE)
    if A.dry:
        tv = sum(len(o.data.vertices) for o in bpy.context.scene.objects if o.type == 'MESH')
        print('dry run: objects', len(bpy.context.scene.objects), 'vertices', tv, 'sprites', len(built), flush=True)
        return
    if A.crop:
        x0, y0, x1, y1 = [float(v) for v in A.crop.split(',')]
        lib.set_border((x0, y0, x1, y1), frame)
        lib.render_to(os.path.join(out, 'crop.png'))
        K.crisp(os.path.join(out, 'crop.png'))
        return
    png = os.path.join(out, 'terrain.png')
    if not A.props_only:
        lib.render_to(png)
        K.crisp(png)
        if A.export:
            K.export_tiles(png, B.id, frame, SCALE)
    if A.export or A.props_only:
        K.render_props(B.id, built, terrain_objs, frame, SCALE, out, only={t for t in A.only.split(',') if t})
    print('islands', len(islands), flush=True)


def pool_material():
    """Still, clear water that mirrors the sky: deep blue centre, lighter rim, fine ripples, glossy."""
    m = lib.NT('pool')
    pos = m.position()
    nz = m.noise(1.2, 3, 0.5, pos)
    c = m.mix(m.maprange(nz.outputs['Fac'], 0.35, 0.65), lib.col('#2b8fc7'), lib.col('#58bde6'))
    wv = m.node('ShaderNodeTexWave')
    wv.wave_type = 'BANDS'
    wv.bands_direction = 'X'
    wv.inputs['Scale'].default_value = 6.0
    wv.inputs['Distortion'].default_value = 3.0
    m.link(pos, wv.inputs['Vector'])
    ripple = m.maprange(wv.outputs['Fac'], 0.92, 0.99)
    c = m.mix(m.math('MULTIPLY', ripple, 0.35), c, lib.col('#d4f4ff'))
    m.bsdf(c, 0.05, emission=c, emission_strength=0.16, coat=1.0)
    return m.mat


def scatter(isl, pm, G, BP):
    mask, dist, z = isl['mask'], isl['dist'], isl['z']
    L = G.local()
    import zlib
    rnd = random.Random(zlib.crc32(isl['key'].encode()))
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return
    area = len(xs) * K.GRID * K.GRID

    def pick(min_edge=0, max_edge=1e9, path_clear=0.05, node_r=0, pad=30):
        for _ in range(40):
            j = rnd.randrange(len(xs))
            bx = xs[j] * K.GRID + rnd.uniform(0, K.GRID)
            by = ys[j] * K.GRID + rnd.uniform(0, K.GRID)
            dd = K.dist_in(dist, bx, by)
            if dd < min_edge or dd > max_edge or K.pmask_at(pm, bx, by) > path_clear or (node_r and near_node(bx, by, node_r)):
                continue
            if near_landmark(bx, by, pad):
                continue
            return bx, by
        return None

    n_trees = int(area / 60000 * (0.75 if isl['theme'] == 'park' else 1.4)) + (1 if isl['theme'] == 'islet' else 0)
    for _ in range(n_trees * 5):
        if n_trees <= 0:
            break
        pt = pick(min_edge=30, path_clear=0.0, node_r=110)
        if not pt:
            continue
        bx, by = pt
        if not canopy_clear(bx, by, 95, 250):
            continue
        r2 = random.Random(int(bx) * 31 + int(by))
        roll = r2.random()
        if roll < 0.2:
            BP.cypress(L, bx, by, r2, 1.0)
        elif roll < 0.42:
            terrain.tree_blossom(L['flora'], L['trunks'], bx, by, r2, r2.uniform(1.0, 1.2), pal=('#e0679a', '#ffc6de'))
        else:
            terrain.tree_round(L['leaves'], L['trunks'], bx, by, r2, r2.uniform(0.85, 1.1), crown=True)
        n_trees -= 1
    # a trimmed lawn: few, short tufts; flower beds and bushes
    for _ in range(int(area / (60 * 60))):
        j = rnd.randrange(len(xs))
        bx = xs[j] * K.GRID + rnd.uniform(0, K.GRID)
        by = ys[j] * K.GRID + rnd.uniform(0, K.GRID)
        if K.dist_in(dist, bx, by) < 6 or K.pmask_at(pm, bx, by) > 0.2 or near_landmark(bx, by, 0):
            continue
        terrain.grass_tuft(L['grass'], bx, by, rnd, rnd.uniform(0.55, 0.8))
    for _ in range(int(area / 20000 * 0.55)):
        pt = pick(min_edge=24, path_clear=0.02, node_r=85)
        if pt:
            terrain.flower_bed(L['flowers'], L['leaves'], *pt, rnd)
    for _ in range(int(area / 16000 * 0.22)):
        pt = pick(min_edge=14, max_edge=140, path_clear=0.01, node_r=95)
        if pt and canopy_clear(pt[0], pt[1], 40, 60):
            terrain.bush(L['leaves'], *pt, rnd, rnd.uniform(0.7, 1.05), berries=L['flowers'])
    for _ in range(int(area / 90000)):
        pt = pick(path_clear=0.08, node_r=80)
        if pt:
            terrain.rock(L['rocks'], *pt, rnd, rnd.uniform(0.7, 1.1))
    ring, nrm = isl['ring'], isl['nrm']
    for k in range(0, len(ring), 3):
        if nrm[k][1] < 0.35 or rnd.random() < 0.55:
            continue
        bx, by = ring[k] + nrm[k] * 3
        w = lib.board_to_world(bx, by, -0.12)
        terrain.vine(L['leaves'], (w.x, w.y, w.z), (nrm[k][0], -nrm[k][1]), rnd, rnd.uniform(0.3, 1.0))
    G.merge(L, z)


def gardens(islands, G, BP, pm):
    """The park's set pieces: the reflecting pool, the fountain, the court and the green (mirrored),
    the rose beds, hedges, the cherry avenue, lamps, benches and a picnic by Mimi."""
    rnd = random.Random(1789)
    park = next(isl for isl in islands if isl['theme'] == 'park')
    BP.reflecting_pool(G, *POOL)
    BP.fountain(G, FOUNTAIN[0], FOUNTAIN[1], 1.0)
    BP.court(G, COURT[0], COURT[1], 1.0)
    BP.putting_green(G, GREEN[0], GREEN[1], 1.0)
    # the same low hedge frames both, mirrored across the centre line
    for (cx, flip) in ((COURT[0], 1), (GREEN[0], -1)):
        cy = COURT[1]
        for (ax, ay, bx2, by2) in [(-150, -85, 150, -85), (-160, -75, -160, 75)]:
            BP.hedge(G, cx + ax * flip, cy + ay, cx + bx2 * flip, cy + by2, h=0.16, w=0.14)
        BP.bench(G, cx - 20 * flip, cy - 108, 1.0)
    # cherry avenue: blossom trees down both sides of the walk
    for y in (1880, 1715, 1550, 1385):
        for x in (AXIS - 122, AXIS + 122):
            if near_node(x, y, 80) or K.pmask_at(pm, x, y) > 0.02:
                continue
            r2 = random.Random(x * 13 + y)
            terrain.tree_blossom(G['flora'], G['trunks'], x, y, r2, 1.12, pal=('#e0679a', '#ffc6de'))
    # blossom trees at both ends of the pool
    for (x, y) in ((POOL[0] - 70, (POOL[1] + POOL[3]) / 2 - 10), (POOL[2] + 30, POOL[1] - 20)):
        if not near_node(x, y, 100):
            r2 = random.Random(int(x) * 7 + int(y))
            terrain.tree_blossom(G['flora'], G['trunks'], x, y, r2, 1.2, pal=('#e0679a', '#ffc6de'))
    # rose garden beds inside the rose loop
    for (x, y, rx, ry, n) in [(880, 1862, 62, 26, 14), (935, 1745, 50, 22, 10), (1215, 1880, 46, 20, 9)]:
        if near_node(x, y, 70):
            continue
        BP.rose_bed(G, x, y, rnd, rx, ry, n)
    # hedged flower beds on the lawns (mirrored pairs either side of the avenue)
    for (dx, y) in ((330, 1480), (560, 1700), (430, 1260)):
        for side in (-1, 1):
            x = AXIS + side * dx
            if near_node(x, y, 95) or K.pmask_at(pm, x, y) > 0.02 or near_landmark(x, y, 10):
                continue
            BP.rose_bed(G, x, y, rnd, 55, 22, 8)
    # park lamps along the promenade (behind the path, between the spaces) and benches
    for k in range(4):
        x = 1360 + k * 352
        if not near_node(x, 1060, 60) and not near_landmark(x, 1060, 0):
            BP.lamp(G, *tuple(lib.board_to_world(x, 1058, 0.0))[:2], 1.0)
    for (x, y) in ((1540, 1240), (2060, 1240), (1450, 2175), (2200, 2170)):
        if not near_node(x, y, 80) and K.pmask_at(pm, x, y) < 0.02:
            BP.bench(G, x, y, 1.0)
    # a picnic blanket (festival colours) and a basket by Mimi
    c = lib.board_to_world(MIMI[0] + 42, MIMI[1] + 52, 0.0)
    for i in range(4):
        for j in range(3):
            v, f = lib.box((c.x - 0.3 + i * 0.2, c.y - 0.2 + j * 0.2, 0.012), (0.2, 0.2, 0.012))
            G['paint'].add(v, f, col(['#ff6b5e', '#fff4dc'][(i + j) % 2]))
    v, f = lib.box((c.x + 0.2, c.y + 0.05, 0.08), (0.2, 0.14, 0.14))
    G['wood'].add(v, f, col('#b07a45'))
    # the islets: a little round garden temple on one, cypresses on another
    for isl in islands:
        if isl['theme'] != 'islet':
            continue
        yy, xx = np.nonzero(isl['mask'])
        cx, cy = xx.mean() * K.GRID, yy.mean() * K.GRID
        L = G.local()
        if isl['key'] == 'islet1':
            temple(L, cx, cy)
        else:
            r2 = random.Random(int(cx))
            BP.cypress(L, cx - 25, cy - 10, r2, 0.9)
            BP.cypress(L, cx + 25, cy - 4, r2, 0.8)
        G.merge(L, isl['z'])


def temple(B, bx, by, s=0.9):
    """A little round garden temple: a ring of columns under a shallow dome."""
    import board_props as BP
    p = lib.board_to_world(bx, by, 0.0)
    v, f = lib.lathe([(0.52 * s, 0.0), (0.52 * s, 0.12 * s), (0.0, 0.12 * s)], 28, (p.x, p.y, 0))
    B['stone'].add(v, f, col('#ebe6dc'))
    for k in range(8):
        a = k / 8 * math.tau
        BP.column(B['paint'], p.x + math.cos(a) * 0.4 * s, p.y + math.sin(a) * 0.4 * s, 0.12 * s, 0.8 * s, 0.045 * s, sides=8)
    v, f = lib.lathe([(0.5 * s, 0.92 * s), (0.5 * s, 0.98 * s), (0.0, 0.98 * s)], 28, (p.x, p.y, 0))
    B['paint'].add(v, f, col('#ffffff'))
    prof = [(0.46 * s * math.cos(t), 0.98 * s + 0.3 * s * math.sin(t)) for t in [i / 8 * math.pi / 2 for i in range(9)]]
    prof[-1] = (0.0, prof[-1][1])
    v, f = lib.lathe(prof, 28, (p.x, p.y, 0), cap_bottom=False, cap_top=False)
    B['paint'].add(v, f, col('#eef0f2'))


if __name__ == '__main__':
    main()
