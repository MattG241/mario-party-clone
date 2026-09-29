"""Krillin (Dragon Ball), a fan-made chibi side character for the board cast (see cast.py).

Goku's model (char_goku.py) with a shorter build, a bald round head with the six dots on the
forehead in two rows of three, and no hair at all. Same orange gi, sash and boots.
"""
from __future__ import annotations

from char_goku import Goku
from char_rig import ellipsoid
from char_rig import HeadShape


class Krillin(Goku):
    key = 'krillin'
    # shorter than Goku (hip_h = ankle_h + 0.04 + thigh + shin)
    chest = 0.18
    upper_arm = 0.19
    forearm = 0.17
    thigh = 0.19
    shin = 0.2
    hip_h = 0.15 + 0.04 + 0.19 + 0.2
    shoulder = (0.225, 0.0, 0.1)
    hip_w = 0.105

    HEAD = (0.39, 0.37, 0.38, 0.4)

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.06

    def hair(self):
        # bald: just the six dots on the forehead
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        dot = self.m.glossy('krillin_dot', '#5b2a1c', 0.45, 0.2)
        for pitch in (33.0, 45.0):
            for yaw in (-11.0, 0.0, 11.0):
                fr = head.frame(yaw, pitch, 0.002)
                self.feat('dot', ellipsoid(0.022, 0.007, 0.022, 12, 6), dot, 'head', head, fr)


MODEL = Krillin
