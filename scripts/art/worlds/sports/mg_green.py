"""Fairway Frenzy (Capitol Gardens): the rolling putting green and its sprites.

    <bpy python> scripts/art/worlds/sports/mg_green.py green|sprites|all [--preview] [--dry]

Laid out exactly as src/game/worlds/capitol/games/fairwayRules.ts: camera 55 degrees above the ground,
the green's soft-lobed outline, its fringe, the two bunkers, the playable lawn (a low box hedge rings
it: the ball bounces off there) and the slopes, whose height field is baked into the green as gentle
light and shade (the mesh stays flat, so every position matches the game). The cup and flag move from
hole to hole, so they are drawn in the game; the flagstick (with its shadow) and the ball are sprites.
Around the lawn: a white garden pavilion, a lily pond with a fountain, flower gardens and trees.
Outputs public/assets/rendered/scene_capitol_green(_blur).webp and mg/capitol_{golfball,flag}.webp.
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import mg_common as C  # noqa: E402
from mg_common import board_to_world, col, lib, dress, props  # noqa: E402

import bpy  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('what', choices=['green', 'sprites', 'all'])
p.add_argument('--preview', action='store_true')
p.add_argument('--dry', action='store_true')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

ELEV = 55
COSB = math.cos(math.radians(90 - ELEV))
GREEN = dict(cx=960, cy=616, rx=500, ry=255)
FRINGE_K = 1.075
BOUNDS = dict(cx=960, cy=616, rx=830, ry=410)
BUNKERS = [(505, 862, 104, 50), (1425, 364, 110, 50)]
BUMPS = [(700, 520, 16, 190, 150), (1215, 700, -14, 220, 160), (990, 440, 9, 300, 110), (820, 790, -8, 160, 120)]
TILT = 0.018
SUN = dict(sun_elev=50, sun_az=-35, key=3.6, fill=0.8)
REGION = (40, 150, 1880, 1070)
GALLERY = [(78, 560), (104, 720), (300, 960), (1842, 560), (1816, 720), (1620, 960)]


def outline_k(a):
    return 1 + 0.05 * math.sin(3 * a + 0.6) + 0.035 * math.sin(5 * a + 2.1)


def height(x, sy):
    """The green's height field (world px) at screen x, screen y (fairwayRules.heightAt)."""
    y = sy / COSB
    h = -TILT * (y - GREEN['cy'] / COSB)
    for (bx, bsy, amp, sx, sw) in BUMPS:
        dx = (x - bx) / sx
        dy = (y - bsy / COSB) / (sw / COSB)
        h += amp * np.exp(-0.5 * (dx * dx + dy * dy))
    return h


