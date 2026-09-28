import { checkpoint, type DialogLineSpec, type EventPresentation, type FlowContext } from '../../board/flowTypes';
import type { PlayerState } from '../../state/MatchState';
import type { BoardEventDef } from '../types';

const BOARD = 'heroes';

// TurnFlow's helpers load on first use: a static import would close a loop through EventManager,
// which gathers these events while it loads (worlds/events → here → TurnFlow → EventManager).
const flow = (): Promise<typeof import('../../board/TurnFlow')> => import('../../board/TurnFlow');

function present(ctx: FlowContext, def: BoardEventDef, lines: DialogLineSpec[], extra: Partial<EventPresentation> = {}): Promise<void> {
  return ctx.io.event({ id: def.id, title: def.title, kind: def.kind, lines, ...extra }).then(() => checkpoint(ctx));
}

/** Steps from a space to the Star Coin's gate (Infinity if it can't be reached without a key). */
function starDistance(ctx: FlowContext, nodeId: string): number {
  return ctx.graph.distance(nodeId, ctx.board.relicGate, ctx.board);
}

/**
 * The rival a Rooftop Chase goes after: the one standing nearest the Star Coin (never on the
 * chaser's own space), or null when the chaser is already the closest or nobody else is about.
 * Ties go to the rival with more Star Coins, then more coins.
 */
export function chaseTarget(ctx: FlowContext, p: PlayerState): PlayerState | null {
  const rivals = ctx.state.players.filter((o) => o.slot !== p.slot && o.nodeId !== p.nodeId);
  if (!rivals.length) return null;
  const scored = rivals.map((o) => ({ o, d: starDistance(ctx, o.nodeId) }));
  scored.sort((a, b) => a.d - b.d || b.o.relics - a.o.relics || b.o.chips - a.o.chips || a.o.slot - b.o.slot);
  const best = scored[0];
  return best.d < starDistance(ctx, p.nodeId) ? best.o : null;
}

/** Everyone the searchlight catches: players on open ledges, plus whoever set it off. */
export function searchlightTargets(ctx: FlowContext, p: PlayerState | null): PlayerState[] {
  return ctx.state.players.filter((o) => o === p || !!ctx.graph.node(o.nodeId).metadata?.exposed);
}

// ------------------------------------------------------------------------------------------

const blackout: BoardEventDef = {
  id: 'heroes_blackout',
  title: 'BLACKOUT',
  kind: 'board',
  boards: [BOARD],
  summary: 'The skyline goes dark, and when the lights come back the Star Coin is waiting on another rooftop.',
  async run(ctx, p) {
    await present(
      ctx,
      this,
      [
        { npc: 'wrench', pose: 'surprised', text: 'Uh-oh! The Tech Spire core just flickered out. The whole skyline has gone dark!' },
        { npc: 'packsprout', pose: 'surprised', text: "I can't see a thing! I'll wait for you somewhere else. Follow the lights when they come back on!" },
      ],
      { focus: 'ht2' },
    );
    // Favours gates far from whoever tripped the breaker.
    const { relocateRelic } = await flow();
    await relocateRelic(ctx, p);
  },
};

const searchlight: BoardEventDef = {
  id: 'heroes_searchlight',
  title: 'SEARCHLIGHT SWEEP',
  kind: 'board',
  boards: [BOARD],
  summary: 'The clock tower searchlight sweeps the open ledges: everyone standing on one (and you) is pushed back 2 spaces.',
  async run(ctx, p) {
    const { pushBackward, shieldBlocks } = await flow();
    await present(ctx, this, [{ npc: 'ora', pose: 'point', text: 'The clock tower searchlight is sweeping the rooftops! Everyone out on the open ledges, back into the shadows!' }], { fx: 'wind', focus: p?.nodeId ?? 'hb1' });
    for (const pl of searchlightTargets(ctx, p)) {
      if (await shieldBlocks(ctx, pl)) continue;
      await pushBackward(ctx, pl, 2, 'wind');
    }
  },
};

const chase: BoardEventDef = {
  id: 'heroes_chase',
  title: 'ROOFTOP CHASE',
  kind: 'board',
  boards: [BOARD],
  summary: 'You race across the rooftops after the rival nearest the Star Coin and swap places with them.',
  async run(ctx, p) {
    if (!p) return;
    const { gainChips, shieldBlocks } = await flow();
    const target = chaseTarget(ctx, p);
    if (!target) {
      // Already out in front (or nobody to chase): the crowd on the rooftops cheers instead.
      await present(ctx, this, [{ npc: 'mimi', pose: 'happy', text: "Nobody's closer to the Star Coin than you! The rooftop crowd cheers you on!" }], { player: p });
      await gainChips(ctx, p, 5, 'event');
      return;
    }
    await present(ctx, this, [{ npc: 'mimi', pose: 'surprised', text: `A rooftop chase! You leap across the gap after ${target.name}. Swap places!` }], { fx: 'swap', player: p });
    if (await shieldBlocks(ctx, target)) return;
    const a = p.nodeId;
    const b = target.nodeId;
    await Promise.all([ctx.io.jumpTo(p, a, b, 'swap'), ctx.io.jumpTo(target, b, a, 'swap')]);
    p.nodeId = b;
    target.nodeId = a;
    p.trail = [];
    target.trail = [];
    checkpoint(ctx);
  },
};

const subwayShuffle: BoardEventDef = {
  id: 'heroes_subway',
  title: 'SUBWAY SHUFFLE',
  kind: 'global',
  boards: [BOARD],
  summary: 'The night trains are rerouted: every subway portal changes where it leads.',
  available: (ctx) => Object.keys(ctx.board.portalLinks).length >= 4,
  async run(ctx) {
    const ids = Object.keys(ctx.board.portalLinks).sort();
    if (ids.length < 4) return;
    const old = { ...ctx.board.portalLinks };
    for (let tries = 0; tries < 12; tries++) {
      const shuffled = ctx.rng.shuffle([...ids]);
      const links: Record<string, string> = {};
      for (let i = 0; i + 1 < shuffled.length; i += 2) {
        links[shuffled[i]] = shuffled[i + 1];
        links[shuffled[i + 1]] = shuffled[i];
      }
      ctx.board.portalLinks = links;
      if (ids.some((id) => links[id] !== old[id])) break;
    }
    await present(
      ctx,
      this,
      [
        { npc: 'ora', pose: 'point', text: 'Attention, night travellers! The subway lines have been rerouted.' },
        { npc: 'ora', pose: 'flag', text: 'Every subway portal leads somewhere new now. Check the colour gems before you hop in!' },
      ],
      { fx: 'portal-storm', focus: ids.includes('hr3') ? 'hr3' : ids[0] },
    );
    ctx.io.boardChanged();
  },
};

/** Board events unique to the heroes board (give each `boards: ['heroes']`). */
export const HEROES_EVENTS: BoardEventDef[] = [blackout, searchlight, chase, subwayShuffle];
