"""Cloud Rider's sky course between the peaks (Dojo Summit, Goku's minigame).

    <bpy python> scripts/art/worlds/dojo/mg_cloud_rider.py sky|peaks|near [--preview]
    python3 scripts/build-lite.py --image scene_dojo_sky.webp scene_dojo_sky_peaks.webp scene_dojo_sky_near.webp

Three layers, all original:
  sky    scene_dojo_sky.webp (1920x1080, opaque): the static backdrop. A bright sky with the sun low in
         the top-left corner, towering cumulus, a sea of clouds, and far-off stone spires wrapped in haze
         (one crowned with a little mountain temple). It is also the intro card's picture.
  peaks  scene_dojo_sky_peaks.webp (1920x700, transparent): nearer spires with pines, a pavilion, a
         rope bridge and a waterfall, rising out of the clouds. Drawn at the bottom of the screen and
         scrolled slowly; it tiles seamlessly left to right (every shape repeats every 19.2 units under
         an orthographic camera exactly 19.2 units wide).
  near   scene_dojo_sky_near.webp (1920x300, transparent): cloud tops rushing past in front of the
         riders along the bottom edge; tiles the same way.
Key light from the front-left like the other arenas (the sun disc sits top-left in the sky).
"""
from __future__ import annotations

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mg_common as C  # noqa: E402
from mg_common import col, lib, dress  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector, noise  # noqa: E402

A = C.args()
WHAT = A[0] if A and not A[0].startswith('--') else 'sky'
PREVIEW = '--preview' in A
P = 19.2  # strip period in world units (1920 px at 100 px per unit)

SKY = dict(zenith='#2a66cf', mid='#86bff0', horizon='#ffe3bc', haze='#dbe8f6')