def lawn_texture(path):
    """Striped lawn, the green (finer stripes, hill-shaded by its slopes), fringe and raked bunkers."""
    x0, y0, x1, y1 = REGION
    w, h = x1 - x0, y1 - y0
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    X = xx + x0
    Y = yy + y0
    # fairway-cut lawn: broad diagonal mowing stripes
    stripe = (np.floor((X * 0.8 + Y / COSB * 0.6) / 70) % 2).astype(np.float32)
    n1 = C.noise_img(w, h, 36, 60)
    n2 = C.noise_img(w, h, 5, 40)
    lawn = np.array([82, 160, 62], np.float32)[None, None, :] * (0.9 + 0.12 * stripe[..., None]) * (0.94 + 0.1 * n1[..., None]) * (0.97 + 0.05 * n2[..., None])
    # the green's outline test (normalised ellipse radius vs the lobed outline)
    dx = (X - GREEN['cx']) / GREEN['rx']
    dy = (Y - GREEN['cy']) / GREEN['ry']
    r = np.sqrt(dx * dx + dy * dy)
    a = np.arctan2(dy, dx)
    k = 1 + 0.05 * np.sin(3 * a + 0.6) + 0.035 * np.sin(5 * a + 2.1)
    fine = (np.floor((X + Y / COSB) / 34) % 2 + np.floor((X - Y / COSB) / 34) % 2) % 2
    green = np.array([118, 204, 86], np.float32)[None, None, :] * (0.94 + 0.07 * fine[..., None]) * (0.97 + 0.05 * n2[..., None])
    # hill shading from the height field (light from the upper left), gentle but readable
    H = height(X, Y)
    gx = np.gradient(H, axis=1)
    gy = np.gradient(H, axis=0) * COSB
    shade = np.clip(1.0 + (gx * 0.9 + gy * 1.1) * -4.0, 0.85, 1.15)
    green *= shade[..., None]
    fringe = np.array([92, 170, 66], np.float32)[None, None, :] * (0.95 + 0.06 * n1[..., None])
    t_green = np.clip((k - r) * 60.0, 0, 1)[..., None]
    t_fringe = np.clip((k * FRINGE_K - r) * 60.0, 0, 1)[..., None]
    img = lawn * (1 - t_fringe) + fringe * t_fringe
    img = img * (1 - t_green) + green * t_green
    # a soft darker band just outside the fringe (longer grass)
    band = np.clip(1 - np.abs(r - k * FRINGE_K - 0.03) * 25, 0, 1)[..., None]
    img *= 1 - 0.08 * band
    # bunkers: sand with a soft lip shadow on the far side
    for (bx, by, rx, ry) in BUNKERS:
        d = np.sqrt(((X - bx) / rx) ** 2 + ((Y - by) / ry) ** 2)
        t = np.clip((1 - d) * 30, 0, 1)[..., None]
        sand = np.array([232, 208, 150], np.float32)[None, None, :] * (0.94 + 0.08 * n2[..., None])
        lip = np.clip(1 - np.abs(d - 1.0) * 10, 0, 1)[..., None] * (Y < by)[..., None]
        img = img * (1 - t) + sand * t
        img *= 1 - 0.25 * lip
    # the playable lawn's edge, where the box hedge stands, darker still
    db = np.sqrt(((X - BOUNDS['cx']) / BOUNDS['rx']) ** 2 + ((Y - BOUNDS['cy']) / BOUNDS['ry']) ** 2)
    img *= (1 - 0.18 * np.clip((db - 0.97) * 20, 0, 1))[..., None]
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    rnd = random.Random(8)
    # rake lines in the sand
    for (bx, by, rx, ry) in BUNKERS:
        for kk in range(9):
            t = -0.8 + kk * 0.2
            pts = []
            for s in np.linspace(-1, 1, 24):
                px_ = bx + s * rx * math.sqrt(max(0.0, 1 - t * t)) * 0.9
                py_ = by + t * ry + math.sin(s * 5 + kk) * 2
                pts.append((px_ - x0, py_ - y0))
            d.line(pts, fill=(214, 188, 130), width=2)
    # a few scattered daisies on the lawn (not on the green)
    for _ in range(420):
        px_, py_ = rnd.uniform(0, w), rnd.uniform(0, h)
        X0, Y0 = px_ + x0, py_ + y0
        rr = math.hypot((X0 - GREEN['cx']) / GREEN['rx'], (Y0 - GREEN['cy']) / GREEN['ry'])
        if rr < 1.25:
            continue
        d.ellipse([px_ - 2, py_ - 1.5, px_ + 2, py_ + 1.5], fill=rnd.choice([(255, 255, 250), (255, 236, 150), (255, 210, 230)]))
    im.save(path)


def lawn_mesh(mat):
    """The playable lawn: a flat ellipse a hair above the island, carrying the painted texture."""
    n = 96
    rx, ry = BOUNDS['rx'] + 34, BOUNDS['ry'] + 22
    ring = [(BOUNDS['cx'] + math.cos(t) * rx, BOUNDS['cy'] + math.sin(t) * ry) for t in np.linspace(0, math.tau, n, endpoint=False)]
    verts = [tuple(board_to_world(x, y, 0.012)) for (x, y) in ring]
    centre = tuple(board_to_world(BOUNDS['cx'], BOUNDS['cy'], 0.012))
    verts.append(centre)
    faces = [(n, (i + 1) % n, i) for i in range(n)]
    lib.mesh_object('lawn', verts, faces, smooth=False, material=mat)


def box_hedge():
    """A low clipped box hedge round the playable lawn, just outside its edge."""
    L = lib.MeshBuilder()
    rnd = random.Random(3)
    rx, ry = BOUNDS['rx'] + 24, BOUNDS['ry'] + 16
    n = 150
    for i in range(n):
        t = i / n * math.tau
        x = BOUNDS['cx'] + math.cos(t) * rx
        y = BOUNDS['cy'] + math.sin(t) * ry
        c = board_to_world(x, y, 0)
        v, f = lib.blob((c.x, c.y, 0.12), 0.2, squash=(1.0, 1.0, 0.75), rough=0.2, subdiv=2, seed=rnd.random() * 9)
        L.add(v, f, col(rnd.choice(['#2f7a36', '#357f3a', '#2c7433'])))
    L.build('box_hedge', lib.attr_mat('box_leaf', rough=0.8, ao=0.55))


