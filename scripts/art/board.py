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
    THEMES, barrel, build_island, bush, crate, crystal_cluster, dist_at, fence_run, flower_bed, grass_tuft, hay_bale, island_material_fine, lamp_post,
    leaf_material, level_contour, mushroom_cluster, orient, paving_material, resample, rock, scatter_mat, shrine_platform, stepping_stone,
    tree_blossom, tree_maple, tree_pine, tree_round, vine, willow,
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
    p.add_argument('--plan', action='store_true', help='draw the valley layout map (plan.png) and exit without rendering')
    p.add_argument('--bands', type=int, default=1, help='render the terrain in N horizontal bands (saved as they finish), then stitch')
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
# Relic shrines: a mosaic platform baked into the terrain behind each relic gate (under the space
# disc, so it never hides it) and a slim cradle sprite at its back that the floating relic sits over
# (the game draws the relic at the gate, 170 px up). The cradle stays clear of the space disc, which
# reaches 44 px behind the space.
RELIC_GATES = ['go4', 'c2', 't4', 'd3', 'o2']
SHRINES = []  # (board x, board y) of each platform centre
for _g in RELIC_GATES:
    _n = next(n for n in DATA['nodes'] if n['id'] == _g)
    SHRINES.append((_n['x'], _n['y'] - 40))
    LANDMARKS.append(dict(id=f'pedestal-{_g}', kind='pedestal', x=_n['x'], y=_n['y'] - 85, s=1.0, r=0, tex='relic-pedestal'))

# Points along every trail (spaces plus samples along each edge): tall scenery must never hide them.
PATH_PTS = [(n['x'], n['y']) for n in NODES.values()]
for _e in EDGES:
    _a, _b = NODES[_e['from']], NODES[_e['to']]
    for _t in np.linspace(0, 1, 8):
        PATH_PTS.append((_a['x'] + (_b['x'] - _a['x']) * _t, _a['y'] + (_b['y'] - _a['y']) * _t))
PATH_PTS = np.array(PATH_PTS)


def canopy_clear(bx, by, width, height):
    """True if no path/space lies in the screen area a tall object at (bx, by) would cover."""
    m = (np.abs(PATH_PTS[:, 0] - bx) < width) & (PATH_PTS[:, 1] < by + 20) & (PATH_PTS[:, 1] > by - height)
    return not m.any()


# Rendered area in board px (a margin around the board for hanging island undersides).
FRAME = (-120, -60, W + 240, H + 200)
TILE = 1024


def crisp(path, radius=1.1, amount=55):
    """A light unsharp mask on the colour (not the alpha) of a finished render: the denoiser leaves
    fine texture a little soft, and the board is seen up close next to crisp character sprites.
    Transparent pixels first take the nearest opaque colour, so silhouettes get no bright rim."""
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im)
    solid = a[..., 3] > 250
    if not solid.any():
        return
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    filled = Image.fromarray(np.ascontiguousarray(a[..., :3][iy, ix]), 'RGB')
    del iy, ix
    rgb = filled.filter(ImageFilter.UnsharpMask(radius=radius, percent=amount, threshold=2))
    Image.merge('RGBA', (*rgb.split(), im.getchannel('A'))).save(path)


def render_bands(frame, n, path, overlap=24):
    """Render the terrain as n horizontal bands (each saved as soon as it is done, so a long render
    on the shared machine shows progress and a failure costs one band), then stitch them. Bands
    overlap a little and are cut in the middle of the overlap, so the denoiser leaves no seam; each
    band's row offset is checked against its neighbour in case the border rounds by a pixel."""
    fx, fy, fw, fh = frame
    rh = int(round(fh * SCALE))
    cuts = [round(rh * i / n) for i in range(n + 1)]
    bands = []
    for i in range(n):
        y0, y1 = max(0, cuts[i] - overlap), min(rh, cuts[i + 1] + overlap)
        band = os.path.join(os.path.dirname(path), f'band_{i}.png')
        if os.path.exists(band) and os.environ.get('BOARD_REUSE_BANDS'):
            print('band', i, 'reused')
        else:
            lib.set_border((fx, fy + y0 / SCALE, fx + fw, fy + y1 / SCALE), frame)
            lib.render_to(band)
            print('band', i, 'done', flush=True)
        im = Image.open(band).convert('RGBA')
        top = y0
        if bands:
            pim, ptop = bands[-1]
            pa, ca = np.asarray(pim, np.float32), np.asarray(im, np.float32)
            best = None
            for d in range(-3, 4):
                t = y0 + d
                r0, r1 = max(t, ptop), min(ptop + pim.height, t + im.height)
                if r1 - r0 < 8:
                    continue
                a_, b_ = pa[r0 - ptop:r1 - ptop], ca[r0 - t:r1 - t]
                mask = (a_[..., 3] > 250) & (b_[..., 3] > 250)
                if mask.sum() < 100:
                    continue
                err = float(np.abs(a_[..., :3] - b_[..., :3])[mask].mean())
                if best is None or err < best[0]:
                    best = (err, d)
            if best:
                top = y0 + best[1]
                print('band', i, 'offset', best[1], 'overlap error %.2f' % best[0])
        bands.append((im, top))
    full = Image.new('RGBA', (bands[0][0].width, rh), (0, 0, 0, 0))
    for i, (im, top) in enumerate(bands):
        a, b = cuts[i], cuts[i + 1]
        full.paste(im.crop((0, a - top, im.width, b - top)), (0, a))
    lib.clear_border()
    full.save(path)


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
        dr.line([(a['x'] / s, a['y'] / s), (b['x'] / s, b['y'] / s)], fill=255, width=int(84 / s))
    for n in NODES.values():
        r = 72 / s
        dr.ellipse([n['x'] / s - r, n['y'] / s - r * 0.8, n['x'] / s + r, n['y'] / s + r * 0.8], fill=255)
    img = img.filter(ImageFilter.GaussianBlur(2.6))
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


def near_shrine(bx, by, pad=0.0):
    rx = terrain.SHRINE_R * PX + 6
    ry = rx * COSB
    return any(((bx - sx) / (rx + pad)) ** 2 + ((by - sy) / (ry + pad)) ** 2 < 1.0 for (sx, sy) in SHRINES)


def near_landmark(bx, by, pad=0.0):
    if near_shrine(bx, by, pad):
        return True
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
        crisp(png, amount=40)
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
    return lib.falls_material('water', -0.02, -3.6)


def pond_material():
    """Calm stylised water: clear teal-blue with a soft deeper mottle, fine wind ripples (thin pale
    bands) and a glossy coat that picks up the sky. (Big pale noise blotches read as a pasted-on
    texture.)"""
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
    stretch = m.node('ShaderNodeVectorMath', operation='MULTIPLY')
    m.link(pos, stretch.inputs[0])
    stretch.inputs[1].default_value = (1.0, 2.2, 1.0)
    m.link(stretch.outputs['Vector'], wv.inputs['Vector'])
    ripple = m.maprange(wv.outputs['Fac'], 0.9, 0.985)
    rn = m.noise(2.4, 2, 0.5, pos)
    ripple = m.math('MULTIPLY', ripple, m.maprange(rn.outputs['Fac'], 0.5, 0.64))
    c = m.mix(m.math('MULTIPLY', ripple, 0.4), c, lib.col('#bff0ff'))
    m.bsdf(c, 0.06, emission=c, emission_strength=0.14, coat=1.0)
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
            uu = i / cols * 2 - 1
            u = uu * 0.5 * width * (1 + 0.35 * t)
            bulge = 0.07 * (1 - uu * uu)  # rounded, not a flat card
            verts.append((w0.x + ox * (out + bulge) + px * u, w0.y + oy * (out + bulge) + py * u, z))
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
        SPLASH.append(lib.world_to_board((lx, ly, 0.0)))  # the valley brook starts here
    for k in range(9 if not A.no_lowland else 0):
        a = k / 9 * math.tau
        v, f = lib.blob((lx + math.cos(a) * 0.3, ly + math.sin(a) * 0.2, LOW_Z + 0.08), rnd.uniform(0.08, 0.14), squash=(1.2, 1.0, 0.45), rough=0.3, subdiv=1, seed=k * 7)
        water_mb.add(v, f, (1, 1, 1, 1))
    # the channel over the lip
    v, f = lib.box(((w0.x + c.x) / 2, (w0.y + c.y) / 2, 0.006), (0.16, math.hypot(w0.x - c.x, w0.y - c.y), 0.01), rot_z=math.atan2(w0.y - c.y, w0.x - c.x) - math.pi / 2)
    pond_mb.add(v, f, (1, 1, 1, 1))
    return True


# ------------------------------------------------------------------------------------------
# Lowland: a valley below the plateaus, so every view is filled with ground instead of sky.
LOW_Z = -2.6
LOW_SHIFT = -LOW_Z * PX * lib.SINB  # a lowland point appears this many px below its board y
HAZE = '#b8d6ee'  # the valley is further from the camera: a little cooler, softer and hazier
SPLASH: list = []  # board px of waterfall splash pools on the valley floor (recorded by add_waterfall)
ZRES = 2  # board px per texel of the valley zone maps

# The valley floor is laid out as a few distinct places around the festival. Coordinates are valley
# board px: a point (x, y) down there is drawn at screen (x, y + LOW_SHIFT). Every piece is still
# checked against what the camera can see and kept off the plateaus' footprint.
VALLEY = dict(
    # brooks through control points ('splash' = the waterfall's pool); crossings at fractions of length
    brooks=[
        # the waterfall spills into a brook that winds down to the festival pond
        dict(pts=['splash', (2182, 884), (2072, 906), (1978, 948), (1888, 1012), (1806, 1074), (1730, 1134)],
             w=22, bridges=[0.46]),
        # the west brook chains the north-west pond to the two south-west ponds
        dict(pts=[(486, 668), (452, 768), (394, 884), (350, 1012), (340, 1150), (364, 1290), (402, 1420), (386, 1560),
                  (342, 1690), (320, 1830), (346, 1962), (402, 2062), (476, 2138)], w=24, bridges=[0.37], stones=[0.73]),
        dict(pts=[(752, 2240), (800, 2262), (848, 2284)], w=30, bridges=[0.5]),
    ],
    # trodden footpaths across the meadow (painted into the grass)
    paths=[
        [(1996, 900), (1990, 950), (1962, 1062), (1908, 1196), (1838, 1316), (1762, 1400)],
    ],
    # patchwork farmland: box (x0, y0, x1, y1), column / row fractions, crop per cell (row-major)
    farms=[
        dict(box=(1862, 172, 2238, 298), cols=[0.56, 0.44], rows=[1.0], kinds=['wheat', 'lavender']),
        dict(box=(2304, 156, 2588, 248), cols=[0.55, 0.45], rows=[1.0], kinds=['wheat', 'crops']),
        dict(box=(3084, 210, 3440, 330), cols=[0.36, 0.3, 0.34], rows=[1.0], kinds=['wheat', 'flowers', 'wheat']),
        dict(box=(3532, 396, 3868, 688), cols=[0.52, 0.48], rows=[0.36, 0.3, 0.34],
             kinds=['lavender', 'wheat', 'wheat', 'crops', 'ploughed', 'wheat']),
        dict(box=(3084, 2190, 3310, 2320), cols=[1.0], rows=[1.0], kinds=['crops']),
        dict(box=(2664, 2390, 3376, 2562), cols=[0.35, 0.3, 0.35], rows=[1.0], kinds=['wheat', 'lavender', 'ploughed']),
    ],
    cottage=(2880, 2250),
    orchard=dict(x0=2655, y0=1352, cols=5, rows=3, dx=78, dy=76, fruit=['#e8433a', '#ff9a2e', '#e8433a']),
    festival=dict(cx=1615, cy=1478, rx=225, ry=112,
                  tents=[('pavilion', 1470, 1420, 0.42, ('#ff6b5e', '#fff4dc')),
                         ('stall', 1640, 1394, 0.95, ('#1fa5a0', '#fff4dc')),
                         ('pavilion', 1792, 1448, 0.36, ('#f4b83b', '#fff4dc'))],
                  poles=[(1478, 1578), (1762, 1590)]),
    # woods (cx, cy, rx, ry, trees, species) and a few birches along the west brook
    groves=[(3975, 950, 100, 170, 7, 'pine'), (3990, 1480, 90, 170, 7, 'mixed'), (205, 2240, 100, 120, 6, 'mixed'),
            (1440, 2470, 160, 70, 6, 'round'), (2230, 2470, 170, 70, 7, 'mixed'), (660, 185, 170, 70, 6, 'mixed'),
            (1270, 200, 150, 70, 5, 'pine'), (1255, 1660, 80, 70, 4, 'round'), (3120, 1160, 70, 100, 4, 'round'),
            (2600, 2240, 60, 50, 3, 'round')],
    birches=[(1, 0.24, 1), (1, 0.28, 1), (1, 0.56, -1), (1, 0.61, -1), (1, 0.86, -1)],
)

