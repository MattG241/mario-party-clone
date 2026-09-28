"""The festival district on the Suncoil valley floor: market booths with striped awnings, a
carousel, a Ferris wheel, a bandstand with benches, lantern strings, a pier with a rowboat,
raised flower beds, picnic spots, a greenhouse, beehives and a little camp.

Every builder adds geometry to a dict of MeshBuilders keyed by surface ('cloth', 'wood', 'paint',
'metal', 'glow', 'flowers', 'leaves', 'fruit', 'glass', 'rocks') and is authored at z = 0 in board
px (board.py drops the valley pieces onto the rolling valley floor afterwards). Sizes are in world
units (1 unit = 100 board px across; heights show at 62 px per unit on screen).
"""
from __future__ import annotations

import math

import numpy as np
from mathutils import Vector

import lib
from lib import board_to_world, col

FEST = ['#ff6b5e', '#f4b83b', '#1fa5a0', '#fff4dc', '#8e5cd9', '#5ab0f0']
LANTERN = ['#ffb347', '#ff8a5c', '#ffd27a', '#ff6f91', '#ffe29a']
CREAM = '#fff4dc'
DARKWOOD = '#5e3b22'


def _w(bx, by, z=0.0):
    return board_to_world(bx, by, z)


def _poly_quad(mb, a, b, c, d, colour):
    mb.add([a, b, c, d], [(0, 1, 2, 3)], colour)


# ------------------------------------------------------------------------------------------
# Market booth
def booth(B, bx, by, s, stripe, goods, rnd):
    """Market booth facing the camera: four posts, a painted counter heaped with goods, a billowing
    striped awning with scalloped flaps and a little sign board on top."""
    p = _w(bx, by)
    x, y = p.x, p.y
    Wd, D = 0.9 * s, 0.55 * s
    c1, c2 = col(stripe[0]), col(stripe[1])
    for (dx, dy) in [(-Wd / 2, -D / 2), (Wd / 2, -D / 2), (-Wd / 2, D / 2), (Wd / 2, D / 2)]:
        v, f = lib.cylinder((x + dx, y + dy, 0), 0.028 * s, 0.028 * s, (1.02 if dy > 0 else 0.86) * s, 8)
        B['wood'].add(v, f, col('#6e4a2c'))
    # counter: a cream box with a coloured front panel and a dark wooden top
    cy_ = y - D / 2 + 0.1 * s
    v, f = lib.box((x, cy_, 0.24 * s), (Wd - 0.04 * s, 0.22 * s, 0.48 * s))
    B['paint'].add(v, f, c2)
    v, f = lib.box((x, cy_ - 0.112 * s, 0.24 * s), (Wd - 0.12 * s, 0.01 * s, 0.34 * s))
    B['paint'].add(v, f, c1)
    v, f = lib.box((x, cy_, 0.495 * s), (Wd + 0.04 * s, 0.28 * s, 0.04 * s))
    B['wood'].add(v, f, col('#8a5e3a'))
    top = 0.515 * s
    if goods == 'fruit':
        for k in range(3):
            gx = x - Wd / 2 + 0.18 * s + k * (Wd - 0.36 * s) / 2
            v, f = lib.box((gx, cy_, top + 0.03 * s), (0.2 * s, 0.16 * s, 0.06 * s))
            B['wood'].add(v, f, col('#c28a4a'))
            fc = ['#ff5a4a', '#ffb33a', '#8bd346'][k]
            for j in range(6):
                v, f = lib.blob((gx + rnd.uniform(-0.07, 0.07) * s, cy_ + rnd.uniform(-0.05, 0.05) * s, top + 0.08 * s + rnd.uniform(0, 0.03) * s), 0.034 * s, rough=0.0, subdiv=1)
                B['fruit'].add(v, f, col(fc))
    elif goods == 'pots':
        for k in range(5):
            gx = x - Wd / 2 + 0.14 * s + k * (Wd - 0.28 * s) / 4
            hh = rnd.uniform(0.08, 0.14) * s
            v, f = lib.lathe([(0.03 * s, 0.0), (0.055 * s, hh * 0.45), (0.035 * s, hh), (0.04 * s, hh * 1.08)], 10, (gx, cy_, top), cap_bottom=True, cap_top=False)
            B['paint'].add(v, f, col(rnd.choice(['#d2693c', '#1fa5a0', '#e8b04a', '#f0e6d2'])))
    elif goods == 'flowers':
        for k in range(4):
            gx = x - Wd / 2 + 0.16 * s + k * (Wd - 0.32 * s) / 3
            v, f = lib.cylinder((gx, cy_, top), 0.045 * s, 0.05 * s, 0.07 * s, 10)
            B['paint'].add(v, f, col('#c9703f'))
            fc = rnd.choice(['#ff8fb1', '#ffe066', '#ffffff', '#c9a3ff', '#ff6b6b'])
            for j in range(5):
                v, f = lib.blob((gx + rnd.uniform(-0.04, 0.04) * s, cy_ + rnd.uniform(-0.03, 0.03) * s, top + 0.1 * s + rnd.uniform(0, 0.04) * s), 0.03 * s, rough=0.1, subdiv=1)
                B['flowers'].add(v, f, col(fc))
    elif goods == 'cloth':
        for k in range(5):
            gx = x - Wd / 2 + 0.14 * s + k * (Wd - 0.28 * s) / 4
            v, f = lib.cylinder((0, 0, 0), 0.045 * s, 0.045 * s, 0.2 * s, 10)
            v = lib.transform(v, loc=(gx, cy_ + 0.1 * s, top + 0.045 * s), rot=(math.pi / 2, 0.0, 0.0))
            B['cloth'].add(v, f, col(FEST[k % len(FEST)]))
    elif goods == 'bread':
        for k in range(6):
            gx = x - Wd / 2 + 0.12 * s + k * (Wd - 0.24 * s) / 5
            v, f = lib.blob((gx, cy_, top + 0.03 * s), 0.05 * s, squash=(1.3, 0.8, 0.6), rough=0.1, subdiv=1)
            B['paint'].add(v, f, col(rnd.choice(['#d8923e', '#c47a34', '#e6ad5a'])))
    # balloons tied to the front post on the toy booth
    if goods == 'toys':
        for k in range(5):
            gx = x - Wd / 2 + 0.14 * s + k * (Wd - 0.28 * s) / 4
            v, f = lib.blob((gx, cy_, top + 0.05 * s), 0.05 * s, rough=0.05, subdiv=1)
            B['paint'].add(v, f, col(FEST[(k + 1) % len(FEST)]))
        bxp, byp = x - Wd / 2 - 0.02 * s, y - D / 2
        for k in range(4):
            q = (bxp + rnd.uniform(-0.12, 0.12) * s, byp + rnd.uniform(-0.06, 0.06) * s, (1.2 + rnd.uniform(0, 0.25)) * s)
            v, f = lib.tube([(bxp, byp, 0.75 * s), q], 0.004 * s, 4)
            B['wood'].add(v, f, col('#fff4dc'))
            v, f = lib.blob(q, 0.075 * s, squash=(1, 1, 1.2), rough=0.0, subdiv=2)
            B['paint'].add(v, f, col(['#ff6b5e', '#5ab0f0', '#f4b83b', '#ff8fb1'][k]))
    # striped awning: billowing cloth from front to back with scalloped flaps at the front
    segs, rows = 6, 5
    z0, z1 = 0.84 * s, 1.02 * s
    yf, yb = y - D / 2 - 0.14 * s, y + D / 2 + 0.03 * s
    for k in range(segs):
        xa = x - Wd / 2 - 0.07 * s + k * (Wd + 0.14 * s) / segs
        xb = xa + (Wd + 0.14 * s) / segs
        cc = c1 if k % 2 == 0 else c2
        verts, faces = [], []
        for r in range(rows + 1):
            t = r / rows
            yy = yf + (yb - yf) * t
            zz = z0 + (z1 - z0) * t + 0.045 * s * math.sin(math.pi * t)
            for xx in (xa, (xa + xb) / 2, xb):
                verts.append((xx, yy, zz - (0.018 * s if xx not in (xa, xb) else 0.0)))
        for r in range(rows):
            for i in range(2):
                a = r * 3 + i
                faces.append((a, a + 1, a + 4, a + 3))
        n0 = len(verts)
        verts += [(vx, vy, vz - 0.02 * s) for (vx, vy, vz) in verts[:n0]]
        faces += [tuple(n0 + q for q in reversed(fc)) for fc in faces[:len(faces)]]
        B['cloth'].add(verts, faces, cc)
        mid, rad = (xa + xb) / 2, (xb - xa) / 2
        fan = [(mid, yf, z0)] + [(mid + math.cos(a) * rad, yf - 0.004, z0 - math.sin(a) * rad * 0.85) for a in [math.pi * j / 8 for j in range(9)]]
        ff = [(0, j + 1, j + 2) for j in range(8)]
        B['cloth'].add(fan, ff + [tuple(reversed(t)) for t in ff], cc)
    # sign board over the back of the awning
    v, f = lib.box((x, yb - 0.02 * s, z1 + 0.1 * s), (0.44 * s, 0.03 * s, 0.14 * s))
    B['paint'].add(v, f, c1)
    v, f = lib.box((x, yb - 0.035 * s, z1 + 0.1 * s), (0.36 * s, 0.01 * s, 0.08 * s))
    B['paint'].add(v, f, col(CREAM))
    return [Vector((x - Wd / 2 - 0.07 * s, yf, z0)), Vector((x + Wd / 2 + 0.07 * s, yf, z0))]


