"""Tails (Sonic the Hedgehog), a fan-made chibi side character for the board cast (see cast.py).

Sonic's model (char_sonic.py) as a yellow-orange fox: white muzzle and chest fluff, blue eyes, a
tuft of bangs on the forehead and cheek fluff instead of the long quills, and the two big fluffy
tails with white tips springing from the hips. Same gloves and red-and-white sneakers.
"""
from __future__ import annotations

import math

from mathutils import Vector

from char_rig import polyline_segment, sweep
from char_sonic import Sonic, belly_mat, fur_mat


class Tails(Sonic):
    key = 'tails'
    C = dict(Sonic.C, blue='#f4a62a', blue_q='#ee9a1e', blue_ql='#ffc257', peach='#fbf7ef', peach_d='#e9e1d2', iris='#2f7fe0',
             iris_d='#1b4fa8')

    # bangs on the forehead and cheek fluff: (yaw, pitch, direction, length, root radius, flick)
    QUILLS = [
        (0, 62, (0.0, -0.55, 1.0), 0.3, 0.1, 0.12),
        (18, 58, (0.45, -0.45, 1.0), 0.26, 0.09, 0.1),
        (-18, 58, (-0.45, -0.45, 1.0), 0.26, 0.09, 0.1),
        (74, -24, (1.0, 0.15, -0.45), 0.2, 0.085, 0.05),
        (-74, -24, (-1.0, 0.15, -0.45), 0.2, 0.085, 0.05),
        (180, 30, (0.0, 1.0, -0.2), 0.16, 0.1, 0.05),
    ]

    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            blue=fur_mat(mt, 'tails_fur', c['blue']),
            belly=belly_mat(mt, 'tails_belly', c['blue'], c['peach'], 0.0, -0.08, 0.16, 0.24, -0.1),
            quill=mt.hair('tails_tuft', c['blue_q'], c['blue_ql'], 0.42),
            peach=mt.skin('tails_white', c['peach']),
            peach_d=mt.skin('tails_white_d', c['peach_d']),
            glove=mt.cloth('sonic_glove', c['glove'], 0.55, 0.3),
            shoe=mt.glossy('sonic_shoe', c['shoe'], 0.34, 0.35),
            shoe_d=mt.glossy('sonic_shoe_d', c['shoe_d'], 0.4, 0.3),
            strap=mt.cloth('sonic_strap', c['strap'], 0.5, 0.2),
            gold=mt.metal('sonic_gold', c['gold'], 0.28),
            sole=mt.cloth('sonic_sole', c['sole'], 0.6, 0.1),
            white=mt.glossy('sonic_eye_white', c['white'], 0.2, 0.7),
            iris=mt.glossy('tails_iris', c['iris'], 0.22, 0.8),
            iris_d=mt.glossy('tails_iris_d', c['iris_d'], 0.25, 0.8),
            pupil=mt.glossy('sonic_pupil', '#0d0d12', 0.25, 0.9),
            shine=mt.emit('sonic_shine', '#ffffff', 3.0),
            nose=mt.glossy('sonic_nose', c['nose'], 0.22, 0.8),
            mouth=mt.glossy('sonic_mouth', c['mouth'], 0.4, 0.2),
            tongue=mt.glossy('sonic_tongue', c['tongue'], 0.35, 0.3),
            teeth=mt.glossy('sonic_teeth', c['teeth'], 0.25, 0.4),
            line=mt.glossy('sonic_line', c['line'], 0.4, 0.2),
            tip=fur_mat(mt, 'tails_tip', '#fbf7ef'),
        )
        self.torso()
        self.legs()
        self.arms()
        self.head_parts()

    def torso(self):
        super().torso()
        # no back spines or stubby hedgehog tail: two big fluffy fox tails instead
        self.parts = [p for p in self.parts if p.name not in ('backspine', 'tail')]
        M = self.mat
        sway = 0.08 * math.sin(self.pose.get('extra', {}).get('wave', 0.0))
        for sd in (1, -1):
            base = Vector((0.045 * sd, 0.12, -0.08))
            d = Vector((1.05 * sd + sway, 0.8, 0.32)).normalized()
            pts = [base + d * (0.52 * t) + Vector((0.0, 0.0, 0.22 * t * t)) for t in (k / 16 for k in range(17))]

            def rad(t):
                return 0.045 + 0.105 * math.sin(math.pi * min(1.0, t * 1.08)) ** 0.7 + 0.004

            for (t0, t1, mat) in ((0.0, 0.72, M['blue']), (0.7, 1.0, M['tip'])):
                seg = polyline_segment(pts, t0, t1, 10)
                self.add('foxtail', sweep(seg, lambda t, t0=t0, t1=t1: rad(t0 + (t1 - t0) * t), 16, cap0=(t0 == 0.0)), mat, 'hips')


MODEL = Tails
