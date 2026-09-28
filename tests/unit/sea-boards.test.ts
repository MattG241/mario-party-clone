import { describe, expect, it } from 'vitest';
import { BoardGraph } from '../../src/game/board/BoardGraph';
import { eventDef, runEvent } from '../../src/game/board/EventManager';
import type { FlowContext } from '../../src/game/board/flowTypes';
import { createFlowContext, HeadlessIO } from '../../src/game/board/HeadlessIO';
import { runMatch } from '../../src/game/board/TurnManager';
import type { BoardDef } from '../../src/game/board/types';
import { createMatch, type MatchState, type PlayerState } from '../../src/game/state/MatchState';
import { PIRATES_BOARD, TREASURE_SPOT } from '../../src/game/worlds/pirates/board';
import { tideVictims, volleyTargets } from '../../src/game/worlds/pirates/rules';
import { TOONS_BOARD } from '../../src/game/worlds/toons/board';
import { DONUT_CALLER, DONUT_OTHERS, loopLanding, STING, swarmVictims } from '../../src/game/worlds/toons/rules';
import { CONFIG, FOUR } from './fixtures';

// Pirate Cove and Cartoon Coast: the seaside world boards (src/game/worlds/pirates, toons).
const PIRATES = PIRATES_BOARD as BoardDef;
const TOONS = TOONS_BOARD as BoardDef;

function setup(board: BoardDef, seed = 4242, over: Partial<typeof CONFIG> = {}): { ctx: FlowContext; io: HeadlessIO; state: MatchState; graph: BoardGraph } {
  const graph = new BoardGraph(board);
  const state = createMatch({ ...CONFIG, boardId: board.id, seed, ...over }, FOUR, board);
  const io = new HeadlessIO({ seed });
  return { ctx: createFlowContext(state, graph, io), io, state, graph };
}

/** Put players on spaces (and forget their trails) for an event test. */
function place(state: MatchState, at: string[]): PlayerState[] {
  state.players.forEach((p, i) => {
    p.nodeId = at[i] ?? at[0];
    p.trail = [];
    p.chips = 20;
    p.shielded = false;
  });
  return state.players;
}

describe.each([
  ['pirates', PIRATES],
  ['toons', TOONS],
] as const)('%s board layout', (id, board) => {
  const byId = new Map(board.nodes.map((n) => [n.id, n]));

  it('exists and plays in its own world', () => {
    expect(board).toBeTruthy();
    expect(board.id).toBe(id);
    expect(board.theme?.world).toBe(id);
    expect(board.nodes.length).toBeGreaterThanOrEqual(45);
    expect(board.nodes.length).toBeLessThanOrEqual(60);
  });

  it('names every area and signposts every fork', () => {
    for (const n of board.nodes) expect(n.metadata?.region, n.id).toBeTruthy();
    const forks = board.nodes.filter((n) => n.next.length > 1);
    expect(forks.length).toBeGreaterThanOrEqual(2);
    expect(forks.length).toBeLessThanOrEqual(4);
    for (const f of forks) expect(Object.keys(f.metadata?.signs ?? {}).sort(), f.id).toEqual([...f.next].sort());
  });

  it('keeps spaces a comfortable step apart', () => {
    for (const n of board.nodes) {
      for (const t of n.next) {
        const m = byId.get(t)!;
        const d = Math.hypot(m.x - n.x, m.y - n.y);
        expect(d, `${n.id} → ${t}`).toBeGreaterThanOrEqual(130);
        expect(d, `${n.id} → ${t}`).toBeLessThanOrEqual(230);
      }
    }
    for (const a of board.nodes) {
      for (const b of board.nodes) {
        if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(130);
      }
    }
  });

  it('only triggers its own events, which exist', () => {
    const spaces = board.nodes.filter((n) => n.type === 'event');
    expect(spaces.length).toBeGreaterThanOrEqual(3);
    for (const n of spaces) {
      const def = eventDef(n.eventId ?? '');
      expect(def, `${n.id}: ${n.eventId}`).toBeTruthy();
      expect(def!.boards).toEqual([id]);
    }
  });

  it("leaves out festival events that point at Suncoil's own spaces", () => {
    expect(board.theme?.skipEvents).toEqual(expect.arrayContaining(['crystal_surge', 'portal_storm']));
  });

  it('plays whole four-CPU matches, calm and chaotic', async () => {
    for (const [seed, events] of [
      [11, 'normal'],
      [12, 'chaotic'],
      [13, 'chaotic'],
    ] as const) {
      const { ctx, io, state } = setup(board, seed, { rounds: 12, events });
      await runMatch(ctx);
      expect(io.finished).toBe(true);
      for (const p of state.players) {
        expect(byId.has(p.nodeId)).toBe(true);
        expect(p.chips).toBeGreaterThanOrEqual(0);
      }
      expect(board.relicGates).toContain(state.board.relicGate);
    }
  });
});

