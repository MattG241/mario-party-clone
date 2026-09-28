"""Gleam Grab arena rendered with a perspective camera (the plaza recedes like a real 3/4 view).

    .artenv/bin/python scripts/art/gleam3d.py [--preview]

The gameplay rectangle (logical ARENA 250..1670 x 290..930, see GleamGrab.ts) is laid out on the
plaza in world units; after rendering, the screen positions of its four corners are written to
public/assets/rendered/scene_gleam3d.json so the game can map logical coordinates onto the floor
with a homography (and scale sprites by depth). Outputs scene_gleam3d.webp (arena) and
scene_gleam3d_wall.webp (the back wall alone, drawn over the crowd in-game).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
import props  # noqa: E402
import terrain  # noqa: E402
from lib import col  # noqa: E402

import bpy  # noqa: E402
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
from mathutils import Vector  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--preview', action='store_true')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

SW, SH = 1920, 1080
OUT = os.path.join(lib.ROOT, 'art-out', 'gleam3d')
PUB = os.path.join(lib.ROOT, 'public', 'assets', 'rendered')
os.makedirs(OUT, exist_ok=True)

# World layout (units). Plaza front edge at Y=0, back edge at Y=PD; X centred on 0.
PW, PD = 15.6, 9.2
SLAB_Z = 0.1
# Gameplay area inside the curbs (logical ARENA maps onto this).
GX = 6.9
GY0, GY1 = 0.6, 8.6
ARENA = (250, 290, 1670, 930)
TILT = 40.0
DIST = 17.5
LENS = 36.5  # tight enough that the plaza fills the frame (little empty lawn at the bottom)

# terrain/props helpers take board px under the default orthographic mapping; convert world -> board.
lib.BETA = math.radians(90 - 52)
lib.COSB, lib.SINB = math.cos(lib.BETA), math.sin(lib.BETA)


# spectator bleacher tiers behind the back wall: (distance behind the wall, height) in world units
TIERS = [(0.75, 0.32), (1.3, 0.62), (1.85, 0.92)]
STAND_W = 15.0


def bpx(X, Y):
    return X * 100.0, -Y * 100.0 * lib.COSB


def plaza_texture(path, S=2048, squash=1.0):
    """Square festival flagstones seen from above (perspective foreshortens them), drawn at 2x."""
    rnd = random.Random(8)
    w, h = S, int(S * PD / PW)
    im = Image.new('RGB', (w, h), (104, 80, 62))
    d = ImageDraw.Draw(im)
    tw = int(w / 26)
    th = tw
    pal = [(226, 192, 146), (214, 178, 130), (232, 204, 160), (204, 166, 120), (220, 184, 134), (230, 176, 128), (198, 170, 136)]
    for row, ty in enumerate(range(-th, h + th, th)):
        off = (row % 2) * tw // 2
        for tx in range(-tw, w + tw, tw):
            c = rnd.choice(pal)
            c = tuple(max(0, min(255, v + rnd.randint(-10, 8))) for v in c)
            a0, b0, a1, b1 = tx + off + 3, ty + 3, tx + off + tw - 3, ty + th - 3
            d.rounded_rectangle([a0, b0, a1, b1], radius=8, fill=c)
            d.rounded_rectangle([a0 + 4, b0 + 3, a1 - 10, b0 + 9], radius=3, fill=tuple(min(255, v + 16) for v in c))
            if rnd.random() < 0.16:
                cx0 = rnd.randint(a0 + 8, a1 - 8)
                pts = [(cx0, b0 + 2)]
                for _ in range(3):
                    pts.append((pts[-1][0] + rnd.randint(-10, 10), pts[-1][1] + (b1 - b0) / 3))
                d.line(pts, fill=tuple(int(v * 0.62) for v in c), width=2)
    arr = np.asarray(im).astype(np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    edge = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy))
    noise = np.asarray(Image.effect_noise((w // 10 + 1, h // 10 + 1), 60).resize((w, h), Image.BICUBIC), np.float32) / 255.0
    moss = np.clip((150 - edge) / 150, 0, 1) * np.clip((noise - 0.45) * 3.0, 0, 1)
    arr = arr * (1 - moss[..., None] * 0.55) + np.array([96, 150, 70], np.float32) * moss[..., None] * 0.55
    grime = np.asarray(Image.effect_noise((w // 30 + 1, h // 30 + 1), 40).resize((w, h), Image.BICUBIC), np.float32) / 255.0
    arr *= (0.9 + 0.16 * grime)[..., None]
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    # border band with crystal studs
    bw = int(w * 0.022)
    for box in [(0, 0, w, bw), (0, h - bw, w, h), (0, 0, bw, h), (w - bw, 0, w, h)]:
        d.rectangle(box, fill=(122, 92, 70))
    for k in range(bw, w - bw, int(w / 36)):
        for yb in (bw // 2, h - bw // 2):
            d.ellipse([k - 9, yb - 9, k + 9, yb + 9], fill=(40, 120, 140))
            d.ellipse([k - 6, yb - 6, k + 6, yb + 5], fill=(92, 225, 255))
    # inlaid mosaic: teal disc with a gold spiral of small tesserae (smooth after downsampling)
    cx, cy = w / 2, h / 2
    R = h * 0.34
    for ring in np.arange(0, R, 14):
        n = max(8, int(ring * math.tau / 14))
        for k in range(n):
            a = k / n * math.tau + ring * 0.01
            px, py = cx + math.cos(a) * ring, cy + math.sin(a) * ring
            shade = rnd.randint(-12, 12)
            base = (38 + shade, 150 + shade, 148 + shade) if ring < R - 24 else (228 + shade, 190 + shade, 92)
            d.rounded_rectangle([px - 6, py - 6, px + 6, py + 6], radius=2, fill=base)
    for i in range(1400):
        t = i / 1399
        a = t * 3.2 * math.tau
        r = 22 + t * (R - 40)
        px, py = cx + math.cos(a) * r, cy + math.sin(a) * r
        shade = rnd.randint(-14, 10)
        d.rounded_rectangle([px - 8, py - 8, px + 8, py + 8], radius=3, fill=(246 + min(0, shade), 190 + shade, 72 + shade))
    # a smooth brass-and-grout frame hides the stepped edge of the tesserae
    d.ellipse([cx - R - 6, cy - R - 6, cx + R + 6, cy + R + 6], outline=(92, 66, 48), width=16)
    d.ellipse([cx - R + 4, cy - R + 4, cx + R - 4, cy + R - 4], outline=(232, 186, 84), width=12)
    d.ellipse([cx - R + 6, cy - R + 6, cx + R - 6, cy + R - 6], outline=(252, 220, 140), width=3)
    # a ring of large radial slabs around the mosaic breaks up the running bond
    R2 = R * 1.42
    ring_img = Image.new('L', (w, h), 0)
    ImageDraw.Draw(ring_img).ellipse([cx - R2, cy - R2, cx + R2, cy + R2], fill=255)
    ImageDraw.Draw(ring_img).ellipse([cx - R - 14, cy - R - 14, cx + R + 14, cy + R + 14], fill=0)
    slabs = Image.new('RGB', (w, h), (120, 94, 74))
    sd = ImageDraw.Draw(slabs)
    nseg = 28
    for k in range(nseg):
        a0, a1 = k / nseg * 360, (k + 1) / nseg * 360
        c = rnd.choice([(214, 196, 170), (204, 186, 160), (222, 206, 180), (196, 178, 152)])
        sd.pieslice([cx - R2 + 4, cy - R2 + 4, cx + R2 - 4, cy + R2 - 4], a0 + 0.6, a1 - 0.6, fill=c)
    im.paste(slabs, (0, 0), ring_img)
    d = ImageDraw.Draw(im)
    d.ellipse([cx - R2, cy - R2, cx + R2, cy + R2], outline=(110, 84, 64), width=8)

    # a frame of terracotta pavers just inside the border band gives the floor a finished rim
    fr0, fr1 = bw + 6, bw + 6 + int(tw * 0.62)
    for (x0, y0, x1, y1, horiz) in [(fr0, fr0, w - fr0, fr1, True), (fr0, h - fr1, w - fr0, h - fr0, True), (fr0, fr1, fr1, h - fr1, False), (w - fr1, fr1, w - fr0, h - fr1, False)]:
        d.rectangle([x0, y0, x1, y1], fill=(112, 78, 58))
        span = (x1 - x0) if horiz else (y1 - y0)
        n = max(1, int(span / (tw * 0.62)))
        for k in range(n):
            c = rnd.choice([(188, 108, 72), (176, 98, 66), (198, 120, 80), (168, 94, 64)])
            if horiz:
                a0, a1 = x0 + k * span / n + 3, x0 + (k + 1) * span / n - 3
                d.rounded_rectangle([a0, y0 + 3, a1, y1 - 3], radius=5, fill=c)
                d.rounded_rectangle([a0 + 3, y0 + 5, a1 - 6, y0 + 9], radius=2, fill=tuple(min(255, v + 18) for v in c))
            else:
                b0, b1 = y0 + k * span / n + 3, y0 + (k + 1) * span / n - 3
                d.rounded_rectangle([x0 + 3, b0, x1 - 3, b1], radius=5, fill=c)
                d.rounded_rectangle([x0 + 5, b0 + 3, x1 - 8, b0 + 7], radius=2, fill=tuple(min(255, v + 18) for v in c))

    # four inlaid sun medallions in the open fields left and right of the ring
    def medallion(mx, my, mr):
        d.ellipse([mx - mr - 8, my - mr - 8, mx + mr + 8, my + mr + 8], fill=(104, 78, 58))
        nseg2 = 12
        for k in range(nseg2):
            a0, a1 = k / nseg2 * 360, (k + 1) / nseg2 * 360
            c = rnd.choice([(214, 196, 170), (204, 186, 160), (222, 206, 180)])
            d.pieslice([mx - mr, my - mr, mx + mr, my + mr], a0 + 1.2, a1 - 1.2, fill=c)
        ri = mr * 0.64
        d.ellipse([mx - ri - 5, my - ri - 5, mx + ri + 5, my + ri + 5], fill=(92, 66, 48))
        d.ellipse([mx - ri, my - ri, mx + ri, my + ri], fill=(40, 146, 146))
        d.ellipse([mx - ri + 3, my - ri + 3, mx + ri - 3, my + ri - 3], outline=(232, 186, 84), width=6)
        pts = []
        for k in range(16):
            a = k / 16 * math.tau - math.pi / 2
            rr = ri * (0.86 if k % 2 == 0 else 0.34)
            if k % 4 == 2:
                rr = ri * 0.58
            pts.append((mx + math.cos(a) * rr, my + math.sin(a) * rr))
        d.polygon(pts, fill=(246, 196, 76))
        d.line(pts + [pts[0]], fill=(196, 136, 40), width=3)
        d.ellipse([mx - ri * 0.16, my - ri * 0.16, mx + ri * 0.16, my + ri * 0.16], fill=(255, 236, 170))

    fx = (fr1 + (cx - R2)) / 2
    mr = min((cx - R2 - fr1) * 0.36, h * 0.12)
    for mx in (fx, w - fx):
        for my in (h * 0.3, h * 0.7):
            medallion(mx, my, mr)
    # festival litter: a light sprinkle of confetti, a few leaves and petals toward the edges
    for _ in range(110):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(R * 1.5, min(w, h) * 0.62)
        px, py = cx + math.cos(a) * r * 1.3, cy + math.sin(a) * r * 0.9
        if not (bw < px < w - bw and bw < py < h - bw):
            continue
        c = rnd.choice([(255, 107, 94), (31, 165, 160), (242, 193, 78), (142, 92, 217), (255, 255, 255)])
        ang = rnd.uniform(0, math.pi)
        L = rnd.uniform(5, 9)
        d.line([(px, py), (px + math.cos(ang) * L, py + math.sin(ang) * L)], fill=c, width=4)
    for _ in range(40):
        side = rnd.choice(['l', 'r', 't', 'b'])
        px = rnd.uniform(bw + 10, bw + 120) if side == 'l' else rnd.uniform(w - bw - 120, w - bw - 10) if side == 'r' else rnd.uniform(bw, w - bw)
        py = rnd.uniform(bw + 10, bw + 90) if side == 't' else rnd.uniform(h - bw - 90, h - bw - 10) if side == 'b' else rnd.uniform(bw, h - bw)
        c = rnd.choice([(120, 170, 70), (150, 180, 80), (200, 150, 60)])
        d.ellipse([px - 7, py - 4, px + 7, py + 4], fill=c)
    im = im.resize((w // 2, h // 2), Image.LANCZOS)
    im.save(path)


def generated_image_material(name, img_path, rough=0.55, bump=0.25):
    m = lib.NT(name)
    tc = m.node('ShaderNodeTexCoord')
    img = m.node('ShaderNodeTexImage')
    img.image = bpy.data.images.load(img_path)
    img.extension = 'EXTEND'
    img.interpolation = 'Cubic'
    m.link(tc.outputs['Generated'], img.inputs['Vector'])
    lum = m.node('ShaderNodeRGBToBW')
    m.link(img.outputs['Color'], lum.inputs['Color'])
    c = m.mult(img.outputs['Color'], m.mix(m.ao(0.6, 8), col('#6a6070'), col('#ffffff')))
    m.bsdf(c, rough, normal=m.bump(lum.outputs['Val'], bump, 0.02))
    return m.mat


def grass_material():
    m = lib.NT('arena_grass')
    pos = m.position()
    n1 = m.noise(0.35, 5, 0.6, pos)
    n2 = m.noise(2.5, 3, 0.5, pos)
    f = m.math('ADD', m.math('MULTIPLY', n1.outputs['Fac'], 0.8), m.math('MULTIPLY', n2.outputs['Fac'], 0.35))
    c = m.ramp(f, [(0.28, '#23701f'), (0.42, '#358f28'), (0.55, '#4fab32'), (0.68, '#72c23c'), (0.82, '#9fd350')])
    m.bsdf(c, 0.85, normal=m.bump(n2.outputs['Fac'], 0.3, 0.05), sheen=0.25)
    return m.mat


def rock_material():
    m = lib.NT('arena_rock')
    pos = m.position()
    X, Y, Z = m.sep(pos)
    wave = m.node('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 0.6
    wave.inputs['Distortion'].default_value = 5.0
    m.link(pos, wave.inputs['Vector'])
    rn = m.noise(0.8, 6, 0.6, pos)
    rf = m.math('ADD', m.math('MULTIPLY', wave.outputs['Fac'], 0.55), m.math('MULTIPLY', rn.outputs['Fac'], 0.5))
    c = m.ramp(rf, [(0.25, '#5a3d3a'), (0.4, '#7b5140'), (0.55, '#99694b'), (0.7, '#6e5566'), (0.85, '#8a7a8e')])
    soil = m.ramp(rn.outputs['Fac'], [(0.3, '#6b4228'), (0.7, '#8c5a33')])
    c = m.mix(m.maprange(Z, -0.8, -0.1), c, soil)
    c = m.mult(c, m.mix(m.maprange(Z, -7.0, -0.5, 0.0, 1.0, smooth=False), col('#6b5f8a'), col('#ffffff')))
    m.bsdf(c, 0.9, normal=m.bump(rn.outputs['Fac'], 0.4, 0.1))
    return m.mat


def island():
    """Grass-topped floating island under the plaza with a lumpy rock underside."""
    rnd = random.Random(21)
    ph = [rnd.uniform(0, math.tau) for _ in range(4)]
    n = 72
    rx, ry = PW / 2 + 3.2, PD / 2 + 3.4
    cy = PD / 2
    outline = []
    for k in range(n):
        a = k / n * math.tau
        w = 1 + 0.06 * math.sin(3 * a + ph[0]) + 0.04 * math.sin(5 * a + ph[1])
        outline.append((math.cos(a) * rx * w, cy + math.sin(a) * ry * w))
    top_v = [(0.0, cy, 0.0)] + [(x, y, 0.0) for (x, y) in outline]
    top_f = [(0, 1 + k, 1 + (k + 1) % n) for k in range(n)]
    lib.mesh_object('island_top', top_v, top_f, smooth=False, material=grass_material())
    verts, faces = [], []
    rows = 10
    for i in range(rows):
        t = i / (rows - 1)
        sh = (1 - t) ** 0.85
        z = -0.02 - 7.0 * t ** 0.95
        for k, (x, y) in enumerate(outline):
            a = k / n * math.tau
            bump = 1 + 0.08 * math.sin(4 * a + ph[2] + t * 3) + 0.05 * math.sin(9 * a + ph[3] - t * 2)
            verts.append((x * sh * bump, cy + (y - cy) * sh * bump, z))
    for i in range(rows - 1):
        for k in range(n):
            a, b = i * n + k, i * n + (k + 1) % n
            faces.append((a, a + n, b + n, b))
    lib.mesh_object('island_under', verts, faces, smooth=True, material=rock_material())
    return outline


def box(mb, cx, cy, cz, sx, sy, sz, color):
    v, f = lib.box((cx, cy, cz), (sx, sy, sz))
    mb.add(v, f, color)


def main():
    sc = lib.reset(12 if A.preview else 40)
    lib.world_light(0.8)
    # a lower afternoon sun: walls, bleachers and trees throw readable shadows across the floor
    lib.sun(energy=3.7, elevation=30, azimuth=-42, angle=2.5, color='#ffe6c2')
    sc.render.resolution_x, sc.render.resolution_y = (SW // 2, SH // 2) if A.preview else (SW, SH)
    cd = bpy.data.cameras.new('cam')
    cd.type = 'PERSP'
    cd.lens = LENS
    cd.sensor_width = 36.0
    cd.sensor_fit = 'HORIZONTAL'
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    T = math.radians(TILT)
    centre = Vector((0.0, PD * 0.47, 0.0))
    view = Vector((0.0, math.cos(T), -math.sin(T)))
    cam.location = centre - view * DIST
    cam.rotation_euler = (math.pi / 2 - T, 0.0, 0.0)
    # Nudge the frame so the plaza sits a little low (the HUD owns the top strip).
    cd.shift_y = 0.05

    island()
    tex = os.path.join(OUT, 'plaza.png')
    plaza_texture(tex)
    top = [(-PW / 2, 0.0, SLAB_Z), (PW / 2, 0.0, SLAB_Z), (PW / 2, PD, SLAB_Z), (-PW / 2, PD, SLAB_Z)]
    lib.mesh_object('plaza_top', top, [(0, 1, 2, 3)], smooth=False, material=generated_image_material('plaza', tex))
    mats = props.mats()
    sides = lib.MeshBuilder()
    bot = [(x, y, -0.6) for (x, y, _) in top]
    sides.add(top + bot, [(0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], col('#d8cbb8'))
    sides.build('plaza_sides', mats['stone'], smooth=False)
    # walls: tall back wall (the crowd stands behind it), low sides, a curb at the front
    walls, caps = lib.MeshBuilder(), lib.MeshBuilder()
    back, back_caps = lib.MeshBuilder(), lib.MeshBuilder()
    wall_specs = [((-PW / 2, PD), (PW / 2, PD), 0.62, True), ((-PW / 2, 0.0), (-PW / 2, PD), 0.3, False), ((PW / 2, 0.0), (PW / 2, PD), 0.3, False),
                  ((-PW / 2, 0.0), (PW / 2, 0.0), 0.14, False)]
    for (a, b, hh, is_back) in wall_specs:
        wb, cb = (back, back_caps) if is_back else (walls, caps)
        ax, ay = a
        bx, by = b
        L = math.hypot(bx - ax, by - ay)
        ang = math.atan2(by - ay, bx - ax)
        v, f = lib.box(((ax + bx) / 2, (ay + by) / 2, SLAB_Z + hh / 2), (L, 0.2, hh), rot_z=ang)
        wb.add(v, f, col('#e3d6c4'))
        n = max(2, int(L / 1.4))
        for k in range(n + 1):
            t = k / n
            px, py = ax + (bx - ax) * t, ay + (by - ay) * t
            v, f = lib.cylinder((px, py, SLAB_Z), 0.13, 0.12, hh + 0.16, 10)
            wb.add(v, f, col('#efe5d8'))
            v, f = lib.blob((px, py, SLAB_Z + hh + 0.22), 0.11, rough=0.0, subdiv=2)
            cb.add(v, f, col('#e0a93f'))
    walls.build('walls', mats['stone'])
    caps.build('caps', mats['metal'])
    back.build('wall_back', mats['stone'])
    back_caps.build('caps_back', mats['metal'])
    # scenery: trees and bushes around the plaza, stalls on the island to either side
    rnd = random.Random(5)
    leaves, wood, flowers = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    for (X, Y, s_) in [(-10.2, 7.8, 1.25), (10.2, 7.8, 1.25), (-11.0, 3.2, 1.1), (11.0, 3.4, 1.1), (-8.9, 10.9, 1.0), (9.1, 10.9, 1.0), (-4.0, 11.95, 0.95), (4.2, 12.0, 0.95)]:
        terrain.tree_round(leaves, wood, *bpx(X, Y), rnd, s_)
    for (X, Y) in [(-9.6, -1.4), (9.6, -1.2), (-5.5, -2.0), (5.8, -2.1), (0.0, -2.3), (-11.2, 1.0), (11.3, 1.2)]:
        terrain.bush(leaves, *bpx(X, Y), rnd, 1.4, berries=flowers)
    for _ in range(26):
        X, Y = rnd.uniform(-11, 11), rnd.uniform(-2.6, 12)
        if abs(X) < PW / 2 + 0.6 and -0.6 < Y < PD + 0.6:
            continue
        terrain.flower_bed(flowers, leaves, *bpx(X, Y), rnd)
    leaves.build('leaves', lib.attr_mat('leaf', rough=0.78, ao=0.5))
    wood.build('wood', lib.attr_mat('wood', rough=0.8, ao=0.3))
    flowers.build('flowers', lib.attr_mat('flower', rough=0.55))
    props.stall(*bpx(-9.0, 6.4), 1.6, stripe=('#ff6b5e', '#fff4dc'))
    props.stall(*bpx(9.0, 6.4), 1.6, stripe=('#1fa5a0', '#fff4dc'))
    # spectator bleachers behind the back wall (the in-game crowd stands on these tiers)
    stands, stand_trim = lib.MeshBuilder(), lib.MeshBuilder()
    for i, (dy, dz) in enumerate(TIERS):
        v, f = lib.box((0.0, PD + dy, SLAB_Z + dz - 0.06), (STAND_W, 0.55, 0.12))
        stands.add(v, f, col(['#b07a45', '#a06a3e', '#b88048'][i % 3]))
        v, f = lib.box((0.0, PD + dy - 0.26, SLAB_Z + (dz - 0.06) / 2), (STAND_W, 0.06, dz))
        stands.add(v, f, col('#7a5234'))
        v, f = lib.box((0.0, PD + dy - 0.29, SLAB_Z + dz - 0.02), (STAND_W + 0.04, 0.05, 0.05))
        stand_trim.add(v, f, col('#e0a93f'))
    for X in (-STAND_W / 2, STAND_W / 2):
        v, f = lib.box((X, PD + 1.4, SLAB_Z + 0.5), (0.18, 1.8, 1.0))
        stands.add(v, f, col('#6e4a2c'))
    stands.build('stands', mats['wood'])
    stand_trim.build('stands_trim', mats['metal'])
    # kept low: the HUD owns the top strip
    for X in (-9.4, 9.4):
        props.lantern(*bpx(X, PD + 0.5), 1.3)

    path = os.path.join(OUT, 'gleam3d.png')
    lib.render_to(path)

    # Screen positions of the gameplay rectangle's corners (logical ARENA order: TL, TR, BR, BL).
    W, H = sc.render.resolution_x, sc.render.resolution_y
    k = SW / W

    def scr(X, Y, Z=SLAB_Z):
        v = world_to_camera_view(sc, cam, Vector((X, Y, Z)))
        return [round(v.x * W * k, 2), round((1 - v.y) * H * k, 2)]

    corners = [scr(-GX, GY1), scr(GX, GY1), scr(GX, GY0), scr(-GX, GY0)]
    wall_top = scr(0.0, PD, SLAB_Z + 0.62)
    meta = {'arena': list(ARENA), 'corners': corners, 'wallTopY': wall_top[1], 'backY': scr(0.0, PD)[1], 'backLeftX': scr(-PW / 2, PD)[0],
            'backRightX': scr(PW / 2, PD)[0],
            'tiers': [{'y': scr(0.0, PD + dy, SLAB_Z + dz)[1], 'x0': scr(-STAND_W / 2 + 0.4, PD + dy, SLAB_Z + dz)[0], 'x1': scr(STAND_W / 2 - 0.4, PD + dy, SLAB_Z + dz)[0],
                       'scale': abs(scr(1.0, PD + dy, SLAB_Z + dz)[0] - scr(0.0, PD + dy, SLAB_Z + dz)[0]) / 100.0} for (dy, dz) in TIERS]}
    print('corners', meta)
    # Front layer: the back wall alone (everything else held out, lighting unchanged).
    for ob in sc.objects:
        if ob.type == 'MESH' and ob.name not in ('wall_back', 'caps_back'):
            ob.is_holdout = True
    wall = os.path.join(OUT, 'gleam3d_wall.png')
    lib.render_to(wall)
    if not A.preview:
        Image.open(path).convert('RGBA').save(os.path.join(PUB, 'scene_gleam3d.webp'), 'WEBP', quality=90, method=6)
        Image.open(wall).convert('RGBA').save(os.path.join(PUB, 'scene_gleam3d_wall.webp'), 'WEBP', quality=90, method=6)
        with open(os.path.join(PUB, 'scene_gleam3d.json'), 'w') as fh:
            json.dump(meta, fh, indent=1)
        print('wrote scene_gleam3d')


main()