# ------------------------------------------------------------------------------------------
# Shapes (world units, Z up)
def lumpy_lathe(profile, sides, center, seed, amp=0.12, flutes=0.05, unit=1.0):
    """Revolve (r, z) around a vertical axis with smooth lumps and fine vertical flutes (karst stone).
    `unit` is the shape's size (its radius): the lumps' frequency up the height scales with it."""
    rr = random.Random(seed)
    ph = [rr.uniform(0, math.tau) for _ in range(5)]
    cx, cy, cz = center
    verts, faces = [], []
    rows = len(profile)
    for (r, z0) in profile:
        z = z0 / unit
        for k in range(sides):
            a = k / sides * math.tau
            bump = (amp * (0.55 * math.sin(3 * a + ph[0] + z * 0.9) + 0.3 * math.sin(5 * a + ph[1] - z * 1.7) + 0.2 * math.sin(2 * a + ph[2] + z * 0.4))
                    + flutes * math.sin(17 * a + ph[3] + 0.3 * math.sin(z * 2.0 + ph[4])))
            rad = max(0.02, r * (1.0 + bump))
            verts.append((cx + math.cos(a) * rad, cy + math.sin(a) * rad * 0.9, cz + z0))
    for i in range(rows - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.append(tuple((rows - 1) * sides + k for k in range(sides)))
    return verts, faces


def spire_profile(radius, height, rnd, shoulders=0.18):
    """A tall stone pillar: flared foot, a slightly pinched waist, rounded shoulders and a domed top."""
    prof = []
    n = 16
    waist = rnd.uniform(0.35, 0.6)
    for i in range(n + 1):
        t = i / n
        r = radius * (1.18 - 0.28 * t - 0.12 * math.exp(-((t - waist) / 0.18) ** 2) + shoulders * math.exp(-((t - 0.86) / 0.1) ** 2))
        prof.append((r, t * height))
    cap = radius * (0.9 + shoulders * 0.4)
    for j in range(1, 5):
        u = j / 5
        prof.append((cap * math.cos(u * math.pi / 2) * (1.0 - 0.1 * u), height + cap * 0.32 * math.sin(u * math.pi / 2)))
    prof.append((0.0, height + cap * 0.34))
    return prof


def rock_material(name, haze=0.0, haze_col=SKY['haze'], top_z=3.0, base_z=-3.0):
    """Cool grey karst stone streaked vertically (rain-washed flutes), mossy patches, grass on its
    crown; `haze` fades it towards the sky colour (more at its foot, in the cloud sea). Kept cool and
    soft so the golden rings and clouds of the game read in front of it."""
    m = lib.NT(name)
    pos = m.position()
    x, y, z = m.sep(pos)
    nz = m.sep(m.normal())[2]
    mp = m.node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (3.2, 3.2, 0.32)
    m.link(pos, mp.inputs['Vector'])
    streak = m.noise(1.3, 4, 0.62, mp.outputs['Vector'])
    n1 = m.noise(1.8, 3, 0.55, pos)
    f = m.math('ADD', m.math('MULTIPLY', streak.outputs['Fac'], 0.75), m.math('MULTIPLY', n1.outputs['Fac'], 0.35))
    rock = m.ramp(f, [(0.25, '#65708a'), (0.45, '#8993a6'), (0.62, '#aab3c2'), (0.8, '#cdd3dc')])
    moss = m.maprange(m.math('ADD', n1.outputs['Fac'], m.math('MULTIPLY', m.maprange(z, top_z - 1.4, top_z), 0.35)), 0.58, 0.78)
    rock = m.mix(m.math('MULTIPLY', moss, 0.8), rock, col('#6f9c55'))
    grass = m.ramp(n1.outputs['Fac'], [(0.3, '#3f8a3e'), (0.55, '#5fa84a'), (0.8, '#8fc45a')])
    crown = m.math('MULTIPLY', m.maprange(nz, 0.35, 0.75), m.maprange(z, top_z - 0.9, top_z - 0.3))
    c = m.mix(crown, rock, grass)
    c = m.mult(c, m.mix(m.ao(0.5, 8), col('#4d4f73'), col('#ffffff')))
    c = m.mult(c, m.mix(m.maprange(z, base_z, base_z + 2.5, 0.0, 1.0), col('#8a93c4'), col('#ffffff')))
    if haze:
        hz = m.math('ADD', haze, m.math('MULTIPLY', m.maprange(z, base_z + 2.5, base_z), 0.35))
        c = m.mix(hz, c, col(haze_col))
    m.bsdf(c, 0.88, normal=m.bump(m.math('ADD', streak.outputs['Fac'], m.math('MULTIPLY', n1.outputs['Fac'], 0.5)), 0.4, 0.05))
    return m.mat


def pine(mb_leaf, mb_wood, x, y, z, s, rnd, lean=0.0):
    """A mountain pine: a crooked trunk with flat, layered pads of needles (the classic cliff-top pine)."""
    pts = []
    h = 1.0 * s
    bend = rnd.uniform(-0.35, 0.35) + lean
    for i in range(7):
        t = i / 6
        pts.append((x + bend * math.sin(t * 2.2) * s * 0.5, y, z + t * h))
    v, f = lib.tube(pts, lambda t: (0.07 - 0.04 * t) * s, 7)
    mb_wood.add(v, f, col('#5b3e2e'))
    low, high = col('#1e5a34'), col('#5da65a')
    for k in range(rnd.randint(3, 5)):
        t = 0.45 + k * 0.14
        px, py, pz = pts[min(6, int(t * 6))]
        side = rnd.uniform(-0.55, 0.55) * s
        r = rnd.uniform(0.26, 0.4) * s * (1.1 - 0.25 * k / 4)
        v, f = lib.blob((px + side, py + rnd.uniform(-0.1, 0.1) * s, pz + 0.05 * s), r, squash=(1.6, 1.2, 0.42), rough=0.2, freq=2.2, subdiv=2, seed=rnd.random() * 60)
        mb_leaf.add(v, f, lambda vv, z0=pz, r=r: lib.lerp_col(low, high, max(0.0, min(1.0, (vv[2] - z0) / (r * 0.5) + 0.45))))


def pavilion(mb_post, mb_roof, mb_trim, x, y, z, s):
    """A little hexagonal mountain pavilion: stone plinth, red posts, a sweeping tiled roof with
    upturned eaves at its six corners and a gold finial."""
    R = 0.55 * s
    v, f = lib.cylinder((x, y, z - 0.12 * s), R * 1.15, R * 1.1, 0.14 * s, sides=6)
    mb_trim.add(v, f, col('#cfc3b0'))
    for k in range(6):
        a = k / 6 * math.tau
        v, f = lib.cylinder((x + math.cos(a) * R * 0.92, y + math.sin(a) * R * 0.92, z), 0.05 * s, 0.05 * s, 0.62 * s, sides=8)
        mb_post.add(v, f, col('#c8412e'))
    prof = []
    for i in range(9):
        t = i / 8
        prof.append((R * (1.55 - 1.5 * t) + 0.18 * s * (1 - t) ** 3, 0.62 * s + 0.5 * s * t ** 0.8))
    v, f = lib.lathe(prof, 36, (0.0, 0.0, z), cap_bottom=True, cap_top=False)
    seg = math.pi / 3
    out = []
    for (vx, vy, vz) in v:
        a = math.atan2(vy, vx) % math.tau
        m = a % seg
        hexk = math.cos(seg / 2) / math.cos(m - seg / 2)
        near = 1.0 - min(m, seg - m) / (seg / 2)
        d = math.hypot(vx, vy) * hexk
        out.append((x + vx * hexk, y + vy * hexk, vz + near ** 3 * max(0.0, d - R) * 1.1))
    mb_roof.add(out, f, col('#2f7f8a'))
    v, f = lib.blob((x, y, z + 1.16 * s), 0.07 * s, squash=(1, 1, 1.6), rough=0.0, subdiv=2)
    mb_trim.add(v, f, col('#f2c14e'))


def rope_bridge(mb_plank, mb_rope, a, b, sag, planks=16):
    ax, ay, az = a
    bx, by, bz = b
    pts = []
    for i in range(planks + 1):
        t = i / planks
        pts.append((ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t - sag * 4 * t * (1 - t)))
    for i in range(planks):
        p0, p1 = pts[i], pts[i + 1]
        cx, cy, cz = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2)
        v, f = lib.box((cx, cy, cz), (abs(p1[0] - p0[0]) * 0.8, 0.34, 0.035))
        mb_plank.add(v, f, col('#a36f43') if i % 2 else col('#8a5a34'))
    for off in (-0.17, 0.17):
        rp = [(x, y + off, z + 0.24) for (x, y, z) in pts]
        v, f = lib.tube(rp, 0.018, 5)
        mb_rope.add(v, f, col('#d6c29a'))


