"""Alfred (Batman), a fan-made chibi side character for the board cast (see cast.py).

The butler, on the suited body helper (char_obama.SuitHero) with a head of his own: an older gent with
a balding crown and a tidy grey fringe round the sides and back, a neat grey moustache and composed,
half-lidded eyes; a black suit, white shirt and a black bow tie.
"""
from __future__ import annotations

import math

from char_models import DEFAULT_FACE, hair_shell, periodic_interp
from char_obama import SuitHero, clamp
from char_rig import HeadShape, R, T, ellipsoid, superellipsoid


class Alfred(SuitHero):
    key = 'alfred'
    ankle_h = 0.15
    hip_h = 0.66  # ankle_h + 0.04 + thigh + shin
    spine = 0.09
    chest = 0.21
    neck = 0.14
    head_up = 0.04
    shoulder = (0.21, 0.0, 0.11)
    upper_arm = 0.22
    forearm = 0.2
    hip_w = 0.1
    thigh = 0.23
    shin = 0.24
    sit_h = 0.18

    SQ = 0.76
    Z0 = -0.42
    ZB = -0.15
    V_TOP = 0.1
    CUT = 0.09
    LAPEL = 0.066
    TIE_W = 0.04
    TIE_TIP = -0.2
    NECK_R = 0.072
    SLEEVE_R = 0.078
    TROUSER_R = 0.09
    PELVIS = (0.19, 0.158)
    POCKET_Z = -0.3
    PIN_Z = 0.03
    SUIT = dict(suit='#1d1f26', lapel='#15171c', shirt='#f7f6f2', tie='#141417', tie_d='#0c0c0f', shoe='#141418', sole='#231f1d',
                belt='#141312', buckle='#c9ccd1', button='#0f1014')
    C = dict(skin='#f1cdb0', skin_d='#dcae8e', hair='#b9bcc1', hair_d='#8e9298', iris='#4d6f9c', brow='#a2a6ac', lash='#3a3230',
             moustache='#aeb2b8')
    HEAD = (0.38, 0.36, 0.4, 0.42)

    def rb(self, z: float) -> float:
        t = clamp((z - self.Z0) / (self.ZS - self.Z0))
        return 0.205 + 0.01 * math.sin(math.pi * t) - 0.006 * t

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.06

    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('alf_skin', c['skin']),
            skin_d=mt.skin('alf_skin_d', c['skin_d']),
            hair=mt.hair('alf_hair', c['hair_d'], c['hair'], 0.5),
            tash=mt.cloth('alf_moustache', c['moustache'], 0.6, 0.3),
        )
        self.dress_suit()
        # a bow tie instead of the long tie, and no lapel pin
        self.parts = [p for p in self.parts if not (p.name.startswith('tie') or p.name.startswith('pin') or p.name.startswith('knot'))]
        bow = self.sm['tie']
        top = self.body.z_top if hasattr(self.body, 'z_top') else self.ZS
        y = -self.body.rx(top - 0.02) * self.SQ - 0.012
        self.add('bowknot', ellipsoid(0.022, 0.018, 0.02, 12, 8, center=(0, y - 0.008, top - 0.03)), bow, 'chest')
        for sd in (1, -1):
            self.add('bow', superellipsoid(0.042, 0.016, 0.028, 2.6, 14, 8), bow, 'chest', T(0.04 * sd, y, top - 0.03) @ R(0, 12 * sd, 0))
        self.head_parts()

    def head_parts(self):
        c, mm = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        hv = [(x * (1 - 0.12 * max(0.0, (hc - z) / hz) ** 1.6), y - 0.02 * max(0.0, (hc - z) / hz) ** 2, z) for (x, y, z) in hv]
        self.add('head', (hv, hf), mm['skin'], 'head')
        for sd in (1, -1):
            em = T((hx - 0.014) * sd, 0.03, hc - 0.05) @ R(0, 0, -18 * sd)
            self.add('ear', ellipsoid(0.062, 0.038, 0.086, 16, 10), mm['skin'], 'head', em)
        fc = dict(DEFAULT_FACE)
        fc.update(self.pose.get('face', {}))
        saved = self.pose
        self.pose = dict(saved, face=dict(fc, eyes='half' if fc['eyes'] == 'open' else fc['eyes']))
        self.face(head, 'head', eye_yaw=22, eye_pitch=-4, eye_size=(0.078, 0.1), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-33,
                  lid_col=c['skin'], skin=c['skin'], brow_pitch=19, lash_col=c['lash'], blush=False)
        self.pose = saved
        # the neat grey moustache under the nose
        for sd in (1, -1):
            fr = head.frame(9 * sd, -21, 0.004, -14 * sd)
            self.feat('tash', ellipsoid(0.052, 0.016, 0.02, 14, 8), mm['tash'], 'head', head, fr)
        # thin grey hair combed straight back from a high, receding hairline
        hs = HeadShape(hx + 0.008, hy + 0.008, hz + 0.008, center=(0, 0.004, hc + 0.004))

        def boundary(yaw):
            return periodic_interp([(0, 52), (30, 46), (60, 20), (80, 0), (100, -8), (140, -16), (180, -18)], abs(yaw))

        def thickness(yaw, pitch, f):
            return 0.012 + 0.022 * min(1.0, f / 0.25) * (0.6 + 0.4 * min(1.0, abs(yaw) / 90))

        v, f, tp = hair_shell(hs, boundary, thickness, 120, 20)
        self.add('hair', (v, f), mm['hair'], 'head', tip=tp)
        # fuller at the sides, over the ears
        for yaw in range(66, 296, 9):
            if 110 < yaw < 250:
                continue
            fr = head.frame(yaw, -4.0, 0.012)
            self.feat('fringe', ellipsoid(0.05, 0.026, 0.064, 12, 8), mm['hair'], 'head', head, fr)


MODEL = Alfred
