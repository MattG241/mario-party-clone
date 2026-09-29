"""Shared city pieces for the night boards: crossings (decks, catwalks, web lines, rail viaducts),
landing platforms, rooftop and street scatter, street lamps, neon signs and string lights.

Every builder takes board-pixel positions and adds geometry to a kit.Parts (per-material builders),
so a whole layer merges into a handful of objects. Colours are sRGB hex.
"""
from __future__ import annotations

import math
import random

from kit import Parts, depth_units, emission_off, facing, point_light, rounded_rect, screen_z, text_mesh  # noqa: F401
import lib
from lib import COSB, PX, Vector, board_to_world, col


def W(bx, by, z=0.0):
    return board_to_world(bx, by, z)


# ------------------------------------------------------------------------------------------
# Crossings
DECK_STYLES = {
    'foot': dict(deck='#8d8f9c', rail='#c9ced8', girder='#5a5d6a', lamp='#ffd9a0', glass=True),
    'iron': dict(deck='#7a7384', rail='#3e3a46', girder='#4a4652', lamp='#ffc27a'),
    'girder': dict(deck='#7e7f8c', rail='#b8434a', girder='#b8434a', lamp='#fff0c8', truss=True),
    'web': dict(deck='#9a7a5a', rail='#f4f6ff', girder='#6b5a4a', lamp='#cfe6ff', web=True),
    'rail': dict(deck='#d6d0c6', rail='#8f96a3', girder='#a09a90', lamp='#9fe8ff', rails=True),
    'neon': dict(deck='#6d5a78', rail='#f4d7ff', girder='#4a3b56', lamp='#ff7ad9', bulbs=True),
    'carpet': dict(deck='#c8243e', rail='#f2c14e', girder='#3b2233', lamp='#fff1b8', carpet=True),
    'boards': dict(deck='#dfe7ee', rail='#f7fbff', girder='#9aa8b8', lamp='#cfe6ff', boards=True),
}


