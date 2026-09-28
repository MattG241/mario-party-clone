"""Sandler: a fan-made, affectionate chibi caricature of Adam Sandler in his famous everyday look, for the private
party build (loaded by characters.py as class `Sandler`).

Built on the shared Hero structure (char_models.py) with Kip's chibi head. Signature details, picked so he
reads at board size (~120 px tall):
  * scruffy, messy medium-length brown hair (locks flicking out every which way over the ears and nape);
  * light stubble on the jaw and upper lip (a speckled tint in the head's skin shader) and a big goofy grin
    as his resting face, under relaxed, slightly droopy eyelids;
  * an oversized loud purple hoodie: dropped shoulders, baggy sleeves, a ribbed hem and cuffs, a kangaroo
    pocket, the hood lying behind his neck and drawstrings that swing with pose['extra'] 'wave' / 'scarf';
  * baggy knee-length yellow basketball shorts with white side stripes, white crew socks pulled up high with
    two stripes, and chunky white sneakers;
  * a relaxed, slightly slouchy posture: his skeleton carries a small forward hunch of the chest (the neck
    and head straighten back up), rounded shoulders and the head sitting a little forward.

The hoodie's lower half is skinned between the chest and the hips and lifted over the thighs wherever a
raised leg would come through it; the hood is pushed back out of the head when he tips his head back.
"""
from __future__ import annotations

import math
import random

from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

import lib
from lib import col
from char_rig import I4, HeadShape, R, Skeleton, T, arc_points, curve3, ellipsoid, flat_sweep, polyline_segment, superellipsoid, sweep, torus
from char_models import DEFAULT_FACE, Hero, hair_shell, hand_mitten, periodic_interp


# ------------------------------------------------------------------------------------------
# Small helpers (local copies so this module only depends on the shared files as they are)
def clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return max(a, min(b, x))


def sstep(x: float) -> float:
    x = clamp(x)
    return x * x * (3.0 - 2.0 * x)


def dirv(yaw: float, pitch: float) -> Vector:
    y, p = math.radians(yaw), math.radians(pitch)
    return Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))


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
        else:
            self.tip.extend([0.0] * len(vv))

    @property
    def mesh(self):
        return self.v, self.f


