"""Sabrina: a fan-made chibi caricature of pop singer Sabrina Carpenter for the private, non-commercial
party build (loaded by characters.py as class `Sabrina`).

An affectionate, all-ages collectible-figure take in the game's chibi style (Kip's structure, a little
more petite): long, voluminous, softly waved platinum-blonde hair with full curtain bangs parted in the
middle, big blue eyes with lashes, rosy cheeks and a bright open smile; a sparkly baby-pink babydoll dress
(sweetheart neckline, puff sleeves, an empire waist with a satin bow and a flared skirt to mid-thigh with
a lace hem), white tights and pink platform boots.

Secondary motion uses the shared pose extras: 'scarf' (0 still .. 1 streaming) and 'wave' (phase) blow
the hair and the skirt back. The long hair hangs with gravity and is pushed clear of the body and arms;
the skirt rides up over the thighs when the legs lift, so it never cuts through them.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import (HeadShape, R, S, T, arc_points, curve3, ellipsoid, flat_sweep, polyline_segment, rmf_frames, superellipsoid, sweep,
                      torus)
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


def sequin_mat(mats, name: str, base: str, dark: str, sparkle: str, scale: float = 58.0, glint: float = 1.0):
    """Cloth covered in tiny sequins: a Voronoi cell per sequin, some of them tilted to catch the light
    (metallic, glossy, a faint glow), over a softly mottled base."""
    def make(n):
        m = lib.NT(n)
        obj = m.node('ShaderNodeTexCoord').outputs['Object']
        vor = m.voronoi(scale, obj)
        d = vor.outputs['Distance']
        rnd = m.sep(vor.outputs['Color'])[0]
        disc_ = m.maprange(d, 0.38, 0.28)
        pick = m.maprange(rnd, 0.52, 0.56)
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


# ------------------------------------------------------------------------------------------
class Sabrina(Hero):
    """Sabrina: platinum waves with curtain bangs, sparkly baby-pink babydoll dress, white tights, pink platforms."""

    key = 'sabrina'
    ankle_h = 0.19  # platform soles
    hip_h = 0.65  # ankle_h + 0.04 + thigh + shin
    spine = 0.075
    chest = 0.18
    neck = 0.13
    head_up = 0.04
    shoulder = (0.2, 0.0, 0.105)
    upper_arm = 0.2
    forearm = 0.18
    hip_w = 0.1
    thigh = 0.205
    shin = 0.215
    sit_h = 0.17

    C = dict(skin='#fad5bb', skin_d='#efae90', nose='#f4bb9e', dress='#f9b8d2', dress_d='#e993b8', sparkle='#fff3fa', trim='#fff4f8',
             ribbon='#f07aa9', ribbon_d='#d85d8f', bloomer='#f6aecb', tights='#fbf4f2', boot='#f69cc1', boot_d='#e2799f', sole='#fff0f6',
             iris='#4b93e2', iris_l='#9bd0ff', brow='#b58d5c', lash='#2b1a17', lip='#e2607e', mouth='#8c2c44', shadow='#f7a9c4',
             blush='#ff8ea2')
    HAIR = [(0.0, '#cdb282'), (0.18, '#e2cfa3'), (0.45, '#f1e6cb'), (0.75, '#faf3e2'), (1.0, '#fffcf4')]

    HEAD = (0.4, 0.37, 0.385, 0.41)  # rx, ry, rz, centre height above the head joint
    EYE = (24.0, -7.0)

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.2

    # --- shared bits ----------------------------------------------------------------------------
    def back_dir(self) -> Vector:
        """Horizontal direction behind the character (the way hair and skirt stream when she moves)."""
        yaw = math.radians(self.pose.get('root', {}).get('yaw', 0.0))
        return Vector((-math.sin(yaw), math.cos(yaw), 0.0))

    def side_raise(self, s_: str) -> float:
        """0..1: how far an arm is lifted up at the side (the long hair parts behind it)."""
        ra, sw, _tw, _el = self.pose['arm' + s_]
        return sstep((ra - 65.0) / 55.0) * sstep((55.0 - sw) / 45.0)

    @staticmethod
    def rb(z: float) -> float:
        """Torso half-width at chest-frame height z (depth is 0.8 of it)."""
        t = clamp((z + 0.35) / 0.47)
        return 0.196 - 0.028 * t + 0.01 * math.sin(math.pi * t)

    # --- building -------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('sab_skin', c['skin']),
            skin_d=mt.skin('sab_skin_d', c['skin_d']),
            dress=sequin_mat(mt, 'sab_dress', c['dress'], c['dress_d'], c['sparkle'], 58.0, 1.0),
            puff=sequin_mat(mt, 'sab_puff', c['dress'], c['dress_d'], c['sparkle'], 70.0, 0.8),
            trim=mt.cloth('sab_trim', c['trim'], 0.7, 0.5, 0.12, 90),
            ribbon=mt.glossy('sab_ribbon', c['ribbon'], 0.3, 0.45),
            ribbon_d=mt.glossy('sab_ribbon_d', c['ribbon_d'], 0.35, 0.4),
            bloomer=mt.cloth('sab_bloomer', c['bloomer'], 0.7, 0.4),
            tights=mt.cloth('sab_tights', c['tights'], 0.55, 0.6),
            boot=mt.glossy('sab_boot', c['boot'], 0.3, 0.55),
            boot_d=mt.glossy('sab_boot_d', c['boot_d'], 0.32, 0.5),
            sole=mt.glossy('sab_sole', c['sole'], 0.35, 0.4),
            hair=ramp_mat(mt, 'sab_hair', self.HAIR, 0.4, 0.3, 0.3, 0.45),
        )
        self.torso()
        self.skirt()
        self.legs()
        self.arms()
        self.head_parts()

    # --- torso: skin shoulders, the sequinned bodice, ribbon and bow -----------------------------------
    def torso(self):
        mm, rb = self.mat, self.rb
        self.add('body', sweep([Vector((0, 0, -0.34 + 0.46 * i / 10)) for i in range(11)], lambda t: rb(-0.34 + 0.46 * t) - 0.012, 24,
                               cap0=False, squash=0.8), mm['skin'], 'chest')
        r_top = rb(0.12) - 0.014
        self.add('shoulders', ellipsoid(r_top, r_top * 0.8, 0.078, 26, 12, center=(0, 0, 0.1), zmin=-0.2), mm['skin'], 'chest')
        a = self.J('chest') @ Vector((0.0, 0.0, 0.1))
        b = self.J('neck') @ Vector((0.0, 0.0, 0.03))
        cc = self.J('head') @ Vector((0.0, 0.01, 0.12))
        self.add('neck', sweep(curve3(a, b, cc, 6), 0.058, 14), mm['skin'])
        self.add('pelvis', superellipsoid(0.185, 0.155, 0.14, 2.4, 28, 16, center=(0, 0, -0.03)), mm['bloomer'], 'hips')

        # bodice: from under the skirt's top up to a sweetheart neckline (dips at the centre, rises over two
        # soft curves, a little higher round the sides and back)
        def z_top(phi_deg):
            df = abs(((phi_deg + 90.0 + 180.0) % 360.0) - 180.0)  # degrees from the front centre
            if df < 24.0:
                return 0.022 + 0.048 * math.sin(math.pi / 2 * df / 24.0)
            return 0.07 - 0.012 * sstep((df - 24.0) / 30.0) + 0.02 * sstep((df - 70.0) / 60.0)

        N, M_ = 56, 7
        zb = -0.175
        outer, inner, top = [], [], []
        for i in range(N):
            ph = -90.0 + 360.0 * i / N
            pr = math.radians(ph)
            zt = z_top(ph)
            co, ci = [], []
            for j in range(M_):
                z = zt + (zb - zt) * j / (M_ - 1)
                r = rb(z) + 0.004
                co.append(Vector((math.cos(pr) * r, math.sin(pr) * r * 0.8, z)))
                ci.append(Vector((math.cos(pr) * (r - 0.014), math.sin(pr) * (r - 0.014) * 0.8, z)))
            outer.append(co)
            inner.append(ci)
            top.append(co[0] + Vector((math.cos(pr) * 0.002, math.sin(pr) * 0.002, 0.0)))
        self.add('bodice', grid_shell(outer, inner, closed=True), mm['dress'], 'chest')
        self.add('neckline', ring_sweep(top, 0.011, 8), mm['trim'], 'chest')
        # satin ribbon round the empire waist, and a bow at the front
        zr = -0.14
        rr = rb(zr) + 0.02
        self.add('ribbon', torus(rr, 0.017, 44, 8, center=(0, 0, zr), squash=1.25), mm['ribbon'], 'chest', S(1.0, 0.8, 1.0))
        bm = T(0.0, -rr * 0.8 - 0.014, zr)
        for sd in (1, -1):
            self.add('bowloop', ellipsoid(0.046, 0.018, 0.03, 16, 10, center=(0.036 * sd, 0.0, 0.006)), mm['ribbon'], 'chest', bm @ R(0, -16 * sd, 0))
            tail = [Vector((0.008 * sd, -0.004, -0.01)), Vector((0.024 * sd, -0.01, -0.045)), Vector((0.032 * sd, -0.012, -0.075))]
            self.add('bowtail', flat_sweep(tail, lambda t: 0.017 - 0.004 * t, Vector((0.0, -1.0, 0.0)), 0.35, 10), mm['ribbon_d'], 'chest', bm)
        self.add('bowknot', ellipsoid(0.018, 0.02, 0.02, 12, 8, center=(0.0, -0.012, 0.004)), mm['ribbon_d'], 'chest', bm)

    # --- the flared babydoll skirt ---------------------------------------------------------------------
    def skirt(self):
        mm = self.mat
        ex = self.pose.get('extra', {})
        fly = clamp(ex.get('scarf', 0.0))
        wave = ex.get('wave', 0.0)
        Ch, Hp = self.J('chest'), self.J('hips')
        H3 = Hp.to_3x3()
        back = self.back_dir()
        ztop = -0.14
        rt = self.rb(ztop) + 0.018
        Ln = 0.3
        alpha = 27.0
        N, M_ = 64, 9
        caps = []
        for s_ in ('L', 'R'):
            hp, kn, an = self.P('hip' + s_), self.P('knee' + s_), self.P('ankle' + s_)
            caps.append((hp, kn, 0.13))
            caps.append((kn, kn.lerp(an, 0.4), 0.11))

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
            p0 = Ch @ Vector((rt * math.cos(ph), rt * 0.82 * math.sin(ph), ztop))
            psi = alpha
            while psi < 160.0:
                ps = math.radians(psi)
                d = H3 @ Vector((math.sin(ps) * math.cos(ph), math.sin(ps) * math.sin(ph), -math.cos(ps)))
                if clear(p0, d):
                    break
                psi += 3.0
            tops.append(p0)
            psis.append(psi)
        # spread the lift smoothly round the hem (a lifted panel drags its neighbours up with it)
        sm = []
        for i in range(N):
            best = psis[i]
            for j in range(N):
                dd = min(abs(i - j), N - abs(i - j)) * 360.0 / N
                best = max(best, psis[j] - 1.15 * dd)
            sm.append(best)
        psis = [max(sm[i], (sm[i - 1] + 2 * sm[i] + sm[(i + 1) % N]) / 4) for i in range(N)]

        outer, inner, hem = [], [], []
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
                fold = 0.017 * s ** 1.4 * math.sin(ph * 9.0 + 0.6)
                p += o * (0.04 * s * s + fold + 0.012 * s * s * math.sin(wave * 1.3 + ph * 3.0) * (0.3 + fly))
                p += back * (fly * 0.1 * s * s * (0.35 + 0.65 * behind))
                if p.z < 0.014:
                    dz = 0.014 - p.z
                    p.z = 0.014
                    p += hout * (dz * 0.9)
                co.append(p)
                ci.append(p - o * 0.013)
            outer.append(co)
            inner.append(ci)
            hem.append(co[-1] + o * 0.004 - d * 0.002)
        Hi = Hp.inverted()
        outer = [[Hi @ p for p in colm] for colm in outer]
        inner = [[Hi @ p for p in colm] for colm in inner]
        self.add('skirt', grid_shell(outer, inner, closed=True), mm['dress'], 'hips')
        self.add('hem', ring_sweep([Hi @ p for p in hem], 0.014, 8), mm['trim'], 'hips')
        self.skirt_state = (tops, psis, Ln)

    def skirt_push(self, p: Vector) -> Vector:
        """Keep a point (a lock of hair) outside the skirt's resting cone."""
        Hp = self.J('hips')
        q = Hp.inverted() @ p
        zt = -0.04 + 0.2  # roughly the skirt's top in the hips frame
        h = zt - q.z
        if h < -0.02 or h > 0.34:
            return p
        rad = self.rb(-0.14) + 0.03 + max(0.0, h) * math.tan(math.radians(29.0))
        rq = math.hypot(q.x, q.y / 0.9)
        if rq < rad and rq > 1e-6:
            k = rad / rq
            q = Vector((q.x * k, q.y * k, q.z))
            return Hp @ q
        return p

    # --- legs: white tights and pink platform boots -------------------------------------------------------
    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('tights' + s_, hip, kn, an, lambda t: 0.086 - 0.022 * t + 0.008 * math.sin(math.pi * clamp((t - 0.45) / 0.4)), mm['tights'],
                      0.0, 0.93, 14, 16)
            self.limb('shaft' + s_, hip, kn, an, lambda t: 0.07 + 0.012 * sstep((0.25 - t) / 0.25), mm['boot'], 0.69, 1.0, 16, 8)
            self.limb('bootrim' + s_, hip, kn, an, 0.083, mm['boot_d'], 0.685, 0.715, 16, 2)
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('boot' + s_, superellipsoid(0.1, 0.15, 0.085, 2.6, 22, 14, center=(0, -0.04, -0.06)), mm['boot'], None, fm)
            self.add('toe' + s_, ellipsoid(0.094, 0.082, 0.064, 18, 10, center=(0, -0.125, -0.085)), mm['boot'], None, fm)
            self.add('platform' + s_, superellipsoid(0.11, 0.172, 0.042, 3.2, 24, 10, center=(0, -0.05, -0.148)), mm['sole'], None, fm)
            self.add('heel' + s_, superellipsoid(0.07, 0.05, 0.03, 3.0, 16, 8, center=(0, 0.075, -0.16)), mm['sole'], None, fm)
            strap = [Vector((-0.098, -0.07, -0.05)), Vector((0.0, -0.13, -0.012)), Vector((0.098, -0.07, -0.05))]
            self.add('strap' + s_, sweep(catmull(strap, 5), 0.014, 8, squash=0.6), mm['boot_d'], None, fm)

    # --- arms: puff sleeves and bare arms -------------------------------------------------------------------
    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.05 - 0.008 * t + 0.004 * math.sin(math.pi * t), mm['skin'], 0.08, 1.0, 12, 14,
                      extend=0.02)
            smx = self.J(sh)
            pts = [Vector((0.0, 0.0, 0.035 - 0.185 * k / 10)) for k in range(11)]

            def pr(t, a):
                base = 0.05 + 0.08 * math.sin(math.pi * clamp(t) ** 0.8)
                return base * (1.0 + 0.07 * math.cos(9 * a) * (0.35 + 0.65 * abs(1 - 2 * t)))
            self.add('puff' + s_, tube(pts, pr, 36, 4), mm['puff'], None, smx)
            self.add('puffband' + s_, torus(0.056, 0.013, 20, 8, center=(0, 0, -0.142)), mm['trim'], None, smx)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.14):
                self.add('hand' + nm + s_, mesh, mm['skin'], None, wm)

    # --- head -------------------------------------------------------------------------------------------------
    def head_parts(self):
        c, mm = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        hv = [(x * (1 - 0.11 * max(0.0, (hc - z) / hz) ** 1.6), y - 0.02 * max(0.0, (hc - z) / hz) ** 2, z) for (x, y, z) in hv]
        self.add('head', (hv, hf), mm['skin'], 'head')
        ey, ep = self.EYE
        self.face(head, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(0.098, 0.128), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-31,
                  lid_col=c['skin'], skin=c['nose'], brow_pitch=21, lash_col=c['lash'])
        self.hair()

    # --- hair -------------------------------------------------------------------------------------------------
    def hair(self):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))

        # the cap over the scalp: a bouncy, voluminous crown with a centre parting at the front
        def boundary(yaw):
            return periodic_interp([(0, 46), (28, 43), (52, 30), (72, 12), (100, 2), (140, -3), (180, -5)], abs(yaw))

        def thickness(yaw, pitch, f):
            edge = min(1.0, f / 0.16)
            vol = 0.018 + 0.058 * math.sin(math.pi * min(1.0, f * 1.02)) * edge
            part = 1.0 - 0.72 * math.exp(-(yaw / 5.5) ** 2) * sstep((pitch - 40.0) / 8.0) * (1.0 - sstep((pitch - 78.0) / 8.0))
            ridge = (0.5 + 0.5 * math.cos(math.radians(yaw) * 17.0 + 0.4)) ** 2
            return (vol + 0.013 * ridge * edge) * part

        v, f, tp = hair_shell(hs, boundary, thickness, 144, 24)
        self.add('haircap', (v, f), mm['hair'], 'head', tip=[0.2 + 0.45 * q for q in tp])
        self.crown_locks()
        self.curtain_bangs()
        self.long_hair()

    def crown_locks(self):
        """A few soft locks combed back from the parting and over the crown, so the top reads as hair."""
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        acc = MeshAcc()
        hs2 = HeadShape(hx + 0.07, hy + 0.07, hz + 0.075, center=(0, 0.01, hc + 0.012))

        def lock(yaw, pitch, length, r0, flow, flick=0.0, flat=0.36):
            pos, n = hs2.point(yaw, pitch, -0.02)
            fl = Vector(flow).normalized()
            fl = (fl - n * fl.dot(n)).normalized()
            pts = []
            for k in range(10):
                t = k / 9
                q = pos + fl * (length * t)
                sp, sn = hs2.surface(q - hs2.c)  # keep the lock lying on the crown as it flows
                pts.append(sp + sn * (-0.02 + length * flick * t * t))
            vv = flat_sweep(pts, lambda t: r0 * (1 - 0.8 * t ** 1.3), n, flat, 12)
            acc.add(vv, flat_tip(10, 12, len(vv[0]), 0.25, 0.75))

        for sd in (1, -1):
            lock(7 * sd, 70, 0.3, 0.085, (sd * 1.0, 0.5, -0.35))
            lock(12 * sd, 82, 0.34, 0.09, (sd * 0.8, 1.0, -0.3))
            lock(40 * sd, 62, 0.3, 0.085, (sd * 0.6, 1.0, -0.7))
            lock(70 * sd, 50, 0.26, 0.08, (sd * 0.3, 1.0, -0.9))
        lock(180, 80, 0.3, 0.09, (0.0, 1.0, -0.8))
        self.add('crownlocks', acc.mesh, mm['hair'], 'head', tip=acc.tip)

    def curtain_bangs(self):
        """Full curtain bangs: from the centre parting they sweep down and out over the forehead in an arch
        to the cheekbones, with longer face-framing layers behind them."""
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        hb = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))
        acc = MeshAcc()

        def bang(ctrl, w, lift0, lift1, t0, sd, flick=0.0):
            path = catmull([Vector((y * sd, p_, 0.0)) for y, p_ in ctrl], 6)
            path = polyline_segment(path, 0.0, 1.0, 16)
            pts, nrm = [], []
            n = len(path)
            for i, q in enumerate(path):
                t = i / (n - 1)
                pos, nn = hb.point(q.x, q.y, lift0 + (lift1 - lift0) * t + flick * sstep((t - 0.7) / 0.3))
                pts.append(pos)
                nrm.append(nn)

            def width(t):
                return w * (0.5 + 0.5 * math.sin(math.pi / 2 * min(1.0, t * 2.2))) * (1.0 - 0.8 * sstep((t - 0.55) / 0.45)) + 0.004
            mesh = flat_sweep(pts, width, lambda t: nrm[min(n - 1, int(round(t * (n - 1))))], 0.48, 14)
            acc.add(mesh, flat_tip(n, 14, len(mesh[0]), t0, 1.0))

        for sd in (1, -1):
            # a raised arm lifts the longer layers by the cheek, so they don't hide it
            up_ = self.side_raise('L' if sd > 0 else 'R')
            e1, e2 = -48.0 + 36.0 * up_, -24.0 + 12.0 * up_
            # longer face-framing layers first (behind), then the bangs over them
            bang([(46, 60), (62, 36), (72, 8), (77, (e1 - 8) * 0.5 + 4 * up_), (78, e1)], 0.09, 0.04, 0.05, 0.35, sd, 0.02)
            bang([(8, 80), (22, 64), (40, 44), (56, 20), (66, (e2 + 16) * 0.5 - 12), (70, e2)], 0.105, 0.06, 0.045, 0.3, sd, 0.018)
            bang([(2, 70), (10, 57), (24, 40), (41, 23), (55, 4), (62, -15)], 0.1, 0.068, 0.046, 0.25, sd, 0.024)
        self.add('bangs', acc.mesh, mm['hair'], 'head', tip=acc.tip)

    def long_hair(self):
        """The long, softly waved curtain of hair down her back: a thick sheet from under the cap to the
        waist. Its upper part moves with the head, the rest hangs with gravity, streams back when she runs,
        and is pushed clear of the body, arms and skirt."""
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))
        ex = self.pose.get('extra', {})
        fly = clamp(ex.get('scarf', 0.0))
        wave = ex.get('wave', 0.0)
        sway = ex.get('sway', 0.0)
        C, Rn = 38, 18
        nl = 4.5  # locks per half of the sheet
        lift = {'L': self.side_raise('L'), 'R': self.side_raise('R')}
        base_cols, lens = [], []
        for i in range(C):
            v = 1.0 - 2.0 * i / (C - 1)  # +1 at the left front edge .. -1 at the right front edge
            up_ = lift['L'] if v >= 0 else lift['R']
            edge = 70.0 + 56.0 * up_  # yaw of the sheet's front edge: it parts back behind a raised arm
            yaw = 180.0 - v * (180.0 - edge)
            ya = math.radians(yaw)
            a = Vector((math.sin(ya), -math.cos(ya), 0.0))
            re = 1.0 / math.sqrt((a.x / hx) ** 2 + (a.y / hy) ** 2)
            th = math.radians(v * (84.0 - 34.0 * up_))
            vol = 0.085 - 0.03 * up_ * abs(v)
            k0 = hs.point(yaw, 34.0, 0.012)[0]
            k1 = hs.point(yaw, -2.0, vol)[0]
            k2 = Vector((a.x * (re + vol - 0.01) * 0.97, a.y * (re + vol - 0.01) + 0.02, hc - 0.3))
            k3 = Vector((0.41 * math.sin(th), 0.01 + 0.25 * math.cos(th), hc - 0.53))
            k4 = Vector((0.47 * math.sin(th), 0.03 + 0.27 * math.cos(th), hc - 0.83))
            dense = catmull([k0, k1, k2, k3, k4], 8)
            tri = abs(((v * nl + 0.5) % 1.0) - 0.5) * 2.0
            lf = 1.0 - 0.1 * tri ** 1.3 - 0.1 * abs(v) ** 3
            base_cols.append(polyline_segment(dense, 0.0, lf, Rn - 1))
            lens.append(tri)
        # outward normals from the grid
        outer, inner, tips = [], [], []
        for i in range(C):
            v = 1.0 - 2.0 * i / (C - 1)
            co, ci = [], []
            for j in range(Rn):
                u = j / (Rn - 1)
                p = base_cols[i][j]
                du = base_cols[i][min(Rn - 1, j + 1)] - base_cols[i][max(0, j - 1)]
                dv = base_cols[min(C - 1, i + 1)][j] - base_cols[max(0, i - 1)][j]
                n = du.cross(dv)
                if n.length < 1e-8:
                    n = Vector((p.x, p.y, 0.0))
                n.normalize()
                if n.dot(Vector((p.x, p.y - 0.02, (p.z - hc) * 0.3))) < 0:
                    n = -n
                groove = -0.016 * lens[i] ** 2 * sstep((u - 0.1) / 0.2)
                wv = 0.02 * sstep((u - 0.3) / 0.35) * math.sin(math.tau * u * 2.1 + v * 1.9 + 0.4)
                q = p + n * (groove + wv)
                co.append(q)
                ci.append(q - n * (0.05 * (1 - u) + 0.022))
            outer.append(co)
            inner.append(ci)
            tips.append([0.12 + 0.88 * (j / (Rn - 1)) for j in range(Rn)])
        # to world: the top follows the head, the rest hangs upright
        Hm = self.J('head')
        fwd = Hm.to_3x3() @ Vector((0.0, -1.0, 0.0))
        fwd.z = 0.0
        fwd = fwd.normalized() if fwd.length > 1e-4 else Vector((0.0, -1.0, 0.0))
        up = Vector((0.0, 0.0, 1.0))
        G = Matrix((up.cross(fwd), -fwd, up)).transposed().to_4x4()
        G.translation = Hm.to_translation()
        back = self.back_dir()
        side = back.cross(up)
        Ch = self.J('chest')
        Chi = Ch.inverted()
        colliders = []
        for s_ in ('L', 'R'):
            smx = self.J('shoulder' + s_)
            colliders.append((smx @ Vector((0.0, 0.0, 0.0)), smx @ Vector((0.0, 0.0, -0.12)), 0.15))
            colliders.append((self.P('shoulder' + s_), self.P('elbow' + s_), 0.085))
            colliders.append((self.P('elbow' + s_), self.P('wrist' + s_), 0.075))
            wm = self.J('wrist' + s_)
            colliders.append((wm @ Vector((0.0, 0.0, -0.06)), wm @ Vector((0.0, 0.0, -0.1)), 0.1))

        def place(q, u, vv):
            w = 0.72 * sstep((u - 0.08) / 0.6)
            p = (Hm @ q).lerp(G @ q, w)
            p += back * (fly * 0.3 * u ** 1.6) + up * (fly * 0.07 * u * u)
            p += side * ((0.022 * math.sin(wave + u * 3.4 + vv * 2.2) * (0.35 + fly) + 0.03 * sway) * u)
            return p

        W_out = [[place(outer[i][j], j / (Rn - 1), 1.0 - 2.0 * i / (C - 1)) for j in range(Rn)] for i in range(C)]
        W_in = [[place(inner[i][j], j / (Rn - 1), 1.0 - 2.0 * i / (C - 1)) for j in range(Rn)] for i in range(C)]

        bk = (Ch.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()

        def solve_push(p):
            q = push_ellipsoid(p, Ch, Chi, Vector((0.0, 0.0, -0.1)), Vector((0.235, 0.205, 0.3)))
            for a, b, r in colliders:
                q = push_back(q, a, b, r, bk)
            q = self.skirt_push(q)
            if q.z < 0.02:
                q.z = 0.02
            return q

        for _it in range(2):
            for i in range(C):
                for j in range(2, Rn):
                    p = W_in[i][j]
                    q = solve_push(p)
                    dlt = q - p
                    if dlt.length_squared > 0.0:
                        W_in[i][j] = q
                        W_out[i][j] = W_out[i][j] + dlt
            # relax the pushed sheet a little so dents spread out instead of kinking
            for g in (W_in, W_out):
                for i in range(C):
                    colm = g[i]
                    sm = [colm[0], colm[1]] + [colm[j] * 0.5 + (colm[j - 1] + colm[j + 1]) * 0.25 for j in range(2, Rn - 1)] + [colm[-1]]
                    g[i] = sm
        Hi = Hm.inverted()
        W_out = [[Hi @ p for p in colm] for colm in W_out]
        W_in = [[Hi @ p for p in colm] for colm in W_in]
        verts, faces = grid_shell(W_out, W_in, closed=False)
        tip = [t for colm in tips for t in colm] * 2
        self.add('longhair', (verts, faces), mm['hair'], 'head', tip=tip)

    # --- face (a copy of Hero.face with her lashes, a soft pink lid, a lighter lower iris and an open smile) ---
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
        lip = mt.glossy(f'lip_{c["lip"]}', c['lip'], 0.35, 0.4)
        lash = mt.glossy(f'lash_{lash_col}', lash_col, 0.4, 0.2)
        browm = mt.cloth(f'brow_{brow_col}', brow_col, 0.6, 0.2)
        shadow = mt.alpha('sab_shadow', c['shadow'], 0.34)
        ew, eh = eye_size
        ed = ew * 0.34
        for side in (1, -1):
            yaw = eye_yaw * side
            fr = head.frame(yaw, eye_pitch, -ed * 0.55)
            name = 'L' if side > 0 else 'R'
            kind = eyes
            if eyes == 'wink':
                kind = 'open' if side > 0 else 'happy'
            # a soft shimmer of pink on the lids
            if kind in ('open', 'wide', 'sad', 'determined', 'half'):
                sf = head.frame(yaw * 1.02, eye_pitch + 8.0, 0.002)
                self.feat(f'shadow{name}', ellipsoid(ew * 1.12, 0.004, eh * 0.5, 18, 6), shadow, joint, head, sf)
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
                    ir = 0.86 * ew * (0.8 if kind == 'wide' else 1.0)
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
                lash_pts = [Vector((math.sin(a) * ew * 1.04, -ed * 0.55, math.cos(a) * eh * 1.02)) for a in [(-1 + 2 * i / 12) * 1.28 for i in range(13)]]
                self.feat(f'lash{name}', sweep(lash_pts, lambda t: 0.007 + 0.007 * math.sin(math.pi * t), 6), lash, joint, head, fr)
                # three little lashes flicking out at the outer corner
                for k, (a0, ln, up_) in enumerate(((0.8, 0.028, 0.75), (1.02, 0.036, 0.45), (1.22, 0.034, 0.12))):
                    aa = a0 * side
                    p0 = Vector((math.sin(aa) * ew * 1.04, -ed * 0.6, math.cos(aa) * eh * 1.02))
                    dv = Vector((side * (1.0 - up_ * 0.5), -0.1, up_ + 0.35)).normalized()
                    fl = [p0 + dv * (ln * t) + Vector((0.0, 0.0, 0.006 * t * t)) for t in (0.0, 0.5, 1.0)]
                    self.feat(f'flick{k}{name}', sweep(fl, lambda t: 0.0062 * (1 - t) + 0.0018, 6), lash, joint, head, fr)
                lid = {'sad': 0.42, 'determined': 0.36, 'half': 0.5}.get(kind)
                if lid and lid_col:
                    lidm = mt.skin(f'lid_{lid_col}', lid_col)
                    tilt = {'sad': -16 * side, 'determined': 14 * side}.get(kind, 0)
                    lid_mesh = ellipsoid(ew * 1.12, ed * 1.25, eh * 1.1, 20, 10, zmin=1 - lid * 2)
                    self.feat(f'lid{name}', lid_mesh, lidm, joint, head, fr @ R(0, tilt, 0) @ T(0, -0.004, 0))
            elif kind == 'happy':
                pts = arc_points(ew * 1.7, -eh * 0.42, 12, y=-0.01)
                self.feat(f'happy{name}', sweep([p + Vector((0, 0, -eh * 0.15)) for p in pts], 0.0125, 8), lash, joint, head, fr)
                tipp = pts[-1 if side > 0 else 0] + Vector((0, 0, -eh * 0.15))
                fl = [tipp, tipp + Vector((side * 0.024, -0.004, 0.018))]
                self.feat(f'hflick{name}', sweep(fl, lambda t: 0.009 * (1 - t) + 0.002, 6), lash, joint, head, fr)
            elif kind == 'closed':
                pts = arc_points(ew * 1.6, eh * 0.22, 12, y=-0.01)
                self.feat(f'closed{name}', sweep(pts, 0.0115, 8), lash, joint, head, fr)
            b_pitch = eye_pitch + brow_pitch + (4 if brows == 'up' else 0) + (2 if eyes == 'wide' else 0)
            roll = {'neutral': 0, 'up': -4, 'worried': 16, 'angry': -18, 'determined': -12, 'sad': 14}.get(brows, 0) * side
            bf = head.frame(yaw * 1.02, b_pitch, 0.004, roll)
            bpts = arc_points(ew * 1.45, -0.016, 8)
            self.feat(f'brow{name}', sweep(bpts, lambda t: 0.009 + 0.005 * math.sin(math.pi * t), 8), browm, joint, head, bf)
        skin_m = mt.skin(f'skin_{skin}', skin) if skin else None
        if nose and skin_m:
            nf = head.frame(0, eye_pitch - 13, -0.004)
            self.feat('nose', ellipsoid(0.025, 0.022, 0.019, 14, 8), skin_m, joint, head, nf)
        if blush:
            bl = mt.alpha('sab_blush', c['blush'], 0.45)
            for side in (1, -1):
                bf = head.frame(side * (eye_yaw + 13), eye_pitch - 17, 0.003)
                self.feat('blush', ellipsoid(0.056, 0.004, 0.032, 16, 6), bl, joint, head, bf)
        mf = head.frame(0, mouth_pitch, 0.0)
        w = 0.12 * mouth_w
        if mouth in ('smile', 'grin'):
            # her bright open smile: a small D with the upper teeth showing and a hint of tongue
            gw, gh = {'smile': (0.13, 0.046), 'grin': (0.15, 0.056)}[mouth]
            curl = gh * 0.45

            def bent(vs, dy=0.0):
                return [(x, y + dy, z + curl * (abs(x) / (gw / 2)) ** 2.2) for (x, y, z) in vs]
            mv, mfc = ellipsoid(gw / 2, 0.014, gh, 28, 12, zmax=0.3)
            self.feat('mouth', (bent(mv), mfc), mouth_m, joint, head, mf @ T(0, 0.002, 0.0))
            tv, tf = ellipsoid(gw / 2 * 0.9, 0.012, gh, 28, 6, zmin=-0.12, zmax=0.28)
            self.feat('teeth', (bent(tv, -0.006), tf), teeth, joint, head, mf @ T(0, 0.002, 0.0))
            self.feat('tongue', ellipsoid(gw * 0.22, 0.01, gh * 0.3, 14, 8, center=(0, -0.008, -gh * 0.66)), tongue, joint, head, mf)
            lv, lf = ellipsoid(gw * 0.2, 0.008, 0.008, 12, 6, center=(0, -0.012, -gh * 1.06))
            self.feat('lowlip', (bent(lv), lf), lip, joint, head, mf)
        elif mouth in ('open', 'laugh'):
            hh = {'open': 0.06, 'laugh': 0.074}[mouth]
            ww = w * 0.95
            self.feat('mouth', ellipsoid(ww / 2, 0.02, hh, 22, 12, zmax=0.15), mouth_m, joint, head, mf @ T(0, 0.002, 0.006))
            self.feat('tongue', ellipsoid(ww * 0.3, 0.012, hh * 0.45, 14, 8, center=(0, -0.008, -hh * 0.6)), tongue, joint, head, mf)
            self.feat('teeth', ellipsoid(ww * 0.42, 0.01, 0.012, 14, 6, center=(0, -0.012, 0.0)), teeth, joint, head, mf)
        elif mouth == 'o':
            self.feat('mouth', ellipsoid(0.026, 0.018, 0.032, 16, 10), mouth_m, joint, head, mf @ T(0, 0.004, -0.004))
        elif mouth == 'gasp':
            self.feat('mouth', ellipsoid(0.038, 0.02, 0.052, 16, 10), mouth_m, joint, head, mf @ T(0, 0.004, -0.012))
            self.feat('tongue', ellipsoid(0.02, 0.01, 0.018, 12, 6, center=(0, -0.012, -0.043)), tongue, joint, head, mf)
        elif mouth == 'frown':
            self.feat('mouth', sweep(arc_points(w * 0.8, -0.022, 12, y=-0.006), 0.0085, 8), mouth_m, joint, head, mf @ T(0, 0, -0.012))
        elif mouth == 'flat':
            self.feat('mouth', sweep([Vector((-w * 0.3, -0.006, 0)), Vector((w * 0.3, -0.006, 0))], 0.0085, 8), mouth_m, joint, head, mf)
        elif mouth == 'wobble':
            pts = [Vector(((i / 12 - 0.5) * w * 0.85, -0.006, math.sin(i / 12 * math.tau * 1.5) * 0.011)) for i in range(13)]
            self.feat('mouth', sweep(pts, 0.0085, 8), mouth_m, joint, head, mf)
        elif mouth == 'smirk':
            pts = [Vector(((i / 12 - 0.5) * w * 0.8, -0.006, 0.02 * (i / 12) ** 2)) for i in range(13)]
            self.feat('mouth', sweep(pts, 0.0085, 8), mouth_m, joint, head, mf)
