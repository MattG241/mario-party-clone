"""Zippa Wren: the flying-squirrel courier, built on the shared Hero structure (see char_models.py).

Orange-brown fur with a cream face mask, big pointed ears with tufted tips, a magenta hoodie with the
hood bunched around the neck, belt and pouches, magenta sneakers, and a very large banded tail that
curls up behind her in an S. The tail follows pose['extra']['tail'] (-1 droops, 0 relaxed S-curve,
1 raised and streaming out behind), 'sway' (side sway) and 'wave' (a little wobble).
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import (HeadShape, R, S, T, ellipsoid, flat_sweep, open_sweep, polyline_segment, rad, rmf_frames, superellipsoid, sweep,
                      torus)
from char_models import Hero, hand_mitten


def sstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def catmull_rom(ctrl, steps: int = 8):
    """Dense polyline through control points (uniform Catmull-Rom with clamped ends)."""
    pts = [ctrl[0]] + list(ctrl) + [ctrl[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(steps):
            t = k / steps
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2.0 * p1) + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t3))
    out.append(ctrl[-1].copy())
    return out


def flat_tip(n: int, sides: int, nverts: int, t0: float = 0.0, t1: float = 1.0):
    """'tip' values for a char_rig.flat_sweep (or sweep) mesh of n rings: t0..t1 along the rings, then the
    end cap (t1) and the start cap (t0)."""
    tip = []
    for i in range(n):
        tip += [t0 + (t1 - t0) * i / max(1, n - 1)] * sides
    rest = nverts - n * sides
    tip += [t1] * (rest // 2) + [t0] * (rest - rest // 2)
    return tip


def tube(pts, radius, sides: int = 24, cap_steps: int = 5):
    """Like char_rig.sweep, but the radius may vary around the tube: radius(t, a) with t in 0..1 along
    the points and a the angle (radians) around them. Rounded caps at both ends."""
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
                q = p + t * (sign * math.sin(ang) * r0) + (u * math.cos(a) + v * math.sin(a)) * (radius(tt, a) * math.cos(ang))
                verts.append(tuple(q))
                ring.append(len(verts) - 1)
            for k in range(sides):
                k2 = (k + 1) % sides
                if sign > 0:
                    faces.append((prev[k], prev[k2], ring[k2], ring[k]))
                else:
                    faces.append((prev[k], ring[k], ring[k2], prev[k2]))
            prev = ring
        verts.append(tuple(p + t * (sign * r0)))
        tip = len(verts) - 1
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((prev[k], prev[k2], tip) if sign > 0 else (prev[k], tip, prev[k2]))

    cap(n - 1, 1)
    cap(0, -1)
    return verts, faces


def interp(points, x: float) -> float:
    """Smoothly interpolated value through (x, y) control points (clamped at the ends)."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            f = (x - x0) / (x1 - x0) if x1 > x0 else 0.0
            return y0 + (y1 - y0) * sstep(f)
    return points[-1][1]


class MeshAcc:
    """Accumulates several meshes (and their 'tip' values) into one part."""

    def __init__(self):
        self.v, self.f, self.tip = [], [], []

    def add(self, mesh, tip=None):
        vv, ff = mesh
        b0 = len(self.v)
        self.v.extend(vv)
        self.f.extend(tuple(q + b0 for q in face) for face in ff)
        if tip is not None:
            self.tip.extend(tip)

    @property
    def mesh(self):
        return self.v, self.f


