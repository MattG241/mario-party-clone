"""Coffee Rush arena: a pastel café on the Showtime Strip, and its espresso machine sprite.

    .../with-blender-lock .../bpyenv/bin/python scripts/art/worlds/showtime/mg_cafe.py scene|machine [--preview] [--samples N]

scene   Front view (22 deg) of a pastel café: striped pink wallpaper, two arched windows onto the sky
        (left open, so the game's sky shows through), shelves of cups and jars, a chalkboard of doodles,
        pendant lamps, a back counter of cakes and syrups, a long marble-topped counter with a fluted
        pink front, and a pink-and-cream checkerboard floor with bistro corners. Two images:
          scene_showtime_cafe.webp          the whole café
          scene_showtime_cafe_counter.webp  just the front counter (drawn over the baristas' legs)
        Layout the game relies on (CoffeeRush.ts): baristas stand behind the counter on row 612; the
        counter's front face runs from row 690 up to y ~593 and its top back edge is at y ~565; the
        machines stand on it at y 579; customers queue on the floor in front (rows 780..1000).
machine A retro espresso machine (mint enamel, chrome, a pressure dial, a pull lever, a steam wand),
        rendered alone with the same camera: public/assets/rendered/mg/showtime_espresso.webp, anchored
        at its base (see ANCHOR below; CoffeeRush.ts keeps the same numbers).
No text, logos or insignia anywhere.
"""
from __future__ import annotations

import json
import math
import os
import random

import mg_kit as K
from mg_kit import Kit, PX, col, ground, row_y, wp, z_of, zpx

import lib
import bpy
from mathutils import Vector
from PIL import Image

A = K.args(['scene', 'machine'])
rnd = random.Random(11)

ELEV = 22
WALL_ROW = 520
BACK_ROW = 548
COUNTER_ROW = 690
COUNTER_DEPTH = 0.75
COUNTER_H = 1.05
WINDOWS = [(380, 580), (1340, 1540)]
WIN_TOP, WIN_BOT = 150, 395


def floor_material():
    m = lib.NT('cafe_tiles')
    pos = m.position()
    ch = m.node('ShaderNodeTexChecker')
    ch.inputs['Scale'].default_value = 1.0
    mp = m.node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / 1.0, 1 / 1.0, 1.0)
    m.link(pos, mp.inputs['Vector'])
    m.link(mp.outputs['Vector'], ch.inputs['Vector'])
    ch.inputs['Color1'].default_value = col('#ffd3e0')
    ch.inputs['Color2'].default_value = col('#fff6ec')
    n = m.noise(4.0, 3, 0.5, pos)
    c = m.mult(ch.outputs['Color'], m.mix(n.outputs['Fac'], col('#eee4e2'), col('#ffffff')))
    c = m.mult(c, m.mix(m.ao(0.7, 8), col('#9a7f8e'), col('#ffffff')))
    m.bsdf(c, 0.3, coat=0.5)
    return m.mat


def planks_material():
    m = lib.NT('cafe_planks')
    pos = m.position()
    X, Y, Z = m.sep(pos)
    wv = m.node('ShaderNodeTexWave')
    wv.wave_type = 'BANDS'
    wv.bands_direction = 'X'
    wv.inputs['Scale'].default_value = 1.6
    wv.inputs['Distortion'].default_value = 2.0
    m.link(pos, wv.inputs['Vector'])
    c = m.mix(wv.outputs['Fac'], col('#c98f63'), col('#e2b087'))
    c = m.mult(c, m.mix(m.ao(0.6, 8), col('#7a5a50'), col('#ffffff')))
    m.bsdf(c, 0.55)
    return m.mat


def wallpaper_material():
    m = lib.NT('cafe_wallpaper')
    pos = m.position()
    X, Y, Z = m.sep(pos)
    stripes = m.math('SINE', m.math('MULTIPLY', X, math.tau / 0.5))
    fac = m.maprange(stripes, -0.1, 0.1)
    c = m.mix(fac, col('#ffc9da'), col('#fff0e8'))
    dots = m.voronoi(9.0, pos)
    d = m.maprange(dots.outputs['Distance'], 0.08, 0.05)
    c = m.mix(m.math('MULTIPLY', d, 0.5), c, col('#ffffff'))
    c = m.mult(c, m.mix(m.ao(0.8, 8), col('#b48a9a'), col('#ffffff')))
    m.bsdf(c, 0.7)
    return m.mat