# ------------------------------------------------------------------------------------------
# Carousel
def carousel(B, bx, by, s, rnd):
    """Round carousel: a gold-trimmed deck, a striped pole, painted horses on brass poles and a
    striped canopy with scalloped valance, a ring of bulbs and a pennant on top."""
    p = _w(bx, by)
    x, y = p.x, p.y
    R = 0.72 * s
    v, f = lib.lathe([(R + 0.04 * s, 0.0), (R + 0.04 * s, 0.1 * s), (R, 0.13 * s), (0.0, 0.13 * s)], 32, (x, y, 0))
    B['wood'].add(v, f, col('#b07a45'))
    v, f = lib.lathe([(R + 0.045 * s, 0.07 * s), (R + 0.055 * s, 0.07 * s), (R + 0.055 * s, 0.11 * s), (R + 0.045 * s, 0.11 * s)], 32, (x, y, 0))
    B['metal'].add(v, f, col('#f2c14e'))
    # centre drum and pole
    v, f = lib.lathe([(0.2 * s, 0.13 * s), (0.2 * s, 0.55 * s), (0.12 * s, 0.6 * s), (0.08 * s, 1.1 * s)], 16, (x, y, 0), cap_bottom=False)
    B['paint'].add(v, f, lambda vv: col('#ff6b5e') if int((vv[2] / s) * 12) % 2 else col(CREAM))
    # horses on poles round the deck
    for k in range(8):
        a = k / 8 * math.tau + 0.2
        hx, hy = x + math.cos(a) * R * 0.72, y + math.sin(a) * R * 0.72
        v, f = lib.cylinder((hx, hy, 0.13 * s), 0.012 * s, 0.012 * s, 0.92 * s, 6)
        B['metal'].add(v, f, col('#f2c14e'))
        hz = (0.36 + 0.08 * math.sin(k * 1.7)) * s
        yaw = a + math.pi / 2
        hc = col(['#fffaf0', '#ffd8e6', '#d8ecff', '#fff0c2'][k % 4])
        body = lib.blob((0, 0, 0), 0.075 * s, squash=(1.9, 0.8, 0.9), rough=0.0, subdiv=2)
        bv = lib.transform(body[0], loc=(hx, hy, hz), rot=(0.0, 0.0, yaw))
        B['paint'].add(bv, body[1], hc)
        head = lib.blob((0, 0, 0), 0.045 * s, squash=(1.4, 0.8, 1.0), rough=0.0, subdiv=1)
        ox, oy = math.cos(yaw) * 0.13 * s, math.sin(yaw) * 0.13 * s
        hv = lib.transform(head[0], loc=(hx + ox, hy + oy, hz + 0.08 * s), rot=(0.0, -0.5, yaw))
        B['paint'].add(hv, head[1], hc)
        sv, sf = lib.box((hx, hy, hz + 0.065 * s), (0.08 * s, 0.07 * s, 0.02 * s), rot_z=yaw)
        B['paint'].add(sv, sf, col(FEST[k % 3]))
    # canopy: striped cone with a scalloped valance
    n = 16
    zc0, zc1 = 1.02 * s, 1.42 * s
    Rc = R + 0.12 * s
    for k in range(n):
        a0, a1 = k / n * math.tau, (k + 1) / n * math.tau
        cc = col('#ff6b5e') if k % 2 == 0 else col(CREAM)
        verts = [(x + math.cos(a0) * Rc, y + math.sin(a0) * Rc, zc0), (x + math.cos(a1) * Rc, y + math.sin(a1) * Rc, zc0),
                 (x + math.cos(a1) * Rc * 0.45, y + math.sin(a1) * Rc * 0.45, zc0 + (zc1 - zc0) * 0.7), (x + math.cos(a0) * Rc * 0.45, y + math.sin(a0) * Rc * 0.45, zc0 + (zc1 - zc0) * 0.7)]
        B['cloth'].add(verts, [(0, 1, 2, 3)], cc)
        B['cloth'].add([verts[3], verts[2], (x, y, zc1)], [(0, 1, 2)], cc)
        am = (a0 + a1) / 2
        fan = [(x + math.cos(am) * Rc, y + math.sin(am) * Rc, zc0)]
        for q in range(7):
            aa = a0 + (a1 - a0) * q / 6
            fan.append((x + math.cos(aa) * Rc * 1.004, y + math.sin(aa) * Rc * 1.004, zc0 - math.sin(math.pi * q / 6) * 0.07 * s))
        ff = [(0, q + 1, q + 2) for q in range(6)]
        B['cloth'].add(fan, ff + [tuple(reversed(t)) for t in ff], col('#f4b83b') if k % 2 else col('#1fa5a0'))
        # a bulb at every seam
        v, f = lib.blob((x + math.cos(a0) * Rc * 1.01, y + math.sin(a0) * Rc * 1.01, zc0 + 0.01 * s), 0.018 * s, rough=0.0, subdiv=1)
        B['glow'].add(v, f, col('#ffe29a'))
    v, f = lib.cylinder((x, y, zc1 - 0.02 * s), 0.012 * s, 0.01 * s, 0.22 * s, 6)
    B['wood'].add(v, f, col(DARKWOOD))
    v, f = lib.blob((x, y, zc1 + 0.21 * s), 0.035 * s, rough=0.0, subdiv=2)
    B['metal'].add(v, f, col('#f2c14e'))
    tri = [(x, y, zc1 + 0.19 * s), (x, y, zc1 + 0.1 * s), (x + 0.16 * s, y, zc1 + 0.145 * s)]
    B['cloth'].add(tri, [(0, 1, 2), (2, 1, 0)], col('#1fa5a0'))
    return Vector((x, y, zc1 + 0.2 * s))


