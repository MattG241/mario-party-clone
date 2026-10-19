#!/bin/sh
# usage: tools/mgtest.sh <minigame-id> <file-stem> [out-dir]
# Builds the game with just that one minigame (build-mg-<id>/), plays it headless with four CPUs and
# writes out-dir/grid.png: the rules card, two moments of play and the results.
set -e
cd "$(dirname "$0")/.."
ID=$1; STEM=$2; OUT=${3:-/tmp/mgtest-$ID}
CXX=${CXX:-clang++} CC=${CC:-clang} cmake -S . -B build-mg-$ID -DCMAKE_BUILD_TYPE=RelWithDebInfo -DMG_ONLY=$STEM > /dev/null
cmake --build build-mg-$ID -j4 2>&1 | grep -E "error|warning" || true
rm -rf "$OUT"; mkdir -p "$OUT"
SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy ASP_DATA=$PWD/data ./build-mg-$ID/allstarparty --headless --mg "$ID" --shots "$OUT" --frames 6000 | grep -v "^font\|^frame" || true
python3 - "$OUT" <<'PY'
import sys, os
from PIL import Image
d = sys.argv[1]
fs = sorted(f for f in os.listdir(d) if f.endswith('.png') and f[0] == '1')
print(len(fs), 'shots,', round(len(fs) * 1.5), 's')
if len(fs) >= 4:
    pick = [fs[0], fs[len(fs) // 3], fs[2 * len(fs) // 3], fs[-3]]
    ims = [Image.open(os.path.join(d, f)) for f in pick]
    w, h = ims[0].size
    g = Image.new('RGB', (w * 2, h * 2))
    for i, im in enumerate(ims): g.paste(im, ((i % 2) * w, (i // 2) * h))
    g.save(os.path.join(d, 'grid.png'))
    print('grid:', os.path.join(d, 'grid.png'), pick)
PY