def flat_tip(n: int, sides: int, nverts: int, t0: float = 0.0, t1: float = 1.0):
    tip = []
    for i in range(n):
        tip += [t0 + (t1 - t0) * i / max(1, n - 1)] * sides
    rest = nverts - n * sides
    tip += [t1] * (rest // 2) + [t0] * (rest - rest // 2)
    return tip


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


def seg_dist(p: Vector, a: Vector, b: Vector) -> float:
    ab = b - a
    t = clamp((p - a).dot(ab) / max(1e-9, ab.dot(ab)))
    return (p - (a + ab * t)).length


def slab(poly, depth: float, levels: int = 2):
    """A thin slab from a simple polygon [(x, z), ...] (counter-clockwise seen from -Y): the front face at
    y = -depth, the back at y = 0, subdivided `levels` times so it can be wrapped onto a curved surface."""
    tris = [tuple(t) for t in tessellate_polygon([[Vector((x, z, 0.0)) for (x, z) in poly]])]
    pts = [Vector((x, z)) for (x, z) in poly]
    fixed = []
    for a, b, c in tris:
        cr = (pts[b] - pts[a]).cross(pts[c] - pts[a])
        fixed.append((a, b, c) if cr > 0 else (a, c, b))
    tris = fixed
    for _ in range(levels):
        mids = {}

        def mid(i, j):
            k = (min(i, j), max(i, j))
            if k not in mids:
                pts.append((pts[i] + pts[j]) * 0.5)
                mids[k] = len(pts) - 1
            return mids[k]
        new = []
        for a, b, c in tris:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            new += [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]
        tris = new
    n = len(pts)
    verts = [(p.x, -depth, p.y) for p in pts] + [(p.x, 0.0, p.y) for p in pts]
    faces = []
    for a, b, c in tris:
        faces.append((a, b, c))
        faces.append((n + a, n + c, n + b))
    count = {}
    for a, b, c in tris:
        for e in ((a, b), (b, c), (c, a)):
            k = (min(e), max(e))
            count[k] = count.get(k, 0) + 1
    for a, b, c in tris:
        for i, j in ((a, b), (b, c), (c, a)):
            if count[(min(i, j), max(i, j))] == 1:
                faces.append((i, n + i, n + j, j))
    return verts, faces


def ring_grid(rings, cap_top=None):
    """Faces for a closed tube through rings of equal length (lists of vertex indices); an optional
    top pole index closes the last ring."""
    faces = []
    for a, b in zip(rings, rings[1:]):
        n = len(a)
        for k in range(n):
            k2 = (k + 1) % n
            faces.append((a[k], a[k2], b[k2], b[k]))
    if cap_top is not None:
        last = rings[-1]
        n = len(last)
        for k in range(n):
            faces.append((last[k], last[(k + 1) % n], cap_top))
    return faces


class SlouchSkeleton(Skeleton):
    """A Skeleton with a resting posture: extra local rotations applied under every pose's own."""

    def __init__(self, joints, rest: dict):
        super().__init__(joints)
        self.rest = rest

    def solve(self, local: dict, root: Matrix = I4, world_override: dict | None = None) -> dict:
        loc = dict(local)
        for k, m in self.rest.items():
            loc[k] = m @ loc.get(k, I4)
        return super().solve(loc, root, world_override)


# ------------------------------------------------------------------------------------------
class Sandler(Hero):
    """Sandler (fan-made chibi): messy brown hair, stubble, goofy grin, purple hoodie, yellow shorts, high socks."""

    key = 'sandler'
    ankle_h = 0.15
    hip_h = 0.66  # ankle_h + 0.04 + thigh + shin
    spine = 0.08
    chest = 0.2
    neck = 0.13
    head_up = 0.04
    shoulder = (0.235, -0.012, 0.095)  # rounded shoulders: a touch forward and down
    upper_arm = 0.215
    forearm = 0.19
    hip_w = 0.11
    thigh = 0.22
    shin = 0.25
    sit_h = 0.17
    REST = dict(chest=(5.5, 0.0, 0.0), neck=(-2.0, 0.0, 0.0), head=(-4.0, 0.0, 0.0))

    C = dict(skin='#f1c29c', skin_d='#dca07a', stubble='#6f5f58', hair_d='#2a1c13', hair_l='#6a4c36', hood='#8a55e6', hood_d='#6d3fc4',
             hood_l='#a57bf0', shorts='#ffc81f', shorts_d='#e6a90c', stripe='#fbfaf5', sock='#fbfaf6', sock_s1='#8a55e6', sock_s2='#ffc81f',
             shoe='#f6f5f2', shoe_d='#d9d6d0', shoe_acc='#8a55e6', sole='#e9e3d8', sole_d='#9b958c', lace='#ffffff', cord='#f4f0fa',
             iris='#5a3a22', brow='#2a1c13', lash='#1e140e', mouth='#6d2a26')

    HEAD = (0.4, 0.375, 0.39, 0.41)  # rx, ry, rz, centre height above the head joint
    EYE = (23.0, -6.0)
    TAPER = 0.06

    def __init__(self, mats):
        super().__init__(mats)
        joints = [(n, self.skel.parent[n], tuple(self.skel.offset[n])) for n in self.skel.order]
        joints = [(n, p, (0.0, -0.022, self.neck) if n == 'neck' else o) for n, p, o in joints]
        self.skel = SlouchSkeleton(joints, {k: R(*v) for k, v in self.REST.items()})

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.14

    # --- materials ----------------------------------------------------------------------------
    def stubble_skin(self, name: str):
        """Head skin with light stubble: a speckled grey-brown tint over the jaw, chin and upper lip (object
        space of the head, so it sticks to the face whatever the pose)."""
        c = self.C
        hx, hy, hz, hc = self.HEAD

        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            X, Y, Z = m.sep(obj)
            ax = m.math('DIVIDE', m.math('ABSOLUTE', X), hx)
            # the upper edge of the beard shadow: just under the nose in the middle, rising to the sideburns
            edge = m.math('ADD', m.math('MULTIPLY', m.math('POWER', ax, 2.2), 0.15), hc - 0.135)
            below = m.maprange(m.math('SUBTRACT', edge, Z), -0.006, 0.03)
            front = m.maprange(Y, 0.14, 0.0)
            mask = m.math('MULTIPLY', below, front)
            speck = m.noise(95.0, 2.0, 0.5, obj).outputs['Fac']
            dots = m.maprange(speck, 0.48, 0.64)
            amt = m.math('MULTIPLY', mask, m.math('ADD', m.math('MULTIPLY', dots, 0.34), 0.2))
            cc = m.mix(amt, col(c['skin']), col(c['stubble']))
            m.bsdf(cc, 0.5, subsurface=0.12, sheen=0.25, spec=0.35)
            return m.mat
        return self.m.get(name, make)

    def rib_mat(self, name: str, color: str, freq: float = 160.0):
        """Ribbed knit (hem band, cuffs, sock tops): fine vertical ribs from object-space angle bands."""
        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            wv = m.node('ShaderNodeTexWave')
            wv.wave_type = 'BANDS'
            wv.bands_direction = 'X'
            wv.inputs['Scale'].default_value = freq
            m.link(obj, wv.inputs['Vector'])
            nrm = m.bump(wv.outputs['Fac'], 0.25, 0.01)
            m.bsdf(col(color), 0.8, normal=nrm, sheen=0.4, spec=0.25)
            return m.mat
        return self.m.get(name, make)

    # --- building -------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('sandler_skin', c['skin']),
            skin_d=mt.skin('sandler_skin_d', c['skin_d']),
            head=self.stubble_skin('sandler_head'),
            hood=mt.cloth('sandler_hood', c['hood'], 0.82, 0.55, 0.06, 70),
            hood_d=mt.cloth('sandler_hood_d', c['hood_d'], 0.85, 0.5, 0.05, 70),
            rib=mt.cloth('sandler_rib', c['hood_d'], 0.85, 0.5, 0.12, 140),
            shorts=mt.cloth('sandler_shorts', c['shorts'], 0.55, 0.45, 0.04, 90),
            shorts_d=mt.cloth('sandler_shorts_d', c['shorts_d'], 0.6, 0.4),
            stripe=mt.cloth('sandler_stripe', c['stripe'], 0.55, 0.3),
            sock=mt.cloth('sandler_sock', c['sock'], 0.85, 0.5, 0.1, 120),
            sock_s1=mt.cloth('sandler_sock_s1', c['sock_s1'], 0.8, 0.4),
            sock_s2=mt.cloth('sandler_sock_s2', c['sock_s2'], 0.8, 0.4),
            shoe=mt.cloth('sandler_shoe', c['shoe'], 0.5, 0.2, 0.05, 50),
            shoe_d=mt.cloth('sandler_shoe_d', c['shoe_d'], 0.55, 0.2),
            shoe_acc=mt.cloth('sandler_shoe_acc', c['shoe_acc'], 0.5, 0.25),
            sole=mt.cloth('sandler_sole', c['sole'], 0.6, 0.1),
            sole_d=mt.cloth('sandler_sole_d', c['sole_d'], 0.6, 0.1),
            lace=mt.cloth('sandler_lace', c['lace'], 0.6, 0.2),
            cord=mt.cloth('sandler_cord', c['cord'], 0.6, 0.3),
            hair=mt.hair('sandler_hair', c['hair_d'], c['hair_l'], 0.5),
            mouth=mt.glossy('mouth', c['mouth'], 0.4, 0.2),
            teeth=mt.glossy('teeth', '#fffdf6', 0.25, 0.4),
            tongue=mt.glossy('tongue', '#e8797b', 0.35, 0.3),
        )
        self.hoodie()
        self.hood()
        self.legs()
        self.arms()
        self.head_parts()

    # --- hoodie (chest frame, the lower half skinned towards the hips) --------------------------------
    Z0, Z1 = -0.39, 0.205
    SQ = 0.82

    def body_r(self, z: float) -> float:
        """Hoodie half-width at chest-frame height z: baggy and boxy, rounding in over the dropped shoulders."""
        if z <= 0.04:
            return 0.25 + 0.014 * sstep((z - self.Z0) / (0.04 - self.Z0))
        return 0.264 * math.sqrt(max(0.0, 1.0 - ((z - 0.04) / 0.178) ** 2))

    def body_pt(self, x: float, z: float, lift: float = 0.0):
        """Point (chest frame) on the hoodie front at arc length x from the centre line, height z; and its normal."""
        rx = max(0.03, self.body_r(z))
        ry = rx * self.SQ
        rho = rx * rx / ry
        phi = -math.pi / 2 + x / rho
        nrm = Vector((math.cos(phi) / rx, math.sin(phi) / ry, 0.0)).normalized()
        return Vector((rx * math.cos(phi), ry * math.sin(phi), z)) + nrm * lift, nrm

    def skin_pt(self, v: Vector) -> Vector:
        """Chest-frame point -> world, blending towards the hips frame low down so the hem follows the pelvis."""
        w = sstep((-0.22 - v.z) / 0.2)
        pc = self.J('chest') @ v
        if w <= 0.0:
            return pc
        ph = self.J('hips') @ (v + Vector((0.0, 0.0, self.spine + self.chest)))
        return pc.lerp(ph, w)

    def lift_over_thighs(self, rings):
        """Lift hem vertices up (the pelvis' up) out of the thighs wherever a raised leg would come through."""
        up = (self.J('hips').to_3x3() @ Vector((0.0, 0.0, 1.0))).normalized()
        caps = []
        for s_ in ('L', 'R'):
            a, b = self.P('hip' + s_), self.P('knee' + s_)
            caps.append((a + (a - b).normalized() * 0.02, b + (b - a).normalized() * 0.06, 0.155))
        nr = len(rings)
        lifts = [[0.0] * len(rings[0]) for _ in range(nr)]
        for j in range(nr):
            for k, p in enumerate(rings[j]):
                t = 0.0
                for _ in range(40):
                    q = p + up * t
                    if all(seg_dist(q, a, b) >= r for a, b, r in caps):
                        break
                    t += 0.01
                lifts[j][k] = t
        # smooth round each ring, then carry lifts upwards so rings never fold under each other
        n = len(rings[0])
        for _ in range(3):
            lifts = [[max(lifts[j][k], 0.25 * lifts[j][(k - 1) % n] + 0.5 * lifts[j][k] + 0.25 * lifts[j][(k + 1) % n]) for k in range(n)]
                     for j in range(nr)]
        for j in range(1, nr):
            for k in range(n):
                lifts[j][k] = max(lifts[j][k], lifts[j - 1][k] * 0.8)
        return [[rings[j][k] + up * lifts[j][k] for k in range(n)] for j in range(nr)]

    def hoodie(self):
        mm = self.mat
        NA = 40
        # the band (ribbed hem) and the body as rings, lower rows skinned and lifted over the thighs
        band_z = [-0.462 + 0.082 * i / 4 for i in range(5)]
        body_z = [self.Z0 + (self.Z1 - self.Z0) * i / 20 for i in range(21)]
        rb0 = self.body_r(self.Z0) - 0.006

        def ring(z, r_fn):
            out = []
            for k in range(NA):
                a = k / NA * math.tau
                r = r_fn(z)
                out.append(Vector((math.cos(a) * r, math.sin(a) * r * self.SQ, z)))
            return out
        band_local = [ring(z, lambda z: rb0 + 0.012 * math.sin(math.pi * (z + 0.462) / 0.082)) for z in band_z]
        body_local = [ring(z, self.body_r) for z in body_z]
        low = band_local + body_local[:8]
        low_w = self.lift_over_thighs([[self.skin_pt(v) for v in rg] for rg in low])
        band_w = low_w[:5]
        body_w = low_w[5:] + [[self.skin_pt(v) for v in rg] for rg in body_local[8:]]
        # body mesh with a pole at the top
        verts, rings = [], []
        for rg in body_w:
            rings.append(list(range(len(verts), len(verts) + NA)))
            verts.extend(tuple(p) for p in rg)
        top = self.J('chest') @ Vector((0.0, 0.0, self.Z1 + 0.01))
        verts.append(tuple(top))
        faces = ring_grid(rings, len(verts) - 1)
        self.add('hoodie', (verts, faces), mm['hood'], None)
        verts, rings = [], []
        for rg in band_w:
            rings.append(list(range(len(verts), len(verts) + NA)))
            verts.extend(tuple(p) for p in rg)
        faces = ring_grid(rings)
        # close the band's bottom with an inner lip so the opening doesn't show the inside as a hole
        inner = [tuple(p.lerp(band_w[0][(k + NA // 2) % NA], 0.12)) for k, p in enumerate(band_w[0])]
        b0 = len(verts)
        verts.extend(inner)
        for k in range(NA):
            k2 = (k + 1) % NA
            faces.append((rings[0][k2], rings[0][k], b0 + k, b0 + k2))
        self.add('hem', (verts, faces), mm['rib'], None)
        # dropped shoulders
        self.add('shoulders', ellipsoid(0.232, 0.19, 0.095, 28, 12, center=(0, 0, 0.1), zmin=-0.25), mm['hood'], 'chest')
        # kangaroo pocket: a darker patch on the belly with slanted side openings
        Cm = self.J('chest')
        poly = [(-0.12, -0.3), (0.12, -0.3), (0.13, -0.24), (0.085, -0.15), (-0.085, -0.15), (-0.13, -0.24)]
        pv, pf = slab(poly, 0.008, 3)
        pv = [self.body_pt(x, z, 0.002 - y)[0] for (x, y, z) in pv]
        self.add('pocket', ([tuple(self.skin_pt(v)) for v in pv], pf), mm['hood_d'], None)
        for sd in (1, -1):
            pts = [self.body_pt(sd * (0.13 - 0.045 * u), -0.24 + 0.09 * u, 0.011)[0] for u in (0.0, 0.33, 0.66, 1.0)]
            self.add('pocketedge', sweep([self.skin_pt(p) for p in pts], 0.0065, 6), mm['rib'], None)
        top_pts = [self.body_pt(x, -0.15, 0.011)[0] for x in (-0.085, -0.03, 0.03, 0.085)]
        self.add('pockettop', sweep([self.skin_pt(p) for p in top_pts], 0.006, 6), mm['rib'], None)
        # shorts seat (hips frame), mostly under the hoodie
        self.add('pelvis', superellipsoid(0.19, 0.148, 0.13, 2.4, 28, 16, center=(0, 0, -0.075)), mm['shorts'], 'hips')
        # neck
        a0 = self.J('chest') @ Vector((0.0, 0.0, 0.1))
        b0 = self.J('neck') @ Vector((0.0, 0.0, 0.03))
        c0 = self.J('head') @ Vector((0.0, 0.01, 0.12))
        self.add('neck', sweep(curve3(a0, b0, c0, 6), 0.074, 14), mm['skin'])

    # --- hood & drawstrings ---------------------------------------------------------------------------
    def head_push(self, pts, back: Vector):
        """Push world points out of the head (and hair) along `back`."""
        hx, hy, hz, hc = self.HEAD
        Mi = self.J('head').inverted()
        rr = Vector((hx + 0.06, hy + 0.07, hz + 0.05))
        dv = Mi.to_3x3() @ back
        dv = Vector((dv.x / rr.x, dv.y / rr.y, dv.z / rr.z))
        out = []
        for p in pts:
            o = Mi @ p - Vector((0.0, 0.01, hc))
            o = Vector((o.x / rr.x, o.y / rr.y, o.z / rr.z))
            a_ = dv.dot(dv)
            b_ = o.dot(dv)
            c_ = o.dot(o) - 1.0
            disc = b_ * b_ - a_ * c_
            t = 0.0
            if c_ < 0.0 and disc > 0.0:
                t = (-b_ + math.sqrt(disc)) / a_ + 0.005
            out.append(p + back * t)
        return out

    def hood(self):
        mm = self.mat
        Cm = self.J('chest')
        rot = Cm.to_3x3()
        back = (rot @ Vector((0.0, 0.9, -0.45))).normalized()
        # the rolled rim of the hood round the back of the neck, fat at the back and thin at the front
        pts, rad = [], []
        for i in range(25):
            u = i / 24
            a = math.radians(-58 + (236 + 58) * u)
            bk = max(0.0, math.sin(a))
            pts.append(Vector((math.cos(a) * (0.17 + 0.02 * bk), math.sin(a) * (0.15 + 0.03 * bk) + 0.03, 0.155 + 0.03 * bk)))
            rad.append(0.034 + 0.03 * bk ** 0.7)
        world = self.head_push([Cm @ p for p in pts], back)
        self.add('hoodrim', sweep(world, lambda t: rad[min(24, int(round(t * 24)))], 16), mm['hood_d'], None)
        # the hood itself lying on the upper back
        hv, hf = ellipsoid(0.175, 0.075, 0.15, 24, 14)
        hm = T(0.0, 0.2, 0.05) @ R(-14, 0, 0)
        hvw = self.head_push([Cm @ hm @ Vector(v) for v in hv], back)
        self.add('hoodback', ([tuple(v) for v in hvw], hf), mm['hood'], None)
        # drawstrings from the neckline, hanging down the chest; they swing with the pose
        ex = self.pose.get('extra', {})
        fly = clamp(ex.get('scarf', 0.0))
        wave = ex.get('wave', 0.0)
        sway = ex.get('sway', 0.0)
        for k, sd in enumerate((1, -1)):
            ln = 0.2 if sd > 0 else 0.18
            sp = []
            for i in range(10):
                t = i / 9
                x = sd * 0.05 + 0.02 * sway * t + 0.018 * math.sin(wave + t * 3.0 + k * 1.3) * t - sd * 0.04 * fly * t
                z = 0.13 - ln * t * (1.0 - 0.35 * fly)
                p, n = self.body_pt(x, z, 0.012 + 0.07 * fly * t * t)
                sp.append(Cm @ p)
            self.add(f'cord{k}', sweep(sp, 0.0085, 8), mm['cord'], None)
            tip = sp[-1] + (sp[-1] - sp[-2]).normalized() * 0.025
            self.add(f'aglet{k}', sweep([sp[-1], tip], 0.011, 8), mm['hood_d'], None)
            self.add(f'eyelet{k}', torus(0.014, 0.005, 12, 6), mm['cord'], None, Cm @ orient(*self.body_pt(sd * 0.05, 0.135, 0.004)) @ R(90, 0, 0))

    # --- legs: baggy basketball shorts, high socks, chunky sneakers --------------------------------------
    @staticmethod
    def shorts_r(t: float) -> float:
        return 0.134 + 0.02 * sstep(t / 0.4)

    SHORTS_END = 0.53

    def legs(self):
        mm = self.mat
        se = self.SHORTS_END
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('shorts' + s_, hip, kn, an, self.shorts_r, mm['shorts'], 0.0, se, 20, 12, cap0=True, cap1=False)
            self.limb('shortsin' + s_, hip, kn, an, lambda t: self.shorts_r(t) - 0.012, mm['shorts_d'], se - 0.1, se, 20, 3, cap0=False,
                      cap1=False)
            self.limb('shortshem' + s_, hip, kn, an, lambda t: self.shorts_r(t) + 0.003, mm['shorts_d'], se - 0.035, se, 20, 2, cap0=False,
                      cap1=False)
            # white stripes down the outer seam
            for q in (1, -1):
                pts = self.seam_pts(hip, kn, an, 0.04, se - 0.04, sd, 9 * q, 0.004)
                self.add(f'stripe{q}{s_}', sweep(pts, 0.0105, 6, squash=0.5), mm['stripe'], None)
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.066 - 0.01 * t + 0.008 * math.sin(math.pi * clamp((t - 0.45) / 0.4)), mm['skin'],
                      se - 0.08, 0.95, 12, 10)
            # crew socks pulled up high, two stripes round the top
            self.limb('sock' + s_, hip, kn, an, lambda t: 0.077 - 0.008 * t, mm['sock'], 0.6, 1.0, 14, 10, cap0=False, cap1=False)
            self.limb('socktop' + s_, hip, kn, an, 0.08, mm['sock'], 0.585, 0.61, 14, 2, cap0=True, cap1=False)
            self.limb('sockst1' + s_, hip, kn, an, 0.0785, mm['sock_s1'], 0.63, 0.655, 14, 2, cap0=False, cap1=False)
            self.limb('sockst2' + s_, hip, kn, an, 0.078, mm['sock_s2'], 0.675, 0.7, 14, 2, cap0=False, cap1=False)
            # chunky sneakers
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('shoe' + s_, superellipsoid(0.128, 0.185, 0.1, 2.5, 24, 14, center=(0, -0.055, -0.045)), mm['shoe'], None, fm)
            self.add('toecap' + s_, ellipsoid(0.12, 0.105, 0.072, 18, 10, center=(0, -0.16, -0.078)), mm['shoe_d'], None, fm)
            self.add('sole' + s_, superellipsoid(0.142, 0.214, 0.042, 3.0, 24, 8, center=(0, -0.066, -0.118)), mm['sole'], None, fm)
            self.add('soleb' + s_, superellipsoid(0.144, 0.216, 0.014, 3.2, 24, 6, center=(0, -0.066, -0.152)), mm['sole_d'], None, fm)
            self.add('collar' + s_, torus(0.086, 0.03, 22, 8, center=(0, 0.005, 0.045)), mm['shoe_d'], None, fm)
            self.add('heeltab' + s_, superellipsoid(0.05, 0.03, 0.05, 2.6, 12, 8, center=(0, 0.13, 0.0)), mm['shoe_acc'], None, fm)
            # a curved accent panel on each side of the shoe
            self.add('band' + s_, superellipsoid(0.134, 0.196, 0.022, 3.0, 24, 6, center=(0, -0.06, -0.068)), mm['shoe_acc'], None, fm)
            for k in range(3):
                y = -0.1 - k * 0.035
                zz = 0.02 - k * 0.022
                self.add(f'lace{k}{s_}', sweep([Vector((-0.05, y, zz)), Vector((0.0, y - 0.012, zz + 0.012)), Vector((0.05, y, zz))], 0.0095, 6),
                         mm['lace'], None, fm)

    def seam_pts(self, a, b, c, t0, t1, sd, dang, lift, n=10):
        """Points down the outer seam of a leg (dang: degrees round from the seam), `lift` off the shorts."""
        out = []
        for i in range(n + 1):
            t = t0 + (t1 - t0) * i / n
            pts = curve3(self.P(a), self.P(b), self.P(c), 24)
            seg = polyline_segment(pts, max(0.0, t - 0.02), min(1.0, t + 0.02), 2)
            tg = (seg[-1] - seg[0]).normalized()
            J = self.J(b if t > 0.49 else a)
            o = J.to_3x3() @ Vector((-sd, 0.0, 0.0))
            o = (o - tg * o.dot(tg)).normalized()
            f = tg.cross(o).normalized()
            ang = math.radians(dang)
            nrm = (o * math.cos(ang) + f * math.sin(ang) * sd).normalized()
            out.append(seg[1] + nrm * (self.shorts_r(t) + lift))
        return out

    # --- arms: baggy sleeves with ribbed cuffs --------------------------------------------------------
    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.1 - 0.008 * t + 0.008 * math.sin(math.pi * t), mm['hood'], 0.0, 0.9, 16, 14,
                      cap0=True, cap1=False)
            self.limb('cuff' + s_, sh, el, wr, lambda t: 0.078 + 0.004 * math.sin(math.pi * clamp((t - 0.86) / 0.13)), mm['rib'], 0.86, 0.99,
                      16, 4, cap0=True, cap1=False)
            self.limb('wrist' + s_, sh, el, wr, 0.052, mm['skin'], 0.9, 1.0, 12, 3, extend=0.02)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.24):
                self.add('hand' + nm + s_, mesh, mm['skin'], None, wm)

    # --- head -------------------------------------------------------------------------------------
    def taper(self, verts):
        hx, hy, hz, hc = self.HEAD
        out = []
        for (x, y, z) in verts:
            f = max(0.0, (hc - z) / hz)
            out.append((x * (1 - self.TAPER * f ** 1.6), y - 0.02 * f * f, z))
        return out

    def head_parts(self):
        c, mm = self.C, self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        self.add('head', (self.taper(hv), hf), mm['head'], 'head')
        for sd in (1, -1):
            self.add('ear', ellipsoid(0.066, 0.042, 0.088, 16, 10), mm['skin'], 'head', T((hx - 0.01) * sd, 0.03, hc - 0.05) @ R(0, 0, -14 * sd))
            self.add('earin', ellipsoid(0.036, 0.02, 0.05, 12, 8), mm['skin_d'], 'head', T((hx - 0.004) * sd, 0.0, hc - 0.05) @ R(0, 0, -14 * sd))
        ey, ep = self.EYE
        self.face(head, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(0.088, 0.108), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-30,
                  lid_col=c['skin'], skin=c['skin'], brow_pitch=22, blush=False, lash_col=c['lash'])
        self.hair()

    # --- hair: scruffy and messy ---------------------------------------------------------------------
    FRINGE = [(-58, 18), (-45, 26), (-31, 13), (-17, 22), (-4, 11), (9, 20), (22, 12), (35, 23), (48, 14), (60, 22)]
    NAPE = [(112, -12), (126, -30), (140, -16), (154, -34), (168, -20), (180, -32)]

    def hair_boundary(self, yaw: float) -> float:
        a = abs(yaw)

        def pointed(lst, high, width, y):
            best = high
            for ty, low in lst:
                d = abs(y - ty)
                best = min(best, low + (high - low) * min(1.0, d / width) ** 0.7)
            return best
        if a <= 64:
            return pointed(self.FRINGE, 36.0, 8.0, yaw)
        side = periodic_interp([(64, 22), (70, 8), (78, -8), (84, -14), (90, 6), (100, 2), (110, -4)], min(a, 110))
        if a <= 110:
            return side
        mirror = self.NAPE + [(-ty, lo) for ty, lo in self.NAPE]
        return min(pointed(mirror, 0.0, 8.0, yaw), -4.0 + 4.0 * (1 - sstep((a - 110) / 10)))

    def hair_thick(self, yaw: float, pitch: float, f: float) -> float:
        d = dirv(yaw, pitch)
        edge = min(1.0, f / 0.18)
        messy = math.sin(7.3 * d.x + 1.3) * math.sin(6.1 * d.y + 0.7) * math.sin(8.2 * d.z + 2.1)
        crown = 0.03 + 0.055 * math.sin(math.pi * min(1.0, f * 1.1))
        ridge = 0.5 + 0.5 * math.cos(math.radians(yaw) * 13 + 0.3 + 2.0 * messy)
        return (0.014 + (crown + 0.02 * ridge + 0.02 * messy) * edge) * (1.1 if abs(yaw) > 100 else 1.0)

    def hair(self):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))
        v, f, tp = hair_shell(hs, self.hair_boundary, self.hair_thick, 160, 24)
        self.add('hair', (self.taper(v), f), mm['hair'], 'head', tip=tp)
        # messy locks sticking out every which way (fixed seed: identical in every frame)
        rng = random.Random(7)
        acc = MeshAcc()
        hs2 = HeadShape(hx + 0.07, hy + 0.07, hz + 0.075, center=(0, 0.01, hc + 0.015))

        def lock(yaw, pitch, length, r0, flow, flick, flat=0.5, sink=-0.035):
            pos, n = hs2.point(yaw, pitch, sink)
            fl = Vector(flow).normalized()
            fl = (fl - n * fl.dot(n)).normalized()
            pts = [pos + fl * (length * t) + n * (length * flick * t * t) for t in [k / 9 for k in range(10)]]
            pts = [Vector(q) for q in self.taper([tuple(q) for q in pts])]
            mesh = flat_sweep(pts, lambda t: r0 * (1 - 0.8 * t ** 1.1) + 0.004, n, flat, 12)
            acc.add(mesh, flat_tip(10, 12, len(mesh[0]), 0.15, 1.0))

        # bed-head tufts on top
        for (yaw, pitch, flow, ln, r0, fk) in ((4, 74, (0.25, -0.5, 0.8), 0.13, 0.085, 0.4), (-28, 70, (-0.6, -0.2, 0.7), 0.12, 0.08, 0.35),
                                               (30, 72, (0.7, 0.1, 0.6), 0.12, 0.08, 0.35), (-8, 58, (-0.2, -1.0, 0.3), 0.12, 0.08, 0.25),
                                               (170, 68, (0.2, 1.0, 0.5), 0.15, 0.085, 0.5), (130, 62, (0.6, 0.7, 0.4), 0.14, 0.08, 0.5),
                                               (-128, 64, (-0.6, 0.7, 0.4), 0.14, 0.08, 0.5)):
            lock(yaw + rng.uniform(-4, 4), pitch, ln, r0, flow, fk)
        # fringe locks falling unevenly onto the forehead
        for (yaw, pitch, flow, ln, r0, fk) in ((-36, 52, (-0.35, -0.6, -0.7), 0.15, 0.07, -0.25), (-12, 56, (0.1, -0.6, -0.8), 0.16, 0.075, -0.3),
                                               (16, 55, (0.35, -0.6, -0.7), 0.15, 0.07, -0.25), (42, 50, (0.6, -0.5, -0.6), 0.14, 0.065, -0.2)):
            lock(yaw, pitch, ln, r0, flow, fk, 0.42, -0.045)
        # over the ears and at the nape, flicking out
        for sd in (1, -1):
            for (yaw, pitch, flow, ln, r0, fk) in ((74, 26, (0.4, 0.2, -1.0), 0.17, 0.075, 0.55), (96, 18, (0.3, 0.5, -1.0), 0.18, 0.08, 0.7),
                                                   (118, 10, (0.3, 0.8, -0.9), 0.17, 0.08, 0.75), (140, 0, (0.3, 0.9, -0.7), 0.15, 0.075, 0.8),
                                                   (160, -8, (0.2, 1.0, -0.6), 0.13, 0.07, 0.8)):
                lock(sd * (yaw + rng.uniform(-3, 3)), pitch + rng.uniform(-3, 3), ln * rng.uniform(0.9, 1.1), r0,
                     (flow[0] * sd, flow[1], flow[2]), fk)
        lock(180, -10, 0.13, 0.075, (0.0, 1.0, -0.7), 0.8)
        self.add('locks', acc.mesh, mm['hair'], 'head', tip=acc.tip)

    # --- face (a copy of Hero.face with droopy lids and a big goofy grin) --------------------------------
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
        mouth_m = self.mat['mouth']
        tongue = self.mat['tongue']
        teeth = self.mat['teeth']
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
                    off = Vector((lx * ew * 0.22 - 0.1 * ew * side, -ed * 0.9, lz * eh * 0.2 - eh * 0.08))
                    self.feat(f'iris{name}', ellipsoid(ir, ed * 0.22, ir * 1.1, 20, 10, center=off), irm, joint, head, fr)
                    pr = ir * 0.58
                    self.feat(f'pupil{name}', ellipsoid(pr, ed * 0.2, pr * 1.12, 16, 8, center=off + Vector((0.0, -ed * 0.12, 0.0))), dark, joint, head, fr)
                    h1 = off + Vector((-ir * 0.38, -ed * 0.3, ir * 0.42))
                    self.feat(f'shine{name}', ellipsoid(ir * 0.34, 0.004, ir * 0.36, 10, 6, center=h1), shine, joint, head, fr)
                    h2 = off + Vector((ir * 0.4, -ed * 0.3, -ir * 0.4))
                    self.feat(f'shine2{name}', ellipsoid(ir * 0.13, 0.004, ir * 0.13, 8, 5, center=h2), shine, joint, head, fr)
                lash_pts = [Vector((math.sin(a) * ew * 1.02, -ed * 0.55, math.cos(a) * eh * 1.0)) for a in [(-1 + 2 * i / 12) * 1.25 for i in range(13)]]
                self.feat(f'lash{name}', sweep(lash_pts, lambda t: 0.007 + 0.006 * math.sin(math.pi * t), 6), lash, joint, head, fr)
                # relaxed, slightly droopy upper lids
                lid = {'sad': 0.44, 'determined': 0.4, 'half': 0.5, 'open': 0.24}.get(kind)
                if lid and lid_col:
                    lidm = mt.skin(f'lid_{lid_col}', lid_col)
                    tilt = {'sad': -16 * side, 'determined': 14 * side, 'open': 2 * side}.get(kind, 0)
                    lid_mesh = ellipsoid(ew * 1.12, ed * 1.25, eh * 1.1, 20, 10, zmin=1 - lid * 2)
                    self.feat(f'lid{name}', lid_mesh, lidm, joint, head, fr @ R(0, tilt, 0) @ T(0, -0.004, 0))
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
            # a friendly, slightly raised-in-the-middle brow at rest
            roll = {'neutral': 10, 'up': 5, 'worried': 17, 'angry': -16, 'determined': -10, 'sad': 16}.get(brows, 0) * side
            bf = head.frame(yaw * 1.02, b_pitch, 0.004, roll)
            bpts = arc_points(ew * 1.6, -0.016, 8)
            self.feat(f'brow{name}', sweep(bpts, lambda t: 0.016 + 0.009 * math.sin(math.pi * t ** 0.9), 8), browm, joint, head, bf)
        skin_m = mt.skin(f'skin_{skin}', skin) if skin else None
        if nose and skin_m:
            nf = head.frame(0, eye_pitch - 15, -0.006)
            self.feat('nose', ellipsoid(0.037, 0.033, 0.031, 16, 10), skin_m, joint, head, nf)
        mf = head.frame(0, mouth_pitch, 0.0)
        w = 0.12 * mouth_w
        if mouth in ('smile', 'grin', 'laugh'):
            # the big goofy grin: wide, the corners curling up, a full row of upper teeth
            gw, gh = {'smile': (0.23, 0.092), 'grin': (0.24, 0.1), 'laugh': (0.22, 0.112)}[mouth]
            curl = gh * 0.42

            def bent(vs, dy=0.0):
                return [(x, y + dy, z + curl * (abs(x) / (gw / 2)) ** 2.2) for (x, y, z) in vs]
            mv, mfc = ellipsoid(gw / 2, 0.015, gh, 30, 14, zmax=0.3)
            self.feat('mouth', (bent(mv), mfc), mouth_m, joint, head, mf @ T(0, 0.002, 0.0))
            tv, tfc = ellipsoid(gw / 2 * 0.92, 0.012, gh, 30, 6, zmin=-0.1, zmax=0.28)
            self.feat('teeth', (bent(tv, -0.006), tfc), teeth, joint, head, mf @ T(0, 0.002, 0.0))
            self.feat('tongue', ellipsoid(gw * 0.22, 0.01, gh * 0.3, 14, 8, center=(0, -0.008, -gh * 0.66)), tongue, joint, head, mf)
        elif mouth == 'open':
            hh = 0.06
            self.feat('mouth', ellipsoid(w * 0.5, 0.02, hh, 22, 12, zmax=0.15), mouth_m, joint, head, mf @ T(0, 0.002, 0.006))
            self.feat('tongue', ellipsoid(w * 0.28, 0.012, hh * 0.45, 14, 8, center=(0, -0.008, -hh * 0.6)), tongue, joint, head, mf)
            self.feat('teeth', ellipsoid(w * 0.4, 0.01, 0.013, 14, 6, center=(0, -0.012, 0.0)), teeth, joint, head, mf)
        elif mouth == 'o':
            self.feat('mouth', ellipsoid(0.03, 0.018, 0.036, 16, 10), mouth_m, joint, head, mf @ T(0, 0.004, -0.004))
        elif mouth == 'gasp':
            self.feat('mouth', ellipsoid(0.042, 0.02, 0.058, 16, 10), mouth_m, joint, head, mf @ T(0, 0.004, -0.012))
            self.feat('tongue', ellipsoid(0.02, 0.01, 0.018, 12, 6, center=(0, -0.012, -0.045)), tongue, joint, head, mf)
        elif mouth == 'frown':
            self.feat('mouth', sweep(arc_points(w * 0.85, -0.024, 12, y=-0.006), 0.0095, 8), mouth_m, joint, head, mf @ T(0, 0, -0.012))
        elif mouth == 'flat':
            self.feat('mouth', sweep([Vector((-w * 0.34, -0.006, 0)), Vector((w * 0.34, -0.006, 0))], 0.0095, 8), mouth_m, joint, head, mf)
        elif mouth == 'wobble':
            pts = [Vector(((i / 12 - 0.5) * w * 0.95, -0.006, math.sin(i / 12 * math.tau * 1.5) * 0.013)) for i in range(13)]
            self.feat('mouth', sweep(pts, 0.0095, 8), mouth_m, joint, head, mf)
        elif mouth == 'smirk':
            pts = [Vector(((i / 12 - 0.5) * w * 0.8, -0.006, 0.02 * (i / 12) ** 2)) for i in range(13)]
            self.feat('mouth', sweep(pts, 0.009, 8), mouth_m, joint, head, mf)
