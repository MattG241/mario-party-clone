"""City kit for the night boards (Hero Heights, Showtime Strip): rooftop blocks with lit window
facades, walkway decks between them, rooftop and street scatter, neon, lamps and the render/export
steps. Shared by scripts/art/worlds/heroes/board.py and scripts/art/worlds/showtime/board.py.

Built on the Suncoil pipeline (scripts/art/lib.py, terrain.py, props.py), which it imports and
never edits. Coordinates are board pixels unless a name says otherwise; lib.board_to_world maps a
board point on the ground plane (z = 0: every walkway) to Blender units.

Islands come from the board graph: each group of spaces joined by 'path' edges becomes one city
block whose outline is a union of oriented rectangles (so edges run straight, like buildings), cut
apart from its neighbours by a narrow alley of sky. Each block is a flat rooftop (or plaza) at z = 0
with a parapet, a band of lit windows down its camera-facing walls and a dark bedrock underside.
'steps' edges become decks (bridges, catwalks, web lines) across the gaps.
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
from skimage import measure

ART = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ART)
import lib  # noqa: E402
import terrain  # noqa: E402
from lib import COSB, PX, SINB, Vector, board_to_world, col  # noqa: E402
from terrain import cam_ao, dist_at, orient, resample  # noqa: E402

import bpy  # noqa: E402
from mathutils import noise  # noqa: E402

GRID = 4  # board px per mask cell
ROOT = lib.ROOT


def screen_z(px: float) -> float:
    """World height that appears `px` screen pixels tall."""
    return px / (PX * SINB)


def depth_units(px: float) -> float:
    """World depth (along Y) that appears `px` screen pixels deep on the ground."""
    return px / (PX * COSB)


# ------------------------------------------------------------------------------------------
# Materials
_MATS: dict = {}


def emission_off(mat):
    """Glowing surfaces glow, but are not sampled as lights (point lamps do the lighting): far less
    noise at the board's low sample count, and much faster."""
    try:
        mat.cycles.emission_sampling = 'NONE'
    except Exception:
        pass
    return mat


def mats() -> dict:
    """Vertex-coloured materials shared by scatter and landmarks."""
    if _MATS:
        return _MATS
    _MATS['paint'] = terrain.scatter_mat('c_paint', rough=0.6, ao=0.35, samples=4)
    _MATS['matte'] = terrain.scatter_mat('c_matte', rough=0.85, ao=0.35, samples=4)
    m = lib.NT('c_metal')
    b = m.bsdf(m.attr('col'), 0.32, coat=0.2)
    b.inputs['Metallic'].default_value = 1.0
    _MATS['metal'] = m.mat
    m = lib.NT('c_chrome')
    b = m.bsdf(m.attr('col'), 0.12, coat=0.6)
    b.inputs['Metallic'].default_value = 1.0
    _MATS['chrome'] = m.mat
    _MATS['wood'] = terrain.scatter_mat('c_wood', rough=0.75, ao=0.3)
    _MATS['leaf'] = terrain.leaf_material('c_leaf', ao=0.45, sun='#cfe39a', shade='#173f33', gaps='#6f8a78', ao_tint='#2b3f44')
    # neon tubes, lit windows, bulbs: bright, saturated, not sampled as lights
    m = lib.NT('c_neon')
    c = m.attr('col')
    m.bsdf(c, 0.3, emission=c, emission_strength=9.0)
    _MATS['neon'] = emission_off(m.mat)
    m = lib.NT('c_glow')
    c = m.attr('col')
    m.bsdf(c, 0.3, emission=c, emission_strength=3.2)
    _MATS['glow'] = emission_off(m.mat)
    m = lib.NT('c_softglow')
    c = m.attr('col')
    m.bsdf(c, 0.4, emission=c, emission_strength=1.3)
    _MATS['softglow'] = emission_off(m.mat)
    m = lib.NT('c_glass')
    c = m.attr('col')
    b = m.bsdf(c, 0.08, coat=0.9, spec=0.8)
    _MATS['glass'] = m.mat
    m = lib.NT('c_stone')
    pos = m.position()
    n = m.noise(7.0, 4, 0.6, pos)
    c = m.mult(m.attr('col'), m.mix(m.maprange(n.outputs['Fac'], 0.3, 0.7), col('#c9c0b8'), col('#ffffff')))
    c = m.mult(c, m.mix(cam_ao(m, 0.4, 4), col('#4b4458'), col('#ffffff')))
    m.bsdf(c, 0.85, normal=m.bump(n.outputs['Fac'], 0.25, 0.02))
    _MATS['stone'] = m.mat
    return _MATS


class Parts:
    """Per-material mesh builders for one object (scatter layer or landmark)."""

    KINDS = ('paint', 'matte', 'metal', 'chrome', 'wood', 'leaf', 'neon', 'glow', 'softglow', 'glass', 'stone')

    def __init__(self, name: str):
        self.name = name
        self.b = {k: lib.MeshBuilder() for k in self.KINDS}

    def __getitem__(self, k):
        return self.b[k]

    def build(self) -> list:
        obs = []
        for k, mb in self.b.items():
            ob = mb.build(f'{self.name}_{k}', mats()[k], smooth=k not in ('neon',))
            if ob is not None:
                obs.append(ob)
        return obs


# --- Surfaces ---------------------------------------------------------------------------------
def _mask_lookup(m, mask_path, W, H):
    """Board-space mask image sampled at the shading point (world -> board uv)."""
    pos = m.position()
    mp = m.node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (PX / W, COSB * PX / H, 1.0)
    mp.inputs['Location'].default_value = (0.0, 1.0, 0.0)
    m.link(pos, mp.inputs['Vector'])
    img = m.node('ShaderNodeTexImage')
    img.image = bpy.data.images.load(mask_path, check_existing=True)
    img.image.colorspace_settings.name = 'Non-Color'
    img.extension = 'EXTEND'
    img.interpolation = 'Cubic'
    m.link(mp.outputs['Vector'], img.inputs['Vector'])
    return m.sep(img.outputs['Color'])[0]


def _tiles(m, pos, scale, c1, c2, mortar, mortar_size=0.03, ratio=1.0):
    br = m.node('ShaderNodeTexBrick')
    br.inputs['Scale'].default_value = scale
    br.inputs['Mortar Size'].default_value = mortar_size
    br.inputs['Color1'].default_value = col(c1)
    br.inputs['Color2'].default_value = col(c2)
    br.inputs['Mortar'].default_value = col(mortar)
    br.inputs['Brick Width'].default_value = 0.5 * ratio
    br.inputs['Row Height'].default_value = 0.5
    br.offset = 0.5
    m.link(pos, br.inputs['Vector'])
    return br


