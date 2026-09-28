"""Shared pieces for the Hero Heights minigame art (a toy-diorama city: chunky buildings, glowing
windows, rooftop clutter), rendered side-on with an orthographic camera tipped slightly down.

Screen mapping (1920x1080, 100 px per Blender unit): a point on the front plane (world y = 0) at
screen (sx, sy) sits at world (sx / 100, 0, (540 - sy) / (100 cos PITCH)); anything further back
(world y > 0) shows higher up the screen by y * sin(PITCH) * 100 px, so roof decks read as strips.
Everything is original and generic: no signage, logos or emblems anywhere.
"""
from __future__ import annotations

import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))  # scripts/art (lib, mg_dress)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import lib  # noqa: E402
import mg_dress as dress  # noqa: E402
from lib import MeshBuilder, col  # noqa: E402

SW, SH = 1920, 1080
PX = 100.0
PITCH = math.radians(9.0)
ROOT = lib.ROOT
OUT = os.path.join(ROOT, 'art-out', 'heroes')
PUB = os.path.join(ROOT, 'public', 'assets', 'rendered')
os.makedirs(OUT, exist_ok=True)


# ------------------------------------------------------------------------------------------
# Scene, camera, mapping
def setup(samples: int, preview: bool, transparent: bool = False, exposure: float = -0.1):
    sc = lib.reset(8 if preview else samples)
    dress.threads(2)
    dress.reset_mats()
    sc.render.film_transparent = transparent
    sc.view_settings.exposure = exposure
    sc.cycles.adaptive_threshold = 0.05 if preview else 0.035
    return sc


def camera(scale: float = 1.0, width_px: int = SW, height_px: int = SH, cx_px: float | None = None, cy_px: float | None = None, pitch: float = PITCH):
    """Orthographic camera: the front-plane point at screen (cx, cy) is the frame centre."""
    sc = bpy.context.scene
    cx_px = width_px / 2 if cx_px is None else cx_px
    cy_px = height_px / 2 if cy_px is None else cy_px
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.sensor_fit = 'HORIZONTAL'
    cd.ortho_scale = width_px / PX
    cd.clip_start = 0.1
    cd.clip_end = 600.0
    ob = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(ob)
    sc.camera = ob
    target = Vector((cx_px / PX, 0.0, (540 - cy_px) / (PX * math.cos(pitch))))
    d = Vector((0.0, math.cos(pitch), -math.sin(pitch)))
    ob.location = target - d * 200.0
    ob.rotation_euler = (math.pi / 2 - pitch, 0.0, 0.0)
    sc.render.resolution_x = int(round(width_px * scale))
    sc.render.resolution_y = int(round(height_px * scale))
    sc.render.resolution_percentage = 100
    return ob


def fz(sy: float, depth: float = 0.0) -> float:
    """World z of a point that should appear at screen y `sy` when it sits `depth` units back."""
    return (540 - sy) / (PX * math.cos(PITCH)) - depth * math.tan(PITCH)


def fx(sx: float) -> float:
    return sx / PX


def screen_y(z: float, depth: float = 0.0) -> float:
    return 540 - (z * math.cos(PITCH) + depth * math.sin(PITCH)) * PX


# ------------------------------------------------------------------------------------------
# Materials
_M: dict = {}


def mat(name: str):
    if name in _M:
        return _M[name]
    m = None
    if name == 'paint':
        m = lib.attr_mat('h_paint', rough=0.6, ao=0.5)
    elif name == 'metal':
        n = lib.NT('h_metal')
        b = n.bsdf(n.attr('col'), 0.32, coat=0.25)
        b.inputs['Metallic'].default_value = 0.85
        m = n.mat
    elif name == 'glow':
        n = lib.NT('h_glow')
        c = n.attr('col')
        n.bsdf(c, 0.3, emission=c, emission_strength=3.2)
        m = n.mat
    elif name == 'softglow':
        n = lib.NT('h_softglow')
        c = n.attr('col')
        n.bsdf(c, 0.4, emission=c, emission_strength=1.2)
        m = n.mat
    elif name == 'deck':
        n = lib.NT('h_deck')
        pos = n.position()
        nz = n.noise(9.0, 4, 0.6, pos)
        c = n.mult(n.attr('col'), n.mix(nz.outputs['Fac'], col('#b9b4ad'), col('#ffffff')))
        c = n.mult(c, n.mix(n.ao(0.6, 8), col('#5a5870'), col('#ffffff')))
        n.bsdf(c, 0.85, normal=n.bump(nz.outputs['Fac'], 0.2, 0.02))
        m = n.mat
    _M[name] = m
    return m


