"""The GLEAMTRAIL wordmark as a chunky extruded 3D logo.

    .artenv/bin/python scripts/art/logo.py [--preview]

Fredoka Bold (the game's UI font, from node_modules/@fontsource/fredoka) is converted to TTF with
fontTools (overlapping contours merged with skia-pathops), extruded and bevelled, given a cream-to-gold gradient face, dark teal sides and a thick
navy outline, and rendered with a transparent background to public/assets/rendered/ui_logo.webp.
"""
from __future__ import annotations

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import col  # noqa: E402

import bpy  # noqa: E402
from PIL import Image  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--preview', action='store_true')
p.add_argument('--text', default='GLEAMTRAIL')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

OUT = os.path.join(lib.ROOT, 'art-out', 'logo')
os.makedirs(OUT, exist_ok=True)
WOFF = os.path.join(lib.ROOT, 'node_modules', '@fontsource', 'fredoka', 'files', 'fredoka-latin-700-normal.woff2')
TTF = os.path.join(OUT, 'fredoka-700-merged.ttf')
if not os.path.exists(TTF):
    from fontTools.ttLib import TTFont
    from fontTools.ttLib.removeOverlaps import removeOverlaps
    f = TTFont(WOFF)
    f.flavor = None
    # Glyphs such as A are built from overlapping contours; Blender fills even-odd, so the
    # overlaps would render as holes. Merge them first (needs skia-pathops).
    removeOverlaps(f)
    f.save(TTF)

sc = lib.reset(12 if A.preview else 64)
lib.world_light(1.0, zenith='#bfe1ff', horizon='#fff1d8', ground='#c9b28f')
lib.sun(energy=3.0, elevation=55, azimuth=-40, angle=6.0, color='#fff2dc')
font = bpy.data.fonts.load(TTF)


def text_curve(name, extrude, bevel, offset):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = A.text
    cu.font = font
    cu.size = 1.0
    cu.space_character = 1.02
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = 4
    cu.offset = offset
    return cu


def place(ob, z, material):
    sc.collection.objects.link(ob)
    ob.location = (0.0, 0.0, z)
    # tip the letters back a little so the camera sees their chunky lower sides
    ob.rotation_euler = (math.radians(-22), 0.0, 0.0)
    ob.data.materials.append(material)
    return ob


def text_object(name, extrude, bevel, z, material):
    # Text bevels grow outward, which would eat into small counters (the A's) and turn them inside
    # out; insetting the contour by the bevel keeps every glyph at its true shape.
    return place(bpy.data.objects.new(name, text_curve(name, extrude, bevel, -bevel)), z, material)


def backing_object(name, extrude, bevel, offset, z, material):
    """The outline slab: the wordmark's outer contours only (counters filled in), grown by `offset`.
    Growing a glyph with its counters would turn small holes (the A's) inside out."""
    tmp = bpy.data.objects.new(name + '_src', text_curve(name + '_src', 0.0, 0.0, 0.0))
    sc.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    cu = tmp.evaluated_get(dg).to_curve(dg).copy()
    sc.collection.objects.unlink(tmp)

    def poly(sp):
        return [(bp.co.x, bp.co.y) for bp in sp.bezier_points] or [(p.co.x, p.co.y) for p in sp.points]

    def inside(pt, pg):
        x, y = pt
        hit = False
        for i in range(len(pg)):
            (x1, y1), (x2, y2) = pg[i], pg[i - 1]
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                hit = not hit
        return hit

    polys = [poly(sp) for sp in cu.splines]
    inner = [i for i, pg in enumerate(polys) if any(j != i and inside(pg[0], polys[j]) for j in range(len(polys)))]
    for i in sorted(inner, reverse=True):
        cu.splines.remove(cu.splines[i])
    cu.dimensions = '2D'
    cu.fill_mode = 'BOTH'
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = 4
    cu.offset = offset
    print(f'backing: {len(polys)} contours, {len(inner)} counters filled')
    return place(bpy.data.objects.new(name, cu), z, material)


def face_material():
    """Gradient face (cream top -> gold -> warm orange bottom) with gloss; sides dark teal."""
    m = lib.NT('logo_face')
    tc = m.node('ShaderNodeTexCoord')
    sep = m.node('ShaderNodeSeparateXYZ')
    m.link(tc.outputs['Generated'], sep.inputs[0])
    grad = m.ramp(sep.outputs['Y'], [(0.05, '#f07c14'), (0.42, '#ffc53a'), (0.7, '#ffe79a'), (0.95, '#fffbef')])
    geo = m.node('ShaderNodeNewGeometry')
    vt = m.node('ShaderNodeVectorTransform')
    vt.vector_type = 'NORMAL'
    vt.convert_from = 'WORLD'
    vt.convert_to = 'OBJECT'
    m.link(geo.outputs['Normal'], vt.inputs['Vector'])
    nsep = m.node('ShaderNodeSeparateXYZ')
    m.link(vt.outputs['Vector'], nsep.inputs[0])
    front = m.maprange(nsep.outputs['Z'], 0.55, 0.95)
    side = col('#0f5a60')
    c = m.mix(front, side, grad)
    # a bright rim where the bevel turns toward the light
    rim = m.maprange(nsep.outputs['Z'], 0.25, 0.55)
    rim = m.math('MULTIPLY', rim, m.maprange(nsep.outputs['Z'], 0.85, 0.55))
    c = m.mix(m.math('MULTIPLY', rim, 0.55), c, col('#ffffff'))
    m.bsdf(c, 0.28, coat=0.6, emission=grad, emission_strength=0.12)
    return m.mat


def outline_material():
    m = lib.NT('logo_outline')
    m.bsdf(col('#0a2e38'), 0.5, coat=0.2)
    return m.mat


text_object('logo_face', extrude=0.13, bevel=0.034, z=0.0, material=face_material())
backing_object('logo_outline', extrude=0.1, bevel=0.02, offset=0.075, z=-0.14, material=outline_material())

cd = bpy.data.cameras.new('cam')
cd.type = 'ORTHO'
cd.ortho_scale = 7.4
cam = bpy.data.objects.new('cam', cd)
sc.collection.objects.link(cam)
sc.camera = cam
cam.location = (0.0, 0.0, 30.0)
cam.rotation_euler = (0.0, 0.0, 0.0)
w, h = (800, 220) if A.preview else (1600, 440)
sc.render.resolution_x, sc.render.resolution_y = w, h
path = os.path.join(OUT, 'logo.png')
lib.render_to(path)
im = Image.open(path).convert('RGBA')
bbox = im.getchannel('A').getbbox()
if bbox:
    pad = 12
    im = im.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad)))
if not A.preview:
    im.save(os.path.join(lib.ROOT, 'public', 'assets', 'rendered', 'ui_logo.webp'), 'WEBP', quality=95, method=6)
    print('wrote ui_logo.webp', im.size)
else:
    im.save(os.path.join(OUT, 'logo_preview.png'))
    print('preview', im.size)
