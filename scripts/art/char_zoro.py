"""Zoro: a fan-made chibi Roronoa Zoro (One Piece) for the private party build (loaded by characters.py as
class `Zoro`).

Built on the shared Hero structure (char_models.py) with Kip's chibi head on a broader, stronger body:
short spiky moss-green hair, his left eye kept shut with a vertical scar running through it (the right eye
open and sharp under a slight lid), thick stern brows, three small gold drop earrings in his left ear and
a cool, confident smirk as his resting face; a white short-sleeved shirt, a ribbed green haramaki round
his belly, black trousers tucked into black boots, a black bandana tied round his left upper arm (its
ends flutter with pose['extra']['scarf'] / 'wave' like Kip's scarf) and his three katanas worn at his
left hip in their scabbards: Wado Ichimonji (white hilt), Sandai Kitetsu (red hilt) and Shusui (black
hilt). The swords swing up out of the ground when he sits or crouches.

The face goes through Hero.face()'s expression states; `face()` below is a copy of it with his shut,
scarred left eye, a lidded right eye, angled brows and a lopsided smirk for the resting 'smile'.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import (HeadShape, R, T, arc_points, cloth_strip, curve3, disc, ellipsoid, flat_sweep, polyline_segment, superellipsoid,
                      sweep, torus)
from char_models import DEFAULT_FACE, Hero, hair_shell, hand_mitten, periodic_interp


# ------------------------------------------------------------------------------------------
# Small helpers (local copies so this module only depends on the shared files as they are)
def clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return max(a, min(b, x))


def sstep(x: float) -> float:
    x = clamp(x)
    return x * x * (3.0 - 2.0 * x)


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


def garment(z0: float, ztop, rad, sides: int = 36, rows: int = 14, squash: float = 0.8, thick: float = 0.016):
    """A tube with thickness around Z from z0 up to a top edge ztop(angle) (angle in radians, 0 = +X,
    -pi/2 = the front), radius rad(z)."""
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


def ring_band(rx, ry, prof, seg=64):
    """A closed band around Z following an ellipse (rx, ry); `prof` is a closed cross-section
    [(dr, z), ...] (outer side bottom to top, then back down the inside)."""
    verts, faces = [], []
    n = len(prof)
    for i in range(seg):
        a = i / seg * math.tau
        ca, sa = math.cos(a), math.sin(a)
        for dr, z in prof:
            verts.append((ca * (rx + dr), sa * (ry + dr), z))
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(n):
            j2 = (j + 1) % n
            faces.append((i * n + j, i2 * n + j, i2 * n + j2, i * n + j2))
    return verts, faces


def frame_along(d: Vector, up_hint: Vector = Vector((0.0, 0.0, 1.0))) -> Matrix:
    """A rotation whose +Y runs along d and whose +Z leans towards up_hint."""
    y = d.normalized()
    z = up_hint - y * up_hint.dot(y)
    if z.length < 1e-4:
        z = Vector((1.0, 0.0, 0.0)) - y * y.x
    z.normalize()
    x = y.cross(z).normalized()
    return Matrix((x, y, z)).transposed().to_4x4()


# ------------------------------------------------------------------------------------------
class Zoro(Hero):
    """Zoro: short spiky green hair, scarred shut left eye, white shirt, green haramaki, three katanas."""

    key = 'zoro'
    ankle_h = 0.15
    hip_h = 0.66  # ankle_h + 0.04 + thigh + shin
    spine = 0.08
    chest = 0.2
    neck = 0.14
    head_up = 0.04
    shoulder = (0.24, 0.0, 0.11)
    upper_arm = 0.22
    forearm = 0.2
    hip_w = 0.115
    thigh = 0.23
    shin = 0.24
    sit_h = 0.18

    C = dict(skin='#eab286', skin_d='#cf8e62', hair_d='#2b5a2a', hair_l='#7fb65c', shirt='#f4f3ee', shirt_d='#d9d7cd',
             hara='#2f7d38', hara_d='#20592a', pants='#26282f', boot='#1a1b20', sole='#3d3e45', band='#1c1d22', gold='#f2bf45',
             scar='#a34d3c', iris='#2e2823', brow='#23481f', lash='#16120f',
             wado='#f5f3ea', wado_d='#c9c5b8', kitetsu='#c4262d', kitetsu_d='#7d1419', shusui='#23232a', shusui_d='#5a1a22',
             saya_w='#f2efe6', saya_r='#8a1c25', saya_b='#1b1b21', tsuba='#d9a63a')

    HEAD = (0.4, 0.375, 0.39, 0.41)  # rx, ry, rz, centre height above the head joint
    EYE = (23.0, -6.0)

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.16

    # --- materials ------------------------------------------------------------------------------
    def rib_mat(self, name: str, base: str, dark: str):
        """Knitted belly wrap: vertical ribs round the body (object space, the part lives in the spine frame)."""
        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            sp = m.sep(obj)
            ang = m.math('ARCTAN2', sp[1], sp[0])
            rib = m.math('SINE', m.math('MULTIPLY', ang, 44.0))
            f = m.maprange(rib, -0.6, 0.9)
            colr = m.mix(f, col(dark), col(base))
            nz = m.noise(80.0, 3, 0.6, obj).outputs['Fac']
            h = m.math('ADD', m.math('MULTIPLY', f, 0.7), m.math('MULTIPLY', nz, 0.3))
            m.bsdf(colr, 0.8, normal=m.bump(h, 0.28, 0.02), sheen=0.5, spec=0.25)
            return m.mat
        return self.m.get(name, make)

    def black_mat(self, name: str, color: str, rough: float):
        """Blue-black with a cool rim, so the black parts keep their form under the warm key light."""
        def make(n):
            m = lib.NT(n)
            lw = m.node('ShaderNodeLayerWeight')
            lw.inputs['Blend'].default_value = 0.35
            rim = m.maprange(lw.outputs['Facing'], 0.5, 1.0)
            cc = m.mix(m.math('MULTIPLY', rim, 0.5), col(color), col('#3f4760'))
            m.bsdf(cc, rough, sheen=0.45, coat=0.2, spec=0.4)
            return m.mat
        return self.m.get(name, make)

    # --- building -------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('zoro_skin', c['skin']),
            skin_d=mt.skin('zoro_skin_d', c['skin_d']),
            shirt=mt.cloth('zoro_shirt', c['shirt'], 0.76, 0.35, 0.07),
            shirt_d=mt.cloth('zoro_shirt_d', c['shirt_d'], 0.76, 0.3),
            hara=self.rib_mat('zoro_hara', c['hara'], c['hara_d']),
            hara_d=mt.cloth('zoro_hara_d', c['hara_d'], 0.8, 0.4, 0.1),
            pants=self.black_mat('zoro_pants', c['pants'], 0.7),
            boot=self.black_mat('zoro_boot', c['boot'], 0.42),
            sole=mt.cloth('zoro_sole', c['sole'], 0.6, 0.1),
            band=self.black_mat('zoro_band', c['band'], 0.62),
            gold=mt.metal('zoro_gold', c['gold'], 0.22),
            tsuba=mt.metal('zoro_tsuba', c['tsuba'], 0.3),
            scar=mt.glossy('zoro_scar', c['scar'], 0.5, 0.15),
            hair=mt.hair('zoro_hair', c['hair_d'], c['hair_l'], 0.44),
            wado=mt.banded('zoro_wado', c['wado'], c['wado_d'], 7.0, 0.55, 0.3),
            kitetsu=mt.banded('zoro_kitetsu', c['kitetsu'], c['kitetsu_d'], 7.0, 0.5, 0.3),
            shusui=mt.banded('zoro_shusui', c['shusui'], c['shusui_d'], 7.0, 0.5, 0.3),
            saya_w=mt.glossy('zoro_saya_w', c['saya_w'], 0.28, 0.6),
            saya_r=mt.glossy('zoro_saya_r', c['saya_r'], 0.28, 0.6),
            saya_b=mt.glossy('zoro_saya_b', c['saya_b'], 0.25, 0.7),
            fitting=self.black_mat('zoro_fitting', '#202127', 0.35),
        )
        self.torso()
        self.legs()
        self.arms()
        self.head_parts()
        self.swords()

    @staticmethod
    def rb(z):
        """Torso half-width at chest-frame height z (a strong, slightly V-shaped chest)."""
        t = (z + 0.37) / 0.49
        return 0.226 + 0.02 * math.sin(math.pi * clamp(t) * 0.85)

    def torso(self):
        mm = self.mat
        rb = self.rb
        # the white shirt: a plain crew neck, tucked under the haramaki
        def shirt_r(z):
            r = rb(z) + 0.004
            return r - (r - 0.2) * sstep((-0.2 - z) / 0.08)

        self.add('shirt', sweep([Vector((0, 0, -0.3 + 0.4 * i / 14)) for i in range(15)], lambda t: shirt_r(-0.3 + 0.4 * t), 36, cap0=False,
                                cap1=False, squash=0.8), mm['shirt'], 'chest')
        self.add('shoulders', ellipsoid(rb(0.12) + 0.004, (rb(0.12) + 0.004) * 0.8, 0.092, 30, 12, center=(0, 0, 0.1), zmin=-0.3), mm['shirt'],
                 'chest')
        self.add('collar', torus(0.098, 0.02, 32, 8, center=(0, 0.014, 0.176)), mm['shirt_d'], 'chest', _sy(0.9))
        # neck
        a = self.J('chest') @ Vector((0.0, 0.0, 0.1))
        b = self.J('neck') @ Vector((0.0, 0.0, 0.03))
        cc = self.J('head') @ Vector((0.0, 0.01, 0.12))
        self.add('neck', sweep(curve3(a, b, cc, 6), 0.075, 14), mm['skin'])
        # haramaki: a thick ribbed wrap round the belly, rolled at both edges (spine frame)
        HX, HY = 0.248, 0.206
        prof = [(0.0, -0.13), (0.006, -0.06), (0.008, 0.0), (0.006, 0.06), (0.0, 0.11), (-0.03, 0.11), (-0.03, -0.13)]
        self.add('haramaki', ring_band(HX, HY, prof, 72), mm['hara'], 'spine')
        for z in (-0.126, 0.106):
            self.add('hararim', torus(HX + 0.002, 0.016, 60, 8, center=(0, 0, z)), mm['hara_d'], 'spine', _sy(HY / HX))
        # trousers: the seat (hips frame)
        self.add('pelvis', superellipsoid(0.215, 0.18, 0.15, 2.4, 28, 16, center=(0, 0, -0.04)), mm['pants'], 'hips')

    def limb_pts(self, a, b, c, t0, t1, n=8):
        return polyline_segment(curve3(self.P(a), self.P(b), self.P(c), 24), t0, t1, n)

    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'

            def pant_r(t):  # a little baggy, gathered where they tuck into the boot
                return 0.12 + 0.016 * math.sin(math.pi * clamp(t / 0.8)) - 0.02 * sstep((t - 0.62) / 0.14)
            self.limb('pants' + s_, hip, kn, an, pant_r, mm['pants'], 0.0, 0.74, 18, 14, cap0=True, cap1=True)
            # boot shaft with a folded top edge
            self.limb('shaft' + s_, hip, kn, an, lambda t: 0.09 + 0.006 * t, mm['boot'], 0.64, 1.0, 16, 6, cap0=False, cap1=True)
            self.limb('rim' + s_, hip, kn, an, 0.1, mm['boot'], 0.64, 0.7, 16, 2, cap0=True, cap1=True)
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('boot' + s_, superellipsoid(0.12, 0.174, 0.1, 2.6, 22, 14, center=(0, -0.05, -0.05)), mm['boot'], None, fm)
            self.add('toe' + s_, ellipsoid(0.11, 0.094, 0.072, 18, 10, center=(0, -0.152, -0.08)), mm['boot'], None, fm)
            self.add('sole' + s_, superellipsoid(0.128, 0.196, 0.032, 3.0, 22, 8, center=(0, -0.058, -0.12)), mm['sole'], None, fm)

    def arms(self):
        mm = self.mat
        ex = self.pose.get('extra', {})
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, self.arm_r, mm['skin'], 0.0, 1.0, 14, 16, extend=0.02)
            # short white sleeve with a turned hem
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.096 - 0.01 * t, mm['shirt'], 0.0, 0.3, 16, 5, cap0=True, cap1=False)
            self.limb('hem' + s_, sh, el, wr, 0.093, mm['shirt_d'], 0.27, 0.32, 16, 2, cap0=True, cap1=True)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.26):
                self.add('hand' + nm + s_, mesh, mm['skin'], None, wm)
            if sd > 0:
                self.bandana(sh, el, wr, ex)

    @staticmethod
    def arm_r(t):
        return 0.064 - 0.012 * t + 0.01 * math.sin(math.pi * clamp(t / 0.5))

    def bandana(self, sh, el, wr, ex):
        """The black bandana tied round his left upper arm: a band, a knot on the outside, two short ends."""
        mm = self.mat
        t0, t1 = 0.35, 0.45
        self.limb('bandana', sh, el, wr, lambda t: self.arm_r(t0 + (t1 - t0) * t) + 0.012, mm['band'], t0, t1, 16, 3, cap0=True, cap1=True)
        fr = self.limb_frame(sh, el, wr, (t0 + t1) / 2, sh)
        xl, yl, zl = (fr.col[i].to_3d().normalized() for i in range(3))
        c = fr.to_translation()
        r = self.arm_r((t0 + t1) / 2) + 0.018
        # the knot sits on the outside of the arm, turned a little towards the front
        ang = 0.5
        out = (xl * math.cos(ang) - yl * math.sin(ang)).normalized()
        kp = c + out * r
        self.add('knot', ellipsoid(0.03, 0.026, 0.034, 12, 8), mm['band'], None, orient(kp, out))
        fly = clamp(ex.get('scarf', 0.0))
        wave = ex.get('wave', 0.0)
        down = Vector((0.0, 0.0, -1.0))
        back = (self.J('chest').to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
        for k, (ln, spread) in enumerate(((0.13, 0.5), (0.11, -0.4))):
            pts = []
            for i in range(9):
                t = i / 8
                wob = math.sin(wave + t * 4.0 + k * 1.3) * (0.01 + 0.025 * fly) * t
                dirv = (down * (1.0 - 0.8 * fly) + back * (0.15 + 1.0 * fly) + out * 0.55 + (-zl) * 0.2 * spread + yl * spread * 0.35)
                dirv.normalize()
                pts.append(kp + out * 0.01 + dirv * (ln * t) + Vector((0.0, 0.0, wob)) + yl * (wob * 0.5))
            tg = (pts[-1] - pts[0]).normalized()
            hint = out - tg * out.dot(tg)
            if hint.length < 1e-3:
                hint = yl
            self.add(f'bandend{k}', cloth_strip(pts, lambda t: 0.042 - 0.012 * t, hint.normalized(), 1.0, 0.004, 0.012, 6), mm['band'], None)

    # --- head -------------------------------------------------------------------------------------
    def head_parts(self):
        c, mm = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        hv = [(x * (1 - 0.1 * max(0.0, (hc - z) / hz) ** 1.6), y - 0.02 * max(0.0, (hc - z) / hz) ** 2, z) for (x, y, z) in hv]
        self.add('head', (hv, hf), mm['skin'], 'head')
        for sd in (1, -1):
            self.add('ear', ellipsoid(0.062, 0.04, 0.082, 16, 10), mm['skin'], 'head', T((hx - 0.01) * sd, 0.03, hc - 0.05) @ R(0, 0, -14 * sd))
            self.add('earin', ellipsoid(0.034, 0.02, 0.048, 12, 8), mm['skin_d'], 'head', T((hx - 0.004) * sd, 0.0, hc - 0.05) @ R(0, 0, -14 * sd))
        self.earrings()
        ey, ep = self.EYE
        self.face(head, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(0.088, 0.108), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-31,
                  lid_col=c['skin'], skin=c['skin'], brow_pitch=20, lash_col=c['lash'], blush=False)
        self.scar(head)
        self.hair()

    def earrings(self):
        """Three small gold drops along the lobe of his left ear."""
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        em = T(hx - 0.01, 0.03, hc - 0.05) @ R(0, 0, -14)
        for k, (y, z) in enumerate(((-0.012, -0.066), (0.012, -0.074), (0.036, -0.066))):
            base = em @ Vector((0.034, y, z))
            self.add(f'earring{k}', torus(0.011, 0.0042, 12, 6), mm['gold'], 'head', T(*base) @ R(0, 90, 0) @ R(0, 0, 0))
            self.add(f'eardrop{k}', ellipsoid(0.0085, 0.0085, 0.019, 10, 8, center=(0.0, 0.0, -0.024)), mm['gold'], 'head', T(*base))

    def scar(self, head: HeadShape):
        """The vertical scar through his shut left eye, from above the brow down onto the cheek."""
        m = self.mat['scar']
        ey, ep = self.EYE
        pts = []
        for i in range(15):
            t = i / 14
            pitch = ep + 27 - 58 * t
            yaw = ey + 1.5 - 4.0 * t
            pts.append(head.point(yaw, pitch, 0.004)[0])
        self.add('scar', sweep(pts, lambda t: 0.0045 + 0.0055 * math.sin(math.pi * t) ** 0.7, 7), m, 'head')

    # --- hair -------------------------------------------------------------------------------------
    def hair(self):
        hair = self.mat['hair']
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))
        # a short spiky fringe: (yaw of the tip, pitch the tip reaches down to)
        tips = [(-58, 24), (-40, 30), (-22, 26), (-4, 31), (14, 27), (32, 31), (50, 25), (64, 22)]

        def pointed(yaw, lst, high, width):
            best = high
            for ty, low in lst:
                d = abs(yaw - ty)
                best = min(best, low + (high - low) * min(1.0, d / width) ** 0.7)
            return best

        def boundary(yaw):
            a = abs(yaw)
            if a <= 70:
                return pointed(yaw, tips, 40.0, 8.0)
            # short at the sides: a sideburn in front of the ear, then up over the ear and down to the nape
            return periodic_interp([(70, 30), (78, 6), (84, 2), (92, 16), (104, 16), (122, 0), (150, -14), (180, -18)], a)

        def thickness(yaw, pitch, f):
            ridge = 0.5 + 0.5 * math.cos(math.radians(yaw) * 13 + 0.5)
            e = min(1.0, f / 0.2)
            return 0.014 + 0.05 * math.sin(math.pi * min(1.0, f * 1.15)) * e + 0.018 * ridge * e * (1.0 - sstep((f - 0.5) / 0.4))

        v, f, tp = hair_shell(hs, boundary, thickness, 150, 22)
        self.add('hair', (v, f), hair, 'head', tip=[0.15 + 0.6 * q for q in tp])
        # short, broad tufts brushed up and back over the crown, flicking out at the sides
        acc = MeshAcc()
        hs2 = HeadShape(hx + 0.06, hy + 0.06, hz + 0.07, center=(0, 0.01, hc + 0.01))
        Z = Vector((0.0, 0.0, 1.0))

        def tuft(yaw, pitch, length, r0, lift=0.32, back=0.9, flat=0.5):
            pos, n = hs2.point(yaw, pitch, -0.05)
            # along the scalp towards the crown / back, lifting off it
            pos2, _ = hs2.point(yaw * 0.92, min(89.0, pitch + 12), -0.05)
            along = (pos2 - pos).normalized()
            d = (along * back + n * lift).normalized()
            pts = [pos + d * (length * t) + n * (0.02 * t * t) for t in (k / 7 for k in range(8))]
            mesh = flat_sweep(pts, lambda t: r0 * (1 - 0.86 * t ** 1.3) + 0.004, n, flat, 10)
            acc.add(mesh, flat_tip(8, 10, len(mesh[0]), 0.35, 1.0))

        # (yaw, pitch, length, base radius)
        TU = [(0, 58, 0.16, 0.1), (-26, 56, 0.16, 0.1), (26, 56, 0.16, 0.1), (-50, 50, 0.15, 0.095), (50, 50, 0.15, 0.095),
              (-13, 74, 0.15, 0.1), (13, 74, 0.15, 0.1), (-40, 70, 0.14, 0.095), (40, 70, 0.14, 0.095),
              (-72, 42, 0.13, 0.09), (72, 42, 0.13, 0.09), (-96, 40, 0.13, 0.09), (96, 40, 0.13, 0.09),
              (-122, 44, 0.13, 0.09), (122, 44, 0.13, 0.09), (-150, 44, 0.13, 0.09), (150, 44, 0.13, 0.09), (180, 40, 0.13, 0.09)]
        for yaw, pitch, ln, r0 in TU:
            tuft(yaw, pitch, ln, r0)
        self.add('spikes', acc.mesh, hair, 'head', tip=acc.tip)

    # --- katanas ----------------------------------------------------------------------------------
    # (pivot in the hips frame, direction hilt->tip (x out, y back, z up), hilt material, scabbard material): tucked into the
    # haramaki at his left hip, fanned out so that from the front the scabbards spread past his left leg and from his right
    # side the hilts jut out in front of his belly while the tips poke out behind him
    SWORDS = [((0.24, -0.08, 0.09), (0.252, 0.878, -0.407), 'shusui', 'saya_b'),
              ((0.252, -0.05, 0.065), (0.449, 0.719, -0.53), 'kitetsu', 'saya_r'),
              ((0.266, -0.02, 0.04), (0.595, 0.5, -0.629), 'wado', 'saya_w')]
    HILT, SAYA = 0.24, 0.66

    def swords(self):
        mm = self.mat
        Hm = self.J('hips')
        Hr = Hm.to_3x3()
        for k, (piv, dv, hilt_m, saya_m) in enumerate(self.SWORDS):
            A = Hm @ Vector(piv)
            D = (Hr @ Vector(dv)).normalized()
            # keep the scabbard tip clear of the ground (sitting, crouching): swing it up about the pivot
            tip = A + D * self.SAYA
            floor = 0.05
            if tip.z < floor:
                horiz = Vector((D.x, D.y, 0.0))
                horiz = horiz.normalized() if horiz.length > 1e-4 else Vector((0.0, 1.0, 0.0))
                need = (floor - A.z) / self.SAYA  # sine of the steepest allowed descent
                need = clamp(need, -0.95, 0.95)
                D = (horiz * math.sqrt(1.0 - need * need) + Vector((0.0, 0.0, need))).normalized()
            up_hint = Hr @ Vector((0.0, 0.0, 1.0))
            F = frame_along(D, up_hint)
            F.translation = A
            self.katana(k, F, mm[hilt_m], mm[saya_m])

    def katana(self, k: int, F: Matrix, hilt_m, saya_m):
        """One sheathed katana in frame F (+Y from the pivot towards the scabbard tip)."""
        mm = self.mat
        h, s = self.HILT, self.SAYA
        # scabbard: a slim oval tube with a gentle curve (sori), a lacquered cap at the tip
        pts = [Vector((0.0, s * t, 0.028 * math.sin(math.pi * t) * 0.8 + 0.01 * t)) for t in (i / 12 for i in range(13))]
        self.add(f'saya{k}', sweep(pts, lambda t: 0.034 - 0.006 * t, 12, squash=0.75), saya_m, None, F)
        endp = pts[-1]
        self.add(f'kojiri{k}', ellipsoid(0.026, 0.034, 0.021, 12, 8, center=tuple(endp + Vector((0.0, -0.01, 0.0)))), mm['fitting'], None, F)
        self.add(f'koiguchi{k}', sweep([Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.03, 0.0))], 0.037, 12), mm['fitting'], None, F)
        # guard, collar, grip with its wrap (banded along 'tip'), pommel cap
        self.add(f'tsuba{k}', disc(0.062 if k != 0 else 0.066, 0.016, 22), mm['tsuba'], None, F @ T(0.0, -0.012, 0.0))
        self.add(f'habaki{k}', sweep([Vector((0.0, -0.02, 0.0)), Vector((0.0, -0.036, 0.0))], 0.027, 10), mm['tsuba'], None, F)
        gp = [Vector((0.0, -0.03 - (h - 0.05) * t, 0.012 * t * t)) for t in (i / 8 for i in range(9))]
        gv, gf = sweep(gp, lambda t: 0.029 + 0.003 * math.sin(math.pi * t), 10, squash=0.85)
        self.add(f'tsuka{k}', (gv, gf), hilt_m, None, F, tip=flat_tip(9, 10, len(gv), 0.0, 1.0))
        self.add(f'kashira{k}', ellipsoid(0.029, 0.022, 0.025, 12, 8, center=tuple(gp[-1] + Vector((0.0, -0.012, 0.0)))), mm['fitting'], None, F)

    # --- face (a copy of Hero.face: shut scarred left eye, lidded right eye, stern brows, smirk) -------
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
                kind = 'open'
            if side > 0:
                # his left eye stays shut: a firm closed line (the scar is added separately)
                pts = arc_points(ew * 1.55, eh * 0.12, 12, y=-0.01)
                self.feat(f'shut{name}', sweep([p + Vector((0.0, 0.0, -eh * 0.12)) for p in pts], lambda t: 0.009 + 0.004 * math.sin(math.pi * t), 8),
                          lash, joint, head, fr)
            elif kind in ('open', 'wide', 'sad', 'determined', 'dizzy', 'half'):
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
                    ir = 0.78 * ew * (0.8 if kind == 'wide' else 1.0)
                    off = Vector((lx * ew * 0.22 - 0.1 * ew * side, -ed * 0.9, lz * eh * 0.2 - eh * 0.06))
                    self.feat(f'iris{name}', ellipsoid(ir, ed * 0.22, ir * 1.1, 20, 10, center=off), irm, joint, head, fr)
                    pr = ir * 0.55
                    self.feat(f'pupil{name}', ellipsoid(pr, ed * 0.2, pr * 1.12, 16, 8, center=off + Vector((0.0, -ed * 0.12, 0.0))), dark, joint, head, fr)
                    h1 = off + Vector((-ir * 0.38, -ed * 0.3, ir * 0.42))
                    self.feat(f'shine{name}', ellipsoid(ir * 0.3, 0.004, ir * 0.32, 10, 6, center=h1), shine, joint, head, fr)
                    h2 = off + Vector((ir * 0.4, -ed * 0.3, -ir * 0.4))
                    self.feat(f'shine2{name}', ellipsoid(ir * 0.12, 0.004, ir * 0.12, 8, 5, center=h2), shine, joint, head, fr)
                lash_pts = [Vector((math.sin(a) * ew * 1.02, -ed * 0.55, math.cos(a) * eh * 1.0)) for a in [(-1 + 2 * i / 12) * 1.25 for i in range(13)]]
                self.feat(f'lash{name}', sweep(lash_pts, lambda t: 0.005 + 0.005 * math.sin(math.pi * t), 6), lash, joint, head, fr)
                # a heavy upper lid, tilted down towards the nose: the sharp, keen look
                lid = {'sad': 0.42, 'determined': 0.42, 'half': 0.5, 'open': 0.28}.get(kind)
                if eyes == 'wink':
                    lid = 0.36
                if lid and lid_col:
                    lidm = mt.skin(f'lid_{lid_col}', lid_col)
                    tilt = {'sad': -16 * side, 'determined': 14 * side, 'open': 11 * side}.get(kind, 0)
                    lid_mesh = ellipsoid(ew * 1.12, ed * 1.25, eh * 1.1, 20, 10, zmin=1 - lid * 2)
                    self.feat(f'lid{name}', lid_mesh, lidm, joint, head, fr @ R(0, tilt, 0) @ T(0, -0.004, 0))
                    zc = eh * 1.1 * (1 - lid * 2)
                    w2 = ew * 1.12 * math.sqrt(max(0.0, 1 - (1 - lid * 2) ** 2))
                    lp = [Vector((w2 * (-1 + 2 * i / 10), -ed * 1.3, zc + 0.004)) for i in range(11)]
                    self.feat(f'lidline{name}', sweep(lp, lambda t: 0.007 + 0.004 * math.sin(math.pi * t), 6), lash, joint, head,
                              fr @ R(0, tilt, 0) @ T(0, -0.004, 0))
            elif kind == 'happy':
                pts = arc_points(ew * 1.7, -eh * 0.42, 12, y=-0.01)
                self.feat(f'happy{name}', sweep([p + Vector((0, 0, -eh * 0.15)) for p in pts], 0.0125, 8), lash, joint, head, fr)
            elif kind == 'closed':
                pts = arc_points(ew * 1.6, eh * 0.22, 12, y=-0.01)
                self.feat(f'closed{name}', sweep(pts, 0.0115, 8), lash, joint, head, fr)
            b_pitch = eye_pitch + brow_pitch + (4 if brows == 'up' else 0) + (2 if eyes == 'wide' else 0)
            roll = {'neutral': -13, 'up': -6, 'worried': 14, 'angry': -20, 'determined': -18, 'sad': 12}.get(brows, 0) * side
            bf = head.frame(yaw * 1.02, b_pitch, 0.004, roll)
            bpts = arc_points(ew * 1.6, -0.008, 8)
            self.feat(f'brow{name}', sweep(bpts, lambda t: 0.017 + 0.009 * math.sin(math.pi * t ** 0.8), 8), browm, joint, head, bf)
        skin_m = mt.skin(f'skin_{skin}', skin) if skin else None
        if nose and skin_m:
            nf = head.frame(0, eye_pitch - 13, -0.004)
            self.feat('nose', ellipsoid(0.028, 0.024, 0.022, 14, 8), skin_m, joint, head, nf)
        if blush:
            bl = mt.alpha('blush', '#ff8a8a', 0.3)
            for side in (1, -1):
                bf = head.frame(side * (eye_yaw + 13), eye_pitch - 16, 0.003)
                self.feat('blush', ellipsoid(0.044, 0.004, 0.026, 14, 6), bl, joint, head, bf)
        mf = head.frame(0, mouth_pitch, 0.0)
        w = 0.12 * mouth_w
        if mouth == 'smile':
            # the cool smirk: flat on his right, curling up on his left
            pts = [Vector(((i / 14 - 0.5) * w * 0.95, -0.006, 0.026 * max(0.0, (i / 14 - 0.35) / 0.65) ** 2.0 - 0.004 * math.sin(math.pi * i / 14)))
                   for i in range(15)]
            self.feat('mouth', sweep(pts, lambda t: 0.0075 + 0.003 * math.sin(math.pi * t), 8), mouth_m, joint, head, mf @ T(0.012, 0, 0))
        elif mouth == 'smirk':
            pts = [Vector(((i / 12 - 0.5) * w * 0.8, -0.006, 0.02 * (i / 12) ** 2)) for i in range(13)]
            self.feat('mouth', sweep(pts, 0.009, 8), mouth_m, joint, head, mf)
        elif mouth in ('grin', 'laugh'):
            # a confident, lopsided toothy grin (higher on his left)
            gw, gh = {'grin': (0.16, 0.05), 'laugh': (0.17, 0.066)}[mouth]
            curl = gh * 0.45

            def bent(vs, dy=0.0):
                return [(x, y + dy, z + curl * (abs(x) / (gw / 2)) ** 2.2 + 0.22 * gh * (x / (gw / 2))) for (x, y, z) in vs]
            mv, mfc = ellipsoid(gw / 2, 0.014, gh, 26, 12, zmax=0.3)
            self.feat('mouth', (bent(mv), mfc), mouth_m, joint, head, mf @ T(0.01, 0.002, 0.0))
            tv, tf = ellipsoid(gw / 2 * 0.92, 0.012, gh, 26, 6, zmin=-0.25, zmax=0.28)
            self.feat('teeth', (bent(tv, -0.006), tf), teeth, joint, head, mf @ T(0.01, 0.002, 0.0))
            if mouth == 'laugh':
                self.feat('tongue', ellipsoid(gw * 0.2, 0.01, gh * 0.25, 14, 8, center=(0.01, -0.008, -gh * 0.7)), tongue, joint, head, mf)
        elif mouth == 'open':
            hh = 0.055
            ww = w * 1.0
            self.feat('mouth', ellipsoid(ww / 2, 0.02, hh, 22, 12, zmax=0.15), mouth_m, joint, head, mf @ T(0, 0.002, 0.006))
            self.feat('tongue', ellipsoid(ww * 0.3, 0.012, hh * 0.45, 14, 8, center=(0, -0.008, -hh * 0.6)), tongue, joint, head, mf)
            self.feat('teeth', ellipsoid(ww * 0.42, 0.01, 0.013, 14, 6, center=(0, -0.012, 0.0)), teeth, joint, head, mf)
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


def _sy(k: float):
    return Matrix.Diagonal((1.0, k, 1.0, 1.0))
