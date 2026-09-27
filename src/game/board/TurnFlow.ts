import { BOOTS_BONUS, DIAL_MAX, DIAL_MIN, ECONOMY } from '../constants';
import { ITEMS, SHOPS, type ItemId } from '../data/items';
import { ItemManager } from '../items/ItemManager';
import { currentRelicPrice, isFinalRound, logMatch, type PlayerState } from '../state/MatchState';
import { BoardAI } from './BoardAI';
import { runEvent, runRandomEvent } from './EventManager';
import { checkpoint, freshTurn, type FlowContext, type JumpKind, type PathOption, type TargetOption } from './flowTypes';

// -------------------------------------------------------------------------------------------
// Shared helpers (also used by board events)

export async function gainChips(ctx: FlowContext, p: PlayerState, amount: number, reason: string): Promise<void> {
  if (amount <= 0) return;
  p.chips += amount;
  p.stats.chipsEarned += amount;
  await ctx.io.chips(p, amount, reason);
  checkpoint(ctx);
}

/** Lose up to `amount` chips (never below zero). Returns how many were actually lost. */
export async function loseChips(ctx: FlowContext, p: PlayerState, amount: number, reason: string): Promise<number> {
  const lost = Math.min(p.chips, Math.max(0, amount));
  if (lost <= 0) return 0;
  p.chips -= lost;
  await ctx.io.chips(p, -lost, reason);
  checkpoint(ctx);
  return lost;
}

export async function spendChips(ctx: FlowContext, p: PlayerState, amount: number, reason: string): Promise<void> {
  p.chips -= amount;
  p.stats.chipsSpent += amount;
  await ctx.io.chips(p, -amount, reason);
  checkpoint(ctx);
}

/** If the player has a Bubble Shield up, it pops and blocks the mishap. */
export async function shieldBlocks(ctx: FlowContext, p: PlayerState): Promise<boolean> {
  if (!p.shielded) return false;
  p.shielded = false;
  await ctx.io.shield(p, 'block');
  checkpoint(ctx);
  return true;
}

/** Give an item, asking which to drop when the bag is full. */
export async function giveItem(ctx: FlowContext, p: PlayerState, item: ItemId): Promise<void> {
  if (ItemManager.add(p, item)) {
    await ctx.io.item(p, item, 'gain');
    checkpoint(ctx);
    return;
  }
  const cpu = p.isCpu ? BoardAI.discard(ctx, p, item) : undefined;
  const drop = await ctx.io.chooseDiscard(p, item, cpu);
  checkpoint(ctx);
  if (drop === item) {
    await ctx.io.item(p, item, 'discard');
  } else {
    ItemManager.swap(p, drop, item);
    await ctx.io.item(p, drop, 'discard');
    await ctx.io.item(p, item, 'gain');
  }
  checkpoint(ctx);
}

export async function teleport(ctx: FlowContext, p: PlayerState, to: string, kind: JumpKind): Promise<void> {
  const from = p.nodeId;
  if (from === to) return;
  await ctx.io.jumpTo(p, from, to, kind);
  p.trail = [];
  p.nodeId = to;
  checkpoint(ctx);
}

/** Move forward `steps` spaces (auto-picking at intersections for events). */
export async function pushForward(ctx: FlowContext, p: PlayerState, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) {
    const exits = ctx.graph.usableExits(p.nodeId, ctx.board, false);
    if (!exits.length) return;
    const to = exits.length > 1 ? BoardAI.choosePath(ctx, p, p.nodeId, exits.map((e) => ({ to: e.to, label: '', needsKey: e.needsKey }))) : exits[0].to;
    await ctx.io.moveStep(p, p.nodeId, to, steps - i - 1);
    p.trail.push(p.nodeId);
    if (p.trail.length > 16) p.trail.shift();
    p.nodeId = to;
    p.stats.spacesMoved++;
    checkpoint(ctx);
  }
}

/** Move backwards `steps` spaces, retracing the player's trail. */
export async function pushBackward(ctx: FlowContext, p: PlayerState, steps: number, kind: JumpKind = 'wind'): Promise<void> {
  const from = p.nodeId;
  let at = from;
  for (let i = 0; i < steps; i++) {
    const back = ctx.graph.stepBack(at, p.trail, ctx.board);
    if (!back) break;
    if (p.trail[p.trail.length - 1] === back) p.trail.pop();
    at = back;
  }
  if (at === from) return;
  await ctx.io.jumpTo(p, from, at, kind);
  p.nodeId = at;
  checkpoint(ctx);
}

