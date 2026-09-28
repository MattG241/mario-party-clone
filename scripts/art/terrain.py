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


def cam_ao(m, distance, samples=4):
    """Ambient occlusion for camera rays only: bounce light barely shows it, and on bounces the zero
    trace distance makes the lookup almost free (it is paid at every hit otherwise, which adds up
    on the huge board render)."""
    lp = m.node('ShaderNodeLightPath')
    n = m.node('ShaderNodeAmbientOcclusion')
    n.samples = samples
    m.link(m.math('MULTIPLY', lp.outputs['Is Camera Ray'], distance), n.inputs['Distance'])
    return n.outputs['AO']


def ramp_const(m, fac, stops):
    """Colour ramp with hard steps (discrete picks such as flower colours)."""
    out = m.ramp(fac, stops)
    out.node.color_ramp.interpolation = 'CONSTANT'
    return out


def grass_detail(m, pos, grass, flowers=1.0, keep_off=None):
    """Fine texture on painted grass: clumps with darker gaps, blade-scale speckle, sunny and clover
    patches and a scatter of tiny flowers, so zoomed-in views keep crisp detail instead of smooth
    gradients. `keep_off` (0..1) masks the flowers away from trails."""
    cl = m.voronoi(17.0, pos)
    gap = m.maprange(cl.outputs['Distance'], 0.3, 0.8)
    sp = m.noise(46.0, 2, 0.6, pos)
    spk = m.maprange(sp.outputs['Fac'], 0.4, 0.64)
    shade = m.math('ADD', m.math('MULTIPLY', gap, 0.55), m.math('MULTIPLY', spk, 0.45))
    grass = m.mult(grass, m.mix(shade, lib.col('#ffffff'), lib.col('#b3c296')))
    tips = m.math('MULTIPLY', m.maprange(sp.outputs['Fac'], 0.58, 0.7), m.math('SUBTRACT', 1.0, gap))
    grass = m.mix(m.math('MULTIPLY', tips, 0.3), grass, lib.col('#d6ec8a'))
    # patches a few tens of px across: warm dry grass and cool clover
    pn = m.noise(2.4, 3, 0.55, pos)
    grass = m.mix(m.math('MULTIPLY', m.maprange(pn.outputs['Fac'], 0.6, 0.72), 0.2), grass, lib.col('#c9d166'))
    grass = m.mix(m.math('MULTIPLY', m.maprange(pn.outputs['Fac'], 0.4, 0.3), 0.16), grass, lib.col('#2c7648'))
    if flowers > 0:
        fv = m.voronoi(9.0, pos)
        fr, fg, _ = m.sep(fv.outputs['Color'])
        dot = m.maprange(fv.outputs['Distance'], 0.26, 0.16)
        cut = 1.0 - 0.16 * flowers
        pick = m.maprange(fr, cut, cut + 0.01)
        patch = m.maprange(m.noise(1.2, 2, 0.5, pos).outputs['Fac'], 0.48, 0.58)
        fm = m.math('MULTIPLY', m.math('MULTIPLY', dot, pick), patch)
        if keep_off is not None:
            fm = m.math('MULTIPLY', fm, keep_off)
        fcol = ramp_const(m, fg, [(0.0, '#fffcf2'), (0.34, '#ffdf5e'), (0.56, '#ffa0c2'), (0.76, '#c7a6ff'), (0.9, '#fffcf2')])
        grass = m.mix(fm, grass, fcol)
    return grass


def contact_ao(m, colr, tint='#5b7247', distance=0.3, samples=4):
    """Soft contact shadow where scatter meets the ground (tufts, rocks, trunks, posts)."""
    return m.mult(colr, m.mix(m.maprange(cam_ao(m, distance, samples), 0.3, 1.0), lib.col(tint), lib.col('#ffffff')))


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
    # a pale sandy border where the trail meets the grass, and lighter grass beside it
    pv = m.sep(pmask)[0]
    fringe = m.maprange(pv, 0.02, 0.2)
    grass_d = m.mix(m.math('MULTIPLY', fringe, 0.35), grass, lib.col('#b6d36a'))
    edge = m.math('MULTIPLY', m.maprange(pv, 0.12, 0.3), m.maprange(pv, 0.55, 0.32))
    grass_d = m.mix(m.math('MULTIPLY', edge, 0.8), grass_d, lib.col('#f1dfb0'))
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


