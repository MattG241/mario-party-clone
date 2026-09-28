// Cartoon Coast: a sunny floating shoreline. Movement runs clockwise: the Boardwalk → the Palm Dunes →
// (the Loop Lane through the loop-the-loop, or the Hilltop Trail over the checkered hills) → Maple
// Street (past the donut shop and the family house, or through the park) → (out over Bubble Bay's
// sea-floor town, or along the Cliff Road) → the Seaside Pier → the Boardwalk.
import type { BoardNodeDef, NodeMeta, SpaceType } from '../../board/types';
import type { BoardDef } from '../types';
import { TOONS_INFO } from './info';

function n(id: string, x: number, y: number, type: SpaceType, next: string[], extra: { eventId?: string; meta?: NodeMeta } = {}): BoardNodeDef {
  return { id, x, y, type, next, eventId: extra.eventId, metadata: extra.meta };
}

const BOARDWALK = { region: 'Boardwalk' };
const DUNES = { region: 'Palm Dunes' };
const LOOP = { region: 'Loop Lane' };
const HILLS = { region: 'Checkered Hills' };
const STREET = { region: 'Maple Street' };
const PARK = { region: 'Maple Park' };
const BAY = { region: 'Bubble Bay' };
const CLIFF = { region: 'Cliff Road' };
const PIER = { region: 'Seaside Pier' };

