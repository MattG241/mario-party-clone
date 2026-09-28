"""Rhinestone Rodeo arena: a pink honky-tonk rodeo ring at sunset, and its sparkly mechanical pony.

    .../with-blender-lock .../bpyenv/bin/python scripts/art/worlds/showtime/mg_rodeo.py scene|pony [--preview] [--samples N]

scene  Side-on view (16 deg) of a sandy ring on the Showtime Strip: a pink rail fence with rhinestone
       posts and cowgirl hats, two tiers of bleachers behind it (the game seats its crowd there), a pink
       barn stage with star lights and a sparkly star sign, a gantry hung with a big disco ball, string
       lights and bunting, hay bales with bows and cacti in pots. Writes scene_showtime_rodeo.webp.
       Layout the game relies on (RhinestoneRodeo.ts): pony bases on row 812 anywhere in x 200..1720
       (the sand there is kept clear), bleacher feet lines at y 548 and 470, the disco ball at (960, 200).
pony   The mechanical pony, rendered alone with the same camera (mg/showtime_pony*.webp):
         showtime_pony        the pony (body, head, mane, tail, legs, saddle), anchored at its pivot
         showtime_pony_front  just its barrel, saddle skirt and stirrup, drawn over the rider's legs
         showtime_pony_base   the padded mat and hydraulic column, anchored at the mat's centre
       The anchors and the saddle seat are printed and kept in RhinestoneRodeo.ts.
No text, logos or insignia anywhere.
"""
from __future__ import annotations

import math
import os
import random

import mg_kit as K
from mg_kit import Kit, PX, col, ground, row_y, wp, z_of, zpx

import lib
import bpy
from mathutils import Vector
from PIL import Image

A = K.args(['scene', 'pony'])
rnd = random.Random(23)

ELEV = 16
PONY_ROW = 812
FENCE_ROW = 660
BLEACH = [(630, 0.8), (600, 1.62)]  # (row, seat height) of the two bleacher tiers
PINK = '#ff7ab8'
HOT = '#ff3d8b'
CREAM = '#fff4e8'


def sand_material():
    m = lib.NT('rodeo_sand')
    pos = m.position()
    n1 = m.noise(0.7, 5, 0.6, pos)
    n2 = m.noise(14.0, 3, 0.5, pos)
    c = m.mix(n1.outputs['Fac'], col('#f3cfb2'), col('#ffe2cc'))
    c = m.mult(c, m.mix(n2.outputs['Fac'], col('#e9c3a8'), col('#ffffff')))
    # hoof-print scuffs and a few glitter flecks
    v = m.voronoi(6.0, pos)
    fl = m.maprange(v.outputs['Distance'], 0.05, 0.02)
    c = m.mix(m.math('MULTIPLY', fl, 0.8), c, col('#ffffff'))
    c = m.mult(c, m.mix(m.ao(0.6, 8), col('#b48a8a'), col('#ffffff')))
    m.bsdf(c, 0.85, normal=m.bump(n2.outputs['Fac'], 0.15, 0.02))
    return m.mat


def fence():
    k = Kit('fence')
    y = row_y(FENCE_ROW)
    posts = list(range(40, 1900, 140))
    for i, sx in enumerate(posts):
        g = ground(sx, FENCE_ROW)
        v, f = lib.box((g[0], g[1], 0.66), (0.2, 0.2, 1.32))
        k['paint'].add(v, f, col(CREAM))
        v, f = lib.lathe([(0.15, 0.0), (0.15, 0.06), (0.0, 0.14)], 4, (g[0], g[1], 1.32))
        k['paint'].add(v, f, col(HOT))
        # a rhinestone on each post, and a few cowgirl hats hung on them
        v, f = lib.blob((g[0], g[1] - 0.11, 1.05), 0.06, squash=(1, 0.5, 1), rough=0.0, subdiv=1)
        k['glass'].add(v, f, col('#ffe8f6'))
        if i % 4 == 1:
            hat(k, g[0] + 0.02, g[1] - 0.14, 1.22, rnd.choice([PINK, '#fff4e8', '#c9a0ff']))
    for z in (0.42, 0.92):
        v, f = lib.box((9.6, y - 0.02, z), (19.2, 0.08, 0.16))
        k['paint'].add(v, f, col(PINK))
    # bunting along the top rail
    for i in range(len(posts) - 1):
        a = ground(posts[i], FENCE_ROW - 2, 1.3)
        b = ground(posts[i + 1], FENCE_ROW - 2, 1.3)
        for j in range(4):
            t0, t1 = j / 4, (j + 1) / 4
            p0 = Vector(a).lerp(Vector(b), t0)
            p1 = Vector(a).lerp(Vector(b), t1)
            sag0 = math.sin(t0 * math.pi) * 0.12
            sag1 = math.sin(t1 * math.pi) * 0.12
            mid = (p0 + p1) / 2
            tri = [(p0.x, p0.y - 0.13, p0.z - sag0), (p1.x, p1.y - 0.13, p1.z - sag1), (mid.x, mid.y - 0.13, mid.z - 0.26 - (sag0 + sag1) / 2)]
            k['paint'].add(tri, [(0, 1, 2), (2, 1, 0)], col([HOT, '#ffd23f', '#2ec4b6', '#c9a0ff'][(i + j) % 4]))
    k.build()