# ------------------------------------------------------------------------------------------
# Ferris wheel
def ferris_wheel(B, bx, by, s, rnd):
    """A small Ferris wheel facing the camera: A-frame legs, a double rim with spokes, a ring of bulbs
    and eight colourful gondolas hanging level."""
    p = _w(bx, by)
    x, y = p.x, p.y
    R = 0.95 * s
    hz = R + 0.28 * s
    # base platform
    v, f = lib.box((x, y, 0.05 * s), (1.2 * s, 0.5 * s, 0.1 * s))
    B['wood'].add(v, f, col('#a8744a'))
    # A-frame legs front and back of the wheel
    for dy in (-0.14 * s, 0.14 * s):
        for dx in (-0.55 * s, 0.55 * s):
            v, f = lib.tube([(x + dx, y + dy, 0.08 * s), (x, y + dy * 0.6, hz)], 0.03 * s, 6)
            B['paint'].add(v, f, col(CREAM))
    v, f = lib.cylinder((0, 0, 0), 0.05 * s, 0.05 * s, 0.34 * s, 10)
    v = lib.transform(v, loc=(x, y - 0.17 * s, hz), rot=(-math.pi / 2, 0.0, 0.0))
    B['metal'].add(v, f, col('#f2c14e'))
    # two rims (front and back) with spokes
    for dy in (-0.08 * s, 0.08 * s):
        rim = [(x + math.cos(t) * R, y + dy, hz + math.sin(t) * R) for t in np.linspace(0, math.tau, 49)]
        v, f = lib.tube(rim, 0.022 * s, 6)
        B['paint'].add(v, f, col('#ff6b5e'))
        for k in range(12):
            t = k / 12 * math.tau
            v, f = lib.tube([(x, y + dy, hz), (x + math.cos(t) * R, y + dy, hz + math.sin(t) * R)], 0.009 * s, 4)
            B['paint'].add(v, f, col(CREAM))
    # bulbs along the front rim
    for k in range(24):
        t = k / 24 * math.tau
        v, f = lib.blob((x + math.cos(t) * R, y - 0.105 * s, hz + math.sin(t) * R), 0.02 * s, rough=0.0, subdiv=1)
        B['glow'].add(v, f, col('#ffe29a' if k % 2 else '#ffb347'))
    # gondolas: a little cup with a striped roof, hanging level under each of eight hubs
    for k in range(8):
        t = k / 8 * math.tau + 0.2
        gx, gz = x + math.cos(t) * R, hz + math.sin(t) * R
        v, f = lib.cylinder((0, 0, 0), 0.012 * s, 0.012 * s, 0.2 * s, 6)
        v = lib.transform(v, loc=(gx, y - 0.1 * s, gz), rot=(-math.pi / 2, 0.0, 0.0))
        B['metal'].add(v, f, col('#b8b0a0'))
        cc = col(FEST[k % 6])
        v, f = lib.lathe([(0.07 * s, 0.0), (0.1 * s, 0.05 * s), (0.1 * s, 0.11 * s)], 12, (gx, y, gz - 0.25 * s), cap_bottom=True, cap_top=False)
        B['paint'].add(v, f, cc)
        v, f = lib.cylinder((gx, y, gz - 0.14 * s), 0.008 * s, 0.008 * s, 0.14 * s, 4)
        B['metal'].add(v, f, col('#b8b0a0'))
        v, f = lib.lathe([(0.11 * s, 0.0), (0.0, 0.06 * s)], 12, (gx, y, gz - 0.02 * s), cap_bottom=True, cap_top=False)
        B['cloth'].add(v, f, cc)
    return Vector((x, y, hz + R))


# ------------------------------------------------------------------------------------------
# Bandstand and benches
def bandstand(B, bx, by, s, rnd):
    """Octagonal bandstand: a low stone base, white posts with a railing and a striped roof."""
    p = _w(bx, by)
    x, y = p.x, p.y
    n = 8
    R = 0.52 * s
    off = math.pi / n

    def ring(r, z):
        return [(x + math.cos(off + k / n * math.tau) * r, y + math.sin(off + k / n * math.tau) * r, z) for k in range(n)]

    v, f = lib.lathe([(R + 0.06 * s, 0.0), (R + 0.06 * s, 0.14 * s), (0.0, 0.14 * s)], n, (x, y, 0))
    v = [(x + (vx - x) * math.cos(off) - (vy - y) * math.sin(off), y + (vx - x) * math.sin(off) + (vy - y) * math.cos(off), vz) for (vx, vy, vz) in v]
    B['stone'].add(v, f, col('#e9dfcf'))
    v, f = lib.lathe([(R + 0.02 * s, 0.14 * s), (R + 0.02 * s, 0.16 * s), (0.0, 0.16 * s)], 24, (x, y, 0))
    B['wood'].add(v, f, col('#c08a52'))
    posts = ring(R, 0.16 * s)
    for k, (px_, py_, pz) in enumerate(posts):
        v, f = lib.cylinder((px_, py_, pz), 0.025 * s, 0.025 * s, 0.62 * s, 8)
        B['paint'].add(v, f, col(CREAM))
    for k in range(n):
        if k == 6:  # the steps side (towards the camera) stays open
            continue
        a, b = posts[k], posts[(k + 1) % n]
        v, f = lib.tube([(a[0], a[1], 0.34 * s), (b[0], b[1], 0.34 * s)], 0.012 * s, 5)
        B['paint'].add(v, f, col(CREAM))
    # roof
    zr0, zr1 = 0.78 * s, 1.12 * s
    rr = R + 0.12 * s
    rim = ring(rr, zr0)
    for k in range(n):
        a, b = rim[k], rim[(k + 1) % n]
        cc = col('#1fa5a0') if k % 2 == 0 else col(CREAM)
        B['cloth'].add([a, b, (x, y, zr1)], [(0, 1, 2)], cc)
        B['cloth'].add([a, b, (b[0], b[1], zr0 - 0.05 * s), (a[0], a[1], zr0 - 0.05 * s)], [(0, 1, 2, 3), (3, 2, 1, 0)], col('#f4b83b') if k % 2 else col('#1fa5a0'))
    v, f = lib.blob((x, y, zr1 + 0.04 * s), 0.04 * s, rough=0.0, subdiv=2)
    B['metal'].add(v, f, col('#f2c14e'))
    # music stands and a drum on the deck
    for k in range(3):
        a = math.pi / 2 + (k - 1) * 0.7
        qx, qy = x + math.cos(a) * R * 0.45, y + math.sin(a) * R * 0.45
        v, f = lib.cylinder((qx, qy, 0.16 * s), 0.008 * s, 0.008 * s, 0.22 * s, 4)
        B['metal'].add(v, f, col('#3a3a44'))
        v, f = lib.box((qx, qy, 0.4 * s), (0.1 * s, 0.01 * s, 0.07 * s), rot_z=a + math.pi / 2)
        B['metal'].add(v, f, col('#3a3a44'))
    v, f = lib.cylinder((x, y + 0.05 * s, 0.16 * s), 0.08 * s, 0.08 * s, 0.1 * s, 12)
    B['paint'].add(v, f, col('#ff6b5e'))
    return Vector((x, y, zr1))


