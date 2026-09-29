// Dojo Summit: misty mountain peaks above a sea of clouds, joined by stone stairs and a rope bridge.
// The trail runs clockwise from the Lantern Gate: through the Ninja Village (over the rooftops or
// down Market Street past the noodle stall), up past the Training Falls to the pagoda dojo on the
// summit, across the rope bridge to the Tournament Ring, down through the Boulder Grounds (or out to
// the little hut on the Cloud Isle) and home along the Plum Terrace. A key opens the Cherry Stairs
// straight up the middle peak.
import type { BoardDecoration, BoardDef, BoardIsland, BoardNodeDef, NodeMeta, SpaceType } from '../../board/types';
import { DOJO_INFO } from './info';

function n(id: string, x: number, y: number, type: SpaceType, next: string[], extra: { eventId?: string; meta?: NodeMeta } = {}): BoardNodeDef {
  return { id, x, y, type, next, eventId: extra.eventId, metadata: extra.meta };
}

const GATE = { region: 'Lantern Gate' };
const VILLAGE = { region: 'Ninja Village' };
const ROOFS = { region: 'Ninja Village', exposed: true };
const FALLS = { region: 'Training Falls' };
const SUMMIT = { region: 'Summit Dojo' };
const BRIDGE = { region: 'Rope Bridge', bridge: 'rope' };
const STEPS = { region: 'Cloud Steps', detour: 'rope', exposed: true };
const RING = { region: 'Tournament Ring' };
const BOULDERS = { region: 'Boulder Grounds' };
const ISLE = { region: 'Cloud Isle' };
const CLOUDS = { region: 'Cloud Steps' };
const TERRACE = { region: 'Plum Terrace' };
const STAIRS = { region: 'Cherry Stairs' };