def pavilion(bx, by, s=1.0):
    """A white garden pavilion: a round plinth, eight columns and a shallow domed roof."""
    St = lib.MeshBuilder()
    Rf = lib.MeshBuilder()
    Mt = lib.MeshBuilder()
    c = board_to_world(bx, by, 0)
    x, y = c.x, c.y
    v, f = lib.lathe([(1.0 * s, 0.0), (1.0 * s, 0.16 * s), (0.9 * s, 0.2 * s), (0.0, 0.2 * s)], 32, (x, y, 0))
    St.add(v, f, col('#eee6d6'))
    for k in range(8):
        a = k / 8 * math.tau + math.pi / 8
        cx, cy = x + math.cos(a) * 0.75 * s, y + math.sin(a) * 0.75 * s
        v, f = lib.lathe([(0.08 * s, 0.2 * s), (0.065 * s, 0.25 * s), (0.06 * s, 1.35 * s), (0.09 * s, 1.42 * s), (0.0, 1.42 * s)], 12, (cx, cy, 0))
        St.add(v, f, col('#fdfbf6'))
    v, f = lib.lathe([(0.95 * s, 1.42 * s), (0.98 * s, 1.56 * s), (0.9 * s, 1.6 * s), (0.0, 1.6 * s)], 32, (x, y, 0))
    St.add(v, f, col('#fbf8f1'))
    prof = [(0.92 * s, 1.6 * s)] + [(0.92 * s * math.cos(t), 1.6 * s + 0.55 * s * math.sin(t)) for t in np.linspace(0.15, math.pi / 2, 8)]
    v, f = lib.lathe(prof, 32, (x, y, 0))
    Rf.add(v, f, col('#3f8f7a'))
    v, f = lib.blob((x, y, 2.2 * s), 0.08 * s, rough=0.0, subdiv=2)
    Mt.add(v, f, col('#f2c14e'))
    St.build('pavilion_stone', props.mats()['stone'])
    Rf.build('pavilion_roof', lib.attr_mat('pavilion_roof', rough=0.5, ao=0.4))
    Mt.build('pavilion_gold', props.mats()['metal'])


def pond(bx, by, rx=150, ry=70):
    """A lily pond with a stone rim and a little fountain."""
    St = lib.MeshBuilder()
    W = lib.MeshBuilder()
    Lf = lib.MeshBuilder()
    n = 48
    rnd = random.Random(5)
    for i in range(n):
        t0, t1 = i / n * math.tau, (i + 1) / n * math.tau
        pts = [board_to_world(bx + math.cos(t) * rx, by + math.sin(t) * ry, 0.07) for t in (t0, t1)]
        v, f = lib.tube([tuple(pts[0]), tuple(pts[1])], 0.08, 6)
        St.add(v, f, col(rnd.choice(['#e3dac8', '#d8cfbd', '#ece4d3'])))
    ring = [tuple(board_to_world(bx + math.cos(t) * (rx - 6), by + math.sin(t) * (ry - 4), 0.04)) for t in np.linspace(0, math.tau, n, endpoint=False)]
    ring.append(tuple(board_to_world(bx, by, 0.04)))
    W.add(ring, [(n, (i + 1) % n, i) for i in range(n)], col('#5fb8e0'))
    for _ in range(9):
        t = rnd.uniform(0, math.tau)
        rr = rnd.uniform(0.2, 0.8)
        c = board_to_world(bx + math.cos(t) * rx * rr, by + math.sin(t) * ry * rr, 0.05)
        v, f = lib.cylinder((c.x, c.y, 0.045), 0.1, 0.1, 0.01, 10)
        Lf.add(v, f, col('#4f9e3f'))
        if rnd.random() < 0.5:
            v, f = lib.blob((c.x + 0.03, c.y, 0.08), 0.035, rough=0.1, subdiv=1)
            Lf.add(v, f, col('#ffb6d0'))
    c = board_to_world(bx, by, 0)
    v, f = lib.lathe([(0.1, 0.0), (0.07, 0.35), (0.2, 0.42), (0.0, 0.42)], 16, (c.x, c.y, 0))
    St.add(v, f, col('#efe8da'))
    v, f = lib.lathe([(0.04, 0.42), (0.05, 0.75), (0.0, 0.9)], 10, (c.x, c.y, 0))
    W.add(v, f, col('#e8f8ff'))
    St.build('pond_stone', props.mats()['stone'])
    m = lib.NT('pond_water')
    cc = m.attr('col')
    m.bsdf(cc, 0.06, emission=cc, emission_strength=0.3, coat=0.9)
    W.build('pond_water', m.mat)
    Lf.build('pond_lilies', lib.attr_mat('pond_lily', rough=0.6))


