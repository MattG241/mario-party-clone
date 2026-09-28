// Pirate Cove: a floating tropical archipelago round a turquoise cove. Movement runs clockwise:
// Harbour Town → Palm Beach → Tangerine Terrace → (the north trail past the Treasure Cave, the
// Waterfall Lagoon and Dojo Isle, or straight across the cove over the galleon's deck) → the
// Lighthouse Point / Reef Steps fork → Harbour Market → Harbour Town.
import type { BoardNodeDef, NodeMeta, SpaceType } from '../../board/types';
import type { BoardDef } from '../types';
import { PIRATES_INFO } from './info';

function n(id: string, x: number, y: number, type: SpaceType, next: string[], extra: { eventId?: string; meta?: NodeMeta } = {}): BoardNodeDef {
  return { id, x, y, type, next, eventId: extra.eventId, metadata: extra.meta };
}

const HARBOUR = { region: 'Harbour Town' };
const BEACH = { region: 'Palm Beach', exposed: true };
const TERRACE = { region: 'Tangerine Terrace' };
const CAVE = { region: 'Treasure Cave' };
const BRIDGE = { region: 'Rope Bridge' };
const LAGOON = { region: 'Waterfall Lagoon' };
const DOJO = { region: 'Dojo Isle' };
const JETTY = { region: 'Cove Jetty' };
const GALLEON = { region: 'The Galleon' };
const SHOALS = { region: 'Sandbar Shoals', exposed: true };
const LIGHT = { region: 'Lighthouse Point' };
const REEF = { region: 'Reef Steps', exposed: true };
const MARKET = { region: 'Harbour Market' };

/** Where the Treasure Map event sends its finder: the mouth of the Treasure Cave. */
export const TREASURE_SPOT = 'k0';

const nodes: BoardNodeDef[] = [
  // Harbour Town (start)
  n('s0', 2060, 2060, 'start', ['s1'], { meta: HARBOUR }),
  n('s1', 1890, 2095, 'gleam', ['s2'], { meta: HARBOUR }),
  n('s2', 1720, 2105, 'festival', ['b0'], { meta: HARBOUR }),
  // Palm Beach: the shoreline route (the tide can wash over it)
  n('b0', 1550, 2095, 'gleam', ['b1'], { meta: BEACH }),
  n('b1', 1380, 2070, 'gleam', ['b2'], { meta: BEACH }),
  n('b2', 1212, 2025, 'event', ['b3'], { eventId: 'cove_high_tide', meta: BEACH }),
  n('b3', 1050, 1960, 'mischief', ['b4'], { meta: BEACH }),
  n('b4', 900, 1875, 'gleam', ['b5'], { meta: BEACH }),
  n('b5', 775, 1760, 'festival', ['t0'], { meta: { ...BEACH, exposed: false } }),
  // Tangerine Terrace: the map room and the tangerine grove
  n('t0', 700, 1615, 'gleam', ['t1'], { meta: TERRACE }),
  n('t1', 668, 1455, 'event', ['t2'], { eventId: 'cove_treasure_map', meta: TERRACE }),
  n('t2', 690, 1295, 'relic', ['t3'], { meta: TERRACE }),
  n('t3', 770, 1155, 'gleam', ['t4', 'c0'], { meta: { ...TERRACE, signs: { t4: 'North trail', c0: 'Board the galleon' } } }),
  n('t4', 790, 990, 'mischief', ['t5'], { meta: TERRACE }),
  n('t5', 840, 830, 'gleam', ['k0', 'r0'], { meta: { ...CAVE, signs: { k0: 'Treasure Cave', r0: 'Rope bridge' } } }),
  // Treasure Cave (the longer way, past a Star Coin gate and a portal)
  n('k0', 780, 670, 'gleam', ['k1'], { meta: CAVE }),
  n('k1', 860, 520, 'relic', ['k2'], { meta: CAVE }),
  n('k2', 1010, 440, 'portal', ['k3'], { meta: CAVE }),
  n('k3', 1180, 420, 'gleam', ['l0'], { meta: CAVE }),
  // Rope bridge over the sea (the quicker way)
  n('r0', 1005, 770, 'gleam', ['r1'], { meta: BRIDGE }),
  n('r1', 1170, 705, 'mischief', ['r2'], { meta: BRIDGE }),
  n('r2', 1310, 610, 'gleam', ['l0'], { meta: BRIDGE }),
  // Waterfall Lagoon
  n('l0', 1355, 460, 'gleam', ['l1'], { meta: LAGOON }),
  n('l1', 1525, 500, 'festival', ['l2'], { meta: LAGOON }),
  n('l2', 1695, 525, 'gleam', ['l3'], { meta: LAGOON }),
  n('l3', 1865, 520, 'mischief', ['l4'], { meta: LAGOON }),
  n('l4', 2035, 495, 'gleam', ['z0'], { meta: LAGOON }),
  // Dojo Isle: the swordsman's training hut
  n('z0', 2205, 475, 'gleam', ['z1'], { meta: DOJO }),
  n('z1', 2375, 490, 'festival', ['z2'], { meta: DOJO }),
  n('z2', 2535, 545, 'gleam', ['z3'], { meta: DOJO }),
  n('z3', 2660, 660, 'relic', ['z4'], { meta: DOJO }),
  n('z4', 2700, 825, 'mischief', ['e0'], { meta: DOJO }),
  // Across the cove: the jetty, the galleon's deck (feast table and cannons), the sandbar and reef stones
  n('c0', 945, 1215, 'gleam', ['c1'], { meta: JETTY }),
  n('c1', 1110, 1265, 'gleam', ['d0'], { meta: JETTY }),
  n('d0', 1275, 1310, 'gleam', ['d1'], { meta: GALLEON }),
  n('d1', 1440, 1320, 'relic', ['d2'], { meta: GALLEON }),
  n('d2', 1605, 1320, 'event', ['d3'], { eventId: 'cove_cannon_volley', meta: GALLEON }),
  n('d3', 1770, 1310, 'gleam', ['c2'], { meta: GALLEON }),
  n('c2', 1935, 1390, 'festival', ['c3'], { meta: SHOALS }),
  n('c3', 2105, 1395, 'gleam', ['c4'], { meta: SHOALS }),
  n('c4', 2270, 1330, 'gleam', ['c5'], { meta: SHOALS }),
  n('c5', 2435, 1250, 'mischief', ['f0'], { meta: SHOALS }),
  // The lighthouse fork
  n('e0', 2700, 995, 'gleam', ['o0', 'f0'], { meta: { ...LIGHT, signs: { o0: 'Lighthouse Point', f0: 'Reef Steps' } } }),
  n('o0', 2865, 940, 'gleam', ['o1'], { meta: LIGHT }),
  n('o1', 3030, 970, 'portal', ['o2'], { meta: LIGHT }),
  n('o2', 3170, 1060, 'relic', ['o3'], { meta: LIGHT }),
  n('o3', 3240, 1215, 'festival', ['o4'], { meta: LIGHT }),
  n('o4', 3215, 1385, 'gleam', ['o5'], { meta: LIGHT }),
  n('o5', 3120, 1530, 'mischief', ['m0'], { meta: LIGHT }),
  // Reef Steps: stepping stones over the shallows (the tide can wash over them)
  n('f0', 2600, 1160, 'gleam', ['f1'], { meta: REEF }),
  n('f1', 2690, 1310, 'mischief', ['f2'], { meta: REEF }),
  n('f2', 2820, 1435, 'event', ['m0'], { eventId: 'cove_high_tide', meta: REEF }),
  // Harbour Market
  n('m0', 2975, 1580, 'gleam', ['m1'], { meta: MARKET }),
  n('m1', 2830, 1690, 'market', ['m2'], { meta: { ...MARKET, shop: 'pipper' } }),
  n('m2', 2675, 1785, 'gleam', ['m3'], { meta: MARKET }),
  n('m3', 2520, 1870, 'festival', ['m4'], { meta: MARKET }),
  n('m4', 2370, 1950, 'gleam', ['m5'], { meta: HARBOUR }),
  n('m5', 2210, 2010, 'mischief', ['s0'], { meta: HARBOUR }),
];

