"""Homer Simpson as a chibi 3D hero (fan-made, private/non-commercial), loaded by characters.py as class
`Homer`, built on the shared Hero structure (see char_models.py).

Bright yellow and bald: a tall rounded cranium with the two curved hairs on the crown and the zig-zag
fringe of hair round the back of his head (a raised yellow band outlined in dark, with the famous M
over each ear); big round white eyes that bulge out of the face with small black dot pupils and a
droopy upper lid (his happy-dopey resting look); the long sausage nose; C-shaped ears; and the
grey-brown five-o'clock-shadow muzzle round his mouth and jaw, with a slight overbite (an upper lip
roll overhanging the mouth) and a wide easy grin. His 'o' / 'gasp' mouths with wide eyes give the
famous surprised look. Below: a white short-sleeved collared shirt stretched over a round potbelly,
blue trousers, dark grey shoes, yellow arms and mitten hands.

Skeleton: short legs, a big low belly and a big head, about as tall as the other heroes. The belly is
carried by the `spine` joint (so it stays low and heavy when the chest pitches or twists); arms that
would sink into it are swung out to clear it (clear_arms, re-solved in place so the hand anchors
follow). Neck and head nods are damped: his big head with the muzzle at its front-bottom would
otherwise bury the chin in his chest. HEAD[3:5] points at the face centre (the root of the nose,
between the eyes and the mouth) for the portraits.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import lib
from lib import col
from char_rig import (I4, HeadShape, R, Skeleton, T, arc_points, arm_rot, bend, curve3, ellipsoid, flat_sweep, superellipsoid, sweep)
from char_models import DEFAULT_FACE, Hero, hand_mitten


# ------------------------------------------------------------------------------------------
# Small helpers (local copies so this module only depends on the shared files as they are)
def clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return max(a, min(b, x))


def sstep(x: float) -> float:
    x = clamp(x)
    return x * x * (3.0 - 2.0 * x)


def interp(points, x: float) -> float:
    """Smoothly interpolated value through (x, y) control points (clamped at the ends)."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            f = (x - x0) / (x1 - x0) if x1 > x0 else 0.0
            return y0 + (y1 - y0) * sstep(f)
    return points[-1][1]


class DampedSkeleton(Skeleton):
    """The hero's skeleton with some joints' pose rotations scaled before solving (characters.py solves
    every pose through hero.skel, so the anchors and face point follow). damp maps a joint to
    (pitch-down factor, pitch-up factor, roll factor, yaw factor)."""

    def __init__(self, base: Skeleton, damp: dict):
        self.parent, self.offset, self.order = base.parent, base.offset, base.order
        self.damp = damp

    def solve(self, local: dict, root=I4, world_override=None):
        loc = dict(local)
        for j, (kd, ku, ky, kz) in self.damp.items():
            if j in loc:
                e = loc[j].to_euler('XYZ')
                x = e.x * (kd if e.x > 0 else ku)
                loc[j] = R(math.degrees(x), math.degrees(e.y) * ky, math.degrees(e.z) * kz)
        return super().solve(loc, root, world_override)


def egg(rx, ry_front, ry_back, rz_top, rz_bot, seg=40, rings=28, center=(0.0, 0.0, 0.0)):
    """An ellipsoid with different radii in front (-Y) / behind and above / below its centre."""
    verts, faces = ellipsoid(1.0, 1.0, 1.0, seg, rings)
    cx, cy, cz = center
    out = [(cx + x * rx, cy + y * (ry_front if y < 0 else ry_back), cz + z * (rz_top if z > 0 else rz_bot)) for (x, y, z) in verts]
    return out, faces


class EggShape:
    """The implicit form of egg() (value < 1 inside), for clearance tests."""

    def __init__(self, rx, ry_front, ry_back, rz_top, rz_bot, center=(0.0, 0.0, 0.0)):
        self.r = (rx, ry_front, ry_back, rz_top, rz_bot)
        self.c = Vector(center)

    def value(self, p: Vector, margin: float = 0.0) -> float:
        rx, ryf, ryb, rzt, rzb = self.r
        d = p - self.c
        ry = ryf if d.y < 0 else ryb
        rz = rzt if d.z > 0 else rzb
        return (d.x / (rx + margin)) ** 2 + (d.y / (ry + margin)) ** 2 + (d.z / (rz + margin)) ** 2