def spire(mbs, x, y, base_z, height, radius, seed, crown=True, pines=3):
    rnd = random.Random(seed)
    prof = spire_profile(radius, height, rnd)
    v, f = lumpy_lathe(prof, 26, (x, y, base_z), seed, unit=radius)
    mbs['rock'].add(v, f, (1, 1, 1, 1))
    top = base_z + height
    if crown:
        for k in range(pines):
            a = rnd.uniform(0, math.tau)
            d = rnd.uniform(0.1, 0.65) * radius
            pine(mbs['leaf'], mbs['wood'], x + math.cos(a) * d, y + math.sin(a) * d * 0.7 - 0.2 * radius, top + radius * 0.22, rnd.uniform(0.62, 0.92) * radius, rnd,
                 lean=math.cos(a) * 0.3)
        # shrubs round the crown's rim
        for k in range(7):
            a = k / 7 * math.tau + rnd.random()
            v, f = lib.blob((x + math.cos(a) * radius * 0.85, y + math.sin(a) * radius * 0.7, top + radius * 0.08), radius * rnd.uniform(0.16, 0.24),
                            squash=(1.2, 1, 0.7), rough=0.25, subdiv=2, seed=rnd.random() * 40)
            mbs['leaf'].add(v, f, col(rnd.choice(['#3f8a35', '#4f9a3a', '#2f7a3a'])))
    return top


def builders():
    return {k: lib.MeshBuilder() for k in ('rock', 'leaf', 'wood', 'post', 'roof', 'trim', 'plank', 'rope', 'cloud')}