const nodes: BoardNodeDef[] = [
  // Lantern Gate (start). s1 forks: west into the village, or up the Cherry Stairs with a key.
  n('s0', 1880, 2080, 'start', ['s1'], { meta: GATE }),
  n('s1', 1720, 2110, 'gleam', ['s2', 'c0'], { meta: { ...GATE, signs: { s2: 'Ninja Village', c0: 'Cherry Stairs (Prism Key)' } } }),
  n('s2', 1550, 2100, 'festival', ['s3'], { meta: GATE }),
  n('s3', 1390, 2050, 'gleam', ['v0'], { meta: GATE }),
  // Ninja Village: the short rooftop run (exposed to the wind) or Market Street past the noodle stall.
  n('v0', 1230, 1980, 'mischief', ['r0', 'm0'], { meta: { ...VILLAGE, signs: { r0: 'Rooftop Run', m0: 'Market Street' } } }),
  n('r0', 1110, 1850, 'gleam', ['r1'], { meta: ROOFS }),
  n('r1', 1010, 1720, 'event', ['r2'], { eventId: 'dojo_smoke', meta: ROOFS }),
  n('r2', 930, 1590, 'gleam', ['v1'], { meta: ROOFS }),
  n('m0', 1060, 2020, 'gleam', ['m1'], { meta: VILLAGE }),
  n('m1', 890, 1980, 'market', ['m2'], { meta: { ...VILLAGE, shop: 'pipper' } }),
  n('m2', 750, 1880, 'festival', ['m3'], { meta: VILLAGE }),
  n('m3', 660, 1750, 'gleam', ['m4'], { meta: VILLAGE }),
  n('m4', 650, 1600, 'relic', ['v1'], { meta: VILLAGE }),
  n('v1', 790, 1470, 'gleam', ['f0'], { meta: VILLAGE }),
  // Training Falls
  n('f0', 700, 1330, 'gleam', ['f1'], { meta: FALLS }),
  n('f1', 620, 1190, 'portal', ['f2'], { meta: FALLS }),
  n('f2', 640, 1040, 'event', ['f3'], { eventId: 'dojo_training', meta: FALLS }),
  n('f3', 740, 910, 'gleam', ['f4'], { meta: FALLS }),
  n('f4', 870, 800, 'mischief', ['d0'], { meta: FALLS }),
  // Summit Dojo (the pagoda). The Cherry Stairs arrive at d3.
  n('d0', 1050, 700, 'gleam', ['d1'], { meta: SUMMIT }),
  n('d1', 1210, 630, 'relic', ['d2'], { meta: SUMMIT }),
  n('d2', 1380, 590, 'festival', ['d3'], { meta: SUMMIT }),
  n('d3', 1560, 580, 'gleam', ['d4'], { meta: SUMMIT }),
  n('d4', 1740, 600, 'event', ['d5'], { eventId: 'bridge_break', meta: SUMMIT }),
  n('d5', 1910, 630, 'mischief', ['b0', 'bd0'], { meta: SUMMIT }),
  // The rope bridge to the ring, or the Cloud Steps below it while it's broken.
  n('b0', 2080, 600, 'gleam', ['b1'], { meta: BRIDGE }),
  n('b1', 2250, 580, 'mischief', ['b2'], { meta: { ...BRIDGE, exposed: true } }),
  n('b2', 2420, 600, 'gleam', ['t0'], { meta: BRIDGE }),
  n('bd0', 2080, 790, 'gleam', ['bd1'], { meta: STEPS }),
  n('bd1', 2250, 840, 'festival', ['bd2'], { meta: STEPS }),
  n('bd2', 2430, 790, 'gleam', ['t0'], { meta: STEPS }),
  // Tournament Ring
  n('t0', 2590, 640, 'gleam', ['t1'], { meta: RING }),
  n('t1', 2760, 690, 'market', ['t2'], { meta: { ...RING, shop: 'wrench' } }),
  n('t2', 2930, 740, 'event', ['t3'], { eventId: 'dojo_bout', meta: RING }),
  n('t3', 3100, 800, 'gleam', ['t4'], { meta: RING }),
  n('t4', 3240, 900, 'relic', ['g0'], { meta: RING }),
  // Boulder Grounds: along the training ground on the east face, or out over the cloud steps to the
  // little hut on the Cloud Isle in the middle of the sea of clouds.
  n('g0', 3270, 1060, 'gleam', ['g1', 'i0'], { meta: { ...BOULDERS, signs: { g1: 'Training Ground', i0: 'Cloud Isle' } } }),
  n('g1', 3330, 1225, 'gleam', ['g2'], { meta: BOULDERS }),
  n('g2', 3300, 1395, 'event', ['g3'], { eventId: 'dojo_training', meta: BOULDERS }),
  n('g3', 3200, 1545, 'festival', ['g4'], { meta: BOULDERS }),
  n('g4', 3060, 1660, 'gleam', ['h0'], { meta: BOULDERS }),
  n('i0', 3100, 1090, 'gleam', ['i1'], { meta: CLOUDS }),
  n('i1', 2930, 1150, 'mischief', ['i2'], { meta: { ...CLOUDS, exposed: true } }),
  n('i2', 2760, 1230, 'portal', ['i3'], { meta: ISLE }),
  n('i3', 2640, 1370, 'festival', ['i4'], { meta: ISLE }),
  n('i4', 2600, 1540, 'gleam', ['i5'], { meta: ISLE }),
  n('i5', 2580, 1720, 'gleam', ['h2'], { meta: { ...CLOUDS, exposed: true } }),
  // Plum Terrace, home to the Lantern Gate.
  n('h0', 2900, 1750, 'mischief', ['h1'], { meta: TERRACE }),
  n('h1', 2740, 1830, 'gleam', ['h2'], { meta: TERRACE }),
  n('h2', 2570, 1900, 'festival', ['h3'], { meta: TERRACE }),
  n('h3', 2400, 1965, 'relic', ['h4'], { meta: TERRACE }),
  n('h4', 2230, 2020, 'gleam', ['h5'], { meta: TERRACE }),
  n('h5', 2060, 2065, 'gleam', ['s0'], { meta: TERRACE }),
  // Cherry Stairs (behind the Lantern Gate's key gate), up the middle peak to the summit.
  n('c0', 1730, 1940, 'gleam', ['c1'], { meta: { ...STAIRS, gate: 'stairs' } }),
  n('c1', 1800, 1760, 'festival', ['c2'], { meta: STAIRS }),
  n('c2', 1830, 1570, 'relic', ['c3'], { meta: STAIRS }),
  n('c3', 1800, 1380, 'gleam', ['c4'], { meta: STAIRS }),
  n('c4', 1740, 1190, 'mischief', ['c5'], { meta: STAIRS }),
  n('c5', 1680, 990, 'festival', ['c6'], { meta: STAIRS }),
  n('c6', 1620, 790, 'gleam', ['d3'], { meta: STAIRS }),
];

