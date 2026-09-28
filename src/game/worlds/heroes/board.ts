// Hero Heights: a floating skyline district at night. Rooftops, skybridges, fire escapes and web
// lines link three heroes' landmarks: the gothic clock tower with its gargoyles (west), the gleaming
// tech spire with its glowing core (north-east) and the friendly neighbourhood block with its
// web-strung water tower (east). Movement runs clockwise from Midtown Plaza: Gothic Quarter →
// Rooftop Gardens → Steel Skybridge → Tech Spire → Friendly Block → Neon Row → Plaza, with a
// Prism Key shortcut up the Sky Rail through the middle.
import type { BoardDef, BoardNodeDef, NodeMeta, SpaceType } from '../../board/types';
import { HEROES_INFO } from './info';

function n(id: string, x: number, y: number, type: SpaceType, next: string[], extra: { eventId?: string; meta?: NodeMeta } = {}): BoardNodeDef {
  return { id, x, y, type, next, eventId: extra.eventId, metadata: extra.meta };
}

const PLAZA = { region: 'Midtown Plaza' };
const GOTHIC = { region: 'Gothic Quarter' };
const BELFRY = { region: 'Belfry Stairs', exposed: true };
const LEDGES = { region: 'Gargoyle Ledges' };
const GARDENS = { region: 'Rooftop Gardens' };
const SKY = { region: 'Steel Skybridge', exposed: true };
const TECH = { region: 'Tech Spire' };
const BLOCK = { region: 'Friendly Block' };
const WEB = { region: 'Web Line', exposed: true };
const ESCAPES = { region: 'Fire Escapes' };
const NEON = { region: 'Neon Row' };
const RAIL = { region: 'Sky Rail' };

const nodes: BoardNodeDef[] = [
  // Midtown Plaza (start). hp1 forks onto the Sky Rail behind the turnstile (Prism Key).
  n('hp0', 1990, 2070, 'start', ['hp1'], { meta: PLAZA }),
  n('hp1', 1810, 2100, 'gleam', ['hp2', 'hx0'], { meta: { ...PLAZA, signs: { hp2: 'Gothic Quarter', hx0: 'Sky Rail (Prism Key)' } } }),
  n('hp2', 1630, 2090, 'festival', ['hp3'], { meta: PLAZA }),
  n('hp3', 1455, 2040, 'gleam', ['hg0'], { meta: PLAZA }),
  // Gothic Quarter: the Belfry Stairs climb straight past the clock tower (short, but the
  // searchlight sweeps them) or the Gargoyle Ledges wind round its foot (longer, a portal and a gate).
  n('hg0', 1285, 1975, 'mischief', ['hg1'], { meta: GOTHIC }),
  n('hg1', 1120, 1895, 'gleam', ['hb0', 'hl0'], { meta: { ...GOTHIC, signs: { hb0: 'Belfry Stairs', hl0: 'Gargoyle Ledges' } } }),
  n('hb0', 1075, 1725, 'gleam', ['hb1'], { meta: BELFRY }),
  n('hb1', 1030, 1555, 'event', ['hb2'], { eventId: 'heroes_searchlight', meta: BELFRY }),
  n('hb2', 950, 1395, 'mischief', ['hg2'], { meta: BELFRY }),
  n('hl0', 950, 1880, 'gleam', ['hl1'], { meta: GOTHIC }),
  n('hl1', 780, 1810, 'festival', ['hl2'], { meta: LEDGES }),
  n('hl2', 640, 1690, 'portal', ['hl3'], { meta: LEDGES }),
  n('hl3', 575, 1525, 'relic', ['hl4'], { meta: LEDGES }),
  n('hl4', 610, 1355, 'gleam', ['hg2'], { meta: LEDGES }),
  n('hg2', 770, 1260, 'gleam', ['hg3'], { meta: GOTHIC }),
  n('hg3', 850, 1100, 'festival', ['hr0'], { meta: GOTHIC }),
  // Rooftop Gardens
  n('hr0', 960, 950, 'gleam', ['hr1'], { meta: GARDENS }),
  n('hr1', 1110, 860, 'mischief', ['hr2'], { meta: GARDENS }),
  n('hr2', 1280, 815, 'relic', ['hr3'], { meta: GARDENS }),
  n('hr3', 1455, 800, 'portal', ['hr4'], { meta: GARDENS }),
  n('hr4', 1625, 780, 'gleam', ['hs0'], { meta: GARDENS }),
  // Steel Skybridge (open girders: the searchlight reaches them)
  n('hs0', 1800, 760, 'festival', ['hs1'], { meta: SKY }),
  n('hs1', 1975, 750, 'gleam', ['hs2'], { meta: SKY }),
  n('hs2', 2150, 765, 'mischief', ['ht0'], { meta: SKY }),
  // Tech Spire (the gadget lab is Wrench's)
  n('ht0', 2320, 790, 'gleam', ['ht1'], { meta: TECH }),
  n('ht1', 2490, 820, 'market', ['ht2'], { meta: { ...TECH, shop: 'wrench' } }),
  n('ht2', 2660, 845, 'event', ['ht3'], { eventId: 'heroes_blackout', meta: TECH }),
  n('ht3', 2830, 880, 'relic', ['ht4'], { meta: TECH }),
  n('ht4', 2990, 950, 'gleam', ['hk0'], { meta: TECH }),
  // Friendly Block: swing along the Web Line (short and exposed) or climb the Fire Escapes round
  // the water tower (longer, a portal and a gate).
  n('hk0', 3100, 1080, 'festival', ['hw0', 'hf0'], { meta: { ...BLOCK, signs: { hw0: 'Web Line', hf0: 'Fire Escapes' } } }),
  n('hw0', 2980, 1235, 'gleam', ['hw1'], { meta: WEB }),
  n('hw1', 2930, 1405, 'event', ['hw2'], { eventId: 'heroes_chase', meta: WEB }),
  n('hw2', 2960, 1575, 'gleam', ['hk1'], { meta: WEB }),
  n('hf0', 3260, 1170, 'gleam', ['hf1'], { meta: ESCAPES }),
  n('hf1', 3360, 1320, 'mischief', ['hf2'], { meta: ESCAPES }),
  n('hf2', 3385, 1495, 'relic', ['hf3'], { meta: ESCAPES }),
  n('hf3', 3320, 1660, 'portal', ['hf4'], { meta: ESCAPES }),
  n('hf4', 3175, 1770, 'festival', ['hk1'], { meta: ESCAPES }),
  n('hk1', 3000, 1765, 'gleam', ['hn0'], { meta: BLOCK }),
  // Neon Row (Pipper's cart)
  n('hn0', 2840, 1880, 'mischief', ['hn1'], { meta: NEON }),
  n('hn1', 2670, 1950, 'market', ['hn2'], { meta: { ...NEON, shop: 'pipper' } }),
  n('hn2', 2500, 2000, 'portal', ['hn3'], { meta: NEON }),
  n('hn3', 2330, 2040, 'festival', ['hn4'], { meta: NEON }),
  n('hn4', 2160, 2070, 'gleam', ['hp0'], { meta: NEON }),
  // Sky Rail shortcut (behind the turnstile between hp1 and hx0), up the middle to the Tech Spire.
  n('hx0', 1860, 1925, 'gleam', ['hx1'], { meta: { ...RAIL, gate: 'skyrail' } }),
  n('hx1', 1960, 1770, 'festival', ['hx2'], { meta: RAIL }),
  n('hx2', 2090, 1640, 'relic', ['hx3'], { meta: RAIL }),
  n('hx3', 2190, 1490, 'event', ['hx4'], { eventId: 'heroes_searchlight', meta: RAIL }),
  n('hx4', 2240, 1320, 'gleam', ['hx5'], { meta: RAIL }),
  n('hx5', 2260, 1150, 'mischief', ['hx6'], { meta: RAIL }),
  n('hx6', 2280, 975, 'festival', ['ht0'], { meta: RAIL }),
];

