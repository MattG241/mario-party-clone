"""Mimi, the Creature Helper: a small fluffy festival NPC in the heroes' 3D look (rendered by npcs.py).

A chibi creature built on char_models.Hero: a big, wide head (a cream face mask under blue fur that
comes down to a widow's peak between the eyes, puffy cheeks with cream tufts), huge fan-shaped ears
(blue fur outside, a cream band and a peach centre inside, softly scalloped rims), a green
three-leaf sprout growing from a brown seed on the forehead, a round cream body on stubby legs with
big round feet (peach pads underneath), chunky blue arms with round cream paws (peach pads on the
open ones) and a big fluffy plume of a tail, blue outside and cream inside, sticking out behind her
right side. Costume: a green leaf scarf (a collar with pointed ends, leaf tips at the sides and
back) pinned with a round wooden clover badge, and a brown satchel on her right hip.

Colour zones (face mask, ears, arms, tail) are per-vertex 'tip' values read by ramp materials, so
the fur borders stay soft and follow the geometry in every pose. The face is the shared Hero.face()
(eyes, blush) with her own cat mouth, no brows and bolder lid lines so it reads at crowd size.

Pose extras: 'ears' (elevation of the left / right ear in degrees: 0 points out to the side, 90
straight up), 'tail' (0 relaxed, 1 lifted and streaming out), 'apple' (hugs a big red apple) and
'alert' (two yellow alert ticks over her head).
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from char_rig import (HeadShape, R, T, arc_points, curve3, disc, ellipsoid, flat_sweep, polyline_segment, rad, rmf_frames,
                      superellipsoid, sweep, torus)
from char_models import DEFAULT_FACE, Hero
from char_mossi import Batch, frame_at, leaf, leaf_width, ramp_mat
from char_zippa import MeshAcc, catmull_rom, flat_tip, interp, sstep, tube
from char_anims import IDLE_YAW, face, pose, swing


def clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return max(a, min(b, x))


def direction(yaw: float, pitch: float) -> Vector:
    """Unit direction: yaw 0 = front (-Y), +90 = the character's left (+X); pitch up from horizontal."""
    y, p = rad(yaw), rad(pitch)
    return Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))