def deck(P: Parts, a, b, t0, t1, style='foot', hw=0.6, rnd=None, lights=True):
    """A flat deck from board point a to b (parameter range t0..t1), top at z = 0.02, with railings
    and a style's underside (girders, trusses, rails, web strands)."""
    S = DECK_STYLES[style]
    rnd = rnd or random.Random(int(a[0] * 3 + b[1] * 7))
    A = W(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0)
    B = W(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)
    d = B - A
    L = d.length
    if L < 0.05:
        return
    u = d.normalized()
    n = Vector((-u.y, u.x, 0.0))
    ztop = 0.02
    th = 0.14
    corners = [A - n * hw, B - n * hw, B + n * hw, A + n * hw]
    verts = [(c.x, c.y, ztop) for c in corners] + [(c.x, c.y, ztop - th) for c in corners]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    P['matte'].add(verts, faces, col(S['deck']))
    # plank / grating lines across the deck
    steps = max(2, int(L / 0.22))
    for k in range(1, steps):
        c = A + u * (L * k / steps)
        v, f = lib.box((c.x, c.y, ztop + 0.004), (0.02, hw * 1.9, 0.008), rot_z=math.atan2(u.y, u.x))
        P['matte'].add(v, f, col('#5d5a66') if style != 'carpet' else col('#9c1a30'))
    if S.get('carpet'):
        # gold edging along the red carpet
        for side in (-1, 1):
            c0 = A + n * side * (hw - 0.05)
            c1 = B + n * side * (hw - 0.05)
            v, f = lib.tube([(c0.x, c0.y, ztop + 0.01), (c1.x, c1.y, ztop + 0.01)], 0.025, 5)
            P['metal'].add(v, f, col('#f2c14e'))
    # railings
    rail_h = 0.3
    for side in (-1, 1):
        base0 = A + n * side * (hw - 0.03)
        base1 = B + n * side * (hw - 0.03)
        posts = max(2, int(L / 0.45))
        for k in range(posts + 1):
            c = base0 + (base1 - base0) * (k / posts)
            if S.get('carpet'):
                # brass stanchions with a velvet rope between them
                v, f = lib.cylinder((c.x, c.y, ztop), 0.03, 0.025, 0.32, 8)
                P['metal'].add(v, f, col('#f2c14e'))
                v, f = lib.blob((c.x, c.y, ztop + 0.34), 0.045, rough=0.0, subdiv=1)
                P['metal'].add(v, f, col('#f2c14e'))
                continue
            v, f = lib.cylinder((c.x, c.y, ztop), 0.018, 0.018, rail_h, 6)
            P['metal'].add(v, f, col(S['rail']))
            if S.get('bulbs') and k % 1 == 0:
                v, f = lib.blob((c.x, c.y, ztop + rail_h + 0.035), 0.04, rough=0.0, subdiv=1)
                P['neon'].add(v, f, col(rnd.choice(['#fff1b8', '#ffd07a', '#ff9ad2'])))
        if S.get('carpet'):
            pts = []
            for k in range(posts * 6 + 1):
                t = k / (posts * 6)
                c = base0 + (base1 - base0) * t
                sag = 0.07 * abs(math.sin(t * posts * math.pi))
                pts.append((c.x, c.y, ztop + 0.3 - sag))
            v, f = lib.tube(pts, 0.018, 5)
            P['paint'].add(v, f, col('#7a1030'))
            continue
        if S.get('web'):
            # web strands instead of a rail: a sagging main line with ties to the deck
            pts = []
            for k in range(13):
                t = k / 12
                c = base0 + (base1 - base0) * t
                pts.append((c.x, c.y, ztop + 0.34 - 0.1 * math.sin(t * math.pi)))
            v, f = lib.tube(pts, 0.014, 5)
            P['softglow'].add(v, f, col('#eef2ff'))
            for k in range(1, 12, 2):
                p0 = Vector(pts[k])
                v, f = lib.tube([tuple(p0), (p0.x - n.x * side * 0.12, p0.y - n.y * side * 0.12, ztop)], 0.008, 4)
                P['softglow'].add(v, f, col('#e6ebff'))
            continue
        v, f = lib.tube([(base0.x, base0.y, ztop + rail_h), (base1.x, base1.y, ztop + rail_h)], 0.022, 6)
        P['metal'].add(v, f, col(S['rail']))
        v, f = lib.tube([(base0.x, base0.y, ztop + rail_h * 0.5), (base1.x, base1.y, ztop + rail_h * 0.5)], 0.012, 5)
        P['metal'].add(v, f, col(S['rail']))
        if S.get('glass'):
            q = [(base0.x, base0.y, ztop + 0.03), (base1.x, base1.y, ztop + 0.03), (base1.x, base1.y, ztop + rail_h - 0.03), (base0.x, base0.y, ztop + rail_h - 0.03)]
            P['glass'].add(q, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#9fc4e6'))
    # underside
    if S.get('truss'):
        for side in (-1, 1):
            b0 = A + n * side * hw
            b1 = B + n * side * hw
            k_n = max(2, int(L / 0.6))
            top = [b0 + (b1 - b0) * (k / k_n) for k in range(k_n + 1)]
            for k in range(k_n):
                p0, p1 = top[k], top[k + 1]
                mid = (p0 + p1) / 2
                lo = (mid.x, mid.y, ztop - 0.75)
                v, f = lib.tube([(p0.x, p0.y, ztop - th), lo, (p1.x, p1.y, ztop - th)], 0.03, 5)
                P['metal'].add(v, f, col(S['girder']))
            v, f = lib.tube([(b0.x, b0.y, ztop - 0.75), (b1.x, b1.y, ztop - 0.75)], 0.035, 6)
            P['metal'].add(v, f, col(S['girder']))
            # an overhead arch of the truss above the railing
            pts = []
            for k in range(17):
                t = k / 16
                c = b0 + (b1 - b0) * t
                pts.append((c.x, c.y, ztop + 0.36 + 0.45 * math.sin(t * math.pi)))
            v, f = lib.tube(pts, 0.035, 6)
            P['metal'].add(v, f, col(S['girder']))
            for k in range(1, 16, 2):
                c = Vector(pts[k])
                v, f = lib.tube([(c.x, c.y, ztop + rail_h), tuple(c)], 0.014, 4)
                P['metal'].add(v, f, col(S['girder']))
    elif S.get('rails'):
        # a concrete viaduct beam and two rails along the deck's far side
        v, f = lib.box(((A.x + B.x) / 2, (A.y + B.y) / 2, ztop - th - 0.2), (L, hw * 1.1, 0.4), rot_z=math.atan2(u.y, u.x))
        P['matte'].add(v, f, col(S['girder']))
        for off in (0.18, 0.42):
            c0, c1 = A + n * off, B + n * off
            v, f = lib.tube([(c0.x, c0.y, ztop + 0.02), (c1.x, c1.y, ztop + 0.02)], 0.02, 5)
            P['metal'].add(v, f, col('#d9dde6'))
        # a glowing edge strip on the camera side
        c0, c1 = A - n * (hw - 0.01), B - n * (hw - 0.01)
        v, f = lib.tube([(c0.x, c0.y, ztop - 0.02), (c1.x, c1.y, ztop - 0.02)], 0.018, 5)
        P['neon'].add(v, f, col(S['lamp']))
    else:
        for side in (-1, 1):
            b0 = A + n * side * (hw * 0.7)
            b1 = B + n * side * (hw * 0.7)
            v, f = lib.box(((b0.x + b1.x) / 2, (b0.y + b1.y) / 2, ztop - th - 0.12), (L, 0.08, 0.24), rot_z=math.atan2(u.y, u.x))
            P['metal'].add(v, f, col(S['girder']))
    if S.get('boards'):
        for side in (-1, 1):
            c0, c1 = A + n * side * hw, B + n * side * hw
            v, f = lib.box(((c0.x + c1.x) / 2, (c0.y + c1.y) / 2, ztop + 0.12), (L, 0.05, 0.24), rot_z=math.atan2(u.y, u.x))
            P['paint'].add(v, f, col('#f7fbff'))
    # a little lamp mid-span
    if lights and L > 1.2 and not S.get('carpet'):
        mid = (A + B) / 2 + n * (hw - 0.03)
        v, f = lib.blob((mid.x, mid.y, ztop + rail_h + 0.06), 0.05, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col(S['lamp']))


def landing(P: Parts, bx, by, style='foot', hw_px=86, hh_px=62, pylon=True):
    """A platform under a lone space (between two crossings), on a pylon."""
    S = DECK_STYLES[style]
    c = W(bx, by)
    hw = hw_px / PX
    hh = depth_units(hh_px)
    poly = rounded_rect(c.x, c.y, hw, hh, min(hw, hh) * 0.5, seg=5)
    n = len(poly)
    ztop = 0.02
    verts = [(x, y, ztop) for (x, y) in poly] + [(x, y, ztop - 0.22) for (x, y) in poly]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, n + i, n + j, j))
    P['matte'].add(verts, faces, col(S['deck']) if not S.get('carpet') else col('#3b2233'))
    # trim ring
    ring = [(x, y, ztop + 0.005) for (x, y) in poly] + [poly[0] + (ztop + 0.005,)]
    v, f = lib.tube(ring, 0.025, 5)
    P['metal'].add(v, f, col(S['rail']))
    lp = (c.x + hw * 0.62, c.y + hh * 0.5)
    v, f = lib.cylinder((lp[0], lp[1], ztop), 0.02, 0.018, 0.62, 6)
    P['metal'].add(v, f, col(S['rail']))
    v, f = lib.blob((lp[0], lp[1], ztop + 0.68), 0.05, rough=0.0, subdiv=1)
    P['neon'].add(v, f, col(S['lamp']))
    point_light(lp[0], lp[1] - 0.05, ztop + 0.66, color=S['lamp'], energy=40.0, radius=0.08)
    if pylon:
        if S.get('web'):
            # an old wooden water-tank top: staves round the platform's rim
            for i in range(0, n, 2):
                x, y = poly[i]
                v, f = lib.box((x, y, ztop - 0.6), (0.06, 0.06, 1.2))
                P['wood'].add(v, f, col('#7a5a3e'))
        else:
            v, f = lib.cylinder((c.x, c.y, ztop - 0.22), 0.16, 0.24, -3.2, 10)
            P['matte'].add(v, f, col(S['girder']))
            v, f = lib.cylinder((c.x, c.y, ztop - 0.5), 0.3, 0.16, 0.28, 12)
            P['metal'].add(v, f, col(S['girder']))


