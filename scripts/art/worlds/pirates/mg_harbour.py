"""Triple Slash arena: a harbour at golden hour, four cargo chutes running from a moored ship's cargo
doors across the water to the dock where the players stand (1920x1080, opaque, perspective).

    bpyenv/bin/python scripts/art/worlds/pirates/mg_harbour.py [--preview] [--scale 0.5] [--samples 20]
    python3 scripts/build-lite.py --image scene_pirates_harbour.webp

The camera and chute geometry match src/game/worlds/pirates/games/tripleSlashRules.ts (HARBOUR):
a pinhole camera at (0, 0, 3.5) m pitched 15 degrees down, focal length 1300 px across 1920 (24.375 mm
on a 36 mm sensor), looking along +Y. Gameplay runs on the chute floor, z = 0.3 m. Chute i runs from
(NEAR_X[i], Y_NEAR) at the players to (FAR_X[i], Y_FAR) at the ship's cargo doors; its three lanes sit
LANE m apart across it. The cut line is at Y_CUT (drawn in game).
"""
from __future__ import annotations

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import mg_kit as K  # noqa: E402
from mg_kit import col  # noqa: E402

import lib  # noqa: E402
import mg_dress as dress  # noqa: E402
import props  # noqa: E402
from lib import MeshBuilder  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

A = K.parse()
CAM_H, PITCH, FOCAL_PX = 3.5, 15.0, 1300.0
FLOOR_Z = 0.3
Y_NEAR, Y_CUT, Y_FAR = 4.62, 7.0, 32.3
NEAR_X = [-2.872, -0.957, 0.957, 2.872]
FAR_X = [-3.548, -1.183, 1.183, 3.548]
LANE = 0.6
DOCK_Y1 = 7.7
HULL_Y = 32.5      # the ship's side facing the camera (hull centre line HULL_Y + 3.6)
HULL_CY = HULL_Y + 3.6


def camera(scale):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new('cam')
    cd.type = 'PERSP'
    cd.sensor_fit = 'HORIZONTAL'
    cd.sensor_width = 36.0
    cd.lens = FOCAL_PX / K.SW * 36.0
    cd.clip_start = 0.1
    cd.clip_end = 1000.0
    ob = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(ob)
    sc.camera = ob
    ob.location = (0.0, 0.0, CAM_H)
    ob.rotation_euler = (math.radians(90 - PITCH), 0.0, 0.0)
    sc.render.resolution_x = int(round(K.SW * scale))
    sc.render.resolution_y = int(round(K.SH * scale))
    sc.render.resolution_percentage = 100
    return ob


def sky_backdrop():
    """A warm golden-hour gradient on a far backdrop, low sun glow and a few lit cloud banks."""
    m = lib.NT('sky_grad')
    pos = m.position()
    X, Y, Z = m.sep(pos)
    t = m.maprange(Z, 0.0, 160.0, 0.0, 1.0, smooth=False)
    c = m.ramp(t, [(0.0, '#ffd9a0'), (0.12, '#ffc98f'), (0.32, '#f7c7a4'), (0.6, '#a9c8f0'), (1.0, '#6fa4ea')])
    sun_d = m.math('SQRT', m.math('ADD', m.math('POWER', m.math('SUBTRACT', X, 90.0), 2.0), m.math('POWER', m.math('SUBTRACT', Z, 26.0), 2.0)))
    glow = m.maprange(sun_d, 60.0, 0.0)
    c = m.mix(m.math('MULTIPLY', glow, 0.8), c, col('#fff2c8'))
    em = m.node('ShaderNodeEmission')
    m.link(c, em.inputs['Color'])
    em.inputs['Strength'].default_value = 1.0
    m.link(em.outputs['Emission'], m.out.inputs['Surface'])
    lib.mesh_object('sky', [(-600, 420, -40), (600, 420, -40), (600, 420, 420), (-600, 420, 420)], [(0, 1, 2, 3)], smooth=False, material=m.mat)
    cm = dress.cloud_material(shadow='#e7b7a8', glow='#ffd8b0', warm='#fff0da', name='harbour_cloud')
    mb = MeshBuilder()
    for (x, z, s, seed) in [(-170, 70, 26, 1), (-60, 95, 20, 2), (70, 60, 30, 3), (180, 88, 24, 4), (260, 55, 18, 5)]:
        K.clouds(mb, (x, 400, z), s, puffs=10, flat=0.45, seed=seed)
    mb.build('clouds', cm)


