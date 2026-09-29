"""Stretch & Snatch arena: a pirate ship's main deck round a round feast table (1920x1080, opaque).

    bpyenv/bin/python scripts/art/worlds/pirates/mg_deck.py [--preview] [--scale 0.5] [--samples 20]
    python3 scripts/build-lite.py --image scene_pirates_deck.webp

Orthographic camera at 50 degrees, ground plane 1:1 with the game's screen (lib.board_to_world), so
the layout constants in src/game/worlds/pirates/games/StretchSnatch.ts line up:
  table     base centre (960, 650), top radius 2.9 units (290 px across), top surface at z 0.95
  cook      stands at (960, 351) behind the table, between the galley counter and the stove
  seats     W (525, 650) E (1395, 650) SW (710, 923) SE (1210, 923) S (960, 983): keep clear
  crowd     festival folk stand at x 150..320 and 1600..1770, y 620..800: keep clear
The table top is also rendered alone (mg_sprites.py 'table') and spun in game over this one.
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
import mg_dress as dress  # noqa: E402
import props  # noqa: E402
from lib import MeshBuilder  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

A = K.parse()
ELEV = 50.0
TABLE_C = (960, 650)
TABLE_R = 2.9
TABLE_Z = 0.95
RAIL_Y = 205
MASTS = [(300, 372), (1620, 372)]


def table(cx, cy):
    """Pedestal table: flared foot, turned column, apron, a brass-banded top (textured with the same
    image the game spins) sitting on a slightly smaller turntable ring."""
    c = bw(cx, cy, 0.0)
    PR = props.Prop('table')
    foot = [(1.05, 0.0), (1.02, 0.08), (0.7, 0.16), (0.42, 0.26), (0.34, 0.36), (0.3, 0.52), (0.36, 0.6), (0.3, 0.7), (0.5, 0.74), (0.62, 0.78)]
    v, f = lib.lathe(foot, 32, (c.x, c.y, 0.0), cap_bottom=False, cap_top=True)
    PR.b['wood'].add(v, f, col('#7a4a2a'))
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        v, f = lib.blob((c.x + math.cos(a) * 1.0, c.y + math.sin(a) * 1.0, 0.07), 0.16, squash=(1.3, 1.3, 0.6), rough=0.05, subdiv=2)
        PR.b['metal'].add(v, f, col('#c9962f'))
    # turntable ring (dark gap) and the top slab
    v, f = lib.cylinder((c.x, c.y, 0.78), TABLE_R - 0.35, TABLE_R - 0.35, 0.05, 64)
    PR.b['wood'].add(v, f, col('#3c2618'))
    v, f = lib.cylinder((c.x, c.y, 0.83), TABLE_R, TABLE_R, TABLE_Z - 0.83 - 0.002, 96, cap=False)
    PR.b['wood'].add(v, f, col('#8a5530'))
    v, f = lib.lathe([(TABLE_R + 0.012, 0.86), (TABLE_R + 0.03, 0.885), (TABLE_R + 0.012, 0.91)], 96, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    PR.b['metal'].add(v, f, col('#d8a441'))
    for k in range(48):
        a = k / 48 * math.tau
        v, f = lib.blob((c.x + math.cos(a) * (TABLE_R + 0.03), c.y + math.sin(a) * (TABLE_R + 0.03), 0.885), 0.028, rough=0.0, subdiv=1)
        PR.b['metal'].add(v, f, col('#ffe28c'))
    PR.build()
    tex = K.table_texture(os.path.join(K.OUT, 'table_top.png'))
    K.disc_uv_object('table_top', (c.x, c.y, TABLE_Z), TABLE_R, K.image_material('table_top_mat', tex, rough=0.55))


def bulwark(y_px, x0=-60, x1=1980):
    """The far side of the ship: a planked bulwark with a chunky cap rail and knees every few metres."""
    a, b = bw(x0, y_px, 0.0), bw(x1, y_px, 0.0)
    wall = MeshBuilder()
    v, f = lib.box(((a.x + b.x) / 2, a.y + 0.06, 0.42), (b.x - a.x, 0.14, 0.84))
    wall.add(v, f, col('#8d5a33'))
    wall.build('bulwark', K.m()['planks_dark'])
    trim = MeshBuilder()
    v, f = lib.box(((a.x + b.x) / 2, a.y + 0.02, 0.9), (b.x - a.x, 0.3, 0.12))
    trim.add(v, f, col('#a8703f'))
    for k in range(int((b.x - a.x) / 1.6) + 1):
        x = a.x + 0.4 + k * 1.6
        v, f = lib.box((x, a.y - 0.1, 0.4), (0.14, 0.24, 0.8))
        trim.add(v, f, col('#6e4426'))
    v, f = lib.box(((a.x + b.x) / 2, a.y - 0.08, 0.05), (b.x - a.x, 0.18, 0.1))
    trim.add(v, f, col('#5a3620'))
    trim.build('bulwark_trim', props.mats()['wood'])


def near_bulwark(y_px):
    """The near side's bulwark along the bottom edge: only its cap rail and a strip of planking show."""
    a, b = bw(-60, y_px, 0.0), bw(1980, y_px, 0.0)
    wall = MeshBuilder()
    v, f = lib.box(((a.x + b.x) / 2, a.y - 0.06, 0.42), (b.x - a.x, 0.14, 0.84))
    wall.add(v, f, col('#8d5a33'))
    wall.build('near_bulwark', K.m()['planks_dark'])
    trim = MeshBuilder()
    v, f = lib.box(((a.x + b.x) / 2, a.y - 0.02, 0.9), (b.x - a.x, 0.3, 0.12))
    trim.add(v, f, col('#a8703f'))
    for k in range(int((b.x - a.x) / 1.6) + 1):
        x = a.x + 0.4 + k * 1.6
        v, f = lib.box((x, a.y + 0.1, 0.4), (0.14, 0.24, 0.8))
        trim.add(v, f, col('#6e4426'))
    trim.build('near_bulwark_trim', props.mats()['wood'])


