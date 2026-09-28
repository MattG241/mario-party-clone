"""Free Throw Frenzy (Capitol Gardens): the garden basketball court and its sprites.

    <bpy python> scripts/art/worlds/sports/mg_court.py court|sprites|all [--preview] [--dry]

The court is laid out exactly as src/game/worlds/capitol/games/freeThrowRules.ts: camera 34 degrees
above the ground, the hoop's ground point at (960, 560) with its rim 3.05 m up, the backboard 0.52 m
behind it, and the shooters on a 5.2 m arc. The hoop slides along a track on the baseline in the final
stretch, so it is a sprite (with its shadow, over a shadow catcher), as is the rim's front half (drawn
over the ball) and the two balls. Everything is original: a sandstone half court on a garden lawn, a
white columned hall with a portico, clipped hedges, a fountain, flower beds and lanterns.
Outputs public/assets/rendered/scene_capitol_court(_blur).webp and mg/capitol_{hoop,rim,ball,ball_gold}.webp.
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import mg_common as C  # noqa: E402
from mg_common import SW, board_to_world, col, lib, dress, props  # noqa: E402

import bpy  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('what', choices=['court', 'sprites', 'all'])
p.add_argument('--preview', action='store_true')
p.add_argument('--dry', action='store_true')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

ELEV = 34
HOOP = (960, 560)
RIM_Z = 3.05
RIM_R = 0.40
BOARD_BACK = 0.52
BOARD_Z = (2.90, 4.12)
BOARD_W = 2.0
TRACK = (620, 1300)
COURT = (290, 440, 1630, 1045)
SUN = dict(sun_elev=50, sun_az=-35, key=3.6, fill=0.8)
CREAM = '#f6f0e4'
STONE = '#e9e1d2'


def cosb():
    return math.cos(math.radians(90 - ELEV))


def gy_of(depth_units_behind):
    """Screen y of a ground point `depth` world units behind the hoop's ground point."""
    return HOOP[1] - depth_units_behind * 100 * cosb()


# ------------------------------------------------------------------------------------------
# Court surface
def court_texture(path):
    x0, y0, x1, y1 = COURT
    w, h = x1 - x0, y1 - y0
    k = cosb()
    rnd = random.Random(4)
    import numpy as np
    base = np.array([214, 184, 140], np.float32)
    n1, n2 = C.noise_img(w, h, 40, 60), C.noise_img(w, h, 6, 40)
    arr = base[None, None, :] * (0.93 + 0.1 * n1[..., None]) * (0.97 + 0.05 * n2[..., None])
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    X = lambda x: x - x0  # noqa: E731
    Y = lambda y: y - y0  # noqa: E731
    hx, hy = HOOP
    base_y = gy_of(1.6)
    # the key (lane), painted terracotta, and the free-throw circle
    ft_y = base_y + 580 * k
    d.rectangle([X(hx - 245), Y(base_y), X(hx + 245), Y(ft_y)], fill=(196, 128, 84))
    d.ellipse([X(hx - 180), Y(ft_y - 180 * k), X(hx + 180), Y(ft_y + 180 * k)], fill=(196, 128, 84))
    # soft grain: sand swirls on the key
    for _ in range(260):
        cx, cy = rnd.uniform(X(hx - 240), X(hx + 240)), rnd.uniform(Y(base_y), Y(ft_y + 170 * k))
        r = rnd.uniform(4, 14)
        d.arc([cx - r, cy - r * k, cx + r, cy + r * k], rnd.uniform(0, 360), rnd.uniform(0, 360), fill=(186, 118, 76), width=2)
    white = (250, 246, 236)
    lw = 7
    # sidelines, baseline and the near border
    d.rectangle([X(x0 + 14), Y(base_y), X(x1 - 14), Y(y1 - 10)], outline=white, width=lw)
    d.rectangle([X(hx - 245), Y(base_y), X(hx + 245), Y(ft_y)], outline=white, width=lw)
    d.ellipse([X(hx - 180), Y(ft_y - 180 * k), X(hx + 180), Y(ft_y + 180 * k)], outline=white, width=lw)
    # the arc: 6.0 m round the hoop, meeting straight lines near the baseline
    R = 600
    d.arc([X(hx - R), Y(hy - R * k), X(hx + R), Y(hy + R * k)], 12, 168, fill=white, width=lw)
    ax = R * math.cos(math.radians(12))
    ay = hy + R * math.sin(math.radians(12)) * k
    for sx in (-1, 1):
        d.line([(X(hx + sx * ax), Y(ay)), (X(hx + sx * ax), Y(base_y))], fill=white, width=lw)
    # lane hash marks
    for t in (0.35, 0.55, 0.75):
        yy = base_y + (ft_y - base_y) * t
        for sx in (-1, 1):
            d.line([(X(hx + sx * 245), Y(yy)), (X(hx + sx * 270), Y(yy))], fill=white, width=5)
    # a darker border band where the court meets the lawn
    import numpy as np
    arr = np.asarray(im).astype(np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    e = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy) / k)
    arr *= (0.84 + 0.16 * np.clip(e / 30.0, 0, 1))[..., None]
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(path)


