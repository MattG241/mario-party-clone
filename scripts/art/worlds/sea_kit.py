"""Shared kit for the seaside world boards (Pirate Cove, Cartoon Coast): a floating slab of turquoise
sea holding sandy islands, rendered with the board projection of scripts/art/lib.py so the art lines up
pixel for pixel with the game's board coordinates.

Pieces: 2D fields and masks (numpy, 4 board px per cell), land as a heightfield (flat at z = 0 where
people walk, sloping beaches or rocky banks down into the water, raised cliffs and hills only where no
space or trail is), the sea slab (water top, rocky rim and underside, falls over the edge), the land and
water materials (painted zone maps sampled by position), beach and jungle scatter, and the render /
export steps (bands, crisp, tiles, landmark sprites, manifest, island shadow). A board script
(scripts/art/worlds/<id>/board.py) describes its islands, zones, landmarks and props and calls in here.
"""
from __future__ import annotations

import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # scripts/art: lib, terrain, props, festival
import lib  # noqa: E402
import terrain  # noqa: E402
from lib import COSB, PX, SINB, Vector, board_to_world, col  # noqa: E402

import bpy  # noqa: E402
from mathutils import noise  # noqa: E402

GRID = 4  # board px per mask cell
MESH_STEP = 5  # board px between heightfield vertices
WATER_Z = -0.3  # sea level (ground where people walk is z = 0)
TILE = 1024


# ------------------------------------------------------------------------------------------
# Board data and 2D fields
class Board:
    """A world board's graph plus the numpy canvas its masks live on."""

    def __init__(self, data_path: str):
        self.data = json.load(open(data_path))
        self.id = self.data['id']
        self.W, self.H = self.data['width'], self.data['height']
        terrain.set_canvas(self.W, self.H, GRID)
        self.nodes = {n['id']: n for n in self.data['nodes']}
        self.edges = self.data['edges']
        self.gw, self.gh = self.W // GRID, self.H // GRID
        yy, xx = np.mgrid[0:self.gh, 0:self.gw].astype(np.float32)
        self.xx, self.yy = xx * GRID + GRID / 2, yy * GRID + GRID / 2
        # render frame (board px): a margin round the canvas for rims and hanging rock
        self.frame = (-120, -60, self.W + 240, self.H + 200)
        pts = [(n['x'], n['y']) for n in self.nodes.values()]
        for e in self.edges:
            a, b = self.nodes[e['from']], self.nodes[e['to']]
            for t in np.linspace(0, 1, 9)[1:-1]:
                pts.append((a['x'] + (b['x'] - a['x']) * t, a['y'] + (b['y'] - a['y']) * t))
        self.path_pts = np.array(pts, np.float32)

    def node(self, i):
        return self.nodes[i]

    def zeros(self):
        return np.zeros((self.gh, self.gw), np.float32)

    # soft shapes (value 1 inside, falling to 0 over `soft` px at the edge), combined with max
    def disc(self, f, cx, cy, r, soft=10.0, v=1.0, sy=1.0):
        d = np.sqrt((self.xx - cx) ** 2 + ((self.yy - cy) / sy) ** 2)
        np.maximum(f, np.clip((r - d) / soft + 0.5, 0, 1) * v, out=f)

    def capsule(self, f, ax, ay, bx, by, r, soft=10.0, v=1.0):
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy or 1.0
        t = np.clip(((self.xx - ax) * vx + (self.yy - ay) * vy) / L2, 0, 1)
        d = np.sqrt((self.xx - ax - t * vx) ** 2 + (self.yy - ay - t * vy) ** 2)
        np.maximum(f, np.clip((r - d) / soft + 0.5, 0, 1) * v, out=f)

    def polygon(self, f, pts, v=1.0, blur=0.0):
        img = Image.new('L', (self.gw, self.gh), 0)
        ImageDraw.Draw(img).polygon([(x / GRID, y / GRID) for x, y in pts], fill=int(255 * v))
        if blur:
            img = img.filter(ImageFilter.GaussianBlur(blur / GRID))
        np.maximum(f, np.asarray(img, np.float32) / 255.0, out=f)

    def blob_chain(self, f, ids, r, soft=10.0):
        """Discs round a run of spaces joined by capsules along the run."""
        for i in ids:
            n = self.nodes[i]
            self.disc(f, n['x'], n['y'], r, soft)
        for a, b in zip(ids, ids[1:]):
            A, B = self.nodes[a], self.nodes[b]
            self.capsule(f, A['x'], A['y'], B['x'], B['y'], r * 0.86, soft)

    def wobble(self, f, amp=0.25, scale=180.0, seed=1.0):
        """Break up round outlines: add low-frequency noise near the 0.5 level."""
        n = np.zeros_like(f)
        xs, ys = self.xx / scale, self.yy / scale
        # a cheap value noise: sum of a few sines (no per-cell Python loop)
        for k, (fx, fy, ph) in enumerate([(1.0, 1.3, 0.3), (2.1, 1.7, 1.1), (3.7, 4.1, 2.3), (6.3, 5.9, 0.7)]):
            n += np.sin(xs * fx + seed * (k + 1) + ph) * np.cos(ys * fy - seed * 0.7 * (k + 1)) / (k + 1)
        return f + amp * n * (1 - np.abs(f - 0.5) * 2).clip(0, 1)

    @staticmethod
    def smooth(f, px):
        return ndimage.gaussian_filter(f, px / GRID)

    def sdf(self, mask):
        """Signed distance to the mask edge in board px (positive inside)."""
        inside = ndimage.distance_transform_edt(mask) * GRID
        outside = ndimage.distance_transform_edt(~mask) * GRID
        return (inside - outside).astype(np.float32)

    def at(self, arr, bx, by):
        gx = min(max(int(bx / GRID), 0), arr.shape[1] - 1)
        gy = min(max(int(by / GRID), 0), arr.shape[0] - 1)
        return float(arr[gy, gx])

    def near_path(self, bx, by, r):
        d = (self.path_pts[:, 0] - bx) ** 2 + (self.path_pts[:, 1] - by) ** 2
        return bool((d < r * r).any())

    def near_node(self, bx, by, r):
        return any((bx - n['x']) ** 2 + (by - n['y']) ** 2 < r * r for n in self.nodes.values())

    def canopy_clear(self, bx, by, width, height):
        """No space or trail in the screen area a tall object at (bx, by) covers."""
        p = self.path_pts
        m = (np.abs(p[:, 0] - bx) < width) & (p[:, 1] < by + 24) & (p[:, 1] > by - height)
        return not m.any()

    def path_field(self, width=84.0, styles=('path',), node_r=74.0):
        """Trail field (0..1): capsules along the given edge styles and ovals round every space."""
        f = self.zeros()
        for e in self.edges:
            if e['style'] not in styles:
                continue
            a, b = self.nodes[e['from']], self.nodes[e['to']]
            self.capsule(f, a['x'], a['y'], b['x'], b['y'], width / 2, soft=6)
        for n in self.nodes.values():
            self.disc(f, n['x'], n['y'], node_r, soft=6, sy=0.8)
        return self.smooth(f, 3)