def mast_rig(bx, by, rigs):
    """A mast from the deck with a pin rail round its foot, coiled lines, and shrouds with ratlines
    running up from the bulwark (rigs: bulwark x positions)."""
    c = bw(bx, by, 0.0)
    PR = props.Prop(f'mast_{bx}')
    v, f = lib.cylinder((c.x, c.y, 0.0), 0.3, 0.22, 11.0, 16)
    PR.b['wood'].add(v, f, col('#8a5a34'))
    for zz in (0.9, 2.6, 4.4):
        v, f = lib.cylinder((c.x, c.y, zz), 0.33, 0.33, 0.1, 16)
        PR.b['metal'].add(v, f, col('#3f4048'))
    # pin rail: a square frame round the foot with belaying pins
    for (dx, dy, sx, sy) in [(0, 0.6, 1.4, 0.12), (0, -0.6, 1.4, 0.12), (0.6, 0, 0.12, 1.4), (-0.6, 0, 0.12, 1.4)]:
        v, f = lib.box((c.x + dx, c.y + dy, 0.62), (sx, sy, 0.1))
        PR.b['wood'].add(v, f, col('#7a4a2a'))
    for (dx, dy) in [(0.6, 0.6), (-0.6, 0.6), (0.6, -0.6), (-0.6, -0.6)]:
        v, f = lib.box((c.x + dx, c.y + dy, 0.33), (0.12, 0.12, 0.66))
        PR.b['wood'].add(v, f, col('#6e4426'))
    for k in range(5):
        v, f = lib.cylinder((c.x - 0.5 + k * 0.25, c.y - 0.62, 0.55), 0.03, 0.03, 0.3, 6)
        PR.b['wood'].add(v, f, col('#c9a06a'))
    PR.build()
    rope = MeshBuilder()
    K.rope_coil(rope, c.x + 0.25, c.y - 0.95, 0.0, r=0.28)
    K.rope_coil(rope, c.x - 0.5, c.y - 0.9, 0.0, r=0.22, turns=3)
    top = Vector((c.x, c.y, 7.2))
    rail = bw(bx, RAIL_Y, 0.0)
    feet = [Vector((bw(x, RAIL_Y, 0).x, rail.y + 0.05, 0.98)) for x in rigs]
    for ft in feet:
        K.rope_line(rope, tuple(ft), tuple(top + Vector(((ft.x - top.x) * 0.06, 0, 0))), sag=0.0, thick=0.03, tint='#4a3a2a')
    # ratlines: horizontal rungs between neighbouring shrouds
    for i in range(len(feet) - 1):
        a0, b0 = feet[i], feet[i + 1]
        for k in range(1, 12):
            t = k / 12
            pa = a0 + (top - a0) * t
            pb = b0 + (top - b0) * t
            K.rope_line(rope, tuple(pa), tuple(pb), sag=0.02, thick=0.014, tint='#5a4632')
    rope.build(f'rig_{bx}', K.m()['rope'])