class EggHead(HeadShape):
    """HeadShape for an egg() surface (radii differ in front / behind and above / below the centre), so
    features wrapped onto it with Hero.feat sit on the egg."""

    def __init__(self, rx, ry_front, ry_back, rz_top, rz_bot, center=(0.0, 0.0, 0.0)):
        super().__init__(rx, ry_front, rz_top, center)
        self.er = (rx, ry_front, ry_back, rz_top, rz_bot)

    def radii(self, d: Vector):
        rx, ryf, ryb, rzt, rzb = self.er
        return rx, (ryf if d.y < 0 else ryb), (rzt if d.z > 0 else rzb)

    def surface(self, d: Vector):
        d = d.normalized()
        rx, ry, rz = self.radii(d)
        k = 1.0 / math.sqrt((d.x / rx) ** 2 + (d.y / ry) ** 2 + (d.z / rz) ** 2)
        q = d * k
        n = Vector((q.x / rx ** 2, q.y / ry ** 2, q.z / rz ** 2)).normalized()
        return self.c + q, n

    def point(self, yaw: float, pitch: float, lift: float = 0.0):
        y, p = math.radians(yaw), math.radians(pitch)
        pos, n = self.surface(Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))))
        return pos + n * lift, n

    def mesh(self, seg=48, rings=30):
        return egg(*self.er, seg, rings, center=tuple(self.c))


def strip(top, bot, x0, x1, nx=24, ny=5, h=0.004, rim=-0.002):
    """A flat decal between two curves z = top(x) and z = bot(x), x0..x1 (vertices (x, -h, z), facing -Y)."""
    verts, faces = [], []
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        zt, zb = top(x), bot(x)
        edge_x = min(i, nx - i) == 0
        for j in range(ny + 1):
            edge = edge_x or j in (0, ny)
            verts.append((x, -(rim if edge else h), zt + (zb - zt) * j / ny))
    for i in range(nx):
        for j in range(ny):
            a = i * (ny + 1) + j
            b = (i + 1) * (ny + 1) + j
            faces.append((a, a + 1, b + 1, b))
    return verts, faces


def band_shell(hs: HeadShape, top, bottom, yaw0: float, yaw1: float, lift, U: int = 120, V: int = 6, inner: float = -0.015):
    """A closed shell over the head between the pitch curves bottom(yaw)..top(yaw) (degrees) for yaw in
    yaw0..yaw1 (may run past 180, i.e. round the back). The outer layer is lifted off the surface by
    lift(yaw, f), f = 0 at the bottom edge .. 1 at the top edge; the inner layer sits at `inner`."""
    verts, faces = [], []
    n = (U + 1) * (V + 1)
    for layer in (0, 1):
        for i in range(U + 1):
            yaw = yaw0 + (yaw1 - yaw0) * i / U
            b, t = bottom(yaw), top(yaw)
            for j in range(V + 1):
                f = j / V
                pitch = b + (t - b) * f
                pos, _n = hs.point(yaw, pitch, lift(yaw, f) if layer == 0 else inner)
                verts.append(tuple(pos))

    def ix(layer, i, j):
        return layer * n + i * (V + 1) + j

    for i in range(U):
        for j in range(V):
            faces.append((ix(0, i, j), ix(0, i + 1, j), ix(0, i + 1, j + 1), ix(0, i, j + 1)))
            faces.append((ix(1, i, j), ix(1, i, j + 1), ix(1, i + 1, j + 1), ix(1, i + 1, j)))
        faces.append((ix(0, i, V), ix(0, i + 1, V), ix(1, i + 1, V), ix(1, i, V)))  # top rim (the zig-zag edge)
        faces.append((ix(0, i, 0), ix(1, i, 0), ix(1, i + 1, 0), ix(0, i + 1, 0)))  # bottom rim
    for j in range(V):
        faces.append((ix(0, 0, j), ix(0, 0, j + 1), ix(1, 0, j + 1), ix(1, 0, j)))
        faces.append((ix(0, U, j), ix(1, U, j), ix(1, U, j + 1), ix(0, U, j + 1)))
    return verts, faces


def fold_yaw(yaw: float) -> float:
    """|yaw| folded into 0..180 (0 = the front, 180 = the back)."""
    return abs(((yaw + 180.0) % 360.0) - 180.0)


