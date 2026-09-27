"""Rig and geometry helpers for the 3D hero models (scripts/art/characters.py).

The heroes are built from smooth parts attached to a small joint hierarchy posed with forward
kinematics. Arms and legs are rebuilt for every pose as smooth "bendy" tubes through the shoulder,
elbow and wrist (or hip, knee and ankle), so bent limbs never show seams. Facial features sit on
the head's ellipsoid surface.

World axes: Z up, the character faces -Y (towards the camera), its left side is +X.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Quaternion, Vector

I4 = Matrix.Identity(4)


def rad(d: float) -> float:
    return math.radians(d)


def R(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> Matrix:
    """Rotation (degrees), applied X then Y then Z."""
    return (Matrix.Rotation(rad(z), 4, 'Z') @ Matrix.Rotation(rad(y), 4, 'Y') @ Matrix.Rotation(rad(x), 4, 'X'))


def T(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> Matrix:
    return Matrix.Translation((x, y, z))


def S(x: float, y: float | None = None, z: float | None = None) -> Matrix:
    y = x if y is None else y
    z = x if z is None else z
    return Matrix.Diagonal((x, y, z, 1.0))


# ------------------------------------------------------------------------------------------
# Skeleton
class Skeleton:
    """Joints listed parents-first as (name, parent, offset from the parent joint)."""

    def __init__(self, joints):
        self.parent = {}
        self.offset = {}
        self.order = []
        for name, parent, off in joints:
            self.parent[name] = parent
            self.offset[name] = Vector(off)
            self.order.append(name)

    def solve(self, local: dict, root: Matrix = I4, world_override: dict | None = None) -> dict:
        """World matrix per joint. `local` maps joint -> rotation matrix in its parent's frame.
        `world_override` maps joint -> a world rotation to use instead (keeps feet flat)."""
        world = {}
        for n in self.order:
            p = self.parent[n]
            base = world[p] if p else root
            m = base @ T(*self.offset[n])
            if world_override and n in world_override:
                loc = m.to_translation()
                m = T(*loc) @ world_override[n]
            else:
                m = m @ local.get(n, I4)
            world[n] = m
        return world


def limb_rotation(direction: Vector, front: Vector, twist: float = 0.0) -> Matrix:
    """Rotation whose local -Z points along `direction` and whose local -Y leans towards `front`
    (the side the joint bends to), then twisted about the bone by `twist` degrees."""
    d = direction.normalized()
    zl = -d
    f = front - d * front.dot(d)
    if f.length < 1e-5:
        alt = Vector((0.0, 0.0, 1.0)) if abs(d.z) < 0.9 else Vector((0.0, -1.0, 0.0))
        f = alt - d * alt.dot(d)
    yl = -f.normalized()
    xl = yl.cross(zl).normalized()
    m = Matrix((xl, yl, zl)).transposed().to_4x4()
    return m @ Matrix.Rotation(rad(twist), 4, 'Z')


def arm_dir(side: int, raise_: float, swing: float) -> Vector:
    """Arm direction in the chest frame. raise_: 0 hangs down, 90 horizontal, 180 straight up.
    swing: 0 out to the side, 90 forward, -90 backward. side: +1 left (+X), -1 right."""
    r, s = rad(raise_), rad(swing)
    return Vector((math.sin(r) * math.cos(s) * side, -math.sin(r) * math.sin(s), -math.cos(r)))


def leg_dir(side: int, fwd: float, out: float = 0.0) -> Vector:
    """Thigh direction in the hip frame. fwd: forward swing (degrees), out: sideways spread."""
    f, o = rad(fwd), rad(out)
    v = Vector((math.sin(o) * side, -math.sin(f) * math.cos(o), -math.cos(f) * math.cos(o)))
    return v.normalized()


def arm_rot(side: int, raise_: float, swing: float, twist: float = 0.0) -> Matrix:
    # elbows bend forward and slightly inward by default
    return limb_rotation(arm_dir(side, raise_, swing), Vector((-0.25 * side, -1.0, 0.0)), twist * side)


def leg_rot(side: int, fwd: float, out: float = 0.0, twist: float = 0.0) -> Matrix:
    # knees bend backward: the "front" for the bend is +Y (so the shin swings back)
    return limb_rotation(leg_dir(side, fwd, out), Vector((0.0, 1.0, 0.0)), twist * side)


def bend(deg: float) -> Matrix:
    """Elbow bend: the forearm swings towards the joint's local -Y."""
    return Matrix.Rotation(rad(-deg), 4, 'X')


