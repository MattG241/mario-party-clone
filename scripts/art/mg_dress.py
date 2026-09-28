"""Festival dressing and finishing for the minigame arenas (mg_arenas.py, gleam3d.py, scenes.py orbit).

Helpers shared by the arena scripts so every arena gets the same look:
  - house render settings for this shared machine (two render threads),
  - warm key / cool fill lighting,
  - atmospheric perspective (materials fade towards a haze colour with distance from the camera),
  - a richer island material (grass variation, clover, contact shading) and dense grass scatter,
  - festival props: player-colour banners and flags, tents, balloons, string lights, planters,
    stone lanterns, willows, carts, fruit crates, footbridges, pennant swags and soft clouds.
Coordinates are board / screen pixels (lib.board_to_world) unless a name says world units.
"""
from __future__ import annotations

import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import bpy
from mathutils import Vector

import lib
import props
import terrain
from lib import MeshBuilder, board_to_world, col

# Player colours and shapes (src/game/constants.ts): banners tie the arenas to the four players.
PLAYER = ['#22c3d6', '#ff6b5e', '#8bd346', '#ffb020']
SHAPES = ['circle', 'triangle', 'diamond', 'hexagon']
FESTIVE = ['#ff6b5e', '#f4b83b', '#1fa5a0', '#8e5cd9', '#5ce1ff', '#6cc24a']
CREAM = '#fff4dc'
DARKWOOD = '#5e3b22'


# ------------------------------------------------------------------------------------------
# Render settings and light
def threads(n: int = 2) -> None:
    """The art machine is shared: never render with more than two threads."""
    sc = bpy.context.scene
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = n


def festival_light(key: float = 3.4, elev: float = 50.0, az: float = -35.0, fill: float = 0.8, angle: float = 3.0,
                   key_col: str = '#ffe1b4', zenith: str = '#88bfff', horizon: str = '#ffe6c6', ground: str = '#a39c84'):
    """Warm late-afternoon key light over a cool blue sky fill (same directions as the old renders,
    so shadows baked into gameplay sprites still agree with the arenas)."""
    lib.world_light(fill, zenith=zenith, horizon=horizon, ground=ground)
    return lib.sun(energy=key, elevation=elev, azimuth=az, angle=angle, color=key_col)


def view_depth(cam, p) -> float:
    """Distance of world point p along the camera's view axis (what 'View Z Depth' reports)."""
    fwd = (cam.matrix_world.to_3x3() @ Vector((0.0, 0.0, -1.0))).normalized()
    return (Vector(p) - cam.matrix_world.translation).dot(fwd)


def depth_haze(near: float, far: float, amount: float, color: str = '#dcebf8', strength: float = 1.1, skip=(), only=None) -> None:
    """Atmospheric perspective: every material fades towards `color` between view depths near..far.
    Applied after the scene is built. Materials named in `skip` (or not in `only`, when given) and
    materials using alpha are left alone."""
    for mat in list(bpy.data.materials):
        if not mat.use_nodes or mat.name in skip or (only is not None and mat.name not in only):
            continue
        nt = mat.node_tree
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
        if out is None or not out.inputs['Surface'].links:
            continue
        if any(n.type == 'BSDF_PRINCIPLED' and (n.inputs['Alpha'].links or n.inputs['Alpha'].default_value < 0.999) for n in nt.nodes):
            continue
        src = out.inputs['Surface'].links[0].from_socket
        cd = nt.nodes.new('ShaderNodeCameraData')
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.interpolation_type = 'SMOOTHSTEP'
        nt.links.new(cd.outputs['View Z Depth'], mr.inputs['Value'])
        mr.inputs['From Min'].default_value = near
        mr.inputs['From Max'].default_value = far
        mr.inputs['To Min'].default_value = 0.0
        mr.inputs['To Max'].default_value = amount
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = col(color)
        em.inputs['Strength'].default_value = strength
        mx = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(mr.outputs['Result'], mx.inputs['Fac'])
        nt.links.new(src, mx.inputs[1])
        nt.links.new(em.outputs['Emission'], mx.inputs[2])
        nt.links.new(mx.outputs['Shader'], out.inputs['Surface'])


# ------------------------------------------------------------------------------------------
# Island ground
GRASS = [(0.24, '#1f6a22'), (0.38, '#2f8a2a'), (0.52, '#47a533'), (0.66, '#6cbd3c'), (0.8, '#98cf4c')]


