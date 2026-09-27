"""Baked bloom: bright, saturated pixels (crystals, lamps, gold) bleed a soft glow into their
surroundings. Applied to rendered images offline so the game gets the look at no runtime cost.

    python3 scripts/art/bloom.py public/assets/rendered/scene_orbit.webp [...]          (in place)
    python3 scripts/art/bloom.py --terrain suncoil                                      (re-slices tiles)
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def bake_bloom(im: Image.Image, threshold: float = 0.66, sigma: float = 10.0, strength: float = 0.95) -> Image.Image:
    a = np.asarray(im.convert('RGBA'), np.float32) / 255.0
    rgb, alpha = a[..., :3], a[..., 3:4]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0.0)
    # saturated highlights (emissive crystals, lamp light, gold glints) glow most; white cloth barely
    w = np.clip((lum - threshold) / (1.0 - threshold), 0.0, 1.0) * (0.06 + 0.94 * sat ** 1.5)
    bright = rgb * (w[..., None] * alpha)
    glow = np.stack([ndimage.gaussian_filter(bright[..., c], sigma) for c in range(3)], axis=2)
    glow += np.stack([ndimage.gaussian_filter(bright[..., c], sigma * 3.0) for c in range(3)], axis=2) * 0.6
    out = rgb + glow * strength * (alpha > 0.02)
    res = np.concatenate([np.clip(out, 0, 1), alpha], axis=2)
    return Image.fromarray((res * 255 + 0.5).astype(np.uint8), 'RGBA')


def process_file(path: str, **kw) -> None:
    im = Image.open(path)
    mode = im.mode
    out = bake_bloom(im, **kw)
    if path.lower().endswith('.webp'):
        (out if 'A' in mode else out.convert('RGB')).save(path, 'WEBP', quality=90, method=6)
    else:
        out.save(path)
    print('bloom', os.path.relpath(path, ROOT))


def terrain(board: str) -> None:
    sys.path.insert(0, os.path.dirname(__file__))
    from tiles import export_tiles
    man = json.load(open(os.path.join(ROOT, 'public', 'assets', 'rendered', board, 'manifest.json')))
    src = os.path.join(ROOT, 'art-out', 'board', 'terrain.png')
    tmp = os.path.join(ROOT, 'art-out', 'board', 'terrain_bloom.png')
    bake_bloom(Image.open(src), sigma=12.0).save(tmp)
    export_tiles(tmp, board, man['origin'], man['scale'])


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('files', nargs='*')
    p.add_argument('--terrain', default='')
    p.add_argument('--strength', type=float, default=0.95)
    a = p.parse_args()
    if a.terrain:
        terrain(a.terrain)
    for f in a.files:
        process_file(f, strength=a.strength)
