"""Batman: a fan-made chibi version for the private party game, built on the shared Hero structure (see char_models.py).

Dark charcoal-grey bodysuit, black cowl with tall pointed bat ears (skin shows at the mouth and chin), white
comic-style lens eyes that change shape with the expression, the chest emblem (black bat in a yellow oval), a
yellow utility belt with pouches and buckle, black trunks, black gloves with three fins on each forearm, black
boots, and a long black cape with a scalloped hem.

The cape hangs from the back of the shoulders under gravity and flutters with pose['extra']['scarf'] (0 hangs,
1 streams out behind) and 'wave' (ripples), the way Kip's scarf does. Each pose it is built as a cloth grid in
the chest frame, bent towards the world's "down", then pushed out behind the body along the chest's back
direction wherever a torso, pelvis, head, arm or leg proxy would poke through it, and laid on the ground
instead of sinking into it.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

import lib
from lib import col
from char_rig import HeadShape, R, S, T, arc_points, curve3, ellipsoid, flat_sweep, superellipsoid, sweep, torus
from char_models import DEFAULT_FACE, Hero, hair_shell, hand_mitten, periodic_interp


# ------------------------------------------------------------------------------------------
# Small helpers
def clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return max(a, min(b, x))


def sstep(x: float) -> float:
    x = clamp(x)
    return x * x * (3.0 - 2.0 * x)


def lerp(a, b, t):
    return a + (b - a) * t


def strip_shape(top, bot, rows: int = 4, depth: float = 0.012, bulge: float = 0.004, back: float = 0.008):
    """A flat feature between two curves: `top` and `bot` are lists of (x, z) running from -x to +x (same length,
    top above bot). The front face (towards -Y) sits `depth` above the surface with a soft bulge; the back face is
    sunk `back` below it. Returns (verts, faces) with outward normals."""
    n = len(top)
    verts, faces = [], []
    for layer in (0, 1):
        for i in range(n):
            (xt, zt), (xb, zb) = top[i], bot[i]
            for j in range(rows + 1):
                f = j / rows
                x = xb + (xt - xb) * f
                z = zb + (zt - zb) * f
                if layer == 0:
                    y = -depth - bulge * math.sin(math.pi * f) * math.sin(math.pi * i / max(1, n - 1))
                else:
                    y = back
                verts.append((x, y, z))
    r1 = rows + 1
    base = n * r1
    for i in range(n - 1):
        for j in range(rows):
            a = i * r1 + j
            faces.append((a, a + r1, a + r1 + 1, a + 1))
            b = base + a
            faces.append((b, b + 1, b + r1 + 1, b + r1))
    for i in range(n - 1):
        for j in (0, rows):
            a = i * r1 + j
            b = base + a
            faces.append((a, b, b + r1, a + r1) if j == 0 else (a, a + r1, b + r1, b))
    for i in (0, n - 1):
        for j in range(rows):
            a = i * r1 + j
            b = base + a
            faces.append((a, a + 1, b + 1, b) if i == 0 else (a, b, b + 1, a + 1))
    return verts, faces


def mirror_x(mesh):
    verts, faces = mesh
    return [(-x, y, z) for (x, y, z) in verts], [tuple(reversed(f)) for f in faces]


def slab(poly, depth: float, levels: int = 2):
    """A thin slab from a simple polygon [(x, z), ...] (counter-clockwise seen from -Y): the front face at
    y = -depth, the back at y = 0. The triangulation is subdivided `levels` times so it can be wrapped onto a
    curved surface."""
    tris = [tuple(t) for t in tessellate_polygon([[Vector((x, z, 0.0)) for (x, z) in poly]])]
    pts = [Vector((x, z)) for (x, z) in poly]
    # make every triangle counter-clockwise in (x, z)
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
        # counter-clockwise in (x right, z up) seen from -Y faces -Y
        faces.append((a, b, c))
        faces.append((n + a, n + c, n + b))
    # walls along the boundary edges (edges used by one triangle only)
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


class MeshAcc:
    """Accumulates several meshes into one part."""

    def __init__(self):
        self.v, self.f = [], []

    def add(self, mesh):
        vv, ff = mesh
        b0 = len(self.v)
        self.v.extend(vv)
        self.f.extend(tuple(q + b0 for q in face) for face in ff)

    @property
    def mesh(self):
        return self.v, self.f


def placed(m: Matrix, mesh):
    return [tuple(m @ Vector(v)) for v in mesh[0]], mesh[1]


def bat_poly():
    """The classic bat silhouette (in units where the emblem oval's half-width is 1), counter-clockwise."""
    right = [(0.0, 0.1), (0.045, 0.13), (0.075, 0.34), (0.115, 0.16), (0.2, 0.15), (0.34, 0.24), (0.52, 0.32), (0.72, 0.37), (0.9, 0.35)]
    cusps = [(0.9, 0.35), (0.74, 0.02), (0.52, -0.12), (0.3, -0.16)]
    edge = []
    for (x0, z0), (x1, z1) in zip(cusps, cusps[1:]):
        dx, dz = x1 - x0, z1 - z0
        ln = math.hypot(dx, dz)
        nx, nz = -dz / ln, dx / ln
        if nz < 0:
            nx, nz = -nx, -nz
        for k in range(1, 8):
            t = k / 8
            b = math.sin(math.pi * t) * 0.32 * ln
            edge.append((x0 + dx * t + nx * b, z0 + dz * t + nz * b))
        edge.append((x1, z1))
    body = [(0.2, -0.2), (0.13, -0.3), (0.0, -0.44)]
    right = right + edge + body
    left = [(-x, z) for (x, z) in reversed(right[1:-1])]
    poly = right + left  # clockwise in (x, z): reverse it
    return list(reversed(poly))


def bat_lens(kind: str):
    """Batman's white lens (the character's left eye; x runs from the inner corner -1 to the outer corner +1):
    a straight brow edge slanting up outwards over a curved lower edge. Returns (top, bot)."""
    n = 22
    top, bot = [], []
    if kind in ('wide', 'dizzy'):
        for i in range(n):
            x = -math.cos(math.pi * i / (n - 1))
            e = max(0.0, 1 - x * x) ** 0.5
            top.append((x * 1.08, 0.06 + 0.56 * e + 0.06 * x * e))
            bot.append((x * 1.08, 0.06 - 0.5 * e))
        return top, bot
    c0, c1, depth, bow = {
        'open': (0.2, 0.3, 0.62, 0.0), 'determined': (0.12, 0.4, 0.5, 0.0), 'sad': (0.2, -0.3, 0.52, 0.0),
        'half': (0.05, 0.1, 0.4, 0.0), 'happy': (0.06, 0.26, 0.28, 0.1), 'closed': (-0.02, 0.2, 0.13, -0.06),
    }.get(kind, (0.2, 0.3, 0.62, 0.0))
    for i in range(n):
        u = (1 - math.cos(math.pi * i / (n - 1))) / 2
        x = 2 * u - 1
        s = math.sin(math.pi * u)
        t = c0 + c1 * x + bow * s
        b = t - depth * s ** 0.72 * (1.0 - 0.12 * x)
        top.append((x, t))
        bot.append((x, b))
    return top, bot


# ------------------------------------------------------------------------------------------
class Batman(Hero):
    """Batman (fan-made chibi): grey suit, black cowl with tall ears, yellow emblem and belt, long scalloped cape."""

    key = 'batman'
    ankle_h = 0.15
    hip_h = 0.64
    spine = 0.08
    chest = 0.2
    neck = 0.13
    head_up = 0.04
    shoulder = (0.235, 0.0, 0.11)
    upper_arm = 0.215
    forearm = 0.19
    hip_w = 0.11
    thigh = 0.22
    shin = 0.23
    sit_h = 0.17

    C = dict(suit='#7e828c', black='#1f222b', cape='#1c1f29', skin='#f0bf98', yellow='#f7c52b', gold='#e2a520', lens='#ffffff',
             sole='#34373f')

    HEAD = (0.41, 0.38, 0.39, 0.41)  # rx, ry, rz, centre height above the head joint
    COWL_T = 0.015  # cowl thickness over the skin
    TAPER = 0.07
    EYE = (25.0, 8.0)  # eye yaw / pitch

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.24

    # --- torso shape (chest frame) -------------------------------------------------------------
    Z0, Z1 = -0.36, 0.2
    SQ = 0.8

    def torso_r(self, z: float) -> float:
        """Torso radius (x) at height z of the chest frame: a gentle V up to the chest, rounding in to the neck."""
        if z <= 0.06:
            return 0.205 + 0.031 * sstep((z - self.Z0) / (0.06 - self.Z0))
        return 0.236 * math.sqrt(max(0.0, 1.0 - ((z - 0.06) / 0.162) ** 2))

    def wrap_torso(self, verts, lift: float):
        """Wrap a flat feature modelled facing -Y (x across, z up, -y = height above the surface) onto the
        front of the torso."""
        out = []
        for (x, y, z) in verts:
            rx = self.torso_r(z)
            ry = rx * self.SQ
            rho = rx * rx / ry
            phi = -math.pi / 2 + x / rho
            sx, sy = rx * math.cos(phi), ry * math.sin(phi)
            nrm = Vector((math.cos(phi) / rx, math.sin(phi) / ry, 0.0)).normalized()
            h = lift - y
            out.append((sx + nrm.x * h, sy + nrm.y * h, z))
        return out

    # --- head helpers --------------------------------------------------------------------------
    def taper(self, verts):
        hx, hy, hz, hc = self.HEAD
        out = []
        for (x, y, z) in verts:
            f = max(0.0, (hc - z) / hz)
            out.append((x * (1 - self.TAPER * f ** 1.6), y - 0.02 * f * f, z))
        return out

    def hadd(self, name, mesh, mat):
        self.add(name, (self.taper(mesh[0]), mesh[1]), mat, 'head')

    def hfeat(self, name, mesh, mat, hs: HeadShape, fr: Matrix):
        verts, faces = mesh
        sp, sn = hs.surface(fr.to_translation() - hs.c)
        vj = [fr @ Vector(v) for v in verts]
        self.hadd(name, (hs.conform(vj, sp, sn), faces), mat)

    @staticmethod
    def cowl_boundary(yaw: float) -> float:
        """Pitch of the cowl's lower edge for each yaw: a nose guard in front, up under the cheekbones, then
        straight down in front of where the ears would be; the back of the head is fully covered."""
        return periodic_interp([(0, -12), (8, -7), (22, -3), (38, -4), (52, -14), (64, -36), (76, -70), (90, -88), (180, -88)], abs(yaw))

    # --- building -------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            suit=mt.cloth('bat_suit', c['suit'], 0.66, 0.35, 0.06, 70),
            black=self.black_mat('bat_black', c['black'], 0.42),
            cowl=self.black_mat('bat_cowl', c['black'], 0.34),
            trunks=self.black_mat('bat_trunks', c['black'], 0.62),
            cape=self.black_mat('bat_cape', c['cape'], 0.5),
            skin=mt.skin('bat_skin', c['skin']),
            yellow=mt.glossy('bat_yellow', c['yellow'], 0.36, 0.4),
            gold=mt.metal('bat_gold', c['gold'], 0.3),
            lens=mt.emit('bat_lens', c['lens'], 0.6),
            sole=mt.cloth('bat_sole', c['sole'], 0.6, 0.1),
            mouth=mt.glossy('bat_mouth', '#5a2622', 0.4, 0.2),
            teeth=mt.glossy('teeth', '#fffdf6', 0.25, 0.4),
            tongue=mt.glossy('tongue', '#e8797b', 0.35, 0.3),
        )
        self.torso()
        self.legs()
        self.arms()
        self.head_parts()
        self.cape()

    def black_mat(self, name: str, color: str, rough: float):
        """Blue-black with a cool sheen, so the black parts keep their form under the warm key light."""
        def make(n):
            m = lib.NT(n)
            lw = m.node('ShaderNodeLayerWeight')
            lw.inputs['Blend'].default_value = 0.35
            rim = m.maprange(lw.outputs['Facing'], 0.5, 1.0)
            cc = m.mix(m.math('MULTIPLY', rim, 0.55), col(color), col('#3d4863'))
            m.bsdf(cc, rough, sheen=0.45, coat=0.25, spec=0.45)
            return m.mat
        return self.m.get(name, make)

    def torso(self):
        mm = self.mat
        prof = [(self.torso_r(self.Z0 + (self.Z1 - self.Z0) * i / 24), self.Z0 + (self.Z1 - self.Z0) * i / 24) for i in range(25)]
        self.add('torso', lib.lathe(prof, 32, cap_bottom=False, cap_top=True, squash_y=self.SQ), mm['suit'], 'chest')
        # the black cowl carries on down the neck
        self.add('neck', sweep([Vector((0, 0, -0.03)), Vector((0, 0, 0.1))], 0.1, 16), mm['cowl'], 'neck')
        # emblem: black bat in a yellow oval, wrapped onto the chest. The oval is a slightly domed disc (a fan
        # and rings, counter-clockwise in (x, z) so its front faces -Y) with a flat back and a rim wall.
        ez = 0.0
        acc = MeshAcc()
        ov = []
        of = []
        rings, seg = 5, 40
        ox, oz = 0.142, 0.086
        ov.append((0.0, -0.011, ez))
        for r_ in range(1, rings + 1):
            for k in range(seg):
                a = k / seg * math.tau
                ov.append((math.cos(a) * ox * r_ / rings, -0.011 + 0.002 * (r_ / rings) ** 2, ez + math.sin(a) * oz * r_ / rings))
        for k in range(seg):
            k2 = (k + 1) % seg
            of.append((0, 1 + k, 1 + k2))
        for r_ in range(1, rings):
            a0, a1 = 1 + (r_ - 1) * seg, 1 + r_ * seg
            for k in range(seg):
                k2 = (k + 1) % seg
                of.append((a0 + k, a1 + k, a1 + k2, a0 + k2))
        # back cap
        n0 = len(ov)
        ov.append((0.0, 0.004, ez))
        last = 1 + (rings - 1) * seg
        for k in range(seg):
            a = k / seg * math.tau
            ov.append((math.cos(a) * ox, 0.004, ez + math.sin(a) * oz))
        for k in range(seg):
            k2 = (k + 1) % seg
            of.append((n0, n0 + 1 + k2, n0 + 1 + k))
            of.append((last + k, n0 + 1 + k, n0 + 1 + k2, last + k2))
        acc.add((ov, of))
        self.add('emblem', (self.wrap_torso(acc.v, 0.0), acc.f), mm['yellow'], 'chest')
        bv, bf = slab([(x * ox * 0.98, z * ox * 0.98 + ez) for (x, z) in bat_poly()], 0.008, 2)
        bv = [(x, y - 0.01, z) for (x, y, z) in bv]
        self.add('bat', (self.wrap_torso(bv, 0.0), bf), mm['black'], 'chest')

        # trunks, utility belt, pouches, buckle (hips frame)
        self.add('pelvis', superellipsoid(0.205, 0.17, 0.15, 2.4, 28, 16, center=(0, 0, -0.04)), mm['trunks'], 'hips')
        self.add('belt', torus(0.2, 0.03, 40, 10, center=(0, 0, 0.065), squash=1.15), mm['yellow'], 'hips', S(1.0, 0.84, 1.0))
        for phi in (-126, -54, -162, -18, 130, 50):
            a = math.radians(phi)
            p = Vector((0.212 * math.cos(a), 0.178 * math.sin(a), 0.058))
            nrm = Vector((math.cos(a) / 0.212, math.sin(a) / 0.178, 0.0)).normalized()
            m = T(*(p + nrm * 0.016)) @ R(0, 0, math.degrees(math.atan2(nrm.y, nrm.x)) + 90)
            self.add('pouch', superellipsoid(0.034, 0.024, 0.042, 3.0, 14, 10), mm['yellow'], 'hips', m)
            self.add('pouchflap', superellipsoid(0.036, 0.012, 0.016, 3.0, 12, 6, center=(0, -0.018, 0.026)), mm['gold'], 'hips', m)
        bm = T(0, -0.192, 0.065)
        self.add('buckle', superellipsoid(0.05, 0.016, 0.036, 3.5, 16, 8), mm['gold'], 'hips', bm)
        self.add('buckle_in', superellipsoid(0.032, 0.01, 0.02, 3.5, 12, 6, center=(0, -0.012, 0)), mm['yellow'], 'hips', bm)

    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('trunk' + s_, hip, kn, an, lambda t: 0.118 + 0.01 * t, mm['trunks'], 0.0, 0.2, 16, 6, cap0=True, cap1=False)
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.088 - 0.012 * t + 0.006 * math.sin(math.pi * clamp((t - 0.4) / 0.4)), mm['suit'],
                      0.15, 0.8, 14, 12)
            self.limb('bootleg' + s_, hip, kn, an, lambda t: 0.086 + 0.012 * sstep(1 - t * 3.0), mm['black'], 0.6, 1.0, 16, 8, cap0=False,
                      cap1=False)
            self.limb('bootcuff' + s_, hip, kn, an, lambda t: 0.1 - 0.012 * t, mm['black'], 0.58, 0.64, 16, 3, cap0=True, cap1=False)
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('boot' + s_, superellipsoid(0.12, 0.176, 0.106, 2.6, 22, 14, center=(0, -0.05, -0.045)), mm['black'], None, fm)
            self.add('toe' + s_, ellipsoid(0.112, 0.1, 0.078, 18, 10, center=(0, -0.152, -0.075)), mm['black'], None, fm)
            self.add('sole' + s_, superellipsoid(0.126, 0.196, 0.032, 3.0, 22, 8, center=(0, -0.06, -0.122)), mm['sole'], None, fm)

    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.074 - 0.012 * t, mm['suit'], 0.0, 0.62, 14, 12, cap0=True, cap1=False)
            # gauntlet: flared at the top, snug at the wrist
            self.limb('gauntlet' + s_, sh, el, wr, lambda t: 0.068 + 0.016 * sstep(1 - t * 2.2), mm['black'], 0.56, 1.0, 16, 10, cap0=True,
                      extend=0.02)
            # three fins on the outer side of each forearm, raked back towards the elbow
            E = self.J(el)
            lat = (E.to_3x3() @ Vector((1.0, 0.0, 0.0))).normalized() * sd
            for k, t in enumerate((0.66, 0.75, 0.84)):
                p = self.along(sh, el, wr, t)
                q = self.along(sh, el, wr, t - 0.04)
                back = (q - p).normalized()  # along the forearm towards the elbow
                x = lat - back * lat.dot(back)
                x.normalize()
                y = back.cross(x)
                m = Matrix((x, y, back)).transposed().to_4x4()
                m.translation = p
                r0 = 0.07 - 0.006 * k
                fin = [(r0 - 0.012, -0.024), (r0 + 0.046, 0.034), (r0 + 0.02, 0.028), (r0 - 0.012, 0.02)]
                fv, ff = slab(fin, 0.013, 1)
                fv = [(xx, yy + 0.0065, zz) for (xx, yy, zz) in fv]
                self.add(f'fin{k}{s_}', placed(m, (fv, ff)), mm['black'], None)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.3):
                self.add('glove' + nm + s_, mesh, mm['black'], None, wm)

    # --- head -------------------------------------------------------------------------------------
    def head_parts(self):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        self.hadd('head', ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc)), mm['skin'])
        # the cowl: a shell over the head above the boundary
        hs = HeadShape(hx + 0.004, hy + 0.004, hz + 0.004, center=(0, 0, hc))
        v, f, _tip = hair_shell(hs, self.cowl_boundary, lambda yaw, pitch, fr: self.COWL_T - 0.004, 160, 28, inner=-0.03)
        self.hadd('cowl', (v, f), mm['cowl'])
        ct = self.COWL_T
        cs = HeadShape(hx + ct, hy + ct, hz + ct, center=(0, 0, hc))
        # nose guard under the cowl
        nf = cs.frame(0, -4, -0.013)
        self.hfeat('nose', ellipsoid(0.034, 0.03, 0.036, 16, 10), mm['cowl'], cs, nf)
        self.ears(cs)
        self.bat_face(head, cs)

    def ears(self, cs: HeadShape):
        mm = self.mat
        for sd in (1, -1):
            base, nrm = cs.point(35 * sd, 46, -0.05)
            d = Vector((0.2 * sd, 0.04, 1.0)).normalized()
            out = Vector((sd, 0.0, 0.0))
            pts = [base + d * (0.36 * t) + out * (0.03 * t * t) for t in (k / 11 for k in range(12))]
            mesh = flat_sweep(pts, lambda t: 0.09 * (1 - t) ** 1.1 + 0.003, Vector((0.0, -1.0, 0.0)), 0.56, 16)
            self.add('ear', mesh, mm['cowl'], 'head')

    def bat_face(self, head: HeadShape, cs: HeadShape):
        mm = self.mat
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        eyes, mouth, brows = f['eyes'], f['mouth'], f['brows']
        ey, ep = self.EYE
        ew, eh = 0.116, 0.106
        dark = self.m.glossy('eye_dark', '#1c1412', 0.25, 0.9)
        for side in (1, -1):
            kind = eyes
            if eyes == 'wink':
                kind = 'open' if side > 0 else 'happy'
            if kind == 'open' and brows in ('angry', 'determined'):
                kind = 'determined'
            top, bot = bat_lens(kind)
            top = [(x * ew, z * eh) for (x, z) in top]
            bot = [(x * ew, z * eh) for (x, z) in bot]
            mesh = strip_shape(top, bot, 4, 0.011, 0.004, 0.012)
            if side < 0:
                mesh = mirror_x(mesh)
            fr = cs.frame(ey * side, ep, 0.0)
            name = 'L' if side > 0 else 'R'
            self.hfeat('lens' + name, mesh, mm['lens'], cs, fr)
            if kind == 'dizzy':
                pts = []
                for i in range(40):
                    a = i / 40 * math.tau * 2.2
                    r = 0.008 + (ew * 0.62 - 0.008) * i / 40
                    pts.append(Vector((math.cos(a) * r * side, -0.019, 0.006 + math.sin(a) * r * 0.9)))
                self.hfeat('spiral' + name, sweep(pts, 0.0075, 6), dark, cs, fr)
            # the cowl's brow ridge, following the lens' upper edge
            if kind not in ('wide', 'dizzy'):
                c0, c1 = {'open': (0.2, 0.3), 'determined': (0.12, 0.4), 'sad': (0.2, -0.3), 'half': (0.05, 0.1), 'happy': (0.06, 0.26),
                          'closed': (-0.02, 0.2)}.get(kind, (0.2, 0.3))
                bp = [Vector((x * ew * 1.08 * side, -0.004, (c0 + c1 * x + 0.2) * eh)) for x in [(-1 + 2 * i / 10) for i in range(11)]]
                self.hfeat('brow' + name, flat_sweep(bp, lambda t: 0.017 * (0.55 + 0.45 * math.sin(math.pi * t)), Vector((0.0, -1.0, 0.0)), 0.55, 10),
                           mm['cowl'], cs, fr)
        # mouth on the exposed lower face: stern by default, a smirk when happy, gritted teeth when determined
        happy = eyes in ('happy', 'wink') or brows == 'up'
        mood = {'smile': 'stern', 'grin': 'grit' if brows == 'determined' else 'smirk', 'laugh': 'toothy'}.get(mouth, mouth)
        if mood == 'smirk' and not happy and brows != 'neutral':
            mood = 'stern'
        mf = head.frame(0, -29, 0.0)
        w = 0.1
        mth, teeth, tongue = mm['mouth'], mm['teeth'], mm['tongue']
        if mood == 'stern':
            self.hfeat('mouth', sweep(arc_points(w * 0.9, -0.01, 12, y=-0.006), lambda t: 0.0075 + 0.002 * math.sin(math.pi * t), 8), mth, head, mf)
        elif mood == 'smirk':
            pts = [Vector(((i / 12 - 0.5) * w * 0.95, -0.006, 0.024 * (i / 12) ** 2.2 - 0.004 * math.sin(math.pi * i / 12))) for i in range(13)]
            self.hfeat('mouth', sweep(pts, lambda t: 0.0072 + 0.002 * math.sin(math.pi * t), 8), mth, head, mf)
        elif mood == 'grit':
            self.hfeat('mouth', superellipsoid(w * 0.46, 0.012, 0.024, 3.2, 18, 8), mth, head, mf @ T(0, 0.004, -0.002))
            self.hfeat('teeth', superellipsoid(w * 0.4, 0.012, 0.016, 3.2, 18, 8, center=(0, -0.004, 0)), teeth, head, mf)
            self.hfeat('teethline', sweep([Vector((-w * 0.38, -0.017, 0)), Vector((w * 0.38, -0.017, 0))], 0.0028, 6), mth, head, mf)
        elif mood == 'toothy':
            hh = 0.05
            self.hfeat('mouth', ellipsoid(w * 0.5, 0.02, hh, 22, 12, zmax=0.15), mth, head, mf @ T(0, 0.002, 0.008))
            self.hfeat('teeth', ellipsoid(w * 0.42, 0.01, 0.013, 14, 6, center=(0, -0.012, 0.002)), teeth, head, mf)
            self.hfeat('tongue', ellipsoid(w * 0.28, 0.012, hh * 0.4, 14, 8, center=(0, -0.008, -hh * 0.62)), tongue, head, mf)
        elif mood in ('open', 'gasp', 'o'):
            hh = {'open': 0.045, 'gasp': 0.052, 'o': 0.032}[mood]
            ww = {'open': w * 0.36, 'gasp': 0.04, 'o': 0.028}[mood]
            self.hfeat('mouth', ellipsoid(ww, 0.018, hh, 16, 10), mth, head, mf @ T(0, 0.004, -0.008))
            if mood != 'o':
                self.hfeat('tongue', ellipsoid(ww * 0.55, 0.01, hh * 0.35, 12, 6, center=(0, -0.012, -hh * 0.7)), tongue, head, mf)
        elif mood == 'frown':
            self.hfeat('mouth', sweep(arc_points(w * 0.8, -0.022, 12, y=-0.006), 0.008, 8), mth, head, mf @ T(0, 0, -0.01))
        elif mood == 'flat':
            self.hfeat('mouth', sweep([Vector((-w * 0.32, -0.006, 0)), Vector((w * 0.32, -0.006, 0))], 0.008, 8), mth, head, mf)
        elif mood == 'wobble':
            pts = [Vector(((i / 12 - 0.5) * w * 0.85, -0.006, math.sin(i / 12 * math.tau * 1.5) * 0.011)) for i in range(13)]
            self.hfeat('mouth', sweep(pts, 0.008, 8), mth, head, mf)
        else:
            self.hfeat('mouth', sweep(arc_points(w * 0.9, -0.01, 12, y=-0.006), 0.0075, 8), mth, head, mf)
        # a hint of the square chin
        cf = head.frame(0, -52, -0.02)
        self.hfeat('chin', ellipsoid(0.07, 0.03, 0.035, 16, 8), mm['skin'], head, cf)

    # --- cape -------------------------------------------------------------------------------------
    def body_proxies(self):
        """Ellipsoids (inverse matrix, radii) and spheres (centre, radius) the cape must stay behind."""
        hx, hy, hz, hc = self.HEAD
        ell = [
            (self.J('hips') @ T(0, 0, -0.04), Vector((0.225, 0.19, 0.17))),
            (self.J('head') @ T(0, 0, hc), Vector((hx + 0.03, hy + 0.03, hz + 0.03))),
        ]
        ell = [(m.inverted(), r) for m, r in ell]
        sph = []
        for s_ in ('L', 'R'):
            pts = curve3(self.P('shoulder' + s_), self.P('elbow' + s_), self.P('wrist' + s_), 8)
            sph += [(p, 0.095) for p in pts[1:]]
            sph.append((self.J('wrist' + s_) @ Vector((0, 0, -0.09)), 0.11))
            pts = curve3(self.P('hip' + s_), self.P('knee' + s_), self.P('ankle' + s_), 8)
            sph += [(p, 0.115) for p in pts]
            sph.append((self.J('ankle' + s_) @ Vector((0, -0.05, -0.05)), 0.15))
            sph.append((self.J('ankle' + s_) @ Vector((0, -0.14, -0.07)), 0.12))
        return ell, sph

    def cape(self):
        ex = self.pose.get('extra', {})
        fly = clamp(ex.get('scarf', 0.1))
        wave = ex.get('wave', 0.0)
        sway = ex.get('sway', 0.0)
        airborne = not self.pose.get('ground', True) and not self.pose.get('sit', False)
        yaw = self.pose['root'].get('yaw', 0.0)
        # 0 facing the camera (or away from it), 1 in profile: in profile the cape streams out behind, otherwise it
        # billows out to the sides so it still reads (streaming straight back it would hide behind the body)
        side_view = sstep((abs(math.sin(math.radians(yaw))) - 0.3) / 0.45) * (1.0 - sstep((-math.cos(math.radians(yaw)) - 0.2) / 0.4))
        flare = fly * (1.0 - side_view)
        fly = fly * lerp(0.4, 1.0, side_view)
        Cm = self.J('chest')
        rot = Cm.to_3x3().normalized()
        inv = rot.transposed()
        dl = inv @ Vector((0.0, 0.0, -1.0))
        ang_g = math.degrees(math.atan2(dl.y, -dl.z))  # world "down" in the chest's y-z plane (+ = towards the back)
        NU, NV = 25, 22
        L0 = 0.86
        fly_e = fly ** 0.85
        grid = []
        for i in range(NU):
            s = 2.0 * i / (NU - 1) - 1.0
            phi = math.radians(s * 86.0)
            top = Vector((math.sin(phi) * 0.195, 0.09 + math.cos(phi) * 0.11, 0.128 - 0.03 * s * s))
            fr = ((s + 1.0) * 2.0) % 1.0
            hem = 0.07 * math.sqrt(max(0.0, 1.0 - (2.0 * fr - 1.0) ** 2))
            length = L0 * (1.0 - 0.05 * s * s) - hem
            col_pts = []
            y, z = 0.0, 0.0
            dlen = length / (NV - 1)
            for j in range(NV):
                if j > 0:
                    vm = (j - 0.5) / (NV - 1)
                    a_hang = lerp(15.0, clamp(ang_g, -35.0, 70.0), sstep(vm / 0.55))
                    a_fly = 58.0 + 26.0 * vm + (22.0 if airborne else 0.0)
                    rip = (4.0 + 10.0 * fly) * math.sin(wave * 1.1 + vm * 4.4 + s * 1.2) * vm
                    a = math.radians(lerp(a_hang, a_fly, fly_e) + rip)
                    y += math.sin(a) * dlen
                    z -= math.cos(a) * dlen
                    col_pts.append((y, z, a))
                else:
                    col_pts.append((0.0, 0.0, math.radians(lerp(15.0, 58.0, fly_e))))
            row = []
            for j, (yy, zz, a) in enumerate(col_pts):
                v = j / (NV - 1)
                nrm = Vector((0.0, math.cos(a), math.sin(a)))
                w = (0.195 + 0.3 * v ** 0.85 + 0.2 * flare * v ** 1.3) * (1.0 - 0.2 * fly * v)
                x = top.x + s * (w - 0.195) + sway * 0.06 * v
                # cross-section: the shoulder arc at the top relaxing into a shallow curl with soft folds lower down
                k = sstep(v / 0.35)
                curl = -(0.1 * (1.0 - v) + 0.035) * s * s * (1.0 - 0.5 * fly) * (1.0 - 0.6 * flare)
                fold = (0.006 + 0.03 * v) * (1.0 + 0.6 * fly) * math.cos(math.pi * s * 3.5 + wave * 0.8 + v * 1.5)
                arc_y, arc_z = top.y - 0.2, top.z - 0.128
                p = Vector((x, 0.2 + yy, 0.128 + zz))
                p += Vector((0.0, arc_y, arc_z)) * (1.0 - k) + nrm * ((curl + fold) * k)
                row.append(Cm @ p)
            grid.append(row)
        self.cape_collide(grid, rot @ Vector((0.0, 1.0, 0.0)))
        mesh = cloth_mesh(grid, 0.02)
        self.add('cape', mesh, self.mat['cape'], None)

    def cape_collide(self, grid, back: Vector):
        NU, NV = len(grid), len(grid[0])
        Cm = self.J('chest')
        Ci = Cm.inverted()
        ell, sph = self.body_proxies()
        push = [[0.0] * NV for _ in range(NU)]
        for i in range(NU):
            for j in range(NV):
                p = grid[i][j]
                d = 0.0
                # torso: an elliptic cylinder in the chest frame (the push runs along the chest's +Y)
                q = Ci @ p
                rx, ry = 0.25, 0.205
                if -0.44 < q.z < 0.2 and abs(q.x) < rx:
                    ye = ry * math.sqrt(1.0 - (q.x / rx) ** 2)
                    if q.y < ye:
                        d = max(d, ye - q.y)
                for Mi, rr in ell:
                    o = Mi @ p
                    dv = Mi.to_3x3() @ back
                    o = Vector((o.x / rr.x, o.y / rr.y, o.z / rr.z))
                    dv = Vector((dv.x / rr.x, dv.y / rr.y, dv.z / rr.z))
                    a_ = dv.dot(dv)
                    b_ = o.dot(dv)
                    c_ = o.dot(o) - 1.0
                    disc = b_ * b_ - a_ * c_
                    if disc > 0.0:
                        t2 = (-b_ + math.sqrt(disc)) / a_
                        if t2 > 0.0:
                            d = max(d, t2 + 0.012)
                for cc, r in sph:
                    w_ = cc - p
                    tc = w_.dot(back)
                    h2 = w_.dot(w_) - tc * tc
                    if h2 < r * r:
                        t2 = tc + math.sqrt(r * r - h2)
                        if t2 > 0.0:
                            d = max(d, t2 + 0.01)
                push[i][j] = d
        # spread the push so the cloth bends smoothly around what it drapes over
        sm = [[0.0] * NV for _ in range(NU)]
        for i in range(NU):
            for j in range(NV):
                sm[i][j] = max(push[a][b] for a in range(max(0, i - 1), min(NU, i + 2)) for b in range(max(0, j - 1), min(NV, j + 2)))
        for _ in range(3):
            nxt = [[0.0] * NV for _ in range(NU)]
            for i in range(NU):
                for j in range(NV):
                    acc, wsum = 0.0, 0.0
                    for a in range(max(0, i - 1), min(NU, i + 2)):
                        for b in range(max(0, j - 1), min(NV, j + 2)):
                            ww = 1.0 if (a == i and b == j) else 0.6
                            acc += sm[a][b] * ww
                            wsum += ww
                    nxt[i][j] = acc / wsum
            sm = nxt
        # the push also carries on down the cloth: whatever is pushed back drags the rest of the column with it
        for i in range(NU):
            run = 0.0
            for j in range(NV):
                run = max(run * 0.92, max(push[i][j], sm[i][j]))
                grid[i][j] = grid[i][j] + back * run
        # rest on the ground rather than sinking into it
        flat = Vector((back.x, back.y, 0.0))
        flat = flat.normalized() if flat.length > 1e-4 else Vector((0.0, 1.0, 0.0))
        g = 0.02
        for i in range(NU):
            for j in range(NV):
                p = grid[i][j]
                if p.z < g:
                    e = g - p.z
                    grid[i][j] = Vector((p.x, p.y, g)) + flat * (e * 0.85)


