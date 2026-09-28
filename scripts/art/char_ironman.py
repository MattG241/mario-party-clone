"""Iron Man: a fan-made chibi version for a private, non-commercial party game, built on the shared Hero
structure (see char_models.py for the base class and Kip, the reference humanoid).

He is chunky armour rather than a person in red: glossy candy-red plates with gold accents (the
faceplate, upper arms, forearm bands, thighs and an inner-shin stripe), dark gunmetal joints between the
plates, ball pauldrons, flared gauntlets and big boots. The rounded-box helmet (HelmetShape: a
superellipsoid with a narrowing jaw) carries a gold faceplate shell whose two
glowing white-cyan eye slits do all the acting (there is no mouth): they narrow for 'determined', arch
for 'happy', grow taller for 'wide', droop for 'sad', become spirals when dizzy, and the brows tilt
them. A glowing arc reactor sits in the chest and the palm repulsors light up whenever a hand is open.
Plate seams are dark grooves (faceplate outline, cheeks, helmet crest, sternum, spine, pauldrons,
abdomen) plus the gaps between the parts.
"""
from __future__ import annotations

import math

from mathutils import Vector

import lib
from lib import col
from char_rig import HeadShape, R, T, disc, ellipsoid, superellipsoid, sweep, torus
from char_models import DEFAULT_FACE, Hero, hand_mitten


# ------------------------------------------------------------------------------------------
# Helpers
def sstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def interp(points, x: float) -> float:
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            f = (x - x0) / (x1 - x0) if x1 > x0 else 0.0
            return y0 + (y1 - y0) * sstep(f)
    return points[-1][1]


def shell_patch(hs: HeadShape, halfw, p_lo: float, p_hi: float, lift_out: float, lift_in: float, rows: int = 30, cols: int = 26):
    """A curved plate over the front of `hs`: pitch p_lo..p_hi (degrees), yaw within +-halfw(pitch), with an
    outer face lifted `lift_out` and an inner face at `lift_in`, joined by a rim. Also returns the outline
    (outer-face boundary points) for a seam."""
    verts, faces, grid = [], [], {}
    for layer, lift in ((0, lift_out), (1, lift_in)):
        for i in range(rows + 1):
            p = p_lo + (p_hi - p_lo) * i / rows
            w = halfw(p)
            for j in range(cols + 1):
                u = -1.0 + 2.0 * j / cols
                grid[(layer, i, j)] = len(verts)
                verts.append(tuple(hs.point(u * w, p, lift)[0]))
    for i in range(rows):
        for j in range(cols):
            o = [grid[(0, a, b)] for a, b in ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))]
            faces.append(tuple(o))
            n = [grid[(1, a, b)] for a, b in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))]
            faces.append(tuple(n))
    loop = [(0, j) for j in range(cols + 1)] + [(i, cols) for i in range(1, rows + 1)] + \
           [(rows, j) for j in range(cols - 1, -1, -1)] + [(i, 0) for i in range(rows - 1, 0, -1)]
    for k in range(len(loop)):
        (i0, j0), (i1, j1) = loop[k], loop[(k + 1) % len(loop)]
        faces.append((grid[(0, i0, j0)], grid[(1, i0, j0)], grid[(1, i1, j1)], grid[(0, i1, j1)]))
    outline = [Vector(verts[grid[(0, i, j)]]) for i, j in loop]
    return (verts, faces), outline


def slab(outline, y0: float, y1: float):
    """A thin prism from a convex outline [(x, z), ...] (counter-clockwise seen from the front, -Y):
    front face at depth y0, back face at y1."""
    n = len(outline)
    cx = sum(p[0] for p in outline) / n
    cz = sum(p[1] for p in outline) / n
    verts = [(x, y0, z) for x, z in outline] + [(x, y1, z) for x, z in outline] + [(cx, y0, cz), (cx, y1, cz)]
    cf, cb = 2 * n, 2 * n + 1
    faces = []
    for k in range(n):
        k2 = (k + 1) % n
        faces.append((k, cf, k2))
        faces.append((n + k, n + k2, cb))
        faces.append((k, k2, n + k2, n + k))
    return verts, faces


def spiral_pts(r0: float, r1: float, turns: float, n: int = 40, y: float = 0.0, cw: bool = False):
    out = []
    for i in range(n + 1):
        t = i / n
        a = (-1 if cw else 1) * t * turns * math.tau
        r = r0 + (r1 - r0) * t
        out.append(Vector((math.cos(a) * r, y, math.sin(a) * r)))
    return out


