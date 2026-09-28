import { describe, expect, it } from 'vitest';
import { BoardGraph } from '../../src/game/board/BoardGraph';
import { runEvent } from '../../src/game/board/EventManager';
import { createFlowContext, HeadlessIO } from '../../src/game/board/HeadlessIO';
import { runMatch } from '../../src/game/board/TurnManager';
import { findBoard } from '../../src/game/data/boards';
import { createMatch } from '../../src/game/state/MatchState';
import { partyShares, WISH_COST, wishOutcome } from '../../src/game/worlds/capitol/rules';
import { CONFIG, FOUR } from './fixtures';

const board = findBoard('capitol')!;
const graph = new BoardGraph(board);

function setup(seed = 7) {
  const state = createMatch({ ...CONFIG, boardId: 'capitol', seed }, FOUR, board);
  const io = new HeadlessIO({ seed });
  return { state, io, ctx: createFlowContext(state, graph, io) };
}

describe('capitol rules', () => {
  it('maps a wish roll onto the fountain outcomes', () => {
    expect(wishOutcome(0)).toBe('shower');
    expect(wishOutcome(0.39)).toBe('shower');
    expect(wishOutcome(0.4)).toBe('item');
    expect(wishOutcome(0.7)).toBe('bargain');
    expect(wishOutcome(0.9)).toBe('splash');
    expect(wishOutcome(0.999)).toBe('splash');
  });

  it('shares the garden party pot evenly, the odd coins staying with the host', () => {
    const r = partyShares([23, 14, 31, 9], 1);
    expect(r.pot).toBe(7 + 4 + 10 + 3);
    expect(r.share).toBe(6);
    expect(r.deltas).toEqual([-1, 2, -4, 3]);
    const odd = partyShares([10, 0, 0], 2);
    expect(odd.pot).toBe(3);
    expect(odd.deltas).toEqual([-2, 1, 1]);
    for (const chips of [[0, 0], [5, 50, 7, 1], [100, 3, 3]]) {
      const { deltas } = partyShares(chips, 0);
      expect(deltas.reduce((a, b) => a + b, 0)).toBe(0);
      deltas.forEach((d, i) => expect(chips[i] + d).toBeGreaterThanOrEqual(0));
    }
  });

  it('mirrors the basketball court and the putting green', () => {
    const at = (id: string) => graph.node(id);
    for (const [court, green] of [['k0', 'g2'], ['k1', 'g1'], ['k2', 'g0']]) {
      expect(at(court).type).toBe(at(green).type);
      expect(Math.abs(at(court).x + at(green).x - 3600)).toBeLessThanOrEqual(10);
      expect(Math.abs(at(court).y - at(green).y)).toBeLessThanOrEqual(10);
    }
  });
});

describe('capitol events', () => {
  it('marches everyone two spaces in the garden parade', async () => {
    const { state, ctx } = setup();
    const spots = ['a2', 'k0', 'o1', 'p1'];
    state.players.forEach((p, i) => (p.nodeId = spots[i]));
    const moved = state.players.map((p) => p.stats.spacesMoved);
    const lead = state.players[0];
    const coins = lead.chips;
    await runEvent(ctx, 'capitol_parade', lead);
    state.players.forEach((p, i) => expect(p.stats.spacesMoved - moved[i]).toBe(2));
    expect(lead.chips).toBe(coins + 3);
  });

  it('takes the wish coins and grants a wish', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const { state, ctx } = setup(seed);
      const p = state.players[0];
      p.chips = 10;
      p.items = [];
      await runEvent(ctx, 'capitol_wish', p);
      expect(p.stats.chipsSpent).toBe(WISH_COST);
      const gotSomething = p.chips > 10 - WISH_COST || p.items.length > 0 || state.board.relicPrice !== null;
      expect(gotSomething).toBe(true);
    }
  });

  it('shares coins at the garden party and tips the host', async () => {
    const { state, ctx } = setup();
    [23, 14, 31, 9].forEach((c, i) => (state.players[i].chips = c));
    await runEvent(ctx, 'capitol_party', state.players[1]);
    expect(state.players.map((p) => p.chips)).toEqual([22, 14 + 2 + 2, 27, 12]);
  });
});

describe('capitol matches', () => {
  it('plays whole CPU matches to the end', async () => {
    const seen = new Set<string>();
    for (const seed of [1, 21, 99, 2024]) {
      const { state, io, ctx } = setup(seed);
      state.config.rounds = 12;
      await runMatch(ctx);
      expect(io.finished).toBe(true);
      for (const p of state.players) expect(graph.has(p.nodeId)).toBe(true);
      for (const e of io.events) seen.add(e);
    }
    expect([...seen].some((e) => e.startsWith('capitol_'))).toBe(true);
  });
});