def knee(deg: float) -> Matrix:
    """Knee bend: the shin swings towards the joint's local -Y (set to the back by leg_rot)."""
    return Matrix.Rotation(rad(-deg), 4, 'X')


# ------------------------------------------------------------------------------------------
# Mesh primitives (verts, faces) in local space
def ellipsoid(rx: float, ry: float, rz: float, seg: int = 28, rings: int = 18, center=(0.0, 0.0, 0.0), zmin: float = -1.0, zmax: float = 1.0):
    """UV ellipsoid; zmin/zmax (in -1..1 of rz) cut it into a dome or bowl (open cut)."""
    cx, cy, cz = center
    verts, faces = [], []
    v0, v1 = math.acos(max(-1.0, min(1.0, zmax))), math.acos(max(-1.0, min(1.0, zmin)))
    top_pole = zmax >= 0.9999
    bot_pole = zmin <= -0.9999
    ring_list = []
    for i in range(rings + 1):
        phi = v0 + (v1 - v0) * i / rings
        if (i == 0 and top_pole) or (i == rings and bot_pole):
            ring_list.append(None)
            continue
        ring = []
        for k in range(seg):
            th = k / seg * math.tau
            verts.append((cx + rx * math.sin(phi) * math.cos(th), cy + ry * math.sin(phi) * math.sin(th), cz + rz * math.cos(phi)))
            ring.append(len(verts) - 1)
        ring_list.append(ring)
    top = bot = None
    if top_pole:
        verts.append((cx, cy, cz + rz))
        top = len(verts) - 1
    if bot_pole:
        verts.append((cx, cy, cz - rz))
        bot = len(verts) - 1
    for i in range(rings):
        a, b = ring_list[i], ring_list[i + 1]
        for k in range(seg):
            k2 = (k + 1) % seg
            if a is None:
                faces.append((top, b[k], b[k2]))
            elif b is None:
                faces.append((a[k], bot, a[k2]))
            else:
                faces.append((a[k], b[k], b[k2], a[k2]))
    return verts, faces


def superellipsoid(rx: float, ry: float, rz: float, p: float = 3.0, seg: int = 28, rings: int = 18, center=(0.0, 0.0, 0.0)):
    """Rounded box / pillow: exponent p = 2 is an ellipsoid, higher is boxier."""
    verts, faces = ellipsoid(1.0, 1.0, 1.0, seg, rings)
    cx, cy, cz = center
    out = []
    e = 2.0 / p
    for (x, y, z) in verts:
        def sg(v):
            return math.copysign(abs(v) ** e, v)
        out.append((cx + rx * sg(x), cy + ry * sg(y), cz + rz * sg(z)))
    return out, faces


def apply(m: Matrix, verts):
    return [tuple(m @ Vector(v)) for v in verts]


def rmf_frames(pts):
    """Rotation-minimising frames along a polyline (no twisting when the curve turns)."""
    n = len(pts)
    tangents = []
    for i in range(n):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        tangents.append(t.normalized() if t.length > 1e-9 else Vector((0.0, 0.0, 1.0)))
    t0 = tangents[0]
    ref = Vector((1.0, 0.0, 0.0)) if abs(t0.x) < 0.9 else Vector((0.0, 1.0, 0.0))
    u = (ref - t0 * ref.dot(t0)).normalized()
    frames = [(t0, u, t0.cross(u))]
    for i in range(1, n):
        tp, up_, _ = frames[-1]
        ti = tangents[i]
        q = tp.rotation_difference(ti)
        ui = (q @ up_)
        ui = (ui - ti * ui.dot(ti)).normalized()
        frames.append((ti, ui, ti.cross(ui)))
    return frames


