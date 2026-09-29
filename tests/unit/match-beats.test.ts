import { describe, expect, it } from 'vitest';
import { BoardGraph } from '../../src/game/board/BoardGraph';
import { createFlowContext, HeadlessIO } from '../../src/game/board/HeadlessIO';
import { finalStretch, isFinalStretchStart, rollTurnOrder, STRETCH_BOOST, STRETCH_SALE_PRICE } from '../../src/game/board/MatchBeats';
import { SUNCOIL } from './suncoilBoard';
import { createMatch, currentRelicPrice } from '../../src/game/state/MatchState';
import { CONFIG, FOUR } from './fixtures';

const graph = new BoardGraph(SUNCOIL);

function setup(seed: number) {
  const state = createMatch({ ...CONFIG, seed }, FOUR, SUNCOIL);
  const io = new HeadlessIO({ seed });
  return { state, io, ctx: createFlowContext(state, graph, io) };
}

describe('who goes first', () => {
  it('reorders the players by their spins, keeps every slot and only happens once', async () => {
    for (const seed of [1, 2, 3, 99]) {
      const { state, ctx } = setup(seed);
      const slots = state.players.map((p) => p.slot).sort();
      await rollTurnOrder(ctx);
      expect(state.orderRolled).toBe(true);
      expect(state.players.map((p) => p.slot).sort()).toEqual(slots);
    }
  });

  it('gives different seeds different orders (it is not always slot order)', async () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const { state, ctx } = setup(seed);
      await rollTurnOrder(ctx);
      orders.add(state.players.map((p) => p.slot).join(''));
    }
    expect(orders.size).toBeGreaterThan(3);
  });
});

describe('final stretch', () => {
  it('starts three rounds from the end of matches of five rounds or more', () => {
    const { state } = setup(5);
    state.config.rounds = 10;
    state.round = 8;
    expect(isFinalStretchStart(state)).toBe(true);
    state.round = 7;
    expect(isFinalStretchStart(state)).toBe(false);
    state.config.rounds = 4;
    state.round = 2;
    expect(isFinalStretchStart(state)).toBe(false);
  });

  it('boosts the player in last place and applies one twist to the end', async () => {
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const { state, ctx, io } = setup(seed);
      state.config.rounds = 10;
      state.round = 8;
      // Everyone but one player is ahead on Star Coins.
      state.players.forEach((p, i) => ((p.relics = i === 0 ? 0 : 2), (p.chips = 10)));
      const last = state.players[0];
      const surgeBefore = state.board.surge;
      await finalStretch(ctx);
      expect(state.stretchDone).toBe(true);
      expect(isFinalStretchStart(state)).toBe(false);
      expect(io.events).toContain('headline:FINAL STRETCH!');
      expect(last.chips).toBe(10 + STRETCH_BOOST);
      const sale = currentRelicPrice(state) === STRETCH_SALE_PRICE && state.board.relicPrice?.untilRound === 10;
      const surge = state.board.surge !== surgeBefore && state.board.surge?.untilRound === 10;
      const gift = last.items.length > 0;
      expect([sale, surge, gift].filter(Boolean)).toHaveLength(1);
    }
  });
});
