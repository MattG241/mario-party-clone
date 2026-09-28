"""Packsprout, the Delivery Sprout: a festival NPC rendered by npcs.py in the heroes' look.

A round sprout creature courier. Head and body form one soft bean (a big, broad bun of a head on a
chubby belly), leafy green on top and at the back, fading to cream over the face and belly; two big
glossy leaves sprout from the crown. Stubby green arms and legs with big brown feet, a puffy
orange-red neckerchief, a round wooden badge with a green clover on the basket strap, and a big woven
wicker basket worn as a backpack, full of parcels (yellow boxes with blue ribbon) and a red apple.

The green-to-cream colouring is a per-vertex value ('tip') worked out from the direction on the head
and belly and fed through a colour ramp, so it follows the parts in every pose.

Extras: pose['extra']['prop'] = 'gift' (a yellow gift box with a blue bow held up in the left hand) or
'star' (a glossy golden star raised in the left hand, with three glowing emphasis ticks); 'sweat' adds
little blue drops flying off the head. Face: the shared Hero.face() eyes (the design has no eyebrows;
eyes='winkL' closes the left eye, the stock 'wink' closes the right) with the stock mouth shapes scaled
up for this big-mouthed face, plus mouth='cat', a small w-shaped smile.

The legs pivot high inside the belly, so they are short stubs when standing but long enough to stride;
the walking poses turn the hips across the picture (the upper body counter-turns and stays three-quarters)
and shift the root so the foot on the ground sits on the registration point.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from lib import col
from char_anims import face, pose, swing
from char_models import DEFAULT_FACE, Hero, hand_mitten
from char_mossi import Batch, leaf, leaf_width
from char_rig import HeadShape, R, S, T, arc_points, disc, ellipsoid, rad, superellipsoid, sweep, torus
from char_zippa import catmull_rom


def sstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def interp(points, x: float) -> float:
    """Smoothly interpolated value through (x, y) control points (clamped at the ends)."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * sstep((x - x0) / (x1 - x0))
    return points[-1][1]


def direction(yaw: float, pitch: float) -> Vector:
    y, p = rad(yaw), rad(pitch)
    return Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))


def yaw_pitch(d: Vector):
    """Direction -> (yaw, pitch) in degrees: yaw 0 = front (-Y), +90 = the character's left (+X)."""
    d = Vector(d).normalized()
    return math.degrees(math.atan2(d.x, -d.y)), math.degrees(math.asin(max(-1.0, min(1.0, d.z))))


def merge(meshes):
    verts, faces = [], []
    for v, f in meshes:
        b = len(verts)
        verts.extend(v)
        faces.extend(tuple(q + b for q in fc) for fc in f)
    return verts, faces


def placed(m: Matrix, mesh):
    return [tuple(m @ Vector(v)) for v in mesh[0]], mesh[1]


def frame_on(pos: Vector, nrm: Vector, roll: float = 0.0) -> Matrix:
    """A frame at `pos` whose -Y faces along `nrm` (parts are modelled facing -Y, up +Z)."""
    fwd = -Vector(nrm).normalized()
    x = fwd.cross(Vector((0.0, 0.0, 1.0)))
    if x.length < 1e-5:
        x = Vector((1.0, 0.0, 0.0))
    x.normalize()
    z = x.cross(fwd).normalized()
    m = Matrix((x, fwd, z)).transposed().to_4x4()
    m.translation = Vector(pos)
    return m @ R(0, roll, 0)


# ------------------------------------------------------------------------------------------
# Materials
def ramp_mat(mats, name, stops, rough=0.5, sheen=0.3, coat=0.1, subsurface=0.0, bump=0.0, spec=0.4):
    """A soft material coloured by a colour ramp over the per-vertex 'tip' attribute."""
    def make(n):
        m = lib.NT(n)
        a = m.node('ShaderNodeAttribute')
        a.attribute_name = 'tip'
        c = m.ramp(a.outputs['Fac'], stops)
        nrm = None
        if bump:
            tc = m.node('ShaderNodeTexCoord')
            nz = m.noise(26.0, 3, 0.6, tc.outputs['Object'])
            nrm = m.bump(nz.outputs['Fac'], bump, 0.02)
        m.bsdf(c, rough, normal=nrm, subsurface=subsurface, sheen=sheen, coat=coat, spec=spec)
        return m.mat
    return mats.get(name, make)


