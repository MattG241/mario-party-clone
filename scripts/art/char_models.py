"""The four heroes as stylised 3D models (see characters.py for rendering and packing).

Each hero is a Hero subclass: a skeleton (proportions), materials, and a `build(world, pose)` that
returns the parts for one pose. Rigid parts are placed with their joint's matrix (so object-space
textures stick to them); arms and legs are smooth tubes rebuilt through the posed joints.
"""
from __future__ import annotations

import math
import random

import bpy
from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import (I4, HeadShape, R, S, Skeleton, T, apply, arc_points, cloth_strip, curve3, disc, ellipsoid, flat_sweep, open_sweep,
                      polyline_segment,
                      rad, ribbon, star, superellipsoid, sweep, torus)


# ------------------------------------------------------------------------------------------
# Materials
class Mats:
    """Creates materials on demand and caches them by name."""

    def __init__(self):
        self.cache: dict[str, bpy.types.Material] = {}

    def get(self, name: str, make):
        if name not in self.cache:
            self.cache[name] = make(name)
        return self.cache[name]

    # skin with a little subsurface glow and a soft sheen
    def skin(self, name: str, color: str):
        def make(n):
            m = lib.NT(n)
            m.bsdf(col(color), 0.5, subsurface=0.12, sheen=0.25, spec=0.35)
            return m.mat
        return self.get(name, make)

    def cloth(self, name: str, color: str, rough: float = 0.72, sheen: float = 0.35, bump: float = 0.0, scale: float = 60.0):
        def make(n):
            m = lib.NT(n)
            nrm = None
            if bump:
                tc = m.node('ShaderNodeTexCoord')
                nz = m.noise(scale, 3, 0.6, tc.outputs['Object'])
                nrm = m.bump(nz.outputs['Fac'], bump, 0.02)
            m.bsdf(col(color), rough, normal=nrm, sheen=sheen, spec=0.3)
            return m.mat
        return self.get(name, make)

    def glossy(self, name: str, color: str, rough: float = 0.3, coat: float = 0.5):
        def make(n):
            m = lib.NT(n)
            m.bsdf(col(color), rough, coat=coat, spec=0.5)
            return m.mat
        return self.get(name, make)

    def metal(self, name: str, color: str, rough: float = 0.3):
        def make(n):
            m = lib.NT(n)
            b = m.bsdf(col(color), rough, spec=0.6)
            b.inputs['Metallic'].default_value = 0.85
            return m.mat
        return self.get(name, make)

    def emit(self, name: str, color: str, strength: float = 2.0):
        def make(n):
            m = lib.NT(n)
            m.bsdf(col(color), 0.4, emission=col(color), emission_strength=strength)
            return m.mat
        return self.get(name, make)

    def hair(self, name: str, dark: str, light: str, rough: float = 0.42):
        """Hair / leaves: darker at the roots (vertex attribute 't' = 0) to lighter tips."""
        def make(n):
            m = lib.NT(n)
            t = m.node('ShaderNodeAttribute')
            t.attribute_name = 'tip'
            c = m.mix(t.outputs['Fac'], col(dark), col(light))
            m.bsdf(c, rough, coat=0.25, sheen=0.2, spec=0.4)
            return m.mat
        return self.get(name, make)

    def banded(self, name: str, a: str, b: str, bands: float = 3.0, rough: float = 0.62, sheen: float = 0.6):
        """Fur with soft bands along the vertex attribute 'tip' (the squirrel's tail)."""
        def make(n):
            m = lib.NT(n)
            t = m.node('ShaderNodeAttribute')
            t.attribute_name = 'tip'
            wave = m.math('SINE', m.math('MULTIPLY', t.outputs['Fac'], bands * math.tau))
            f = m.maprange(wave, -0.2, 0.35)
            c = m.mix(f, col(a), col(b))
            m.bsdf(c, rough, sheen=sheen, spec=0.3)
            return m.mat
        return self.get(name, make)

    def fur(self, name: str, color: str, rough: float = 0.62):
        def make(n):
            m = lib.NT(n)
            tc = m.node('ShaderNodeTexCoord')
            nz = m.noise(38.0, 4, 0.7, tc.outputs['Object'])
            nrm = m.bump(nz.outputs['Fac'], 0.12, 0.02)
            m.bsdf(col(color), rough, normal=nrm, sheen=0.7, spec=0.3)
            return m.mat
        return self.get(name, make)

    def stone(self, name: str):
        """Warm grey stone with softly glowing cyan cracks and moss on upward faces."""
        def make(n):
            m = lib.NT(n)
            tc = m.node('ShaderNodeTexCoord')
            obj = tc.outputs['Object']
            nz = m.noise(4.5, 5, 0.6, obj)
            base = m.ramp(nz.outputs['Fac'], [(0.3, '#7f786f'), (0.5, '#9b9489'), (0.7, '#b1aa9e')])
            vor = m.node('ShaderNodeTexVoronoi')
            vor.feature = 'DISTANCE_TO_EDGE'
            vor.inputs['Scale'].default_value = 3.2
            m.link(obj, vor.inputs['Vector'])
            crack = m.maprange(vor.outputs['Distance'], 0.035, 0.012)
            mask = m.maprange(m.noise(1.6, 2, 0.5, obj).outputs['Fac'], 0.46, 0.56)
            crack = m.math('MULTIPLY', crack, mask)
            nrm_z = m.sep(m.normal())[2]
            moss_n = m.noise(7.0, 4, 0.6, obj).outputs['Fac']
            moss = m.math('MULTIPLY', m.maprange(nrm_z, 0.55, 0.85), m.maprange(moss_n, 0.45, 0.6))
            c = m.mix(moss, base, m.ramp(moss_n, [(0.4, '#4f8a2e'), (0.7, '#8cc04a')]))
            c = m.mix(crack, c, col('#7ff0ff'))
            bump = m.bump(m.math('ADD', nz.outputs['Fac'], m.math('MULTIPLY', crack, -0.6)), 0.35, 0.05)
            m.bsdf(c, 0.78, normal=bump, emission=col('#3fd8f0'), emission_strength=0.0)
            # glow only in the cracks
            b = [nd for nd in m.nt.nodes if nd.type == 'BSDF_PRINCIPLED'][0]
            m.link(m.math('MULTIPLY', crack, 3.0), b.inputs['Emission Strength'])
            return m.mat
        return self.get(name, make)

    def alpha(self, name: str, color: str, a: float):
        def make(n):
            m = lib.NT(n)
            m.bsdf(col(color), 0.6, alpha=a)
            return m.mat
        return self.get(name, make)


