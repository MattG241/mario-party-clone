"""Shared helpers for the W-SPORTS arenas (mg_court.py, mg_green.py, mg_rink.py).

Same conventions as scripts/art/mg_arenas.py (whose helpers these adapt; that module can't be
imported, it parses its own arguments): an orthographic camera per scene whose ground plane maps 1:1
onto the game's 1920x1080 screen, the house warm key over a cool fill, festival dressing from
mg_dress.py, and sprites rendered with the same camera over a shadow catcher so their shadows match.
"""
from __future__ import annotations

import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ART = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ART)
import lib  # noqa: E402
import mg_dress as dress  # noqa: E402
import props  # noqa: E402
import terrain  # noqa: E402
from lib import PX, board_to_world, col  # noqa: E402

import bpy  # noqa: E402

SW, SH = 1920, 1080
OUT = os.path.join(lib.ROOT, 'art-out', 'sports')
PUB = os.path.join(lib.ROOT, 'public', 'assets', 'rendered')
PUB_MG = os.path.join(PUB, 'mg')
os.makedirs(OUT, exist_ok=True)
os.makedirs(PUB_MG, exist_ok=True)


def set_view(elevation_deg: float) -> None:
    lib.BETA = math.radians(90 - elevation_deg)
    lib.COSB, lib.SINB = math.cos(lib.BETA), math.sin(lib.BETA)


def start(elev: float, samples: int, preview: bool, sun_elev: float = 50, sun_az: float = -35, key: float = 3.5, fill: float = 0.8,
          key_col: str = '#ffe1b4', zenith: str = '#88bfff', horizon: str = '#ffe6c6', ground: str = '#a39c84'):
    """Fresh scene, house light, and the full-screen camera (half size for previews)."""
    set_view(elev)
    lib.reset(10 if preview else samples)
    dress.threads()
    dress.reset_mats()
    props._MATS.clear()
    dress.festival_light(key=key, elev=sun_elev, az=sun_az, fill=fill, angle=3.0, key_col=key_col, zenith=zenith, horizon=horizon, ground=ground)
    return lib.camera_for_region(0, 0, SW, SH, scale=0.5 if preview else 1.0)


def ground_image_material(name: str, img_path: str, region, rough: float = 0.6, bump: float = 0.25, ao: bool = True):
    """Material projecting an image onto the ground plane over screen px `region` (x0, y0, x1, y1)."""
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
    if ao:
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


