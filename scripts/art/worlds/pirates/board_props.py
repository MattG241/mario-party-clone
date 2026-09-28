"""Pirate Cove's landmarks, modelled in code (original designs, no emblems or lettering).

Builders take a board anchor (the prop's ground point) and a scale, add geometry to a props.Prop
(one builder per surface: stone, metal, paint, wood, leaf, glow, crystal) and return its objects.
The galleon is split: its hull and deck are baked into the terrain (people walk on the deck) and its
masts, sails and rigging are a sprite drawn behind the deck spaces.
"""
from __future__ import annotations

import math

import numpy as np
from mathutils import Vector

import lib
import props
from lib import board_to_world, col

DECK_Z = 0.6  # the galleon's deck height (its spaces sit on it; board y is shifted to match)
WOOD_D = col('#5e3b22')
WOOD_M = col('#8a5a34')
WOOD_L = col('#b07a45')
CREAM = col('#fff4dc')
GOLD = col('#f2c14e')
RED = col('#d9483b')


def _w(bx, by, z=0.0):
    return board_to_world(bx, by, z)


def deck_ground_y(screen_y):
    """Ground y (board px) whose point at deck height shows at screen_y."""
    return screen_y + DECK_Z * 100.0 * lib.SINB


# ------------------------------------------------------------------------------------------
# The galleon
class Galleon:
    """A merchant galleon moored E-W (bow to the east). `x0`, `x1`: stern and bow ends (board px);
    `cy`: the keel line's screen y at deck height (the deck spaces sit a little south of it)."""

    def __init__(self, x0, x1, cy, beam=2.5):
        self.x0, self.x1 = x0, x1
        self.cy_screen = cy
        self.gy = deck_ground_y(cy)  # ground y of the centreline
        self.beam = beam  # world units across

    def half_beam(self, t):
        """Half width (world units) at t in 0 (stern) .. 1 (bow)."""
        b = self.beam / 2
        if t > 0.72:  # the bow narrows to the stem
            u = (t - 0.72) / 0.28
            return b * math.sqrt(max(0.0, 1 - u ** 2.2)) + 0.02
        if t < 0.08:  # a rounded, square-ish stern
            u = (0.08 - t) / 0.08
            return b * (1 - 0.18 * u * u)
        return b

    def hull(self, P):
        """Hull, deck, bulwarks, stern castle, forecastle, gunports and the cheerful figurehead."""
        x0, x1 = self.x0 / 100.0, self.x1 / 100.0
        yc = _w(0, self.gy).y
        rows = 26
        ts = np.linspace(0, 1, rows)
        # hull sides: from the deck edge (DECK_Z) down to the waterline and a rounded bilge
        profile = [(1.0, DECK_Z + 0.02), (1.02, DECK_Z - 0.25), (0.98, DECK_Z - 0.6), (0.86, DECK_Z - 0.95), (0.6, DECK_Z - 1.25), (0.2, DECK_Z - 1.4)]
        verts, faces = [], []
        for t in ts:
            x = x0 + (x1 - x0) * t
            hb = self.half_beam(t)
            sheer = 0.12 * (2 * t - 1) ** 2 + (0.18 if t < 0.2 else 0.0) * (0.2 - t) / 0.2  # rises fore and aft
            for sgn in (-1, 1):
                for (k, z) in profile:
                    verts.append((x, yc + sgn * hb * k, z + sheer * (z > DECK_Z - 0.3)))
        per = len(profile) * 2
        for r in range(rows - 1):
            for sgn_i in range(2):
                for j in range(len(profile) - 1):
                    a = r * per + sgn_i * len(profile) + j
                    faces.append((a, a + 1, a + per + 1, a + per))
        from terrain import orient
        faces = orient(faces, verts, lambda c: Vector((0.0, c.y - yc, -0.3)))
        P.b['paint'].add(verts, faces, lambda vv: col('#2f5d7a') if vv[2] < DECK_Z - 0.62 else (col('#f4e6c8') if vv[2] < DECK_Z - 0.48 else col('#7a4a2a')))
        # deck
        dverts, dfaces = [], []
        for t in ts:
            x = x0 + (x1 - x0) * t
            hb = self.half_beam(t) * 0.97
            dverts += [(x, yc - hb, DECK_Z), (x, yc + hb, DECK_Z)]
        for r in range(rows - 1):
            a = r * 2
            dfaces.append((a, a + 2, a + 3, a + 1))
        dfaces = orient(dfaces, dverts, lambda c: Vector((0, 0, 1)))
        P.deck.add(dverts, dfaces, col('#c9955c'))
        # bulwarks (low rails) with a gold cap, broken where the gangplanks come aboard
        for sgn in (-1, 1):
            pts = []
            for t in np.linspace(0.02, 0.96, 40):
                x = x0 + (x1 - x0) * t
                hb = self.half_beam(t)
                pts.append((x, yc + sgn * hb, DECK_Z + 0.2 + 0.1 * (2 * t - 1) ** 2))
            v, f = lib.tube(pts, 0.035, 6)
            P.b['metal' if sgn < 0 else 'wood'].add(v, f, GOLD if sgn < 0 else WOOD_D)
            for t in np.linspace(0.04, 0.94, 22):
                x = x0 + (x1 - x0) * t
                hb = self.half_beam(t)
                v, f = lib.cylinder((x, yc + sgn * hb, DECK_Z), 0.018, 0.018, 0.22 + 0.1 * (2 * t - 1) ** 2, 6)
                P.b['wood'].add(v, f, WOOD_M)
        # gunports with little cannon muzzles on the camera side
        for t in np.linspace(0.2, 0.7, 5):
            x = x0 + (x1 - x0) * t
            hb = self.half_beam(t)
            v, f = lib.box((x, yc - hb - 0.01, DECK_Z - 0.32), (0.2, 0.03, 0.16))
            P.b['paint'].add(v, f, col('#1f2a33'))
            v, f = lib.cylinder((0, 0, 0), 0.045, 0.04, 0.16, 10)
            v = lib.transform(v, loc=(x, yc - hb - 0.01, DECK_Z - 0.32), rot=(math.pi / 2, 0.0, 0.0))
            P.b['metal'].add(v, f, col('#3a3f48'))
        # stern castle (a raised quarterdeck with a cabin and lantern) and a small forecastle
        sx = x0 + 0.15
        v, f = lib.box((sx + 0.35, yc, DECK_Z + 0.28), (0.9, self.beam * 0.9, 0.56))
        P.b['paint'].add(v, f, col('#8a4a2a'))
        v, f = lib.box((sx + 0.35, yc, DECK_Z + 0.58), (0.98, self.beam * 0.96, 0.05))
        P.b['wood'].add(v, f, WOOD_L)
        for k in range(3):
            v, f = lib.box((sx + 0.05 + k * 0.3, yc - self.beam * 0.45 - 0.005, DECK_Z + 0.3), (0.16, 0.02, 0.18))
            P.b['glow'].add(v, f, col('#ffd27a'))
        # the stern lantern
        v, f = lib.cylinder((x0 + 0.05, yc, DECK_Z + 0.6), 0.02, 0.02, 0.4, 6)
        P.b['wood'].add(v, f, WOOD_D)
        v, f = lib.lathe([(0.0, 0.0), (0.07, 0.03), (0.08, 0.14), (0.05, 0.2), (0.0, 0.22)], 10, (x0 + 0.05, yc, DECK_Z + 1.0))
        P.b['glow'].add(v, f, col('#ffc36a'))
        fx = x1 - 0.95
        v, f = lib.box((fx, yc, DECK_Z + 0.16), (0.7, self.beam * 0.62, 0.32))
        P.b['paint'].add(v, f, col('#8a4a2a'))
        v, f = lib.box((fx, yc, DECK_Z + 0.34), (0.76, self.beam * 0.66, 0.04))
        P.b['wood'].add(v, f, WOOD_L)
        # hatch, barrels and coiled rope on deck (north side, behind the spaces)
        for (u, dy) in [(0.45, 0.55), (0.5, 0.7), (0.58, 0.62)]:
            bx = x0 + (x1 - x0) * u
            v, f = lib.lathe([(0.1, 0.0), (0.12, 0.1), (0.12, 0.2), (0.1, 0.3), (0.0, 0.3)], 12, (bx, yc + dy, DECK_Z), cap_bottom=False)
            P.b['wood'].add(v, f, lambda vv: col('#6b6f78') if abs(vv[2] - DECK_Z - 0.15) > 0.1 else col('#9a6436'))
        v, f = lib.lathe([(0.16, 0.0), (0.16, 0.05), (0.06, 0.05), (0.06, 0.0)], 18, (x0 + (x1 - x0) * 0.7, yc + 0.55, DECK_Z))
        P.b['wood'].add(v, f, col('#d8c29a'))
        self.figurehead(P, x1, yc)
        return yc

    def figurehead(self, P, x1, yc):
        """A grinning monkey-faced figurehead on the stem, and the bowsprit."""
        stem = (x1 + 0.05, yc, DECK_Z - 0.1)
        v, f = lib.tube([(x1 - 0.2, yc, DECK_Z + 0.25), (x1 + 1.25, yc, DECK_Z + 0.75)], lambda t: 0.06 - 0.03 * t, 8)
        P.b['wood'].add(v, f, WOOD_M)
        hx, hz = stem[0] + 0.12, stem[2] + 0.12
        v, f = lib.blob((hx, yc, hz), 0.22, squash=(1.0, 0.95, 1.0), rough=0.02, subdiv=3)
        P.b['paint'].add(v, f, col('#9a5a2e'))
        for sgn in (-1, 1):  # ears
            v, f = lib.blob((hx - 0.02, yc + sgn * 0.22, hz + 0.05), 0.08, squash=(0.5, 1.0, 1.0), rough=0.0, subdiv=2)
            P.b['paint'].add(v, f, col('#e8b98a'))
        v, f = lib.blob((hx + 0.11, yc, hz - 0.02), 0.16, squash=(0.6, 1.0, 0.85), rough=0.0, subdiv=2)
        P.b['paint'].add(v, f, col('#f0c89a'))
        for sgn in (-1, 1):  # eyes and rosy cheeks
            v, f = lib.blob((hx + 0.2, yc + sgn * 0.06, hz + 0.05), 0.028, rough=0.0, subdiv=1)
            P.b['paint'].add(v, f, col('#1d1410'))
            v, f = lib.blob((hx + 0.19, yc + sgn * 0.11, hz - 0.03), 0.035, squash=(0.5, 1, 0.7), rough=0.0, subdiv=1)
            P.b['paint'].add(v, f, col('#ff8f8f'))
        grin = [(hx + 0.2, yc + math.sin(a) * 0.08, hz - 0.07 - math.cos(a) * 0.03) for a in np.linspace(-1.2, 1.2, 8)]
        v, f = lib.tube(grin, 0.012, 5)
        P.b['paint'].add(v, f, col('#6a2a1a'))
        v, f = lib.lathe([(0.0, 0.0), (0.12, 0.02), (0.12, 0.05), (0.0, 0.06)], 16, (hx - 0.02, yc, hz + 0.2))
        P.b['metal'].add(v, f, GOLD)  # a little gold crown band

    def rig(self, P):
        """Two masts with gaff sails (in the keel plane, so they face the camera), a jib, a crow's
        nest, shrouds and festival pennants."""
        x0, x1 = self.x0 / 100.0, self.x1 / 100.0
        yc = _w(0, self.gy).y
        masts = [(x0 + (x1 - x0) * 0.26, 3.7), (x0 + (x1 - x0) * 0.72, 3.3)]
        for i, (mx, h) in enumerate(masts):
            v, f = lib.cylinder((mx, yc, DECK_Z), 0.075, 0.05, h, 10)
            P.b['wood'].add(v, f, WOOD_M)
            # crow's nest on the main mast
            if i == 0:
                v, f = lib.lathe([(0.2, 0.0), (0.22, 0.18), (0.18, 0.2), (0.0, 0.2)], 16, (mx, yc, DECK_Z + h * 0.78))
                P.b['wood'].add(v, f, WOOD_L)
            # gaff sail: a trapezoid aft of the mast with a gentle belly, cream with a red band
            boom_z, top_z = DECK_Z + 0.75, DECK_Z + h * (0.7 if i == 0 else 0.74)
            L = 1.45 if i == 0 else 1.3
            cols_, rows_ = 8, 8
            verts, faces = [], []
            for r in range(rows_ + 1):
                v_ = r / rows_
                z = boom_z + (top_z - boom_z) * v_
                span = L * (1.0 - 0.12 * v_)
                for c in range(cols_ + 1):
                    u = c / cols_
                    belly = 0.16 * math.sin(u * math.pi) * math.sin(v_ * math.pi * 0.9 + 0.1)
                    verts.append((mx - 0.08 - span * u, yc - belly, z + 0.35 * u * v_))
            for r in range(rows_):
                for c in range(cols_):
                    a = r * (cols_ + 1) + c
                    faces.append((a, a + 1, a + cols_ + 2, a + cols_ + 1))
            P.b['paint'].add(verts, faces + [tuple(reversed(fc)) for fc in faces],
                             lambda vv, b0=boom_z, t0=top_z: RED if 0.42 < (vv[2] - b0) / (t0 - b0 + 0.35) < 0.56 else CREAM)
            # boom and gaff spars
            v, f = lib.tube([(mx, yc, boom_z), (mx - L - 0.1, yc, boom_z)], 0.03, 6)
            P.b['wood'].add(v, f, WOOD_D)
            v, f = lib.tube([(mx, yc, top_z), (mx - L * 0.88 - 0.1, yc, top_z + 0.35)], 0.028, 6)
            P.b['wood'].add(v, f, WOOD_D)
            # pennant at the masthead
            tip = DECK_Z + h
            tri = [(mx, yc, tip), (mx, yc, tip - 0.22), (mx + 0.55, yc, tip - 0.1)]
            P.b['paint'].add(tri, [(0, 1, 2), (2, 1, 0)], col(['#ff6b5e', '#f4b83b'][i]))
            # shrouds down to both rails
            for sgn in (-1, 1):
                for dx in (-0.25, 0.0, 0.25):
                    v, f = lib.tube([(mx, yc, DECK_Z + h * 0.8), (mx + dx, yc + sgn * self.beam * 0.5, DECK_Z + 0.25)], 0.008, 4)
                    P.b['wood'].add(v, f, col('#4a3a2a'))
        # jib from the foremast to the bowsprit tip
        fm, fh = masts[1]
        bow_tip = (x1 + 1.2, yc, DECK_Z + 0.72)
        head = (fm + 0.05, yc, DECK_Z + fh * 0.8)
        foot = (fm + 0.35, yc, DECK_Z + 0.55)
        verts = [head, bow_tip, foot]
        P.b['paint'].add(verts, [(0, 1, 2), (2, 1, 0)], CREAM)
        v, f = lib.tube([head, bow_tip], 0.01, 4)
        P.b['wood'].add(v, f, col('#4a3a2a'))
        # stay between the masts
        v, f = lib.tube([(masts[0][0], yc, DECK_Z + masts[0][1] * 0.95), (fm, yc, DECK_Z + fh * 0.9)], 0.008, 4)
        P.b['wood'].add(v, f, col('#4a3a2a'))