def island_material_fine(mask_path, theme='plaza'):
    """The board's island surface: island_material plus fine grass clumps, tiny flowers, gravel and
    ruts on the trails, a crisp trail edge, contact occlusion and cracked cliff faces."""
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
    pv = m.sep(pmask)[0]
    pm = m.maprange(pv, 0.25, 0.65)
    # --- grass: broad ramp, then fine clumps / speckle / tiny flowers (never on the trail edge)
    n1 = m.noise(0.9, 5, 0.6, pos)
    n2 = m.noise(6.0, 3, 0.5, pos)
    gfac = m.math('ADD', m.math('MULTIPLY', n1.outputs['Fac'], 0.8), m.math('MULTIPLY', n2.outputs['Fac'], 0.35))
    grass = m.ramp(gfac, T['grass'])
    grass = grass_detail(m, pos, grass, flowers=T.get('flowers', 1.0), keep_off=m.maprange(pv, 0.12, 0.0))
    # --- dirt trail: base ramp, pale pebbles, fine gravel and compacted ruts inside the edge
    d1 = m.noise(2.2, 4, 0.6, pos)
    dirt = m.ramp(d1.outputs['Fac'], T['trail'])
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
    dirt = m.mult(dirt, m.mix(m.math('MULTIPLY', rut, 0.55), lib.col('#ffffff'), lib.col('#dcbd92')))
    # a pale sandy border where the trail meets the grass, a crisp darker lip on the grass side of
    # it, and lighter grass just beyond: the route reads with a defined edge at any zoom
    fringe = m.maprange(pv, 0.0, 0.1)
    grass_d = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', fringe, m.maprange(pv, 0.12, 0.06)), 0.3), grass, lib.col('#b6d36a'))
    lip = m.math('MULTIPLY', m.maprange(pv, 0.06, 0.11), m.maprange(pv, 0.2, 0.13))
    grass_d = m.mix(m.math('MULTIPLY', lip, 0.5), grass_d, lib.col('#2d6526'))
    edge = m.math('MULTIPLY', m.maprange(pv, 0.14, 0.3), m.maprange(pv, 0.55, 0.32))
    grass_d = m.mix(m.math('MULTIPLY', edge, 0.8), grass_d, lib.col('#f1dfb0'))
    top = m.mix(pm, grass_d, dirt)
    top = contact_ao(m, top)
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
    # fine cracks and grain so the cliff faces stay crisp up close
    rv = m.voronoi(7.0, pos, feature='DISTANCE_TO_EDGE')
    rock = m.mult(rock, m.mix(m.maprange(rv.outputs['Distance'], 0.05, 0.0), lib.col('#ffffff'), lib.col('#6a5454')))
    rg = m.noise(30.0, 2, 0.6, pos)
    rock = m.mult(rock, m.mix(m.maprange(rg.outputs['Fac'], 0.4, 0.65), lib.col('#ffffff'), lib.col('#d8ccc6')))
    # soil band just under the grass
    soil = m.ramp(rn.outputs['Fac'], [(0.3, '#6b4228'), (0.7, '#8c5a33')])
    soilfac = m.maprange(Z, -0.55, -0.1)
    rock = m.mix(soilfac, rock, soil)
    # deeper = darker, cooler
    depth = m.maprange(Z, -4.5, -0.5, 0.0, 1.0, smooth=False)
    rock = m.mult(rock, m.mix(depth, lib.col('#6b5f8a'), lib.col('#ffffff')))
    ao = cam_ao(m, 0.9, 5)
    rock = m.mult(rock, m.mix(ao, lib.col('#3a3048'), lib.col('#ffffff')))
    # --- grass wraps over the rim a little
    gn = m.noise(8.0, 2, 0.5, pos)
    wrap = m.math('ADD', nz, m.math('MULTIPLY', m.math('SUBTRACT', gn.outputs['Fac'], 0.5), 0.9))
    lipz = m.maprange(Z, -0.28, -0.02)
    grassfac = m.math('MAXIMUM', m.maprange(wrap, 0.55, 0.8), m.math('MULTIPLY', lipz, m.maprange(gn.outputs['Fac'], 0.45, 0.6)))
    colr = m.mix(grassfac, rock, top)
    bump = m.bump(m.math('ADD', m.math('ADD', rn.outputs['Fac'], m.math('MULTIPLY', gfac, 0.2)),
                         m.math('MULTIPLY', m.maprange(rv.outputs['Distance'], 0.06, 0.0), -0.6)), 0.35, 0.08)
    rough = m.math('ADD', m.math('MULTIPLY', grassfac, 0.1), 0.78)
    m.bsdf(colr, rough, normal=bump, sheen=0.25)
    return m.mat