def sweep(pts, radius, sides: int = 14, cap0: bool = True, cap1: bool = True, squash: float = 1.0):
    """Tube along points with a radius function r(t) (t in 0..1) and rounded end caps."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    frames = rmf_frames(pts)
    verts, faces = [], []
    for i, p in enumerate(pts):
        t, u, v = frames[i]
        r = radius(i / max(1, n - 1)) if callable(radius) else radius
        for k in range(sides):
            a = k / sides * math.tau
            verts.append(tuple(p + (u * math.cos(a) + v * math.sin(a) * squash) * r))
    for i in range(n - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    # hemispherical caps
    def cap(idx, sign):
        t, u, v = frames[idx]
        p = pts[idx]
        r = radius(idx / max(1, n - 1)) if callable(radius) else radius
        base_ring = list(range(idx * sides, idx * sides + sides))
        prev = base_ring
        steps = 4
        for s_ in range(1, steps):
            ang = s_ / steps * math.pi / 2
            ring = []
            for k in range(sides):
                a = k / sides * math.tau
                q = p + t * (sign * math.sin(ang) * r) + (u * math.cos(a) + v * math.sin(a) * squash) * (r * math.cos(ang))
                verts.append(tuple(q))
                ring.append(len(verts) - 1)
            for k in range(sides):
                k2 = (k + 1) % sides
                if sign > 0:
                    faces.append((prev[k], prev[k2], ring[k2], ring[k]))
                else:
                    faces.append((prev[k], ring[k], ring[k2], prev[k2]))
            prev = ring
        verts.append(tuple(p + t * (sign * r)))
        tip = len(verts) - 1
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((prev[k], prev[k2], tip) if sign > 0 else (prev[k], tip, prev[k2]))
    if cap1:
        cap(n - 1, 1)
    if cap0:
        cap(0, -1)
    return verts, faces


def curve3(p0: Vector, p1: Vector, p2: Vector, n: int = 14):
    """Smooth quadratic curve from p0 through p1 (at the middle) to p2."""
    c = p1 * 2.0 - (p0 + p2) * 0.5
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(p0 * (1 - t) ** 2 + c * 2 * (1 - t) * t + p2 * t * t)
    return out


def polyline_segment(pts, t0: float, t1: float, n: int = 12):
    """Sub-curve between fractions t0..t1 of a polyline's length, resampled to n+1 points."""
    lens = [0.0]
    for i in range(1, len(pts)):
        lens.append(lens[-1] + (pts[i] - pts[i - 1]).length)
    total = lens[-1] or 1.0

    def at(t):
        d = t * total
        for i in range(1, len(pts)):
            if lens[i] >= d:
                f = (d - lens[i - 1]) / max(1e-9, lens[i] - lens[i - 1])
                return pts[i - 1].lerp(pts[i], f)
        return pts[-1].copy()

    return [at(t0 + (t1 - t0) * i / n) for i in range(n + 1)]


