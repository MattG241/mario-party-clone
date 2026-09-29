import { describe, expect, it } from 'vitest';
import { BoardGraph } from '../../src/game/board/BoardGraph';
import { createFlowContext, HeadlessIO } from '../../src/game/board/HeadlessIO';
import { runMatch } from '../../src/game/board/TurnManager';
import type { BoardDef } from '../../src/game/board/types';
import { findBoard } from '../../src/game/data/boards';
import { createMatch } from '../../src/game/state/MatchState';
import { CONFIG, FOUR } from './fixtures';

/** Star Coins bought per 15-round, four-CPU match on a board (seeded, so deterministic). */
async function starCoinRate(board: BoardDef, matches = 24): Promise<number> {
  const graph = new BoardGraph(board);
  let bought = 0;
  for (let seed = 1; seed <= matches; seed++) {
    const state = createMatch({ ...CONFIG, boardId: board.id, seed: seed * 7919, rounds: 15 }, FOUR, board);
    await runMatch(createFlowContext(state, graph, new HeadlessIO({ seed })));
    bought += state.players.reduce((a, p) => a + p.stats.relicsBought, 0);
  }
  return bought / matches;
}

// The Star Keeper's pace is part of the festival's feel: a world board should hand out Star Coins at
// about Suncoil's rate. (One Star Coin spot behind a key gate is what holds that pace: without it the
// Keeper is always in reach and matches see two to three times as many.)
describe('world board pacing', () => {
  it('buys Star Coins at about Suncoil’s rate on Dojo Summit and Capitol Gardens', async () => {
    const base = await starCoinRate(findBoard('suncoil')!);
    for (const id of ['dojo', 'capitol']) {
      const r = await starCoinRate(findBoard(id)!);
      expect(r, `${id}: ${r.toFixed(2)} vs suncoil ${base.toFixed(2)}`).toBeGreaterThan(base * 0.6);
      expect(r, `${id}: ${r.toFixed(2)} vs suncoil ${base.toFixed(2)}`).toBeLessThan(base * 1.6);
    }
  }, 120000);
});
