"""Hero scenes: the title island and minigame arenas (screen-space, 1920x1080).

    .artenv/bin/python scripts/art/scenes.py title|gleam|orbit [--preview]

Each scene uses the orthographic projection from lib with a scene-specific camera elevation, so
its ground plane maps 1:1 onto the game's screen coordinates (layouts line up with gameplay).
Outputs public/assets/rendered/scene_<name>.webp (transparent; the sky is drawn separately).
"""
from __future__ import annotations

import argparse
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
from lib import PX, board_to_world, col  # noqa: E402

import bpy  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('scene', choices=['title', 'gleam', 'orbit', 'select'])
p.add_argument('--preview', action='store_true')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

SW, SH = 1920, 1080
OUT = os.path.join(lib.ROOT, 'art-out', 'scenes')
os.makedirs(OUT, exist_ok=True)


def set_view(elevation_deg: float) -> None:
    """Camera elevation for this scene (the board uses 52 degrees)."""
    lib.BETA = math.radians(90 - elevation_deg)
    lib.COSB, lib.SINB = math.cos(lib.BETA), math.sin(lib.BETA)


def ground_image_material(name: str, img_path: str, region, rough: float = 0.6, bump: float = 0.25):
    """Material that projects an image onto the ground plane over board px `region` (x0,y0,x1,y1)."""
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
    ao = m.ao(0.5, 8)
    c = m.mult(c, m.mix(ao, col('#6a6070'), col('#ffffff')))
    m.bsdf(c, rough, normal=m.bump(lum.outputs['Val'], bump, 0.02))
    return m.mat


