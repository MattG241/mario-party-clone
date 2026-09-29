"""Slapshot Showdown (Showtime Strip): the four-sided ice rink under the lights, and its sprites.

    <bpy python> scripts/art/worlds/sports/mg_rink.py rink|sprites|all [--preview] [--dry]

Laid out exactly as src/game/worlds/rink/games/slapshotRules.ts: camera 62 degrees above the ice, a
rounded-square rink (half size 4.5 m, corners 1.3 m) centred on screen (960, 628). The goals are
sprites (a player count leaves some sides without one), rendered with the rink's overhead light over
a shadow catcher, as is the puck. Around the ice: white boards with a pink rail and a row of marquee
bulbs, low stands either side for the crowd, neon arches over a little stage at the far end and spot
towers in the corners. Night-time and original throughout (no signs or lettering).
Outputs public/assets/rendered/scene_rink_arena(_blur).webp and mg/rink_{puck,goal_l,goal_r,goal_t,goal_b}.webp.
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import mg_common as C  # noqa: E402
from mg_common import SW, SH, board_to_world, col, lib, props  # noqa: E402

import bpy  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('what', choices=['rink', 'sprites', 'all'])
p.add_argument('--preview', action='store_true')
p.add_argument('--dry', action='store_true')
A = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

ELEV = 62
COSB = math.cos(math.radians(90 - ELEV))
CX = 960
CY_W = 628 / COSB          # rink centre, world depth (px)
HALF = 450
CORNER = 130
GOAL_W, GOAL_D, GOAL_IN = 180, 52, 60
BOARD_H = 0.42
PINK = '#e85aa8'
GOLD = '#ffd46a'
GOAL_REGIONS = {'l': (490, 460, 130, 280), 'r': (1300, 460, 130, 280), 't': (850, 170, 220, 140), 'b': (850, 900, 220, 150)}


def sy(wy):
    return wy * COSB


def rink_outline(inset=0.0, n_corner=10):
    """The rounded square's outline (screen px), clockwise from the top left corner."""
    h = HALF - inset
    rc = CORNER - inset
    inner = HALF - CORNER
    pts = []
    for (sx, syy, a0) in [(-1, -1, math.pi), (1, -1, -math.pi / 2), (1, 1, 0), (-1, 1, math.pi / 2)]:
        ox, oy = CX + sx * inner, CY_W + syy * inner
        for k in range(n_corner + 1):
            a = a0 + k / n_corner * (math.pi / 2)
            pts.append((ox + math.cos(a) * rc, sy(oy + math.sin(a) * rc)))
    return pts


def ice_texture(path, region):
    x0, y0, x1, y1 = region
    w, h = x1 - x0, y1 - y0
    rnd = random.Random(6)
    n1, n2 = C.noise_img(w, h, 50, 50), C.noise_img(w, h, 6, 30)
    base = np.array([236, 244, 252], np.float32)
    arr = base[None, None, :] * (0.965 + 0.04 * n1[..., None]) * (0.985 + 0.02 * n2[..., None])
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    # skate scratches
    for _ in range(420):
        cx, cy = rnd.uniform(0, w), rnd.uniform(0, h)
        r = rnd.uniform(30, 160)
        a0 = rnd.uniform(0, 360)
        d.arc([cx - r, cy - r * COSB, cx + r, cy + r * COSB], a0, a0 + rnd.uniform(15, 50), fill=(214, 228, 242), width=1)
    X = lambda x: x - x0  # noqa: E731
    Y = lambda y: y - y0  # noqa: E731
    cy_s = sy(CY_W)
    # centre circle, spot and a four-point star in Showtime pink; faint blue cross lines
    for (r, col_, wdt) in [(96, (232, 90, 168), 6), (22, (232, 90, 168), 0)]:
        box = [X(CX - r), Y(cy_s - r * COSB), X(CX + r), Y(cy_s + r * COSB)]
        if wdt:
            d.ellipse(box, outline=col_, width=wdt)
        else:
            d.ellipse(box, fill=col_)
    d.line([(X(CX - HALF + 20), Y(cy_s)), (X(CX - 110), Y(cy_s))], fill=(140, 196, 240), width=4)
    d.line([(X(CX + 110), Y(cy_s)), (X(CX + HALF - 20), Y(cy_s))], fill=(140, 196, 240), width=4)
    d.line([(X(CX), Y(cy_s - (HALF - 20) * COSB)), (X(CX), Y(cy_s - 110 * COSB))], fill=(140, 196, 240), width=4)
    d.line([(X(CX), Y(cy_s + 110 * COSB)), (X(CX), Y(cy_s + (HALF - 20) * COSB))], fill=(140, 196, 240), width=4)
    star = []
    for k in range(8):
        a = k / 8 * math.tau - math.pi / 2
        r = 62 if k % 2 == 0 else 24
        star.append((X(CX + math.cos(a) * r), Y(cy_s + math.sin(a) * r * COSB)))
    d.polygon(star, fill=(255, 214, 106))
    # four face-off spots on the diagonals
    for (dx, dy) in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        fx, fy = CX + dx * 230, cy_s + dy * 230 * COSB
        d.ellipse([X(fx - 14), Y(fy - 14 * COSB), X(fx + 14), Y(fy + 14 * COSB)], fill=(120, 170, 230))
    im.save(path)


