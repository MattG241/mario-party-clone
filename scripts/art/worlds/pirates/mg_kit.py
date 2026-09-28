"""Pirate Cove minigame art kit: materials and props shared by the three arena scripts and the sprites.

    mg_deck.py      Stretch & Snatch   a pirate ship's main deck round a feast table (ortho, 50 deg)
    mg_harbour.py   Triple Slash       a harbour of four cargo jetties and a moored ship (perspective)
    mg_stormbay.py  Storm Navigator    a stormy bay ringed with rocks and a lighthouse (ortho, 55 deg)
    mg_sprites.py   the three games' sprite atlases (food, cook, gulls, barrels, fish, bombs, boats...)

Everything is modelled in code and original: no flags, emblems or signs from any show. Builders take
world coordinates (Blender units, Z up) unless a name says board / screen px; the ortho scenes convert
screen px with lib.board_to_world (1 unit = 100 px across the screen).
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

ART = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ART not in sys.path:
    sys.path.insert(0, ART)

import lib  # noqa: E402
import mg_dress as dress  # noqa: E402
import props  # noqa: E402
from lib import MeshBuilder, col  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

SW, SH = 1920, 1080
PUB = os.path.join(lib.ROOT, 'public', 'assets', 'rendered')
LITE = os.path.join(lib.ROOT, 'public', 'assets', 'lite')
OUT = os.path.join(lib.ROOT, 'art-out', 'pirates')
os.makedirs(OUT, exist_ok=True)

# Player colours (src/game/constants.ts) for bunting and pennants.
PLAYER = ['#22c3d6', '#ff6b5e', '#8bd346', '#ffb020']
FESTIVE = ['#ff6b5e', '#f4b83b', '#1fa5a0', '#8e5cd9', '#5ce1ff', '#6cc24a']
CREAM = '#fff4dc'


def parse(choices=None):
    p = argparse.ArgumentParser()
    if choices:
        p.add_argument('what', choices=choices)
    p.add_argument('--preview', action='store_true')
    p.add_argument('--scale', type=float, default=0.0)
    p.add_argument('--samples', type=int, default=0)
    p.add_argument('--only', default='')
    p.add_argument('--dry', action='store_true', help='build the scene, skip the render')
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    return p.parse_args(argv)


def set_view(elev_deg: float) -> None:
    lib.BETA = math.radians(90 - elev_deg)
    lib.COSB, lib.SINB = math.cos(lib.BETA), math.sin(lib.BETA)


def start(samples: int) -> None:
    lib.reset(samples)
    dress.threads()
    dress.reset_mats()
    _M.clear()


def bw(bx: float, by: float, z: float = 0.0) -> Vector:
    """Screen px on the ground -> world (ortho scenes)."""
    return lib.board_to_world(bx, by, z)


# ------------------------------------------------------------------------------------------
# Materials
_M: dict = {}


def m() -> dict:
    """Kit materials, made on first use after each start() (the factory reset clears them)."""
    if not _M:
        _M['planks'] = plank_material('pc_planks')
        _M['planks_dark'] = plank_material('pc_planks_dark', light='#a8744a', dark='#7c5132', seam='#3a2416')
        _M['rock'] = rock_material('pc_rock')
        _M['rope'] = lib.attr_mat('pc_rope', rough=0.9, ao=0.3)
        _M['iron'] = iron_material('pc_iron')
        _M['sail'] = lib.attr_mat('pc_sail', rough=0.85, sheen=0.4, ao=0.25)
        _M['glossy'] = dress.mats()['gloss']
        _M['cloth'] = dress.mats()['cloth']
        _M['leaf'] = dress.mats()['leaf']
    return _M


def P() -> dict:
    return props.mats()


def plank_material(name, light='#c99462', dark='#a8764b', seam='#4a2e1c', plank_w=0.34, plank_l=3.2, along='x', grain=0.18):
    """Deck planks: staggered boards with dark seams, per-board tint, grain streaks and contact AO."""
    mt = lib.NT(name)
    pos = mt.position()
    X, Y, Z = mt.sep(pos)
    comb = mt.node('ShaderNodeCombineXYZ')
    if along == 'x':
        mt.link(X, comb.inputs['X'])
        mt.link(Y, comb.inputs['Y'])
    else:
        mt.link(Y, comb.inputs['X'])
        mt.link(X, comb.inputs['Y'])
    br = mt.node('ShaderNodeTexBrick')
    br.offset = 0.5
    br.offset_frequency = 2
    br.squash = 1.0
    br.inputs['Scale'].default_value = 1.0
    br.inputs['Brick Width'].default_value = plank_l
    br.inputs['Row Height'].default_value = plank_w
    br.inputs['Mortar Size'].default_value = 0.012
    br.inputs['Mortar Smooth'].default_value = 0.2
    br.inputs['Bias'].default_value = 0.0
    br.inputs['Color1'].default_value = col(light)
    br.inputs['Color2'].default_value = col(dark)
    br.inputs['Mortar'].default_value = col(seam)
    mt.link(comb.outputs['Vector'], br.inputs['Vector'])
    # grain: long thin streaks along the boards
    st = mt.node('ShaderNodeVectorMath', operation='MULTIPLY')
    mt.link(comb.outputs['Vector'], st.inputs[0])
    st.inputs[1].default_value = (0.6, 14.0, 1.0)
    gn = mt.noise(1.0, 4.0, 0.6, st.outputs['Vector'])
    grain_c = mt.mix(mt.maprange(gn.outputs['Fac'], 0.35, 0.7), col('#e8d6c0'), col('#ffffff'))
    c = mt.mult(br.outputs['Color'], grain_c, grain * 4)
    # broad weathering drift
    wn = mt.noise(0.35, 3.0, 0.5, pos)
    c = mt.mult(c, mt.mix(wn.outputs['Fac'], col('#d8c8b4'), col('#ffffff')))
    c = mt.mult(c, mt.mix(mt.ao(0.45, 8), col('#6a5a5c'), col('#ffffff')))
    mt.bsdf(c, 0.7, normal=mt.bump(br.outputs['Fac'], 0.35, 0.02))
    return mt.mat


def rock_material(name):
    """Chunky cartoon rock: vertex tint x broad noise, dark crevices, top faces a touch lighter."""
    mt = lib.NT(name)
    pos = mt.position()
    n1 = mt.noise(1.1, 4.0, 0.62, pos)
    n2 = mt.noise(5.0, 2.0, 0.5, pos)
    c = mt.mult(mt.attr('col'), mt.mix(n1.outputs['Fac'], col('#b8b0a8'), col('#ffffff')))
    nz = mt.sep(mt.normal())[2]
    c = mt.mix(mt.math('MULTIPLY', mt.maprange(nz, 0.55, 0.95), 0.25), c, col('#f3ead8'))
    c = mt.mult(c, mt.mix(mt.ao(0.6, 8), col('#4c4458'), col('#ffffff')))
    mt.bsdf(c, 0.86, normal=mt.bump(mt.math('ADD', n1.outputs['Fac'], mt.math('MULTIPLY', n2.outputs['Fac'], 0.4)), 0.45, 0.08))
    return mt.mat


def iron_material(name):
    mt = lib.NT(name)
    c = mt.mult(mt.attr('col'), mt.mix(mt.ao(0.3, 6), col('#5a5a66'), col('#ffffff')))
    b = mt.bsdf(c, 0.38, coat=0.25)
    b.inputs['Metallic'].default_value = 0.85
    return mt.mat


def sea_material(name, deep='#12688f', mid='#1e8fb8', light='#46c0dc', foam='#e8fbff', foam_amt=1.0, wave_scale=0.22, rough=0.12, emit=0.0,
                 net=1.0, streaks=0.0, streak_dir=(1.0, 3.2)):
    """Stylised sea: broad swells in a deep-to-light ramp, an optional net of thin foam lines (`net`),
    wind-stretched whitecap streaks (`streaks`, long along the first axis of `streak_dir`) and flecks,
    glossy so the key light glints off it. World-space, so it tiles across any plane size."""
    mt = lib.NT(name)
    pos = mt.position()
    sc = mt.node('ShaderNodeVectorMath', operation='MULTIPLY')
    mt.link(pos, sc.inputs[0])
    sc.inputs[1].default_value = (1.0, 1.35, 1.0)
    v = sc.outputs['Vector']
    sw = mt.noise(wave_scale, 3.0, 0.55, v, dist=0.6)
    base = mt.ramp(sw.outputs['Fac'], [(0.3, deep), (0.52, mid), (0.72, light)])
    foam_f = mt.val(0.0)
    if net > 0:
        dn = mt.noise(0.8, 2.0, 0.5, v)
        warp = mt.node('ShaderNodeVectorMath', operation='ADD')
        mt.link(v, warp.inputs[0])
        mt.link(dn.outputs['Color'], warp.inputs[1])
        vo = mt.node('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE')
        vo.inputs['Scale'].default_value = 0.9
        mt.link(warp.outputs['Vector'], vo.inputs['Vector'])
        lines = mt.maprange(vo.outputs['Distance'], 0.045, 0.0)
        patch = mt.maprange(mt.noise(0.45, 2.0, 0.5, v).outputs['Fac'], 0.42, 0.62)
        foam_f = mt.math('MULTIPLY', mt.math('MULTIPLY', lines, patch), 0.75 * foam_amt * net)
    if streaks > 0:
        st = mt.node('ShaderNodeVectorMath', operation='MULTIPLY')
        mt.link(pos, st.inputs[0])
        st.inputs[1].default_value = (streak_dir[0], streak_dir[1], 1.0)
        sn = mt.noise(0.9, 4.0, 0.6, st.outputs['Vector'], dist=0.8)
        crest = mt.maprange(sn.outputs['Fac'], 0.6, 0.72)
        gate = mt.maprange(mt.noise(0.3, 2.0, 0.5, v).outputs['Fac'], 0.4, 0.6)
        foam_f = mt.math('ADD', foam_f, mt.math('MULTIPLY', mt.math('MULTIPLY', crest, gate), 0.85 * streaks), clamp=True)
    flecks = mt.voronoi(3.2, v)
    fl = mt.math('MULTIPLY', mt.maprange(flecks.outputs['Distance'], 0.09, 0.03), mt.maprange(mt.noise(1.4, 2.0, 0.5, v).outputs['Fac'], 0.6, 0.72))
    foam_f = mt.math('ADD', foam_f, mt.math('MULTIPLY', fl, 0.6 * foam_amt), clamp=True)
    c = mt.mix(foam_f, base, col(foam))
    bump_h = mt.math('ADD', sw.outputs['Fac'], mt.math('MULTIPLY', foam_f, 0.3))
    mt.bsdf(c, rough, normal=mt.bump(bump_h, 0.25, 0.3), coat=0.6, spec=0.6, emission=c if emit else None, emission_strength=emit)
    return mt.mat


def hull_material(name):
    """Painted ship's planking: vertex colour x thin horizontal plank seams x contact AO."""
    mt = lib.NT(name)
    pos = mt.position()
    wv = mt.node('ShaderNodeTexWave')
    wv.wave_type = 'BANDS'
    wv.bands_direction = 'Z'
    wv.inputs['Scale'].default_value = 1.6
    wv.inputs['Distortion'].default_value = 0.0
    mt.link(pos, wv.inputs['Vector'])
    seam = mt.maprange(wv.outputs['Fac'], 0.02, 0.1)
    c = mt.mult(mt.attr('col'), mt.mix(seam, col('#6a4a3a'), col('#ffffff')))
    n = mt.noise(1.5, 3.0, 0.5, pos)
    c = mt.mult(c, mt.mix(n.outputs['Fac'], col('#d8ccc0'), col('#ffffff')))
    c = mt.mult(c, mt.mix(mt.ao(0.5, 8), col('#5a4a50'), col('#ffffff')))
    mt.bsdf(c, 0.6, normal=mt.bump(seam, 0.25, 0.02))
    return mt.mat


