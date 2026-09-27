import { ITEMS, type ItemId } from '../data/items';
import { ItemManager } from '../items/ItemManager';
import { currentRelicPrice, type PlayerState } from '../state/MatchState';
import type { FlowContext, PathOption, PreRollDecision, ShopOffer, TargetOption } from './flowTypes';
import type { SpaceType } from './types';

/** How often each difficulty makes a "whatever" choice instead of the sensible one. */
const SLOPPINESS = { easy: 0.35, normal: 0.14, hard: 0.04 } as const;

const SPACE_VALUE: Record<SpaceType, number> = {
  start: 2,
  gleam: 3,
  festival: 4,
  mischief: -3,
  market: 1,
  portal: 2,
  relic: 0,
  event: 2,
};

function sloppy(ctx: FlowContext, p: PlayerState): boolean {
  return ctx.rng.chance(SLOPPINESS[p.cpuLevel]);
}

function relicDistance(ctx: FlowContext, from: string, hasKey: boolean): number {
  return ctx.graph.distance(from, ctx.board.relicGate, ctx.board, hasKey);
}

/**
 * CPU decisions on the board. Everything here only looks at information a human could see on
 * screen (positions, chips, the relic location). Randomness comes from the match RNG.
 */
export const BoardAI = {
  preRoll(ctx: FlowContext, p: PlayerState, usable: ItemId[]): PreRollDecision {
    if (usable.length === 0 || sloppy(ctx, p)) return { kind: 'roll' };
    const price = currentRelicPrice(ctx.state);
    const hasKey = ItemManager.has(p, 'prism_key');
    const dist = relicDistance(ctx, p.nodeId, hasKey);
    if (usable.includes('mystery_capsule')) return { kind: 'item', item: 'mystery_capsule' };
    if (usable.includes('bubble_shield') && !p.shielded) return { kind: 'item', item: 'bubble_shield' };
    if (usable.includes('magnet_glove')) {
      const richest = Math.max(...ctx.state.players.filter((o) => o.slot !== p.slot).map((o) => o.chips));
      if (richest >= 4) return { kind: 'item', item: 'magnet_glove' };
    }
    if (usable.includes('warp_charm') && dist > 14 && this.bestWarpTarget(ctx, p) !== null) return { kind: 'item', item: 'warp_charm' };
    if (usable.includes('wingstep_boots')) {
      const aiming = p.chips >= price && dist >= 4 && dist <= 13;
      if (aiming || ctx.rng.chance(0.2)) return { kind: 'item', item: 'wingstep_boots' };
    }
    if (usable.includes('snare_seed') && ctx.graph.node(p.nodeId).type !== 'start' && !ctx.board.traps.some((t) => t.nodeId === p.nodeId) && ctx.rng.chance(0.5)) {
      return { kind: 'item', item: 'snare_seed' };
    }
    return { kind: 'roll' };
  },

  choosePath(ctx: FlowContext, p: PlayerState, _at: string, options: PathOption[]): string {
    if (options.length === 1) return options[0].to;
    if (sloppy(ctx, p)) return ctx.rng.pick(options).to;
    const price = currentRelicPrice(ctx.state);
    const hasKey = ItemManager.has(p, 'prism_key');
    const affordable = p.chips >= price;
    let best = options[0].to;
    let bestScore = -Infinity;
    for (const o of options) {
      const d = ctx.graph.distance(o.to, ctx.board.relicGate, ctx.board, hasKey) + 1;
      let score: number;
      if (affordable) {
        score = -d * 10;
      } else {
        // Sample the next few spaces along this branch.
        score = 0;
        let at = o.to;
        for (let i = 0; i < 4; i++) {
          const n = ctx.graph.node(at);
          score += SPACE_VALUE[n.type] * (1 - i * 0.15);
          if (n.type === 'market' && p.items.length < 3 && p.chips >= 6) score += 3;
          const ex = ctx.graph.usableExits(at, ctx.board, false);
          if (!ex.length) break;
          at = ex[0].to;
        }
        // Still drift toward the relic while saving up.
        score -= d * 0.4;
      }
      // Spending a key is only worth it when it clearly pays off.
      if (o.needsKey) score += affordable ? 0 : -6;
      score += ctx.rng.range(0, 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = o.to;
      }
    }
    return best;
  },

  shopPick(ctx: FlowContext, p: PlayerState, offer: ShopOffer): ItemId | null {
    const price = currentRelicPrice(ctx.state);
    const dist = relicDistance(ctx, p.nodeId, ItemManager.has(p, 'prism_key'));
    // Keep enough for a relic when one is close.
    const reserve = dist <= 14 && p.chips >= price * 0.6 ? price : 4;
    const budget = p.chips - reserve;
    const affordable = offer.items.filter((i) => i.price <= budget);
    if (affordable.length === 0) return null;
    if (sloppy(ctx, p)) return ctx.rng.chance(0.5) ? ctx.rng.pick(affordable).id : null;
    const ranked = affordable
      .filter((i) => !(i.id === 'bubble_shield' && (p.shielded || p.items.includes('bubble_shield'))))
      .filter((i) => !(i.id === 'prism_key' && p.items.includes('prism_key')))
      .sort((a, b) => ITEMS[b.id].value - ITEMS[a.id].value);
    const pick = ranked[0];
    if (!pick) return null;
    if (ItemManager.isFull(p)) {
      const worst = ItemManager.leastValuable(p.items);
      if (ITEMS[pick.id].value <= ITEMS[worst].value + 1) return null;
    }
    return pick.id;
  },

  wantsReroll(ctx: FlowContext, p: PlayerState, result: number): boolean {
    if (sloppy(ctx, p)) return ctx.rng.chance(0.5);
    const price = currentRelicPrice(ctx.state);
    const dist = relicDistance(ctx, p.nodeId, ItemManager.has(p, 'prism_key'));
    const bonus = ctx.turn.bootsBonus;
    if (p.chips >= price && dist <= 10 + bonus && result + bonus < dist) return true;
    return result <= 3;
  },

  discard(_ctx: FlowContext, p: PlayerState, incoming: ItemId): ItemId {
    return ItemManager.leastValuable([...p.items, incoming]);
  },

  chooseTarget<T>(ctx: FlowContext, p: PlayerState, purpose: 'magnet' | 'warp', options: TargetOption<T>[]): T {
    if (purpose === 'magnet') {
      const rich = options
        .map((o) => ({ o, chips: o.slot !== undefined ? (ctx.state.players.find((x) => x.slot === o.slot)?.chips ?? 0) : 0 }))
        .sort((a, b) => b.chips - a.chips);
      return (sloppy(ctx, p) ? ctx.rng.pick(options) : rich[0].o).value;
    }
    const best = this.bestWarpTarget(ctx, p);
    const match = options.find((o) => o.nodeId === best);
    return (match ?? ctx.rng.pick(options)).value;
  },

  /** Warp destination (a rival's space or a portal) closest to the relic, if it helps. */
  bestWarpTarget(ctx: FlowContext, p: PlayerState): string | null {
    const hasKey = ItemManager.has(p, 'prism_key');
    const here = relicDistance(ctx, p.nodeId, hasKey);
    const candidates = new Set<string>();
    for (const o of ctx.state.players) if (o.slot !== p.slot) candidates.add(o.nodeId);
    for (const id of Object.keys(ctx.board.portalLinks)) candidates.add(id);
    let best: string | null = null;
    let bestD = here - 5;
    for (const c of candidates) {
      if (c === p.nodeId) continue;
      const d = relicDistance(ctx, c, hasKey);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  },
};