def ribbon(pts, width, normal_hint: Vector, thickness: float = 0.02):
    """A flat strip (scarf, sash tail) along points, with a little thickness."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    verts, faces = [], []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(normal_hint).normalized()
        w = width(i / max(1, n - 1)) if callable(width) else width
        nrm = side.cross(t).normalized()
        for sgn_n in (-1, 1):
            for sgn_s in (-1, 1):
                verts.append(tuple(p + side * (w / 2 * sgn_s) + nrm * (thickness / 2 * sgn_n)))
    for i in range(n - 1):
        a = i * 4
        b = a + 4
        # quads: bottom (0,1), top (2,3) -> 0:-n-s 1:-n+s 2:+n-s 3:+n+s
        faces.append((a + 2, a + 3, b + 3, b + 2))
        faces.append((a + 1, a + 0, b + 0, b + 1))
        faces.append((a + 0, a + 2, b + 2, b + 0))
        faces.append((a + 3, a + 1, b + 1, b + 3))
    faces.append((0, 1, 3, 2))
    last = (n - 1) * 4
    faces.append((last + 2, last + 3, last + 1, last + 0))
    return verts, faces


def torus(R_: float, r: float, seg: int = 32, sides: int = 12, center=(0.0, 0.0, 0.0), squash: float = 1.0):
    cx, cy, cz = center
    verts, faces = [], []
    for i in range(seg):
        a = i / seg * math.tau
        for k in range(sides):
            b = k / sides * math.tau
            x = (R_ + r * math.cos(b)) * math.cos(a)
            y = (R_ + r * math.cos(b)) * math.sin(a)
            z = r * math.sin(b) * squash
            verts.append((cx + x, cy + y, cz + z))
    for i in range(seg):
        for k in range(sides):
            a = i * sides + k
            b = i * sides + (k + 1) % sides
            c = ((i + 1) % seg) * sides + (k + 1) % sides
            d = ((i + 1) % seg) * sides + k
            faces.append((a, b, c, d))
    return verts, faces


def disc(r: float, depth: float = 0.02, seg: int = 24):
    """A thin coin facing -Y (its front), centred at the origin."""
    verts, faces = [], []
    for s in (-1, 1):
        for k in range(seg):
            a = k / seg * math.tau
            verts.append((math.cos(a) * r, s * depth / 2, math.sin(a) * r))
    front = [k for k in range(seg)]
    back = [seg + k for k in range(seg)]
    faces.append(tuple(reversed(front)))
    faces.append(tuple(back))
    for k in range(seg):
        k2 = (k + 1) % seg
        faces.append((front[k], front[k2], back[k2], back[k]))
    return verts, faces


def star(r_out: float, r_in: float, depth: float = 0.04, points: int = 5):
    verts, faces = [], []
    n = points * 2
    for s in (-1, 1):
        verts.append((0.0, s * depth / 2, 0.0))
        for k in range(n):
            a = k / n * math.tau + math.pi / 2
            r = r_out if k % 2 == 0 else r_in
            verts.append((math.cos(a) * r, s * depth * 0.2, math.sin(a) * r))
    m = n + 1
    for k in range(n):
        k2 = (k + 1) % n
        faces.append((0, 1 + k2, 1 + k))
        faces.append((m, m + 1 + k, m + 1 + k2))
        faces.append((1 + k, 1 + k2, m + 1 + k2, m + 1 + k))
    return verts, faces


# ------------------------------------------------------------------------------------------
# Head surface helpers (facial features)
class HeadShape:
    """An ellipsoid head (radii in local units) centred at `center` in the head joint's frame."""

    def __init__(self, rx: float, ry: float, rz: float, center=(0.0, 0.0, 0.0)):
        self.r = Vector((rx, ry, rz))
        self.c = Vector(center)

    def point(self, yaw: float, pitch: float, lift: float = 0.0):
        """Surface point and normal for a direction: yaw 0 = straight at the front (-Y),
        positive yaw towards the character's left (+X); pitch positive upwards (degrees)."""
        y, p = rad(yaw), rad(pitch)
        d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
        # ray from the centre to the ellipsoid along d
        k = 1.0 / math.sqrt((d.x / self.r.x) ** 2 + (d.y / self.r.y) ** 2 + (d.z / self.r.z) ** 2)
        pos = self.c + d * k
        n = Vector(((pos.x - self.c.x) / self.r.x ** 2, (pos.y - self.c.y) / self.r.y ** 2, (pos.z - self.c.z) / self.r.z ** 2)).normalized()
        return pos + n * lift, n

    def surface(self, d: Vector):
        """Surface point and normal along direction d from the centre."""
        d = d.normalized()
        k = 1.0 / math.sqrt((d.x / self.r.x) ** 2 + (d.y / self.r.y) ** 2 + (d.z / self.r.z) ** 2)
        pos = self.c + d * k
        n = Vector(((pos.x - self.c.x) / self.r.x ** 2, (pos.y - self.c.y) / self.r.y ** 2, (pos.z - self.c.z) / self.r.z ** 2)).normalized()
        return pos, n

    def conform(self, verts, p0: Vector, n0: Vector):
        """Wrap a flat feature (modelled on the tangent plane at p0, normal n0) onto the curved
        surface, keeping each vertex's height above the plane."""
        out = []
        for v in verts:
            p = Vector(v)
            h = (p - p0).dot(n0)
            u = p - n0 * h
            sp, sn = self.surface(u - self.c)
            out.append(tuple(sp + sn * h))
        return out

    def frame(self, yaw: float, pitch: float, lift: float = 0.0, roll: float = 0.0) -> Matrix:
        """A matrix placing a feature (modelled facing -Y, up +Z) on the surface."""
        pos, n = self.point(yaw, pitch, lift)
        fwd = -n  # feature's +Y points into the head
        up = Vector((0.0, 0.0, 1.0))
        x = fwd.cross(up)
        if x.length < 1e-6:
            x = Vector((1.0, 0.0, 0.0))
        x.normalize()
        z = x.cross(fwd).normalized()
        m = Matrix((x, fwd, z)).transposed().to_4x4()
        m.translation = pos
        return m @ Matrix.Rotation(rad(roll), 4, 'Y')