class HelmetShape(HeadShape):
    """A rounded-box helmet (superellipsoid of exponent p) whose jaw narrows towards the chin. point() /
    surface() / conform() follow this surface, so the faceplate and the eye slits hug it."""

    def __init__(self, rx, ry, rz, center, p=2.6, jaw=0.14, lift=0.0):
        super().__init__(rx, ry, rz, center)
        self.p, self.jaw, self.lift = p, jaw, lift

    def surf(self, d: Vector) -> Vector:
        d = d.normalized()
        r, p = self.r, self.p
        k = (abs(d.x / r.x) ** p + abs(d.y / r.y) ** p + abs(d.z / r.z) ** p) ** (-1.0 / p)
        q = d * k
        low = max(0.0, -q.z / r.z)
        q = Vector((q.x * (1.0 - self.jaw * low ** 1.5), q.y - 0.03 * low ** 2, q.z))
        # a uniform offset along the outward direction (shells over the helmet)
        return self.c + q + d * self.lift

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
        return n if n.dot(d) > 0 else -n

    def point(self, yaw: float, pitch: float, lift: float = 0.0):
        y_, p_ = math.radians(yaw), math.radians(pitch)
        d = Vector((math.sin(y_) * math.cos(p_), -math.cos(y_) * math.cos(p_), math.sin(p_)))
        n = self.normal_at(d)
        return self.surf(d) + n * lift, n

    def surface(self, d: Vector):
        return self.surf(d), self.normal_at(d)

    def mesh(self, seg: int = 48, rings: int = 32):
        verts, faces = ellipsoid(1.0, 1.0, 1.0, seg, rings)
        return [tuple(self.surf(Vector(v))) for v in verts], faces


PALM = -1.0  # the palm faces the wrist frame's -Y