const steps = (...pairs: string[]): Record<string, 'steps'> => Object.fromEntries(pairs.map((p) => [p, 'steps' as const]));

export const HEROES_BOARD: BoardDef = {
  id: 'heroes',
  name: 'Hero Heights',
  subtitle: 'Rooftop skyline of the night heroes',
  description:
    'Skybridges, fire escapes and web lines link a gothic clock tower, a gleaming tech spire and a friendly water tower high over the night city. Ride the subway portals and chase the Star Coin from roof to roof.',
  width: 3600,
  height: 2400,
  nodes,
  startNode: 'hp0',
  relicGates: ['hl3', 'hr2', 'ht3', 'hf2', 'hx2'],
  portals: [
    ['hl2', 'hf3'],
    ['hr3', 'hn2'],
  ],
  bridges: [],
  gates: [{ id: 'skyrail', from: 'hp1', to: 'hx0', prop: { x: 1835, y: 1995, scale: 0.55 } }],
  // Crossings between rooftops (stairs, girders, cables, the rail) — everything else is roof.
  edgeStyles: steps(
    'hp3>hg0',
    'hg1>hb0',
    'hb0>hb1',
    'hb1>hb2',
    'hb2>hg2',
    'hl0>hl1',
    'hg3>hr0',
    'hr4>hs0',
    'hs0>hs1',
    'hs1>hs2',
    'hs2>ht0',
    'ht4>hk0',
    'hk0>hw0',
    'hw0>hw1',
    'hw1>hw2',
    'hw2>hk1',
    'hk1>hn0',
    'hn3>hn4',
    'hp1>hx0',
    'hx0>hx1',
    'hx1>hx2',
    'hx2>hx3',
    'hx3>hx4',
    'hx4>hx5',
    'hx5>hx6',
    'hx6>ht0',
  ),
  islands: [],
  decorations: [],
  // Ora hosts from the bandstand at the east end of Midtown Plaza.
  hostSpot: { x: 2200, y: 1930 },
  theme: {
    world: 'heroes',
    time: 'night',
    // The world's own games (only those that are built, so the board never favours a missing one).
    minigames: ['rooftop-glide', 'web-swing', 'repulsor-range'].filter((id) => HEROES_INFO.infos.some((m) => m.id === id)),
    // Crystal Surge and Portal Storm frame Suncoil's landmarks; the Sky Rail's own events stand in.
    skipEvents: ['crystal_surge', 'portal_storm'],
  },
};