# ------------------------------------------------------------------------------------------
# Lamps
def street_lamp(P: Parts, bx, by, rnd, glow='#ffd08a', light=True, energy=55.0, style='classic', h=1.25):
    """A street lamp: iron post and a warm globe (and its point light)."""
    p = W(bx, by)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.06, 0.05, 0.12, 8)
    P['metal'].add(v, f, col('#2e2c36'))
    v, f = lib.cylinder((p.x, p.y, 0.1), 0.028, 0.022, h, 8)
    P['metal'].add(v, f, col('#2e2c36'))
    if style == 'classic':
        v, f = lib.blob((p.x, p.y, h + 0.16), 0.1, rough=0.0, subdiv=2)
        P['neon'].add(v, f, col(glow))
        v, f = lib.lathe([(0.075, 0.0), (0.0, 0.06)], 10, (p.x, p.y, h + 0.26))
        P['metal'].add(v, f, col('#2e2c36'))
        lz = h + 0.16
    elif style == 'hook':
        v, f = lib.tube([(p.x, p.y, h + 0.1), (p.x + 0.12, p.y, h + 0.24), (p.x + 0.28, p.y, h + 0.2)], 0.02, 6)
        P['metal'].add(v, f, col('#2e2c36'))
        v, f = lib.lathe([(0.0, 0.0), (0.09, 0.02), (0.07, 0.08), (0.0, 0.09)], 10, (p.x + 0.28, p.y, h + 0.03))
        P['neon'].add(v, f, col(glow))
        lz = h + 0.05
        p = Vector((p.x + 0.28, p.y, 0))
    else:  # 'double' globes on a crossbar
        v, f = lib.box((p.x, p.y, h + 0.08), (0.36, 0.03, 0.03))
        P['metal'].add(v, f, col('#2e2c36'))
        for dx in (-0.18, 0.18):
            v, f = lib.blob((p.x + dx, p.y, h + 0.18), 0.075, rough=0.0, subdiv=2)
            P['neon'].add(v, f, col(glow))
        lz = h + 0.18
    if light:
        point_light(p.x, p.y - 0.05, lz, color=glow, energy=energy, radius=0.1)


def string_lights(P: Parts, ax, ay, bx, by, rnd, h=1.3, sag=0.3, colors=('#fff1b8', '#ffd07a', '#ff9ad2', '#9fe8ff'), posts=True, n=16):
    """Festoon lights between two posts."""
    a, b = W(ax, ay), W(bx, by)
    if posts:
        for q in (a, b):
            v, f = lib.cylinder((q.x, q.y, 0.0), 0.03, 0.025, h + 0.05, 8)
            P['metal'].add(v, f, col('#2e2c36'))
    pts = []
    for i in range(n * 2 + 1):
        t = i / (n * 2)
        pts.append((a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, h - math.sin(t * math.pi) * sag))
    v, f = lib.tube(pts, 0.008, 4)
    P['metal'].add(v, f, col('#26242c'))
    for i in range(1, n * 2, 2):
        x, y, z = pts[i]
        v, f = lib.blob((x, y, z - 0.035), 0.03, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col(colors[(i // 2) % len(colors)]))


# ------------------------------------------------------------------------------------------
# Neon
NEON = {'pink': '#ff5ab4', 'cyan': '#4de8ff', 'gold': '#ffcf4a', 'lime': '#8dff6a', 'violet': '#b27bff', 'red': '#ff4a4a', 'white': '#fff4e8', 'orange': '#ff9a3c', 'blue': '#5a8cff'}


def neon_text(P: Parts, text, loc, size, color, yaw=0.0, lean=0.0, backing=None, pad=0.12, depth=0.03):
    """Neon letters standing up and facing the camera at world `loc` (baseline centre)."""
    v, f = text_mesh(text, size, extrude=0.01, bevel=0.012)
    # measure
    xs = [p[0] for p in v]
    ys = [p[1] for p in v]
    wdt, hgt = max(xs) - min(xs), max(ys) - min(ys)
    if backing:
        bw, bh = wdt + pad * 2, hgt + pad * 2
        q = [(-bw / 2, -bh / 2, 0.05), (bw / 2, -bh / 2, 0.05), (bw / 2, bh / 2, 0.05), (-bw / 2, bh / 2, 0.05)]
        qb = [(x, y, z + depth) for (x, y, z) in q]
        verts = q + qb
        faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        P['matte'].add(facing(verts, loc, yaw, lean), faces, col(backing))
    P['neon'].add(facing(v, loc, yaw, lean), f, col(color))
    return wdt, hgt


def neon_shape(P: Parts, pts2d, loc, color, r=0.025, yaw=0.0, lean=0.0, closed=True):
    """A neon tube following a 2D outline (in the sign's plane, +y up), standing at `loc`."""
    pts = [(x, y, 0.0) for (x, y) in pts2d]
    if closed:
        pts.append(pts[0])
    w3 = facing(pts, loc, yaw, lean)
    v, f = lib.tube(w3, r, 6)
    P['neon'].add(v, f, col(color))


def star_pts(R, r, n=5, rot=math.pi / 2):
    out = []
    for k in range(n * 2):
        a = rot + k * math.pi / n
        rr = R if k % 2 == 0 else r
        out.append((math.cos(a) * rr, math.sin(a) * rr))
    return out


def heart_pts(s, n=28):
    out = []
    for k in range(n):
        t = k / n * math.tau
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        out.append((x * s / 16, y * s / 16))
    return out


def bolt_pts(s):
    return [(x * s, y * s) for (x, y) in [(-0.2, 1.0), (0.35, 1.0), (0.05, 0.25), (0.4, 0.25), (-0.3, -1.0), (-0.05, -0.1), (-0.4, -0.1)]]


def note_pts(s):
    return [(x * s, y * s) for (x, y) in [(-0.3, -0.7), (-0.05, -0.62), (0.0, -0.4), (0.0, 0.9), (0.45, 0.6), (0.45, 0.35), (0.1, 0.55), (0.1, -0.55), (-0.1, -0.85), (-0.4, -0.9)]]


def arrow_pts(s):
    return [(x * s, y * s) for (x, y) in [(-1.0, -0.22), (0.3, -0.22), (0.3, -0.55), (1.0, 0.0), (0.3, 0.55), (0.3, 0.22), (-1.0, 0.22)]]


def moon_pts(s, n=20):
    out = []
    for k in range(n + 1):
        a = -math.pi * 0.8 + k / n * math.pi * 1.6
        out.append((math.cos(a) * s, math.sin(a) * s))
    for k in range(n + 1):
        a = math.pi * 0.62 - k / n * math.pi * 1.24
        out.append((0.35 * s + math.cos(a) * s * 0.78, math.sin(a) * s * 0.78))
    return out


def sign_board(P: Parts, bx, by, z0, w, h, backing='#231f2e', frame='#3a3448', rnd=None):
    """A rooftop sign frame (two legs and a dark board) facing the camera; returns the board's
    centre (world) for the neon to go on."""
    p = W(bx, by)
    for dx in (-w * 0.35, w * 0.35):
        v, f = lib.box((p.x + dx, p.y + 0.02, z0 / 2 + 0.01), (0.05, 0.05, z0 + 0.02))
        P['metal'].add(v, f, col(frame))
    q = [(-w / 2, -h / 2, 0.0), (w / 2, -h / 2, 0.0), (w / 2, h / 2, 0.0), (-w / 2, h / 2, 0.0)]
    qb = [(x, y, 0.06) for (x, y, _) in q]
    loc = (p.x, p.y + 0.04, z0 + h / 2)
    P['matte'].add(facing(q + qb, loc), [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], col(backing))
    return (p.x, p.y + 0.02, z0 + h / 2)


# ------------------------------------------------------------------------------------------
# Rooftop scatter
def hvac(P: Parts, bx, by, rnd, s=1.0):
    p = W(bx, by)
    w, d, h = rnd.uniform(0.34, 0.5) * s, rnd.uniform(0.28, 0.4) * s, rnd.uniform(0.2, 0.3) * s
    rz = rnd.choice([0.0, math.pi / 2]) + rnd.uniform(-0.05, 0.05)
    v, f = lib.box((p.x, p.y, h / 2), (w, d, h), rot_z=rz)
    P['paint'].add(v, f, col(rnd.choice(['#9aa1ad', '#8c929e', '#a8adb6', '#7f8793'])))
    v, f = lib.cylinder((p.x, p.y, h), d * 0.36, d * 0.36, 0.02, 16)
    P['metal'].add(v, f, col('#3b3f48'))
    for k in range(3):
        a = k / 3 * math.pi + rnd.random()
        v, f = lib.box((p.x, p.y, h + 0.025), (d * 0.66, 0.02, 0.01), rot_z=a)
        P['metal'].add(v, f, col('#6b707a'))


def vent(P: Parts, bx, by, rnd):
    p = W(bx, by)
    h = rnd.uniform(0.18, 0.32)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.05, 0.05, h, 10)
    P['metal'].add(v, f, col('#9aa0aa'))
    v, f = lib.lathe([(0.1, 0.0), (0.02, 0.07)], 10, (p.x, p.y, h))
    P['metal'].add(v, f, col('#aeb4bd'))


def skylight(P: Parts, bx, by, rnd, glow='#ffd9a0'):
    p = W(bx, by)
    w, d = rnd.uniform(0.3, 0.46), rnd.uniform(0.24, 0.34)
    v, f = lib.box((p.x, p.y, 0.05), (w + 0.06, d + 0.06, 0.1))
    P['paint'].add(v, f, col('#c9ccd4'))
    v = [(p.x - w / 2, p.y - d / 2, 0.1), (p.x + w / 2, p.y - d / 2, 0.1), (p.x + w / 2, p.y + d / 2, 0.1), (p.x - w / 2, p.y + d / 2, 0.1),
         (p.x - w / 4, p.y, 0.24), (p.x + w / 4, p.y, 0.24)]
    f = [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4)]
    P['glow'].add(v, f, col(glow))


def antenna(P: Parts, bx, by, rnd, h=None):
    p = W(bx, by)
    h = h or rnd.uniform(0.9, 1.5)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.02, 0.012, h, 6)
    P['metal'].add(v, f, col('#b5bac4'))
    for zz in (h * 0.55, h * 0.75):
        v, f = lib.box((p.x, p.y, zz), (0.26, 0.012, 0.012))
        P['metal'].add(v, f, col('#b5bac4'))
    v, f = lib.blob((p.x, p.y, h + 0.02), 0.035, rough=0.0, subdiv=1)
    P['neon'].add(v, f, col('#ff3a3a'))


def dish(P: Parts, bx, by, rnd):
    p = W(bx, by)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.025, 0.025, 0.22, 6)
    P['metal'].add(v, f, col('#8d929c'))
    v, f = lib.lathe([(0.0, 0.0), (0.12, 0.03), (0.2, 0.09)], 14)
    v = lib.transform(v, (p.x, p.y - 0.04, 0.26), rot=(math.radians(60) + rnd.uniform(-0.2, 0.2), 0.0, rnd.uniform(-0.6, 0.6)))
    P['paint'].add(v, f, col('#e3e6ec'))