# ------------------------------------------------------------------------------------------
class Ironman(Hero):
    """Iron Man: candy-red and gold armour, gold faceplate with glowing eye slits, arc reactor, repulsors."""

    key = 'ironman'
    ankle_h = 0.17
    hip_h = 0.64
    spine = 0.09
    chest = 0.2
    neck = 0.12
    head_up = 0.05
    shoulder = (0.25, 0.0, 0.1)
    upper_arm = 0.2
    forearm = 0.19
    hip_w = 0.12
    thigh = 0.21
    shin = 0.22
    sit_h = 0.19

    C = dict(red='#c4161f', red_d='#7a0c14', gold='#f2c455', gunmetal='#3a3e46', glow='#e4fbff', core='#d8fbff', ring='#79e2ff',
             seam='#2a1416', sole='#2c2e33')

    HEAD = (0.35, 0.34, 0.4, 0.41)  # rx, ry, rz, centre height above the head joint
    EYE = (19.0, 1.0)  # eye slit yaw / pitch on the faceplate

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.1

    # --- materials ------------------------------------------------------------------------------
    def paint(self, name: str, color: str, metal: float = 0.5, rough: float = 0.26):
        """Candy-apple armour paint: a metallic base under a glossy clear coat."""
        def make(n):
            m = lib.NT(n)
            b = m.bsdf(col(color), rough, coat=1.0, spec=0.5)
            b.inputs['Metallic'].default_value = metal
            b.inputs['Coat Roughness'].default_value = 0.08
            return m.mat
        return self.m.get(name, make)

    def glow_alpha(self, name: str, color: str, strength: float, alpha: float):
        def make(n):
            m = lib.NT(n)
            m.bsdf(col(color), 0.5, emission=col(color), emission_strength=strength, alpha=alpha)
            return m.mat
        return self.m.get(name, make)

    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            red=self.paint('im_red', c['red']),
            red_d=self.paint('im_red_d', c['red_d'], 0.4, 0.35),
            gold=self.paint('im_gold', c['gold'], 0.72, 0.3),
            gun=mt.metal('im_gunmetal', c['gunmetal'], 0.38),
            seam=mt.glossy('im_seam', c['seam'], 0.5, 0.2),
            sole=mt.cloth('im_sole', c['sole'], 0.6, 0.1),
            glow=mt.emit('im_glow', c['glow'], 6.0),
            glow_dim=mt.emit('im_glow_dim', c['glow'], 2.2),
            core=mt.emit('im_core', c['core'], 3.2),
            ring=mt.emit('im_ring', c['ring'], 2.6),
            halo=self.glow_alpha('im_halo', c['ring'], 1.4, 0.18),
        )
        self.torso()
        self.legs()
        self.arms()
        self.helmet()

    # --- torso ----------------------------------------------------------------------------------
    def torso(self):
        mm = self.mat
        # chest plate and pectoral plates (chest frame)
        self.add('chest', superellipsoid(0.24, 0.185, 0.17, 2.8, 36, 20, center=(0, 0.005, 0.015)), mm['red'], 'chest')
        for sd in (1, -1):
            self.add('pec', superellipsoid(0.098, 0.05, 0.072, 3.0, 22, 12, center=(0, 0, 0)), mm['red'], 'chest',
                     T(0.098 * sd, -0.142, 0.055) @ R(-8, 0, 10 * sd))
        # dark red collar ring round the gunmetal neck
        self.add('gorget', torus(0.12, 0.028, 32, 8, center=(0, 0.01, 0.18)), mm['red_d'], 'chest')
        self.add('neck', sweep([Vector((0, 0.01, 0.12)), Vector((0, 0.01, 0.3))], 0.085, 18), mm['gun'], 'chest')
        # arc reactor: gunmetal housing, glowing ring and core, soft halo
        rm = T(0, -0.188, -0.03)
        self.add('reactor_house', disc(0.066, 0.03, 32), mm['gun'], 'chest', rm)
        self.add('reactor_ring', torus(0.05, 0.011, 32, 8), mm['ring'], 'chest', rm @ T(0, -0.016, 0) @ R(90, 0, 0))
        self.add('reactor_core', ellipsoid(0.032, 0.014, 0.032, 18, 8, center=(0, -0.016, 0)), mm['core'], 'chest', rm)
        self.add('reactor_halo', disc(0.068, 0.004, 32), mm['halo'], 'chest', rm @ T(0, -0.026, 0))
        # seam up the sternum from the reactor
        self.add('seam_st', sweep([Vector((0, -0.187, 0.03)), Vector((0, -0.18, 0.16))], 0.0055, 6), mm['seam'], 'chest')
        # back: a seam down the spine and two shoulder-blade plates
        def back_y(x, z):
            u = min(1.0, abs(x / 0.24) ** 2.8 + abs((z - 0.015) / 0.17) ** 2.8)
            return 0.005 + 0.185 * (1.0 - u) ** (1 / 2.8)
        self.add('seam_back', sweep([Vector((0.0, back_y(0.0, z) + 0.002, z)) for z in (0.15, 0.1, 0.05, 0.0, -0.05, -0.1, -0.13)], 0.005, 6),
                 mm['seam'], 'chest')
        for sd in (1, -1):
            self.add('blade', superellipsoid(0.085, 0.03, 0.078, 2.8, 18, 10), mm['red'], 'chest',
                     T(0.105 * sd, back_y(0.105, 0.06) - 0.004, 0.06) @ R(8, 0, -10 * sd))
        # abdomen: a red band with a groove down the middle (spine frame)
        self.add('abdomen', superellipsoid(0.212, 0.166, 0.1, 2.7, 32, 14, center=(0, 0.01, -0.07)), mm['red'], 'spine')
        self.add('seam_abv', sweep([Vector((0, -0.172, -0.0)), Vector((0, -0.174, -0.14))], 0.0042, 6), mm['red_d'], 'spine')
        # belt and pelvis (hips frame)
        self.add('belt', torus(0.19, 0.014, 36, 8, center=(0, 0.01, 0.025)), mm['red_d'], 'hips', _sy(0.84))
        self.add('pelvis', superellipsoid(0.2, 0.162, 0.14, 2.5, 32, 16, center=(0, 0.01, -0.06)), mm['red'], 'hips')

    # --- legs -----------------------------------------------------------------------------------
    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('thigh' + s_, hip, kn, an, lambda t: 0.118 - 0.012 * t, mm['gold'], 0.0, 0.45, 18, 10, cap0=True, cap1=False)
            self.limb('kneej' + s_, hip, kn, an, 0.094, mm['gun'], 0.42, 0.54, 16, 4, cap0=False, cap1=False)
            self.limb('shin' + s_, hip, kn, an, lambda t: 0.098 + 0.022 * t, mm['red'], 0.52, 0.93, 18, 10, cap0=False, cap1=False)
            km = self.J(kn)
            self.add('kneecap' + s_, superellipsoid(0.074, 0.044, 0.078, 2.6, 16, 10), mm['red'], None, km @ T(0, 0.082, 0.01) @ R(8, 0, 0))
            # gold stripe down the inside of the shin
            fr = self.limb_frame(hip, kn, an, 0.72, kn)
            self.add('shinstripe' + s_, superellipsoid(0.02, 0.05, 0.1, 2.6, 12, 10), mm['gold'], None, fr @ T(-0.1 * sd, 0.0, 0.0))
            # boots
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('boot' + s_, superellipsoid(0.138, 0.2, 0.108, 2.7, 24, 14, center=(0, -0.05, -0.058)), mm['red'], None, fm)
            self.add('bootcuff' + s_, torus(0.112, 0.028, 24, 8, center=(0, 0.0, 0.025)), mm['red_d'], None, fm)
            self.add('toecap' + s_, superellipsoid(0.108, 0.075, 0.064, 2.6, 18, 10, center=(0, -0.18, -0.068)), mm['red'], None, fm)
            self.add('sole' + s_, superellipsoid(0.144, 0.222, 0.032, 3.0, 24, 8, center=(0, -0.06, -0.14)), mm['sole'], None, fm)

    # --- arms -----------------------------------------------------------------------------------
    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            sp = self.skel.offset[sh]
            # ball pauldron with a seam ring
            pm = T(sp.x + 0.015 * sd, sp.y, sp.z + 0.01)
            self.add('pauldron' + s_, superellipsoid(0.138, 0.13, 0.126, 2.3, 26, 16), mm['red'], 'chest', pm)
            self.add('pseam' + s_, torus(0.136, 0.007, 32, 6), mm['seam'], 'chest', pm @ R(0, 90 * sd, 0))
            self.limb('upper' + s_, sh, el, wr, lambda t: 0.084 - 0.004 * t, mm['gold'], 0.0, 0.46, 16, 10, cap0=True, cap1=False)
            self.limb('elbowj' + s_, sh, el, wr, 0.072, mm['gun'], 0.42, 0.56, 14, 4, cap0=False, cap1=False)
            self.limb('fore' + s_, sh, el, wr, lambda t: 0.086 + 0.026 * t ** 1.5, mm['red'], 0.53, 0.96, 16, 10, cap0=False, cap1=False)
            self.limb('forecuff' + s_, sh, el, wr, 0.092, mm['red_d'], 0.51, 0.58, 16, 3, cap0=False, cap1=False)
            self.limb('foreband' + s_, sh, el, wr, lambda t: 0.1 + 0.012 * t, mm['gold'], 0.74, 0.84, 16, 3, cap0=False, cap1=False)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.4):
                self.add('hand' + nm + s_, mesh, mm['red'], None, wm)
            self.add('knuckle' + s_, superellipsoid(0.075, 0.03, 0.03, 2.6, 16, 8, center=(0, -0.058, -0.11 if hand == 'fist' else -0.13)),
                     mm['gun'], None, wm)
            self.add('wristj' + s_, torus(0.07, 0.016, 18, 6, center=(0, 0, -0.012)), mm['gun'], None, wm)
            if hand == 'open':
                # palm repulsor (the palm faces PALM * Y in the wrist frame)
                self.add('repulsor' + s_, disc(0.036, 0.014, 24), mm['core'], None, wm @ T(0, PALM * 0.074, -0.09))
                self.add('repring' + s_, torus(0.042, 0.009, 24, 6), mm['ring'], None, wm @ T(0, PALM * 0.07, -0.09) @ R(90, 0, 0))
                self.add('rephalo' + s_, disc(0.058, 0.004, 24), mm['halo'], None, wm @ T(0, PALM * 0.084, -0.09))

    # --- helmet ---------------------------------------------------------------------------------
    @staticmethod
    def plate_halfw(p: float) -> float:
        """Half width (yaw degrees) of the gold faceplate at a pitch."""
        return interp([(-66, 15.0), (-60, 21.0), (-46, 25.0), (-30, 27.0), (-18, 30.0), (-10, 41.0), (4, 46.0), (22, 46.0), (36, 43.0),
                       (44, 36.0), (47, 24.0), (48, 12.0)], p)

    def helmet(self):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        hs = HelmetShape(hx, hy, hz, (0, 0, hc))
        self.add('helmet', hs.mesh(), mm['red'], 'head')
        # ear discs
        for sd in (1, -1):
            pos, n = hs.point(90 * sd, -4, -0.004)
            em = T(*pos) @ R(0, 0, 90 * sd)
            self.add('ear', disc(0.075, 0.03, 28), mm['red'], 'head', em)
            self.add('earring', torus(0.075, 0.009, 28, 6), mm['seam'], 'head', em @ R(90, 0, 0))
            self.add('earcap', disc(0.045, 0.042, 24), mm['red_d'], 'head', em)
        # the gold faceplate shell with a dark seam round it
        plate, outline = shell_patch(hs, self.plate_halfw, -66.0, 48.0, 0.014, -0.02)
        self.add('faceplate', plate, mm['gold'], 'head')
        self.add('plateseam', sweep(outline + [outline[0]], 0.006, 6, cap0=False, cap1=False), mm['seam'], 'head')
        # cheek seams running down from the eyes to the chin
        for sd in (1, -1):
            pts = [hs.point(sd * interp([(-12, 31.0), (-40, 21.0), (-60, 15.0)], p), p, 0.016)[0] for p in (-12, -20, -30, -40, -50, -60)]
            self.add('cheekseam', sweep(pts, 0.0048, 6), mm['seam'], 'head')
        crest = [hs.point(0.0, p, 0.003)[0] for p in range(49, 91, 6)] + [hs.point(180.0, p, 0.003)[0] for p in range(88, -31, -8)]
        self.add('crestseam', sweep(crest, 0.005, 6), mm['seam'], 'head')
        fs = HelmetShape(hx, hy, hz, (0, 0, hc), lift=0.014)
        self.visor_eyes(fs)

    def visor_eyes(self, fs: HeadShape):
        """The glowing eye slits act out the face states (no mouth)."""
        mm = self.mat
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        eyes, brows = f['eyes'], f['brows']
        ey, ep = self.EYE
        hw = 0.06
        for side in (1, -1):
            kind = eyes
            if eyes == 'wink':
                kind = 'open' if side > 0 else 'happy'
            fr = fs.frame(ey * side, ep, 0.0)
            nm = 'L' if side > 0 else 'R'
            if kind == 'happy':
                pts = [Vector((side * hw * 0.95 * u, -0.004, 0.006 - 0.03 * u * u)) for u in [-1 + 2 * i / 12 for i in range(13)]]
                self.feat('eye' + nm, sweep(pts, 0.0115, 8), mm['glow'], 'head', fs, fr)
                continue
            if kind == 'closed':
                pts = [Vector((side * hw * 0.9 * u, -0.004, -0.006 + 0.012 * u * u)) for u in [-1 + 2 * i / 12 for i in range(13)]]
                self.feat('eye' + nm, sweep(pts, 0.0065, 6), mm['glow_dim'], 'head', fs, fr)
                continue
            if kind == 'dizzy':
                self.feat('eye' + nm, sweep(spiral_pts(0.004, 0.046, 1.6, 44, -0.007, side < 0), 0.0068, 6), mm['glow'], 'head', fs, fr)
                continue
            # slit outline: top and bottom edges from the inner end (u = -1) to the outer end (u = 1)
            top_in, top_out, bot_in, bot_out, w = {
                'open': (0.011, 0.024, -0.013, -0.016, hw),
                'determined': (-0.002, 0.014, -0.011, -0.012, hw),
                'half': (0.0, 0.008, -0.013, -0.016, hw),
                'wide': (0.03, 0.036, -0.03, -0.03, hw * 0.92),
                'sad': (0.022, 0.004, -0.012, -0.02, hw),
            }.get(kind, (0.011, 0.024, -0.013, -0.016, hw))
            tilt = {'angry': -0.012, 'determined': -0.008, 'worried': 0.012, 'sad': 0.01, 'up': 0.0}.get(brows, 0.0)
            lift_top = 0.006 if brows == 'up' else 0.0
            top_in += tilt + lift_top
            top_out += -tilt * 0.4 + lift_top
            rounded = kind == 'wide'
            outline = []
            N = 10
            for i in range(N + 1):  # bottom edge, inner -> outer
                u = -1 + 2 * i / N
                z = bot_in + (bot_out - bot_in) * (u + 1) / 2
                if rounded:
                    z *= math.sqrt(max(0.0, 1 - u ** 4)) ** 0.5
                outline.append((u, z))
            for i in range(N + 1):  # top edge, outer -> inner
                u = 1 - 2 * i / N
                z = top_in + (top_out - top_in) * (u + 1) / 2
                if rounded:
                    z *= math.sqrt(max(0.0, 1 - u ** 4)) ** 0.5
                outline.append((u, z))
            pts = [(side * u * w, z) for u, z in outline]
            if side < 0:
                pts.reverse()
            self.feat('eye' + nm, slab(pts, -0.005, 0.006), mm['glow'], 'head', fs, fr)


def _sy(k: float):
    m = R(0, 0, 0)
    m[1][1] = k
    return m