def scatter_mat(name, rough=0.7, sheen=0.0, ao=0.0, samples=4, emission=0.0):
    """Vertex-coloured scatter material (like lib.attr_mat) with a cheaper occlusion lookup: the board
    is one very large render on two threads."""
    m = lib.NT(name)
    c = m.attr('col')
    if ao:
        c = m.mult(c, m.mix(cam_ao(m, ao, samples), (0.35, 0.35, 0.4, 1.0), (1, 1, 1, 1)), 1.0)
    m.bsdf(c, rough, sheen=sheen, emission=c if emission else None, emission_strength=emission)
    return m.mat


def paving_material(name='paving'):
    """Pale stone slabs (vertex colour) with a fine grain, a faint bump and contact occlusion."""
    m = lib.NT(name)
    pos = m.position()
    c = m.attr('col')
    n = m.noise(26.0, 3, 0.6, pos)
    c = m.mult(c, m.mix(m.maprange(n.outputs['Fac'], 0.35, 0.72), lib.col('#ffffff'), lib.col('#d9cebd')))
    c = m.mult(c, m.mix(cam_ao(m, 0.25, 4), lib.col('#6d6272'), lib.col('#ffffff')))
    m.bsdf(c, 0.7, normal=m.bump(n.outputs['Fac'], 0.2, 0.02))
    return m.mat


def leaf_material(name, ao=0.5, rough=0.78, scale=9.0, sun='#e4f59a', shade='#1f5a3a', haze=0.0, haze_col='#b8d6ee', lift=0.0,
                  gaps='#8b9f7a', ao_tint='#3b5646'):
    """Foliage coloured by vertex colour, broken into leafy clusters: voronoi cells with darker gaps,
    a domed bump per cluster and a little per-cluster tint, so round canopies read as clumps of
    leaves instead of smooth blobs."""
    m = lib.NT(name)
    pos = m.position()
    c = m.attr('col')
    v = m.voronoi(scale, pos)
    edge = m.maprange(v.outputs['Distance'], 0.22, 0.78)
    c = m.mult(c, m.mix(edge, lib.col('#ffffff'), lib.col(gaps)))
    r_, g_, _ = m.sep(v.outputs['Color'])
    c = m.mix(m.math('MULTIPLY', m.maprange(r_, 0.55, 1.0), 0.18), c, lib.col(sun))
    c = m.mix(m.math('MULTIPLY', m.maprange(g_, 0.35, 0.0), 0.14), c, lib.col(shade))
    fine = m.noise(40.0, 2, 0.5, pos)
    c = m.mult(c, m.mix(m.maprange(fine.outputs['Fac'], 0.4, 0.66), lib.col('#ffffff'), lib.col('#c5d2ad')))
    if ao:
        c = m.mult(c, m.mix(cam_ao(m, ao, 4), lib.col(ao_tint), lib.col('#ffffff')))
    if haze:
        c = m.mix(haze, c, lib.col(haze_col))
    height = m.math('ADD', m.math('SUBTRACT', 1.0, edge), m.math('MULTIPLY', fine.outputs['Fac'], 0.3))
    m.bsdf(c, rough, normal=m.bump(height, 0.55, 0.03), sheen=0.12, emission=lib.col(haze_col) if lift else None, emission_strength=lift)
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


