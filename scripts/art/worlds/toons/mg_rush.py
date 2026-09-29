"""Ring Rush (Cartoon Coast, Sonic's minigame): the scrolling checkered hills and the gameplay sprites.

    bpyenv/bin/python scripts/art/worlds/toons/mg_rush.py far|track|sprites|compose [--preview]

Camera elevation 40 degrees, the ground plane 1:1 with screen pixels (as scripts/art/mg_arenas.py).
The two scenery layers tile horizontally with a period of 1920 px (every object near an edge is
built twice, one period apart, and the render's overlap is cross-faded back over its left edge), so
the game scrolls them endlessly at different speeds:
  far    floating green-hill islands with checkered cliffs, loops, palms and waterfalls
         -> scene_toons_rush_far.webp (1920 x 540, drawn at y 0, sky left transparent)
  track  the four-lane checkered lawn (lane centres y 540/665/790/915, x repeats every 1920) with
         a checkered soil cliff in front and a border of bushes and sunflowers along the back
         -> scene_toons_rush_track.webp (1920 x 860, drawn at y 220)
  compose  both layers together for the intro card / menu thumbnail -> scene_toons_rush.webp
  sprites  rings, the two robot critters (original wind-up designs), spring and debris
         -> mg/toons_rush.webp + .json
Must match src/game/worlds/toons/games/ringRushLogic.ts (LANE_Y, TRACK_TOP/BOTTOM).
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mg_common as C  # noqa: E402
from mg_common import SW, col, gy, wp, wz  # noqa: E402

import lib  # noqa: E402
import mg_dress as dress  # noqa: E402
import props  # noqa: E402
import terrain  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('what', choices=['far', 'track', 'sprites', 'compose'])
p.add_argument('--preview', action='store_true')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

ELEV = 40.0
PERIOD = 1920
OV = 256
LANE_Y = [540, 665, 790, 915]
LANE_H = 125
TRACK_TOP = 472.0
TRACK_BOTTOM = 982.0
TRACK_IMG_Y = 220
FAR_H = 540


def periodic(xs, margin=420):
    """Each x plus its copies one period away when it sits near either end of the render."""
    out = []
    for x in xs:
        out.append(x)
        if x < OV + margin:
            out.append(x + PERIOD)
        if x > PERIOD - margin:
            out.append(x - PERIOD)
    return out


def image_ground_material(name, img_path, region, rough=0.7, bump=0.15):
    """An image projected onto the ground plane over screen region (x0, y0, x1, y1)."""
    x0, y0, x1, y1 = region
    m = lib.NT(name)
    pos = m.position()
    mp = m.node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (lib.PX / (x1 - x0), lib.COSB * lib.PX / (y1 - y0), 1.0)
    mp.inputs['Location'].default_value = (-x0 / (x1 - x0), 1.0 + y0 / (y1 - y0), 0.0)
    m.link(pos, mp.inputs['Vector'])
    img = m.node('ShaderNodeTexImage')
    img.image = bpy.data.images.load(img_path)
    img.extension = 'EXTEND'
    img.interpolation = 'Cubic'
    m.link(mp.outputs['Vector'], img.inputs['Vector'])
    c = img.outputs['Color']
    lum = m.node('ShaderNodeRGBToBW')
    m.link(c, lum.inputs['Color'])
    c = m.mult(c, m.mix(m.ao(0.5, 8), col('#5f6e58'), col('#ffffff')))
    m.bsdf(c, rough, normal=m.bump(lum.outputs['Val'], bump, 0.02), sheen=0.2)
    return m.mat


def image_wall_material(name, img_path, x0, x1, z0, z1, rough=0.75):
    """An image on a vertical face in the XZ plane: u from screen x, v from world height."""
    m = lib.NT(name)
    X, Y, Z = m.sep(m.position())
    comb = m.node('ShaderNodeCombineXYZ')
    m.link(m.math('DIVIDE', m.math('SUBTRACT', m.math('MULTIPLY', X, lib.PX), x0), x1 - x0), comb.inputs['X'])
    m.link(m.math('DIVIDE', m.math('SUBTRACT', Z, z0), z1 - z0), comb.inputs['Y'])
    img = m.node('ShaderNodeTexImage')
    img.image = bpy.data.images.load(img_path)
    img.extension = 'EXTEND'
    img.interpolation = 'Cubic'
    m.link(comb.outputs['Vector'], img.inputs['Vector'])
    c = img.outputs['Color']
    lum = m.node('ShaderNodeRGBToBW')
    m.link(c, lum.inputs['Color'])
    c = m.mult(c, m.mix(m.ao(0.4, 8), col('#5a4640'), col('#ffffff')))
    m.bsdf(c, rough, normal=m.bump(lum.outputs['Val'], 0.35, 0.02))
    return m.mat


def periodic_noise(w, h, cell, seed, amp=60):
    """Value noise that tiles horizontally with period w."""
    r = np.random.default_rng(seed)
    gw, gh = max(1, w // cell), max(2, h // cell + 2)
    g = r.random((gh, gw)).astype(np.float32)
    g = np.concatenate([g, g[:, :1]], axis=1)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((w + cell, (gh - 1) * cell), Image.BICUBIC)
    a = np.asarray(im, np.float32)[:h, :w] / 255.0
    return a


def lawn_texture(path, region):
    """The four lanes: a checkered lawn in two bright greens (64 px squares, two rows a lane), thin
    chalk lines between the lanes, soft mowing noise; tiles every 1920 px."""
    x0, y0, x1, y1 = region
    w, h = int(x1 - x0), int(y1 - y0)
    xs = (np.arange(w, dtype=np.float32) + x0) % PERIOD
    ys = np.arange(h, dtype=np.float32) + y0
    X, Y = np.meshgrid(xs, ys)
    cx = np.floor(X / 64.0)
    cy = np.floor((Y - (LANE_Y[0] - LANE_H / 2)) / (LANE_H / 2))
    chk = ((cx + cy) % 2 == 0)[..., None]
    light = np.array([118, 214, 84], np.float32)
    dark = np.array([88, 186, 64], np.float32)
    base = np.where(chk, light, dark)
    lane = np.clip(np.floor((Y - (LANE_Y[0] - LANE_H / 2)) / LANE_H), 0, 3)
    tint = np.where((lane % 2 == 0)[..., None], np.array([1.0, 1.0, 0.97]), np.array([0.97, 1.0, 1.02]))
    base = base * tint
    n1 = periodic_noise(PERIOD, h, 24, 3)
    n2 = periodic_noise(PERIOD, h, 6, 5)
    idx = X.astype(np.int32) % PERIOD
    rows = np.arange(h)[:, None].repeat(w, axis=1)
    nn = (0.9 + 0.14 * n1[rows, idx] + 0.06 * n2[rows, idx])[..., None]
    base = base * nn
    # mowing streaks along the lanes
    streak = 0.97 + 0.05 * np.sin((Y - y0) * 0.9 + np.sin(X * 0.01) * 2.0)[..., None]
    base = base * streak
    # edges of the track: a darker rim of grass
    edge = np.clip(1.0 - np.minimum(Y - TRACK_TOP, TRACK_BOTTOM - Y) / 10.0, 0, 1)[..., None]
    base = base * (1 - 0.25 * edge)
    # chalk lines between lanes
    for k in range(1, 4):
        ly = LANE_Y[0] - LANE_H / 2 + k * LANE_H
        d = np.abs(Y - ly)
        a = np.clip(1.0 - (d - 2.2) / 1.6, 0, 1)[..., None]
        base = base * (1 - 0.85 * a) + np.array([246, 250, 236], np.float32) * 0.85 * a
    im = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    im.save(path)


def soil_texture(path, x0, x1, rows=2, row_px=64):
    """Checkered soil for the cliff faces: warm orange and chocolate blocks with soft bevels."""
    w = int(x1 - x0)
    h = rows * row_px
    xs = (np.arange(w, dtype=np.float32) + x0) % PERIOD
    ys = np.arange(h, dtype=np.float32)
    X, Y = np.meshgrid(xs, ys)
    cx = np.floor(X / 64.0)
    cy = np.floor(Y / row_px)
    chk = ((cx + cy) % 2 == 0)[..., None]
    a = np.array([226, 142, 64], np.float32)
    b = np.array([168, 90, 44], np.float32)
    base = np.where(chk, a, b)
    fx = (X % 64.0) / 64.0
    fy = (Y % row_px) / row_px
    bevel = np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy))
    shade = (0.82 + 0.18 * np.clip(bevel * 12, 0, 1))[..., None]
    hi = np.clip(1 - fy * 10, 0, 1)[..., None] * 0.12
    base = base * shade + 255 * hi
    n = periodic_noise(PERIOD, h, 8, 11)
    idx = X.astype(np.int32) % PERIOD
    rws = np.arange(h)[:, None].repeat(w, axis=1)
    base = base * (0.92 + 0.12 * n[rws, idx])[..., None]
    Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).save(path)


def checker_side_material(name, sq=0.32, row=0.42, a='#e08e40', b='#a8592c'):
    """World-space checker for curved cliff sides (x squares tile the 1920 px period)."""
    m = lib.NT(name)
    X, Y, Z = m.sep(m.position())
    fx = m.math('FLOOR', m.math('DIVIDE', m.math('ADD', X, m.math('MULTIPLY', Y, 0.0)), sq))
    fz = m.math('FLOOR', m.math('DIVIDE', Z, row))
    s = m.math('FLOORED_MODULO', m.math('ADD', fx, fz), 2.0)
    c = m.mix(s, col(a), col(b))
    c = m.mult(c, m.mix(m.ao(0.5, 8), col('#5c4038'), col('#ffffff')))
    m.bsdf(c, 0.78)
    return m.mat


def grass_material(name, low='#3d9f33', high='#86d54c'):
    m = lib.NT(name)
    nz = m.sep(m.normal())[2]
    n = m.noise(2.4, 3, 0.55, m.position())
    fac = m.math('ADD', m.math('MULTIPLY', nz, 0.6), m.math('MULTIPLY', n.outputs['Fac'], 0.4))
    c = m.ramp(fac, [(0.35, low), (0.75, high)])
    c = m.mult(c, m.mix(m.ao(0.6, 8), col('#4f6a48'), col('#ffffff')))
    m.bsdf(c, 0.8, sheen=0.3)
    return m.mat


# ------------------------------------------------------------------------------------------
# Props
def palm(leaf, wood, nut, x, y, s=1.0, lean=0.35, seed=0, z0=0.0):
    rnd = random.Random(seed)
    base = wp(x, y)
    h = 2.3 * s
    pts = []
    for k in range(13):
        t = k / 12
        pts.append((base.x + lean * s * t * t * 1.6, base.y, z0 + h * t))
    for k in range(12):
        a, b = Vector(pts[k]), Vector(pts[k + 1])
        v, f = lib.tube([tuple(a), tuple(b)], 0.085 * s * (1 - 0.3 * k / 12), 8)
        wood.add(v, f, col('#a8743f' if k % 2 else '#8a5a30'))
    top = Vector(pts[-1])
    for k in range(8):
        a = k / 8 * math.tau + rnd.uniform(-0.2, 0.2)
        L = rnd.uniform(1.0, 1.25) * s
        dx, dy = math.cos(a), math.sin(a) * 0.55
        n = 9
        spine = []
        for j in range(n):
            t = j / (n - 1)
            spine.append((top.x + dx * L * t, top.y + dy * L * t, top.z + 0.18 * s * math.sin(t * math.pi * 0.9) - 0.75 * s * t * t))
        # a leaf blade: quads either side of the spine, tapering to the tip
        side = Vector((-dy, dx, 0.0)).normalized()
        verts, faces = [], []
        for j, q in enumerate(spine):
            t = j / (n - 1)
            wdt = 0.24 * s * math.sin(max(0.08, t) * math.pi) * (1 - 0.3 * t)
            qv = Vector(q)
            verts += [tuple(qv + side * wdt + Vector((0, 0, -0.04 * s))), tuple(qv), tuple(qv - side * wdt + Vector((0, 0, -0.04 * s)))]
        for j in range(n - 1):
            i = j * 3
            faces += [(i, i + 1, i + 4, i + 3), (i + 1, i + 2, i + 5, i + 4)]
        leaf.add(verts, faces, lambda vv, zt=top.z: lib.lerp_col(col('#2f8f2c'), col('#8fd14c'), max(0.0, min(1.0, (vv[2] - zt + 0.8 * s) / (1.0 * s)))))
    for k in range(3):
        a = k / 3 * math.tau
        v, f = lib.blob((top.x + math.cos(a) * 0.1 * s, top.y + math.sin(a) * 0.08 * s, top.z - 0.1 * s), 0.08 * s, rough=0.0, subdiv=2)
        nut.add(v, f, col('#6b4424'))


def sunflower(mb_head, mb_stem, x, y, s=1.0, z0=0.0, face_tilt=0.55):
    base = wp(x, y)
    h = 1.05 * s
    v, f = lib.cylinder((base.x, base.y, z0), 0.035 * s, 0.03 * s, h, 8)
    mb_stem.add(v, f, col('#3f8f2c'))
    for side in (-1, 1):
        v, f = lib.blob((base.x + side * 0.12 * s, base.y, z0 + h * 0.45 + side * 0.05 * s), 0.12 * s, squash=(1.3, 0.5, 0.35), rough=0.1, subdiv=1)
        mb_stem.add(v, f, col('#4aa83a'))
    c = Vector((base.x, base.y - 0.02, z0 + h))
    # the head faces the camera: a disc tilted towards the view
    nrm = Vector((0.0, -math.cos(face_tilt), math.sin(face_tilt)))
    u = Vector((1.0, 0.0, 0.0))
    w = nrm.cross(u).normalized()
    petals = 14
    for k in range(petals):
        a = k / petals * math.tau
        d = u * math.cos(a) + w * math.sin(a)
        e = u * math.cos(a + 0.5 / petals * math.tau) + w * math.sin(a + 0.5 / petals * math.tau)
        e2 = u * math.cos(a - 0.5 / petals * math.tau) + w * math.sin(a - 0.5 / petals * math.tau)
        tip = c + d * 0.34 * s + nrm * 0.02
        l1 = c + e * 0.16 * s
        l2 = c + e2 * 0.16 * s
        mb_head.add([tuple(l2), tuple(tip), tuple(l1), tuple(c)], [(0, 1, 2, 3), (3, 2, 1, 0)], col('#ffd21f' if k % 2 else '#ffbe12'))
    v, f = lib.blob(tuple(c + nrm * 0.05), 0.15 * s, squash=(1.0, 0.45, 1.0), rough=0.1, subdiv=2)
    mb_head.add(v, f, col('#6b3d1c'))


def merge(dst, src, dz=0.0):
    """Append MeshBuilder `src` to `dst`, lifted by dz."""
    base = len(dst.v)
    dst.v.extend((x, y, z + dz) for (x, y, z) in src.v)
    dst.f.extend(tuple(i + base for i in face) for face in src.f)
    dst.c.extend(src.c)


def hill_island(side_mat, cap_mat, x, y, rx, ry, h, seed, bottom=-2.2):
    """A floating mesa: wobbly checkered cliffs from `bottom` up to h, capped by a grassy dome."""
    rnd = random.Random(seed)
    c = wp(x, y)
    n = 64
    ph = [rnd.uniform(0, math.tau) for _ in range(3)]
    ring = []
    for k in range(n):
        a = k / n * math.tau
        wob = 1 + 0.06 * math.sin(a * 3 + ph[0]) + 0.04 * math.sin(a * 5 + ph[1])
        ring.append((math.cos(a) * rx * wob / 100, math.sin(a) * ry * wob / 100 / lib.COSB))
    verts = [(c.x + px, c.y + py, bottom) for (px, py) in ring] + [(c.x + px, c.y + py, h) for (px, py) in ring]
    faces = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    faces.append(tuple(range(n - 1, -1, -1)))
    lib.mesh_object(f'mesa_{seed}', verts, faces, smooth=True, material=side_mat)
    # grassy cap: a flattened dome with a lip that hangs over the cliff edge
    cap = []
    rows = 8
    for i in range(rows + 1):
        t = i / rows
        rr = math.cos(t * math.pi / 2)
        zz = h - 0.06 + math.sin(t * math.pi / 2) * 0.55 * min(1.0, rx / 260)
        for (px, py) in ring:
            cap.append((c.x + px * rr * 1.04, c.y + py * rr * 1.04, zz))
    cf = []
    for i in range(rows):
        for k in range(n):
            a = i * n + k
            b = i * n + (k + 1) % n
            cf.append((a, b, b + n, a + n))
    lip = [(c.x + px * 1.045, c.y + py * 1.045, h - 0.16) for (px, py) in ring]
    base = len(cap)
    cap += lip
    for k in range(n):
        cf.append((base + k, base + (k + 1) % n, (k + 1) % n, k))
    lib.mesh_object(f'cap_{seed}', cap, cf, smooth=True, material=cap_mat)
    return c


def loop_ring(track_m, side_m, x, y, z0, R=1.0, width=0.55, thick=0.12):
    """A vertical loop-the-loop standing on a hilltop (the circle in the XZ plane, facing the camera)."""
    c = wp(x, y)
    n = 72
    inner, outer = [], []
    for k in range(n):
        a = k / n * math.tau
        inner.append((math.sin(a) * R, z0 + R - math.cos(a) * R))
        outer.append((math.sin(a) * (R + thick), z0 + R - math.cos(a) * (R + thick)))
    hw = width / 2
    verts = []
    for (px, pz) in inner:
        verts += [(c.x + px, c.y - hw, pz), (c.x + px, c.y + hw, pz)]
    for (px, pz) in outer:
        verts += [(c.x + px, c.y - hw, pz), (c.x + px, c.y + hw, pz)]
    top, sides = [], []
    o = 2 * n
    for k in range(n):
        a, b = 2 * k, 2 * ((k + 1) % n)
        top.append((a, a + 1, b + 1, b))            # inner running surface
        sides.append((o + b, o + b + 1, o + a + 1, o + a))  # outer skin
        sides.append((a, b, o + b, o + a))          # front rim
        sides.append((a + 1, o + a + 1, o + b + 1, b + 1))  # back rim
    lib.mesh_object(f'loop_run_{int(x)}', verts, top, smooth=True, material=track_m)
    lib.mesh_object(f'loop_skin_{int(x)}', verts, sides, smooth=True, material=side_m)


# ------------------------------------------------------------------------------------------
def far():
    C.start(ELEV, 20, A.preview, sun_elev=46, sun_az=-38, key=3.2, fill=0.85)
    C.camera(0, 0, PERIOD + OV, FAR_H, A.preview)
    side = checker_side_material('far_checker')
    cap = grass_material('far_grass')
    loop_track = grass_material('loop_grass', '#4fb33e', '#9be05a')
    loop_side = checker_side_material('loop_checker', sq=0.2, row=0.2, a='#f0a04a', b='#b8642e')
    leaf, wood, nut = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    head, stem = lib.MeshBuilder(), lib.MeshBuilder()
    bushes = lib.MeshBuilder()
    # (x, ground y, rx, ry, height, loop?)
    hills = [(150, 395, 260, 70, 1.35, False), (560, 360, 300, 80, 2.15, True), (980, 410, 230, 60, 1.05, False),
             (1350, 370, 290, 76, 1.8, False), (1740, 395, 250, 66, 2.3, True)]
    for i, (hx, hy, rx, ry, hh, has_loop) in enumerate(hills):
        for x in periodic([hx], margin=rx + 60):
            # the same seed for every copy of a hill, so the two ends of the tile match exactly
            rnd = random.Random(1000 + i)
            hill_island(side, cap, x, hy, rx, ry, hh, seed=i * 10)
            top = hh - 0.06 + 0.55 * min(1.0, rx / 260)
            if has_loop:
                loop_ring(loop_track, loop_side, x + 30, hy - 8, top - 0.06, R=1.0 if hx < 1000 else 0.9)
            for k in range(3):
                px = x - rx * 0.6 + k * rx * 0.6 + rnd.uniform(-20, 20)
                py = hy - 6 + rnd.uniform(-10, 10)
                ps = 0.62 + rnd.uniform(-0.05, 0.08)
                lean = rnd.choice([-0.35, 0.35])
                if has_loop and (k == 1 or abs(px - x - 30) < 130):
                    continue
                palm(leaf, wood, nut, px, py, s=ps, lean=lean, seed=i * 7 + k, z0=top - 0.2)
            hb = lib.MeshBuilder()
            for k in range(4):
                bx = x + rnd.uniform(-rx * 0.8, rx * 0.8)
                terrain.bush(hb, bx, hy + rnd.uniform(0, ry * 0.4), rnd, 0.55)
            merge(bushes, hb, top - 0.25)
            for k in range(3):
                sunflower(head, stem, x + rnd.uniform(-rx * 0.7, rx * 0.7), hy + rnd.uniform(4, ry * 0.5), s=0.5, z0=top - 0.15)
    bushes.build('hill_bushes', dress.mats()['leaf'])
    leaf.build('palm_leaves', dress.mats()['leaf'])
    wood.build('palm_trunks', props.mats()['wood'])
    nut.build('palm_nuts', props.mats()['wood'])
    head.build('sunflower_heads', lib.attr_mat('sunflower', rough=0.6, sheen=0.2))
    stem.build('sunflower_stems', dress.mats()['leaf'])
    # waterfalls spilling off two islands, and clouds drifting below and between them
    for (fx, fy, top) in [(980 - 120, 410 + 62, 1.0), (150 + 160, 395 + 60, 1.3)]:
        for x in periodic([fx]):
            w = wp(x, fy)
            fm = lib.falls_material(f'falls_{int(x)}', top, -2.4)
            lib.mesh_object(f'fall_{int(x)}', [(w.x - 0.22, w.y, top), (w.x + 0.22, w.y, top), (w.x + 0.3, w.y, -2.4), (w.x - 0.3, w.y, -2.4)], [(0, 1, 2, 3)], smooth=False, material=fm)
    clouds = lib.MeshBuilder()
    for k, (cx, cy, cz, sz) in enumerate([(300, 470, -1.2, 0.9), (780, 480, -1.5, 1.1), (1180, 470, -1.0, 0.8), (1560, 485, -1.4, 1.0), (40, 300, 1.2, 0.5), (1150, 250, 2.2, 0.55)]):
        for x in periodic([cx]):
            dress.cloud_puffs(clouds, (x / 100, gy(cy), cz), sz, puffs=9, seed=k)
    clouds.build('clouds', dress.cloud_material())
    path = C.render('rush_far')
    im = Image.open(path).convert('RGBA')
    im = C.upscale_preview(im, (PERIOD + OV, FAR_H))
    im = C.seamless(im, PERIOD, OV)
    # push it back: a touch of sky haze and softer contrast
    a = np.asarray(im, np.float32)
    haze = np.array([214, 234, 250], np.float32)
    a[..., :3] = a[..., :3] * 0.8 + haze * 0.2
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')
    if A.preview:
        im.save(os.path.join(C.OUT, 'rush_far_preview.png'))
        return
    C.save_webp(im, 'scene_toons_rush_far.webp')


def track():
    C.start(ELEV, 22, A.preview, sun_elev=48, sun_az=-35, key=3.4, fill=0.8)
    C.camera(0, TRACK_IMG_Y, PERIOD + OV, 1080 - TRACK_IMG_Y, A.preview)
    x0, x1 = -300, PERIOD + OV + 300
    lawn = os.path.join(C.OUT, 'rush_lawn.png')
    lawn_texture(lawn, (x0, TRACK_TOP - 12, x1, TRACK_BOTTOM + 6))
    lawn_m = image_ground_material('lawn', lawn, (x0, TRACK_TOP - 12, x1, TRACK_BOTTOM + 6))
    # the track top
    corners = [(x0, TRACK_TOP - 12), (x1, TRACK_TOP - 12), (x1, TRACK_BOTTOM + 4), (x0, TRACK_BOTTOM + 4)]
    top = [tuple(wp(x, y, 0.0)) for (x, y) in corners]
    lib.mesh_object('lawn_top', top, [(3, 2, 1, 0)], smooth=False, material=lawn_m)
    # the checkered soil cliff in front (two rows of blocks) and its grass lip
    soil = os.path.join(C.OUT, 'rush_soil.png')
    zc = 1.5
    soil_texture(soil, x0, x1, rows=2, row_px=64)
    soil_m = image_wall_material('soil', soil, x0, x1, -zc, 0.0)
    yb = gy(TRACK_BOTTOM + 4)
    lib.mesh_object('cliff', [(x0 / 100, yb, -zc), (x1 / 100, yb, -zc), (x1 / 100, yb, 0.0), (x0 / 100, yb, 0.0)], [(0, 1, 2, 3)], smooth=False, material=soil_m)
    lip_m = grass_material('lip_grass', '#3f9d32', '#7fcf48')
    for (yy, rr) in [(TRACK_BOTTOM + 3, 0.07), (TRACK_TOP - 10, 0.06)]:
        v, f = lib.tube([(x0 / 100, gy(yy), -0.01), (x1 / 100, gy(yy), -0.01)], rr, 10)
        lib.mesh_object(f'lip_{int(yy)}', v, f, smooth=True, material=lip_m)
    # grass tufts hanging over the front lip (periodic)
    rnd = random.Random(4)
    tufts = lib.MeshBuilder()
    for i in range(240):
        x0i = random.Random(i).uniform(0, PERIOD)
        for x in periodic([x0i], margin=80):
            rr = random.Random(5000 + i)
            terrain.grass_tuft(tufts, x, TRACK_BOTTOM + rr.uniform(-2, 6), rr, rr.uniform(0.8, 1.3))
    # the back border: a grassy bank with bushes, flower beds, sunflowers and a palm now and then
    bank = []
    n = 2
    for (xa, xb) in [(x0, x1)]:
        for k, (yy, zz) in enumerate([(TRACK_TOP - 10, 0.0), (TRACK_TOP - 26, 0.12), (TRACK_TOP - 44, 0.16), (TRACK_TOP - 70, 0.1)]):
            bank += [tuple(wp(xa, yy, zz)), tuple(wp(xb, yy, zz))]
    bf = [(i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2) for i in range(3)]
    bf = [(d, c, b, a) for (a, b, c, d) in bf]
    lib.mesh_object('bank', bank, bf, smooth=True, material=grass_material('bank_grass', '#358f2c', '#79c943'))
    leaves, flowers, head, stem = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    leaf, wood, nut = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    for i in range(20):
        base = i * 96 + random.Random(100 + i).uniform(-20, 20)
        for x in periodic([base], margin=120):
            rr = random.Random(6000 + i)
            terrain.bush(leaves, x, TRACK_TOP - 40 + rr.uniform(-8, 8), rr, rr.uniform(0.55, 0.8), berries=flowers)
    for i in range(30):
        base = i * 64 + 20 + random.Random(200 + i).uniform(-10, 10)
        for x in periodic([base], margin=80):
            rr = random.Random(7000 + i)
            terrain.flower_bed(flowers, leaves, x, TRACK_TOP - 22 + rr.uniform(-4, 4), rr, count=5)
    for x in periodic([150, 530, 870, 1230, 1600], margin=120):
        sunflower(head, stem, x, TRACK_TOP - 52, s=0.95, z0=0.1)
    for (x, sd) in [(360, 1), (1440, 2)]:
        for xx in periodic([x], margin=200):
            palm(leaf, wood, nut, xx, TRACK_TOP - 64, s=0.95, lean=0.3 if sd == 1 else -0.3, seed=sd, z0=0.1)
    tufts.build('front_tufts', lib.attr_mat('front_grass', rough=0.8, sheen=0.15, ao=0.3), smooth=False)
    leaves.build('bank_leaves', dress.mats()['leaf'])
    flowers.build('bank_flowers', dress.mats()['flower'])
    head.build('track_sunflowers', lib.attr_mat('sunflower2', rough=0.6, sheen=0.2))
    stem.build('track_stems', dress.mats()['leaf'])
    leaf.build('track_palm_leaves', dress.mats()['leaf'])
    wood.build('track_palm_trunks', props.mats()['wood'])
    nut.build('track_palm_nuts', props.mats()['wood'])
    path = C.render('rush_track')
    im = Image.open(path).convert('RGBA')
    im = C.upscale_preview(im, (PERIOD + OV, 1080 - TRACK_IMG_Y))
    im = C.seamless(im, PERIOD, OV)
    if A.preview:
        im.save(os.path.join(C.OUT, 'rush_track_preview.png'))
        return
    C.save_webp(im, 'scene_toons_rush_track.webp')


def compose():
    far_im = Image.open(os.path.join(C.PUB, 'scene_toons_rush_far.webp')).convert('RGBA')
    tr = Image.open(os.path.join(C.PUB, 'scene_toons_rush_track.webp')).convert('RGBA')
    out = Image.new('RGBA', (SW, 1080), (0, 0, 0, 0))
    out.alpha_composite(far_im, (0, 0))
    out.alpha_composite(tr, (0, TRACK_IMG_Y))
    C.save_webp(out, 'scene_toons_rush.webp')


# ------------------------------------------------------------------------------------------
# Sprites (rendered together in one frame, then cut out)
def sprites():
    C.start(ELEV, 40, A.preview, sun_elev=50, sun_az=-35, key=3.4, fill=0.85)
    gold = C.mat_metal('ring_gold', 0.18)
    paint = C.mat_gloss('bot_paint', 0.3, 0.7)
    metal = C.mat_metal('bot_metal', 0.3)
    glow = C.mat_glow('bot_glow', 3.0)
    matte = C.mat_matte('bot_matte', 0.6, 0.3)
    frames = {}
    cells = {}

    def cell(name, x, y, w, h, ax, ay):
        cells[name] = (x, y, w, h, ax, ay)

    # the camera looks along (0, sin b, -cos b): a hoop faces it once tipped by -(90 - b) degrees about X
    beta = lib.BETA
    tip = (-(math.pi / 2 - beta), 0.0, 0.0)

    # ring (the hole faces the camera; the game spins it by squashing it sideways)
    for (name, cx, R, r) in [('ring', 120, 0.3, 0.075), ('ring_big', 320, 0.52, 0.12)]:
        cy = 150
        c = tuple(wp(cx, cy, 0.0))
        v, f = C.torus((0, 0, 0), R, r, 56, 16, axis='y')
        v = lib.transform(v, loc=c, rot=tip)
        mb = lib.MeshBuilder()
        mb.add(v, f, col('#ffc62b'))
        if name == 'ring_big':
            # a star gem floating in the middle
            star = []
            sf = []
            pts = 5
            for k in range(pts * 2):
                a = math.pi / 2 + k / (pts * 2) * math.tau
                rr = 0.26 if k % 2 == 0 else 0.11
                star.append((math.cos(a) * rr, 0.0, math.sin(a) * rr))
            n = len(star)
            sv = [(x, -0.05, z) for (x, _, z) in star] + [(x, 0.05, z) for (x, _, z) in star] + [(0, -0.1, 0), (0, 0.1, 0)]
            for k in range(n):
                a, b = k, (k + 1) % n
                sf += [(a, b, n + b, n + a), (2 * n, b, a), (2 * n + 1, n + a, n + b)]
            sv = lib.transform(sv, loc=c, rot=tip)
            gm = lib.MeshBuilder()
            gm.add(sv, sf, col('#ffe27a'))
            gm.build('star_gem', C.mat_glow('gem_glow', 0.9))
        mb.build(name, gold)
        cell(name, cx - 80, cy - 80, 160, 160, cx, cy)

    # wind-up turtle bot (ground critter, faces left): red-orange riveted shell, brass key, lamp eyes
    tx, ty = 560.0, 190.0
    c = wp(tx, ty)
    P = lib.MeshBuilder()
    Pm = lib.MeshBuilder()
    Pg = lib.MeshBuilder()
    Pk = lib.MeshBuilder()
    v, f = C.ellipsoid((c.x, c.y, 0.2), 0.48, 0.4, 0.36)
    v = [(x, y, max(z, 0.2)) for (x, y, z) in v]
    P.add(v, f, col('#ff6a2b'))
    # shell plates: darker hex dots
    for k in range(7):
        a = k / 7 * math.tau
        for (rr, zz) in [(0.0, 0.54)] if k == 0 else [(0.3, 0.44)]:
            q = (c.x + math.cos(a) * rr, c.y + math.sin(a) * rr * 0.8, zz)
            v2, f2 = lib.blob(q, 0.12 if k == 0 else 0.1, squash=(1, 0.85, 0.45), rough=0.0, subdiv=2)
            P.add(v2, f2, col('#ff9a3c'))
    v, f = C.torus((c.x, c.y, 0.2), 0.47, 0.05, 48, 10, axis='z')
    Pm.add(v, f, col('#e8b04a'))
    for k in range(10):
        a = k / 10 * math.tau
        v, f = lib.blob((c.x + math.cos(a) * 0.5, c.y + math.sin(a) * 0.42, 0.22), 0.03, rough=0.0, subdiv=1)
        Pm.add(v, f, col('#fff0c0'))
    # head (front = -x)
    hx = c.x - 0.55
    v, f = C.ellipsoid((hx, c.y, 0.26), 0.2, 0.19, 0.17)
    Pm.add(v, f, col('#b9c2cf'))
    for sgn in (-1, 1):
        v, f = lib.blob((hx - 0.13, c.y + sgn * 0.08, 0.33), 0.065, rough=0.0, subdiv=2)
        Pg.add(v, f, col('#ffe46b'))
        v, f = lib.blob((hx - 0.18, c.y + sgn * 0.085, 0.335), 0.028, rough=0.0, subdiv=1)
        Pk.add(v, f, col('#2a2030'))
    # stubby wheels
    for (lx, ly) in [(-0.28, -0.3), (0.28, -0.3), (-0.28, 0.3), (0.28, 0.3)]:
        v, f = lib.cylinder((0, 0, 0), 0.09, 0.09, 0.06, 14)
        v = lib.transform(v, loc=(c.x + lx, c.y + ly - 0.03, 0.09), rot=(math.pi / 2, 0.0, 0.0))
        Pk.add(v, f, col('#3a3444'))
    # wind-up key on the back
    v, f = lib.cylinder((c.x + 0.05, c.y, 0.52), 0.03, 0.03, 0.2, 8)
    Pm.add(v, f, col('#e8b04a'))
    for sgn in (-1, 1):
        v, f = lib.blob((c.x + 0.05 + sgn * 0.12, c.y, 0.78), 0.11, squash=(1.0, 0.25, 0.8), rough=0.0, subdiv=2)
        Pm.add(v, f, col('#f2c14e'))
    P.build('turtle_shell', paint)
    Pm.build('turtle_metal', metal)
    Pg.build('turtle_eyes', glow)
    Pk.build('turtle_dark', matte)
    cell('turtle', tx - 95, ty - 115, 190, 150, tx, ty)

    # heli bot (air critter, faces left): violet tin ball, visor eye, stubby arms, propeller mast
    hx0, hy0 = 820.0, 190.0
    hz = 0.9
    c = wp(hx0, hy0)
    B, Bm, Bg, Bk = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    v, f = C.ellipsoid((c.x, c.y, hz), 0.34, 0.32, 0.32)
    B.add(v, f, col('#9b4dff'))
    v, f = C.torus((c.x, c.y, hz), 0.335, 0.04, 48, 10, axis='z')
    Bm.add(v, f, col('#e8b04a'))
    # two big lamp eyes on the side facing the runners, turned a little towards the camera, under a
    # stern brass brow (no arms: a clean silhouette reads best at speed)
    for k, sgn in enumerate((-1, 1)):
        a = math.radians(200 + sgn * 22)
        ex, ey = c.x + math.cos(a) * 0.27, c.y + math.sin(a) * 0.25 - 0.08
        ez = hz + 0.08
        v, f = lib.blob((ex, ey, ez), 0.1, squash=(0.8, 0.8, 1.0), rough=0.0, subdiv=2)
        Bg.add(v, f, col('#fffbe0'))
        v, f = lib.blob((ex - 0.05, ey - 0.06, ez + 0.005), 0.045, rough=0.0, subdiv=1)
        Bk.add(v, f, col('#20183a'))
        v, f = lib.box((ex - 0.02, ey - 0.03, ez + 0.12), (0.16, 0.05, 0.035), rot_z=a + math.pi / 2)
        v = [(x, y, z + sgn * (x - ex) * 0.4) for (x, y, z) in v]
        Bm.add(v, f, col('#e8b04a'))
    v, f = lib.cylinder((c.x, c.y, hz + 0.3), 0.035, 0.03, 0.2, 8)
    Bm.add(v, f, col('#c9d0da'))
    v, f = lib.lathe([(0.12, 0.0), (0.06, -0.14), (0.0, -0.16)], 16, (c.x, c.y, hz - 0.3))
    Bm.add(v, f, col('#c9d0da'))
    v, f = lib.blob((c.x, c.y, hz - 0.47), 0.05, rough=0.0, subdiv=1)
    Bg.add(v, f, col('#ffb347'))
    B.build('heli_body', paint)
    Bm.build('heli_metal', metal)
    Bg.build('heli_glow', glow)
    Bk.build('heli_dark', matte)
    # anchor: the body's centre (the game floats it over the lane)
    hcy = hy0 - hz * lib.SINB * 100
    cell('heli', hx0 - 72, hcy - 88, 144, 150, hx0, hcy)

    # propeller (two blades seen from above at the camera's angle)
    px0, py0 = 1020.0, 160.0
    c = wp(px0, py0)
    Pp = lib.MeshBuilder()
    for sgn in (-1, 1):
        blade = [(0.0, -0.05), (0.34, -0.11), (0.4, 0.0), (0.34, 0.11), (0.0, 0.05)]
        v = [(c.x + sgn * bx, c.y + by, 0.5) for (bx, by) in blade] + [(c.x + sgn * bx, c.y + by, 0.52) for (bx, by) in blade]
        f = [tuple(range(4, -1, -1)) if sgn > 0 else tuple(range(5)), tuple(range(5, 10)) if sgn > 0 else tuple(range(9, 4, -1))]
        Pp.add(v, f, col('#ff5f5f'))
    v, f = lib.blob((c.x, c.y, 0.52), 0.05, rough=0.0, subdiv=1)
    Pp.add(v, f, col('#e8b04a'))
    Pp.build('prop', paint)
    pcy = py0 - 0.51 * lib.SINB * 100
    cell('prop', px0 - 52, pcy - 30, 104, 60, px0, pcy)

    # spring pad
    sx, sy = 1200.0, 190.0
    c = wp(sx, sy)
    S, Sm = lib.MeshBuilder(), lib.MeshBuilder()
    v, f = lib.lathe([(0.46, 0.0), (0.46, 0.08), (0.4, 0.1), (0.0, 0.1)], 32, (c.x, c.y, 0.0))
    Sm.add(v, f, col('#6b6f7a'))
    coil = []
    for k in range(120):
        t = k / 119
        a = t * 5 * math.tau
        coil.append((c.x + math.cos(a) * 0.28, c.y + math.sin(a) * 0.28, 0.1 + t * 0.32))
    v, f = lib.tube(coil, 0.035, 6)
    Sm.add(v, f, col('#d8dce4'))
    v, f = lib.lathe([(0.44, 0.42), (0.44, 0.5), (0.38, 0.54), (0.0, 0.55)], 32, (c.x, c.y, 0.0))
    S.add(v, f, col('#ff4a4a'))
    v, f = lib.lathe([(0.28, 0.551), (0.18, 0.551)], 32, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    S.add(v, f, col('#ffe066'))
    S.build('spring_paint', paint)
    Sm.build('spring_metal', metal)
    cell('spring', sx - 70, sy - 80, 140, 110, sx, sy)

    # debris: a gear and a bolt (tinted in game)
    for (name, dx) in [('gear', 1380.0), ('bolt', 1480.0)]:
        c = wp(dx, 150)
        D = lib.MeshBuilder()
        if name == 'gear':
            ring = []
            for k in range(24):
                a = k / 24 * math.tau
                rr = 0.16 if (k // 2) % 2 == 0 else 0.12
                ring.append((math.cos(a) * rr, math.sin(a) * rr))
            n = len(ring)
            v = [(c.x + x, c.y - 0.03, z + 0.3) for (x, z) in ring] + [(c.x + x, c.y + 0.03, z + 0.3) for (x, z) in ring]
            f = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)] + [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
            D.add(v, f, col('#dfe4ea'))
        else:
            v, f = lib.cylinder((c.x, c.y, 0.2), 0.05, 0.05, 0.2, 8)
            D.add(v, f, col('#dfe4ea'))
            v, f = lib.cylinder((c.x, c.y, 0.4), 0.09, 0.09, 0.05, 6)
            D.add(v, f, col('#dfe4ea'))
        D.build(name, metal)
        cell(name, dx - 30, 150 - 60, 60, 60, dx, 150 - 30)

    W, H = 1560, 320
    C.camera(0, 0, W, H, A.preview, scale=1.0)
    path = C.render('rush_sprites')
    im = Image.open(path).convert('RGBA')
    im = C.upscale_preview(im, (W, H))
    for name, (x, y, w, h, ax, ay) in cells.items():
        img, (ox, oy) = C.crop_alpha(im, (int(x), int(y), int(x + w), int(y + h)))
        frames[name] = (img, (ax - ox, ay - oy))
    if A.preview:
        im.save(os.path.join(C.OUT, 'rush_sprites_preview.png'))
        return
    C.pack_atlas('toons_rush', frames, width=768)
    C.save_icon(frames['ring'][0], 'ring')
    C.save_icon(frames['turtle'][0], 'turtle')
    heli, (hax, hay) = frames['heli']
    prop, (pax, pay) = frames['prop']
    both = Image.new('RGBA', (max(heli.width, prop.width) + 20, heli.height + 60), (0, 0, 0, 0))
    both.alpha_composite(heli, (both.width // 2 - int(hax), 50))
    both.alpha_composite(prop, (both.width // 2 - int(pax), 50 + int(hay) - 39 - int(pay)))
    C.save_icon(both.crop(both.getbbox()), 'heli')


{'far': far, 'track': track, 'sprites': sprites, 'compose': compose}[A.what]()
