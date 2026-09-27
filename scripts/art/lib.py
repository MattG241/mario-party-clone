"""Shared helpers for Gleamtrail's pre-rendered environment art.

Run the art scripts with Blender's Python module (bpy 4.2, CPU Cycles):

    python -m venv .artenv && .artenv/bin/pip install bpy==4.2.0 scipy scikit-image pillow
    .artenv/bin/python scripts/art/board.py --preview

Everything is procedural and original: islands, rock, grass, trees and props are modelled from
code, lit by one warm key light plus a sky fill, and rendered with an orthographic camera whose
projection matches the game's board coordinates exactly (see board_to_world).
"""
from __future__ import annotations

import math
import os
import random

import bpy
import bmesh
import numpy as np
from mathutils import Vector, noise

# Camera tilt from straight down. The view elevation is 90° - BETA.
BETA = math.radians(38.0)
COSB, SINB = math.cos(BETA), math.sin(BETA)
# Board pixels per Blender unit.
PX = 100.0

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


# ------------------------------------------------------------------------------------------
# Colour helpers
def _lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def col(h: str, a: float = 1.0) -> tuple[float, float, float, float]:
    """sRGB hex -> linear RGBA for Blender sockets."""
    h = h.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (_lin(r), _lin(g), _lin(b), a)


def lerp_col(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(4))


# ------------------------------------------------------------------------------------------
# Projection
def board_to_world(bx: float, by: float, z: float = 0.0) -> Vector:
    """Board pixel (on the ground plane) -> world position. Ground is z = 0."""
    return Vector((bx / PX, -by / (PX * COSB), z))


def world_to_board(v) -> tuple[float, float]:
    """World position -> board/screen pixel (orthographic projection)."""
    return v[0] * PX, -(v[1] * COSB + v[2] * SINB) * PX


def screen_height(z_units: float) -> float:
    """On-screen pixel height of a vertical extent."""
    return z_units * PX * SINB


# ------------------------------------------------------------------------------------------
# Scene
def reset(samples: int = 64) -> bpy.types.Scene:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    cy.device = 'CPU'
    cy.samples = samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.03
    cy.use_denoising = True
    try:
        cy.denoiser = 'OPENIMAGEDENOISE'
    except TypeError:
        pass
    cy.max_bounces = 6
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 3
    cy.transmission_bounces = 6
    cy.transparent_max_bounces = 8
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.pixel_filter_width = 1.2
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = -0.15
    sc.render.threads_mode = 'AUTO'
    return sc


# House look: a dimmer sky fill and a stronger key light than the per-scene values ask for, so
# every render gets directional light with readable cast shadows instead of flat overcast.
FILL_K = 0.7
KEY_K = 1.28


def world_light(strength: float = 1.0, zenith: str = '#9ccfff', horizon: str = '#ffe9cf', ground: str = '#b9a58a'):
    """Soft sky fill: blue from above, warm near the horizon, earthy from below."""
    sc = bpy.context.scene
    w = bpy.data.worlds.new('sky')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -1.0
    mr.inputs['From Max'].default_value = 1.0
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = col(ground)
    els[1].position = 1.0
    els[1].color = col(zenith)
    e = els.new(0.5)
    e.color = col(horizon)
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength * FILL_K
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])


def sun(energy: float = 4.0, elevation: float = 48.0, azimuth: float = -35.0, angle: float = 4.0, color: str = '#fff0d8'):
    """Key light. azimuth 0 = light travelling towards +Y (away from camera); negative = from the left."""
    ld = bpy.data.lights.new('sun', 'SUN')
    ld.energy = energy * KEY_K
    ld.angle = math.radians(angle)
    ld.color = col(color)[:3]
    ob = bpy.data.objects.new('sun', ld)
    bpy.context.scene.collection.objects.link(ob)
    # Rotation: tilt away from vertical by (90 - elevation), then spin around Z.
    ob.rotation_euler = (math.radians(90 - elevation), 0.0, math.radians(azimuth))
    return ob