def hat(k, x, y, z, c):
    """A cowgirl hat: an upturned brim and a pinched crown, with a band of little gems."""
    v, f = lib.lathe([(0.0, 0.0), (0.26, 0.0), (0.33, 0.05), (0.34, 0.09), (0.3, 0.06), (0.14, 0.04), (0.0, 0.04)], 20, (x, y, z), squash_y=0.8)
    k['paint'].add(v, f, col(c))
    v, f = lib.blob((x, y, z + 0.13), 0.15, squash=(1.0, 0.75, 0.9), rough=0.05, subdiv=2)
    k['paint'].add(v, f, col(c))
    v, f = lib.lathe([(0.145, 0.0), (0.145, 0.04)], 16, (x, y, z + 0.05), cap_bottom=False, cap_top=False, squash_y=0.78)
    k['metal'].add(v, f, col('#f2c14e'))


def bleachers():
    k = Kit('bleachers')
    for (row, zs) in BLEACH:
        g = ground(960, row)
        v, f = lib.box((g[0], g[1], zs - 0.06), (19.4, 0.9, 0.12))
        k['wood'].add(v, f, col('#e8a0c0'))
        v, f = lib.box((g[0], g[1] + 0.4, zs / 2), (19.4, 0.1, zs))
        k['paint'].add(v, f, col('#c86a9a'))
        for sx in range(80, 1880, 240):
            gg = ground(sx, row)
            v, f = lib.box((gg[0], gg[1] - 0.3, zs / 2), (0.1, 0.1, zs))
            k['wood'].add(v, f, col('#b05a88'))
    k.build()


def barn():
    """A pink barn stage behind the bleachers: gabled front with white trim, star lights, a star sign."""
    k = Kit('barn')
    row = 560
    y = row_y(row)
    x0, x1 = 1180, 1840
    zb = 3.3
    K.quad_v(k['paint'], x0, x1, row, row - zpx(zb), row, '#ff8fc4', depth=0.5)
    # gable
    apex = ((x0 + x1) / 2 / PX, y, zb + 1.3)
    v = [(x0 / PX, y, zb), (x1 / PX, y, zb), apex]
    k['paint'].add(v, [(0, 1, 2)], col('#ff8fc4'))
    for (a, b) in [((x0 / PX, y - 0.05, zb), apex), ((x1 / PX, y - 0.05, zb), apex)]:
        v, f = lib.tube([a, (b[0], b[1] - 0.05, b[2])], 0.08, 6)
        k['paint'].add(v, f, col(CREAM))
    # big barn doors with white cross braces
    for dx in (-1, 1):
        cx = (x0 + x1) / 2 + dx * 90
        K.quad_v(k['paint'], cx - 85, cx + 85, row + 2, row - zpx(2.3), row, '#e0559a', depth=0.0)
        a = wp(cx - 80, row + 3, row - zpx(2.2))
        b = wp(cx + 80, row + 3, row - zpx(0.1))
        v, f = lib.tube([a, b], 0.05, 6)
        k['paint'].add(v, f, col(CREAM))
        a = wp(cx + 80, row + 3, row - zpx(2.2))
        b = wp(cx - 80, row + 3, row - zpx(0.1))
        v, f = lib.tube([a, b], 0.05, 6)
        k['paint'].add(v, f, col(CREAM))
    # star lights along the eaves and a sparkly star sign on the gable
    left = Vector((x0 / PX, y - 0.1, zb))
    top = Vector((apex[0], y - 0.1, apex[2]))
    right = Vector((x1 / PX, y - 0.1, zb))
    for i in range(9):
        p = left.lerp(top, i / 4) if i < 5 else top.lerp(right, (i - 4) / 4)
        K.flat_shape(k['bulb'], K.star_pts(5, 0.11, 0.05), (p.x, p.y - 0.06, p.z - 0.08), '#fff1b0', 0.03)
    c = (apex[0], y - 0.12, zb + 0.55)
    K.flat_shape(k['neon'], K.star_pts(5, 0.55, 0.24), c, HOT, 0.05)
    K.flat_shape(k['bulb'], K.star_pts(5, 0.3, 0.13), (c[0], c[1] - 0.04, c[2]), '#fff1b0', 0.04)
    k.build()