def emissive_mat(name, color, strength=3.0):
    mt = lib.NT(name)
    mt.bsdf(col(color), 0.3, emission=col(color), emission_strength=strength)
    return mt.mat


def image_material(name, img_path, rough=0.6):
    """A flat plane showing an image across its UVs (generated textures: table inlays, signs)."""
    mt = lib.NT(name)
    tc = mt.node('ShaderNodeTexCoord')
    img = mt.node('ShaderNodeTexImage')
    img.image = bpy.data.images.load(img_path)
    img.interpolation = 'Cubic'
    img.extension = 'EXTEND'
    mt.link(tc.outputs['UV'], img.inputs['Vector'])
    c = mt.mult(img.outputs['Color'], mt.mix(mt.ao(0.4, 6), col('#6a5a5c'), col('#ffffff')))
    mt.bsdf(c, rough)
    return mt.mat


# ------------------------------------------------------------------------------------------
# Geometry helpers
def disc_uv_object(name, center, radius, mat, sides=96):
    """A flat disc with planar UVs (0..1 across its bounding square) for image materials."""
    cx, cy, cz = center
    verts = [(cx, cy, cz)]
    for k in range(sides):
        a = k / sides * math.tau
        verts.append((cx + math.cos(a) * radius, cy + math.sin(a) * radius, cz))
    faces = [(0, 1 + k, 1 + (k + 1) % sides) for k in range(sides)]
    ob = lib.mesh_object(name, verts, faces, smooth=False, material=mat)
    me = ob.data
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            x, y, _ = verts[vi]
            uv.data[li].uv = (0.5 + (x - cx) / (2 * radius), 0.5 + (y - cy) / (2 * radius))
    return ob


