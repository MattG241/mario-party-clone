"""Sky backdrop: gradient sky, sculpted cumulus clouds and a sea of clouds.

    .artenv/bin/python scripts/art/sky.py [--preview] [--variant day|dusk]

Writes public/assets/rendered/sky_<variant>.webp (a screen-space backdrop larger than the view so
it can drift with parallax).
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import col  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--preview', action='store_true')
p.add_argument('--variant', default='day')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

VARIANTS = {
    'day': dict(zenith='#2270d6', mid='#7fbdf3', horizon='#ffeed6', sun=(1.0, 0.96, 0.88), sun_dir=(-0.45, -0.35, 0.82), glow_dir=(-0.75, 0.62, 0.2), cloud_shadow='#c6d3ec', energy=3.3, exposure=-0.28),
    'golden': dict(zenith='#2f6fc9', mid='#8fbde6', horizon='#ffd49a', sun=(1.0, 0.86, 0.66), sun_dir=(-0.55, -0.3, 0.55), glow_dir=(-0.72, 0.66, 0.12), cloud_shadow='#c9b8d8', energy=3.2, exposure=-0.25),
    'dusk': dict(zenith='#2e3690', mid='#b784c9', horizon='#ffb88c', sun=(1.0, 0.74, 0.52), sun_dir=(-0.5, -0.2, 0.45), glow_dir=(-0.8, 0.55, 0.08), cloud_shadow='#b8a2d8', energy=3.0, exposure=-0.2),
}
V = VARIANTS[A.variant]
W, H = (1200, 675) if A.preview else (2560, 1440)

sc = lib.reset(16 if A.preview else 64)
sc.render.film_transparent = False
sc.view_settings.exposure = V['exposure']
sc.render.resolution_x, sc.render.resolution_y = W, H

# --- sky shader: gradient by view elevation + soft sun glow
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
ramp = nt.nodes.new('ShaderNodeValToRGB')
mr = nt.nodes.new('ShaderNodeMapRange')
mr.inputs['From Min'].default_value = -0.05
mr.inputs['From Max'].default_value = 0.75
nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
els = ramp.color_ramp.elements
els[0].position, els[0].color = 0.0, col(V['horizon'])
els[1].position, els[1].color = 1.0, col(V['zenith'])
e = els.new(0.3)
e.color = col(V['mid'])
# sun glow: dot(view, sun) -> power
sd = Vector(V['sun_dir']).normalized()
gd = Vector(V['glow_dir']).normalized()
dotn = nt.nodes.new('ShaderNodeVectorMath')
dotn.operation = 'DOT_PRODUCT'
dotn.inputs[1].default_value = tuple(gd)
nt.links.new(tc.outputs['Generated'], dotn.inputs[0])
pw = nt.nodes.new('ShaderNodeMath')
pw.operation = 'POWER'
pw.use_clamp = True
nt.links.new(dotn.outputs['Value'], pw.inputs[0])
pw.inputs[1].default_value = 6.0
glow = nt.nodes.new('ShaderNodeMix')
glow.data_type = 'RGBA'
glow.blend_type = 'ADD'
facs = [s for s in glow.inputs if s.name == 'Factor' and s.type == 'VALUE']
cols = [s for s in glow.inputs if s.type == 'RGBA']
nt.links.new(pw.outputs[0], facs[0])
nt.links.new(ramp.outputs['Color'], cols[0])
cols[1].default_value = (0.55, 0.48, 0.36, 1.0)
nt.links.new([s for s in glow.outputs if s.type == 'RGBA'][0], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.0
nt.links.new(bg.outputs['Background'], out.inputs['Surface'])

# --- lights
sun = bpy.data.lights.new('sun', 'SUN')
sun.energy = V['energy']
sun.angle = math.radians(6)
sun.color = V['sun']
so = bpy.data.objects.new('sun', sun)
sc.collection.objects.link(so)
so.rotation_euler = Vector(sd).to_track_quat('Z', 'Y').to_euler()

# --- camera looking slightly down at the horizon
cd = bpy.data.cameras.new('cam')
cd.lens = 32
cd.clip_end = 2000
co = bpy.data.objects.new('cam', cd)
sc.collection.objects.link(co)
sc.camera = co
co.location = (0, 0, 0)
co.rotation_euler = (math.radians(86), 0, 0)

# --- cloud material: bright tops, cool soft shadows, a little self-glow for fake scattering
m = lib.NT('cloud')
ao = m.ao(6.0, 6)
nz = m.sep(m.normal())[2]
up = m.maprange(nz, -0.6, 0.9)
base = m.mix(m.math('MULTIPLY', ao, up), col(V['cloud_shadow']), col('#ffffff'))
m.bsdf(base, 1.0, emission=col(V['mid']), emission_strength=0.07, sheen=0.4)
cloud_mat = m.mat

rnd = random.Random(42 if A.variant == 'day' else 7)
clouds = lib.MeshBuilder()


def cloud(center, size, puffs=12, flat=0.55, seed=0):
    """Cumulus cluster: overlapping lumpy spheres on a flattened base."""
    r = random.Random(seed)
    cx, cy, cz = center
    for i in range(puffs):
        t = i / max(1, puffs - 1)
        x = (t - 0.5) * size * 2.2 + r.uniform(-0.25, 0.25) * size
        y = r.uniform(-0.3, 0.3) * size
        rad = size * r.uniform(0.38, 0.62) * (0.55 + 0.45 * math.sin(t * math.pi))
        z = rad * 0.35 + math.sin(t * math.pi) * size * 0.3 * (1.0 if flat > 0.4 else 0.4)
        v, f = lib.blob((cx + x, cy + y, cz + z), rad, squash=(1.15, 1.0, 0.9 if flat > 0.4 else 0.55), rough=0.08, freq=1.2, subdiv=3, seed=r.random() * 90)
        clouds.add(v, f, (1, 1, 1, 1))
    # flat base
    v, f = lib.blob((cx, cy, cz), size * 1.1, squash=(1.2, 0.45, 0.16 * (1 if flat > 0.4 else 0.6)), rough=0.05, subdiv=3)
    clouds.add(v, f, (1, 1, 1, 1))


# Big cumulus framing the view (left/right), mid clouds, and far small ones.
for (x, y, z, s_) in [(-95, 260, 22, 26), (110, 300, 35, 30), (-40, 420, 70, 20), (60, 520, 95, 22), (-160, 520, 40, 28), (180, 460, 18, 24),
                      (10, 700, 120, 18), (-120, 800, 150, 16), (140, 850, 160, 18)]:
    cloud((x, y, z), s_, puffs=14, seed=int(x * 7 + y))
# cloud sea: a dense field of low clusters over a soft white floor
for i in range(170):
    x = rnd.uniform(-520, 520)
    y = rnd.uniform(90, 1000)
    z = -58 - (y - 90) * 0.02 + rnd.uniform(-3, 3)
    cloud((x, y, z), rnd.uniform(22, 40), puffs=8, flat=0.3, seed=1000 + i)
clouds.build('clouds', cloud_mat)
floor = lib.NT('cloudfloor')
cdist = floor.node('ShaderNodeCameraData')
hz = floor.maprange(cdist.outputs['View Distance'], 250.0, 2600.0, 0.0, 1.0, smooth=True)
fn = floor.noise(0.02, 3, 0.6, floor.position())
fc = floor.mix(fn.outputs['Fac'], col(V['cloud_shadow']), col('#ffffff'))
near_b = floor.node('ShaderNodeBsdfPrincipled')
floor.link(fc, near_b.inputs['Base Color'])
near_b.inputs['Roughness'].default_value = 1.0
far_e = floor.node('ShaderNodeEmission')
far_e.inputs['Color'].default_value = col(V['horizon'])
far_e.inputs['Strength'].default_value = 1.0
mixs = floor.node('ShaderNodeMixShader')
floor.link(hz, mixs.inputs['Fac'])
floor.link(near_b.outputs['BSDF'], mixs.inputs[1])
floor.link(far_e.outputs['Emission'], mixs.inputs[2])
floor.link(mixs.outputs['Shader'], floor.out.inputs['Surface'])
lib.mesh_object('floor', [(-30000, 0, -62), (30000, 0, -62), (30000, 30000, -140), (-30000, 30000, -140)], [(0, 1, 2, 3)], smooth=False, material=floor.mat)



# --- distant floating islands and a prism beacon, fading into the sky with distance
def hazed(name, color, rough=0.85, glow=None, glow_strength=0.0, near=260.0, far=1500.0, max_haze=0.82, color_fn=None):
    m = lib.NT(name)
    base = color_fn(m) if color_fn else col(color)
    b = m.bsdf(base, rough, emission=col(glow) if glow else None, emission_strength=glow_strength)
    cdat = m.node('ShaderNodeCameraData')
    fac = m.maprange(cdat.outputs['View Distance'], near, far, 0.12, max_haze, smooth=True)
    em = m.node('ShaderNodeEmission')
    em.inputs['Color'].default_value = col(V['horizon'])
    em.inputs['Strength'].default_value = 1.0
    mixs = m.node('ShaderNodeMixShader')
    m.link(fac, mixs.inputs['Fac'])
    m.link(b.outputs['BSDF'], mixs.inputs[1])
    m.link(em.outputs['Emission'], mixs.inputs[2])
    m.link(mixs.outputs['Shader'], m.out.inputs['Surface'])
    return m.mat


grass_b, rock_b, tree_b, trunk_b = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()


def far_island(cx, cy, cz, r, seed, trees=6):
    rr = random.Random(seed)
    ph = [rr.uniform(0, math.tau) for _ in range(4)]
    v, f = lib.blob((cx, cy, cz), r, squash=(1.25, 1.0, 0.2), rough=0.1, freq=1.1, subdiv=3, seed=seed)
    grass_b.add(v, f, (1, 1, 1, 1))
    # dirt lip under the turf
    v, f = lib.lathe([(r * 1.2, 0.03 * r), (r * 1.16, -0.1 * r)], 28, (cx, cy, cz), cap_bottom=False, cap_top=False, squash_y=0.82)
    trunk_b.add(v, f, (1, 1, 1, 1))

    def lumpy_cone(x0, y0, z0, rad, depth, sides=26, rows=9):
        verts, faces = [], []
        for i in range(rows):
            t = i / (rows - 1)
            rr_ = rad * (1.0 - t) ** 0.8 + 0.02 * rad
            z = z0 - 0.1 * rad - depth * t ** 0.9
            for k in range(sides):
                a = k / sides * math.tau
                bump = 1 + 0.13 * math.sin(3 * a + ph[0] + t * 2.0) + 0.08 * math.sin(7 * a + ph[1] - t * 3.0) + 0.05 * math.sin(13 * a + ph[2])
                verts.append((x0 + math.cos(a) * rr_ * bump, y0 + math.sin(a) * rr_ * bump * 0.82, z + 0.06 * rad * math.sin(5 * a + ph[3])))
        for i in range(rows - 1):
            for k in range(sides):
                a, b = i * sides + k, i * sides + (k + 1) % sides
                faces.append((a, b, b + sides, a + sides))
        return verts, faces

    v, f = lumpy_cone(cx, cy, cz, r * 1.14, r * 1.05)
    rock_b.add(v, f, (1, 1, 1, 1))
    # hanging spurs so the underside isn't a perfect cone
    for _ in range(rr.randint(3, 4)):
        a = rr.uniform(0, math.tau)
        d = rr.uniform(0.3, 0.62) * r
        v, f = lumpy_cone(cx + math.cos(a) * d, cy + math.sin(a) * d * 0.8, cz - 0.08 * r, r * rr.uniform(0.32, 0.5), r * rr.uniform(0.95, 1.6), sides=14, rows=7)
        rock_b.add(v, f, (1, 1, 1, 1))
    for _ in range(trees):
        a = rr.uniform(0, math.tau)
        d = rr.uniform(0.1, 0.8) * r
        tx, ty = cx + math.cos(a) * d * 1.15, cy + math.sin(a) * d * 0.8
        h = r * rr.uniform(0.25, 0.4)
        v, f = lib.cylinder((tx, ty, cz + r * 0.15), r * 0.035, r * 0.025, h, sides=6)
        trunk_b.add(v, f, (1, 1, 1, 1))
        v, f = lib.blob((tx, ty, cz + r * 0.15 + h), r * rr.uniform(0.14, 0.22), squash=(1.0, 1.0, 1.1), rough=0.2, subdiv=2, seed=rr.random() * 50)
        tree_b.add(v, f, (1, 1, 1, 1))


# (x, distance, z, radius) — kept to the sides and the horizon band so the board stays readable.
for i, (x, y, z, r) in enumerate([(-230, 520, -6, 26), (-330, 760, 8, 34), (-150, 900, 22, 20), (-420, 1100, -2, 40),
                                    (250, 560, -2, 24), (380, 820, 14, 36), (170, 980, 30, 18), (470, 1180, 4, 44), (-40, 1250, 40, 16)]):
    far_island(x, y, z, r, seed=300 + i * 17, trees=4 + i % 4)
# The Prism Beacon: a great crystal on a far isle, lighting the festival from the horizon.
far_island(300, 1350, 18, 46, seed=911, trees=3)
bx, by, bz = 300, 1350, 18 + 46 * 0.2
crystal = lib.MeshBuilder()
v, f = lib.prism((bx, by, bz), 15, 96, sides=6, tip=0.3)
crystal.add(v, f, (1, 1, 1, 1))
for k in range(5):
    a = k / 5 * math.tau + 0.4
    v, f = lib.prism((bx + math.cos(a) * 12, by + math.sin(a) * 9, bz), 4.5, 26 + 8 * (k % 3), sides=6, tip=0.35, tilt=(math.cos(a) * 0.35, math.sin(a) * 0.35))
    crystal.add(v, f, (1, 1, 1, 1))
crystal.build('beacon', hazed('beacon_mat', '#6fe6ff', 0.25, glow='#3fcfff', glow_strength=2.6, near=1200, far=3000, max_haze=0.15))
beam = lib.NT('beam')
em = beam.node('ShaderNodeEmission')
em.inputs['Color'].default_value = col('#bff6ff')
em.inputs['Strength'].default_value = 0.9
tr = beam.node('ShaderNodeBsdfTransparent')
lw = beam.node('ShaderNodeLayerWeight')
lw.inputs['Blend'].default_value = 0.35
fac = beam.maprange(lw.outputs['Facing'], 0.0, 1.0, 0.8, 1.0)
mx = beam.node('ShaderNodeMixShader')
beam.link(fac, mx.inputs['Fac'])
beam.link(em.outputs['Emission'], mx.inputs[1])
beam.link(tr.outputs['BSDF'], mx.inputs[2])
beam.link(mx.outputs['Shader'], beam.out.inputs['Surface'])
v, f = lib.cylinder((bx, by, bz + 80), 5, 14, 700, sides=24, cap=False)
lib.mesh_object('beam', v, f, smooth=True, material=beam.mat)

grass_b.build('far_grass', hazed('far_grass_mat', '#6cc24a', 0.9))
def rock_color(m):
    pos = m.position()
    n = m.noise(0.06, 3, 0.6, pos)
    band = m.noise(0.25, 2, 0.5, pos)
    c = m.mix(n.outputs['Fac'], col('#5e4638'), col('#9c7c62'))
    return m.mix(m.maprange(band.outputs['Fac'], 0.45, 0.62), c, col('#7a5f4c'))


rock_b.build('far_rock', hazed('far_rock_mat', '#8a6a55', 0.95, color_fn=rock_color))
tree_b.build('far_trees', hazed('far_tree_mat', '#3f9a45', 0.9))
trunk_b.build('far_trunks', hazed('far_trunk_mat', '#6b4a35', 0.9))

dest = os.path.join(lib.ROOT, 'art-out', 'sky')
path = os.path.join(dest, f'sky_{A.variant}.png')
lib.render_to(path)
if not A.preview:
    from PIL import Image
    pub = os.path.join(lib.ROOT, 'public', 'assets', 'rendered')
    os.makedirs(pub, exist_ok=True)
    Image.open(path).convert('RGB').save(os.path.join(pub, f'sky_{A.variant}.webp'), 'WEBP', quality=88, method=6)
    print('wrote', os.path.join(pub, f'sky_{A.variant}.webp'))