def disco():
    """A gantry arch over the ring, hung with a mirror-tiled disco ball."""
    k = Kit('disco')
    row = 700
    for sx in (120, 1800):
        a = ground(sx, row)
        v, f = lib.cylinder(a, 0.1, 0.08, 8.4, 10)
        k['chrome'].add(v, f, col('#d8dbe4'))
    a = wp(120, row, None, 8.4)
    b = wp(1800, row, None, 8.4)
    for dz in (0.0, -0.3):
        v, f = lib.tube([(a[0], a[1], a[2] + dz), (b[0], b[1], b[2] + dz)], 0.06, 8)
        k['chrome'].add(v, f, col('#d8dbe4'))
    for i in range(33):
        t = i / 32
        x = a[0] + (b[0] - a[0]) * t
        v, f = lib.tube([(x, a[1], a[2]), (x + (0.26 if i % 2 else -0.26), a[1], a[2] - 0.3)], 0.025, 5)
        k['chrome'].add(v, f, col('#c9ccd6'))
    # the ball: a faceted sphere of mirror tiles
    cx, cz = 960, z_of(row, 200)
    v, f = lib.tube([(9.6, row_y(row), a[2] - 0.3), (9.6, row_y(row), cz + 0.62)], 0.015, 4)
    k['chrome'].add(v, f, col('#aab0bc'))
    ico_v, ico_f = lib.icosphere(3)
    R = 0.58
    verts = [(9.6 + x * R, row_y(row) + y * R, cz + z * R) for (x, y, z) in ico_v]
    colors = []
    for (x, y, z) in ico_v:
        colors.append(col(rnd.choice(['#f4f6ff', '#d9dcf0', '#ffffff', '#ffd6ec', '#c9f4ff'])))
    mb = k['chrome']
    base = len(mb.v)
    mb.v.extend(verts)
    mb.f.extend([tuple(i + base for i in face) for face in ico_f])
    mb.c.extend(colors)
    k.build(smooth=False)


def dressing():
    k = Kit('dressing')
    # hay bales with pink bows at the corners, and cacti in pots
    for (sx, row, s) in [(70, 1010, 1.0), (190, 1050, 0.9), (1850, 1010, 1.0), (1730, 1050, 0.9), (60, 690, 0.8), (1860, 690, 0.8)]:
        g = ground(sx, row)
        v, f = lib.box((g[0], g[1], 0.28 * s), (0.9 * s, 0.55 * s, 0.56 * s))
        k['matte'].add(v, f, col('#e8c46a'))
        for dz in (0.15, 0.4):
            v, f = lib.box((g[0], g[1], dz * s), (0.92 * s, 0.57 * s, 0.03))
            k['matte'].add(v, f, col('#c9a04a'))
        v, f = lib.blob((g[0], g[1] - 0.3 * s, 0.56 * s), 0.12 * s, squash=(1.6, 0.6, 0.9), rough=0.1, subdiv=1)
        k['gloss'].add(v, f, col(HOT))
    for (sx, row) in [(300, 1060), (1620, 1060), (150, 880), (1770, 880)]:
        g = ground(sx, row)
        v, f = lib.lathe([(0.0, 0.0), (0.2, 0.0), (0.25, 0.3), (0.0, 0.3)], 14, g)
        k['gloss'].add(v, f, col(rnd.choice([PINK, '#2ec4b6', '#ffd23f'])))
        v, f = lib.lathe([(0.0, 0.0), (0.12, 0.05), (0.14, 0.5), (0.1, 0.8), (0.0, 0.86)], 12, (g[0], g[1], 0.28))
        k['leaf'].add(v, f, col('#3faa6a'))
        for side in (-1, 1):
            pts = [(g[0] + side * 0.12, g[1], 0.7), (g[0] + side * 0.3, g[1], 0.72), (g[0] + side * 0.32, g[1], 0.95)]
            v, f = lib.tube(pts, 0.07, 8)
            k['leaf'].add(v, f, col('#3faa6a'))
        v, f = lib.blob((g[0], g[1] - 0.05, 1.16), 0.07, rough=0.2, subdiv=1)
        k['flower'].add(v, f, col('#ff6fae'))
    k.build()
    # string lights from the gantry to the fence posts
    dress_lights()