def slab(region, name, top_mat, z=0.03, depth=0.3, side='#cdb58f'):
    x0, y0, x1, y1 = region
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    top = [tuple(board_to_world(x, y, z)) for (x, y) in corners]
    bot = [tuple(board_to_world(x, y, -depth)) for (x, y) in corners]
    lib.mesh_object(f'{name}_top', top, [(3, 2, 1, 0)], smooth=False, material=top_mat)
    sb = lib.MeshBuilder()
    sb.add(top + bot, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], col(side))
    sb.build(f'{name}_sides', props.mats()['stone'], smooth=False)


# ------------------------------------------------------------------------------------------
# The hall with a portico (back left)
def hall(bx, by, w=5.2, depth=1.9, h=2.25):
    """A white columned hall facing the camera: base, walls with tall windows, a six-column portico
    with a pediment, a roof balustrade and steps. (bx, by) = the middle of its front wall."""
    P = lib.MeshBuilder()   # plaster / stone (stone material)
    G = lib.MeshBuilder()   # glass (glow-ish dark panes)
    Mt = lib.MeshBuilder()  # metal (gold finials)
    c = board_to_world(bx, by, 0)
    x, y = c.x, c.y
    wall = col(CREAM)
    base = col('#ddd3c1')
    # plinth and main block
    v, f = lib.box((x, y + depth / 2, 0.12), (w + 0.2, depth + 0.2, 0.24))
    P.add(v, f, base)
    v, f = lib.box((x, y + depth / 2, 0.24 + h / 2), (w, depth, h))
    P.add(v, f, wall)
    # cornice
    v, f = lib.box((x, y + depth / 2, 0.24 + h + 0.06), (w + 0.16, depth + 0.16, 0.12))
    P.add(v, f, col('#fbf8f1'))
    # balustrade on the roof
    for k in range(34):
        px_ = x - w / 2 + 0.12 + k * (w - 0.24) / 33
        v, f = lib.cylinder((px_, y - 0.02, 0.24 + h + 0.12), 0.025, 0.025, 0.16, 6)
        P.add(v, f, col('#fbf8f1'))
    v, f = lib.box((x, y - 0.02, 0.24 + h + 0.3), (w, 0.08, 0.05))
    P.add(v, f, col('#fbf8f1'))
    # windows either side of the portico: tall panes with white frames
    for side in (-1, 1):
        for k in range(3):
            wx = x + side * (1.45 + k * 0.42)
            for (z0, hh) in ((0.55, 0.78), (1.55, 0.6)):
                v, f = lib.box((wx, y - 0.012, 0.24 + z0 + hh / 2), (0.26, 0.02, hh))
                G.add(v, f, col('#3d5872'))
                v, f = lib.box((wx, y - 0.02, 0.24 + z0 + hh + 0.04), (0.34, 0.03, 0.06))
                P.add(v, f, col('#ffffff'))
    # the portico: steps, six columns, entablature and pediment
    pw = 2.5
    for k in range(3):
        v, f = lib.box((x, y - 0.95 + k * 0.12, 0.04 + k * 0.08), (pw + 0.5 - k * 0.1, 0.5, 0.08 + k * 0.16))
        P.add(v, f, col('#efe8da'))
    for k in range(6):
        cx = x - pw / 2 + k * pw / 5
        cy = y - 0.62
        prof = [(0.12, 0.26), (0.12, 0.33), (0.1, 0.34), (0.095, 2.2), (0.12, 2.26), (0.14, 2.32), (0.0, 2.32)]
        v, f = lib.lathe(prof, 14, (cx, cy, 0.0))
        P.add(v, f, col('#fdfbf6'))
    v, f = lib.box((x, y - 0.4, 2.44), (pw + 0.4, 0.62, 0.22))
    P.add(v, f, col('#fbf8f1'))
    ped = [(x - pw / 2 - 0.25, y - 0.72, 2.55), (x + pw / 2 + 0.25, y - 0.72, 2.55), (x, y - 0.72, 3.15),
           (x - pw / 2 - 0.25, y - 0.1, 2.55), (x + pw / 2 + 0.25, y - 0.1, 2.55), (x, y - 0.1, 3.15)]
    P.add(ped, [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], col('#fbf8f1'))
    # inset tympanum (a slightly warmer face) and a gold finial
    tri = [(x - pw / 2 + 0.05, y - 0.735, 2.6), (x + pw / 2 - 0.05, y - 0.735, 2.6), (x, y - 0.735, 3.02)]
    P.add(tri, [(0, 1, 2)], col('#efe6d4'))
    v, f = lib.blob((x, y - 0.4, 3.2), 0.07, rough=0.0, subdiv=2)
    Mt.add(v, f, col('#f2c14e'))
    # the door
    v, f = lib.box((x, y - 0.012, 0.24 + 0.55), (0.5, 0.02, 1.1))
    G.add(v, f, col('#6b4a36'))
    P.build('hall_stone', props.mats()['stone_big'])
    G.build('hall_glass', lib.attr_mat('hall_glass', rough=0.2, ao=0.3))
    Mt.build('hall_gold', props.mats()['metal'])