def variant(bx, by, salt=0):
    """A per-tree RNG seeded by position: picks a tree's variant and its shape/size/tint tweaks
    without touching the scatter RNG, so every later placement stays where it was."""
    return random.Random(int(bx * 13.0) * 7919 + int(by * 7.0) * 104729 + salt)


def tint_pair(low, high, rv):
    """Shift a (low, high) colour pair a little towards yellow-green, blue-green or deeper green."""
    k = rv.randrange(4)
    toward = [None, ('#3c6e1c', '#d2dc5a'), ('#155848', '#5fc49a'), ('#0f4a22', '#4aa83c')][k]
    if toward is None:
        return low, high
    t = rv.uniform(0.18, 0.32)
    return lib.lerp_col(low, col(toward[0]), t), lib.lerp_col(high, col(toward[1]), t)


def tree_round(mb_leaf, mb_wood, bx, by, rnd, s=1.0, palette=None, crown=False):
    """Round broadleaf tree. With `crown`, one of four shapes (round, tall, spreading or a forked
    twin crown) and a tint shift, picked by position, so neighbouring trees never look copied."""
    p = board_to_world(bx, by, 0.0)
    h = rnd.uniform(1.5, 2.1) * s
    # trunk with a slight lean
    lean = (rnd.uniform(-0.08, 0.08), rnd.uniform(-0.08, 0.08))
    rv = variant(bx, by, 1)
    var = rv.randrange(4) if crown else 0
    hk, rk, sq, spread, tw = [(1.0, 1.0, 0.9, 1.0, 1.0), (1.14, 0.84, 1.18, 0.8, 0.9), (0.88, 1.16, 0.78, 1.28, 1.2), (1.0, 0.92, 0.92, 1.0, 1.05)][var]
    h *= hk
    tv, tf = lib.cylinder((p.x, p.y, 0.0), 0.13 * s * tw, 0.08 * s * tw, h * 0.72, sides=10)
    tv = [(x + lean[0] * z, y + lean[1] * z, z) for (x, y, z) in tv]
    mb_wood.add(tv, tf, lambda vv: lib.lerp_col(col('#5e3b22'), col('#8a5a34'), min(1.0, vv[2] / h)))
    pal = palette or rnd.choice([('#1d6e21', '#6cc23a'), ('#17632f', '#5dbb4a'), ('#2a7d1e', '#93cc2e'), ('#145f3f', '#4fc07a'), ('#2d6b1a', '#b0c73a')])
    low, high = col(pal[0]), col(pal[1])
    if crown and palette is None:
        low, high = tint_pair(low, high, rv)
    cx, cy, cz = p.x + lean[0] * h, p.y + lean[1] * h, h * 0.78
    R = rnd.uniform(0.55, 0.75) * s * rk
    puffs = [(0, 0, 0.1, 1.0)] + [(math.cos(a) * R * 0.55, math.sin(a) * R * 0.45, rnd.uniform(-0.2, 0.25) * R, rnd.uniform(0.6, 0.8))
                                   for a in np.linspace(0, math.tau, rnd.randint(4, 6), endpoint=False) + rnd.random()]
    if var == 3:
        # forked: two leaning boughs carry two sub-crowns side by side
        side = rv.uniform(0, math.tau)
        dx, dy = math.cos(side) * R * 0.46, math.sin(side) * R * 0.3
        for sgn in (-1, 1):
            pts = [(cx - lean[0] * h * 0.3, cy - lean[1] * h * 0.3, h * 0.45), (cx + sgn * dx * 0.8, cy + sgn * dy * 0.8, cz - R * 0.25)]
            v, f = lib.tube(pts, lambda t: (0.075 - 0.03 * t) * s, 7)
            mb_wood.add(v, f, col('#6e4a2c'))
        puffs = [(ox + (dx if k % 2 else -dx), oy + (dy if k % 2 else -dy), oz, rr * (0.86 if k else 0.8)) for k, (ox, oy, oz, rr) in enumerate(puffs)]
        # the second sub-crown's core (seeded from the variant RNG, not the scatter RNG)
        q = puffs[0]
        v, f = lib.blob((cx - q[0], cy - q[1], cz + q[2]), R * q[3], squash=(1, 1, sq), rough=0.16, freq=1.8, subdiv=3, seed=rv.random() * 70)
        mb_leaf.add(v, f, lambda vv, zc=cz + q[2], r=R * q[3]: lib.lerp_col(low, high, max(0.0, min(1.0, (vv[2] - zc) / (r * 1.1) + 0.5)) ** 2))
    for (ox, oy, oz, rr) in puffs:
        r = R * rr
        v, f = lib.blob((cx + ox * spread, cy + oy * spread, cz + oz * (1.3 if var == 1 else 1.0)), r, squash=(1, 1, sq), rough=0.16, freq=1.8, subdiv=3, seed=rnd.random() * 70)

        def shade(vv, zc=cz + oz, r=r):
            t = max(0.0, min(1.0, (vv[2] - zc) / (r * 1.1) + 0.5))
            return lib.lerp_col(low, high, t * t)

        mb_leaf.add(v, f, shade)
    if not crown:
        return h + R
    # smaller puffs over the crown's top and flanks break up the round silhouette (their own RNG, so
    # the scatter sequence and every placement after this tree stay as they were)
    r2 = random.Random(int(bx * 7.0 + by * 13.0))
    for _ in range(r2.randint(4, 6)):
        a, el = r2.uniform(0, math.tau), r2.uniform(0.3, 1.0)
        r = R * r2.uniform(0.3, 0.42)
        q = (cx + math.cos(a) * math.cos(el) * R * 0.78 * spread, cy + math.sin(a) * math.cos(el) * R * 0.66 * spread, cz + 0.1 * R + math.sin(el) * R * 0.66 * sq / 0.9)
        v, f = lib.blob(q, r, squash=(1, 1, 0.88), rough=0.2, freq=2.2, subdiv=2, seed=r2.random() * 70)
        mb_leaf.add(v, f, lambda vv, zc=q[2], r=r: lib.lerp_col(low, high, max(0.0, min(1.0, (vv[2] - zc) / (r * 1.1) + 0.55)) ** 1.6))
    return h + R