def facade_material(name: str, lit: str = '#ffd98a', lit_frac: float = 0.45, cell=(0.46, 0.5), win=(0.26, 0.3), seed: float = 0.0,
                    glass: str = '#1d2a4a', emit: float = 2.4):
    """A wall whose colour comes from the vertex colour, with a grid of windows in world space
    (front faces use x, side faces y) - some lit warm, the rest dark glass with a faint sheen."""
    m = lib.NT(name)
    pos = m.position()
    X, Y, Z = m.sep(pos)
    u = m.math('ADD', X, Y)
    cu = m.math('DIVIDE', u, cell[0])
    cz = m.math('DIVIDE', Z, cell[1])
    fu = m.math('FRACT', cu)
    fzz = m.math('FRACT', cz)
    # inside a window: |fract - 0.5| < half-size
    hu = win[0] / cell[0] / 2
    hz = win[1] / cell[1] / 2
    wu = m.math('LESS_THAN', m.math('ABSOLUTE', m.math('SUBTRACT', fu, 0.5)), hu)
    wz = m.math('LESS_THAN', m.math('ABSOLUTE', m.math('SUBTRACT', fzz, 0.5)), hz)
    nx, ny, nzn = m.sep(m.normal())
    wall_face = m.math('LESS_THAN', m.math('ABSOLUTE', nzn), 0.5)
    inwin = m.math('MULTIPLY', m.math('MULTIPLY', wu, wz), wall_face)
    # which windows are lit: white noise on the cell index
    comb = m.node('ShaderNodeCombineXYZ')
    m.link(m.math('FLOOR', cu), comb.inputs['X'])
    m.link(m.math('FLOOR', cz), comb.inputs['Y'])
    comb.inputs['Z'].default_value = seed
    wn = m.node('ShaderNodeTexWhiteNoise')
    wn.noise_dimensions = '3D'
    m.link(comb.outputs['Vector'], wn.inputs['Vector'])
    litmask = m.math('LESS_THAN', wn.outputs['Value'], lit_frac)
    warm = m.math('MULTIPLY', inwin, litmask)
    # wall: vertex colour with a little grime noise and contact occlusion
    nz = m.noise(6.0, 3, 0.55, pos)
    wall = m.mult(m.attr('col'), m.mix(nz.outputs['Fac'], col('#c9c2ba'), col('#ffffff')))
    wall = m.mult(wall, m.mix(m.ao(0.5, 8), col('#4a4c66'), col('#ffffff')))
    # a lit window varies a little in tint (warm white to amber)
    tint = m.mix(wn.outputs['Value'], col(lit), col('#fff1c9'))
    c = m.mix(inwin, wall, col(glass))
    c = m.mix(warm, c, tint)
    b = m.bsdf(c, 0.7)
    em = m.node('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
    facs = [s for s in em.inputs if s.name == 'Factor' and s.type == 'VALUE']
    cols = [s for s in em.inputs if s.type == 'RGBA']
    m.link(warm, facs[0])
    cols[0].default_value = (0, 0, 0, 1)
    m.link(tint, cols[1])
    m.link([s for s in em.outputs if s.type == 'RGBA'][0], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = emit
    return m.mat


def sky_material(name: str, stops, stars: float = 0.0, z0: float = -6.0, z1: float = 12.0):
    """Emissive backdrop gradient over world z (bottom stop at z0, top at z1), optional stars."""
    m = lib.NT(name)
    pos = m.position()
    X, Y, Z = m.sep(pos)
    fac = m.maprange(Z, z0, z1, 0.0, 1.0, smooth=False)
    c = m.ramp(fac, stops)
    if stars > 0:
        v = m.voronoi(26.0, pos)
        dist = v.outputs['Distance']
        star = m.math('LESS_THAN', dist, 0.035)
        wn = m.node('ShaderNodeTexWhiteNoise')
        m.link(v.outputs['Position'], wn.inputs['Vector'])
        keep = m.math('LESS_THAN', wn.outputs['Value'], stars)
        upper = m.maprange(Z, z0 + (z1 - z0) * 0.35, z1, 0.0, 1.0)
        s = m.math('MULTIPLY', m.math('MULTIPLY', star, keep), upper)
        c = m.mix(s, c, col('#fdfcff'))
    n = m.node('ShaderNodeEmission')
    m.link(c, n.inputs['Color'])
    n.inputs['Strength'].default_value = 1.0
    m.link(n.outputs['Emission'], m.out.inputs['Surface'])
    return m.mat


def backdrop(name: str, mat_, depth: float = 120.0, pad: float = 1.4):
    """A big plane far behind everything, filling the frame (with some overhang)."""
    w = SW / PX * pad
    z0 = fz(SH + 400, depth)
    z1 = fz(-400, depth)
    x0 = -w * 0.2
    x1 = SW / PX + w * 0.2
    verts = [(x0, depth, z0), (x1, depth, z0), (x1, depth, z1), (x0, depth, z1)]
    return lib.mesh_object(name, verts, [(0, 1, 2, 3)], smooth=False, material=mat_)


def disc(name: str, cx: float, cz: float, y: float, r: float, mat_, color: str, n: int = 48):
    verts = [(cx, y, cz)] + [(cx + math.cos(a) * r, y, cz + math.sin(a) * r) for a in (k / n * math.tau for k in range(n))]
    faces = [(0, 1 + (k + 1) % n, 1 + k) for k in range(n)]
    mb = MeshBuilder()
    mb.add(verts, faces, col(color))
    return mb.build(name, mat_, smooth=False)


def halo_material(name: str, color: str, r: float, strength: float = 1.2, falloff: float = 2.2):
    """A soft radial glow for a card of radius r centred on its object origin: emission fading out
    with transparency towards the rim."""
    m = lib.NT(name)
    tc = m.node('ShaderNodeTexCoord')
    mp = m.node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1.0 / r, 1.0 / r, 1.0 / r)
    m.link(tc.outputs['Object'], mp.inputs['Vector'])
    grad = m.node('ShaderNodeTexGradient', gradient_type='SPHERICAL')
    m.link(mp.outputs['Vector'], grad.inputs['Vector'])
    fac = m.math('POWER', grad.outputs['Fac'], falloff)
    em = m.node('ShaderNodeEmission')
    em.inputs['Color'].default_value = col(color)
    em.inputs['Strength'].default_value = strength
    tr = m.node('ShaderNodeBsdfTransparent')
    mix = m.node('ShaderNodeMixShader')
    m.link(fac, mix.inputs['Fac'])
    m.link(tr.outputs['BSDF'], mix.inputs[1])
    m.link(em.outputs['Emission'], mix.inputs[2])
    m.link(mix.outputs['Shader'], m.out.inputs['Surface'])
    return m.mat


def halo(name: str, cx: float, cz: float, y: float, r: float, color: str, strength: float = 1.0, falloff: float = 2.2):
    """A glow card of radius r centred at (cx, y, cz), facing the camera."""
    verts = [(-r, 0, -r), (r, 0, -r), (r, 0, r), (-r, 0, r)]
    ob = lib.mesh_object(name, verts, [(0, 1, 2, 3)], smooth=False, material=halo_material(name + '_m', color, r, strength, falloff))
    ob.location = (cx, y, cz)
    ob.rotation_euler = (-PITCH, 0.0, 0.0)
    return ob


# ------------------------------------------------------------------------------------------
# Geometry helpers (world units)
def box(mb: MeshBuilder, x0: float, y0: float, z0: float, x1: float, y1: float, z1: float, color: str, bevel: float = 0.0):
    """Axis-aligned box from (x0, y0, z0) to (x1, y1, z1); `bevel` rounds the vertical edges a touch."""
    if bevel <= 0:
        v, f = lib.box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0))
        mb.add(v, f, col(color))
        return
    b = bevel
    ring = [(x0 + b, y0), (x1 - b, y0), (x1, y0 + b), (x1, y1 - b), (x1 - b, y1), (x0 + b, y1), (x0, y1 - b), (x0, y0 + b)]
    n = len(ring)
    verts = [(x, y, z0) for (x, y) in ring] + [(x, y, z1) for (x, y) in ring]
    faces = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(n + k for k in range(n)))
    mb.add(verts, faces, col(color))


