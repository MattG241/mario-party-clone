"""Shared helpers for the Showtime Strip minigame arenas (mg_stage.py, mg_cafe.py, mg_rodeo.py).

Same conventions as scripts/art/mg_arenas.py: an orthographic camera whose ground plane maps 1:1
onto the game's 1920x1080 screen, so each minigame's layout constants line up with the art.
Everything is modelled in code (original shapes, no text or insignia) and rendered with Cycles on
two threads. Run through the shared Blender lock:

    .../cool/with-blender-lock .../bpyenv/bin/python scripts/art/worlds/showtime/mg_stage.py [--preview]
"""
from __future__ import annotations

import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, ART)

import lib  # noqa: E402
import mg_dress as dress  # noqa: E402
import props  # noqa: E402
from lib import PX, MeshBuilder, col  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
from PIL import Image  # noqa: E402

SW, SH = 1920, 1080
OUT = os.path.join(lib.ROOT, 'art-out', 'showtime')
PUB = os.path.join(lib.ROOT, 'public', 'assets', 'rendered')
os.makedirs(OUT, exist_ok=True)


def args(choices=None):
    p = argparse.ArgumentParser()
    if choices:
        p.add_argument('what', choices=choices)
    p.add_argument('--preview', action='store_true')
    p.add_argument('--samples', type=int, default=20)
    p.add_argument('--build-only', action='store_true', help='build the scene and stop (no render: no lock needed)')
    return p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])


# ------------------------------------------------------------------------------------------
# View and scene
def set_view(elevation_deg: float) -> None:
    lib.BETA = math.radians(90 - elevation_deg)
    lib.COSB, lib.SINB = math.cos(lib.BETA), math.sin(lib.BETA)


def start(A, elev: float, sun_elev: float = 50, sun_az: float = -35, key: float = 3.4, fill: float = 0.8,
          key_col: str = '#ffe1b4', zenith: str = '#88bfff', horizon: str = '#ffe6c6', ground: str = '#a39c84',
          region=(0, 0, SW, SH)):
    set_view(elev)
    lib.reset(10 if A.preview else A.samples)
    dress.threads()
    dress.reset_mats()
    _M.clear()
    dress.festival_light(key=key, elev=sun_elev, az=sun_az, fill=fill, angle=3.0, key_col=key_col,
                         zenith=zenith, horizon=horizon, ground=ground)
    x0, y0, w, h = region
    return lib.camera_for_region(x0, y0, w, h, scale=0.5 if A.preview else 1.0)


def render(A, path: str) -> bool:
    """Render the scene to `path` (skipped with --build-only). Returns whether it rendered."""
    if A.build_only:
        n = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
        print('built', len(bpy.data.objects), 'objects,', n, 'faces (no render)')
        return False
    lib.render_to(path)
    return True


def publish(A, path: str, name: str) -> None:
    """Copy a finished render into public/assets/rendered/scene_<name>.webp (not for previews)."""
    if A.preview:
        return
    Image.open(path).convert('RGBA').save(os.path.join(PUB, f'scene_{name}.webp'), 'WEBP', quality=90, method=6)
    print('wrote', f'scene_{name}.webp')


# ------------------------------------------------------------------------------------------
# Screen <-> world on vertical planes. A "row" is the screen y where a plane meets the ground.
def row_y(row: float) -> float:
    return -row / (PX * lib.COSB)


def zpx(z: float) -> float:
    """On-screen height (px) of a vertical extent of z world units."""
    return z * PX * lib.SINB


def z_of(row: float, sy: float) -> float:
    """World height on the plane at `row` that appears at screen y `sy`."""
    return (row - sy) / (PX * lib.SINB)


def wp(sx: float, row: float, sy: float | None = None, z: float | None = None):
    """World point on the vertical plane at `row`, at screen x `sx` and screen y `sy` (or height z)."""
    zz = z if z is not None else z_of(row, sy)
    return (sx / PX, row_y(row), zz)