def water_tank(P: Parts, bx, by, rnd, s=1.0):
    """A small rooftop water tank on legs."""
    p = W(bx, by)
    for (dx, dy) in ((-0.14, -0.14), (0.14, -0.14), (0.14, 0.14), (-0.14, 0.14)):
        v, f = lib.cylinder((p.x + dx * s, p.y + dy * s, 0.0), 0.02 * s, 0.02 * s, 0.34 * s, 6)
        P['metal'].add(v, f, col('#4a4650'))
    v, f = lib.lathe([(0.22 * s, 0.0), (0.22 * s, 0.34 * s), (0.18 * s, 0.4 * s), (0.0, 0.46 * s)], 14, (p.x, p.y, 0.34 * s))
    P['wood'].add(v, f, col(rnd.choice(['#8a6a4e', '#7d5e44', '#94735a'])))
    for zz in (0.42, 0.56):
        v, f = lib.lathe([(0.225 * s, 0.0), (0.225 * s, 0.02 * s)], 14, (p.x, p.y, zz * s), cap_bottom=False, cap_top=False)
        P['metal'].add(v, f, col('#3a3640'))


def chimney(P: Parts, bx, by, rnd):
    p = W(bx, by)
    h = rnd.uniform(0.3, 0.55)
    v, f = lib.box((p.x, p.y, h / 2), (0.16, 0.14, h))
    P['stone'].add(v, f, col(rnd.choice(['#8d4a3c', '#7a4238', '#9a6a52'])))
    v, f = lib.box((p.x, p.y, h + 0.02), (0.2, 0.18, 0.04))
    P['stone'].add(v, f, col('#bfb2a6'))


def crate_stack(P: Parts, bx, by, rnd):
    p = W(bx, by)
    for k in range(rnd.randint(1, 3)):
        s = rnd.uniform(0.13, 0.18)
        v, f = lib.box((p.x + rnd.uniform(-0.08, 0.08), p.y + rnd.uniform(-0.05, 0.05), s / 2 + k * s * 0.95), (s, s, s), rot_z=rnd.uniform(-0.3, 0.3))
        P['wood'].add(v, f, col(rnd.choice(['#b07a45', '#9a6a3c', '#c08850'])))