def dress_lights():
    import mg_dress as dress
    row = 700
    top = wp(120, row, None, 8.0)
    top2 = wp(1800, row, None, 8.0)
    for (a, b) in [(top, ground(560, FENCE_ROW, 1.4)), (top2, ground(1360, FENCE_ROW, 1.4))]:
        dress.string_lights([a, b], sag=0.5, bulbs=12, colors=('#fff1b8', '#ffb3d6', '#bff4ff'), name='lights')


def scene():
    cam = K.start(A, ELEV, sun_elev=26, sun_az=-55, key=3.0, fill=0.8, key_col='#ffc9a0',
                  zenith='#8fb4ff', horizon='#ffb5b5', ground='#c89a9a')
    y0 = row_y(FENCE_ROW)
    lib.mesh_object('sand', [(-1.0, y0 + 0.4, 0.0), (20.2, y0 + 0.4, 0.0), (20.2, row_y(1500), 0.0), (-1.0, row_y(1500), 0.0)], [(3, 2, 1, 0)], smooth=False, material=sand_material())
    # the island top behind the ring
    # the lawn behind the ring ends in a wavy edge lined with bushes (no ruler-straight horizon)
    verts, faces = [], []
    n = 64
    for i in range(n + 1):
        sx = -100 + i * (2120 / n)
        edge = 210 + 26 * math.sin(sx * 0.006 + 1.3) + 12 * math.sin(sx * 0.017)
        verts.append((sx / PX, row_y(edge), 0.0))
        verts.append((sx / PX, y0 + 0.4, 0.0))
    for i in range(n):
        a = i * 2
        faces.append((a + 1, a + 3, a + 2, a))
    lib.mesh_object('lawn', verts, faces, smooth=False, material=lib.simple_mat('lawn', '#7fcf6a', rough=0.9))
    import terrain
    hedge, wood_h, berries = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    for i in range(46):
        sx = -80 + i * 46 + rnd.uniform(-10, 10)
        edge = 210 + 26 * math.sin(sx * 0.006 + 1.3) + 12 * math.sin(sx * 0.017)
        terrain.bush(hedge, sx, edge + 6, rnd, rnd.uniform(0.9, 1.4), berries=berries if i % 3 == 0 else None)
    hedge.build('hedge', lib.attr_mat('hedge', rough=0.78, ao=0.5))
    berries.build('hedge_fl', lib.attr_mat('hedge_fl', rough=0.55))
    fence()
    bleachers()
    barn()
    disco()
    dressing()
    # a couple of trees and a windmill-free skyline of bunting poles on the far lawn
    for (sx, row, s) in [(90, 430, 1.2), (330, 410, 0.9), (620, 420, 1.0), (1020, 415, 0.95)]:
        leaves, wood = lib.MeshBuilder(), lib.MeshBuilder()
        import terrain
        terrain.tree_round(leaves, wood, sx, row, rnd, s)
        leaves.build(f'tree_l{sx}', lib.attr_mat(f'treel{sx}', rough=0.78, ao=0.5))
        wood.build(f'tree_w{sx}', lib.attr_mat(f'treew{sx}', rough=0.8, ao=0.3))
    out = os.path.join(K.OUT, 'rodeo.png' if not A.preview else 'rodeo_preview.png')
    if K.render(A, out):
        K.publish(A, out, 'showtime_rodeo')