def wicker_mat(mats, name, dark, mid, light, rows=5.5, strands=20):
    """Woven wicker: rows of rounded, slanted pillows round the basket (object Z up), every other row
    offset by half a strand, dark in the gaps. The angle's seam sits at the back (+Y)."""
    def make(n):
        m = lib.NT(n)
        obj = m.node('ShaderNodeTexCoord').outputs['Object']
        sx, sy, sz = m.sep(obj)
        ang = m.math('ARCTAN2', sx, m.math('MULTIPLY', sy, -1.0))
        u = m.math('MULTIPLY', ang, strands / math.tau)
        v = m.math('MULTIPLY', sz, rows)
        vf = m.math('FLOOR', v)
        u = m.math('ADD', u, m.math('ADD', m.math('MULTIPLY', vf, 0.5), m.math('MULTIPLY', m.math('FRACT', v), 0.45)))
        pu = m.math('SINE', m.math('MULTIPLY', m.math('FRACT', u), math.pi))
        pv = m.math('SINE', m.math('MULTIPLY', m.math('FRACT', v), math.pi))
        h = m.math('MULTIPLY', m.math('POWER', pu, 0.6), m.math('POWER', pv, 0.7))
        c = m.ramp(h, [(0.0, dark), (0.35, mid), (1.0, light)])
        m.bsdf(c, 0.58, normal=m.bump(h, 0.8, 0.045), sheen=0.25, spec=0.32)
        return m.mat
    return mats.get(name, make)


# ------------------------------------------------------------------------------------------
# Geometry
class Blob(HeadShape):
    """A soft rounded solid: an upper dome (radii rx, ry, rz) glued at the equator to a lower bowl of
    depth rz_low, a little boxy (exponents p / p_low), the lower half flaring out by `flare`. The mesh
    and the HeadShape queries (point / surface / frame / conform) follow the same surface, so facial
    features, straps and badges sit on it."""

    def __init__(self, rx, ry, rz, rz_low, center, p=2.0, p_low=None, flare=0.0):
        super().__init__(rx, ry, rz, center)
        self.rz_low = rz_low
        self.p = p
        self.p_low = p if p_low is None else p_low
        self.flare = flare

    def surf(self, d) -> Vector:
        d = Vector(d).normalized()
        low = d.z < 0.0
        rz, p = (self.rz_low, self.p_low) if low else (self.r.z, self.p)
        f = 1.0 + self.flare * max(0.0, -d.z)
        rx, ry = self.r.x * f, self.r.y * f
        k = (abs(d.x / rx) ** p + abs(d.y / ry) ** p + abs(d.z / rz) ** p) ** (-1.0 / p)
        return self.c + d * k

    def surface(self, d):
        d = Vector(d).normalized()
        pos = self.surf(d)
        e1 = d.cross(Vector((0.0, 0.0, 1.0)))
        if e1.length < 1e-6:
            e1 = Vector((1.0, 0.0, 0.0))
        e1.normalize()
        e2 = d.cross(e1).normalized()
        eps = 0.004
        n = (self.surf(d + e1 * eps) - self.surf(d - e1 * eps)).cross(self.surf(d + e2 * eps) - self.surf(d - e2 * eps)).normalized()
        if n.dot(pos - self.c) < 0.0:
            n = -n
        return pos, n

    def point(self, yaw, pitch, lift=0.0):
        pos, n = self.surface(direction(yaw, pitch))
        return pos + n * lift, n

    def mesh(self, seg=52, rings=34):
        v, f = ellipsoid(1.0, 1.0, 1.0, seg, rings)
        return [tuple(self.surf(q)) for q in v], f, v


def parcel(hx, hy, hz, ribbon=0.03, e=0.007):
    """A wrapped box and its ribbon cross (two thin slabs round the box): (box, ribbon)."""
    box = superellipsoid(hx, hy, hz, 6.0, 26, 16)
    rib = merge([superellipsoid(hx + e, ribbon, hz + e, 6.0, 20, 12), superellipsoid(ribbon, hy + e, hz + e, 6.0, 20, 12)])
    return box, rib


def bow(size=1.0):
    """A ribbon bow (two loops, a knot and two short tails) sitting on the origin, facing -Y."""
    s = size
    parts = []
    for sd in (1, -1):
        loop = torus(0.06 * s, 0.021 * s, 22, 8)
        m = T(0.062 * sd * s, 0.0, 0.05 * s) @ R(0, -30 * sd, 0) @ R(90, 0, 0) @ S(1.3, 0.8, 1.0)
        parts.append(placed(m, loop))
        tail = superellipsoid(0.024 * s, 0.01 * s, 0.05 * s, 3.0, 12, 8)
        parts.append(placed(T(0.035 * sd * s, -0.012 * s, -0.005 * s) @ R(0, 32 * sd, 0) @ T(0, 0, -0.03 * s), tail))
    parts.append(ellipsoid(0.032 * s, 0.028 * s, 0.03 * s, 14, 10, center=(0, -0.004 * s, 0.035 * s)))
    return merge(parts)


