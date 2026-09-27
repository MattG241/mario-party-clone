import { describe, expect, it } from 'vitest';
import { BoardGraph } from '../../src/game/board/BoardGraph';
import { runEvent, BOARD_EVENTS } from '../../src/game/board/EventManager';
import { FlowInterrupt, freshTurn, type FlowContext } from '../../src/game/board/flowTypes';
import { createFlowContext, HeadlessIO } from '../../src/game/board/HeadlessIO';
import { applyMinigameRewards, expireRoundEffects, phaseAfterMinigame, phaseAfterTurn, runMatch } from '../../src/game/board/TurnManager';
import { giveItem, offerRelic, relocateRelic, runTurn } from '../../src/game/board/TurnFlow';
import { SUNCOIL } from '../../src/game/data/boards';
import { createMatch, deserializeMatch, type MatchState } from '../../src/game/state/MatchState';
import { CONFIG, FOUR } from './fixtures';

const graph = new BoardGraph(SUNCOIL);
const nodeIds = new Set(SUNCOIL.nodes.map((n) => n.id));

function setup(seed = 424242, over: Partial<typeof CONFIG> = {}): { ctx: FlowContext; io: HeadlessIO; state: MatchState } {
  const state = createMatch({ ...CONFIG, seed, ...over }, FOUR, SUNCOIL);
  const io = new HeadlessIO({ seed });
  const ctx = createFlowContext(state, graph, io);
  return { ctx, io, state };
}

function validate(state: MatchState): void {
  for (const p of state.players) {
    expect(nodeIds.has(p.nodeId), `${p.name} on a real node`).toBe(true);
    expect(p.chips).toBeGreaterThanOrEqual(0);
    expect(p.items.length).toBeLessThanOrEqual(3);
    expect(Number.isInteger(p.chips)).toBe(true);
  }
  expect(SUNCOIL.relicGates).toContain(state.board.relicGate);
}

describe('turn order and round advancement', () => {
  it('advances through every player then to the minigame', () => {
    const { state } = setup();
    expect(phaseAfterTurn(state, 0)).toEqual({ kind: 'turn', index: 1 });
    expect(phaseAfterTurn(state, 3)).toEqual({ kind: 'minigame' });
  });

  it('moves to the next round after the minigame, then to bonuses after the last round', () => {
    const { state } = setup();
    expect(phaseAfterMinigame(state)).toEqual({ phase: { kind: 'roundStart' }, round: 2 });
    state.round = state.config.rounds;
    expect(phaseAfterMinigame(state).phase).toEqual({ kind: 'bonus' });
  });

  it('expires timed board effects', () => {
    const { state } = setup();
    state.round = 5;
    state.board.surge = { nodes: ['p1'], untilRound: 4 };
    state.board.relicPrice = { price: 15, untilRound: 5 };
    state.board.bridgeBroken = { untilRound: 4 };
    const r = expireRoundEffects(state);
    expect(state.board.surge).toBeNull();
    expect(state.board.relicPrice).not.toBeNull();
    expect(r.bridgeRepaired).toBe(true);
  });
});

describe('CPU turns', () => {
  it('completes a CPU turn and keeps the state valid', async () => {
    const { ctx, state } = setup();
    for (let i = 0; i < 4; i++) {
      await runTurn(ctx, state.players[i]);
      validate(state);
    }
    expect(state.players.some((p) => p.nodeId !== 'p0')).toBe(true);
    expect(state.players.every((p) => p.stats.spacesMoved > 0)).toBe(true);
  });

  it('completes many CPU turns across different seeds without getting stuck', async () => {
    for (const seed of [1, 2, 3, 99, 2024, 777777]) {
      const { ctx, state } = setup(seed);
      for (let t = 0; t < 40; t++) {
        const p = state.players[t % 4];
        state.round = 1 + Math.floor(t / 4);
        await runTurn(ctx, p);
        validate(state);
      }
    }
  });
});

