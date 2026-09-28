"""Wrench, the Inventor: a festival NPC built on the heroes' Hero structure (rendered by npcs.py).

A small chibi tinkerer: a big fluffy cream-white mane of soft pointed locks, brass goggles with cyan
lenses pushed up on top of the head on a brown leather strap, pointed ears, a round rosy face, an
orange neckerchief, a teal short-sleeved shirt with yellow rolled cuffs, a brown leather harness and
tool belt (silver buckle, ochre and brown pouches, a holster of tools on the right hip), navy
shorts, chunky brown boots, brown work gloves and a fluffy tan tail.

Props: a steel adjustable wrench and a brass gadget orb with a glowing cyan core. Pose extras (in
pose['extra']): 'tail' (0 tucked behind .. 1 curled out beside his right hip), 'wrench' ('L' / 'R':
held in that fist; 'wrench_tilt' leans it), 'orb' (its centre in the chest frame, held in
both hands), 'ticks' (little yellow alert marks beside the head).
"""
from __future__ import annotations

import math
import random

from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import HeadShape, R, T, arc_points, ellipsoid, flat_sweep, polyline_segment, rmf_frames, superellipsoid, sweep, torus
from char_models import Hero, hair_shell, periodic_interp
from char_anims import IDLE_YAW, face, pose, swing


# ------------------------------------------------------------------------------------------
# Geometry helpers (variants of the heroes' helpers, kept local)
def sstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def interp(points, x: float) -> float:
    """Smoothly interpolated value through (x, y) control points (clamped at the ends)."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            f = (x - x0) / (x1 - x0) if x1 > x0 else 0.0
            return y0 + (y1 - y0) * sstep(f)
    return points[-1][1]


def catmull_rom(ctrl, steps: int = 8):
    """Dense polyline through control points (uniform Catmull-Rom with clamped ends)."""
    ctrl = [Vector(c) for c in ctrl]
    pts = [ctrl[0]] + ctrl + [ctrl[-1]]
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
    """'tip' values for a sweep / flat_sweep mesh of n rings: t0..t1 along the rings, then the end cap
    (t1) and the start cap (t0)."""
    tip = []
    for i in range(n):
        tip += [t0 + (t1 - t0) * i / max(1, n - 1)] * sides
    rest = nverts - n * sides
    tip += [t1] * (rest // 2) + [t0] * (rest - rest // 2)
    return tip


def tube(pts, radius, sides: int = 24, cap_steps: int = 5):
    """A tube whose radius may vary around it: radius(t, a), t in 0..1 along the points, a the angle.
    Rounded caps at both ends."""
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


def loop_tube(pts, radius, sides: int = 14, up=(0.0, 0.0, 1.0)):
    """A closed tube through a loop of points (a roll of cloth round the neck)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    upv = Vector(up)
    verts, faces = [], []
    for i, p in enumerate(pts):
        t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        u = (upv - t * upv.dot(t)).normalized()
        v = t.cross(u)
        r = radius(i / n) if callable(radius) else radius
        for k in range(sides):
            a = k / sides * math.tau
            verts.append(tuple(p + (u * math.cos(a) + v * math.sin(a)) * r))
    for i in range(n):
        i2 = (i + 1) % n
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((i * sides + k, i * sides + k2, i2 * sides + k2, i2 * sides + k))
    return verts, faces


