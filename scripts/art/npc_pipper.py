"""Pipper, the Travelling Merchant: a festival NPC built on the shared Hero structure (see char_models.py).

A chubby furry creature: brown fur with a tan face mask (muzzle, cheeks and patches round the eyes),
fluffy cheek tufts, small round ears, big dark eyes and a little dark nose. He wears a big soft purple
hat that flops over to his right with a rolled brim, gold embroidery and a gold tassel; a purple robe
open over a cream tunic, with a cream collar and big cream cuffs; brown leather backpack straps with a
gold badge, a belt with pouches and gemstone buttons; a big wicker backpack with gifts in it; a fluffy
tail and big brown paws. Props: a gift box tied with a blue ribbon (pose extra 'gift') and a shiny
gold coin with sparkles (pose extra 'coin').

Rendered by npcs.py (MODEL, POSES). The arm poses are solved from wrist targets in the chest frame
(reach() below), so the paws land where the reference art puts them.
"""
from __future__ import annotations

import math

import numpy as np
from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import (HeadShape, R, S, T, arc_points, arm_rot, bend, disc, ellipsoid, flat_sweep, polyline_segment, rad, rmf_frames,
                      star, superellipsoid, sweep, torus)
from char_models import DEFAULT_FACE, Hero
from char_anims import face, pose


# ------------------------------------------------------------------------------------------
# Small helpers (variants of the ones in char_zippa.py, kept here so this module stands alone)
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
    ctrl = [Vector(p) for p in ctrl]
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


def curve(ctrl, n: int = 24):
    """n+1 evenly spaced points along a smooth curve through the control points."""
    return polyline_segment(catmull_rom(ctrl, 8), 0.0, 1.0, n)


def direction(yaw: float, pitch: float) -> Vector:
    y, p = rad(yaw), rad(pitch)
    return Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))


def merge(meshes):
    verts, faces = [], []
    for v, f in meshes:
        b0 = len(verts)
        verts.extend(tuple(q) for q in v)
        faces.extend(tuple(i + b0 for i in fc) for fc in f)
    return verts, faces


def placed(m: Matrix, mesh):
    return [tuple(m @ Vector(v)) for v in mesh[0]], mesh[1]


def capsule(a, b, r, sides: int = 12):
    return sweep([Vector(a), Vector(b)], r, sides)


def flat_tip(n: int, sides: int, nverts: int, t0: float = 0.0, t1: float = 1.0):
    """'tip' values for a flat_sweep / sweep mesh of n rings (then the end cap and the start cap)."""
    tip = []
    for i in range(n):
        tip += [t0 + (t1 - t0) * i / max(1, n - 1)] * sides
    rest = nverts - n * sides
    return tip + [t1] * (rest // 2) + [t0] * (rest - rest // 2)


def tube(pts, radius, sides: int = 24, cap0: bool = True, cap1: bool = True, cap_steps: int = 5):
    """A tube whose radius may vary round it: radius(t, a), t in 0..1 along the points, a the angle."""
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
                verts.append(tuple(p + t * (sign * math.sin(ang) * r0) + (u * math.cos(a) + v * math.sin(a)) * (radius(tt, a) * math.cos(ang))))
                ring.append(len(verts) - 1)
            for k in range(sides):
                k2 = (k + 1) % sides
                faces.append((prev[k], prev[k2], ring[k2], ring[k]) if sign > 0 else (prev[k], ring[k], ring[k2], prev[k2]))
            prev = ring
        verts.append(tuple(p + t * (sign * r0)))
        tip = len(verts) - 1
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((prev[k], prev[k2], tip) if sign > 0 else (prev[k], tip, prev[k2]))

    if cap1:
        cap(n - 1, 1)
    if cap0:
        cap(0, -1)
    return verts, faces


def closed_tube(pts, nrm, r_n, r_b, sides: int = 12):
    """A tube round a closed loop of points; its cross-section is an ellipse r_n along the given
    normals (e.g. the head surface normal) and r_b across the loop."""
    n = len(pts)
    verts, faces = [], []
    for i in range(n):
        t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        N = (nrm[i] - t * nrm[i].dot(t)).normalized()
        B = t.cross(N)
        rn = r_n(i / n) if callable(r_n) else r_n
        rb = r_b(i / n) if callable(r_b) else r_b
        for k in range(sides):
            a = k / sides * math.tau
            verts.append(tuple(pts[i] + N * (math.cos(a) * rn) + B * (math.sin(a) * rb)))
    for i in range(n):
        i2 = (i + 1) % n
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((i * sides + k, i * sides + k2, i2 * sides + k2, i2 * sides + k))
    return verts, faces


def wrap_shell(prof, depth, z0, z1, gap, lift=0.0, thick=0.02, rows: int = 16, cols: int = 44):
    """A cloth panel wrapped round an elliptical body (half-width prof(z) + lift, depth factor `depth`)
    from z0 to z1, open at the front: gap(z) is the half-angle (degrees) of the opening either side of
    the front (-Y). Two layers `thick` apart, joined along every edge."""
    verts, faces, layers = [], [], []
    for dl in (0.0, -thick):
        g = []
        for i in range(rows + 1):
            z = z0 + (z1 - z0) * i / rows
            r = prof(z) + lift + dl
            ga = gap(z)
            a0, a1 = -90.0 + ga, 270.0 - ga
            row = []
            for k in range(cols + 1):
                a = math.radians(a0 + (a1 - a0) * k / cols)
                verts.append((r * math.cos(a), depth * r * math.sin(a), z))
                row.append(len(verts) - 1)
            g.append(row)
        layers.append(g)
    go, gi = layers
    for i in range(rows):
        for k in range(cols):
            faces.append((go[i][k], go[i][k + 1], go[i + 1][k + 1], go[i + 1][k]))
            faces.append((gi[i][k], gi[i + 1][k], gi[i + 1][k + 1], gi[i][k + 1]))
        faces.append((go[i][0], go[i + 1][0], gi[i + 1][0], gi[i][0]))
        faces.append((go[i][cols], gi[i][cols], gi[i + 1][cols], go[i + 1][cols]))
    for k in range(cols):
        faces.append((go[0][k], gi[0][k], gi[0][k + 1], go[0][k + 1]))
        faces.append((go[rows][k], go[rows][k + 1], gi[rows][k + 1], gi[rows][k]))
    return verts, faces


def fluted(profile, flutes: int = 10, depth: float = 0.12, sides: int = 40):
    """A lathe round the Z axis from (radius, z) rows (top to bottom), with rounded vertical ridges
    (a bundle of yarn: the tassel). Closed at both ends."""
    verts, faces = [], []
    rows = len(profile)
    for (r, z) in profile:
        for k in range(sides):
            a = k / sides * math.tau
            rr = r * (1.0 + depth * math.cos(flutes * a))
            verts.append((math.cos(a) * rr, math.sin(a) * rr, z))
    for i in range(rows - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, a + sides, b + sides, b))
    faces.append(tuple(range(sides)))
    verts.append((0.0, 0.0, profile[-1][1] - 0.2 * profile[-1][0]))
    c = len(verts) - 1
    last = (rows - 1) * sides
    for k in range(sides):
        faces.append((last + k, c, last + (k + 1) % sides))
    return verts, faces


class FurHead(HeadShape):
    """The head ellipsoid plus soft bumps (muzzle, cheeks). point(), frame(), surface() and conform()
    follow the bumped surface, so the features placed by Hero.face() sit on it, and mesh() builds the
    head from the same surface."""

    def __init__(self, rx, ry, rz, center, bumps, taper: float = 0.0):
        super().__init__(rx, ry, rz, center)
        self.bumps = bumps  # [(unit direction, angular radius in degrees, height)]
        self.taper = taper  # the upper half narrows sideways by up to this fraction at the crown

    def surf(self, d: Vector) -> Vector:
        d = d.normalized()
        r = self.r
        k = 1.0 / math.sqrt((d.x / r.x) ** 2 + (d.y / r.y) ** 2 + (d.z / r.z) ** 2)
        pos = self.c + d * k
        n = Vector(((pos.x - self.c.x) / r.x ** 2, (pos.y - self.c.y) / r.y ** 2, (pos.z - self.c.z) / r.z ** 2)).normalized()
        if self.taper:
            u = (pos.z - self.c.z) / r.z
            pos.x = self.c.x + (pos.x - self.c.x) * (1.0 - self.taper * sstep((u - 0.04) / 0.42))
        h = 0.0
        for bd, ang, amp in self.bumps:
            a = math.degrees(math.acos(max(-1.0, min(1.0, d.dot(bd)))))
            h += amp * sstep(1.0 - a / ang)
        return pos + n * h

    def normal_at(self, d: Vector) -> Vector:
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

    def point(self, yaw: float, pitch: float, lift: float = 0.0):
        d = direction(yaw, pitch)
        n = self.normal_at(d)
        return self.surf(d) + n * lift, n

    def surface(self, d: Vector):
        return self.surf(d), self.normal_at(d)

    def mesh(self, seg: int = 48, rings: int = 30):
        verts, faces = ellipsoid(1.0, 1.0, 1.0, seg, rings)
        return [tuple(self.surf(Vector(v))) for v in verts], faces