def hedge_wall(x0, x1, by, h=1.05, d=0.5):
    """A clipped hedge along the back of the lawn, with round topiaries along its top."""
    L = lib.MeshBuilder()
    a = board_to_world(x0, by, 0)
    b = board_to_world(x1, by, 0)
    rnd = random.Random(11)
    n = int((b.x - a.x) / 0.18)
    for k in range(n + 1):
        px_ = a.x + (b.x - a.x) * k / n
        for zz in (0.25, 0.6, 0.9):
            v, f = lib.blob((px_, a.y + d / 2, zz), 0.28, squash=(1.0, 1.0, 0.9), rough=0.22, subdiv=2, seed=rnd.random() * 9)
            L.add(v, f, col(rnd.choice(['#2f7a36', '#357f3a', '#2a6e32'])))
    for k in range(7):
        px_ = a.x + 0.4 + (b.x - a.x - 0.8) * k / 6
        v, f = lib.cylinder((px_, a.y + d / 2, h - 0.05), 0.05, 0.05, 0.25, 6)
        L.add(v, f, col('#6e4a2c'))
        v, f = lib.blob((px_, a.y + d / 2, h + 0.34), 0.26, rough=0.12, subdiv=2, seed=k)
        L.add(v, f, col('#3c8c3f'))
    L.build('hedge_wall', lib.attr_mat('hedge_leaf', rough=0.8, ao=0.55))


