import { ITEMS } from '../data/items';
import { ItemManager } from '../items/ItemManager';
import { isFinalRound, logMatch, type PlayerState } from '../state/MatchState';
import { checkpoint, type DialogLineSpec, type EventPresentation, type FlowContext } from './flowTypes';
import { gainChips, giveItem, loseChips, pushBackward, pushForward, relocateRelic, shieldBlocks, teleport, visitShop } from './TurnFlow';
import { WORLD_EVENTS } from '../worlds/events';

export type EventKind = 'festival' | 'mischief' | 'board' | 'global';

export interface BoardEventDef {
  id: string;
  title: string;
  kind: EventKind;
  /** One-line summary (How to Play / debug). */
  summary: string;
  weight?: number;
  /** Boards it can happen on (default: any). World boards' own events name theirs. */
  boards?: string[];
  available?: (ctx: FlowContext, p: PlayerState | null) => boolean;
  run: (ctx: FlowContext, p: PlayerState | null) => Promise<void>;
}

function present(ctx: FlowContext, def: BoardEventDef, lines: DialogLineSpec[], extra: Partial<EventPresentation> = {}): Promise<void> {
  return ctx.io.event({ id: def.id, title: def.title, kind: def.kind === 'global' ? 'global' : def.kind, lines, ...extra }).then(() => checkpoint(ctx));
}

const chaotic = (ctx: FlowContext) => ctx.state.config.events === 'chaotic';
const scale = (ctx: FlowContext, n: number) => Math.round(n * (chaotic(ctx) ? 1.5 : 1));

// ------------------------------------------------------------------------------------------
// Board-specific events (EVENT spaces)

const bridgeBreak: BoardEventDef = {
  id: 'bridge_break',
  title: 'BRIDGE BREAK',
  kind: 'board',
  summary: 'The Sky Bridge snaps! The Cloud Steps detour opens until Wrench repairs it.',
  async run(ctx, p) {
    const bridge = ctx.graph.def.bridges[0];
    if (!bridge) return;
    if (ctx.board.bridgeBroken) {
      await present(ctx, this, [{ npc: 'wrench', pose: 'tool', text: "The bridge is already in pieces — I'm on it! Here, a few coins for your patience." }]);
      if (p) await gainChips(ctx, p, 3, 'event');
      return;
    }
    ctx.board.bridgeBroken = { untilRound: ctx.state.round + bridge.repairRounds };
    await present(ctx, this, [
      { npc: 'wrench', pose: 'surprised', text: 'Oh no, the rope bridge is going… going… GONE!' },
      { npc: 'wrench', pose: 'idea', text: 'Take the Cloud Steps below until I patch it up.' },
    ], { fx: 'bridge-break', focus: bridge.nodes[1] });
    ctx.io.boardChanged();
    // Anyone on the bridge tumbles down to the matching cloud step.
    for (const pl of ctx.state.players) {
      const i = bridge.nodes.indexOf(pl.nodeId);
      if (i >= 0) await teleport(ctx, pl, bridge.detour[Math.min(i, bridge.detour.length - 1)], 'fall');
    }
    logMatch(ctx.state, 'Sky Bridge broke');
  },
};

const crystalSurge: BoardEventDef = {
  id: 'crystal_surge',
  title: 'CRYSTAL SURGE',
  kind: 'board',
  summary: 'Crystal generators overcharge: several Gleam Spaces pay double for a round.',
  async run(ctx) {
    const gleams = ctx.graph.nodesOfType('gleam').map((n) => n.id);
    const nodes = ctx.rng.shuffle([...gleams]).slice(0, 8);
    ctx.board.surge = { nodes, untilRound: ctx.state.round + 1 };
    await present(ctx, this, [
      { npc: 'wrench', pose: 'gadget', text: 'The crystal generators are overcharging!' },
      { npc: 'wrench', pose: 'laugh', text: 'Glowing Gleam Spaces pay DOUBLE until the end of next round!' },
    ], { fx: 'surge', focus: 'c1' });
    ctx.io.boardChanged();
  },
};

const windGust: BoardEventDef = {
  id: 'wind_gust',
  title: 'WIND GUST',
  kind: 'board',
  summary: 'A gale sweeps the exposed platforms: everyone standing on one is blown back 2 spaces.',
  async run(ctx, p) {
    await present(ctx, this, [{ npc: 'ora', pose: 'point', text: 'Hold onto your hats! A big gust is sweeping the open ledges!' }], { fx: 'wind' });
    const exposed = ctx.state.players.filter((pl) => ctx.graph.node(pl.nodeId).metadata?.exposed || pl === p);
    for (const pl of exposed) {
      if (await shieldBlocks(ctx, pl)) continue;
      await pushBackward(ctx, pl, 2, 'wind');
    }
  },
};

