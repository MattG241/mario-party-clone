"""Chopper (One Piece), a fan-made chibi side character for the board cast (see cast.py).

Built on Sonic's model (char_sonic.py) as the little reindeer doctor: brown fur with a tan muzzle and
the round blue nose, small ears sticking out sideways, branching antlers, the big pink top hat with a
white cross on the front, dark hooves for hands and feet, and orange shorts. Shorter than the others.
"""
from __future__ import annotations

import math

from mathutils import Vector

from char_models import hand_mitten
from char_rig import HeadShape, R, T, ellipsoid, flat_sweep, superellipsoid, sweep, torus
from char_sonic import Sonic, fur_mat


class Chopper(Sonic):
    key = 'chopper'
    thigh = 0.15
    shin = 0.15
    hip_h = 0.145 + 0.04 + 0.15 + 0.15
    upper_arm = 0.16
    forearm = 0.15
    C = dict(Sonic.C, blue='#8a5530', peach='#e9c9a0', peach_d='#d2ab7d', nose='#2f6fd6', iris='#2a1a12', iris_d='#140c08',
             hoof='#3a2a22', hat='#f08ab5', hat_d='#d46a98', cross='#fbfbf6', antler='#8a6440', shorts='#f08a2c')
    QUILLS = []

    def dress(self):
        c, mt = self.C, self.m
        fur = fur_mat(mt, 'chop_fur', c['blue'])
        hoof = mt.glossy('chop_hoof', c['hoof'], 0.45, 0.3)
        self.mat = dict(
            blue=fur, belly=fur, quill=fur, glove=hoof, shoe=hoof, sole=hoof,
            peach=mt.skin('chop_muzzle', c['peach']),
            peach_d=mt.skin('chop_muzzle_d', c['peach_d']),
            strap=hoof, gold=hoof,
            white=mt.glossy('sonic_eye_white', c['white'], 0.2, 0.7),
            iris=mt.glossy('chop_iris', c['iris'], 0.22, 0.8),
            iris_d=mt.glossy('chop_iris_d', c['iris_d'], 0.25, 0.8),
            pupil=mt.glossy('sonic_pupil', '#0d0d12', 0.25, 0.9),
            shine=mt.emit('sonic_shine', '#ffffff', 3.0),
            nose=mt.glossy('chop_nose', c['nose'], 0.22, 0.8),
            mouth=mt.glossy('sonic_mouth', c['mouth'], 0.4, 0.2),
            tongue=mt.glossy('sonic_tongue', c['tongue'], 0.35, 0.3),
            teeth=mt.glossy('sonic_teeth', c['teeth'], 0.25, 0.4),
            line=mt.glossy('sonic_line', c['line'], 0.4, 0.2),
            hat=mt.cloth('chop_hat', c['hat'], 0.6, 0.35, 0.05),
            hat_d=mt.cloth('chop_hat_d', c['hat_d'], 0.6, 0.3),
            cross=mt.cloth('chop_cross', c['cross'], 0.6, 0.3),
            antler=mt.cloth('chop_antler', c['antler'], 0.55, 0.3, 0.08),
            shorts=mt.cloth('chop_shorts', c['shorts'], 0.72, 0.35, 0.08),
        )
        self.torso()
        self.legs()
        self.arms()
        self.head_parts()
        self.hat()

    def torso(self):
        super().torso()
        self.parts = [p for p in self.parts if p.name not in ('backspine',)]
        self.add('shorts', superellipsoid(0.19, 0.165, 0.12, 2.4, 28, 14, center=(0, 0, -0.06)), self.mat['shorts'], 'hips')

    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.07 - 0.012 * t, M['blue'], 0.0, 0.97, 12, 12)
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('hoof' + s_, superellipsoid(0.08, 0.1, 0.06, 2.4, 18, 10, center=(0, -0.03, -0.06)), M['shoe'], None, fm)

    def arms(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.055 - 0.008 * t, M['blue'], 0.0, 0.95, 12, 12)
            hand = self.pose.get('hand' + s_, 'fist')
            for nm, mesh in hand_mitten(sd, hand, 1.05):
                self.add('hoof' + nm + s_, mesh, M['glove'], None, self.J(wr))

    def ears(self, head: HeadShape):
        M = self.mat
        for sd in (1, -1):
            pos, _n = head.point(68 * sd, 18, -0.04)
            d = Vector((1.0 * sd, 0.15, -0.1)).normalized()
            nrm = Vector((0.0, -1.0, 0.3)).normalized()
            pts = [pos + d * (0.2 * t) for t in (k / 8 for k in range(9))]
            self.add('ear', flat_sweep(pts, lambda t: 0.075 * math.sin(math.pi * min(1.0, 0.15 + t)) + 0.006, nrm, 0.4, 14), M['blue'], 'head')

    def hat(self):
        """The big pink top hat, set back on the head, with a white cross; antlers poke out of its sides."""
        M = self.mat
        hx, hy, hz, hc = self.HEAD
        top = hc + hz * 0.78
        tilt = T(0, 0.06, top) @ R(-10, 0, 0)
        self.add('brim', ellipsoid(0.4, 0.37, 0.045, 36, 10), M['hat_d'], 'head', tilt)
        crown = [Vector((0, 0, 0.02 + 0.44 * t)) for t in (k / 10 for k in range(11))]
        self.add('crown', sweep(crown, lambda t: 0.3 + 0.03 * math.sin(math.pi * t), 32, squash=0.92), M['hat'], 'head', tilt)
        self.add('crowntop', ellipsoid(0.33, 0.3, 0.07, 32, 10, center=(0, 0, 0.46)), M['hat'], 'head', tilt)
        self.add('hatband', torus(0.305, 0.022, 36, 8, center=(0, 0, 0.08), squash=1.0), M['hat_d'], 'head', tilt)
        # the white cross on the front of the crown
        for a in (45, -45):
            self.add('cross', superellipsoid(0.13, 0.02, 0.035, 3.0, 16, 8), M['cross'], 'head', tilt @ T(0, -0.3, 0.26) @ R(0, a, 0))
        # antlers out of the hat's sides, each with a fork
        for sd in (1, -1):
            b = Vector((0.3 * sd, 0.02, 0.2))
            main = [b + Vector((0.2 * sd * t, 0.0, 0.34 * t + 0.08 * t * t)) for t in (k / 8 for k in range(9))]
            self.add('antler', sweep(main, lambda t: 0.034 * (1 - 0.5 * t), 10), M['antler'], 'head', tilt)
            fork = main[4]
            prong = [fork + Vector((0.14 * sd * t, -0.02 * t, 0.08 * t)) for t in (k / 6 for k in range(7))]
            self.add('prong', sweep(prong, lambda t: 0.024 * (1 - 0.5 * t), 8), M['antler'], 'head', tilt)


MODEL = Chopper