BLOSSOM_PALS = [('#e06a98', '#ffc9df'), ('#c2447a', '#ff9cc4'), ('#d98fb0', '#ffe8f1'), ('#e07a86', '#ffd6cc')]


def tree_blossom(mb_flora, mb_wood, bx, by, rnd, s=1.0, pal=None):
    """Festival blossom tree: a slim dark trunk under a clumpy crown in one of four pinks (or the
    palette given) and one of four shapes (round, spreading umbrella, upright, low and full)."""
    rv = variant(bx, by, 3)
    var = rv.randrange(4)
    pal = pal or rv.choice(BLOSSOM_PALS)
    hk, spread, sq, lift = [(1.0, 1.0, 0.86, 1.0), (0.9, 1.32, 0.66, 0.95), (1.14, 0.84, 1.1, 1.08), (0.86, 1.12, 0.9, 0.9)][var]
    p = board_to_world(bx, by, 0.0)
    h = rnd.uniform(1.25, 1.6) * s * hk
    lean = (rnd.uniform(-0.1, 0.1), rnd.uniform(-0.06, 0.06))
    pts = [(p.x + lean[0] * t * h, p.y + lean[1] * t * h, t * h * 0.8) for t in np.linspace(0, 1, 8)]
    v, f = lib.tube(pts, lambda t: (0.09 - 0.04 * t) * s, 8)
    mb_wood.add(v, f, col('#5a3a30'))
    low, high = col(pal[0]), col(pal[1])
    cx, cy, cz = p.x + lean[0] * h, p.y + lean[1] * h, h * 0.86
    R = rnd.uniform(0.46, 0.58) * s
    puffs = [(0.0, 0.0, 0.0, 0.9)]
    for a in np.linspace(0, math.tau, 6, endpoint=False) + rnd.random():
        puffs.append((math.cos(a) * R * 0.62, math.sin(a) * R * 0.5, rnd.uniform(-0.15, 0.2) * R, rnd.uniform(0.48, 0.62)))
    for _ in range(4):
        a = rnd.uniform(0, math.tau)
        puffs.append((math.cos(a) * R * 0.35, math.sin(a) * R * 0.3, R * rnd.uniform(0.35, 0.55), rnd.uniform(0.36, 0.46)))
    for (ox, oy, oz, rr) in puffs:
        r = R * rr
        v, f = lib.blob((cx + ox * spread, cy + oy * spread, cz * lift + oz * sq / 0.86), r, squash=(1, 1, sq), rough=0.22, freq=2.3, subdiv=2, seed=rnd.random() * 70)
        mb_flora.add(v, f, lambda vv, zc=cz * lift + oz, r=r: lib.lerp_col(low, high, max(0.0, min(1.0, (vv[2] - zc) / (r * 1.1) + 0.55)) ** 1.3))
    return h + R