def bench(B, bx, by, yaw, rnd, s=1.0):
    p = _w(bx, by)
    for (dx, z, w, d, h) in [(0.0, 0.14, 0.42, 0.11, 0.025), (-0.05, 0.24, 0.42, 0.02, 0.09)]:
        ox, oy = -math.sin(yaw) * dx * s, math.cos(yaw) * dx * s
        v, f = lib.box((p.x + ox, p.y + oy, z * s), (w * s, d * s, h * s), rot_z=yaw)
        B['wood'].add(v, f, col('#a8744a'))
    for sgn in (-1, 1):
        ox, oy = math.cos(yaw) * 0.18 * s * sgn, math.sin(yaw) * 0.18 * s * sgn
        v, f = lib.box((p.x + ox, p.y + oy, 0.07 * s), (0.03 * s, 0.1 * s, 0.14 * s), rot_z=yaw)
        B['metal'].add(v, f, col('#4a4a52'))


# ------------------------------------------------------------------------------------------
# Lantern strings and poles
def lantern_pole(B, bx, by, h=1.1):
    p = _w(bx, by)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.025, 0.02, h, 8)
    B['wood'].add(v, f, col('#6e4a2c'))
    v, f = lib.blob((p.x, p.y, h + 0.03), 0.035, rough=0.0, subdiv=2)
    B['metal'].add(v, f, col('#f2c14e'))
    return Vector((p.x, p.y, h - 0.02))


def lantern_string(B, a, b, rnd, sag=0.18, step=0.16):
    """A cord between two points (world, above the ground) with round paper lanterns hanging from it."""
    L = (b - a).length
    n = max(3, int(L / step))
    pts = []
    for i in range(2 * n + 1):
        t = i / (2 * n)
        q = a + (b - a) * t
        pts.append((q.x, q.y, q.z - sag * math.sin(math.pi * t)))
    v, f = lib.tube(pts, 0.006, 4)
    B['wood'].add(v, f, col('#4a3426'))
    for k in range(1, n):
        q = Vector(pts[2 * k])
        c = LANTERN[(k + int(rnd.random() * 5)) % len(LANTERN)]
        v, f = lib.lathe([(0.012, 0.0), (0.04, 0.02), (0.045, 0.05), (0.036, 0.08), (0.012, 0.095)], 10, (q.x, q.y, q.z - 0.12))
        B['glow'].add(v, f, col(c))
        v, f = lib.tube([(q.x, q.y, q.z), (q.x, q.y, q.z - 0.025)], 0.004, 4)
        B['wood'].add(v, f, col('#4a3426'))


def pennant_string(B, a, b, rnd, sag=0.16):
    """Bunting: triangular pennants in festival colours along a sagging cord."""
    L = (b - a).length
    n = max(4, int(L / 0.14))
    pts = []
    for i in range(2 * n + 1):
        t = i / (2 * n)
        q = a + (b - a) * t
        pts.append((q.x, q.y, q.z - sag * math.sin(math.pi * t)))
    v, f = lib.tube(pts, 0.006, 4)
    B['wood'].add(v, f, col('#5a3e2a'))
    for k in range(n):
        p0, p1 = Vector(pts[2 * k]), Vector(pts[2 * k + 2])
        mid = (p0 + p1) / 2
        tip = Vector((mid.x, mid.y - 0.01, mid.z - 0.12))
        tri = [tuple(p0.lerp(p1, 0.08)), tuple(p0.lerp(p1, 0.92)), tuple(tip)]
        B['cloth'].add(tri, [(0, 1, 2), (2, 1, 0)], col(FEST[k % len(FEST)]))


# ------------------------------------------------------------------------------------------
# Pier and rowboat
def pier(B, pts, rnd, width=0.26):
    """Plank boardwalk along board points (the first on the shore), on posts, with a rail on one side
    and a wider landing at the far end with two lamp posts."""
    P = [np.asarray(q, float) for q in pts]
    deck_z = 0.1
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        A, Bw = _w(*a), _w(*b)
        d = Bw - A
        L = d.length
        d.normalize()
        yaw = math.atan2(d.y, d.x)
        side = Vector((-d.y, d.x, 0.0))
        n = max(2, int(L / 0.075))
        for k in range(n):
            c = A + d * ((k + 0.5) / n * L)
            v, f = lib.box((c.x, c.y, deck_z), (L / n * 0.86, width + rnd.uniform(-0.01, 0.012), 0.03), rot_z=yaw)
            B['wood'].add(v, f, col(rnd.choice(['#b98a55', '#a87a48', '#c49660', '#b3834f'])))
        m = max(1, int(L / 0.32))
        for k in range(m + 1):
            c = A + d * (k / m * L)
            for sgn in (-1, 1):
                q = c + side * (sgn * width * 0.46)
                v, f = lib.cylinder((q.x, q.y, -0.12), 0.024, 0.024, deck_z + 0.02 + 0.12, 8)
                B['wood'].add(v, f, col('#6e4a2c'))
                if sgn > 0:
                    v, f = lib.cylinder((q.x, q.y, deck_z), 0.016, 0.016, 0.16, 6)
                    B['wood'].add(v, f, col('#7a5234'))
        ra, rb = A + side * (width * 0.46), Bw + side * (width * 0.46)
        v, f = lib.tube([(ra.x, ra.y, deck_z + 0.15), (rb.x, rb.y, deck_z + 0.15)], 0.012, 5)
        B['wood'].add(v, f, col('#8a5e3a'))
    # landing at the end, square to the last stretch
    end, prev = P[-1], P[-2]
    E = _w(*end)
    d = (E - _w(*prev)).normalized()
    yaw = math.atan2(d.y, d.x)
    side = Vector((-d.y, d.x, 0.0))
    for k in range(6):
        c = E + d * (0.02 + k * 0.06) - d * 0.05
        v, f = lib.box((c.x, c.y, deck_z), (0.055, width * 2.2, 0.03), rot_z=yaw)
        B['wood'].add(v, f, col(rnd.choice(['#b98a55', '#a87a48', '#c49660'])))
    for sgn in (-1, 1):
        q = E + d * 0.12 + side * (sgn * width * 1.0)
        v, f = lib.cylinder((q.x, q.y, -0.12), 0.024, 0.024, deck_z + 0.14, 8)
        B['wood'].add(v, f, col('#6e4a2c'))
        v, f = lib.cylinder((q.x, q.y, deck_z), 0.014, 0.012, 0.48, 6)
        B['wood'].add(v, f, col('#4a3a34'))
        v, f = lib.lathe([(0.0, 0.0), (0.035, 0.015), (0.04, 0.07), (0.028, 0.1), (0.0, 0.11)], 8, (q.x, q.y, deck_z + 0.44))
        B['glow'].add(v, f, col('#ffd27a'))
        v, f = lib.lathe([(0.05, 0.0), (0.0, 0.035)], 8, (q.x, q.y, deck_z + 0.55), cap_bottom=True, cap_top=False)
        B['metal'].add(v, f, col('#3a2e2a'))


