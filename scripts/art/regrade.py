"""Re-grade rendered board art in place: richer greens and lifted mid-tones, so the diorama reads as
bright and saturated as the characters standing on it (the Cycles render comes out a little flat).

    python3 scripts/art/regrade.py <image.webp> [...] [--quality 82] [--preview out.png]

Saturation rises most on greens (lawns, foliage) and a little elsewhere; values get a gentle gamma
lift that leaves black and white alone. Alpha is preserved. Safe to run once per fresh render;
running it twice compounds the grade.
"""
from __future__ import annotations

import argparse

import numpy as np
from PIL import Image

GREEN_HUE = 110 / 360  # centre of the "green" window
GREEN_HALF = 60 / 360  # half-width of the window (smooth falloff to its edges)
SAT_GREEN = 1.42
SAT_OTHER = 1.12
GAMMA = 0.88  # < 1 lifts mid-tones


def rgb_to_hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    h = np.zeros_like(mx)
    nz = d > 1e-6
    rc = np.where(nz, (mx - r) / np.maximum(d, 1e-6), 0)
    gc = np.where(nz, (mx - g) / np.maximum(d, 1e-6), 0)
    bc = np.where(nz, (mx - b) / np.maximum(d, 1e-6), 0)
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2.0 + rc - bc, 4.0 + gc - rc))
    h = np.where(nz, (h / 6.0) % 1.0, 0)
    return h, s, mx


def hsv_to_rgb(h: np.ndarray, s: np.ndarray, v: np.ndarray) -> np.ndarray:
    i = np.floor(h * 6.0).astype(int) % 6
    f = h * 6.0 - np.floor(h * 6.0)
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    out = np.zeros(h.shape + (3,), dtype=np.float32)
    for k, (a, b, c) in enumerate([(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]):
        m = i == k
        out[..., 0][m] = a[m]
        out[..., 1][m] = b[m]
        out[..., 2][m] = c[m]
    return out


def regrade(im: Image.Image) -> Image.Image:
    rgba = np.asarray(im.convert('RGBA')).astype(np.float32) / 255.0
    h, s, v = rgb_to_hsv(rgba[..., :3])
    dist = np.abs(((h - GREEN_HUE + 0.5) % 1.0) - 0.5)
    w = np.clip(1.0 - dist / GREEN_HALF, 0, 1)
    w = w * w * (3 - 2 * w)  # smoothstep
    # Near-greys stay grey (stone, paths in shadow): the boost fades in with the existing saturation.
    w = w * np.clip(s / 0.18, 0, 1)
    gain = SAT_OTHER + (SAT_GREEN - SAT_OTHER) * w
    s2 = np.clip(s * gain, 0, 1)
    v2 = np.power(np.clip(v, 0, 1), GAMMA)
    rgb = hsv_to_rgb(h, s2, v2)
    out = np.concatenate([rgb, rgba[..., 3:4]], axis=-1)
    return Image.fromarray(np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--quality', type=int, default=82)
    ap.add_argument('--preview', default='', help='write the first file graded to this PNG instead of overwriting')
    a = ap.parse_args()
    for f in a.files:
        src = Image.open(f)
        has_alpha = src.mode in ('RGBA', 'LA') or (src.mode == 'P' and 'transparency' in src.info)
        out = regrade(src)
        if a.preview:
            out.save(a.preview)
            print('preview', a.preview)
            return
        (out if has_alpha else out.convert('RGB')).save(f, 'WEBP', quality=a.quality, method=6)
        print('graded', f)


if __name__ == '__main__':
    main()