def puffy_star(r_out, r_in, depth, seg=90, rings=14, sharp=1.5):
    """A soft, rounded five-pointed star facing -Y (tips rounded, a lens-shaped cross-section)."""
    verts, faces = [], []

    def rad_at(a):
        w = 0.5 + 0.5 * math.cos(5 * (a - math.pi / 2))
        return r_in + (r_out - r_in) * w ** sharp

    ring_ids = []
    for j in range(1, rings):
        phi = -math.pi / 2 + math.pi * j / rings
        ids = []
        for k in range(seg):
            a = k / seg * math.tau
            r = rad_at(a) * math.cos(phi) ** 0.5
            verts.append((math.cos(a) * r, math.sin(phi) * depth * 0.5, math.sin(a) * r))
            ids.append(len(verts) - 1)
        ring_ids.append(ids)
    verts.append((0.0, -depth * 0.5, 0.0))
    front = len(verts) - 1
    verts.append((0.0, depth * 0.5, 0.0))
    back = len(verts) - 1
    for j in range(len(ring_ids) - 1):
        a, b = ring_ids[j], ring_ids[j + 1]
        for k in range(seg):
            k2 = (k + 1) % seg
            faces.append((a[k], b[k], b[k2], a[k2]))
    for k in range(seg):
        k2 = (k + 1) % seg
        faces.append((front, ring_ids[0][k], ring_ids[0][k2]))
        faces.append((back, ring_ids[-1][k2], ring_ids[-1][k]))
    return verts, faces


def teardrop(r):
    """A drop (round bottom, pointed tip up +Z) centred on its round part."""
    v, f = ellipsoid(1.0, 1.0, 1.0, 20, 14)
    out = []
    for (x, y, z) in v:
        t = max(0.0, z)
        k = r * (1.0 - 0.92 * t ** 1.4)
        out.append((x * k, y * k * 0.6, r * (z * (1.0 + 0.9 * t))))
    return out, f


def apple(r):
    """A round apple (a dimple at the top) centred on the origin, plus its stem as a second mesh."""
    v, f = ellipsoid(1.0, 1.0, 1.0, 28, 18)
    out = []
    for (x, y, z) in v:
        a = math.acos(max(-1.0, min(1.0, z)))  # 0 at the top
        dip = 0.28 * math.exp(-(a / 0.42) ** 2) + 0.1 * math.exp(-((math.pi - a) / 0.5) ** 2)
        k = r * (1.0 - dip) * (1.0 + 0.06 * math.sin(a))
        out.append((x * k, y * k, z * k * 0.92))
    stem = sweep([Vector((0, 0, r * 0.62)), Vector((0.01, 0, r * 0.9)), Vector((0.03, 0, r * 1.12))], 0.013, 6)
    return (out, f), stem