/** Move the Relic Keeper to a new gate, favouring gates far from the buyer. */
export async function relocateRelic(ctx: FlowContext, buyer: PlayerState | null): Promise<void> {
  const old = ctx.board.relicGate;
  const gates = ctx.graph.def.relicGates.filter((g) => g !== old);
  if (!gates.length) return;
  const weighted = gates.map((g) => {
    const d = buyer ? ctx.graph.distance(buyer.nodeId, g, ctx.board, false) : 10;
    const minOthers = Math.min(...ctx.state.players.map((pl) => ctx.graph.distance(pl.nodeId, g, ctx.board, false)));
    // Farther from the buyer is likelier; never right on top of someone.
    const w = Math.max(1, Math.min(40, Number.isFinite(d) ? d : 20)) * (minOthers <= 2 ? 0.3 : 1);
    return { item: g, weight: w };
  });
  const next = ctx.rng.weighted(weighted);
  ctx.board.relicGate = next;
  logMatch(ctx.state, `Relic moved ${old} → ${next}`);
  await ctx.io.relicMoved(old, next);
  checkpoint(ctx);
}

export async function offerRelic(ctx: FlowContext, p: PlayerState): Promise<void> {
  const gate = ctx.board.relicGate;
  if (ctx.turn.relicOffered.has(gate)) return;
  ctx.turn.relicOffered.add(gate);
  const price = currentRelicPrice(ctx.state);
  if (p.chips < price) {
    await ctx.io.say([{ npc: 'packsprout', pose: 'surprised', text: `A Prism Relic costs ${price} Gleam Chips. You have ${p.chips} — come back soon!` }], p);
    checkpoint(ctx);
    return;
  }
  const want = await ctx.io.offerRelic(p, price, p.isCpu ? true : undefined);
  checkpoint(ctx);
  if (!want) return;
  await spendChips(ctx, p, price, 'relic');
  p.relics += 1;
  p.stats.relicsBought += 1;
  logMatch(ctx.state, `${p.name} bought a Prism Relic`);
  await ctx.io.relicGained(p, 'purchase');
  checkpoint(ctx);
  await relocateRelic(ctx, p);
}

export async function visitShop(ctx: FlowContext, p: PlayerState, shopId: 'wrench' | 'pipper'): Promise<void> {
  const shop = SHOPS[shopId];
  const ids = [...shop.stock];
  if (isFinalRound(ctx.state) && !ids.includes(shop.finalRoundExtra)) ids.push(shop.finalRoundExtra);
  const offer = { shop, items: ids.map((id) => ({ id, price: ITEMS[id].price })) };
  const cpu = p.isCpu ? BoardAI.shopPick(ctx, p, offer) : undefined;
  const pick = await ctx.io.shop(p, offer, cpu);
  checkpoint(ctx);
  if (!pick) return;
  const price = offer.items.find((i) => i.id === pick)?.price ?? ITEMS[pick].price;
  if (p.chips < price) return;
  await spendChips(ctx, p, price, 'shop');
  await giveItem(ctx, p, pick);
}

// -------------------------------------------------------------------------------------------
// Items

