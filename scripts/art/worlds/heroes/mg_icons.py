"""Rule-card icons for the three Hero Heights minigames (painted, 128x128, transparent).

    python3 scripts/art/worlds/heroes/mg_icons.py

Writes public/assets/rendered/scene_heroes_icon_<name>.webp (they load with each game's arena set,
see src/game/worlds/heroes/info.ts) and the half-size Lite copies. Original, generic drawings: no
emblems or logos.
"""
from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
PUB = os.path.join(ROOT, 'public', 'assets', 'rendered')
LITE = os.path.join(ROOT, 'public', 'assets', 'lite')
S = 512  # drawn at 4x, then scaled down (anti-aliasing)
INK = (31, 41, 64, 255)
W = 22  # outline width at 4x


def canvas():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def save(im: Image.Image, name: str):
    small = im.resize((128, 128), Image.LANCZOS)
    small.save(os.path.join(PUB, f'scene_heroes_icon_{name}.webp'), 'WEBP', quality=92, method=6)
    small.resize((64, 64), Image.LANCZOS).save(os.path.join(LITE, f'scene_heroes_icon_{name}.webp'), 'WEBP', quality=92, method=6)
    print('icon', name)


def poly(d, pts, fill, outline=INK, width=W):
    d.polygon(pts, fill=fill)
    d.line(pts + [pts[0]], fill=outline, width=width, joint='curve')


def ellipse(d, box, fill, outline=INK, width=W):
    d.ellipse(box, fill=fill, outline=outline, width=width)


def arc_pts(cx, cy, rx, ry, a0, a1, n=40):
    return [(cx + math.cos(a0 + (a1 - a0) * i / n) * rx, cy + math.sin(a0 + (a1 - a0) * i / n) * ry) for i in range(n + 1)]


def figure(d, cx, cy, s=1.0, color=(255, 214, 170, 255), suit=(94, 118, 220, 255)):
    """A tiny round-headed figure (generic)."""
    ellipse(d, (cx - 40 * s, cy - 40 * s, cx + 40 * s, cy + 40 * s), color)
    poly(d, [(cx - 34 * s, cy + 36 * s), (cx + 34 * s, cy + 36 * s), (cx + 26 * s, cy + 110 * s), (cx - 26 * s, cy + 110 * s)], suit)


def icon_cape():
    im, d = canvas()
    # a wide glider canopy with a little figure hanging below it
    top = arc_pts(256, 250, 210, 170, math.pi, 2 * math.pi)
    bot = arc_pts(256, 262, 210, 60, 0, math.pi)[::-1]
    pts = top + bot[::-1][1:-1][::-1]
    poly(d, top + [(466, 250), (256, 225), (46, 250)][1:2] + [(46, 250)], (74, 95, 193, 255))
    for x in (160, 256, 352):
        d.line([(x, 110 if x == 256 else 140), (x, 238)], fill=(40, 52, 120, 255), width=10)
    d.line([(150, 245), (225, 330)], fill=INK, width=12)
    d.line([(362, 245), (287, 330)], fill=INK, width=12)
    figure(d, 256, 360, 0.9)
    del pts
    save(im, 'cape')


def icon_vent():
    im, d = canvas()
    poly(d, [(96, 360), (416, 360), (416, 452), (96, 452)], (154, 164, 188, 255))
    for i in range(6):
        x = 128 + i * 52
        d.rectangle([x, 380, x + 26, 432], fill=(255, 150, 80, 255))
    for k, x in enumerate((176, 256, 336)):
        pts = [(x + math.sin(t / 10 * math.pi * 2 + k) * 22, 330 - t * 26) for t in range(11)]
        d.line(pts, fill=INK, width=W + 12, joint='curve')
        d.line(pts, fill=(200, 240, 255, 255), width=W - 4, joint='curve')
    poly(d, [(256, 40), (206, 100), (306, 100)], (200, 240, 255, 255))
    save(im, 'vent')


def hexagon(d, cx, cy, r, fill):
    pts = [(cx + math.cos(math.pi / 6 + i * math.pi / 3) * r, cy + math.sin(math.pi / 6 + i * math.pi / 3) * r) for i in range(6)]
    poly(d, pts, fill)


def magnifier(d, cx, cy, r, color=(255, 255, 255, 255)):
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=color, width=int(r * 0.32))
    d.line([(cx + r * 0.7, cy + r * 0.7), (cx + r * 1.6, cy + r * 1.6)], fill=color, width=int(r * 0.42))


def icon_clue():
    im, d = canvas()
    hexagon(d, 256, 256, 200, (92, 225, 255, 255))
    hexagon(d, 256, 256, 150, (40, 150, 200, 255))
    magnifier(d, 236, 236, 70)
    save(im, 'clue')


def icon_lamp():
    im, d = canvas()
    # a searchlight casting a beam up and to the right
    d.polygon([(250, 300), (470, 40), (500, 150)], fill=(255, 240, 180, 200))
    poly(d, [(170, 250), (300, 190), (340, 280), (210, 340)], (110, 124, 150, 255))
    ellipse(d, (280, 180, 360, 290), (255, 246, 200, 255))
    poly(d, [(200, 330), (250, 330), (270, 440), (180, 440)], (80, 90, 110, 255))
    poly(d, [(120, 440), (330, 440), (330, 480), (120, 480)], (60, 70, 90, 255))
    save(im, 'lamp')