def lin_interp(points, x: float) -> float:
    """Piecewise-linear interpolation through (x, y) control points (clamped at the ends)."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return points[-1][1]


def zone_mat(mats, name: str, stops, rough: float = 0.62, sheen: float = 0.7, bump: float = 0.12, scale: float = 38.0,
             fuzz: float = 0.0):
    """Fur coloured by a ramp over the per-vertex 'tip' attribute (a colour-zone index), with the heroes'
    fine fur bump and sheen. fuzz > 0 breaks the zone borders up a little, like fur."""
    def make(n):
        m = lib.NT(n)
        a = m.node('ShaderNodeAttribute')
        a.attribute_name = 'tip'
        tc = m.node('ShaderNodeTexCoord')
        obj = tc.outputs['Object']
        fac = a.outputs['Fac']
        if fuzz:
            nz2 = m.noise(22.0, 3, 0.6, obj)
            fac = m.math('ADD', fac, m.math('MULTIPLY', m.math('SUBTRACT', nz2.outputs['Fac'], 0.5), fuzz))
        c = m.ramp(fac, stops)
        nz = m.noise(scale, 4, 0.7, obj)
        nrm = m.bump(nz.outputs['Fac'], bump, 0.02)
        m.bsdf(c, rough, normal=nrm, sheen=sheen, spec=0.3)
        return m.mat
    return mats.get(name, make)


class FluffHead(HeadShape):
    """The head ellipsoid plus soft bumps (cheeks, muzzle). point() and surface() follow the bumped
    surface, so the features Hero.face() places and wraps sit on it; surf() also builds the head mesh."""

    def __init__(self, rx, ry, rz, center, bumps):
        super().__init__(rx, ry, rz, center)
        self.bumps = bumps  # [(unit direction, angular radius in degrees, height)]

    def surf(self, d: Vector) -> Vector:
        d = Vector(d).normalized()
        r = self.r
        k = 1.0 / math.sqrt((d.x / r.x) ** 2 + (d.y / r.y) ** 2 + (d.z / r.z) ** 2)
        pos = self.c + d * k
        n = Vector(((pos.x - self.c.x) / r.x ** 2, (pos.y - self.c.y) / r.y ** 2, (pos.z - self.c.z) / r.z ** 2)).normalized()
        h = 0.0
        for bd, ang, amp in self.bumps:
            a = math.degrees(math.acos(max(-1.0, min(1.0, d.dot(bd)))))
            h += amp * sstep(1.0 - a / ang)
        return pos + n * h

    def surface(self, d):
        d = Vector(d).normalized()
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
        return pos, n

    def point(self, yaw: float, pitch: float, lift: float = 0.0):
        pos, n = self.surface(direction(yaw, pitch))
        return pos + n * lift, n


# ------------------------------------------------------------------------------------------
# Geometry
def ear_mesh(L: float, W: float, cup: float = 0.07, thick: float = 0.13, rim: float = 0.07, bend: float = 0.06,
             lobes: int = 10, lobe_amp: float = 0.03, n_around: int = 96, n_front: int = 10, n_rim: int = 6, n_back: int = 6):
    """A big cupped ear in its own frame: the root at the origin, growing along +Z to the tip at z = L,
    the inner (front) face towards -Y, width W either side along X. The rim is scalloped into soft
    lobes towards the tip. Returns (verts, faces, zone): zone runs 0 at the centre of the inner face
    to about 1 at its rim (more towards the tip) and is 1 on the rim and the back (a colour index)."""
    c = Vector((0.0, 0.0, 0.4 * L))

    def half_w(u):
        return W * max(0.0, math.sin(math.pi * clamp(u) ** 1.25)) ** 0.62

    outline, us = [], []
    for k in range(n_around):
        phi = k / n_around * math.tau
        u = 0.5 - 0.5 * math.cos(phi)
        x = half_w(u) * (1.0 if math.sin(phi) >= 0 else -1.0)
        p = Vector((x, 0.0, u * L))
        f = sstep((u - 0.25) / 0.35)
        wob = math.cos(lobes * phi) + 0.6 * math.cos((lobes + 7) * phi + 1.1) + 0.4 * math.cos((lobes - 4) * phi + 0.4)
        outline.append(c + (p - c) * (1.0 + lobe_amp * f * wob))
        us.append(u)
    # outward normals of the outline (in the ear plane)
    out_n = []
    for k in range(n_around):
        t = outline[(k + 1) % n_around] - outline[k - 1]
        nv = Vector((t.z, 0.0, -t.x)).normalized()
        if nv.dot(outline[k] - c) < 0:
            nv = -nv
        out_n.append(nv)

    def y_front(rho):
        return cup * (1.0 - rho * rho)

    def y_back(rho):
        return cup * (1.0 - rho * rho) + rim + (thick - rim) * (1.0 - rho * rho) ** 0.8

    verts, zone, rings = [], [], []

    def add(p, z):
        p = Vector(p)
        p.y += bend * (max(0.0, p.z) / L) ** 2
        verts.append(tuple(p))
        zone.append(z)
        return len(verts) - 1

    rings.append(add(c + Vector((0.0, y_front(0.0), 0.0)), 0.0))
    for j in range(1, n_front + 1):
        rho = j / n_front
        rings.append([add(c + (outline[k] - c) * rho + Vector((0.0, y_front(rho), 0.0)),
                          rho * (0.8 + 0.4 * sstep(us[k]))) for k in range(n_around)])
    for m in range(1, n_rim):
        a = math.pi * m / n_rim
        rings.append([add(outline[k] + out_n[k] * (rim * 0.5 * math.sin(a)) + Vector((0.0, rim * 0.5 * (1.0 - math.cos(a)), 0.0)), 1.0)
                      for k in range(n_around)])
    for j in range(n_back, 0, -1):
        rho = j / n_back
        rings.append([add(c + (outline[k] - c) * rho + Vector((0.0, y_back(rho), 0.0)), 1.0) for k in range(n_around)])
    rings.append(add(c + Vector((0.0, y_back(0.0), 0.0)), 1.0))

    faces = []
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(n_around):
            k2 = (k + 1) % n_around
            if isinstance(a, int):
                faces.append((a, b[k], b[k2]))
            elif isinstance(b, int):
                faces.append((a[k], b, a[k2]))
            else:
                faces.append((a[k], b[k], b[k2], a[k2]))
    return verts, faces, zone


def lathe_mesh(profile, sides: int = 32, squash: float = 1.0):
    """Revolve a (radius, z) profile about Z (depth squashed); both ends closed with a pole."""
    verts, faces = [], []
    n = len(profile)
    verts.append((0.0, 0.0, profile[0][1]))
    for r, z in profile[1:-1]:
        for k in range(sides):
            a = k / sides * math.tau
            verts.append((math.cos(a) * r, math.sin(a) * r * squash, z))
    verts.append((0.0, 0.0, profile[-1][1]))
    top = len(verts) - 1
    rows = n - 2
    for k in range(sides):
        k2 = (k + 1) % sides
        faces.append((0, 1 + k2, 1 + k))
    for i in range(rows - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            a, b = 1 + i * sides + k, 1 + i * sides + k2
            faces.append((a, b, b + sides, a + sides))
    last = 1 + (rows - 1) * sides
    for k in range(sides):
        k2 = (k + 1) % sides
        faces.append((last + k, last + k2, top))
    return verts, faces


def smooth_profile(ctrl, steps: int = 6):
    """A dense (radius, z) profile through (radius, z) control points (Catmull-Rom)."""
    pts = catmull_rom([Vector((r, z, 0.0)) for r, z in ctrl], steps)
    return [(max(0.0, p.x), p.y) for p in pts]


def tick_mesh(length: float, w0: float, w1: float, depth: float = 0.03):
    """A flat wedge (alert tick) along +Z from width w0 at z = 0 to w1 at z = length, facing -Y."""
    q = [(-w0 / 2, 0.0), (w0 / 2, 0.0), (w1 / 2, length), (-w1 / 2, length)]
    verts = [(x, -depth / 2, z) for x, z in q] + [(x, depth / 2, z) for x, z in q]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return verts, faces


# ------------------------------------------------------------------------------------------
class Mimi(Hero):
    """Mimi: a fluffy blue-and-cream creature with huge ears, a leaf sprout, leaf scarf and satchel."""

    key = 'mimi'
    ankle_h = 0.1
    hip_h = 0.28
    spine = 0.06
    chest = 0.16
    neck = 0.1
    head_up = 0.04
    shoulder = (0.28, -0.04, 0.09)
    upper_arm = 0.15
    forearm = 0.14
    hip_w = 0.2
    thigh = 0.07
    shin = 0.07
    sit_h = 0.2

    HEAD = (0.5, 0.43, 0.37, 0.4)  # rx, ry, rz, centre height above the head joint
    EYE = (31.0, 7.0)  # eye yaw / pitch on the head
    EYE_SIZE = (0.14, 0.16)

    C = dict(blue='#4f95d6', blue_d='#3b7cc2', blue_l='#6fb0e6', cream='#ecca98', cream_l='#f4dcb6', peach='#ee8c58', peach_d='#e8723e',
             pad='#f2a07e', nose='#e8787a', iris='#4e240c', scarf='#7cab28', wood='#a4602c', wood_d='#7c4520',
             badge='#e9c84a', clover='#4c9a2c', bag='#7c4424', bag_d='#5e3218', strap='#6a3a1c', button='#33b0a0', seed='#b0703a',
             seed_d='#8a5228', apple='#e0242a', stem='#6b4220', tick='#f5a300')
    LEAF = [(0.0, '#3d7a1a'), (0.3, '#5c9c26'), (0.6, '#86bd33'), (0.85, '#a8d444'), (1.0, '#c4e45e')]

    # tail control points in the hips frame (x: her left, y: back, z: up): relaxed / lifted (streaming out)
    TAIL = [(-0.12, 0.16, -0.1), (-0.3, 0.2, -0.12), (-0.48, 0.2, -0.06), (-0.6, 0.17, 0.04), (-0.66, 0.13, 0.16),
            (-0.66, 0.1, 0.27), (-0.6, 0.08, 0.36)]
    TAIL_UP = [(-0.12, 0.16, -0.1), (-0.32, 0.22, -0.06), (-0.52, 0.24, 0.02), (-0.68, 0.22, 0.12), (-0.78, 0.18, 0.22),
               (-0.82, 0.14, 0.32), (-0.8, 0.12, 0.4)]

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.3

    # --- building -----------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            cream=mt.fur('mimi_cream', c['cream']),
            head=zone_mat(mt, 'mimi_head', [(0.35, c['cream']), (0.65, c['blue'])], fuzz=0.25),
            ear=zone_mat(mt, 'mimi_ear', [(0.0, c['peach_d']), (0.28, c['peach']), (0.4, '#f0ae7c'), (0.5, '#f0cc9e'), (0.66, c['cream']),
                                          (0.76, c['blue_l']), (0.86, c['blue']), (1.0, c['blue_d'])], fuzz=0.14),
            arm=zone_mat(mt, 'mimi_arm', [(0.8, c['blue']), (0.92, c['cream'])], fuzz=0.12),
            tail=zone_mat(mt, 'mimi_tail', [(0.0, c['cream_l']), (0.45, c['cream']), (0.6, c['blue_l']), (0.85, c['blue']), (1.0, c['blue'])],
                          fuzz=0.15),
            tuft=mt.hair('mimi_tuft', c['cream'], c['cream_l'], 0.6),
            pad=mt.skin('mimi_pad', c['pad']),
            nose=mt.glossy('mimi_nose', c['nose'], 0.3, 0.5),
            leaf=ramp_mat(mt, 'mimi_leaf', self.LEAF, 0.42, 0.35, 0.15),
            scarf=mt.cloth('mimi_scarf', c['scarf'], 0.7, 0.45, 0.06),
            wood=mt.cloth('mimi_wood', c['wood'], 0.5, 0.2, 0.12, 30),
            wood_d=mt.cloth('mimi_wood_d', c['wood_d'], 0.5, 0.2),
            badge=mt.glossy('mimi_badge', c['badge'], 0.35, 0.4),
            clover=mt.glossy('mimi_clover', c['clover'], 0.35, 0.4),
            bag=mt.cloth('mimi_bag', c['bag'], 0.55, 0.2, 0.15, 25),
            bag_d=mt.cloth('mimi_bag_d', c['bag_d'], 0.55, 0.2),
            strap=mt.cloth('mimi_strap', c['strap'], 0.6, 0.2),
            button=mt.glossy('mimi_button', c['button'], 0.25, 0.7),
            seed=mt.glossy('mimi_seed', c['seed'], 0.4, 0.3),
            seed_d=mt.glossy('mimi_seed_d', c['seed_d'], 0.45, 0.2),
            apple=mt.glossy('mimi_apple', c['apple'], 0.22, 0.8),
            stem=mt.cloth('mimi_stem', c['stem'], 0.6, 0.2),
            tick=mt.emit('mimi_tick', c['tick'], 0.7),
        )
        self.body()
        self.legs()
        self.arms()
        self.head_parts()
        self.tail()
        self.scarf()
        self.satchel()
        ex = self.pose.get('extra', {})
        if ex.get('apple'):
            self.apple()
        if ex.get('alert'):
            self.alert_ticks()

    # --- body ---------------------------------------------------------------------------------
    BODY = [(0.0, 0.085), (0.13, 0.095), (0.23, 0.125), (0.295, 0.18), (0.325, 0.26), (0.325, 0.35), (0.3, 0.45), (0.265, 0.54),
            (0.22, 0.62), (0.15, 0.7), (0.0, 0.75)]  # (radius, world height) of the body profile
    BODY_SQUASH = 0.85

    def body_r(self, zw: float) -> float:
        prof = smooth_profile(self.BODY, 5)
        for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
            if z0 <= zw <= z1:
                return r0 + (r1 - r0) * (zw - z0) / max(1e-9, z1 - z0)
        return 0.0

    def body_point(self, ang: float, zw: float, lift: float = 0.0):
        """Point and outward normal on the body (spine frame) at angle `ang` (0 = front, 90 = her left)
        and world height zw (in the rest pose), lifted off the surface by `lift`."""
        r = self.body_r(zw)
        a = rad(ang)
        z = zw - (self.hip_h + self.spine)
        dz = 0.01
        slope = (self.body_r(zw + dz) - self.body_r(zw - dz)) / (2 * dz)
        n = Vector((math.sin(a), -math.cos(a) / self.BODY_SQUASH, -slope)).normalized()
        return Vector((math.sin(a) * r, -math.cos(a) * r * self.BODY_SQUASH, z)) + n * lift, n

    def body(self):
        # a round, pear-shaped cream body (spine frame; the spine joint sits at hip_h + spine)
        z0 = self.hip_h + self.spine
        prof = [(r, z - z0) for r, z in smooth_profile(self.BODY, 5)]
        self.add('body', lathe_mesh(prof, 40, self.BODY_SQUASH), self.mat['cream'], 'spine')

    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.13 - 0.015 * t, mm['cream'], 0.0, 0.8, 16, 8)
            fm = self.J(an) @ R(0, 0, -16 * sd)
            self.add('foot' + s_, superellipsoid(0.162, 0.18, 0.09, 2.2, 28, 16, center=(0, -0.05, -0.01)), mm['cream'], None, fm)
            for k, x in enumerate((-0.09, 0.0, 0.09)):
                self.add(f'toe{k}{s_}', ellipsoid(0.058, 0.058, 0.056, 14, 8, center=(x, -0.182, -0.044)), mm['cream'], None, fm)
            # peach pads under the foot (seen when a foot is lifted)
            self.add('pad' + s_, ellipsoid(0.076, 0.074, 0.012, 16, 6, center=(0, -0.04, -0.094)), mm['pad'], None, fm)
            for k, (x, y) in enumerate(((-0.088, -0.16), (0.0, -0.186), (0.088, -0.16))):
                self.add(f'bean{k}{s_}', ellipsoid(0.028, 0.028, 0.009, 10, 5, center=(x, y, -0.095)), mm['pad'], None, fm)

    def zlimb(self, name, a, b, c, radius, mat, z0: float, z1: float, sides: int = 16, n: int = 14, extend: float = 0.0):
        """Like Hero.limb over the whole limb, with a 'tip' colour index running z0 -> z1 along it."""
        pa, pb, pc = self.P(a), self.P(b), self.P(c)
        if extend:
            pc = pc + (pc - pb).normalized() * extend
        seg = polyline_segment(curve3(pa, pb, pc, 24), 0.0, 1.0, n)
        v, f = sweep(seg, radius, sides)
        self.add(name, (v, f), mat, tip=flat_tip(n + 1, sides, len(v), z0, z1))

    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.zlimb('arm' + s_, sh, el, wr, lambda t: 0.118 - 0.02 * t, mm['arm'], 0.0, 1.0, 18, 14, extend=0.02)
            self.paw(s_, sd, self.pose.get('hand' + s_, 'fist'))

    def paw(self, s_, sd, kind):
        """A round cream paw in the wrist frame (-Z along the forearm, -Y its front); an open paw shows
        its peach pads on the front."""
        mm = self.mat
        wm = self.J('wrist' + s_)
        if kind == 'open':
            self.add('paw' + s_, ellipsoid(0.104, 0.07, 0.108, 22, 14, center=(0, 0, -0.085)), mm['cream'], None, wm)
            for k, x in enumerate((-0.064, 0.0, 0.064)):
                self.add(f'finger{k}{s_}', ellipsoid(0.039, 0.043, 0.043, 12, 8, center=(x, -0.004, -0.18 + 0.015 * abs(x) / 0.064)), mm['cream'],
                         None, wm)
            self.add('thumb' + s_, ellipsoid(0.036, 0.038, 0.046, 12, 8, center=(0.098 * sd, -0.012, -0.075)), mm['cream'], None, wm)
            self.add('palmpad' + s_, ellipsoid(0.05, 0.014, 0.043, 16, 6, center=(0, -0.065, -0.085)), mm['pad'], None, wm)
            for k, x in enumerate((-0.06, 0.0, 0.06)):
                self.add(f'palmbean{k}{s_}', ellipsoid(0.02, 0.012, 0.02, 10, 5, center=(x, -0.042, -0.183 + 0.015 * abs(x) / 0.06)), mm['pad'],
                         None, wm)
        else:
            self.add('paw' + s_, ellipsoid(0.11, 0.1, 0.112, 22, 14, center=(0, -0.005, -0.085)), mm['cream'], None, wm)
            for k, x in enumerate((-0.062, 0.0, 0.062)):
                self.add(f'knuckle{k}{s_}', ellipsoid(0.042, 0.042, 0.04, 12, 8, center=(x, -0.064, -0.158)), mm['cream'], None, wm)

    # --- head ---------------------------------------------------------------------------------
    @staticmethod
    def head_zone(yaw: float, pitch: float) -> float:
        """0 = cream face fur, 1 = blue fur: blue over the crown and the back of the head, coming down to a
        widow's peak between the eyes, rounded cream lobes over the eyes, blue down the sides behind the
        cheeks."""
        ay = abs(yaw)
        hl = lin_interp([(0, 30), (5, 35), (17, 51), (26, 57), (36, 58), (46, 51), (56, 27), (66, 4), (82, -12), (120, -24), (180, -34)], ay)
        return clamp(0.5 + (pitch - hl) / 7.0)

    def head_parts(self):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        bumps = [(direction(0, -22), 26.0, 0.022), (direction(64, -24), 38.0, 0.04), (direction(-64, -24), 38.0, 0.04)]
        head = FluffHead(hx, hy, hz, (0, 0, hc), bumps)
        self.headshape = head
        verts, faces = ellipsoid(1.0, 1.0, 1.0, 72, 48)
        hv, zone = [], []
        for v in verts:
            d = Vector(v)
            hv.append(tuple(head.surf(d)))
            dn = d.normalized()
            yaw = math.degrees(math.atan2(dn.x, -dn.y))
            pitch = math.degrees(math.asin(clamp(dn.z, -1.0, 1.0)))
            zone.append(self.head_zone(yaw, pitch))
        self.add('head', (hv, faces), mm['head'], 'head', tip=zone)
        self.face_features(head)
        self.cheek_tufts()
        self.ears(head)
        self.sprout(head)

    def face_features(self, head):
        c, mm = self.C, self.mat
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        mouth = f['mouth']
        # the shared eyes and blush; Mimi has no visible brows and her own small cat mouth
        saved = self.pose
        self.pose = dict(saved, face=dict(f, mouth='none'))
        n0 = len(self.parts)
        ey, ep = self.EYE
        ew, eh = self.EYE_SIZE
        self.face(head, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(ew, eh), iris=c['iris'], brow_col='#e8c9a0', mouth_pitch=-24,
                  mouth_w=1.0, lid_col=c['cream'], nose=False, skin=None, blush=True, brow_pitch=22)
        self.pose = saved
        keep = self.parts[:n0]
        for p in self.parts[n0:]:
            # no brows; the stock closed-eye arcs sit as deep as her big eyes would, so they are redrawn below
            if p.name in ('browL', 'browR') or p.name.startswith(('happy', 'closed')):
                continue
            keep.append(p)
        self.parts = keep
        # bolder eye lines so the face reads at crowd size: a thick upper lid line flicking out at the outer
        # corner over open eyes, thick arcs for shut ones
        lash = self.m.glossy('lash_#2a1a14', '#2a1a14', 0.4, 0.2)
        ed = ew * 0.34
        for side in (1, -1):
            nm = 'L' if side > 0 else 'R'
            kind = f['eyes']
            if kind == 'wink':
                kind = 'open' if side > 0 else 'happy'
            if kind in ('open', 'wide'):
                sc = 1.12 if kind == 'wide' else 1.0
                fr = head.frame(ey * side, ep, -ed * 0.55)
                a0, a1 = (-1.3, 1.62) if side > 0 else (-1.62, 1.3)
                pts = [Vector((math.sin(a) * ew * sc * 1.03, -ed * 0.62, math.cos(a) * eh * sc * 1.01 + 0.012 * max(0.0, abs(a) - 1.2)))
                       for a in [a0 + (a1 - a0) * i / 16 for i in range(17)]]
                self.feat('eyeline' + nm, sweep(pts, lambda t: 0.007 + 0.011 * math.sin(math.pi * min(1.0, t * 1.15)) ** 0.7, 8), lash, 'head',
                          head, fr)
            elif kind in ('happy', 'closed'):
                fr = head.frame(ey * side, ep, 0.0)
                h = -eh * 0.42 if kind == 'happy' else eh * 0.2
                pts = [q + Vector((0.0, 0.0, -eh * 0.12)) for q in arc_points(ew * 1.65, h, 14, y=-0.012)]
                self.feat(kind + nm, sweep(pts, lambda t: 0.009 + 0.009 * math.sin(math.pi * t), 8), lash, 'head', head, fr)
        # small pink nose
        nf = head.frame(0, -8, -0.004)
        self.feat('nose', ellipsoid(0.032, 0.023, 0.023, 14, 8), mm['nose'], 'head', head, nf)
        self.feat('nose_tip', ellipsoid(0.016, 0.02, 0.018, 10, 6, center=(0, -0.004, -0.013)), mm['nose'], 'head', head, nf)
        self.mouth(head, mouth)

    def mouth(self, head, kind):
        mt = self.m
        mouth_m = mt.glossy('mouth', '#6d2a26', 0.4, 0.2)
        tongue = mt.glossy('tongue', '#e8797b', 0.35, 0.3)
        teeth = mt.glossy('teeth', '#fffdf6', 0.25, 0.4)
        line = lambda t: 0.0085 + 0.003 * math.sin(math.pi * t)  # noqa: E731
        if kind == 'smile':
            # a little cat mouth: a short line down from the nose into two small arcs (a 'w')
            mf = head.frame(0, -19, 0.0)
            self.feat('philtrum', sweep([Vector((0, -0.005, 0.032)), Vector((0, -0.005, 0.0))], 0.008, 6), mouth_m, 'head', head, mf)
            for sd in (1, -1):
                pts = [Vector((sd * (0.048 - 0.048 * math.cos(a)), -0.005, -0.03 * math.sin(a) + 0.008 * (1 - math.cos(a)) ** 2))
                       for a in [i / 12 * math.pi for i in range(13)]]
                self.feat('smile' + ('L' if sd > 0 else 'R'), sweep(pts, line, 8), mouth_m, 'head', head, mf)
        elif kind in ('grin', 'open', 'laugh'):
            # an open 'D' mouth under a cat lip, with a pink tongue (and two tiny teeth when not laughing)
            ww, hh = {'grin': (0.16, 0.08), 'open': (0.12, 0.09), 'laugh': (0.22, 0.14)}[kind]
            mf = head.frame(0, -21, 0.0)
            self.feat('mouth', ellipsoid(ww / 2, 0.022, hh, 24, 12, zmax=0.12), mouth_m, 'head', head, mf @ T(0, 0.004, 0.004))
            self.feat('tongue', ellipsoid(ww * 0.3, 0.014, hh * 0.42, 16, 8, center=(0, -0.008, -hh * 0.62)), tongue, 'head', head, mf)
            for sd in (1, -1):
                self.feat('tooth', ellipsoid(0.011, 0.008, 0.012, 8, 6, center=(sd * ww * 0.2, -0.014, -0.006)), teeth, 'head', head, mf)
            nf = head.frame(0, -11, 0.0)
            self.feat('philtrum', sweep([Vector((0, -0.005, 0.0)), Vector((0, -0.005, -0.03))], 0.0075, 6), mouth_m, 'head', head, nf)
        elif kind == 'o':
            mf = head.frame(0, -24, 0.0)
            self.feat('mouth', ellipsoid(0.03, 0.018, 0.036, 16, 10), mouth_m, 'head', head, mf @ T(0, 0.004, -0.004))
        elif kind == 'gasp':
            mf = head.frame(0, -25, 0.0)
            self.feat('mouth', ellipsoid(0.066, 0.024, 0.084, 18, 10), mouth_m, 'head', head, mf @ T(0, 0.004, -0.016))
            self.feat('tongue', ellipsoid(0.04, 0.014, 0.028, 12, 6, center=(0, -0.014, -0.072)), tongue, 'head', head, mf)

    def cheek_tufts(self):
        hs = self.headshape
        acc = MeshAcc()
        for sd in (1, -1):
            for yaw, pitch, ln, dz, w in ((78, -8, 0.085, -0.15, 0.095), (74, -24, 0.105, -0.5, 0.105), (66, -40, 0.085, -0.95, 0.09)):
                pos, n = hs.point(yaw * sd, pitch, -0.035)
                fl = Vector((sd * 1.0, 0.15, dz)).normalized()
                pts = [pos + fl * (ln * t) for t in [k / 7 for k in range(8)]]
                vv = flat_sweep(pts, lambda t, w=w: w * (1 - 0.75 * t ** 1.5), Vector((0.0, -1.0, 0.0)), 0.5, 12)
                acc.add(vv, flat_tip(8, 12, len(vv[0])))
        self.add('cheeks', acc.mesh, self.mat['tuft'], 'head', tip=acc.tip)

    def ears(self, head):
        ex = self.pose.get('extra', {})
        eL, eR = ex.get('ears', (50.0, 12.0))
        v, f, z = ear_mesh(0.77, 0.34)
        for sd, e in ((1, eL), (-1, eR)):
            yaw = (66.0 - 0.2 * e) * sd
            pitch = 16.0 + 0.4 * e
            root, _n = head.point(yaw, pitch, -0.07)
            er = rad(e)
            d0 = Vector((sd * math.cos(er), 0.14, math.sin(er)))
            n0 = Vector((0.22 * sd, -1.0, 0.2))
            m = frame_at(root, d0, n0)
            self.add('ear' + ('L' if sd > 0 else 'R'), (v, f), self.mat['ear'], 'head', m, tip=z)

    def sprout(self, head):
        mm = self.mat
        pos, n = head.point(0, 60, -0.01)
        self.add('seed', ellipsoid(0.05, 0.046, 0.05, 16, 10), mm['seed'], 'head', T(*pos) @ R(-20, 0, 0))
        self.add('seedcap', ellipsoid(0.056, 0.05, 0.03, 16, 8, center=(0, 0, 0.022), zmin=-0.2), mm['seed_d'], 'head', T(*pos) @ R(-20, 0, 0))
        top = pos + n * 0.045
        b = Batch()
        for d0, n0, ln, w, cu, be, sh in (
                (Vector((-1.0, -0.1, 0.5)), Vector((0.0, -1.0, 0.4)), 0.3, 0.17, 16, 0, (0.2, 0.95)),
                (Vector((0.05, -0.05, 1.0)), Vector((0.0, -1.0, 0.1)), 0.28, 0.16, 10, -6, (0.25, 1.0)),
                (Vector((0.8, -0.05, 0.8)), Vector((0.1, -1.0, 0.2)), 0.22, 0.13, 16, 0, (0.2, 0.9))):
            b.add(leaf(top, d0, n0, ln, leaf_width(w, 0.42, 0.85), cu, be, 0, 0.14, 0.14, sh, 0.2, 12))
        b.emit(self, 'sprout', mm['leaf'], 'head')

    # --- tail ---------------------------------------------------------------------------------
    @staticmethod
    def tail_r(t: float) -> float:
        return interp([(0.0, 0.08), (0.15, 0.135), (0.45, 0.18), (0.7, 0.172), (0.88, 0.125), (1.0, 0.05)], t)

    def tail_points(self, lift: float, sway: float):
        lift = clamp(lift, 0.0, 1.0)
        ctrl = [Vector(a).lerp(Vector(b), lift) for a, b in zip(self.TAIL, self.TAIL_UP)]
        pts = polyline_segment(catmull_rom(ctrl, 10), 0.0, 1.0, 44)
        base = pts[0].copy()
        out = []
        for i, p in enumerate(pts):
            t = i / (len(pts) - 1)
            out.append(base + Matrix.Rotation(rad(sway * 14.0 * sstep(t * 1.4)), 3, 'Z') @ (p - base))
        # keep the tail above the ground (lift spread smoothly so the curve bends rather than kinks)
        H = self.J('hips')
        Hi = H.inverted()
        world = [H @ p for p in out]
        m = len(out)
        need = [max(0.0, self.tail_r(i / (m - 1)) * 0.92 + 0.01 - w.z) for i, w in enumerate(world)]
        if max(need) > 0.0:
            sig = 0.12 * (m - 1)
            lift_ = [max(need[j] * math.exp(-((i - j) / sig) ** 2) for j in range(m)) for i in range(m)]
            out = [Hi @ (w + Vector((0.0, 0.0, lift_[i]))) for i, w in enumerate(world)]
        return out

    def tail(self):
        ex = self.pose.get('extra', {})
        pts = self.tail_points(ex.get('tail', 0.0), ex.get('sway', 0.0))
        n = len(pts)
        sides = 48
        R_ = self.tail_r

        def rad_fn(t, a):
            on = sstep((t - 0.08) / 0.2)
            lobes = 0.55 * math.cos(6 * a + t * 11.0) + 0.3 * math.cos(4 * a - t * 15.0 + 1.3) + 0.15 * math.cos(9 * a + t * 5.0 + 0.4)
            return R_(t) * (1.0 + on * 0.11 * lobes)

        v, f = tube(pts, rad_fn, sides)
        loop = pts[n // 4:]
        centre = sum(loop, Vector()) / len(loop)
        frames = rmf_frames(pts)
        zone = []
        for i in range(n):
            t = i / (n - 1)
            tg = frames[i][0]
            inn = centre - pts[i]
            inn = inn - tg * inn.dot(tg)
            inn = inn.normalized() if inn.length > 1e-6 else Vector((0.0, 0.0, 1.0))
            for k in range(sides):
                d = (Vector(v[i * sides + k]) - pts[i]).normalized()
                g = d.dot(inn)
                zone.append(clamp(0.52 - 0.6 * g + 0.15 * d.y + 0.35 * (t - 0.5)))
        rest = len(v) - n * sides
        zone += [0.85] * (rest // 2) + [0.35] * (rest - rest // 2)
        self.add('tail', (v, f), self.mat['tail'], 'hips', tip=zone)

    # --- costume ------------------------------------------------------------------------------
    # pointed ends of the scarf's lower edge: (angle, length below the edge, angular half-width)
    SCARF_TIPS = [(-14, 0.19, 44), (38, 0.1, 24), (84, 0.06, 26), (-84, 0.06, 26), (128, 0.07, 30), (-128, 0.07, 30), (180, 0.08, 32)]

    def scarf_edge(self, ang: float) -> float:
        z0 = 0.535
        d = 0.0
        for a, ln, w in self.SCARF_TIPS:
            da = abs((ang - a + 180.0) % 360.0 - 180.0)
            d = max(d, ln * max(0.0, 1.0 - da / w) ** 1.4)
        return z0 - d

    def scarf_r(self, zw: float) -> float:
        flare = 0.19 + 0.16 * sstep((0.69 - zw) / 0.19)
        return max(flare, self.body_r(zw) + 0.024)

    def collar_mesh(self, seg: int = 120, rows: int = 12, thick: float = 0.022):
        """The leaf scarf: a collar round the neck that flares over the shoulders, its lower edge cut into
        pointed ends (spine frame)."""
        zs = self.hip_h + self.spine
        sq = self.BODY_SQUASH
        z_top = 0.69
        verts, faces = [], []
        for layer in (0, 1):
            for i in range(rows + 1):
                v = i / rows
                for k in range(seg):
                    ang = -180.0 + 360.0 * k / seg
                    zw = z_top + (self.scarf_edge(ang) - z_top) * v
                    r = self.scarf_r(zw) - (thick if layer else 0.0)
                    a = rad(ang)
                    verts.append((math.sin(a) * r, -math.cos(a) * r * sq, zw - zs))
        L = (rows + 1) * seg
        for i in range(rows):
            for k in range(seg):
                k2 = (k + 1) % seg
                a, b, c, d = i * seg + k, i * seg + k2, (i + 1) * seg + k2, (i + 1) * seg + k
                faces.append((a, d, c, b))
                faces.append((L + a, L + b, L + c, L + d))
        for k in range(seg):
            k2 = (k + 1) % seg
            faces.append((k, k2, L + k2, L + k))  # top rim
            a, b = rows * seg + k, rows * seg + k2
            faces.append((a, L + a, L + b, b))  # lower edge
        return verts, faces

    def scarf_point(self, ang: float, zw: float, lift: float = 0.0):
        r = self.scarf_r(zw) + lift
        a = rad(ang)
        p = Vector((math.sin(a) * r, -math.cos(a) * r * self.BODY_SQUASH, zw - (self.hip_h + self.spine)))
        n = Vector((math.sin(a), -math.cos(a) / self.BODY_SQUASH, 0.35)).normalized()
        return p, n

    def scarf(self):
        mm = self.mat
        self.add('scarf', self.collar_mesh(), mm['scarf'], 'spine')
        # leaf ends sticking out at the sides of the neck (beside the cheeks and over the shoulders) and down the back
        b = Batch()
        for sd in (1, -1):
            for ang, d, ln, w in ((108, (0.85, 0.3, 0.5), 0.34, 0.16), (126, (1.0, 0.3, -0.3), 0.28, 0.14)):
                base, nn = self.scarf_point(ang * sd, 0.6, -0.01)
                d0 = Vector((d[0] * sd, d[1], d[2]))
                b.add(leaf(base, d0, Vector((0.0, -1.0, 0.25)), ln, leaf_width(w, 0.42, 0.85), 18, 0, 0, 0.12, 0.12, (0.15, 0.85), 0.2, 12))
        base, nn = self.scarf_point(180, 0.58, -0.01)
        b.add(leaf(base, Vector((0.0, 0.45, -1.0)), Vector((0.0, 1.0, 0.1)), 0.24, leaf_width(0.16, 0.42, 0.85), -12, 0, 0, 0.12, 0.12, (0.1, 0.8),
                   0.2, 12))
        b.emit(self, 'scarfleaves', mm['leaf'], 'spine')
        # the round wooden badge with a green clover, pinned on the scarf on her left chest
        p, nn = self.scarf_point(30, 0.52, 0.03)
        bm = T(*p) @ R(0, 0, math.degrees(math.atan2(nn.x, -nn.y))) @ R(6, 0, 0)
        self.add('badge', disc(0.132, 0.048, 40), mm['wood'], 'spine', bm)
        self.add('badgerim', torus(0.127, 0.023, 40, 8), mm['wood_d'], 'spine', bm @ T(0, -0.024, 0) @ R(90, 0, 0))
        self.add('badgeface', disc(0.09, 0.056, 36), mm['badge'], 'spine', bm)
        for k in range(4):
            a = k * 90 + 45
            ca, sa = math.cos(rad(a)), math.sin(rad(a))
            self.add(f'clover{k}', ellipsoid(0.028, 0.009, 0.028, 12, 6, center=(ca * 0.028, -0.029, sa * 0.028)), mm['clover'], 'spine', bm)
        self.add('clovercore', ellipsoid(0.014, 0.01, 0.014, 8, 6, center=(0, -0.034, 0)), mm['clover'], 'spine', bm)

    def satchel(self):
        mm = self.mat
        # a strap from under the scarf on her right shoulder down to the satchel on her right hip (spine frame)
        pts = [self.body_point(-78, 0.56, 0.015)[0], self.body_point(-90, 0.5, 0.02)[0], self.body_point(-100, 0.45, 0.04)[0],
               self.body_point(-108, 0.42, 0.07)[0]]
        self.add('strap', sweep(catmull_rom(pts, 6), 0.022, 8, squash=0.45), mm['strap'], 'spine')
        p, nn = self.body_point(-106, 0.36, 0.085)
        bm = T(*p) @ R(0, 0, -106) @ R(0, 12, 0)
        self.add('bag', superellipsoid(0.14, 0.075, 0.125, 3.0, 22, 14), mm['bag'], 'spine', bm)
        self.add('bagflap', superellipsoid(0.145, 0.036, 0.08, 3.0, 20, 10, center=(0, -0.058, 0.05)), mm['bag_d'], 'spine', bm)
        self.add('button', ellipsoid(0.024, 0.014, 0.024, 12, 8, center=(0, -0.096, 0.0)), mm['button'], 'spine', bm)

    # --- props ----------------------------------------------------------------------------------
    APPLE = (0.05, -0.36, 0.6, 0.29)  # centre (x, y, height in the rest pose) in the spine frame, radius

    def apple(self):
        mm = self.mat
        ax, ay, az, r = self.APPLE
        cen = self.J('spine') @ Vector((ax, ay, az - (self.hip_h + self.spine)))
        prof = []
        for i in range(25):
            a = math.pi * i / 24  # 0 top .. pi bottom
            rr = r * math.sin(a) * (1.0 + 0.06 * math.sin(a) ** 2)
            z = r * math.cos(a) * 0.92 - 0.05 * r * math.exp(-(a / 0.35) ** 2) + 0.03 * r * math.exp(-((math.pi - a) / 0.35) ** 2)
            prof.append((rr, z))
        prof = list(reversed(prof))
        rot = self.J('chest').to_3x3().to_4x4()
        am = T(*cen) @ rot @ R(0, -8, 0)
        self.add('apple', lathe_mesh(prof, 40, 1.0), mm['apple'], None, am)
        stem = [Vector((0, 0, r * 0.82)), Vector((0.01, 0, r * 1.02)), Vector((0.03, 0, r * 1.18))]
        self.add('stem', sweep(stem, 0.013, 8), mm['stem'], None, am)
        b = Batch()
        b.add(leaf(stem[1], Vector((1.0, -0.3, 0.75)), Vector((0.0, -1.0, 0.4)), 0.3, leaf_width(0.19, 0.42, 0.85), 18, 0, 0, 0.12, 0.12, (0.2, 0.95),
                   0.2, 12))
        b.add(leaf(stem[1], Vector((0.1, -0.35, 1.0)), Vector((0.0, -1.0, 0.2)), 0.22, leaf_width(0.13, 0.42, 0.85), 14, 0, 0, 0.12, 0.12, (0.2, 0.9),
                   0.2, 10))
        b.emit(self, 'appleleaf', mm['leaf'], None, am)

    def alert_ticks(self):
        hc = self.J('head') @ Vector((0.0, 0.0, self.HEAD[3]))
        for k, (dx, dz, ang, ln, w0, w1) in enumerate(((-0.66, 0.6, 40, 0.3, 0.06, 0.2), (-0.26, 0.78, 10, 0.21, 0.05, 0.13))):
            p = hc + Vector((dx, -0.5, dz))
            self.add(f'tick{k}', tick_mesh(ln, w0, w1), self.mat['tick'], None, T(*p) @ R(0, ang, 0))


MODEL = Mimi

# Arm angles were found by aiming each paw at its place in the reference art (palm to camera for the
# raised paws); see char_anims for the conventions. Hands: 'open' shows the peach pads, 'fist' a round paw.
POSES = {
    # standing, paws down at her sides, a little cat smile
    'idle': pose(
        root=dict(yaw=IDLE_YAW), armL=swing(4, 13.5, 0, 30), armR=swing(4, 13.5, 0, 30), legL=(0, 10, 0, 4), legR=(0, 10, 0, 4),
        face=face('open', 'smile'), extra=dict(ears=(48.0, 18.0), tail=0.0)),
    # hopping on her right foot, left paw thrown up beside her head, laughing with her eyes shut
    'happy': pose(
        root=dict(yaw=IDLE_YAW + 2, lean=8.0), rise=0.1, spine=(0, 6, 0), head=(-4, -2, -2),
        armL=(139, 36, 4, 1), wristL=(18, -17, 0), armR=(53, 52, -1, 94), wristR=(5, 5, 0), handL='open', handR='fist',
        legL=(80, 10, 0, 70), legR=(-35, 14, 0, 30), footL=(-70, 0, 0), footR=(12, 0, 0),
        face=face('happy', 'laugh'), extra=dict(ears=(48.0, 6.0), tail=0.7)),
    # both paws up by her cheeks, laughing
    'laugh': pose(
        root=dict(yaw=IDLE_YAW - 8), armL=(127, 35, -3, 1), wristL=(17, -19, 0), armR=(127, 37, -10, 0), wristR=(23, 15, 3),
        handL='open', handR='open', face=face('happy', 'laugh'), extra=dict(ears=(46.0, 46.0), tail=0.2)),
    # something caught her eye: left paw up, looking up with her mouth open (yellow alert ticks)
    'alert': pose(
        root=dict(yaw=IDLE_YAW + 8), neck=(-4, 0, 0), head=(-12, 0, 10),
        armL=(125, -1, 6, 6), wristL=(-1, -21, 4), armR=(56, 97, 7, 0), wristR=(9, 0, 0), handL='open', handR='fist',
        face=face('open', 'open', 'up', (0.1, 0.9)), extra=dict(ears=(42.0, -6.0), tail=0.1, alert=True)),
    # hugging a big shiny apple, eyes shut with delight
    'apple': pose(
        root=dict(yaw=IDLE_YAW + 14), neck=(0, 0, -6), head=(4, -14, -8),
        armL=(81, 65, 4, 7), wristL=(-23, -30, 0), armR=(77, 80, -14, 14), wristR=(-15, 46, 0), handL='open', handR='open',
        face=face('happy', 'laugh'), extra=dict(ears=(36.0, 10.0), tail=0.0, apple=True)),
    # startled: sitting back with her feet up, paws raised, wide eyes and a gasp
    'surprised': pose(
        root=dict(yaw=IDLE_YAW + 2, lean=-10.0), rise=0.024, head=(4, 0, 0),
        armL=(81, 31, 0, 0), wristL=(2, -34, 0), armR=(92, 100, 0, 18), wristR=(-1, -5, -1), handL='open', handR='fist',
        legL=(62, 14, 0, 10), legR=(44, 14, 0, 10), footL=(-70, 0, 0), footR=(-50, 0, 0),
        face=face('wide', 'gasp', 'up'), extra=dict(ears=(4.0, 52.0), tail=0.3)),
}