def floor_plane():
    """A dark stage floor under everything (the render is opaque: night all round)."""
    pts = [(-200, -200), (SW + 200, -200), (SW + 200, SH + 400), (-200, SH + 400)]
    verts = [tuple(board_to_world(x, y, -0.02)) for (x, y) in pts]
    m = lib.NT('stage_floor')
    pos = m.position()
    tiles = m.node('ShaderNodeTexBrick')
    tiles.inputs['Scale'].default_value = 1.2
    tiles.inputs['Mortar Size'].default_value = 0.01
    tiles.inputs['Color1'].default_value = col('#231c44')
    tiles.inputs['Color2'].default_value = col('#1d1739')
    tiles.inputs['Mortar'].default_value = col('#14102a')
    m.link(pos, tiles.inputs['Vector'])
    m.bsdf(tiles.outputs['Color'], 0.35, coat=0.5)
    lib.mesh_object('floor', verts, [(3, 2, 1, 0)], smooth=False, material=m.mat)


def ice_mesh(mat):
    ring = rink_outline(0, 12)
    verts = [tuple(board_to_world(x, y, 0.02)) for (x, y) in ring]
    verts.append(tuple(board_to_world(CX, sy(CY_W), 0.02)))
    n = len(ring)
    faces = [(n, (i + 1) % n, i) for i in range(n)]
    lib.mesh_object('ice', verts, faces, smooth=False, material=mat)


def boards_and_bulbs():
    """White boards round the ice with a dark kick plate, a pink top rail and marquee bulbs on it."""
    Wh = lib.MeshBuilder()
    Rl = lib.MeshBuilder()
    Bl = lib.MeshBuilder()
    inner = rink_outline(0, 12)
    outer = rink_outline(-14, 12)
    n = len(inner)
    for i in range(n):
        j = (i + 1) % n
        a0 = board_to_world(*inner[i], 0)
        a1 = board_to_world(*inner[j], 0)
        b0 = board_to_world(*outer[i], 0)
        b1 = board_to_world(*outer[j], 0)
        # inner face (kick plate low, white above), top, outer face
        for (z0, z1, c_) in [(0.0, 0.1, '#2a2346'), (0.1, BOARD_H, '#f3f5fa')]:
            Wh.add([(a0.x, a0.y, z0), (a1.x, a1.y, z0), (a1.x, a1.y, z1), (a0.x, a0.y, z1)], [(0, 1, 2, 3)], col(c_))
        Wh.add([(b0.x, b0.y, 0.0), (b1.x, b1.y, 0.0), (b1.x, b1.y, BOARD_H), (b0.x, b0.y, BOARD_H)], [(3, 2, 1, 0)], col('#2e2552'))
        Rl.add([(a0.x, a0.y, BOARD_H), (a1.x, a1.y, BOARD_H), (b1.x, b1.y, BOARD_H + 0.02), (b0.x, b0.y, BOARD_H + 0.02)], [(3, 2, 1, 0)], col(PINK))
    Wh.build('boards', lib.attr_mat('boards_paint', rough=0.4, ao=0.4))
    Rl.build('board_rail', lib.attr_mat('rail_paint', rough=0.3))
    # bulbs every ~46 px round the rail
    per = []
    mid = rink_outline(-7, 12)
    for i in range(len(mid)):
        a = mid[i]
        b = mid[(i + 1) % len(mid)]
        per.append((a, b, math.hypot(b[0] - a[0], (b[1] - a[1]) / COSB)))
    total = sum(L for (_, _, L) in per)
    count = int(total / 46)
    t = 0.0
    step = total / count
    seg = 0
    acc = 0.0
    for k in range(count):
        target = k * step
        while acc + per[seg][2] < target:
            acc += per[seg][2]
            seg += 1
        a, b, L = per[seg]
        u = (target - acc) / L
        x = a[0] + (b[0] - a[0]) * u
        y = a[1] + (b[1] - a[1]) * u
        c = board_to_world(x, y, BOARD_H + 0.06)
        v, f = lib.blob((c.x, c.y, c.z), 0.045, rough=0.0, subdiv=2)
        Bl.add(v, f, col('#ffe7a8'))
    m = lib.NT('bulbs')
    cc = m.attr('col')
    m.bsdf(cc, 0.2, emission=cc, emission_strength=7.0)
    Bl.build('marquee_bulbs', m.mat)