# Rooftop / street looks: ground (away from the walkway) and walkway (the route). Colours are sRGB.
SURFACES = {
    # Hero Heights
    'roof': dict(ground=('#7e8292', '#9296a4'), walk=('#eee4d2', '#e2d6c2'), walk_mortar='#8e8577', walk_scale=6.0, edge='#454854'),
    'gothic': dict(ground=('#716c7c', '#837d8c'), walk=('#e2d6c4', '#d2c4b0'), walk_mortar='#6e6358', walk_scale=4.2, edge='#3c3842', cobble=True),
    'garden': dict(ground=('#4a8a42', '#66a64a'), walk=('#d6a672', '#c4955f'), walk_mortar='#6b4a2d', walk_scale=7.5, edge='#2f4f2c', grass=True, planks=True),
    'tech': dict(ground=('#aab5c6', '#c3ccda'), walk=('#eef2f7', '#dfe6ee'), walk_mortar='#8fa0b6', walk_scale=3.0, edge='#6f7d92', seams='#7fe3ff'),
    'block': dict(ground=('#736d76', '#847d86'), walk=('#eddcc4', '#e0cdb2'), walk_mortar='#8a6f58', walk_scale=6.5, edge='#403a42'),
    'plaza': dict(ground=('#a69aa6', '#b8acb6'), walk=('#f6ead4', '#ecdcc0'), walk_mortar='#9b8a74', walk_scale=5.0, edge='#5d5360'),
    'neonrow': dict(ground=('#57546a', '#63607a'), walk=('#efdfcc', '#e2d0b8'), walk_mortar='#85766a', walk_scale=6.0, edge='#2c2a36', puddles=True),
    # Showtime Strip
    'boulevard': dict(ground=('#5d5870', '#6a6480'), walk=('#fbeade', '#f0dccd'), walk_mortar='#a08578', walk_scale=5.0, edge='#6a4e6a', puddles=True, stars=True),
    'pastel': dict(ground=('#b9a2b5', '#c9b3c4'), walk=('#fbe3ea', '#f3d3de'), walk_mortar='#c49aa9', walk_scale=5.5, edge='#8c6f86'),
    'checker': dict(ground=('#625d72', '#6e6880'), walk=('#fbf6ec', '#2c2934'), walk_mortar='#8b8589', walk_scale=4.0, edge='#b3363f', checker=True),
    'western': dict(ground=('#b98f80', '#c99f8d'), walk=('#b9824f', '#a67244'), walk_mortar='#6a4526', walk_scale=7.0, edge='#7a4f3f', planks=True),
    'ice': dict(ground=('#dff3ff', '#eef9ff'), walk=('#f5fbff', '#e4f3fc'), walk_mortar='#b9d6e6', walk_scale=2.0, edge='#8fb9d6', ice=True),
    'marquee': dict(ground=('#7a3a58', '#8a4466'), walk=('#dc2f4a', '#c42843'), walk_mortar='#7a1428', walk_scale=3.0, edge='#f2c14e', carpet=True),
}


def surface_material(name: str, style: str, mask_path: str, W: int, H: int):
    """Rooftop / street surface: a textured ground with a pale, bordered walkway where the path mask is."""
    S = SURFACES[style]
    m = lib.NT(f'surf_{name}')
    pos = m.position()
    pv = _mask_lookup(m, mask_path, W, H)
    walk = m.maprange(pv, 0.3, 0.62)
    # ground
    n1 = m.noise(1.1, 4, 0.6, pos)
    ground = m.mix(m.maprange(n1.outputs['Fac'], 0.3, 0.7), col(S['ground'][0]), col(S['ground'][1]))
    speck = m.noise(38.0, 2, 0.6, pos)
    ground = m.mult(ground, m.mix(m.maprange(speck.outputs['Fac'], 0.35, 0.68), col('#ffffff'), col('#c6c2cc')))
    if S.get('grass'):
        ground = terrain.grass_detail(m, pos, ground, flowers=0.6, keep_off=m.maprange(pv, 0.12, 0.0))
    if S.get('cobble'):
        cv = m.voronoi(9.0, pos)
        ground = m.mult(ground, m.mix(m.maprange(cv.outputs['Distance'], 0.06, 0.2), col('#6f6a78'), col('#ffffff')))
    if S.get('ice'):
        sc = m.noise(3.0, 5, 0.7, pos, dist=2.0)
        ground = m.mix(m.math('MULTIPLY', m.maprange(sc.outputs['Fac'], 0.55, 0.75), 0.35), ground, col('#bcd8ea'))
    if S.get('puddles'):
        pn = m.noise(0.9, 3, 0.5, pos)
        pud = m.maprange(pn.outputs['Fac'], 0.62, 0.66)
        ground = m.mix(m.math('MULTIPLY', pud, 0.55), ground, col('#262a3f'))
    # walkway
    wx = m.node('ShaderNodeVectorMath', operation='MULTIPLY')
    m.link(pos, wx.inputs[0])
    wx.inputs[1].default_value = (1.0, 1.0, 1.0)
    br = _tiles(m, wx.outputs['Vector'], S['walk_scale'], S['walk'][0], S['walk'][1], S['walk_mortar'], 0.035 if not S.get('planks') else 0.02,
                ratio=2.6 if S.get('planks') else 1.0)
    wcol = br.outputs['Color']
    if S.get('checker'):
        ck = m.node('ShaderNodeTexChecker')
        ck.inputs['Scale'].default_value = 3.2
        ck.inputs['Color1'].default_value = col(S['walk'][0])
        ck.inputs['Color2'].default_value = col(S['walk'][1])
        m.link(pos, ck.inputs['Vector'])
        wcol = ck.outputs['Color']
    if S.get('carpet'):
        cn = m.noise(60.0, 2, 0.5, pos)
        wcol = m.mult(m.mix(m.maprange(cn.outputs['Fac'], 0.3, 0.7), col(S['walk'][0]), col(S['walk'][1])), col('#ffffff'))
    wn = m.noise(14.0, 3, 0.5, pos)
    wcol = m.mult(wcol, m.mix(m.maprange(wn.outputs['Fac'], 0.35, 0.7), col('#ffffff'), col('#ddd5cc')))
    if S.get('stars'):
        # little inlaid stars along the boulevard walkway (a generic sidewalk motif)
        sv = m.voronoi(2.2, pos)
        sd = m.maprange(sv.outputs['Distance'], 0.12, 0.08)
        sr = m.sep(sv.outputs['Color'])[0]
        wcol = m.mix(m.math('MULTIPLY', sd, m.maprange(sr, 0.7, 0.72)), wcol, col('#f7c95c'))
    if S.get('seams'):
        # glowing light strips in the tech panels
        gridv = _tiles(m, pos, 1.4, '#000000', '#000000', '#ffffff', 0.025)
        seam = m.sep(gridv.outputs['Color'])[0]
        ground = m.mix(m.math('MULTIPLY', seam, 0.9), ground, col(S['seams']))
    # a crisp darker kerb round the walkway and a pale lip inside it
    kerb = m.math('MULTIPLY', m.maprange(pv, 0.18, 0.28), m.maprange(pv, 0.4, 0.3))
    top = m.mix(walk, ground, wcol)
    top = m.mix(m.math('MULTIPLY', kerb, 0.85), top, col(S['edge']))
    top = m.mult(top, m.mix(cam_ao(m, 0.35, 4), col('#4e4a5c'), col('#ffffff')))
    emis = None
    strength = 0.0
    if S.get('seams'):
        emis = m.mult(m.mix(m.math('MULTIPLY', seam, m.math('SUBTRACT', 1.0, walk)), col('#000000'), col(S['seams'])), col('#ffffff'))
        strength = 2.2
    rough = 0.35 if S.get('ice') else 0.8
    bump = m.bump(m.math('ADD', m.math('MULTIPLY', br.outputs['Fac'], m.math('MULTIPLY', walk, -0.6)), m.math('MULTIPLY', speck.outputs['Fac'], 0.3)), 0.25, 0.03)
    b = m.bsdf(top, rough, normal=bump, emission=emis, emission_strength=strength, coat=0.5 if (S.get('puddles') or S.get('ice')) else 0.0)
    if S.get('puddles'):
        # wet asphalt: glossier inside the puddles
        pr = m.math('SUBTRACT', 0.8, m.math('MULTIPLY', pud, 0.7))
        m.link(pr, b.inputs['Roughness'])
    if emis is not None:
        emission_off(m.mat)
    return m.mat


FACADES = {
    # wall colours per building segment, window light colours, lit fraction
    'brick': dict(walls=['#8d4a3c', '#a1583f', '#7a4238', '#9a6a52', '#6e4a44'], trim='#d9cbb8', lit=0.62),
    'stone': dict(walls=['#6e6a78', '#7c7684', '#5f5b69', '#857d86'], trim='#b7aeb0', lit=0.5, arches=True),
    'glass': dict(walls=['#34507a', '#3b5d8c', '#2c4468', '#46689a'], trim='#c8d6e8', lit=0.72, glassy=True),
    'pastel': dict(walls=['#e7a9c0', '#a9dcc9', '#f4d6a0', '#b9b2e6', '#f2b7a8'], trim='#fff4ea', lit=0.7),
    'deco': dict(walls=['#4f3a5e', '#5d4270', '#3e3052', '#6a4a6a'], trim='#f2c14e', lit=0.66),
    'western': dict(walls=['#b5655c', '#c97a6e', '#a45a58', '#d38d86'], trim='#f6dccf', lit=0.6),
}


