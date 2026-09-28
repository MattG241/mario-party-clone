"""Mossi Bloom as a stylised 3D model (loaded by characters.py as class `Mossi`).

A plant-alchemist kid built on Kip's proportions: a big crown of broad leaves (bright to deep
greens) with a small white flower tucked on the right side, pointed ears, a pink petal collar,
purple overalls with gold buttons, bare arms and shins with leafy cuffs, brown boots with cream
toe caps and a round pouch on the left hip.

Leaves and petals are "blades": a spine curve with a lens-shaped, slightly V-folded cross-section,
a pointed (or rounded) tip and a per-vertex 'tip' value that feeds a colour ramp (darker at the
root, lighter towards the tip, with a pale midrib on the front face).
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from char_models import Hero, hair_shell, hand_mitten, periodic_interp, zigzag
from char_rig import I4, HeadShape, R, S, T, disc, ellipsoid, open_sweep, superellipsoid, sweep, torus


def _clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return max(a, min(b, x))


# ------------------------------------------------------------------------------------------
# Materials
def ramp_mat(mats, name: str, stops, rough: float = 0.45, coat: float = 0.2, sheen: float = 0.25, spec: float = 0.4):
    """A soft material coloured by a colour ramp over the per-vertex 'tip' attribute."""
    def make(n):
        m = lib.NT(n)
        a = m.node('ShaderNodeAttribute')
        a.attribute_name = 'tip'
        c = m.ramp(a.outputs['Fac'], stops)
        m.bsdf(c, rough, coat=coat, sheen=sheen, spec=spec)
        return m.mat
    return mats.get(name, make)


# ------------------------------------------------------------------------------------------
# Leaf / petal geometry
# cross-section samples across the blade (-1..1), denser at the midrib so it can be picked out
SEC = (-1.0, -0.84, -0.62, -0.38, -0.18, -0.06, 0.0, 0.06, 0.18, 0.38, 0.62, 0.84, 1.0)


def leaf_width(W: float, peak: float = 0.38, sharp: float = 1.0, base: float = 0.16):
    """Half-width profile of a leaf `W` wide at its widest point (at fraction `peak` of its length).
    sharp < 1 gives rounder shoulders and a blunter tip, > 1 a slimmer, drawn-out point."""
    e = math.log(0.5) / math.log(peak)

    def f(u):
        us = _clamp(u) ** e
        w = max(0.0, math.sin(math.pi * us)) ** sharp
        return 0.5 * W * max(w, base * (1.0 - u) ** 2)
    return f


def blade(pts, normals, width, thick: float = 0.12, fold: float = 0.1, shade=(0.0, 1.0), rib: float = 0.14):
    """A leaf / petal along the spine `pts` whose front faces `normals`. width(u) is the half width,
    thick the lens thickness (relative to the half width), fold lifts the edges towards the front
    (a V-fold along the midrib). Returns (verts, faces, tip) with tip running shade[0] -> shade[1]
    from the root to the point, plus a pale midrib on the front."""
    n = len(pts)
    lo, hi = shade
    verts, faces, tips = [], [], []
    front = list(SEC)
    back = list(reversed(SEC[1:-1]))
    loop = front + back
    nf = len(front)
    L = len(loop)
    rings = []
    for i in range(n - 1):  # the last spine point becomes the tip vertex
        p = pts[i]
        tg = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        tg.normalize()
        nv = normals[i] - tg * normals[i].dot(tg)
        nv.normalize()
        side = tg.cross(nv).normalized()
        u = i / (n - 1)
        w = width(u)
        th = max(0.0022, thick * w)
        ring = []
        for k, v in enumerate(loop):
            is_front = k < nf
            s = math.sqrt(max(0.0, 1.0 - v * v))
            off = (th * s if is_front else -th * s) + fold * abs(v) * w
            verts.append(tuple(p + side * (v * w) + nv * off))
            g = u ** 0.85
            if is_front and rib:
                g += rib * max(0.0, 1.0 - abs(v) / 0.07) * (1.0 - u) ** 0.6
            g -= 0.12 * abs(v) ** 3
            tips.append(lo + (hi - lo) * _clamp(g))
            ring.append(len(verts) - 1)
        rings.append(ring)
    verts.append(tuple(pts[-1]))
    tips.append(hi)
    tip_i = len(verts) - 1
    tg0 = (pts[1] - pts[0]).normalized()
    verts.append(tuple(pts[0] - tg0 * (0.25 * width(0.0))))
    tips.append(lo)
    base_i = len(verts) - 1
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(L):
            k2 = (k + 1) % L
            faces.append((a[k], a[k2], b[k2], b[k]))
    last, first = rings[-1], rings[0]
    for k in range(L):
        k2 = (k + 1) % L
        faces.append((last[k], last[k2], tip_i))
        faces.append((first[k2], first[k], base_i))
    return verts, faces, tips


def leaf_spine(length: float, curl: float = 0.0, bend: float = 0.0, twist: float = 0.0, n: int = 14, p: float = 1.35):
    """Spine and front normals of a leaf in its own frame: it grows along +Z with its front facing -Y.
    The tip curls towards the front by `curl` degrees (negative: backwards), sweeps towards +X by
    `bend` degrees, and the blade twists about the spine by `twist` degrees."""
    def frame(u):
        c = math.radians(curl) * u ** p
        b = math.radians(bend) * u ** p
        tw = math.radians(twist) * u
        return Matrix.Rotation(c, 3, 'X') @ Matrix.Rotation(b, 3, 'Y') @ Matrix.Rotation(tw, 3, 'Z')

    pts, nrm = [], []
    pos = Vector((0.0, 0.0, 0.0))
    ds = length / n
    for i in range(n + 1):
        u = i / n
        pts.append(pos.copy())
        nrm.append(frame(u) @ Vector((0.0, -1.0, 0.0)))
        pos = pos + (frame((i + 0.5) / n) @ Vector((0.0, 0.0, 1.0))) * ds
    return pts, nrm


def frame_at(base: Vector, d0: Vector, n0: Vector) -> Matrix:
    """Matrix taking a leaf's own frame (grows +Z, front -Y) to start at `base`, growing along `d0`
    with its front facing (the part of) `n0` (perpendicular to d0)."""
    d0 = Vector(d0).normalized()
    n0 = Vector(n0)
    n0 = n0 - d0 * n0.dot(d0)
    if n0.length < 1e-6:
        n0 = Vector((0.0, -1.0, 0.0)) - d0 * (-d0.y)
    n0.normalize()
    s0 = d0.cross(n0)
    m = Matrix((s0, -n0, d0)).transposed().to_4x4()
    m.translation = base
    return m


def leaf(base, d0, n0, length, width, curl=0.0, bend=0.0, twist=0.0, thick=0.12, fold=0.1, shade=(0.0, 1.0), rib=0.14, n=14):
    """A leaf placed at `base` growing along `d0`, front facing `n0` (all in the parent frame)."""
    pts, nrm = leaf_spine(length, curl, bend, twist, n)
    m = frame_at(Vector(base), Vector(d0), Vector(n0))
    r3 = m.to_3x3()
    pts = [m @ q for q in pts]
    nrm = [r3 @ q for q in nrm]
    wf = width if callable(width) else leaf_width(width)
    return blade(pts, nrm, wf, thick, fold, shade, rib)


class Batch:
    """Collects several meshes (with 'tip' values) into one part."""

    def __init__(self):
        self.v, self.f, self.t = [], [], []

    def add(self, mesh, m: Matrix | None = None, tipval: float = 0.5):
        if len(mesh) == 3:
            v, f, t = mesh
        else:
            v, f = mesh
            t = [tipval] * len(v)
        if m is not None:
            v = [tuple(m @ Vector(q)) for q in v]
        b = len(self.v)
        self.v.extend(tuple(q) for q in v)
        self.f.extend(tuple(i + b for i in fc) for fc in f)
        self.t.extend(t)
        return self

    def emit(self, hero, name, mat, joint=None, local=I4):
        if self.v:
            hero.add(name, (self.v, self.f), mat, joint, local, tip=self.t)


def dir_from(yaw: float, elev: float) -> Vector:
    """Unit direction: yaw 0 = front (-Y), +90 = the character's left (+X); elev above horizontal."""
    y, e = math.radians(yaw), math.radians(elev)
    return Vector((math.sin(y) * math.cos(e), -math.cos(y) * math.cos(e), math.sin(e)))