def fountain(bx, by, s=1.0):
    """A round stone fountain: a wide basin, a pedestal bowl and a spray of water."""
    St = lib.MeshBuilder()
    W = lib.MeshBuilder()
    c = board_to_world(bx, by, 0)
    x, y = c.x, c.y
    v, f = lib.lathe([(1.0 * s, 0.0), (1.02 * s, 0.22 * s), (0.92 * s, 0.26 * s), (0.9 * s, 0.1 * s), (0.0, 0.1 * s)], 36, (x, y, 0))
    St.add(v, f, col(STONE))
    v, f = lib.lathe([(0.9 * s, 0.17 * s), (0.0, 0.17 * s)], 36, (x, y, 0), cap_bottom=False)
    W.add(v, f, col('#7fcff2'))
    v, f = lib.lathe([(0.14 * s, 0.1 * s), (0.1 * s, 0.7 * s), (0.44 * s, 0.82 * s), (0.4 * s, 0.9 * s), (0.0, 0.84 * s)], 24, (x, y, 0))
    St.add(v, f, col('#f1ebdf'))
    v, f = lib.lathe([(0.38 * s, 0.86 * s), (0.0, 0.86 * s)], 24, (x, y, 0), cap_bottom=False)
    W.add(v, f, col('#8fd8f6'))
    # the spray: a tall soft plume and droplets falling back
    v, f = lib.lathe([(0.05 * s, 0.86 * s), (0.08 * s, 1.3 * s), (0.02 * s, 1.55 * s), (0.0, 1.56 * s)], 12, (x, y, 0))
    W.add(v, f, col('#e8f8ff'))
    for k in range(10):
        a = k / 10 * math.tau
        pts = [(x + math.cos(a) * r * s, y + math.sin(a) * r * s, (1.45 - 5 * (r - 0.05) ** 2) * s) for r in (0.05, 0.2, 0.35, 0.45)]
        v, f = lib.tube(pts, 0.018 * s, 5)
        W.add(v, f, col('#e8f8ff'))
    St.build('fountain_stone', props.mats()['stone'])
    m = lib.NT('fountain_water')
    cc = m.attr('col')
    m.bsdf(cc, 0.08, emission=cc, emission_strength=0.35, coat=0.8)
    W.build('fountain_water', m.mat)


def track():
    """The hoop's track along the baseline: two steel rails on sleepers, with bumpers at each end."""
    M = lib.MeshBuilder()
    Wd = lib.MeshBuilder()
    gy0 = gy_of(1.1)
    for dy in (-0.16, 0.16):
        a = board_to_world(TRACK[0], gy0, 0)
        b = board_to_world(TRACK[1], gy0, 0)
        v, f = lib.box(((a.x + b.x) / 2, a.y + dy, 0.035), (b.x - a.x, 0.05, 0.05))
        M.add(v, f, col('#aeb4bf'))
    for k in range(18):
        px_ = TRACK[0] + (TRACK[1] - TRACK[0]) * k / 17
        c = board_to_world(px_, gy0, 0)
        v, f = lib.box((c.x, c.y, 0.012), (0.1, 0.5, 0.025))
        Wd.add(v, f, col('#8a6a4a'))
    for sx in TRACK:
        c = board_to_world(sx + (-14 if sx == TRACK[0] else 14), gy0, 0)
        v, f = lib.cylinder((c.x, c.y, 0.0), 0.07, 0.07, 0.28, 12)
        M.add(v, f, col('#f4b83b'))
        v, f = lib.cylinder((c.x, c.y, 0.14), 0.072, 0.072, 0.06, 12, cap=False)
        M.add(v, f, col('#2b2f38'))
    M.build('track_rails', props.mats()['metal'])
    Wd.build('track_sleepers', props.mats()['wood'])