# ------------------------------------------------------------------------------------------
class Homer(Hero):
    """Homer Simpson: yellow, bald with two hairs and a zig-zag fringe, bulging eyes, sausage nose,
    stubble muzzle, white short-sleeved shirt over a potbelly, blue trousers, grey shoes."""

    key = 'homer'
    ankle_h = 0.12
    hip_h = 0.54  # ankle_h + 0.04 + thigh + shin
    spine = 0.1
    chest = 0.19
    neck = 0.1
    head_up = 0.02
    shoulder = (0.235, 0.0, 0.07)
    upper_arm = 0.185
    forearm = 0.165
    hip_w = 0.13
    thigh = 0.19
    shin = 0.19
    sit_h = 0.2

    CRAN = (0.36, 0.35, 0.47, 0.51)  # cranium radii and centre height (head frame)
    MUZ = (0.31, 0.27, 0.2, 0.24, 0.215, (0.0, -0.15, 0.26))  # muzzle egg (head frame): rx, ry front / back, rz top / bottom, centre
    EYE = (0.105, -0.29, 0.565, 0.112)  # eye centre x (mirrored), y, z and radius (head frame)
    HEAD = (0.36, 0.35, 0.47, 0.47, -0.3)  # rx, ry, rz, face centre height and depth (the root of the nose)
    MOUTH_PITCH = 8.0  # the mouth's place on the muzzle
    BELLY = (0.305, 0.36, 0.22, 0.26, 0.22, (0.0, -0.06, -0.05))  # spine frame: rx, ry front / back, rz top / bottom, centre
    CHEST = (0.245, 0.2, 0.16, (0.0, 0.015, -0.02))  # chest frame ellipsoid

    C = dict(skin='#fed41d', skin_d='#e3a712', fringe='#f6c814', stubble='#bca27a', stubble_d='#9c8562', shirt='#f7f6f1',
             shirt_d='#dedbd2', pants='#3e6ec6', pants_d='#2f579f', shoe='#5b5d64', sole='#34353a', hair='#2a2420',
             white='#fbfbf8', pupil='#111111', mouth='#5c1c1a', tongue='#e0707a', teeth='#fffdf5')

    def __init__(self, mats):
        super().__init__(mats)
        # a big head on a short thick neck: nods are damped so the muzzle doesn't sink into the chest
        self.skel = DampedSkeleton(self.skel, {'chest': (0.5, 1.0, 1.0, 1.0), 'neck': (0.2, 0.6, 0.7, 0.7), 'head': (0.3, 0.75, 0.8, 0.8)})
        self.belly = EggShape(*self.BELLY[:5], center=self.BELLY[5])
        cx, cy, cz, cc = self.CHEST
        self.chest_shape = EggShape(cx, cy, cy, cz, cz, center=cc)

    def head_top(self) -> float:
        return self.CRAN[3] + self.CRAN[2] + 0.12

    # --- materials --------------------------------------------------------------------------------
    def skin_mat(self, name: str, color: str):
        """Clean cartoon yellow: a touch of subsurface and sheen (the stock skin glows too orange)."""
        def make(n):
            m = lib.NT(n)
            m.bsdf(col(color), 0.46, subsurface=0.04, sheen=0.2, spec=0.35)
            return m.mat
        return self.m.get(name, make)

    def stubble_mat(self, name: str, a: str, b: str):
        """Five-o'clock shadow: grey-brown with a fine darker speckle and a soft matte nap."""
        def make(n):
            m = lib.NT(n)
            obj = m.node('ShaderNodeTexCoord').outputs['Object']
            nz = m.noise(110.0, 2, 0.5, obj)
            f = m.math('MULTIPLY', m.maprange(nz.outputs['Fac'], 0.5, 0.68), 0.35)
            c = m.mix(f, col(a), col(b))
            m.bsdf(c, 0.66, normal=m.bump(nz.outputs['Fac'], 0.03, 0.01), sheen=0.35, spec=0.3)
            return m.mat
        return self.m.get(name, make)

    def materials(self):
        c, mt = self.C, self.m
        self.mat = dict(
            skin=self.skin_mat('homer_skin', c['skin']),
            skin_d=self.skin_mat('homer_skin_d', c['skin_d']),
            fringe=self.skin_mat('homer_fringe', c['fringe']),
            stubble=self.stubble_mat('homer_stubble', c['stubble'], c['stubble_d']),
            stubble_d=mt.skin('homer_stubble_d', c['stubble_d']),
            shirt=mt.cloth('homer_shirt', c['shirt'], 0.72, 0.3, 0.05),
            shirt_d=mt.cloth('homer_shirt_d', c['shirt_d'], 0.72, 0.3),
            pants=mt.cloth('homer_pants', c['pants'], 0.76, 0.35, 0.1, 60),
            pants_d=mt.cloth('homer_pants_d', c['pants_d'], 0.76, 0.3),
            shoe=mt.glossy('homer_shoe', c['shoe'], 0.38, 0.35),
            sole=mt.cloth('homer_sole', c['sole'], 0.6, 0.1),
            hair=mt.glossy('homer_hair', c['hair'], 0.45, 0.2),
            white=mt.glossy('homer_eye_white', c['white'], 0.2, 0.7),
            pupil=mt.glossy('homer_pupil', c['pupil'], 0.3, 0.8),
            mouth=mt.glossy('homer_mouth', c['mouth'], 0.45, 0.2),
            tongue=mt.glossy('homer_tongue', c['tongue'], 0.4, 0.3),
            teeth=mt.glossy('homer_teeth', c['teeth'], 0.25, 0.4),
        )

    # --- building ---------------------------------------------------------------------------------
    def build(self, world: dict, pose: dict):
        self.clear_arms(world, pose)
        return super().build(world, pose)

    def clear_arms(self, world: dict, pose: dict):
        """Swing an arm out from the shoulder (about the chest's front axis) until the elbow, forearm and
        hand clear the belly and chest. Re-solves the arm in place (the renderer reads the hand anchors
        from the same world matrices)."""
        inv_s = world['spine'].inverted()
        inv_c = world['chest'].inverted()
        for s_, sd in (('L', 1), ('R', -1)):
            for step in range(16):
                if step:
                    self.solve_arm(world, pose, s_, sd, step * 3.0)
                e, w = world['elbow' + s_], world['wrist' + s_]
                pe, pw = e.to_translation(), w.to_translation()
                pts = [pe.lerp(pw, k / 4) for k in range(5)] + [w @ Vector((0.0, 0.0, -0.075))]
                rads = [0.036] * 5 + [0.05]
                ok = all(self.belly.value(inv_s @ p, r) >= 1.0 and self.chest_shape.value(inv_c @ p, r) >= 1.0
                         for p, r in zip(pts, rads))
                if ok:
                    break

    def solve_arm(self, world, pose, s_, sd, delta):
        ra, sw, tw, el = pose['arm' + s_]
        rot = R(0, -delta * sd, 0) @ arm_rot(sd, ra, sw, tw)
        sh = world['chest'] @ T(*self.skel.offset['shoulder' + s_]) @ rot
        elw = sh @ T(*self.skel.offset['elbow' + s_]) @ bend(el)
        wr = elw @ T(*self.skel.offset['wrist' + s_]) @ R(*pose.get('wrist' + s_, (0, 0, 0)))
        world['shoulder' + s_], world['elbow' + s_], world['wrist' + s_] = sh, elw, wr

    def dress(self):
        self.materials()
        self.torso()
        self.legs()
        self.arms()
        self.head_parts()

    # --- torso ------------------------------------------------------------------------------------
    def torso(self):
        M = self.mat
        rx, ryf, ryb, rzt, rzb, bc = self.BELLY
        # the potbelly (spine frame): an egg, fuller in front; the chest and sloping shoulders above it
        self.add('belly', egg(rx, ryf, ryb, rzt, rzb, 44, 30, center=bc), M['shirt'], 'spine')
        cx, cy, cz, cc = self.CHEST
        self.add('chest', ellipsoid(cx, cy, cz, 36, 22, center=cc), M['shirt'], 'chest')
        # blue trousers (hips frame): the belly hangs over the waistband
        self.add('pelvis', superellipsoid(0.285, 0.245, 0.15, 2.4, 36, 20, center=(0, 0.035, -0.05)), M['pants'], 'hips')
        # neck (mostly hidden by the collar and the jowls)
        a = self.J('chest') @ Vector((0.0, 0.015, 0.05))
        b = self.J('neck') @ Vector((0.0, 0.0, 0.03))
        c = self.J('head') @ Vector((0.0, 0.02, 0.16))
        self.add('neck', sweep(curve3(a, b, c, 6), 0.122, 18), M['skin'])
        self.collar()
        # two small buttons down the front of the belly (on the egg's surface, spine frame)
        for k, zz in enumerate((0.13, 0.02)):
            z = bc[2] + zz
            f_ = math.sqrt(max(0.0, 1.0 - (zz / rzt) ** 2))
            p = Vector((0.0, bc[1] - ryf * f_, z))
            n = Vector((0.0, -f_ / ryf, (zz / rzt) / rzt)).normalized()
            fwd = -n
            xv = fwd.cross(Vector((0.0, 0.0, 1.0))).normalized()
            zv = xv.cross(fwd).normalized()
            bm = Matrix((xv, fwd, zv)).transposed().to_4x4()
            bm.translation = p
            self.add(f'button{k}', ellipsoid(0.017, 0.007, 0.017, 14, 6), M['shirt_d'], 'spine', bm)

    def collar(self):
        M = self.mat
        cc = self.CHEST[3]
        # the collar band: a standing strip round the neck, open at the front, a little higher at the back
        pts, nrms = [], []
        for i in range(29):
            ph = math.radians(-62 + 304 * i / 28)
            back = max(0.0, math.sin(ph))
            pts.append(Vector((0.154 * math.cos(ph), cc[1] + 0.136 * math.sin(ph), 0.105 + 0.03 * back)))
            nrms.append(Vector((math.cos(ph) / 0.154, math.sin(ph) / 0.136, 0.0)).normalized())
        self.add('collar', flat_sweep(pts, 0.034, lambda t: nrms[min(28, int(round(t * 28)))], 0.34, 10), M['shirt'], 'chest')
        # the two pointed collar flaps spreading over the upper chest, lifted a little so they cast a line
        a0 = math.radians(-62)
        for sd in (1, -1):
            p0 = Vector((0.154 * math.cos(a0) * sd, cc[1] + 0.136 * math.sin(a0) - 0.006, 0.112))
            fpts = curve3(p0, Vector((0.1 * sd, -0.172, 0.056)), Vector((0.128 * sd, -0.194, -0.01)), 10)
            nrm = Vector((0.4 * sd, -1.0, 0.35)).normalized()
            self.add('flap', flat_sweep(fpts, lambda t: 0.064 * (1 - t) ** 0.85 + 0.008, nrm, 0.26, 12), M['shirt'], 'chest')

    # --- legs -------------------------------------------------------------------------------------
    def legs(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            hip, kn, an = f'hip{s_}', f'knee{s_}', f'ankle{s_}'
            self.limb('pleg' + s_, hip, kn, an, lambda t: 0.108 - 0.006 * t, M['pants'], 0.0, 0.96, 18, 16, cap0=True, cap1=False)
            self.limb('phem' + s_, hip, kn, an, 0.104, M['pants_d'], 0.93, 0.975, 18, 2, cap0=False, cap1=True)
            fm = self.J(an) @ R(0, 0, -8 * sd)
            self.add('shoe' + s_, superellipsoid(0.098, 0.15, 0.066, 2.5, 22, 14, center=(0, -0.048, -0.055)), M['shoe'], None, fm)
            self.add('toe' + s_, ellipsoid(0.094, 0.086, 0.058, 18, 10, center=(0, -0.128, -0.068)), M['shoe'], None, fm)
            self.add('sole' + s_, superellipsoid(0.104, 0.166, 0.022, 3.0, 22, 8, center=(0, -0.056, -0.099)), M['sole'], None, fm)

    # --- arms -------------------------------------------------------------------------------------
    def arms(self):
        M = self.mat
        for s_, sd in (('L', 1), ('R', -1)):
            sh, el, wr = f'shoulder{s_}', f'elbow{s_}', f'wrist{s_}'
            self.limb('sleeve' + s_, sh, el, wr, lambda t: 0.086 + 0.006 * t, M['shirt'], 0.0, 0.36, 16, 8, cap0=True, cap1=False)
            self.limb('shem' + s_, sh, el, wr, 0.094, M['shirt_d'], 0.33, 0.37, 16, 2, cap0=False, cap1=False)
            self.limb('arm' + s_, sh, el, wr, lambda t: 0.052 - 0.005 * t, M['skin'], 0.3, 1.0, 12, 12, extend=0.02)
            hand = self.pose.get('hand' + s_, 'fist')
            wm = self.J(wr)
            for nm, mesh in hand_mitten(sd, hand, 1.08):
                self.add('hand' + nm + s_, mesh, M['skin'], None, wm)

    # --- head -------------------------------------------------------------------------------------
    def face_state(self):
        f = dict(DEFAULT_FACE)
        f.update(self.pose.get('face', {}))
        return f

    def head_parts(self):
        M = self.mat
        rx, ry, rz, cz = self.CRAN
        cran = HeadShape(rx, ry, rz, center=(0, 0, cz))
        self.add('cranium', ellipsoid(rx, ry, rz, 52, 34, center=(0, 0, cz)), M['skin'], 'head')
        muz = EggHead(*self.MUZ[:5], center=self.MUZ[5])
        self.add('muzzle', muz.mesh(52, 32), M['stubble'], 'head')
        self.cran, self.muz = cran, muz
        f = self.face_state()
        self.ears()
        self.eyes(f)
        self.nose()
        self.mouth(f['mouth'])
        self.hairs()
        self.fringe()

    def ears(self):
        M = self.mat
        for sd in (1, -1):
            pos, _n = self.cran.point(92 * sd, -12, -0.01)
            m = T(*pos) @ R(0, 0, -8 * sd)
            self.add('ear', ellipsoid(0.034, 0.062, 0.08, 18, 12, center=(0.012 * sd, 0.0, 0.0)), M['skin'], 'head', m)
            # the inner curl: a C opening towards the face
            pts = [Vector((0.042 * sd, -math.cos(a) * 0.03, math.sin(a) * 0.042)) for a in [math.radians(55 + 250 * k / 14) for k in range(15)]]
            self.add('earcurl', sweep(pts, 0.0085, 8), M['skin_d'], 'head', m)
            self.add('earnub', ellipsoid(0.01, 0.014, 0.016, 10, 6, center=(0.04 * sd, -0.004, -0.004)), M['skin_d'], 'head', m)

    def eyes(self, f):
        M = self.mat
        eyes, brows = f['eyes'], f['brows']
        lx, lz = f.get('look', (0.0, 0.0))
        ex, ey, ez, er = self.EYE
        for side in (1, -1):
            nm = 'L' if side > 0 else 'R'
            kind = eyes
            if eyes == 'wink':
                kind = 'open' if side > 0 else 'happy'
            wide = kind == 'wide'
            r = er * (1.05 if wide else 1.0)
            ec = Vector((ex * side, ey, ez))
            self.add('eye' + nm, ellipsoid(r, r, r, 32, 22, center=tuple(ec)), M['white'], 'head')
            eye = HeadShape(r, r, r, center=tuple(ec))
            shut = kind in ('happy', 'closed')
            if kind == 'dizzy':
                pts = []
                for i in range(44):
                    a = i / 44 * math.tau * 2.3
                    rr = 0.008 + (r * 0.62 - 0.008) * i / 44
                    pts.append(Vector((math.cos(a) * rr * side, -0.004, math.sin(a) * rr)))
                self.feat('spiral' + nm, sweep(pts, 0.0075, 6), M['pupil'], 'head', eye, eye.frame(-4 * side, -2, 0.0))
            elif not shut:
                yaw = -9.0 + 2.0 * side + lx * 24.0  # a touch towards the camera side, very slightly converging
                pitch = -3.0 + lz * 18.0
                pr = 0.027 * (0.8 if wide else 1.0)
                self.feat('pupil' + nm, ellipsoid(pr, 0.006, pr * 1.05, 16, 6), M['pupil'], 'head', eye, eye.frame(yaw, pitch, 0.0))
            # the upper lid: droopy when relaxed (dopey), level with the brows' mood, shut for happy / closed
            level, slant = {'open': (0.19, 0.0), 'wide': (0.0, 0.0), 'half': (0.5, 0.0), 'sad': (0.4, 16.0), 'determined': (0.36, -18.0),
                            'dizzy': (0.16, 0.0)}.get(kind, (1.0, 0.0))
            if not shut and kind not in ('sad', 'determined', 'wide'):
                if brows == 'up':
                    level = max(0.0, level - 0.16)
                slant += {'worried': 12.0, 'sad': 10.0, 'angry': -16.0, 'determined': -10.0}.get(brows, 0.0)
            rl = r * 1.045
            lm = T(*ec) @ R(0, slant * side, 0)
            if shut:
                self.add('lid' + nm, ellipsoid(rl, rl, rl, 32, 18), M['skin'], 'head', T(*ec))
                lid = HeadShape(rl, rl, rl, center=tuple(ec))
                h = -0.4 if kind == 'happy' else 0.12
                pts = [p + Vector((0, 0, -r * 0.08)) for p in arc_points(r * 1.5, r * h, 14, y=-0.004)]
                self.feat('shut' + nm, sweep(pts, lambda t: 0.0075 + 0.0035 * math.sin(math.pi * t), 8), M['hair'], 'head', lid,
                          lid.frame(0, 0, 0.0))
            elif level > 0.0:
                zc = rl * (1.0 - 2.0 * level)
                self.add('lid' + nm, ellipsoid(rl, rl, rl, 32, 14, zmin=1.0 - 2.0 * level), M['skin'], 'head', lm)
                rho = math.sqrt(max(0.0, rl * rl - zc * zc))
                pts = [Vector((math.sin(a) * rho, -math.cos(a) * rho, zc)) for a in [math.radians(-105 + 210 * k / 16) for k in range(17)]]
                self.add('lidline' + nm, sweep(pts, 0.0068, 6), M['hair'], 'head', lm)

    def nose(self):
        M = self.mat
        pts = [Vector((0.0, -0.3 - 0.182 * t, 0.476 - 0.03 * t * t)) for t in (i / 10 for i in range(11))]
        self.add('nose', sweep(pts, lambda t: 0.046 + 0.005 * t, 16), M['skin'], 'head')

    def mouth(self, mouth: str):
        M = self.mat
        muz = self.muz
        mf = muz.frame(0, self.MOUTH_PITCH, 0.0)

        def feat(name, mesh, mat, fr=mf):
            self.feat(name, mesh, mat, 'head', muz, fr)

        def lip(pts, r0=0.013, r1=0.019):
            feat('lip', sweep(pts, lambda t: r0 + (r1 - r0) * math.sin(math.pi * t), 10), M['stubble'])

        def dimples(hw, zt):
            for sd in (1, -1):
                p = [Vector((sd * (hw - 0.004), -0.004, zt - 0.004)), Vector((sd * (hw + 0.01), -0.004, zt + 0.008)),
                     Vector((sd * (hw + 0.014), -0.004, zt + 0.022))]
                feat('dimple', sweep(p, lambda t: 0.0065 - 0.002 * t, 6), M['stubble_d'])

        if mouth in ('smile', 'grin', 'laugh', 'open'):
            hw, depth, curl = {'smile': (0.165, 0.056, 0.042), 'grin': (0.165, 0.078, 0.04), 'laugh': (0.16, 0.105, 0.036),
                               'open': (0.1, 0.075, 0.012)}[mouth]

            def top(x, hw=hw, curl=curl):
                return -0.004 + curl * (abs(x) / hw) ** 2.2

            def bot(x, hw=hw, depth=depth):
                t = x / hw
                return top(x) - depth * max(0.0, 1.0 - t * t) ** 0.75

            feat('mouth', strip(top, bot, -hw, hw, 30, 6, 0.003), M['mouth'])
            feat('tongue', ellipsoid(hw * 0.34, 0.004, depth * 0.3, 16, 6, center=(0.0, -0.0035, -0.004 - depth * 0.72)), M['tongue'])
            if mouth in ('grin', 'laugh'):
                tw = hw * 0.78
                feat('teeth', strip(lambda x: top(x) - 0.004, lambda x: top(x) - 0.024, -tw, tw, 20, 2, 0.0045, 0.0035), M['teeth'])
            lip([Vector((x, -0.012, top(x) + 0.008)) for x in [(-1.03 + 2.06 * k / 16) * hw for k in range(17)]])
            if mouth != 'open':
                dimples(hw, top(hw))
        elif mouth in ('o', 'gasp'):
            a, b = (0.036, 0.046) if mouth == 'o' else (0.058, 0.076)
            zc = -0.03 if mouth == 'o' else -0.045
            feat('mouth', ellipsoid(a, 0.005, b, 22, 8, center=(0.0, -0.001, zc)), M['mouth'])
            if mouth == 'gasp':
                feat('tongue', ellipsoid(a * 0.62, 0.006, b * 0.3, 14, 6, center=(0.0, -0.004, zc - b * 0.62)), M['tongue'])
                feat('teeth', ellipsoid(a * 0.7, 0.006, 0.012, 14, 6, center=(0.0, -0.004, zc + b * 0.8)), M['teeth'])
            ring = [Vector((math.cos(t) * (a + 0.006), -0.009, zc + math.sin(t) * (b + 0.006))) for t in [k / 24 * math.tau for k in range(25)]]
            feat('lipring', sweep(ring, 0.012, 8), M['stubble'])
        else:
            w = 0.24
            n = 16
            pts = []
            for i in range(n + 1):
                t = i / n * 2 - 1
                if mouth == 'frown':
                    z = 0.03 * (1 - t * t) - 0.03
                elif mouth == 'wobble':
                    z = 0.012 * math.sin(t * math.pi * 2.5) - 0.012
                elif mouth == 'smirk':
                    z = 0.026 * ((t + 1) / 2) ** 2 - 0.01
                else:
                    z = -0.012
                pts.append(Vector((t * w / 2, -0.005, z)))
            feat('mouth', sweep(pts, lambda t: 0.009 + 0.003 * math.sin(math.pi * t), 8), M['mouth'])
            lip([Vector((p.x * 1.02, -0.012, p.z + 0.016 + (0.006 if mouth == 'frown' else 0.0))) for p in pts])

    def hairs(self):
        """The two curved hairs on the crown: two little arches one after the other along a diagonal, so
        they read as Homer's 'M' from the front three-quarter view and from the side."""
        M = self.mat
        cran = self.cran
        phi = math.radians(52.0)
        u = Vector((math.sin(phi), -math.cos(phi), 0.0))
        base = Vector((0.0, -0.04, 0.0))
        for k, (s0, s1, h) in enumerate(((-0.02, 0.115, 0.082), (-0.15, -0.02, 0.078))):
            pts = []
            for i in range(19):
                t = i / 18
                s = s0 + (s1 - s0) * t
                d = Vector((base.x + u.x * s, base.y + u.y * s, 0.42))
                p, nrm = cran.surface(d)
                lift = h * math.sin(math.pi * t) ** 0.62 - 0.006
                pts.append(p + nrm * lift)
            self.add(f'hair{k}', sweep(pts, 0.012, 8), M['hair'], 'head')

    def fringe(self):
        """The fringe round the back of the head: a raised band with a zig-zag top edge (an M over each
        ear), outlined in dark like the cartoon's line."""
        M = self.mat
        rx, ry, rz, cz = self.CRAN
        hs = HeadShape(rx, ry, rz, center=(0, 0, cz))
        peaks = [(80.0, 17.0), (99.0, 21.0), (121.0, 15.0), (143.0, 16.0), (165.0, 14.0)]
        low = 3.0

        def top(yaw):
            a = fold_yaw(yaw)
            best = low
            for ta, hh in peaks:
                best = max(best, hh - (hh - low) * min(1.0, abs(a - ta) / 10.0))
            return best

        def bottom(yaw):
            a = fold_yaw(yaw)
            return interp([(72.0, 2.0), (84.0, -3.0), (100.0, -6.0), (125.0, -20.0), (180.0, -26.0)], a)

        def lift(yaw, f):
            a = fold_yaw(yaw)
            return 0.017 * sstep(f / 0.4) * sstep((a - 72.0) / 6.0)

        self.add('fringe', band_shell(hs, top, bottom, 72.0, 288.0, lift, 144, 6), M['fringe'], 'head')
        pts = []
        for i in range(217):
            yaw = 74.0 + 212.0 * i / 216
            pts.append(hs.point(yaw, top(yaw), lift(yaw, 1.0) - 0.002)[0])
        self.add('fringeline', sweep(pts, 0.0075, 6), M['hair'], 'head')
