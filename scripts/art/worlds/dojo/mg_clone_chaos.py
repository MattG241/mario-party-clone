"""Clone Chaos's arena: the rooftops of a mountain village at golden hour (Dojo Summit, Naruto's minigame).

    <bpy python> scripts/art/worlds/dojo/mg_clone_chaos.py [--preview] [--only back|village]
    python3 scripts/build-lite.py --image scene_dojo_roofs.webp

An original terraced village climbing a mountainside: three rows of houses with sweeping tiled roofs
on stone terraces, paper windows and lanterns glowing, blossom trees and pines, a watchtower on the
hill behind, far mountains with a waterfall, and in the foreground the wooden lookout deck the players
stand on. Two passes composited: the far mountains and sky (perspective) and the village (the house
orthographic projection at a 28 degree elevation, so the game's screen coordinates land on it exactly).

The clones stand on the roof ridges: SPOTS below (screen px) must match SPOTS in
src/game/worlds/dojo/games/cloneChaosLayout.ts. The players stand on the deck at y = DECK_FEET.
Writes public/assets/rendered/scene_dojo_roofs.webp (1920x1080, opaque).
"""
from __future__ import annotations

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mg_common as C  # noqa: E402
from mg_common import col, lib, dress, props, terrain  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

A = C.args()
PREVIEW = '--preview' in A
ONLY = A[A.index('--only') + 1] if '--only' in A else None
SW, SH = 1920, 1080
ELEV = 28.0

# Rows of houses, back to front: ground height (units), footprint centre (board y), ridge-top screen y
# (where the clones' feet go), the spots' screen x, house width (units), roof colour.
ROWS = [
    (2.2, 658, 340, [480, 800, 1120, 1440], 2.3, '#4f6f8f'),
    (1.0, 766, 545, [320, 640, 960, 1280, 1600], 2.45, '#9c4f3c'),
    (0.0, 900, 760, [560, 960, 1360], 3.0, '#4f6f8f'),
]
DEPTH = 1.7  # house depth (units)
DECK_BY = 972  # the deck's back edge (board y): its railing
DECK_FEET = 1040


def set_view(elev):
    lib.BETA = math.radians(90 - elev)
    lib.COSB, lib.SINB = math.cos(lib.BETA), math.sin(lib.BETA)


def W(bx, by, z=0.0):
    return lib.board_to_world(bx, by, z)


def ridge_top_z(by_c, y_screen):
    """Height whose projection over footprint centre by_c lands on screen row y_screen."""
    return (by_c - y_screen) / (lib.SINB * lib.PX)


class B:
    """Per-material builders for the village."""

    def __init__(self):
        self.m = {k: lib.MeshBuilder() for k in ('plaster', 'wood', 'roof', 'cap', 'stone', 'glow', 'paper', 'leaf', 'blossom', 'deck', 'cloth', 'metal', 'grass')}


# ------------------------------------------------------------------------------------------
def roof(b: B, x0, x1, y_front, y_back, y_mid, z_eave, z_ridge, colr):
    """A sweeping tiled roof: flat at the eaves, steep near the ridge, corners turned up."""
    N, M = 18, 8
    cr = col(colr)
    dark = lib.lerp_col(cr, col('#1b1f2c'), 0.35)
    for (ya, yb) in ((y_front, y_mid), (y_back, y_mid)):
        verts, faces = [], []
        for i in range(N + 1):
            u = i / N
            x = x0 + (x1 - x0) * u
            end = abs(2 * u - 1) ** 5
            for j in range(M + 1):
                v = j / M
                z = z_eave + (z_ridge - z_eave) * v ** 1.6 + end * (1 - v) ** 2 * 0.22
                y = ya + (yb - ya) * v
                verts.append((x, y, z))
        for i in range(N):
            for j in range(M):
                a = i * (M + 1) + j
                faces.append((a, a + M + 1, a + M + 2, a + 1))
        b.m['roof'].add(verts, faces, lambda vv, zr=z_ridge, ze=z_eave: lib.lerp_col(dark, cr, max(0.0, min(1.0, (vv[2] - ze) / max(0.01, zr - ze) * 0.6 + 0.4))))
    # a thick fascia along the front eave (toy-like slab edge)
    verts, faces = [], []
    for i in range(N + 1):
        u = i / N
        x = x0 + (x1 - x0) * u
        end = abs(2 * u - 1) ** 5
        z = z_eave + end * 0.22
        verts += [(x, y_front, z), (x, y_front - 0.02, z - 0.09)]
    for i in range(N):
        a = 2 * i
        faces.append((a, a + 2, a + 3, a + 1))
    b.m['cap'].add(verts, faces, col('#d9cdb4'))