def bench(P: Parts, bx, by, rnd, rz=0.0, color='#7a5234'):
    p = W(bx, by)
    v, f = lib.box((p.x, p.y, 0.1), (0.42, 0.13, 0.03), rot_z=rz)
    P['wood'].add(v, f, col(color))
    v, f = lib.box((p.x - math.sin(rz) * 0.0, p.y + 0.06, 0.2), (0.42, 0.025, 0.1), rot_z=rz)
    P['wood'].add(v, f, col(color))
    for dx in (-0.17, 0.17):
        v, f = lib.box((p.x + dx * math.cos(rz), p.y + dx * math.sin(rz), 0.05), (0.03, 0.12, 0.1), rot_z=rz)
        P['metal'].add(v, f, col('#2e2c36'))


def planter(P: Parts, bx, by, rnd, s=1.0, flowers=True):
    p = W(bx, by)
    w, d = rnd.uniform(0.32, 0.5) * s, rnd.uniform(0.18, 0.26) * s
    v, f = lib.box((p.x, p.y, 0.08 * s), (w, d, 0.16 * s))
    P['wood'].add(v, f, col(rnd.choice(['#7a5234', '#8a6040', '#6e4a2c'])))
    for k in range(rnd.randint(3, 5)):
        ox = rnd.uniform(-w / 2 + 0.06, w / 2 - 0.06)
        r = rnd.uniform(0.07, 0.11) * s
        v, f = lib.blob((p.x + ox, p.y + rnd.uniform(-0.04, 0.04), 0.16 * s + r * 0.7), r, rough=0.25, freq=2.4, seed=rnd.random() * 40)
        P['leaf'].add(v, f, col(rnd.choice(['#2f8a3a', '#3f9d42', '#246e38', '#4aa84a'])))
        if flowers and rnd.random() < 0.6:
            v, f = lib.blob((p.x + ox, p.y - 0.03, 0.16 * s + r * 1.4), 0.03, rough=0.0, subdiv=1)
            P['paint'].add(v, f, col(rnd.choice(['#ff8fb1', '#ffe066', '#ffffff', '#c9a3ff', '#ff6b6b'])))


def potted_tree(P: Parts, bx, by, rnd, s=1.0, palette=('#1d5e34', '#58b34a')):
    p = W(bx, by)
    v, f = lib.lathe([(0.12 * s, 0.0), (0.15 * s, 0.2 * s), (0.0, 0.2 * s)], 12, (p.x, p.y, 0.0))
    P['paint'].add(v, f, col(rnd.choice(['#b45c3c', '#c9c2b8', '#3e4a5c'])))
    v, f = lib.cylinder((p.x, p.y, 0.18 * s), 0.025 * s, 0.02 * s, 0.5 * s, 6)
    P['wood'].add(v, f, col('#5e3b22'))
    lo, hi = col(palette[0]), col(palette[1])
    for k in range(4):
        a = k / 4 * math.tau + rnd.random()
        r = rnd.uniform(0.14, 0.2) * s
        c = (p.x + math.cos(a) * 0.1 * s, p.y + math.sin(a) * 0.08 * s, 0.72 * s + rnd.uniform(-0.05, 0.08) * s)
        v, f = lib.blob(c, r, rough=0.2, freq=2.0, seed=rnd.random() * 30)
        P['leaf'].add(v, f, lambda vv, zc=c[2], r=r: lib.lerp_col(lo, hi, max(0.0, min(1.0, (vv[2] - zc) / (r * 1.1) + 0.5))))


def laundry(P: Parts, ax, ay, bx, by, rnd):
    a, b = W(ax, ay), W(bx, by)
    for q in (a, b):
        v, f = lib.cylinder((q.x, q.y, 0.0), 0.02, 0.02, 0.62, 6)
        P['metal'].add(v, f, col('#4a4650'))
    n = 7
    for k in range(1, n):
        t = k / n
        x, y = a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t
        z = 0.6 - math.sin(t * math.pi) * 0.06
        w_ = rnd.uniform(0.1, 0.16)
        h_ = rnd.uniform(0.12, 0.22)
        q = [(x - w_ / 2, y, z), (x + w_ / 2, y, z), (x + w_ / 2, y, z - h_), (x - w_ / 2, y, z - h_)]
        P['paint'].add(q, [(0, 1, 2, 3), (3, 2, 1, 0)], col(rnd.choice(['#e84a4a', '#3a6fe0', '#ffffff', '#f2c14e', '#6cc24a', '#ff8fb1'])))
    v, f = lib.tube([(a.x, a.y, 0.6), ((a.x + b.x) / 2, (a.y + b.y) / 2, 0.54), (b.x, b.y, 0.6)], 0.006, 4)
    P['metal'].add(v, f, col('#dcdcdc'))


def solar_panel(P: Parts, bx, by, rnd):
    p = W(bx, by)
    v, f = lib.box((0, 0, 0), (0.42, 0.26, 0.02))
    v = lib.transform(v, (p.x, p.y, 0.16), rot=(math.radians(-25), 0.0, 0.0))
    P['glass'].add(v, f, col('#1f3b6e'))
    v, f = lib.box((p.x, p.y + 0.05, 0.08), (0.36, 0.03, 0.16))
    P['metal'].add(v, f, col('#8d929c'))


def bulkhead(P: Parts, bx, by, rnd, color='#8f8a92', lamp='#ffd08a'):
    """A stair bulkhead: a little roof hut with a door and a lamp over it."""
    p = W(bx, by)
    w, d, h = 0.5, 0.42, 0.5
    v, f = lib.box((p.x, p.y, h / 2), (w, d, h))
    P['paint'].add(v, f, col(color))
    v, f = lib.box((p.x, p.y, h + 0.02), (w + 0.06, d + 0.06, 0.04))
    P['paint'].add(v, f, col('#6d6873'))
    v, f = lib.box((p.x, p.y - d / 2 - 0.005, 0.18), (0.18, 0.01, 0.34))
    P['paint'].add(v, f, col('#4a5a7a'))
    v, f = lib.blob((p.x, p.y - d / 2 - 0.03, 0.42), 0.035, rough=0.0, subdiv=1)
    P['neon'].add(v, f, col(lamp))