const portalStorm: BoardEventDef = {
  id: 'portal_storm',
  title: 'PORTAL STORM',
  kind: 'board',
  summary: 'The observatory sparks and every portal reshuffles where it leads.',
  async run(ctx) {
    const ids = Object.keys(ctx.board.portalLinks).sort();
    if (ids.length < 4) return;
    const old = { ...ctx.board.portalLinks };
    for (let tries = 0; tries < 12; tries++) {
      const shuffled = ctx.rng.shuffle([...ids]);
      const links: Record<string, string> = {};
      for (let i = 0; i < shuffled.length; i += 2) {
        links[shuffled[i]] = shuffled[i + 1];
        links[shuffled[i + 1]] = shuffled[i];
      }
      const changed = ids.some((id) => links[id] !== old[id]);
      ctx.board.portalLinks = links;
      if (changed) break;
    }
    await present(ctx, this, [
      { npc: 'mimi', pose: 'alert', text: 'Eep! The observatory is crackling with spiral energy!' },
      { npc: 'mimi', pose: 'surprised', text: 'Every portal just changed where it leads!' },
    ], { fx: 'portal-storm', focus: 'o3' });
    ctx.io.boardChanged();
  },
};

const cannonBlast: BoardEventDef = {
  id: 'cannon_blast',
  title: 'CANNON BLAST',
  kind: 'board',
  summary: "Wrench's festival cannon launches you far ahead along the trail.",
  async run(ctx, p) {
    if (!p) return;
    await present(ctx, this, [{ npc: 'wrench', pose: 'laugh', text: 'Climb in! My festival cannon is perfectly safe. Mostly!' }], { fx: 'cannon', focus: p.nodeId });
    const steps = ctx.rng.int(6, 11);
    const dest = ctx.graph.aheadOf(p.nodeId, steps, ctx.board);
    await teleport(ctx, p, dest, 'cannon');
  },
};

const bouncyTrail: BoardEventDef = {
  id: 'bouncy_trail',
  title: 'BOUNCY TRAIL',
  kind: 'board',
  summary: 'Spring pads wake up and launch travellers several spaces forward.',
  async run(ctx, p) {
    const pads = ctx.graph.def.nodes.filter((n) => n.metadata?.spring).map((n) => n.id);
    ctx.board.bouncy = { nodes: pads, untilRound: ctx.state.round + 1 };
    await present(ctx, this, [
      { npc: 'mimi', pose: 'laugh', text: 'Boing! The spring pads in the grove woke up!' },
      { npc: 'mimi', pose: 'happy', text: 'Land on one to get launched ahead — here you go!' },
    ], { fx: 'bouncy', focus: p?.nodeId });
    ctx.io.boardChanged();
    if (p) {
      ctx.turn.bounced = true;
      await pushForward(ctx, p, 3);
    }
  },
};

const springLaunch: BoardEventDef = {
  id: 'spring_launch',
  title: 'BOING!',
  kind: 'board',
  summary: 'An awakened spring pad launches you 3 spaces forward.',
  async run(ctx, p) {
    if (!p) return;
    await present(ctx, this, [], { fx: 'bouncy', focus: p.nodeId });
    await pushForward(ctx, p, 3);
  },
};

const rollingLog: BoardEventDef = {
  id: 'rolling_log',
  title: 'ROLLING LOG',
  kind: 'board',
  summary: 'A spiked festival log tumbles down the docks, bonking everyone on them.',
  async run(ctx, p) {
    await present(ctx, this, [{ npc: 'packsprout', pose: 'surprised', text: 'Look out! The spiky parade log came loose!' }], { fx: 'log', focus: 'd4' });
    const victims = ctx.state.players.filter((pl) => ctx.graph.node(pl.nodeId).metadata?.region === 'Lantern Docks' || pl === p);
    for (const v of victims) {
      if (await shieldBlocks(ctx, v)) continue;
      await loseChips(ctx, v, scale(ctx, 3), 'bonk');
    }
  },
};

// ------------------------------------------------------------------------------------------
// Festival (positive) events