# ------------------------------------------------------------------------------------------
# Parts
class Part:
    __slots__ = ('name', 'verts', 'faces', 'mat', 'matrix', 'smooth', 'tip')

    def __init__(self, name, verts, faces, mat, matrix=None, smooth=True, tip=None):
        self.name = name
        self.verts = verts
        self.faces = faces
        self.mat = mat
        self.matrix = matrix if matrix is not None else I4
        self.smooth = smooth
        self.tip = tip  # optional per-vertex float attribute


def instantiate(parts):
    """Create Blender objects for a list of parts; returns them (for deletion later)."""
    obs = []
    for p in parts:
        if not p.verts:
            continue
        ob = lib.mesh_object(p.name, p.verts, p.faces, smooth=p.smooth, material=p.mat)
        ob.matrix_world = p.matrix
        if p.tip is not None:
            me = ob.data
            attr = me.attributes.new(name='tip', type='FLOAT', domain='POINT')
            attr.data.foreach_set('value', p.tip)
        obs.append(ob)
    return obs


# ------------------------------------------------------------------------------------------
# Base hero
DEFAULT_FACE = dict(eyes='open', mouth='smile', brows='neutral', look=(0.0, 0.0))


class Hero:
    """Shared humanoid structure; subclasses set proportions and dress the model."""

    key = 'hero'
    ankle_h = 0.15  # ankle height above the sole in a flat-footed stance
    # skeleton proportions (subclasses override)
    hip_h = 0.6
    spine = 0.08
    chest = 0.22
    neck = 0.18
    head_up = 0.06
    shoulder = (0.2, 0.0, 0.1)
    upper_arm = 0.2
    forearm = 0.18
    hip_w = 0.1
    thigh = 0.21
    shin = 0.2

    def __init__(self, mats: Mats):
        self.m = mats
        self.skel = Skeleton([
            ('hips', None, (0.0, 0.0, self.hip_h)),
            ('spine', 'hips', (0.0, 0.0, self.spine)),
            ('chest', 'spine', (0.0, 0.0, self.chest)),
            ('neck', 'chest', (0.0, 0.0, self.neck)),
            ('head', 'neck', (0.0, 0.0, self.head_up)),
            ('shoulderL', 'chest', self.shoulder),
            ('elbowL', 'shoulderL', (0.0, 0.0, -self.upper_arm)),
            ('wristL', 'elbowL', (0.0, 0.0, -self.forearm)),
            ('shoulderR', 'chest', (-self.shoulder[0], self.shoulder[1], self.shoulder[2])),
            ('elbowR', 'shoulderR', (0.0, 0.0, -self.upper_arm)),
            ('wristR', 'elbowR', (0.0, 0.0, -self.forearm)),
            ('hipL', 'hips', (self.hip_w, 0.0, -0.04)),
            ('kneeL', 'hipL', (0.0, 0.0, -self.thigh)),
            ('ankleL', 'kneeL', (0.0, 0.0, -self.shin)),
            ('hipR', 'hips', (-self.hip_w, 0.0, -0.04)),
            ('kneeR', 'hipR', (0.0, 0.0, -self.thigh)),
            ('ankleR', 'kneeR', (0.0, 0.0, -self.shin)),
        ] + self.extra_joints())
        self.parts: list[Part] = []
        self.w: dict = {}
        self.pose: dict = {}

    def extra_joints(self):
        return []

    # --- helpers ------------------------------------------------------------------------------
    def J(self, name: str) -> Matrix:
        return self.w[name]

    def P(self, name: str) -> Vector:
        return self.w[name].to_translation()

    def add(self, name, mesh, mat, joint=None, local=I4, smooth=True, tip=None):
        verts, faces = mesh
        m = (self.w[joint] @ local) if joint else local
        self.parts.append(Part(name, verts, faces, mat, m, smooth, tip))

    def feat(self, name, mesh, mat, joint, head: HeadShape, fr: Matrix):
        """Add a facial feature modelled in the feature frame `fr`, wrapped onto the head surface."""
        verts, faces = mesh
        n0 = -fr.col[1].to_3d().normalized()
        pos = fr.to_translation()
        # the tangent plane through the surface point under the feature's centre
        sp, sn = head.surface(pos - head.c)
        p0 = sp
        vj = [fr @ Vector(v) for v in verts]
        self.add(name, (head.conform(vj, p0, sn), faces), mat, joint)
        del n0

    def limb(self, name, a, b, c, radius, mat, t0=0.0, t1=1.0, sides=14, n=14, extend=0.0, cap0=True, cap1=True, squash=1.0):
        """A smooth tube following the posed joints a -> b -> c, between fractions t0..t1."""
        pa, pb, pc = self.P(a), self.P(b), self.P(c)
        if extend:
            pc = pc + (pc - pb).normalized() * extend
        pts = curve3(pa, pb, pc, 24)
        seg = polyline_segment(pts, t0, t1, n)
        self.add(name, sweep(seg, radius, sides, cap0=cap0, cap1=cap1, squash=squash), mat)
        return seg

    def along(self, a, b, c, t: float) -> Vector:
        pts = curve3(self.P(a), self.P(b), self.P(c), 24)
        return polyline_segment(pts, t, t, 1)[0]

    def limb_frame(self, joint_a, joint_b, joint_c, t: float, up_joint: str) -> Matrix:
        """A frame at fraction t along a limb: -Z along the limb, oriented like `up_joint`."""
        pts = curve3(self.P(joint_a), self.P(joint_b), self.P(joint_c), 24)
        seg = polyline_segment(pts, max(0.0, t - 0.02), min(1.0, t + 0.02), 2)
        d = (seg[-1] - seg[0]).normalized()
        base = self.w[up_joint].to_3x3()
        yv = base.col[1]
        zl = -d
        xl = yv.cross(zl).normalized()
        yl = zl.cross(xl).normalized()
        m = Matrix((xl, yl, zl)).transposed().to_4x4()
        m.translation = seg[1]
        return m

    # --- building -----------------------------------------------------------------------------
    sit_h = 0.16  # hip joint height when sitting on the ground

    def build(self, world: dict, pose: dict) -> list[Part]:
        self.parts = []
        self.w = world
        self.pose = pose
        self.dress()
        ex = pose.get('extra', {})
        if ex.get('stars') is not None:
            top = self.w['head'] @ Vector((0.0, 0.0, self.head_top() + 0.1))
            self.dizzy_stars(top, 0.3, ex['stars'])
        if ex.get('chip'):
            w = self.J('wristL')
            self.held_chip_at(w @ Vector((0.0, -0.02, -0.2)))
        return self.parts

    def head_top(self) -> float:
        return 0.85

    def held_chip_at(self, p: Vector):
        gold = self.m.metal('chip_gold', '#f2b632', 0.28)
        teal = self.m.glossy('chip_teal', '#1fa5a0', 0.3, 0.6)
        base = T(*p) @ R(10, 0, -12)
        self.add('chip', disc(0.13, 0.04, 28), gold, None, base)
        self.add('chip_face', disc(0.085, 0.046, 24), teal, None, base @ T(0, -0.002, 0))

    def dress(self):
        raise NotImplementedError

    # --- face -----------------------------------------------------------------------------------
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
                    ir = 0.86 * ew * (0.8 if kind == 'wide' else 1.0)
                    off = Vector((lx * ew * 0.22 - 0.1 * ew * side, -ed * 0.9, lz * eh * 0.2 - eh * 0.04))
                    self.feat(f'iris{name}', ellipsoid(ir, ed * 0.22, ir * 1.1, 20, 10, center=off), irm, joint, head, fr)
                    pr = ir * 0.58
                    self.feat(f'pupil{name}', ellipsoid(pr, ed * 0.2, pr * 1.12, 16, 8, center=off + Vector((0.0, -ed * 0.12, 0.0))), dark, joint, head, fr)
                    h1 = off + Vector((-ir * 0.38, -ed * 0.3, ir * 0.42))
                    self.feat(f'shine{name}', ellipsoid(ir * 0.34, 0.004, ir * 0.36, 10, 6, center=h1), shine, joint, head, fr)
                    h2 = off + Vector((ir * 0.4, -ed * 0.3, -ir * 0.4))
                    self.feat(f'shine2{name}', ellipsoid(ir * 0.13, 0.004, ir * 0.13, 8, 5, center=h2), shine, joint, head, fr)
                # upper lash line (a slim dark arc hugging the top of the eye)
                lash_pts = [Vector((math.sin(a) * ew * 1.02, -ed * 0.55, math.cos(a) * eh * 1.0)) for a in [(-1 + 2 * i / 12) * 1.25 for i in range(13)]]
                self.feat(f'lash{name}', sweep(lash_pts, lambda t: 0.006 + 0.006 * math.sin(math.pi * t), 6), lash, joint, head, fr)
                # eyelid for sleepy / sad / determined looks
                lid = {'sad': 0.42, 'determined': 0.36, 'half': 0.5}.get(kind)
                if lid and lid_col:
                    lidm = mt.skin(f'lid_{lid_col}', lid_col)
                    tilt = {'sad': -16 * side, 'determined': 14 * side}.get(kind, 0)
                    lid_mesh = ellipsoid(ew * 1.12, ed * 1.25, eh * 1.1, 20, 10, zmin=1 - lid * 2)
                    self.feat(f'lid{name}', lid_mesh, lidm, joint, head, fr @ R(0, tilt, 0) @ T(0, -0.004, 0))
            elif kind == 'happy':
                pts = arc_points(ew * 1.7, -eh * 0.42, 12, y=-0.01)
                self.feat(f'happy{name}', sweep([p + Vector((0, 0, -eh * 0.15)) for p in pts], 0.0125, 8), lash, joint, head, fr)
            elif kind == 'closed':
                pts = arc_points(ew * 1.6, eh * 0.22, 12, y=-0.01)
                self.feat(f'closed{name}', sweep(pts, 0.0115, 8), lash, joint, head, fr)
            # brows
            b_pitch = eye_pitch + brow_pitch + (4 if brows == 'up' else 0) + (2 if eyes == 'wide' else 0)
            roll = {'neutral': 0, 'up': -4, 'worried': 16, 'angry': -18, 'determined': -12, 'sad': 14}.get(brows, 0) * side
            bf = head.frame(yaw * 1.02, b_pitch, 0.004, roll)
            bpts = arc_points(ew * 1.5, -0.012, 8)
            self.feat(f'brow{name}', sweep(bpts, lambda t: 0.012 + 0.006 * math.sin(math.pi * t), 8), browm, joint, head, bf)
        # nose
        skin_m = mt.skin(f'skin_{skin}', skin) if skin else None
        if nose and skin_m:
            nf = head.frame(0, eye_pitch - 13, -0.004)
            self.feat('nose', ellipsoid(0.03, 0.026, 0.024, 14, 8), skin_m, joint, head, nf)
        if blush:
            bl = mt.alpha('blush', '#ff8a8a', 0.35)
            for side in (1, -1):
                bf = head.frame(side * (eye_yaw + 13), eye_pitch - 16, 0.003)
                self.feat('blush', ellipsoid(0.048, 0.004, 0.028, 14, 6), bl, joint, head, bf)
        # mouth
        mf = head.frame(0, mouth_pitch, 0.0)
        w = 0.12 * mouth_w
        if mouth == 'smile':
            self.feat('mouth', sweep(arc_points(w, 0.03, 12, y=-0.006), lambda t: 0.009 + 0.004 * math.sin(math.pi * t), 8), mouth_m, joint, head, mf)
        elif mouth in ('grin', 'open', 'laugh'):
            hh = {'grin': 0.045, 'open': 0.06, 'laugh': 0.075}[mouth]
            ww = w * (1.0 if mouth == 'grin' else 0.95)
            self.feat('mouth', ellipsoid(ww / 2, 0.02, hh, 22, 12, zmax=0.15), mouth_m, joint, head, mf @ T(0, 0.002, 0.006))
            self.feat('tongue', ellipsoid(ww * 0.3, 0.012, hh * 0.45, 14, 8, center=(0, -0.008, -hh * 0.6)), tongue, joint, head, mf)
            if mouth != 'laugh':
                self.feat('teeth', ellipsoid(ww * 0.42, 0.01, 0.012, 14, 6, center=(0, -0.012, 0.0)), teeth, joint, head, mf)
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

    # --- extras shared by heroes ------------------------------------------------------------------
    def dizzy_stars(self, center: Vector, radius: float, phase: float):
        gold = self.m.emit('star_gold', '#ffd24a', 1.2)
        for k in range(3):
            a = phase + k / 3 * math.tau
            p = center + Vector((math.cos(a) * radius, math.sin(a) * radius * 0.45, 0.04 * math.sin(a * 2)))
            self.add(f'star{k}', star(0.075, 0.034, 0.03), gold, None, T(*p) @ R(0, 18 * math.sin(a), 0))

    def held_chip(self, joint: str, offset=(0.0, -0.06, -0.1)):
        gold = self.m.metal('chip_gold', '#f2b632', 0.28)
        teal = self.m.glossy('chip_teal', '#1fa5a0', 0.3, 0.6)
        m = self.w[joint] @ T(*offset)
        loc = m.to_translation()
        base = T(*loc) @ R(8, 0, -10)
        self.add('chip', disc(0.11, 0.035, 28), gold, None, base)
        self.add('chip_face', disc(0.07, 0.04, 24), teal, None, base @ T(0, -0.004, 0))