describe('economy', () => {
  it('pays Gleam Spaces 3 chips (5 in the final round)', async () => {
    const { ctx, state } = setup();
    const p = state.players[0];
    // Land exactly on p1 (a gleam space) by starting one step before it.
    p.nodeId = 'p0';
    const io = ctx.io as HeadlessIO;
    const land = async (final: boolean) => {
      state.round = final ? state.config.rounds : 1;
      const before = p.chips;
      p.nodeId = 'd6';
      // Force a roll of exactly 2 → p0 → p1.
      ctx.rng.int = () => 2;
      await runTurn(ctx, p);
      return p.chips - before;
    };
    expect(await land(false)).toBe(3);
    expect(await land(true)).toBe(5);
    void io;
  });

  it('buys a Prism Relic for 20 chips and relocates the Relic Keeper', async () => {
    const { ctx, state } = setup();
    const p = state.players[1];
    p.chips = 26;
    p.nodeId = state.board.relicGate;
    const oldGate = state.board.relicGate;
    await offerRelic(ctx, p);
    expect(p.relics).toBe(1);
    expect(p.chips).toBe(6);
    expect(p.stats.chipsSpent).toBe(20);
    expect(state.board.relicGate).not.toBe(oldGate);
    expect(SUNCOIL.relicGates).toContain(state.board.relicGate);
  });

  it('refuses the relic when the player cannot afford it', async () => {
    const { ctx, state } = setup();
    const p = state.players[1];
    p.chips = 19;
    await offerRelic(ctx, p);
    expect(p.relics).toBe(0);
    expect(p.chips).toBe(19);
  });

  it('relocates the relic to a different gate every time', async () => {
    const { ctx, state } = setup();
    for (let i = 0; i < 30; i++) {
      const before = state.board.relicGate;
      await relocateRelic(ctx, state.players[i % 4]);
      expect(state.board.relicGate).not.toBe(before);
    }
  });

  it('applies minigame rewards and counts wins', () => {
    const { state } = setup();
    const rewards = applyMinigameRewards(state, [
      { slot: 2, place: 1 },
      { slot: 0, place: 2 },
      { slot: 1, place: 3 },
      { slot: 3, place: 4 },
    ]);
    expect(rewards.map((r) => r.chips)).toEqual([10, 6, 3, 1]);
    expect(state.players[2].chips).toBe(20);
    expect(state.players[2].stats.minigameWins).toBe(1);
    expect(state.players[3].chips).toBe(11);
  });
});

describe('items in play', () => {
  it('asks what to drop when receiving a fourth item', async () => {
    const { ctx, state } = setup();
    const p = state.players[0];
    p.items = ['spring_bean', 'warp_charm', 'magnet_glove'];
    await giveItem(ctx, p, 'prism_key');
    expect(p.items).toHaveLength(3);
    // The CPU drops its least valuable item (the Spring Bean).
    expect(p.items).toContain('prism_key');
    expect(p.items).not.toContain('spring_bean');
  });

  it('adds +3 to the move with Wingstep Boots', async () => {
    const { ctx, state } = setup();
    const p = state.players[0];
    p.items = ['wingstep_boots'];
    p.nodeId = 'p0';
    ctx.rng.int = () => 1;
    // Make the CPU always use the boots.
    ctx.state.players[0].cpuLevel = 'hard';
    const io = ctx.io as HeadlessIO;
    io.preRollChoice = async (_p, usable) => (usable.includes('wingstep_boots') ? { kind: 'item', item: 'wingstep_boots' } : { kind: 'roll' });
    await runTurn(ctx, p);
    expect(p.items).toEqual([]);
    expect(p.stats.spacesMoved).toBeGreaterThanOrEqual(4);
    expect(p.stats.itemsUsed).toBe(1);
  });

  it('blocks a mishap with a Bubble Shield', async () => {
    const { ctx, state } = setup();
    const p = state.players[0];
    p.shielded = true;
    p.chips = 10;
    await runEvent(ctx, 'leaky_pouch', p);
    expect(p.chips).toBe(10);
    expect(p.shielded).toBe(false);
  });

  it('springs a rival snare trap for 5 chips', async () => {
    const { ctx, state } = setup();
    const [owner, victim] = state.players;
    state.board.traps.push({ nodeId: 'p1', owner: owner.slot });
    victim.nodeId = 'p0';
    const ownerBefore = owner.chips;
    ctx.rng.int = () => 1;
    await runTurn(ctx, victim);
    expect(state.board.traps).toHaveLength(0);
    expect(owner.chips).toBe(ownerBefore + 5);
  });
});