def plane(name, x0, y0, x1, y1, z, mat):
    return lib.mesh_object(name, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [(0, 1, 2, 3)], smooth=False, material=mat)


def barrel(mb_wood, mb_metal, x, y, z, r=0.34, h=0.86, rot=(0.0, 0.0, 0.0), tint='#a86e3e', hoop='#5d5f68', staves=14):
    """Coopered barrel: bulging staves with alternating tints, two iron hoops near each end, a lid."""
    prof = [(r * 0.84, 0.0), (r * 0.95, h * 0.18), (r, h * 0.5), (r * 0.95, h * 0.82), (r * 0.84, h)]
    v, f = lib.lathe(prof, staves * 2, (0, 0, 0), cap_bottom=True, cap_top=True)
    base = col(tint)
    lite = lib.lerp_col(base, col('#ffffff'), 0.12)
    dark = lib.lerp_col(base, col('#000000'), 0.12)

    def stave(vv):
        a = math.atan2(vv[1], vv[0])
        k = int((a + math.pi) / math.tau * staves) % staves
        return lite if k % 3 == 0 else dark if k % 3 == 1 else base
    v = lib.transform(v, loc=(x, y, z), rot=rot)
    mb_wood.add(v, f, stave)
    for zz in (0.12, 0.26, 0.74, 0.88):
        rr = r * (0.95 + 0.05 * math.sin(zz * math.pi)) + 0.012
        hv, hf = lib.lathe([(rr, h * zz - 0.025), (rr + 0.012, h * zz), (rr, h * zz + 0.025)], staves * 2, (0, 0, 0), cap_bottom=False, cap_top=False)
        mb_metal.add(lib.transform(hv, loc=(x, y, z), rot=rot), hf, col(hoop))


