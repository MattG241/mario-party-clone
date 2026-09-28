import { describe, expect, it } from 'vitest';
import { BoardGraph } from '../../src/game/board/BoardGraph';
import { runEvent } from '../../src/game/board/EventManager';
import { createFlowContext, HeadlessIO } from '../../src/game/board/HeadlessIO';
import { runMatch } from '../../src/game/board/TurnManager';
import { findBoard } from '../../src/game/data/boards';
import { createMatch } from '../../src/game/state/MatchState';
import { Random } from '../../src/game/util/Random';
import { BOUT_PURSE, boutFlurries, derangement, pickChallenger, TRAINING_ODDS, TRAINING_PAY, trainingStreak } from '../../src/game/worlds/dojo/rules';
import { CONFIG, FOUR } from './fixtures';

const board = findBoard('dojo')!;
const graph = new BoardGraph(board);

function setup(seed = 7) {
  const state = createMatch({ ...CONFIG, boardId: 'dojo', seed }, FOUR, board);
  const io = new HeadlessIO({ seed });
  return { state, io, ctx: createFlowContext(state, graph, io) };
}

describe('dojo rules', () => {
  it('pays a training streak rep by rep until the first slip', () => {
    const rng = new Random(11);
    let perfect = 0;
    let total = 0;
    for (let i = 0; i < 4000; i++) {
      const { reps, coins } = trainingStreak(rng);
      expect(reps).toBeGreaterThanOrEqual(0);
      expect(reps).toBeLessThanOrEqual(TRAINING_ODDS.length);
      expect(coins).toBe(TRAINING_PAY.slice(0, reps).reduce((a, b) => a + b, 0));
      if (reps === TRAINING_ODDS.length) perfect++;
      total += coins;
    }
    // A perfect streak is rare but real; a montage pays about as much as a lucky festival space.
    expect(perfect).toBeGreaterThan(40);
    expect(perfect).toBeLessThan(400);
    expect(total / 4000).toBeGreaterThan(4);
    expect(total / 4000).toBeLessThan(7);
  });

  it('settles a bout by the bigger flurry, with one sudden-death exchange on a tie', () => {
    const rng = new Random(3);
    for (let i = 0; i < 500; i++) {
      const f = boutFlurries(rng);
      expect(f.a).toBeGreaterThanOrEqual(1);
      expect(f.a).toBeLessThanOrEqual(13);
      expect(f.winner).toBe(f.a > f.b ? 'a' : f.b > f.a ? 'b' : 'draw');
    }
  });

  it('has a CPU challenge the richest rival', () => {
    expect(pickChallenger([{ slot: 1, chips: 4 }, { slot: 2, chips: 12 }, { slot: 3, chips: 12 }]).slot).toBe(2);
  });

  it('shuffles the smoke bomb so nobody keeps their place', () => {
    const rng = new Random(5);
    for (const n of [2, 3, 4]) {
      for (let i = 0; i < 200; i++) {
        const d = derangement(n, rng);
        expect([...d].sort()).toEqual(Array.from({ length: n }, (_, k) => k));
        d.forEach((v, k) => expect(v).not.toBe(k));
      }
    }
    expect(derangement(1, rng)).toEqual([0]);
  });
});

describe('dojo events', () => {
  it('swaps every player in a smoke bomb', async () => {
    const { state, ctx } = setup();
    const spots = ['v0', 'd2', 't1', 'h3'];
    state.players.forEach((p, i) => (p.nodeId = spots[i]));
    await runEvent(ctx, 'dojo_smoke', state.players[0]);
    const after = state.players.map((p) => p.nodeId);
    expect([...after].sort()).toEqual([...spots].sort());
    after.forEach((id, i) => expect(id).not.toBe(spots[i]));
  });

  it('moves the purse from the loser to the winner of a bout (or tips both on a draw)', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { state, ctx } = setup(seed);
      state.players.forEach((p) => (p.chips = 10));
      const p = state.players[0];
      p.nodeId = 't2';
      await runEvent(ctx, 'dojo_bout', p);
      const deltas = state.players.map((pl) => pl.chips - 10);
      const changed = deltas.filter((d) => d !== 0);
      if (changed.length === 2 && changed[0] === 2 && changed[1] === 2) continue; // a draw
      expect(changed.sort((a, b) => a - b)).toEqual([-BOUT_PURSE, BOUT_PURSE]);
    }
  });

  it('pays at least a coin for training, at the falls or the boulders', async () => {
    for (const at of ['f2', 'g2']) {
      const { state, ctx } = setup();
      const p = state.players[1];
      p.nodeId = at;
      const before = p.chips;
      await runEvent(ctx, 'dojo_training', p);
      expect(p.chips).toBeGreaterThan(before);
    }
  });

  it('breaks the rope bridge and opens the Cloud Steps', async () => {
    const { state, ctx } = setup();
    state.players[0].nodeId = 'b1';
    await runEvent(ctx, 'bridge_break', state.players[2]);
    expect(state.board.bridgeBroken).not.toBeNull();
    expect(state.players[0].nodeId).toBe('bd1');
    expect(graph.usableExits('d5', state.board, false).map((e) => e.to)).toEqual(['bd0']);
  });
});

describe('dojo matches', () => {
  it('plays whole CPU matches to the end on every route', async () => {
    const seen = new Set<string>();
    for (const seed of [1, 21, 99, 2024]) {
      const { state, io, ctx } = setup(seed);
      state.config.rounds = 12;
      await runMatch(ctx);
      expect(io.finished).toBe(true);
      for (const p of state.players) expect(graph.has(p.nodeId)).toBe(true);
      for (const e of io.events) seen.add(e);
    }
    // The board's own events come up in normal play.
    expect([...seen].some((e) => e.startsWith('dojo_'))).toBe(true);
  });
});