def facade_material(name: str, style: str, fh: float, zmin: float | None = None, zmax: float | None = None):
    """Camera-facing building walls: segments of different buildings, floors of windows (some lit
    warm, some cool, some dark), sills and a cornice; darker towards the bedrock."""
    F = FACADES[style]
    m = lib.NT(f'facade_{name}')
    pos = m.position()
    nrm = m.normal()
    X, Y, Z = m.sep(pos)
    NX, NY, NZ = m.sep(nrm)
    # coordinate along the wall: u = -x*ny + y*nx
    u = m.math('ADD', m.math('MULTIPLY', X, m.math('MULTIPLY', NY, -1.0)), m.math('MULTIPLY', Y, NX))
    seg = m.math('FLOOR', m.math('DIVIDE', m.math('ADD', u, 40.0), 2.7))
    segv = m.node('ShaderNodeCombineXYZ')
    m.link(seg, segv.inputs['X'])
    segv.inputs['Y'].default_value = 3.7
    wn_seg = m.node('ShaderNodeTexWhiteNoise')
    wn_seg.noise_dimensions = '3D'
    m.link(segv.outputs['Vector'], wn_seg.inputs['Vector'])
    seg_r = wn_seg.outputs['Value']
    walls = F['walls']
    stops = [(i / len(walls), w) for i, w in enumerate(walls)]
    wall = terrain.ramp_const(m, seg_r, stops)
    # brick / panel grain
    br = _tiles(m, pos, 9.0, '#ffffff', '#e9e3e0', '#b9aeb0', 0.04)
    wall = m.mult(wall, br.outputs['Color'])
    # window grid (cell 0.34 x 0.58 units), per-window randomness
    cw, ch = 0.34, 0.58
    cu = m.math('DIVIDE', u, cw)
    cv = m.math('DIVIDE', m.math('SUBTRACT', Z, 0.06), ch)
    fu = m.math('FRACT', cu)
    fv = m.math('FRACT', cv)
    win = m.math('MULTIPLY', m.math('MULTIPLY', m.maprange(fu, 0.18, 0.24), m.maprange(fu, 0.82, 0.76)),
                 m.math('MULTIPLY', m.maprange(fv, 0.24, 0.3), m.maprange(fv, 0.82, 0.76)))
    # no windows in the top band (cornice) or near the bedrock (towers pass their own window band)
    z_hi = -0.3 if zmax is None else zmax
    z_lo = -fh + 0.42 if zmin is None else zmin
    band = m.math('MULTIPLY', m.maprange(Z, z_hi + 0.02, z_hi - 0.06), m.maprange(Z, z_lo - 0.07, z_lo + 0.07))
    win = m.math('MULTIPLY', win, band)
    cid = m.node('ShaderNodeCombineXYZ')
    m.link(m.math('FLOOR', cu), cid.inputs['X'])
    m.link(m.math('FLOOR', cv), cid.inputs['Y'])
    m.link(seg_r, cid.inputs['Z'])
    wn = m.node('ShaderNodeTexWhiteNoise')
    wn.noise_dimensions = '3D'
    m.link(cid.outputs['Vector'], wn.inputs['Vector'])
    r = wn.outputs['Value']
    wcolr = wn.outputs['Color']
    lit_on = m.maprange(r, 1.0 - F['lit'] - 0.01, 1.0 - F['lit'])
    light = terrain.ramp_const(m, m.sep(wcolr)[0], [(0.0, '#ffd48a'), (0.38, '#ffbf6e'), (0.62, '#fff0c8'), (0.8, '#bfe0ff'), (0.9, '#ff9ad2')])
    dark = col('#1b2130') if not F.get('glassy') else col('#20304c')
    wcol = m.mix(lit_on, dark, light)
    # sills and the cornice
    sill = m.math('MULTIPLY', m.maprange(fv, 0.12, 0.16), m.maprange(fv, 0.22, 0.18))
    wall = m.mix(m.math('MULTIPLY', sill, 0.7), wall, m.mult(wall, col('#9c9098')))
    corn = m.maprange(Z, z_hi + 0.08, z_hi + 0.14)
    wall = m.mix(corn, wall, col(F['trim']))
    c = m.mix(win, wall, wcol)
    # darker, cooler lower down, and ambient occlusion
    low = m.maprange(Z, z_lo - 0.4, z_lo + 1.6, 0.0, 1.0, smooth=False)
    c = m.mult(c, m.mix(low, col('#3c3a55'), col('#ffffff')))
    c = m.mult(c, m.mix(cam_ao(m, 0.5, 4), col('#4a4458'), col('#ffffff')))
    emis = m.mult(wcol, m.mix(m.math('MULTIPLY', win, lit_on), col('#000000'), col('#ffffff')))
    b = m.bsdf(c, 0.55, emission=emis, emission_strength=3.6, coat=0.3 if F.get('glassy') else 0.0,
               normal=m.bump(m.math('ADD', m.math('MULTIPLY', br.outputs['Fac'], 0.5), m.math('MULTIPLY', win, -0.8)), 0.3, 0.02))
    _ = (NZ, b)
    return emission_off(m.mat)


def rock_material(name: str = 'bedrock'):
    """The bedrock under each floating block: dark strata, cooler and darker further down."""
    m = lib.NT(name)
    pos = m.position()
    X, Y, Z = m.sep(pos)
    wave = m.node('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 1.6
    wave.inputs['Distortion'].default_value = 5.0
    m.link(pos, wave.inputs['Vector'])
    rn = m.noise(2.0, 5, 0.6, pos)
    rf = m.math('ADD', m.math('MULTIPLY', wave.outputs['Fac'], 0.5), m.math('MULTIPLY', rn.outputs['Fac'], 0.5))
    rock = m.ramp(rf, [(0.25, '#3e3448'), (0.45, '#564760'), (0.6, '#6b5a70'), (0.8, '#4a3f58')])
    rv = m.voronoi(6.0, pos, feature='DISTANCE_TO_EDGE')
    rock = m.mult(rock, m.mix(m.maprange(rv.outputs['Distance'], 0.05, 0.0), col('#ffffff'), col('#4a3c50')))
    depth = m.maprange(Z, -7.0, -2.0, 0.0, 1.0, smooth=False)
    rock = m.mult(rock, m.mix(depth, col('#2e2c4a'), col('#ffffff')))
    rock = m.mult(rock, m.mix(cam_ao(m, 0.8, 4), col('#2a2436'), col('#ffffff')))
    m.bsdf(rock, 0.9, normal=m.bump(m.math('ADD', rn.outputs['Fac'], m.maprange(rv.outputs['Distance'], 0.06, 0.0, 0.0, -0.5)), 0.35, 0.08))
    return m.mat


def parapet_material(name: str, color: str):
    m = lib.NT(f'parapet_{name}')
    pos = m.position()
    n = m.noise(12.0, 3, 0.6, pos)
    c = m.mult(col(color), m.mix(m.maprange(n.outputs['Fac'], 0.3, 0.7), col('#cfc6c0'), col('#ffffff')))
    c = m.mult(c, m.mix(cam_ao(m, 0.3, 4), col('#4b4458'), col('#ffffff')))
    m.bsdf(c, 0.8)
    return m.mat


# ------------------------------------------------------------------------------------------
# Lighting
def night_lights(sky_strength: float = 0.8, moon: float = 2.1):
    """Blue-hour night: a violet sky fill, a cool moon key from the upper left (the festival's usual
    light direction, so the characters' shading agrees) and warm city bounce from below."""
    lib.world_light(sky_strength, zenith='#6a78bc', horizon='#b894c8', ground='#6a5070')
    lib.sun(energy=moon, elevation=52, azimuth=-35, angle=3.0, color='#c9d4ff')


_LIGHTS: list = []


def point_light(x, y, z, color='#ffc27a', energy=60.0, radius=0.12, name='lamp'):
    """A point lamp at world (x, y, z)."""
    ld = bpy.data.lights.new(name, 'POINT')
    ld.energy = energy
    ld.color = col(color)[:3]
    ld.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, ld)
    ob.location = (x, y, z)
    bpy.context.scene.collection.objects.link(ob)
    _LIGHTS.append(ob)
    return ob