def hull():
    """The moored ship: a lofted hull (blunt stern to the left, a sweep up to the bow on the right),
    painted bands, gunports, four glowing cargo doors at the chute ends, deck rail, stern castle."""
    L = 17.5
    B0 = 3.6
    stations = 44
    prof = [(0.0, -1.2), (0.45, -1.05), (0.8, -0.55), (0.95, 0.0), (0.97, 0.12), (0.99, 0.6), (1.0, 1.2), (0.995, 1.9), (0.99, 2.02), (0.985, 2.12), (0.982, 2.28),
            (0.978, 2.4), (0.96, 3.2), (0.955, 3.34), (0.93, 3.5), (0.9, 4.0)]

    def beam(x):
        u = x / L
        if u < 0:
            return B0 * max(0.0, 1 - abs(u) ** 7) ** 0.5
        return B0 * max(0.0, 1 - u ** 2.4) ** 0.65

    def sheer(x):
        u = x / L
        return 4.0 + 0.9 * u * u + (0.6 * u ** 4 if u > 0 else 0.0)

    verts, faces, colors = [], [], []
    rows = len(prof)
    for i in range(stations + 1):
        x = -L + 2 * L * i / stations
        b = beam(x) + 0.02
        top = sheer(x)
        for side in (-1, 1):
            for (py, pz) in prof:
                z = pz if pz < 3.5 else top
                verts.append((x, HULL_CY + side * py * b, z))

                def band(zz):
                    if zz < 0.1:
                        return '#4a2a22'
                    if 2.0 <= zz <= 2.13:
                        return '#f1e3c2'
                    if 2.25 <= zz <= 3.25:
                        return '#b8392e'
                    return '#7a4a2c'
                colors.append(col(band(z)))
    per = rows * 2
    for i in range(stations):
        for side in range(2):
            for j in range(rows - 1):
                a = i * per + side * rows + j
                b = a + per
                faces.append((a, b, b + 1, a + 1) if side == 0 else (a, a + 1, b + 1, b))
    ob = lib.mesh_object('hull', verts, faces, smooth=True, material=K.hull_material('hull_paint'))
    lib.set_point_colors(ob, colors)
    # deck
    deck_pts = []
    for i in range(stations + 1):
        x = -L + 2 * L * i / stations
        deck_pts.append((x, HULL_CY - beam(x) * 0.9, sheer(x) - 0.05))
    for i in range(stations, -1, -1):
        x = -L + 2 * L * i / stations
        deck_pts.append((x, HULL_CY + beam(x) * 0.9, sheer(x) - 0.05))
    lib.mesh_object('ship_deck', deck_pts, [tuple(range(len(deck_pts)))], smooth=False, material=K.m()['planks'])
    PR = props.Prop('ship')
    # rail along the camera side
    rail = [(x, HULL_CY - beam(x) * 0.9 - 0.02, sheer(x) - 0.05) for x in [-L + 2 * L * i / 22 for i in range(23)]]
    K.rail_run(PR.b['wood'], rail, h=0.7, post_every=0.8, post=0.09, top=0.1)
    # wales: dark rub rails along the side, under the gunport band and at the deck edge
    for zw in (0.9, 2.2, 3.36):
        pts = [(x, HULL_CY - beam(x) * (1.0 if zw < 3 else 0.955) - 0.05, zw) for x in [-L + 0.3 + (2 * L - 0.6) * i / 30 for i in range(31)]]
        v, f = lib.tube(pts, 0.07, 6)
        PR.b['wood'].add(v, f, col('#4a2e1c'))
    # gunports with open red lids
    for x in [-12.0, -9.0, -6.0, 6.0, 9.0, 12.0]:
        y = HULL_CY - beam(x) - 0.03
        v, f = lib.box((x, y, 2.8), (0.62, 0.08, 0.55))
        PR.b['paint'].add(v, f, col('#1d1410'))
        lid = [(x - 0.34, y - 0.02, 3.1), (x + 0.34, y - 0.02, 3.1), (x + 0.34, y - 0.42, 3.4), (x - 0.34, y - 0.42, 3.4)]
        PR.b['paint'].add(lid, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#c44a3a'))
    # cargo doors: dark frames with a warm lit interior where the chutes meet the hull
    door_glow = MeshBuilder()
    for x in FAR_X:
        y = HULL_CY - beam(x) - 0.02
        v, f = lib.box((x, y + 0.05, 1.35), (2.2, 0.1, 2.1))
        PR.b['paint'].add(v, f, col('#2a1810'))
        door_glow.add(*lib.box((x, y - 0.03, 1.3), (1.84, 0.04, 1.8)), col('#ffb45c'))
        for dx in (-1.08, 1.08):
            v, f = lib.box((x + dx, y - 0.02, 1.35), (0.14, 0.14, 2.3))
            PR.b['wood'].add(v, f, col('#8a5530'))
        v, f = lib.box((x, y - 0.02, 2.47), (2.4, 0.14, 0.16))
        PR.b['wood'].add(v, f, col('#8a5530'))
        # the open door leaf, swung down onto the chute as a ramp lip
        v, f = lib.box((x, y - 0.35, FLOOR_Z + 0.04), (1.9, 0.7, 0.06))
        PR.b['wood'].add(v, f, col('#9a643a'))
    door_glow.build('cargo_glow', K.emissive_mat('cargo_glow_mat', '#ffb45c', 1.6))
    # stern castle with glowing windows and a big lantern
    sx0, sx1 = -L - 0.2, -11.5
    zt = sheer(-12.0)
    v, f = lib.box(((sx0 + sx1) / 2, HULL_CY, zt + 1.2), (sx1 - sx0, 2 * B0 * 0.9, 2.4))
    PR.b['wood'].add(v, f, col('#7a4a2a'))
    for k in range(4):
        x = sx0 + 0.9 + k * 1.3
        v, f = lib.box((x, HULL_CY - B0 * 0.9 - 0.02, zt + 1.3), (0.6, 0.06, 0.8))
        PR.b['glow'].add(v, f, col('#ffd08a'))
    K.rail_run(PR.b['wood'], [(sx0, HULL_CY - B0 * 0.88, zt + 2.4), (sx1, HULL_CY - B0 * 0.88, zt + 2.4)], h=0.6, post_every=0.7, post=0.08, top=0.09)
    iron, glow = MeshBuilder(), MeshBuilder()
    K.lantern(iron, glow, sx0 + 0.2, HULL_CY - B0 * 0.9, zt + 3.6, s=2.2)
    v, f = lib.cylinder((sx0 + 0.2, HULL_CY - B0 * 0.9, zt + 2.4), 0.05, 0.05, 1.3, 6)
    iron.add(v, f, col('#2f2b2c'))
    iron.build('ship_lantern_iron', K.m()['iron'])
    glow.build('ship_lantern_glow', props.mats()['glow'])
    # bowsprit
    v, f = lib.tube([(L - 1.0, HULL_CY, sheer(L - 1.0) + 0.2), (L + 6.0, HULL_CY, sheer(L) + 3.2)], lambda t: 0.22 - 0.12 * t, 10)
    PR.b['wood'].add(v, f, col('#7b4f2e'))
    PR.build()
    # masts with sails facing the camera (a toy ship's broadside), pennants at the tops
    sails = MeshBuilder()
    MP = props.Prop('ship_masts')
    for (mx, mh, half) in [(-7.5, 15.0, 3.6), (1.0, 17.0, 4.2), (9.0, 13.5, 3.2)]:
        z0 = sheer(mx) - 0.05
        K.mast(MP, sails, mx, HULL_CY, z0, h=mh, r=0.24, yards=[(mh * 0.9, half * 0.7), (mh * 0.68, half * 0.85), (mh * 0.44, half)], furled=False, nest=True)
    MP.build()
    sails.build('ship_sails', K.m()['sail'])
    rig = MeshBuilder()
    for (mx, mh) in [(-7.5, 15.0), (1.0, 17.0), (9.0, 13.5)]:
        z0 = sheer(mx)
        for dx in (-2.4, -1.2, 1.2, 2.4):
            K.rope_line(rig, (mx + dx, HULL_CY - B0 * 0.92, z0 + 0.6), (mx, HULL_CY, z0 + mh * 0.95), sag=0.0, thick=0.03, tint='#3e3024')
    K.rope_line(rig, (-7.5, HULL_CY, sheer(-7.5) + 15.0), (1.0, HULL_CY, sheer(1.0) + 17.0), sag=0.3, thick=0.03, tint='#3e3024')
    K.rope_line(rig, (1.0, HULL_CY, sheer(1.0) + 17.0), (9.0, HULL_CY, sheer(9.0) + 13.5), sag=0.3, thick=0.03, tint='#3e3024')
    K.rope_line(rig, (9.0, HULL_CY, sheer(9.0) + 13.5), (L + 6.0, HULL_CY, sheer(L) + 3.2), sag=0.2, thick=0.03, tint='#3e3024')
    rig.build('rigging', K.m()['rope'])
    for (mx, mh, c) in [(-7.5, 15.0, K.PLAYER[0]), (1.0, 17.0, K.PLAYER[1]), (9.0, 13.5, K.PLAYER[2])]:
        top = Vector((mx, HULL_CY, sheer(mx) + mh + 0.1))
        cloth = MeshBuilder()
        pts = [(top.x, top.y, top.z), (top.x + 2.6, top.y, top.z - 0.3), (top.x, top.y, top.z - 0.7)]
        cloth.add(pts, [(0, 1, 2), (2, 1, 0)], col(c))
        cloth.build(f'pennant_{mx}', K.m()['cloth'])


def chute_frame(i):
    """Chute i's centre line (near point, far point) and its unit direction and normal in the floor."""
    a = Vector((NEAR_X[i], Y_NEAR - 0.9, 0.0))
    b = Vector((FAR_X[i], Y_FAR + 0.3, 0.0))
    d = (b - a).normalized()
    n = Vector((d.y, -d.x, 0.0))
    return a, b, d, n


def chutes():
    """Four raised wooden troughs: a planked floor with three shallow grooves, side rails, and pilings
    with cross braces wherever they cross open water."""
    floor = MeshBuilder()
    trim = MeshBuilder()
    piles = MeshBuilder()
    for i in range(4):
        a, b, d, n = chute_frame(i)
        half = LANE * 1.5 + 0.05
        L = (b - a).length
        # floor slab
        corners = [a - n * half, a + n * half, b + n * half, b - n * half]
        top = [(c.x, c.y, FLOOR_Z) for c in corners]
        bot = [(c.x, c.y, FLOOR_Z - 0.18) for c in corners]
        floor.add(top + bot, [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], col('#b98452'))
        # side rails and lane dividers
        for off, w, h, tint in [(-half - 0.04, 0.1, 0.16, '#7a4a2a'), (half + 0.04, 0.1, 0.16, '#7a4a2a'), (-LANE / 2, 0.035, 0.03, '#8d5a33'), (LANE / 2, 0.035, 0.03, '#8d5a33')]:
            p0 = a + n * off
            p1 = b + n * off
            mid = (p0 + p1) / 2
            ang = math.atan2(d.y, d.x)
            v, f = lib.box((mid.x, mid.y, FLOOR_Z + h / 2), (L, w, h), rot_z=ang)
            trim.add(v, f, col(tint))
        # pilings over the water
        k = 0
        while True:
            t = (DOCK_Y1 + 1.2 + k * 2.6 - a.y) / (b.y - a.y)
            if t >= 0.98:
                break
            q = a + (b - a) * t
            for s in (-1, 1):
                p = q + n * s * (half + 0.02)
                v, f = lib.cylinder((p.x, p.y, -1.5), 0.13, 0.12, FLOOR_Z - 0.1 + 1.5, 10)
                piles.add(v, f, col('#6a4a34'))
            p0, p1 = q - n * (half + 0.02), q + n * (half + 0.02)
            v, f = lib.tube([(p0.x, p0.y, FLOOR_Z - 0.28), (p1.x, p1.y, FLOOR_Z - 0.28)], 0.06, 6)
            piles.add(v, f, col('#5e3f2a'))
            k += 1
    floor.build('chute_floor', K.plank_material('chute_planks', light='#d09a62', dark='#b07c4c', seam='#553520', plank_w=0.24, plank_l=2.3, along='x'))
    trim.build('chute_trim', props.mats()['wood'])
    piles.build('pilings', props.mats()['wood'])


def dock():
    """The near dock the players stand on: planks, a front beam, bollards, ropes, lanterns, cargo."""
    x0, x1 = -14.0, 14.0
    y0, y1 = 3.2, DOCK_Y1
    top = FLOOR_Z - 0.05  # the chutes stand a little proud of the dock (never coplanar)
    slab = MeshBuilder()
    v, f = lib.box(((x0 + x1) / 2, (y0 + y1) / 2, top - 0.2), (x1 - x0, y1 - y0, 0.4))
    slab.add(v, f, col('#b07a48'))
    slab.build('dock', K.plank_material('dock_planks', light='#c48d58', dark='#a2703f', seam='#4a2e1c', plank_w=0.28, plank_l=2.6, along='x'))
    PR = props.Prop('dock_props')
    v, f = lib.box(((x0 + x1) / 2, y1 + 0.02, top - 0.12), (x1 - x0, 0.2, 0.3))
    PR.b['wood'].add(v, f, col('#6a4024'))
    for x in [-5.6, -4.25, 0.0, 4.25, 5.6, -8.5, 8.5]:
        v, f = lib.lathe([(0.18, 0.0), (0.16, 0.3), (0.2, 0.36), (0.22, 0.42), (0.0, 0.46)], 14, (x, y1 - 0.3, top))
        PR.b['metal'].add(v, f, col('#3a3c44'))
    rope = MeshBuilder()
    K.rope_coil(rope, -6.6, 6.2, top, r=0.34)
    K.rope_coil(rope, 7.1, 5.4, top, r=0.3, turns=3)
    rope.build('dock_rope', K.m()['rope'])
    iron, glow = MeshBuilder(), MeshBuilder()
    for x in (-5.9, 5.9):
        v, f = lib.cylinder((x, 6.9, top), 0.07, 0.06, 2.6, 8)
        PR.b['wood'].add(v, f, col('#5e3b22'))
        v, f = lib.box((x + (0.25 if x < 0 else -0.25), 6.9, top + 2.55), (0.55, 0.06, 0.06))
        PR.b['wood'].add(v, f, col('#5e3b22'))
        K.lantern(iron, glow, x + (0.45 if x < 0 else -0.45), 6.9, top + 2.5, s=1.2)
    iron.build('dock_lantern_iron', K.m()['iron'])
    glow.build('dock_lantern_glow', props.mats()['glow'])
    wood, metal = MeshBuilder(), MeshBuilder()
    for (x, y, s, r) in [(-7.4, 5.2, 0.9, 0.2), (-8.3, 6.1, 0.8, -0.3), (-7.8, 5.6, 0.7, 0.5)]:
        K.crate(wood, x, y, top + (0.9 if s == 0.7 else 0.0), s=s, rot=r)
    for (x, y) in [(7.3, 6.3), (8.1, 5.8), (7.8, 6.9)]:
        K.barrel(wood, metal, x, y, top, r=0.36, h=0.9)
    K.barrel(wood, metal, 8.8, 4.9, top + 0.34, r=0.34, h=0.86, rot=(0.0, math.pi / 2, 0.6))
    wood.build('dock_cargo', props.mats()['wood'])
    metal.build('dock_hoops', K.m()['iron'])
    PR.build()


def quays():
    """The harbour either side: a stone quay with warehouses and a jib crane on the left, a tavern,
    striped market awnings and bunting on the right, and a lighthouse out on the far point."""
    stone = props.mats()['stone_big']
    for (xa, xb) in [(-60.0, -9.0), (9.0, 60.0)]:
        v, f = lib.box(((xa + xb) / 2, 36.0, 0.25), (xb - xa, 58.0, 0.9))
        ob = lib.mesh_object(f'quay_{xa}', v, f, smooth=False, material=stone)
        lib.set_point_colors(ob, [col('#d8cbb8')] * len(v))
    PR = props.Prop('town')
    rnd = random.Random(5)
    for (x, y, w, d, h, roof) in [(-15, 14, 5.5, 5, 4.2, '#c0533e'), (-16, 24, 6, 6, 5.5, '#a9443a'), (-15, 36, 6.5, 6, 5.0, '#c96a3a'), (-17, 50, 7, 7, 6.2, '#b0483c'),
                                  (15.5, 18, 6, 6, 4.8, '#3f7fb0'), (16, 31, 6.5, 6, 5.8, '#c0533e'), (17, 46, 7, 7, 5.2, '#4a8a5c')]:
        v, f = lib.box((x, y, 0.7 + h / 2), (w, d, h))
        PR.b['paint'].add(v, f, col(rnd.choice(['#f1e3c6', '#e8d5b0', '#f4ecd8', '#e0c8a0'])))
        ridge = [(x - w / 2 - 0.3, y - d / 2 - 0.3, 0.7 + h), (x + w / 2 + 0.3, y - d / 2 - 0.3, 0.7 + h), (x + w / 2 + 0.3, y, 0.7 + h + 2.2), (x - w / 2 - 0.3, y, 0.7 + h + 2.2),
                 (x - w / 2 - 0.3, y + d / 2 + 0.3, 0.7 + h), (x + w / 2 + 0.3, y + d / 2 + 0.3, 0.7 + h)]
        PR.b['paint'].add(ridge, [(0, 1, 2, 3), (3, 2, 5, 4), (0, 3, 4), (1, 5, 2)], col(roof))
        side = 1 if x < 0 else -1
        for k in range(3):
            v, f = lib.box((x + side * (w / 2 + 0.02), y - d / 3 + k * d / 3, 0.7 + h * 0.6), (0.06, 0.8, 1.0))
            PR.b['glow'].add(v, f, col('#ffcf7a'))
        v, f = lib.box((x + side * (w / 2 + 0.03), y, 1.7), (0.08, 1.4, 2.0))
        PR.b['wood'].add(v, f, col('#6a4024'))
    # market awnings on the right quay
    for k, y in enumerate([11.0, 13.5, 16.0]):
        x = 10.8
        stripe = ['#ff6b5e', '#1fa5a0', '#f4b83b'][k]
        v, f = lib.box((x, y, 1.4), (1.8, 2.0, 1.0))
        PR.b['wood'].add(v, f, col('#8a5530'))
        for j in range(6):
            yy = y - 1.0 + j * 0.4 + 0.2
            aw = [(x - 1.1, yy - 0.2, 2.6), (x - 1.1, yy + 0.2, 2.6), (x + 1.2, yy + 0.2, 2.2), (x + 1.2, yy - 0.2, 2.2)]
            PR.b['paint'].add(aw, [(0, 1, 2, 3), (3, 2, 1, 0)], col(stripe if j % 2 == 0 else '#fff4dc'))
    # jib crane with a cargo net on the left quay
    cx, cy = -10.5, 20.0
    v, f = lib.cylinder((cx, cy, 0.7), 0.3, 0.25, 6.0, 10)
    PR.b['wood'].add(v, f, col('#7a4a2a'))
    v, f = lib.tube([(cx, cy, 6.3), (cx + 4.0, cy - 1.5, 7.3)], 0.16, 8)
    PR.b['wood'].add(v, f, col('#8a5530'))
    v, f = lib.tube([(cx, cy, 3.2), (cx + 4.0, cy - 1.5, 7.2)], 0.08, 6)
    PR.b['wood'].add(v, f, col('#6a4024'))
    v, f = lib.tube([(cx + 4.0, cy - 1.5, 7.2), (cx + 4.0, cy - 1.5, 4.2)], 0.025, 4)
    PR.b['wood'].add(v, f, col('#3e3024'))
    v, f = lib.blob((cx + 4.0, cy - 1.5, 3.6), 0.7, squash=(1.0, 1.0, 0.9), rough=0.2, subdiv=2)
    PR.b['paint'].add(v, f, col('#c9a06a'))
    PR.build()
    K.pennant_line((9.3, 10.0, 3.2), (9.3, 22.0, 3.6), n=12, sag=0.5, size=0.35, name='quay_pennants_r')
    K.pennant_line((-9.3, 10.0, 3.2), (-9.3, 24.0, 3.8), n=12, sag=0.5, size=0.35, colors=K.PLAYER, name='quay_pennants_l')
    LH = props.Prop('lighthouse')
    K.lighthouse(LH, 46.0, 118.0, 2.0, s=3.2)
    LH.build()
    rocks = MeshBuilder()
    for k, (x, y, r) in enumerate([(44, 116, 5.0), (50, 121, 3.6), (39, 113, 3.0), (-70, 150, 9.0), (-58, 160, 6.0), (-80, 170, 7.0)]):
        K.rock(rocks, x, y, 0.0, r, seed=k, squash=(1.2, 1.0, 0.55), tint='#9a9282')
    rocks.build('far_rocks', K.m()['rock'])
    isle = MeshBuilder()
    for k, (x, y, r) in enumerate([(-66, 152, 7.0), (-78, 168, 6.0)]):
        v, f = lib.blob((x, y, 3.0), r * 0.9, squash=(1.3, 1.0, 0.6), rough=0.2, subdiv=2, seed=k + 20)
        isle.add(v, f, col('#4f9a45'))
    isle.build('isle_green', K.m()['leaf'])


def main():
    samples = A.samples or (10 if A.preview else 22)
    K.start(samples)
    sc = bpy.context.scene
    sc.render.film_transparent = False
    lib.world_light(0.85, zenith='#8fb8f0', horizon='#ffd9b0', ground='#b09a80')
    lib.sun(energy=3.3, elevation=26, azimuth=28, angle=3.0, color='#ffd8a4')
    scale = A.scale or (0.4 if A.preview else 1.0)
    camera(scale)
    sky_backdrop()
    sea = K.sea_material('harbour_sea', deep='#0e6384', mid='#1b8aae', light='#48bcd2', foam_amt=0.55, wave_scale=0.16)
    K.plane('sea', -300, -5, 300, 419, 0.0, sea)
    hull()
    chutes()
    dock()
    quays()
    out = os.path.join(K.OUT, 'harbour_preview.png' if A.preview else 'harbour.png')
    if A.dry:
        print('dry run: scene built,', len(bpy.data.objects), 'objects')
        return
    lib.render_to(out)
    if not A.preview:
        K.publish_webp(out, 'pirates_harbour')
    print('done', out)


main()
