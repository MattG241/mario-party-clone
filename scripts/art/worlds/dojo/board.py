"""Dojo Summit board diorama: misty mountain peaks above a sea of clouds, joined by stone stairs, cloud
steps and a rope bridge (the bridge itself is drawn by the game).

    <bpyenv>/bin/python scripts/art/worlds/dojo/board.py --plan        (island plan, no render)
    <bpyenv>/bin/python scripts/art/worlds/dojo/board.py --preview     (quarter-size look)
    <bpyenv>/bin/python scripts/art/worlds/dojo/board.py --export      (full render: tiles, sprites, shadow)

Board data comes from scripts/art/worlds/dojo/board.json:
    node scripts/art/worlds/export-world-board.mjs dojo > scripts/art/worlds/dojo/board.json
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

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
    p.add_argument('--out', default=os.path.join(lib.ROOT, 'art-out', 'dojo'))
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
lib.seeded(11)

# ------------------------------------------------------------------------------------------
# Heights: each island (named by one of its spaces) sits at its own level; the summit is highest.
ISLAND_Z = {'s0': 0.0, 'v0': 0.1, 'f0': 0.38, 'd0': 0.9, 't0': 0.78, 'g0': 0.42, 'i2': -0.28, 'h0': 0.12, 'c1': 0.42,
            'bd0': 0.5, 'bd1': 0.4, 'bd2': 0.55, 'i0': 0.26, 'i1': 0.04, 'i5': -0.12, 'c6': 0.66}
THEME = {'s0': 'gate', 'v0': 'village', 'f0': 'falls', 'd0': 'summit', 't0': 'ring', 'g0': 'boulders', 'i2': 'isle', 'h0': 'terrace', 'c1': 'peak'}
DECK = 0.95  # the rooftop run's decks, above the village streets
ROOFTOP = ['r0', 'r1', 'r2']
DECK_EDGES = {('v0', 'r0'), ('r0', 'r1'), ('r1', 'r2'), ('r2', 'v1')}
CLOUD_EDGES = {('g0', 'i0'), ('i0', 'i1'), ('i1', 'i2'), ('i4', 'i5'), ('i5', 'h2'), ('d5', 'bd0'), ('bd0', 'bd1'), ('bd1', 'bd2'), ('bd2', 't0')}

# Landmarks: sprites (depth-sorted in game) and the island discs they need. `tex` names the placeholder
# decoration each replaces (the board switches to the rendered set wholesale anyway).
PAGODA = (1470, 468)
RING = (2930, 588)
FALLS_POOL = (505, 1075)
FALLS_DROP = 2.1
HUT = (2835, 1505)
PALM = (2495, 1418)
MIMI = (2020, 1500)
STAGE = (1990, 1946)
LANDMARKS = [
    dict(id='pagoda', kind='pagoda', x=PAGODA[0], y=PAGODA[1], s=1.28, tex='observatory'),
    dict(id='gate', kind='gate', x=1722, y=2012, s=1.0, tex='prism-gate'),
    dict(id='noodle-stall', kind='stall', x=975, y=1972, s=0.95, tex='stall'),
    dict(id='hut', kind='hut', x=HUT[0], y=HUT[1], s=1.1, tex='workshop'),
    dict(id='palm', kind='palm', x=PALM[0], y=PALM[1], s=1.0, tex=''),
    dict(id='stage', kind='stage', x=STAGE[0], y=STAGE[1], s=1.0, tex='', depth_y=STAGE[1] - 70),
    dict(id='bunting-ring', kind='bunting', x=RING[0], y=RING[1] - 172, s=1.35, width=380, tex='bunting'),
    dict(id='bunting-gate', kind='bunting', x=2060, y=1962, s=1.1, width=150, tex=''),
    dict(id='lantern-summit-w', kind='lantern', x=1290, y=560, s=1.0, tex='lantern', style='stone'),
    dict(id='lantern-summit-e', kind='lantern', x=1655, y=548, s=1.0, tex='lantern', style='stone'),
    dict(id='lantern-gate-w', kind='lantern', x=1555, y=2020, s=1.0, tex='lantern', style='stone'),
    dict(id='lantern-gate-e', kind='lantern', x=2175, y=1990, s=1.0, tex='lantern', style='stone'),
    dict(id='lantern-peak', kind='lantern', x=1705, y=1540, s=0.95, tex='lantern', style='stone'),
    dict(id='lantern-ring-w', kind='lantern', x=2665, y=585, s=1.0, tex='lantern', style='paper'),
    dict(id='lantern-ring-e', kind='lantern', x=3190, y=770, s=1.0, tex='lantern', style='paper'),
    dict(id='lantern-village', kind='lantern', x=1080, y=1965, s=1.0, tex='lantern', style='paper'),
    dict(id='lantern-village-2', kind='lantern', x=640, y=1985, s=1.0, tex='lantern', style='paper'),
    dict(id='lantern-falls', kind='lantern', x=600, y=1345, s=0.95, tex='lantern', style='stone'),
    dict(id='lantern-terrace', kind='lantern', x=2700, y=1760, s=0.95, tex='lantern', style='stone'),
    dict(id='lantern-boulders', kind='lantern', x=3375, y=1105, s=0.95, tex='lantern', style='paper'),
]
RELIC_GATES = B.data['relicGates']
SHRINES = []
for _g in RELIC_GATES:
    SHRINES.append((N[_g]['x'], N[_g]['y'] - 40, _g))
    LANDMARKS.append(dict(id=f'pedestal-{_g}', kind='pedestal', x=N[_g]['x'], y=N[_g]['y'] - 85, s=1.0, tex='relic-pedestal'))

# Discs that grow an island under landmarks and dressed corners (each joins the island of the nearest space).
DISCS = [
    (PAGODA[0], PAGODA[1] - 20, 225), (PAGODA[0] - 220, PAGODA[1] + 60, 150), (PAGODA[0] + 220, PAGODA[1] + 60, 150),
    (RING[0], RING[1] - 10, 235), (RING[0] - 180, RING[1] + 60, 140), (RING[0] + 190, RING[1] + 80, 140),
    (FALLS_POOL[0] - 40, FALLS_POOL[1] - 70, 150), (FALLS_POOL[0] + 20, FALLS_POOL[1] + 30, 115),
    (900, 1860, 160), (1180, 1760, 120),
    (HUT[0], HUT[1] - 10, 140), (PALM[0], PALM[1], 95), (2700, 1560, 120),
    (MIMI[0] + 40, MIMI[1] - 30, 150), (1960, 1320, 110),
    (3090, 1360, 165), (3140, 1560, 120),
    (STAGE[0], STAGE[1] - 20, 120), (2060, 1870, 110),
    (2640, 1790, 110), (2860, 1840, 110),
]
# Decorative islets with no spaces: (discs, z, seed)
ISLETS = [
    ([(1270, 1170, 105), (1345, 1125, 70)], 0.2, 1),
    ([(1455, 1420, 72)], -0.35, 2),
    ([(2235, 1260, 88)], -0.5, 3),
    ([(3470, 690, 84)], 0.3, 4),
    ([(360, 1720, 78)], -0.2, 5),
    ([(1150, 860, 70)], 0.55, 6),
]

PATH_PTS = B.path_points()


def canopy_clear(bx, by, width, height):
    """No trail or space in the screen area a tall object at (bx, by) would cover."""
    m = (np.abs(PATH_PTS[:, 0] - bx) < width) & (PATH_PTS[:, 1] < by + 22) & (PATH_PTS[:, 1] > by - height)
    return not m.any()


def near_landmark(bx, by, pad=0.0):
    for lm in LANDMARKS:
        rr = {'pagoda': 175, 'stall': 95, 'hut': 90, 'palm': 50, 'stage': 105, 'bunting': 0, 'lantern': 34, 'pedestal': 40, 'gate': 120}.get(lm['kind'], 60)
        if lm['kind'] == 'bunting':
            half = lm.get('width', 240) / 2
            if any((bx - px) ** 2 + (by - lm['y']) ** 2 < (30 + pad) ** 2 for px in (lm['x'] - half, lm['x'] + half)):
                return True
            continue
        if (bx - lm['x']) ** 2 + (by - lm['y']) ** 2 < (rr + pad) ** 2:
            return True
    for (sx, sy, _) in SHRINES:
        if ((bx - sx) / (95 + pad)) ** 2 + ((by - sy) / (70 + pad)) ** 2 < 1.0:
            return True
    # the ring, the falls pool/cliff, Mimi's garden
    if abs(bx - RING[0]) < 190 + pad and abs(by - RING[1]) < 110 + pad:
        return True
    if (bx - FALLS_POOL[0]) ** 2 + (by - FALLS_POOL[1] + 60) ** 2 < (130 + pad) ** 2:
        return True
    if (bx - MIMI[0]) ** 2 + (by - MIMI[1]) ** 2 < (70 + pad) ** 2:
        return True
    return False


def near_node(bx, by, r):
    return any((bx - n['x']) ** 2 + (by - n['y']) ** 2 < r * r for n in N.values())


# ------------------------------------------------------------------------------------------
def island_key(ids):
    for k in ISLAND_Z:
        if k in ids:
            return k
    return ids[0]


def plan_islands():
    comps = B.components()
    owner = {}
    for (cx, cy, r) in DISCS:
        nearest = min(N.values(), key=lambda n: math.hypot(cx - n['x'], cy - n['y']))
        owner.setdefault(nearest['id'], []).append((cx, cy, r))
    items = []
    for ids in comps:
        discs = [d for i in ids for d in owner.get(i, [])]
        items.append((ids, K.island_mask(B, ids, discs=discs, node_r=118, lobe_d=(40, 85), lobe_r=(55, 90))))
    for k, (discs, z, seed) in enumerate(ISLETS):
        items.append(([], K.disc_mask(B, discs, lobes=2, seed=seed)))
    # every crossing between islands (stairs, cloud steps, the bridge) gets a chasm of its own
    cross = [(e['from'], e['to']) for e in B.edges if edge_kind(e) in ('stairs', 'clouds', 'bridge')]
    items = K.carve_crossings(B, items, cross, keep_r=68, width=115)
    merged = K.separate(B, items, gap_px=20, min_clear=46)
    out = []
    islet_i = 0
    for ids, m in merged:
        if ids:
            key = island_key(ids)
            out.append(dict(ids=ids, mask=m, key=key, z=ISLAND_Z.get(key, 0.0), theme=THEME.get(key, 'islet')))
        else:
            z = ISLETS[islet_i][1] if islet_i < len(ISLETS) else 0.0
            islet_i += 1
            out.append(dict(ids=[], mask=m, key=f'islet{islet_i}', z=z, theme='islet'))
    return out


def node_z(i, islands):
    if i in ROOFTOP:
        return ISLAND_Z['v0'] + DECK
    for isl in islands:
        if i in isl['ids']:
            return isl['z']
    return 0.0


def edge_kind(e):
    pair = (e['from'], e['to'])
    if pair in DECK_EDGES:
        return 'deck'
    if pair in CLOUD_EDGES:
        return 'clouds'
    if e['style'] == 'bridge':
        return 'bridge'
    if e['style'] == 'steps':
        return 'stairs'
    return 'path'


def frame_of(islands):
    ys, xs = [], []
    for isl in islands:
        yy, xx = np.nonzero(isl['mask'])
        xs += [xx.min() * K.GRID, xx.max() * K.GRID]
        ys += [yy.min() * K.GRID, yy.max() * K.GRID]
    x0, x1 = min(xs) - 90, max(xs) + 90
    y0, y1 = min(ys) - 330, max(ys) + 470
    return (int(x0), int(y0), int(x1 - x0), int(y1 - y0))


def plan_map(islands):
    k = 0.25
    img = Image.new('RGB', (int(B.W * k), int(B.H * k)), (46, 60, 88))
    px = np.asarray(img).copy()
    palette = [(96, 150, 90), (120, 170, 100), (90, 140, 120), (140, 160, 90), (110, 130, 150)]
    for i, isl in enumerate(islands):
        m = np.asarray(Image.fromarray(isl['mask'].astype(np.uint8) * 255).resize(img.size, Image.NEAREST)) > 127
        px[m] = palette[i % len(palette)]
    img = Image.fromarray(px)
    d = ImageDraw.Draw(img)
    for e in B.edges:
        a, b = N[e['from']], N[e['to']]
        kind = edge_kind(e)
        c = {'path': (240, 220, 170), 'stairs': (200, 200, 210), 'clouds': (250, 250, 255), 'deck': (180, 120, 60), 'bridge': (150, 90, 40)}[kind]
        d.line([(a['x'] * k, a['y'] * k), (b['x'] * k, b['y'] * k)], fill=c, width=2)
    for n in N.values():
        d.ellipse([n['x'] * k - 3, n['y'] * k - 3, n['x'] * k + 3, n['y'] * k + 3], fill=(230, 40, 40))
    for lm in LANDMARKS:
        d.rectangle([lm['x'] * k - 3, lm['y'] * k - 3, lm['x'] * k + 3, lm['y'] * k + 3], outline=(255, 230, 0))
        d.text((lm['x'] * k + 4, lm['y'] * k - 4), lm['id'][:10], fill=(255, 240, 120))
    for isl in islands:
        yy, xx = np.nonzero(isl['mask'])
        d.text((xx.mean() * K.GRID * k, yy.mean() * K.GRID * k), f"{isl['key']} z{isl['z']}", fill=(255, 255, 255))
    d.ellipse([MIMI[0] * k - 5, MIMI[1] * k - 5, MIMI[0] * k + 5, MIMI[1] * k + 5], outline=(255, 0, 255), width=2)
    fx, fy, fw, fh = frame_of(islands)
    d.rectangle([fx * k, fy * k, (fx + fw) * k, (fy + fh) * k], outline=(255, 255, 255))
    os.makedirs(A.out, exist_ok=True)
    img.save(os.path.join(A.out, 'plan.png'))
    print('plan', os.path.join(A.out, 'plan.png'), 'frame', (fx, fy, fw, fh), 'islands', len(islands))


# ------------------------------------------------------------------------------------------
PALETTES = {
    'base': dict(grass=[(0.28, '#2b6a2c'), (0.42, '#3a8332'), (0.55, '#4f9c3b'), (0.68, '#6cb14b'), (0.82, '#94c85f')],
                 trail=[(0.3, '#b38c61'), (0.5, '#c8a476'), (0.7, '#dcc095')],
                 rock=[(0.25, '#5b585e'), (0.4, '#77716e'), (0.55, '#938a82'), (0.7, '#6b6973'), (0.85, '#8f8c97')],
                 soil=('#5e4630', '#7a5a3a'), flowers=0.8, moss=0.55, crack='#4f4c50', rock_tint='#5c6286'),
}
PALETTES['gate'] = dict(PALETTES['base'], trail=[(0.3, '#cfc6b6'), (0.5, '#ddd5c6'), (0.7, '#ebe4d6')], paving=0.85, edge='#e8e0d0', flowers=1.1)
PALETTES['summit'] = dict(PALETTES['base'], trail=[(0.3, '#c9c0b0'), (0.5, '#d8d0c0'), (0.7, '#e6dfd1')], paving=0.8, edge='#e2dacb')
PALETTES['ring'] = dict(PALETTES['base'], grass=[(0.28, '#35702e'), (0.42, '#468a36'), (0.55, '#5ea343'), (0.68, '#7cb853'), (0.82, '#a1cc66')])
PALETTES['village'] = dict(PALETTES['base'], trail=[(0.3, '#aa8a66'), (0.5, '#bf9f7a'), (0.7, '#d2b894')], flowers=0.6)
PALETTES['isle'] = dict(PALETTES['base'], grass=[(0.3, '#cdb27a'), (0.5, '#dcc38d'), (0.7, '#e8d3a2'), (0.85, '#f1e0b5')],
                        trail=[(0.3, '#c0a06a'), (0.5, '#cfb07a'), (0.7, '#dcc08e')], flowers=0.0, moss=0.2, edge='#f4e6c2')
PALETTES['terrace'] = dict(PALETTES['base'], flowers=1.3)
PALETTES['peak'] = dict(PALETTES['base'], trail=[(0.3, '#c9c0b0'), (0.5, '#d8d0c0'), (0.7, '#e6dfd1')], paving=0.75, edge='#e2dacb', flowers=1.0)
PALETTES['islet'] = dict(PALETTES['base'])


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
    # misty mountain light: a cool, bright sky fill and a warm, high key light
    lib.world_light(0.86, zenith='#a9d4ff', horizon='#fff0dc', ground='#aab4c8')
    lib.sun(energy=3.5, elevation=50, azimuth=-35, angle=3.5, color='#fff0d8')
    out = A.out
    os.makedirs(out, exist_ok=True)
    zof = {i: node_z(i, islands) for i in N}

    # trails: dirt (or paving) on every 'path' edge except the rooftop decks; a stone plaza at the gate
    path_edges = [e for e in B.edges if edge_kind(e) == 'path']
    pm_path, pm = K.path_mask(B, out, path_edges, extra=[(1800, 2105, 190, 70), (1470, 575, 150, 55)])

    mats = props.mats()
    grass_m = terrain.scatter_mat('grass', rough=0.8, sheen=0.15, ao=0.3)
    flower_m = terrain.scatter_mat('flower', rough=0.55, sheen=0.3)
    leaf_m = terrain.leaf_material('leaf', ao=0.5)
    flora_m = terrain.leaf_material('flora', ao=0.5, sun='#fff6f0', shade='#8a3a5a', gaps='#c298a8', ao_tint='#6d3a52')
    wood_m = terrain.scatter_mat('trunks', rough=0.8, ao=0.3)
    rock_m = terrain.scatter_mat('rock', rough=0.85, ao=0.4)
    cane_m = terrain.scatter_mat('cane', rough=0.5, sheen=0.1, ao=0.3)
    cloud_m = K.cloud_material()
    water_m = lib.falls_material('falls', 0.0, -3.0)
    pond_m = pond_material()
    G = K.Builders(['grass', 'flowers', 'leaves', 'flora', 'trunks', 'rocks', 'clouds', 'water', 'ponds', 'leaf_plain', 'paving',
                    'stone', 'stone_big', 'metal', 'paint', 'wood', 'glow', 'crystal'])
    top_mats = {}
    island_objs = []
    for idx, isl in enumerate(islands):
        key = (isl['theme'], round(isl['z'], 3))
        if key not in top_mats:
            top_mats[key] = K.top_material(f"top_{isl['theme']}_{idx}", pm_path, B.W, B.H, PALETTES.get(isl['theme'], PALETTES['base']), z_top=isl['z'])
        dk = {'summit': 1.35, 'ring': 1.25, 'falls': 1.2, 'peak': 1.25, 'boulders': 1.15, 'isle': 0.7, 'islet': 0.9}.get(isl['theme'], 1.0)
        ob, dist, under, ring, nrm = K.build_island(B, isl['ids'] or ['islet'], isl['mask'], f"island_{idx}_{isl['key']}", top_mats[key], z=isl['z'],
                                                     depth_k=dk, crag=0.34, rock_disp=0.26)
        isl.update(dist=dist, under=under, ring=ring, nrm=nrm)
        island_objs.append(ob)
        scatter(isl, pm, G, BP)

    crossings(islands, zof, G, BP)
    structures(islands, zof, G, BP, pm)
    clouds(islands, G)

    for (sx, sy, g) in SHRINES:
        z = zof[g]
        L = G.local()
        terrain.shrine_platform(L['paving'], L['metal'], L['glow'], L['crystal'], sx, sy, random.Random(int(sx) * 7 + int(sy)))
        G.merge(L, z)

    built_mats = dict(grass=grass_m, flowers=flower_m, leaves=leaf_m, flora=flora_m, trunks=wood_m, rocks=rock_m, clouds=cloud_m,
                      water=water_m, ponds=pond_m, leaf_plain=cane_m, paving=terrain.paving_material())
    for k, mb in G.items():
        m = built_mats.get(k) or mats[k]
        mb.build(f'terrain_{k}', m, smooth=k not in ('grass', 'crystal', 'stone', 'stone_big', 'paint'))

    # landmarks: cast shadows into the terrain, rendered afterwards as sprites
    terrain_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    built = {}
    for lm in LANDMARKS:
        z = landmark_z(lm, islands)
        k = lm['kind']
        if k == 'pagoda':
            obs = BP.pagoda(lm['x'], lm['y'], lm['s'])
        elif k == 'gate':
            obs = BP.shrine_gate(lm['x'], lm['y'], lm['s'])
        elif k == 'stall':
            obs = BP.noodle_stall(lm['x'], lm['y'], lm['s'])
        elif k == 'hut':
            obs = BP.cottage(lm['x'], lm['y'], lm['s'])
        elif k == 'palm':
            obs = BP.palm(lm['x'], lm['y'], lm['s'])
        elif k == 'stage':
            obs = props.stage(lm['x'], lm['y'], lm['s'])
        elif k == 'bunting':
            obs = BP.bunting(lm['x'], lm['y'], lm['width'], lm['s'])
        elif k == 'lantern':
            obs = BP.stone_lantern(lm['x'], lm['y'], lm['s']) if lm.get('style') == 'stone' else BP.paper_lantern_post(lm['x'], lm['y'], lm['s'])
        else:
            obs = props.pedestal(lm['x'], lm['y'], lm['s'])
        t = K.lift(z)
        for o in obs:
            o.location = (o.location[0] + t.x, o.location[1] + t.y, o.location[2] + t.z)
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


def landmark_z(lm, islands):
    for isl in islands:
        if K.inside(isl['mask'], lm['x'], lm['y']):
            return isl['z']
    nearest = min(N.values(), key=lambda n: math.hypot(lm['x'] - n['x'], lm['y'] - n['y']))
    for isl in islands:
        if nearest['id'] in isl['ids']:
            return isl['z']
    return 0.0


def pond_material():
    """Calm stylised water (board.py's pond look)."""
    m = lib.NT('pond')
    pos = m.position()
    nz = m.noise(1.6, 3, 0.5, pos)
    c = m.mix(m.maprange(nz.outputs['Fac'], 0.35, 0.65), lib.col('#2a94c8'), lib.col('#49b7e2'))
    wv = m.node('ShaderNodeTexWave')
    wv.wave_type = 'BANDS'
    wv.bands_direction = 'X'
    wv.inputs['Scale'].default_value = 5.0
    wv.inputs['Distortion'].default_value = 4.0
    wv.inputs['Detail'].default_value = 2.0
    m.link(pos, wv.inputs['Vector'])
    ripple = m.maprange(wv.outputs['Fac'], 0.9, 0.985)
    c = m.mix(m.math('MULTIPLY', ripple, 0.4), c, lib.col('#bff0ff'))
    m.bsdf(c, 0.06, emission=c, emission_strength=0.14, coat=1.0)
    return m.mat


# ------------------------------------------------------------------------------------------
def scatter(isl, pm, G, BP):
    """Trees, grass, flowers, rocks and region clutter on one island (built at z = 0, then lifted)."""
    mask, dist, theme, z = isl['mask'], isl['dist'], isl['theme'], isl['z']
    L = G.local()
    rnd = random.Random(zlib_hash(isl['key']))
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return
    area = len(xs) * K.GRID * K.GRID

    def pick(min_edge=0, max_edge=1e9, path_clear=0.05, node_r=0, tries=40):
        for _ in range(tries):
            j = rnd.randrange(len(xs))
            bx = xs[j] * K.GRID + rnd.uniform(0, K.GRID)
            by = ys[j] * K.GRID + rnd.uniform(0, K.GRID)
            dd = K.dist_in(dist, bx, by)
            if dd < min_edge or dd > max_edge or K.pmask_at(pm, bx, by) > path_clear or (node_r and near_node(bx, by, node_r)):
                continue
            if near_landmark(bx, by, 30) or deck_zone(bx, by):
                continue
            return bx, by
        return None

    dens = {'gate': (0.9, 'blossom'), 'village': (0.35, 'mixed'), 'falls': (1.6, 'pine'), 'summit': (1.1, 'pine'), 'ring': (1.0, 'pine'),
            'boulders': (0.8, 'pine'), 'isle': (0.0, ''), 'terrace': (1.1, 'plum'), 'peak': (1.2, 'blossom'), 'islet': (1.4, 'pine')}[theme]
    n_trees = int(area / 60000 * dens[0]) + (1 if theme == 'islet' else 0)
    for _ in range(n_trees * 5):
        if n_trees <= 0:
            break
        pt = pick(min_edge=24, path_clear=0.0, node_r=105)
        if not pt:
            continue
        bx, by = pt
        if not canopy_clear(bx, by, 95, 250):
            continue
        r2 = random.Random(int(bx) * 31 + int(by))
        kind = dens[1]
        roll = r2.random()
        if kind == 'pine' or (kind == 'mixed' and roll < 0.4):
            if roll < 0.18 and theme in ('summit', 'ring', 'falls', 'islet'):
                terrain.tree_maple(L['flora'], L['trunks'], bx, by, r2, 1.0)
            else:
                terrain.tree_pine(L['leaves'], L['trunks'], bx, by, r2, r2.uniform(0.85, 1.1))
        elif kind == 'blossom' or (kind == 'mixed' and roll < 0.7):
            if roll < 0.75:
                terrain.tree_blossom(L['flora'], L['trunks'], bx, by, r2, r2.uniform(1.0, 1.25), pal=('#e0679a', '#ffc6de'))
            else:
                terrain.tree_pine(L['leaves'], L['trunks'], bx, by, r2, 0.9)
        elif kind == 'plum':
            terrain.tree_blossom(L['flora'], L['trunks'], bx, by, r2, r2.uniform(0.9, 1.1), pal=('#e8a2c4', '#fff0f7') if roll < 0.6 else ('#d8587e', '#ffb8cf'))
        else:
            terrain.tree_round(L['leaves'], L['trunks'], bx, by, r2, r2.uniform(0.8, 1.0), crown=True)
        n_trees -= 1
    # grass tufts (not on the sandy isle), flowers, bushes, rocks
    tuft_n = int(area / (26 * 26)) if theme != 'isle' else int(area / (70 * 70))
    for _ in range(tuft_n):
        j = rnd.randrange(len(xs))
        bx = xs[j] * K.GRID + rnd.uniform(0, K.GRID)
        by = ys[j] * K.GRID + rnd.uniform(0, K.GRID)
        if K.dist_in(dist, bx, by) < 6 or K.pmask_at(pm, bx, by) > 0.3 or deck_zone(bx, by):
            continue
        terrain.grass_tuft(L['grass'], bx, by, rnd, rnd.uniform(0.8, 1.25))
    flowers = {'gate': 1.0, 'terrace': 1.4, 'peak': 0.9, 'village': 0.5, 'isle': 0.0}.get(theme, 0.5)
    for _ in range(int(area / 20000 * flowers * 0.6)):
        pt = pick(min_edge=20, path_clear=0.02, node_r=80)
        if pt:
            terrain.flower_bed(L['flowers'], L['leaves'], *pt, rnd)
    for _ in range(int(area / 16000 * (0.25 if theme != 'isle' else 0.12))):
        pt = pick(min_edge=12, max_edge=120, path_clear=0.01, node_r=92)
        if pt and canopy_clear(pt[0], pt[1], 40, 60):
            terrain.bush(L['leaves'], *pt, rnd, rnd.uniform(0.7, 1.1), berries=L['flowers'])
    rocks = {'falls': 1.6, 'summit': 1.2, 'ring': 1.0, 'boulders': 1.8, 'islet': 1.5, 'isle': 0.6}.get(theme, 0.7)
    for _ in range(int(area / 30000 * rocks)):
        pt = pick(path_clear=0.08, node_r=70)
        if pt:
            terrain.rock(L['rocks'], *pt, rnd, rnd.uniform(0.8, 1.5))
    for _ in range(int(area / 4200)):
        pt = pick(path_clear=1.1)
        if pt and 0.18 < K.pmask_at(pm, *pt) < 0.5:
            terrain.rock(L['rocks'], *pt, rnd, 0.35, moss=False)
    if theme in ('falls', 'village', 'peak'):
        for _ in range(int(area / 70000) + 1):
            pt = pick(min_edge=26, path_clear=0.0, node_r=110)
            if pt and canopy_clear(pt[0], pt[1], 60, 170):
                BP.bamboo_clump(L, pt[0], pt[1], rnd, 1.0)
    # vines on the camera-facing rim
    ring, nrm = isl['ring'], isl['nrm']
    for k in range(0, len(ring), 3):
        if nrm[k][1] < 0.35 or rnd.random() < 0.5:
            continue
        bx, by = ring[k] + nrm[k] * 3
        w = lib.board_to_world(bx, by, -0.12)
        terrain.vine(L['leaves'], (w.x, w.y, w.z), (nrm[k][0], -nrm[k][1]), rnd, rnd.uniform(0.3, 1.1 if len(isl['ids']) > 1 else 0.5))
    G.merge(L, z)


def zlib_hash(s):
    import zlib
    return zlib.crc32(s.encode())


def deck_zone(bx, by):
    """Ground under the rooftop run's houses (kept clear of scatter)."""
    for i in ROOFTOP:
        n = N[i]
        gx, gy = n['x'], n['y'] + DECK * lib.SINB * lib.PX
        if abs(bx - gx) < 85 and abs(by - gy) < 70:
            return True
    return False


# ------------------------------------------------------------------------------------------
def crossings(islands, zof, G, BP):
    masks = [isl['mask'] for isl in islands]
    rnd = random.Random(99)
    for e in B.edges:
        kind = edge_kind(e)
        a, b = e['from'], e['to']
        za, zb = zof[a], zof[b]
        if kind == 'stairs':
            span = K.gap_span(B, masks, a, b)
            if span is None:
                # no gap (touching islands): a short flight right over the seam
                span = (0.35, 0.65)
            K.stone_stairs(G['stone'], B, a, b, za, zb, span[0], span[1], rnd)
        elif kind == 'clouds':
            span = K.gap_span(B, masks, a, b) or (0.3, 0.7)
            na, nb = N[a], N[b]
            L = math.hypot(nb['x'] - na['x'], nb['y'] - na['y']) * (span[1] - span[0])
            n = max(1, int(L / 62))
            for k in range(n):
                u = (k + 0.5) / n
                t = span[0] + (span[1] - span[0]) * u
                bx = na['x'] + (nb['x'] - na['x']) * t
                by = na['y'] + (nb['y'] - na['y']) * t
                z = za + (zb - za) * u
                Lb = G.local()
                terrain.stepping_stone(Lb['rocks'], Lb['grass'], bx, by, rnd, r=0.2)
                K.cloud_puffs(Lb['clouds'], bx, by + 18, -0.55, rnd, r=0.26, count=4, spread=(0.3, 0.12))
                G.merge(Lb, z)
        elif kind == 'deck':
            span = (0.0, 1.0)
            if a in ROOFTOP and b in ROOFTOP:
                K.plank_walk(G['wood'], B, a, b, za, zb, 0.2, 0.8, width=0.46, posts_to=ISLAND_Z['v0'], rnd=rnd)
            else:
                # wooden stairs from the street up to the first deck / down from the last
                K.stone_stairs(G['wood'], B, a, b, za, zb, 0.25 if a in ROOFTOP else 0.3, 0.75 if a in ROOFTOP else 0.72, rnd,
                               width=0.46, tread=0.16, colour='#b07a45', edge='#6e4a2c')
        elif kind == 'bridge' and (a == 'd5' or b == 't0'):
            # anchor posts where the game's rope bridge meets the islands
            span = K.gap_span(B, masks, a, b)
            if span is None:
                continue
            na, nb = N[a], N[b]
            t = span[0] if a == 'd5' else span[1]
            z = za if a == 'd5' else zb
            bx = na['x'] + (nb['x'] - na['x']) * t
            by = na['y'] + (nb['y'] - na['y']) * t
            for side in (-1, 1):
                p = K.bw(bx, by + side * 30, z)
                v, f = lib.cylinder((p.x, p.y, z - 0.1), 0.07, 0.06, 0.62, 10)
                G['wood'].add(v, f, col('#6e4a2c'))
                v, f = lib.blob((p.x, p.y, z + 0.55), 0.075, rough=0.0, subdiv=1)
                G['metal'].add(v, f, col('#f2c14e'))
                v, f = lib.cylinder((p.x, p.y, z + 0.28), 0.085, 0.085, 0.08, 10)
                G['wood'].add(v, f, col('#d8b878'))


# ------------------------------------------------------------------------------------------
def structures(islands, zof, G, BP, pm):
    rnd = random.Random(2024)
    zv = ISLAND_Z['v0']
    # rooftop run: a house under every rooftop space, its flat terrace at deck height
    for i in ROOFTOP:
        n = N[i]
        L = G.local()
        # built at z = 0 around the point below the space, then lifted onto the village street
        gx, gy = n['x'], n['y'] + DECK * lib.SINB * lib.PX
        BP.village_house(L, gx, gy, rnd, s=1.0, deck=DECK)
        G.merge(L, zv)
    # village houses between the two routes and round the edges (only where they hide no trail)
    spots = [(860, 1845), (760, 1720), (1140, 2000 - 250), (560, 1880), (1210, 1900 - 60), (990, 1650), (640, 2105), (1300, 1960)]
    for (hx, hy) in spots:
        if K.pmask_at(pm, hx, hy) > 0.02 or near_node(hx, hy, 105) or deck_zone(hx, hy) or not canopy_clear(hx, hy, 80, 150):
            continue
        if not any(K.inside(isl['mask'], hx, hy) for isl in islands if isl['theme'] == 'village'):
            continue
        L = G.local()
        BP.village_house(L, hx, hy, rnd, s=1.0, two_storey=rnd.random() < 0.35)
        G.merge(L, zv)
    # the tournament ring
    zr = next(isl['z'] for isl in islands if isl['theme'] == 'ring')
    L = G.local()
    BP.tournament_ring(L, RING[0], RING[1], s=1.0)
    G.merge(L, zr)
    # boulder grounds: big boulders, stone weights, training dummies
    zb = next(isl['z'] for isl in islands if isl['theme'] == 'boulders')
    L = G.local()
    for (bx, by, r, rope) in [(3060, 1270, 0.42, True), (3000, 1420, 0.3, False), (3120, 1480, 0.36, False), (2990, 1560, 0.22, False), (3210, 1370, 0.2, False)]:
        if near_node(bx, by, 95) or K.pmask_at(pm, bx, by) > 0.02:
            continue
        BP.boulder(L['rocks'], bx, by, rnd, r=r, rope=L['wood'] if rope else None)
    for (bx, by) in [(3120, 1180), (2960, 1640)]:
        if not near_node(bx, by, 95) and K.pmask_at(pm, bx, by) < 0.02:
            BP.stone_weights(L, bx, by, rnd)
    for (bx, by) in [(3180, 1600), (3040, 1150)]:
        if not near_node(bx, by, 90) and K.pmask_at(pm, bx, by) < 0.02 and canopy_clear(bx, by, 40, 80):
            BP.training_post(L, bx, by, rnd)
    G.merge(L, zb)
    # the training falls: a craggy cliff, the fall, the pool with training stakes, an overflow fall
    zf = next(isl['z'] for isl in islands if isl['theme'] == 'falls')
    falls(G, BP, zf, rnd, islands)
    # Mimi's little stone garden on the middle peak: raked gravel ring and three rocks
    zp = next(isl['z'] for isl in islands if isl['theme'] == 'peak')
    L = G.local()
    c = lib.board_to_world(MIMI[0] + 10, MIMI[1] + 30, 0.0)
    v, f = lib.lathe([(0.62, 0.012), (0.0, 0.012)], 40, (c.x, c.y, 0.0), cap_bottom=False, squash_y=1.0)
    L['stone'].add(v, f, col('#e9e3d6'))
    for (ox, oy, r) in [(-0.32, 0.18, 0.12), (0.34, 0.1, 0.09), (0.05, 0.3, 0.07)]:
        v, f = lib.blob((c.x + ox, c.y + oy, r * 0.5), r, squash=(1.2, 1, 0.8), rough=0.3, subdiv=2, seed=ox * 9)
        L['rocks'].add(v, f, col('#8f8a86'))
    G.merge(L, zp)
    # the Cloud Isle's beach: a scatter of shells and a driftwood log
    zi = next(isl['z'] for isl in islands if isl['theme'] == 'isle')
    L = G.local()
    for k in range(14):
        bx, by = HUT[0] - 260 + rnd.uniform(0, 420), HUT[1] - 160 + rnd.uniform(0, 260)
        if near_node(bx, by, 70) or near_landmark(bx, by, 10) or not any(K.inside(isl['mask'], bx, by) for isl in islands if isl['theme'] == 'isle'):
            continue
        p = lib.board_to_world(bx, by, 0.0)
        v, f = lib.blob((p.x, p.y, 0.02), 0.035, squash=(1.2, 1, 0.5), rough=0.1, subdiv=1)
        L['paint'].add(v, f, col(rnd.choice(['#fff4ea', '#ffd9c7', '#f7c9d6'])))
    G.merge(L, zi)


def falls(G, BP, zf, rnd, islands):
    px, py = FALLS_POOL
    # the pool: a round basin of calm water ringed with mossy rocks
    L = G.local()
    c = lib.board_to_world(px, py, 0.012)
    v, f = lib.lathe([(0.48, 0.0), (0.0, 0.0)], 36, (c.x, c.y, 0.012), cap_bottom=False, cap_top=False, squash_y=0.75)
    L['ponds'].add(v, f, (1, 1, 1, 1))
    for a in np.linspace(0, math.tau, 14, endpoint=False):
        terrain.rock(L['rocks'], px + math.cos(a) * 50, py + math.sin(a) * 30, rnd, 0.6, moss=True)
    # training stakes standing in the pool
    for (ox, oy, h) in [(-18, 8, 0.36), (14, -4, 0.3), (30, 14, 0.26)]:
        q = lib.board_to_world(px + ox, py + oy, 0.0)
        v, f = lib.cylinder((q.x, q.y, -0.05), 0.05, 0.045, h, 10)
        L['wood'].add(v, f, col('#8a5a34'))
    # the cliff behind the pool: a cluster of rock columns, a pine on top
    lip_h = FALLS_DROP
    cliff = [(px - 20, py - 125, 0.62, lip_h + 0.25), (px - 95, py - 105, 0.5, lip_h - 0.2), (px + 60, py - 110, 0.45, lip_h - 0.45), (px - 150, py - 60, 0.4, lip_h - 0.9)]
    tops = []
    for (bx, by, r, h) in cliff:
        top = BP.rock_spire(L['rocks'], bx, by, rnd, h=h, r=r)
        tops.append((bx, by, top))
    r2 = random.Random(77)
    tb = lib.board_to_world(px - 95, py - 105, 0.0)
    pv = lib.MeshBuilder()
    pw = lib.MeshBuilder()
    terrain.tree_pine(pv, pw, px - 95, py - 105, r2, 0.75)
    t = K.Vector((0.0, 0.0, lip_h - 0.25))
    for (src, dst) in ((pv, L['leaves']), (pw, L['trunks'])):
        base = len(dst.v)
        dst.v.extend((x, y, z + t.z) for (x, y, z) in src.v)
        dst.f.extend(tuple(i + base for i in f) for f in src.f)
        dst.c.extend(src.c)
    _ = tb
    # the fall: a ribbon that leaves the cliff's face at the lip, arcs out and drops into the pool
    lip = lib.board_to_world(px - 8, py - 92, 0.0)
    reach = (92 - 22) / (lib.COSB * lib.PX)  # how far out (world units) the water lands: the pool's back half
    cols, rows, width = 6, 18, 0.34
    verts, faces = [], []
    for j in range(rows + 1):
        tt = j / rows
        zz = lip_h - lip_h * tt
        out = reach * min(1.0, tt * 2.2) ** 0.55
        for i in range(cols + 1):
            uu = i / cols * 2 - 1
            u = uu * 0.5 * width * (1 + 0.3 * tt)
            bulge = 0.05 * (1 - uu * uu)
            verts.append((lip.x + u, lip.y - out - bulge, zz))
    for j in range(rows):
        for i in range(cols):
            a = j * (cols + 1) + i
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    fall_mb = lib.MeshBuilder()
    fall_mb.add(verts, faces, (1, 1, 1, 1))
    ob = fall_mb.build('training_fall', falls_material_for(lip_h), smooth=True)
    if ob is not None:
        t2 = K.lift(zf)
        ob.location = (t2.x, t2.y, t2.z)
    for k in range(7):
        a = k / 7 * math.tau
        v, f = lib.blob((c.x + math.cos(a) * 0.14, c.y + 0.05 + math.sin(a) * 0.08, 0.05), rnd.uniform(0.06, 0.1), squash=(1.2, 1, 0.5), rough=0.3, subdiv=1, seed=k)
        L['water'].add(v, f, (1, 1, 1, 1))
    G.merge(L, zf)


_FALLS_MATS = {}


def falls_material_for(h):
    if h not in _FALLS_MATS:
        _FALLS_MATS[h] = lib.falls_material(f'fall_{h}', h, 0.0)
    return _FALLS_MATS[h]


# ------------------------------------------------------------------------------------------
def clouds(islands, G):
    """The sea of clouds: banks round the Cloud Isle and in the gaps between the peaks, below the rims."""
    rnd = random.Random(404)
    L = G.local()
    banks = [
        # (board x, board y, height, radius, count, spread x, spread y)
        (2640, 1640, -1.3, 0.6, 12, 1.6, 0.6), (2480, 1520, -1.6, 0.55, 8, 1.0, 0.5), (2880, 1600, -1.5, 0.55, 8, 0.9, 0.5),
        (2250, 1050, -1.9, 0.6, 10, 1.4, 0.6), (2250, 1500, -2.2, 0.6, 9, 1.2, 0.7), (1390, 1330, -2.2, 0.6, 10, 1.4, 0.7),
        (1250, 1000, -2.0, 0.5, 7, 1.0, 0.5), (2230, 1780, -2.3, 0.55, 8, 1.2, 0.6), (3000, 1300, -2.0, 0.5, 6, 0.8, 0.5),
        (1600, 2380, -2.6, 0.7, 12, 2.4, 0.5), (2500, 2300, -2.5, 0.65, 10, 2.0, 0.5), (760, 2320, -2.6, 0.65, 9, 1.8, 0.5),
        (450, 1450, -2.1, 0.5, 6, 0.8, 0.5), (3450, 1650, -2.1, 0.55, 7, 0.9, 0.6), (2250, 780, -1.2, 0.45, 6, 1.0, 0.3),
    ]
    for (bx, by, z, r, n, sx, sy) in banks:
        K.cloud_puffs(L['clouds'], bx, by, z, rnd, r=r, count=n, spread=(sx, sy))
    G.merge(L, 0.0)


if __name__ == '__main__':
    main()