def court_scene():
    cam = C.start(ELEV, 22, A.preview, **SUN)
    tex = os.path.join(C.OUT, 'court_floor.png')
    court_texture(tex)
    slab(COURT, 'court', C.ground_image_material('court', tex, COURT, rough=0.75, bump=0.18), z=0.03, depth=0.25)
    x0, y0, x1, y1 = COURT
    outline = C.blob_outline(960, 600, 1000, 560, seed=7, lobes=8, wobble=0.05)
    C.island(outline, grass=[(0.24, '#2c7a2c'), (0.38, '#3a9233'), (0.52, '#4fa83a'), (0.66, '#6cbd3c'), (0.8, '#8fcc4a')])
    track()
    hall(430, 285)
    hedge_wall(700, 1330, 350)
    fountain(1560, 300, 0.95)
    rnd = random.Random(21)
    # formal flower beds and low box hedges round the lawn (clear of the spectators' spots)
    B = {k: lib.MeshBuilder() for k in ('wood', 'leaves', 'flowers')}
    import festival as fv  # noqa: E402
    fv.flower_beds(B, 1200, 392, 3, 1, rnd, bw=0.55, bd=0.24)
    fv.flower_beds(B, 790, 1062, 4, 1, rnd, bw=0.5, bd=0.2)
    fv.flower_beds(B, 1130, 1062, 4, 1, rnd, bw=0.5, bd=0.2)
    B['wood'].build('beds_wood', props.mats()['wood'])
    B['leaves'].build('beds_leaves', lib.attr_mat('beds_leaf', rough=0.78, ao=0.5))
    B['flowers'].build('beds_flowers', lib.attr_mat('beds_flower', rough=0.55, subsurface=0.2))
    C.greenery([(90, 250, 1.25), (1830, 240, 1.2), (60, 1000, 1.05), (1860, 1000, 1.05), (760, 250, 0.95), (1290, 255, 0.95)],
               [(40, 620, 1.0), (1880, 620, 1.0), (270, 380, 0.9), (1650, 385, 0.9), (70, 820, 0.9), (1850, 820, 0.9)],
               blossom=[(1080, 230, 0.9), (620, 240, 0.85)])
    for (x, y) in [(275, 440), (1645, 440), (275, 1010), (1645, 1010)]:
        props.lantern(x, y, 1.05)
    dress.pennant_swag(board_to_world(275, 440, 1.02), board_to_world(275, 1010, 1.02), sag=0.3, n=12, size=0.16)
    dress.pennant_swag(board_to_world(1645, 440, 1.02), board_to_world(1645, 1010, 1.02), sag=0.3, n=12, size=0.16, offset=2)
    for i, (x, y) in enumerate([(40, 470), (1880, 470)]):
        dress.planter(x, y, w=0.9, s=0.9, name=f'planter{i}')
    keep = dress.Keep().rect(x0 - 20, y0 - 30, x1 + 20, y1 + 20)
    for (x, y) in [(150, 520), (232, 640), (128, 760), (214, 880), (1770, 520), (1688, 640), (1792, 760), (1706, 880)]:
        keep.ell(x, y, 60, 30)
    keep.rect(160, 120, 720, 330).rect(700, 300, 1330, 380).ell(1560, 300, 120, 70)
    C.scatter(outline, keep, random.Random(91), tufts=2200 if not A.preview else 900, flowers=40, pebbles=30)
    C.haze(cam, y0, 60, amount=0.16, skip=('court',))
    if A.dry:
        print('court scene built (dry run)')
        return
    path = os.path.join(C.OUT, 'court.png')
    lib.render_to(path)
    C.publish(path, 'capitol_court', A.preview, blur=True)


