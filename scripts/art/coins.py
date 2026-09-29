"""The festival's money: the spinning gold coin and the Star Coin, modelled and rendered in Blender.

    .artenv/bin/python scripts/art/coins.py          # render, then composite into the game
    .artenv/bin/python scripts/art/coins.py --post   # composite the existing renders again
    python3 scripts/build-lite.py --atlas items      # then: the Lite half-size items atlas

Writes:
  art-out/coins/*.png                           raw renders
  public/assets/atlases/items.png + items.json  frames 0-5, the spinning coin ('chip-spin', and the
                                                static coin icon is frame 0)
  src/game/data/spriteMeta.generated.ts         solid bounds of those six frames
  public/assets/rendered/items/star_coin.webp   the Star Coin (texture key 'prism-relic')

The items atlas is otherwise built by `npm run sprites` from the supplied sheet (whose first row is
the old hexagonal chip); run this after that. Everything here is original: a plain coin with the
festival's spiral stamped on it, and a Star Coin with a faceted star on a sunburst, ringed in teal
enamel with gold beads.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'art-out', 'coins')
ATLAS = os.path.join(ROOT, 'public', 'assets', 'atlases')
META = os.path.join(ROOT, 'src', 'game', 'data', 'spriteMeta.generated.ts')
STAR_OUT = os.path.join(ROOT, 'public', 'assets', 'rendered', 'items', 'star_coin.webp')

# The items atlas's logical frame (every item frame shares it) and the coin's size inside it.
FRAME_W, FRAME_H = 389, 365
COIN_PX = 176
# Spin angles (degrees about the vertical) for frames 0-5: face, turning, edge-on, the back turning
# in, and the face again (frame 5 carries the shine). The back is stamped the same.
SPIN = [-14, 34, 62, 88, 128, 166]
TILT = 7  # leaned back a touch so the lower rim shows its thickness
# Star Coin texture size (the old relic's, so every existing scale still fits).
STAR_W, STAR_H = 220, 260
STAR_PX = 204


# ------------------------------------------------------------------------------------------
# Modelling (Blender)
def build_scene(kind: str):
    import bpy
    import bmesh
    from lib import col, lathe, link, mesh_object, reset, tube, world_light

    sc = reset(samples=96)
    sc.view_settings.exposure = 0.0
    # Sky fill for reflections: a warm bright horizon band between a cool sky and a deep amber floor
    # (gold reads as gold when it has something warm and something dark to mirror).
    world_light(1.2, zenith='#e2f1ff', horizon='#fff7e2', ground='#3a2610')

    def area(name, loc, rot, size, energy, color='#fff4e0'):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.shape = 'DISK'
        ld.size = size
        ld.energy = energy
        ld.color = col(color)[:3]
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        ob.rotation_euler = [math.radians(a) for a in rot]
        link(ob)

    # Key from the upper left in front, a cooler fill from the right, a rim from above behind.
    area('key', (-4.0, -5.0, 4.5), (-48, -34, 0), 3.0, 1500)
    area('fill', (5.5, -4.0, 0.5), (-80, 52, 0), 6.0, 300, '#dcecff')
    area('rim', (0.0, 4.0, 5.0), (40, 0, 0), 3.0, 900)

    def mat(name, color, rough, metal=1.0, emit=0.0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = col(color)
        b.inputs['Metallic'].default_value = metal
        b.inputs['Roughness'].default_value = rough
        if emit:
            b.inputs['Emission Color'].default_value = col(color)
            b.inputs['Emission Strength'].default_value = emit
        return m

    gold = mat('gold', '#ffc83c', 0.2, emit=0.07)
    field = mat('field', '#f4ab2a', 0.34, emit=0.05)
    bright = mat('bright', '#ffe27a', 0.13, emit=0.1)

    def finish(ob, mats, pick):
        """Assign materials by face centre (pick(x, y, z) -> index), weld the lathe's centre, smooth."""
        me = ob.data
        for m in mats:
            if m.name not in [x.name for x in me.materials]:
                me.materials.append(m)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        for f in bm.faces:
            c = f.calc_center_median()
            f.material_index = pick(c.x, c.y, c.z)
            f.smooth = True
        # Crisp steps between rim and field; the gentle curves stay smooth.
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(35):
                e.smooth = False
        bm.to_mesh(me)
        bm.free()
        me.update()
        mod = ob.modifiers.new('ws', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
        return ob

    parts = []
    if kind == 'coin':
        # Raised rim, recessed field, a reeded edge.
        prof = [(0.0, 0.058), (0.69, 0.058), (0.73, 0.080), (0.79, 0.104), (0.88, 0.112), (0.95, 0.102),
                (0.99, 0.078), (1.0, 0.040), (1.0, -0.040), (0.99, -0.078), (0.95, -0.102), (0.88, -0.112),
                (0.79, -0.104), (0.73, -0.080), (0.69, -0.058), (0.0, -0.058)]
        sides = 720
        v, f = lathe(prof, sides=sides, cap_bottom=False, cap_top=False)
        v = [list(p) for p in v]
        for i, (r, z) in enumerate(prof):
            if r >= 0.99 and abs(z) <= 0.079:
                for k in range(sides):
                    a = k / sides * math.tau
                    bump = 0.0045 if math.sin(120 * a) > 0 else 0.0
                    p = v[i * sides + k]
                    p[0] = math.cos(a) * (r + bump)
                    p[1] = math.sin(a) * (r + bump)
        body = mesh_object('coin', v, f)
        finish(body, [gold, field], lambda x, y, z: 1 if math.hypot(x, y) < 0.70 and abs(z) < 0.07 else 0)
        parts.append(body)
        # The festival spiral stamped on both faces, and a boss in the middle.
        for side in (1, -1):
            turns = 2.1
            pts = []
            n = 220
            for i in range(n + 1):
                t = i / n
                th = t * turns * math.tau
                r = 0.10 + 0.47 * t
                pts.append((side * math.cos(th) * r, math.sin(th) * r, side * 0.066))
            sv, sf = tube(pts, lambda t: 0.034 + 0.02 * t, sides=10)
            sp = mesh_object(f'spiral{side}', sv, sf, material=bright)
            parts.append(sp)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.085, location=(0, 0, side * 0.06))
            boss = bpy.context.active_object
            boss.scale = (1, 1, 0.55)
            boss.data.materials.append(bright)
            bpy.ops.object.shade_smooth()
            parts.append(boss)
    else:
        teal = mat('enamel', '#1fb8c9', 0.22, metal=0.0, emit=0.12)
        sun = bpy.data.materials.new('sunburst')
        sun.use_nodes = True
        nt = sun.node_tree
        b = nt.nodes['Principled BSDF']
        b.inputs['Metallic'].default_value = 1.0
        b.inputs['Roughness'].default_value = 0.34
        tc = nt.nodes.new('ShaderNodeTexCoord')
        grad = nt.nodes.new('ShaderNodeTexGradient')
        grad.gradient_type = 'RADIAL'
        mul = nt.nodes.new('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = 24
        frac = nt.nodes.new('ShaderNodeMath')
        frac.operation = 'FRACT'
        gt = nt.nodes.new('ShaderNodeMath')
        gt.operation = 'GREATER_THAN'
        gt.inputs[1].default_value = 0.5
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.inputs['A'].default_value = col('#e8951a')
        mix.inputs['B'].default_value = col('#ffbf3f')
        nt.links.new(tc.outputs['Object'], grad.inputs['Vector'])
        nt.links.new(grad.outputs['Fac'], mul.inputs[0])
        nt.links.new(mul.outputs[0], frac.inputs[0])
        nt.links.new(frac.outputs[0], gt.inputs[0])
        nt.links.new(gt.outputs[0], mix.inputs['Factor'])
        nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
        b.inputs['Emission Color'].default_value = col('#ffb030')
        b.inputs['Emission Strength'].default_value = 0.05
        prof = [(0.0, 0.050), (0.61, 0.050), (0.63, 0.068), (0.65, 0.074), (0.79, 0.074), (0.81, 0.100),
                (0.87, 0.126), (0.94, 0.124), (0.985, 0.098), (1.0, 0.055), (1.0, -0.055), (0.985, -0.098),
                (0.94, -0.124), (0.87, -0.126), (0.81, -0.100), (0.79, -0.074), (0.65, -0.074), (0.63, -0.068),
                (0.61, -0.050), (0.0, -0.050)]
        v, f = lathe(prof, sides=256, cap_bottom=False, cap_top=False)
        body = mesh_object('starcoin', v, f)

        def pick(x, y, z):
            r = math.hypot(x, y)
            if r < 0.615 and abs(z) < 0.06:
                return 1
            if 0.625 < r < 0.795 and abs(z) < 0.08:
                return 2
            return 0

        finish(body, [gold, sun, teal], pick)
        parts.append(body)
        # Gold beads around the enamel ring.
        for i in range(20):
            a = i / 20 * math.tau + math.pi / 2
            bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.034, location=(math.cos(a) * 0.72, math.sin(a) * 0.72, 0.078))
            bead = bpy.context.active_object
            bead.scale = (1, 1, 0.7)
            bead.data.materials.append(bright)
            bpy.ops.object.shade_smooth()
            parts.append(bead)
        # A faceted five-point star: ridges run from its peak out to each point.
        ro, ri, zb, zt = 0.53, 0.23, 0.046, 0.215
        outline = []
        for i in range(10):
            a = math.pi / 2 + i * math.pi / 5
            r = ro if i % 2 == 0 else ri
            outline.append((math.cos(a) * r, math.sin(a) * r))
        verts = [(0.0, 0.0, zt)]
        verts += [(x, y, zb + 0.03) for (x, y) in outline]
        verts += [(x * 1.03, y * 1.03, zb - 0.01) for (x, y) in outline]
        faces = []
        for i in range(10):
            j = (i + 1) % 10
            faces.append((0, 1 + i, 1 + j))
            faces.append((1 + i, 11 + i, 11 + j, 1 + j))
        star = mesh_object('star', verts, faces, smooth=False, material=bright)
        parts.append(star)

    # Stand the coin up to face the camera (its axis is +Z; the camera looks along +Y).
    import bpy as _bpy
    pivot = _bpy.data.objects.new('pivot', None)
    link(pivot)
    for ob in parts:
        ob.parent = pivot
    pivot.rotation_mode = 'XYZ'
    return pivot


