"""Luffy: a fan-made chibi Monkey D. Luffy (One Piece) for the private party build (loaded by
characters.py as class `Luffy`).

Built on the shared Hero structure (char_models.py) with Kip's chibi proportions, a little wirier:
a golden woven straw hat with a red band pushed onto the back of his head, messy black hair poking
out under it, the small stitched scar under his left eye, a big toothy grin as his resting face, a
red sleeveless vest with four yellow buttons worn open over a bare chest, blue shorts rolled at the
knee with white fluffy cuffs, bare tan arms and legs and straw sandals.

The face goes through Hero.face()'s expression states; `face()` below is a copy of it with one
extra mouth: the resting 'smile' and the 'grin' become Luffy's wide D-shaped grin full of teeth.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from char_rig import (HeadShape, R, T, arc_points, curve3, disc, ellipsoid, flat_sweep, polyline_segment, rmf_frames, superellipsoid,
                      sweep, torus)
from char_models import DEFAULT_FACE, Hero, hair_shell, hand_mitten, periodic_interp


# ------------------------------------------------------------------------------------------
# Small helpers (local copies so this module only depends on the shared files as they are)
def clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return max(a, min(b, x))


def sstep(x: float) -> float:
    x = clamp(x)
    return x * x * (3.0 - 2.0 * x)


class MeshAcc:
    """Accumulates several meshes (and their 'tip' values) into one part."""

    def __init__(self):
        self.v, self.f, self.tip = [], [], []

    def add(self, mesh, tip=None, m: Matrix | None = None):
        vv, ff = mesh[0], mesh[1]
        if m is not None:
            vv = [tuple(m @ Vector(q)) for q in vv]
        b0 = len(self.v)
        self.v.extend(tuple(q) for q in vv)
        self.f.extend(tuple(q + b0 for q in face) for face in ff)
        if tip is not None:
            self.tip.extend(tip)
        elif len(mesh) > 2:
            self.tip.extend(mesh[2])

    @property
    def mesh(self):
        return self.v, self.f


def flat_tip(n: int, sides: int, nverts: int, t0: float = 0.0, t1: float = 1.0):
    """'tip' values for a sweep / flat_sweep of n rings: t0..t1 along the rings, then both caps."""
    tip = []
    for i in range(n):
        tip += [t0 + (t1 - t0) * i / max(1, n - 1)] * sides
    rest = nverts - n * sides
    tip += [t1] * (rest // 2) + [t0] * (rest - rest // 2)
    return tip


def tube(pts, radius, sides: int = 24, cap_steps: int = 4, caps: bool = True):
    """Like char_rig.sweep, but radius(t, a) may vary around the tube (a = angle in radians)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    frames = rmf_frames(pts)
    verts, faces = [], []
    for i, p in enumerate(pts):
        _t, u, v = frames[i]
        tt = i / max(1, n - 1)
        for k in range(sides):
            a = k / sides * math.tau
            verts.append(tuple(p + (u * math.cos(a) + v * math.sin(a)) * radius(tt, a)))
    for i in range(n - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    if not caps:
        return verts, faces

    def cap(idx, sign):
        t, u, v = frames[idx]
        p = pts[idx]
        tt = idx / max(1, n - 1)
        r0 = sum(radius(tt, k / sides * math.tau) for k in range(sides)) / sides
        prev = list(range(idx * sides, idx * sides + sides))
        for s_ in range(1, cap_steps):
            ang = s_ / cap_steps * math.pi / 2
            ring = []
            for k in range(sides):
                a = k / sides * math.tau
                q = p + t * (sign * math.sin(ang) * r0 * 0.6) + (u * math.cos(a) + v * math.sin(a)) * (radius(tt, a) * math.cos(ang))
                verts.append(tuple(q))
                ring.append(len(verts) - 1)
            for k in range(sides):
                k2 = (k + 1) % sides
                if sign > 0:
                    faces.append((prev[k], prev[k2], ring[k2], ring[k]))
                else:
                    faces.append((prev[k], ring[k], ring[k2], prev[k2]))
            prev = ring
        verts.append(tuple(p + t * (sign * r0 * 0.6)))
        tip = len(verts) - 1
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((prev[k], prev[k2], tip) if sign > 0 else (prev[k], tip, prev[k2]))

    cap(n - 1, 1)
    cap(0, -1)
    return verts, faces


def lathe(profile, seg: int = 48, closed: bool = False):
    """Revolve a profile [(r, z), ...] around Z. Points with r == 0 become poles; closed joins the
    last profile point back to the first (a solid ring such as a hat brim)."""
    verts, faces, rings = [], [], []
    for r, z in profile:
        if r < 1e-6:
            verts.append((0.0, 0.0, z))
            rings.append(len(verts) - 1)
        else:
            ring = []
            for k in range(seg):
                a = k / seg * math.tau
                verts.append((r * math.cos(a), r * math.sin(a), z))
                ring.append(len(verts) - 1)
            rings.append(ring)
    pairs = list(zip(rings, rings[1:]))
    if closed:
        pairs.append((rings[-1], rings[0]))
    for a, b in pairs:
        if isinstance(a, int) and isinstance(b, int):
            continue
        for k in range(seg):
            k2 = (k + 1) % seg
            if isinstance(a, int):
                faces.append((a, b[k], b[k2]))
            elif isinstance(b, int):
                faces.append((a[k], b, a[k2]))
            else:
                faces.append((a[k], b[k], b[k2], a[k2]))
    return verts, faces


def open_shell(rings, sides: int = 26, thick: float = 0.02):
    """A partial tube with thickness through rings [(z, rx, ry, a0, a1)] (angles in degrees, 0 = +X,
    -90 = the front): an open garment whose opening may change width from ring to ring."""
    verts, faces = [], []
    n = len(rings)
    row = sides + 1
    for dr in (0.0, -thick):
        for (z, rx, ry, a0, a1) in rings:
            for k in range(row):
                a = math.radians(a0 + (a1 - a0) * k / sides)
                verts.append((math.cos(a) * (rx + dr), math.sin(a) * (ry + dr), z))
    L = n * row
    for i in range(n - 1):
        for k in range(sides):
            a = i * row + k
            faces.append((a, a + 1, a + 1 + row, a + row))
            b = L + a
            faces.append((b, b + row, b + 1 + row, b + 1))
    for i in range(n - 1):
        for k in (0, sides):
            a = i * row + k
            b = L + a
            if k == 0:
                faces.append((a, a + row, b + row, b))
            else:
                faces.append((a, b, b + row, a + row))
    for i in (0, n - 1):
        for k in range(sides):
            a = i * row + k
            b = L + a
            if i == 0:
                faces.append((a, b, b + 1, a + 1))
            else:
                faces.append((a, a + 1, b + 1, b))
    return verts, faces


def orient(pos, nrm, roll: float = 0.0) -> Matrix:
    """A frame at `pos` whose -Y faces along `nrm` (details are modelled facing -Y, up +Z)."""
    fwd = -Vector(nrm).normalized()
    x = fwd.cross(Vector((0.0, 0.0, 1.0)))
    if x.length < 1e-4:
        x = Vector((1.0, 0.0, 0.0))
    x.normalize()
    z = x.cross(fwd).normalized()
    m = Matrix((x, fwd, z)).transposed().to_4x4()
    m.translation = Vector(pos)
    return m @ R(0, roll, 0)


# ------------------------------------------------------------------------------------------
class Luffy(Hero):
    """Luffy: straw hat on the back of his head, red open vest, blue rolled shorts, sandals."""

    key = 'luffy'
    ankle_h = 0.12
    hip_h = 0.62  # ankle_h + 0.04 + thigh + shin
    spine = 0.08
    chest = 0.19
    neck = 0.14
    head_up = 0.04
    shoulder = (0.205, 0.0, 0.11)
    upper_arm = 0.215
    forearm = 0.195
    hip_w = 0.1
    thigh = 0.225
    shin = 0.235
    sit_h = 0.16

    C = dict(skin='#eeb07e', skin_d='#d8905f', hair_d='#0d0c11', hair_l='#3b3a48', vest='#d9262c', vest_d='#a8161d', button='#f6c431',
             shorts='#3f73c4', shorts_d='#2c5598', cuff='#f7f4ec', straw='#f0c04e', straw_l='#fbdf82', straw_d='#c68d2c', band='#d21f2a',
             sandal='#dcae62', strap='#8c5a2a', scar='#8a3528', iris='#2a1a15', brow='#15110f')

    HEAD = (0.4, 0.375, 0.39, 0.41)  # rx, ry, rz, centre height above the head joint
    HAT_TILT = 22.0  # degrees the hat is pushed back on his head

    def head_top(self) -> float:
        # the dizzy stars circle above the hat crown
        return self.HEAD[3] + 0.56

    # --- materials ----------------------------------------------------------------------------
    def straw_mat(self, name: str):
        """Golden woven straw: concentric braid rings (object space, centred on the hat) and fine grain."""
        c = self.C

        def make(n):
            m = lib.NT(n)
            tc = m.node('ShaderNodeTexCoord')
            obj = tc.outputs['Object']
            wv = m.node('ShaderNodeTexWave')
            wv.wave_type = 'RINGS'
            wv.rings_direction = 'SPHERICAL'
            wv.wave_profile = 'SIN'
            wv.inputs['Scale'].default_value = 9.0
            wv.inputs['Distortion'].default_value = 0.6
            wv.inputs['Detail'].default_value = 1.0
            m.link(obj, wv.inputs['Vector'])
            rings = wv.outputs['Fac']
            grain = m.noise(110.0, 3, 0.6, obj).outputs['Fac']
            weave = m.noise(40.0, 2, 0.5, obj).outputs['Fac']
            f = m.math('ADD', m.math('MULTIPLY', rings, 0.62), m.math('ADD', m.math('MULTIPLY', grain, 0.24), m.math('MULTIPLY', weave, 0.14)))
            colr = m.ramp(f, [(0.18, c['straw_d']), (0.5, c['straw']), (0.82, c['straw_l'])])
            nrm = m.bump(f, 0.35, 0.02)
            m.bsdf(colr, 0.6, normal=nrm, sheen=0.35, spec=0.3)
            return m.mat
        return self.m.get(name, make)

    # --- building -------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('luffy_skin', c['skin']),
            skin_d=mt.skin('luffy_skin_d', c['skin_d']),
            vest=mt.cloth('luffy_vest', c['vest'], 0.7, 0.4, 0.08),
            vest_d=mt.cloth('luffy_vest_d', c['vest_d'], 0.7, 0.35),
            button=mt.glossy('luffy_button', c['button'], 0.3, 0.5),
            shorts=mt.cloth('luffy_shorts', c['shorts'], 0.8, 0.35, 0.14, 70),
            shorts_d=mt.cloth('luffy_shorts_d', c['shorts_d'], 0.8, 0.3),
            cuff=mt.fur('luffy_cuff', c['cuff']),
            straw=self.straw_mat('luffy_straw'),
            band=mt.cloth('luffy_band', c['band'], 0.6, 0.4, 0.05),
            strap=mt.cloth('luffy_strap', c['strap'], 0.6, 0.2),
            hair=mt.hair('luffy_hair', c['hair_d'], c['hair_l'], 0.36),
            scar=mt.glossy('luffy_scar', c['scar'], 0.45, 0.2),
        )
        self.torso()
        self.legs()
        self.arms()
        self.head_parts()

    def torso(self):
        mm = self.mat

        def rb(z):  # torso radius (x) at chest-frame height z
            t = (z + 0.36) / 0.48
            return 0.198 - 0.024 * t + 0.012 * math.sin(math.pi * clamp(t))

        # bare chest and the top of the shoulders (skin), shorts (hips frame)
        self.add('chest', sweep([Vector((0, 0, -0.36 + 0.48 * i / 10)) for i in range(11)], lambda t: rb(-0.36 + 0.48 * t) - 0.014, 24,
                                cap0=False, squash=0.8), mm['skin'], 'chest')
        self.add('chesttop', ellipsoid(0.182, 0.146, 0.08, 26, 12, center=(0, 0, 0.1), zmin=-0.2), mm['skin'], 'chest')
        # a belly button so the bare chest doesn't read as a flat panel
        self.add('navel', ellipsoid(0.011, 0.006, 0.014, 10, 6, center=(0.0, -0.148, -0.27)), mm['skin_d'], 'chest')
        # the vest: open down the front, the opening widening over the collarbones to the neck
        rings = []
        for i in range(12):
            z = -0.335 + (0.1 + 0.335) * i / 11
            rx = rb(z) + 0.006
            g = 30.0 + 12.0 * sstep((z + 0.05) / 0.15)
            rings.append((z, rx, rx * 0.8, -90 + g, 270 - g))
        rx_top = rings[-1][1]
        for i in range(1, 10):
            ph = math.radians(58 * i / 9)
            z = 0.1 + 0.088 * math.sin(ph)
            r = rx_top * math.cos(ph) + 0.004 * math.sin(ph)
            g = 42.0 + 40.0 * sstep(i / 9) ** 0.8
            rings.append((z, r, r * 0.8, -90 + g, 270 - g))
        self.add('vest', open_shell(rings, 30, 0.02), mm['vest'], 'chest')
        # four yellow buttons down his right-hand flap
        for k, z in enumerate((0.035, -0.06, -0.155, -0.25)):
            g = 30.0 + 12.0 * sstep((z + 0.05) / 0.15)
            a = math.radians(270 - g - 8)
            rx = rb(z) + 0.012
            p = Vector((math.cos(a) * rx, math.sin(a) * rx * 0.8, z))
            n = Vector((math.cos(a) / rx, math.sin(a) / (rx * 0.8), 0.0)).normalized()
            bm = orient(p, n)
            self.add(f'button{k}', disc(0.02, 0.016, 18), mm['button'], 'chest', bm)
            self.add(f'buttonrim{k}', torus(0.017, 0.005, 16, 6), mm['button'], 'chest', bm @ T(0, -0.008, 0) @ R(90, 0, 0))
        # shorts
        self.add('pelvis', superellipsoid(0.19, 0.158, 0.15, 2.4, 28, 16, center=(0, 0, -0.04)), mm['shorts'], 'hips')
        self.add('waist', torus(0.186, 0.02, 36, 8, center=(0, 0, 0.07)), mm['shorts_d'], 'hips', lib_scale(1.0, 0.84, 1.0))
        # neck
        a = self.J('chest') @ Vector((0.0, 0.0, 0.1))
        b = self.J('neck') @ Vector((0.0, 0.0, 0.03))
        cc = self.J('head') @ Vector((0.0, 0.01, 0.12))
        self.add('neck', sweep(curve3(a, b, cc, 6), 0.068, 14), mm['skin'])

    def limb_pts(self, a, b, c, t0, t1, n=8):
        return polyline_segment(curve3(self.P(a), self.P(b), self.P(c), 24), t0, t1, n)

    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('shorts' + s_, hip, kn, an, lambda t: 0.11 + 0.018 * t, mm['shorts'], 0.0, 0.43, 16, 8, cap0=True, cap1=False)
            # the rolled, fluffy white cuff just above the knee
            seg = self.limb_pts(hip, kn, an, 0.385, 0.475, 6)
            ph = 1.7 * sd

            def cuff_r(t, a, ph=ph):
                fluff = 0.07 * math.cos(9 * a + ph) + 0.04 * math.cos(14 * a + 2 * ph) + 0.025 * math.cos(5 * a - ph)
                return (0.118 + 0.016 * math.sin(math.pi * t)) * (1.0 + fluff * (0.6 + 0.4 * math.sin(math.pi * t)))
            self.add('cuff' + s_, tube(seg, cuff_r, 36, 4), mm['cuff'])
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.062 - 0.012 * t + 0.008 * math.sin(math.pi * clamp((t - 0.15) / 0.55)), mm['skin'],
                      0.42, 1.0, 12, 12)
            # bare foot on a straw sandal
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('foot' + s_, superellipsoid(0.074, 0.122, 0.048, 2.3, 20, 12, center=(0, -0.058, -0.035)), mm['skin'], None, fm)
            self.add('toes' + s_, ellipsoid(0.068, 0.052, 0.036, 16, 10, center=(0.004 * sd, -0.148, -0.05)), mm['skin'], None, fm)
            self.add('bigtoe' + s_, ellipsoid(0.026, 0.028, 0.024, 12, 8, center=(-0.036 * sd, -0.19, -0.052)), mm['skin'], None, fm)
            self.add('sandal' + s_, superellipsoid(0.1, 0.168, 0.02, 3.2, 24, 8, center=(0, -0.07, -0.1)), mm['straw'], None, fm)
            # thong strap: from between the toes over the instep to both sides of the sole
            for q in (1, -1):
                pts = [Vector((-0.022 * sd, -0.162, -0.078)), Vector((0.03 * q - 0.01 * sd, -0.11, -0.022)), Vector((0.07 * q, -0.05, -0.05)),
                       Vector((0.084 * q, -0.03, -0.086))]
                self.add(f'strap{q}{s_}', sweep(polyline_segment(pts, 0, 1, 10), 0.013, 8, squash=0.7), mm['strap'], None, fm)

    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.054 - 0.01 * t + 0.005 * math.sin(math.pi * t), mm['skin'], 0.0, 1.0, 12, 14, extend=0.02)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.16):
                self.add('hand' + nm + s_, mesh, mm['skin'], None, wm)

    # --- head -------------------------------------------------------------------------------------
    def head_parts(self):
        c, mm = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        hv = [(x * (1 - 0.1 * max(0.0, (hc - z) / hz) ** 1.6), y - 0.02 * max(0.0, (hc - z) / hz) ** 2, z) for (x, y, z) in hv]
        self.add('head', (hv, hf), mm['skin'], 'head')
        for sd in (1, -1):
            self.add('ear', ellipsoid(0.062, 0.04, 0.082, 16, 10), mm['skin'], 'head', T((hx - 0.01) * sd, 0.03, hc - 0.05) @ R(0, 0, -14 * sd))
            self.add('earin', ellipsoid(0.034, 0.02, 0.048, 12, 8), mm['skin_d'], 'head', T((hx - 0.004) * sd, 0.0, hc - 0.05) @ R(0, 0, -14 * sd))
        self.face(head, 'head', eye_yaw=23, eye_pitch=-5, eye_size=(0.094, 0.122), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-32,
                  lid_col=c['skin'], skin=c['skin'], brow_pitch=21, lash_col='#120d0c')
        self.scar(head)
        self.hair()
        self.hat()

    def scar(self, head: HeadShape):
        """The small stitched scar under his left eye (+X, screen right when he faces us)."""
        m = self.mat['scar']
        fr = head.frame(30, -29.5, 0.002)
        w = 0.078
        pts = arc_points(w, 0.012, 12, y=-0.003)
        self.feat('scar', sweep(pts, lambda t: 0.0048 + 0.0022 * math.sin(math.pi * t), 6), m, 'head', head, fr)
        for x in (-0.02, 0.018):
            z0 = -0.012 * (1 - (2 * x / w) ** 2)
            st = [Vector((x - 0.003, -0.003, z0 + 0.017)), Vector((x + 0.003, -0.003, z0 - 0.017))]
            self.feat('stitch', sweep(st, 0.0042, 6), m, 'head', head, fr)

    def hair(self):
        hair = self.mat['hair']
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))
        # messy pointed bangs: (yaw of the tip, pitch the tip reaches down to)
        tips = [(-64, 10), (-50, 17), (-36, 5), (-21, 14), (-7, 2), (8, 12), (22, 4), (37, 15), (51, 6), (64, 12)]
        back = [(110, -4), (124, -26), (140, -14), (152, -36), (166, -22), (180, -38)]

        def pointed(yaw, lst, high, width):
            best = high
            for ty, low in lst:
                d = abs(yaw - ty)
                best = min(best, low + (high - low) * min(1.0, d / width) ** 0.7)
            return best

        def boundary(yaw):
            a = abs(yaw)
            if a <= 68:
                return pointed(yaw, tips, 32.0, 8.5)
            side = periodic_interp([(68, 26), (76, -2), (84, -12), (92, 14), (104, 10)], min(a, 104))
            if a <= 104:
                return side
            mirror = [(ty, low) for ty, low in back] + [(-ty, low) for ty, low in back]
            return min(pointed(yaw, mirror, 0.0, 8.0), 10.0 - 10.0 * sstep((a - 104) / 12))

        def thickness(yaw, pitch, f):
            ridge = 0.5 + 0.5 * math.cos(math.radians(yaw) * 17 + 0.5)
            edge = min(1.0, f / 0.2)
            return 0.012 + 0.024 * math.sin(math.pi * min(1.0, f * 1.2)) * edge + 0.018 * ridge * edge

        v, f, tp = hair_shell(hs, boundary, thickness, 150, 22)
        self.add('hair', (v, f), hair, 'head', tip=tp)
        # loose spiky locks poking out from under the brim at the sides and the back
        acc = MeshAcc()
        hs2 = HeadShape(hx + 0.04, hy + 0.04, hz + 0.04, center=(0, 0.01, hc + 0.01))

        def lock(yaw, pitch, length, r0, flow, flick, flat=0.55):
            pos, n = hs2.point(yaw, pitch, -0.03)
            fl = Vector(flow).normalized()
            fl = (fl - n * fl.dot(n)).normalized()
            pts = [pos + fl * (length * t) + n * (length * flick * t * t) for t in [k / 9 for k in range(10)]]
            vv = flat_sweep(pts, lambda t: r0 * (1 - 0.8 * t ** 1.2), n, flat, 12)
            acc.add(vv, flat_tip(10, 12, len(vv[0]), 0.1, 1.0))

        for sd in (1, -1):
            lock(97 * sd, 22, 0.15, 0.07, (0.3 * sd, 0.25, -1.0), 0.65)
            lock(118 * sd, 14, 0.16, 0.075, (0.4 * sd, 0.6, -1.0), 0.7)
            lock(142 * sd, 8, 0.15, 0.075, (0.3 * sd, 0.7, -1.0), 0.75)
        lock(178, 6, 0.15, 0.08, (0.05, 0.7, -1.0), 0.75)
        lock(-14, 40, 0.13, 0.07, (-0.35, -0.2, -1.0), 0.35)
        lock(18, 42, 0.12, 0.065, (0.4, -0.2, -1.0), 0.35)
        self.add('locks', acc.mesh, hair, 'head', tip=acc.tip)

    def hat(self):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        # secondary motion (same pose keys Kip's scarf uses): the wind of a run lifts the brim back a
        # little and it rocks with the stride
        ex = self.pose.get('extra', {})
        fly = clamp(ex.get('scarf', 0.0))
        tilt = self.HAT_TILT + 5.0 * fly + 1.5 * fly * math.sin(ex.get('wave', 0.0))
        roll = 3.0 + 2.5 * ex.get('sway', 0.0)
        d = 0.19
        a = math.radians(tilt)
        base = Vector((0.0, d * math.sin(a), hc + d * math.cos(a)))
        hm = T(*base) @ R(-tilt, roll, 0.0)
        Rc, H, Rb = 0.372, 0.3, 0.67
        # crown: a rounded dome, a little boxy
        prof = []
        p = 2.7
        for i in range(15):
            ph = (1 - i / 14) * math.pi / 2
            r = Rc * math.cos(ph) ** (2 / p)
            z = H * math.sin(ph) ** (2 / p)
            prof.append((r, z))
        prof.append((Rc - 0.004, -0.04))
        self.add('hatcrown', lathe(prof, 60), mm['straw'], 'head', hm)
        # brim: wide, drooping a little at the edge, with a rolled rim
        def droop(r):
            return -0.03 * ((r - Rc) / (Rb - Rc)) ** 2
        rs = [Rc - 0.04 + (Rb - 0.014 - (Rc - 0.04)) * i / 9 for i in range(10)]
        top = [(r, droop(r) + 0.011) for r in rs]
        rim = [(Rb - 0.004, droop(Rb) + 0.009), (Rb + 0.006, droop(Rb)), (Rb - 0.004, droop(Rb) - 0.01)]
        bottom = [(r, droop(r) - 0.011) for r in reversed(rs)]
        self.add('hatbrim', lathe(top + rim + bottom, 80, closed=True), mm['straw'], 'head', hm)
        # the red band round the base of the crown
        band = [(Rc - 0.006, 0.0), (Rc + 0.012, 0.004), (Rc + 0.016, 0.03), (Rc + 0.014, 0.066), (Rc - 0.004, 0.074), (Rc - 0.02, 0.07),
                (Rc - 0.02, 0.004)]
        self.add('hatband', lathe(band, 60, closed=True), mm['band'], 'head', hm)

    # --- face (a copy of Hero.face with Luffy's big grin) -------------------------------------------
    def face(self, head: HeadShape, joint: str, *, eye_yaw=27.0, eye_pitch=0.0, eye_size=(0.085, 0.105), iris='#6b3a1e',
             brow_col='#4a2c1a', mouth_pitch=-24.0, mouth_w=1.0, lid_col=None, nose=True, skin=None, blush=True, brow_pitch=19.0,
             lash_col='#2a1a14'):
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        eyes, mouth, brows = f['eyes'], f['mouth'], f['brows']
        lx, lz = f.get('look', (0.0, 0.0))
        mt = self.m
        white = mt.glossy('eye_white', '#fbfbf8', 0.18, 0.8)
        dark = mt.glossy('eye_dark', '#1c1412', 0.25, 0.9)
        irm = mt.glossy(f'iris_{iris}', iris, 0.2, 0.9)
        shine = mt.emit('eye_shine', '#ffffff', 3.0)
        mouth_m = mt.glossy('mouth', '#6d2a26', 0.4, 0.2)
        tongue = mt.glossy('tongue', '#e8797b', 0.35, 0.3)
        teeth = mt.glossy('teeth', '#fffdf6', 0.25, 0.4)
        lash = mt.glossy(f'lash_{lash_col}', lash_col, 0.4, 0.2)
        browm = mt.cloth(f'brow_{brow_col}', brow_col, 0.6, 0.2)
        ew, eh = eye_size
        ed = ew * 0.34
        for side in (1, -1):
            yaw = eye_yaw * side
            fr = head.frame(yaw, eye_pitch, -ed * 0.55)
            name = 'L' if side > 0 else 'R'
            kind = eyes
            if eyes == 'wink':
                kind = 'open' if side > 0 else 'happy'
            if kind in ('open', 'wide', 'sad', 'determined', 'dizzy', 'half'):
                sc = 1.12 if kind == 'wide' else 1.0
                self.feat(f'sclera{name}', ellipsoid(ew * sc, ed, eh * sc, 22, 14), white, joint, head, fr)
                if kind == 'dizzy':
                    pts = []
                    for i in range(40):
                        a = i / 40 * math.tau * 2.2
                        r = 0.012 + (ew * 0.72 - 0.012) * i / 40
                        pts.append(Vector((math.cos(a) * r * side, -ed * 1.02, math.sin(a) * r * 1.15)))
                    self.feat(f'spiral{name}', sweep(pts, 0.0085, 6), dark, joint, head, fr)
                else:
                    ir = 0.86 * ew * (0.8 if kind == 'wide' else 1.0)
                    off = Vector((lx * ew * 0.22 - 0.1 * ew * side, -ed * 0.9, lz * eh * 0.2 - eh * 0.04))
                    self.feat(f'iris{name}', ellipsoid(ir, ed * 0.22, ir * 1.1, 20, 10, center=off), irm, joint, head, fr)
                    pr = ir * 0.58
                    self.feat(f'pupil{name}', ellipsoid(pr, ed * 0.2, pr * 1.12, 16, 8, center=off + Vector((0.0, -ed * 0.12, 0.0))), dark, joint, head, fr)
                    h1 = off + Vector((-ir * 0.38, -ed * 0.3, ir * 0.42))
                    self.feat(f'shine{name}', ellipsoid(ir * 0.34, 0.004, ir * 0.36, 10, 6, center=h1), shine, joint, head, fr)
                    h2 = off + Vector((ir * 0.4, -ed * 0.3, -ir * 0.4))
                    self.feat(f'shine2{name}', ellipsoid(ir * 0.13, 0.004, ir * 0.13, 8, 5, center=h2), shine, joint, head, fr)
                lash_pts = [Vector((math.sin(a) * ew * 1.02, -ed * 0.55, math.cos(a) * eh * 1.0)) for a in [(-1 + 2 * i / 12) * 1.25 for i in range(13)]]
                self.feat(f'lash{name}', sweep(lash_pts, lambda t: 0.006 + 0.006 * math.sin(math.pi * t), 6), lash, joint, head, fr)
                lid = {'sad': 0.42, 'determined': 0.36, 'half': 0.5}.get(kind)
                if lid and lid_col:
                    lidm = mt.skin(f'lid_{lid_col}', lid_col)
                    tilt = {'sad': -16 * side, 'determined': 14 * side}.get(kind, 0)
                    lid_mesh = ellipsoid(ew * 1.12, ed * 1.25, eh * 1.1, 20, 10, zmin=1 - lid * 2)
                    self.feat(f'lid{name}', lid_mesh, lidm, joint, head, fr @ R(0, tilt, 0) @ T(0, -0.004, 0))
            elif kind == 'happy':
                pts = arc_points(ew * 1.7, -eh * 0.42, 12, y=-0.01)
                self.feat(f'happy{name}', sweep([p + Vector((0, 0, -eh * 0.15)) for p in pts], 0.0125, 8), lash, joint, head, fr)
            elif kind == 'closed':
                pts = arc_points(ew * 1.6, eh * 0.22, 12, y=-0.01)
                self.feat(f'closed{name}', sweep(pts, 0.0115, 8), lash, joint, head, fr)
            b_pitch = eye_pitch + brow_pitch + (4 if brows == 'up' else 0) + (2 if eyes == 'wide' else 0)
            roll = {'neutral': 0, 'up': -4, 'worried': 16, 'angry': -18, 'determined': -12, 'sad': 14}.get(brows, 0) * side
            bf = head.frame(yaw * 1.02, b_pitch, 0.004, roll)
            bpts = arc_points(ew * 1.5, -0.012, 8)
            self.feat(f'brow{name}', sweep(bpts, lambda t: 0.013 + 0.007 * math.sin(math.pi * t), 8), browm, joint, head, bf)
        skin_m = mt.skin(f'skin_{skin}', skin) if skin else None
        if nose and skin_m:
            nf = head.frame(0, eye_pitch - 13, -0.004)
            self.feat('nose', ellipsoid(0.028, 0.024, 0.022, 14, 8), skin_m, joint, head, nf)
        if blush:
            bl = mt.alpha('blush', '#ff8a8a', 0.35)
            for side in (1, -1):
                bf = head.frame(side * (eye_yaw + 13), eye_pitch - 16, 0.003)
                self.feat('blush', ellipsoid(0.048, 0.004, 0.028, 14, 6), bl, joint, head, bf)
        mf = head.frame(0, mouth_pitch, 0.0)
        w = 0.12 * mouth_w
        if mouth in ('smile', 'grin', 'laugh'):
            # Luffy's grin: wide and D-shaped, the top edge curling up at the corners, a full row of teeth
            gw, gh = {'smile': (0.25, 0.088), 'grin': (0.255, 0.094), 'laugh': (0.25, 0.11)}[mouth]
            curl = gh * 0.42

            def bent(vs, dy=0.0):
                return [(x, y + dy, z + curl * (abs(x) / (gw / 2)) ** 2.2) for (x, y, z) in vs]
            mv, mfc = ellipsoid(gw / 2, 0.014, gh, 32, 14, zmax=0.32)
            self.feat('mouth', (bent(mv), mfc), mouth_m, joint, head, mf @ T(0, 0.002, 0.0))
            tv, tf = ellipsoid(gw / 2 * 0.95, 0.012, gh, 32, 6, zmin=-0.2, zmax=0.3)
            self.feat('teeth', (bent(tv, -0.006), tf), teeth, joint, head, mf @ T(0, 0.002, 0.0))
            self.feat('tongue', ellipsoid(gw * 0.2, 0.01, gh * 0.28, 14, 8, center=(0, -0.008, -gh * 0.68)), tongue, joint, head, mf)
        elif mouth == 'open':
            hh = 0.06
            self.feat('mouth', ellipsoid(w * 0.95 / 2, 0.02, hh, 22, 12, zmax=0.15), mouth_m, joint, head, mf @ T(0, 0.002, 0.006))
            self.feat('tongue', ellipsoid(w * 0.95 * 0.3, 0.012, hh * 0.45, 14, 8, center=(0, -0.008, -hh * 0.6)), tongue, joint, head, mf)
            self.feat('teeth', ellipsoid(w * 0.95 * 0.42, 0.01, 0.012, 14, 6, center=(0, -0.012, 0.0)), teeth, joint, head, mf)
        elif mouth == 'o':
            self.feat('mouth', ellipsoid(0.028, 0.018, 0.034, 16, 10), mouth_m, joint, head, mf @ T(0, 0.004, -0.004))
        elif mouth == 'gasp':
            self.feat('mouth', ellipsoid(0.04, 0.02, 0.055, 16, 10), mouth_m, joint, head, mf @ T(0, 0.004, -0.012))
            self.feat('tongue', ellipsoid(0.02, 0.01, 0.018, 12, 6, center=(0, -0.012, -0.045)), tongue, joint, head, mf)
        elif mouth == 'frown':
            self.feat('mouth', sweep(arc_points(w * 0.85, -0.024, 12, y=-0.006), 0.009, 8), mouth_m, joint, head, mf @ T(0, 0, -0.012))
        elif mouth == 'flat':
            self.feat('mouth', sweep([Vector((-w * 0.32, -0.006, 0)), Vector((w * 0.32, -0.006, 0))], 0.009, 8), mouth_m, joint, head, mf)
        elif mouth == 'wobble':
            pts = [Vector(((i / 12 - 0.5) * w * 0.9, -0.006, math.sin(i / 12 * math.tau * 1.5) * 0.012)) for i in range(13)]
            self.feat('mouth', sweep(pts, 0.009, 8), mouth_m, joint, head, mf)
        elif mouth == 'smirk':
            pts = [Vector(((i / 12 - 0.5) * w * 0.8, -0.006, 0.02 * (i / 12) ** 2)) for i in range(13)]
            self.feat('mouth', sweep(pts, 0.009, 8), mouth_m, joint, head, mf)


def lib_scale(x, y, z):
    return Matrix.Diagonal((x, y, z, 1.0))
