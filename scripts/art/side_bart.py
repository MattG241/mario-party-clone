"""Bart (The Simpsons), a fan-made chibi side character for the board cast (see cast.py).

Homer's model (char_homer.py) as his son: a slim kid's body with no potbelly, the crown of nine
spikes on top of the head, a clean yellow muzzle (no stubble), a red T-shirt, blue shorts over bare
yellow legs and blue sneakers.
"""
from __future__ import annotations

import math

from mathutils import Vector

from char_homer import Homer
from char_rig import ellipsoid, superellipsoid, sweep


class Bart(Homer):
    key = 'bart'
    ankle_h = 0.12
    thigh = 0.17
    shin = 0.17
    hip_h = 0.12 + 0.04 + 0.17 + 0.17
    hip_w = 0.1
    shoulder = (0.2, 0.0, 0.07)
    upper_arm = 0.17
    forearm = 0.15
    # a slim kid's body (spine frame egg) and chest
    BELLY = (0.2, 0.19, 0.17, 0.2, 0.18, (0.0, 0.0, -0.03))
    CHEST = (0.2, 0.16, 0.15, (0.0, 0.01, -0.02))
    C = dict(Homer.C, stubble='#fed41d', stubble_d='#e3a712', shirt='#e8452f', shirt_d='#c23422', pants='#3f78d1', pants_d='#2f5fae',
             shoe='#2f5fae', sole='#f2f0ea')

    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            # shorts to the knee, then bare legs and sneakers
            self.limb('short' + s_, hip, kn, an, lambda t: 0.1 + 0.012 * t, M['pants'], 0.0, 0.5, 18, 10, cap0=True, cap1=False)
            self.limb('shem' + s_, hip, kn, an, 0.108, M['pants_d'], 0.47, 0.52, 18, 2, cap0=False, cap1=False)
            self.limb('leg' + s_, hip, kn, an, 0.05, M['skin'], 0.45, 1.0, 12, 10, cap0=False, cap1=True)
            from char_rig import R
            fm = self.J(an) @ R(0, 0, -8 * sd)
            self.add('shoe' + s_, superellipsoid(0.09, 0.14, 0.066, 2.5, 22, 14, center=(0, -0.045, -0.055)), M['shoe'], None, fm)
            self.add('toe' + s_, ellipsoid(0.088, 0.08, 0.058, 18, 10, center=(0, -0.12, -0.068)), M['shoe'], None, fm)
            self.add('sole' + s_, superellipsoid(0.098, 0.156, 0.024, 3.0, 22, 8, center=(0, -0.052, -0.099)), M['sole'], None, fm)

    def torso(self):
        super().torso()
        # a T-shirt has no collar or buttons
        self.parts = [p for p in self.parts if not (p.name.startswith('button') or p.name.startswith('collar') or p.name == 'pelvis')]
        self.add('pelvis', superellipsoid(0.2, 0.17, 0.13, 2.4, 32, 18, center=(0, 0.02, -0.05)), self.mat['pants'], 'hips')

    def hairs(self):
        """The crown of nine spikes round the flat top of the head (yellow, like the rest of him)."""
        M = self.mat
        rx, ry, rz, cz = self.CRAN
        n = 9
        for k in range(n):
            a = k / n * math.tau + 0.2
            ring = Vector((math.cos(a) * rx * 0.62, math.sin(a) * ry * 0.62, 0.0))
            p, nrm = self.cran.surface(Vector((ring.x, ring.y, rz * 0.8)))
            d = (Vector((ring.x * 0.55, ring.y * 0.55, 0.0)) + Vector((0.0, 0.0, 1.0)) * 0.9).normalized()
            pts = [p - nrm * 0.03 + d * (0.2 * t) for t in (i / 8 for i in range(9))]
            self.add(f'spike{k}', sweep(pts, lambda t: 0.075 * (1 - t) ** 1.1 + 0.004, 12), M['skin'], 'head')
        # fill the crown between the spikes
        self.add('crown', ellipsoid(rx * 0.7, ry * 0.7, 0.08, 28, 10, center=(0, 0, cz + rz * 0.86), zmin=-0.2), M['skin'], 'head')

    def fringe(self):
        pass


MODEL = Bart
