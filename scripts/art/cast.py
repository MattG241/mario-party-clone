"""Render the board cast (side characters from the roster's shows and games) as one 3D sprite sheet.

    .artenv/bin/python scripts/art/cast.py [--side krillin,tails] [--poses idle,wave] [--preview]
                                           [--samples 40] [--pack-only] [--sheet]

Each side character lives in scripts/art/side_<id>.py: MODEL (a char_models.Hero subclass, usually
derived from its franchise hero's model) and optionally POSES overriding any of the six shared poses
below. They are rendered with the heroes' camera and key light and the same fixed registration
(feet at characters.FEET), then packed into public/assets/atlases/npcs3d.webp/.json (frame = row * 6
+ pose, rows in the order of SIDES = src/game/data/npcs.ts SIDE_CHARACTERS) plus
src/game/data/npcSprites.generated.ts. `--sheet` writes a labelled contact sheet of what is rendered.
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import characters as C  # noqa: E402  (camera, lighting, posing and packing helpers)
import lib  # noqa: E402

from char_anims import FACE_RIGHT, celebrate, face, idle, pose, surprised, swing, victory, wave  # noqa: E402
from char_models import Mats  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--side', default='')
p.add_argument('--poses', default='')
p.add_argument('--preview', action='store_true')
p.add_argument('--samples', type=int, default=40)
p.add_argument('--ss', type=float, default=2.0, help='supersampling factor')
p.add_argument('--pack-only', action='store_true')
p.add_argument('--sheet', action='store_true')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

# atlas rows (src/game/data/npcs.ts SIDE_CHARACTERS) and pose columns (CAST_POSES)
SIDES = ['chopper', 'krillin', 'kakashi', 'alfred', 'venom', 'warmachine', 'tails', 'patrick', 'bart']
POSE_NAMES = ['idle', 'wave', 'cheer', 'point', 'surprised', 'happy']

# The shared poses (the heroes' own animation frames, so the cast moves like the players).
POSES = {
    'idle': idle()[0],
    'wave': wave()[1],
    'cheer': victory()[0],
    'point': pose(root=dict(yaw=26.0), chest=(-3, 0, -2), head=(0, -4, 10), armL=(100.0, 18.0, 0.0, 4.0), armR=swing(10, 10, 0, 40),
                  handL='open', legL=(10, 12, 0, 8), legR=(-6, 10, 0, 6), face=face('open', 'grin', look=(0.5, 0.15)),
                  extra=dict(scarf=0.3, wave=2.6, tail=0.3)),
    'surprised': surprised()[0],
    'happy': celebrate()[0],
}
del FACE_RIGHT

OUT = os.path.join(lib.ROOT, 'art-out', 'cast')


def load(side: str):
    mod = __import__(f'side_{side}')
    return mod.MODEL, {**POSES, **getattr(mod, 'POSES', {})}


def contact_sheet(sides):
    from PIL import Image, ImageDraw
    cell = 260
    im = Image.new('RGB', (cell * len(POSE_NAMES), cell * len(sides)), (96, 128, 150))
    d = ImageDraw.Draw(im)
    for r, s in enumerate(sides):
        for c, name in enumerate(POSE_NAMES):
            path = os.path.join(OUT, s, f'{name}.png')
            if os.path.exists(path):
                fr = Image.open(path).convert('RGBA').resize((cell, cell))
                im.paste(fr, (c * cell, r * cell), fr)
            d.text((c * cell + 6, r * cell + 4), f'{s} {name}', fill=(255, 255, 255))
    path = os.path.join(OUT, 'sheet.png')
    im.save(path)
    print('sheet', path, flush=True)


def pack():
    import json

    import numpy as np
    from PIL import Image
    images, solids, trims = [], [], []
    for s in SIDES:
        for name in POSE_NAMES:
            path = os.path.join(OUT, s, f'{name}.png')
            if not os.path.exists(path):
                raise SystemExit(f'missing frame {path}: render every side character before packing')
            im = C.load_frame(path)
            a = np.asarray(im.getchannel('A'))
            ys, xs = np.nonzero(a >= C.ALPHA_SOLID)
            solids.append([int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)] if len(xs) else [0, 0, 1, 1])
            bbox = im.getchannel('A').point(lambda v: 255 if v > 6 else 0).getbbox() or (0, 0, 1, 1)
            images.append(im.crop(bbox))
            trims.append(bbox)
    # power-of-two sheet (the game mipmaps its atlases): 2048 wide, or 4096 wide when that is smaller
    W = H = pos = None
    for width in (2048, 4096):
        p_, height = C.shelf_pack([im.size for im in images], width)
        h_ = 1 << max(0, int(math.ceil(math.log2(max(1, height)))))
        if W is None or width * h_ < W * H:
            W, H, pos = width, h_, p_
    atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    frames = {}
    for k, (im, (x, y), bb) in enumerate(zip(images, pos, trims)):
        atlas.paste(im, (x, y))
        frames[str(k)] = {
            'frame': {'x': x, 'y': y, 'w': im.width, 'h': im.height}, 'rotated': False, 'trimmed': True,
            'spriteSourceSize': {'x': bb[0], 'y': bb[1], 'w': im.width, 'h': im.height}, 'sourceSize': {'w': C.FRAME, 'h': C.FRAME},
        }
    atlas.save(os.path.join(C.ATLAS_DIR, 'npcs3d.webp'), 'WEBP', quality=92, method=6)
    with open(os.path.join(C.ATLAS_DIR, 'npcs3d.json'), 'w') as fh:
        json.dump({'frames': frames, 'meta': {'app': 'scripts/art/cast.py', 'image': 'npcs3d.webp', 'format': 'RGBA8888',
                                              'size': {'w': W, 'h': H}, 'scale': '1'}}, fh, separators=(',', ':'))
    meta = {'pad': 80, 'anchor': 'feet', 'frames': [{'w': C.FRAME, 'h': C.FRAME, 'solid': s_} for s_ in solids]}
    ts = (
        '// AUTO-GENERATED by scripts/art/cast.py — do not edit by hand.\n'
        '// The board cast sheet (side characters): per-frame artwork bounds; frame = row * 6 + pose (see npcs.ts).\n'
        "import type { SheetMeta } from './spriteMeta.generated';\n\n"
        "/** The rendered cast sheet (atlas 'npcs3d', feet registered like the heroes), or null for the 2D sheet. */\n"
        f'export const NPC_SHEET: SheetMeta | null = /*DATA*/{json.dumps(meta, separators=(",", ":"))}/*DATA*/;\n'
    )
    with open(os.path.join(lib.ROOT, 'src', 'game', 'data', 'npcSprites.generated.ts'), 'w') as fh:
        fh.write(ts)
    print('packed npcs3d', len(images), 'frames', f'{W}x{H}', flush=True)


def main():
    if A.pack_only:
        pack()
        return
    sides = [s for s in (A.side.split(',') if A.side else SIDES) if s in SIDES]
    os.makedirs(OUT, exist_ok=True)
    C.setup_scene(16 if A.preview else A.samples, 1.0 if A.preview else A.ss)
    for s in sides:
        model, poses = load(s)
        # a fresh material cache each: side characters reuse their hero's material names with new colours
        figure = model(Mats())
        os.makedirs(os.path.join(OUT, s), exist_ok=True)
        for name in POSE_NAMES:
            if A.poses and name not in A.poses.split(','):
                continue
            path = os.path.join(OUT, s, f'{name}.png')
            t0 = time.time()
            C.render_frame(figure, poses[name], path)
            print(f'{s} {name} {time.time() - t0:.1f}s', flush=True)
    if A.sheet:
        contact_sheet(sides)
    if not A.preview and not A.poses and set(sides) == set(SIDES):
        pack()


if __name__ == '__main__':
    main()