def camera_for_region(x0: float, y0: float, w: float, h: float, scale: float = 1.0) -> bpy.types.Object:
    """Orthographic camera covering board pixels [x0, x0+w] x [y0, y0+h] on the ground plane."""
    sc = bpy.context.scene
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.sensor_fit = 'HORIZONTAL' if w >= h else 'VERTICAL'
    cd.ortho_scale = max(w, h) / PX
    cd.clip_start = 0.1
    cd.clip_end = 400.0
    ob = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(ob)
    sc.camera = ob
    centre = board_to_world(x0 + w / 2, y0 + h / 2, 0.0)
    view = Vector((0.0, SINB, -COSB))
    ob.location = centre - view * 120.0
    ob.rotation_euler = (BETA, 0.0, 0.0)
    sc.render.resolution_x = int(round(w * scale))
    sc.render.resolution_y = int(round(h * scale))
    sc.render.resolution_percentage = 100
    return ob


def set_border(region, frame):
    """Render only `region` (board px x0,y0,x1,y1) of the camera `frame` (x0,y0,w,h)."""
    sc = bpy.context.scene
    fx, fy, fw, fh = frame
    x0, y0, x1, y1 = region
    sc.render.use_border = True
    sc.render.use_crop_to_border = True
    sc.render.border_min_x = max(0.0, (x0 - fx) / fw)
    sc.render.border_max_x = min(1.0, (x1 - fx) / fw)
    sc.render.border_min_y = max(0.0, 1.0 - (y1 - fy) / fh)
    sc.render.border_max_y = min(1.0, 1.0 - (y0 - fy) / fh)


def clear_border():
    sc = bpy.context.scene
    sc.render.use_border = False
    sc.render.use_crop_to_border = False


def render_to(path: str):
    sc = bpy.context.scene
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------------------------------
# Objects
def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def mesh_object(name: str, verts, faces, smooth: bool = True, material=None) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate(clean_customdata=False)
    me.update()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    if material is not None:
        me.materials.append(material)
    return ob


def set_point_colors(ob, colors, name: str = 'col'):
    """colors: sequence of RGBA per vertex (linear)."""
    me = ob.data
    attr = me.color_attributes.new(name=name, type='FLOAT_COLOR', domain='POINT')
    flat = np.asarray(colors, dtype=np.float32).reshape(-1)
    attr.data.foreach_set('color', flat)
    return attr


def shadow_only(ob):
    """Casts shadows into the render but is invisible to the camera (for sprites drawn separately)."""
    ob.visible_camera = False
    ob.visible_diffuse = True
    ob.visible_glossy = False
    ob.visible_transmission = False
    ob.visible_volume_scatter = False
    ob.visible_shadow = True