// Vector placeholder islands (drawn only while the rendered art is missing), fitted under every
// path-connected group of spaces; single-space islets bob like stepping stones.
const islands: BoardIsland[] = [
  { texture: 'island-large', x: 1480, y: 486, scale: 1.14 },
  { texture: 'island-large', x: 2760, y: 551, scale: 1.03 },
  { texture: 'island-large', x: 805, y: 709, scale: 1.08 },
  { texture: 'island-large', x: 3170, y: 711, scale: 1.03 },
  { texture: 'island-tiny', x: 2080, y: 743, scale: 0.86, bob: 8 },
  { texture: 'island-tiny', x: 2430, y: 743, scale: 0.86, bob: 9 },
  { texture: 'island-tiny', x: 1620, y: 743, scale: 0.86, bob: 7 },
  { texture: 'island-tiny', x: 2250, y: 793, scale: 0.86, bob: 10 },
  { texture: 'island-small', x: 1680, y: 918, scale: 0.92 },
  { texture: 'island-small', x: 640, y: 968, scale: 0.92 },
  { texture: 'island-small', x: 3270, y: 988, scale: 0.92 },
  { texture: 'island-tiny', x: 3100, y: 1043, scale: 0.86, bob: 8 },
  { texture: 'island-tiny', x: 2930, y: 1103, scale: 0.86, bob: 9 },
  { texture: 'island-small', x: 620, y: 1118, scale: 0.92 },
  { texture: 'island-small', x: 1740, y: 1118, scale: 0.92 },
  { texture: 'island-small', x: 3330, y: 1153, scale: 0.92 },
  { texture: 'island-medium', x: 2690, y: 1150, scale: 1.02 },
  { texture: 'island-small', x: 700, y: 1258, scale: 0.92 },
  { texture: 'island-small', x: 1800, y: 1308, scale: 0.92 },
  { texture: 'island-small', x: 3300, y: 1323, scale: 0.92 },
  { texture: 'island-medium', x: 2620, y: 1330, scale: 1.02 },
  { texture: 'island-small', x: 790, y: 1398, scale: 0.92 },
  { texture: 'island-large', x: 3130, y: 1453, scale: 1.11 },
  { texture: 'island-small', x: 1880, y: 1430, scale: 1.0 },
  { texture: 'island-small', x: 1830, y: 1498, scale: 0.92 },
  { texture: 'island-small', x: 930, y: 1518, scale: 0.92 },
  { texture: 'island-small', x: 650, y: 1528, scale: 0.92 },
  { texture: 'island-small', x: 1010, y: 1648, scale: 0.92 },
  { texture: 'island-large', x: 2820, y: 1664, scale: 0.93 },
  { texture: 'island-tiny', x: 2580, y: 1673, scale: 0.86, bob: 8 },
  { texture: 'island-small', x: 660, y: 1678, scale: 0.92 },
  { texture: 'island-small', x: 1800, y: 1688, scale: 0.92 },
  { texture: 'island-small', x: 1110, y: 1778, scale: 0.92 },
  { texture: 'island-medium', x: 870, y: 1760, scale: 1.0 },
  { texture: 'island-medium', x: 2485, y: 1826, scale: 1.07 },
  { texture: 'island-small', x: 1730, y: 1868, scale: 0.92 },
  { texture: 'island-small', x: 1230, y: 1908, scale: 0.92 },
  { texture: 'island-medium', x: 975, y: 1909, scale: 0.91 },
  { texture: 'island-large', x: 1810, y: 1923, scale: 1.05 },
];

// Placeholder landmarks (tinted festival props) until the rendered art replaces them.
const decorations: BoardDecoration[] = [
  // Summit Dojo: the pagoda, with paper lanterns
  { texture: 'observatory', x: 1480, y: 545, scale: 0.6, sorted: true, tint: 0xffb2a0 },
  { texture: 'lantern', x: 1300, y: 575, scale: 0.5, sorted: true, bob: 4 },
  { texture: 'lantern', x: 1665, y: 555, scale: 0.5, sorted: true, bob: 5 },
  // Tournament Ring: pennants and lanterns round the ring
  { texture: 'bunting', x: 2930, y: 630, scale: 0.72, sorted: false, depth: -15 },
  { texture: 'lantern', x: 2690, y: 610, scale: 0.5, sorted: true, bob: 4 },
  { texture: 'lantern', x: 3170, y: 760, scale: 0.5, sorted: true, bob: 5 },
  // Ninja Village: tiled houses and the noodle stall by Market Street
  { texture: 'workshop', x: 830, y: 1760, scale: 0.42, sorted: true, tint: 0xf4d2bc },
  { texture: 'workshop', x: 1180, y: 1700, scale: 0.38, sorted: true, tint: 0xe8c4b0, flipX: true },
  { texture: 'stall', x: 980, y: 1905, scale: 0.36, sorted: true, tint: 0xffc8a8 },
  { texture: 'lantern', x: 1060, y: 1935, scale: 0.42, sorted: true, bob: 4 },
  // Cherry trees on the middle peak, the Lantern Gate and the Plum Terrace
  { texture: 'tree-twist', x: 1650, y: 1640, scale: 0.25, sorted: true, tint: 0xffc2da },
  { texture: 'tree-twist', x: 1950, y: 1300, scale: 0.24, sorted: true, tint: 0xffcbe0 },
  { texture: 'tree-twist', x: 1590, y: 1080, scale: 0.22, sorted: true, tint: 0xffc2da },
  { texture: 'tree-twist', x: 1580, y: 1990, scale: 0.24, sorted: true, tint: 0xffcbe0 },
  { texture: 'tree-twist', x: 2130, y: 1985, scale: 0.24, sorted: true, tint: 0xffc2da },
  { texture: 'tree-twist', x: 2500, y: 1860, scale: 0.24, sorted: true, tint: 0xffd6ea },
  { texture: 'lantern', x: 1790, y: 2000, scale: 0.5, sorted: true, bob: 4 },
  { texture: 'lantern', x: 2000, y: 2010, scale: 0.5, sorted: true, bob: 5 },
  // The Cloud Isle's little hut, afloat on the sea of clouds
  { texture: 'workshop', x: 2520, y: 1400, scale: 0.3, sorted: true, tint: 0xfff0d8 },
  { texture: 'cloud-puff', x: 2470, y: 1580, scale: 0.7, sorted: false, depth: -46, bob: 6 },
  { texture: 'cloud-puff', x: 2860, y: 1440, scale: 0.6, sorted: false, depth: -46, bob: 7 },
  { texture: 'cloud-puff', x: 2250, y: 960, scale: 0.6, sorted: false, depth: -46, bob: 5 },
];

