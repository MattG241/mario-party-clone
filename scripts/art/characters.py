"""Render the heroes as 3D sprite sheets in the same Blender look as the rest of the game.

    .artenv/bin/python scripts/art/characters.py [--hero kip,mossi] [--anims idle,walk] [--preview]
                                                  [--samples 48] [--pack-only]

Each hero (char_models.py) is posed for every animation (char_anims.py), rendered with the board's
key light and sky fill through a camera 12° above the horizon, and packed into a trimmed atlas
(public/assets/atlases/hero_<id>.webp/.json) plus src/game/data/heroSprites.generated.ts with
per-frame artwork bounds, the frame list of every animation and a few anchor points (hands, face).
Frames keep a fixed registration: the feet sit at FEET in every frame.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from PIL import Image  # noqa: E402

from char_rig import R, T, arm_rot, bend, knee, leg_rot  # noqa: E402
from char_models import Kip, Mats, instantiate  # noqa: E402
import char_anims  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--hero', default='', help='comma-separated hero ids (default: every hero)')
p.add_argument('--anims', default='')
p.add_argument('--preview', action='store_true')
p.add_argument('--samples', type=int, default=40)
p.add_argument('--ss', type=float, default=2.0, help='supersampling factor')
p.add_argument('--pack-only', action='store_true')
p.add_argument('--out', default='')
# parse_known_args: npcs.py imports this module (its camera, lighting and packing) with its own flags
A, _ = p.parse_known_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

FRAME = 389  # output frame size (matches the old sheets' padded cells)
FEET = (194.5, 304.0)  # where the ground point under the hero lands in every frame
PXU = 108.0  # pixels per world unit
CAM_ELEV = 12.0
OUT = A.out or os.path.join(lib.ROOT, 'art-out', 'chars')
ATLAS_DIR = os.path.join(lib.ROOT, 'public', 'assets', 'atlases')
GEN_TS = os.path.join(lib.ROOT, 'src', 'game', 'data', 'heroSprites.generated.ts')

HEROES = {'kip': Kip}
for _name in ('mossi', 'tumble', 'zippa', 'luffy', 'goku', 'batman', 'spiderman', 'naruto', 'ironman', 'sonic', 'spongebob'):
    # each of the other heroes lives in its own module (scripts/art/char_<name>.py, class <Name>)
    try:
        _mod = __import__(f'char_{_name}')
        HEROES[_name] = getattr(_mod, _name.capitalize())
    except ModuleNotFoundError as _e:
        if _e.name != f'char_{_name}':
            raise
    except Exception:
        # a hero being worked on elsewhere must not stop renders of the others
        if not A.hero or _name in A.hero.split(','):
            raise
        print(f'skipping char_{_name}: it failed to load', flush=True)


# ------------------------------------------------------------------------------------------
def setup_scene(samples: int, ss: float):
    sc = lib.reset(samples)
    # the board's lighting: sky fill and a warm key from the upper left, behind the camera
    lib.world_light(0.82)
    lib.sun(energy=3.6, elevation=50, azimuth=-35, angle=3.5, color='#fff0d8')
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = FRAME / PXU
    cd.clip_start = 0.1
    cd.clip_end = 100.0
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    a = math.radians(90 - CAM_ELEV)
    up = Vector((0.0, math.cos(a), math.sin(a)))
    view = Vector((0.0, math.sin(a), -math.cos(a)))
    dx = (FRAME / 2 - FEET[0]) / PXU
    dy = (FEET[1] - FRAME / 2) / PXU
    target = Vector((dx, 0.0, 0.0)) + up * dy
    cam.location = target - view * 30.0
    cam.rotation_euler = (a, 0.0, 0.0)
    sc.render.resolution_x = sc.render.resolution_y = int(round(FRAME * ss))
    sc.render.resolution_percentage = 100
    return sc


def solve(hero, pose):
    """World matrices for a pose, with the lowest foot resting on the ground."""
    local = {
        'hips': R(*pose['hips']), 'spine': R(*pose['spine']), 'chest': R(*pose['chest']),
        'neck': R(*pose['neck']), 'head': R(*pose['head']),
    }
    for s, sd in (('L', 1), ('R', -1)):
        ra, sw, tw, el = pose['arm' + s]
        local['shoulder' + s] = arm_rot(sd, ra, sw, tw)
        local['elbow' + s] = bend(el)
        local['wrist' + s] = R(*pose.get('wrist' + s, (0, 0, 0)))
        fw, out, tw2, kn = pose['leg' + s]
        local['hip' + s] = leg_rot(sd, fw, out, tw2)
        local['knee' + s] = knee(kn)
        local['ankle' + s] = R(*pose.get('foot' + s, (0, 0, 0)))
    for k, v in pose.get('joints', {}).items():
        local[k] = R(*v)
    rt = pose['root']
    yaw = rt.get('yaw', 0.0)

    def root_m(z_extra=0.0):
        x, y, z = rt.get('pos', (0.0, 0.0, 0.0))
        return T(x, y, z + z_extra) @ R(0, 0, yaw) @ R(rt.get('lean', 0.0), rt.get('roll', 0.0), 0)

    override = None
    if pose.get('feet_flat', True):
        flat = R(0, 0, yaw)
        override = {'ankleL': flat @ R(*pose.get('footL', (0, 0, 0))), 'ankleR': flat @ R(*pose.get('footR', (0, 0, 0)))}
    world = hero.skel.solve(local, root_m(), override)
    dz = 0.0
    if pose.get('sit'):
        dz = hero.sit_h - world['hips'].to_translation().z
    elif pose.get('ground', True):
        dz = -(min(world['ankleL'].to_translation().z, world['ankleR'].to_translation().z) - hero.ankle_h)
    dz += pose.get('rise', 0.0)
    if dz:
        world = hero.skel.solve(local, root_m(dz), override)
    return world


def clear_meshes():
    for ob in list(bpy.data.objects):
        if ob.type == 'MESH':
            bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


def render_frame(hero, pose, path):
    clear_meshes()
    world = solve(hero, pose)
    parts = hero.build(world, pose)
    instantiate(parts)
    lib.render_to(path)
    anchors = {}
    for k in ('wristL', 'wristR', 'head'):
        anchors[k] = project(world[k].to_translation())
    return anchors


def project(v: Vector):
    """World point -> pixel position in the output frame."""
    a = math.radians(90 - CAM_ELEV)
    up = Vector((0.0, math.cos(a), math.sin(a)))
    x = FEET[0] + v.x * PXU
    y = FEET[1] - v.dot(up) * PXU
    return [round(x, 1), round(y, 1)]


# ------------------------------------------------------------------------------------------
# Packing: trimmed atlas + generated TypeScript metadata
ALPHA_SOLID = 160


def load_frame(path: str) -> Image.Image:
    im = Image.open(path).convert('RGBA')
    if im.size != (FRAME, FRAME):
        # supersampled render: downsample with premultiplied alpha so edges stay clean
        arr = np.asarray(im).astype(np.float32) / 255.0
        a = arr[..., 3:4]
        pm = np.concatenate([arr[..., :3] * a, a], axis=2)
        small = Image.fromarray((pm * 255).astype(np.uint8), 'RGBA').resize((FRAME, FRAME), Image.LANCZOS)
        s_ = np.asarray(small).astype(np.float32) / 255.0
        a2 = s_[..., 3:4]
        rgb = np.where(a2 > 1e-4, s_[..., :3] / np.maximum(a2, 1e-4), 0.0)
        im = Image.fromarray((np.clip(np.concatenate([rgb, a2], axis=2), 0, 1) * 255).astype(np.uint8), 'RGBA')
    return im


def shelf_pack(sizes, width=2048, pad=2):
    """Place (w, h) boxes on shelves, tallest first. Returns positions and the atlas height."""
    order = sorted(range(len(sizes)), key=lambda i: -sizes[i][1])
    pos = [None] * len(sizes)
    x = y = shelf_h = 0
    for i in order:
        w, h = sizes[i]
        if x + w + pad > width:
            x = 0
            y += shelf_h + pad
            shelf_h = 0
        pos[i] = (x, y)
        x += w + pad
        shelf_h = max(shelf_h, h)
    height = y + shelf_h
    return pos, height


def face_point(key):
    """Centre of the head in the first idle frame; portraits are framed on it."""
    hero = HEROES[key](Mats())
    world = solve(hero, char_anims.animations(key)['idle'][0])
    h = hero.HEAD  # rx, ry, rz, centre height above the head joint[, depth]
    return project(world['head'] @ Vector((0.0, h[4] if len(h) > 4 else 0.0, h[3])))


def pack(keys):
    src_root = OUT
    gen = {'meta': {}, 'anims': {}, 'points': {}}
    for key in keys:
        anims = char_anims.animations(key)
        frames, index = [], {}
        for name, poses in anims.items():
            for i in range(len(poses)):
                index[(name, i)] = len(frames)
                frames.append((name, i))
        images, solids, trims, anchors = [], [], [], []
        for (name, i) in frames:
            path = os.path.join(src_root, key, f'{name}_{i}.png')
            im = load_frame(path)
            a = np.asarray(im.getchannel('A'))
            ys, xs = np.nonzero(a >= ALPHA_SOLID)
            solid = [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)] if len(xs) else [0, 0, 1, 1]
            bbox = im.getchannel('A').point(lambda v: 255 if v > 6 else 0).getbbox() or (0, 0, 1, 1)
            images.append(im.crop(bbox))
            trims.append(bbox)
            solids.append(solid)
            with open(path + '.json') as fh:
                anchors.append(json.load(fh))
        # power-of-two sheet (the game mipmaps its atlases): 2048 wide, or 4096 wide when that is smaller
        W = H = pos = None
        for width in (2048, 4096):
            p_, height = shelf_pack([im.size for im in images], width)
            h_ = 1 << max(0, int(math.ceil(math.log2(max(1, height)))))
            if W is None or width * h_ < W * H:
                W, H, pos = width, h_, p_
        atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        fr = {}
        for k, (im, (x, y), bb) in enumerate(zip(images, pos, trims)):
            atlas.paste(im, (x, y))
            fr[str(k)] = {
                'frame': {'x': x, 'y': y, 'w': im.width, 'h': im.height}, 'rotated': False, 'trimmed': True,
                'spriteSourceSize': {'x': bb[0], 'y': bb[1], 'w': im.width, 'h': im.height}, 'sourceSize': {'w': FRAME, 'h': FRAME},
            }
        name = f'hero_{key}'
        atlas.save(os.path.join(ATLAS_DIR, name + '.webp'), 'WEBP', quality=92, method=6)
        with open(os.path.join(ATLAS_DIR, name + '.json'), 'w') as fh:
            json.dump({'frames': fr, 'meta': {'app': 'gleamtrail/scripts/art/characters.py', 'image': name + '.webp', 'format': 'RGBA8888',
                                              'size': {'w': W, 'h': H}, 'scale': '1'}}, fh)
        gen['meta'][f'hero_{key}'] = {'pad': 80, 'anchor': 'feet', 'frames': [{'w': FRAME, 'h': FRAME, 'solid': s_} for s_ in solids]}
        playback = {}
        for anim, (order, fps, loop) in char_anims.PLAYBACK.items():
            src = 'run' if anim == 'sprint' else anim
            if src not in anims:
                continue
            playback[anim] = {'frames': [index[(src, i)] for i in order], 'fps': fps, 'loop': loop}
        gen['anims'][key] = playback

        def rel(pt):
            return [round(pt[0] - FEET[0], 1), round(pt[1] - FEET[1], 1)]

        def mid(a_, b_):
            return [(a_[0] + b_[0]) / 2, (a_[1] + b_[1]) / 2]

        carry = anchors[index[('carry', 0)]]
        pull = anchors[index[('pull', 0)]]
        gen['points'][key] = {
            'carry': rel(mid(carry['wristL'], carry['wristR'])),
            'pull': rel(mid(pull['wristL'], pull['wristR'])),
            'face': rel(face_point(key)),
        }
        print('packed', key, len(frames), 'frames', f'{W}x{H}', flush=True)
    write_ts(gen)


def write_ts(gen):
    # merge with any heroes packed earlier (so one hero can be re-packed on its own)
    old = {}
    if os.path.exists(GEN_TS):
        txt = open(GEN_TS).read()
        if '/*DATA*/' in txt:
            old = json.loads(txt.split('/*DATA*/')[1])
    for k in ('meta', 'anims', 'points'):
        old.setdefault(k, {}).update(gen[k])
    data = json.dumps(old, separators=(',', ':'))
    ts = (
        '// AUTO-GENERATED by scripts/art/characters.py — do not edit by hand.\n'
        '// 3D hero sprite sheets: per-frame artwork bounds, animation frame lists and hand anchor points.\n'
        "import type { SheetMeta } from './spriteMeta.generated';\n\n"
        'export interface HeroAnim {\n  frames: number[];\n  fps: number;\n  loop: boolean;\n}\n\n'
        'export interface HeroData {\n  meta: Record<string, SheetMeta>;\n  anims: Record<string, Record<string, HeroAnim>>;\n'
        '  /** Anchor points in frame pixels relative to the feet, facing right: carry (parcel), pull (rope grip), face (idle head centre). */\n'
        '  points: Record<string, { carry: [number, number]; pull: [number, number]; face: [number, number] }>;\n}\n\n'
        f'/** Every hero frame is registered with the feet at this point of the {FRAME}x{FRAME} frame. */\n'
        f'export const HERO_FEET = {{ x: {FEET[0]}, y: {FEET[1]}, size: {FRAME} }};\n\n'
        f'export const HERO_DATA: HeroData = /*DATA*/{data}/*DATA*/;\n'
    )
    with open(GEN_TS, 'w') as fh:
        fh.write(ts)
    print('wrote', GEN_TS)


def main():
    heroes = [h for h in A.hero.split(',') if h in HEROES] if A.hero else list(HEROES)
    if A.pack_only:
        pack(heroes)
        return
    os.makedirs(OUT, exist_ok=True)
    ss = 1.0 if A.preview else A.ss
    samples = 16 if A.preview else A.samples
    setup_scene(samples, ss)
    mats = Mats()
    for key in heroes:
        hero = HEROES[key](mats)
        anims = char_anims.animations(key)
        names = [a for a in anims if not A.anims or a in A.anims.split(',')]
        for name in names:
            for i, pose in enumerate(anims[name]):
                path = os.path.join(OUT, key, f'{name}_{i}.png')
                t0 = time.time()
                anchors = render_frame(hero, pose, path)
                with open(path + '.json', 'w') as fh:
                    json.dump(anchors, fh)
                print(f'{key} {name} {i} {time.time() - t0:.1f}s', flush=True)
    if not A.preview and not A.anims and not A.out:
        pack(heroes)


if __name__ == '__main__':
    main()