class SquirrelHead(HeadShape):
    """The head ellipsoid plus soft bumps (muzzle, cheeks). point()/frame() follow the bumped surface,
    so facial features placed by Hero.face() sit on it, and mesh() builds the head from the same surface."""

    def __init__(self, rx, ry, rz, center, bumps):
        super().__init__(rx, ry, rz, center)
        self.bumps = bumps  # [(unit direction, angular radius in degrees, height)]

    def surf(self, d: Vector) -> Vector:
        d = d.normalized()
        r = self.r
        k = 1.0 / math.sqrt((d.x / r.x) ** 2 + (d.y / r.y) ** 2 + (d.z / r.z) ** 2)
        pos = self.c + d * k
        n = Vector(((pos.x - self.c.x) / r.x ** 2, (pos.y - self.c.y) / r.y ** 2, (pos.z - self.c.z) / r.z ** 2)).normalized()
        h = 0.0
        for bd, ang, amp in self.bumps:
            a = math.degrees(math.acos(max(-1.0, min(1.0, d.dot(bd)))))
            h += amp * sstep(1.0 - a / ang)
        return pos + n * h

    def point(self, yaw: float, pitch: float, lift: float = 0.0):
        y, p = rad(yaw), rad(pitch)
        d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
        pos = self.surf(d)
        e1 = d.cross(Vector((0.0, 0.0, 1.0)))
        if e1.length < 1e-6:
            e1 = Vector((1.0, 0.0, 0.0))
        e1.normalize()
        e2 = d.cross(e1).normalized()
        eps = 0.01
        a = self.surf(d + e1 * eps) - self.surf(d - e1 * eps)
        b = self.surf(d + e2 * eps) - self.surf(d - e2 * eps)
        n = a.cross(b).normalized()
        if n.dot(pos - self.c) < 0:
            n = -n
        return pos + n * lift, n

    def mesh(self, seg: int = 44, rings: int = 28):
        verts, faces = ellipsoid(1.0, 1.0, 1.0, seg, rings)
        return [tuple(self.surf(Vector(v))) for v in verts], faces


def direction(yaw: float, pitch: float) -> Vector:
    y, p = rad(yaw), rad(pitch)
    return Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))