/** This world's minigames (stretch-snatch: Luffy, triple-slash: Zoro, storm-navigator: Nami), favoured once they exist. */
const WORLD_GAMES = ['stretch-snatch', 'triple-slash', 'storm-navigator'];

export const PIRATES_BOARD: BoardDef | null = {
  id: 'pirates',
  name: 'Pirate Cove',
  subtitle: 'Floating archipelago of the moored galleon',
  description:
    'Palm beaches, a tangerine terrace, a hidden treasure cave and a lighthouse ring a turquoise cove. Cut across the galleon’s deck or take the long way past the waterfall and the dojo, and mind the tide!',
  width: 3600,
  height: 2400,
  nodes,
  startNode: 's0',
  relicGates: ['t2', 'k1', 'd1', 'z3', 'o2'],
  portals: [['k2', 'o1']],
  bridges: [],
  gates: [],
  edgeStyles: {
    // the rope bridge (the game draws it in both looks)
    't5>r0': 'bridge',
    'r0>r1': 'bridge',
    'r1>r2': 'bridge',
    'r2>l0': 'bridge',
    // hops between islands, the gangplanks and the reef stones
    't4>t5': 'steps',
    'k3>l0': 'steps',
    'l4>z0': 'steps',
    't3>c0': 'steps',
    'c1>d0': 'steps',
    'd3>c2': 'steps',
    'c3>c4': 'steps',
    'c4>c5': 'steps',
    'c5>f0': 'steps',
    'e0>f0': 'steps',
    'f0>f1': 'steps',
    'f1>f2': 'steps',
    'f2>m0': 'steps',
    'm0>m1': 'steps',
  },
  islands: [
    // Harbour Town and Palm Beach
    { texture: 'island-wide', x: 2080, y: 1880, scale: 1.02 },
    { texture: 'island-wide', x: 1250, y: 1880, scale: 1.0 },
    { texture: 'island-medium', x: 830, y: 1700, scale: 0.62 },
    // Harbour Market
    { texture: 'island-medium', x: 2640, y: 1690, scale: 0.9 },
    // Tangerine Terrace and the north trail
    { texture: 'island-large', x: 700, y: 1160, scale: 0.62 },
    { texture: 'island-medium', x: 690, y: 1380, scale: 0.7 },
    { texture: 'island-small', x: 790, y: 930, scale: 0.55 },
    // Treasure Cave
    { texture: 'island-large', x: 930, y: 380, scale: 0.72 },
    { texture: 'island-small', x: 800, y: 590, scale: 0.6 },
    // Waterfall Lagoon and Dojo Isle
    { texture: 'island-wide', x: 1700, y: 380, scale: 0.86 },
    { texture: 'island-wide', x: 2470, y: 400, scale: 0.8 },
    { texture: 'island-small', x: 2680, y: 620, scale: 0.6 },
    // Lighthouse Point
    { texture: 'island-large', x: 3060, y: 900, scale: 0.62 },
    { texture: 'island-large', x: 3120, y: 1140, scale: 0.72 },
    { texture: 'island-medium', x: 3100, y: 1400, scale: 0.6 },
    // the galleon (a long raft of an island until its art exists), the jetty and the sandbar
    { texture: 'island-wide', x: 1520, y: 1255, scale: 0.72 },
    { texture: 'island-tiny', x: 960, y: 1170, scale: 0.55, bob: 6 },
    { texture: 'island-tiny', x: 1110, y: 1215, scale: 0.5, bob: 8 },
    { texture: 'island-small', x: 2020, y: 1350, scale: 0.72 },
    { texture: 'island-tiny', x: 2275, y: 1285, scale: 0.55, bob: 7 },
    { texture: 'island-tiny', x: 2440, y: 1205, scale: 0.55, bob: 9 },
    // Reef Steps
    { texture: 'island-tiny', x: 2600, y: 1115, scale: 0.55, bob: 8 },
    { texture: 'island-tiny', x: 2690, y: 1265, scale: 0.55, bob: 6 },
    { texture: 'island-tiny', x: 2820, y: 1390, scale: 0.55, bob: 9 },
  ],
  decorations: [
    // Harbour Town
    { texture: 'bunting', x: 2060, y: 1985, scale: 0.7, sorted: false, depth: -15 },
    { texture: 'lantern', x: 1810, y: 2040, scale: 0.5, sorted: true, bob: 4 },
    { texture: 'lantern', x: 2290, y: 1935, scale: 0.5, sorted: true, bob: 5 },
    // Palm Beach
    { texture: 'props', frame: '24', x: 1470, y: 2010, scale: 0.36, sorted: true },
    // Tangerine Terrace: the map room and the grove
    { texture: 'stall', x: 525, y: 1500, scale: 0.4, sorted: true, id: 'map-room' },
    { texture: 'tree-twist', x: 545, y: 1290, scale: 0.26, sorted: true, tint: 0xffc890 },
    { texture: 'tree-twist', x: 600, y: 1150, scale: 0.22, sorted: true, tint: 0xffd0a0 },
    { texture: 'props', frame: '25', x: 880, y: 1100, scale: 0.34, sorted: true },
    // Treasure Cave
    { texture: 'props', frame: '6', x: 1000, y: 565, scale: 0.34, sorted: true, id: 'chest' },
    { texture: 'props', frame: '26', x: 930, y: 790, scale: 0.32, sorted: true },
    { texture: 'lantern', x: 700, y: 560, scale: 0.45, sorted: true, bob: 4 },
    // Waterfall Lagoon
    { texture: 'lantern', x: 1790, y: 450, scale: 0.45, sorted: true, bob: 4 },
    // Dojo Isle
    { texture: 'workshop', x: 2450, y: 425, scale: 0.4, sorted: true, id: 'dojo' },
    // the galleon: its festival cannon fires the volley
    { texture: 'props', frame: '15', x: 1640, y: 1262, scale: 0.36, sorted: true, id: 'cannon' },
    { texture: 'lantern', x: 1200, y: 1262, scale: 0.42, sorted: true, bob: 3 },
    // Lighthouse Point
    { texture: 'observatory', x: 3390, y: 1320, scale: 0.4, sorted: true, id: 'lighthouse' },
    { texture: 'props', frame: '25', x: 2800, y: 1060, scale: 0.34, sorted: true },
    // Harbour Market
    { texture: 'stall', x: 2700, y: 1640, scale: 0.44, sorted: true, id: 'market-stall' },
    { texture: 'lantern', x: 2560, y: 1790, scale: 0.5, sorted: true, bob: 5 },
  ],
  // Ora hosts from the harbour quay beside the start space.
  hostSpot: { x: 1975, y: 1935 },
  theme: {
    world: 'pirates',
    time: 'cycle',
    minigames: WORLD_GAMES.filter((id) => PIRATES_INFO.infos.some((m) => m.id === id)),
    // Suncoil's own crystal generators and observatory events point at its spaces.
    skipEvents: ['crystal_surge', 'portal_storm'],
  },
};