def arc_points(w: float, h: float, n: int = 12, y: float = 0.0):
    """Points along a smile-shaped arc in the XZ plane (h > 0 smiles, h < 0 frowns)."""
    out = []
    for i in range(n + 1):
        t = i / n * 2 - 1
        out.append(Vector((t * w / 2, y, -h * (1 - t * t))))
    return out


def lerp(a, b, t):
    return a + (b - a) * t


def quat_look(forward: Vector) -> Quaternion:
    return Vector((0.0, -1.0, 0.0)).rotation_difference(forward.normalized())


def flat_sweep(pts, radius, normal, flat: float = 0.55, sides: int = 12, cap0: bool = True, cap1: bool = True):
    """A tube whose cross-section is flattened against `normal` (a Vector, or a function of t),
    so hair locks and leaves lie flat on the surface they grow from. Rounded end caps."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    verts, faces = [], []
    frames = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
        t = t.normalized() if t.length > 1e-9 else Vector((0.0, 0.0, 1.0))
        nv = normal(i / max(1, n - 1)) if callable(normal) else normal
        side = t.cross(nv)
        if side.length < 1e-6:
            side = t.cross(Vector((0.0, 0.0, 1.0)))
        side.normalize()
        up = side.cross(t).normalized()
        frames.append((t, side, up))
    for i, p in enumerate(pts):
        t, side, up = frames[i]
        r = radius(i / max(1, n - 1)) if callable(radius) else radius
        for k in range(sides):
            a = k / sides * math.tau
            verts.append(tuple(p + side * (math.cos(a) * r) + up * (math.sin(a) * r * flat)))
    for i in range(n - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))

    def cap(idx, sign):
        t, side, up = frames[idx]
        p = pts[idx]
        r = radius(idx / max(1, n - 1)) if callable(radius) else radius
        prev = list(range(idx * sides, idx * sides + sides))
        steps = 3
        for s_ in range(1, steps):
            ang = s_ / steps * math.pi / 2
            ring = []
            for k in range(sides):
                a = k / sides * math.tau
                q = p + t * (sign * math.sin(ang) * r * 0.8) + (side * math.cos(a) * r + up * math.sin(a) * r * flat) * math.cos(ang)
                verts.append(tuple(q))
                ring.append(len(verts) - 1)
            for k in range(sides):
                k2 = (k + 1) % sides
                if sign > 0:
                    faces.append((prev[k], prev[k2], ring[k2], ring[k]))
                else:
                    faces.append((prev[k], ring[k], ring[k2], prev[k2]))
            prev = ring
        verts.append(tuple(p + t * (sign * r * 0.8)))
        tipi = len(verts) - 1
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((prev[k], prev[k2], tipi) if sign > 0 else (prev[k], tipi, prev[k2]))
    if cap1:
        cap(n - 1, 1)
    if cap0:
        cap(0, -1)
    return verts, faces


def open_sweep(pts, radius, a0: float, a1: float, sides: int = 20, squash: float = 1.0, thick: float = 0.02):
    """A partial tube (angles a0..a1 in degrees, 0 = +X, -90 = front) with a little thickness,
    e.g. an open jacket over a shirt."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    frames = rmf_frames(pts)
    verts, faces = [], []
    for layer, dr in ((0, 0.0), (1, -thick)):
        for i, p in enumerate(pts):
            t, u, v = frames[i]
            r = (radius(i / max(1, n - 1)) if callable(radius) else radius) + dr
            for k in range(sides + 1):
                a = math.radians(a0 + (a1 - a0) * k / sides)
                verts.append(tuple(p + (u * math.cos(a) + v * math.sin(a) * squash) * r))
    row = sides + 1
    layer_n = n * row
    for i in range(n - 1):
        for k in range(sides):
            a = i * row + k
            faces.append((a, a + 1, a + 1 + row, a + row))
            b = layer_n + a
            faces.append((b, b + row, b + 1 + row, b + 1))
    # edges along the opening and the top/bottom rims
    for i in range(n - 1):
        for k in (0, sides):
            a = i * row + k
            b = layer_n + a
            if k == 0:
                faces.append((a, a + row, b + row, b))
            else:
                faces.append((a, b, b + row, a + row))
    for i in (0, n - 1):
        for k in range(sides):
            a = i * row + k
            b = layer_n + a
            if i == 0:
                faces.append((a, b, b + 1, a + 1))
            else:
                faces.append((a, a + 1, b + 1, b))
    return verts, faces