def stands():
    """Low tiered stands either side of the rink, with seats in Showtime colours."""
    S = lib.MeshBuilder()
    rnd = random.Random(15)
    for side in (-1, 1):
        for tier, (y0, y1, z) in enumerate([(300, 460, 0.08), (500, 690, 0.08), (740, 900, 0.08)]):
            for row in range(3):
                x0 = CX + side * (HALF + 90 + row * 110)
                x1 = x0 + side * 90
                xa, xb = min(x0, x1), max(x0, x1)
                zt = z + row * 0.1
                for (yy0, yy1) in [(y0 + 6, y1 - 6)]:
                    a = board_to_world(xa, yy0, 0)
                    b = board_to_world(xb, yy1, 0)
                    v, f = lib.box(((a.x + b.x) / 2, (a.y + b.y) / 2, zt / 2), (b.x - a.x, abs(b.y - a.y), zt))
                    S.add(v, f, col('#3a2d66'))
                    # seat backs: a row of rounded seats along the back edge
                    for kk in range(int((yy1 - yy0) / 40)):
                        syy = yy0 + 20 + kk * 40
                        cc = board_to_world(xa + (xb - xa) * (0.8 if side < 0 else 0.2), syy, 0)
                        v, f = lib.box((cc.x, cc.y, zt + 0.08), (0.14, 0.26, 0.16))
                        S.add(v, f, col(rnd.choice([PINK, '#8e5cd9', '#3aa7e0', '#ffb020'])))
    S.build('stands', lib.attr_mat('stands_paint', rough=0.55, ao=0.5))


def stage_and_neon():
    """A small stage beyond the far boards under three neon arches, and spot towers in the corners."""
    St = lib.MeshBuilder()
    Ne = lib.MeshBuilder()
    Mt = lib.MeshBuilder()
    top = sy(CY_W - HALF)
    a = board_to_world(700, top - 40, 0)
    b = board_to_world(1220, top - 110, 0)
    v, f = lib.box(((a.x + b.x) / 2, (a.y + b.y) / 2, 0.12), (b.x - a.x, abs(b.y - a.y), 0.24))
    St.add(v, f, col('#402f70'))
    v, f = lib.box(((a.x + b.x) / 2, a.y - 0.02, 0.2), (b.x - a.x, 0.04, 0.04))
    St.add(v, f, col(GOLD))
    for k, (rad, c_) in enumerate([(2.5, PINK), (2.2, '#5ce1ff'), (1.9, GOLD)]):
        pts = []
        base = board_to_world(CX, top - 70 - k * 12, 0)
        for t in np.linspace(0, math.pi, 28):
            pts.append((base.x + math.cos(t) * rad, base.y, 0.25 + math.sin(t) * rad * 0.3))
        v, f = lib.tube(pts, 0.035, 8)
        Ne.add(v, f, col(c_))
    # a big four-point star over the stage, rimmed in bulbs
    c = board_to_world(CX, top - 48, 0)
    star = []
    for k in range(8):
        ang = k / 8 * math.tau - math.pi / 2
        r = 0.42 if k % 2 == 0 else 0.16
        star.append((c.x + math.cos(ang) * r, c.y, 0.72 - math.sin(ang) * r))
    star_c = (c.x, c.y, 0.72)
    St.add([star_c] + star, [(0, i + 1, (i + 1) % 8 + 1) for i in range(8)], col(GOLD))
    for (x, yy) in [(CX - HALF - 70, sy(CY_W - HALF) - 40), (CX + HALF + 70, sy(CY_W - HALF) - 40), (CX - HALF - 70, sy(CY_W + HALF) + 30), (CX + HALF + 70, sy(CY_W + HALF) + 30)]:
        cc = board_to_world(x, yy, 0)
        v, f = lib.cylinder((cc.x, cc.y, 0.0), 0.06, 0.05, 2.4, 10)
        Mt.add(v, f, col('#2a2f3a'))
        v, f = lib.box((cc.x, cc.y, 2.45), (0.5, 0.2, 0.24))
        Mt.add(v, f, col('#3a3f4c'))
        for kk in range(3):
            v, f = lib.blob((cc.x - 0.16 + kk * 0.16, cc.y - 0.11, 2.45), 0.06, rough=0.0, subdiv=2)
            Ne.add(v, f, col('#fff4dc'))
    St.build('stage', lib.attr_mat('stage_paint', rough=0.5, ao=0.4))
    Mt.build('towers', props.mats()['metal'])
    m = lib.NT('neon')
    cc = m.attr('col')
    m.bsdf(cc, 0.2, emission=cc, emission_strength=6.0)
    Ne.build('neon', m.mat)


