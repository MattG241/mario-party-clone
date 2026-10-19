"""Render the Wii edition's extra board cast (the thief, banker and villain roles) as sprite strips.

    python scripts/art/cast_wii.py --side eggman,frieza [--preview] [--samples 40]

Same models, poses, camera and registration as cast.py (each character is scripts/art/side_<id>.py), but
the result is a 6-cell strip per character, wii/art/cast_<id>.png (96 px cells, poses in cast.py's
POSE_NAMES order, feet at (48, 75) like the Wii's cast.png), which wii/tools/build_assets.py stacks into
wii/data/cast_extra.png. The web game's cast atlas is not touched.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
# cast.py parses its own arguments on import: give it none
_argv = sys.argv
sys.argv = [_argv[0]]
import cast  # noqa: E402
sys.argv = _argv

import characters as C  # noqa: E402
import lib  # noqa: E402
from char_models import Mats  # noqa: E402

CELL = 96
OUT = os.path.join(lib.ROOT, 'art-out', 'cast')
STRIPS = os.path.join(lib.ROOT, 'wii', 'art')

p = argparse.ArgumentParser()
p.add_argument('--side', required=True)
p.add_argument('--poses', default='')
p.add_argument('--preview', action='store_true')
p.add_argument('--samples', type=int, default=40)
p.add_argument('--ss', type=float, default=2.0)
p.add_argument('--strip-only', action='store_true', help='only rebuild the strips from existing renders')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])


def strip(side: str) -> None:
    from PIL import Image
    im = Image.new('RGBA', (CELL * len(cast.POSE_NAMES), CELL), (0, 0, 0, 0))
    for c, name in enumerate(cast.POSE_NAMES):
        fr = C.load_frame(os.path.join(OUT, side, f'{name}.png')).convert('RGBA')
        im.alpha_composite(fr.resize((CELL, CELL), Image.LANCZOS), (c * CELL, 0))
    os.makedirs(STRIPS, exist_ok=True)
    path = os.path.join(STRIPS, f'cast_{side}.png')
    im.save(path, optimize=True)
    print('strip', path, flush=True)


def main():
    sides = [s for s in A.side.split(',') if s]
    if not A.strip_only:
        C.setup_scene(16 if A.preview else A.samples, 1.0 if A.preview else A.ss)
        for s in sides:
            model, poses = cast.load(s)
            figure = model(Mats())
            os.makedirs(os.path.join(OUT, s), exist_ok=True)
            for name in cast.POSE_NAMES:
                if A.poses and name not in A.poses.split(','):
                    continue
                t0 = time.time()
                C.render_frame(figure, poses[name], os.path.join(OUT, s, f'{name}.png'))
                print(f'{s} {name} {time.time() - t0:.1f}s', flush=True)
    for s in sides:
        if all(os.path.exists(os.path.join(OUT, s, f'{n}.png')) for n in cast.POSE_NAMES):
            strip(s)


if __name__ == '__main__':
    main()