def ground(sx: float, row: float, z: float = 0.0):
    return (sx / PX, row_y(row), z)


# ------------------------------------------------------------------------------------------
# Materials (cleared with the scene: start() resets them)
_M: dict = {}


def mats() -> dict:
    if _M:
        return _M
    pm = props.mats()
    _M['paint'] = lib.attr_mat('st_paint', rough=0.55, ao=0.45)
    _M['matte'] = lib.attr_mat('st_matte', rough=0.85, ao=0.5)
    _M['gloss'] = dress.mats()['gloss']
    _M['velvet'] = lib.attr_mat('st_velvet', rough=0.92, sheen=1.0, ao=0.6)
    _M['metal'] = pm['metal']
    _M['wood'] = pm['wood']
    _M['glow'] = pm['glow']
    m = lib.NT('st_bulb')
    c = m.attr('col')
    m.bsdf(c, 0.2, emission=c, emission_strength=5.5, coat=0.6)
    _M['bulb'] = m.mat
    m = lib.NT('st_neon')
    c = m.attr('col')
    m.bsdf(c, 0.3, emission=c, emission_strength=3.2)
    _M['neon'] = m.mat
    m = lib.NT('st_chrome')
    b = m.bsdf(m.attr('col'), 0.16, coat=0.4)
    b.inputs['Metallic'].default_value = 1.0
    _M['chrome'] = m.mat
    m = lib.NT('st_glass')
    b = m.bsdf(m.attr('col'), 0.05, coat=1.0, transmission=0.85, spec=0.6)
    _M['glass'] = m.mat
    _M['leaf'] = dress.mats()['leaf']
    _M['flower'] = dress.mats()['flower']
    _M['stone'] = pm['stone']
    return _M


class Kit:
    """Per-material mesh builders for one named group of props."""

    KINDS = ('paint', 'matte', 'gloss', 'velvet', 'metal', 'wood', 'glow', 'bulb', 'neon', 'chrome', 'glass', 'leaf', 'flower', 'stone')

    def __init__(self, name: str):
        self.name = name
        self.b = {k: MeshBuilder() for k in self.KINDS}

    def __getitem__(self, k):
        return self.b[k]

    def build(self, smooth: bool = True, flat=('matte',)):
        obs = []
        m = mats()
        for k, mb in self.b.items():
            ob = mb.build(f'{self.name}_{k}', m[k], smooth=smooth and k not in flat)
            if ob is not None:
                obs.append(ob)
        return obs


# ------------------------------------------------------------------------------------------
# Geometry helpers
def quad_v(mb, x0, x1, row, sy0, sy1, color, depth: float = 0.0):
    """A camera-facing rectangle on the plane at `row` spanning screen x0..x1 and y sy0 (top)..sy1."""
    y = row_y(row)
    z0, z1 = z_of(row, sy1), z_of(row, sy0)
    a, b = x0 / PX, x1 / PX
    v = [(a, y, z0), (b, y, z0), (b, y, z1), (a, y, z1)]
    if depth > 0:
        v += [(a, y + depth, z0), (b, y + depth, z0), (b, y + depth, z1), (a, y + depth, z1)]
        f = [(0, 1, 2, 3), (1, 5, 6, 2), (4, 0, 3, 7), (3, 2, 6, 7), (4, 5, 1, 0)]
    else:
        f = [(0, 1, 2, 3)]
    mb.add(v, f, col(color) if isinstance(color, str) else color)


def star_pts(n: int, r0: float, r1: float, rot: float = math.pi / 2):
    """2D outline of an n-pointed star (outer radius r0, inner r1), in (x, z)."""
    out = []
    for k in range(2 * n):
        r = r0 if k % 2 == 0 else r1
        a = rot + k * math.pi / n
        out.append((math.cos(a) * r, math.sin(a) * r))
    return out