def camera(width_units: float, w: int, h: int):
    import bpy
    from lib import link

    sc = bpy.context.scene
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    # Ortho scale spans the longer side of the frame.
    cd.ortho_scale = width_units if w >= h else width_units * h / w
    ob = bpy.data.objects.new('cam', cd)
    ob.location = (0, -10, 0)
    ob.rotation_euler = (math.radians(90), 0, 0)
    link(ob)
    sc.camera = ob
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100


def pose(pivot, spin: float, tilt: float):
    from mathutils import Euler, Matrix

    # Face the camera (+Z -> -Y), lean back by `tilt`, then spin about the vertical.
    m = Matrix.Rotation(math.radians(spin), 4, 'Z') @ Matrix.Rotation(math.radians(-tilt), 4, 'X') @ Matrix.Rotation(math.radians(90), 4, 'X')
    pivot.rotation_euler = m.to_euler('XYZ')


def render():
    from lib import render_to

    os.makedirs(OUT, exist_ok=True)
    # Coin frames: rendered at twice the atlas size, shrunk when composited.
    pivot = build_scene('coin')
    w, h = FRAME_W * 2, FRAME_H * 2
    camera(2.0 * FRAME_W / COIN_PX, w, h)
    for i, a in enumerate(SPIN):
        pose(pivot, a, TILT)
        render_to(os.path.join(OUT, f'coin_{i}.png'))
    # The Star Coin, turned a little so its chunky rim shows.
    pivot = build_scene('star')
    w, h = STAR_W * 2, STAR_H * 2
    camera(2.0 * STAR_W / STAR_PX, w, h)
    pose(pivot, -16, 6)
    render_to(os.path.join(OUT, 'star.png'))


