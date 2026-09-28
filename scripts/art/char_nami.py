"""Nami: a fan-made chibi Nami (One Piece) for the private party build (loaded by characters.py as class
`Nami`).

A modest, all-ages version on the shared Hero structure (char_models.py) with Kip's chibi proportions:
long wavy bright orange hair with side-swept bangs that falls past her shoulders, warm brown eyes with a
flick of lashes, a confident smile (her happy grins turn into a wink), a blue-and-white striped tank top
tucked into blue jeans with a slim belt, jeans rolled at the ankle, orange heeled sandals, gold bangles
on her right wrist and her blue pinwheel-and-tangerine tattoo on the upper left arm.

The long hair is draped for every pose: each lock is a short rope that starts on the back or side of the
scalp, slides down over the head under gravity, is pulled in towards the upper back and pushed out of
the body (head, neck, torso, pelvis, arms, legs) and the ground, then gets its waves and curled tips.
pose['extra']['scarf'] (0 hangs .. 1 streams out behind) and 'wave' (ripple phase) drive it the way
they drive Kip's scarf.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import HeadShape, R, T, arc_points, curve3, ellipsoid, flat_sweep, polyline_segment, superellipsoid, sweep, torus
from char_models import DEFAULT_FACE, Hero, hair_shell, hand_mitten


# ------------------------------------------------------------------------------------------
# Small helpers (local copies so this module only depends on the shared files as they are)
def clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return max(a, min(b, x))


def sstep(x: float) -> float:
    x = clamp(x)
    return x * x * (3.0 - 2.0 * x)


def interp(points, x):
    """Smooth interpolation through sorted (x, y) control points (clamped at the ends)."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x0 <= x <= x1:
            f = (x - x0) / (x1 - x0) if x1 > x0 else 0.0
            f = f * f * (3 - 2 * f)
            return y0 + (y1 - y0) * f
    return points[-1][1]


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
        else:
            self.tip.extend([0.0] * len(vv))

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


def garment(z0: float, ztop, rad, sides: int = 36, rows: int = 14, squash: float = 0.8, thick: float = 0.016):
    """A tube with thickness around Z from z0 up to a top edge ztop(angle) (angle in radians, 0 = +X,
    -pi/2 = the front), radius rad(z): a top whose neckline dips at the front."""
    verts, faces = [], []
    for dr in (0.0, -thick):
        for i in range(rows + 1):
            f = i / rows
            for k in range(sides):
                a = k / sides * math.tau
                z = z0 + (ztop(a) - z0) * f
                r = rad(z) + dr
                verts.append((math.cos(a) * r, math.sin(a) * r * squash, z))
    L = (rows + 1) * sides

    def ix(i, k, layer=0):
        return layer * L + i * sides + k % sides
    for i in range(rows):
        for k in range(sides):
            faces.append((ix(i, k), ix(i, k + 1), ix(i + 1, k + 1), ix(i + 1, k)))
            faces.append((ix(i, k, 1), ix(i + 1, k, 1), ix(i + 1, k + 1, 1), ix(i, k + 1, 1)))
    for k in range(sides):
        faces.append((ix(0, k), ix(0, k, 1), ix(0, k + 1, 1), ix(0, k + 1)))
        faces.append((ix(rows, k), ix(rows, k + 1), ix(rows, k + 1, 1), ix(rows, k, 1)))
    return verts, faces


