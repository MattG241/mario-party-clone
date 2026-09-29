"""Venom (Spider-Man films), a fan-made chibi side character for the board cast (see cast.py).

Spider-Man's model (char_spiderman.py) as the black symbiote: a glossy black suit (the web pattern
only survives as a faint texture), big white eyes, the large white spider across the chest and a
wide grin full of white fangs with a long pink tongue.
"""
from __future__ import annotations

import math

from mathutils import Vector

from char_models import DEFAULT_FACE
from char_rig import HeadShape, T, ellipsoid, sweep
from char_spiderman import MeshAcc, Spiderman


class Venom(Spiderman):
    key = 'venom'
    # the symbiote is black all over; 'line' draws the web, so it matches the suit
    C = dict(red='#17181f', red_d='#0c0c11', blue='#1d1e27', line='#23252f', lens='#fbfbff', rim='#08080b')
    # a little bulkier than Spider-Man
    shoulder = (0.24, 0.0, 0.11)

    def dress(self):
        super().dress()
        self.fangs()

    def spider_emblem(self):
        """The big white spider: body down the sternum, legs reaching out over the chest."""
        white = self.m.glossy('venom_white', '#f7f7fb', 0.3, 0.5)
        ez, k = self.EZ + 0.01, 2.3
        acc = MeshAcc()
        for (cx, cz, rx, rz) in ((0.0, 0.012, 0.021, 0.028), (0.0, -0.034, 0.026, 0.042), (0.0, 0.046, 0.014, 0.014)):
            v, f = ellipsoid(rx * k * 0.7, 0.012, rz * k * 0.8, 16, 10, center=(cx, 0.0, ez + cz * k * 0.8))
            acc.add((self.wrap_torso(v, 0.0), f))
        legs = [[(0.012, 0.028), (0.05, 0.062), (0.064, 0.118)], [(0.016, 0.016), (0.072, 0.036), (0.1, 0.08)],
                [(0.016, -0.002), (0.072, -0.018), (0.1, -0.064)], [(0.012, -0.014), (0.05, -0.05), (0.064, -0.112)]]
        for sd in (1, -1):
            for leg in legs:
                pts = []
                for (x0, z0), (x1, z1) in zip(leg, leg[1:]):
                    for j in range(6):
                        t = j / 6
                        pts.append((sd * k * (x0 + (x1 - x0) * t), 0.0, ez + k * 0.8 * (z0 + (z1 - z0) * t)))
                pts.append((sd * k * leg[-1][0], 0.0, ez + k * 0.8 * leg[-1][1]))
                wp = [Vector(p) for p in self.wrap_torso(pts, 0.004)]
                acc.add(sweep(wp, lambda t: 0.016 - 0.007 * t, 8))
        self.add('spider', acc.mesh, white, 'chest')

    def fangs(self):
        """A wide grin below the eyes: dark mouth, two rows of white fangs, a tongue lolling out."""
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        mouth = self.m.glossy('venom_mouth', '#3a0d16', 0.4, 0.2)
        tooth = self.m.glossy('venom_tooth', '#fbfaf2', 0.25, 0.5)
        tongue = self.m.glossy('venom_tongue', '#e0567a', 0.35, 0.4)
        gape = {'laugh': 1.35, 'open': 1.2, 'gasp': 1.25, 'o': 1.1}.get(f['mouth'], 1.0)
        fr = head.frame(0, -24, 0.0)
        w, h = 0.27, 0.075 * gape
        self.hfeat('mouth', ellipsoid(w, 0.02, h, 28, 12), mouth, head, fr)
        for row, zs in ((1, h * 0.55), (-1, -h * 0.55)):
            for i in range(9):
                x = (i / 8 - 0.5) * 2 * w * 0.86
                edge = 1 - (x / w) ** 2
                ln = 0.038 * (0.6 + 0.6 * edge)
                self.hfeat('fang', ellipsoid(0.012, 0.012, ln * 0.5, 8, 6, center=(x, -0.012, zs * edge - row * ln * 0.35)), tooth, head, fr)
        if f['mouth'] in ('laugh', 'open', 'grin', 'gasp'):
            self.hfeat('tongue', ellipsoid(0.05, 0.02, 0.07, 14, 8, center=(0.03, -0.03, -h - 0.04)), tongue, head, fr)


MODEL = Venom
