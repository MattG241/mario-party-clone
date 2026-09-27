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
p.add_argument('scene', choices=['title', 'gleam', 'orbit', 'select', 'results'])
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
def title_waterfall(ring, nrm, target_x=1560):
    k = min(range(len(ring)), key=lambda i: abs(ring[i][0] - target_x) + (0 if nrm[i][1] > 0.6 else 9999))
    bx, by = ring[k]
    top = board_to_world(bx, by - 10, 0.0)
    m = lib.NT('title_fall')
    pos = m.position()
    X, Y, Z = m.sep(pos)
    wave = m.node('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'X'
    wave.inputs['Scale'].default_value = 7.0
    wave.inputs['Distortion'].default_value = 5.0
    m.link(pos, wave.inputs['Vector'])
    # clear blue water with pale streaks at the lip, turning to white foam as it falls
    streak = m.maprange(wave.outputs['Fac'], 0.35, 0.85)
    water = m.mix(streak, col('#2e9fd6'), col('#d9f5ff'))
    foam = m.maprange(Z, top.z - 1.2, top.z - 3.8, 0.0, 1.0)
    c = m.mix(m.math('MULTIPLY', foam, 0.75), water, col('#ffffff'))
    fade = m.maprange(Z, top.z - 4.2, top.z - 1.0, 0.0, 1.0)
    m.bsdf(c, 0.12, emission=c, emission_strength=0.28, coat=0.6, alpha=m.math('MULTIPLY', fade, 0.95))
    verts, faces = [], []
    rows = 22
    for r in range(rows + 1):
        t = r / rows
        out = 0.35 * math.sqrt(t) + 0.05
        drop = 4.4 * t * t + 0.1 * t
        wd = 0.42 + 0.25 * t
        cx = top.x + math.sin(t * 3) * 0.04
        cy = top.y - out - 0.12
        cz = top.z - drop
        verts += [(cx - wd, cy, cz), (cx + wd, cy, cz)]
    for r in range(rows):
        i = r * 2
        faces.append((i, i + 1, i + 3, i + 2))
    lib.mesh_object('title_waterfall', verts, faces, smooth=True, material=m.mat)
    mist = lib.MeshBuilder()
    rnd = random.Random(8)
    for _ in range(9):
        v, f = lib.blob((top.x + rnd.uniform(-0.5, 0.5), top.y - 0.6, top.z - 3.4 + rnd.uniform(-0.4, 0.4)), rnd.uniform(0.25, 0.45), rough=0.2, subdiv=2, seed=rnd.random())
        mist.add(v, f, col('#ffffff'))
    mist.build('title_mist', lib.attr_mat('mist', rough=1.0, sheen=0.6))


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
    outline = blob_outline(1280, 650, 625, 150, seed=4, lobes=9)
    ob, dist, under, ring, nrm = island_under(outline, 'title_island', mat)
    # companion islets: a larger one bottom-left with the festival sky-boat moored above it
    for i, (cx, cy, rx, ry) in enumerate([(250, 905, 230, 60), (1860, 300, 120, 30)]):
        island_under(blob_outline(cx, cy, rx, ry, seed=10 + i, lobes=5), f'islet{i}', mat, depth=0.6 if i == 0 else 0.5)
    # the festival sky-boat drifting in the top-left sky (clear of the logo)
    props.skyboat(160, 330, 1.3)
    props.lantern(140, 900, 1.2)
    props.lantern(370, 915, 1.0)
    rnd = random.Random(3)
    grass = lib.MeshBuilder()
    flowers = lib.MeshBuilder()
    leaves = lib.MeshBuilder()
    wood = lib.MeshBuilder()
    rocks = lib.MeshBuilder()
    vines = lib.MeshBuilder()
    # the bottom-left islet is a little scene of its own: a flower cart under a tree, bushes and grass
    props.flower_cart(250, 902, 0.95)
    terrain.tree_round(leaves, wood, 92, 888, rnd, 0.95)
    terrain.bush(leaves, 392, 926, rnd, 1.0, berries=flowers)
    terrain.bush(leaves, 150, 940, rnd, 0.8, berries=flowers)
    terrain.flower_bed(flowers, leaves, 330, 944, rnd)
    for _ in range(70):
        a, r = rnd.uniform(0, math.tau), math.sqrt(rnd.random())
        terrain.grass_tuft(grass, 250 + math.cos(a) * r * 200, 905 + math.sin(a) * r * 48, rnd, rnd.uniform(0.9, 1.3))
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
    # vines hang in clumps (not an even curtain), with a few long trailing ones
    for k in range(0, len(ring), 2):
        clump = 0.5 + 0.5 * math.sin(k * 0.11 + 1.3) * math.sin(k * 0.037 + 0.4)
        if nrm[k][1] < 0.3 or rnd.random() > clump * 0.9:
            continue
        bx, by = ring[k] + nrm[k] * 3
        w = board_to_world(bx, by, -0.12)
        length = rnd.uniform(0.3, 1.0) if rnd.random() < 0.75 else rnd.uniform(1.4, 2.4)
        terrain.vine(vines, (w.x, w.y, w.z), (nrm[k][0], -nrm[k][1]), rnd, length)
    # crystals poking out of the underside
    crys = lib.MeshBuilder()
    cands = [v for v, d in under if d > 40]
    for _ in range(min(len(cands), 7)):
        v0 = rnd.choice(cands)
        for _k in range(rnd.randint(1, 3)):
            pv, fv = lib.prism((v0[0] + rnd.uniform(-0.15, 0.15), v0[1] + rnd.uniform(-0.15, 0.15), v0[2] + 0.15), rnd.uniform(0.08, 0.16), rnd.uniform(0.6, 1.3),
                               tilt=(math.pi + rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5)), twist=rnd.random())
            crys.add(pv, fv, col(rnd.choice(['#5ce1ff', '#8ff0ff', '#c49bff'])))
    cm = lib.NT('title_crystal')
    cc = cm.attr('col')
    cm.bsdf(cc, 0.12, emission=cc, emission_strength=2.6, coat=0.6, transmission=0.2)
    crys.build('title_crystals', cm.mat, smooth=False)
    # a waterfall spilling off the front rim, with a mist puff where it thins out
    title_waterfall(ring, nrm)
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