def island_material(mask_path: str, name: str = 'island_rich', grass=None, trail=None):
    """Grass top with broad colour drifts, clover and tiny flower speckles, contact shading around
    everything standing on it, and a layered rock underside that cools and darkens with depth."""
    m = lib.NT(name)
    pos = m.position()
    nz = m.sep(m.normal())[2]
    X, Y, Z = m.sep(pos)
    # optional trail mask (world -> canvas uv, as terrain.island_material)
    mp = m.node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (lib.PX / terrain.W, lib.COSB * lib.PX / terrain.H, 1.0)
    mp.inputs['Location'].default_value = (0.0, 1.0, 0.0)
    m.link(pos, mp.inputs['Vector'])
    img = m.node('ShaderNodeTexImage')
    img.image = bpy.data.images.load(mask_path)
    img.image.colorspace_settings.name = 'Non-Color'
    img.extension = 'EXTEND'
    m.link(mp.outputs['Vector'], img.inputs['Vector'])
    pv = m.sep(img.outputs['Color'])[0]
    pm = m.maprange(pv, 0.25, 0.65)
    # grass: broad drifts + mid noise, then clover clumps and flower speckles
    n1 = m.noise(0.55, 5, 0.62, pos)
    n2 = m.noise(4.5, 3, 0.5, pos)
    gfac = m.math('ADD', m.math('MULTIPLY', n1.outputs['Fac'], 0.85), m.math('MULTIPLY', n2.outputs['Fac'], 0.3))
    grass_c = m.ramp(gfac, grass or GRASS)
    clover = m.voronoi(9.0, pos)
    cl = m.math('MULTIPLY', m.maprange(clover.outputs['Distance'], 0.16, 0.05), m.maprange(m.noise(1.3, 2, 0.5, pos).outputs['Fac'], 0.52, 0.66))
    grass_c = m.mix(m.math('MULTIPLY', cl, 0.55), grass_c, col('#3d9a36'))
    dry = m.maprange(m.noise(0.9, 3, 0.6, pos).outputs['Fac'], 0.6, 0.78)
    grass_c = m.mix(m.math('MULTIPLY', dry, 0.35), grass_c, col('#b7c85a'))
    sp = m.voronoi(38.0, pos)
    spk = m.math('MULTIPLY', m.maprange(sp.outputs['Distance'], 0.1, 0.04), m.maprange(m.noise(2.2, 2, 0.5, pos).outputs['Fac'], 0.6, 0.72))
    spc = m.mix(m.maprange(sp.outputs['Color'], 0.0, 1.0), col('#fff6d8'), col('#ffd35a'))
    grass_c = m.mix(m.math('MULTIPLY', spk, 0.8), grass_c, spc)
    # trail (if any)
    d1 = m.noise(2.2, 4, 0.6, pos)
    dirt = m.ramp(d1.outputs['Fac'], trail or [(0.3, '#c98f4f'), (0.5, '#dcab6a'), (0.7, '#ebc38a')])
    top = m.mix(pm, grass_c, dirt)
    # rock underside
    wave = m.node('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 1.4
    wave.inputs['Distortion'].default_value = 6.0
    wave.inputs['Detail'].default_value = 3.0
    m.link(pos, wave.inputs['Vector'])
    rn = m.noise(1.8, 6, 0.6, pos)
    rf = m.math('ADD', m.math('MULTIPLY', wave.outputs['Fac'], 0.55), m.math('MULTIPLY', rn.outputs['Fac'], 0.5))
    rock = m.ramp(rf, [(0.25, '#5a3d3a'), (0.4, '#7d5341'), (0.55, '#9d6c4c'), (0.7, '#6e5566'), (0.85, '#8a7a8e')])
    soil = m.ramp(rn.outputs['Fac'], [(0.3, '#62391f'), (0.7, '#855331')])
    rock = m.mix(m.maprange(Z, -0.55, -0.1), rock, soil)
    rock = m.mult(rock, m.mix(m.maprange(Z, -4.5, -0.5, 0.0, 1.0, smooth=False), col('#5d5a8c'), col('#ffffff')))
    rock = m.mult(rock, m.mix(m.ao(0.9, 8), col('#3a3048'), col('#ffffff')))
    gn = m.noise(8.0, 2, 0.5, pos)
    wrap = m.math('ADD', nz, m.math('MULTIPLY', m.math('SUBTRACT', gn.outputs['Fac'], 0.5), 0.9))
    lipz = m.maprange(Z, -0.28, -0.02)
    grassfac = m.math('MAXIMUM', m.maprange(wrap, 0.55, 0.8), m.math('MULTIPLY', lipz, m.maprange(gn.outputs['Fac'], 0.45, 0.6)))
    c = m.mix(grassfac, rock, top)
    # contact shading: grass darkens (and cools) where props, fences and walls stand
    c = m.mult(c, m.mix(m.ao(1.1, 12), col('#51604a'), col('#ffffff')))
    bump = m.bump(m.math('ADD', rn.outputs['Fac'], m.math('MULTIPLY', gfac, 0.25)), 0.35, 0.08)
    m.bsdf(c, m.math('ADD', m.math('MULTIPLY', grassfac, 0.1), 0.78), normal=bump, sheen=0.3)
    return m.mat


def empty_mask(out_dir: str) -> str:
    path = os.path.join(out_dir, 'empty_mask.png')
    Image.new('L', (64, 64), 0).save(path)
    return path


class Keep:
    """Keep-out zones (screen px) for scatter: rectangles and ellipses."""

    def __init__(self):
        self.rects, self.ells = [], []

    def rect(self, x0, y0, x1, y1):
        self.rects.append((x0, y0, x1, y1))
        return self

    def ell(self, cx, cy, rx, ry):
        self.ells.append((cx, cy, rx, ry))
        return self

    def hit(self, x, y) -> bool:
        if any(x0 <= x <= x1 and y0 <= y <= y1 for (x0, y0, x1, y1) in self.rects):
            return True
        return any(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0 for (cx, cy, rx, ry) in self.ells)


def poly_mask(outline, w: int = 1920, h: int = 1080, shrink: int = 20):
    """Boolean test 'inside the island top, at least `shrink` px from its rim' (screen px)."""
    img = Image.new('L', (w // 4, h // 4), 0)
    ImageDraw.Draw(img).polygon([(x / 4, y / 4) for x, y in outline], fill=255)
    if shrink > 0:
        img = img.filter(ImageFilter.MinFilter(max(3, (shrink // 4) * 2 + 1)))
    arr = np.asarray(img) > 128

    def inside(x, y):
        gx, gy = int(x / 4), int(y / 4)
        return 0 <= gy < arr.shape[0] and 0 <= gx < arr.shape[1] and bool(arr[gy, gx])
    return inside


def scatter_grass(inside, keep: Keep, region, rnd, tufts: int = 2200, flowers: int = 40, pebbles: int = 0, scale=(0.9, 1.5)):
    """Dense grass tufts, flower beds and pebbles over the island top, clear of keep-out zones."""
    x0, y0, x1, y1 = region
    grass, fl, lv, rk = MeshBuilder(), MeshBuilder(), MeshBuilder(), MeshBuilder()

    def pick():
        for _ in range(40):
            x, y = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
            if inside(x, y) and not keep.hit(x, y):
                return x, y
        return None
    for _ in range(tufts):
        q = pick()
        if q:
            terrain.grass_tuft(grass, q[0], q[1], rnd, rnd.uniform(*scale))
    for _ in range(flowers):
        q = pick()
        if q:
            terrain.flower_bed(fl, lv, q[0], q[1], rnd, count=rnd.randint(5, 11))
    for _ in range(pebbles):
        q = pick()
        if q:
            terrain.rock(rk, q[0], q[1], rnd, rnd.uniform(0.25, 0.55), moss=rnd.random() < 0.5)
    grass.build('scatter_grass', lib.attr_mat('scatter_grass', rough=0.8, sheen=0.2, ao=0.3), smooth=False)
    fl.build('scatter_flowers', lib.attr_mat('scatter_flowers', rough=0.55, subsurface=0.2))
    lv.build('scatter_leaves', lib.attr_mat('scatter_leaves', rough=0.78, ao=0.5))
    rk.build('scatter_rocks', props.mats()['stone'])


# ------------------------------------------------------------------------------------------
# Materials
_M: dict = {}


def mats() -> dict:
    """Extra materials (cleared with the scene: call reset_mats() after lib.reset)."""
    if not _M:
        _M['cloth'] = lib.attr_mat('fest_cloth', rough=0.8, sheen=0.45, ao=0.35)
        _M['gloss'] = _gloss()
        _M['leaf'] = lib.attr_mat('fest_leaf', rough=0.78, ao=0.5)
        _M['flower'] = lib.attr_mat('fest_flower', rough=0.55, subsurface=0.2)
    return _M


def reset_mats() -> None:
    _M.clear()
    props._MATS.clear()


def _gloss():
    m = lib.NT('fest_gloss')
    c = m.attr('col')
    m.bsdf(c, 0.25, coat=0.8, spec=0.5, subsurface=0.1)
    return m.mat


# ------------------------------------------------------------------------------------------
# Shapes
def shape_pts(kind: str, r: float, n: int = 24):
    """2D outline (x, z) of a player shape centred on the origin."""
    if kind == 'circle':
        return [(math.cos(k / n * math.tau) * r, math.sin(k / n * math.tau) * r) for k in range(n)]
    if kind == 'triangle':
        return [(math.cos(math.pi / 2 + k / 3 * math.tau) * r * 1.15, math.sin(math.pi / 2 + k / 3 * math.tau) * r * 1.15 - r * 0.15) for k in range(3)]
    if kind == 'diamond':
        return [(0.0, r * 1.15), (r * 0.85, 0.0), (0.0, -r * 1.15), (-r * 0.85, 0.0)]
    return [(math.cos(k / 6 * math.tau) * r, math.sin(k / 6 * math.tau) * r) for k in range(6)]


def flat_poly(mb, pts2, origin, color, normal_y: float = -1.0):
    """A flat polygon in the XZ plane at world `origin` (x, y, z), facing -Y (the camera)."""
    ox, oy, oz = origin
    v = [(ox + x, oy, oz + z) for (x, z) in pts2]
    n = len(v)
    v.append((ox, oy, oz))
    f = [(n, k, (k + 1) % n) if normal_y < 0 else (n, (k + 1) % n, k) for k in range(n)]
    mb.add(v, f, col(color))


def cloth_panel(mb, pts2, origin, color, thick: float = 0.02):
    """Two-sided flat cloth in the XZ plane (front faces -Y)."""
    ox, oy, oz = origin
    n = len(pts2)
    v = [(ox + x, oy, oz + z) for (x, z) in pts2] + [(ox + x, oy + thick, oz + z) for (x, z) in pts2]
    front = tuple(range(n - 1, -1, -1))
    back = tuple(n + k for k in range(n))
    mb.add(v, [front, back], col(color))


# ------------------------------------------------------------------------------------------
# Festival props (board px anchors; s = size factor)
def flag_pole(bx, by, color, s=1.0, height=2.0, side=1, swallow=True, shape=None, name='flagpole', z0=0.0):
    """Tall pole with a waving pennant (optionally with a player shape on it) and a gold finial.
    z0 lifts the pole's foot (world units) for decks and balconies."""
    P = props.Prop(name)
    p = board_to_world(bx, by, 0.0)
    p = Vector((p.x, p.y, z0))
    H = z0 + height * s
    v, f = lib.cylinder((p.x, p.y, z0), 0.04 * s, 0.03 * s, height * s, 8)
    P.b['wood'].add(v, f, col(DARKWOOD))
    v, f = lib.blob((p.x, p.y, H + 0.05 * s), 0.07 * s, rough=0.0, subdiv=2)
    P.b['metal'].add(v, f, col('#f2c14e'))
    L, W = 0.95 * s, 0.5 * s
    rows = 8
    pts_top, pts_bot = [], []
    for k in range(rows + 1):
        t = k / rows
        wave = math.sin(t * 2.6 + 0.6) * 0.07 * s * t
        pts_top.append((t * L, H - 0.06 * s + wave))
        w = W * (1 - 0.18 * t)
        pts_bot.append((t * L, H - 0.06 * s - w + wave))
    outline = pts_top + ([(L * 0.8, (pts_top[-1][1] + pts_bot[-1][1]) / 2)] if swallow else []) + pts_bot[::-1]
    outline = [(x * side, z) for (x, z) in outline]
    cloth_panel(P.b['paint'], outline, (p.x, p.y, 0.0), color, 0.015 * s)
    if shape:
        cx = side * L * 0.42
        cz = H - 0.06 * s - W * 0.46 + math.sin(0.42 * 2.6 + 0.6) * 0.07 * s * 0.42
        flat_poly(P.b['paint'], shape_pts(shape, 0.13 * s), (p.x + cx, p.y - 0.012 * s, cz), CREAM)
    return P.build()


def banner_post(bx, by, color, s=1.0, shape=None, height=2.3, w=0.62, h=1.05, name='banner'):
    """A post with a crossbar and a hanging swallowtail banner (player colour + white shape)."""
    P = props.Prop(name)
    p = board_to_world(bx, by, 0.0)
    H = height * s
    v, f = lib.cylinder((p.x, p.y + 0.05 * s, 0.0), 0.045 * s, 0.035 * s, H, 8)
    P.b['wood'].add(v, f, col(DARKWOOD))
    v, f = lib.box((p.x, p.y, H - 0.08 * s), (w * s + 0.16 * s, 0.05 * s, 0.05 * s))
    P.b['metal'].add(v, f, col('#e0a93f'))
    for dx in (-1, 1):
        v, f = lib.blob((p.x + dx * (w * s / 2 + 0.1 * s), p.y, H - 0.08 * s), 0.045 * s, rough=0.0, subdiv=1)
        P.b['metal'].add(v, f, col('#f2c14e'))
    W, Hh = w * s, h * s
    top = H - 0.11 * s
    out = [(-W / 2, top), (W / 2, top), (W / 2, top - Hh), (0.0, top - Hh + 0.22 * s), (-W / 2, top - Hh)]
    cloth_panel(P.b['paint'], out, (p.x, p.y - 0.03 * s, 0.0), color, 0.015 * s)
    # a gold band along the top and the player's shape in cream
    cloth_panel(P.b['paint'], [(-W / 2, top), (W / 2, top), (W / 2, top - 0.07 * s), (-W / 2, top - 0.07 * s)], (p.x, p.y - 0.036 * s, 0.0), '#f2c14e', 0.004)
    if shape:
        flat_poly(P.b['paint'], shape_pts(shape, 0.17 * s), (p.x, p.y - 0.045 * s, top - Hh * 0.42), CREAM)
    return P.build()


def tent(bx, by, s=1.0, c1='#ff6b5e', c2=CREAM, sides=8, name='tent'):
    """Festival pavilion: striped conical roof with a scalloped valance, open front, pennant on top."""
    P = props.Prop(name)
    p = board_to_world(bx, by, 0.0)
    R, Hw, Hr = 0.95 * s, 1.05 * s, 0.85 * s
    # posts
    for k in range(sides):
        a = k / sides * math.tau
        v, f = lib.cylinder((p.x + math.cos(a) * R, p.y + math.sin(a) * R, 0.0), 0.035 * s, 0.035 * s, Hw, 6)
        P.b['wood'].add(v, f, col(DARKWOOD))
    # back and side walls (the front stays open so it reads as a pavilion)
    for k in range(sides):
        a0, a1 = k / sides * math.tau, (k + 1) / sides * math.tau
        mid = (a0 + a1) / 2
        if math.sin(mid) < -0.2:
            continue
        q0 = (p.x + math.cos(a0) * R * 0.99, p.y + math.sin(a0) * R * 0.99)
        q1 = (p.x + math.cos(a1) * R * 0.99, p.y + math.sin(a1) * R * 0.99)
        v = [(q0[0], q0[1], 0.0), (q1[0], q1[1], 0.0), (q1[0], q1[1], Hw), (q0[0], q0[1], Hw)]
        P.b['paint'].add(v, [(0, 1, 2, 3), (3, 2, 1, 0)], col(c2 if k % 2 else c1))
    # roof gores
    apex = (p.x, p.y, Hw + Hr)
    for k in range(sides * 2):
        a0, a1 = k / (sides * 2) * math.tau, (k + 1) / (sides * 2) * math.tau
        r0 = (p.x + math.cos(a0) * R * 1.12, p.y + math.sin(a0) * R * 1.12, Hw - 0.04 * s)
        r1 = (p.x + math.cos(a1) * R * 1.12, p.y + math.sin(a1) * R * 1.12, Hw - 0.04 * s)
        mid = (a0 + a1) / 2
        sag = (p.x + math.cos(mid) * R * 0.62, p.y + math.sin(mid) * R * 0.62, Hw + Hr * 0.38 - 0.05 * s)
        v = [apex, r0, sag, r1]
        P.b['paint'].add(v, [(0, 1, 2), (0, 2, 3), (2, 1, 0), (3, 2, 0)], col(c1 if k % 2 == 0 else c2))
        # scalloped valance flap
        mid_r = (p.x + math.cos(mid) * R * 1.13, p.y + math.sin(mid) * R * 1.13, Hw - 0.2 * s)
        P.b['paint'].add([r0, r1, mid_r], [(0, 1, 2), (2, 1, 0)], col(c1 if k % 2 == 0 else c2))
    v, f = lib.cylinder((apex[0], apex[1], apex[2] - 0.05), 0.02 * s, 0.02 * s, 0.45 * s, 6)
    P.b['wood'].add(v, f, col(DARKWOOD))
    tri = [(apex[0], apex[1], apex[2] + 0.38 * s), (apex[0], apex[1], apex[2] + 0.2 * s), (apex[0] + 0.32 * s, apex[1], apex[2] + 0.29 * s)]
    P.b['paint'].add(tri, [(0, 1, 2), (2, 1, 0)], col('#f2c14e'))
    v, f = lib.blob((apex[0], apex[1], apex[2] + 0.42 * s), 0.045 * s, rough=0.0, subdiv=1)
    P.b['metal'].add(v, f, col('#f2c14e'))
    # a counter with goods inside the open front
    v, f = lib.box((p.x, p.y - R * 0.55, 0.36 * s), (R * 1.1, 0.26 * s, 0.72 * s))
    P.b['wood'].add(v, f, col('#b07a45'))
    rnd = random.Random(int(bx * 7 + by))
    for k in range(5):
        gx = p.x - R * 0.42 + k * R * 0.21
        v, f = lib.blob((gx, p.y - R * 0.58, 0.78 * s), 0.06 * s, squash=(1, 1, 0.9), rough=0.1, subdiv=1, seed=k)
        P.b['paint'].add(v, f, col(rnd.choice(['#ff5a4a', '#ffd23f', '#8bd346', '#ff9ecb', '#5ce1ff'])))
    return P.build()


def balloons(bx, by, s=1.0, colors=None, n=4, name='balloons'):
    """A bunch of glossy balloons on strings tied to a small weight."""
    rnd = random.Random(int(bx * 3 + by * 5))
    colors = colors or FESTIVE
    p = board_to_world(bx, by, 0.0)
    body, string = MeshBuilder(), MeshBuilder()
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.06 * s, 0.05 * s, 0.12 * s, 8)
    string.add(v, f, col('#6b6f7a'))
    for k in range(n):
        a = k / n * math.tau + rnd.uniform(-0.3, 0.3)
        d = rnd.uniform(0.12, 0.3) * s
        hz = rnd.uniform(1.35, 1.85) * s
        c = (p.x + math.cos(a) * d, p.y + math.sin(a) * d * 0.6, hz)
        r = rnd.uniform(0.17, 0.22) * s
        v, f = lib.blob(c, r, squash=(1.0, 1.0, 1.18), rough=0.0, subdiv=3)
        body.add(v, f, col(colors[k % len(colors)]))
        v, f = lib.cylinder((c[0], c[1], hz - r * 1.18 - 0.03 * s), 0.025 * s, 0.01 * s, 0.05 * s, 6)
        body.add(v, f, col(colors[k % len(colors)]))
        v, f = lib.tube([(p.x, p.y, 0.1 * s), ((p.x + c[0]) / 2 + 0.03, (p.y + c[1]) / 2, hz * 0.5), (c[0], c[1], hz - r * 1.2)], 0.006 * s, 4)
        string.add(v, f, col('#f4ecdc'))
    body.build(name, mats()['gloss'])
    string.build(name + '_str', props.mats()['wood'])


def string_lights(points, sag=0.3, bulbs=10, s=1.0, colors=('#ffd27a', '#ffb347', '#fff1b8'), name='lights'):
    """A catenary of warm bulbs through world points [(x, y, z), ...]."""
    wire, glow = MeshBuilder(), MeshBuilder()
    for a, b in zip(points, points[1:]):
        a, b = Vector(a), Vector(b)
        pts = []
        for i in range(17):
            t = i / 16
            q = a + (b - a) * t
            pts.append((q.x, q.y, q.z - math.sin(t * math.pi) * sag))
        v, f = lib.tube(pts, 0.01 * s, 4)
        wire.add(v, f, col('#3a2e2a'))
        for k in range(bulbs):
            t = (k + 0.5) / bulbs
            q = a + (b - a) * t
            v, f = lib.blob((q.x, q.y, q.z - math.sin(t * math.pi) * sag - 0.06 * s), 0.045 * s, squash=(1, 1, 1.25), rough=0.0, subdiv=1)
            glow.add(v, f, col(colors[k % len(colors)]))
    wire.build(name + '_wire', props.mats()['wood'])
    glow.build(name + '_bulbs', props.mats()['glow'])


def planter(bx, by, w=1.2, s=1.0, rot=0.0, rnd=None, name='planter', z0=0.0):
    """Wooden planter box heaped with flowers and leaves (z0 lifts it onto a deck)."""
    rnd = rnd or random.Random(int(bx + by * 3))
    p = board_to_world(bx, by, 0.0)
    wood, fl, lv = MeshBuilder(), MeshBuilder(), MeshBuilder()
    v, f = lib.box((p.x, p.y, 0.14 * s), (w * s, 0.34 * s, 0.28 * s), rot_z=rot)
    wood.add(v, f, col('#9a643a'))
    v, f = lib.box((p.x, p.y, 0.285 * s), (w * s + 0.04, 0.38 * s, 0.03 * s), rot_z=rot)
    wood.add(v, f, col('#6e4a2c'))
    cs = rnd.sample(terrain.FLOWERS, 3)
    ca, sa = math.cos(rot), math.sin(rot)
    for k in range(int(9 * w)):
        u = rnd.uniform(-0.45, 0.45) * w * s
        t = rnd.uniform(-0.1, 0.1) * s
        x, y = p.x + u * ca - t * sa, p.y + u * sa + t * ca
        v, f = lib.blob((x, y, 0.31 * s), rnd.uniform(0.07, 0.1) * s, squash=(1.2, 1.0, 0.7), rough=0.2, subdiv=1, seed=k)
        lv.add(v, f, col(rnd.choice(['#2f8a2c', '#3f9b33', '#4aa83a'])))
        if rnd.random() < 0.8:
            terrain.flower(fl, x + rnd.uniform(-0.03, 0.03), y, 0.36 * s + rnd.uniform(0, 0.05), col(rnd.choice(cs)), 0.045 * s)
    for mb in (wood, fl, lv):
        mb.v = [(x, y, z + z0) for (x, y, z) in mb.v]
    wood.build(name, props.mats()['wood'])
    fl.build(name + '_fl', mats()['flower'])
    lv.build(name + '_lv', mats()['leaf'])


def pennant_swag(a, b, sag=0.2, n=6, size=0.2, colors=None, name='swag', offset=0):
    """A rope between world points a and b with a row of triangular pennants hanging from it."""
    colors = colors or FESTIVE
    cloth, rope = MeshBuilder(), MeshBuilder()
    a, b = Vector(a), Vector(b)
    pts = []
    for i in range(2 * n + 1):
        t = i / (2 * n)
        q = a + (b - a) * t
        pts.append((q.x, q.y, q.z - math.sin(t * math.pi) * sag))
    v, f = lib.tube(pts, 0.008 * max(0.6, size / 0.2), 4)
    rope.add(v, f, col('#6b4a2a'))
    for j in range(n):
        p0, p1 = Vector(pts[2 * j]), Vector(pts[2 * j + 2])
        mid = (p0 + p1) / 2
        tri = [tuple(p0), tuple(p1), (mid.x, mid.y - 0.005, mid.z - size)]
        cloth.add(tri, [(0, 1, 2), (2, 1, 0)], col(colors[(j + offset) % len(colors)]))
    cloth.build(name, mats()['cloth'])
    rope.build(name + '_rope', props.mats()['wood'])


def stone_lantern(bx, by, s=1.0, name='stone_lantern'):
    """Pagoda-style stone lantern with a warm glowing firebox."""
    P = props.Prop(name)
    p = board_to_world(bx, by, 0.0)
    x, y = p.x, p.y
    v, f = lib.lathe([(0.26 * s, 0.0), (0.26 * s, 0.08 * s), (0.2 * s, 0.12 * s), (0.0, 0.12 * s)], 6, (x, y, 0))
    P.b['stone'].add(v, f, col('#c9c0b2'))
    v, f = lib.cylinder((x, y, 0.12 * s), 0.08 * s, 0.07 * s, 0.42 * s, 8)
    P.b['stone'].add(v, f, col('#d4ccc0'))
    v, f = lib.lathe([(0.2 * s, 0.54 * s), (0.2 * s, 0.6 * s), (0.0, 0.6 * s)], 6, (x, y, 0))
    P.b['stone'].add(v, f, col('#c9c0b2'))
    v, f = lib.box((x, y, 0.72 * s), (0.26 * s, 0.26 * s, 0.24 * s))
    P.b['stone'].add(v, f, col('#d8d0c4'))
    v, f = lib.box((x, y - 0.12 * s, 0.72 * s), (0.14 * s, 0.03 * s, 0.14 * s))
    P.b['glow'].add(v, f, col('#ffc76a'))
    v, f = lib.box((x + 0.12 * s, y, 0.72 * s), (0.03 * s, 0.14 * s, 0.14 * s))
    P.b['glow'].add(v, f, col('#ffc76a'))
    v, f = lib.lathe([(0.34 * s, 0.84 * s), (0.36 * s, 0.88 * s), (0.2 * s, 0.98 * s), (0.04 * s, 1.04 * s), (0.0, 1.04 * s)], 6, (x, y, 0), cap_bottom=True)
    P.b['stone'].add(v, f, col('#bdb4a6'))
    v, f = lib.blob((x, y, 1.08 * s), 0.05 * s, rough=0.0, subdiv=1)
    P.b['stone'].add(v, f, col('#bdb4a6'))
    return P.build()


def willow(mb_leaf, mb_wood, bx, by, rnd, s=1.0):
    """Weeping willow: leaning trunk, a soft crown and long drooping strands."""
    p = board_to_world(bx, by, 0.0)
    h = 1.9 * s
    v, f = lib.cylinder((p.x, p.y, 0.0), 0.15 * s, 0.09 * s, h * 0.75, sides=10)
    v = [(x + 0.08 * z, y, z) for (x, y, z) in v]
    mb_wood.add(v, f, lambda q: lib.lerp_col(col('#5e3b22'), col('#86593a'), min(1.0, q[2] / h)))
    cx, cy, cz = p.x + 0.08 * h * 0.75, p.y, h * 0.85
    low, high = col('#2f6f2a'), col('#86c04e')
    for k in range(7):
        a = k / 7 * math.tau + rnd.uniform(-0.2, 0.2)
        r = rnd.uniform(0.32, 0.46) * s
        c = (cx + math.cos(a) * 0.42 * s, cy + math.sin(a) * 0.28 * s, cz + rnd.uniform(-0.05, 0.16) * s)
        v, f = lib.blob(c, r, squash=(1.15, 1.0, 0.62), rough=0.22, freq=2.2, subdiv=2, seed=rnd.random() * 40)
        mb_leaf.add(v, f, lambda q, zc=c[2], r=r: lib.lerp_col(low, high, max(0.0, min(1.0, (q[2] - zc) / r + 0.5))))
    # long, thin weeping fronds: many narrow leaf blades overlapping down each strand
    for k in range(56):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(0.3, 0.78) * s
        x0, y0 = cx + math.cos(a) * d, cy + math.sin(a) * d * 0.7
        z0 = cz + rnd.uniform(-0.1, 0.12) * s
        L = rnd.uniform(0.75, 1.3) * s
        n = 11
        for j in range(n):
            t = j / (n - 1)
            q = (x0 + math.cos(a) * 0.1 * s * t, y0 + math.sin(a) * 0.05 * s * t, z0 - L * t)
            v, f = lib.blob(q, 0.045 * s * (1 - 0.3 * t), squash=(0.55, 0.55, 2.2), rough=0.1, subdiv=1, seed=k * 11 + j)
            mb_leaf.add(v, f, lambda qq, t=t: lib.lerp_col(high, low, 0.2 + 0.55 * t))


def fruit_crate(bx, by, s=1.0, rnd=None, name='fruit'):
    """Open crate heaped with fruit."""
    rnd = rnd or random.Random(int(bx * 11 + by))
    p = board_to_world(bx, by, 0.0)
    wood, fruit = MeshBuilder(), MeshBuilder()
    e = 0.36 * s
    rot = rnd.uniform(-0.3, 0.3)
    v, f = lib.box((p.x, p.y, e * 0.35), (e * 1.3, e, e * 0.7), rot_z=rot)
    wood.add(v, f, col(rnd.choice(['#c9a36a', '#b8915a'])))
    fc = rnd.choice([['#ff4a3a', '#e8352b'], ['#ffa62b', '#ff8c1a'], ['#8bd346', '#6fbf3a'], ['#ffd23f', '#f2c12e']])
    for k in range(9):
        u, t = rnd.uniform(-0.5, 0.5) * e * 1.1, rnd.uniform(-0.35, 0.35) * e
        v, f = lib.blob((p.x + u, p.y + t, e * 0.72 + rnd.uniform(0, 0.05) * s), 0.075 * s, rough=0.05, subdiv=1, seed=k)
        fruit.add(v, f, col(rnd.choice(fc)))
    wood.build(name, props.mats()['wood'])
    fruit.build(name + '_fruit', mats()['gloss'])


def cart(bx, by, s=1.0, load='barrels', name='cart'):
    """Two-wheeled festival cart with a load of barrels or crates."""
    P = props.Prop(name)
    p = board_to_world(bx, by, 0.0)
    x, y = p.x, p.y
    v, f = lib.box((x, y, 0.5 * s), (1.3 * s, 0.7 * s, 0.1 * s))
    P.b['wood'].add(v, f, col('#b07a45'))
    for dy in (-0.36, 0.36):
        v, f = lib.box((x, y + dy * s, 0.64 * s), (1.3 * s, 0.05 * s, 0.22 * s))
        P.b['wood'].add(v, f, col('#9a643a'))
        v, f = lib.cylinder((0, 0, 0), 0.34 * s, 0.34 * s, 0.06 * s, 16)
        v = lib.transform(v, loc=(x - 0.15 * s, y + dy * s * 1.12, 0.34 * s), rot=(math.pi / 2, 0.0, 0.0))
        P.b['wood'].add(v, f, col(DARKWOOD))
        v, f = lib.cylinder((0, 0, 0), 0.08 * s, 0.08 * s, 0.08 * s, 10)
        v = lib.transform(v, loc=(x - 0.15 * s, y + dy * s * 1.14, 0.34 * s), rot=(math.pi / 2, 0.0, 0.0))
        P.b['metal'].add(v, f, col('#e0a93f'))
    for dy in (-0.22, 0.22):
        v, f = lib.tube([(x + 0.62 * s, y + dy * s, 0.5 * s), (x + 1.35 * s, y + dy * s * 0.6, 0.12 * s)], 0.035 * s, 6)
        P.b['wood'].add(v, f, col('#9a643a'))
    if load == 'barrels':
        for (dx, dy) in [(-0.35, -0.15), (0.05, -0.15), (-0.15, 0.2), (0.35, 0.15)]:
            v, f = lib.lathe([(0.17 * s, 0.0), (0.2 * s, 0.2 * s), (0.17 * s, 0.4 * s), (0.0, 0.4 * s)], 14, (x + dx * s, y + dy * s, 0.55 * s))
            P.b['wood'].add(v, f, col('#a8744a'))
            v, f = lib.lathe([(0.205 * s, 0.17 * s), (0.205 * s, 0.23 * s)], 14, (x + dx * s, y + dy * s, 0.55 * s), cap_bottom=False, cap_top=False)
            P.b['metal'].add(v, f, col('#6b6f7a'))
    else:
        rnd = random.Random(5)
        for (dx, dy, e) in [(-0.3, -0.1, 0.38), (0.15, -0.12, 0.34), (-0.1, 0.15, 0.3), (0.0, 0.0, 0.26)]:
            z = 0.55 * s if e > 0.27 else 0.93 * s
            v, f = lib.box((x + dx * s, y + dy * s, z + e * s / 2), (e * s, e * s, e * s), rot_z=rnd.uniform(-0.2, 0.2))
            P.b['wood'].add(v, f, col(rnd.choice(['#c9a36a', '#d2ad74'])))
    return P.build()


def footbridge(ax, ay, bx, by, width=0.9, rise=0.35, name='footbridge'):
    """Arched plank footbridge between two board points (with rope rails)."""
    P = props.Prop(name)
    a = board_to_world(ax, ay, 0.0)
    b = board_to_world(bx, by, 0.0)
    d = (b - a)
    L = d.length
    ang = math.atan2(d.y, d.x)
    nrm = Vector((-math.sin(ang), math.cos(ang), 0.0))
    n = max(6, int(L / 0.16))
    rails = {1: [], -1: []}
    for k in range(n + 1):
        t = k / n
        c = a + d * t
        z = 0.05 + math.sin(t * math.pi) * rise
        v, f = lib.box((c.x, c.y, z), (L / n * 0.9, width, 0.05), rot_z=ang)
        P.b['wood'].add(v, f, col('#b07a45' if k % 2 else '#9a643a'))
        for sgn in (1, -1):
            q = c + nrm * (width / 2 * sgn)
            if k % 3 == 0:
                v, f = lib.cylinder((q.x, q.y, z - 0.05), 0.025, 0.025, 0.36, 6)
                P.b['wood'].add(v, f, col(DARKWOOD))
            rails[sgn].append((q.x, q.y, z + 0.3))
    for sgn in (1, -1):
        v, f = lib.tube(rails[sgn], 0.018, 5)
        P.b['wood'].add(v, f, col('#d9c49a'))
    return P.build()


def cloud_puffs(mb, center, size, puffs=10, flat=0.5, seed=0):
    """Cumulus cluster (as sky.py): overlapping lumpy spheres on a flattened base (world units)."""
    r = random.Random(seed)
    cx, cy, cz = center
    for i in range(puffs):
        t = i / max(1, puffs - 1)
        x = (t - 0.5) * size * 2.2 + r.uniform(-0.25, 0.25) * size
        y = r.uniform(-0.3, 0.3) * size
        rad = size * r.uniform(0.38, 0.62) * (0.55 + 0.45 * math.sin(t * math.pi))
        z = rad * 0.35 + math.sin(t * math.pi) * size * 0.3 * (1.0 if flat > 0.4 else 0.4)
        v, f = lib.blob((cx + x, cy + y, cz + z), rad, squash=(1.15, 1.0, 0.9 if flat > 0.4 else 0.6), rough=0.08, freq=1.2, subdiv=3, seed=r.random() * 90)
        mb.add(v, f, (1, 1, 1, 1))
    v, f = lib.blob((cx, cy, cz), size * 1.1, squash=(1.2, 0.45, 0.16), rough=0.05, subdiv=3)
    mb.add(v, f, (1, 1, 1, 1))


def cloud_material(shadow: str = '#b9cbee', glow: str = '#bcd7ff', warm: str = '#fff3e0', name: str = 'fest_cloud'):
    """Soft cloud shading: bright warm tops, cool shadowed undersides, a little self-glow."""
    m = lib.NT(name)
    ao = m.ao(2.5, 6)
    nz = m.sep(m.normal())[2]
    up = m.maprange(nz, -0.6, 0.9)
    base = m.mix(m.math('MULTIPLY', ao, up), col(shadow), col(warm))
    m.bsdf(base, 1.0, emission=col(glow), emission_strength=0.1, sheen=0.4)
    return m.mat