def night_light():
    """Night: a deep blue sky fill, a big soft light over the ice, and coloured lights by the stands."""
    lib.world_light(0.35, zenith='#2a2f6a', horizon='#6a3a7a', ground='#1a1430')
    sc = bpy.context.scene
    ld = bpy.data.lights.new('rink_key', 'AREA')
    ld.shape = 'DISK'
    # ~3.5 W/m² on the ice below (a 14 m disc 9 m up: E = P / A * sin^2(38 deg)), like the day
    # arenas' sun, so the white ice holds its detail.
    ld.size = 14.0
    ld.energy = 1500.0
    ld.color = (1.0, 0.97, 0.94)
    ob = bpy.data.objects.new('rink_key', ld)
    sc.collection.objects.link(ob)
    ob.location = board_to_world(CX - 60, sy(CY_W) + 40, 9.0)
    ob.rotation_euler = (0.0, 0.0, 0.0)
    for (x, y, c_, e) in [(260, 560, (1.0, 0.45, 0.8), 220.0), (1660, 560, (0.45, 0.8, 1.0), 220.0), (960, 150, (1.0, 0.8, 0.5), 180.0)]:
        pl = bpy.data.lights.new('fill', 'POINT')
        pl.energy = e
        pl.color = c_
        pl.shadow_soft_size = 1.0
        po = bpy.data.objects.new('fill', pl)
        sc.collection.objects.link(po)
        po.location = board_to_world(x, y, 2.6)


def start_night(samples):
    C.set_view(ELEV)
    lib.reset(10 if A.preview else samples)
    C.dress.threads()
    C.dress.reset_mats()
    night_light()


def rink_scene():
    start_night(24)
    lib.camera_for_region(0, 0, SW, SH, scale=0.5 if A.preview else 1.0)
    bpy.context.scene.render.film_transparent = False
    floor_plane()
    region = (CX - HALF - 20, int(sy(CY_W - HALF)) - 20, CX + HALF + 20, int(sy(CY_W + HALF)) + 20)
    tex = os.path.join(C.OUT, 'ice.png')
    ice_texture(tex, region)
    ice_mesh(C.ground_image_material('ice', tex, region, rough=0.12, bump=0.05, ao=False))
    boards_and_bulbs()
    stands()
    stage_and_neon()
    if A.dry:
        print('rink scene built (dry run)')
        return
    path = os.path.join(C.OUT, 'rink.png')
    lib.render_to(path)
    C.publish(path, 'rink_arena', A.preview, blur=True)


