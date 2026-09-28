"""Toolkit for the world boards' dioramas (Dojo Summit, Capitol Gardens), adapted from the Suncoil
pipeline (scripts/art/board.py, terrain.py, island_shadow.py; those stay untouched).

What it adds for the world boards:
  * islands grown from the board graph, each at its own height (z): a raised island is modelled at
    its height but slid along the camera ray, so every space still sits exactly on its board pixel
    (bw() / lift());
  * a trail material whose path-mask lookup accounts for that height;
  * crossings between islands: stone stairs (climbing between heights), stepping stones on cloud
    puffs, and plank walkways for decks;
  * scatter from terrain.py lifted onto raised islands;
  * landmark sprites (rendered one by one while the terrain only takes their shadows), tiles, the
    island shadow on the cloud sea and the manifest (scripts/art/tiles.py writes the tiles).

Run the board scripts with Blender's Python module (see scripts/art/lib.py), e.g.
    <bpyenv>/bin/python scripts/art/worlds/dojo/board.py --preview
"""
from __future__ import annotations

import json
import math
import os
import random
import sys
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ART = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ART not in sys.path:
    sys.path.insert(0, ART)
import lib  # noqa: E402
import terrain  # noqa: E402
from lib import COSB, PX, SINB, Vector, col  # noqa: E402

import bpy  # noqa: E402
from mathutils import noise  # noqa: E402

GRID = 4  # board px per mask cell
ROOT = lib.ROOT


# ------------------------------------------------------------------------------------------
# Projection with height
def bw(bx: float, by: float, z: float = 0.0) -> Vector:
    """World point at height z that the camera sees at board pixel (bx, by)."""
    return Vector((bx / PX, -(by / PX + z * SINB) / COSB, z))


def lift(z: float) -> Vector:
    """Translation that raises something built at z = 0 to height z without moving it on screen."""
    return Vector((0.0, -z * SINB / COSB, z))


def merge_lifted(dst: lib.MeshBuilder, src: lib.MeshBuilder, z: float) -> None:
    t = lift(z)
    base = len(dst.v)
    dst.v.extend((x + t.x, y + t.y, zz + t.z) for (x, y, zz) in src.v)
    dst.f.extend(tuple(i + base for i in f) for f in src.f)
    dst.c.extend(src.c)


class Builders(dict):
    """Named MeshBuilders (one per material); `local()` gives a fresh set to merge in lifted."""

    def __init__(self, names):
        super().__init__({k: lib.MeshBuilder() for k in names})

    def local(self) -> 'Builders':
        return Builders(self.keys())

    def merge(self, other: 'Builders', z: float) -> None:
        for k, mb in other.items():
            merge_lifted(self[k], mb, z)


# ------------------------------------------------------------------------------------------
# Board data
class Board:
    def __init__(self, path: str):
        d = json.load(open(path))
        self.data = d
        self.id = d['id']
        self.W, self.H = d['width'], d['height']
        self.nodes = {n['id']: n for n in d['nodes']}
        self.edges = d['edges']
        terrain.set_canvas(self.W, self.H, GRID)

    def node(self, i):
        return self.nodes[i]

    def components(self, joins=('path',)) -> list[list[str]]:
        parent = {n: n for n in self.nodes}

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for e in self.edges:
            if e['style'] in joins:
                parent[find(e['from'])] = find(e['to'])
        groups: dict = {}
        for n in self.nodes:
            if self.nodes[n].get('bridge'):
                continue
            groups.setdefault(find(n), []).append(n)
        return [sorted(g) for g in groups.values()]

    def path_points(self, samples: int = 8) -> np.ndarray:
        pts = [(n['x'], n['y']) for n in self.nodes.values()]
        for e in self.edges:
            a, b = self.nodes[e['from']], self.nodes[e['to']]
            for t in np.linspace(0, 1, samples):
                pts.append((a['x'] + (b['x'] - a['x']) * t, a['y'] + (b['y'] - a['y']) * t))
        return np.array(pts)


# ------------------------------------------------------------------------------------------
# Masks
def field_disc(field, xx, yy, cx, cy, r, soft=12.0):
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    np.maximum(field, np.clip((r - d) / soft + 0.5, 0, 1), out=field)


def field_capsule(field, xx, yy, ax, ay, bx, by, r, soft=12.0):
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy or 1.0
    t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / L2, 0, 1)
    d = np.sqrt((xx - ax - t * vx) ** 2 + (yy - ay - t * vy) ** 2)
    np.maximum(field, np.clip((r - d) / soft + 0.5, 0, 1), out=field)


