"""Slice a rendered layer into power-of-two WebP tiles plus a manifest the game reads.

    python scripts/art/tiles.py art-out/board/terrain.png suncoil --origin -120,-60 --scale 0.5
"""
from __future__ import annotations

import argparse
import json
import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TILE = 1024


# The board carries a lot of fine texture (grass clumps, gravel, the festival district): at quality 82
# its tiles stay close to the size they had before that detail, with no visible loss at game zoom.
def export_tiles(path: str, board: str, origin, scale: float, prefix: str = 'terrain', quality: int = 82) -> dict:
    dest = os.path.join(ROOT, 'public', 'assets', 'rendered', board)
    os.makedirs(dest, exist_ok=True)
    for f in os.listdir(dest):
        if f.startswith(prefix + '_'):
            os.remove(os.path.join(dest, f))
    im = Image.open(path).convert('RGBA')
    tiles = []
    # Tiles overlap by 4px so no seams show at any zoom; power-of-two size keeps mipmaps.
    step = TILE - 4
    for ty in range(0, im.height, step):
        for tx in range(0, im.width, step):
            t = Image.new('RGBA', (TILE, TILE), (0, 0, 0, 0))
            t.paste(im.crop((tx, ty, min(im.width, tx + TILE), min(im.height, ty + TILE))), (0, 0))
            if t.getchannel('A').getbbox() is None:
                continue
            name = f'{prefix}_{tx // step}_{ty // step}.webp'
            t.save(os.path.join(dest, name), 'WEBP', quality=quality, method=6)
            tiles.append({'file': name, 'x': tx, 'y': ty, 'w': TILE, 'h': TILE})
    man_path = os.path.join(dest, 'manifest.json')
    manifest = json.load(open(man_path)) if os.path.exists(man_path) else {}
    manifest.update({'board': board, 'origin': list(origin), 'scale': scale, 'bakedPaths': True})
    manifest['tiles'] = tiles
    with open(man_path, 'w') as fh:
        json.dump(manifest, fh, indent=1)
    print('exported', len(tiles), 'tiles to', dest)
    return manifest


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('image')
    p.add_argument('board')
    p.add_argument('--origin', default='-120,-60')
    p.add_argument('--scale', type=float, default=1.0)
    a = p.parse_args()
    export_tiles(a.image, a.board, [float(v) for v in a.origin.split(',')], a.scale)
