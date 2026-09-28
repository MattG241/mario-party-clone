"""Storm Navigator arena: a stormy bay ringed with rocks, a lighthouse, a wreck and a jetty (opaque).

    bpyenv/bin/python scripts/art/worlds/pirates/mg_stormbay.py [--preview] [--scale 0.5] [--samples 20]
    python3 scripts/build-lite.py --image scene_pirates_storm.webp

Orthographic camera at 55 degrees, ground plane 1:1 with the game's screen (lib.board_to_world). The
open water inside BAY (screen px x 170..1750, y 180..1000, rounded) is the play area and stays clear;
rocks, cliffs and props only stand outside it. The lighthouse lamp room is at LIGHT (the game hangs its
weather vane on top of it) - keep in step with src/game/worlds/pirates/games/stormNavigatorRules.ts.
"""
from __future__ import annotations

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import mg_kit as K  # noqa: E402
from mg_kit import bw, col  # noqa: E402

import lib  # noqa: E402
import props  # noqa: E402
from lib import MeshBuilder  # noqa: E402

import bpy  # noqa: E402

A = K.parse()
ELEV = 55.0
BAY = (170, 180, 1750, 1000)
LIGHT = (1822, 600)


def inside_bay(x, y, pad=0.0):
    x0, y0, x1, y1 = BAY
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2 + pad, (y1 - y0) / 2 + pad
    u, v = abs(x - cx) / rx, abs(y - cy) / ry
    return u ** 4 + v ** 4 < 1.0


def shore_rocks(rnd):
    """Rock clusters and cliffs round the rim (outside the bay), grassy tops on the big ones."""
    rocks, grass, foam = MeshBuilder(), MeshBuilder(), MeshBuilder()
    spots = []
    # a dense chain along each edge
    for k in range(34):
        t = k / 33
        spots.append((60 + rnd.uniform(-40, 40), 120 + t * 900, rnd.uniform(0.9, 1.6)))
        spots.append((1880 + rnd.uniform(-40, 40), 110 + t * 920, rnd.uniform(0.9, 1.6)))
    for k in range(30):
        t = k / 29
        spots.append((80 + t * 1760, 70 + rnd.uniform(-40, 30), rnd.uniform(0.8, 1.5)))
        spots.append((100 + t * 1720, 1060 + rnd.uniform(-20, 30), rnd.uniform(0.7, 1.2)))
    # a few outliers poking out of the water just outside the bay
    for (x, y, r) in [(150, 190, 0.7), (205, 1000, 0.6), (1760, 170, 0.65), (1730, 1010, 0.55), (120, 600, 0.9), (1790, 380, 0.8)]:
        spots.append((x, y, r))
    for i, (x, y, r) in enumerate(spots):
        if inside_bay(x, y, pad=-10):
            continue
        c = bw(x, y, 0.0)
        tint = rnd.choice(['#6f6a66', '#7c766f', '#5f5b5a', '#85807a', '#7a6a58', '#6a5a4a', '#4f4d52'])
        K.rock(rocks, c.x, c.y, -0.3, r, seed=i, squash=(1.1, 1.0, 0.75), tint=tint)
        # a collar of surf where the rock meets the water
        v, f = lib.blob((c.x, c.y, 0.0), r * 1.12, squash=(1.12, 1.05, 0.05), rough=0.3, subdiv=2, seed=i + 300)
        foam.add(v, f, col('#e6f2f4'))
        if r > 1.25 and rnd.random() < 0.6:
            v, f = lib.blob((c.x, c.y, -0.3 + r * 0.62), r * 0.62, squash=(1.1, 1.0, 0.28), rough=0.25, subdiv=2, seed=i + 100)
            grass.add(v, f, col(rnd.choice(['#3f7a3a', '#4a8a40', '#356b33'])))
    rocks.build('shore_rocks', K.rock_material('wet_rock', rough=0.55))
    grass.build('shore_grass', K.m()['leaf'])
    foam.build('shore_foam', lib.attr_mat('surf', rough=0.7))


def palms(rnd):
    leaf, wood = MeshBuilder(), MeshBuilder()
    for (x, y, s) in [(70, 300, 0.75), (40, 820, 0.8), (1890, 900, 0.75), (1860, 250, 0.7), (520, 60, 0.6), (1400, 70, 0.65)]:
        c = bw(x, y, 0.0)
        K.palm(leaf, wood, c.x, c.y, 0.6, s=s, lean=(0.25, 0.1), seed=int(x + y), windswept=0.9)
    leaf.build('palm_leaves', K.m()['leaf'])
    wood.build('palm_trunks', props.mats()['wood'])


def wreck():
    """A broken hull aground on the rocks at the top left: ribs, a snapped mast and a torn sail."""
    PR = props.Prop('wreck')
    c = bw(260, 95, 0.0)
    for k in range(7):
        x = c.x - 1.2 + k * 0.42
        rib = []
        for j in range(9):
            a = math.pi * (0.1 + 0.8 * j / 8)
            rib.append((x, c.y + math.cos(a) * 0.9, -0.2 + math.sin(a) * 1.0))
        v, f = lib.tube(rib, 0.07, 6)
        PR.b['wood'].add(v, f, col('#5e3f2a'))
    v, f = lib.box((c.x, c.y, -0.15), (3.2, 0.3, 0.2))
    PR.b['wood'].add(v, f, col('#4e3524'))
    v, f = lib.tube([(c.x + 0.4, c.y, 0.0), (c.x + 1.1, c.y - 0.3, 2.4)], 0.12, 8)
    PR.b['wood'].add(v, f, col('#6a4024'))
    sail = [(c.x + 0.8, c.y - 0.2, 1.6), (c.x + 1.9, c.y - 0.4, 1.3), (c.x + 1.4, c.y - 0.35, 0.4)]
    PR.b['paint'].add(sail, [(0, 1, 2), (2, 1, 0)], col('#d8ccb0'))
    PR.build()


