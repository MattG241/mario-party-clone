"""Mr. Burns (The Simpsons), a fan-made chibi side character for the board cast (see cast.py).

Homer's head (char_homer.py: the tall cranium with a muzzle at its front, bulging round eyes with dot
pupils, C-shaped ears) reshaped into the old tycoon's: a big bald dome, a narrow clean-shaven muzzle
with a thin, overbitten mouth, a long hooked nose, heavy-lidded eyes over baggy lower lids, thin grey
brows and a fringe of grey hair round the back of the head. Below it the suited body helper
(char_obama.SuitHero) as a thin old man in a green-grey suit, white shirt and dark red tie, stooped
(the chest leans forward and the head juts out on a thin neck). His idle pose steeples his fingers.
"""
from __future__ import annotations

import math

from mathutils import Vector

from char_homer import Homer, band_shell, fold_yaw, interp, sstep
from char_models import Hero, hand_mitten
from char_obama import SuitHero, clamp
from char_rig import I4, HeadShape, R, Skeleton, T, arc_points, curve3, ellipsoid, sweep
from char_anims import face, idle


class StoopSkeleton(Skeleton):
    """The skeleton with a constant stoop added to every pose: the chest leans forward, the neck carries
    the head out in front and the head tips back up to face the camera."""

    STOOP = {'chest': 11.0, 'neck': 9.0, 'head': -17.0}

    def __init__(self, base: Skeleton):
        self.parent, self.offset, self.order = base.parent, base.offset, base.order

    def solve(self, local: dict, root=I4, world_override=None):
        loc = dict(local)
        for j, a in self.STOOP.items():
            loc[j] = R(a, 0, 0) @ loc.get(j, I4)
        return super().solve(loc, root, world_override)