# ------------------------------------------------------------------------------------------
class Packsprout(Hero):
    """Packsprout: a round leafy sprout courier with a big wicker basket of parcels on its back."""

    key = 'packsprout'
    ankle_h = 0.15
    hip_h = 0.62
    spine = -0.12
    chest = 0.12
    neck = 0.08
    head_up = 0.03
    shoulder = (0.41, 0.0, 0.07)
    upper_arm = 0.16
    forearm = 0.14
    hip_w = 0.22
    thigh = 0.22
    shin = 0.21
    sit_h = 0.3

    HEAD = (0.5, 0.43, 0.4, 0.2)  # rx, ry, rz (dome), centre height above the head joint
    HEAD_LOW = 0.18  # depth of the bowl under the head's equator
    BODY = (0.47, 0.4, 0.3, 0.3, 0.02)  # belly rx, ry, rz up, rz down, centre height in the spine frame
    EYE = (29.0, 24.0)  # eye yaw / pitch on the head
    EYE_SIZE = (0.126, 0.15)
    MOUTH_PITCH = 2.0

    GREEN = [(0.0, '#4c680e'), (0.22, '#7e9812'), (0.46, '#b2b03a'), (0.7, '#f0c878'), (1.0, '#f8d488')]
    LEAF = [(0.0, '#3a6c0e'), (0.3, '#5a9214'), (0.6, '#7eb21e'), (0.85, '#a0c82a'), (1.0, '#bad63c')]
    C = dict(cream='#f3d898', foot='#7c4a2a', scarf='#ee5a1e', scarf_d='#dc501c', strap='#77462a', wood='#a8683c', wood_d='#7a4526',
             badge='#bfc63c', clover='#4c962a', wick_d='#401c08', wick_m='#7c3e14', wick_l='#b06a2c', rim='#7e4622', inside='#3e2414',
             parcel='#f0a93c', parcel_l='#f6bf4c', ribbon='#3d74c4', apple='#cf2e26', stem='#6a4020', gift='#f7bf2e', gift_rib='#2e7fd8',
             star='#ffc21a', iris='#55250e', lash='#2a160c', blush='#ff9280', nose='#ef8468', mouth='#6d2a26')

    def head_top(self) -> float:
        return self.HEAD[3] + self.HEAD[2] + 0.45

    def addt(self, name, mesh, mat, joint=None, local=None, value=0.22):
        """Add a mesh coloured by a ramp material at a constant 'tip' value."""
        self.add(name, mesh, mat, joint, local if local is not None else Matrix.Identity(4), tip=[value] * len(mesh[0]))

    def head_shape(self) -> Blob:
        hx, hy, hz, hc = self.HEAD
        return Blob(hx, hy, hz, self.HEAD_LOW, (0.0, 0.0, hc), 2.3, 2.2)

    def body_shape(self) -> Blob:
        bx, by, bzu, bzd, bc = self.BODY
        return Blob(bx, by, bzu, bzd, (0.0, 0.0, bc), 2.3, 2.2, 0.09)

    # --------------------------------------------------------------------------------------
    def dress(self):
        c, mt = self.C, self.m
        self.pose = dict(self.pose)
        self.mat = dict(
            skin=ramp_mat(mt, 'pack_skin', self.GREEN, 0.52, 0.35, 0.12, 0.06, 0.04),
            leaf=ramp_mat(mt, 'pack_leaf', self.LEAF, 0.32, 0.15, 0.55, 0.0, 0.0, 0.5),
            foot=mt.cloth('pack_foot', c['foot'], 0.55, 0.25, 0.08, 30),
            scarf=mt.cloth('pack_scarf', c['scarf'], 0.72, 0.45, 0.07),
            scarf_d=mt.cloth('pack_scarf_d', c['scarf_d'], 0.72, 0.45, 0.07),
            strap=mt.cloth('pack_strap', c['strap'], 0.6, 0.2, 0.06, 40),
            wood=mt.glossy('pack_wood', c['wood'], 0.45, 0.3),
            wood_d=mt.glossy('pack_wood_d', c['wood_d'], 0.45, 0.3),
            badge=mt.glossy('pack_badge', c['badge'], 0.35, 0.4),
            clover=mt.glossy('pack_clover', c['clover'], 0.35, 0.5),
            wicker=wicker_mat(mt, 'pack_wicker', c['wick_d'], c['wick_m'], c['wick_l']),
            rim=mt.cloth('pack_rim', c['rim'], 0.55, 0.25, 0.1, 30),
            inside=mt.cloth('pack_inside', c['inside'], 0.8, 0.1),
            parcel=mt.cloth('pack_parcel', c['parcel'], 0.55, 0.2),
            parcel_l=mt.cloth('pack_parcel_l', c['parcel_l'], 0.55, 0.2),
            ribbon=mt.glossy('pack_ribbon', c['ribbon'], 0.35, 0.3),
            apple=mt.glossy('pack_apple', c['apple'], 0.25, 0.6),
            stem=mt.cloth('pack_stem', c['stem'], 0.6, 0.1),
            gift=mt.glossy('pack_gift', c['gift'], 0.35, 0.35),
            gift_rib=mt.glossy('pack_gift_rib', c['gift_rib'], 0.3, 0.4),
            star=self.star_mat('pack_star', c['star']),
            nose=mt.skin('pack_nose', c['nose']),
            mouth=mt.glossy('mouth', c['mouth'], 0.4, 0.2),
        )
        self.body()
        self.legs()
        self.arms()
        self.head()
        self.sprout()
        self.neckerchief()
        self.straps_and_badge()
        self.basket()
        ex = self.pose.get('extra', {})
        prop = ex.get('prop')
        if prop == 'gift':
            self.gift_box()
        elif prop == 'star':
            self.golden_star()
        if ex.get('sweat'):
            self.sweat_drops()

    def star_mat(self, name, color):
        def make(n):
            m = lib.NT(n)
            m.bsdf(col(color), 0.22, coat=0.8, spec=0.6, emission=col('#ffcf40'), emission_strength=0.25)
            return m.mat
        return self.m.get(name, make)

    # --- body -----------------------------------------------------------------------------
    def body(self):
        shape = self.body_shape()
        verts, faces, dirs = shape.mesh(48, 30)
        tips = []
        for d in dirs:
            yaw, pitch = yaw_pitch(Vector(d))
            e = math.hypot(yaw / 68.0, (pitch - 4.0) / 80.0)
            tips.append(0.22 + 0.78 * (1.0 - sstep((e - 0.7) / 0.4)))
        self.add('body', (verts, faces), self.mat['skin'], 'spine', tip=tips)

    # --- legs and feet ----------------------------------------------------------------------
    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('leg' + s_, hip, kn, an, lambda t: 0.125 - 0.008 * t, M['skin'], 0.0, 0.9, 16, 16)
            self.parts[-1].tip = [0.2] * len(self.parts[-1].verts)
            fm = self.J(an) @ R(0, 0, -8 * sd)
            self.add('foot' + s_, superellipsoid(0.15, 0.19, 0.1, 2.25, 28, 18, center=(0, -0.05, -0.05)), M['foot'], None, fm)

    # --- arms and hands ---------------------------------------------------------------------
    def arms(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.14 - 0.036 * t, M['skin'], 0.0, 1.0, 16, 14, extend=0.02)
            self.parts[-1].tip = [0.24] * len(self.parts[-1].verts)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.6):
                self.addt('hand' + nm + s_, mesh, M['skin'], None, wm, 0.27)

    # --- head and face ------------------------------------------------------------------------
    def hood(self, yaw, pitch):
        """1 on the cream face, 0 under the green 'hood' that covers the top, sides and back."""
        a = abs(yaw)
        b = interp([(0, 46.0), (26, 45.0), (50, 38.0), (70, 24.0), (90, 0.0), (118, -60.0), (140, -95.0)], a)
        top = 1.0 - sstep((pitch - b + 6.0) / 12.0)
        side = 1.0 - sstep((a - 72.0) / 14.0)
        return top * side

    def head(self):
        head = self.head_shape()
        verts, faces, dirs = head.mesh()
        tips = []
        for d in dirs:
            yaw, pitch = yaw_pitch(Vector(d))
            tips.append(0.22 + 0.78 * self.hood(yaw, pitch))
        self.add('head', (verts, faces), self.mat['skin'], 'head', tip=tips)
        self.sprout_face(head)

    # mouth sizes (half width, depth) for this big-mouthed face; the stock Hero.face() mouths are drawn
    # for smaller faces, so these are the same shapes and materials scaled up
    MOUTHS = {'open': (0.125, 0.105), 'laugh': (0.135, 0.125), 'grin': (0.12, 0.07)}

    def sprout_face(self, head: Blob):
        c, mt = self.C, self.m
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        mouth = f['mouth']
        ey, ep = self.EYE
        ew, eh = self.EYE_SIZE
        custom = mouth in ('cat', 'gasp') or mouth in self.MOUTHS
        kw = dict(eye_yaw=ey, eye_pitch=ep, eye_size=(ew, eh), iris=c['iris'], brow_col='#6b8a2a', mouth_pitch=self.MOUTH_PITCH,
                  mouth_w=0.9, lid_col=c['cream'], nose=False, skin=None, blush=False, brow_pitch=20.0, lash_col=c['lash'])
        n0 = len(self.parts)
        base = dict(f, mouth='flat') if custom else f
        if f['eyes'] == 'winkL':
            # the left eye closed, the right one open: build both looks and keep one eye of each
            left = {'scleraL', 'irisL', 'pupilL', 'shineL', 'shine2L', 'lashL', 'lidL', 'spiralL'}
            self.pose['face'] = dict(base, eyes='open')
            self.face(head, 'head', **kw)
            keep = [p for p in self.parts[n0:] if p.name not in left]
            del self.parts[n0:]
            self.pose['face'] = dict(base, eyes='happy')
            self.face(head, 'head', **kw)
            keep += [p for p in self.parts[n0:] if p.name == 'happyL']
            del self.parts[n0:]
            self.parts.extend(keep)
        else:
            self.pose['face'] = base
            self.face(head, 'head', **kw)
        self.pose['face'] = f
        # the design has no eyebrows; closed 'happy' eyes are redrawn bolder so they read at crowd size
        drop = {'browL', 'browR', 'happyL', 'happyR'} | ({'mouth'} if custom else set())
        happy = [p.name for p in self.parts[n0:] if p.name in ('happyL', 'happyR')]
        self.parts[n0:] = [p for p in self.parts[n0:] if p.name not in drop]
        lash = mt.glossy(f'lash_{c["lash"]}', c['lash'], 0.4, 0.2)
        for name in happy:
            side = 1 if name.endswith('L') else -1
            fr = head.frame(ey * side, ep, -ew * 0.34 * 0.55)
            pts = [q + Vector((0, 0, -eh * 0.12)) for q in arc_points(ew * 1.75, -eh * 0.5, 14, y=-0.01)]
            self.feat(name, sweep(pts, lambda t: 0.012 + 0.009 * math.sin(math.pi * t), 8), lash, 'head', head, fr)
        if custom:
            self.big_mouth(head, mouth)
        # a tiny pink nose and big rosy cheeks
        self.feat('nose', ellipsoid(0.024, 0.02, 0.018, 14, 8), self.mat['nose'], 'head', head, head.frame(0, ep - 10.0, -0.006))
        bl = self.m.alpha('pack_blush', c['blush'], 0.55)
        for sd in (1, -1):
            self.feat('blush', ellipsoid(0.09, 0.004, 0.056, 18, 6), bl, 'head', head, head.frame(sd * (ey + 15.0), ep - 20.0, 0.003))

    def big_mouth(self, head: Blob, kind: str):
        mt = self.m
        mouth_m = self.mat['mouth']
        tongue = mt.glossy('tongue', '#e8797b', 0.35, 0.3)
        teeth = mt.glossy('teeth', '#fffdf6', 0.25, 0.4)
        if kind == 'cat':
            # a small w-shaped smile: two little arcs meeting under the nose
            mf = head.frame(0, self.MOUTH_PITCH, 0.0)
            w = 0.056
            for sd in (1, -1):
                pts = [q + Vector((sd * w / 2, 0.0, 0.0)) for q in arc_points(w, 0.02, 10, y=-0.006)]
                self.feat('mouth', sweep(pts, lambda t: 0.008 + 0.003 * math.sin(math.pi * t), 8), mouth_m, 'head', head, mf)
        elif kind == 'gasp':
            mf = head.frame(0, self.MOUTH_PITCH, 0.0)
            self.feat('mouth', ellipsoid(0.056, 0.022, 0.074, 18, 12), mouth_m, 'head', head, mf @ T(0, 0.004, -0.03))
            self.feat('tongue', ellipsoid(0.03, 0.012, 0.024, 12, 6, center=(0, -0.012, -0.074)), tongue, 'head', head, mf)
        else:
            mf = head.frame(0, self.MOUTH_PITCH + 6.0, 0.0)
            hw, hh = self.MOUTHS[kind]
            self.feat('mouth', ellipsoid(hw, 0.022, hh, 24, 14, zmax=0.14), mouth_m, 'head', head, mf @ T(0, 0.002, 0.008))
            self.feat('tongue', ellipsoid(hw * 0.6, 0.013, hh * 0.42, 16, 8, center=(0, -0.009, -hh * 0.64)), tongue, 'head', head, mf)
            if kind != 'laugh':
                self.feat('teeth', ellipsoid(hw * 0.7, 0.011, 0.014, 14, 6, center=(0, -0.013, -0.004)), teeth, 'head', head, mf)

    def sprout(self):
        """Two big glossy leaves on a short stem at the crown."""
        M = self.mat
        _hx, _hy, hz, hc = self.HEAD
        base = Vector((0.0, 0.01, hc + hz - 0.03))
        top = base + Vector((0.0, -0.005, 0.09))
        stem = sweep([base, base + Vector((0, 0, 0.045)), top], lambda t: 0.036 - 0.01 * t, 12)
        self.addt('stem', stem, M['leaf'], 'head', None, 0.62)
        b = Batch()
        sway = self.pose.get('extra', {}).get('sway', 0.0)
        for sd in (1, -1):
            d0 = Vector((0.8 * sd, -0.04, 0.7 + 0.05 * sway * sd))
            n0 = Vector((0.0, -1.0, 0.3))
            b.add(leaf(top - Vector((0, 0, 0.012)), d0, n0, 0.57, leaf_width(0.37, 0.45, 0.85, 0.12), -6.0, -14.0 * sd, 0.0,
                       0.1, 0.12, (0.1, 1.0), 0.22, 16))
        b.emit(self, 'leaves', M['leaf'], 'head')

    # --- neckerchief, straps and badge ------------------------------------------------------------
    def neckerchief(self):
        M = self.mat
        self.add('scarf', torus(0.33, 0.13, 48, 14), M['scarf'], 'chest', T(0, 0.0, 0.15) @ R(10, 0, 0) @ S(1.0, 0.88, 1.0))
        # a broad rounded bib hanging at the front, a little to the right
        flap = leaf(Vector((-0.05, -0.36, 0.12)), Vector((-0.12, -0.35, -1.0)), Vector((0.0, -1.0, 0.3)), 0.22,
                    leaf_width(0.46, 0.3, 0.6, 0.8), 18.0, 0.0, 0.0, 0.2, 0.08, (0.5, 0.5), 0.0, 10)
        self.add('scarfflap', flap[:2], M['scarf_d'], 'chest')

    def straps_and_badge(self):
        M = self.mat
        body = self.body_shape()
        for sd, nm in ((1, 'L'), (-1, 'R')):
            ctrl = [(36, 64), (42, 38), (54, 10), (74, -14), (102, -22), (132, -16)]
            pts = catmull_rom([body.point(y * sd, p, 0.016)[0] for (y, p) in ctrl], 6)
            self.add('strap' + nm, sweep(pts, 0.046, 10, squash=0.36), M['strap'], 'spine')
        # the badge on the left strap: a wooden disc with a rim, a yellow-green face and a clover
        pos, n = body.point(17.0, 24.0, 0.05)
        bm = frame_on(pos, n + Vector((0.0, 0.0, -0.2)))
        self.add('badge', disc(0.185, 0.06, 44), M['wood'], 'spine', bm)
        self.add('badgerim', torus(0.17, 0.033, 44, 10), M['wood_d'], 'spine', bm @ R(90, 0, 0))
        self.add('badgeface', disc(0.13, 0.068, 40), M['badge'], 'spine', bm)
        clover = []
        for k in range(4):
            clover.append(placed(R(0, 45 + 90 * k, 0) @ T(0, 0, 0.042), ellipsoid(0.038, 0.014, 0.045, 12, 8)))
        clover.append(placed(R(0, 20, 0), sweep([Vector((0, 0, 0)), Vector((0.013, 0, -0.05)), Vector((0.037, 0, -0.086))], 0.01, 6)))
        self.add('clover', merge(clover), M['clover'], 'spine', bm @ T(0, -0.04, 0))

    # --- basket ---------------------------------------------------------------------------------
    BASKET = dict(x=0.03, y=0.86, top=0.31, H=0.8, ax=(0.48, 0.7), ay=(0.3, 0.42), fwd=0.12)

    def basket(self):
        M = self.mat
        B = self.BASKET
        H, (ax0, ax1), (ay0, ay1) = B['H'], B['ax'], B['ay']
        # basket frame: origin at the centre of the rim, in the chest frame
        bf = T(B['x'], B['y'], B['top'])
        n, seg, p = 22, 64, 2.3
        e = 2.0 / p

        def section(t):
            """Half sizes and the y offset of the wall's cross-section at height t (0 bottom, 1 rim)."""
            g = t ** 0.8
            belly = 1.0 + 0.07 * math.sin(math.pi * min(1.0, t / 0.9)) ** 1.5
            ax, ay = (ax0 + (ax1 - ax0) * g) * belly, (ay0 + (ay1 - ay0) * g) * belly
            if t < 0.16:
                r = math.sqrt(max(0.0, 1.0 - ((0.16 - t) / 0.16) ** 2))
                ax, ay = ax * (0.35 + 0.65 * r), ay * (0.35 + 0.65 * r)
            return ax, ay, -B['fwd'] * (1.0 - t)

        verts, faces = [], []
        rows = []
        for i in range(n + 1):
            t = i / n
            ax, ay, dy = section(t)
            row = []
            for k in range(seg):
                a = k / seg * math.tau
                ca, sa = math.cos(a), math.sin(a)
                verts.append((math.copysign(abs(ca) ** e, ca) * ax, dy + math.copysign(abs(sa) ** e, sa) * ay, -H + H * t))
                row.append(len(verts) - 1)
            rows.append(row)
        verts.append((0.0, -B['fwd'], -H))
        bot = len(verts) - 1
        for i in range(n):
            for k in range(seg):
                k2 = (k + 1) % seg
                faces.append((rows[i][k], rows[i][k2], rows[i + 1][k2], rows[i + 1][k]))
        for k in range(seg):
            faces.append((bot, rows[0][(k + 1) % seg], rows[0][k]))
        self.add('basket', (verts, faces), M['wicker'], 'chest', bf)
        # the inside (dark) just under the rim
        inner = superellipsoid(ax1 - 0.03, ay1 - 0.03, 0.01, p, seg, 6, center=(0, 0, -0.05))
        self.add('basket_in', inner, M['inside'], 'chest', bf)
        # braided rim: two thick strands twisting round the top edge
        for strand in range(2):
            pts = []
            N = 200
            for j in range(N + 1):
                a = j / N * math.tau
                ca, sa = math.cos(a), math.sin(a)
                cx, cy = math.copysign(abs(ca) ** e, ca) * (ax1 + 0.02), math.copysign(abs(sa) ** e, sa) * (ay1 + 0.02)
                out = Vector((ca, sa, 0.0))
                ph = a * 20 + strand * math.pi
                pts.append(Vector((cx, cy, 0.0)) + out * (0.03 * math.cos(ph)) + Vector((0, 0, 0.034 * math.sin(ph))))
            self.add(f'rim{strand}', sweep(pts, 0.045, 10, cap0=False, cap1=False), M['rim'], 'chest', bf)
        self.basket_contents(bf)

    def basket_contents(self, bf: Matrix):
        M = self.mat
        # parcels: yellow boxes with blue ribbon crosses poking out of the top
        for name, half, pos, rot, mat in (
                ('parcelA', (0.3, 0.2, 0.16), (-0.24, 0.05, 0.13), (4, -10, 12), 'parcel'),
                ('parcelB', (0.2, 0.16, 0.15), (0.3, 0.08, 0.1), (-6, 10, -16), 'parcel_l'),
                ('parcelC', (0.16, 0.14, 0.13), (0.06, 0.24, 0.27), (0, 6, 25), 'parcel_l')):
            box, rib = parcel(*half)
            m = bf @ T(*pos) @ R(*rot)
            self.add(name, box, M[mat], 'chest', m)
            self.add(name + '_rib', rib, M['ribbon'], 'chest', m)
        # a red apple at the front of the pile
        body, stem = apple(0.105)
        am = bf @ T(-0.44, -0.16, 0.08) @ R(8, -10, 0)
        self.add('apple', body, M['apple'], 'chest', am)
        self.add('apple_stem', stem, M['stem'], 'chest', am)
        lf = leaf(Vector((0.03, 0.0, 0.1)), Vector((0.8, -0.3, 0.5)), Vector((0.0, -1.0, 0.4)), 0.09, leaf_width(0.055), 10, 0, 0, 0.14,
                  0.1, (0.4, 0.95), 0.1, 8)
        self.add('apple_leaf', lf[:2], M['leaf'], 'chest', am, tip=lf[2])
        # a big leaf tucked into the rim on the right side
        lf = leaf(Vector((-0.62, -0.1, -0.02)), Vector((-1.0, -0.3, -0.3)), Vector((-0.2, -1.0, 0.3)), 0.26, leaf_width(0.17, 0.42, 0.9),
                  -14, 0, 0, 0.1, 0.1, (0.2, 0.95), 0.2, 12)
        self.add('basket_leaf', lf[:2], M['leaf'], 'chest', bf, tip=lf[2])

    # --- props ------------------------------------------------------------------------------------
    def root_frame(self, p: Vector) -> Matrix:
        yaw = self.pose.get('root', {}).get('yaw', 0.0)
        return T(*p) @ R(0, 0, yaw)

    def gift_box(self):
        M = self.mat
        hand = self.J('wristL') @ Vector((0.0, 0.0, -0.09))
        m = self.root_frame(hand) @ T(0.06, 0.1, 0.25) @ R(0, -6, -12)
        box, rib = parcel(0.26, 0.22, 0.25, 0.045, 0.009)
        self.add('gift', box, M['gift'], None, m)
        self.add('gift_rib', rib, M['gift_rib'], None, m)
        self.add('gift_bow', bow(1.65), M['gift_rib'], None, m @ T(0, 0, 0.25))

    def sweat_drops(self):
        """Little blue drops flying off the head (the surprised pose), facing the camera."""
        c = self.J('head') @ Vector((0.0, 0.0, self.HEAD[3] + 0.05))
        mat = self.m.emit('pack_sweat', '#3aa4ee', 0.5)
        drops = []
        for ang, dist, r in ((136, 0.92, 0.075), (160, 0.98, 0.062), (24, 0.78, 0.052)):
            d = Vector((math.cos(math.radians(ang)), 0.0, math.sin(math.radians(ang))))
            tilt = 90.0 - ang  # the tip points away from the head
            drops.append(placed(T(*(d * dist)) @ R(0, -tilt, 0), teardrop(r)))
        self.add('sweat', merge(drops), mat, None, T(*c) @ T(0, -0.3, 0))

    def golden_star(self):
        M = self.mat
        hand = self.J('wristL') @ Vector((0.0, 0.0, -0.09))
        m = self.root_frame(hand) @ T(0.02, -0.04, 0.26) @ R(0, -14, -20)
        self.add('star', puffy_star(0.25, 0.12, 0.11), M['star'], None, m)
        # three bold emphasis ticks flashing out above the star (simple glowing wedges facing the camera)
        c = m.to_translation()
        glow = self.m.emit('pack_tick', '#ffd21e', 1.1)
        ticks = []
        for ang, dist, ln in ((128, 0.37, 0.13), (78, 0.4, 0.16), (26, 0.37, 0.12)):
            d = Vector((math.cos(math.radians(ang)), 0.0, math.sin(math.radians(ang))))
            a, b = d * dist, d * (dist + ln)
            ticks.append(sweep([a, a.lerp(b, 0.5), b], lambda t: 0.026 + 0.03 * t, 8, squash=0.4))
        self.add('ticks', merge(ticks), glow, None, T(*c) @ T(0, -0.1, 0))