def galley():
    """Behind the table: a chopping counter with fruit and bread, the cook's crate step, an iron stove."""
    PR = props.Prop('galley')
    cnt = bw(785, 292, 0.0)
    v, f = lib.box((cnt.x, cnt.y, 0.45), (1.5, 0.66, 0.9))
    PR.b['wood'].add(v, f, col('#9a6436'))
    v, f = lib.box((cnt.x, cnt.y, 0.93), (1.62, 0.76, 0.08))
    PR.b['wood'].add(v, f, col('#c08a52'))
    v, f = lib.box((cnt.x - 0.2, cnt.y + 0.02, 0.99), (0.7, 0.42, 0.05))
    PR.b['wood'].add(v, f, col('#e0b884'))
    rnd = random.Random(3)
    fruit = MeshBuilder()
    for k in range(7):
        a = k / 7 * math.tau
        fc = rnd.choice(['#e84b3c', '#ff9f1c', '#f6d743', '#7ac943'])
        v, f = lib.blob((cnt.x + 0.45 + math.cos(a) * 0.14, cnt.y + math.sin(a) * 0.12, 1.08 + (k % 2) * 0.05), 0.09, rough=0.05, subdiv=2)
        fruit.add(v, f, col(fc))
    v, f = lib.lathe([(0.0, 0.0), (0.26, 0.02), (0.3, 0.12), (0.26, 0.13)], 18, (cnt.x + 0.45, cnt.y, 0.97))
    PR.b['wood'].add(v, f, col('#7a4a2a'))
    for k in range(3):
        v, f = lib.blob((cnt.x - 0.35 + k * 0.2, cnt.y - 0.12, 1.06), 0.1, squash=(1.5, 0.8, 0.6), rough=0.05, subdiv=2)
        fruit.add(v, f, col('#d99b52'))
    fruit.build('galley_food', K.m()['glossy'])
    # stove
    st = bw(1140, 292, 0.0)
    iron = MeshBuilder()
    v, f = lib.box((st.x, st.y, 0.42), (1.1, 0.72, 0.84))
    iron.add(v, f, col('#3c3e46'))
    v, f = lib.box((st.x, st.y, 0.87), (1.2, 0.8, 0.07))
    iron.add(v, f, col('#2c2e34'))
    v, f = lib.cylinder((st.x + 0.35, st.y + 0.2, 0.9), 0.1, 0.1, 2.4, 12)
    iron.add(v, f, col('#34363d'))
    v, f = lib.lathe([(0.0, 0.0), (0.32, 0.02), (0.34, 0.36), (0.36, 0.38), (0.3, 0.4)], 20, (st.x - 0.18, st.y - 0.02, 0.9), cap_top=False)
    iron.add(v, f, col('#50535c'))
    iron.build('stove', K.m()['iron'])
    glow = MeshBuilder()
    v, f = lib.box((st.x - 0.1, st.y - 0.37, 0.36), (0.5, 0.02, 0.26))
    glow.add(v, f, col('#ff8a2a'))
    glow.build('stove_fire', props.mats()['glow'])
    # crates of produce behind the cook
    wood = MeshBuilder()
    K.crate(wood, bw(900, 250).x, bw(900, 250).y, 0.0, s=0.7, rot=0.1)
    K.crate(wood, bw(1015, 246).x, bw(1015, 246).y, 0.0, s=0.62, rot=-0.15)
    K.crate(wood, bw(960, 244).x, bw(960, 244).y, 0.7, s=0.5, rot=0.3)
    wood.build('galley_crates', props.mats()['wood'])
    veg = MeshBuilder()
    for (cx, cy, top) in [(900, 250, 0.72), (1015, 246, 0.64)]:
        c = bw(cx, cy, 0.0)
        for k in range(6):
            v, f = lib.blob((c.x + rnd.uniform(-0.2, 0.2), c.y + rnd.uniform(-0.2, 0.2), top + 0.06), 0.1, rough=0.1, subdiv=2)
            veg.add(v, f, col(rnd.choice(['#e84b3c', '#ffb11c', '#9ad24a', '#f6d743'])))
    veg.build('produce', K.m()['glossy'])
    PR.build()


def cannons():
    iron, wood = MeshBuilder(), MeshBuilder()
    for bx in (560, 1360):
        c = bw(bx, 262, 0.0)
        K.cannon(iron, wood, c.x, c.y, 0.0, rot=math.pi / 2, s=1.0)
        cb = bw(bx + 110, 290, 0.0)
        K.cannonballs(iron, cb.x, cb.y, 0.0)
    iron.build('cannons_iron', K.m()['iron'])
    wood.build('cannons_wood', props.mats()['wood'])


