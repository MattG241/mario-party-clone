"""Spider-Man: a fan-made chibi version for the private party game, built on the shared Hero structure (see char_models.py).

Full mask and suit: red head, red chest/back panel with a red waist band, red shoulders and outer arms, red gloves
and boots; blue side panels, blue legs and inner arms. Thin black web lines run over every red area from
procedural shaders: on the mask, spokes radiate from a hub between the eyes and cross concentric, sagging rings
(meeting again at the back of the head); on the torso the same web radiates from the chest emblem; the arms,
gloves and boots carry a web grid. Large white teardrop lenses with thick black borders change shape with the
expression (narrow when determined or sad, squeezed arcs when happy, closed or winking, wide when surprised).
A black spider emblem sits on the chest.

Web textures must stick to the suit in every pose. Rigid parts use object coordinates in their joint frame. The
arm and boot tubes are rebuilt through the posed joints for every pose, so they carry their own coordinates: the
'tip' attribute holds the fraction along the limb and the angle around it comes from the object-space normal's
component along the joint's bend axis (the elbow and knee bend about their local X, so that component does not
change as the limb bends).
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import HeadShape, R, curve3, ellipsoid, flat_sweep, polyline_segment, superellipsoid, sweep
from char_models import DEFAULT_FACE, Hero, hand_mitten


# ------------------------------------------------------------------------------------------
# Small helpers
def clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return max(a, min(b, x))


def sstep(x: float) -> float:
    x = clamp(x)
    return x * x * (3.0 - 2.0 * x)


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


def sweep_tip(rings: int, sides: int, nverts: int, t0: float, t1: float, cap0: bool, cap1: bool):
    """'tip' values (t0..t1 along the rings) for a char_rig.sweep mesh with 4-step caps."""
    tip = []
    for i in range(rings):
        tip += [t0 + (t1 - t0) * i / max(1, rings - 1)] * sides
    cap_n = 3 * sides + 1
    if cap1:
        tip += [t1] * cap_n
    if cap0:
        tip += [t0] * cap_n
    assert len(tip) == nverts, (len(tip), nverts)
    return tip


def spider_lens(kind: str):
    """A teardrop lens for the character's left eye: x runs from the inner end (-1, the point, low by the nose)
    to the outer end (+1, round and high). Returns (top, bot) lists of (x, z)."""
    n = 30
    top, bot = [], []
    wide = kind in ('wide', 'dizzy')
    for i in range(n):
        u = (1 - math.cos(math.pi * i / (n - 1))) / 2
        x = 2 * u - 1
        hh = (0.94 if wide else 0.84) * (u + 0.03) ** 0.6 * math.sqrt(max(0.0, 1 - u ** 5.0))
        c = -0.22 + 0.3 * u - 0.04 * math.sin(math.pi * u) + (0.03 if wide else 0.0)
        t, b = c + hh, c - hh
        if kind == 'determined':
            t = min(t, 0.02 + 0.36 * x)
        elif kind == 'sad':
            t = min(t, 0.16 - 0.3 * x)
        elif kind == 'half':
            t = min(t, -0.05 + 0.08 * x)
        elif kind == 'happy':
            # squeezed into an arc: the lower edge pushed up under the upper one
            t = c + hh * 0.9 + 0.06 * math.sin(math.pi * u)
            b = max(b, t - 0.36 * math.sin(math.pi * min(1.0, u * 1.04)) ** 0.5 - 0.015)
        t = max(t, b)
        sc = 1.1 if wide else 1.0
        top.append((x * sc, t * sc))
        bot.append((x * sc, b * sc))
    return top, bot


# ------------------------------------------------------------------------------------------
# Shader helpers (lib.NT)
def vdot(m, vec, const):
    n = m.node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
    m.link(vec, n.inputs[0])
    n.inputs[1].default_value = tuple(const)
    return n.outputs['Value']


def vsub(m, vec, const):
    n = m.node('ShaderNodeVectorMath', operation='SUBTRACT')
    m.link(vec, n.inputs[0])
    n.inputs[1].default_value = tuple(const)
    return n.outputs['Vector']


def tri(m, x):
    """Distance from x to the nearest whole number (0 .. 0.5)."""
    return m.math('ABSOLUTE', m.math('SUBTRACT', m.math('FRACT', m.math('ADD', x, 0.5)), 0.5))


def bowed(m, ph, sag: float):
    """4·ph·(1 - ph)·sag: how far a ring sags between two spokes (ph = position between them)."""
    return m.math('MULTIPLY', m.math('MULTIPLY', ph, m.math('SUBTRACT', 1.0, ph)), 4.0 * sag)


def thread(m, d, width: float):
    """1 on a web thread (distance d from its centre line, world units), 0 off it."""
    return m.maprange(d, width, width * 0.35)


def globe_web(m, obj, center, axis, e1, spokes: int, step: float, width: float, radius: float, sag: float = 0.3, hub: float = 0.0):
    """Spokes radiating from the pole `axis` (through `center`) and concentric rings around it that sag towards
    the hub between the spokes; they meet again at the opposite pole."""
    axis = Vector(axis).normalized()
    e1 = Vector(e1)
    e1 = (e1 - axis * e1.dot(axis)).normalized()
    e2 = axis.cross(e1)
    v = vsub(m, obj, center)
    va, v1, v2 = vdot(m, v, axis), vdot(m, v, e1), vdot(m, v, e2)
    rr = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', v1, v1), m.math('MULTIPLY', v2, v2)))
    psi = m.math('ARCTAN2', rr, va)
    theta = m.math('ARCTAN2', v2, v1)
    sp = m.math('MULTIPLY', theta, spokes / math.tau)
    d_sp = m.math('MULTIPLY', m.math('MULTIPLY', tri(m, sp), math.tau / spokes * radius), m.math('SINE', psi))
    if hub:
        d_sp = m.math('ADD', d_sp, m.maprange(psi, hub, hub * 0.5, 0.0, 1.0))
    q = m.math('ADD', m.math('DIVIDE', psi, step), bowed(m, m.math('FRACT', sp), sag))
    d_rg = m.math('MULTIPLY', tri(m, q), step * radius)
    return thread(m, m.math('MINIMUM', d_sp, d_rg), width)


def limb_web(m, side: int, n_long: int, rings: float, width: float, r_tube: float, length: float, sag: float = 0.3):
    """Web grid on a limb tube: lines along the limb at fixed angles from the joint's X axis (from the object-space
    normal) and sagging rings at fixed fractions along it ('tip'). Returns (line mask, normal·X·side)."""
    tc = m.node('ShaderNodeTexCoord')
    nx = vdot(m, tc.outputs['Normal'], (float(side), 0.0, 0.0))
    a = m.math('ARCCOSINE', nx)
    la = m.math('MULTIPLY', a, n_long / math.pi)
    d_l = m.math('MULTIPLY', tri(m, la), math.pi / n_long * r_tube)
    at = m.node('ShaderNodeAttribute')
    at.attribute_name = 'tip'
    t = at.outputs['Fac']
    q = m.math('ADD', m.math('MULTIPLY', t, rings), bowed(m, m.math('FRACT', la), sag))
    d_r = m.math('MULTIPLY', tri(m, q), length / rings)
    return thread(m, m.math('MINIMUM', d_l, d_r), width), nx, t


def cyl_web(m, obj, n_long: int, step_z: float, width: float, r: float, sag: float = 0.3):
    """Web grid around a part's local Z axis (gloves)."""
    sp = m.sep(obj)
    th = m.math('ARCTAN2', sp[1], sp[0])
    la = m.math('MULTIPLY', th, n_long / math.tau)
    d_l = m.math('MULTIPLY', tri(m, la), math.tau / n_long * r)
    q = m.math('ADD', m.math('DIVIDE', sp[2], step_z), bowed(m, m.math('FRACT', la), sag))
    d_r = m.math('MULTIPLY', tri(m, q), step_z)
    return thread(m, m.math('MINIMUM', d_l, d_r), width)