def save_map(path, channels, size=None):
    """Write up to three 0..1 fields (at GRID resolution) as an RGB PNG, optionally resized (w, h)."""
    h, w = channels[0].shape
    rgb = np.zeros((h, w, 3), np.uint8)
    for i, c in enumerate(channels[:3]):
        rgb[..., i] = np.clip(c * 255 + 0.5, 0, 255).astype(np.uint8)
    im = Image.fromarray(rgb, 'RGB')
    if size:
        im = im.resize(size, Image.BILINEAR)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    return path


# ------------------------------------------------------------------------------------------
# Scene
def setup_scene(samples: int, sun_elev=50.0, sun_az=-35.0, sky=0.84, sun_energy=3.6, warm='#fff0d8'):
    sc = lib.reset(samples)
    # The machine is shared: two threads, short light paths (a bright sky fill and one sun), and
    # a narrow pixel filter so the board stays as crisp as the character sprites drawn over it.
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 2
    cy = sc.cycles
    cy.max_bounces = 4
    cy.diffuse_bounces = 2
    cy.glossy_bounces = 2
    cy.transmission_bounces = 3
    cy.transparent_max_bounces = 4
    cy.adaptive_threshold = 0.04
    cy.pixel_filter_width = 1.0
    import props
    props.use_board_look()
    lib.world_light(sky, zenith='#9fd4ff', horizon='#fff0d6', ground='#c8b89a')
    lib.sun(energy=sun_energy, elevation=sun_elev, azimuth=sun_az, angle=3.5, color=warm)
    return sc


def uv_image(m, path, board, colorspace='Non-Color', interp='Cubic'):
    """Image texture sampled by world position -> board uv (the board canvas maps to 0..1)."""
    mp = m.node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (PX / board.W, COSB * PX / board.H, 1.0)
    mp.inputs['Location'].default_value = (0.0, 1.0, 0.0)
    m.link(m.position(), mp.inputs['Vector'])
    img = m.node('ShaderNodeTexImage')
    img.image = bpy.data.images.load(path, check_existing=True)
    img.image.colorspace_settings.name = colorspace
    img.extension = 'EXTEND'
    img.interpolation = interp
    m.link(mp.outputs['Vector'], img.inputs['Vector'])
    return img.outputs['Color']


