"""Tumble Flint: a big, gentle stone golem hero (see char_models.py for the Hero base class).

He is built from rounded warm-grey boulders (Mats.stone: softly glowing cyan cracks, moss on
upward faces): a broad torso boulder, a round head boulder set into its top-front, huge boulder
arms (shoulder, upper arm, forearm, fist) and short thick legs with big boulder feet. Glowing cyan
gems ring the elbow and knee creases; moss clumps with tiny flowers grow on his head and
shoulders; a red sash with a knot and two tails wraps his waist and a bronze medallion with a teal
spiral hangs on his hip.

Every boulder is a rigid part placed with its joint's matrix, so the object-space stone texture
sticks to it in every pose. Each boulder samples its own region of the stone texture (TEX below):
the regions were picked so the face and hands stay clean and the body shows only a crack here and
there besides the deliberate glowing seams that outline his chest plate.

His arms are long and heavy (raised arms clear his head, fists hang by his knees); in the run he
swings them low rather than pumping his fists up in front of his low-set face (heavy_arms).
"""
from __future__ import annotations

import math
import random

from mathutils import Matrix, Vector, noise

import lib
from char_rig import I4, HeadShape, R, S, T, apply, arm_rot, bend, cloth_strip, disc, ellipsoid, superellipsoid, sweep, torus
from char_models import DEFAULT_FACE, Hero


# ------------------------------------------------------------------------------------------
# Geometry helpers
def boulder(rx, ry, rz, p=2.6, seed=0.0, lump=0.05, freq=1.25, taper=0.0, seg=30, rings=20, center=(0.0, 0.0, 0.0)):
    """A rounded boulder: a superellipsoid (p = 2 is an ellipsoid, higher is boxier) with gentle
    low-frequency lumps. taper > 0 widens it towards +Z, taper < 0 towards -Z."""
    verts, faces = superellipsoid(1.0, 1.0, 1.0, p, seg, rings)
    cx, cy, cz = center
    off = Vector((seed * 1.37, seed * 2.11, seed * 0.73))
    out = []
    for (x, y, z) in verts:
        k = 1.0 + lump * noise.noise(Vector((x, y, z)) * freq + off)
        tz = 1.0 + taper * z
        out.append((cx + rx * x * k * tz, cy + ry * y * k * tz, cz + rz * z * k))
    return out, faces


def boulder_point(yaw, pitch, lift=0.0, rx=1.0, ry=1.0, rz=1.0, p=2.6, seed=0.0, lump=0.05, freq=1.25, taper=0.0, center=(0.0, 0.0, 0.0)):
    """The point of boulder(...) in direction (yaw, pitch) — yaw 0 = front (-Y), 90 = +X — lifted
    off the surface by `lift` (for seams and details that must hug the stone)."""
    y_, p_ = math.radians(yaw), math.radians(pitch)
    d = Vector((math.sin(y_) * math.cos(p_), -math.cos(y_) * math.cos(p_), math.sin(p_)))
    e = 2.0 / p
    u = Vector([math.copysign(abs(c) ** e, c) for c in d])
    k = 1.0 + lump * noise.noise(u * freq + Vector((seed * 1.37, seed * 2.11, seed * 0.73)))
    tz = 1.0 + taper * u.z
    q = Vector((rx * u.x * k * tz, ry * u.y * k * tz, rz * u.z * k))
    n = Vector((q.x / rx ** 2, q.y / ry ** 2, q.z / rz ** 2)).normalized()
    return Vector(center) + q + n * lift


def boulder_surf(**params):
    """(yaw, pitch) -> (point, normal) on boulder(**params), for moss that hugs the stone."""
    params = {k: v for k, v in params.items() if k not in ('seg', 'rings')}

    def surf(yaw, pitch):
        p0 = boulder_point(yaw, pitch, **params)
        du = boulder_point(yaw + 1.0, pitch, **params) - boulder_point(yaw - 1.0, pitch, **params)
        dv = boulder_point(yaw, min(89.9, pitch + 1.0), **params) - boulder_point(yaw, max(-89.9, pitch - 1.0), **params)
        n = dv.cross(du)
        c = Vector(params.get('center', (0.0, 0.0, 0.0)))
        if n.dot(p0 - c) < 0:
            n = -n
        return p0, n.normalized()
    return surf


def merge(meshes):
    verts, faces = [], []
    for v, f in meshes:
        base = len(verts)
        verts.extend(v)
        faces.extend(tuple(q + base for q in fc) for fc in f)
    return verts, faces


def placed(m: Matrix, mesh):
    return apply(m, mesh[0]), mesh[1]


