// Capitol Gardens: a stately civic park on a floating isle. The trail runs clockwise from the
// Bandstand Green: through the Rose Garden (under the arbor or along the hedges), past the
// basketball court and up to the domed hall, along the back avenue by the stone obelisk to the white
// columned mansion and its fountain, down past the putting green and home under the pennants. The
// Reflecting Pool promenade cuts across the middle, and a key opens the Cherry Avenue straight up to it.
// The court and the green mirror each other across the park's centre line: equal in size, spaces
// and standing.
import type { BoardDecoration, BoardDef, BoardIsland, BoardNodeDef, NodeMeta, SpaceType } from '../../board/types';
import { CAPITOL_INFO } from './info';

function n(id: string, x: number, y: number, type: SpaceType, next: string[], extra: { eventId?: string; meta?: NodeMeta } = {}): BoardNodeDef {
  return { id, x, y, type, next, eventId: extra.eventId, metadata: extra.meta };
}

const GREEN = { region: 'Bandstand Green' };
const ROSES = { region: 'Rose Garden' };
const COURT = { region: 'Basketball Court' };
const HALL = { region: 'Domed Hall' };
const OBELISK = { region: 'Obelisk Walk' };
const MANSION = { region: 'White Mansion' };
const PUTTING = { region: 'Putting Green' };
const PENNANTS = { region: 'Pennant Promenade' };
const POOL = { region: 'Reflecting Pool' };
const AVENUE = { region: 'Cherry Avenue' };

const nodes: BoardNodeDef[] = [
  // Bandstand Green (start). a1 forks: west to the Rose Garden, or up the Cherry Avenue with a key.
  n('a0', 1860, 2090, 'start', ['a1'], { meta: GREEN }),
  n('a1', 1690, 2120, 'gleam', ['a2', 'w0'], { meta: { ...GREEN, signs: { a2: 'Rose Garden', w0: 'Cherry Avenue (Prism Key)' } } }),
  n('a2', 1520, 2100, 'festival', ['a3'], { meta: GREEN }),
  n('a3', 1350, 2050, 'gleam', ['r0'], { meta: GREEN }),
  // Rose Garden: under the rose arbor (short) or along the hedge walk past Pipper's stall.
  n('r0', 1190, 1970, 'mischief', ['rm0', 'rh0'], { meta: { ...ROSES, signs: { rm0: 'Rose Arbor', rh0: 'Hedge Walk' } } }),
  n('rm0', 1110, 1820, 'gleam', ['rm1'], { meta: ROSES }),
  n('rm1', 1050, 1670, 'event', ['r1'], { eventId: 'capitol_party', meta: ROSES }),
  n('rh0', 1020, 2000, 'gleam', ['rh1'], { meta: ROSES }),
  n('rh1', 860, 1930, 'market', ['rh2'], { meta: { ...ROSES, shop: 'pipper' } }),
  n('rh2', 750, 1810, 'portal', ['rh3'], { meta: ROSES }),
  n('rh3', 720, 1660, 'festival', ['r1'], { meta: ROSES }),
  n('r1', 850, 1535, 'gleam', ['k0'], { meta: ROSES }),
  // Basketball Court (west wing).
  n('k0', 910, 1400, 'gleam', ['k1'], { meta: COURT }),
  n('k1', 880, 1255, 'relic', ['k2'], { meta: COURT }),
  n('k2', 920, 1110, 'festival', ['n0', 'x0'], { meta: { ...COURT, signs: { n0: 'Domed Hall', x0: 'Reflecting Pool' } } }),
  // Domed Hall, up the terrace steps.
  n('n0', 960, 950, 'gleam', ['n1'], { meta: HALL }),
  n('n1', 1040, 810, 'mischief', ['n2'], { meta: HALL }),
  n('n2', 1180, 710, 'gleam', ['n3'], { meta: HALL }),
  n('n3', 1340, 660, 'event', ['n4'], { eventId: 'capitol_parade', meta: HALL }),
  n('n4', 1510, 640, 'relic', ['o0'], { meta: HALL }),
  // The back avenue past the stone obelisk.
  n('o0', 1680, 640, 'gleam', ['o1'], { meta: OBELISK }),
  n('o1', 1850, 650, 'festival', ['o2'], { meta: OBELISK }),
  n('o2', 2020, 670, 'gleam', ['o3'], { meta: OBELISK }),
  n('o3', 2180, 710, 'mischief', ['m0'], { meta: OBELISK }),
  // White Mansion: its lawn, the fountain and Wrench's stall.
  n('m0', 2330, 770, 'gleam', ['m1'], { meta: MANSION }),
  n('m1', 2480, 830, 'event', ['m2'], { eventId: 'capitol_wish', meta: MANSION }),
  n('m2', 2620, 920, 'market', ['g0'], { meta: { ...MANSION, shop: 'wrench' } }),
  // Putting Green (east wing): the court's mirror image.
  n('g0', 2680, 1110, 'festival', ['g1'], { meta: PUTTING }),
  n('g1', 2720, 1255, 'relic', ['g2'], { meta: PUTTING }),
  n('g2', 2690, 1400, 'gleam', ['p0'], { meta: PUTTING }),
  // Pennant Promenade, home to the Bandstand Green.
  n('p0', 2750, 1535, 'mischief', ['p1'], { meta: PENNANTS }),
  n('p1', 2650, 1690, 'portal', ['p2'], { meta: PENNANTS }),
  n('p2', 2520, 1820, 'event', ['p3'], { eventId: 'capitol_party', meta: PENNANTS }),
  n('p3', 2370, 1925, 'gleam', ['p4'], { meta: PENNANTS }),
  n('p4', 2200, 2005, 'relic', ['p5'], { meta: PENNANTS }),
  n('p5', 2030, 2065, 'gleam', ['a0'], { meta: PENNANTS }),
  // Reflecting Pool promenade: straight across the middle to the putting green.
  n('x0', 1096, 1105, 'gleam', ['x1'], { meta: POOL }),
  n('x1', 1272, 1112, 'mischief', ['x2'], { meta: POOL }),
  n('x2', 1448, 1118, 'event', ['x3'], { eventId: 'capitol_parade', meta: POOL }),
  n('x3', 1624, 1122, 'gleam', ['x4'], { meta: POOL }),
  n('x4', 1800, 1124, 'relic', ['x5'], { meta: POOL }),
  n('x5', 1976, 1122, 'gleam', ['x6'], { meta: POOL }),
  n('x6', 2152, 1118, 'festival', ['x7'], { meta: POOL }),
  n('x7', 2328, 1112, 'mischief', ['x8'], { meta: POOL }),
  n('x8', 2504, 1105, 'gleam', ['g0'], { meta: POOL }),
  // Cherry Avenue (behind the Bandstand Green's garden gate), up to the middle of the pool.
  n('w0', 1760, 1955, 'gleam', ['w1'], { meta: { ...AVENUE, gate: 'avenue' } }),
  n('w1', 1790, 1790, 'festival', ['w2'], { meta: AVENUE }),
  n('w2', 1800, 1625, 'gleam', ['w3'], { meta: AVENUE }),
  n('w3', 1800, 1460, 'mischief', ['w4'], { meta: AVENUE }),
  n('w4', 1800, 1295, 'gleam', ['x4'], { meta: AVENUE }),
];