def cloth_strip(pts, width, normal_hint: Vector, folds: float = 2.5, amp: float = 0.025, thick: float = 0.02, wsteps: int = 8):
    """A soft cloth strip (scarf tail, sash end): a ribbon whose cross-section ripples in folds.
    width and amp may be functions of t along the strip."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    verts, faces = [], []
    cols = wsteps + 1
    for layer in (0, 1):
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            side = t.cross(normal_hint).normalized()
            nrm = side.cross(t).normalized()
            tt = i / max(1, n - 1)
            w = width(tt) if callable(width) else width
            a = amp(tt) if callable(amp) else amp
            for k in range(cols):
                sv = k / wsteps * 2 - 1
                off = math.sin((sv + 1) * folds * math.pi) * a
                q = p + side * (sv * w / 2) + nrm * (off + (thick / 2 if layer == 0 else -thick / 2))
                verts.append(tuple(q))
    L = n * cols
    for i in range(n - 1):
        for k in range(wsteps):
            a0 = i * cols + k
            faces.append((a0, a0 + 1, a0 + 1 + cols, a0 + cols))
            b0 = L + a0
            faces.append((b0, b0 + cols, b0 + 1 + cols, b0 + 1))
    for i in range(n - 1):
        for k in (0, wsteps):
            a0 = i * cols + k
            b0 = L + a0
            if k == 0:
                faces.append((a0, a0 + cols, b0 + cols, b0))
            else:
                faces.append((a0, b0, b0 + cols, a0 + cols))
    for i in (0, n - 1):
        for k in range(wsteps):
            a0 = i * cols + k
            b0 = L + a0
            if i == 0:
                faces.append((a0, b0, b0 + 1, a0 + 1))
            else:
                faces.append((a0, a0 + 1, b0 + 1, b0))
    return verts, faces