def house(b: B, cx_px, row, rnd, idx):
    z_g, by_c, y_top, _, width, colr = ROWS[row]
    c = W(cx_px, by_c, z_g)
    X, Y = c.x, c.y
    hw, hd = width / 2, DEPTH / 2
    z_cap = ridge_top_z(by_c, y_top)  # top of the ridge cap (where the clones stand)
    z_ridge = z_cap - 0.1
    # keep the roof pitch steeper than the camera (28 deg), so its back slope hides behind the ridge
    z_eave = z_g + min(0.8, (z_ridge - z_g) - 0.64)
    wh = z_eave - z_g
    # stone footing and plaster walls
    v, f = lib.box((X, Y, z_g + 0.06), (width + 0.06, DEPTH + 0.06, 0.12))
    b.m['stone'].add(v, f, col('#b3aa9c'))
    v, f = lib.box((X, Y, z_g + 0.12 + (z_eave - z_g - 0.12) / 2), (width, DEPTH, z_eave - z_g - 0.12))
    b.m['plaster'].add(v, f, col(rnd.choice(['#f1e6d0', '#ece0c6', '#f4ead8'])))
    # timber frame on the front face: posts, a lintel beam and a sill
    yf = Y - hd - 0.015
    for k in range(4):
        px = X - hw + 0.06 + k * (width - 0.12) / 3
        v, f = lib.box((px, yf, (z_g + z_eave) / 2 + 0.06), (0.08, 0.05, z_eave - z_g - 0.1))
        b.m['wood'].add(v, f, col('#5a3a28'))
    v, f = lib.box((X, yf, z_eave - 0.08), (width + 0.02, 0.06, 0.08))
    b.m['wood'].add(v, f, col('#5a3a28'))
    # paper windows (lit from inside) and a sliding door
    bays = [X - hw + 0.06 + (k + 0.5) * (width - 0.12) / 3 for k in range(3)]
    door = rnd.randint(0, 2)
    for k, bxw in enumerate(bays):
        if k == door:
            v, f = lib.box((bxw, yf - 0.01, z_g + wh * 0.42), (0.44, 0.03, wh * 0.72))
            b.m['wood'].add(v, f, col('#7a5236'))
            v, f = lib.box((bxw, yf - 0.02, z_g + wh * 0.44), (0.34, 0.02, wh * 0.56))
            b.m['paper'].add(v, f, col('#ffe2b0'))
        else:
            zc_, hh_ = z_g + wh * 0.55, wh * 0.38
            v, f = lib.box((bxw, yf - 0.01, zc_), (0.42, 0.03, hh_))
            b.m['paper'].add(v, f, col('#ffd9a0'))
            for q in (-0.07, 0.07):
                v, f = lib.box((bxw + q, yf - 0.03, zc_), (0.02, 0.02, hh_))
                b.m['wood'].add(v, f, col('#5a3a28'))
            v, f = lib.box((bxw, yf - 0.03, zc_), (0.42, 0.02, 0.02))
            b.m['wood'].add(v, f, col('#5a3a28'))
    # the roof and its ridge cap, with upturned ornaments at both ends
    ov = 0.26
    roof(b, X - hw - 0.3, X + hw + 0.3, Y - hd - ov, Y + hd + ov, Y, z_eave, z_ridge, colr)
    v, f = lib.box((X, Y, z_ridge + 0.05), (width + 0.2, 0.2, 0.12))
    b.m['cap'].add(v, f, col('#e8dcc2'))
    for s in (-1, 1):
        pts = [(X + s * (hw + 0.1 + 0.12 * t), Y, z_ridge + 0.08 + 0.26 * t ** 1.7) for t in [k / 5 for k in range(6)]]
        v, f = lib.tube(pts, lambda t: 0.07 - 0.035 * t, 7)
        b.m['cap'].add(v, f, col('#e8dcc2'))
    return (X, Y, z_eave)


