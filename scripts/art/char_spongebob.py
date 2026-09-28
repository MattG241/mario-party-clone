"""SpongeBob SquarePants as a chibi 3D hero (fan-made, private/non-commercial), loaded by characters.py as
class `Spongebob`, built on the shared Hero structure (see char_models.py).

The body is the head: a rounded yellow box (a tapered superellipsoid, slightly wider at the top, with a
soft low-frequency wobble) covered in darker yellow-green pores (a Voronoi mask in the material). The
face sits on its front: huge round eyes with blue irises and three lashes each, a long nose, a wide grin
with two buck teeth, rosy cheeks with freckles. Below it a white shirt band with a collar and a red tie,
brown square pants with a black belt, thin yellow legs in white socks striped red and blue, shiny black
shoes, and thin yellow arms from short white sleeves.

Skeleton: no neck and a short torso. The sponge is carried by the `head` joint (sitting just above the
shirt), and the shoulders hang off the sponge's sides, so the arms move with the box. The poses' neck /
head / chest rotations are scaled down (DampedSkeleton) so the box sways and leans rather than bending
like a neck. HEAD[3:5] points at the face centre (between the eyes and the nose) for the portraits.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector, noise

import lib
from lib import col
from char_rig import I4, HeadShape, R, Skeleton, T, arc_points, ellipsoid, flat_sweep, superellipsoid, sweep
from char_models import DEFAULT_FACE, Hero, hand_mitten


def _clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return max(a, min(b, x))


class DampedSkeleton(Skeleton):
    """The hero's skeleton with some joints' pose rotations scaled before solving (characters.py solves
    every pose through hero.skel, so the anchors and face point follow). damp maps a joint to
    (pitch-down factor, pitch-up factor, roll factor, yaw factor)."""

    def __init__(self, base: Skeleton, damp: dict):
        self.parent, self.offset, self.order = base.parent, base.offset, base.order
        self.damp = damp

    def solve(self, local: dict, root=I4, world_override=None):
        loc = dict(local)
        for j, (kd, ku, ky, kz) in self.damp.items():
            if j in loc:
                e = loc[j].to_euler('XYZ')
                x = e.x * (kd if e.x > 0 else ku)
                loc[j] = R(math.degrees(x), math.degrees(e.y) * ky, math.degrees(e.z) * kz)
        return super().solve(loc, root, world_override)


# ------------------------------------------------------------------------------------------
# The sponge
class Sponge:
    """A tapered rounded box from z0 to z1 (head frame): half width w0 at the bottom and w1 at the top,
    half depth d, superellipsoid exponent p, with a soft wobble (stronger round the silhouette of the
    front / back faces). surf(dir) gives the surface point along a direction from the centre, so the
    mesh and the wrapped facial features agree."""

    def __init__(self, w0, w1, d, z0, z1, p=5.0, amp=0.05, seed=3.0):
        self.w0, self.w1, self.d, self.z0, self.z1, self.p, self.amp = w0, w1, d, z0, z1, p, amp
        self.c = Vector((0.0, 0.0, (z0 + z1) / 2))
        self.h = (z1 - z0) / 2
        self.wm = (w0 + w1) / 2
        self.off = Vector((seed * 1.37, seed * 2.11, seed * 0.73))

    def width(self, z: float) -> float:
        t = (z - self.z0) / (self.z1 - self.z0)
        return self.w0 + (self.w1 - self.w0) * t

    def F(self, q: Vector) -> float:
        w = max(1e-4, self.width(q.z))
        p = self.p
        return (abs(q.x) / w) ** p + (abs(q.y) / self.d) ** p + (abs(q.z - self.c.z) / self.h) ** p

    def ray(self, d: Vector) -> float:
        lo, hi = 0.0, 2.0
        for _ in range(34):
            mid = (lo + hi) * 0.5
            if self.F(self.c + d * mid) < 1.0:
                lo = mid
            else:
                hi = mid
        return lo

    def wob(self, d: Vector) -> float:
        side = 1.0 - _clamp(abs(d.y) * 2.2 - 0.3)
        n = noise.noise(d * 2.4 + self.off) + 0.45 * noise.noise(d * 5.1 + self.off * 1.7)
        return self.amp * (0.3 + 0.7 * side) * n

    def surf(self, d: Vector) -> Vector:
        d = d.normalized()
        return self.c + d * (self.ray(d) * (1.0 + self.wob(d)))

    def normal(self, d: Vector) -> Vector:
        d = d.normalized()
        e1 = d.cross(Vector((0.0, 0.0, 1.0)))
        if e1.length < 1e-6:
            e1 = Vector((1.0, 0.0, 0.0))
        e1.normalize()
        e2 = d.cross(e1).normalized()
        eps = 0.01
        a = self.surf(d + e1 * eps) - self.surf(d - e1 * eps)
        b = self.surf(d + e2 * eps) - self.surf(d - e2 * eps)
        n = a.cross(b).normalized()
        if n.dot(d) < 0:
            n = -n
        return n

    def mesh(self, seg: int = 72, rings: int = 44):
        verts, faces = ellipsoid(1.0, 1.0, 1.0, seg, rings)
        e = 2.0 / self.p
        out = []
        for (x, y, z) in verts:
            def sg(v):
                return math.copysign(abs(v) ** e, v)
            zz = self.c.z + self.h * sg(z)
            q = Vector((self.width(zz) * sg(x), self.d * sg(y), zz))
            r = q - self.c
            dn = r.normalized() if r.length > 1e-9 else Vector((0.0, 0.0, 1.0))
            out.append(tuple(self.c + r * (1.0 + self.wob(dn))))
        return out, faces

    def front(self, x: float, z: float) -> Vector:
        """Direction from the centre towards the point (x, z) of the front face."""
        return (Vector((x, -self.d, z)) - self.c).normalized()

    def frame(self, x: float, z: float, lift: float = 0.0, roll: float = 0.0) -> Matrix:
        """A matrix placing a feature (modelled facing -Y, up +Z) on the front face at (x, z)."""
        d = self.front(x, z)
        pos = self.surf(d)
        n = self.normal(d)
        fwd = -n
        xv = fwd.cross(Vector((0.0, 0.0, 1.0)))
        if xv.length < 1e-6:
            xv = Vector((1.0, 0.0, 0.0))
        xv.normalize()
        zv = xv.cross(fwd).normalized()
        m = Matrix((xv, fwd, zv)).transposed().to_4x4()
        m.translation = pos + n * lift
        return m @ Matrix.Rotation(math.radians(roll), 4, 'Y')

    def conform(self, verts, p0: Vector, n0: Vector):
        """Wrap a flat feature (modelled on the tangent plane at p0, normal n0) onto the surface."""
        out = []
        for v in verts:
            p = Vector(v)
            h = (p - p0).dot(n0)
            u = p - n0 * h
            d = (u - self.c).normalized()
            out.append(tuple(self.surf(d) + self.normal(d) * h))
        return out


# ------------------------------------------------------------------------------------------
# Materials
def sponge_mat(mats, name: str, base: str, base2: str, hole: str, deep: str, scale: float = 4.3, density: float = 0.55):
    """Sponge: bright yellow with soft tone blotches, a fine spongy bump and scattered round pores (a
    Voronoi cell mask: some cells get a hole, darker and yellow-green towards its middle, recessed).
    Fewer pores across the middle of the face. Object coordinates of a part in the head frame."""
    def make(n):
        m = lib.NT(n)
        obj = m.node('ShaderNodeTexCoord').outputs['Object']
        sp = m.sep(obj)
        vor = m.node('ShaderNodeTexVoronoi')
        vor.inputs['Scale'].default_value = scale
        vor.inputs['Randomness'].default_value = 0.85
        m.link(obj, vor.inputs['Vector'])
        dist = vor.outputs['Distance']
        rnd = m.sep(vor.outputs['Color'])
        # face zone: front, central, eye-to-mouth height
        fz = m.math('MULTIPLY', m.maprange(sp[1], -0.08, -0.14), m.maprange(m.math('ABSOLUTE', sp[0]), 0.4, 0.3))
        fz = m.math('MULTIPLY', fz, m.math('MULTIPLY', m.maprange(sp[2], 0.26, 0.34), m.maprange(sp[2], 0.98, 0.9)))
        dens = m.math('SUBTRACT', density, m.math('MULTIPLY', fz, density * 0.8))
        on = m.math('LESS_THAN', rnd[0], dens)
        radius = m.math('ADD', 0.16, m.math('MULTIPLY', rnd[1], 0.24))
        rel = m.math('DIVIDE', dist, radius)
        holef = m.math('MULTIPLY', on, m.maprange(rel, 1.0, 0.93))
        depth = m.math('MULTIPLY', on, m.maprange(rel, 0.88, 0.25))
        tone = m.noise(3.0, 3, 0.5, obj)
        c = m.mix(m.maprange(tone.outputs['Fac'], 0.42, 0.68), col(base), col(base2))
        inner = m.mix(depth, col(hole), col(deep))
        c = m.mix(holef, c, inner)
        fine = m.noise(42.0, 3, 0.6, obj)
        h = m.math('ADD', m.math('MULTIPLY', fine.outputs['Fac'], 0.25), m.math('MULTIPLY', m.math('ADD', holef, depth), -0.5))
        nrm = m.bump(h, 0.5, 0.02)
        m.bsdf(c, 0.64, normal=nrm, sheen=0.35, spec=0.3)
        return m.mat
    return mats.get(name, make)


def ring_band(rx, ry, prof, seg=64, p=2.0):
    """A closed band around the Z axis following a superellipse (rx, ry, exponent p). `prof` is a closed
    cross-section [(dr, z), ...]: the outer side from bottom to top, then back down the inside."""
    verts, faces = [], []
    n = len(prof)
    e = 2.0 / p
    for i in range(seg):
        a = i / seg * math.tau
        ca, sa = math.cos(a), math.sin(a)
        ex, ey = math.copysign(abs(ca) ** e, ca), math.copysign(abs(sa) ** e, sa)
        for dr, z in prof:
            verts.append((ex * rx + ca * dr, ey * ry + sa * dr, z))
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(n):
            j2 = (j + 1) % n
            faces.append((i * n + j, i2 * n + j, i2 * n + j2, i * n + j2))
    return verts, faces


def band_prof(z0: float, z1: float, bulge: float = 0.008, inner: float = -0.02, k: int = 6):
    prof = []
    for j in range(k + 1):
        v = j / k
        prof.append((bulge * math.sin(math.pi * v) ** 0.5, z0 + (z1 - z0) * v))
    prof += [(inner, z1 - 0.004), (inner, z0 + 0.004)]
    return prof


def strip(top, bot, x0, x1, nx=24, ny=5, h=0.004, rim=-0.002):
    """A flat decal between two curves z = top(x) and z = bot(x), x0..x1 (vertices (x, -h, z), facing -Y)."""
    verts, faces = [], []
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        zt, zb = top(x), bot(x)
        edge_x = min(i, nx - i) == 0
        for j in range(ny + 1):
            edge = edge_x or j in (0, ny)
            verts.append((x, -(rim if edge else h), zt + (zb - zt) * j / ny))
    for i in range(nx):
        for j in range(ny):
            a = i * (ny + 1) + j
            b = (i + 1) * (ny + 1) + j
            faces.append((a, b, b + 1, a + 1))
    return verts, faces


# ------------------------------------------------------------------------------------------
class Spongebob(Hero):
    """SpongeBob SquarePants: a porous yellow box with a big-eyed buck-tooth grin, white shirt, red tie,
    brown square pants, striped socks and shiny black shoes."""

    key = 'spongebob'
    ankle_h = 0.12
    hip_h = 0.6
    spine = 0.05
    chest = 0.07
    neck = 0.0
    head_up = 0.04
    shoulder = (0.462, 0.0, 0.25)  # on the sponge's sides (head frame)
    upper_arm = 0.21
    forearm = 0.2
    hip_w = 0.16
    thigh = 0.21
    shin = 0.23
    sit_h = 0.14

    # sponge (head frame): half widths bottom / top, half depth, bottom / top height
    BOX = (0.45, 0.5, 0.18, 0.03, 1.15)
    HEAD = (0.5, 0.18, 0.56, 0.66, -0.18)  # rx, ry, rz, face centre height and depth (the front face)
    C = dict(yellow='#f8e43c', yellow2='#ecd72c', hole='#b0b128', deep='#6f7c18', skin='#f6e03e', shirt='#f7f7f2',
             tie='#d8262b', tie_d='#b01d23', pants='#9c5f2a', pants_d='#7e4a1f', belt='#1c1c1f', sock='#f8f8f4', stripe_r='#dc3030',
             stripe_b='#2f6ad8', shoe='#141418', white='#fbfbf8', iris='#4aa8e6', pupil='#0e0e12', lash='#141414',
             mouth='#5e1a18', tongue='#e8707c', teeth='#fffdf5', cheek='#f08c84', freckle='#c4574f')

    def __init__(self, mats):
        self.m = mats
        base = Skeleton([
            ('hips', None, (0.0, 0.0, self.hip_h)),
            ('spine', 'hips', (0.0, 0.0, self.spine)),
            ('chest', 'spine', (0.0, 0.0, self.chest)),
            ('neck', 'chest', (0.0, 0.0, self.neck)),
            ('head', 'neck', (0.0, 0.0, self.head_up)),
            ('shoulderL', 'head', self.shoulder),
            ('elbowL', 'shoulderL', (0.0, 0.0, -self.upper_arm)),
            ('wristL', 'elbowL', (0.0, 0.0, -self.forearm)),
            ('shoulderR', 'head', (-self.shoulder[0], self.shoulder[1], self.shoulder[2])),
            ('elbowR', 'shoulderR', (0.0, 0.0, -self.upper_arm)),
            ('wristR', 'elbowR', (0.0, 0.0, -self.forearm)),
            ('hipL', 'hips', (self.hip_w, 0.0, -0.04)),
            ('kneeL', 'hipL', (0.0, 0.0, -self.thigh)),
            ('ankleL', 'kneeL', (0.0, 0.0, -self.shin)),
            ('hipR', 'hips', (-self.hip_w, 0.0, -0.04)),
            ('kneeR', 'hipR', (0.0, 0.0, -self.thigh)),
            ('ankleR', 'kneeR', (0.0, 0.0, -self.shin)),
        ])
        # the box sways and leans; it does not nod like a head on a neck
        self.skel = DampedSkeleton(base, {'neck': (0.25, 0.25, 0.3, 0.3), 'head': (0.35, 0.35, 0.4, 0.4),
                                          'chest': (0.7, 0.7, 0.6, 0.45), 'spine': (0.7, 0.7, 0.6, 0.45)})
        self.parts = []
        self.w = {}
        self.pose = {}
        self.sponge = Sponge(*self.BOX)

    def head_top(self) -> float:
        return self.BOX[4] + 0.08

    # --- building -----------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            sponge=sponge_mat(mt, 'sb_sponge', c['yellow'], c['yellow2'], c['hole'], c['deep']),
            skin=mt.skin('sb_skin', c['skin']),
            lid=mt.skin('sb_lid', c['yellow']),
            shirt=mt.cloth('sb_shirt', c['shirt'], 0.72, 0.3, 0.06),
            tie=mt.cloth('sb_tie', c['tie'], 0.6, 0.35, 0.05),
            tie_d=mt.cloth('sb_tie_d', c['tie_d'], 0.6, 0.35),
            pants=mt.cloth('sb_pants', c['pants'], 0.74, 0.35, 0.12, 50),
            pants_d=mt.cloth('sb_pants_d', c['pants_d'], 0.74, 0.3),
            belt=mt.glossy('sb_belt', c['belt'], 0.4, 0.3),
            sock=mt.cloth('sb_sock', c['sock'], 0.8, 0.3),
            stripe_r=mt.cloth('sb_stripe_r', c['stripe_r'], 0.7, 0.3),
            stripe_b=mt.cloth('sb_stripe_b', c['stripe_b'], 0.7, 0.3),
            shoe=mt.glossy('sb_shoe', c['shoe'], 0.18, 0.9),
            white=mt.glossy('sb_eye_white', c['white'], 0.2, 0.7),
            iris=mt.glossy('sb_iris', c['iris'], 0.22, 0.8),
            pupil=mt.glossy('sb_pupil', c['pupil'], 0.25, 0.9),
            shine=mt.emit('sb_shine', '#ffffff', 3.0),
            lash=mt.glossy('sb_lash', c['lash'], 0.4, 0.2),
            mouth=mt.glossy('sb_mouth', c['mouth'], 0.4, 0.2),
            tongue=mt.glossy('sb_tongue', c['tongue'], 0.35, 0.3),
            teeth=mt.glossy('sb_teeth', c['teeth'], 0.25, 0.4),
            cheek=mt.skin('sb_cheek', c['cheek']),
            freckle=mt.skin('sb_freckle', c['freckle']),
        )
        self.body()
        self.legs()
        self.arms()
        self.face()

    def sfeat(self, name, mesh, mat, fr: Matrix):
        """A flat feature modelled in the frame `fr`, wrapped onto the sponge's surface (head frame)."""
        verts, faces = mesh
        n0 = -fr.col[1].to_3d().normalized()
        p0 = fr.to_translation()
        vj = [fr @ Vector(v) for v in verts]
        self.add(name, (self.sponge.conform(vj, p0, n0), faces), mat, 'head')

    # --- body --------------------------------------------------------------------------------------
    def body(self):
        M = self.mat
        self.add('sponge', self.sponge.mesh(), M['sponge'], 'head')
        # white shirt band under the sponge (chest frame), collar and red tie
        self.add('shirt', ring_band(0.425, 0.16, band_prof(-0.075, 0.1, 0.01), 64, 4.0), M['shirt'], 'chest')
        for sd in (1, -1):
            pts = [Vector((0.012 * sd, -0.182, 0.085)), Vector((0.06 * sd, -0.186, 0.045)), Vector((0.11 * sd, -0.184, 0.0))]
            self.add('collar', flat_sweep(pts, lambda t: 0.046 * (1 - t) ** 0.8 + 0.006, Vector((0.0, -1.0, 0.0)), 0.25, 10), M['shirt'], 'chest')
        self.add('knot', superellipsoid(0.032, 0.018, 0.03, 3.0, 14, 8, center=(0, -0.188, 0.068)), M['tie'], 'chest')
        fly = self.pose.get('extra', {}).get('scarf', 0.0)
        wv = self.pose.get('extra', {}).get('wave', 0.0)
        pts = []
        for i in range(9):
            t = i / 8
            pts.append(Vector((0.012 * math.sin(wv + t * 3.0) * fly * t, -0.195 - 0.008 * t - 0.035 * fly * t * t, 0.05 - 0.17 * t + 0.05 * fly * t * t)))

        def tie_w(t):
            return 0.022 + 0.026 * t if t < 0.8 else (0.043 * (1 - (t - 0.8) / 0.2) + 0.004)
        self.add('tie', flat_sweep(pts, tie_w, Vector((0.0, -1.0, 0.0)), 0.22, 10), M['tie'], 'chest')
        # brown square pants (hips frame) with a black belt and short wide legs
        self.add('pants', superellipsoid(0.425, 0.172, 0.11, 4.0, 40, 16, center=(0, 0, -0.035)), M['pants'], 'hips')
        self.add('belt', ring_band(0.43, 0.177, band_prof(0.035, 0.07, 0.006), 64, 4.0), M['belt'], 'hips')
        for k in range(4):
            x = (-0.3, -0.1, 0.1, 0.3)[k]
            self.add('loop', superellipsoid(0.014, 0.008, 0.024, 3.0, 8, 6, center=(x, -0.183, 0.052)), M['pants_d'], 'hips')

    # --- legs ------------------------------------------------------------------------------------
    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('pleg' + s_, hip, kn, an, lambda t: 0.085 + 0.008 * t, M['pants'], 0.0, 0.33, 16, 6, cap0=True, cap1=False)
            self.limb('leg' + s_, hip, kn, an, 0.034, M['skin'], 0.1, 0.62, 10, 10, cap0=False)
            self.limb('sock' + s_, hip, kn, an, 0.041, M['sock'], 0.6, 0.98, 12, 8, cap0=True, cap1=False)
            self.limb('stripeR' + s_, hip, kn, an, 0.044, M['stripe_r'], 0.635, 0.675, 12, 2, cap0=False, cap1=False)
            self.limb('stripeB' + s_, hip, kn, an, 0.044, M['stripe_b'], 0.705, 0.745, 12, 2, cap0=False, cap1=False)
            fm = self.J(an) @ R(0, 0, -8 * sd)
            self.add('shoe' + s_, superellipsoid(0.085, 0.13, 0.062, 2.4, 20, 12, center=(0, -0.045, -0.058)), M['shoe'], None, fm)
            self.add('toe' + s_, ellipsoid(0.088, 0.1, 0.07, 18, 10, center=(0, -0.12, -0.06)), M['shoe'], None, fm)
            self.add('sole' + s_, superellipsoid(0.09, 0.15, 0.018, 3.0, 20, 6, center=(0, -0.06, -0.104)), M['belt'], None, fm)

    # --- arms ------------------------------------------------------------------------------------
    def arms(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.066 + 0.012 * t, M['shirt'], 0.0, 0.26, 16, 6, cap0=True, cap1=False)
            self.limb('sleevein' + s_, sh, el, wr, 0.07, M['shirt'], 0.255, 0.265, 16, 1, cap0=False, cap1=False)
            self.limb('arm' + s_, sh, el, wr, 0.033, M['skin'], 0.2, 1.0, 10, 14, cap0=False, extend=0.02)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.05):
                self.add('hand' + nm + s_, mesh, M['skin'], None, wm)

    # --- face ------------------------------------------------------------------------------------
    EYE_X, EYE_Z, EYE_R = 0.158, 0.79, (0.158, 0.105, 0.168)

    def face_state(self):
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        return f

    def face(self):
        M = self.mat
        sp = self.sponge
        f = self.face_state()
        eyes, mouth = f['eyes'], f['mouth']
        lx, lz = f.get('look', (0.0, 0.0))
        kinds = {1: eyes, -1: eyes}
        if eyes == 'wink':
            kinds = {1: 'open', -1: 'happy'}
        wide = eyes == 'wide'
        for side in (1, -1):
            nm = 'L' if side > 0 else 'R'
            kind = kinds[side]
            k = 1.06 if wide else 1.0
            ra, rb, rc = (r * k for r in self.EYE_R)
            d = sp.front(self.EYE_X * side, self.EYE_Z)
            base = sp.surf(d)
            ec = base + Vector((0.0, rb * 0.45, 0.0))  # sunk into the face
            eye = HeadShape(ra, rb, rc, center=tuple(ec))
            self.add('eye' + nm, ellipsoid(ra, rb, rc, 28, 18, center=tuple(ec)), M['white'], 'head')
            shut = kind in ('happy', 'closed')
            if kind == 'dizzy':
                pts = []
                for i in range(44):
                    a = i / 44 * math.tau * 2.3
                    r = 0.01 + (ra * 0.72 - 0.01) * i / 44
                    pts.append(Vector((math.cos(a) * r * side, -0.004, math.sin(a) * r)))
                self.feat('spiral' + nm, sweep(pts, 0.0085, 6), M['lash'], 'head', eye, eye.frame(0, 0, 0.0))
            elif not shut:
                ir = 0.78 if wide else 1.0
                yaw = lx * 16.0 - 4.0 * side
                pitch = -4.0 + lz * 14.0
                fr = eye.frame(yaw, pitch, 0.0)
                ri = 0.072 * ir
                self.feat('iris' + nm, ellipsoid(ri, 0.006, ri, 22, 8), M['iris'], 'head', eye, fr)
                self.feat('pupil' + nm, ellipsoid(ri * 0.52, 0.007, ri * 0.52, 18, 6, center=(0, -0.002, 0)), M['pupil'], 'head', eye, fr)
                self.feat('shine' + nm, ellipsoid(ri * 0.3, 0.004, ri * 0.3, 10, 5, center=(-ri * 0.35, -0.006, ri * 0.38)), M['shine'], 'head', eye, fr)
                self.feat('shine2' + nm, ellipsoid(ri * 0.12, 0.004, ri * 0.12, 8, 4, center=(ri * 0.4, -0.006, -ri * 0.38)), M['shine'], 'head', eye, fr)
            # eyelids: half / sad / determined cover the top, closed / happy cover the whole eye
            lid = {'half': (0.5, 0.0), 'sad': (0.36, -18.0), 'determined': (0.36, 18.0)}.get(kind)
            if shut:
                lid = (1.0, 0.0)
            if lid:
                level, slant = lid
                zmin = -1.0 if shut else 1.0 - 2.0 * level
                lm = T(*ec) @ R(0, -slant * side, 0)
                self.add('lid' + nm, ellipsoid(ra * 1.05, rb * 1.1, rc * 1.05, 28, 14, zmin=zmin), M['lid'], 'head', lm)
                lidshape = HeadShape(ra * 1.05, rb * 1.1, rc * 1.05, center=tuple(ec))
                if shut:
                    h = -0.35 if kind == 'happy' else 0.18
                    pts = arc_points(ra * 1.6, rc * h, 14, y=-0.004)
                    pts = [p + Vector((0, 0, -rc * 0.1)) for p in pts]
                    self.feat('shutline' + nm, sweep(pts, lambda t: 0.0085 + 0.004 * math.sin(math.pi * t), 8), M['lash'], 'head', lidshape,
                              lidshape.frame(0, 0, 0.0))
                else:
                    # lash line along the lid's edge
                    zc = rc * 1.05 * (1.0 - 2.0 * level)
                    pts = []
                    for i in range(15):
                        a = -1.35 + 2.7 * i / 14
                        pts.append(Vector((math.sin(a) * ra * 1.06, -math.cos(a) * rb * 1.12, zc)))
                    pts = [lm.to_3x3() @ p + Vector(ec) for p in pts]
                    self.add('lidline' + nm, sweep(pts, 0.0075, 6), M['lash'], 'head')
            # three lashes on top of each eye
            lash_top = rc * (1.05 if lid else 1.0)
            for j, a in enumerate((-38.0, -6.0, 26.0)):
                aa = math.radians(a * side)
                root = Vector(ec) + Vector((math.sin(aa) * ra * 0.9, -rb * 0.3, math.cos(aa) * lash_top * 0.9))
                dvec = Vector((math.sin(aa) * 1.1, -0.25, math.cos(aa))).normalized()
                ln = (0.085, 0.1, 0.085)[j]
                pts = [root + dvec * (ln * t) + Vector((0.02 * side * t * t * math.sin(aa) * 3, 0, 0)) for t in (i / 6 for i in range(7))]
                self.add(f'lash{j}{nm}', sweep(pts, lambda t: 0.014 * (1 - t) ** 0.8 + 0.004, 8), M['lash'], 'head')
        # nose: long, pointing forward and a little down
        nb = sp.surf(sp.front(0.0, 0.625))
        pts = [nb + Vector((0.0, 0.04 - 0.24 * t, -0.03 * t * t)) for t in (i / 10 for i in range(11))]
        self.add('nose', sweep(pts, lambda t: 0.043 + 0.008 * t ** 2, 16), M['skin'], 'head')
        self.cheeks()
        self.mouth(mouth)

    def cheeks(self):
        M = self.mat
        for sd in (1, -1):
            fr = self.sponge.frame(0.33 * sd, 0.51, 0.0)
            self.sfeat('cheek', ellipsoid(0.062, 0.006, 0.05, 20, 6), M['cheek'], fr)
            for k, (u, v) in enumerate(((-0.02, 0.012), (0.018, 0.018), (0.0, -0.016))):
                self.sfeat('freckle', ellipsoid(0.0085, 0.009, 0.0085, 8, 5, center=(u * sd, -0.004, v)), M['freckle'], fr)

    def mouth(self, mouth: str):
        M = self.mat
        fr = self.sponge.frame(0.0, 0.465, 0.0)
        line = lambda t: 0.0115 + 0.004 * math.sin(math.pi * t)  # noqa: E731
        w = 0.58
        teeth = True
        if mouth in ('smile', 'smirk'):
            tilt = 0.02 if mouth == 'smirk' else 0.0
            pts = []
            for i in range(21):
                t = i / 20 * 2 - 1
                z = -0.07 * (1 - t * t) + tilt * t + 0.028 * abs(t) ** 6
                pts.append(Vector((t * w / 2, -0.006, z)))
            self.sfeat('mouth', sweep(pts, line, 8), M['mouth'], fr)
            ztop = -0.07
        elif mouth in ('grin', 'open', 'laugh'):
            depth = {'grin': 0.1, 'open': 0.12, 'laugh': 0.15}[mouth]
            ww = {'grin': 0.52, 'open': 0.4, 'laugh': 0.48}[mouth]

            def top(x):
                t = x / (ww / 2)
                return -0.05 * (1 - t * t) + 0.02 * abs(t) ** 4

            def bot(x):
                t = x / (ww / 2)
                return top(x) - depth * max(0.0, 1 - t * t) ** 0.7

            self.sfeat('mouth', strip(top, bot, -ww / 2, ww / 2, 28, 6, 0.004), M['mouth'], fr)
            self.sfeat('tongue', ellipsoid(ww * 0.2, 0.006, depth * 0.3, 16, 6, center=(0.0, -0.005, -0.05 - depth * 0.62)), M['tongue'], fr)
            ztop = -0.05
        elif mouth == 'o':
            self.sfeat('mouth', ellipsoid(0.04, 0.006, 0.05, 18, 6, center=(0, -0.002, -0.06)), M['mouth'], fr)
            teeth = False
        elif mouth == 'gasp':
            self.sfeat('mouth', ellipsoid(0.07, 0.006, 0.075, 20, 6, center=(0, -0.002, -0.07)), M['mouth'], fr)
            self.sfeat('tongue', ellipsoid(0.035, 0.007, 0.022, 12, 6, center=(0, -0.005, -0.12)), M['tongue'], fr)
            ztop = -0.004
            teeth = True
        else:
            pts = []
            for i in range(17):
                t = i / 16 * 2 - 1
                if mouth == 'frown':
                    z = 0.04 * (1 - t * t) - 0.06
                elif mouth == 'wobble':
                    z = 0.014 * math.sin(t * math.pi * 2.5) - 0.05
                else:  # flat
                    z = -0.05
                pts.append(Vector((t * w * 0.36, -0.006, z)))
            self.sfeat('mouth', sweep(pts, line, 8), M['mouth'], fr)
            ztop = -0.05 if mouth != 'frown' else -0.02
            teeth = mouth != 'wobble'
        if teeth:
            for sd in (1, -1):
                self.sfeat('tooth', superellipsoid(0.024, 0.01, 0.03, 3.2, 12, 8, center=(0.027 * sd, -0.01, ztop - 0.03)), M['teeth'], fr)