FIELD = {  # soil colour under the rows, row spacing / plant step / edge margin (px)
    'wheat': dict(soil='#c49646', gap=11, step=10, margin=4),
    'lavender': dict(soil='#6f7a4a', gap=16, step=7, margin=7),
    'crops': dict(soil='#8a6843', gap=15, step=13, margin=8),
    'ploughed': dict(soil='#8a6446', gap=10, step=14, margin=5),
    'flowers': dict(soil='#679044', gap=12, step=8, margin=6),
}
FEST = ['#ff6b5e', '#f4b83b', '#1fa5a0', '#fff4dc']  # coral, gold, teal, cream

# The festival district in the two valleys inside the loop (valley board px). West: the Lantern Fair
# round the pond (a market street on the north shore under strings of lanterns, a pier with a
# rowboat, the fair with a carousel, a Ferris wheel, a bandstand and flower beds). East: quieter
# gardens round the orchard pond (a greenhouse, a picnic lawn, a pier, beehives and a camp). Every
# piece is checked against what the camera sees, the water, the trails above and its neighbours.
STRIPE = [('#ff6b5e', '#fff4dc'), ('#1fa5a0', '#fff4dc'), ('#f4b83b', '#fff4dc'), ('#8e5cd9', '#fff4dc'), ('#ff8fb1', '#fff4dc'), ('#3f9ee0', '#fff4dc')]
MIMI = (2020, 1500 - 160)  # the game stands Mimi on the valley floor here (board 2020, 1500 on screen)
DISTRICT = dict(
    lanes=[
        # west: from the pier's foot round the pond's west shore to the market street on the north shore
        dict(pts=[(1700, 1352), (1545, 1352), (1470, 1345), (1395, 1310), (1345, 1215), (1352, 1100), (1440, 1024), (1560, 1004), (1680, 1012), (1735, 1052)], w=18),
        dict(pts=[(1395, 1310), (1350, 1355), (1310, 1395)], w=13),
        dict(pts=[(1352, 1100), (1300, 1050), (1268, 1024)], w=13),
        # east: along the orchard pond's west shore up to the greenhouse, and along its south shore to the pier
        dict(pts=[(2800, 1575), (2650, 1578), (2572, 1485), (2556, 1340), (2578, 1200), (2598, 1060), (2590, 925)], w=16),
        dict(pts=[(2562, 1300), (2680, 1306), (2800, 1308), (2900, 1292)], w=12),
    ],
    items=[
        # --- west: the Lantern Fair
        dict(kind='ferris', x=1262, y=994, s=1.0),
        dict(kind='booth', x=1440, y=955, s=1.0, stripe=0, goods='fruit'),
        dict(kind='booth', x=1552, y=944, s=1.0, stripe=1, goods='toys'),
        dict(kind='booth', x=1664, y=952, s=1.0, stripe=2, goods='flowers'),
        dict(kind='booth', x=1250, y=1128, s=0.95, stripe=3, goods='pots'),
        dict(kind='beds', x=1252, y=1242, cols=2, rows=2),
        dict(kind='bandstand', x=1292, y=1444, s=1.0),
        dict(kind='bench', x=1334, y=1516, yaw=0.5),
        dict(kind='bench', x=1392, y=1488, yaw=0.9),
        dict(kind='pier', pond=0, x=1545, reach=100, boat=(1602, 1252, 0.35)),
        dict(kind='carousel', x=1606, y=1532, s=1.0),
        dict(kind='parasol', x=1440, y=1580, stripe=0),
        dict(kind='parasol', x=1515, y=1636, stripe=1),
        dict(kind='cart', x=1772, y=1528, stripe=4),
        dict(kind='picnic', x=1392, y=1662, yaw=0.3, cloth=0),
        dict(kind='picnic', x=1700, y=1668, yaw=-0.4, cloth=1),
        dict(kind='signpost', x=1404, y=1372),
        dict(kind='blossom', x=1112, y=1085),
        dict(kind='blossom', x=1242, y=1332),
        dict(kind='blossom', x=1330, y=1580),
        dict(kind='blossom', x=1855, y=1228, pal=('#e7e0f4', '#ffffff')),
        dict(kind='willow', x=1795, y=1300),
        dict(kind='maple', x=1480, y=1738),
        dict(kind='blossom', x=1915, y=1120),
        # --- east: the orchard gardens
        dict(kind='greenhouse', x=2590, y=880, s=1.0),
        dict(kind='pier', pond=4, x=2900, reach=95, boat=(2960, 1214, -0.45)),
        dict(kind='picnic', x=2722, y=968, yaw=0.2, cloth=2),
        dict(kind='picnic', x=2890, y=948, yaw=-0.3, cloth=0),
        dict(kind='parasol', x=2806, y=905, stripe=5),
        dict(kind='beds', x=2980, y=905, cols=2, rows=1),
        dict(kind='beehives', x=3042, y=1446),
        dict(kind='scarecrow', x=2880, y=1560),
        dict(kind='cart', x=2742, y=1624, stripe=2),
        dict(kind='camp', x=2872, y=1668),
        dict(kind='willow', x=3048, y=1238),
        dict(kind='blossom', x=2532, y=1122),
        dict(kind='blossom', x=3040, y=1378),
        dict(kind='blossom', x=2698, y=874, pal=('#e7e0f4', '#ffffff')),
        dict(kind='maple', x=3122, y=884),
        # --- a few touches round the outer meadows
        dict(kind='pier', pond=3, x=560, reach=90, boat=(612, 600, 0.5)),
        dict(kind='camp', x=272, y=1204),
        dict(kind='blossom', x=240, y=1560),
        dict(kind='blossom', x=1010, y=236),
        dict(kind='blossom', x=1570, y=232),
        dict(kind='picnic', x=1660, y=290, yaw=0.25, cloth=4),
        dict(kind='maple', x=3870, y=1070),
        dict(kind='blossom', x=3830, y=1320),
        dict(kind='maple', x=3790, y=1860),
    ],
    # lantern strings between poles along the market street (pole positions, valley board px)
    poles=[(1392, 1040), (1502, 1030), (1612, 1032), (1716, 1050)],
)
# footprint half-sizes (board px across, board px deep) and height (world units) of each kind
DISTRICT_SIZE = dict(ferris=(66, 24, 2.2), booth=(52, 30, 1.2), beds=(96, 34, 0.2), bandstand=(62, 48, 1.2), bench=(24, 12, 0.3),
                     carousel=(80, 64, 1.7), parasol=(32, 26, 0.8), cart=(36, 24, 0.9), picnic=(26, 22, 0.2), signpost=(14, 10, 0.5),
                     blossom=(40, 32, 2.1), willow=(56, 44, 1.6), maple=(46, 36, 2.2), greenhouse=(50, 26, 0.7), beehives=(34, 14, 0.3),
                     scarecrow=(22, 10, 0.7), camp=(36, 34, 0.35), hay=(40, 20, 0.3))


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


def _zone_image(m, path, colorspace):
    """Image texture node sampling a board-sized map at the ground point (like the trail mask)."""
    mp = m.node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (PX / W, lib.COSB * PX / H, 1.0)
    mp.inputs['Location'].default_value = (0.0, 1.0, 0.0)
    m.link(m.position(), mp.inputs['Vector'])
    img = m.node('ShaderNodeTexImage')
    img.image = bpy.data.images.load(path)
    img.image.colorspace_settings.name = colorspace
    img.extension = 'EXTEND'
    img.interpolation = 'Linear'
    m.link(mp.outputs['Vector'], img.inputs['Vector'])
    return img.outputs['Color']


def lowland_material(col_path, fac_path):
    m = lib.NT('lowland')
    pos = m.position()
    nz = m.sep(m.normal())[2]
    zcol = _zone_image(m, col_path, 'sRGB')  # crop soils, yards, banks
    cov, warmth, _ = m.sep(_zone_image(m, fac_path, 'Non-Color'))  # R coverage, G meadow warmth
    n1 = m.noise(0.45, 5, 0.6, pos)
    n2 = m.noise(4.0, 3, 0.5, pos)
    gfac = m.math('ADD', m.math('MULTIPLY', n1.outputs['Fac'], 0.8), m.math('MULTIPLY', n2.outputs['Fac'], 0.35))
    # large patches of cool deep meadow and warm yellow-green meadow (both softer than the plateaus)
    cool = m.ramp(gfac, [(0.28, '#306d49'), (0.42, '#3d8053'), (0.55, '#4c9559'), (0.68, '#61a865'), (0.82, '#80be7a')])
    warm = m.ramp(gfac, [(0.28, '#658d36'), (0.42, '#7aa33f'), (0.55, '#90b847'), (0.68, '#a9c854'), (0.82, '#c3d66a')])
    grass = m.mix(m.maprange(warmth, 0.28, 0.72), cool, warm)
    # hue noise: soft mottling between yellower and bluer greens
    h1 = m.noise(1.3, 2, 0.5, pos)
    grass = m.mix(m.math('MULTIPLY', m.maprange(h1.outputs['Fac'], 0.4, 0.66), 0.24), grass, lib.col('#a9c763'))
    h2 = m.noise(0.8, 2, 0.5, pos)
    grass = m.mix(m.math('MULTIPLY', m.maprange(h2.outputs['Fac'], 0.42, 0.68), 0.2), grass, lib.col('#4e9a7a'))
    # fine clumps, speckle and tiny wild flowers (as on the plateaus, a little sparser)
    grass = terrain.grass_detail(m, pos, grass, flowers=0.75, keep_off=m.maprange(cov, 0.35, 0.05))
    zc = m.mult(zcol, m.mix(n2.outputs['Fac'], lib.col('#e2e2e2'), lib.col('#ffffff')))
    # grain on soils, yards and lanes: pebbles and a fine mottle
    zv = m.voronoi(26.0, pos)
    zc = m.mult(zc, m.mix(m.maprange(zv.outputs['Distance'], 0.32, 0.18), lib.col('#ffffff'), lib.col('#fff4e0')))
    zn = m.noise(30.0, 2, 0.5, pos)
    zc = m.mult(zc, m.mix(m.maprange(zn.outputs['Fac'], 0.4, 0.64), lib.col('#ffffff'), lib.col('#d8ccb8')))
    ground = m.mix(cov, grass, zc)
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
    colr = m.mix(top, rock, ground)
    # soft blue-green occlusion (not near-black) and a little height haze
    colr = m.mult(colr, m.mix(terrain.cam_ao(m, 0.7, 5), lib.col('#7f9a94'), lib.col('#ffffff')))
    colr = m.mix(0.08, colr, lib.col(HAZE))
    m.bsdf(colr, 0.85, normal=m.bump(m.math('ADD', rn.outputs['Fac'], m.math('MULTIPLY', gfac, 0.2)), 0.3, 0.08), sheen=0.2,
           emission=lib.col(HAZE), emission_strength=0.015)
    return m.mat


def low_mat(name, rough=0.75, ao=0.4, haze=0.05, lift=0.012, sheen=0.0, subsurface=0.0):
    """Vertex-colour material for valley scatter: soft blue-green occlusion, a touch of haze and a
    faint sky lift so shadowed foliage reads blue-green rather than black."""
    m = lib.NT(name)
    c = m.attr('col')
    if ao:
        c = m.mult(c, m.mix(terrain.cam_ao(m, ao, 4), lib.col('#8aa29a'), lib.col('#ffffff')))
    c = m.mix(haze, c, lib.col(HAZE))
    m.bsdf(c, rough, sheen=sheen, subsurface=subsurface, emission=lib.col(HAZE), emission_strength=lift)
    return m.mat


def glow_material(strength=2.4):
    """Warm emissive bulbs and lanterns (vertex colour). Not sampled as lights: there are hundreds of
    tiny ones, and the baked bloom gives them their halo."""
    m = lib.NT('low_glow_m')
    c = m.attr('col')
    m.bsdf(c, 0.3, emission=c, emission_strength=strength)
    m.mat.cycles.emission_sampling = 'NONE'
    return m.mat


def glass_material():
    """Greenhouse glass: pale, glossy and slightly see-through-looking without real refraction."""
    m = lib.NT('low_glass_m')
    c = m.attr('col')
    b = m.bsdf(c, 0.08, coat=0.9, emission=c, emission_strength=0.12)
    b.inputs['Specular IOR Level'].default_value = 0.8
    return m.mat


def lowland_height(x, y):
    """Gentle rolling ground (world units, applied on top of LOW_Z)."""
    return 0.2 * noise.noise(Vector((x * 0.16, y * 0.16, 7.7)))