def icon_web():
    im, d = canvas()
    # an anchor hook high up with a web line swinging down to a figure
    d.line([(380, 90), (170, 360)], fill=INK, width=W + 10)
    d.line([(380, 90), (170, 360)], fill=(255, 255, 255, 255), width=W - 4)
    ellipse(d, (330, 40, 430, 140), (200, 246, 255, 255))
    ellipse(d, (360, 70, 400, 110), (43, 53, 80, 255), width=0)
    figure(d, 160, 380, 0.8, suit=(224, 72, 90, 255))
    save(im, 'web')


def icon_fling():
    im, d = canvas()
    # a curved arrow sweeping up and forward, with a burst at its start
    pts = arc_pts(260, 420, 200, 300, math.pi * 1.02, math.pi * 1.62)
    d.line(pts, fill=INK, width=W + 34, joint='curve')
    d.line(pts, fill=(143, 230, 255, 255), width=W + 8, joint='curve')
    ex, ey = pts[-1]
    poly(d, [(ex + 70, ey + 10), (ex - 30, ey - 60), (ex - 10, ey + 70)], (143, 230, 255, 255))
    for i in range(8):
        a = i / 8 * math.tau
        d.line([(110 + math.cos(a) * 30, 400 + math.sin(a) * 30), (110 + math.cos(a) * 70, 400 + math.sin(a) * 70)], fill=(255, 224, 138, 255), width=16)
    save(im, 'fling')


def icon_street():
    im, d = canvas()
    # a figure dropping to the street (arrow down, a road below)
    poly(d, [(60, 400), (452, 400), (452, 470), (60, 470)], (70, 76, 96, 255))
    for x in (110, 240, 370):
        d.rectangle([x, 428, x + 60, 442], fill=(232, 210, 122, 255))
    poly(d, [(256, 360), (176, 250), (226, 250), (226, 60), (286, 60), (286, 250), (336, 250)], (255, 138, 92, 255))
    save(im, 'street')


def icon_flag():
    im, d = canvas()
    d.line([(130, 60), (130, 470)], fill=INK, width=W + 10)
    d.line([(130, 60), (130, 470)], fill=(242, 193, 78, 255), width=W - 6)
    x0, y0, cw = 150, 80, 64
    for r in range(4):
        for c in range(4):
            fill = (250, 250, 250, 255) if (r + c) % 2 == 0 else (29, 29, 38, 255)
            d.rectangle([x0 + c * cw, y0 + r * cw * 0.8, x0 + (c + 1) * cw, y0 + (r + 1) * cw * 0.8], fill=fill)
    d.rectangle([x0, y0, x0 + 4 * cw, y0 + 4 * cw * 0.8], outline=INK, width=W // 2)
    save(im, 'flag')


def icon_reticle():
    im, d = canvas()
    ellipse(d, (96, 96, 416, 416), None, outline=INK, width=W + 26)
    ellipse(d, (96, 96, 416, 416), None, outline=(255, 176, 32, 255), width=W + 4)
    for a in range(4):
        ang = a * math.pi / 2
        p0 = (256 + math.cos(ang) * 120, 256 + math.sin(ang) * 120)
        p1 = (256 + math.cos(ang) * 230, 256 + math.sin(ang) * 230)
        d.line([p0, p1], fill=INK, width=W + 18)
        d.line([p0, p1], fill=(255, 176, 32, 255), width=W)
    ellipse(d, (230, 230, 282, 282), (255, 255, 255, 255))
    save(im, 'reticle')


def icon_blast():
    im, d = canvas()
    pts = []
    for i in range(24):
        r = 220 if i % 2 == 0 else 120
        a = i / 24 * math.tau
        pts.append((256 + math.cos(a) * r, 256 + math.sin(a) * r))
    poly(d, pts, (255, 208, 90, 255))
    ellipse(d, (170, 170, 342, 342), (255, 250, 230, 255), outline=(255, 176, 32, 255), width=16)
    save(im, 'blast')


def icon_drone():
    im, d = canvas()
    for cx in (140, 372):
        ellipse(d, (cx - 90, 120, cx + 90, 160), (210, 230, 255, 200), width=12)
        d.rectangle([cx - 10, 140, cx + 10, 220], fill=INK)
    ellipse(d, (130, 180, 382, 400), (200, 210, 230, 255))
    ellipse(d, (180, 240, 332, 320), (35, 48, 74, 255))
    ellipse(d, (236, 256, 276, 296), (255, 90, 74, 255), width=0)
    save(im, 'drone')


def icon_balloon():
    im, d = canvas()
    d.line([(210, 330), (226, 400)], fill=INK, width=10)
    d.line([(302, 330), (286, 400)], fill=INK, width=10)
    ellipse(d, (116, 40, 396, 350), (255, 107, 138, 255))
    ellipse(d, (170, 90, 240, 150), (255, 200, 214, 255), width=0)
    poly(d, [(196, 396), (316, 396), (306, 470), (206, 470)], (176, 122, 69, 255))
    # a small "no" mark: don't shoot it
    d.ellipse((330, 330, 490, 490), outline=(229, 72, 77, 255), width=26)
    d.line([(357, 357), (463, 463)], fill=(229, 72, 77, 255), width=26)
    save(im, 'balloon')


def main():
    os.makedirs(LITE, exist_ok=True)
    for fn in (icon_cape, icon_vent, icon_clue, icon_lamp, icon_web, icon_fling, icon_street, icon_flag, icon_reticle, icon_blast, icon_drone, icon_balloon):
        fn()


if __name__ == '__main__':
    main()