# ------------------------------------------------------------------------------------------
class Mossi(Hero):
    """Mossi Bloom: plant-alchemist kid — leaf crown, petal collar, purple overalls, leafy cuffs."""

    key = 'mossi'
    ankle_h = 0.14
    hip_h = 0.63
    spine = 0.08
    chest = 0.19
    neck = 0.14
    head_up = 0.04
    shoulder = (0.22, 0.0, 0.11)
    upper_arm = 0.215
    forearm = 0.19
    hip_w = 0.112
    thigh = 0.22
    shin = 0.225
    sit_h = 0.17

    C = dict(skin='#eed0a0', skin_d='#d8a77c', nose='#eeb08a', iris='#c0621c', brow='#5b7228',
             over='#8a63bf', over_l='#a07ad0', over_d='#6f4ca3', gold='#e8b53a',
             boot='#7a4a2a', boot_d='#5f3820', sole='#f2e0be', pouch='#8a5a30', pouch_d='#6a4224', cord='#efdcae',
             petal_w='#fbf8ef', petal_c='#f6c21f')
    LEAF = [(0.0, '#184c2a'), (0.25, '#2b7433'), (0.5, '#4a9a38'), (0.72, '#7cc447'), (0.88, '#a3da52'), (1.0, '#cfe96c')]
    PINK = [(0.0, '#b23a5b'), (0.3, '#dc5877'), (0.65, '#ef8199'), (1.0, '#f7abbb')]

    HEAD = (0.37, 0.355, 0.38, 0.41)  # rx, ry, rz, centre height above the head joint

    def head_top(self) -> float:
        # the dizzy stars circle above the leaf crown rather than inside it
        return self.HEAD[3] + self.HEAD[2] + 0.44

    def add_tipped(self, name, mesh, mat, joint, local, value: float):
        """Add a plain mesh with a constant 'tip' value (for the ramp materials)."""
        self.add(name, mesh, mat, joint, local, tip=[value] * len(mesh[0]))

    # --------------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=mt.skin('mossi_skin', c['skin']),
            skin_d=mt.skin('mossi_skin_d', c['skin_d']),
            nose=mt.skin('mossi_nose', c['nose']),
            leaf=ramp_mat(mt, 'mossi_leaf', self.LEAF, 0.42, 0.35, 0.15),
            leaf_cap=ramp_mat(mt, 'mossi_leaf_cap', self.LEAF, 0.7, 0.0, 0.3),
            pink=ramp_mat(mt, 'mossi_petal', self.PINK, 0.55, 0.1, 0.1),
            over=mt.cloth('mossi_over', c['over'], 0.74, 0.35, 0.1),
            over_l=mt.cloth('mossi_over_l', c['over_l'], 0.74, 0.35),
            over_d=mt.cloth('mossi_over_d', c['over_d'], 0.74, 0.3),
            gold=mt.metal('mossi_gold', c['gold'], 0.3),
            boot=mt.cloth('mossi_boot', c['boot'], 0.5, 0.2, 0.1, 30),
            boot_d=mt.cloth('mossi_boot_d', c['boot_d'], 0.55, 0.2),
            sole=mt.cloth('mossi_sole', c['sole'], 0.6, 0.1),
            pouch=mt.cloth('mossi_pouch', c['pouch'], 0.55, 0.2, 0.15, 25),
            pouch_d=mt.cloth('mossi_pouch_d', c['pouch_d'], 0.55, 0.2),
            cord=mt.cloth('mossi_cord', c['cord'], 0.7, 0.2),
            petal_w=mt.cloth('mossi_flower', c['petal_w'], 0.5, 0.4),
            petal_c=mt.glossy('mossi_flower_c', c['petal_c'], 0.35, 0.3),
        )
        ex = self.pose.get('extra', {})
        self.sway = ex.get('sway', 0.0)
        self.fly = ex.get('scarf', 0.0)
        self.wave = ex.get('wave', 0.0)
        self.body()
        self.legs()
        self.arms()
        self.head_and_face()
        self.crown()

    # --- torso: overalls over a bare body ---------------------------------------------------
    @staticmethod
    def trad(z: float) -> float:
        """Torso half-width at height z in the chest frame (depth is 0.8 of it)."""
        t = _clamp((z + 0.36) / 0.48)
        return 0.212 - 0.03 * t + 0.012 * math.sin(math.pi * t)

    def body(self):
        M = self.mat
        tr = self.trad
        z0, z1 = -0.34, 0.12
        pts = [Vector((0, 0, z0 + (z1 - z0) * i / 10)) for i in range(11)]
        self.add('torso', sweep(pts, lambda t: tr(z0 + (z1 - z0) * t), 24, cap0=False, squash=0.8), M['skin'], 'chest')
        self.add('shoulders', ellipsoid(0.198, 0.15, 0.085, 26, 12, center=(0, 0, 0.1), zmin=-0.2), M['skin'], 'chest')
        # overalls: a band round the waist, the bib in front and a lower panel at the back
        w0, w1 = -0.37, -0.19
        pts = [Vector((0, 0, w0 + (w1 - w0) * i / 6)) for i in range(7)]
        self.add('over_waist', sweep(pts, lambda t: tr(w0 + (w1 - w0) * t) + 0.012, 26, cap0=False, cap1=False, squash=0.8), M['over'], 'chest')
        b0, b1 = -0.22, 0.05
        pts = [Vector((0, 0, b0 + (b1 - b0) * i / 6)) for i in range(7)]
        self.add('bib', open_sweep(pts, lambda t: tr(b0 + (b1 - b0) * t) + 0.013, -138, -42, 20, 0.8, 0.02), M['over'], 'chest')
        k0, k1 = -0.22, -0.1
        pts = [Vector((0, 0, k0 + (k1 - k0) * i / 4)) for i in range(5)]
        self.add('backpanel', open_sweep(pts, lambda t: tr(k0 + (k1 - k0) * t) + 0.013, 40, 140, 18, 0.8, 0.02), M['over'], 'chest')
        # lighter pocket panel on the bib
        pz = -0.1
        py = -tr(pz) * 0.8 - 0.018
        self.add('pocket', superellipsoid(0.075, 0.012, 0.055, 3.4, 20, 10), M['over_l'], 'chest', T(0, py, pz))
        self.add('pocket_seam', torus(0.052, 0.006, 24, 6), M['over_d'], 'chest', T(0, py - 0.01, pz + 0.058) @ R(90, 0, 0) @ S(1.3, 0.35, 1.0))
        # shoulder straps: bib corners -> over the shoulders -> down the back
        for sd in (1, -1):
            ctrl = [Vector((0.1 * sd, -0.166, 0.03)), Vector((0.114 * sd, -0.145, 0.1)), Vector((0.128 * sd, -0.1, 0.16)),
                    Vector((0.132 * sd, -0.02, 0.19)), Vector((0.128 * sd, 0.07, 0.17)), Vector((0.118 * sd, 0.14, 0.08)),
                    Vector((0.108 * sd, 0.168, -0.02)), Vector((0.1 * sd, 0.172, -0.1))]
            spts = catmull(ctrl, 5)
            self.add('strap', sweep(spts, 0.026, 10, squash=0.45), M['over'], 'chest')
            # gold buttons where the straps meet the bib
            bm = T(0.1 * sd, -0.18, 0.02) @ R(0, 0, 22 * sd)
            self.add('button', disc(0.04, 0.02, 24), M['gold'], 'chest', bm)
            self.add('button_rim', torus(0.038, 0.008, 22, 6), M['gold'], 'chest', bm @ T(0, -0.01, 0) @ R(90, 0, 0))
        # shorts (hips frame)
        self.add('pelvis', superellipsoid(0.205, 0.166, 0.15, 2.4, 28, 16, center=(0, 0, -0.04)), M['over'], 'hips')
        self.pouch()
        self.collar()

    def pouch(self):
        M = self.mat
        pm = T(0.22, -0.08, -0.07) @ R(0, 0, 32) @ S(1.18)
        self.add('pouch', ellipsoid(0.078, 0.058, 0.08, 20, 14), M['pouch'], 'hips', pm)
        self.add('pouch_flap', ellipsoid(0.082, 0.062, 0.05, 20, 10, center=(0, -0.002, 0.03), zmin=-0.1), M['pouch_d'], 'hips', pm)
        self.add('pouch_tie', torus(0.05, 0.008, 20, 6, center=(0, 0, 0.035)), M['cord'], 'hips', pm @ S(1.0, 0.8, 1.0))
        lf = Batch()
        lf.add(leaf(Vector((0.0, -0.062, 0.035)), Vector((0.55, -0.05, -0.8)), Vector((0, -1, 0.1)), 0.075, leaf_width(0.045), 18, 0, 0, 0.16, 0.1, (0.45, 0.95), n=8))
        lf.add(leaf(Vector((0.0, -0.062, 0.035)), Vector((-0.6, -0.05, -0.75)), Vector((0, -1, 0.1)), 0.065, leaf_width(0.04), 18, 0, 0, 0.16, 0.1, (0.35, 0.85), n=8))
        lf.emit(self, 'pouch_leaf', M['leaf'], 'hips', pm)
        self.add('pouch_seed', ellipsoid(0.013, 0.012, 0.013, 10, 6, center=(0, -0.066, 0.036)), M['petal_c'], 'hips', pm)

    def collar(self):
        """Pink flower-petal collar round the neck (two rings of petals) and a small leaf 'tie'."""
        M = self.mat
        pink = Batch()
        N = 8
        for layer in (0, 1):
            for k in range(N):
                a = 360.0 * (k + 0.5 * layer) / N + 11.0
                r = math.radians(a)
                radial = Vector((math.sin(r), -math.cos(r) * 0.84, 0.0))
                side = abs(math.sin(r))
                base = Vector((0.0, 0.0, 0.175 + 0.014 * layer)) + radial * (0.12 if layer == 0 else 0.1)
                d0 = radial + Vector((0, 0, -0.1 + 0.12 * layer))
                n0 = radial * 0.4 + Vector((0, 0, 1.0))
                L = (0.27 - 0.05 * side) if layer == 0 else (0.2 - 0.04 * side)
                W = 0.19 if layer == 0 else 0.15
                sh = (0.0, 0.62) if layer == 0 else (0.2, 0.85)
                cu = -24 + 6 * math.sin(k * 2.7 + layer)
                pink.add(leaf(base, d0, n0, L, leaf_width(W, 0.45, 0.85), cu, 4 * math.sin(k * 1.9), 0, 0.16, 0.14, sh, 0.12, 10))
        pink.emit(self, 'collar', M['pink'], 'chest')
        # a small pale leaf hanging at the front like a tie
        tie = Batch()
        tie.add(leaf(Vector((0, -0.16, 0.1)), Vector((0.05, -0.25, -1.0)), Vector((0, -1, 0.2)), 0.12, leaf_width(0.07), 12, 0, 0, 0.16, 0.12, (0.55, 1.0), n=10))
        tie.emit(self, 'collar_tie', M['leaf'], 'chest')

    # --- legs ---------------------------------------------------------------------------------
    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('shorts' + s_, hip, kn, an, lambda t: 0.112 + 0.014 * t, M['over'], 0.0, 0.42, 16, 10, cap0=True, cap1=False)
            self.add('cuff' + s_, torus(0.122, 0.032, 28, 10, squash=1.5), M['over_l'], None, self.limb_frame(hip, kn, an, 0.41, hip))
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.078 - 0.014 * t + 0.007 * math.sin(math.pi * _clamp((t - 0.45) / 0.4)), M['skin'], 0.38, 0.93, 12, 12)
            # leafy cuff at the top of the boot
            fr = self.limb_frame(hip, kn, an, 0.9, hip)
            self.leaf_ring(fr, 8, 0.066, 0.15, 0.105, 0.6, 30, 'acuff' + s_, phase=0.4)
            self.add_tipped('aband' + s_, torus(0.068, 0.016, 20, 8), M['leaf'], None, fr, 0.4)
            # boots (a touch smaller than Kip's)
            fm = self.J(an) @ R(0, 0, -9 * sd)
            self.add('boot' + s_, superellipsoid(0.118, 0.166, 0.104, 2.6, 22, 14, center=(0, -0.048, -0.042)), M['boot'], None, fm)
            self.add('toe' + s_, ellipsoid(0.11, 0.095, 0.073, 18, 10, center=(0, -0.15, -0.076)), M['sole'], None, fm)
            self.add('sole' + s_, superellipsoid(0.124, 0.19, 0.035, 3.0, 22, 8, center=(0, -0.058, -0.106)), M['sole'], None, fm)
            self.add('bootcuff' + s_, torus(0.094, 0.029, 22, 8, center=(0, 0, 0.044)), M['boot_d'], None, fm)
            # a leaf lying on the boot's tongue
            tongue = leaf(Vector((0.0, -0.1, 0.03)), Vector((0.0, -0.75, -0.66)), Vector((0.0, -0.66, 0.75)), 0.13, leaf_width(0.095), -28, 0, 0, 0.14, 0.12, (0.3, 0.85), 0.16, 10)
            self.add('bootleaf' + s_, tongue[:2], M['leaf'], None, fm, tip=tongue[2])

    # --- arms -----------------------------------------------------------------------------------
    def arms(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.072 - 0.018 * t + 0.005 * math.sin(math.pi * _clamp((t - 0.5) / 0.45)), M['skin'], 0.0, 1.0, 12, 16, extend=0.02)
            fr = self.limb_frame(sh, el, wr, 0.86, wr)
            self.leaf_ring(fr, 7, 0.054, 0.17, 0.125, 0.9, 30, 'wcuff' + s_, phase=1.3)
            self.leaf_ring(fr, 5, 0.052, 0.12, 0.095, -0.5, 26, 'wcuff2' + s_, phase=0.2)
            self.add_tipped('wband' + s_, torus(0.056, 0.016, 20, 8), M['leaf'], None, fr, 0.4)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.25):
                self.add('hand' + nm + s_, mesh, M['skin'], None, wm)

    def leaf_ring(self, fr: Matrix, count: int, r0: float, length: float, width: float, along: float, curl: float, name: str, phase: float = 0.0):
        """A ruff of small leaves round a limb. `fr`: limb frame (-Z towards the hand / foot);
        along > 0 points the leaves back up the limb, < 0 down towards the hand / foot."""
        b = Batch()
        flutter = self.fly * 10.0
        for k in range(count):
            a = math.tau * (k + phase * 0.5) / count
            radial = Vector((math.cos(a), math.sin(a), 0.0))
            base = radial * r0
            lean = 1.0 if along >= 0 else -1.0
            d0 = radial * (0.75 + 0.1 * math.sin(k * 2.3)) + Vector((0.0, 0.0, abs(along) * lean))
            n0 = radial
            L = length * (0.85 + 0.15 * math.sin(k * 1.7 + phase))
            sh = (0.25 + 0.1 * (k % 2), 0.8 + 0.1 * (k % 3) / 2)
            cu = curl + flutter * math.sin(self.wave + k * 1.9)
            b.add(leaf(base, d0, n0, L, leaf_width(width), cu, 10 * math.sin(k * 2.9), 0, 0.14, 0.12, sh, 0.12, 9))
        verts = [tuple(fr @ Vector(q)) for q in b.v]
        self.add(name, (verts, b.f), self.mat['leaf'], None, I4, tip=b.t)

    # --- head -----------------------------------------------------------------------------------
    def head_and_face(self):
        M, c = self.mat, self.C
        hx, hy, hz, hc = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, 0, hc))
        hv, hf = ellipsoid(hx, hy, hz, 40, 26, center=(0, 0, hc))
        hv = [(x * (1 - 0.15 * max(0.0, (hc - z) / hz) ** 1.5), y - 0.025 * max(0.0, (hc - z) / hz) ** 2, z) for (x, y, z) in hv]
        self.add('head', (hv, hf), M['skin'], 'head')
        # a short neck under the chin (hidden by the collar)
        self.add('neck', sweep([Vector((0, 0.01, -0.1)), Vector((0, 0.01, 0.06))], 0.08, 16), M['skin'], 'head')
        self.ears(head)
        self.face(head, 'head', eye_yaw=25, eye_pitch=-7, eye_size=(0.106, 0.138), iris=c['iris'], brow_col=c['brow'], mouth_pitch=-31, mouth_w=1.2,
                  lid_col=c['skin'], skin=None, nose=False, brow_pitch=21)
        nf = head.frame(0, -20, -0.004)
        self.feat('nose', ellipsoid(0.03, 0.026, 0.024, 14, 8), M['nose'], 'head', head, nf)

    def ears(self, head: HeadShape):
        """Pointed, elf-like ears: a cupped blade that sweeps out and up to a point."""
        M = self.mat
        hx, hc = self.HEAD[0], self.HEAD[3]
        outer, inner = Batch(), Batch()
        for sd in (1, -1):
            base = Vector(((hx - 0.04) * sd, 0.025, hc - 0.045))
            d0 = Vector((0.8 * sd, 0.2, 0.58))
            n0 = Vector((0.45 * sd, -1.0, 0.15))
            wf = leaf_width(0.165, 0.3, 0.85, 0.5)
            outer.add(leaf(base, d0, n0, 0.27, wf, -6, -12 * sd, 0, 0.3, 0.36, (0.5, 0.5), 0.0, 12))
            m = frame_at(base, d0, n0)
            inner.add(leaf(m @ Vector((0.0, -0.023, 0.05)), d0, n0, 0.18, leaf_width(0.085, 0.3, 0.9, 0.4), -6, -12 * sd, 0, 0.2, 0.2, (0.5, 0.5), 0.0, 10))
        outer.emit(self, 'ears', M['skin'], 'head')
        inner.emit(self, 'ears_in', M['skin_d'], 'head')

    # --- the leaf crown -------------------------------------------------------------------------
    # (yaw, pitch) of the root on the head; (fan, back): the growth direction — fan tilts it from
    # straight up towards the character's left (+) / right (-), back leans it backwards;
    # length, width, curl, bend, twist, shade range
    CROWN = [
        # back of the head first
        (180, 72, 0, 0.9, 0.5, 0.28, 22, 0, 0, 0.12, 0.72),
        (150, 58, 25, 1.1, 0.46, 0.27, 26, 6, 0, 0.08, 0.64),
        (-150, 58, -25, 1.1, 0.46, 0.27, 26, -6, 0, 0.08, 0.64),
        (128, 34, 75, 1.2, 0.38, 0.25, 26, 0, 0, 0.04, 0.56),
        (-128, 34, -75, 1.2, 0.38, 0.25, 26, 0, 0, 0.04, 0.56),
        (165, 26, 140, 1.6, 0.34, 0.25, 20, 0, 0, 0.02, 0.5),
        (-165, 26, -140, 1.6, 0.34, 0.25, 20, 0, 0, 0.02, 0.5),
        # hanging behind the ears
        (-100, 16, -150, 0.35, 0.34, 0.21, 20, 0, 0, 0.02, 0.5),
        (100, 16, 150, 0.35, 0.34, 0.21, 20, 0, 0, 0.02, 0.48),
        # temples: the right one sticks out, the left one droops
        (-72, 36, -84, 0.2, 0.4, 0.23, 34, -6, 0, 0.08, 0.66),
        (74, 36, 112, 0.3, 0.36, 0.22, 26, 6, 0, 0.06, 0.58),
        # upper sides
        (-46, 58, -42, 0.3, 0.48, 0.26, 28, -10, 0, 0.16, 0.8),
        (48, 57, 46, 0.3, 0.46, 0.25, 26, 10, 0, 0.14, 0.76),
        # behind the central leaf
        (-16, 72, -16, 0.35, 0.52, 0.27, 16, -12, 0, 0.28, 0.9),
        (20, 71, 20, 0.35, 0.5, 0.27, 16, 12, 0, 0.26, 0.88),
        # the tall central leaf
        (2, 70, 8, 0.12, 0.56, 0.3, 10, 16, 16, 0.44, 1.0),
    ]
    # leaves lying on the head (hairline row first, then the upper row): root (yaw, pitch) ->
    # tip (yaw, pitch), width, shade range; mirrored ones are listed with 'm'
    SHINGLES = [
        # bangs over the forehead: a V of two leaves in the middle, more at the sides
        (-62, 50, -76, 6, 0.21, 0.2, 0.74, ''),
        (64, 50, 78, 7, 0.21, 0.2, 0.72, ''),
        (-36, 56, -46, 24, 0.2, 0.3, 0.88, ''),
        (38, 56, 48, 25, 0.2, 0.3, 0.86, ''),
        (-12, 60, -2, 16, 0.17, 0.36, 0.98, ''),
        (14, 60, 3, 17, 0.17, 0.4, 1.0, ''),
        # down the sides behind the ears and over the back of the head
        (108, 45, 116, -14, 0.22, 0.02, 0.5, 'm'),
        (135, 45, 142, -18, 0.23, 0.02, 0.48, 'm'),
        (160, 45, 165, -24, 0.23, 0.02, 0.46, 'm'),
        (180, 45, 180, -28, 0.23, 0.02, 0.46, ''),
        # upper row
        (-8, 84, -14, 50, 0.22, 0.36, 0.9, ''),
        (12, 84, 20, 50, 0.22, 0.34, 0.88, ''),
        (60, 70, 68, 36, 0.21, 0.22, 0.78, 'm'),
        (82, 66, 94, 30, 0.22, 0.12, 0.66, 'm'),
        (120, 66, 130, 24, 0.23, 0.08, 0.6, 'm'),
        (155, 70, 160, 26, 0.23, 0.06, 0.58, 'm'),
    ]

    def crown(self):
        M = self.mat
        hx, hy, hz, hc = self.HEAD
        hs = HeadShape(hx + 0.012, hy + 0.012, hz + 0.01, center=(0, 0.01, hc + 0.012))

        # a leafy cap under the leaves, so no scalp shows between them
        def boundary(yaw):
            a = abs(yaw)
            if a <= 60:
                return zigzag(yaw, [-40, -14, 12, 38], 22.0, 32.0, 12.0)
            return periodic_interp([(60, 28), (80, 10), (100, 0), (130, -12), (180, -20)], a)

        def thickness(yaw, pitch, f):
            return 0.012 + 0.03 * min(1.0, f / 0.3) ** 0.8

        v, f, tp = hair_shell(hs, boundary, thickness, 120, 20)
        tp = [0.08 + 0.3 * t for t in tp]
        self.add('crown_cap', (v, f), M['leaf_cap'], 'head', tip=tp)

        sway, fly, wave = self.sway, self.fly, self.wave
        b = Batch()
        up = Vector((0.0, 0.0, 1.0))
        for i, (yaw, pitch, fan, back, L, W, curl, bend, twist, lo, hi) in enumerate(self.CROWN):
            base, nrm = hs.point(yaw, pitch, 0.0)
            base = base - nrm * 0.02
            fr = math.radians(fan + sway * 7.0)
            d0 = Vector((math.sin(fr), back + fly * 0.35, math.cos(fr)))
            ay = abs(yaw)
            fyaw = yaw * 0.5 if ay <= 90 else math.copysign(45 + (ay - 90) * 1.5, yaw)
            n0 = dir_from(fyaw, 0.0) + up * 0.3
            cu = curl + 9.0 * fly * math.sin(wave * 1.3 + i * 1.7) + 3.0 * sway * math.sin(i * 2.1)
            be = bend + 6.0 * sway
            tw = twist + 9.0 * math.sin(i * 2.3 + 0.7)
            b.add(leaf(base, d0, n0, L, leaf_width(W, 0.45, 0.85), cu, be, tw, 0.12, 0.16, (lo, hi), 0.24, 16))
        specs = []
        for (y0, p0, y1, p1, W, lo, hi, mir) in self.SHINGLES:
            specs.append((y0, p0, y1, p1, W, lo, hi))
            if mir:
                specs.append((-y0, p0, -y1, p1, W, lo, hi))
        for (y0, p0, y1, p1, W, lo, hi) in specs:
            pts, nrms = [], []
            n = 12
            upper = p1 > 20
            l0 = 0.05 if upper else 0.03
            for j in range(n + 1):
                u = j / n
                lift = l0 + 0.006 * u + 0.035 * u ** 2.5
                pos, nn = hs.point(y0 + (y1 - y0) * u, p0 + (p1 - p0) * u, lift)
                pts.append(pos)
                nrms.append(nn)
            b.add(blade(pts, nrms, leaf_width(W, 0.42, 0.85), 0.12, 0.12, (lo, hi), 0.24))
        b.emit(self, 'crown', M['leaf'], 'head')
        self.flower(hs)

    def flower(self, hs: HeadShape):
        """A small white five-petal flower with a yellow centre, tucked on the right side of the head."""
        M = self.mat
        pos, nn = hs.point(-64, 24, 0.07)
        face = (nn + Vector((0.0, -0.8, 0.25))).normalized()
        upv = Vector((0.0, 0.0, 1.0))
        x = (-face).cross(upv).normalized()
        z = x.cross(-face).normalized()
        F = Matrix((x, -face, z)).transposed().to_4x4()
        F.translation = pos
        petals = Batch()
        for k in range(5):
            a = math.radians(90 + 72 * k + 8)
            d = Vector((math.cos(a), 0.0, math.sin(a)))
            petals.add(leaf(d * 0.01, d, Vector((0, -1, 0)), 0.085, leaf_width(0.07, 0.62, 0.55, 0.3), 22, 0, 0, 0.2, 0.06, (0.5, 0.5), 0.0, 8))
        v = [tuple(F @ Vector(q)) for q in petals.v]
        self.add('flower', (v, petals.f), M['petal_w'], 'head')
        self.add('flower_c', ellipsoid(0.026, 0.016, 0.026, 14, 8), M['petal_c'], 'head', F @ T(0, -0.012, 0))


def catmull(ctrl, per: int = 5):
    """A smooth Catmull-Rom curve through the control points."""
    pts = []
    n = len(ctrl)
    for i in range(n - 1):
        p0 = ctrl[max(i - 1, 0)]
        p1, p2 = ctrl[i], ctrl[i + 1]
        p3 = ctrl[min(i + 2, n - 1)]
        for j in range(per):
            t = j / per
            t2, t3 = t * t, t * t * t
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    pts.append(ctrl[-1].copy())
    return pts
