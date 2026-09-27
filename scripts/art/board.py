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
    THEMES, barrel, build_island, bush, crate, crystal_cluster, dist_at, flower_bed, grass_tuft, hay_bale, island_material, level_contour,
    mushroom_cluster, orient, resample, rock, stepping_stone, tree_pine, tree_round, vine,
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
    # the channel over the lip
    v, f = lib.box(((w0.x + c.x) / 2, (w0.y + c.y) / 2, 0.006), (0.16, math.hypot(w0.x - c.x, w0.y - c.y), 0.01), rot_z=math.atan2(w0.y - c.y, w0.x - c.x) - math.pi / 2)
    pond_mb.add(v, f, (1, 1, 1, 1))
    return True


def main():
    sc = lib.reset(SAMPLES)
    # Lower, warmer key light than before: longer shadows give the diorama a clear light direction.
    lib.world_light(0.72)
    lib.sun(energy=3.9, elevation=40, azimuth=-35, angle=2.5, color='#ffe9c9')
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
        for _ in range(int(area / (19 * 19))):
            j = rnd.randrange(len(xs))
            bx = xs[j] * GRID + rnd.uniform(0, GRID)
            by = ys[j] * GRID + rnd.uniform(0, GRID)
            if dist_in(dist, bx, by) < 6 or pmask_at(pm, bx, by) > 0.3:
                continue
            grass_tuft(grass, bx, by, rnd, rnd.uniform(0.8, 1.3))
        for _ in range(int(area / 20000 * T['flowers'])):
            pt = pick(min_edge=20, path_clear=0.02, node_r=78)
            if pt:
                flower_bed(flowers, leaves, *pt, rnd)
        for _ in range(int(area / 16000 * T['bushes'])):
            pt = pick(min_edge=12, max_edge=120, path_clear=0.01, node_r=92)
            if pt and canopy_clear(pt[0], pt[1], 40, 60):
                bush(leaves, *pt, rnd, rnd.uniform(0.7, 1.2), berries=flowers)
        for _ in range(int(area / 32000 * T['rocks'])):
            pt = pick(path_clear=0.08, node_r=70)
            if pt:
                rock(rocks, *pt, rnd, rnd.uniform(0.8, 1.4))
        # region clutter
        for _ in range(int(area / 26000 * T.get('mushrooms', 0))):
            pt = pick(min_edge=10, path_clear=0.02, node_r=70)
            if pt:
                mushroom_cluster(flowers, *pt, rnd)
        for _ in range(int(area / 22000 * T.get('crystals', 0))):
            pt = pick(min_edge=14, path_clear=0.02, node_r=80)
            if pt:
                crystal_cluster(crystals, *pt, rnd, rnd.uniform(0.8, 1.3))
        for _ in range(int(area / 45000 * T.get('hay', 0))):
            pt = pick(min_edge=24, path_clear=0.01, node_r=95)
            if pt:
                hay_bale(wood, *pt, rnd)
        for _ in range(int(area / 40000 * T.get('crates', 0))):
            pt = pick(min_edge=18, path_clear=0.01, node_r=90)
            if pt:
                (crate if rnd.random() < 0.6 else barrel)(wood, *pt, rnd)
        if falls_left.get(theme, 0) > 0 and len(ring) > 20:
            ok = add_waterfall(water, ponds, rocks, ring, nrm, pm, rnd)
            print('waterfall', theme, ids[:3], ok)
            if ok:
                falls_left[theme] -= 1
        # pebbles lining the trails
        for _ in range(int(area / 2600)):
            pt = pick(path_clear=1.1)
            if not pt:
                continue
            v = pmask_at(pm, *pt)
            if 0.18 < v < 0.5:
                rock(rocks, *pt, rnd, 0.35, moss=False)
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