# ------------------------------------------------------------------------------------------
# Compositing (PIL only)
def sparkle(d: ImageDraw.ImageDraw, x: float, y: float, r: float, color=(255, 250, 225)):
    """A four-point glint."""
    w = r * 0.22
    d.polygon([(x, y - r), (x + w, y - w), (x + r, y), (x + w, y + w), (x, y + r), (x - w, y + w), (x - r, y), (x - w, y - w)], fill=color + (255,))


def glow_under(img: Image.Image, color, radius: float, strength: float) -> Image.Image:
    a = np.asarray(img.split()[3], dtype=np.float32) / 255
    halo = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))
    h = np.asarray(halo, dtype=np.float32) / 255 * strength
    base = Image.new('RGBA', img.size, color + (0,))
    base.putalpha(Image.fromarray((np.clip(h, 0, 1) * 255).astype(np.uint8)))
    return Image.alpha_composite(base, img)


def coin_frames() -> tuple[list[Image.Image], list[list[int]]]:
    """The finished frames, and each bare coin's solid bounds (the sprite anchor ignores glints)."""
    frames = []
    solids = []
    for i in range(6):
        big = Image.open(os.path.join(OUT, f'coin_{i}.png')).convert('RGBA')
        im = big.resize((FRAME_W, FRAME_H), Image.LANCZOS)
        solids.append(solid(im))
        im = glow_under(im, (255, 206, 90), 10, 0.55 if i != 5 else 0.9)
        d = ImageDraw.Draw(im)
        cx, cy = FRAME_W / 2, FRAME_H / 2
        # A couple of glints that drift around the rim as it turns.
        ang = math.radians(-50 + i * 24)
        r = COIN_PX * 0.5
        sparkle(d, cx + math.cos(ang) * r * 0.78, cy + math.sin(ang) * r * 0.78 * 0.95, 13 if i != 5 else 22)
        sparkle(d, cx - math.cos(ang) * r * 0.95, cy - math.sin(ang) * r * 0.9, 7)
        if i == 5:
            # The shine frame: a big glint flashing across the face.
            sparkle(d, cx - r * 0.34, cy - r * 0.36, 24)
            sparkle(d, cx + r * 0.42, cy + r * 0.3, 11)
        frames.append(im)
    return frames, solids