def greenhouse(P: Parts, bx, by, rnd, glow='#ffe0a8'):
    p = W(bx, by)
    w, d, h = 0.7, 0.46, 0.34
    v, f = lib.box((p.x, p.y, h / 2), (w, d, h))
    P['glow'].add(v, f, col('#8fb89a'))
    v = [(p.x - w / 2, p.y - d / 2, h), (p.x + w / 2, p.y - d / 2, h), (p.x + w / 2, p.y + d / 2, h), (p.x - w / 2, p.y + d / 2, h), (p.x - w / 2, p.y, h + 0.2), (p.x + w / 2, p.y, h + 0.2)]
    f = [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4)]
    P['glass'].add(v, f, col('#bfe6d0'))
    for k in range(5):
        x = p.x - w / 2 + w * k / 4
        v, f = lib.tube([(x, p.y - d / 2, 0.0), (x, p.y - d / 2, h), (x, p.y, h + 0.2), (x, p.y + d / 2, h)], 0.012, 4)
        P['metal'].add(v, f, col('#f0f0f0'))
    _ = glow


def gargoyle(P: Parts, bx, by, z, rnd, face=1.0, s=1.0):
    """A small, friendly stone gargoyle crouched on a ledge (wings folded)."""
    p = W(bx, by)
    stone = col('#8e8894')
    v, f = lib.blob((p.x, p.y, z + 0.1 * s), 0.1 * s, squash=(0.9, 1.0, 1.1), rough=0.1, subdiv=2)
    P['stone'].add(v, f, stone)
    v, f = lib.blob((p.x + 0.02 * face * s, p.y - 0.07 * s, z + 0.23 * s), 0.07 * s, rough=0.1, subdiv=2)
    P['stone'].add(v, f, stone)
    for side in (-1, 1):
        v, f = lib.prism((p.x + side * 0.05 * s, p.y - 0.06 * s, z + 0.28 * s), 0.02 * s, 0.07 * s, sides=4, tip=0.9, tilt=(0.2, side * 0.3))
        P['stone'].add(v, f, stone)
        wing = [(p.x + side * 0.06 * s, p.y + 0.02 * s, z + 0.18 * s), (p.x + side * 0.2 * s, p.y + 0.05 * s, z + 0.3 * s),
                (p.x + side * 0.16 * s, p.y + 0.06 * s, z + 0.08 * s)]
        P['stone'].add(wing, [(0, 1, 2), (2, 1, 0)], col('#7a7480'))
    for side in (-1, 1):
        v, f = lib.blob((p.x + side * 0.035 * s, p.y - 0.13 * s, z + 0.245 * s), 0.012 * s, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col('#ffcf4a'))


def vending(P: Parts, bx, by, rnd, glow='#9fe8ff'):
    p = W(bx, by)
    v, f = lib.box((p.x, p.y, 0.3), (0.3, 0.22, 0.6))
    P['paint'].add(v, f, col(rnd.choice(['#d8343f', '#2f6fd8', '#e8e8f0'])))
    v, f = lib.box((p.x - 0.03, p.y - 0.112, 0.36), (0.18, 0.01, 0.34))
    P['glow'].add(v, f, col(glow))


def pylon_lights(P: Parts, bx, by, rnd, glow='#9fe8ff'):
    p = W(bx, by)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.05, 0.04, 0.22, 10)
    P['metal'].add(v, f, col('#dfe6ee'))
    v, f = lib.cylinder((p.x, p.y, 0.16), 0.042, 0.042, 0.05, 10)
    P['neon'].add(v, f, col(glow))


def bush_round(P: Parts, bx, by, rnd, s=1.0):
    p = W(bx, by)
    lo, hi = col('#1f5a36'), col('#6cc24a')
    for _ in range(rnd.randint(3, 5)):
        ox, oy = rnd.uniform(-0.16, 0.16) * s, rnd.uniform(-0.1, 0.1) * s
        r = rnd.uniform(0.1, 0.17) * s
        c = (p.x + ox, p.y + oy, r * 0.8)
        v, f = lib.blob(c, r, rough=0.22, freq=2.4, seed=rnd.random() * 30)
        P['leaf'].add(v, f, lambda vv, zc=c[2], r=r: lib.lerp_col(lo, hi, max(0.0, min(1.0, (vv[2] - zc) / (r * 1.1) + 0.5))))


def tree_city(P: Parts, bx, by, rnd, s=1.0, palette=('#1b5a32', '#5fb84a')):
    """A round street tree with a tree grate."""
    p = W(bx, by)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.16 * s, 0.16 * s, 0.03, 12)
    P['metal'].add(v, f, col('#2e2c36'))
    h = rnd.uniform(0.9, 1.2) * s
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.05 * s, 0.035 * s, h * 0.7, 8)
    P['wood'].add(v, f, col('#5e3b22'))
    lo, hi = col(palette[0]), col(palette[1])
    for k in range(5):
        a = k / 5 * math.tau + rnd.random()
        rr = rnd.uniform(0.24, 0.32) * s if k else 0.34 * s
        c = (p.x + (math.cos(a) * 0.18 * s if k else 0), p.y + (math.sin(a) * 0.14 * s if k else 0), h * 0.8 + rnd.uniform(-0.05, 0.12) * s)
        v, f = lib.blob(c, rr, rough=0.18, freq=1.9, subdiv=2, seed=rnd.random() * 50)
        P['leaf'].add(v, f, lambda vv, zc=c[2], r=rr: lib.lerp_col(lo, hi, max(0.0, min(1.0, (vv[2] - zc) / (r * 1.1) + 0.5)) ** 1.4))


def palm(P: Parts, bx, by, rnd, s=1.0, glow=None):
    """A palm tree (trunk rings optionally strung with neon)."""
    p = W(bx, by)
    h = rnd.uniform(1.5, 1.9) * s
    lean = rnd.uniform(-0.15, 0.15)
    pts = [(p.x + lean * (t ** 1.5) * h, p.y, t * h) for t in [i / 8 for i in range(9)]]
    v, f = lib.tube(pts, lambda t: (0.06 - 0.02 * t) * s, 8)
    P['wood'].add(v, f, col('#8a6a4a'))
    top = Vector(pts[-1])
    if glow:
        for k in range(2, 8):
            x, y, z = pts[k]
            v, f = lib.lathe([(0.062 * s - 0.002 * k, 0.0), (0.062 * s - 0.002 * k, 0.012)], 10, (x, y, z), cap_bottom=False, cap_top=False)
            P['neon'].add(v, f, col(glow))
    for k in range(7):
        a = k / 7 * math.tau + rnd.random() * 0.3
        L = rnd.uniform(0.55, 0.7) * s
        pts2 = []
        for i in range(7):
            t = i / 6
            pts2.append((top.x + math.cos(a) * L * t, top.y + math.sin(a) * L * t * 0.8, top.z + 0.1 * s * math.sin(t * math.pi) - 0.28 * s * t * t))
        v, f = lib.tube(pts2, lambda t: 0.07 * s * math.sin(t * math.pi) + 0.01 * s, 5)
        P['leaf'].add(v, f, col(rnd.choice(['#2f8a3a', '#3f9d42', '#2a7a4a'])))