# ------------------------------------------------------------------------------------------
# Sprites: the hoop (for the slide), the rim's front half, the balls
def hoop_parts(front_only=None):
    """Wheeled base, pole, arm, backboard and rim. front_only: None = all but the rim's front half,
    True = only the rim's front half."""
    hx, hy = HOOP
    k = cosb()
    rim_c = board_to_world(hx, hy, RIM_Z)
    Mt = lib.MeshBuilder()
    Bd = lib.MeshBuilder()
    Rm = lib.MeshBuilder()
    Rf = lib.MeshBuilder()
    # the rim: a torus split into its far and near halves
    n = 32
    tube_r = 0.03
    for i in range(n):
        a0 = i / n * math.tau
        a1 = (i + 1) / n * math.tau
        near = math.sin((a0 + a1) / 2) < 0  # world -y is towards the camera
        pts = [(rim_c.x + math.cos(a) * RIM_R, rim_c.y + math.sin(a) * RIM_R, rim_c.z) for a in (a0, a1)]
        v, f = lib.tube(pts, tube_r, 8)
        (Rf if near else Rm).add(v, f, col('#e8641e'))
    if front_only:
        Rf.build('rim_front', lib.attr_mat('rim_paint', rough=0.35))
        return
    # rim bracket to the board
    board_y = rim_c.y + BOARD_BACK
    v, f = lib.box((rim_c.x, (rim_c.y + RIM_R + board_y) / 2, RIM_Z - 0.03), (0.14, board_y - rim_c.y - RIM_R + 0.02, 0.04))
    Rm.add(v, f, col('#d85a1a'))
    # backboard: white glass-look panel, dark frame, orange target square
    z0, z1 = BOARD_Z
    v, f = lib.box((rim_c.x, board_y, (z0 + z1) / 2), (BOARD_W, 0.05, z1 - z0))
    Bd.add(v, f, col('#f7f9fc'))
    for (cx_, cz, sx, sz) in [(0, z1 - 0.03, BOARD_W + 0.04, 0.07), (0, z0 + 0.03, BOARD_W + 0.04, 0.07), (-BOARD_W / 2, (z0 + z1) / 2, 0.07, z1 - z0), (BOARD_W / 2, (z0 + z1) / 2, 0.07, z1 - z0)]:
        v, f = lib.box((rim_c.x + cx_, board_y - 0.03, cz), (sx, 0.04, sz))
        Mt.add(v, f, col('#26324a'))
    for (cx_, cz, sx, sz) in [(0, z0 + 0.5, 0.62, 0.035), (0, z0 + 0.12, 0.62, 0.035), (-0.29, z0 + 0.31, 0.035, 0.42), (0.29, z0 + 0.31, 0.035, 0.42)]:
        v, f = lib.box((rim_c.x + cx_, board_y - 0.03, cz), (sx, 0.02, sz))
        Rm.add(v, f, col('#e8641e'))
    # pole and arm, down to a wheeled base riding the track
    pole = board_to_world(hx, hy - 1.1 * 100 * k, 0)
    v, f = lib.cylinder((pole.x, pole.y, 0.2), 0.085, 0.075, 3.25, 16)
    Mt.add(v, f, col('#2e3a52'))
    arm_pts = [(pole.x, pole.y, 3.3), (pole.x, (pole.y + board_y) / 2, 3.42), (rim_c.x, board_y + 0.03, 3.4)]
    v, f = lib.tube(arm_pts, 0.06, 10)
    Mt.add(v, f, col('#2e3a52'))
    v, f = lib.tube([(pole.x, pole.y, 2.1), (rim_c.x, board_y + 0.03, 3.0)], 0.04, 8)
    Mt.add(v, f, col('#2e3a52'))
    v, f = lib.box((pole.x, pole.y, 0.14), (1.2, 0.5, 0.2))
    Mt.add(v, f, col('#3b4760'))
    v, f = lib.box((pole.x, pole.y, 0.26), (1.0, 0.4, 0.06))
    Mt.add(v, f, col('#f4b83b'))
    for sx in (-0.45, 0.45):
        for sy in (-0.16, 0.16):
            v, f = lib.blob((pole.x + sx, pole.y + sy, 0.07), 0.075, squash=(0.6, 1.0, 1.0), rough=0.0, subdiv=2)
            Mt.add(v, f, col('#15181e'))
    Mt.build('hoop_metal', props.mats()['metal'])
    Bd.build('hoop_board', lib.attr_mat('hoop_board', rough=0.25))
    Rm.build('hoop_rim', lib.attr_mat('rim_paint2', rough=0.35))


