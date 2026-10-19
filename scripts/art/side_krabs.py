"""Mr. Krabs (SpongeBob SquarePants), a fan-made chibi side character for the board cast (see cast.py).

Patrick's model (side_patrick.py, on SpongeBob's skeleton: the body is the 'head', with the arms on its
sides) as the crab: a broad red egg of a body with two tall eye stalks on top (white eyes, small black
pupils, red lids), a wide toothy grin, a light blue short-sleeved shirt over the lower half (a collar
dipping into a V at the front, two buttons), a dark belt with a brass buckle and short brown trousers,
thin red arms ending in big two-jawed claws (they open for 'open' hands) and thin red legs tapering to
points.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from char_homer import EggHead
from char_models import DEFAULT_FACE
from char_rig import HeadShape, R, T, arc_points, ellipsoid, superellipsoid, sweep
from char_spongebob import strip
from side_patrick import Patrick


def egg_band(rx, ryf, ryb, rzt, rzb, center, z0: float, z1: float, grow: float = 0.0, seg: int = 48, rings: int = 16):
    """The part of an egg (radii differ in front / behind and above / below its centre) between the heights
    z0..z1 (pass z0 below the bottom for a bowl), every radius grown by `grow`."""
    cx, cy, cz = center
    rx, ryf, ryb, rzt, rzb = rx + grow, ryf + grow, ryb + grow, rzt + grow, rzb + grow

    def nz(z):
        d = z - cz
        return max(-1.0, min(1.0, d / (rzt if d > 0 else rzb)))

    verts, faces = ellipsoid(1.0, 1.0, 1.0, seg, rings, zmin=nz(z0), zmax=nz(z1))
    out = [(cx + x * rx, cy + y * (ryf if y < 0 else ryb), cz + z * (rzt if z > 0 else rzb)) for (x, y, z) in verts]
    return out, faces


class Krabs(Patrick):
    key = 'krabs'
    ankle_h = 0.03  # the legs end in points
    thigh = 0.16
    shin = 0.18
    hip_h = 0.41  # ankle_h + 0.04 + thigh + shin
    hip_w = 0.13
    shoulder = (0.37, 0.0, 0.13)  # on the body's sides (head frame)
    upper_arm = 0.17
    forearm = 0.15
    sit_h = 0.14
    # the body (head frame): rx, ry front / back, rz top / bottom, centre
    BODY = (0.42, 0.33, 0.31, 0.5, 0.37, (0.0, 0.0, 0.16))
    SHIRT_TOP = 0.17  # the shirt's collar line (head frame)
    BELT_Z = -0.07
    C = dict(red='#d8392b', red_d='#a8261d', shirt='#78b4e2', shirt_d='#5a93c4', pants='#7a4b28', belt='#3b2416', buckle='#d9b04a',
             white='#fbfbf8', pupil='#121212', mouth='#4a1210', tongue='#e0707a', teeth='#fffdf5')

    def head_top(self) -> float:
        return self.BODY[5][2] + self.BODY[3] + 0.42

    def face_state(self):
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        return f

    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            red=mt.glossy('krb_red', c['red'], 0.38, 0.35),
            red_d=mt.glossy('krb_red_d', c['red_d'], 0.4, 0.3),
            shirt=mt.cloth('krb_shirt', c['shirt'], 0.72, 0.35, 0.06),
            shirt_d=mt.cloth('krb_shirt_d', c['shirt_d'], 0.72, 0.3),
            pants=mt.cloth('krb_pants', c['pants'], 0.74, 0.35, 0.1, 50),
            belt=mt.glossy('krb_belt', c['belt'], 0.4, 0.3),
            buckle=mt.metal('krb_buckle', c['buckle'], 0.3),
            white=mt.glossy('krb_eye_white', c['white'], 0.2, 0.7),
            pupil=mt.glossy('krb_pupil', c['pupil'], 0.25, 0.9),
            shine=mt.emit('krb_shine', '#ffffff', 3.0),
            mouth=mt.glossy('krb_mouth', c['mouth'], 0.4, 0.2),
            tongue=mt.glossy('krb_tongue', c['tongue'], 0.35, 0.3),
            teeth=mt.glossy('krb_teeth', c['teeth'], 0.25, 0.4),
        )
        self.body()
        self.legs()
        self.arms()
        f = self.face_state()
        self.eyes(f)
        # his resting face is a wide toothy grin
        self.mouth('grin' if f['mouth'] == 'smile' else f['mouth'])

    # --- body -------------------------------------------------------------------------------------
    def body(self):
        M = self.mat
        rx, ryf, ryb, rzt, rzb, ctr = self.BODY
        self.shell = EggHead(rx, ryf, ryb, rzt, rzb, center=ctr)
        self.add('body', self.shell.mesh(52, 34), M['red'], 'head')
        st, bz = self.SHIRT_TOP, self.BELT_Z
        self.add('shirt', egg_band(*self.BODY, bz - 0.01, st, 0.016, 52, 14), M['shirt'], 'head')
        self.add('pants', egg_band(*self.BODY, -1.0, bz + 0.005, 0.022, 52, 12), M['pants'], 'head')
        # the belt: a band round the waist line, the buckle at the front
        ring = self.ring(bz, 0.03)
        self.add('belt', sweep(ring + ring[:1], 0.026, 8, cap0=False, cap1=False, squash=0.5), M['belt'], 'head')
        p, n = self.surf(0.0, bz, 0.05)
        self.add('buckle', superellipsoid(0.05, 0.014, 0.036, 3.2, 16, 8), M['buckle'], 'head', T(*p) @ self.facing(n))
        self.add('buckle_in', superellipsoid(0.032, 0.014, 0.019, 3.2, 14, 8), M['belt'], 'head', T(*(p + n * 0.004)) @ self.facing(n))
        # the collar: a rolled band along the neckline, dipping into a small V at the front
        ring = []
        for v in self.ring(st, 0.018, 64):
            a = math.degrees(math.atan2(v.y, v.x)) + 90.0  # 0 at the front
            dip = 0.07 * max(0.0, 1.0 - abs(a) / 26.0) ** 1.5
            ring.append(self.surf(v.x, st - dip, 0.018)[0] if v.y < 0 else v)
        self.add('collar', sweep(ring + ring[:1], 0.024, 8, cap0=False, cap1=False), M['shirt_d'], 'head')
        # the V of red chest showing inside it (a decal on the shirt)
        g = 0.019
        sh = EggHead(rx + g, ryf + g, ryb + g, rzt + g, rzb + g, center=ctr)
        fr = sh.frame(0.0, math.degrees(math.atan2(st - ctr[2], ryf)), 0.0)
        hw = 0.052
        self.feat('vneck', strip(lambda x: 0.004, lambda x: -0.07 * max(0.0, 1.0 - abs(x) / hw) + 0.002, -hw, hw, 16, 4, 0.003), M['red'], 'head',
                  sh, fr)
        # two buttons down the shirt front
        for k, z in enumerate((st - 0.07, st - 0.13)):
            p, n = self.surf(0.0, z, 0.02)
            self.add(f'button{k}', ellipsoid(0.016, 0.006, 0.016, 12, 6), M['shirt_d'], 'head', T(*p) @ self.facing(n))

    def surf(self, x: float, z: float, lift: float = 0.0):
        """The body's front point at (x, z) (head frame) lifted along the normal, and the normal."""
        rx, ryf, _ryb, rzt, rzb, ctr = self.BODY
        dz = z - ctr[2]
        rz = rzt if dz > 0 else rzb
        y = -ryf * math.sqrt(max(0.0, 1.0 - (x / rx) ** 2 - (dz / rz) ** 2))
        n = Vector((x / rx ** 2, y / ryf ** 2, dz / rz ** 2)).normalized()
        return Vector((x, y, z)) + n * lift, n

    def ring(self, z: float, lift: float, n: int = 48):
        """A loop round the body at height z (head frame), lifted off the surface."""
        rx, ryf, ryb, rzt, rzb, ctr = self.BODY
        dz = z - ctr[2]
        k = math.sqrt(max(0.0, 1.0 - (dz / (rzt if dz > 0 else rzb)) ** 2))
        out = []
        for i in range(n):
            a = i / n * math.tau
            ry = ryf if math.sin(a) < 0 else ryb
            out.append(Vector((math.cos(a) * (rx * k + lift), math.sin(a) * (ry * k + lift), z)))
        return out

    @staticmethod
    def facing(n: Vector):
        """Rotation turning a feature modelled facing -Y to face along n."""
        fwd = -n
        x = fwd.cross(Vector((0.0, 0.0, 1.0)))
        if x.length < 1e-6:
            x = Vector((1.0, 0.0, 0.0))
        x.normalize()
        z = x.cross(fwd).normalized()
        return Matrix((x, fwd, z)).transposed().to_4x4()

    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.056 * (1 - t) ** 0.8 + 0.008, M['red'], 0.0, 1.0, 12, 16, cap0=True, cap1=True,
                      extend=0.03)

    def arms(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.072 + 0.012 * t, M['shirt'], 0.0, 0.3, 16, 6, cap0=True, cap1=False)
            self.limb('shem' + s_, sh, el, wr, 0.086, M['shirt_d'], 0.28, 0.32, 16, 2, cap0=False, cap1=False)
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.04 + 0.006 * t, M['red'], 0.25, 1.0, 12, 12, cap0=False, extend=0.02)
            self.claw(s_, sd, self.pose.get('hand' + s_, 'fist'))

    def claw(self, s_: str, sd: int, hand: str):
        """A big two-jawed claw in the wrist frame (-Z along the forearm): the big jaw outside, the small one
        inside, opening sideways so the V shows from the front."""
        M = self.mat
        wm = self.J('wrist' + s_)
        gape = 26.0 if hand == 'open' else 4.0
        self.add('palm' + s_, ellipsoid(0.09, 0.074, 0.1, 18, 12, center=(0.0, 0.0, -0.085)), M['red'], None, wm)
        base = Vector((0.0, 0.0, -0.13))
        for k, (side, ln, r0, bow, ang) in enumerate(((sd, 0.24, 0.072, 0.085, gape), (-sd, 0.18, 0.048, 0.055, -gape * 0.8))):
            pts = []
            for i in range(13):
                t = i / 12
                pts.append(Vector((side * (0.018 + bow * math.sin(math.pi * t * 0.95) - 0.02 * t), 0.0, -ln * t)))
            m = wm @ T(*base) @ R(0, ang * sd, 0)
            self.add(f'jaw{k}{s_}', sweep(pts, lambda t, r0=r0: r0 * (1 - t) ** 0.75 + 0.01, 12, squash=0.75), M['red'], None, m)

    # --- face -------------------------------------------------------------------------------------
    EYE_R = 0.074

    def eyes(self, f):
        """Two white eyes on tall stalks from the top of the body; red lids carry the mood."""
        M = self.mat
        eyes, brows = f['eyes'], f['brows']
        lx, lz = f.get('look', (0.0, 0.0))
        ex = self.pose.get('extra', {})
        spread = 0.12 + 0.18 * max(-0.3, min(1.0, ex.get('tail', 0.0)))
        for sd in (1, -1):
            nm = 'L' if sd > 0 else 'R'
            base, _n = self.shell.point(26.0 * sd, 64.0, -0.03)
            d = Vector((spread * sd, -0.12, 1.0)).normalized()
            ln = 0.27
            pts = [base + d * (ln * t) + Vector((0.03 * sd, 0.0, 0.0)) * (t * t) for t in (k / 10 for k in range(11))]
            self.add('stalk' + nm, sweep(pts, lambda t: 0.034 - 0.006 * t, 12), M['red'], 'head')
            kind = eyes
            if eyes == 'wink':
                kind = 'open' if sd > 0 else 'happy'
            r = self.EYE_R * (1.08 if kind == 'wide' else 1.0)
            ec = pts[-1] + d * (r * 0.75)
            self.add('eye' + nm, ellipsoid(r, r, r * 1.08, 28, 18, center=tuple(ec)), M['white'], 'head')
            eye = HeadShape(r, r, r * 1.08, center=tuple(ec))
            shut = kind in ('happy', 'closed')
            if kind == 'dizzy':
                pts2 = []
                for i in range(40):
                    a = i / 40 * math.tau * 2.2
                    rr = 0.006 + (r * 0.6 - 0.006) * i / 40
                    pts2.append(Vector((math.cos(a) * rr * sd, -0.004, math.sin(a) * rr)))
                self.feat('spiral' + nm, sweep(pts2, 0.006, 6), M['pupil'], 'head', eye, eye.frame(-6 * sd, -4, 0.0))
            elif not shut:
                pr = 0.03 * (0.8 if kind == 'wide' else 1.0)
                fr = eye.frame(-6.0 * sd + lx * 26.0, -6.0 + lz * 18.0, 0.0)
                self.feat('pupil' + nm, ellipsoid(pr, 0.006, pr * 1.1, 16, 6), M['pupil'], 'head', eye, fr)
                self.feat('shine' + nm, ellipsoid(pr * 0.32, 0.004, pr * 0.32, 8, 4, center=(-pr * 0.35, -0.006, pr * 0.4)), M['shine'], 'head',
                          eye, fr)
            level, slant = {'open': (0.16, 0.0), 'wide': (0.0, 0.0), 'half': (0.48, 0.0), 'sad': (0.4, 16.0), 'determined': (0.38, -18.0),
                            'dizzy': (0.12, 0.0)}.get(kind, (1.0, 0.0))
            if not shut and kind not in ('sad', 'determined', 'wide'):
                if brows == 'up':
                    level = max(0.0, level - 0.12)
                slant += {'worried': 14.0, 'sad': 12.0, 'angry': -18.0, 'determined': -12.0}.get(brows, 0.0)
                if brows in ('angry', 'determined'):
                    level = max(level, 0.3)
            rl = r * 1.06
            lm = T(*ec) @ R(0, slant * sd, 0)
            if shut:
                self.add('lid' + nm, ellipsoid(rl, rl, rl * 1.08, 28, 16), M['red'], 'head', T(*ec))
                lid = HeadShape(rl, rl, rl * 1.08, center=tuple(ec))
                h = -0.4 if kind == 'happy' else 0.12
                pts2 = [p + Vector((0, 0, -r * 0.1)) for p in arc_points(r * 1.5, r * h, 12, y=-0.004)]
                self.feat('shut' + nm, sweep(pts2, lambda t: 0.007 + 0.003 * math.sin(math.pi * t), 8), M['red_d'], 'head', lid, lid.frame(0, 0, 0.0))
            elif level > 0.0:
                self.add('lid' + nm, ellipsoid(rl, rl, rl * 1.08, 28, 12, zmin=1.0 - 2.0 * level), M['red'], 'head', lm)

    def mouth(self, mouth: str):
        """A wide mouth across the front of the body, above the collar."""
        M = self.mat
        shell = self.shell
        fr = shell.frame(0.0, 29.0, 0.0)

        def feat(name, mesh, mat):
            self.feat(name, mesh, mat, 'head', shell, fr)

        line = lambda t: 0.013 + 0.005 * math.sin(math.pi * t)  # noqa: E731
        w = 0.5
        if mouth in ('smile', 'smirk'):
            tilt = 0.03 if mouth == 'smirk' else 0.0
            pts = [Vector((t * w / 2, -0.006, -0.06 * (1 - t * t) + tilt * t + 0.035 * abs(t) ** 5)) for t in (i / 10 - 1 for i in range(21))]
            feat('mouth', sweep(pts, line, 8), M['mouth'])
        elif mouth in ('grin', 'open', 'laugh'):
            depth = {'grin': 0.1, 'open': 0.12, 'laugh': 0.15}[mouth]
            ww = {'grin': 0.48, 'open': 0.34, 'laugh': 0.44}[mouth]

            def top(x):
                t = x / (ww / 2)
                return -0.035 * (1 - t * t) + 0.03 * abs(t) ** 4

            def bot(x):
                t = x / (ww / 2)
                return top(x) - depth * max(0.0, 1 - t * t) ** 0.7

            feat('mouth', strip(top, bot, -ww / 2, ww / 2, 30, 6, 0.004), M['mouth'])
            feat('tongue', ellipsoid(ww * 0.2, 0.006, depth * 0.28, 16, 6, center=(0.0, -0.005, -0.035 - depth * 0.62)), M['tongue'])
            if mouth == 'grin':
                tw = ww * 0.38
                feat('teeth', strip(lambda x: top(x) - 0.003, lambda x: top(x) - 0.026, -tw, tw, 20, 2, 0.0055, 0.0045), M['teeth'])
        elif mouth in ('o', 'gasp'):
            a, b = (0.045, 0.05) if mouth == 'o' else (0.08, 0.085)
            feat('mouth', ellipsoid(a, 0.006, b, 20, 6, center=(0, -0.002, -0.03 - b * 0.4)), M['mouth'])
            if mouth == 'gasp':
                feat('tongue', ellipsoid(a * 0.55, 0.007, b * 0.3, 12, 6, center=(0, -0.005, -0.03 - b * 1.0)), M['tongue'])
        else:
            pts = []
            for i in range(17):
                t = i / 16 * 2 - 1
                if mouth == 'frown':
                    z = 0.04 * (1 - t * t) - 0.05
                elif mouth == 'wobble':
                    z = 0.014 * math.sin(t * math.pi * 2.5) - 0.035
                else:  # flat
                    z = -0.035
                pts.append(Vector((t * w * 0.38, -0.006, z)))
            feat('mouth', sweep(pts, line, 8), M['mouth'])


MODEL = Krabs
