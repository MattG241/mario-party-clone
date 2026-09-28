// Showtime Strip: a neon entertainment boulevard at night, laid out as a figure of eight around
// Fountain Circle. The west loop (counter-clockwise) passes the pastel Pop Café and its concert
// stage, the drive-in and the 1950s rock'n'roll diner with its own stage; the east loop (clockwise)
// passes the grand marquee theatre, the pink honky-tonk rodeo saloon, the comedy club beside the
// ice rink and the prize wheel promenade. Every lap crosses Fountain Circle twice, and each time
// the traveller picks a loop. A Prism Key opens the VIP Walk through the middle of the east loop.
import type { BoardDef, BoardNodeDef, NodeMeta, SpaceType } from '../../board/types';
import { RINK_INFO } from '../rink/info';
import { SHOWTIME_INFO } from './info';

function n(id: string, x: number, y: number, type: SpaceType, next: string[], extra: { eventId?: string; meta?: NodeMeta } = {}): BoardNodeDef {
  return { id, x, y, type, next, eventId: extra.eventId, metadata: extra.meta };
}

/** Regions whose spaces are stages (the Spotlight Solo pays whoever stands on one). */
export const SHOWTIME_STAGES = ['Diner Stage', 'Pop Stage', 'Marquee Stage'];

const CIRCLE = { region: 'Fountain Circle' };
const TERRACE = { region: 'Café Terrace' };
const CAFE = { region: 'Pop Café' };
const POP = { region: 'Pop Stage' };
const DRIVEIN = { region: 'Drive-In' };
const DINERROW = { region: 'Diner Row' };
const DINER = { region: 'Diner Stage' };
const JUKEBOX = { region: 'Jukebox Walk' };
const MARQUEE = { region: 'Marquee Stage' };
const MARQUEEROW = { region: 'Marquee Row' };
const SALOON = { region: 'Rhinestone Saloon' };
const COMEDY = { region: 'Comedy Corner' };
const RINK = { region: 'Ice Rink' };
const ALLEY = { region: 'Comedy Alley' };
const WHEELS = { region: 'Prize Wheel Promenade' };
const WALK = { region: 'Fountain Walk' };
const VIP = { region: 'VIP Walk' };

