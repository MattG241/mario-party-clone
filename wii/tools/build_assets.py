"""Build the Wii edition's data folder and generated C++ from the web game's content and art.

    python wii/tools/build_assets.py            (needs Pillow + numpy; node for the data export)

Writes wii/data/ (the files that sit next to boot.dol on the USB drive) and
wii/src/gen/GameData.cpp (boards, characters, items, minigames and sprite metadata).
Everything is scaled from the web game's 1920x1080 art to the Wii's 854x480 (16:9) canvas.
"""
from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import wii_items  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WII = os.path.join(ROOT, 'wii')
OUT = os.path.join(WII, 'data')
GEN = os.path.join(WII, 'src', 'gen')
PUB = os.path.join(ROOT, 'public', 'assets')
ATL = os.path.join(PUB, 'atlases')
REN = os.path.join(PUB, 'rendered')

SCREEN = 854 / 1920          # web pixels -> Wii pixels (menus, arenas)
BOARD_K = 0.4                # board pixels -> Wii pixels
CELL = 96                    # character / cast sprite cell (from the 389 px frames)
FRAME = 389
FEET = (194.5, 304.0)
CELL_K = CELL / FRAME
ANIMS = ['idle', 'walk', 'run', 'jump', 'celebrate', 'disappointed', 'surprised', 'wave', 'victory', 'stunned', 'cheer', 'dash',
         'fall', 'throw', 'carry', 'crouch', 'dial', 'coins', 'loseCoins']
TILE = 512