describe('board events', () => {
  it('defines at least 12 distinct events and runs each without errors', async () => {
    expect(BOARD_EVENTS.length).toBeGreaterThanOrEqual(12);
    for (const def of BOARD_EVENTS) {
      const { ctx, state } = setup(31);
      ctx.turn = freshTurn();
      const p = state.players[0];
      p.nodeId = 'd3';
      p.chips = 12;
      await runEvent(ctx, def.id, p);
      validate(state);
    }
  });

  it('breaks the bridge, drops walkers onto the detour, and repairs later', async () => {
    const { ctx, state } = setup();
    state.players[2].nodeId = 'b1';
    await runEvent(ctx, 'bridge_break', state.players[0]);
    expect(state.board.bridgeBroken).not.toBeNull();
    expect(state.players[2].nodeId).toBe('bd1');
    expect(graph.usableExits('c5', state.board, false).map((e) => e.to)).toEqual(['bd0']);
    await runEvent(ctx, 'bridge_repair', null);
    expect(state.board.bridgeBroken).toBeNull();
  });

  it('reshuffles portals during a Portal Storm', async () => {
    const { ctx, state } = setup();
    const before = JSON.stringify(state.board.portalLinks);
    await runEvent(ctx, 'portal_storm', null);
    expect(JSON.stringify(state.board.portalLinks)).not.toBe(before);
    for (const [a, b] of Object.entries(state.board.portalLinks)) expect(state.board.portalLinks[b]).toBe(a);
  });

  it('gives everyone 5 chips in the Festival Parade', async () => {
    const { ctx, state } = setup();
    await runEvent(ctx, 'festival_parade', null);
    expect(state.players.every((p) => p.chips === 15)).toBe(true);
  });

  it('swaps two players in a Swap Spiral', async () => {
    const { ctx, state } = setup();
    const [a] = state.players;
    a.nodeId = 'g1';
    state.players[1].nodeId = 't3';
    state.players[2].nodeId = 't3';
    state.players[3].nodeId = 't3';
    await runEvent(ctx, 'swap_spiral', a);
    expect(a.nodeId).toBe('t3');
    expect(state.players.filter((p) => p.nodeId === 'g1')).toHaveLength(1);
  });
});

describe('full match simulation', () => {
  it('plays a 10-round, four-CPU match to a final result', async () => {
    const { ctx, io, state } = setup(8080);
    await runMatch(ctx);
    expect(io.finished).toBe(true);
    expect(state.phase).toEqual({ kind: 'over' });
    expect(io.minigames).toBe(10);
    expect(state.round).toBe(10);
    expect(io.awards).toHaveLength(3);
    const totalBought = state.players.reduce((s, p) => s + p.stats.relicsBought, 0);
    const totalBonus = io.awards.reduce((s, a) => s + a.winners.length, 0);
    expect(state.players.reduce((s, p) => s + p.relics, 0)).toBe(totalBought + totalBonus);
    validate(state);
    expect(io.saves).toBeGreaterThan(10);
  });

  it('plays chaotic 15-round matches on several seeds', async () => {
    for (const seed of [5, 6, 7]) {
      const { ctx, io } = setup(seed, { rounds: 15, events: 'chaotic' });
      await runMatch(ctx);
      expect(io.finished).toBe(true);
      expect(io.minigames).toBe(15);
    }
  });

  it('resumes a saved match mid-round and finishes it', async () => {
    const { ctx, io, state } = setup(9090);
    // Play the first few turns only.
    const inner = io.playMinigame.bind(io);
    let stopped = false;
    io.playMinigame = async () => {
      if (!stopped) {
        stopped = true;
        throw new Error('stop');
      }
      return inner();
    };
    await expect(runMatch(ctx)).rejects.toThrow('stop');
    const saved = io.lastSave;
    const restored = deserializeMatch(saved, nodeIds)!;
    expect(restored.phase).toEqual({ kind: 'minigame' });
    const io2 = new HeadlessIO({ seed: 1 });
    const ctx2 = createFlowContext(restored, graph, io2);
    await runMatch(ctx2);
    expect(io2.finished).toBe(true);
    expect(restored.round).toBe(state.config.rounds);
  });

  it('honours debug interrupts (skip turn)', async () => {
    const { ctx, state } = setup();
    ctx.interrupt = 'skipTurn';
    await expect(runTurn(ctx, state.players[0])).rejects.toBeInstanceOf(FlowInterrupt);
  });
});
