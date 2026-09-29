import { DIAL_MAX, DIAL_MIN } from '../constants';
import { ITEM_IDS } from '../data/items';
import type { MatchState, PlayerState } from '../state/MatchState';
import { computeStandings } from '../state/scoring';
import { checkpoint, type FlowContext } from './flowTypes';
import { gainChips, giveItem } from './TurnFlow';

// The party-game staples around the turns: drawing lots for the turn order, the final-stretch
// shake-up three rounds from the end, and hidden blocks on ordinary spaces.

/** Chance that landing on a Gleam, Festival or Mischief space turns up a hidden block. */
export const HIDDEN_BLOCK_CHANCE = 0.03;
/** Share of hidden blocks that hold a Star Coin rather than coins. */
export const HIDDEN_STAR_SHARE = 0.2;
export const HIDDEN_COINS = 10;
/** Coins the player in last place gets when the final stretch begins. */
export const STRETCH_BOOST = 10;
export const STRETCH_SALE_PRICE = 15;

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Who goes first: before the first turn everyone spins the Orbit Dial (different numbers, like
 * drawing lots) and plays in order from the highest spin down. Runs once per match.
 */
export async function rollTurnOrder(ctx: FlowContext): Promise<void> {
  const { state: s, io, rng } = ctx;
  s.orderRolled = true;
  if (s.players.length < 2) return;
  await io.headline('WHO GOES FIRST?', 'EVERYONE HITS THE DICE BLOCK');
  const lots = rng.shuffle(Array.from({ length: DIAL_MAX - DIAL_MIN + 1 }, (_, i) => DIAL_MIN + i));
  const spin = new Map<number, number>();
  for (const [i, p] of s.players.entries()) {
    spin.set(p.slot, lots[i]);
    await io.spinDial(p, lots[i], 0);
    checkpoint(ctx);
  }
  s.players.sort((a, b) => spin.get(b.slot)! - spin.get(a.slot)!);
  const [first, ...rest] = s.players.map((p) => p.name);
  await io.say([{ npc: 'ora', pose: 'flag', text: `${first} rolled highest and goes first! Then ${listNames(rest)}.` }]);
  await io.orderDecided(s.players);
  io.boardChanged();
}

/** The final stretch starts three rounds from the end (matches of five rounds or more). */
export function isFinalStretchStart(s: MatchState): boolean {
  return s.config.rounds >= 5 && s.round === s.config.rounds - 2 && !s.stretchDone;
}

type Twist = 'sale' | 'surge' | 'gift';

/**
 * Three rounds to go: Ora checks the standings, the player in last place gets a boost, and the
 * party wheel picks a twist that lasts to the end: a Star Coin sale, every Blue Space paying
 * double, or a gift for the trailing player.
 */
export async function finalStretch(ctx: FlowContext): Promise<void> {
  const { state: s, io, rng } = ctx;
  s.stretchDone = true;
  await io.headline('FINAL STRETCH!', '3 ROUNDS TO GO');
  const standings = computeStandings(s.players);
  const worst = Math.max(...standings.map((x) => x.place));
  const lastSlot = rng.pick(standings.filter((x) => x.place === worst).map((x) => x.slot));
  const last = s.players.find((p) => p.slot === lastSlot) as PlayerState;
  await io.say([
    { npc: 'ora', pose: 'flag', text: "Only three rounds left, and it's still anyone's party!" },
    { npc: 'ora', pose: 'cheer', text: `${last.name}, you're trailing, so here's a boost to catch up!` },
  ]);
  await gainChips(ctx, last, STRETCH_BOOST, 'stretch');
  const twist = rng.pick<Twist>(['sale', 'surge', 'gift']);
  const until = s.config.rounds;
  if (twist === 'sale') {
    s.board.relicPrice = { price: STRETCH_SALE_PRICE, untilRound: until };
    await io.say([{ npc: 'packsprout', pose: 'cheer', text: `The party wheel says… STAR COIN SALE! Just ${STRETCH_SALE_PRICE} coins each until the very end!` }]);
  } else if (twist === 'surge') {
    s.board.surge = { nodes: ctx.graph.nodesOfType('gleam').map((n) => n.id), untilRound: until };
    await io.say([{ npc: 'wrench', pose: 'gadget', text: 'The party wheel says… COIN SURGE! Every Blue Space pays double from now on!' }]);
  } else {
    await io.say([{ npc: 'packsprout', pose: 'gift', text: `The party wheel says… MYSTERY GIFT! ${last.name}, this one's for you too!` }], last);
    await giveItem(ctx, last, rng.pick(ITEM_IDS));
  }
  io.boardChanged();
}

/**
 * A hidden block on an ordinary space: now and then landing turns one up over the player's head,
 * usually holding coins and once in a while a Star Coin.
 */
export async function maybeHiddenBlock(ctx: FlowContext, p: PlayerState, spaceType: string): Promise<void> {
  if (spaceType !== 'gleam' && spaceType !== 'festival' && spaceType !== 'mischief') return;
  if (!ctx.rng.chance(HIDDEN_BLOCK_CHANCE)) return;
  const star = ctx.rng.chance(HIDDEN_STAR_SHARE);
  await ctx.io.hiddenBlock(p, star ? 'star' : 'coins');
  checkpoint(ctx);
  if (star) {
    p.relics += 1;
    await ctx.io.relicGained(p, 'hidden');
  } else {
    await gainChips(ctx, p, HIDDEN_COINS, 'hidden');
  }
}