def tree_maple(mb_flora, mb_wood, bx, by, rnd, s=1.0):
    """Autumn-toned accent tree (amber to russet) so the woods are not all one green."""
    pal = rnd.choice([('#b8432a', '#ffb347'), ('#c65a1e', '#ffd166'), ('#a33a3a', '#ff8a4c')])
    return tree_round(mb_flora, mb_wood, bx, by, rnd, s * rnd.uniform(0.8, 0.95), palette=pal, crown=True)


def willow(mb_leaf, mb_wood, bx, by, rnd, s=1.0):
    """Weeping willow for pond sides: a stout trunk, a domed crown and curtains of hanging fronds
    (four builds and tints, picked by position)."""
    rv = variant(bx, by, 4)
    var = rv.randrange(4)
    hk, rk, fl = [(1.0, 1.0, 1.0), (1.12, 0.88, 1.25), (0.9, 1.14, 0.8), (1.05, 1.0, 1.1)][var]
    lo_hi = [('#4f8a38', '#c4e27a'), ('#5a8a4a', '#d6e89a'), ('#3f7a44', '#a8d67a'), ('#6a8f3a', '#e0e070')][rv.randrange(4)]
    p = board_to_world(bx, by, 0.0)
    h = rnd.uniform(1.3, 1.5) * s * hk
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.12 * s, 0.08 * s, h * 0.8, 10)
    mb_wood.add(v, f, col('#5e4630'))
    low, high = col(lo_hi[0]), col(lo_hi[1])
    cz = h * 0.95
    R = 0.62 * s * rk
    for (ox, oy, oz, rr) in [(0, 0, 0, 0.8), (0.3, 0.1, -0.05, 0.55), (-0.3, 0.05, -0.05, 0.55), (0.05, -0.28, -0.1, 0.5), (0.0, 0.25, 0.05, 0.5)]:
        r = R * rr
        v, f = lib.blob((p.x + ox * s, p.y + oy * s, cz + oz * s), r, squash=(1.1, 1.1, 0.62), rough=0.2, freq=2.0, subdiv=2, seed=rnd.random() * 30)
        mb_leaf.add(v, f, lambda vv, zc=cz + oz * s, r=r: lib.lerp_col(low, high, max(0.0, min(1.0, (vv[2] - zc) / (r * 0.8) + 0.5))))
    for k in range(46):
        a = k / 46 * math.tau + rnd.uniform(-0.06, 0.06)
        rr = R * rnd.uniform(0.7, 1.0)
        top = (p.x + math.cos(a) * rr * 0.9, p.y + math.sin(a) * rr * 0.9, cz - 0.04 * s)
        L = rnd.uniform(0.4, 0.75) * s * fl
        pts = [(top[0] + math.cos(a) * 0.07 * t * s, top[1] + math.sin(a) * 0.07 * t * s, top[2] - L * t) for t in np.linspace(0, 1, 6)]
        v, f = lib.tube(pts, lambda t: (0.05 - 0.03 * t) * s, 5)
        mb_leaf.add(v, f, lambda vv, z0=top[2], L=L: lib.lerp_col(high, low, max(0.0, min(1.0, (z0 - vv[2]) / L)) ** 0.8))
        for q in pts[1:5]:  # leaf tufts along each frond
            v, f = lib.blob((q[0], q[1], q[2]), 0.045 * s, squash=(1, 1, 1.5), rough=0.25, subdiv=1, seed=rnd.random() * 20)
            mb_leaf.add(v, f, lambda vv, z0=top[2], L=L: lib.lerp_col(high, low, max(0.0, min(1.0, (z0 - vv[2]) / L)) ** 0.8))
    return h + R


