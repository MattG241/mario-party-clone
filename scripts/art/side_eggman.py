"""Dr. Eggman (Sonic the Hedgehog), a fan-made chibi side character for the board cast (see cast.py).

The villain, on Homer's stout body (char_homer.py: the potbelly egg carried by the spine, arms swung
clear of it) with a head of his own: a big bald egg of a head, a huge bushy orange-brown moustache
sweeping out past his cheeks, a round pink nose, small round blue-tinted glasses (his eyes show through
faintly) and blue-lensed goggles pushed up on the crown on a dark strap; a red jacket with gold buttons
over the round belly, black trousers on thin legs, black boots with a grey band, and white gloves. His
resting face is the toothy villain's grin under the moustache.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from char_homer import EggHead, Homer
from char_models import DEFAULT_FACE, Hero, hand_mitten
from char_rig import R, T, curve3, disc, ellipsoid, flat_sweep, superellipsoid, sweep, torus


def lm_at(pos: Vector, out: Vector) -> Matrix:
    """A frame at `pos` whose -Y points along `out` (details are modelled facing -Y, up +Z)."""
    fwd = -out.normalized()
    xv = fwd.cross(Vector((0.0, 0.0, 1.0)))
    xv = xv.normalized() if xv.length > 1e-4 else Vector((1.0, 0.0, 0.0))
    zv = xv.cross(fwd).normalized()
    m = Matrix((xv, fwd, zv)).transposed().to_4x4()
    m.translation = pos
    return m


class Eggman(Homer):
    key = 'eggman'
    ankle_h = 0.13
    thigh = 0.19
    shin = 0.2
    hip_h = 0.13 + 0.04 + 0.19 + 0.2
    hip_w = 0.115
    shoulder = (0.24, 0.0, 0.07)
    upper_arm = 0.19
    forearm = 0.17
    # a round belly, a little fuller than Homer's in front and higher up the chest
    BELLY = (0.31, 0.36, 0.23, 0.29, 0.22, (0.0, -0.06, -0.04))
    CHEST = (0.25, 0.2, 0.17, (0.0, 0.015, -0.01))

    # the egg head: rx, ry front / back, rz top / bottom, centre height (head frame)
    EGG = (0.4, 0.385, 0.37, 0.48, 0.38, 0.45)
    HEAD = (0.4, 0.385, 0.48, 0.45, -0.32)  # rx, ry, rz, face centre height and depth (for the portraits)
    EYE = (21.0, 9.0)  # eye yaw / pitch on the egg
    GLASS = 0.034  # how far the glasses sit in front of the face

    C = dict(Homer.C, skin='#f8c7a0', skin_d='#e7a37c', nose='#f3a089', shirt='#d9262b', shirt_d='#f2c22e', jacket_d='#a8171d',
             pants='#24262d', pants_d='#17181d', shoe='#1c1d22', sole='#2c2d33', band='#a3a9b2', glove='#fbfbf7', glove_d='#e3e2dc',
             tash_d='#8c4417', tash_l='#e48c3c', iris='#2a3f73', frame='#2a2b31', lens='#7cc4ff', goggle='#57b3ec', strap='#2b2c33',
             metal='#b9bfc8')

    def head_top(self) -> float:
        return self.EGG[5] + self.EGG[3] + 0.16

    # --- materials --------------------------------------------------------------------------------
    def materials(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('egg_skin', c['skin']),
            skin_d=mt.skin('egg_skin_d', c['skin_d']),
            nose=mt.skin('egg_nose', c['nose']),
            shirt=mt.cloth('egg_jacket', c['shirt'], 0.6, 0.35, 0.05),
            jacket_d=mt.cloth('egg_jacket_d', c['jacket_d'], 0.6, 0.3),
            shirt_d=mt.metal('egg_gold', c['shirt_d'], 0.3),
            pants=mt.cloth('egg_pants', c['pants'], 0.72, 0.3, 0.08),
            pants_d=mt.cloth('egg_pants_d', c['pants_d'], 0.72, 0.3),
            shoe=mt.glossy('egg_boot', c['shoe'], 0.32, 0.5),
            sole=mt.cloth('egg_sole', c['sole'], 0.6, 0.1),
            band=mt.metal('egg_band', c['band'], 0.35),
            glove=mt.cloth('egg_glove', c['glove'], 0.55, 0.3),
            glove_d=mt.cloth('egg_glove_d', c['glove_d'], 0.55, 0.3),
            tash=mt.hair('egg_tash', c['tash_d'], c['tash_l'], 0.5),
            frame=mt.glossy('egg_frame', c['frame'], 0.3, 0.6),
            lens=mt.alpha('egg_lens', c['lens'], 0.42),
            goggle=mt.glossy('egg_goggle', c['goggle'], 0.12, 0.9),
            strap=mt.cloth('egg_strap', c['strap'], 0.6, 0.2),
            metal=mt.glossy('egg_metal', c['metal'], 0.25, 0.6),
            shine=mt.emit('eye_shine', '#ffffff', 3.0),
        )

    # --- torso: the red jacket over the belly -------------------------------------------------------
    def torso(self):
        super().torso()
        M = self.mat
        # gold buttons instead of the shirt's: three down the front of the belly (spine frame)
        self.parts = [p for p in self.parts if not p.name.startswith('button')]
        rx, ryf, ryb, rzt, rzb, bc = self.BELLY
        for k, zz in enumerate((0.17, 0.06, -0.05)):
            z = bc[2] + zz
            rz = rzt if zz > 0 else rzb
            f_ = math.sqrt(max(0.0, 1.0 - (zz / rz) ** 2))
            p = Vector((0.0, bc[1] - ryf * f_, z))
            n = Vector((0.0, -f_ / ryf, (zz / rz) / rz)).normalized()
            fwd = -n
            xv = fwd.cross(Vector((0.0, 0.0, 1.0))).normalized()
            zv = xv.cross(fwd).normalized()
            bm = Matrix((xv, fwd, zv)).transposed().to_4x4()
            bm.translation = p
            self.add(f'button{k}', disc(0.03, 0.022, 20), M['shirt_d'], 'spine', bm)
        # the jacket's hem: a darker red band where it meets the trousers
        self.add('hem', torus(0.27, 0.03, 44, 10, center=(0.0, -0.035, -0.22), squash=1.2), M['jacket_d'], 'spine')

    def collar(self):
        """A rounded stand collar round the neck (mostly hidden under the moustache)."""
        M = self.mat
        cc = self.CHEST[3]
        self.add('collar', torus(0.14, 0.04, 32, 10, center=(0.0, cc[1], 0.13), squash=1.3), M['shirt'], 'chest')

    # --- legs: thin black trousers, black boots with a grey band -------------------------------------
    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('pleg' + s_, hip, kn, an, lambda t: 0.086 - 0.016 * t, M['pants'], 0.0, 0.8, 16, 14, cap0=True, cap1=False)
            self.limb('shaft' + s_, hip, kn, an, lambda t: 0.08 + 0.006 * t, M['shoe'], 0.66, 1.0, 16, 8, cap0=False, cap1=True)
            self.limb('bband' + s_, hip, kn, an, 0.087, M['band'], 0.655, 0.695, 16, 3, cap0=True, cap1=True)
            fm = self.J(an) @ R(0, 0, -8 * sd)
            self.add('boot' + s_, superellipsoid(0.1, 0.15, 0.072, 2.5, 22, 14, center=(0, -0.05, -0.05)), M['shoe'], None, fm)
            self.add('toe' + s_, ellipsoid(0.098, 0.09, 0.064, 18, 10, center=(0, -0.13, -0.066)), M['shoe'], None, fm)
            self.add('sole' + s_, superellipsoid(0.106, 0.17, 0.022, 3.0, 22, 8, center=(0, -0.058, -0.108)), M['sole'], None, fm)

    # --- arms: long red sleeves, white gloves with cuffs ----------------------------------------------
    def arms(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.084 - 0.01 * t, M['shirt'], 0.0, 0.92, 16, 14, cap0=True, cap1=False)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.16):
                self.add('glove' + nm + s_, mesh, M['glove'], None, wm)
            self.add('gcuff' + s_, torus(0.07, 0.026, 18, 8, center=(0, 0, -0.004)), M['glove_d'], None, wm)

    # --- head -----------------------------------------------------------------------------------------
    def head_parts(self):
        M, c = self.mat, self.C
        rx, ryf, ryb, rzt, rzb, hc = self.EGG
        egg = EggHead(rx, ryf, ryb, rzt, rzb, center=(0, 0, hc))
        self.egg = egg
        self.add('head', egg.mesh(52, 34), M['skin'], 'head')
        for sd in (1, -1):
            pos, _n = egg.point(90 * sd, 2, -0.02)
            m = T(*pos) @ R(0, 0, -6 * sd)
            self.add('ear', ellipsoid(0.04, 0.06, 0.08, 16, 10, center=(0.012 * sd, 0.0, 0.0)), M['skin'], 'head', m)
            self.add('earin', ellipsoid(0.02, 0.034, 0.05, 12, 8, center=(0.034 * sd, 0.0, 0.0)), M['skin_d'], 'head', m)
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        # the villain's grin is his resting face
        mouth = {'smile': 'grin', 'grin': 'laugh' if f['eyes'] == 'happy' else 'grin'}.get(f['mouth'], f['mouth'])
        saved = self.pose
        self.pose = dict(saved, face=dict(f, mouth=mouth))
        ey, ep = self.EYE
        Hero.face(self, egg, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(0.07, 0.084), iris=c['iris'], brow_col=c['tash_d'],
                  mouth_pitch=-41, mouth_w=2.0, lid_col=c['skin'], nose=False, skin=c['skin'], blush=False, brow_pitch=24,
                  lash_col='#2a1a14')
        self.pose = saved
        # no brows: they hide behind the glasses' rims
        self.parts = [p for p in self.parts if not p.name.startswith('brow')]
        self.nose_tash(egg)
        self.glasses(egg)
        self.goggles(egg)

    def nose_tash(self, egg: EggHead):
        M = self.mat
        # a round pink nose
        pos, n = egg.point(0, -3, 0.035)
        self.add('nose', ellipsoid(0.076, 0.072, 0.068, 22, 14, center=tuple(pos)), M['nose'], 'head')
        # the moustache: thick lobes from under the nose sweeping out and a little up past the cheeks
        acc_v, acc_f, acc_t = [], [], []

        def lobe(pts, r0, r1, flat):
            nrms = []
            for p in pts:
                _sp, sn = egg.surface(p - egg.c)
                nrms.append(sn)
            vv, ff = flat_sweep(pts, lambda t: r0 + (r1 - r0) * t ** 1.3 - 0.4 * r0 * max(0.0, t - 0.75) / 0.25,
                                lambda t: nrms[min(len(nrms) - 1, int(round(t * (len(nrms) - 1))))], flat, 14)
            b0 = len(acc_v)
            acc_v.extend(vv)
            acc_f.extend(tuple(q + b0 for q in face) for face in ff)
            rings = len(pts)
            for i in range(rings):
                acc_t.extend([0.2 + 0.8 * (i / (rings - 1)) ** 1.5] * 14)
            rest = len(vv) - rings * 14
            acc_t.extend([1.0] * (rest // 2) + [0.2] * (rest - rest // 2))

        for sd in (1, -1):
            # (yaw at the root, pitch at the root, tip yaw, tip pitch, tip lift, root radius, tip radius, flatness)
            for (y0, p0, y1, p1, l1, r0, r1, fl) in ((4, -13, 84, -4, 0.12, 0.08, 0.05, 0.5),
                                                   (6, -17, 74, -19, 0.09, 0.068, 0.045, 0.55),
                                                   (5, -9, 62, 6, 0.1, 0.058, 0.036, 0.5)):
                pts = []
                for i in range(13):
                    t = i / 12
                    yaw = (y0 + (y1 - y0) * t ** 0.85) * sd
                    pitch = p0 + (p1 - p0) * t ** 1.6
                    lift = 0.035 + l1 * t ** 1.8
                    p, _n = egg.point(yaw, pitch, lift)
                    pts.append(p)
                lobe(pts, r0, r1, fl)
        self.add('tash', (acc_v, acc_f), M['tash'], 'head', tip=acc_t)

    def glasses(self, egg: EggHead):
        """Small round glasses: thin dark rims, blue-tinted lenses (the eyes show through), a bridge."""
        M = self.mat
        ey, ep = self.EYE
        L = self.GLASS
        rr = 0.088
        inner = {}
        for sd in (1, -1):
            fr = egg.frame(ey * sd, ep - 1.0, L)
            self.add('lens', disc(rr, 0.006, 32), M['lens'], 'head', fr)
            self.add('rim', torus(rr, 0.011, 36, 8), M['frame'], 'head', fr @ R(90, 0, 0))
            # a small glint on the lens
            self.add('glint', ellipsoid(0.02, 0.003, 0.012, 10, 6, center=(-0.035 * sd, -0.006, 0.038)), M['shine'], 'head', fr @ R(0, 30 * sd, 0))
            inner[sd] = fr @ Vector((-rr * sd, 0.0, 0.008))
            # the arms run back over the ears
            a = fr @ Vector((rr * sd, 0.0, 0.01))
            b, _n = egg.point(70 * sd, ep - 2, 0.016)
            cpt, _n2 = egg.point(92 * sd, ep - 6, 0.02)
            self.add('arm', sweep(curve3(a, b, cpt, 8), 0.009, 6), M['frame'], 'head')
        mid, _n = egg.point(0, ep + 2, L + 0.012)
        self.add('bridge', sweep(curve3(inner[-1], mid, inner[1], 10), 0.01, 6), M['frame'], 'head')

    def goggles(self, egg: EggHead):
        """The goggles pushed up on the crown: a dark strap round the head and two blue-lensed cups."""
        M = self.mat
        front, back = 50.0, 16.0

        def pitch(yaw):
            return back + (front - back) * (0.5 + 0.5 * math.cos(math.radians(yaw)))

        pts, nrms = [], []
        for i in range(73):
            yaw = -180.0 + 360.0 * i / 72
            p, n = egg.point(yaw, pitch(yaw), 0.012)
            pts.append(p)
            nrms.append(n)
        self.add('strap', flat_sweep(pts, 0.04, lambda t: nrms[min(72, int(round(t * 72)))], 0.28, 10, cap0=False, cap1=False), M['strap'], 'head')
        cups = {}
        for sd in (1, -1):
            yaw = 21.0 * sd
            p, n = egg.point(yaw, pitch(yaw) + 2.0, 0.0)
            tilt = (n + Vector((0.0, -1.1, 0.0))).normalized()
            a, b = p - tilt * 0.02, p + tilt * 0.06
            self.add('cup', sweep([a, b], 0.084, 22, cap0=True, cap1=False), M['frame'], 'head')
            self.add('cuprim', torus(0.084, 0.016, 28, 8), M['metal'], 'head', lm_at(b, tilt) @ R(90, 0, 0))
            # the lens faces out along the cup
            lm = lm_at(b + tilt * 0.004, tilt)
            self.add('glens', ellipsoid(0.072, 0.02, 0.072, 24, 10), M['goggle'], 'head', lm)
            self.add('gglint', ellipsoid(0.022, 0.004, 0.014, 10, 6, center=(-0.026, -0.02, 0.03)), M['shine'], 'head', lm)
            cups[sd] = b - tilt * 0.03
        self.add('gbridge', sweep(curve3(cups[-1], (cups[-1] + cups[1]) * 0.5 + Vector((0.0, -0.01, 0.02)), cups[1], 8), 0.018, 8),
                 M['frame'], 'head')


MODEL = Eggman