def trim(im: Image.Image):
    a = np.asarray(im.split()[3])
    ys, xs = np.nonzero(a > 2)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return im.crop((x0, y0, x1, y1)), int(x0), int(y0)


def solid(im: Image.Image):
    a = np.asarray(im.split()[3])
    ys, xs = np.nonzero(a >= 160)
    return [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]


def write_atlas(frames: list[Image.Image], solids: list[list[int]]):
    with open(os.path.join(ATLAS, 'items.json')) as fh:
        data = json.load(fh)
    sheet = Image.open(os.path.join(ATLAS, 'items.png')).convert('RGBA')
    fr = data['frames']
    # Clear the old chip frames, then shelve the coin frames in the free band under everything else.
    for k in map(str, range(6)):
        f = fr[k]['frame']
        sheet.paste((0, 0, 0, 0), (f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
    others = [v['frame'] for k, v in fr.items() if k not in {str(i) for i in range(6)}]
    top = max(f['y'] + f['h'] for f in others) + 4
    x = 2
    metas = []
    for i, im in enumerate(frames):
        t, ox, oy = trim(im)
        if x + t.width > sheet.width:
            raise SystemExit('coin frames do not fit in one row')
        if top + t.height > sheet.height:
            raise SystemExit('coin frames do not fit under the other items')
        sheet.paste(t, (x, top))
        fr[str(i)] = {
            'frame': {'x': x, 'y': top, 'w': t.width, 'h': t.height},
            'rotated': False,
            'trimmed': True,
            'spriteSourceSize': {'x': ox, 'y': oy, 'w': t.width, 'h': t.height},
            'sourceSize': {'w': FRAME_W, 'h': FRAME_H},
        }
        metas.append(solids[i])
        x += t.width + 2
    sheet.save(os.path.join(ATLAS, 'items.png'), optimize=True)
    with open(os.path.join(ATLAS, 'items.json'), 'w') as fh:
        json.dump(data, fh, separators=(',', ':'))  # compact, like build-sprites.mjs writes it
    # The anchor metadata for those frames (sprites centre on their solid bounds).
    src = open(META).read()
    head = src.index('"items":{')
    start = src.index('"frames":[', head) + len('"frames":[')
    body = src[start:]
    for i, m in enumerate(metas):
        m_json = json.dumps({'w': FRAME_W, 'h': FRAME_H, 'solid': m}, separators=(',', ':'))
        nth = [mm for mm in re.finditer(r'\{"w":\d+,"h":\d+,"solid":\[[^\]]*\]\}', body)][i]
        body = body[:nth.start()] + m_json + body[nth.end():]
    with open(META, 'w') as fh:
        fh.write(src[:start] + body)
    print('atlas: coin frames at y', top, 'solid', metas[0])


def write_star():
    big = Image.open(os.path.join(OUT, 'star.png')).convert('RGBA')
    im = big.resize((STAR_W, STAR_H), Image.LANCZOS)
    im = glow_under(im, (255, 214, 110), 7, 0.6)
    d = ImageDraw.Draw(im)
    sparkle(d, STAR_W * 0.80, STAR_H * 0.26, 14)
    sparkle(d, STAR_W * 0.17, STAR_H * 0.72, 8)
    os.makedirs(os.path.dirname(STAR_OUT), exist_ok=True)
    im.save(STAR_OUT, 'WEBP', quality=92, method=6)
    im.save(os.path.join(OUT, 'star_final.png'))
    print('star coin:', STAR_OUT)


def post():
    frames, solids = coin_frames()
    for i, f in enumerate(frames):
        f.save(os.path.join(OUT, f'coin_final_{i}.png'))
    write_atlas(frames, solids)
    write_star()


if __name__ == '__main__':
    if '--post' not in sys.argv:
        render()
    if '--no-post' not in sys.argv:
        post()