def plaza_texture_v2(path, region, squash=0.64):
    """Festival flagstones drawn already foreshortened (the floor is seen at ~40 degrees): running
    bond sandstone with bevels, wear, chips and moss, a gem-studded border and a tesserae spiral."""
    x0, y0, x1, y1 = region
    w, h = int(x1 - x0), int(y1 - y0)
    rnd = random.Random(8)
    im = Image.new('RGB', (w, h), (104, 80, 62))
    d = ImageDraw.Draw(im)
    tw, th = 58, int(58 * squash)
    pal = [(226, 192, 146), (214, 178, 130), (232, 204, 160), (204, 166, 120), (220, 184, 134), (230, 176, 128), (198, 170, 136)]
    for row, ty in enumerate(range(-th, h + th, th)):
        off = (row % 2) * tw // 2 + rnd.randint(-3, 3)
        for tx in range(-tw, w + tw, tw):
            c = rnd.choice(pal)
            jit = rnd.randint(-10, 8)
            c = tuple(max(0, min(255, v + jit)) for v in c)
            x_a, y_a, x_b, y_b = tx + off + 2, ty + 2, tx + off + tw - 2, ty + th - 2
            # front face (darker lip) then the top face
            d.rounded_rectangle([x_a, y_a + 3, x_b, y_b + 3], radius=6, fill=tuple(int(v * 0.72) for v in c))
            d.rounded_rectangle([x_a, y_a, x_b, y_b], radius=6, fill=c)
            d.rounded_rectangle([x_a + 3, y_a + 2, x_b - 8, y_a + 6], radius=3, fill=tuple(min(255, v + 18) for v in c))
            if rnd.random() < 0.18:  # hairline crack
                cx0 = rnd.randint(x_a + 6, x_b - 6)
                pts = [(cx0, y_a + 2)]
                for k in range(3):
                    pts.append((pts[-1][0] + rnd.randint(-8, 8), pts[-1][1] + (y_b - y_a) / 3))
                d.line(pts, fill=tuple(int(v * 0.6) for v in c), width=1)
            if rnd.random() < 0.12:  # chipped corner
                cxn = x_a if rnd.random() < 0.5 else x_b - 9
                d.polygon([(cxn, y_a), (cxn + 9, y_a), (cxn + (0 if cxn == x_a else 9), y_a + 7)], fill=(120, 94, 72))
    arr = np.asarray(im).astype(np.float32)
    # moss creeping in from the edges + soft grime variation
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    edge = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy / squash, (h - 1 - yy) / squash))
    noise = np.asarray(Image.effect_noise((w // 8 + 1, h // 8 + 1), 60).resize((w, h), Image.BICUBIC), np.float32) / 255.0
    moss = np.clip((90 - edge) / 90, 0, 1) * np.clip((noise - 0.45) * 3.0, 0, 1)
    arr = arr * (1 - moss[..., None] * 0.55) + np.array([96, 150, 70], np.float32) * moss[..., None] * 0.55
    grime = np.asarray(Image.effect_noise((w // 24 + 1, h // 24 + 1), 40).resize((w, h), Image.BICUBIC), np.float32) / 255.0
    arr *= (0.9 + 0.16 * grime)[..., None]
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    # border band with inlaid crystal studs
    bw = 30
    for (bx0, by0, bx1, by1) in [(0, 0, w, int(bw * squash) + 6), (0, h - int(bw * squash) - 6, w, h), (0, 0, bw, h), (w - bw, 0, w, h)]:
        d.rectangle([bx0, by0, bx1, by1], fill=(122, 92, 70))
    for k in range(18, w - 18, 52):
        for yb in (int(bw * squash / 2) + 3, h - int(bw * squash / 2) - 3):
            d.ellipse([k - 7, yb - 5, k + 7, yb + 5], fill=(40, 120, 140))
            d.ellipse([k - 5, yb - 4, k + 5, yb + 3], fill=(92, 225, 255))
    # tesserae spiral mosaic (small tiles following the curve), on a teal disc
    cx, cy = w / 2, h / 2
    disc_r = 330
    for ring in range(0, disc_r, 14):
        n = max(8, int(ring * math.tau / 14))
        for k in range(n):
            a = k / n * math.tau
            px, py = cx + math.cos(a) * ring, cy + math.sin(a) * ring * squash
            shade = rnd.randint(-12, 12)
            base = (38 + shade, 150 + shade, 148 + shade) if ring < disc_r - 26 else (224 + shade, 186 + shade, 90)
            d.rectangle([px - 5, py - 3, px + 5, py + 3], fill=base)
    for i in range(900):
        t = i / 899
        a = t * 3.2 * math.tau
        r = 20 + t * 280
        px, py = cx + math.cos(a) * r, cy + math.sin(a) * r * squash
        shade = rnd.randint(-14, 10)
        d.rectangle([px - 7, py - 4, px + 7, py + 4], fill=(246 + min(0, shade), 190 + shade, 72 + shade))
    im.save(path)


def gleam():
    set_view(40)
    lib.reset(12 if A.preview else 36)
    lights()
    lib.camera_for_region(0, 0, SW, SH, scale=0.5 if A.preview else 1.0)
    tex = os.path.join(OUT, 'plaza_floor.png')
    plaza_texture_v2(tex, PLAZA)
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
    # low curbs with brass-capped posts (front curb lower so it never hides players); the back wall
    # is built separately so it can also be rendered as a front layer over the in-game crowd
    curb, brass = lib.MeshBuilder(), lib.MeshBuilder()
    curb_back, brass_back = lib.MeshBuilder(), lib.MeshBuilder()
    for wi, (ax, ay, bx, by, hh) in enumerate([(x0, y0, x1, y0, 0.46), (x0, y0, x0, y1, 0.24), (x1, y0, x1, y1, 0.24), (x0, y1, x1, y1, 0.12)]):
        cb, bb = (curb_back, brass_back) if wi == 0 else (curb, brass)
        n = max(2, int(math.hypot(bx - ax, by - ay) / 140))
        for k in range(n + 1):
            t = k / n
            px, py = ax + (bx - ax) * t, ay + (by - ay) * t
            wp = board_to_world(px, py, 0)
            v, f = lib.cylinder((wp.x, wp.y, Z), 0.09, 0.08, hh + 0.12, 10)
            cb.add(v, f, col('#efe5d8'))
            bv, bf = lib.blob((wp.x, wp.y, Z + hh + 0.16), 0.08, rough=0.0, subdiv=2)
            bb.add(bv, bf, col('#e0a93f'))
        a = board_to_world(ax, ay, 0)
        b = board_to_world(bx, by, 0)
        L = (b - a).length
        mid = (a + b) / 2
        ang = math.atan2(b.y - a.y, b.x - a.x)
        v, f = lib.box((mid.x, mid.y, Z + hh / 2), (L, 0.12, hh), rot_z=ang)
        cb.add(v, f, col('#e3d6c4'))
    curb.build('curbs', side_m)
    brass.build('caps', props.mats()['metal'])
    curb_back.build('curb_back', side_m)
    brass_back.build('caps_back', props.mats()['metal'])
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
    for (x, y, s) in [(95, 330, 1.15), (70, 860, 1.05), (1830, 330, 1.15), (1850, 860, 1.05)]:
        terrain.tree_round(leaves, wood, x, y, rnd, s)
    for (x, y) in [(130, 900), (1790, 900), (300, 1010), (1620, 1010), (960, 1015)]:
        terrain.bush(leaves, x, y, rnd, 1.2, berries=flowers)
    leaves.build('leaves', lib.attr_mat('leaf', rough=0.78, ao=0.5))
    wood.build('wood', lib.attr_mat('wood', rough=0.8, ao=0.3))
    flowers.build('flowers', lib.attr_mat('flower', rough=0.55))
    # festival bunting and lanterns along the back (kept low: the HUD owns the top strip);
    # stalls sit on the island to either side of the plaza
    for x in (205, 700, 1220, 1715):
        props.lantern(x, 214, 1.25)
    props.bunting(452, 212, 490, 1.05)
    props.bunting(1468, 212, 490, 1.05)
    props.stall(92, 610, 1.05, stripe=('#ff6b5e', '#fff4dc'))
    props.stall(1828, 610, 1.05, stripe=('#1fa5a0', '#fff4dc'))
    path = os.path.join(OUT, 'gleam.png')
    lib.render_to(path)
    # Front layer: only the back wall (everything else held out, so lighting matches exactly).
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH' and ob.name not in ('curb_back', 'caps_back'):
            ob.is_holdout = True
    wall = os.path.join(OUT, 'gleam_wall.png')
    lib.render_to(wall)
    publish(wall, 'gleam_wall')
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
    # clear colour blocking per ring (cream hub, sage, warm sand, deep teal edge) so the disc reads
    # boldly against the cloud sea and the red-and-gold arm stays readable on every band
    ring_cols = [(236, 222, 196), (166, 190, 150), (222, 190, 140), (52, 122, 130)]
    for ring_i in range(len(rings) - 1, -1, -1):
        r0, r1 = rings[ring_i]
        segs = [1, 10, 18, 26][ring_i]
        base = ring_cols[ring_i]
        for s_ in range(segs):
            a0, a1 = s_ / segs * 360, (s_ + 1) / segs * 360
            shade = rnd.randint(-8, 8)
            fill = tuple(max(0, min(255, v + shade)) for v in base)
            d.pieslice([c - r1 * R, c - r1 * R, c + r1 * R, c + r1 * R], a0, a1, fill=fill)
    # slab joints only within each band, in a darker shade of that band
    for ring_i, (r0, r1) in enumerate(rings):
        segs = [1, 10, 18, 26][ring_i]
        joint = tuple(int(v * 0.62) for v in ring_cols[ring_i])
        if segs > 1:
            for s_ in range(segs):
                a = s_ / segs * math.tau
                d.line([(c + math.cos(a) * r0 * R, c + math.sin(a) * r0 * R), (c + math.cos(a) * r1 * R, c + math.sin(a) * r1 * R)], fill=joint, width=4)
        d.ellipse([c - r1 * R, c - r1 * R, c + r1 * R, c + r1 * R], outline=(110, 92, 76), width=5)
    # brass rings and tick marks
    for rr, wdt in [(0.935, 16), (0.72, 8), (0.46, 8), (0.22, 10)]:
        d.ellipse([c - rr * R, c - rr * R, c + rr * R, c + rr * R], outline=(214, 160, 60), width=wdt)
    for k in range(48):
        a = k / 48 * math.tau
        r0, r1 = (0.83 if k % 4 else 0.78) * R, 0.92 * R
        d.line([(c + math.cos(a) * r0, c + math.sin(a) * r0), (c + math.cos(a) * r1, c + math.sin(a) * r1)], fill=(230, 214, 170), width=4 if k % 4 else 7)
    # glowing crystal inlays
    for k in range(12):
        a = k / 12 * math.tau + 0.13
        r = 0.59 * R
        d.ellipse([c + math.cos(a) * r - 10, c + math.sin(a) * r - 10, c + math.cos(a) * r + 10, c + math.sin(a) * r + 10], fill=(140, 208, 222))
    # brass spokes between the inner rings
    for k in range(8):
        a = k / 8 * math.tau
        d.line([(c + math.cos(a) * 0.23 * R, c + math.sin(a) * 0.23 * R), (c + math.cos(a) * 0.45 * R, c + math.sin(a) * 0.45 * R)], fill=(214, 160, 60), width=10)
        d.line([(c + math.cos(a) * 0.23 * R, c + math.sin(a) * 0.23 * R), (c + math.cos(a) * 0.45 * R, c + math.sin(a) * 0.45 * R)], fill=(246, 206, 110), width=3)
    # engraved rune ring (small original glyphs) between the 0.72 and 0.83 rings
    for k in range(36):
        a = k / 36 * math.tau
        gx, gy = c + math.cos(a) * 0.775 * R, c + math.sin(a) * 0.775 * R
        if k % 2:
            continue
        kind = (k // 2) % 4
        col_r = (150, 198, 196)
        if kind == 0:
            d.ellipse([gx - 9, gy - 9, gx + 9, gy + 9], outline=col_r, width=4)
        elif kind == 1:
            d.polygon([(gx, gy - 11), (gx + 10, gy + 8), (gx - 10, gy + 8)], outline=col_r, width=4)
        elif kind == 2:
            d.line([(gx - 9, gy), (gx + 9, gy)], fill=col_r, width=4)
            d.line([(gx, gy - 9), (gx, gy + 9)], fill=col_r, width=4)
        else:
            d.arc([gx - 10, gy - 10, gx + 10, gy + 10], 30, 300, fill=col_r, width=4)
        if k % 6 == 0:
            d.ellipse([gx - 4, gy - 4, gx + 4, gy + 4], fill=(190, 236, 240))
    # gear-tooth rim
    for k in range(72):
        a0 = k / 72 * math.tau
        if k % 2:
            continue
        pts = [(c + math.cos(a0 + da) * rr * R, c + math.sin(a0 + da) * rr * R) for (da, rr) in [(0.0, 0.945), (0.06, 0.945), (0.05, 0.985), (0.01, 0.985)]]
        d.polygon(pts, fill=(198, 146, 52))
    # constellation lines across the middle ring
    stars = [(0.3, 0.55), (0.62, 0.52), (1.1, 0.62), (1.5, 0.5), (2.3, 0.6), (2.9, 0.53), (3.6, 0.62), (4.3, 0.5), (5.0, 0.58), (5.7, 0.52)]
    pts = [(c + math.cos(a) * r * R, c + math.sin(a) * r * R) for (a, r) in stars]
    for i in range(len(pts) - 1):
        if i % 3 != 2:
            d.line([pts[i], pts[i + 1]], fill=(176, 142, 100), width=3)
    for (x, y) in pts:
        d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=(255, 236, 170))
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
    rim.add(rim_v, rim_f, col('#bda486'))
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
    orbit_ambience(c)
    path = os.path.join(OUT, 'orbit.png')
    lib.render_to(path)
    return path


# Spectator balconies for Orbit Dodge (board px of the balcony centre and its deck height in world
# units). OrbitDodge.ts stands NPCs on these: deck screen y = by - BALCONY_Z * 100 * sin(65deg).
ORBIT_BALCONIES = [(255, 380), (1665, 380)]
BALCONY_Z = 0.55


def gear(cx, cy, cz, r, teeth, thick, normal_y=True):
    """Flat brass gear facing the camera (in the XZ plane)."""
    verts, faces = [], []
    n = teeth * 4
    ring = []
    for k in range(n):
        a = k / n * math.tau
        tooth = (k // 2) % 2 == 0
        rr = r * (1.0 if tooth else 0.86)
        ring.append((math.cos(a) * rr, math.sin(a) * rr))
    for yy in (0.0, -thick):
        verts.append((cx, cy + yy, cz))
        for (x, z) in ring:
            verts.append((cx + x, cy + yy, cz + z))
    m = n + 1
    for k in range(n):
        a, b = 1 + k, 1 + (k + 1) % n
        faces.append((m, m + b, m + a))  # front (towards camera, -Y)
        faces.append((0, a, b))
        faces.append((a, b, m + b, m + a))
    return verts, faces


def orbit_ambience(c):
    mats = props.mats()
    metal, stone = lib.MeshBuilder(), lib.MeshBuilder()
    # clockwork visible on the drum below the brass band
    gears = lib.MeshBuilder()
    for (dx, rr, teeth, z) in [(-3.6, 0.9, 12, -1.15), (-2.3, 0.55, 9, -0.95), (2.9, 1.05, 14, -1.25), (4.2, 0.6, 10, -0.9)]:
        gx = c.x + dx
        gy = c.y - math.sqrt(max(0.0, (ORBIT_R - 0.5) ** 2 - dx * dx)) - 0.05
        v, f = gear(gx, gy, z, rr, teeth, 0.08)
        gears.add(v, f, col('#d9a441'))
        v, f = lib.blob((gx, gy - 0.1, z), rr * 0.22, rough=0.0, subdiv=2)
        metal.add(v, f, col('#8a5a1a'))
    # hanging festival banners around the front of the rim
    cloth = lib.MeshBuilder()
    for k in range(9):
        a = math.pi * (0.12 + 0.76 * k / 8)
        bx, by = c.x + math.cos(a) * (ORBIT_R + 0.3), c.y - math.sin(a) * (ORBIT_R + 0.3)
        ang = math.atan2(-math.sin(a), math.cos(a)) + math.pi / 2
        w2, hh = 0.32, 0.95
        ca, sa = math.cos(ang), math.sin(ang)
        pts = [(-w2, 0.0), (w2, 0.0), (w2, -hh), (0.0, -hh - 0.3), (-w2, -hh)]
        v = [(bx + px * ca, by + px * sa, -0.3 + pz) for (px, pz) in pts]
        v += [(bx + px * ca - 0.02 * sa, by + px * sa + 0.02 * ca, -0.3 + pz) for (px, pz) in pts]
        f = [(0, 1, 2, 3, 4), (9, 8, 7, 6, 5)]
        cloth.add(v, f, col('#1fa5a0' if k % 2 == 0 else '#ff6b5e'))
        v, f = lib.blob((bx - 0.05 * sa, by + 0.05 * ca - 0.03, -0.3 - 0.45), 0.13, squash=(1.0, 0.4, 1.0), rough=0.0, subdiv=2)
        metal.add(v, f, col('#f2c14e'))
    cloth.build('banners', lib.attr_mat('cloth', rough=0.8, sheen=0.4))
    # floating spectator balconies with railings, lanterns and bunting
    for (bx, by) in ORBIT_BALCONIES:
        w = board_to_world(bx, by, 0.0)
        R = 1.45
        v, f = lib.lathe([(R + 0.08, BALCONY_Z), (0.0, BALCONY_Z)], 40, (w.x, w.y, 0.0), cap_bottom=False, cap_top=False)
        stone.add(v, f, col('#f1e7d8'))
        v, f = lib.lathe([(R + 0.08, BALCONY_Z), (R + 0.08, BALCONY_Z - 0.25), (R - 0.2, BALCONY_Z - 0.6), (0.6, BALCONY_Z - 1.6), (0.15, BALCONY_Z - 2.3)], 40, (w.x, w.y, 0.0), cap_bottom=False, cap_top=False)
        stone.add(v, f, col('#d8cbb8'))
        # railing: brass posts and a top rail around the back half (front stays open)
        rail = []
        for k in range(15):
            a = math.pi * (0.05 + 0.9 * k / 14)
            px, py = w.x + math.cos(a) * R, w.y + math.sin(a) * R
            v, f = lib.cylinder((px, py, BALCONY_Z), 0.035, 0.035, 0.42, 8)
            metal.add(v, f, col('#e0a93f'))
            rail.append((px, py, BALCONY_Z + 0.42))
        v, f = lib.tube(rail, 0.045, 8)
        metal.add(v, f, col('#f2c14e'))
        props.lantern(bx - 105, by - 40, 1.0)
        props.lantern(bx + 105, by - 40, 1.0)
    metal.build('ambience_metal', mats['metal'])
    # flat-shaded so the teeth read crisply (smooth normals smear the fan into a starburst)
    gears.build('gears', mats['metal'], smooth=False)
    stone.build('balconies', mats['stone_big'])


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
    region = (110, base_y - 70, 1810, base_y + 90)
    stage_planks_texture(tex, region)
    floor_m = ground_image_material('stage', tex, region, rough=0.55)
    x0, y0, x1, y1 = region
    top = [tuple(board_to_world(x, y, 0.0)) for (x, y) in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]
    top = [(v[0], v[1], 0.08) for v in top]
    bot = [tuple(board_to_world(x, y, -0.45)) for (x, y) in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]
    lib.mesh_object('stage_top', top, [(3, 2, 1, 0)], smooth=False, material=floor_m)
    sb = lib.MeshBuilder()
    sb.add(top + bot, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], col('#d8cbb8'))
    sb.build('stage_sides', props.mats()['stone'], smooth=False)
    trim = lib.MeshBuilder()
    a, b = board_to_world(x0, y1, 0), board_to_world(x1, y1, 0)
    v, f = lib.box(((a.x + b.x) / 2, a.y - 0.02, 0.03), (b.x - a.x, 0.08, 0.12))
    trim.add(v, f, col('#e0a93f'))
    trim.build('stage_trim', props.mats()['metal'])
    stage_dressing(region)
    stage_island(960, base_y + 30, 1010, 175, seed=5)
    # the lawn in front of the stage: flower beds, lanterns on short posts and a few supplies
    rnd_f = random.Random(33)
    flowers, leaves_f, wood_f = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    for k in range(14):
        fx = 140 + k * 128 + rnd_f.uniform(-30, 30)
        fy = base_y + 118 + rnd_f.uniform(-8, 26)
        terrain.flower_bed(flowers, leaves_f, fx, fy, rnd_f)
    for (fx, fy) in [(70, base_y + 120), (1850, base_y + 120)]:
        terrain.bush(leaves_f, fx, fy, rnd_f, 1.2, berries=flowers)
    for (fx, fy) in [(250, base_y + 150), (1670, base_y + 150)]:
        terrain.barrel(wood_f, fx, fy, rnd_f)
        terrain.crate(wood_f, fx + 60, fy + 6, rnd_f, 0.9)
    flowers.build('lawn_flowers', lib.attr_mat('flower', rough=0.55, subsurface=0.25))
    leaves_f.build('lawn_leaves', lib.attr_mat('leaf', rough=0.78, ao=0.5))
    wood_f.build('lawn_wood', props.mats()['wood'])
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


# ------------------------------------------------------------------------------------------
# Results podium: x and height by finishing place (1st in the centre). Must match ResultsScene.
RESULT_X = [960, 600, 1320, 1680]
RESULT_H = [230, 160, 110, 60]
RESULT_BASE = 880
RANK_ACCENT = ['#f2c14e', '#d9e2ea', '#d8894a', '#5fb3ad']
RANK_TOP = ['#fff0c2', '#f2f5f8', '#f8dcc2', '#e8efea']


def result_podium(bx, base_y, h_px, rank):
    P = props.Prop(f'podium_{rank}')
    c = board_to_world(bx, base_y, 0.0)
    x, y = c.x, c.y
    H = h_px / lib.screen_height(1.0)
    r = 1.28
    v, f = lib.lathe([(r + 0.14, 0.0), (r + 0.14, 0.1), (r + 0.02, 0.17), (r, 0.2), (r, H - 0.16), (r + 0.09, H - 0.12), (r + 0.09, H - 0.02)], 56, (x, y, 0), cap_top=False)
    P.b['stone'].add(v, f, col('#efe4d2'))
    v, f = lib.lathe([(r + 0.09, H - 0.02), (r + 0.09, H), (0.0, H)], 56, (x, y, 0), cap_bottom=False)
    P.b['paint'].add(v, f, col(RANK_TOP[rank]))
    acc = col(RANK_ACCENT[rank])
    for z0, z1, rr in [(0.2, 0.27, r + 0.005), (H - 0.22, H - 0.15, r + 0.005)]:
        v, f = lib.lathe([(rr, z0), (rr + 0.025, z0), (rr + 0.025, z1), (rr, z1)], 56, (x, y, 0), cap_bottom=False, cap_top=False)
        P.b['metal'].add(v, f, acc)
    v, f = lib.lathe([(r - 0.12, H + 0.003), (r + 0.03, H + 0.003)], 56, (x, y, 0), cap_bottom=False, cap_top=False)
    P.b['metal'].add(v, f, acc)
    # glowing studs around the lower band
    for k in range(14):
        a = k / 14 * math.tau
        v, f = lib.box((x + math.cos(a) * (r + 0.02), y + math.sin(a) * (r + 0.02), 0.5 if H > 1.0 else 0.34), (0.1, 0.04, 0.12), rot_z=a + math.pi / 2)
        P.b['glow'].add(v, f, col('#5ce1ff'))
    # front medallion facing the camera (where the rank numeral sits in-game)
    if True:
        R = 0.5 if rank == 0 else 0.42 if rank < 3 else 0.2
        mz = (h_px * 0.45 + r * PX * lib.COSB) / (PX * lib.SINB)
        lo, hi = (0.3, 0.25) if rank < 3 else (0.08, 0.1)
        mz = min(max(mz, R + lo), H - R - hi)
        # the disc must sit proud of the drum's nearest point (y - r), not just its rim chord
        fy = y - r + 0.03
        # enamel disc (triangle fan facing the camera) with a gold tube rim
        N = 48
        fz = y - r - 0.05
        ev = [(x, fz, mz)] + [(x + math.cos(k / N * math.tau) * R, fz, mz + math.sin(k / N * math.tau) * R) for k in range(N)]
        ef = [(0, 1 + (k + 1) % N, 1 + k) for k in range(N)]
        base = len(ev)
        ev += [(x + math.cos(k / N * math.tau) * R, fy, mz + math.sin(k / N * math.tau) * R) for k in range(N)]
        ef += [(1 + k, 1 + (k + 1) % N, base + (k + 1) % N, base + k) for k in range(N)]
        lib.mesh_object(f'medal_{rank}', ev, ef, smooth=False, material=lib.simple_mat(f'enamel_{rank}', RANK_ACCENT[rank], rough=0.38))
        ring = [(x + math.cos(k / N * math.tau) * (R + 0.03), fz, mz + math.sin(k / N * math.tau) * (R + 0.03)) for k in range(N + 1)]
        v, f = lib.tube(ring, 0.055, 10)
        P.b['metal'].add(v, f, col('#f2c14e'))
    return P.build()


def stage_island(cx, cy, rx, ry, seed=5):
    """Floating rock island under a stage so it never ends abruptly in mid-air."""
    outline = blob_outline(cx, cy, rx, ry, seed=seed, lobes=9, wobble=0.05)
    terrain.set_canvas(SW, SH + 600, 4)
    make_empty_mask()
    isl_m = terrain.island_material(os.path.join(OUT, 'empty_mask.png'))
    return island_under(outline, f'stage_island_{seed}', isl_m)


def stage_planks_texture(path, region):
    """Festival stage boards: long planks with varied tones, nail heads, seams and a painted
    gold-edged border (tiles read as a flat strip at this camera angle; boards read as a stage)."""
    x0, y0, x1, y1 = region
    w, h = int(x1 - x0), int(y1 - y0)
    rnd = random.Random(17)
    im = Image.new('RGB', (w, h), (96, 62, 38))
    d = ImageDraw.Draw(im)
    ph = 18
    tones = [(196, 142, 92), (184, 130, 82), (206, 154, 102), (176, 122, 76), (190, 138, 88)]
    for row, py in enumerate(range(0, h, ph)):
        x = -rnd.randint(0, 220)
        while x < w:
            L = rnd.randint(160, 340)
            c = rnd.choice(tones)
            d.rectangle([x + 1, py + 1, x + L - 2, py + ph - 2], fill=c)
            d.rectangle([x + 1, py + 1, x + L - 2, py + 4], fill=tuple(min(255, v + 18) for v in c))
            for gx in range(x + 12, x + L - 12, rnd.randint(40, 70)):  # grain streaks
                d.line([(gx, py + 6), (gx + rnd.randint(20, 50), py + 6 + rnd.randint(-2, 6))], fill=tuple(int(v * 0.86) for v in c), width=1)
            for nx in (x + 6, x + L - 9):
                d.ellipse([nx, py + ph // 2 - 2, nx + 3, py + ph // 2 + 1], fill=(90, 70, 56))
            x += L
    arr = np.asarray(im).astype(np.float32)
    n = np.asarray(Image.effect_noise((w // 16 + 1, h // 16 + 1), 40).resize((w, h), Image.BICUBIC), np.float32) / 255.0
    arr *= (0.9 + 0.16 * n)[..., None]
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    bw = 16
    for (bx0, by0, bx1, by1) in [(0, 0, w, bw), (0, h - bw, w, h)]:
        d.rectangle([bx0, by0, bx1, by1], fill=(31, 120, 128))
        d.rectangle([bx0, by0 + 2, bx1, by0 + 5], fill=(240, 190, 80))
        d.rectangle([bx0, by1 - 5, bx1, by1 - 2], fill=(240, 190, 80))
    im.save(path)


def stage_dressing(region, colors=('#1fa5a0', '#ff6b5e', '#f2c14e'), banners=True, lamps=True):
    """Banner skirt along the stage front and brass lamp posts at both ends."""
    x0, y0, x1, y1 = region
    cloth, metal, glow = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    n = int((x1 - x0) / 120) if banners else 0
    for k in range(n):
        bx = x0 + (k + 0.5) * (x1 - x0) / n
        w = board_to_world(bx, y1, 0.0)
        pts = [(-0.34, 0.0), (0.34, 0.0), (0.34, -0.3), (0.0, -0.42), (-0.34, -0.3)]
        v = [(w.x + px, w.y - 0.07, 0.02 + pz) for (px, pz) in pts] + [(w.x + px, w.y - 0.05, 0.02 + pz) for (px, pz) in pts]
        cloth.add(v, [(0, 1, 2, 3, 4), (9, 8, 7, 6, 5)], col(colors[k % len(colors)]))
        vv, ff = lib.blob((w.x, w.y - 0.09, -0.12), 0.05, rough=0.0, subdiv=1)
        metal.add(vv, ff, col('#f2c14e'))
    for bx in ((x0 + 30, x1 - 30) if lamps else ()):
        w = board_to_world(bx, y1 - 10, 0.0)
        vv, ff = lib.cylinder((w.x, w.y, 0.08), 0.06, 0.05, 1.6, 10)
        metal.add(vv, ff, col('#e0a93f'))
        vv, ff = lib.blob((w.x, w.y, 1.78), 0.16, squash=(1.0, 1.0, 1.2), rough=0.0, subdiv=2)
        glow.add(vv, ff, col('#ffd27a'))
        vv, ff = lib.lathe([(0.2, 1.88), (0.02, 2.02)], 12, (w.x, w.y, 0.0), cap_bottom=True, cap_top=False)
        metal.add(vv, ff, col('#c98a1b'))
    cloth.build('stage_banners', lib.attr_mat('cloth', rough=0.8, sheen=0.4))
    metal.build('stage_metal', props.mats()['metal'])
    glow.build('stage_lamps', props.mats()['glow'])


def festival_stage(base_y, region, trees=True, dressing=True):
    tex = os.path.join(OUT, f'stage_floor_{int(base_y)}.png')
    stage_planks_texture(tex, region)
    floor_m = ground_image_material('stage', tex, region, rough=0.55)
    x0, y0, x1, y1 = region
    top = [tuple(board_to_world(x, y, 0.0)) for (x, y) in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]
    top = [(v[0], v[1], 0.08) for v in top]
    bot = [tuple(board_to_world(x, y, -0.45)) for (x, y) in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]
    lib.mesh_object('stage_top', top, [(3, 2, 1, 0)], smooth=False, material=floor_m)
    sb = lib.MeshBuilder()
    sb.add(top + bot, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], col('#d8cbb8'))
    sb.build('stage_sides', props.mats()['stone'], smooth=False)
    trim = lib.MeshBuilder()
    a, b = board_to_world(x0, y1, 0), board_to_world(x1, y1, 0)
    v, f = lib.box(((a.x + b.x) / 2, a.y - 0.02, 0.03), (b.x - a.x, 0.08, 0.12))
    trim.add(v, f, col('#e0a93f'))
    trim.build('stage_trim', props.mats()['metal'])
    if dressing:
        stage_dressing(region)


def results():
    set_view(16)
    lib.reset(12 if A.preview else 36)
    lights(44, -30)
    lib.camera_for_region(0, 0, SW, SH, scale=0.5 if A.preview else 1.0)
    base_y = RESULT_BASE
    festival_stage(base_y, (130, base_y - 150, 1790, base_y + 70), dressing=False)
    stage_island(960, base_y - 30, 1010, 190, seed=9)
    for rank in range(4):
        result_podium(RESULT_X[rank], base_y, RESULT_H[rank], rank)
    # festival backdrop behind the podiums
    props.bunting(420, base_y - 150, 700, 1.5)
    props.bunting(1500, base_y - 150, 700, 1.5)
    for x in (420, 1500):
        props.lantern(x, base_y - 140, 1.7)
    props.crystal_gen(70, base_y - 60, 1.0)
    props.crystal_gen(1850, base_y - 60, 1.0)
    rnd = random.Random(21)
    leaves = lib.MeshBuilder()
    wood = lib.MeshBuilder()
    for (x, s_) in [(30, 1.6), (1890, 1.6), (380, 1.1), (1540, 1.1)]:
        terrain.tree_round(leaves, wood, x, base_y - 160, rnd, s_)
    leaves.build('leaves', lib.attr_mat('leaf', rough=0.78, ao=0.5))
    wood.build('wood', lib.attr_mat('wood', rough=0.8, ao=0.3))
    path = os.path.join(OUT, 'results.png')
    lib.render_to(path)
    return path


publish({'title': title, 'gleam': gleam, 'orbit': orbit, 'select': select, 'results': results}[A.scene](), A.scene)