def area_light_up(x, y, z, size, color, energy, name='glowpool'):
    """A soft downward area light (a sign's glow washing the ground in front of it)."""
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.color = col(color)[:3]
    ld.size = size
    ob = bpy.data.objects.new(name, ld)
    ob.location = (x, y, z)
    bpy.context.scene.collection.objects.link(ob)
    _LIGHTS.append(ob)
    return ob


# ------------------------------------------------------------------------------------------
# Geometry helpers (all return (verts, faces))
def quad_strip(pts_a, pts_b):
    verts = list(pts_a) + list(pts_b)
    n = len(pts_a)
    faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    return verts, faces


def extrude_poly(poly_world, z0, z1):
    """Prism from a CCW polygon (list of (x, y)) between z0 and z1 (convex or simple polygons)."""
    n = len(poly_world)
    verts = [(x, y, z0) for (x, y) in poly_world] + [(x, y, z1) for (x, y) in poly_world]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return verts, faces


def rounded_rect(cx, cy, hw, hh, r, seg=4):
    """Rounded rectangle outline (world units, CCW)."""
    pts = []
    for (qx, qy, a0) in ((cx + hw - r, cy + hh - r, 0.0), (cx - hw + r, cy + hh - r, math.pi / 2), (cx - hw + r, cy - hh + r, math.pi), (cx + hw - r, cy - hh + r, 1.5 * math.pi)):
        for k in range(seg + 1):
            a = a0 + k / seg * math.pi / 2
            pts.append((qx + math.cos(a) * r, qy + math.sin(a) * r))
    return pts


def text_mesh(text: str, size: float, extrude: float = 0.02, bevel: float = 0.0, align='CENTER'):
    """Text as mesh data (verts, faces) in its own XY plane (reading along +X, up +Y), centred."""
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = text
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.align_x = align
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    verts = [tuple(v.co) for v in me.vertices]
    faces = [tuple(p.vertices) for p in me.polygons]
    ob.evaluated_get(dg).to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    return verts, faces


def facing(verts, loc, yaw=0.0, lean=0.0):
    """Stand a flat XY-plane shape up to face the camera (its +Y becomes up, tilted back by `lean`),
    turned by `yaw` around Z, and move it to `loc`."""
    out = []
    ca, sa = math.cos(yaw), math.sin(yaw)
    cl, sl = math.cos(lean), math.sin(lean)
    for (x, y, z) in verts:
        # XY plane -> XZ plane facing -Y (z is the extrusion depth -> +Y into the sign)
        px, py, pz = x, z, y
        # lean back around X
        py2 = py * cl + pz * sl
        pz2 = -py * sl + pz * cl
        # yaw
        qx = px * ca - py2 * sa
        qy = px * sa + py2 * ca
        out.append((loc[0] + qx, loc[1] + qy, loc[2] + pz2))
    return out


