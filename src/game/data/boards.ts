// Board definitions. Suncoil Sanctuary is a floating festival island built around an ancient
// spiral-powered observatory. Movement runs clockwise: Festival Plaza → Twisting Grove →
// Crystal Works → Sky Bridge → Brass Terrace → Windy Ledge → Lantern Docks → Plaza.
import type { BoardDef, BoardNodeDef, NodeMeta, SpaceType } from '../board/types';
import { WORLD_BOARDS } from '../worlds/boards';

function n(id: string, x: number, y: number, type: SpaceType, next: string[], extra: { eventId?: string; meta?: NodeMeta } = {}): BoardNodeDef {
  return { id, x, y, type, next, eventId: extra.eventId, metadata: extra.meta };
}

const PLAZA = { region: 'Festival Plaza' };
const GROVE = { region: 'Twisting Grove' };
const WORKS = { region: 'Crystal Works' };
const SKY = { region: 'Sky Bridge' };
const TERRACE = { region: 'Brass Terrace' };
const WINDY = { region: 'Windy Ledge' };
const DOCKS = { region: 'Lantern Docks' };
const OBS = { region: 'Spiral Observatory' };

const suncoilNodes: BoardNodeDef[] = [
  // Festival Plaza (start). p1 branches into the Prism Gate shortcut through the observatory.
  n('p0', 2060, 2240, 'start', ['p1'], { meta: PLAZA }),
  n('p1', 1900, 2272, 'gleam', ['p2', 'o0'], { meta: { ...PLAZA, signs: { p2: 'Twisting Grove', o0: 'Observatory (Prism Key)' } } }),
  n('p2', 1740, 2250, 'festival', ['p3'], { meta: PLAZA }),
  n('p3', 1580, 2200, 'gleam', ['g0'], { meta: PLAZA }),
  // Twisting Grove: inner route past the tree (short, spring pads) or outer route (longer, richer).
  n('g0', 1400, 2110, 'mischief', ['g1'], { meta: GROVE }),
  n('g1', 1210, 2000, 'gleam', ['gi0', 'go0'], { meta: { ...GROVE, signs: { gi0: 'Inner trail', go0: 'Outer trail' } } }),
  n('gi0', 1120, 1830, 'mischief', ['gi1'], { meta: { ...GROVE, spring: true } }),
  n('gi1', 1080, 1660, 'gleam', ['gi2'], { meta: { ...GROVE, spring: true } }),
  n('gi2', 1030, 1490, 'event', ['g2'], { eventId: 'bouncy_trail', meta: { ...GROVE, spring: true } }),
  n('go0', 1010, 1960, 'gleam', ['go1'], { meta: GROVE }),
  n('go1', 820, 1870, 'festival', ['go2'], { meta: GROVE }),
  n('go2', 680, 1730, 'gleam', ['go3'], { meta: GROVE }),
  n('go3', 640, 1560, 'portal', ['go4'], { meta: GROVE }),
  n('go4', 700, 1390, 'relic', ['g2'], { meta: GROVE }),
  n('g2', 900, 1290, 'gleam', ['c0'], { meta: GROVE }),
  // Crystal Works
  n('c0', 930, 1120, 'gleam', ['c1'], { meta: WORKS }),
  n('c1', 1010, 955, 'event', ['c2'], { eventId: 'crystal_surge', meta: WORKS }),
  n('c2', 1140, 862, 'relic', ['c3'], { meta: WORKS }),
  n('c3', 1300, 815, 'portal', ['c4'], { meta: WORKS }),
  n('c4', 1450, 760, 'event', ['c5'], { eventId: 'bridge_break', meta: WORKS }),
  n('c5', 1600, 700, 'festival', ['b0', 'bd0'], { meta: WORKS }),
  // Sky Bridge (rope bridge) — or the Cloud Steps detour while the bridge is broken.
  n('b0', 1780, 650, 'gleam', ['b1'], { meta: { ...SKY, bridge: 'sky' } }),
  n('b1', 1960, 628, 'mischief', ['b2'], { meta: { ...SKY, bridge: 'sky', exposed: true } }),
  n('b2', 2140, 640, 'gleam', ['t0'], { meta: { ...SKY, bridge: 'sky' } }),
  n('bd0', 1760, 840, 'gleam', ['bd1'], { meta: { region: 'Cloud Steps', detour: 'sky', exposed: true } }),
  n('bd1', 1960, 900, 'festival', ['bd2'], { meta: { region: 'Cloud Steps', detour: 'sky', exposed: true } }),
  n('bd2', 2160, 840, 'gleam', ['t0'], { meta: { region: 'Cloud Steps', detour: 'sky', exposed: true } }),
  // Brass Terrace (Wrench's Workshop)
  n('t0', 2330, 668, 'gleam', ['t1'], { meta: TERRACE }),
  n('t1', 2500, 705, 'festival', ['t2'], { meta: TERRACE }),
  n('t2', 2670, 720, 'market', ['t3'], { meta: { ...TERRACE, shop: 'wrench' } }),
  n('t3', 2840, 700, 'event', ['t4'], { eventId: 'cannon_blast', meta: TERRACE }),
  n('t4', 3010, 680, 'relic', ['t5'], { meta: TERRACE }),
  n('t5', 3180, 720, 'mischief', ['t6'], { meta: TERRACE }),
  n('t6', 3330, 800, 'gleam', ['w0'], { meta: TERRACE }),
  // Windy Ledge: exposed cliff route (short, windy) or sheltered route (portal).
  n('w0', 3420, 965, 'gleam', ['w1e', 'w1s'], { meta: { ...WINDY, signs: { w1e: 'Cliff path', w1s: 'Sheltered path' } } }),
  n('w1e', 3610, 1065, 'gleam', ['w2e'], { meta: { ...WINDY, exposed: true } }),
  n('w2e', 3690, 1235, 'event', ['w3e'], { eventId: 'wind_gust', meta: { ...WINDY, exposed: true } }),
  n('w3e', 3640, 1405, 'festival', ['w5'], { meta: { ...WINDY, exposed: true } }),
  n('w1s', 3370, 1135, 'gleam', ['w2s'], { meta: WINDY }),
  n('w2s', 3320, 1300, 'mischief', ['w3s'], { meta: WINDY }),
  n('w3s', 3390, 1462, 'portal', ['w5'], { meta: WINDY }),
  n('w5', 3530, 1565, 'gleam', ['w6'], { meta: WINDY }),
  n('w6', 3480, 1725, 'mischief', ['d0'], { meta: WINDY }),
  // Lantern Docks (Pipper's Curios)
  n('d0', 3330, 1862, 'gleam', ['d1'], { meta: DOCKS }),
  n('d1', 3170, 1950, 'market', ['d2'], { meta: { ...DOCKS, shop: 'pipper' } }),
  n('d2', 3000, 2010, 'portal', ['d3'], { meta: DOCKS }),
  n('d3', 2830, 2060, 'relic', ['d4'], { meta: DOCKS }),
  n('d4', 2660, 2110, 'festival', ['d5'], { meta: DOCKS }),
  n('d5', 2490, 2160, 'event', ['d6'], { eventId: 'rolling_log', meta: DOCKS }),
  n('d6', 2300, 2220, 'gleam', ['p0'], { meta: DOCKS }),
  // Spiral Observatory shortcut (behind the Prism Gate between p1 and o0).
  n('o0', 1950, 2062, 'gleam', ['o1'], { meta: { ...OBS, gate: 'observatory' } }),
  n('o1', 2010, 1880, 'festival', ['o2'], { meta: OBS }),
  n('o2', 2090, 1700, 'relic', ['o3'], { meta: OBS }),
  n('o3', 2180, 1520, 'event', ['o4'], { eventId: 'portal_storm', meta: OBS }),
  n('o4', 2260, 1330, 'gleam', ['o5'], { meta: OBS }),
  n('o5', 2340, 1140, 'mischief', ['o6'], { meta: OBS }),
  n('o6', 2420, 950, 'festival', ['t1'], { meta: OBS }),
];

