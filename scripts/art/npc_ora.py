"""Ora, the Festival Guide: the festival's cheerful chibi guide (an NPC; rendered by npcs.py).

Built on the heroes' Hero structure (char_models.py) and Kip's human rig, with a round, full-cheeked
head and big eyes: dark-brown hair with a side-swept fringe, full side locks and a big twisted top bun
crowned by a yellow-orange star flower, a teal patterned headband; a teal scarf whose long cape-like
tail flows off her right shoulder; a cream long-sleeved shirt under a golden vest with a teal bodice
and a gold brooch, a slung brown belt with a round satchel (teal-gold badge) on her right hip and a
small pouch on her left, yellow / orange / red panels hanging from the belt over a cream tunic hem,
gold bracelets, denim shorts and tall brown boots with cream soles, toe caps and cuffs. Her prop is a
festival flag: a wooden pole with gold finials and a teal banner with a golden sun-spiral.

pose['extra'] keys: scarf (0 hangs .. 1 streams out behind), wave (flutter phase) and flag (None, or a
dict: tilt of the pole towards screen right in degrees, below / above: pole length round the grip).
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import HeadShape, R, S, T, cloth_strip, disc, ellipsoid, flat_sweep, open_sweep, polyline_segment, rad, superellipsoid, sweep, torus
from char_models import Hero, hair_shell, periodic_interp
from char_mossi import catmull, leaf, leaf_width, ramp_mat
from char_zippa import SquirrelHead, direction
from char_anims import IDLE_YAW, face, pose


def _ss(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def merge(meshes):
    verts, faces = [], []
    for v, f in meshes:
        base = len(verts)
        verts.extend(tuple(q) for q in v)
        faces.extend(tuple(i + base for i in fc) for fc in f)
    return verts, faces


def placed(m: Matrix, mesh):
    return [tuple(m @ Vector(v)) for v in mesh[0]], mesh[1]


def capsule(a, b, r0: float, r1: float | None = None, sides: int = 12):
    """A rounded tube from a to b (radius r0 -> r1)."""
    r1 = r0 if r1 is None else r1
    a, b = Vector(a), Vector(b)
    return sweep([a.lerp(b, i / 4) for i in range(5)], lambda t: r0 + (r1 - r0) * t, sides)


def tip_values(n: int, sides: int, nverts: int, t0: float = 0.0, t1: float = 1.0):
    """'tip' values for a sweep / flat_sweep of n rings: t0 -> t1 along it, then the end and start caps."""
    tip = []
    for i in range(n):
        tip += [t0 + (t1 - t0) * i / max(1, n - 1)] * sides
    rest = nverts - n * sides
    return tip + [t1] * (rest // 2) + [t0] * (rest - rest // 2)


class Acc:
    """Collects meshes (with 'tip' values) into one part."""

    def __init__(self):
        self.v, self.f, self.t = [], [], []

    def add(self, mesh, tip=None, value: float = 0.5):
        v, f = mesh[0], mesh[1]
        b = len(self.v)
        self.v.extend(tuple(q) for q in v)
        self.f.extend(tuple(i + b for i in fc) for fc in f)
        self.t.extend(tip if tip is not None else [value] * len(v))

    @property
    def mesh(self):
        return self.v, self.f


def stripes_mat(mats, name: str, base: str, stripe: str, bands: float, width: float = 0.25, rough: float = 0.6):
    """Cloth with narrow stripes of `stripe` across the vertex attribute 'tip' (the headband)."""
    def make(n):
        m = lib.NT(n)
        t = m.node('ShaderNodeAttribute')
        t.attribute_name = 'tip'
        wave = m.math('SINE', m.math('MULTIPLY', t.outputs['Fac'], bands * math.tau))
        lo = 1.0 - 2.0 * width
        f = m.maprange(wave, lo, lo + 0.25)
        c = m.mix(f, col(base), col(stripe))
        m.bsdf(c, rough, sheen=0.4, spec=0.3)
        return m.mat
    return mats.get(name, make)


class RoundHead(SquirrelHead):
    """The head ellipsoid with soft bumps (full cheeks); features conform to the bumped surface."""

    def surface(self, d: Vector):
        d = d.normalized()
        yaw = math.degrees(math.atan2(d.x, -d.y))
        pitch = math.degrees(math.asin(max(-1.0, min(1.0, d.z))))
        return self.point(yaw, pitch, 0.0)


# ------------------------------------------------------------------------------------------
def ora_hand(side: int, kind: str, s: float = 1.0):
    """A small bare hand in the wrist frame: -Z runs along the forearm to the fingertips, the palm
    faces -Y and the thumb sits on the +X*side edge. kind: 'open' (flat, fingers a little fanned),
    'fist', 'point' (fist with the index finger out) or 'clasp' (softly curled, for joined hands)."""
    sd = side
    meshes = [ellipsoid(0.056 * s, 0.035 * s, 0.062 * s, 18, 12, center=(0.0, 0.0, -0.062 * s))]
    if kind == 'open':
        fx = (0.035, 0.012, -0.012, -0.034)  # index .. little finger
        fl = (0.064, 0.072, 0.067, 0.054)
        for k in range(4):
            spread = rad((1.5 - k) * 9.0 * sd)
            d = Vector((math.sin(spread), 0.0, -math.cos(spread)))
            a = Vector((fx[k] * sd * s, 0.004 * s, -0.1 * s))
            meshes.append(capsule(a, a + d * fl[k] * s, 0.0168 * s, 0.0148 * s, 10))
        a = Vector((0.046 * sd * s, -0.012 * s, -0.04 * s))
        d = Vector((0.62 * sd, -0.3, -0.72)).normalized()
        meshes.append(capsule(a, a + d * 0.06 * s, 0.0195 * s, 0.0165 * s, 10))
    else:
        x0 = -0.042 if kind != 'point' else -0.04
        x1 = 0.042 if kind != 'point' else 0.012
        roll_r = 0.031 if kind != 'clasp' else 0.034
        a = Vector((x0 * sd * s, -0.026 * s, -0.106 * s))
        b = Vector((x1 * sd * s, -0.026 * s, -0.106 * s))
        meshes.append(capsule(a, b, roll_r * s, roll_r * s, 12))
        if kind == 'point':
            a = Vector((0.032 * sd * s, -0.006 * s, -0.098 * s))
            meshes.append(capsule(a, a + Vector((0.004 * sd, -0.004, -0.092)) * s, 0.0172 * s, 0.015 * s, 10))
        a = Vector((0.05 * sd * s, -0.018 * s, -0.048 * s))
        b = Vector((0.024 * sd * s, -0.05 * s, -0.086 * s))
        meshes.append(capsule(a, b, 0.019 * s, 0.017 * s, 10))
    return merge(meshes)


def coil_points(R0: float, turns: float, H: float, n: int = 90, shrink: float = 0.8):
    """A rising spiral: radius R0 at the base shrinking by `shrink`, `turns` turns, height H."""
    pts = []
    for i in range(n + 1):
        t = i / n
        a = t * turns * math.tau
        r = R0 * (1.0 - shrink * t ** 0.9)
        pts.append(Vector((r * math.cos(a), r * math.sin(a), H * math.sin(t * math.pi / 2))))
    return pts


def frame_z(origin: Vector, z: Vector, y_hint: Vector) -> Matrix:
    """A matrix at `origin` whose local +Z is `z` and local -Y leans towards y_hint."""
    z = z.normalized()
    y = -(y_hint - z * y_hint.dot(z)).normalized()
    x = y.cross(z).normalized()
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = origin
    return m


# ------------------------------------------------------------------------------------------
class Ora(Hero):
    """Ora: the festival guide — big top bun with a star flower, teal scarf cape, golden vest, flag."""

    key = 'ora'
    ankle_h = 0.158
    hip_h = 0.59
    spine = 0.09
    chest = 0.19
    neck = 0.16
    head_up = 0.06
    shoulder = (0.2, 0.0, 0.1)
    upper_arm = 0.225
    forearm = 0.212
    hip_w = 0.13
    thigh = 0.18
    shin = 0.212
    sit_h = 0.17

    HEAD = (0.385, 0.36, 0.35, 0.475)  # rx, ry, rz, centre height above the head joint
    C = dict(skin='#ffcda6', skin_d='#eea27e', iris='#7a4122', brow='#4a2210', hair_d='#361708', hair_l='#9e5a2e',
             scarf='#19a3b3', scarf_d='#10808d', shirt='#fae3c6', vest='#f2ac32', vest_d='#d98a1e', teal='#1d8f9c',
             gold='#e8b33e', belt='#6e4020', shorts='#34497e', cuff='#4b5f97', boot='#7b4822', boot_d='#5e3517',
             boot_cuff='#d5a268', sole='#efd3a4', bag='#9a6436', flap='#74451f', badge='#1ea3a8', yellow='#f6ba2a',
             orange='#f07a24', red='#da4a2c', band='#1c9db0', band_y='#f4c233', petal_y='#f8bd22', petal_o='#f26a1f',
             leaf='#7cb342', wood='#8b5a2e', banner='#1aa3b2', sun='#f7bb2a', sun_d='#e3861b', blush='#ff8a80', hand='#eca47c')

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.45

    # --- materials ----------------------------------------------------------------------------
    def materials(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('ora_skin', c['skin']),
            skin_d=mt.skin('ora_skin_d', c['skin_d']),
            hand=mt.skin('ora_hand', c['hand']),
            hair=mt.hair('ora_hair', c['hair_d'], c['hair_l'], 0.4),
            scarf=mt.cloth('ora_scarf', c['scarf'], 0.7, 0.5, 0.08),
            scarf_d=mt.cloth('ora_scarf_d', c['scarf_d'], 0.7, 0.5),
            shirt=mt.cloth('ora_shirt', c['shirt'], 0.75, 0.35),
            vest=mt.cloth('ora_vest', c['vest'], 0.62, 0.35, 0.06),
            vest_d=mt.cloth('ora_vest_d', c['vest_d'], 0.62, 0.3),
            teal=mt.cloth('ora_teal', c['teal'], 0.65, 0.35),
            gold=mt.metal('ora_gold', c['gold'], 0.3),
            belt=mt.cloth('ora_belt', c['belt'], 0.55, 0.2, 0.1, 40),
            shorts=mt.cloth('ora_shorts', c['shorts'], 0.78, 0.35, 0.1),
            cuff=mt.cloth('ora_cuff', c['cuff'], 0.78, 0.3),
            boot=mt.cloth('ora_boot', c['boot'], 0.5, 0.2, 0.1, 30),
            boot_d=mt.cloth('ora_boot_d', c['boot_d'], 0.5, 0.2),
            boot_cuff=mt.cloth('ora_boot_cuff', c['boot_cuff'], 0.6, 0.25),
            sole=mt.cloth('ora_sole', c['sole'], 0.6, 0.1),
            bag=mt.cloth('ora_bag', c['bag'], 0.55, 0.2, 0.15, 25),
            flap=mt.cloth('ora_flap', c['flap'], 0.55, 0.2, 0.1, 25),
            badge=mt.glossy('ora_badge', c['badge'], 0.3, 0.6),
            yellow=mt.cloth('ora_yellow', c['yellow'], 0.66, 0.4),
            orange=mt.cloth('ora_orange', c['orange'], 0.66, 0.4),
            red=mt.cloth('ora_red', c['red'], 0.66, 0.4),
            band=stripes_mat(mt, 'ora_band', c['band'], c['band_y'], 9.0, 0.22),
            petal=ramp_mat(mt, 'ora_petal', [(0.0, '#f8b41e'), (0.45, '#ffd23c'), (0.75, '#fba826'), (1.0, c['petal_o'])], 0.45, 0.25, 0.3),
            leaf=ramp_mat(mt, 'ora_leaf', [(0.0, '#3f7f2a'), (0.6, c['leaf']), (1.0, '#a8d45a')], 0.5, 0.2, 0.2),
            wood=mt.glossy('ora_wood', c['wood'], 0.45, 0.2),
            banner=mt.cloth('ora_banner', c['banner'], 0.7, 0.45, 0.05),
            sun=mt.glossy('ora_sun', c['sun'], 0.4, 0.3),
            sun_d=mt.glossy('ora_sun_d', c['sun_d'], 0.4, 0.3),
            blush=mt.alpha('ora_blush', c['blush'], 0.42),
        )

    # --- building -----------------------------------------------------------------------------
    def dress(self):
        self.materials()
        ex = self.pose.get('extra', {})
        self.fly = ex.get('scarf', 0.1)
        self.wave = ex.get('wave', 0.0)
        self.torso()
        self.waist()
        self.legs()
        self.arms()
        self.head_and_face()
        self.hair()
        self.scarf()
        if ex.get('flag'):
            self.flag(ex['flag'])

    # --- torso: cream shirt, teal bodice under a golden vest, gold brooch -----------------------
    @staticmethod
    def prof(t: float) -> float:
        return 0.2 - 0.022 * t + 0.012 * math.sin(math.pi * t)

    def torso(self):
        M = self.mat
        prof = self.prof
        z0, z1 = -0.34, 0.12
        col_pts = [Vector((0, 0, z0 + (z1 - z0) * i / 10)) for i in range(11)]
        self.add('shirt', sweep(col_pts, lambda t: prof(t) - 0.012, 24, cap0=False, squash=0.8), M['shirt'], 'chest')
        vz0, vz1 = -0.27, 0.11
        vpts = [Vector((0, 0, vz0 + (vz1 - vz0) * i / 8)) for i in range(9)]

        def vr(t):
            return prof((vz0 + (vz1 - vz0) * t - z0) / (z1 - z0))
        self.add('bodice', open_sweep(vpts, lambda t: vr(t) + 0.002, -120, -60, 12, 0.8, 0.02), M['teal'], 'chest')
        self.add('vest', open_sweep(vpts, lambda t: vr(t) + 0.012, -70, 250, 30, 0.8, 0.024), M['vest'], 'chest')
        self.add('shoulders', ellipsoid(0.206, 0.158, 0.088, 26, 12, center=(0, 0, 0.1), zmin=-0.2), M['vest'], 'chest')
        # gold piping down the vest's front edges
        for a in (-70, 250):
            ar = math.radians(a)
            pts = [Vector((math.cos(ar) * (vr(i / 8) + 0.014), math.sin(ar) * (vr(i / 8) + 0.014) * 0.8, vz0 + (vz1 - vz0) * i / 8)) for i in range(9)]
            self.add('piping', sweep(pts, 0.011, 8), M['gold'], 'chest')
        # brooch at the top of the bodice
        by = -vr(0.9) * 0.8 - 0.024
        bm = T(0, by, 0.1) @ R(-14, 0, 0)
        self.add('brooch', disc(0.052, 0.026, 28), M['gold'], 'chest', bm)
        self.add('brooch_in', disc(0.032, 0.03, 22), M['badge'], 'chest', bm)
        self.add('brooch_rim', torus(0.05, 0.009, 24, 6), M['gold'], 'chest', bm @ T(0, -0.012, 0) @ R(90, 0, 0))

    # --- waist: slung belt, tunic hem, colourful panels, shorts, satchel and pouch ----------------
    def waist(self):
        M = self.mat
        tilt = R(0, -8, 0)
        # cream tunic hem flaring out below the belt (spine frame)
        hz0, hz1 = -0.07, 0.11
        pts = [Vector((0, 0, hz0 + (hz1 - hz0) * i / 6)) for i in range(7)]
        self.add('hem', open_sweep(pts, lambda t: 0.246 - 0.036 * t, -270, 90, 36, 0.82, 0.014), M['shirt'], 'spine', tilt)
        # panels hanging from the belt round her sides and back (angles: 0 her left, 90 back, -90 front)
        cols = ('red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'yellow', 'red')
        self.add('panel_f', open_sweep([Vector((0, 0, -0.22 + 0.32 * i / 6)) for i in range(7)], lambda t: 0.292 - 0.066 * t, -84, -58, 6, 0.84, 0.012),
                 M['orange'], 'spine', tilt)
        for k, a in enumerate((-50, -20, 12, 48, 88, 128, 164, 196)):
            pz0 = -0.24 + 0.025 * math.sin(k * 1.7)
            pp = [Vector((0, 0, pz0 + (0.1 - pz0) * i / 6)) for i in range(7)]
            self.add(f'panel{k}', open_sweep(pp, lambda t: 0.282 - 0.058 * t, a - 21, a + 21, 8, 0.84, 0.012), M[cols[k]], 'spine', tilt)
        # the belt, lower on her right hip where the satchel hangs
        self.add('belt', torus(0.214, 0.026, 40, 8, center=(0, 0, 0.11)), M['belt'], 'spine', tilt @ S(1.0, 0.83, 1.0))
        bm = tilt @ T(0, -0.208 * 0.83 - 0.022, 0.11)
        self.add('buckle', superellipsoid(0.046, 0.013, 0.036, 4.0, 16, 8), M['gold'], 'spine', bm)
        self.add('buckle_in', superellipsoid(0.028, 0.01, 0.02, 4.0, 12, 6), M['belt'], 'spine', bm @ T(0, -0.008, 0))
        # shorts (hips frame)
        self.add('pelvis', superellipsoid(0.205, 0.166, 0.13, 2.4, 28, 16, center=(0, 0, 0.0)), M['shorts'], 'hips')
        # round satchel on her right hip with a teal-gold badge, hanging from the belt
        sm = T(-0.36, -0.07, -0.025) @ R(0, 0, -30) @ R(0, -4, 0)
        self.add('satchel', superellipsoid(0.17, 0.066, 0.162, 2.1, 30, 16), M['bag'], 'hips', sm)
        self.add('satchel_flap', ellipsoid(0.176, 0.074, 0.084, 30, 12, center=(0, -0.002, 0.086), zmin=0.0), M['flap'], 'hips', sm)
        self.add('satchel_rim', torus(0.166, 0.012, 40, 6), M['flap'], 'hips', sm @ R(90, 0, 0))
        bd = sm @ T(0, -0.07, -0.03)
        self.add('badge', disc(0.086, 0.02, 32), M['gold'], 'hips', bd)
        self.add('badge_in', disc(0.064, 0.026, 28), M['badge'], 'hips', bd)
        self.add('badge_dot', disc(0.022, 0.03, 16), M['gold'], 'hips', bd)
        strap = [Vector((-0.2, -0.12, 0.2)), Vector((-0.28, -0.13, 0.17)), Vector((-0.33, -0.13, 0.13))]
        self.add('satchel_strap', sweep(polyline_segment(catmull(strap, 6), 0, 1, 10), 0.022, 8, squash=0.45), M['belt'], 'hips')
        # small pouch on her left hip
        pm = T(0.33, 0.0, 0.0) @ R(0, 0, 70)
        self.add('pouch', superellipsoid(0.085, 0.06, 0.118, 2.6, 18, 12), M['bag'], 'hips', pm)
        self.add('pouch_flap', superellipsoid(0.089, 0.034, 0.048, 2.8, 18, 8, center=(0, -0.038, 0.074)), M['badge'], 'hips', pm)
        self.add('pouch_stud', ellipsoid(0.014, 0.01, 0.014, 8, 6, center=(0, -0.074, 0.058)), M['gold'], 'hips', pm)

    # --- legs: short denim legs, bare knees, tall chunky boots -------------------------------------
    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('shorts' + s_, hip, kn, an, lambda t: 0.12 + 0.014 * t, M['shorts'], 0.0, 0.34, 16, 8, cap0=True, cap1=False)
            self.add('scuff' + s_, torus(0.132, 0.022, 24, 8), M['cuff'], None, self.limb_frame(hip, kn, an, 0.33, hip))
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.084 - 0.006 * t, M['skin'], 0.3, 0.78, 12, 10)
            # boot shaft up the shin with a folded cuff
            self.limb('shaft' + s_, hip, kn, an, lambda t: 0.1 + 0.006 * t, M['boot'], 0.72, 1.0, 16, 8, cap0=False, cap1=True)
            self.add('bcuff' + s_, torus(0.106, 0.034, 24, 8, squash=1.2), M['boot_cuff'], None, self.limb_frame(hip, kn, an, 0.73, hip))
            fm = self.J(an) @ R(0, 0, 16 * sd)
            self.add('boot' + s_, superellipsoid(0.146, 0.21, 0.128, 2.6, 22, 14, center=(0, -0.06, -0.03)), M['boot'], None, fm)
            self.add('toe' + s_, ellipsoid(0.136, 0.118, 0.094, 18, 10, center=(0, -0.19, -0.07)), M['sole'], None, fm)
            self.add('sole' + s_, superellipsoid(0.152, 0.24, 0.03, 3.0, 22, 8, center=(0, -0.07, -0.128)), M['sole'], None, fm)
            strap = [Vector((-0.138, -0.07, -0.0)), Vector((0.0, -0.172, 0.03)), Vector((0.138, -0.07, -0.0))]
            self.add('bstrap' + s_, sweep(polyline_segment(catmull(strap, 6), 0, 1, 10), 0.019, 8, squash=0.6), M['boot_d'], None, fm)
            self.add('bbuckle' + s_, superellipsoid(0.026, 0.012, 0.022, 3.5, 10, 6), M['gold'], None, fm @ T(0.06 * sd, -0.162, 0.024))

    # --- arms: long cream sleeves, gold bracelets, bare hands -------------------------------------
    def arms(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.076 + 0.03 * math.sin(math.pi * min(1.0, 0.35 + t * 0.9)) - 0.002 * t,
                      M['shirt'], 0.0, 0.9, 14, 14, cap0=True, cap1=False)
            self.limb('bracelet' + s_, sh, el, wr, 0.076, M['gold'], 0.8, 0.99, 16, 4, cap0=False, cap1=False)
            for tb in (0.805, 0.985):
                self.add('brim' + s_, torus(0.076, 0.011, 20, 6), M['gold'], None, self.limb_frame(sh, el, wr, tb, wr))
            gm = self.limb_frame(sh, el, wr, 0.895, wr)
            self.add('bgem' + s_, ellipsoid(0.02, 0.012, 0.02, 10, 6, center=(0.0, -0.08, 0.0)), M['badge'], None, gm)
            hand = self.pose.get('hand' + s_, 'fist')
            self.add('hand' + s_, ora_hand(sd, hand, 1.58), M['hand'], None, self.J(wr) @ T(0, 0, -0.012))

    # --- head -------------------------------------------------------------------------------------
    def head_and_face(self):
        M, c = self.mat, self.C
        hx, hy, hz, hc = self.HEAD
        bumps = [(direction(48, -30), 42.0, 0.03), (direction(-48, -30), 42.0, 0.03), (direction(0, -70), 34.0, -0.012)]
        head = RoundHead(hx, hy, hz, (0, 0, hc), bumps)
        self.add('head', head.mesh(44, 30), M['skin'], 'head')
        self.add('neck', sweep([Vector((0, 0.02, -0.12)), Vector((0, 0.02, 0.12))], 0.075, 16), M['skin'], 'head')
        for sd in (1, -1):
            em = T((hx - 0.012) * sd, 0.03, hc - 0.07) @ R(0, 0, -12 * sd)
            self.add('ear', ellipsoid(0.058, 0.036, 0.074, 16, 10), M['skin'], 'head', em)
            self.add('earin', ellipsoid(0.031, 0.018, 0.043, 12, 8), M['skin_d'], 'head', em @ T(0.006 * sd, -0.022, 0.0))
            self.add('earring', ellipsoid(0.018, 0.018, 0.018, 10, 8), M['gold'], 'head', em @ T(0.004 * sd, -0.012, -0.074))
            self.add('earring2', ellipsoid(0.013, 0.013, 0.021, 10, 8), M['gold'], 'head', em @ T(0.004 * sd, -0.012, -0.105))
        n0 = len(self.parts)
        self.face(head, 'head', eye_yaw=27.5, eye_pitch=-5, eye_size=(0.12, 0.13), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-34,
                  mouth_w=0.9, lid_col=c['skin'], skin=c['skin'], brow_pitch=25, blush=False)
        self.face_tweaks(head, n0)
        for sd in (1, -1):
            self.feat('blush', ellipsoid(0.07, 0.004, 0.044, 16, 8), M['blush'], 'head', head, head.frame(sd * 44, -22, 0.004))

    def face_tweaks(self, head, n0: int):
        """Bolder features than the stock face so they read at crowd size: a big open D-shaped mouth for
        'grin' / 'laugh' (upper teeth, tongue) and thicker arcs for closed happy eyes."""
        f = self.pose.get('face', {})
        mouth, eyes = f.get('mouth', 'smile'), f.get('eyes', 'open')
        mt = self.m
        drop = set()
        if mouth in ('grin', 'laugh'):
            drop |= {'mouth', 'tongue', 'teeth'}
        if eyes in ('happy', 'closed', 'wink'):
            drop |= {'happyL', 'happyR', 'closedL', 'closedR'}
        self.parts = self.parts[:n0] + [p for p in self.parts[n0:] if p.name not in drop]
        lash = mt.glossy('lash_#2a1a14', '#2a1a14', 0.4, 0.2)
        if eyes in ('happy', 'closed', 'wink'):
            ew, eh = 0.12, 0.13
            for sd, nm in ((1, 'L'), (-1, 'R')):
                if eyes == 'wink' and sd > 0:
                    continue
                fr = head.frame(27.5 * sd, -5, -ew * 0.34 * 0.55)
                pts = [Vector((t * ew * 0.82, -0.012, eh * 0.38 * (1 - t * t) - eh * 0.2)) for t in [i / 12 * 2 - 1 for i in range(13)]]
                self.feat('happy' + nm, sweep(pts, lambda t: 0.013 + 0.009 * math.sin(math.pi * t), 8), lash, 'head', head, fr)
        if mouth in ('grin', 'laugh'):
            w, h = (0.158, 0.088) if mouth == 'grin' else (0.176, 0.114)
            mf = head.frame(0, -33, 0.0)
            inside = mt.glossy('mouth', '#6d2a26', 0.4, 0.2)
            v, fc = ellipsoid(w / 2, 0.022, h, 26, 12, zmax=0.12)
            v = [(x, y, z + 0.22 * h * (x / (w / 2)) ** 2) for (x, y, z) in v]
            self.feat('mouth', (v, fc), inside, 'head', head, mf @ T(0, 0.002, 0.006))
            tv, tf = ellipsoid(w * 0.3, 0.012, h * 0.38, 16, 8, center=(0, -0.01, -h * 0.64))
            self.feat('tongue', (tv, tf), mt.glossy('tongue', '#e8797b', 0.35, 0.3), 'head', head, mf)
            tv, tf = ellipsoid(w * 0.4, 0.01, 0.017, 16, 6, center=(0, -0.013, 0.0))
            tv = [(x, y, z + 0.2 * h * (x / (w * 0.4)) ** 2 - 0.004) for (x, y, z) in tv]
            self.feat('teeth', (tv, tf), mt.glossy('teeth', '#fffdf6', 0.25, 0.4), 'head', head, mf)

    # --- hair ---------------------------------------------------------------------------------------
    # the fringe's lock tips (yaw); between them the edge rises slowly and drops steeply, so the locks
    # sweep across the brow towards her right
    TIPS = (-66, -44, -21, 4, 28)
    BASE = [(-180, -46), (-150, -44), (-126, -28), (-110, 6), (-96, 16), (-84, 6), (-74, -4), (-66, -6), (-44, 3), (-21, 14), (4, 24),
            (28, 31), (46, 30), (60, 16), (72, -12), (82, -36), (96, -42), (130, -42)]

    def boundary(self, yaw: float) -> float:
        b = periodic_interp(self.BASE, yaw)
        tips = self.TIPS
        for k in range(len(tips) - 1):
            t0, t1 = tips[k], tips[k + 1]
            if t0 <= yaw <= t1:
                u = (yaw - t0) / (t1 - t0)
                sh = math.sin(0.5 * math.pi * u / 0.72) if u < 0.72 else math.cos(0.5 * math.pi * (u - 0.72) / 0.28)
                b += 10.5 * max(0.0, sh) ** 1.1
        return b

    @staticmethod
    def thickness(yaw: float, pitch: float, f: float) -> float:
        a = abs(yaw)
        edge = min(1.0, f / 0.16)
        side = _ss((a - 55) / 35)
        low = _ss((34 - pitch) / 44)
        ridge = 0.5 + 0.5 * math.cos(math.radians(yaw) * 15 + 0.4)
        front = _ss((60 - a) / 40) * _ss((pitch - 10) / 30 + 0.3)
        return 0.012 + edge * (0.026 - 0.006 * front + 0.058 * side * low + 0.01 * ridge)

    def hair_hs(self) -> HeadShape:
        hx, hy, hz, hc = self.HEAD
        return HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.005, hc + 0.008))

    def hair_lift(self, yaw: float, pitch: float) -> float:
        """Height of the hair's outer surface above hair_hs() in a direction (for things lying on it)."""
        b = self.boundary(yaw)
        if pitch <= b:
            return 0.0
        fe = (pitch - b) / (89.0 - b)
        return self.thickness(yaw, pitch, max(0.0, fe) ** (1 / 1.35))

    def hair(self):
        M = self.mat
        hs = self.hair_hs()
        v, f, tp = hair_shell(hs, self.boundary, self.thickness, 160, 26)
        self.add('hair', (v, f), M['hair'], 'head', tip=tp)
        acc = Acc()
        # two broad locks lying on the fringe, sweeping from the parting (on her left) across the brow
        for path, w0 in (([(40, 66), (16, 52), (-12, 38), (-36, 22)], 0.12), ([(20, 74), (-8, 58), (-34, 40), (-56, 14)], 0.11)):
            self.surface_lock(acc, hs, path, w0, 0.004)
        # full side locks: behind the ear and curling out on her right, framing the cheek on her left, short at the back
        for yaw, p0, p1, drop, flare, curl, w0 in ((-106, 24, -34, 0.21, 0.17, 0.12, 0.19), (-127, 28, -40, 0.26, 0.2, 0.13, 0.2),
                                                   (-150, 32, -46, 0.22, 0.13, 0.11, 0.19), (-168, 38, -50, 0.14, 0.06, 0.06, 0.16),
                                                   (170, 38, -50, 0.1, 0.04, 0.04, 0.14), (146, 34, -46, 0.15, 0.06, 0.06, 0.14),
                                                   (122, 30, -42, 0.17, 0.08, 0.07, 0.145), (98, 26, -40, 0.14, 0.05, 0.06, 0.13),
                                                   (77, 30, -36, 0.09, 0.02, -0.05, 0.115)):
            self.hang_lock(acc, hs, yaw, p0, p1, drop, flare, curl, w0)
        self.add('locks', acc.mesh, M['hair'], 'head', tip=acc.t)
        self.bun()
        self.headband(hs)

    def surface_lock(self, acc: Acc, hs: HeadShape, path, w0: float, lift: float, n: int = 12):
        """A flat lock lying on the hair along a (yaw, pitch) path, tapering to a point."""
        ctrl = [Vector((y, p, 0.0)) for y, p in path]
        yp = polyline_segment(catmull(ctrl, 6), 0.0, 1.0, n)
        pts, nrms = [], []
        for i, q in enumerate(yp):
            pos, nn = hs.point(q.x, q.y, self.hair_lift(q.x, q.y) + lift)
            pts.append(pos)
            nrms.append(nn)
        mesh = flat_sweep(pts, lambda t: w0 * (1.0 - 0.85 * t ** 1.3), lambda t: nrms[min(n, int(round(t * n)))], 0.3, 12)
        acc.add(mesh, tip_values(n + 1, 12, len(mesh[0]), 0.2, 1.0))

    def hang_lock(self, acc: Acc, hs: HeadShape, yaw, p0, p1, drop, flare, curl, w0, flat=0.55):
        """A broad lock lying on the head from (yaw, p0) down to pitch p1, then hanging `drop` lower,
        flaring out by `flare` and flicking out by `curl` at the end (negative curls in)."""
        pts, nrms = [], []
        for i in range(7):
            p = p0 + (p1 - p0) * i / 6
            pos, nn = hs.point(yaw, p, self.hair_lift(yaw, p) * 0.55 + 0.012)
            pts.append(pos)
            nrms.append(nn)
        radial = Vector((math.sin(rad(yaw)), -math.cos(rad(yaw)), 0.0))
        side = Vector((math.copysign(1.0, math.sin(rad(yaw))), 0.25, 0.0)).normalized()
        out = (radial * 0.45 + side * 0.55).normalized()
        P1 = pts[-1]
        ctrl = pts + [P1 + Vector((0, 0, -drop * 0.55)) + out * flare * 0.55, P1 + Vector((0, 0, -drop)) + out * flare,
                      P1 + Vector((0, 0, -drop + abs(curl) * 0.45)) + out * (flare + curl)]
        path = polyline_segment(catmull(ctrl, 5), 0.0, 1.0, 18)
        n0 = nrms[0]

        def nf(t):
            s = _ss((t - 0.25) / 0.35)
            return (n0 * (1 - s) + out * s).normalized()

        mesh = flat_sweep(path, lambda t: w0 * (0.82 + 0.28 * math.sin(math.pi * min(1.0, t * 1.3))) * (1.0 - 0.55 * t ** 3), nf, flat, 12)
        acc.add(mesh, tip_values(19, 12, len(mesh[0]), 0.08, 1.0))

    def bun(self):
        """A big bun of fat stacked rolls on the top of the head, towards the back on her right: a coil
        whose turns press together (dark creases between the rolls, light on their outsides)."""
        M = self.mat
        hx, hy, hz, hc = self.HEAD
        centre = Vector((-0.225, 0.27, hc + 0.43))
        axis = Vector((0.4, -0.06, 0.91)).normalized()  # the rolls stack up and over towards her left
        R0, rt, turns, H = 0.148, 0.134, 1.85, 0.285
        n = 120
        F = frame_z(centre - axis * (H * 0.45), axis, Vector((0.0, 0.0, 1.0)))
        pts = []
        for i in range(n + 1):
            t = i / n
            a = t * turns * math.tau + 2.2
            r = R0 * (1.0 - 0.26 * t)
            pts.append(Vector((r * math.cos(a), r * math.sin(a), H * t)))
        sides = 18
        v, f = sweep(pts, lambda t: rt * (0.92 + 0.16 * math.sin(math.pi * min(1.0, t * 1.6)) - 0.2 * t ** 2), sides)
        tip = []
        for i in range(n + 1):
            c = pts[i]
            radial = Vector((c.x, c.y, 0.0)).normalized()
            for k in range(sides):
                d = (Vector(v[i * sides + k]) - c).normalized()
                tip.append(0.02 + 0.66 * max(0.0, d.dot(radial) * 0.8 + d.z * 0.35) ** 1.1)
        tip += [0.45] * (len(v) - len(tip))
        self.add('bun', (v, f), M['hair'], 'head', F, tip=tip)
        core = ellipsoid(R0 + 0.03, R0 + 0.03, H * 0.5 + 0.06, 20, 12, center=(0, 0, H * 0.45))
        self.add('bun_core', core, M['hair'], 'head', F, tip=[0.04] * len(core[0]))

    def headband(self, hs: HeadShape):
        """A teal patterned Alice band from ear to ear, a little in front of the bun."""
        M = self.mat
        pts, nrms = [], []
        n = 32
        tilt = Matrix.Rotation(rad(22), 3, 'X')
        for i in range(n + 1):
            u = rad(-100 + 200 * i / n)
            d = tilt @ Vector((math.sin(u), 0.0, math.cos(u)))
            yaw = math.degrees(math.atan2(d.x, -d.y))
            pitch = math.degrees(math.asin(max(-1.0, min(1.0, d.z))))
            pos, nn = hs.point(yaw, pitch, self.hair_lift(yaw, pitch) + 0.01)
            pts.append(pos)
            nrms.append(nn)
        mesh = flat_sweep(pts, 0.04, lambda t: nrms[min(n, int(round(t * n)))], 0.32, 12, cap0=True, cap1=True)
        self.add('headband', mesh, M['band'], 'head', tip=tip_values(n + 1, 12, len(mesh[0])))
        self.flower(pts, nrms, 0.53)

    def flower(self, pts, nrms, u: float):
        """The yellow-orange star flower on the band, petals fanning up and out, with a green leaf."""
        M = self.mat
        i = int(round(u * (len(pts) - 1)))
        pos, nn = pts[i], nrms[i]
        fwd = Vector((0.3, -1.0, 0.1)).normalized()  # the flower faces front, a little to her left
        z = (nn * 0.5 + Vector((0, 0, 0.7))).normalized()
        x = z.cross(fwd).normalized()
        y = z.cross(x).normalized()
        F = Matrix((x, y, z)).transposed().to_4x4()
        F.translation = pos + nn * 0.02 + Vector((0.0, 0.0, 0.03))
        acc = Acc()
        for k, (a, ln, w) in enumerate(((-74, 0.22, 0.12), (-48, 0.26, 0.13), (-22, 0.29, 0.135), (4, 0.3, 0.135), (30, 0.28, 0.132),
                                        (56, 0.25, 0.125), (80, 0.21, 0.115))):
            ar = rad(a)
            d0 = Vector((math.sin(ar), -0.22, math.cos(ar)))
            lo, hi = (0.02, 0.5) if k < 4 else (0.25, 1.0)
            pv, pf, pt = leaf(Vector((0, 0, 0)), d0, Vector((0.0, -1.0, 0.25)), ln, leaf_width(w, 0.42, 1.1, 0.25), -14, 0, 0, 0.16, 0.08, (lo, hi), 0.0, 10)
            acc.add((pv, pf), tip=pt)
        self.add('flower', placed(F, acc.mesh), M['petal'], 'head', tip=acc.t)
        self.add('flower_c', ellipsoid(0.062, 0.04, 0.056, 14, 8), M['orange'], 'head', F @ T(0, -0.034, 0.024))
        lf = leaf(Vector((0.05, 0.02, -0.02)), Vector((1.0, 0.1, -0.45)), Vector((0.0, -1.0, 0.3)), 0.24, leaf_width(0.1, 0.4, 1.0, 0.2), 10, 0, 0,
                  0.14, 0.1, (0.2, 1.0), 0.15, 10)
        self.add('flower_leaf', placed(F, lf[:2]), M['leaf'], 'head', tip=lf[2])

    # --- scarf: thick wrap round the neck and a long cape-like tail off her right shoulder ------
    def scarf(self):
        M = self.mat
        fly, wave = self.fly, self.wave
        seg, sides = 40, 12
        verts, faces = [], []
        for i in range(seg):
            a = i / seg * math.tau
            front = max(0.0, -math.sin(a))  # 1 at the front (-Y)
            rr = 0.076 + 0.024 * front ** 1.5
            cx, cy = 0.17 * math.cos(a), 0.158 * math.sin(a) - 0.004
            cz = 0.262 - 0.034 * front ** 2.2
            for k in range(sides):
                b = k / sides * math.tau
                verts.append((cx + rr * math.cos(b) * math.cos(a), cy + rr * math.cos(b) * math.sin(a), cz + rr * math.sin(b) * 0.9))
        for i in range(seg):
            for k in range(sides):
                a0, b0 = i * sides + k, i * sides + (k + 1) % sides
                a1, b1 = ((i + 1) % seg) * sides + (k + 1) % sides, ((i + 1) % seg) * sides + k
                faces.append((a0, b0, a1, b1))
        self.add('scarf', (verts, faces), M['scarf'], 'chest')
        drape = [Vector((0.03, -0.21, 0.23)), Vector((0.02, -0.235, 0.16)), Vector((0.0, -0.24, 0.1))]
        self.add('scarf_drape', cloth_strip(drape, lambda t: 0.2 * (1.0 - 0.75 * t ** 1.4), Vector((0.0, -1.0, 0.1)), 1.0, 0.01, 0.03, 8),
                 M['scarf_d'], 'chest')
        pts = []
        for i in range(15):
            t = i / 14
            side = 0.12 + 0.46 * t ** 0.9 * (1 - 0.3 * fly)
            down = 0.5 * t ** 1.35 * (1 - 0.5 * fly)
            back = 0.1 + 0.1 * t + 0.4 * t * fly
            wob = math.sin(t * 3.5 + wave) * (0.03 + 0.04 * fly) * t
            pts.append(Vector((-0.06 - side, back, 0.23 - down + wob)))
        # keep the cloth's broad side turned to the camera, whatever the body's twist
        cam = self.J('chest').to_3x3().inverted() @ Vector((0.0, -math.cos(rad(12)), math.sin(rad(12))))
        hint = (-cam.normalized() + Vector((0.0, 0.0, 0.25))).normalized()
        self.add('scarftail', cloth_strip(pts, lambda t: 0.22 + 0.1 * t, hint, 1.3, lambda t: 0.008 + 0.022 * t, 0.026, 10),
                 M['scarf'], 'chest')

    # --- flag -----------------------------------------------------------------------------------
    def flag(self, spec: dict):
        """The festival flag, its pole through the left fist: `tilt` leans the pole towards screen right
        (degrees), the banner flies towards screen right and a little back."""
        M = self.mat
        grip = self.J('wristL') @ Vector((0.0, -0.02, -0.12))
        tilt = rad(spec.get('tilt', 12.0))
        up = Vector((math.sin(tilt), 0.0, math.cos(tilt)))
        side = Vector((math.cos(tilt), 0.12, -math.sin(tilt))).normalized()
        nrm = side.cross(up).normalized()  # banner normal (towards the camera)
        lo, hi = spec.get('below', 0.55), spec.get('above', 1.2)
        self.add('pole', capsule(grip - up * lo, grip + up * hi, 0.03, 0.028, 12), M['wood'])
        top = grip + up * (hi + 0.05)
        self.add('finial', ellipsoid(0.045, 0.045, 0.05, 16, 10, center=tuple(top)), M['gold'])
        self.add('collar', capsule(grip + up * (hi - 0.14), grip + up * (hi - 0.1), 0.032, 0.032, 14), M['gold'])
        z0, z1, W = 0.46, hi - 0.12, 0.66
        wave = self.wave

        def P(u, v):
            base = grip + up * (z0 + (z1 - z0) * v) + side * (W * u)
            ripple = 0.05 * math.sin(u * 5.2 + 0.6 + wave) * u
            droop = -0.14 * u ** 1.5 * (1 - 0.6 * v) - 0.06 * u * v
            return base + nrm * ripple + up * droop

        def N(u, v):
            du = P(min(1, u + 0.01), v) - P(max(0, u - 0.01), v)
            dv = P(u, min(1, v + 0.01)) - P(u, max(0, v - 0.01))
            return du.cross(dv).normalized()

        # banner: a thin double-sided sheet
        nu, nv = 16, 8
        verts, faces = [], []
        for h in (0.008, -0.008):
            for j in range(nv + 1):
                for i in range(nu + 1):
                    u, v = i / nu, j / nv
                    verts.append(tuple(P(u, v) + N(u, v) * h))
        L = (nu + 1) * (nv + 1)
        for j in range(nv):
            for i in range(nu):
                a = j * (nu + 1) + i
                faces.append((a, a + 1, a + nu + 2, a + nu + 1))
                faces.append((L + a, L + a + nu + 1, L + a + nu + 2, L + a + 1))
        for i in range(nu):  # bottom and top rims
            for j in (0, nv):
                a = j * (nu + 1) + i
                faces.append((a, L + a, L + a + 1, a + 1) if j == 0 else (a, a + 1, L + a + 1, L + a))
        for j in range(nv):  # outer rim
            a = j * (nu + 1) + nu
            faces.append((a, a + nu + 1, L + a + nu + 1, L + a))
        self.add('banner', (verts, faces), M['banner'])
        # a rod along the banner's top edge with a gold ball at its end
        rod = [P(u / 8, 1.0) + up * 0.02 for u in range(9)]
        self.add('rod', sweep(rod, 0.014, 8), M['wood'])
        self.add('rod_ball', ellipsoid(0.034, 0.034, 0.034, 14, 8, center=tuple(rod[-1] + (rod[-1] - rod[-2]).normalized() * 0.02)), M['gold'])
        self.add('ring', capsule(grip + up * (z0 - 0.02), grip + up * (z0 + 0.02), 0.03, 0.03, 14), M['gold'])
        # the golden sun with a spiral centre, on both faces
        cu, cv = 0.52, 0.5
        H = z1 - z0

        def emb(s, t, h):
            u, v = cu + s / W, cv + t / H
            return P(u, v) + N(u, v) * h

        parts = []
        tri = [(0.1, -0.044), (0.195, 0.0), (0.1, 0.044)]
        for k in range(9):
            a = k / 9 * math.tau + 0.2
            ca, sa = math.cos(a), math.sin(a)
            vv = [(r_ * ca - w_ * sa, r_ * sa + w_ * ca, hh) for hh in (0.004, 0.011) for (r_, w_) in tri]
            parts.append((vv, [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]))
        dv, df = disc(0.09, 0.007, 30)
        parts.append(([(x, z, 0.0075 + y) for (x, y, z) in dv], df))
        sun_v, sun_f = merge(parts)
        spiral = []
        for i in range(50):
            t = i / 49
            a = t * 2.2 * math.tau
            spiral.append(Vector(((0.01 + 0.064 * t) * math.cos(a), (0.01 + 0.064 * t) * math.sin(a), 0.0)))
        sp_v, sp_f = sweep(spiral, 0.009, 6)
        for sgn in (1, -1):  # front and back faces (mirrored so the design reads the same way round)
            self.add('sun', ([tuple(emb(x_ * sgn, y_, h_ * sgn)) for (x_, y_, h_) in sun_v], sun_f), M['sun'])
            self.add('spiral', ([tuple(emb(x_ * sgn, y_, (0.013 + z_) * sgn)) for (x_, y_, z_) in sp_v], sp_f), M['sun_d'])