const nodes: BoardNodeDef[] = [
  // The Boardwalk (start)
  n('w0', 2000, 2050, 'start', ['w1'], { meta: BOARDWALK }),
  n('w1', 1830, 2080, 'gleam', ['w2'], { meta: BOARDWALK }),
  n('w2', 1660, 2085, 'market', ['w3'], { meta: { ...BOARDWALK, shop: 'pipper' } }),
  n('w3', 1490, 2065, 'festival', ['w4'], { meta: BOARDWALK }),
  n('w4', 1322, 2025, 'gleam', ['w5'], { meta: BOARDWALK }),
  n('w5', 1162, 1962, 'mischief', ['w6'], { meta: DUNES }),
  n('w6', 1015, 1880, 'gleam', ['h0'], { meta: DUNES }),
  // The Palm Dunes, up the west shore
  n('h0', 895, 1760, 'festival', ['h1'], { meta: DUNES }),
  n('h1', 815, 1612, 'relic', ['h2'], { meta: DUNES }),
  n('h2', 778, 1448, 'portal', ['h3'], { meta: DUNES }),
  n('h3', 785, 1283, 'gleam', ['h4'], { meta: HILLS }),
  n('h4', 830, 1122, 'gleam', ['q0', 'u0'], { meta: { ...HILLS, signs: { q0: 'Loop-the-loop', u0: 'Hilltop trail' } } }),
  // The Loop Lane: through the loop-the-loop (quick, and the loop can rocket you ahead)
  n('q0', 1000, 1082, 'gleam', ['q1'], { meta: LOOP }),
  n('q1', 1170, 1062, 'event', ['q2'], { eventId: 'coast_loop_launch', meta: LOOP }),
  n('q2', 1340, 1045, 'gleam', ['q3'], { meta: LOOP }),
  n('q3', 1498, 985, 'mischief', ['m0'], { meta: LOOP }),
  // The Hilltop Trail over the checkered hills (longer, past a Star Coin gate)
  n('u0', 800, 960, 'gleam', ['u1'], { meta: HILLS }),
  n('u1', 850, 800, 'festival', ['u2'], { meta: HILLS }),
  n('u2', 975, 690, 'relic', ['u3'], { meta: HILLS }),
  n('u3', 1140, 635, 'gleam', ['u4'], { meta: HILLS }),
  n('u4', 1310, 625, 'mischief', ['u5'], { meta: HILLS }),
  n('u5', 1470, 690, 'gleam', ['m0'], { meta: HILLS }),
  // Maple Street
  n('m0', 1605, 835, 'gleam', ['m1'], { meta: STREET }),
  n('m1', 1765, 760, 'festival', ['m2'], { meta: STREET }),
  n('m2', 1930, 700, 'market', ['m3'], { meta: { ...STREET, shop: 'wrench' } }),
  n('m3', 2100, 660, 'gleam', ['m4', 'k0'], { meta: { ...STREET, signs: { m4: 'Maple Street', k0: 'Park path' } } }),
  // the street: the donut shop and the family house
  n('m4', 2270, 600, 'gleam', ['m5'], { meta: STREET }),
  n('m5', 2440, 570, 'event', ['m6'], { eventId: 'coast_donut_delivery', meta: STREET }),
  n('m6', 2610, 575, 'relic', ['m7'], { meta: STREET }),
  n('m7', 2770, 635, 'gleam', ['m8'], { meta: STREET }),
  // the park path
  n('k0', 2240, 760, 'mischief', ['k1'], { meta: PARK }),
  n('k1', 2410, 815, 'gleam', ['k2'], { meta: PARK }),
  n('k2', 2580, 825, 'festival', ['k3'], { meta: PARK }),
  n('k3', 2740, 790, 'gleam', ['m8'], { meta: PARK }),
  n('m8', 2880, 745, 'gleam', ['m9'], { meta: STREET }),
  n('m9', 2975, 885, 'gleam', ['y0', 'v0'], { meta: { ...CLIFF, signs: { y0: 'Bubble Bay', v0: 'Cliff road' } } }),
  // Bubble Bay: stepping out over the sea-floor town (pineapple house, tiki hut, jellyfish)
  n('y0', 3130, 960, 'gleam', ['y1'], { meta: BAY }),
  n('y1', 3235, 1095, 'relic', ['y2'], { meta: BAY }),
  n('y2', 3275, 1260, 'event', ['y3'], { eventId: 'coast_jellyfish', meta: BAY }),
  n('y3', 3240, 1430, 'portal', ['y4'], { meta: BAY }),
  n('y4', 3130, 1565, 'gleam', ['y5'], { meta: BAY }),
  n('y5', 2975, 1650, 'mischief', ['g0'], { meta: BAY }),
  // the Cliff Road
  n('v0', 2935, 1050, 'gleam', ['v1'], { meta: CLIFF }),
  n('v1', 2890, 1215, 'festival', ['v2'], { meta: CLIFF }),
  n('v2', 2850, 1380, 'gleam', ['g0'], { meta: CLIFF }),
  // the Seaside Pier, back to the Boardwalk
  n('g0', 2810, 1545, 'gleam', ['g1'], { meta: PIER }),
  n('g1', 2690, 1680, 'festival', ['g2'], { meta: PIER }),
  n('g2', 2545, 1790, 'gleam', ['g3'], { meta: PIER }),
  n('g3', 2375, 1880, 'relic', ['g4'], { meta: PIER }),
  n('g4', 2180, 1965, 'gleam', ['w0'], { meta: BOARDWALK }),
];

/** This world's minigames (ring-rush: Sonic, patty-panic: SpongeBob, donut-dash: Homer), favoured once they exist. */
const WORLD_GAMES = ['ring-rush', 'patty-panic', 'donut-dash'];