def rowboat(B, bx, by, yaw, rnd, s=1.0, hull='#e8604c'):
    """Little rowboat: a painted hull with a wooden rim, two thwarts and a pair of oars."""
    p = _w(bx, by)
    L, Wd, Hh = 0.5 * s, 0.2 * s, 0.09 * s
    verts, faces = [], []
    n = 12
    rows = [(0.0, 1.0), (0.45, 0.85), (1.0, 0.0)]  # (depth fraction, width scale)
    for (dz, ws) in rows:
        for k in range(n):
            t = k / (n - 1)
            u = (t * 2 - 1)
            half = Wd / 2 * ws * math.sqrt(max(0.0, 1 - u ** 4)) + 0.002
            verts.append((u * L / 2 * (1 - 0.1 * dz), half, 0.06 * s - dz * Hh))
        for k in range(n - 1, -1, -1):
            t = k / (n - 1)
            u = (t * 2 - 1)
            half = Wd / 2 * ws * math.sqrt(max(0.0, 1 - u ** 4)) + 0.002
            verts.append((u * L / 2 * (1 - 0.1 * dz), -half, 0.06 * s - dz * Hh))
    ring = 2 * n
    for r in range(len(rows) - 1):
        for k in range(ring):
            a, b = r * ring + k, r * ring + (k + 1) % ring
            faces.append((a, b, b + ring, a + ring))
    v = lib.transform(verts, loc=(p.x, p.y, 0.0), rot=(0.0, 0.0, yaw))
    B['paint'].add(v, faces, lambda vv: col(hull) if vv[2] < 0.045 * s else col('#fff4dc'))
    rim = [verts[k] for k in range(ring)] + [verts[0]]
    rim = lib.transform([(vx, vy, vz + 0.005) for (vx, vy, vz) in rim], loc=(p.x, p.y, 0.0), rot=(0.0, 0.0, yaw))
    v, f = lib.tube(rim, 0.01 * s, 4)
    B['wood'].add(v, f, col('#8a5e3a'))
    for u in (-0.1, 0.1):
        tv, tf = lib.box((u * s, 0.0, 0.035 * s), (0.04 * s, Wd * 0.9, 0.012 * s))
        B['wood'].add(lib.transform(tv, loc=(p.x, p.y, 0.0), rot=(0.0, 0.0, yaw)), tf, col('#b07a45'))
    for sgn in (-1, 1):
        ov, of = lib.tube([(0.02 * s, sgn * 0.06 * s, 0.05 * s), (-0.12 * s, sgn * 0.26 * s, 0.0)], 0.007 * s, 4)
        B['wood'].add(lib.transform(ov, loc=(p.x, p.y, 0.0), rot=(0.0, 0.0, yaw)), of, col('#c49660'))


# ------------------------------------------------------------------------------------------
# Gardens, picnics and small props
def flower_beds(B, bx, by, cols_, rows_, rnd, bw=0.5, bd=0.26, gap=0.12):
    """A grid of raised flower beds: pale timber borders brimming with one bright colour each, on a
    bed of leaves (the soil barely shows)."""
    p = _w(bx, by)
    pal = ['#ff6b8a', '#ffd23f', '#fff6ea', '#b28dff', '#ff9a3c', '#ff4f5e', '#7fd0ff']
    k = 0
    for r in range(rows_):
        for c in range(cols_):
            cx = p.x + (c - (cols_ - 1) / 2) * (bw + gap)
            cy = p.y + (r - (rows_ - 1) / 2) * (bd + gap)
            v, f = lib.box((cx, cy, 0.035), (bw + 0.04, bd + 0.04, 0.07))
            B['wood'].add(v, f, col('#c49660'))
            v, f = lib.box((cx, cy, 0.072), (bw - 0.02, bd - 0.02, 0.004))
            B['wood'].add(v, f, col('#6e4a2c'))
            fc = col(pal[(k * 3 + rnd.randint(0, 1)) % len(pal)])
            hi = lib.lerp_col(fc, col('#ffffff'), 0.4)
            k += 1
            nx, ny = int(bw / 0.045), int(bd / 0.05)
            for i in range(nx):
                for j in range(ny):
                    fx = cx - bw / 2 + 0.03 + i * (bw - 0.06) / max(1, nx - 1) + rnd.uniform(-0.008, 0.008)
                    fy = cy - bd / 2 + 0.03 + j * (bd - 0.06) / max(1, ny - 1) + rnd.uniform(-0.008, 0.008)
                    v, f = lib.blob((fx, fy, 0.085), 0.03, squash=(1, 1, 0.6), rough=0.15, subdiv=1, seed=rnd.random() * 9)
                    B['leaves'].add(v, f, col(rnd.choice(['#3f8f3a', '#4c9c3c', '#357f34'])))
                    if (i + j) % 3 != 2:
                        v, f = lib.blob((fx + rnd.uniform(-0.01, 0.01), fy, 0.115), 0.029, squash=(1, 1, 0.7), rough=0.15, subdiv=1, seed=rnd.random() * 9)
                        B['flowers'].add(v, f, lambda vv, z0=0.11: hi if vv[2] > z0 + 0.01 else fc)


def picnic(B, bx, by, yaw, rnd, cloth=('#ff6b5e', '#fff4dc')):
    """Checked picnic blanket with a basket, a bottle and a plate of fruit."""
    p = _w(bx, by)
    n, sz = 4, 0.075
    for i in range(n):
        for j in range(n):
            u, v_ = (i - (n - 1) / 2) * sz, (j - (n - 1) / 2) * sz
            q = [(u - sz / 2, v_ - sz / 2, 0.012), (u + sz / 2, v_ - sz / 2, 0.012), (u + sz / 2, v_ + sz / 2, 0.012), (u - sz / 2, v_ + sz / 2, 0.012)]
            q = lib.transform(q, loc=(p.x, p.y, 0.0), rot=(0.0, 0.0, yaw))
            B['cloth'].add(q, [(0, 1, 2, 3)], col(cloth[(i + j) % 2]))
    bv, bf = lib.box((0.09, 0.07, 0.045), (0.1, 0.07, 0.07))
    B['wood'].add(lib.transform(bv, loc=(p.x, p.y, 0.0), rot=(0.0, 0.0, yaw)), bf, col('#c28a4a'))
    hv, hf = lib.tube([(0.05, 0.07, 0.08), (0.09, 0.07, 0.13), (0.13, 0.07, 0.08)], 0.006, 4)
    B['wood'].add(lib.transform(hv, loc=(p.x, p.y, 0.0), rot=(0.0, 0.0, yaw)), hf, col('#8a5e3a'))
    for k in range(4):
        fx, fy = -0.07 + rnd.uniform(-0.02, 0.02), -0.05 + rnd.uniform(-0.02, 0.02)
        v, f = lib.blob((fx, fy, 0.03), 0.02, rough=0.0, subdiv=1)
        B['fruit'].add(lib.transform(v, loc=(p.x, p.y, 0.0), rot=(0.0, 0.0, yaw)), f, col(['#ff5a4a', '#ffb33a', '#8bd346', '#ff5a4a'][k]))


def parasol_table(B, bx, by, stripe, rnd):
    p = _w(bx, by)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.02, 0.02, 0.2, 6)
    B['wood'].add(v, f, col('#6e4a2c'))
    v, f = lib.cylinder((p.x, p.y, 0.2), 0.13, 0.13, 0.025, 14)
    B['wood'].add(v, f, col('#c49660'))
    for k in range(2):
        a = k * math.pi + 0.5
        v, f = lib.cylinder((p.x + math.cos(a) * 0.2, p.y + math.sin(a) * 0.2, 0.0), 0.05, 0.05, 0.12, 10)
        B['wood'].add(v, f, col('#a8744a'))
    v, f = lib.cylinder((p.x, p.y, 0.2), 0.01, 0.01, 0.5, 5)
    B['wood'].add(v, f, col('#e8e0d0'))
    n = 8
    for k in range(n):
        a0, a1 = k / n * math.tau, (k + 1) / n * math.tau
        tri = [(p.x + math.cos(a0) * 0.3, p.y + math.sin(a0) * 0.3, 0.6), (p.x + math.cos(a1) * 0.3, p.y + math.sin(a1) * 0.3, 0.6), (p.x, p.y, 0.74)]
        B['cloth'].add(tri, [(0, 1, 2), (2, 1, 0)], col(stripe[k % 2]))