const parade: BoardEventDef = {
  id: 'festival_parade',
  title: 'FESTIVAL PARADE',
  kind: 'festival',
  summary: 'A parade marches past and everyone receives 5 coins.',
  async run(ctx) {
    await present(ctx, this, [
      { npc: 'mimi', pose: 'laugh', text: 'Parade time! Drums, banners and coins for EVERYONE!' },
    ], { fx: 'parade' });
    for (const pl of ctx.state.players) await gainChips(ctx, pl, 5, 'parade');
  },
};

const relicRush: BoardEventDef = {
  id: 'relic_rush',
  title: 'STAR COIN SALE',
  kind: 'festival',
  weight: 0.8,
  summary: 'Festival discount! Star Coins cost 15 coins until the end of next round.',
  available: (ctx) => !ctx.board.relicPrice,
  async run(ctx) {
    ctx.board.relicPrice = { price: 15, untilRound: ctx.state.round + 1 };
    await present(ctx, this, [
      { npc: 'packsprout', pose: 'cheer', text: 'Festival special! Star Coins cost just 15 coins until the end of next round!' },
    ], { fx: 'relic-rush', focus: ctx.board.relicGate });
    ctx.io.boardChanged();
  },
};

const lanternShower: BoardEventDef = {
  id: 'lantern_shower',
  title: 'LANTERN SHOWER',
  kind: 'festival',
  weight: 1.4,
  summary: 'Floating lanterns burst open and shower you with coins.',
  async run(ctx, p) {
    if (!p) return;
    const n = scale(ctx, ctx.rng.int(4, 8));
    await present(ctx, this, [{ npc: 'ora', pose: 'cheer', text: `The festival lanterns are raining coins on you!` }], { fx: 'lanterns', player: p });
    await gainChips(ctx, p, n, 'festival');
  },
};

const delivery: BoardEventDef = {
  id: 'packsprout_delivery',
  title: 'SPECIAL DELIVERY',
  kind: 'festival',
  weight: 1.2,
  summary: 'Packsprout arrives with a parcel containing a random item.',
  async run(ctx, p) {
    if (!p) return;
    const item = ItemManager.randomItem(ctx.rng);
    await present(ctx, this, [{ npc: 'packsprout', pose: 'gift', text: `Special delivery! One ${ITEMS[item].name}, signed, sealed and sprouted!` }], { fx: 'delivery', player: p });
    await giveItem(ctx, p, item);
  },
};

const tailwind: BoardEventDef = {
  id: 'mimi_tailwind',
  title: "MIMI'S TAILWIND",
  kind: 'festival',
  summary: 'Mimi flaps her giant ears and pushes you 3 spaces forward.',
  async run(ctx, p) {
    if (!p) return;
    await present(ctx, this, [{ npc: 'mimi', pose: 'happy', text: 'Hold still… FLAP FLAP! Off you go!' }], { fx: 'tailwind', player: p });
    await pushForward(ctx, p, 3);
  },
};

const oraGuide: BoardEventDef = {
  id: 'ora_guide',
  title: "ORA'S SHORTCUT",
  kind: 'festival',
  weight: 0.7,
  summary: 'Ora whisks you to a spot a few steps before the Star Keeper.',
  available: (ctx, p) => !!p && ctx.graph.distance(p.nodeId, ctx.board.relicGate, ctx.board) > 6,
  async run(ctx, p) {
    if (!p) return;
    // Find a node 2–4 steps before the relic gate.
    const target = ctx.board.relicGate;
    const candidates = ctx.graph.def.nodes
      .map((n) => n.id)
      .filter((id) => id !== target && !ctx.graph.node(id).metadata?.gate && ctx.graph.isOpen(id, ctx.board))
      .filter((id) => {
        const d = ctx.graph.distance(id, target, ctx.board);
        return d >= 2 && d <= 4;
      });
    await present(ctx, this, [{ npc: 'ora', pose: 'flag', text: 'Follow my flag! I know a secret path to the Star Keeper.' }], { fx: 'guide', player: p });
    if (candidates.length) await teleport(ctx, p, ctx.rng.pick(candidates), 'guide');
  },
};

const popupShop: BoardEventDef = {
  id: 'pipper_popup',
  title: 'POP-UP SHOP',
  kind: 'festival',
  weight: 0.8,
  summary: 'Pipper sets up a travelling stall right where you landed.',
  available: (_ctx, p) => !!p && p.chips >= 4,
  async run(ctx, p) {
    if (!p) return;
    await present(ctx, this, [{ npc: 'pipper', pose: 'wave', text: 'Psst! Pipper\'s pop-up is open — just for you!' }], { fx: 'popup', player: p });
    await visitShop(ctx, p, 'pipper');
  },
};

