"""Frieza (Dragon Ball), a fan-made chibi side character for the board cast (see cast.py).

The villain in his final form, on Goku's model (char_goku.py: skeleton, the sharper eye with its slight
lid) made shorter and slimmer: a smooth glossy white body with violet dome plates on the crown of the
head, the shoulders, the forearms and the shins, red eyes under dark markings, purple lips set in a
cold smirk (his resting face), small rounded white feet and a long white tail with a violet tip that
curls out behind him and swishes with pose['extra']['wave'].
"""
from __future__ import annotations

import math

from mathutils import Vector

from char_goku import Goku, clamp
from char_models import DEFAULT_FACE, hair_shell, hand_mitten, periodic_interp
from char_rig import HeadShape, R, T, curve3, ellipsoid, polyline_segment, superellipsoid, sweep


def bspline(ctrl, n: int = 32):
    """A smooth uniform cubic B-spline through the control polygon (clamped at both ends)."""
    c = [Vector(p) for p in ctrl]
    c = [c[0], c[0]] + c + [c[-1], c[-1]]
    out = []
    segs = len(c) - 3
    for i in range(n + 1):
        u = i / n * segs
        k = min(segs - 1, int(u))
        t = u - k
        p0, p1, p2, p3 = c[k], c[k + 1], c[k + 2], c[k + 3]
        b0 = (1 - t) ** 3 / 6
        b1 = (3 * t ** 3 - 6 * t ** 2 + 4) / 6
        b2 = (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6
        b3 = t ** 3 / 6
        out.append(p0 * b0 + p1 * b1 + p2 * b2 + p3 * b3)
    return out


class Frieza(Goku):
    key = 'frieza'
    ankle_h = 0.13
    thigh = 0.2
    shin = 0.2
    hip_h = 0.13 + 0.04 + 0.2 + 0.2
    spine = 0.08
    chest = 0.18
    neck = 0.12
    head_up = 0.04
    shoulder = (0.205, 0.0, 0.1)
    upper_arm = 0.19
    forearm = 0.17
    hip_w = 0.095
    sit_h = 0.16

    C = dict(Goku.C, white='#f3f2f6', white_d='#dcd8e4', purple='#8044b8', purple_d='#5b2b8c', lips='#5e2a7c', mark='#3a1b4c',
             iris='#d4142c', lash='#121014')
    HEAD = (0.39, 0.37, 0.385, 0.41)

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.1

    def body_mat(self, name: str, color: str):
        return self.m.glossy(name, color, 0.32, 0.45)

    # --- building -------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        # his lips (the face's mouth material) are purple
        mt.glossy('mouth', c['lips'], 0.35, 0.4)
        self.mat = dict(
            white=self.body_mat('fz_white', c['white']),
            white_d=self.body_mat('fz_white_d', c['white_d']),
            purple=mt.glossy('fz_purple', c['purple'], 0.18, 0.9),
            purple_d=mt.glossy('fz_purple_d', c['purple_d'], 0.25, 0.7),
        )
        self.torso()
        self.legs()
        self.arms()
        self.tail()
        self.head_parts()

    @staticmethod
    def rb(z):
        """Torso half-width at chest-frame height z: slim, a little broader at the chest."""
        t = (z + 0.34) / 0.44
        return 0.178 + 0.02 * math.sin(math.pi * clamp(t) * 0.85)

    def torso(self):
        mm = self.mat
        rb = self.rb
        self.add('torso', sweep([Vector((0, 0, -0.34 + 0.44 * i / 10)) for i in range(11)], lambda t: rb(-0.34 + 0.44 * t), 28, cap0=False,
                                cap1=False, squash=0.82), mm['white'], 'chest')
        self.add('shoulders', ellipsoid(rb(0.1), rb(0.1) * 0.82, 0.09, 28, 14, center=(0, 0, 0.1), zmin=-0.2), mm['white'], 'chest')
        # the faint line of the chest plate
        pts = [Vector((math.cos(a) * (rb(-0.02) + 0.002), math.sin(a) * (rb(-0.02) + 0.002) * 0.82, -0.02 - 0.05 * math.cos(a) ** 2))
               for a in [math.radians(-160 + 140 * k / 16) for k in range(17)]]
        self.add('pecline', sweep(pts, 0.007, 6), mm['white_d'], 'chest')
        # purple domes on the shoulders
        for sd in (1, -1):
            sx, sy, sz = self.shoulder
            # leaning out a little over the arm
            self.add('pauldron', ellipsoid(0.105, 0.1, 0.082, 24, 14), mm['purple'], 'chest', T(sx * sd * 0.98, 0.0, sz + 0.03) @ R(0, -14 * sd, 0))
        self.add('pelvis', superellipsoid(0.19, 0.16, 0.14, 2.4, 28, 16, center=(0, 0, -0.03)), mm['white'], 'hips')
        a0 = self.J('chest') @ Vector((0.0, 0.0, 0.1))
        b0 = self.J('neck') @ Vector((0.0, 0.0, 0.03))
        c0 = self.J('head') @ Vector((0.0, 0.01, 0.12))
        self.add('neck', sweep(curve3(a0, b0, c0, 6), 0.07, 14), mm['white'])

    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.086 - 0.03 * t + 0.008 * math.sin(math.pi * clamp((t - 0.45) / 0.4)), mm['white'],
                      0.0, 1.0, 16, 14, cap0=True, cap1=True)
            # the violet shin plate: a dome over the front of the lower leg
            self.limb('shin' + s_, hip, kn, an, lambda t: 0.07 + 0.014 * math.sin(math.pi * t), mm['purple'], 0.55, 0.85, 16, 8, cap0=True,
                      cap1=True)
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('foot' + s_, superellipsoid(0.074, 0.12, 0.06, 2.4, 20, 12, center=(0, -0.05, -0.07)), mm['white'], None, fm)
            for k, dx in enumerate((-0.03, 0.03)):
                self.add(f'toe{k}{s_}', ellipsoid(0.04, 0.05, 0.042, 14, 8, center=(dx, -0.15, -0.088)), mm['white'], None, fm)

    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.06 - 0.012 * t + 0.006 * math.sin(math.pi * clamp(t / 0.5)), mm['white'], 0.0, 1.0,
                      14, 16, extend=0.02)
            self.limb('forearm' + s_, sh, el, wr, lambda t: 0.06 + 0.014 * math.sin(math.pi * t), mm['purple'], 0.56, 0.9, 16, 8, cap0=True,
                      cap1=True)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.12):
                self.add('hand' + nm + s_, mesh, mm['white'], None, wm)

    def tail(self):
        """The long tail from the small of the back: out behind, then curling round to his left and up."""
        mm = self.mat
        wave = self.pose.get('extra', {}).get('wave', 0.0)
        sw = 0.06 * math.sin(wave)
        ctrl = [(0.0, 0.12, -0.02), (0.04, 0.3, -0.2), (0.22 + sw, 0.42, -0.36), (0.46 + sw, 0.32, -0.36), (0.6 + sw, 0.12, -0.18),
                (0.6 + sw * 1.5, 0.02, 0.08), (0.5 + sw * 2, 0.04, 0.26)]
        pts = bspline(ctrl, 40)

        def rad(t):
            return 0.07 * (1 - t) ** 0.8 + 0.026

        for (t0, t1, mat) in ((0.0, 0.86, mm['white']), (0.85, 1.0, mm['purple'])):
            seg = polyline_segment(pts, t0, t1, 18)
            self.add('tail', sweep(seg, lambda t, t0=t0, t1=t1: rad(t0 + (t1 - t0) * t) * (1.0 if t1 < 1.0 else 1.0 + 0.25 * math.sin(math.pi * t)),
                                   16, cap0=(t0 == 0.0)), mat, 'hips')

    # --- head -------------------------------------------------------------------------------------
    def head_parts(self):
        c, mm = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        hv = [(x * (1 - 0.1 * max(0.0, (hc - z) / hz) ** 1.6), y - 0.02 * max(0.0, (hc - z) / hz) ** 2, z) for (x, y, z) in hv]
        self.add('head', (hv, hf), mm['white'], 'head')
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        # a cold smirk at rest; a sneering grin when pleased
        mouth = {'smile': 'smirk'}.get(f['mouth'], f['mouth'])
        brows = 'determined' if f['brows'] == 'neutral' else f['brows']
        saved = self.pose
        self.pose = dict(saved, face=dict(f, mouth=mouth, brows=brows))
        self.face(head, 'head', eye_yaw=24, eye_pitch=-5, eye_size=(0.088, 0.104), iris=c['iris'], brow_col=c['mark'], mouth_pitch=-31,
                  mouth_w=0.9, lid_col=c['white'], skin=c['white'], blush=False, brow_pitch=19, lash_col=c['lash'])
        self.pose = saved
        # the violet dome over the crown, its front edge dipping to a point over the brow
        hs = HeadShape(hx + 0.006, hy + 0.006, hz + 0.006, center=(0, 0.0, hc))

        def boundary(yaw):
            return periodic_interp([(0, 34), (16, 37), (36, 36), (62, 24), (90, 12), (130, 2), (180, -6)], abs(yaw))

        def thickness(yaw, pitch, fr):
            return 0.008 + 0.085 * math.sin(math.pi * 0.5 * min(1.0, fr / 0.75)) ** 0.9

        v, fc, _tp = hair_shell(hs, boundary, thickness, 140, 24)
        self.add('dome', (v, fc), mm['purple'], 'head')
        # small ear holes at the sides of the head
        for sd in (1, -1):
            fr = head.frame(88 * sd, -6, 0.0)
            self.feat('earhole', ellipsoid(0.03, 0.01, 0.036, 12, 6), mm['purple_d'], 'head', head, fr)


MODEL = Frieza