def eave_lanterns(b: B, a, bpt, n=4, sag=0.28, colrs=('#ff6a4a', '#ffb347')):
    """A string of paper lanterns hung between two points."""
    pts = []
    for i in range(13):
        t = i / 12
        pts.append((a[0] + (bpt[0] - a[0]) * t, a[1] + (bpt[1] - a[1]) * t, a[2] + (bpt[2] - a[2]) * t - sag * 4 * t * (1 - t)))
    v, f = lib.tube(pts, 0.012, 4)
    b.m['wood'].add(v, f, col('#3a2a22'))
    for k in range(n):
        t = (k + 0.5) / n
        q = (a[0] + (bpt[0] - a[0]) * t, a[1] + (bpt[1] - a[1]) * t, a[2] + (bpt[2] - a[2]) * t - sag * 4 * t * (1 - t) - 0.1)
        v, f = lib.blob(q, 0.075, squash=(1, 1, 1.25), rough=0.02, subdiv=2)
        b.m['glow'].add(v, f, col(colrs[k % len(colrs)]))


def lifted(mbs, dz, fn, *a, **kw):
    """Run a terrain builder (which stands things on z = 0) and lift everything it added by dz."""
    ns = [len(mb.v) for mb in mbs]
    out = fn(*a, **kw)
    for mb, n in zip(mbs, ns):
        for i in range(n, len(mb.v)):
            x, y, z = mb.v[i]
            mb.v[i] = (x, y, z + dz)
    return out


def stairs(b: B, cx_px, by_front, z0, z1, steps=6, width=0.9):
    """A flight of stone steps climbing a terrace wall (screen x cx_px, front at board y by_front)."""
    c = W(cx_px, by_front, 0.0)
    run = 0.16
    for k in range(steps):
        z = z0 + (z1 - z0) * (k + 1) / steps
        y = c.y - (steps - k - 0.5) * run
        v, f = lib.box((c.x, y, (z0 + z) / 2), (width, run, z - z0))
        b.m['stone'].add(v, f, col('#c4bba9' if k % 2 else '#b5ac9a'))


def watchtower(b: B, cx_px, by, z0):
    """A three-tier lookout tower (original design) on the hill behind the village."""
    c = W(cx_px, by, z0)
    x, y = c.x, c.y
    z = z0
    for k, (w, h) in enumerate(((1.1, 0.8), (0.9, 0.7), (0.7, 0.6))):
        v, f = lib.box((x, y, z + h / 2), (w, w, h))
        b.m['plaster'].add(v, f, col('#efe2c8'))
        for sx in (-1, 1):
            v, f = lib.box((x + sx * (w / 2 - 0.04), y - w / 2 - 0.01, z + h / 2), (0.07, 0.04, h))
            b.m['wood'].add(v, f, col('#5a3a28'))
        v, f = lib.box((x, y - w / 2 - 0.02, z + h * 0.55), (w * 0.5, 0.03, h * 0.35))
        b.m['paper'].add(v, f, col('#ffd49a'))
        roof(b, x - w / 2 - 0.3, x + w / 2 + 0.3, y - w / 2 - 0.3, y + w / 2 + 0.3, y, z + h, z + h + 0.35, '#9c4f3c')
        z += h + 0.35
    v, f = lib.cylinder((x, y, z), 0.05, 0.02, 0.5, 8)
    b.m['metal'].add(v, f, col('#f2c14e'))


