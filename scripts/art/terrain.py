"""Reusable terrain pieces for the pre-rendered art: floating islands built from a 2D mask,
the grass / trail / rock island material, and scatter (grass, flowers, bushes, rocks, trees,
vines, stepping stones). Coordinates are board / screen pixels (see lib.board_to_world).
"""
from __future__ import annotations

import math
import random

import numpy as np
from scipy import ndimage
from skimage import measure

import bpy
from mathutils import Vector, noise

import lib
from lib import PX, board_to_world, col

GRID = 4  # px per mask cell (masks passed in use this spacing)
W, H = 4200, 2800  # mask canvas; set_canvas() changes it


def set_canvas(w: int, h: int, grid: int = 4) -> None:
    """Size of the board-pixel canvas the masks cover."""
    global W, H, GRID
    W, H, GRID = w, h, grid


def resample(poly, n):
    poly = np.asarray(poly, np.float64)
    if np.linalg.norm(poly[0] - poly[-1]) > 1e-6:
        poly = np.vstack([poly, poly[:1]])
    seg = np.linalg.norm(np.diff(poly, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, s[-1], n, endpoint=False)
    x = np.interp(t, s, poly[:, 0])
    y = np.interp(t, s, poly[:, 1])
    out = np.stack([x, y], 1)
    # counter-clockwise in board space (y down) -> check signed area
    area = 0.5 * np.sum(out[:, 0] * np.roll(out[:, 1], -1) - np.roll(out[:, 0], -1) * out[:, 1])
    if area < 0:
        out = out[::-1]
    return out


def level_contour(dist, level):
    cs = measure.find_contours(dist, level)
    if not cs:
        return None
    c = max(cs, key=len)
    if len(c) < 12:
        return None
    # skimage returns (row, col) in grid units
    return np.stack([c[:, 1] * GRID, c[:, 0] * GRID], 1)


def dist_at(dist, bx, by):
    gx = min(max(int(bx / GRID), 0), dist.shape[1] - 1)
    gy = min(max(int(by / GRID), 0), dist.shape[0] - 1)
    return float(dist[gy, gx])


def orient(faces, verts, want):
    """Flip faces so their normals agree with want(face_centre) (a Vector direction)."""
    out = []
    for f in faces:
        a, b, c = (Vector(verts[i]) for i in f[:3])
        n = (b - a).cross(c - a)
        cen = sum((Vector(verts[i]) for i in f), Vector()) / len(f)
        if n.dot(want(cen)) < 0:
            f = tuple(reversed(f))
        out.append(f)
    return out


def build_island(ids, mask, name, mat_island):
    from scipy.spatial import Delaunay
    dist = ndimage.distance_transform_edt(mask) * GRID
    dist = ndimage.gaussian_filter(dist, 1.2)
    small = len(ids) <= 1
    outline = level_contour(dist, 2.0)
    per = float(np.sum(np.linalg.norm(np.diff(np.vstack([outline, outline[:1]]), axis=0), axis=1)))
    N = max(40, int(per / 13))
    ring = resample(outline, N)
    # outward normals
    nrm = np.zeros_like(ring)
    for k in range(N):
        t = ring[(k + 1) % N] - ring[k - 1]
        n = np.array([t[1], -t[0]])
        n /= (np.linalg.norm(n) or 1)
        if dist_at(dist, *(ring[k] + n * 6)) > dist_at(dist, *(ring[k] - n * 6)):
            n = -n
        nrm[k] = n
    import triangle as tr
    seg = np.array([[k, (k + 1) % N] for k in range(N)])
    area_px = (26.0 if not small else 18.0) ** 2
    T = tr.triangulate({'vertices': ring, 'segments': seg}, f'pq28a{area_px:.0f}')
    pts2 = T['vertices']
    tris = [tuple(int(i) for i in t) for t in T['triangles']]
    P = len(pts2)
    size = 0.62 if small else 1.0
    verts = []
    weights = []
    # top (z = 0)
    for (bx, by) in pts2:
        verts.append(tuple(board_to_world(bx, by, 0.0)))
        weights.append(0.0)
    # lip ring
    lip0 = len(verts)
    for k in range(N):
        bx, by = ring[k] + nrm[k] * 4
        verts.append(tuple(board_to_world(bx, by, -0.12)))
        weights.append(0.0)
    # underside (ring at cliff depth + interior dropped by distance)
    und0 = len(verts)
    for i, (bx, by) in enumerate(pts2):
        d = dist_at(dist, bx, by) if i >= N else 0.0
        w = board_to_world(bx, by, 0.0)
        q = Vector((w.x * 0.8, w.y * 0.8, 0.0))
        depth = 0.4 + 3.3 * size * (d / 100.0) ** 0.85
        depth *= 1.0 + 0.28 * noise.noise(q) + 0.12 * noise.noise(q * 3.3 + Vector((3, 1, 2)))
        if i < N:
            depth = 0.4
        verts.append((w.x, w.y, -depth))
        weights.append(0.35 if i < N else 1.0)
    faces = []
    up = lambda c: Vector((0, 0, 1))
    down = lambda c: Vector((0, 0, -1))
    faces += orient(tris, verts, up)
    faces += orient([tuple(und0 + i for i in t) for t in tris], verts, down)
    band = []
    for k in range(N):
        k2 = (k + 1) % N
        band.append((k, k2, lip0 + k2, lip0 + k))
        band.append((lip0 + k, lip0 + k2, und0 + k2, und0 + k))
    wc = board_to_world(*ring.mean(0), 0.0)
    faces += orient(band, verts, lambda c: Vector((c.x - wc.x, c.y - wc.y, 0.0)))
    ob = lib.mesh_object(name, verts, faces, smooth=True, material=mat_island)
    me = ob.data
    ntop = len(tris)
    for i in range(ntop):
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
    disp.strength = 0.22
    disp.mid_level = 0.5
    disp.vertex_group = 'rock'
    under = [(verts[und0 + i], dist_at(dist, *pts2[i]) if i >= N else 0.0) for i in range(P)]
    return ob, dist, under, ring, nrm


# Per-region looks: grass/trail ramps and how densely each kind of scatter is placed.
THEMES = {
    'plaza': dict(grass=[(0.28, '#23701f'), (0.42, '#358f28'), (0.55, '#4fab32'), (0.68, '#72c23c'), (0.82, '#9fd350')],
                  trail=[(0.3, '#d49a52'), (0.5, '#e3b36c'), (0.7, '#efcb8c')], trees=1.0, pines=0.3, flowers=1.3, bushes=1.0, rocks=0.7),
    'grove': dict(grass=[(0.28, '#18521f'), (0.42, '#236a28'), (0.55, '#318533'), (0.68, '#4a9b39'), (0.82, '#6cae44')],
                  trail=[(0.3, '#ae7843'), (0.5, '#c28b50'), (0.7, '#d5a468')], trees=2.4, pines=0.55, flowers=0.6, bushes=1.5, rocks=1.0, mushrooms=1.0),
    'works': dict(grass=[(0.28, '#1b6456'), (0.42, '#27806c'), (0.55, '#379a7e'), (0.68, '#55b092'), (0.82, '#84c7a6')],
                  trail=[(0.3, '#b3a089'), (0.5, '#c8b59c'), (0.7, '#dccdb6')], trees=0.45, pines=0.5, flowers=0.4, bushes=0.6, rocks=1.7, crystals=1.0),
    'terrace': dict(grass=[(0.28, '#4d7b1f'), (0.42, '#679826'), (0.55, '#83b031'), (0.68, '#a1c342'), (0.82, '#c3d55c')],
                    trail=[(0.3, '#cf9a58'), (0.5, '#dfb070'), (0.7, '#ecc88f')], trees=0.6, pines=0.2, flowers=1.1, bushes=0.7, rocks=0.6, hay=1.0, crates=0.7),
    'windy': dict(grass=[(0.28, '#3a773a'), (0.42, '#518d47'), (0.55, '#6aa459'), (0.68, '#8aba71'), (0.82, '#adce90')],
                  trail=[(0.3, '#c69e76'), (0.5, '#d5b18a'), (0.7, '#e3c7a4')], trees=0.7, pines=0.8, flowers=0.5, bushes=0.8, rocks=2.4),
    'docks': dict(grass=[(0.28, '#2a7329'), (0.42, '#3b8a2f'), (0.55, '#51a238'), (0.68, '#70b845'), (0.82, '#98cb58')],
                  trail=[(0.3, '#c99159'), (0.5, '#d9a871'), (0.7, '#e8c191')], trees=0.7, pines=0.3, flowers=0.9, bushes=0.9, rocks=0.8, crates=1.3),
    'obs': dict(grass=[(0.28, '#216c2e'), (0.42, '#2f873a'), (0.55, '#44a047'), (0.68, '#63b555'), (0.82, '#8fc96a')],
                trail=[(0.3, '#c9b48f'), (0.5, '#dac7a4'), (0.7, '#e8dbbf')], trees=0.9, pines=0.35, flowers=1.0, bushes=1.0, rocks=0.9),
}


def island_material(mask_path, theme='plaza'):
    T = THEMES.get(theme, THEMES['plaza'])
    m = lib.NT(f'island_{theme}')
    pos = m.position()
    nrm = m.normal()
    nz = m.sep(nrm)[2]
    X, Y, Z = m.sep(pos)
    # --- path mask lookup (world -> board uv)
    mp = m.node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (PX / W, lib.COSB * PX / H, 1.0)
    mp.inputs['Location'].default_value = (0.0, 1.0, 0.0)
    m.link(pos, mp.inputs['Vector'])
    img = m.node('ShaderNodeTexImage')
    img.image = bpy.data.images.load(mask_path)
    img.image.colorspace_settings.name = 'Non-Color'
    img.extension = 'EXTEND'
    img.interpolation = 'Cubic'
    m.link(mp.outputs['Vector'], img.inputs['Vector'])
    pmask = img.outputs['Color']
    pm = m.maprange(m.sep(pmask)[0], 0.25, 0.65)
    # --- grass
    n1 = m.noise(0.9, 5, 0.6, pos)
    n2 = m.noise(6.0, 3, 0.5, pos)
    gfac = m.math('ADD', m.math('MULTIPLY', n1.outputs['Fac'], 0.8), m.math('MULTIPLY', n2.outputs['Fac'], 0.35))
    grass = m.ramp(gfac, T['grass'])
    # --- dirt trail
    d1 = m.noise(2.2, 4, 0.6, pos)
    dirt = m.ramp(d1.outputs['Fac'], T['trail'])
    peb = m.voronoi(18.0, pos)
    pebf = m.maprange(peb.outputs['Distance'], 0.05, 0.18, 1.0, 0.0)
    dirt = m.mix(m.math('MULTIPLY', pebf, 0.45), dirt, lib.col('#f4e2bd'))
    # soft darker edge where trail meets grass
    edge = m.math('MULTIPLY', m.maprange(m.sep(pmask)[0], 0.12, 0.35), m.maprange(m.sep(pmask)[0], 0.6, 0.35))
    grass_d = m.mix(m.math('MULTIPLY', edge, 0.55), grass, lib.col('#6b8a32'))
    top = m.mix(pm, grass_d, dirt)
    # --- rock underside: strata bands + noise
    wave = m.node('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 1.4
    wave.inputs['Distortion'].default_value = 6.0
    wave.inputs['Detail'].default_value = 3.0
    m.link(pos, wave.inputs['Vector'])
    rn = m.noise(1.8, 6, 0.6, pos)
    rf = m.math('ADD', m.math('MULTIPLY', wave.outputs['Fac'], 0.55), m.math('MULTIPLY', rn.outputs['Fac'], 0.5))
    rock = m.ramp(rf, [(0.25, '#5a3d3a'), (0.4, '#7b5140'), (0.55, '#99694b'), (0.7, '#6e5566'), (0.85, '#8a7a8e')])
    # soil band just under the grass
    soil = m.ramp(rn.outputs['Fac'], [(0.3, '#6b4228'), (0.7, '#8c5a33')])
    soilfac = m.maprange(Z, -0.55, -0.1)
    rock = m.mix(soilfac, rock, soil)
    # deeper = darker, cooler
    depth = m.maprange(Z, -4.5, -0.5, 0.0, 1.0, smooth=False)
    rock = m.mult(rock, m.mix(depth, lib.col('#6b5f8a'), lib.col('#ffffff')))
    ao = m.ao(0.9, 8)
    rock = m.mult(rock, m.mix(ao, lib.col('#3a3048'), lib.col('#ffffff')))
    # --- grass wraps over the rim a little
    gn = m.noise(8.0, 2, 0.5, pos)
    wrap = m.math('ADD', nz, m.math('MULTIPLY', m.math('SUBTRACT', gn.outputs['Fac'], 0.5), 0.9))
    lipz = m.maprange(Z, -0.28, -0.02)
    grassfac = m.math('MAXIMUM', m.maprange(wrap, 0.55, 0.8), m.math('MULTIPLY', lipz, m.maprange(gn.outputs['Fac'], 0.45, 0.6)))
    colr = m.mix(grassfac, rock, top)
    bump = m.bump(m.math('ADD', rn.outputs['Fac'], m.math('MULTIPLY', gfac, 0.2)), 0.35, 0.08)
    rough = m.math('ADD', m.math('MULTIPLY', grassfac, 0.1), 0.78)
    m.bsdf(colr, rough, normal=bump, sheen=0.25)
    return m.mat


GREENS = ['#2f8a28', '#3f9d2e', '#52b034', '#66bf3b', '#7ccb45', '#3a9530']


def grass_tuft(mb, bx, by, rnd, scale=1.0):
    base = board_to_world(bx, by, 0.0)
    blades = rnd.randint(6, 10)
    c0 = col(rnd.choice(GREENS))
    dark = lib.lerp_col(c0, col('#123d14'), 0.45)
    tipc = lib.lerp_col(c0, col('#d6ef7c'), 0.45)
    for _ in range(blades):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0.0, 0.07) * scale
        h = rnd.uniform(0.08, 0.16) * scale
        lean = rnd.uniform(0.02, 0.06) * scale
        w = 0.017 * scale
        ox, oy = base.x + math.cos(a) * r, base.y + math.sin(a) * r
        la = a + rnd.uniform(-0.6, 0.6)
        tip = (ox + math.cos(la) * lean, oy + math.sin(la) * lean, h)
        pa = a + math.pi / 2
        v = [(ox - math.cos(pa) * w, oy - math.sin(pa) * w, 0.0), (ox + math.cos(pa) * w, oy + math.sin(pa) * w, 0.0), tip]
        mb.v.extend(v)
        n = len(mb.v)
        mb.f.append((n - 3, n - 2, n - 1))
        mb.c.extend([dark, dark, tipc])


FLOWERS = ['#ffffff', '#ffe066', '#ff8fb1', '#c9a3ff', '#ffb35c', '#ff6b6b', '#8fd3ff', '#fff3a8']


def flower(mb, x, y, h, c, size=0.05):
    """Five petals around a yellow heart, facing up."""
    for k in range(5):
        a = k / 5 * math.tau
        v, f = lib.blob((x + math.cos(a) * size * 0.8, y + math.sin(a) * size * 0.8, h), size * 0.62, squash=(1, 1, 0.35), rough=0.0, subdiv=1)
        mb.add(v, f, c)
    v, f = lib.blob((x, y, h + 0.01), size * 0.45, squash=(1, 1, 0.5), rough=0.0, subdiv=1)
    mb.add(v, f, col('#ffc933'))


def flower_bed(mb, leaves, bx, by, rnd, count=None):
    cols = [col(c) for c in rnd.sample(FLOWERS, 2)]
    for _ in range(count or rnd.randint(7, 16)):
        fx = bx + rnd.gauss(0, 20)
        fy = by + rnd.gauss(0, 14)
        p = board_to_world(fx, fy, 0.0)
        h = rnd.uniform(0.07, 0.16)
        flower(mb, p.x, p.y, h, rnd.choice(cols), rnd.uniform(0.035, 0.055))
        sv = [(p.x - 0.008, p.y, 0.0), (p.x + 0.008, p.y, 0.0), (p.x, p.y, h)]
        mb.add(sv, [(0, 1, 2)], col('#3f8f2c'))
        if rnd.random() < 0.6:
            v, f = lib.blob((p.x + rnd.uniform(-0.04, 0.04), p.y, 0.03), 0.05, squash=(1.4, 1, 0.3), rough=0.1, subdiv=1)
            leaves.add(v, f, col(rnd.choice(['#3f9b33', '#4aa83a', '#2f8a2c'])))


def bush(mb, bx, by, rnd, s=1.0, berries=None):
    p = board_to_world(bx, by, 0.0)
    base = col(rnd.choice(['#23801f', '#2f8f26', '#1f6f28', '#3a9328', '#18693a']))
    top = lib.lerp_col(base, col('#a6d94a'), 0.5)
    low = lib.lerp_col(base, col('#0b2a10'), 0.55)
    for _ in range(rnd.randint(4, 7)):
        ox = rnd.uniform(-0.24, 0.24) * s
        oy = rnd.uniform(-0.16, 0.16) * s
        r = rnd.uniform(0.14, 0.24) * s
        cz = r * 0.75 + rnd.uniform(0, 0.08) * s
        v, f = lib.blob((p.x + ox, p.y + oy, cz), r, squash=(1, 1, 0.88), rough=0.22, freq=2.6, seed=rnd.random() * 50)

        def shade(vv, cz=cz, r=r):
            t = max(0.0, min(1.0, (vv[2] - cz) / (r * 1.2) + 0.45))
            return lib.lerp_col(low, top, t)

        mb.add(v, f, shade)
        if berries is not None and rnd.random() < 0.5:
            bc = col(rnd.choice(['#ff5a6e', '#ffd166', '#ffffff', '#ff9ecb']))
            for _ in range(4):
                a = rnd.uniform(0, math.tau)
                el = rnd.uniform(0.2, 1.0)
                q = (p.x + ox + math.cos(a) * r * 0.9 * math.cos(el), p.y + oy + math.sin(a) * r * 0.9 * math.cos(el), cz + r * 0.8 * math.sin(el))
                bv, bf = lib.blob(q, 0.028, rough=0.0, subdiv=1)
                berries.add(bv, bf, bc)


def rock(mb, bx, by, rnd, s=1.0, moss=True):
    p = board_to_world(bx, by, 0.0)
    r = rnd.uniform(0.08, 0.2) * s
    v, f = lib.blob((p.x, p.y, r * 0.3), r, squash=(1.25, 1.0, 0.72), rough=0.32, freq=2.4, subdiv=2, seed=rnd.random() * 99)
    base = col(rnd.choice(['#a39a92', '#978d86', '#b4aca2', '#8e8790']))
    mossc = col('#5aa83a')
    mb.add(v, f, lambda vv: lib.lerp_col(base, mossc, 0.85) if (moss and vv[2] > r * 0.55) else base)


def tree_round(mb_leaf, mb_wood, bx, by, rnd, s=1.0, palette=None):
    p = board_to_world(bx, by, 0.0)
    h = rnd.uniform(1.5, 2.1) * s
    # trunk with a slight lean
    lean = (rnd.uniform(-0.08, 0.08), rnd.uniform(-0.08, 0.08))
    tv, tf = lib.cylinder((p.x, p.y, 0.0), 0.13 * s, 0.08 * s, h * 0.72, sides=10)
    tv = [(x + lean[0] * z, y + lean[1] * z, z) for (x, y, z) in tv]
    mb_wood.add(tv, tf, lambda vv: lib.lerp_col(col('#5e3b22'), col('#8a5a34'), min(1.0, vv[2] / h)))
    pal = palette or rnd.choice([('#1d6e21', '#6cc23a'), ('#17632f', '#5dbb4a'), ('#2a7d1e', '#93cc2e'), ('#145f3f', '#4fc07a'), ('#2d6b1a', '#b0c73a')])
    low, high = col(pal[0]), col(pal[1])
    cx, cy, cz = p.x + lean[0] * h, p.y + lean[1] * h, h * 0.78
    R = rnd.uniform(0.55, 0.75) * s
    puffs = [(0, 0, 0.1, 1.0)] + [(math.cos(a) * R * 0.55, math.sin(a) * R * 0.45, rnd.uniform(-0.2, 0.25) * R, rnd.uniform(0.6, 0.8))
                                   for a in np.linspace(0, math.tau, rnd.randint(4, 6), endpoint=False) + rnd.random()]
    for (ox, oy, oz, rr) in puffs:
        r = R * rr
        v, f = lib.blob((cx + ox, cy + oy, cz + oz), r, squash=(1, 1, 0.9), rough=0.16, freq=1.8, subdiv=3, seed=rnd.random() * 70)

        def shade(vv, zc=cz + oz, r=r):
            t = max(0.0, min(1.0, (vv[2] - zc) / (r * 1.1) + 0.5))
            return lib.lerp_col(low, high, t * t)

        mb_leaf.add(v, f, shade)
    return h + R


def tree_pine(mb_leaf, mb_wood, bx, by, rnd, s=1.0):
    p = board_to_world(bx, by, 0.0)
    h = rnd.uniform(1.8, 2.5) * s
    tv, tf = lib.cylinder((p.x, p.y, 0.0), 0.1 * s, 0.07 * s, h * 0.35, sides=8)
    mb_wood.add(tv, tf, col('#5e3b22'))
    low, high = col('#0f4f2e'), col('#3fa05a')
    tiers = 4
    for t in range(tiers):
        z0 = h * (0.22 + t * 0.19)
        r0 = (0.62 - t * 0.12) * s
        hh = h * 0.34
        sides = 12
        verts = [(p.x + math.cos(a) * r0, p.y + math.sin(a) * r0, z0) for a in np.linspace(0, math.tau, sides, endpoint=False)]
        verts = [(x + noise.noise(Vector((x * 3, y * 3, z0))) * 0.05, y, z) for (x, y, z) in verts]
        verts.append((p.x, p.y, z0 + hh))
        verts.append((p.x, p.y, z0 + 0.02))
        faces = [(k, (k + 1) % sides, sides) for k in range(sides)] + [((k + 1) % sides, k, sides + 1) for k in range(sides)]
        mb_leaf.add(verts, faces, lambda vv, z0=z0, hh=hh: lib.lerp_col(low, high, max(0.0, min(1.0, (vv[2] - z0) / hh))))
    return h


def vine(mb, start, outward, rnd, length):
    """A leafy vine hanging off the rim."""
    x, y, z = start
    segs = max(4, int(length / 0.06))
    sway = rnd.uniform(0, math.tau)
    stem = col('#2d6b22')
    pts = []
    for k in range(segs + 1):
        t = k / segs
        pts.append((x + outward[0] * 0.06 * t + math.sin(t * 4 + sway) * 0.03, y + outward[1] * 0.06 * t, z - length * t))
    for a, b in zip(pts, pts[1:]):
        w = 0.012
        mb.add([(a[0] - w, a[1], a[2]), (a[0] + w, a[1], a[2]), (b[0] + w, b[1], b[2]), (b[0] - w, b[1], b[2])], [(0, 1, 2, 3)], stem)
    for q in pts[1:]:
        for _ in range(2):
            lv, lf = lib.blob((q[0] + rnd.uniform(-0.035, 0.035), q[1] - 0.015, q[2] + rnd.uniform(-0.02, 0.02)), rnd.uniform(0.028, 0.045),
                              squash=(1.3, 0.45, 1.0), rough=0.1, subdiv=1)
            mb.add(lv, lf, col(rnd.choice(['#23701f', '#2f8a28', '#3f9d2e', '#1c5e22', '#4fab32'])))


def stepping_stone(mb_rock, mb_grass, bx, by, rnd, r=0.3):
    p = board_to_world(bx, by, 0.0)
    sides = 16
    top = []
    for k in range(sides):
        a = k / sides * math.tau
        rr = r * (1 + noise.noise(Vector((math.cos(a) * 2 + bx * 0.1, math.sin(a) * 2, by * 0.01))) * 0.16)
        top.append((p.x + math.cos(a) * rr, p.y + math.sin(a) * rr / lib.COSB * 0.9, 0.0))
    mid = [(x + (p.x - x) * 0.05, y + (p.y - y) * 0.05, -0.1) for (x, y, _) in top]
    bot = [(x + (p.x - x) * 0.5, y + (p.y - y) * 0.5, -0.3) for (x, y, _) in top]
    tip = (p.x + rnd.uniform(-0.05, 0.05), p.y, -0.62 - rnd.uniform(0, 0.2))
    verts = top + mid + bot + [tip]
    faces = [tuple(range(sides - 1, -1, -1))]
    for k in range(sides):
        k2 = (k + 1) % sides
        faces.append((k, k2, sides + k2, sides + k))
        faces.append((sides + k, sides + k2, 2 * sides + k2, 2 * sides + k))
        faces.append((2 * sides + k, 2 * sides + k2, 3 * sides))
    mb_rock.add(verts, faces, lambda vv: col('#8fbf52') if vv[2] > -0.005 else (col('#7a5a45') if vv[2] > -0.2 else col('#6a5260')))
    for _ in range(3):
        grass_tuft(mb_grass, bx + rnd.uniform(-18, 18), by + rnd.uniform(-10, 10), rnd, 0.7)


def mushroom_cluster(mb, bx, by, rnd):
    """A few red-capped toadstools (grove)."""
    for _ in range(rnd.randint(2, 4)):
        p = board_to_world(bx + rnd.gauss(0, 10), by + rnd.gauss(0, 7), 0.0)
        h = rnd.uniform(0.07, 0.15)
        v, f = lib.cylinder((p.x, p.y, 0.0), 0.028, 0.022, h, sides=8)
        mb.add(v, f, col('#f4ead8'))
        r = rnd.uniform(0.06, 0.1)
        v, f = lib.blob((p.x, p.y, h), r, squash=(1.0, 1.0, 0.55), rough=0.05, subdiv=2, seed=rnd.random() * 20)
        cap = col(rnd.choice(['#e8433a', '#d9362f', '#f0702e']))
        spot = col('#fff4e6')

        def shade(vv, cz=h, r=r, cap=cap, spot=spot):
            hi = vv[2] > cz + r * 0.25 and (math.sin(vv[0] * 90) * math.sin(vv[1] * 90) > 0.72)
            return spot if hi else cap
        mb.add(v, f, shade)


def crystal_cluster(mb, bx, by, rnd, s=1.0):
    """Ground crystals (crystal works)."""
    p = board_to_world(bx, by, 0.0)
    c = rnd.choice(['#5ce1ff', '#8ff0ff', '#c49bff', '#7fd8ff'])
    for k in range(rnd.randint(3, 5)):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(0.0, 0.08) * s
        v, f = lib.prism((p.x + math.cos(a) * d, p.y + math.sin(a) * d, -0.02), rnd.uniform(0.04, 0.08) * s, rnd.uniform(0.18, 0.42) * s,
                         tilt=(rnd.uniform(-0.45, 0.45), rnd.uniform(-0.45, 0.45)), twist=rnd.random())
        mb.add(v, f, col(c))


def hay_bale(mb, bx, by, rnd):
    """Round hay bale lying on its side (terrace meadow)."""
    p = board_to_world(bx, by, 0.0)
    r = rnd.uniform(0.13, 0.17)
    L = r * 1.3
    v, f = lib.cylinder((0, 0, -L / 2), r, r, L, sides=16)
    ang = rnd.uniform(0, math.pi)
    v = lib.transform(v, loc=(p.x, p.y, r * 0.95), rot=(math.pi / 2, 0.0, ang))
    mb.add(v, f, lambda vv: lib.lerp_col(col('#c99a3e'), col('#f0cf6a'), max(0.0, min(1.0, vv[2] / (2 * r)))))


def crate(mb, bx, by, rnd, s=1.0):
    p = board_to_world(bx, by, 0.0)
    e = rnd.uniform(0.14, 0.2) * s
    v, f = lib.box((p.x, p.y, e / 2), (e, e, e), rot_z=rnd.uniform(0, math.pi))
    mb.add(v, f, col(rnd.choice(['#b07a45', '#a06a3a', '#c08a52'])))
    if rnd.random() < 0.4:
        e2 = e * 0.7
        v, f = lib.box((p.x + rnd.uniform(-0.02, 0.02), p.y, e + e2 / 2), (e2, e2, e2), rot_z=rnd.uniform(0, math.pi))
        mb.add(v, f, col('#c9965c'))


def barrel(mb, bx, by, rnd):
    p = board_to_world(bx, by, 0.0)
    r, h = 0.09, 0.24
    v, f = lib.lathe([(r * 0.85, 0.0), (r, h * 0.3), (r, h * 0.7), (r * 0.85, h), (0.0, h)], 14, (p.x, p.y, 0.0), cap_bottom=False)

    def shade(vv):
        z = vv[2]
        band = abs(z - h * 0.2) < 0.012 or abs(z - h * 0.8) < 0.012
        return col('#6b6f78') if band else col('#9a6436')
    mb.add(v, f, shade)


def fence_run(mb, ax, ay, bx, by, rnd, h=0.22):
    """Short rustic fence between two board points: posts with slightly uneven rails."""
    a = board_to_world(ax, ay, 0.0)
    b = board_to_world(bx, by, 0.0)
    L = (b - a).length
    n = max(1, int(L / 0.42))
    for k in range(n + 1):
        t = k / n
        px, py = a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t
        v, f = lib.box((px, py, h / 2), (0.05, 0.05, h + rnd.uniform(-0.02, 0.02)), rot_z=rnd.uniform(-0.2, 0.2))
        mb.add(v, f, col(rnd.choice(['#7a5234', '#6e4a2c', '#86593a'])))
    ang = math.atan2(b.y - a.y, b.x - a.x)
    for zz in (h * 0.45, h * 0.85):
        v, f = lib.box(((a.x + b.x) / 2, (a.y + b.y) / 2, zz + rnd.uniform(-0.01, 0.01)), (L, 0.03, 0.035), rot_z=ang)
        mb.add(v, f, col(rnd.choice(['#a8744a', '#9a6a42'])))


def lamp_post(mb_wood, mb_glow, bx, by, rnd):
    """Small iron-and-wood trail lamp with a warm glass lantern."""
    p = board_to_world(bx, by, 0.0)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.035, 0.028, 0.62, 8)
    mb_wood.add(v, f, col('#4a3a34'))
    v, f = lib.box((p.x + 0.07, p.y, 0.6), (0.16, 0.025, 0.025))
    mb_wood.add(v, f, col('#4a3a34'))
    v, f = lib.lathe([(0.0, 0.0), (0.05, 0.02), (0.055, 0.1), (0.035, 0.14), (0.0, 0.15)], 8, (p.x + 0.14, p.y, 0.44))
    mb_glow.add(v, f, col('#ffd27a'))
    v, f = lib.lathe([(0.065, 0.0), (0.0, 0.05)], 8, (p.x + 0.14, p.y, 0.59), cap_bottom=True, cap_top=False)
    mb_wood.add(v, f, col('#3a2e2a'))