def marble_material():
    m = lib.NT('cafe_marble')
    pos = m.position()
    n = m.noise(1.6, 6, 0.65, pos, dist=4.0)
    veins = m.maprange(n.outputs['Fac'], 0.47, 0.5)
    c = m.mix(m.math('MULTIPLY', m.math('SUBTRACT', 1.0, veins), 0.22), col('#fdfaf8'), col('#d8cfd4'))
    m.bsdf(c, 0.18, coat=0.8, spec=0.6)
    return m.mat


def wall():
    y = row_y(WALL_ROW)
    z1 = z_of(WALL_ROW, -40)
    # the wall with two arched window openings (left open: the game's sky shows through)
    wm = wallpaper_material()
    verts, faces = [], []

    def arch_hole(x0, x1):
        # outline of an arched window (screen px), bottom-left going round clockwise over the top
        pts = [(x0, WIN_BOT)]
        r = (x1 - x0) / 2
        cy = WIN_TOP + r
        for i in range(17):
            a = math.pi + i / 16 * math.pi
            pts.append(((x0 + x1) / 2 + math.cos(a) * r, cy + math.sin(a) * r))
        pts.append((x1, WIN_BOT))
        return pts
    # build the wall as vertical strips between/around the windows (simple and robust)
    strips = [(0, WINDOWS[0][0]), (WINDOWS[0][1], WINDOWS[1][0]), (WINDOWS[1][1], 1920)]
    for (a, b) in strips:
        v = [(a / PX, y, 0), (b / PX, y, 0), (b / PX, y, z1), (a / PX, y, z1)]
        base = len(verts)
        verts += v
        faces.append((base, base + 1, base + 2, base + 3))
    for (x0, x1) in WINDOWS:
        # below the window
        v = [(x0 / PX, y, 0), (x1 / PX, y, 0), (x1 / PX, y, z_of(WALL_ROW, WIN_BOT)), (x0 / PX, y, z_of(WALL_ROW, WIN_BOT))]
        base = len(verts)
        verts += v
        faces.append((base, base + 1, base + 2, base + 3))
        # above the arch: a fan from the arch outline up to the wall top
        hole = arch_hole(x0, x1)
        top_pts = [(x0 + (x1 - x0) * i / (len(hole) - 1), -40) for i in range(len(hole))]
        for i in range(len(hole) - 1):
            a0, a1 = hole[i], hole[i + 1]
            t0, t1 = top_pts[i], top_pts[i + 1]
            quad = [a0, a1, t1, t0]
            base = len(verts)
            verts += [(p[0] / PX, y, z_of(WALL_ROW, p[1])) for p in quad]
            faces.append((base, base + 1, base + 2, base + 3))
    lib.mesh_object('cafe_wall', verts, faces, smooth=False, material=wm)
    k = Kit('wall_deco')
    # window frames, sills and gingham half-curtains
    for (x0, x1) in WINDOWS:
        r = (x1 - x0) / 2
        cxp = (x0 + x1) / 2
        cy = WIN_TOP + r
        pts = []
        for i in range(25):
            a = math.pi + i / 24 * math.pi
            pts.append(wp(cxp + math.cos(a) * (r + 6), WALL_ROW + 3, cy + math.sin(a) * (r + 6)))
        v, f = lib.tube([wp(x0 - 6, WALL_ROW + 3, WIN_BOT)] + pts + [wp(x1 + 6, WALL_ROW + 3, WIN_BOT)], 0.07, 8)
        k['gloss'].add(v, f, col('#7fd8c4'))
        v, f = lib.tube([wp(cxp, WALL_ROW + 3, WIN_BOT), wp(cxp, WALL_ROW + 3, WIN_TOP)], 0.035, 6)
        k['gloss'].add(v, f, col('#7fd8c4'))
        v, f = lib.tube([wp(x0, WALL_ROW + 3, (WIN_TOP + r + WIN_BOT) / 2), wp(x1, WALL_ROW + 3, (WIN_TOP + r + WIN_BOT) / 2)], 0.035, 6)
        k['gloss'].add(v, f, col('#7fd8c4'))
        g = ground(cxp, WALL_ROW + 8, z_of(WALL_ROW, WIN_BOT))
        v, f = lib.box((g[0], g[1], g[2] - 0.04), ((x1 - x0) / PX + 0.3, 0.3, 0.08))
        k['gloss'].add(v, f, col('#7fd8c4'))
        K.curtain(k['velvet'], x0 + 2, x1 - 2, WALL_ROW + 5, (WIN_TOP + r + WIN_BOT) / 2 + 4, WIN_BOT - 4, '#ff9ec0', folds=5, amp=0.05)
        # a little plant on each sill
        v, f = lib.lathe([(0.0, 0.0), (0.12, 0.0), (0.15, 0.2), (0.0, 0.2)], 12, (g[0] + 0.55, g[1] - 0.05, g[2]))
        k['paint'].add(v, f, col('#ffb86b'))
        for j in range(6):
            v, f = lib.blob((g[0] + 0.55 + rnd.uniform(-0.1, 0.1), g[1] - 0.05, g[2] + 0.28 + rnd.uniform(0, 0.12)), 0.09, rough=0.25, subdiv=1, seed=j)
            k['leaf'].add(v, f, col(rnd.choice(['#3f9b45', '#56b04c'])))
    # floating shelves with cups, jars and plants between the stations
    for (sx0, sx1, sy) in [(620, 900, 250), (1020, 1300, 250), (60, 330, 300), (1590, 1860, 300)]:
        g = ground((sx0 + sx1) / 2, WALL_ROW + 12, z_of(WALL_ROW, sy))
        v, f = lib.box((g[0], g[1], g[2]), ((sx1 - sx0) / PX, 0.34, 0.07))
        k['wood'].add(v, f, col('#e8c49a'))
        x = sx0 + 20
        while x < sx1 - 20:
            kind = rnd.random()
            gx = x / PX
            if kind < 0.4:
                v, f = lib.lathe([(0.0, 0.0), (0.1, 0.0), (0.12, 0.16), (0.11, 0.18), (0.0, 0.18)], 12, (gx, g[1], g[2] + 0.035))
                k['gloss'].add(v, f, col(rnd.choice(['#ff9ec0', '#9fe3d0', '#ffe39a', '#b9c8ff', '#fff6ec'])))
                x += 34
            elif kind < 0.7:
                v, f = lib.lathe([(0.0, 0.0), (0.1, 0.0), (0.11, 0.28), (0.07, 0.32), (0.07, 0.36), (0.0, 0.36)], 12, (gx, g[1], g[2] + 0.035))
                k['glass'].add(v, f, col(rnd.choice(['#ffe0c8', '#ffd1e0', '#e8f7ff'])))
                v, f = lib.cylinder((gx, g[1], g[2] + 0.035), 0.085, 0.085, 0.18, 10)
                k['paint'].add(v, f, col(rnd.choice(['#8a5a3a', '#ffb3c8', '#f2d19b'])))
                x += 36
            else:
                v, f = lib.lathe([(0.0, 0.0), (0.1, 0.0), (0.13, 0.18), (0.0, 0.18)], 12, (gx, g[1], g[2] + 0.035))
                k['paint'].add(v, f, col('#ffffff'))
                for j in range(7):
                    v, f = lib.blob((gx + rnd.uniform(-0.12, 0.12), g[1], g[2] + 0.28 + rnd.uniform(0, 0.16)), 0.08, rough=0.25, subdiv=1, seed=j + x)
                    k['leaf'].add(v, f, col(rnd.choice(['#3f9b45', '#56b04c', '#2f8a3c'])))
                x += 48
    # a chalkboard of doodles (cups, hearts, stars: no words)
    cx0, cx1, cy0, cy1 = 800, 1120, 120, 215
    K.quad_v(k['matte'], cx0, cx1, WALL_ROW + 2, cy0, cy1, '#2f4a45', depth=0.0)
    for (x0, x1, y0, y1) in [(cx0 - 8, cx1 + 8, cy0 - 8, cy0), (cx0 - 8, cx1 + 8, cy1, cy1 + 8), (cx0 - 8, cx0, cy0, cy1), (cx1, cx1 + 8, cy0, cy1)]:
        K.quad_v(k['wood'], x0, x1, WALL_ROW + 3, y0, y1, '#e8c49a', depth=0.03)
    for (dx, dy, kind, c) in [(850, 168, 'cup', '#ffe0ee'), (930, 150, 'heart', '#ff9ec0'), (990, 175, 'cup', '#bff0e2'), (1060, 160, 'star', '#ffe39a'), (1090, 190, 'heart', '#ffe0ee'), (890, 195, 'star', '#bff0e2')]:
        p = wp(dx, WALL_ROW + 4, dy)
        if kind == 'heart':
            pts = [(math.sin(t) ** 3 * 0.16, (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 16 * 0.16) for t in [i / 24 * math.tau for i in range(24)]]
            K.flat_shape(k['matte'], pts, p, c, 0.01)
        elif kind == 'star':
            K.flat_shape(k['matte'], K.star_pts(5, 0.14, 0.06), p, c, 0.01)
        else:
            K.flat_shape(k['matte'], [(-0.14, 0.1), (0.14, 0.1), (0.1, -0.12), (-0.1, -0.12)], p, c, 0.01)
            K.flat_shape(k['matte'], [(0.14, 0.06), (0.22, 0.02), (0.14, -0.04)], p, c, 0.01)
    # pendant lamps
    for sx in (160, 520, 960, 1400, 1760):
        top = wp(sx, 640, -60)
        bot = wp(sx, 640, 105)
        v, f = lib.tube([top, bot], 0.012, 5)
        k['wood'].add(v, f, col('#6b5a50'))
        v, f = lib.lathe([(0.04, 0.0), (0.1, -0.05), (0.3, -0.3), (0.32, -0.34)], 18, (bot[0], bot[1], bot[2]), cap_bottom=False, cap_top=True)
        k['gloss'].add(v, f, col(['#9fe3d0', '#ff9ec0', '#ffe39a', '#ff9ec0', '#9fe3d0'][[160, 520, 960, 1400, 1760].index(sx)]))
        v, f = lib.blob((bot[0], bot[1], bot[2] - 0.3), 0.11, rough=0.0, subdiv=2)
        k['bulb'].add(v, f, col('#fff2c8'))
    # a pastel pennant garland swagged between the lamps
    import mg_dress as dress
    for (a, b) in [(160, 520), (520, 960), (960, 1400), (1400, 1760)]:
        pa = wp(a, 645, 70)
        pb = wp(b, 645, 70)
        dress.pennant_swag(pa, pb, sag=0.45, n=7, size=0.2, colors=['#ff9ec0', '#9fe3d0', '#ffe39a', '#c9b8ff', '#fff6ec'], name=f'swag{a}')
    # a pink ceiling beam across the top
    K.quad_v(k['paint'], 0, 1920, 700, -60, 22, '#ff9ec0', depth=0.4)
    k.build()


def back_counter():
    k = Kit('back_counter')
    g = ground(960, (WALL_ROW + BACK_ROW) / 2)
    d = (BACK_ROW - WALL_ROW) / (PX * lib.COSB)
    H = 0.85
    v, f = lib.box((g[0], g[1], H / 2), (19.4, d, H))
    k['paint'].add(v, f, col('#fff3e8'))
    v, f = lib.box((g[0], g[1], H + 0.02), (19.5, d + 0.06, 0.05))
    k['gloss'].add(v, f, col('#fbf8f6'))
    # mint cabinet doors with little gold knobs
    for i in range(24):
        sx = 40 + i * 80
        p = wp(sx + 40, BACK_ROW + 1, None, H * 0.5)
        v, f = lib.box((p[0], p[1] - 0.01, p[2]), (0.66, 0.02, H * 0.7))
        k['paint'].add(v, f, col('#a8e6d6'))
        v, f = lib.blob((p[0] + (0.24 if i % 2 else -0.24), p[1] - 0.03, p[2]), 0.035, rough=0.0, subdiv=1)
        k['metal'].add(v, f, col('#e8b04a'))
    # goods along it: cake stands, syrup bottles, cup stacks, jars
    x = 60
    while x < 1880:
        gx = x / PX
        kind = rnd.random()
        if kind < 0.18:
            v, f = lib.lathe([(0.0, 0.0), (0.14, 0.0), (0.05, 0.03), (0.04, 0.2), (0.3, 0.22), (0.3, 0.24), (0.0, 0.24)], 18, (gx, g[1], 0.89))
            k['glass'].add(v, f, col('#f4fbff'))
            v, f = lib.cylinder((gx, g[1], 1.13), 0.22, 0.22, 0.2, 18)
            k['paint'].add(v, f, col(rnd.choice(['#ff9ec0', '#fff0c8', '#c9a0ff'])))
            v, f = lib.cylinder((gx, g[1], 1.33), 0.23, 0.2, 0.04, 18)
            k['paint'].add(v, f, col('#fff6ec'))
            v, f = lib.blob((gx, g[1] - 0.05, 1.41), 0.05, rough=0.0, subdiv=1)
            k['gloss'].add(v, f, col('#ff3b5c'))
            x += 70
        elif kind < 0.45:
            for j in range(3):
                v, f = lib.lathe([(0.0, 0.0), (0.06, 0.0), (0.065, 0.24), (0.025, 0.32), (0.022, 0.4), (0.0, 0.4)], 10, (gx + j * 0.15, g[1], 0.89))
                k['glass'].add(v, f, col(rnd.choice(['#ff9ec0', '#ffcf6b', '#9fe3d0', '#c9a0ff'])))
            x += 70
        elif kind < 0.7:
            for j in range(4):
                v, f = lib.lathe([(0.0, 0.0), (0.07, 0.0), (0.09, 0.1), (0.0, 0.1)], 12, (gx, g[1], 0.89 + j * 0.1))
                k['gloss'].add(v, f, col('#fff6ec'))
            x += 40
        else:
            v, f = lib.lathe([(0.0, 0.0), (0.11, 0.0), (0.12, 0.26), (0.08, 0.3), (0.0, 0.3)], 12, (gx, g[1], 0.89))
            k['glass'].add(v, f, col('#f2e8ff'))
            v, f = lib.cylinder((gx, g[1], 0.91), 0.1, 0.1, 0.16, 12)
            k['paint'].add(v, f, col(rnd.choice(['#8a5a3a', '#ffe0a0', '#ffb3c8'])))
            x += 44
        x += rnd.uniform(20, 60)
    k.build()


def front_counter():
    """The long counter (its objects are named 'counter*': the front-layer pass keeps only these)."""
    k = Kit('counter')
    y_front = row_y(COUNTER_ROW)
    y_back = y_front + COUNTER_DEPTH
    x0, x1 = 30 / PX, 1890 / PX
    # marble top
    lib.mesh_object('counter_top', [(x0 - 0.1, y_front - 0.08, COUNTER_H), (x1 + 0.1, y_front - 0.08, COUNTER_H), (x1 + 0.1, y_back, COUNTER_H),
                                    (x0 - 0.1, y_back, COUNTER_H), (x0 - 0.1, y_front - 0.08, COUNTER_H - 0.08), (x1 + 0.1, y_front - 0.08, COUNTER_H - 0.08)],
                    [(0, 1, 2, 3), (4, 5, 1, 0)], smooth=False, material=marble_material())
    # fluted pink front panels, a gold edge and a mint kick plate
    n = 62
    w = (x1 - x0) / n
    for i in range(n):
        xa = x0 + i * w
        v = [(xa, y_front, 0.14), (xa + w, y_front, 0.14), (xa + w, y_front, COUNTER_H - 0.1), (xa, y_front, COUNTER_H - 0.1)]
        mid = [(xa + w / 2, y_front - 0.035, 0.14), (xa + w / 2, y_front - 0.035, COUNTER_H - 0.1)]
        vv = [v[0], mid[0], mid[1], v[3], v[1], v[2]]
        k['gloss'].add(vv, [(0, 1, 2, 3), (1, 4, 5, 2)], col('#ffadc8' if i % 2 else '#ffc2d6'))
    v, f = lib.box(((x0 + x1) / 2, y_front - 0.04, COUNTER_H - 0.1), (x1 - x0 + 0.1, 0.1, 0.06))
    k['metal'].add(v, f, col('#e8b04a'))
    v, f = lib.box(((x0 + x1) / 2, y_front - 0.02, 0.07), (x1 - x0 + 0.05, 0.08, 0.14))
    k['gloss'].add(v, f, col('#7fd8c4'))
    # little hearts along the gold edge
    for i in range(18):
        sx = 90 + i * 104
        p = wp(sx, COUNTER_ROW + 3, None, COUNTER_H - 0.32)
        pts = [(math.sin(t) ** 3 * 0.09, (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 16 * 0.09) for t in [j / 20 * math.tau for j in range(20)]]
        K.flat_shape(k['gloss'], pts, (p[0], y_front - 0.045, p[2]), '#fff6ec', 0.01)
    k.build()


def floors():
    y_wall = row_y(WALL_ROW)
    y_counter = row_y(COUNTER_ROW)
    lib.mesh_object('planks', [(0, y_counter, 0), (19.2, y_counter, 0), (19.2, y_wall, 0), (0, y_wall, 0)], [(0, 1, 2, 3)], smooth=False, material=planks_material())
    lib.mesh_object('tiles', [(-0.5, y_counter - 22, 0), (19.7, y_counter - 22, 0), (19.7, y_counter, 0), (-0.5, y_counter, 0)], [(0, 1, 2, 3)], smooth=False, material=floor_material())


def bistro():
    """Bistro corners: round tables with chairs, and big potted plants."""
    k = Kit('bistro')
    for (sx, row) in [(95, 960), (1825, 960)]:
        g = ground(sx, row)
        v, f = lib.cylinder((g[0], g[1], 0.0), 0.28, 0.28, 0.04, 16)
        k['metal'].add(v, f, col('#e8b04a'))
        v, f = lib.cylinder((g[0], g[1], 0.0), 0.04, 0.04, 0.8, 8)
        k['metal'].add(v, f, col('#e8b04a'))
        v, f = lib.cylinder((g[0], g[1], 0.8), 0.45, 0.45, 0.05, 20)
        k['gloss'].add(v, f, col('#fff6ec'))
        v, f = lib.lathe([(0.0, 0.0), (0.07, 0.0), (0.08, 0.1), (0.0, 0.1)], 12, (g[0] - 0.1, g[1], 0.85))
        k['gloss'].add(v, f, col('#ff9ec0'))
        for side in (-1, 1):
            cxx = g[0] + side * 0.65
            v, f = lib.cylinder((cxx, g[1] + 0.05, 0.45), 0.22, 0.22, 0.06, 14)
            k['paint'].add(v, f, col('#9fe3d0'))
            for (dx, dy) in [(-0.15, -0.12), (0.15, -0.12), (-0.15, 0.12), (0.15, 0.12)]:
                v, f = lib.cylinder((cxx + dx, g[1] + 0.05 + dy, 0.0), 0.02, 0.02, 0.45, 5)
                k['metal'].add(v, f, col('#e8b04a'))
            v, f = lib.box((cxx + side * 0.2, g[1] + 0.05, 0.8), (0.04, 0.36, 0.7))
            k['paint'].add(v, f, col('#9fe3d0'))
    for (sx, row) in [(38, 760), (1882, 760)]:
        g = ground(sx, row)
        v, f = lib.lathe([(0.0, 0.0), (0.26, 0.0), (0.32, 0.55), (0.0, 0.55)], 16, g)
        k['gloss'].add(v, f, col('#ffe39a'))
        for j in range(14):
            a = j / 14 * math.tau
            L = rnd.uniform(0.6, 1.0)
            tip = (g[0] + math.cos(a) * L * 0.6, g[1] + math.sin(a) * L * 0.3, 0.55 + rnd.uniform(0.6, 1.3))
            v, f = lib.blob(tip, 0.18, squash=(1.2, 0.5, 0.8), rough=0.2, subdiv=1, seed=j)
            k['leaf'].add(v, f, col(rnd.choice(['#2f8a3c', '#3f9b45', '#56b04c'])))
            v, f = lib.tube([(g[0], g[1], 0.5), tip], 0.02, 4)
            k['leaf'].add(v, f, col('#2f7a34'))
    k.build()


def scene():
    cam = K.start(A, ELEV, sun_elev=46, sun_az=-24, key=2.9, fill=0.95, key_col='#fff0dc',
                  zenith='#bfe0ff', horizon='#fff0e6', ground='#e8c8c8')
    floors()
    wall()
    back_counter()
    front_counter()
    bistro()
    out = os.path.join(K.OUT, 'cafe.png' if not A.preview else 'cafe_preview.png')
    if not K.render(A, out):
        return
    K.publish(A, out, 'showtime_cafe')
    # The front layer: only the counter shows (everything else still casts light and shadow).
    for ob in bpy.data.objects:
        if ob.type == 'MESH' and not ob.name.startswith('counter'):
            ob.visible_camera = False
    out2 = os.path.join(K.OUT, 'cafe_counter.png' if not A.preview else 'cafe_counter_preview.png')
    lib.render_to(out2)
    K.publish(A, out2, 'showtime_cafe_counter')


# --- The espresso machine sprite ---------------------------------------------------------------
# Rendered alone over this screen region; its base centre sits at (MX, MY) on the ground.
REGION = (60, 380, 240, 240)
MX, MY = 180, 596
ANCHOR = ((MX - REGION[0]) / REGION[2], (MY - REGION[1]) / REGION[3])


def machine():
    set_region = REGION
    cam = K.start(A, ELEV, sun_elev=46, sun_az=-24, key=2.9, fill=0.95, key_col='#fff0dc',
                  zenith='#bfe0ff', horizon='#fff0e6', ground='#e8c8c8', region=set_region)
    bpy.context.scene.render.resolution_x = int(REGION[2] * (0.5 if A.preview else 1.0))
    bpy.context.scene.render.resolution_y = int(REGION[3] * (0.5 if A.preview else 1.0))
    k = Kit('machine')
    g = Vector(ground(MX, MY))
    W, D, H = 1.1, 0.62, 0.95
    # body: rounded mint box on little chrome feet
    v, f = lib.box((g.x, g.y, 0.12 + H / 2), (W, D, H))
    k['gloss'].add(v, f, col('#8fe0cc'))
    for (dx, dy) in [(-W / 2 + 0.08, -D / 2 + 0.08), (W / 2 - 0.08, -D / 2 + 0.08), (-W / 2 + 0.08, D / 2 - 0.08), (W / 2 - 0.08, D / 2 - 0.08)]:
        v, f = lib.cylinder((g.x + dx, g.y + dy, 0.0), 0.05, 0.04, 0.12, 8)
        k['chrome'].add(v, f, col('#e6e8ef'))
    # chrome top with a rail and warming cups
    v, f = lib.box((g.x, g.y, 0.12 + H + 0.04), (W + 0.06, D + 0.06, 0.08))
    k['chrome'].add(v, f, col('#eef0f6'))
    for i in range(3):
        v, f = lib.lathe([(0.0, 0.0), (0.07, 0.0), (0.085, 0.1), (0.0, 0.1)], 12, (g.x - 0.3 + i * 0.3, g.y + 0.05, 0.12 + H + 0.08))
        k['gloss'].add(v, f, col(['#ff9ec0', '#fff6ec', '#ffe39a'][i]))
    # front: a pressure dial, the group head and portafilter, the drip tray
    fy = g.y - D / 2 - 0.01
    K.disc_v(k['chrome'], g.x + 0.3, 0.12 + H * 0.72, fy, 0.14, '#e6e8ef', 24, 0.03)
    K.disc_v(k['paint'], g.x + 0.3, 0.12 + H * 0.72, fy - 0.03, 0.11, '#fff6ec', 24, 0.01)
    v, f = lib.box((g.x + 0.3 + 0.03, fy - 0.045, 0.12 + H * 0.72 + 0.03), (0.012, 0.005, 0.09), rot_z=0.0)
    k['paint'].add(v, f, col('#ff4f8b'))
    v, f = lib.cylinder((0, 0, 0), 0.12, 0.1, 0.16, 16)
    v = lib.transform(v, loc=(g.x - 0.05, fy - 0.02, 0.12 + H * 0.5), rot=(math.pi, 0, 0))
    k['chrome'].add(v, f, col('#e6e8ef'))
    v, f = lib.tube([(g.x - 0.05, fy - 0.1, 0.12 + H * 0.34), (g.x - 0.05 - 0.02, fy - 0.42, 0.12 + H * 0.32)], 0.035, 8)
    k['paint'].add(v, f, col('#2a2230'))
    v, f = lib.cylinder((g.x - 0.05, fy - 0.1, 0.12 + H * 0.3), 0.1, 0.1, 0.07, 14)
    k['chrome'].add(v, f, col('#d8dbe4'))
    v, f = lib.box((g.x - 0.05, fy - 0.12, 0.13), (0.5, 0.28, 0.05))
    k['chrome'].add(v, f, col('#c9ccd6'))
    for i in range(6):
        v, f = lib.box((g.x - 0.05 - 0.2 + i * 0.08, fy - 0.12, 0.158), (0.02, 0.24, 0.01))
        k['paint'].add(v, f, col('#6b6f7a'))
    # the pull lever on top and a steam wand on the side
    v, f = lib.tube([(g.x - 0.05, g.y - 0.05, 0.12 + H + 0.08), (g.x - 0.05, g.y - 0.3, 0.12 + H + 0.62)], 0.025, 8)
    k['chrome'].add(v, f, col('#e6e8ef'))
    v, f = lib.blob((g.x - 0.05, g.y - 0.32, 0.12 + H + 0.66), 0.07, squash=(1.0, 1.0, 1.3), rough=0.0, subdiv=2)
    k['gloss'].add(v, f, col('#ff4f8b'))
    v, f = lib.tube([(g.x - W / 2 - 0.02, g.y - 0.1, 0.12 + H * 0.8), (g.x - W / 2 - 0.12, g.y - 0.14, 0.12 + H * 0.5), (g.x - W / 2 - 0.1, g.y - 0.16, 0.2)], 0.02, 6)
    k['chrome'].add(v, f, col('#e6e8ef'))
    # a gold band round the body and a heart badge (no lettering)
    v, f = lib.box((g.x, g.y, 0.12 + H * 0.93), (W + 0.02, D + 0.02, 0.05))
    k['metal'].add(v, f, col('#e8b04a'))
    pts = [(math.sin(t) ** 3 * 0.08, (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 16 * 0.08) for t in [j / 20 * math.tau for j in range(20)]]
    K.flat_shape(k['gloss'], pts, (g.x - 0.34, fy - 0.01, 0.12 + H * 0.72), '#ff9ec0', 0.01)
    k.build()
    out = os.path.join(K.OUT, 'espresso.png' if not A.preview else 'espresso_preview.png')
    if not K.render(A, out):
        return
    if not A.preview:
        dst = os.path.join(K.PUB, 'mg', 'showtime_espresso.webp')
        Image.open(out).convert('RGBA').save(dst, 'WEBP', quality=92, method=6)
        print('wrote', dst, 'anchor', ANCHOR)


if A.what == 'scene':
    scene()
else:
    machine()
