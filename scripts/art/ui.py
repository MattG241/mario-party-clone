"""Face-on UI medallions rendered in 3D (currently the Orbit Dial ring).

    .artenv/bin/python scripts/art/ui.py [--preview]

Writes public/assets/rendered/ui_dial.webp (transparent, 512x512).
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
import props  # noqa: E402
from lib import col  # noqa: E402

PREVIEW = '--preview' in sys.argv
S = 512

# Straight-down camera (the ring spins in 2D in-game, so it must be seen face-on).
lib.BETA = 0.0
lib.COSB, lib.SINB = 1.0, 0.0
lib.reset(16 if PREVIEW else 96)
lib.world_light(0.9)
lib.sun(energy=3.2, elevation=58, azimuth=-40, angle=6.0)
lib.camera_for_region(0, 0, S, S, scale=1.0)

c = lib.board_to_world(S / 2, S / 2, 0.0)
P = props.Prop('dial')
# outer gold ring with a rolled edge
ring = [(2.36, 0.0), (2.44, 0.08), (2.46, 0.2), (2.4, 0.3), (2.26, 0.36), (2.02, 0.36), (1.9, 0.3), (1.86, 0.22), (1.84, 0.16)]
v, f = lib.lathe(ring, 96, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
P.b['metal'].add(v, f, col('#f2c14e'))
# inner teal enamel band
v, f = lib.lathe([(1.84, 0.16), (1.84, 0.2), (1.62, 0.2), (1.6, 0.16)], 96, (c.x, c.y, 0.0), cap_bottom=False, cap_top=False)
P.b['paint'].add(v, f, col('#1fa5a0'))
# cream face (numbers are drawn on top in-game)
v, f = lib.lathe([(1.62, 0.16), (1.62, 0.17), (0.0, 0.17)], 96, (c.x, c.y, 0.0), cap_bottom=False)
P.b['paint'].add(v, f, col('#fff4dc'))
# faint engraved spiral on the face
pts = []
for i in range(220):
    t = i / 219
    a = t * 3.0 * math.tau
    r = 0.12 + t * 1.36
    pts.append((c.x + math.cos(a) * r, c.y + math.sin(a) * r, 0.172))
v, f = lib.tube(pts, 0.018, 6)
P.b['metal'].add(v, f, col('#ecd7a4'))
# ten crystal studs and notches around the ring
for k in range(10):
    a = k / 10 * math.tau - math.pi / 2
    x, y = c.x + math.cos(a) * 2.14, c.y + math.sin(a) * 2.14
    v, f = lib.prism((x, y, 0.3), 0.1, 0.22, sides=6, tip=0.5)
    P.b['crystal'].add(v, f, col('#5ce1ff' if k % 2 == 0 else '#c49bff'))
    a2 = a + math.pi / 10
    v, f = lib.box((c.x + math.cos(a2) * 2.14, c.y + math.sin(a2) * 2.14, 0.34), (0.05, 0.22, 0.04), rot_z=a2)
    P.b['metal'].add(v, f, col('#b07a1a'))
P.build()

out = os.path.join(lib.ROOT, 'art-out', 'ui', 'dial.png')
lib.render_to(out)
if not PREVIEW:
    from PIL import Image
    pub = os.path.join(lib.ROOT, 'public', 'assets', 'rendered')
    Image.open(out).convert('RGBA').save(os.path.join(pub, 'ui_dial.webp'), 'WEBP', quality=92, method=6)
    print('wrote ui_dial.webp')
