"""Kakashi (Naruto), a fan-made chibi side character for the board cast (see cast.py).

Naruto's model (char_naruto.py) with a tall shock of silver hair swept up and over to one side, the
forehead protector slanted down over his left eye, a navy mask over the nose and mouth, and the
green flak vest over a navy long-sleeved outfit.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from char_models import DEFAULT_FACE
from char_naruto import Naruto, head_band, leaf_symbol
from char_rig import HeadShape, cloth_strip, ellipsoid, superellipsoid, sweep, T, R


class Kakashi(Naruto):
    key = 'kakashi'
    C = dict(Naruto.C, hair_d='#8e98a4', hair_l='#f4f6f9', orange='#2b3552', orange_d='#202840', black='#262f47', collar='#58744a',
             zip='#44563a', swirl='#2b3552', band='#27314d', band_d='#1d253b', sandal='#2e3a58', sandal_d='#222c45', holster='#2b3552',
             iris='#3a2e28', brow='#8e98a4', vest='#5f7d4c', mask='#29334f')

    def band_pitch(self, yaw: float) -> float:
        # slanted: it dips down over his left eye at the front
        base = super().band_pitch(yaw)
        return base - 34.0 * max(0.0, math.cos(math.radians(yaw - 28.0))) ** 2

    def jacket_mat(self, name: str):
        """The green flak vest (the jacket part), with a navy yoke over the shoulders."""
        return self.m.cloth('kak_vest', self.C['vest'], 0.72, 0.35, 0.12)

    def dress(self):
        super().dress()
        # a navy mask over the nose, mouth and neck, up to just under the eyes
        hx, hy, hz, hc = self.HEAD
        mask = self.m.cloth('kak_mask', self.C['mask'], 0.7, 0.35, 0.06)
        self.add('mask', ellipsoid(hx + 0.014, hy + 0.014, hz + 0.012, 40, 26, center=(0, 0, hc), zmax=-0.25), mask, 'head')
        self.add('masknose', ellipsoid(0.05, 0.03, 0.035, 14, 8, center=(0, -(hy + 0.012), hc + hz * -0.3)), mask, 'head')

    def head_parts(self):
        c, mm = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        self.add('head', (hv, hf), mm['skin'], 'head')
        for sd in (1, -1):
            self.add('ear', ellipsoid(0.062, 0.04, 0.082, 16, 10), mm['skin'], 'head', T((hx - 0.01) * sd, 0.03, hc - 0.05) @ R(0, 0, -14 * sd))
        # eyes and brows only (the mask hides the rest); a sleepy lid on the visible eye
        fc = dict(DEFAULT_FACE)
        fc.update(self.pose.get('face', {}))
        saved = self.pose
        eyes = fc['eyes'] if fc['eyes'] != 'open' else 'half'
        self.pose = dict(saved, face=dict(fc, mouth='none', eyes=eyes))
        ey, ep = self.EYE
        self.face(head, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(0.085, 0.108), iris=c['iris'], brow_col='#6f7883', mouth_pitch=-30,
                  lid_col=c['skin'], skin=None, brow_pitch=20, blush=False, lash_col='#2a2a30')
        self.pose = saved
        self.hair(head)

    def hair(self, head: HeadShape):
        super().hair(head)
        # no face-framing locks; the spikes sweep up and over to his left
        self.parts = [p for p in self.parts if p.name != 'locks']
        hc = self.HEAD[3]
        rot = Matrix.Rotation(math.radians(-24.0), 3, 'Y')
        for p in self.parts:
            if p.name == 'spikes':
                p.verts = [tuple(rot @ (Vector(v) - Vector((0, 0, hc + 0.1))) + Vector((0.03, 0, hc + 0.1))) for v in p.verts]

    def headband(self):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        bs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))
        self.add('band', head_band(bs, self.band_pitch, self.BAND_HALF, 0.012, 0.03), mm['band'], 'head')
        yaw = 12.0
        ps = HeadShape(hx + 0.054, hy + 0.054, hz + 0.052, center=(0, 0.01, hc + 0.012))
        fr = ps.frame(yaw, self.band_pitch(yaw), 0.0, -17.0)
        self.feat('plate', superellipsoid(0.175, 0.016, 0.07, 4.5, 36, 14, center=(0, 0.0, 0)), mm['plate'], 'head', ps, fr)
        for k, pl in enumerate(leaf_symbol(0.125, -0.0135)):
            self.feat(f'leaf{k}', sweep(pl, 0.0058, 6), mm['engrave'], 'head', ps, fr)
        kp, _kn = bs.point(180.0, self.band_pitch(180.0), 0.04)
        self.add('knot', ellipsoid(0.05, 0.036, 0.042, 14, 10, center=tuple(kp)), mm['band_d'], 'head')
        for k, (sd, ln) in enumerate(((1, 0.34), (-1, 0.3))):
            pts = [kp + Vector((sd * (0.025 + 0.1 * t), 0.02 + 0.05 * t, -ln * t)) for t in (i / 12 for i in range(13))]
            self.add(f'tail{k}', cloth_strip(pts, lambda t: 0.08 + 0.012 * t, Vector((0.0, 1.0, 0.25)).normalized(), 1.5,
                                             lambda t: 0.004 + 0.012 * t, 0.018, 8), mm['band'], 'head')


MODEL = Kakashi