# ------------------------------------------------------------------------------------------
# The board
class CityBoard:
    def __init__(self, data_path: str, out_dir: str, landmarks: list, *, facade_h: float = 2.3, gap: int = 36,
                 island_for: dict | None = None, deck_width: float = 104.0):
        self.data = json.load(open(data_path))
        self.id = self.data['id']
        self.W, self.H = self.data['width'], self.data['height']
        terrain.set_canvas(self.W, self.H, GRID)
        self.nodes = {n['id']: n for n in self.data['nodes']}
        self.edges = self.data['edges']
        self.out = out_dir
        os.makedirs(out_dir, exist_ok=True)
        self.landmarks = landmarks
        self.facade_h = facade_h
        self.gap = gap
        self.deck_width = deck_width
        # per-group look: island_for maps a node id (any in the group) -> dict(surface=, facade=, fh=)
        self.island_for = island_for or {}
        self.extra_rects: list = []  # (cx, cy, hw, hh, angle_deg, owner_node)
        self.decor: list = []  # islands with no spaces: (name, [(cx, cy, hw, hh, angle_deg)], look)
        self.decor_looks: dict = {}
        pts = [(n['x'], n['y']) for n in self.nodes.values()]
        for e in self.edges:
            a, b = self.nodes[e['from']], self.nodes[e['to']]
            for t in np.linspace(0, 1, 9):
                pts.append((a['x'] + (b['x'] - a['x']) * t, a['y'] + (b['y'] - a['y']) * t))
        self.path_pts = np.array(pts)
        self.gw, self.gh = self.W // GRID, self.H // GRID

    # --- queries ----------------------------------------------------------------------------
    def canopy_clear(self, bx, by, width, height, pad=20):
        """True if no space or trail lies in the screen area a tall object at (bx, by) would cover."""
        P = self.path_pts
        m = (np.abs(P[:, 0] - bx) < width) & (P[:, 1] < by + pad) & (P[:, 1] > by - height)
        return not m.any()

    def near_node(self, bx, by, r):
        return any((bx - n['x']) ** 2 + (by - n['y']) ** 2 < r * r for n in self.nodes.values())

    def near_landmark(self, bx, by, pad=0.0):
        for lm in self.landmarks:
            fw, fd = lm.get('fw', 0), lm.get('fd', 0)
            if not fw:
                continue
            if lm['x'] - fw - pad < bx < lm['x'] + fw + pad and lm['y'] - fd * 2 - pad < by < lm['y'] + 30 + pad:
                return True
        return False

    # --- islands ------------------------------------------------------------------------------
    def groups(self):
        parent = {n: n for n in self.nodes}

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for e in self.edges:
            if e['style'] == 'path':
                parent[find(e['from'])] = find(e['to'])
        out: dict = {}
        for n in self.nodes:
            out.setdefault(find(n), []).append(n)
        return [sorted(g) for g in out.values()]

    def deck_nodes(self):
        """Lone spaces between two crossings: they stand on a landing platform, not a block."""
        out = set()
        for g in self.groups():
            if len(g) == 1 and not self.island_for.get(g[0], {}).get('block'):
                out.add(g[0])
        return out

    def _draw_obb(self, dr, cx, cy, hl, hw, ang):
        ca, sa = math.cos(ang), math.sin(ang)
        pts = []
        for (u, v) in ((-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)):
            pts.append(((cx + u * ca - v * sa) / GRID, (cy + u * sa + v * ca) / GRID))
        dr.polygon(pts, fill=255)

    def block_mask(self, ids):
        img = Image.new('L', (self.gw, self.gh), 0)
        dr = ImageDraw.Draw(img)
        idset = set(ids)
        rnd = random.Random(zlib.crc32(','.join(ids).encode()))
        look = self.look_of(ids)
        grow = look.get('grow', 1.0)
        for i in ids:
            n = self.nodes[i]
            dirs = []
            for e in self.edges:
                if e['style'] != 'path':
                    continue
                if e['from'] == i and e['to'] in idset:
                    o = self.nodes[e['to']]
                elif e['to'] == i and e['from'] in idset:
                    o = self.nodes[e['from']]
                else:
                    continue
                dirs.append(math.atan2(o['y'] - n['y'], o['x'] - n['x']))
            if dirs:
                # mean direction (mod pi) of the trails through this space
                sx = sum(math.cos(2 * a) for a in dirs)
                sy = sum(math.sin(2 * a) for a in dirs)
                ang = 0.5 * math.atan2(sy, sx)
            else:
                ang = 0.0
            # snap near-axis directions to the axis (tidier blocks)
            for snap in (0.0, math.pi / 2, -math.pi / 2, math.pi):
                if abs(ang - snap) < math.radians(14):
                    ang = snap
            self._draw_obb(dr, n['x'], n['y'], (128 + rnd.uniform(-8, 22)) * grow, (104 + rnd.uniform(-6, 18)) * grow, ang)
        for e in self.edges:
            if e['style'] != 'path' or e['from'] not in idset or e['to'] not in idset:
                continue
            a, b = self.nodes[e['from']], self.nodes[e['to']]
            L = math.hypot(b['x'] - a['x'], b['y'] - a['y'])
            ang = math.atan2(b['y'] - a['y'], b['x'] - a['x'])
            self._draw_obb(dr, (a['x'] + b['x']) / 2, (a['y'] + b['y']) / 2, L / 2 + 40, (100 + rnd.uniform(-4, 14)) * grow, ang)
        for (cx, cy, hw, hh, ang, owner) in self.extra_rects:
            if owner in idset:
                self._draw_obb(dr, cx, cy, hw, hh, math.radians(ang))
        for lm in self.landmarks:
            if not lm.get('fw') or lm.get('no_ground'):
                continue
            owner = lm.get('owner') or min(self.nodes.values(), key=lambda n: math.hypot(lm['x'] - n['x'], lm['y'] - n['y']))['id']
            if owner in idset:
                fw, fd = lm['fw'], lm['fd']
                self._draw_obb(dr, lm['x'], lm['y'] - fd + 26, fw + 30, fd + 34, 0.0)
        m = np.asarray(img, np.uint8) > 127
        k = max(1, int(26 / GRID))
        m = ndimage.binary_closing(m, structure=np.ones((3, 3)), iterations=k)
        m = ndimage.binary_fill_holes(m)
        return m

    def look_of(self, ids):
        for i in ids:
            if i in self.island_for:
                return self.island_for[i]
            if i.startswith('@'):
                return self.decor_looks.get(i[1:], {})
        return {}

    def blocks(self):
        """(ids, mask) per block, carved apart by a sky alley where they would touch."""
        decks = self.deck_nodes()
        comps = [[list(g), self.block_mask(g)] for g in self.groups() if not (len(g) == 1 and g[0] in decks)]
        for (name, rects, look) in self.decor:
            img = Image.new('L', (self.gw, self.gh), 0)
            dr = ImageDraw.Draw(img)
            for (cx, cy, hw, hh, ang) in rects:
                self._draw_obb(dr, cx, cy, hw, hh, math.radians(ang))
            self.decor_looks[name] = look
            comps.append([[f'@{name}'], np.asarray(img, np.uint8) > 127])
        gap = max(1, int(self.gap / GRID))
        # every crossing ('steps' edge) gets a clean gap: each end's block stops a third of the way
        yy, xx = np.mgrid[0:self.gh, 0:self.gw].astype(np.float32) * GRID + GRID / 2
        owner = {nid: i for i, (g, _) in enumerate(comps) for nid in g}
        for e in self.edges:
            if e['style'] != 'steps':
                continue
            a, b = self.nodes[e['from']], self.nodes[e['to']]
            vx, vy = b['x'] - a['x'], b['y'] - a['y']
            L2 = vx * vx + vy * vy or 1.0
            L = math.sqrt(L2)
            t = ((xx - a['x']) * vx + (yy - a['y']) * vy) / L2
            perp = np.abs((xx - a['x']) * vy - (yy - a['y']) * vx) / L
            near = perp < 165
            for nid, cut in ((e['from'], (t > 0.36) & (t < 1.5)), (e['to'], (t < 0.64) & (t > -0.5))):
                i = owner.get(nid)
                if i is None:
                    continue
                m = comps[i][1] & ~(near & cut)
                # keep only the parts that still carry this block's spaces
                lab, _ = ndimage.label(m)
                keep = np.zeros_like(m)
                for sid in comps[i][0]:
                    gx, gy = int(self.nodes[sid]['x'] / GRID), int(self.nodes[sid]['y'] / GRID)
                    if 0 <= gy < lab.shape[0] and 0 <= gx < lab.shape[1] and lab[gy, gx]:
                        keep |= lab == lab[gy, gx]
                comps[i][1] = keep

        def nodes_ok(ids, m):
            d = ndimage.distance_transform_edt(m) * GRID
            return all(dist_at(d, self.nodes[i]['x'], self.nodes[i]['y']) > 52 for i in ids if i in self.nodes)

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
                    lab, nlab = ndimage.label(carved)
                    keep = np.zeros_like(carved)
                    real = [nid for nid in comps[small][0] if nid in self.nodes]
                    for nid in real:
                        gx, gy = int(self.nodes[nid]['x'] / GRID), int(self.nodes[nid]['y'] / GRID)
                        if 0 <= gy < lab.shape[0] and 0 <= gx < lab.shape[1] and lab[gy, gx]:
                            keep |= lab == lab[gy, gx]
                    if not real and nlab:
                        # a decor island keeps its largest piece
                        sizes = ndimage.sum(carved, lab, range(1, nlab + 1))
                        keep = lab == (int(np.argmax(sizes)) + 1)
                    if keep.any() and nodes_ok(comps[small][0], keep):
                        comps[small][1] = keep
                    else:
                        comps[big][1] = np.logical_or(comps[big][1], comps[small][1])
                        comps[big][0] += comps[small][0]
                        comps[small] = None
                    changed = True
        return [(sorted(c[0]), c[1]) for c in comps if c is not None]

    def path_mask(self, blocks):
        """Walkway mask (2 px per pixel): trails along 'path' edges, pads round every space."""
        s = 2
        img = Image.new('L', (self.W // s, self.H // s), 0)
        dr = ImageDraw.Draw(img)
        for e in self.edges:
            if e['style'] != 'path':
                continue
            a, b = self.nodes[e['from']], self.nodes[e['to']]
            dr.line([(a['x'] / s, a['y'] / s), (b['x'] / s, b['y'] / s)], fill=255, width=int(88 / s))
        for n in self.nodes.values():
            r = 74 / s
            dr.ellipse([n['x'] / s - r, n['y'] / s - r * 0.8, n['x'] / s + r, n['y'] / s + r * 0.8], fill=255)
        for e in self.edges:
            # walkway continues onto the block from each crossing
            if e['style'] != 'steps':
                continue
            a, b = self.nodes[e['from']], self.nodes[e['to']]
            dr.line([(a['x'] / s, a['y'] / s), (b['x'] / s, b['y'] / s)], fill=255, width=int(80 / s))
        img = img.filter(ImageFilter.GaussianBlur(2.2))
        path = os.path.join(self.out, 'pathmask.png')
        img.save(path)
        self.pm = np.asarray(img, np.float32) / 255.0
        self.pm_path = path
        return path

    def pmask_at(self, bx, by):
        x, y = int(bx // 2), int(by // 2)
        if 0 <= y < self.pm.shape[0] and 0 <= x < self.pm.shape[1]:
            return float(self.pm[y, x])
        return 0.0

    # --- block meshes -------------------------------------------------------------------------
    def build_block(self, ids, mask, name, surf_mat, facade_mat, parapet_mat, rock_mat, fh=None, parapet=True, seed=0, openings=()):
        """A floating city block: flat top at z = 0 (triangulated from the mask outline), a parapet,
        straight walls down to -fh (the window band) and a jagged bedrock underside."""
        import triangle as tr
        fh = fh or self.facade_h
        dist = ndimage.distance_transform_edt(mask) * GRID
        dist = ndimage.gaussian_filter(dist, 0.8)
        outline = terrain.level_contour(dist, 1.5)
        # straight walls: simplify the traced outline, then resample evenly along it
        poly = measure.approximate_polygon(outline, tolerance=3.0)
        per = float(np.sum(np.linalg.norm(np.diff(np.vstack([poly, poly[:1]]), axis=0), axis=1)))
        N = max(40, int(per / 12))
        ring = resample(poly, N)
        nrm = np.zeros_like(ring)
        for k in range(N):
            t = ring[(k + 1) % N] - ring[k - 1]
            nn = np.array([t[1], -t[0]])
            nn /= (np.linalg.norm(nn) or 1)
            if dist_at(dist, *(ring[k] + nn * 6)) > dist_at(dist, *(ring[k] - nn * 6)):
                nn = -nn
            nrm[k] = nn
        seg = np.array([[k, (k + 1) % N] for k in range(N)])
        T = tr.triangulate({'vertices': ring, 'segments': seg}, 'pq26a1100')
        pts2 = T['vertices']
        tris = [tuple(int(i) for i in t) for t in T['triangles']]
        verts, faces, mat_idx = [], [], []
        up = lambda c: Vector((0, 0, 1))  # noqa: E731
        down = lambda c: Vector((0, 0, -1))  # noqa: E731
        # top
        for (bx, by) in pts2:
            verts.append(tuple(board_to_world(bx, by, 0.0)))
        top_faces = orient(tris, verts, up)
        faces += top_faces
        mat_idx += [0] * len(top_faces)
        wc = board_to_world(*ring.mean(0), 0.0)
        outward = lambda c: Vector((c.x - wc.x, c.y - wc.y, 0.0))  # noqa: E731
        # parapet: a low wall on the rim (outer face flush with the facade)
        pz = 0.14 if parapet else 0.0
        inset = 6.0
        r_out0 = len(verts)
        for k in range(N):
            verts.append(tuple(board_to_world(*ring[k], 0.0)))
        r_out1 = len(verts)
        for k in range(N):
            verts.append(tuple(board_to_world(*ring[k], pz)))
        r_in1 = len(verts)
        for k in range(N):
            verts.append(tuple(board_to_world(*(ring[k] - nrm[k] * inset), pz)))
        r_in0 = len(verts)
        for k in range(N):
            verts.append(tuple(board_to_world(*(ring[k] - nrm[k] * inset), 0.0)))
        band = []
        if parapet:
            for k in range(N):
                k2 = (k + 1) % N
                mid = (ring[k] + ring[k2]) / 2
                if any((mid[0] - ox) ** 2 + (mid[1] - oy) ** 2 < 78 ** 2 for (ox, oy) in openings):
                    continue  # a deck or stair meets the block here
                band.append(((r_out0 + k, r_out0 + k2, r_out1 + k2, r_out1 + k), 1, 'out'))
                band.append(((r_out1 + k, r_out1 + k2, r_in1 + k2, r_in1 + k), 1, 'up'))
                band.append(((r_in1 + k, r_in1 + k2, r_in0 + k2, r_in0 + k), 1, 'in'))
        # facade: straight down from the rim to -fh, with a cornice lip at the top
        f0 = len(verts)
        for k in range(N):
            verts.append(tuple(board_to_world(*ring[k], -fh)))
        for k in range(N):
            k2 = (k + 1) % N
            band.append(((r_out0 + k, r_out0 + k2, f0 + k2, f0 + k), 2, 'out'))
        for (f, mi, d) in band:
            if d == 'out':
                ff = orient([f], verts, outward)[0]
            elif d == 'up':
                ff = orient([f], verts, up)[0]
            else:
                ff = orient([f], verts, lambda c: -outward(c))[0]
            faces.append(ff)
            mat_idx.append(mi)
        # bedrock: from the facade foot, dropping deeper towards the middle
        und0 = len(verts)
        rnd = random.Random(seed * 7 + 3)
        for i, (bx, by) in enumerate(pts2):
            d = dist_at(dist, bx, by)
            w = board_to_world(bx, by, 0.0)
            q = Vector((w.x * 0.7, w.y * 0.7, 0.0))
            depth = fh + 0.35 + 2.4 * (d / 100.0) ** 0.8
            depth *= 1.0 + 0.3 * noise.noise(q) + 0.12 * noise.noise(q * 3.1 + Vector((3, 1, 2)))
            if i < N:
                depth = fh + 0.05
            verts.append((w.x, w.y, -depth))
        und_faces = orient([tuple(und0 + i for i in t) for t in tris], verts, down)
        faces += und_faces
        mat_idx += [3] * len(und_faces)
        for k in range(N):
            k2 = (k + 1) % N
            ff = orient([(f0 + k, f0 + k2, und0 + k2, und0 + k)], verts, outward)[0]
            faces.append(ff)
            mat_idx.append(3)
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        me.validate(clean_customdata=False)
        me.update()
        ob = bpy.data.objects.new(name, me)
        lib.link(ob)
        for mt in (surf_mat, parapet_mat, facade_mat, rock_mat):
            me.materials.append(mt)
        for i, p in enumerate(me.polygons):
            p.material_index = mat_idx[i]
            p.use_smooth = mat_idx[i] == 3
        # roughen the bedrock only
        vg = ob.vertex_groups.new(name='rock')
        vg.add(list(range(und0 + N, len(verts))), 1.0, 'REPLACE')
        vg.add(list(range(und0, und0 + N)), 0.15, 'REPLACE')
        tex = bpy.data.textures.new(name + '_rock', 'VORONOI')
        tex.noise_scale = 0.35
        disp = ob.modifiers.new('disp', 'DISPLACE')
        disp.texture = tex
        disp.texture_coords = 'GLOBAL'
        disp.strength = 0.3
        disp.mid_level = 0.5
        disp.vertex_group = 'rock'
        _ = rnd
        return ob, dist, ring, nrm

    # --- decks --------------------------------------------------------------------------------
    def inside_any(self, masks, bx, by, pad_cells=0):
        gx, gy = int(bx // GRID), int(by // GRID)
        for m in masks:
            if 0 <= gy < m.shape[0] and 0 <= gx < m.shape[1] and m[gy, gx]:
                return True
        return False

    def deck_span(self, a, b, masks):
        """Parameter range [t0, t1] of the crossing a->b (board points) that lies outside every block,
        plus a little overlap onto each block."""
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        ts = np.linspace(0, 1, max(8, int(L / 4)))
        out = [t for t in ts if not self.inside_any(masks, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)]
        if not out:
            return None
        ov = 18.0 / max(L, 1)
        return max(0.0, min(out) - ov), min(1.0, max(out) + ov)


def save_plan(board: CityBoard, blocks, path: str, k: float = 0.25):
    """Top-down layout check: blocks, walkway mask, spaces, decks and landmark footprints."""
    W, H = board.W, board.H
    img = Image.new('RGB', (int(W * k), int(H * k)), (22, 24, 40))
    px = np.asarray(img).copy()
    for (ids, m) in blocks:
        mm = np.asarray(Image.fromarray(m.astype(np.uint8) * 255).resize(img.size, Image.NEAREST)) > 127
        px[mm] = (70, 76, 100)
    pmm = np.asarray(Image.fromarray((board.pm * 255).astype(np.uint8)).resize(img.size, Image.BILINEAR)) > 100
    px[pmm] = (200, 190, 170)
    img = Image.fromarray(px)
    d = ImageDraw.Draw(img)
    for e in board.edges:
        a, b = board.nodes[e['from']], board.nodes[e['to']]
        if e['style'] == 'steps':
            d.line([(a['x'] * k, a['y'] * k), (b['x'] * k, b['y'] * k)], fill=(120, 220, 255), width=2)
    for n in board.nodes.values():
        d.ellipse([n['x'] * k - 4, n['y'] * k - 3, n['x'] * k + 4, n['y'] * k + 3], fill=(255, 90, 90))
    for lm in board.landmarks:
        fw, fd, hh = lm.get('fw', 20), lm.get('fd', 20), lm.get('h', 100)
        d.rectangle([(lm['x'] - fw) * k, (lm['y'] - hh) * k, (lm['x'] + fw) * k, lm['y'] * k], outline=(255, 200, 80))
        d.text(((lm['x'] - fw) * k + 1, (lm['y'] - hh) * k + 1), lm['id'][:10], fill=(255, 220, 120))
    d.rectangle([2020 * k - 3, 1500 * k - 6, 2020 * k + 3, 1500 * k], fill=(90, 160, 255))
    hs = board.data['hostSpot']
    d.rectangle([hs['x'] * k - 3, hs['y'] * k - 6, hs['x'] * k + 3, hs['y'] * k], fill=(30, 220, 180))
    img.save(path)
    return path


# ------------------------------------------------------------------------------------------
# Rendering and export
def crisp(path, radius=1.1, amount=35, threshold=3):
    """Light unsharp mask on the colour of a finished render (as Suncoil's board.py does)."""
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im)
    solid = a[..., 3] > 250
    if not solid.any():
        return
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    filled = Image.fromarray(np.ascontiguousarray(a[..., :3][iy, ix]), 'RGB')
    rgb = np.asarray(filled.filter(ImageFilter.UnsharpMask(radius=radius, percent=amount, threshold=threshold))).copy()
    rgb[a[..., 3] == 0] = 0
    Image.fromarray(np.dstack([rgb, a[..., 3]]), 'RGBA').save(path)


def render_bands(frame, n, path, scale, overlap=24, only=-1, reuse=False):
    """Render a frame as n horizontal bands (each saved as it finishes), then stitch them."""
    fx, fy, fw, fh = frame
    rh = int(round(fh * scale))
    cuts = [round(rh * i / n) for i in range(n + 1)]
    bands = []
    for i in range(n):
        y0, y1 = max(0, cuts[i] - overlap), min(rh, cuts[i + 1] + overlap)
        band = os.path.join(os.path.dirname(path), f'band_{i}.png')
        if only >= 0 and i != only:
            continue
        if reuse and os.path.exists(band):
            print('band', i, 'reused', flush=True)
        else:
            lib.set_border((fx, fy + y0 / scale, fx + fw, fy + y1 / scale), frame)
            lib.render_to(band)
            print('band', i, 'done', flush=True)
        if only >= 0:
            lib.clear_border()
            return
        bands.append((Image.open(band).convert('RGBA'), y0))
    full = Image.new('RGBA', (bands[0][0].width, rh), (0, 0, 0, 0))
    for i, (im, top) in enumerate(bands):
        a, b = cuts[i], cuts[i + 1]
        full.paste(im.crop((0, a - top, im.width, b - top)), (0, a))
    lib.clear_border()
    full.save(path)


def export_tiles(path, board_id, origin, scale, quality=84):
    sys.path.insert(0, ART)
    from tiles import export_tiles as _export
    return _export(path, board_id, origin, scale, quality=quality)


def render_props(board_id, built, hide_objs, frame, scale, out_dir, only=()):
    """Render each landmark on its own (lights and blocks still light it) and list it in the manifest."""
    fx, fy, fw, fh = frame
    rx, ry = bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y
    for o in hide_objs:
        o.visible_camera = False
        if not o.name.startswith('block_'):
            o.hide_render = True
    all_prop_objs = [o for _, obs in built.values() for o in obs]
    dest = os.path.join(ROOT, 'public', 'assets', 'rendered', board_id)
    os.makedirs(dest, exist_ok=True)
    man_path = os.path.join(dest, 'manifest.json')
    old = {e['id']: e for e in json.load(open(man_path)).get('props', [])} if only and os.path.exists(man_path) else {}
    entries = []
    dg = bpy.context.evaluated_depsgraph_get()
    for pid, (lm, obs) in built.items():
        if only and pid not in only:
            if pid in old:
                entries.append(old[pid])
            continue
        for o in all_prop_objs:
            o.hide_render = o not in obs
        for o in obs:
            o.visible_camera = True
            o.visible_glossy = True
        xs, ys = [], []
        for o in obs:
            ev = o.evaluated_get(dg)
            me = ev.to_mesh()
            mw = o.matrix_world
            for v in me.vertices:
                bx, by = lib.world_to_board(mw @ v.co)
                xs.append(bx)
                ys.append(by)
            ev.to_mesh_clear()
        pad = 10
        px0 = max(0, math.floor((min(xs) - pad - fx) * scale))
        px1 = min(rx, math.ceil((max(xs) + pad - fx) * scale))
        py0 = max(0, math.floor((min(ys) - pad - fy) * scale))
        py1 = min(ry, math.ceil((max(ys) + pad - fy) * scale))
        sc = bpy.context.scene
        sc.render.use_border = True
        sc.render.use_crop_to_border = True
        sc.render.border_min_x, sc.render.border_max_x = px0 / rx, px1 / rx
        sc.render.border_min_y, sc.render.border_max_y = 1 - py1 / ry, 1 - py0 / ry
        png = os.path.join(out_dir, 'props', f'{pid}.png')
        lib.render_to(png)
        crisp(png, amount=30)
        im = Image.open(png).convert('RGBA')
        name = f'prop_{pid}.webp'
        im.save(os.path.join(dest, name), 'WEBP', quality=90, method=6)
        e = {'id': pid, 'file': name, 'tex': lm.get('tex', ''), 'kind': lm['kind'],
             'x': fx + px0 / scale, 'y': fy + py0 / scale, 'w': im.width / scale, 'h': im.height / scale,
             'baseY': lm['y'], 'anchorX': lm['x']}
        if lm.get('depth_y') is not None:
            e['depthY'] = lm['depth_y']
        if lm.get('hub'):
            e['hub'] = lm['hub']
        entries.append(e)
        for o in obs:
            o.visible_camera = False
        print('prop', pid, im.size, flush=True)
    lib.clear_border()
    man = json.load(open(man_path)) if os.path.exists(man_path) else {'board': board_id}
    man['props'] = entries
    with open(man_path, 'w') as fh_:
        json.dump(man, fh_, indent=1)
    keep = {t['file'] for t in man.get('tiles', [])} | {e['file'] for e in entries} | {'manifest.json', man.get('shadow', {}).get('file', '')}
    for f in os.listdir(dest):
        if f.startswith('prop_') and f not in keep:
            os.remove(os.path.join(dest, f))


def island_shadow(board_id, terrain_png, offset=(150, 70), blur=34.0, down=6, alpha=150):
    """Soft silhouette of the blocks on the cloud sea far below (see scripts/art/island_shadow.py)."""
    dest = os.path.join(ROOT, 'public', 'assets', 'rendered', board_id)
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
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 18, 20, 52
    rgba[..., 3] = np.clip(a * alpha, 0, 255).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(dest, 'shadow.webp'), 'WEBP', quality=85, method=6)
    dx, dy = offset
    man['shadow'] = {'file': 'shadow.webp', 'x': ox - pad + dx, 'y': oy - pad + dy, 'w': sw * down, 'h': sh * down}
    with open(man_path, 'w') as fh_:
        json.dump(man, fh_, indent=1)
    print('shadow', man['shadow'])


def setup_render(samples: int):
    sc = lib.reset(samples)
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 2
    cy = sc.cycles
    cy.max_bounces = 4
    cy.diffuse_bounces = 2
    cy.glossy_bounces = 1
    cy.transmission_bounces = 2
    cy.transparent_max_bounces = 4
    cy.adaptive_threshold = 0.04
    cy.pixel_filter_width = 1.0
    try:
        cy.use_light_tree = True
    except Exception:
        pass
    sc.view_settings.exposure = 0.35
    return sc



# ------------------------------------------------------------------------------------------
# The whole board: blocks, scatter, crossings, lamps, landmarks, render and export
def add_args(p):
    p.add_argument('--plan', action='store_true', help='layout map only (no render)')
    p.add_argument('--preview', action='store_true', help='quarter-size test render')
    p.add_argument('--export', action='store_true', help='render the board and export tiles, props and manifest')
    p.add_argument('--props-only', action='store_true')
    p.add_argument('--only', default='', help='with --props-only: comma-separated landmark ids')
    p.add_argument('--scale', type=float, default=None)
    p.add_argument('--samples', type=int, default=None)
    p.add_argument('--bands', type=int, default=1)
    p.add_argument('--band', type=int, default=-1)
    p.add_argument('--reuse-bands', action='store_true')
    p.add_argument('--crop', default='')
    p.add_argument('--dry', action='store_true', help='build the whole scene, report, and stop before rendering')
    p.add_argument('--show-props', action='store_true', help='preview: draw the landmarks in the terrain render too')
    p.add_argument('--skip-props', action='store_true', help='with --export: terrain and tiles only (props in a later --props-only run)')
    return p


def crossing_openings(b, masks):
    """Where each crossing meets a block's rim (the parapet opens there)."""
    out = []
    for e in b.edges:
        if e['style'] != 'steps':
            continue
        na, nb = b.nodes[e['from']], b.nodes[e['to']]
        prev = None
        for i in range(61):
            t = i / 60
            px_, py_ = na['x'] + (nb['x'] - na['x']) * t, na['y'] + (nb['y'] - na['y']) * t
            inside = b.inside_any(masks, px_, py_)
            if prev is not None and inside != prev:
                out.append((px_, py_))
            prev = inside
    return out


def walkway_lamps(P, b, masks, rnd, energy=85.0, every=1, styles=('classic', 'hook'), glow='#ffd08a'):
    """Little street lamps beside the walkways (behind them, never in front)."""
    import cityprops as cp
    for ei, e in enumerate(b.edges):
        if e['style'] != 'path' or ei % every:
            continue
        na, nb = b.nodes[e['from']], b.nodes[e['to']]
        mx, my = (na['x'] + nb['x']) / 2, (na['y'] + nb['y']) / 2
        L = math.hypot(nb['x'] - na['x'], nb['y'] - na['y']) or 1
        nx, ny = -(nb['y'] - na['y']) / L, (nb['x'] - na['x']) / L
        if ny > 0:
            nx, ny = -nx, -ny
        for side in (1, -1):
            lx, ly = mx + nx * 66 * side, my + ny * 66 * side
            if side < 0 and ny * side > 0.5:
                continue
            if b.pmask_at(lx, ly) > 0.06 or b.near_node(lx, ly, 72) or b.near_landmark(lx, ly, 40) or not b.inside_any(masks, lx, ly):
                continue
            cp.street_lamp(P, lx, ly, rnd, glow=glow, style=rnd.choice(list(styles)), energy=energy, h=0.95)
            break


def city_main(A, b, out_dir, scale, samples, *, deck_style, scatter_block, block_extras=None, terrain_extras=None, build_landmarks=None,
              lamp_glow='#ffd08a', lamp_styles=('classic', 'hook'), sky=0.42, moon=1.35):
    import cityprops as cp
    blocks = b.blocks()
    b.path_mask(blocks)
    if A.plan:
        path = save_plan(b, blocks, os.path.join(out_dir, 'plan.png'))
        print('plan', path, 'blocks', len(blocks), 'decks', sorted(b.deck_nodes()))
        return
    setup_render(samples)
    night_lights(sky, moon)
    masks = [m for (_, m) in blocks]
    rock_m = rock_material()
    surf_cache, fac_cache, par_cache = {}, {}, {}
    scatter = Parts('scatter')
    rnd = random.Random(2024)
    openings = crossing_openings(b, masks)
    block_info = []
    for idx, (ids, mask) in enumerate(blocks):
        look = b.look_of(ids) or {}
        surface, facade, fh = look.get('surface', 'roof'), look.get('facade', 'brick'), look.get('fh', 2.3)
        if surface not in surf_cache:
            surf_cache[surface] = surface_material(surface, surface, b.pm_path, b.W, b.H)
        key = (facade, fh)
        if key not in fac_cache:
            fac_cache[key] = facade_material(f'{facade}_{fh}', facade, fh)
        pc = look.get('parapet') or FACADES[facade]['trim']
        if pc not in par_cache:
            par_cache[pc] = parapet_material(pc.lstrip('#'), pc)
        name = f'block_{idx}_{ids[0].lstrip("@") if ids else "decor"}'
        ob, dist, ring, nrm = b.build_block(ids, mask, name, surf_cache[surface], fac_cache[key], par_cache[pc], rock_m, fh=fh, seed=idx, openings=openings)
        brnd = random.Random(idx * 97 + 11)
        scatter_block(scatter, b, ids, mask, dist, look, brnd)
        if block_extras:
            block_extras(scatter, b, ids, ring, nrm, look, brnd)
        block_info.append((ids, mask, dist, ring, nrm, look))
        print('block', idx, ids, surface, flush=True)
    if terrain_extras:
        terrain_extras(scatter, b, masks, block_info, rnd)
    # crossings and landings
    deckparts = Parts('decks')
    for e in b.edges:
        if e['style'] != 'steps':
            continue
        na, nb = b.nodes[e['from']], b.nodes[e['to']]
        span = b.deck_span((na['x'], na['y']), (nb['x'], nb['y']), masks)
        if span:
            cp.deck(deckparts, (na['x'], na['y']), (nb['x'], nb['y']), span[0], span[1], style=deck_style(na, nb), rnd=rnd)
    for nid in sorted(b.deck_nodes()):
        n = b.nodes[nid]
        cp.landing(deckparts, n['x'], n['y'], style=deck_style(n, n))
    walkway_lamps(scatter, b, masks, random.Random(77), glow=lamp_glow, styles=lamp_styles)
    scatter.build()
    deckparts.build()
    terrain_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    built = build_landmarks(b) if build_landmarks else {}
    for _, obs in built.values():
        for o in obs:
            if not A.show_props:
                lib.shadow_only(o)
            if o.name.endswith('_beam'):
                o.visible_shadow = False
    frame = (-120, -60, b.W + 240, b.H + 200)
    lib.camera_for_region(*frame, scale=scale)
    if A.dry:
        nv = sum(len(o.data.vertices) for o in bpy.context.scene.objects if o.type == 'MESH')
        print('dry run:', len(bpy.context.scene.objects), 'objects', nv, 'verts', len(_LIGHTS), 'lights', len(built), 'landmarks', flush=True)
        return
    if A.crop:
        x0, y0, x1, y1 = [float(v) for v in A.crop.split(',')]
        lib.set_border((x0, y0, x1, y1), frame)
        lib.render_to(os.path.join(out_dir, 'crop.png'))
        return
    terrain_png = os.path.join(out_dir, 'terrain.png')
    if A.band >= 0:
        render_bands(frame, A.bands, terrain_png, scale, only=A.band)
        return
    if not A.props_only:
        if A.bands > 1:
            render_bands(frame, A.bands, terrain_png, scale, reuse=A.reuse_bands)
        else:
            lib.render_to(terrain_png)
        crisp(terrain_png)
        if A.export:
            export_tiles(terrain_png, b.id, frame[:2], scale)
    if (A.export and not A.skip_props) or A.props_only:
        # props get a taller frame (towers rise above the terrain's top edge)
        pframe = (-120, -760, b.W + 240, b.H + 900)
        lib.camera_for_region(*pframe, scale=scale)
        render_props(b.id, built, terrain_objs, pframe, scale, out_dir, only={t for t in A.only.split(',') if t})
    print('done', len(blocks), 'blocks', flush=True)