def feast_table(P, bx, by, z=DECK_Z, s=1.0):
    """A long plank table heaped with a feast: meat on the bone, a roast, fruit and jugs."""
    p = _w(bx, by, z)
    x, y = p.x, p.y
    v, f = lib.box((x, y, z + 0.28 * s), (1.2 * s, 0.34 * s, 0.05 * s))
    P.b['wood'].add(v, f, WOOD_L)
    for dx in (-0.52, 0.52):
        for dy in (-0.12, 0.12):
            v, f = lib.box((x + dx * s, y + dy * s, z + 0.13 * s), (0.05 * s, 0.05 * s, 0.26 * s))
            P.b['wood'].add(v, f, WOOD_D)
    top = z + 0.31 * s
    for k, dx in enumerate((-0.42, -0.14, 0.14, 0.42)):
        # meat on the bone: a plump brown drumstick with two white knuckles
        a = 0.4 if k % 2 else -0.4
        v, f = lib.blob((0.0, 0.0, 0.0), 0.075 * s, squash=(1.5, 1.0, 0.95), rough=0.08, subdiv=2)
        v = lib.transform(v, loc=(x + dx * s, y + 0.02 * s, top + 0.06 * s), rot=(0.0, 0.0, a))
        P.b['paint'].add(v, f, col('#a0522d'))
        for sgn in (-1, 1):
            q = (x + dx * s + sgn * math.cos(a) * 0.14 * s, y + 0.02 * s + sgn * math.sin(a) * 0.14 * s, top + 0.05 * s)
            v, f = lib.blob(q, 0.028 * s, rough=0.0, subdiv=1)
            P.b['paint'].add(v, f, CREAM)
    # a roast on a platter and a fruit bowl
    v, f = lib.lathe([(0.0, 0.0), (0.16, 0.0), (0.17, 0.02), (0.0, 0.02)], 16, (x, y - 0.05 * s, top))
    P.b['metal'].add(v, f, col('#d8d8d8'))
    v, f = lib.blob((x, y - 0.05 * s, top + 0.07 * s), 0.1 * s, squash=(1.2, 1.0, 0.7), rough=0.1, subdiv=2)
    P.b['paint'].add(v, f, col('#b8602e'))
    for k in range(5):
        a = k / 5 * math.tau
        v, f = lib.blob((x + 0.3 * s + math.cos(a) * 0.05 * s, y - 0.08 * s + math.sin(a) * 0.04 * s, top + 0.05 * s), 0.035 * s, rough=0.0, subdiv=1)
        P.b['paint'].add(v, f, col(['#ff5a4a', '#ffb33a', '#8bd346', '#ff9a1f', '#ffd166'][k]))
    for dx in (-0.3, 0.52):
        v, f = lib.lathe([(0.04, 0.0), (0.05, 0.06), (0.03, 0.12), (0.035, 0.14)], 10, (x + dx * s, y + 0.1 * s, top), cap_top=False)
        P.b['paint'].add(v, f, col('#d9a066'))