# ------------------------------------------------------------------------------------------
# Materials
def land_material(board, zones_path, extra_path, pal, special=None, name='land'):
    """Island ground. zones: R sand, G rock ground, B paving; extra: R trail, G lush grass, B special
    (a board callback paints it, e.g. Cartoon Coast's checkered lawn). Beaches follow the height
    (sand on the slope, wet sand at the waterline) and steep banks turn to rock."""
    m = lib.NT(name)
    pos = m.position()
    nz = m.sep(m.normal())[2]
    X, Y, Z = m.sep(pos)
    zr, zg, zb = m.sep(uv_image(m, zones_path, board))
    er, eg, eb = m.sep(uv_image(m, extra_path, board))
    # grass: broad ramp, lush variant, fine clumps and flowers (never on trails)
    n1 = m.noise(0.9, 5, 0.6, pos)
    n2 = m.noise(6.0, 3, 0.5, pos)
    gfac = m.math('ADD', m.math('MULTIPLY', n1.outputs['Fac'], 0.8), m.math('MULTIPLY', n2.outputs['Fac'], 0.35))
    grass = m.ramp(gfac, pal['grass'])
    lush = m.ramp(gfac, pal.get('lush', pal['grass']))
    grass = m.mix(m.maprange(eg, 0.2, 0.8), grass, lush)
    grass = terrain.grass_detail(m, pos, grass, flowers=pal.get('flowers', 0.8), keep_off=m.maprange(er, 0.12, 0.0))
    if special is not None:
        grass = special(m, pos, grass, eb)
    # sand: warm ramp, fine speckle, faint wind ripples
    sn = m.noise(3.0, 4, 0.6, pos)
    sand = m.ramp(sn.outputs['Fac'], pal['sand'])
    sp = m.noise(55.0, 2, 0.5, pos)
    sand = m.mult(sand, m.mix(m.maprange(sp.outputs['Fac'], 0.35, 0.7), lib.col('#ffffff'), lib.col('#e4d2b0')))
    rip = m.node('ShaderNodeTexWave')
    rip.wave_type = 'BANDS'
    rip.inputs['Scale'].default_value = 9.0
    rip.inputs['Distortion'].default_value = 5.0
    rip.inputs['Detail'].default_value = 2.0
    m.link(pos, rip.inputs['Vector'])
    sand = m.mix(m.math('MULTIPLY', m.maprange(rip.outputs['Fac'], 0.75, 0.95), 0.18), sand, lib.col('#fff6de'))
    # rock ground and cliffs: strata bands, cracks
    wave = m.node('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 1.6
    wave.inputs['Distortion'].default_value = 5.0
    wave.inputs['Detail'].default_value = 3.0
    m.link(pos, wave.inputs['Vector'])
    rn = m.noise(1.8, 6, 0.6, pos)
    rf = m.math('ADD', m.math('MULTIPLY', wave.outputs['Fac'], 0.5), m.math('MULTIPLY', rn.outputs['Fac'], 0.5))
    rock = m.ramp(rf, pal['rock'])
    rv = m.voronoi(6.0, pos, feature='DISTANCE_TO_EDGE')
    rock = m.mult(rock, m.mix(m.maprange(rv.outputs['Distance'], 0.05, 0.0), lib.col('#ffffff'), lib.col('#6a5a58')))
    # paving: rounded cobbles over pale mortar
    pv = m.voronoi(14.0, pos)
    pr, pg, _ = m.sep(pv.outputs['Color'])
    stone = m.ramp(pr, pal.get('paving', [(0.0, '#d8cbb3'), (1.0, '#efe4cf')]))
    joint = m.maprange(m.voronoi(14.0, pos, feature='DISTANCE_TO_EDGE').outputs['Distance'], 0.02, 0.06)
    paving = m.mix(joint, lib.col(pal.get('mortar', '#9c8c78')), stone)
    # trail: packed sand with pebbles and a pale edge
    tn = m.noise(2.2, 4, 0.6, pos)
    trail = m.ramp(tn.outputs['Fac'], pal['trail'])
    peb = m.voronoi(18.0, pos)
    trail = m.mix(m.math('MULTIPLY', m.maprange(peb.outputs['Distance'], 0.05, 0.16, 1.0, 0.0), 0.4), trail, lib.col('#fff1d0'))
    # compose the top
    top = grass
    fringe = m.math('MULTIPLY', m.maprange(er, 0.1, 0.3), m.maprange(er, 0.6, 0.35))
    top = m.mix(m.math('MULTIPLY', fringe, 0.6), top, lib.col(pal.get('fringe', '#efe0b0')))
    top = m.mix(m.maprange(er, 0.3, 0.65), top, trail)
    beach = m.math('MAXIMUM', m.maprange(zr, 0.35, 0.65), m.maprange(Z, -0.004, -0.03))
    top = m.mix(beach, top, sand)
    top = m.mix(m.maprange(zb, 0.35, 0.65), top, paving)
    top = m.mix(m.maprange(zg, 0.35, 0.65), top, rock)
    # wet sand darkens towards the waterline, steep banks turn to rock
    wet = m.maprange(Z, WATER_Z + 0.12, WATER_Z + 0.01)
    top = m.mult(top, m.mix(m.math('MULTIPLY', wet, 0.6), lib.col('#ffffff'), lib.col('#b89a74')))
    steep = m.maprange(nz, 0.8, 0.55)
    top = m.mix(steep, top, rock)
    top = terrain.contact_ao(m, top, tint=pal.get('ao', '#6b6247'))
    bump = m.bump(m.math('ADD', rn.outputs['Fac'], m.math('MULTIPLY', gfac, 0.25)), 0.3, 0.06)
    m.bsdf(top, 0.8, normal=bump, sheen=0.2)
    return m.mat


def water_material(board, sea_path, pal=None, name='sea'):
    """The sea: foam at the shore, bright turquoise shallows fading to deep blue with distance from
    land (sea map R; G paints extra shallows, B extra foam), sparse wave crests and a glossy coat."""
    pal = pal or {}
    m = lib.NT(name)
    pos = m.position()
    sr, sg, sb = m.sep(uv_image(m, sea_path, board, interp='Linear'))
    wobble = m.noise(3.2, 3, 0.6, pos)
    depth = m.math('ADD', sr, m.math('MULTIPLY', m.math('SUBTRACT', wobble.outputs['Fac'], 0.5), 0.05))
    depth = m.math('MAXIMUM', 0.0, m.math('SUBTRACT', depth, m.math('MULTIPLY', sg, 0.35)))
    c = m.ramp(depth, pal.get('ramp', [(0.0, '#8ff5e4'), (0.05, '#4fe0d2'), (0.18, '#2ec8d6'), (0.45, '#20a6d8'), (1.0, '#1878c0')]))
    # mottled depth and caustic-like glints in the shallows
    mot = m.noise(1.3, 3, 0.5, pos)
    c = m.mult(c, m.mix(m.maprange(mot.outputs['Fac'], 0.35, 0.65), lib.col('#ffffff'), lib.col('#d0ecf2')))
    cv = m.voronoi(9.0, pos, feature='DISTANCE_TO_EDGE')
    caust = m.math('MULTIPLY', m.maprange(cv.outputs['Distance'], 0.05, 0.0), m.maprange(depth, 0.25, 0.02))
    c = m.mix(m.math('MULTIPLY', caust, 0.35), c, lib.col('#e8fffb'))
    # wave crests: thin pale bands broken up by noise, more out in open water
    wv = m.node('ShaderNodeTexWave')
    wv.wave_type = 'BANDS'
    wv.bands_direction = 'X'
    wv.inputs['Scale'].default_value = 3.2
    wv.inputs['Distortion'].default_value = 7.0
    wv.inputs['Detail'].default_value = 2.0
    stretch = m.node('ShaderNodeVectorMath', operation='MULTIPLY')
    m.link(pos, stretch.inputs[0])
    stretch.inputs[1].default_value = (0.8, 2.4, 1.0)
    m.link(stretch.outputs['Vector'], wv.inputs['Vector'])
    crest = m.math('MULTIPLY', m.maprange(wv.outputs['Fac'], 0.9, 0.99), m.maprange(m.noise(1.9, 2, 0.5, pos).outputs['Fac'], 0.5, 0.66))
    crest = m.math('MULTIPLY', crest, m.maprange(depth, 0.08, 0.3))
    c = m.mix(m.math('MULTIPLY', crest, 0.55), c, lib.col('#dff8ff'))
    # foam: a lacy white band hugging every shore (and wherever the sea map paints it)
    fn = m.noise(14.0, 3, 0.6, pos)
    lace = m.maprange(fn.outputs['Fac'], 0.35, 0.6)
    foam = m.math('MAXIMUM', m.maprange(sr, 0.018, 0.004), m.math('MULTIPLY', m.maprange(sr, 0.05, 0.02), lace))
    foam = m.math('MAXIMUM', foam, sb)
    c = m.mix(m.math('MULTIPLY', foam, 0.92), c, lib.col('#fbffff'))
    b = m.bsdf(c, 0.07, emission=c, emission_strength=0.16, coat=1.0)
    b.inputs['Coat Roughness'].default_value = 0.08
    return m.mat


def pond_material(name='pond', deep='#1f9fcf', shallow='#63dfe0'):
    """Calm inland water (a lagoon pool): clear turquoise with a soft mottle, fine ripples and a
    glossy coat."""
    m = lib.NT(name)
    pos = m.position()
    nz = m.noise(1.6, 3, 0.5, pos)
    c = m.mix(m.maprange(nz.outputs['Fac'], 0.35, 0.65), lib.col(deep), lib.col(shallow))
    wv = m.node('ShaderNodeTexWave')
    wv.wave_type = 'RINGS'
    wv.inputs['Scale'].default_value = 6.0
    wv.inputs['Distortion'].default_value = 3.0
    m.link(pos, wv.inputs['Vector'])
    ripple = m.math('MULTIPLY', m.maprange(wv.outputs['Fac'], 0.88, 0.98), m.maprange(m.noise(2.4, 2, 0.5, pos).outputs['Fac'], 0.5, 0.64))
    c = m.mix(m.math('MULTIPLY', ripple, 0.45), c, lib.col('#dffcff'))
    b = m.bsdf(c, 0.06, emission=c, emission_strength=0.14, coat=1.0)
    b.inputs['Coat Roughness'].default_value = 0.06
    return m.mat


def rock_material(name='slab_rock', pal=None):
    """The sea slab's rim and underside: warm sandstone strata cooling and darkening with depth."""
    pal = pal or [(0.25, '#6e4c3e'), (0.42, '#8f6248'), (0.58, '#b0805a'), (0.72, '#86677a'), (0.86, '#a08e9e')]
    m = lib.NT(name)
    pos = m.position()
    X, Y, Z = m.sep(pos)
    wave = m.node('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 1.3
    wave.inputs['Distortion'].default_value = 6.0
    wave.inputs['Detail'].default_value = 3.0
    m.link(pos, wave.inputs['Vector'])
    rn = m.noise(1.8, 6, 0.6, pos)
    rf = m.math('ADD', m.math('MULTIPLY', wave.outputs['Fac'], 0.55), m.math('MULTIPLY', rn.outputs['Fac'], 0.5))
    rock = m.ramp(rf, pal)
    rv = m.voronoi(5.0, pos, feature='DISTANCE_TO_EDGE')
    rock = m.mult(rock, m.mix(m.maprange(rv.outputs['Distance'], 0.05, 0.0), lib.col('#ffffff'), lib.col('#5e4a4a')))
    # a mossy, wet band just under the lip
    moss = m.maprange(Z, WATER_Z - 0.5, WATER_Z - 0.05)
    rock = m.mix(m.math('MULTIPLY', moss, m.maprange(rn.outputs['Fac'], 0.4, 0.6)), rock, lib.col('#4f8a4a'))
    depth = m.maprange(Z, -6.0, -0.6, 0.0, 1.0, smooth=False)
    rock = m.mult(rock, m.mix(depth, lib.col('#645a86'), lib.col('#ffffff')))
    rock = m.mult(rock, m.mix(terrain.cam_ao(m, 0.8, 4), lib.col('#3a3048'), lib.col('#ffffff')))
    m.bsdf(rock, 0.85, normal=m.bump(m.math('ADD', rn.outputs['Fac'], m.math('MULTIPLY', m.maprange(rv.outputs['Distance'], 0.06, 0.0), -0.6)), 0.4, 0.08))
    return m.mat


def wood_deck_material(name='deck'):
    """Planked decking (vertex colour x plank seams along X)."""
    m = lib.NT(name)
    pos = m.position()
    c = m.attr('col')
    br = m.node('ShaderNodeTexBrick')
    br.inputs['Scale'].default_value = 6.0
    br.inputs['Mortar Size'].default_value = 0.012
    br.inputs['Color1'].default_value = col('#ffffff')
    br.inputs['Color2'].default_value = col('#e6d6c4')
    br.inputs['Mortar'].default_value = col('#5a3a24')
    br.inputs['Brick Width'].default_value = 1.6
    br.inputs['Row Height'].default_value = 0.14
    m.link(pos, br.inputs['Vector'])
    c = m.mult(c, br.outputs['Color'])
    n = m.noise(12.0, 3, 0.6, pos)
    c = m.mult(c, m.mix(m.maprange(n.outputs['Fac'], 0.3, 0.7), lib.col('#ffffff'), lib.col('#d8c4ae')))
    c = m.mult(c, m.mix(terrain.cam_ao(m, 0.35, 4), lib.col('#5a4a50'), lib.col('#ffffff')))
    m.bsdf(c, 0.7, normal=m.bump(br.outputs['Fac'], 0.3, 0.02))
    return m.mat


# ------------------------------------------------------------------------------------------
# Geometry: the land heightfield and the sea slab
def heightfield(board, z_fn, valid, name, material, step=MESH_STEP):
    """A grid mesh over the canvas: vertex heights from z_fn(bx, by arrays) where `valid` (a GRID
    mask) holds. Faces only where all four corners are valid."""
    xs = np.arange(0, board.W + 1, step, dtype=np.float32)
    ys = np.arange(0, board.H + 1, step, dtype=np.float32)
    BX, BY = np.meshgrid(xs, ys)
    gx = np.clip((BX / GRID).astype(int), 0, board.gw - 1)
    gy = np.clip((BY / GRID).astype(int), 0, board.gh - 1)
    ok = valid[gy, gx]
    Z = z_fn(BX, BY).astype(np.float32)
    idx = -np.ones(ok.shape, np.int64)
    idx[ok] = np.arange(int(ok.sum()))
    wx = BX[ok] / PX
    wy = -BY[ok] / (PX * COSB)
    verts = np.stack([wx, wy, Z[ok]], 1)
    a, b, c, d = idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]
    good = (a >= 0) & (b >= 0) & (c >= 0) & (d >= 0)
    # quads wound counter-clockwise seen from above (board y runs down = world -y)
    faces = np.stack([a[good], d[good], c[good], b[good]], 1)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.reshape(-1))
    me.loops.add(len(faces) * 4)
    me.loops.foreach_set('vertex_index', faces.reshape(-1).astype(np.int32))
    me.polygons.add(len(faces))
    me.polygons.foreach_set('loop_start', np.arange(0, len(faces) * 4, 4, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(len(faces), 4, np.int32))
    me.update(calc_edges=True)
    me.validate()
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    lib.link(ob)
    me.materials.append(material)
    return ob


def sample(arr, BX, BY):
    """Bilinear sample of a GRID field at board px arrays."""
    fx = np.clip(BX / GRID - 0.5, 0, arr.shape[1] - 1.001)
    fy = np.clip(BY / GRID - 0.5, 0, arr.shape[0] - 1.001)
    x0, y0 = fx.astype(int), fy.astype(int)
    tx, ty = fx - x0, fy - y0
    a = arr[y0, x0] * (1 - tx) + arr[y0, x0 + 1] * tx
    b = arr[y0 + 1, x0] * (1 - tx) + arr[y0 + 1, x0 + 1] * tx
    return a * (1 - ty) + b * ty


def smoothstep(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def land_heights(board, sd, bank, raise_z=None, beach_w=58.0, bank_w=12.0):
    """z(bx, by) for the land: flat at 0 inland, a beach (or a rocky bank where `bank` ~ 1) down to
    the sea, continuing under water; plus raised terrain (cliffs, hills) from `raise_z`."""
    def z_fn(BX, BY):
        d = sample(sd, BX, BY)
        k = sample(bank, BX, BY)
        w = beach_w + (bank_w - beach_w) * k
        # 0 inland, WATER_Z at the edge (d = 0), deeper outside
        t = smoothstep(d / w)
        z = WATER_Z * (1 - t)
        z = np.where(d < 0, WATER_Z + d * (0.012 + 0.02 * k), z)
        z = np.maximum(z, WATER_Z - 0.9)
        if raise_z is not None:
            z = z + sample(raise_z, BX, BY)
        return z
    return z_fn


def slab(board, mask, rock_mat, water_mat, name='sea_slab', cliff=235.0):
    """The floating sea: a flat water top at WATER_Z inside `mask`, a low rocky lip round it and a
    rock mass underneath that drops steeply at the rim (the visible cliff is about `cliff` px)."""
    from scipy.spatial import Delaunay  # noqa: F401  (triangle needs scipy present)
    import triangle as tr
    dist = ndimage.distance_transform_edt(mask) * GRID
    dist = ndimage.gaussian_filter(dist, 1.2)
    outline = terrain.level_contour(dist, 2.0)
    per = float(np.sum(np.linalg.norm(np.diff(np.vstack([outline, outline[:1]]), axis=0), axis=1)))
    N = max(80, int(per / 16))
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
    T = tr.triangulate({'vertices': ring, 'segments': seg}, 'pq28a3600')
    pts2 = T['vertices']
    tris = [tuple(int(i) for i in t) for t in T['triangles']]
    lip_z = WATER_Z + 0.08
    verts, faces, mats = [], [], []
    # water top
    for (bx, by) in pts2:
        verts.append(tuple(board_to_world(bx, by, WATER_Z)))
    faces += terrain.orient(tris, verts, lambda c: Vector((0, 0, 1)))
    mats += [1] * len(tris)
    # lip: a low stone kerb just outside the water edge
    base = len(verts)
    for k in range(N):
        bx, by = ring[k] + nrm[k] * 3
        verts.append(tuple(board_to_world(bx, by, lip_z)))
    for k in range(N):
        bx, by = ring[k] + nrm[k] * 16
        verts.append(tuple(board_to_world(bx, by, lip_z - 0.04)))
    for k in range(N):
        bx, by = ring[k] + nrm[k] * 22
        verts.append(tuple(board_to_world(bx, by, WATER_Z - 0.5)))
    # underside: steep near the rim, then deepening gently towards the middle
    und = len(verts)
    for i, (bx, by) in enumerate(pts2):
        d = terrain.dist_at(dist, bx, by) if i >= N else 0.0
        w = board_to_world(bx, by, 0.0)
        q = Vector((w.x * 0.7, w.y * 0.7, 0.0))
        depth = 0.6 + (cliff / (PX * SINB)) * min(1.0, d / 220.0) ** 0.9 + max(0.0, d - 220.0) / 380.0
        depth *= 1.0 + 0.22 * noise.noise(q) + 0.1 * noise.noise(q * 3.1 + Vector((2, 5, 1)))
        verts.append((w.x, w.y, WATER_Z - 0.5 - depth))
    faces += terrain.orient([tuple(und + i for i in t) for t in tris], verts, lambda c: Vector((0, 0, -1)))
    mats += [0] * len(tris)
    wc = board_to_world(*ring.mean(0), 0.0)
    band = []
    for k in range(N):
        k2 = (k + 1) % N
        # water edge up to the kerb top, kerb top out, kerb face down, then down to the underside ring
        band.append((k, k2, base + k2, base + k))
        band.append((base + k, base + k2, base + N + k2, base + N + k))
        band.append((base + N + k, base + N + k2, base + 2 * N + k2, base + 2 * N + k))
        band.append((base + 2 * N + k, base + 2 * N + k2, und + k2, und + k))
    faces += terrain.orient(band, verts, lambda c: Vector((c.x - wc.x, c.y - wc.y, 0.0)))
    mats += [0] * len(band)
    ob = lib.mesh_object(name, verts, faces, smooth=True)
    me = ob.data
    me.materials.append(rock_mat)
    me.materials.append(water_mat)
    me.polygons.foreach_set('material_index', np.array(mats, np.int32))
    for i in range(len(tris)):
        me.polygons[i].use_smooth = False
    vg = ob.vertex_groups.new(name='rock')
    vg.add(list(range(und, len(verts))), 1.0, 'REPLACE')
    vg.add(list(range(base + 2 * N, base + 3 * N)), 0.5, 'REPLACE')
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.subdivision_type = 'SIMPLE'
    sub.levels = 0
    sub.render_levels = 1
    tex = bpy.data.textures.new(name + '_rock', 'VORONOI')
    tex.noise_scale = 0.34
    disp = ob.modifiers.new('disp', 'DISPLACE')
    disp.texture = tex
    disp.texture_coords = 'GLOBAL'
    disp.strength = 0.3
    disp.mid_level = 0.5
    disp.vertex_group = 'rock'
    return ob, ring, nrm


def rim_falls(board, ring, nrm, picks, water_mb, rnd, width=0.9, drop=3.6):
    """Water spilling over the slab rim at ring indices `picks`: a curtain arcing out from the lip and
    falling away, foam along the lip and spray puffs lower down (the falls material fades with depth)."""
    out = []
    N = len(ring)
    for k in picks:
        k %= N
        bx, by = ring[k]
        nx, ny = nrm[k]
        w0 = board_to_world(bx + nx * 4, by + ny * 4, WATER_Z + 0.06)
        ox, oy = nx, -ny / COSB
        L = math.hypot(ox, oy) or 1.0
        ox, oy = ox / L, oy / L
        px, py = -oy, ox
        cols, rows = 10, 24
        verts, faces = [], []
        for j in range(rows + 1):
            t = j / rows
            reach = 0.08 + 0.5 * min(1.0, t * 3.0) ** 0.5
            z = WATER_Z + 0.06 - drop * t ** 1.2
            for i in range(cols + 1):
                uu = i / cols * 2 - 1
                u = uu * 0.5 * width * (1 + 0.3 * t)
                bulge = 0.08 * (1 - uu * uu)
                verts.append((w0.x + ox * (reach + bulge) + px * u, w0.y + oy * (reach + bulge) + py * u, z))
        for j in range(rows):
            for i in range(cols):
                a = j * (cols + 1) + i
                faces.append((a, a + 1, a + cols + 2, a + cols + 1))
        water_mb.add(verts, faces, (1, 1, 1, 1))
        for i in range(6):
            u = (i / 5 - 0.5) * width * 0.95
            v, f = lib.blob((w0.x + ox * 0.08 + px * u, w0.y + oy * 0.08 + py * u, WATER_Z + 0.07), 0.08, squash=(1.3, 1.0, 0.45), rough=0.3, subdiv=1, seed=i + k)
            water_mb.add(v, f, (1, 1, 1, 1))
        for i in range(6):
            u = rnd.uniform(-0.5, 0.5) * width * 1.3
            zz = WATER_Z - drop * rnd.uniform(0.6, 0.85)
            v, f = lib.blob((w0.x + ox * 0.55 + px * u, w0.y + oy * 0.55 + py * u, zz), rnd.uniform(0.18, 0.32), rough=0.25, subdiv=2, seed=rnd.random() * 9)
            water_mb.add(v, f, (1, 1, 1, 1))
        out.append((bx, by))
    return out


# ------------------------------------------------------------------------------------------
# Scatter
def palm(leaves, wood, fruit, bx, by, rnd, s=1.0, z0=0.0, lean=None):
    """A coconut palm: a curving ringed trunk, a crown of long drooping fronds and a coconut cluster.
    Returns its height in world units."""
    p = board_to_world(bx, by, z0)
    h = rnd.uniform(1.9, 2.5) * s
    la = lean if lean is not None else rnd.uniform(0, math.tau)
    lx, ly = math.cos(la), math.sin(la)
    bend = rnd.uniform(0.25, 0.5) * s
    pts = []
    for t in np.linspace(0, 1, 10):
        off = bend * t * t
        pts.append((p.x + lx * off, p.y + ly * off, z0 + t * h))
    v, f = lib.tube(pts, lambda t: (0.085 - 0.035 * t) * s, 9)
    wood.add(v, f, lambda vv: col('#8a6440') if int((vv[2] - z0) / (0.11 * s)) % 2 else col('#a57a4e'))
    top = Vector(pts[-1])
    pal = rnd.choice([('#2f7d2c', '#8fd14a'), ('#2a7334', '#7cc94e'), ('#3a8a2a', '#a4d85a')])
    low, high = col(pal[0]), col(pal[1])
    n = rnd.randint(8, 10)
    for k in range(n):
        a = k / n * math.tau + rnd.uniform(-0.2, 0.2)
        L = rnd.uniform(0.9, 1.25) * s
        droop = rnd.uniform(0.45, 0.8)
        segs = 7
        spine = []
        for j in range(segs + 1):
            t = j / segs
            r = L * t
            z = top.z + 0.08 * s + math.sin(t * math.pi * 0.62) * 0.3 * s - droop * L * t * t
            spine.append(Vector((top.x + math.cos(a) * r, top.y + math.sin(a) * r, z)))
        side = Vector((-math.sin(a), math.cos(a), 0.0))
        verts, faces = [], []
        for j, q in enumerate(spine):
            t = j / segs
            w = 0.2 * s * math.sin(math.pi * min(1.0, t * 1.1 + 0.06)) + 0.01
            dz = -0.05 * s * t
            verts += [tuple(q - side * w + Vector((0, 0, dz))), tuple(q), tuple(q + side * w + Vector((0, 0, dz)))]
        for j in range(segs):
            i = j * 3
            faces += [(i, i + 1, i + 4, i + 3), (i + 1, i + 2, i + 5, i + 4)]
        leaves.add(verts, faces, lambda vv, z0_=top.z, L=L: lib.lerp_col(low, high, max(0.0, min(1.0, (vv[2] - (z0_ - L * 0.6)) / (L * 0.9)))))
    for k in range(3):
        a = k / 3 * math.tau + rnd.random()
        v, f = lib.blob((top.x + math.cos(a) * 0.07 * s, top.y + math.sin(a) * 0.07 * s, top.z - 0.06 * s), 0.065 * s, rough=0.1, subdiv=1)
        fruit.add(v, f, col('#6b4a2a'))
    return h + 0.3 * s


def fruit_tree(leaves, wood, fruit, bx, by, rnd, s=1.0, fruit_col='#ff9a1f', pal=('#1f6b2a', '#58a83a')):
    """A round orchard tree (tangerines by default): short trunk, dense clumpy crown dotted with fruit."""
    p = board_to_world(bx, by, 0.0)
    h = rnd.uniform(0.75, 0.95) * s
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.08 * s, 0.06 * s, h, 8)
    wood.add(v, f, col('#6a4a30'))
    low, high = col(pal[0]), col(pal[1])
    R = rnd.uniform(0.5, 0.6) * s
    cz = h + R * 0.7
    puffs = [(0, 0, 0, 1.0)] + [(math.cos(a) * R * 0.5, math.sin(a) * R * 0.42, rnd.uniform(-0.1, 0.2) * R, rnd.uniform(0.6, 0.75))
                                for a in np.linspace(0, math.tau, 5, endpoint=False) + rnd.random()]
    for (ox, oy, oz, rr) in puffs:
        r = R * rr
        v, f = lib.blob((p.x + ox, p.y + oy, cz + oz), r, squash=(1, 1, 0.9), rough=0.16, freq=2.0, subdiv=2, seed=rnd.random() * 50)
        leaves.add(v, f, lambda vv, zc=cz + oz, r=r: lib.lerp_col(low, high, max(0.0, min(1.0, (vv[2] - zc) / (r * 1.1) + 0.5)) ** 1.3))
    fc = col(fruit_col)
    for _ in range(int(16 * s) + 6):
        a, el = rnd.uniform(0, math.tau), rnd.uniform(-0.2, 1.1)
        rr = R * rnd.uniform(0.92, 1.02)
        q = (p.x + math.cos(a) * math.cos(el) * rr, p.y + math.sin(a) * math.cos(el) * rr * 0.9, cz + math.sin(el) * rr * 0.85)
        v, f = lib.blob(q, 0.055 * s, rough=0.0, subdiv=1)
        fruit.add(v, f, fc)
    return h + R * 1.6


def shell(mb, bx, by, rnd, z=0.0):
    """A seashell or a starfish lying on the sand."""
    p = board_to_world(bx, by, z)
    if rnd.random() < 0.45:
        c = col(rnd.choice(['#ff8a5c', '#ffb36b', '#ff6f91', '#f4b83b']))
        rot = rnd.uniform(0, math.tau)
        for k in range(5):
            a = rot + k / 5 * math.tau
            v, f = lib.blob((0.05, 0.0, 0.0), 0.035, squash=(1.6, 0.7, 0.35), rough=0.0, subdiv=1)
            mb.add(lib.transform(v, loc=(p.x, p.y, z + 0.012), rot=(0.0, 0.0, a)), f, c)
        v, f = lib.blob((p.x, p.y, z + 0.015), 0.035, squash=(1, 1, 0.4), rough=0.0, subdiv=1)
        mb.add(v, f, c)
    else:
        c = col(rnd.choice(['#fff4e6', '#ffe0cc', '#f5d6ff', '#ffe9b0']))
        v, f = lib.blob((p.x, p.y, z + 0.02), 0.05, squash=(1.2, 1.0, 0.55), rough=0.15, subdiv=1, seed=rnd.random() * 9)
        mb.add(v, f, c)


def parasol(cloth, wood, bx, by, rnd, stripe=('#ff6b5e', '#fff4dc'), s=1.0, towel=True):
    """Beach parasol with a striped canopy (and a towel beside it)."""
    p = board_to_world(bx, by, 0.0)
    tilt = rnd.uniform(-0.18, 0.18)
    top = (p.x + tilt * 0.9 * s, p.y, 0.95 * s)
    v, f = lib.tube([(p.x, p.y, 0.0), top], 0.018 * s, 6)
    wood.add(v, f, col('#e9e2d4'))
    n = 12
    for k in range(n):
        a0, a1 = k / n * math.tau, (k + 1) / n * math.tau
        r = 0.48 * s
        verts = [top, (top[0] + math.cos(a0) * r, top[1] + math.sin(a0) * r, top[2] - 0.2 * s), (top[0] + math.cos(a1) * r, top[1] + math.sin(a1) * r, top[2] - 0.2 * s)]
        cloth.add(verts, [(0, 1, 2), (0, 2, 1)], col(stripe[k % 2]))
    if towel:
        ang = rnd.uniform(-0.4, 0.4)
        v, f = lib.box((p.x + 0.32 * s, p.y - 0.12 * s, 0.006), (0.46 * s, 0.24 * s, 0.01), rot_z=ang)
        cloth.add(v, f, col(rnd.choice(['#5ab0f0', '#ffd166', '#8bd346', '#ff8fb1'])))


def driftwood(mb, bx, by, rnd):
    p = board_to_world(bx, by, 0.0)
    a = rnd.uniform(0, math.pi)
    L = rnd.uniform(0.25, 0.45)
    pts = [(p.x - math.cos(a) * L / 2, p.y - math.sin(a) * L / 2, 0.03), (p.x + math.cos(a) * L / 2, p.y + math.sin(a) * L / 2, 0.03)]
    v, f = lib.tube(pts, 0.03, 6)
    mb.add(v, f, col(rnd.choice(['#b8a48c', '#a8927a', '#c4b299'])))


def coral(mb, bx, by, rnd, s=1.0, z=WATER_Z + 0.05):
    """A clump of branching coral poking out of the shallows."""
    p = board_to_world(bx, by, z)
    c = col(rnd.choice(['#ff7a6b', '#ff9ad0', '#ffb347', '#c49bff', '#ff5f8f']))
    for _ in range(rnd.randint(4, 7)):
        a = rnd.uniform(0, math.tau)
        L = rnd.uniform(0.12, 0.3) * s
        base = (p.x + rnd.uniform(-0.06, 0.06), p.y + rnd.uniform(-0.05, 0.05), z - 0.08)
        tip = (base[0] + math.cos(a) * L * 0.4, base[1] + math.sin(a) * L * 0.4, z + L)
        v, f = lib.tube([base, tip], lambda t: (0.035 - 0.02 * t) * s, 6)
        mb.add(v, f, c)
        v, f = lib.blob(tip, 0.03 * s, rough=0.0, subdiv=1)
        mb.add(v, f, c)


def buoy(paint, bx, by, s=1.0):
    """A red-and-white channel buoy bobbing at the water line."""
    p = board_to_world(bx, by, WATER_Z)
    prof = [(0.0, -0.1), (0.16 * s, -0.05), (0.17 * s, 0.1), (0.1 * s, 0.35 * s), (0.04 * s, 0.5 * s), (0.0, 0.52 * s)]
    v, f = lib.lathe(prof, 16, (p.x, p.y, WATER_Z))
    paint.add(v, f, lambda vv: col('#e8483b') if int((vv[2] - WATER_Z) / (0.12 * s)) % 2 == 0 else col('#fbf6ee'))
    v, f = lib.blob((p.x, p.y, WATER_Z + 0.56 * s), 0.05 * s, rough=0.0, subdiv=1)
    paint.add(v, f, col('#ffd23f'))


def floating_barrel(wood, bx, by, rnd):
    """A barrel lying on its side, half in the water."""
    p = board_to_world(bx, by, WATER_Z)
    r, h = 0.09, 0.26
    v, f = lib.lathe([(r * 0.85, 0.0), (r, h * 0.3), (r, h * 0.7), (r * 0.85, h), (0.0, h)], 14, (0, 0, -h / 2))
    v = lib.transform(v, loc=(p.x, p.y, WATER_Z + 0.03), rot=(math.pi / 2, 0.0, rnd.uniform(0, math.pi)))
    wood.add(v, f, col('#9a6436'))


# ------------------------------------------------------------------------------------------
# Trails over water: jetties, gangplanks, reef stones
def jetty(wood, a, b, rnd, width=0.34, z=0.0, rails=True, posts_to=None):
    """A plank walkway between two board points at height z (planks across the walk, posts down into
    the sea, a rope rail on the far side)."""
    A, B = board_to_world(*a, z), board_to_world(*b, z)
    d = B - A
    L = d.length
    if L < 1e-6:
        return
    d.normalize()
    yaw = math.atan2(d.y, d.x)
    side = Vector((-d.y, d.x, 0.0))
    n = max(2, int(L / 0.1))
    for k in range(n):
        c = A + d * ((k + 0.5) / n * L)
        v, f = lib.box((c.x, c.y, z - 0.02), (L / n * 0.84, width + rnd.uniform(-0.015, 0.015), 0.045), rot_z=yaw)
        wood.add(v, f, col(rnd.choice(['#b98a55', '#a87a48', '#c49660', '#b3834f', '#9e7044'])))
    m = max(1, int(L / 0.45))
    bottom = WATER_Z - 0.6 if posts_to is None else posts_to
    for k in range(m + 1):
        c = A + d * (k / m * L)
        for sgn in (-1, 1):
            q = c + side * (sgn * width * 0.5)
            v, f = lib.cylinder((q.x, q.y, bottom), 0.035, 0.035, z + 0.1 - bottom, 8)
            wood.add(v, f, col('#6e4a2c'))
    if rails:
        for sgn in (1,):
            ra, rb = A + side * (sgn * width * 0.5), B + side * (sgn * width * 0.5)
            pts = []
            for t in np.linspace(0, 1, 12):
                q = ra + (rb - ra) * t
                pts.append((q.x, q.y, z + 0.16 - math.sin(t * math.pi) * 0.04))
            v, f = lib.tube(pts, 0.012, 5)
            wood.add(v, f, col('#c9b08a'))


def ramp_plank(wood, a, b, za, zb, rnd, width=0.3):
    """A gangplank from a (at height za) to b (at zb), with cleats and rope hand-lines."""
    A, B = board_to_world(*a, za), board_to_world(*b, zb)
    d = B - A
    L = d.length
    flat = Vector((d.x, d.y, 0.0))
    flat.normalize()
    yaw = math.atan2(flat.y, flat.x)
    pitch = math.atan2(zb - za, math.hypot(d.x, d.y))
    side = Vector((-flat.y, flat.x, 0.0))
    v, f = lib.box((0, 0, 0), (L, width, 0.05))
    v = lib.transform(v, loc=tuple((A + B) / 2), rot=(0.0, -pitch, yaw))
    wood.add(v, f, col('#a87a48'))
    for k in range(1, int(L / 0.14)):
        c = A + d * (k * 0.14 / L)
        v, f = lib.box((0, 0, 0), (0.025, width * 0.9, 0.02))
        v = lib.transform(v, loc=(c.x, c.y, c.z + 0.035), rot=(0.0, -pitch, yaw))
        wood.add(v, f, col('#7a5234'))
    for sgn in (-1, 1):
        pa, pb = A + side * (sgn * width * 0.55), B + side * (sgn * width * 0.55)
        v, f = lib.tube([(pa.x, pa.y, pa.z + 0.3), (pb.x, pb.y, pb.z + 0.3)], 0.012, 5)
        wood.add(v, f, col('#d8c29a'))
        for q in (pa, pb):
            v, f = lib.cylinder((q.x, q.y, q.z - 0.02), 0.022, 0.02, 0.34, 6)
            wood.add(v, f, col('#6e4a2c'))


def reef_stone(rocks, sandtop, bx, by, rnd, r=0.34, top='#e9d6a8', z=0.0):
    """A flat-topped rock stepping stone standing out of the sea (its sandy top sits at z)."""
    p = board_to_world(bx, by, z)
    sides = 18
    ring = []
    for k in range(sides):
        a = k / sides * math.tau
        rr = r * (1 + noise.noise(Vector((math.cos(a) * 2 + bx * 0.1, math.sin(a) * 2, by * 0.01))) * 0.18)
        ring.append((p.x + math.cos(a) * rr, p.y + math.sin(a) * rr / COSB * 0.95))
    tv = [(x, y, z) for (x, y) in ring] + [(p.x, p.y, z)]
    tf = [(k, (k + 1) % sides, sides) for k in range(sides)]
    sandtop.add(tv, terrain.orient(tf, tv, lambda c: Vector((0, 0, 1))), col(top))
    verts, faces = [], []
    levels = [(1.0, z), (1.06, z - 0.08), (1.12, WATER_Z - 0.05), (1.2, WATER_Z - 0.6)]
    for (sc_, zz) in levels:
        for (x, y) in ring:
            verts.append((p.x + (x - p.x) * sc_, p.y + (y - p.y) * sc_, zz + rnd.uniform(-0.01, 0.01)))
    for li in range(len(levels) - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((li * sides + k, li * sides + k2, (li + 1) * sides + k2, (li + 1) * sides + k))
    rocks.add(verts, terrain.orient(faces, verts, lambda c: Vector((c.x - p.x, c.y - p.y, 0.0))), lambda vv: col('#9a8a7a') if vv[2] > WATER_Z else col('#6a7a70'))


# ------------------------------------------------------------------------------------------
# Rendering and export
def crisp(path, radius=1.1, amount=40, threshold=3):
    """A light unsharp mask on the colour of a finished render (the denoiser leaves texture soft);
    transparent pixels first take the nearest opaque colour so silhouettes get no bright rim."""
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


def render_bands(frame, scale, n, path, only=-1, overlap=24):
    """Render the terrain in n horizontal bands (each can be its own Blender run with --band i, so the
    shared machine gets turns in between), then stitch them."""
    fx, fy, fw, fh = frame
    rh = int(round(fh * scale))
    cuts = [round(rh * i / n) for i in range(n + 1)]
    for i in range(n):
        if only >= 0 and i != only:
            continue
        y0, y1 = max(0, cuts[i] - overlap), min(rh, cuts[i + 1] + overlap)
        band = os.path.join(os.path.dirname(path), f'band_{i}.png')
        lib.set_border((fx, fy + y0 / scale, fx + fw, fy + y1 / scale), frame)
        lib.render_to(band)
        print('band', i, 'done', flush=True)
    lib.clear_border()
    if only >= 0:
        return
    stitch_bands(frame, scale, n, path, overlap)


def stitch_bands(frame, scale, n, path, overlap=24):
    fx, fy, fw, fh = frame
    rh = int(round(fh * scale))
    cuts = [round(rh * i / n) for i in range(n + 1)]
    full = None
    for i in range(n):
        y0 = max(0, cuts[i] - overlap)
        im = Image.open(os.path.join(os.path.dirname(path), f'band_{i}.png')).convert('RGBA')
        if full is None:
            full = Image.new('RGBA', (im.width, rh), (0, 0, 0, 0))
        a, b = cuts[i], cuts[i + 1]
        full.paste(im.crop((0, a - y0, im.width, b - y0)), (0, a))
    full.save(path)


def export_tiles(path, board_id, origin, scale, quality=82):
    from tiles import export_tiles as _export
    return _export(path, board_id, origin, scale, quality=quality)


def island_shadow(terrain_png, board_id, offset=(150, 70), blur=34.0, down=6):
    """Soft shadow of the whole board on the cloud sea (blurred, offset silhouette) + manifest entry."""
    dest = os.path.join(lib.ROOT, 'public', 'assets', 'rendered', board_id)
    man_path = os.path.join(dest, 'manifest.json')
    man = json.load(open(man_path))
    scale = man['scale']
    ox, oy = man['origin']
    src = Image.open(terrain_png).getchannel('A')
    bw, bh = src.width / scale, src.height / scale
    pad = int(blur * 3)
    sw, sh = int((bw + pad * 2) / down), int((bh + pad * 2) / down)
    small = src.resize((int(bw / down), int(bh / down)), Image.BILINEAR)
    canvas = Image.new('L', (sw, sh), 0)
    canvas.paste(small, (pad // down, pad // down))
    canvas = canvas.filter(ImageFilter.GaussianBlur(blur / down))
    a = np.asarray(canvas, np.float32) / 255.0
    rgba = np.zeros((sh, sw, 4), np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 26, 38, 78
    rgba[..., 3] = np.clip(a * 190, 0, 255).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(dest, 'shadow.webp'), 'WEBP', quality=85, method=6)
    man['shadow'] = {'file': 'shadow.webp', 'x': ox - pad + offset[0], 'y': oy - pad + offset[1], 'w': sw * down, 'h': sh * down}
    with open(man_path, 'w') as fh:
        json.dump(man, fh, indent=1)
    print('wrote shadow', man['shadow'])


def render_props(board, built, terrain_objs, frame, scale, out_dir, only=()):
    """Render each landmark on its own (the land still bounces light onto it) into prop_<id>.webp
    and write the manifest's props. `built`: id -> (landmark dict, objects)."""
    fx, fy, fw, fh = frame
    sc = bpy.context.scene
    rx, ry = sc.render.resolution_x, sc.render.resolution_y
    for o in terrain_objs:
        o.visible_camera = False
        if not (o.name.startswith('land') or o.name.startswith('sea_slab')):
            o.hide_render = True
    all_objs = [o for _, obs in built.values() for o in obs]
    dest = os.path.join(lib.ROOT, 'public', 'assets', 'rendered', board.id)
    os.makedirs(dest, exist_ok=True)
    man_path = os.path.join(dest, 'manifest.json')
    old = {e['id']: e for e in json.load(open(man_path)).get('props', [])} if (only and os.path.exists(man_path)) else {}
    entries = []
    bpy.context.view_layer.update()  # some props were moved by location (the galleon's pedestal)
    dg = bpy.context.evaluated_depsgraph_get()
    for pid, (lm, obs) in built.items():
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
            co = np.empty(len(me.vertices) * 3, np.float32)
            me.vertices.foreach_get('co', co)
            co = co.reshape(-1, 3)
            mw = np.array(o.matrix_world)
            wco = co @ mw[:3, :3].T + mw[:3, 3]
            xs.append(wco[:, 0] * PX)
            ys.append(-(wco[:, 1] * COSB + wco[:, 2] * SINB) * PX)
            ev.to_mesh_clear()
        xs, ys = np.concatenate(xs), np.concatenate(ys)
        pad = 8
        px0 = max(0, math.floor((xs.min() - pad - fx) * scale))
        px1 = min(rx, math.ceil((xs.max() + pad - fx) * scale))
        py0 = max(0, math.floor((ys.min() - pad - fy) * scale))
        py1 = min(ry, math.ceil((ys.max() + pad - fy) * scale))
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
        # manifest_kind: how the game treats it (a 'lantern' gets a warm halo after dark)
        e = {'id': pid, 'file': name, 'tex': lm.get('tex', ''), 'kind': lm.get('manifest_kind', lm['kind']),
             'x': fx + px0 / scale, 'y': fy + py0 / scale, 'w': im.width / scale, 'h': im.height / scale,
             'baseY': lm['y'], 'anchorX': lm['x']}
        if lm.get('depth_y') is not None:
            e['depthY'] = lm['depth_y']
        entries.append(e)
        for o in obs:
            o.visible_camera = False
        print('prop', pid, im.size, flush=True)
    lib.clear_border()
    man = json.load(open(man_path)) if os.path.exists(man_path) else {'board': board.id}
    man['props'] = entries
    with open(man_path, 'w') as fh:
        json.dump(man, fh, indent=1)
    keep = {t['file'] for t in man.get('tiles', [])} | {e['file'] for e in entries} | {'manifest.json', 'shadow.webp'}
    for f in os.listdir(dest):
        if f.startswith('prop_') and f not in keep:
            os.remove(os.path.join(dest, f))
