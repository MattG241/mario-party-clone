"""Patty Panic (Cartoon Coast, SpongeBob's minigame): an undersea diner kitchen and its sprites.

    bpyenv/bin/python scripts/art/worlds/toons/mg_patty.py kitchen|sprites [--preview]

A near-frontal camera (16 degrees elevation) on a cosy ship-plank kitchen at the bottom of the sea:
portholes onto kelp and bubbles, a brass ticket rail under the HUD, a sizzling grill line behind
the cooks and the long serving counter in front of them. No signs or lettering anywhere.
  kitchen  -> scene_toons_kitchen.webp (1920 x 1080, opaque) and scene_toons_kitchen_front.webp
              (rows 798..1080 of the same render: the counter, drawn over the cooks' legs)
  sprites  -> mg/toons_patty.webp + .json: bun bottom / top, patty, cheese, lettuce, tomato, plate,
              and four customers (a round fish, a seahorse, a sea turtle, a jellyfish)
Layout (must match src/game/worlds/toons/games/pattyPanicLogic.ts): cooks stand with their feet at
y 880 behind the counter, whose top runs from y 800 (back edge) to 840 (front edge); its front face
spans 840..955 and the diner floor shows below it; the grill line's front face spans 580..681.
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mg_common as C  # noqa: E402
from mg_common import SW, SH, col, gy, wp  # noqa: E402

import lib  # noqa: E402
import mg_dress as dress  # noqa: E402
import props  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('what', choices=['kitchen', 'sprites'])
p.add_argument('--preview', action='store_true')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

ELEV = 16.0
WALL_ROW = 648          # ground row of the back wall
GRILL_FRONT = 681       # ground row of the grill line's front face
GRILL_H = 1.05
COUNTER_BACK = 915      # ground row of the counter's back edge (top-back edge shows at y 800)
COUNTER_FRONT = 955     # ground row of its front face (top-front edge at y 840)
COUNTER_H = 1.196
FRONT_CUT = 798


def wall_material():
    """Aqua-painted ship planks running up the wall, with dark seams, knots and a warm lower glow."""
    m = lib.NT('wall_planks')
    X, Y, Z = m.sep(m.position())
    plank = m.math('FLOOR', m.math('DIVIDE', X, 0.46))
    frac = m.math('SUBTRACT', m.math('DIVIDE', X, 0.46), plank)
    seam = m.maprange(m.math('MINIMUM', frac, m.math('SUBTRACT', 1.0, frac)), 0.0, 0.05)
    tone = m.math('FRACT', m.math('MULTIPLY', m.math('SINE', m.math('MULTIPLY', plank, 12.9898)), 43758.5))
    c = m.mix(tone, col('#3fb8b2'), col('#56c7c0'))
    grain = m.noise(1.0, 3, 0.6, None)
    vec = m.node('ShaderNodeCombineXYZ')
    m.link(m.math('MULTIPLY', X, 9.0), vec.inputs['X'])
    m.link(m.math('MULTIPLY', Z, 0.8), vec.inputs['Y'])
    m.link(Y, vec.inputs['Z'])
    m.link(vec.outputs['Vector'], grain.inputs['Vector'])
    c = m.mult(c, m.mix(grain.outputs['Fac'], col('#d4e8e4'), col('#ffffff')))
    c = m.mult(c, m.mix(seam, col('#1f5e5c'), col('#ffffff')))
    c = m.mult(c, m.mix(m.ao(0.7, 8), col('#5d6f7a'), col('#ffffff')))
    m.bsdf(c, 0.7, normal=m.bump(seam, 0.3, 0.02))
    return m.mat


def floor_material():
    """Diner checker tiles in cream and teal."""
    m = lib.NT('diner_floor')
    X, Y, Z = m.sep(m.position())
    # tiles run deep so they read as squares from this low camera
    fx = m.math('FLOOR', m.math('DIVIDE', X, 0.64))
    fy = m.math('FLOOR', m.math('DIVIDE', Y, 1.5))
    s = m.math('FLOORED_MODULO', m.math('ADD', fx, fy), 2.0)
    c = m.mix(s, col('#fff1d6'), col('#2f9d9a'))
    n = m.noise(6.0, 3, 0.5, m.position())
    c = m.mult(c, m.mix(n.outputs['Fac'], col('#e6ddd0'), col('#ffffff')))
    c = m.mult(c, m.mix(m.ao(0.8, 8), col('#5a5a6a'), col('#ffffff')))
    m.bsdf(c, 0.35, coat=0.4)
    return m.mat


def steel_material(name='steel', tint='#c9d2dc'):
    m = lib.NT(name)
    X, Y, Z = m.sep(m.position())
    brush = m.noise(1.0, 2, 0.5, None)
    vec = m.node('ShaderNodeCombineXYZ')
    m.link(m.math('MULTIPLY', X, 2.0), vec.inputs['X'])
    m.link(m.math('MULTIPLY', Z, 60.0), vec.inputs['Y'])
    m.link(brush.inputs['Vector'], brush.inputs['Vector']) if False else None
    m.link(vec.outputs['Vector'], brush.inputs['Vector'])
    c = m.mix(brush.outputs['Fac'], col('#aab4c0'), col(tint))
    c = m.mult(c, m.mix(m.ao(0.5, 8), col('#5f6672'), col('#ffffff')))
    b = m.bsdf(c, 0.32, coat=0.2)
    b.inputs['Metallic'].default_value = 0.85
    return m.mat


def glass_view_material(name, deep='#0d5a8c', light='#6fd6e8'):
    """A porthole's view of the sea: bright water above, deep blue below, gently glowing."""
    m = lib.NT(name)
    X, Y, Z = m.sep(m.position())
    n = m.noise(3.0, 3, 0.5, m.position())
    g = m.math('ADD', m.math('MULTIPLY', m.math('FRACT', m.math('MULTIPLY', Z, 0.35)), 0.0), m.maprange(Z, 2.4, 4.6))
    c = m.mix(g, col(deep), col(light))
    c = m.mix(m.math('MULTIPLY', m.maprange(n.outputs['Fac'], 0.55, 0.7), 0.25), c, col('#d9fbff'))
    m.bsdf(c, 0.05, emission=c, emission_strength=0.9, coat=1.0)
    return m.mat


