"""Suncoil Sanctuary board diorama (terrain layer + prop sprites).

    .artenv/bin/python scripts/art/board.py [--preview] [--scale 1.0] [--samples 96] [--out DIR]

Island outlines are derived from the board graph so every space sits on solid ground; the
rendered terrain lines up pixel-for-pixel with the game's board coordinates.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from skimage import measure

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
import terrain  # noqa: E402
from terrain import (  # noqa: E402
    THEMES, barrel, build_island, bush, crate, crystal_cluster, dist_at, fence_run, flower_bed, grass_tuft, hay_bale, island_material, lamp_post,
    level_contour, mushroom_cluster, orient, resample, rock, stepping_stone, tree_pine, tree_round, vine,
)
from lib import COSB, PX, Vector, board_to_world, col  # noqa: E402

import bpy  # noqa: E402
from mathutils import noise  # noqa: E402

GRID = 4  # px per mask cell


def args():
    p = argparse.ArgumentParser()
    p.add_argument('--preview', action='store_true')
    p.add_argument('--scale', type=float, default=None)
    p.add_argument('--samples', type=int, default=None)
    p.add_argument('--out', default=os.path.join(lib.ROOT, 'art-out', 'board'))
    p.add_argument('--only', default='', help='with --props-only: comma-separated landmark ids to re-render')
    p.add_argument('--crop', default='', help='x0,y0,x1,y1 board px region to render at --scale')
    p.add_argument('--export', action='store_true', help='slice into WebP tiles under public/assets/rendered')
    p.add_argument('--props-only', action='store_true', help='only re-render the landmark sprites')
    p.add_argument('--no-lowland', action='store_true', help='skip the valley floor under the plateaus')
    return p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])


A = args()
SCALE = A.scale or (0.25 if A.preview else 1.0)
SAMPLES = A.samples or (20 if A.preview else 96)
DATA = json.load(open(os.path.join(os.path.dirname(__file__), 'data', 'suncoil.json')))
W, H = DATA['width'], DATA['height']
terrain.set_canvas(W, H, GRID)
NODES = {n['id']: n for n in DATA['nodes']}
EDGES = DATA['edges']
# Visual-only overrides: the plaza and the docks are separate islands joined by stepping stones.
for e in EDGES:
    if e['from'] == 'd6' and e['to'] == 'p0':
        e['style'] = 'steps'

lib.seeded(7)
# Landmarks: modelled props rendered as separate depth-sorted sprites. `r` grows the island under
# them; `tex` names the placeholder decoration each one replaces in-game.
LANDMARKS = [
    dict(id='observatory', kind='observatory', x=2420, y=1760, s=1.3, r=235, tex='observatory'),
    dict(id='windmill', kind='windmill', x=2450, y=590, s=1.8, r=150, tex='windmill'),
    dict(id='workshop', kind='workshop', x=2790, y=580, s=2.1, r=195, tex='workshop'),
    dict(id='stall', kind='stall', x=3150, y=1835, s=1.7, r=160, tex='stall'),
    dict(id='grove-tree', kind='twist_tree', x=860, y=1760, s=1.0, r=150, tex='tree-twist'),
    dict(id='crystal-gen', kind='crystal_gen', x=1215, y=720, s=1.3, r=125, tex='crystal-generator'),
    dict(id='crystal-gen-2', kind='crystal_gen', x=1530, y=630, s=0.95, r=105, tex='crystal-generator'),
    dict(id='lantern-1', kind='lantern', x=1640, y=2160, s=1.7, r=40, tex='lantern'),
    dict(id='stage', kind='stage', x=2195, y=2100, s=1.3, r=120, tex='', depth_y=2010),
    dict(id='lantern-3', kind='lantern', x=760, y=1480, s=1.6, r=40, tex='lantern'),
    dict(id='lantern-4', kind='lantern', x=2920, y=1960, s=1.7, r=40, tex='lantern'),
    dict(id='lantern-5', kind='lantern', x=2560, y=2060, s=1.7, r=40, tex='lantern'),
    dict(id='bunting-plaza', kind='bunting', x=1700, y=2140, s=1.6, width=220, r=60, tex='bunting'),
    dict(id='bunting-terrace', kind='bunting', x=3130, y=590, s=1.4, width=180, r=60, tex='bunting'),
    dict(id='gate', kind='gate', x=1925, y=2150, s=1.6, r=0, tex='prism-gate'),
    # story props: a sky-boat moored off the docks, the plaza well, a flower cart on the terrace,
    # the crystal mine, a weather vane on the windy ledge and a bench in the grove
    dict(id='skyboat', kind='skyboat', x=3720, y=1990, s=1.6, r=0, tex=''),
    dict(id='well', kind='well', x=1520, y=2050, s=1.2, r=80, tex=''),
    dict(id='flower-cart', kind='flower_cart', x=2640, y=852, s=1.2, r=0, tex=''),
    dict(id='mine', kind='mine', x=1360, y=600, s=1.3, r=110, tex=''),
    dict(id='vane', kind='vane', x=3400, y=1300, s=1.2, r=0, tex=''),
    dict(id='bench', kind='bench', x=900, y=1560, s=1.2, r=0, tex=''),
]
for _g in ['go4', 'c2', 't4', 'd3', 'o2']:
    _n = next(n for n in DATA['nodes'] if n['id'] == _g)
    LANDMARKS.append(dict(id=f'pedestal-{_g}', kind='pedestal', x=_n['x'], y=_n['y'] - 40, s=1.5, r=0, tex='relic-pedestal'))

# Rendered area in board px (a margin around the board for hanging island undersides).
FRAME = (-120, -60, W + 240, H + 200)
TILE = 1024


def export_tiles(path):
    from tiles import export_tiles as _export
    _export(path, DATA['id'], FRAME[:2], SCALE)


# ------------------------------------------------------------------------------------------
# Islands from the graph
def components():
    parent = {n: n for n in NODES}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for e in EDGES:
        if e['style'] == 'path':
            parent[find(e['from'])] = find(e['to'])
    groups: dict = {}
    for n in NODES:
        groups.setdefault(find(n), []).append(n)
    return [sorted(g) for g in groups.values()]


BRIDGE_NODES = {n for n, v in NODES.items() if v.get('bridge')}
ISLANDS = [g for g in components() if not set(g) <= BRIDGE_NODES]

DECOR_RADIUS = {
    'observatory': 240, 'tree-twist': 210, 'windmill': 130, 'workshop': 175, 'stall': 140,
    'crystal-generator': 115, 'lantern': 55, 'props': 60,
}


def island_mask(ids):
    gw, gh = W // GRID, H // GRID
    yy, xx = np.mgrid[0:gh, 0:gw].astype(np.float32) * GRID
    field = np.zeros((gh, gw), np.float32)

    def disc(cx, cy, r):
        nonlocal field
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        field = np.maximum(field, np.clip((r - d) / 12 + 0.5, 0, 1))

    def capsule(ax, ay, bx, by, r):
        nonlocal field
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy or 1.0
        t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / L2, 0, 1)
        d = np.sqrt((xx - ax - t * vx) ** 2 + (yy - ay - t * vy) ** 2)
        field = np.maximum(field, np.clip((r - d) / 12 + 0.5, 0, 1))

    single = len(ids) == 1
    rnd = random.Random(zlib.crc32(','.join(ids).encode()))
    for i in ids:
        n = NODES[i]
        disc(n['x'], n['y'], 90 if single else 122)
        for _ in range(1 if single else 2):
            a = rnd.uniform(0, math.tau)
            dd = rnd.uniform(30, 55) if single else rnd.uniform(50, 105)
            disc(n['x'] + math.cos(a) * dd, n['y'] + math.sin(a) * dd * 0.8, rnd.uniform(40, 58) if single else rnd.uniform(70, 110))
    for e in EDGES:
        if e['style'] == 'path' and e['from'] in ids and e['to'] in ids:
            a, b = NODES[e['from']], NODES[e['to']]
            capsule(a['x'], a['y'], b['x'], b['y'], 104)
    if not single:
        cx = np.mean([NODES[i]['x'] for i in ids])
        cy = np.mean([NODES[i]['y'] for i in ids])
        for lm in LANDMARKS:
            if not lm['r']:
                continue
            # Each landmark grows only the island owning the nearest space.
            nearest = min(NODES.values(), key=lambda n: math.hypot(lm['x'] - n['x'], lm['y'] - n['y']))
            if nearest['id'] in ids:
                disc(lm['x'], lm['y'], lm['r'])
        # fill the interior so islands are solid blobs, not rings
        pts = np.array([[NODES[i]['x'], NODES[i]['y']] for i in ids])
        if len(ids) >= 3:
            from scipy.spatial import ConvexHull
            try:
                hull = ConvexHull(pts)
                poly = [tuple(pts[v]) for v in hull.vertices]
                img = Image.new('L', (gw, gh), 0)
                ImageDraw.Draw(img).polygon([(x / GRID, y / GRID) for x, y in poly], fill=255)
                hullm = np.asarray(img, np.float32) / 255.0
                # only fill the hull where it is not a long thin sliver
                field = np.maximum(field, hullm * 0.999)
            except Exception:
                pass
        _ = cx, cy
    img = Image.fromarray((field * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(24 / GRID))
    return np.asarray(img, np.float32) / 255.0 > 0.5


def contour_rings(mask):
    """Inward distance field (px) and ring contours at increasing inset."""
    dist = ndimage.distance_transform_edt(mask) * GRID
    dist = ndimage.gaussian_filter(dist, 1.0)
    return dist


def merged_islands():
    """Component masks. Overlapping islands are separated by a carved sky gap; they are merged
    only when carving would leave one of their spaces without solid ground."""
    comps = [[list(ids), island_mask(ids)] for ids in ISLANDS]
    gap = int(34 / GRID)

    def nodes_ok(ids, m):
        return all(dist_at(ndimage.distance_transform_edt(m) * GRID, NODES[i]['x'], NODES[i]['y']) > 58 for i in ids)

    changed = True
    while changed:
        changed = False
        for i in range(len(comps)):
            for j in range(len(comps)):
                if i == j or comps[i] is None or comps[j] is None:
                    continue
                mi, mj = comps[i][1], comps[j][1]
                if not np.logical_and(ndimage.binary_dilation(mi, iterations=gap), mj).any():
                    continue
                big, small = (i, j) if mi.sum() >= mj.sum() else (j, i)
                carved = np.logical_and(comps[small][1], ~ndimage.binary_dilation(comps[big][1], iterations=gap))
                # keep only the part connected to the small island's own spaces
                lab, n = ndimage.label(carved)
                keep = np.zeros_like(carved)
                for nid in comps[small][0]:
                    gx, gy = int(NODES[nid]['x'] / GRID), int(NODES[nid]['y'] / GRID)
                    if 0 <= gy < lab.shape[0] and 0 <= gx < lab.shape[1] and lab[gy, gx]:
                        keep |= lab == lab[gy, gx]
                if keep.any() and nodes_ok(comps[small][0], keep):
                    comps[small][1] = keep
                else:
                    comps[big][1] = np.logical_or(comps[big][1], comps[small][1])
                    comps[big][0] += comps[small][0]
                    comps[small] = None
                changed = True
    return [(sorted(c[0]), c[1]) for c in comps if c is not None]


# ------------------------------------------------------------------------------------------
# Path mask (dirt trails + clearings around spaces)
def path_mask(islands_masks):
    s = 2  # px per mask pixel
    img = Image.new('L', (W // s, H // s), 0)
    dr = ImageDraw.Draw(img)
    for e in EDGES:
        if e['style'] != 'path':
            continue
        a, b = NODES[e['from']], NODES[e['to']]
        dr.line([(a['x'] / s, a['y'] / s), (b['x'] / s, b['y'] / s)], fill=255, width=int(70 / s))
    for n in NODES.values():
        r = 66 / s
        dr.ellipse([n['x'] / s - r, n['y'] / s - r * 0.8, n['x'] / s + r, n['y'] / s + r * 0.8], fill=255)
    img = img.filter(ImageFilter.GaussianBlur(3.2))
    path = os.path.join(A.out, 'pathmask.png')
    os.makedirs(A.out, exist_ok=True)
    img.save(path)
    return path, np.asarray(img, np.float32) / 255.0


# ------------------------------------------------------------------------------------------
# Scatter
def inside(mask, bx, by):
    gx, gy = int(bx // GRID), int(by // GRID)
    return 0 <= gy < mask.shape[0] and 0 <= gx < mask.shape[1] and mask[gy, gx]


def dist_in(dist, bx, by):
    gx, gy = int(bx // GRID), int(by // GRID)
    if 0 <= gy < dist.shape[0] and 0 <= gx < dist.shape[1]:
        return dist[gy, gx]
    return 0.0


def pmask_at(pm, bx, by):
    x, y = int(bx // 2), int(by // 2)
    if 0 <= y < pm.shape[0] and 0 <= x < pm.shape[1]:
        return pm[y, x]
    return 0.0


def near_landmark(bx, by, pad=0.0):
    for lm in LANDMARKS:
        k = lm['kind']
        if k == 'bunting':
            half = lm.get('width', 240) / 2
            for px in (lm['x'] - half, lm['x'] + half):
                if (bx - px) ** 2 + (by - lm['y']) ** 2 < (30 + pad) ** 2:
                    return True
            continue
        rr = {'lantern': 34, 'pedestal': 40, 'gate': 120, 'stage': 115, 'flower_cart': 70, 'vane': 34, 'bench': 50, 'well': 70, 'mine': 110}.get(k, lm['r'] * 0.85)
        if (bx - lm['x']) ** 2 + (by - lm['y']) ** 2 < (rr + pad) ** 2:
            return True
    return False


def near_node(bx, by, r):
    return any((bx - n['x']) ** 2 + (by - n['y']) ** 2 < r * r for n in NODES.values())


def world_to_board_v(v):
    return list(lib.world_to_board(v))


def render_props(built, terrain_objs, frame):
    """Render each landmark on its own (terrain still lights it) and add them to the manifest."""
    fx, fy, fw, fh = frame
    rx, ry = bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y
    for o in terrain_objs:
        o.visible_camera = False
        # Only the islands stay (for bounce light); scatter could bury a prop's base in darkness.
        if not o.name.startswith('island_'):
            o.hide_render = True
    all_prop_objs = [o for _, obs in built.values() for o in obs]
    dest = os.path.join(lib.ROOT, 'public', 'assets', 'rendered', DATA['id'])
    os.makedirs(dest, exist_ok=True)
    entries = []
    dg = bpy.context.evaluated_depsgraph_get()
    # --only id,id: re-render just those sprites and keep every other manifest entry as it was
    only = {t for t in A.only.split(',') if t}
    man_path0 = os.path.join(dest, 'manifest.json')
    old_entries = {e['id']: e for e in json.load(open(man_path0)).get('props', [])} if only and os.path.exists(man_path0) else {}
    for pid, (lm, obs) in built.items():
        if only and pid not in only:
            if pid in old_entries:
                entries.append(old_entries[pid])
            continue
        for o in all_prop_objs:
            o.hide_render = o not in obs
        for o in obs:
            o.visible_camera = True
            o.visible_glossy = True
        # projected bounding box (board px) of the evaluated geometry
        xs, ys = [], []
        for o in obs:
            ev = o.evaluated_get(dg)
            me = ev.to_mesh()
            for v in me.vertices:
                w = o.matrix_world @ v.co
                bx, by = lib.world_to_board(w)
                xs.append(bx)
                ys.append(by)
            ev.to_mesh_clear()
        pad = 8
        px0 = max(0, math.floor((min(xs) - pad - fx) * SCALE))
        px1 = min(rx, math.ceil((max(xs) + pad - fx) * SCALE))
        py0 = max(0, math.floor((min(ys) - pad - fy) * SCALE))
        py1 = min(ry, math.ceil((max(ys) + pad - fy) * SCALE))
        sc = bpy.context.scene
        sc.render.use_border = True
        sc.render.use_crop_to_border = True
        sc.render.border_min_x, sc.render.border_max_x = px0 / rx, px1 / rx
        sc.render.border_min_y, sc.render.border_max_y = 1 - py1 / ry, 1 - py0 / ry
        png = os.path.join(A.out, 'props', f'{pid}.png')
        lib.render_to(png)
        im = Image.open(png).convert('RGBA')
        name = f'prop_{pid}.webp'
        im.save(os.path.join(dest, name), 'WEBP', quality=92, method=6)
        e = {'id': pid, 'file': name, 'tex': lm.get('tex', ''), 'kind': lm['kind'],
             'x': fx + px0 / SCALE, 'y': fy + py0 / SCALE, 'w': im.width / SCALE, 'h': im.height / SCALE,
             'baseY': lm['y'], 'anchorX': lm['x']}
        if lm.get('depth_y') is not None:
            e['depthY'] = lm['depth_y']
        if lm.get('hub'):
            e['hub'] = lm['hub']
        entries.append(e)
        for o in obs:
            o.visible_camera = False
        print('prop', pid, im.size)
    lib.clear_border()
    man_path = os.path.join(dest, 'manifest.json')
    man = json.load(open(man_path)) if os.path.exists(man_path) else {'board': DATA['id']}
    man['props'] = entries
    with open(man_path, 'w') as fh:
        json.dump(man, fh, indent=1)
    # drop sprites from earlier runs that are no longer in the manifest
    keep = {t['file'] for t in man.get('tiles', [])} | {e['file'] for e in entries} | {'manifest.json'}
    for f in os.listdir(dest):
        if f.startswith('prop_') and f not in keep:
            os.remove(os.path.join(dest, f))


PREFIX_THEME = {'p': 'plaza', 'g': 'grove', 'gi': 'grove', 'go': 'grove', 'c': 'works', 't': 'terrace', 'w': 'windy', 'd': 'docks',
                'o': 'obs', 'b': 'plaza', 'bd': 'plaza'}


def theme_of(ids):
    votes = {}
    for i in ids:
        pre = i.rstrip('0123456789es')
        th = PREFIX_THEME.get(pre, 'plaza')
        votes[th] = votes.get(th, 0) + 1
    return max(votes, key=votes.get) if votes else 'plaza'


def water_material():
    m = lib.NT('water')
    pos = m.position()
    X, Y, Z = m.sep(pos)
    wave = m.node('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'X'
    wave.inputs['Scale'].default_value = 9.0
    wave.inputs['Distortion'].default_value = 4.0
    wave.inputs['Detail'].default_value = 2.0
    m.link(pos, wave.inputs['Vector'])
    streak = m.maprange(wave.outputs['Fac'], 0.3, 0.9)
    c = m.mix(streak, lib.col('#7fd0f0'), lib.col('#f4fdff'))
    fade = m.maprange(Z, -3.6, -1.2, 0.0, 1.0)
    b = m.bsdf(c, 0.15, emission=c, emission_strength=0.55, coat=0.4, alpha=m.math('MULTIPLY', fade, 0.92))
    return m.mat


def pond_material():
    m = lib.NT('pond')
    nz = m.noise(4.0, 3, 0.5, m.position())
    c = m.mix(m.maprange(nz.outputs['Fac'], 0.35, 0.7), lib.col('#2f9fd0'), lib.col('#7fdcf4'))
    m.bsdf(c, 0.08, emission=lib.col('#4fc3e8'), emission_strength=0.15, coat=0.8)
    return m.mat


def add_waterfall(water_mb, pond_mb, rock_mb, ring, nrm, pm, rnd):
    """A spring-fed pond near a camera-facing rim with a waterfall pouring off the edge."""
    best = None
    for k in range(len(ring)):
        if nrm[k][1] < 0.75:
            continue
        bx, by = ring[k]
        clear = max(pmask_at(pm, bx - nrm[k][0] * d, by - nrm[k][1] * d) for d in (10, 40, 80, 105))
        if clear > 0.05 or near_landmark(bx, by, 50) or near_node(bx - nrm[k][0] * 62, by - nrm[k][1] * 62, 95):
            continue
        score = nrm[k][1]
        if best is None or score > best[0]:
            best = (score, k)
    if best is None:
        return False
    k = best[1]
    bx, by = ring[k]
    nx, ny = nrm[k]
    # pond
    cx, cy = bx - nx * 62, by - ny * 62
    c = board_to_world(cx, cy, 0.012)
    v, f = lib.lathe([(0.36, 0.0), (0.0, 0.0)], 32, (c.x, c.y, 0.012), cap_bottom=False, cap_top=False, squash_y=1.0 / COSB * 0.55)
    pond_mb.add(v, f, (1, 1, 1, 1))
    for a in np.linspace(0, math.tau, 12, endpoint=False):
        rock(rock_mb, cx + math.cos(a) * 40, cy + math.sin(a) * 40 * 0.6 * COSB / 0.55, rnd, 0.55, moss=True)
    # falling ribbon: arcs out from the lip, then drops
    w0 = board_to_world(bx, by, -0.02)
    ox, oy = nx, -ny
    L = math.hypot(ox, oy) or 1.0
    ox, oy = ox / L, oy / L
    px, py = -oy, ox
    cols, rows = 8, 22
    width = 0.62
    verts, faces = [], []
    for j in range(rows + 1):
        t = j / rows
        out = 0.06 + 0.42 * min(1.0, t * 3.0) ** 0.5
        z = -0.02 - 3.6 * t ** 1.15
        for i in range(cols + 1):
            u = (i / cols - 0.5) * width * (1 + 0.35 * t)
            verts.append((w0.x + ox * out + px * u, w0.y + oy * out + py * u, z))
    for j in range(rows):
        for i in range(cols):
            a = j * (cols + 1) + i
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    water_mb.add(verts, faces, (1, 1, 1, 1))
    # foam where the water tips over the lip, and a mist puff where the ribbon thins out
    for k in range(5):
        u = (k / 4 - 0.5) * width * 0.9
        v, f = lib.blob((w0.x + ox * 0.08 + px * u, w0.y + oy * 0.08 + py * u, -0.02), 0.07, squash=(1.2, 1.0, 0.5), rough=0.3, subdiv=1, seed=k)
        water_mb.add(v, f, (1, 1, 1, 1))
    for k in range(7):
        u = rnd.uniform(-0.5, 0.5) * width * 1.4
        zz = -2.6 - rnd.uniform(0.0, 0.9)
        # (the water material fades with depth, so these read as translucent spray)
        v, f = lib.blob((w0.x + ox * 0.5 + px * u, w0.y + oy * 0.5 + py * u, zz), rnd.uniform(0.16, 0.3), rough=0.25, subdiv=2, seed=rnd.random())
        water_mb.add(v, f, (1, 1, 1, 1))
    # splash pool where the ribbon meets the valley floor
    tl = (-LOW_Z / 3.6) ** (1 / 1.15) if not A.no_lowland else 1.0
    out_l = 0.06 + 0.42 * min(1.0, tl * 3.0) ** 0.5
    lx, ly = w0.x + ox * out_l, w0.y + oy * out_l
    v, f = lib.lathe([(0.55, 0.0), (0.0, 0.0)], 24, (lx, ly, LOW_Z + 0.04), cap_bottom=False, cap_top=False, squash_y=0.7)
    if not A.no_lowland:
        pond_mb.add(v, f, (1, 1, 1, 1))
    for k in range(9 if not A.no_lowland else 0):
        a = k / 9 * math.tau
        v, f = lib.blob((lx + math.cos(a) * 0.3, ly + math.sin(a) * 0.2, LOW_Z + 0.08), rnd.uniform(0.08, 0.14), squash=(1.2, 1.0, 0.45), rough=0.3, subdiv=1, seed=k * 7)
        water_mb.add(v, f, (1, 1, 1, 1))
    # the channel over the lip
    v, f = lib.box(((w0.x + c.x) / 2, (w0.y + c.y) / 2, 0.006), (0.16, math.hypot(w0.x - c.x, w0.y - c.y), 0.01), rot_z=math.atan2(w0.y - c.y, w0.x - c.x) - math.pi / 2)
    pond_mb.add(v, f, (1, 1, 1, 1))
    return True


# ------------------------------------------------------------------------------------------
# Lowland: a meadow valley below the plateaus, so every view is filled with ground instead of sky.
LOW_Z = -2.6
LOW_SHIFT = -LOW_Z * PX * lib.SINB  # a lowland point appears this many px below its board y


def lowland_mask():
    """A big rounded blob under the whole board (inside the mask canvas, so its rim closes)."""
    gw, gh = W // GRID, H // GRID
    yy, xx = np.mgrid[0:gh, 0:gw].astype(np.float32) * GRID
    cx, cy = W / 2, H / 2
    # keep the wobbly rim clear of the canvas edge, or its contour comes back open
    ax, ay = (W / 2 - 60) / 1.04, (H / 2 - 60) / 1.04
    ang = np.arctan2(yy - cy, xx - cx)
    wob = 1 + 0.02 * np.sin(ang * 5 + 1.3) + 0.012 * np.sin(ang * 11 + 0.4)
    r = (np.abs((xx - cx) / ax) ** 6 + np.abs((yy - cy) / ay) ** 6) ** (1 / 6)
    m = r < wob
    m[:3, :] = m[-3:, :] = False
    m[:, :3] = m[:, -3:] = False
    return m


def lowland_material():
    m = lib.NT('lowland')
    pos = m.position()
    nz = m.sep(m.normal())[2]
    n1 = m.noise(0.45, 5, 0.6, pos)
    n2 = m.noise(4.0, 3, 0.5, pos)
    gfac = m.math('ADD', m.math('MULTIPLY', n1.outputs['Fac'], 0.8), m.math('MULTIPLY', n2.outputs['Fac'], 0.35))
    # a touch cooler and softer than the plateau grass (reads as further away)
    grass = m.ramp(gfac, [(0.28, '#327040'), (0.42, '#40864a'), (0.55, '#529c52'), (0.68, '#69b05e'), (0.82, '#8cc572')])
    patches = m.noise(0.11, 3, 0.5, pos)
    grass = m.mix(m.maprange(patches.outputs['Fac'], 0.56, 0.7), grass, lib.col('#a1bf5c'))
    wave = m.node('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 1.4
    wave.inputs['Distortion'].default_value = 6.0
    m.link(pos, wave.inputs['Vector'])
    rn = m.noise(1.8, 6, 0.6, pos)
    rf = m.math('ADD', m.math('MULTIPLY', wave.outputs['Fac'], 0.55), m.math('MULTIPLY', rn.outputs['Fac'], 0.5))
    rock = m.ramp(rf, [(0.25, '#5a3d3a'), (0.4, '#7b5140'), (0.55, '#99694b'), (0.7, '#6e5566'), (0.85, '#8a7a8e')])
    top = m.maprange(nz, 0.55, 0.8)
    colr = m.mix(top, rock, grass)
    ao = m.ao(0.9, 8)
    colr = m.mult(colr, m.mix(ao, lib.col('#5a6a70'), lib.col('#ffffff')))
    colr = m.mix(0.13, colr, lib.col('#b8d6ee'))  # height haze
    m.bsdf(colr, 0.85, normal=m.bump(m.math('ADD', rn.outputs['Fac'], m.math('MULTIPLY', gfac, 0.2)), 0.3, 0.08), sheen=0.2)
    return m.mat


def lowland_height(x, y):
    """Gentle rolling ground (world units, applied on top of LOW_Z)."""
    return 0.2 * noise.noise(Vector((x * 0.16, y * 0.16, 7.7)))


def drop_to_lowland(mb):
    """Move a builder's geometry (authored at z = 0) down onto the rolling lowland."""
    mb.v = [(x, y, z + LOW_Z + lowland_height(x, y)) for (x, y, z) in mb.v]