/** The world's minigames that exist in this build (the minigame agents fill in info.ts). */
const DOJO_GAMES = ['cloud-rider', 'clone-chaos'].filter((id) => DOJO_INFO.infos.some((m) => m.id === id));

/**
 * The Blender diorama exists (scripts/art/worlds/dojo/board.py → public/assets/rendered/dojo and its
 * Lite copy): it replaces the placeholder islands and landmarks wholesale.
 */
const RENDERED = true;

export const DOJO_BOARD: BoardDef | null = {
  id: 'dojo',
  name: 'Dojo Summit',
  subtitle: 'Mountain peaks above a sea of clouds',
  description:
    'Climb from the Lantern Gate through a ninja village of tiled rooftops, past the Training Falls to the pagoda on the summit, then cross the rope bridge to the Tournament Ring. Train, spar and dodge the smoke bombs on the way to the Star Coins.',
  width: 3600,
  height: 2400,
  nodes,
  startNode: 's0',
  relicGates: ['m4', 'd1', 't4', 'h3', 'c2'],
  portals: [['f1', 'i2']],
  bridges: [
    {
      id: 'rope',
      nodes: ['b0', 'b1', 'b2'],
      detour: ['bd0', 'bd1', 'bd2'],
      prop: { x: 2250, y: 610, scale: 1 },
      repairRounds: 2,
    },
  ],
  gates: [{ id: 'stairs', from: 's1', to: 'c0', prop: { x: 1722, y: 1985, scale: 0.5 } }],
  edgeStyles: {
    's3>v0': 'steps',
    'v1>f0': 'steps',
    'f4>d0': 'steps',
    'd5>b0': 'bridge',
    'b0>b1': 'bridge',
    'b1>b2': 'bridge',
    'b2>t0': 'bridge',
    'd5>bd0': 'steps',
    'bd0>bd1': 'steps',
    'bd1>bd2': 'steps',
    'bd2>t0': 'steps',
    't4>g0': 'steps',
    'g0>i0': 'steps',
    'i0>i1': 'steps',
    'i1>i2': 'steps',
    'i4>i5': 'steps',
    'i5>h2': 'steps',
    'g4>h0': 'steps',
    'h3>h4': 'steps',
    'c0>c1': 'steps',
    'c5>c6': 'steps',
    'c6>d3': 'steps',
  },
  islands,
  decorations: RENDERED ? [] : decorations,
  // Ora hosts from a little stage behind the Lantern Gate.
  hostSpot: { x: 1990, y: 1930 },
  theme: {
    world: 'dojo',
    time: 'cycle',
    minigames: DOJO_GAMES,
    // The Training Falls pour into their pool (mist rises where they land).
    waterfalls: [{ x: 505, y: 1068, lipX: 497, lipY: 854 }],
    // Crystal Surge and Portal Storm frame Suncoil's own landmarks.
    skipEvents: ['crystal_surge', 'portal_storm'],
    rendered: RENDERED,
    preview: RENDERED ? 'assets/lite/previews/dojo.webp' : undefined,
  },
};