# --- The pony ----------------------------------------------------------------------------------
# Rendered alone over this screen region; the pivot (column top) sits at PIV, the base at (PX0, PONY_ROW).
PREG = (740, 460, 440, 400)
PX0 = 960
PIVOT_Z = 1.2


def pony_parts():
    """Build the pony (named parts) around the pivot. Returns (front objects names, seat world point)."""
    base = Vector(ground(PX0, PONY_ROW))
    P = Vector((base.x, base.y, PIVOT_Z))
    body = Kit('pony')
    front = Kit('ponyfront')
    pink, pinkd, white = '#ff9ccb', '#ff6fae', '#fff8fb'
    # barrel: in the front kit (with the saddle), which is also drawn again over the rider's legs
    v, f = lib.blob((P.x, P.y, P.z + 0.36), 1.0, squash=(1.12, 0.42, 0.44), rough=0.0, subdiv=3)
    front['gloss'].add(v, f, col(pink))
    # neck, head, ears, muzzle
    v, f = lib.tube([(P.x + 0.8, P.y, P.z + 0.45), (P.x + 1.08, P.y, P.z + 0.9), (P.x + 1.2, P.y, P.z + 1.22)], lambda t: 0.3 - 0.1 * t, 12)
    body['gloss'].add(v, f, col(pink))
    v, f = lib.blob((P.x + 1.42, P.y, P.z + 1.18), 0.42, squash=(1.0, 0.5, 0.52), rough=0.0, subdiv=3)
    v = lib.transform([(x - (P.x + 1.42), y - P.y, z - (P.z + 1.18)) for (x, y, z) in v], loc=(P.x + 1.42, P.y, P.z + 1.18), rot=(0, 0.35, 0))
    body['gloss'].add(v, f, col(pink))
    v, f = lib.blob((P.x + 1.74, P.y, P.z + 1.02), 0.18, squash=(1.0, 0.9, 0.85), rough=0.0, subdiv=2)
    body['gloss'].add(v, f, col('#ffc2dd'))
    for dy in (-0.1, 0.1):
        v, f = lib.lathe([(0.07, 0.0), (0.05, 0.12), (0.0, 0.2)], 8, (P.x + 1.28, P.y + dy, P.z + 1.4))
        body['gloss'].add(v, f, col(pink))
    # eye (a glossy dark gem with a sparkle) and a rhinestone bridle
    v, f = lib.blob((P.x + 1.5, P.y - 0.18, P.z + 1.26), 0.06, rough=0.0, subdiv=2)
    body['gloss'].add(v, f, col('#2a1030'))
    v, f = lib.blob((P.x + 1.52, P.y - 0.22, P.z + 1.28), 0.02, rough=0.0, subdiv=1)
    body['bulb'].add(v, f, col('#ffffff'))
    for i in range(7):
        t = i / 6
        p = Vector((P.x + 1.28 + 0.44 * t, P.y - 0.2, P.z + 1.36 - 0.34 * t))
        v, f = lib.blob(tuple(p), 0.035, rough=0.0, subdiv=1)
        body['glass'].add(v, f, col('#fff0fa'))
    # mane and forelock (fluffy white), tail
    for i in range(8):
        t = i / 7
        p = (P.x + 0.72 + 0.5 * t, P.y + 0.02, P.z + 0.62 + 0.72 * t)
        v, f = lib.blob(p, 0.16 - 0.03 * t, squash=(1.0, 0.8, 1.0), rough=0.3, subdiv=2, seed=i)
        body['gloss'].add(v, f, col(white))
    for i in range(6):
        t = i / 5
        p = (P.x - 1.12 - 0.22 * t, P.y + 0.02, P.z + 0.52 - 0.55 * t)
        v, f = lib.blob(p, 0.17 - 0.02 * t, squash=(0.9, 0.8, 1.1), rough=0.3, subdiv=2, seed=i + 9)
        body['gloss'].add(v, f, col(white))
    # legs in a rocking-horse gallop, with gold hooves
    for (hip, knee, hoof) in [((0.7, 0.18), (1.05, -0.12), (1.32, -0.42)), ((0.62, -0.18), (0.98, -0.2), (1.22, -0.5)),
                              ((-0.72, 0.18), (-1.05, -0.12), (-1.34, -0.34)), ((-0.64, -0.18), (-0.98, -0.2), (-1.24, -0.44))]:
        dy = 0.2 if hip[1] > 0 else -0.2
        pts = [(P.x + hip[0], P.y + dy, P.z + 0.2), (P.x + knee[0], P.y + dy, P.z + knee[1]), (P.x + hoof[0], P.y + dy, P.z + hoof[1])]
        v, f = lib.tube(pts, lambda t: 0.13 - 0.04 * t, 10)
        body['gloss'].add(v, f, col(pink if dy < 0 else pinkd))
        v, f = lib.blob((pts[-1][0], pts[-1][1], pts[-1][2] - 0.05), 0.1, squash=(1.1, 1.0, 0.8), rough=0.0, subdiv=1)
        body['metal'].add(v, f, col('#f2c14e'))
    # rhinestones scattered over the body
    for i in range(26):
        a = rnd.uniform(-2.6, 2.6)
        zz = rnd.uniform(-0.25, 0.3)
        v, f = lib.blob((P.x + math.sin(a) * 0.95, P.y - 0.4 - 0.02 * abs(zz), P.z + 0.36 + zz), 0.035, rough=0.0, subdiv=1)
        body['glass'].add(v, f, col(rnd.choice(['#ffffff', '#fff0fa', '#e0f7ff'])))
    # saddle (front kit): a hot-pink pad, a dished white seat, a rounded near-side skirt with gold
    # trim and rhinestones, and a little gold stirrup; the horn stays in the body kit (behind the rider)
    seat = Vector((P.x - 0.05, P.y, P.z + 0.82))
    k = front
    v, f = lib.blob((seat.x, seat.y, seat.z - 0.07), 0.5, squash=(1.08, 0.96, 0.13), rough=0.0, subdiv=3)
    k['gloss'].add(v, f, col('#ff4f9a'))
    v, f = lib.blob((seat.x, seat.y, seat.z + 0.03), 0.42, squash=(1.0, 0.9, 0.2), rough=0.0, subdiv=3)
    k['gloss'].add(v, f, col(white))

    def rounded_rect(w, h, r, n=5):
        pts = []
        for (cx, cz, a0) in [(w / 2 - r, h / 2 - r, 0.0), (-w / 2 + r, h / 2 - r, math.pi / 2), (-w / 2 + r, -h / 2 + r, math.pi), (w / 2 - r, -h / 2 + r, 1.5 * math.pi)]:
            for i in range(n + 1):
                a = a0 + i / n * math.pi / 2
                pts.append((cx + math.cos(a) * r, cz + math.sin(a) * r))
        return pts
    sz = seat.z - 0.3
    K.flat_shape(k['metal'], rounded_rect(0.7, 0.5, 0.14), (seat.x, seat.y - 0.425, sz), '#f2c14e', 0.02)
    K.flat_shape(k['gloss'], rounded_rect(0.62, 0.42, 0.11), (seat.x, seat.y - 0.44, sz), white, 0.02)
    K.flat_shape(k['gloss'], rounded_rect(0.4, 0.22, 0.08), (seat.x, seat.y - 0.455, sz), '#ffb3d6', 0.01)
    for i in range(5):
        v, f = lib.blob((seat.x - 0.22 + i * 0.11, seat.y - 0.47, sz + 0.17), 0.028, rough=0.0, subdiv=1)
        k['glass'].add(v, f, col('#fff0fa'))
    v, f = lib.tube([(seat.x, seat.y - 0.45, sz - 0.2), (seat.x, seat.y - 0.46, sz - 0.34)], 0.018, 5)
    k['metal'].add(v, f, col('#e0a93f'))
    ring = [(seat.x + math.cos(a) * 0.075, seat.y - 0.46, sz - 0.41 + math.sin(a) * 0.06) for a in [i / 12 * math.tau for i in range(13)]]
    v, f = lib.tube(ring, 0.018, 5)
    k['metal'].add(v, f, col('#f2c14e'))
    # horn and gems (body kit)
    v, f = lib.cylinder((seat.x + 0.36, seat.y, seat.z), 0.05, 0.06, 0.22, 10)
    body['gloss'].add(v, f, col(white))
    v, f = lib.blob((seat.x + 0.36, seat.y, seat.z + 0.24), 0.08, squash=(1.2, 1.2, 0.6), rough=0.0, subdiv=1)
    body['metal'].add(v, f, col('#f2c14e'))
    return body, front, seat, P