PINE_TINTS = [('#0f4f2e', '#3fa05a'), ('#123f3e', '#4f9a8a'), ('#1f5a26', '#7fb64a'), ('#0c4428', '#2f8a4a')]


def pine_tiers(mb_leaf, p, h, s, rv, lo_hi, base=0.62, tiers=4, gap=0.19, taper=0.12, tall=0.34, ragged=True):
    """Stacked cone tiers of a conifer; `ragged` turns each tier a little and gives it a jagged hem
    so no two trees match."""
    low, high = col(lo_hi[0]), col(lo_hi[1])
    for t in range(tiers):
        z0 = h * (0.22 + t * gap)
        r0 = (base - t * taper) * s * (rv.uniform(0.92, 1.08) if ragged else 1.0)
        hh = h * tall
        sides = 12
        rot = rv.uniform(0, math.tau) if ragged else 0.0
        drop = 0.03 * s if ragged else 0.0
        verts = [(p.x + math.cos(a + rot) * r0, p.y + math.sin(a + rot) * r0, z0 - (drop if k % 2 else 0.0))
                 for k, a in enumerate(np.linspace(0, math.tau, sides, endpoint=False))]
        verts = [(x + noise.noise(Vector((x * 3, y * 3, z0))) * 0.05, y, z) for (x, y, z) in verts]
        verts.append((p.x, p.y, z0 + hh))
        verts.append((p.x, p.y, z0 + 0.02))
        faces = [(k, (k + 1) % sides, sides) for k in range(sides)] + [((k + 1) % sides, k, sides + 1) for k in range(sides)]
        mb_leaf.add(verts, faces, lambda vv, z0=z0, hh=hh: lib.lerp_col(low, high, max(0.0, min(1.0, (vv[2] - z0) / hh))))


def tree_pine(mb_leaf, mb_wood, bx, by, rnd, s=1.0, varied=False):
    """Conifer. With `varied`, one of four builds (classic, slender spire, squat and full, broad and
    tall) and one of four needle tints, picked by position."""
    p = board_to_world(bx, by, 0.0)
    h = rnd.uniform(1.8, 2.5) * s
    rv = variant(bx, by, 2)
    var = rv.randrange(4) if varied else 0
    hk, base, tiers, gap, taper = [(1.0, 0.62, 4, 0.19, 0.12), (1.16, 0.48, 5, 0.15, 0.08), (0.84, 0.72, 3, 0.24, 0.17), (1.08, 0.66, 5, 0.155, 0.1)][var]
    h *= hk
    tv, tf = lib.cylinder((p.x, p.y, 0.0), 0.1 * s, 0.07 * s, h * 0.35, sides=8)
    mb_wood.add(tv, tf, col('#5e3b22'))
    pine_tiers(mb_leaf, p, h, s, rv, rv.choice(PINE_TINTS) if varied else PINE_TINTS[0], base, tiers, gap, taper, ragged=varied)
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