class Burns(SuitHero, Homer):
    key = 'burns'
    ankle_h = 0.15
    hip_h = 0.63  # ankle_h + 0.04 + thigh + shin
    spine = 0.09
    chest = 0.2
    neck = 0.13
    head_up = 0.02
    shoulder = (0.185, 0.0, 0.1)
    upper_arm = 0.21
    forearm = 0.19
    hip_w = 0.085
    thigh = 0.22
    shin = 0.22
    sit_h = 0.18

    # the suit (char_obama.SuitHero): a narrow, bony frame
    SQ = 0.78
    Z0 = -0.4
    ZB = -0.16
    V_TOP = 0.085
    CUT = 0.075
    LAPEL = 0.058
    TIE_W = 0.034
    TIE_TIP = -0.21
    NECK_R = 0.056
    SLEEVE_R = 0.066
    TROUSER_R = 0.08
    PELVIS = (0.168, 0.138)
    POCKET_Z = -0.31
    SUIT = dict(suit='#6c7b65', lapel='#5a6854', shirt='#f5f4ef', tie='#80262c', tie_d='#601b20', shoe='#201b18', sole='#2b2523',
                belt='#1c1a19', buckle='#c9ccd1', button='#3a4436')

    # the head (Homer's layout, head frame)
    CRAN = (0.34, 0.335, 0.47, 0.54)
    MUZ = (0.2, 0.2, 0.15, 0.15, 0.16, (0.0, -0.13, 0.26))
    EYE = (0.098, -0.272, 0.585, 0.1)
    HEAD = (0.34, 0.335, 0.47, 0.5, -0.3)
    MOUTH_PITCH = 2.0
    C = dict(Homer.C, skin='#fcd424', skin_d='#dcac16', stubble='#fcd424', stubble_d='#d9a914', hair='#2a2420', grey='#c3c4bd',
             grey_d='#8f918b', brow='#9a9b95')

    def __init__(self, mats):
        super().__init__(mats)
        self.skel = StoopSkeleton(self.skel)

    def rb(self, z: float) -> float:
        t = clamp((z - self.Z0) / (self.ZS - self.Z0))
        return 0.18 + 0.008 * math.sin(math.pi * t) - 0.008 * t

    def head_top(self) -> float:
        return self.CRAN[3] + self.CRAN[2] + 0.06

    def build(self, world: dict, pose: dict):
        # a slim suit: no belly for the arms to clear (Homer.build would swing them out)
        return Hero.build(self, world, pose)

    def dress(self):
        self.materials()
        self.mat['grey'] = self.m.cloth('burns_hair', self.C['grey'], 0.62, 0.45, 0.18, 140)
        self.mat['brow'] = self.m.cloth('burns_brow', self.C['brow'], 0.6, 0.3)
        self.dress_suit()
        # no flag pin
        self.parts = [p for p in self.parts if not p.name.startswith('pin')]
        self.head_parts()

    def suit_arms(self):
        mm = self.sm
        R0 = self.SLEEVE_R
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: R0 - 0.01 * t, mm['suit'], 0.0, 0.88, 16, 14, cap0=True, cap1=True)
            self.limb('cuff' + s_, sh, el, wr, 0.052, mm['shirt'], 0.8, 0.95, 14, 4, cap0=False, cap1=True)
            self.limb('wrist' + s_, sh, el, wr, 0.04, self.mat['skin'], 0.9, 1.0, 12, 4, extend=0.02)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.02):
                self.add('hand' + nm + s_, mesh, self.mat['skin'], None, wm)

    # --- head -------------------------------------------------------------------------------------
    def head_parts(self):
        super().head_parts()
        self.brows(self.face_state())

    def eyes(self, f):
        """Homer's bulging eyes with heavier lids (a sly, sleepy look at rest) and baggy lower lids."""
        M = self.mat
        eyes, brows = f['eyes'], f['brows']
        lx, lz = f.get('look', (0.0, 0.0))
        ex, ey, ez, er = self.EYE
        for side in (1, -1):
            nm = 'L' if side > 0 else 'R'
            kind = eyes
            if eyes == 'wink':
                kind = 'open' if side > 0 else 'happy'
            wide = kind == 'wide'
            r = er * (1.06 if wide else 1.0)
            ec = Vector((ex * side, ey, ez))
            self.add('eye' + nm, ellipsoid(r, r, r, 30, 20, center=tuple(ec)), M['white'], 'head')
            eye = HeadShape(r, r, r, center=tuple(ec))
            shut = kind in ('happy', 'closed')
            if kind == 'dizzy':
                pts = []
                for i in range(44):
                    a = i / 44 * math.tau * 2.3
                    rr = 0.008 + (r * 0.62 - 0.008) * i / 44
                    pts.append(Vector((math.cos(a) * rr * side, -0.004, math.sin(a) * rr)))
                self.feat('spiral' + nm, sweep(pts, 0.007, 6), M['pupil'], 'head', eye, eye.frame(-4 * side, -2, 0.0))
            elif not shut:
                yaw = -8.0 + 2.0 * side + lx * 24.0
                pitch = -8.0 + lz * 18.0
                pr = 0.024 * (0.8 if wide else 1.0)
                self.feat('pupil' + nm, ellipsoid(pr, 0.006, pr * 1.05, 16, 6), M['pupil'], 'head', eye, eye.frame(yaw, pitch, 0.0))
            level, slant = {'open': (0.4, -6.0), 'wide': (0.0, 0.0), 'half': (0.55, -4.0), 'sad': (0.46, 16.0), 'determined': (0.44, -16.0),
                            'dizzy': (0.2, 0.0)}.get(kind, (1.0, 0.0))
            if not shut and kind not in ('sad', 'determined', 'wide'):
                if brows == 'up':
                    level = max(0.0, level - 0.22)
                slant += {'worried': 14.0, 'sad': 12.0, 'angry': -12.0, 'determined': -8.0, 'up': 6.0}.get(brows, 0.0)
            rl = r * 1.05
            lm = T(*ec) @ R(0, slant * side, 0)
            if shut:
                self.add('lid' + nm, ellipsoid(rl, rl, rl, 30, 18), M['skin'], 'head', T(*ec))
                lid = HeadShape(rl, rl, rl, center=tuple(ec))
                h = -0.4 if kind == 'happy' else 0.12
                pts = [p + Vector((0, 0, -r * 0.08)) for p in arc_points(r * 1.5, r * h, 14, y=-0.004)]
                self.feat('shut' + nm, sweep(pts, lambda t: 0.0072 + 0.0034 * math.sin(math.pi * t), 8), M['hair'], 'head', lid,
                          lid.frame(0, 0, 0.0))
            elif level > 0.0:
                zc = rl * (1.0 - 2.0 * level)
                self.add('lid' + nm, ellipsoid(rl, rl, rl, 30, 14, zmin=1.0 - 2.0 * level), M['skin'], 'head', lm)
                rho = math.sqrt(max(0.0, rl * rl - zc * zc))
                pts = [Vector((math.sin(a) * rho, -math.cos(a) * rho, zc)) for a in [math.radians(-105 + 210 * k / 16) for k in range(17)]]
                self.add('lidline' + nm, sweep(pts, 0.0066, 6), M['hair'], 'head', lm)
            if not shut:
                # the baggy lower lid: a fold of skin hugging the bottom of the eye
                bl = HeadShape(r * 1.02, r * 1.02, r * 1.02, center=tuple(ec))
                pts = [bl.point(a * side, -62.0 + 10.0 * math.cos(math.radians(a * 1.6)), 0.006)[0] for a in range(-62, 63, 8)]
                self.add('bag' + nm, sweep(pts, lambda t: 0.009 + 0.008 * math.sin(math.pi * t), 8), M['skin_d'], 'head')

    def brows(self, f):
        """Thin grey brows on the brow ridge, slanting with the mood (scheming inwards at rest)."""
        brows, eyes = f['brows'], f['eyes']
        ex, ey, ez, er = self.EYE
        tilt = {'neutral': -9.0, 'up': 6.0, 'worried': 16.0, 'sad': 14.0, 'angry': -20.0, 'determined': -15.0}.get(brows, -9.0)
        up = 0.02 if brows == 'up' or eyes == 'wide' else 0.0
        for side in (1, -1):
            c = Vector((ex * side * 1.08, ey, ez + er + 0.035 + up))
            pts = []
            for k in range(9):
                u = k / 8 * 2 - 1
                x = c.x + u * 0.07
                z = c.z + 0.012 * (1 - u * u) + math.tan(math.radians(tilt)) * 0.07 * u * side * -1
                p, n = self.cran.surface(Vector((x, -0.3, z - self.CRAN[3])))
                pts.append(p + n * 0.012)
            self.add('brow' + ('L' if side > 0 else 'R'), sweep(pts, lambda t: 0.011 + 0.006 * math.sin(math.pi * t), 8, squash=0.8),
                     self.mat['brow'], 'head')

    def nose(self):
        """The long hooked nose: out from between the eyes, then curving down to a drooping point."""
        M = self.mat
        pts = curve3(Vector((0.0, -0.3, 0.52)), Vector((0.0, -0.455, 0.475)), Vector((0.0, -0.47, 0.385)), 14)
        self.add('nose', sweep(pts, lambda t: 0.04 + 0.01 * math.sin(math.pi * min(1.0, t * 1.3)) - 0.02 * t ** 3, 16), M['skin'], 'head')

    def hairs(self):
        pass

    def fringe(self):
        """A fringe of grey hair round the back of the head, from ear to ear, a little tufted over the ears."""
        M = self.mat
        rx, ry, rz, cz = self.CRAN
        hs = HeadShape(rx, ry, rz, center=(0, 0, cz))

        def top(yaw):
            a = fold_yaw(yaw)
            return interp([(70.0, -2.0), (86.0, 10.0), (110.0, 14.0), (180.0, 12.0)], a) + 2.5 * math.sin(math.radians(a * 9.0))

        def bottom(yaw):
            a = fold_yaw(yaw)
            return interp([(70.0, -10.0), (90.0, -16.0), (125.0, -26.0), (180.0, -32.0)], a)

        def lift(yaw, f):
            a = fold_yaw(yaw)
            return (0.012 + 0.03 * math.sin(math.pi * min(1.0, f * 1.05))) * sstep((a - 70.0) / 10.0)

        self.add('fringe', band_shell(hs, top, bottom, 70.0, 290.0, lift, 144, 8), M['grey'], 'head')
        # wisps sticking out above the ears
        for sd in (1, -1):
            for k, (yaw, pitch, ln) in enumerate(((98.0, 6.0, 0.07), (112.0, 9.0, 0.08), (126.0, 8.0, 0.065))):
                p, n = hs.point(yaw * sd, pitch, 0.02)
                d = (n + Vector((0.0, 0.25, 0.35))).normalized()
                pts = [p + d * (ln * t) for t in (i / 6 for i in range(7))]
                self.add(f'wisp{k}', sweep(pts, lambda t: 0.024 * (1 - t) + 0.005, 8), M['grey'], 'head')


MODEL = Burns

# Idle: the hands brought together in front of the chest, fingertips touching ("Excellent..."), a sly smirk.
_idle = idle()[0]
POSES = {
    'idle': dict(_idle, armL=(30, 90, -15, 100), armR=(30, 90, -15, 100), wristL=(-10, 30, 70), wristR=(-10, -30, -70),
                 handL='open', handR='open',
                 face=face('open', 'smirk', 'angry')),
}