def island_mask(board: Board, ids, discs=(), node_r=122, single_r=92, capsule_r=104, hull=True, blobs=True,
                lobe_d=(50, 105), lobe_r=(70, 110)):
    """A solid island under the given spaces: discs round each space (and a couple of random lobes),
    capsules along the trails between them, extra discs (landmarks), and the convex hull filled."""
    gw, gh = board.W // GRID, board.H // GRID
    yy, xx = np.mgrid[0:gh, 0:gw].astype(np.float32) * GRID
    field = np.zeros((gh, gw), np.float32)
    single = len(ids) == 1
    rnd = random.Random(zlib.crc32(','.join(ids).encode()))
    idset = set(ids)
    for i in ids:
        n = board.nodes[i]
        field_disc(field, xx, yy, n['x'], n['y'], single_r if single else node_r)
        if blobs:
            for _ in range(1 if single else 2):
                a = rnd.uniform(0, math.tau)
                dd = rnd.uniform(30, 55) if single else rnd.uniform(*lobe_d)
                field_disc(field, xx, yy, n['x'] + math.cos(a) * dd, n['y'] + math.sin(a) * dd * 0.8,
                           rnd.uniform(40, 58) if single else rnd.uniform(*lobe_r))
    for e in board.edges:
        if e['style'] == 'path' and e['from'] in idset and e['to'] in idset:
            a, b = board.nodes[e['from']], board.nodes[e['to']]
            field_capsule(field, xx, yy, a['x'], a['y'], b['x'], b['y'], capsule_r)
    for (cx, cy, r) in discs:
        field_disc(field, xx, yy, cx, cy, r)
    if hull and len(ids) >= 3:
        from scipy.spatial import ConvexHull
        pts = np.array([[board.nodes[i]['x'], board.nodes[i]['y']] for i in ids])
        try:
            h = ConvexHull(pts)
            img = Image.new('L', (gw, gh), 0)
            ImageDraw.Draw(img).polygon([(pts[v][0] / GRID, pts[v][1] / GRID) for v in h.vertices], fill=255)
            np.maximum(field, np.asarray(img, np.float32) / 255.0 * 0.999, out=field)
        except Exception:
            pass
    img = Image.fromarray((field * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(24 / GRID))
    return np.asarray(img, np.float32) / 255.0 > 0.5


def disc_mask(board: Board, discs, lobes=0, seed=1):
    """A decorative islet (no spaces) from a few discs."""
    gw, gh = board.W // GRID, board.H // GRID
    yy, xx = np.mgrid[0:gh, 0:gw].astype(np.float32) * GRID
    field = np.zeros((gh, gw), np.float32)
    rnd = random.Random(seed)
    for (cx, cy, r) in discs:
        field_disc(field, xx, yy, cx, cy, r)
        for _ in range(lobes):
            a = rnd.uniform(0, math.tau)
            field_disc(field, xx, yy, cx + math.cos(a) * r * 0.5, cy + math.sin(a) * r * 0.4, r * rnd.uniform(0.4, 0.6))
    img = Image.fromarray((field * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(16 / GRID))
    return np.asarray(img, np.float32) / 255.0 > 0.5


def separate(board: Board, comps, gap_px=34, min_clear=58):
    """Carve a sky gap between overlapping islands ([ids, mask] pairs), merging two only when
    carving would leave one of their spaces without solid ground."""
    gap = max(1, int(gap_px / GRID))

    def nodes_ok(ids, m):
        dist = ndimage.distance_transform_edt(m) * GRID
        return all(terrain.dist_at(dist, board.nodes[i]['x'], board.nodes[i]['y']) > min_clear for i in ids)

    comps = [[list(ids), m] for ids, m in comps]
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
                lab, _ = ndimage.label(carved)
                keep = np.zeros_like(carved)
                for nid in comps[small][0]:
                    gx, gy = int(board.nodes[nid]['x'] / GRID), int(board.nodes[nid]['y'] / GRID)
                    if 0 <= gy < lab.shape[0] and 0 <= gx < lab.shape[1] and lab[gy, gx]:
                        keep |= lab == lab[gy, gx]
                if not comps[small][0]:
                    keep = carved  # a decorative islet keeps whatever is left
                if keep.any() and (not comps[small][0] or nodes_ok(comps[small][0], keep)):
                    comps[small][1] = keep
                else:
                    comps[big][1] = np.logical_or(comps[big][1], comps[small][1])
                    comps[big][0] += comps[small][0]
                    comps[small] = None
                changed = True
    return [(sorted(c[0]), c[1]) for c in comps if c is not None]


def carve_crossings(board: Board, items, crossings, keep_r=66, width=110, blur=3):
    """Cut a chasm across every crossing (edges between islands: stairs, cloud steps, bridges) so the
    islands on either side stand apart, keeping `keep_r` px of ground round every space. `items` are
    [ids, mask] pairs; each keeps only the parts connected to its own spaces (islets keep all)."""
    gw, gh = board.W // GRID, board.H // GRID
    yy, xx = np.mgrid[0:gh, 0:gw].astype(np.float32) * GRID
    cut = np.zeros((gh, gw), bool)
    for (a, b) in crossings:
        na, nb = board.nodes[a], board.nodes[b]
        dx, dy = nb['x'] - na['x'], nb['y'] - na['y']
        L = math.hypot(dx, dy) or 1.0
        ux, uy = dx / L, dy / L
        t = (xx - na['x']) * ux + (yy - na['y']) * uy
        s = np.abs((xx - na['x']) * -uy + (yy - na['y']) * ux)
        cut |= (t > keep_r) & (t < L - keep_r) & (s < width)
    keep = np.zeros((gh, gw), bool)
    for n in board.nodes.values():
        keep |= (xx - n['x']) ** 2 + (yy - n['y']) ** 2 < keep_r ** 2
    out = []
    for ids, m in items:
        m2 = m & ~(cut & ~keep)
        if blur:
            m2 = ndimage.gaussian_filter(m2.astype(np.float32), blur) > 0.5
            m2 |= keep & m
        if ids:
            lab, _ = ndimage.label(m2)
            mine = np.zeros_like(m2)
            for nid in ids:
                gx, gy = int(board.nodes[nid]['x'] / GRID), int(board.nodes[nid]['y'] / GRID)
                if 0 <= gy < lab.shape[0] and 0 <= gx < lab.shape[1] and lab[gy, gx]:
                    mine |= lab == lab[gy, gx]
            m2 = mine
        out.append([ids, m2])
    return out


def inside(mask, bx, by) -> bool:
    gx, gy = int(bx // GRID), int(by // GRID)
    return 0 <= gy < mask.shape[0] and 0 <= gx < mask.shape[1] and bool(mask[gy, gx])


def dist_in(dist, bx, by) -> float:
    gx, gy = int(bx // GRID), int(by // GRID)
    if 0 <= gy < dist.shape[0] and 0 <= gx < dist.shape[1]:
        return float(dist[gy, gx])
    return 0.0


# ------------------------------------------------------------------------------------------
# Trails
def path_mask(board: Board, out_dir: str, edges, width=84, node_r=72, extra=()):
    """Trail mask (2 board px per pixel) for the given edges (dicts with from/to), plus clearings round
    every space on them and extra ellipses (x, y, rx, ry) such as plazas."""
    s = 2
    img = Image.new('L', (board.W // s, board.H // s), 0)
    dr = ImageDraw.Draw(img)
    on = set()
    for e in edges:
        a, b = board.nodes[e['from']], board.nodes[e['to']]
        dr.line([(a['x'] / s, a['y'] / s), (b['x'] / s, b['y'] / s)], fill=255, width=int(width / s))
        on.add(e['from'])
        on.add(e['to'])
    for i in on:
        n = board.nodes[i]
        r = node_r / s
        dr.ellipse([n['x'] / s - r, n['y'] / s - r * 0.8, n['x'] / s + r, n['y'] / s + r * 0.8], fill=255)
    for (x, y, rx, ry) in extra:
        dr.ellipse([(x - rx) / s, (y - ry) / s, (x + rx) / s, (y + ry) / s], fill=255)
    img = img.filter(ImageFilter.GaussianBlur(2.6))
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'pathmask.png')
    img.save(path)
    return path, np.asarray(img, np.float32) / 255.0


def pmask_at(pm, bx, by) -> float:
    x, y = int(bx // 2), int(by // 2)
    if 0 <= y < pm.shape[0] and 0 <= x < pm.shape[1]:
        return float(pm[y, x])
    return 0.0


# ------------------------------------------------------------------------------------------
# Island mesh
def build_island(board: Board, ids, mask, name, mat, z=0.0, depth_k=1.0, crag=0.28, rock_disp=0.22, lip=0.12):
    """Floating island from a mask (board.terrain.build_island with a height and deeper, craggier
    undersides on request). Returns (object, dist field, underside samples, rim ring, rim normals)."""
    import triangle as tr
    dist = ndimage.distance_transform_edt(mask) * GRID
    dist = ndimage.gaussian_filter(dist, 1.2)
    small = len(ids) <= 1
    outline = terrain.level_contour(dist, 2.0)
    per = float(np.sum(np.linalg.norm(np.diff(np.vstack([outline, outline[:1]]), axis=0), axis=1)))
    N = max(40, int(per / 13))
    ring = terrain.resample(outline, N)
    nrm = np.zeros_like(ring)
    for k in range(N):
        t = ring[(k + 1) % N] - ring[k - 1]
        n = np.array([t[1], -t[0]])
        n /= (np.linalg.norm(n) or 1)
        if terrain.dist_at(dist, *(ring[k] + n * 6)) > terrain.dist_at(dist, *(ring[k] - n * 6)):
            n = -n
        nrm[k] = n
    seg = np.array([[k, (k + 1) % N] for k in range(N)])
    area_px = (26.0 if not small else 18.0) ** 2
    T = tr.triangulate({'vertices': ring, 'segments': seg}, f'pq28a{area_px:.0f}')
    pts2 = T['vertices']
    tris = [tuple(int(i) for i in t) for t in T['triangles']]
    P = len(pts2)
    size = 0.62 if small else 1.0
    verts, weights = [], []
    for (bx, by) in pts2:
        verts.append(tuple(bw(bx, by, z)))
        weights.append(0.0)
    lip0 = len(verts)
    for k in range(N):
        bx, by = ring[k] + nrm[k] * 4
        verts.append(tuple(bw(bx, by, z - lip)))
        weights.append(0.0)
    und0 = len(verts)
    for i, (bx, by) in enumerate(pts2):
        d = terrain.dist_at(dist, bx, by) if i >= N else 0.0
        w = bw(bx, by, z)
        q = Vector((w.x * 0.8, w.y * 0.8, 0.0))
        depth = 0.4 + 3.3 * size * depth_k * (d / 100.0) ** 0.85
        depth *= 1.0 + crag * noise.noise(q) + 0.12 * noise.noise(q * 3.3 + Vector((3, 1, 2)))
        if i < N:
            depth = 0.4
        verts.append((w.x, w.y, z - depth))
        weights.append(0.35 if i < N else 1.0)
    faces = []
    faces += terrain.orient(tris, verts, lambda c: Vector((0, 0, 1)))
    faces += terrain.orient([tuple(und0 + i for i in t) for t in tris], verts, lambda c: Vector((0, 0, -1)))
    band = []
    for k in range(N):
        k2 = (k + 1) % N
        band.append((k, k2, lip0 + k2, lip0 + k))
        band.append((lip0 + k, lip0 + k2, und0 + k2, und0 + k))
    wc = bw(*ring.mean(0), z)
    faces += terrain.orient(band, verts, lambda c: Vector((c.x - wc.x, c.y - wc.y, 0.0)))
    ob = lib.mesh_object(name, verts, faces, smooth=True, material=mat)
    me = ob.data
    for i in range(len(tris)):
        me.polygons[i].use_smooth = False
    vg = ob.vertex_groups.new(name='rock')
    for i, w in enumerate(weights):
        if w > 0:
            vg.add([i], w, 'REPLACE')
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.subdivision_type = 'SIMPLE'
    sub.levels = 0
    sub.render_levels = 2
    tex = bpy.data.textures.new(name + '_rock', 'VORONOI')
    tex.noise_scale = 0.32
    tex.distance_metric = 'DISTANCE'
    disp = ob.modifiers.new('disp', 'DISPLACE')
    disp.texture = tex
    disp.texture_coords = 'GLOBAL'
    disp.strength = rock_disp
    disp.mid_level = 0.5
    disp.vertex_group = 'rock'
    under = [(verts[und0 + i], terrain.dist_at(dist, *pts2[i]) if i >= N else 0.0) for i in range(P)]
    return ob, dist, under, ring, nrm


# ------------------------------------------------------------------------------------------
# Materials
def board_uv(m: lib.NT, W: int, H: int):
    """Board-pixel UV (0..1, y up) of the shading point, correct at any height."""
    X, Y, Z = m.sep(m.position())
    u = m.math('MULTIPLY', X, PX / W)
    v = m.math('ADD', m.math('MULTIPLY', m.math('ADD', m.math('MULTIPLY', Y, COSB), m.math('MULTIPLY', Z, SINB)), PX / H), 1.0)
    comb = m.node('ShaderNodeCombineXYZ')
    m.link(u, comb.inputs['X'])
    m.link(v, comb.inputs['Y'])
    return comb.outputs['Vector']


def top_material(name, mask_path, W, H, pal, z_top=0.0):
    """Island surface for islands whose top is at z_top: grass (with fine clumps, flowers, optional
    mowing stripes), a trail from the path mask (earth or pale paving), a crisp trail edge, and rocky
    cliffs underneath. `pal` keys: grass, trail, rock (ramps), soil (two colours), flowers (0..2),
    stripes (0..1), paving (0..1), moss (0..1), edge / crack / rock_tint ('#hex')."""
    m = lib.NT(name)
    pos = m.position()
    nz = m.sep(m.normal())[2]
    X, Y, Z = m.sep(pos)
    Zr = m.math('SUBTRACT', Z, z_top)  # height relative to this island's top
    img = m.node('ShaderNodeTexImage')
    img.image = bpy.data.images.load(mask_path, check_existing=True)
    img.image.colorspace_settings.name = 'Non-Color'
    img.extension = 'EXTEND'
    img.interpolation = 'Cubic'
    m.link(board_uv(m, W, H), img.inputs['Vector'])
    pv = m.sep(img.outputs['Color'])[0]
    pm = m.maprange(pv, 0.25, 0.65)
    # grass
    n1 = m.noise(0.9, 5, 0.6, pos)
    n2 = m.noise(6.0, 3, 0.5, pos)
    gfac = m.math('ADD', m.math('MULTIPLY', n1.outputs['Fac'], 0.8), m.math('MULTIPLY', n2.outputs['Fac'], 0.35))
    grass = m.ramp(gfac, pal['grass'])
    if pal.get('stripes'):
        # mown lawn: broad alternating light and dark bands running across the park
        wv = m.node('ShaderNodeTexWave')
        wv.wave_type = 'BANDS'
        wv.bands_direction = 'X'
        wv.wave_profile = 'SAW'
        wv.inputs['Scale'].default_value = 0.55
        wv.inputs['Distortion'].default_value = 0.0
        m.link(pos, wv.inputs['Vector'])
        band = m.maprange(wv.outputs['Fac'], 0.48, 0.52)
        grass = m.mult(grass, m.mix(m.math('MULTIPLY', band, pal['stripes']), lib.col('#ffffff'), lib.col('#c9dcae')))
    grass = terrain.grass_detail(m, pos, grass, flowers=pal.get('flowers', 1.0), keep_off=m.maprange(pv, 0.12, 0.0))
    # trail
    d1 = m.noise(2.2, 4, 0.6, pos)
    dirt = m.ramp(d1.outputs['Fac'], pal['trail'])
    if pal.get('paving'):
        br = m.node('ShaderNodeTexBrick')
        br.inputs['Scale'].default_value = 5.0
        br.inputs['Mortar Size'].default_value = 0.02
        br.inputs['Color1'].default_value = lib.col('#ffffff')
        br.inputs['Color2'].default_value = lib.col('#e9e2d6')
        br.inputs['Mortar'].default_value = lib.col('#b3a894')
        comb = m.node('ShaderNodeCombineXYZ')
        m.link(X, comb.inputs['X'])
        m.link(m.math('MULTIPLY', Y, 1.4), comb.inputs['Y'])
        m.link(comb.outputs['Vector'], br.inputs['Vector'])
        dirt = m.mult(dirt, m.mix(pal['paving'], lib.col('#ffffff'), br.outputs['Color']))
    else:
        peb = m.voronoi(18.0, pos)
        pebf = m.maprange(peb.outputs['Distance'], 0.05, 0.18, 1.0, 0.0)
        dirt = m.mix(m.math('MULTIPLY', pebf, 0.45), dirt, lib.col('#f4e2bd'))
        gv = m.voronoi(30.0, pos)
        gr = m.sep(gv.outputs['Color'])[0]
        gdot = m.maprange(gv.outputs['Distance'], 0.34, 0.2)
        dirt = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', gdot, m.maprange(gr, 0.62, 0.66)), 0.55), dirt, lib.col('#fff3d6'))
        dirt = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', gdot, m.maprange(gr, 0.2, 0.16)), 0.4), dirt, lib.col('#98693f'))
    dn = m.noise(24.0, 2, 0.5, pos)
    dirt = m.mult(dirt, m.mix(m.maprange(dn.outputs['Fac'], 0.42, 0.62), lib.col('#ffffff'), lib.col('#e2cfb2')))
    rut = m.math('MULTIPLY', m.maprange(pv, 0.5, 0.66), m.maprange(pv, 0.96, 0.8))
    dirt = m.mult(dirt, m.mix(m.math('MULTIPLY', rut, 0.4 if not pal.get('paving') else 0.12), lib.col('#ffffff'), lib.col('#dcbd92')))
    fringe = m.maprange(pv, 0.0, 0.1)
    grass_d = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', fringe, m.maprange(pv, 0.12, 0.06)), 0.3), grass, lib.col('#b6d36a'))
    lipc = m.math('MULTIPLY', m.maprange(pv, 0.06, 0.11), m.maprange(pv, 0.2, 0.13))
    grass_d = m.mix(m.math('MULTIPLY', lipc, 0.5), grass_d, lib.col('#2d6526'))
    edge = m.math('MULTIPLY', m.maprange(pv, 0.14, 0.3), m.maprange(pv, 0.55, 0.32))
    grass_d = m.mix(m.math('MULTIPLY', edge, 0.8), grass_d, lib.col(pal.get('edge', '#f1dfb0')))
    top = m.mix(pm, grass_d, dirt)
    top = terrain.contact_ao(m, top)
    # cliffs: strata bands, cracks and grain, a soil band under the grass, darker and cooler below
    wave = m.node('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 1.4
    wave.inputs['Distortion'].default_value = 6.0
    wave.inputs['Detail'].default_value = 3.0
    m.link(pos, wave.inputs['Vector'])
    rn = m.noise(1.8, 6, 0.6, pos)
    rf = m.math('ADD', m.math('MULTIPLY', wave.outputs['Fac'], 0.55), m.math('MULTIPLY', rn.outputs['Fac'], 0.5))
    rock = m.ramp(rf, pal['rock'])
    rv = m.voronoi(7.0, pos, feature='DISTANCE_TO_EDGE')
    rock = m.mult(rock, m.mix(m.maprange(rv.outputs['Distance'], 0.05, 0.0), lib.col('#ffffff'), lib.col(pal.get('crack', '#6a5454'))))
    rg = m.noise(30.0, 2, 0.6, pos)
    rock = m.mult(rock, m.mix(m.maprange(rg.outputs['Fac'], 0.4, 0.65), lib.col('#ffffff'), lib.col('#d8ccc6')))
    if pal.get('moss'):
        mo = m.noise(3.0, 4, 0.6, pos)
        rock = m.mix(m.math('MULTIPLY', m.maprange(mo.outputs['Fac'], 0.55, 0.68), pal['moss']), rock, lib.col('#5f8f45'))
    soil = m.ramp(rn.outputs['Fac'], [(0.3, pal['soil'][0]), (0.7, pal['soil'][1])])
    soilfac = m.maprange(Zr, -0.55, -0.1)
    rock = m.mix(soilfac, rock, soil)
    depth = m.maprange(Zr, -5.0, -0.5, 0.0, 1.0, smooth=False)
    rock = m.mult(rock, m.mix(depth, lib.col(pal.get('rock_tint', '#6b5f8a')), lib.col('#ffffff')))
    ao = terrain.cam_ao(m, 0.9, 5)
    rock = m.mult(rock, m.mix(ao, lib.col('#3a3048'), lib.col('#ffffff')))
    gn = m.noise(8.0, 2, 0.5, pos)
    wrap = m.math('ADD', nz, m.math('MULTIPLY', m.math('SUBTRACT', gn.outputs['Fac'], 0.5), 0.9))
    lipz = m.maprange(Zr, -0.28, -0.02)
    grassfac = m.math('MAXIMUM', m.maprange(wrap, 0.55, 0.8), m.math('MULTIPLY', lipz, m.maprange(gn.outputs['Fac'], 0.45, 0.6)))
    colr = m.mix(grassfac, rock, top)
    bump = m.bump(m.math('ADD', m.math('ADD', rn.outputs['Fac'], m.math('MULTIPLY', gfac, 0.2)),
                         m.math('MULTIPLY', m.maprange(rv.outputs['Distance'], 0.06, 0.0), -0.6)), 0.35, 0.08)
    rough = m.math('ADD', m.math('MULTIPLY', grassfac, 0.1), 0.78)
    m.bsdf(colr, rough, normal=bump, sheen=0.25)
    return m.mat


def floor_tiles_material(name='floor_tiles', scale=2.2):
    """Flat stone flooring: square slabs (vertex colour x a world-space tile grid on the ground plane),
    fine grain and contact occlusion. For ring floors, plazas and platform tops."""
    m = lib.NT(name)
    pos = m.position()
    X, Y, _Z = m.sep(pos)
    br = m.node('ShaderNodeTexBrick')
    br.offset = 0.5
    br.inputs['Scale'].default_value = scale
    br.inputs['Mortar Size'].default_value = 0.018
    br.inputs['Brick Width'].default_value = 1.0
    br.inputs['Row Height'].default_value = 1.0
    br.inputs['Color1'].default_value = lib.col('#ffffff')
    br.inputs['Color2'].default_value = lib.col('#e8e2d6')
    br.inputs['Mortar'].default_value = lib.col('#a39886')
    comb = m.node('ShaderNodeCombineXYZ')
    m.link(X, comb.inputs['X'])
    m.link(Y, comb.inputs['Y'])
    m.link(comb.outputs['Vector'], br.inputs['Vector'])
    c = m.mult(m.attr('col'), br.outputs['Color'])
    n = m.noise(24.0, 3, 0.6, pos)
    c = m.mult(c, m.mix(m.maprange(n.outputs['Fac'], 0.35, 0.7), lib.col('#ffffff'), lib.col('#dcd3c4')))
    c = m.mult(c, m.mix(terrain.cam_ao(m, 0.3, 4), lib.col('#6d6272'), lib.col('#ffffff')))
    m.bsdf(c, 0.72, normal=m.bump(br.outputs['Fac'], 0.25, 0.02))
    return m.mat


def cloud_material(name='cloud', tint='#ffffff', shade='#b9c9ec'):
    """Soft cumulus: bright tops, cool blue-lilac shading underneath, a little glow so the cloud sea
    never goes grey in the islands' shadow."""
    m = lib.NT(name)
    nz = m.sep(m.normal())[2]
    n = m.noise(3.0, 3, 0.55, m.position())
    c = m.mix(m.maprange(nz, -0.6, 0.7), lib.col(shade), lib.col(tint))
    c = m.mult(c, m.mix(m.maprange(n.outputs['Fac'], 0.35, 0.7), lib.col('#eef2ff'), lib.col('#ffffff')))
    m.bsdf(c, 0.95, emission=c, emission_strength=0.35, sheen=0.5, spec=0.1)
    return m.mat


# ------------------------------------------------------------------------------------------
# Crossings
def gap_span(board: Board, masks, a, b, samples=48):
    """Parameter range (t0, t1) of the edge a→b that lies outside every island mask (the gap)."""
    na, nb = board.nodes[a], board.nodes[b]
    outside = []
    for k in range(samples + 1):
        t = k / samples
        x = na['x'] + (nb['x'] - na['x']) * t
        y = na['y'] + (nb['y'] - na['y']) * t
        outside.append(not any(inside(m, x, y) for m in masks))
    ts = [k / samples for k, o in enumerate(outside) if o]
    if not ts:
        return None
    return max(0.0, ts[0] - 1.5 / samples), min(1.0, ts[-1] + 1.5 / samples)


def stone_stairs(mb, board: Board, a, b, za, zb, t0, t1, rnd, width=0.62, tread=0.2, colour='#c9c1b4', edge='#a8a095'):
    """A floating flight of stone steps along a→b between t0 and t1, climbing from za to zb: square
    slabs with a stringer underneath, so the stairs read at any zoom and meet each island's rim."""
    na, nb = board.nodes[a], board.nodes[b]
    pa = bw(na['x'], na['y'], 0)
    pb = bw(nb['x'], nb['y'], 0)
    L = (Vector((pb.x - pa.x, pb.y - pa.y, 0))).length * (t1 - t0)
    n = max(3, int(L / tread))
    ang = math.atan2(pb.y - pa.y, pb.x - pa.x)
    for k in range(n):
        u = (k + 0.5) / n
        t = t0 + (t1 - t0) * u
        bx = na['x'] + (nb['x'] - na['x']) * t
        by = na['y'] + (nb['y'] - na['y']) * t
        z = za + (zb - za) * u
        p = bw(bx, by, z)
        depth = 0.16 + abs(zb - za) / n * 1.2
        # short along the direction of travel, wide across it
        v, f = lib.box((p.x, p.y, z - depth / 2 + 0.01), (L / n * 1.02, width + rnd.uniform(-0.02, 0.02), depth), rot_z=ang)
        c0 = col(colour)
        mb.add(v, f, lambda vv, z=z, c0=c0: c0 if vv[2] > z - 0.02 else col(edge))
    # stringer: a tapered stone spine under the flight
    pts = []
    for k in range(9):
        u = k / 8
        t = t0 + (t1 - t0) * u
        bx = na['x'] + (nb['x'] - na['x']) * t
        by = na['y'] + (nb['y'] - na['y']) * t
        z = za + (zb - za) * u
        sag = 0.28 * math.sin(u * math.pi) + 0.18
        pts.append(tuple(bw(bx, by, z - sag)))
    v, f = lib.tube(pts, lambda u: 0.13 + 0.05 * math.sin(u * math.pi), 8)
    mb.add(v, f, col(edge))


def plank_walk(mb, board: Board, a, b, za, zb, t0, t1, width=0.5, colour='#a8743f', dark='#6e4a2c', posts_to=None, rnd=None):
    """A plank walkway (decks, rooftop runs) along a→b, from za to zb; `posts_to` (a height) adds
    posts down to the ground under it."""
    na, nb = board.nodes[a], board.nodes[b]
    pa = bw(na['x'], na['y'], 0)
    pb = bw(nb['x'], nb['y'], 0)
    L = (Vector((pb.x - pa.x, pb.y - pa.y, 0))).length * (t1 - t0)
    ang = math.atan2(pb.y - pa.y, pb.x - pa.x)
    n = max(3, int(L / 0.12))
    rnd = rnd or random.Random(7)
    for k in range(n):
        u = (k + 0.5) / n
        t = t0 + (t1 - t0) * u
        bx = na['x'] + (nb['x'] - na['x']) * t
        by = na['y'] + (nb['y'] - na['y']) * t
        z = za + (zb - za) * u
        p = bw(bx, by, z)
        v, f = lib.box((p.x, p.y, z - 0.025), (width, L / n * 0.86, 0.05), rot_z=ang - math.pi / 2)
        mb.add(v, f, col(rnd.choice([colour, '#b27c46', '#9c6a3a'])))
    for side in (-1, 1):
        pts = []
        for k in range(7):
            u = k / 6
            t = t0 + (t1 - t0) * u
            bx = na['x'] + (nb['x'] - na['x']) * t
            by = na['y'] + (nb['y'] - na['y']) * t
            z = za + (zb - za) * u
            p = bw(bx, by, z)
            off = Vector((-math.sin(ang), math.cos(ang), 0)) * (width / 2)
            pts.append(tuple(p + off * side + Vector((0, 0, -0.06))))
        v, f = lib.tube(pts, 0.03, 6)
        mb.add(v, f, col(dark))
        if posts_to is not None:
            for q in pts[::2]:
                v, f = lib.cylinder((q[0], q[1], posts_to), 0.03, 0.03, q[2] - posts_to, 6)
                mb.add(v, f, col(dark))


def cloud_puffs(mb, bx, by, z, rnd, r=0.35, count=5, spread=(0.5, 0.3)):
    """A cluster of soft cloud blobs centred under board point (bx, by) at height z."""
    c = bw(bx, by, z)
    for k in range(count):
        rr = r * rnd.uniform(0.55, 1.0)
        ox = rnd.uniform(-1, 1) * spread[0]
        oy = rnd.uniform(-1, 1) * spread[1]
        v, f = lib.blob((c.x + ox, c.y + oy, c.z + rnd.uniform(-0.1, 0.12)), rr, squash=(1.35, 1.1, 0.72), rough=0.22, freq=2.0, subdiv=2, seed=rnd.random() * 90)
        mb.add(v, f, (1, 1, 1, 1))


# ------------------------------------------------------------------------------------------
# Rendering and export
def setup_render(samples: int, threads: int = 2):
    """Cycles settings for a board render on the shared machine (two threads, lean light paths)."""
    sc = lib.reset(samples)
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = threads
    cy = sc.cycles
    cy.max_bounces = 4
    cy.diffuse_bounces = 2
    cy.glossy_bounces = 2
    cy.transmission_bounces = 3
    cy.transparent_max_bounces = 4
    cy.adaptive_threshold = 0.035
    cy.pixel_filter_width = 1.0
    return sc


def crisp(path, radius=1.1, amount=40, threshold=3):
    """Light unsharp mask on the colour of a finished render (see board.py)."""
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im)
    solid = a[..., 3] > 250
    if not solid.any():
        return
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    filled = Image.fromarray(np.ascontiguousarray(a[..., :3][iy, ix]), 'RGB')
    del iy, ix
    rgb = np.asarray(filled.filter(ImageFilter.UnsharpMask(radius=radius, percent=amount, threshold=threshold))).copy()
    rgb[a[..., 3] == 0] = 0
    Image.fromarray(np.dstack([rgb, a[..., 3]]), 'RGBA').save(path)


def render_props(board_id: str, built: dict, terrain_objs, frame, scale: float, out_dir: str, only=()):
    """Render each landmark on its own (terrain still lights and shadows it) into the manifest.
    `built` maps id -> (spec dict, objects); a spec has kind, x, y (ground anchor, board px), tex and
    optional depth_y / hub."""
    fx, fy, fw, fh = frame
    sc = bpy.context.scene
    rx, ry = sc.render.resolution_x, sc.render.resolution_y
    for o in terrain_objs:
        o.visible_camera = False
        if not o.name.startswith('island_'):
            o.hide_render = True
    all_objs = [o for _, obs in built.values() for o in obs]
    dest = os.path.join(ROOT, 'public', 'assets', 'rendered', board_id)
    os.makedirs(dest, exist_ok=True)
    man_path = os.path.join(dest, 'manifest.json')
    old = {e['id']: e for e in json.load(open(man_path)).get('props', [])} if only and os.path.exists(man_path) else {}
    entries = []
    dg = bpy.context.evaluated_depsgraph_get()
    for pid, (spec, obs) in built.items():
        if only and pid not in only:
            if pid in old:
                entries.append(old[pid])
            continue
        for o in all_objs:
            o.hide_render = o not in obs
        for o in obs:
            o.visible_camera = True
            o.visible_glossy = True
        xs, ys = [], []
        for o in obs:
            ev = o.evaluated_get(dg)
            me = ev.to_mesh()
            for v in me.vertices:
                bx, by = lib.world_to_board(o.matrix_world @ v.co)
                xs.append(bx)
                ys.append(by)
            ev.to_mesh_clear()
        pad = 8
        px0 = max(0, math.floor((min(xs) - pad - fx) * scale))
        px1 = min(rx, math.ceil((max(xs) + pad - fx) * scale))
        py0 = max(0, math.floor((min(ys) - pad - fy) * scale))
        py1 = min(ry, math.ceil((max(ys) + pad - fy) * scale))
        sc.render.use_border = True
        sc.render.use_crop_to_border = True
        sc.render.border_min_x, sc.render.border_max_x = px0 / rx, px1 / rx
        sc.render.border_min_y, sc.render.border_max_y = 1 - py1 / ry, 1 - py0 / ry
        png = os.path.join(out_dir, 'props', f'{pid}.png')
        lib.render_to(png)
        crisp(png, amount=35)
        im = Image.open(png).convert('RGBA')
        name = f'prop_{pid}.webp'
        im.save(os.path.join(dest, name), 'WEBP', quality=92, method=6)
        e = {'id': pid, 'file': name, 'tex': spec.get('tex', ''), 'kind': spec['kind'],
             'x': fx + px0 / scale, 'y': fy + py0 / scale, 'w': im.width / scale, 'h': im.height / scale,
             'baseY': spec['y'], 'anchorX': spec['x']}
        if spec.get('depth_y') is not None:
            e['depthY'] = spec['depth_y']
        if spec.get('hub'):
            e['hub'] = spec['hub']
        entries.append(e)
        for o in obs:
            o.visible_camera = False
        print('prop', pid, im.size, flush=True)
    lib.clear_border()
    man = json.load(open(man_path)) if os.path.exists(man_path) else {'board': board_id}
    man['props'] = entries
    with open(man_path, 'w') as fh:
        json.dump(man, fh, indent=1)
    keep = {t['file'] for t in man.get('tiles', [])} | {e['file'] for e in entries} | {'manifest.json', man.get('shadow', {}).get('file', '')}
    for f in os.listdir(dest):
        if f.startswith('prop_') and f not in keep:
            os.remove(os.path.join(dest, f))


def island_shadow(board_id: str, terrain_png: str, offset=(150, 70), blur=34.0, down=6, alpha=190):
    """Soft shadow of the islands on the cloud sea (scripts/art/island_shadow.py with explicit paths)."""
    dest = os.path.join(ROOT, 'public', 'assets', 'rendered', board_id)
    man_path = os.path.join(dest, 'manifest.json')
    man = json.load(open(man_path))
    scale = man['scale']
    ox, oy = man['origin']
    src = Image.open(terrain_png).getchannel('A')
    bwid, bhei = src.width / scale, src.height / scale
    pad = int(blur * 3)
    sw, sh = int((bwid + pad * 2) / down), int((bhei + pad * 2) / down)
    small = src.resize((int(bwid / down), int(bhei / down)), Image.BILINEAR)
    canvas = Image.new('L', (sw, sh), 0)
    canvas.paste(small, (pad // down, pad // down))
    canvas = canvas.filter(ImageFilter.GaussianBlur(blur / down))
    a = np.asarray(canvas, np.float32) / 255.0
    rgba = np.zeros((sh, sw, 4), np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 26, 38, 78
    rgba[..., 3] = np.clip(a * alpha, 0, 255).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(dest, 'shadow.webp'), 'WEBP', quality=85, method=6)
    man['shadow'] = {'file': 'shadow.webp', 'x': ox - pad + offset[0], 'y': oy - pad + offset[1], 'w': sw * down, 'h': sh * down}
    with open(man_path, 'w') as fh:
        json.dump(man, fh, indent=1)
    print('wrote shadow', sw, sh, man['shadow'])


def sketch(path: str, frame, scale: float = 0.25, objects=None):
    """A quick flat-shaded projection of the scene's meshes (painter's algorithm in numpy/PIL; no
    Blender render), for checking the layout while the render slot is busy."""
    fx, fy, fw, fh = frame
    img = Image.new('RGB', (int(fw * scale), int(fh * scale)), (150, 190, 230))
    draw = ImageDraw.Draw(img)
    sun = np.array([0.45, 0.35, 0.82])
    sun /= np.linalg.norm(sun)
    tris_all, cols_all, depth_all = [], [], []
    objs = objects if objects is not None else [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in objs:
        me = o.data
        n = len(me.vertices)
        if n == 0 or o.hide_render:
            continue
        co = np.zeros(n * 3, np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        mw = np.array(o.matrix_world, np.float32)
        co = co @ mw[:3, :3].T + mw[:3, 3]
        attr = me.color_attributes.get('col')
        if attr is not None and attr.domain == 'POINT':
            c = np.zeros(n * 4, np.float32)
            attr.data.foreach_get('color', c)
            vc = c.reshape(-1, 4)[:, :3]
        else:
            vc = None
        me.calc_loop_triangles()
        nt = len(me.loop_triangles)
        if nt == 0:
            continue
        tv = np.zeros(nt * 3, np.int32)
        me.loop_triangles.foreach_get('vertices', tv)
        tv = tv.reshape(-1, 3)
        p = co[tv]  # (nt, 3, 3)
        nrm = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        if vc is not None:
            base = vc[tv].mean(axis=1)
        else:
            # islands: grass on top, rock on the sides
            up = nrm[:, 2]
            base = np.where(up[:, None] > 0.6, np.array([0.12, 0.35, 0.08]), np.array([0.25, 0.18, 0.14]))
        shade = 0.45 + 0.55 * np.clip(np.abs(nrm @ sun), 0, 1)
        rgb = np.clip(base * shade[:, None], 0, 1) ** (1 / 2.2)
        bx = p[..., 0] * PX
        by = -(p[..., 1] * COSB + p[..., 2] * SINB) * PX
        d = (p[..., 1] * SINB - p[..., 2] * COSB).mean(axis=1)
        tris_all.append(np.stack([(bx - fx) * scale, (by - fy) * scale], axis=-1))
        cols_all.append((rgb * 255).astype(np.uint8))
        depth_all.append(d)
    if not tris_all:
        img.save(path)
        return
    T = np.concatenate(tris_all)
    C = np.concatenate(cols_all)
    D = np.concatenate(depth_all)
    for i in np.argsort(-D):
        t = T[i]
        draw.polygon([(t[0, 0], t[0, 1]), (t[1, 0], t[1, 1]), (t[2, 0], t[2, 1])], fill=tuple(int(v) for v in C[i]))
    img.save(path)
    print('sketch', path, img.size, len(D), 'triangles', flush=True)


def export_tiles(png: str, board_id: str, frame, scale: float):
    from tiles import export_tiles as _export
    return _export(png, board_id, frame[:2], scale)
