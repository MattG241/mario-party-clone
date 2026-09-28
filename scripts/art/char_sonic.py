"""Sonic the Hedgehog as a chibi 3D hero (fan-made, private/non-commercial), loaded by characters.py as
class `Sonic`, built on the shared Hero structure (see char_models.py).

Cobalt-blue hedgehog: a big round head with six large quills swept back and slightly down (their tips
flick up a little), small pointed ears with peach insides, joined white eyes (one white shape with a
notch in the middle) and green irises, a peach muzzle with a small black nose and a lopsided confident
smirk, peach arms and a peach belly patch, two short spines on the back and a stubby tail, white gloves
with rolled cuffs, thin blue legs and big red sneakers with a white strap, a gold buckle and white cuffs.

The eyes are one decal wrapped onto the head: the union of two tilted ovals, cut by lid lines for the
narrowed / sad / determined looks, with the irises, pupils and highlights layered on top (all built as
fans in the face's tangent plane and wrapped with HeadShape.conform). The mouth lives on the muzzle,
which is its own ellipsoid (and HeadShape) set into the lower front of the head.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import I4, HeadShape, R, Skeleton, T, arc_points, ellipsoid, flat_sweep, superellipsoid, sweep, torus
from char_models import DEFAULT_FACE, Hero, hand_mitten


def _clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return max(a, min(b, x))


# ------------------------------------------------------------------------------------------
# Materials
def fur_mat(mats, name: str, color: str, rough: float = 0.46, bump: float = 0.05):
    """Short smooth fur: a soft sheen, a light coat and a very fine bump."""
    def make(n):
        m = lib.NT(n)
        tc = m.node('ShaderNodeTexCoord')
        nz = m.noise(60.0, 3, 0.6, tc.outputs['Object'])
        nrm = m.bump(nz.outputs['Fac'], bump, 0.02)
        m.bsdf(col(color), rough, normal=nrm, sheen=0.35, spec=0.4, coat=0.12)
        return m.mat
    return mats.get(name, make)


def belly_mat(mats, name: str, blue: str, peach: str, cx: float, cz: float, ax: float, az: float, front: float):
    """Blue fur with a peach oval on the front (object coordinates of a part in the chest frame)."""
    def make(n):
        m = lib.NT(n)
        obj = m.node('ShaderNodeTexCoord').outputs['Object']
        sp = m.sep(obj)
        dx = m.math('DIVIDE', m.math('SUBTRACT', sp[0], cx), ax)
        dz = m.math('DIVIDE', m.math('SUBTRACT', sp[2], cz), az)
        d = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', dx, dx), m.math('MULTIPLY', dz, dz)))
        inside = m.maprange(d, 1.0, 0.95)
        fr = m.maprange(sp[1], front + 0.03, front - 0.01)
        mask = m.math('MULTIPLY', inside, fr)
        c = m.mix(mask, col(blue), col(peach))
        nz = m.noise(60.0, 3, 0.6, obj)
        nrm = m.bump(nz.outputs['Fac'], 0.05, 0.02)
        m.bsdf(c, 0.46, normal=nrm, sheen=0.35, spec=0.4, coat=0.12)
        return m.mat
    return mats.get(name, make)


# ------------------------------------------------------------------------------------------
# 2D shapes for the face decals (u: his left, v: up, in the tangent plane of the face)
class Oval:
    """An ellipse centred at (cu, cv) with half axes a (across) and b (along its long axis), the long
    axis tilted `tilt` degrees from vertical towards +u."""

    def __init__(self, cu, cv, a, b, tilt=0.0):
        self.c = (cu, cv)
        self.a, self.b = a, b
        t = math.radians(tilt)
        self.m = (math.sin(t), math.cos(t))   # long axis
        self.n = (math.cos(t), -math.sin(t))  # short axis

    def local(self, u, v):
        du, dv = u - self.c[0], v - self.c[1]
        return du * self.n[0] + dv * self.n[1], du * self.m[0] + dv * self.m[1]

    def exit(self, p, d):
        """Distance along the ray p + t d (unit d) to where it leaves the ellipse (p inside)."""
        px, pz = self.local(*p)
        dx = d[0] * self.n[0] + d[1] * self.n[1]
        dz = d[0] * self.m[0] + d[1] * self.m[1]
        A = dx * dx / self.a ** 2 + dz * dz / self.b ** 2
        B = 2 * (px * dx / self.a ** 2 + pz * dz / self.b ** 2)
        Cc = px * px / self.a ** 2 + pz * pz / self.b ** 2 - 1.0
        disc = max(0.0, B * B - 4 * A * Cc)
        return max(0.0, (-B + math.sqrt(disc)) / (2 * A))

    def inside(self, u, v, k=1.0):
        x, z = self.local(u, v)
        return (x / self.a) ** 2 + (z / self.b) ** 2 < k


class Lid:
    """A half-plane cut: keeps the side below the line through (qu, qv) rising `slant` degrees towards +u."""

    def __init__(self, qu, qv, slant):
        s = math.radians(slant)
        self.q = (qu, qv)
        self.n = (-math.sin(s), math.cos(s))

    def exit(self, p, d):
        dn = d[0] * self.n[0] + d[1] * self.n[1]
        off = (p[0] - self.q[0]) * self.n[0] + (p[1] - self.q[1]) * self.n[1]
        if dn <= 1e-9:
            return 1e9 if off <= 0 else 0.0
        return max(0.0, -off / dn)

    def below(self, u, v):
        return (u - self.q[0]) * self.n[0] + (v - self.q[1]) * self.n[1] < 0

    def v_at(self, u):
        # the line's v at a given u
        return self.q[1] - (u - self.q[0]) * self.n[0] / self.n[1]


def fan(center, rfun, height, n: int = 72, m: int = 7):
    """A softly domed decal: a fan around `center` (u, v) whose rim along angle a lies at rfun(a);
    height(s) (s: 0 centre .. 1 rim) lifts it off the surface. Vertices are (u, -h, v): features are
    modelled facing -Y (see HeadShape.frame / Hero.feat)."""
    cu, cv = center
    verts = [(cu, -height(0.0), cv)]
    faces = []
    radii = [rfun(k / n * math.tau) for k in range(n)]
    for j in range(1, m + 1):
        s = 1.0 - (1.0 - j / m) ** 1.5  # denser towards the rim
        for k in range(n):
            a = k / n * math.tau
            r = radii[k] * s
            verts.append((cu + math.cos(a) * r, -height(s), cv + math.sin(a) * r))
    for k in range(n):
        k2 = (k + 1) % n
        faces.append((0, 1 + k, 1 + k2))
    for j in range(1, m):
        b0, b1 = 1 + (j - 1) * n, 1 + j * n
        for k in range(n):
            k2 = (k + 1) % n
            faces.append((b0 + k, b1 + k, b1 + k2, b0 + k2))
    return verts, faces


def plateau(top: float, rim: float = -0.004, edge: float = 0.28):
    """Height profile: flat at `top`, rolling off over the outer `edge` fraction to `rim`."""
    def h(s):
        f = _clamp((s - (1.0 - edge)) / edge)
        return rim + (top - rim) * math.sqrt(max(0.0, 1.0 - f * f))
    return h


def dir2(a):
    return (math.cos(a), math.sin(a))


class DampedSkeleton(Skeleton):
    """The hero's skeleton with some joints' pose rotations scaled down before solving (characters.py
    solves every pose through hero.skel, so the hand anchors and face point follow). damp maps a joint
    to (pitch-down factor, pitch-up factor, roll factor, yaw factor)."""

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
class Sonic(Hero):
    """Sonic the Hedgehog: cobalt-blue hedgehog — six swept quills, joined eyes, red sneakers."""

    key = 'sonic'
    ankle_h = 0.145
    hip_h = 0.61
    spine = 0.07
    chest = 0.15
    neck = 0.1
    head_up = 0.04
    shoulder = (0.182, 0.0, 0.08)
    upper_arm = 0.19
    forearm = 0.175
    hip_w = 0.088
    thigh = 0.21
    shin = 0.22
    sit_h = 0.16

    HEAD = (0.48, 0.44, 0.43, 0.45)  # rx, ry, rz, centre height above the head joint
    C = dict(blue='#1f55d6', blue_q='#1a4bc4', blue_ql='#2f68ea', peach='#f5c595', peach_d='#e6a978', white='#fbfbf7',
             glove='#fdfdf9', shoe='#dd2230', shoe_d='#b5172a', strap='#fbfaf4', gold='#f1b829', sole='#ece4d6',
             iris='#28a348', iris_d='#156f30', nose='#17161c', mouth='#5a1d22', tongue='#e3707a', teeth='#fffdf6',
             line='#15183a')
    EYE_PITCH = 15.0

    def __init__(self, mats):
        super().__init__(mats)
        # his big head and quills: nodding far down would turn the quills into a crown and hide the face
        self.skel = DampedSkeleton(self.skel, {'neck': (0.45, 1.0, 1.0, 1.0), 'head': (0.55, 1.0, 1.0, 1.0)})

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.16

    # --- building -----------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            blue=fur_mat(mt, 'sonic_blue', c['blue']),
            belly=belly_mat(mt, 'sonic_belly', c['blue'], c['peach'], 0.0, -0.12, 0.142, 0.215, -0.1),
            quill=mt.hair('sonic_quill', c['blue_q'], c['blue_ql'], 0.42),
            peach=mt.skin('sonic_peach', c['peach']),
            peach_d=mt.skin('sonic_peach_d', c['peach_d']),
            glove=mt.cloth('sonic_glove', c['glove'], 0.55, 0.3),
            shoe=mt.glossy('sonic_shoe', c['shoe'], 0.34, 0.35),
            shoe_d=mt.glossy('sonic_shoe_d', c['shoe_d'], 0.4, 0.3),
            strap=mt.cloth('sonic_strap', c['strap'], 0.5, 0.2),
            gold=mt.metal('sonic_gold', c['gold'], 0.28),
            sole=mt.cloth('sonic_sole', c['sole'], 0.6, 0.1),
            white=mt.glossy('sonic_eye_white', c['white'], 0.2, 0.7),
            iris=mt.glossy('sonic_iris', c['iris'], 0.22, 0.8),
            iris_d=mt.glossy('sonic_iris_d', c['iris_d'], 0.25, 0.8),
            pupil=mt.glossy('sonic_pupil', '#0d0d12', 0.25, 0.9),
            shine=mt.emit('sonic_shine', '#ffffff', 3.0),
            nose=mt.glossy('sonic_nose', c['nose'], 0.22, 0.8),
            mouth=mt.glossy('sonic_mouth', c['mouth'], 0.4, 0.2),
            tongue=mt.glossy('sonic_tongue', c['tongue'], 0.35, 0.3),
            teeth=mt.glossy('sonic_teeth', c['teeth'], 0.25, 0.4),
            line=mt.glossy('sonic_line', c['line'], 0.4, 0.2),
        )
        self.torso()
        self.legs()
        self.arms()
        self.head_parts()

    # --- torso -----------------------------------------------------------------------------------
    def torso(self):
        M = self.mat
        prof = lambda t: 0.176 + 0.012 * math.sin(math.pi * t * 0.8) - 0.03 * t * t  # noqa: E731
        z0, z1 = -0.31, 0.1
        pts = [Vector((0, 0, z0 + (z1 - z0) * i / 10)) for i in range(11)]
        self.add('torso', sweep(pts, prof, 26, cap0=False, squash=0.86), M['belly'], 'chest')
        self.add('shoulders', ellipsoid(0.165, 0.135, 0.075, 24, 12, center=(0, 0, 0.1), zmin=-0.2), M['blue'], 'chest')
        # a short neck up into the head
        self.add('neck', sweep([Vector((0, 0.01, 0.05)), Vector((0, 0.01, 0.24))], 0.085, 16), M['blue'], 'chest')
        self.add('pelvis', superellipsoid(0.172, 0.148, 0.14, 2.4, 26, 14, center=(0, 0, -0.035)), M['blue'], 'hips')
        # two short spines on the back, a stubby tail
        for sd in (1, -1):
            base = Vector((0.055 * sd, 0.09, -0.02))
            d = Vector((0.3 * sd, 1.0, -0.42)).normalized()
            pts = [base + d * (0.2 * t) + Vector((0, 0, 0.05 * t * t)) for t in (k / 8 for k in range(9))]
            self.add('backspine', sweep(pts, lambda t: 0.07 * (1 - t) ** 1.1 + 0.006, 12), M['quill'], 'chest',
                     tip=spine_tip(9, 12, len(sweep(pts, 0.01, 12)[0])))
        base = Vector((0.0, 0.1, -0.06))
        d = Vector((0.0, 1.0, 0.25)).normalized()
        pts = [base + d * (0.14 * t) for t in (k / 6 for k in range(7))]
        self.add('tail', sweep(pts, lambda t: 0.06 * (1 - t) ** 0.8 + 0.01, 12), M['blue'], 'hips')

    # --- legs ------------------------------------------------------------------------------------
    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.062 - 0.012 * t, M['blue'], 0.0, 0.97, 12, 14)
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.shoe(fm, s_, sd)

    def shoe(self, fm: Matrix, s_: str, sd: int):
        M = self.mat
        self.add('shoe' + s_, superellipsoid(0.112, 0.19, 0.088, 2.4, 24, 14, center=(0, -0.07, -0.05)), M['shoe'], None, fm)
        self.add('toe' + s_, ellipsoid(0.112, 0.12, 0.084, 20, 12, center=(0, -0.19, -0.062)), M['shoe'], None, fm @ R(-8, 0, 0))
        self.add('sole' + s_, superellipsoid(0.124, 0.226, 0.03, 3.0, 24, 8, center=(0, -0.085, -0.117)), M['sole'], None, fm)
        # white cuff round the top of the shoe
        self.add('cuff' + s_, torus(0.072, 0.034, 22, 10, center=(0, 0.0, 0.02), squash=1.2), M['strap'], None, fm)
        # strap across the instep with a gold buckle on the outer side
        pts, nrm = [], []
        c0 = Vector((0.0, -0.1, -0.06))
        for i in range(13):
            a = math.radians(-100 + 200 * i / 12)
            p = Vector((math.sin(a) * 0.118, -0.1 - 0.012 * math.cos(a), -0.06 + math.cos(a) * 0.1))
            pts.append(p)
            nrm.append((p - c0).normalized())
        self.add('strap' + s_, flat_sweep(pts, 0.036, lambda t: nrm[min(12, int(round(t * 12)))], 0.34, 12), M['strap'], None, fm)
        bm = fm @ T(0.118 * sd, -0.1, -0.035) @ R(0, 0, 90 * sd)
        self.add('buckle' + s_, superellipsoid(0.03, 0.012, 0.026, 3.5, 12, 8), M['gold'], None, bm)

    # --- arms ------------------------------------------------------------------------------------
    def arms(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.05 - 0.006 * t, M['peach'], 0.0, 0.62, 12, 10, cap1=False)
            # white gloves from just below the elbow: a gauntlet with a rolled cuff at its top
            self.limb('gauntlet' + s_, sh, el, wr, lambda t: 0.05 + 0.004 * t, M['glove'], 0.58, 1.0, 12, 8, extend=0.02, cap0=False)
            self.add('gcuff' + s_, torus(0.062, 0.03, 20, 10, squash=1.3), M['glove'], None, self.limb_frame(sh, el, wr, 0.6, wr))
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.32):
                self.add('glove' + nm + s_, mesh, M['glove'], None, wm)

    # --- head ------------------------------------------------------------------------------------
    def head_parts(self):
        M = self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 44, 28, center=(0, 0, hc))
        # a slightly fuller back of the skull, a little narrower towards the chin
        out = []
        for (x, y, z) in hv:
            u = (z - hc) / hz
            x *= 1 - 0.07 * max(0.0, -u) ** 1.5
            if u > 0:
                z = hc + (z - hc) * (1 - 0.06 * u ** 2)
            out.append((x, y, z))
        self.add('head', (out, hf), M['blue'], 'head')
        # muzzle: its own ellipsoid set into the lower front of the head
        mc = Vector((0.0, -0.29, hc - 0.19))
        mr = (0.27, 0.235, 0.205)
        self.muzzle = HeadShape(*mr, center=tuple(mc))
        mv, mf = ellipsoid(*mr, 32, 20, center=tuple(mc))
        self.add('muzzle', (mv, mf), M['peach'], 'head')
        nf = self.muzzle.frame(0, 17, -0.006)
        self.add('nose', ellipsoid(0.068, 0.052, 0.05, 18, 12), M['nose'], 'head', nf)
        self.add('noseshine', ellipsoid(0.019, 0.005, 0.013, 8, 5, center=(-0.022, -0.05, 0.018)), M['shine'], 'head', nf)
        self.ears(head)
        self.eyes(head)
        self.mouth()
        self.quills(head)

    def ears(self, head: HeadShape):
        M = self.mat
        for sd in (1, -1):
            pos, _n = head.point(35 * sd, 50, -0.05)
            d = Vector((0.55 * sd, 0.1, 1.0)).normalized()
            nrm = Vector((0.3 * sd, -1.0, 0.25)).normalized()
            pts = [pos + d * (0.31 * t) + Vector((0, 0.035 * t * t, 0)) for t in (k / 8 for k in range(9))]
            self.add('ear', flat_sweep(pts, lambda t: 0.135 * (1 - t) ** 0.9 + 0.006, nrm, 0.4, 16), M['blue'], 'head')
            ipts = [p + nrm * (0.034 * (1 - 0.6 * k / 8)) for k, p in enumerate(pts[1:7], 1)]
            self.add('earin', flat_sweep(ipts, lambda t: 0.092 * (1 - t) ** 0.9 + 0.005, nrm, 0.28, 14), M['peach'], 'head')

    # quills: root (yaw, pitch) on the head, direction (x: his left, y: back, z: up), length, root radius,
    # upward flick of the tip
    QUILLS = [
        (180, 42, (0.0, 1.0, -0.3), 0.8, 0.24, 0.34),
        (180, 12, (0.0, 1.0, -0.55), 0.76, 0.235, 0.3),
        (180, -18, (0.0, 1.0, -0.85), 0.64, 0.21, 0.24),
        (124, 6, (1.0, 0.8, -0.78), 0.62, 0.2, 0.12),
        (-124, 6, (-1.0, 0.8, -0.78), 0.62, 0.2, 0.12),
    ]

    def quills(self, head: HeadShape):
        M = self.mat
        verts, faces, tip = [], [], []
        up = Vector((0.0, 0.0, 1.0))
        for (yaw, pitch, dvec, L, r0, flick) in self.QUILLS:
            root, n = head.point(yaw, pitch, -0.12)
            d = Vector(dvec).normalized()
            pts = [root + d * (L * t) + up * (flick * L * t * t) for t in (k / 12 for k in range(13))]
            v, f = sweep(pts, lambda t, r0=r0: r0 * (1 - t) ** 1.05 + 0.007, 14)
            b = len(verts)
            verts.extend(v)
            faces.extend(tuple(q + b for q in fc) for fc in f)
            tip.extend(spine_tip(13, 14, len(v)))
        self.add('quills', (verts, faces), M['quill'], 'head', tip=tip)

    # --- face --------------------------------------------------------------------------------------
    def face_state(self):
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        return f

    def eyes(self, head: HeadShape):
        M = self.mat
        f = self.face_state()
        eyes, brows = f['eyes'], f['brows']
        lx, lz = f.get('look', (0.0, 0.0))
        fr = head.frame(0, self.EYE_PITCH, 0.0)
        ex, ea, eb, tilt = 0.108, 0.162, 0.218, 15.0
        wide = eyes == 'wide'
        k = 1.07 if wide else 1.0
        # lid cut per eye: level (fraction of the half height above the centre) and slant (towards the outer side)
        lid = {'half': (0.05, 0.0), 'sad': (0.3, -16.0), 'determined': (0.34, 20.0)}.get(eyes)
        if lid is None:
            lid = {'neutral': (0.74, 12.0), 'up': (2.0, 0.0), 'worried': (0.56, -14.0), 'sad': (0.5, -16.0),
                   'angry': (0.42, 24.0), 'determined': (0.46, 20.0)}.get(brows, (0.74, 12.0))
            if wide:
                lid = (2.0, 0.0)
        level, slant = lid
        ovals, lids = [], []
        for side in (1, -1):
            o = Oval(ex * side * k, 0.0, ea * k, eb * k, tilt * side)
            ovals.append(o)
            lids.append(Lid(ex * side * k, eb * k * level, slant * side))
        kinds = {1: eyes, -1: eyes}
        if eyes == 'wink':
            kinds = {1: 'open', -1: 'happy'}
        shut = {s: kinds[s] in ('happy', 'closed') for s in (1, -1)}
        white_th = 0.02
        c0 = (0.0, -0.035)
        if not all(shut.values()):
            def r_white(a):
                d = dir2(a)
                best = 0.0
                for side, o, ld in zip((1, -1), ovals, lids):
                    if shut[side]:
                        continue
                    best = max(best, min(o.exit(c0, d), ld.exit(c0, d)))
                return best
            center = c0
            if any(shut.values()):
                # one eye only (wink): fan from that eye's own centre
                side = 1 if not shut[1] else -1
                o, ld = ovals[0 if side == 1 else 1], lids[0 if side == 1 else 1]
                center = (o.c[0], min(o.c[1] - 0.02, ld.v_at(o.c[0]) - 0.04))

                def r_white(a, o=o, ld=ld, center=center):
                    d = dir2(a)
                    return min(o.exit(center, d), ld.exit(center, d))
            self.feat('eyewhite', fan(center, r_white, plateau(white_th), 96, 8), M['white'], 'head', head, fr)
        for side, o, ld in zip((1, -1), ovals, lids):
            nm = 'L' if side > 0 else 'R'
            kind = kinds[side]
            if kind in ('happy', 'closed'):
                cu = o.c[0]
                if kind == 'happy':
                    pts = arc_points(ea * 1.5, -eb * 0.4, 14, y=-0.012)
                    pts = [p + Vector((cu, 0, -eb * 0.05)) for p in pts]
                else:
                    pts = arc_points(ea * 1.45, eb * 0.18, 14, y=-0.012)
                    pts = [p + Vector((cu, 0, -eb * 0.12)) for p in pts]
                self.feat('shut' + nm, sweep(pts, lambda t: 0.009 + 0.006 * math.sin(math.pi * t), 8), M['line'], 'head', head, fr)
                continue
            if kind == 'dizzy':
                pts = []
                for i in range(44):
                    a = i / 44 * math.tau * 2.3
                    r = 0.01 + (ea * 0.8 - 0.01) * i / 44
                    pts.append(Vector((o.c[0] + math.cos(a) * r * side, -white_th - 0.004, math.sin(a) * r * 1.2 - 0.01)))
                self.feat('spiral' + nm, sweep(pts, 0.008, 6), M['line'], 'head', head, fr)
                continue
            # iris, pupil and highlights, clipped by the eye oval and the lid
            ir = 0.8 if wide else 1.0
            ia, ib = 0.092 * ir, 0.122 * ir
            icu = o.c[0] - 0.024 * side + lx * 0.034
            icv = -0.018 + lz * 0.03
            icv = min(icv, ld.v_at(icu) - 0.028)
            ic = (icu, icv)
            iris_o = Oval(icu, icv, ia, ib, 4.0 * side)

            def clip(a, center, shape, o=o, ld=ld):
                d = dir2(a)
                return min(shape.exit(center, d), o.exit(center, d) * 0.985, ld.exit(center, d))

            hi = white_th + 0.0025
            self.feat('iris' + nm, fan(ic, lambda a: clip(a, ic, iris_o), plateau(hi + 0.002, hi - 0.001, 0.2), 48, 5),
                      M['iris'], 'head', head, fr)
            pc = (icu + 0.004 * side + lx * 0.008, icv - 0.004 + lz * 0.008)
            pupil_o = Oval(pc[0], pc[1], ia * 0.5, ib * 0.54, 4.0 * side)
            self.feat('pupil' + nm, fan(pc, lambda a: clip(a, pc, pupil_o), plateau(hi + 0.0045, hi + 0.001, 0.2), 32, 4),
                      M['pupil'], 'head', head, fr)
            for j, (du, dv, sa, sb) in enumerate(((-0.34, 0.4, 0.3, 0.3), (0.36, -0.42, 0.13, 0.13))):
                sc = (icu + du * ia, icv + dv * ib)
                if not ld.below(sc[0], sc[1] + ib * sb) or not o.inside(*sc, 0.8):
                    continue
                sh_o = Oval(sc[0], sc[1], ia * sa, ib * sb * 0.9)
                self.feat(f'shine{j}{nm}', fan(sc, lambda a, sc=sc, sh_o=sh_o: sh_o.exit(sc, dir2(a)), plateau(hi + 0.006, hi + 0.003, 0.2), 20, 3),
                          M['shine'], 'head', head, fr)

    def mouth(self):
        M = self.mat
        mz = self.muzzle
        f = self.face_state()
        mouth = f['mouth']
        # lopsided: the mouth sits a little towards his left (+X, the side nearer the camera in 3/4 views)
        mf = mz.frame(9, -12, 0.0)
        w = 0.2
        line = lambda t: 0.0085 + 0.0035 * math.sin(math.pi * t)  # noqa: E731
        if mouth in ('smile', 'smirk'):
            # confident smirk: a curve rising to his left, a little dimple at the raised corner
            pts = []
            for i in range(15):
                t = i / 14 * 2 - 1
                z = -0.024 * (1 - t * t) + 0.024 * t + 0.012 * max(0.0, t) ** 3
                pts.append(Vector((t * w / 2, -0.006, z)))
            self.feat('mouth', sweep(pts, line, 8), M['mouth'], 'head', mz, mf)
            end = pts[-1]
            dim = [end + Vector((-0.006, 0, -0.014)), end + Vector((0.004, 0, 0.0)), end + Vector((0.006, 0, 0.016))]
            self.feat('dimple', sweep(dim, 0.0065, 6), M['mouth'], 'head', mz, mf)
        elif mouth in ('grin', 'open', 'laugh'):
            hh = {'grin': 0.05, 'open': 0.062, 'laugh': 0.078}[mouth]
            ww = w * (1.0 if mouth == 'grin' else 0.92)
            g = mf @ R(0, -7, 0)
            self.feat('mouth', ellipsoid(ww / 2, 0.02, hh, 24, 12, zmax=0.12), M['mouth'], 'head', mz, g @ T(0, 0.004, 0.008))
            self.feat('tongue', ellipsoid(ww * 0.28, 0.012, hh * 0.42, 14, 8, center=(0.01, -0.01, -hh * 0.62)), M['tongue'], 'head', mz, g)
            self.feat('teeth', ellipsoid(ww * 0.4, 0.01, 0.014, 16, 6, center=(0, -0.013, -0.004)), M['teeth'], 'head', mz, g)
        elif mouth == 'o':
            self.feat('mouth', ellipsoid(0.03, 0.018, 0.036, 16, 10), M['mouth'], 'head', mz, mf @ T(-0.01, 0.004, -0.006))
        elif mouth == 'gasp':
            self.feat('mouth', ellipsoid(0.042, 0.02, 0.056, 16, 10), M['mouth'], 'head', mz, mf @ T(-0.01, 0.004, -0.014))
            self.feat('tongue', ellipsoid(0.022, 0.01, 0.018, 12, 6, center=(-0.01, -0.012, -0.046)), M['tongue'], 'head', mz, mf)
        elif mouth == 'frown':
            self.feat('mouth', sweep(arc_points(w * 0.7, -0.022, 12, y=-0.006), line, 8), M['mouth'], 'head', mz, mf @ T(-0.01, 0, -0.012))
        elif mouth == 'flat':
            pts = [Vector((-w * 0.3, -0.006, -0.004)), Vector((w * 0.34, -0.006, 0.006))]
            self.feat('mouth', sweep(pts, 0.0085, 8), M['mouth'], 'head', mz, mf)
        elif mouth == 'wobble':
            pts = [Vector(((i / 12 - 0.5) * w * 0.8, -0.006, math.sin(i / 12 * math.tau * 1.5) * 0.011)) for i in range(13)]
            self.feat('mouth', sweep(pts, 0.0085, 8), M['mouth'], 'head', mz, mf)


def spine_tip(n: int, sides: int, nverts: int):
    """'tip' values for a sweep of n rings (0 at the root .. 1 at the point), then the end and start caps."""
    tip = []
    for i in range(n):
        tip += [i / max(1, n - 1)] * sides
    rest = nverts - n * sides
    return tip + [1.0] * (rest // 2) + [0.0] * (rest - rest // 2)
