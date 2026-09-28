"""Pre-blurred, half-size copies of the arena renders for the minigame intro backdrop.

    python scripts/art/blur_backdrops.py

Blurring offline keeps the intro cheap on every GPU (a live full-screen blur is costly). Each arena is
laid over the sky the game draws behind it (same size, offset and flip as in its minigame), so the
backdrop matches what the players are about to see. Orbit Dodge's render carries its own sky.
"""
import os

from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PUB = os.path.join(ROOT, 'public', 'assets', 'rendered')
# arena: (sky, display width factor, centre y, display height, mirrored) as in GleamGrab.ts / OrbitDodge.ts
SKIES = {'gleam3d': ('sky_clear', 1.04, 540, 1124, True), 'orbit': ('sky_clear', 1.12, 480, 1210, False)}

for name, (sky_name, wf, cy, sh, flip) in SKIES.items():
    src = os.path.join(PUB, f'scene_{name}.webp')
    if not os.path.exists(src):
        continue
    im = Image.open(src).convert('RGBA')
    sky_path = os.path.join(PUB, f'{sky_name}.webp')
    if not os.path.exists(sky_path):
        sky_path = os.path.join(PUB, 'sky_day.webp')
    if os.path.exists(sky_path):
        sw = round(im.width * wf)
        sky = Image.open(sky_path).convert('RGBA').resize((sw, sh), Image.LANCZOS)
        if flip:
            sky = sky.transpose(Image.FLIP_LEFT_RIGHT)
        base = Image.new('RGBA', im.size, (0, 0, 0, 255))
        base.paste(sky, (round((im.width - sw) / 2), round(cy - sh / 2)))  # (the sky overhangs the frame)
        base.alpha_composite(im)
        im = base
    im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS).filter(ImageFilter.GaussianBlur(5))
    im.convert('RGB').save(os.path.join(PUB, f'scene_{name}_blur.webp'), 'WEBP', quality=82, method=6)
    print('wrote', name)
