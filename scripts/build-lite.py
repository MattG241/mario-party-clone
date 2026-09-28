"""Half-resolution copies of the biggest textures for Lite mode (TV browsers, low-memory devices).

    python3 scripts/build-lite.py

Writes public/assets/lite/: the board terrain tiles, landmarks and island shadow at half size with a
manifest whose render scale is halved (so the board lines up exactly as before), and a 1280x720 sky.
Re-run after re-rendering the board (scripts/art/board.py --export) or the skies.
"""
import json
import os
import shutil

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'public', 'assets', 'rendered')
OUT = os.path.join(ROOT, 'public', 'assets', 'lite')


def half(src, dst, quality=84):
    im = Image.open(src)
    im = im.convert('RGBA') if im.mode in ('RGBA', 'LA', 'P') else im.convert('RGB')
    im = im.resize((max(1, im.width // 2), max(1, im.height // 2)), Image.LANCZOS)
    im.save(dst, 'WEBP', quality=quality, method=6)


def board(name):
    src = os.path.join(SRC, name)
    dst = os.path.join(OUT, name)
    shutil.rmtree(dst, ignore_errors=True)
    os.makedirs(dst)
    man = json.load(open(os.path.join(src, 'manifest.json')))
    # Tiles are placed in render pixels: halve the render scale and every tile rectangle.
    man['scale'] = man['scale'] / 2
    for t in man['tiles']:
        half(os.path.join(src, t['file']), os.path.join(dst, t['file']))
        for k in ('x', 'y', 'w', 'h'):
            t[k] = t[k] / 2
    # Landmarks and the shadow are placed by display size in board pixels: only the images shrink.
    for p in man.get('props', []):
        half(os.path.join(src, p['file']), os.path.join(dst, p['file']))
    if man.get('shadow'):
        half(os.path.join(src, man['shadow']['file']), os.path.join(dst, man['shadow']['file']))
    with open(os.path.join(dst, 'manifest.json'), 'w') as fh:
        json.dump(man, fh)
    print('board', name, len(man['tiles']), 'tiles', len(man.get('props', [])), 'props')


def main():
    os.makedirs(OUT, exist_ok=True)
    board('suncoil')
    half(os.path.join(SRC, 'sky_day.webp'), os.path.join(OUT, 'sky_day.webp'))
    print('sky_day')


if __name__ == '__main__':
    main()