def ball_scene(gold):
    """A basketball (or the golden one) seen by the court camera, lit by the court's sun."""
    C.start(ELEV, 40, A.preview, **SUN)
    m = lib.NT('ball_gold' if gold else 'ball')
    pos = m.position()
    X, Y, Z = m.sep(pos)
    # seams: the two great circles and the curved pair, as thin dark bands
    ax = m.math('ABSOLUTE', X)
    az = m.math('ABSOLUTE', Z)
    seam1 = m.maprange(ax, 0.02, 0.05, 1.0, 0.0)
    seam2 = m.maprange(az, 0.02, 0.05, 1.0, 0.0)
    # the curved pair: circles at |x| ~ 0.67 on the unit sphere (y^2 + z^2 ~ 0.55)
    curve = m.math('ABSOLUTE', m.math('SUBTRACT', m.math('ADD', m.math('MULTIPLY', Y, Y), m.math('MULTIPLY', Z, Z)), 0.55))
    seam3 = m.maprange(curve, 0.02, 0.06, 1.0, 0.0)
    seams = m.math('MAXIMUM', m.math('MAXIMUM', seam1, seam2), seam3)
    pebble = m.noise(60.0, 2, 0.5, pos)
    body = m.mix(m.maprange(pebble.outputs['Fac'], 0.3, 0.7), col('#d8641f' if not gold else '#e0a52a'), col('#ef8a3c' if not gold else '#ffd35a'))
    c = m.mix(seams, body, col('#2a160c' if not gold else '#7a4d00'))
    m.bsdf(c, 0.55 if not gold else 0.3, normal=m.bump(pebble.outputs['Fac'], 0.15, 0.01), coat=0.2 if not gold else 0.6)
    ob = lib.mesh_object('ball', *lib.icosphere(4), smooth=True, material=m.mat)
    ob.location = board_to_world(960, 540, 0.5)
    ob.rotation_euler = (0.5, 0.3, 0.6)
    C.sprite_camera(960 - 32, 540 - 0.5 * 100 * math.sin(math.radians(90 - ELEV)) - 32, 64, 64, scale=1.0)
    ob.scale = (0.29, 0.29, 0.29)
    return ob


def sprites():
    # The hoop, over a shadow catcher (its shadow slides with it).
    C.start(ELEV, 24, A.preview, **SUN)
    hoop_parts()
    C.shadow_catcher((700, 120, 1300, 640))
    C.sprite_camera(780, 150, 460, 440, scale=1.0)
    if A.dry:
        print('hoop built (dry run)')
    else:
        path = os.path.join(C.OUT, 'hoop.png')
        lib.render_to(path)
        C.publish_sprite(path, 'capitol_hoop', A.preview)
    # The rim's front half on its own.
    C.start(ELEV, 24, A.preview, **SUN)
    hoop_parts(front_only=True)
    C.sprite_camera(910, 280, 100, 60, scale=1.0)
    if not A.dry:
        path = os.path.join(C.OUT, 'rim.png')
        lib.render_to(path)
        C.publish_sprite(path, 'capitol_rim', A.preview)
    for gold in (False, True):
        ball_scene(gold)
        if A.dry:
            continue
        path = os.path.join(C.OUT, 'ball_gold.png' if gold else 'ball.png')
        lib.render_to(path)
        C.publish_sprite(path, 'capitol_ball_gold' if gold else 'capitol_ball', A.preview)


if A.what in ('court', 'all'):
    court_scene()
if A.what in ('sprites', 'all'):
    sprites()