def build_all(mbs, name, haze=0.0, top_z=3.0, base_z=-3.0, cloud_mat=None):
    mbs['rock'].build(f'{name}_rock', rock_material(f'{name}_rock_m', haze=haze, top_z=top_z, base_z=base_z))
    leaf = lib.attr_mat(f'{name}_leaf_m', rough=0.8, ao=0.4)
    mbs['leaf'].build(f'{name}_leaf', leaf)
    wood = lib.attr_mat(f'{name}_wood_m', rough=0.75, ao=0.3)
    mbs['wood'].build(f'{name}_wood', wood)
    mbs['post'].build(f'{name}_post', lib.attr_mat(f'{name}_post_m', rough=0.5))
    mbs['roof'].build(f'{name}_roof', lib.attr_mat(f'{name}_roof_m', rough=0.45, ao=0.4))
    mbs['trim'].build(f'{name}_trim', lib.attr_mat(f'{name}_trim_m', rough=0.35))
    mbs['plank'].build(f'{name}_plank', lib.attr_mat(f'{name}_plank_m', rough=0.8))
    mbs['rope'].build(f'{name}_rope', lib.attr_mat(f'{name}_rope_m', rough=0.9))
    if cloud_mat is not None:
        mbs['cloud'].build(f'{name}_cloud', cloud_mat)


def warm_cloud(name, haze=0.0):
    return C.cloud_material(name, top='#ffffff', mid='#fbf1e6', low='#c9cfe6', glow='#ffe6c8', glow_strength=0.14,
                            z_low=-0.9, z_top=0.9, ao_tint='#aab6da', sheen=0.4)


# ------------------------------------------------------------------------------------------
# peaks: the scrolling mid layer
PEAKS = [
    # x, y (depth), top z, radius, pines: slim needles of stone with room to see the sky between them,
    # some tall, some barely clearing the clouds
    (0.9, 2.4, 1.3, 0.6, 2),
    (2.9, 0.6, 2.6, 0.78, 3),
    (4.8, 3.2, 0.5, 0.5, 1),
    (6.6, 1.4, 3.0, 0.85, 3),
    (8.7, 2.8, 1.0, 0.55, 2),
    (10.6, 0.9, 2.1, 0.72, 3),
    (12.7, 2.2, 1.6, 0.62, 2),
    (14.6, 2.2, 2.7, 0.8, 3),
    (16.9, 1.2, 0.7, 0.6, 2),
    (18.4, 3.0, 1.8, 0.5, 2),
]
PAVILION = 3
BRIDGE = (6, 7)
FALLS = 1


def peaks():
    W, H = (960, 350) if PREVIEW else (1920, 700)
    C.start(10 if PREVIEW else 22, W, H, transparent=True, exposure=-0.12)
    dress.festival_light(key=3.3, elev=38, az=-38, fill=0.9, angle=3.5, key_col='#ffe2b8', zenith='#8fc2ff', horizon='#ffe7cc', ground='#b8bcd0')
    zc = 1.0
    C.side_camera((P / 2, 0.0, zc), P, elev_deg=6.0)
    base = -3.2
    mbs = builders()
    tops = {}
    for shift in (-P, 0.0, P):
        for i, (x, y, top, r, n) in enumerate(PEAKS):
            tz = spire(mbs, x + shift, y, base, top - base, r, seed=100 + i, pines=n)
            tops[(i, shift)] = tz
        # the pavilion on the tallest spire, a bridge between two neighbours, and a waterfall
        x, y, top, r, _ = PEAKS[PAVILION]
        pavilion(mbs['post'], mbs['roof'], mbs['trim'], x + shift - 0.1, y - 0.1, tops[(PAVILION, shift)] + r * 0.2, 0.8)
        a, b = PEAKS[BRIDGE[0]], PEAKS[BRIDGE[1]]
        rope_bridge(mbs['plank'], mbs['rope'], (a[0] + shift + a[3] * 0.72, a[1], a[2] + 0.18), (b[0] + shift - b[3] * 0.74, b[1], b[2] - 0.12), 0.4, planks=12)
        # cloud sea: rolling puffs along the bottom, in two depths
        rnd = random.Random(900)
        for k in range(10):
            cx = k / 10 * P + rnd.uniform(-0.4, 0.4)
            C.puff_cluster(mbs['cloud'], (cx + shift, rnd.uniform(-1.2, 0.2), -2.35 + rnd.uniform(-0.15, 0.2)), rnd.uniform(0.8, 1.1), 7, rnd, flat=0.4, depth=0.3, subdiv=2)
        for k in range(8):
            cx = (k + 0.5) / 8 * P + rnd.uniform(-0.3, 0.3)
            C.puff_cluster(mbs['cloud'], (cx + shift, 3.2, -1.7 + rnd.uniform(-0.2, 0.2)), rnd.uniform(0.7, 0.95), 6, rnd, flat=0.4, depth=0.3, subdiv=2)
    build_all(mbs, 'peaks', haze=0.3, top_z=3.0, base_z=base, cloud_mat=warm_cloud('peaks_cloud'))
    # a waterfall down the face of one spire
    x, y, top, r, _ = PEAKS[FALLS]
    for shift in (-P, 0.0, P):
        fv = [(x + shift + 0.12, y - r * 1.02, top - 0.4), (x + shift + 0.34, y - r * 1.02, top - 0.4), (x + shift + 0.4, y - r * 1.2, base + 1.0), (x + shift + 0.06, y - r * 1.2, base + 1.0)]
        lib.mesh_object('falls', fv, [(0, 1, 2, 3)], smooth=False, material=lib.falls_material('peaks_falls', top - 0.5, base + 1.0))
    png = os.path.join(C.OUT, 'sky_peaks.png')
    lib.render_to(png)
    if not PREVIEW:
        C.publish(png, 'scene_dojo_sky_peaks.webp', quality=88)