# ------------------------------------------------------------------------------------------
class Zippa(Hero):
    """Zippa Wren: flying-squirrel courier — big banded tail, magenta hoodie, belt pouch, sneakers."""

    key = 'zippa'
    ankle_h = 0.14
    hip_h = 0.61
    spine = 0.08
    chest = 0.19
    neck = 0.13
    head_up = 0.04
    shoulder = (0.22, 0.0, 0.11)
    upper_arm = 0.215
    forearm = 0.19
    hip_w = 0.105
    thigh = 0.21
    shin = 0.22
    sit_h = 0.17

    C = dict(fur='#bd6834', fur_d='#9a5226', cream='#f3d4aa', nose='#5a2a20', ear_in='#f3a3a0', paw='#d08448',
             hoodie='#c8306a', hood='#d6307a', cuff='#9c2152', belt='#6a4020', pouch='#b08850', pouch_d='#7c5230',
             patch='#3f9fd8', shoe='#d6307a', sole='#fbf5ea', strap='#e2b86a', sock='#fff4e4', iris='#7a3c16',
             brow='#6e3518', tail_a='#5c2812', tail_d='#7c3a1a', tail_m='#a9582a', tail_l='#dca272', tail_b='#f3d4aa')

    HEAD = (0.45, 0.39, 0.385, 0.42)  # rx, ry, rz, centre height above the head joint
    EYE = (26.0, -6.0)  # eye yaw / pitch on the head

    # tail control points in the hips frame (x: her left, y: back, z: up), for tail = 0 / 1 / -1
    TAIL_RELAXED = [(-0.03, 0.09, -0.03), (-0.15, 0.27, -0.08), (-0.38, 0.40, -0.02), (-0.62, 0.46, 0.16),
                    (-0.75, 0.46, 0.45), (-0.71, 0.44, 0.77), (-0.51, 0.44, 1.01), (-0.25, 0.46, 1.07)]
    TAIL_RAISED = [(-0.03, 0.09, -0.03), (-0.09, 0.28, 0.02), (-0.20, 0.50, 0.14), (-0.32, 0.70, 0.34),
                   (-0.42, 0.84, 0.60), (-0.46, 0.88, 0.88), (-0.42, 0.82, 1.10), (-0.32, 0.72, 1.22)]
    TAIL_DROOP = [(-0.03, 0.09, -0.03), (-0.10, 0.28, -0.14), (-0.22, 0.46, -0.26), (-0.34, 0.64, -0.32),
                  (-0.46, 0.82, -0.32), (-0.56, 0.96, -0.26), (-0.62, 1.06, -0.14), (-0.63, 1.10, 0.02)]

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.22

    # --- materials --------------------------------------------------------------------------
    def face_fur(self, name: str, head: SquirrelHead):
        """Orange fur with a cream mask (muzzle, cheeks, patches round the eyes) from object coordinates."""
        c = self.C
        hc = self.HEAD[3]
        ep, _n = head.point(*self.EYE)
        ex, ev = abs(ep.x), ep.z - hc

        def make(n):
            m = lib.NT(n)
            tc = m.node('ShaderNodeTexCoord')
            obj = tc.outputs['Object']
            sp = m.sep(obj)
            sx, sy, sz = sp[0], sp[1], sp[2]
            ax = m.math('ABSOLUTE', sx)
            v = m.math('SUBTRACT', sz, hc)
            front = m.maprange(sy, -0.04, -0.2)
            lower = m.maprange(v, 0.0, -0.09)
            dx = m.math('DIVIDE', m.math('SUBTRACT', ax, ex), 0.15)
            dv = m.math('DIVIDE', m.math('SUBTRACT', v, ev), 0.165)
            d = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', dx, dx), m.math('MULTIPLY', dv, dv)))
            patch = m.maprange(d, 1.0, 0.82)
            mask = m.math('MAXIMUM', lower, patch)
            stripe = m.math('MULTIPLY', m.maprange(ax, 0.055, 0.025), m.maprange(v, -0.11, -0.05))
            mask = m.math('MULTIPLY', mask, m.math('SUBTRACT', 1.0, stripe))
            mask = m.math('MULTIPLY', mask, front)
            crown = m.math('MULTIPLY', m.maprange(v, 0.12, 0.4), 0.45)
            base = m.mix(crown, col(c['fur']), col(c['fur_d']))
            colr = m.mix(mask, base, col(c['cream']))
            nz = m.noise(38.0, 4, 0.7, obj)
            nrm = m.bump(nz.outputs['Fac'], 0.1, 0.02)
            m.bsdf(colr, 0.62, normal=nrm, sheen=0.7, spec=0.3)
            return m.mat
        return self.m.get(name, make)

    # --- building -----------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            fur=mt.fur('zip_fur', c['fur']),
            cream=mt.fur('zip_cream', c['cream']),
            paw=mt.fur('zip_paw', c['paw']),
            tuft=mt.hair('zip_tuft', c['fur'], c['fur_d'], 0.55),
            eartuft=mt.hair('zip_eartuft', '#a8582a', '#5a2c14', 0.55),
            cheek=mt.hair('zip_cheek', c['cream'], '#fbe8cc', 0.6),
            hoodie=mt.cloth('zip_hoodie', c['hoodie'], 0.72, 0.4, 0.08),
            hood=mt.cloth('zip_hood', c['hood'], 0.72, 0.45, 0.08),
            cuff=mt.cloth('zip_cuff', c['cuff'], 0.72, 0.35),
            belt=mt.cloth('zip_belt', c['belt'], 0.55, 0.2, 0.1, 40),
            pouch=mt.cloth('zip_pouch', c['pouch'], 0.55, 0.2, 0.12, 25),
            pouch_d=mt.cloth('zip_pouch_d', c['pouch_d'], 0.55, 0.2, 0.12, 25),
            patch=mt.glossy('zip_patch', c['patch'], 0.3, 0.5),
            brass=mt.metal('brass', '#e0a93f', 0.3),
            shoe=mt.cloth('zip_shoe', c['shoe'], 0.5, 0.25, 0.06, 40),
            sole=mt.cloth('zip_sole', c['sole'], 0.6, 0.1),
            strap=mt.cloth('zip_strap', c['strap'], 0.5, 0.2),
            sock=mt.cloth('zip_sock', c['sock'], 0.8, 0.3),
            nose=mt.glossy('zip_nose', c['nose'], 0.3, 0.6),
            ear_in=mt.skin('zip_ear_in', c['ear_in']),
        )
        self.torso()
        self.legs()
        self.arms()
        self.head_parts()
        self.tail()

    def torso(self):
        mm = self.mat
        # cream chest fur under an open magenta hoodie (chest frame); cream fur shorts (hips frame)
        prof = lambda t: 0.212 - 0.026 * t + 0.012 * math.sin(math.pi * t)  # noqa: E731
        self.add('chestfur', sweep([Vector((0, 0, -0.36 + 0.48 * i / 10)) for i in range(11)], lambda t: prof(t) - 0.014, 24, cap0=False,
                                   squash=0.8), mm['cream'], 'chest')
        col_pts = [Vector((0, 0, -0.33 + 0.44 * i / 10)) for i in range(10)]
        self.add('hoodie', open_sweep(col_pts, prof, -64, 244, 26, 0.8, 0.022), mm['hoodie'], 'chest')
        self.add('shoulders', ellipsoid(0.2, 0.155, 0.085, 26, 12, center=(0, 0, 0.1), zmin=-0.2), mm['hoodie'], 'chest')
        # the hood, bunched around the neck: thick at the back, thinning to the lapels at the front
        cpts = []
        for i in range(19):
            u = i / 18
            phi = rad(-62 + (242 + 62) * u)
            fr = max(0.0, -math.sin(phi))
            z = 0.165 - 0.12 * fr ** 1.6
            rr = 0.17 + 0.03 * fr
            cpts.append(Vector((rr * math.cos(phi), rr * math.sin(phi) * 0.92 + 0.012, z)))
        self.add('hood', sweep(cpts, lambda t: 0.064 + 0.056 * math.sin(math.pi * t) ** 0.6, 16), mm['hood'], 'chest')
        self.add('hoodback', ellipsoid(0.19, 0.11, 0.14, 20, 12, center=(0, 0.2, 0.13)), mm['hood'], 'chest', R(-12, 0, 0))
        # a little gold pendant on a cord
        self.add('cord', sweep([Vector((-0.07, -0.13, 0.12)), Vector((-0.03, -0.165, 0.03)), Vector((0.0, -0.172, 0.0)),
                                Vector((0.03, -0.165, 0.03)), Vector((0.07, -0.13, 0.12))], 0.006, 6), mm['belt'], 'chest')
        pm = T(0, -0.176, -0.02)
        for sd in (1, -1):
            self.add('heart', ellipsoid(0.019, 0.012, 0.019, 12, 8, center=(0.014 * sd, 0, 0.004)), mm['brass'], 'chest', pm)
        self.add('heart_tip', ellipsoid(0.02, 0.011, 0.024, 12, 8, center=(0, 0, -0.012)), mm['brass'], 'chest', pm @ R(0, 45, 0))
        # pelvis, belt, buckle
        self.add('pelvis', superellipsoid(0.2, 0.165, 0.15, 2.4, 28, 16, center=(0, 0, -0.04)), mm['cream'], 'hips')
        self.add('belt', torus(0.197, 0.026, 36, 8, center=(0, 0, 0.05)), mm['belt'], 'hips', S(1.0, 0.84, 1.0))
        self.add('buckle', superellipsoid(0.042, 0.012, 0.032, 4.0, 14, 8), mm['brass'], 'hips', T(0, -0.172, 0.05))
        self.add('buckle_in', superellipsoid(0.026, 0.012, 0.018, 4.0, 12, 6), mm['belt'], 'hips', T(0, -0.178, 0.05))
        # pouches: a tan courier pouch with a blue patch at her left hip, a small dark one on the right
        for phi, big in ((-56.0, True), (236.0, False)):
            p = Vector((0.205 * math.cos(rad(phi)), 0.172 * math.sin(rad(phi)), 0.0))
            n = Vector((math.cos(rad(phi)), math.sin(rad(phi)) * 1.1, 0.0)).normalized()
            s = 1.15 if big else 1.0
            bm = T(*(p + n * 0.045 * s)) @ R(0, 0, phi + 90) @ T(0, 0, -0.06)
            m_ = mm['pouch'] if big else mm['pouch_d']
            self.add('pouch', superellipsoid(0.085 * s, 0.045 * s, 0.085 * s, 3.2, 20, 12), m_, 'hips', bm)
            self.add('flap', superellipsoid(0.09 * s, 0.024 * s, 0.045 * s, 3.0, 18, 8, center=(0, -0.034 * s, 0.045 * s)), mm['pouch_d'] if big else mm['belt'],
                     'hips', bm)
            if big:
                self.add('patch', superellipsoid(0.036, 0.008, 0.03, 3.5, 12, 6, center=(0, -0.05, -0.02)), mm['patch'], 'hips', bm)
            self.add('stud', ellipsoid(0.012, 0.008, 0.012, 8, 6, center=(0, -0.06 * s, 0.035 * s)), mm['brass'], 'hips', bm)

    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('thigh' + s_, hip, kn, an, lambda t: 0.1 + 0.01 * t, mm['cream'], 0.0, 0.27, 16, 8, cap0=True, cap1=True)
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.072 - 0.01 * t + 0.006 * math.sin(math.pi * min(1.0, max(0.0, (t - 0.4) / 0.45))),
                      mm['fur'], 0.24, 0.9, 12, 12)
            self.limb('sock' + s_, hip, kn, an, 0.074, mm['sock'], 0.8, 0.98, 12, 3, cap0=False, cap1=False)
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('shoe' + s_, superellipsoid(0.122, 0.178, 0.1, 2.5, 22, 14, center=(0, -0.05, -0.048)), mm['shoe'], None, fm)
            self.add('toecap' + s_, ellipsoid(0.11, 0.092, 0.068, 18, 10, center=(0, -0.165, -0.078)), mm['sole'], None, fm)
            self.add('sole' + s_, superellipsoid(0.13, 0.205, 0.034, 3.0, 22, 8, center=(0, -0.064, -0.11)), mm['sole'], None, fm)
            self.add('collar' + s_, torus(0.084, 0.026, 22, 8, center=(0, 0, 0.022)), mm['sock'], None, fm)
            strap = [Vector((-0.108, -0.07, -0.03)), Vector((0.0, -0.145, 0.008)), Vector((0.108, -0.07, -0.03))]
            self.add('strap' + s_, sweep(curve_pts(strap, 10), 0.016, 8, squash=0.6), mm['strap'], None, fm)

    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.088 - 0.014 * t, mm['hoodie'], 0.0, 0.88, 14, 12, cap0=True, cap1=False)
            self.limb('cuff' + s_, sh, el, wr, 0.08, mm['cuff'], 0.8, 1.0, 14, 4, cap0=False, cap1=False)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.08):
                self.add('paw' + nm + s_, mesh, mm['paw'], None, wm)
            self.add('cuffrim' + s_, torus(0.072, 0.02, 18, 8, center=(0, 0, -0.004)), mm['cuff'], None, wm)

    def head_parts(self):
        c, mm = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        bumps = [(direction(0, -24), 30.0, 0.055),
                 (direction(52, -28), 34.0, 0.045), (direction(-52, -28), 34.0, 0.045)]
        head = SquirrelHead(hx, hy, hz, (0, 0, hc), bumps)
        self.add('head', head.mesh(), self.face_fur('zip_face', head), 'head')
        ey, ep = self.EYE
        self.face(head, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(0.104, 0.124), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-34,
                  mouth_w=0.78, lid_col='#f0cfa4', nose=False, skin=None, blush=True, brow_pitch=20)
        # nose: a small dark rounded triangle on the tip of the muzzle
        nf = head.frame(0, -17, -0.004)
        self.add('nose', ellipsoid(0.036, 0.022, 0.024, 14, 8), mm['nose'], 'head', nf)
        self.add('nose_tip', ellipsoid(0.017, 0.02, 0.019, 10, 6, center=(0, -0.004, -0.015)), mm['nose'], 'head', nf)
        # the little line from the nose down to the mouth
        mouth = self.m.glossy('mouth', '#6d2a26', 0.4, 0.2)
        lip = [head.point(0, p_, 0.002)[0] for p_ in (-21.0, -24.5, -28.0, -31.0)]
        self.add('philtrum', sweep(lip, lambda t: 0.0065 - 0.0015 * t, 6), mouth, 'head')
        self.ears(head)
        self.head_tufts(head)

    def ears(self, head: SquirrelHead):
        mm = self.mat
        L, W = 0.47, 0.2
        prof = [(0.0, 0.84), (0.22, 1.0), (0.5, 0.9), (0.72, 0.6), (0.9, 0.27), (1.0, 0.03)]

        def ear_r(t):
            return W * interp(prof, t)

        n = 16
        z0 = -0.08
        bend = lambda z: 0.05 * ((z - z0) / (L - z0)) ** 2  # noqa: E731
        t_of = lambda z: (z - z0) / (L - z0)  # noqa: E731
        pts = [Vector((0.0, bend(z), z)) for z in (z0 + (L - z0) * k / (n - 1) for k in range(n))]

        def layer(z_a, z_b, scale, dy):
            zs = [z_a + (z_b - z_a) * k / (n - 1) for k in range(n)]
            lp = [Vector((0.0, bend(z) - 0.31 * ear_r(t_of(z)) - dy, z)) for z in zs]
            return lp, (lambda t: scale * ear_r(t_of(z_a + (z_b - z_a) * t)))

        rim_pts, rim_r = layer(0.0, L * 0.86, 0.76, 0.0)
        pink_pts, pink_r = layer(0.03, L * 0.74, 0.56, 0.012)
        for sd in (1, -1):
            pos, _nrm = head.point(52 * sd, 40, -0.03)
            em = T(*pos) @ R(-8, 29 * sd, 26 * sd)
            self.add('ear', flat_sweep(pts, ear_r, Vector((0.0, -1.0, 0.0)), 0.34, 18), mm['fur'], 'head', em)
            self.add('earrim', flat_sweep(rim_pts, rim_r, Vector((0.0, -1.0, 0.0)), 0.16, 16), mm['cream'], 'head', em)
            self.add('earin', flat_sweep(pink_pts, pink_r, Vector((0.0, -1.0, 0.0)), 0.16, 16), mm['ear_in'], 'head', em)
            # a brush of darker fur continuing the tip
            acc = MeshAcc()
            for ox, dx, ln, r0 in ((0.0, 0.08, 0.21, 0.06), (0.036, 0.8, 0.15, 0.046), (-0.032, -0.55, 0.14, 0.044), (0.016, 0.4, 0.18, 0.04)):
                base = Vector((ox, 0.03, L * 0.66))
                d = Vector((dx * 0.4, 0.05, 1.0)).normalized()
                tp = [base + d * (ln * t) + Vector((dx * 0.07 * t * t, 0.0, 0.0)) for t in (j / 7 for j in range(8))]
                vv = flat_sweep(tp, lambda t, r0=r0: r0 * (1 - 0.84 * t ** 1.2), Vector((0.0, -1.0, 0.0)), 0.45, 12)
                acc.add(vv, flat_tip(8, 12, len(vv[0])))
            self.add('eartuft', acc.mesh, mm['eartuft'], 'head', em, tip=acc.tip)

    def head_tufts(self, head: SquirrelHead):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        hs2 = HeadShape(hx + 0.02, hy + 0.02, hz + 0.02, center=(0, 0.0, hc))
        acc = MeshAcc()

        def lock(yaw, pitch, length, r0, flow, flick, flat=0.5):
            pos, n = hs2.point(yaw, pitch, -0.03)
            fl = Vector(flow).normalized()
            fl = (fl - n * fl.dot(n)).normalized()
            pts = [pos + fl * (length * t) + n * (length * flick * t * t) for t in [k / 9 for k in range(10)]]
            vv = flat_sweep(pts, lambda t: r0 * (1 - 0.8 * t ** 1.4), n, flat, 12)
            acc.add(vv, flat_tip(10, 12, len(vv[0])))

        lock(-26, 60, 0.18, 0.09, (0.85, -0.4, 0.3), 0.45, 0.4)
        lock(-8, 66, 0.21, 0.095, (0.85, -0.3, 0.35), 0.6, 0.4)
        lock(10, 66, 0.2, 0.09, (0.9, -0.2, 0.3), 0.55, 0.4)
        lock(-14, 78, 0.15, 0.08, (0.6, 0.3, 0.6), 0.6, 0.4)
        self.add('headtufts', acc.mesh, mm['tuft'], 'head', tip=acc.tip)
        # fluffy cream cheeks: soft pointed locks flicking out below the eyes
        acc = MeshAcc()
        hs3 = HeadShape(hx, hy, hz, center=(0, 0, hc))
        for sd in (1, -1):
            for yaw, pitch, ln, dz in ((70, -10, 0.1, -0.2), (73, -26, 0.12, -0.5), (67, -42, 0.095, -0.85)):
                pos, n = hs3.point(yaw * sd, pitch, -0.03)
                fl = Vector((sd * 1.0, 0.1, dz)).normalized()
                pts = [pos + fl * (ln * t) for t in [k / 7 for k in range(8)]]
                vv = flat_sweep(pts, lambda t: 0.078 * (1 - 0.72 * t ** 1.5), Vector((0.0, -1.0, 0.0)), 0.55, 12)
                acc.add(vv, flat_tip(8, 12, len(vv[0])))
        self.add('cheeks', acc.mesh, mm['cheek'], 'head', tip=acc.tip)

    # --- tail ---------------------------------------------------------------------------------
    @staticmethod
    def tail_r(t: float) -> float:
        return interp([(0.0, 0.085), (0.14, 0.2), (0.36, 0.315), (0.55, 0.34), (0.75, 0.32), (0.9, 0.27), (1.0, 0.2)], t)

    def tail_points(self, tail: float, sway: float, wave: float):
        tail = max(-1.0, min(1.0, tail))
        other = self.TAIL_RAISED if tail >= 0 else self.TAIL_DROOP
        f = abs(tail)
        ctrl = [Vector(a).lerp(Vector(b), f) for a, b in zip(self.TAIL_RELAXED, other)]
        pts = polyline_segment(catmull_rom(ctrl, 10), 0.0, 1.0, 48)
        base = pts[0].copy()
        out = []
        for i, p in enumerate(pts):
            t = i / (len(pts) - 1)
            q = Matrix.Rotation(rad(sway * 16.0 * sstep(t * 1.4)), 3, 'Z') @ (p - base)
            q += Vector((0.035 * math.sin(wave - t * 5.0) * t, 0.0, 0.02 * math.cos(wave - t * 5.0) * t))
            out.append(base + q)
        # keep the tail above the ground (it rests on it rather than sinking through): the lift each point
        # needs is spread smoothly along the tail so the curve bends instead of kinking
        H = self.J('hips')
        Hi = H.inverted()
        world = [H @ p for p in out]
        m = len(out)
        need = [max(0.0, self.tail_r(i / (m - 1)) * 0.9 + 0.01 - w.z) for i, w in enumerate(world)]
        if max(need) > 0.0:
            sig = 0.12 * (m - 1)
            lift = [max(need[j] * math.exp(-((i - j) / sig) ** 2) for j in range(m)) for i in range(m)]
            out = [Hi @ (w + Vector((0.0, 0.0, lift[i]))) for i, w in enumerate(world)]
        return out

    @staticmethod
    def tail_band(t: float) -> float:
        """Cross bands along the tail, -1 (dark) .. 1 (light), with soft but distinct edges."""
        w = math.sin(math.tau * (3.0 * t - 0.12))
        return math.copysign(abs(w) ** 0.55, w)

    def tail(self):
        ex = self.pose.get('extra', {})
        pts = self.tail_points(ex.get('tail', 0.0), ex.get('sway', 0.0), ex.get('wave', 0.0))
        n = len(pts)
        sides = 54
        R_ = self.tail_r

        def rad_fn(t, a):
            on = sstep((t - 0.1) / 0.2)
            lobes = 0.55 * math.cos(6 * a + t * 13.0) + 0.3 * math.cos(4 * a - t * 17.0 + 1.3) + 0.15 * math.cos(9 * a + t * 5.0 + 0.4)
            return R_(t) * (1.0 + on * 0.1 * lobes)

        v, f = tube(pts, rad_fn, sides)
        # colour index per vertex (0 dark brown .. 0.5 orange-brown .. 1 cream): cross bands along the tail,
        # lighter on the inner side of the curl, darker along the outer edge
        loop = pts[n // 5:]
        centre = sum(loop, Vector()) / len(loop)
        frames = rmf_frames(pts)
        cidx = []
        for i in range(n):
            t = i / (n - 1)
            tg = frames[i][0]
            inn = centre - pts[i]
            inn = inn - tg * inn.dot(tg)
            inn = inn.normalized() if inn.length > 1e-6 else Vector((0.0, 0.0, 1.0))
            band = self.tail_band(t)
            for k in range(sides):
                d = (Vector(v[i * sides + k]) - pts[i]).normalized()
                g = d.dot(inn)
                cidx.append(max(0.0, min(1.0, 0.47 + 0.2 * g + 0.4 * band)))
        rest = len(v) - n * sides
        cidx += [0.47 + 0.4 * self.tail_band(1.0)] * (rest // 2) + [0.47 + 0.4 * self.tail_band(0.0)] * (rest - rest // 2)
        mat = self.tail_mat('zip_tail')
        self.add('tail', (v, f), mat, 'hips', tip=cidx)
        mesh, tip = self.tail_brush(pts)
        self.add('tailbrush', mesh, mat, 'hips', tip=tip)

    def tail_brush(self, pts):
        """Soft flattened locks gathering into a brush at the end of the tail."""
        n = len(pts)
        frames = rmf_frames(pts)
        total = sum((pts[i] - pts[i - 1]).length for i in range(1, n))

        def at(t):
            if t >= 1.0:
                return pts[-1] + frames[-1][0] * ((t - 1.0) * total), frames[-1][1], frames[-1][2], self.tail_r(1.0)
            x = max(0.0, t) * (n - 1)
            i = min(n - 2, int(x))
            fr = x - i
            p = pts[i].lerp(pts[i + 1], fr)
            u = frames[i][1].lerp(frames[i + 1][1], fr).normalized()
            v = frames[i][2].lerp(frames[i + 1][2], fr).normalized()
            return p, u, v, self.tail_r(min(1.0, t))

        acc = MeshAcc()
        t0, span = 0.88, 0.16
        c0, c1 = 0.47 + 0.4 * self.tail_band(t0), 0.47 + 0.4 * self.tail_band(1.0)
        for k in range(6):
            a = (k + 0.3) / 6 * math.tau
            lp, nrm = [], []
            for q in range(8):
                s = q / 7
                p, u, v, r = at(t0 + span * s)
                d = u * math.cos(a) + v * math.sin(a)
                lp.append(p + d * r * (0.62 - 0.5 * s))
                nrm.append(d)
            mesh = flat_sweep(lp, lambda s: 0.13 * (1 - 0.8 * s ** 1.2), lambda s, nrm=nrm: nrm[min(7, int(round(s * 7)))], 0.4, 12)
            acc.add(mesh, flat_tip(8, 12, len(mesh[0]), c0, c1))
        return acc.mesh, acc.tip

    def tail_mat(self, name: str):
        """Tail fur: the 'tip' attribute holds a colour index (dark brown .. orange-brown .. cream) worked
        out per vertex in tail(); lighter fur tips towards the silhouette, a fine bump and a strong sheen."""
        c = self.C

        def make(n):
            m = lib.NT(n)
            t = m.node('ShaderNodeAttribute')
            t.attribute_name = 'tip'
            colr = m.ramp(t.outputs['Fac'], [(0.0, c['tail_a']), (0.3, c['tail_d']), (0.55, c['tail_m']), (0.8, c['tail_l']), (1.0, c['tail_b'])])
            lw = m.node('ShaderNodeLayerWeight')
            lw.inputs['Blend'].default_value = 0.3
            rim = m.maprange(lw.outputs['Facing'], 0.55, 0.95)
            colr = m.mix(m.math('MULTIPLY', rim, 0.22), colr, col(c['tail_l']))
            tc = m.node('ShaderNodeTexCoord')
            nz = m.noise(34.0, 4, 0.7, tc.outputs['Object'])
            nrm = m.bump(nz.outputs['Fac'], 0.12, 0.02)
            m.bsdf(colr, 0.66, normal=nrm, sheen=0.8, spec=0.25)
            return m.mat
        return self.m.get(name, make)


def curve_pts(ctrl, n: int = 10):
    return polyline_segment(catmull_rom([Vector(p) for p in ctrl], 8), 0.0, 1.0, n)