# ------------------------------------------------------------------------------------------
# Island landmarks
def lighthouse(bx, by, s=1.0) -> list:
    """A red-and-white striped lighthouse on a stone base, with a gallery, a glowing lamp room, a
    domed cap and a little keeper's cottage beside it."""
    P = props.Prop('lighthouse')
    p = _w(bx, by)
    x, y = p.x, p.y
    v, f = lib.lathe([(0.62 * s, 0.0), (0.62 * s, 0.22 * s), (0.5 * s, 0.26 * s), (0.0, 0.26 * s)], 28, (x, y, 0))
    P.b['stone'].add(v, f, col('#d8cbb8'))
    H = 3.3 * s
    bands = 6
    for k in range(bands):
        z0, z1 = 0.26 * s + k * H / bands, 0.26 * s + (k + 1) * H / bands
        r0 = 0.46 * s - 0.14 * s * k / bands
        r1 = 0.46 * s - 0.14 * s * (k + 1) / bands
        v, f = lib.lathe([(r0, z0), (r1, z1)], 28, (x, y, 0), cap_bottom=False, cap_top=False)
        P.b['paint'].add(v, f, col('#e8483b') if k % 2 == 0 else col('#fbf6ee'))
    top = 0.26 * s + H
    v, f = lib.lathe([(0.3 * s, top), (0.46 * s, top), (0.46 * s, top + 0.08 * s), (0.3 * s, top + 0.08 * s)], 28, (x, y, 0))
    P.b['paint'].add(v, f, col('#3a3f48'))
    for k in range(16):
        a = k / 16 * math.tau
        v, f = lib.cylinder((x + math.cos(a) * 0.43 * s, y + math.sin(a) * 0.43 * s, top + 0.08 * s), 0.012 * s, 0.012 * s, 0.2 * s, 5)
        P.b['metal'].add(v, f, col('#3a3f48'))
    v, f = lib.lathe([(0.44 * s, top + 0.28 * s), (0.45 * s, top + 0.28 * s)], 28, (x, y, 0), cap_bottom=False, cap_top=False)
    P.b['metal'].add(v, f, col('#3a3f48'))
    v, f = lib.lathe([(0.26 * s, top + 0.08 * s), (0.26 * s, top + 0.52 * s)], 20, (x, y, 0), cap_bottom=False, cap_top=False)
    P.b['glow'].add(v, f, col('#fff0b0'))
    for k in range(6):
        a = k / 6 * math.tau
        v, f = lib.cylinder((x + math.cos(a) * 0.26 * s, y + math.sin(a) * 0.26 * s, top + 0.08 * s), 0.015 * s, 0.015 * s, 0.44 * s, 5)
        P.b['metal'].add(v, f, col('#3a3f48'))
    v, f = lib.lathe([(0.32 * s, top + 0.52 * s), (0.2 * s, top + 0.7 * s), (0.06 * s, top + 0.8 * s), (0.0, top + 0.82 * s)], 20, (x, y, 0))
    P.b['paint'].add(v, f, col('#e8483b'))
    v, f = lib.blob((x, y, top + 0.9 * s), 0.06 * s, rough=0.0, subdiv=1)
    P.b['metal'].add(v, f, GOLD)
    # door and windows on the camera side
    v, f = lib.box((x, y - 0.44 * s, 0.5 * s), (0.2 * s, 0.03, 0.4 * s))
    P.b['wood'].add(v, f, WOOD_M)
    for k in range(2):
        v, f = lib.box((x, y - (0.4 - k * 0.04) * s, (1.5 + k * 1.1) * s), (0.12 * s, 0.03, 0.18 * s))
        P.b['glow'].add(v, f, col('#ffd27a'))
    # keeper's cottage
    cx, cy = x + 0.95 * s, y + 0.3 * s
    v, f = lib.box((cx, cy, 0.3 * s), (0.8 * s, 0.6 * s, 0.6 * s))
    P.b['paint'].add(v, f, col('#fbf6ee'))
    for sgn in (-1, 1):
        verts = [(cx - 0.45 * s, cy + sgn * 0.36 * s, 0.58 * s), (cx + 0.45 * s, cy + sgn * 0.36 * s, 0.58 * s), (cx + 0.45 * s, cy, 0.95 * s), (cx - 0.45 * s, cy, 0.95 * s)]
        P.b['paint'].add(verts, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#3f7fd9'))
    v, f = lib.box((cx, cy - 0.31 * s, 0.22 * s), (0.18 * s, 0.03, 0.34 * s))
    P.b['wood'].add(v, f, WOOD_M)
    v, f = lib.box((cx + 0.24 * s, cy - 0.31 * s, 0.38 * s), (0.16 * s, 0.03, 0.14 * s))
    P.b['glow'].add(v, f, col('#ffd27a'))
    return P.build()


def dojo(bx, by, s=1.0) -> list:
    """The swordsman's training dojo: a raised timber hall with white paper walls, a sweeping
    dark-tiled roof, a sword rack of wooden practice blades, stone weights and a straw dummy."""
    P = props.Prop('dojo')
    p = _w(bx, by)
    x, y = p.x, p.y
    Wd, D = 1.7 * s, 1.1 * s
    v, f = lib.box((x, y, 0.1 * s), (Wd + 0.3 * s, D + 0.3 * s, 0.2 * s))
    P.b['stone'].add(v, f, col('#cfc2ae'))
    v, f = lib.box((x, y, 0.24 * s), (Wd + 0.12 * s, D + 0.12 * s, 0.08 * s))
    P.b['wood'].add(v, f, WOOD_L)
    v, f = lib.box((x, y, 0.62 * s), (Wd, D, 0.7 * s))
    P.b['paint'].add(v, f, col('#fbf4e4'))
    # timber frame over the paper walls
    for k in range(6):
        u = -Wd / 2 + k * Wd / 5
        v, f = lib.box((x + u, y - D / 2 - 0.01, 0.62 * s), (0.06 * s, 0.03, 0.72 * s))
        P.b['wood'].add(v, f, WOOD_D)
    for zz in (0.3, 0.95):
        v, f = lib.box((x, y - D / 2 - 0.012, zz * s), (Wd + 0.04, 0.03, 0.06 * s))
        P.b['wood'].add(v, f, WOOD_D)
    # the open sliding door (a dark gap) and a hanging cloth over it
    v, f = lib.box((x, y - D / 2 - 0.02, 0.6 * s), (0.5 * s, 0.02, 0.6 * s))
    P.b['paint'].add(v, f, col('#3a2a22'))
    v, f = lib.box((x, y - D / 2 - 0.035, 0.84 * s), (0.56 * s, 0.015, 0.16 * s))
    P.b['paint'].add(v, f, col('#2e6b4a'))
    # sweeping roof: two curved slopes with upturned eaves, and a ridge
    for sgn in (-1, 1):
        verts, faces = [], []
        cols_ = 10
        for c in range(cols_ + 1):
            u = c / cols_
            for r, (dy, dz) in enumerate([(0.0, 1.5), (0.45, 1.18), (0.75, 1.02), (0.92, 1.0)]):
                lift = 0.12 * (abs(u - 0.5) * 2) ** 3
                verts.append((x - (Wd / 2 + 0.25 * s) + u * (Wd + 0.5 * s), y + sgn * dy * (D / 2 + 0.3 * s), (dz + lift + 0.08 * (r == 3)) * s))
        rr = 4
        for c in range(cols_):
            for r in range(rr - 1):
                a = c * rr + r
                faces.append((a, a + 1, a + rr + 1, a + rr))
        P.b['paint'].add(verts, faces + [tuple(reversed(fc)) for fc in faces], col('#3a4658'))
    v, f = lib.tube([(x - Wd / 2 - 0.2 * s, y, 1.52 * s), (x + Wd / 2 + 0.2 * s, y, 1.52 * s)], 0.05 * s, 8)
    P.b['paint'].add(v, f, col('#2a3444'))
    # sword rack (three wooden practice blades) beside the door
    rx, ry = x - Wd / 2 - 0.45 * s, y - 0.2 * s
    for dz in (0.25, 0.55):
        v, f = lib.box((rx, ry, dz * s), (0.5 * s, 0.05 * s, 0.05 * s))
        P.b['wood'].add(v, f, WOOD_D)
    for sgn in (-1, 1):
        v, f = lib.box((rx + sgn * 0.23 * s, ry, 0.35 * s), (0.05 * s, 0.05 * s, 0.7 * s))
        P.b['wood'].add(v, f, WOOD_D)
    for k, cc in enumerate(['#f2e6c8', '#e0c088', '#f2e6c8']):
        bx_ = rx - 0.14 * s + k * 0.14 * s
        v, f = lib.box((bx_, ry - 0.04 * s, 0.42 * s), (0.035 * s, 0.02 * s, 0.7 * s))
        P.b['wood'].add(v, f, col(cc))
        v, f = lib.box((bx_, ry - 0.04 * s, 0.16 * s), (0.08 * s, 0.03 * s, 0.025 * s))
        P.b['metal'].add(v, f, col('#3a3f48'))
    # stone lifting weights: a bar with two big discs, and a pair of round stones
    wx, wy = x + Wd / 2 + 0.45 * s, y - 0.25 * s
    v, f = lib.cylinder((0, 0, 0), 0.03 * s, 0.03 * s, 0.7 * s, 8)
    v = lib.transform(v, loc=(wx - 0.35 * s, wy, 0.16 * s), rot=(0.0, math.pi / 2, 0.0))
    P.b['metal'].add(v, f, col('#6b6f78'))
    for dx in (-0.28, 0.28):
        v, f = lib.cylinder((0, 0, 0), 0.16 * s, 0.16 * s, 0.1 * s, 16)
        v = lib.transform(v, loc=(wx + dx * s - 0.05 * s, wy, 0.16 * s), rot=(0.0, math.pi / 2, 0.0))
        P.b['stone'].add(v, f, col('#8a8a90'))
    for dx in (-0.15, 0.2):
        v, f = lib.blob((wx + dx * s, wy + 0.35 * s, 0.12 * s), 0.12 * s, rough=0.1, subdiv=2)
        P.b['stone'].add(v, f, col('#9a9aa2'))
    # a straw-wrapped training post
    tx, ty = x + Wd / 2 + 0.2 * s, y + 0.4 * s
    v, f = lib.cylinder((tx, ty, 0.0), 0.07 * s, 0.07 * s, 0.9 * s, 10)
    P.b['wood'].add(v, f, col('#d9b86a'))
    for zz in (0.3, 0.55, 0.8):
        v, f = lib.cylinder((tx, ty, zz * s), 0.08 * s, 0.08 * s, 0.04 * s, 10)
        P.b['wood'].add(v, f, col('#8a5a34'))
    return P.build()


def map_room(bx, by, s=1.0) -> list:
    """The navigator's map room: a round teal-roofed cabin with porthole windows, a compass-rose
    weather vane, a chart table with unrolled maps outside and a big globe on a stand."""
    P = props.Prop('map_room')
    p = _w(bx, by)
    x, y = p.x, p.y
    R = 0.62 * s
    v, f = lib.lathe([(R + 0.08 * s, 0.0), (R + 0.08 * s, 0.12 * s), (0.0, 0.12 * s)], 28, (x, y, 0))
    P.b['stone'].add(v, f, col('#d8cbb8'))
    v, f = lib.lathe([(R, 0.12 * s), (R, 0.95 * s)], 28, (x, y, 0), cap_bottom=False, cap_top=False)
    P.b['paint'].add(v, f, col('#fff0d8'))
    for k in range(10):
        a = k / 10 * math.tau
        v, f = lib.box((x + math.cos(a) * R, y + math.sin(a) * R, 0.53 * s), (0.05 * s, 0.05 * s, 0.84 * s), rot_z=a)
        P.b['wood'].add(v, f, WOOD_M)
    for a in (-2.2, -1.2, -0.3):
        q = (x + math.cos(a) * (R + 0.01), y + math.sin(a) * (R + 0.01), 0.62 * s)
        v, f = lib.lathe([(0.0, 0.0), (0.1 * s, 0.0), (0.1 * s, 0.02)], 12, (0, 0, 0))
        v = lib.transform(v, loc=q, rot=(math.pi / 2, 0.0, a + math.pi / 2))
        P.b['glow'].add(v, f, col('#bfe8ff'))
    v, f = lib.box((x, y - R - 0.01, 0.42 * s), (0.28 * s, 0.03, 0.56 * s))
    P.b['wood'].add(v, f, WOOD_D)
    v, f = lib.lathe([(R + 0.18 * s, 0.9 * s), (R + 0.1 * s, 0.98 * s), (0.2 * s, 1.5 * s), (0.0, 1.62 * s)], 28, (x, y, 0))
    P.b['paint'].add(v, f, col('#1fa5a0'))
    # weather vane: a pole with a compass-rose star and an arrow
    v, f = lib.cylinder((x, y, 1.6 * s), 0.015 * s, 0.012 * s, 0.5 * s, 6)
    P.b['metal'].add(v, f, GOLD)
    for k in range(4):
        a = k / 4 * math.tau
        tri = [(x, y, 1.9 * s), (x + math.cos(a) * 0.16 * s, y, 1.9 * s + math.sin(a) * 0.16 * s), (x + math.cos(a + 0.5) * 0.05 * s, y, 1.9 * s + math.sin(a + 0.5) * 0.05 * s)]
        P.b['metal'].add(tri, [(0, 1, 2), (2, 1, 0)], GOLD)
    v, f = lib.tube([(x - 0.2 * s, y, 2.06 * s), (x + 0.22 * s, y, 2.06 * s)], 0.012 * s, 5)
    P.b['metal'].add(v, f, GOLD)
    # chart table with maps, a compass and a spyglass
    tx, ty = x + 0.95 * s, y - 0.25 * s
    v, f = lib.box((tx, ty, 0.32 * s), (0.7 * s, 0.44 * s, 0.04 * s))
    P.b['wood'].add(v, f, WOOD_L)
    for dx in (-0.3, 0.3):
        for dy in (-0.18, 0.18):
            v, f = lib.box((tx + dx * s, ty + dy * s, 0.15 * s), (0.04 * s, 0.04 * s, 0.3 * s))
            P.b['wood'].add(v, f, WOOD_D)
    v, f = lib.box((tx - 0.08 * s, ty, 0.345 * s), (0.44 * s, 0.32 * s, 0.01 * s), rot_z=0.15)
    P.b['paint'].add(v, f, col('#f1e0b0'))
    for k in range(4):  # coastline squiggles and a red route on the chart
        v, f = lib.tube([(tx - 0.25 * s + k * 0.08 * s, ty - 0.1 * s, 0.352 * s), (tx - 0.2 * s + k * 0.08 * s, ty + 0.08 * s, 0.352 * s)], 0.006 * s, 4)
        P.b['paint'].add(v, f, col('#5a8ac8') if k < 3 else col('#d9483b'))
    v, f = lib.lathe([(0.0, 0.0), (0.05 * s, 0.0), (0.05 * s, 0.015 * s)], 12, (tx + 0.22 * s, ty + 0.05 * s, 0.34 * s))
    P.b['metal'].add(v, f, GOLD)
    v, f = lib.cylinder((0, 0, 0), 0.025 * s, 0.02 * s, 0.3 * s, 8)
    v = lib.transform(v, loc=(tx + 0.1 * s, ty - 0.14 * s, 0.37 * s), rot=(0.0, math.pi / 2, 0.3))
    P.b['metal'].add(v, f, GOLD)
    # the globe
    gx, gy = x - 0.95 * s, y - 0.2 * s
    v, f = lib.lathe([(0.12 * s, 0.0), (0.04 * s, 0.1 * s), (0.03 * s, 0.4 * s)], 10, (gx, gy, 0), cap_top=False)
    P.b['wood'].add(v, f, WOOD_D)
    v, f = lib.blob((gx, gy, 0.6 * s), 0.2 * s, rough=0.0, subdiv=3)
    P.b['paint'].add(v, f, lambda vv: col('#5fae54') if math.sin(vv[0] * 31) * math.cos(vv[2] * 23) > 0.35 else col('#3f8fd8'))
    ring = [(gx + math.cos(t) * 0.23 * s, gy, 0.6 * s + math.sin(t) * 0.23 * s) for t in np.linspace(-0.4, math.pi + 0.4, 20)]
    v, f = lib.tube(ring, 0.012 * s, 5)
    P.b['metal'].add(v, f, GOLD)
    return P.build()


def cave_mouth(bx, by, s=1.0) -> list:
    """The Treasure Cave: a craggy rock arch over a dark cave mouth, two torches and a spill of
    treasure (open chest, gold coins, gems) at its lip."""
    P = props.Prop('cave')
    p = _w(bx, by)
    x, y = p.x, p.y
    rng = np.random.default_rng(7)
    # the rock mass: overlapping lumpy boulders round an arch
    for (dx, dy, dz, r) in [(-0.95, 0.1, 0.45, 0.62), (0.95, 0.1, 0.45, 0.62), (-0.7, 0.25, 1.05, 0.55), (0.7, 0.25, 1.05, 0.55),
                            (0.0, 0.35, 1.5, 0.7), (-1.35, 0.35, 0.35, 0.5), (1.35, 0.35, 0.35, 0.5), (0.0, 0.7, 0.8, 0.8)]:
        v, f = lib.blob((x + dx * s, y + dy * s, dz * s), r * s, squash=(1.1, 0.9, 1.0), rough=0.32, freq=2.2, subdiv=3, seed=float(rng.random() * 50))
        P.b['stone'].add(v, f, lambda vv: col('#a08c78') if vv[2] > 0.25 * s else col('#8a7866'))
    # moss on top
    for (dx, dz) in [(-0.6, 1.5), (0.1, 2.05), (0.7, 1.45)]:
        v, f = lib.blob((x + dx * s, y + 0.3 * s, dz * s), 0.28 * s, squash=(1.3, 1.0, 0.45), rough=0.2, subdiv=2, seed=dx * 10)
        P.b['leaf'].add(v, f, col('#4f9a3a'))
    # the dark mouth (a recessed half-disc)
    verts = [(x, y + 0.05 * s, 0.0)] + [(x + math.cos(t) * 0.55 * s, y + 0.05 * s, math.sin(t) * 0.85 * s) for t in np.linspace(0, math.pi, 16)]
    faces = [(0, i + 1, i + 2) for i in range(15)]
    P.b['paint'].add(verts, faces + [tuple(reversed(fc)) for fc in faces], col('#1a1216'))
    # treasure: a chest with a gold heap and scattered coins and gems
    v, f = lib.box((x + 0.1 * s, y - 0.2 * s, 0.14 * s), (0.4 * s, 0.26 * s, 0.26 * s))
    P.b['wood'].add(v, f, col('#8a5a34'))
    v, f = lib.box((x + 0.1 * s, y - 0.2 * s, 0.28 * s), (0.42 * s, 0.28 * s, 0.03 * s))
    P.b['metal'].add(v, f, GOLD)
    v, f = lib.blob((x + 0.1 * s, y - 0.2 * s, 0.3 * s), 0.17 * s, squash=(1.2, 0.8, 0.5), rough=0.2, subdiv=2)
    P.b['metal'].add(v, f, col('#ffcc33'))
    for k in range(22):
        a = rng.random() * math.tau
        r = 0.2 + rng.random() * 0.45
        q = (x + 0.1 * s + math.cos(a) * r * s, y - 0.3 * s + math.sin(a) * r * 0.5 * s, 0.015 * s)
        v, f = lib.lathe([(0.0, 0.0), (0.035 * s, 0.0), (0.035 * s, 0.012 * s), (0.0, 0.012 * s)], 10, q)
        P.b['metal'].add(v, f, col('#ffcc33'))
    for k, cc in enumerate(['#ff4f7a', '#4fd1ff', '#8bd346', '#c49bff']):
        v, f = lib.prism((x - 0.25 * s + k * 0.13 * s, y - 0.38 * s, 0.0), 0.03 * s, 0.08 * s, sides=5)
        P.b['crystal'].add(v, f, col(cc))
    # torches either side of the mouth
    for sgn in (-1, 1):
        tx = x + sgn * 0.72 * s
        v, f = lib.cylinder((tx, y - 0.1 * s, 0.0), 0.03 * s, 0.025 * s, 0.75 * s, 6)
        P.b['wood'].add(v, f, WOOD_D)
        v, f = lib.lathe([(0.0, 0.0), (0.07 * s, 0.05 * s), (0.05 * s, 0.14 * s), (0.0, 0.24 * s)], 10, (tx, y - 0.1 * s, 0.74 * s))
        P.b['glow'].add(v, f, col('#ffb347'))
    return P.build()


def harbour_house(bx, by, s=1.0, wall='#ffd8a8', roof='#d9583b', flip=False) -> list:
    """A narrow harbour house: pastel walls, a steep tiled roof, a blue door, shuttered windows and a
    flower box."""
    P = props.Prop('house')
    p = _w(bx, by)
    x, y = p.x, p.y
    Wd, D, Hh = 0.75 * s, 0.6 * s, 0.95 * s
    v, f = lib.box((x, y, Hh / 2), (Wd, D, Hh))
    P.b['paint'].add(v, f, col(wall))
    for sgn in (-1, 1):
        verts = [(x - Wd / 2 - 0.06 * s, y + sgn * (D / 2 + 0.08 * s), Hh), (x + Wd / 2 + 0.06 * s, y + sgn * (D / 2 + 0.08 * s), Hh),
                 (x + Wd / 2 + 0.06 * s, y, Hh + 0.5 * s), (x - Wd / 2 - 0.06 * s, y, Hh + 0.5 * s)]
        P.b['paint'].add(verts, [(0, 1, 2, 3), (3, 2, 1, 0)], col(roof))
    for sgn in (-1, 1):
        tri = [(x + sgn * Wd / 2, y - D / 2, Hh), (x + sgn * Wd / 2, y + D / 2, Hh), (x + sgn * Wd / 2, y, Hh + 0.5 * s)]
        P.b['paint'].add(tri, [(0, 1, 2), (2, 1, 0)], col(wall))
    dx = -0.18 if flip else 0.18
    v, f = lib.box((x + dx * s, y - D / 2 - 0.01, 0.24 * s), (0.2 * s, 0.03, 0.46 * s))
    P.b['wood'].add(v, f, col('#3f7fd9'))
    wx = x - dx * s
    v, f = lib.box((wx, y - D / 2 - 0.01, 0.62 * s), (0.18 * s, 0.03, 0.2 * s))
    P.b['glow'].add(v, f, col('#ffe0a0'))
    for sgn in (-1, 1):
        v, f = lib.box((wx + sgn * 0.14 * s, y - D / 2 - 0.02, 0.62 * s), (0.07 * s, 0.02, 0.22 * s))
        P.b['paint'].add(v, f, col('#2e8a6a'))
    v, f = lib.box((wx, y - D / 2 - 0.05 * s, 0.49 * s), (0.24 * s, 0.07 * s, 0.06 * s))
    P.b['wood'].add(v, f, WOOD_M)
    for k in range(4):
        v, f = lib.blob((wx - 0.09 * s + k * 0.06 * s, y - D / 2 - 0.05 * s, 0.54 * s), 0.03 * s, rough=0.1, subdiv=1)
        P.b['leaf'].add(v, f, col(['#ff6f91', '#ffd166', '#ff6f91', '#8bd346'][k]))
    v, f = lib.box((x - 0.2 * s, y + 0.1 * s, Hh + 0.45 * s), (0.12 * s, 0.12 * s, 0.35 * s))
    P.b['stone'].add(v, f, col('#c8b8a8'))
    return P.build()


def crane(bx, by, s=1.0) -> list:
    """A wooden harbour crane with a rope and a hanging cargo net."""
    P = props.Prop('crane')
    p = _w(bx, by)
    x, y = p.x, p.y
    v, f = lib.box((x, y, 0.08 * s), (0.5 * s, 0.5 * s, 0.16 * s))
    P.b['stone'].add(v, f, col('#c8b8a8'))
    v, f = lib.cylinder((x, y, 0.16 * s), 0.07 * s, 0.06 * s, 1.5 * s, 8)
    P.b['wood'].add(v, f, WOOD_M)
    v, f = lib.tube([(x - 0.2 * s, y, 1.55 * s), (x + 1.0 * s, y - 0.15 * s, 1.75 * s)], 0.05 * s, 8)
    P.b['wood'].add(v, f, WOOD_M)
    v, f = lib.tube([(x + 0.95 * s, y - 0.15 * s, 1.72 * s), (x + 0.95 * s, y - 0.15 * s, 0.75 * s)], 0.01 * s, 4)
    P.b['wood'].add(v, f, col('#d8c29a'))
    v, f = lib.blob((x + 0.95 * s, y - 0.15 * s, 0.6 * s), 0.16 * s, squash=(1.0, 1.0, 1.1), rough=0.25, subdiv=2)
    P.b['paint'].add(v, f, col('#c9a36a'))
    return P.build()