# ------------------------------------------------------------------------------------------
def hand_mitten(side: int, kind: str, size: float = 1.0):
    """A mitten hand in the wrist frame (-Z runs along the forearm, -Y is the back of the hand)."""
    s = size
    parts = [('palm', ellipsoid(0.068 * s, 0.056 * s, 0.072 * s, 18, 12, center=(0.0, 0.0, -0.068 * s)))]
    if kind == 'open':
        parts.append(('fingers', superellipsoid(0.066 * s, 0.032 * s, 0.056 * s, 2.4, 16, 10, center=(0.0, 0.008 * s, -0.128 * s))))
        tv, tf = ellipsoid(0.026 * s, 0.026 * s, 0.046 * s, 12, 8)
        m = T(0.066 * s * side, -0.012 * s, -0.08 * s) @ R(0, -38 * side, 0)
        parts.append(('thumb', (apply(m, tv), tf)))
    else:
        parts.append(('thumb', ellipsoid(0.028 * s, 0.028 * s, 0.038 * s, 12, 8, center=(0.05 * s * side, -0.034 * s, -0.058 * s))))
    return parts


def hair_tuft(base: Vector, direction: Vector, length: float, r0: float, bend: Vector = None, n: int = 8):
    """A tapered, gently curved tuft (hair spike / leaf-like lock). Returns (verts, faces, tip)."""
    bend = bend if bend is not None else Vector((0.0, 0.0, 0.0))
    d = direction.normalized()
    pts = []
    for i in range(n + 1):
        t = i / n
        pts.append(base + d * (length * t) + bend * (length * t * t))
    verts, faces = sweep(pts, lambda t: r0 * (1 - t) ** 0.85 + 0.004, 10, cap0=True, cap1=True)
    # tip attribute: 0 at the root, 1 at the point (for the root-to-tip colour ramp)
    tip = []
    rings = n + 1
    sides = 10
    body = rings * sides
    for i in range(rings):
        tip += [i / n] * sides
    extra = len(verts) - body
    # caps: the end cap belongs to the tip, the start cap to the root
    cap_len = extra // 2
    tip += [1.0] * cap_len + [0.0] * (extra - cap_len)
    return verts, faces, tip