export const TOONS_BOARD: BoardDef | null = {
  id: 'toons',
  name: 'Cartoon Coast',
  subtitle: 'Sunny shore of the loop-the-loop',
  description:
    'Race the loop through the checkered hills, stroll Maple Street past the giant donut, and hop across Bubble Bay by the pineapple house and the tiki hut. Everything ends at the Boardwalk!',
  width: 3600,
  height: 2400,
  nodes,
  startNode: 'w0',
  relicGates: ['h1', 'u2', 'm6', 'y1', 'g3'],
  portals: [['h2', 'y3']],
  bridges: [],
  gates: [],
  edgeStyles: {
    // stepping stones across Bubble Bay
    'm9>y0': 'steps',
    'y0>y1': 'steps',
    'y1>y2': 'steps',
    'y2>y3': 'steps',
    'y3>y4': 'steps',
    'y4>y5': 'steps',
    'y5>g0': 'steps',
  },
  islands: [
    // the Boardwalk and the dunes
    { texture: 'island-wide', x: 1660, y: 1900, scale: 1.02 },
    { texture: 'island-wide', x: 2300, y: 1780, scale: 0.9 },
    { texture: 'island-large', x: 950, y: 1640, scale: 0.7 },
    { texture: 'island-medium', x: 800, y: 1300, scale: 0.78 },
    // the checkered hills and the loop
    { texture: 'island-large', x: 1150, y: 880, scale: 0.95 },
    { texture: 'island-wide', x: 1150, y: 560, scale: 0.8 },
    { texture: 'island-medium', x: 1900, y: 1290, scale: 1.1 },
    // Maple Street and the park
    { texture: 'island-wide', x: 1950, y: 590, scale: 0.9 },
    { texture: 'island-wide', x: 2600, y: 470, scale: 0.86 },
    { texture: 'island-medium', x: 2520, y: 700, scale: 0.8 },
    // the Cliff Road and the pier
    { texture: 'island-large', x: 2860, y: 930, scale: 0.55 },
    { texture: 'island-large', x: 2830, y: 1180, scale: 0.55 },
    { texture: 'island-medium', x: 2730, y: 1470, scale: 0.7 },
    // Bubble Bay's sea-floor town
    { texture: 'island-tiny', x: 3130, y: 915, scale: 0.6, bob: 7 },
    { texture: 'island-small', x: 3240, y: 1040, scale: 0.6, bob: 5 },
    { texture: 'island-tiny', x: 3275, y: 1215, scale: 0.6, bob: 9 },
    { texture: 'island-small', x: 3240, y: 1370, scale: 0.6, bob: 6 },
    { texture: 'island-tiny', x: 3130, y: 1520, scale: 0.6, bob: 8 },
    { texture: 'island-tiny', x: 2975, y: 1605, scale: 0.6, bob: 7 },
  ],
  decorations: [
    // the Boardwalk
    { texture: 'stall', x: 1600, y: 1990, scale: 0.42, sorted: true, id: 'boardwalk-stall' },
    { texture: 'bunting', x: 1860, y: 1980, scale: 0.65, sorted: false, depth: -15 },
    { texture: 'lantern', x: 1400, y: 1965, scale: 0.5, sorted: true, bob: 4 },
    { texture: 'lantern', x: 2110, y: 1950, scale: 0.5, sorted: true, bob: 5 },
    // the loop lane's springs and the hills
    { texture: 'props', frame: '21', x: 1085, y: 1010, scale: 0.3, sorted: true },
    { texture: 'props', frame: '21', x: 1420, y: 960, scale: 0.3, sorted: true },
    { texture: 'props', frame: '25', x: 700, y: 1110, scale: 0.34, sorted: true },
    { texture: 'windmill', x: 1230, y: 780, scale: 0.36, sorted: true, id: 'hill-mill' },
    // Maple Street: the donut shop and the family house
    { texture: 'stall', x: 2445, y: 480, scale: 0.4, sorted: true, tint: 0xffc6e0, id: 'donut-shop' },
    { texture: 'workshop', x: 2640, y: 490, scale: 0.42, sorted: true, id: 'family-house' },
    { texture: 'props', frame: '25', x: 2120, y: 800, scale: 0.34, sorted: true },
    { texture: 'tree-twist', x: 2420, y: 945, scale: 0.24, sorted: true },
    // Bubble Bay's pineapple house and the Cliff Road
    { texture: 'workshop', x: 3390, y: 1150, scale: 0.36, sorted: true, tint: 0xffc44a, id: 'pineapple-house' },
    { texture: 'props', frame: '25', x: 3060, y: 860, scale: 0.34, sorted: true },
    { texture: 'lantern', x: 2990, y: 1300, scale: 0.46, sorted: true, bob: 4 },
  ],
  // Ora hosts from the Boardwalk beside the start space.
  hostSpot: { x: 1905, y: 1950 },
  theme: {
    world: 'toons',
    time: 'day',
    minigames: WORLD_GAMES.filter((id) => TOONS_INFO.infos.some((m) => m.id === id)),
    // Suncoil's own crystal generators and observatory events point at its spaces.
    skipEvents: ['crystal_surge', 'portal_storm'],
  },
};