// Vector placeholder islands (drawn only while the rendered art is missing): the park is one broad
// isle, so big islands fill the lawns as well as the trails.
const islands: BoardIsland[] = [
  { texture: 'island-large', x: 2450, y: 470, scale: 1.0 },
  { texture: 'island-wide', x: 1760, y: 554, scale: 0.9 },
  { texture: 'island-large', x: 1110, y: 621, scale: 1.03 },
  { texture: 'island-medium', x: 2405, y: 696, scale: 1.04 },
  { texture: 'island-small', x: 2620, y: 848, scale: 0.92 },
  { texture: 'island-small', x: 960, y: 878, scale: 0.92 },
  { texture: 'island-wide', x: 1624, y: 966, scale: 1.1 },
  { texture: 'island-wide', x: 2150, y: 966, scale: 1.0 },
  { texture: 'island-small', x: 920, y: 1038, scale: 0.92 },
  { texture: 'island-small', x: 2680, y: 1038, scale: 0.92 },
  { texture: 'island-small', x: 880, y: 1183, scale: 0.92 },
  { texture: 'island-small', x: 2720, y: 1183, scale: 0.92 },
  { texture: 'island-wide', x: 1360, y: 1240, scale: 1.0 },
  { texture: 'island-wide', x: 2240, y: 1240, scale: 1.0 },
  { texture: 'island-small', x: 910, y: 1328, scale: 0.92 },
  { texture: 'island-small', x: 2690, y: 1328, scale: 0.92 },
  { texture: 'island-wide', x: 785, y: 1449, scale: 1.1 },
  { texture: 'island-small', x: 2750, y: 1463, scale: 0.92 },
  { texture: 'island-wide', x: 1380, y: 1480, scale: 1.0 },
  { texture: 'island-wide', x: 2220, y: 1480, scale: 1.0 },
  { texture: 'island-small', x: 2650, y: 1618, scale: 0.92 },
  { texture: 'island-wide', x: 1800, y: 1640, scale: 1.0 },
  { texture: 'island-large', x: 2445, y: 1729, scale: 1.06 },
  { texture: 'island-small', x: 750, y: 1738, scale: 0.92 },
  { texture: 'island-small', x: 1110, y: 1748, scale: 0.92 },
  { texture: 'island-medium', x: 940, y: 1854, scale: 1.11 },
  { texture: 'island-small', x: 1760, y: 1883, scale: 0.92 },
  { texture: 'island-small', x: 1190, y: 1898, scale: 0.92 },
  { texture: 'island-medium', x: 2115, y: 1931, scale: 1.04 },
  { texture: 'island-medium', x: 1605, y: 1974, scale: 1.11 },
];