MODEL = Packsprout

# ------------------------------------------------------------------------------------------
# Poses (see char_anims.py for the conventions). All keep the heroes' three-quarter facing; in the walks the
# head turns a little further right and STRIDE swings the legs across the picture.
WALK_YAW = 16.0
STRIDE = dict(hips=(0, 0, 74), spine=(0, 0, -74))  # the legs stride across the picture; the body stays three-quarters
POSES = {
    'idle': pose(
        armL=(40, 10, 0, 30), armR=(40, 10, 0, 30), legL=(0, 4, 0, 2), legR=(0, 4, 0, 2),
        face=face('open', 'cat')),
    'happy': pose(
        root=dict(yaw=WALK_YAW, lean=5.0, pos=(0.0, -0.14, 0.0)), **STRIDE, chest=(-3, 0, 0), head=(-4, 4, 10),
        armL=(112, 34, 60, 40), armR=swing(55, 15, 0, 100), handL='open',
        legL=(20, 4, 0, 4), legR=(-34, 4, 0, 30), footL=(0, 0, 74), footR=(34, 0, 74),
        face=face('winkL', 'open')),
    'gift': pose(
        root=dict(yaw=WALK_YAW, lean=5.0, pos=(0.0, -0.14, 0.0)), **STRIDE, chest=(-3, 0, 0), head=(-2, 5, 10),
        armL=(118, 44, 40, 55), armR=swing(40, 12, 0, 90), handL='open',
        legL=(20, 4, 0, 4), legR=(-33, 4, 0, 30), footL=(0, 0, 74), footR=(34, 0, 74),
        face=face('happy', 'laugh'), extra=dict(prop='gift')),
    'cheer': pose(
        root=dict(yaw=10.0), chest=(-4, 0, 0), head=(4, 0, 0),
        armL=(130, -4, 80, 12), armR=(130, -4, 80, 12), handL='open', handR='open',
        legL=(0, 8, 0, 4), legR=(0, 8, 0, 4),
        face=face('open', 'open')),
    'surprised': pose(
        root=dict(yaw=18.0, lean=-6.0, pos=(0.0, -0.1, 0.0)), **STRIDE, chest=(-4, 0, 0), head=(4, 0, 0),
        armL=(98, 18, 60, 30), armR=swing(60, 30, 0, 30), handL='open',
        legL=(16, 4, 0, 4), legR=(-24, 4, 0, 30), footL=(0, 0, 74), footR=(25, 0, 74),
        face=face('wide', 'gasp', 'up'), extra=dict(sweat=True)),
    'star': pose(
        root=dict(yaw=WALK_YAW, lean=-3.0, pos=(0.0, -0.2, 0.0)), **STRIDE, chest=(-4, 0, 0), head=(4, 6, 10),
        armL=(130, 70, 80, 20), armR=swing(45, 15, 0, 95), handL='open',
        legR=(92, 4, 0, 30), legL=(-4, 4, 0, 4), footR=(-40, 0, 74), footL=(0, 0, 74),
        face=face('happy', 'laugh'), extra=dict(prop='star')),
}