def island_under(outline_px, name, mat, depth=1.0):
    """Floating island whose top outline is `outline_px` (screen px polygon)."""
    img = Image.new('L', (SW // 4, (SH + 600) // 4), 0)
    ImageDraw.Draw(img).polygon([(x / 4, y / 4) for x, y in outline_px], fill=255)
    img = img.filter(ImageFilter.GaussianBlur(3))
    mask = np.asarray(img, np.float32) / 255.0 > 0.5
    terrain.set_canvas(SW, SH + 600, 4)
    return terrain.build_island(['a', 'b'] if depth >= 1 else ['a'], mask, name, mat)


def blob_outline(cx, cy, rx, ry, seed=1, lobes=7, wobble=0.12, n=96):
    r = random.Random(seed)
    ph = [r.uniform(0, math.tau) for _ in range(3)]
    pts = []
    for k in range(n):
        a = k / n * math.tau
        w = 1 + wobble * (math.sin(a * lobes / 2 + ph[0]) * 0.6 + math.sin(a * lobes + ph[1]) * 0.3 + math.sin(a * 3 + ph[2]) * 0.4)
        pts.append((cx + math.cos(a) * rx * w, cy + math.sin(a) * ry * w))
    return pts


def scatter(mask_fn, region, count, fn, rnd, avoid=None):
    x0, y0, x1, y1 = region
    placed = 0
    for _ in range(count * 8):
        if placed >= count:
            break
        x, y = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
        if not mask_fn(x, y):
            continue
        if avoid and avoid(x, y):
            continue
        fn(x, y)
        placed += 1


def lights(elev=50, az=-35):
    lib.world_light(0.85)
    lib.sun(energy=3.4, elevation=elev, azimuth=az, angle=3.0)


# ------------------------------------------------------------------------------------------
def title():
    """Big festival island for the title screen; characters stand on it in-game."""
    set_view(22)
    lib.reset(12 if A.preview else 36)
    lights(46, -32)
    lib.camera_for_region(0, 0, SW, SH, scale=0.5 if A.preview else 1.0)
    pm = os.path.join(OUT, 'title_paths.png')
    im = Image.new('L', (SW // 2, SH // 2), 0)
    d = ImageDraw.Draw(im)
    # a sandy festival clearing where the heroes stand, and a trail running off to the right
    d.ellipse([(880) / 2, (560) / 2, (1740) / 2, (735) / 2], fill=255)
    d.line([(1700 / 2, 650 / 2), (1900 / 2, 610 / 2)], fill=255, width=40)
    im.filter(ImageFilter.GaussianBlur(4)).save(pm)
    terrain.set_canvas(SW, SH, 4)
    mat = terrain.island_material(pm)
    # island_material maps the mask over the terrain canvas; keep it at screen size
    outline = blob_outline(1300, 650, 660, 150, seed=4, lobes=9)
    ob, dist, under, ring, nrm = island_under(outline, 'title_island', mat)
    # small companion islets
    for i, (cx, cy, rx, ry) in enumerate([(210, 900, 150, 40), (1860, 300, 120, 30)]):
        island_under(blob_outline(cx, cy, rx, ry, seed=10 + i, lobes=5), f'islet{i}', mat, depth=0.5)
    rnd = random.Random(3)
    grass = lib.MeshBuilder()
    flowers = lib.MeshBuilder()
    leaves = lib.MeshBuilder()
    wood = lib.MeshBuilder()
    rocks = lib.MeshBuilder()
    vines = lib.MeshBuilder()
    poly = Image.new('L', (SW // 4, SH // 4), 0)
    ImageDraw.Draw(poly).polygon([(x / 4, y / 4) for x, y in outline], fill=255)
    pm_arr = np.asarray(Image.open(pm), np.float32) / 255.0
    parr = np.asarray(poly) > 0

    def on_island(x, y):
        gx, gy = int(x / 4), int(y / 4)
        return 0 <= gy < parr.shape[0] and 0 <= gx < parr.shape[1] and parr[gy, gx]

    def on_path(x, y):
        gx, gy = int(x / 2), int(y / 2)
        return 0 <= gy < pm_arr.shape[0] and 0 <= gx < pm_arr.shape[1] and pm_arr[gy, gx] > 0.2

    stage_zone = lambda x, y: 860 < x < 1760 and 540 < y < 740  # noqa: E731  heroes stand here
    scatter(on_island, (640, 480, 1960, 820), 2600, lambda x, y: None if on_path(x, y) else terrain.grass_tuft(grass, x, y, rnd, rnd.uniform(1.0, 1.5)), rnd)
    scatter(on_island, (640, 480, 1960, 820), 26, lambda x, y: terrain.flower_bed(flowers, leaves, x, y, rnd), rnd, avoid=lambda x, y: on_path(x, y) or stage_zone(x, y))
    scatter(on_island, (640, 480, 1960, 820), 22, lambda x, y: terrain.bush(leaves, x, y, rnd, rnd.uniform(1.0, 1.5), berries=flowers), rnd,
            avoid=lambda x, y: on_path(x, y) or stage_zone(x, y) or y > 760)
    scatter(on_island, (640, 480, 1960, 820), 10, lambda x, y: terrain.rock(rocks, x, y, rnd, 1.4), rnd, avoid=lambda x, y: stage_zone(x, y))
    # trees at the back and sides (never in front of the heroes)
    for (x, y, s) in [(700, 600, 1.3), (760, 540, 1.1), (1880, 580, 1.25), (1830, 520, 1.0), (1040, 520, 1.0), (1560, 515, 1.05)]:
        if on_island(x, y):
            (terrain.tree_round if s != 1.0 else terrain.tree_pine)(leaves, wood, x, y, rnd, s)
    for k in range(0, len(ring), 2):
        if nrm[k][1] < 0.3 or rnd.random() < 0.4:
            continue
        bx, by = ring[k] + nrm[k] * 3
        w = board_to_world(bx, by, -0.12)
        terrain.vine(vines, (w.x, w.y, w.z), (nrm[k][0], -nrm[k][1]), rnd, rnd.uniform(0.5, 1.6))
    lib.MeshBuilder.build(grass, 'grass', lib.attr_mat('grass', rough=0.8, sheen=0.15, ao=0.3), smooth=False)
    flowers.build('flowers', lib.attr_mat('flower', rough=0.55, subsurface=0.25))
    leaves.build('leaves', lib.attr_mat('leaf', rough=0.78, ao=0.5))
    wood.build('wood', lib.attr_mat('wood', rough=0.8, ao=0.3))
    rocks.build('rocks', lib.attr_mat('rock', rough=0.85, ao=0.4))
    vines.build('vines', lib.attr_mat('vine', rough=0.78, ao=0.5))
    # landmarks: the observatory behind, bunting and lanterns framing the heroes
    props.observatory(1650, 500, 0.72)
    props.bunting(1310, 548, 880, 1.25)
    props.lantern(930, 560, 1.3)
    props.lantern(1690, 560, 1.3)
    props.crystal_gen(820, 700, 0.9)
    props.stall(1880, 640, 1.2)
    path = os.path.join(OUT, 'title.png')
    lib.render_to(path)
    return path


# ------------------------------------------------------------------------------------------
PLAZA = (190, 245, 1730, 978)  # floor rect (screen px); gameplay ARENA is (250, 290)-(1670, 930)


def plaza_texture(path, region):
    x0, y0, x1, y1 = region
    w, h = int(x1 - x0), int(y1 - y0)
    im = Image.new('RGB', (w, h), (140, 106, 76))
    d = ImageDraw.Draw(im)
    rnd = random.Random(8)
    tile = 64
    for ty in range(0, h, tile):
        off = (ty // tile) % 2 * tile // 2
        for tx in range(-tile, w + tile, tile):
            c = rnd.choice([(222, 186, 138), (208, 170, 122), (230, 198, 150), (198, 158, 112), (216, 176, 126), (226, 168, 118)])
            d.rounded_rectangle([tx + off + 3, ty + 3, tx + off + tile - 3, ty + tile - 3], radius=9, fill=c)
            # soft top-left highlight on each flagstone
            d.rounded_rectangle([tx + off + 6, ty + 6, tx + off + tile - 14, ty + 14], radius=4, fill=tuple(min(255, v + 14) for v in c))
    # border band
    bw = 34
    for (bx0, by0, bx1, by1) in [(0, 0, w, bw), (0, h - bw, w, h), (0, 0, bw, h), (w - bw, 0, w, h)]:
        d.rectangle([bx0, by0, bx1, by1], fill=(118, 88, 66))
    for k in range(0, w, 48):
        d.ellipse([k + 16, 10, k + 30, 24], fill=(92, 225, 255))
        d.ellipse([k + 16, h - 24, k + 30, h - 10], fill=(92, 225, 255))
    # golden spiral mosaic in the middle
    cx, cy = w / 2, h / 2
    mos = Image.new('L', (w, h), 0)
    md = ImageDraw.Draw(mos)
    md.ellipse([cx - 330, cy - 250, cx + 330, cy + 250], fill=90)
    pts = []
    for i in range(700):
        t = i / 699
        a = t * 3.3 * math.tau
        r = 18 + t * 300
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r * 0.76))
    md.line(pts, fill=255, width=26, joint='curve')
    mos = mos.filter(ImageFilter.GaussianBlur(1.2))
    teal = Image.new('RGB', (w, h), (31, 165, 160))
    gold = Image.new('RGB', (w, h), (240, 186, 70))
    ring = mos.point(lambda v: 255 if 60 < v < 120 else 0)
    im = Image.composite(teal, im, ring.point(lambda v: int(v * 0.5)))
    im = Image.composite(gold, im, mos.point(lambda v: 255 if v > 200 else 0))
    im.save(path)


def gleam():
    set_view(52)
    lib.reset(12 if A.preview else 36)
    lights()
    lib.camera_for_region(0, 0, SW, SH, scale=0.5 if A.preview else 1.0)
    tex = os.path.join(OUT, 'plaza_floor.png')
    plaza_texture(tex, PLAZA)
    floor_m = ground_image_material('plaza', tex, PLAZA, rough=0.55)
    x0, y0, x1, y1 = PLAZA
    # raised plaza slab
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    # The slab sits a little above the island's grass (coplanar faces would shadow each other).
    Z = 0.1
    top = [tuple(board_to_world(x, y, 0.0)) for (x, y) in corners]
    top = [(v[0], v[1], Z) for v in top]
    bot = [tuple(board_to_world(x, y, -0.55)) for (x, y) in corners]
    lib.mesh_object('plaza_top', top, [(3, 2, 1, 0)], smooth=False, material=floor_m)
    side_m = props.mats()['stone']
    sb = lib.MeshBuilder()
    sb.add(top + bot, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], col('#d8cbb8'))
    sb.build('plaza_sides', side_m, smooth=False)
    # low curbs with brass-capped posts (front curb lower so it never hides players)
    curb = lib.MeshBuilder()
    brass = lib.MeshBuilder()
    for (ax, ay, bx, by, hh) in [(x0, y0, x1, y0, 0.32), (x0, y0, x0, y1, 0.26), (x1, y0, x1, y1, 0.26), (x0, y1, x1, y1, 0.14)]:
        n = max(2, int(math.hypot(bx - ax, by - ay) / 140))
        for k in range(n + 1):
            t = k / n
            px, py = ax + (bx - ax) * t, ay + (by - ay) * t
            wp = board_to_world(px, py, 0)
            v, f = lib.cylinder((wp.x, wp.y, Z), 0.09, 0.08, hh + 0.12, 10)
            curb.add(v, f, col('#efe5d8'))
            bv, bf = lib.blob((wp.x, wp.y, Z + hh + 0.16), 0.08, rough=0.0, subdiv=2)
            brass.add(bv, bf, col('#e0a93f'))
        a = board_to_world(ax, ay, 0)
        b = board_to_world(bx, by, 0)
        L = (b - a).length
        mid = (a + b) / 2
        ang = math.atan2(b.y - a.y, b.x - a.x)
        v, f = lib.box((mid.x, mid.y, Z + hh / 2), (L, 0.12, hh), rot_z=ang)
        curb.add(v, f, col('#e3d6c4'))
    curb.build('curbs', side_m)
    brass.build('caps', props.mats()['metal'])
    # the plaza sits on a floating island
    outline = blob_outline(960, 600, 950, 480, seed=21, lobes=8, wobble=0.06)
    terrain.set_canvas(SW, SH + 600, 4)
    make_empty_mask()
    isl_m = terrain.island_material(os.path.join(OUT, 'empty_mask.png'))
    island_under(outline, 'arena_island', isl_m)
    rnd = random.Random(5)
    leaves = lib.MeshBuilder()
    wood = lib.MeshBuilder()
    flowers = lib.MeshBuilder()
    for (x, y, s) in [(95, 330, 1.2), (80, 700, 1.1), (1830, 330, 1.2), (1845, 720, 1.1), (140, 520, 0.9), (1790, 520, 0.9)]:
        terrain.tree_round(leaves, wood, x, y, rnd, s)
    for (x, y) in [(130, 900), (1790, 900), (300, 1010), (1620, 1010), (960, 1015)]:
        terrain.bush(leaves, x, y, rnd, 1.2, berries=flowers)
    leaves.build('leaves', lib.attr_mat('leaf', rough=0.78, ao=0.5))
    wood.build('wood', lib.attr_mat('wood', rough=0.8, ao=0.3))
    flowers.build('flowers', lib.attr_mat('flower', rough=0.55))
    # festival stalls and lanterns along the back
    props.stall(470, 175, 1.25, stripe=('#ff6b5e', '#fff4dc'))
    props.stall(1450, 175, 1.25, stripe=('#1fa5a0', '#fff4dc'))
    props.stall(960, 150, 1.1, stripe=('#8e5cd9', '#fff4dc'))
    for x in (210, 715, 1205, 1710):
        props.lantern(x, 228, 1.4)
    props.bunting(465, 205, 480, 1.35)
    props.bunting(1455, 205, 480, 1.35)
    path = os.path.join(OUT, 'gleam.png')
    lib.render_to(path)
    return path


def make_empty_mask() -> bool:
    path = os.path.join(OUT, 'empty_mask.png')
    Image.new('L', (64, 64), 0).save(path)
    return True


# ------------------------------------------------------------------------------------------
ORBIT_C = (960, 598)
ORBIT_R = 6.3  # platform radius in world units (players stand at ~5.05)


def astro_texture(path, size=1400):
    im = Image.new('RGB', (size, size), (196, 180, 162))
    d = ImageDraw.Draw(im)
    c = size / 2
    R = size / 2 - 4
    rnd = random.Random(2)
    # stone slabs in rings
    rings = [(0.0, 0.22), (0.22, 0.46), (0.46, 0.72), (0.72, 0.93)]
    # fill from the outside in so each ring's slabs only cover their own band
    for ring_i in range(len(rings) - 1, -1, -1):
        r0, r1 = rings[ring_i]
        segs = [1, 10, 18, 26][ring_i]
        for s_ in range(segs):
            a0, a1 = s_ / segs * 360, (s_ + 1) / segs * 360
            shade = rnd.randint(-12, 12)
            fill = (200 + shade, 184 + shade, 166 + shade)
            d.pieslice([c - r1 * R, c - r1 * R, c + r1 * R, c + r1 * R], a0, a1, fill=fill)
    # slab joints only within each band
    for ring_i, (r0, r1) in enumerate(rings):
        segs = [1, 10, 18, 26][ring_i]
        if segs > 1:
            for s_ in range(segs):
                a = s_ / segs * math.tau
                d.line([(c + math.cos(a) * r0 * R, c + math.sin(a) * r0 * R), (c + math.cos(a) * r1 * R, c + math.sin(a) * r1 * R)], fill=(128, 112, 98), width=4)
        d.ellipse([c - r1 * R, c - r1 * R, c + r1 * R, c + r1 * R], outline=(128, 112, 98), width=5)
    # brass rings and tick marks
    for rr, wdt in [(0.935, 16), (0.72, 8), (0.46, 8), (0.22, 10)]:
        d.ellipse([c - rr * R, c - rr * R, c + rr * R, c + rr * R], outline=(214, 160, 60), width=wdt)
    for k in range(48):
        a = k / 48 * math.tau
        r0, r1 = (0.83 if k % 4 else 0.78) * R, 0.92 * R
        d.line([(c + math.cos(a) * r0, c + math.sin(a) * r0), (c + math.cos(a) * r1, c + math.sin(a) * r1)], fill=(120, 108, 98), width=5 if k % 4 else 9)
    # glowing crystal inlays
    for k in range(12):
        a = k / 12 * math.tau + 0.13
        r = 0.59 * R
        d.ellipse([c + math.cos(a) * r - 14, c + math.sin(a) * r - 14, c + math.cos(a) * r + 14, c + math.sin(a) * r + 14], fill=(92, 225, 255))
    im.save(path)


def orbit():
    set_view(25)
    lib.reset(12 if A.preview else 36)
    lights(48, -30)
    lib.camera_for_region(0, 0, SW, SH, scale=0.5 if A.preview else 1.0)
    tex = os.path.join(OUT, 'astro.png')
    astro_texture(tex)
    cx, cy = ORBIT_C
    rpx = ORBIT_R * PX
    region = (cx - rpx, cy - rpx * lib.COSB, cx + rpx, cy + rpx * lib.COSB)
    top_m = ground_image_material('astro', tex, region, rough=0.5, bump=0.35)
    c = board_to_world(cx, cy, 0.0)
    v, f = lib.lathe([(ORBIT_R, 0.0), (0.0, 0.0)], 96, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    lib.mesh_object('platform_top', v, f, smooth=False, material=top_m)
    rim = lib.MeshBuilder()
    rim_v, rim_f = lib.lathe([(ORBIT_R + 0.02, 0.02), (ORBIT_R + 0.25, 0.02), (ORBIT_R + 0.25, -0.35), (ORBIT_R + 0.1, -0.6), (ORBIT_R - 0.6, -1.4), (ORBIT_R - 1.4, -2.6)], 96, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    rim.add(rim_v, rim_f, col('#d9cdbd'))
    rim.build('platform_rim', props.mats()['stone_big'])
    band = lib.MeshBuilder()
    bv, bf = lib.lathe([(ORBIT_R + 0.26, 0.0), (ORBIT_R + 0.26, -0.28)], 96, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
    band.add(bv, bf, col('#e0a93f'))
    for k in range(32):
        a = k / 32 * math.tau
        pv, pf = lib.blob((c.x + math.cos(a) * (ORBIT_R + 0.28), c.y + math.sin(a) * (ORBIT_R + 0.28), -0.14), 0.07, rough=0.0, subdiv=1)
        band.add(pv, pf, col('#c98a1b'))
    band.build('platform_band', props.mats()['metal'])
    glow = lib.MeshBuilder()
    for k in range(16):
        a = k / 16 * math.tau
        gv, gf = lib.box((c.x + math.cos(a) * (ORBIT_R + 0.12), c.y + math.sin(a) * (ORBIT_R + 0.12), -0.5), (0.22, 0.12, 0.14), rot_z=a + math.pi / 2)
        glow.add(gv, gf, col('#5ce1ff'))
    glow.build('platform_lights', props.mats()['glow'])
    path = os.path.join(OUT, 'orbit.png')
    lib.render_to(path)
    return path


def publish(path, name):
    if A.preview:
        return
    pub = os.path.join(lib.ROOT, 'public', 'assets', 'rendered')
    os.makedirs(pub, exist_ok=True)
    Image.open(path).convert('RGBA').save(os.path.join(pub, f'scene_{name}.webp'), 'WEBP', quality=90, method=6)
    print('wrote', os.path.join(pub, f'scene_{name}.webp'))


# ------------------------------------------------------------------------------------------
PODIUM_X = [360, 760, 1160, 1560]
PODIUM_TOP_Y = 560


def hero_pedestal(bx, base_y):
    P = props.Prop('pedestal_hero')
    c = board_to_world(bx, base_y, 0.0)
    x, y = c.x, c.y
    v, f = lib.lathe([(1.52, 0.0), (1.52, 0.14), (1.42, 0.2), (1.22, 0.26), (1.18, 1.16), (1.36, 1.24), (1.36, 1.44)], 48, (x, y, 0), cap_top=False)
    P.b['stone'].add(v, f, col('#f1e7d8'))
    # smooth polished top slab (the heroes stand here)
    v, f = lib.lathe([(1.36, 1.44), (1.36, 1.46), (0.0, 1.46)], 48, (x, y, 0), cap_bottom=False)
    P.b['paint'].add(v, f, col('#f7efe2'))
    for z0, z1, r in [(0.2, 0.28, 1.43), (1.22, 1.28, 1.37)]:
        v, f = lib.lathe([(r, z0), (r + 0.02, z0), (r + 0.02, z1), (r, z1)], 48, (x, y, 0), cap_bottom=False, cap_top=False)
        P.b['metal'].add(v, f, col('#e0a93f'))
    v, f = lib.lathe([(1.26, 1.462), (1.3, 1.462)], 48, (x, y, 0), cap_bottom=False, cap_top=False)
    P.b['metal'].add(v, f, col('#f2c14e'))
    # spiral emblem on the camera-facing side
    pts = []
    for i in range(80):
        t = i / 79
        a = t * 2.4 * math.tau
        r = 0.04 + t * 0.26
        pts.append((x + math.cos(a) * r, y - 1.2, 0.72 + math.sin(a) * r))
    v, f = lib.tube(pts, 0.03, 6)
    P.b['metal'].add(v, f, col('#f2c14e'))
    for k in range(10):
        a = k / 10 * math.tau
        v, f = lib.box((x + math.cos(a) * 1.21, y + math.sin(a) * 1.21, 0.7), (0.12, 0.05, 0.22), rot_z=a + math.pi / 2)
        P.b['glow'].add(v, f, col('#5ce1ff'))
    return P.build()


def select():
    set_view(16)
    lib.reset(12 if A.preview else 36)
    lights(44, -30)
    lib.camera_for_region(0, 0, SW, SH, scale=0.5 if A.preview else 1.0)
    base_y = PODIUM_TOP_Y + 1.46 * PX * lib.SINB
    # stage floor: stone tiles on a floating terrace
    tex = os.path.join(OUT, 'stage_floor.png')
    region = (60, base_y - 70, 1860, base_y + 90)
    plaza_texture(tex, region)
    floor_m = ground_image_material('stage', tex, region, rough=0.55)
    x0, y0, x1, y1 = region
    top = [tuple(board_to_world(x, y, 0.0)) for (x, y) in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]
    top = [(v[0], v[1], -0.004) for v in top]
    bot = [tuple(board_to_world(x, y, -0.45)) for (x, y) in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]
    lib.mesh_object('stage_top', top, [(3, 2, 1, 0)], smooth=False, material=floor_m)
    sb = lib.MeshBuilder()
    sb.add(top + bot, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], col('#d8cbb8'))
    sb.build('stage_sides', props.mats()['stone'], smooth=False)
    trim = lib.MeshBuilder()
    a, b = board_to_world(x0, y1, 0), board_to_world(x1, y1, 0)
    v, f = lib.box(((a.x + b.x) / 2, a.y - 0.02, -0.06), (b.x - a.x, 0.08, 0.12))
    trim.add(v, f, col('#e0a93f'))
    trim.build('stage_trim', props.mats()['metal'])
    for x in PODIUM_X:
        hero_pedestal(x, base_y)
    # festival backdrop
    props.bunting(560, base_y - 60, 640, 1.35)
    props.bunting(1360, base_y - 60, 640, 1.35)
    for x in (180, 960, 1740):
        props.lantern(x, base_y - 50, 1.5)
    props.crystal_gen(110, base_y - 20, 0.9)
    props.crystal_gen(1810, base_y - 20, 0.9)
    rnd = random.Random(12)
    leaves = lib.MeshBuilder()
    wood = lib.MeshBuilder()
    for (x, s_) in [(40, 1.4), (1880, 1.4), (300, 1.0), (1620, 1.0)]:
        terrain.tree_round(leaves, wood, x, base_y - 80, rnd, s_)
    leaves.build('leaves', lib.attr_mat('leaf', rough=0.78, ao=0.5))
    wood.build('wood', lib.attr_mat('wood', rough=0.8, ao=0.3))
    path = os.path.join(OUT, 'select.png')
    lib.render_to(path)
    return path


publish({'title': title, 'gleam': gleam, 'orbit': orbit, 'select': select}[A.scene](), A.scene)