def brass_ring(mb, cx, z, r, tube, y):
    v, f = C.torus((cx, y, z), r, tube, 48, 12, axis='y')
    mb.add(v, f, col('#e0a93f'))
    for k in range(8):
        a = k / 8 * math.tau
        v, f = lib.blob((cx + math.cos(a) * r, y - tube * 0.8, z + math.sin(a) * r), tube * 0.35, rough=0.0, subdiv=1)
        mb.add(v, f, col('#fff0b8'))


def kelp(mb, x, y, z0, h, rnd, sway=0.15):
    pts = []
    for k in range(14):
        t = k / 13
        pts.append((x + math.sin(t * 5 + rnd.uniform(0, 1)) * sway, y, z0 + h * t))
    v, f = lib.tube(pts, lambda t: 0.05 * (1 - 0.6 * t), 6)
    mb.add(v, f, col(rnd.choice(['#3aa84a', '#58c25a', '#2f8f3f'])))
    for k in range(5):
        t = 0.2 + k * 0.15
        q = pts[int(t * 13)]
        v, f = lib.blob((q[0] + (0.09 if k % 2 else -0.09), q[1], q[2]), 0.09, squash=(1.3, 0.3, 0.6), rough=0.1, subdiv=1)
        mb.add(v, f, col('#6fd06a'))


def pineapple_house(mb, mb_leaf, x, y, z, s=1.0):
    """A tiny pineapple-shaped house far away through a porthole (a generic seaside motif)."""
    v, f = C.ellipsoid((x, y, z + 0.32 * s), 0.2 * s, 0.2 * s, 0.34 * s, subdiv=3)
    mb.add(v, f, lambda q: col('#f5a623') if int((q[0] * 18 + q[2] * 18)) % 2 else col('#e08a14'))
    v, f = lib.blob((x - 0.02 * s, y - 0.18 * s, z + 0.16 * s), 0.06 * s, squash=(1, 0.3, 1.3), rough=0.0, subdiv=1)
    mb.add(v, f, col('#6b8fb0'))
    for k in range(6):
        a = k / 6 * math.tau
        v, f = lib.blob((x + math.cos(a) * 0.08 * s, y + math.sin(a) * 0.05 * s, z + 0.72 * s), 0.07 * s, squash=(0.5, 0.5, 2.2), rough=0.1, subdiv=1)
        mb_leaf.add(v, f, col('#3f9b33'))


