"""Patrick (SpongeBob SquarePants), a fan-made chibi side character for the board cast (see cast.py).

Built on SpongeBob's skeleton (char_spongebob.py: the body is the 'head', with the arms on its
sides): a pink starfish whose body rises to a rounded point on top, stubby pointed arms and legs,
green shorts with purple flowers, and a face of big eyes under thick dark brows and a wide mouth.
"""
from __future__ import annotations

import math

from mathutils import Vector

import lib
from char_models import Hero
from char_rig import HeadShape, R, ellipsoid, sweep
from char_spongebob import Spongebob


class Patrick(Spongebob):
    key = 'patrick'
    ankle_h = 0.1
    hip_h = 0.5
    shoulder = (0.3, 0.0, 0.34)  # on the body's sides (head frame)
    upper_arm = 0.16
    forearm = 0.15
    hip_w = 0.14
    thigh = 0.18
    shin = 0.18
    sit_h = 0.12
    C = dict(pink='#f7a1b8', pink_d='#e27f9c', shorts='#8ccf4d', shorts_d='#6fae39', flower='#9b59c9', flower_c='#f3d64a',
             brow='#1a1416', iris='#1a1416')
    HEAD_S = (0.33, 0.29, 0.34, 0.62)  # the face ellipsoid: rx, ry, rz, centre height (head frame)

    def head_top(self) -> float:
        return 1.2

    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            pink=mt.skin('pat_pink', c['pink']),
            pink_d=mt.skin('pat_pink_d', c['pink_d']),
            shorts=mt.cloth('pat_shorts', c['shorts'], 0.72, 0.35, 0.08),
            shorts_d=mt.cloth('pat_shorts_d', c['shorts_d'], 0.72, 0.3),
            flower=mt.cloth('pat_flower', c['flower'], 0.6, 0.3),
            flower_c=mt.cloth('pat_flower_c', c['flower_c'], 0.6, 0.3),
        )
        self.body()
        self.legs()
        self.arms()
        self.star_face()

    def body(self):
        M = self.mat
        rx, ry, rz, cz = self.HEAD_S
        # a pear below, the face dome, and the rounded point on top
        prof = []
        for i in range(21):
            t = i / 20
            z = -0.1 + 0.62 * t
            r = 0.3 + 0.07 * math.sin(math.pi * min(1.0, t * 1.2)) - 0.02 * t
            prof.append((r, z))
        self.add('body', lib.lathe(prof, 40, cap_bottom=True, cap_top=False, squash_y=0.86), M['pink'], 'head')
        self.add('dome', ellipsoid(rx, ry, rz, 40, 26, center=(0, 0, cz)), M['pink'], 'head')
        tip = [Vector((0.0, 0.01, cz + rz * 0.5 + 0.34 * t)) for t in (k / 10 for k in range(11))]
        self.add('point', sweep(tip, lambda t: 0.24 * (1 - t) ** 1.2 + 0.03, 28), M['pink'], 'head')
        # green shorts round the bottom (hips frame) with purple flowers
        sprof = [(0.36 + 0.035 * math.sin(math.pi * k / 10), -0.17 + 0.36 * k / 10) for k in range(11)]
        self.add('shorts', lib.lathe(sprof, 40, cap_bottom=True, cap_top=False, squash_y=0.86), M['shorts'], 'hips')
        for k in range(9):
            a = math.radians(-60 + k * 40)
            x, y = math.sin(a) * 0.395, -math.cos(a) * 0.395 * 0.86
            z = -0.03 + 0.05 * math.sin(k * 1.7)
            n = Vector((math.sin(a), -math.cos(a), 0.0))
            m = lib.look_at(Vector((x, y, z)), n) if hasattr(lib, 'look_at') else None
            for j in range(5):
                pa = a + math.radians(0.0)
                off = Vector((math.cos(j / 5 * math.tau) * 0.034, 0.0, math.sin(j / 5 * math.tau) * 0.034))
                c = Vector((x, y, z)) + Vector((off.x * math.cos(pa), off.x * math.sin(pa), off.z))
                self.add('petal', ellipsoid(0.024, 0.024, 0.024, 10, 6, center=tuple(c + n * 0.012)), M['flower'], 'hips')
            self.add('fcentre', ellipsoid(0.016, 0.016, 0.016, 8, 6, center=tuple(Vector((x, y, z)) + n * 0.03)), M['flower_c'], 'hips')
            del m

    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.12 * (1 - t) + 0.05, M['pink'], 0.0, 1.0, 16, 14, cap0=True, cap1=True, extend=0.05)

    def arms(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.105 * (1 - t) ** 0.9 + 0.035, M['pink'], 0.0, 1.0, 14, 14, cap0=True, cap1=True, extend=0.06)

    def star_face(self):
        rx, ry, rz, cz = self.HEAD_S
        head = HeadShape(rx, ry, rz, center=(0, 0, cz))
        # his resting face is a wide open grin
        saved = self.pose
        f = dict(saved.get('face', {}))
        if f.get('mouth', 'smile') == 'smile':
            self.pose = dict(saved, face=dict(f, mouth='grin'))
        Hero.face(self, head, 'head', eye_yaw=13.0, eye_pitch=9.0, eye_size=(0.105, 0.135), iris=self.C['iris'], brow_col=self.C['brow'],
                  mouth_pitch=-24.0, mouth_w=1.9, nose=False, skin=self.C['pink'], blush=False, brow_pitch=24.0)
        self.pose = saved


MODEL = Patrick
