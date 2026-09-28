"""Gleam Grab arena rendered with a perspective camera (the plaza recedes like a real 3/4 view).

    .artenv/bin/python scripts/art/gleam3d.py [--preview]
    python3 scripts/art/bloom.py public/assets/rendered/scene_gleam3d.webp && python3 scripts/art/blur_backdrops.py

The gameplay rectangle (logical ARENA 250..1670 x 290..930, see GleamGrab.ts) is laid out on the
plaza in world units; after rendering, the screen positions of its four corners are written to
public/assets/rendered/scene_gleam3d.json so the game can map logical coordinates onto the floor
with a homography (and scale sprites by depth). Outputs scene_gleam3d.webp (arena) and
scene_gleam3d_wall.webp (the back wall and its banners alone, drawn over the crowd in-game).
The camera, plaza, walls and bleacher tiers are gameplay geometry: change them and the JSON (and
every sprite position in the game) moves with them.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
import mg_dress as dress  # noqa: E402
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
WALL_H = 0.62  # back wall height above the slab (the crowd stands behind it)

# terrain/props helpers take board px under the default orthographic mapping; convert world -> board.
lib.BETA = math.radians(90 - 52)
lib.COSB, lib.SINB = math.cos(lib.BETA), math.sin(lib.BETA)


# spectator bleacher tiers behind the back wall: (distance behind the wall, height) in world units
TIERS = [(0.75, 0.32), (1.3, 0.62), (1.85, 0.92)]
STAND_W = 15.0


def bpx(X, Y):
    return X * 100.0, -Y * 100.0 * lib.COSB


# ------------------------------------------------------------------------------------------
# Floor texture
FESTIVE_RGB = [(255, 107, 94), (31, 165, 160), (242, 193, 78), (142, 92, 217), (255, 255, 255), (92, 225, 255), (139, 211, 70)]


def _noise(w, h, cell, amp=60, seed=0):
    """Smooth value noise in 0..1 (PIL's effect_noise, upsampled)."""
    rs = random.getstate()
    random.seed(seed)
    im = Image.effect_noise((max(2, w // cell + 1), max(2, h // cell + 1)), amp)
    random.setstate(rs)
    return np.asarray(im.resize((w, h), Image.BICUBIC), np.float32) / 255.0


def plaza_texture(path, S=4096):
    """Festival flagstones seen from above (perspective foreshortens them), drawn at 2x and downsampled:
    worn sandstone in running bond with bevels, chips, cracks and mossy grout, a tesserae spiral inlay,
    sun medallions, a terracotta frame and a gem-studded border, festival litter, and baked shading
    (the edges and the strip under the stands darken, so the lit centre reads as the stage)."""
    rnd = random.Random(8)
    w, h = S, int(S * PD / PW)
    K = S / 2048  # the layout below was designed on a 2048 px canvas
    im = Image.new('RGB', (w, h), (96, 72, 56))
    d = ImageDraw.Draw(im)
    tiles = Image.new('L', (w, h), 0)  # 255 = stone face, 0 = grout
    dt = ImageDraw.Draw(tiles)
    tw = int(w / 26)
    th = tw
    pal = [(226, 192, 146), (214, 178, 130), (232, 204, 160), (204, 166, 120), (220, 184, 134), (230, 176, 128), (198, 170, 136), (222, 196, 158)]
    for row, ty in enumerate(range(-th, h + th, th)):
        off = (row % 2) * tw // 2 + rnd.randint(-2, 2) * int(K)
        for tx in range(-tw, w + tw, tw):
            c = rnd.choice(pal)
            j = rnd.randint(-12, 9)
            c = tuple(max(0, min(255, v + j)) for v in c)
            r_ = rnd.random()
            if r_ < 0.07:  # an old, darker stone
                c = tuple(int(v * 0.8) for v in c)
            elif r_ < 0.12:  # a newer, paler one
                c = tuple(min(255, int(v * 1.07 + 6)) for v in c)
            g = int(3 * K)
            a0, b0, a1, b1 = tx + off + g, ty + g, tx + off + tw - g, ty + th - g
            rad = int(rnd.uniform(6, 13) * K)
            d.rounded_rectangle([a0, b0 + int(3 * K), a1, b1 + int(2 * K)], radius=rad, fill=tuple(int(v * 0.7) for v in c))  # worn lip
            d.rounded_rectangle([a0, b0, a1, b1], radius=rad, fill=c)
            dt.rounded_rectangle([a0, b0, a1, b1], radius=rad, fill=255)
            d.rounded_rectangle([a0 + int(4 * K), b0 + int(3 * K), a1 - int(10 * K), b0 + int(8 * K)], radius=int(3 * K), fill=tuple(min(255, v + 17) for v in c))
            d.rounded_rectangle([a0 + int(3 * K), b1 - int(6 * K), a1 - int(3 * K), b1 - int(2 * K)], radius=int(2 * K), fill=tuple(int(v * 0.9) for v in c))
            if rnd.random() < 0.17:  # hairline crack
                cx0 = rnd.randint(a0 + int(8 * K), a1 - int(8 * K))
                pts = [(cx0, b0 + 2)]
                for _ in range(4):
                    pts.append((pts[-1][0] + rnd.randint(-9, 9) * K, pts[-1][1] + (b1 - b0) / 4))
                d.line(pts, fill=tuple(int(v * 0.6) for v in c), width=max(1, int(1.6 * K)))
            if rnd.random() < 0.12:  # chipped corner
                cxn = a0 if rnd.random() < 0.5 else a1 - int(12 * K)
                cz = int(rnd.uniform(8, 14) * K)
                d.polygon([(cxn, b0), (cxn + cz, b0), (cxn + (0 if cxn == a0 else cz), b0 + int(cz * 0.8))], fill=(112, 86, 66))
    arr = np.asarray(im).astype(np.float32)
    face = np.asarray(tiles).astype(np.float32) / 255.0
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    edge = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy))
    # moss and dirt in the grout, creeping in from the edges
    mn = _noise(w, h, int(10 * K), 60, 11)
    moss = np.clip((260 * K - edge) / (260 * K), 0, 1) * np.clip((mn - 0.42) * 3.0, 0, 1) * (1 - face)
    arr = arr * (1 - moss[..., None] * 0.7) + np.array([86, 138, 62], np.float32) * moss[..., None] * 0.7
    # stone wear: soft blotches, fine pits, a polished traffic zone in the middle
    grime = _noise(w, h, int(30 * K), 40, 12)
    arr *= (0.9 + 0.16 * grime)[..., None]
    pits = _noise(w, h, max(2, int(2 * K)), 90, 13)
    arr *= (1.0 - 0.12 * np.clip((pits - 0.72) * 5, 0, 1) * face)[..., None]
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    # border band with crystal studs
    bw = int(w * 0.022)
    for box in [(0, 0, w, bw), (0, h - bw, w, h), (0, 0, bw, h), (w - bw, 0, w, h)]:
        d.rectangle(box, fill=(118, 88, 68))
    for k in range(bw, w - bw, int(w / 36)):
        for yb in (bw // 2, h - bw // 2):
            r0 = 9 * K
            d.ellipse([k - r0, yb - r0, k + r0, yb + r0], fill=(40, 120, 140))
            d.ellipse([k - 6 * K, yb - 6 * K, k + 6 * K, yb + 5 * K], fill=(92, 225, 255))
            d.ellipse([k - 3 * K, yb - 4 * K, k + 0.5 * K, yb - 1 * K], fill=(220, 250, 255))
    # inlaid mosaic: teal disc with a gold spiral of small tesserae (smooth after downsampling)
    cx, cy = w / 2, h / 2
    R = h * 0.34
    step = 14 * K
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(24, 96, 96))  # dark grout behind the tesserae
    for ring in np.arange(0, R, step):
        n = max(8, int(ring * math.tau / step))
        for k in range(n):
            a = k / n * math.tau + ring * 0.01 / K
            px, py = cx + math.cos(a) * ring, cy + math.sin(a) * ring
            shade = rnd.randint(-14, 14)
            if ring < R - 24 * K:
                deep = 1.0 - 0.18 * (ring / R) ** 3
                base = (int((38 + shade) * deep), int((150 + shade) * deep), int((148 + shade) * deep))
            else:
                base = (228 + shade // 2, 190 + shade, 92)
            q = 6 * K
            d.rounded_rectangle([px - q, py - q, px + q, py + q], radius=2 * K, fill=base)
            d.rectangle([px - q + K, py - q + K, px - q + 3 * K, py - q + 3 * K], fill=tuple(min(255, v + 30) for v in base))
    for i in range(1500):
        t = i / 1499
        a = t * 3.2 * math.tau
        r = 22 * K + t * (R - 40 * K)
        px, py = cx + math.cos(a) * r, cy + math.sin(a) * r
        shade = rnd.randint(-14, 10)
        q = 8 * K
        d.rounded_rectangle([px - q, py - q, px + q, py + q], radius=3 * K, fill=(246 + min(0, shade), 190 + shade, 72 + shade))
    for i in range(1500):  # a bright glaze line along the spiral's crest
        t = i / 1499
        a = t * 3.2 * math.tau
        r = 22 * K + t * (R - 40 * K) - 3 * K
        px, py = cx + math.cos(a) * r, cy + math.sin(a) * r
        d.ellipse([px - 2.2 * K, py - 2.2 * K, px + 2.2 * K, py + 2.2 * K], fill=(255, 232, 150))
    # a smooth brass-and-grout frame hides the stepped edge of the tesserae
    d.ellipse([cx - R - 6 * K, cy - R - 6 * K, cx + R + 6 * K, cy + R + 6 * K], outline=(92, 66, 48), width=int(16 * K))
    d.ellipse([cx - R + 4 * K, cy - R + 4 * K, cx + R - 4 * K, cy + R - 4 * K], outline=(232, 186, 84), width=int(12 * K))
    d.ellipse([cx - R + 6 * K, cy - R + 6 * K, cx + R - 6 * K, cy + R - 6 * K], outline=(252, 220, 140), width=int(3 * K))
    # a ring of large radial slabs around the mosaic breaks up the running bond
    R2 = R * 1.42
    ring_img = Image.new('L', (w, h), 0)
    ImageDraw.Draw(ring_img).ellipse([cx - R2, cy - R2, cx + R2, cy + R2], fill=255)
    ImageDraw.Draw(ring_img).ellipse([cx - R - 14 * K, cy - R - 14 * K, cx + R + 14 * K, cy + R + 14 * K], fill=0)
    slabs = Image.new('RGB', (w, h), (116, 90, 72))
    sd = ImageDraw.Draw(slabs)
    nseg = 28
    for k in range(nseg):
        a0, a1 = k / nseg * 360, (k + 1) / nseg * 360
        c = rnd.choice([(214, 196, 170), (204, 186, 160), (222, 206, 180), (196, 178, 152), (210, 190, 162)])
        sd.pieslice([cx - R2 + 4 * K, cy - R2 + 4 * K, cx + R2 - 4 * K, cy + R2 - 4 * K], a0 + 0.6, a1 - 0.6, fill=c)
        # inner highlight arc and a darker outer lip on each slab
        sd.arc([cx - R2 + 12 * K, cy - R2 + 12 * K, cx + R2 - 12 * K, cy + R2 - 12 * K], a0 + 1.4, a1 - 1.4, fill=tuple(int(v * 0.86) for v in c), width=int(6 * K))
        sd.arc([cx - R - 24 * K, cy - R - 24 * K, cx + R + 24 * K, cy + R + 24 * K], a0 + 1.4, a1 - 1.4, fill=tuple(min(255, v + 14) for v in c), width=int(5 * K))
    im.paste(slabs, (0, 0), ring_img)
    d = ImageDraw.Draw(im)
    d.ellipse([cx - R2, cy - R2, cx + R2, cy + R2], outline=(106, 80, 62), width=int(8 * K))

    # a frame of terracotta pavers just inside the border band gives the floor a finished rim
    fr0, fr1 = bw + int(6 * K), bw + int(6 * K) + int(tw * 0.62)
    for (x0, y0, x1, y1, horiz) in [(fr0, fr0, w - fr0, fr1, True), (fr0, h - fr1, w - fr0, h - fr0, True), (fr0, fr1, fr1, h - fr1, False), (w - fr1, fr1, w - fr0, h - fr1, False)]:
        d.rectangle([x0, y0, x1, y1], fill=(108, 76, 56))
        span = (x1 - x0) if horiz else (y1 - y0)
        n = max(1, int(span / (tw * 0.62)))
        for k in range(n):
            c = rnd.choice([(188, 108, 72), (176, 98, 66), (198, 120, 80), (168, 94, 64), (182, 104, 70)])
            if horiz:
                a0, a1 = x0 + k * span / n + 3 * K, x0 + (k + 1) * span / n - 3 * K
                d.rounded_rectangle([a0, y0 + 3 * K, a1, y1 - 3 * K], radius=5 * K, fill=c)
                d.rounded_rectangle([a0 + 3 * K, y0 + 5 * K, a1 - 6 * K, y0 + 9 * K], radius=2 * K, fill=tuple(min(255, v + 18) for v in c))
                d.rounded_rectangle([a0 + 2 * K, y1 - 8 * K, a1 - 2 * K, y1 - 4 * K], radius=2 * K, fill=tuple(int(v * 0.86) for v in c))
            else:
                b0, b1 = y0 + k * span / n + 3 * K, y0 + (k + 1) * span / n - 3 * K
                d.rounded_rectangle([x0 + 3 * K, b0, x1 - 3 * K, b1], radius=5 * K, fill=c)
                d.rounded_rectangle([x0 + 5 * K, b0 + 3 * K, x1 - 8 * K, b0 + 7 * K], radius=2 * K, fill=tuple(min(255, v + 18) for v in c))

    # four inlaid sun medallions in the open fields left and right of the ring
    def medallion(mx, my, mr):
        d.ellipse([mx - mr - 8 * K, my - mr - 8 * K, mx + mr + 8 * K, my + mr + 8 * K], fill=(100, 74, 56))
        nseg2 = 12
        for k in range(nseg2):
            a0, a1 = k / nseg2 * 360, (k + 1) / nseg2 * 360
            c = rnd.choice([(214, 196, 170), (204, 186, 160), (222, 206, 180)])
            d.pieslice([mx - mr, my - mr, mx + mr, my + mr], a0 + 1.2, a1 - 1.2, fill=c)
        ri = mr * 0.64
        d.ellipse([mx - ri - 5 * K, my - ri - 5 * K, mx + ri + 5 * K, my + ri + 5 * K], fill=(92, 66, 48))
        d.ellipse([mx - ri, my - ri, mx + ri, my + ri], fill=(40, 146, 146))
        d.ellipse([mx - ri * 0.9, my - ri * 0.9, mx + ri * 0.9, my + ri * 0.9], fill=(34, 132, 134))
        d.ellipse([mx - ri + 3 * K, my - ri + 3 * K, mx + ri - 3 * K, my + ri - 3 * K], outline=(232, 186, 84), width=int(6 * K))
        pts = []
        for k in range(16):
            a = k / 16 * math.tau - math.pi / 2
            rr = ri * (0.86 if k % 2 == 0 else 0.34)
            if k % 4 == 2:
                rr = ri * 0.58
            pts.append((mx + math.cos(a) * rr, my + math.sin(a) * rr))
        d.polygon(pts, fill=(246, 196, 76))
        d.line(pts + [pts[0]], fill=(196, 136, 40), width=int(3 * K))
        d.ellipse([mx - ri * 0.16, my - ri * 0.16, mx + ri * 0.16, my + ri * 0.16], fill=(255, 236, 170))

    fx = (fr1 + (cx - R2)) / 2
    mr = min((cx - R2 - fr1) * 0.36, h * 0.12)
    for mx in (fx, w - fx):
        for my in (h * 0.3, h * 0.7):
            medallion(mx, my, mr)

    # baked shading: the rim darkens (edge vignette), the strip under the wall and bleachers most
    arr = np.asarray(im).astype(np.float32)
    ex = np.minimum(xx, w - 1 - xx) / w
    ey = np.minimum(yy, h - 1 - yy) / h
    vig = (0.8 + 0.2 * np.clip(ex / 0.14, 0, 1) ** 0.8) * (0.84 + 0.16 * np.clip(ey / 0.16, 0, 1) ** 0.8)
    back = 0.8 + 0.2 * np.clip(yy / (h * 0.13), 0, 1) ** 0.7  # row 0 is the back edge (under the wall)
    cool = np.clip(1.0 - yy / (h * 0.13), 0, 1)[..., None] * np.array([-6.0, -2.0, 6.0], np.float32)
    arr = arr * (vig * back)[..., None] + cool
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)

    # festival litter: confetti, curled streamers and petals, drifted towards the edges and corners
    def edge_pt():
        for _ in range(20):
            px, py = rnd.uniform(bw, w - bw), rnd.uniform(bw, h - bw)
            e = min(px - bw, w - bw - px, (py - bw) * 1.3, (h - bw - py) * 1.3)
            if rnd.random() < math.exp(-e / (170 * K)) + 0.07:
                return px, py
        return rnd.uniform(bw, w - bw), rnd.uniform(bw, h - bw)
    for _ in range(900):
        px, py = edge_pt()
        c = rnd.choice(FESTIVE_RGB)
        ang = rnd.uniform(0, math.pi)
        L, Wd = rnd.uniform(6, 11) * K, rnd.uniform(3, 4.5) * K
        ca, sa = math.cos(ang), math.sin(ang)
        quad = [(px + ca * L / 2 - sa * Wd / 2, py + sa * L / 2 + ca * Wd / 2), (px - ca * L / 2 - sa * Wd / 2, py - sa * L / 2 + ca * Wd / 2),
                (px - ca * L / 2 + sa * Wd / 2, py - sa * L / 2 - ca * Wd / 2), (px + ca * L / 2 + sa * Wd / 2, py + sa * L / 2 - ca * Wd / 2)]
        d.polygon([(x + 1.5 * K, y + 1.5 * K) for (x, y) in quad], fill=(88, 64, 50))
        d.polygon(quad, fill=c)
    for _ in range(12):  # streamers only where the litter has drifted, never across the middle
        px, py = edge_pt()
        if min(px - bw, w - bw - px, py - bw, h - bw - py) > 150 * K:
            continue
        c = rnd.choice(FESTIVE_RGB[:4])
        pts = []
        a = rnd.uniform(0, math.tau)
        for k in range(26):
            a += rnd.uniform(-0.5, 0.5)
            px += math.cos(a) * 5 * K
            py += math.sin(a) * 5 * K
            pts.append((px + math.sin(k * 0.9) * 6 * K, py + math.cos(k * 0.9) * 6 * K))
        d.line([(x + 1.5 * K, y + 1.5 * K) for (x, y) in pts], fill=(88, 64, 50), width=int(4 * K))
        d.line(pts, fill=c, width=int(4 * K))
    for _ in range(120):
        px, py = edge_pt()
        c = rnd.choice([(255, 170, 200), (255, 236, 244), (255, 214, 120), (150, 200, 90)])
        d.ellipse([px - 5 * K, py - 3 * K, px + 5 * K, py + 3 * K], fill=c)
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
    # broad sky occlusion from the walls and bleachers (a cool, soft band along the edges) + contact AO
    c = m.mult(img.outputs['Color'], m.mix(m.ao(1.4, 16), col('#7f7a94'), col('#ffffff')))
    c = m.mult(c, m.mix(m.ao(0.35, 8), col('#6a6070'), col('#ffffff')))
    m.bsdf(c, rough, normal=m.bump(lum.outputs['Val'], bump, 0.02))
    return m.mat


def grass_material():
    m = lib.NT('arena_grass')
    pos = m.position()
    n1 = m.noise(0.35, 5, 0.6, pos)
    n2 = m.noise(2.5, 3, 0.5, pos)
    f = m.math('ADD', m.math('MULTIPLY', n1.outputs['Fac'], 0.8), m.math('MULTIPLY', n2.outputs['Fac'], 0.35))
    c = m.ramp(f, [(0.28, '#23701f'), (0.42, '#358f28'), (0.55, '#4fab32'), (0.68, '#72c23c'), (0.82, '#9fd350')])
    sp = m.voronoi(22.0, pos)
    spk = m.math('MULTIPLY', m.maprange(sp.outputs['Distance'], 0.1, 0.04), m.maprange(m.noise(1.8, 2, 0.5, pos).outputs['Fac'], 0.6, 0.72))
    c = m.mix(m.math('MULTIPLY', spk, 0.7), c, m.mix(m.maprange(sp.outputs['Color'], 0.0, 1.0), col('#fff6d8'), col('#ffd35a')))
    c = m.mult(c, m.mix(m.ao(1.0, 10), col('#51604a'), col('#ffffff')))
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


# ------------------------------------------------------------------------------------------
# Stands and wall dressing
def wall_banners(mats):
    """Player-colour banners hung on the arena face of the back wall (P1..P4, left to right), with
    bunting between the posts. Named 'wall_deco*' so they are rendered into the wall layer too."""
    cloth, metal = lib.MeshBuilder(), lib.MeshBuilder()
    yf = PD - 0.1 - 0.012
    top = SLAB_Z + WALL_H - 0.03
    for i, X in enumerate((-4.25, -1.42, 1.42, 4.25)):
        W, H = 0.86, 0.47
        out = [(-W / 2, 0.0), (W / 2, 0.0), (W / 2, -H + 0.08), (0.0, -H), (-W / 2, -H + 0.08)]
        dress.cloth_panel(cloth, out, (X, yf, top), dress.PLAYER[i], 0.008)
        dress.cloth_panel(cloth, [(-W / 2, 0.0), (W / 2, 0.0), (W / 2, -0.05), (-W / 2, -0.05)], (X, yf - 0.004, top), '#f2c14e', 0.002)
        dress.flat_poly(cloth, dress.shape_pts(dress.SHAPES[i], 0.1), (X, yf - 0.008, top - 0.24), dress.CREAM)
        v, f = lib.cylinder((0, 0, 0), 0.02, 0.02, W + 0.12, 8)
        v = lib.transform(v, loc=(X - W / 2 - 0.06, yf - 0.01, top + 0.01), rot=(0.0, math.pi / 2, 0.0))
        metal.add(v, f, col('#e0a93f'))
        for dx in (-1, 1):
            v, f = lib.blob((X + dx * (W / 2 + 0.07), yf - 0.01, top + 0.01), 0.03, rough=0.0, subdiv=1)
            metal.add(v, f, col('#f2c14e'))
    # little pennants swagged along the wall top between the banners
    n_posts = max(2, int(PW / 1.4))
    for k in range(n_posts):
        xa = -PW / 2 + k * PW / n_posts
        xb = xa + PW / n_posts
        if any(abs((xa + xb) / 2 - X) < 0.3 for X in (-4.25, -1.42, 1.42, 4.25)):
            continue
        pts = []
        for i in range(9):
            t = i / 8
            pts.append((xa + (xb - xa) * t, yf - 0.02, SLAB_Z + WALL_H + 0.08 - math.sin(t * math.pi) * 0.12))
        v, f = lib.tube(pts, 0.006, 4)
        metal.add(v, f, col('#6b4a2a'))
        for j in range(4):
            p0, p1 = Vector(pts[2 * j]), Vector(pts[2 * j + 2])
            mid = (p0 + p1) / 2
            tri = [tuple(p0), tuple(p1), (mid.x, mid.y - 0.005, mid.z - 0.13)]
            cloth.add(tri, [(0, 1, 2), (2, 1, 0)], col(dress.FESTIVE[(k + j) % len(dress.FESTIVE)]))
    cloth.build('wall_deco_cloth', dress.mats()['cloth'])
    metal.build('wall_deco_metal', mats['metal'])


def stands(mats):
    """Bleachers behind the back wall: timber tiers with painted risers, end towers and a festival
    backboard with bunting and player-colour flags (the in-game crowd stands on the tiers)."""
    wood, trim, paint = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    risers = ['#1fa5a0', '#e8604f', '#e0a93f']
    for i, (dy, dz) in enumerate(TIERS):
        v, f = lib.box((0.0, PD + dy, SLAB_Z + dz - 0.06), (STAND_W, 0.55, 0.12))
        wood.add(v, f, col(['#b07a45', '#a06a3e', '#b88048'][i % 3]))
        # riser: painted panels in alternating festival colours between darker stiles
        v, f = lib.box((0.0, PD + dy - 0.26, SLAB_Z + (dz - 0.06) / 2), (STAND_W, 0.06, dz))
        wood.add(v, f, col('#7a5234'))
        n = 10
        for k in range(n):
            x0 = -STAND_W / 2 + (k + 0.08) * STAND_W / n
            x1 = -STAND_W / 2 + (k + 0.92) * STAND_W / n
            v, f = lib.box(((x0 + x1) / 2, PD + dy - 0.295, SLAB_Z + (dz - 0.06) / 2), (x1 - x0, 0.012, max(0.05, dz - 0.14)))
            paint.add(v, f, col(risers[(k + i) % 3]))
        v, f = lib.box((0.0, PD + dy - 0.29, SLAB_Z + dz - 0.02), (STAND_W + 0.04, 0.05, 0.05))
        trim.add(v, f, col('#e0a93f'))
    # backboard behind the top tier: planked, with a painted band and brass cap rail
    by_ = PD + 2.2
    top = SLAB_Z + 1.62
    v, f = lib.box((0.0, by_, (SLAB_Z + top) / 2), (STAND_W + 0.3, 0.12, top - SLAB_Z))
    wood.add(v, f, col('#8a5a34'))
    for k in range(22):
        x = -STAND_W / 2 + (k + 0.5) * STAND_W / 22
        v, f = lib.box((x, by_ - 0.065, (SLAB_Z + top) / 2), (0.03, 0.01, top - SLAB_Z - 0.02))
        wood.add(v, f, col('#6e4a2c'))
    v, f = lib.box((0.0, by_ - 0.07, top - 0.16), (STAND_W + 0.3, 0.012, 0.18))
    paint.add(v, f, col('#1fa5a0'))
    for k in range(30):
        x = -STAND_W / 2 + (k + 0.5) * STAND_W / 30
        v, f = lib.blob((x, by_ - 0.08, top - 0.16), 0.03, squash=(1, 0.4, 1), rough=0.0, subdiv=1)
        trim.add(v, f, col('#f2c14e'))
    v, f = lib.box((0.0, by_ - 0.02, top + 0.02), (STAND_W + 0.36, 0.2, 0.05))
    trim.add(v, f, col('#e0a93f'))
    # end towers: stone piers with a brass lantern cap
    stone = lib.MeshBuilder()
    glow = lib.MeshBuilder()
    for X in (-STAND_W / 2 - 0.25, STAND_W / 2 + 0.25):
        v, f = lib.box((X, PD + 1.35, SLAB_Z + 0.9), (0.42, 2.0, 1.8))
        stone.add(v, f, col('#e8dccb'))
        v, f = lib.box((X, PD + 1.35, SLAB_Z + 1.84), (0.5, 2.08, 0.1))
        stone.add(v, f, col('#d4c4aa'))
        v, f = lib.lathe([(0.12, 0.0), (0.12, 0.2), (0.0, 0.22)], 10, (X, PD + 0.55, SLAB_Z + 1.9))
        glow.add(v, f, col('#ffd27a'))
        v, f = lib.lathe([(0.16, 0.2), (0.02, 0.36)], 10, (X, PD + 0.55, SLAB_Z + 1.9), cap_bottom=True, cap_top=False)
        trim.add(v, f, col('#c98a1b'))
    wood.build('stands', mats['wood'])
    trim.build('stands_trim', mats['metal'])
    paint.build('stands_paint', mats['paint'])
    stone.build('stand_towers', mats['stone'])
    glow.build('stand_lamps', mats['glow'])
    # bunting swagged along the backboard top and flags between (kept low: the HUD owns the top strip)
    cloth, rope = lib.MeshBuilder(), lib.MeshBuilder()
    xs = np.linspace(-STAND_W / 2, STAND_W / 2, 7)
    for a, b in zip(xs, xs[1:]):
        pts = [(a + (b - a) * t, by_ - 0.1, top + 0.04 - math.sin(t * math.pi) * 0.22) for t in np.linspace(0, 1, 13)]
        v, f = lib.tube(pts, 0.008, 4)
        rope.add(v, f, col('#6b4a2a'))
        for j in range(6):
            p0, p1 = Vector(pts[2 * j]), Vector(pts[2 * j + 2])
            mid = (p0 + p1) / 2
            tri = [tuple(p0), tuple(p1), (mid.x, mid.y - 0.01, mid.z - 0.2)]
            cloth.add(tri, [(0, 1, 2), (2, 1, 0)], col(dress.FESTIVE[(j + int(a * 3)) % len(dress.FESTIVE)]))
    cloth.build('stand_bunting', dress.mats()['cloth'])
    rope.build('stand_rope', mats['wood'])
    for i, X in enumerate(xs[1:-1]):
        dress.flag_pole(*bpx(X, by_ + 0.12), dress.PLAYER[i % 4], s=0.9, height=2.05 / 0.9, side=1, shape=dress.SHAPES[i % 4], name=f'standflag{i}')


def main():
    sc = lib.reset(12 if A.preview else 32)
    dress.threads()
    dress.reset_mats()
    # a low, warm afternoon sun from the front-left (the characters' key): the side curb posts, flags
    # and trees throw long shadows across the floor, and the walls shade a cool band along the edges
    dress.festival_light(key=4.3, elev=28, az=-50, fill=0.76, angle=2.5, key_col='#ffdcae')
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
    wall_specs = [((-PW / 2, PD), (PW / 2, PD), WALL_H, True), ((-PW / 2, 0.0), (-PW / 2, PD), 0.3, False), ((PW / 2, 0.0), (PW / 2, PD), 0.3, False),
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
    wall_banners(mats)
    # scenery: trees and bushes around the plaza, stalls, tents, flags and balloons on the island
    rnd = random.Random(5)
    leaves, wood, flowers = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    for (X, Y, s_) in [(-10.2, 7.8, 1.25), (10.2, 7.8, 1.25), (-11.0, 3.2, 1.1), (11.0, 3.4, 1.1), (-8.9, 10.9, 1.0), (9.1, 10.9, 1.0), (-4.0, 11.95, 0.95), (4.2, 12.0, 0.95),
                       (-1.2, 12.3, 0.85), (1.6, 12.4, 0.8), (-6.6, 11.6, 0.9), (6.9, 11.7, 0.9)]:
        terrain.tree_round(leaves, wood, *bpx(X, Y), rnd, s_)
    for (X, Y, s_) in [(-12.0, 6.0, 1.0), (12.1, 6.2, 1.0), (-9.6, 11.8, 0.9), (9.8, 11.9, 0.9)]:
        terrain.tree_pine(leaves, wood, *bpx(X, Y), rnd, s_)
    for (X, Y) in [(-9.6, -1.4), (9.6, -1.2), (-5.5, -2.0), (5.8, -2.1), (0.0, -2.3), (-11.2, 1.0), (11.3, 1.2), (-8.4, 9.6), (8.5, 9.7)]:
        terrain.bush(leaves, *bpx(X, Y), rnd, 1.4, berries=flowers)
    for _ in range(34):
        X, Y = rnd.uniform(-11, 11), rnd.uniform(-2.6, 12)
        if abs(X) < PW / 2 + 0.6 and -0.6 < Y < PD + 2.6:
            continue
        terrain.flower_bed(flowers, leaves, *bpx(X, Y), rnd)
    # the strip of lawn in front of the curb (the bottom of the frame): tufts and small flower clusters
    tufts = lib.MeshBuilder()
    for _ in range(160):
        X, Y = rnd.uniform(-9.5, 9.5), rnd.uniform(-1.05, -0.18)
        terrain.grass_tuft(tufts, *bpx(X, Y), rnd, rnd.uniform(1.0, 1.6))
    for _ in range(260):
        X, Y = rnd.uniform(-12.5, 12.5), rnd.uniform(-2.5, 12.8)
        if abs(X) < PW / 2 + 0.35 and -0.35 < Y < PD + 2.4:
            continue
        terrain.grass_tuft(tufts, *bpx(X, Y), rnd, rnd.uniform(1.0, 1.7))
    for X in (-7.6, -3.1, 1.9, 6.4, -5.2, 4.3):
        terrain.flower_bed(flowers, leaves, *bpx(X + rnd.uniform(-0.6, 0.6), rnd.uniform(-0.8, -0.45)), rnd)
    tufts.build('front_tufts', lib.attr_mat('tuft', rough=0.8, ao=0.4), smooth=False)
    leaves.build('leaves', lib.attr_mat('leaf', rough=0.78, ao=0.5))
    wood.build('wood', lib.attr_mat('wood', rough=0.8, ao=0.3))
    flowers.build('flowers', lib.attr_mat('flower', rough=0.55))
    props.stall(*bpx(-9.0, 6.4), 1.6, stripe=('#ff6b5e', '#fff4dc'))
    props.stall(*bpx(9.0, 6.4), 1.6, stripe=('#1fa5a0', '#fff4dc'))
    # (only a wedge beside the back corners is in frame: the plaza fills the width further forward)
    dress.tent(*bpx(-9.75, 10.5), s=1.3, c1='#8e5cd9', c2='#fff4dc', name='tent_l')
    dress.tent(*bpx(9.75, 10.5), s=1.3, c1='#f4b83b', c2='#fff4dc', name='tent_r')
    dress.balloons(*bpx(-8.35, 8.3), s=1.2, colors=['#22c3d6', '#ff6b5e', '#8bd346', '#ffb020'], name='balloons_l')
    dress.balloons(*bpx(8.35, 8.3), s=1.2, colors=['#ffb020', '#8bd346', '#ff6b5e', '#22c3d6'], name='balloons_r')
    for i, (X, Y) in enumerate([(-8.45, 7.2), (8.45, 7.2)]):
        dress.flag_pole(*bpx(X, Y), dress.PLAYER[i * 3 % 4], s=1.0, height=1.9, side=1, shape=dress.SHAPES[i * 3 % 4], name=f'sideflag{i}')
    stands(mats)
    # kept low: the HUD owns the top strip
    for X in (-9.4, 9.4):
        props.lantern(*bpx(X, PD + 0.5), 1.3)
    dress.string_lights([(-9.1, PD + 0.5, 1.9), (-8.1, 6.4, 2.05)], sag=0.25, bulbs=6, name='lights_l')
    dress.string_lights([(9.1, PD + 0.5, 1.9), (8.1, 6.4, 2.05)], sag=0.25, bulbs=6, name='lights_r')
    # atmospheric perspective: the trees beyond the stands and the island's underside go soft and blue
    near = dress.view_depth(cam, (0.0, PD + 2.4, 0.0))
    far = dress.view_depth(cam, (0.0, PD + 6.0, 0.0))
    dress.depth_haze(near, far, 0.3, color='#d6e6f6', skip=('plaza', 'arena_rock'))
    dress.depth_haze(dress.view_depth(cam, (0.0, 0.0, -1.0)), dress.view_depth(cam, (0.0, 0.0, -6.0)), 0.45, color='#cfe0f4', only=('arena_rock',))

    path = os.path.join(OUT, 'gleam3d.png')
    lib.render_to(path)

    # Screen positions of the gameplay rectangle's corners (logical ARENA order: TL, TR, BR, BL).
    W, H = sc.render.resolution_x, sc.render.resolution_y
    k = SW / W

    def scr(X, Y, Z=SLAB_Z):
        v = world_to_camera_view(sc, cam, Vector((X, Y, Z)))
        return [round(v.x * W * k, 2), round((1 - v.y) * H * k, 2)]

    corners = [scr(-GX, GY1), scr(GX, GY1), scr(GX, GY0), scr(-GX, GY0)]
    wall_top = scr(0.0, PD, SLAB_Z + WALL_H)
    meta = {'arena': list(ARENA), 'corners': corners, 'wallTopY': wall_top[1], 'backY': scr(0.0, PD)[1], 'backLeftX': scr(-PW / 2, PD)[0],
            'backRightX': scr(PW / 2, PD)[0],
            'tiers': [{'y': scr(0.0, PD + dy, SLAB_Z + dz)[1], 'x0': scr(-STAND_W / 2 + 0.4, PD + dy, SLAB_Z + dz)[0], 'x1': scr(STAND_W / 2 - 0.4, PD + dy, SLAB_Z + dz)[0],
                       'scale': abs(scr(1.0, PD + dy, SLAB_Z + dz)[0] - scr(0.0, PD + dy, SLAB_Z + dz)[0]) / 100.0} for (dy, dz) in TIERS]}
    print('corners', meta)
    # Front layer: the back wall and its banners alone (everything else held out, lighting unchanged).
    for ob in sc.objects:
        if ob.type == 'MESH' and not ob.name.startswith(('wall_back', 'caps_back', 'wall_deco')):
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