def kitchen():
    C.start(ELEV, 22, A.preview, sun_elev=40, sun_az=-30, key=3.0, fill=1.0, key_col='#ffe6c4', zenith='#a9dcff', horizon='#fff0da', ground='#b7a88e')
    C.camera(0, 0, SW, SH, A.preview)
    rnd = random.Random(21)
    wm, fm, st = wall_material(), floor_material(), steel_material()
    metal = props.mats()['metal']
    paint = C.mat_gloss('k_paint', 0.45, 0.3)
    wood = props.mats()['wood']
    glow = C.mat_glow('k_glow', 2.2)
    x0, x1 = -1.0, 20.2
    # floor from the wall to beyond the bottom of the screen, and the back wall
    lib.mesh_object('floor', [(x0, gy(WALL_ROW), 0.0), (x1, gy(WALL_ROW), 0.0), (x1, gy(1300), 0.0), (x0, gy(1300), 0.0)], [(3, 2, 1, 0)], smooth=False, material=fm)
    wy = gy(WALL_ROW)
    lib.mesh_object('wall', [(x0, wy, 0.0), (x1, wy, 0.0), (x1, wy, 7.5), (x0, wy, 7.5)], [(0, 1, 2, 3)], smooth=False, material=wm)
    # portholes along the wall, each with a view of the sea (one has the little pineapple house)
    trim = lib.MeshBuilder()
    view = glass_view_material('sea_view')
    bubbles, weeds, house, house_leaf = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    for i, px in enumerate([55, 510, 960, 1410, 1865]):
        z = (WALL_ROW - 300) / (lib.SINB * 100)
        r = 0.62 if i == 2 else 0.5
        cx = px / 100
        brass_ring(trim, cx, z, r, 0.1, wy - 0.12)
        lib.mesh_object(f'porthole_{i}', *lib.cylinder((0, 0, 0), r, r, 0.05, 40), smooth=True, material=view)
        ob = bpy.data.objects[f'porthole_{i}']
        ob.rotation_euler = (math.pi / 2, 0.0, 0.0)
        ob.location = (cx, wy - 0.03, z)
        for k in range(3):
            bx = cx + rnd.uniform(-r * 0.5, r * 0.5)
            v, f = lib.blob((bx, wy - 0.1, z + rnd.uniform(-r * 0.4, r * 0.6)), rnd.uniform(0.03, 0.06), rough=0.0, subdiv=2)
            bubbles.add(v, f, col('#f4feff'))
        kelp(weeds, cx - r * 0.55, wy - 0.07, z - r * 0.9, r * 1.2, rnd, 0.06)
        kelp(weeds, cx + r * 0.6, wy - 0.07, z - r * 0.9, r * 0.9, rnd, 0.05)
        if i == 2:
            pineapple_house(house, house_leaf, cx + 0.12, wy - 0.08, z - r * 0.75, s=0.75)
    trim.build('porthole_trim', metal)
    bubbles.build('bubbles', C.mat_gloss('bubble', 0.05, 1.0, spec=0.8))
    weeds.build('weeds', dress.mats()['leaf'])
    house.build('pineapple', paint)
    house_leaf.build('pineapple_leaf', dress.mats()['leaf'])
    # the brass ticket rail under the HUD, with brackets
    rail = lib.MeshBuilder()
    rz = (WALL_ROW - 112) / (lib.SINB * 100)
    v, f = lib.tube([(x0, wy - 0.18, rz), (x1, wy - 0.18, rz)], 0.045, 10)
    rail.add(v, f, col('#e8b04a'))
    for bx in range(0, 1921, 320):
        v, f = lib.box((bx / 100, wy - 0.09, rz), (0.06, 0.18, 0.06))
        rail.add(v, f, col('#c98a1b'))
    rail.build('rail', metal)
    # a life ring, a ship's wheel and a net with starless shells, where the tickets leave room
    deco = lib.MeshBuilder()
    for (dx, dz) in [(290, 5.0), (1650, 5.0)]:
        pass
    v, f = C.torus((1.35, wy - 0.12, 2.05), 0.34, 0.1, 40, 12, axis='y')
    deco.add(v, f, lambda q: col('#ff5a4a') if int((math.atan2(q[2] - 2.05, q[0] - 1.35) + math.pi) / (math.pi / 4)) % 2 else col('#fff4dc'))
    deco.build('life_ring', paint)
    wheel = lib.MeshBuilder()
    wcx, wcz = 18.45, 2.1
    v, f = C.torus((wcx, wy - 0.12, wcz), 0.36, 0.05, 40, 10, axis='y')
    wheel.add(v, f, col('#9a643a'))
    for k in range(8):
        a = k / 8 * math.tau
        v, f = lib.tube([(wcx, wy - 0.12, wcz), (wcx + math.cos(a) * 0.55, wy - 0.12, wcz + math.sin(a) * 0.55)], 0.03, 6)
        wheel.add(v, f, col('#b07a45'))
    v, f = lib.blob((wcx, wy - 0.16, wcz), 0.09, squash=(1, 0.6, 1), rough=0.0, subdiv=1)
    wheel.add(v, f, col('#e0a93f'))
    wheel.build('ships_wheel', wood)
    # the grill line against the wall: a steel cabinet with knobs, a flat-top griddle with sizzling
    # patties, a fryer, a pot on a burner, squeeze bottles and a stack of plates
    gb, gf = gy(WALL_ROW), gy(GRILL_FRONT)
    lib.mesh_object('grill_cab', *lib.box(((x0 + x1) / 2, (gb + gf) / 2, GRILL_H / 2), (x1 - x0, gb - gf, GRILL_H)), smooth=False, material=st)
    top = lib.MeshBuilder()
    v, f = lib.box(((x0 + x1) / 2, (gb + gf) / 2, GRILL_H + 0.03), (x1 - x0, gb - gf + 0.1, 0.06))
    top.add(v, f, col('#3a3a42'))
    top.build('griddle', C.mat_gloss('griddle', 0.35, 0.2))
    knobs = lib.MeshBuilder()
    for kx in range(40, 1920, 120):
        v, f = lib.cylinder((0, 0, 0), 0.07, 0.06, 0.06, 14)
        v = lib.transform(v, loc=(kx / 100, gf - 0.02, GRILL_H * 0.72), rot=(math.pi / 2, 0.0, 0.0))
        knobs.add(v, f, col('#20242c'))
        v, f = lib.box((kx / 100 + 0.5, gf - 0.01, GRILL_H * 0.35), (0.8, 0.02, 0.36))
        knobs.add(v, f, col('#aab4c0'))
    knobs.build('grill_knobs', C.mat_gloss('knob', 0.3, 0.5))
    food = lib.MeshBuilder()
    for k in range(18):
        fx = rnd.uniform(0.3, 19.0)
        v, f = lib.cylinder((fx, (gb + gf) / 2 + rnd.uniform(-0.3, 0.3), GRILL_H + 0.06), 0.16, 0.15, 0.06, 16)
        food.add(v, f, col(rnd.choice(['#6b3a1e', '#7a4424', '#5e3219'])))
    food.build('patties', C.mat_gloss('patty_food', 0.55, 0.2))
    bottles = lib.MeshBuilder()
    for k, bx in enumerate([2.9, 3.05, 7.6, 11.7, 11.85, 16.3]):
        c2 = ['#ff4a3a', '#ffcf2e'][k % 2]
        v, f = lib.lathe([(0.07, 0.0), (0.07, 0.24), (0.05, 0.3), (0.015, 0.36), (0.0, 0.37)], 14, (bx, gf + 0.25, GRILL_H + 0.06))
        bottles.add(v, f, col(c2))
    bottles.build('bottles', C.mat_gloss('bottle', 0.25, 0.8))
    pots = lib.MeshBuilder()
    for px in [5.0, 14.4]:
        v, f = lib.lathe([(0.3, 0.0), (0.33, 0.05), (0.33, 0.42), (0.35, 0.45), (0.0, 0.45)], 24, (px, (gb + gf) / 2, GRILL_H + 0.06), cap_top=False)
        pots.add(v, f, col('#c9d2dc'))
        v, f = lib.lathe([(0.3, 0.38), (0.0, 0.38)], 24, (px, (gb + gf) / 2, GRILL_H + 0.06), cap_bottom=False)
        pots.add(v, f, col('#ffb45a'))
    pots.build('pots', metal)
    plates = lib.MeshBuilder()
    for k in range(7):
        v, f = lib.lathe([(0.28, 0.0), (0.3, 0.03), (0.0, 0.03)], 24, (9.6, (gb + gf) / 2, GRILL_H + 0.06 + k * 0.035))
        plates.add(v, f, col('#fbfbf6'))
    plates.build('plates', C.mat_gloss('plate_stack', 0.2, 0.6))
    # warm lamps hanging over the grill line (their glow reads between the tickets and the cooks)
    lamps, cords = lib.MeshBuilder(), lib.MeshBuilder()
    for lx in [230, 690, 1230, 1690]:
        cx = lx / 100
        lz = (WALL_ROW - 505) / (lib.SINB * 100)
        v, f = lib.lathe([(0.0, 0.25), (0.08, 0.24), (0.22, 0.05), (0.24, 0.0)], 20, (cx, gf + 0.6, lz))
        lamps.add(v, f, col('#ff6b5e'))
        v, f = lib.blob((cx, gf + 0.6, lz - 0.02), 0.09, rough=0.0, subdiv=2)
        cords.add(v, f, col('#fff1b8'))
    lamps.build('lamps', paint)
    cords.build('lamp_bulbs', glow)
    # warm pools of light from the lamps on the wall and the grill
    for lx in [230, 690, 1230, 1690]:
        ld = bpy.data.lights.new(f'lamp_light_{lx}', 'POINT')
        ld.energy = 38.0
        ld.shadow_soft_size = 0.25
        ld.color = col('#ffd49a')[:3]
        ob = bpy.data.objects.new(f'lamp_light_{lx}', ld)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = (lx / 100, gf + 0.45, (WALL_ROW - 505) / (lib.SINB * 100) - 0.35)
    # little shelves of jars under the middle portholes (they show between the tickets)
    shelf, jars, lids = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    sz = (WALL_ROW - 452) / (lib.SINB * 100)
    for sx in [510, 960, 1410]:
        cx = sx / 100
        v, f = lib.box((cx, wy - 0.16, sz), (1.5, 0.3, 0.06))
        shelf.add(v, f, col('#b07a45'))
        for bx in (-0.5, 0.5):
            v, f = lib.box((cx + bx, wy - 0.06, sz - 0.12), (0.05, 0.12, 0.2))
            shelf.add(v, f, col('#8a5a30'))
        for k, (jx, jc, jh) in enumerate([(-0.5, '#7fcf4a', 0.34), (-0.18, '#ff5a4a', 0.26), (0.14, '#ffcf2e', 0.3), (0.46, '#ff9ad5', 0.22)]):
            v, f = lib.lathe([(0.11, 0.0), (0.12, jh * 0.85), (0.08, jh), (0.0, jh)], 16, (cx + jx, wy - 0.18, sz + 0.03))
            jars.add(v, f, col(jc))
            v, f = lib.cylinder((cx + jx, wy - 0.18, sz + 0.03 + jh), 0.085, 0.085, 0.05, 14)
            lids.add(v, f, col('#e0a93f'))
    shelf.build('shelves', wood)
    jars.build('jars', C.mat_gloss('jar_glass', 0.12, 0.9, spec=0.7, subsurface=0.15))
    lids.build('jar_lids', metal)
    # the serving counter the cooks stand behind: a butcher-block top with a brass edge over an
    # aqua front with brass rivets (the game lays each station's controls over it)
    cb, cf = gy(COUNTER_BACK), gy(COUNTER_FRONT)
    ctr = lib.MeshBuilder()
    v, f = lib.box(((x0 + x1) / 2, (cb + cf) / 2, COUNTER_H / 2 - 0.04), (x1 - x0, cb - cf, COUNTER_H - 0.08))
    ctr.add(v, f, col('#48c1b9'))
    ctr.build('counter_body', C.mat_gloss('counter_paint', 0.5, 0.25))
    block = lib.MeshBuilder()
    v, f = lib.box(((x0 + x1) / 2, (cb + cf) / 2 - 0.02, COUNTER_H - 0.04), (x1 - x0, cb - cf + 0.08, 0.1))
    block.add(v, f, col('#d9a066'))
    block.build('counter_top', wood)
    edge = lib.MeshBuilder()
    v, f = lib.tube([(x0, cf - 0.04, COUNTER_H - 0.06), (x1, cf - 0.04, COUNTER_H - 0.06)], 0.04, 8)
    edge.add(v, f, col('#e8b04a'))
    v, f = lib.box(((x0 + x1) / 2, cf - 0.02, 0.1), (x1 - x0, 0.04, 0.2))
    edge.add(v, f, col('#c98a1b'))
    for rx in range(0, 1921, 60):
        for rz in (COUNTER_H - 0.2, 0.3):
            v, f = lib.blob((rx / 100 + 0.3, cf - 0.03, rz), 0.025, rough=0.0, subdiv=1)
            edge.add(v, f, col('#f2c14e'))
    edge.build('counter_brass', metal)
    # a potted sea-plant at each end of the kitchen
    plants = lib.MeshBuilder()
    pots2 = lib.MeshBuilder()
    for (px, py) in [(40, 880), (1880, 880)]:
        w = wp(px, py)
        v, f = lib.lathe([(0.2, 0.0), (0.24, 0.35), (0.26, 0.4), (0.0, 0.4)], 18, (w.x, w.y, 0.0))
        pots2.add(v, f, col('#d9824a'))
        for k in range(5):
            kelp(plants, w.x + rnd.uniform(-0.12, 0.12), w.y, 0.35, rnd.uniform(1.2, 1.8), rnd, 0.1)
    plants.build('plants', dress.mats()['leaf'])
    pots2.build('plant_pots', paint)
    path = C.render('kitchen')
    im = Image.open(path).convert('RGB')
    im = C.upscale_preview(im, (SW, SH))
    if A.preview:
        im.save(os.path.join(C.OUT, 'kitchen_preview.png'))
        return
    C.save_webp(im, 'scene_toons_kitchen.webp')
    front = im.crop((0, FRONT_CUT, SW, SH)).convert('RGBA')
    C.save_webp(front, 'scene_toons_kitchen_front.webp')