async function useItem(ctx: FlowContext, p: PlayerState, item: ItemId): Promise<boolean> {
  const { io } = ctx;
  switch (item) {
    case 'wingstep_boots': {
      ItemManager.remove(p, item);
      ctx.turn.bootsBonus += BOOTS_BONUS;
      await io.item(p, item, 'use');
      break;
    }
    case 'bubble_shield': {
      ItemManager.remove(p, item);
      p.shielded = true;
      await io.item(p, item, 'use');
      await io.shield(p, 'up');
      break;
    }
    case 'snare_seed': {
      if (ctx.board.traps.some((t) => t.nodeId === p.nodeId)) return false;
      ItemManager.remove(p, item);
      ctx.board.traps.push({ nodeId: p.nodeId, owner: p.slot });
      await io.item(p, item, 'use');
      await io.trap('plant', p.nodeId, p.slot);
      break;
    }
    case 'mystery_capsule': {
      ItemManager.remove(p, item);
      await io.item(p, item, 'use');
      const got = ItemManager.randomItem(ctx.rng);
      await giveItem(ctx, p, got);
      break;
    }
    case 'magnet_glove': {
      const rivals = ctx.state.players.filter((o) => o.slot !== p.slot);
      const options: TargetOption<number>[] = rivals.map((o) => ({ value: o.slot, label: `${o.name} (${o.chips} chips)`, nodeId: o.nodeId, slot: o.slot }));
      const cpu = p.isCpu ? BoardAI.chooseTarget(ctx, p, 'magnet', options) : undefined;
      const target = await io.chooseTarget(p, 'Pull chips from which rival?', options, cpu);
      checkpoint(ctx);
      if (target === null) return false;
      ItemManager.remove(p, item);
      await io.item(p, item, 'use');
      const victim = ctx.state.players.find((o) => o.slot === target)!;
      if (await shieldBlocks(ctx, victim)) break;
      const n = await loseChips(ctx, victim, ECONOMY.magnetSteal, 'magnet');
      if (n > 0) await gainChips(ctx, p, n, 'magnet');
      break;
    }
    case 'warp_charm': {
      const options: TargetOption<string>[] = [];
      for (const o of ctx.state.players) if (o.slot !== p.slot && o.nodeId !== p.nodeId) options.push({ value: o.nodeId, label: `Warp to ${o.name}`, nodeId: o.nodeId, slot: o.slot });
      for (const portal of Object.keys(ctx.board.portalLinks)) {
        if (portal !== p.nodeId && !options.some((x) => x.value === portal)) {
          const region = ctx.graph.node(portal).metadata?.region ?? 'portal';
          options.push({ value: portal, label: `Portal · ${region}`, nodeId: portal });
        }
      }
      if (!options.length) return false;
      const cpu = p.isCpu ? BoardAI.chooseTarget(ctx, p, 'warp', options) : undefined;
      const target = await io.chooseTarget(p, 'Warp where?', options, cpu);
      checkpoint(ctx);
      if (target === null) return false;
      ItemManager.remove(p, item);
      await io.item(p, item, 'use');
      await teleport(ctx, p, target, 'warp');
      break;
    }
    default:
      return false;
  }
  p.stats.itemsUsed += 1;
  logMatch(ctx.state, `${p.name} used ${ITEMS[item].name}`);
  checkpoint(ctx);
  return true;
}

function usableItems(ctx: FlowContext, p: PlayerState): ItemId[] {
  if (ctx.turn.itemUsed) return [];
  const canWarp = ctx.state.players.some((o) => o.slot !== p.slot && o.nodeId !== p.nodeId) || Object.keys(ctx.board.portalLinks).some((id) => id !== p.nodeId);
  return ItemManager.usablePreRoll(p, { hasRivals: ctx.state.players.length > 1, canWarp }).filter((id) => !(id === 'snare_seed' && ctx.board.traps.some((t) => t.nodeId === p.nodeId)));
}

// -------------------------------------------------------------------------------------------
// Movement and landing