# ------------------------------------------------------------------------------------------
class Pipper(Hero):
    """Pipper, the Travelling Merchant: a chubby furry merchant in a big floppy purple hat and robe."""

    key = 'pipper'
    ankle_h = 0.125
    hip_h = 0.42
    spine = 0.10
    chest = 0.24
    neck = 0.13
    head_up = 0.04
    shoulder = (0.37, -0.05, 0.12)
    upper_arm = 0.3
    forearm = 0.27
    hip_w = 0.33
    thigh = 0.13
    shin = 0.13
    sit_h = 0.22

    C = dict(fur='#9c5c32', fur_d='#74421f', tan='#eeb47c', nose='#4a2016', iris='#5a2a12', brow='#5a2a12', ear_in='#e0a07c',
             paw='#74442a', foot='#673a22',
             hat='#5c2a82', hat_l='#7a3f9e', hat_d='#431c62', band='#52257a', gold='#f0ac2a', tassel='#eb9a1c',
             robe='#5a2a80', robe_d='#421d60', cream='#e9d0a4', cream_d='#e6cfa8',
             leather='#7a4526', pouch='#c4762a', pouch_d='#8e4f1e', brass='#e3aa3c',
             gem_g='#3cb44c', gem_b='#2f9be0', gem_y='#f5c330', gem_t='#28b8c0',
             wicker='#b98246', wicker_d='#80502a', gift='#f7c444', gift_d='#eaa92c', ribbon='#2d8fe2', coin='#f7b91e')

    HEAD = (0.59, 0.48, 0.46, 0.50)  # rx, ry, rz, centre height above the head joint
    TAPER = 0.26  # the head narrows towards the crown (it is widest at the cheeks)
    EYE = (27.0, 3.5)  # eye yaw / pitch on the head
    # the hat's lower edge on the head: pitch (degrees) by |yaw|; it sits lower on his right (see brim())
    BRIM = [(0, 34), (30, 26), (60, 8), (90, -9), (120, -15), (180, -15)]
    BRIM_TILT = 10.0  # the brim is lower on his right side, higher on his left
    # the floppy part of the hat: spine control points relative to the head centre, and its radius
    HAT_SPINE = [(-0.08, 0.06, 0.27), (-0.28, 0.16, 0.3), (-0.46, 0.3, 0.24), (-0.6, 0.44, 0.14), (-0.68, 0.54, 0.06), (-0.72, 0.6, 0.0)]
    HAT_R = [(0.0, 0.24), (0.2, 0.215), (0.45, 0.18), (0.7, 0.14), (0.88, 0.1), (1.0, 0.065)]
    # torso half-width by height in the chest frame (depth is DEPTH of it); robe skirt by height in the hips frame
    TORSO = [(-0.46, 0.43), (-0.36, 0.49), (-0.24, 0.505), (-0.12, 0.49), (0.0, 0.452), (0.08, 0.41), (0.14, 0.36), (0.19, 0.29),
             (0.23, 0.2)]
    SKIRT = [(0.2, 0.5), (0.1, 0.535), (0.0, 0.585), (-0.08, 0.645), (-0.16, 0.72)]
    DEPTH = 0.85
    HEM = -0.155  # robe hem height in the hips frame

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.15

    # --- materials --------------------------------------------------------------------------------
    def materials(self):
        c, mt = self.C, self.m
        self.mat = dict(
            fur=mt.fur('pip_fur', c['fur']),
            tan=mt.fur('pip_tan', c['tan']),
            paw=mt.fur('pip_paw', c['paw']),
            foot=mt.fur('pip_foot', c['foot']),
            tuft=mt.hair('pip_tuft', c['fur_d'], c['fur'], 0.6),
            cheek=mt.hair('pip_cheek', '#a86a3a', '#e9b27c', 0.6),
            ear_in=mt.skin('pip_ear_in', c['ear_in']),
            nose=mt.glossy('pip_nose', c['nose'], 0.28, 0.7),
            hat=self.soft_cloth('pip_hat', c['hat'], c['hat_l'], c['hat_d'], 0.45),
            band=self.soft_cloth('pip_band', c['band'], c['hat'], c['hat_d'], 0.45),
            gold=mt.metal('pip_gold', c['gold'], 0.32),
            tassel=mt.cloth('pip_tassel', c['tassel'], 0.5, 0.6, 0.1, 90),
            robe=self.soft_cloth('pip_robe', c['robe'], c['hat_l'], c['robe_d']),
            cream=mt.cloth('pip_cream', c['cream'], 0.78, 0.35, 0.05),
            cream_d=mt.cloth('pip_cream_d', c['cream_d'], 0.78, 0.3),
            leather=mt.cloth('pip_leather', c['leather'], 0.5, 0.2, 0.1, 40),
            pouch=mt.cloth('pip_pouch', c['pouch'], 0.48, 0.2, 0.1, 25),
            pouch_d=mt.cloth('pip_pouch_d', c['pouch_d'], 0.5, 0.2, 0.08, 25),
            brass=mt.metal('pip_brass', c['brass'], 0.3),
            gem_g=mt.glossy('pip_gem_g', c['gem_g'], 0.12, 0.9),
            gem_b=mt.glossy('pip_gem_b', c['gem_b'], 0.12, 0.9),
            gem_y=mt.glossy('pip_gem_y', c['gem_y'], 0.12, 0.9),
            gem_t=mt.glossy('pip_gem_t', c['gem_t'], 0.12, 0.9),
            wicker=self.wicker('pip_wicker'),
            gift=mt.glossy('pip_gift', c['gift'], 0.38, 0.3),
            gift_d=mt.glossy('pip_gift_d', c['gift_d'], 0.4, 0.3),
            ribbon=mt.cloth('pip_ribbon', c['ribbon'], 0.35, 0.5),
            coin=mt.metal('pip_coin', c['coin'], 0.2),
            sparkle=mt.emit('pip_sparkle', '#ffe27a', 2.4),
            mouth=mt.glossy('pip_mouth', '#5c1f1c', 0.4, 0.2),
            tongue=mt.glossy('pip_tongue', '#ea6f6f', 0.35, 0.3),
            teeth=mt.glossy('pip_teeth', '#fffdf6', 0.25, 0.4),
        )

    def soft_cloth(self, name: str, color: str, light: str, dark: str, shadow: float = 1.0):
        """Brushed felt: gentle lighter / darker patches and a fine nap. `shadow` < 1 lets part of the
        light through to what lies under it (the hat's brim would otherwise darken his whole face)."""
        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            big = m.noise(3.2, 3, 0.55, obj)
            c = m.ramp(big.outputs['Fac'], [(0.32, dark), (0.5, color), (0.68, light)])
            fine = m.noise(55.0, 3, 0.6, obj)
            nrm = m.bump(fine.outputs['Fac'], 0.07, 0.02)
            b = m.bsdf(c, 0.74, normal=nrm, sheen=0.5, spec=0.3)
            if shadow < 1.0:
                lp = m.node('ShaderNodeLightPath')
                tr = m.node('ShaderNodeBsdfTransparent')
                mix = m.node('ShaderNodeMixShader')
                m.link(m.math('MULTIPLY', lp.outputs['Is Shadow Ray'], 1.0 - shadow), mix.inputs['Fac'])
                m.link(b.outputs['BSDF'], mix.inputs[1])
                m.link(tr.outputs['BSDF'], mix.inputs[2])
                m.link(mix.outputs['Shader'], m.out.inputs['Surface'])
            return m.mat
        return self.m.get(name, make)

    def wicker(self, name: str):
        """Basket weave from object coordinates: rows of weavers passing over and under upright stakes."""
        c = self.C

        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            sx, sy, sz = m.sep(obj)
            rows = m.math('MULTIPLY', sz, 17.0)
            fr = m.math('FRACT', rows)
            idx = m.math('FLOOR', rows)
            strand = m.math('SUBTRACT', 1.0, m.math('POWER', m.math('ABSOLUTE', m.math('SUBTRACT', m.math('MULTIPLY', fr, 2.0), 1.0)), 2.0))
            u = m.math('ADD', m.math('MULTIPLY', m.math('ADD', sx, m.math('MULTIPLY', sy, 0.6)), 9.0), m.math('MULTIPLY', idx, 0.5))
            fu = m.math('FRACT', u)
            over = m.math('SUBTRACT', 1.0, m.math('POWER', m.math('ABSOLUTE', m.math('SUBTRACT', m.math('MULTIPLY', fu, 2.0), 1.0)), 2.0))
            h = m.math('MULTIPLY', m.math('ADD', 0.35, m.math('MULTIPLY', strand, 0.65)), m.math('ADD', 0.25, m.math('MULTIPLY', over, 0.75)))
            colr = m.ramp(h, [(0.0, c['wicker_d']), (0.45, c['wicker']), (1.0, '#d29a5c')])
            nrm = m.bump(h, 0.25, 0.01)
            m.bsdf(colr, 0.66, normal=nrm, sheen=0.2, spec=0.3)
            return m.mat
        return self.m.get(name, make)

    def face_fur(self, name: str, head: FurHead):
        """Brown fur with a tan mask (lower face, cheeks, patches round the eyes) from object coordinates,
        a brown stripe running up between the eyes and brown sides."""
        c = self.C
        hc = self.HEAD[3]
        ep, _n = head.point(*self.EYE)
        ex, ev = abs(ep.x), ep.z - hc

        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            sx, sy, sz = m.sep(obj)
            ax = m.math('ABSOLUTE', sx)
            v = m.math('SUBTRACT', sz, hc)
            front = m.maprange(sy, -0.04, -0.24)
            lower = m.maprange(v, 0.08, -0.04)
            dx = m.math('DIVIDE', m.math('SUBTRACT', ax, ex), 0.2)
            dv = m.math('DIVIDE', m.math('SUBTRACT', v, ev), 0.22)
            d = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', dx, dx), m.math('MULTIPLY', dv, dv)))
            mask = m.math('MAXIMUM', lower, m.maprange(d, 1.0, 0.8))
            stripe = m.math('MULTIPLY', m.maprange(ax, 0.075, 0.035), m.maprange(v, 0.04, 0.12))
            mask = m.math('MULTIPLY', mask, m.math('SUBTRACT', 1.0, stripe))
            mask = m.math('MULTIPLY', mask, m.math('MULTIPLY', front, m.maprange(ax, 0.5, 0.38)))
            colr = m.mix(mask, col(c['fur']), col(c['tan']))
            nz = m.noise(38.0, 4, 0.7, obj)
            nrm = m.bump(nz.outputs['Fac'], 0.1, 0.02)
            m.bsdf(colr, 0.62, normal=nrm, sheen=0.7, spec=0.3)
            return m.mat
        return self.m.get(name, make)

    # --- building -----------------------------------------------------------------------------------
    def dress(self):
        self.materials()
        self.torso()
        self.gear()
        self.legs()
        self.arms()
        self.head_parts()
        self.hat()
        self.backpack()
        self.tail()
        ex = self.pose.get('extra', {})
        if ex.get('gift'):
            self.held_gift()
        if ex.get('coin'):
            self.held_coin()

    def trad(self, z: float) -> float:
        return interp(self.TORSO, z)

    def srad(self, z: float) -> float:
        return interp(self.SKIRT, z)

    def front_y(self, x: float, z: float, lift: float) -> float:
        """y of the front of the robe (chest frame) at (x, z), lifted off it by `lift`."""
        r = self.trad(z) + 0.022 + lift
        return -self.DEPTH * math.sqrt(max(0.0, r * r - x * x))

    def torso(self):
        M = self.mat
        tr, D = self.trad, self.DEPTH
        # cream tunic body (chest frame) and its skirt (hips frame)
        z0, z1 = -0.42, 0.2
        pts = [Vector((0, 0, z0 + (z1 - z0) * i / 16)) for i in range(17)]
        self.add('tunic', sweep(pts, lambda t: tr(z0 + (z1 - z0) * t) - 0.004, 30, cap0=False, cap1=True, squash=D), M['cream'], 'chest')
        h0, h1 = 0.18, self.HEM + 0.01
        pts = [Vector((0, 0, h0 + (h1 - h0) * i / 10)) for i in range(11)]
        self.add('tunicskirt', sweep(pts, lambda t: self.srad(h0 + (h1 - h0) * t) - 0.01, 30, cap0=True, cap1=False, squash=D), M['cream'], 'hips')
        # purple robe open over it: the upper robe (chest frame), a yoke over the shoulders, the skirt (hips frame)
        gap_top = lambda z: interp([(-0.3, 26.0), (-0.05, 21.0), (0.2, 12.0)], z)  # noqa: E731
        self.add('robe', wrap_shell(tr, D, -0.3, 0.2, gap_top, 0.022, 0.02, 16, 44), M['robe'], 'chest')
        self.add('yoke', ellipsoid(0.395, 0.395 * D, 0.1, 32, 12, center=(0, 0.0, 0.13), zmin=-0.3), M['robe'], 'chest')
        gap_sk = lambda z: interp([(self.HEM, 24.0), (0.2, 24.0)], z)  # noqa: E731
        self.add('robeskirt', wrap_shell(self.srad, D, self.HEM, 0.2, gap_sk, 0.022, 0.022, 12, 44), M['robe'], 'hips')
        # cream lining showing along the robe's front edges
        for sd in (1, -1):
            e_top = [self.edge_point(tr, D, z, gap_top(z), sd, 0.024) for z in [-0.3 + 0.5 * i / 10 for i in range(11)]]
            self.add('lining', sweep(e_top, 0.021, 8), M['cream'], 'chest')
            e_sk = [self.edge_point(self.srad, D, z, gap_sk(z), sd, 0.024) for z in [0.2 + (self.HEM - 0.2) * i / 8 for i in range(9)]]
            self.add('lining_sk', sweep(e_sk, 0.022, 8), M['cream'], 'hips')
        # cream shawl collar round the neck, dipping to a V at the front
        ctrl = []
        for i in range(25):
            phi = rad(-90 + 360 * i / 24)
            f = max(0.0, -math.sin(phi)) ** 2.2
            z = 0.215 - 0.17 * f
            r = 0.25 + 0.1 * f ** 0.7
            ctrl.append(Vector((r * math.cos(phi), D * r * math.sin(phi) - 0.035 * f, z)))
        self.add('collar', sweep(ctrl, lambda t: 0.05, 14, squash=0.8), M['cream'], 'chest')

    @staticmethod
    def edge_point(prof, D, z, gap, sd, lift):
        a = rad(-90 + gap * sd)
        r = prof(z) + lift
        return Vector((r * math.cos(a), D * r * math.sin(a), z))

    def gear(self):
        """Leather straps (one over his left shoulder carrying a gold badge, one slung across his chest),
        the belt with its buckle, and four big pouches with gemstone buttons."""
        M = self.mat
        D = self.DEPTH
        fy = self.front_y
        x = 0.24
        ctrl = [Vector((0.2, 0.3, 0.14)), Vector((0.23, 0.12, 0.24)), Vector((0.24, -0.1, 0.225)),
                Vector((x, fy(x, 0.1, 0.03), 0.1)), Vector((x * 1.04, fy(x * 1.04, -0.05, 0.03), -0.05)),
                Vector((x * 1.06, fy(x * 1.06, -0.2, 0.035), -0.2))]
        self.add('strap', sweep(curve(ctrl, 20), 0.036, 10, squash=0.35), M['leather'], 'chest')
        ctrl = [Vector((-0.2, 0.3, 0.14)), Vector((-0.23, 0.12, 0.24)), Vector((-0.24, -0.1, 0.225))]
        for (xx, zz) in ((-0.2, 0.12), (-0.06, 0.02), (0.1, -0.08), (0.26, -0.18), (0.36, -0.26)):
            ctrl.append(Vector((xx, fy(xx, zz, 0.045), zz)))
        self.add('strap2', sweep(curve(ctrl, 24), 0.038, 10, squash=0.35), M['leather'], 'chest')
        # the gold badge on his left strap
        bx, bz = 0.255, 0.02
        by = fy(bx, bz, 0.05)
        rr = self.trad(bz) + 0.07
        nrm = Vector((bx / rr ** 2, by / (rr * D) ** 2, 0.0)).normalized()
        bm = self.orient(Vector((bx, by, bz)), nrm) @ S(1.12)
        self.add('badge', disc(0.072, 0.03, 36), M['brass'], 'chest', bm)
        self.add('badgerim', torus(0.066, 0.012, 36, 8), M['brass'], 'chest', bm @ T(0, -0.016, 0) @ R(90, 0, 0))
        self.add('badgegem', ellipsoid(0.046, 0.022, 0.046, 22, 12, center=(0, -0.012, 0)), M['gem_t'], 'chest', bm)
        # belt (hips frame) over the robe
        zb = 0.18
        rb = self.srad(zb) + 0.046
        pts, nrms = [], []
        for i in range(64):
            a = i / 64 * math.tau
            pts.append(Vector((rb * math.cos(a), D * rb * math.sin(a), zb)))
            nrms.append(Vector((math.cos(a), math.sin(a) / D, 0.0)).normalized())
        self.add('belt', closed_tube(pts, nrms, 0.02, 0.042, 10), M['leather'], 'hips')
        self.add('buckle', superellipsoid(0.05, 0.016, 0.04, 4.0, 16, 8), M['brass'], 'hips', T(0, -D * rb - 0.018, zb))
        self.add('buckle_in', superellipsoid(0.032, 0.016, 0.022, 4.0, 14, 6), M['leather'], 'hips', T(0, -D * rb - 0.024, zb))
        for phi, gem, s in ((-118.0, 'gem_g', 1.75), (-58.0, 'gem_b', 1.65), (-168.0, 'gem_y', 1.6), (-12.0, 'gem_g', 1.45)):
            a = rad(phi)
            r_at = self.srad(zb - 0.07 * s) + 0.03
            p = Vector((r_at * math.cos(a), D * r_at * math.sin(a), zb - 0.07 * s))
            nrm = Vector((math.cos(a), math.sin(a) / D, 0.0)).normalized()
            pm = self.orient(p, nrm) @ R(-6, 0, 0) @ S(s)
            self.add('pouch', superellipsoid(0.088, 0.05, 0.082, 3.2, 20, 12, center=(0, -0.02, 0)), M['pouch'], 'hips', pm)
            self.add('pouchflap', superellipsoid(0.092, 0.026, 0.048, 3.0, 18, 8, center=(0, -0.058, 0.04)), M['pouch_d'], 'hips', pm)
            self.add('pouchring', torus(0.026, 0.007, 16, 6), M['brass'], 'hips', pm @ T(0, -0.086, 0.012) @ R(90, 0, 0))
            self.add('pouchgem', ellipsoid(0.022, 0.014, 0.022, 14, 8, center=(0, -0.088, 0.012)), M[gem], 'hips', pm)

    @staticmethod
    def orient(pos: Vector, nrm: Vector, roll: float = 0.0) -> Matrix:
        """A frame at `pos` whose -Y faces along `nrm` (parts are modelled facing -Y, up +Z)."""
        fwd = -Vector(nrm).normalized()
        x = fwd.cross(Vector((0.0, 0.0, 1.0)))
        if x.length < 1e-4:
            x = Vector((1.0, 0.0, 0.0))
        x.normalize()
        z = x.cross(fwd).normalized()
        m = Matrix((x, fwd, z)).transposed().to_4x4()
        m.translation = Vector(pos)
        return m @ R(0, roll, 0)

    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.105 - 0.012 * t, M['fur'], 0.0, 0.96, 14, 10)
            fm = self.J(an) @ R(0, 0, 18 * sd)
            self.add('foot' + s_, superellipsoid(0.16, 0.215, 0.1, 2.5, 26, 16, center=(0, -0.06, -0.025)), M['foot'], None, fm)
            for k, (x, y, r) in enumerate(((-0.075, -0.225, 0.062), (0.0, -0.24, 0.066), (0.075, -0.225, 0.062))):
                self.add(f'toe{k}' + s_, ellipsoid(r, r * 0.95, r * 0.85, 14, 10, center=(x, y, -0.125 + r * 0.85)), M['foot'], None, fm)

    def arms(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.125 + 0.035 * t, M['robe'], 0.0, 0.82, 16, 12, cap0=True, cap1=False)
            self.limb('cuff' + s_, sh, el, wr, lambda t: 0.156 + 0.012 * math.sin(math.pi * t), M['cream'], 0.77, 0.94, 18, 5, cap0=False, cap1=False)
            fr = self.limb_frame(sh, el, wr, 0.94, wr)
            self.add('cuffrim' + s_, torus(0.128, 0.042, 22, 10), M['cream'], None, fr)
            kind = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in paw(sd, kind, 1.72):
                self.add('paw' + nm + s_, mesh, M['paw'], None, wm)

    # --- head ---------------------------------------------------------------------------------------
    def head_parts(self):
        c, M = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        bumps = [(direction(0, -12), 30.0, 0.07),
                 (direction(38, -22), 40.0, 0.08), (direction(-38, -22), 40.0, 0.08),
                 (direction(72, -26), 44.0, 0.06), (direction(-72, -26), 44.0, 0.06)]
        head = FurHead(hx, hy, hz, (0, 0, hc), bumps, self.TAPER)
        self.add('head', head.mesh(), self.face_fur('pip_face', head), 'head')
        self.eyes(head)
        self.mouth(head)
        # nose: a dark rounded triangle on the tip of the muzzle
        nf = head.frame(0, -4.0, -0.008)
        self.add('nose', ellipsoid(0.06, 0.034, 0.038, 18, 10), M['nose'], 'head', nf)
        self.add('nose_tip', ellipsoid(0.03, 0.028, 0.028, 12, 8, center=(0, -0.006, -0.024)), M['nose'], 'head', nf)
        self.add('nose_shine', ellipsoid(0.016, 0.004, 0.009, 8, 4, center=(-0.018, -0.036, 0.012)), self.m.emit('eye_shine', '#ffffff', 3.0), 'head', nf)
        self.ears(head)
        self.tufts(head)

    EYE_SIZE = (0.13, 0.147)

    def eyes(self, head: FurHead):
        """Big round eyes with plenty of white, a warm brown iris ringed in dark, a dark outline and short
        thick brows (a variant of Hero.face's eyes), driven by the pose's face dict; plus the blush."""
        c, mt = self.C, self.m
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        eyes, brows = f['eyes'], f['brows']
        lx, lz = f.get('look', (0.0, 0.0))
        white = mt.glossy('eye_white', '#fbfbf8', 0.18, 0.8)
        dark = mt.glossy('eye_dark', '#1c1412', 0.25, 0.9)
        irm = mt.glossy('pip_iris', c['iris'], 0.2, 0.9)
        shine = mt.emit('eye_shine', '#ffffff', 3.0)
        lash = mt.glossy('pip_lash', '#2a1610', 0.4, 0.2)
        browm = mt.cloth('pip_brow', c['brow'], 0.6, 0.2)
        eye_yaw, eye_pitch = self.EYE
        ew, eh = self.EYE_SIZE
        ed = ew * 0.34
        for side in (1, -1):
            yaw = eye_yaw * side
            fr = head.frame(yaw, eye_pitch, -ed * 0.55)
            nm = 'L' if side > 0 else 'R'
            kind = eyes
            if eyes == 'wink':
                kind = 'open' if side > 0 else 'happy'
            if kind in ('open', 'wide', 'half', 'sad', 'determined'):
                sc = 1.1 if kind == 'wide' else 1.0
                self.feat('sclera' + nm, ellipsoid(ew * sc, ed, eh * sc, 24, 14), white, 'head', head, fr)
                ir = 0.78 * ew * (0.88 if kind == 'wide' else 1.0)
                off = Vector((lx * ew * 0.25 - 0.16 * ew * side, -ed * 0.9, lz * eh * 0.2 - eh * 0.02))
                self.feat('iring' + nm, ellipsoid(ir * 1.1, ed * 0.2, ir * 1.2, 22, 10, center=off + Vector((0, 0.002, 0))), dark, 'head', head, fr)
                self.feat('iris' + nm, ellipsoid(ir, ed * 0.22, ir * 1.1, 22, 10, center=off + Vector((0, -0.002, 0))), irm, 'head', head, fr)
                pr = ir * 0.6
                self.feat('pupil' + nm, ellipsoid(pr, ed * 0.2, pr * 1.1, 16, 8, center=off + Vector((0.0, -ed * 0.14, 0.0))), dark, 'head', head, fr)
                h1 = off + Vector((-ir * 0.36, -ed * 0.3, ir * 0.42))
                self.feat('shine' + nm, ellipsoid(ir * 0.32, 0.004, ir * 0.34, 10, 6, center=h1), shine, 'head', head, fr)
                h2 = off + Vector((ir * 0.42, -ed * 0.3, -ir * 0.42))
                self.feat('shine2' + nm, ellipsoid(ir * 0.14, 0.004, ir * 0.14, 8, 5, center=h2), shine, 'head', head, fr)
                # dark outline: a bold upper lash line and a fine line round the bottom
                up = [Vector((math.sin(a) * ew * sc * 1.03, -ed * 0.55, math.cos(a) * eh * sc * 1.02)) for a in [(-1 + 2 * i / 14) * 1.5 for i in range(15)]]
                self.feat('lash' + nm, sweep(up, lambda t: 0.006 + 0.009 * math.sin(math.pi * t), 6), lash, 'head', head, fr)
                lo = [Vector((math.sin(a) * ew * sc * 1.02, -ed * 0.5, math.cos(a) * eh * sc * 1.01)) for a in [math.pi + (-1 + 2 * i / 12) * 1.2 for i in range(13)]]
                self.feat('lashlo' + nm, sweep(lo, lambda t: 0.0035 + 0.002 * math.sin(math.pi * t), 6), lash, 'head', head, fr)
            elif kind == 'happy':
                pts = arc_points(ew * 1.75, -eh * 0.5, 14, y=-0.01)
                self.feat('happy' + nm, sweep([p + Vector((0, 0, -eh * 0.18)) for p in pts], lambda t: 0.01 + 0.007 * math.sin(math.pi * t), 8), lash,
                          'head', head, fr)
            elif kind == 'closed':
                pts = arc_points(ew * 1.6, eh * 0.24, 12, y=-0.01)
                self.feat('closed' + nm, sweep(pts, 0.012, 8), lash, 'head', head, fr)
            # brows: short and thick, raised a little when the eyes are wide
            b_pitch = eye_pitch + 16.0 + (3 if brows == 'up' else 0) + (2 if eyes == 'wide' else 0) + (-2 if kind == 'happy' else 0)
            roll = {'neutral': 0, 'up': -4, 'worried': 16, 'angry': -18, 'determined': -12, 'sad': 14}.get(brows, 0) * side
            bf = head.frame(yaw * 1.02 + 2 * side, b_pitch, 0.004, roll)
            bpts = arc_points(ew * 1.25, -0.016, 10)
            self.feat('brow' + nm, sweep(bpts, lambda t: 0.013 + 0.008 * math.sin(math.pi * t), 8), browm, 'head', head, bf)
        bl = mt.alpha('pip_blush', '#ff8a7a', 0.4)
        for side in (1, -1):
            bf = head.frame(side * (eye_yaw + 14), eye_pitch - 19, 0.003)
            self.feat('blush', ellipsoid(0.058, 0.004, 0.034, 16, 6), bl, 'head', head, bf)

    def mouth(self, head: FurHead):
        M = self.mat
        f = dict(eyes='open', mouth='smile')
        f.update(self.pose.get('face', {}))
        kind = f['mouth']
        lip = [head.point(0, p_, 0.002)[0] for p_ in (-9.5, -12.0, -14.5)]
        self.add('philtrum', sweep(lip, lambda t: 0.0065 - 0.001 * t, 6), M['mouth'], 'head')
        mf = head.frame(0, -16.0, 0.0)
        if kind in ('smile', 'grin', 'open', 'laugh'):
            w, h, up = {'smile': (0.2, 0.1, 0.05), 'grin': (0.2, 0.15, 0.045), 'open': (0.18, 0.16, 0.036),
                        'laugh': (0.21, 0.17, 0.045)}[kind]
            self.feat('mouth', mouth_slab(w, h, up), M['mouth'], 'head', head, mf)
            line = [Vector((u * w * 1.1, -0.004, up * 1.25 * u * u - 0.004 * (1 - u * u))) for u in [(-1 + 2 * i / 16) for i in range(17)]]
            self.feat('lipline', sweep(line, lambda t: 0.0045 + 0.002 * math.sin(math.pi * t), 6), M['mouth'], 'head', head, mf)
            tw = w * 0.45
            self.feat('tongue', ellipsoid(tw, 0.012, h * 0.34, 16, 8, center=(0, -0.012, -h * 0.72)), M['tongue'], 'head', head, mf)
            if kind != 'smile':
                for sd in (1, -1):
                    self.feat('tooth', superellipsoid(0.017, 0.008, 0.019, 3.0, 12, 6, center=(0.0185 * sd, -0.013, -0.02)), M['teeth'], 'head', head, mf)
        else:
            # the stock expressions (o, gasp, frown, flat ...) are fine as they are
            fr = dict(self.pose)
            self.pose = dict(self.pose, face=dict(f, eyes='none'))
            n0 = len(self.parts)
            self.face(head, 'head', eye_yaw=self.EYE[0], eye_pitch=self.EYE[1], eye_size=(0.106, 0.126), mouth_pitch=-26, mouth_w=0.9,
                      nose=False, blush=False)
            self.parts = self.parts[:n0] + [p for p in self.parts[n0:] if p.name in ('mouth', 'tongue', 'teeth')]
            self.pose = fr

    def ears(self, head: FurHead):
        """Small round ears poking out from under the hat at the sides, facing forwards and outwards."""
        M = self.mat
        for sd in (1, -1):
            yaw = 90 * sd
            pos, n = head.point(yaw, max(-6.0, self.brim(yaw) - 10.0), 0.0)
            fd = (n + Vector((0.0, -0.9, 0.0))).normalized()
            em = self.orient(pos + n * 0.015, fd)
            self.add('ear', ellipsoid(0.078, 0.032, 0.074, 18, 10), M['fur'], 'head', em)
            self.add('earin', ellipsoid(0.048, 0.012, 0.045, 14, 8, center=(0, -0.026, -0.004)), M['ear_in'], 'head', em)

    def tufts(self, head: FurHead):
        M = self.mat
        hx, hy, hz, hc = self.HEAD
        acc_v, acc_f, acc_t = [], [], []

        def lock(pos, n, fl, ln, r0, flick=0.3, flat=0.5):
            fl = Vector(fl).normalized()
            fl = (fl - n * fl.dot(n) * 0.6).normalized()
            pts = [pos + fl * (ln * t) + n * (ln * flick * t * t) for t in [k / 7 for k in range(8)]]
            vv, ff = flat_sweep(pts, lambda t: r0 * (1 - 0.8 * t ** 1.3), n, flat, 12)
            b0 = len(acc_v)
            acc_v.extend(vv)
            acc_f.extend(tuple(q + b0 for q in fc) for fc in ff)
            acc_t.extend(flat_tip(8, 12, len(vv)))

        # fluffy cheeks: soft pointed locks flicking out at the sides of the face
        for sd in (1, -1):
            for yaw, pitch, ln, dz, r0 in ((72, -6, 0.09, -0.15, 0.075), (74, -21, 0.115, -0.45, 0.09), (69, -37, 0.1, -0.85, 0.08)):
                pos, n = head.point(yaw * sd, pitch, -0.035)
                lock(pos, n, (sd * 1.0, 0.3, dz), ln, r0, 0.2, 0.5)
        self.add('cheeks', (acc_v, acc_f), M['cheek'], 'head', tip=acc_t)
        # a little tuft of fur on the forehead, peeking out under the hat
        acc_v, acc_f, acc_t = [], [], []
        for yaw, ln, dx in ((-12, 0.085, -0.5), (2, 0.095, 0.1), (14, 0.07, 0.6)):
            pos, n = head.point(yaw, self.brim(yaw) - 2, -0.02)
            lock(pos, n, (dx, -0.3, -1.0), ln, 0.05, 0.4, 0.45)
        self.add('forelock', (acc_v, acc_f), M['tuft'], 'head', tip=acc_t)

    # --- hat ----------------------------------------------------------------------------------------
    def brim(self, yaw: float) -> float:
        return interp(self.BRIM, abs(yaw)) + self.BRIM_TILT * math.sin(rad(yaw))

    # the hat is the same in every pose (it rides on the head): built once per process
    _HAT = {}
    CAP = (0.03, 0.03, 0.03)  # the cap: the head ellipsoid inflated by these amounts (x, y, z)
    HAT_K = 0.11  # smoothness of the join between the cap and the floppy part

    def brim_np(self, yaw):
        tab_y = np.arange(-180.0, 181.0, 1.0)
        tab_p = np.array([self.brim(y) for y in tab_y])
        return np.interp(yaw, tab_y, tab_p)

    def hat_parts_sdf(self):
        hx, hy, hz, hc = self.HEAD
        C = np.array([0.0, 0.0, hc])
        r = np.array([hx + self.CAP[0], hy + self.CAP[1], hz + self.CAP[2]])
        sp = [np.array(tuple(v)) for v in curve([Vector(C) + Vector(p) for p in self.HAT_SPINE], 18)]
        rr = [interp(self.HAT_R, i / (len(sp) - 1)) for i in range(len(sp))]
        return C, r, sp, rr

    def cap_sdf(self, P, C, r):
        q = P - C
        u = np.clip((q[..., 2] / r[2] - 0.04) / 0.42, 0.0, 1.0)
        q = np.concatenate([(q[..., 0] / (1.0 - self.TAPER * u * u * (3.0 - 2.0 * u)))[..., None], q[..., 1:]], axis=-1)
        k0 = np.linalg.norm(q / r, axis=-1)
        k1 = np.linalg.norm(q / (r * r), axis=-1)
        d_cap = k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
        yaw = np.degrees(np.arctan2(q[..., 0], -q[..., 1]))
        pitch = np.degrees(np.arctan2(q[..., 2], np.hypot(q[..., 0], q[..., 1])))
        cut = np.radians(self.brim_np(yaw) - pitch) * np.linalg.norm(q, axis=-1)
        return np.maximum(d_cap, cut)

    @staticmethod
    def cone_sdf(P, a, b, ra, rb):
        ab = b - a
        t = np.clip(((P - a) @ ab) / max(1e-12, ab @ ab), 0.0, 1.0)
        return np.linalg.norm(P - (a + t[..., None] * ab), axis=-1) - (ra + t * (rb - ra))

    def smin(self, a, b):
        k = self.HAT_K
        h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
        return b + (a - b) * h - k * h * (1.0 - h)

    def hat_sdf(self, P):
        """Signed distance (negative inside) to the hat for points P (N x 3, head frame): a cap over the
        head cut along the brim, smoothly joined to a floppy round-cone chain flopping over to his right."""
        C, r, sp, rr = self.hat_parts_sdf()
        d_cone = np.full(P.shape[:-1], 1e9)
        for i in range(len(sp) - 1):
            d_cone = np.minimum(d_cone, self.cone_sdf(P, sp[i], sp[i + 1], rr[i], rr[i + 1]))
        return self.smin(self.cap_sdf(P, C, r), d_cone)

    def hat_mesh(self, step: float = 0.0115):
        key = (self.HEAD, tuple(self.HAT_SPINE), tuple(self.HAT_R), tuple(self.BRIM), self.BRIM_TILT, self.CAP, self.HAT_K, step)
        if key not in Pipper._HAT:
            from skimage import measure
            hx, hy, hz, hc = self.HEAD
            lo = np.array([-1.14, -0.66, hc - 0.4])
            hi = np.array([0.72, 0.66, hc + 0.66])
            n = np.ceil((hi - lo) / step).astype(int) + 1
            axes = [lo[i] + step * np.arange(n[i]) for i in range(3)]
            G = np.stack(np.meshgrid(*axes, indexing='ij'), axis=-1)
            C, r, sp, rr = self.hat_parts_sdf()
            d_cap = self.cap_sdf(G, C, r)
            d_cone = np.full(G.shape[:-1], 9.0)
            m = self.HAT_K + 0.06
            for i in range(len(sp) - 1):
                a, b = sp[i], sp[i + 1]
                e = max(rr[i], rr[i + 1]) + m
                i0 = np.clip(np.floor((np.minimum(a, b) - e - lo) / step).astype(int), 0, n - 1)
                i1 = np.clip(np.ceil((np.maximum(a, b) + e - lo) / step).astype(int) + 1, 0, n)
                blk = (slice(i0[0], i1[0]), slice(i0[1], i1[1]), slice(i0[2], i1[2]))
                d_cone[blk] = np.minimum(d_cone[blk], self.cone_sdf(G[blk], a, b, rr[i], rr[i + 1]))
            vol = self.smin(d_cap, d_cone)
            verts, faces, _nr, _vals = measure.marching_cubes(vol, 0.0, spacing=(step, step, step), allow_degenerate=False)
            verts = verts + lo
            Pipper._HAT[key] = ([tuple(v) for v in verts], [tuple(int(i) for i in f) for f in faces])
        return Pipper._HAT[key]

    def hat_surface(self, dirs):
        """Points on the hat surface along unit directions from the head centre (ray-marched bisection)."""
        hc = self.HEAD[3]
        C = np.array([0.0, 0.0, hc])
        D = np.array([tuple(d) for d in dirs])
        lo = np.full(len(D), 0.15)
        hi = np.full(len(D), 1.4)
        for _ in range(32):
            mid = 0.5 * (lo + hi)
            inside = self.hat_sdf(C + D * mid[:, None]) < 0.0
            lo = np.where(inside, mid, lo)
            hi = np.where(inside, hi, mid)
        return [Vector(tuple(C + d * t)) for d, t in zip(D, 0.5 * (lo + hi))]

    def hat(self):
        M = self.mat
        hx, hy, hz, hc = self.HEAD
        self.add('hat', self.hat_mesh(), M['hat'], 'head')
        # the rolled brim along the hat's lower edge
        hs = FurHead(hx + 0.012, hy + 0.012, hz + 0.012, (0, 0, hc), [], self.TAPER)
        ring, nrm = [], []
        n = 120
        for i in range(n):
            yaw = -180 + 360 * i / n
            p, nn = hs.point(yaw, self.brim(yaw), 0.01)
            ring.append(p)
            nrm.append(nn)
        r_n, r_b = 0.028, 0.08
        self.add('hatband', closed_tube(ring, nrm, r_n, r_b, 14), M['band'], 'head')
        # gold embroidery: a zigzag round the band with a line along its upper edge
        zz, top = [], []
        m = 30
        for i in range(m * 4 + 1):
            u = i / (m * 4)
            k = int(u * n) % n
            f_ = u * n - int(u * n)
            p = ring[k].lerp(ring[(k + 1) % n], f_)
            nn = nrm[k].lerp(nrm[(k + 1) % n], f_).normalized()
            t = (ring[(k + 1) % n] - ring[k - 1]).normalized()
            N = (nn - t * nn.dot(t)).normalized()
            B = t.cross(N)
            tri = 1.0 - abs((u * m * 2) % 2.0 - 1.0) * 2.0  # triangle wave -1..1
            a = rad(40.0 * tri)
            zz.append(p + N * (r_n * math.cos(a) + 0.005) + B * (r_b * math.sin(a)))
            a2 = rad(-68.0)
            top.append(p + N * (r_n * math.cos(a2) + 0.004) + B * (r_b * math.sin(a2)))
        self.add('hatzigzag', sweep(zz, 0.0105, 6), M['gold'], 'head')
        self.add('hattrim', sweep(top, 0.009, 6), M['gold'], 'head')
        # a gold triangle embroidered on the front of the cap
        corners = [(-4.0, 70.0), (-30.0, 41.0), (22.0, 41.0)]
        dirs = []
        for j in range(3):
            (y0, p0), (y1, p1) = corners[j], corners[(j + 1) % 3]
            for s_ in range(12):
                u = s_ / 12
                dirs.append(direction(y0 + (y1 - y0) * u, p0 + (p1 - p0) * u))
        dirs.append(dirs[0])
        C_ = Vector((0, 0, hc))
        tri_pts = [p + (p - C_).normalized() * 0.004 for p in self.hat_surface(dirs)]
        self.add('hattriangle', sweep(tri_pts, 0.0105, 6), M['gold'], 'head')
        # the tassel at the tip
        pts = curve([C_ + Vector(p) for p in self.HAT_SPINE], 32)
        tdir = (pts[-1] - pts[-2]).normalized()
        knot = pts[-1] + tdir * (self.HAT_R[-1][1] * 0.6) + Vector((0, 0, -0.03))
        self.add('tasselknot', ellipsoid(0.044, 0.044, 0.04, 16, 10, center=tuple(knot)), M['tassel'], 'head')
        prof = [(0.03, 0.0), (0.042, -0.03), (0.052, -0.07), (0.062, -0.12), (0.06, -0.15), (0.038, -0.166)]
        self.add('tassel', fluted(prof, 9, 0.12, 36), M['tassel'], 'head', T(*(knot + Vector((0, 0, -0.02)))))

    # --- backpack -----------------------------------------------------------------------------------
    BP = (-0.22, 0.67, -0.06)  # backpack centre in the chest frame (it rides a little towards his right)
    BP_SIZE = (0.37, 0.22, 0.42)

    def backpack(self):
        M = self.mat
        bx, by, bz = self.BP_SIZE
        bp = T(*self.BP) @ R(-4, 0, 6)
        v, f = superellipsoid(bx, by, bz, 3.0, 36, 24)
        v = [(x * (1 + 0.1 * z / bz), y * (1 + 0.06 * z / bz), z) for (x, y, z) in v]
        self.add('basket', (v, f), M['wicker'], 'chest', bp)
        # leather rim, a band round the middle and two upright straps down the back
        rim, mid, nrms = [], [], []
        zr = bz * 0.86
        for i in range(64):
            a = i / 64 * math.tau
            ca, sa = math.cos(a), math.sin(a)
            e = 2.0 / 3.0
            ex_, ey_ = math.copysign(abs(ca) ** e, ca), math.copysign(abs(sa) ** e, sa)
            rim.append(Vector((ex_ * (bx * 1.086 + 0.012), ey_ * (by * 1.052 + 0.012), zr)))
            mid.append(Vector((ex_ * (bx + 0.006), ey_ * (by + 0.006), -0.03)))
            nrms.append(Vector((ca, sa, 0.0)))
        self.add('basketrim', closed_tube(rim, nrms, 0.036, 0.042, 10), M['leather'], 'chest', bp)
        self.add('basketband', closed_tube(mid, nrms, 0.018, 0.036, 8), M['leather'], 'chest', bp)
        for sd in (1, -1):
            up = [Vector((0.44 * bx * sd, by + 0.01 + 0.02 * math.cos(math.pi * z / (2 * zr)) ** 2, z)) for z in [zr - 2 * zr * i / 10 for i in range(11)]]
            self.add('basketstrap', sweep(up, 0.032, 8, squash=0.35), M['leather'], 'chest', bp)
            self.add('basketbuckle', superellipsoid(0.036, 0.012, 0.032, 4.0, 12, 6), M['brass'], 'chest', bp @ T(0.44 * bx * sd, by + 0.035, -0.03))
        # gifts in the basket: a big box with a blue bow and a smaller one beside it
        self.gift_box('pack_gift', 'chest', bp @ T(-0.1, 0.04, zr + 0.07) @ R(4, -10, 16), (0.16, 0.13, 0.12), bow=True)
        self.gift_box('pack_gift2', 'chest', bp @ T(0.16, 0.06, zr + 0.05) @ R(-6, 12, -10), (0.12, 0.1, 0.1), bow=False)

    def gift_box(self, name, joint, fm, size, bow=True, bow_scale=1.0):
        M = self.mat
        sx, sy, sz = size
        self.add(name, superellipsoid(sx, sy, sz, 7.0, 24, 16), M['gift'], joint, fm)
        self.add(name + 'lid', superellipsoid(sx + 0.01, sy + 0.01, 0.034 + 0.1 * sz, 7.0, 24, 10, center=(0, 0, sz - 0.03 - 0.08 * sz)), M['gift_d'],
                 joint, fm)
        w = 0.022 + 0.1 * min(sx, sy)
        self.add(name + 'rx', superellipsoid(sx + 0.016, w, sz + 0.016, 8.0, 24, 14), M['ribbon'], joint, fm)
        self.add(name + 'ry', superellipsoid(w, sy + 0.016, sz + 0.016, 8.0, 24, 14), M['ribbon'], joint, fm)
        if bow:
            b = bow_scale
            top = sz + 0.02
            for sd in (1, -1):
                lm = T(0.058 * sd * b, 0, top + 0.035 * b) @ R(0, -38 * sd, 0) @ R(90, 0, 0) @ S(1.25 * b, 0.95 * b, 1.0 * b)
                self.add(name + 'loop', torus(0.045, 0.02, 20, 10), M['ribbon'], joint, fm @ lm)
                tail = [Vector((0.02 * sd, -0.01, top)), Vector((0.07 * sd * b, -0.04 * b, top - 0.01)), Vector((0.1 * sd * b, -0.06 * b, top - 0.05 * b))]
                self.add(name + 'tail', sweep(curve(tail, 8), 0.016 * b, 8, squash=0.4), M['ribbon'], joint, fm)
            self.add(name + 'knot', ellipsoid(0.03 * b, 0.028 * b, 0.026 * b, 14, 10, center=(0, 0, top + 0.012)), M['ribbon'], joint, fm)

    # --- tail ---------------------------------------------------------------------------------------
    TAIL = [(-0.04, 0.42, -0.14), (-0.14, 0.7, -0.2), (-0.32, 0.88, -0.18), (-0.5, 0.9, -0.06), (-0.58, 0.82, 0.1), (-0.55, 0.7, 0.22)]

    def tail(self):
        pts = curve(self.TAIL, 40)
        prof = [(0.0, 0.08), (0.15, 0.13), (0.4, 0.175), (0.65, 0.185), (0.85, 0.16), (1.0, 0.12)]

        def rfn(t, a):
            on = sstep((t - 0.15) / 0.2)
            lobes = 0.55 * math.cos(5 * a + t * 11.0) + 0.3 * math.cos(3 * a - t * 13.0 + 1.3)
            return interp(prof, t) * (1.0 + on * 0.07 * lobes)

        v, f = tube(pts, rfn, 40)
        n = len(pts)
        sides = 40
        tip = []
        for i in range(n):
            t = i / (n - 1)
            tip += [sstep((t - 0.55) / 0.4)] * sides
        rest = len(v) - n * sides
        tip += [1.0] * (rest // 2) + [0.0] * (rest - rest // 2)
        mat = self.m.hair('pip_tail', self.C['fur'], '#c89464', 0.62)
        self.add('tail', (v, f), mat, 'hips', tip=tip)

    # --- props --------------------------------------------------------------------------------------
    def held_gift(self):
        g = self.pose['extra']['gift']
        self.gift_box('gift', 'chest', T(*g['pos']) @ R(*g.get('rot', (0, 0, 0))), g.get('size', (0.22, 0.17, 0.16)), True, 1.5)

    def held_coin(self):
        c = self.pose['extra']['coin']
        M = self.mat
        wm = self.J(c.get('joint', 'wristL'))
        p = wm @ Vector(c.get('offset', (0.0, 0.03, -0.2)))
        cm = T(*p) @ R(0, 0, c.get('turn', -10.0)) @ R(c.get('tilt', 8.0), c.get('roll', -12.0), 0)
        cm = cm @ S(1.25)
        self.add('coin', disc(0.105, 0.03, 44), M['coin'], None, cm)
        for sgn in (-1, 1):
            self.add('coinrim', torus(0.094, 0.012, 44, 8), M['coin'], None, cm @ T(0, 0.014 * sgn, 0) @ R(90, 0, 0))
        # an embossed S with a bar through it
        up, lo = [], []
        for i in range(13):
            a = rad(35 + (270 - 35) * i / 12)
            up.append(Vector((0.026 * math.cos(a), -0.02, 0.024 + 0.024 * math.sin(a))))
            a = rad(90 - (90 + 145) * i / 12)
            lo.append(Vector((0.026 * math.cos(a), -0.02, -0.024 + 0.024 * math.sin(a))))
        self.add('coin_s', sweep(up + lo[1:], 0.0085, 6), M['coin'], None, cm)
        self.add('coin_bar', sweep([Vector((0, -0.02, 0.066)), Vector((0, -0.02, -0.066))], 0.007, 6), M['coin'], None, cm)
        # two little sparkles
        for k, (dx, dz, r) in enumerate(((0.16, 0.12, 0.07), (-0.08, 0.15, 0.042))):
            sp = T(*(p + Vector((dx, -0.1, dz))))
            self.add(f'sparkle{k}', star(r, r * 0.22, 0.02, 4), M['sparkle'], None, sp)


# ------------------------------------------------------------------------------------------
def mouth_slab(w: float, h: float, up: float, n: int = 14, depth: float = 0.02):
    """An open mouth modelled facing -Y below the frame origin: the upper lip a gentle curve with its
    corners raised by `up`, the lower lip a deep round curve; `w` is the half width, `h` the depth."""
    top, bot = [], []
    for i in range(n + 1):
        x = -w + 2 * w * i / n
        u = x / w
        top.append((x, up * u * u - 0.004 * (1 - u * u)))
        bot.append((x, up * u * u - h * (1 - u * u) ** 1.3))
    outline = top + list(reversed(bot[1:-1]))
    m = len(outline)
    verts, faces = [], []
    for y in (-depth * 0.5, depth * 0.5):
        for (x, z) in outline:
            verts.append((x, y, z))
    cy = [(0.0, -depth * 0.5, (top[n // 2][1] + bot[n // 2][1]) * 0.5), (0.0, depth * 0.5, (top[n // 2][1] + bot[n // 2][1]) * 0.5)]
    verts.extend(cy)
    c0, c1 = 2 * m, 2 * m + 1
    for k in range(m):
        k2 = (k + 1) % m
        faces.append((k, c0, k2))
        faces.append((m + k, m + k2, c1))
        faces.append((k, k2, m + k2, m + k))
    return verts, faces


def paw(side: int, kind: str, s: float = 1.0):
    """A chubby paw in the wrist frame (-Z runs out along the forearm, +Y is the palm side, the thumb
    on the +X*side edge). kind: 'fist', 'open', 'point', 'hold' (a loose cupped grip), 'flat'."""
    parts = [('palm', ellipsoid(0.09 * s, 0.072 * s, 0.084 * s, 20, 14, center=(0.0, 0.0, -0.08 * s)))]
    if kind in ('fist', 'hold'):
        curl = 1.0 if kind == 'fist' else 0.55
        for k in range(4):
            x = (k - 1.5) * 0.043 * s
            parts.append((f'f{k}', ellipsoid(0.027 * s, 0.034 * s, 0.03 * s, 12, 8,
                                            center=(x, (0.012 + 0.02 * curl) * s, -(0.15 + 0.012 * (1 - curl)) * s))))
        parts.append(('thumb', ellipsoid(0.03 * s, 0.03 * s, 0.044 * s, 12, 8, center=(0.07 * s * side, 0.024 * s, -0.1 * s))))
    elif kind in ('open', 'flat'):
        spread = 1.0 if kind == 'open' else 0.4
        for k in range(4):
            x = (k - 1.5) * 0.042 * s
            ln = (0.046, 0.056, 0.054, 0.044)[k] * s
            a = Vector((x * 1.02, 0.004 * s, -0.135 * s))
            b = a + Vector((x * 0.5 * spread, 0.0, -ln))
            parts.append((f'f{k}', capsule(a, b, 0.023 * s, 10)))
        tv, tf = capsule((0.0, 0.0, 0.0), (0.0, 0.0, -0.05 * s), 0.025 * s, 10)
        m = T(0.074 * s * side, 0.0, -0.075 * s) @ R(0, -42 * side * spread - 10 * side, 0)
        parts.append(('thumb', ([tuple(m @ Vector(v)) for v in tv], tf)))
    elif kind == 'point':
        # the index finger (on the thumb's side) pointing, the others curled, the thumb up along it
        a = Vector((0.04 * side * s, 0.0, -0.13 * s))
        parts.append(('index', capsule(a, a + Vector((0.004 * side * s, 0.0, -0.1 * s)), 0.024 * s, 12)))
        for k in range(3):
            x = (0.6 - k) * 0.043 * s * side - 0.02 * side * s
            parts.append((f'f{k}', ellipsoid(0.027 * s, 0.034 * s, 0.03 * s, 12, 8, center=(x, 0.03 * s, -0.148 * s))))
        tv, tf = capsule((0.0, 0.0, 0.0), (0.0, 0.0, -0.05 * s), 0.025 * s, 10)
        m = T(0.075 * s * side, -0.02 * s, -0.08 * s) @ R(0, -25 * side, 0)
        parts.append(('thumb', ([tuple(m @ Vector(v)) for v in tv], tf)))
    return parts


# ------------------------------------------------------------------------------------------
# Posing: arms solved from wrist targets in the chest frame
def wrist_at(side: int, r_: float, s_: float, twist: float, el: float):
    sh = Vector((Pipper.shoulder[0] * side, Pipper.shoulder[1], Pipper.shoulder[2]))
    m = T(*sh) @ arm_rot(side, r_, s_, twist) @ T(0, 0, -Pipper.upper_arm) @ bend(el) @ T(0, 0, -Pipper.forearm)
    return m.to_translation()


def elbow_at(side: int, r_: float, s_: float, twist: float):
    sh = Vector((Pipper.shoulder[0] * side, Pipper.shoulder[1], Pipper.shoulder[2]))
    return (T(*sh) @ arm_rot(side, r_, s_, twist) @ T(0, 0, -Pipper.upper_arm)).to_translation()


def refine(side, tgt, twist, sol, elbow, step=6.0):
    r_, s_, e = sol
    d = (wrist_at(side, r_, s_, twist, e) - tgt).length
    while step > 0.05:
        moved = False
        for dr, ds, de in ((step, 0, 0), (-step, 0, 0), (0, step, 0), (0, -step, 0), (0, 0, step), (0, 0, -step)):
            e2 = min(elbow[1], max(elbow[0], e + de))
            d2 = (wrist_at(side, r_ + dr, s_ + ds, twist, e2) - tgt).length
            if d2 < d - 1e-7:
                d, r_, s_, e = d2, r_ + dr, s_ + ds, e2
                moved = True
        if not moved:
            step *= 0.5
    return (r_, s_, e), d


def reach(side: int, target, twist: float = 0.0, elbow=(0.0, 150.0), hint=None):
    """(raise, swing, twist, elbow) bringing the wrist to `target` (chest frame). With `hint` (an
    elbow position), the twist is chosen too: the solution whose elbow lies nearest the hint."""
    tgt = Vector(target)
    best = None
    for r_ in range(0, 181, 12):
        for s_ in range(-90, 181, 12):
            for e in range(int(elbow[0]), int(elbow[1]) + 1, 12):
                d = (wrist_at(side, r_, s_, twist, e) - tgt).length
                if best is None or d < best[0]:
                    best = (d, float(r_), float(s_), float(e))
    sol, d = refine(side, tgt, twist, best[1:], elbow)
    if hint is not None:
        # follow the solution round as the twist changes (warm start), keep the elbow nearest the hint
        hv = Vector(hint)
        cands = []
        for direction_ in (1, -1):
            cur = sol
            for k in range(0, 13):
                tw = twist + direction_ * 10.0 * k
                cur, d = refine(side, tgt, tw, cur, elbow, 3.0)
                cands.append(((elbow_at(side, cur[0], cur[1], tw) - hv).length + 20.0 * d, tw, cur))
        _score, twist, sol = min(cands, key=lambda c: c[0])
    return (round(sol[0], 2), round(sol[1], 2), twist, round(sol[2], 2))


def arms(left, right, twist_l=0.0, twist_r=0.0, hint_l=None, hint_r=None, **kw):
    return dict(armL=reach(1, left, twist_l, hint=hint_l, **kw), armR=reach(-1, right, twist_r, hint=hint_r, **kw))


YAW = 22.0
LEGS = (0, 13, 0, 4)

POSES = {
    # paws resting on his tummy, a friendly smile
    'idle': pose(
        root=dict(yaw=YAW), chest=(2, 0, 0), head=(-2, 0, 2), legL=LEGS, legR=LEGS,
        **arms((0.5, -0.24, 0.0), (-0.4, -0.4, 0.02), hint_l=(0.6, 0.0, -0.1), hint_r=(-0.58, -0.08, -0.1)),
        wristL=(25, 0, 0), wristR=(30, 0, 0), handL='fist', handR='fist',
        face=face('open', 'smile'),
    ),
    # right paw raised high in a wave, the other on his tummy, open grin
    'wave': pose(
        root=dict(yaw=YAW + 4, lean=-2.0), chest=(-3, 0, -4), head=(-4, 5, 4), legL=LEGS, legR=LEGS,
        **arms((0.42, -0.4, 0.0), (-0.72, -0.12, 0.56), hint_l=(0.6, -0.05, -0.1), hint_r=(-0.66, -0.14, 0.14)),
        wristL=(30, 0, 0), wristR=(-10, 0, 0), handL='fist', handR='open',
        face=face('open', 'grin', 'up'),
    ),
    # holding out a big gift box, laughing with his eyes shut
    'gift': pose(
        root=dict(yaw=YAW - 2), chest=(-2, 0, 6), head=(-4, 4, 4), legL=LEGS, legR=LEGS,
        **arms((0.56, -0.5, -0.16), (-0.12, -0.52, 0.06), hint_l=(0.62, -0.12, -0.12), hint_r=(-0.5, -0.36, -0.06)),
        wristL=(20, 0, 0), wristR=(0, 0, 0), handL='open', handR='open',
        face=face('happy', 'laugh'),
        extra=dict(gift=dict(pos=(0.26, -0.64, 0.0), rot=(0, 0, -18), size=(0.28, 0.2, 0.24))),
    ),
    # pointing off to screen right, the other paw on his chest
    'point': pose(
        root=dict(yaw=YAW - 4), chest=(-2, 0, 4), head=(-3, 4, 6), legL=LEGS, legR=LEGS,
        **arms((0.84, -0.26, 0.26), (-0.18, -0.5, 0.0), hint_l=(0.66, -0.14, 0.0), hint_r=(-0.52, -0.3, -0.12)),
        wristL=(0, 0, 0), wristR=(20, 0, 0), handL='point', handR='fist',
        face=face('open', 'grin'),
    ),
    # showing off a shiny gold coin
    'coin': pose(
        root=dict(yaw=YAW - 2), chest=(-3, 0, 4), head=(-4, 6, 8), legL=LEGS, legR=LEGS,
        **arms((0.64, -0.34, 0.5), (-0.18, -0.5, 0.0), hint_l=(0.64, -0.1, 0.08), hint_r=(-0.52, -0.3, -0.12)),
        wristL=(-30, 0, 0), wristR=(20, 0, 0), handL='hold', handR='fist',
        face=face('open', 'grin', 'up', (0.2, 0.2)),
        extra=dict(coin=dict(joint='wristL', offset=(0.0, 0.06, -0.26))),
    ),
    # paws clasped under his chin, laughing
    'happy': pose(
        root=dict(yaw=8.0), chest=(-4, 0, 0), head=(-6, 5, 0),
        legL=(8, 13, 0, 18), legR=(8, 13, 0, 18),
        **arms((0.1, -0.4, 0.12), (-0.1, -0.4, 0.12), hint_l=(0.44, -0.2, -0.16), hint_r=(-0.44, -0.2, -0.16)),
        wristL=(-60, 0, 0), wristR=(-60, 0, 0), handL='fist', handR='fist',
        face=face('happy', 'laugh'),
    ),
}

MODEL = Pipper