# ------------------------------------------------------------------------------------------
# Valley pieces (authored at z = 0 in board px / world units, dropped onto the valley floor later)
def _srgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def catmull(pts, step=5.0):
    """Smooth open curve through pts (board px), resampled evenly every `step` px."""
    P = [np.asarray(p, float) for p in pts]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        n = max(4, int(np.linalg.norm(p2 - p1) / 2))
        for k in range(n):
            t = k / n
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(P[-2])
    poly = np.array(out)
    seg = np.linalg.norm(np.diff(poly, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, s[-1], max(2, int(s[-1] / step) + 1))
    return np.stack([np.interp(t, s, poly[:, 0]), np.interp(t, s, poly[:, 1])], 1)


def brook_ribbon(water, line, widths):
    """Water ribbon along a brook centreline (three verts across so it follows the rolling ground)."""
    tang = np.gradient(line, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True) + 1e-9
    nrm = np.stack([-tang[:, 1], tang[:, 0]], 1)
    verts, faces = [], []
    for i in range(len(line)):
        for u in (-0.5, 0.0, 0.5):
            q = line[i] + nrm[i] * widths[i] * u
            verts.append(tuple(board_to_world(q[0], q[1], 0.026)))
    for i in range(len(line) - 1):
        a = 3 * i
        faces += [(a, a + 1, a + 4, a + 3), (a + 1, a + 2, a + 5, a + 4)]
    water.add(verts, orient(faces, verts, lambda c: Vector((0, 0, 1))), (1, 1, 1, 1))
    return nrm


def footbridge(wood, bx, by, nx, ny, span, rnd):
    """Little arched plank bridge crossing a brook at (bx, by) along the board direction (nx, ny)."""
    A = board_to_world(bx - nx * span / 2, by - ny * span / 2, 0.0)
    B = board_to_world(bx + nx * span / 2, by + ny * span / 2, 0.0)
    d = B - A
    L = d.length
    d.normalize()
    side = Vector((-d.y, d.x, 0.0))
    yaw = math.atan2(d.y, d.x)
    rise, width = 0.11, 0.21

    def deck(t):
        u = t * 2 - 1
        return 0.05 + rise * (1 - u * u)

    n = max(7, int(L / 0.07))
    for k in range(n):
        t = (k + 0.5) / n
        slope = -4 * (t * 2 - 1) * rise / L
        c = A + d * (t * L)
        v, f = lib.box((0, 0, 0), (L / n * 0.86, width + rnd.uniform(-0.01, 0.015), 0.028))
        v = lib.transform(v, loc=(c.x, c.y, deck(t)), rot=(0.0, -math.atan(slope), yaw))
        wood.add(v, f, col(rnd.choice(['#b98a55', '#a87a48', '#c49660'])))
    for sgn in (-1, 1):
        rail = []
        for t in (0.0, 0.5, 1.0):
            c = A + d * (t * L) + side * (sgn * width * 0.5)
            v, f = lib.cylinder((c.x, c.y, 0.0), 0.018, 0.016, deck(t) + 0.15, 6)
            wood.add(v, f, col('#7a5234'))
        for k in range(9):
            t = k / 8
            c = A + d * (t * L) + side * (sgn * width * 0.5)
            rail.append((c.x, c.y, deck(t) + 0.14))
        v, f = lib.tube(rail, 0.013, 6)
        wood.add(v, f, col('#8a5e3a'))


def brook_stones(stones, bx, by, nx, ny, tx, ty, width, rnd):
    """A row of flat stepping stones across a brook."""
    for k in range(4):
        u = (k / 3 - 0.5) * (width + 24)
        j = rnd.uniform(-5, 5)
        p = board_to_world(bx + nx * u + tx * j, by + ny * u + ty * j, 0.0)
        r = rnd.uniform(0.075, 0.092)
        v, f = lib.blob((p.x, p.y, 0.026), r, squash=(1.2, 1.0, 0.42), rough=0.14, freq=2.0, subdiv=2, seed=rnd.random() * 50)
        stones.add(v, f, lambda vv, z0=0.026 + r * 0.2: col('#c9c2b6') if vv[2] > z0 else col('#8f8890'))


def field_rows(mbs, fld, rnd):
    """Neat crop rows on a field (rows run along its long side)."""
    kind = fld['kind']
    x0, y0, x1, y1 = fld['box']
    spec = FIELD[kind]
    along_x = (x1 - x0) >= (y1 - y0)
    La, Lc = (x1 - x0, y1 - y0) if along_x else (y1 - y0, x1 - x0)
    m = spec['margin']
    nrow = max(1, int((Lc - 2 * m) / spec['gap']) + 1)
    off = (Lc - (nrow - 1) * spec['gap']) / 2
    for j in range(nrow):
        c = off + j * spec['gap']
        npts = max(2, int((La - 2 * m) / spec['step']) + 1)
        ts = list(np.linspace(m, La - m, npts))
        if kind in ('wheat', 'ploughed') and La - 2 * m > 30:  # extra rings near the ends for rounded, blunt tips
            ts = [m, m + 1.2, m + 3.0] + list(np.linspace(m + 6, La - m - 6, max(2, npts - 2))) + [La - m - 3.0, La - m - 1.2, La - m]
        pts = [((x0 + t, y0 + c) if along_x else (x0 + c, y0 + t)) for t in ts]
        if kind in ('wheat', 'ploughed'):
            wheat = kind == 'wheat'
            r0, z0, flat = (0.066, 0.016, 0.5) if wheat else (0.036, 0.0, 1.0)
            lo, hi = (col('#c9953d'), col('#f5d67a')) if wheat else (col('#6e4c32'), col('#a88158'))
            p3 = [tuple(board_to_world(px + rnd.uniform(-0.4, 0.4), py, z0)) for (px, py) in pts]
            R = 6.0  # px: rounded end caps
            radii = []
            for t in ts:
                d = min(t - m, La - m - t)
                cap = math.sqrt(max(0.0, 1 - (1 - min(d, R) / R) ** 2))
                radii.append(r0 * cap * (rnd.uniform(0.92, 1.06) if wheat and d > R else 1.0))

            def rad(t, radii=radii):
                return radii[min(len(radii) - 1, int(round(t * (len(radii) - 1))))]

            v, f = lib.tube(p3, rad, 7)
            v = [(x_, y_, z0 + (z_ - z0) * flat) for (x_, y_, z_) in v]
            tint = rnd.uniform(-0.04, 0.04)

            def shade(vv, lo=lo, hi=hi, z0=z0, h=r0 * flat, tint=tint, wheat=wheat):
                t = (vv[2] - z0 + h) / (2 * h) + tint
                if wheat:  # soft light and dark bands, like wind moving over the crop
                    t += 0.07 * math.sin(vv[0] * 2.3 + vv[1] * 1.1) + 0.04 * math.sin(vv[0] * 5.1 - vv[1] * 3.7)
                return lib.lerp_col(lo, hi, max(0.0, min(1.0, t)) ** 0.8)

            mbs['field'].add(v, f, shade)
        else:
            for (px, py) in pts:
                p = board_to_world(px + rnd.uniform(-1.2, 1.2), py + rnd.uniform(-1.0, 1.0), 0.0)
                if kind == 'lavender':
                    r, cz, lo, hi = rnd.uniform(0.056, 0.066), 0.044, col('#553d98'), col('#b692f2')
                elif kind == 'crops':
                    r, cz, lo, hi = rnd.uniform(0.047, 0.055), 0.03, col('#469634'), col('#c4ec8e')
                else:
                    r, cz = rnd.uniform(0.032, 0.038), 0.05
                    lo = col(['#e2574c', '#e39a2c', '#e9dcc0'][j % 3])
                    hi = col(['#ff8a7a', '#ffd16a', '#fffaf0'][j % 3])
                    v, f = lib.blob((p.x, p.y, 0.02), 0.03, squash=(1.3, 1.0, 0.6), rough=0.1, subdiv=1, seed=rnd.random() * 9)
                    mbs['field'].add(v, f, col('#4f8f3a'))
                v, f = lib.blob((p.x, p.y, cz), r, squash=(1.0, 1.0, 0.82), rough=0.18, freq=2.4, subdiv=1, seed=rnd.random() * 40)
                mbs['field'].add(v, f, lambda vv, lo=lo, hi=hi, cz=cz, r=r: lib.lerp_col(lo, hi, max(0.0, min(1.0, (vv[2] - cz) / (r * 0.8) + 0.5))))


def hedgerow(leaves, ax, ay, bx, by, rnd):
    """A low clipped hedge between two board points."""
    L = math.hypot(bx - ax, by - ay)
    n = max(2, int(L / 8.5))
    lo, hi = col('#22583a'), col('#5f9c52')
    for k in range(n + 1):
        t = k / n
        p = board_to_world(ax + (bx - ax) * t + rnd.uniform(-1.5, 1.5), ay + (by - ay) * t + rnd.uniform(-1.5, 1.5), 0.0)
        r = rnd.uniform(0.078, 0.098)
        cz = r * 0.8
        v, f = lib.blob((p.x, p.y, cz), r, squash=(1.0, 1.0, 0.9), rough=0.2, freq=2.4, subdiv=2, seed=rnd.random() * 60)
        leaves.add(v, f, lambda vv, cz=cz, r=r: lib.lerp_col(lo, hi, max(0.0, min(1.0, (vv[2] - cz) / (r * 1.1) + 0.5)) ** 1.3))


def fruit_tree(leaves, wood, fruit, bx, by, rnd, fruit_col, s=1.0):
    """Small round orchard tree with fruit on its sunny, camera-facing side."""
    p = board_to_world(bx, by, 0.0)
    th = rnd.uniform(0.38, 0.46) * s
    tv, tf = lib.cylinder((p.x, p.y, 0.0), 0.062 * s, 0.045 * s, th + 0.18 * s, sides=8)
    wood.add(tv, tf, lambda vv: lib.lerp_col(col('#6a4428'), col('#8e5e36'), min(1.0, vv[2] / th)))
    R = rnd.uniform(0.3, 0.34) * s
    cz = th + R * 0.82
    lo, hi = col('#357a34'), col('#97cb58')
    puffs = [(0.0, 0.0, 0.0, 1.0)] + [(math.cos(a) * R * 0.5, math.sin(a) * R * 0.42, rnd.uniform(-0.12, 0.12) * R, rnd.uniform(0.55, 0.66))
                                      for a in np.linspace(0, math.tau, 4, endpoint=False) + rnd.random()]
    for (ox, oy, oz, rr) in puffs:
        r = R * rr
        v, f = lib.blob((p.x + ox, p.y + oy, cz + oz), r, squash=(1, 1, 0.9), rough=0.12, freq=1.8, subdiv=3, seed=rnd.random() * 70)
        leaves.add(v, f, lambda vv, zc=cz + oz, r=r: lib.lerp_col(lo, hi, max(0.0, min(1.0, (vv[2] - zc) / (r * 1.1) + 0.5)) ** 1.6))
    fc = col(fruit_col)
    for _ in range(rnd.randint(9, 13)):
        el = rnd.uniform(0.0, 0.95)
        az = rnd.uniform(-math.pi * 0.97, -math.pi * 0.03)
        q = (p.x + math.cos(az) * math.cos(el) * R * 1.04, p.y + math.sin(az) * math.cos(el) * R * 0.98, cz + math.sin(el) * R * 0.92)
        v, f = lib.blob(q, 0.034 * s, rough=0.0, subdiv=1)
        fruit.add(v, f, lib.lerp_col(fc, col('#ffffff'), rnd.uniform(0.0, 0.12)))


def poplar(leaves, wood, bx, by, rnd, s=1.0):
    """Slim columnar tree (field corners, lanes)."""
    p = board_to_world(bx, by, 0.0)
    h = rnd.uniform(1.6, 2.0) * s
    tv, tf = lib.cylinder((p.x, p.y, 0.0), 0.06 * s, 0.04 * s, h * 0.4, sides=8)
    wood.add(tv, tf, col('#6a4428'))
    lo, hi = col('#2d6e3e'), col('#8cc661')
    for k in range(5):
        t = k / 4
        z = h * (0.34 + 0.5 * t)
        r = (0.25 - 0.1 * t ** 1.4) * s
        v, f = lib.blob((p.x, p.y, z), r, squash=(1, 1, 1.45), rough=0.18, freq=2.2, subdiv=2, seed=rnd.random() * 30)
        leaves.add(v, f, lambda vv, h=h: lib.lerp_col(lo, hi, max(0.0, min(1.0, (vv[2] - h * 0.25) / (h * 0.85)))))


def birch(leaves, wood, bx, by, rnd, s=1.0):
    """Slender pale birch with a light, airy crown (brook sides)."""
    p = board_to_world(bx, by, 0.0)
    h = rnd.uniform(1.2, 1.45) * s
    lean = (rnd.uniform(-0.06, 0.06), rnd.uniform(-0.04, 0.04))
    pts = [(p.x + lean[0] * t * h, p.y + lean[1] * t * h, t * h) for t in np.linspace(0, 1, 12)]
    v, f = lib.tube(pts, lambda t: (0.042 - 0.018 * t) * s, 7)
    marks = {3, 6, 8, 10}  # a few dark bark marks on the pale trunk (tube rings of 7 verts)
    dark, pale = col('#56504f'), col('#f0ece2')
    base = len(wood.v)
    wood.v.extend(v)
    wood.f.extend([tuple(i + base for i in fc) for fc in f])
    wood.c.extend([dark if (i // 7) in marks and (i % 7) in (1, 2, 4) else pale for i in range(len(v))])
    lo, hi = col('#5a9437'), col('#c3df76')
    for k in range(4):
        a = k / 4 * math.tau + rnd.random()
        ox, oy = math.cos(a) * 0.14 * s, math.sin(a) * 0.1 * s
        r = rnd.uniform(0.17, 0.24) * s
        cz = h * rnd.uniform(0.72, 0.98)
        v, f = lib.blob((p.x + lean[0] * h + ox, p.y + lean[1] * h + oy, cz), r, squash=(1, 1, 0.85), rough=0.22, freq=2.2, subdiv=2, seed=rnd.random() * 30)
        leaves.add(v, f, lambda vv, cz=cz, r=r: lib.lerp_col(lo, hi, max(0.0, min(1.0, (vv[2] - cz) / (r * 1.1) + 0.5))))


def valley_pine(leaves, wood, bx, by, rnd, s=1.0):
    """Pine in the valley's lighter, cooler greens."""
    p = board_to_world(bx, by, 0.0)
    h = rnd.uniform(1.7, 2.3) * s
    tv, tf = lib.cylinder((p.x, p.y, 0.0), 0.09 * s, 0.06 * s, h * 0.35, sides=8)
    wood.add(tv, tf, col('#5e3b22'))
    lo, hi = col('#23603f'), col('#6cb47e')
    for t in range(4):
        z0 = h * (0.22 + t * 0.19)
        r0 = (0.58 - t * 0.115) * s
        hh = h * 0.34
        sides = 12
        verts = [(p.x + math.cos(a) * r0, p.y + math.sin(a) * r0, z0) for a in np.linspace(0, math.tau, sides, endpoint=False)]
        verts = [(x + noise.noise(Vector((x * 3, y * 3, z0))) * 0.05, y, z) for (x, y, z) in verts]
        verts.append((p.x, p.y, z0 + hh))
        verts.append((p.x, p.y, z0 + 0.02))
        faces = [(k, (k + 1) % sides, sides) for k in range(sides)] + [((k + 1) % sides, k, sides + 1) for k in range(sides)]
        leaves.add(verts, faces, lambda vv, z0=z0, hh=hh: lib.lerp_col(lo, hi, max(0.0, min(1.0, (vv[2] - z0) / hh))))


def pavilion(cloth, wood, metal, bx, by, r, cols, rnd):
    """Round festival tent: striped wall and roof, scalloped valance, gold finial with a pennant."""
    p = board_to_world(bx, by, 0.0)
    x, y = p.x, p.y
    n = 16
    hw, hr = r * 1.05, r * 1.5
    c1, c2 = col(cols[0]), col(cols[1])
    off = -math.pi / 2 - math.pi / n  # a stripe boundary faces the camera, the door is centred on it
    for k in range(n):
        a0, a1 = off + k / n * math.tau, off + (k + 1) / n * math.tau
        am = (a0 + a1) / 2
        dd = abs((am + math.pi / 2 + math.pi) % math.tau - math.pi)
        cc = col('#6b4a4a') if dd < 0.25 else (c1 if k % 2 else c2)
        v = [(x + math.cos(a0) * r, y + math.sin(a0) * r, 0.0), (x + math.cos(a1) * r, y + math.sin(a1) * r, 0.0),
             (x + math.cos(a1) * r, y + math.sin(a1) * r, hw), (x + math.cos(a0) * r, y + math.sin(a0) * r, hw)]
        cloth.add(v, [(0, 1, 2, 3)], cc)
    prof = [(r * 1.16, hw - 0.04), (r * 0.74, hw + hr * 0.4), (r * 0.32, hw + hr * 0.78), (0.0, hw + hr)]
    for k in range(n):
        a0, a1 = off + k / n * math.tau, off + (k + 1) / n * math.tau
        cc = c1 if k % 2 else c2
        for j in range(len(prof) - 1):
            (ra, za), (rb, zb) = prof[j], prof[j + 1]
            v = [(x + math.cos(a0) * ra, y + math.sin(a0) * ra, za), (x + math.cos(a1) * ra, y + math.sin(a1) * ra, za),
                 (x + math.cos(a1) * rb, y + math.sin(a1) * rb, zb), (x + math.cos(a0) * rb, y + math.sin(a0) * rb, zb)]
            cloth.add(v, [(0, 1, 2, 3)], cc)
        # a rounded flap hanging from the eave
        am = (a0 + a1) / 2
        ra, za = prof[0]
        fan = [(x + math.cos(am) * ra, y + math.sin(am) * ra, za)]
        for q in range(7):
            aa = a0 + (a1 - a0) * q / 6
            dz = math.sin(math.pi * q / 6) * 0.075
            fan.append((x + math.cos(aa) * ra * 1.005, y + math.sin(aa) * ra * 1.005, za - dz))
        ff = [(0, q + 1, q + 2) for q in range(6)]
        cloth.add(fan, ff, c2 if k % 2 else c1)
    top = hw + hr
    v, f = lib.cylinder((x, y, top - 0.02), 0.012, 0.01, 0.2, 6)
    wood.add(v, f, col('#5e3b22'))
    v, f = lib.blob((x, y, top + 0.2), 0.03, rough=0.0, subdiv=2)
    metal.add(v, f, col('#f2c14e'))
    tri = [(x, y, top + 0.17), (x, y, top + 0.08), (x + 0.16, y, top + 0.125)]
    cloth.add(tri, [(0, 1, 2)], c1)
    return Vector((x, y, top + 0.19))


def fair_stall(cloth, wood, goods, bx, by, s, cols, rnd):
    """Open market stall: four posts, a counter of goods and a striped canopy with scalloped flaps."""
    p = board_to_world(bx, by, 0.0)
    x, y = p.x, p.y
    Wd, D = 1.0 * s, 0.6 * s
    for (dx, dy) in [(-Wd / 2, -D / 2), (Wd / 2, -D / 2), (-Wd / 2, D / 2), (Wd / 2, D / 2)]:
        v, f = lib.cylinder((x + dx, y + dy, 0), 0.035 * s, 0.035 * s, (1.1 if dy > 0 else 0.95) * s, 8)
        wood.add(v, f, col('#6e4a2c'))
    v, f = lib.box((x, y - D / 2 + 0.1 * s, 0.26 * s), (Wd - 0.04, 0.24 * s, 0.52 * s))
    cloth.add(v, f, col(cols[1]))
    v, f = lib.box((x, y - D / 2 + 0.1 * s, 0.54 * s), (Wd + 0.04, 0.3 * s, 0.05 * s))
    wood.add(v, f, col('#8a5e3a'))
    for k in range(7):
        gx = x - Wd / 2 + 0.12 * s + k * (Wd - 0.24 * s) / 6
        v, f = lib.blob((gx, y - D / 2 + 0.1 * s, 0.6 * s), rnd.uniform(0.045, 0.06) * s, squash=(1, 1, 0.8), rough=0.05, subdiv=1)
        goods.add(v, f, col(rnd.choice(['#ff6b5e', '#f4b83b', '#ffd9a0', '#ff9a2e', '#8bd346', '#fff4dc'])))
    segs, rows = 7, 5
    z0, z1 = 0.93 * s, 1.12 * s
    yf, yb = y - D / 2 - 0.16 * s, y + D / 2 + 0.04 * s
    for k in range(segs):
        xa = x - Wd / 2 - 0.08 * s + k * (Wd + 0.16 * s) / segs
        xb = xa + (Wd + 0.16 * s) / segs
        cc = col(cols[k % 2])
        verts, faces = [], []
        for rr in range(rows + 1):
            t = rr / rows
            yy = yf + (yb - yf) * t
            zz = z0 + (z1 - z0) * t + 0.05 * s * math.sin(math.pi * t)
            for xx in (xa, (xa + xb) / 2, xb):
                verts.append((xx, yy, zz - (0.02 * s if xx != xa and xx != xb else 0.0)))
        for rr in range(rows):
            for i in range(2):
                a = rr * 3 + i
                faces.append((a, a + 1, a + 4, a + 3))
        cloth.add(verts, faces, cc)
        mid, rad = (xa + xb) / 2, (xb - xa) / 2
        fan = [(mid, yf, z0)] + [(mid + math.cos(a) * rad, yf - 0.004, z0 - math.sin(a) * rad * 0.85) for a in [math.pi * j / 8 for j in range(9)]]
        ff = [(0, j + 1, j + 2) for j in range(8)]
        cloth.add(fan, ff, cc)
    return Vector((x - Wd / 2 - 0.08 * s, yb, z1 + 0.02)), Vector((x + Wd / 2 + 0.08 * s, yb, z1 + 0.02))


def bunting_line(string, flags, a, b, rnd, sag=0.16):
    """A string of pennants between two points (world, z above the ground)."""
    L = (b - a).length
    n = max(4, int(L / 0.15))
    pts = []
    for i in range(2 * n + 1):
        t = i / (2 * n)
        q = a + (b - a) * t
        pts.append((q.x, q.y, q.z - sag * math.sin(math.pi * t)))
    v, f = lib.tube(pts, 0.007, 5)
    string.add(v, f, col('#5a3e2a'))
    for k in range(n):
        p0, p1 = Vector(pts[2 * k]), Vector(pts[2 * k + 2])
        mid = (p0 + p1) / 2
        tip = Vector((mid.x, mid.y - 0.01, mid.z - 0.13))
        tri = [tuple(p0.lerp(p1, 0.08)), tuple(p0.lerp(p1, 0.92)), tuple(tip)]
        flags.add(tri, [(0, 1, 2)], col(FEST[k % len(FEST)]))


def fair_pole(wood, metal, bx, by, h=1.25):
    p = board_to_world(bx, by, 0.0)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.03, 0.024, h, 8)
    wood.add(v, f, col('#6e4a2c'))
    v, f = lib.blob((p.x, p.y, h + 0.03), 0.04, rough=0.0, subdiv=2)
    metal.add(v, f, col('#f2c14e'))
    return Vector((p.x, p.y, h - 0.02))


# ------------------------------------------------------------------------------------------
# Valley plan: ponds, brooks, fields, orchard, fair and woods, plus the painted zone maps
def plan_valley(lm, ldist, island_info, canopy_clear):
    """Work out where every valley place goes (pure numpy; no scene objects are made here)."""
    gh, gw = lm.shape
    upper = np.zeros_like(lm)
    for (_, m, _, _) in island_info:
        upper |= m
    upper_d = ndimage.binary_dilation(upper, iterations=int(28 / GRID))
    shift = int(round(LOW_SHIFT / GRID))
    # stricter visibility for laying out places: also not hidden behind a camera-facing cliff face
    hid = np.zeros_like(lm)
    for s in range(int(40 / GRID), shift + int(28 / GRID)):
        hid[: gh - s, :] |= upper_d[s:, :]
    clear = lm & ~hid

    def seen(bx, by):
        gx, gy = int(bx / GRID), int((by + LOW_SHIFT) / GRID)
        if not (0 <= gx < upper_d.shape[1]):
            return False
        if gy < 0 or gy >= upper_d.shape[0]:
            return True
        return not upper_d[gy, gx]

    def on_low(bx, by, edge=30):
        return dist_at(ldist, bx, by) > edge

    def in_clear(bx, by):
        gx, gy = int(bx / GRID), int(by / GRID)
        return 0 <= gy < gh and 0 <= gx < gw and bool(clear[gy, gx])

    def clear_of_paths(bx, by, width, height_units):
        return canopy_clear(bx, by + LOW_SHIFT, width, height_units * PX * lib.SINB)

    free_ = ~upper_d
    vis = np.zeros_like(free_)
    vis[: gh - shift, :] = free_[shift:, :]
    vis &= lm
    openness = ndimage.distance_transform_edt(vis) * GRID
    P = dict(seen=seen, on_low=on_low, in_clear=in_clear, clear_of_paths=clear_of_paths, vis=vis, clear=clear,
             openness=openness.copy())
    # ponds in the most open stretches of visible valley (the same spots as before)
    ponds = []
    op = openness.copy()
    for _ in range(6):
        gy, gx = np.unravel_index(np.argmax(op), op.shape)
        rpx = float(op[gy, gx])
        if rpx < 110:
            break
        cx, cy = gx * GRID, gy * GRID
        pr = min(190.0, rpx * 0.55)
        yy, xx = np.ogrid[:gh, :gw]
        op[(yy - gy) ** 2 + (xx - gx) ** 2 < ((pr + 260) / GRID) ** 2] = 0
        if not clear_of_paths(cx, cy, pr, 0.4):
            continue
        pts = []
        for a in np.linspace(0, math.tau, 40, endpoint=False):
            w = 1 + 0.12 * math.sin(a * 3 + cx) + 0.06 * math.sin(a * 7 + cy)
            pts.append((cx + math.cos(a) * pr * w, cy - math.sin(a) * pr * w * 0.62))
        ponds.append(dict(cx=cx, cy=cy, pr=pr, pts=np.array(pts)))
    P['ponds'] = ponds
    # brooks
    brooks = []
    for spec in VALLEY['brooks']:
        pts = []
        for q in spec['pts']:
            if q == 'splash':
                if not SPLASH:
                    break
                sx, sy = SPLASH[0]
                pts.append((sx - 12, sy + 4))
            else:
                pts.append(q)
        if len(pts) < 2:
            continue
        line = catmull(pts, 5.0)
        s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(line, axis=0), axis=1))])
        w = spec['w'] * (1 + 0.14 * np.sin(s / 41 + 0.7) + 0.08 * np.sin(s / 17))
        w *= 1 + 0.6 * np.exp(-s / 28) + 0.6 * np.exp(-(s[-1] - s) / 28)
        vis_frac = np.mean([seen(x, y) and on_low(x, y, 20) for (x, y) in line])
        print('brook', len(line), 'px', int(s[-1]), 'seen %.2f' % vis_frac)
        brooks.append(dict(line=line, w=w, s=s, spec=spec))
    P['brooks'] = brooks
    # water mask (grid cells) for keeping everything else off ponds and brooks
    img = Image.new('L', (gw, gh), 0)
    dr = ImageDraw.Draw(img)
    for pd in ponds:
        dr.polygon([(x / GRID, y / GRID) for (x, y) in pd['pts']], fill=255)
    for bk in brooks:
        for (x, y), ww in zip(bk['line'][::2], bk['w'][::2]):
            rr = ww / 2 / GRID
            dr.ellipse([x / GRID - rr, y / GRID - rr, x / GRID + rr, y / GRID + rr], fill=255)
    water = np.asarray(img) > 127
    wdist = ndimage.distance_transform_edt(~water) * GRID
    P['water'], P['wdist'] = water, wdist

    def dry(bx, by, margin):
        return dist_at(wdist, bx, by) > margin

    def ok(bx, by, edge=36, margin=26):
        return on_low(bx, by, edge) and seen(bx, by) and in_clear(bx, by) and dry(bx, by, margin)

    P['dry'], P['ok'] = dry, ok
    # fields
    fields, hedges, fences, corners = [], [], [], []
    gap = 12
    for bi, spec in enumerate(VALLEY['farms']):
        x0, y0, x1, y1 = spec['box']
        cf = np.concatenate([[0], np.cumsum(spec['cols'])]) / sum(spec['cols'])
        rf = np.concatenate([[0], np.cumsum(spec['rows'])]) / sum(spec['rows'])
        xs, ys = x0 + cf * (x1 - x0), y0 + rf * (y1 - y0)
        nc, nr = len(spec['cols']), len(spec['rows'])
        grid = {}
        for r in range(nr):
            for c in range(nc):
                fx0, fx1 = xs[c] + (gap / 2 if c else 0), xs[c + 1] - (gap / 2 if c < nc - 1 else 0)
                fy0, fy1 = ys[r] + (gap / 2 if r else 0), ys[r + 1] - (gap / 2 if r < nr - 1 else 0)
                samp = [ok(x, y, 30, 22) for x in np.linspace(fx0, fx1, 8) for y in np.linspace(fy0, fy1, 5)]
                if np.mean(samp) < 0.9:
                    print('field dropped', bi, r, c, '%.2f' % np.mean(samp))
                    continue
                fld = dict(kind=spec['kinds'][r * nc + c], box=(fx0, fy0, fx1, fy1), block=bi)
                fields.append(fld)
                grid[(r, c)] = fld
        for (r, c), fld in grid.items():
            fx0, fy0, fx1, fy1 = fld['box']
            if (r, c + 1) in grid:  # hedge between neighbouring fields
                hedges.append((fx1 + gap / 2, fy0 + 2, fx1 + gap / 2, fy1 - 2))
            if (r - 1, c) not in grid:  # hedge along the far edge of the block
                hedges.append((fx0 - 4, fy0 - 7, fx1 + 4, fy0 - 7))
            if (r + 1, c) not in grid:  # a rail fence along the near (camera-side) edge
                fences.append((fx0 - 2, fy1 + 8, fx1 + 2, fy1 + 8))
        if grid:
            bx0 = min(f['box'][0] for f in grid.values())
            bx1 = max(f['box'][2] for f in grid.values())
            by0 = min(f['box'][1] for f in grid.values())
            corners += [(bx0 - 16, by0 - 10), (bx1 + 16, by0 - 10)]
    P['fields'], P['hedges'], P['fences'], P['corners'] = fields, hedges, fences, corners
    # orchard
    o = VALLEY['orchard']
    orchard = []
    for r in range(o['rows']):
        for c in range(o['cols']):
            bx, by = o['x0'] + c * o['dx'], o['y0'] + r * o['dy']
            if ok(bx, by, 50, 45):
                orchard.append((bx, by, o['fruit'][r % len(o['fruit'])]))
    P['orchard'] = orchard
    print('fields', len(fields), 'orchard trees', len(orchard))
    return P


