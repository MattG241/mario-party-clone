"""Repulsor Range arena: a rooftop test deck high over Hero Heights at dusk (1920x1080).

    <bpy python> scripts/art/worlds/heroes/mg_range.py [--preview]

The sky above the deck is where the targets fly (screen y 170..740, src/game/worlds/heroes/rangeRules.ts)
so it stays open; the deck's front edge sits at RANGE.DECK_Y (770) and the players hover over the
front of it (their pads are drawn by the game). Writes scene_heroes_range.webp (+ blurred backdrop).
"""
from __future__ import annotations

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mg_city as C  # noqa: E402

PREVIEW = '--preview' in sys.argv
DECK_Y = 770


def main():
    import bpy
    import lib
    import mg_dress as dress
    from lib import MeshBuilder, col
    C.setup(22, PREVIEW, exposure=0.0)
    C.camera(0.5 if PREVIEW else 1.0)
    lib.world_light(0.8, zenith='#6a70d0', horizon='#ff9f8a', ground='#3a3050')
    lib.sun(energy=1.6, elevation=10, azimuth=-60, angle=3.0, color='#ffae80')
    lib.sun(energy=1.2, elevation=40, azimuth=150, angle=3.0, color='#a8b8ff')
    r = random.Random(21)
    # Dusk sky with the first stars, and a far city far below the deck
    sky = C.sky_material('r_sky', [(0.0, '#ffc49a'), (0.2, '#f08a8a'), (0.42, '#9a62a8'), (0.7, '#4a4a9a'), (1.0, '#1e2a6a')], stars=0.25,
                         z0=C.fz(900, 150), z1=C.fz(0, 150))
    C.backdrop('sky', sky, depth=150)
    far = MeshBuilder()
    x = -60.0
    while x < 1980:
        w = r.uniform(50, 130)
        top = r.uniform(700, 860)
        C.box(far, x / 100, 60, C.fz(1400, 60), (x + w) / 100, 62, C.fz(top, 60), '#4a3a78')
        x += w + r.uniform(-8, 20)
    far.build('far_city', C.facade_material('r_far', lit='#ffcf8a', lit_frac=0.3, cell=(0.24, 0.26), win=(0.1, 0.12), seed=8.0, glass='#3a2f66', emit=1.6))
    # The deck: a wide slab reaching towards us (the players hover over its front, the targets pop up
    # from its middle at DECK_Y), a bright rim, lane stripes and chevrons, lights along the front edge
    trim, deck, metal, glow, paint, dark = (MeshBuilder() for _ in range(6))
    dz = C.fz(DECK_Y) - 0.08
    front = -12.0
    C.box(deck, -1.0, front, dz - 3.2, 20.2, 9.0, dz, '#5a6488')
    C.box(trim, -1.0, front - 0.12, dz - 0.18, 20.2, front + 0.05, dz + 0.04, '#c8d4f0')
    C.box(glow, -1.0, front - 0.14, dz - 0.3, 20.2, front - 0.1, dz - 0.24, '#5ce1ff')
    for k in range(12):  # lane stripes running back from the front edge
        lx = 0.6 + k * 1.64
        C.box(glow, lx - 0.05, front + 0.6, dz + 0.001, lx + 0.05, 8.5, dz + 0.004, '#8ff0ff')
    for k in range(20):  # hazard chevrons along the front
        cx = 0.3 + k * 0.98
        for sg in (-1, 1):
            y0 = front + 0.25
            verts = [(cx, y0, dz + 0.005), (cx + 0.2 * sg, y0, dz + 0.005), (cx + 0.32 * sg, y0 + 0.3, dz + 0.005), (cx + 0.12 * sg, y0 + 0.3, dz + 0.005)]
            paint.add(verts, [(0, 1, 2, 3) if sg > 0 else (3, 2, 1, 0)], col('#f4b83b'))
    for k in range(10):  # little edge lights
        bx = 0.9 + k * 2.0
        C.cyl(metal, bx, front + 0.12, dz, 0.08, 0.07, 0.18, '#6c7892', 12)
        C.sphere(glow, bx, front + 0.12, dz + 0.22, 0.07, '#ffe08a', subdiv=1)
    # a line of launch markings across the deck where the discs pop up (DECK_Y)
    for k in range(9):
        mx = 1.4 + k * 2.05
        C.cyl(glow, mx, 0.0, dz + 0.002, 0.34, 0.34, 0.004, '#ff9f5a', 24)
        C.cyl(deck, mx, 0.0, dz + 0.004, 0.26, 0.26, 0.004, '#4a5478', 24)
    # Target gantries at the back of the deck (open frames: the sky above stays clear)
    for gx in (2.2, 17.0):
        for dx in (-0.9, 0.9):
            C.box(metal, gx + dx - 0.07, 6.0, dz, gx + dx + 0.07, 6.2, dz + 3.4, '#7c88a8')
        C.box(metal, gx - 1.0, 6.0, dz + 3.3, gx + 1.0, 6.2, dz + 3.5, '#7c88a8')
        C.box(glow, gx - 0.8, 5.98, dz + 3.36, gx + 0.8, 6.0, dz + 3.44, '#ff6b5e')
    # A control booth at the left and floodlight masts at both ends
    C.box(trim, 0.4, 3.0, dz, 2.6, 5.0, dz + 1.6, '#8a96b8')
    C.box(glow, 0.6, 2.98, dz + 0.5, 2.4, 3.0, dz + 1.3, '#9fdcff')
    C.box(dark, 0.3, 2.9, dz + 1.6, 2.7, 5.1, dz + 1.75, '#39405a')
    for mx in (0.4, 18.8):
        C.cyl(metal, mx, 1.5, dz, 0.1, 0.08, 4.6, '#6c7892', 12)
        C.box(metal, mx - 0.5, 1.4, dz + 4.5, mx + 0.5, 1.6, dz + 4.9, '#4c5468')
        for k in range(3):
            C.sphere(glow, mx - 0.32 + k * 0.32, 1.35, dz + 4.7, 0.11, '#fff4d8', subdiv=1)
    # Charging pylons with glowing coils between the lanes at the back
    for px in (6.0, 9.6, 13.2):
        C.cyl(metal, px, 7.5, dz, 0.3, 0.2, 1.2, '#7c88a8', 16)
        for k in range(3):
            C.cyl(glow, px, 7.5, dz + 0.3 + k * 0.3, 0.26, 0.26, 0.06, '#5ce1ff', 16)
    trim.build('trims', C.mat('paint'))
    deck.build('deck', C.mat('deck'))
    metal.build('metal', C.mat('metal'))
    glow.build('glow', C.mat('glow'))
    paint.build('paint', C.mat('paint'))
    dark.build('dark', C.mat('paint'))
    # Floodlight glow on the deck
    for mx in (0.4, 18.8):
        ld = bpy.data.lights.new('flood', 'SPOT')
        ld.energy = 900.0
        ld.spot_size = math.radians(70)
        ld.color = col('#fff0d8')[:3]
        ob = bpy.data.objects.new('flood', ld)
        ob.location = (mx, 1.3, dz + 4.6)
        ob.rotation_euler = (math.radians(35), 0.0, math.radians(-60 if mx < 5 else 60))
        bpy.context.scene.collection.objects.link(ob)
    dress.depth_haze(14.0, 90.0, 0.45, color='#8a6aa8', skip=('r_sky',))
    path = os.path.join(C.OUT, 'range_prev.png' if PREVIEW else 'range.png')
    C.render(path)
    if not PREVIEW:
        C.publish(path, 'heroes_range')
        C.publish_blur('heroes_range')


main()
