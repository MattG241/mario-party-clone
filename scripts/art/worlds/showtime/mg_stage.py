"""Hip-Shake Hustle arena: an open-air 1950s bandshell on the Showtime Strip, at dusk.

    .../with-blender-lock .../bpyenv/bin/python scripts/art/worlds/showtime/mg_stage.py [--preview] [--samples N]

Front view (16 deg): three concentric marquee arches (cream with gold bulbs, coral, turquoise), a
glossy checkerboard stage, tied-back velvet drapes and a scalloped valance, a sunburst backdrop with
starbursts and a ring of bulbs, the band's gear on a riser (drum kit, upright bass, upright piano,
amps), footlights along the front edge and a dark plaza in front where the game stands its crowd.
No text, logos or insignia anywhere. Layout the game relies on (HipShake.ts):
  - dancers' feet on row 820, anywhere between x 250 and 1670 (keep that floor clear),
  - the front arch: centre (960, 885), inner half-size 820 x 790 px, band 64 px, exponent 2.7 -
    the game lights a chase along its bulbs (ARCH in HipShake.ts must match),
  - a lighting truss across y ~112 where the game's spotlight beams start,
  - footlights on row 880; the crowd covers y 900..1080.
Writes public/assets/rendered/scene_showtime_stage.webp.
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

A = K.args()
rnd = random.Random(7)

ELEV = 16
FRONT_ROW = 885
BACK_ROW = 645
N_EXP = 2.7
# (row, inner a px, inner b px, band px, colour, depth units)
RINGS = [
    (885, 820, 790, 64, '#fff0d6', 0.7),
    (800, 772, 640, 54, '#ff7aa2', 0.5),
    (715, 728, 500, 48, '#2ec4b6', 0.45),
]


def sunburst_material():
    """Rays of turquoise and cream round a point behind the drum riser, darkening towards the rim."""
    m = lib.NT('sunburst')
    pos = m.position()
    X, Y, Z = m.sep(pos)
    cx = 960 / PX
    zc = z_of(BACK_ROW, 470)
    dx = m.math('SUBTRACT', X, cx)
    dz = m.math('SUBTRACT', Z, zc)
    ang = m.math('ARCTAN2', dz, dx)
    rays = m.math('SINE', m.math('MULTIPLY', ang, 12.0))
    fac = m.maprange(rays, -0.06, 0.06)
    c = m.mix(fac, col('#17a9a8'), col('#ffe9cf'))
    r = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', dx, dx), m.math('MULTIPLY', dz, dz)))
    rim = m.maprange(r, 2.0, 7.5)
    c = m.mix(m.math('MULTIPLY', rim, 0.55), c, col('#5b2a6e'))
    glow = m.maprange(r, 2.6, 0.0)
    c = m.mix(m.math('MULTIPLY', glow, 0.35), c, col('#fff6c8'))
    m.bsdf(c, 0.7)
    return m.mat


def checker_material():
    """Glossy black-and-cream checkerboard (tiles 1.2 units), a little worn and reflective."""
    m = lib.NT('checker_floor')
    pos = m.position()
    ch = m.node('ShaderNodeTexChecker')
    ch.inputs['Scale'].default_value = 1.0
    mp = m.node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / 1.2, 1 / 1.2, 1.0)
    m.link(pos, mp.inputs['Vector'])
    m.link(mp.outputs['Vector'], ch.inputs['Vector'])
    ch.inputs['Color1'].default_value = col('#fff4e4')
    ch.inputs['Color2'].default_value = col('#20182a')
    n = m.noise(3.0, 4, 0.6, pos)
    c = m.mult(ch.outputs['Color'], m.mix(n.outputs['Fac'], col('#d8d0cc'), col('#ffffff')))
    c = m.mult(c, m.mix(m.ao(0.6, 8), col('#5a4a66'), col('#ffffff')))
    m.bsdf(c, 0.22, coat=0.7, spec=0.6)
    return m.mat


def rings():
    k = Kit('rings')
    for (row, a, b, w, colr, depth) in RINGS:
        K.arch_band(k['gloss'], 960, row, a, b, N_EXP, w, depth, colr)
        # a thin gold lip on the inner edge and a darker shadow band behind it
        K.arch_band(k['metal'], 960, row - 1, a - 6, b - 6, N_EXP, 7, depth * 0.6, '#e8b04a')
    # marquee bulbs along the front band (the game lights a chase over these)
    row, a, b, w, _, _ = RINGS[0]
    for (sx, sy) in K.arch_points(960, row, a + w / 2, b + w / 2, N_EXP, 46):
        p = wp(sx, row, sy)
        K.bulb(k['bulb'], (p[0], p[1] - 0.08, p[2]), 0.085, '#fff1b0')
        v, f = lib.cylinder((p[0], p[1] - 0.02, p[2]), 0.1, 0.1, 0.04, 10)
        v = lib.transform([(x - p[0], y - (p[1] - 0.02), z - p[2]) for (x, y, z) in v], loc=(p[0], p[1] - 0.02, p[2]), rot=(-math.pi / 2, 0, 0))
        k['metal'].add(v, f, col('#c98a2b'))
    # small bulbs on the coral ring too (static glow)
    row, a, b, w, _, _ = RINGS[1]
    for (sx, sy) in K.arch_points(960, row, a + w / 2, b + w / 2, N_EXP, 70):
        p = wp(sx, row, sy)
        K.bulb(k['bulb'], (p[0], p[1] - 0.07, p[2]), 0.055, '#ffd0e0')
    # the rings' feet: plinths
    for (row, a, b, w, colr, depth) in RINGS:
        for side in (-1, 1):
            x = 960 + side * (a + w / 2)
            v, f = lib.box((x / PX, row_y(row) + depth / 2, 0.18), (w / PX + 0.2, depth + 0.2, 0.36))
            k['paint'].add(v, f, col('#c98a2b' if row == FRONT_ROW else '#f7e3c4'))
    k.build()


def backdrop():
    y = row_y(BACK_ROW)
    # the backdrop fills the innermost arch (a superellipse), so nothing square shows round it
    k_ = PX * lib.SINB
    verts = [(960 / PX, y, 0.0)]
    seg = 64
    for i in range(seg + 1):
        t = math.pi * i / seg
        xx, zz = K.superellipse(t, 760, 560, N_EXP)
        verts.append(((960 + xx) / PX, y, zz / k_))
    faces = [(0, i + 2, i + 1) for i in range(seg)]
    lib.mesh_object('backdrop', verts, faces, smooth=False, material=sunburst_material())
    k = Kit('backdrop_deco')
    # starbursts on the rays
    for (sx, sy, r, n, c) in [(420, 330, 0.55, 4, '#ffd23f'), (1500, 330, 0.55, 4, '#ffd23f'), (560, 470, 0.34, 8, '#ff7aa2'),
                              (1360, 470, 0.34, 8, '#ff7aa2'), (330, 520, 0.3, 4, '#fff6d8'), (1590, 520, 0.3, 4, '#fff6d8'),
                              (700, 300, 0.26, 4, '#fff6d8'), (1220, 300, 0.26, 4, '#fff6d8')]:
        p = wp(sx, BACK_ROW + 3, sy)
        K.flat_shape(k['neon'] if c == '#ffd23f' else k['gloss'], K.star_pts(n, r, r * (0.3 if n == 4 else 0.45)), (p[0], p[1], p[2]), c, 0.03)
    # a ring of bulbs round a pink star medallion behind the drums
    cx, cy, R = 960, 440, 140
    for i in range(28):
        a = i / 28 * math.tau
        p = wp(cx + math.cos(a) * R, BACK_ROW + 3, cy + math.sin(a) * R)
        K.bulb(k['bulb'], (p[0], p[1] - 0.05, p[2]), 0.07, '#fff1b0')
    p = wp(cx, BACK_ROW + 3, cy)
    K.disc_v(k['gloss'], p[0], p[2], p[1] + 0.02, R / PX * 0.94, '#3a1f5c', 40, 0.02)
    K.flat_shape(k['gloss'], K.star_pts(5, 1.05, 0.46), (p[0], p[1] - 0.03, p[2]), '#ff7aa2', 0.04)
    K.flat_shape(k['neon'], K.star_pts(5, 0.62, 0.27), (p[0], p[1] - 0.06, p[2]), '#fff1b0', 0.04)
    k.build()


def drapes():
    k = Kit('drapes')
    # tied-back drapes at both sides (behind the coral ring), with gold rope tie-backs
    row = 702
    K.curtain(k['velvet'], 238, 430, row, 250, 700, '#b0123a', folds=6, amp=0.16, tie=540, side='left', gather=0.66)
    K.curtain(k['velvet'], 1490, 1682, row, 250, 700, '#b0123a', folds=6, amp=0.16, tie=540, side='right', gather=0.66)
    for sx in (262, 1658):
        p = wp(sx, row + 4, 540)
        v, f = lib.blob((p[0], p[1] - 0.2, p[2]), 0.13, squash=(1.3, 0.6, 1.0), rough=0.1, subdiv=2)
        k['metal'].add(v, f, col('#f2c14e'))
        v, f = lib.tube([(p[0], p[1] - 0.2, p[2]), (p[0] + 0.05, p[1] - 0.22, p[2] - 0.35)], 0.035, 6)
        k['metal'].add(v, f, col('#e0a93f'))
    # scalloped valance across the top of the innermost ring, with a gold fringe
    row = 705
    top, bot = 205, 272
    y = row_y(row)
    n = 12
    x0, x1 = 250, 1670
    verts, faces = [], []
    for i in range(n * 8 + 1):
        u = i / (n * 8)
        sx = x0 + (x1 - x0) * u
        sc = abs(math.sin(u * n * math.pi))
        sy_b = bot - 22 + 34 * sc
        depth = 0.1 * math.sin(u * n * 2 * math.pi)
        verts.append((sx / PX, y + depth, z_of(row, top)))
        verts.append((sx / PX, y + depth - 0.05, z_of(row, sy_b)))
    for i in range(n * 8):
        a = i * 2
        faces.append((a + 1, a + 3, a + 2, a))
    k['velvet'].add(verts, faces, col('#a0103a'))
    for i in range(n * 8 + 1):
        u = i / (n * 8)
        sx = x0 + (x1 - x0) * u
        sc = abs(math.sin(u * n * math.pi))
        sy_b = bot - 22 + 34 * sc
        p = wp(sx, row, sy_b)
        v, f = lib.cylinder((p[0], y - 0.08, p[2] - 0.1), 0.02, 0.012, 0.12, 5)
        k['metal'].add(v, f, col('#f2c14e'))
    # the lighting truss the game's spotlight beams hang from
    trow = 905
    a = wp(250, trow, 148)
    b = wp(1670, trow, 148)
    for dz in (0.0, -0.22):
        v, f = lib.tube([(a[0], a[1], a[2] + dz), (b[0], b[1], b[2] + dz)], 0.04, 8)
        k['metal'].add(v, f, col('#c9ccd6'))
    for i in range(29):
        t = i / 28
        x = a[0] + (b[0] - a[0]) * t
        v, f = lib.tube([(x, a[1], a[2]), (x + (0.25 if i % 2 else -0.25) * 0.6, a[1], a[2] - 0.22)], 0.018, 5)
        k['metal'].add(v, f, col('#aab0bc'))
    for i in range(12):
        t = (i + 0.5) / 12
        x = a[0] + (b[0] - a[0]) * t
        v, f = lib.lathe([(0.1, 0.0), (0.12, 0.1), (0.15, 0.28), (0.0, 0.3)], 12, (0, 0, 0))
        v = lib.transform(v, loc=(x, a[1] - 0.05, a[2] - 0.3), rot=(math.pi * 0.85, 0, 0))
        k['paint'].add(v, f, col('#2a2238'))
        v, f = lib.blob((x, a[1] - 0.25, a[2] - 0.5), 0.07, rough=0.0, subdiv=1)
        k['bulb'].add(v, f, col('#fff4d0'))
    k.build()


def floor():
    y0, y1 = row_y(FRONT_ROW), row_y(BACK_ROW)
    x0, x1 = 120 / PX, 1800 / PX
    lib.mesh_object('stage_floor', [(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)], [(0, 1, 2, 3)], smooth=False, material=checker_material())
    k = Kit('apron')
    # apron front face with a gold trim and portholes
    K.quad_v(k['gloss'], 120, 1800, FRONT_ROW + 1, FRONT_ROW + 1, FRONT_ROW + 1 + zpx(1.3), '#7a1830', depth=0.0)
    v, f = lib.box((960 / PX, y0 - 0.06, -0.06), (x1 - x0 + 0.05, 0.14, 0.12))
    k['metal'].add(v, f, col('#e8b04a'))
    for i in range(10):
        sx = 215 + i * 165
        p = wp(sx, FRONT_ROW + 2, None, -0.65)
        K.disc_v(k['metal'], p[0], p[2], p[1] - 0.02, 0.2, '#e8b04a', 20, 0.03)
        K.disc_v(k['bulb'], p[0], p[2], p[1] - 0.05, 0.14, '#ffcf8a', 20, 0.02)
    # footlights: small hoods with warm bulbs along the front edge
    for i in range(21):
        sx = 190 + i * 77
        g = ground(sx, 876)
        v, f = lib.lathe([(0.0, 0.0), (0.13, 0.0), (0.13, 0.1), (0.0, 0.16)], 12, (g[0], g[1], g[2]), squash_y=0.6)
        k['metal'].add(v, f, col('#3a2f45'))
        v, f = lib.blob((g[0], g[1] - 0.12, g[2] + 0.07), 0.07, squash=(1.2, 0.8, 0.8), rough=0.0, subdiv=1)
        k['bulb'].add(v, f, col('#ffe0a0'))
    # the plaza in front, where the crowd stands
    zg = -1.3
    yb = row_y(380)
    lib.mesh_object('plaza', [(-2.0, yb, zg), (22.0, yb, zg), (22.0, y0 - 30, zg), (-2.0, y0 - 30, zg)], [(3, 2, 1, 0)], smooth=False,
                    material=lib.simple_mat('plaza', '#2e2244', rough=0.8))
    k.build()


def band_gear():
    k = Kit('band')
    riser_row = 668
    g = ground(960, riser_row)
    # riser: red carpet top with a gold edge
    v, f = lib.box((g[0], g[1], 0.2), (3.8, 1.5, 0.4))
    k['paint'].add(v, f, col('#6e0f2c'))
    v, f = lib.box((g[0], g[1] - 0.76, 0.2), (3.84, 0.04, 0.42))
    k['metal'].add(v, f, col('#e8b04a'))
    top = 0.4
    fy = g[1] - 0.2  # the kit sits towards the front of the riser
    # bass drum on its side facing the camera
    R, D = 0.48, 0.42
    v, f = lib.cylinder((0, 0, 0), R, R, D, 28)
    v = lib.transform(v, loc=(g[0], fy - D / 2, top + R), rot=(-math.pi / 2, 0, 0))
    k['gloss'].add(v, f, col('#c21845'))
    K.disc_v(k['paint'], g[0], top + R, fy - D / 2 - 0.005, R * 0.92, '#fff4e4', 32, 0.01)
    K.flat_shape(k['gloss'], K.star_pts(5, 0.3, 0.13), (g[0], fy - D / 2 - 0.02, top + R), '#ff7aa2', 0.01)
    v, f = lib.lathe([(R + 0.02, 0.0), (R + 0.02, 0.05)], 28, (0, 0, 0), cap_bottom=False, cap_top=False)
    v = lib.transform(v, loc=(g[0], fy - D / 2 - 0.02, top + R), rot=(-math.pi / 2, 0, 0))
    k['chrome'].add(v, f, col('#e6e8ef'))
    # snare, toms, floor tom
    def drum(x, z, r, h, tilt=0.0, shell='#c21845'):
        v, f = lib.cylinder((0, 0, 0), r, r, h, 18)
        v = lib.transform(v, loc=(x, fy - 0.05, z), rot=(tilt, 0, 0))
        k['gloss'].add(v, f, col(shell))
        v, f = lib.cylinder((0, 0, h - 0.005), r * 0.96, r * 0.96, 0.012, 18)
        v = lib.transform(v, loc=(x, fy - 0.05, z), rot=(tilt, 0, 0))
        k['paint'].add(v, f, col('#fff8ee'))
    drum(g[0] - 0.62, top + 0.62, 0.22, 0.14, -0.25)
    drum(g[0] - 0.22, top + 1.05, 0.17, 0.18, -0.45)
    drum(g[0] + 0.22, top + 1.05, 0.17, 0.18, -0.45)
    drum(g[0] + 0.66, top + 0.35, 0.25, 0.34, -0.15)
    for x in (g[0] - 0.62, g[0] + 0.66):
        v, f = lib.cylinder((x, fy, top), 0.02, 0.02, 0.6, 6)
        k['chrome'].add(v, f, col('#d8dbe4'))
    # cymbals on stands (hi-hat, crash, ride)
    def cymbal(x, z, r, tilt):
        v, f = lib.lathe([(0.0, 0.03), (r * 0.25, 0.028), (r, 0.0), (r, -0.006), (r * 0.25, 0.018), (0.0, 0.02)], 22, (0, 0, 0))
        v = lib.transform(v, loc=(x, fy + 0.1, z), rot=(tilt, 0.1, 0))
        k['metal'].add(v, f, col('#f2c14e'))
        v, f = lib.cylinder((x, fy + 0.1, top), 0.018, 0.015, z - top, 6)
        k['chrome'].add(v, f, col('#d8dbe4'))
    cymbal(g[0] - 1.02, top + 1.0, 0.26, -0.2)
    cymbal(g[0] - 1.02, top + 1.06, 0.26, -0.2)
    cymbal(g[0] - 0.78, top + 1.62, 0.34, -0.5)
    cymbal(g[0] + 0.95, top + 1.5, 0.38, -0.45)
    # stool behind
    v, f = lib.cylinder((g[0] + 0.1, fy + 0.55, top + 0.45), 0.22, 0.22, 0.1, 16)
    k['velvet'].add(v, f, col('#8a1030'))
    # upright bass on a stand, stage left
    bx = ground(565, 700)
    body_c = (bx[0], bx[1], 0.72)
    for (dz, r, sq) in [(-0.12, 0.38, (1.0, 0.34, 1.05)), (0.36, 0.29, (1.0, 0.34, 0.95))]:
        v, f = lib.blob((body_c[0], body_c[1], body_c[2] + dz), r, squash=sq, rough=0.0, subdiv=3)
        v = lib.transform([(x - body_c[0], y - body_c[1], z - body_c[2]) for (x, y, z) in v], loc=body_c, rot=(0, 0.12, 0))
        k['gloss'].add(v, f, col('#8a4520'))
    neck = [(0, 0, 0.62), (0, 0, 1.55)]
    v, f = lib.tube([tuple(Vector(p) + Vector((0, -0.03, 0))) for p in neck], 0.045, 6)
    v = lib.transform(v, loc=body_c, rot=(0, 0.12, 0))
    k['wood'].add(v, f, col('#2a1a12'))
    v, f = lib.blob((0, -0.03, 1.62), 0.08, squash=(0.8, 0.8, 1.2), rough=0.1, subdiv=1)
    v = lib.transform(v, loc=body_c, rot=(0, 0.12, 0))
    k['wood'].add(v, f, col('#6a3a1e'))
    for s_ in (-0.03, -0.01, 0.01, 0.03):
        v, f = lib.tube([(s_, -0.13, -0.3), (s_ * 0.6, -0.08, 1.5)], 0.004, 4)
        v = lib.transform(v, loc=body_c, rot=(0, 0.12, 0))
        k['chrome'].add(v, f, col('#f4f0e6'))
    v, f = lib.cylinder((bx[0] - 0.08, bx[1], 0.0), 0.012, 0.012, 0.35, 5)
    k['chrome'].add(v, f, col('#d8dbe4'))
    # upright piano in white lacquer with gold trim, stage right
    px = ground(1355, 690)
    v, f = lib.box((px[0], px[1], 0.62), (1.5, 0.55, 1.24))
    k['gloss'].add(v, f, col('#fbf6ee'))
    v, f = lib.box((px[0], px[1] - 0.37, 0.72), (1.44, 0.24, 0.07))
    k['gloss'].add(v, f, col('#fbf6ee'))
    v, f = lib.box((px[0], px[1] - 0.4, 0.765), (1.36, 0.18, 0.02))
    k['paint'].add(v, f, col('#fffdf8'))
    for i in range(20):
        if i % 7 in (2, 6):
            continue
        v, f = lib.box((px[0] - 0.64 + i * 0.066, px[1] - 0.36, 0.79), (0.035, 0.11, 0.03))
        k['paint'].add(v, f, col('#1a1420'))
    v, f = lib.box((px[0], px[1] - 0.285, 1.2), (1.52, 0.02, 0.05))
    k['metal'].add(v, f, col('#e8b04a'))
    for dx in (-0.62, 0.62):
        v, f = lib.cylinder((px[0] + dx, px[1] - 0.4, 0.0), 0.05, 0.04, 0.72, 8)
        k['gloss'].add(v, f, col('#fbf6ee'))
    v, f = lib.lathe([(0.0, 0.0), (0.09, 0.02), (0.1, 0.12), (0.05, 0.2), (0.06, 0.24)], 12, (px[0] + 0.45, px[1], 1.24))
    k['gloss'].add(v, f, col('#ff7aa2'))
    for j in range(5):
        v, f = lib.blob((px[0] + 0.45 + (j - 2) * 0.05, px[1] - 0.02, 1.52 + (j % 2) * 0.05), 0.06, rough=0.2, subdiv=1, seed=j)
        k['flower'].add(v, f, col(['#ffd23f', '#ff7aa2', '#fff4e4', '#ffd23f', '#c49bff'][j]))
    # two tweed amps
    for sx in (760, 1160):
        a = ground(sx, 706)
        v, f = lib.box((a[0], a[1], 0.28), (0.66, 0.34, 0.56))
        k['matte'].add(v, f, col('#c9a46a'))
        v, f = lib.box((a[0], a[1] - 0.172, 0.3), (0.54, 0.01, 0.38))
        k['matte'].add(v, f, col('#4a3526'))
        for i in range(3):
            v, f = lib.blob((a[0] - 0.12 + i * 0.12, a[1] - 0.18, 0.5), 0.025, rough=0.0, subdiv=1)
            k['chrome'].add(v, f, col('#e6e8ef'))
    # vintage microphones on stands at the front corners
    for sx in (206, 1714):
        m = ground(sx, 858)
        v, f = lib.cylinder((m[0], m[1], 0.0), 0.16, 0.12, 0.05, 14)
        k['chrome'].add(v, f, col('#d8dbe4'))
        v, f = lib.cylinder((m[0], m[1], 0.0), 0.02, 0.02, 1.62, 6)
        k['chrome'].add(v, f, col('#d8dbe4'))
        v, f = lib.blob((m[0], m[1] - 0.02, 1.74), 0.12, squash=(0.9, 0.7, 1.25), rough=0.0, subdiv=2)
        k['chrome'].add(v, f, col('#eef0f6'))
        v, f = lib.lathe([(0.1, 0.0), (0.1, 0.05)], 16, (m[0], m[1] - 0.02, 1.71), cap_bottom=False, cap_top=False)
        k['metal'].add(v, f, col('#e8b04a'))
    k.build()


def surroundings():
    """Beyond the shell: palms, neon starburst signs on poles and string lights against the dusk sky."""
    k = Kit('outside')
    zg = -1.3
    for (sx, row, h, lean, seed) in [(58, 770, 3.6, 0.35, 3), (1862, 770, 3.6, -0.35, 4), (24, 700, 3.0, 0.2, 5), (1896, 700, 3.0, -0.2, 6)]:
        K.palm(k, sx, row, h=h, lean=lean, seed=seed)
    # shift the palms down onto the plaza level
    for mb in k.b.values():
        mb.v = [(x, y, z + zg) for (x, y, z) in mb.v]
    k.build()
    s = Kit('signs')
    for (sx, row, c1, c2) in [(92, 900, '#ff4fa0', '#fff1b0'), (1828, 900, '#2fe0d0', '#fff1b0')]:
        g = ground(sx, row, zg)
        v, f = lib.cylinder(g, 0.05, 0.04, 4.2, 8)
        s['chrome'].add(v, f, col('#c9ccd6'))
        c = (g[0], g[1] - 0.05, zg + 4.6)
        K.flat_shape(s['neon'], K.star_pts(8, 0.62, 0.3), c, c1, 0.05)
        K.flat_shape(s['bulb'], K.star_pts(8, 0.3, 0.14), (c[0], c[1] - 0.04, c[2]), c2, 0.04)
        for i in range(8):
            a = math.pi / 2 + i * math.tau / 8
            K.bulb(s['bulb'], (c[0] + math.cos(a) * 0.6, c[1] - 0.08, c[2] + math.sin(a) * 0.6), 0.05, '#fff6d0')
    s.build()


def main():
    cam = K.start(A, ELEV, sun_elev=36, sun_az=-14, key=2.4, fill=0.5, key_col='#ffd6ae',
                  zenith='#6b5bb0', horizon='#ffa0b8', ground='#3b2b50')
    rim = lib.sun(energy=1.3, elevation=30, azimuth=165, angle=6, color='#ff86c0')
    floor()
    backdrop()
    rings()
    drapes()
    band_gear()
    surroundings()
    path = os.path.join(K.OUT, 'stage.png' if not A.preview else 'stage_preview.png')
    if K.render(A, path):
        K.publish(A, path, 'showtime_stage')


main()