def build_lowland(island_info, canopy_clear, mats):
    """The valley floor plus forests, meadows, ponds, farms and rubble at the cliff feet."""
    leaf_m, wood_m, flower_m, grass_m, rock_m, pond_m = mats
    rnd = random.Random(404)
    lm = lowland_mask()
    ob, ldist, _under, lring, lnrm = build_island(['lowland', 'valley'], lm, 'lowland', lowland_material())
    me = ob.data
    for v in me.vertices:
        if v.co.z > -0.05:
            bx, by = lib.world_to_board(v.co)
            taper = min(1.0, dist_at(ldist, bx, by) / 160.0)
            v.co.z += LOW_Z + lowland_height(v.co.x, v.co.y) * taper
        else:
            v.co.z += LOW_Z
    for poly in me.polygons:
        poly.use_smooth = True
    upper = np.zeros_like(lm)
    for (_, m, _, _) in island_info:
        upper |= m
    upper_d = ndimage.binary_dilation(upper, iterations=int(28 / GRID))

    def seen(bx, by):
        gx, gy = int(bx / GRID), int((by + LOW_SHIFT) / GRID)
        if not (0 <= gx < upper_d.shape[1]):
            return False
        if gy < 0 or gy >= upper_d.shape[0]:
            return True
        return not upper_d[gy, gx]

    def on_low(bx, by, edge=30):
        return dist_at(ldist, bx, by) > edge

    def clear_of_paths(bx, by, width, height_units):
        return canopy_clear(bx, by + LOW_SHIFT, width, height_units * PX * lib.SINB)

    def pick(edge=30, tries=40):
        for _ in range(tries):
            bx, by = rnd.uniform(40, W - 40), rnd.uniform(40, H - 40)
            if on_low(bx, by, edge) and seen(bx, by):
                return bx, by
        return None

    grass, flowers, leaves, wood, rocks, reeds, water = (lib.MeshBuilder() for _ in range(7))
    area = float(lm.sum()) * GRID * GRID
    # Calm scatter: sparse tufts and a few flower beds, so the valley reads as clean open meadow.
    for _ in range(int(area / (50 * 50))):
        bx, by = rnd.uniform(20, W - 20), rnd.uniform(20, H - 20)
        if on_low(bx, by, 8) and seen(bx, by):
            grass_tuft(grass, bx, by, rnd, rnd.uniform(0.9, 1.4))
    for _ in range(int(area / 100000)):
        pt = pick(20)
        if pt:
            flower_bed(flowers, leaves, *pt, rnd)
    for _ in range(int(area / 55000)):
        pt = pick(16)
        if pt and clear_of_paths(pt[0], pt[1], 40, 0.9):
            bush(leaves, *pt, rnd, rnd.uniform(0.8, 1.3), berries=flowers)
    for _ in range(int(area / 90000)):
        pt = pick(12)
        if pt:
            rock(rocks, *pt, rnd, rnd.uniform(0.9, 1.8))
    # forests: clumps of round trees and pines (cooler palettes, they sit further away)
    low_pals = [('#1f5f2c', '#5aa84e'), ('#1a5a3a', '#4fa86a'), ('#2a6a24', '#80b843'), ('#245a2a', '#6aa24a')]
    for _ in range(20):
        c = pick(80)
        if not c:
            continue
        for _k in range(rnd.randint(5, 10)):
            bx, by = c[0] + rnd.uniform(-130, 130), c[1] + rnd.uniform(-80, 80)
            if not (on_low(bx, by, 50) and seen(bx, by) and clear_of_paths(bx, by, 95, 2.6)):
                continue
            if rnd.random() < 0.6:
                tree_round(leaves, wood, bx, by, rnd, rnd.uniform(0.9, 1.25), palette=rnd.choice(low_pals))
            else:
                tree_pine(leaves, wood, bx, by, rnd, rnd.uniform(0.9, 1.2))
    # rubble and shrubs where the plateau cliffs meet the valley floor (hides the seam)
    for (_, m, _, _) in island_info:
        dd = ndimage.distance_transform_edt(m) * GRID
        rim = level_contour(ndimage.gaussian_filter(dd, 1.2), 2.0)
        if rim is None:
            continue
        for k in range(0, len(rim), 3):
            bx, by = rim[k]
            for off in (18, 34):
                qx, qy = bx, by + off
                if on_low(qx, qy, 10) and seen(qx, qy) and rnd.random() < 0.3:
                    if rnd.random() < 0.7:
                        rock(rocks, qx + rnd.uniform(-8, 8), qy, rnd, rnd.uniform(1.0, 2.0))
                    else:
                        bush(leaves, qx + rnd.uniform(-8, 8), qy, rnd, rnd.uniform(0.7, 1.1), berries=flowers)
    # ponds in the most open stretches of visible valley, with reeds, rocks and lily pads
    free = ~upper_d
    shift = int(round(LOW_SHIFT / GRID))
    vis = np.zeros_like(free)
    vis[: vis.shape[0] - shift, :] = free[shift:, :]
    vis &= lm
    openness = ndimage.distance_transform_edt(vis) * GRID
    ponds = 0
    for _ in range(6):
        gy, gx = np.unravel_index(np.argmax(openness), openness.shape)
        rpx = float(openness[gy, gx])
        if rpx < 110:
            break
        cx, cy = gx * GRID, gy * GRID
        pr = min(190.0, rpx * 0.55)
        yy, xx = np.ogrid[: openness.shape[0], : openness.shape[1]]
        openness[(yy - gy) ** 2 + (xx - gx) ** 2 < ((pr + 260) / GRID) ** 2] = 0
        if not clear_of_paths(cx, cy, pr, 0.4):
            continue
        c = board_to_world(cx, cy, 0.0)
        pts = []
        for a in np.linspace(0, math.tau, 40, endpoint=False):
            w = 1 + 0.12 * math.sin(a * 3 + cx) + 0.06 * math.sin(a * 7 + cy)
            pts.append((math.cos(a) * pr * w / PX, math.sin(a) * pr * w * 0.62 / PX / lib.COSB))
        verts = [(c.x, c.y, 0.02)] + [(c.x + px_, c.y + py_, 0.02) for (px_, py_) in pts]
        faces = [(0, 1 + k, 1 + (k + 1) % len(pts)) for k in range(len(pts))]
        water.add(verts, faces, (1, 1, 1, 1))
        for k, (px_, py_) in enumerate(pts):
            if k % 2 == 0:
                bx_, by_ = lib.world_to_board(Vector((c.x + px_ * 1.06, c.y + py_ * 1.06, 0.0)))
                rock(rocks, bx_, by_, rnd, rnd.uniform(0.6, 1.1), moss=True)
            if k % 3 == 0 and py_ > 0:
                for _j in range(rnd.randint(3, 6)):
                    ox, oy = rnd.uniform(-0.15, 0.15), rnd.uniform(-0.1, 0.1)
                    hgt = rnd.uniform(0.35, 0.7)
                    base = (c.x + px_ * 1.02 + ox, c.y + py_ * 1.02 + oy, 0.0)
                    vv, ff = lib.tube([base, (base[0] + rnd.uniform(-0.08, 0.08), base[1], hgt)], 0.014, 5)
                    reeds.add(vv, ff, col(rnd.choice(['#5f9e3a', '#6fb04a', '#4f8a30'])))
        for _j in range(rnd.randint(4, 8)):
            a, rr = rnd.uniform(0, math.tau), rnd.uniform(0.2, 0.75)
            vv, ff = lib.lathe([(0.1, 0.0), (0.0, 0.0)], 12, (c.x + math.cos(a) * pr * rr / PX, c.y + math.sin(a) * pr * rr * 0.62 / PX / lib.COSB, 0.03),
                               cap_bottom=False, cap_top=False)
            leaves.add(vv, ff, col('#4f9a3a'))
        ponds += 1
    # a farm in the largest remaining open stretch: fenced crop rows, hay and a cottage
    import props
    gy, gx = np.unravel_index(np.argmax(openness), openness.shape)
    if openness[gy, gx] > 140:
        fx, fy = gx * GRID, gy * GRID
        fw, fh = 260, 150
        if clear_of_paths(fx, fy, fw, 1.6):
            for k in range(7):
                ry = fy - fh / 2 + (k + 0.5) * fh / 7
                for j in range(12):
                    rx = fx - fw / 2 + (j + 0.5) * fw / 12
                    p_ = board_to_world(rx + rnd.uniform(-3, 3), ry, 0.0)
                    vv, ff = lib.blob((p_.x, p_.y, 0.06), 0.07, squash=(1.0, 1.0, 0.8), rough=0.2, subdiv=1, seed=k * 13 + j)
                    leaves.add(vv, ff, col(rnd.choice(['#6cb33e', '#7fc24a', '#5da536'])))
            corners = [(fx - fw / 2 - 12, fy - fh / 2 - 10), (fx + fw / 2 + 12, fy - fh / 2 - 10), (fx + fw / 2 + 12, fy + fh / 2 + 10), (fx - fw / 2 - 12, fy + fh / 2 + 10)]
            for k in range(4):
                fence_run(wood, *corners[k], *corners[(k + 1) % 4], rnd)
            for k in range(3):
                hay_bale(wood, fx + fw / 2 + 50 + k * 26, fy + rnd.uniform(-30, 30), rnd)
            cottage = props.workshop(fx - fw / 2 - 110, fy - 20, 1.3)
            for o in cottage:
                o.location.z += LOW_Z + lowland_height(o.location.x, o.location.y)
    for mb in (grass, flowers, leaves, wood, rocks, reeds, water):
        drop_to_lowland(mb)
    grass.build('low_grass', grass_m, smooth=False)
    flowers.build('low_flowers', flower_m)
    leaves.build('low_leaves', leaf_m)
    wood.build('low_wood', wood_m)
    rocks.build('low_rocks', rock_m)
    reeds.build('low_reeds', leaf_m)
    water.build('low_ponds', pond_m, smooth=False)
    print('lowland', int(area), 'ponds', ponds)