def torso_surface(p: Vector, rx: float, ry: float, lift: float = 0.0) -> Vector:
    """Push a point out onto an elliptical torso cross-section (in the torso's frame)."""
    d = Vector((p.x, p.y))
    if d.length < 1e-6:
        d = Vector((0.0, -1.0))
    a = math.atan2(d.y, d.x)
    return Vector((math.cos(a) * (rx + lift), math.sin(a) * (ry + lift), p.z))


# ------------------------------------------------------------------------------------------
class Kip(Hero):
    """Kip Quill: trail-mapper kid — messy brown hair, teal scarf, yellow jacket, satchel."""

    key = 'kip'
    ankle_h = 0.15
    hip_h = 0.64
    spine = 0.08
    chest = 0.19
    neck = 0.14
    head_up = 0.04
    shoulder = (0.22, 0.0, 0.11)
    upper_arm = 0.215
    forearm = 0.19
    hip_w = 0.11
    thigh = 0.22
    shin = 0.23

    C = dict(skin='#f4bc8f', hair_d='#2e170a', hair_l='#74432a', jacket='#f5b830', jacket_d='#d9951a', shirt='#fff5e4',
             shorts='#2f3c62', cuff='#44547f', glove='#e4493f', glove_d='#b8352c', scarf='#16a4a8', scarf_d='#0f7f84',
             bag='#80502c', flap='#9a6136', emblem='#27bdb6', strap='#6e4123', boot='#8e5832', sole='#f2e0be', sock='#fff4e2')

    HEAD = (0.4, 0.375, 0.39, 0.41)  # rx, ry, rz, centre height above the head joint
    sit_h = 0.17

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.1

    def dress(self):
        c, mt = self.C, self.m
        skin = mt.skin('kip_skin', c['skin'])
        jacket = mt.cloth('kip_jacket', c['jacket'], 0.7, 0.35, 0.08)
        jacket_d = mt.cloth('kip_jacket_d', c['jacket_d'], 0.7, 0.3)
        shirt = mt.cloth('kip_shirt', c['shirt'], 0.75, 0.3)
        shorts = mt.cloth('kip_shorts', c['shorts'], 0.78, 0.35, 0.1)
        cuff = mt.cloth('kip_cuff', c['cuff'], 0.78, 0.3)
        glove = mt.cloth('kip_glove', c['glove'], 0.55, 0.3)
        glove_d = mt.cloth('kip_glove_d', c['glove_d'], 0.55, 0.3)
        scarf = mt.cloth('kip_scarf', c['scarf'], 0.72, 0.5, 0.1)
        scarf_d = mt.cloth('kip_scarf_d', c['scarf_d'], 0.72, 0.5)
        bag = mt.cloth('kip_bag', c['bag'], 0.55, 0.2, 0.15, 25)
        flap = mt.cloth('kip_flap', c['flap'], 0.55, 0.2)
        emblem = mt.glossy('kip_emblem', c['emblem'], 0.3, 0.6)
        brass = mt.metal('brass', '#e0a93f', 0.3)
        strap = mt.cloth('kip_strap', c['strap'], 0.6, 0.2)
        boot = mt.cloth('kip_boot', c['boot'], 0.5, 0.2, 0.1, 30)
        sole = mt.cloth('kip_sole', c['sole'], 0.6, 0.1)
        sock = mt.cloth('kip_sock', c['sock'], 0.8, 0.3)
        hair = mt.hair('kip_hair', c['hair_d'], c['hair_l'], 0.38)
        ex = self.pose.get('extra', {})

        # --- torso: cream shirt under an open yellow jacket (chest frame); shorts (hips frame)
        RX, RY = 0.225, 0.18
        col_pts = [Vector((0, 0, -0.34 + 0.46 * i / 10)) for i in range(11)]
        prof = lambda t: 0.225 - 0.028 * t + 0.012 * math.sin(math.pi * t)  # noqa: E731
        self.add('shirt', sweep([Vector((0, 0, -0.36 + 0.48 * i / 10)) for i in range(11)], lambda t: prof(t) - 0.014, 24, cap0=False, squash=0.8), shirt, 'chest')
        self.add('jacket', open_sweep(col_pts[:-1], prof, -73, 253, 26, 0.8, 0.022), jacket, 'chest')
        self.add('shoulders', ellipsoid(0.205, 0.158, 0.085, 26, 12, center=(0, 0, 0.1), zmin=-0.2), jacket, 'chest')
        self.add('pelvis', superellipsoid(0.205, 0.168, 0.15, 2.4, 28, 16, center=(0, 0, -0.04)), shorts, 'hips')
        self.add('waist', torus(0.198, 0.022, 36, 8, center=(0, 0, 0.06)), cuff, 'hips', S(1.0, 0.82, 1.0))
        # satchel strap from the right shoulder to the left hip; the satchel rides on the left hip
        a, b = Vector((-0.15, -0.08, 0.14)), Vector((0.2, -0.05, -0.28))
        strap_pts = [torso_surface(a.lerp(b, i / 12), RX, RY, 0.016 + 0.01 * math.sin(math.pi * i / 12)) for i in range(13)]
        strap_pts[0].z += 0.03
        self.add('strap', sweep(strap_pts, 0.024, 8, squash=0.4), strap, 'chest')
        bag_m = T(0.215, -0.1, -0.32) @ R(0, 0, 28)
        self.add('bag', superellipsoid(0.12, 0.055, 0.1, 3.2, 22, 14), bag, 'chest', bag_m)
        self.add('flap', superellipsoid(0.124, 0.026, 0.06, 3.0, 20, 10, center=(0, -0.042, 0.04)), flap, 'chest', bag_m)
        self.add('emblem', disc(0.042, 0.012, 22), emblem, 'chest', bag_m @ T(0, -0.07, 0.025))
        self.add('emblem_dot', disc(0.018, 0.016, 14), brass, 'chest', bag_m @ T(0, -0.074, 0.025))
        self.add('buckle', superellipsoid(0.02, 0.01, 0.014, 3, 10, 6), brass, 'chest', bag_m @ T(0, -0.072, -0.025))

        # --- legs: baggy rolled shorts, short socks, chunky boots
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('shorts' + s_, hip, kn, an, lambda t: 0.116 + 0.012 * t, shorts, 0.0, 0.34, 16, 8, cap0=True, cap1=False)
            self.limb('cuff' + s_, hip, kn, an, 0.13, cuff, 0.3, 0.38, 16, 3, cap0=False, cap1=False)
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.076 - 0.012 * t + 0.008 * math.sin(math.pi * min(1.0, max(0.0, (t - 0.45) / 0.4))), skin, 0.32, 0.9, 12, 12)
            self.limb('sock' + s_, hip, kn, an, 0.076, sock, 0.78, 0.98, 12, 3, cap0=False, cap1=False)
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('boot' + s_, superellipsoid(0.122, 0.172, 0.108, 2.6, 22, 14, center=(0, -0.05, -0.045)), boot, None, fm)
            self.add('toe' + s_, ellipsoid(0.114, 0.098, 0.075, 18, 10, center=(0, -0.155, -0.08)), sole, None, fm)
            self.add('sole' + s_, superellipsoid(0.128, 0.196, 0.036, 3.0, 22, 8, center=(0, -0.06, -0.12)), sole, None, fm)
            self.add('bootcuff' + s_, torus(0.1, 0.03, 22, 8, center=(0, 0, 0.05)), boot, None, fm)
            for k in range(2):
                self.add(f'lace{k}{s_}', sweep([Vector((-0.045, -0.118, -0.005 - k * 0.038)), Vector((0.045, -0.118, -0.005 - k * 0.038))], 0.01, 6), sole, None, fm)

        # --- arms: short sleeves with rolled cuffs, big red gloves
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.09 - 0.008 * t, jacket, 0.0, 0.55, 14, 8, cap0=True, cap1=False)
            self.limb('scuff' + s_, sh, el, wr, 0.092, jacket_d, 0.5, 0.6, 14, 3, cap0=False, cap1=False)
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.056 - 0.006 * t, skin, 0.5, 1.0, 12, 10, extend=0.02)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.32):
                self.add('glove' + nm + s_, mesh, glove, None, wm)
            self.add('gcuff' + s_, torus(0.066, 0.022, 18, 8, center=(0, 0, -0.012)), glove_d, None, wm)

        # --- head
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        hv = [(x * (1 - 0.1 * max(0.0, (hc - z) / hz) ** 1.6), y - 0.02 * max(0.0, (hc - z) / hz) ** 2, z) for (x, y, z) in hv]
        self.add('head', (hv, hf), skin, 'head')
        for sd in (1, -1):
            self.add('ear', ellipsoid(0.062, 0.04, 0.082, 16, 10), skin, 'head', T((hx - 0.01) * sd, 0.03, hc - 0.05) @ R(0, 0, -14 * sd))
            self.add('earin', ellipsoid(0.034, 0.02, 0.048, 12, 8), mt.skin('kip_skin_d', '#e59d74'), 'head', T((hx - 0.004) * sd, 0.0, hc - 0.05) @ R(0, 0, -14 * sd))
        self.face(head, 'head', eye_yaw=23, eye_pitch=-6, eye_size=(0.092, 0.118), iris='#6a3a1a', brow_col='#3f2412', mouth_pitch=-30,
                  lid_col=c['skin'], skin=c['skin'], brow_pitch=21)
        self.kip_hair(hair)

        # --- scarf: a thick wrap, a knot at the front, and a broad tail that trails behind
        self.add('scarf', torus(0.165, 0.075, 36, 12, center=(0, 0.0, 0.17), squash=0.95), scarf, 'chest', R(-8, 0, 0))
        self.add('knot', ellipsoid(0.08, 0.055, 0.07, 16, 10, center=(0.07, -0.19, 0.11)), scarf_d, 'chest')
        front_end = [Vector((0.08, -0.21, 0.08)), Vector((0.1, -0.23, 0.0)), Vector((0.11, -0.22, -0.07))]
        self.add('scarfend', ribbon(front_end, lambda t: 0.1 - 0.02 * t, Vector((0.0, -1.0, 0.0)), 0.03), scarf_d, 'chest')
        fly = ex.get('scarf', 0.0)  # 0 hangs, 1 streams out behind
        wave = ex.get('wave', 0.0)
        pts = []
        for i in range(15):
            t = i / 14
            side = 0.08 + 0.4 * t * (1 - 0.45 * fly)
            down = 0.6 * t ** 1.2 * (1 - fly) + 0.12 * t * fly
            back = 0.17 + 0.08 * t + 0.55 * t * fly
            wob = math.sin(t * 4.5 + wave) * 0.045 * t
            pts.append(Vector((-0.1 - side, back, 0.13 - down + wob)))
        self.add('scarftail', cloth_strip(pts, lambda t: 0.17 + 0.13 * t, Vector((0.3, 1.0, 0.25)), 2.0, lambda t: 0.012 + 0.03 * t, 0.03, 10),
                 scarf, 'chest')

    def kip_hair(self, hair):
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))
        tips = [-58, -37, -17, 3, 23, 43, 60]

        def boundary(yaw):
            a = abs(yaw)
            if a <= 66:
                return zigzag(yaw, tips, 13.0, 34.0, 10.5)
            side = periodic_interp([(66, 30), (80, -6), (92, 12), (108, 8), (130, -24), (180, -42)], a)
            return side

        def thickness(yaw, pitch, f):
            ridge = 0.5 + 0.5 * math.cos(math.radians(yaw) * 18 + 0.3)
            edge = min(1.0, f / 0.22)
            crown = 0.03 + 0.05 * math.sin(math.pi * min(1.0, f * 1.1))
            return (0.012 + crown * edge + 0.022 * ridge * edge) * (1.12 if abs(yaw) > 100 else 1.0)

        v, f, tp = hair_shell(hs, boundary, thickness, 144, 24)
        self.add('hair', (v, f), hair, 'head', tip=tp)
        # a few loose locks curling up from the crown and flicking out at the sides
        verts, faces, tip = [], [], []
        hs2 = HeadShape(hx + 0.07, hy + 0.07, hz + 0.08, center=(0, 0.01, hc + 0.02))

        def lock(yaw, pitch, length, r0, flow, flick, flat=0.5):
            pos, n = hs2.point(yaw, pitch, -0.03)
            fl = Vector(flow).normalized()
            fl = (fl - n * fl.dot(n)).normalized()
            pts = [pos + fl * (length * t) + n * (length * flick * t * t) for t in [k / 9 for k in range(10)]]
            vv, ff = flat_sweep(pts, lambda t: r0 * (1 - 0.78 * t), n, flat, 12)
            base = len(verts)
            verts.extend(vv)
            faces.extend(tuple(q + base for q in face) for face in ff)
            body = 120
            tip.extend([(q // 12) / 9 for q in range(body)])
            rest = len(vv) - body
            tip.extend([1.0] * (rest // 2) + [0.0] * (rest - rest // 2))

        lock(2, 76, 0.27, 0.14, (0.1, -1.0, 0.45), 0.9)       # the tuft on top, curling up
        lock(160, 62, 0.2, 0.12, (0.2, 1.0, 0.0), 0.55)
        self.add('locks', (verts, faces), hair, 'head', tip=tip)

def periodic_interp(points, x):
    """Linear interpolation through (x, y) control points on a 360° periodic axis."""
    pts = sorted(points)
    x = (x + 180.0) % 360.0 - 180.0
    ext = [(px - 360.0, py) for px, py in pts] + pts + [(px + 360.0, py) for px, py in pts]
    for (x0, y0), (x1, y1) in zip(ext, ext[1:]):
        if x0 <= x <= x1:
            f = (x - x0) / (x1 - x0) if x1 > x0 else 0.0
            f = f * f * (3 - 2 * f)
            return y0 + (y1 - y0) * f
    return pts[0][1]


def hair_shell(hs: HeadShape, boundary, thickness, U: int = 128, V: int = 22, inner: float = -0.02):
    """A thick shell of hair over the head: covers every direction above boundary(yaw) (pitch in
    degrees), outer surface lifted by thickness(yaw, pitch, f) where f runs 0 at the edge to 1 at the
    crown. Returns (verts, faces, tip) with tip = 1 at the lock ends and 0 at the crown."""
    verts, faces, tip = [], [], []
    rings_out, rings_in = [], []
    for layer in (0, 1):
        grid = []
        for i in range(U):
            yaw = -180.0 + 360.0 * i / U
            b = boundary(yaw)
            col_ = []
            for j in range(V):
                f = j / V
                fe = f ** 1.35  # denser near the edge where the shapes are
                pitch = b + (89.0 - b) * fe
                lift = thickness(yaw, pitch, f) if layer == 0 else inner
                pos, _n = hs.point(yaw, pitch, lift)
                verts.append(tuple(pos))
                tip.append(max(0.0, 1.0 - f * 1.6))
                col_.append(len(verts) - 1)
            grid.append(col_)
        (rings_out if layer == 0 else rings_in).append(grid)
    go, gi = rings_out[0], rings_in[0]
    top_o = hs.point(0, 90, thickness(0, 90, 1.0))[0]
    top_i = hs.point(0, 90, inner)[0]
    verts.append(tuple(top_o))
    tip.append(0.0)
    to = len(verts) - 1
    verts.append(tuple(top_i))
    tip.append(0.0)
    ti = len(verts) - 1
    for i in range(U):
        i2 = (i + 1) % U
        for j in range(V - 1):
            a, b, c, d = go[i][j], go[i2][j], go[i2][j + 1], go[i][j + 1]
            faces.append((a, d, c, b))
            a, b, c, d = gi[i][j], gi[i2][j], gi[i2][j + 1], gi[i][j + 1]
            faces.append((a, b, c, d))
        faces.append((go[i][V - 1], to, go[i2][V - 1]))
        faces.append((gi[i][V - 1], gi[i2][V - 1], ti))
        # rim joining the outer and inner layers along the hairline
        faces.append((go[i][0], go[i2][0], gi[i2][0], gi[i][0]))
    return verts, faces, tip


def zigzag(yaw: float, tips, low: float, high: float, width: float = 11.0):
    """Pointed locks: pitch dips to `low` at each tip yaw and rises to `high` between tips."""
    d = min(abs(yaw - t) for t in tips)
    f = min(1.0, d / width)
    return low + (high - low) * (f ** 0.7)