def green_scene():
    cam = C.start(ELEV, 22, A.preview, **SUN)
    tex = os.path.join(C.OUT, 'green_lawn.png')
    lawn_texture(tex)
    lawn_mesh(C.ground_image_material('lawn', tex, REGION, rough=0.8, bump=0.12))
    outline = C.blob_outline(960, 612, 1000, 560, seed=13, lobes=7, wobble=0.045)
    C.island(outline, grass=[(0.24, '#2c7a2c'), (0.38, '#3a9233'), (0.52, '#4fa83a'), (0.66, '#6cbd3c'), (0.8, '#8fcc4a')])
    box_hedge()
    pavilion(165, 300, 0.95)
    pond(1745, 300)
    rnd = random.Random(33)
    B = {k: lib.MeshBuilder() for k in ('wood', 'leaves', 'flowers')}
    import festival as fv  # noqa: E402
    fv.flower_beds(B, 960, 168, 5, 1, rnd, bw=0.5, bd=0.2)
    fv.flower_beds(B, 520, 1052, 3, 1, rnd, bw=0.5, bd=0.2)
    fv.flower_beds(B, 1400, 1052, 3, 1, rnd, bw=0.5, bd=0.2)
    B['wood'].build('beds_wood', props.mats()['wood'])
    B['leaves'].build('beds_leaves', lib.attr_mat('beds_leaf', rough=0.78, ao=0.5))
    B['flowers'].build('beds_flowers', lib.attr_mat('beds_flower', rough=0.55, subsurface=0.2))
    C.greenery([(60, 150, 1.2), (1860, 150, 1.15), (50, 1000, 1.05), (1870, 1000, 1.05), (420, 175, 0.85), (1500, 170, 0.85)],
               [(40, 420, 0.9), (1880, 420, 0.9), (160, 880, 0.9), (1760, 880, 0.9), (720, 1062, 0.8), (1200, 1062, 0.8)],
               blossom=[(300, 180, 0.8), (1620, 175, 0.8), (40, 840, 0.85), (1880, 840, 0.85)])
    for (x, y) in [(300, 225), (1620, 225), (190, 900), (1730, 900)]:
        props.lantern(x, y, 1.0)
    keep = dress.Keep().ell(BOUNDS['cx'], BOUNDS['cy'], BOUNDS['rx'] + 60, BOUNDS['ry'] + 44)
    for (x, y) in GALLERY:
        keep.ell(x, y, 60, 30)
    keep.ell(165, 300, 130, 80).ell(1745, 300, 190, 95)
    C.scatter(outline, keep, random.Random(77), tufts=2000 if not A.preview else 800, flowers=46, pebbles=20)
    C.haze(cam, 206, 40, amount=0.14, skip=('lawn',))
    if A.dry:
        print('green scene built (dry run)')
        return
    path = os.path.join(C.OUT, 'green.png')
    lib.render_to(path)
    C.publish(path, 'capitol_green', A.preview, blur=True)


def sprites():
    # The flagstick (white pole, gold ferrule) and its long shadow; the flag cloth waves in the game.
    C.start(ELEV, 32, A.preview, **SUN)
    foot = (500, 600)
    c = board_to_world(*foot, 0)
    Mt = lib.MeshBuilder()
    H = 160 / (100 * math.sin(math.radians(90 - ELEV)))  # 160 px tall on screen
    for k in range(6):
        z0 = k * H / 6
        v, f = lib.cylinder((c.x, c.y, z0), 0.022, 0.022, H / 6, 10)
        Mt.add(v, f, col('#f7f7f2' if k % 2 == 0 else '#e8423c'))
    v, f = lib.blob((c.x, c.y, H + 0.02), 0.04, rough=0.0, subdiv=2)
    Mt.add(v, f, col('#f2c14e'))
    Mt.build('flag_pole', lib.attr_mat('flag_pole', rough=0.35))
    C.shadow_catcher((foot[0] - 60, foot[1] - 220, foot[0] + 220, foot[1] + 40))
    C.sprite_camera(foot[0] - 22, foot[1] - 172, 180, 180, scale=1.0)
    if not A.dry:
        path = os.path.join(C.OUT, 'flag.png')
        lib.render_to(path)
        C.publish_sprite(path, 'capitol_flag', A.preview)
    # The golf ball: white, dimpled.
    C.start(ELEV, 40, A.preview, **SUN)
    m = lib.NT('golfball')
    pos = m.position()
    vor = m.voronoi(26.0, pos)
    dimple = m.maprange(vor.outputs['Distance'], 0.0, 0.5)
    m.bsdf(col('#f6f7fa'), 0.35, normal=m.bump(dimple, 0.35, 0.01), coat=0.5)
    ob = lib.mesh_object('golfball', *lib.icosphere(4), smooth=True, material=m.mat)
    ob.location = board_to_world(960, 540, 0.15)
    ob.scale = (0.14, 0.14, 0.14)
    C.sprite_camera(960 - 16, 540 - 0.15 * 100 * math.sin(math.radians(90 - ELEV)) - 16, 32, 32, scale=1.0)
    if not A.dry:
        path = os.path.join(C.OUT, 'golfball.png')
        lib.render_to(path)
        C.publish_sprite(path, 'capitol_golfball', A.preview)


if A.what in ('green', 'all'):
    green_scene()
if A.what in ('sprites', 'all'):
    sprites()