def island(outline, name='arena_island', extra_h=600, grass=None):
    """Floating island whose top outline is `outline` (screen px polygon)."""
    outline = [(min(max(x, 14), SW - 14), min(max(y, 14), SH + extra_h - 14)) for (x, y) in outline]
    img = Image.new('L', (SW // 4, (SH + extra_h) // 4), 0)
    ImageDraw.Draw(img).polygon([(x / 4, y / 4) for x, y in outline], fill=255)
    img = img.filter(ImageFilter.GaussianBlur(3))
    mask = np.asarray(img, np.float32) / 255.0 > 0.5
    terrain.set_canvas(SW, SH + extra_h, 4)
    mat = dress.island_material(dress.empty_mask(OUT), name=f'{name}_ground', grass=grass)
    return terrain.build_island(['a', 'b'], mask, name, mat)


def greenery(spots_trees, spots_bushes, seed=5, pine=(), blossom=()):
    rnd = random.Random(seed)
    leaves, wood, flowers = lib.MeshBuilder(), lib.MeshBuilder(), lib.MeshBuilder()
    flora = lib.MeshBuilder()
    for (x, y, s) in spots_trees:
        terrain.tree_round(leaves, wood, x, y, rnd, s)
    for (x, y, s) in pine:
        terrain.tree_pine(leaves, wood, x, y, rnd, s)
    for (x, y, s) in blossom:
        terrain.tree_blossom(flora, wood, x, y, rnd, s)
    for (x, y, s) in spots_bushes:
        terrain.bush(leaves, x, y, rnd, s, berries=flowers)
    leaves.build('leaves', lib.attr_mat('leaf', rough=0.78, ao=0.5))
    wood.build('wood', lib.attr_mat('wood', rough=0.8, ao=0.3))
    flowers.build('flowers', lib.attr_mat('flower', rough=0.55))
    flora.build('blossom', lib.attr_mat('blossom', rough=0.7, ao=0.4))


def scatter(outline, keep, rnd, tufts=2400, flowers=40, pebbles=30, shrink=24, region=(0, 0, SW, SH)):
    """Dense grass, flower beds and pebbles over the island top, clear of the play area and props."""
    dress.scatter_grass(dress.poly_mask(outline, SW, SH, shrink), keep, region, rnd, tufts=tufts, flowers=flowers, pebbles=pebbles)


def haze(cam, near_y, far_y=40.0, amount=0.2, color='#d9e8f7', skip=()):
    near = dress.view_depth(cam, board_to_world(960, near_y, 0.0))
    far = dress.view_depth(cam, board_to_world(960, far_y, 0.0))
    dress.depth_haze(near, far, amount, color=color, skip=skip)


def noise_img(w, h, cell, amp=60):
    return np.asarray(Image.effect_noise((w // cell + 1, h // cell + 1), amp).resize((w, h), Image.BICUBIC), np.float32) / 255.0


def publish(path, name, preview, blur=False):
    """public/assets/rendered/scene_<name>.webp (and a soft copy for the intro card's backdrop)."""
    if preview:
        return
    im = Image.open(path).convert('RGBA')
    im.save(os.path.join(PUB, f'scene_{name}.webp'), 'WEBP', quality=90, method=6)
    print('wrote', f'scene_{name}.webp')
    if blur:
        # The intro card's backdrop: the arena, blurred and flattened onto a sky colour.
        bg = Image.new('RGBA', im.size, (150, 196, 236, 255))
        bg.alpha_composite(im)
        soft = bg.convert('RGB').resize((im.width // 4, im.height // 4), Image.LANCZOS).filter(ImageFilter.GaussianBlur(6)).resize(im.size, Image.BICUBIC)
        soft.save(os.path.join(PUB, f'scene_{name}_blur.webp'), 'WEBP', quality=80, method=6)
        print('wrote', f'scene_{name}_blur.webp')


def publish_sprite(path, name, preview, crop=None, feather=0):
    """Publish a sprite render; `feather` px fades the alpha out towards the edges, so a broad soft
    shadow caught around the object never shows the render's rectangle on the ground."""
    if preview:
        return
    im = Image.open(path).convert('RGBA')
    if crop:
        im = im.crop(crop)
    if feather > 0:
        a = np.asarray(im).astype(np.float32)
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        d = np.minimum(np.minimum(xx + 0.5, w - 0.5 - xx), np.minimum(yy + 0.5, h - 0.5 - yy))
        t = np.clip(d / feather, 0, 1)
        a[..., 3] *= t * t * (3 - 2 * t)
        im = Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), 'RGBA')
    im.save(os.path.join(PUB_MG, f'{name}.webp'), 'WEBP', quality=92, method=6)
    print('wrote', f'mg/{name}.webp', im.size)


def shadow_catcher(region, name='catcher', z=0.0):
    """A ground plane over screen px region (x0, y0, x1, y1) that only catches shadows."""
    x0, y0, x1, y1 = region
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    verts = [tuple(board_to_world(x, y, z)) for (x, y) in corners]
    ob = lib.mesh_object(name, verts, [(3, 2, 1, 0)], smooth=False, material=lib.simple_mat(f'{name}_m', '#808080'))
    ob.is_shadow_catcher = True
    return ob


def sprite_camera(x0, y0, w, h, scale=1.0):
    """A camera over a screen region for a sprite render (film transparent, same projection)."""
    for ob in list(bpy.context.scene.objects):
        if ob.type == 'CAMERA':
            bpy.data.objects.remove(ob, do_unlink=True)
    return lib.camera_for_region(x0, y0, w, h, scale=scale)


def hide_all_but(names_prefixes):
    """Hide every mesh from the camera except those whose names start with one of the prefixes."""
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        keep = any(ob.name.startswith(p) for p in names_prefixes)
        ob.hide_render = not keep


def holdout_all_but(names_prefixes):
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            ob.is_holdout = not any(ob.name.startswith(p) for p in names_prefixes)