// ------------------------------------------------------------------------------------------
// Mischief (disruptive, silly) events

const swapSpiral: BoardEventDef = {
  id: 'swap_spiral',
  title: 'SWAP SPIRAL',
  kind: 'mischief',
  summary: 'A spiral whirlwind swaps you with a random rival.',
  available: (ctx, p) => !!p && ctx.state.players.some((o) => o.slot !== p.slot && o.nodeId !== p.nodeId),
  async run(ctx, p) {
    if (!p) return;
    const others = ctx.state.players.filter((o) => o.slot !== p.slot && o.nodeId !== p.nodeId);
    const other = ctx.rng.pick(others);
    await present(ctx, this, [{ npc: 'mimi', pose: 'surprised', text: `Whoooosh! You and ${other.name} are caught in a Swap Spiral!` }], { fx: 'swap', player: p });
    if (await shieldBlocks(ctx, p)) return;
    const a = p.nodeId;
    const b = other.nodeId;
    await Promise.all([ctx.io.jumpTo(p, a, b, 'swap'), ctx.io.jumpTo(other, b, a, 'swap')]);
    p.nodeId = b;
    other.nodeId = a;
    p.trail = [];
    other.trail = [];
    checkpoint(ctx);
  },
};

const butterfingers: BoardEventDef = {
  id: 'butterfingers',
  title: 'BUTTERFINGERS',
  kind: 'mischief',
  summary: 'Oops! You drop one of your items (or a few coins if your bag is empty).',
  async run(ctx, p) {
    if (!p) return;
    await present(ctx, this, [{ npc: 'mimi', pose: 'alert', text: 'Uh-oh… something just slipped out of your bag!' }], { fx: 'drop', player: p });
    if (await shieldBlocks(ctx, p)) return;
    if (p.items.length) {
      const item = ctx.rng.pick(p.items);
      ItemManager.remove(p, item);
      await ctx.io.item(p, item, 'lose');
      checkpoint(ctx);
    } else {
      await loseChips(ctx, p, scale(ctx, 3), 'mischief');
    }
  },
};

const leakyPouch: BoardEventDef = {
  id: 'leaky_pouch',
  title: 'LEAKY POUCH',
  kind: 'mischief',
  weight: 1.3,
  summary: 'Your coin pouch springs a leak.',
  async run(ctx, p) {
    if (!p) return;
    const n = scale(ctx, ctx.rng.int(3, 6));
    await present(ctx, this, [{ npc: 'pipper', pose: 'point', text: 'Your pouch has a hole in it! Coins everywhere!' }], { fx: 'leak', player: p });
    if (await shieldBlocks(ctx, p)) return;
    await loseChips(ctx, p, n, 'mischief');
  },
};

const backwind: BoardEventDef = {
  id: 'backwind',
  title: 'BACKWIND',
  kind: 'mischief',
  summary: 'A cheeky breeze blows you 3 spaces back the way you came.',
  async run(ctx, p) {
    if (!p) return;
    await present(ctx, this, [{ npc: 'ora', pose: 'point', text: 'Whoa! A backwards breeze is pushing you back!' }], { fx: 'wind', player: p });
    if (await shieldBlocks(ctx, p)) return;
    await pushBackward(ctx, p, 3, 'wind');
  },
};

const generousGust: BoardEventDef = {
  id: 'generous_gust',
  title: 'GENEROUS GUST',
  kind: 'mischief',
  summary: 'The wind scatters your coins: every rival catches 2.',
  available: (_ctx, p) => !!p && p.chips > 0,
  async run(ctx, p) {
    if (!p) return;
    await present(ctx, this, [{ npc: 'packsprout', pose: 'surprised', text: 'Your coins are flying to everyone else! How generous!' }], { fx: 'leak', player: p });
    if (await shieldBlocks(ctx, p)) return;
    for (const o of ctx.state.players) {
      if (o.slot === p.slot || p.chips <= 0) continue;
      const n = await loseChips(ctx, p, 2, 'gust');
      if (n > 0) await gainChips(ctx, o, n, 'gust');
    }
  },
};

