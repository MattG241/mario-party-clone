"""Rooftop Glide arena: the Hero Heights skyline on a moonlit night (side-on, 1920x1080).

    <bpy python> scripts/art/worlds/heroes/mg_rooftop.py [--preview]

Roof decks, vents, searchlight pedestals and mast tips must match the game's layout
(src/game/worlds/heroes/glideRules.ts ROOFS / VENTS / LAMPS, and the blinkers in RooftopGlide.ts):
the game stands the gliders on these roof edges, raises updrafts from these vents and turns its
searchlight heads on these pedestals. Writes public/assets/rendered/scene_heroes_rooftops.webp
(+ the half-size blurred intro backdrop).
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mg_city as C  # noqa: E402

import lib  # noqa: E402
from lib import MeshBuilder, col  # noqa: E402

PREVIEW = '--preview' in sys.argv

# Screen-space layout (keep in step with glideRules.ts).
ROOFS = [(-200, 232, 604), (232, 522, 826), (522, 760, 700), (760, 1152, 884), (1152, 1400, 722), (1400, 1690, 834), (1690, 2120, 620)]
VENTS = [(377, 826), (956, 884), (1545, 834)]
LAMPS = [(641, 662), (1276, 684)]
MASTS = [(128, 470), (1790, 486)]
MOON = (1560, 236, 70)
PARAPET = 0.14
WALLS = ['#7d5d7e', '#a4584c', '#5d77a8', '#b98f68', '#4f8a8e', '#9a5f78', '#6a6aa6']
TRIMS = ['#d8c2dc', '#f0c8a8', '#c4d4f2', '#f2dcb8', '#bfe4de', '#f0c8d8', '#cfd0f4']


def deck_z(sy: float) -> float:
    """World z of a roof deck whose parapet top shows at screen y `sy` (feet stand on that line)."""
    return C.fz(sy) - PARAPET


def main():
    C.setup(22, PREVIEW, exposure=0.0)
    C.camera(0.5 if PREVIEW else 1.0)
    lib.world_light(0.62, zenith='#5a74c8', horizon='#3a4a86', ground='#2a2c44')
    lib.sun(energy=2.1, elevation=36, azimuth=40, angle=1.5, color='#d6e2ff')
    # a cool rim from behind the city, so roof edges catch the light and read against the sky
    lib.sun(energy=1.1, elevation=24, azimuth=180, angle=2.0, color='#9fc4ff')
    r = C.rnd(7)

    # --- Sky, moon and stars ------------------------------------------------------------------
    sky = C.sky_material('h_sky', [(0.0, '#46569a'), (0.38, '#26357a'), (0.7, '#15215a'), (1.0, '#0a1236')], stars=0.35, z0=C.fz(1000, 150), z1=C.fz(0, 150))
    C.backdrop('sky', sky, depth=150)
    mx, my, mr = MOON
    mz = C.fz(my, 120)
    moon_m = lib.NT('h_moon')
    pos = moon_m.position()
    nz = moon_m.noise(2.2, 3, 0.6, pos)
    mc = moon_m.mix(moon_m.maprange(nz.outputs['Fac'], 0.45, 0.62), col('#f6f7ff'), col('#d9def2'))
    em = moon_m.node('ShaderNodeEmission')
    moon_m.link(mc, em.inputs['Color'])
    em.inputs['Strength'].default_value = 2.4
    moon_m.link(em.outputs['Emission'], moon_m.out.inputs['Surface'])
    C.disc('moon', mx / 100, mz, 120, mr / 100, moon_m.mat, '#ffffff')
    C.halo('moon_halo', mx / 100, mz, 121, 3.2, '#9fb4ff', strength=0.9, falloff=2.6)
    C.halo('moon_glow', mx / 100, mz, 119.5, 1.25, '#e8eeff', strength=0.8, falloff=1.6)

    # --- Distant skyline (two layers of silhouettes with tiny lit windows) ------------------------
    far = MeshBuilder()
    x = -60.0
    while x < 1980:
        w = r.uniform(60, 150)
        top = r.uniform(560, 780)
        d = 70.0
        C.box(far, x / 100, d, C.fz(1300, d), (x + w) / 100, d + 2, C.fz(top, d), '#222c58')
        if r.random() < 0.3:
            C.box(far, (x + w * 0.4) / 100, d + 0.5, C.fz(top, d), (x + w * 0.6) / 100, d + 1.0, C.fz(top - r.uniform(30, 80), d), '#2a3668')
        x += w + r.uniform(-10, 25)
    far.build('far_city', C.facade_material('h_far', lit='#ffcf7a', lit_frac=0.16, cell=(0.28, 0.3), win=(0.12, 0.14), seed=3.0, glass='#1c2550', emit=1.3))
    mid = MeshBuilder()
    x = -80.0
    while x < 2000:
        w = r.uniform(110, 230)
        top = r.uniform(600, 820)
        d = 34.0
        C.box(mid, x / 100, d, C.fz(1300, d), (x + w) / 100, d + 3, C.fz(top, d), r.choice(['#303e70', '#35406c', '#2d3b6c']), bevel=0.04)
        # a stepped crown now and then
        if r.random() < 0.45:
            C.box(mid, (x + w * 0.2) / 100, d + 0.4, C.fz(top, d), (x + w * 0.8) / 100, d + 2.6, C.fz(top - r.uniform(20, 50), d), '#3a4a80')
        x += w + r.uniform(0, 40)
    mid.build('mid_city', C.facade_material('h_mid', lit='#ffd58a', lit_frac=0.24, cell=(0.36, 0.4), win=(0.18, 0.22), seed=5.0, glass='#202b56', emit=1.6))
    blink = MeshBuilder()
    for (bx, top) in [(300, 560), (820, 600), (1180, 580), (1450, 620)]:
        C.antenna(blink, blink, bx / 100, 36.5, C.fz(top, 36.5), 0.8)
    blink.build('far_masts', C.mat('softglow'))

    # --- The rooftops ---------------------------------------------------------------------------
    trim, deck, metal, dark, wood, glow, paint = (MeshBuilder() for _ in range(7))
    walls = [MeshBuilder() for _ in ROOFS]
    for i, (x0, x1, sy) in enumerate(ROOFS):
        depth = 3.2 if i in (0, 6) else 2.8
        C.building({'wall': walls[i], 'trim': trim, 'deck': deck}, x0 / 100, x1 / 100, deck_z(sy), depth=depth, bottom=C.fz(1400), wall=WALLS[i], trim=TRIMS[i], deck='#9a9fbe')
    for i, mb in enumerate(walls):
        mb.build(f'block_{i}', C.facade_material(f'h_block_{i}', lit_frac=0.4 if i % 2 else 0.48, seed=10.0 + i, cell=(0.5, 0.56), win=(0.26, 0.32), glass='#26345e', emit=2.6))

    # Vents: low exhaust grates with a warm glow in their slats.
    for (vx, sy) in VENTS:
        top = deck_z(sy)
        cx = vx / 100
        C.box(metal, cx - 0.56, 0.35, top, cx + 0.56, 0.95, top + 0.22, '#8a93a8', bevel=0.03)
        for k in range(7):
            sx = cx - 0.45 + k * 0.15
            C.box(dark, sx - 0.04, 0.32, top + 0.04, sx + 0.04, 0.36, top + 0.18, '#1a1e2a')
            C.box(glow, sx - 0.03, 0.34, top + 0.06, sx + 0.03, 0.37, top + 0.16, '#ff9a4a')
        C.box(metal, cx - 0.62, 0.3, top + 0.2, cx + 0.62, 1.0, top + 0.25, '#a7afc2')

    # Searchlight pedestals (the game turns the lamp heads on top).
    for (lx, ly) in LAMPS:
        roof = next(ry for (a, b, ry) in ROOFS if a <= lx < b)
        top = deck_z(roof)
        pz = C.fz(ly + 30, 0.55)
        cx = lx / 100
        C.cyl(metal, cx, 0.55, top, 0.34, 0.3, 0.1, '#4c5468', 20)
        C.cyl(metal, cx, 0.55, top + 0.1, 0.16, 0.12, max(0.05, pz - top - 0.1), '#5c6680', 14)
        C.box(metal, cx - 0.26, 0.45, pz - 0.04, cx + 0.26, 0.65, pz + 0.04, '#6c7892')
        for s in (-1, 1):
            C.box(metal, cx + s * 0.26 - 0.03, 0.47, pz - 0.02, cx + s * 0.26 + 0.03, 0.63, pz + 0.26, '#6c7892')
        # cable run and a junction box on the deck
        C.box(dark, cx + 0.4, 0.8, top, cx + 0.62, 1.05, top + 0.2, '#39404f')

    # Tall towers: masts with warning lights (the game blinks them).
    for (mxs, tip) in MASTS:
        roof = next(ry for (a, b, ry) in ROOFS if a <= mxs < b)
        top = deck_z(roof)
        h = C.fz(tip, 1.4) - top
        C.antenna(metal, glow, mxs / 100, 1.4, top, h - 0.05)
    # A water tank on the wide low roof, AC units, a chimney, a rooftop garden and a door hut.
    w0 = deck_z(884)
    C.water_tower(wood, metal, 10.8, 1.9, w0, s=1.15)
    for (ax, sy, dep, s) in [(300, 826, 1.6, 1.0), (470, 826, 2.1, 0.8), (1210, 722, 1.8, 0.9), (1450, 834, 2.0, 1.0), (1650, 834, 1.2, 0.8), (840, 884, 2.2, 0.9)]:
        C.ac_unit(metal, dark, ax / 100, dep, deck_z(sy), s)
    # door hut with a warm lit door on the lamp roof
    h0 = deck_z(700)
    C.box(trim, 5.55, 1.6, h0, 6.05, 2.6, h0 + 0.55, '#b8bdd6')
    C.box(glow, 5.7, 1.58, h0 + 0.02, 5.9, 1.62, h0 + 0.38, '#ffcf7a')
    C.box(trim, 5.5, 1.55, h0 + 0.55, 6.1, 2.65, h0 + 0.62, '#8a90ad')
    # chimney stack on the right lamp roof
    c0 = deck_z(722)
    C.box(trim, 13.55, 2.0, c0, 13.85, 2.3, c0 + 0.7, '#a0786a')
    C.box(dark, 13.5, 1.95, c0 + 0.7, 13.9, 2.35, c0 + 0.78, '#4a3a38')
    # planters with little shrubs along the back of the leftmost low roof
    leaf = MeshBuilder()
    for k in range(4):
        px = 2.5 + k * 0.62
        C.box(wood, px - 0.24, 2.2, deck_z(826), px + 0.24, 2.55, deck_z(826) + 0.2, '#8a5a3a')
        C.sphere(leaf, px, 2.37, deck_z(826) + 0.32, 0.22, r.choice(['#3f8a5a', '#4d9a62', '#357a52']), squash=(1.2, 1.0, 0.9), subdiv=1)
    # fire escape zig-zags on two facades
    for (fx0, fx1, sy) in [(560, 730, 700), (1430, 1660, 834)]:
        top = deck_z(sy)
        for k in range(1, 5):
            z = top - 1.35 * k + 0.3
            C.box(metal, fx0 / 100, -0.45, z, fx1 / 100, -0.05, z + 0.04, '#3c4254')
            C.box(metal, fx0 / 100, -0.47, z + 0.04, fx1 / 100, -0.43, z + 0.36, '#3c4254')
            s0, s1 = (fx0, fx1) if k % 2 else (fx1, fx0)
            steps = 6
            for j in range(steps):
                u = j / steps
                sx = (s0 + (s1 - s0) * (0.15 + 0.7 * u)) / 100
                C.box(metal, sx - 0.06, -0.4, z - 1.3 + 1.3 * (1 - u), sx + 0.06, -0.1, z - 1.3 + 1.3 * (1 - u) + 0.03, '#3c4254')

    trim.build('trims', C.mat('paint'))
    deck.build('decks', C.mat('deck'))
    metal.build('metal', C.mat('metal'))
    dark.build('dark', C.mat('paint'))
    wood.build('wood', C.mat('paint'))
    glow.build('glow', C.mat('glow'))
    leaf.build('leaves', C.mat('paint'))
    paint.build('paint', C.mat('paint'))

    # Warm light pooling round each searchlight, and the vents' glow on the decks.
    import bpy
    for (lx, ly) in LAMPS:
        ld = bpy.data.lights.new('lamp_glow', 'POINT')
        ld.energy = 55.0
        ld.color = col('#ffd9a0')[:3]
        ld.shadow_soft_size = 0.4
        ob = bpy.data.objects.new('lamp_glow', ld)
        ob.location = (lx / 100, -0.6, C.fz(ly, 0) + 0.2)
        bpy.context.scene.collection.objects.link(ob)
    for (vx, sy) in VENTS:
        ld = bpy.data.lights.new('vent_glow', 'POINT')
        ld.energy = 18.0
        ld.color = col('#ff9a5a')[:3]
        ld.shadow_soft_size = 0.5
        ob = bpy.data.objects.new('vent_glow', ld)
        ob.location = (vx / 100, 0.1, deck_z(sy) + 0.35)
        bpy.context.scene.collection.objects.link(ob)

    import mg_dress as dress
    dress.depth_haze(C.CAM_DIST + 12.0, C.CAM_DIST + 75.0, 0.6, color='#2a3670', skip=('h_sky', 'h_moon', 'moon_halo_m', 'moon_glow_m'))

    path = os.path.join(C.OUT, 'rooftops_prev.png' if PREVIEW else 'rooftops.png')
    C.render(path)
    if not PREVIEW:
        C.publish(path, 'heroes_rooftops')
        C.publish_blur('heroes_rooftops')


main()
