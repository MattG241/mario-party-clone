"""Gameplay sprites for the Dojo Summit minigames (Cloud Rider, Clone Chaos).

    <bpy python> scripts/art/worlds/dojo/mg_sprites.py [--preview] [--only cloud,ring,...]
    python3 scripts/build-lite.py --image mg/dojo_cloud.webp mg/dojo_ring.webp mg/dojo_orb.webp mg/dojo_storm.webp mg/dojo_puff.webp

All original shapes, seen side-on like the rest of the minigame art (key light from the front-left):
  cloud   the little golden cloud each player surfs on (the character stands at ANCHORS['cloud'])
  ring    a golden flight ring standing edge-on to the course, so it reads as a hoop you fly through
          (the game draws its left arc behind the rider and its right arc in front)
  orb     a glowing energy orb
  storm   a dark thundercloud (the game adds the lightning)
  puff    a cartoon smoke puff (the clones appear and vanish in these)
Writes public/assets/rendered/mg/dojo_<name>.webp at the size the game draws them.
"""
from __future__ import annotations

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mg_common as C  # noqa: E402
from mg_common import col, lib, dress  # noqa: E402

import bpy  # noqa: E402

A = C.args()
PREVIEW = '--preview' in A
ONLY = set(A[A.index('--only') + 1].split(',')) if '--only' in A else None

# name: (width px, height px). One world unit is 100 px in every sprite.
SIZES = {
    'cloud': (320, 180),
    'ring': (128, 176),
    'orb': (128, 128),
    'storm': (400, 256),
    'puff': (256, 224),
}


def begin(name: str, elev: float = 10.0, center=(0.0, 0.0, 0.0), samples: int = 40):
    w, h = SIZES[name]
    sc = C.start(10 if PREVIEW else samples, w, h)
    dress.festival_light(key=3.1, elev=50, az=-35, fill=0.95, angle=4.0, key_col='#ffe6c0')
    C.side_camera(center, w / 100.0, elev_deg=elev)
    return sc


def finish(name: str) -> None:
    png = os.path.join(C.OUT, f'spr_{name}.png')
    lib.render_to(png)
    if not PREVIEW:
        C.publish(png, os.path.join('mg', f'dojo_{name}.webp'), quality=92)


# ------------------------------------------------------------------------------------------
def golden_cloud() -> None:
    """A plump golden cloud, flat underneath, with a curl of wisp trailing off its back (left)."""
    begin('cloud', elev=12.0, center=(0.0, 0.0, 0.05))
    mb = lib.MeshBuilder()
    rnd = random.Random(7)
    puffs = [
        (0.0, 0.0, 0.02, 0.56), (0.6, 0.08, -0.06, 0.45), (-0.6, 0.05, -0.04, 0.46), (1.02, -0.02, -0.14, 0.32),
        (-1.0, 0.1, -0.12, 0.34), (-0.28, -0.12, 0.28, 0.33), (0.3, -0.1, 0.26, 0.34), (0.05, 0.2, 0.3, 0.3),
        (-1.34, 0.0, -0.02, 0.2), (-1.55, 0.02, 0.1, 0.13), (0.72, -0.2, 0.1, 0.28), (-0.7, -0.2, 0.12, 0.27),
    ]
    for (x, y, z, r) in puffs:
        v, f = lib.blob((x, y, z), r, squash=(1.12, 1.0, 0.86), rough=0.06, freq=1.3, subdiv=3, seed=rnd.random() * 80)
        mb.add(v, f, (1, 1, 1, 1))
    # the flat underside the puffs sit on
    v, f = lib.blob((0.0, 0.0, -0.2), 1.0, squash=(1.18, 0.42, 0.2), rough=0.04, subdiv=3, seed=3.0)
    mb.add(v, f, (1, 1, 1, 1))
    mat = C.cloud_material('gold_cloud', top='#fff4b8', mid='#ffcd4e', low='#e98f2c', glow='#ffc24a', glow_strength=0.22,
                           z_low=-0.42, z_top=0.62, ao_tint='#d0782a', sheen=0.5)
    mb.build('gold_cloud', mat)
    finish('cloud')


def ring() -> None:
    """A golden flight ring turned almost edge-on (a tall ellipse): left arc far, right arc near."""
    begin('ring', elev=6.0)
    R, r = 0.62, 0.105
    prof = [(R + r * math.cos(t), r * math.sin(t)) for t in [k / 20 * math.tau for k in range(21)]]
    v, f = lib.lathe(prof, 64, cap_bottom=False, cap_top=False)
    # stand it up facing the camera, then turn it 62 deg so its right side swings towards the viewer
    v = lib.transform(v, rot=(math.pi / 2, 0.0, 0.0))
    v = lib.transform(v, rot=(0.0, 0.0, -math.radians(62)))
    m = lib.NT('ring_gold')
    pos = m.position()
    _, _, z = m.sep(pos)
    c = m.ramp(m.maprange(z, -0.7, 0.7, 0.0, 1.0, smooth=False), [(0.0, '#e59a22'), (0.5, '#ffcc3d'), (1.0, '#ffe98c')])
    b = m.bsdf(c, 0.26, emission=col('#ffcf4a'), emission_strength=0.42, coat=0.7)
    b.inputs['Metallic'].default_value = 0.85
    lib.mesh_object('ring', v, f, smooth=True, material=m.mat)
    # a bright bead of light riding the rim
    bv, bf = lib.blob((-0.1, -0.3, 0.52), 0.05, rough=0.0, subdiv=2)
    lib.mesh_object('ring_glint', bv, bf, material=lib.simple_mat('glint', '#ffffff', 0.1, emission=col('#ffffff'), emission_strength=4.0))
    finish('ring')


