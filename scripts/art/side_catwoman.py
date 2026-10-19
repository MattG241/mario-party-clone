"""Catwoman (Batman), a fan-made chibi side character for the board cast (see cast.py).

The thief, on Batman's model (char_batman.py: the cowl shell, its ears and the head helpers) with Nami's
slimmer proportions and no cape: a sleek glossy black catsuit with a silver zip down the front, a black
cowl that wraps round the eyes as a mask and rises into short pointed cat ears, silver goggles pushed
up on the cowl, big green eyes with long lashes, dark red lips in a sly smirk (her resting face), black
gloves, a slim belt with the short whip coiled at her right hip, and black heeled boots to the knee.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from char_batman import Batman, clamp, sstep
from char_homer import interp
from char_models import DEFAULT_FACE, Hero, hair_shell, hand_mitten, periodic_interp
from char_rig import HeadShape, R, S, T, arc_points, curve3, disc, ellipsoid, flat_sweep, superellipsoid, sweep, torus


def frame_at(pos: Vector, out: Vector) -> Matrix:
    """A frame at `pos` whose -Y points along `out` (details are modelled facing -Y, up +Z)."""
    fwd = -out.normalized()
    xv = fwd.cross(Vector((0.0, 0.0, 1.0)))
    xv = xv.normalized() if xv.length > 1e-4 else Vector((1.0, 0.0, 0.0))
    zv = xv.cross(fwd).normalized()
    m = Matrix((xv, fwd, zv)).transposed().to_4x4()
    m.translation = pos
    return m


class Catwoman(Batman):
    key = 'catwoman'
    ankle_h = 0.17
    thigh = 0.22
    shin = 0.22
    hip_h = 0.17 + 0.04 + 0.22 + 0.22
    spine = 0.08
    chest = 0.19
    neck = 0.14
    head_up = 0.04
    shoulder = (0.2, 0.0, 0.11)
    upper_arm = 0.21
    forearm = 0.185
    hip_w = 0.1
    sit_h = 0.17

    C = dict(Batman.C, suit='#1b1d24', black='#16181e', skin='#f6d3bb', skin_d='#e6b296', lips='#9c1730', lips_d='#6e0f22', iris='#3f9a52',
             lash='#121014', silver='#cfd4db', lens='#5d3d6e', whip='#2a1f1d', belt='#202229')
    HEAD = (0.4, 0.375, 0.39, 0.41)
    TAPER = 0.06
    EYE = (23.0, -4.0)

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.14

    # --- torso shape (chest frame): a slim waist, a little fuller at the chest and hips ---------------
    Z0, Z1 = -0.34, 0.2
    SQ = 0.8

    def torso_r(self, z: float) -> float:
        if z <= 0.06:
            return interp([(-0.34, 0.178), (-0.2, 0.152), (-0.04, 0.184), (0.06, 0.186)], z)
        return 0.186 * math.sqrt(max(0.0, 1.0 - ((z - 0.06) / 0.142) ** 2))

    # --- building -------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            suit=self.black_mat('cw_suit', c['suit'], 0.26),
            black=self.black_mat('cw_black', c['black'], 0.3),
            cowl=self.black_mat('cw_cowl', c['black'], 0.26),
            boot=self.black_mat('cw_boot', c['black'], 0.2),
            skin=mt.skin('cw_skin', c['skin']),
            skin_d=mt.skin('cw_skin_d', c['skin_d']),
            lips=mt.glossy('cw_lips', c['lips'], 0.28, 0.6),
            lips_d=mt.glossy('cw_lips_d', c['lips_d'], 0.4, 0.2),
            silver=mt.metal('cw_silver', c['silver'], 0.22),
            lens=mt.glossy('cw_lens', c['lens'], 0.1, 0.9),
            shine=mt.emit('eye_shine', '#ffffff', 3.0),
            whip=mt.glossy('cw_whip', c['whip'], 0.4, 0.3),
            belt=mt.glossy('cw_belt', c['belt'], 0.35, 0.3),
            sole=mt.cloth('cw_sole', '#2a2c33', 0.6, 0.1),
            mouth=mt.glossy('cw_mouth', '#4a1218', 0.4, 0.2),
            teeth=mt.glossy('teeth', '#fffdf6', 0.25, 0.4),
            tongue=mt.glossy('tongue', '#e8797b', 0.35, 0.3),
        )
        self.torso()
        self.legs()
        self.arms()
        self.head_parts()

    def feat(self, name, mesh, mat, joint, head, fr):
        # facial features follow the head's taper (Batman's hfeat)
        if joint == 'head':
            self.hfeat(name, mesh, mat, head, fr)
        else:
            Hero.feat(self, name, mesh, mat, joint, head, fr)

    def torso(self):
        mm = self.mat
        prof = [(self.torso_r(self.Z0 + (self.Z1 - self.Z0) * i / 24), self.Z0 + (self.Z1 - self.Z0) * i / 24) for i in range(25)]
        self.add('torso', lib.lathe(prof, 32, cap_bottom=False, cap_top=True, squash_y=self.SQ), mm['suit'], 'chest')
        # the suit's high collar runs up the neck into the cowl
        self.add('neck', sweep([Vector((0, 0, -0.03)), Vector((0, 0, 0.1))], 0.07, 16), mm['cowl'], 'neck')
        # silver zip down the front, a pull at the collar
        pts = [(0.0, 0.0, 0.17 - 0.48 * i / 24) for i in range(25)]
        zp = [Vector(p) for p in self.wrap_torso(pts, 0.004)]
        self.add('zip', sweep(zp, 0.0065, 6), mm['silver'], 'chest')
        top = zp[2]
        self.add('zippull', superellipsoid(0.014, 0.008, 0.026, 2.6, 10, 6, center=(top.x, top.y - 0.012, top.z - 0.03)), mm['silver'], 'chest')
        # seat, slim belt with a silver buckle (hips frame)
        self.add('pelvis', superellipsoid(0.18, 0.15, 0.13, 2.4, 28, 16, center=(0, 0, -0.02)), mm['suit'], 'hips')
        self.add('belt', torus(0.186, 0.018, 40, 8, center=(0, 0, 0.06), squash=1.3), mm['belt'], 'hips', S(1.0, 0.84, 1.0))
        bm = T(0, -0.162, 0.06)
        self.add('buckle', superellipsoid(0.032, 0.012, 0.024, 3.5, 14, 8), mm['silver'], 'hips', bm)
        self.whip()

    def whip(self):
        """The short whip coiled in loops on her right hip, its handle tucked in the belt."""
        mm = self.mat
        c = Vector((-0.2, -0.03, -0.04))
        out = Vector((-1.0, -0.3, 0.0)).normalized()
        fr = frame_at(c, out)
        coil = []
        for i in range(97):
            u = i / 96
            a = u * math.tau * 2.6
            r = 0.07 + 0.01 * math.sin(a * 0.5)
            coil.append(fr @ Vector((math.cos(a) * r, -0.012 * math.sin(u * math.pi * 2.6) - 0.02 * u, math.sin(a) * r * 1.12)))
        self.add('whip', sweep(coil, 0.0105, 8), mm['whip'], 'hips')
        h0 = fr @ Vector((0.02, -0.03, 0.08))
        h1 = fr @ Vector((0.05, -0.03, 0.17))
        self.add('whiphandle', sweep([h0, h1], 0.018, 10), mm['belt'], 'hips')
        self.add('whipcap', ellipsoid(0.022, 0.022, 0.022, 10, 8, center=tuple(h1)), mm['silver'], 'hips')

    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.102 - 0.032 * t + 0.006 * math.sin(math.pi * clamp((t - 0.4) / 0.4)), mm['suit'],
                      0.0, 0.62, 16, 12, cap0=True, cap1=False)
            # glossy boots to just over the knee, a turned-down top
            self.limb('bootleg' + s_, hip, kn, an, lambda t: 0.07 - 0.008 * t + 0.006 * sstep(1 - t * 3.0), mm['boot'], 0.44, 1.0, 16, 12,
                      cap0=False, cap1=True)
            self.limb('bootcuff' + s_, hip, kn, an, lambda t: 0.08 - 0.004 * t, mm['boot'], 0.42, 0.49, 16, 3, cap0=True, cap1=True)
            # heeled boot: the foot tips forward onto a slim sole that rises to a tall heel
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('foot' + s_, superellipsoid(0.064, 0.105, 0.048, 2.4, 20, 12, center=(0, -0.055, -0.07)), mm['boot'], None, fm)
            self.add('toe' + s_, ellipsoid(0.06, 0.06, 0.04, 16, 10, center=(0.0, -0.14, -0.112)), mm['boot'], None, fm)
            sole_m = fm @ T(0, -0.07, -0.125) @ R(14, 0, 0)
            self.add('sole' + s_, superellipsoid(0.066, 0.12, 0.013, 3.2, 20, 8), mm['sole'], None, sole_m)
            self.add('heel' + s_, sweep([Vector((0, 0.028, -0.1)), Vector((0, 0.04, -0.162))], lambda t: 0.028 - 0.013 * t, 10), mm['silver'], None,
                     fm)

    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.056 - 0.01 * t + 0.004 * math.sin(math.pi * t), mm['suit'], 0.0, 1.0, 14, 14, extend=0.02)
            self.limb('gcuff' + s_, sh, el, wr, lambda t: 0.054 + 0.01 * sstep(1 - t * 2.0), mm['black'], 0.82, 1.0, 14, 5, cap0=True,
                      extend=0.02)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.1):
                self.add('glove' + nm + s_, mesh, mm['black'], None, wm)

    # --- head -------------------------------------------------------------------------------------
    @staticmethod
    def cowl_boundary(yaw: float) -> float:
        """The cowl's lower edge: round under the eyes as a mask (over the bridge of the nose), up over the
        cheekbones, then down in front of the ears; the back of the head is covered."""
        return periodic_interp([(0, -15), (10, -19), (24, -25), (38, -22), (50, -16), (62, -30), (74, -66), (90, -88), (180, -88)], abs(yaw))

    def head_parts(self):
        mm, c = self.mat, self.C
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        self.hadd('head', ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc)), mm['skin'])
        hs = HeadShape(hx + 0.004, hy + 0.004, hz + 0.004, center=(0, 0, hc))
        v, f, _tip = hair_shell(hs, self.cowl_boundary, lambda yaw, pitch, fr: self.COWL_T - 0.004, 160, 28, inner=-0.03)
        self.hadd('cowl', (v, f), mm['cowl'])
        ct = self.COWL_T
        cs = HeadShape(hx + ct, hy + ct, hz + ct, center=(0, 0, hc))
        self.ears(cs)
        # eyes through the mask: big, green, long lashes; a sly half-lid at rest
        fc = dict(DEFAULT_FACE)
        fc.update(self.pose.get('face', {}))
        saved = self.pose
        eyes = fc['eyes']
        self.pose = dict(saved, face=dict(fc, mouth='none'))
        ey, ep = self.EYE
        # the mask's eye holes (skin), so closed and happy eyes still read
        for side in (1, -1):
            fr = cs.frame(ey * side, ep - 0.5, 0.0, -12 * side)
            self.feat('eyehole', ellipsoid(0.094 * 1.34, 0.005, 0.118 * 1.2, 24, 8), mm['skin'], 'head', cs, fr)
        es = HeadShape(hx + ct + 0.008, hy + ct + 0.008, hz + ct + 0.008, center=(0, 0, hc))
        Hero.face(self, es, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(0.094, 0.118), iris=c['iris'], brow_col='#2c2f3a', mouth_pitch=-30,
                  lid_col=c['skin'], nose=False, skin=None, blush=False, brow_pitch=21, lash_col=c['lash'])
        self.pose = saved
        # flicks of lashes at the outer corners
        lash = self.m.glossy(f'lash_{c["lash"]}', c['lash'], 0.4, 0.2)
        if eyes in ('open', 'wide', 'sad', 'determined', 'half', 'wink'):
            for side in (1, -1):
                if eyes == 'wink' and side < 0:
                    continue
                fr = es.frame((ey + 7.5) * side, ep + 3.5, 0.0)
                pts = [Vector((side * (0.0 + 0.03 * t), -0.004, 0.0 + 0.026 * t ** 1.4)) for t in (k / 6 for k in range(7))]
                self.feat('flick', sweep(pts, lambda t: 0.009 * (1 - t) + 0.003, 6), lash, 'head', es, fr)
        # a small nose tip below the mask
        nf = head.frame(0, -17, -0.004)
        self.feat('nose', ellipsoid(0.026, 0.022, 0.02, 14, 8), mm['skin'], 'head', head, nf)
        self.lips(head, fc)
        self.goggles(cs)

    def ears(self, cs: HeadShape):
        """Short pointed cat ears: broad at the base, leaning out a little."""
        mm = self.mat
        for sd in (1, -1):
            base, nrm = cs.point(40 * sd, 48, -0.04)
            d = Vector((0.42 * sd, 0.08, 1.0)).normalized()
            pts = [base + d * (0.22 * t) for t in (k / 10 for k in range(11))]
            mesh = flat_sweep(pts, lambda t: 0.11 * (1 - t) ** 1.05 + 0.003, Vector((0.0, -1.0, 0.0)), 0.5, 16)
            self.add('ear', mesh, mm['cowl'], 'head')

    def lips(self, head: HeadShape, f: dict):
        """Dark red lips: a sly smirk at rest, a red-lipped smile or open mouth for the bigger moods."""
        mm = self.mat
        mouth, eyes = f['mouth'], f['eyes']
        mf = head.frame(0, -31, 0.0)
        w = 0.1
        if mouth == 'smile':
            pts = [Vector(((i / 12 - 0.5) * w, -0.006, 0.016 * (i / 12) ** 2 - 0.006 * math.sin(math.pi * i / 12))) for i in range(13)]
            self.feat('lip', sweep(pts, lambda t: 0.009 + 0.005 * math.sin(math.pi * t), 8), mm['lips'], 'head', head, mf)
            self.feat('lowlip', ellipsoid(0.03, 0.012, 0.014, 14, 8, center=(0.004, -0.004, -0.018)), mm['lips'], 'head', head, mf)
        elif mouth in ('grin', 'laugh', 'open', 'gasp', 'o'):
            hw, hh = {'grin': (0.06, 0.03), 'laugh': (0.058, 0.05), 'open': (0.04, 0.042), 'gasp': (0.034, 0.05), 'o': (0.024, 0.03)}[mouth]
            zc = -0.012 if mouth in ('grin', 'laugh') else -0.016
            self.feat('mouth', ellipsoid(hw, 0.014, hh, 22, 10, center=(0, 0.0, zc)), mm['mouth'], 'head', head, mf)
            if mouth in ('grin', 'laugh'):
                self.feat('teeth', ellipsoid(hw * 0.8, 0.008, 0.011, 14, 6, center=(0, -0.01, zc + hh * 0.62)), mm['teeth'], 'head', head, mf)
            if mouth in ('laugh', 'open', 'gasp'):
                self.feat('tongue', ellipsoid(hw * 0.5, 0.008, hh * 0.3, 12, 6, center=(0, -0.008, zc - hh * 0.6)), mm['tongue'], 'head', head, mf)
            ring = []
            for k in range(29):
                a = k / 28 * math.tau
                ring.append(Vector((math.cos(a) * (hw + 0.006), -0.008, zc + math.sin(a) * (hh + 0.006))))
            self.feat('lipring', sweep(ring, lambda t: 0.008 + 0.004 * abs(math.sin(math.pi * 2 * t)), 8), mm['lips'], 'head', head, mf)
        elif mouth == 'frown':
            self.feat('lip', sweep(arc_points(w * 0.75, -0.02, 12, y=-0.006), 0.01, 8), mm['lips'], 'head', head, mf @ T(0, 0, -0.01))
        elif mouth == 'wobble':
            pts = [Vector(((i / 12 - 0.5) * w * 0.8, -0.006, math.sin(i / 12 * math.tau * 1.5) * 0.01)) for i in range(13)]
            self.feat('lip', sweep(pts, 0.01, 8), mm['lips'], 'head', head, mf)
        else:
            self.feat('lip', sweep([Vector((-w * 0.32, -0.006, 0)), Vector((w * 0.32, -0.006, 0))], 0.01, 8), mm['lips'], 'head', head, mf)
        del eyes

    def goggles(self, cs: HeadShape):
        """Silver goggles pushed up on the cowl, between the ears, on a thin strap."""
        mm = self.mat
        front, back = 36.0, 6.0

        def pitch(yaw):
            return back + (front - back) * (0.5 + 0.5 * math.cos(math.radians(yaw)))

        pts, nrms = [], []
        for i in range(73):
            yaw = -180.0 + 360.0 * i / 72
            p, n = cs.point(yaw, pitch(yaw), 0.008)
            pts.append(Vector(self.taper([tuple(p)])[0]))
            nrms.append(n)
        self.add('strap', flat_sweep(pts, 0.026, lambda t: nrms[min(72, int(round(t * 72)))], 0.3, 10, cap0=False, cap1=False), mm['black'],
                 'head')
        cups = {}
        for sd in (1, -1):
            yaw = 20.0 * sd
            p, n = cs.point(yaw, pitch(yaw) + 2.0, 0.0)
            p = Vector(self.taper([tuple(p)])[0])
            tilt = (n + Vector((0.0, -1.0, 0.0))).normalized()
            fr = frame_at(p + tilt * 0.035, tilt)
            self.add('cup', sweep([p - tilt * 0.01, p + tilt * 0.035], 0.07, 22, cap0=True, cap1=False), mm['silver'], 'head')
            self.add('cuprim', torus(0.07, 0.014, 28, 8), mm['silver'], 'head', fr @ R(90, 0, 0))
            self.add('glens', ellipsoid(0.06, 0.016, 0.06, 24, 10), mm['lens'], 'head', fr)
            self.add('gglint', ellipsoid(0.02, 0.004, 0.012, 10, 6, center=(-0.022, -0.016, 0.026)), mm['shine'], 'head', fr)
            cups[sd] = p + tilt * 0.01
        mid = (cups[-1] + cups[1]) * 0.5 + Vector((0.0, -0.01, 0.015))
        self.add('gbridge', sweep(curve3(cups[-1], mid, cups[1], 8), 0.014, 8), mm['silver'], 'head')


MODEL = Catwoman