const nodes: BoardNodeDef[] = [
  // Fountain Circle (start): the crossing of the eight. Pick a loop every time you pass.
  n('sf0', 1800, 1480, 'start', ['sl1', 'sr1'], { meta: { ...CIRCLE, signs: { sl1: 'Pop Café', sr1: 'Marquee Stage' } } }),
  // West loop (counter-clockwise): Café Terrace → Pop Café and stage → Drive-In → Diner → Jukebox Walk.
  n('sl1', 1673, 1353, 'gleam', ['sl2'], { meta: CIRCLE }),
  n('sl2', 1546, 1226, 'festival', ['sl3'], { meta: TERRACE }),
  n('sl3', 1400, 1110, 'portal', ['sl4'], { meta: TERRACE }),
  n('sl4', 1240, 1020, 'market', ['sl5'], { meta: { ...CAFE, shop: 'wrench' } }),
  n('sl5', 1065, 965, 'event', ['sl6'], { eventId: 'showtime_encore', meta: POP }),
  n('sl6', 885, 950, 'relic', ['sl7'], { meta: POP }),
  n('sl7', 715, 985, 'gleam', ['sl8'], { meta: CAFE }),
  n('sl8', 565, 1070, 'mischief', ['sl9'], { meta: DRIVEIN }),
  n('sl9', 455, 1210, 'portal', ['sl10'], { meta: DRIVEIN }),
  n('sl10', 420, 1380, 'festival', ['sl11'], { meta: DRIVEIN }),
  n('sl11', 450, 1550, 'gleam', ['sl12'], { meta: DRIVEIN }),
  n('sl12', 540, 1700, 'relic', ['sl13'], { meta: DRIVEIN }),
  n('sl13', 680, 1810, 'gleam', ['sl14'], { meta: DINERROW }),
  n('sl14', 850, 1880, 'event', ['sl15'], { eventId: 'showtime_encore', meta: DINER }),
  n('sl15', 1030, 1915, 'gleam', ['sl16'], { meta: DINER }),
  n('sl16', 1210, 1910, 'mischief', ['sl17'], { meta: DINERROW }),
  n('sl17', 1385, 1870, 'festival', ['sl18'], { meta: JUKEBOX }),
  n('sl18', 1545, 1760, 'gleam', ['sl19'], { meta: JUKEBOX }),
  n('sl19', 1673, 1607, 'mischief', ['sf0'], { meta: CIRCLE }),
  // East loop (clockwise): Marquee Stage → Rhinestone Saloon → Comedy Corner → Prize Wheels → Fountain Walk.
  n('sr1', 1927, 1353, 'gleam', ['sr2'], { meta: MARQUEE }),
  n('sr2', 2054, 1226, 'event', ['sr3'], { eventId: 'showtime_spotlight', meta: MARQUEE }),
  n('sr3', 2200, 1110, 'gleam', ['sr4'], { meta: MARQUEEROW }),
  n('sr4', 2360, 1020, 'festival', ['sr5', 'sv0'], { meta: { ...SALOON, signs: { sr5: 'Rhinestone Saloon', sv0: 'VIP Walk (Prism Key)' } } }),
  n('sr5', 2535, 965, 'relic', ['sr6'], { meta: SALOON }),
  n('sr6', 2715, 950, 'event', ['sr7'], { eventId: 'showtime_stampede', meta: SALOON }),
  n('sr7', 2885, 985, 'mischief', ['sr8'], { meta: SALOON }),
  // Comedy Corner: glide across the Ice Rink (short) or stroll Comedy Alley past the club (longer,
  // the merch cart, a portal and a gate).
  n('sr8', 3035, 1070, 'gleam', ['si1', 'sa1'], { meta: { ...COMEDY, signs: { si1: 'Ice Rink', sa1: 'Comedy Alley' } } }),
  n('si1', 3010, 1245, 'gleam', ['si2'], { meta: RINK }),
  n('si2', 2990, 1420, 'mischief', ['si3'], { meta: RINK }),
  n('si3', 3030, 1595, 'gleam', ['sr9'], { meta: RINK }),
  n('sa1', 3200, 1150, 'gleam', ['sa2'], { meta: ALLEY }),
  n('sa2', 3320, 1290, 'market', ['sa3'], { meta: { ...ALLEY, shop: 'pipper' } }),
  n('sa3', 3370, 1460, 'portal', ['sa4'], { meta: ALLEY }),
  n('sa4', 3330, 1630, 'relic', ['sa5'], { meta: ALLEY }),
  n('sa5', 3210, 1760, 'festival', ['sr9'], { meta: ALLEY }),
  n('sr9', 3045, 1780, 'gleam', ['sr10'], { meta: COMEDY }),
  n('sr10', 2880, 1870, 'mischief', ['sr11'], { meta: WHEELS }),
  n('sr11', 2700, 1910, 'festival', ['sr12'], { meta: WHEELS }),
  n('sr12', 2520, 1915, 'portal', ['sr13'], { meta: WHEELS }),
  n('sr13', 2345, 1875, 'gleam', ['sr14'], { meta: WHEELS }),
  n('sr14', 2200, 1800, 'festival', ['sr15'], { meta: WALK }),
  n('sr15', 2055, 1720, 'gleam', ['sr16'], { meta: WALK }),
  n('sr16', 1927, 1607, 'mischief', ['sf0'], { meta: CIRCLE }),
  // VIP Walk (behind the velvet rope between sr4 and sv0): straight down the middle to the prize wheels.
  n('sv0', 2395, 1190, 'gleam', ['sv1'], { meta: { ...VIP, gate: 'viprope' } }),
  n('sv1', 2430, 1360, 'festival', ['sv2'], { meta: VIP }),
  n('sv2', 2460, 1530, 'relic', ['sv3'], { meta: VIP }),
  n('sv3', 2490, 1740, 'gleam', ['sr12'], { meta: VIP }),
];

const steps = (...pairs: string[]): Record<string, 'steps'> => Object.fromEntries(pairs.map((p) => [p, 'steps' as const]));