def pony_base_parts():
    base = Vector(ground(PX0, PONY_ROW))
    k = Kit('ponybase')
    # a round padded mat (quilted pink with a cream rim), a gold hydraulic column and a control box
    v, f = lib.lathe([(0.0, 0.0), (1.55, 0.0), (1.6, 0.08), (1.55, 0.2), (0.0, 0.22)], 40, (base.x, base.y, 0.0))
    k['gloss'].add(v, f, col('#ffb3d4'))
    v, f = lib.lathe([(1.5, 0.19), (1.62, 0.12), (1.64, 0.2), (1.52, 0.24)], 40, (base.x, base.y, 0.0), cap_bottom=False, cap_top=False)
    k['paint'].add(v, f, col(CREAM))
    for i in range(14):
        a = i / 14 * math.tau
        v, f = lib.blob((base.x + math.cos(a) * 1.0, base.y + math.sin(a) * 1.0, 0.22), 0.05, rough=0.0, subdiv=1)
        k['glass'].add(v, f, col('#fff0fa'))
    v, f = lib.cylinder((base.x, base.y, 0.2), 0.34, 0.3, 0.2, 18)
    k['chrome'].add(v, f, col('#d8dbe4'))
    v, f = lib.cylinder((base.x, base.y, 0.38), 0.14, 0.12, PIVOT_Z - 0.3, 14)
    k['metal'].add(v, f, col('#f2c14e'))
    v, f = lib.box((base.x + 1.1, base.y + 0.5, 0.35), (0.34, 0.24, 0.32))
    k['paint'].add(v, f, col('#c9a0ff'))
    for i in range(3):
        v, f = lib.blob((base.x + 1.0 + i * 0.1, base.y + 0.37, 0.42), 0.03, rough=0.0, subdiv=1)
        k['bulb'].add(v, f, col(['#ff5a8a', '#ffd23f', '#5ce1ff'][i]))
    return k