def jetty():
    """A little fishing jetty at the bottom left with a hut, a lantern and a moored rowboat."""
    PR = props.Prop('jetty')
    a, b = bw(0, 1040, 0.0), bw(330, 1040, 0.0)
    v, f = lib.box(((a.x + b.x) / 2, a.y, 0.35), (b.x - a.x, 1.2, 0.12))
    PR.b['wood'].add(v, f, col('#8a5a34'))
    for k in range(6):
        x = a.x + 0.2 + k * 0.62
        for dy in (-0.55, 0.55):
            v, f = lib.cylinder((x, a.y + dy, -0.8), 0.08, 0.08, 1.2, 8)
            PR.b['wood'].add(v, f, col('#5e3f2a'))
    h = bw(70, 1010, 0.0)
    v, f = lib.box((h.x, h.y, 1.0), (1.1, 1.0, 1.2))
    PR.b['wood'].add(v, f, col('#7a4a2a'))
    roof = [(h.x - 0.7, h.y - 0.6, 1.6), (h.x + 0.7, h.y - 0.6, 1.6), (h.x + 0.7, h.y, 2.2), (h.x - 0.7, h.y, 2.2), (h.x - 0.7, h.y + 0.6, 1.6), (h.x + 0.7, h.y + 0.6, 1.6)]
    PR.b['paint'].add(roof, [(0, 1, 2, 3), (3, 2, 5, 4)], col('#4a5a66'))
    v, f = lib.box((h.x + 0.2, h.y - 0.51, 1.1), (0.3, 0.04, 0.3))
    PR.b['glow'].add(v, f, col('#ffc36a'))
    iron, glow = MeshBuilder(), MeshBuilder()
    lp = bw(300, 1030, 0.0)
    v, f = lib.cylinder((lp.x, lp.y, 0.4), 0.05, 0.05, 1.6, 6)
    PR.b['wood'].add(v, f, col('#4a3a34'))
    K.lantern(iron, glow, lp.x, lp.y, 2.0, s=1.1)
    iron.build('jetty_lantern_iron', K.m()['iron'])
    glow.build('jetty_lantern_glow', props.mats()['glow'])
    PR.build()


def lighthouse():
    PR = props.Prop('lighthouse')
    c = bw(*LIGHT, 0.0)
    K.lighthouse(PR, c.x, c.y, 0.5, s=1.05)
    PR.build()
    rocks = MeshBuilder()
    for k, (dx, dy, r) in enumerate([(0, 0, 1.3), (-0.9, 0.6, 0.9), (0.8, -0.4, 1.0), (0.2, 1.0, 0.8)]):
        K.rock(rocks, c.x + dx, c.y + dy, -0.4, r, seed=k + 50, squash=(1.2, 1.1, 0.7), tint='#6a6560')
    rocks.build('lighthouse_rocks', K.m()['rock'])


def buoys():
    """Channel buoys and a floating crate or two just outside the bay, bobbing props for scale."""
    PR = props.Prop('buoys')
    for (x, y, c1) in [(200, 150, '#e0483e'), (1720, 1030, '#f4f0e6'), (1760, 150, '#f4f0e6')]:
        c = bw(x, y, 0.0)
        v, f = lib.lathe([(0.0, -0.2), (0.3, -0.1), (0.3, 0.3), (0.15, 0.7), (0.0, 0.75)], 12, (c.x, c.y, 0.0))
        PR.b['paint'].add(v, f, lambda vv: col(c1) if vv[2] < 0.25 else col('#2f2b2c'))
        v, f = lib.blob((c.x, c.y, 0.85), 0.1, rough=0.0, subdiv=1)
        PR.b['glow'].add(v, f, col('#ffd27a'))
    PR.build()


def main():
    K.set_view(ELEV)
    samples = A.samples or (10 if A.preview else 22)
    K.start(samples)
    sc = bpy.context.scene
    sc.render.film_transparent = False
    lib.world_light(0.95, zenith='#7f93b0', horizon='#9aa8b8', ground='#4a525c')
    lib.sun(energy=1.35, elevation=58, azimuth=-20, angle=8.0, color='#d0dcec')
    scale = A.scale or (0.4 if A.preview else 1.0)
    lib.camera_for_region(0, 0, K.SW, K.SH, scale=scale)
    sea = K.sea_material('storm_sea', deep='#0b2a3a', mid='#174452', light='#2f6570', foam='#dcecee', foam_amt=0.9, wave_scale=0.3, rough=0.16,
                         net=0.0, streaks=1.25, streak_dir=(0.9, 3.4), swell=1.0)
    K.plane('sea', -30, -40, 50, 30, 0.0, sea)
    rnd = random.Random(21)
    shore_rocks(rnd)
    palms(rnd)
    wreck()
    jetty()
    lighthouse()
    buoys()
    out = os.path.join(K.OUT, 'storm_preview.png' if A.preview else 'storm.png')
    if A.dry:
        print('dry run: scene built,', len(bpy.data.objects), 'objects')
        return
    lib.render_to(out)
    if not A.preview:
        K.publish_webp(out, 'pirates_storm')
    print('done', out)


main()
