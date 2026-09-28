"""Web Swing art: the Hero Heights skyline at sunset.

    <bpy python> scripts/art/worlds/heroes/mg_skyline.py backdrop|street|towers|card [--preview]

backdrop  scene_heroes_skyline.webp (1920x1080, tiles sideways: the game scrolls it slowly behind
          the race as a parallax layer)
street    mg/heroes_street.webp (1920x220, tiles sideways): shopfronts, pavement and road; its kerb
          line sits 105 px down (SWING.STREET_Y in src/game/worlds/heroes/swingRules.ts)
towers    mg/heroes_towers.webp + .json: the buildings the web anchors sit on (atlas frames with an
          `anchors` table: where on each frame the anchor is, and its kind)
card      (Pillow only) scene_heroes_skyline_card.webp + _blur: a composed still for the intro card
Everything tiles or is placed by the game; generic shapes only (no signs, logos or lettering).
"""
from __future__ import annotations

import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mg_city as C  # noqa: E402

WHAT = next((a for a in sys.argv[1:] if not a.startswith('-')), 'backdrop')
PREVIEW = '--preview' in sys.argv
MG = os.path.join(C.PUB, 'mg')
LITE = os.path.join(C.ROOT, 'public', 'assets', 'lite')


def save_pair(im, rel: str, quality: int = 90):
    """Save a sprite under public/assets/rendered/<rel> and its half-size Lite copy under lite/<rel>."""
    from PIL import Image
    full = os.path.join(C.PUB, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    im.save(full, 'WEBP', quality=quality, method=6)
    half = os.path.join(LITE, rel)
    os.makedirs(os.path.dirname(half), exist_ok=True)
    im.resize((max(1, im.width // 2), max(1, im.height // 2)), Image.LANCZOS).save(half, 'WEBP', quality=quality, method=6)
    print('wrote', rel, '(+ lite)')
PERIOD = 19.2  # 1920 px: the backdrop and street repeat every screen width
TOWER_H = 820  # px: frame height of a building sprite


def wrap_dupes(builder, x0: float, x1: float, *args, **kw):
    """Build something spanning [x0, x1] (world units), plus copies one period left/right when it
    comes near the seam, so the image tiles seamlessly (shadows included)."""
    builder(x0, x1, *args, **kw)
    if x1 > PERIOD - 3:
        builder(x0 - PERIOD, x1 - PERIOD, *args, **kw)
    if x0 < 3:
        builder(x0 + PERIOD, x1 + PERIOD, *args, **kw)


# ------------------------------------------------------------------------------------------
def backdrop():
    import lib
    from lib import MeshBuilder
    C.setup(20, PREVIEW, exposure=0.0)
    C.camera(0.5 if PREVIEW else 1.0, pitch=math.radians(4))
    C.PITCH = math.radians(4)
    lib.world_light(0.75, zenith='#8f7ad0', horizon='#ffb48a', ground='#6a4a6a')
    lib.sun(energy=2.4, elevation=9, azimuth=-70, angle=3.0, color='#ffb070')
    lib.sun(energy=0.7, elevation=30, azimuth=110, angle=4.0, color='#b6a0ff')
    sky = C.sky_material('s_sky', [(0.0, '#ffe2a8'), (0.16, '#ffb070'), (0.34, '#f07c7c'), (0.55, '#b5609e'), (0.78, '#6a4a9a'), (1.0, '#3b3a78')],
                         stars=0.0, z0=C.fz(820, 150), z1=C.fz(0, 150))
    C.backdrop('sky', sky, depth=150, pad=1.6)
    # soft sunset clouds (flat emissive-ish streaks)
    cl = MeshBuilder()
    r = random.Random(4)
    for k in range(9):
        cx = r.uniform(0, PERIOD)
        cy = r.uniform(120, 420)
        w = r.uniform(2.0, 4.2)
        for dx in (0.0, -PERIOD, PERIOD):
            C.sphere(cl, cx + dx, 120, C.fz(cy, 120), 1.0, '#ffc3a0', squash=(w, 0.2, 0.18), subdiv=2)
    cl.build('clouds', C.mat('softglow'))
    # far silhouettes and a mid layer of bigger blocks with lit windows
    far = MeshBuilder()
    mid = MeshBuilder()

    def far_block(x0, x1, top, d, color):
        C.box(far, x0, d, C.fz(1300, d), x1, d + 2, C.fz(top, d), color)

    def mid_block(x0, x1, top, d, color):
        C.box(mid, x0, d, C.fz(1300, d), x1, d + 3, C.fz(top, d), color, bevel=0.04)

    x = 0.0
    while x < PERIOD:
        w = r.uniform(0.6, 1.5)
        top = r.uniform(470, 700)
        wrap_dupes(far_block, x, x + w, top, 70.0, '#5a3f78')
        if r.random() < 0.25:  # a spire
            sx = x + w / 2
            wrap_dupes(far_block, sx - 0.06, sx + 0.06, top - r.uniform(60, 120), 70.5, '#5a3f78')
        x += w + r.uniform(-0.1, 0.25)
    x = 0.0
    while x < PERIOD:
        w = r.uniform(1.1, 2.4)
        top = r.uniform(520, 780)
        col = r.choice(['#6a4a7e', '#5e4a82', '#744e7c'])
        wrap_dupes(mid_block, x, x + w, top, 30.0, col)
        if r.random() < 0.4:
            wrap_dupes(mid_block, x + w * 0.2, x + w * 0.8, top - r.uniform(20, 60), 30.4, col)
        x += w + r.uniform(0.0, 0.5)
    far.build('far', C.facade_material('s_far', lit='#ffcf8a', lit_frac=0.18, cell=(0.28, 0.3), win=(0.12, 0.14), seed=2.0, glass='#4a3666', emit=1.2))
    mid.build('mid', C.facade_material('s_mid', lit='#ffd9a0', lit_frac=0.26, cell=(0.36, 0.4), win=(0.18, 0.22), seed=6.0, glass='#4e3c6e', emit=1.6))
    import mg_dress as dress
    dress.depth_haze(C.CAM_DIST + 10.0, C.CAM_DIST + 75.0, 0.5, color='#e08a9a', skip=('s_sky',))
    path = os.path.join(C.OUT, 'skyline_prev.png' if PREVIEW else 'skyline.png')
    C.render(path)
    if not PREVIEW:
        C.publish(path, 'heroes_skyline')


# ------------------------------------------------------------------------------------------
def street():
    import bpy
    import lib
    from lib import MeshBuilder, col
    C.setup(20, PREVIEW, transparent=False, exposure=0.0)
    C.PITCH = math.radians(9)
    # camera centred on the strip: screen y 880..1100 of the game => frame 1920 x 220
    C.camera(0.5 if PREVIEW else 1.0, width_px=1920, height_px=220, cx_px=960, cy_px=990)
    lib.world_light(0.8, zenith='#9a86d8', horizon='#ffb48a', ground='#5a4a5a')
    lib.sun(energy=2.2, elevation=14, azimuth=-60, angle=3.0, color='#ffb878')
    wall, trim, glow, metal, pave, road, awn = (MeshBuilder() for _ in range(7))
    kerb = C.fz(985)
    # road, kerb, pavement
    for dx in (0.0, -PERIOD, PERIOD):
        C.box(road, -1 + dx, -3.0, kerb - 2.0, PERIOD + 1 + dx, 3.0, kerb - 0.16, '#3d4152')
        C.box(pave, -1 + dx, -0.2, kerb - 0.16, PERIOD + 1 + dx, 1.6, kerb, '#9a9fb2')
        C.box(pave, -1 + dx, -0.3, kerb - 0.3, PERIOD + 1 + dx, -0.2, kerb - 0.02, '#c9cdd9')
    # lane dashes on the road (in front of the kerb)
    for k in range(12):
        x0 = k * 1.6 + 0.3
        C.box(glow, x0, -1.6, kerb - 0.159, x0 + 0.8, -1.45, kerb - 0.155, '#e8d27a')
    # shopfront band along the back of the pavement: awnings and warm shop windows, no lettering
    r = random.Random(12)
    x = 0.0
    while x < PERIOD:
        w = r.uniform(1.6, 2.6)
        colr = r.choice(['#7a5a6e', '#6a5a86', '#8a6a5a', '#5a6a8a'])
        awc = r.choice(['#e0485a', '#2fb7e9', '#f4b83b', '#8bd346', '#c49bff'])

        def shop(x0, x1):
            C.box(wall, x0, 1.6, kerb, x1, 2.6, kerb + 1.6, colr)
            C.box(glow, x0 + 0.2, 1.58, kerb + 0.1, x1 - 0.2, 1.62, kerb + 0.8, '#ffd08a')
            C.box(trim, x0 + 0.15, 1.5, kerb + 0.82, x1 - 0.15, 1.62, kerb + 0.9, '#3a3444')
            # striped awning sloping out over the pavement
            n = max(3, int((x1 - x0) / 0.25))
            for i in range(n):
                sx0 = x0 + 0.1 + (x1 - x0 - 0.2) * i / n
                sx1 = x0 + 0.1 + (x1 - x0 - 0.2) * (i + 1) / n
                c = awc if i % 2 == 0 else '#fff4dc'
                verts = [(sx0, 1.55, kerb + 1.05), (sx1, 1.55, kerb + 1.05), (sx1, 1.05, kerb + 0.82), (sx0, 1.05, kerb + 0.82)]
                awn.add(verts + [(v[0], v[1], v[2] + 0.03) for v in verts], [(0, 1, 2, 3), (7, 6, 5, 4)], col(c))

        wrap_dupes(shop, x, x + w - 0.08)
        x += w
    # street lamps and hydrants along the pavement
    for k in range(4):
        lx = 2.4 + k * 4.8
        C.cyl(metal, lx, 0.5, kerb, 0.05, 0.04, 1.35, '#3c4254', 10)
        C.box(metal, lx - 0.02, 0.45, kerb + 1.32, lx + 0.32, 0.55, kerb + 1.36, '#3c4254')
        C.sphere(glow, lx + 0.3, 0.5, kerb + 1.28, 0.08, '#fff0c8', subdiv=1)
        hx = lx + 2.4
        C.cyl(metal, hx, 0.4, kerb, 0.07, 0.07, 0.22, '#e5484d', 10)
        C.sphere(metal, hx, 0.4, kerb + 0.24, 0.07, '#e5484d', subdiv=1)
    wall.build('shops', C.mat('paint'))
    trim.build('trims', C.mat('paint'))
    glow.build('glow', C.mat('glow'))
    metal.build('metal', C.mat('metal'))
    pave.build('pave', C.mat('deck'))
    road.build('road', C.mat('deck'))
    awn.build('awnings', C.mat('paint'))
    path = os.path.join(C.OUT, 'street_prev.png' if PREVIEW else 'street.png')
    C.render(path)
    if not PREVIEW:
        from PIL import Image
        save_pair(Image.open(path).convert('RGB'), 'mg/heroes_street.webp')
    del bpy


# ------------------------------------------------------------------------------------------
# Building sprites: (kind, width px, colours), each with its anchor point (px within its frame).
TOWERS = [
    ('cornice', 300, '#8f6a86', '#f0d0e0'),
    ('cornice', 320, '#5d77a8', '#c8dcf4'),
    ('mast', 300, '#a4584c', '#f0c8a8'),
    ('mast', 290, '#4f8a8e', '#bfe4de'),
    ('tank', 320, '#b98f68', '#f2dcb8'),
    ('tank', 300, '#6a6aa6', '#cfd0f4'),
    ('crane', 380, '#8594a8', '#dde6f2'),
    ('crane', 380, '#9a5f78', '#f0c8d8'),
]
SLOT = 420  # px between building slots in the render


def towers():
    import lib
    from lib import MeshBuilder
    C.setup(20, PREVIEW, transparent=True, exposure=0.0)
    C.PITCH = math.radians(6)
    n = len(TOWERS)
    width = SLOT * n
    C.camera(0.5 if PREVIEW else 1.0, width_px=width, height_px=TOWER_H, cx_px=width / 2, cy_px=TOWER_H / 2 + 0.0, pitch=math.radians(6))
    lib.world_light(0.8, zenith='#9a86d8', horizon='#ffb48a', ground='#5a4a5a')
    lib.sun(energy=2.4, elevation=12, azimuth=-65, angle=3.0, color='#ffb070')
    lib.sun(energy=0.8, elevation=35, azimuth=120, angle=4.0, color='#b6a0ff')
    trim, deck, metal, wood, glow, crane = (MeshBuilder() for _ in range(6))
    anchors = {}
    for i, (kind, w, wall_c, trim_c) in enumerate(TOWERS):
        cx = SLOT * i + SLOT / 2
        x0 = (cx - w / 2) / 100
        x1 = (cx + w / 2) / 100
        # screen y (within the frame) of the roof line and of the anchor
        roof_y = {'cornice': 48, 'mast': 250, 'tank': 230, 'crane': 300}[kind]
        wall = MeshBuilder()
        top = C.fz(roof_y)
        C.building({'wall': wall, 'trim': trim, 'deck': deck}, x0, x1, top, depth=2.4, bottom=C.fz(TOWER_H + 200), wall=wall_c, trim=trim_c, deck='#9a9fbe')
        wall.build(f'tower_{i}', C.facade_material(f't_wall_{i}', lit='#ffd9a0', lit_frac=0.45, seed=20.0 + i, cell=(0.46, 0.52), win=(0.24, 0.3), glass='#3a3a66', emit=2.2))
        if kind == 'cornice':
            # a stepped crown along the roof; the anchor is its front right corner (the game flips odd ones)
            C.box(trim, x0 - 0.08, -0.12, top + 0.14, x1 + 0.08, 0.3, top + 0.3, trim_c)
            C.box(glow, x1 - 0.1, -0.16, top + 0.2, x1 + 0.04, -0.1, top + 0.3, '#fff2c8')
            anchors[i] = (cx + w / 2 - (cx - SLOT / 2) - 0.0, C.screen_y(top + 0.3, 0.0))
        elif kind == 'mast':
            h = 2.0
            C.antenna(metal, glow, cx / 100, 1.0, top, h)
            anchors[i] = (SLOT / 2, C.screen_y(top + h + 0.03, 1.0))
        elif kind == 'tank':
            C.water_tower(wood, metal, cx / 100, 1.1, top, s=1.5)
            anchors[i] = (SLOT / 2, C.screen_y(top + 0.55 * 1.5 + 0.05 * 1.5 + 0.8 * 1.5 + 0.34 * 1.5, 1.1))
        elif kind == 'crane':
            # a construction crane: a lattice mast on the roof and a jib reaching right
            mx = x0 + 0.5
            mh = 2.4
            for dx in (-0.12, 0.12):
                for dy in (-0.12, 0.12):
                    C.box(crane, mx + dx - 0.02, 1.0 + dy - 0.02, top, mx + dx + 0.02, 1.0 + dy + 0.02, top + mh, '#f2b53a')
            for k in range(8):
                z = top + k * mh / 8
                C.box(crane, mx - 0.14, 0.86, z, mx + 0.14, 1.14, z + 0.03, '#f2b53a')
            jz = top + mh
            jx1 = x1 - 0.06
            C.box(crane, mx - 0.5, 0.9, jz, jx1, 1.1, jz + 0.12, '#f2b53a')
            C.box(crane, mx - 0.5, 0.92, jz - 0.25, mx - 0.2, 1.08, jz, '#6c7892')  # counterweight
            C.box(metal, jx1 - 0.02, 0.98, jz - 0.35, jx1 + 0.02, 1.02, jz, '#3c4254')  # hook line
            anchors[i] = ((jx1 * 100) - (cx - SLOT / 2), C.screen_y(jz - 0.35, 1.0))
    trim.build('trims', C.mat('paint'))
    deck.build('decks', C.mat('deck'))
    metal.build('metal', C.mat('metal'))
    wood.build('wood', C.mat('paint'))
    glow.build('glow', C.mat('glow'))
    crane.build('crane', C.mat('paint'))
    path = os.path.join(C.OUT, 'towers_prev.png' if PREVIEW else 'towers.png')
    C.render(path)
    if PREVIEW:
        return
    pack_towers(path, anchors)


def pack_towers(path: str, anchors: dict):
    """Cut each building out of the wide render and pack them into an atlas (+ Phaser JSON with anchors)."""
    from PIL import Image
    im = Image.open(path).convert('RGBA')
    frames = {}
    cut = []
    for i, (kind, w, _, _) in enumerate(TOWERS):
        x0 = SLOT * i
        crop = im.crop((x0, 0, x0 + SLOT, TOWER_H))
        bbox = crop.getbbox() or (0, 0, SLOT, TOWER_H)
        l, _, rr, _ = bbox
        l = max(0, l - 4)
        rr = min(SLOT, rr + 4)
        cut.append((i, kind, crop.crop((l, 0, rr, TOWER_H)), l))
    per_row = 4
    rows = [cut[k:k + per_row] for k in range(0, len(cut), per_row)]
    aw = max(sum(c[2].width + 4 for c in row) for row in rows)
    ah = len(rows) * (TOWER_H + 4)
    atlas = Image.new('RGBA', (aw, ah), (0, 0, 0, 0))
    table = {}
    y = 0
    for row in rows:
        x = 0
        for (i, kind, img, l) in row:
            atlas.paste(img, (x, y))
            name = f'{kind}_{i}'
            frames[name] = {'frame': {'x': x, 'y': y, 'w': img.width, 'h': img.height}, 'rotated': False, 'trimmed': False,
                            'spriteSourceSize': {'x': 0, 'y': 0, 'w': img.width, 'h': img.height}, 'sourceSize': {'w': img.width, 'h': img.height}}
            ax, ay = anchors[i]
            table[name] = {'anchor': [round(ax - l), round(ay)], 'kind': kind}
            x += img.width + 4
        y += TOWER_H + 4
    save_pair(atlas, 'mg/heroes_towers.webp', quality=92)
    meta = {'frames': frames, 'anchors': table, 'meta': {'image': 'heroes_towers.webp', 'size': {'w': aw, 'h': ah}, 'scale': '1'}}
    with open(os.path.join(MG, 'heroes_towers.json'), 'w') as fh:
        json.dump(meta, fh)
    print('wrote mg/heroes_towers.webp', aw, ah, len(frames), 'frames')


# ------------------------------------------------------------------------------------------
def card():
    """The intro card's still: the backdrop, a run of buildings with their glowing anchors, the street."""
    from PIL import Image, ImageDraw, ImageFilter
    base = Image.open(os.path.join(C.PUB, 'scene_heroes_skyline.webp')).convert('RGBA')
    atlas = Image.open(os.path.join(MG, 'heroes_towers.webp')).convert('RGBA')
    meta = json.load(open(os.path.join(MG, 'heroes_towers.json')))
    street = Image.open(os.path.join(MG, 'heroes_street.webp')).convert('RGBA').resize((1920, 220))
    names = list(meta['frames'].keys())
    spots = [(120, 300), (470, 360), (830, 250), (1190, 330), (1560, 280), (1880, 380)]
    hooks = []
    for k, (ax, ay) in enumerate(spots):
        name = names[(k * 3) % len(names)]
        f = meta['frames'][name]['frame']
        a = meta['anchors'][name]['anchor']
        img = atlas.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
        base.alpha_composite(img, (int(ax - a[0]), int(ay - a[1])))
        hooks.append((ax, ay))
    base.alpha_composite(street, (0, 880))
    d = ImageDraw.Draw(base)
    for (hx, hy) in hooks:
        d.ellipse((hx - 14, hy - 14, hx + 14, hy + 14), outline=(255, 255, 255, 255), width=5)
        d.ellipse((hx - 5, hy - 5, hx + 5, hy + 5), fill=(43, 53, 80, 255))
    # one web line from a hook down to where a swinger would hang
    d.line([(830, 250), (720, 560)], fill=(255, 255, 255, 235), width=6)
    base.convert('RGB').save(os.path.join(C.PUB, 'scene_heroes_skyline_card.webp'), 'WEBP', quality=90, method=6)
    blur = base.convert('RGB').resize((960, 540), Image.LANCZOS).filter(ImageFilter.GaussianBlur(5))
    blur.save(os.path.join(C.PUB, 'scene_heroes_skyline_card_blur.webp'), 'WEBP', quality=82, method=6)
    print('wrote scene_heroes_skyline_card.webp (+ blur)')


if WHAT == 'backdrop':
    backdrop()
elif WHAT == 'street':
    street()
elif WHAT == 'towers':
    towers()
elif WHAT == 'card':
    card()