def flat_shape(mb, pts2, origin, color, thick: float = 0.03):
    """A thin slab in the XZ plane (front faces -Y, towards the camera) with an outline `pts2`."""
    ox, oy, oz = origin
    n = len(pts2)
    front = [(ox + x, oy, oz + z) for (x, z) in pts2]
    back = [(ox + x, oy + thick, oz + z) for (x, z) in pts2]
    v = front + back + [(ox, oy - 0.002, oz)]
    c = len(v) - 1
    f = [(c, k, (k + 1) % n) for k in range(n)]
    f += [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    mb.add(v, f, col(color) if isinstance(color, str) else color)


def disc_v(mb, cx, cz, y, r, color, seg: int = 20, thick: float = 0.02):
    flat_shape(mb, [(math.cos(k / seg * math.tau) * r, math.sin(k / seg * math.tau) * r) for k in range(seg)], (cx, y, cz), color, thick)


def bulb(mb, p, r: float = 0.07, color='#fff1b8'):
    v, f = lib.blob(p, r, rough=0.0, subdiv=1)
    mb.add(v, f, col(color) if isinstance(color, str) else color)


def superellipse(t: float, a: float, b: float, n: float):
    """Point on the upper half of a superellipse |x/a|^n + |z/b|^n = 1 at parameter t (0..pi)."""
    c, s = math.cos(t), math.sin(t)
    x = a * math.copysign(abs(c) ** (2 / n), c)
    z = b * abs(s) ** (2 / n)
    return x, z


def arch_band(mb, cx_px, row, a_px, b_px, n, width_px, depth, color, seg: int = 96, z_base: float = 0.0):
    """A camera-facing arch ring (upper superellipse, feet on the ground) on the plane at `row`:
    inner edge a_px x b_px screen px from (cx, row), `width_px` wide, extruded `depth` units back."""
    y = row_y(row)
    k = PX * lib.SINB
    verts, faces = [], []
    for i in range(seg + 1):
        t = math.pi * i / seg
        xi, zi = superellipse(t, a_px, b_px, n)
        xo, zo = superellipse(t, a_px + width_px, b_px + width_px, n)
        for (xx, zz) in ((xi, zi), (xo, zo)):
            verts.append(((cx_px + xx) / PX, y, z_base + zz / k))
        for (xx, zz) in ((xi, zi), (xo, zo)):
            verts.append(((cx_px + xx) / PX, y + depth, z_base + zz / k))
    for i in range(seg):
        a0, b0 = i * 4, (i + 1) * 4
        faces.append((a0 + 1, a0, b0, b0 + 1))  # front face
        faces.append((a0, a0 + 2, b0 + 2, b0))  # inner face
        faces.append((a0 + 3, a0 + 1, b0 + 1, b0 + 3))  # outer face
    mb.add(verts, faces, col(color) if isinstance(color, str) else color)


def arch_points(cx_px, row, a_px, b_px, n, spacing_px: float, inset_px: float = 0.0):
    """Evenly spaced screen points along an arch's inner edge (for marquee bulbs)."""
    pts = []
    prev = None
    acc = 0.0
    steps = 2000
    for i in range(steps + 1):
        t = math.pi * i / steps
        x, z = superellipse(t, a_px - inset_px, b_px - inset_px, n)
        p = (cx_px + x, row - z)
        if prev is None:
            pts.append(p)
        else:
            acc += math.dist(p, prev)
            if acc >= spacing_px:
                pts.append(p)
                acc = 0.0
        prev = p
    return pts


def curtain(mb, x0, x1, row, sy_top, sy_bottom, color, folds: int = 7, amp: float = 0.12, tie: float | None = None,
            side: str = 'left', gather: float = 0.6, seg_y: int = 18):
    """A velvet drape hanging on the plane at `row` between screen x0..x1, top sy_top to sy_bottom,
    with vertical folds. With `tie` (a screen y) it is a tied-back theatre curtain: its inner edge
    (the right one for side='left') is drawn in towards the outer edge by `gather` of its width at
    that height, flaring out again below."""
    y = row_y(row)
    cols_n = folds * 4
    H = max(1.0, sy_bottom - sy_top)
    verts, faces = [], []
    for j in range(seg_y + 1):
        v = j / seg_y
        sy = sy_top + H * v
        z = z_of(row, sy)
        pinch = 0.0
        if tie is not None:
            if sy <= tie:
                u = (sy - sy_top) / max(1.0, tie - sy_top)
                pinch = gather * (u * u * (3 - 2 * u))
            else:
                u = (sy - tie) / max(1.0, sy_bottom - tie)
                pinch = gather * (1.0 - 0.55 * (u * u * (3 - 2 * u)))
        xa, xb = x0, x1
        if side == 'left':
            xb = x1 - (x1 - x0) * pinch
        else:
            xa = x0 + (x1 - x0) * pinch
        for i in range(cols_n + 1):
            u = i / cols_n
            sx = xa + (xb - xa) * u
            depth = amp * (0.6 + 0.8 * pinch) * math.sin(u * folds * math.tau)
            verts.append((sx / PX, y + depth + 0.4 * amp, z))
    w = cols_n + 1
    for j in range(seg_y):
        for i in range(cols_n):
            a = j * w + i
            faces.append((a, a + w, a + w + 1, a + 1))
    mb.add(verts, faces, col(color) if isinstance(color, str) else color)


def palm(k: Kit, sx, row, h: float = 3.2, lean: float = 0.25, seed: int = 1, s: float = 1.0):
    """A stylised palm tree: curved ringed trunk and a crown of drooping fronds."""
    import random
    rnd = random.Random(seed)
    base = Vector(ground(sx, row))
    pts = []
    for i in range(9):
        t = i / 8
        pts.append((base.x + lean * s * t * t * 2.0, base.y, base.z + h * s * t))
    v, f = lib.tube(pts, lambda t: (0.13 - 0.05 * t) * s, 8)
    k['wood'].add(v, f, col('#a0714a'))
    for i in range(1, 8):
        v, f = lib.tube([pts[i], (pts[i][0], pts[i][1], pts[i][2] + 0.04)], (0.15 - 0.05 * i / 8) * s, 8)
        k['wood'].add(v, f, col('#7a5234'))
    top = Vector(pts[-1])
    for j in range(9):
        a = j / 9 * math.tau + rnd.uniform(-0.2, 0.2)
        L = rnd.uniform(1.1, 1.5) * s
        fr = []
        for i in range(7):
            t = i / 6
            fr.append((top.x + math.cos(a) * L * t, top.y + math.sin(a) * L * t * 0.6, top.z + 0.25 * s * math.sin(t * math.pi * 0.8) - 0.55 * s * t * t))
        # a flat leaf strip along the frond
        verts, faces = [], []
        for i, q in enumerate(fr):
            t = i / 6
            w = 0.22 * s * math.sin(math.pi * min(1.0, t * 1.1 + 0.05))
            nx, ny = -math.sin(a), math.cos(a) * 0.6
            verts.append((q[0] + nx * w, q[1] + ny * w, q[2] - 0.02))
            verts.append((q[0] - nx * w, q[1] - ny * w, q[2] - 0.02))
        for i in range(6):
            faces.append((i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2))
            faces.append((i * 2 + 2, i * 2 + 3, i * 2 + 1, i * 2))
        k['leaf'].add(verts, faces, col(rnd.choice(['#3f9b45', '#2f8a3c', '#56b04c'])))
    for j in range(3):
        a = j / 3 * math.tau
        v, f = lib.blob((top.x + math.cos(a) * 0.1 * s, top.y + math.sin(a) * 0.06 * s, top.z - 0.12 * s), 0.09 * s, rough=0.1, subdiv=1)
        k['paint'].add(v, f, col('#8a5a2e'))