def car50s(P: Parts, bx, by, rnd, color='#ff8fb1', rz=0.0, s=1.0):
    """A cartoon 1950s car with little tail fins (generic, no badges)."""
    p = W(bx, by)
    body = col(color)
    L, Wd = 0.74 * s, 0.34 * s
    prof = [(-L / 2, 0.06), (-L / 2, 0.16), (-L / 2 + 0.06, 0.2), (-0.14, 0.21), (-0.08, 0.32), (0.14, 0.32), (0.2, 0.21), (L / 2 - 0.04, 0.19), (L / 2, 0.12), (L / 2, 0.06)]
    verts, faces = [], []
    n = len(prof)
    for side in (-1, 1):
        for (x, z) in prof:
            verts.append((x, side * Wd / 2, z * s))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(range(n, 2 * n)))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    ca, sa = math.cos(rz), math.sin(rz)
    verts = [(p.x + x * ca - y * sa, p.y + x * sa + y * ca, z) for (x, y, z) in verts]
    P['paint'].add(verts, faces, body)
    # windows
    for side in (-1, 1):
        q = [(-0.1, side * (Wd / 2 + 0.003), 0.23), (0.12, side * (Wd / 2 + 0.003), 0.23), (0.1, side * (Wd / 2 + 0.003), 0.3), (-0.06, side * (Wd / 2 + 0.003), 0.3)]
        q = [(p.x + x * ca - y * sa, p.y + x * sa + y * ca, z * s) for (x, y, z) in q]
        P['glass'].add(q, [(0, 1, 2, 3), (3, 2, 1, 0)], col('#9fc4e6'))
    for (x, y) in ((-0.22, -Wd / 2), (0.22, -Wd / 2), (-0.22, Wd / 2), (0.22, Wd / 2)):
        wx, wy = p.x + x * s * ca - y * sa, p.y + x * s * sa + y * ca
        v, f = lib.cylinder((0, 0, 0), 0.06 * s, 0.06 * s, 0.04, 12)
        v = lib.transform(v, (wx, wy, 0.06 * s), rot=(math.pi / 2, 0, rz))
        P['matte'].add(v, f, col('#1b1a20'))
    # chrome bumpers and headlights
    for x in (-L / 2 - 0.01, L / 2 + 0.01):
        v, f = lib.box((p.x + x * ca, p.y + x * sa, 0.08 * s), (0.03, Wd * 0.95, 0.04), rot_z=rz)
        P['chrome'].add(v, f, col('#e8ecf2'))
    hx = L / 2 + 0.005
    for y in (-Wd * 0.3, Wd * 0.3):
        v, f = lib.blob((p.x + hx * ca - y * sa, p.y + hx * sa + y * ca, 0.14 * s), 0.03 * s, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col('#fff4d0'))


def jukebox(P: Parts, bx, by, rnd, s=1.0):
    """A giant jukebox: rounded top, glowing tubes and a lit front."""
    p = W(bx, by)
    w, d, h = 0.5 * s, 0.34 * s, 0.7 * s
    v, f = lib.box((p.x, p.y, h / 2), (w, d, h))
    P['paint'].add(v, f, col('#6b2a3a'))
    arc = []
    for k in range(13):
        a = math.pi - k / 12 * math.pi
        arc.append((math.cos(a) * w / 2, math.sin(a) * w * 0.45))
    loc = (p.x, p.y - d / 2 - 0.01, h)
    neon_shape(P, arc, loc, '#ff9a3c', r=0.03 * s, closed=False)
    q = [(-w * 0.38, -h * 0.1, 0.0), (w * 0.38, -h * 0.1, 0.0), (w * 0.38, -h * 0.75, 0.0), (-w * 0.38, -h * 0.75, 0.0)]
    P['glow'].add(facing(q, (p.x, p.y - d / 2 - 0.012, h)), [(0, 1, 2, 3), (3, 2, 1, 0)], col('#ffd07a'))
    for dx in (-w * 0.44, w * 0.44):
        v, f = lib.cylinder((p.x + dx, p.y - d / 2 + 0.02, 0.05), 0.03 * s, 0.03 * s, h - 0.1, 8)
        P['neon'].add(v, f, col(rnd.choice(['#ff5ab4', '#4de8ff', '#ffcf4a'])))


def fire_escape(P: Parts, bx, by, rnd, floors=3, width=0.72, iron='#2e2b33'):
    """Iron balconies and zig-zag stairs down a camera-facing wall (the wall's top edge at board
    (bx, by), the rim at z = 0), with a warm window glow on each landing."""
    w = W(bx, by + 3)
    x, y = w.x, w.y
    dep = 0.26
    for k in range(floors):
        z = -0.42 - k * 0.58
        # grated landing and its front rail
        v, f = lib.box((x, y - dep / 2, z), (width, dep, 0.025))
        P['metal'].add(v, f, col(iron))
        v, f = lib.tube([(x - width / 2, y - dep, z + 0.2), (x + width / 2, y - dep, z + 0.2)], 0.012, 4)
        P['metal'].add(v, f, col(iron))
        for dx in (-width / 2, 0.0, width / 2):
            v, f = lib.cylinder((x + dx, y - dep, z), 0.008, 0.008, 0.2, 4)
            P['metal'].add(v, f, col(iron))
        v, f = lib.box((x + rnd.uniform(-0.15, 0.15), y + 0.003, z + 0.2), (0.16, 0.01, 0.2))
        P['glow'].add(v, f, col(rnd.choice(['#ffc66a', '#ffe0a0', '#9fd0ff'])))
        if k + 1 < floors:
            # stairs down to the next landing, alternating direction
            s = 1 if k % 2 == 0 else -1
            p0 = (x - s * width * 0.42, y - dep * 0.55, z)
            p1 = (x + s * width * 0.42, y - dep * 0.55, z - 0.58)
            v, f = lib.tube([p0, p1], 0.014, 4)
            P['metal'].add(v, f, col(iron))
            for t in [i / 6 for i in range(1, 6)]:
                q = (p0[0] + (p1[0] - p0[0]) * t, p0[1], p0[2] + (p1[2] - p0[2]) * t)
                v, f = lib.box(q, (0.1, dep * 0.8, 0.012))
                P['metal'].add(v, f, col(iron))
    # a drop ladder under the lowest landing
    zl = -0.42 - (floors - 1) * 0.58
    for dx in (-0.08, 0.08):
        v, f = lib.tube([(x + width * 0.3 + dx, y - dep + 0.02, zl), (x + width * 0.3 + dx, y - dep + 0.02, zl - 0.45)], 0.008, 4)
        P['metal'].add(v, f, col(iron))


