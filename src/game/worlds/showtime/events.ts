import { BoardAI } from '../../board/BoardAI';
import { checkpoint, type DialogLineSpec, type EventPresentation, type FlowContext, type PathOption } from '../../board/flowTypes';
import { DIAL_MAX, DIAL_MIN } from '../../constants';
import { ItemManager } from '../../items/ItemManager';
import type { PlayerState } from '../../state/MatchState';
import type { BoardEventDef } from '../types';
import { SHOWTIME_STAGES } from './board';

const BOARD = 'showtime';

// TurnFlow's helpers load on first use: a static import would close a loop through EventManager,
// which gathers these events while it loads (worlds/events → here → TurnFlow → EventManager).
const flow = (): Promise<typeof import('../../board/TurnFlow')> => import('../../board/TurnFlow');

function present(ctx: FlowContext, def: BoardEventDef, lines: DialogLineSpec[], extra: Partial<EventPresentation> = {}): Promise<void> {
  return ctx.io.event({ id: def.id, title: def.title, kind: def.kind, lines, ...extra }).then(() => checkpoint(ctx));
}

/** Chaotic events pay out half as much again (as the festival's own events do). */
const scaled = (ctx: FlowContext, n: number): number => Math.round(n * (ctx.state.config.events === 'chaotic' ? 1.5 : 1));

/** Is this space part of a stage (the diner's, the pop concert's or the marquee's)? */
export function onStage(ctx: FlowContext, nodeId: string): boolean {
  return SHOWTIME_STAGES.includes(ctx.graph.node(nodeId).metadata?.region ?? '');
}

/**
 * An encore: move `steps` spaces on, like a normal move (choose at forks, a Prism Key opens its
 * gate, pass the Star Coin to buy it, pass a market to shop) but without a landing of its own.
 */
export async function encoreMove(ctx: FlowContext, p: PlayerState, steps: number): Promise<void> {
  const { graph, board, io } = ctx;
  const { offerRelic, visitShop } = await flow();
  let left = steps;
  while (left > 0) {
    const at = p.nodeId;
    const exits = graph.usableExits(at, board, ItemManager.has(p, 'prism_key'));
    if (!exits.length) break;
    let to = exits[0].to;
    if (exits.length > 1) {
      const options: PathOption[] = exits.map((e) => ({ to: e.to, label: graph.node(at).metadata?.signs?.[e.to] ?? graph.node(e.to).metadata?.region ?? e.to, needsKey: e.needsKey }));
      const cpu = p.isCpu ? BoardAI.choosePath(ctx, p, at, options) : undefined;
      to = await io.choosePath(p, at, options, cpu);
      checkpoint(ctx);
    }
    const exit = exits.find((e) => e.to === to) ?? exits[0];
    if (exit.needsKey && ItemManager.remove(p, 'prism_key')) {
      p.stats.itemsUsed += 1;
      await io.item(p, 'prism_key', 'use');
      checkpoint(ctx);
    }
    left -= 1;
    await io.moveStep(p, at, exit.to, left);
    p.trail.push(at);
    if (p.trail.length > 16) p.trail.shift();
    p.nodeId = exit.to;
    p.stats.spacesMoved += 1;
    checkpoint(ctx);
    const node = graph.node(p.nodeId);
    if (node.type === 'relic' && board.relicGate === node.id) await offerRelic(ctx, p);
    else if (node.type === 'market' && left > 0 && node.metadata?.shop) await visitShop(ctx, p, node.metadata.shop);
  }
}

/** Who a stampede reaches: whoever set it off and everyone within 4 spaces of them (either way). */
export function stampedeTargets(ctx: FlowContext, p: PlayerState): PlayerState[] {
  return ctx.state.players.filter((o) => o === p || ctx.graph.distance(o.nodeId, p.nodeId, ctx.board) <= 4 || ctx.graph.distance(p.nodeId, o.nodeId, ctx.board) <= 4);
}

// ------------------------------------------------------------------------------------------