# ------------------------------------------------------------------------------------------
# Relic shrine paving (baked into the terrain so it lies under the space disc and the players)
SHRINE_R = 0.84  # platform radius (world units)


def shrine_platform(paving, metal, glow, crystals, bx, by, rnd):
    """A round mosaic platform behind a relic gate: radial rings of pale slabs over dark mortar, a
    gold inlay ring, a thin glowing crystal ring and a few crystal shards standing round its back
    half. Lies flush with the trail so the space disc and the players sit on top of it."""
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y
    R = SHRINE_R
    # mortar bed with a bevelled rim (a little proud of the ground)
    v, f = lib.lathe([(R + 0.03, 0.0), (R + 0.03, 0.012), (R + 0.01, 0.026), (0.0, 0.026)], 48, (x, y, 0.0), cap_bottom=False)
    paving.add(v, f, col('#a2927c'))
    # slabs: concentric rings split into sectors, each stone slightly different
    stones = ['#f3ebdd', '#e9dfcd', '#f7f0e4', '#e2d6c2', '#efe5d3']
    rings = [(0.0, 0.2, 1), (0.21, 0.42, 8), (0.43, 0.62, 13), (0.63, R, 18)]
    gap = 0.012
    for (r0, r1, n) in rings:
        off = rnd.uniform(0, math.tau)
        for k in range(n):
            a0 = off + k / n * math.tau + (gap / max(r1, 0.05) if n > 1 else 0.0)
            a1 = off + (k + 1) / n * math.tau - (gap / max(r1, 0.05) if n > 1 else 0.0)
            seg = max(2, int((a1 - a0) * r1 / 0.06))
            ra, rb = r0 + (gap if r0 > 0 else 0.0), r1 - gap
            z = 0.034 + rnd.uniform(-0.003, 0.003)
            verts, faces = [], []
            for j in range(seg + 1):
                a = a0 + (a1 - a0) * j / seg
                verts.append((x + math.cos(a) * ra, y + math.sin(a) * ra, z))
                verts.append((x + math.cos(a) * rb, y + math.sin(a) * rb, z))
            for j in range(seg):
                faces.append((2 * j, 2 * j + 2, 2 * j + 3, 2 * j + 1))
            paving.add(verts, faces, col(rnd.choice(stones)))
    # gold inlay ring between the outer rings, and a glowing crystal ring inside it
    for (ra, rb, mb, cc, z) in [(0.62, 0.65, metal, '#f2c14e', 0.04), (0.405, 0.425, glow, '#6fe6ff', 0.039)]:
        v, f = lib.lathe([(rb, z), (ra, z)], 64, (x, y, 0.0), cap_bottom=False, cap_top=False)
        mb.add(v, f, col(cc))
    # crystal shards round the back half (the front half is under the space disc)
    for (ang, hgt, cc) in [(math.radians(58), 0.34, '#5ce1ff'), (math.radians(122), 0.34, '#c49bff'),
                           (math.radians(18), 0.22, '#8ff0ff'), (math.radians(162), 0.22, '#8ff0ff')]:
        px_, py_ = x + math.cos(ang) * R * 0.86, y + math.sin(ang) * R * 0.86
        for j in range(3):
            tilt = (-math.sin(ang) * 0.25 + rnd.uniform(-0.12, 0.12), math.cos(ang) * 0.25 + rnd.uniform(-0.12, 0.12))
            hh = hgt * (1.0 if j == 0 else rnd.uniform(0.45, 0.65))
            v, f = lib.prism((px_ + rnd.uniform(-0.04, 0.04), py_ + rnd.uniform(-0.03, 0.03), 0.02), (0.05 if j == 0 else 0.032), hh,
                             tilt=tilt, twist=rnd.random())
            crystals.add(v, f, col(cc))
