"""Goku: a fan-made chibi Son Goku (Dragon Ball) for the private party build (loaded by characters.py
as class `Goku`).

Built on the shared Hero structure (char_models.py) with Kip's chibi head and a broader, stronger
body: the iconic black spiky hair (big spikes fanning up and out from the crown, spiky bangs over the
forehead), an orange gi with a blue undershirt showing in the V of the lapels and a white patch with a
black glyph on his left chest, bare arms with blue wristbands, a blue sash tied at the front whose ends
hang down (and flutter with pose['extra']['scarf'] / 'wave', draped over his thighs), baggy orange
trousers tucked into dark blue boots with cream laces, and a confident grin as his resting face.

The face goes through Hero.face()'s expression states; `face()` below is a copy of it with a sharper
eye (a slight upper lid) and a confident grin for the resting 'smile'.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from char_rig import (HeadShape, R, T, arc_points, cloth_strip, curve3, disc, ellipsoid, flat_sweep, polyline_segment, superellipsoid,
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
            self.tip.extend(tip)
        elif len(mesh) > 2:
            self.tip.extend(mesh[2])

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


def open_shell(rings, sides: int = 26, thick: float = 0.02):
    """A partial tube with thickness through rings [(z, rx, ry, a0, a1)] (angles in degrees, 0 = +X,
    -90 = the front): an open garment whose opening may change width from ring to ring."""
    verts, faces = [], []
    n = len(rings)
    row = sides + 1
    for dr in (0.0, -thick):
        for (z, rx, ry, a0, a1) in rings:
            for k in range(row):
                a = math.radians(a0 + (a1 - a0) * k / sides)
                verts.append((math.cos(a) * (rx + dr), math.sin(a) * (ry + dr), z))
    L = n * row
    for i in range(n - 1):
        for k in range(sides):
            a = i * row + k
            faces.append((a, a + 1, a + 1 + row, a + row))
            b = L + a
            faces.append((b, b + row, b + 1 + row, b + 1))
    for i in range(n - 1):
        for k in (0, sides):
            a = i * row + k
            b = L + a
            if k == 0:
                faces.append((a, a + row, b + row, b))
            else:
                faces.append((a, b, b + row, a + row))
    for i in (0, n - 1):
        for k in range(sides):
            a = i * row + k
            b = L + a
            if i == 0:
                faces.append((a, b, b + 1, a + 1))
            else:
                faces.append((a, a + 1, b + 1, b))
    return verts, faces


def ring_band(rx, ry, prof, seg=64, zfun=None):
    """A closed band around Z following an ellipse (rx, ry); `prof` is a closed cross-section
    [(dr, z), ...] (outer side bottom to top, then back down the inside)."""
    verts, faces = [], []
    n = len(prof)
    for i in range(seg):
        a = i / seg * math.tau
        ca, sa = math.cos(a), math.sin(a)
        dz = zfun(a) if zfun else 0.0
        for dr, z in prof:
            verts.append((ca * (rx + dr), sa * (ry + dr), z + dz))
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(n):
            j2 = (j + 1) % n
            faces.append((i * n + j, i2 * n + j, i2 * n + j2, i * n + j2))
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


# ------------------------------------------------------------------------------------------
class Goku(Hero):
    """Goku: black spiky hair, orange gi with a blue undershirt, blue sash, wristbands and boots."""

    key = 'goku'
    ankle_h = 0.15
    hip_h = 0.66  # ankle_h + 0.04 + thigh + shin
    spine = 0.08
    chest = 0.2
    neck = 0.14
    head_up = 0.04
    shoulder = (0.245, 0.0, 0.11)
    upper_arm = 0.22
    forearm = 0.2
    hip_w = 0.115
    thigh = 0.23
    shin = 0.24
    sit_h = 0.18

    C = dict(skin='#f8cfa8', skin_d='#e4a47c', hair_d='#0a0a0f', hair_l='#363a52', gi='#f47b20', gi_d='#cf5c14', gi_l='#ff9b3d',
             blue='#2554ba', blue_d='#1a3c8e', boot='#1c2c70', boot_d='#141f52', lace='#f4d584', sole='#ece0c6', patch='#fbfaf4',
             glyph='#141214', iris='#1a1411', brow='#0c0a0b')

    HEAD = (0.4, 0.375, 0.39, 0.41)  # rx, ry, rz, centre height above the head joint

    def head_top(self) -> float:
        # the dizzy stars circle above the spikes
        return self.HEAD[3] + 0.86

    # --- building -------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('goku_skin', c['skin']),
            skin_d=mt.skin('goku_skin_d', c['skin_d']),
            gi=mt.cloth('goku_gi', c['gi'], 0.74, 0.4, 0.1),
            gi_d=mt.cloth('goku_gi_d', c['gi_d'], 0.74, 0.35),
            blue=mt.cloth('goku_blue', c['blue'], 0.72, 0.4, 0.08),
            blue_d=mt.cloth('goku_blue_d', c['blue_d'], 0.72, 0.35),
            boot=mt.cloth('goku_boot', c['boot'], 0.55, 0.25, 0.08, 40),
            boot_d=mt.cloth('goku_boot_d', c['boot_d'], 0.55, 0.2),
            lace=mt.cloth('goku_lace', c['lace'], 0.6, 0.3),
            sole=mt.cloth('goku_sole', c['sole'], 0.6, 0.1),
            patch=mt.cloth('goku_patch', c['patch'], 0.6, 0.3),
            glyph=mt.glossy('goku_glyph', c['glyph'], 0.4, 0.2),
            hair=mt.hair('goku_hair', c['hair_d'], c['hair_l'], 0.34),
        )
        self.torso()
        self.sash()
        self.legs()
        self.arms()
        self.head_parts()

    @staticmethod
    def rb(z):
        """Torso half-width at chest-frame height z (a strong, slightly V-shaped chest)."""
        t = (z + 0.37) / 0.49
        return 0.236 + 0.022 * math.sin(math.pi * clamp(t) * 0.85)

    @staticmethod
    def vgap(z):
        """Half-angle of the V between the lapels at chest-frame height z."""
        return 21.0 * sstep((z + 0.15) / 0.27)

    def torso(self):
        mm = self.mat
        rb, vgap = self.rb, self.vgap
        # blue undershirt (seen in the V), then the orange gi top with its V-neck
        self.add('undershirt', sweep([Vector((0, 0, -0.22 + 0.34 * i / 8)) for i in range(9)], lambda t: rb(-0.22 + 0.34 * t) - 0.012, 26,
                                     cap0=False, squash=0.8), mm['blue'], 'chest')
        self.add('underdome', ellipsoid(rb(0.12) - 0.014, (rb(0.12) - 0.014) * 0.8, 0.088, 28, 12, center=(0, 0, 0.1), zmin=-0.2), mm['blue'], 'chest')
        rings = []
        for i in range(13):
            z = -0.37 + (0.1 + 0.37) * i / 12
            rx = rb(z)
            g = vgap(z)
            rings.append((z, rx, rx * 0.8, -90 + g, 270 - g))
        rx_top = rings[-1][1]
        top_pts = []
        for i in range(1, 10):
            ph = math.radians(60 * i / 9)
            z = 0.1 + 0.092 * math.sin(ph)
            r = rx_top * math.cos(ph) + 0.004 * math.sin(ph)
            g = vgap(0.1) + 22.0 * sstep(i / 9) ** 0.8
            rings.append((z, r, r * 0.8, -90 + g, 270 - g))
        self.add('gi', open_shell(rings, 34, 0.022), mm['gi'], 'chest')
        # lapel trims along the V, and the wrap line running on down to the sash
        for side in (1, -1):
            pts = []
            for (z, rx, ry, a0, a1) in rings:
                if z < -0.14:
                    continue
                a = math.radians(a0 if side > 0 else a1)
                pts.append(Vector((math.cos(a) * (rx + 0.004), math.sin(a) * (ry + 0.004), z)))
            self.add('lapel', sweep(pts, 0.013, 8, squash=0.55), mm['gi_d'], 'chest')
        wrap = []
        for i in range(7):
            u = i / 6
            z = -0.14 - 0.16 * u
            a = math.radians(-90 - 26 * u)
            rx = rb(z) + 0.004
            wrap.append(Vector((math.cos(a) * rx, math.sin(a) * rx * 0.8, z)))
        self.add('wrap', sweep(wrap, 0.01, 8, squash=0.55), mm['gi_d'], 'chest')
        # white patch with a black glyph on his left chest
        z, a = -0.02, math.radians(-54)
        rx = rb(z) + 0.006
        p = Vector((math.cos(a) * rx, math.sin(a) * rx * 0.8, z))
        n = Vector((math.cos(a) / rx, math.sin(a) / (rx * 0.8), 0.0)).normalized()
        pm = orient(p, n) @ R(0, 0, 0)
        self.add('patch', disc(0.056, 0.012, 32), mm['patch'], 'chest', pm)
        self.add('patchrim', torus(0.056, 0.005, 32, 6), mm['gi_d'], 'chest', pm @ R(90, 0, 0))
        k = 1.12
        strokes = [
            [(-0.019, 0.03), (0.019, 0.03), (0.019, 0.006), (-0.019, 0.006), (-0.019, 0.03)],  # the box of 田
            [(0.0, 0.03), (0.0, 0.006)], [(-0.019, 0.018), (0.019, 0.018)],
            [(0.0, 0.0), (-0.025, -0.013)], [(0.0, 0.0), (0.025, -0.013)],  # roof
            [(-0.009, -0.008), (-0.012, -0.034)], [(0.01, -0.008), (0.01, -0.034)],  # legs
        ]
        acc = MeshAcc()
        for st in strokes:
            pts = [Vector((x * k, -0.008, zz * k)) for x, zz in st]
            pts = polyline_segment(pts, 0, 1, 4 * len(pts))
            acc.add(sweep(pts, 0.0045, 6))
        self.add('glyph', acc.mesh, mm['glyph'], 'chest', pm)
        # trousers: the seat (hips frame)
        self.add('pelvis', superellipsoid(0.22, 0.184, 0.16, 2.4, 28, 16, center=(0, 0, -0.05)), mm['gi'], 'hips')
        # neck
        a0 = self.J('chest') @ Vector((0.0, 0.0, 0.1))
        b0 = self.J('neck') @ Vector((0.0, 0.0, 0.03))
        c0 = self.J('head') @ Vector((0.0, 0.01, 0.12))
        self.add('neck', sweep(curve3(a0, b0, c0, 6), 0.078, 14), mm['skin'])

    # --- sash -------------------------------------------------------------------------------------
    SASH = (0.262, 0.214, -0.03)  # rx, ry, centre height in the spine frame

    def sash(self):
        mm = self.mat
        rx, ry, zc = self.SASH
        h = 0.052
        prof = []
        K = 10
        for j in range(K + 1):
            v = j / K
            prof.append((0.018 * math.sin(math.pi * v) ** 0.6, zc - h + 2 * h * v))
        prof += [(-0.02, zc + h * 0.9), (-0.02, zc - h * 0.9)]
        self.add('sash', ring_band(rx, ry, prof, 72, zfun=lambda a: 0.008 * math.sin(a * 2 + 0.4)), mm['blue'], 'spine')
        # the knot at the front, a touch to his left
        ak = math.radians(-82)
        kp = Vector((math.cos(ak) * (rx + 0.03), math.sin(ak) * (ry + 0.03), zc - 0.004))
        nrm = Vector((math.cos(ak) * 0.4, math.sin(ak), 0.0)).normalized()
        km = orient(kp, nrm)
        self.add('knot', ellipsoid(0.058, 0.04, 0.05, 16, 10), mm['blue_d'], 'spine', km)
        for sd in (1, -1):
            self.add('knotlobe', ellipsoid(0.05, 0.034, 0.044, 14, 8, center=(0.05 * sd, 0.014, 0.004)), mm['blue'], 'spine', km @ R(0, 16 * sd, 0))
        self.sash_ends(kp)

    def colliders(self):
        """Capsules (world space) the hanging sash ends must stay out of: thighs and shins."""
        caps = []
        for s_ in ('L', 'R'):
            caps.append((self.P('hip' + s_), self.P('knee' + s_), 0.15))
            caps.append((self.P('knee' + s_), self.P('ankle' + s_), 0.13))
        return caps

    def push_out(self, pts, fixed=2):
        caps = self.colliders()
        H = self.J('hips')
        Hi = H.inverted()
        er = Vector((0.24, 0.205, 0.18))
        ec = Vector((0.0, 0.0, -0.05))
        out = [p.copy() for p in pts]
        for _it in range(3):
            for i in range(fixed, len(out)):
                q = out[i]
                for a, b, r in caps:
                    c = seg_closest(q, a, b)
                    d = q - c
                    if d.length < r:
                        if d.length < 1e-6:
                            d = Vector((0.0, -1.0, 0.0))
                        q = c + d.normalized() * r
                # the seat of the trousers (an ellipsoid in the hips frame)
                lq = Hi @ q - ec
                e = Vector((lq.x / er.x, lq.y / er.y, lq.z / er.z))
                if e.length < 1.0:
                    lq = lq * (1.0 / max(1e-6, e.length))
                    q = H @ (lq + ec)
                out[i] = q
            # relax so pushed points don't kink the strip
            sm = [p.copy() for p in out]
            for i in range(fixed, len(out) - 1):
                sm[i] = out[i] * 0.5 + (out[i - 1] + out[i + 1]) * 0.25
            sm[-1] = out[-1] * 0.7 + out[-2] * 0.3 + (out[-1] - out[-2]) * 0.3
            out = sm
        return out

    def sash_ends(self, kp: Vector):
        mm = self.mat
        ex = self.pose.get('extra', {})
        fly = clamp(ex.get('scarf', 0.0))
        wave = ex.get('wave', 0.0)
        sway = ex.get('sway', 0.0)
        Sp = self.J('spine')
        front = (Sp.to_3x3() @ Vector((0.0, -1.0, 0.0))).normalized()
        for k, (dx, ln, w0) in enumerate(((0.04, 0.3, 0.078), (-0.035, 0.25, 0.072))):
            pts = []
            for i in range(13):
                t = i / 12
                wob = (0.012 + 0.03 * fly) * math.sin(wave + t * 4.0 + k * 1.4) * t
                x = dx * t * 1.2 + 0.025 * sway * t - (0.16 * fly) * t * t
                y = -0.03 - 0.03 * t - 0.05 * fly * t + 0.1 * fly * t * t
                z = -0.03 - ln * t * (1.0 - 0.42 * fly) + 0.05 * fly * t * t
                pts.append(kp + Vector((x + wob * 0.5, y, z + wob)))
            world = [Sp @ p for p in pts]
            world = self.push_out(world)
            self.add(f'sashend{k}', cloth_strip(world, lambda t, w0=w0: w0 + 0.018 * t, front, 1.5, lambda t: 0.004 + 0.01 * t, 0.02, 8),
                     mm['blue'])

    # --- legs -------------------------------------------------------------------------------------
    def limb_pts(self, a, b, c, t0, t1, n=8):
        return polyline_segment(curve3(self.P(a), self.P(b), self.P(c), 24), t0, t1, n)

    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'

            def pant_r(t):  # baggy: widest around the knee, gathered into the boot
                return 0.122 + 0.03 * math.sin(math.pi * clamp(t / 0.92) ** 1.2) - 0.035 * sstep((t - 0.82) / 0.18)
            self.limb('pants' + s_, hip, kn, an, pant_r, mm['gi'], 0.0, 0.8, 18, 14, cap0=True, cap1=True)
            # boot shaft with a folded rim, cream laces crossing down the front
            self.limb('shaft' + s_, hip, kn, an, lambda t: 0.086 + 0.006 * t, mm['boot'], 0.7, 1.0, 16, 6, cap0=False, cap1=True)
            self.limb('rim' + s_, hip, kn, an, 0.098, mm['boot_d'], 0.72, 0.77, 16, 2, cap0=True, cap1=True)
            km = self.J(kn).to_3x3()
            fwd = (km @ Vector((0.0, 1.0, 0.0))).normalized()
            seg = self.limb_pts(hip, kn, an, 0.78, 0.97, 6)
            acc = MeshAcc()
            for j in range(3):
                t0, t1 = j / 3, (j + 1) / 3
                p0 = seg[int(round(t0 * 6))]
                p1 = seg[int(round(t1 * 6))]
                tg = (p1 - p0).normalized()
                f = (fwd - tg * fwd.dot(tg)).normalized()
                side = tg.cross(f).normalized()
                r = 0.094
                for s2 in (1, -1):
                    a = p0 + f * r + side * (0.036 * s2)
                    b = p1 + f * r - side * (0.036 * s2)
                    mid = (a + b) * 0.5 + f * 0.006
                    acc.add(sweep([a, mid, b], 0.0085, 6))
            self.add('laces' + s_, acc.mesh, mm['lace'])
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('boot' + s_, superellipsoid(0.118, 0.172, 0.1, 2.6, 22, 14, center=(0, -0.05, -0.05)), mm['boot'], None, fm)
            self.add('toe' + s_, ellipsoid(0.108, 0.092, 0.07, 18, 10, center=(0, -0.152, -0.082)), mm['boot'], None, fm)
            self.add('sole' + s_, superellipsoid(0.126, 0.194, 0.032, 3.0, 22, 8, center=(0, -0.058, -0.12)), mm['sole'], None, fm)
            self.add('tongue' + s_, superellipsoid(0.042, 0.02, 0.07, 2.5, 12, 8, center=(0, -0.105, -0.01)), mm['lace'], None, fm @ R(-38, 0, 0))
            for q in range(2):
                y = -0.09 - q * 0.045
                zz = 0.0 - q * 0.03
                self.add(f'flace{q}{s_}', sweep([Vector((-0.05, y, zz - 0.012)), Vector((0.0, y - 0.012, zz + 0.012)), Vector((0.05, y, zz - 0.012))],
                                                0.0085, 6), mm['lace'], None, fm)

    # --- arms -------------------------------------------------------------------------------------
    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.066 - 0.012 * t + 0.01 * math.sin(math.pi * clamp(t / 0.5)), mm['skin'], 0.0, 1.0, 14,
                      16, extend=0.02)
            self.limb('sleeve' + s_, sh, el, wr, 0.094, mm['gi'], 0.0, 0.1, 16, 3, cap0=True, cap1=False)
            self.limb('undersleeve' + s_, sh, el, wr, 0.082, mm['blue'], 0.06, 0.15, 16, 3, cap0=False, cap1=False)
            self.limb('band' + s_, sh, el, wr, lambda t: 0.068 + 0.004 * math.sin(math.pi * t), mm['blue'], 0.76, 0.97, 16, 5, cap0=True, cap1=True)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.26):
                self.add('hand' + nm + s_, mesh, mm['skin'], None, wm)

    # --- head -------------------------------------------------------------------------------------
    def head_parts(self):
        c, mm = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        hv = [(x * (1 - 0.1 * max(0.0, (hc - z) / hz) ** 1.6), y - 0.02 * max(0.0, (hc - z) / hz) ** 2, z) for (x, y, z) in hv]
        self.add('head', (hv, hf), mm['skin'], 'head')
        for sd in (1, -1):
            self.add('ear', ellipsoid(0.062, 0.04, 0.082, 16, 10), mm['skin'], 'head', T((hx - 0.01) * sd, 0.03, hc - 0.05) @ R(0, 0, -14 * sd))
            self.add('earin', ellipsoid(0.034, 0.02, 0.048, 12, 8), mm['skin_d'], 'head', T((hx - 0.004) * sd, 0.0, hc - 0.05) @ R(0, 0, -14 * sd))
        self.face(head, 'head', eye_yaw=23, eye_pitch=-6, eye_size=(0.088, 0.112), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-31,
                  lid_col=c['skin'], skin=c['skin'], brow_pitch=20, lash_col='#0e0a09')
        self.hair()

    # spikes: (root yaw, root pitch, tip direction (x: his left, y: back, z: up), length, root radius, curl).
    # The big ones fan out in the frontal plane (swept back a little) so the silhouette reads from the front.
    SPIKES = [
        (0, 72, (-0.17, 0.25, 1.0), 0.44, 0.2, 0.08),     # top
        (22, 60, (0.47, 0.3, 0.88), 0.54, 0.21, 0.14),    # up and out to his left
        (-24, 58, (-0.62, 0.3, 0.79), 0.56, 0.21, 0.14),   # up and out to his right
        (50, 46, (0.83, 0.3, 0.56), 0.48, 0.2, 0.14),     # out to his left
        (-52, 44, (-0.91, 0.3, 0.41), 0.5, 0.2, 0.14),   # out to his right
        (78, 24, (0.98, 0.45, 0.02), 0.34, 0.17, 0.1),    # side, his left
        (-80, 22, (-0.98, 0.45, -0.04), 0.36, 0.17, 0.1),  # side, his right
        (100, 4, (0.7, 0.9, -0.5), 0.22, 0.13, 0.0),      # small ones behind the ears
        (-100, 4, (-0.7, 0.9, -0.5), 0.22, 0.13, 0.0),
        (150, 52, (0.35, 1.0, 0.6), 0.4, 0.2, 0.1),       # the back of the crown
        (-150, 52, (-0.35, 1.0, 0.55), 0.4, 0.2, 0.1),
        (180, 28, (0.0, 1.0, 0.12), 0.34, 0.19, 0.06),
        (156, 2, (0.35, 1.0, -0.6), 0.26, 0.14, 0.0),     # nape
        (-156, 2, (-0.35, 1.0, -0.6), 0.26, 0.14, 0.0),
    ]
    # bangs: (root yaw, root pitch, yaw drift, lowest pitch, root radius)
    BANGS = [(-8, 52, -10, 5, 0.105), (22, 49, 8, 12, 0.088), (-38, 46, -10, 13, 0.08)]

    def hair(self):
        hair = self.mat['hair']
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.014, hy + 0.014, hz + 0.012, center=(0, 0.012, hc + 0.012))
        tips = [(-60, 26), (-24, 34), (8, 36), (40, 32), (62, 26)]

        def pointed(yaw, lst, high, width):
            best = high
            for ty, low in lst:
                d = abs(yaw - ty)
                best = min(best, low + (high - low) * min(1.0, d / width) ** 0.7)
            return best

        back = [(112, -2), (128, -20), (146, -10), (160, -30), (180, -26)]

        def boundary(yaw):
            a = abs(yaw)
            if a <= 70:
                return pointed(yaw, tips, 42.0, 10.0)
            if a <= 104:
                return periodic_interp([(70, 32), (78, -4), (86, -16), (94, 12), (104, 8)], a)
            mirror = [(ty, low) for ty, low in back] + [(-ty, low) for ty, low in back]
            return min(pointed(yaw, mirror, 2.0, 8.0), 8.0 - 6.0 * sstep((a - 104) / 12))

        def thickness(yaw, pitch, f):
            ridge = 0.5 + 0.5 * math.cos(math.radians(yaw) * 14 + 0.3)
            edge = min(1.0, f / 0.2)
            return 0.016 + 0.07 * math.sin(math.pi * min(1.0, f * 1.1)) * edge + 0.02 * ridge * edge

        v, f, tp = hair_shell(hs, boundary, thickness, 150, 22)
        self.add('hair', (v, f), hair, 'head', tip=tp)
        # the big spikes
        acc = MeshAcc()
        hs2 = HeadShape(hx + 0.05, hy + 0.05, hz + 0.05, center=(0, 0.012, hc + 0.012))
        for (ry, rp, dv, ln, r0, curl) in self.SPIKES:
            pos, n = hs2.point(ry, rp, -0.07)
            d = Vector(dv).normalized()
            up = Vector((0.0, 0.0, 1.0))
            bendv = (up - d * up.dot(d))
            bendv = bendv.normalized() if bendv.length > 1e-4 else Vector((0.0, 0.0, 0.0))
            pts = [pos + d * (ln * t) + bendv * (ln * curl * t * t) for t in [k / 10 for k in range(11)]]
            fl = Vector((0.0, -1.0, 0.0))
            fl = fl - d * fl.dot(d)
            if fl.length < 0.3:
                fl = up - d * up.dot(d)
            fl.normalize()
            vv = flat_sweep(pts, lambda t, r0=r0: r0 * (1 - t) ** 0.95 + 0.005, fl, 0.58, 16)
            acc.add(vv, flat_tip(11, 16, len(vv[0]), 0.15, 1.0))
        # spiky bangs over the forehead
        for (ry, rp, dyo, low, r0) in self.BANGS:
            pts, nrms = [], []
            for k in range(11):
                t = k / 10
                yy = ry + dyo * t * t
                pp = rp - (rp - low) * t ** 0.85
                q, qn = hs.point(yy, pp, 0.05 * (1 - t) ** 1.5 + 0.012)
                pts.append(q)
                nrms.append(qn)
            vv = flat_sweep(pts, lambda t, r0=r0: r0 * (1 - t) ** 1.15 + 0.003, lambda t, nrms=nrms: nrms[min(10, int(round(t * 10)))], 0.42, 12)
            acc.add(vv, flat_tip(11, 12, len(vv[0]), 0.2, 1.0))
        self.add('spikes', acc.mesh, hair, 'head', tip=acc.tip)

    # --- face (a copy of Hero.face with a sharper eye and Goku's confident grin) ---------------------
    def face(self, head: HeadShape, joint: str, *, eye_yaw=27.0, eye_pitch=0.0, eye_size=(0.085, 0.105), iris='#6b3a1e',
             brow_col='#4a2c1a', mouth_pitch=-24.0, mouth_w=1.0, lid_col=None, nose=True, skin=None, blush=True, brow_pitch=19.0,
             lash_col='#2a1a14'):
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        eyes, mouth, brows = f['eyes'], f['mouth'], f['brows']
        lx, lz = f.get('look', (0.0, 0.0))
        mt = self.m
        white = mt.glossy('eye_white', '#fbfbf8', 0.18, 0.8)
        dark = mt.glossy('eye_dark', '#1c1412', 0.25, 0.9)
        irm = mt.glossy(f'iris_{iris}', iris, 0.2, 0.9)
        shine = mt.emit('eye_shine', '#ffffff', 3.0)
        mouth_m = mt.glossy('mouth', '#6d2a26', 0.4, 0.2)
        tongue = mt.glossy('tongue', '#e8797b', 0.35, 0.3)
        teeth = mt.glossy('teeth', '#fffdf6', 0.25, 0.4)
        lash = mt.glossy(f'lash_{lash_col}', lash_col, 0.4, 0.2)
        browm = mt.cloth(f'brow_{brow_col}', brow_col, 0.6, 0.2)
        ew, eh = eye_size
        ed = ew * 0.34
        for side in (1, -1):
            yaw = eye_yaw * side
            fr = head.frame(yaw, eye_pitch, -ed * 0.55)
            name = 'L' if side > 0 else 'R'
            kind = eyes
            if eyes == 'wink':
                kind = 'open' if side > 0 else 'happy'
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
                    pr = ir * 0.58
                    self.feat(f'pupil{name}', ellipsoid(pr, ed * 0.2, pr * 1.12, 16, 8, center=off + Vector((0.0, -ed * 0.12, 0.0))), dark, joint, head, fr)
                    h1 = off + Vector((-ir * 0.38, -ed * 0.3, ir * 0.42))
                    self.feat(f'shine{name}', ellipsoid(ir * 0.34, 0.004, ir * 0.36, 10, 6, center=h1), shine, joint, head, fr)
                    h2 = off + Vector((ir * 0.4, -ed * 0.3, -ir * 0.4))
                    self.feat(f'shine2{name}', ellipsoid(ir * 0.13, 0.004, ir * 0.13, 8, 5, center=h2), shine, joint, head, fr)
                lash_pts = [Vector((math.sin(a) * ew * 1.02, -ed * 0.55, math.cos(a) * eh * 1.0)) for a in [(-1 + 2 * i / 12) * 1.25 for i in range(13)]]
                self.feat(f'lash{name}', sweep(lash_pts, lambda t: 0.007 + 0.007 * math.sin(math.pi * t), 6), lash, joint, head, fr)
                # a slight upper lid, tilted down towards the nose, keeps his look keen and confident
                lid = {'sad': 0.42, 'determined': 0.4, 'half': 0.5, 'open': 0.2}.get(kind)
                if lid and lid_col:
                    lidm = mt.skin(f'lid_{lid_col}', lid_col)
                    tilt = {'sad': -16 * side, 'determined': 14 * side, 'open': 9 * side}.get(kind, 0)
                    lid_mesh = ellipsoid(ew * 1.12, ed * 1.25, eh * 1.1, 20, 10, zmin=1 - lid * 2)
                    self.feat(f'lid{name}', lid_mesh, lidm, joint, head, fr @ R(0, tilt, 0) @ T(0, -0.004, 0))
                    if kind == 'open':
                        # redraw the lash line along the lid's edge
                        zc = eh * 1.1 * (1 - lid * 2)
                        w2 = ew * 1.12 * math.sqrt(max(0.0, 1 - (1 - lid * 2) ** 2))
                        lp = [Vector((w2 * (-1 + 2 * i / 10), -ed * 1.3, zc + 0.004)) for i in range(11)]
                        self.feat(f'lidline{name}', sweep(lp, lambda t: 0.006 + 0.004 * math.sin(math.pi * t), 6), lash, joint, head,
                                  fr @ R(0, tilt, 0) @ T(0, -0.004, 0))
            elif kind == 'happy':
                pts = arc_points(ew * 1.7, -eh * 0.42, 12, y=-0.01)
                self.feat(f'happy{name}', sweep([p + Vector((0, 0, -eh * 0.15)) for p in pts], 0.0125, 8), lash, joint, head, fr)
            elif kind == 'closed':
                pts = arc_points(ew * 1.6, eh * 0.22, 12, y=-0.01)
                self.feat(f'closed{name}', sweep(pts, 0.0115, 8), lash, joint, head, fr)
            b_pitch = eye_pitch + brow_pitch + (4 if brows == 'up' else 0) + (2 if eyes == 'wide' else 0)
            roll = {'neutral': -9, 'up': -4, 'worried': 16, 'angry': -18, 'determined': -15, 'sad': 14}.get(brows, 0) * side
            bf = head.frame(yaw * 1.02, b_pitch, 0.004, roll)
            bpts = arc_points(ew * 1.6, -0.01, 8)
            self.feat(f'brow{name}', sweep(bpts, lambda t: 0.015 + 0.009 * math.sin(math.pi * t ** 0.8), 8), browm, joint, head, bf)
        skin_m = mt.skin(f'skin_{skin}', skin) if skin else None
        if nose and skin_m:
            nf = head.frame(0, eye_pitch - 13, -0.004)
            self.feat('nose', ellipsoid(0.028, 0.024, 0.022, 14, 8), skin_m, joint, head, nf)
        if blush:
            bl = mt.alpha('blush', '#ff8a8a', 0.3)
            for side in (1, -1):
                bf = head.frame(side * (eye_yaw + 13), eye_pitch - 16, 0.003)
                self.feat('blush', ellipsoid(0.044, 0.004, 0.026, 14, 6), bl, joint, head, bf)
        mf = head.frame(0, mouth_pitch, 0.0)
        w = 0.12 * mouth_w
        if mouth in ('smile', 'grin'):
            # confident grin: a little lopsided (higher on his left), upper teeth showing
            gw, gh = {'smile': (0.18, 0.058), 'grin': (0.195, 0.066)}[mouth]
            curl = gh * 0.5

            def bent(vs, dy=0.0):
                return [(x, y + dy, z + curl * (abs(x) / (gw / 2)) ** 2.2 + 0.1 * gh * (x / (gw / 2))) for (x, y, z) in vs]
            mv, mfc = ellipsoid(gw / 2, 0.014, gh, 28, 12, zmax=0.3)
            self.feat('mouth', (bent(mv), mfc), mouth_m, joint, head, mf @ T(0.008, 0.002, 0.0))
            tv, tf = ellipsoid(gw / 2 * 0.93, 0.012, gh, 28, 6, zmin=-0.25, zmax=0.28)
            self.feat('teeth', (bent(tv, -0.006), tf), teeth, joint, head, mf @ T(0.008, 0.002, 0.0))
        elif mouth in ('open', 'laugh'):
            hh = {'open': 0.06, 'laugh': 0.08}[mouth]
            ww = w * 1.1
            self.feat('mouth', ellipsoid(ww / 2, 0.02, hh, 22, 12, zmax=0.15), mouth_m, joint, head, mf @ T(0, 0.002, 0.006))
            self.feat('tongue', ellipsoid(ww * 0.3, 0.012, hh * 0.45, 14, 8, center=(0, -0.008, -hh * 0.6)), tongue, joint, head, mf)
            self.feat('teeth', ellipsoid(ww * 0.42, 0.01, 0.013, 14, 6, center=(0, -0.012, 0.0)), teeth, joint, head, mf)
        elif mouth == 'o':
            self.feat('mouth', ellipsoid(0.028, 0.018, 0.034, 16, 10), mouth_m, joint, head, mf @ T(0, 0.004, -0.004))
        elif mouth == 'gasp':
            self.feat('mouth', ellipsoid(0.04, 0.02, 0.055, 16, 10), mouth_m, joint, head, mf @ T(0, 0.004, -0.012))
            self.feat('tongue', ellipsoid(0.02, 0.01, 0.018, 12, 6, center=(0, -0.012, -0.045)), tongue, joint, head, mf)
        elif mouth == 'frown':
            self.feat('mouth', sweep(arc_points(w * 0.85, -0.024, 12, y=-0.006), 0.009, 8), mouth_m, joint, head, mf @ T(0, 0, -0.012))
        elif mouth == 'flat':
            self.feat('mouth', sweep([Vector((-w * 0.32, -0.006, 0)), Vector((w * 0.32, -0.006, 0))], 0.009, 8), mouth_m, joint, head, mf)
        elif mouth == 'wobble':
            pts = [Vector(((i / 12 - 0.5) * w * 0.9, -0.006, math.sin(i / 12 * math.tau * 1.5) * 0.012)) for i in range(13)]
            self.feat('mouth', sweep(pts, 0.009, 8), mouth_m, joint, head, mf)
        elif mouth == 'smirk':
            pts = [Vector(((i / 12 - 0.5) * w * 0.8, -0.006, 0.02 * (i / 12) ** 2)) for i in range(13)]
            self.feat('mouth', sweep(pts, 0.009, 8), mouth_m, joint, head, mf)