def near():
    W, H = (960, 150) if PREVIEW else (1920, 300)
    C.start(10 if PREVIEW else 22, W, H, transparent=True, exposure=-0.1)
    dress.festival_light(key=3.2, elev=40, az=-38, fill=1.0, angle=4.0, key_col='#ffe6c4', zenith='#9fcbff', horizon='#ffeedd', ground='#c7cbe0')
    C.side_camera((P / 2, 0.0, 0.0), P, elev_deg=8.0)
    mb = lib.MeshBuilder()
    for shift in (-P, 0.0, P):
        rnd = random.Random(77)
        for k in range(9):
            cx = k / 9 * P + rnd.uniform(-0.35, 0.35)
            C.puff_cluster(mb, (cx + shift, rnd.uniform(-0.4, 0.4), -1.15 + rnd.uniform(-0.1, 0.18)), rnd.uniform(0.62, 0.86), 8, rnd, flat=0.55, depth=0.3)
        for k in range(12):
            cx = (k + 0.5) / 12 * P + rnd.uniform(-0.3, 0.3)
            C.puff_cluster(mb, (cx + shift, 1.5, -1.45), rnd.uniform(0.5, 0.7), 6, rnd, flat=0.4, depth=0.3, subdiv=2)
    mb.build('near_cloud', warm_cloud('near_cloud_m'))
    png = os.path.join(C.OUT, 'sky_near.png')
    lib.render_to(png)
    if not PREVIEW:
        C.publish(png, 'scene_dojo_sky_near.webp', quality=86)


# ------------------------------------------------------------------------------------------
# sky: the static backdrop (perspective, like scripts/art/sky.py)
def hazed(name, base_fn, near_d, far_d, max_haze=0.85, color=SKY['horizon']):
    m = lib.NT(name)
    base = base_fn(m)
    b = m.bsdf(base, 0.9)
    cd = m.node('ShaderNodeCameraData')
    fac = m.maprange(cd.outputs['View Distance'], near_d, far_d, 0.1, max_haze, smooth=True)
    em = m.node('ShaderNodeEmission')
    em.inputs['Color'].default_value = col(color)
    em.inputs['Strength'].default_value = 1.0
    mx = m.node('ShaderNodeMixShader')
    m.link(fac, mx.inputs['Fac'])
    m.link(b.outputs['BSDF'], mx.inputs[1])
    m.link(em.outputs['Emission'], mx.inputs[2])
    m.link(mx.outputs['Shader'], m.out.inputs['Surface'])
    return m.mat