def orient(pos, nrm, roll: float = 0.0) -> Matrix:
    """A frame at `pos` whose -Y faces along `nrm` (features are modelled facing -Y, up +Z)."""
    fwd = -Vector(nrm).normalized()
    x = fwd.cross(Vector((0.0, 0.0, 1.0)))
    if x.length < 1e-4:
        x = Vector((1.0, 0.0, 0.0))
    x.normalize()
    z = x.cross(fwd).normalized()
    m = Matrix((x, fwd, z)).transposed().to_4x4()
    m.translation = Vector(pos)
    return m @ R(0, roll, 0)


def ellipsoid_point(rx, ry, rz, yaw, pitch):
    """Surface point and normal of an origin-centred ellipsoid: yaw 0 = front (-Y), 90 = +X."""
    y, p = math.radians(yaw), math.radians(pitch)
    d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    k = 1.0 / math.sqrt((d.x / rx) ** 2 + (d.y / ry) ** 2 + (d.z / rz) ** 2)
    pos = d * k
    return pos, Vector((pos.x / rx ** 2, pos.y / ry ** 2, pos.z / rz ** 2)).normalized()


def ring_band(rx, ry, prof, seg=64, p=2.0, zfun=None):
    """A closed band around the Z axis following a superellipse (rx, ry, exponent p). `prof` is a
    closed cross-section [(dr, z), ...]: the outer side from bottom to top, then back down the
    inside. zfun(a) shifts the band vertically per angle."""
    verts, faces = [], []
    n = len(prof)
    e = 2.0 / p
    for i in range(seg):
        a = i / seg * math.tau
        ca, sa = math.cos(a), math.sin(a)
        ex, ey = math.copysign(abs(ca) ** e, ca), math.copysign(abs(sa) ** e, sa)
        dz = zfun(a) if zfun else 0.0
        for dr, z in prof:
            verts.append((ex * rx + ca * dr, ey * ry + sa * dr, z + dz))
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(n):
            j2 = (j + 1) % n
            faces.append((i * n + j, i2 * n + j, i2 * n + j2, i * n + j2))
    return verts, faces


def flower_mesh(size: float = 1.0):
    """Five rounded petals facing -Y (the pollen centre is added separately)."""
    meshes = []
    for k in range(5):
        m = R(0, k * 72.0, 0) @ T(0.0, 0.0, 0.021 * size)
        meshes.append(placed(m, ellipsoid(0.012 * size, 0.005 * size, 0.019 * size, 10, 6)))
    return merge(meshes)


def spiral_points(r0, r1, turns, n=60, y=0.0):
    pts = []
    for i in range(n + 1):
        t = i / n
        a = t * turns * math.tau
        r = r0 + (r1 - r0) * t
        pts.append(Vector((math.cos(a) * r, y, math.sin(a) * r)))
    return pts


def seed_of(name: str) -> float:
    return float(sum((i + 1) * ord(ch) for i, ch in enumerate(name)) % 97)


# Stone texture regions (object-space offsets) per boulder, picked by rendering Mats.stone on many
# spheres and counting crack pixels from five sides: clean regions for the head, torso and hands,
# a crack or two on the shoulders and legs (the chest-plate seams are separate glowing parts).
TEX = {
    'head': (3.86, -0.38, -3.4), 'torso': (3.15, 1.02, 0.35), 'belly': (-2.03, 1.11, -0.69), 'pelvis': (-2.92, -0.95, -1.68),
    'shoulderL': (-2.8, -0.17, -1.03), 'shoulderR': (-2.65, -0.39, -1.8), 'upperL': (-1.28, -0.95, 2.9), 'upperR': (0.0, -1.11, -1.54),
    'foreL': (-0.83, 2.38, -2.97), 'foreR': (1.26, -2.83, 1.46), 'handL': (-3.97, -0.8, -1.6), 'handR': (3.11, -4.0, -2.28),
    'thighL': (-0.33, 3.5, -0.87), 'thighR': (1.43, -2.38, -2.64), 'shinL': (0.4, -2.58, 1.57), 'shinR': (0.58, -2.95, -1.1),
    'footL': (1.74, -2.51, -2.26), 'footR': (0.02, 3.57, -0.39),
}
# the big boulders sample a smaller patch of the texture, so a clean one fits (no glowing cracks
# across the face; only a few on the body besides the deliberate seams)
TEX_SCALE = {'head': 0.62, 'torso': 0.65, 'belly': 0.65, 'pelvis': 0.65, 'foreL': 0.85, 'foreR': 0.85, 'handL': 0.85, 'handR': 0.85}


