"""Finish a city board's render (plain Python: PIL, numpy, scipy; no Blender):

    python3 scripts/art/worlds/citykit/post.py <board-id> [--no-bloom] [--lift 0.0]

1. terrain: art-out/<id>/terrain.png -> optional lift -> baked bloom (neon, lit windows) -> WebP tiles
   (public/assets/rendered/<id>/terrain_*.webp; the manifest keeps its props)
2. landmarks: the same bloom baked into every prop_*.webp in place
3. the blocks' soft shadow on the cloud sea (shadow.webp, recorded in the manifest)

Then build the Lite copy and the setup-card preview:

    python3 scripts/build-lite.py --board <id>
    python3 scripts/art/board_preview.py <id>
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.abspath(os.path.join(HERE, '..', '..'))
ROOT = os.path.abspath(os.path.join(ART, '..', '..'))
sys.path.insert(0, ART)
from bloom import bake_bloom  # noqa: E402
from tiles import export_tiles  # noqa: E402


def lift(im: Image.Image, amount: float) -> Image.Image:
    """Raise the darks a little (keeps the night readable after the game's own night tint)."""
    if amount <= 0:
        return im
    a = np.asarray(im.convert('RGBA'), np.float32) / 255.0
    rgb = a[..., :3]
    rgb = rgb + amount * (1.0 - rgb) * (1.0 - rgb) * 0.6
    out = np.concatenate([np.clip(rgb, 0, 1), a[..., 3:4]], axis=-1)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA')


def shadow(board: str, terrain_png: str, offset=(140, 80), blur=34.0, down=6, alpha=150):
    dest = os.path.join(ROOT, 'public', 'assets', 'rendered', board)
    man_path = os.path.join(dest, 'manifest.json')
    man = json.load(open(man_path))
    scale = man['scale']
    ox, oy = man['origin']
    src = Image.open(terrain_png).getchannel('A')
    bw, bh = src.width / scale, src.height / scale
    pad = int(blur * 3)
    sw, sh = int((bw + pad * 2) / down), int((bh + pad * 2) / down)
    small = src.resize((int(bw / down), int(bh / down)), Image.BILINEAR)
    canvas = Image.new('L', (sw, sh), 0)
    canvas.paste(small, (pad // down, pad // down))
    canvas = canvas.filter(ImageFilter.GaussianBlur(blur / down))
    a = np.asarray(canvas, np.float32) / 255.0
    rgba = np.zeros((sh, sw, 4), np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 18, 20, 52
    rgba[..., 3] = np.clip(a * alpha, 0, 255).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(dest, 'shadow.webp'), 'WEBP', quality=85, method=6)
    man['shadow'] = {'file': 'shadow.webp', 'x': ox - pad + offset[0], 'y': oy - pad + offset[1], 'w': sw * down, 'h': sh * down}
    with open(man_path, 'w') as fh:
        json.dump(man, fh, indent=1)
    print('shadow', man['shadow'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('board')
    ap.add_argument('--no-bloom', action='store_true')
    ap.add_argument('--lift', type=float, default=0.0)
    ap.add_argument('--props-only', action='store_true', help='only bloom the prop sprites')
    a = ap.parse_args()
    dest = os.path.join(ROOT, 'public', 'assets', 'rendered', a.board)
    man = json.load(open(os.path.join(dest, 'manifest.json')))
    terrain_png = os.path.join(ROOT, 'art-out', a.board, 'terrain.png')
    if not a.props_only:
        im = lift(Image.open(terrain_png), a.lift)
        if not a.no_bloom:
            im = bake_bloom(im, threshold=0.62, sigma=11.0, strength=0.9)
        tmp = os.path.join(ROOT, 'art-out', a.board, 'terrain_post.png')
        im.save(tmp)
        export_tiles(tmp, a.board, man['origin'], man['scale'], quality=84)
        shadow(a.board, terrain_png)
    if not a.no_bloom:
        man = json.load(open(os.path.join(dest, 'manifest.json')))
        for p in man.get('props', []):
            path = os.path.join(dest, p['file'])
            im = lift(Image.open(path), a.lift)
            bake_bloom(im, threshold=0.62, sigma=7.0, strength=0.85).save(path, 'WEBP', quality=90, method=6)
            print('bloom', p['file'])


if __name__ == '__main__':
    main()