# ------------------------------------------------------------------------------------------
def goal_model(side):
    """A goal frame (red posts and crossbar, white base) with a see-through net, at its side's spot."""
    Fr = lib.MeshBuilder()
    Nt = lib.MeshBuilder()
    nx, ny = {'l': (-1, 0), 'r': (1, 0), 't': (0, -1), 'b': (0, 1)}[side]
    tx, ty = -ny, nx
    off = HALF - GOAL_IN
    mx, my = CX + nx * off, CY_W + ny * off
    hw = GOAL_W / 2

    def W(x, y, z):
        return tuple(board_to_world(x, sy(y), z))
    p1 = (mx + tx * hw, my + ty * hw)
    p2 = (mx - tx * hw, my - ty * hw)
    b1 = (p1[0] + nx * GOAL_D, p1[1] + ny * GOAL_D)
    b2 = (p2[0] + nx * GOAL_D, p2[1] + ny * GOAL_D)
    H = 1.1
    Hb = 0.75
    red = col('#e8363f')
    for (x, y) in (p1, p2):
        v, f = lib.cylinder(W(x, y, 0.0), 0.045, 0.045, H, 12)
        Fr.add(v, f, red)
    v, f = lib.tube([W(p1[0], p1[1], H), W(p2[0], p2[1], H)], 0.045, 10)
    Fr.add(v, f, red)
    for (a, b) in [(p1, b1), (b1, b2), (b2, p2)]:
        v, f = lib.tube([W(a[0], a[1], 0.03), W(b[0], b[1], 0.03)], 0.03, 8)
        Fr.add(v, f, col('#f2f4f8'))
    for (a, b) in [(p1, b1), (p2, b2)]:
        v, f = lib.tube([W(a[0], a[1], H), W(b[0], b[1], Hb)], 0.025, 8)
        Fr.add(v, f, col('#f2f4f8'))
    v, f = lib.tube([W(b1[0], b1[1], Hb), W(b2[0], b2[1], Hb)], 0.025, 8)
    Fr.add(v, f, col('#f2f4f8'))
    # the net: back, top and sides
    quads = [
        [W(b1[0], b1[1], 0.03), W(b2[0], b2[1], 0.03), W(b2[0], b2[1], Hb), W(b1[0], b1[1], Hb)],
        [W(p1[0], p1[1], H), W(p2[0], p2[1], H), W(b2[0], b2[1], Hb), W(b1[0], b1[1], Hb)],
        [W(p1[0], p1[1], 0.03), W(b1[0], b1[1], 0.03), W(b1[0], b1[1], Hb), W(p1[0], p1[1], H)],
        [W(p2[0], p2[1], 0.03), W(b2[0], b2[1], 0.03), W(b2[0], b2[1], Hb), W(p2[0], p2[1], H)],
    ]
    for q in quads:
        Nt.add(q, [(0, 1, 2, 3)], col('#ffffff'))
    Fr.build(f'goal_{side}_frame', lib.attr_mat(f'goal_frame_{side}', rough=0.3))
    m = lib.NT(f'goal_net_{side}')
    pos = m.position()
    X, Y, Z = m.sep(pos)
    g1 = m.node('ShaderNodeTexWave')
    g1.wave_type = 'BANDS'
    g1.inputs['Scale'].default_value = 9.0
    m.link(pos, g1.inputs['Vector'])
    thread = m.maprange(g1.outputs['Fac'], 0.0, 0.18, 1.0, 0.0)
    g2 = m.node('ShaderNodeTexWave')
    g2.wave_type = 'BANDS'
    g2.bands_direction = 'Z'
    g2.inputs['Scale'].default_value = 9.0
    m.link(pos, g2.inputs['Vector'])
    thread2 = m.maprange(g2.outputs['Fac'], 0.0, 0.18, 1.0, 0.0)
    alpha = m.math('ADD', m.math('MAXIMUM', thread, thread2), 0.18, clamp=True)
    m.bsdf(col('#ffffff'), 0.6, alpha=alpha)
    Nt.build(f'goal_{side}_net', m.mat)


def sprites():
    for side in ('l', 'r', 't', 'b'):
        start_night(28)
        goal_model(side)
        x0, y0, w, h = GOAL_REGIONS[side]
        C.shadow_catcher((x0 - 40, y0 - 40, x0 + w + 40, y0 + h + 40))
        C.sprite_camera(x0, y0, w, h, scale=1.0)
        if A.dry:
            continue
        path = os.path.join(C.OUT, f'goal_{side}.png')
        lib.render_to(path)
        C.publish_sprite(path, f'rink_goal_{side}', A.preview, feather=14)
    # The puck: a black rubber disc with a soft sheen.
    start_night(40)
    c = board_to_world(960, 540, 0)
    v, f = lib.cylinder((c.x, c.y, 0.0), 0.15, 0.15, 0.07, 32)
    ob = lib.mesh_object('puck', v, f, smooth=True, material=lib.simple_mat('puck_rubber', '#16171d', rough=0.42, coat=0.3))
    C.sprite_camera(960 - 20, 540 - 20, 40, 40, scale=1.0)
    if not A.dry:
        path = os.path.join(C.OUT, 'puck.png')
        lib.render_to(path)
        C.publish_sprite(path, 'rink_puck', A.preview)
    return ob


if A.what in ('rink', 'all'):
    rink_scene()
if A.what in ('sprites', 'all'):
    sprites()
