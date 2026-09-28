"""Naruto: a fan-made chibi version for a private, non-commercial party game, built on the shared Hero
structure (see char_models.py; the skeleton and body layout follow Kip).

Signature details, picked so he reads at board size (~120 px tall):
  * a big crown of sharp, bright yellow spikes swept up and out, long locks framing the face;
  * a navy cloth forehead protector with a polished steel plate engraved with the leaf swirl, knotted at
    the back with two tails that flutter like Kip's scarf (pose['extra']['scarf'] and 'wave');
  * blue eyes, three whisker marks on each cheek and a wide toothy grin as his default smile;
  * the orange jumpsuit: a jacket with a black yoke over the shoulders and upper back, a white stand-up
    collar and a zip, red swirls on the upper sleeves and the back; orange trousers with a bandage and
    holster on the right thigh; blue open-toe ninja sandals.
"""
from __future__ import annotations

import math
import re

from mathutils import Vector

import lib
from lib import col
from char_rig import HeadShape, R, T, cloth_strip, ellipsoid, flat_sweep, superellipsoid, sweep, torus
from char_models import DEFAULT_FACE, Hero, hair_shell, hand_mitten, periodic_interp, zigzag


# ------------------------------------------------------------------------------------------
# Helpers
def sstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def flat_tip(n: int, sides: int, nverts: int, t0: float = 0.0, t1: float = 1.0):
    """'tip' values for a flat_sweep / sweep mesh of n rings (t0..t1 along it, then end cap, start cap)."""
    tip = []
    for i in range(n):
        tip += [t0 + (t1 - t0) * i / max(1, n - 1)] * sides
    rest = nverts - n * sides
    tip += [t1] * (rest // 2) + [t0] * (rest - rest // 2)
    return tip


class MeshAcc:
    """Accumulates several meshes (and their 'tip' values) into one part."""

    def __init__(self):
        self.v, self.f, self.tip = [], [], []

    def add(self, mesh, tip=None):
        vv, ff = mesh[0], mesh[1]
        b0 = len(self.v)
        self.v.extend(vv)
        self.f.extend(tuple(q + b0 for q in face) for face in ff)
        self.tip.extend(tip if tip is not None else [0.0] * len(vv))

    @property
    def mesh(self):
        return self.v, self.f


def head_band(hs: HeadShape, pitch_c, half: float, lift: float, thick: float, U: int = 112, prof_n: int = 14):
    """A closed cloth band hugging the ellipsoid `hs`: centre pitch pitch_c(yaw) and half height `half`
    (degrees), inner face `lift` above the surface, `thick` deep, rounded-rectangle cross-section."""
    prof = []
    for k in range(prof_n):
        a = k / prof_n * math.tau
        c, s = -math.cos(a), math.sin(a)
        prof.append((math.copysign(abs(c) ** 0.45, c) * half, (math.copysign(abs(s) ** 0.45, s) * 0.5 + 0.5) * thick))
    verts, faces = [], []
    for i in range(U):
        yaw = -180.0 + 360.0 * i / U
        pc = pitch_c(yaw)
        for dp, dl in prof:
            verts.append(tuple(hs.point(yaw, pc + dp, lift + dl)[0]))
    P = len(prof)
    for i in range(U):
        i2 = (i + 1) % U
        for k in range(P):
            k2 = (k + 1) % P
            faces.append((i * P + k, i2 * P + k, i2 * P + k2, i * P + k2))
    return verts, faces


def spiral_pts(r0: float, r1: float, turns: float, n: int = 48, a0: float = 0.0, cw: bool = False):
    out = []
    for i in range(n + 1):
        t = i / n
        a = a0 + (-1 if cw else 1) * t * turns * math.tau
        r = r0 + (r1 - r0) * t
        out.append(Vector((math.cos(a) * r, 0.0, math.sin(a) * r)))
    return out


# The leaf-village swirl as two stroked paths (spiral with a short tail to the upper right, and the
# pointed outline down to the lower left), in SVG units (y down).
LEAF_PATHS = (
    'M -142.125,-55.25 C -140.875,-54.666667 -139.4375,-53.9375 -139.875,-49.875 C -141.1875,-46.3125 -143.6875,-43.270833 -150,-43.5 '
    'C -155.0625,-44.729167 -160.5625,-46.166667 -160.125,-56.25 C -159.6875,-61.458333 -154.25,-68.6875 -145,-68.75 '
    'C -131.625,-68.5625 -125.0625,-56.75 -125.625,-47.625 C -126.3125,-34.625 -136.70833,-27.875 -151,-26.625 '
    'C -158.66667,-26.625 -167.5625,-30.8125 -171.625,-37.125 C -176.6875,-43.6875 -178.64583,-57.208333 -174.375,-66.125 '
    'C -169.85417,-75.666667 -161.3244,-81.672042 -151.25,-81.875 C -141.89583,-82.0625 -135.75,-78.541667 -132.25,-76.375 L -124,-84.375',
    'M -172.625,-69.25 C -177.5736,-61.537772 -180.88532,-51.495796 -184.25,-45.375 C -186.66667,-40.125 -189.95833,-37.125 -193.375,-33.125 '
    'C -179.80766,-25.257434 -158.89934,-24.622727 -145.3125,-27.4375',
)


def svg_polyline(d: str, per: int = 7):
    toks = re.findall(r'[MCL]|-?\d+\.?\d*', d)
    pts, cur, i, cmd = [], None, 0, None
    while i < len(toks):
        if toks[i] in 'MCL':
            cmd = toks[i]
            i += 1
            continue
        if cmd == 'M':
            cur = (float(toks[i]), float(toks[i + 1]))
            pts.append(cur)
            i += 2
        elif cmd == 'L':
            nxt = (float(toks[i]), float(toks[i + 1]))
            for k in range(1, 4):
                pts.append((cur[0] + (nxt[0] - cur[0]) * k / 3, cur[1] + (nxt[1] - cur[1]) * k / 3))
            cur = nxt
            i += 2
        else:  # C
            c1 = (float(toks[i]), float(toks[i + 1]))
            c2 = (float(toks[i + 2]), float(toks[i + 3]))
            p3 = (float(toks[i + 4]), float(toks[i + 5]))
            for k in range(1, per + 1):
                t = k / per
                u = 1 - t
                pts.append((u ** 3 * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p3[0],
                            u ** 3 * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p3[1]))
            cur = p3
            i += 6
    return pts


def leaf_symbol(width: float, y: float):
    """The swirl as polylines in a feature frame (x right, z up), `width` wide, at depth y."""
    polys = [svg_polyline(d) for d in LEAF_PATHS]
    xs = [p[0] for pl in polys for p in pl]
    zs = [p[1] for pl in polys for p in pl]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    k = width / (max(xs) - min(xs))
    return [[Vector(((x - cx) * k, y, -(z - cz) * k)) for x, z in pl] for pl in polys]


# ------------------------------------------------------------------------------------------
class Naruto(Hero):
    """Naruto: spiky yellow hair, navy forehead protector with the leaf plate, whiskers, orange jumpsuit."""

    key = 'naruto'
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
    sit_h = 0.17

    C = dict(skin='#f7c596', skin_d='#e8a57a', hair_d='#eb9812', hair_l='#ffe24e', orange='#f7781c', orange_d='#d85a12',
             black='#26262e', collar='#f6f3ec', zip='#c3c8d0', swirl='#d93a2a', band='#233c86', band_d='#1a2d66', plate='#d5dbe2',
             engrave='#3a3f48', sandal='#2f62c0', sandal_d='#244c98', bandage='#f1ede4', holster='#39465e', iris='#2a86e8',
             brow='#d99418', whisker='#5e3a2a', lash='#2a1a14')

    HEAD = (0.4, 0.375, 0.39, 0.41)  # rx, ry, rz, centre height above the head joint
    EYE = (23.0, -6.0)
    BAND_FRONT, BAND_BACK, BAND_HALF = 29.0, 14.0, 8.5  # headband centre pitch at the front / back, half height (degrees)

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.28

    def band_pitch(self, yaw: float) -> float:
        f = 0.5 - 0.5 * math.cos(math.radians(yaw))  # 0 at the front, 1 at the back
        return self.BAND_FRONT + (self.BAND_BACK - self.BAND_FRONT) * sstep(f)

    # --- materials ------------------------------------------------------------------------------
    def jacket_mat(self, name: str):
        """Orange jacket with a black yoke above a slanted line (lower at the back), from object coordinates
        (the jacket part lives in the chest frame)."""
        c = self.C

        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            sp = m.sep(obj)
            cut = m.math('SUBTRACT', sp[2], m.math('ADD', m.math('MULTIPLY', sp[1], -0.42), 0.005))
            mask = m.maprange(cut, -0.004, 0.004)
            colr = m.mix(mask, col(c['orange']), col(c['black']))
            nz = m.noise(60.0, 3, 0.6, obj)
            m.bsdf(colr, 0.7, normal=m.bump(nz.outputs['Fac'], 0.08, 0.02), sheen=0.35, spec=0.3)
            return m.mat
        return self.m.get(name, make)

    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('nar_skin', c['skin']),
            skin_d=mt.skin('nar_skin_d', c['skin_d']),
            hair=mt.hair('nar_hair', c['hair_d'], c['hair_l'], 0.4),
            jacket=self.jacket_mat('nar_jacket'),
            orange=mt.cloth('nar_orange', c['orange'], 0.7, 0.35, 0.08),
            orange_d=mt.cloth('nar_orange_d', c['orange_d'], 0.7, 0.3),
            black=mt.cloth('nar_black', c['black'], 0.7, 0.35, 0.06),
            collar=mt.cloth('nar_collar', c['collar'], 0.72, 0.3),
            zip=mt.metal('nar_zip', c['zip'], 0.3),
            swirl=mt.cloth('nar_swirl', c['swirl'], 0.6, 0.3),
            band=mt.cloth('nar_band', c['band'], 0.7, 0.45, 0.1),
            band_d=mt.cloth('nar_band_d', c['band_d'], 0.7, 0.4),
            plate=mt.metal('nar_plate', c['plate'], 0.16),
            engrave=mt.glossy('nar_engrave', c['engrave'], 0.4, 0.2),
            sandal=mt.cloth('nar_sandal', c['sandal'], 0.5, 0.25, 0.06, 40),
            sandal_d=mt.cloth('nar_sandal_d', c['sandal_d'], 0.55, 0.2),
            bandage=mt.cloth('nar_bandage', c['bandage'], 0.8, 0.3, 0.1, 50),
            holster=mt.cloth('nar_holster', c['holster'], 0.55, 0.2),
            whisker=mt.glossy('nar_whisker', c['whisker'], 0.5, 0.1),
        )
        self.torso()
        self.legs()
        self.arms()
        self.head_parts()
        self.headband()

    # --- torso ----------------------------------------------------------------------------------
    def torso(self):
        mm = self.mat
        prof = lambda t: 0.226 - 0.026 * t + 0.012 * math.sin(math.pi * t)  # noqa: E731
        zs = [-0.35 + 0.47 * i / 12 for i in range(13)]
        self.add('jacket', sweep([Vector((0, 0, z)) for z in zs], prof, 28, cap0=False, squash=0.8), mm['jacket'], 'chest')
        self.add('shoulders', ellipsoid(0.207, 0.16, 0.088, 26, 12, center=(0, 0, 0.1), zmin=-0.2), mm['black'], 'chest')
        # hem of the jacket over the trousers
        self.add('hem', torus(0.214, 0.026, 36, 8, center=(0, 0, -0.335)), mm['orange_d'], 'chest', _sy(0.82))
        # zip down the front, a pull tab under the collar
        zp = []
        for i in range(12):
            t = i / 11
            z = -0.33 + 0.43 * t
            r = prof((z + 0.35) / 0.47)
            zp.append(Vector((0.0, -r * 0.8 - 0.004, z)))
        self.add('zip', sweep(zp, 0.0065, 6), mm['zip'], 'chest')
        self.add('zippull', superellipsoid(0.016, 0.008, 0.026, 3.0, 10, 6, center=(0.0, -0.188, 0.05)), mm['zip'], 'chest', R(8, 0, 0))
        # white stand-up collar round the neck, open at the front
        cp = []
        for i in range(25):
            a = math.radians(-64 + (244 + 64) * i / 24)
            front = max(0.0, -math.sin(a))
            rr = 0.158 + 0.028 * front ** 2
            cp.append(Vector((rr * math.cos(a), rr * math.sin(a) * 0.9 + 0.01, 0.15 - 0.05 * front ** 3)))
        self.add('collar', sweep(cp, lambda t: 0.05 + 0.012 * math.sin(math.pi * t), 14), mm['collar'], 'chest')
        self.add('neck', sweep([Vector((0, 0.01, 0.08)), Vector((0, 0.01, 0.24))], 0.078, 16), mm['skin'], 'chest')
        # the red swirl on his back
        bm = T(0.0, 0.18, -0.13) @ R(0, 0, 180)
        self.add('backswirl', sweep(spiral_pts(0.008, 0.055, 1.6, 40, 0.0, True), lambda t: 0.009 + 0.004 * t, 6), mm['swirl'], 'chest',
                 bm @ R(-12, 0, 0))
        # trousers
        self.add('pelvis', superellipsoid(0.205, 0.168, 0.15, 2.4, 28, 16, center=(0, 0, -0.04)), mm['orange'], 'hips')

    # --- legs -----------------------------------------------------------------------------------
    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('trouser' + s_, hip, kn, an, lambda t: 0.108 - 0.022 * t + 0.01 * math.sin(math.pi * t), mm['orange'], 0.0, 0.9, 16, 14,
                      cap0=True, cap1=False)
            self.limb('tcuff' + s_, hip, kn, an, 0.088, mm['orange_d'], 0.84, 0.93, 16, 3, cap0=False, cap1=False)
            self.limb('ankle' + s_, hip, kn, an, 0.064, mm['skin'], 0.86, 1.0, 12, 4, cap0=False, cap1=True)
            if sd < 0:
                # bandage wrap and holster on the right thigh
                for k in range(3):
                    t0 = 0.2 + k * 0.055
                    self.limb(f'bandage{k}', hip, kn, an, 0.118, mm['bandage'], t0, t0 + 0.042, 16, 2, cap0=False, cap1=False)
                hm = self.J(hip) @ T(0.105, 0.0, -0.12) @ R(0, 0, 90)
                self.add('holster', superellipsoid(0.05, 0.03, 0.068, 3.2, 14, 10), mm['holster'], None, hm)
                self.add('holsterflap', superellipsoid(0.054, 0.02, 0.026, 3.2, 14, 8, center=(0, -0.018, 0.046)), mm['holster'], None, hm)
            # blue open-toe ninja sandals: heel and instep covered, toes showing
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('foot' + s_, superellipsoid(0.098, 0.15, 0.062, 2.4, 18, 10, center=(0, -0.07, -0.085)), mm['skin'], None, fm)
            self.add('toes' + s_, ellipsoid(0.1, 0.07, 0.056, 18, 10, center=(0, -0.165, -0.092)), mm['skin'], None, fm)
            self.add('sandal' + s_, superellipsoid(0.118, 0.128, 0.092, 2.6, 22, 14, center=(0, -0.0, -0.058)), mm['sandal'], None, fm)
            self.add('strap' + s_, superellipsoid(0.112, 0.045, 0.05, 2.6, 18, 10, center=(0, -0.105, -0.085)), mm['sandal'], None, fm)
            self.add('sole' + s_, superellipsoid(0.126, 0.205, 0.03, 3.0, 22, 8, center=(0, -0.065, -0.125)), mm['sandal_d'], None, fm)
            self.add('scuff' + s_, torus(0.084, 0.024, 22, 8, center=(0, 0, 0.018)), mm['sandal'], None, fm)

    # --- arms -----------------------------------------------------------------------------------
    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('yoke' + s_, sh, el, wr, lambda t: 0.094 - 0.004 * t, mm['black'], 0.0, 0.2, 14, 4, cap0=True, cap1=False)
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.09 - 0.014 * t, mm['orange'], 0.18, 0.9, 14, 12, cap0=False, cap1=False)
            self.limb('cuff' + s_, sh, el, wr, 0.08, mm['orange_d'], 0.84, 0.94, 14, 3, cap0=False, cap1=False)
            self.limb('wrist' + s_, sh, el, wr, 0.052, mm['skin'], 0.88, 1.0, 12, 4, extend=0.02)
            # red swirl on the outside of the upper sleeve
            fr = self.limb_frame(sh, el, wr, 0.3, sh)
            sm = fr @ T(0.09 * sd, 0.0, 0.0) @ R(0, 0, 90 * sd)
            self.add('swirl' + s_, sweep(spiral_pts(0.005, 0.03, 1.4, 30, 0.0, sd < 0), lambda t: 0.0065 + 0.002 * t, 6), mm['swirl'], None, sm)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.2):
                self.add('hand' + nm + s_, mesh, mm['skin'], None, wm)

    # --- head -----------------------------------------------------------------------------------
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
        # face: stock eyes and brows; his default smile is a wide toothy grin
        fc = dict(DEFAULT_FACE)
        fc.update(self.pose.get('face', {}))
        big_grin = fc['mouth'] in ('smile', 'grin')
        saved = self.pose
        if big_grin:
            self.pose = dict(saved, face=dict(fc, mouth='none'))
        ey, ep = self.EYE
        self.face(head, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(0.09, 0.114), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-30,
                  lid_col=c['skin'], skin=c['skin'], brow_pitch=20, blush=False, lash_col=c['lash'])
        self.pose = saved
        if big_grin:
            self.grin(head, fc['mouth'] == 'grin')
        self.whiskers(head)
        self.hair(head)

    def grin(self, head: HeadShape, wide: bool):
        """His trademark wide grin: a D-shaped open mouth whose corners curl up, a row of teeth, a tongue."""
        mt = self.m
        mouth_m = mt.glossy('mouth', '#6d2a26', 0.4, 0.2)
        tongue = mt.glossy('tongue', '#e8797b', 0.35, 0.3)
        teeth = mt.glossy('teeth', '#fffdf6', 0.25, 0.4)
        mf = head.frame(0, -30, 0.0)
        ww, hh = (0.24, 0.066) if wide else (0.22, 0.058)

        def curl(mesh, k=2.6):
            v, f = mesh
            return [(x, y, z + k * x * x) for (x, y, z) in v], f

        self.feat('mouth', curl(ellipsoid(ww / 2, 0.02, hh, 26, 12, zmax=0.15)), mouth_m, 'head', head, mf @ T(0, 0.002, 0.008))
        self.feat('tongue', curl(ellipsoid(ww * 0.26, 0.012, hh * 0.42, 14, 8, center=(0, -0.008, -hh * 0.62))), tongue, 'head', head, mf)
        self.feat('teeth', curl(ellipsoid(ww * 0.43, 0.01, 0.0135, 18, 6, center=(0, -0.012, 0.001))), teeth, 'head', head, mf)

    def whiskers(self, head: HeadShape):
        """Three thin whisker marks on each cheek."""
        mm = self.mat
        for sd in (1, -1):
            for k, (p0, dp) in enumerate(((-15.5, 1.5), (-21.5, 0.0), (-27.5, -1.5))):
                pts = []
                for i in range(9):
                    t = i / 8
                    yaw = (37.0 + 19.0 * t) * sd
                    pts.append(head.point(yaw, p0 + dp * t + 1.2 * math.sin(math.pi * t), 0.002)[0])
                self.add(f'whisker{k}', sweep(pts, lambda t: 0.003 + 0.0048 * math.sin(math.pi * min(1.0, t * 1.15)) ** 0.6, 6), mm['whisker'],
                         'head')

    # --- hair -------------------------------------------------------------------------------------
    def hair(self, head: HeadShape):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))
        b_lo = self.band_pitch

        def boundary(yaw):
            a = abs(yaw)
            base = periodic_interp([(0, 27), (38, 26), (56, 15), (72, 2), (90, -4), (108, -10), (130, -22), (180, -28)], a)
            if a > 112:
                base += zigzag(a, [118, 136, 154, 172], -11.0, 4.0, 8.5)
            return base

        def thickness(yaw, pitch, f):
            under_band = abs(pitch - b_lo(yaw)) < self.BAND_HALF + 3
            crown = 0.035 + 0.06 * math.sin(math.pi * min(1.0, f * 1.05))
            edge = min(1.0, f / 0.2)
            t = 0.014 + crown * edge
            if under_band:
                t = min(t, 0.022)
            return t

        v, f, tp = hair_shell(hs, boundary, thickness, 144, 26)
        self.add('haircap', (v, f), mm['hair'], 'head', tip=[0.45 + 0.55 * q for q in tp])

        acc = MeshAcc()
        hs2 = HeadShape(hx + 0.05, hy + 0.05, hz + 0.06, center=(0, 0.01, hc + 0.02))
        Y = Vector((0.0, -1.0, 0.0))
        Z = Vector((0.0, 0.0, 1.0))

        def dirv(yaw, pitch):
            y_, p_ = math.radians(yaw), math.radians(pitch)
            return Vector((math.sin(y_) * math.cos(p_), -math.cos(y_) * math.cos(p_), math.sin(p_)))

        def spike(yaw, pitch, dyaw, dpitch, length, r0, curl=0.22, flat=0.44, sink=-0.075):
            pos, n = hs2.point(yaw, pitch, sink)
            d0 = dirv(dyaw, dpitch)
            up = (Z - d0 * Z.dot(d0))
            up = up.normalized() if up.length > 1e-4 else Vector((0.0, 0.0, 0.0))
            pts = [pos + d0 * (length * t) + up * (curl * length * t * t) for t in [k / 10 for k in range(11)]]
            nv = Y - d0 * Y.dot(d0)
            if nv.length < 0.35:
                nv = Z - d0 * Z.dot(d0)
            nv.normalize()
            mesh = flat_sweep(pts, lambda t: r0 * (1 - t) ** 1.05 + 0.004, nv, flat, 14)
            acc.add(mesh, flat_tip(11, 14, len(mesh[0]), 0.42, 1.0))

        # big locks fanning up and out (yaw, pitch on the head; direction yaw, pitch; length, base radius)
        S = [
            # the fringe flaring up over the band, and two tall locks on the crown behind it
            (0, 39, 2, 88, 0.31, 0.15), (-27, 38, -33, 74, 0.34, 0.155), (29, 38, 35, 72, 0.34, 0.155),
            (-52, 35, -64, 52, 0.35, 0.15), (54, 35, 66, 54, 0.35, 0.15),
            (-14, 70, -22, 102, 0.3, 0.16), (18, 72, 28, 100, 0.28, 0.155),
            # upper sides and sides, pointing out
            (-72, 56, -86, 58, 0.33, 0.15), (72, 56, 86, 60, 0.31, 0.15),
            (-84, 24, -98, 16, 0.33, 0.14), (84, 24, 98, 18, 0.32, 0.14),
            (-100, 2, -116, -12, 0.24, 0.115), (100, 2, 116, -12, 0.24, 0.115),
            # back
            (-122, 40, -132, 40, 0.34, 0.15), (122, 40, 132, 42, 0.34, 0.15), (-112, 70, -122, 70, 0.26, 0.14), (112, 72, 122, 74, 0.25, 0.14),
            (-156, 56, -158, 60, 0.3, 0.15), (156, 56, 158, 58, 0.3, 0.15), (180, 36, 180, 32, 0.3, 0.145),
            (-150, 16, -158, 6, 0.28, 0.135), (150, 16, 158, 8, 0.28, 0.135),
            (-128, -4, -138, -18, 0.2, 0.105), (128, -4, 138, -18, 0.2, 0.105),
        ]
        for yaw, pitch, dyaw, dpitch, ln, r0 in S:
            spike(yaw, pitch, dyaw, dpitch, ln, r0)
        self.add('spikes', acc.mesh, mm['hair'], 'head', tip=acc.tip)

        # long locks framing the face, coming out from under the band and hanging down the cheeks
        acc = MeshAcc()
        hs3 = HeadShape(hx + 0.006, hy + 0.006, hz, center=(0, 0, hc))
        for sd in (1, -1):
            for yaw0, p0, p1, w, flick in ((49.0, 20.0, -24.0, 0.07, 0.12), (66.0, 18.0, -14.0, 0.072, 0.18)):
                pts, nrm = [], []
                for i in range(10):
                    t = i / 9
                    yaw = (yaw0 + 6.0 * t + 10.0 * flick * t * t) * sd
                    pos, n = hs3.point(yaw, p0 + (p1 - p0) * t, 0.012 + 0.03 * t * t * flick * 4)
                    pts.append(pos)
                    nrm.append(n)
                mesh = flat_sweep(pts, lambda t, w=w: w * (1 - t) ** 0.85 + 0.003, lambda t, nrm=nrm: nrm[min(9, int(round(t * 9)))], 0.42, 12)
                acc.add(mesh, flat_tip(10, 12, len(mesh[0]), 0.2, 1.0))
        self.add('locks', acc.mesh, mm['hair'], 'head', tip=acc.tip)

    # --- forehead protector ----------------------------------------------------------------------------
    def headband(self):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        bs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))
        self.add('band', head_band(bs, self.band_pitch, self.BAND_HALF, 0.012, 0.03), mm['band'], 'head')
        # the steel plate: a rounded slab curved over the band, a bevelled rim and the engraved leaf swirl
        pc = self.band_pitch(0.0)
        ps = HeadShape(hx + 0.012 + 0.042, hy + 0.012 + 0.042, hz + 0.01 + 0.042, center=(0, 0.01, hc + 0.012))
        fr = ps.frame(0.0, pc, 0.0)
        self.feat('plate', superellipsoid(0.175, 0.016, 0.07, 4.5, 36, 14, center=(0, 0.0, 0)), mm['plate'], 'head', ps, fr)
        for k, pl in enumerate(leaf_symbol(0.125, -0.0135)):
            self.feat(f'leaf{k}', sweep(pl, 0.0058, 6), mm['engrave'], 'head', ps, fr)
        for sx in (-1, 1):
            for sz in (-1, 1):
                self.feat('rivet', ellipsoid(0.0085, 0.006, 0.0085, 8, 6, center=(0.148 * sx, -0.014, 0.047 * sz)), mm['plate'], 'head', ps, fr)
        # knot at the back and two tails that hang, or stream out behind (extra 'scarf') with a ripple ('wave')
        ex = self.pose.get('extra', {})
        fly = max(0.0, min(1.0, ex.get('scarf', 0.0)))
        wave = ex.get('wave', 0.0)
        kp, kn = bs.point(180.0, self.band_pitch(180.0), 0.04)
        self.add('knot', ellipsoid(0.05, 0.036, 0.042, 14, 10, center=tuple(kp)), mm['band_d'], 'head')
        for k, (sd, ln) in enumerate(((1, 0.4), (-1, 0.35))):
            pts = []
            for i in range(13):
                t = i / 12
                side = sd * (0.025 + 0.11 * t * (1.0 - 0.3 * fly))
                back = 0.02 + 0.05 * t + 0.44 * t * fly
                down = ln * t * (1.0 - fly) + 0.1 * t * fly
                wob = math.sin(t * 4.6 + wave + k * 1.4) * 0.04 * t * (0.4 + fly)
                pts.append(kp + Vector((side + 0.02 * wob * sd, back, -down + wob)))
            # hanging, the tails show their faces to the back; streaming, they turn their faces to the sides
            hint = Vector((0.0, 1.0, 0.25)) * (1.0 - fly) + Vector((sd * 1.0, 0.0, 0.1)) * fly
            self.add(f'tail{k}', cloth_strip(pts, lambda t: 0.085 + 0.012 * t, hint.normalized(), 1.5, lambda t: 0.004 + 0.012 * t, 0.018, 8),
                     mm['band'], 'head')


def _sy(k: float):
    m = R(0, 0, 0)
    m[1][1] = k
    return m