const encore: BoardEventDef = {
  id: 'showtime_encore',
  title: 'ENCORE!',
  kind: 'board',
  boards: [BOARD],
  summary: 'The crowd wants more: spin the Orbit Dial again and dance that many spaces on.',
  async run(ctx, p) {
    if (!p) return;
    await present(
      ctx,
      this,
      [
        { npc: 'ora', pose: 'cheer', text: 'Listen to that crowd! They want an ENCORE!' },
        { npc: 'ora', pose: 'point', text: 'Spin the Orbit Dial again and dance right on down the strip!' },
      ],
      { fx: 'parade', player: p },
    );
    const result = ctx.rng.int(DIAL_MIN, DIAL_MAX);
    await ctx.io.spinDial(p, result, 0);
    checkpoint(ctx);
    await encoreMove(ctx, p, result);
  },
};

const spotlight: BoardEventDef = {
  id: 'showtime_spotlight',
  title: 'SPOTLIGHT SOLO',
  kind: 'board',
  boards: [BOARD],
  summary: 'The spotlights find everyone standing on a stage, and each takes a bow for 6 coins (4 for you if the stages are empty).',
  async run(ctx, p) {
    const { gainChips } = await flow();
    const stars = ctx.state.players.filter((o) => onStage(ctx, o.nodeId));
    const bow = scaled(ctx, 6);
    const lines: DialogLineSpec[] = [{ npc: 'ora', pose: 'flag', text: 'Lights! The spotlights are sweeping every stage on the strip!' }];
    if (stars.length) lines.push({ npc: 'ora', pose: 'cheer', text: `Take a bow, ${stars.map((o) => o.name).join(' and ')}! ${bow} coins for every star on stage!` });
    else lines.push({ npc: 'ora', pose: 'wave', text: 'Hmm, the stages are empty tonight... so the spotlight is all yours!' });
    await present(ctx, this, lines, { fx: 'spotlight', focus: 'sr2' });
    if (stars.length) for (const o of stars) await gainChips(ctx, o, bow, 'spotlight');
    else if (p) await gainChips(ctx, p, scaled(ctx, 4), 'spotlight');
  },
};

const stampede: BoardEventDef = {
  id: 'showtime_stampede',
  title: 'RODEO STAMPEDE',
  kind: 'board',
  boards: [BOARD],
  summary: "The saloon's sparkly toy rodeo bulls break out of the corral and scatter everyone nearby 1-3 spaces.",
  async run(ctx, p) {
    if (!p) return;
    const { pushBackward, shieldBlocks, teleport } = await flow();
    await present(
      ctx,
      this,
      [
        { npc: 'pipper', pose: 'point', text: "Yee-haw! The saloon's rhinestone toy bulls just busted out of the rodeo corral!" },
        { npc: 'mimi', pose: 'alert', text: 'Hold onto your hats, everybody nearby is getting scattered!' },
      ],
      { fx: 'wind', focus: p.nodeId },
    );
    for (const o of stampedeTargets(ctx, p)) {
      if (await shieldBlocks(ctx, o)) continue;
      const k = ctx.rng.int(1, 3);
      if (ctx.rng.chance(0.5)) {
        await pushBackward(ctx, o, k, 'wind');
      } else {
        const spots = [...ctx.graph.reachableIn(o.nodeId, k, ctx.board)].filter((id) => !ctx.graph.node(id).metadata?.gate);
        if (spots.length) await teleport(ctx, o, ctx.rng.pick(spots.sort()), 'wind');
        else await pushBackward(ctx, o, k, 'wind');
      }
    }
  },
};

const neonSurge: BoardEventDef = {
  id: 'showtime_neon_surge',
  title: 'NEON SURGE',
  kind: 'global',
  boards: [BOARD],
  summary: 'Every sign on the strip blazes at once: glowing blue spaces pay double coins until the end of next round.',
  available: (ctx) => !ctx.board.surge,
  async run(ctx) {
    const gleams = ctx.graph.nodesOfType('gleam').map((nd) => nd.id);
    const nodes = ctx.rng.shuffle([...gleams]).slice(0, 8);
    ctx.board.surge = { nodes, untilRound: ctx.state.round + 1 };
    await present(
      ctx,
      this,
      [
        { npc: 'wrench', pose: 'gadget', text: 'Whoa! Every neon sign on the strip just switched to full power!' },
        { npc: 'wrench', pose: 'laugh', text: 'The glowing blue spaces pay DOUBLE coins until the end of next round!' },
      ],
      { fx: 'surge', focus: 'sr2' },
    );
    ctx.io.boardChanged();
  },
};

/** Board events unique to the showtime board (give each `boards: ['showtime']`). */
export const SHOWTIME_EVENTS: BoardEventDef[] = [encore, spotlight, stampede, neonSurge];
