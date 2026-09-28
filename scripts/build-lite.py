"""Half-resolution copies of the biggest textures for Lite mode (TV browsers, low-memory devices).

    python3 scripts/build-lite.py

Writes public/assets/lite/: the board terrain tiles, landmarks and island shadow at half size with a
manifest whose render scale is halved (so the board lines up exactly as before), a 1280x720 sky, and
half-size copies of the character and effect atlases, the title island, lobby stage and podium, and the
Tumble Tower wall.
The atlases keep their original JSON: the game stretches each half-size sheet back over full-size
frame coordinates (inflateTexture in src/game/util/texture.ts), so nothing else changes.
Re-run after re-rendering the board (scripts/art/board.py --export), the skies or any of those sheets.
"""
import json
import os
import sys
import shutil

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'public', 'assets', 'rendered')
OUT = os.path.join(ROOT, 'public', 'assets', 'lite')


def half(src, dst, quality=84):
    im = Image.open(src)
    im = im.convert('RGBA') if im.mode in ('RGBA', 'LA', 'P') else im.convert('RGB')
    im = im.resize((max(1, im.width // 2), max(1, im.height // 2)), Image.LANCZOS)
    im.save(dst, 'WEBP', quality=quality, method=6)


def board(name):
    src = os.path.join(SRC, name)
    dst = os.path.join(OUT, name)
    shutil.rmtree(dst, ignore_errors=True)
    os.makedirs(dst)
    man = json.load(open(os.path.join(src, 'manifest.json')))
    # Tiles are placed in render pixels: halve the render scale and every tile rectangle.
    man['scale'] = man['scale'] / 2
    for t in man['tiles']:
        half(os.path.join(src, t['file']), os.path.join(dst, t['file']))
        for k in ('x', 'y', 'w', 'h'):
            t[k] = t[k] / 2
    # Landmarks and the shadow are placed by display size in board pixels: only the images shrink.
    for p in man.get('props', []):
        half(os.path.join(src, p['file']), os.path.join(dst, p['file']))
    if man.get('shadow'):
        half(os.path.join(src, man['shadow']['file']), os.path.join(dst, man['shadow']['file']))
    with open(os.path.join(dst, 'manifest.json'), 'w') as fh:
        json.dump(man, fh)
    print('board', name, len(man['tiles']), 'tiles', len(man.get('props', [])), 'props')


# Keep in step with isLiteHalfAtlas in src/game/perf.ts: every hero sheet plus these.
ATLASES = ['npcs3d', 'vfx', 'items', 'props']
# ... and LITE_HALF_SCENES there, plus every minigame arena (MINIGAME_RENDERS in src/game/data/minigameRenders.ts).
SCENES = ['title', 'select', 'results']
ARENAS = ['gleam3d', 'gleam3d_wall', 'gleam3d_blur', 'orbit', 'orbit_blur', 'crate', 'crate_wall', 'totem', 'pond', 'relay']


def atlases():
    src = os.path.join(ROOT, 'public', 'assets', 'atlases')
    dst = os.path.join(OUT, 'atlases')
    os.makedirs(dst, exist_ok=True)
    heroes = sorted(f[:-5] for f in os.listdir(src) if f.startswith('hero_') and f.endswith('.webp'))
    for key in heroes + ATLASES:
        img = next(os.path.join(src, key + ext) for ext in ('.webp', '.png') if os.path.exists(os.path.join(src, key + ext)))
        # Frames sit close together: a higher quality keeps their edges from picking up neighbours.
        half(img, os.path.join(dst, key + '.webp'), quality=90)
    print('atlases', len(heroes) + len(ATLASES))


def main():
    os.makedirs(OUT, exist_ok=True)
    args = sys.argv[1:]
    # Just one board (--board <id>) or some images (--image <path under public/assets/rendered> ...):
    # a world's own art, without rebuilding (or re-encoding) everyone else's.
    if args[:1] == ['--board']:
        board(args[1])
        return
    if args[:1] == ['--image']:
        for rel in args[1:]:
            dst = os.path.join(OUT, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            half(os.path.join(SRC, rel), dst)
            print('lite', rel)
        return
    board('suncoil')
    half(os.path.join(SRC, 'sky_day.webp'), os.path.join(OUT, 'sky_day.webp'))
    for v in SCENES + ARENAS:
        half(os.path.join(SRC, f'scene_{v}.webp'), os.path.join(OUT, f'scene_{v}.webp'))
    # the Orbit Dodge arm frames keep their JSON (stretched back in game like the atlases)
    half(os.path.join(SRC, 'orbit_arms.webp'), os.path.join(OUT, 'orbit_arms.webp'), quality=90)
    os.makedirs(os.path.join(OUT, 'mg'), exist_ok=True)
    half(os.path.join(SRC, 'mg', 'tower_wall.webp'), os.path.join(OUT, 'mg', 'tower_wall.webp'))
    print('sky_day, scenes, tower_wall')
    atlases()


if __name__ == '__main__':
    main()
