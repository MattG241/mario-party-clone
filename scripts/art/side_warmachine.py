"""War Machine (Iron Man films), a fan-made chibi side character for the board cast (see cast.py).

Iron Man's armour (char_ironman.py) repainted in War Machine's gunmetal grey with dark joints and a
silver faceplate, plus the signature rotary cannon on a mount over the right shoulder.
"""
from __future__ import annotations

from mathutils import Vector

from char_ironman import Ironman
from char_rig import T, ellipsoid, sweep, superellipsoid


class Warmachine(Ironman):
    key = 'warmachine'
    C = dict(red='#7d8590', red_d='#4a5059', gold='#d7dbe0', gunmetal='#2a2d33', glow='#f2fbff', core='#e8f8ff', ring='#9fdcff',
             seam='#15171b', sole='#1d1f23')

    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            red=self.paint('wm_grey', c['red'], 0.7, 0.34),
            red_d=self.paint('wm_grey_d', c['red_d'], 0.6, 0.4),
            gold=self.paint('wm_silver', c['gold'], 0.85, 0.28),
            gun=mt.metal('wm_gunmetal', c['gunmetal'], 0.4),
            seam=mt.glossy('wm_seam', c['seam'], 0.5, 0.2),
            sole=mt.cloth('wm_sole', c['sole'], 0.6, 0.1),
            glow=mt.emit('wm_glow', c['glow'], 6.0),
            glow_dim=mt.emit('wm_glow_dim', c['glow'], 2.2),
            core=mt.emit('wm_core', c['core'], 3.2),
            ring=mt.emit('wm_ring', c['ring'], 2.6),
            halo=self.glow_alpha('wm_halo', c['ring'], 1.4, 0.18),
        )
        self.torso()
        self.legs()
        self.arms()
        self.helmet()
        self.cannon()

    def cannon(self):
        """The rotary cannon on its mount outside the right pauldron, angled forward and out."""
        import math
        mm = self.mat
        # outside the right pauldron (the big chibi helmet fills the space above the shoulder)
        base = Vector((-(self.shoulder[0] + 0.19), 0.03, self.shoulder[2] + 0.03))
        d = Vector((-0.5, -0.86, 0.06)).normalized()
        side = d.cross(Vector((0.0, 0.0, 1.0))).normalized()
        up = side.cross(d).normalized()
        self.add('wm_mount', superellipsoid(0.08, 0.1, 0.06, 3.0, 20, 12, center=tuple(base)), mm['red_d'], 'chest')
        self.add('wm_drum', sweep([base - d * 0.04, base + d * 0.16], 0.08, 18), mm['red'], 'chest')
        for k in range(6):
            a = k / 6 * math.tau
            off = side * (math.cos(a) * 0.042) + up * (math.sin(a) * 0.042)
            self.add('wm_barrel', sweep([base + off + d * 0.14, base + off + d * 0.5], 0.018, 10), mm['gun'], 'chest')
        self.add('wm_band', sweep([base + d * 0.44, base + d * 0.48], 0.066, 18), mm['red_d'], 'chest')
        self.add('wm_bolt', ellipsoid(0.032, 0.032, 0.032, 12, 8), mm['gold'], 'chest', T(*(base + up * 0.07)))


MODEL = Warmachine