def village():
    set_view(ELEV)
    W_, H_ = (960, 540) if PREVIEW else (SW, SH)
    C.start(10 if PREVIEW else 22, W_, H_, transparent=True, exposure=-0.12)
    dress.festival_light(key=3.4, elev=34, az=-42, fill=0.72, angle=3.0, key_col='#ffd6a2', zenith='#8fb2f0', horizon='#ffd9b8', ground='#a89a88')
    lib.camera_for_region(0, 0, SW, SH, scale=0.5 if PREVIEW else 1.0)
    rnd = random.Random(11)
    b = B()
    L, R = W(-200, 0).x, W(SW + 200, 0).x

    def slab(by_front, by_back, z_top, z_bot, colr, key='stone'):
        yf, yb = W(0, by_front).y, W(0, by_back).y
        v, f = lib.box(((L + R) / 2, (yf + yb) / 2, (z_top + z_bot) / 2), (R - L, abs(yb - yf), z_top - z_bot))
        b.m[key].add(v, f, col(colr))

    # ground: the lane in front of the houses, two stone terraces and the hill behind
    slab(1120, 822, 0.0, -0.6, '#cfc3ab')
    slab(822, 712, 1.0, -0.6, '#b9ae98')
    slab(712, 600, 2.2, -0.6, '#b9ae98')
    # the grassy hill behind the top terrace
    hill = []
    for i in range(41):
        x = L + (R - L) * i / 40
        hill.append(x)
    verts, faces = [], []
    rows_h = [(600, 2.2), (588, 2.5), (566, 2.76), (540, 2.9), (500, 2.95)]
    for (byh, zh) in rows_h:
        yy = W(0, byh).y
        for i, x in enumerate(hill):
            verts.append((x, yy, zh + 0.12 * math.sin(i * 0.7) * (zh > 2.3)))
    n = len(hill)
    for r in range(len(rows_h) - 1):
        for i in range(n - 1):
            a = r * n + i
            faces.append((a, a + 1, a + n + 1, a + n))
    b.m['grass'].add(verts, faces, col('#6aa845'))
    # grass strips along the terrace edges
    for (byq, zq) in ((718, 1.0), (606, 2.2)):
        v, f = lib.box(((L + R) / 2, W(0, byq).y, zq + 0.01), (R - L, 0.2, 0.03))
        b.m['grass'].add(v, f, col('#74b04c'))
    # the houses
    eaves = []
    for r, (_, _, _, xs, _, _) in enumerate(ROWS):
        row_e = []
        for k, x in enumerate(xs):
            row_e.append(house(b, x, r, rnd, k))
        eaves.append(row_e)
    # lantern strings across the gaps between houses in each row
    for r, row_e in enumerate(eaves):
        hw = ROWS[r][4] / 2
        for (xa, ya, za), (xb, yb, zb) in zip(row_e, row_e[1:]):
            yfront = ya - DEPTH / 2 - 0.2
            eave_lanterns(b, (xa + hw + 0.25, yfront, za + 0.05), (xb - hw - 0.25, yfront, zb + 0.05), n=2, sag=0.18)
    # stairs at both ends of the terraces
    for x in (170, 1750):
        stairs(b, x, 822, 0.0, 1.0)
        stairs(b, x + 40, 712, 1.0, 2.2, steps=7)
    # trees: blossoms and pines at the edges and in the gaps (clear of the ridges and the leaps)
    leaf, wood, bloss = b.m['leaf'], b.m['wood'], b.m['blossom']
    for (x, by, z, s, kind) in [(70, 905, 0.0, 1.25, 'blossom'), (1860, 905, 0.0, 1.2, 'blossom'), (1690, 790, 1.0, 0.8, 'pine'),
                                (140, 668, 2.2, 1.0, 'pine'), (1790, 660, 2.2, 1.05, 'blossom'), (50, 560, 2.8, 1.3, 'pine'),
                                (300, 548, 2.9, 1.1, 'blossom'), (640, 545, 2.9, 0.95, 'pine'), (960, 545, 2.9, 1.0, 'blossom'),
                                (1280, 545, 2.9, 0.95, 'pine'), (1600, 548, 2.9, 1.1, 'blossom')]:
        if kind == 'pine':
            lifted([leaf, wood], z, terrain.tree_pine, leaf, wood, x, by, rnd, s)
        else:
            lifted([bloss, wood], z, terrain.tree_blossom, bloss, wood, x, by, rnd, s)
    # a row of shrubs along the hill's crest breaks its line (kept clear of the back row's clones)
    spots0 = ROWS[0][3]
    for x in range(20, SW, 95):
        if min(abs(x - sx) for sx in spots0) < 70:
            continue
        lifted([leaf], 2.9, terrain.bush, leaf, x + rnd.uniform(-20, 20), 536, rnd, rnd.uniform(1.1, 1.5))
    watchtower(b, 1775, 530, 2.9)
    # the lookout deck: planks, a railing at its back edge, and player-colour banners on the rail
    yd0, yd1 = W(0, DECK_BY).y, W(0, 1130).y
    for k in range(12):
        t0 = k / 12
        v, f = lib.box(((L + R) / 2, yd0 + (yd1 - yd0) * (t0 + 1 / 24), 0.04), (R - L, abs(yd1 - yd0) / 12 - 0.02, 0.08))
        b.m['deck'].add(v, f, col('#b07a48' if k % 2 else '#a06c3e'))
    for x in range(-40, SW + 80, 150):
        p = W(x, DECK_BY)
        v, f = lib.box((p.x, p.y, 0.3), (0.1, 0.1, 0.5))
        b.m['wood'].add(v, f, col('#6a4630'))
    for zz in (0.5, 0.28):
        v, f = lib.box(((L + R) / 2, W(0, DECK_BY).y, zz), (R - L, 0.07, 0.06))
        b.m['wood'].add(v, f, col('#7a5236'))
    for k, colr in enumerate(dress.PLAYER):
        x = 330 + k * 420
        p = W(x, DECK_BY)
        v = [(p.x - 0.28, p.y - 0.06, 0.5), (p.x + 0.28, p.y - 0.06, 0.5), (p.x + 0.28, p.y - 0.06, 0.18), (p.x, p.y - 0.06, 0.08), (p.x - 0.28, p.y - 0.06, 0.18)]
        b.m['cloth'].add(v, [(0, 1, 2, 3, 4)], col(colr))
    eave_lanterns(b, (L, yd0 - 0.02, 0.62), (R, yd0 - 0.02, 0.62), n=16, sag=0.05)
    # build everything
    mats = props.mats()
    walls = lib.attr_mat('cc_plaster', rough=0.85, ao=0.45)
    b.m['plaster'].build('plaster', walls)
    b.m['wood'].build('wood', mats['wood'])
    tiles = lib.NT('cc_tiles')
    pos = tiles.position()
    wv = tiles.node('ShaderNodeTexWave')
    wv.wave_type = 'BANDS'
    wv.bands_direction = 'X'
    wv.inputs['Scale'].default_value = 5.5
    wv.inputs['Distortion'].default_value = 0.0
    tiles.link(pos, wv.inputs['Vector'])
    tc = tiles.mult(tiles.attr('col'), tiles.mix(tiles.maprange(wv.outputs['Fac'], 0.2, 0.9), col('#a9adb8'), col('#ffffff')))
    tc = tiles.mult(tc, tiles.mix(tiles.ao(0.3, 6), col('#51506a'), col('#ffffff')))
    tiles.bsdf(tc, 0.5, normal=tiles.bump(wv.outputs['Fac'], 0.5, 0.03), coat=0.25)
    b.m['roof'].build('roof', tiles.mat)
    b.m['cap'].build('cap', lib.attr_mat('cc_cap', rough=0.6, ao=0.3))
    b.m['stone'].build('stone', mats['stone_big'])
    glow = lib.NT('cc_glow')
    gc = glow.attr('col')
    glow.bsdf(gc, 0.3, emission=gc, emission_strength=3.0)
    b.m['glow'].build('lanterns', glow.mat)
    paper = lib.NT('cc_paper')
    pc = paper.attr('col')
    paper.bsdf(pc, 0.7, emission=pc, emission_strength=1.1)
    b.m['paper'].build('paper', paper.mat)
    b.m['leaf'].build('leaf', lib.attr_mat('cc_leaf', rough=0.8, ao=0.5))
    b.m['blossom'].build('blossom', lib.attr_mat('cc_blossom', rough=0.7, ao=0.4, subsurface=0.15))
    b.m['deck'].build('deck', mats['wood'])
    b.m['cloth'].build('cloth', lib.attr_mat('cc_cloth', rough=0.8, sheen=0.4))
    b.m['metal'].build('metal', mats['metal'])
    b.m['grass'].build('grass', lib.attr_mat('cc_grass', rough=0.9, ao=0.4))
    png = os.path.join(C.OUT, 'roofs_village.png')
    lib.render_to(png)
    return png