def pony():
    region = PREG
    cam = K.start(A, ELEV, sun_elev=26, sun_az=-55, key=3.0, fill=0.8, key_col='#ffc9a0',
                  zenith='#8fb4ff', horizon='#ffb5b5', ground='#c89a9a', region=region)
    body, front, seat, P = pony_parts()
    body_obs = body.build()
    front_obs = front.build()
    base = pony_base_parts()
    base_obs = base.build()
    sc = bpy.context.scene
    s = 0.5 if A.preview else 1.0
    sc.render.resolution_x = int(region[2] * s)
    sc.render.resolution_y = int(region[3] * s)
    piv = lib.world_to_board(P)
    seat_px = lib.world_to_board(seat)
    anchor = ((piv[0] - region[0]) / region[2], (piv[1] - region[1]) / region[3])
    base_px = lib.world_to_board(Vector(ground(PX0, PONY_ROW)))
    base_anchor = ((base_px[0] - region[0]) / region[2], (base_px[1] - region[1]) / region[3])
    print('PONY pivot px', piv, 'anchor', anchor, 'seat offset', (seat_px[0] - piv[0], seat_px[1] - piv[1]), 'base anchor', base_anchor)

    def only(obs, name):
        for ob in bpy.data.objects:
            if ob.type == 'MESH':
                ob.visible_camera = ob in obs
        out = os.path.join(K.OUT, f'{name}.png' if not A.preview else f'{name}_preview.png')
        if not K.render(A, out):
            return
        if not A.preview:
            dst = os.path.join(K.PUB, 'mg', f'showtime_{name}.webp')
            Image.open(out).convert('RGBA').save(dst, 'WEBP', quality=92, method=6)
            print('wrote', dst)
    # The pony (both kits), then its front layer: the barrel and saddle, with the legs, neck, head
    # and tail as holdouts so they cut it out wherever they are nearer (the lighting is identical).
    for ob in base_obs:
        ob.visible_shadow = False
    only(body_obs + front_obs, 'pony')
    for ob in body_obs:
        ob.is_holdout = True
    only(body_obs + front_obs, 'pony_front')
    for ob in body_obs:
        ob.is_holdout = False
    for ob in base_obs:
        ob.visible_shadow = True
    for ob in body_obs + front_obs:
        ob.visible_shadow = False
    only(base_obs, 'pony_base')


if A.what == 'scene':
    scene()
else:
    pony()
