"""Soft shadow of the board's islands on the cloud sea (a blurred, offset silhouette).

    python scripts/art/island_shadow.py [--offset 150,70] [--blur 34]

Reads art-out/board/terrain.png and the board manifest, writes shadow.webp next to the tiles and
records its board-space rectangle in the manifest.
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
p = argparse.ArgumentParser()
p.add_argument('--board', default='suncoil')
p.add_argument('--offset', default='150,70', help='board px shift along the light direction')
p.add_argument('--blur', type=float, default=34.0, help='blur radius in board px')
p.add_argument('--down', type=int, default=6, help='downsample factor (board px per shadow px)')
A = p.parse_args()

dest = os.path.join(ROOT, 'public', 'assets', 'rendered', A.board)
man_path = os.path.join(dest, 'manifest.json')
man = json.load(open(man_path))
scale = man['scale']
ox, oy = man['origin']
src = Image.open(os.path.join(ROOT, 'art-out', 'board', 'terrain.png')).getchannel('A')
# board px -> shadow px
bw, bh = src.width / scale, src.height / scale
pad = int(A.blur * 3)
sw, sh = int((bw + pad * 2) / A.down), int((bh + pad * 2) / A.down)
small = src.resize((int(bw / A.down), int(bh / A.down)), Image.BILINEAR)
canvas = Image.new('L', (sw, sh), 0)
canvas.paste(small, (pad // A.down, pad // A.down))
canvas = canvas.filter(ImageFilter.GaussianBlur(A.blur / A.down))
a = np.asarray(canvas, np.float32) / 255.0
rgba = np.zeros((sh, sw, 4), np.uint8)
rgba[..., 0], rgba[..., 1], rgba[..., 2] = 26, 38, 78
rgba[..., 3] = np.clip(a * 190, 0, 255).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save(os.path.join(dest, 'shadow.webp'), 'WEBP', quality=85, method=6)
dx, dy = [float(v) for v in A.offset.split(',')]
man['shadow'] = {'file': 'shadow.webp', 'x': ox - pad + dx, 'y': oy - pad + dy, 'w': sw * A.down, 'h': sh * A.down}
with open(man_path, 'w') as fh:
    json.dump(man, fh, indent=1)
print('wrote shadow', sw, sh, man['shadow'])