def sky_world(sc):
    w = bpy.data.worlds.new('sky')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value = -0.04, 0.42
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, col(SKY['horizon'])
    els[1].position, els[1].color = 1.0, col(SKY['zenith'])
    els.new(0.22).color = col('#ffd9b0')
    els.new(0.5).color = col(SKY['mid'])
    # sun glow in the top-left corner: a hot disc, a warm halo and a wide golden bloom
    sun_dir = Vector((-0.424, 0.869, 0.254)).normalized()
    dot = nt.nodes.new('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    dot.inputs[1].default_value = tuple(sun_dir)
    nt.links.new(tc.outputs['Generated'], dot.inputs[0])
    sky_out = ramp.outputs['Color']
    for exp_, colr in ((4.0, (0.45, 0.3, 0.12)), (60.0, (0.55, 0.36, 0.1)), (900.0, (1.4, 1.1, 0.7))):
        pw = nt.nodes.new('ShaderNodeMath')
        pw.operation = 'POWER'
        pw.use_clamp = True
        nt.links.new(dot.outputs['Value'], pw.inputs[0])
        pw.inputs[1].default_value = exp_
        add = nt.nodes.new('ShaderNodeMix')
        add.data_type = 'RGBA'
        add.blend_type = 'ADD'
        nt.links.new(pw.outputs[0], [s for s in add.inputs if s.name == 'Factor' and s.type == 'VALUE'][0])
        nt.links.new(sky_out, [s for s in add.inputs if s.type == 'RGBA'][0])
        [s for s in add.inputs if s.type == 'RGBA'][1].default_value = (*colr, 1.0)
        sky_out = [s for s in add.outputs if s.type == 'RGBA'][0]
    edge = nt.nodes.new('ShaderNodeMapRange')
    edge.interpolation_type = 'SMOOTHSTEP'
    nt.links.new(dot.outputs['Value'], edge.inputs['Value'])
    edge.inputs['From Min'].default_value, edge.inputs['From Max'].default_value = 0.99965, 0.99978
    add = nt.nodes.new('ShaderNodeMix')
    add.data_type = 'RGBA'
    add.blend_type = 'ADD'
    nt.links.new(edge.outputs['Result'], [s for s in add.inputs if s.name == 'Factor' and s.type == 'VALUE'][0])
    nt.links.new(sky_out, [s for s in add.inputs if s.type == 'RGBA'][0])
    [s for s in add.inputs if s.type == 'RGBA'][1].default_value = (5.0, 4.4, 3.4, 1.0)
    sky_out = [s for s in add.outputs if s.type == 'RGBA'][0]
    nt.links.new(sky_out, bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])


