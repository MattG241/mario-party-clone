"""Arenas and gameplay sprites for the six later minigames (screen-space, 1920x1080).

    .artenv/bin/python scripts/art/mg_arenas.py yard|pond|relay|totem|tower|sprites [--preview] [--only a,b]
    python3 scripts/art/bloom.py public/assets/rendered/scene_{crate,pond,relay,totem}.webp

Same conventions as scenes.py: an orthographic camera per scene whose ground plane maps 1:1 onto
the game's screen coordinates, so each minigame's layout constants line up with the art:
  yard   Crate Craze     floor x 240..1680, y 330..1000 (48 deg)
  pond   Spiral Splash   water ellipse centre (960, 640), radii (760, 360) (40 deg)
  relay  Relic Relay     lanes y 430/570/710/850, x 170..1750 (45 deg)
  totem  Totem Tug       side view, ground line y 820 (12 deg)
  tower  Tumble Tower    vertically tileable tower wall (level camera)
Around each play area the arenas are dressed for the festival (props, dense grass, contact shading,
a warm key over a cool fill and a touch of atmospheric haze: see mg_dress.py); the play areas stay
clean, and their bounds, the cameras and the sun directions (which the baked sprite shadows follow)
must not move. The game also stands spectators and signs on these images at fixed points (see each
minigame's layout constants), so keep those spots clear.
Outputs public/assets/rendered/scene_<name>.webp and public/assets/rendered/mg/<sprite>.webp
(+ mg/sprites.json with each sprite's anchor inside its image).
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
import mg_dress as dress  # noqa: E402
import props  # noqa: E402
import terrain  # noqa: E402
from lib import PX, board_to_world, col  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('what', choices=['yard', 'pond', 'relay', 'totem', 'tower', 'sprites', 'islets', 'fg'])
p.add_argument('--preview', action='store_true')
p.add_argument('--only', default='')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

SW, SH = 1920, 1080
OUT = os.path.join(lib.ROOT, 'art-out', 'mg')
PUB = os.path.join(lib.ROOT, 'public', 'assets', 'rendered')
os.makedirs(OUT, exist_ok=True)


# ------------------------------------------------------------------------------------------
# Shared helpers (as in scenes.py)
def set_view(elevation_deg: float) -> None:
    lib.BETA = math.radians(90 - elevation_deg)
    lib.COSB, lib.SINB = math.cos(lib.BETA), math.sin(lib.BETA)


def start(elev: float, samples: int = 28, sun_elev: float = 50, sun_az: float = -35, key: float = 3.5, fill: float = 0.8):
    set_view(elev)
    lib.reset(12 if A.preview else samples)
    dress.threads()
    dress.reset_mats()  # the factory reset removed any cached prop materials
    dress.festival_light(key=key, elev=sun_elev, az=sun_az, fill=fill, angle=3.0)
    return lib.camera_for_region(0, 0, SW, SH, scale=0.5 if A.preview else 1.0)


def ground_image_material(name: str, img_path: str, region, rough: float = 0.6, bump: float = 0.25):
    """Material projecting an image onto the ground plane over screen px `region` (x0,y0,x1,y1)."""
    x0, y0, x1, y1 = region
    m = lib.NT(name)
    pos = m.position()
    mp = m.node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (PX / (x1 - x0), lib.COSB * PX / (y1 - y0), 1.0)
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
    # contact AO plus a broad, cool sky occlusion under fences and hedges
    c = m.mult(c, m.mix(m.ao(0.5, 8), col('#6a6070'), col('#ffffff')))
    c = m.mult(c, m.mix(m.ao(1.2, 12), col('#8f8a9c'), col('#ffffff')))
    m.bsdf(c, rough, normal=m.bump(lum.outputs['Val'], bump, 0.02))
    return m.mat


def blob_outline(cx, cy, rx, ry, seed=1, lobes=7, wobble=0.12, n=96):
    r = random.Random(seed)
    ph = [r.uniform(0, math.tau) for _ in range(3)]
    pts = []
    for k in range(n):
        a = k / n * math.tau
        w = 1 + wobble * (math.sin(a * lobes / 2 + ph[0]) * 0.6 + math.sin(a * lobes + ph[1]) * 0.3 + math.sin(a * 3 + ph[2]) * 0.4)
        pts.append((cx + math.cos(a) * rx * w, cy + math.sin(a) * ry * w))
    return pts


def island(outline, name='arena_island', depth=1.0, extra_h=600, theme='plaza'):
    """Floating island whose top outline is `outline` (screen px polygon)."""
    # keep the outline inside the mask canvas: a mask touching the border leaves the island's
    # contour open and only part of the top gets built
    outline = [(min(max(x, 14), SW - 14), min(max(y, 14), SH + extra_h - 14)) for (x, y) in outline]
    img = Image.new('L', (SW // 4, (SH + extra_h) // 4), 0)
    ImageDraw.Draw(img).polygon([(x / 4, y / 4) for x, y in outline], fill=255)
    img = img.filter(ImageFilter.GaussianBlur(3))
    mask = np.asarray(img, np.float32) / 255.0 > 0.5
    terrain.set_canvas(SW, SH + extra_h, 4)
    mat = dress.island_material(dress.empty_mask(OUT), name=f'{name}_ground')
    return terrain.build_island(['a', 'b'] if depth >= 1 else ['a'], mask, name, mat)


def publish(path, name):
    if A.preview:
        return
    Image.open(path).convert('RGBA').save(os.path.join(PUB, f'scene_{name}.webp'), 'WEBP', quality=90, method=6)
    print('wrote', f'scene_{name}.webp')


def slab(region, name, floor_m, z=0.1, depth=0.55, side='#d8cbb8'):
    """Raised rectangular floor slab (screen px region) with stone sides."""
    x0, y0, x1, y1 = region
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    top = [tuple(board_to_world(x, y, 0.0)) for (x, y) in corners]
    top = [(v[0], v[1], z) for v in top]
    bot = [tuple(board_to_world(x, y, -depth)) for (x, y) in corners]
    lib.mesh_object(f'{name}_top', top, [(3, 2, 1, 0)], smooth=False, material=floor_m)
    sb = lib.MeshBuilder()
    sb.add(top + bot, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], col(side))
    sb.build(f'{name}_sides', props.mats()['stone'], smooth=False)


def noise_img(w, h, cell, amp=60):
    return np.asarray(Image.effect_noise((w // cell + 1, h // cell + 1), amp).resize((w, h), Image.BICUBIC), np.float32) / 255.0


def greenery(spots_trees, spots_bushes, seed=5, pine=(), willows=()):
    rnd = random.Random(seed)
    leaves, wood, flowers = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    for (x, y, s) in spots_trees:
        terrain.tree_round(leaves, wood, x, y, rnd, s)
    for (x, y, s) in pine:
        terrain.tree_pine(leaves, wood, x, y, rnd, s)
    for (x, y, s) in willows:
        dress.willow(leaves, wood, x, y, rnd, s)
    for (x, y, s) in spots_bushes:
        terrain.bush(leaves, x, y, rnd, s, berries=flowers)
    leaves.build('leaves', lib.attr_mat('leaf', rough=0.78, ao=0.5))
    wood.build('wood', lib.attr_mat('wood', rough=0.8, ao=0.3))
    flowers.build('flowers', lib.attr_mat('flower', rough=0.55))


def haze(cam, near_y, far_y=40.0, amount=0.2, color='#d9e8f7', skip=()):
    """Atmospheric perspective between two screen rows of the ground (near_y: the play area's back
    edge, which stays clean) - the far island, trees and the underside soften towards the sky."""
    near = dress.view_depth(cam, board_to_world(960, near_y, 0.0))
    far = dress.view_depth(cam, board_to_world(960, far_y, 0.0))
    dress.depth_haze(near, far, amount, color=color, skip=skip)


def scatter(outline, keep, rnd, tufts=2400, flowers=40, pebbles=30, shrink=24, region=(0, 0, SW, SH)):
    """Dense grass, flower beds and pebbles over the island top, clear of the play area and props."""
    dress.scatter_grass(dress.poly_mask(outline, SW, SH, shrink), keep, region, rnd, tufts=tufts, flowers=flowers, pebbles=pebbles)


# ------------------------------------------------------------------------------------------
# Crate Craze: festival supply yard
YARD = (240, 330, 1680, 1000)


def yard_texture(path, region, squash):
    """Packed-earth yard: damp and dusty patches, a lighter traffic-worn middle, cart ruts, crate drag
    marks and scuffs, half-buried flagstones, straw and pebbles, darker edges where the fences stand,
    and a paved border."""
    x0, y0, x1, y1 = region
    w, h = int(x1 - x0), int(y1 - y0)
    rnd = random.Random(12)
    base = np.array([176, 138, 96], np.float32)
    n1, n2, n3 = noise_img(w, h, 30, 70), noise_img(w, h, 7, 50), noise_img(w, h, 90, 80)
    arr = base[None, None, :] * (0.82 + 0.26 * n1[..., None]) * (0.93 + 0.1 * n2[..., None])
    damp = np.clip((n3 - 0.58) * 4, 0, 1)[..., None]
    arr = arr * (1 - 0.18 * damp) + np.array([120, 92, 66], np.float32) * 0.18 * damp
    dusty = np.clip((0.42 - n3) * 4, 0, 1)[..., None]
    arr = arr * (1 - 0.2 * dusty) + np.array([214, 184, 140], np.float32) * 0.2 * dusty
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    worn = np.exp(-(((xx - w / 2) / (w * 0.34)) ** 2 + ((yy - h / 2) / (h * 0.32)) ** 2))[..., None]
    arr = arr * (1 - 0.1 * worn) + np.array([206, 170, 124], np.float32) * 0.1 * worn
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    # cart ruts
    for (ya, yb) in [(0.3, 0.36), (0.66, 0.71)]:
        pts_a = [(x, h * ya + math.sin(x / 140) * 10) for x in range(0, w, 8)]
        pts_b = [(x, h * yb + math.sin(x / 160 + 1) * 8) for x in range(0, w, 8)]
        for pts in (pts_a, pts_b):
            d.line(pts, fill=(140, 104, 70), width=9, joint='curve')
            d.line([(x, y - 3) for (x, y) in pts], fill=(196, 160, 116), width=2)
    # drag marks where crates have been shoved about (short parallel pairs) and boot scuffs
    for _ in range(46):
        cx, cy = rnd.uniform(40, w - 40), rnd.uniform(30, h - 30)
        a = rnd.uniform(0, math.tau)
        L = rnd.uniform(40, 110)
        for off in (-20, 20):
            ox, oy = -math.sin(a) * off, math.cos(a) * off * squash
            d.line([(cx + ox, cy + oy), (cx + ox + math.cos(a) * L, cy + oy + math.sin(a) * L * squash)], fill=(150, 114, 80), width=3)
    for _ in range(160):
        cx, cy = rnd.uniform(0, w), rnd.uniform(0, h)
        r = rnd.uniform(6, 14)
        a0 = rnd.uniform(0, 360)
        d.arc([cx - r, cy - r * squash, cx + r, cy + r * squash], a0, a0 + rnd.uniform(60, 140), fill=(154, 118, 84), width=2)
    # worn flagstones half-buried in the earth (irregular, earthy tones)
    pal = [(170, 150, 122), (160, 140, 114), (178, 158, 130), (150, 132, 108)]
    for _ in range(14):
        cx, cy = rnd.uniform(60, w - 60), rnd.uniform(40, h - 40)
        for _k in range(rnd.randint(2, 5)):
            sx, sy = cx + rnd.uniform(-70, 70), cy + rnd.uniform(-45, 45) * squash
            r = rnd.uniform(18, 34)
            pts = [(sx + math.cos(a) * r * rnd.uniform(0.75, 1.15), sy + math.sin(a) * r * squash * rnd.uniform(0.75, 1.15)) for a in np.linspace(0, math.tau, 7, endpoint=False) + rnd.uniform(0, 1)]
            c = rnd.choice(pal)
            d.polygon([(x, y + 2) for (x, y) in pts], fill=tuple(int(v * 0.72) for v in c))
            d.polygon(pts, fill=c)
            d.line(pts[:3], fill=tuple(min(255, v + 18) for v in c), width=2)
    # straw wisps (thicker near the edges and corners, where it drifts) and pebbles
    for _ in range(1300):
        sx, sy = rnd.uniform(0, w), rnd.uniform(0, h)
        e = min(sx, w - sx, sy / squash, (h - sy) / squash)
        if e > 140 and rnd.random() < 0.45:
            continue
        a = rnd.uniform(0, math.tau)
        L = rnd.uniform(6, 16)
        d.line([(sx, sy), (sx + math.cos(a) * L, sy + math.sin(a) * L * squash)], fill=rnd.choice([(232, 200, 120), (214, 178, 96), (240, 214, 140)]), width=2)
    for _ in range(600):
        sx, sy = rnd.uniform(0, w), rnd.uniform(0, h)
        r = rnd.uniform(1.5, 3.5)
        d.ellipse([sx - r, sy - r * squash, sx + r, sy + r * squash], fill=rnd.choice([(150, 128, 104), (200, 186, 164), (120, 100, 80)]))
    # darker, damper earth along the fences (they shade it and nobody walks there)
    arr = np.asarray(im).astype(np.float32)
    e = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy) / squash)
    arr *= (0.8 + 0.2 * np.clip(e / 80.0, 0, 1) ** 0.7)[..., None]
    arr *= (0.9 + 0.1 * np.clip(yy / 120.0, 0, 1))[..., None]  # the back fence's shade
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    # paved border
    bw = 34
    for (bx0, by0, bx1, by1) in [(0, 0, w, int(bw * squash)), (0, h - int(bw * squash), w, h), (0, 0, bw, h), (w - bw, 0, w, h)]:
        d.rectangle([bx0, by0, bx1, by1], fill=(146, 128, 108))
    for k in range(0, w, 44):
        for (ya, yb) in [(0, int(bw * squash)), (h - int(bw * squash), h)]:
            c = rnd.choice([(198, 184, 160), (190, 176, 152), (206, 192, 168)])
            d.rounded_rectangle([k + 2, ya + 2, k + 42, yb - 2], radius=4, fill=c)
            d.line([(k + 5, ya + 4), (k + 38, ya + 4)], fill=tuple(min(255, v + 16) for v in c), width=2)
    for k in range(0, h, int(40 * squash)):
        for (xa, xb) in [(0, bw), (w - bw, w)]:
            c = rnd.choice([(198, 184, 160), (190, 176, 152), (206, 192, 168)])
            d.rounded_rectangle([xa + 2, k + 2, xb - 2, k + int(40 * squash) - 2], radius=4, fill=c)
    im.save(path)


def fence_run(mb_post, mb_rail, ax, ay, bx, by, h, z0=0.1, step=120):
    n = max(2, int(math.hypot(bx - ax, by - ay) / step))
    a = board_to_world(ax, ay, 0)
    b = board_to_world(bx, by, 0)
    for k in range(n + 1):
        t = k / n
        wp = a + (b - a) * t
        v, f = lib.box((wp.x, wp.y, z0 + h / 2 + 0.04), (0.13, 0.13, h + 0.08))
        mb_post.add(v, f, col('#7a5234'))
        v, f = lib.blob((wp.x, wp.y, z0 + h + 0.1), 0.07, rough=0.0, subdiv=2)
        mb_post.add(v, f, col('#e0a93f'))
    L = (b - a).length
    mid = (a + b) / 2
    ang = math.atan2(b.y - a.y, b.x - a.x)
    for zz in ([0.35, 0.8] if h > 0.3 else [0.7]):
        v, f = lib.box((mid.x, mid.y, z0 + h * zz), (L, 0.06, max(0.05, h * 0.18)), rot_z=ang)
        mb_rail.add(v, f, col('#a8744a'))


def big_crate(mb, x, y, z, s, rnd):
    v, f = lib.box((x, y, z + s / 2), (s, s, s), rot_z=rnd.uniform(-0.15, 0.15))
    mb.add(v, f, col(rnd.choice(['#c9a36a', '#b8915a', '#d2ad74'])))
    for zz in (0.18, 0.82):
        v, f = lib.box((x, y, z + s * zz), (s * 1.02, s * 1.02, s * 0.1))
        mb.add(v, f, col('#7a5234'))


def big_barrel(mb, x, y, z, s):
    v, f = lib.lathe([(0.26 * s, 0.0), (0.31 * s, 0.3 * s), (0.26 * s, 0.6 * s), (0.0, 0.6 * s)], 16, (x, y, z), cap_bottom=True)
    mb.add(v, f, col('#a8744a'))
    for zz in (0.08, 0.3, 0.52):
        v, f = lib.lathe([(0.3 * s + (0.03 if zz == 0.3 else 0.0) * s, zz * s - 0.02 * s), (0.3 * s + (0.03 if zz == 0.3 else 0.0) * s, zz * s + 0.02 * s)], 16, (x, y, z), cap_bottom=False, cap_top=False)
        mb.add(v, f, col('#6b6f7a'))


def supply_pile(x, y, rnd, mb_wood, mb_paint, n=5):
    """Stacked crates, barrels and sacks (screen px anchor), sized to read at arena scale."""
    for k in range(n):
        w = board_to_world(x + rnd.uniform(-80, 80), y + rnd.uniform(-16, 16), 0.0)
        kind = rnd.random()
        if kind < 0.5:
            s = rnd.uniform(0.5, 0.65)
            big_crate(mb_wood, w.x, w.y, 0.0, s, rnd)
            if rnd.random() < 0.5:
                big_crate(mb_wood, w.x + rnd.uniform(-0.08, 0.08), w.y, s, s * 0.8, rnd)
        elif kind < 0.8:
            big_barrel(mb_wood, w.x, w.y, 0.0, rnd.uniform(1.0, 1.25))
        else:
            v, f = lib.blob((w.x, w.y, 0.2), 0.26, squash=(1.0, 0.9, 0.8), rough=0.2, subdiv=2, seed=k)
            mb_paint.add(v, f, col(rnd.choice(['#d9c49a', '#cdb489', '#e2d2ac'])))


def yard():
    cam = start(48, sun_elev=52, sun_az=-35)
    squash = lib.COSB
    tex = os.path.join(OUT, 'yard_floor.png')
    yard_texture(tex, YARD, squash)
    slab(YARD, 'yard', ground_image_material('yard', tex, YARD, rough=0.8, bump=0.3))
    x0, y0, x1, y1 = YARD
    posts, rails = lib.MeshBuilder(), lib.MeshBuilder()
    posts_b, rails_b = lib.MeshBuilder(), lib.MeshBuilder()
    fence_run(posts_b, rails_b, x0, y0, x1, y0, 0.55)
    fence_run(posts, rails, x0, y0, x0, y1, 0.3)
    fence_run(posts, rails, x1, y0, x1, y1, 0.3)
    fence_run(posts, rails, x0, y1, x1, y1, 0.14)
    posts.build('fence_posts', props.mats()['wood'])
    rails.build('fence_rails', props.mats()['wood'])
    posts_b.build('fence_back_posts', props.mats()['wood'])
    rails_b.build('fence_back_rails', props.mats()['wood'])
    outline = blob_outline(960, 640, 960, 460, seed=31, lobes=8, wobble=0.05)
    island(outline)
    rnd = random.Random(9)
    wood, paint = lib.MeshBuilder(), lib.MeshBuilder()
    # supplies stacked behind the back fence (the spectators stand in the gaps: CrateCraze CROWD_X)
    # and beside the yard
    for (x, y) in [(330, 262), (600, 250), (1320, 250), (1590, 262)]:
        supply_pile(x, y, rnd, wood, paint, 5)
    for (x, y) in [(150, 470), (1770, 470)]:
        supply_pile(x, y, rnd, wood, paint, 3)
    hay = lib.MeshBuilder()
    for (x, y) in [(860, 262), (1060, 262), (190, 650), (1730, 650), (205, 890), (1715, 890)]:
        terrain.hay_bale(hay, x, y, rnd)
    wood.build('supplies', props.mats()['wood'])
    paint.build('sacks', lib.attr_mat('cloth', rough=0.9, sheen=0.3))
    hay.build('hay', lib.attr_mat('hay', rough=0.9))
    greenery([(70, 330, 1.1), (1850, 330, 1.1), (60, 980, 1.0), (1860, 980, 1.0)],
             [(300, 1040, 1.1), (960, 1050, 1.0), (1620, 1040, 1.1), (110, 700, 0.9), (1810, 700, 0.9), (640, 1045, 0.8), (1280, 1045, 0.8)],
             pine=[(210, 190, 0.9), (1710, 190, 0.9)])
    for x in (420, 960, 1500):
        props.lantern(x, 236, 1.2)
    props.bunting(690, 226, 520, 1.0)
    props.bunting(1230, 226, 520, 1.0)
    props.stall(110, 560, 0.95, stripe=('#ff6b5e', '#fff4dc'))
    props.stall(1810, 560, 0.95, stripe=('#8e5cd9', '#fff4dc'))
    # festival dressing around the yard: carts, fruit, balloons, flags and flower boxes
    dress.cart(92, 792, 0.85, load='barrels', name='cart_l')
    dress.cart(1782, 792, 0.85, load='crates', name='cart_r')
    for i, (x, y) in enumerate([(205, 610), (1715, 610), (470, 205), (1450, 205), (760, 212), (1160, 212)]):
        dress.fruit_crate(x, y, 0.9, name=f'fruit{i}')
    dress.balloons(40, 615, 1.1, name='balloons_l')
    dress.balloons(1880, 615, 1.1, name='balloons_r')
    for i, x in enumerate((228, 1692)):
        dress.flag_pole(x, 312, ['#8e5cd9', '#f4b83b'][i], s=1.0, height=1.9, side=1, name=f'flag{i}')
    for i, x in enumerate((470, 800, 1120, 1450)):
        dress.planter(x, 1036, w=1.3, s=0.9, name=f'planter{i}')
    keep = dress.Keep().rect(x0 - 16, y0 - 14, x1 + 16, y1 + 14)
    for (x, y) in [(330, 262), (600, 250), (1320, 250), (1590, 262), (150, 470), (1770, 470)]:
        keep.ell(x, y, 110, 40)
    for (x, y) in [(110, 560), (1810, 560), (92, 792), (1782, 792), (70, 330), (1850, 330), (60, 980), (1860, 980)]:
        keep.ell(x, y, 80, 36)
    scatter(outline, keep, random.Random(91), tufts=2600, flowers=34, pebbles=40)
    haze(cam, y0, 90, amount=0.18, skip=('yard',))
    path = os.path.join(OUT, 'yard.png')
    lib.render_to(path)
    publish(path, 'crate')
    # front layer: the back fence only (spectators stand behind it in-game). Only the fence's band of
    # the frame is rendered (the rest of the layer is empty anyway), which saves a second full render.
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH' and not ob.name.startswith('fence_back'):
            ob.is_holdout = True
    wall = os.path.join(OUT, 'yard_wall.png')
    lib.set_border((0, y0 - 100, SW, y0 + 30), (0, 0, SW, SH))
    bpy.context.scene.render.use_crop_to_border = False  # keep the full frame: the fence stays in place
    lib.render_to(wall)
    lib.clear_border()
    print('yard wall layer', Image.open(wall).size)
    publish(wall, 'crate_wall')


# ------------------------------------------------------------------------------------------
# Spiral Splash: lily pond
POND_C = (960, 640)
POND_R = (760, 360)


def pond_water_material():
    """Simple stream water (the Totem Tug creek)."""
    m = lib.NT('pondwater')
    pos = m.position()
    nz = m.noise(1.6, 3, 0.55, pos)
    nz2 = m.noise(7.0, 2, 0.5, pos)
    deep = m.mix(m.maprange(nz.outputs['Fac'], 0.3, 0.75), col('#1d8fb8'), col('#3fb8d8'))
    c = m.mix(m.maprange(nz2.outputs['Fac'], 0.64, 0.86), deep, col('#7fd6ee'))
    m.bsdf(c, 0.06, normal=m.bump(nz2.outputs['Fac'], 0.25, 0.03), emission=col('#2aa6d0'), emission_strength=0.18, coat=0.9)
    return m.mat


def pond_water_rich(cx, cy, wrx, wry):
    """Lily-pond water: turquoise shallows with sunlit caustics along the bank, deepening to a rich
    blue in the middle (which the game's animated current swirls read clearly against)."""
    m = lib.NT('pondwater_rich')
    pos = m.position()
    X, Y, _ = m.sep(pos)
    dx = m.math('DIVIDE', m.math('SUBTRACT', X, cx), wrx)
    dy = m.math('DIVIDE', m.math('SUBTRACT', Y, cy), wry)
    r = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', dx, dx), m.math('MULTIPLY', dy, dy)))
    shallow = m.maprange(r, 0.74, 0.99)
    nz = m.noise(1.6, 3, 0.55, pos)
    nz2 = m.noise(7.0, 2, 0.5, pos)
    deep = m.mix(m.maprange(nz.outputs['Fac'], 0.3, 0.75), col('#1680aa'), col('#2ea4cc'))
    deep = m.mix(m.maprange(r, 0.0, 0.6), m.mix(0.35, deep, col('#0f6a94')), deep)
    c = m.mix(m.maprange(nz2.outputs['Fac'], 0.64, 0.86), deep, col('#7fd6ee'))
    c = m.mix(m.math('MULTIPLY', shallow, 0.8), c, col('#56cfcf'))
    # faint caustics only in the shallows along the bank (the open water stays calm and readable)
    vor = m.node('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE')
    vor.inputs['Scale'].default_value = 2.2
    m.link(pos, vor.inputs['Vector'])
    caus = m.math('MULTIPLY', m.maprange(vor.outputs['Distance'], 0.028, 0.0), m.math('MULTIPLY', m.maprange(r, 0.84, 0.99), 0.45))
    c = m.mix(caus, c, col('#c9f6ff'))
    m.bsdf(c, 0.06, normal=m.bump(nz2.outputs['Fac'], 0.25, 0.03), emission=col('#2aa6d0'), emission_strength=0.16, coat=0.9)
    return m.mat


def waterfall_outcrop(rocks_mb, foam_mb, lip, foot, rnd):
    """A mossy boulder mound with a little cascade spilling into the pond (screen px lip/foot)."""
    (lx, ly), (fx, fy) = lip, foot
    for (dx, dy, r, z) in [(-40, -14, 0.46, 0.18), (40, -10, 0.42, 0.14), (-5, -34, 0.5, 0.42), (-62, 10, 0.34, 0.05), (58, 14, 0.3, 0.02),
                           (-28, -46, 0.36, 0.78), (26, -44, 0.33, 0.74), (0, 6, 0.24, 0.0)]:
        w = board_to_world(lx + dx, ly + dy, 0.0)
        v, f = lib.blob((w.x, w.y, z + r * 0.6), r, squash=(1.2, 1.0, 0.82), rough=0.24, freq=1.7, subdiv=3, seed=rnd.random() * 90)
        base = col(rnd.choice(['#a39a92', '#978d86', '#b4aca2']))
        rocks_mb.add(v, f, lambda q, base=base, zc=z + r * 0.6, r=r: lib.lerp_col(base, col('#5aa83a'), 0.8) if q[2] > zc + r * 0.45 else base)
    top = board_to_world(lx, ly, 0.0)
    bot = board_to_world(fx, fy, 0.0)
    z_lip = 1.02
    mat = lib.falls_material('pond_fall', z_lip, 0.02)
    verts, faces = [], []
    rows, cols = 16, 6
    for rr in range(rows + 1):
        t = rr / rows
        out = math.sqrt(t)
        px = top.x + (bot.x - top.x) * out
        py = top.y + (bot.y - top.y) * out
        pz = z_lip - (z_lip - 0.02) * t * t
        wd = 0.2 + 0.12 * t
        for i in range(cols + 1):
            u = i / cols * 2 - 1
            verts.append((px + u * wd, py - 0.05 * (1 - u * u), pz))
    for rr in range(rows):
        for i in range(cols):
            a = rr * (cols + 1) + i
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    lib.mesh_object('pond_waterfall', verts, faces, smooth=True, material=mat)
    for k in range(9):
        a = k / 9 * math.tau
        w = board_to_world(fx + math.cos(a) * rnd.uniform(14, 34), fy + 10 + math.sin(a) * rnd.uniform(6, 14), 0.0)
        v, f = lib.blob((w.x, w.y, 0.05), rnd.uniform(0.08, 0.14), squash=(1.4, 1.0, 0.35), rough=0.3, subdiv=1, seed=k * 3.1)
        foam_mb.add(v, f, col('#f4fbff'))


def pond():
    cam = start(40, sun_elev=50, sun_az=-30)
    cx, cy = POND_C
    rx, ry = POND_R
    outline = blob_outline(960, 620, 960, 470, seed=41, lobes=9, wobble=0.05)
    island(outline)
    c = board_to_world(cx, cy, 0.0)
    wrx, wry = rx / PX, ry / (PX * lib.COSB)
    # water surface (slightly above the grass so it covers it) and a sunken bank ring
    ring = [(1.0, 0.03), (0.0, 0.03)]
    v, f = lib.lathe([(r, z) for (r, z) in ring], 96, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    v = [(c.x + (vx - c.x) * wrx, c.y + (vy - c.y) * wry, vz) for (vx, vy, vz) in v]
    lib.mesh_object('water', v, f, smooth=False, material=pond_water_rich(c.x, c.y, wrx, wry))
    bank = lib.MeshBuilder()
    v, f = lib.lathe([(1.07, 0.04), (1.02, 0.05), (1.0, 0.035)], 96, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    v = [(c.x + (vx - c.x) * wrx, c.y + (vy - c.y) * wry, vz) for (vx, vy, vz) in v]
    bank.add(v, f, col('#b49a78'))
    bank.build('bank', props.mats()['stone'])
    rnd = random.Random(14)
    rocks, reeds = lib.MeshBuilder(), lib.MeshBuilder()
    for k in range(70):
        a = k / 70 * math.tau + rnd.uniform(-0.03, 0.03)
        bx, by = cx + math.cos(a) * rx * rnd.uniform(1.0, 1.06), cy + math.sin(a) * ry * rnd.uniform(1.0, 1.08)
        if math.sin(a) > 0.5 and k % 3:  # keep the near shore open
            continue
        terrain.rock(rocks, bx, by, rnd, rnd.uniform(0.35, 0.8))
    # pebble beaches just outside the bank, in a few coves
    for a0 in (0.3, 2.6, 3.9, 5.5):
        for _ in range(26):
            a = a0 + rnd.uniform(-0.2, 0.2)
            k = rnd.uniform(1.06, 1.14)
            terrain.rock(rocks, cx + math.cos(a) * rx * k, cy + math.sin(a) * ry * k, rnd, rnd.uniform(0.15, 0.3), moss=False)
    # reeds and cattails in clumps on the far and side shores
    for k in range(34):
        a = rnd.uniform(math.pi * 1.05, math.pi * 1.95) if k < 24 else rnd.choice([rnd.uniform(-0.35, 0.35), rnd.uniform(math.pi - 0.35, math.pi + 0.35)])
        bx, by = cx + math.cos(a) * rx * 1.03, cy + math.sin(a) * ry * 1.05
        if abs(bx - 610) < 70 and by < 360:  # leave the cascade clear
            continue
        w = board_to_world(bx, by, 0.02)
        for _j in range(rnd.randint(5, 10)):
            ox, oy = rnd.uniform(-0.25, 0.25), rnd.uniform(-0.15, 0.15)
            hgt = rnd.uniform(0.45, 0.95)
            lean = (rnd.uniform(-0.12, 0.12), rnd.uniform(-0.08, 0.08))
            v, f = lib.tube([(w.x + ox, w.y + oy, 0.0), (w.x + ox + lean[0], w.y + oy + lean[1], hgt)], 0.018, 5)
            reeds.add(v, f, col(rnd.choice(['#5f9e3a', '#6fb04a', '#4f8a30', '#7cbc52'])))
            if rnd.random() < 0.4:
                v, f = lib.cylinder((w.x + ox + lean[0], w.y + oy + lean[1], hgt - 0.12), 0.035, 0.035, 0.16, 8)
                reeds.add(v, f, col('#7a4a26'))
    # lotus flowers on the water near the shore (decor only, outside the play pads)
    petals = lib.MeshBuilder()
    for k in range(12):
        a = rnd.uniform(0, math.tau)
        bx, by = cx + math.cos(a) * rx * 0.94, cy + math.sin(a) * ry * 0.91
        w = board_to_world(bx, by, 0.04)
        for j in range(8):
            pa = j / 8 * math.tau
            v, f = lib.blob((w.x + math.cos(pa) * 0.07, w.y + math.sin(pa) * 0.07, 0.07), 0.06, squash=(1.0, 0.6, 0.5), rough=0.0, subdiv=1)
            petals.add(v, f, col('#ffc2dd' if j % 2 else '#ff9ecb'))
        v, f = lib.blob((w.x, w.y, 0.1), 0.04, rough=0.0, subdiv=1)
        petals.add(v, f, col('#ffd166'))
    foam = lib.MeshBuilder()
    # a mossy outcrop on the far-left shore with a cascade tumbling into the pond
    waterfall_outcrop(rocks, foam, (575, 262), (606, 326), rnd)
    rocks.build('rocks', props.mats()['stone'])
    reeds.build('reeds', lib.attr_mat('reed', rough=0.7))
    petals.build('lotus', lib.attr_mat('petal', rough=0.5, sheen=0.3))
    foam.build('foam', lib.attr_mat('foam', rough=0.6))
    # a little jetty on the far shore
    wood = lib.MeshBuilder()
    jx, jy = 960, cy - ry - 30
    for k in range(7):
        w = board_to_world(jx - 110 + k * 36, jy - 10, 0.12)
        v, f = lib.box((w.x, w.y, 0.12), (0.3, 1.1, 0.06))
        wood.add(v, f, col('#a8744a' if k % 2 else '#98663e'))
    for (dx, dy) in [(-120, -30), (120, -30), (-120, 20), (120, 20)]:
        w = board_to_world(jx + dx, jy + dy, 0.0)
        v, f = lib.cylinder((w.x, w.y, -0.2), 0.06, 0.06, 0.45, 8)
        wood.add(v, f, col('#6e4a2c'))
    wood.build('jetty', props.mats()['wood'])
    for (x, y) in [(360, 300), (1220, 262), (1560, 300)]:
        props.lantern(x, y, 1.15)
    for (x, y) in [(170, 640), (1750, 640), (820, 250), (1100, 250)]:
        dress.stone_lantern(x, y, 1.0, name=f'stone_lantern_{x}')
    greenery([(80, 960, 1.05), (1840, 960, 1.05), (1400, 230, 0.9)],
             [(300, 1030, 1.1), (1620, 1030, 1.1), (960, 1060, 1.0), (140, 520, 0.9), (1780, 520, 0.9), (700, 1050, 0.9), (1220, 1050, 0.9), (440, 250, 0.8)],
             willows=[(90, 300, 1.15), (1830, 300, 1.15)])
    dress.string_lights([(360 / PX + 0.26, -300 / (PX * lib.COSB), 1.47), (5.75, -242 / (PX * lib.COSB), 1.5)], sag=0.25, bulbs=8, name='lights_l')
    dress.string_lights([(12.46, -262 / (PX * lib.COSB), 1.47), (15.86, -300 / (PX * lib.COSB), 1.47)], sag=0.25, bulbs=8, name='lights_r')
    keep = dress.Keep().ell(cx, cy, rx * 1.1, ry * 1.12).ell(575, 250, 110, 60).ell(960, 250, 150, 40)
    for (x, y) in [(90, 300), (1830, 300), (80, 960), (1840, 960), (1400, 230), (170, 640), (1750, 640)]:
        keep.ell(x, y, 70, 32)
    scatter(outline, keep, random.Random(141), tufts=2600, flowers=40, pebbles=20)
    haze(cam, 230, 60, amount=0.16, skip=('pondwater_rich',))
    path = os.path.join(OUT, 'pond.png')
    lib.render_to(path)
    publish(path, 'pond')


# ------------------------------------------------------------------------------------------
# Relic Relay: four-lane obstacle course
LANES = [430, 570, 710, 850]
LANE_X = (170, 1750)


def relay_texture(path, region, squash):
    x0, y0, x1, y1 = region
    w, h = int(x1 - x0), int(y1 - y0)
    rnd = random.Random(21)
    n1, n2 = noise_img(w, h, 26, 70), noise_img(w, h, 6, 50)
    grass = np.array([104, 168, 72], np.float32)[None, None, :] * (0.85 + 0.25 * n1[..., None])
    dirt = np.array([196, 156, 108], np.float32)[None, None, :] * (0.86 + 0.2 * n1[..., None]) * (0.94 + 0.08 * n2[..., None])
    yy = np.arange(h, dtype=np.float32)[:, None] + y0
    lane_mask = np.zeros((h, w), np.float32)
    centre = np.zeros((h, w), np.float32)
    for ly in LANES:
        d = np.abs(yy - ly)
        lane_mask = np.maximum(lane_mask, np.clip((58 - d) / 6, 0, 1).repeat(w, axis=1))
        centre = np.maximum(centre, np.clip(1 - d / 34, 0, 1).repeat(w, axis=1))
    # the racing line down the middle of each lane is packed lighter by feet
    dirt = dirt * (1 - 0.1 * centre[..., None]) + np.array([220, 186, 140], np.float32) * 0.1 * centre[..., None]
    arr = grass * (1 - lane_mask[..., None]) + dirt * lane_mask[..., None]
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    # footprints / scuffs and pebbles in the lanes, clover in the grass
    for ly in LANES:
        cy = ly - y0
        for _ in range(260):
            sx = rnd.uniform(0, w)
            sy = cy + rnd.uniform(-44, 44)
            r = rnd.uniform(1.5, 3.2)
            d.ellipse([sx - r, sy - r * squash, sx + r, sy + r * squash], fill=rnd.choice([(160, 124, 86), (214, 184, 140), (140, 110, 80)]))
        for _ in range(70):  # little boot prints along the racing line
            sx = rnd.uniform(0, w)
            sy = cy + rnd.gauss(0, 12)
            d.ellipse([sx - 5, sy - 2.2, sx + 5, sy + 2.2], fill=(170, 132, 94))
        # faded painted chevrons pointing down the course, just after the start and before the goal
        for gx in (LANE_X[0] - x0 + 110, LANE_X[0] - x0 + 160, LANE_X[1] - x0 - 160, LANE_X[1] - x0 - 110):
            pts = [(gx - 14, cy - 26), (gx + 12, cy), (gx - 14, cy + 26), (gx - 26, cy + 26), (gx, cy), (gx - 26, cy - 26)]
            d.polygon(pts, fill=(216, 190, 150))
        # lane edge stones
        for sx in range(0, w, 34):
            for sgn in (-1, 1):
                sy = cy + sgn * 57
                d.rounded_rectangle([sx + 2, sy - 6, sx + 30, sy + 6], radius=4, fill=(206, 196, 178))
                d.rounded_rectangle([sx + 2, sy - 6, sx + 30, sy - 2], radius=3, fill=(232, 224, 208))
    # start and goal lines (checkered)
    for gx in (LANE_X[0] - x0, LANE_X[1] - x0):
        for ly in LANES:
            cy = ly - y0
            for k in range(-5, 5):
                for j in range(2):
                    fill = (250, 246, 236) if (k + j) % 2 == 0 else (40, 40, 52)
                    d.rectangle([gx - 12 + j * 12, cy + k * 11, gx + j * 12, cy + k * 11 + 11], fill=fill)
    im.save(path)


def relic_shrine(bx, by, s=1.0):
    """The goal's relic shrine: stepped stone plinth, a column and a big glowing crystal in a gold crown."""
    P = props.Prop('shrine')
    p = board_to_world(bx, by, 0.0)
    x, y = p.x, p.y
    v, f = lib.lathe([(0.62 * s, 0.0), (0.62 * s, 0.14 * s), (0.5 * s, 0.14 * s), (0.5 * s, 0.26 * s), (0.36 * s, 0.26 * s), (0.28 * s, 0.34 * s),
                      (0.26 * s, 0.98 * s), (0.34 * s, 1.06 * s), (0.34 * s, 1.14 * s), (0.0, 1.14 * s)], 16, (x, y, 0))
    P.b['stone'].add(v, f, col('#efe5d8'))
    for k in range(6):
        a = k / 6 * math.tau
        v, f = lib.box((x + math.cos(a) * 0.27 * s, y + math.sin(a) * 0.27 * s, 0.66 * s), (0.05 * s, 0.05 * s, 0.5 * s), rot_z=a)
        P.b['glow'].add(v, f, col('#5ce1ff'))
    for k in range(8):
        a = k / 8 * math.tau
        v, f = lib.prism((x + math.cos(a) * 0.3 * s, y + math.sin(a) * 0.3 * s, 1.12 * s), 0.05 * s, 0.22 * s, tilt=(math.sin(a) * 0.5, math.cos(a) * 0.5))
        P.b['metal'].add(v, f, col('#f2c14e'))
    v, f = lib.prism((x, y, 1.12 * s), 0.2 * s, 0.95 * s, sides=6, tip=0.35, twist=0.3)
    P.b['crystal'].add(v, f, col('#8ff0ff'))
    for k in range(3):
        a = k / 3 * math.tau + 0.4
        v, f = lib.prism((x + math.cos(a) * 0.14 * s, y + math.sin(a) * 0.14 * s, 1.1 * s), 0.08 * s, 0.45 * s, tilt=(math.sin(a) * 0.4, math.cos(a) * 0.4))
        P.b['crystal'].add(v, f, col('#5ce1ff'))
    return P.build()


def relay():
    cam = start(45, sun_elev=50, sun_az=-35)
    squash = lib.COSB
    region = (60, 350, 1860, 930)
    tex = os.path.join(OUT, 'relay_floor.png')
    relay_texture(tex, region, squash)
    slab(region, 'course', ground_image_material('course', tex, region, rough=0.8, bump=0.25), z=0.06, side='#c9bba5')
    rnd = random.Random(22)
    leaves, blossoms = lib.MeshBuilder(), lib.MeshBuilder()
    # low clipped hedges between lanes (kept low so they never hide runners), dotted with blossom
    for hy in [(LANES[i] + LANES[i + 1]) / 2 for i in range(3)]:
        a = board_to_world(region[0] + 30, hy, 0.0)
        b = board_to_world(region[2] - 30, hy, 0.0)
        n = 34
        for k in range(n + 1):
            t = k / n
            wp = a + (b - a) * t
            v, f = lib.blob((wp.x, wp.y, 0.16), 0.2, squash=(1.3, 0.8, 0.7), rough=0.3, subdiv=2, seed=k)
            leaves.add(v, f, col(rnd.choice(['#4f9a3a', '#5aa944', '#468c33'])))
            for _ in range(3):
                q = (wp.x + rnd.uniform(-0.2, 0.2), wp.y + rnd.uniform(-0.1, 0.1), 0.27 + rnd.uniform(-0.02, 0.03))
                bv, bf = lib.blob(q, 0.03, rough=0.0, subdiv=1)
                blossoms.add(bv, bf, col(rnd.choice(['#ffffff', '#ffd6e8', '#fff3a8'])))
    leaves.build('hedges', lib.attr_mat('leaf', rough=0.8, ao=0.5))
    blossoms.build('hedge_blossom', lib.attr_mat('blossom', rough=0.55))
    posts, rails = lib.MeshBuilder(), lib.MeshBuilder()
    fence_run(posts, rails, region[0], region[1], region[2], region[1], 0.45, z0=0.06)
    fence_run(posts, rails, region[0], region[3], region[2], region[3], 0.12, z0=0.06)
    posts.build('fence_posts', props.mats()['wood'])
    rails.build('fence_rails', props.mats()['wood'])
    # start and goal pylons with flags at the far end of each line, short bollards at the near end
    metal, cloth = lib.MeshBuilder(), lib.MeshBuilder()
    for gx, colr in [(LANE_X[0], '#1fa5a0'), (LANE_X[1], '#ff6b5e')]:
        wtop = board_to_world(gx, region[1] - 12, 0.0)
        v, f = lib.cylinder((wtop.x, wtop.y, 0.0), 0.07, 0.06, 2.4, 10)
        metal.add(v, f, col('#e0a93f'))
        flag = [(0.0, 2.35), (1.1, 2.18), (0.0, 1.9)]
        v = [(wtop.x + fx, wtop.y, fz) for (fx, fz) in flag] + [(wtop.x + fx, wtop.y + 0.02, fz) for (fx, fz) in flag]
        cloth.add(v, [(0, 1, 2), (5, 4, 3)], col(colr))
        wb = board_to_world(gx, region[3] + 8, 0.0)
        v, f = lib.cylinder((wb.x, wb.y, 0.0), 0.08, 0.08, 0.28, 10)
        metal.add(v, f, col('#e0a93f'))
    metal.build('pylons', props.mats()['metal'])
    cloth.build('flags', lib.attr_mat('cloth', rough=0.8, sheen=0.4))
    outline = blob_outline(960, 640, 980, 440, seed=51, lobes=8, wobble=0.05)
    island(outline)
    for x in (380, 760, 1160, 1540):
        props.lantern(x, 300, 1.15)
    props.bunting(570, 292, 360, 1.0)
    props.bunting(1350, 292, 360, 1.0)
    greenery([(60, 600, 1.0), (1860, 600, 1.0), (70, 990, 1.0), (1850, 990, 1.0), (300, 250, 1.0), (1620, 250, 1.0), (960, 240, 0.9)],
             [(320, 1030, 1.0), (960, 1040, 1.0), (1600, 1030, 1.0), (40, 400, 0.9), (1880, 400, 0.9), (640, 1040, 0.8), (1280, 1040, 0.8)],
             pine=[(470, 205, 0.85), (1450, 205, 0.85)])
    # the start tent, the goal's relic shrine, flags in the crowd's gaps, balloons and flower boxes
    dress.tent(100, 250, s=0.85, c1='#1fa5a0', c2='#fff4dc', name='start_tent')
    relic_shrine(1808, 300, 1.0)
    dress.banner_post(1748, 272, '#ff6b5e', s=0.9, shape=None, name='goal_banner_a')
    dress.banner_post(1868, 272, '#f4b83b', s=0.9, shape=None, name='goal_banner_b')
    for i, x in enumerate((555, 960, 1372)):
        dress.flag_pole(x, 330, ['#8e5cd9', '#f4b83b', '#5ce1ff'][i], s=1.0, height=1.8, side=1, name=f'crowd_flag{i}')
    dress.balloons(212, 318, 1.0, name='balloons_start')
    dress.balloons(1690, 318, 1.0, colors=['#ff6b5e', '#f4b83b', '#ffffff', '#ff9ecb'], name='balloons_goal')
    for i, x in enumerate((250, 1670)):
        dress.planter(x, 962, w=1.4, s=0.9, name=f'planter{i}')
    keep = dress.Keep().rect(region[0] - 12, region[1] - 14, region[2] + 12, region[3] + 16)
    for (x, y) in [(112, 262), (1808, 300), (300, 250), (1620, 250), (960, 240), (60, 600), (1860, 600), (70, 990), (1850, 990)]:
        keep.ell(x, y, 80, 34)
    scatter(outline, keep, random.Random(221), tufts=2400, flowers=36, pebbles=30)
    haze(cam, region[1], 80, amount=0.16, skip=('course',))
    path = os.path.join(OUT, 'relay.png')
    lib.render_to(path)
    publish(path, 'relay')


# ------------------------------------------------------------------------------------------
# Totem Tug: side-view festival clearing
def totem():
    cam = start(12, sun_elev=38, sun_az=-40)
    rnd = random.Random(31)
    # ground: a wide island whose far edge sits well above the players' line (y 820)
    outline = blob_outline(960, 800, 1150, 250, seed=61, lobes=7, wobble=0.04)
    island(outline, extra_h=900)
    # a creek running away from the camera under the middle of the rope
    water = lib.MeshBuilder()
    pts = []
    for k in range(24):
        t = k / 23
        by = 1080 - t * 520
        bx = 960 + math.sin(t * 5.0) * 22 * (1 - t * 0.5)
        pts.append((bx, by, 60 - t * 34))
    verts, faces = [], []
    for (bx, by, hw) in pts:
        a = board_to_world(bx - hw, by, 0.03)
        b = board_to_world(bx + hw, by, 0.03)
        verts += [tuple(a), tuple(b)]
    for k in range(len(pts) - 1):
        i = k * 2
        faces.append((i, i + 1, i + 3, i + 2))
    water.add(verts, faces, col('#5fc6e6'))
    water.build('creek', pond_water_material())
    rocks, foam = lib.MeshBuilder(), lib.MeshBuilder()
    for (bx, by, hw) in pts[::2]:
        for sgn in (-1, 1):
            terrain.rock(rocks, bx + sgn * (hw + 8), by, rnd, rnd.uniform(0.3, 0.6))
            w = board_to_world(bx + sgn * (hw - 6), by, 0.035)
            v, f = lib.blob((w.x, w.y, 0.035), 0.12, squash=(1.4, 1.0, 0.25), rough=0.3, subdiv=1, seed=by)
            foam.add(v, f, col('#f4fbff'))
    for _ in range(40):  # more pebbles along both banks
        (bx, by, hw) = pts[rnd.randint(0, len(pts) - 1)]
        sgn = rnd.choice((-1, 1))
        terrain.rock(rocks, bx + sgn * (hw + rnd.uniform(10, 40)), by + rnd.uniform(-8, 8), rnd, rnd.uniform(0.15, 0.32), moss=False)
    rocks.build('rocks', props.mats()['stone'])
    foam.build('foam', lib.attr_mat('foam', rough=0.6))
    flowers, fl_leaves, tufts, shrooms = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    for _ in range(170):
        fx, fy = rnd.uniform(80, 1840), rnd.uniform(860, 1070)
        if abs(fx - 960) < 110:
            continue
        terrain.flower_bed(flowers, fl_leaves, fx, fy, rnd) if rnd.random() < 0.35 else terrain.grass_tuft(tufts, fx, fy, rnd, rnd.uniform(1.0, 1.6))
    for _ in range(2000):
        fx, fy = rnd.uniform(60, 1860), rnd.uniform(826, 1075)
        if abs(fx - 960) < 95:
            continue
        terrain.grass_tuft(tufts, fx, fy, rnd, rnd.uniform(0.9, 1.6))
    for (fx, fy, s_) in [(150, 905, 0.9), (330, 960, 0.8), (1590, 960, 0.8), (1770, 905, 0.9), (480, 1010, 0.7), (1440, 1010, 0.7)]:
        terrain.bush(fl_leaves, fx, fy, rnd, s_, berries=flowers)
    for _ in range(420):
        fx, fy = rnd.uniform(80, 1840), rnd.uniform(600, 815)
        if abs(fx - 960) < 90:
            continue
        terrain.grass_tuft(tufts, fx, fy, rnd, rnd.uniform(0.8, 1.3))
    for (fx, fy) in [(240, 1000), (640, 1040), (1290, 1030), (1700, 990), (470, 930), (1480, 940)]:
        terrain.mushroom_cluster(shrooms, fx, fy, rnd)
    flowers.build('field_flowers', lib.attr_mat('flower', rough=0.55, subsurface=0.25))
    fl_leaves.build('field_leaves', lib.attr_mat('leaf', rough=0.78, ao=0.5))
    tufts.build('field_grass', lib.attr_mat('grass', rough=0.8, sheen=0.15, ao=0.3))
    shrooms.build('shrooms', lib.attr_mat('shroom', rough=0.6))
    # team posts with banners at the win lines (a little behind the players' line)
    metal, cloth = lib.MeshBuilder(), lib.MeshBuilder()
    for gx, colr in [(540, '#22c3d6'), (1380, '#ff6b5e')]:
        w = board_to_world(gx, 770, 0.0)
        v, f = lib.cylinder((w.x, w.y, 0.0), 0.08, 0.07, 2.6, 10)
        metal.add(v, f, col('#e0a93f'))
        v, f = lib.blob((w.x, w.y, 2.66), 0.12, rough=0.0, subdiv=2)
        metal.add(v, f, col('#f2c14e'))
        ban = [(-0.5, 2.45), (0.5, 2.45), (0.5, 1.35), (0.0, 1.1), (-0.5, 1.35)]
        v = [(w.x + bx, w.y - 0.1, bz) for (bx, bz) in ban] + [(w.x + bx, w.y - 0.08, bz) for (bx, bz) in ban]
        cloth.add(v, [(0, 1, 2, 3, 4), (9, 8, 7, 6, 5)], col(colr))
    metal.build('posts', props.mats()['metal'])
    cloth.build('banners', lib.attr_mat('cloth', rough=0.8, sheen=0.4))
    # a big carved spiral totem at the back centre, stalls, lanterns, trees and bunting
    P = props.Prop('totem_pole')
    w = board_to_world(960, 610, 0.0)
    for k in range(5):
        z = k * 0.62
        v, f = lib.cylinder((w.x, w.y, z), 0.42 - k * 0.02, 0.4 - k * 0.02, 0.6, 16)
        P.b['wood'].add(v, f, col(['#b07a45', '#9a643a', '#c08850', '#a06a3e', '#b88048'][k]))
        v, f = lib.lathe([(0.44 - k * 0.02, z + 0.56), (0.46 - k * 0.02, z + 0.6), (0.44 - k * 0.02, z + 0.64)], 16, (w.x, w.y, 0.0), cap_bottom=False, cap_top=False)
        P.b['paint'].add(v, f, col(['#1fa5a0', '#ff6b5e', '#f2c14e', '#8e5cd9', '#1fa5a0'][k]))
        for j in range(3):  # spiral eyes/glyphs facing the camera
            v, f = lib.blob((w.x - 0.18 + j * 0.18, w.y - 0.38 + k * 0.004, z + 0.3), 0.07, squash=(1.0, 0.4, 1.0), rough=0.0, subdiv=1)
            P.b['glow' if j == 1 else 'paint'].add(v, f, col('#5ce1ff' if j == 1 else '#fff4dc'))
    for side in (-1, 1):
        wing = [(0.0, 2.6), (1.1 * side, 3.0), (1.3 * side, 2.7), (0.4 * side, 2.3)]
        v = [(w.x + bx, w.y - 0.05, bz) for (bx, bz) in wing] + [(w.x + bx, w.y + 0.05, bz) for (bx, bz) in wing]
        P.b['paint'].add(v, [(0, 1, 2, 3), (7, 6, 5, 4)] if side > 0 else [(3, 2, 1, 0), (4, 5, 6, 7)], col('#f2c14e'))
    P.build()
    props.stall(300, 640, 1.0, stripe=('#1fa5a0', '#fff4dc'))
    props.stall(1620, 640, 1.0, stripe=('#ff6b5e', '#fff4dc'))
    for x in (170, 720, 1200, 1750):
        props.lantern(x, 680, 1.2)
    props.bunting(600, 640, 420, 1.0)
    props.bunting(1320, 640, 420, 1.0)
    greenery([(90, 600, 1.2), (1830, 600, 1.2), (640, 575, 0.95), (1280, 575, 0.95), (230, 570, 0.9), (1690, 570, 0.9)],
             [(60, 1000, 1.2), (400, 1050, 1.1), (1520, 1050, 1.1), (1860, 1000, 1.2), (700, 1060, 0.9), (1220, 1060, 0.9)],
             pine=[(820, 580, 1.0), (1100, 580, 1.0), (380, 565, 0.85), (1540, 565, 0.85)])
    # each team's end of the clearing: a tent and flags in its colour (TIDE cyan left, EMBER coral right)
    dress.tent(470, 600, s=1.05, c1='#22c3d6', c2='#fff4dc', name='tent_tide')
    dress.tent(1450, 600, s=1.05, c1='#ff6b5e', c2='#fff4dc', name='tent_ember')
    for i, (x, colr) in enumerate([(128, '#22c3d6'), (402, '#22c3d6'), (1518, '#ff6b5e'), (1792, '#ff6b5e')]):
        dress.flag_pole(x, 712, colr, s=1.0, height=2.1, side=1, name=f'team_flag{i}')
    # (the centre stays clear: the game draws the beat ring round the totem's head there)
    dress.balloons(388, 668, 1.0, colors=['#22c3d6', '#fff4dc', '#5ce1ff'], name='balloons_tide')
    dress.balloons(1532, 668, 1.0, colors=['#ff6b5e', '#fff4dc', '#f4b83b'], name='balloons_ember')
    dress.string_lights([(1.7 + 0.31, -680 / (PX * lib.COSB), 1.78), (6.9, -640 / (PX * lib.COSB), 2.2)], sag=0.35, bulbs=9, name='lights_l')
    dress.string_lights([(13.3, -640 / (PX * lib.COSB), 2.2), (17.5 + 0.31, -680 / (PX * lib.COSB), 1.78)], sag=0.35, bulbs=9, name='lights_r')
    # a little plank footbridge over the creek in the foreground
    dress.footbridge(893, 965, 1060, 965, width=0.9, rise=0.3)
    haze(cam, 700, 560, amount=0.22, skip=('pondwater',))
    path = os.path.join(OUT, 'totem.png')
    lib.render_to(path)
    publish(path, 'totem')

# ------------------------------------------------------------------------------------------
# Tumble Tower: vertically tileable tower wall (level camera)
def level_camera(cx, cz, w_units, h_px, scale):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.sensor_fit = 'HORIZONTAL'
    cd.ortho_scale = w_units
    cd.clip_start = 0.1
    cd.clip_end = 400.0
    ob = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(ob)
    sc.camera = ob
    ob.location = (cx, -120.0, cz)
    ob.rotation_euler = (math.pi / 2, 0.0, 0.0)
    sc.render.resolution_x = int(round(w_units * PX * scale))
    sc.render.resolution_y = int(round(h_px * scale))
    sc.render.resolution_percentage = 100
    return ob


def tower_stone_material(period: float):
    """Tower masonry: two-tone bricks with random darker ones, rain streaks, moss creeping up from
    each ledge and mortar shading. Every pattern repeats exactly every `period` units up the wall
    (noise is sampled on a loop), so the tile stays seamless."""
    m = lib.NT('tower_stone2')
    pos = m.position()
    sx, sy, sz = m.sep(pos)
    u = m.math('ADD', sx, m.math('MULTIPLY', sy, 0.8))  # across the wall, as props.stone_material
    comb = m.node('ShaderNodeCombineXYZ')
    m.link(u, comb.inputs['X'])
    m.link(sz, comb.inputs['Y'])
    br = m.node('ShaderNodeTexBrick')
    br.inputs['Scale'].default_value = 1.25  # courses 0.2 units apart: 54 to the period
    br.inputs['Mortar Size'].default_value = 0.025
    br.inputs['Color1'].default_value = col('#fff6ea')
    br.inputs['Color2'].default_value = col('#e4d8c4')
    br.inputs['Mortar'].default_value = col('#958676')
    m.link(comb.outputs['Vector'], br.inputs['Vector'])
    br2 = m.node('ShaderNodeTexBrick')  # a second pass picks out random darker, older bricks
    br2.inputs['Scale'].default_value = 1.25
    br2.inputs['Mortar Size'].default_value = 0.0
    br2.inputs['Bias'].default_value = 0.72
    br2.inputs['Color1'].default_value = col('#ffffff')
    br2.inputs['Color2'].default_value = col('#d6c6b2')  # subtle: brick hashes don't repeat, the seam blend softens them
    m.link(comb.outputs['Vector'], br2.inputs['Vector'])
    # looped coordinates for seamless noise: (u, cos, sin) of the height around the period
    th = m.math('MULTIPLY', sz, math.tau / period)
    rr = period / math.tau
    loop = m.node('ShaderNodeCombineXYZ')
    m.link(u, loop.inputs['X'])
    m.link(m.math('MULTIPLY', m.math('COSINE', th), rr), loop.inputs['Y'])
    m.link(m.math('MULTIPLY', m.math('SINE', th), rr), loop.inputs['Z'])
    lv = loop.outputs['Vector']
    c = m.mult(br.outputs['Color'], br2.outputs['Color'])
    n = m.noise(3.0, 4, 0.6, lv)
    c = m.mult(c, m.mix(n.outputs['Fac'], col('#d6cbbd'), col('#ffffff')))
    streak_v = m.node('ShaderNodeMapping')
    streak_v.inputs['Scale'].default_value = (9.0, 0.7, 0.7)
    m.link(lv, streak_v.inputs['Vector'])
    st = m.noise(1.0, 3, 0.55, streak_v.outputs['Vector'])
    c = m.mult(c, m.mix(m.maprange(st.outputs['Fac'], 0.6, 0.78), col('#ffffff'), col('#cdc3b6')))
    # moss just above each ledge band (bands every half period)
    frac = m.math('FRACT', m.math('DIVIDE', sz, period / 2))
    moss = m.math('MULTIPLY', m.maprange(frac, 0.14, 0.02), m.maprange(m.noise(1.6, 3, 0.6, lv).outputs['Fac'], 0.42, 0.6))
    c = m.mix(m.math('MULTIPLY', moss, 0.75), c, col('#6f9b45'))
    c = m.mult(c, m.mix(m.ao(0.5, 8), col('#6d6272'), col('#ffffff')))
    m.bsdf(c, 0.82, normal=m.bump(br.outputs['Fac'], 0.3, 0.02))
    return m.mat


def tower():
    lib.reset(12 if A.preview else 28)
    dress.threads()
    dress.reset_mats()
    dress.festival_light(key=3.2, elev=35, az=-50, fill=0.9, angle=3.0)
    scale = 0.5 if A.preview else 1.0
    M = 140  # seam blend margin (px)
    H = SH + 2 * M
    level_camera(9.6, 0.0, 19.2, H, scale)
    R = 6.8
    top, bot = H / 2 / PX + 0.5, -H / 2 / PX - 0.5
    # tower body: a cylinder facing the camera (the back half is never seen)
    stone = lib.MeshBuilder()
    v, f = lib.cylinder((9.6, 0.0, bot), R, R, top - bot, 96, cap=False)
    stone.add(v, f, col('#e8dcc8'))
    stone.build('tower', tower_stone_material(SH / PX))
    # ledge bands every half period
    trim = lib.MeshBuilder()
    for zb in [-SH / 2 / PX, 0.0, SH / 2 / PX]:
        v, f = lib.lathe([(R + 0.02, zb - 0.1), (R + 0.16, zb - 0.06), (R + 0.16, zb + 0.06), (R + 0.02, zb + 0.1)], 96, (9.6, 0.0, 0.0), cap_bottom=False, cap_top=False)
        trim.add(v, f, col('#d4c4aa'))
    trim.build('trim', props.mats()['stone_big'])
    # Decoration stays within z -5.4..4.0 (the tile below the seam band) or repeats exactly one period
    # apart, so tiling stays clean; nothing sticks out like a ledge a climber might try to land on.
    glow, wood, leaves, paint, metal, blossom = (lib.MeshBuilder() for _ in range(6))
    rnd = random.Random(71)

    def on_wall(ax, out=0.0):
        """World (x, y) on the drum's face at `ax` across from the centre (plus `out` in front)."""
        ang = math.asin(max(-0.95, min(0.95, ax / R)))
        return 9.6 + ax, -math.cos(ang) * (R + out)

    def arch(wx, yy, az, hw, hh):
        pts = [(wx - hw, az - hh / 2), (wx + hw, az - hh / 2), (wx + hw, az + hh / 2 - hw)]
        for k in range(1, 9):
            t = k / 9 * math.pi
            pts.append((wx + math.cos(t) * hw, az + hh / 2 - hw + math.sin(t) * hw))
        pts.append((wx - hw, az + hh / 2 - hw))
        return [(px, yy, pz) for (px, pz) in pts]
    wins = [(-3.2, 2.7), (2.4, 2.9), (-0.4, 0.9 - 0.2), (3.9, -1.3), (-3.9, -1.6), (0.9, -3.1)]
    for i, (ax, az) in enumerate(wins):
        wx, yy = on_wall(ax)
        v = arch(wx, yy - 0.05, az, 0.46, 1.25)
        wood.add(v, [tuple(range(len(v) - 1, -1, -1))], col('#4a3326'))
        v = arch(wx, yy - 0.07, az, 0.36, 1.05)
        glow.add(v, [tuple(range(len(v) - 1, -1, -1))], col('#ffcf72'))
        # leaded glazing bars, a keystone and open shutters flat against the wall
        v, f = lib.box((wx, yy - 0.085, az - 0.05), (0.035, 0.02, 0.98))
        wood.add(v, f, col('#3a2a20'))
        v, f = lib.box((wx, yy - 0.085, az - 0.02), (0.72, 0.02, 0.035))
        wood.add(v, f, col('#3a2a20'))
        v, f = lib.box((wx, yy - 0.08, az + 0.64), (0.2, 0.06, 0.18))
        paint.add(v, f, col('#efe2cc'))
        sh = ['#1fa5a0', '#e8604f', '#8e5cd9'][i % 3]
        for sgn in (-1, 1):
            # each shutter sits on the curve of the drum, turned to its tangent
            axs = ax + sgn * 0.66
            sxw, syw = on_wall(axs, 0.03)
            rz = math.asin(max(-0.95, min(0.95, axs / R)))
            v, f = lib.box((sxw, syw, az - 0.08), (0.34, 0.03, 1.0), rot_z=rz)
            paint.add(v, f, col(sh))
            for zz in (-0.35, 0.2):
                v, f = lib.box((sxw, syw - 0.02, az + zz), (0.3, 0.02, 0.03), rot_z=rz)
                paint.add(v, f, lib.lerp_col(col(sh), col('#1a1a1a'), 0.35))
        v, f = lib.box((wx, yy - 0.12, az - 0.66), (1.1, 0.25, 0.1))
        wood.add(v, f, col('#8a5a34'))
    # a round stained-glass window high in the middle of each tile
    rwx, ryy = on_wall(-0.4)
    rz = 2.9
    segs = 12
    for k in range(segs):
        a0, a1 = k / segs * math.tau, (k + 1) / segs * math.tau
        v = [(rwx, ryy - 0.07, rz)] + [(rwx + math.cos(a) * 0.5, ryy - 0.07, rz + math.sin(a) * 0.5) for a in np.linspace(a0, a1, 4)]
        glow.add(v, [(0, 3, 2, 1), (0, 4, 3)], col(['#5ce1ff', '#ffd27a', '#ff8f7a', '#9f7cf0'][k % 4]))
    ring = [(rwx + math.cos(t / 40 * math.tau) * 0.55, ryy - 0.09, rz + math.sin(t / 40 * math.tau) * 0.55) for t in range(41)]
    v, f = lib.tube(ring, 0.07, 8)
    paint.add(v, f, col('#efe2cc'))
    for k in range(segs):
        a = k / segs * math.tau
        v, f = lib.tube([(rwx + math.cos(a) * 0.1, ryy - 0.09, rz + math.sin(a) * 0.1), (rwx + math.cos(a) * 0.5, ryy - 0.09, rz + math.sin(a) * 0.5)], 0.018, 4)
        wood.add(v, f, col('#3a2a20'))
    v, f = lib.blob((rwx, ryy - 0.1, rz), 0.1, squash=(1, 0.4, 1), rough=0.0, subdiv=2)
    metal.add(v, f, col('#f2c14e'))
    # long festival banners hanging from the middle ledge band
    for (ax, c1, c2) in [(-2.1, '#1fa5a0', '#f2c14e'), (2.6, '#e8604f', '#fff4dc')]:
        wx, yy = on_wall(ax, 0.02)
        W, top, bot_ = 0.62, -0.14, -2.45
        dress.cloth_panel(paint, [(-W / 2, top), (W / 2, top), (W / 2, bot_), (0.0, bot_ + 0.3), (-W / 2, bot_)], (wx, yy - 0.03, 0.0), c1, 0.01)
        dress.cloth_panel(paint, [(-W / 2 + 0.06, top - 0.3), (W / 2 - 0.06, top - 0.3), (W / 2 - 0.06, top - 0.38), (-W / 2 + 0.06, top - 0.38)], (wx, yy - 0.045, 0.0), c2, 0.004)
        dress.flat_poly(paint, dress.shape_pts('diamond', 0.16), (wx, yy - 0.05, -1.2), c2)
        v, f = lib.cylinder((0, 0, 0), 0.03, 0.03, W + 0.16, 8)
        v = lib.transform(v, loc=(wx - W / 2 - 0.08, yy - 0.05, top), rot=(0.0, math.pi / 2, 0.0))
        metal.add(v, f, col('#e0a93f'))
    # pennant strings swagged between the windows
    for (a0, a1, zt, sag) in [(-5.8, -1.0, 1.6, 0.38), (1.2, 5.8, -0.25, 0.3)]:
        n = 10
        pts = []
        for i in range(2 * n + 1):
            t = i / (2 * n)
            ax = a0 + (a1 - a0) * t
            wx, yy = on_wall(ax, 0.05)
            pts.append((wx, yy, zt - math.sin(t * math.pi) * sag))
        v, f = lib.tube(pts, 0.01, 4)
        wood.add(v, f, col('#5e3b22'))
        for j in range(n):
            p0, p1 = Vector(pts[2 * j]), Vector(pts[2 * j + 2])
            mid = (p0 + p1) / 2
            tri = [tuple(p0), tuple(p1), (mid.x, mid.y - 0.01, mid.z - 0.26)]
            paint.add(tri, [(0, 1, 2), (2, 1, 0)], col(dress.FESTIVE[j % len(dress.FESTIVE)]))
    # lanterns on iron brackets under the ledge bands (the top band's pair repeats one period down)
    for zb, xs in [(0.0, (-4.9, 0.6, 5.2)), (SH / 2 / PX, (-1.9, 3.4)), (-SH / 2 / PX, (-1.9, 3.4))]:
        for ax in xs:
            wx, yy = on_wall(ax, 0.1)
            v, f = lib.box((wx, yy - 0.12, zb - 0.16), (0.04, 0.3, 0.04))
            metal.add(v, f, col('#3a3a44'))
            v, f = lib.tube([(wx, yy - 0.26, zb - 0.16), (wx, yy - 0.26, zb - 0.3)], 0.01, 4)
            metal.add(v, f, col('#3a3a44'))
            v, f = lib.lathe([(0.03, 0.0), (0.1, 0.06), (0.11, 0.18), (0.08, 0.25), (0.03, 0.28)], 12, (wx, yy - 0.26, zb - 0.6))
            glow.add(v, f, col('#ffb347'))
            v, f = lib.lathe([(0.12, 0.27), (0.02, 0.36)], 12, (wx, yy - 0.26, zb - 0.6), cap_bottom=True, cap_top=False)
            metal.add(v, f, col('#c98a1b'))
    # ivy (leafier, a few in flower), trailing down from under the bands - never across a window,
    # the rose window or a banner (x across the wall, z from, z to, half width)
    clear = [(ax, az - 0.75, az + 0.75, 1.0) for (ax, az) in wins] + [(-0.4, 2.3, 3.5, 0.75), (-2.1, -2.5, -0.1, 0.5), (2.6, -2.5, -0.1, 0.5)]

    def blocked(ax, za, zb):
        return any(abs(ax - cx) < hw and za < z1_ and zb > z0_ for (cx, z0_, z1_, hw) in clear)
    for k in range(13):
        for _try in range(30):
            ax = rnd.uniform(-5.4, 5.4)
            z0 = rnd.uniform(-2.9, 2.6) if k < 9 else rnd.choice([-0.15, 3.85])
            L = rnd.uniform(1.0, 2.6)
            z1 = max(-SH / 2 / PX + 0.3, z0 - L)
            if not blocked(ax, z1, z0):
                break
        wx, yy = on_wall(ax, 0.0)
        yy -= 0.04
        for j in range(int((z0 - z1) / 0.11)):
            z = z0 - j * 0.11
            xx = wx + math.sin(z * 3 + k) * 0.12
            for s_ in (-1, 1):
                v, f = lib.blob((xx + s_ * rnd.uniform(0.02, 0.09), yy, z + rnd.uniform(-0.03, 0.03)), rnd.uniform(0.06, 0.11), squash=(1.0, 0.4, 1.0), rough=0.2, subdiv=1, seed=k * 31 + j * 2 + s_)
                leaves.add(v, f, col(rnd.choice(['#5aa944', '#4f9a3a', '#6fbf52', '#3f8a34'])))
            if rnd.random() < 0.18:
                v, f = lib.blob((xx, yy - 0.04, z), 0.035, rough=0.0, subdiv=1)
                blossom.add(v, f, col(rnd.choice(['#ffffff', '#ffd6e8', '#fff3a8'])))
    glow.build('windows', props.mats()['glow'])
    wood.build('frames', props.mats()['wood'])
    paint.build('tower_paint', props.mats()['paint'])
    metal.build('tower_metal', props.mats()['metal'])
    leaves.build('ivy', lib.attr_mat('leaf', rough=0.8, ao=0.5))
    blossom.build('ivy_flowers', lib.attr_mat('ivy_flower', rough=0.55))
    path = os.path.join(OUT, 'tower_raw.png')
    lib.render_to(path)
    im = np.asarray(Image.open(path).convert('RGBA'), np.float32)
    m = int(M * scale)
    h = int(SH * scale)
    tile = im[m:m + h].copy()
    for i in range(m):
        a = i / m
        tile[i] = im[m + i] * a + im[m + h + i] * (1 - a)
    out = os.path.join(OUT, 'tower.png')
    Image.fromarray(np.clip(tile, 0, 255).astype(np.uint8)).save(out)
    if not A.preview:
        os.makedirs(os.path.join(PUB, 'mg'), exist_ok=True)
        Image.open(out).save(os.path.join(PUB, 'mg', 'tower_wall.webp'), 'WEBP', quality=90, method=6)
        print('wrote mg/tower_wall.webp')


# ------------------------------------------------------------------------------------------
# Gameplay sprites
def sprite_scene(elev, samples=48):
    set_view(elev)
    lib.reset(12 if A.preview else samples)
    props._MATS.clear()
    lib.world_light(0.85)
    lib.sun(energy=3.4, elevation=50, azimuth=-35, angle=3.0)


def shadow_floor(bx, by, r=2.5):
    c = board_to_world(bx, by, 0.0)
    fl = lib.mesh_object('floor', *lib.lathe([(r, 0.0), (0.0, 0.0)], 48, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False), smooth=False,
                         material=lib.simple_mat('floor', '#b8a888'))
    fl.is_shadow_catcher = True
    return fl


def render_sprite(name, region, anchor_bx, anchor_by, meta, scale=1.0):
    """Render the current scene's `region` (screen px x0,y0,w,h at `scale`) to mg/<name>.webp."""
    x0, y0, w, h = region
    lib.camera_for_region(x0, y0, w, h, scale=scale * (0.5 if A.preview else 1.0))
    path = os.path.join(OUT, f'{name}.png')
    lib.render_to(path)
    meta[name] = {'anchor': [(anchor_bx - x0) / w, (anchor_by - y0) / h], 'scale': scale}
    if not A.preview:
        os.makedirs(os.path.join(PUB, 'mg'), exist_ok=True)
        Image.open(path).convert('RGBA').save(os.path.join(PUB, 'mg', f'{name}.webp'), 'WEBP', quality=92, method=6)
    print('sprite', name)


def spr_crate(meta, gold=False):
    sprite_scene(48)
    bx, by = 400.0, 400.0
    c = board_to_world(bx, by, 0.0)
    P = props.Prop('crate')
    s = 1.05
    base = col('#c9a36a') if not gold else col('#f2c14e')
    plank = col('#b48a54') if not gold else col('#e0a93f')
    v, f = lib.box((c.x, c.y, s / 2), (s, s, s))
    P.b['wood' if not gold else 'metal'].add(v, f, base)
    # planks across each visible face, dark edge battens and brass corners
    for k in range(3):
        z = 0.18 + k * 0.34
        v, f = lib.box((c.x, c.y - s / 2 - 0.02, z), (s * 0.96, 0.04, 0.26))
        P.b['wood'].add(v, f, plank)
        v, f = lib.box((c.x, c.y, s + 0.02), (s * 0.96, 0.26, 0.04))
        v = lib.transform(v, loc=(0.0, (k - 1) * 0.32, 0.0))
        P.b['wood'].add(v, f, plank)
    for (dx, dy) in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        v, f = lib.box((c.x + dx * s / 2, c.y + dy * s / 2, s / 2), (0.1, 0.1, s + 0.04))
        P.b['wood'].add(v, f, col('#6e4a2c'))
        for zz in (0.05, s - 0.05):
            v, f = lib.box((c.x + dx * (s / 2 - 0.02), c.y + dy * (s / 2 - 0.02), zz), (0.16, 0.16, 0.12))
            P.b['metal'].add(v, f, col('#e0a93f'))
    if gold:
        v, f = lib.lathe([(0.26, 0.0), (0.26, 0.03), (0.0, 0.03)], 24, (0, 0, 0), cap_bottom=False)
        v = lib.transform(v, loc=(c.x, c.y - s / 2 - 0.05, s / 2), rot=(math.pi / 2, 0.0, 0.0))
        P.b['glow'].add(v, f, col('#5ce1ff'))
    P.build()
    floor = shadow_floor(bx, by)
    region = (bx - 90, by - 150, 180, 190)
    # The crate on its own (the floor still bounces light onto it but is not seen): the game draws the
    # crate at the depth of its footprint, so a baked-in shadow would fall across players behind it.
    floor.visible_camera = False
    render_sprite('crate_gold' if gold else 'crate', region, bx, by, meta)
    if not gold:
        # ...and its cast shadow alone, which the game lays on the floor beneath everyone
        floor.visible_camera = True
        for ob in bpy.data.objects:
            if ob.type == 'MESH' and ob is not floor:
                ob.visible_camera = False
        render_sprite('crate_shadow', region, bx, by, meta)
        # drop the part hidden under the crate (a solid black footprint that its squash would uncover);
        # a 2 px margin keeps the shadow beneath the crate's soft edges
        crate = Image.open(os.path.join(OUT, 'crate.png')).convert('RGBA').getchannel('A').filter(ImageFilter.MinFilter(5))
        sh = Image.open(os.path.join(OUT, 'crate_shadow.png')).convert('RGBA')
        a = np.asarray(sh.getchannel('A')).astype(np.float32) * (1.0 - np.asarray(crate).astype(np.float32) / 255.0)
        sh.putalpha(Image.fromarray(a.astype(np.uint8)))
        sh.save(os.path.join(OUT, 'crate_shadow.png'))
        if not A.preview:
            sh.save(os.path.join(PUB, 'mg', 'crate_shadow.webp'), 'WEBP', quality=92, method=6)


def spr_pad(meta):
    sprite_scene(40)
    bx, by = 400.0, 400.0
    c = board_to_world(bx, by, 0.0)
    P = props.Prop('pad')
    R = 1.0
    notch = 0.42
    verts, faces = [(c.x, c.y, 0.05)], []
    n = 48
    for k in range(n + 1):
        a = notch / 2 + (math.tau - notch) * k / n
        rr = R * (1 + 0.03 * math.sin(a * 7))
        verts.append((c.x + math.cos(a - math.pi / 2) * rr, c.y + math.sin(a - math.pi / 2) * rr, 0.035 + 0.02 * math.sin(a * 3)))
    for k in range(n):
        faces.append((0, k + 1, k + 2))
    P.b['leaf'].add(verts, faces, col('#5fae45'))
    # rim lip and veins
    rim = [(vx, vy, vz + 0.012) for (vx, vy, vz) in verts[1:]]
    v, f = lib.tube(rim, 0.03, 6)
    P.b['leaf'].add(v, f, col('#4a9236'))
    for k in range(9):
        a = notch / 2 + (math.tau - notch) * (k + 0.5) / 9 - math.pi / 2
        v, f = lib.tube([(c.x, c.y, 0.06), (c.x + math.cos(a) * R * 0.9, c.y + math.sin(a) * R * 0.9, 0.05)], 0.012, 4)
        P.b['leaf'].add(v, f, col('#8fd06a'))
    P.build()
    shadow_floor(bx, by)
    render_sprite('pad', (bx - 115, by - 80, 230, 160), bx, by, meta)


def spr_sky_tile(meta):
    sprite_scene(35)
    bx, by = 400.0, 400.0
    c = board_to_world(bx, by, 0.0)
    P = props.Prop('tile')
    W = 2.1
    D = 1.2 / lib.COSB
    T = 0.17  # thin, so rows stay visibly apart (the 16 px gaps read as gaps)
    rnd = random.Random(3)
    n = 6
    for k in range(n):
        x = c.x - W / 2 + (k + 0.5) * W / n
        v, f = lib.box((x, c.y, -T / 2), (W / n - 0.012, D, T))
        v = [(vx, vy, vz + rnd.uniform(-0.01, 0.01)) for (vx, vy, vz) in v]
        top_c = col(rnd.choice(['#c08850', '#b07a45', '#caa060', '#a86e40']))
        P.b['wood'].add(v, f, lambda vv, top_c=top_c: top_c if vv[2] > -T * 0.5 else col('#5e3b22'))
    for dy in (-D / 2 + 0.12, D / 2 - 0.12):
        v, f = lib.box((c.x, c.y + dy, 0.02), (W + 0.06, 0.14, 0.06))
        P.b['wood'].add(v, f, col('#6e4a2c'))
    # rope lashing around the rim and a glowing crystal holding it up
    ring = [(c.x - W / 2 - 0.05, c.y - D / 2 - 0.05, -0.08), (c.x + W / 2 + 0.05, c.y - D / 2 - 0.05, -0.08),
            (c.x + W / 2 + 0.05, c.y + D / 2 + 0.05, -0.08), (c.x - W / 2 - 0.05, c.y + D / 2 + 0.05, -0.08), (c.x - W / 2 - 0.05, c.y - D / 2 - 0.05, -0.08)]
    v, f = lib.tube(ring, 0.04, 6)
    P.b['paint'].add(v, f, col('#d9c49a'))
    for (dx, dy) in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        v, f = lib.blob((c.x + dx * W / 2, c.y + dy * D / 2, 0.0), 0.08, rough=0.0, subdiv=2)
        P.b['metal'].add(v, f, col('#e0a93f'))
    v, f = lib.prism((c.x - W / n * 0.5, c.y, -T - 0.08), 0.2, 0.6, tilt=(math.pi, 0.0))
    P.b['crystal'].add(v, f, col('#5ce1ff'))
    P.build()
    render_sprite('sky_tile', (bx - 125, by - 80, 250, 190), bx, by, meta)


def spr_log(meta, frames=8):
    """Spiked log rolling along the lane (axis across the lane), several roll frames in a strip."""
    sprite_scene(45)
    bx, by = 400.0, 400.0
    c = board_to_world(bx, by, 0.0)
    shadow_floor(bx, by)
    lib.camera_for_region(bx - 90, by - 150, 180, 180, scale=0.5 if A.preview else 1.0)
    L, R = 1.25 / lib.COSB * 0.9, 0.36
    strip = []
    for fr in range(frames):
        for ob in [o for o in bpy.context.scene.objects if o.name.startswith('log_')]:
            bpy.data.objects.remove(ob, do_unlink=True)
        P = props.Prop(f'log_{fr}')
        rot = fr / frames * math.tau / 6
        v, f = lib.cylinder((0, 0, -L / 2), R, R, L, 18)
        v = lib.transform(v, loc=(c.x, c.y, R + 0.02), rot=(math.pi / 2, rot, 0.0))
        P.b['wood'].add(v, f, col('#9a643a'))
        for k in range(6):
            a = rot + k / 6 * math.tau
            for j in range(3):
                yy = c.y - L / 2 + (j + 0.5) * L / 3
                base = (c.x + math.cos(a) * R, yy, R + 0.02 + math.sin(a) * R)
                tip = (c.x + math.cos(a) * (R + 0.26), yy, R + 0.02 + math.sin(a) * (R + 0.26))
                v, f = lib.cylinder((0, 0, 0), 0.07, 0.0, 0.26, 8)
                v = [(base[0] + (tip[0] - base[0]) * (vz / 0.26) + vx * math.sin(a), base[1] + vy, base[2] + (tip[2] - base[2]) * (vz / 0.26) - vx * math.cos(a)) for (vx, vy, vz) in v]
                P.b['metal'].add(v, f, col('#c9ced8'))
        for sgn in (-1, 1):
            v, f = lib.lathe([(R + 0.01, 0.0), (R + 0.01, 0.05), (0.0, 0.05)], 18, (0, 0, 0), cap_bottom=False)
            v = lib.transform(v, loc=(c.x, c.y + sgn * L / 2, R + 0.02), rot=(math.pi / 2 * sgn, 0.0, 0.0))
            P.b['paint'].add(v, f, col('#e8c890'))
        P.build()
        path = os.path.join(OUT, f'log_{fr}.png')
        lib.render_to(path)
        strip.append(Image.open(path).convert('RGBA'))
    w, h = strip[0].size
    sheet = Image.new('RGBA', (w * frames, h))
    for k, im in enumerate(strip):
        sheet.paste(im, (k * w, 0))
    meta['log'] = {'anchor': [0.5, 150 / 180], 'frames': frames, 'frameWidth': w, 'frameHeight': h}
    if not A.preview:
        os.makedirs(os.path.join(PUB, 'mg'), exist_ok=True)
        sheet.save(os.path.join(PUB, 'mg', 'log.webp'), 'WEBP', quality=92, method=6)
    print('sprite log', sheet.size)


def spr_mace(meta):
    sprite_scene(45)
    bx, by = 400.0, 400.0
    c = board_to_world(bx, by, 0.0)
    P = props.Prop('mace')
    z = 0.8
    v, f = lib.blob((c.x, c.y, z), 0.34, rough=0.0, subdiv=3)
    P.b['metal'].add(v, f, col('#6b6f7a'))
    ico_v, _ = lib.icosphere(1)
    for (vx, vy, vz) in ico_v:
        n = Vector((vx, vy, vz)).normalized()
        base = Vector((c.x, c.y, z)) + n * 0.3
        v, f = lib.cylinder((0, 0, 0), 0.07, 0.0, 0.22, 8)
        rot = n.to_track_quat('Z', 'Y').to_euler()
        v = lib.transform(v, loc=tuple(base), rot=(rot.x, rot.y, rot.z))
        P.b['metal'].add(v, f, col('#d8dce4'))
    v, f = lib.lathe([(0.1, 0.0), (0.1, 0.12), (0.0, 0.12)], 12, (c.x, c.y, z + 0.3), cap_bottom=True)
    P.b['metal'].add(v, f, col('#e0a93f'))
    P.build()
    render_sprite('mace', (bx - 70, by - 150, 140, 140), bx, by - lib.screen_height(z), meta)


def spr_spring(meta):
    sprite_scene(45)
    bx, by = 400.0, 400.0
    c = board_to_world(bx, by, 0.0)
    P = props.Prop('spring')
    v, f = lib.lathe([(0.5, 0.0), (0.5, 0.08), (0.44, 0.1), (0.0, 0.1)], 32, (c.x, c.y, 0.0))
    P.b['metal'].add(v, f, col('#6b6f7a'))
    coil = []
    for k in range(120):
        t = k / 119
        a = t * 5 * math.tau
        coil.append((c.x + math.cos(a) * 0.3, c.y + math.sin(a) * 0.3, 0.1 + t * 0.34))
    v, f = lib.tube(coil, 0.04, 6)
    P.b['metal'].add(v, f, col('#d8dce4'))
    v, f = lib.lathe([(0.46, 0.44), (0.46, 0.52), (0.4, 0.56), (0.0, 0.57)], 32, (c.x, c.y, 0.0))
    P.b['paint'].add(v, f, col('#ff6b5e'))
    v, f = lib.lathe([(0.3, 0.571), (0.2, 0.571)], 32, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    P.b['paint'].add(v, f, col('#fff4dc'))
    P.build()
    shadow_floor(bx, by)
    render_sprite('spring', (bx - 70, by - 90, 140, 130), bx, by, meta)


def spr_parcel(meta):
    sprite_scene(45)
    bx, by = 400.0, 400.0
    c = board_to_world(bx, by, 0.0)
    P = props.Prop('parcel')
    s = 0.62
    v, f = lib.box((c.x, c.y, s / 2), (s, s, s))
    P.b['paint'].add(v, f, col('#8e5cd9'))
    for (sx, sy) in [(s + 0.02, 0.12), (0.12, s + 0.02)]:
        v, f = lib.box((c.x, c.y, s / 2), (sx, sy, s + 0.02))
        P.b['metal'].add(v, f, col('#f2c14e'))
    for side in (-1, 1):
        v, f = lib.blob((c.x + side * 0.12, c.y, s + 0.08), 0.1, squash=(1.3, 0.6, 0.8), rough=0.0, subdiv=2)
        P.b['metal'].add(v, f, col('#f2c14e'))
    v, f = lib.prism((c.x, c.y - s / 2 - 0.03, s / 2), 0.1, 0.18, tilt=(math.pi / 2, 0.0))
    P.b['crystal'].add(v, f, col('#5ce1ff'))
    P.build()
    shadow_floor(bx, by)
    render_sprite('parcel', (bx - 55, by - 95, 110, 110), bx, by, meta)


def spr_totem(meta):
    """Carved spiral totem standing on a rope clamp (origin: the clamp, bottom centre)."""
    sprite_scene(12)
    bx, by = 400.0, 400.0
    c = board_to_world(bx, by, 0.0)
    P = props.Prop('marker')
    H = 1.25
    # rope clamp at the base (the rope runs through it left-right)
    v, f = lib.box((c.x, c.y, 0.06), (0.5, 0.36, 0.14))
    P.b['metal'].add(v, f, col('#c98a1b'))
    v, f = lib.cylinder((c.x, c.y, 0.13), 0.28, 0.32, H * 0.78, 20)
    P.b['wood'].add(v, f, col('#b07a45'))
    for k, colr in enumerate(['#1fa5a0', '#ff6b5e', '#f2c14e']):
        z = 0.3 + k * 0.28
        v, f = lib.lathe([(0.32, z - 0.035), (0.35, z), (0.32, z + 0.035)], 20, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
        P.b['paint'].add(v, f, col(colr))
    # head: a wider carved cap with a glowing spiral face toward the camera, and wings
    top = 0.13 + H * 0.78
    v, f = lib.lathe([(0.34, top), (0.42, top + 0.08), (0.4, top + 0.3), (0.2, top + 0.42), (0.0, top + 0.44)], 20, (c.x, c.y, 0.0), cap_bottom=True)
    P.b['wood'].add(v, f, col('#c08850'))
    v, f = lib.lathe([(0.2, 0.0), (0.2, 0.03), (0.0, 0.03)], 24, (0, 0, 0), cap_bottom=False)
    v = lib.transform(v, loc=(c.x, c.y - 0.4, top + 0.18), rot=(math.pi / 2, 0.0, 0.0))
    P.b['glow'].add(v, f, col('#5ce1ff'))
    for side in (-1, 1):
        fe = [(0.36 * side, top + 0.05), (0.78 * side, top + 0.42), (0.74 * side, top + 0.2), (0.4 * side, top - 0.08)]
        v = [(c.x + fx, c.y - 0.02, fz) for (fx, fz) in fe] + [(c.x + fx, c.y + 0.02, fz) for (fx, fz) in fe]
        P.b['paint'].add(v, [(0, 1, 2, 3), (7, 6, 5, 4)] if side > 0 else [(3, 2, 1, 0), (4, 5, 6, 7)], col('#f2c14e'))
    P.build()
    h_px = lib.screen_height(top + 0.5) + 30
    render_sprite('totem', (bx - 90, by - h_px, 180, h_px + 24), bx, by, meta)


def spr_plank(meta):
    sprite_scene(6)
    bx, by = 400.0, 400.0
    c = board_to_world(bx, by, 0.0)
    P = props.Prop('plank')
    W, T = 2.4, 0.26
    D = 0.9
    rnd = random.Random(8)
    for k in range(3):
        y = c.y - D / 2 + (k + 0.5) * D / 3
        v, f = lib.box((c.x, y, -T / 2), (W, D / 3 - 0.02, T))
        P.b['wood'].add(v, f, col(rnd.choice(['#c08850', '#b07a45', '#caa060'])))
    for dx in (-W / 2 + 0.25, W / 2 - 0.25):
        v, f = lib.box((c.x + dx, c.y - D / 2 - 0.02, -T / 2), (0.14, 0.04, T + 0.06))
        P.b['metal'].add(v, f, col('#6b6f7a'))
        v, f = lib.blob((c.x + dx, c.y - D / 2 - 0.05, -T / 2), 0.035, rough=0.0, subdiv=1)
        P.b['metal'].add(v, f, col('#e0a93f'))
    P.build()
    render_sprite('plank', (bx - 130, by - 20, 260, 60), bx, by, meta)


def islets():
    """Three small floating islets for the board sky's middle distance (parallax layer)."""
    os.makedirs(os.path.join(PUB, 'mg'), exist_ok=True)
    looks = [(1.0, 'round'), (0.8, 'pine'), (0.65, 'crystal')]
    for k, (size, kind) in enumerate(looks):
        set_view(52)
        lib.reset(12 if A.preview else 40)
        props._MATS.clear()
        lib.world_light(0.85)
        lib.sun(energy=3.6, elevation=40, azimuth=-35, angle=2.5, color='#ffe9c9')
        cx, cy = 400.0, 380.0
        rx, ry = 150 * size, 95 * size
        island(blob_outline(cx, cy, rx, ry, seed=90 + k, lobes=6, wobble=0.1), name=f'islet_{k}', depth=1.0)
        rnd = random.Random(40 + k)
        leaves, wood, flowers = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
        if kind == 'round':
            terrain.tree_round(leaves, wood, cx - 30, cy - 10, rnd, 1.1)
            terrain.bush(leaves, cx + 60, cy + 20, rnd, 1.0, berries=flowers)
        elif kind == 'pine':
            terrain.tree_pine(leaves, wood, cx - 20, cy - 5, rnd, 1.0)
            terrain.tree_pine(leaves, wood, cx + 40, cy + 15, rnd, 0.8)
        else:
            crys = lib.MeshBuilder()
            terrain.crystal_cluster(crys, cx, cy, rnd, 1.3)
            crys.build('islet_crystals', props.mats()['crystal'], smooth=False)
            terrain.bush(leaves, cx - 50, cy + 18, rnd, 0.9, berries=flowers)
        for _ in range(5):
            terrain.flower_bed(flowers, leaves, cx + rnd.uniform(-rx * 0.6, rx * 0.6), cy + rnd.uniform(-ry * 0.4, ry * 0.5), rnd)
        leaves.build('leaves', lib.attr_mat('leaf', rough=0.78, ao=0.5))
        wood.build('wood', lib.attr_mat('wood', rough=0.8, ao=0.3))
        flowers.build('flowers', lib.attr_mat('flower', rough=0.55))
        region = (cx - rx - 40, cy - 190, 2 * rx + 80, 190 + ry + 260 * size)
        lib.camera_for_region(*region, scale=0.5 if A.preview else 1.0)
        path = os.path.join(OUT, f'islet_{k}.png')
        lib.render_to(path)
        if not A.preview:
            Image.open(path).convert('RGBA').save(os.path.join(PUB, 'mg', f'islet_{k}.webp'), 'WEBP', quality=90, method=6)
        print('islet', k)


def foreground():
    """Out-of-focus leafy clusters for the bottom edge of board close-ups (depth-of-field cue)."""
    os.makedirs(os.path.join(PUB, 'mg'), exist_ok=True)
    for k in range(3):
        sprite_scene(28, samples=32)
        rnd = random.Random(70 + k)
        leaves = lib.MeshBuilder()
        bx, by = 400.0, 400.0
        for _j in range(6):
            terrain.bush(leaves, bx + rnd.uniform(-150, 150), by + rnd.uniform(-20, 30), rnd, rnd.uniform(2.4, 3.4))
        for _j in range(10):
            c = board_to_world(bx + rnd.uniform(-190, 190), by + rnd.uniform(0, 30), 0.0)
            L = rnd.uniform(1.0, 1.7)
            v, f = lib.blob((0, 0, 0), 1.0, squash=(0.24, 0.07, 1.0), rough=0.1, subdiv=2, seed=rnd.random() * 9)
            v = lib.transform(v, loc=(c.x, c.y, L * 0.5), rot=(rnd.uniform(-0.7, 0.7), rnd.uniform(-0.9, 0.9), rnd.uniform(0, math.pi)), scale=(1.0, 1.0, L * 0.55))
            leaves.add(v, f, col(rnd.choice(['#2f8a3a', '#3f9d44', '#236f30', '#4aa84a'])))
        leaves.build('fg', lib.attr_mat('leaf', rough=0.7, ao=0.5))
        lib.camera_for_region(bx - 360, by - 380, 720, 440, scale=0.5 if A.preview else 1.0)
        path = os.path.join(OUT, f'fg_{k}.png')
        lib.render_to(path)
        im = Image.open(path).convert('RGBA')
        a = np.asarray(im, np.float32)
        a[..., :3] *= 0.78  # it sits in the shade, close to the camera
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(9))
        bb = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
        if bb:
            im = im.crop((max(0, bb[0] - 24), max(0, bb[1] - 24), min(im.width, bb[2] + 24), min(im.height, bb[3] + 24)))
        if not A.preview:
            im.save(os.path.join(PUB, 'mg', f'fg_{k}.webp'), 'WEBP', quality=88, method=6)
        print('fg', k, im.size)


def sprites():
    meta_path = os.path.join(PUB, 'mg', 'sprites.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    only = {t for t in A.only.split(',') if t}
    jobs = [('crate', lambda: spr_crate(meta)), ('crate_gold', lambda: spr_crate(meta, gold=True)), ('pad', lambda: spr_pad(meta)),
            ('sky_tile', lambda: spr_sky_tile(meta)), ('log', lambda: spr_log(meta)), ('mace', lambda: spr_mace(meta)),
            ('spring', lambda: spr_spring(meta)), ('parcel', lambda: spr_parcel(meta)), ('totem', lambda: spr_totem(meta)),
            ('plank', lambda: spr_plank(meta))]
    for name, fn in jobs:
        if only and name not in only:
            continue
        fn()
    if not A.preview:
        os.makedirs(os.path.join(PUB, 'mg'), exist_ok=True)
        with open(meta_path, 'w') as fh:
            json.dump(meta, fh, indent=1)
        print('wrote mg/sprites.json')


{'yard': yard, 'pond': pond, 'relay': relay, 'totem': totem, 'tower': tower, 'sprites': sprites, 'islets': islets, 'fg': foreground}[A.what]()