def food_cart(B, bx, by, stripe, rnd):
    """Two-wheeled snack cart with a striped umbrella."""
    p = _w(bx, by)
    v, f = lib.box((p.x, p.y, 0.24), (0.42, 0.24, 0.2))
    B['paint'].add(v, f, col(stripe[1]))
    v, f = lib.box((p.x, p.y - 0.121, 0.24), (0.36, 0.005, 0.12))
    B['paint'].add(v, f, col(stripe[0]))
    for sgn in (-1, 1):
        v, f = lib.cylinder((0, 0, 0), 0.1, 0.1, 0.03, 14)
        v = lib.transform(v, loc=(p.x + sgn * 0.14, p.y - 0.13, 0.1), rot=(math.pi / 2, 0.0, 0.0))
        B['wood'].add(v, f, col('#6e4a2c'))
    v, f = lib.tube([(p.x + 0.21, p.y, 0.3), (p.x + 0.42, p.y, 0.26)], 0.01, 4)
    B['wood'].add(v, f, col('#6e4a2c'))
    v, f = lib.cylinder((p.x - 0.1, p.y + 0.05, 0.34), 0.01, 0.01, 0.4, 5)
    B['wood'].add(v, f, col('#e8e0d0'))
    for k in range(8):
        a0, a1 = k / 8 * math.tau, (k + 1) / 8 * math.tau
        cx, cy = p.x - 0.1, p.y + 0.05
        tri = [(cx + math.cos(a0) * 0.28, cy + math.sin(a0) * 0.28, 0.7), (cx + math.cos(a1) * 0.28, cy + math.sin(a1) * 0.28, 0.7), (cx, cy, 0.84)]
        B['cloth'].add(tri, [(0, 1, 2), (2, 1, 0)], col(stripe[k % 2]))
    for k in range(4):
        v, f = lib.blob((p.x - 0.12 + k * 0.08, p.y - 0.05, 0.37), 0.03, rough=0.0, subdiv=1)
        B['fruit'].add(v, f, col(['#ff8fb1', '#fff4dc', '#ffd23f', '#8ff0ff'][k]))


def beehives(B, bx, by, rnd):
    p = _w(bx, by)
    for k in range(3):
        hx, hy = p.x + (k - 1) * 0.18, p.y + rnd.uniform(-0.02, 0.02)
        for j in range(rnd.randint(2, 3)):
            v, f = lib.box((hx, hy, 0.05 + j * 0.085), (0.14, 0.12, 0.08))
            B['paint'].add(v, f, col(['#fff4dc', '#f4d27a', '#fff4dc'][j % 3]))
        top = 0.05 + (j + 1) * 0.085
        v, f = lib.box((hx, hy, top - 0.02), (0.17, 0.15, 0.025))
        B['wood'].add(v, f, col('#8a5e3a'))


def scarecrow(B, bx, by, rnd):
    p = _w(bx, by)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.015, 0.015, 0.62, 6)
    B['wood'].add(v, f, col('#6e4a2c'))
    v, f = lib.tube([(p.x - 0.2, p.y, 0.44), (p.x + 0.2, p.y, 0.46)], 0.013, 5)
    B['wood'].add(v, f, col('#6e4a2c'))
    v, f = lib.blob((p.x, p.y, 0.4), 0.09, squash=(1.1, 0.7, 1.2), rough=0.1, subdiv=2)
    B['cloth'].add(v, f, col('#3f7fc0'))
    v, f = lib.blob((p.x, p.y, 0.6), 0.065, rough=0.1, subdiv=2)
    B['paint'].add(v, f, col('#e8c070'))
    v, f = lib.lathe([(0.14, 0.0), (0.06, 0.01), (0.05, 0.08), (0.0, 0.09)], 12, (p.x, p.y, 0.64))
    B['paint'].add(v, f, col('#d8a848'))


def signpost(B, bx, by, rnd):
    p = _w(bx, by)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.022, 0.022, 0.5, 6)
    B['wood'].add(v, f, col('#6e4a2c'))
    for k, (z, yaw, c) in enumerate([(0.44, 0.35, '#f4b83b'), (0.35, -0.5, '#1fa5a0')]):
        v, f = lib.box((p.x + math.cos(yaw) * 0.08, p.y + math.sin(yaw) * 0.08, z), (0.2, 0.02, 0.06), rot_z=yaw)
        B['paint'].add(v, f, col(c))


