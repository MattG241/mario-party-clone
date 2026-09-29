"""Gameplay sprites for the Hero Heights minigames (small toy models, transparent backgrounds).

    <bpy python> scripts/art/worlds/heroes/mg_sprites.py [--preview] [--only drone,zip,...]

Repulsor Range: drone, zip, heavy, gold (flying targets), disc (pop-up target), balloon, balloon_b,
balloon_c (civilian balloons: the game seats a festival friend in the basket), pad (hover pad).
Rooftop Glide: lamp_head (the searchlight drum the game turns; pivot at (28, 44) of 56x60).
Each is rendered at the size the game draws it (the same canvas as its painted fallback, with the
same anchor), into public/assets/rendered/mg/heroes_<name>.webp, plus half-size Lite copies.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mg_city as C  # noqa: E402

PREVIEW = '--preview' in sys.argv
ONLY = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
MG = os.path.join(C.PUB, 'mg')
LITE_MG = os.path.join(C.ROOT, 'public', 'assets', 'lite', 'mg')
SS = 4  # supersample: render at 4x and scale down (crisp small sprites)

# name: (width, height, anchor px (the point the game positions), view pitch degrees)
SPRITES = {
    'drone': (110, 80, (55, 40), 12),
    'zip': (96, 64, (48, 32), 8),
    'heavy': (150, 130, (75, 65), 12),
    'gold': (110, 80, (55, 40), 12),
    'disc': (120, 160, (60, 80), 6),
    'balloon': (140, 200, (70, 62), 6),
    'balloon_b': (140, 200, (70, 62), 6),
    'balloon_c': (140, 200, (70, 62), 6),
    'pad': (200, 70, (100, 32), 14),
    'lamp_head': (56, 60, (28, 44), 4),
}


def build(name: str):
    """Model one sprite around the origin (1 unit = 100 px at 1x); returns nothing (objects are in the scene)."""
    import lib
    from lib import MeshBuilder
    body, metal, glow, dark, soft = (MeshBuilder() for _ in range(5))
    if name in ('drone', 'gold'):
        gold = name == 'gold'
        shell = '#f2c14e' if gold else '#c9d2e6'
        C.sphere(body, 0, 0, -0.02, 0.33, shell, squash=(1.0, 0.85, 0.8))
        C.sphere(dark, 0, -0.2, 0.0, 0.2, '#6a3c08' if gold else '#23304a', squash=(1.1, 0.55, 0.5))
        C.sphere(glow, 0, -0.29, 0.0, 0.07, '#ffffff' if gold else '#ff4a3a', subdiv=1)
        for sx in (-0.33, 0.33):
            C.box(metal, sx - 0.03, -0.03, 0.12, sx + 0.03, 0.03, 0.26, '#6c7892')
            C.cyl(metal, sx, 0.0, 0.24, 0.07, 0.07, 0.05, '#4c5468', 12)
            C.cyl(soft, sx, 0.0, 0.3, 0.2, 0.2, 0.012, '#e8f4ff', 24)
        C.box(metal, -0.33, -0.02, 0.14, 0.33, 0.02, 0.18, '#6c7892')
    elif name == 'zip':
        verts = [(0.45, 0, 0), (-0.38, -0.1, 0.26), (-0.22, 0, 0), (-0.38, -0.1, -0.26), (-0.38, 0.12, 0)]
        faces = [(0, 1, 2), (0, 2, 3), (0, 4, 1), (0, 3, 4), (1, 4, 2), (2, 4, 3)]
        from lib import col
        body.add(verts, faces, col('#f09a3a'))
        C.sphere(glow, 0.0, -0.06, 0.0, 0.07, '#5ce1ff', subdiv=1)
        C.box(dark, -0.4, -0.03, -0.05, -0.3, 0.05, 0.05, '#3c4254')
    elif name == 'heavy':
        ring = [(math.cos(i * math.pi / 3) * 0.62, 0.0, math.sin(i * math.pi / 3) * 0.52) for i in range(6)]
        back = [(x * 0.92, 0.3, z * 0.92) for (x, _, z) in ring]
        from lib import col
        faces = [(i, (i + 1) % 6, 6 + (i + 1) % 6, 6 + i) for i in range(6)] + [tuple(range(5, -1, -1)), tuple(range(6, 12))]
        body.add(ring + back, faces, col('#5c6680'))
        for i, (px, pz) in enumerate([(-0.3, 0.2), (0.3, 0.2), (0.0, -0.28)]):
            C.box(metal, px - 0.16, -0.08, pz - 0.1, px + 0.16, 0.0, pz + 0.1, '#aab4c8', bevel=0.02)
        C.box(dark, -0.26, -0.1, -0.06, 0.26, -0.02, 0.06, '#23304a')
        C.box(glow, -0.2, -0.11, -0.03, 0.2, -0.1, 0.03, '#ffb02a')
        for sx in (-0.62, 0.62):
            C.cyl(metal, sx, 0.15, -0.1, 0.08, 0.06, 0.2, '#4c5468', 10)
    elif name == 'disc':
        C.box(metal, -0.04, 0.02, -0.8, 0.04, 0.1, -0.2, '#5c6680')
        C.box(metal, -0.2, -0.05, -0.8, 0.2, 0.15, -0.74, '#4c5468')
        for r, c in [(0.54, '#ffffff'), (0.44, '#e5484d'), (0.32, '#ffffff'), (0.2, '#e5484d'), (0.09, '#ffd05a')]:
            y = -0.02 - (0.54 - r) * 0.04
            verts = [(0, y, 0.24)] + [(math.cos(a) * r, y, 0.24 + math.sin(a) * r) for a in (k / 40 * math.tau for k in range(40))]
            faces = [(0, 1 + (k + 1) % 40, 1 + k) for k in range(40)]
            from lib import col
            body.add(verts, faces, col(c))
        # a metal backing plate with a rim, behind the rings (a disc facing the camera, along y)
        n = 40
        ring = [(math.cos(k / n * math.tau) * 0.58, math.sin(k / n * math.tau) * 0.58) for k in range(n)]
        verts = [(x, 0.0, 0.24 + z) for (x, z) in ring] + [(x, 0.07, 0.24 + z) for (x, z) in ring]
        faces = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)] + [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
        from lib import col
        metal.add(verts, faces, col('#8a96b8'))
    elif name.startswith('balloon'):
        colr = {'balloon': '#ff6b8a', 'balloon_b': '#5ce1ff', 'balloon_c': '#ffd05a'}[name]
        C.sphere(body, 0, 0, 0.0, 0.56, colr, squash=(1.0, 1.0, 1.1), subdiv=3)
        C.sphere(soft, -0.18, -0.4, 0.22, 0.12, '#ffffff', squash=(1.0, 0.5, 1.3), subdiv=1)
        # a band of little flags round its middle, and the ropes down to the basket
        for k in range(10):
            a = k / 10 * math.tau
            C.sphere(metal, math.cos(a) * 0.55, math.sin(a) * 0.55, -0.05, 0.035, '#fff4dc', subdiv=1)
        for sx in (-0.2, 0.2):
            C.box(dark, sx - 0.008, -0.01, -1.02, sx + 0.008, 0.01, -0.52, '#5a4030')
        C.box(body, -0.2, -0.16, -1.2, 0.2, 0.16, -0.9, '#b07a45', bevel=0.03)
        C.box(dark, -0.21, -0.17, -0.94, 0.21, 0.17, -0.9, '#7a5030')
    elif name == 'pad':
        C.cyl(metal, 0, 0, -0.12, 0.92, 0.95, 0.12, '#6c7892', 40)
        C.cyl(body, 0, 0, 0.0, 0.95, 0.9, 0.06, '#aab4c8', 40)
        C.cyl(glow, 0, 0, 0.06, 0.72, 0.72, 0.012, '#5ce1ff', 40)
        C.cyl(body, 0, 0, 0.061, 0.62, 0.62, 0.012, '#8a96b8', 40)
        for k in range(8):
            a = k / 8 * math.tau
            C.sphere(glow, math.cos(a) * 0.86, math.sin(a) * 0.86, -0.02, 0.04, '#ffe08a', subdiv=1)
    elif name == 'lamp_head':
        # drum pointing up, pivot at the origin (the yoke bolt)
        C.box(metal, -0.18, -0.08, -0.08, 0.18, 0.08, 0.04, '#2a3140')
        C.cyl(body, 0, 0, 0.02, 0.13, 0.15, 0.32, '#56607a', 20)
        C.cyl(glow, 0, 0, 0.34, 0.14, 0.14, 0.03, '#fff6d0', 20)
        C.cyl(dark, 0, 0, -0.03, 0.05, 0.05, 0.02, '#1b2230', 12)
    C.build(body, f'{name}_body', C.mat('paint'))
    C.build(metal, f'{name}_metal', C.mat('metal'))
    C.build(glow, f'{name}_glow', C.mat('glow'))
    C.build(dark, f'{name}_dark', C.mat('paint'))
    C.build(soft, f'{name}_soft', C.mat('softglow'))
    del lib


def render_one(name: str):
    import bpy
    import lib
    from PIL import Image
    w, h, (ax, ay), pitch = SPRITES[name]
    C.setup(24, PREVIEW, transparent=True, exposure=0.0)
    lib.world_light(0.9, zenith='#8f96e0', horizon='#ffc0a0', ground='#4a4060')
    lib.sun(energy=2.6, elevation=40, azimuth=-40, angle=4.0, color='#fff0dc')
    lib.sun(energy=0.9, elevation=20, azimuth=150, angle=5.0, color='#a8b8ff')
    build(name)
    # Orthographic camera looking along +y, tipped down by `pitch`; the model's origin lands on the anchor.
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.sensor_fit = 'HORIZONTAL'
    cd.ortho_scale = w / 100.0
    ob = bpy.data.objects.new('cam', cd)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.scene.camera = ob
    p = math.radians(pitch)
    d = (0.0, math.cos(p), -math.sin(p))
    up = (0.0, math.sin(p), math.cos(p))
    # frame centre relative to the anchor (in px, y down) -> world offset along the camera's up axis
    ox = (w / 2 - ax) / 100.0
    oy = -(h / 2 - ay) / 100.0
    centre = (ox, up[1] * oy, up[2] * oy)
    ob.location = (centre[0] - d[0] * 50, centre[1] - d[1] * 50, centre[2] - d[2] * 50)
    ob.rotation_euler = (math.pi / 2 - p, 0.0, 0.0)
    sc = bpy.context.scene
    k = 1 if PREVIEW else SS
    sc.render.resolution_x = w * k
    sc.render.resolution_y = h * k
    path = os.path.join(C.OUT, f'spr_{name}.png')
    C.render(path)
    if PREVIEW:
        return
    im = Image.open(path).convert('RGBA').resize((w, h), Image.LANCZOS)
    im.save(os.path.join(MG, f'heroes_{name}.webp'), 'WEBP', quality=92, method=6)
    os.makedirs(LITE_MG, exist_ok=True)
    im.resize((max(1, w // 2), max(1, h // 2)), Image.LANCZOS).save(os.path.join(LITE_MG, f'heroes_{name}.webp'), 'WEBP', quality=92, method=6)
    print('wrote', f'mg/heroes_{name}.webp')


for n in SPRITES:
    if ONLY and n not in ONLY:
        continue
    render_one(n)
