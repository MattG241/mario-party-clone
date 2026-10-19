#!/bin/sh
# Native Linux build (SDL2 dev packages) for developing and testing the Wii edition.
set -e
cd "$(dirname "$0")"
CXX=${CXX:-clang++} CC=${CC:-clang} cmake -S . -B build-linux -DCMAKE_BUILD_TYPE=RelWithDebInfo > /dev/null
cmake --build build-linux -j"$(nproc)"