// Placeholder landmarks (tinted festival props) until the rendered art replaces them.
const decorations: BoardDecoration[] = [
  // Domed Hall, the obelisk's stand-in lanterns and the White Mansion
  { texture: 'observatory', x: 1250, y: 575, scale: 0.62, sorted: true, tint: 0xfaf6ff },
  { texture: 'lantern', x: 1850, y: 575, scale: 0.7, sorted: true },
  { texture: 'workshop', x: 2440, y: 640, scale: 0.8, sorted: true, tint: 0xfffaf2 },
  { texture: 'crystal-generator', x: 2440, y: 720, scale: 0.24, sorted: true, tint: 0xd8f4ff },
  // Cherry Avenue: blossom trees down both sides of the walk
  { texture: 'tree-twist', x: 1690, y: 1760, scale: 0.2, sorted: true, tint: 0xffc2da },
  { texture: 'tree-twist', x: 1905, y: 1740, scale: 0.2, sorted: true, tint: 0xffcbe0 },
  { texture: 'tree-twist', x: 1700, y: 1430, scale: 0.2, sorted: true, tint: 0xffcbe0 },
  { texture: 'tree-twist', x: 1905, y: 1410, scale: 0.2, sorted: true, tint: 0xffc2da },
  { texture: 'tree-twist', x: 1180, y: 1030, scale: 0.18, sorted: true, tint: 0xffc2da },
  { texture: 'tree-twist', x: 2420, y: 1030, scale: 0.18, sorted: true, tint: 0xffcbe0 },
  // Rose Garden
  { texture: 'tree-twist', x: 900, y: 1760, scale: 0.16, sorted: true, tint: 0xff9fb4 },
  { texture: 'tree-twist', x: 930, y: 1640, scale: 0.15, sorted: true, tint: 0xffb8c8 },
  // Festival pennants in the game's colours along the promenade and by the bandstand
  { texture: 'bunting', x: 2500, y: 1700, scale: 0.6, sorted: false, depth: -15 },
  { texture: 'bunting', x: 1990, y: 1880, scale: 0.55, sorted: false, depth: -15 },
  { texture: 'bunting', x: 1800, y: 990, scale: 0.7, sorted: false, depth: -15 },
  { texture: 'lantern', x: 1560, y: 2000, scale: 0.45, sorted: true, bob: 4 },
  { texture: 'lantern', x: 2200, y: 1930, scale: 0.45, sorted: true, bob: 5 },
];

/** The world's minigames that exist in this build (the minigame agents fill in info.ts). */
const CAPITOL_GAMES = ['free-throw', 'fairway'].filter((id) => CAPITOL_INFO.infos.some((m) => m.id === id));

/**
 * The Blender diorama exists (scripts/art/worlds/capitol/board.py → public/assets/rendered/capitol and
 * its Lite copy): it replaces the placeholder islands and landmarks wholesale.
 */
const RENDERED = false;

export const CAPITOL_BOARD: BoardDef | null = {
  id: 'capitol',
  name: 'Capitol Gardens',
  subtitle: 'A stately park of fountains and blossoms',
  description:
    'Stroll a sunny civic park: a domed hall, a stone obelisk, a white columned mansion with its fountain, a long reflecting pool under cherry blossoms and a rose garden, with a basketball court and a putting green for a friendly game. Chase the Star Coins from lawn to lawn.',
  width: 3600,
  height: 2400,
  nodes,
  startNode: 'a0',
  relicGates: ['k1', 'n4', 'g1', 'p4', 'x4'],
  portals: [['rh2', 'p1']],
  bridges: [],
  gates: [{ id: 'avenue', from: 'a1', to: 'w0', prop: { x: 1725, y: 2040, scale: 0.5 } }],
  // One broad park isle: every trail is a garden path.
  edgeStyles: {},
  islands,
  decorations: RENDERED ? [] : decorations,
  // Ora hosts from the bandstand beside the start.
  hostSpot: { x: 2010, y: 1930 },
  theme: {
    world: 'capitol',
    time: 'day',
    minigames: CAPITOL_GAMES,
    waterfalls: [],
    // Crystal Surge and Portal Storm frame Suncoil's own landmarks.
    skipEvents: ['crystal_surge', 'portal_storm'],
    rendered: RENDERED,
    preview: RENDERED ? 'assets/lite/previews/capitol.webp' : undefined,
  },
};