# ------------------------------------------------------------------------------------------
def backdrop():
    """Far mountains, a waterfall and a golden-hour sky (perspective), behind the village."""
    W_, H_ = (960, 540) if PREVIEW else (SW, SH)
    sc = C.start(10 if PREVIEW else 20, W_, H_, transparent=False, exposure=-0.2)
    w = bpy.data.worlds.new('sky')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value = 0.0, 0.5
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, col('#ffcf96')
    els[1].position, els[1].color = 1.0, col('#3f72c8')
    els.new(0.25).color = col('#ffc9a8')
    els.new(0.55).color = col('#9cc0ea')
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.0
    sun.color = (1.0, 0.84, 0.66)
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = Vector((-0.7, -0.3, 0.4)).to_track_quat('Z', 'Y').to_euler()
    cd = bpy.data.cameras.new('cam')
    cd.lens = 32
    cd.clip_end = 5000
    co = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(co)
    sc.camera = co
    co.location = (0, 0, 0)
    co.rotation_euler = (math.radians(92), 0, 0)

    def hazed(name, colr, near_d, far_d, max_h):
        m = lib.NT(name)
        pos = m.position()
        n = m.noise(0.01, 4, 0.6, pos)
        c = m.mix(n.outputs['Fac'], col(colr), lib.lerp_col(col(colr), col('#ffffff'), 0.25))
        nz = m.sep(m.normal())[2]
        c = m.mix(m.maprange(nz, 0.55, 0.9), c, col('#5f9a4a'))
        bsdf = m.bsdf(c, 0.9)
        cdat = m.node('ShaderNodeCameraData')
        fac = m.maprange(cdat.outputs['View Distance'], near_d, far_d, 0.15, max_h, smooth=True)
        em = m.node('ShaderNodeEmission')
        em.inputs['Color'].default_value = col('#ffd9b4')
        em.inputs['Strength'].default_value = 1.0
        mx = m.node('ShaderNodeMixShader')
        m.link(fac, mx.inputs['Fac'])
        m.link(bsdf.outputs['BSDF'], mx.inputs[1])
        m.link(em.outputs['Emission'], mx.inputs[2])
        m.link(mx.outputs['Shader'], m.out.inputs['Surface'])
        return m.mat

    rnd = random.Random(4)
    mtn = lib.MeshBuilder()
    for (x, y, h, r) in [(-620, 1500, 520, 520), (-150, 1700, 640, 560), (380, 1600, 560, 520), (820, 1900, 600, 600),
                         (-980, 2200, 700, 700), (60, 2600, 820, 820), (1200, 2500, 700, 720)]:
        prof = [(r, -300.0), (r * 0.8, h * 0.2), (r * 0.45, h * 0.62), (r * 0.18, h * 0.9), (0.0, h)]
        v, f = lib.lathe(prof, 40, (x, y, -200), cap_bottom=False, cap_top=False)
        v = [(vx + 40 * math.sin(vz * 0.02 + vy * 0.01), vy, vz + 25 * math.sin(vx * 0.03)) for (vx, vy, vz) in v]
        mtn.add(v, f, (1, 1, 1, 1))
    mtn.build('mountains', hazed('mtn', '#6d7fa0', 900, 3200, 0.8))
    # clouds drifting at the mountains' feet and high above
    clouds = lib.MeshBuilder()
    for i in range(40):
        C.puff_cluster(clouds, (rnd.uniform(-1500, 1500), rnd.uniform(1100, 2400), rnd.uniform(-160, -60)), rnd.uniform(60, 110), 8, random.Random(i), flat=0.4)
    for (x, y, z, s) in [(-700, 1400, 620, 90), (500, 1500, 700, 110), (-200, 1600, 820, 70)]:
        C.puff_cluster(clouds, (x, y, z), s, 12, random.Random(int(x)), flat=0.6)
    clouds.build('clouds', C.cloud_material('bd_cloud', top='#ffffff', mid='#ffe9da', low='#c4b7d8', glow='#ffd2b0', glow_strength=0.15,
                                            z_low=-200, z_top=200, ao_tint='#b8a8d2'))
    # a waterfall down the middle mountain
    fv = [(-175, 1385, 190), (-135, 1385, 190), (-122, 1185, -60), (-188, 1185, -60)]
    lib.mesh_object('falls', fv, [(0, 1, 2, 3)], smooth=False, material=lib.falls_material('bd_falls', 420, -60))
    png = os.path.join(C.OUT, 'roofs_back.png')
    lib.render_to(png)
    return png


def compose(back_png, village_png):
    from PIL import Image
    back = Image.open(back_png).convert('RGBA').resize((SW, SH), Image.LANCZOS)
    vil = Image.open(village_png).convert('RGBA').resize((SW, SH), Image.LANCZOS)
    back.alpha_composite(vil)
    out = os.path.join(C.OUT, 'roofs.png')
    back.convert('RGB').save(out)
    if not PREVIEW:
        C.publish(out, 'scene_dojo_roofs.webp', rgb=True, quality=88)
    return out


if __name__ == '__main__':
    bp = os.path.join(C.OUT, 'roofs_back.png')
    vp = os.path.join(C.OUT, 'roofs_village.png')
    if ONLY in (None, 'back'):
        bp = backdrop()
    if ONLY in (None, 'village'):
        vp = village()
    if os.path.exists(bp) and os.path.exists(vp):
        compose(bp, vp)