def main():
    sc = lib.reset(SAMPLES)
    # A high, soft key over bright sky fill: short gentle shadows and clean, readable colour.
    lib.world_light(0.82)
    lib.sun(energy=3.6, elevation=50, azimuth=-35, angle=3.5, color='#fff0d8')
    out = A.out
    os.makedirs(out, exist_ok=True)

    pm_path, pm = path_mask(None)
    island_mats = {}
    water = lib.MeshBuilder()
    ponds = lib.MeshBuilder()
    falls_left = {'grove': 1, 'docks': 1, 'windy': 1}
    grass_m = lib.attr_mat('grass', rough=0.8, sheen=0.15, ao=0.3)
    flower_m = lib.attr_mat('flower', rough=0.55, subsurface=0.25)
    leaf_m = lib.attr_mat('leaf', rough=0.78, ao=0.5)
    wood_m = lib.attr_mat('wood', rough=0.8, ao=0.3)
    rock_m = lib.attr_mat('rock', rough=0.85, ao=0.4)
    crys = lib.NT('crystal')
    ccol = crys.attr('col')
    crys.bsdf(ccol, 0.12, emission=ccol, emission_strength=1.8, coat=0.6, transmission=0.2)
    crystal_m = crys.mat

    grass = lib.MeshBuilder()
    flowers = lib.MeshBuilder()
    leaves = lib.MeshBuilder()
    wood = lib.MeshBuilder()
    rocks = lib.MeshBuilder()
    crystals = lib.MeshBuilder()
    stones = lib.MeshBuilder()
    vines = lib.MeshBuilder()
    island_info = []
    path_pts = [(n['x'], n['y']) for n in NODES.values()]
    for e in EDGES:
        a, b = NODES[e['from']], NODES[e['to']]
        for t in np.linspace(0, 1, 8):
            path_pts.append((a['x'] + (b['x'] - a['x']) * t, a['y'] + (b['y'] - a['y']) * t))
    path_pts = np.array(path_pts)

    def canopy_clear(bx, by, width, height):
        """True if no path/space lies in the screen area a tall object at (bx, by) would cover."""
        m = (np.abs(path_pts[:, 0] - bx) < width) & (path_pts[:, 1] < by + 20) & (path_pts[:, 1] > by - height)
        return not m.any()

    for idx, (ids, mask) in enumerate(merged_islands()):
        name = f'island_{idx}_' + ('_'.join(ids[:2]))
        theme = theme_of(ids)
        T = THEMES[theme]
        if theme not in island_mats:
            island_mats[theme] = island_material(pm_path, theme)
        ob, dist, under, ring, nrm = build_island(ids, mask, name, island_mats[theme])
        island_info.append((ids, mask, dist, under))
        rnd = random.Random(idx * 31 + 5)
        ys, xs = np.nonzero(mask)
        area = len(xs) * GRID * GRID

        def pick(min_edge=0, max_edge=1e9, path_clear=0.05, node_r=0):
            for _ in range(40):
                j = rnd.randrange(len(xs))
                bx = xs[j] * GRID + rnd.uniform(0, GRID)
                by = ys[j] * GRID + rnd.uniform(0, GRID)
                dd = dist_in(dist, bx, by)
                if dd < min_edge or dd > max_edge or pmask_at(pm, bx, by) > path_clear or (node_r and near_node(bx, by, node_r)):
                    continue
                if near_landmark(bx, by, 30):
                    continue
                return bx, by
            return None

        # trees first (they claim space); only where they never hide a path
        n_trees = int(area / 60000 * T['trees']) + (1 if len(ids) > 2 else 0)
        for _ in range(n_trees * 4):
            if n_trees <= 0:
                break
            pt = pick(min_edge=26, path_clear=0.0, node_r=110)
            if not pt:
                continue
            bx, by = pt
            if not canopy_clear(bx, by, 95, 260):
                continue
            if rnd.random() >= T['pines']:
                tree_round(leaves, wood, bx, by, rnd, rnd.uniform(0.85, 1.15))
            else:
                tree_pine(leaves, wood, bx, by, rnd, rnd.uniform(0.85, 1.1))
            n_trees -= 1
        for _ in range(int(area / (24 * 24))):
            j = rnd.randrange(len(xs))
            bx = xs[j] * GRID + rnd.uniform(0, GRID)
            by = ys[j] * GRID + rnd.uniform(0, GRID)
            if dist_in(dist, bx, by) < 6 or pmask_at(pm, bx, by) > 0.3:
                continue
            grass_tuft(grass, bx, by, rnd, rnd.uniform(0.8, 1.3))
        # decoration kept deliberately sparse: a few meaningful clusters instead of noise
        for _ in range(int(area / 20000 * T['flowers'] * 0.45)):
            pt = pick(min_edge=20, path_clear=0.02, node_r=78)
            if pt:
                flower_bed(flowers, leaves, *pt, rnd)
        for _ in range(int(area / 16000 * T['bushes'] * 0.65)):
            pt = pick(min_edge=12, max_edge=120, path_clear=0.01, node_r=92)
            if pt and canopy_clear(pt[0], pt[1], 40, 60):
                bush(leaves, *pt, rnd, rnd.uniform(0.7, 1.2), berries=flowers)
        for _ in range(int(area / 32000 * T['rocks'] * 0.6)):
            pt = pick(path_clear=0.08, node_r=70)
            if pt:
                rock(rocks, *pt, rnd, rnd.uniform(0.8, 1.4))
        # region clutter
        for _ in range(int(area / 26000 * T.get('mushrooms', 0) * 0.5)):
            pt = pick(min_edge=10, path_clear=0.02, node_r=70)
            if pt:
                mushroom_cluster(flowers, *pt, rnd)
        for _ in range(int(area / 22000 * T.get('crystals', 0) * 0.5)):
            pt = pick(min_edge=14, path_clear=0.02, node_r=80)
            if pt:
                crystal_cluster(crystals, *pt, rnd, rnd.uniform(0.8, 1.3))
        for _ in range(int(area / 45000 * T.get('hay', 0) * 0.6)):
            pt = pick(min_edge=24, path_clear=0.01, node_r=95)
            if pt:
                hay_bale(wood, *pt, rnd)
        for _ in range(int(area / 40000 * T.get('crates', 0) * 0.6)):
            pt = pick(min_edge=18, path_clear=0.01, node_r=90)
            if pt:
                (crate if rnd.random() < 0.6 else barrel)(wood, *pt, rnd)
        if falls_left.get(theme, 0) > 0 and len(ring) > 20:
            ok = add_waterfall(water, ponds, rocks, ring, nrm, pm, rnd)
            print('waterfall', theme, ids[:3], ok)
            if ok:
                falls_left[theme] -= 1
        # pebbles lining the trails
        for _ in range(int(area / 4200)):
            pt = pick(path_clear=1.1)
            if not pt:
                continue
            v = pmask_at(pm, *pt)
            if 0.18 < v < 0.5:
                rock(rocks, *pt, rnd, 0.35, moss=False)
        # rustic fences along stretches of the camera-facing rim (clear of trails and spaces)
        k = 0
        while k < len(ring) - 4:
            if nrm[k][1] > 0.55 and rnd.random() < 0.35:
                run = rnd.randint(3, 6)
                seg = [ring[(k + j) % len(ring)] - nrm[(k + j) % len(ring)] * 16 for j in range(run + 1)]
                ok = all(pmask_at(pm, sx, sy) < 0.02 and not near_node(sx, sy, 80) and not near_landmark(sx, sy, 40) for (sx, sy) in seg)
                if ok:
                    for j in range(run):
                        fence_run(wood, seg[j][0], seg[j][1], seg[j + 1][0], seg[j + 1][1], rnd)
                    k += run + 3
                    continue
            k += 1
        # vines hanging from the rim on the camera-facing side
        for k in range(0, len(ring), 3):
            if nrm[k][1] < 0.35 or rnd.random() < 0.45:
                continue
            bx, by = ring[k] + nrm[k] * 3
            w = board_to_world(bx, by, -0.12)
            vine(vines, (w.x, w.y, w.z), (nrm[k][0], -nrm[k][1]), rnd, rnd.uniform(0.3, 1.2 if len(ids) > 1 else 0.5))
        # crystals poking out of the underside
        cands = [v for v, d in under if d > 25]
        for _ in range(min(len(cands), 5 if len(ids) > 1 else 1)):
            v = rnd.choice(cands)
            for _k in range(rnd.randint(1, 3)):
                pv, fv = lib.prism((v[0] + rnd.uniform(-0.12, 0.12), v[1] + rnd.uniform(-0.12, 0.12), v[2] + 0.15), rnd.uniform(0.07, 0.14), rnd.uniform(0.5, 1.1),
                                   tilt=(math.pi + rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5)), twist=rnd.random())
                crystals.add(pv, fv, col(rnd.choice(['#5ce1ff', '#8ff0ff', '#c49bff', '#7fd8ff'])))

    if not A.no_lowland:
        build_lowland(island_info, canopy_clear, (leaf_m, wood_m, flower_m, grass_m, rock_m, pond_material()))

    # little lamps along the trails (beside the path, midway between spaces)
    rnd = random.Random(77)
    lamps_wood, lamps_glow = lib.MeshBuilder(), lib.MeshBuilder()
    for ei, e in enumerate(EDGES):
        if e['style'] != 'path' or ei % 3:
            continue
        a, b = NODES[e['from']], NODES[e['to']]
        mx, my = (a['x'] + b['x']) / 2, (a['y'] + b['y']) / 2
        L = math.hypot(b['x'] - a['x'], b['y'] - a['y']) or 1
        nx, ny = -(b['y'] - a['y']) / L, (b['x'] - a['x']) / L
        if ny < 0:
            nx, ny = -nx, -ny  # put the lamp on the far side of the trail so it never hides it
        lx, ly = mx - nx * 58, my - ny * 58
        if pmask_at(pm, lx, ly) > 0.05 or near_node(lx, ly, 70) or near_landmark(lx, ly, 50):
            continue
        if not any(inside(m, lx, ly) for (_, m, _, _) in island_info):
            continue
        lamp_post(lamps_wood, lamps_glow, lx, ly, rnd)
    lamps_wood.build('trail_lamps', wood_m)
    lamps_glow.build('trail_lamp_glass', crystal_m)

    # stepping stones along 'steps' edges (never overlapping island edges)
    rnd = random.Random(99)
    grown = [ndimage.binary_dilation(m, iterations=int(40 / GRID)) for (_, m, _, _) in island_info]
    for e in EDGES:
        if e['style'] != 'steps':
            continue
        a, b = NODES[e['from']], NODES[e['to']]
        L = math.hypot(b['x'] - a['x'], b['y'] - a['y'])
        n = max(1, int(L / 60))
        for k in range(n):
            t = (k + 0.5) / n
            bx = a['x'] + (b['x'] - a['x']) * t
            by = a['y'] + (b['y'] - a['y']) * t
            if any(inside(m, bx, by) for m in grown):
                continue
            stepping_stone(stones, grass, bx, by, rnd, r=0.22)

    grass.build('grass', grass_m, smooth=False)
    water.build('waterfalls', water_material(), smooth=True)
    ponds.build('ponds', pond_material(), smooth=False)
    flowers.build('flowers', flower_m)
    leaves.build('leaves', leaf_m)
    wood.build('wood', wood_m)
    rocks.build('rocks', rock_m)
    crystals.build('crystals', crystal_m, smooth=False)
    stones.build('stones', rock_m)
    vines.build('vines', leaf_m)

    # Landmarks: cast shadows into the terrain render, rendered separately as sprites.
    import props
    terrain_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    built = {}
    for lm in LANDMARKS:
        k = lm['kind']
        extra = None
        if k == 'observatory':
            obs = props.observatory(lm['x'], lm['y'], lm['s'])
        elif k == 'windmill':
            obs, sails, hub = props.windmill(lm['x'], lm['y'], lm['s'])
            extra = ('windmill-sails', sails, hub)
        elif k == 'workshop':
            obs = props.workshop(lm['x'], lm['y'], lm['s'])
        elif k == 'stall':
            obs = props.stall(lm['x'], lm['y'], lm['s'])
        elif k == 'twist_tree':
            obs = props.twist_tree(lm['x'], lm['y'], lm['s'])
        elif k == 'crystal_gen':
            obs = props.crystal_gen(lm['x'], lm['y'], lm['s'])
        elif k == 'lantern':
            obs = props.lantern(lm['x'], lm['y'], lm['s'])
        elif k == 'bunting':
            obs = props.bunting(lm['x'], lm['y'], lm.get('width', 240), lm['s'])
        elif k == 'gate':
            obs = props.gate(lm['x'], lm['y'], lm['s'])
        elif k == 'stage':
            obs = props.stage(lm['x'], lm['y'], lm['s'])
        elif k == 'skyboat':
            obs = props.skyboat(lm['x'], lm['y'], lm['s'])
        elif k == 'well':
            obs = props.well(lm['x'], lm['y'], lm['s'])
        elif k == 'flower_cart':
            obs = props.flower_cart(lm['x'], lm['y'], lm['s'])
        elif k == 'mine':
            obs = props.mine_entrance(lm['x'], lm['y'], lm['s'])
        elif k == 'vane':
            obs = props.weather_vane(lm['x'], lm['y'], lm['s'])
        elif k == 'bench':
            obs = props.bench(lm['x'], lm['y'], lm['s'])
        else:
            obs = props.pedestal(lm['x'], lm['y'], lm['s'])
        built[lm['id']] = (lm, obs)
        if extra:
            built[extra[0]] = (dict(id=extra[0], kind='sails', x=lm['x'], y=lm['y'], tex='', hub=world_to_board_v(extra[2])), extra[1])
    for _, obs in built.values():
        for o in obs:
            lib.shadow_only(o)

    frame = FRAME
    lib.camera_for_region(*frame, scale=SCALE)
    if A.crop:
        x0, y0, x1, y1 = [float(v) for v in A.crop.split(',')]
        lib.set_border((x0, y0, x1, y1), frame)
        lib.render_to(os.path.join(out, 'crop.png'))
        return
    if not A.props_only:
        lib.render_to(os.path.join(out, 'terrain.png'))
        if A.export:
            export_tiles(os.path.join(out, 'terrain.png'))
    if A.export or A.props_only:
        render_props(built, terrain_objs, frame)
    print('islands', len(island_info))


main()