def closed_band(pts, nrms, half_w: float, half_t: float, sides: int = 12):
    """A closed flat band (a strap round the head) through a loop of points, lying flat on the
    surface whose outward normals are `nrms`: half_w wide across the loop, half_t thick."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    verts, faces = [], []
    for i, p in enumerate(pts):
        t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        nn = Vector(nrms[i])
        nn = (nn - t * nn.dot(t)).normalized()
        w = t.cross(nn).normalized()
        for k in range(sides):
            a = k / sides * math.tau
            ca, sa = math.cos(a), math.sin(a)
            # a rounded rectangle cross-section
            ex = math.copysign(abs(ca) ** 0.5, ca)
            ey = math.copysign(abs(sa) ** 0.5, sa)
            verts.append(tuple(p + w * (ex * half_w) + nn * (ey * half_t)))
    for i in range(n):
        i2 = (i + 1) % n
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((i * sides + k, i * sides + k2, i2 * sides + k2, i2 * sides + k))
    return verts, faces


def ring_band(rx, ry, prof, seg=64, p=2.0, zfun=None):
    """A closed band round the Z axis following a superellipse (rx, ry, exponent p); `prof` is its
    closed cross-section [(dr, z), ...] (outer side bottom to top, then back down the inside)."""
    verts, faces = [], []
    n = len(prof)
    e = 2.0 / p
    for i in range(seg):
        a = i / seg * math.tau
        ca, sa = math.cos(a), math.sin(a)
        ex, ey = math.copysign(abs(ca) ** e, ca), math.copysign(abs(sa) ** e, sa)
        dz = zfun(a) if zfun else 0.0
        for dr, z in prof:
            verts.append((ex * rx + ca * dr, ey * ry + sa * dr, z + dz))
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(n):
            j2 = (j + 1) % n
            faces.append((i * n + j, i2 * n + j, i2 * n + j2, i * n + j2))
    return verts, faces


def round_prof(r: float, n: int = 10, sy: float = 1.0):
    """A small closed circle cross-section for ring_band."""
    return [(r * math.cos(a), r * math.sin(a) * sy) for a in (-math.pi / 2 + k / n * math.tau for k in range(n))]


def orient(pos, nrm, up=(0.0, 0.0, 1.0)) -> Matrix:
    """A frame at `pos` whose -Y faces along `nrm` (parts are modelled facing -Y, up +Z)."""
    fwd = -Vector(nrm).normalized()
    x = fwd.cross(Vector(up))
    if x.length < 1e-5:
        x = Vector((1.0, 0.0, 0.0))
    x.normalize()
    z = x.cross(fwd).normalized()
    m = Matrix((x, fwd, z)).transposed().to_4x4()
    m.translation = Vector(pos)
    return m


def capsule(a, b, r, sides: int = 12):
    return sweep([Vector(a), Vector(b)], r, sides)


def ray_ellipsoid(p: Vector, d: Vector, c: Vector, r: Vector) -> float:
    """Distance along the unit ray p + d * L to the ellipsoid (centre c, radii r) around it."""
    q = Vector(((p.x - c.x) / r.x, (p.y - c.y) / r.y, (p.z - c.z) / r.z))
    e = Vector((d.x / r.x, d.y / r.y, d.z / r.z))
    a = e.dot(e)
    b = 2.0 * q.dot(e)
    cc = q.dot(q) - 1.0
    disc_ = max(0.0, b * b - 4.0 * a * cc)
    return max(0.05, (-b + math.sqrt(disc_)) / (2.0 * a))


class Acc:
    """Accumulates meshes (and their 'tip' values) into one part."""

    def __init__(self):
        self.v, self.f, self.tip = [], [], []

    def add(self, mesh, tip=None, m: Matrix | None = None):
        vv, ff = mesh[0], mesh[1]
        if m is not None:
            vv = [tuple(m @ Vector(q)) for q in vv]
        b0 = len(self.v)
        self.v.extend(tuple(q) for q in vv)
        self.f.extend(tuple(i + b0 for i in fc) for fc in ff)
        if tip is not None:
            self.tip.extend(tip)
        return self

    @property
    def mesh(self):
        return self.v, self.f


# ------------------------------------------------------------------------------------------
# Work gloves, modelled in the wrist frame: -Z runs along the forearm into the fingers, +Y is the
# palm side and the thumb sits on the -X * side edge (so a left glove is a left hand).
GLOVE = 1.18  # glove scale (big chibi work gloves)


def glove_meshes(side: int, kind: str):
    s = side
    out = []
    if kind in ('fist', 'point'):
        out.append(superellipsoid(0.096, 0.074, 0.095, 2.3, 22, 14, center=(0.0, 0.0, -0.095)))
        if kind == 'fist':
            out.append(superellipsoid(0.098, 0.07, 0.062, 2.4, 22, 12, center=(0.0, 0.03, -0.185)))
        else:
            # three curled fingers and the index finger pointing straight on
            out.append(superellipsoid(0.066, 0.064, 0.056, 2.4, 20, 12, center=(0.03 * s, 0.03, -0.17)))
            out.append(sweep([Vector((-0.058 * s, 0.0, -0.14)), Vector((-0.06 * s, -0.004, -0.24)), Vector((-0.058 * s, -0.01, -0.33))],
                             lambda t: 0.038 - 0.005 * t, 12))
        th = T(-0.084 * s, 0.05, -0.12) @ R(0, -34 * s, 0)
        out.append((([tuple(th @ Vector(v)) for v in ellipsoid(0.038, 0.04, 0.062, 14, 10)[0]]), ellipsoid(0.038, 0.04, 0.062, 14, 10)[1]))
    elif kind in ('open', 'cup'):
        out.append(superellipsoid(0.098, 0.056, 0.1, 2.4, 22, 14, center=(0.0, 0.0, -0.1)))
        curl = 0.055 if kind == 'cup' else 0.0
        for k, (x, ln) in enumerate(((-0.066, 0.09), (-0.022, 0.1), (0.022, 0.096), (0.064, 0.082))):
            x *= s
            a = Vector((x, 0.0, -0.17))
            d = Vector((x * 2.6, 0.0, -1.0)).normalized()
            b = a + d * (ln * 0.55) + Vector((0.0, curl * 0.5, 0.0))
            c = a + d * ln + Vector((0.0, curl * 1.4, curl * 0.4))
            out.append(sweep([a, b, c], lambda t: 0.036 - 0.004 * t, 12))
        th0 = Vector((-0.086 * s, 0.01, -0.08))
        td = Vector((-0.75 * s, 0.1 + curl * 2.0, -0.62)).normalized()
        out.append(sweep([th0, th0 + td * 0.05, th0 + td * 0.1 + Vector((0.0, curl * 0.6, 0.0))], lambda t: 0.039 - 0.004 * t, 12))
    return [([(x * GLOVE, y * GLOVE, z * GLOVE) for (x, y, z) in v], f) for v, f in out]


# ------------------------------------------------------------------------------------------
class Wrench(Hero):
    """Wrench, the Inventor: fluffy cream mane, brass goggles, orange neckerchief, tool belt, tan tail."""

    key = 'wrench'
    ankle_h = 0.16
    hip_h = 0.47
    spine = 0.1
    chest = 0.26
    neck = 0.14
    head_up = 0.05
    shoulder = (0.34, 0.0, 0.04)
    upper_arm = 0.3
    forearm = 0.21
    hip_w = 0.22
    thigh = 0.14
    shin = 0.14
    sit_h = 0.22

    HEAD = (0.46, 0.41, 0.41, 0.49)  # rx, ry, rz, centre height above the head joint
    EYE = (26.0, -10.0)  # eye yaw / pitch on the head

    C = dict(skin='#ffb888', ear_in='#f39272', nose='#f89a78', iris='#6a3418', brow='#e2c79a',
             hair_root='#c9a16c', hair_mid='#ecd4a8', hair_tip='#fcf1d9',
             brass='#e8a82e', brass_d='#c28522', lens='#46c6ee', lens_d='#1b7fb6',
             strap='#7a4a2e', strap_d='#5c361f',
             scarf='#ec5220', scarf_d='#c93e16',
             shirt='#3a9678', shirt_d='#2c7a60', cuff='#f3b845',
             glove='#8e5a37', glove_d='#6e4127',
             belt='#6a3d22', buckle='#d2d6dc', pouch='#d9982f', pouch_d='#b67822', pouch_b='#8a5636',
             shorts='#36447e', shorts_d='#2a3566',
             boot='#8d5736', boot_d='#65391f', sole='#4c2d1a',
             tail='#c48f55', tail_d='#9a683a', tail_l='#efd8ab',
             steel='#bcc4ce', steel_d='#8b949f', core='#aef8ff', glow='#3fd4f4', tick='#ffc21e')

    # tail control points in the hips frame (x: his left, y: back, z: up): tucked behind / curled out
    TAIL_IN = [(0.0, 0.2, -0.04), (0.06, 0.36, -0.14), (0.12, 0.52, -0.1), (0.14, 0.62, 0.04), (0.12, 0.64, 0.2), (0.06, 0.6, 0.32), (0.0, 0.54, 0.4)]
    TAIL_OUT = [(-0.08, 0.2, 0.0), (-0.26, 0.3, -0.1), (-0.46, 0.3, -0.15), (-0.63, 0.24, -0.07), (-0.71, 0.17, 0.08), (-0.68, 0.11, 0.23),
                (-0.58, 0.07, 0.33)]

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.42

    # --- materials ------------------------------------------------------------------------------
    def materials(self):
        c, mt = self.C, self.m
        self.M = dict(
            skin=self.skin_mat('wr_skin', c['skin']),
            ear_in=mt.skin('wr_ear_in', c['ear_in']),
            hair=self.hair_mat('wr_hair'),
            shirt=mt.cloth('wr_shirt', c['shirt'], 0.72, 0.4, 0.06),
            shirt_d=mt.cloth('wr_shirt_d', c['shirt_d'], 0.72, 0.35),
            cuff=mt.cloth('wr_cuff', c['cuff'], 0.66, 0.4, 0.05),
            scarf=mt.cloth('wr_scarf', c['scarf'], 0.7, 0.5, 0.08),
            scarf_d=mt.cloth('wr_scarf_d', c['scarf_d'], 0.7, 0.45),
            glove=mt.cloth('wr_glove', c['glove'], 0.55, 0.3, 0.08, 30),
            glove_d=mt.cloth('wr_glove_d', c['glove_d'], 0.55, 0.25),
            leather=mt.cloth('wr_leather', c['belt'], 0.5, 0.2, 0.08, 40),
            strap=mt.cloth('wr_strap', c['strap'], 0.55, 0.2),
            strap_d=mt.cloth('wr_strap_d', c['strap_d'], 0.55, 0.2),
            pouch=mt.cloth('wr_pouch', c['pouch'], 0.5, 0.25, 0.1, 25),
            pouch_d=mt.cloth('wr_pouch_d', c['pouch_d'], 0.5, 0.2),
            pouch_b=mt.cloth('wr_pouch_b', c['pouch_b'], 0.5, 0.2, 0.1, 25),
            shorts=mt.cloth('wr_shorts', c['shorts'], 0.78, 0.35, 0.08),
            shorts_d=mt.cloth('wr_shorts_d', c['shorts_d'], 0.78, 0.3),
            boot=mt.cloth('wr_boot', c['boot'], 0.5, 0.2, 0.08, 30),
            boot_d=mt.cloth('wr_boot_d', c['boot_d'], 0.5, 0.2),
            sole=mt.cloth('wr_sole', c['sole'], 0.6, 0.1),
            brass=mt.metal('wr_brass', c['brass'], 0.28),
            brass_d=mt.metal('wr_brass_d', c['brass_d'], 0.34),
            buckle=mt.metal('wr_buckle', c['buckle'], 0.22),
            steel=mt.metal('wr_steel', c['steel'], 0.24),
            steel_d=mt.metal('wr_steel_d', c['steel_d'], 0.32),
            lens=self.lens_mat('wr_lens'),
            shine=mt.emit('eye_shine', '#ffffff', 3.0),
            tail=self.tail_mat('wr_tail'),
            core=mt.emit('wr_core', c['core'], 10.0),
            tick=mt.emit('wr_tick', c['tick'], 1.4),
            orb_glass=self.orb_mat('wr_orb_glass'),
        )

    def lens_mat(self, name: str):
        """Cyan glass: bright where it faces the camera, deeper blue towards the rim, glossy coat."""
        c = self.C

        def make(n):
            m = lib.NT(n)
            lw = m.node('ShaderNodeLayerWeight')
            lw.inputs['Blend'].default_value = 0.45
            colr = m.mix(lw.outputs['Facing'], col(c['lens']), col(c['lens_d']))
            m.bsdf(colr, 0.3, spec=0.25, emission=col(c['lens']), emission_strength=0.8)
            return m.mat
        return self.m.get(name, make)

    def skin_mat(self, name: str, color: str):
        """Mats.skin plus a faint self-glow: the big mane and goggles shade the face a lot under the key light."""
        def make(n):
            m = lib.NT(n)
            m.bsdf(col(color), 0.5, subsurface=0.12, sheen=0.25, spec=0.35, emission=col(color), emission_strength=0.14)
            return m.mat
        return self.m.get(name, make)

    def hair_mat(self, name: str):
        """The mane: soft cream, warmer at the roots ('tip' 0) and pale at the tips, with a fur-like sheen."""
        c = self.C

        def make(n):
            m = lib.NT(n)
            t = m.node('ShaderNodeAttribute')
            t.attribute_name = 'tip'
            colr = m.ramp(t.outputs['Fac'], [(0.0, c['hair_root']), (0.5, c['hair_mid']), (1.0, c['hair_tip'])])
            tc = m.node('ShaderNodeTexCoord')
            nz = m.noise(42.0, 3, 0.6, tc.outputs['Object'])
            m.bsdf(colr, 0.55, normal=m.bump(nz.outputs['Fac'], 0.05, 0.02), sheen=0.55, coat=0.12, spec=0.35)
            return m.mat
        return self.m.get(name, make)

    def orb_mat(self, name: str):
        """The orb's glass: glowing white-cyan where it faces the camera, deep blue at the rim."""
        c = self.C

        def make(n):
            m = lib.NT(n)
            lw = m.node('ShaderNodeLayerWeight')
            lw.inputs['Blend'].default_value = 0.5
            f = lw.outputs['Facing']
            colr = m.ramp(f, [(0.0, '#e8ffff'), (0.35, c['glow']), (1.0, c['lens_d'])])
            b = m.bsdf(colr, 0.2, spec=0.4, emission=(1, 1, 1, 1), emission_strength=1.0)
            m.link(colr, b.inputs['Emission Color'])
            m.link(m.maprange(f, 0.0, 0.9, 3.0, 0.4), b.inputs['Emission Strength'])
            return m.mat
        return self.m.get(name, make)

    def tail_mat(self, name: str):
        """Tail fur: 'tip' runs 0 at the root to 1 at the end (tan to a pale cream tip), soft sheen."""
        c = self.C

        def make(n):
            m = lib.NT(n)
            t = m.node('ShaderNodeAttribute')
            t.attribute_name = 'tip'
            colr = m.ramp(t.outputs['Fac'], [(0.0, c['tail_d']), (0.3, c['tail']), (0.62, c['tail']), (0.92, c['tail_l']), (1.0, c['tail_l'])])
            tc = m.node('ShaderNodeTexCoord')
            nz = m.noise(30.0, 4, 0.7, tc.outputs['Object'])
            m.bsdf(colr, 0.62, normal=m.bump(nz.outputs['Fac'], 0.1, 0.02), sheen=0.8, spec=0.3)
            return m.mat
        return self.m.get(name, make)

    # --- building -------------------------------------------------------------------------------
    def dress(self):
        self.materials()
        self.ex = self.pose.get('extra', {})
        self.torso()
        self.harness_and_belt()
        self.legs()
        self.arms()
        self.head_parts()
        self.tail()
        self.props()

    # teal shirt (chest frame) over navy shorts (hips frame)
    @staticmethod
    def shirt_r(z: float) -> float:
        t = max(0.0, min(1.0, (z + 0.3) / 0.43))
        return 0.31 + 0.02 * math.sin(math.pi * t * 0.8)

    def torso(self):
        M = self.M
        z0, z1 = -0.3, 0.13
        pts = [Vector((0, 0, z0 + (z1 - z0) * i / 12)) for i in range(13)]
        self.add('shirt', sweep(pts, lambda t: self.shirt_r(z0 + (z1 - z0) * t), 30, cap0=False, squash=0.8), M['shirt'], 'chest')
        self.add('shoulders', ellipsoid(0.335, 0.235, 0.11, 32, 12, center=(0, 0, 0.08), zmin=-0.2), M['shirt'], 'chest')
        self.add('neck', sweep([Vector((0, 0.01, 0.05)), Vector((0, 0.01, 0.26))], 0.1, 16), M['skin'], 'chest')
        self.add('pelvis', superellipsoid(0.3, 0.245, 0.18, 2.4, 30, 16, center=(0, 0.0, -0.02)), M['shorts'], 'hips')

    def on_shirt(self, x: float, z: float, back: bool = False, lift: float = 0.012) -> Vector:
        """The point of the shirt's front (or back) surface at (x, z) in the chest frame."""
        r = self.shirt_r(z) + lift
        xx = max(-r * 0.98, min(r * 0.98, x))
        y = 0.8 * math.sqrt(max(0.0, r * r - xx * xx))
        return Vector((xx, y if back else -y, z))

    def harness_and_belt(self):
        M = self.M
        # suspender straps over the shoulders (chest frame), a brass badge on the left one
        for sd in (1, -1):
            front = [self.on_shirt(0.15 * sd, z) for z in (-0.25, -0.12, 0.0, 0.08)]
            over = [Vector((0.158 * sd, -0.15, 0.15)), Vector((0.16 * sd, -0.06, 0.19)), Vector((0.16 * sd, 0.06, 0.19)), Vector((0.158 * sd, 0.15, 0.15))]
            back = [self.on_shirt(0.15 * sd, z, True) for z in (0.08, 0.0, -0.12, -0.25)]
            pts = catmull_rom(front + over + back, 5)
            self.add('strap', sweep(pts, 0.036, 10, squash=0.36), M['strap'], 'chest')
        bp = self.on_shirt(0.152, -0.04, lift=0.03)
        bm = orient(bp, Vector((0.25, -1.0, 0.0)))
        self.add('badge', ellipsoid(0.045, 0.016, 0.045, 18, 8), M['brass'], 'chest', bm)
        self.add('badge_in', ellipsoid(0.026, 0.012, 0.026, 14, 6, center=(0, -0.01, 0)), M['lens'], 'chest', bm)
        cp = self.on_shirt(-0.152, -0.06, lift=0.028)
        self.add('clip', superellipsoid(0.03, 0.012, 0.04, 3.5, 12, 8), M['brass'], 'chest', orient(cp, Vector((-0.25, -1.0, 0.0))))
        # a little brass tag at the chest under the neckerchief
        tp = self.on_shirt(0.0, 0.03, lift=0.02)
        self.add('tag', superellipsoid(0.04, 0.012, 0.04, 2.0, 14, 8), M['brass'], 'chest', orient(tp, Vector((0, -1.0, 0.1))) @ R(0, 45, 0))

        # the belt round the waist (hips frame) with a big silver buckle
        z = 0.16
        prof = [(0.0, -0.046), (0.018, -0.04), (0.025, 0.0), (0.018, 0.04), (0.0, 0.046), (-0.02, 0.03), (-0.02, -0.03)]
        self.add('belt', ring_band(0.308, 0.252, prof, 64, 2.2), M['leather'], 'hips', T(0, 0, z))

        def belt_frame(yaw, out=0.0, dz=0.0):
            a = math.radians(yaw)
            p = Vector((0.308 * math.sin(a), -0.252 * math.cos(a), z + dz))
            n = Vector((math.sin(a) / 0.308, -math.cos(a) / 0.252, 0.0)).normalized()
            return orient(p + n * out, n)

        bk = belt_frame(-18, 0.032)
        self.add('buckle', ring_band(0.062, 0.054, round_prof(0.014, 10, 1.3), 24, 4.0), M['buckle'], 'hips', bk @ R(90, 0, 0))
        self.add('buckle_in', superellipsoid(0.046, 0.01, 0.04, 3.5, 12, 8, center=(0, -0.004, 0)), M['leather'], 'hips', bk)
        self.add('prong', capsule((0.0, -0.012, -0.03), (0.0, -0.016, 0.03), 0.008, 6), M['brass'], 'hips', bk)

        # pouches hanging from the belt: a big ochre one at the front-left, brown ones on the hips
        def pouch(name, yaw, w, h, d, mat, flap_mat, stud=True, gauge=False):
            pm = belt_frame(yaw, d * 0.8, 0.0) @ T(0, 0, -h * 0.72)
            self.add(name, superellipsoid(w, d, h, 3.0, 22, 14), mat, 'hips', pm)
            self.add(name + 'flap', superellipsoid(w * 1.05, d * 0.55, h * 0.42, 3.0, 20, 10, center=(0, -d * 0.62, h * 0.52)), flap_mat, 'hips', pm)
            if stud:
                self.add(name + 'stud', ellipsoid(0.018, 0.01, 0.018, 10, 6, center=(0, -d * 1.2, h * 0.3)), M['brass'], 'hips', pm)
            if gauge:
                gm = pm @ T(0, -d * 1.02, -h * 0.18)
                self.add(name + 'gauge', torus(0.042, 0.013, 20, 8), M['brass'], 'hips', gm @ R(90, 0, 0))
                self.add(name + 'glass', ellipsoid(0.036, 0.012, 0.036, 16, 8), M['lens'], 'hips', gm)

        pouch('pouchF', 20, 0.13, 0.155, 0.065, M['pouch'], M['pouch_d'], gauge=True)
        pouch('pouchL', 78, 0.08, 0.1, 0.05, M['pouch_b'], M['strap_d'])
        pouch('pouchR', -64, 0.085, 0.1, 0.052, M['pouch_b'], M['strap_d'], stud=False, gauge=True)
        # a holster of tools on the right hip, behind the pouch: a wrench and pliers sticking out of it
        hm = belt_frame(-108, 0.05) @ T(0, 0, -0.1) @ R(0, -12, 0)
        self.add('holster', superellipsoid(0.07, 0.045, 0.12, 2.6, 18, 12), M['pouch'], 'hips', hm)
        self.add('holster_rim', superellipsoid(0.074, 0.05, 0.022, 3.0, 18, 6, center=(0, 0, 0.1)), M['pouch_d'], 'hips', hm)
        self.add('hw_handle', superellipsoid(0.018, 0.009, 0.08, 3.0, 10, 8, center=(-0.02, 0.0, 0.16)), M['steel'], 'hips', hm)
        self.add('hw_head', torus(0.032, 0.012, 16, 6, center=(0, 0, 0)), M['steel'], 'hips', hm @ T(-0.02, 0.0, 0.26) @ R(90, 0, 0))
        for k, dx in enumerate((0.018, 0.04)):
            self.add(f'pl{k}', capsule((dx, 0.0, 0.08), (dx + 0.012 * (k * 2 - 1), 0.0, 0.2), 0.012, 8), M['strap_d'], 'hips', hm)
        self.add('pl_head', superellipsoid(0.03, 0.012, 0.03, 2.4, 10, 8, center=(0.03, 0.0, 0.225)), M['steel'], 'hips', hm)

    def legs(self):
        M = self.M
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('shorts' + s_, hip, kn, an, lambda t: 0.148 + 0.024 * t, M['shorts'], 0.0, 0.42, 18, 8, cap0=True, cap1=False)
            self.add('hem' + s_, torus(0.166, 0.024, 28, 8), M['shorts_d'], None, self.limb_frame(hip, kn, an, 0.41, hip))
            self.limb('leg' + s_, hip, kn, an, 0.09, M['skin'], 0.35, 0.96, 14, 8)
            fm = self.J(an) @ R(0, 0, -12 * sd)
            self.add('boot' + s_, superellipsoid(0.178, 0.228, 0.112, 2.6, 24, 14, center=(0, -0.05, -0.04)), M['boot'], None, fm)
            self.add('toe' + s_, ellipsoid(0.165, 0.13, 0.088, 20, 12, center=(0, -0.165, -0.068)), M['boot'], None, fm)
            self.add('sole' + s_, superellipsoid(0.19, 0.25, 0.032, 3.0, 24, 8, center=(0, -0.058, -0.128)), M['sole'], None, fm)
            self.add('bootcuff' + s_, torus(0.118, 0.042, 24, 10, center=(0, 0, 0.058)), M['boot_d'], None, fm)
            strap = [Vector((-0.17, -0.1, -0.02)), Vector((-0.09, -0.185, 0.012)), Vector((0.0, -0.2, 0.02)), Vector((0.09, -0.185, 0.012)),
                     Vector((0.17, -0.1, -0.02))]
            self.add('bootstrap' + s_, sweep(catmull_rom(strap, 4), 0.02, 8, squash=0.55), M['boot_d'], None, fm)

    def arms(self):
        M = self.M
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.135 - 0.01 * t, M['shirt'], 0.0, 0.5, 16, 8, cap0=True, cap1=False)
            self.add('cuff' + s_, torus(0.127, 0.042, 28, 10, squash=1.35), M['cuff'], None, self.limb_frame(sh, el, wr, 0.5, sh))
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.078 - 0.008 * t, M['skin'], 0.45, 1.0, 12, 10, extend=0.02)
            kind = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            acc = Acc()
            for mesh in glove_meshes(sd, kind):
                acc.add(mesh)
            self.add('glove' + s_, acc.mesh, M['glove'], None, wm)
            self.add('gcuff' + s_, sweep([Vector((0, 0, -0.04)), Vector((0, 0, 0.11))], lambda t: 0.098 + 0.022 * t, 18, cap0=True, cap1=False),
                     M['glove_d'], None, wm)
            self.add('grim' + s_, torus(0.119, 0.019, 22, 8, center=(0, 0, 0.11)), M['glove_d'], None, wm)

    # --- head -----------------------------------------------------------------------------------
    def head_parts(self):
        M, c = self.M, self.C
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 48, 32, center=(0, 0, hc))
        out = []
        for (x, y, z) in hv:
            low = max(0.0, (hc - z) / hz - 0.8) / 0.2  # only the underside of the chin (no features there)
            out.append((x * (1.0 - 0.08 * low), y * (1.0 - 0.05 * low), z))
        self.add('head', (out, hf), M['skin'], 'head')
        ey, ep = self.EYE
        fc = dict(self.pose.get('face', {}))
        mouth = fc.get('mouth', 'smile')
        keep = self.pose
        self.pose = dict(keep, face=dict(fc, mouth='none'))
        self.face(head, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(0.105, 0.128), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-36,
                  lid_col=c['skin'], skin=c['nose'], brow_pitch=20, blush=False)
        self.pose = keep
        bl = self.m.alpha('wr_blush', '#ff7a6a', 0.42)
        for sd in (1, -1):
            self.feat('blush', ellipsoid(0.066, 0.004, 0.04, 16, 6), bl, 'head', head, head.frame(sd * (ey + 11), ep - 17, 0.003))
        self.mouth(head, mouth)
        self.ears(head)
        hs = self.hair(head)
        self.goggles(hs)
        self.neckerchief()

    def mouth(self, head: HeadShape, kind: str):
        """A variant of Hero.face()'s mouths, sized like the reference art (a wide smile, big open grins)."""
        mt = self.m
        mouth_m = mt.glossy('mouth', '#6d2a26', 0.4, 0.2)
        tongue = mt.glossy('tongue', '#e8797b', 0.35, 0.3)
        teeth = mt.glossy('teeth', '#fffdf6', 0.25, 0.4)
        mf = head.frame(0, -36, 0.0) if kind == 'smile' else head.frame(0, -33, 0.0)
        if kind == 'smile':
            self.feat('mouth', sweep(arc_points(0.17, 0.034, 14, y=-0.006), lambda t: 0.0085 + 0.0045 * math.sin(math.pi * t), 8), mouth_m, 'head', head, mf)
        elif kind in ('grin', 'open', 'laugh'):
            ww, hh = {'grin': (0.21, 0.092), 'open': (0.2, 0.105), 'laugh': (0.23, 0.125)}[kind]
            self.feat('mouth', ellipsoid(ww / 2, 0.02, hh, 26, 14, zmax=0.15), mouth_m, 'head', head, mf @ T(0, 0.002, 0.01))
            self.feat('tongue', ellipsoid(ww * 0.27, 0.012, hh * 0.42, 14, 8, center=(0, -0.008, -hh * 0.6)), tongue, 'head', head, mf)
            self.feat('teeth', ellipsoid(ww * 0.34, 0.01, 0.015, 14, 6, center=(0, -0.012, -0.002)), teeth, 'head', head, mf)
        elif kind == 'o':
            self.feat('mouth', ellipsoid(0.046, 0.018, 0.058, 18, 10), mouth_m, 'head', head, mf @ T(0, 0.004, -0.014))
            self.feat('tongue', ellipsoid(0.024, 0.01, 0.017, 12, 6, center=(0, -0.012, -0.056)), tongue, 'head', head, mf)
        elif kind == 'gasp':
            self.feat('mouth', ellipsoid(0.068, 0.02, 0.085, 20, 12), mouth_m, 'head', head, mf @ T(0, 0.004, -0.022))
            self.feat('tongue', ellipsoid(0.036, 0.011, 0.024, 12, 6, center=(0, -0.012, -0.085)), tongue, 'head', head, mf)
            self.feat('teeth', ellipsoid(0.042, 0.01, 0.013, 12, 6, center=(0, -0.012, 0.04)), teeth, 'head', head, mf)

    def ears(self, head: HeadShape):
        """Pointed ears sticking out sideways at cheek level, in front of the side hair."""
        M = self.M
        for sd in (1, -1):
            base, _n = head.point(80 * sd, -24, -0.05)
            d = Vector((sd * 1.0, -0.06, 0.17)).normalized()
            L = 0.27
            pts = [base + d * (L * t) + Vector((0.0, 0.0, 0.03 * t * t)) for t in (k / 10 for k in range(11))]
            nrm = Vector((0.3 * sd, -1.0, 0.0))
            self.add('ear', flat_sweep(pts, lambda t: 0.13 * (1 - t ** 1.3) ** 1.1 + 0.008, nrm, 0.32, 16), M['skin'], 'head')
            off = nrm.normalized() * 0.03
            ipts = [p + off for p in pts[2:9]]
            self.add('earin', flat_sweep(ipts, lambda t: 0.066 * (1 - t ** 1.3) ** 1.0 + 0.006, nrm, 0.3, 12), M['ear_in'], 'head')

    def hair(self, head: HeadShape) -> HeadShape:
        M = self.M
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.012, center=(0, 0.005, hc + 0.008))

        # a thick cap over the scalp that the locks grow out of
        def boundary(yaw):
            return periodic_interp([(0, 40), (30, 38), (50, 26), (64, 4), (80, 10), (100, 6), (125, -14), (155, -30), (180, -34)], abs(yaw))

        def thickness(yaw, pitch, f):
            # thick at the back and sides so no scalp shows between the locks
            return 0.016 + (0.1 + 0.04 * sstep((abs(yaw) - 60.0) / 60.0)) * sstep(f / 0.45)

        v, f, tp = hair_shell(hs, boundary, thickness, 128, 22)
        self.add('haircap', (v, f), M['hair'], 'head', tip=[0.05 + 0.35 * t for t in tp])

        # the mane: broad soft locks with pointed tips radiating from the scalp out to a big round envelope
        ec = Vector((0.0, 0.08, hc - 0.02))
        er = Vector((0.78, 0.6, 0.68))
        rng = random.Random(5)
        acc = Acc()
        # pitch, count, min |yaw| (keeps the face and ears clear), root radius, phase, length factor
        rings = [(88, 5, 0, 0.21, 0.0, 1.0), (68, 11, 0, 0.21, 0.5, 1.0), (48, 14, 32, 0.21, 0.0, 1.0), (28, 15, 56, 0.2, 0.5, 1.0),
                 (8, 15, 76, 0.2, 0.0, 0.98), (-12, 13, 100, 0.19, 0.5, 0.92), (-30, 11, 112, 0.18, 0.0, 0.86), (-48, 7, 132, 0.165, 0.5, 0.8)]
        up = Vector((0.0, 0.0, 1.0))
        for pitch, count, ymin, r0, ph, lf in rings:
            for k in range(count):
                yaw = -180.0 + 360.0 * (k + ph) / count + rng.uniform(-7, 7)
                pt = pitch + rng.uniform(-5, 5)
                rr = r0 * rng.uniform(0.88, 1.1)
                lj = rng.uniform(0.84, 1.05) * lf
                cj = rng.uniform(-0.22, 0.22)
                if abs(yaw) < ymin:
                    continue
                root, _nrm = hs.point(yaw, pt, 0.02)
                d = (root - ec).normalized()
                front = max(0.0, math.cos(math.radians(yaw))) * sstep((pt - 20.0) / 40.0)
                d = (d + up * 0.12 + Vector((0.0, 0.55, 0.3)) * front).normalized()  # the front locks rise behind the goggles
                L = ray_ellipsoid(root, d, ec, er) * lj
                upp = up - d * up.dot(d)
                upp = upp.normalized() if upp.length > 1e-4 else Vector((0.0, 1.0, 0.0))
                side = d.cross(upp)
                curl = upp * 0.1 + side * cj
                pts = [root + d * (L * t) + curl * (L * t * t) for t in (i / 9 for i in range(10))]
                pointy = 0.5 - 0.2 * sstep((pt - 50.0) / 30.0)  # softer lobes on top, pointed clumps round the sides
                prof = lambda t, rr=rr, e=pointy: rr * math.sqrt(max(0.0, 1.0 - t * t)) * (1.0 - t) ** e + 0.005  # noqa: E731
                if any(self.in_goggles(q, prof(i / 9) * 0.4) for i, q in enumerate(pts)):
                    continue
                # a soft clump: broad for most of its length, rounding off to a soft point
                mesh = flat_sweep(pts, prof, Vector((0.0, -1.0, 0.0)), 0.66, 16)
                acc.add(mesh, flat_tip(10, 16, len(mesh[0])))
        # a few longer, pointed clumps flaring out round the sides and top (the jagged outline)
        for yaw, pt, lf, rr in ((-104, 30, 1.12, 0.17), (-122, 4, 1.1, 0.17), (-96, -18, 1.06, 0.16), (-140, 40, 1.1, 0.16), (-60, 62, 1.1, 0.17),
                                (-22, 80, 1.12, 0.18), (30, 76, 1.1, 0.17), (70, 58, 1.1, 0.17), (104, 32, 1.12, 0.17), (120, 6, 1.1, 0.17),
                                (100, -16, 1.05, 0.16), (146, 36, 1.08, 0.16)):
            root, _nrm = hs.point(yaw, pt, 0.06)
            d = (root - ec).normalized()
            front = max(0.0, math.cos(math.radians(yaw))) * sstep((pt - 20.0) / 40.0)
            d = (d + up * 0.1 + Vector((0.0, 0.55, 0.3)) * front).normalized()
            L = ray_ellipsoid(root, d, ec, er) * lf
            upp = up - d * up.dot(d)
            upp = upp.normalized() if upp.length > 1e-4 else Vector((0.0, 1.0, 0.0))
            curl = upp * 0.14 + d.cross(upp) * (0.12 if yaw > 0 else -0.12)
            pts = [root + d * (L * t) + curl * (L * t * t) for t in (i / 9 for i in range(10))]
            prof = lambda t, rr=rr: rr * math.sqrt(max(0.0, 1.0 - t * t)) * (1.0 - t) ** 0.6 + 0.004  # noqa: E731
            if any(self.in_goggles(q, prof(i / 9) * 0.4) for i, q in enumerate(pts)):
                continue
            mesh = flat_sweep(pts, prof, Vector((0.0, -1.0, 0.0)), 0.6, 16)
            acc.add(mesh, flat_tip(10, 16, len(mesh[0]), 0.1, 1.0))
        self.add('mane', acc.mesh, M['hair'], 'head', tip=acc.tip)

        # short pointed bangs from under the goggle band, and a lock down each temple
        bangs = [(-20, 48, -26, 26, 0.085), (-1, 50, 1, 23, 0.09), (18, 48, 24, 27, 0.085), (-54, 42, -68, -10, 0.09), (54, 42, 68, -10, 0.09)]
        acc = Acc()
        for y0, p0, y1, p1, r0 in bangs:
            pts, nrms = [], []
            for j in range(11):
                u = j / 10
                pos, nn = head.point(y0 + (y1 - y0) * u, p0 + (p1 - p0) * u, 0.035 + 0.02 * u)
                pts.append(pos)
                nrms.append(nn)
            mesh = flat_sweep(pts, lambda t, r0=r0: r0 * max(0.0, 1.0 - t ** 1.5) ** 0.7 + 0.005, lambda t, nrms=nrms: nrms[min(10, int(round(t * 10)))], 0.5, 12)
            acc.add(mesh, flat_tip(11, 12, len(mesh[0]), 0.3, 1.0))
        self.add('bangs', acc.mesh, M['hair'], 'head', tip=acc.tip)
        return hs

    def goggle_spots(self):
        """(centre, facing) of the two goggles in the head frame."""
        hc = self.HEAD[3]
        return [(Vector((0.27 * sd, -0.27, hc + 0.32)), Vector((0.2 * sd, -0.8, 0.56)).normalized()) for sd in (1, -1)]

    def in_goggles(self, p: Vector, pad: float) -> bool:
        """Would a lock point (of radius `pad`) show through a goggle? (Behind the cups it is hidden.)"""
        for c_, n in self.goggle_spots():
            v = p - c_
            a = v.dot(n)
            if -0.03 < a < 0.14 and (v - n * a).length < 0.21 + pad:
                return True
        return False

    def goggles(self, hs: HeadShape):
        """Brass goggles with cyan lenses pushed up on top of the head, on a wide leather band."""
        M = self.M
        hx, hy, hz, hc = self.HEAD
        for c_, n in self.goggle_spots():
            G = orient(c_, n)
            self.add('gcup', superellipsoid(0.18, 0.068, 0.18, 3.0, 30, 12, center=(0, 0.035, 0)), M['brass_d'], 'head', G)
            self.add('grim', torus(0.148, 0.056, 44, 14), M['brass'], 'head', G @ T(0, -0.045, 0) @ R(90, 0, 0))
            self.add('grim_in', torus(0.108, 0.015, 32, 8), M['brass_d'], 'head', G @ T(0, -0.064, 0) @ R(90, 0, 0))
            self.add('glens', ellipsoid(0.108, 0.048, 0.108, 28, 14, center=(0, -0.045, 0)), M['lens'], 'head', G)
            self.add('gshine', ellipsoid(0.03, 0.004, 0.021, 10, 6, center=(-0.042, -0.092, 0.042)), M['shine'], 'head', G)
        # the band: a closed loop round the head, high at the front behind the goggles, low at the back
        pts, nrms = [], []
        N = 72
        for i in range(N):
            yaw = -180.0 + 360.0 * i / N
            pitch = interp([(0, 36), (40, 36), (66, 16), (90, 2), (120, -6), (180, -4)], abs(yaw))
            pos, nn = hs.point(yaw, pitch, 0.075)
            pts.append(pos)
            nrms.append(nn)
        self.add('gband', closed_band(pts, nrms, 0.082, 0.026, 12), M['strap'], 'head')

    def neckerchief(self):
        M = self.M
        pts = []
        for i in range(40):
            a = i / 40 * math.tau
            fr = max(0.0, -math.sin(a))
            pts.append(Vector((0.235 * math.cos(a), 0.205 * math.sin(a) - 0.01, 0.22 - 0.06 * fr ** 1.5)))
        self.add('scarf', loop_tube(pts, lambda t: 0.092 + 0.012 * math.sin(t * math.tau * 3), 16), M['scarf'], 'chest')
        top, tipp = Vector((0.0, -0.25, 0.17)), Vector((0.0, -0.3, 0.03))
        fp = [top.lerp(tipp, t) + Vector((0.0, -0.035 * math.sin(math.pi * t), 0.0)) for t in (k / 10 for k in range(11))]
        self.add('scarfflap', flat_sweep(fp, lambda t: 0.27 * (1 - t) ** 1.1 + 0.014, Vector((0.0, -1.0, 0.3)), 0.2, 16), M['scarf_d'], 'chest')

    # --- tail -----------------------------------------------------------------------------------
    def tail(self):
        f = max(0.0, min(1.0, self.ex.get('tail', 0.0)))
        ctrl = [Vector(a).lerp(Vector(b), f) for a, b in zip(self.TAIL_IN, self.TAIL_OUT)]
        pts = polyline_segment(catmull_rom(ctrl, 10), 0.0, 1.0, 40)
        prof = [(0.0, 0.05), (0.2, 0.08), (0.5, 0.1), (0.75, 0.095), (0.9, 0.065), (1.0, 0.012)]

        def rad_fn(t, a):
            on = sstep((t - 0.12) / 0.2)
            lobes = 0.55 * math.cos(5 * a + t * 11.0) + 0.3 * math.cos(3 * a - t * 15.0 + 1.3) + 0.2 * math.cos(8 * a + t * 7.0)
            return interp(prof, t) * (1.0 + on * 0.22 * lobes)

        sides = 36
        v, fcs = tube(pts, rad_fn, sides)
        n = len(pts)
        tip = []
        for i in range(n):
            tip += [i / (n - 1)] * sides
        rest = len(v) - n * sides
        tip += [1.0] * (rest // 2) + [0.0] * (rest - rest // 2)
        self.add('tail', (v, fcs), self.M['tail'], 'hips', tip=tip)
        # soft locks gathering into a pointed, pale tip
        frames = rmf_frames(pts)
        acc = Acc()
        for k in range(6):
            a = (k + 0.25) / 6 * math.tau
            lp = []
            for q in range(8):
                u = q / 7
                i = min(n - 1, int(round((0.8 + 0.2 * u) * (n - 1))))
                _t, uu, vv = frames[i]
                d = uu * math.cos(a) + vv * math.sin(a)
                lp.append(pts[i] + d * interp(prof, i / (n - 1)) * (0.7 - 0.55 * u) + frames[-1][0] * (0.06 * u * u))
            mesh = flat_sweep(lp, lambda u: 0.06 * (1 - 0.85 * u ** 1.2), Vector((0.0, 0.0, 1.0)), 0.5, 10)
            acc.add(mesh, flat_tip(8, 10, len(mesh[0]), 0.75, 1.0))
        self.add('tailtip', acc.mesh, self.M['tail'], 'hips', tip=acc.tip)

    # --- props ----------------------------------------------------------------------------------
    def props(self):
        ex = self.ex
        hand = ex.get('wrench')
        if hand:
            self.wrench(hand, ex.get('wrench_tilt', (0.0, 0.0, 0.0)))
        if ex.get('orb'):
            self.orb(ex['orb'])
        if ex.get('ticks'):
            self.ticks()

    def fist_point(self, hand: str) -> Vector:
        """Centre of a fist's grip (inside the curled fingers)."""
        return self.J('wrist' + hand) @ (Vector((0.0, 0.035, -0.145)) * GLOVE)

    def wrench(self, hand: str, tilt):
        """A steel adjustable wrench through the fist, jaw up; `tilt` (degrees) leans it in his yawed frame."""
        M = self.M
        yaw = self.pose.get('root', {}).get('yaw', 0.0)
        W = T(*self.fist_point(hand)) @ R(0, 0, yaw) @ R(*tilt)
        # modelled with its long axis on +Z (jaw at the top), flat faces towards -Y; gripped at z = 0
        self.add('wr_handle', superellipsoid(0.056, 0.025, 0.27, 3.0, 16, 14, center=(0, 0, 0.02)), M['steel'], None, W)
        self.add('wr_ring', torus(0.072, 0.03, 24, 10, squash=0.8), M['steel'], None, W @ T(0, 0, -0.28) @ R(90, 0, 0))
        arc = [Vector((0.1 * math.cos(math.radians(a)), 0.0, 0.41 + 0.1 * math.sin(math.radians(a)))) for a in (128 + 284 * i / 20 for i in range(21))]
        self.add('wr_jaw', flat_sweep(arc, 0.058, Vector((0.0, -1.0, 0.0)), 0.44, 12), M['steel'], None, W)
        self.add('wr_neck', superellipsoid(0.072, 0.027, 0.07, 2.6, 14, 10, center=(0.0, 0.0, 0.3)), M['steel'], None, W)
        self.add('wr_screw', capsule((-0.042, 0.0, 0.335), (0.042, 0.0, 0.335), 0.028, 10), M['brass'], None, W)

    def orb(self, pos):
        """The brass gadget orb with a glowing cyan core at `pos` in the chest frame, facing the camera."""
        M = self.M
        O = T(*(self.J('chest') @ Vector(pos)))
        self.add('orb_glass', ellipsoid(0.19, 0.19, 0.19, 28, 18), M['orb_glass'], None, O)
        self.add('orb_core', ellipsoid(0.07, 0.03, 0.07, 16, 8, center=(0, -0.185, 0)), M['core'], None, O)
        self.add('orb_ring', torus(0.23, 0.05, 44, 12), M['brass'], None, O @ R(90, 0, 0))
        self.add('orb_cage', torus(0.205, 0.022, 36, 8), M['brass_d'], None, O @ R(0, 0, 90) @ R(90, 0, 0))
        self.add('orb_cage2', torus(0.205, 0.022, 36, 8), M['brass_d'], None, O)
        self.add('orb_back', ellipsoid(0.22, 0.22, 0.22, 28, 14, zmin=-1.0, zmax=0.0), M['brass_d'], None, O @ R(90, 0, 0))
        for k in range(6):
            a = math.radians(90 + k * 60)
            self.add(f'orb_knob{k}', ellipsoid(0.05, 0.046, 0.05, 12, 8, center=(0.25 * math.cos(a), -0.01, 0.25 * math.sin(a))), M['brass'], None, O)

    def ticks(self):
        """Three little alert marks beside the head (flat emissive wedges facing the camera)."""
        M = self.M
        a = math.radians(90 - 12.0)
        view = Vector((0.0, math.sin(a), -math.cos(a)))
        hp = self.P('head')
        for k, (dx, dz, ang, ln, w) in enumerate(((0.6, 0.98, 100, 0.2, 0.05), (0.85, 0.86, 50, 0.24, 0.07), (0.92, 0.62, 18, 0.18, 0.05))):
            c_ = Vector((hp.x + dx, hp.y - 0.4, hp.z + dz))
            m = orient(c_, -view) @ R(0, -ang, 0)
            pts = [Vector((-ln / 2 + ln * t, 0.0, 0.0)) for t in (i / 6 for i in range(7))]
            self.add(f'tick{k}', flat_sweep(pts, lambda t, w=w: w * (0.35 + 0.65 * t), Vector((0.0, -1.0, 0.0)), 0.2, 8), M['tick'], None, m)


MODEL = Wrench


# ------------------------------------------------------------------------------------------
# Posing helpers
def reach(side: int, elbow, wrist, h=Wrench):
    """Arm angles (raise, swing, twist, elbow) that put the elbow towards `elbow` and the wrist
    towards `wrist` (points in the chest frame: x his left, -y front, z up)."""
    from char_rig import limb_rotation
    s_ = Vector((h.shoulder[0] * side, h.shoulder[1], h.shoulder[2]))
    d1 = (Vector(elbow) - s_).normalized()
    raise_ = math.degrees(math.acos(max(-1.0, min(1.0, -d1.z))))
    sw = math.degrees(math.atan2(-d1.y, d1.x * side))
    d2 = (Vector(wrist) - (s_ + d1 * h.upper_arm)).normalized()
    el = math.degrees(math.acos(max(-1.0, min(1.0, d1.dot(d2)))))
    loc = limb_rotation(d1, Vector((-0.25 * side, -1.0, 0.0)), 0.0).to_3x3().transposed() @ d2
    tw = math.degrees(math.atan2(loc.x, -loc.y)) / side
    return (round(raise_, 1), round(sw, 1), round(tw, 1), round(el, 1))


def wrist_for(side: int, arm, fingers, palm, h=Wrench):
    """Wrist rotation (pose['wristL'] / ['wristR']) that points the glove's fingers along `fingers`
    with its palm facing `palm` (directions in the chest frame), for the arm angles `arm`."""
    from char_rig import arm_rot, bend
    r, s_, tw, el = arm
    r0 = (arm_rot(side, r, s_, tw) @ T(0, 0, -h.upper_arm) @ bend(el)).to_3x3()
    z = -Vector(fingers).normalized()
    y = Vector(palm)
    y = (y - z * y.dot(z)).normalized()
    x = y.cross(z)
    e = (r0.transposed() @ Matrix((x, y, z)).transposed()).to_euler('XYZ')
    return tuple(round(math.degrees(v), 1) for v in e)


def arm_and_hand(side: int, elbow, wrist, fingers=None, palm=None):
    """reach() plus the matching wrist rotation: {'armL': ..., 'wristL': ...} for a pose."""
    s_ = 'L' if side > 0 else 'R'
    arm = reach(side, elbow, wrist)
    out = {'arm' + s_: arm}
    if fingers is not None:
        out['wrist' + s_] = wrist_for(side, arm, fingers, palm)
    return out


STANCE = dict(legL=(0, 30, 0, 4), legR=(0, 30, 0, 4))

# The six festival poses (order of src/game/data/npcs.ts)
POSES = {
    # hands on hips, a friendly smile
    'idle': pose(
        **arm_and_hand(1, (0.62, 0.1, -0.12), (0.44, 0.03, -0.24), (0.0, 0.4, -1.0), (-1.0, 0.0, 0.0)),
        **arm_and_hand(-1, (-0.62, 0.1, -0.12), (-0.44, 0.03, -0.24), (0.0, 0.4, -1.0), (1.0, 0.0, 0.0)),
        face=face('open', 'smile'), extra=dict(tail=0.0), **STANCE,
    ),
    # the right hand raises the wrench, the left rests on the belt; head tilted, big grin
    'tool': pose(
        head=(0, 20, 4), chest=(0, 4, 0),
        **arm_and_hand(-1, (-0.52, -0.06, 0.26), (-0.6, -0.2, 0.44), (0.1, -1.0, 0.4), (1.0, 0.0, 0.0)),
        **arm_and_hand(1, (0.62, 0.02, -0.16), (0.4, -0.22, -0.2), (-1.0, -0.3, -0.2), (0.0, 1.0, 0.0)),
        face=face('open', 'grin', 'up'), extra=dict(tail=1.0, wrench='R', wrench_tilt=(0, 12, 0)), **STANCE,
    ),
    # eyes shut laughing, the wrench held low in the left fist, the right fist at the tummy
    'laugh': pose(
        head=(-6, -12, 0), chest=(-3, -2, 0),
        **arm_and_hand(1, (0.56, 0.02, -0.18), (0.58, -0.2, 0.06), (0.0, -1.0, 0.2), (-1.0, 0.0, 0.0)),
        **arm_and_hand(-1, (-0.52, 0.0, -0.15), (-0.12, -0.32, -0.08), (1.0, -0.3, 0.0), (0.0, 1.0, 0.3)),
        face=face('happy', 'laugh', 'up'), extra=dict(tail=1.0, wrench='L', wrench_tilt=(0, 10, 0)), **STANCE,
    ),
    # index finger up: an idea!
    'idea': pose(
        root=dict(yaw=IDLE_YAW + 14), head=(-8, 0, 4),
        **arm_and_hand(1, (0.54, -0.06, 0.28), (0.6, -0.14, 0.5), (0.1, 0.0, 1.0), (-0.3, -1.0, 0.0)),
        **arm_and_hand(-1, (-0.62, 0.12, -0.1), (-0.4, -0.06, -0.22), (0.0, 0.4, -1.0), (1.0, 0.0, 0.0)), handL='point',
        face=face('open', 'open', 'up', (0.6, 0.7)), extra=dict(tail=0.0), **STANCE,
    ),
    # both hands hold the glowing gadget orb up beside his face; surprised 'o'
    'gadget': pose(
        root=dict(yaw=IDLE_YAW + 16), chest=(0, 0, 20), head=(6, 0, -16),
        **arm_and_hand(1, (0.56, -0.08, -0.18), (0.44, -0.4, 0.04), (-0.2, -1.0, 0.3), (0.0, 0.0, 1.0)),
        **arm_and_hand(-1, (-0.42, -0.24, -0.14), (-0.1, -0.52, 0.14), (0.8, -0.3, 0.6), (1.0, 0.0, 0.0)), handL='cup', handR='cup',
        face=face('wide', 'o', 'up', (1.0, -0.2)), extra=dict(tail=0.0, orb=(0.3, -0.56, 0.3), ticks=True), **STANCE,
    ),
    # both hands up, open; a startled half step
    'surprised': pose(
        root=dict(yaw=IDLE_YAW + 6, lean=-6.0), chest=(-6, 0, 0), head=(6, 0, 4),
        **arm_and_hand(1, (0.56, 0.04, -0.34), (0.68, -0.1, -0.2), (0.3, 0.0, 1.0), (0.0, -1.0, 0.0)),
        **arm_and_hand(-1, (-0.56, 0.04, -0.34), (-0.68, -0.1, -0.2), (-0.3, 0.0, 1.0), (0.0, -1.0, 0.0)),
        handL='open', handR='open', legL=(82, 36, 0, 48), legR=(-4, 30, 0, 6), footL=(-24, 0, 0),
        face=face('wide', 'gasp', 'up'), extra=dict(tail=1.0),
    ),
}
