"""Shared helpers for the Cartoon Coast minigame art (mg_rush.py, mg_patty.py, mg_donut.py).

Same conventions as scripts/art/mg_arenas.py: an orthographic camera whose ground plane maps 1:1
onto the game's screen pixels (lib.board_to_world), a warm key light over a cool sky fill, two
render threads (the art machine is shared), lean samples and OpenImageDenoise. Everything here is
modelled in code and original: no logos, signs or copied designs.

Outputs go to public/assets/rendered/scene_toons_<name>.webp (arenas) and
public/assets/rendered/mg/toons_<name>.webp + .json (sprite atlases, Phaser JSON-hash with each
frame's anchor), plus the half-size Lite copies in public/assets/lite/.
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, ART)

import lib  # noqa: E402
import mg_dress as dress  # noqa: E402
import props  # noqa: E402
from lib import PX, board_to_world, col  # noqa: E402

SW, SH = 1920, 1080
OUT = os.path.join(lib.ROOT, 'art-out', 'toons')
PUB = os.path.join(lib.ROOT, 'public', 'assets', 'rendered')
LITE = os.path.join(lib.ROOT, 'public', 'assets', 'lite')
os.makedirs(OUT, exist_ok=True)


def set_view(elevation_deg: float) -> None:
    """Camera elevation above the ground plane (90 = straight down)."""
    lib.BETA = math.radians(90 - elevation_deg)
    lib.COSB, lib.SINB = math.cos(lib.BETA), math.sin(lib.BETA)


def start(elev: float, samples: int, preview: bool, sun_elev: float = 50, sun_az: float = -35, key: float = 3.4, fill: float = 0.8,
          key_col: str = '#ffe1b4', zenith: str = '#88bfff', horizon: str = '#ffe6c6', ground: str = '#a39c84'):
    set_view(elev)
    lib.reset(10 if preview else samples)
    dress.threads()
    dress.reset_mats()
    return dress.festival_light(key=key, elev=sun_elev, az=sun_az, fill=fill, angle=3.0, key_col=key_col, zenith=zenith, horizon=horizon, ground=ground)


def camera(x0: float, y0: float, w: float, h: float, preview: bool, scale: float = 1.0):
    return lib.camera_for_region(x0, y0, w, h, scale=scale * (0.5 if preview else 1.0))


def gy(y: float) -> float:
    """World Y of a ground row at screen y (x is x / PX)."""
    return -y / (PX * lib.COSB)


def wz(px_h: float) -> float:
    """World height (z) that shows as px_h screen pixels."""
    return px_h / (PX * lib.SINB)


def wp(x: float, y: float, z: float = 0.0):
    return board_to_world(x, y, z)


def render(name: str) -> str:
    path = os.path.join(OUT, f'{name}.png')
    lib.render_to(path)
    return path


def upscale_preview(im: Image.Image, size) -> Image.Image:
    return im.resize(size, Image.LANCZOS) if im.size != tuple(size) else im


def save_webp(im: Image.Image, rel: str, quality: int = 90, lite: bool = True, lite_quality: int = 84) -> None:
    """Save public/assets/rendered/<rel> and its exact half-size Lite copy."""
    dst = os.path.join(PUB, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im = im.convert('RGBA') if 'A' in im.mode else im.convert('RGB')
    im.save(dst, 'WEBP', quality=quality, method=6)
    print('wrote', rel, im.size)
    if lite:
        ldst = os.path.join(LITE, rel)
        os.makedirs(os.path.dirname(ldst), exist_ok=True)
        half = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
        half.save(ldst, 'WEBP', quality=lite_quality, method=6)
        print('wrote lite', rel, half.size)


def seamless(im: Image.Image, period: int, overlap: int) -> Image.Image:
    """An image rendered `period + overlap` px wide over periodic geometry: fold the overlap back over
    the left edge with a linear cross-fade, so the result tiles horizontally with period `period`
    (procedural textures that are not periodic blend away; the geometry already matches)."""
    a = np.asarray(im.convert('RGBA'), np.float32)
    out = a[:, :period].copy()
    extra = a[:, period:period + overlap]
    ramp = np.linspace(1.0, 0.0, overlap, dtype=np.float32)[None, :, None]
    out[:, :overlap] = extra * ramp + out[:, :overlap] * (1.0 - ramp)
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), 'RGBA')


# ------------------------------------------------------------------------------------------
# Sprite atlases
def crop_alpha(im: Image.Image, box, pad: int = 3):
    """Crop `box` (x0, y0, x1, y1 in image px) and trim it to its opaque pixels (+pad).
    Returns (image, (ox, oy)) where (ox, oy) is the crop's top-left in the source image."""
    sub = im.crop(box)
    a = np.asarray(sub)[..., 3]
    ys, xs = np.nonzero(a > 6)
    if len(xs) == 0:
        return sub, (box[0], box[1])
    x0, x1 = max(0, xs.min() - pad), min(sub.width, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(sub.height, ys.max() + 1 + pad)
    return sub.crop((x0, y0, x1, y1)), (box[0] + x0, box[1] + y0)


def pack_atlas(name: str, frames: dict, meta_extra: dict | None = None, gap: int = 8, width: int = 1024) -> None:
    """frames: {frame: (PIL RGBA image, (anchor_x_px, anchor_y_px) inside it)}. Shelf-packs them into
    mg/<name>.webp with a Phaser JSON hash (frame rects + normalised anchors); dimensions are kept
    multiples of 4 so the Lite copy is exactly half size."""
    items = sorted(frames.items(), key=lambda kv: -kv[1][0].height)
    x = y = gap
    shelf = 0
    rects = {}
    for fname, (img, _) in items:
        w, h = img.width, img.height
        if x + w + gap > width:
            x = gap
            y += shelf + gap
            shelf = 0
        rects[fname] = (x, y, w, h)
        x += w + gap
        shelf = max(shelf, h)
    H = y + shelf + gap
    H = (H + 3) // 4 * 4
    sheet = Image.new('RGBA', (width, H), (0, 0, 0, 0))
    out = {'frames': {}, 'meta': {'app': 'gleamtrail toons', 'size': {'w': width, 'h': H}, 'scale': 1}}
    for fname, (img, anchor) in frames.items():
        rx, ry, w, h = rects[fname]
        sheet.alpha_composite(img, (rx, ry))
        out['frames'][fname] = {
            'frame': {'x': rx, 'y': ry, 'w': w, 'h': h},
            'rotated': False,
            'trimmed': False,
            'spriteSourceSize': {'x': 0, 'y': 0, 'w': w, 'h': h},
            'sourceSize': {'w': w, 'h': h},
            'anchor': {'x': round(anchor[0] / w, 4), 'y': round(anchor[1] / h, 4)},
        }
    if meta_extra:
        out['meta'].update(meta_extra)
    save_webp(sheet, f'mg/{name}.webp', quality=92, lite_quality=90)
    with open(os.path.join(PUB, 'mg', f'{name}.json'), 'w') as fh:
        json.dump(out, fh, indent=1)
    print('wrote', f'mg/{name}.json', len(frames), 'frames')


def save_icon(img: Image.Image, name: str, size: int = 112) -> None:
    """A rule icon for the intro card: the image fitted into an even-sized square with a little margin,
    saved as scene_toons_ic_<name>.webp (+ Lite). Loaded with the arena (info.ts renders)."""
    im = img.convert('RGBA')
    k = (size - 8) / max(im.width, im.height)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    save_webp(out, f'scene_toons_ic_{name}.webp', quality=92, lite_quality=90)


def tint_rgb(img: Image.Image, rgb) -> Image.Image:
    """Multiply an RGBA image's colour by rgb (0..1 each), as Phaser's setTint does."""
    a = np.asarray(img.convert('RGBA'), np.float32)
    a[..., :3] = a[..., :3] * np.array(rgb, np.float32)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


def stack_images(layers, gap_px) -> Image.Image:
    """Pile anchored sprites bottom-up: layers = [(img, (ax, ay))], each raised by gap_px[i] over the last."""
    H = sum(gap_px) + max(im.height for im, _ in layers) * 2
    W = max(im.width for im, _ in layers) * 2
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    y = H - 40
    for (im, (ax, ay)), g in zip(layers, gap_px):
        canvas.alpha_composite(im, (int(W / 2 - ax), int(y - ay)))
        y -= g
    bbox = canvas.getbbox()
    return canvas.crop(bbox) if bbox else canvas


def shadow_catcher(x: float, y: float, r: float = 3.0):
    """A ground disc that only catches shadows (sprites carry a soft contact shadow)."""
    c = wp(x, y)
    fl = lib.mesh_object('floor', *lib.lathe([(r, 0.0), (0.0, 0.0)], 48, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False), smooth=False,
                         material=lib.simple_mat('floor', '#b8a888'))
    fl.is_shadow_catcher = True
    return fl


def mat_gloss(name: str, rough: float = 0.25, coat: float = 0.8, spec: float = 0.5, sheen: float = 0.0, subsurface: float = 0.0):
    m = lib.NT(name)
    c = m.attr('col')
    m.bsdf(c, rough, coat=coat, spec=spec, sheen=sheen, subsurface=subsurface)
    return m.mat


def mat_metal(name: str, rough: float = 0.22):
    m = lib.NT(name)
    b = m.bsdf(m.attr('col'), rough, coat=0.4)
    b.inputs['Metallic'].default_value = 1.0
    return m.mat


def mat_matte(name: str, rough: float = 0.7, ao: float = 0.4, sheen: float = 0.0):
    return lib.attr_mat(name, rough=rough, ao=ao, sheen=sheen)


def mat_glow(name: str, strength: float = 2.4):
    m = lib.NT(name)
    c = m.attr('col')
    m.bsdf(c, 0.2, emission=c, emission_strength=strength, coat=0.4)
    return m.mat


def torus(center, R: float, r: float, seg: int = 48, ring: int = 14, axis: str = 'y'):
    """A torus around `axis` ('y': the hole faces the camera, like a hoop standing upright)."""
    cx, cy, cz = center
    verts, faces = [], []
    for i in range(seg):
        u = i / seg * math.tau
        for j in range(ring):
            v = j / ring * math.tau
            rr = R + r * math.cos(v)
            a, b, c = rr * math.cos(u), rr * math.sin(u), r * math.sin(v)
            if axis == 'y':
                verts.append((cx + a, cy + c, cz + b))
            elif axis == 'z':
                verts.append((cx + a, cy + b, cz + c))
            else:
                verts.append((cx + c, cy + a, cz + b))
    for i in range(seg):
        for j in range(ring):
            a = i * ring + j
            b = ((i + 1) % seg) * ring + j
            c = ((i + 1) % seg) * ring + (j + 1) % ring
            d = i * ring + (j + 1) % ring
            faces.append((a, b, c, d))
    return verts, faces


def ellipsoid(center, rx: float, ry: float, rz: float, subdiv: int = 3):
    v, f = lib.icosphere(subdiv)
    cx, cy, cz = center
    return [(cx + x * rx, cy + y * ry, cz + z * rz) for (x, y, z) in v], f


def rounded_slab(center, sx: float, sy: float, sz: float, r: float, seg: int = 6):
    """A box with rounded vertical edges (a chunky toy block), sizes are full extents."""
    cx, cy, cz = center
    hx, hy = sx / 2 - r, sy / 2 - r
    ring = []
    for q, (ox, oy) in enumerate([(hx, hy), (-hx, hy), (-hx, -hy), (hx, -hy)]):
        for k in range(seg + 1):
            a = (q + k / seg) * math.pi / 2
            ring.append((ox + math.cos(a) * r, oy + math.sin(a) * r))
    n = len(ring)
    verts = [(cx + x, cy + y, cz - sz / 2) for (x, y) in ring] + [(cx + x, cy + y, cz + sz / 2) for (x, y) in ring]
    faces = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(n + k for k in range(n)))
    return verts, faces