# ------------------------------------------------------------------------------------------
class Tumble(Hero):
    """Tumble Flint: a gentle stone golem — boulder body, huge fists, mossy crest, red sash."""

    key = 'tumble'
    ankle_h = 0.16
    sit_h = 0.3
    hip_h = 0.62
    spine = 0.14
    chest = 0.34
    neck = 0.1
    head_up = 0.06
    shoulder = (0.56, 0.06, 0.28)
    upper_arm = 0.35
    forearm = 0.37
    hip_w = 0.22
    thigh = 0.2
    shin = 0.22

    HEAD = (0.44, 0.36, 0.385, 0.2, -0.2)  # rx, ry, rz, centre height and depth in the head frame
    C = dict(sash='#d8322c', sash_d='#b3241f', bronze='#c8903a', rim='#d9a453', teal='#178f8c', spiral='#9ff6ef',
             gem='#5fe8f7', petal='#fbf8ee', pollen='#f6c945', iris='#1f5a4e', cord='#7a4a26', smile='#4a231f')
    # moss tones (dark, mid, light patches) per layer, and orange lichen specks
    MOSS = dict(d=('#34591f', '#4f7c2b', '#76a238'), m=('#4a7526', '#6e9c34', '#9cc24a'), l=('#6c9a30', '#98c048', '#c4dc6a'),
                lichen=('#b0662a', '#cf8a3a', '#e3ae55'))

    def head_top(self) -> float:
        hx, hy, hz, hc, hd = self.HEAD
        return hc + hz + 0.2

    # --- materials --------------------------------------------------------------------------------
    def materials(self):
        c, mt = self.C, self.m
        self.stone = mt.stone('tumble_stone')
        self.plain = mt.get('tumble_stone_plain', _plain_stone)
        self.moss = mt.get('tumble_moss', _moss_mat(*self.MOSS['m']))
        self.moss_l = mt.get('tumble_moss_l', _moss_mat(*self.MOSS['l']))
        self.moss_d = mt.get('tumble_moss_d', _moss_mat(*self.MOSS['d']))
        self.lichen = mt.get('tumble_lichen', _moss_mat(*self.MOSS['lichen']))
        self.smile = mt.glossy('tumble_smile', c['smile'], 0.45, 0.2)
        self.petal = mt.glossy('tumble_petal', c['petal'], 0.45, 0.2)
        self.pollen = mt.glossy('tumble_pollen', c['pollen'], 0.4, 0.3)
        self.gem = mt.emit('tumble_gem', c['gem'], 2.2)
        self.sash = mt.cloth('tumble_sash', c['sash'], 0.7, 0.45, 0.08)
        self.sash_d = mt.cloth('tumble_sash_d', c['sash_d'], 0.7, 0.4)
        self.bronze = mt.glossy('tumble_bronze', c['bronze'], 0.38, 0.5)
        self.bronze_d = mt.metal('tumble_bronze_d', c['rim'], 0.3)
        self.teal = mt.glossy('tumble_teal', c['teal'], 0.3, 0.6)
        self.spiral = mt.emit('tumble_spiral', c['spiral'], 1.2)
        self.cord = mt.cloth('tumble_cord', c['cord'], 0.6, 0.2)

    # --- part helpers -------------------------------------------------------------------------------
    def rock(self, name, meshes, joint=None, local=I4, tex=None, mat=None, center=None):
        """A rigid stone part: `meshes` (one mesh or a list, merged) in the frame joint @ local.
        Its object-space texture is centred on the stone region TEX[tex]: the point `center` (by
        default the middle of the first mesh) samples the middle of that region."""
        if isinstance(meshes, tuple):
            meshes = [meshes]
        if center is None:
            main = meshes[0][0]
            lo = Vector([min(v[i] for v in main) for i in range(3)])
            hi = Vector([max(v[i] for v in main) for i in range(3)])
            c = (lo + hi) * 0.5
        else:
            c = Vector(center)
        verts, faces = merge(meshes)
        key = tex or name
        tp = Vector(TEX.get(key, (seed_of(name) * 0.07, -seed_of(name) * 0.05, seed_of(name) * 0.03)))
        k = TEX_SCALE.get(key, 1.0)
        # object coords = (v - c) * k + tp; the matrix undoes it so the part stays in place
        verts = [tuple((Vector(v) - c) * k + tp) for v in verts]
        self.add(name, (verts, faces), mat or self.stone, joint, local @ T(*c) @ S(1.0 / k) @ T(*(-tp)))

    def moss_patch(self, name, joint, local, radii, yaw0, pitch0, spread, count, size, flat=0.55, flowers=0):
        """A patch of small moss clumps scattered over a surface (an origin-centred ellipsoid `radii`,
        or a function (yaw, pitch) -> (point, normal) such as boulder_surf) in the frame joint @ local,
        around the direction (yaw0, pitch0): yaw 0 = front (-Y), 90 = +X,
        pitch 90 = top. A dark and a mid layer hug the surface, lighter tufts sit on top; `flowers`
        tiny flowers are dotted over the light tufts."""
        rng = random.Random(seed_of(name))
        surf = radii if callable(radii) else (lambda yw, pt: ellipsoid_point(*radii, yw, pt))
        layers = {'d': [], 'm': [], 'l': []}
        tops = []
        for i in range(count + count // 2):
            top_layer = i >= count
            yaw = yaw0 + rng.uniform(-1.0, 1.0) * spread[0] * (0.8 if top_layer else 1.0)
            pitch = min(89.0, pitch0 + rng.uniform(-1.0, 1.0) * spread[1] * (0.8 if top_layer else 1.0))
            s = size * rng.uniform(0.65, 1.15) * (0.75 if top_layer else 1.0)
            pos, n = surf(yaw, pitch)
            v, f = lib.blob((0.0, 0.0, 0.0), s, (1.0, 1.0, flat), rough=0.34, freq=3.2, subdiv=2, seed=rng.uniform(0.0, 100.0))
            rot = Vector((0.0, 0.0, 1.0)).rotation_difference(n).to_matrix().to_4x4() @ R(0, 0, rng.uniform(0.0, 360.0))
            lift = s * flat * (0.9 if top_layer else 0.25)
            layer = 'l' if top_layer else ('d' if rng.random() < 0.45 else 'm')
            layers[layer].append(placed(T(*(pos + n * lift)) @ rot, (v, f)))
            if top_layer:
                tops.append((pos + n * (lift + s * flat * 0.95), n))
        for key, mat in (('d', self.moss_d), ('m', self.moss), ('l', self.moss_l)):
            if layers[key]:
                self.add(f'{name}_{key}', merge(layers[key]), mat, joint, local)
        rot3 = local.to_3x3()
        for k in range(min(flowers, len(tops))):
            p, n = tops[(k * 5 + 1) % len(tops)]
            self.flower(f'{name}_fl{k}', joint, local @ p, rot3 @ n, 0.9 + 0.2 * (k % 2), 37 * k)

    def moss_tuft(self, name, joint, base: Vector, radius, height, count, size, flowers=0):
        """A little mossy bush (the crest on his head): clumps piled into a dome over `base`."""
        rng = random.Random(seed_of(name))
        layers = {'d': [], 'm': [], 'l': []}
        tops = []
        for i in range(count):
            a = rng.uniform(0.0, math.tau)
            r = radius * math.sqrt(rng.random())
            h = height * (1.0 - (r / radius) ** 2) * rng.uniform(0.55, 1.0)
            s = size * rng.uniform(0.7, 1.2) * (1.0 - 0.3 * h / height)
            p = base + Vector((math.cos(a) * r, math.sin(a) * r * 0.9, h))
            v, f = lib.blob((0.0, 0.0, 0.0), s, (1.0, 1.0, 0.85), rough=0.34, freq=3.2, subdiv=2, seed=rng.uniform(0.0, 100.0))
            layer = 'l' if h > height * 0.55 else ('m' if h > height * 0.25 else 'd')
            layers[layer].append(placed(T(*p) @ R(0, 0, rng.uniform(0.0, 360.0)), (v, f)))
            if layer == 'l':
                tops.append((p + Vector((0.0, 0.0, s * 0.8)), Vector((math.cos(a) * 0.5, math.sin(a) * 0.5 - 0.4, 1.0))))
        for k in range(3):
            a = rng.uniform(0.0, math.tau)
            p = base + Vector((math.cos(a) * radius * 0.55, math.sin(a) * radius * 0.5 - 0.03, height * rng.uniform(0.3, 0.6)))
            layers.setdefault('o', []).append(ellipsoid(size * 0.45, size * 0.45, size * 0.4, 10, 7, center=tuple(p)))
        for key, mat in (('d', self.moss_d), ('m', self.moss), ('l', self.moss_l), ('o', self.lichen)):
            if layers.get(key):
                self.add(f'{name}_{key}', merge(layers[key]), mat, joint)
        tops.sort(key=lambda t: t[0].y)  # flowers on the front-facing tufts first
        for k in range(min(flowers, len(tops))):
            p, n = tops[k * 2 % len(tops)]
            self.flower(f'{name}_fl{k}', joint, p, n, 0.95 + 0.2 * (k % 2), 41 * k)

    def flower(self, name, joint, pos, nrm, size=1.0, roll=0.0):
        m = orient(pos, nrm, roll)
        self.add(name, flower_mesh(size), self.petal, joint, m)
        self.add(name + 'c', ellipsoid(0.011 * size, 0.008 * size, 0.011 * size, 10, 6, center=(0, -0.004 * size, 0)), self.pollen, joint, m)

    # --- building -----------------------------------------------------------------------------------
    def build(self, world: dict, pose: dict):
        self.heavy_arms(world, pose)
        # the golem holds the chip out in front of his big open hand (not inside it)
        ex = pose.get('extra', {})
        chip = ex.get('chip')
        if chip:
            pose = dict(pose)
            pose['extra'] = dict(ex, chip=None)
        super().build(world, pose)
        if chip:
            self.held_chip_at(self.J('wristL') @ Vector((0.0, -0.13, -0.36)))
        return self.parts

    def heavy_arms(self, world: dict, pose: dict):
        """His arms are long and heavy: where a pose pumps an arm forward or back with a strongly
        bent elbow (the run), the fist would come up in front of his low-set face, so he swings
        them lower and straighter instead; an arm stretched straight out sideways (balance) sags
        at the elbow (it would otherwise reach out of the frame). Re-solves that arm in place (the
        renderer reads the hand anchors from the same world matrices)."""
        for s_, sd in (('L', 1), ('R', -1)):
            ra, sw, tw, el = pose['arm' + s_]
            ra2, el2 = ra, el
            if abs(sw) > 45 and ra < 80 and el > 60:
                ra2, el2 = ra * 0.65, 35 + (el - 60) * 0.2
            elif abs(sw) < 30 and 70 < ra < 110 and el < 30:
                el2 = el + 26
            if (ra2, el2) != (ra, el):
                sh = world['chest'] @ T(*self.skel.offset['shoulder' + s_]) @ arm_rot(sd, ra2, sw, tw)
                elw = sh @ T(*self.skel.offset['elbow' + s_]) @ bend(el2)
                wr = elw @ T(*self.skel.offset['wrist' + s_]) @ R(*pose.get('wrist' + s_, (0, 0, 0)))
                world['shoulder' + s_], world['elbow' + s_], world['wrist' + s_] = sh, elw, wr

    def dress(self):
        self.materials()
        self.body()
        self.arms()
        self.legs()
        self.sash_and_medallion()
        self.head()

    # --- torso -------------------------------------------------------------------------------------
    def body(self):
        tb = dict(rx=0.5, ry=0.42, rz=0.54, p=2.5, seed=1, lump=0.04, taper=0.08, center=(0, 0.08, 0.06))
        self.rock('torso', boulder(seg=44, rings=28, **tb), 'chest')
        # moss on his upper back (seen when he turns round)
        for sd, nm in ((1, 'L'), (-1, 'R')):
            self.moss_patch('tmoss' + nm, 'chest', I4, boulder_surf(**tb), 138 * sd, 44, (26, 18), 11, 0.07)
        self.moss_patch('tmossC', 'chest', I4, boulder_surf(**tb), 180, 58, (30, 12), 9, 0.07)
        # glowing seams: a collar under the head from shoulder to shoulder and a short drop to the sash
        collar = [boulder_point(yaw, -24 + 44 * (abs(yaw) / 58) ** 1.7, 0.006, **tb) for yaw in range(-58, 59, 4)]
        self.add('seam', sweep(collar, 0.0105, 6), self.gem, 'chest')
        bb = dict(rx=0.47, ry=0.39, rz=0.3, p=2.4, seed=2, lump=0.02, center=(0, 0.02, 0.0))
        self.rock('belly', boulder(seg=40, rings=22, **bb), 'spine')
        # the chest plate's lower edge: a seam across the belly under the chin, dipping in a V, and
        # a short crack from the V down to the sash
        edge = [boulder_point(yaw, 41 - 9 * max(0.0, 1 - abs(yaw) / 30), 0.005, **bb) for yaw in range(-66, 67, 3)]
        self.add('seam2', sweep(edge, 0.0095, 6), self.gem, 'spine')
        drop = [boulder_point(4 - 0.3 * k, 32 - 2.6 * k, 0.005, **bb) for k in range(9)]
        self.add('seam3', sweep(drop, 0.0085, 6), self.gem, 'spine')
        self.rock('pelvis', boulder(0.42, 0.35, 0.24, 2.6, seed=3, lump=0.03, seg=40, rings=22, center=(0, 0.03, -0.06)), 'hips')

    # --- arms ---------------------------------------------------------------------------------------
    def arms(self):
        ua, fa = self.upper_arm, self.forearm
        SR = (0.3, 0.27, 0.23)
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            sp = self.skel.offset[sh]
            # shoulder boulder riding on the torso's corner, draped with moss and flowers
            sm = T(sp.x + 0.08 * sd, sp.y, sp.z - 0.05) @ R(0, 22 * sd, 0)
            sb = dict(rx=SR[0], ry=SR[1], rz=SR[2], p=2.4, seed=10 + sd, lump=0.05)
            self.rock('shoulder' + s_, boulder(**sb), 'chest', sm)
            self.moss_patch('smoss' + s_, 'chest', sm, boulder_surf(**sb), -5 * sd, 64, (80, 22), 20, 0.075, flowers=3)
            self.moss_patch('sdrape' + s_, 'chest', sm, boulder_surf(**sb), 80 * sd, 30, (34, 28), 10, 0.065)
            self.moss_patch('sback' + s_, 'chest', sm, boulder_surf(**sb), 150 * sd, 48, (36, 22), 10, 0.07)
            # upper arm and forearm boulders along the bones, a glowing gem ring in the elbow crease
            self.rock('upper' + s_, boulder(0.195, 0.195, ua * 0.5 + 0.08, 2.4, seed=20 + sd, lump=0.05, taper=0.06, center=(0, 0, -ua * 0.5)), sh)
            self.add('elbowgem' + s_, torus(0.125, 0.042, 24, 8), self.gem, el)
            self.rock('fore' + s_, boulder(0.215, 0.215, fa * 0.5 + 0.07, 2.4, seed=30 + sd, lump=0.05, taper=-0.12, center=(0, 0, -fa * 0.5)), el)
            self.hand(s_, sd, wr)

    def hand(self, s_, sd, wr):
        """Big stone hands in the wrist frame (-Z runs along the forearm, -Y is the front face)."""
        kind = self.pose.get('hand' + s_, 'fist')
        if kind == 'open':
            meshes = [boulder(0.21, 0.1, 0.17, 2.7, seed=40 + sd, lump=0.04, center=(0, 0.0, -0.16))]
            for k in range(3):
                ln = 0.085 if k != 1 else 0.095
                meshes.append(boulder(0.057, 0.064, ln, 2.2, seed=44 + k, lump=0.05, center=((k - 1) * 0.11, 0.012, -0.285 - ln * 0.4)))
            meshes.append(placed(T(-0.19 * sd, -0.03, -0.13) @ R(0, 40 * sd, 0), boulder(0.058, 0.062, 0.088, 2.2, seed=48, lump=0.05)))
        else:
            meshes = [boulder(0.22, 0.2, 0.21, 2.8, seed=40 + sd, lump=0.04, center=(0, 0.01, -0.2))]
            # curled fingers: rolls across the front face, stacked along the hand
            for k, (z, w) in enumerate(((-0.12, 0.18), (-0.22, 0.185), (-0.32, 0.172))):
                meshes.append(boulder(w, 0.075, 0.056, 2.3, seed=50 + k, lump=0.04, center=(0.01 * sd, -0.15, z)))
            # the thumb wraps across the top roll from the inner side
            meshes.append(placed(T(-0.13 * sd, -0.185, -0.1) @ R(0, -70 * sd, 0), boulder(0.056, 0.062, 0.12, 2.2, seed=49, lump=0.04)))
        self.rock('hand' + s_, meshes, wr)

    # --- legs ---------------------------------------------------------------------------------------
    def legs(self):
        th, sh_ = self.thigh, self.shin
        for s_, sd in (('L', 1), ('R', -1)):
            hp, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.rock('thigh' + s_, boulder(0.19, 0.19, th * 0.5 + 0.09, 2.4, seed=60 + sd, lump=0.04, center=(0, 0, -th * 0.5)), hp)
            self.add('kneegem' + s_, torus(0.135, 0.042, 24, 8), self.gem, kn)
            self.rock('shin' + s_, boulder(0.18, 0.18, sh_ * 0.5 + 0.06, 2.4, seed=70 + sd, lump=0.04, taper=-0.06, center=(0, 0, -sh_ * 0.5)), kn)
            self.moss_patch('amoss' + s_, kn, T(0, 0, -sh_ * 0.5), (0.18, 0.18, sh_ * 0.5 + 0.06), 30 * sd, -40, (70, 10), 7, 0.05)
            fm = self.J(an) @ R(0, 0, -8 * sd)
            self.rock('foot' + s_, boulder(0.23, 0.3, 0.13, 2.8, seed=80 + sd, lump=0.04, center=(0, -0.08, -0.03)), None, fm)

    # --- sash and medallion ---------------------------------------------------------------------------
    def sash_and_medallion(self):
        ex = self.pose.get('extra', {})
        rx, ry, z0, h = 0.5, 0.42, -0.05, 0.115
        prof = []
        K = 14
        for j in range(K + 1):
            v = j / K
            bul = 0.03 * math.sin(math.pi * v) ** 0.5 + 0.012 * math.sin(v * math.pi * 3.0) ** 2
            prof.append((bul, z0 - h + 2 * h * v))
        prof += [(-0.02, z0 + h * 0.9), (-0.02, z0 - h * 0.9)]
        self.add('sash', ring_band(rx, ry, prof, 72, 2.4, zfun=lambda a: 0.015 * math.sin(a * 2 + 0.6)), self.sash, 'spine')
        # knot at the front-left with two tails
        ak = math.radians(-68)
        kp = Vector((math.cos(ak) * (rx + 0.05), math.sin(ak) * (ry + 0.05), z0 - 0.01))
        nrm = Vector((math.cos(ak) * 0.5, math.sin(ak), 0.0)).normalized()
        km = orient(kp, nrm)
        self.add('knot', ellipsoid(0.085, 0.06, 0.08, 18, 12), self.sash_d, 'spine', km)
        for sd in (1, -1):
            self.add('knotlobe', ellipsoid(0.075, 0.045, 0.065, 14, 10, center=(0.075 * sd, 0.02, 0.01)), self.sash, 'spine', km @ R(0, 18 * sd, 0))
        sway = ex.get('sway', 0.0)
        fly = ex.get('scarf', 0.0)  # 0 hangs still, 1 flutters (lifts and trails back round the hip)
        wave = ex.get('wave', 0.0)
        for k, (dx, ln, w0) in enumerate(((-0.08, 0.38, 0.12), (0.025, 0.31, 0.11))):
            pts = []
            for i in range(11):
                t = i / 10
                wob = 0.035 * fly * math.sin(wave + t * 4.0 + k * 1.3) * t
                pts.append(kp + Vector((dx * t * 1.6 + 0.03 * sway * t + 0.13 * fly * t * t, -0.03 - 0.05 * t + 0.1 * fly * t * t,
                                        -0.04 - ln * t * (1.0 - 0.3 * fly) + wob)))
            self.add(f'tail{k}', cloth_strip(pts, lambda t, w0=w0: w0 + 0.05 * t, nrm, 1.5, lambda t: 0.006 + 0.014 * t, 0.022, 8), self.sash, 'spine')
        # bronze medallion with a teal spiral inset, hanging on the left hip
        mm = T(0.48, -0.31, -0.24) @ R(0, 0, 24) @ R(5, 0, 0)
        self.add('medal', disc(0.19, 0.056, 44), self.bronze, 'spine', mm)
        self.add('medalrim', torus(0.185, 0.03, 44, 10), self.bronze_d, 'spine', mm @ R(90, 0, 0))
        self.add('medalinset', disc(0.115, 0.064, 36), self.teal, 'spine', mm)
        self.add('medalspiral', sweep(spiral_points(0.013, 0.095, 2.2, 64, -0.034), 0.0085, 6), self.spiral, 'spine', mm)
        self.add('medalbail', torus(0.034, 0.012, 16, 6), self.bronze_d, 'spine', mm @ T(0, 0, 0.212) @ R(0, 90, 0))
        top = mm @ Vector((0, 0, 0.238))
        self.add('medalcord', sweep([top, top.lerp(kp, 0.5) + Vector((0, -0.02, 0.02)), kp + Vector((0.02, 0.02, -0.06))], 0.012, 6), self.cord,
                 'spine')

    # --- head ----------------------------------------------------------------------------------------
    def head(self):
        c = self.C
        hx, hy, hz, hc, hd = self.HEAD
        head = HeadShape(hx, hy, hz, center=(0, hd, hc))
        v, f = ellipsoid(hx, hy, hz, 48, 32, center=(0, hd, hc))
        out = []
        for (x, y, z) in v:
            u = (z - hc) / hz
            low = max(0.0, -u)
            x *= 1 + 0.07 * low ** 1.5  # broad jowls
            if u > 0:
                z = hc + (z - hc) * (1 - 0.14 * u ** 3)  # flatter crown
            out.append((x, y, z))
        # face: big friendly eyes and a wide smile; a chunky stone brow ridge replaces the thin brows
        eye_pitch, brow_pitch, eye_yaw = -5.0, 22.0, 26.0
        fc = dict(DEFAULT_FACE)
        fc.update(self.pose.get('face', {}))
        brows, eyes = fc['brows'], fc['eyes']
        b_pitch = eye_pitch + brow_pitch + (4 if brows == 'up' else 0) + (2 if eyes == 'wide' else 0)
        detail = []
        for sd in (1, -1):
            roll = (7 + {'neutral': 0, 'up': -4, 'worried': 16, 'angry': -18, 'determined': -12, 'sad': 14}.get(brows, 0)) * sd
            bf = head.frame(eye_yaw * 1.04 * sd, b_pitch, -0.032, roll)
            detail.append(placed(bf, boulder(0.135, 0.085, 0.064, 2.4, seed=95 + sd, lump=0.06)))
        detail.append(placed(head.frame(0, eye_pitch - 15, -0.024), boulder(0.066, 0.055, 0.05, 2.2, seed=97, lump=0.05)))
        self.rock('head', (out, f), 'head', center=(0, hd, hc))
        # brow ridge and nose: the same stone (continuous texture) but without moss or cracks
        self.rock('browridge', detail, 'head', tex='head', mat=self.plain, center=(0, hd, hc))
        n0 = len(self.parts)
        self.face(head, 'head', eye_yaw=eye_yaw, eye_pitch=eye_pitch, eye_size=(0.108, 0.124), iris=c['iris'], brow_col='#8a8378',
                  mouth_pitch=-33, mouth_w=2.7, lid_col='#958e83', nose=False, blush=True, brow_pitch=brow_pitch, lash_col='#2a2320')
        keep = self.parts[:n0]
        for p in self.parts[n0:]:
            if p.name in ('browL', 'browR') or (p.name == 'mouth' and fc['mouth'] == 'smile'):
                continue
            if p.name in ('lidL', 'lidR'):
                p.mat = self.plain
            keep.append(p)
        self.parts = keep
        if fc['mouth'] == 'smile':
            # a wide, gentle smile with little dimples at the corners (bolder than the stock line)
            mf = head.frame(0, -31, 0.0)
            w, dep = 0.3, 0.05
            pts = [Vector((t * w / 2, -0.006, -dep * (1 - t * t))) for t in [i / 16 * 2 - 1 for i in range(17)]]
            self.add('mouth', sweep(pts, lambda t: 0.0095 + 0.0045 * math.sin(math.pi * t), 8), self.smile, 'head', mf)
            for sd in (1, -1):
                dm = head.frame(sd * 20.5, -28.5, 0.0)
                self.add('dimple', sweep([Vector((-0.012 * sd, -0.005, -0.012)), Vector((0.0, -0.005, 0.0)), Vector((0.004 * sd, -0.005, 0.014))],
                                         0.0065, 6), self.smile, 'head', dm)
        # mossy crest: a little bush on top of the head with a few flowers, moss spreading round it
        self.moss_patch('crestbase', 'head', T(0, hd, hc), (hx, hy, hz * 0.95), 0, 82, (180, 16), 14, 0.08, 0.5)
        self.moss_tuft('crest', 'head', Vector((0.0, hd + 0.02, hc + hz * 0.86)), 0.17, 0.24, 40, 0.062, flowers=5)


def _moss_mat(dark, mid, light):
    """Fuzzy moss: patchy dark-to-light greens with a fine bumpy nap and a soft sheen."""
    def make(name):
        m = lib.NT(name)
        obj = m.node('ShaderNodeTexCoord').outputs['Object']
        fine = m.noise(34.0, 4, 0.75, obj)
        patch = m.noise(7.0, 3, 0.6, obj)
        c = m.ramp(patch.outputs['Fac'], [(0.36, dark), (0.52, mid), (0.68, light)])
        c = m.mult(c, m.ramp(fine.outputs['Fac'], [(0.32, '#7d7d7d'), (0.68, '#ffffff')]), 1.0)
        m.bsdf(c, 0.88, normal=m.bump(fine.outputs['Fac'], 0.7, 0.02), sheen=0.9, spec=0.2)
        return m.mat
    return make


def _plain_stone(name):
    """The golem's stone without moss or glowing cracks (for the small eyelids)."""
    m = lib.NT(name)
    tc = m.node('ShaderNodeTexCoord')
    obj = tc.outputs['Object']
    nz = m.noise(4.5, 5, 0.6, obj)
    base = m.ramp(nz.outputs['Fac'], [(0.3, '#7f786f'), (0.5, '#9b9489'), (0.7, '#b1aa9e')])
    bump = m.bump(nz.outputs['Fac'], 0.25, 0.05)
    m.bsdf(base, 0.78, normal=bump)
    return m.mat