async function move(ctx: FlowContext, p: PlayerState, steps: number): Promise<void> {
  const { io, graph, board } = ctx;
  let remaining = steps;
  while (remaining > 0) {
    const at = p.nodeId;
    const hasKey = ItemManager.has(p, 'prism_key');
    const exits = graph.usableExits(at, board, hasKey);
    if (!exits.length) break;
    let to = exits[0].to;
    if (exits.length > 1) {
      const options: PathOption[] = exits.map((e) => ({
        to: e.to,
        label: graph.node(at).metadata?.signs?.[e.to] ?? graph.node(e.to).metadata?.region ?? e.to,
        needsKey: e.needsKey,
      }));
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
    remaining -= 1;
    await io.moveStep(p, at, exit.to, remaining);
    p.trail.push(at);
    if (p.trail.length > 16) p.trail.shift();
    p.nodeId = exit.to;
    p.stats.spacesMoved += 1;
    checkpoint(ctx);
    const node = graph.node(p.nodeId);
    if (node.type === 'relic' && board.relicGate === node.id) await offerRelic(ctx, p);
    else if (node.type === 'market' && remaining > 0 && node.metadata?.shop) await visitShop(ctx, p, node.metadata.shop);
  }
}

async function land(ctx: FlowContext, p: PlayerState): Promise<void> {
  const { io, graph, board, state } = ctx;
  const node = graph.node(p.nodeId);
  await io.landed(p, node);
  checkpoint(ctx);
  // Snare traps planted by rivals.
  const trapIdx = board.traps.findIndex((t) => t.nodeId === node.id && t.owner !== p.slot);
  if (trapIdx >= 0) {
    const trap = board.traps[trapIdx];
    board.traps.splice(trapIdx, 1);
    await io.trap('spring', node.id, trap.owner, p);
    if (!(await shieldBlocks(ctx, p))) {
      const owner = state.players.find((o) => o.slot === trap.owner);
      const n = await loseChips(ctx, p, ECONOMY.snareSteal, 'snare');
      if (owner && n > 0) await gainChips(ctx, owner, n, 'snare');
    }
  }
  switch (node.type) {
    case 'start':
    case 'gleam': {
      const base = isFinalRound(state) ? ECONOMY.gleamSpaceFinal : ECONOMY.gleamSpace;
      const surge = board.surge && board.surge.nodes.includes(node.id) ? 2 : 1;
      await gainChips(ctx, p, base * surge, surge > 1 ? 'surge' : 'gleam');
      break;
    }
    case 'festival':
      p.stats.luckyLandings += 1;
      await runRandomEvent(ctx, p, 'festival');
      break;
    case 'mischief':
      await runRandomEvent(ctx, p, 'mischief');
      break;
    case 'event':
      p.stats.eventsTriggered += 1;
      if (node.eventId) await runEvent(ctx, node.eventId, p);
      break;
    case 'market':
      if (node.metadata?.shop) await visitShop(ctx, p, node.metadata.shop);
      break;
    case 'portal': {
      const partner = graph.portalPartner(node.id, board);
      if (partner) {
        p.stats.luckyLandings += 1;
        await teleport(ctx, p, partner, 'portal');
      }
      break;
    }
    case 'relic':
      if (board.relicGate !== node.id) {
        await io.say([{ npc: 'packsprout', pose: 'idle', text: 'This gate is quiet today… but the pedestal still hums. Take a few chips!' }], p);
        await gainChips(ctx, p, 2, 'pedestal');
      }
      break;
  }
  // Spring pads stay bouncy for a while after the Bouncy Trail event.
  if (!ctx.turn.bounced && board.bouncy && board.bouncy.nodes.includes(p.nodeId)) {
    ctx.turn.bounced = true;
    await runEvent(ctx, 'spring_launch', p);
  }
}

/** One player's complete turn. */
export async function runTurn(ctx: FlowContext, p: PlayerState): Promise<void> {
  ctx.turn = freshTurn();
  const { io } = ctx;
  await io.turnStart(p);
  checkpoint(ctx);
  // Before spinning: optionally use one item.
  for (let guard = 0; guard < 6; guard++) {
    const usable = usableItems(ctx, p);
    const cpu = p.isCpu ? BoardAI.preRoll(ctx, p, usable) : undefined;
    const choice = await io.preRollChoice(p, usable, cpu);
    checkpoint(ctx);
    if (choice.kind === 'roll') break;
    if (!usable.includes(choice.item)) continue;
    if (await useItem(ctx, p, choice.item)) ctx.turn.itemUsed = true;
  }
  let result = ctx.rng.int(DIAL_MIN, DIAL_MAX);
  await io.spinDial(p, result, ctx.turn.bootsBonus);
  checkpoint(ctx);
  if (ItemManager.has(p, 'spring_bean')) {
    const cpu = p.isCpu ? BoardAI.wantsReroll(ctx, p, result) : undefined;
    if (await io.offerReroll(p, result, cpu)) {
      ItemManager.remove(p, 'spring_bean');
      p.stats.itemsUsed += 1;
      await io.item(p, 'spring_bean', 'use');
      result = ctx.rng.int(DIAL_MIN, DIAL_MAX);
      await io.spinDial(p, result, ctx.turn.bootsBonus);
    }
    checkpoint(ctx);
  }
  await move(ctx, p, result + ctx.turn.bootsBonus);
  await land(ctx, p);
  await io.turnEnd(p);
  checkpoint(ctx);
}