export const SUNCOIL: BoardDef = {
  id: 'suncoil',
  name: 'Suncoil Sanctuary',
  subtitle: 'Floating festival of the spiral observatory',
  description:
    'Rope bridges, crystal generators and brass machines ring an ancient observatory. Follow the trails, dodge the mischief, and chase the Star Keeper from spot to spot.',
  width: 4200,
  height: 2800,
  nodes: suncoilNodes,
  startNode: 'p0',
  relicGates: ['go4', 'c2', 't4', 'd3', 'o2'],
  portals: [
    ['c3', 'd2'],
    ['go3', 'w3s'],
  ],
  bridges: [
    {
      id: 'sky',
      nodes: ['b0', 'b1', 'b2'],
      detour: ['bd0', 'bd1', 'bd2'],
      prop: { x: 1960, y: 660, scale: 1 },
      repairRounds: 2,
    },
  ],
  gates: [{ id: 'observatory', from: 'p1', to: 'o0', prop: { x: 1925, y: 2150, scale: 0.55 } }],
  edgeStyles: {
    'p3>g0': 'steps',
    'g0>g1': 'steps',
    'g2>c0': 'steps',
    'c0>c1': 'steps',
    'c5>b0': 'bridge',
    'b0>b1': 'bridge',
    'b1>b2': 'bridge',
    'b2>t0': 'bridge',
    'c5>bd0': 'steps',
    'bd0>bd1': 'steps',
    'bd1>bd2': 'steps',
    'bd2>t0': 'steps',
    't6>w0': 'steps',
    'w0>w1e': 'steps',
    'w1e>w2e': 'steps',
    'w2e>w3e': 'steps',
    'w3e>w5': 'steps',
    'w6>d0': 'steps',
    'd6>p0': 'path',
    'p1>o0': 'steps',
    'o0>o1': 'steps',
    'o5>o6': 'steps',
    'o6>t1': 'steps',
  },
  islands: [
    { texture: 'island-wide', x: 2860, y: 540, scale: 0.98 },
    { texture: 'island-wide', x: 1250, y: 640, scale: 0.9 },
    { texture: 'island-tiny', x: 1770, y: 790, scale: 0.55, bob: 10 },
    { texture: 'island-tiny', x: 1960, y: 850, scale: 0.6, bob: 12 },
    { texture: 'island-tiny', x: 2160, y: 790, scale: 0.55, bob: 9 },
    { texture: 'island-small', x: 3410, y: 900, scale: 0.55 },
    { texture: 'island-small', x: 3650, y: 1000, scale: 0.5, bob: 8 },
    { texture: 'island-small', x: 3690, y: 1170, scale: 0.5, bob: 10 },
    { texture: 'island-small', x: 3640, y: 1340, scale: 0.5, bob: 9 },
    { texture: 'island-small', x: 2400, y: 880, scale: 0.46, bob: 7 },
    { texture: 'island-medium', x: 3380, y: 1060, scale: 0.9 },
    { texture: 'island-tiny', x: 930, y: 1060, scale: 0.6, bob: 8 },
    { texture: 'island-large', x: 890, y: 1240, scale: 0.98 },
    { texture: 'island-large', x: 2160, y: 1220, scale: 0.72 },
    { texture: 'island-small', x: 3510, y: 1500, scale: 0.62 },
    { texture: 'island-tiny', x: 1960, y: 1990, scale: 0.55, bob: 6 },
    { texture: 'island-tiny', x: 1400, y: 2045, scale: 0.6, bob: 9 },
    { texture: 'island-large', x: 2960, y: 1800, scale: 1.02 },
    { texture: 'island-large', x: 1880, y: 2100, scale: 0.96 },
  ],
  decorations: [
    // Plaza
    { texture: 'bunting', x: 1860, y: 2130, scale: 0.9, sorted: false, depth: -15 },
    { texture: 'lantern', x: 1640, y: 2160, scale: 0.5, sorted: true, bob: 4 },
    { texture: 'lantern', x: 2160, y: 2180, scale: 0.5, sorted: true, bob: 5 },
    { texture: 'props', frame: '24', x: 1830, y: 2330, scale: 0.4, sorted: true },
    // Grove
    { texture: 'tree-twist', x: 900, y: 1745, scale: 0.62, sorted: true, id: 'grove-tree' },
    { texture: 'props', frame: '25', x: 1270, y: 2090, scale: 0.42, sorted: true },
    { texture: 'props', frame: '21', x: 1150, y: 1860, scale: 0.34, sorted: true, id: 'spring-gi0' },
    { texture: 'props', frame: '21', x: 1115, y: 1690, scale: 0.34, sorted: true, id: 'spring-gi1' },
    { texture: 'props', frame: '21', x: 1068, y: 1520, scale: 0.34, sorted: true, id: 'spring-gi2' },
    { texture: 'lantern', x: 760, y: 1480, scale: 0.45, sorted: true, bob: 4 },
    // Crystal Works
    { texture: 'crystal-generator', x: 1180, y: 790, scale: 0.55, sorted: true, id: 'crystal-gen' },
    { texture: 'crystal-generator', x: 1480, y: 700, scale: 0.34, sorted: true },
    // Terrace
    { texture: 'windmill', x: 2575, y: 660, scale: 0.52, sorted: true },
    { texture: 'workshop', x: 2745, y: 690, scale: 0.46, sorted: true },
    { texture: 'props', frame: '15', x: 2880, y: 760, scale: 0.46, sorted: true, id: 'cannon' },
    { texture: 'bunting', x: 3110, y: 610, scale: 0.6, sorted: false, depth: -15 },
    { texture: 'props', frame: '18', x: 3250, y: 640, scale: 0.36, sorted: true, anim: 'barrier-spin' },
    // Windy Ledge
    { texture: 'props', frame: '26', x: 3500, y: 1010, scale: 0.4, sorted: true },
    { texture: 'props', frame: '33', x: 3290, y: 1420, scale: 0.4, sorted: true, anim: 'mace-swing' },
    // Docks
    { texture: 'stall', x: 3200, y: 1880, scale: 0.46, sorted: true },
    { texture: 'lantern', x: 2920, y: 1960, scale: 0.5, sorted: true, bob: 5 },
    { texture: 'lantern', x: 2560, y: 2060, scale: 0.5, sorted: true, bob: 4 },
    { texture: 'props', frame: '30', x: 2420, y: 2090, scale: 0.4, sorted: true, id: 'log' },
    { texture: 'props', frame: '6', x: 2720, y: 2020, scale: 0.36, sorted: true },
    // Observatory
    { texture: 'observatory', x: 2260, y: 1720, scale: 0.72, sorted: true, id: 'observatory' },
    { texture: 'props', frame: '12', x: 2080, y: 1540, scale: 0.34, sorted: true },
  ],
  // Ora hosts from the festival stage beside the start space.
  hostSpot: { x: 2252, y: 2080 },
};

/** Every board: Suncoil Sanctuary, then the guests' world boards (src/game/worlds/<id>/board.ts). */
/** The boards on offer: the characters' worlds. (SUNCOIL, the original board, is retired and kept as a test fixture.) */
export const BOARDS: BoardDef[] = [...WORLD_BOARDS];

export function findBoard(id: string): BoardDef | undefined {
  return BOARDS.find((b) => b.id === id);
}