const topsyTurvy: BoardEventDef = {
  id: 'topsy_turvy',
  title: 'TOPSY-TURVY',
  kind: 'mischief',
  weight: 0.8,
  summary: 'The paths near you flip for a moment: you and nearby rivals step back 2 spaces.',
  async run(ctx, p) {
    if (!p) return;
    await present(ctx, this, [{ npc: 'mimi', pose: 'surprised', text: 'The trail is spinning backwards! Everyone nearby, hold on!' }], { fx: 'topsy', player: p });
    const near = ctx.state.players.filter((o) => o === p || ctx.graph.distance(o.nodeId, p.nodeId, ctx.board) <= 4 || ctx.graph.distance(p.nodeId, o.nodeId, ctx.board) <= 4);
    for (const o of near) {
      if (await shieldBlocks(ctx, o)) continue;
      await pushBackward(ctx, o, 2, 'wind');
    }
  },
};

// ------------------------------------------------------------------------------------------
// Round-level events

const keeperStroll: BoardEventDef = {
  id: 'keeper_stroll',
  title: "KEEPER'S STROLL",
  kind: 'global',
  summary: 'The Star Keeper wanders off to a different spot.',
  async run(ctx) {
    await present(ctx, this, [{ npc: 'packsprout', pose: 'happy', text: "I fancy a change of scenery. Follow me to my new gate!" }]);
    await relocateRelic(ctx, null);
  },
};

const bridgeRepair: BoardEventDef = {
  id: 'bridge_repair',
  title: 'BRIDGE REPAIRED',
  kind: 'global',
  summary: 'Wrench finishes repairing the Sky Bridge.',
  async run(ctx) {
    ctx.board.bridgeBroken = null;
    await present(ctx, this, [{ npc: 'wrench', pose: 'laugh', text: 'Good as new! The Sky Bridge is open again — the Cloud Steps are closing.' }], { fx: 'bridge-repair', focus: ctx.graph.def.bridges[0]?.nodes[1] });
    ctx.io.boardChanged();
  },
};

export const BOARD_EVENTS: BoardEventDef[] = [
  bridgeBreak,
  crystalSurge,
  windGust,
  portalStorm,
  cannonBlast,
  bouncyTrail,
  springLaunch,
  rollingLog,
  parade,
  relicRush,
  lanternShower,
  delivery,
  tailwind,
  oraGuide,
  popupShop,
  swapSpiral,
  butterfingers,
  leakyPouch,
  backwind,
  generousGust,
  topsyTurvy,
  keeperStroll,
  bridgeRepair,
];

/** Every event: the festival's own, then the world boards' (src/game/worlds/<id>/events.ts). */
const ALL_EVENTS: BoardEventDef[] = [...BOARD_EVENTS, ...WORLD_EVENTS];
const byId = new Map(ALL_EVENTS.map((e) => [e.id, e]));

/** Can this event happen on the board being played? */
const onThisBoard = (ctx: FlowContext, e: BoardEventDef): boolean =>
  (!e.boards || e.boards.includes(ctx.state.config.boardId)) && !ctx.graph.def.theme?.skipEvents?.includes(e.id);

export function eventDef(id: string): BoardEventDef | undefined {
  return byId.get(id);
}

export async function runEvent(ctx: FlowContext, id: string, p: PlayerState | null): Promise<void> {
  const def = byId.get(id);
  if (!def) return;
  logMatch(ctx.state, `Event ${def.title}${p ? ` (${p.name})` : ''}`);
  await def.run(ctx, p);
  // Final round: event spaces sparkle with bonus chips.
  if (p && def.kind === 'board' && def.id !== 'spring_launch' && isFinalRound(ctx.state)) await gainChips(ctx, p, 3, 'final-bonus');
}

export async function runRandomEvent(ctx: FlowContext, p: PlayerState, kind: 'festival' | 'mischief'): Promise<void> {
  const pool = ALL_EVENTS.filter((e) => e.kind === kind && onThisBoard(ctx, e) && (e.available?.(ctx, p) ?? true));
  if (!pool.length) return;
  const def = ctx.rng.weighted(pool.map((e) => ({ item: e, weight: e.weight ?? 1 })));
  await runEvent(ctx, def.id, p);
}

/** Chaotic mode (every round) and the final round: a surprise event for the whole board. */
export async function runGlobalEvent(ctx: FlowContext): Promise<void> {
  const own = WORLD_EVENTS.filter((e) => e.kind === 'global' && onThisBoard(ctx, e));
  const pool = [parade, portalStorm, crystalSurge, relicRush, keeperStroll, ...own].filter((e) => onThisBoard(ctx, e) && (e.available?.(ctx, null) ?? true));
  const def = ctx.rng.pick(pool);
  await runEvent(ctx, def.id, null);
}
