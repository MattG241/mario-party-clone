"""Elvis: a fan-made, affectionate chibi caricature of Elvis Presley in his 1970s stage look, for the private
party build (loaded by characters.py as class `Elvis`).

Built on the shared Hero structure (char_models.py) with Kip's chibi proportions. Signature details, picked so
he reads at board size (~120 px tall):
  * a glossy jet-black pompadour (a big roll over the forehead, a loose lock falling onto it) and long
    sideburns;
  * gold-rimmed aviator sunglasses with a gradient tint: the eyes and their expressions show through;
  * a relaxed smile that curls up on one side (the lip curl) as his resting face;
  * a white jumpsuit with a tall stand-up collar framing the head, a modest V neckline, gold and rhinestone
    studs down the front, the sleeves (flared at the cuff) and the flared trouser legs;
  * a wide gold belt with a big jewelled buckle, and white boots.

The collar is rebuilt for every pose: each column of it is cut down wherever the head (with its hair) or a
raised upper arm would come through it, so a tilted head or arms thrown up never clip into it.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

import lib
from lib import col
from char_rig import HeadShape, R, S, T, arc_points, curve3, ellipsoid, flat_sweep, polyline_segment, superellipsoid, sweep, torus
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
    """'tip' values for a sweep / flat_sweep of n rings: t0..t1 along the rings, then both caps."""
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


def cloth_mesh(grid, thick: float):
    """A thick sheet from a grid of world points grid[u][v]."""
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
    return verts, faces, nrm


def ring_mesh(outline, rings: int = 4):
    """A single-surface fan filling a closed outline [(x, z), ...] (facing -Y), for lenses."""
    n = len(outline)
    cx = sum(p[0] for p in outline) / n
    cz = sum(p[1] for p in outline) / n
    verts = [(cx, 0.0, cz)]
    for r in range(1, rings + 1):
        f = r / rings
        for (x, z) in outline:
            verts.append((cx + (x - cx) * f, 0.0, cz + (z - cz) * f))
    faces = []
    for k in range(n):
        k2 = (k + 1) % n
        faces.append((0, 1 + k2, 1 + k))
    for r in range(1, rings):
        a0, a1 = 1 + (r - 1) * n, 1 + r * n
        for k in range(n):
            k2 = (k + 1) % n
            faces.append((a0 + k, a0 + k2, a1 + k2, a1 + k))
    return verts, faces


# ------------------------------------------------------------------------------------------
class Elvis(Hero):
    """Elvis (fan-made chibi): black pompadour, gold aviators, white studded jumpsuit with a tall collar."""

    key = 'elvis'
    ankle_h = 0.15
    hip_h = 0.64  # ankle_h + 0.04 + thigh + shin
    spine = 0.08
    chest = 0.19
    neck = 0.14
    head_up = 0.04
    shoulder = (0.225, 0.0, 0.11)
    upper_arm = 0.215
    forearm = 0.19
    hip_w = 0.11
    thigh = 0.22
    shin = 0.23
    sit_h = 0.17

    C = dict(skin='#f2c29c', skin_d='#dc9e78', suit='#f2efe8', suit_d='#dcd7cd', gold='#f3c34a', gold_d='#c8952b', stone='#eef8ff',
             ruby='#d4203c', boot='#f3f1ec', sole='#cdc6ba', hair_d='#07070b', hair_l='#232a3f', iris='#3b6cae', brow='#0d0c10',
             lash='#0b0a0d', lens_top='#2a1408', lens_bot='#9c5f26', mouth='#6d2a26')

    HEAD = (0.4, 0.375, 0.39, 0.41)  # rx, ry, rz, centre height above the head joint
    EYE = (23.0, -6.0)
    GLASS = (25.5, -7.0, 0.042)  # lens centre yaw, pitch; distance in front of the face
    TAPER = 0.1

    def head_top(self) -> float:
        # the dizzy stars circle above the pompadour
        return self.HEAD[3] + self.HEAD[2] + 0.24

    # --- materials ----------------------------------------------------------------------------
    def hair_mat(self, name: str):
        """Blue-black, pomaded: a strong clear coat for the glossy highlights."""
        c = self.C

        def make(n):
            m = lib.NT(n)
            t = m.node('ShaderNodeAttribute')
            t.attribute_name = 'tip'
            cc = m.mix(t.outputs['Fac'], col(c['hair_d']), col(c['hair_l']))
            m.bsdf(cc, 0.3, coat=0.75, sheen=0.15, spec=0.55)
            return m.mat
        return self.m.get(name, make)

    def lens_mat(self, name: str):
        """Gradient tint: dark brown at the top of the lens fading to clear amber at the bottom."""
        c = self.C
        hc = self.HEAD[3]

        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            z = m.sep(obj)[2]
            f = m.maprange(z, hc - 0.17, hc + 0.03)
            cc = m.mix(f, col(c['lens_bot']), col(c['lens_top']))
            a = m.math('ADD', m.math('MULTIPLY', f, 0.4), 0.52)
            m.bsdf(cc, 0.1, coat=0.9, spec=0.9, alpha=a)
            return m.mat
        return self.m.get(name, make)

    def stone_mat(self, name: str):
        """Rhinestones: clear, glossy and a little self-lit so they sparkle even in shadow."""
        c = self.C

        def make(n):
            m = lib.NT(n)
            m.bsdf(col(c['stone']), 0.06, coat=1.0, spec=1.0, emission=col('#dff2ff'), emission_strength=0.45)
            return m.mat
        return self.m.get(name, make)

    # --- building -------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('elvis_skin', c['skin']),
            skin_d=mt.skin('elvis_skin_d', c['skin_d']),
            suit=mt.cloth('elvis_suit', c['suit'], 0.5, 0.45, 0.04, 70),
            suit_d=mt.cloth('elvis_suit_d', c['suit_d'], 0.55, 0.4),
            gold=mt.metal('elvis_gold', c['gold'], 0.26),
            gold_d=mt.metal('elvis_gold_d', c['gold_d'], 0.34),
            stone=self.stone_mat('elvis_stone'),
            ruby=mt.glossy('elvis_ruby', c['ruby'], 0.1, 0.9),
            boot=mt.glossy('elvis_boot', c['boot'], 0.32, 0.6),
            sole=mt.cloth('elvis_sole', c['sole'], 0.6, 0.1),
            hair=self.hair_mat('elvis_hair'),
            lens=self.lens_mat('elvis_lens'),
            glint=mt.emit('elvis_glint', '#ffffff', 1.4),
            mouth=mt.glossy('mouth', c['mouth'], 0.4, 0.2),
            teeth=mt.glossy('teeth', '#fffdf6', 0.25, 0.4),
            tongue=mt.glossy('tongue', '#e8797b', 0.35, 0.3),
        )
        self.studs_g = MeshAcc()  # gold studs, merged into one part at the end
        self.studs_s = MeshAcc()  # rhinestones
        self.torso()
        self.belt()
        self.legs()
        self.arms()
        self.head_parts()
        self.collar()
        if self.studs_g.v:
            self.add('studs_gold', self.studs_g.mesh, self.mat['gold'], None)
        if self.studs_s.v:
            self.add('studs_stone', self.studs_s.mesh, self.mat['stone'], None)

    def stud(self, m: Matrix, stone: bool, size: float = 1.0):
        """A small domed stud (gold) or a faceted-looking rhinestone at frame m (world), facing its -Y."""
        s = size
        if stone:
            self.studs_s.add(ellipsoid(0.0115 * s, 0.0085 * s, 0.0115 * s, 8, 5), m=m)
        else:
            self.studs_g.add(ellipsoid(0.0125 * s, 0.007 * s, 0.0125 * s, 10, 6), m=m)

    # --- torso (chest frame) ------------------------------------------------------------------------
    Z0, Z1 = -0.36, 0.2
    SQ = 0.8
    V = (-0.035, 0.212, 0.088)  # the V neckline: bottom z, top z, half width at the top (arc length)

    def torso_r(self, z: float) -> float:
        """Torso radius (x) at height z of the chest frame: a gentle V up to the chest, rounding in to the neck."""
        if z <= 0.06:
            return 0.203 + 0.025 * sstep((z - self.Z0) / (0.06 - self.Z0))
        return 0.228 * math.sqrt(max(0.0, 1.0 - ((z - 0.06) / 0.158) ** 2))

    def torso_pt(self, x: float, z: float, lift: float = 0.0):
        """Point (chest frame) on the torso front at arc length x from the centre line, height z; and its normal."""
        rx = max(0.03, self.torso_r(z))
        ry = rx * self.SQ
        rho = rx * rx / ry
        phi = -math.pi / 2 + x / rho
        nrm = Vector((math.cos(phi) / rx, math.sin(phi) / ry, 0.0)).normalized()
        return Vector((rx * math.cos(phi), ry * math.sin(phi), z)) + nrm * lift, nrm

    def wrap_torso(self, verts, lift: float):
        out = []
        for (x, y, z) in verts:
            p, _n = self.torso_pt(x, z, lift - y)
            out.append(tuple(p))
        return out

    def torso(self):
        mm = self.mat
        Cm = self.J('chest')
        prof = [(self.torso_r(self.Z0 + (self.Z1 - self.Z0) * i / 24), self.Z0 + (self.Z1 - self.Z0) * i / 24) for i in range(25)]
        self.add('torso', lib.lathe(prof, 36, cap_bottom=False, cap_top=True, squash_y=self.SQ), mm['suit'], 'chest')
        # the V neckline: bare chest showing between gold-piped edges
        vb, vt, vw = self.V
        sv, sf = slab([(0.0, vb), (vw, vt), (-vw, vt)], 0.004, 3)
        self.add('vneck', (self.wrap_torso(sv, 0.001), sf), mm['skin'], 'chest')
        for sd in (1, -1):
            pts = [self.torso_pt(sd * vw * (1 - i / 14), vt + (vb - vt) * i / 14, 0.006)[0] for i in range(15)]
            self.add('vtrim', sweep(pts, 0.0105, 8), mm['gold'], 'chest')
        # studs: two chevron rows following the V down the front (gold and rhinestones in turn)
        d = Vector((vw, vt - vb)).normalized()
        perp = Vector((d.y, -d.x))
        for k, off in enumerate((0.036, 0.07)):
            s0 = -perp.x * off / d.x
            s_ = s0 + 0.015
            n = 0
            while True:
                x = d.x * s_ + perp.x * off
                z = vb + d.y * s_ + perp.y * off
                if z > vt - 0.035:
                    break
                if z > -0.18:
                    for sd in (1, -1):
                        p, nrm = self.torso_pt(x * sd, z, 0.004)
                        self.stud(Cm @ orient(p, nrm), (n + k) % 2 == 1)
                n += 1
                s_ += 0.03
        # a gold sunburst just under the point of the V
        p, nrm = self.torso_pt(0.0, vb - 0.03, 0.006)
        self.stud(Cm @ orient(p, nrm), False, 1.5)
        for k in range(6):
            a = math.radians(-90 + 36 * (k - 2.5))
            p, nrm = self.torso_pt(0.028 * math.cos(a), vb - 0.03 + 0.028 * math.sin(a) * 0.9, 0.004)
            self.stud(Cm @ orient(p, nrm), k % 2 == 0, 0.85)
        # trousers seat (hips frame)
        self.add('pelvis', superellipsoid(0.205, 0.168, 0.15, 2.4, 28, 16, center=(0, 0, -0.04)), mm['suit'], 'hips')
        # neck
        a0 = self.J('chest') @ Vector((0.0, 0.0, 0.1))
        b0 = self.J('neck') @ Vector((0.0, 0.0, 0.03))
        c0 = self.J('head') @ Vector((0.0, 0.01, 0.12))
        self.add('neck', sweep(curve3(a0, b0, c0, 6), 0.072, 14), mm['skin'])

    def belt(self):
        mm = self.mat
        H = self.J('hips')
        zc = 0.07
        self.add('belt', torus(0.2, 0.034, 44, 10, center=(0, 0, zc), squash=1.25), mm['gold_d'], 'hips', S(1.0, 0.84, 1.0))
        for k in range(2):
            self.add(f'beltedge{k}', torus(0.206, 0.0085, 44, 6, center=(0, 0, zc + (0.036 if k else -0.036))), mm['gold'], 'hips',
                     S(1.0, 0.84, 1.0))
        # rhinestones round the belt
        for k in range(16):
            a = math.radians(-90 + 22.5 * k)
            if abs((22.5 * k + 180.0) % 360.0 - 180.0) < 30:
                continue
            p = Vector((0.236 * math.cos(a), 0.2 * math.sin(a), zc))
            nrm = Vector((math.cos(a) / 0.236, math.sin(a) / 0.2, 0.0)).normalized()
            self.stud(H @ orient(p, nrm), k % 2 == 0, 1.1)
        # the big buckle: a gold oval with a ruby in a ring of rhinestones
        bm = T(0, -0.212, zc)
        self.add('buckle', superellipsoid(0.088, 0.022, 0.064, 2.3, 28, 12), mm['gold'], 'hips', bm)
        self.add('buckle_in', superellipsoid(0.066, 0.012, 0.046, 2.3, 24, 8, center=(0, -0.016, 0)), mm['gold_d'], 'hips', bm)
        self.add('ruby', ellipsoid(0.022, 0.013, 0.026, 14, 8, center=(0, -0.028, 0)), mm['ruby'], 'hips', bm)
        for k in range(10):
            a = k / 10 * math.tau
            self.stud(H @ bm @ T(0.05 * math.cos(a), -0.026, 0.034 * math.sin(a)), True, 0.8)

    # --- legs: white flares over white boots -----------------------------------------------------------
    @staticmethod
    def pant_r(t: float) -> float:
        return 0.114 - 0.02 * sstep(t / 0.5) + 0.072 * sstep((t - 0.52) / 0.48) ** 1.15

    PANT_EXT = 0.05

    def legs(self):
        mm = self.mat
        ext = self.PANT_EXT
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('pants' + s_, hip, kn, an, self.pant_r, mm['suit'], 0.0, 1.0, 20, 18, extend=ext, cap0=True, cap1=False)
            self.limb('pantin' + s_, hip, kn, an, lambda t: self.pant_r(t) - 0.012, mm['suit_d'], 0.8, 1.0, 20, 4, extend=ext, cap0=False,
                      cap1=False)
            self.limb('hem' + s_, hip, kn, an, lambda t: self.pant_r(t) + 0.004, mm['gold'], 0.965, 1.0, 20, 2, extend=ext, cap0=False,
                      cap1=False)
            # studs down the outer seam, and a gold V of studs in the flare
            for i in range(12):
                t = 0.08 + 0.07 * i
                self.limb_stud(hip, kn, an, t, sd, 0.0, i % 2 == 1, ext)
            for j, t in enumerate((0.76, 0.84, 0.92)):
                for q in (1, -1):
                    self.limb_stud(hip, kn, an, t, sd, q * (10 + 12 * j), j % 2 == 0, ext)
            # white boots with a little heel; the flare covers the shaft
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('boot' + s_, superellipsoid(0.112, 0.165, 0.1, 2.6, 22, 14, center=(0, -0.05, -0.05)), mm['boot'], None, fm)
            self.add('toe' + s_, ellipsoid(0.1, 0.105, 0.07, 18, 10, center=(0, -0.158, -0.085)), mm['boot'], None, fm)
            self.add('sole' + s_, superellipsoid(0.118, 0.19, 0.026, 3.0, 22, 8, center=(0, -0.066, -0.13)), mm['sole'], None, fm)
            self.add('heel' + s_, superellipsoid(0.074, 0.05, 0.032, 3.0, 14, 8, center=(0, 0.052, -0.13)), mm['sole'], None, fm)

    def limb_stud(self, a, b, c, t, sd, dang, stone, ext=0.0, radius=None, up=None):
        """A stud on the outer side of a limb (dang: degrees round the limb from the outer seam)."""
        pts = curve3(self.P(a), self.P(b), self.P(c) + ((self.P(c) - self.P(b)).normalized() * ext if ext else Vector()), 24)
        seg = polyline_segment(pts, max(0.0, t - 0.02), min(1.0, t + 0.02), 2)
        tg = (seg[-1] - seg[0]).normalized()
        p = seg[1]
        J = self.J(up or (b if t > 0.5 else a))
        lat = J.to_3x3() @ Vector((1.0, 0.0, 0.0))
        is_leg = a.startswith('hip')
        out = lat * (-sd if is_leg else sd)
        out = (out - tg * out.dot(tg)).normalized()
        fwd = tg.cross(out).normalized()
        ang = math.radians(dang)
        nrm = (out * math.cos(ang) + fwd * math.sin(ang)).normalized()
        r = (radius(t) if radius else (self.pant_r(t) if is_leg else self.sleeve_r(t))) + 0.003
        self.stud(orient(p + nrm * r, nrm), stone)

    # --- arms: white sleeves with studded bell cuffs --------------------------------------------------
    @staticmethod
    def sleeve_r(t: float) -> float:
        return 0.084 - 0.018 * clamp(t / 0.7) + 0.05 * sstep((t - 0.64) / 0.36)

    SLEEVE_EXT = 0.035

    def arms(self):
        mm = self.mat
        ext = self.SLEEVE_EXT
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, self.sleeve_r, mm['suit'], 0.0, 1.0, 18, 16, extend=ext, cap0=True, cap1=False)
            self.limb('sleevein' + s_, sh, el, wr, lambda t: self.sleeve_r(t) - 0.01, mm['suit_d'], 0.82, 1.0, 18, 3, extend=ext,
                      cap0=False, cap1=False)
            self.limb('cuff' + s_, sh, el, wr, lambda t: self.sleeve_r(t) + 0.004, mm['gold'], 0.955, 1.0, 18, 2, extend=ext, cap0=False,
                      cap1=False)
            self.limb('wrist' + s_, sh, el, wr, 0.05, mm['skin'], 0.8, 1.0, 12, 4, extend=0.02)
            for i in range(6):
                self.limb_stud(sh, el, wr, 0.12 + 0.1 * i, sd, 0.0, i % 2 == 0, ext)
            for q in (-1, 1):
                self.limb_stud(sh, el, wr, 0.9, sd, 28 * q, True, ext)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.2):
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
        self.add('head', (self.taper(hv), hf), mm['skin'], 'head')
        for sd in (1, -1):
            self.add('ear', ellipsoid(0.062, 0.04, 0.082, 16, 10), mm['skin'], 'head', T((hx - 0.01) * sd, 0.03, hc - 0.05) @ R(0, 0, -14 * sd))
            self.add('earin', ellipsoid(0.034, 0.02, 0.048, 12, 8), mm['skin_d'], 'head', T((hx - 0.004) * sd, 0.0, hc - 0.05) @ R(0, 0, -14 * sd))
        ey, ep = self.EYE
        self.face(head, 'head', eye_yaw=ey, eye_pitch=ep, eye_size=(0.086, 0.106), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-31,
                  lid_col=c['skin'], skin=c['skin'], brow_pitch=25, blush=False, lash_col=c['lash'])
        self.hair()
        self.glasses()

    # --- hair ---------------------------------------------------------------------------------------
    HS_OFF = (0.012, 0.012, 0.01, 0.01, 0.012)  # hair shell: extra rx, ry, rz; centre y, z offsets

    def hair_shape(self):
        hx, hy, hz, hc = self.HEAD
        ox, oy, oz, cy, cz = self.HS_OFF
        return HeadShape(hx + ox, hy + oy, hz + oz, center=(0, cy, hc + cz))

    @staticmethod
    def hair_boundary(yaw: float) -> float:
        """Hairline pitch: forehead (a hint of a widow's peak), temples, long sideburns, over the ears, nape."""
        return periodic_interp([(0, 32), (14, 36), (34, 34), (48, 28), (58, 19), (64, 12), (68, -33), (79, -38), (84, -18), (90, -1),
                                (104, -3), (118, -24), (180, -36)], abs(yaw))

    def hair_thick(self, yaw: float, pitch: float, f: float) -> float:
        """Hair volume over the scalp: the pompadour is a big roll rising up from the front hairline (steep in
        front, sloping back over the crown), the sides are slicked back close to the head."""
        d = dirv(yaw, pitch)
        edge = sstep(f / 0.09)
        u = math.degrees(math.atan2(d.z, -d.y))  # 0 straight ahead, 90 straight up, 180 straight back
        v = math.degrees(math.asin(clamp(d.x, -1.0, 1.0)))
        du = u - 62.0
        # the roll is swept a little to his right, so the quiff rises higher over his right brow
        roll = 0.21 * math.exp(-(du / (13.5 if du < 0 else 36.0)) ** 2) * math.exp(-((v + 8.0) / 37.0) ** 2)
        top = 0.035 * max(0.0, d.z) ** 2
        back = 0.02 * max(0.0, d.y) * max(0.0, 0.4 + d.z)
        ridge = 0.5 + 0.5 * math.cos(math.radians(yaw) * 15 + 0.4)
        rfade = 1.0 - sstep((pitch - 70.0) / 16.0)
        return 0.013 + edge * (roll + top + back + 0.012 * ridge * rfade)

    def hair_f(self, yaw: float, pitch: float) -> float:
        b = self.hair_boundary(yaw)
        return clamp((pitch - b) / (89.0 - b)) ** (1 / 1.35)

    def hair_outer(self, yaw: float, pitch: float, extra: float = 0.0):
        hs = self.hair_shape()
        pos, n = hs.point(yaw, pitch, self.hair_thick(yaw, pitch, self.hair_f(yaw, pitch)) + extra)
        return Vector(self.taper([tuple(pos)])[0]), n

    def hair(self):
        mm = self.mat
        hs = self.hair_shape()
        v, f, tp = hair_shell(hs, self.hair_boundary, self.hair_thick, 168, 26)
        self.add('hair', (self.taper(v), f), mm['hair'], 'head', tip=tp)
        acc = MeshAcc()
        # strands combed up over the roll and back over the crown
        for k, y0 in enumerate((-34, -19, -5, 9, 23, 37)):
            pts, nrms = [], []
            for i in range(12):
                t = i / 11
                yaw = y0 * (1 - 0.5 * t) + 3 * t
                pitch = 35 + (88 - 35) * t ** 0.85
                p, n = self.hair_outer(yaw, pitch, 0.002 + 0.006 * math.sin(math.pi * t))
                pts.append(p)
                nrms.append(n)
            w0 = 0.062 - 0.008 * abs(k - 2.5) / 2.5
            mesh = flat_sweep(pts, lambda t, w0=w0: w0 * (1 - 0.6 * t) + 0.004, lambda t, nrms=nrms: nrms[min(11, int(round(t * 11)))], 0.32, 12)
            acc.add(mesh, flat_tip(12, 12, len(mesh[0]), 0.5, 0.05))
        # the loose lock falling from the roll onto his forehead (his right)
        p0, n0 = self.hair_outer(-10, 50, -0.035)
        head = HeadShape(*self.HEAD[:3], center=(0, 0, self.HEAD[3]))
        p2, n2 = head.point(-19, 25, 0.03)
        p1 = (p0 + p2) * 0.5 + Vector((0.0, -0.08, 0.02))
        pts = curve3(p0, p1, p2, 10)
        tip_dir = (pts[-1] - pts[-2]).normalized()
        pts.append(pts[-1] + tip_dir * 0.02 + Vector((-0.012, -0.012, 0.012)))
        nv = Vector((0.1, -1.0, 0.25)).normalized()
        mesh = flat_sweep(pts, lambda t: 0.036 * (1 - t) ** 0.8 + 0.005, nv, 0.45, 12)
        acc.add(mesh, flat_tip(len(pts), 12, len(mesh[0]), 0.2, 1.0))
        # a smaller second curl beside it
        p0, n0 = self.hair_outer(-1, 52, -0.035)
        p2, n2 = head.point(-7, 28, 0.03)
        p1 = (p0 + p2) * 0.5 + Vector((0.0, -0.07, 0.02))
        pts = curve3(p0, p1, p2, 8)
        mesh = flat_sweep(pts, lambda t: 0.026 * (1 - t) ** 0.8 + 0.004, nv, 0.45, 12)
        acc.add(mesh, flat_tip(len(pts), 12, len(mesh[0]), 0.2, 1.0))
        self.add('locks', acc.mesh, mm['hair'], 'head', tip=acc.tip)

    # --- sunglasses ---------------------------------------------------------------------------------
    @staticmethod
    def lens_outline(side: int, n: int = 40):
        """Aviator lens (x out towards the temple for side +1): flat top, rounded, drooping to the inside."""
        W, H, pw = 0.128, 0.112, 2.7
        out = []
        for k in range(n):
            a = k / n * math.tau
            c, s = math.cos(a), math.sin(a)
            x = W * math.copysign(abs(c) ** (2 / pw), c)
            z = H * math.copysign(abs(s) ** (2 / pw), s)
            if s < 0:
                z *= 1.0 + 0.26 * (-s) * (0.5 - 0.5 * c)
                x *= 1.0 - 0.12 * (-s) * (0.6 + 0.4 * c)
            else:
                z = H * 0.82 * math.copysign(abs(s) ** (2 / 3.4), s)
            out.append((x * side, z))
        return out

    def glasses(self):
        mm = self.mat
        hx, hy, hz, hc = self.HEAD
        gy, gp, L = self.GLASS
        gs = HeadShape(hx + L, hy + L, hz + L, center=(0, 0, hc))
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        # knocked askew when he's seeing stars
        ex = self.pose.get('extra', {})
        roll, drop = 0.0, 0.0
        if ex.get('stars') is not None:
            roll = 9.0 + 5.0 * math.sin(ex['stars'])
            drop = 3.0
        tilt = T(0, 0, hc) @ R(0, roll, 0) @ T(0, 0, -hc)

        def conform(fr, pts):
            sp, sn = gs.surface(fr.to_translation() - gs.c)
            return [Vector(q) for q in gs.conform([fr @ Vector(p) for p in pts], sp, sn)]

        def place(pts):
            return [tilt @ p for p in pts]
        acc_f = MeshAcc()
        corners = {}
        for side in (1, -1):
            fr = gs.frame(gy * side, gp - drop, 0.0)
            ol = self.lens_outline(side)
            lv, lf = ring_mesh(ol, 4)
            lv = place(conform(fr, lv))
            self.add('lens', ([tuple(v) for v in lv], lf), mm['lens'], 'head')
            rim = [Vector((x, -0.004, z)) for (x, z) in ol]
            rim = place(conform(fr, rim + rim[:1]))
            acc_f.add(sweep(rim, 0.0135, 8, cap0=False, cap1=False))
            # reference points: inner top, outer top
            xs = [p[0] * side for p in ol]
            i_in = min(range(len(ol)), key=lambda i: xs[i] - 0.4 * ol[i][1])
            i_out = max(range(len(ol)), key=lambda i: xs[i] + 0.9 * ol[i][1])
            corners[side] = (rim[i_in], rim[i_out], fr)
            # glints: two short diagonal streaks on the upper outer part of the lens
            for q, (x0, z0, ln, w) in enumerate(((0.04, 0.052, 0.056, 0.012), (0.068, 0.03, 0.03, 0.008))):
                g = [Vector(((x0 + ln * 0.5 * u) * side, -0.006, z0 - ln * 0.6 * u)) for u in (-1.0, -0.5, 0.0, 0.5, 1.0)]
                g = place(conform(fr, g))
                self.add(f'glint{q}', flat_sweep(g, lambda t, w=w: w * (0.5 + 0.5 * math.sin(math.pi * t)), (g[2] - Vector((0, 0, hc))).normalized(),
                                                  0.25, 8), mm['glint'], 'head')
        # double bridge: a straight bar across the top and a curved bridge over the nose
        a, b = corners[-1][0], corners[1][0]
        top = [a.lerp(b, i / 10) for i in range(11)]
        top = [p + (p - Vector((0, 0, hc))).normalized() * 0.006 * math.sin(math.pi * i / 10) for i, p in enumerate(top)]
        acc_f.add(sweep(top, 0.011, 8))
        lo = []
        for i in range(11):
            u = i / 10
            yaw = -12 + 24 * u
            pos, _n = gs.point(yaw, gp - drop - 3.0 + 3.5 * math.sin(math.pi * u), 0.0)
            lo.append(tilt @ pos)
        acc_f.add(sweep(lo, 0.008, 8))
        # temples back to the ears (they tuck into the hair over the ears)
        for side in (1, -1):
            o = corners[side][1]
            pts = [o]
            for i in range(1, 9):
                u = i / 8
                pos, _n = HeadShape(hx + L * (1 - u) + 0.012, hy + L * (1 - u) + 0.012, hz + L * (1 - u) + 0.012, center=(0, 0, hc)).point(
                    side * (52 + 42 * u), 6 - 5 * u - drop * (1 - u), 0.0)
                pts.append(tilt @ pos)
            acc_f.add(sweep(pts, 0.0105, 8))
            acc_f.add(ellipsoid(0.02, 0.016, 0.016, 10, 6, center=tuple(o)))
        self.add('frame', acc_f.mesh, mm['gold'], 'head')

    # --- collar -------------------------------------------------------------------------------------
    def collar(self):
        mm = self.mat
        Cm = self.J('chest')
        hx, hy, hz, hc = self.HEAD
        Hi = self.J('head').inverted()

        def in_head(p):
            q = Hi @ p
            fz = max(0.0, (hc - q.z) / hz)
            qx = q.x / (1.0 - self.TAPER * fz ** 1.6)
            qy = q.y + 0.02 * fz * fz
            return (qx / (hx + 0.04)) ** 2 + ((qy - 0.012) / (hy + 0.055)) ** 2 + ((q.z - hc) / (hz + 0.03)) ** 2 < 1.0

        arms = []
        for s_ in ('L', 'R'):
            a, b = self.P('shoulder' + s_), self.P('elbow' + s_)
            arms.append((a.lerp(b, 0.28), b + (b - a).normalized() * 0.05, 0.1))

        OPEN = 34.0
        N, ROWS, NS = 48, 10, 20
        Mx = Cm.to_3x3()

        def pt(a, r, z):
            return Vector((math.cos(a) * r, math.sin(a) * r * 0.96 + 0.02, z))

        angs, hfs, hmax, rprof = [], [], [], []
        for i in range(N):
            a = -90.0 + OPEN + (360.0 - 2 * OPEN) * i / (N - 1)
            af = abs((a + 90.0 + 180.0) % 360.0 - 180.0)  # degrees from the front
            hf = 0.5 + 0.5 * sstep((af - OPEN) / 56.0)
            ar = math.radians(a)
            z0, z1 = 0.125, 0.125 + 0.3 * hf
            prof, h, r = [], 1.0, 0.0
            for s_ in range(NS + 1):
                u = s_ / NS
                z = z0 + (z1 - z0) * u
                r = max(r, 0.14 + 0.2 * u ** 1.6)
                if s_ >= 3:
                    # lean out round the head (and its hair) wherever it would come through
                    k = 0
                    while k < 16 and in_head(Cm @ pt(ar, r, z)):
                        r += 0.01
                        k += 1
                    if k >= 16 or any(seg_dist(Cm @ pt(ar, r, z), aa, bb) < rr for aa, bb, rr in arms):
                        h = max(0.3, (s_ - 1) / NS)
                        prof += [prof[-1]] * (NS + 1 - len(prof))
                        break
                prof.append(r)
            angs.append(ar)
            hfs.append(hf)
            hmax.append(h)
            rprof.append(prof)
        for _ in range(5):
            hmax = [min(hmax[i], 0.25 * hmax[max(0, i - 1)] + 0.5 * hmax[i] + 0.25 * hmax[min(N - 1, i + 1)]) for i in range(N)]
        for _ in range(3):
            rprof = [[max(rprof[i][s_], 0.25 * rprof[max(0, i - 1)][s_] + 0.5 * rprof[i][s_] + 0.25 * rprof[min(N - 1, i + 1)][s_])
                      for s_ in range(NS + 1)] for i in range(N)]

        def colpt(i, u):
            x = u * NS
            k = min(NS - 1, int(x))
            r = rprof[i][k] + (rprof[i][k + 1] - rprof[i][k]) * (x - k)
            z0, z1 = 0.125, 0.125 + 0.3 * hfs[i]
            return Cm @ pt(angs[i], r, z0 + (z1 - z0) * u)
        grid = [[colpt(i, hmax[i] * j / ROWS) for j in range(ROWS + 1)] for i in range(N)]
        verts, faces, nrm = cloth_mesh(grid, 0.022)
        self.add('collar', (verts, faces), mm['suit'], None)
        # gold piping along the top and front edges
        self.add('collartrim', sweep([grid[i][-1] for i in range(N)], 0.0125, 8), mm['gold'], None)
        for i in (0, N - 1):
            self.add('collarfront', sweep(grid[i], 0.011, 8), mm['gold'], None)
        # a row of studs round the collar, a rhinestone between each pair of gold ones
        for i in range(2, N - 2, 2):
            j = int(round(ROWS * 0.58))
            p = grid[i][j]
            n = nrm[i][j]
            if n.dot(Mx @ Vector((math.cos(angs[i]), math.sin(angs[i]), 0.0))) < 0:
                n = -n
            self.stud(orient(p + n * 0.013, n), (i // 2) % 2 == 0, 1.05)

    # --- face (a copy of Hero.face with heavy-lidded eyes and the lip curl) ----------------------------
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
                    off = Vector((lx * ew * 0.22 - 0.1 * ew * side, -ed * 0.9, lz * eh * 0.2 - eh * 0.06))
                    self.feat(f'iris{name}', ellipsoid(ir, ed * 0.22, ir * 1.1, 20, 10, center=off), irm, joint, head, fr)
                    pr = ir * 0.58
                    self.feat(f'pupil{name}', ellipsoid(pr, ed * 0.2, pr * 1.12, 16, 8, center=off + Vector((0.0, -ed * 0.12, 0.0))), dark, joint, head, fr)
                    h1 = off + Vector((-ir * 0.38, -ed * 0.3, ir * 0.42))
                    self.feat(f'shine{name}', ellipsoid(ir * 0.34, 0.004, ir * 0.36, 10, 6, center=h1), shine, joint, head, fr)
                    h2 = off + Vector((ir * 0.4, -ed * 0.3, -ir * 0.4))
                    self.feat(f'shine2{name}', ellipsoid(ir * 0.13, 0.004, ir * 0.13, 8, 5, center=h2), shine, joint, head, fr)
                lash_pts = [Vector((math.sin(a) * ew * 1.02, -ed * 0.55, math.cos(a) * eh * 1.0)) for a in [(-1 + 2 * i / 12) * 1.25 for i in range(13)]]
                self.feat(f'lash{name}', sweep(lash_pts, lambda t: 0.007 + 0.006 * math.sin(math.pi * t), 6), lash, joint, head, fr)
                # heavy upper lids: his relaxed, half-hooded look
                lid = {'sad': 0.42, 'determined': 0.4, 'half': 0.5, 'open': 0.26}.get(kind)
                if lid and lid_col:
                    lidm = mt.skin(f'lid_{lid_col}', lid_col)
                    tilt = {'sad': -16 * side, 'determined': 14 * side, 'open': -4 * side}.get(kind, 0)
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
            roll = {'neutral': -4, 'up': -4, 'worried': 16, 'angry': -18, 'determined': -12, 'sad': 14}.get(brows, 0) * side
            # the brow over the curled lip rides a little higher
            if side > 0 and brows in ('neutral', 'up') and mouth in ('smile', 'grin'):
                b_pitch += 2.5
            bf = head.frame(yaw * 1.02, b_pitch, 0.004, roll)
            bpts = arc_points(ew * 1.55, -0.014, 8)
            self.feat(f'brow{name}', sweep(bpts, lambda t: 0.015 + 0.008 * math.sin(math.pi * t ** 0.9), 8), browm, joint, head, bf)
        skin_m = mt.skin(f'skin_{skin}', skin) if skin else None
        if nose and skin_m:
            nf = head.frame(0, eye_pitch - 14, -0.004)
            self.feat('nose', ellipsoid(0.03, 0.027, 0.025, 14, 8), skin_m, joint, head, nf)
        mf = head.frame(0, mouth_pitch, 0.0)
        w = 0.12 * mouth_w
        if mouth == 'smile':
            # the lip curl: a relaxed smile that hooks up at his left corner, a glint of teeth under it
            pts = []
            for i in range(15):
                u = i / 14 * 2 - 1
                pts.append(Vector((u * w * 0.55, -0.006, -0.012 * (1 - u * u) + 0.034 * max(0.0, u) ** 2.3 - 0.004 * u)))
            self.feat('mouth', sweep(pts, lambda t: 0.0085 + 0.0045 * math.sin(math.pi * t), 8), mouth_m, joint, head, mf)
            cm = mf @ T(w * 0.36, 0.0, 0.008) @ R(0, -30, 0)
            self.feat('curl', ellipsoid(0.021, 0.012, 0.0105, 12, 6, center=(0, -0.003, 0)), mouth_m, joint, head, cm)
            self.feat('curlteeth', ellipsoid(0.015, 0.008, 0.0048, 10, 5, center=(0, -0.011, 0.0025)), teeth, joint, head, cm)
        elif mouth == 'grin':
            # a lopsided open grin, higher on his left
            gw, gh = 0.15, 0.052

            def bent(vs, dy=0.0):
                return [(x, y + dy, z + 0.3 * gh * (x / (gw / 2)) + 0.35 * gh * (x / (gw / 2)) ** 2) for (x, y, z) in vs]
            mv, mfc = ellipsoid(gw / 2, 0.016, gh, 26, 12, zmax=0.25)
            self.feat('mouth', (bent(mv), mfc), mouth_m, joint, head, mf @ T(0.006, 0.002, 0.0))
            tv, tfc = ellipsoid(gw / 2 * 0.9, 0.012, gh, 26, 6, zmin=-0.3, zmax=0.22)
            self.feat('teeth', (bent(tv, -0.006), tfc), teeth, joint, head, mf @ T(0.006, 0.002, 0.0))
            self.feat('tongue', ellipsoid(gw * 0.22, 0.01, gh * 0.3, 14, 8, center=(0.008, -0.008, -gh * 0.62)), tongue, joint, head, mf)
        elif mouth in ('open', 'laugh'):
            hh = {'open': 0.06, 'laugh': 0.078}[mouth]
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
            self.feat('mouth', sweep([Vector((-w * 0.32, -0.006, 0)), Vector((w * 0.32, -0.006, 0.006))], 0.009, 8), mouth_m, joint, head, mf)
        elif mouth == 'wobble':
            pts = [Vector(((i / 12 - 0.5) * w * 0.9, -0.006, math.sin(i / 12 * math.tau * 1.5) * 0.012)) for i in range(13)]
            self.feat('mouth', sweep(pts, 0.009, 8), mouth_m, joint, head, mf)
        elif mouth == 'smirk':
            pts = [Vector(((i / 12 - 0.5) * w * 0.8, -0.006, 0.02 * (i / 12) ** 2)) for i in range(13)]
            self.feat('mouth', sweep(pts, 0.009, 8), mouth_m, joint, head, mf)