def cyl(mb: MeshBuilder, cx: float, cy: float, z0: float, r0: float, r1: float, h: float, color: str, sides: int = 16):
    v, f = lib.cylinder((cx, cy, z0), r0, r1, h, sides)
    mb.add(v, f, col(color))


def sphere(mb: MeshBuilder, cx: float, cy: float, cz: float, r: float, color: str, squash=(1.0, 1.0, 1.0), subdiv: int = 2):
    v, f = lib.blob((cx, cy, cz), r, squash=squash, rough=0.0, subdiv=subdiv)
    mb.add(v, f, col(color))


def building(mbs: dict, x0: float, x1: float, top: float, depth: float = 3.0, y0: float = 0.0, bottom: float = -9.0,
             wall: str = '#8a8fb0', trim: str = '#b8bdd6', deck: str = '#7a7f98', parapet: float = 0.14, ledges: bool = True):
    """A block from `bottom` up to a roof deck at `top` (world z), front face on y = y0, with a parapet
    rim and a few cornice ledges. mbs: {'wall': MeshBuilder (facade material), 'trim': .., 'deck': ..}."""
    box(mbs['wall'], x0, y0, bottom, x1, y0 + depth, top, wall)
    # roof deck slab and parapet rim
    box(mbs['deck'], x0 + 0.02, y0 + 0.02, top, x1 - 0.02, y0 + depth - 0.02, top + 0.02, deck)
    p = 0.08
    box(mbs['trim'], x0 - 0.05, y0 - 0.06, top - 0.02, x1 + 0.05, y0 + p, top + parapet, trim)
    box(mbs['trim'], x0 - 0.05, y0 + depth - p, top - 0.02, x1 + 0.05, y0 + depth + 0.03, top + parapet, trim)
    box(mbs['trim'], x0 - 0.05, y0, top - 0.02, x0 + p, y0 + depth, top + parapet, trim)
    box(mbs['trim'], x1 - p, y0, top - 0.02, x1 + 0.05, y0 + depth, top + parapet, trim)
    if ledges:
        for k in range(1, 7):
            z = top - 1.35 * k
            if z < bottom + 0.4:
                break
            box(mbs['trim'], x0 - 0.03, y0 - 0.05, z - 0.05, x1 + 0.03, y0 + 0.05, z + 0.03, trim)


