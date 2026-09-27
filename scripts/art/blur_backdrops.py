"""Pre-blurred, half-size copies of the arena renders for the minigame intro backdrop.

    python scripts/art/blur_backdrops.py

Blurring offline keeps the intro cheap on every GPU (a live full-screen blur is costly).
"""
import os

from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PUB = os.path.join(ROOT, 'public', 'assets', 'rendered')
for name in ('gleam3d', 'orbit'):
    src = os.path.join(PUB, f'scene_{name}.webp')
    if not os.path.exists(src):
        continue
    im = Image.open(src).convert('RGBA')
    sky_path = os.path.join(PUB, 'sky_day.webp')
    if os.path.exists(sky_path):
        sky = Image.open(sky_path).convert('RGBA').resize(im.size)
        sky.alpha_composite(im)
        im = sky
    im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS).filter(ImageFilter.GaussianBlur(5))
    im.convert('RGB').save(os.path.join(PUB, f'scene_{name}_blur.webp'), 'WEBP', quality=82, method=6)
    print('wrote', name)