def greenhouse(B, bx, by, s, rnd):
    """Small glasshouse: tinted see-through panes in a white frame (posts, rails, roof ribs), a
    dark green ridge cap and door, and benches of potted plants and flowers inside."""
    p = _w(bx, by)
    x, y = p.x, p.y
    Wd, D, Hh, Rz = 1.0 * s, 0.6 * s, 0.38 * s, 0.64 * s
    z0 = 0.06
    white, dark = col('#fbfaf4'), col('#2f5a46')
    v, f = lib.box((x, y, z0 / 2), (Wd + 0.06, D + 0.06, z0))
    B['stone'].add(v, f, col('#cfc3b0'))
    # inside: two benches of pots along the long walls, greenery and flowers
    for sgn in (-1, 1):
        yy = y + sgn * D * 0.28
        v, f = lib.box((x, yy, z0 + 0.1), (Wd - 0.12, D * 0.3, 0.025))
        B['wood'].add(v, f, col('#a8744a'))
        for k in range(7):
            px_ = x - Wd / 2 + 0.1 + k * (Wd - 0.2) / 6
            v, f = lib.cylinder((px_, yy, z0 + 0.112), 0.032, 0.038, 0.05, 8)
            B['paint'].add(v, f, col('#c9703f'))
            v, f = lib.blob((px_, yy, z0 + 0.19), rnd.uniform(0.045, 0.06), squash=(1, 1, 1.1), rough=0.25, subdiv=2, seed=rnd.random() * 9)
            B['leaves'].add(v, f, col(rnd.choice(['#3f9b33', '#4aa83a', '#2f8a2c', '#5cb040'])))
            if k % 2 == 0:
                v, f = lib.blob((px_ + 0.01, yy - 0.01, z0 + 0.235), 0.022, rough=0.1, subdiv=1)
                B['flowers'].add(v, f, col(rnd.choice(['#ff5a6e', '#ffd23f', '#ff9ecb', '#ffffff'])))
    # glass: walls, roof slopes and gable ends (tinted, partly see-through)
    glass = col('#8ccfbe')
    for sgn in (-1, 1):
        wall = [(x - Wd / 2, y + sgn * D / 2, z0), (x + Wd / 2, y + sgn * D / 2, z0), (x + Wd / 2, y + sgn * D / 2, z0 + Hh), (x - Wd / 2, y + sgn * D / 2, z0 + Hh)]
        B['glass'].add(wall, [(0, 1, 2, 3), (3, 2, 1, 0)], glass)
        roof = [(x - Wd / 2, y + sgn * D / 2, z0 + Hh), (x + Wd / 2, y + sgn * D / 2, z0 + Hh), (x + Wd / 2, y, Rz), (x - Wd / 2, y, Rz)]
        B['glass'].add(roof, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#9ed8c8'))
        end_ = [(x + sgn * Wd / 2, y - D / 2, z0), (x + sgn * Wd / 2, y + D / 2, z0), (x + sgn * Wd / 2, y + D / 2, z0 + Hh), (x + sgn * Wd / 2, y, Rz),
                (x + sgn * Wd / 2, y - D / 2, z0 + Hh)]
        B['glass'].add(end_, [(0, 1, 2, 3, 4), (4, 3, 2, 1, 0)], glass)
    # white frame: corner and wall posts, eave and mid rails, roof ribs, gable framing
    fw = 0.028
    n = 5
    for i in range(n + 1):
        fx = x - Wd / 2 + i * Wd / n
        for sgn in (-1, 1):
            v, f = lib.box((fx, y + sgn * D / 2, z0 + Hh / 2), (fw, fw, Hh))
            B['paint'].add(v, f, white)
            v, f = lib.tube([(fx, y + sgn * D / 2, z0 + Hh), (fx, y, Rz)], fw * 0.55, 4)
            B['paint'].add(v, f, white)
    for sgn in (-1, 1):
        for zz in (z0 + 0.02, z0 + Hh * 0.55, z0 + Hh):
            v, f = lib.box((x, y + sgn * D / 2, zz), (Wd + fw, fw, fw))
            B['paint'].add(v, f, white)
        for u in (-1, 1):
            v, f = lib.box((x + sgn * Wd / 2, y + u * D / 4, z0 + Hh), (fw, D / 2, fw))
            B['paint'].add(v, f, white)
            v, f = lib.box((x + sgn * Wd / 2, y + u * D / 2, z0 + Hh / 2), (fw, fw, Hh))
            B['paint'].add(v, f, white)
            v, f = lib.tube([(x + sgn * Wd / 2, y + u * D / 2, z0 + Hh), (x + sgn * Wd / 2, y, Rz)], fw * 0.55, 4)
            B['paint'].add(v, f, white)
        v, f = lib.box((x + sgn * Wd / 2, y, (z0 + Hh + Rz) / 2), (fw, fw, Rz - z0 - Hh))
        B['paint'].add(v, f, white)
    # dark ridge cap and a door in the camera-facing wall
    v, f = lib.box((x, y, Rz + 0.012), (Wd + 0.05, 0.05, 0.03))
    B['paint'].add(v, f, dark)
    v, f = lib.box((x, y - D / 2 - 0.004, z0 + 0.14), (0.16, 0.012, 0.28))
    B['paint'].add(v, f, dark)
    v, f = lib.box((x, y - D / 2 - 0.009, z0 + 0.14), (0.11, 0.006, 0.22))
    B['glass'].add(v, f, col('#6fbcae'))
    # a watering can and a sack by the door
    v, f = lib.cylinder((x + 0.2, y - D / 2 - 0.09, 0.0), 0.035, 0.035, 0.07, 10)
    B['metal'].add(v, f, col('#6fa08c'))
    v, f = lib.blob((x - 0.22, y - D / 2 - 0.08, 0.05), 0.055, squash=(1, 0.9, 1.1), rough=0.2, subdiv=2)
    B['cloth'].add(v, f, col('#c9a66b'))


def campsite(B, bx, by, rnd):
    """A little camp: a ridge tent with its door facing the camera, a campfire with glowing embers
    and two log seats."""
    p = _w(bx, by)
    x, y = p.x, p.y
    Wd, L, Hh = 0.36, 0.46, 0.4  # across, along the ridge (north-south), ridge height
    fy0, fy1 = y - L / 2, y + L / 2
    tent = [(x - Wd / 2, fy0, 0.0), (x + Wd / 2, fy0, 0.0), (x + Wd / 2, fy1, 0.0), (x - Wd / 2, fy1, 0.0), (x, fy0 - 0.03, Hh), (x, fy1, Hh)]
    B['cloth'].add(tent, [(0, 4, 5, 3), (1, 2, 5, 4)], lambda vv: col('#f4b83b') if vv[0] < x else col('#e0962c'))
    B['cloth'].add([tent[0], tent[1], tent[4]], [(0, 1, 2), (2, 1, 0)], col('#ffd166'))  # front gable
    B['cloth'].add([(x - 0.07, fy0 - 0.004, 0.0), (x + 0.07, fy0 - 0.004, 0.0), (x, fy0 - 0.02, Hh * 0.62)], [(0, 1, 2), (2, 1, 0)], col('#5a3a2a'))  # door
    B['cloth'].add([tent[3], tent[5], tent[2]], [(0, 1, 2), (2, 1, 0)], col('#e0962c'))
    v, f = lib.tube([(x, fy0 - 0.03, Hh), (x, fy1, Hh)], 0.008, 4)
    B['wood'].add(v, f, col('#6e4a2c'))
    fx, fy = x + 0.34, y - 0.2
    for k in range(7):
        a = k / 7 * math.tau
        v, f = lib.blob((fx + math.cos(a) * 0.09, fy + math.sin(a) * 0.07, 0.02), 0.03, squash=(1.2, 1, 0.7), rough=0.3, subdiv=1, seed=k)
        B['rocks'].add(v, f, col('#9a928a'))
    for k in range(3):
        a = k / 3 * math.tau + 0.3
        v, f = lib.tube([(fx + math.cos(a) * 0.07, fy + math.sin(a) * 0.05, 0.01), (fx - math.cos(a) * 0.02, fy - math.sin(a) * 0.015, 0.08)], 0.012, 5)
        B['wood'].add(v, f, col('#5e3b22'))
    for k in range(3):
        v, f = lib.blob((fx + rnd.uniform(-0.02, 0.02), fy + rnd.uniform(-0.02, 0.02), 0.05 + k * 0.03), 0.035 - k * 0.008, squash=(1, 1, 1.4), rough=0.3, subdiv=1, seed=k * 3)
        B['glow'].add(v, f, col(['#ff7a2a', '#ffb347', '#ffe08a'][k]))
    for sgn in (-1, 1):
        v, f = lib.cylinder((0, 0, 0), 0.04, 0.04, 0.22, 8)
        v = lib.transform(v, loc=(fx + sgn * 0.2 - 0.11, fy - 0.03 + (0.12 if sgn > 0 else 0.0), 0.04), rot=(0.0, math.pi / 2, 0.35 * sgn))
        B['wood'].add(v, f, col('#7a5234'))


def flower_arch(B, a, b, rnd, h=0.62):
    """Garden arch over a lane: two posts and a hoop smothered in flowers."""
    A, Bw = _w(*a), _w(*b)
    for q in (A, Bw):
        v, f = lib.cylinder((q.x, q.y, 0.0), 0.02, 0.02, h, 6)
        B['paint'].add(v, f, col('#fbfaf6'))
    mid = (A + Bw) / 2
    half = (Bw - A).length / 2
    d = (Bw - A).normalized()
    pts = [tuple(mid + d * (math.cos(t) * half) + Vector((0, 0, h + math.sin(t) * half * 0.8))) for t in np.linspace(math.pi, 0, 14)]
    v, f = lib.tube(pts, 0.015, 5)
    B['paint'].add(v, f, col('#fbfaf6'))
    for k, q in enumerate(pts):
        for _ in range(2):
            v, f = lib.blob((q[0] + rnd.uniform(-0.03, 0.03), q[1] + rnd.uniform(-0.03, 0.03), q[2] + rnd.uniform(-0.02, 0.03)), 0.035, rough=0.2, subdiv=1, seed=rnd.random() * 9)
            B['leaves'].add(v, f, col('#3f8f3a'))
        v, f = lib.blob((q[0], q[1] - 0.02, q[2] + 0.02), 0.026, rough=0.1, subdiv=1)
        B['flowers'].add(v, f, col(['#ff8fb1', '#fff6ea', '#ff6b8a'][k % 3]))


# ------------------------------------------------------------------------------------------
# Townsfolk, critters and small lawn scenes (tiny: a villager is about 0.3 units, 18 px tall)
VILLAGER_COLS = ['#ff6b5e', '#3f9ee0', '#f4b83b', '#8e5cd9', '#1fa5a0', '#ff8fb1', '#6cc24a', '#e8604c', '#fff4dc']
SKIN = ['#f5d0b0', '#e0ac7e', '#c68a5c', '#8d5a3b', '#f2c49a']
HAIR = ['#3a2a22', '#6b4226', '#d9a441', '#1f1a1a', '#a0522d']


def villager(B, bx, by, yaw, rnd, pose='stand', z0=0.0, s=1.0):
    """A tiny townsperson: tunic, head, hat or hair, and arms; `pose` 'stand' or 'sit' (facing yaw,
    radians in the ground plane; 0 = towards +x)."""
    p = _w(bx, by)
    x, y = p.x, p.y
    body = col(rnd.choice(VILLAGER_COLS))
    skin = col(rnd.choice(SKIN))
    fx, fy = math.cos(yaw), math.sin(yaw)
    if pose == 'sit':
        base = z0 + 0.01 * s
        # thighs forward and shins down
        v, f = lib.box((x + fx * 0.04 * s, y + fy * 0.04 * s, base + 0.02 * s), (0.08 * s, 0.07 * s, 0.035 * s), rot_z=yaw)
        B['cloth'].add(v, f, col('#4a5a7a'))
        hip = base + 0.02 * s
    else:
        for sgn in (-1, 1):
            lx, ly = x - fy * 0.018 * s * sgn, y + fx * 0.018 * s * sgn
            v, f = lib.cylinder((lx, ly, z0), 0.014 * s, 0.014 * s, 0.07 * s, 6)
            B['cloth'].add(v, f, col('#4a5a7a'))
        hip = z0 + 0.065 * s
    v, f = lib.lathe([(0.042 * s, 0.0), (0.048 * s, 0.03 * s), (0.04 * s, 0.09 * s), (0.028 * s, 0.13 * s), (0.0, 0.14 * s)], 10, (x, y, hip))
    B['cloth'].add(v, f, body)
    top = hip + 0.14 * s
    for sgn in (-1, 1):
        sx, sy = x - fy * 0.038 * s * sgn, y + fx * 0.038 * s * sgn
        hand = (sx + fx * 0.05 * s, sy + fy * 0.05 * s, top - 0.07 * s)
        v, f = lib.tube([(sx, sy, top - 0.02 * s), hand], 0.011 * s, 5)
        B['cloth'].add(v, f, body)
    hz = top + 0.035 * s
    v, f = lib.blob((x, y, hz), 0.036 * s, rough=0.0, subdiv=2)
    B['paint'].add(v, f, skin)
    k = rnd.random()
    if k < 0.4:  # straw hat
        v, f = lib.lathe([(0.064 * s, 0.0), (0.03 * s, 0.008 * s), (0.028 * s, 0.03 * s), (0.0, 0.034 * s)], 12, (x, y, hz + 0.018 * s))
        B['paint'].add(v, f, col(rnd.choice(['#e8c070', '#d8a848', '#f0d890'])))
    elif k < 0.65:  # a bright cap
        v, f = lib.blob((x, y, hz + 0.02 * s), 0.034 * s, squash=(1, 1, 0.6), rough=0.0, subdiv=1)
        B['paint'].add(v, f, col(rnd.choice(VILLAGER_COLS)))
    else:  # hair
        v, f = lib.blob((x - fx * 0.008 * s, y - fy * 0.008 * s, hz + 0.012 * s), 0.037 * s, squash=(1, 1, 0.85), rough=0.1, subdiv=1)
        B['paint'].add(v, f, col(rnd.choice(HAIR)))
    return (x + fx * 0.05 * s, y + fy * 0.05 * s, top - 0.07 * s)  # a hand, for things held


def sheep(B, bx, by, yaw, rnd, s=1.0):
    """A fluffy sheep grazing: woolly body, dark face and legs."""
    p = _w(bx, by)
    x, y = p.x, p.y
    fx, fy = math.cos(yaw), math.sin(yaw)
    for (u, w) in [(0.045, 0.03), (0.045, -0.03), (-0.045, 0.03), (-0.045, -0.03)]:
        lx, ly = x + fx * u * s - fy * w * s, y + fy * u * s + fx * w * s
        v, f = lib.cylinder((lx, ly, 0.0), 0.009 * s, 0.009 * s, 0.05 * s, 5)
        B['paint'].add(v, f, col('#3a3434'))
    v, f = lib.blob((0, 0, 0), 0.075 * s, squash=(1.35, 0.95, 0.85), rough=0.28, freq=3.2, subdiv=2, seed=rnd.random() * 40)
    B['cloth'].add(lib.transform(v, loc=(x, y, 0.1 * s), rot=(0.0, 0.0, yaw)), f, col(rnd.choice(['#f8f5ee', '#f1ece0', '#fbf8f2'])))
    hx, hy = x + fx * 0.1 * s, y + fy * 0.1 * s
    v, f = lib.blob((hx, hy, 0.085 * s), 0.03 * s, squash=(1.3, 0.85, 0.9), rough=0.0, subdiv=1)
    B['paint'].add(lib.transform([(vx - hx, vy - hy, vz) for (vx, vy, vz) in v], loc=(hx, hy, 0.0), rot=(0.0, 0.25, yaw)), f, col('#3a3434'))


def lamp_post(B, bx, by, rnd, h=0.95):
    """A festival lamp post: a wooden post with an iron arm and a warm glowing lantern."""
    p = _w(bx, by)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.024, 0.02, h, 8)
    B['wood'].add(v, f, col('#4a3a34'))
    v, f = lib.box((p.x + 0.06, p.y, h - 0.03), (0.13, 0.02, 0.02))
    B['metal'].add(v, f, col('#3a3a44'))
    v, f = lib.lathe([(0.0, 0.0), (0.04, 0.02), (0.045, 0.08), (0.03, 0.12), (0.0, 0.13)], 8, (p.x + 0.12, p.y, h - 0.2))
    B['glow'].add(v, f, col(rnd.choice(['#ffd27a', '#ffb347', '#ffe29a'])))
    v, f = lib.lathe([(0.055, 0.0), (0.0, 0.04)], 8, (p.x + 0.12, p.y, h - 0.07), cap_bottom=True, cap_top=False)
    B['metal'].add(v, f, col('#3a2e2a'))


def fishing_rod(B, hand, toward, reach=0.5):
    """A rod held out over the water and a line dropping to a float (`toward`: unit vector in the
    ground plane)."""
    hx, hy, hz = hand
    tip = (hx + toward[0] * reach, hy + toward[1] * reach, hz + reach * 0.45)
    v, f = lib.tube([hand, tip], 0.006, 4)
    B['wood'].add(v, f, col('#6e4a2c'))
    v, f = lib.tube([tip, (tip[0] + toward[0] * 0.03, tip[1] + toward[1] * 0.03, 0.03)], 0.0022, 3)
    B['paint'].add(v, f, col('#f4f0e6'))
    v, f = lib.blob((tip[0] + toward[0] * 0.03, tip[1] + toward[1] * 0.03, 0.035), 0.012, rough=0.0, subdiv=1)
    B['paint'].add(v, f, col('#ff5a4a'))


def stool(B, bx, by, s=1.0):
    p = _w(bx, by)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.035 * s, 0.03 * s, 0.07 * s, 8)
    B['wood'].add(v, f, col('#8a5e3a'))
    return 0.07 * s
