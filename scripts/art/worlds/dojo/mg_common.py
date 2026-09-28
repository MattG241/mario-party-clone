"""Shared helpers for the Dojo Summit minigame art (mg_sprites.py, mg_cloud_rider.py, mg_clone_chaos.py).

Imports the house toolkit from scripts/art (lib, mg_dress, props, terrain) without touching it, and adds
the few things these scripts share: an art-out folder, a side-on camera for sprites and scrolling strips,
cloud and smoke materials, a lumpy-cloud builder and WebP publishing.
"""
from __future__ import annotations

import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.abspath(os.path.join(HERE, '..', '..'))
if ART not in sys.path:
    sys.path.insert(0, ART)

import lib  # noqa: E402
import mg_dress as dress  # noqa: E402
import props  # noqa: E402
import terrain  # noqa: E402
from lib import col  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

OUT = os.path.join(lib.ROOT, 'art-out', 'dojo')
PUB = os.path.join(lib.ROOT, 'public', 'assets', 'rendered')
os.makedirs(OUT, exist_ok=True)


def args():
    """Arguments after `--` (or all of them when run with plain python)."""
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]


def start(samples: int, w: int, h: int, transparent: bool = True, exposure: float = -0.15):
    sc = lib.reset(samples)
    dress.threads()
    dress.reset_mats()
    sc.render.film_transparent = transparent
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.view_settings.exposure = exposure
    return sc


def side_camera(center, ortho_w: float, elev_deg: float = 10.0, dist: float = 60.0):
    """Orthographic camera looking along +Y (into the screen), tilted down by elev_deg, framing
    `ortho_w` world units across. Screen x follows world x exactly, so strips tile when their
    content repeats every `ortho_w` units."""
    sc = bpy.context.scene
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.sensor_fit = 'HORIZONTAL'
    cd.ortho_scale = ortho_w
    cd.clip_start = 0.1
    cd.clip_end = 600.0
    ob = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(ob)
    sc.camera = ob
    e = math.radians(elev_deg)
    fwd = Vector((0.0, math.cos(e), -math.sin(e)))
    ob.location = Vector(center) - fwd * dist
    ob.rotation_euler = (math.radians(90.0 - elev_deg), 0.0, 0.0)
    return ob


def publish(png: str, name: str, rgb: bool = False, quality: int = 90) -> str:
    from PIL import Image
    im = Image.open(png)
    im = im.convert('RGB') if rgb else im.convert('RGBA')
    path = os.path.join(PUB, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=quality, method=6)
    print('wrote', path, im.size)
    return path


# ------------------------------------------------------------------------------------------
# Clouds
def cloud_material(name: str, top: str, mid: str, low: str, glow: str, glow_strength: float = 0.12,
                   z_low: float = -0.6, z_top: float = 0.6, ao_tint: str = '#9aa4c8', sheen: float = 0.45, alpha=None):
    """Soft cartoon cloud: colour ramps from the underside to the sunlit top (object height), cool
    occlusion in the folds between puffs and a little self-glow standing in for scattering."""
    m = lib.NT(name)
    pos = m.position()
    _, _, z = m.sep(pos)
    t = m.maprange(z, z_low, z_top, 0.0, 1.0, smooth=False)
    c = m.ramp(t, [(0.0, low), (0.45, mid), (1.0, top)])
    nz = m.sep(m.normal())[2]
    lit = m.maprange(nz, -0.7, 0.9)
    c = m.mult(c, m.mix(lit, col(ao_tint), col('#ffffff')), 0.35)
    c = m.mult(c, m.mix(m.ao(0.35, 8), col(ao_tint), col('#ffffff')))
    m.bsdf(c, 0.95, emission=col(glow), emission_strength=glow_strength, sheen=sheen, alpha=alpha)
    return m.mat


def puff_cluster(mb, center, size: float, puffs: int, rnd: random.Random, flat: float = 0.55, depth: float = 0.35,
                 subdiv: int = 3, spread: float = 2.2, color=(1, 1, 1, 1)):
    """Cumulus cluster (as sky.py's clouds): overlapping lumpy spheres, tallest in the middle, on a
    flattened base."""
    cx, cy, cz = center
    for i in range(puffs):
        t = i / max(1, puffs - 1)
        x = (t - 0.5) * size * spread + rnd.uniform(-0.2, 0.2) * size
        y = rnd.uniform(-depth, depth) * size
        rad = size * rnd.uniform(0.38, 0.6) * (0.55 + 0.45 * math.sin(t * math.pi))
        z = rad * 0.3 + math.sin(t * math.pi) * size * 0.3 * flat
        v, f = lib.blob((cx + x, cy + y, cz + z), rad, squash=(1.15, 1.0, 0.9), rough=0.08, freq=1.2, subdiv=subdiv, seed=rnd.random() * 90)
        mb.add(v, f, color)
    v, f = lib.blob((cx, cy, cz), size * 1.05, squash=(spread * 0.52, 0.45, 0.16), rough=0.05, subdiv=subdiv, seed=rnd.random() * 50)
    mb.add(v, f, color)