def orb() -> None:
    """Energy orb: a white-hot core in a soft cyan glow, circled by two thin energy bands."""
    begin('orb', elev=0.0)
    v, f = lib.blob((0, 0, 0), 0.27, rough=0.0, subdiv=3)
    lib.mesh_object('orb_core', v, f, material=lib.simple_mat('orb_core', '#ffffff', 0.2, emission=col('#e8fbff'), emission_strength=7.0))
    # translucent shell: emissive at the rim, clear in the middle (fresnel alpha)
    m = lib.NT('orb_shell')
    lw = m.node('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.5
    rim = m.maprange(lw.outputs['Facing'], 0.1, 0.95, 0.25, 1.0)
    em = m.node('ShaderNodeEmission')
    em.inputs['Color'].default_value = col('#63dcff')
    em.inputs['Strength'].default_value = 2.6
    tr = m.node('ShaderNodeBsdfTransparent')
    mx = m.node('ShaderNodeMixShader')
    m.link(rim, mx.inputs['Fac'])
    m.link(tr.outputs['BSDF'], mx.inputs[1])
    m.link(em.outputs['Emission'], mx.inputs[2])
    m.link(mx.outputs['Shader'], m.out.inputs['Surface'])
    m.mat.blend_method = 'BLEND'
    v, f = lib.blob((0, 0, 0), 0.42, rough=0.0, subdiv=3)
    lib.mesh_object('orb_shell', v, f, material=m.mat)
    band = lib.simple_mat('orb_band', '#bff4ff', 0.2, emission=col('#9cefff'), emission_strength=3.2)
    for tilt, spin in ((0.5, 0.3), (-0.7, -0.5)):
        prof = [(0.5 + 0.022 * math.cos(t), 0.022 * math.sin(t)) for t in [k / 10 * math.tau for k in range(11)]]
        v, f = lib.lathe(prof, 48, cap_bottom=False, cap_top=False)
        v = lib.transform(v, rot=(tilt + math.pi / 2, spin, 0.0))
        lib.mesh_object('orb_band', v, f, material=band)
    finish('orb')


def storm() -> None:
    """A brooding thundercloud: slate tops, an inky underside and a violet glow in its folds."""
    begin('storm', elev=8.0, center=(0.0, 0.0, 0.1))
    mb = lib.MeshBuilder()
    rnd = random.Random(21)
    C.puff_cluster(mb, (0.0, 0.0, -0.05), 0.95, 11, rnd, flat=0.7, depth=0.3, spread=2.3)
    for (x, z, r) in [(-0.55, 0.45, 0.42), (0.35, 0.5, 0.46), (-0.05, 0.62, 0.36), (0.95, 0.2, 0.36), (-1.1, 0.12, 0.34)]:
        v, f = lib.blob((x, rnd.uniform(-0.1, 0.1), z), r, squash=(1.1, 1.0, 0.9), rough=0.1, freq=1.4, subdiv=3, seed=rnd.random() * 60)
        mb.add(v, f, (1, 1, 1, 1))
    mat = C.cloud_material('storm_cloud', top='#9a9cc0', mid='#5e5f86', low='#2e2c47', glow='#8f6dff', glow_strength=0.1,
                           z_low=-0.45, z_top=1.0, ao_tint='#4b3f86', sheen=0.3)
    mb.build('storm_cloud', mat)
    finish('storm')


def puff() -> None:
    """A round cartoon smoke puff (white, soft blue-grey in the folds)."""
    begin('puff', elev=6.0)
    mb = lib.MeshBuilder()
    rnd = random.Random(5)
    for (x, z, r) in [(0.0, 0.05, 0.55), (-0.52, -0.12, 0.42), (0.55, -0.1, 0.44), (-0.28, 0.45, 0.38), (0.32, 0.46, 0.4),
                      (0.0, -0.42, 0.4), (-0.75, 0.25, 0.26), (0.8, 0.28, 0.27), (0.0, 0.72, 0.26)]:
        v, f = lib.blob((x, rnd.uniform(-0.15, 0.15), z), r, squash=(1.0, 1.0, 0.95), rough=0.08, freq=1.5, subdiv=3, seed=rnd.random() * 70)
        mb.add(v, f, (1, 1, 1, 1))
    mat = C.cloud_material('smoke', top='#ffffff', mid='#f1f3f8', low='#c3c9da', glow='#ffffff', glow_strength=0.18,
                           z_low=-0.8, z_top=0.95, ao_tint='#b3bbd2', sheen=0.35)
    mb.build('smoke', mat)
    finish('puff')


JOBS = {'cloud': golden_cloud, 'ring': ring, 'orb': orb, 'storm': storm, 'puff': puff}
for key, job in JOBS.items():
    if ONLY is None or key in ONLY:
        job()