def water_tower(mb_wood: MeshBuilder, mb_metal: MeshBuilder, cx: float, cy: float, z: float, s: float = 1.0):
    """A classic rooftop water tank on stilts, with a pointed cap."""
    legs = 0.55 * s
    for dx, dy in ((-0.32, -0.32), (0.32, -0.32), (0.32, 0.32), (-0.32, 0.32)):
        cyl(mb_metal, cx + dx * s, cy + dy * s, z, 0.035 * s, 0.035 * s, legs + 0.05, '#4c5266', 6)
    box(mb_metal, cx - 0.36 * s, cy - 0.36 * s, z + legs, cx + 0.36 * s, cy + 0.36 * s, z + legs + 0.05 * s, '#4c5266')
    cyl(mb_wood, cx, cy, z + legs + 0.05 * s, 0.42 * s, 0.4 * s, 0.75 * s, '#8a5a3a', 20)
    for k in range(3):
        cyl(mb_metal, cx, cy, z + legs + (0.18 + k * 0.22) * s, 0.43 * s, 0.43 * s, 0.035 * s, '#3c4152', 20)
    v, f = lib.lathe([(0.46 * s, 0.0), (0.3 * s, 0.14 * s), (0.02 * s, 0.34 * s)], 20, (cx, cy, z + legs + 0.8 * s))
    mb_metal.add(v, f, col('#5a4a44'))


def ac_unit(mb_metal: MeshBuilder, mb_dark: MeshBuilder, cx: float, cy: float, z: float, s: float = 1.0):
    box(mb_metal, cx - 0.3 * s, cy - 0.22 * s, z, cx + 0.3 * s, cy + 0.22 * s, z + 0.34 * s, '#aab2c6', bevel=0.03 * s)
    cyl(mb_dark, cx + 0.08 * s, cy - 0.225 * s, z + 0.1 * s, 0.12 * s, 0.12 * s, 0.01, '#2a3040', 16)


def antenna(mb_metal: MeshBuilder, mb_glow: MeshBuilder, cx: float, cy: float, z: float, h: float):
    cyl(mb_metal, cx, cy, z, 0.05, 0.025, h, '#5c6478', 8)
    for k in range(1, 4):
        box(mb_metal, cx - 0.18 + k * 0.03, cy - 0.01, z + h * k / 4.2, cx + 0.18 - k * 0.03, cy + 0.01, z + h * k / 4.2 + 0.02, '#5c6478')
    sphere(mb_glow, cx, cy, z + h + 0.03, 0.05, '#ff5a44', subdiv=1)


def render(path: str):
    lib.render_to(path)


def publish(src: str, name: str, quality: int = 90):
    from PIL import Image
    im = Image.open(src)
    im = im.convert('RGBA') if im.mode in ('RGBA', 'LA') else im.convert('RGB')
    im.save(os.path.join(PUB, f'scene_{name}.webp'), 'WEBP', quality=quality, method=6)
    print('wrote', f'scene_{name}.webp')


def publish_blur(name: str):
    """Half-size blurred copy for the intro card backdrop (as scripts/art/blur_backdrops.py does)."""
    from PIL import Image, ImageFilter
    im = Image.open(os.path.join(PUB, f'scene_{name}.webp')).convert('RGB')
    im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS).filter(ImageFilter.GaussianBlur(5))
    im.save(os.path.join(PUB, f'scene_{name}_blur.webp'), 'WEBP', quality=82, method=6)
    print('wrote', f'scene_{name}_blur.webp')


def rnd(seed: int) -> random.Random:
    return random.Random(seed)
