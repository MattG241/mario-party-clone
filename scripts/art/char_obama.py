"""Barack Obama: an affectionate chibi caricature for the private party game (loaded by characters.py
as class `Obama`), built on the shared Hero structure (char_models.py) with Kip's chibi proportions and a
slim, slightly tall build (a little longer in the legs and torso).

Signature details, picked so he reads at board size (~120 px tall):
  * short, close-cropped black hair greying at the temples, with a neat hairline;
  * warm brown skin, brown eyes, dark gently arched brows, ears that stand out a little, and a big
    friendly smile as his resting face;
  * a dark charcoal two-piece suit buttoned at the waist, a white shirt, a blue necktie, a small flag pin
    on the left lapel, black dress shoes.

The suit (jacket with lapels over a shirt front, collar, tie, trousers, belt, shoes) is the module's
SuitHero helper; the hero sets its proportions and colours.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import HeadShape, R, T, arc_points, curve3, disc, ellipsoid, flat_sweep, superellipsoid, sweep, torus
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
        self.tip.extend(tip if tip is not None else [0.0] * len(vv))

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


def dirv(yaw: float, pitch: float) -> Vector:
    y_, p_ = math.radians(yaw), math.radians(pitch)
    return Vector((math.sin(y_) * math.cos(p_), -math.cos(y_) * math.cos(p_), math.sin(p_)))


def catmull(ctrl, n: int):
    """n + 1 samples of a Catmull-Rom curve through the control tuples (uniform parameter)."""
    out = []
    m = len(ctrl) - 1
    for k in range(n + 1):
        s = k / n * m
        i = min(m - 1, int(s))
        t = s - i
        p0, p1, p2, p3 = ctrl[max(0, i - 1)], ctrl[i], ctrl[i + 1], ctrl[min(m, i + 2)]
        out.append(tuple(0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t ** 3)
                         for a, b, c, d in zip(p0, p1, p2, p3)))
    return out


# ------------------------------------------------------------------------------------------
# The suit
class SuitBody:
    """The torso's elliptic cross-sections in the chest frame (front -Y, left +X): a straight part whose
    half-width is rb(z) up to zs, then a shoulder dome dh high that closes in towards the neck."""

    def __init__(self, rb, sq: float, zs: float, dh: float):
        self.rb, self.sq, self.zs, self.dh = rb, sq, zs, dh
        self.z_top = zs + dh * math.sin(math.radians(60))

    def rx(self, z: float) -> float:
        if z <= self.zs:
            return self.rb(z)
        u = min(1.0, (z - self.zs) / self.dh)
        return self.rb(self.zs) * math.sqrt(max(0.0, 1.0 - u * u))

    def point(self, a: float, z: float, lift: float = 0.0, dr: float = 0.0):
        """Surface point (angle a in degrees: 0 = +X, -90 = front) at height z, the shell `dr` in or out,
        lifted `lift` along the normal. Returns (point, normal)."""
        rx0 = max(1e-4, self.rx(z))
        rx, ry = rx0 + dr, rx0 * self.sq + dr
        ar = math.radians(a)
        e = 1e-3
        d = (self.rx(z + e) - self.rx(z - e)) / (2 * e)
        n = Vector((math.cos(ar) / rx, math.sin(ar) / ry, -d / rx0)).normalized()
        return Vector((math.cos(ar) * rx, math.sin(ar) * ry, z)) + n * lift, n

    def arc_deg(self, a: float, z: float, s: float) -> float:
        """Degrees of angle covering an arc length s around the cross-section at angle a."""
        rx = max(1e-4, self.rx(z))
        ry = rx * self.sq
        ar = math.radians(a)
        return math.degrees(s / max(1e-4, math.hypot(rx * math.sin(ar), ry * math.cos(ar))))


def body_strip(body: SuitBody, zs, a_in, a_out, cols: int = 4, back: float = 0.0, front=0.012, dr: float = 0.0, zfun=None):
    """A slab lying on the body between the angle curves a_in(z) and a_out(z) (degrees) over the heights zs.
    front: lift of the outer face (a number or a function (u, v) -> lift); back: lift of the inner face.
    zfun(u, v) -> z may move each vertex's height (the pointed end of a tie). Faces point outwards."""
    n = len(zs)
    verts, faces = [], []
    for layer in (0, 1):
        for i in range(n):
            u = i / (n - 1)
            for j in range(cols + 1):
                v = j / cols
                z = zfun(u, v) if zfun else zs[i]
                a = a_in(z) + (a_out(z) - a_in(z)) * v
                lift = (front(u, v) if callable(front) else front) if layer == 0 else back
                verts.append(tuple(body.point(a, z, lift, dr)[0]))
    r = cols + 1
    L = n * r
    for i in range(n - 1):
        for j in range(cols):
            a0 = i * r + j
            faces.append((a0, a0 + 1, a0 + 1 + r, a0 + r))
            b0 = L + a0
            faces.append((b0, b0 + r, b0 + 1 + r, b0 + 1))
    for i in range(n - 1):
        for j in (0, cols):
            a0 = i * r + j
            b0 = L + a0
            faces.append((a0, a0 + r, b0 + r, b0) if j == 0 else (a0, b0, b0 + r, a0 + r))
    for i in (0, n - 1):
        for j in range(cols):
            a0 = i * r + j
            b0 = L + a0
            faces.append((a0, b0, b0 + 1, a0 + 1) if i == 0 else (a0, a0 + 1, b0 + 1, b0))
    # outwards: compare a front quad's normal with the direction away from the body axis
    i0, j0 = (n - 1) // 2, cols // 2
    q = [Vector(verts[k]) for k in (i0 * r + j0, i0 * r + j0 + 1, (i0 + 1) * r + j0 + 1)]
    nrm = (q[1] - q[0]).cross(q[2] - q[1])
    out = Vector((q[0].x, q[0].y / body.sq, 0.0))
    if out.length < 1e-6 or nrm.dot(out) < 0.0:
        faces = [tuple(reversed(f)) for f in faces]
    return verts, faces


