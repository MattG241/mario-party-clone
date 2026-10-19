#!/bin/sh
# Wii build: boot.dol via devkitPPC (DEVKITPRO, default /opt/devkitpro), then the Homebrew Channel
# folder (apps/allstarparty: boot.dol, meta.xml, icon.png, data/) and a zip of it in wii/dist/.
set -e
cd "$(dirname "$0")"
export DEVKITPRO=${DEVKITPRO:-/opt/devkitpro}
export DEVKITPPC=${DEVKITPPC:-$DEVKITPRO/devkitPPC}
export PATH="$DEVKITPRO/tools/bin:$DEVKITPPC/bin:$PATH"
"$DEVKITPRO/portlibs/wii/bin/powerpc-eabi-cmake" -S . -B build-wii -DCMAKE_BUILD_TYPE=Release > /dev/null
cmake --build build-wii -j"$(nproc)"
APP=dist/apps/allstarparty
rm -rf dist && mkdir -p "$APP"
cp build-wii/allstarparty.dol "$APP/boot.dol"
cp meta/meta.xml meta/icon.png "$APP/"
cp -r data "$APP/data"
(cd dist && zip -qr AllStarParty-Wii.zip apps)
echo "built $(du -h dist/AllStarParty-Wii.zip | cut -f1) dist/AllStarParty-Wii.zip"