def export_data() -> dict:
    tmp = os.path.join(WII, 'build-tools')
    os.makedirs(tmp, exist_ok=True)
    js = os.path.join(tmp, 'export_data.mjs')
    subprocess.run(['npx', 'esbuild', 'wii/tools/export_data.ts', '--bundle', '--platform=node', '--format=esm', '--external:phaser',
                    '--log-level=warning', f'--outfile={js}'], cwd=ROOT, check=True)
    out = subprocess.run(['node', js], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def save(im: Image.Image, rel: str, quality_rgb: bool = False):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if quality_rgb:
        # opaque art goes out as JPEG (the game loads x.jpg when x.png is missing)
        path = path[:-4] + '.jpg'
        im.convert('RGB').save(path, quality=90, optimize=True)
        return rel
    im.save(path, optimize=True)
    return rel


def atlas_frames(key: str):
    js = json.load(open(os.path.join(ATL, key + '.json')))
    img = next(os.path.join(ATL, key + e) for e in ('.webp', '.png') if os.path.exists(os.path.join(ATL, key + e)))
    return Image.open(img).convert('RGBA'), js['frames']


def full_frame(sheet: Image.Image, f: dict) -> Image.Image:
    fr, sss, src = f['frame'], f['spriteSourceSize'], f['sourceSize']
    crop = sheet.crop((fr['x'], fr['y'], fr['x'] + fr['w'], fr['y'] + fr['h']))
    out = Image.new('RGBA', (src['w'], src['h']), (0, 0, 0, 0))
    out.alpha_composite(crop, (sss['x'], sss['y']))
    return out


def cell_of(frame: Image.Image) -> Image.Image:
    return frame.resize((CELL, CELL), Image.LANCZOS)


# ------------------------------------------------------------------------------------------
def build_characters(data: dict) -> dict:
    meta = {}
    for c in data['characters']:
        cid = c['id']
        sheet, frames = atlas_frames(f'hero_{cid}')
        anims = data['heroAnims'][cid]
        cells, amap = [], {}
        for name in ANIMS:
            a = anims.get(name)
            if not a:
                continue
            idx = []
            for fi in a['frames']:
                cells.append(cell_of(full_frame(sheet, frames[str(fi)])))
                idx.append(len(cells) - 1)
            amap[name] = {'cells': idx, 'fps': a['fps'], 'loop': a['loop']}
        cols = 10
        rows = math.ceil(len(cells) / cols)
        img = Image.new('RGBA', (cols * CELL, rows * CELL), (0, 0, 0, 0))
        for i, cimg in enumerate(cells):
            img.alpha_composite(cimg, ((i % cols) * CELL, (i // cols) * CELL))
        save(img, f'chars/{cid}.png')
        # portrait: a square round the face of the first idle frame
        idle = full_frame(sheet, frames[str(anims['idle']['frames'][0])])
        fx, fy = data['heroPoints'][cid]['face']
        cx, cy = FEET[0] + fx, FEET[1] + fy
        r = 92
        por = idle.crop((int(cx - r), int(cy - r * 1.05), int(cx + r), int(cy + r * 0.95))).resize((80, 80), Image.LANCZOS)
        save(por, f'portraits/{cid}.png')
        meta[cid] = {'cols': cols, 'anims': amap}
    print('characters', len(meta), flush=True)
    return meta


def build_cast() -> None:
    sheet, frames = atlas_frames('npcs3d')
    n = len(frames)
    cols = 6
    rows = math.ceil(n / cols)
    img = Image.new('RGBA', (cols * CELL, rows * CELL), (0, 0, 0, 0))
    for i in range(n):
        img.alpha_composite(cell_of(full_frame(sheet, frames[str(i)])), ((i % cols) * CELL, (i // cols) * CELL))
    save(img, 'cast.png')
    print('cast', n, flush=True)


def build_spaces() -> list[str]:
    types = ['start', 'gleam', 'festival', 'mischief', 'market', 'portal', 'relic', 'event']
    w, h = 64, 50
    img = Image.new('RGBA', (w * len(types), h), (0, 0, 0, 0))
    for i, t in enumerate(types):
        s = Image.open(os.path.join(REN, 'spaces', f'space_{t}.webp')).convert('RGBA').resize((w, h), Image.LANCZOS)
        img.alpha_composite(s, (i * w, 0))
    save(img, 'spaces.png')
    return types


# The Wii edition's extra board cast (thief, banker, villain), in the order of EXTRA_CAST in Match.cpp:
# strips rendered by scripts/art/cast_wii.py into wii/art/cast_<id>.png, stacked into one sheet.
EXTRA_CAST = ['eggman', 'frieza', 'catwoman', 'plankton', 'krabs', 'burns']


def build_cast_extra() -> None:
    img = Image.new('RGBA', (6 * CELL, len(EXTRA_CAST) * CELL), (0, 0, 0, 0))
    for r, cid in enumerate(EXTRA_CAST):
        path = os.path.join(WII, 'art', f'cast_{cid}.png')
        if os.path.exists(path):
            img.alpha_composite(Image.open(path).convert('RGBA'), (0, r * CELL))
        else:
            print('missing cast strip', path, flush=True)
    save(img, 'cast_extra.png')


def build_items(data: dict) -> dict:
    sheet, frames = atlas_frames('items')
    out = {}
    # coin spin frames 0-5 and the item icons, each scaled into a 48 px cell
    keys = [str(i) for i in range(6)]
    for it in data['items']:
        ic = it.get('icon') or {}
        if ic.get('texture') == 'items' and ic.get('frame') is not None:
            keys.append(str(ic['frame']))
    keys = list(dict.fromkeys(keys))
    cell = 48
    extra = wii_items.icons()  # the Wii's extra items and the web items without an atlas icon
    img = Image.new('RGBA', (cell * (len(keys) + len(extra)), cell), (0, 0, 0, 0))
    for i, k in enumerate(keys):
        f = full_frame(sheet, frames[k])
        bb = f.getbbox() or (0, 0, f.width, f.height)
        f = f.crop(bb)
        s = min(cell / f.width, cell / f.height)
        f = f.resize((max(1, int(f.width * s)), max(1, int(f.height * s))), Image.LANCZOS)
        img.alpha_composite(f, (i * cell + (cell - f.width) // 2, (cell - f.height) // 2))
        out[k] = i
    for j, (kind, ic) in enumerate(extra):
        img.alpha_composite(ic, ((len(keys) + j) * cell, 0))
        out['wii:' + kind] = len(keys) + j
    save(img, 'items.png')
    star = Image.open(os.path.join(REN, 'items', 'star_coin.webp')).convert('RGBA')
    star = star.resize((int(star.width * 64 / star.height), 64), Image.LANCZOS)
    save(star, 'star.png')
    return out


def build_board(b: dict) -> dict:
    bid = b['id']
    man_path = os.path.join(REN, bid, 'manifest.json')
    W, H = int(b['width'] * BOARD_K), int(b['height'] * BOARD_K)
    canvas = Image.new('RGBA', (W, H), (150, 205, 240, 255))
    sky = Image.open(os.path.join(REN, 'sky_day.webp')).convert('RGBA').resize((W, H), Image.LANCZOS)
    canvas.alpha_composite(sky)
    if os.path.exists(man_path):
        man = json.load(open(man_path))
        k = 1 / man['scale']
        ox, oy = man['origin']

        def paste(file, x, y, w, h, alpha=1.0):
            im = Image.open(os.path.join(REN, bid, file)).convert('RGBA')
            tw, th = max(1, round(w * BOARD_K)), max(1, round(h * BOARD_K))
            im = im.resize((tw, th), Image.LANCZOS)
            if alpha < 1:
                a = im.getchannel('A').point(lambda v: int(v * alpha))
                im.putalpha(a)
            layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
            layer.paste(im, (round(x * BOARD_K), round(y * BOARD_K)), im)
            canvas.alpha_composite(layer)

        sh = man.get('shadow')
        if sh:
            paste(sh['file'], sh['x'], sh['y'], sh['w'], sh['h'], 0.55)
        for t in man['tiles']:
            paste(t['file'], ox + t['x'] * k, oy + t['y'] * k, t['w'] * k, t['h'] * k)
        for p in sorted(man.get('props', []), key=lambda p: p.get('depthY', p.get('baseY', 0))):
            paste(p['file'], p['x'], p['y'], p['w'], p['h'])
    cols, rows = math.ceil(W / TILE), math.ceil(H / TILE)
    for j in range(rows):
        for i in range(cols):
            tile = canvas.crop((i * TILE, j * TILE, min(W, (i + 1) * TILE), min(H, (j + 1) * TILE)))
            save(tile, f'boards/{bid}/t{i}_{j}.png', quality_rgb=True)
    prev = canvas.copy()
    prev.thumbnail((360, 240), Image.LANCZOS)
    save(prev, f'boards/{bid}/preview.png', quality_rgb=True)
    print('board', bid, W, H, flush=True)
    return {'w': W, 'h': H, 'cols': cols, 'rows': rows}


def build_screens(data: dict) -> dict:
    sky = Image.open(os.path.join(REN, 'sky_day.webp')).convert('RGBA').resize((854, 480), Image.LANCZOS)

    def full(src, dst):
        # the scene renders are transparent around the set: put them over the sky
        im = Image.open(src).convert('RGBA').resize((854, 480), Image.LANCZOS)
        bg = sky.copy()
        bg.alpha_composite(im)
        save(bg, dst, quality_rgb=True)

    full(os.path.join(REN, 'scene_title.webp'), 'ui/title.png')
    full(os.path.join(REN, 'scene_select.webp'), 'ui/select.png')
    full(os.path.join(REN, 'scene_results.webp'), 'ui/results.png')
    full(os.path.join(REN, 'sky_day.webp'), 'ui/sky.png')
    logo = Image.open(os.path.join(REN, 'ui_logo.webp')).convert('RGBA')
    logo = logo.resize((380, int(logo.height * 380 / logo.width)), Image.LANCZOS)
    save(logo, 'ui/logo.png')
    arenas = {}
    for mid, r in data['minigameRenders'].items():
        name = r['images'][0]
        src = os.path.join(REN, f'scene_{name}.webp')
        if os.path.exists(src):
            full(src, f'mg/arena_{mid}.png')
            arenas[mid] = f'mg/arena_{mid}.png'
    # minigame props, scaled like the arenas
    for f in sorted(os.listdir(os.path.join(REN, 'mg'))):
        if not f.endswith('.webp'):
            continue
        im = Image.open(os.path.join(REN, 'mg', f)).convert('RGBA')
        w, h = max(1, round(im.width * SCREEN)), max(1, round(im.height * SCREEN))
        save(im.resize((w, h), Image.LANCZOS), f'mg/{f[:-5]}.png')
    print('screens + arenas', len(arenas), flush=True)
    return arenas


def build_font():
    ttf = os.path.join(OUT, 'font.ttf')
    os.makedirs(OUT, exist_ok=True)
    src = os.path.join(ROOT, 'art-out', 'logo', 'fredoka-700-merged.ttf')
    if os.path.exists(src):
        shutil.copy(src, ttf)
        return
    from fontTools.ttLib import TTFont
    f = TTFont(os.path.join(ROOT, 'node_modules', '@fontsource', 'fredoka', 'files', 'fredoka-latin-700-normal.woff2'))
    f.flavor = None
    f.save(ttf)


# ------------------------------------------------------------------------------------------
def cstr(s) -> str:
    return json.dumps(str(s if s is not None else ''), ensure_ascii=False)


def gen_cpp(data: dict, chars: dict, items_idx: dict, boards: dict, arenas: dict, space_types: list[str]):
    L = ['// AUTO-GENERATED by wii/tools/build_assets.py from the web game\'s data. Do not edit by hand.',
         '#include "../game/Data.h"', '', 'namespace data {', '']
    # characters
    L.append('[[maybe_unused]] static const AnimDef ANIMS_NONE[] = {{"", nullptr, 0, 1, false}};')
    for c in data['characters']:
        cid = c['id']
        for name, a in chars[cid]['anims'].items():
            L.append(f'static const int C_{cid}_{name}[] = {{{", ".join(str(i) for i in a["cells"])}}};')
        L.append(f'static const AnimDef A_{cid}[] = {{')
        for name, a in chars[cid]['anims'].items():
            L.append(f'  {{"{name}", C_{cid}_{name}, {len(a["cells"])}, {a["fps"]}, {"true" if a["loop"] else "false"}}},')
        L.append('};')
    L.append('const CharacterDef CHARACTERS[] = {')
    for c in data['characters']:
        cid = c['id']
        L.append(f'  {{{cstr(cid)}, {cstr(c["name"])}, {cstr(c.get("short") or c["name"])}, 0x{int(c.get("color") or 0xffffff):06x}, {cstr(c.get("blurb"))}, '
                 f'A_{cid}, {len(chars[cid]["anims"])}, {chars[cid]["cols"]}}},')
    L.append('};')
    L.append(f'const int CHARACTER_COUNT = {len(data["characters"])};')
    L.append('')
    # cast
    L.append('const CastDef CAST[] = {')
    for s in data['cast']:
        L.append(f'  {{{cstr(s["id"])}, {cstr(s["name"])}, {{{", ".join(cstr(x) for x in s["from"])}}}, {len(s["from"])}, 0x{s["color"]:06x}}},')
    L.append('};')
    L.append(f'const int CAST_COUNT = {len(data["cast"])};')
    L.append('')
    # items
    L.append('const ItemDef ITEMS[] = {')
    for it in data['items'] + wii_items.EXTRA_ITEMS:
        ic = it.get('icon') or {}
        icon = items_idx.get(str(ic.get('frame')), -1) if ic.get('texture') == 'items' else -1
        if icon < 0:
            icon = items_idx.get('wii:' + it['id'], -1)
        L.append(f'  {{{cstr(it["id"])}, {cstr(it["name"])}, {cstr(it["description"])}, {it["price"]}, {cstr(it["timing"])}, {it.get("value", 1)}, {icon}}},')
    L.append('};')
    L.append(f'const int ITEM_COUNT = {len(data["items"]) + len(wii_items.EXTRA_ITEMS)};')
    L.append('const ShopDef SHOPS[] = {')
    for s in data['shops']:
        L.append(f'  {{{cstr(s["id"])}, {cstr(s["name"])}, {{{", ".join(cstr(x) for x in s["stock"])}}}, {len(s["stock"])}, {cstr(s["finalRoundExtra"])}}},')
    L.append('};')
    L.append(f'const int SHOP_COUNT = {len(data["shops"])};')
    L.append('')
    # minigames
    L.append('const MinigameDef MINIGAMES[] = {')
    for m in data['minigames']:
        ins = m['instructions'][:4] + [''] * (4 - len(m['instructions'][:4]))
        L.append(f'  {{{cstr(m["id"])}, {cstr(m["name"])}, {cstr(m["tagline"])}, {cstr(m["description"])}, {{{", ".join(cstr(x) for x in ins)}}}, '
                 f'{cstr(m["world"])}, 0x{int(m.get("color") or 0x3aa7e0):06x}, {cstr(arenas.get(m["id"], ""))}, {"true" if m["teamGame"] else "false"}}},')
    L.append('};')
    L.append(f'const int MINIGAME_COUNT = {len(data["minigames"])};')
    L.append('')
    # worlds
    L.append('const WorldDef WORLDS[] = {')
    for w in data['worlds']:
        cast = w['cast'][:4] + [''] * (4 - len(w['cast'][:4]))
        L.append(f'  {{{cstr(w["id"])}, {cstr(w["name"])}, {{{", ".join(cstr(x) for x in cast)}}}, {len(w["cast"][:4])}, 0x{w["color"]:06x}}},')
    L.append('};')
    L.append(f'const int WORLD_COUNT = {len(data["worlds"])};')
    L.append('')
    # boards
    for b in data['boards']:
        bid = b['id'].replace('-', '_')
        L.append(f'static const NodeDef N_{bid}[] = {{')
        for n in b['nodes']:
            nxt = n['next'][:3] + [''] * (3 - len(n['next'][:3]))
            signs = [(k, v) for k, v in n['signs'].items()][:3]
            signs += [('', '')] * (3 - len(signs))
            L.append(f'  {{{cstr(n["id"])}, {n["x"]}, {n["y"]}, {space_types.index(n["type"])}, {{{", ".join(cstr(x) for x in nxt)}}}, {len(n["next"][:3])}, '
                     f'{cstr(n["eventId"])}, {cstr(n["region"])}, {cstr(n["shop"])}, {"true" if n["exposed"] else "false"}, {"true" if n["spring"] else "false"}, '
                     f'{cstr(n["bridge"])}, {cstr(n["detour"])}, {{{", ".join("{" + cstr(k) + ", " + cstr(v) + "}" for k, v in signs)}}}}},')
        L.append('};')
        gates = b['gates']
        L.append(f'static const GateDef G_{bid}[] = {{' + (', '.join(f'{{{cstr(g["from"])}, {cstr(g["to"])}}}' for g in gates) or '{"", ""}') + '};')
        L.append(f'static const char* const RG_{bid}[] = {{' + ', '.join(cstr(x) for x in b['relicGates']) + '};')
        ports = [x for pr in b['portals'] for x in pr]
        L.append(f'static const char* const P_{bid}[] = {{' + (', '.join(cstr(x) for x in ports) or '""') + '};')
        mgs = b['minigames']
        L.append(f'static const char* const M_{bid}[] = {{' + (', '.join(cstr(x) for x in mgs) or '""') + '};')
    L.append('const BoardDef BOARDS[] = {')
    for b in data['boards']:
        bid = b['id'].replace('-', '_')
        art = boards[b['id']]
        L.append(f'  {{{cstr(b["id"])}, {cstr(b["name"])}, {cstr(b["subtitle"])}, {cstr(b["description"])}, {b["width"]}, {b["height"]}, '
                 f'N_{bid}, {len(b["nodes"])}, {cstr(b["startNode"])}, RG_{bid}, {len(b["relicGates"])}, P_{bid}, {len(b["portals"]) * 2}, '
                 f'G_{bid}, {len(b["gates"])}, {cstr(b["world"])}, {cstr(b["time"])}, M_{bid}, {len(b["minigames"])}, '
                 f'{art["w"]}, {art["h"]}, {art["cols"]}, {art["rows"]}}},')
    L.append('};')
    L.append(f'const int BOARD_COUNT = {len(data["boards"])};')
    L.append(f'const float BOARD_K = {BOARD_K}f;')
    L.append('')
    L.append('}  // namespace data')
    os.makedirs(GEN, exist_ok=True)
    with open(os.path.join(GEN, 'GameData.cpp'), 'w') as fh:
        fh.write('\n'.join(L) + '\n')
    print('generated GameData.cpp', flush=True)


def main():
    only = sys.argv[1:]
    data = export_data()
    os.makedirs(OUT, exist_ok=True)
    build_font()
    chars = build_characters(data)
    if not only or 'cast' in only:
        build_cast()
        build_cast_extra()
    space_types = build_spaces()
    items_idx = build_items(data)
    boards = {}
    for b in data['boards']:
        if not only or 'boards' in only:
            boards[b['id']] = build_board(b)
        else:
            W, H = int(b['width'] * BOARD_K), int(b['height'] * BOARD_K)
            boards[b['id']] = {'w': W, 'h': H, 'cols': math.ceil(W / TILE), 'rows': math.ceil(H / TILE)}
    arenas = build_screens(data)
    gen_cpp(data, chars, items_idx, boards, arenas, space_types)


if __name__ == '__main__':
    main()
