"""Chappell: a fan-made chibi caricature of pop singer Chappell Roan for the private, non-commercial party
build (loaded by characters.py as class `Chappell`).

An affectionate, all-ages collectible-figure take in the game's chibi style (Kip's structure): a huge cloud
of curly copper-red hair with corkscrew ringlets and curls peeking under a pink cowboy hat (cattleman
crease, side-curled brim, a rhinestone band); bold drag-inspired stage makeup (a sparkly blue lid, big
rosy glitter blush, dramatic lashes, red lips); a glittery hot-pink western outfit: a rhinestone jacket
with a piped yoke, pearl snaps and white fringe along the sleeves, a matching A-line skirt with a fringed
hem, and white cowboy boots with pink stitching.

Secondary motion uses the shared pose extras: 'scarf' (0 still .. 1 streaming) and 'wave' (phase) blow the
fringe and the skirt back. The skirt rides up over the thighs when the legs lift, and the curls part
behind a raised arm so the arm stays visible.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import (HeadShape, R, S, T, arc_points, curve3, disc, ellipsoid, flat_sweep, polyline_segment, rmf_frames, superellipsoid,
                      sweep, torus)
from char_models import DEFAULT_FACE, Hero, hair_shell, hand_mitten, periodic_interp


# ------------------------------------------------------------------------------------------
# Small helpers (local copies so this module only depends on the shared files as they are)
def clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return max(a, min(b, x))


def sstep(x: float) -> float:
    x = clamp(x)
    return x * x * (3.0 - 2.0 * x)


class MeshAcc:
    """Accumulates several meshes (and their 'tip' values) into one part."""

    def __init__(self):
        self.v, self.f, self.tip = [], [], []

    def add(self, mesh, tip=None, m: Matrix | None = None):
        vv, ff = mesh[0], mesh[1]
        if m is not None:
            vv = [tuple(m @ Vector(q)) for q in vv]
        b0 = len(self.v)
        self.v.extend(tuple(q) for q in vv)
        self.f.extend(tuple(q + b0 for q in face) for face in ff)
        if tip is not None:
            self.tip.extend(tip if isinstance(tip, (list, tuple)) else [tip] * len(vv))
        elif len(mesh) > 2:
            self.tip.extend(mesh[2])
        else:
            self.tip.extend([0.5] * len(vv))

    @property
    def mesh(self):
        return self.v, self.f


def flat_tip(n: int, sides: int, nverts: int, t0: float = 0.0, t1: float = 1.0):
    """'tip' values for a sweep / flat_sweep of n rings: t0..t1 along the rings, then both caps."""
    tip = []
    for i in range(n):
        tip += [t0 + (t1 - t0) * i / max(1, n - 1)] * sides
    rest = nverts - n * sides
    tip += [t1] * (rest // 2) + [t0] * (rest - rest // 2)
    return tip


def tube(pts, radius, sides: int = 24, cap_steps: int = 4, caps: bool = True):
    """Like char_rig.sweep, but radius(t, a) may vary around the tube (a = angle in radians)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    frames = rmf_frames(pts)
    verts, faces = [], []
    for i, p in enumerate(pts):
        _t, u, v = frames[i]
        tt = i / max(1, n - 1)
        for k in range(sides):
            a = k / sides * math.tau
            verts.append(tuple(p + (u * math.cos(a) + v * math.sin(a)) * radius(tt, a)))
    for i in range(n - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    if not caps:
        return verts, faces

    def cap(idx, sign):
        t, u, v = frames[idx]
        p = pts[idx]
        tt = idx / max(1, n - 1)
        r0 = sum(radius(tt, k / sides * math.tau) for k in range(sides)) / sides
        prev = list(range(idx * sides, idx * sides + sides))
        for s_ in range(1, cap_steps):
            ang = s_ / cap_steps * math.pi / 2
            ring = []
            for k in range(sides):
                a = k / sides * math.tau
                q = p + t * (sign * math.sin(ang) * r0 * 0.6) + (u * math.cos(a) + v * math.sin(a)) * (radius(tt, a) * math.cos(ang))
                verts.append(tuple(q))
                ring.append(len(verts) - 1)
            for k in range(sides):
                k2 = (k + 1) % sides
                if sign > 0:
                    faces.append((prev[k], prev[k2], ring[k2], ring[k]))
                else:
                    faces.append((prev[k], ring[k], ring[k2], prev[k2]))
            prev = ring
        verts.append(tuple(p + t * (sign * r0 * 0.6)))
        tip = len(verts) - 1
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((prev[k], prev[k2], tip) if sign > 0 else (prev[k], tip, prev[k2]))

    cap(n - 1, 1)
    cap(0, -1)
    return verts, faces


def orient(pos, nrm, roll: float = 0.0) -> Matrix:
    """A frame at `pos` whose -Y faces along `nrm` (details are modelled facing -Y, up +Z)."""
    fwd = -Vector(nrm).normalized()
    x = fwd.cross(Vector((0.0, 0.0, 1.0)))
    if x.length < 1e-4:
        x = Vector((1.0, 0.0, 0.0))
    x.normalize()
    z = x.cross(fwd).normalized()
    m = Matrix((x, fwd, z)).transposed().to_4x4()
    m.translation = Vector(pos)
    return m @ R(0, roll, 0)


def seg_closest(p: Vector, a: Vector, b: Vector) -> Vector:
    ab = b - a
    t = clamp((p - a).dot(ab) / max(1e-9, ab.dot(ab)))
    return a + ab * t


def catmull(ctrl, per: int = 6):
    """A smooth Catmull-Rom curve through the control points (clamped ends)."""
    ctrl = [Vector(c) for c in ctrl]
    pts = []
    n = len(ctrl)
    for i in range(n - 1):
        p0 = ctrl[max(i - 1, 0)]
        p1, p2 = ctrl[i], ctrl[i + 1]
        p3 = ctrl[min(i + 2, n - 1)]
        for j in range(per):
            t = j / per
            t2, t3 = t * t, t * t * t
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    pts.append(ctrl[-1].copy())
    return pts


def grid_shell(outer, inner, closed: bool = False):
    """A thin two-layer sheet from two grids g[i][j] (i across, counter-clockwise seen from above; j down
    the sheet), with rims along its open edges. closed joins the last column back to the first."""
    C, Rn = len(outer), len(outer[0])
    verts = [tuple(p) for g in (outer, inner) for colm in g for p in colm]
    L = C * Rn

    def ix(layer, i, j):
        return layer * L + i * Rn + j

    faces = []
    span = C if closed else C - 1
    for i in range(span):
        i2 = (i + 1) % C
        for j in range(Rn - 1):
            faces.append((ix(0, i, j), ix(0, i, j + 1), ix(0, i2, j + 1), ix(0, i2, j)))
            faces.append((ix(1, i, j), ix(1, i2, j), ix(1, i2, j + 1), ix(1, i, j + 1)))
        faces.append((ix(0, i, 0), ix(0, i2, 0), ix(1, i2, 0), ix(1, i, 0)))
        j = Rn - 1
        faces.append((ix(0, i, j), ix(1, i, j), ix(1, i2, j), ix(0, i2, j)))
    if not closed:
        for j in range(Rn - 1):
            faces.append((ix(0, 0, j), ix(1, 0, j), ix(1, 0, j + 1), ix(0, 0, j + 1)))
            i = C - 1
            faces.append((ix(0, i, j), ix(0, i, j + 1), ix(1, i, j + 1), ix(1, i, j)))
    return verts, faces


def ring_sweep(pts, r: float, sides: int = 8):
    """A closed tube through a loop of points (a hem or neckline trim)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    c = sum(pts, Vector()) / n
    verts, faces = [], []
    for i, p in enumerate(pts):
        t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        u = p - c
        u = (u - t * u.dot(t))
        u = u.normalized() if u.length > 1e-6 else Vector((0.0, 0.0, 1.0))
        v = t.cross(u)
        for k in range(sides):
            a = k / sides * math.tau
            verts.append(tuple(p + (u * math.cos(a) + v * math.sin(a)) * r))
    for i in range(n):
        i2 = (i + 1) % n
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((i * sides + k, i * sides + k2, i2 * sides + k2, i2 * sides + k))
    return verts, faces


def push_capsule(p: Vector, a: Vector, b: Vector, r: float) -> Vector:
    c = seg_closest(p, a, b)
    d = p - c
    ln = d.length
    if ln < r:
        if ln < 1e-6:
            return p
        return c + d * (r / ln)
    return p


def push_back(p: Vector, a: Vector, b: Vector, r: float, bk: Vector) -> Vector:
    """Move p along bk (e.g. towards the character's back) until it clears the capsule a-b of radius r, so
    hair slides behind an arm instead of wrapping round it. Falls back to a radial push."""
    c = seg_closest(p, a, b)
    if (p - c).length >= r:
        return p
    u = b - a
    ln = u.length
    if ln < 1e-6:
        return push_capsule(p, a, b, r)
    u = u / ln
    w = (p - a) - u * (p - a).dot(u)
    bp = bk - u * bk.dot(u)
    A = bp.dot(bp)
    if A < 0.05:
        return push_capsule(p, a, b, r)
    B = w.dot(bp)
    disc = B * B - A * (w.dot(w) - r * r)
    if disc < 0.0:
        return p
    t = (-B + math.sqrt(disc)) / A
    q = p + bk * max(0.0, t)
    return push_capsule(q, a, b, r)


def push_ellipsoid(p: Vector, M: Matrix, Mi: Matrix, c: Vector, r: Vector) -> Vector:
    q = Mi @ p - c
    e = Vector((q.x / r.x, q.y / r.y, q.z / r.z)).length
    if 1e-6 < e < 1.0:
        return M @ (q / e + c)
    return p


def ramp_mat(mats, name: str, stops, rough: float = 0.42, coat: float = 0.3, sheen: float = 0.25, spec: float = 0.45):
    """A soft material coloured by a colour ramp over the per-vertex 'tip' attribute (hair)."""
    def make(n):
        m = lib.NT(n)
        a = m.node('ShaderNodeAttribute')
        a.attribute_name = 'tip'
        c = m.ramp(a.outputs['Fac'], stops)
        m.bsdf(c, rough, coat=coat, sheen=sheen, spec=spec)
        return m.mat
    return mats.get(name, make)


def sequin_mat(mats, name: str, base: str, dark: str, sparkle: str, scale: float = 58.0, glint: float = 1.0, pick_at: float = 0.52):
    """Cloth covered in tiny sequins: a Voronoi cell per sequin, some of them tilted to catch the light
    (metallic, glossy, a faint glow), over a softly mottled base."""
    def make(n):
        m = lib.NT(n)
        obj = m.node('ShaderNodeTexCoord').outputs['Object']
        vor = m.voronoi(scale, obj)
        d = vor.outputs['Distance']
        rnd = m.sep(vor.outputs['Color'])[0]
        disc_ = m.maprange(d, 0.38, 0.28)
        pick = m.maprange(rnd, pick_at, pick_at + 0.04)
        g = m.math('MULTIPLY', disc_, pick)
        nz = m.noise(7.0, 2, 0.5, obj).outputs['Fac']
        basec = m.mix(m.maprange(nz, 0.3, 0.72), col(dark), col(base))
        c = m.mix(m.math('MULTIPLY', g, 0.55), basec, col(sparkle))
        nrm = m.bump(m.math('MULTIPLY', disc_, rnd), 0.22, 0.01)
        b = m.bsdf(c, 0.6, normal=nrm, sheen=0.35, spec=0.5, coat=0.12)
        m.link(m.math('MULTIPLY', g, 0.5), b.inputs['Metallic'])
        m.link(m.math('SUBTRACT', 0.6, m.math('MULTIPLY', g, 0.38)), b.inputs['Roughness'])
        b.inputs['Emission Color'].default_value = col(sparkle)
        m.link(m.math('MULTIPLY', g, 0.22 * glint), b.inputs['Emission Strength'])
        return m.mat
    return mats.get(name, make)


def dir_yp(yaw: float, pitch: float) -> Vector:
    y, p = math.radians(yaw), math.radians(pitch)
    return Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))


def glitter_mat(mats, name: str, color: str, spark: str, alpha: float, scale: float = 90.0, glow: float = 1.2, pick_at: float = 0.58):
    """A see-through (alpha) makeup layer sprinkled with glitter specks that sparkle."""
    def make(n):
        m = lib.NT(n)
        obj = m.node('ShaderNodeTexCoord').outputs['Object']
        vor = m.voronoi(scale, obj)
        rnd = m.sep(vor.outputs['Color'])[0]
        dot = m.math('MULTIPLY', m.maprange(vor.outputs['Distance'], 0.32, 0.2), m.maprange(rnd, pick_at, pick_at + 0.04))
        c = m.mix(dot, col(color), col(spark))
        a = m.math('MAXIMUM', dot, alpha)
        b = m.bsdf(c, 0.4, alpha=a, coat=0.3, spec=0.5)
        b.inputs['Emission Color'].default_value = col(spark)
        m.link(m.math('MULTIPLY', dot, glow), b.inputs['Emission Strength'])
        return m.mat
    return mats.get(name, make)


def curl_mat(mats, name: str, stops, scale: float = 24.0):
    """Curly hair: a ramp over 'tip' (darker in the crevices, lighter on the outer faces of the curls)
    with soft, wavy ridges running round the curls."""
    def make(n):
        m = lib.NT(n)
        a = m.node('ShaderNodeAttribute')
        a.attribute_name = 'tip'
        c = m.ramp(a.outputs['Fac'], stops)
        obj = m.node('ShaderNodeTexCoord').outputs['Object']
        wv = m.node('ShaderNodeTexWave')
        wv.wave_type = 'BANDS'
        wv.bands_direction = 'Z'
        wv.wave_profile = 'SIN'
        wv.inputs['Scale'].default_value = scale
        wv.inputs['Distortion'].default_value = 3.0
        wv.inputs['Detail'].default_value = 1.5
        m.link(obj, wv.inputs['Vector'])
        nrm = m.bump(wv.outputs['Fac'], 0.3, 0.02)
        m.bsdf(c, 0.45, normal=nrm, coat=0.2, sheen=0.4, spec=0.4)
        return m.mat
    return mats.get(name, make)


def gem_mat(mats, name: str, color: str):
    """Rhinestones: bright, mirror-like and faintly glowing."""
    def make(n):
        m = lib.NT(n)
        b = m.bsdf(col(color), 0.08, coat=0.8, spec=0.9, emission=col(color), emission_strength=0.35)
        b.inputs['Metallic'].default_value = 0.7
        return m.mat
    return mats.get(name, make)


def lathe(profile, seg: int = 48):
    """Revolve a profile [(r, z), ...] (top first) around Z; r == 0 makes a pole."""
    verts, faces, rings = [], [], []
    for r, z in profile:
        if r < 1e-6:
            verts.append((0.0, 0.0, z))
            rings.append(len(verts) - 1)
        else:
            ring = []
            for k in range(seg):
                a = k / seg * math.tau
                verts.append((r * math.cos(a), r * math.sin(a), z))
                ring.append(len(verts) - 1)
            rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            k2 = (k + 1) % seg
            if isinstance(a, int):
                faces.append((a, b[k], b[k2]))
            elif isinstance(b, int):
                faces.append((a[k], b, a[k2]))
            else:
                faces.append((a[k], b[k], b[k2], a[k2]))
    return verts, faces


def hash01(*k) -> float:
    """Deterministic pseudo-random value in 0..1 (the same curls in every frame)."""
    x = math.sin(sum((i + 1) * 12.9898 * v for i, v in enumerate(k)) + 78.233) * 43758.5453
    return x - math.floor(x)


def frame_from(z_axis: Vector, y_hint: Vector, pos: Vector) -> Matrix:
    """A matrix whose local Z runs along z_axis and local Y leans towards y_hint."""
    z = z_axis.normalized()
    y = y_hint - z * y_hint.dot(z)
    if y.length < 1e-6:
        y = Vector((0.0, 1.0, 0.0)) - z * z.y
    y.normalize()
    x = y.cross(z).normalized()
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = pos
    return m


# ------------------------------------------------------------------------------------------
class Chappell(Hero):
    """Chappell: huge copper curls under a pink cowboy hat, drag stage makeup, pink rhinestone western outfit."""

    key = 'chappell'
    ankle_h = 0.18  # boot heels
    hip_h = 0.66  # ankle_h + 0.04 + thigh + shin
    spine = 0.08
    chest = 0.19
    neck = 0.13
    head_up = 0.04
    shoulder = (0.21, 0.0, 0.11)
    upper_arm = 0.21
    forearm = 0.185
    hip_w = 0.105
    thigh = 0.215
    shin = 0.225
    sit_h = 0.17

    C = dict(skin='#fcdccb', skin_d='#f0b4a0', nose='#f6c3ae', jacket='#ef4f98', jacket_d='#cf3a7e', sparkle='#ffffff', trim='#ffd6e8',
             fringe='#fff1f7', snap='#fff8f2', gem='#f2f4ff', hat='#f56aaa', hat_d='#d84b8d', band='#c12f70', boot='#fbfaf6',
             boot_d='#e8e2da', stitch='#f0589c', heel='#e2d9cd', iris='#3c8e9c', iris_l='#95d8dc', brow='#a5421e', lash='#1a0f11',
             lip='#d21e3e', mouth='#721a28', shadow='#45bdf3', blush='#ff5b8e')
    HAIR = [(0.0, '#5a170a'), (0.24, '#882711'), (0.5, '#b13f1c'), (0.76, '#d05b29'), (1.0, '#e97f43')]

    HEAD = (0.4, 0.37, 0.385, 0.41)  # rx, ry, rz, centre height above the head joint
    EYE = (24.0, -7.0)
    HAT = (0.03, 0.235, -7.0, 4.0)  # y offset, base height above the head centre, tilt back, roll

    def head_top(self) -> float:
        return self.HEAD[3] + self.HAT[1] + 0.27 + 0.12

    # --- shared bits ----------------------------------------------------------------------------
    def back_dir(self) -> Vector:
        yaw = math.radians(self.pose.get('root', {}).get('yaw', 0.0))
        return Vector((-math.sin(yaw), math.cos(yaw), 0.0))

    def side_raise(self, s_: str) -> float:
        """0..1: how far an arm is lifted up at the side (the curls part behind it)."""
        ra, sw, _tw, _el = self.pose['arm' + s_]
        return sstep((ra - 65.0) / 55.0) * sstep((55.0 - sw) / 45.0)

    @staticmethod
    def rb(z: float) -> float:
        """Torso half-width at chest-frame height z (depth is 0.8 of it)."""
        t = clamp((z + 0.35) / 0.47)
        return 0.204 - 0.03 * t + 0.012 * math.sin(math.pi * t)

    # --- building -------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('chap_skin', c['skin']),
            skin_d=mt.skin('chap_skin_d', c['skin_d']),
            jacket=sequin_mat(mt, 'chap_jacket', c['jacket'], c['jacket_d'], c['sparkle'], 50.0, 1.6, 0.62),
            sleeve=sequin_mat(mt, 'chap_sleeve', c['jacket'], c['jacket_d'], c['sparkle'], 64.0, 1.4, 0.62),
            under=mt.cloth('chap_under', c['jacket_d'], 0.7, 0.4),
            trim=mt.cloth('chap_trim', c['trim'], 0.6, 0.5),
            fringe=mt.cloth('chap_fringe', c['fringe'], 0.55, 0.6),
            snap=mt.glossy('chap_snap', c['snap'], 0.2, 0.8),
            gem=gem_mat(mt, 'chap_gem', c['gem']),
            hat=mt.cloth('chap_hat', c['hat'], 0.62, 0.45, 0.06, 80),
            hat_d=mt.cloth('chap_hat_d', c['hat_d'], 0.62, 0.4),
            band=mt.glossy('chap_band', c['band'], 0.35, 0.4),
            boot=mt.glossy('chap_boot', c['boot'], 0.28, 0.6),
            boot_d=mt.glossy('chap_boot_d', c['boot_d'], 0.32, 0.5),
            stitch=mt.glossy('chap_stitch', c['stitch'], 0.35, 0.3),
            heel=mt.glossy('chap_heel', c['heel'], 0.35, 0.3),
            curls=curl_mat(mt, 'chap_curls', self.HAIR, 26.0),
            hair=ramp_mat(mt, 'chap_hair', self.HAIR, 0.45, 0.2, 0.35, 0.4),
        )
        self.torso()
        self.skirt()
        self.legs()
        self.arms()
        self.head_parts()

    # --- torso: the rhinestone western jacket -------------------------------------------------------
    def jr(self, z: float) -> float:
        """Jacket half-width at chest-frame height z: flares a touch at the hem over the skirt's waist."""
        return self.rb(z) + 0.006 + 0.022 * sstep((-0.11 - z) / 0.09)

    def torso(self):
        mm, jr = self.mat, self.jr
        z0, z1 = -0.2, 0.12
        self.add('jacket', sweep([Vector((0, 0, z0 + (z1 - z0) * i / 12)) for i in range(13)], lambda t: jr(z0 + (z1 - z0) * t), 30, cap0=False,
                                 squash=0.8), mm['jacket'], 'chest')
        rt = jr(0.12) - 0.012
        self.add('shoulders', ellipsoid(rt, rt * 0.8, 0.085, 28, 12, center=(0, 0, 0.1), zmin=-0.2), mm['jacket'], 'chest')
        self.add('core', ellipsoid(0.19, 0.15, 0.2, 20, 12, center=(0, 0, -0.12)), mm['under'], 'chest')
        self.add('hemtrim', torus(jr(z0), 0.016, 48, 8, center=(0, 0, z0 + 0.004)), mm['trim'], 'chest', S(1.0, 0.8, 1.0))
        a = self.J('chest') @ Vector((0.0, 0.0, 0.1))
        b = self.J('neck') @ Vector((0.0, 0.0, 0.03))
        cc = self.J('head') @ Vector((0.0, 0.01, 0.12))
        self.add('neck', sweep(curve3(a, b, cc, 6), 0.062, 14), mm['skin'])
        self.add('pelvis', superellipsoid(0.19, 0.158, 0.14, 2.4, 28, 16, center=(0, 0, -0.03)), mm['under'], 'hips')

        def on_jacket(ph_deg, z, lift=0.006):
            ph = math.radians(ph_deg)
            r = jr(z) + lift
            return Vector((math.cos(ph) * r, math.sin(ph) * r * 0.8, z))

        # piped western yokes (front and back) studded with rhinestones
        gems = MeshAcc()
        for centre, dip in ((-90.0, 0.11), (90.0, 0.06)):
            pts = []
            for i in range(17):
                u = -1.0 + 2.0 * i / 16
                z = 0.105 - dip * (1.0 - abs(u)) ** 1.5
                pts.append(on_jacket(centre + 62.0 * u, z))
            self.add('yoke', sweep(pts, 0.009, 8), mm['trim'], 'chest')
            for i in range(1, 16, 2):
                p = pts[i]
                nrm = Vector((p.x, p.y / 0.64, 0.0)).normalized()
                gems.add(ellipsoid(0.011, 0.008, 0.011, 10, 6), m=orient(p + nrm * 0.008, nrm))
        # pointed collar: a roll round the back of the neck and two flaps at the front
        cpts = []
        for i in range(15):
            ph = math.radians(-50 + (230 + 50) * i / 14)
            fr = max(0.0, -math.sin(ph))
            cpts.append(Vector((0.118 * math.cos(ph), 0.118 * math.sin(ph) * 0.9 + 0.01, 0.168 - 0.04 * fr)))
        self.add('collar', sweep(cpts, 0.022, 10), mm['trim'], 'chest')
        for sd in (1, -1):
            flap = [Vector((0.05 * sd, -0.112, 0.15)), Vector((0.085 * sd, -0.15, 0.1)), Vector((0.11 * sd, -0.168, 0.058))]
            self.add('flap', flat_sweep(flap, lambda t: 0.036 * (1 - t) + 0.006, Vector((0.0, -1.0, 0.35)), 0.3, 10), mm['trim'], 'chest')
        # pearl snaps down the front
        for k, z in enumerate((0.0, -0.06, -0.12)):
            p = on_jacket(-90.0, z, 0.004)
            gems.add(ellipsoid(0.014, 0.008, 0.014, 12, 6), m=orient(p, Vector((0.0, -1.0, 0.0))))
        self.add('gems', gems.mesh, mm['gem'], 'chest')

    # --- the fringed A-line skirt ---------------------------------------------------------------------
    def skirt(self):
        mm = self.mat
        ex = self.pose.get('extra', {})
        fly = clamp(ex.get('scarf', 0.0))
        wave = ex.get('wave', 0.0)
        Hp = self.J('hips')
        H3 = Hp.to_3x3()
        back = self.back_dir()
        ztop = 0.1
        rt = 0.214
        Ln = 0.265
        alpha = 22.0
        N, M_ = 64, 8
        caps = []
        for s_ in ('L', 'R'):
            hp, kn, an = self.P('hip' + s_), self.P('knee' + s_), self.P('ankle' + s_)
            caps.append((hp, kn, 0.125))
            caps.append((kn, kn.lerp(an, 0.4), 0.1))

        def clear(p0, d):
            for k in range(1, 7):
                q = p0 + d * (Ln * k / 6)
                for a, b, r in caps:
                    if (q - seg_closest(q, a, b)).length < r:
                        return False
            return True

        tops, psis = [], []
        for i in range(N):
            ph = math.radians(-90.0 + 360.0 * i / N)
            p0 = Hp @ Vector((rt * math.cos(ph), rt * 0.84 * math.sin(ph), ztop))
            psi = alpha
            while psi < 160.0:
                ps = math.radians(psi)
                d = H3 @ Vector((math.sin(ps) * math.cos(ph), math.sin(ps) * math.sin(ph), -math.cos(ps)))
                if clear(p0, d):
                    break
                psi += 3.0
            tops.append(p0)
            psis.append(psi)
        sm = []
        for i in range(N):
            best = psis[i]
            for j in range(N):
                dd = min(abs(i - j), N - abs(i - j)) * 360.0 / N
                best = max(best, psis[j] - 1.15 * dd)
            sm.append(best)
        psis = [max(sm[i], (sm[i - 1] + 2 * sm[i] + sm[(i + 1) % N]) / 4) for i in range(N)]

        down = Vector((0.0, 0.0, -1.0))
        outer, inner, hem = [], [], []
        fringe = MeshAcc()
        for i in range(N):
            ph = math.radians(-90.0 + 360.0 * i / N)
            ps = math.radians(psis[i])
            d = H3 @ Vector((math.sin(ps) * math.cos(ph), math.sin(ps) * math.sin(ph), -math.cos(ps)))
            o = H3 @ Vector((math.cos(ps) * math.cos(ph), math.cos(ps) * math.sin(ph), math.sin(ps)))
            hout = H3 @ Vector((math.cos(ph), math.sin(ph), 0.0))
            hout.z = 0.0
            hout = hout.normalized() if hout.length > 1e-6 else Vector((1.0, 0.0, 0.0))
            behind = max(0.0, hout.dot(back))
            co, ci = [], []
            for j in range(M_):
                s = j / (M_ - 1)
                p = tops[i] + d * (Ln * s)
                fold = 0.01 * s ** 1.4 * math.sin(ph * 7.0 + 0.3)
                p += o * (0.02 * s * s + fold + 0.01 * s * s * math.sin(wave * 1.3 + ph * 3.0) * (0.3 + fly))
                p += back * (fly * 0.09 * s * s * (0.35 + 0.65 * behind))
                if p.z < 0.014:
                    dz = 0.014 - p.z
                    p.z = 0.014
                    p += hout * (dz * 0.9)
                co.append(p)
                ci.append(p - o * 0.013)
            outer.append(co)
            inner.append(ci)
            hp_ = co[-1] + o * 0.004 - d * 0.004
            hem.append(hp_)
            # a fringe strand hanging from the hem
            g = (d * 0.35 + down * 0.65 + back * (0.5 * fly) + hout * 0.08).normalized()
            ln = 0.075 + 0.012 * math.sin(i * 2.3)
            sw_ = 0.01 * math.sin(wave * 1.7 + i * 0.9) * (0.3 + fly)
            pts = []
            for k in range(4):
                t = k / 3
                q = hp_ + g * (ln * t) + hout * (sw_ * t * t)
                q.z = max(q.z, 0.01)
                pts.append(q)
            fringe.add(sweep(pts, lambda t: 0.0068 - 0.0022 * t, 5))
        Hi = Hp.inverted()
        outer = [[Hi @ p for p in colm] for colm in outer]
        inner = [[Hi @ p for p in colm] for colm in inner]
        self.add('skirt', grid_shell(outer, inner, closed=True), mm['jacket'], 'hips')
        self.add('hem', ring_sweep([Hi @ p for p in hem], 0.012, 8), mm['trim'], 'hips')
        self.add('skirtfringe', (fringe.v, fringe.f), mm['fringe'])
        # a white belt with a silver buckle at the waist
        self.add('belt', torus(rt + 0.004, 0.02, 48, 8, center=(0, 0, ztop + 0.01), squash=1.2), mm['trim'], 'hips', S(1.0, 0.84, 1.0))
        bm = T(0.0, -(rt + 0.004) * 0.84 - 0.02, ztop + 0.01)
        self.add('buckle', superellipsoid(0.04, 0.012, 0.03, 3.5, 14, 8), mm['gem'], 'hips', bm)

    # --- legs: white cowboy boots ------------------------------------------------------------------------
    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.082 - 0.02 * t + 0.006 * math.sin(math.pi * clamp((t - 0.45) / 0.4)), mm['skin'],
                      0.0, 0.62, 14, 12)
            self.limb('shaft' + s_, hip, kn, an, lambda t: 0.079 + 0.016 * sstep((0.28 - t) / 0.28), mm['boot'], 0.53, 1.0, 16, 12)
            self.limb('shaftrim' + s_, hip, kn, an, 0.097, mm['boot_d'], 0.525, 0.55, 16, 2)
            # a stitched pink heart on the front of each shaft
            ka, aa = self.P(kn), self.P(an)
            axis = (aa - ka).normalized()
            fwd = self.J(an).to_3x3() @ Vector((0.0, -1.0, 0.0))
            fwd = (fwd - axis * fwd.dot(axis)).normalized()
            side = axis.cross(fwd)
            mid = ka.lerp(aa, 0.5)
            pts = []
            for k in range(33):
                tt = k / 32 * math.tau
                hx_ = 16 * math.sin(tt) ** 3
                hy_ = 13 * math.cos(tt) - 5 * math.cos(2 * tt) - 2 * math.cos(3 * tt) - math.cos(4 * tt)
                u, w = hx_ * 0.0022, hy_ * 0.0022
                ang = u / 0.085
                pts.append(mid - axis * w + (fwd * math.cos(ang) + side * math.sin(ang)) * 0.087)
            self.add('heart' + s_, sweep(pts, 0.0055, 5), mm['stitch'])
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('vamp' + s_, superellipsoid(0.086, 0.11, 0.08, 2.4, 22, 14, center=(0, -0.02, -0.08)), mm['boot'], None, fm)
            tpts = [Vector((0.0, -0.04 - 0.24 * k / 10, -0.098 + 0.03 * (k / 10) ** 2.2)) for k in range(11)]
            self.add('toe' + s_, sweep(tpts, lambda t: 0.08 * (1 - t) ** 0.9 + 0.01, 16, squash=0.6), mm['boot'], None, fm)
            spts = [Vector((0.0, 0.05 - 0.32 * k / 10, -0.168)) for k in range(11)]
            self.add('sole' + s_, sweep(spts, lambda t: 0.086 * (1 - 0.35 * t) * (1 - sstep((t - 0.7) / 0.3) * 0.75), 16, squash=0.16), mm['heel'],
                     None, fm)
            self.add('heel' + s_, superellipsoid(0.056, 0.05, 0.03, 3.0, 16, 8, center=(0, 0.045, -0.15)), mm['heel'], None, fm)
            self.add('toecap' + s_, sweep([Vector((-0.062, -0.13, -0.09)), Vector((0.0, -0.17, -0.07)), Vector((0.062, -0.13, -0.09))], 0.006, 5),
                     mm['stitch'], None, fm)

    # --- arms: fringed rhinestone sleeves ------------------------------------------------------------------
    def arms(self):
        mm = self.mat
        ex = self.pose.get('extra', {})
        fly = clamp(ex.get('scarf', 0.0))
        wave = ex.get('wave', 0.0)
        back = self.back_dir()
        Ch3 = self.J('chest').to_3x3()
        down = Vector((0.0, 0.0, -1.0))
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.086 - 0.012 * t, mm['sleeve'], 0.0, 0.88, 14, 14, cap0=True, cap1=False)
            self.limb('cuff' + s_, sh, el, wr, 0.08, mm['trim'], 0.84, 0.92, 14, 3, cap0=False, cap1=False)
            self.limb('wrist' + s_, sh, el, wr, 0.05, mm['skin'], 0.88, 1.0, 12, 4, extend=0.02)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.16):
                self.add('hand' + nm + s_, mesh, mm['skin'], None, wm)
            # white fringe along the back of the sleeve, hanging with gravity
            pts_axis = polyline_segment(curve3(self.P(sh), self.P(el), self.P(wr), 24), 0.1, 0.8, 18)
            ref = (Ch3 @ Vector((0.75 * sd, 0.7, 0.0))).normalized()
            acc = MeshAcc()
            for k in range(1, len(pts_axis) - 1):
                p = pts_axis[k]
                tg = (pts_axis[k + 1] - pts_axis[k - 1]).normalized()
                n = ref - tg * ref.dot(tg)
                if n.length < 1e-3:
                    n = Ch3 @ Vector((0.0, 1.0, 0.0))
                n.normalize()
                t_ = 0.1 + 0.7 * k / (len(pts_axis) - 1)
                r_ = 0.086 - 0.012 * t_
                p0 = p + n * (r_ - 0.006)
                g = (down * 0.8 + n * 0.4 + back * (0.7 * fly)).normalized()
                ln = 0.085 + 0.012 * math.sin(k * 1.9)
                sw_ = 0.012 * math.sin(wave * 1.5 + k * 1.1) * (0.3 + fly)
                side = g.cross(n)
                strand = [p0 + g * (ln * t) + side * (sw_ * t * t) for t in (0.0, 0.34, 0.67, 1.0)]
                acc.add(sweep(strand, lambda t: 0.0068 - 0.0022 * t, 5))
            self.add('fringe' + s_, (acc.v, acc.f), mm['fringe'])

    # --- head ---------------------------------------------------------------------------------------------
    def head_parts(self):
        c, mm = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        hv = [(x * (1 - 0.11 * max(0.0, (hc - z) / hz) ** 1.6), y - 0.02 * max(0.0, (hc - z) / hz) ** 2, z) for (x, y, z) in hv]
        self.add('head', (hv, hf), mm['skin'], 'head')
        ey, ep = self.EYE
        self.face(head, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(0.096, 0.124), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-31,
                  lid_col=c['skin'], skin=c['nose'], brow_pitch=22, lash_col=c['lash'])
        self.hair()
        self.hat()

    # --- hair: a huge cloud of copper curls -----------------------------------------------------------------
    def hair(self):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))

        def boundary(yaw):
            return periodic_interp([(0, 40), (30, 36), (52, 22), (72, 2), (100, -10), (140, -16), (180, -18)], abs(yaw))

        def thickness(yaw, pitch, f):
            edge = min(1.0, f / 0.15)
            return (0.02 + 0.06 * math.sin(math.pi * min(1.0, f * 1.6)) * (1.0 - sstep((f - 0.5) / 0.2))) * edge + 0.004

        v, f, tp = hair_shell(hs, boundary, thickness, 128, 22)
        self.add('haircap', (v, f), mm['hair'], 'head', tip=[0.2 + 0.4 * q for q in tp])
        # the core of the hair mass, hidden inside the curls
        self.add('haircore', ellipsoid(0.44, 0.33, 0.4, 28, 16, center=(0, 0.13, hc - 0.12)), mm['hair'], 'head',
                 tip=[0.2] * (28 * 15 + 2))
        self.curls()

    def curls(self):
        """The cloud of curls: jittered corkscrew curls on a big envelope round the head (sides and back, the
        face left clear), curls framing the cheeks, longer ringlets hanging at the bottom and a little curly
        fringe under the brim. Curls on the side of a raised arm part back behind it."""
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        Hm = self.J('head')
        Hi = Hm.inverted()
        E = HeadShape(0.54, 0.5, 0.5, center=(0, 0.05, hc - 0.03))
        raise_ = {'L': self.side_raise('L'), 'R': self.side_raise('R')}
        bk = (self.J('chest').to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
        colliders = []
        for s_ in ('L', 'R'):
            colliders.append((self.P('shoulder' + s_), self.P('elbow' + s_), 0.1))
            colliders.append((self.P('elbow' + s_), self.P('wrist' + s_), 0.09))
            wm = self.J('wrist' + s_)
            colliders.append((wm @ Vector((0.0, 0.0, -0.05)), wm @ Vector((0.0, 0.0, -0.1)), 0.1))
        acc = MeshAcc()

        def clear_arms(pos, rc):
            wpos = Hm @ pos
            for a_, b_, r in colliders:
                wpos = push_back(wpos, a_, b_, r + rc * 0.75, bk)
            return Hi @ wpos

        def corkscrew(pos, axis, outward, rc, turns, phase, length=2.3, shade=0.5, n=18):
            z = axis.normalized()
            u = outward - z * outward.dot(z)
            u = u.normalized() if u.length > 1e-5 else Vector((0.0, 1.0, 0.0))
            w = z.cross(u)
            L, hr = rc * length, rc * 0.5
            pts = []
            for q in range(n):
                t = q / (n - 1)
                an = phase + t * turns * math.tau
                pts.append(pos + z * (L * (t - 0.3)) + (u * math.cos(an) + w * math.sin(an)) * hr * (1.0 - 0.25 * t))
            vv, ff = sweep(pts, lambda t: rc * (0.64 - 0.24 * t), 9)
            tips = []
            for i, q in enumerate(vv):
                k = min(n - 1, i // 9)
                d = Vector(q) - pts[k]
                tips.append(clamp(shade + 0.32 * (d.normalized().dot(u) if d.length > 1e-6 else 0.0)))
            acc.add((vv, ff), tips)

        rows = [(27, 12, 0.09, 58, 302), (10, 13, 0.1, 50, 310), (-8, 14, 0.105, 48, 312), (-26, 14, 0.105, 52, 308),
                (-44, 13, 0.1, 60, 300), (-60, 11, 0.095, 76, 284), (-73, 8, 0.09, 100, 260)]
        for ri, (pitch0, count, rc0, y0, y1) in enumerate(rows):
            for k in range(count):
                j1, j2, j3, j4, j5 = (hash01(ri, k, q) for q in range(1, 6))
                yaw = y0 + (y1 - y0) * (k + 0.5 + 0.55 * (j1 - 0.5)) / count
                pitch = pitch0 + 9.0 * (j2 - 0.5)
                rc = rc0 * (0.82 + 0.36 * j3)
                side = 'L' if yaw < 180.0 else 'R'
                ay = yaw if yaw < 180.0 else 360.0 - yaw
                if pitch < 22.0:
                    shift = 34.0 * raise_[side] * sstep((130.0 - ay) / 70.0)
                    yaw = yaw + shift if yaw < 180.0 else yaw - shift
                pos, nrm = E.point(yaw, pitch, 0.02 * (j4 - 0.5))
                pa, pb = E.point(yaw, pitch - 4.0, 0.0)[0], E.point(yaw, pitch + 4.0, 0.0)[0]
                tdown = (pa - pb).normalized()
                tdown = (tdown + Vector((0.0, 0.0, -0.7)) * sstep((-pitch - 15.0) / 40.0)).normalized()
                # a random lean about the surface normal so the curls don't line up in rows
                tdown = (Matrix.Rotation(math.radians(50.0 * (j5 - 0.5)), 3, nrm) @ tdown).normalized()
                pos = clear_arms(pos, rc)
                corkscrew(pos, tdown, nrm, rc, 1.5 + 0.6 * j4, math.tau * j1, 2.3, 0.3 + 0.3 * j2)
        # curls framing the face, beside the cheeks
        F = HeadShape(0.47, 0.44, 0.44, center=(0, 0.0, hc - 0.02))
        for sd in (1, -1):
            s_ = 'L' if sd > 0 else 'R'
            for k, (yaw, pitch, rc) in enumerate(((53, 16, 0.07), (57, -8, 0.078), (58, -32, 0.078), (60, -54, 0.072))):
                pos, nrm = F.point((yaw + 26.0 * raise_[s_]) * sd, pitch, 0.0)
                pos = clear_arms(pos, rc)
                corkscrew(pos, Vector((0.0, 0.0, -1.0)), nrm, rc, 1.8, k * 1.7 + sd, 2.2, 0.45)
        # longer ringlets hanging from the bottom of the cloud
        for k in range(9):
            yaw = 112.0 + 136.0 * k / 8
            pos, nrm = E.point(yaw, -70.0 + 6.0 * hash01(k, 7), 0.0)
            pos = clear_arms(pos, 0.06)
            corkscrew(pos, Vector((0.0, 0.0, -1.0)), nrm, 0.07, 2.6, k * 2.1, 3.2, 0.45, 24)
        # a little curly fringe peeking out under the brim over the forehead
        for k, yaw in enumerate((-36, -19, -2, 16, 33)):
            pos, nrm = hs_point(hx, hy, hz, hc, yaw, 30.0 + 3.0 * abs(yaw) / 34, 0.03)
            corkscrew(pos, Vector((0.12 * (1 if yaw > 0 else -1), -0.2, -1.0)), nrm, 0.052, 1.4, k * 1.3, 2.0, 0.5, 14)
        self.add('curls', acc.mesh, mm['curls'], 'head', tip=acc.tip)

    # --- the pink cowboy hat ------------------------------------------------------------------------------
    def hat(self):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        yo, hh, tilt, roll = self.HAT
        ex = self.pose.get('extra', {})
        fly = clamp(ex.get('scarf', 0.0))
        hm = T(0.0, yo, hc + hh) @ R(tilt - 4.0 * fly, roll + 1.5 * ex.get('sway', 0.0), 0.0)
        # crown with a cattleman crease and pinched front
        prof = [(0.0, 0.262), (0.1, 0.258), (0.19, 0.248), (0.255, 0.225), (0.298, 0.18), (0.323, 0.11), (0.332, 0.04), (0.33, -0.035)]
        v, f = lathe(prof, 56)
        out = []
        for (x, y, z) in v:
            top = sstep((z - 0.1) / 0.14)
            z2 = z - 0.07 * math.exp(-(x / 0.075) ** 2) * top
            front = sstep((-y - 0.04) / 0.2) * sstep((z - 0.08) / 0.16)
            out.append((x * (1.0 - 0.2 * front), y, z2))
        self.add('hatcrown', (out, f), mm['hat'], 'head', hm)
        # brim: wide, curled up at the sides, dipping a little at the front
        r0, R_ = 0.3, 0.6
        N, M_ = 72, 7
        top, bot, rim = [], [], []
        for i in range(N):
            a = i / N * math.tau
            ca, sa = math.cos(a), math.sin(a)
            ct, cb = [], []
            for j in range(M_):
                u = j / (M_ - 1)
                r = r0 + (R_ - r0) * u
                z = 0.15 * abs(ca) ** 1.3 * u ** 1.9 - 0.028 * max(0.0, -sa) * u * u - 0.012 * max(0.0, sa) * u * u
                th = 0.013 * (1.0 - 0.4 * u)
                ct.append(Vector((ca * r, sa * r * 0.92, z + th)))
                cb.append(Vector((ca * r, sa * r * 0.92, z - th)))
            top.append(ct)
            bot.append(cb)
            rim.append((ct[-1] + cb[-1]) * 0.5)
        self.add('hatbrim', grid_shell(top, bot, closed=True), mm['hat'], 'head', hm)
        self.add('hatrim', ring_sweep(rim, 0.012, 8), mm['hat_d'], 'head', hm)
        # band with rhinestones
        self.add('hatband', torus(0.334, 0.028, 56, 8, center=(0, 0, 0.034), squash=1.25), mm['band'], 'head', hm)
        gems = MeshAcc()
        for k in range(18):
            a = k / 18 * math.tau
            p = Vector((math.cos(a) * 0.362, math.sin(a) * 0.362, 0.034))
            gems.add(ellipsoid(0.013, 0.009, 0.013, 10, 6), m=orient(p, Vector((math.cos(a), math.sin(a), 0.0))))
        self.add('hatgems', gems.mesh, mm['gem'], 'head', hm)

    # --- face (a copy of Hero.face with drag stage makeup: blue glitter lids, big glitter blush, bold
    #     lashes, high arched brows and red lips) -------------------------------------------------------------
    def face(self, head: HeadShape, joint: str, *, eye_yaw=27.0, eye_pitch=0.0, eye_size=(0.085, 0.105), iris='#6b3a1e',
             brow_col='#4a2c1a', mouth_pitch=-24.0, mouth_w=1.0, lid_col=None, nose=True, skin=None, blush=True, brow_pitch=19.0,
             lash_col='#2a1a14'):
        c = self.C
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        eyes, mouth, brows = f['eyes'], f['mouth'], f['brows']
        lx, lz = f.get('look', (0.0, 0.0))
        mt = self.m
        white = mt.glossy('eye_white', '#fbfbf8', 0.18, 0.8)
        dark = mt.glossy('eye_dark', '#1c1412', 0.25, 0.9)
        irm = mt.glossy(f'iris_{iris}', iris, 0.2, 0.9)
        irl = mt.glossy(f'iris_{c["iris_l"]}', c['iris_l'], 0.2, 0.9)
        shine = mt.emit('eye_shine', '#ffffff', 3.0)
        mouth_m = mt.glossy(f'mouth_{c["mouth"]}', c['mouth'], 0.4, 0.2)
        tongue = mt.glossy('tongue', '#e8797b', 0.35, 0.3)
        teeth = mt.glossy('teeth', '#fffdf6', 0.25, 0.4)
        lip = mt.glossy(f'lip_{c["lip"]}', c['lip'], 0.22, 0.7)
        lash = mt.glossy(f'lash_{lash_col}', lash_col, 0.4, 0.2)
        browm = mt.cloth(f'brow_{brow_col}', brow_col, 0.6, 0.2)
        shadow = glitter_mat(mt, 'chap_shadow', c['shadow'], '#ffffff', 0.88, 80.0, 0.9, 0.72)
        ew, eh = eye_size
        ed = ew * 0.34
        for side in (1, -1):
            yaw = eye_yaw * side
            fr = head.frame(yaw, eye_pitch, -ed * 0.55)
            name = 'L' if side > 0 else 'R'
            kind = eyes
            if eyes == 'wink':
                kind = 'open' if side > 0 else 'happy'
            # a bold wing of sparkly blue from the lash line up towards the brow, lifted at the outer corner
            shut = kind in ('happy', 'closed')
            sf = head.frame(yaw * 1.03, eye_pitch + (17.0 if shut else 12.0), 0.0025, -10 * side)
            self.feat(f'shadow{name}', ellipsoid(ew * (1.1 if shut else 1.26), 0.004, eh * (0.3 if shut else 0.52), 20, 8), shadow, joint, head, sf)
            if kind in ('open', 'wide', 'sad', 'determined', 'dizzy', 'half'):
                sc = 1.12 if kind == 'wide' else 1.0
                self.feat(f'sclera{name}', ellipsoid(ew * sc, ed, eh * sc, 22, 14), white, joint, head, fr)
                if kind == 'dizzy':
                    pts = []
                    for i in range(40):
                        a = i / 40 * math.tau * 2.2
                        r = 0.012 + (ew * 0.72 - 0.012) * i / 40
                        pts.append(Vector((math.cos(a) * r * side, -ed * 1.02, math.sin(a) * r * 1.15)))
                    self.feat(f'spiral{name}', sweep(pts, 0.0085, 6), dark, joint, head, fr)
                else:
                    ir = 0.84 * ew * (0.8 if kind == 'wide' else 1.0)
                    off = Vector((lx * ew * 0.22 - 0.1 * ew * side, -ed * 0.9, lz * eh * 0.2 - eh * 0.04))
                    self.feat(f'iris{name}', ellipsoid(ir, ed * 0.22, ir * 1.1, 20, 10, center=off), irm, joint, head, fr)
                    self.feat(f'irisl{name}', ellipsoid(ir * 0.72, ed * 0.2, ir * 0.5, 16, 8, center=off + Vector((0.0, -ed * 0.06, -ir * 0.48))), irl,
                              joint, head, fr)
                    pr = ir * 0.56
                    self.feat(f'pupil{name}', ellipsoid(pr, ed * 0.2, pr * 1.12, 16, 8, center=off + Vector((0.0, -ed * 0.12, 0.0))), dark, joint, head, fr)
                    h1 = off + Vector((-ir * 0.38, -ed * 0.3, ir * 0.42))
                    self.feat(f'shine{name}', ellipsoid(ir * 0.34, 0.004, ir * 0.36, 10, 6, center=h1), shine, joint, head, fr)
                    h2 = off + Vector((ir * 0.4, -ed * 0.3, -ir * 0.4))
                    self.feat(f'shine2{name}', ellipsoid(ir * 0.13, 0.004, ir * 0.13, 8, 5, center=h2), shine, joint, head, fr)
                lash_pts = [Vector((math.sin(a) * ew * 1.05, -ed * 0.55, math.cos(a) * eh * 1.03)) for a in [(-1 + 2 * i / 12) * 1.3 for i in range(13)]]
                self.feat(f'lash{name}', sweep(lash_pts, lambda t: 0.009 + 0.009 * math.sin(math.pi * t ** 0.8), 6), lash, joint, head, fr)
                # dramatic lashes: four flicking out and up at the outer corner
                for k, (a0, ln, up_) in enumerate(((0.62, 0.03, 0.95), (0.84, 0.04, 0.7), (1.05, 0.048, 0.42), (1.26, 0.044, 0.12))):
                    aa = a0 * side
                    p0 = Vector((math.sin(aa) * ew * 1.05, -ed * 0.6, math.cos(aa) * eh * 1.03))
                    dv = Vector((side * (1.0 - up_ * 0.5), -0.1, up_ + 0.35)).normalized()
                    fl = [p0 + dv * (ln * t) + Vector((0.0, 0.0, 0.008 * t * t)) for t in (0.0, 0.5, 1.0)]
                    self.feat(f'flick{k}{name}', sweep(fl, lambda t: 0.0075 * (1 - t) + 0.002, 6), lash, joint, head, fr)
                lid = {'sad': 0.42, 'determined': 0.36, 'half': 0.5}.get(kind)
                if lid and lid_col:
                    lidm = mt.skin(f'lid_{lid_col}', lid_col)
                    tilt = {'sad': -16 * side, 'determined': 14 * side}.get(kind, 0)
                    lid_mesh = ellipsoid(ew * 1.12, ed * 1.25, eh * 1.1, 20, 10, zmin=1 - lid * 2)
                    self.feat(f'lid{name}', lid_mesh, lidm, joint, head, fr @ R(0, tilt, 0) @ T(0, -0.004, 0))
            elif kind == 'happy':
                pts = arc_points(ew * 1.7, -eh * 0.42, 12, y=-0.01)
                self.feat(f'happy{name}', sweep([p + Vector((0, 0, -eh * 0.15)) for p in pts], 0.013, 8), lash, joint, head, fr)
                tipp = pts[-1 if side > 0 else 0] + Vector((0, 0, -eh * 0.15))
                for k, dv in enumerate((Vector((side * 0.026, -0.004, 0.02)), Vector((side * 0.032, -0.004, 0.004)))):
                    self.feat(f'hflick{k}{name}', sweep([tipp, tipp + dv], lambda t: 0.009 * (1 - t) + 0.002, 6), lash, joint, head, fr)
            elif kind == 'closed':
                pts = arc_points(ew * 1.6, eh * 0.22, 12, y=-0.01)
                self.feat(f'closed{name}', sweep(pts, 0.012, 8), lash, joint, head, fr)
                tipp = pts[-1 if side > 0 else 0]
                self.feat(f'cflick{name}', sweep([tipp, tipp + Vector((side * 0.028, -0.004, -0.012))], lambda t: 0.009 * (1 - t) + 0.002, 6), lash,
                          joint, head, fr)
            # high, thin, arched brows
            b_pitch = eye_pitch + brow_pitch + (4 if brows == 'up' else 0) + (2 if eyes == 'wide' else 0)
            roll = {'neutral': 0, 'up': -4, 'worried': 16, 'angry': -18, 'determined': -12, 'sad': 14}.get(brows, 0) * side
            bf = head.frame(yaw * 1.03, b_pitch, 0.004, roll)
            bpts = arc_points(ew * 1.55, -0.03, 10)
            self.feat(f'brow{name}', sweep(bpts, lambda t: 0.007 + 0.006 * math.sin(math.pi * t ** 0.7), 8), browm, joint, head, bf)
        skin_m = mt.skin(f'skin_{skin}', skin) if skin else None
        if nose and skin_m:
            nf = head.frame(0, eye_pitch - 13, -0.004)
            self.feat('nose', ellipsoid(0.025, 0.022, 0.019, 14, 8), skin_m, joint, head, nf)
        if blush:
            bl = glitter_mat(mt, 'chap_blush', c['blush'], '#fff7fb', 0.55, 95.0, 0.8, 0.68)
            for side in (1, -1):
                bf = head.frame(side * (eye_yaw + 12), eye_pitch - 19, 0.003)
                self.feat('blush', ellipsoid(0.07, 0.004, 0.05, 18, 8), bl, joint, head, bf)
        mf = head.frame(0, mouth_pitch, 0.0)
        w = 0.12 * mouth_w

        def lip_loop(ww, hh, top_curve=0.0):
            """A red lipstick rim round a D-shaped open mouth (flat top, round bottom)."""
            pts = []
            for i in range(18):
                a = math.pi + math.pi * i / 17
                pts.append(Vector((math.cos(a) * ww / 2 * 1.04, -0.012, math.sin(a) * hh * 1.04)))
            for i in range(1, 8):
                x = ww / 2 * 1.04 * (1 - 2 * i / 8)
                pts.append(Vector((x, -0.012, 0.008 + top_curve * (1 - (2 * x / ww) ** 2))))
            return ring_sweep(pts, 0.0095, 6)

        if mouth == 'smile':
            # a confident closed smile in bold red lipstick
            lw = 0.12
            low = arc_points(lw, 0.03, 14, y=-0.008)
            self.feat('lowerlip', sweep([p + Vector((0, 0, -0.008)) for p in low], lambda t: 0.006 + 0.012 * math.sin(math.pi * t), 8), lip, joint,
                      head, mf)
            upp = [Vector((p.x, p.y, p.z + 0.012 - 0.008 * math.exp(-(p.x / 0.012) ** 2))) for p in arc_points(lw * 0.96, 0.026, 14, y=-0.008)]
            self.feat('upperlip', sweep(upp, lambda t: 0.005 + 0.008 * math.sin(math.pi * t), 8), lip, joint, head, mf)
            line = arc_points(lw * 0.98, 0.028, 14, y=-0.012)
            self.feat('mouth', sweep([p + Vector((0, 0, 0.002)) for p in line], lambda t: 0.002 + 0.0022 * math.sin(math.pi * t), 6), mouth_m,
                      joint, head, mf)
        elif mouth in ('grin', 'open', 'laugh'):
            hh = {'grin': 0.05, 'open': 0.06, 'laugh': 0.074}[mouth]
            ww = w * (1.08 if mouth == 'grin' else 1.0)
            self.feat('mouth', ellipsoid(ww / 2, 0.02, hh, 22, 12, zmax=0.15), mouth_m, joint, head, mf @ T(0, 0.002, 0.006))
            self.feat('tongue', ellipsoid(ww * 0.3, 0.012, hh * 0.45, 14, 8, center=(0, -0.008, -hh * 0.6)), tongue, joint, head, mf)
            if mouth != 'laugh':
                self.feat('teeth', ellipsoid(ww * 0.42, 0.01, 0.012, 14, 6, center=(0, -0.012, 0.0)), teeth, joint, head, mf)
            self.feat('lips', lip_loop(ww, hh), lip, joint, head, mf @ T(0, 0.0, 0.006))
        elif mouth in ('o', 'gasp'):
            rx_, rz_, dz = (0.028, 0.034, -0.004) if mouth == 'o' else (0.04, 0.054, -0.012)
            self.feat('mouth', ellipsoid(rx_, 0.018, rz_, 16, 10), mouth_m, joint, head, mf @ T(0, 0.004, dz))
            if mouth == 'gasp':
                self.feat('tongue', ellipsoid(0.02, 0.01, 0.018, 12, 6, center=(0, -0.012, -0.045)), tongue, joint, head, mf)
            ring = [Vector((math.cos(a) * rx_ * 1.12, -0.014, math.sin(a) * rz_ * 1.1 + dz)) for a in [i / 20 * math.tau for i in range(20)]]
            self.feat('lips', ring_sweep(ring, 0.009, 6), lip, joint, head, mf)
        elif mouth == 'frown':
            self.feat('mouth', sweep(arc_points(w * 0.8, -0.022, 12, y=-0.006), lambda t: 0.006 + 0.007 * math.sin(math.pi * t), 8), lip, joint, head,
                      mf @ T(0, 0, -0.012))
        elif mouth == 'flat':
            self.feat('mouth', sweep([Vector((-w * 0.3, -0.006, 0)), Vector((0.0, -0.008, -0.002)), Vector((w * 0.3, -0.006, 0))],
                                     lambda t: 0.006 + 0.006 * math.sin(math.pi * t), 8), lip, joint, head, mf)
        elif mouth == 'wobble':
            pts = [Vector(((i / 12 - 0.5) * w * 0.85, -0.006, math.sin(i / 12 * math.tau * 1.5) * 0.011)) for i in range(13)]
            self.feat('mouth', sweep(pts, lambda t: 0.006 + 0.005 * math.sin(math.pi * t), 8), lip, joint, head, mf)
        elif mouth == 'smirk':
            pts = [Vector(((i / 12 - 0.5) * w * 0.8, -0.006, 0.02 * (i / 12) ** 2)) for i in range(13)]
            self.feat('mouth', sweep(pts, lambda t: 0.006 + 0.006 * math.sin(math.pi * t), 8), lip, joint, head, mf)


def hs_point(hx, hy, hz, hc, yaw, pitch, lift):
    """A point (and normal) on the hair cap's surface."""
    return HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012)).point(yaw, pitch, lift)
