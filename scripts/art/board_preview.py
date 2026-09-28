"""Build a board's setup-screen preview from its rendered art: terrain tiles and landmark props
composited from the manifest, scaled down and cropped to the islands.

    python3 scripts/art/board_preview.py <board-id> [--width 720]

Writes public/assets/lite/previews/<board-id>.webp (the setup screen's board card picture; kept out of
the board's own Lite folder, which scripts/build-lite.py rebuilds from scratch).
"""
from __future__ import annotations

import argparse
import json
import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('board')
    ap.add_argument('--width', type=int, default=720)
    a = ap.parse_args()
    src = os.path.join(ROOT, 'public', 'assets', 'rendered', a.board)
    man = json.load(open(os.path.join(src, 'manifest.json')))
    ox, oy = man['origin']
    k = man['scale']
    tiles = man['tiles']
    # The render's extent in board px.
    rw = max(t['x'] + t['w'] for t in tiles) / k
    rh = max(t['y'] + t['h'] for t in tiles) / k
    s = a.width / rw  # preview px per board px
    canvas = Image.new('RGBA', (a.width, int(round(rh * s))), (0, 0, 0, 0))
    for t in tiles:
        im = Image.open(os.path.join(src, t['file'])).convert('RGBA')
        w = max(1, int(round(t['w'] / k * s)))
        h = max(1, int(round(t['h'] / k * s)))
        canvas.alpha_composite(im.resize((w, h), Image.LANCZOS), (int(round(t['x'] / k * s)), int(round(t['y'] / k * s))))
    # Landmarks stand on the terrain in depth order.
    for p in sorted(man.get('props', []), key=lambda p: p.get('depthY', p['baseY'])):
        im = Image.open(os.path.join(src, p['file'])).convert('RGBA')
        w = max(1, int(round(p['w'] * s)))
        h = max(1, int(round(p['h'] * s)))
        canvas.alpha_composite(im.resize((w, h), Image.LANCZOS), (int(round((p['x'] - ox) * s)), int(round((p['y'] - oy) * s))))
    box = canvas.getbbox()
    if box:
        canvas = canvas.crop(box)
    out_dir = os.path.join(ROOT, 'public', 'assets', 'lite', 'previews')
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f'{a.board}.webp')
    canvas.save(out, 'WEBP', quality=84, method=6)
    print('wrote', out, canvas.size)


if __name__ == '__main__':
    main()