def cloth_mesh(grid, thick: float):
    """A thick cloth sheet from a grid of world points grid[u][v]."""
    NU, NV = len(grid), len(grid[0])
    nrm = [[None] * NV for _ in range(NU)]
    for i in range(NU):
        for j in range(NV):
            du = grid[min(NU - 1, i + 1)][j] - grid[max(0, i - 1)][j]
            dv = grid[i][min(NV - 1, j + 1)] - grid[i][max(0, j - 1)]
            n = du.cross(dv)
            nrm[i][j] = n.normalized() if n.length > 1e-9 else Vector((0.0, 1.0, 0.0))
    verts = []
    for layer in (1, -1):
        for i in range(NU):
            for j in range(NV):
                verts.append(tuple(grid[i][j] + nrm[i][j] * (thick * 0.5 * layer)))
    base = NU * NV
    faces = []

    def idx(i, j, layer=0):
        return layer * base + i * NV + j
    for i in range(NU - 1):
        for j in range(NV - 1):
            faces.append((idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)))
            faces.append((idx(i, j, 1), idx(i, j + 1, 1), idx(i + 1, j + 1, 1), idx(i + 1, j, 1)))
    for i in range(NU - 1):
        for j in (0, NV - 1):
            a, b = idx(i, j), idx(i + 1, j)
            a1, b1 = idx(i, j, 1), idx(i + 1, j, 1)
            faces.append((a, a1, b1, b) if j == 0 else (a, b, b1, a1))
    for j in range(NV - 1):
        for i in (0, NU - 1):
            a, b = idx(i, j), idx(i, j + 1)
            a1, b1 = idx(i, j, 1), idx(i, j + 1, 1)
            faces.append((a, b, b1, a1) if i == 0 else (a, a1, b1, b))
    return verts, faces