# ------------------------------------------------------------------------------------------
def sprites():
    C.start(22.0, 40, A.preview, sun_elev=45, sun_az=-30, key=3.2, fill=0.95)
    gloss = C.mat_gloss('food_gloss', 0.35, 0.35, subsurface=0.08)
    soft = C.mat_matte('food_soft', 0.6, 0.35, sheen=0.3)
    creature = C.mat_gloss('creature', 0.3, 0.6, subsurface=0.1)
    eye = C.mat_gloss('eye', 0.1, 1.0)
    cells = {}

    def cell(name, x, y, w, h, ax, ay):
        cells[name] = (x, y, w, h, ax, ay)

    def at(x, y):
        c = wp(x, y)
        return c.x, c.y

    # every ingredient is modelled resting on the ground at (x, 200); anchor = the bottom centre
    row = 200.0
    # bun bottom
    bx, by = at(120, row)
    mb = lib.MeshBuilder()
    v, f = lib.lathe([(0.0, 0.0), (0.62, 0.0), (0.68, 0.04), (0.7, 0.12), (0.66, 0.2), (0.0, 0.21)], 40, (bx, by, 0.0))
    mb.add(v, f, lambda q: col('#e8a456') if q[2] < 0.16 else col('#f7d9a0'))
    mb.build('bun_bottom', soft)
    cell('bun_bottom', 120 - 95, row - 85, 190, 130, 120, row)
    # bun top: a sesame dome
    bx, by = at(320, row)
    mb, seeds = lib.MeshBuilder(), lib.MeshBuilder()
    prof = [(0.0, 0.0), (0.66, 0.0), (0.71, 0.06)] + [(0.71 * math.cos(t * math.pi / 2) ** 0.8, 0.06 + 0.5 * math.sin(t * math.pi / 2)) for t in [k / 10 for k in range(1, 11)]]
    v, f = lib.lathe(prof, 40, (bx, by, 0.0))
    mb.add(v, f, lambda q: col('#f7d9a0') if q[2] < 0.05 else col('#e59a45'))
    rs = random.Random(3)
    for k in range(26):
        a = rs.uniform(0, math.tau)
        rr = rs.uniform(0.1, 0.6)
        zz = 0.06 + 0.5 * math.sqrt(max(0.0, 1 - (rr / 0.71) ** 2)) + 0.01
        v, f = lib.blob((bx + math.cos(a) * rr, by + math.sin(a) * rr, zz), 0.035, squash=(1.6, 0.9, 0.5), rough=0.0, subdiv=1)
        seeds.add(v, f, col('#fff6dc'))
    mb.build('bun_top', gloss)
    seeds.build('seeds', soft)
    cell('bun_top', 320 - 95, row - 85, 190, 130, 320, row)
    # patty
    bx, by = at(520, row)
    mb = lib.MeshBuilder()
    v, f = lib.lathe([(0.0, 0.0), (0.62, 0.0), (0.68, 0.05), (0.68, 0.14), (0.62, 0.19), (0.0, 0.2)], 40, (bx, by, 0.0))
    mb.add(v, f, lambda q: col('#6b3a1e') if int(q[0] * 30 + q[1] * 17) % 3 else col('#8a4d28'))
    mb.build('patty', C.mat_gloss('patty_mat', 0.55, 0.15))
    cell('patty', 520 - 95, row - 85, 190, 130, 520, row)
    # cheese: a square slice with drooping corners
    bx, by = at(720, row)
    mb = lib.MeshBuilder()
    n = 14
    verts, faces = [], []
    for i in range(n + 1):
        for j in range(n + 1):
            u, w = i / n * 2 - 1, j / n * 2 - 1
            droop = max(0.0, (abs(u) + abs(w)) - 1.0) * 0.16
            verts.append((bx + u * 0.62, by + w * 0.62, 0.06 - droop))
    for i in range(n):
        for j in range(n):
            a = i * (n + 1) + j
            faces.append((a, a + n + 1, a + n + 2, a + 1))
    top = verts
    bot = [(x, y, z - 0.04) for (x, y, z) in verts]
    mb.add(top, faces, col('#ffc62b'))
    mb.add(bot, [tuple(reversed(fc)) for fc in faces], col('#f0a818'))
    mb.build('cheese', C.mat_gloss('cheese_mat', 0.3, 0.3, subsurface=0.2))
    cell('cheese', 720 - 95, row - 85, 190, 130, 720, row)
    # lettuce: a frilly green ring
    bx, by = at(920, row)
    mb = lib.MeshBuilder()
    ring = []
    for k in range(64):
        a = k / 64 * math.tau
        rr = 0.7 + 0.05 * math.sin(a * 9)
        ring.append((math.cos(a) * rr, math.sin(a) * rr, 0.05 + 0.035 * math.sin(a * 13)))
    v = [(bx, by, 0.06)] + [(bx + x, by + y, z) for (x, y, z) in ring] + [(bx + x * 0.97, by + y * 0.97, z - 0.05) for (x, y, z) in ring]
    nn = len(ring)
    f = [(0, 1 + k, 1 + (k + 1) % nn) for k in range(nn)] + [(1 + k, 1 + nn + k, 1 + nn + (k + 1) % nn, 1 + (k + 1) % nn) for k in range(nn)]
    mb.add(v, f, lambda q: col('#8fd84c') if q[2] > 0.04 else col('#4fae3a'))
    mb.build('lettuce', C.mat_gloss('lettuce_mat', 0.4, 0.2, subsurface=0.2))
    cell('lettuce', 920 - 95, row - 85, 190, 130, 920, row)
    # tomato: two red slices side by side
    bx, by = at(1120, row)
    mb, seeds = lib.MeshBuilder(), lib.MeshBuilder()
    for sgn in (-1, 1):
        v, f = lib.lathe([(0.0, 0.0), (0.33, 0.0), (0.36, 0.05), (0.33, 0.1), (0.0, 0.1)], 28, (bx + sgn * 0.3, by, 0.0))
        mb.add(v, f, col('#ff4a3a'))
        for k in range(5):
            a = k / 5 * math.tau
            v, f = lib.blob((bx + sgn * 0.3 + math.cos(a) * 0.17, by + math.sin(a) * 0.17, 0.1), 0.05, squash=(1.2, 0.8, 0.3), rough=0.0, subdiv=1)
            seeds.add(v, f, col('#ffd0a0'))
    mb.build('tomato', C.mat_gloss('tomato_mat', 0.25, 0.6, subsurface=0.15))
    seeds.build('tomato_seeds', soft)
    cell('tomato', 1120 - 95, row - 85, 190, 130, 1120, row)
    # plate
    bx, by = at(1340, row)
    mb = lib.MeshBuilder()
    v, f = lib.lathe([(0.0, 0.03), (0.55, 0.03), (0.78, 0.07), (0.86, 0.1), (0.85, 0.12), (0.76, 0.1), (0.5, 0.06), (0.0, 0.06)], 48, (bx, by, 0.0))
    mb.add(v, f, lambda q: col('#3fb8e8') if math.hypot(q[0] - bx, (q[1] - by)) > 0.72 else col('#fbfbf6'))
    mb.build('plate', C.mat_gloss('plate_mat', 0.15, 0.8))
    C.shadow_catcher(1340, row, 1.4)
    cell('plate', 1340 - 100, row - 50, 200, 100, 1340, row)

    # customers: head-and-shoulders portraits facing the camera (a ring frames them in game)
    crow = 520.0
    # 1. a round blue fish with big lips
    cx, cy = at(160, crow)
    fish, fin, eyes = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    v, f = C.ellipsoid((cx, cy, 0.9), 0.62, 0.5, 0.55)
    fish.add(v, f, lambda q: col('#5aa9ff') if q[2] > 0.72 else col('#bfe3ff'))
    v, f = lib.blob((cx, cy - 0.5, 0.72), 0.16, squash=(1.3, 0.6, 0.8), rough=0.0, subdiv=2)
    fin.add(v, f, col('#ff7aa0'))
    for sgn in (-1, 1):
        v, f = lib.blob((cx + sgn * 0.62, cy, 0.95), 0.2, squash=(0.5, 0.4, 1.3), rough=0.0, subdiv=2)
        fin.add(v, f, col('#3d86e0'))
        v, f = lib.blob((cx + sgn * 0.22, cy - 0.42, 1.12), 0.15, rough=0.0, subdiv=2)
        eyes.add(v, f, col('#ffffff'))
        v, f = lib.blob((cx + sgn * 0.21, cy - 0.55, 1.12), 0.07, rough=0.0, subdiv=2)
        eyes.add(v, f, col('#1d2433'))
    v, f = lib.blob((cx, cy + 0.1, 1.45), 0.15, squash=(0.3, 1.0, 1.3), rough=0.0, subdiv=2)
    fin.add(v, f, col('#3d86e0'))
    fish.build('cust_fish', creature)
    fin.build('cust_fish_fin', creature)
    eyes.build('cust_fish_eye', eye)
    cell('fish', 160 - 95, crow - 170, 190, 190, 160, crow - 70)
    # 2. a yellow seahorse
    cx, cy = at(420, crow)
    sh, crest, eyes = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    v, f = C.ellipsoid((cx, cy, 0.62), 0.3, 0.28, 0.42)
    sh.add(v, f, col('#ffc93a'))
    v, f = C.ellipsoid((cx - 0.05, cy - 0.05, 1.22), 0.3, 0.27, 0.3)
    sh.add(v, f, col('#ffd65a'))
    v, f = lib.tube([(cx - 0.18, cy - 0.15, 1.15), (cx - 0.45, cy - 0.28, 1.08), (cx - 0.58, cy - 0.32, 1.06)], lambda t: 0.1 * (1 - 0.4 * t), 10)
    sh.add(v, f, col('#ffc93a'))
    for k in range(5):
        v, f = lib.blob((cx + 0.2, cy + 0.05, 0.65 + k * 0.18), 0.07, squash=(1.2, 0.5, 0.8), rough=0.0, subdiv=1)
        crest.add(v, f, col('#ff8a3a'))
    for sgn in (-1, 1):
        v, f = lib.blob((cx - 0.12 + sgn * 0.12, cy - 0.24, 1.3), 0.09, rough=0.0, subdiv=2)
        eyes.add(v, f, col('#ffffff'))
        v, f = lib.blob((cx - 0.13 + sgn * 0.12, cy - 0.32, 1.3), 0.045, rough=0.0, subdiv=2)
        eyes.add(v, f, col('#1d2433'))
    sh.build('cust_seahorse', creature)
    crest.build('cust_seahorse_crest', creature)
    eyes.build('cust_seahorse_eye', eye)
    cell('seahorse', 420 - 95, crow - 170, 190, 190, 420, crow - 70)
    # 3. a green sea turtle
    cx, cy = at(680, crow)
    tb, shell, eyes = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    v, f = C.ellipsoid((cx, cy + 0.1, 0.62), 0.6, 0.4, 0.42)
    shell.add(v, f, lambda q: col('#2f8f5a') if int((q[0] - cx) * 7 + 10) % 2 else col('#3fae6a'))
    v, f = C.ellipsoid((cx, cy - 0.28, 1.1), 0.3, 0.28, 0.27)
    tb.add(v, f, col('#8fd48a'))
    for sgn in (-1, 1):
        v, f = lib.blob((cx + sgn * 0.13, cy - 0.5, 1.18), 0.08, rough=0.0, subdiv=2)
        eyes.add(v, f, col('#ffffff'))
        v, f = lib.blob((cx + sgn * 0.13, cy - 0.57, 1.18), 0.04, rough=0.0, subdiv=2)
        eyes.add(v, f, col('#1d2433'))
        v, f = lib.blob((cx + sgn * 0.62, cy - 0.1, 0.62), 0.14, squash=(1.4, 0.5, 0.6), rough=0.0, subdiv=2)
        tb.add(v, f, col('#8fd48a'))
    tb.build('cust_turtle', creature)
    shell.build('cust_turtle_shell', C.mat_gloss('shell_mat', 0.35, 0.6))
    eyes.build('cust_turtle_eye', eye)
    cell('turtle', 680 - 95, crow - 170, 190, 190, 680, crow - 70)
    # 4. a pink jellyfish
    cx, cy = at(940, crow)
    jb, jt, eyes = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    v, f = C.ellipsoid((cx, cy, 1.05), 0.52, 0.45, 0.4)
    v = [(x, y, max(z, 0.9)) for (x, y, z) in v]
    jb.add(v, f, col('#ff9ad5'))
    for k in range(6):
        a = (k + 0.5) / 6 * math.pi
        tx = cx + math.cos(a) * 0.38
        pts = [(tx + math.sin(t * 4 + k) * 0.05, cy - 0.1, 0.9 - t * 0.7) for t in [j / 7 for j in range(8)]]
        v, f = lib.tube(pts, lambda t: 0.05 * (1 - 0.5 * t), 6)
        jt.add(v, f, col('#ffc2e6'))
    for sgn in (-1, 1):
        v, f = lib.blob((cx + sgn * 0.17, cy - 0.4, 1.1), 0.08, rough=0.0, subdiv=2)
        eyes.add(v, f, col('#ffffff'))
        v, f = lib.blob((cx + sgn * 0.17, cy - 0.47, 1.1), 0.04, rough=0.0, subdiv=2)
        eyes.add(v, f, col('#1d2433'))
    jb.build('cust_jelly', C.mat_gloss('jelly_mat', 0.15, 1.0, subsurface=0.4))
    jt.build('cust_jelly_tent', C.mat_gloss('jelly_tent', 0.2, 0.8, subsurface=0.4))
    eyes.build('cust_jelly_eye', eye)
    cell('jelly', 940 - 95, crow - 170, 190, 190, 940, crow - 70)

    W, H = 1460, 560
    C.camera(0, 0, W, H, A.preview)
    path = C.render('patty_sprites')
    im = Image.open(path).convert('RGBA')
    im = C.upscale_preview(im, (W, H))
    frames = {}
    for name, (x, y, w, h, ax, ay) in cells.items():
        img, (ox, oy) = C.crop_alpha(im, (int(x), int(y), int(x + w), int(y + h)))
        frames[name] = (img, (ax - ox, ay - oy))
    if A.preview:
        im.save(os.path.join(C.OUT, 'patty_sprites_preview.png'))
        return
    C.pack_atlas('toons_patty', frames, width=1024)
    burger = C.stack_images([frames[k] for k in ['bun_bottom', 'patty', 'cheese', 'lettuce', 'tomato', 'bun_top']], [19, 18, 7, 9, 10, 0])
    C.save_icon(burger, 'burger')
    C.save_icon(frames['patty'][0], 'patty')
    C.save_icon(frames['fish'][0], 'fish')


{'kitchen': kitchen, 'sprites': sprites}[A.what]()
