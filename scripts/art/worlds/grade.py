"""Grade a world board's fresh render once: scripts/art/regrade.py's richer greens and lifted mid-tones,
blended in at a chosen strength. (World boards come out of Cycles at different saturations; Suncoil's
shipped art has the full regrade, so each world board takes as much of it as brings it level.)

    python3 scripts/art/worlds/grade.py <board> [--strength 0.6] [--dry]

Grades the terrain tiles and the landmark props named in public/assets/rendered/<board>/manifest.json,
in place, keeping each file's WebP quality. A file already graded (same size and time as recorded in
art-out/<board>/graded.json) is skipped, so re-running after a partial re-render grades only new files.
--dry only prints saturation/value statistics of the tiles, now and as graded, next to Suncoil's.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'art'))
import regrade as RG  # noqa: E402

TILE_Q, PROP_Q = 82, 92  # the qualities tiles.py and landkit.render_props save at


def graded(im: Image.Image, strength: float) -> Image.Image:
    im = im.convert('RGBA')
    return Image.blend(im, RG.regrade(im), strength) if strength > 0 else im


def stats(ims) -> str:
    sat, val, green = [], [], []
    for im in ims:
        a = np.asarray(im.convert('RGBA')).astype(np.float32) / 255
        rgb = a[..., :3][a[..., 3] > 0.9]
        mx, mn = rgb.max(-1), rgb.min(-1)
        s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
        sat.append(s)
        val.append(mx)
        green.append(s[(rgb[:, 1] > rgb[:, 0]) & (rgb[:, 1] > rgb[:, 2])])
    s, v, g = np.concatenate(sat), np.concatenate(val), np.concatenate(green)
    return f'saturation {s.mean():.3f}  value {v.mean():.3f}  green saturation {g.mean():.3f}'


def tiles_of(board: str, quarter=True):
    src = os.path.join(ROOT, 'public', 'assets', 'rendered', board)
    man = json.load(open(os.path.join(src, 'manifest.json')))
    for t in man['tiles']:
        im = Image.open(os.path.join(src, t['file'])).convert('RGBA')
        yield im.resize((im.width // 4, im.height // 4)) if quarter else im


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('board')
    ap.add_argument('--strength', type=float, default=0.6)
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    if a.dry:
        print('suncoil  ', stats(tiles_of('suncoil')))
        now = list(tiles_of(a.board))
        print(f'{a.board:9s}', stats(now))
        for k in (0.25, 0.5, 0.75, 1.0):
            print(f'  x{k:.2f}   ', stats(graded(im, k) for im in now))
        return
    src = os.path.join(ROOT, 'public', 'assets', 'rendered', a.board)
    man = json.load(open(os.path.join(src, 'manifest.json')))
    rec_dir = os.path.join(ROOT, 'art-out', a.board)
    os.makedirs(rec_dir, exist_ok=True)
    rec_path = os.path.join(rec_dir, 'graded.json')
    rec = json.load(open(rec_path)) if os.path.exists(rec_path) else {}
    jobs = [(t['file'], TILE_Q) for t in man['tiles']] + [(p['file'], PROP_Q) for p in man.get('props', [])]
    done = 0
    for name, q in jobs:
        path = os.path.join(src, name)
        st = os.stat(path)
        if rec.get(name) == f'{st.st_size}:{int(st.st_mtime)}':
            continue
        graded(Image.open(path), a.strength).save(path, 'WEBP', quality=q, method=6)
        st = os.stat(path)
        rec[name] = f'{st.st_size}:{int(st.st_mtime)}'
        done += 1
    with open(rec_path, 'w') as fh:
        json.dump(rec, fh, indent=1)
    print(f'graded {done} of {len(jobs)} files at strength {a.strength}')


if __name__ == '__main__':
    main()