def crate(mb, x, y, z, s=0.8, rot=0.0, tint='#b8834e', frame='#8d5c33'):
    """Plank crate: a box with a raised board frame round every face and a diagonal brace."""
    v, f = lib.box((x, y, z + s / 2), (s, s, s), rot_z=rot)
    mb.add(v, f, col(tint))
    t = s * 0.1
    c, sn = math.cos(rot), math.sin(rot)

    def place(lx, ly, lz, sx, sy, sz):
        vv, ff = lib.box((0, 0, 0), (sx, sy, sz))
        vv = [(x + (px + lx) * c - (py + ly) * sn, y + (px + lx) * sn + (py + ly) * c, z + pz + lz) for (px, py, pz) in vv]
        mb.add(vv, ff, col(frame))
    e = s / 2 + t * 0.2
    for sgn in (-1, 1):
        # vertical corner posts and top/bottom rails on the four faces
        for sgn2 in (-1, 1):
            place(sgn * (s / 2 - t / 2 + 0.005), sgn2 * (s / 2 - t / 2 + 0.005), s / 2, t * 1.1, t * 1.1, s)
        place(0, sgn * e, t / 2, s, t * 0.4, t)
        place(0, sgn * e, s - t / 2, s, t * 0.4, t)
        place(sgn * e, 0, t / 2, t * 0.4, s, t)
        place(sgn * e, 0, s - t / 2, t * 0.4, s, t)
    # lid boards
    for k in range(3):
        place(0, (k - 1) * s * 0.3, s + 0.01, s * 0.96, s * 0.26, 0.03)