describe('Pirate Cove events', () => {
  it('the cannon volley blasts rivals ahead of the galleon back, and only them', async () => {
    const { ctx, state, graph } = setup(PIRATES);
    const [gunner, ahead, far, shielded] = place(state, ['d2', 'c3', 'l1', 'd3']);
    shielded.shielded = true;
    expect(volleyTargets(graph, state.board, state.players, gunner).map((p) => p.slot).sort()).toEqual([ahead.slot, shielded.slot].sort());
    await runEvent(ctx, 'cove_cannon_volley', gunner);
    expect(graph.distance(ahead.nodeId, 'c3', state.board)).toBe(3);
    expect(far.nodeId).toBe('l1');
    expect(shielded.nodeId).toBe('d3');
    expect(shielded.shielded).toBe(false);
    expect(gunner.nodeId).toBe('d2');
  });

  it('with nobody in range, the crew pays the gunner instead', async () => {
    const { ctx, state } = setup(PIRATES);
    const [gunner, ...rest] = place(state, ['d2', 's0', 'l1', 'z0']);
    await runEvent(ctx, 'cove_cannon_volley', gunner);
    expect(gunner.chips).toBe(23);
    for (const p of rest) expect(p.chips).toBe(20);
  });

  it('the treasure map whisks its finder to the Treasure Cave with 6 to 10 coins', async () => {
    const { ctx, state } = setup(PIRATES);
    const [finder] = place(state, ['t1', 's0', 's0', 's0']);
    await runEvent(ctx, 'cove_treasure_map', finder);
    expect(finder.nodeId).toBe(TREASURE_SPOT);
    expect(finder.chips - 20).toBeGreaterThanOrEqual(6);
    expect(finder.chips - 20).toBeLessThanOrEqual(10);
  });

  it('high tide washes everyone on the shoreline back three spaces', async () => {
    const { ctx, state, graph } = setup(PIRATES);
    const [caller, beach, reef, inland] = place(state, ['b2', 'b4', 'f1', 'l2']);
    expect(tideVictims(graph, state.players, caller).map((p) => p.slot).sort()).toEqual([caller.slot, beach.slot, reef.slot].sort());
    await runEvent(ctx, 'cove_high_tide', caller);
    expect(caller.nodeId).toBe('s2');
    expect(beach.nodeId).toBe('b1');
    expect(['c3', 'e0', 'c4', 'c5']).toContain(reef.nodeId);
    expect(inland.nodeId).toBe('l2');
  });
});

describe('Cartoon Coast events', () => {
  it('the loop-the-loop flings its rider ahead along the trail with 3 coins', async () => {
    const { ctx, state, graph } = setup(TOONS);
    const [rider] = place(state, ['q1', 'w0', 'w0', 'w0']);
    expect(loopLanding(graph, state.board, 'q1', 6)).toBe('m3');
    await runEvent(ctx, 'coast_loop_launch', rider);
    expect(['m3', 'm4', 'm5', 'm6']).toContain(rider.nodeId);
    expect(rider.chips).toBe(23);
  });

  it('a jellyfish swarm stings everyone in the bay or on the pier', async () => {
    const { ctx, state, graph } = setup(TOONS);
    const [caller, pier, street, shielded] = place(state, ['y2', 'g2', 'm4', 'y4']);
    shielded.shielded = true;
    expect(swarmVictims(graph, state.players, caller).map((p) => p.slot).sort()).toEqual([caller.slot, pier.slot, shielded.slot].sort());
    await runEvent(ctx, 'coast_jellyfish', caller);
    expect(caller.chips).toBe(20 - STING);
    expect(pier.chips).toBe(20 - STING);
    expect(street.chips).toBe(20);
    expect(shielded.chips).toBe(20);
    expect(shielded.shielded).toBe(false);
  });

  it('a donut delivery hands out coins to the whole island', async () => {
    const { ctx, state } = setup(TOONS);
    const [caller, ...rest] = place(state, ['m5', 'w0', 'y2', 'h1']);
    await runEvent(ctx, 'coast_donut_delivery', caller);
    expect(caller.chips).toBe(20 + DONUT_CALLER);
    for (const p of rest) expect(p.chips).toBe(20 + DONUT_OTHERS);
  });
});