export const SHOWTIME_BOARD: BoardDef = {
  id: 'showtime',
  name: 'Showtime Strip',
  subtitle: 'Neon boulevard where every block is a stage',
  description:
    "A rock'n'roll diner, a pastel café concert, a pink rodeo saloon, a comedy club by the ice rink and the grand marquee theatre glitter around Fountain Circle. Pick a loop, take an encore and chase the Star Coin down the strip.",
  width: 3600,
  height: 2400,
  nodes,
  startNode: 'sf0',
  relicGates: ['sl6', 'sl12', 'sr5', 'sa4', 'sv2'],
  portals: [
    ['sl9', 'sa3'],
    ['sl3', 'sr12'],
  ],
  bridges: [],
  gates: [{ id: 'viprope', from: 'sr4', to: 'sv0', prop: { x: 2378, y: 1095, scale: 0.55 } }],
  // Walkways between the venue blocks: neon footbridges, the rink's boards and the VIP catwalk.
  edgeStyles: steps(
    'sl1>sl2',
    'sr1>sr2',
    'sl3>sl4',
    'sl7>sl8',
    'sl12>sl13',
    'sl17>sl18',
    'sr3>sr4',
    'sr7>sr8',
    'sr8>si1',
    'si3>sr9',
    'sr9>sr10',
    'sr13>sr14',
    'sr15>sr16',
    'sr4>sv0',
    'sv0>sv1',
    'sv1>sv2',
    'sv2>sv3',
    'sv3>sr12',
  ),
  // Vector placeholders (drawn until the rendered boulevard is installed).
  islands: [
    { texture: 'island-wide', x: 2600, y: 760, scale: 0.72 },
    { texture: 'island-wide', x: 890, y: 790, scale: 0.72 },
    { texture: 'island-medium', x: 1800, y: 820, scale: 0.9 },
    { texture: 'island-small', x: 2885, y: 950, scale: 0.6 },
    { texture: 'island-small', x: 1240, y: 975, scale: 0.6 },
    { texture: 'island-small', x: 565, y: 1030, scale: 0.6 },
    { texture: 'island-medium', x: 3100, y: 1030, scale: 0.6 },
    { texture: 'island-medium', x: 1470, y: 1040, scale: 0.8 },
    { texture: 'island-medium', x: 2130, y: 1040, scale: 0.8 },
    { texture: 'island-small', x: 2395, y: 1145, scale: 0.55 },
    { texture: 'island-medium', x: 3000, y: 1190, scale: 0.75 },
    { texture: 'island-medium', x: 3300, y: 1180, scale: 0.75 },
    { texture: 'island-medium', x: 440, y: 1170, scale: 0.8 },
    { texture: 'island-large', x: 1800, y: 1260, scale: 0.72 },
    { texture: 'island-small', x: 2430, y: 1315, scale: 0.55 },
    { texture: 'island-medium', x: 3350, y: 1430, scale: 0.75 },
    { texture: 'island-medium', x: 3000, y: 1450, scale: 0.75 },
    { texture: 'island-medium', x: 450, y: 1480, scale: 0.8 },
    { texture: 'island-small', x: 2460, y: 1485, scale: 0.55 },
    { texture: 'island-large', x: 1000, y: 1560, scale: 0.7 },
    { texture: 'island-small', x: 2490, y: 1695, scale: 0.55 },
    { texture: 'island-medium', x: 3150, y: 1670, scale: 0.7 },
    { texture: 'island-medium', x: 1610, y: 1640, scale: 0.7 },
    { texture: 'island-medium', x: 2130, y: 1630, scale: 0.75 },
    { texture: 'island-wide', x: 770, y: 1690, scale: 0.72 },
    { texture: 'island-wide', x: 1250, y: 1740, scale: 0.72 },
    { texture: 'island-wide', x: 2610, y: 1745, scale: 0.8 },
  ],
  decorations: [
    // The venues' stand-ins: the marquee theatre, the saloon, the diner, the café and pop stage,
    // the prize wheels and the fountain.
    { texture: 'observatory', x: 1800, y: 1080, scale: 0.78, sorted: true, id: 'theatre' },
    { texture: 'workshop', x: 2700, y: 870, scale: 0.6, sorted: true, id: 'saloon' },
    { texture: 'workshop', x: 1000, y: 1760, scale: 0.6, sorted: true, id: 'diner', flipX: true },
    { texture: 'stall', x: 1150, y: 900, scale: 0.5, sorted: true, id: 'cafe' },
    { texture: 'bunting', x: 830, y: 880, scale: 0.55, sorted: false, depth: -15 },
    { texture: 'windmill', x: 2700, y: 1790, scale: 0.45, sorted: true, id: 'prize-wheel' },
    { texture: 'windmill', x: 2890, y: 1745, scale: 0.36, sorted: true },
    { texture: 'crystal-generator', x: 1800, y: 1770, scale: 0.5, sorted: true, id: 'fountain' },
    { texture: 'stall', x: 3385, y: 1245, scale: 0.4, sorted: true },
    { texture: 'lantern', x: 1690, y: 1470, scale: 0.5, sorted: true },
    { texture: 'lantern', x: 1905, y: 1470, scale: 0.5, sorted: true },
    { texture: 'lantern', x: 1110, y: 1840, scale: 0.5, sorted: true },
    { texture: 'lantern', x: 480, y: 1300, scale: 0.5, sorted: true },
    { texture: 'lantern', x: 2620, y: 900, scale: 0.5, sorted: true },
    { texture: 'lantern', x: 3120, y: 1700, scale: 0.5, sorted: true },
    { texture: 'lantern', x: 2270, y: 1790, scale: 0.5, sorted: true },
  ],
  // Ora hosts beside the crossing, facing Mimi across Fountain Circle.
  hostSpot: { x: 1575, y: 1500 },
  theme: {
    world: 'showtime',
    time: 'night',
    // The world's own games (only those that are built, so the board never favours a missing one).
    minigames: ['hip-shake', 'coffee-rush', 'rhinestone-rodeo', 'slapshot'].filter((id) => [...SHOWTIME_INFO.infos, ...RINK_INFO.infos].some((m) => m.id === id)),
    // Crystal Surge and Portal Storm frame Suncoil's landmarks; the strip's Neon Surge stands in.
    skipEvents: ['crystal_surge', 'portal_storm'],
  },
};