def sky():
    W, H = (960, 540) if PREVIEW else (1920, 1080)
    sc = C.start(12 if PREVIEW else 24, W, H, transparent=False, exposure=-0.25)
    sky_world(sc)
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.2
    sun.angle = math.radians(5)
    sun.color = (1.0, 0.9, 0.76)
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = Vector((-0.55, -0.5, 0.67)).to_track_quat('Z', 'Y').to_euler()
    cd = bpy.data.cameras.new('cam')
    cd.lens = 30
    cd.clip_end = 4000
    co = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(co)
    sc.camera = co
    co.location = (0, 0, 0)
    co.rotation_euler = (math.radians(91.0), 0, 0)
    rnd = random.Random(31)
    # big cumulus framing the top corners, smaller ones along the horizon
    clouds = lib.MeshBuilder()
    for (x, y, z, s) in [(-250, 430, 26, 30), (190, 360, 82, 36), (40, 620, 150, 20), (310, 700, 22, 30), (-90, 560, 118, 18),
                         (20, 900, 200, 16), (-160, 1000, 210, 15), (170, 1100, 240, 17)]:
        C.puff_cluster(clouds, (x, y, z), s, 14, random.Random(int(x * 7 + y)), flat=0.6, depth=0.3)
    for i in range(170):
        x = rnd.uniform(-560, 560)
        y = rnd.uniform(90, 1100)
        z = -58 - (y - 90) * 0.02 + rnd.uniform(-3, 3)
        C.puff_cluster(clouds, (x, y, z), rnd.uniform(22, 40), 8, random.Random(1000 + i), flat=0.3, depth=0.3)
    clouds.build('sky_clouds', C.cloud_material('sky_cloud_m', top='#ffffff', mid='#f6efe9', low='#b9c7ea', glow='#ffe2c2', glow_strength=0.08,
                                                z_low=-80, z_top=40, ao_tint='#b6c4ea', sheen=0.4))
    floor = lib.NT('cloudfloor')
    cdn = floor.node('ShaderNodeCameraData')
    hz = floor.maprange(cdn.outputs['View Distance'], 250.0, 2600.0, 0.0, 1.0, smooth=True)
    fn = floor.noise(0.02, 3, 0.6, floor.position())
    fc = floor.mix(fn.outputs['Fac'], col('#b9c7ea'), col('#ffffff'))
    nb = floor.node('ShaderNodeBsdfPrincipled')
    floor.link(fc, nb.inputs['Base Color'])
    nb.inputs['Roughness'].default_value = 1.0
    fe = floor.node('ShaderNodeEmission')
    fe.inputs['Color'].default_value = col(SKY['horizon'])
    fe.inputs['Strength'].default_value = 1.0
    ms = floor.node('ShaderNodeMixShader')
    floor.link(hz, ms.inputs['Fac'])
    floor.link(nb.outputs['BSDF'], ms.inputs[1])
    floor.link(fe.outputs['Emission'], ms.inputs[2])
    floor.link(ms.outputs['Shader'], floor.out.inputs['Surface'])
    lib.mesh_object('floor', [(-30000, 0, -62), (30000, 0, -62), (30000, 30000, -140), (-30000, 30000, -140)], [(0, 1, 2, 3)], smooth=False, material=floor.mat)
    # far spires rising out of the cloud sea (kept to the sides and the horizon band)
    mbs = builders()
    far = [(-330, 900, -95, 150, 30, 11), (-205, 700, -80, 118, 22, 12), (-470, 1250, -110, 230, 44, 13), (240, 780, -90, 128, 24, 14),
           (380, 1050, -105, 190, 36, 15), (95, 1500, -120, 260, 40, 16), (-60, 1700, -130, 240, 34, 17), (560, 1600, -125, 280, 50, 18)]
    temple_at = None
    for (x, y, zb, h, r, seed) in far:
        top = spire(mbs, x, y, zb, h, r, seed, pines=3)
        if seed == 16:
            temple_at = (x, y, top + r * 0.2, r)
    if temple_at:
        x, y, z, r = temple_at
        # a stacked mountain temple: three shrinking tiers of pavilion roofs
        for k, (s, dz) in enumerate(((1.0, 0.0), (0.72, 0.62), (0.5, 1.12))):
            pavilion(mbs['post'], mbs['roof'], mbs['trim'], x, y, z + dz * r * 0.55, r * 0.55 * s)
    rock = hazed('far_rock', lambda m: rock_color(m), 500.0, 1900.0, 0.8)
    mbs['rock'].build('far_rock', rock)
    leaf = hazed('far_leaf', lambda m: m.attr('col'), 500.0, 1900.0, 0.8)
    for k in ('leaf', 'wood', 'post', 'roof', 'trim'):
        mbs[k].build(f'far_{k}', leaf)
    png = os.path.join(C.OUT, 'sky_back.png')
    lib.render_to(png)
    if not PREVIEW:
        C.publish(png, 'scene_dojo_sky.webp', rgb=True, quality=88)


def rock_color(m):
    pos = m.position()
    n = m.noise(0.05, 3, 0.6, pos)
    wave = m.node('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 0.012
    wave.inputs['Distortion'].default_value = 5.0
    m.link(pos, wave.inputs['Vector'])
    c = m.mix(n.outputs['Fac'], col('#7c6c68'), col('#c7b39a'))
    c = m.mix(m.math('MULTIPLY', wave.outputs['Fac'], 0.4), c, col('#8f7f78'))
    nz = m.sep(m.normal())[2]
    return m.mix(m.maprange(nz, 0.5, 0.85), c, col('#6fae4a'))


{'sky': sky, 'peaks': peaks, 'near': near}[WHAT]()
