"""Plankton (SpongeBob SquarePants), a fan-made chibi side character for the board cast (see cast.py).

Patrick's model (side_patrick.py, on SpongeBob's skeleton: the body is the 'head', with the arms on its
sides) shrunk into a stout little green bean: an egg-shaped body, a little narrower at the top, with
two thin antennae; one big yellow eye with a red iris filling the upper half of his front under a thick
black unibrow (V-shaped by default, ever scheming); a wide mouth below it; thin green arms with tiny
mitten hands and thin legs on small feet. He is far bigger than his show self so he reads at sprite
size, but still the smallest of the cast.
"""
from __future__ import annotations

import math

from mathutils import Vector

from char_homer import EggHead
from char_models import DEFAULT_FACE, hand_mitten
from char_rig import HeadShape, R, T, arc_points, ellipsoid, sweep
from char_spongebob import strip
from side_patrick import Patrick


class Plankton(Patrick):
    key = 'plankton'
    ankle_h = 0.07
    thigh = 0.14
    shin = 0.14
    hip_h = 0.39  # ankle_h + 0.04 + thigh + shin
    hip_w = 0.1
    shoulder = (0.32, 0.0, 0.17)  # on the body's sides (head frame)
    upper_arm = 0.16
    forearm = 0.15
    sit_h = 0.12
    # the bean (head frame): rx, ry front / back, rz top / bottom, centre
    BODY = (0.37, 0.315, 0.3, 0.62, 0.39, (0.0, 0.0, 0.11))
    EYE = (0.345, 0.2, 0.115, 0.198)  # centre height, radii (x, depth, z)
    C = dict(green='#4aa245', green_d='#2f7c35', sclera='#f8e95e', iris='#d8322a', pupil='#121212', brow='#141414',
             mouth='#3a1013', tongue='#d9606e', teeth='#fbf8ec')

    def head_top(self) -> float:
        return self.BODY[5][2] + self.BODY[3] + 0.36

    def face_state(self):
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        return f

    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            green=mt.skin('plk_green', c['green']),
            green_d=mt.skin('plk_green_d', c['green_d']),
            sclera=mt.glossy('plk_sclera', c['sclera'], 0.2, 0.8),
            iris=mt.glossy('plk_iris', c['iris'], 0.22, 0.8),
            pupil=mt.glossy('plk_pupil', c['pupil'], 0.25, 0.9),
            shine=mt.emit('plk_shine', '#ffffff', 3.0),
            brow=mt.cloth('plk_brow', c['brow'], 0.55, 0.2),
            mouth=mt.glossy('plk_mouth', c['mouth'], 0.4, 0.2),
            tongue=mt.glossy('plk_tongue', c['tongue'], 0.35, 0.3),
            teeth=mt.glossy('plk_teeth', c['teeth'], 0.25, 0.4),
        )
        rx, ryf, ryb, rzt, rzb, ctr = self.BODY
        self.bean = EggHead(rx, ryf, ryb, rzt, rzb, center=ctr)
        self.add('body', self.bean.mesh(48, 32), self.mat['green'], 'head')
        self.antennae()
        self.legs()
        self.arms()
        f = self.face_state()
        self.eye(f)
        self.unibrow(f)
        self.mouth(f['mouth'])

    # --- helpers ----------------------------------------------------------------------------------
    def front(self, x: float, z: float, lift: float = 0.0) -> Vector:
        """The point of the bean's front at (x, z) (head frame), lifted along the normal."""
        rx, ryf, _ryb, rzt, rzb, ctr = self.BODY
        dz = z - ctr[2]
        rz = rzt if dz > 0 else rzb
        y = -ryf * math.sqrt(max(0.0, 1.0 - (x / rx) ** 2 - (dz / rz) ** 2))
        n = Vector((x / rx ** 2, y / ryf ** 2, dz / rz ** 2)).normalized()
        return Vector((x, y, z)) + n * lift

    # --- body -------------------------------------------------------------------------------------
    def antennae(self):
        M = self.mat
        ex = self.pose.get('extra', {})
        spread = 0.3 + 0.25 * max(-0.3, min(1.0, ex.get('tail', 0.0)))
        wob = math.sin(ex.get('wave', 0.0))
        for sd in (1, -1):
            base, n = self.bean.point(90.0 * sd, 74.0, -0.025)
            d = Vector((spread * sd, -0.06, 1.0)).normalized()
            bend = Vector((0.12 * sd, 0.02 * wob, -0.05))
            pts = [base + d * (0.4 * t) + bend * (0.4 * t * t) for t in (k / 12 for k in range(13))]
            self.add('antenna' + ('L' if sd > 0 else 'R'), sweep(pts, lambda t: 0.025 - 0.008 * t, 10), M['green'], 'head')
            self.add('antip', ellipsoid(0.022, 0.022, 0.022, 10, 6, center=tuple(pts[-1])), M['green'], 'head')

    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('leg' + s_, hip, kn, an, 0.04, M['green'], 0.0, 1.0, 12, 12, cap0=True, cap1=True)
            fm = self.J(an) @ R(0, 0, -10 * sd)
            self.add('foot' + s_, ellipsoid(0.06, 0.098, 0.042, 16, 10, center=(0, -0.046, -0.03)), M['green'], None, fm)

    def arms(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, 0.035, M['green'], 0.0, 1.0, 10, 14, cap0=True, extend=0.01)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 0.76):
                self.add('hand' + nm + s_, mesh, M['green'], None, wm)

    # --- face -------------------------------------------------------------------------------------
    def eye(self, f):
        """One big eye, sunk into the upper front of the bean."""
        M = self.mat
        kind = f['eyes']
        if kind == 'wink':
            kind = 'happy'
        lx, lz = f.get('look', (0.0, 0.0))
        k = 1.06 if kind == 'wide' else 1.0
        ez, ra, rb, rc = self.EYE
        ra, rb, rc = ra * k, rb * k, rc * k
        ec = self.front(0.0, ez) + Vector((0.0, rb * 0.42, 0.0))
        eye = HeadShape(ra, rb, rc, center=tuple(ec))
        self.add('eye', ellipsoid(ra, rb, rc, 30, 20, center=tuple(ec)), M['sclera'], 'head')
        shut = kind in ('happy', 'closed')
        if kind == 'dizzy':
            pts = []
            for i in range(48):
                a = i / 48 * math.tau * 2.4
                r = 0.012 + (ra * 0.7 - 0.012) * i / 48
                pts.append(Vector((math.cos(a) * r, -0.004, math.sin(a) * r)))
            self.feat('spiral', sweep(pts, 0.009, 6), M['pupil'], 'head', eye, eye.frame(0, 0, 0.0))
        elif not shut:
            ir = 0.8 if kind == 'wide' else 1.0
            fr = eye.frame(lx * 18.0, -3.0 + lz * 14.0, 0.0)
            ri = 0.099 * ir
            self.feat('iris', ellipsoid(ri, 0.006, ri * 1.04, 24, 8), M['iris'], 'head', eye, fr)
            self.feat('pupil', ellipsoid(ri * 0.46, 0.007, ri * 0.48, 18, 6, center=(0, -0.002, 0)), M['pupil'], 'head', eye, fr)
            self.feat('shine', ellipsoid(ri * 0.3, 0.004, ri * 0.3, 10, 5, center=(-ri * 0.38, -0.006, ri * 0.4)), M['shine'], 'head', eye, fr)
            self.feat('shine2', ellipsoid(ri * 0.12, 0.004, ri * 0.12, 8, 4, center=(ri * 0.42, -0.006, -ri * 0.4)), M['shine'], 'head',
                      eye, fr)
        lid = {'half': (0.42, 0.0), 'sad': (0.36, -16.0), 'determined': (0.34, 16.0)}.get(kind)
        if shut:
            lid = (1.0, 0.0)
        if lid:
            level, slant = lid
            lm = T(*ec) @ R(0, -slant, 0)
            self.add('lid', ellipsoid(ra * 1.05, rb * 1.12, rc * 1.05, 30, 14, zmin=-1.0 if shut else 1.0 - 2.0 * level), M['green'], 'head', lm)
            if shut:
                ls = HeadShape(ra * 1.05, rb * 1.12, rc * 1.05, center=tuple(ec))
                h = -0.35 if kind == 'happy' else 0.16
                pts = [p + Vector((0, 0, -rc * 0.1)) for p in arc_points(ra * 1.6, rc * h, 14, y=-0.004)]
                self.feat('shutline', sweep(pts, lambda t: 0.009 + 0.004 * math.sin(math.pi * t), 8), M['brow'], 'head', ls, ls.frame(0, 0, 0.0))
            else:
                zc = rc * 1.05 * (1.0 - 2.0 * level)
                pts = [Vector((math.sin(a) * ra * 1.07, -math.cos(a) * rb * 1.14, zc)) for a in (-1.35 + 2.7 * i / 14 for i in range(15))]
                pts = [lm.to_3x3() @ p + Vector(ec) for p in pts]
                self.add('lidline', sweep(pts, 0.008, 6), M['brow'], 'head')

    def unibrow(self, f):
        """The thick black brow right across the top of the eye: a V when scheming (his default)."""
        brows, eyes = f['brows'], f['eyes']
        ez, ra, _rb, rc = self.EYE
        zb = ez + rc + 0.035 + (0.023 if eyes == 'wide' else 0.0)
        # height of the middle relative to the ends (negative: a V), and an overall arch
        mid = {'neutral': -0.06, 'up': 0.0, 'worried': 0.06, 'sad': 0.06, 'angry': -0.1, 'determined': -0.08}.get(brows, -0.06)
        arch = 0.04 if brows == 'up' else 0.014
        lift = 0.035 if brows == 'up' else 0.0
        pts = []
        for i in range(17):
            u = i / 16 * 2 - 1
            z = zb + lift + mid * (1 - abs(u)) ** 1.2 + arch * (1 - u * u) - 0.5 * mid
            pts.append(self.front(u * ra * 1.08, z, 0.024))
        self.add('brow', sweep(pts, lambda t: 0.032 + 0.016 * math.sin(math.pi * t), 10, squash=0.75), self.mat['brow'], 'head')

    def mouth(self, mouth: str):
        M = self.mat
        bean = self.bean
        fr = bean.frame(0.0, -6.0, 0.0)

        def feat(name, mesh, mat):
            self.feat(name, mesh, mat, 'head', bean, fr)

        line = lambda t: 0.013 + 0.005 * math.sin(math.pi * t)  # noqa: E731
        w = 0.39
        if mouth in ('smile', 'smirk'):
            tilt = 0.03 if mouth == 'smirk' else 0.0
            pts = []
            for i in range(21):
                t = i / 20 * 2 - 1
                pts.append(Vector((t * w / 2, -0.006, -0.058 * (1 - t * t) + tilt * t + 0.035 * abs(t) ** 5)))
            feat('mouth', sweep(pts, line, 8), M['mouth'])
        elif mouth in ('grin', 'open', 'laugh'):
            depth = {'grin': 0.1, 'open': 0.125, 'laugh': 0.15}[mouth]
            ww = {'grin': 0.37, 'open': 0.28, 'laugh': 0.35}[mouth]

            def top(x):
                t = x / (ww / 2)
                return -0.03 * (1 - t * t) + 0.025 * abs(t) ** 4

            def bot(x):
                t = x / (ww / 2)
                return top(x) - depth * max(0.0, 1 - t * t) ** 0.7

            feat('mouth', strip(top, bot, -ww / 2, ww / 2, 28, 6, 0.004), M['mouth'])
            feat('tongue', ellipsoid(ww * 0.2, 0.006, depth * 0.28, 16, 6, center=(0.0, -0.005, -0.03 - depth * 0.62)), M['tongue'])
            if mouth == 'grin':
                tw = ww * 0.36
                feat('teeth', strip(lambda x: top(x) - 0.003, lambda x: top(x) - 0.022, -tw, tw, 18, 2, 0.0055, 0.0045), M['teeth'])
        elif mouth == 'o':
            feat('mouth', ellipsoid(0.046, 0.006, 0.055, 18, 6, center=(0, -0.002, -0.035)), M['mouth'])
        elif mouth == 'gasp':
            feat('mouth', ellipsoid(0.075, 0.006, 0.08, 20, 6, center=(0, -0.002, -0.046)), M['mouth'])
            feat('tongue', ellipsoid(0.037, 0.007, 0.023, 12, 6, center=(0, -0.005, -0.098)), M['tongue'])
        else:
            pts = []
            for i in range(17):
                t = i / 16 * 2 - 1
                if mouth == 'frown':
                    z = 0.035 * (1 - t * t) - 0.04
                elif mouth == 'wobble':
                    z = 0.012 * math.sin(t * math.pi * 2.5) - 0.03
                else:  # flat
                    z = -0.03
                pts.append(Vector((t * w * 0.34, -0.006, z)))
            feat('mouth', sweep(pts, line, 8), M['mouth'])


MODEL = Plankton