# ------------------------------------------------------------------------------------------
class Nami(Hero):
    """Nami: long wavy orange hair, striped tank top, jeans rolled at the ankle, orange heeled sandals."""

    key = 'nami'
    ankle_h = 0.16
    hip_h = 0.64  # ankle_h + 0.04 + thigh + shin
    spine = 0.08
    chest = 0.19
    neck = 0.14
    head_up = 0.04
    shoulder = (0.2, 0.0, 0.11)
    upper_arm = 0.21
    forearm = 0.185
    hip_w = 0.102
    thigh = 0.22
    shin = 0.22
    sit_h = 0.17

    C = dict(skin='#f9d2b4', skin_d='#eaae8c', hair_d='#dc4f16', hair_l='#ffab55', stripe_b='#2c63c6', stripe_w='#f6f7f9',
             strap='#2c63c6', denim='#3c5fa4', denim_d='#2d4a86', cuff='#86a8dc', belt='#7a4a28', gold='#f0bd48', sandal='#f4892a',
             sandal_d='#d0671a', tattoo='#2b5ec2', iris='#8a4a1f', brow='#c4521e', lash='#2a150c', lip='#d8636a')

    HEAD = (0.4, 0.375, 0.39, 0.41)  # rx, ry, rz, centre height above the head joint
    EYE = (23.0, -5.0)

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.12

    # --- materials ------------------------------------------------------------------------------
    def stripe_mat(self, name: str):
        """Blue and white horizontal stripes from object coordinates (the top lives in the chest frame)."""
        c = self.C

        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            sp = m.sep(obj)
            w = m.math('SINE', m.math('MULTIPLY', m.math('ADD', sp[2], -0.012), math.tau / 0.098))
            f = m.maprange(w, -0.16, 0.16)
            colr = m.mix(f, col(c['stripe_w']), col(c['stripe_b']))
            nz = m.noise(70.0, 3, 0.6, obj)
            m.bsdf(colr, 0.72, normal=m.bump(nz.outputs['Fac'], 0.06, 0.02), sheen=0.35, spec=0.3)
            return m.mat
        return self.m.get(name, make)

    def denim_mat(self, name: str, base: str, dark: str):
        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            mott = m.noise(6.0, 3, 0.55, obj).outputs['Fac']
            colr = m.ramp(mott, [(0.35, dark), (0.65, base)])
            fine = m.noise(95.0, 3, 0.7, obj).outputs['Fac']
            m.bsdf(colr, 0.78, normal=m.bump(fine, 0.14, 0.02), sheen=0.3, spec=0.25)
            return m.mat
        return self.m.get(name, make)

    # --- building -------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('nami_skin', c['skin']),
            skin_d=mt.skin('nami_skin_d', c['skin_d']),
            top=self.stripe_mat('nami_top'),
            strap=mt.cloth('nami_strap', c['strap'], 0.7, 0.35),
            denim=self.denim_mat('nami_denim', c['denim'], c['denim_d']),
            cuff=self.denim_mat('nami_cuff', c['cuff'], '#6f92c8'),
            belt=mt.cloth('nami_belt', c['belt'], 0.5, 0.2),
            gold=mt.metal('nami_gold', c['gold'], 0.22),
            sandal=mt.glossy('nami_sandal', c['sandal'], 0.38, 0.35),
            sandal_d=mt.glossy('nami_sandal_d', c['sandal_d'], 0.45, 0.2),
            tattoo=mt.glossy('nami_tattoo', c['tattoo'], 0.5, 0.1),
            hair=mt.hair('nami_hair', c['hair_d'], c['hair_l'], 0.4),
        )
        self.torso()
        self.legs()
        self.arms()
        self.head_parts()

    @staticmethod
    def rb(z):
        """Torso half-width at chest-frame height z."""
        t = (z + 0.36) / 0.48
        return 0.194 - 0.024 * t + 0.012 * math.sin(math.pi * clamp(t))

    def torso(self):
        mm = self.mat
        rb = self.rb
        # skin at the neckline and the shoulders; the striped top over it, tucked into the jeans
        self.add('chestskin', sweep([Vector((0, 0, -0.1 + 0.22 * i / 6)) for i in range(7)], lambda t: rb(-0.1 + 0.22 * t) - 0.016, 24,
                                    cap0=False, squash=0.8), mm['skin'], 'chest')
        self.add('shoulders', ellipsoid(0.178, 0.142, 0.08, 26, 12, center=(0, 0, 0.1), zmin=-0.2), mm['skin'], 'chest')

        def top_r(z):
            r = rb(z) + 0.004
            return r - (r - 0.14) * sstep((-0.195 - z) / 0.06)

        def neckline(a):
            front = max(0.0, -math.sin(a))
            return 0.078 - 0.07 * sstep((front - 0.45) / 0.55)
        self.add('top', garment(-0.3, neckline, top_r, 40, 16, 0.8, 0.016), mm['top'], 'chest')
        # shoulder straps over the dome, front edge to back edge
        for sd in (1, -1):
            x = 0.105 * sd
            k = math.sqrt(max(0.0, 1.0 - (x / 0.19) ** 2))
            ry, rz = 0.152 * k, 0.09 * k
            pts = []
            for i in range(13):
                th = math.pi * i / 12
                pts.append(Vector((x, -ry * math.cos(th), 0.1 + rz * math.sin(th))))
            pts = [pts[0] + Vector((0.0, -0.004, -0.06))] + pts + [pts[-1] + Vector((0.0, 0.004, -0.04))]
            pts = polyline_segment(pts, 0.0, 1.0, 16)
            nrm = [Vector((0.0, p.y, p.z - 0.1)).normalized() if (p.z > 0.1) else Vector((0.0, math.copysign(1.0, p.y), 0.0)) for p in pts]
            self.add('strap', flat_sweep(pts, 0.024, lambda t, nrm=nrm: nrm[min(16, int(round(t * 16)))], 0.36, 10), mm['strap'], 'chest')
        # neck
        a = self.J('chest') @ Vector((0.0, 0.0, 0.1))
        b = self.J('neck') @ Vector((0.0, 0.0, 0.03))
        cc = self.J('head') @ Vector((0.0, 0.01, 0.12))
        self.add('neck', sweep(curve3(a, b, cc, 6), 0.062, 14), mm['skin'])
        # jeans seat, the belt and its buckle (hips frame)
        self.add('pelvis', superellipsoid(0.18, 0.15, 0.125, 2.4, 28, 16, center=(0, 0, -0.015)), mm['denim'], 'hips')
        self.add('belt', torus(0.196, 0.022, 40, 8, center=(0, 0, 0.07), squash=1.2), mm['belt'], 'hips', _sy(0.84))
        bm = T(0.0, -0.186, 0.07)
        self.add('buckle', superellipsoid(0.034, 0.012, 0.026, 3.5, 14, 8), mm['gold'], 'hips', bm)
        self.add('buckle_in', superellipsoid(0.02, 0.008, 0.013, 3.5, 12, 6, center=(0, -0.008, 0)), mm['belt'], 'hips', bm)

    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('jeans' + s_, hip, kn, an, lambda t: 0.104 - 0.024 * t + 0.008 * math.sin(math.pi * t), mm['denim'], 0.0, 0.86, 16, 14,
                      cap0=True, cap1=False)
            # the rolled cuff, lighter where the denim is turned up
            self.limb('cuff' + s_, hip, kn, an, lambda t: 0.088 + 0.004 * math.sin(math.pi * t), mm['cuff'], 0.8, 0.9, 16, 4, cap0=True, cap1=True)
            self.limb('ankle' + s_, hip, kn, an, 0.05, mm['skin'], 0.86, 1.0, 12, 4, cap0=False, cap1=True)
            # orange heeled sandal: the foot rides on a sole that rises to a block heel
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('foot' + s_, superellipsoid(0.066, 0.108, 0.042, 2.3, 20, 12, center=(0, -0.06, -0.082)), mm['skin'], None, fm)
            self.add('toes' + s_, ellipsoid(0.06, 0.05, 0.032, 16, 10, center=(0.0, -0.148, -0.108)), mm['skin'], None, fm)
            sole_m = fm @ T(0, -0.06, -0.128) @ R(9, 0, 0)
            self.add('sole' + s_, superellipsoid(0.08, 0.14, 0.016, 3.2, 22, 8), mm['sandal'], None, sole_m)
            self.add('heel' + s_, superellipsoid(0.036, 0.034, 0.03, 2.6, 14, 8, center=(0, 0.035, -0.132)), mm['sandal_d'], None, fm)
            self.add('toesole' + s_, superellipsoid(0.07, 0.05, 0.014, 3.0, 18, 6, center=(0, -0.16, -0.146)), mm['sandal_d'], None, fm)
            # straps: across the toes, and round the ankle
            self.add('toestrap' + s_, superellipsoid(0.066, 0.026, 0.026, 2.4, 18, 8, center=(0, -0.13, -0.098)), mm['sandal'], None, fm)
            self.add('anklestrap' + s_, torus(0.056, 0.011, 20, 6, center=(0, 0.0, -0.035)), mm['sandal'], None, fm)
            for q in (1, -1):
                pts = [Vector((0.05 * q, -0.01, -0.04)), Vector((0.062 * q, -0.05, -0.075)), Vector((0.05 * q, -0.1, -0.1))]
                self.add(f'sidestrap{q}{s_}', sweep(pts, 0.009, 6), mm['sandal'], None, fm)

    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, self.arm_r, mm['skin'], 0.0, 1.0, 12, 14, extend=0.02)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.1):
                self.add('hand' + nm + s_, mesh, mm['skin'], None, wm)
            if sd < 0:
                # gold bangles on her right wrist
                for k, t in enumerate((0.8, 0.865, 0.925)):
                    fr = self.limb_frame(sh, el, wr, t, sh)
                    r = self.arm_r(t) + 0.012
                    self.add(f'bangle{k}', torus(r, 0.0085 if k != 1 else 0.011, 22, 6), mm['gold'], None, fr @ R(6 * (k - 1), 0, 0))
            else:
                self.tattoo(sh, el, wr)

    @staticmethod
    def arm_r(t):
        return 0.05 - 0.009 * t + 0.004 * math.sin(math.pi * t)

    def tattoo(self, sh, el, wr):
        """Her blue tattoo, a pinwheel over a tangerine, wrapped onto the outside of the upper left arm."""
        mm = self.mat
        fr = self.limb_frame(sh, el, wr, 0.2, sh)
        xl, yl = fr.col[0].to_3d().normalized(), fr.col[1].to_3d().normalized()
        L = (self.P(el) - self.P(sh)).length + (self.P(wr) - self.P(el)).length

        def place(u, v):
            """u: across the arm (arc length, + towards the front), v: down the arm from the design centre."""
            t = 0.2 + v / L
            c = self.along(sh, el, wr, clamp(t))
            r = self.arm_r(t) + 0.0015
            phi = u / r + 0.85
            # outward (+X for the left arm) turning towards the front (-Y)
            return c + (xl * math.cos(phi) - yl * math.sin(phi)) * r

        acc = MeshAcc()
        # pinwheel: four curved blades around a hub, above
        cx, cz = 0.0, -0.018
        for k in range(4):
            a0 = k * math.pi / 2 + 0.3
            pts = []
            for i in range(9):
                s = i / 8
                a = a0 + 1.5 * s
                rr = 0.004 + 0.02 * math.sin(math.pi * min(1.0, s * 1.15)) ** 0.8
                pts.append(place(cx + math.cos(a) * rr, cz - math.sin(a) * rr))
            acc.add(sweep(pts, 0.0034, 6))
        acc.add(sweep([place(cx, cz + 0.0015), place(cx + 0.001, cz - 0.0015)], 0.0045, 6))
        # tangerine: a round fruit with a leaf, below
        tx, tz = 0.0, 0.024
        ring = [place(tx + math.cos(i / 16 * math.tau) * 0.013, tz + math.sin(i / 16 * math.tau) * 0.012) for i in range(17)]
        acc.add(sweep(ring, 0.0032, 6))
        leaf = [place(tx + 0.002, tz - 0.012), place(tx + 0.008, tz - 0.02), place(tx + 0.016, tz - 0.019)]
        acc.add(sweep(leaf, 0.0032, 6))
        self.add('tattoo', acc.mesh, mm['tattoo'], None)

    # --- head -------------------------------------------------------------------------------------
    def head_parts(self):
        c, mm = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        hv = [(x * (1 - 0.1 * max(0.0, (hc - z) / hz) ** 1.6), y - 0.02 * max(0.0, (hc - z) / hz) ** 2, z) for (x, y, z) in hv]
        self.add('head', (hv, hf), mm['skin'], 'head')
        ey, ep = self.EYE
        self.face(head, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(0.094, 0.124), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-31,
                  mouth_w=0.92, lid_col=c['skin'], skin=c['skin'], brow_pitch=21, lash_col=c['lash'])
        self.hair_cap()
        self.long_hair()

    # --- hair: the cap, a side part and swept bangs -------------------------------------------------
    def hair_cap(self):
        hair = self.mat['hair']
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))
        # hairline: high at the part over her right eye, low over her left temple where the bangs sweep
        edge = [(-180, -26), (-140, -24), (-112, -16), (-94, -12), (-80, 4), (-68, 22), (-52, 34), (-36, 42), (-18, 40), (0, 36),
                (18, 33), (34, 28), (48, 16), (60, 2), (74, -8), (94, -14), (116, -18), (140, -24), (180, -26)]

        def boundary(yaw):
            return interp(edge, yaw)

        def thickness(yaw, pitch, f):
            e = min(1.0, f / 0.2)
            crown = 0.022 + 0.046 * math.sin(math.pi * min(1.0, f * 1.1))
            ridge = 0.5 + 0.5 * math.cos(math.radians(yaw) * 15 + 0.4)
            # a shallow groove along the parting, from the forehead back over the crown
            groove = math.exp(-((yaw + 32.0) / 6.0) ** 2) * sstep((pitch - 34.0) / 10.0) * (1.0 - sstep((pitch - 80.0) / 6.0))
            return 0.012 + crown * e + 0.012 * ridge * e * (1.0 - sstep((f - 0.45) / 0.4)) - 0.018 * groove

        v, f, tp = hair_shell(hs, boundary, thickness, 144, 24)
        self.add('haircap', (v, f), hair, 'head', tip=[0.2 + 0.5 * q for q in tp])

        acc = MeshAcc()

        def lock(y0, p0, y1, p1, w0, lift0, lift1, bulge=0.012, ease=1.6, fall=1.3, flat=0.42, t0=0.25):
            pts, nrm = [], []
            n = 14
            for i in range(n):
                t = i / (n - 1)
                yaw = y0 + (y1 - y0) * (1 - (1 - t) ** ease)
                pitch = p0 + (p1 - p0) * t ** fall
                pos, nn = hs.point(yaw, pitch, lift0 + (lift1 - lift0) * t + bulge * math.sin(math.pi * t))
                pts.append(pos)
                nrm.append(nn)
            mesh = flat_sweep(pts, lambda t: w0 * (1 - 0.94 * t ** 1.5) + 0.003, lambda t: nrm[min(n - 1, int(round(t * (n - 1))))], flat, 12)
            acc.add(mesh, flat_tip(n, 12, len(mesh[0]), t0, 0.9))

        # swept bangs: from the part (over her right eye) across the forehead and down past her left eye
        lock(-22, 66, 66, 24, 0.11, 0.05, 0.032, 0.02, 1.7, 1.5)
        lock(-30, 64, 54, 0, 0.13, 0.058, 0.018, 0.028, 1.8, 1.5)
        lock(-27, 62, 36, 14, 0.115, 0.056, 0.018, 0.024, 1.7, 1.4)
        lock(-33, 60, 14, 22, 0.1, 0.054, 0.016, 0.018, 1.5, 1.3)
        # the smaller side of the part, swept to her right temple
        lock(-37, 62, -62, 20, 0.095, 0.054, 0.02, 0.016, 1.3, 1.1)
        # face-framing locks down the cheeks to the chin, flicking out at the ends
        for sd, y0 in ((1, 60), (-1, -62)):
            pts, nrm = [], []
            n = 12
            for i in range(n):
                t = i / (n - 1)
                yaw = sd * (abs(y0) + 6 * t + 8 * t ** 3)
                pitch = 26 - 70 * t
                pos, nn = hs.point(yaw, pitch, 0.014 + 0.012 * t + 0.02 * t ** 3)
                pts.append(pos)
                nrm.append(nn)
            mesh = flat_sweep(pts, lambda t: 0.066 * (1 - 0.7 * t ** 1.4) + 0.006, lambda t, nrm=nrm: nrm[min(n - 1, int(round(t * (n - 1))))], 0.42, 12)
            acc.add(mesh, flat_tip(n, 12, len(mesh[0]), 0.3, 1.0))
        self.add('bangs', acc.mesh, hair, 'head', tip=acc.tip)

    # --- hair: the long draped locks ---------------------------------------------------------------
    def colliders(self):
        hx, hy, hz, hc = self.HEAD
        Hm = self.J('head') @ T(0.0, 0.01, hc)
        Cm = self.J('chest')
        Pm = self.J('hips') @ T(0.0, 0.0, -0.04)
        caps = [(self.J('chest') @ Vector((0.0, 0.0, 0.08)), self.J('head') @ Vector((0.0, 0.0, 0.16)), 0.09)]
        arms = []
        for s_ in ('L', 'R'):
            arms.append((self.P('shoulder' + s_), self.P('elbow' + s_), 0.08))
            arms.append((self.P('elbow' + s_), self.P('wrist' + s_), 0.072))
            arms.append((self.J('wrist' + s_) @ Vector((0.0, 0.0, -0.03)), self.J('wrist' + s_) @ Vector((0.0, 0.0, -0.13)), 0.09))
            caps.append((self.P('hip' + s_), self.P('knee' + s_), 0.125))
            caps.append((self.P('knee' + s_), self.P('ankle' + s_), 0.11))
        back = (Cm.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
        return dict(head=(Hm, Hm.inverted(), Vector((hx + 0.04, hy + 0.04, hz + 0.035))), chest=(Cm, Cm.inverted()),
                    pelvis=(Pm, Pm.inverted(), Vector((0.2, 0.17, 0.16))), caps=caps, arms=arms, back=back)

    def collide(self, p: Vector, cl, head_extra: float = 0.0) -> Vector:
        # head (an inflated ellipsoid, pushed out radially)
        M, Mi, r = cl['head']
        q = Mi @ p
        rr = Vector((r.x + head_extra, r.y + head_extra, r.z + head_extra))
        e = Vector((q.x / rr.x, q.y / rr.y, q.z / rr.z)).length
        if e < 1.0:
            p = M @ (q / max(e, 1e-6))
        # torso: an elliptic cylinder in the chest frame with a domed top over the shoulders
        Cm, Ci = cl['chest']
        q = Ci @ p
        rx, ry = 0.228, 0.19
        if -0.42 < q.z < 0.1:
            e = math.hypot(q.x / rx, q.y / ry)
            if e < 1.0:
                s = 1.0 / max(e, 1e-6)
                p = Cm @ Vector((q.x * s, q.y * s, q.z))
        elif q.z >= 0.1:
            d = Vector((q.x / rx, q.y / ry, (q.z - 0.1) / 0.11))
            e = d.length
            if e < 1.0:
                s = 1.0 / max(e, 1e-6)
                p = Cm @ Vector((q.x * s, q.y * s, 0.1 + (q.z - 0.1) * s))
        # pelvis
        M, Mi, r = cl['pelvis']
        q = Mi @ p
        e = Vector((q.x / r.x, q.y / r.y, q.z / r.z)).length
        if e < 1.0:
            p = M @ (q / max(e, 1e-6))
        # neck, arms, hands, legs
        for a, b, rad in cl['caps']:
            c = seg_closest(p, a, b)
            d = p - c
            if d.length < rad:
                if d.length < 1e-6:
                    d = Vector((0.0, 1.0, 0.0))
                p = c + d.normalized() * rad
        # arms and hands push the hair back behind them (hair hangs behind the arms)
        bk = cl['back']
        for a, b, rad in cl['arms']:
            c = seg_closest(p, a, b)
            w = c - p
            if w.length < rad:
                ax = (b - a).normalized()
                bb = bk - ax * bk.dot(ax)
                bb = bb.normalized() if bb.length > 1e-4 else bk
                wp = w - ax * w.dot(ax)
                tc = wp.dot(bb)
                h2 = max(0.0, wp.dot(wp) - tc * tc)
                if h2 < rad * rad:
                    p = p + bb * (tc + math.sqrt(rad * rad - h2))
        if p.z < 0.025:
            p = Vector((p.x, p.y, 0.025))
        return p

    def long_hair(self):
        hair = self.mat['hair']
        hx, hy, hz, hc = self.HEAD
        ex = self.pose.get('extra', {})
        fly = clamp(ex.get('scarf', 0.0))
        wave = ex.get('wave', 0.0)
        sway = ex.get('sway', 0.0)
        H = self.J('head')
        Cm = self.J('chest')
        Hr = H.to_3x3()
        Cr = Cm.to_3x3()
        back = (Cr @ Vector((0.0, 1.0, 0.0))).normalized()
        side = (Cr @ Vector((1.0, 0.0, 0.0))).normalized()
        down = Vector((0.0, 0.0, -1.0))
        cl = self.colliders()
        hs = HeadShape(hx + 0.04, hy + 0.04, hz + 0.035, center=(0.0, 0.01, hc))
        airborne = not self.pose.get('ground', True) and not self.pose.get('sit', False)
        up = Vector((0.0, 0.0, 1.0))
        # (yaw, root pitch, length, root half-width, layer)
        LOCKS = [(180, 46, 1.02, 0.095, 0.014), (162, 44, 1.0, 0.092, 0.0), (-162, 44, 1.0, 0.092, 0.0), (144, 42, 0.98, 0.09, 0.014),
                 (-144, 42, 0.98, 0.09, 0.014), (126, 38, 0.95, 0.088, 0.0), (-126, 38, 0.95, 0.088, 0.0), (109, 32, 0.9, 0.084, 0.012),
                 (-109, 32, 0.9, 0.084, 0.012), (93, 26, 0.84, 0.08, 0.0), (-93, 26, 0.84, 0.08, 0.0), (78, 22, 0.76, 0.074, 0.01),
                 (-78, 22, 0.76, 0.074, 0.01)]
        acc = MeshAcc()
        N = 22
        # the wind of running streams the hair out behind; in the air it just lifts, so it stays around her shoulders
        wind = fly * (0.55 if not airborne else 0.16)
        for li, (yaw, pitch, length, w0, layer) in enumerate(LOCKS):
            sd = 1.0 if yaw > 0 else (-1.0 if yaw < 0 else 0.0)
            pos, n = hs.point(yaw, pitch, layer)
            p = H @ pos
            # start down along the scalp
            pos2, _ = hs.point(yaw, pitch - 8, layer)
            d = (Hr @ (pos2 - pos)).normalized()
            seg = length / N
            pts = [p.copy()]
            ph = wave + li * 0.4
            for i in range(1, N + 1):
                t = i / N
                # pull in towards the upper back (a line behind the spine), stream out behind with the wind
                q_back = Cm @ Vector((0.0, 0.1, 0.0))
                to_back = q_back - p
                to_back.z = 0.0
                inward = to_back.normalized() if to_back.length > 1e-5 else Vector((0.0, 0.0, 0.0))
                outward = -inward
                wob = math.sin(ph + t * 3.4) * (0.04 + 0.12 * wind) * t
                g = (down * (1.0 - 0.55 * wind) + inward * (0.3 * (1.0 - wind) * sstep(t / 0.4)) + back * (0.1 + 0.95 * wind)
                     + side * (0.1 * sd * (1.0 - 0.5 * wind) + wob * 0.5 + 0.08 * sway) + up * (wob * 0.4))
                if airborne:
                    # floating up and out at the top of a jump
                    g += (up * 0.34 + outward * 0.1) * fly * sstep(t / 0.5)
                g.normalize()
                k = 0.32
                d = (d * (1.0 - k) + g * k).normalized()
                q = self.collide(p + d * seg, cl, layer)
                d = (q - p).normalized()
                p = p + d * seg
                p = self.collide(p, cl, layer)
                pts.append(p.copy())
            # relax the rope a little (the root stays put), then re-collide
            for _ in range(2):
                sm = [pts[0]] + [(pts[i - 1] + pts[i] * 2.0 + pts[i + 1]) * 0.25 for i in range(1, len(pts) - 1)] + [pts[-1]]
                pts = [pts[0]] + [self.collide(q, cl, layer) for q in sm[1:]]
            # big soft waves across the lock and an outward curl at the end
            out_pts, nrms = [], []
            for i, q in enumerate(pts):
                t = i / N
                tg = (pts[min(N, i + 1)] - pts[max(0, i - 1)]).normalized()
                axis = Cm @ Vector((0.0, 0.02, 0.0))
                o = q - axis
                o = o - tg * o.dot(tg)
                if o.length < 1e-5:
                    o = back.copy()
                o.normalize()
                lat = tg.cross(o).normalized()
                env = sstep((t - 0.18) / 0.3)
                amp = 0.05 * env * (1.0 - 0.45 * wind)
                wv = math.sin((t - 0.18) * 2.3 * math.pi + 0.25 * li)
                curl = 0.11 * (1.0 - 0.6 * wind) * sstep((t - 0.7) / 0.3) ** 1.3
                out_pts.append(q + lat * (amp * wv) + o * (0.022 * env * math.cos((t - 0.18) * 2.3 * math.pi) + curl))
                nrms.append(o)

            def width(t, w0=w0):
                return w0 * (1.0 + 0.45 * math.sin(math.pi * min(1.0, t * 1.25))) * (1.0 - 0.42 * sstep((t - 0.62) / 0.38)) + 0.012
            mesh = flat_sweep(out_pts, width, lambda t, nrms=nrms: nrms[min(N, int(round(t * N)))], 0.56, 12)
            acc.add(mesh, flat_tip(N + 1, 12, len(mesh[0]), 0.35, 1.0))
        self.add('longhair', acc.mesh, hair, None, tip=acc.tip)

    # --- face (a copy of Hero.face with lash flicks; happy grins become a wink) ------------------------
    def face(self, head: HeadShape, joint: str, *, eye_yaw=27.0, eye_pitch=0.0, eye_size=(0.085, 0.105), iris='#6b3a1e',
             brow_col='#4a2c1a', mouth_pitch=-24.0, mouth_w=1.0, lid_col=None, nose=True, skin=None, blush=True, brow_pitch=19.0,
             lash_col='#2a1a14'):
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        eyes, mouth, brows = f['eyes'], f['mouth'], f['brows']
        if eyes == 'happy' and mouth == 'grin':
            eyes = 'wink'
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
                    ir = 0.86 * ew * (0.8 if kind == 'wide' else 1.0)
                    off = Vector((lx * ew * 0.22 - 0.1 * ew * side, -ed * 0.9, lz * eh * 0.2 - eh * 0.04))
                    self.feat(f'iris{name}', ellipsoid(ir, ed * 0.22, ir * 1.1, 20, 10, center=off), irm, joint, head, fr)
                    pr = ir * 0.56
                    self.feat(f'pupil{name}', ellipsoid(pr, ed * 0.2, pr * 1.12, 16, 8, center=off + Vector((0.0, -ed * 0.12, 0.0))), dark, joint, head, fr)
                    h1 = off + Vector((-ir * 0.38, -ed * 0.3, ir * 0.42))
                    self.feat(f'shine{name}', ellipsoid(ir * 0.34, 0.004, ir * 0.36, 10, 6, center=h1), shine, joint, head, fr)
                    h2 = off + Vector((ir * 0.4, -ed * 0.3, -ir * 0.4))
                    self.feat(f'shine2{name}', ellipsoid(ir * 0.13, 0.004, ir * 0.13, 8, 5, center=h2), shine, joint, head, fr)
                lash_pts = [Vector((math.sin(a) * ew * 1.02, -ed * 0.55, math.cos(a) * eh * 1.0)) for a in [(-1 + 2 * i / 12) * 1.25 for i in range(13)]]
                self.feat(f'lash{name}', sweep(lash_pts, lambda t: 0.007 + 0.008 * math.sin(math.pi * t), 6), lash, joint, head, fr)
                # two lash flicks at the outer corner
                oc = Vector((math.sin(1.25) * ew * 1.02 * side, -ed * 0.55, math.cos(1.25) * eh))
                for k, (dx, dz, ln) in enumerate(((0.9, 0.55, 0.036), (1.0, 0.1, 0.03))):
                    dv = Vector((dx * side, 0.0, dz)).normalized()
                    pts = [oc + Vector((0.0, 0.0, -0.004 * k)) + dv * (ln * s) + Vector((0.0, 0.0, 0.006 * s * s)) for s in (0.0, 0.33, 0.66, 1.0)]
                    self.feat(f'flick{k}{name}', sweep(pts, lambda t: 0.0075 * (1 - t) + 0.0015, 6), lash, joint, head, fr)
                lid = {'sad': 0.42, 'determined': 0.36, 'half': 0.5}.get(kind)
                if lid and lid_col:
                    lidm = mt.skin(f'lid_{lid_col}', lid_col)
                    tilt = {'sad': -16 * side, 'determined': 14 * side}.get(kind, 0)
                    lid_mesh = ellipsoid(ew * 1.12, ed * 1.25, eh * 1.1, 20, 10, zmin=1 - lid * 2)
                    self.feat(f'lid{name}', lid_mesh, lidm, joint, head, fr @ R(0, tilt, 0) @ T(0, -0.004, 0))
            elif kind == 'happy':
                pts = arc_points(ew * 1.7, -eh * 0.42, 12, y=-0.01)
                self.feat(f'happy{name}', sweep([p + Vector((0, 0, -eh * 0.15)) for p in pts], 0.0125, 8), lash, joint, head, fr)
                oc = Vector((ew * 0.85 * side, -0.01, -eh * 0.15))
                dv = Vector((0.8 * side, 0.0, 0.45)).normalized()
                self.feat(f'hflick{name}', sweep([oc + dv * (0.03 * s) for s in (0.0, 0.5, 1.0)], lambda t: 0.008 * (1 - t) + 0.002, 6), lash, joint,
                          head, fr)
            elif kind == 'closed':
                pts = arc_points(ew * 1.6, eh * 0.22, 12, y=-0.01)
                self.feat(f'closed{name}', sweep(pts, 0.0115, 8), lash, joint, head, fr)
            b_pitch = eye_pitch + brow_pitch + (4 if brows == 'up' else 0) + (2 if eyes == 'wide' else 0)
            roll = {'neutral': 0, 'up': -4, 'worried': 16, 'angry': -18, 'determined': -12, 'sad': 14}.get(brows, 0) * side
            bf = head.frame(yaw * 1.02, b_pitch, 0.004, roll)
            bpts = arc_points(ew * 1.5, -0.014, 8)
            self.feat(f'brow{name}', sweep(bpts, lambda t: 0.009 + 0.006 * math.sin(math.pi * t ** 0.8), 8), browm, joint, head, bf)
        skin_m = mt.skin(f'skin_{skin}', skin) if skin else None
        if nose and skin_m:
            nf = head.frame(0, eye_pitch - 13, -0.004)
            self.feat('nose', ellipsoid(0.025, 0.022, 0.02, 14, 8), skin_m, joint, head, nf)
        if blush:
            bl = mt.alpha('blush', '#ff8a8a', 0.35)
            for side in (1, -1):
                bf = head.frame(side * (eye_yaw + 13), eye_pitch - 16, 0.003)
                self.feat('blush', ellipsoid(0.048, 0.004, 0.028, 14, 6), bl, joint, head, bf)
        mf = head.frame(0, mouth_pitch, 0.0)
        w = 0.12 * mouth_w
        if mouth == 'smile':
            # a confident closed smile, one corner a touch higher
            pts = [Vector((x, y, z + 0.006 * (x / (w / 2)))) for (x, y, z) in arc_points(w, 0.032, 12, y=-0.006)]
            self.feat('mouth', sweep(pts, lambda t: 0.0085 + 0.004 * math.sin(math.pi * t), 8), mouth_m, joint, head, mf)
        elif mouth in ('grin', 'open', 'laugh'):
            hh = {'grin': 0.05, 'open': 0.06, 'laugh': 0.072}[mouth]
            ww = w * (1.05 if mouth == 'grin' else 0.95)

            def curl(mesh, k=2.2):
                v, fc = mesh
                return [(x, y, z + k * x * x) for (x, y, z) in v], fc
            self.feat('mouth', curl(ellipsoid(ww / 2, 0.02, hh, 22, 12, zmax=0.15)), mouth_m, joint, head, mf @ T(0, 0.002, 0.006))
            self.feat('tongue', curl(ellipsoid(ww * 0.3, 0.012, hh * 0.45, 14, 8, center=(0, -0.008, -hh * 0.6))), tongue, joint, head, mf)
            if mouth != 'laugh':
                self.feat('teeth', curl(ellipsoid(ww * 0.42, 0.01, 0.012, 14, 6, center=(0, -0.012, 0.0))), teeth, joint, head, mf)
        elif mouth == 'o':
            self.feat('mouth', ellipsoid(0.026, 0.018, 0.032, 16, 10), mouth_m, joint, head, mf @ T(0, 0.004, -0.004))
        elif mouth == 'gasp':
            self.feat('mouth', ellipsoid(0.038, 0.02, 0.052, 16, 10), mouth_m, joint, head, mf @ T(0, 0.004, -0.012))
            self.feat('tongue', ellipsoid(0.02, 0.01, 0.018, 12, 6, center=(0, -0.012, -0.043)), tongue, joint, head, mf)
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


def _sy(k: float):
    return Matrix.Diagonal((1.0, k, 1.0, 1.0))