class SuitHero(Hero):
    """A hero in a two-piece suit. Subclasses set the proportions (class attributes), the colours (SUIT)
    and dress the head (head_parts)."""

    SQ = 0.8           # depth / width of the torso
    ZS = 0.1           # top of the straight part of the torso (chest frame); the shoulder dome sits above
    DH = 0.09          # shoulder dome height
    Z0 = -0.38         # jacket hem
    ZB = -0.2          # jacket button
    V_TOP = 0.1        # half-width of the V opening at the collar
    CUT = 0.08         # half-width of the opening under the button at the hem
    LAPEL = 0.07       # lapel width
    TIE_W = 0.042      # half-width of the tie blade
    TIE_TIP = -0.3     # height of the tie's point
    NECK_R = 0.078
    SLEEVE_R = 0.086
    TROUSER_R = 0.104
    PELVIS = (0.215, 0.18)
    POCKET_Z = -0.29
    PIN_Z = 0.02
    SUIT = dict(suit='#253b68', lapel='#1d2f55', shirt='#f6f5f0', tie='#d3232b', tie_d='#b41c23', shoe='#17171b', sole='#2a2522',
                belt='#1c1a19', buckle='#d8dade', button='#141a2a')

    def rb(self, z: float) -> float:
        t = clamp((z - self.Z0) / (self.ZS - self.Z0))
        return 0.24 + 0.012 * math.sin(math.pi * t) - 0.006 * t

    # --- materials ----------------------------------------------------------------------------
    def suit_mats(self):
        c, mt, k = self.SUIT, self.m, self.key
        return dict(
            suit=mt.cloth(f'{k}_suit', c['suit'], 0.62, 0.38, 0.05, 90),
            lapel=mt.cloth(f'{k}_lapel', c['lapel'], 0.5, 0.45, 0.03, 90),
            shirt=mt.cloth('suit_shirt', c['shirt'], 0.7, 0.3, 0.03, 80),
            tie=mt.cloth(f'{k}_tie', c['tie'], 0.42, 0.5, 0.03, 140),
            tie_d=mt.cloth(f'{k}_tie_d', c['tie_d'], 0.45, 0.45),
            shoe=mt.glossy('suit_shoe', c['shoe'], 0.22, 0.9),
            sole=mt.cloth('suit_sole', c['sole'], 0.6, 0.1),
            belt=mt.glossy('suit_belt', c['belt'], 0.4, 0.3),
            buckle=mt.metal('suit_buckle', c['buckle'], 0.25),
            button=mt.glossy(f'{k}_button', c['button'], 0.3, 0.6),
            pin_w=mt.glossy('pin_white', '#fbfbf7', 0.3, 0.6),
            pin_r=mt.glossy('pin_red', '#d5222c', 0.3, 0.6),
            pin_b=mt.glossy('pin_blue', '#223f94', 0.3, 0.6),
            pin_g=mt.metal('pin_gold', '#e2b24a', 0.3),
        )

    # --- the V opening ----------------------------------------------------------------------------
    def gap(self, z: float) -> float:
        """Half-angle (degrees) of the jacket's front opening at height z: the V down to the button,
        then the fronts curving apart again down to the hem."""
        b = self.body
        if z >= self.ZB:
            xe = self.V_TOP * clamp((z - self.ZB) / (b.z_top - self.ZB)) ** 0.9
        else:
            xe = self.CUT * clamp((self.ZB - z) / (self.ZB - self.Z0)) ** 1.5
        return max(0.8, math.degrees(math.asin(min(0.98, xe / max(1e-4, b.rx(z))))))

    # --- building -------------------------------------------------------------------------------
    def dress_suit(self):
        self.body = SuitBody(self.rb, self.SQ, self.ZS, self.DH)
        self.sm = self.suit_mats()
        self.jacket()
        self.shirt_front()
        self.suit_legs()
        self.suit_arms()

    def jacket(self):
        b, mm = self.body, self.sm
        zs = sorted(set([self.Z0 + (self.ZB - self.Z0) * i / 7 for i in range(8)] + [self.ZB + (self.ZS - self.ZB) * i / 10 for i in range(11)]))
        zs += [self.ZS + self.DH * math.sin(math.radians(60 * i / 9)) for i in range(1, 10)]
        rings = [(z, b.rx(z), b.rx(z) * self.SQ, -90 + self.gap(z), 270 - self.gap(z)) for z in zs]
        self.add('jacket', open_shell(rings, 48, 0.022), mm['suit'], 'chest')
        # lapels along the V, widest over the chest, narrowing a little at the collar notch
        ztop = b.z_top - 0.004
        lz = [self.ZB + 0.004 + (ztop - self.ZB - 0.004) * i / 16 for i in range(17)]

        def lw(z):
            u = clamp((z - self.ZB) / (b.z_top - self.ZB))
            return self.LAPEL * sstep(u / 0.72) * (1.0 - 0.3 * sstep((u - 0.84) / 0.16))
        for sd in (1, -1):
            a_in = (lambda z, sd=sd: -90 + sd * self.gap(z))
            a_out = (lambda z, sd=sd, a_in=a_in: a_in(z) + sd * b.arc_deg(a_in(z), z, lw(z)))
            self.add('lapel', body_strip(b, lz, a_in, a_out, 4, 0.001, lambda u, v: 0.013 + 0.006 * (1 - v)), mm['lapel'], 'chest')
        # collar round the back of the neck, from one lapel to the other
        g = self.gap(b.z_top)
        pts = []
        for i in range(25):
            a = (-90 + g + 3) + (360 - 2 * g - 6) * i / 24
            p, n = b.point(a, b.z_top - 0.008, 0.012)
            pts.append(p + Vector((0.0, 0.0, 0.012)))
        self.add('collar', sweep(pts, 0.024, 10), mm['lapel'], 'chest')
        # the button, and flap pockets over the hips, a welt pocket on the left breast
        p, n = b.point(-90, self.ZB, 0.014)
        self.add('button', disc(0.019, 0.012, 20), mm['button'], 'chest', orient(p, n))
        for sd in (1, -1):
            ac = -90 + sd * 58
            zc = self.POCKET_Z
            hw = 0.055
            self.add('pocket', body_strip(b, [zc - 0.036, zc - 0.018, zc], lambda z, ac=ac: ac - b.arc_deg(ac, z, hw),
                                          lambda z, ac=ac: ac + b.arc_deg(ac, z, hw), 4, 0.004, 0.014), mm['lapel'], 'chest')
        ac, zc = -90 + 50, -0.02
        self.add('welt', body_strip(b, [zc - 0.013, zc], lambda z: ac - b.arc_deg(ac, z, 0.038), lambda z: ac + b.arc_deg(ac, z, 0.038), 3,
                                    0.004, 0.012), mm['lapel'], 'chest')
        # the flag pin on his left lapel
        zp = self.PIN_Z
        a_in = -90 + self.gap(zp)
        u = clamp((zp - self.ZB) / (b.z_top - self.ZB))
        wl = self.LAPEL * sstep(u / 0.72)
        ap = a_in + b.arc_deg(a_in, zp, wl * 0.55)
        p, n = b.point(ap, zp, 0.022)
        pm = orient(p, n)
        self.add('pin', superellipsoid(0.021, 0.004, 0.0145, 5.0, 16, 8), mm['pin_w'], 'chest', pm)
        for k in range(3):
            zz = 0.0098 - k * 0.0098
            self.add('pinstripe', superellipsoid(0.0205, 0.0035, 0.0025, 5.0, 12, 6, center=(0.0, -0.002, zz)), mm['pin_r'], 'chest', pm)
        self.add('pincanton', superellipsoid(0.0092, 0.004, 0.0074, 5.0, 12, 6, center=(-0.0116, -0.0035, 0.0068)), mm['pin_b'], 'chest', pm)

    def shirt_front(self):
        b, mm = self.body, self.sm
        dr = -0.018
        # the shirt ends at the belt just under the button; below it the trousers' waist fills the opening
        zw = self.ZB - 0.045
        rs = lambda t: b.rx(zw + (self.ZS + 0.001 - zw) * t) + dr  # noqa: E731
        self.add('shirt', sweep([Vector((0, 0, zw + (self.ZS + 0.001 - zw) * i / 12)) for i in range(13)], rs, 32, cap0=False, cap1=False,
                                squash=self.SQ), mm['shirt'], 'chest')
        zl = self.Z0 + 0.03
        rw = lambda t: b.rx(zl + (zw + 0.01 - zl) * t) + dr - 0.002  # noqa: E731
        self.add('waist', sweep([Vector((0, 0, zl + (zw + 0.01 - zl) * i / 6)) for i in range(7)], rw, 32, cap0=True, cap1=False, squash=self.SQ),
                 mm['suit'], 'chest')
        rbelt = b.rx(zw) + dr
        self.add('belt', torus(rbelt - 0.004, 0.017, 40, 8, center=(0, 0, zw), squash=1.25), mm['belt'], 'chest', _sy(self.SQ))
        pb, nb = b.point(-90, zw, 0.0, dr + 0.004)
        self.add('buckle', superellipsoid(0.026, 0.008, 0.017, 3.5, 14, 8), mm['buckle'], 'chest', orient(pb, nb))
        r0 = b.rx(self.ZS) + dr
        self.add('shirtdome', ellipsoid(r0, r0 * self.SQ, self.DH + dr, 32, 12, center=(0, 0, self.ZS), zmin=-0.05), mm['shirt'], 'chest')
        # neck
        a0 = self.J('chest') @ Vector((0.0, 0.0, 0.1))
        b0 = self.J('neck') @ Vector((0.0, 0.0, 0.03))
        c0 = self.J('head') @ Vector((0.0, 0.01, 0.12))
        self.add('neck', sweep(curve3(a0, b0, c0, 6), self.NECK_R, 16), self.mat['skin'])
        # shirt collar: a band round the neck, open at the front, and two points either side of the knot
        zc = b.z_top + 0.008
        rc = self.NECK_R + 0.014
        pts = []
        for i in range(21):
            a = math.radians(-68 + (360 - 44) * i / 20)
            pts.append(Vector((math.cos(a) * rc, math.sin(a) * rc * 0.96, zc + 0.018 * math.sin(a))))
        self.add('shirtcollar', sweep(pts, 0.021, 10), mm['shirt'], 'chest')
        for sd in (1, -1):
            p0 = Vector((0.03 * sd, -rc * 0.96, zc - 0.006))
            p1, n1 = b.point(-90 + sd * b.arc_deg(-90, zc - 0.07, 0.074), zc - 0.075, 0.006, dr)
            pts = [p0.lerp(p1, t) + n1 * (0.008 * math.sin(math.pi * t)) for t in (k / 8 for k in range(9))]
            self.add('collarpt', flat_sweep(pts, lambda t: 0.03 * (1 - t) ** 0.9 + 0.005, n1, 0.35, 10), mm['shirt'], 'chest')
        # the tie: knot at the collar, blade down the shirt front to a point
        zk = zc - 0.024
        pk, nk = b.point(-90, zk, 0.012, dr)
        knot = superellipsoid(0.031, 0.022, 0.031, 2.5, 16, 10)
        knot = ([(x * (1.0 + 0.22 * z / 0.031), y, z) for (x, y, z) in knot[0]], knot[1])
        self.add('tieknot', knot, mm['tie_d'], 'chest', T(pk.x, pk.y - 0.004, pk.z) @ R(-12, 0, 0))
        z_top = zk - 0.02
        L = z_top - self.TIE_TIP
        tip_h = 0.042

        def hw(z):
            u = clamp((z_top - z) / L)
            return 0.027 + (self.TIE_W - 0.027) * sstep(u / 0.55)

        def zfun(u, v):
            return z_top - u * (L - tip_h * abs(2 * v - 1))
        tz = [z_top - L * i / 20 for i in range(21)]
        self.add('tie', body_strip(b, tz, lambda z: -90 - b.arc_deg(-90, z, hw(z)), lambda z: -90 + b.arc_deg(-90, z, hw(z)), 6, 0.002,
                                   lambda u, v: 0.011 + 0.004 * math.sin(math.pi * v), dr, zfun), mm['tie'], 'chest')
        # trousers' seat (hips frame)
        px, py = self.PELVIS
        self.add('pelvis', superellipsoid(px, py, 0.15, 2.4, 28, 16, center=(0, 0, -0.04)), mm['suit'], 'hips')

    def suit_legs(self):
        mm = self.sm
        R0 = self.TROUSER_R
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('trouser' + s_, hip, kn, an, lambda t: R0 - 0.014 * t + 0.008 * sstep((t - 0.82) / 0.18), mm['suit'], 0.0, 0.97, 16, 16,
                      cap0=True, cap1=True)
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('shoe' + s_, superellipsoid(0.1, 0.165, 0.07, 2.5, 22, 14, center=(0, -0.058, -0.085)), mm['shoe'], None, fm)
            self.add('toecap' + s_, ellipsoid(0.098, 0.104, 0.064, 18, 10, center=(0, -0.148, -0.094)), mm['shoe'], None, fm)
            self.add('sole' + s_, superellipsoid(0.11, 0.19, 0.022, 3.0, 22, 8, center=(0, -0.066, -0.132)), mm['sole'], None, fm)
            self.add('heel' + s_, superellipsoid(0.088, 0.052, 0.03, 3.0, 16, 8, center=(0, 0.058, -0.128)), mm['sole'], None, fm)

    def suit_arms(self):
        mm = self.sm
        R0 = self.SLEEVE_R
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: R0 - 0.012 * t, mm['suit'], 0.0, 0.88, 16, 14, cap0=True, cap1=True)
            self.limb('cuff' + s_, sh, el, wr, 0.066, mm['shirt'], 0.8, 0.95, 14, 4, cap0=False, cap1=True)
            self.limb('wrist' + s_, sh, el, wr, 0.05, self.mat['skin'], 0.9, 1.0, 12, 4, extend=0.02)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.22):
                self.add('hand' + nm + s_, mesh, self.mat['skin'], None, wm)