# ------------------------------------------------------------------------------------------
# Shader node helpers
class NT:
    """Tiny builder around a material node tree."""

    def __init__(self, name: str):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.nt.nodes.clear()
        self.out = self.node('ShaderNodeOutputMaterial')

    def node(self, kind: str, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    def val(self, v: float):
        n = self.node('ShaderNodeValue')
        n.outputs[0].default_value = v
        return n.outputs[0]

    def math(self, op: str, a, b=None, clamp: bool = False):
        n = self.node('ShaderNodeMath', operation=op)
        n.use_clamp = clamp
        self._feed(n.inputs[0], a)
        if b is not None:
            self._feed(n.inputs[1], b)
        return n.outputs[0]

    def _feed(self, sock, v):
        if isinstance(v, (int, float)):
            sock.default_value = v
        elif isinstance(v, tuple):
            sock.default_value = v
        else:
            self.link(v, sock)

    def maprange(self, v, a, b, c=0.0, d=1.0, smooth: bool = True):
        n = self.node('ShaderNodeMapRange')
        n.interpolation_type = 'SMOOTHSTEP' if smooth else 'LINEAR'
        self._feed(n.inputs['Value'], v)
        n.inputs['From Min'].default_value = a
        n.inputs['From Max'].default_value = b
        n.inputs['To Min'].default_value = c
        n.inputs['To Max'].default_value = d
        return n.outputs['Result']

    def ramp(self, fac, stops):
        """stops: [(pos, '#hex'), ...]"""
        n = self.node('ShaderNodeValToRGB')
        self._feed(n.inputs['Fac'], fac)
        els = n.color_ramp.elements
        els[0].position, els[0].color = stops[0][0], col(stops[0][1])
        els[1].position, els[1].color = stops[-1][0], col(stops[-1][1])
        for pos, h in stops[1:-1]:
            e = els.new(pos)
            e.color = col(h)
        return n.outputs['Color']

    def mix(self, fac, a, b):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
        n.clamp_factor = True
        facs = [s for s in n.inputs if s.name == 'Factor' and s.type == 'VALUE']
        cols = [s for s in n.inputs if s.type == 'RGBA']
        self._feed(facs[0], fac)
        self._feed(cols[0], a)
        self._feed(cols[1], b)
        return [s for s in n.outputs if s.type == 'RGBA'][0]

    def mult(self, a, b, fac=1.0):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
        n.clamp_factor = True
        facs = [s for s in n.inputs if s.name == 'Factor' and s.type == 'VALUE']
        cols = [s for s in n.inputs if s.type == 'RGBA']
        self._feed(facs[0], fac)
        self._feed(cols[0], a)
        self._feed(cols[1], b)
        return [s for s in n.outputs if s.type == 'RGBA'][0]

    def noise(self, scale: float, detail: float = 4.0, rough: float = 0.55, vec=None, dist: float = 0.0):
        n = self.node('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        n.inputs['Distortion'].default_value = dist
        if vec is not None:
            self.link(vec, n.inputs['Vector'])
        return n

    def voronoi(self, scale: float, vec=None, feature: str = 'F1'):
        n = self.node('ShaderNodeTexVoronoi', feature=feature)
        n.inputs['Scale'].default_value = scale
        if vec is not None:
            self.link(vec, n.inputs['Vector'])
        return n

    def position(self):
        return self.node('ShaderNodeNewGeometry').outputs['Position']

    def normal(self):
        return self.node('ShaderNodeNewGeometry').outputs['Normal']

    def sep(self, vec):
        n = self.node('ShaderNodeSeparateXYZ')
        self.link(vec, n.inputs[0])
        return n.outputs

    def attr(self, name: str):
        n = self.node('ShaderNodeAttribute')
        n.attribute_name = name
        return n.outputs['Color']

    def ao(self, distance: float = 0.6, samples: int = 8):
        n = self.node('ShaderNodeAmbientOcclusion')
        n.samples = samples
        n.inputs['Distance'].default_value = distance
        return n.outputs['AO']

    def bump(self, height, strength: float = 0.3, distance: float = 0.05):
        n = self.node('ShaderNodeBump')
        n.inputs['Strength'].default_value = strength
        n.inputs['Distance'].default_value = distance
        self._feed(n.inputs['Height'], height)
        return n.outputs['Normal']

    def bsdf(self, color, rough: float = 0.75, normal=None, emission=None, emission_strength: float = 0.0,
             subsurface: float = 0.0, sheen: float = 0.0, coat: float = 0.0, spec: float = 0.4, transmission: float = 0.0, alpha=None):
        b = self.node('ShaderNodeBsdfPrincipled')
        self._feed(b.inputs['Base Color'], color)
        self._feed(b.inputs['Roughness'], rough)
        b.inputs['Specular IOR Level'].default_value = spec
        if normal is not None:
            self.link(normal, b.inputs['Normal'])
        if emission is not None:
            self._feed(b.inputs['Emission Color'], emission)
            b.inputs['Emission Strength'].default_value = emission_strength
        if subsurface:
            b.inputs['Subsurface Weight'].default_value = subsurface
            b.inputs['Subsurface Radius'].default_value = (0.3, 0.2, 0.1)
            b.inputs['Subsurface Scale'].default_value = 0.1
        if sheen:
            b.inputs['Sheen Weight'].default_value = sheen
        if coat:
            b.inputs['Coat Weight'].default_value = coat
            b.inputs['Coat Roughness'].default_value = 0.15
        if transmission:
            b.inputs['Transmission Weight'].default_value = transmission
        if alpha is not None:
            self._feed(b.inputs['Alpha'], alpha)
        self.link(b.outputs['BSDF'], self.out.inputs['Surface'])
        return b


def simple_mat(name: str, color: str, rough: float = 0.7, **kw) -> bpy.types.Material:
    m = NT(name)
    m.bsdf(col(color), rough, **kw)
    return m.mat


def attr_mat(name: str, rough: float = 0.7, attr: str = 'col', sheen: float = 0.0, subsurface: float = 0.0,
             ao: float = 0.0, emission_strength: float = 0.0) -> bpy.types.Material:
    """Material coloured by a per-vertex colour attribute (used for merged scatter meshes)."""
    m = NT(name)
    c = m.attr(attr)
    if ao:
        c = m.mult(c, m.mix(m.ao(ao), (0.35, 0.35, 0.4, 1.0), (1, 1, 1, 1)), 1.0)
    m.bsdf(c, rough, sheen=sheen, subsurface=subsurface, emission=c if emission_strength else None,
           emission_strength=emission_strength)
    return m.mat


# ------------------------------------------------------------------------------------------
# Procedural geometry (merged meshes built in numpy for speed)
class MeshBuilder:
    """Accumulates vertices / faces / per-vertex colours, then emits one object."""

    def __init__(self):
        self.v: list = []
        self.f: list = []
        self.c: list = []

    def add(self, verts, faces, color):
        base = len(self.v)
        self.v.extend(verts)
        self.f.extend([tuple(i + base for i in face) for face in faces])
        if callable(color):
            self.c.extend(color(v) for v in verts)
        else:
            self.c.extend([color] * len(verts))

    def build(self, name: str, material, smooth: bool = True):
        if not self.v:
            return None
        ob = mesh_object(name, self.v, self.f, smooth=smooth, material=material)
        set_point_colors(ob, self.c)
        return ob


_ICO_CACHE: dict = {}


def icosphere(subdiv: int = 2):
    """Unit icosphere (verts, faces), cached."""
    if subdiv in _ICO_CACHE:
        return _ICO_CACHE[subdiv]
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    verts = [tuple(v.co) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    _ICO_CACHE[subdiv] = (verts, faces)
    return verts, faces


def blob(center, radius, squash=(1.0, 1.0, 1.0), rough: float = 0.25, freq: float = 1.6, subdiv: int = 2, seed: float = 0.0):
    """A lumpy sphere (foliage clump, rock, cloud puff)."""
    verts, faces = icosphere(subdiv)
    out = []
    cx, cy, cz = center
    for (x, y, z) in verts:
        p = Vector((x, y, z))
        n = noise.noise(p * freq + Vector((seed, seed * 0.7, seed * 1.3)))
        r = radius * (1.0 + rough * n)
        out.append((cx + x * r * squash[0], cy + y * r * squash[1], cz + z * r * squash[2]))
    return out, faces


def prism(center, radius, height, sides: int = 6, tip: float = 0.35, tilt=(0.0, 0.0), twist: float = 0.0):
    """Pointed crystal: a hexagonal prism with a pyramid tip, tilted (radians around X, Y)."""
    cx, cy, cz = center
    verts = []
    for k in range(sides):
        a = twist + k / sides * math.tau
        verts.append((math.cos(a) * radius, math.sin(a) * radius, 0.0))
    for k in range(sides):
        a = twist + k / sides * math.tau
        verts.append((math.cos(a) * radius, math.sin(a) * radius, height * (1 - tip)))
    verts.append((0.0, 0.0, height))
    verts.append((0.0, 0.0, 0.0))
    faces = []
    top, bot = 2 * sides, 2 * sides + 1
    for k in range(sides):
        a, b = k, (k + 1) % sides
        faces.append((a, b, sides + b, sides + a))
        faces.append((sides + a, sides + b, top))
        faces.append((b, a, bot))
    # tilt
    ax, ay = tilt
    out = []
    for (x, y, z) in verts:
        y2 = y * math.cos(ax) - z * math.sin(ax)
        z2 = y * math.sin(ax) + z * math.cos(ax)
        x3 = x * math.cos(ay) + z2 * math.sin(ay)
        z3 = -x * math.sin(ay) + z2 * math.cos(ay)
        out.append((cx + x3, cy + y2, cz + z3))
    return out, faces


def cylinder(center, r0, r1, height, sides: int = 12, cap: bool = True):
    cx, cy, cz = center
    verts = []
    for k in range(sides):
        a = k / sides * math.tau
        verts.append((cx + math.cos(a) * r0, cy + math.sin(a) * r0, cz))
    for k in range(sides):
        a = k / sides * math.tau
        verts.append((cx + math.cos(a) * r1, cy + math.sin(a) * r1, cz + height))
    faces = [(k, (k + 1) % sides, sides + (k + 1) % sides, sides + k) for k in range(sides)]
    if cap:
        faces.append(tuple(range(sides - 1, -1, -1)))
        faces.append(tuple(sides + k for k in range(sides)))
    return verts, faces


def seeded(seed: int):
    random.seed(seed)
    np.random.seed(seed)


def lathe(profile, sides: int = 24, center=(0.0, 0.0, 0.0), cap_bottom: bool = True, cap_top: bool = True, squash_y: float = 1.0):
    """Revolve a (radius, z) profile around the Z axis."""
    cx, cy, cz = center
    verts = []
    rows = len(profile)
    for (r, z) in profile:
        for k in range(sides):
            a = k / sides * math.tau
            verts.append((cx + math.cos(a) * r, cy + math.sin(a) * r * squash_y, cz + z))
    faces = []
    for i in range(rows - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    if cap_bottom and profile[0][0] > 1e-6:
        faces.append(tuple(range(sides - 1, -1, -1)))
    if cap_top and profile[-1][0] > 1e-6:
        faces.append(tuple((rows - 1) * sides + k for k in range(sides)))
    return verts, faces


def box(center, size, rot_z: float = 0.0):
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    pts = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz), (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    c, s = math.cos(rot_z), math.sin(rot_z)
    verts = [(cx + x * c - y * s, cy + x * s + y * c, cz + z) for (x, y, z) in pts]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return verts, faces


def tube(points, radius, sides: int = 8):
    """A tube following a polyline (list of 3D points)."""
    verts, faces = [], []
    pts = [Vector(p) for p in points]
    n = len(pts)
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        u = t.cross(up).normalized()
        v = t.cross(u).normalized()
        r = radius(i / max(1, n - 1)) if callable(radius) else radius
        for k in range(sides):
            a = k / sides * math.tau
            q = p + (u * math.cos(a) + v * math.sin(a)) * r
            verts.append(tuple(q))
    for i in range(n - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    return verts, faces


def transform(verts, loc=(0, 0, 0), rot=(0.0, 0.0, 0.0), scale=1.0):
    """Rotate (XYZ euler, radians) then translate a vertex list."""
    from mathutils import Euler
    m = Euler(rot, 'XYZ').to_matrix()
    s = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
    out = []
    for v in verts:
        q = m @ Vector((v[0] * s[0], v[1] * s[1], v[2] * s[2]))
        out.append((q.x + loc[0], q.y + loc[1], q.z + loc[2]))
    return out