MODEL = Ora


# ------------------------------------------------------------------------------------------
# Poses (see char_anims.py for the conventions). Her left hand is on screen right.
POSES = {
    'idle': pose(root=dict(yaw=IDLE_YAW), head=(0, 0, 4),
                 armL=(18.4, 61.1, -9.9, 76.5), armR=(18.4, 61.1, -9.9, 76.5), wristL=(-32.6, 26.1, -81.4), wristR=(-32.6, -26.1, 81.4),
                 handL='clasp', handR='clasp',
                 legL=(0, 16, 0, 3), legR=(0, 16, 0, 3),
                 face=face('open', 'smile'), extra=dict(scarf=0.1, wave=0.4)),
    'wave': pose(root=dict(yaw=20.0), chest=(-3, 0, 4), head=(0, 0, 10),
                 armL=(117.1, 22.4, -0.0, 0.0), armR=(50.8, -27.1, -9.3, 121.8), wristL=(-2.7, -41.4, 9.9), wristR=(32.5, -63.6, -5.3),
                 handL='open', handR='fist',
                 legL=(12, 28, 0, 10), legR=(-6, 15, 0, 6), footL=(0, 0, 8),
                 face=face('open', 'grin'), extra=dict(scarf=0.2, wave=1.0)),
    'welcome': pose(root=dict(yaw=IDLE_YAW), chest=(-6, 0, 0), head=(6, 0, 4),
                    armL=(111.5, -6.1, -0.0, 37.0), armR=(99.9, -12.3, -0.0, 63.6), wristL=(30.8, -11.3, 43.6), wristR=(34.5, 27.8, -43.0),
                    handL='open', handR='open',
                    legL=(18, 28, 0, 18), legR=(-4, 15, 0, 4), footL=(-18, 0, 10),
                    face=face('happy', 'laugh'), extra=dict(scarf=0.25, wave=2.0)),
    'point': pose(root=dict(yaw=26.0), chest=(-3, 0, -2), head=(0, -4, 10),
                  armL=(118.9, 16.4, -0.0, 0.0), armR=(78.4, -32.3, 0.0, 92.8), wristL=(-9.8, 17.1, -19.3), wristR=(24.2, 43.3, -49.7),
                  handL='point', handR='open',
                  legL=(12, 19, 0, 10), legR=(-8, 17, 0, 8),
                  face=face('open', 'grin'), extra=dict(scarf=0.3, wave=2.6)),
    'flag': pose(root=dict(yaw=32.0, lean=7.0), chest=(2, 0, 18), head=(-6, 0, -12),
                 armL=(127.6, 38.3, 0.1, 89.9), armR=(55.6, 152.8, 0.0, 61.8), wristL=(-21.8, -6.4, 48.4), wristR=(-5.5, -9.5, 147.4),
                 handL='fist', handR='fist',
                 legL=(40, 10, 0, 20), legR=(-32, 9, 0, 30), footL=(-18, 0, 6), footR=(18, 0, 0), rise=0.03,
                 face=face('open', 'grin'), extra=dict(scarf=0.5, wave=3.2, flag=dict(tilt=12.0))),
    'cheer': pose(root=dict(yaw=IDLE_YAW), chest=(4, 0, 2), head=(-6, -12, 10),
                  armL=(81.3, 68.3, -0.0, 77.0), armR=(90.0, 97.5, -0.0, 53.0), wristL=(58.1, -37.0, -69.5), wristR=(49.9, 52.5, 45.3),
                  handL='open', handR='open',
                  legL=(4, 7, 0, 14), legR=(4, 7, 0, 14),
                  face=face('happy', 'laugh'), extra=dict(scarf=0.15, wave=4.0)),
}