def bollard(P: Parts, bx, by, glow='#ffd08a'):
    p = W(bx, by)
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.04, 0.035, 0.18, 8)
    P['metal'].add(v, f, col('#2e2c36'))
    v, f = lib.cylinder((p.x, p.y, 0.14), 0.036, 0.036, 0.04, 8)
    P['neon'].add(v, f, col(glow))


# ------------------------------------------------------------------------------------------
# Board-wide pieces
NEON_COLS = ['pink', 'cyan', 'gold', 'lime', 'violet', 'orange', 'white']


def beam_object(name, origin, direction, length, r0, r1, color):
    """A light beam: an open cone with an emission that fades along its length (alpha-blended)."""
    v, f = lib.cylinder((0, 0, 0), r0, r1, length, 20, cap=False)
    # orient +Z to `direction`
    z = Vector((0, 0, 1))
    rot = z.rotation_difference(direction)
    vv = [tuple(rot @ Vector(p) + origin) for p in v]
    ob = lib.mesh_object(name, vv, f, smooth=True)
    m = lib.NT(name + '_m')
    pos = m.position()
    # fade by distance from the origin
    vm = m.node('ShaderNodeVectorMath', operation='DISTANCE')
    m.link(pos, vm.inputs[0])
    vm.inputs[1].default_value = tuple(origin)
    fade = m.maprange(vm.outputs['Value'], 0.0, length, 0.28, 0.0)
    em = m.node('ShaderNodeEmission')
    em.inputs['Color'].default_value = col(color)
    em.inputs['Strength'].default_value = 0.9
    tr_ = m.node('ShaderNodeBsdfTransparent')
    mix = m.node('ShaderNodeMixShader')
    m.link(fade, mix.inputs['Fac'])
    m.link(tr_.outputs['BSDF'], mix.inputs[1])
    m.link(em.outputs['Emission'], mix.inputs[2])
    m.link(mix.outputs['Shader'], m.out.inputs['Surface'])
    emission_off(m.mat)
    m.mat.blend_method = 'BLEND'
    ob.data.materials.append(m.mat)
    ob.visible_shadow = False
    ob.visible_diffuse = False
    return ob



def star_pad(P: Parts, bx, by, rnd, glow='#6fe6ff'):
    """Where the Star Coin waits: a round rooftop pad with a gold ring and glowing inlay, baked into
    the terrain under the space."""
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y
    R = 0.8
    v, f = lib.lathe([(R + 0.04, 0.0), (R + 0.04, 0.02), (R, 0.03), (0.0, 0.03)], 48, (x, y, 0.0), cap_bottom=False)
    P['matte'].add(v, f, col('#3c4152'))
    for (ra, rb, kind, cc, z) in ((0.74, 0.78, 'metal', '#f2c14e', 0.034), (0.5, 0.53, 'neon', glow, 0.033), (0.2, 0.23, 'metal', '#f2c14e', 0.033)):
        v, f = lib.lathe([(rb, z), (ra, z)], 64, (x, y, 0.0), cap_bottom=False, cap_top=False)
        P[kind].add(v, f, col(cc))
    for k in range(8):
        a = k / 8 * math.tau
        v, f = lib.blob((x + math.cos(a) * 0.66, y + math.sin(a) * 0.66, 0.04), 0.03, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col('#fff4c8'))


def facade_signs(P: Parts, ring, nrm, words, rnd, count=2):
    """Neon words mounted on the camera-facing walls, just under the cornice."""
    cand = [k for k in range(len(ring)) if nrm[k][1] > 0.9]
    rnd.shuffle(cand)
    used = []
    for k in cand:
        if len(used) >= count:
            break
        bx, by = ring[k]
        if any(abs(bx - u) < 260 for u in used):
            continue
        used.append(bx)
        w = board_to_world(bx, by + 5, 0.0)
        word = rnd.choice(words)
        neon_text(P, word, (w.x, w.y - 0.05, -0.62 - rnd.uniform(0.0, 0.4)), 0.2, NEON[rnd.choice(NEON_COLS)], backing='#1c1a26', pad=0.07)
    return used


def backdrop_tower(P: Parts, tower_mats, bx, by, rnd, w=0.9, d=0.7, h=3.0, style='brick'):
    """A taller building standing at the back of a block (lit windows, a rooftop tank or crown)."""
    c = board_to_world(bx, by, 0.0)
    x, y = c.x, c.y - d / 2
    verts = [(x - w / 2, y - d / 2, 0.0), (x + w / 2, y - d / 2, 0.0), (x + w / 2, y + d / 2, 0.0), (x - w / 2, y + d / 2, 0.0),
             (x - w / 2, y - d / 2, h), (x + w / 2, y - d / 2, h), (x + w / 2, y + d / 2, h), (x - w / 2, y + d / 2, h)]
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]
    ob = lib.mesh_object(f'tower_{int(bx)}_{int(by)}', verts, faces, smooth=False)
    ob.data.materials.append(tower_mats[style])
    v, f = lib.box((x, y, h + 0.05), (w + 0.08, d + 0.08, 0.1))
    P['stone'].add(v, f, col('#b8aeb0'))
    r = rnd.random()
    if r < 0.4:
        water_tank(P, (x + rnd.uniform(-0.2, 0.2)) * PX, -(y) * PX * COSB, rnd, 0.8)
        # raise it onto the roof
    elif r < 0.7:
        neon_shape(P, star_pts(0.18, 0.08), (x, y - d / 2 - 0.03, h + 0.35), NEON[rnd.choice(NEON_COLS)], r=0.022)
    else:
        v, f = lib.cylinder((x, y, h + 0.1), 0.02, 0.012, 0.8, 6)
        P['metal'].add(v, f, col('#b5bac4'))
        v, f = lib.blob((x, y, h + 0.92), 0.035, rough=0.0, subdiv=1)
        P['neon'].add(v, f, col('#ff3a3a'))
    return ob