def clutter():
    rnd = random.Random(11)
    wood, metal, rope = MeshBuilder(), MeshBuilder(), MeshBuilder()
    # left: barrels and crates by the bulwark
    for (bx, by, lying) in [(70, 330, False), (150, 318, False), (110, 390, False), (60, 470, True)]:
        c = bw(bx, by, 0.0)
        if lying:
            K.barrel(wood, metal, c.x, c.y, 0.34, r=0.34, h=0.86, rot=(0.0, math.pi / 2, 0.3))
        else:
            K.barrel(wood, metal, c.x, c.y, 0.0)
    c = bw(125, 350, 0.86)
    K.barrel(wood, metal, c.x, c.y, 0.86, r=0.3, h=0.76)
    for (bx, by, s, r) in [(230, 330, 0.8, 0.2), (250, 440, 0.7, -0.3), (40, 560, 0.6, 0.5)]:
        c = bw(bx, by, 0.0)
        K.crate(wood, c.x, c.y, 0.0, s=s, rot=r)
    # right: the helm, barrels, a chest of gold
    for (bx, by) in [(1800, 318), (1870, 340), (1830, 400)]:
        c = bw(bx, by, 0.0)
        K.barrel(wood, metal, c.x, c.y, 0.0)
    for (bx, by, s, r) in [(1690, 322, 0.75, -0.2), (1880, 470, 0.7, 0.4)]:
        c = bw(bx, by, 0.0)
        K.crate(wood, c.x, c.y, 0.0, s=s, rot=r)
    # bottom corners: hatch grating (left), capstan (right), sacks, bucket
    hc = bw(180, 975, 0.0)
    v, f = lib.box((hc.x, hc.y, 0.06), (2.0, 1.3, 0.12))
    wood.add(v, f, col('#6e4426'))
    for k in range(9):
        v, f = lib.box((hc.x - 0.8 + k * 0.2, hc.y, 0.13), (0.06, 1.1, 0.04))
        wood.add(v, f, col('#8a5a34'))
    for k in range(6):
        v, f = lib.box((hc.x, hc.y - 0.5 + k * 0.2, 0.15), (1.8, 0.06, 0.04))
        wood.add(v, f, col('#946236'))
    cc = bw(1745, 970, 0.0)
    v, f = lib.lathe([(0.55, 0.0), (0.5, 0.12), (0.34, 0.2), (0.3, 0.8), (0.4, 0.86), (0.42, 0.98), (0.0, 1.0)], 20, (cc.x, cc.y, 0.0))
    wood.add(v, f, col('#8a5530'))
    for k in range(6):
        a = k / 6 * math.tau
        v, f = lib.tube([(cc.x + math.cos(a) * 0.35, cc.y + math.sin(a) * 0.35, 0.92), (cc.x + math.cos(a) * 1.0, cc.y + math.sin(a) * 1.0, 0.94)], 0.045, 6)
        wood.add(v, f, col('#a8703f'))
    for (bx, by) in [(1560, 1040), (330, 1045)]:
        c = bw(bx, by, 0.0)
        v, f = lib.blob((c.x, c.y, 0.3), 0.36, squash=(1.0, 0.8, 0.9), rough=0.12, subdiv=2)
        wood.add(v, f, col('#d9c29a'))
    K.rope_coil(rope, bw(420, 1030).x, bw(420, 1030).y, 0.0, r=0.3)
    K.rope_coil(rope, bw(1500, 300).x, bw(1500, 300).y, 0.0, r=0.26, turns=3)
    wood.build('clutter_wood', props.mats()['wood'])
    metal.build('clutter_metal', K.m()['iron'])
    rope.build('clutter_rope', K.m()['rope'])
    # the helm: a spoked wheel on a pedestal, facing the camera
    helm = props.Prop('helm')
    hc = bw(1750, 470, 0.0)
    v, f = lib.box((hc.x, hc.y, 0.55), (0.3, 0.3, 1.1))
    helm.b['wood'].add(v, f, col('#7a4a2a'))
    cx, cy, cz = hc.x, hc.y - 0.2, 1.35
    ring = []
    for k in range(33):
        a = k / 32 * math.tau
        ring.append((cx + math.cos(a) * 0.55, cy, cz + math.sin(a) * 0.55))
    v, f = lib.tube(ring, 0.05, 8)
    helm.b['wood'].add(v, f, col('#a8703f'))
    for k in range(8):
        a = k / 8 * math.tau
        v, f = lib.tube([(cx, cy, cz), (cx + math.cos(a) * 0.78, cy, cz + math.sin(a) * 0.78)], 0.035, 6)
        helm.b['wood'].add(v, f, col('#946236'))
        v, f = lib.blob((cx + math.cos(a) * 0.8, cy, cz + math.sin(a) * 0.8), 0.06, rough=0.0, subdiv=1)
        helm.b['wood'].add(v, f, col('#c08a52'))
    v, f = lib.blob((cx, cy - 0.02, cz), 0.1, rough=0.0, subdiv=2)
    helm.b['metal'].add(v, f, col('#f2c14e'))
    helm.build()
    # chest of gold beside the helm
    ch = props.Prop('chest')
    c = bw(1640, 520, 0.0)
    v, f = lib.box((c.x, c.y, 0.25), (0.9, 0.55, 0.5))
    ch.b['wood'].add(v, f, col('#7a3f22'))
    for dx in (-0.3, 0.3):
        v, f = lib.box((c.x + dx, c.y, 0.26), (0.08, 0.58, 0.54))
        ch.b['metal'].add(v, f, col('#d8a441'))
    for k in range(18):
        v, f = lib.cylinder((c.x + rnd.uniform(-0.35, 0.35), c.y + rnd.uniform(-0.2, 0.2), 0.5 + rnd.uniform(0, 0.08)), 0.07, 0.07, 0.02, 10)
        ch.b['metal'].add(v, f, col('#ffd24a'))
    lid = [(c.x - 0.45, c.y + 0.28, 0.5), (c.x + 0.45, c.y + 0.28, 0.5), (c.x + 0.45, c.y + 0.4, 1.0), (c.x - 0.45, c.y + 0.4, 1.0)]
    ch.b['wood'].add(lid, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#6a3620'))
    ch.build()


def lights_and_flags():
    a = bw(*MASTS[0], 0.0)
    b = bw(*MASTS[1], 0.0)
    dress.string_lights([(a.x, a.y, 4.5), (b.x, b.y, 4.5)], sag=1.0, bulbs=22, s=2.2, name='mast_lights')
    K.pennant_line((a.x, a.y, 3.6), (b.x, b.y, 3.6), n=18, sag=0.8, size=0.42, colors=K.PLAYER + ['#f4b83b', '#fff4dc'], name='mast_pennants')
    # lanterns hung from the mast collars
    iron, glow = MeshBuilder(), MeshBuilder()
    for (bx, by) in MASTS:
        c = bw(bx, by, 0.0)
        for dx in (-0.42, 0.42):
            K.lantern(iron, glow, c.x + dx, c.y - 0.1, 2.5, s=1.4)
            v, f = lib.box((c.x + dx * 0.7, c.y - 0.1, 2.52), (abs(dx) * 0.8, 0.04, 0.04))
            iron.add(v, f, col('#2f2b2c'))
    iron.build('lantern_iron', K.m()['iron'])
    glow.build('lantern_glow', props.mats()['glow'])


def main():
    K.set_view(ELEV)
    samples = A.samples or (10 if A.preview else 22)
    K.start(samples)
    sc = bpy.context.scene
    sc.render.film_transparent = False
    dress.festival_light(key=3.4, elev=46, az=-38, fill=0.8, angle=3.0, key_col='#ffe3ba', zenith='#8cc6ff', horizon='#ffe8c8')
    scale = A.scale or (0.4 if A.preview else 1.0)
    lib.camera_for_region(0, 0, K.SW, K.SH, scale=scale)
    # the sea, well below the deck (it shows beyond the far bulwark)
    sea = K.sea_material('deck_sea', deep='#0f5f86', mid='#1c88b3', light='#3fb6d6', foam_amt=0.9)
    K.plane('sea', -30, -30, 50, 30, -2.6, sea)
    d0, d1 = bw(-80, RAIL_Y, 0.0), bw(2000, 1200, 0.0)
    K.plane('deck', d0.x, d1.y, d1.x, d0.y, 0.0, K.m()['planks'])
    bulwark(RAIL_Y)
    near_bulwark(1108)
    for (bx, by) in MASTS:
        mast_rig(bx, by, [bx - 150, bx - 70, bx + 10, bx + 90, bx + 170])
    table(*TABLE_C)
    galley()
    cannons()
    clutter()
    lights_and_flags()
    out = os.path.join(K.OUT, 'deck_preview.png' if A.preview else 'deck.png')
    if A.dry:
        print('dry run: scene built,', len(bpy.data.objects), 'objects')
        return
    lib.render_to(out)
    if not A.preview:
        K.publish_webp(out, 'pirates_deck')
    print('done', out)


main()
