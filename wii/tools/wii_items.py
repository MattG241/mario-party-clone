"""The Wii edition's extra items and the icons the web game's atlas lacks (used by build_assets.py).

EXTRA_ITEMS are appended to data::ITEMS after the web game's items, in the order of ItemId in
wii/src/game/Match.h (IT_DOUBLE ... IT_GLOVE). icons() draws 48 px icons for them and for the web items
that have no icon in the items atlas.
"""
from PIL import Image, ImageDraw

EXTRA_ITEMS = [
    {'id': 'double_dice', 'name': 'Double Dice', 'description': 'Roll two Dice Blocks and move the total. Doubles win 10 coins!',
     'price': 8, 'timing': 'preRoll', 'value': 6},
    {'id': 'triple_dice', 'name': 'Triple Dice', 'description': 'Roll three Dice Blocks and move the total. Doubles win 10 coins, triples 30!',
     'price': 12, 'timing': 'preRoll', 'value': 8},
    {'id': 'custom_dice', 'name': 'Custom Dice', 'description': 'Choose your roll: any number from 1 to 10.',
     'price': 7, 'timing': 'preRoll', 'value': 7},
    {'id': 'golden_pipe', 'name': 'Golden Pipe', 'description': 'Warps you straight to the Star Coin. Your turn ends there.',
     'price': 20, 'timing': 'preRoll', 'value': 9},
    {'id': 'duel_glove', 'name': 'Duelling Glove', 'description': 'Challenge a rival to a Duel for coins before you roll.',
     'price': 6, 'timing': 'preRoll', 'value': 5},
]

CELL = 48


def _die(d: ImageDraw.ImageDraw, x, y, s, pips, fill=(255, 255, 255), pip=(40, 50, 70), rot=0):
    d.rounded_rectangle((x, y, x + s, y + s), radius=s // 5, fill=fill, outline=(60, 70, 90), width=2)
    spots = {1: [(0.5, 0.5)], 2: [(0.27, 0.27), (0.73, 0.73)], 3: [(0.27, 0.27), (0.5, 0.5), (0.73, 0.73)],
             5: [(0.27, 0.27), (0.73, 0.27), (0.5, 0.5), (0.27, 0.73), (0.73, 0.73)], 6: [(0.27, 0.25), (0.73, 0.25), (0.27, 0.5), (0.73, 0.5), (0.27, 0.75), (0.73, 0.75)]}
    r = max(2, s // 9)
    for fx, fy in spots.get(pips, []):
        cx, cy = x + fx * s, y + fy * s
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=pip)


def _icon(kind: str) -> Image.Image:
    im = Image.new('RGBA', (CELL * 4, CELL * 4), (0, 0, 0, 0))  # drawn at 4x, then scaled down
    d = ImageDraw.Draw(im)
    S = CELL * 4
    if kind == 'double_dice':
        _die(d, 14, 52, 100, 2)
        _die(d, 82, 70, 100, 5, fill=(255, 240, 200))
    elif kind == 'triple_dice':
        _die(d, 8, 30, 84, 1)
        _die(d, 100, 30, 84, 3, fill=(255, 240, 200))
        _die(d, 54, 100, 84, 6, fill=(220, 240, 255))
    elif kind == 'custom_dice':
        _die(d, 30, 30, 132, 0, fill=(200, 170, 255))
        d.text((S * 0.36, S * 0.2), '?', fill=(60, 30, 110), font_size=110)
    elif kind == 'golden_pipe':
        d.rounded_rectangle((40, 70, 152, 180), radius=10, fill=(230, 170, 30), outline=(150, 100, 10), width=4)
        d.rounded_rectangle((26, 30, 166, 80), radius=12, fill=(250, 200, 60), outline=(150, 100, 10), width=4)
        d.rectangle((60, 82, 76, 172), fill=(255, 225, 120))
    elif kind == 'duel_glove':
        d.rounded_rectangle((44, 60, 150, 170), radius=40, fill=(225, 60, 60), outline=(120, 20, 20), width=4)
        d.rounded_rectangle((20, 92, 70, 140), radius=20, fill=(225, 60, 60), outline=(120, 20, 20), width=4)
        d.rectangle((58, 150, 140, 182), fill=(250, 250, 250), outline=(120, 20, 20), width=4)
    elif kind == 'warp_charm':
        d.ellipse((30, 30, 162, 162), fill=(80, 210, 220), outline=(20, 110, 130), width=5)
        d.ellipse((62, 62, 130, 130), fill=(20, 110, 130))
        d.arc((44, 44, 148, 148), 200, 340, fill=(255, 255, 255), width=8)
    elif kind == 'magnet_glove':
        d.arc((34, 30, 158, 154), 180, 360, fill=(220, 50, 60), width=34)
        d.rectangle((34, 92, 68, 150), fill=(220, 50, 60))
        d.rectangle((124, 92, 158, 150), fill=(220, 50, 60))
        d.rectangle((34, 140, 68, 170), fill=(230, 230, 235))
        d.rectangle((124, 140, 158, 170), fill=(230, 230, 235))
    elif kind == 'spring_bean':
        d.ellipse((52, 40, 140, 168), fill=(110, 200, 80), outline=(50, 110, 40), width=5)
        d.arc((70, 60, 120, 150), 100, 260, fill=(200, 250, 170), width=8)
    return im.resize((CELL, CELL), Image.LANCZOS)


# web items without an atlas icon, then the extras
ICON_KINDS = ['warp_charm', 'magnet_glove', 'spring_bean'] + [it['id'] for it in EXTRA_ITEMS]


def icons() -> list[tuple[str, Image.Image]]:
    return [(k, _icon(k)) for k in ICON_KINDS]