def paint_valley(P, out, D=None):
    """Paint the valley zone maps: crop soils, yards, orchard grass, brook banks, footpaths, the
    festival lanes, and a warmth map for large patches of warm yellow-green vs cool deep-green meadow."""
    tw, th = W // ZRES, H // ZRES

    def raster(draw_fn, blur=0.0):
        img = Image.new('L', (W, H), 0)
        draw_fn(ImageDraw.Draw(img))
        a = np.asarray(img.resize((tw, th), Image.BOX), np.float32) / 255.0
        return ndimage.gaussian_filter(a, blur) if blur else a

    def grid_to_tex(a):
        return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize((tw, th), Image.BILINEAR))

    Pm = np.zeros((th, tw, 3), np.float32)
    A = np.zeros((th, tw), np.float32)

    def over(alpha, colour):
        alpha = np.clip(alpha, 0, 1)
        Pm[:] = Pm * (1 - alpha[..., None]) + _srgb(colour) * alpha[..., None]
        A[:] = A * (1 - alpha) + alpha

    brooks, ponds, fields = P['brooks'], P['ponds'], P['fields']

    def draw_water(d):
        for pd in ponds:
            d.polygon([tuple(q) for q in pd['pts']], fill=255)
        for bk in brooks:
            for (x, y), ww in zip(bk['line'], bk['w']):
                d.ellipse([x - ww / 2, y - ww / 2, x + ww / 2, y + ww / 2], fill=255)

    water = raster(draw_water)
    dw = ndimage.distance_transform_edt(water < 0.5) * ZRES
    # moist deep-green banks with a pale sandy rim along every pond and brook
    over(np.clip(1 - dw / 30, 0, 1) ** 1.6 * 0.42, '#3d7a50')
    rim = np.clip((7 - dw) / 3, 0, 1) * np.clip(dw / 1.5, 0, 1)
    over(rim * 0.78, '#d8d0a0')
    over(water, '#2e7d88')
    # footpaths
    for path in VALLEY['paths']:
        line = catmull(path, 4.0)
        over(raster(lambda d: d.line([tuple(q) for q in line], fill=255, width=11, joint='curve'), 1.2) * 0.62, '#cdbf8e')
    # the fair's trodden clearing, a little worn in front of each tent
    fe = VALLEY['festival']
    over(raster(lambda d: d.ellipse([fe['cx'] - fe['rx'], fe['cy'] - fe['ry'], fe['cx'] + fe['rx'], fe['cy'] + fe['ry']], fill=255), 14) * 0.58, '#c2cf80')
    for (_, tx, ty, _, _) in fe['tents']:
        over(raster(lambda d: d.ellipse([tx - 46, ty + 18, tx + 46, ty + 62], fill=255), 8) * 0.45, '#c6b583')
    # festival lanes: a darker trodden edge under a sandy lane (a crisp outline at any zoom), worn
    # ground round the busiest pieces and gravel under the flower beds
    if D:
        for ln in D['lanes']:
            pts_ = [tuple(q) for q in ln['line']]
            w = ln['w']
            over(raster(lambda d: d.line(pts_, fill=255, width=int(w + 7), joint='curve'), 0.9) * 0.45, '#5f7c3c')
            over(raster(lambda d: d.line(pts_, fill=255, width=int(w), joint='curve'), 0.7) * 0.88, '#dcc790')
        for it in D['items']:
            k = it['kind']
            if k in ('carousel', 'bandstand', 'booth', 'ferris', 'cart', 'parasol', 'greenhouse', 'camp'):
                rx, ry = it['rx'] * 1.15, it['ry'] * 1.25
                over(raster(lambda d: d.ellipse([it['x'] - rx, it['y'] - ry, it['x'] + rx, it['y'] + ry], fill=255), 5) * 0.45, '#cbb887')
            elif k == 'beds':
                rx, ry = it['rx'] + 6, it['ry'] + 6
                over(raster(lambda d: d.rectangle([it['x'] - rx, it['y'] - ry, it['x'] + rx, it['y'] + ry], fill=255), 1.0) * 0.85, '#d9cfb4')
    # mown orchard grass in stripes along the rows
    if P['orchard']:
        xs = [t[0] for t in P['orchard']]
        ys = [t[1] for t in P['orchard']]
        box = (min(xs) - 52, min(ys) - 44, max(xs) + 52, max(ys) + 40)
        m = raster(lambda d: d.rectangle(box, fill=255), 6)
        yy = (np.arange(th) * ZRES)[:, None] + np.zeros((1, tw))
        stripe = ((yy - box[1]) // 38) % 2
        over(m * 0.5 * (stripe == 0), '#92c262')
        over(m * 0.5 * (stripe == 1), '#7cae52')
    # farmyard in front of the cottage
    cx, cy = VALLEY['cottage']
    over(raster(lambda d: d.ellipse([cx - 90, cy + 40, cx + 110, cy + 110], fill=255), 10) * 0.5, '#c9bb86')
    # crop soils (crisp), and a darker strip under each hedge
    for fld in fields:
        over(raster(lambda d: d.rectangle(fld['box'], fill=255)), FIELD[fld['kind']]['soil'])
    for (ax, ay, bx, by) in P['hedges']:
        over(raster(lambda d: d.line([(ax, ay), (bx, by)], fill=255, width=13), 1.0) * 0.55, '#4d6b3c')
    rgb = Pm / np.maximum(A, 1e-4)[..., None]
    empty = A < 1e-3
    if empty.any() and (~empty).any():
        _, (iy, ix) = ndimage.distance_transform_edt(empty, return_indices=True)
        rgb = rgb[iy, ix]
    # meadow warmth: big soft patches, warmer around farms, the fair and the orchard, cooler along
    # water, in the woods and at the cliff feet
    rng = np.random.default_rng(23)

    def blobs(sigma):
        c = 16
        n = ndimage.gaussian_filter(rng.standard_normal((H // c + 2, W // c + 2)), sigma / c)
        n /= n.std() + 1e-6
        return np.asarray(Image.fromarray(n.astype(np.float32), 'F').resize((tw, th), Image.BICUBIC))

    def near(mask, falloff):
        if not mask.any():
            return np.zeros((th, tw), np.float32)
        return np.exp(-ndimage.distance_transform_edt(~mask) * ZRES / falloff)

    fmask = raster(lambda d: [d.rectangle(f['box'], fill=255) for f in fields]) > 0.5
    femask = raster(lambda d: d.ellipse([fe['cx'] - fe['rx'], fe['cy'] - fe['ry'], fe['cx'] + fe['rx'], fe['cy'] + fe['ry']], fill=255)) > 0.5
    omask = raster(lambda d: [d.ellipse([x - 40, y - 34, x + 40, y + 34], fill=255) for (x, y, _) in P['orchard']]) > 0.5
    gmask = raster(lambda d: [d.ellipse([x - rx, y - ry, x + rx, y + ry], fill=255) for (x, y, rx, ry, _, _) in VALLEY['groves']]) > 0.5
    cliff = np.exp(-grid_to_tex(P['openness']) / 90)
    warm = 0.5 + 0.24 * blobs(240) + 0.08 * blobs(80)
    warm += 0.34 * near(fmask, 170) + 0.22 * near(femask, 130) + 0.1 * near(omask, 90)
    warm -= 0.26 * np.exp(-dw / 70) + 0.3 * near(gmask, 110) + 0.14 * cliff
    warm = ndimage.gaussian_filter(np.clip(warm, 0, 1), 3)
    col_path = os.path.join(out, 'lowzone_col.png')
    fac_path = os.path.join(out, 'lowzone_fac.png')
    Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB').save(col_path)
    fac = np.stack([A, warm, np.zeros_like(A)], 2)
    Image.fromarray((np.clip(fac, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB').save(fac_path)
    P['warm'] = warm
    return col_path, fac_path


def shore_y(pd, x):
    """South shore of a pond polygon at board x (valley px), or None."""
    pts = pd['pts']
    ys = []
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
        if (x0 - x) * (x1 - x) <= 0 and x0 != x1:
            ys.append(y0 + (y1 - y0) * (x - x0) / (x1 - x0))
    return max(ys) if ys else None


def plan_district(P):
    """Check every festival piece against the valley (seen, on dry clear ground, never covering a
    trail above, clear of Mimi and of each other). Returns the pieces that fit and the lanes."""
    placed, lanes = [], []
    ok, seen, clear_of_paths = P['ok'], P['seen'], P['clear_of_paths']
    # what is already down there: the orchard's trees and the fair's tents
    obstacles = [dict(kind='orchard', x=x, y=y, rx=36, ry=30) for (x, y, _) in P['orchard']]
    obstacles += [dict(kind='tent', x=tx, y=ty, rx=(58 if kind == 'pavilion' else 60) * (ts / 0.42 if kind == 'pavilion' else 1.0), ry=46)
                  for (kind, tx, ty, ts, _) in VALLEY['festival']['tents']]

    def overlaps(x, y, rx, ry):
        for q in placed + obstacles:
            if q['kind'] == 'pier':
                continue
            if ((x - q['x']) / (rx + q['rx'])) ** 2 + ((y - q['y']) / (ry + q['ry'])) ** 2 < 1.0:
                return q['kind']
        return None

    for it in DISTRICT['items']:
        it = dict(it)
        k = it['kind']
        if k == 'pier':
            pd = P['ponds'][it['pond']]
            sy = shore_y(pd, it['x'])
            if sy is None:
                print('district: pier misses its pond', it)
                continue
            pts = [(it['x'], sy + 16), (it['x'], sy - it['reach'])]
            if not all(seen(x, y) for (x, y) in pts):
                print('district: pier not seen', it)
                continue
            it['pts'] = pts
            it['rx'] = it['ry'] = 0
            placed.append(it)
            continue
        rx, ry, hgt = DISTRICT_SIZE[k]
        rx, ry = rx * it.get('s', 1.0), ry * it.get('s', 1.0)
        if k == 'beds':  # 0.62 x 0.38 units per bed (see festival.flower_beds)
            rx, ry = it['cols'] * 31 + 4, it['rows'] * 0.38 * PX * COSB / 2 + 5
        x, y = it['x'], it['y']
        samples = [(x, y)] + [(x + rx * math.cos(a), y + ry * math.sin(a)) for a in np.linspace(0, math.tau, 8, endpoint=False)]
        why = None
        bad = [(int(sx), int(sy_), ''.join(c for c, f in (('L', P['on_low'](sx, sy_, 14)), ('S', seen(sx, sy_)), ('C', P['in_clear'](sx, sy_)),
                                                             ('D', P['dry'](sx, sy_, 12))) if not f)) for (sx, sy_) in samples if not ok(sx, sy_, 14, 12)]
        if bad:
            why = 'ground ' + str(bad[:4])
        elif not clear_of_paths(x, y, rx + 18, hgt):
            why = 'covers a trail'
        elif ((x - MIMI[0]) / 110) ** 2 + ((y - MIMI[1]) / 90) ** 2 < 1.0:
            why = 'Mimi'
        else:
            o = overlaps(x, y, rx, ry)
            if o:
                why = 'overlaps ' + o
        if why:
            print('district: skip', k, (x, y), why)
            continue
        it['rx'], it['ry'] = rx, ry
        placed.append(it)
    for ln in DISTRICT['lanes']:
        lanes.append(dict(line=catmull(ln['pts'], 4.0), w=ln['w']))
    print('district', len(placed), 'of', len(DISTRICT['items']), 'pieces')
    return dict(items=placed, lanes=lanes, poles=[q for q in DISTRICT['poles'] if ok(q[0], q[1], 10, 10)])


def build_district(B, D, P, rnd, tops):
    """Model the festival pieces that fit (see plan_district); `tops` are the fair's tent tops, for
    the lantern strings strung from the carousel."""
    import festival as fv
    booth_fronts = []
    carousel_top = None
    for it in D['items']:
        k, x, y = it['kind'], it.get('x'), it.get('y')
        s = it.get('s', 1.0)
        if k == 'ferris':
            fv.ferris_wheel(B, x, y, s, rnd)
        elif k == 'booth':
            booth_fronts.append(fv.booth(B, x, y, s, STRIPE[it['stripe']], it['goods'], rnd))
        elif k == 'beds':
            fv.flower_beds(B, x, y, it['cols'], it['rows'], rnd)
        elif k == 'bandstand':
            fv.bandstand(B, x, y, s, rnd)
        elif k == 'bench':
            fv.bench(B, x, y, it['yaw'], rnd)
        elif k == 'pier':
            fv.pier(B, it['pts'], rnd)
            bx_, by_, yaw = it['boat']
            fv.rowboat(B, bx_, by_, yaw, rnd, hull=rnd.choice(['#e8604c', '#3f9ee0', '#f4b83b']))
        elif k == 'carousel':
            carousel_top = fv.carousel(B, x, y, s, rnd)
        elif k == 'parasol':
            fv.parasol_table(B, x, y, STRIPE[it['stripe']], rnd)
        elif k == 'cart':
            fv.food_cart(B, x, y, STRIPE[it['stripe']], rnd)
        elif k == 'picnic':
            fv.picnic(B, x, y, it['yaw'], rnd, cloth=STRIPE[it['cloth']])
        elif k == 'signpost':
            fv.signpost(B, x, y, rnd)
        elif k == 'blossom':
            terrain.tree_blossom(B['flora'], B['wood'], x, y, rnd, rnd.uniform(0.95, 1.1), pal=it.get('pal', ('#d9658f', '#ffe2ee')))
        elif k == 'willow':
            terrain.willow(B['leaves'], B['wood'], x, y, rnd, 1.0)
        elif k == 'maple':
            terrain.tree_maple(B['flora'], B['wood'], x, y, rnd, 1.0)
        elif k == 'greenhouse':
            fv.greenhouse(B, x, y, s, rnd)
        elif k == 'beehives':
            fv.beehives(B, x, y, rnd)
        elif k == 'scarecrow':
            fv.scarecrow(B, x, y, rnd)
        elif k == 'camp':
            fv.campsite(B, x, y, rnd)
        elif k == 'hay':
            for (dx, dy) in [(-22, 4), (6, -6), (26, 8)]:
                hay_bale(B['wood'], x + dx, y + dy, rnd)
    # lantern strings from the carousel's top to each tent of the fair
    if carousel_top is not None:
        for t in tops:
            if (t - carousel_top).length < 3.2:
                fv.lantern_string(B, carousel_top, t, rnd, sag=0.3)
    # lanterns along the market street: pole to pole, and bunting from each pole to the booth awnings
    poles = [fv.lantern_pole(B, px_, py_) for (px_, py_) in D['poles']]
    for a, b in zip(poles, poles[1:]):
        if (b - a).length < 1.6:
            fv.lantern_string(B, a, b, rnd, sag=0.16)
    corners = [c for fr in booth_fronts for c in fr]
    for pl in poles:
        near = sorted(corners, key=lambda c: (c - pl).length)[:1]
        for c in near:
            if (c - pl).length < 1.3:
                fv.pennant_string(B, pl, c, rnd, sag=0.1)


def build_lowland(island_info, canopy_clear, mats):
    """The valley floor: meadows, brooks between the ponds, patchwork farms, an orchard, the fair's
    tents and a few woods, plus rubble at the cliff feet."""
    pond_m = mats[-1]
    rnd = random.Random(404)
    lm = lowland_mask()
    ldist = ndimage.gaussian_filter(ndimage.distance_transform_edt(lm) * GRID, 1.2)  # as build_island measures it
    P = plan_valley(lm, ldist, island_info, canopy_clear)
    D = plan_district(P)
    col_path, fac_path = paint_valley(P, A.out, D)
    ob, ldist, _under, _lring, _lnrm = build_island(['lowland', 'valley'], lm, 'lowland', lowland_material(col_path, fac_path))
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
    seen, on_low, clear_of_paths, dry, ok = P['seen'], P['on_low'], P['clear_of_paths'], P['dry'], P['ok']
    area = float(lm.sum()) * GRID * GRID

    # places already claimed (fields, yards, orchard, fair) keep the generic scatter off
    gh, gw = lm.shape
    img = Image.new('L', (gw, gh), 0)
    dr = ImageDraw.Draw(img)
    for fld in P['fields']:
        x0, y0, x1, y1 = fld['box']
        dr.rectangle([(x0 - 14) / GRID, (y0 - 14) / GRID, (x1 + 14) / GRID, (y1 + 16) / GRID], fill=255)
    fe = VALLEY['festival']
    dr.ellipse([(fe['cx'] - fe['rx'] - 30) / GRID, (fe['cy'] - fe['ry'] - 40) / GRID, (fe['cx'] + fe['rx'] + 30) / GRID,
                (fe['cy'] + fe['ry'] + 30) / GRID], fill=255)
    for (x, y, _) in P['orchard']:
        dr.ellipse([(x - 60) / GRID, (y - 50) / GRID, (x + 60) / GRID, (y + 50) / GRID], fill=255)
    cx_, cy_ = VALLEY['cottage']
    dr.rectangle([(cx_ - 150) / GRID, (cy_ - 80) / GRID, (cx_ + 150) / GRID, (cy_ + 120) / GRID], fill=255)
    for it in D['items']:  # the festival pieces and their lanes
        if it['kind'] == 'pier':
            continue
        rx, ry = it['rx'] + 16, it['ry'] + 14
        dr.ellipse([(it['x'] - rx) / GRID, (it['y'] - ry) / GRID, (it['x'] + rx) / GRID, (it['y'] + ry) / GRID], fill=255)
    for ln in D['lanes']:
        dr.line([(x / GRID, y / GRID) for (x, y) in ln['line']], fill=255, width=max(1, int((ln['w'] + 10) / GRID)))
    claimed = np.asarray(img) > 127

    def free(bx, by, margin=16):
        gx, gy = int(bx / GRID), int(by / GRID)
        if 0 <= gy < gh and 0 <= gx < gw and claimed[gy, gx]:
            return False
        return dry(bx, by, margin)

    def pick(edge=30, tries=40, margin=16):
        for _ in range(tries):
            bx, by = rnd.uniform(40, W - 40), rnd.uniform(40, H - 40)
            if on_low(bx, by, edge) and seen(bx, by) and free(bx, by, margin):
                return bx, by
        return None

    B = {k: lib.MeshBuilder() for k in ('grass', 'flowers', 'leaves', 'wood', 'rocks', 'reeds', 'water', 'field', 'fruit', 'cloth', 'metal',
                                        'glow', 'paint', 'flora', 'glass', 'stone')}
    grass, flowers, leaves, wood, rocks, reeds, water = (B[k] for k in ('grass', 'flowers', 'leaves', 'wood', 'rocks', 'reeds', 'water'))

    # --- ponds with lily pads, reeds on the far bank and a few stones (gaps where brooks flow in)
    mouths = [bk['line'][i] for bk in P['brooks'] for i in (0, -1)]
    for pd in P['ponds']:
        cx, cy, pr = pd['cx'], pd['cy'], pd['pr']
        c = board_to_world(cx, cy, 0.0)
        pts = pd['pts']
        verts = [(c.x, c.y, 0.02)] + [tuple(board_to_world(x, y, 0.02)) for (x, y) in pts]
        faces = [(0, 1 + k, 1 + (k + 1) % len(pts)) for k in range(len(pts))]
        water.add(verts, faces, (1, 1, 1, 1))
        for k, (x, y) in enumerate(pts):
            ex, ey = cx + (x - cx) * 1.07, cy + (y - cy) * 1.07
            if mouths and min(math.hypot(ex - mx, ey - my) for (mx, my) in mouths) < 55:
                continue
            if k % 4 == 1:
                rock(rocks, ex, ey, rnd, rnd.uniform(0.55, 0.9), moss=rnd.random() < 0.5)
            if k % 3 == 0 and y < cy:
                for _j in range(rnd.randint(3, 6)):
                    base = board_to_world(cx + (x - cx) * 1.02 + rnd.uniform(-12, 12), cy + (y - cy) * 1.02 + rnd.uniform(-6, 6), 0.0)
                    hgt = rnd.uniform(0.35, 0.7)
                    vv, ff = lib.tube([tuple(base), (base.x + rnd.uniform(-0.08, 0.08), base.y, hgt)], 0.014, 5)
                    reeds.add(vv, ff, col(rnd.choice(['#5f9e3a', '#6fb04a', '#4f8a30'])))
        for _j in range(rnd.randint(4, 8)):
            a, rr = rnd.uniform(0, math.tau), rnd.uniform(0.2, 0.72)
            vv, ff = lib.lathe([(0.1, 0.0), (0.0, 0.0)], 12, (c.x + math.cos(a) * pr * rr / PX, c.y + math.sin(a) * pr * rr * 0.62 / PX / lib.COSB, 0.032),
                               cap_bottom=False, cap_top=False)
            leaves.add(vv, ff, col('#4f9a3a'))

    # --- brooks: water ribbon, pebbles on the banks, reeds here and there, bridges and stepping stones
    for bk in P['brooks']:
        line, w = bk['line'], bk['w']
        nrm = brook_ribbon(water, line, w)
        if bk['spec']['pts'][0] == 'splash':  # a little plunge pool where the falls land
            sx, sy = line[0]
            c = board_to_world(sx, sy, 0.0)
            vv, ff = lib.lathe([(0.5, 0.0), (0.0, 0.0)], 24, (c.x, c.y, 0.03), cap_bottom=False, cap_top=False, squash_y=0.72)
            water.add(vv, ff, (1, 1, 1, 1))
        for i in range(4, len(line) - 4, 7):
            for sgn in (-1, 1):
                if rnd.random() < 0.2:
                    q = line[i] + nrm[i] * sgn * (w[i] / 2 + rnd.uniform(3, 9))
                    rock(rocks, q[0], q[1], rnd, rnd.uniform(0.3, 0.5), moss=False)
                elif rnd.random() < 0.06:
                    q = line[i] + nrm[i] * sgn * (w[i] / 2 + 4)
                    for _j in range(rnd.randint(3, 5)):
                        base = board_to_world(q[0] + rnd.uniform(-6, 6), q[1] + rnd.uniform(-4, 4), 0.0)
                        vv, ff = lib.tube([tuple(base), (base.x + rnd.uniform(-0.06, 0.06), base.y, rnd.uniform(0.28, 0.5))], 0.012, 5)
                        reeds.add(vv, ff, col(rnd.choice(['#5f9e3a', '#6fb04a', '#4f8a30'])))
        for f_ in bk['spec'].get('bridges', []):
            i = int(np.argmin(np.abs(bk['s'] - f_ * bk['s'][-1])))
            footbridge(wood, line[i][0], line[i][1], nrm[i][0], nrm[i][1], w[i] + 40, rnd)
        for f_ in bk['spec'].get('stones', []):
            i = int(np.argmin(np.abs(bk['s'] - f_ * bk['s'][-1])))
            t_ = (-nrm[i][1], nrm[i][0])
            brook_stones(rocks, line[i][0], line[i][1], nrm[i][0], nrm[i][1], t_[0], t_[1], w[i], rnd)

    # --- farms: crop rows, hedges on the far side and between fields, rail fences on the near side
    for fld in P['fields']:
        field_rows(B, fld, rnd)
    for (ax, ay, bx, by) in P['hedges']:
        hedgerow(leaves, ax, ay, bx, by, rnd)
    for (ax, ay, bx, by) in P['fences']:
        L = math.hypot(bx - ax, by - ay)
        n = max(1, int(L / 90))
        for k in range(n):
            if n > 2 and k == n // 2:
                continue  # a gate gap
            fence_run(wood, ax + (bx - ax) * k / n, ay + (by - ay) * k / n, ax + (bx - ax) * (k + 1) / n, ay + (by - ay) * (k + 1) / n, rnd)
    for (bx, by) in P['corners']:
        if on_low(bx, by, 40) and seen(bx, by) and dry(bx, by, 30) and clear_of_paths(bx, by, 40, 2.1):
            poplar(leaves, wood, bx, by, rnd, rnd.uniform(0.95, 1.1))
    # farmstead: the cottage, hay bales and a few crates
    import props
    fx, fy = VALLEY['cottage']
    cottage = props.workshop(fx, fy, 1.3)
    cw = board_to_world(fx, fy, 0.0)
    for o in cottage:
        o.location.z += LOW_Z + lowland_height(cw.x, cw.y)
    for (dx, dy) in [(-150, 44), (-178, 58), (-158, 76)]:
        hay_bale(wood, fx + dx, fy + dy, rnd)
    crate(wood, fx + 124, fy + 70, rnd)
    barrel(wood, fx + 146, fy + 84, rnd)

    # --- orchard: neat rows of round fruit trees on mown grass
    for (bx, by, fc) in P['orchard']:
        fruit_tree(leaves, wood, B['fruit'], bx + rnd.uniform(-3, 3), by + rnd.uniform(-3, 3), rnd, fc, rnd.uniform(0.95, 1.05))
    if P['orchard']:
        xs = [t[0] for t in P['orchard']]
        ys = [t[1] for t in P['orchard']]
        for k in range(2):
            crate(wood, max(xs) + 50 + k * 20, max(ys) + 18 - k * 10, rnd, 0.9)
        # fruit heaped in the crates
        for k in range(2):
            p = board_to_world(max(xs) + 50 + k * 20, max(ys) + 18 - k * 10, 0.0)
            for _j in range(5):
                vv, ff = lib.blob((p.x + rnd.uniform(-0.05, 0.05), p.y + rnd.uniform(-0.05, 0.05), 0.19), 0.033, rough=0.0, subdiv=1)
                B['fruit'].add(vv, ff, col(P['orchard'][0][2] if k == 0 else '#ff9a2e'))

    # --- the fair: tents round a trodden clearing, bunting strung between them
    tops = []
    for (kind, tx, ty, s, cols) in fe['tents']:
        if not (seen(tx, ty) and on_low(tx, ty, 40)):
            continue
        if kind == 'pavilion':
            tops.append([pavilion(B['cloth'], wood, B['metal'], tx, ty, s, cols, rnd)])
        else:
            tops.append(list(fair_stall(B['cloth'], wood, B['flowers'], tx, ty, s, cols, rnd)))
    chain = [q for t in tops for q in t]
    for a, b in zip(chain, chain[1:]):
        if (b - a).length < 3.0:
            bunting_line(wood, B['cloth'], a, b, rnd, sag=0.14)
    poles = [fair_pole(wood, B['metal'], px, py) for (px, py) in fe['poles'] if seen(px, py)]
    if len(poles) == 2:
        bunting_line(wood, B['cloth'], poles[0], poles[1], rnd, sag=0.22)
    for (dx, dy) in [(-150, 40), (-128, 58), (170, 30)]:
        bx, by = fe['cx'] + dx, fe['cy'] + dy
        (barrel if dx < -140 or dx > 0 else crate)(wood, bx, by, rnd)
    # --- the festival district round the two interior ponds (own random stream: the scatter above
    # and below keeps its layout)
    build_district(B, D, P, random.Random(505), [q for t in tops for q in t])

    # --- woods: rounded trees, valley pines and poplars in a few groves; birches along the west brook
    low_pals = [('#2f7a3c', '#8cc862'), ('#337a44', '#82c46c'), ('#46803a', '#a8cc5c'), ('#2f703e', '#7cba64')]
    placed = []
    for (gx, gy, rx, ry, n, kind) in VALLEY['groves']:
        made = 0
        for _ in range(n * 12):
            if made >= n:
                break
            a_, r_ = rnd.uniform(0, math.tau), math.sqrt(rnd.random())
            bx, by = gx + math.cos(a_) * r_ * rx, gy + math.sin(a_) * r_ * ry
            if not (on_low(bx, by, 50) and seen(bx, by) and free(bx, by, 40) and clear_of_paths(bx, by, 95, 2.6)):
                continue
            if any((bx - px) ** 2 + ((by - py) * 1.3) ** 2 < 46 ** 2 for (px, py) in placed):
                continue
            placed.append((bx, by))
            made += 1
            pick_ = kind if kind != 'mixed' else rnd.choice(['round', 'round', 'pine', 'poplar'])
            if pick_ == 'round':
                tree_round(leaves, wood, bx, by, rnd, rnd.uniform(0.85, 1.15), palette=rnd.choice(low_pals), crown=True)
            elif pick_ == 'pine' and rnd.random() < 0.8:
                valley_pine(leaves, wood, bx, by, rnd, rnd.uniform(0.9, 1.15))
            else:
                poplar(leaves, wood, bx, by, rnd, rnd.uniform(0.9, 1.1))
    for (bi, f_, sgn) in VALLEY['birches']:
        if bi >= len(P['brooks']):
            continue
        bk = P['brooks'][bi]
        i = int(np.argmin(np.abs(bk['s'] - f_ * bk['s'][-1])))
        t = np.gradient(bk['line'], axis=0)[i]
        t = t / (np.linalg.norm(t) + 1e-9)
        q = bk['line'][i] + np.array([-t[1], t[0]]) * sgn * (bk['w'][i] / 2 + rnd.uniform(34, 50))
        if on_low(q[0], q[1], 40) and seen(q[0], q[1]) and free(q[0], q[1], 20):
            birch(leaves, wood, q[0], q[1], rnd, rnd.uniform(0.95, 1.1))

    # --- calm scatter, about half of before: tufts, a few flower patches, bushes and stones
    for _ in range(int(area / (72 * 72))):
        bx, by = rnd.uniform(20, W - 20), rnd.uniform(20, H - 20)
        if on_low(bx, by, 8) and seen(bx, by) and free(bx, by, 14):
            grass_tuft(grass, bx, by, rnd, rnd.uniform(0.9, 1.3))
    for _ in range(6):
        c = pick(60, margin=30)
        if not c:
            continue
        for _k in range(rnd.randint(6, 11)):
            a_, r_ = rnd.uniform(0, math.tau), math.sqrt(rnd.random())
            bx, by = c[0] + math.cos(a_) * r_ * 150, c[1] + math.sin(a_) * r_ * 85
            if on_low(bx, by, 20) and seen(bx, by) and free(bx, by, 24):
                flower_bed(flowers, leaves, bx, by, rnd, rnd.randint(6, 11))
    for _ in range(int(area / 300000)):
        pt = pick(16, margin=24)
        if pt and clear_of_paths(pt[0], pt[1], 40, 0.9):
            bush(leaves, *pt, rnd, rnd.uniform(0.8, 1.2), berries=flowers)
    for _ in range(int(area / 450000)):
        pt = pick(12, margin=20)
        if pt:
            rock(rocks, *pt, rnd, rnd.uniform(0.8, 1.3), moss=rnd.random() < 0.5)
    # rubble and the odd shrub where the plateau cliffs meet the valley floor (hides the seam)
    for (_, m, _, _) in island_info:
        dd = ndimage.distance_transform_edt(m) * GRID
        rim = level_contour(ndimage.gaussian_filter(dd, 1.2), 2.0)
        if rim is None:
            continue
        for k in range(0, len(rim), 3):
            bx, by = rim[k]
            for off in (18, 34):
                qx, qy = bx, by + off
                if on_low(qx, qy, 10) and seen(qx, qy) and free(qx, qy, 10) and rnd.random() < 0.08:
                    if rnd.random() < 0.85:
                        rock(rocks, qx + rnd.uniform(-8, 8), qy, rnd, rnd.uniform(0.8, 1.5), moss=rnd.random() < 0.6)
                    else:
                        bush(leaves, qx + rnd.uniform(-8, 8), qy, rnd, rnd.uniform(0.7, 1.0), berries=flowers)

    # everything was authored at z = 0: drop it onto the rolling valley floor
    for mb in B.values():
        out = []
        for (x, y, z) in mb.v:
            bx, by = x * PX, -y * PX * lib.COSB
            taper = min(1.0, dist_at(ldist, bx, by) / 160.0)
            out.append((x, y, z + LOW_Z + lowland_height(x, y) * taper))
        mb.v = out
    grass.build('low_grass', low_mat('low_grass_m', 0.8, 0.3, sheen=0.15), smooth=False)
    flowers.build('low_flowers', low_mat('low_flower_m', 0.55, 0.0, haze=0.04, subsurface=0.25))
    leaves.build('low_leaves', leaf_material('low_leaf_m', ao=0.5, haze=0.035, haze_col=HAZE, lift=0.012))
    B['flora'].build('low_flora', leaf_material('low_flora_m', ao=0.5, sun='#fff6f0', shade='#8a3a5a', gaps='#c298a8', ao_tint='#6d3a52', haze=0.03, haze_col=HAZE, lift=0.01))
    B['paint'].build('low_paint', low_mat('low_paint_m', 0.55, 0.35, haze=0.025, lift=0.008))
    B['stone'].build('low_stone', low_mat('low_stone_m', 0.8, 0.4, haze=0.03))
    B['glass'].build('low_glass', glass_material())
    B['glow'].build('low_glow', glow_material())
    wood.build('low_wood', low_mat('low_wood_m', 0.8, 0.3))
    rocks.build('low_rocks', low_mat('low_rock_m', 0.85, 0.4))
    reeds.build('low_reeds', low_mat('low_reed_m', 0.78, 0.3))
    B['field'].build('low_fields', low_mat('low_field_m', 0.8, 0.35, haze=0.03, sheen=0.1))
    B['fruit'].build('low_fruit', low_mat('low_fruit_m', 0.45, 0.0, haze=0.02, lift=0.0))
    B['cloth'].build('low_cloth', low_mat('low_cloth_m', 0.62, 0.35, haze=0.03, lift=0.008))
    B['metal'].build('low_metal', props.mats()['metal'])
    water.build('low_ponds', pond_m, smooth=False)
    print('lowland', int(area), 'ponds', len(P['ponds']), 'brooks', len(P['brooks']), 'fields', len(P['fields']))


def main():
    sc = lib.reset(SAMPLES)
    # The machine is shared: render on two threads. The board is one huge image, so its light paths
    # are shorter than the house default (the look barely changes: bright sky fill, one sun), and a
    # narrower pixel filter keeps the zoomed-in board as crisp as the character sprites over it.
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 2
    cy = sc.cycles
    cy.max_bounces = 4
    cy.diffuse_bounces = 2
    cy.glossy_bounces = 2
    cy.transmission_bounces = 3
    cy.transparent_max_bounces = 4
    cy.adaptive_threshold = 0.035
    cy.pixel_filter_width = 1.0
    import props
    props.use_board_look()
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
    grass_m = scatter_mat('grass', rough=0.8, sheen=0.15, ao=0.3)
    flower_m = scatter_mat('flower', rough=0.55, sheen=0.3)
    leaf_m = leaf_material('leaf', ao=0.5)
    flora_m = leaf_material('flora', ao=0.5, sun='#fff6f0', shade='#8a3a5a', gaps='#c298a8', ao_tint='#6d3a52')  # blossom and autumn crowns
    wood_m = scatter_mat('wood', rough=0.8, ao=0.3)
    rock_m = scatter_mat('rock', rough=0.85, ao=0.4)
    paving_m = paving_material()
    crys = lib.NT('crystal')
    ccol = crys.attr('col')
    crys.bsdf(ccol, 0.12, emission=ccol, emission_strength=1.8, coat=0.6, transmission=0.2)
    crystal_m = crys.mat

    grass = lib.MeshBuilder()
    flowers = lib.MeshBuilder()
    leaves = lib.MeshBuilder()
    flora = lib.MeshBuilder()
    wood = lib.MeshBuilder()
    rocks = lib.MeshBuilder()
    crystals = lib.MeshBuilder()
    stones = lib.MeshBuilder()
    vines = lib.MeshBuilder()
    paving, gold, glass = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    island_info = []
    for idx, (ids, mask) in enumerate(merged_islands()):
        name = f'island_{idx}_' + ('_'.join(ids[:2]))
        theme = theme_of(ids)
        T = THEMES[theme]
        if theme not in island_mats:
            island_mats[theme] = island_material_fine(pm_path, theme)
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
                # about one round tree in eight becomes a blossom or an autumn maple on the sunny
                # regions (picked by position with its own RNG; the round tree still draws from the
                # scatter RNG into a throwaway builder so every later placement stays put)
                pick_ = (int(bx) * 7 + int(by) * 13) % 16 if theme in ('plaza', 'terrace', 'obs', 'docks') else 99
                if pick_ < 2:
                    tree_round(lib.MeshBuilder(), lib.MeshBuilder(), bx, by, rnd, rnd.uniform(0.85, 1.15))
                    r2 = random.Random(int(bx) * 31 + int(by))
                    if pick_ == 0:
                        tree_blossom(flora, wood, bx, by, r2, r2.uniform(1.0, 1.2))
                    else:
                        tree_maple(flora, wood, bx, by, r2, 1.05)
                else:
                    tree_round(leaves, wood, bx, by, rnd, rnd.uniform(0.85, 1.15), crown=True)
            else:
                tree_pine(leaves, wood, bx, by, rnd, rnd.uniform(0.85, 1.1))
            n_trees -= 1
        for _ in range(int(area / (24 * 24))):
            j = rnd.randrange(len(xs))
            bx = xs[j] * GRID + rnd.uniform(0, GRID)
            by = ys[j] * GRID + rnd.uniform(0, GRID)
            if dist_in(dist, bx, by) < 6 or pmask_at(pm, bx, by) > 0.3:
                continue
            # (tufts on a shrine platform go to a throwaway builder, keeping the random sequence)
            grass_tuft(grass if not near_shrine(bx, by, 4) else lib.MeshBuilder(), bx, by, rnd, rnd.uniform(0.8, 1.3))
        # decoration kept deliberately sparse: a few meaningful clusters instead of noise
        for _ in range(int(area / 20000 * T['flowers'] * 0.65)):
            pt = pick(min_edge=20, path_clear=0.02, node_r=78)
            if pt:
                flower_bed(flowers, leaves, *pt, rnd)
        for _ in range(int(area / 16000 * T['bushes'] * 0.3)):
            pt = pick(min_edge=12, max_edge=120, path_clear=0.01, node_r=92)
            if pt and canopy_clear(pt[0], pt[1], 40, 60):
                bush(leaves, *pt, rnd, rnd.uniform(0.7, 1.2), berries=flowers)
        for _ in range(int(area / 32000 * T['rocks'] * 0.75)):
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

    # relic shrines: a mosaic platform behind each relic gate
    import props
    rnd = random.Random(1234)
    for (sx, sy) in SHRINES:
        shrine_platform(paving, gold, glass, crystals, sx, sy, rnd)
    paving.build('shrine_paving', paving_m, smooth=False)
    gold.build('shrine_gold', props.mats()['metal'])
    glass.build('shrine_glow', crystal_m, smooth=False)
    flora.build('flora', flora_m)

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
        crisp(os.path.join(out, 'crop.png'))
        return
    if not A.props_only:
        if A.bands > 1:
            render_bands(frame, A.bands, os.path.join(out, 'terrain.png'))
        else:
            lib.render_to(os.path.join(out, 'terrain.png'))
        crisp(os.path.join(out, 'terrain.png'))
        if A.export:
            export_tiles(os.path.join(out, 'terrain.png'))
    if A.export or A.props_only:
        render_props(built, terrain_objs, frame)
    print('islands', len(island_info))


def plan_map():
    """--plan: a map (valley board px) of where the valley floor is visible and what sits there."""
    info = [(ids, m, None, None) for ids, m in merged_islands()]
    if not SPLASH:
        SPLASH.append((2194.0, 880.0))  # where the docks waterfall lands (recorded by a full build)
    _, pm_ = path_mask(None)
    lm = lowland_mask()
    ldist = ndimage.gaussian_filter(ndimage.distance_transform_edt(lm) * GRID, 1.2)
    P = plan_valley(lm, ldist, info, canopy_clear)
    D = plan_district(P)
    k = 0.25
    img = Image.new('RGB', (int(W * k), int(H * k)), (60, 60, 60))
    px = np.asarray(img).copy()

    def grid_img(mask):
        return np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).resize(img.size, Image.NEAREST)) > 127

    px[grid_img(lm)] = (70, 95, 70)
    px[grid_img(P['vis'])] = (110, 160, 90)
    px[grid_img(P['clear'])] = (150, 205, 120)
    px[grid_img(P['water'])] = (60, 140, 220)
    img = Image.fromarray(px)
    d = ImageDraw.Draw(img)
    for gx in range(0, W + 1, 100):
        d.line([(gx * k, 0), (gx * k, H * k)], fill=(255, 255, 255) if gx % 500 == 0 else (95, 115, 95), width=1)
    for gy in range(0, H + 1, 100):
        d.line([(0, gy * k), (W * k, gy * k)], fill=(255, 255, 255) if gy % 500 == 0 else (95, 115, 95), width=1)
    for gx in range(0, W + 1, 200):
        d.text((gx * k + 2, 2), str(gx), fill=(255, 255, 0))
    for gy in range(0, H + 1, 200):
        d.text((2, gy * k + 2), str(gy), fill=(255, 255, 0))
    # plateau outlines where they appear over the valley (shifted up by the valley's screen offset)
    for (_, m, _, _) in info:
        c = level_contour(ndimage.distance_transform_edt(m) * GRID, 2.0)
        if c is not None:
            d.line([(x * k, (y - LOW_SHIFT) * k) for (x, y) in c] + [(c[0][0] * k, (c[0][1] - LOW_SHIFT) * k)], fill=(255, 255, 255), width=1)
    for n in NODES.values():
        x, y = n['x'] * k, (n['y'] - LOW_SHIFT) * k
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(230, 40, 40))
    for fld in P['fields']:
        d.rectangle([v * k for v in fld['box']], outline=(240, 210, 60))
    for (x, y, _) in P['orchard']:
        d.ellipse([x * k - 3, y * k - 3, x * k + 3, y * k + 3], outline=(255, 140, 40))
    fe = VALLEY['festival']
    d.ellipse([(fe['cx'] - fe['rx']) * k, (fe['cy'] - fe['ry']) * k, (fe['cx'] + fe['rx']) * k, (fe['cy'] + fe['ry']) * k], outline=(255, 90, 90))
    for (_, tx, ty, _, _) in fe['tents']:
        d.rectangle([tx * k - 4, ty * k - 4, tx * k + 4, ty * k + 4], fill=(255, 90, 90))
    for (gx, gy, rx, ry, _, _) in VALLEY['groves']:
        d.ellipse([(gx - rx) * k, (gy - ry) * k, (gx + rx) * k, (gy + ry) * k], outline=(20, 90, 30))
    cx, cy = VALLEY['cottage']
    d.rectangle([(cx - 100) * k, (cy - 60) * k, (cx + 100) * k, (cy + 60) * k], outline=(200, 80, 60))
    # Mimi (the game draws her at board 2020,1500: on the valley floor)
    d.ellipse([2020 * k - 5, (1500 - LOW_SHIFT) * k - 5, 2020 * k + 5, (1500 - LOW_SHIFT) * k + 5], outline=(255, 0, 255), width=2)
    for pd in P['ponds']:
        d.text((pd['cx'] * k, pd['cy'] * k), f"pond {int(pd['cx'])},{int(pd['cy'])} r{int(pd['pr'])}", fill=(255, 255, 255))
    for ln in D['lanes']:
        d.line([(x * k, y * k) for (x, y) in ln['line']], fill=(235, 215, 150), width=max(1, int(ln['w'] * k)))
    for it in D['items']:
        if it['kind'] == 'pier':
            d.line([(x * k, y * k) for (x, y) in it['pts']], fill=(150, 90, 40), width=3)
            continue
        c = {'booth': (255, 110, 90), 'ferris': (255, 60, 200), 'carousel': (255, 60, 200), 'bandstand': (60, 200, 200)}.get(it['kind'], (250, 250, 250))
        d.ellipse([(it['x'] - it['rx']) * k, (it['y'] - it['ry']) * k, (it['x'] + it['rx']) * k, (it['y'] + it['ry']) * k], outline=c, width=2)
    for (x, y) in D['poles']:
        d.ellipse([x * k - 2, y * k - 2, x * k + 2, y * k + 2], fill=(255, 220, 90))
    os.makedirs(A.out, exist_ok=True)
    img.save(os.path.join(A.out, 'plan.png'))
    # close-ups of the two interior valleys at 1 px per board px (grid every 50 px), with every
    # festival piece: placed ones outlined white, skipped ones red
    big = Image.fromarray(np.asarray(Image.fromarray(px).resize((W, H), Image.NEAREST)))
    db = ImageDraw.Draw(big)
    for gx in range(0, W + 1, 50):
        db.line([(gx, 0), (gx, H)], fill=(80, 100, 80) if gx % 100 else (30, 50, 30), width=1)
    for gy in range(0, H + 1, 50):
        db.line([(0, gy), (W, gy)], fill=(80, 100, 80) if gy % 100 else (30, 50, 30), width=1)
    for gx in range(0, W + 1, 100):
        for gy in range(0, H + 1, 100):
            db.text((gx + 2, gy + 1), f'{gx},{gy}', fill=(255, 255, 160))
    for (_, m, _, _) in info:
        c = level_contour(ndimage.distance_transform_edt(m) * GRID, 2.0)
        if c is not None:
            db.line([(x, y - LOW_SHIFT) for (x, y) in c] + [(c[0][0], c[0][1] - LOW_SHIFT)], fill=(255, 255, 255), width=2)
    for ln in D['lanes']:
        db.line([tuple(q) for q in ln['line']], fill=(235, 215, 150), width=int(ln['w']))
    names = {(it['kind'], it.get('x'), it.get('y')) for it in D['items']}
    for it in DISTRICT['items']:
        if it['kind'] == 'pier':
            continue
        rx, ry, _ = DISTRICT_SIZE[it['kind']]
        good = (it['kind'], it['x'], it['y']) in names
        db.ellipse([it['x'] - rx, it['y'] - ry, it['x'] + rx, it['y'] + ry], outline=(255, 255, 255) if good else (255, 40, 40), width=2)
        db.text((it['x'] - rx, it['y'] - 6), it['kind'], fill=(20, 20, 20))
    for it in D['items']:
        if it['kind'] == 'pier':
            db.line([tuple(q) for q in it['pts']], fill=(150, 90, 40), width=8)
    for pd in P['ponds']:
        db.polygon([tuple(q) for q in pd['pts']], outline=(20, 60, 160))
    db.ellipse([MIMI[0] - 110, MIMI[1] - 90, MIMI[0] + 110, MIMI[1] + 90], outline=(255, 0, 255), width=2)
    for n in NODES.values():
        db.ellipse([n['x'] - 8, n['y'] - LOW_SHIFT - 8, n['x'] + 8, n['y'] - LOW_SHIFT + 8], fill=(230, 40, 40))
    for name, (x0, y0, x1, y1) in {'west': (1000, 750, 2050, 1850), 'east': (2400, 700, 3300, 1800)}.items():
        big.crop((x0, y0, x1, y1)).save(os.path.join(A.out, f'plan_{name}.png'))
    print('ponds', [(int(pd['cx']), int(pd['cy']), int(pd['pr'])) for pd in P['ponds']])
    print('plan written', os.path.join(A.out, 'plan.png'))
    # room for the relic shrines behind each gate (island depth at the shrine centre and its back edge)
    for g in ['go4', 'c2', 't4', 'd3', 'o2']:
        n = NODES[g]
        for (_, m, _, _) in info:
            if inside(m, n['x'], n['y']):
                dd = ndimage.distance_transform_edt(m) * GRID
                print('shrine', g, [(off, int(dist_at(dd, n['x'], n['y'] - off)), int(dist_at(dd, n['x'], n['y'] - off - 60))) for off in (70, 90, 110)],
                      'path', [round(float(pmask_at(pm_, n['x'] + dx, n['y'] - 90 + dy)), 2) for dx, dy in ((0, 0), (-50, 0), (50, 0), (0, -45))])


if A.plan:
    plan_map()
else:
    main()