def rope_coil(mb, x, y, z, r=0.32, turns=4, thick=0.05, tint='#d9b277'):
    pts = []
    n = turns * 20
    for i in range(n + 1):
        t = i / n
        a = t * turns * math.tau
        rr = r * (0.45 + 0.55 * (1 - t * 0.2))
        rr = r - (i // 20) * thick * 1.9
        pts.append((x + math.cos(a) * rr, y + math.sin(a) * rr, z + thick + (i % 20 == 0) * 0.0))
    v, f = lib.tube(pts, thick, 6)
    mb.add(v, f, col(tint))


def cannon(mb_iron, mb_wood, x, y, z, rot=0.0, s=1.0):
    """Ship's cannon on a wooden carriage, barrel pointing along +X rotated by rot (radians about Z)."""
    c, sn = math.cos(rot), math.sin(rot)

    def T(v):
        return [(x + (px * c - py * sn) * s, y + (px * sn + py * c) * s, z + pz * s) for (px, py, pz) in v]
    cv, cf = lib.box((0, 0, 0.22), (1.0, 0.62, 0.3))
    mb_wood.add(T(cv), cf, col('#7a4b2a'))
    cv, cf = lib.box((-0.28, 0, 0.44), (0.4, 0.62, 0.2))
    mb_wood.add(T(cv), cf, col('#6a4024'))
    for (wx, wy) in [(-0.34, 0.33), (0.34, 0.33), (-0.34, -0.33), (0.34, -0.33)]:
        wv, wf = lib.cylinder((0, 0, -0.05), 0.15, 0.15, 0.1, 12)
        wv = [(px + wx, pz + wy, py + 0.15) for (px, py, pz) in wv]
        mb_wood.add(T(wv), wf, col('#5a3620'))
    prof = [(0.0, -0.62), (0.2, -0.6), (0.24, -0.5), (0.22, -0.35), (0.19, 0.0), (0.17, 0.6), (0.2, 0.66), (0.2, 0.72), (0.12, 0.72), (0.12, 0.5)]
    bv, bf = lib.lathe(prof, 18, (0, 0, 0), cap_bottom=False, cap_top=False)
    bv = [(pz, py, px) for (px, py, pz) in bv]  # lathe axis Z -> X
    bv = [(px + 0.05, py, pz + 0.55) for (px, py, pz) in bv]
    mb_iron.add(T(bv), bf, col('#3e4048'))


def cannonballs(mb_iron, x, y, z, r=0.13):
    for (dx, dy, dz) in [(-1, -1, 0), (1, -1, 0), (-1, 1, 0), (1, 1, 0), (0, 0, 1.4)]:
        v, f = lib.blob((x + dx * r, y + dy * r, z + r + dz * r), r, rough=0.0, subdiv=2)
        mb_iron.add(v, f, col('#34363d'))


def rail_run(mb, pts, h=0.9, post_every=0.9, post=0.1, top=0.12, tint='#8a5a34', top_tint='#a8703f'):
    """Ship's rail through world points [(x, y, z)]: square posts under a chunky capping rail."""
    for a, b in zip(pts, pts[1:]):
        a, b = Vector(a), Vector(b)
        L = (b - a).length
        n = max(1, int(L / post_every))
        ang = math.atan2(b.y - a.y, b.x - a.x)
        for k in range(n + 1):
            q = a + (b - a) * (k / n)
            v, f = lib.box((q.x, q.y, q.z + h / 2), (post, post, h), rot_z=ang)
            mb.add(v, f, col(tint))
        mid = (a + b) / 2
        v, f = lib.box((mid.x, mid.y, mid.z + h + top / 2), (L + top, top * 1.4, top), rot_z=ang)
        mb.add(v, f, col(top_tint))
        v, f = lib.box((mid.x, mid.y, mid.z + h * 0.45), (L, 0.05, 0.07), rot_z=ang)
        mb.add(v, f, col(tint))


def lantern(mb_iron, mb_glow, x, y, z, s=1.0):
    """Hanging ship's lantern (glow glass in an iron cage), its top at z."""
    v, f = lib.lathe([(0.0, 0.0), (0.1 * s, 0.03 * s), (0.12 * s, 0.2 * s), (0.08 * s, 0.28 * s), (0.0, 0.3 * s)], 10, (x, y, z - 0.34 * s))
    mb_glow.add(v, f, col('#ffc76a'))
    v, f = lib.lathe([(0.13 * s, 0.0), (0.02 * s, 0.1 * s)], 10, (x, y, z - 0.06 * s), cap_bottom=True, cap_top=True)
    mb_iron.add(v, f, col('#2f2b2c'))
    v, f = lib.lathe([(0.11 * s, 0.0), (0.11 * s, 0.03 * s)], 10, (x, y, z - 0.37 * s))
    mb_iron.add(v, f, col('#2f2b2c'))
    for k in range(4):
        a = k / 4 * math.tau + 0.4
        v, f = lib.tube([(x + math.cos(a) * 0.115 * s, y + math.sin(a) * 0.115 * s, z - 0.36 * s), (x + math.cos(a) * 0.115 * s, y + math.sin(a) * 0.115 * s, z - 0.06 * s)], 0.008 * s, 4)
        mb_iron.add(v, f, col('#2f2b2c'))


def rock(mb, x, y, z, r, seed=0, squash=(1.0, 1.0, 0.7), tint='#8d8576', rough=0.32):
    v, f = lib.blob((x, y, z), r, squash=squash, rough=rough, freq=1.3, subdiv=3, seed=seed)
    mb.add(v, f, col(tint))


def palm(mb_leaf, mb_wood, x, y, z, s=1.0, lean=(0.3, 0.0), fronds=8, seed=0, windswept=0.0):
    """Cartoon palm: a curved, ringed trunk and a crown of arching fronds (windswept bends them one way)."""
    rnd = random.Random(seed)
    H = 3.0 * s
    pts = []
    for i in range(13):
        t = i / 12
        pts.append((x + lean[0] * H * t * t, y + lean[1] * H * t * t, z + H * t))
    v, f = lib.tube(pts, lambda t: (0.16 - 0.06 * t) * s, 10)
    mb_wood.add(v, f, lambda vv: col('#9b7048') if int((vv[2] - z) / (0.22 * s)) % 2 else col('#7f5a38'))
    top = Vector(pts[-1])
    for k in range(fronds):
        a = k / fronds * math.tau + rnd.uniform(-0.2, 0.2)
        d = Vector((math.cos(a), math.sin(a), 0.0))
        if windswept:
            d = (d + Vector((windswept, 0.0, 0.0))).normalized()
        L = rnd.uniform(1.3, 1.7) * s
        spine = []
        for i in range(9):
            t = i / 8
            spine.append(top + d * (L * t) + Vector((0, 0, 0.35 * s * math.sin(t * math.pi * 0.8) - 0.55 * s * t * t)))
        verts, faces = [], []
        side = d.cross(Vector((0, 0, 1))).normalized()
        for i, q in enumerate(spine):
            t = i / 8
            w = 0.34 * s * math.sin(min(1.0, t * 1.3) * math.pi) + 0.02
            droop = Vector((0, 0, -0.12 * s * t))
            verts += [tuple(q + side * w + droop), tuple(q), tuple(q - side * w + droop)]
        for i in range(8):
            a0 = i * 3
            faces += [(a0, a0 + 3, a0 + 4, a0 + 1), (a0 + 1, a0 + 4, a0 + 5, a0 + 2)]
        mb_leaf.add(verts, faces, col(rnd.choice(['#3f9a3a', '#4cab3f', '#378a34'])))
    for k in range(3):
        a = k / 3 * math.tau
        v, f = lib.blob((top.x + math.cos(a) * 0.1 * s, top.y + math.sin(a) * 0.1 * s, top.z - 0.12 * s), 0.1 * s, rough=0.0, subdiv=1)
        mb_wood.add(v, f, col('#6b4a2a'))


def lighthouse(PR, x, y, z, s=1.0, bands=('#f4f0e6', '#e0483e')):
    """Striped lighthouse: tapered tower in red and white bands, a gallery rail, a glowing lamp room and
    a dark cap. PR is a props.Prop (paint, metal, glow, wood builders)."""
    H = 3.6 * s
    prof = [(0.62 * s, 0.0), (0.5 * s, H)]
    v, f = lib.lathe([(0.62 * s, 0.0), (0.56 * s, H * 0.5), (0.5 * s, H)], 24, (x, y, z), cap_bottom=False, cap_top=True)
    PR.b['paint'].add(v, f, lambda vv: col(bands[int((vv[2] - z) / (H / 5)) % 2]))
    del prof
    v, f = lib.cylinder((x, y, z + H), 0.66 * s, 0.66 * s, 0.1 * s, 24)
    PR.b['paint'].add(v, f, col('#3a3d48'))
    for k in range(16):
        a = k / 16 * math.tau
        v, f = lib.tube([(x + math.cos(a) * 0.64 * s, y + math.sin(a) * 0.64 * s, z + H + 0.1 * s), (x + math.cos(a) * 0.64 * s, y + math.sin(a) * 0.64 * s, z + H + 0.36 * s)], 0.015 * s, 4)
        PR.b['metal'].add(v, f, col('#3a3d48'))
    v, f = lib.lathe([(0.66 * s, 0.0), (0.66 * s, 0.03 * s)], 24, (x, y, z + H + 0.36 * s))
    PR.b['metal'].add(v, f, col('#3a3d48'))
    v, f = lib.cylinder((x, y, z + H + 0.1 * s), 0.34 * s, 0.34 * s, 0.55 * s, 16)
    PR.b['glow'].add(v, f, col('#ffe7a0'))
    v, f = lib.lathe([(0.44 * s, 0.0), (0.12 * s, 0.4 * s), (0.0, 0.46 * s)], 16, (x, y, z + H + 0.65 * s), cap_bottom=True, cap_top=False)
    PR.b['paint'].add(v, f, col('#c23a33'))
    v, f = lib.blob((x, y, z + H + 1.15 * s), 0.07 * s, rough=0.0, subdiv=1)
    PR.b['metal'].add(v, f, col('#f2c14e'))
    # door and windows
    v, f = lib.box((x, y - 0.6 * s, z + 0.4 * s), (0.36 * s, 0.08 * s, 0.7 * s))
    PR.b['wood'].add(v, f, col('#5e3b22'))
    for zz in (1.5, 2.6):
        v, f = lib.box((x, y - 0.54 * s, z + zz * s), (0.18 * s, 0.06 * s, 0.26 * s))
        PR.b['glow'].add(v, f, col('#ffd27a'))


def pennant_line(a, b, n=10, sag=0.25, size=0.28, colors=None, name='pennants'):
    """A sagging line of triangular pennants between two world points."""
    colors = colors or FESTIVE
    wire, cloth = MeshBuilder(), MeshBuilder()
    a, b = Vector(a), Vector(b)
    pts = []
    for i in range(21):
        t = i / 20
        q = a + (b - a) * t
        pts.append((q.x, q.y, q.z - math.sin(t * math.pi) * sag))
    v, f = lib.tube(pts, 0.012, 4)
    wire.add(v, f, col('#3a2e2a'))
    d = (b - a).normalized()
    for k in range(n):
        t0, t1 = (k + 0.15) / n, (k + 0.85) / n
        q0 = a + (b - a) * t0
        q1 = a + (b - a) * t1
        z0 = q0.z - math.sin(t0 * math.pi) * sag
        z1 = q1.z - math.sin(t1 * math.pi) * sag
        tm = (t0 + t1) / 2
        qm = a + (b - a) * tm
        zm = qm.z - math.sin(tm * math.pi) * sag - size
        verts = [(q0.x, q0.y, z0), (q1.x, q1.y, z1), (qm.x, qm.y, zm)]
        cloth.add(verts, [(0, 1, 2)], col(colors[k % len(colors)]))
        del d
        d = (b - a).normalized()
    wire.build(name + '_wire', P()['wood'])
    cl = cloth.build(name + '_cloth', m()['cloth'])
    return cl


def sail_panel(mb, corners, bulge=0.3, rows=6, cols=8, tint=CREAM, stripe=None, stripe_rows=(2, 3), normal=None):
    """A billowing square sail between four world corners (top-left, top-right, bottom-right,
    bottom-left), bellied out by `bulge` along `normal` (default: the panel's own normal)."""
    tl, tr, br, bl = (Vector(c) for c in corners)
    if normal is None:
        normal = (tr - tl).cross(bl - tl).normalized()
    verts, faces, colors = [], [], []
    for r in range(rows + 1):
        v = r / rows
        left = tl + (bl - tl) * v
        right = tr + (br - tr) * v
        for c in range(cols + 1):
            u = c / cols
            q = left + (right - left) * u
            belly = math.sin(u * math.pi) * math.sin(min(1.0, v * 1.1) * math.pi * 0.85 + 0.25) * bulge
            q = q + normal * belly
            verts.append(tuple(q))
            colors.append(col(stripe) if stripe and stripe_rows[0] <= r < stripe_rows[1] else col(tint))
    for r in range(rows):
        for c in range(cols):
            a = r * (cols + 1) + c
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    base = len(mb.v)
    mb.v.extend(verts)
    mb.f.extend([tuple(i + base for i in fc) for fc in faces])
    mb.c.extend(colors)


def mast(PR, sails, x, y, z0, h=7.0, r=0.16, yards=(), furled=True, nest=True):
    """A mast with a crow's nest and yards. yards: [(z, half_len)]; furled sails roll on each yard,
    otherwise square sails hang beneath (added to `sails`, a MeshBuilder with the sail material)."""
    v, f = lib.cylinder((x, y, z0), r, r * 0.7, h, 12)
    PR.b['wood'].add(v, f, col('#7b4f2e'))
    if nest:
        zn = z0 + h * 0.78
        v, f = lib.cylinder((x, y, zn), 0.5, 0.56, 0.32, 16, cap=True)
        PR.b['wood'].add(v, f, col('#8a5a34'))
    for i, (zz, half) in enumerate(yards):
        zz = z0 + zz
        v, f = lib.tube([(x - half, y, zz), (x + half, y, zz)], 0.07, 8)
        PR.b['wood'].add(v, f, col('#6b4428'))
        if furled:
            v, f = lib.tube([(x - half * 0.92, y - 0.05, zz - 0.1), (x + half * 0.92, y - 0.05, zz - 0.1)], lambda t: 0.13 * (0.6 + 0.4 * math.sin(t * math.pi)), 10)
            sails.add(v, f, col('#f1e6cf'))
        else:
            nxt = yards[i + 1][0] + z0 if i + 1 < len(yards) else z0 + 1.2
            drop = min(zz - nxt - 0.15, 2.6) if i + 1 < len(yards) else 2.2
            sail_panel(sails, [(x - half, y - 0.05, zz - 0.08), (x + half, y - 0.05, zz - 0.08), (x + half * 0.95, y - 0.05, zz - drop), (x - half * 0.95, y - 0.05, zz - drop)],
                       bulge=0.45, tint='#f4ead4', stripe='#e0483e' if i == 0 else None, stripe_rows=(2, 3), normal=Vector((0, -1, 0)))
    v, f = lib.blob((x, y, z0 + h + 0.05), 0.12, rough=0.0, subdiv=1)
    PR.b['metal'].add(v, f, col('#f2c14e'))


def rope_line(mb, a, b, sag=0.15, thick=0.018, tint='#6a5238'):
    a, b = Vector(a), Vector(b)
    pts = []
    for i in range(13):
        t = i / 12
        q = a + (b - a) * t
        pts.append((q.x, q.y, q.z - math.sin(t * math.pi) * sag))
    v, f = lib.tube(pts, thick, 4)
    mb.add(v, f, col(tint))


def clouds(mb, center, size, puffs=9, flat=0.5, seed=0):
    dress.cloud_puffs(mb, center, size, puffs=puffs, flat=flat, seed=seed)


def publish_webp(src_png, name, quality=90):
    """Write public/assets/rendered/scene_<name>.webp (then: python3 scripts/build-lite.py --image
    scene_<name>.webp for the Lite copy)."""
    from PIL import Image
    im = Image.open(src_png).convert('RGBA')
    if im.size != (SW, SH):
        im = im.resize((SW, SH), Image.LANCZOS)
    opaque = im.getextrema()[3][0] == 255
    out = im.convert('RGB') if opaque else im
    out.save(os.path.join(PUB, f'scene_{name}.webp'), 'WEBP', quality=quality, method=6)
    print('wrote', f'scene_{name}.webp')


# ------------------------------------------------------------------------------------------
# Generated textures (PIL)
def table_texture(path, size=1024):
    """The feast table's top, seen straight down: parallel planks with seams and grain, a painted
    compass-rose inlay (an original eight-point star) in the middle, a dark inlay ring and a brass
    rim with studs. The disc fills the square (radius size/2 - 4)."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter
    S = size
    c = S / 2
    R = S / 2 - 4
    rnd = random.Random(7)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    # planks run top to bottom
    pw = S / 9.0
    idx = np.floor(xx / pw)
    tints = np.array([rnd.uniform(0.9, 1.08) for _ in range(12)], np.float32)
    base = np.array([196, 142, 92], np.float32)
    arr = base[None, None, :] * tints[idx.astype(int) % 12][..., None]
    noise = np.asarray(Image.effect_noise((S // 8, S // 2), 60).resize((S, S), Image.BICUBIC), np.float32) / 255.0
    grain = np.asarray(Image.effect_noise((S // 2, S // 32), 70).resize((S, S), Image.BICUBIC), np.float32) / 255.0
    arr *= (0.9 + 0.16 * noise)[..., None]
    arr *= (0.94 + 0.1 * grain)[..., None]
    seam = np.abs(xx - (idx + 0.5) * pw) > pw / 2 - 2.2
    arr[seam] *= 0.55
    # board ends, staggered
    for k in range(10):
        x0 = int(k * pw)
        yb = int(((k * 0.37) % 1) * S)
        arr[max(0, yb - 1):yb + 2, x0:int(x0 + pw)] *= 0.6
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert('RGBA')
    d = ImageDraw.Draw(im)
    # dark inlay ring and the compass rose
    rin = R * 0.36
    d.ellipse([c - rin - 18, c - rin - 18, c + rin + 18, c + rin + 18], fill=(92, 58, 36, 255))
    d.ellipse([c - rin, c - rin, c + rin, c + rin], fill=(238, 222, 190, 255))
    d.ellipse([c - rin + 10, c - rin + 10, c + rin - 10, c + rin - 10], outline=(64, 128, 132, 255), width=6)
    for k in range(32):
        a = k / 32 * math.tau
        r0 = rin - (30 if k % 4 == 0 else 20)
        d.line([(c + math.cos(a) * r0, c + math.sin(a) * r0), (c + math.cos(a) * (rin - 12), c + math.sin(a) * (rin - 12))], fill=(64, 58, 70, 255), width=4 if k % 4 == 0 else 2)

    def star(n_pts, r_long, r_short, rot, fill_a, fill_b):
        for k in range(n_pts):
            a = rot + k / n_pts * math.tau
            a1 = a + math.pi / n_pts
            a0 = a - math.pi / n_pts
            tip = (c + math.cos(a) * r_long, c + math.sin(a) * r_long)
            left = (c + math.cos(a0) * r_short, c + math.sin(a0) * r_short)
            right = (c + math.cos(a1) * r_short, c + math.sin(a1) * r_short)
            d.polygon([(c, c), left, tip], fill=fill_a)
            d.polygon([(c, c), tip, right], fill=fill_b)
    star(4, rin * 0.62, rin * 0.16, math.pi / 4, (40, 130, 138, 255), (24, 92, 100, 255))
    star(4, rin * 0.86, rin * 0.18, 0.0, (232, 76, 64, 255), (176, 44, 40, 255))
    d.ellipse([c - 22, c - 22, c + 22, c + 22], fill=(242, 193, 78, 255), outline=(150, 100, 30, 255), width=4)
    # brass rim with studs
    d.ellipse([c - R, c - R, c + R, c + R], outline=(200, 150, 60, 255), width=int(S * 0.022))
    d.ellipse([c - R + S * 0.022, c - R + S * 0.022, c + R - S * 0.022, c + R - S * 0.022], outline=(110, 74, 40, 255), width=3)
    for k in range(40):
        a = k / 40 * math.tau
        rr = R - S * 0.011
        x, y = c + math.cos(a) * rr, c + math.sin(a) * rr
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(255, 226, 140, 255))
    # cut to the disc with a soft edge
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).ellipse([c - R, c - R, c + R, c + R], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))
    im.putalpha(mask)
    im.save(path)
    return path


def vortex_texture(path, size=512, dark=(18, 52, 70), light=(120, 200, 215)):
    """A whirlpool seen from above: spiral arms of foam over a darkening funnel (alpha fades at the rim)."""
    import numpy as np
    from PIL import Image
    S = size
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    dx, dy = (xx - S / 2) / (S / 2), (yy - S / 2) / (S / 2)
    r = np.sqrt(dx * dx + dy * dy) + 1e-6
    a = np.arctan2(dy, dx)
    spiral = np.sin(a * 3 + np.log(r) * 7.0)
    arms = np.clip((spiral - 0.35) * 2.2, 0, 1) * np.clip(r * 1.4, 0, 1)
    depth = np.clip(1 - r, 0, 1) ** 1.6
    col_ = np.zeros((S, S, 4), np.float32)
    for i in range(3):
        base = light[i] * (1 - depth) + dark[i] * depth
        col_[..., i] = base * (1 - 0.55 * depth) + (255 - base) * arms * 0.8
    alpha = np.clip((1 - r) * 3.0, 0, 1) * 255
    col_[..., 3] = alpha
    Image.fromarray(np.clip(col_, 0, 255).astype(np.uint8), 'RGBA').save(path)
    return path
