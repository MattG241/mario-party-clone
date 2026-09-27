"""Look-dev lineup of every landmark (renders art-out/props_preview.png)."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
import props  # noqa: E402

lib.reset(int(sys.argv[1]) if len(sys.argv) > 1 else 24)
lib.world_light(0.85)
lib.sun(energy=3.4, elevation=50, azimuth=-35, angle=3.0)
y = 700
props.observatory(300, y, 0.8)
body, sails, hub = props.windmill(750, y)
props.workshop(1100, y)
props.stall(1450, y)
props.twist_tree(1850, y, 0.8)
props.crystal_gen(2250, y)
props.lantern(2450, y)
props.bunting(2750, y, 300)
props.gate(3050, y)
props.pedestal(3250, y)
lib.camera_for_region(0, 150, 3400, 700, scale=0.5)
lib.render_to(os.path.join(lib.ROOT, 'art-out', 'props_preview.png'))