def _sy(k: float) -> Matrix:
    return Matrix.Diagonal((1.0, k, 1.0, 1.0))


# ------------------------------------------------------------------------------------------
class Obama(SuitHero):
    """Barack Obama (chibi caricature): cropped greying hair, charcoal suit, white shirt, blue tie, flag pin."""

    key = 'obama'
    ankle_h = 0.15
    hip_h = 0.68  # ankle_h + 0.04 + thigh + shin
    spine = 0.09
    chest = 0.21
    neck = 0.14
    head_up = 0.04
    shoulder = (0.22, 0.0, 0.11)
    upper_arm = 0.225
    forearm = 0.2
    hip_w = 0.1
    thigh = 0.24
    shin = 0.25
    sit_h = 0.18

    # suit proportions: slim, buttoned at the waist, the tie tucked under the button
    SQ = 0.78
    Z0 = -0.4
    ZB = -0.13
    V_TOP = 0.094
    CUT = 0.075
    LAPEL = 0.064
    TIE_W = 0.045
    TIE_TIP = -0.19
    NECK_R = 0.074
    SLEEVE_R = 0.08
    TROUSER_R = 0.094
    PELVIS = (0.198, 0.162)
    POCKET_Z = -0.3
    PIN_Z = 0.03
    SUIT = dict(suit='#414856', lapel='#353b48', shirt='#f6f5f0', tie='#2f6fc6', tie_d='#2459a6', shoe='#17171b', sole='#2a2522',
                belt='#1c1a19', buckle='#d8dade', button='#1a1c22')

    C = dict(skin='#9a6243', skin_d='#7a4830', hair_d='#141211', hair_g='#a3a09c', iris='#3b2415', brow='#211815', lash='#1a1210')
    HEAD = (0.39, 0.37, 0.405, 0.42)  # rx, ry, rz, centre height above the head joint
    TAPER = 0.13  # how much the lower face narrows (Kip: 0.1): a slimmer chin
    LID, LID_TILT = 0.12, -3.0  # a relaxed upper lid on the open eyes
    BROW_ARCH = -0.016

    def rb(self, z: float) -> float:
        t = clamp((z - self.Z0) / (self.ZS - self.Z0))
        return 0.212 + 0.01 * math.sin(math.pi * t) - 0.006 * t

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.1

    def crop_mat(self, name: str):
        """Close-cropped hair: black to grey along the vertex attribute 'tip', a fine salt-and-pepper speckle
        and a short-hair texture."""
        c = self.C

        def make(n):
            m = lib.NT(n)
            t = m.node('ShaderNodeAttribute')
            t.attribute_name = 'tip'
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            speck = m.maprange(m.noise(170.0, 2, 0.5, obj).outputs['Fac'], 0.58, 0.74)
            g = m.math('ADD', t.outputs['Fac'], m.math('MULTIPLY', speck, 0.14), clamp=True)
            colr = m.mix(g, col(c['hair_d']), col(c['hair_g']))
            nrm = m.bump(m.noise(120.0, 3, 0.6, obj).outputs['Fac'], 0.25, 0.01)
            m.bsdf(colr, 0.72, normal=nrm, sheen=0.22, spec=0.22)
            return m.mat
        return self.m.get(name, make)

    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('obama_skin', c['skin']),
            skin_d=mt.skin('obama_skin_d', c['skin_d']),
            hair=self.crop_mat('obama_hair'),
        )
        self.dress_suit()
        self.head_parts()

    # --- head -------------------------------------------------------------------------------------
    def head_parts(self):
        c, mm = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        tp = self.TAPER
        hv = [(x * (1 - tp * max(0.0, (hc - z) / hz) ** 1.6), y - 0.02 * max(0.0, (hc - z) / hz) ** 2, z) for (x, y, z) in hv]
        self.add('head', (hv, hf), mm['skin'], 'head')
        # ears that stand out a little
        for sd in (1, -1):
            em = T((hx - 0.016) * sd, 0.036, hc - 0.046) @ R(0, 0, -27 * sd)
            self.add('ear', ellipsoid(0.07, 0.04, 0.094, 16, 10), mm['skin'], 'head', em)
            self.add('earin', ellipsoid(0.04, 0.02, 0.056, 12, 8), mm['skin_d'], 'head', em @ T(0.0, -0.026, 0.0))
        self.face(head, 'head', eye_yaw=23, eye_pitch=-6, eye_size=(0.086, 0.108), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-31,
                  lid_col=c['skin'], skin=c['skin'], brow_pitch=20, lash_col=c['lash'])
        self.hair()

    def hair(self):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.008, hy + 0.008, hz + 0.008, center=(0, 0.008, hc + 0.008))

        # a neat hairline, a touch higher at the temples, above the ears, tapered at the nape
        def boundary(yaw):
            return periodic_interp([(0, 34), (20, 35), (36, 38), (50, 33), (62, 22), (78, 5), (106, 4), (132, -11), (180, -26)], abs(yaw))

        def thickness(yaw, pitch, f):
            edge = sstep(f / 0.14)
            return 0.008 + (0.008 + 0.012 * math.sin(math.pi * min(1.0, f * 1.1))) * edge

        v, f, _tp = hair_shell(hs, boundary, thickness, 150, 22, inner=-0.012)
        cx, cy, cz = hs.c
        tips = []
        for (x, y, z) in v:
            yaw = abs(math.degrees(math.atan2(x - cx, -(y - cy))))
            pitch = math.degrees(math.atan2(z - cz, math.hypot(x - cx, y - cy)))
            g = sstep((yaw - 48) / 26) * sstep((38 - pitch) / 22) * (1.0 - 0.8 * sstep((yaw - 100) / 30))
            tips.append(0.06 + 0.7 * g)
        self.add('hair', (v, f), mm['hair'], 'head', tip=tips)

    # --- face (a copy of Hero.face with his big friendly smile) -----------------------------------------
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
                    ir = 0.84 * ew * (0.8 if kind == 'wide' else 1.0)
                    off = Vector((lx * ew * 0.22 - 0.1 * ew * side, -ed * 0.9, lz * eh * 0.2 - eh * 0.04))
                    self.feat(f'iris{name}', ellipsoid(ir, ed * 0.22, ir * 1.1, 20, 10, center=off), irm, joint, head, fr)
                    pr = ir * 0.55
                    self.feat(f'pupil{name}', ellipsoid(pr, ed * 0.2, pr * 1.12, 16, 8, center=off + Vector((0.0, -ed * 0.12, 0.0))), dark, joint, head, fr)
                    h1 = off + Vector((-ir * 0.38, -ed * 0.3, ir * 0.42))
                    self.feat(f'shine{name}', ellipsoid(ir * 0.34, 0.004, ir * 0.36, 10, 6, center=h1), shine, joint, head, fr)
                    h2 = off + Vector((ir * 0.4, -ed * 0.3, -ir * 0.4))
                    self.feat(f'shine2{name}', ellipsoid(ir * 0.13, 0.004, ir * 0.13, 8, 5, center=h2), shine, joint, head, fr)
                lash_pts = [Vector((math.sin(a) * ew * 1.02, -ed * 0.55, math.cos(a) * eh * 1.0)) for a in [(-1 + 2 * i / 12) * 1.25 for i in range(13)]]
                self.feat(f'lash{name}', sweep(lash_pts, lambda t: 0.006 + 0.006 * math.sin(math.pi * t), 6), lash, joint, head, fr)
                lid = {'sad': 0.42, 'determined': 0.38, 'half': 0.5, 'open': self.LID}.get(kind)
                if lid and lid_col:
                    lidm = mt.skin(f'lid_{lid_col}', lid_col)
                    tilt = {'sad': -16 * side, 'determined': 14 * side, 'open': self.LID_TILT * side}.get(kind, 0)
                    lid_mesh = ellipsoid(ew * 1.12, ed * 1.25, eh * 1.1, 20, 10, zmin=1 - lid * 2)
                    self.feat(f'lid{name}', lid_mesh, lidm, joint, head, fr @ R(0, tilt, 0) @ T(0, -0.004, 0))
                    if kind == 'open':
                        zc = eh * 1.1 * (1 - lid * 2)
                        w2 = ew * 1.12 * math.sqrt(max(0.0, 1 - (1 - lid * 2) ** 2))
                        lp = [Vector((w2 * (-1 + 2 * i / 10), -ed * 1.3, zc + 0.004)) for i in range(11)]
                        self.feat(f'lidline{name}', sweep(lp, lambda t: 0.006 + 0.004 * math.sin(math.pi * t), 6), lash, joint, head,
                                  fr @ R(0, tilt, 0) @ T(0, -0.004, 0))
            elif kind == 'happy':
                pts = arc_points(ew * 1.7, -eh * 0.42, 12, y=-0.01)
                self.feat(f'happy{name}', sweep([p + Vector((0, 0, -eh * 0.15)) for p in pts], 0.0125, 8), lash, joint, head, fr)
            elif kind == 'closed':
                pts = arc_points(ew * 1.6, eh * 0.22, 12, y=-0.01)
                self.feat(f'closed{name}', sweep(pts, 0.0115, 8), lash, joint, head, fr)
            b_pitch = eye_pitch + brow_pitch + (4 if brows == 'up' else 0) + (2 if eyes == 'wide' else 0)
            roll = {'neutral': 2, 'up': -2, 'worried': 16, 'angry': -18, 'determined': -13, 'sad': 14}.get(brows, 0) * side
            bf = head.frame(yaw * 1.02, b_pitch, 0.004, roll)
            bpts = arc_points(ew * 1.6, self.BROW_ARCH, 8)
            self.feat(f'brow{name}', sweep(bpts, lambda t: 0.014 + 0.008 * math.sin(math.pi * t ** 0.85), 8), browm, joint, head, bf)
        skin_m = mt.skin(f'skin_{skin}', skin) if skin else None
        if nose and skin_m:
            nf = head.frame(0, eye_pitch - 13, -0.004)
            self.feat('nose', ellipsoid(0.037, 0.028, 0.026, 14, 8), skin_m, joint, head, nf)
        if blush:
            bl = mt.alpha('obama_blush', '#d9705c', 0.22)
            for side in (1, -1):
                bf = head.frame(side * (eye_yaw + 13), eye_pitch - 16, 0.003)
                self.feat('blush', ellipsoid(0.046, 0.004, 0.027, 14, 6), bl, joint, head, bf)
        mf = head.frame(0, mouth_pitch, 0.0)
        w = 0.12 * mouth_w
        if mouth in ('smile', 'grin'):
            # his big friendly smile: wide and D-shaped, the corners curling up, the upper teeth showing
            gw, gh = {'smile': (0.19, 0.06), 'grin': (0.205, 0.07)}[mouth]
            curl = gh * 0.45

            def bent(vs, dy=0.0):
                return [(x, y + dy, z + curl * (abs(x) / (gw / 2)) ** 2.2) for (x, y, z) in vs]
            mv, mfc = ellipsoid(gw / 2, 0.014, gh, 30, 12, zmax=0.3)
            self.feat('mouth', (bent(mv), mfc), mouth_m, joint, head, mf @ T(0, 0.002, 0.0))
            tv, tf = ellipsoid(gw / 2 * 0.93, 0.012, gh, 30, 6, zmin=-0.25, zmax=0.28)
            self.feat('teeth', (bent(tv, -0.006), tf), teeth, joint, head, mf @ T(0, 0.002, 0.0))
        elif mouth in ('open', 'laugh'):
            hh = {'open': 0.06, 'laugh': 0.076}[mouth]
            ww = w * 1.05
            self.feat('mouth', ellipsoid(ww / 2, 0.02, hh, 22, 12, zmax=0.15), mouth_m, joint, head, mf @ T(0, 0.002, 0.006))
            self.feat('tongue', ellipsoid(ww * 0.3, 0.012, hh * 0.45, 14, 8, center=(0, -0.008, -hh * 0.6)), tongue, joint, head, mf)
            self.feat('teeth', ellipsoid(ww * 0.42, 0.01, 0.013, 14, 6, center=(0, -0.012, 0.0)), teeth, joint, head, mf)
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
