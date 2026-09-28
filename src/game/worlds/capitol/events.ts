// Capitol Gardens' own board events: a garden parade that marches everyone along, a wish at the
// mansion fountain, and a garden party that shares everyone's coins out evenly.
import { ECONOMY } from '../../constants';
import { checkpoint, type DialogLineSpec, type EventPresentation, type FlowContext } from '../../board/flowTypes';
import { ITEMS } from '../../data/items';
import { ItemManager } from '../../items/ItemManager';
import type { BoardEventDef } from '../types';
import { partyShares, WISH_COST, wishOutcome } from './rules';

// TurnFlow's helpers load lazily: TurnFlow imports the EventManager, which gathers these events when
// it loads, so a static import here could start that cycle from the wrong end (e.g. in unit tests).
const turnFlow = () => import('../../board/TurnFlow');

function present(ctx: FlowContext, def: BoardEventDef, lines: DialogLineSpec[], extra: Partial<EventPresentation> = {}): Promise<void> {
  return ctx.io.event({ id: def.id, title: def.title, kind: def.kind === 'global' ? 'global' : def.kind, lines, ...extra }).then(() => checkpoint(ctx));
}

/** Chaotic events pay half as much again. */
const scale = (ctx: FlowContext, n: number) => Math.round(n * (ctx.state.config.events === 'chaotic' ? 1.5 : 1));
const coins = (n: number) => `${n} coin${n === 1 ? '' : 's'}`;

const parade: BoardEventDef = {
  id: 'capitol_parade',
  title: 'GARDEN PARADE',
  kind: 'board',
  boards: ['capitol'],
  summary: 'A marching band sweeps through the gardens: everyone marches 2 spaces forward, and whoever started it leads the way with 3 coins.',
  async run(ctx, p) {
    const { gainChips, pushForward } = await turnFlow();
    await present(ctx, this, [{ npc: 'mimi', pose: 'laugh', text: 'A garden parade! Drums, horns and pennants: everybody fall in and march!' }], { fx: 'parade' });
    if (p) {
      await ctx.io.say([{ npc: 'mimi', pose: 'happy', text: `${p.name} leads the parade! Here are ${coins(scale(ctx, 3))} for the grand marshal.` }], p);
      checkpoint(ctx);
      await gainChips(ctx, p, scale(ctx, 3), 'parade');
    }
    for (const pl of ctx.state.players) await pushForward(ctx, pl, 2);
  },
};

const wish: BoardEventDef = {
  id: 'capitol_wish',
  title: 'FOUNTAIN WISH',
  kind: 'board',
  boards: ['capitol'],
  summary: 'Toss 2 coins into the mansion fountain and make a wish: a coin shower, an item, a Star Coin bargain… or a splash.',
  async run(ctx, p) {
    if (!p) return;
    const { gainChips, giveItem, spendChips } = await turnFlow();
    if (p.chips < WISH_COST) {
      await present(ctx, this, [{ npc: 'pipper', pose: 'happy', text: 'Not a coin to toss? The fountain splashes you a lucky one anyway!' }], { fx: 'wish', player: p });
      await gainChips(ctx, p, 1, 'wish');
      return;
    }
    await present(ctx, this, [{ npc: 'pipper', pose: 'coin', text: `In go ${coins(WISH_COST)}… Make a wish! Let's see what the fountain bubbles up.` }], { fx: 'wish', player: p });
    await spendChips(ctx, p, WISH_COST, 'wish');
    let outcome = wishOutcome(ctx.rng.next());
    if (outcome === 'bargain' && ctx.board.relicPrice) outcome = 'shower';
    const say = (text: string, pose = 'happy') => ctx.io.say([{ npc: 'pipper', pose, text }], p).then(() => checkpoint(ctx));
    switch (outcome) {
      case 'shower': {
        const n = scale(ctx, ctx.rng.int(7, 10));
        await say(`Wish granted: a shower of coins! ${coins(n)}!`, 'coin');
        await gainChips(ctx, p, n, 'wish');
        break;
      }
      case 'item': {
        const item = ItemManager.randomItem(ctx.rng);
        await say(`Wish granted: a ${ITEMS[item].name} floats up out of the fountain!`, 'gift');
        await giveItem(ctx, p, item);
        break;
      }
      case 'bargain': {
        ctx.board.relicPrice = { price: ECONOMY.relicRushPrice, untilRound: ctx.state.round + 1 };
        await say(`Wish granted: Star Coins cost just ${ECONOMY.relicRushPrice} coins until the end of next round, for everyone!`, 'point');
        ctx.io.boardChanged();
        break;
      }
      default: {
        await say('SPLASH! The fountain sneezes your coins right back, plus one for luck.', 'wave');
        await gainChips(ctx, p, WISH_COST + 1, 'wish');
      }
    }
  },
};

const party: BoardEventDef = {
  id: 'capitol_party',
  title: 'GARDEN PARTY',
  kind: 'board',
  boards: ['capitol'],
  summary: 'A garden party: everyone brings a third of their coins to the picnic, the pot is shared out evenly, and the host gets 2 coins more.',
  async run(ctx, p) {
    const { gainChips, loseChips } = await turnFlow();
    const players = ctx.state.players;
    await present(ctx, this, [{ npc: 'packsprout', pose: 'gift', text: 'Garden party on the lawn! Everyone brings a third of their coins to the picnic…' }], { fx: 'lanterns', focus: p?.nodeId });
    const { pot, share, deltas } = partyShares(
      players.map((pl) => pl.chips),
      p ? players.indexOf(p) : 0,
    );
    await ctx.io.say([{ npc: 'packsprout', pose: 'cheer', text: pot > 0 ? `…${coins(pot)} in the pot, shared out evenly: ${coins(share)} each!` : '…nobody brought a thing! Never mind: the lemonade is free.' }]);
    checkpoint(ctx);
    for (let i = 0; i < players.length; i++) if (deltas[i] < 0) await loseChips(ctx, players[i], -deltas[i], 'party');
    for (let i = 0; i < players.length; i++) if (deltas[i] > 0) await gainChips(ctx, players[i], deltas[i], 'party');
    if (p) await gainChips(ctx, p, 2, 'party');
  },
};

/** Board events unique to the capitol board. */
export const CAPITOL_EVENTS: BoardEventDef[] = [parade, wish, party];