# ------------------------------------------------------------------------------------------
class Spiderman(Hero):
    """Spider-Man (fan-made chibi): red and blue suit with procedural webbing, teardrop lenses, chest spider."""

    key = 'spiderman'
    ankle_h = 0.15
    hip_h = 0.64
    spine = 0.08
    chest = 0.19
    neck = 0.13
    head_up = 0.04
    shoulder = (0.22, 0.0, 0.11)
    upper_arm = 0.215
    forearm = 0.19
    hip_w = 0.105
    thigh = 0.22
    shin = 0.23
    sit_h = 0.17

    C = dict(red='#d42333', red_d='#a8182a', blue='#2d51b3', line='#1c0c12', lens='#f7f9ff', rim='#141418')

    HEAD = (0.42, 0.39, 0.41, 0.42)  # rx, ry, rz, centre height above the head joint
    TAPER = 0.13
    EYE = (32.0, 1.0)  # lens yaw / pitch
    EZ = 0.0  # chest emblem height (chest frame)
    WEB_W = 0.0052  # half-width of a web thread (world units)

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.1

    # --- torso shape (chest frame) ---------------------------------------------------------------
    Z0, Z1 = -0.36, 0.2
    SQ = 0.8

    def torso_r(self, z: float) -> float:
        if z <= 0.06:
            return 0.198 + 0.026 * sstep((z - self.Z0) / (0.06 - self.Z0))
        return 0.224 * math.sqrt(max(0.0, 1.0 - ((z - 0.06) / 0.158) ** 2))

    def wrap_torso(self, verts, lift: float):
        out = []
        for (x, y, z) in verts:
            rx = max(0.05, self.torso_r(z))
            ry = rx * self.SQ
            rho = rx * rx / ry
            phi = -math.pi / 2 + x / rho
            sx, sy = rx * math.cos(phi), ry * math.sin(phi)
            nrm = Vector((math.cos(phi) / rx, math.sin(phi) / ry, 0.0)).normalized()
            h = lift - y
            out.append((sx + nrm.x * h, sy + nrm.y * h, z))
        return out

    # --- head helpers ------------------------------------------------------------------------------
    def taper(self, verts):
        hx, hy, hz, hc = self.HEAD
        out = []
        for (x, y, z) in verts:
            f = max(0.0, (hc - z) / hz)
            out.append((x * (1 - self.TAPER * f ** 1.5), y - 0.03 * f * f, z))
        return out

    def hadd(self, name, mesh, mat):
        self.add(name, (self.taper(mesh[0]), mesh[1]), mat, 'head')

    def hfeat(self, name, mesh, mat, hs: HeadShape, fr: Matrix):
        verts, faces = mesh
        sp, sn = hs.surface(fr.to_translation() - hs.c)
        vj = [fr @ Vector(v) for v in verts]
        self.hadd(name, (hs.conform(vj, sp, sn), faces), mat)

    # --- materials -----------------------------------------------------------------------------------
    def suit_bsdf(self, m, color, web, rough=0.5):
        bump = m.bump(web, 0.28, 0.008)
        m.bsdf(color, rough, normal=bump, sheen=0.4, spec=0.38, coat=0.08)

    def mask_mat(self):
        c = self.C
        hx, hy, hz, hc = self.HEAD
        p = math.radians(self.EYE[1] - 5.0)

        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            web = globe_web(m, obj, (0.0, 0.0, hc), (0.0, -math.cos(p), math.sin(p)), (1.0, 0.0, 0.0), 14, 0.25, self.WEB_W, 0.41, 0.32, hub=0.07)
            self.suit_bsdf(m, m.mix(web, col(c['red']), col(c['line'])), web)
            return m.mat
        return self.m.get('spd_mask', make)

    def torso_mat(self):
        c = self.C

        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            sp = m.sep(obj)
            ax = m.math('ABSOLUTE', m.math('ARCTAN2', sp[1], sp[0]))
            side = m.math('MINIMUM', ax, m.math('SUBTRACT', math.pi, ax))  # angle from the nearest flank
            hw = m.maprange(sp[2], 0.07, -0.25, -0.08, 0.92)
            blue = m.maprange(m.math('SUBTRACT', side, hw), 0.022, -0.012)
            blue = m.math('MULTIPLY', blue, m.maprange(sp[2], -0.262, -0.248))  # red waist band below
            web = globe_web(m, obj, (0.0, 0.0, self.EZ), (0.0, -1.0, 0.0), (1.0, 0.0, 0.0), 16, 0.235, self.WEB_W, 0.2, 0.3, hub=0.1)
            web = m.math('MULTIPLY', web, m.math('SUBTRACT', 1.0, blue))
            red = m.mix(web, col(c['red']), col(c['line']))
            self.suit_bsdf(m, m.mix(blue, red, col(c['blue'])), web)
            return m.mat
        return self.m.get('spd_torso', make)

    def arm_mat(self, side: int):
        c = self.C

        def make(n):
            m = lib.NT(n)
            web, nx, t = limb_web(m, side, 5, 7.0, self.WEB_W, 0.062, 0.42)
            red = m.math('MAXIMUM', m.maprange(nx, -0.22, -0.1), m.maprange(t, 0.805, 0.82))
            web = m.math('MULTIPLY', web, red)
            colr = m.mix(red, col(c['blue']), m.mix(web, col(c['red']), col(c['line'])))
            self.suit_bsdf(m, colr, web)
            return m.mat
        return self.m.get(f'spd_arm_{side}', make)

    def bootleg_mat(self):
        c = self.C

        def make(n):
            m = lib.NT(n)
            web, _nx, _t = limb_web(m, 1, 5, 9.0, self.WEB_W, 0.075, 0.45)
            self.suit_bsdf(m, m.mix(web, col(c['red']), col(c['line'])), web)
            return m.mat
        return self.m.get('spd_bootleg', make)

    def glove_mat(self):
        c = self.C

        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            web = cyl_web(m, obj, 8, 0.052, self.WEB_W, 0.075)
            self.suit_bsdf(m, m.mix(web, col(c['red']), col(c['line'])), web)
            return m.mat
        return self.m.get('spd_glove', make)

    def boot_mat(self):
        c = self.C

        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            web = globe_web(m, obj, (0.0, -0.04, -0.06), (0.0, -1.0, -0.2), (1.0, 0.0, 0.0), 12, 0.36, self.WEB_W, 0.12, 0.3)
            self.suit_bsdf(m, m.mix(web, col(c['red']), col(c['line'])), web)
            return m.mat
        return self.m.get('spd_boot', make)

    # --- building -------------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            mask=self.mask_mat(), torso=self.torso_mat(), glove=self.glove_mat(), boot=self.boot_mat(), bootleg=self.bootleg_mat(),
            blue=mt.cloth('spd_blue', c['blue'], 0.52, 0.45, 0.04, 90),
            red=mt.cloth('spd_red', c['red'], 0.5, 0.4),
            sole=mt.cloth('spd_sole', c['red_d'], 0.55, 0.2),
            line=mt.glossy('spd_line', c['line'], 0.4, 0.3),
            lens=mt.emit('spd_lens', c['lens'], 0.45),
            rim=mt.glossy('spd_rim', c['rim'], 0.3, 0.6),
        )
        self.torso()
        self.legs()
        self.arms()
        self.head_parts()

    def web_limb(self, name, a, b, c, radius, mat, t0, t1, frame_joint, sides=16, n=14, cap0=True, cap1=True, extend=0.0):
        """Like Hero.limb, but the tube is stored in `frame_joint`'s frame and carries its limb fraction in 'tip'."""
        pa, pb, pc = self.P(a), self.P(b), self.P(c)
        if extend:
            pc = pc + (pc - pb).normalized() * extend
        seg = polyline_segment(curve3(pa, pb, pc, 24), t0, t1, n)
        verts, faces = sweep(seg, radius, sides, cap0=cap0, cap1=cap1)
        tip = sweep_tip(len(seg), sides, len(verts), t0, t1, cap0, cap1)
        mi = self.J(frame_joint).inverted()
        self.add(name, ([tuple(mi @ Vector(v)) for v in verts], faces), mat, frame_joint, tip=tip)

    def torso(self):
        mm = self.mat
        prof = [(self.torso_r(self.Z0 + (self.Z1 - self.Z0) * i / 24), self.Z0 + (self.Z1 - self.Z0) * i / 24) for i in range(25)]
        self.add('torso', lib.lathe(prof, 36, cap_bottom=False, cap_top=True, squash_y=self.SQ), mm['torso'], 'chest')
        self.add('neck', sweep([Vector((0, 0, -0.03)), Vector((0, 0, 0.1))], 0.1, 16), mm['red'], 'neck')
        self.add('pelvis', superellipsoid(0.19, 0.148, 0.15, 2.4, 28, 16, center=(0, 0.006, -0.065)), mm['blue'], 'hips')
        self.spider_emblem()

    def spider_emblem(self):
        """A black spider on the chest: two body segments, a small head and four bent legs a side."""
        mm = self.mat
        ez = self.EZ
        acc = MeshAcc()
        for (cx, cz, rx, rz) in ((0.0, 0.012, 0.021, 0.028), (0.0, -0.034, 0.026, 0.042), (0.0, 0.046, 0.014, 0.014)):
            v, f = ellipsoid(rx, 0.012, rz, 16, 10, center=(cx, 0.0, ez + cz))
            acc.add((self.wrap_torso(v, 0.0), f))
        legs = [[(0.012, 0.028), (0.05, 0.062), (0.064, 0.118)], [(0.016, 0.016), (0.072, 0.036), (0.1, 0.08)],
                [(0.016, -0.002), (0.072, -0.018), (0.1, -0.064)], [(0.012, -0.014), (0.05, -0.05), (0.064, -0.112)]]
        for sd in (1, -1):
            for leg in legs:
                pts = []
                for (x0, z0), (x1, z1) in zip(leg, leg[1:]):
                    for k in range(6):
                        t = k / 6
                        pts.append((sd * (x0 + (x1 - x0) * t), 0.0, ez + z0 + (z1 - z0) * t))
                pts.append((sd * leg[-1][0], 0.0, ez + leg[-1][1]))
                wp = [Vector(p) for p in self.wrap_torso(pts, 0.004)]
                acc.add(sweep(wp, lambda t: 0.0078 - 0.0028 * t, 8))
        self.add('spider', acc.mesh, mm['line'], 'chest')

    def legs(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.086 - 0.014 * t + 0.006 * math.sin(math.pi * clamp((t - 0.4) / 0.4)), mm['blue'],
                      0.0, 0.8, 14, 14)
            self.web_limb('bootleg' + s_, hip, kn, an, lambda t: 0.078 + 0.006 * sstep(1 - t * 4.0), mm['bootleg'], 0.64, 1.0, hip, 18, 8,
                          cap0=True, cap1=False)
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('boot' + s_, superellipsoid(0.108, 0.168, 0.098, 2.5, 24, 14, center=(0, -0.05, -0.05)), mm['boot'], None, fm)
            self.add('toe' + s_, ellipsoid(0.1, 0.095, 0.07, 18, 10, center=(0, -0.15, -0.08)), mm['boot'], None, fm)
            self.add('sole' + s_, superellipsoid(0.112, 0.186, 0.026, 3.0, 22, 8, center=(0, -0.062, -0.124)), mm['sole'], None, fm)

    def arms(self):
        mm = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.web_limb('arm' + s_, sh, el, wr, lambda t: 0.068 - 0.012 * t + 0.008 * sstep(1 - t * 5.0), self.arm_mat(sd), 0.0, 1.0, sh, 16, 18,
                          extend=0.02)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.26):
                self.add('glove' + nm + s_, mesh, mm['glove'], None, wm)

    # --- head ----------------------------------------------------------------------------------------------
    def head_parts(self):
        hx, hy, hz, hc = self.HEAD
        self.hadd('head', ellipsoid(hx, hy, hz, 44, 30, center=(0, 0, hc)), self.mat['mask'])
        self.spider_face(HeadShape(hx, hy, hz, center=(0, 0, hc)))

    def spider_face(self, head: HeadShape):
        mm = self.mat
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        eyes, brows = f['eyes'], f['brows']
        ey, ep = self.EYE
        ew, eh = 0.155, 0.18
        for side in (1, -1):
            kind = eyes
            if eyes == 'wink':
                kind = 'open' if side > 0 else 'happy'
            if kind == 'open' and brows in ('angry', 'determined'):
                kind = 'determined'
            name = 'L' if side > 0 else 'R'
            fr = head.frame(ey * side, ep, 0.0)
            if kind == 'closed':
                pts = []
                for i in range(15):
                    u = i / 14
                    x = 2 * u - 1
                    z = -0.34 + 0.46 * u - 0.12 * math.sin(math.pi * u)
                    pts.append(Vector((x * ew * 0.9 * side, -0.006, z * eh)))
                self.hfeat('closed' + name, flat_sweep(pts, lambda t: 0.014 + 0.004 * math.sin(math.pi * t), Vector((0.0, -1.0, 0.0)), 0.5, 10),
                           mm['rim'], head, fr)
                continue
            top, bot = spider_lens(kind)
            top = [(x * ew, z * eh) for (x, z) in top]
            bot = [(x * ew, z * eh) for (x, z) in bot]
            white = strip_shape(top, bot, 5, 0.014, 0.005, 0.01)
            # thick black border: a flattened tube around the outline (starting on the smooth outer end)
            loop = top[1:] + list(reversed(bot))[1:-1]
            k0 = len(top) - 4
            loop = loop[k0:] + loop[:k0]
            loop = loop + loop[:3]
            # the loop runs clockwise (x right, z up): its outward normal is the tangent turned anticlockwise
            rim_pts = []
            for k in range(len(loop)):
                (xa, za), (xb, zb) = loop[max(0, k - 1)], loop[min(len(loop) - 1, k + 1)]
                tl = math.hypot(xb - xa, zb - za) or 1.0
                nx, nz = -(zb - za) / tl, (xb - xa) / tl
                rim_pts.append(Vector((loop[k][0] + nx * 0.011, -0.004, loop[k][1] + nz * 0.011)))
            rim = flat_sweep(rim_pts, 0.019, Vector((0.0, -1.0, 0.0)), 0.4, 10)
            if side < 0:
                white, rim = mirror_x(white), mirror_x(rim)
            self.hfeat('lensrim' + name, rim, mm['rim'], head, fr)
            self.hfeat('lens' + name, white, mm['lens'], head, fr)
            if kind == 'dizzy':
                pts = []
                for i in range(40):
                    a = i / 40 * math.tau * 2.2
                    r = 0.008 + (ew * 0.42 - 0.008) * i / 40
                    pts.append(Vector(((0.2 * ew + math.cos(a) * r) * side, -0.022, 0.02 + math.sin(a) * r * 0.85)))
                self.hfeat('spiral' + name, sweep(pts, 0.0072, 6), mm['rim'], head, fr)
