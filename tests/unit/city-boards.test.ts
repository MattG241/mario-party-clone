import { describe, expect, it } from 'vitest';
import { BoardGraph } from '../../src/game/board/BoardGraph';
import { eventDef, runEvent } from '../../src/game/board/EventManager';
import { freshTurn, type EventPresentation, type FlowContext } from '../../src/game/board/flowTypes';
import { createFlowContext, HeadlessIO } from '../../src/game/board/HeadlessIO';
import { runMatch } from '../../src/game/board/TurnManager';
import type { BoardDef } from '../../src/game/board/types';
import { createMatch, type MatchState } from '../../src/game/state/MatchState';
import { HEROES_BOARD } from '../../src/game/worlds/heroes/board';
import { chaseTarget, HEROES_EVENTS, searchlightTargets } from '../../src/game/worlds/heroes/events';
import { SHOWTIME_BOARD, SHOWTIME_STAGES } from '../../src/game/worlds/showtime/board';
import { encoreMove, onStage, SHOWTIME_EVENTS, stampedeTargets } from '../../src/game/worlds/showtime/events';
import { CONFIG, FOUR } from './fixtures';

// Hero Heights and Showtime Strip (the B-CITY boards): their graphs, and the rules of their events.

type Manifest = { tiles: { file: string }[]; props?: { file: string; tex: string }[]; shadow?: { file: string } };
const A = '../../public/assets/';
const MANIFESTS = import.meta.glob<Manifest>('../../public/assets/{rendered,lite}/{heroes,showtime}/manifest.json', { eager: true, import: 'default' });
const FILES = new Set(Object.keys(import.meta.glob(['../../public/assets/{rendered,lite}/{heroes,showtime}/*.webp', '../../public/assets/lite/previews/*.webp'])).map((k) => k.slice(A.length)));

/** Headless IO that also checks every event frames a space that exists on the board being played. */
class CheckedIO extends HeadlessIO {
  focusErrors: string[] = [];
  constructor(
    private graph: BoardGraph,
    seed: number,
  ) {
    super({ seed });
  }
  override async event(e: EventPresentation): Promise<void> {
    if (e.focus && !this.graph.has(e.focus)) this.focusErrors.push(`${e.id} → ${e.focus}`);
    await super.event(e);
  }
}

function setup(board: BoardDef, seed = 4242, over: Partial<typeof CONFIG> = {}): { ctx: FlowContext; io: CheckedIO; state: MatchState; graph: BoardGraph } {
  const graph = new BoardGraph(board);
  const state = createMatch({ ...CONFIG, boardId: board.id, seed, ...over }, FOUR, board);
  const io = new CheckedIO(graph, seed);
  const ctx = createFlowContext(state, graph, io);
  ctx.turn = freshTurn();
  return { ctx, io, state, graph };
}

function validate(board: BoardDef, state: MatchState): void {
  const ids = new Set(board.nodes.map((n) => n.id));
  for (const p of state.players) {
    expect(ids.has(p.nodeId), `${p.name} on a real space`).toBe(true);
    expect(p.chips).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(p.chips)).toBe(true);
  }
  expect(board.relicGates).toContain(state.board.relicGate);
}

const CITY: [BoardDef, string[]][] = [
  [HEROES_BOARD, HEROES_EVENTS.map((e) => e.id)],
  [SHOWTIME_BOARD, SHOWTIME_EVENTS.map((e) => e.id)],
];

describe.each(CITY.map(([b, ev]) => [b.id, b, ev] as const))('city board %s', (_id, board, events) => {
  const graph = new BoardGraph(board);

  it('has 45–60 spaces, 2–4 real junctions, five Star Coin gates, two markets and two portal pairs', () => {
    expect(board.nodes.length).toBeGreaterThanOrEqual(45);
    expect(board.nodes.length).toBeLessThanOrEqual(60);
    const forks = board.nodes.filter((n) => n.next.length > 1);
    expect(forks.length).toBeGreaterThanOrEqual(2);
    expect(forks.length).toBeLessThanOrEqual(4);
    // Every fork is signposted, and its branches really differ (they meet again only later).
    for (const f of forks) {
      for (const t of f.next) expect(f.metadata?.signs?.[t], `${f.id} sign for ${t}`).toBeTruthy();
      expect(new Set(f.next).size).toBe(f.next.length);
    }
    expect(board.relicGates).toHaveLength(5);
    expect(board.nodes.filter((n) => n.type === 'market').map((n) => n.metadata?.shop).sort()).toEqual(['pipper', 'wrench']);
    expect(board.portals).toHaveLength(2);
    for (const [a, b] of board.portals) {
      expect(graph.node(a).type).toBe('portal');
      expect(graph.node(b).type).toBe('portal');
    }
    expect(board.nodes.filter((n) => n.type === 'portal')).toHaveLength(4);
    expect(board.nodes.filter((n) => n.type === 'start')).toHaveLength(1);
  });

  it('never strands anyone: the start (and so every gate) can be reached from every space', () => {
    const state = createMatch({ ...CONFIG, boardId: board.id }, FOUR, board);
    for (const n of board.nodes) {
      expect(graph.distance(n.id, board.startNode, state.board, true), `${n.id} → start`).toBeLessThan(Infinity);
      for (const g of board.relicGates) expect(graph.distance(n.id, g, state.board, true), `${n.id} → ${g}`).toBeLessThan(Infinity);
    }
  });

  it('keeps spaces apart, clear of the hosts, and its Prism Key gate on a real edge', () => {
    for (const a of board.nodes) {
      for (const b of board.nodes) {
        if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.id}–${b.id}`).toBeGreaterThan(135);
      }
      // Mimi always stands at board (2020, 1500); Ora at the host spot.
      expect(Math.hypot(a.x - 2020, a.y - 1500), `${a.id} vs Mimi`).toBeGreaterThan(130);
      expect(Math.hypot(a.x - board.hostSpot.x, a.y - board.hostSpot.y), `${a.id} vs Ora`).toBeGreaterThan(130);
    }
    expect(board.gates).toHaveLength(1);
    for (const g of board.gates) {
      expect(graph.node(g.from).next).toContain(g.to);
      expect(graph.node(g.to).metadata?.gate).toBe(g.id);
    }
    // Consecutive spaces stay a comfortable hop apart.
    for (const n of board.nodes) for (const t of n.next) expect(Math.hypot(n.x - graph.node(t).x, n.y - graph.node(t).y), `${n.id}>${t}`).toBeLessThan(240);
  });

  it('points its event spaces at its own events, and skips the festival events that frame Suncoil', () => {
    for (const n of board.nodes.filter((nd) => nd.type === 'event')) {
      expect(events, `${n.id}: ${n.eventId}`).toContain(n.eventId);
      expect(eventDef(n.eventId!)?.boards).toEqual([board.id]);
    }
    expect(board.theme?.skipEvents).toEqual(expect.arrayContaining(['crystal_surge', 'portal_storm']));
    expect(board.theme?.time).toBe('night');
  });

  it('runs each of its events from every event space without errors', async () => {
    for (const id of events) {
      const { ctx, io, state } = setup(board, 31);
      const p = state.players[0];
      p.nodeId = board.nodes.find((n) => n.eventId === id)?.id ?? board.relicGates[0];
      p.chips = 12;
      await runEvent(ctx, id, eventDef(id)!.kind === 'global' ? null : p);
      validate(board, state);
      expect(io.focusErrors).toEqual([]);
    }
  });

  it('ships the rendered art it claims (Full and Lite), with its landmarks replacing the placeholders', () => {
    if (!board.theme?.rendered) return;
    for (const dir of ['rendered', 'lite']) {
      const man = MANIFESTS[`${A}${dir}/${board.id}/manifest.json`];
      expect(man, `${dir}/${board.id}/manifest.json`).toBeTruthy();
      expect(man.tiles.length, `${dir} tiles`).toBeGreaterThan(0);
      for (const f of [...man.tiles.map((t) => t.file), ...(man.props ?? []).map((p) => p.file), ...(man.shadow ? [man.shadow.file] : [])]) {
        expect(FILES.has(`${dir}/${board.id}/${f}`), `${dir}/${board.id}/${f}`).toBe(true);
      }
      // every placeholder decoration texture has a rendered landmark standing in for it
      const replaced = new Set((man.props ?? []).map((p) => p.tex));
      for (const d of board.decorations) expect(replaced.has(d.texture), `${dir}: ${d.texture} replaced`).toBe(true);
    }
    expect(board.theme.preview).toBe(`assets/lite/previews/${board.id}.webp`);
    expect(FILES.has(`lite/previews/${board.id}.webp`)).toBe(true);
  });

  it('plays full matches (normal and chaotic) to a result, framing only its own spaces', async () => {
    for (const [seed, over] of [
      [8080, {}],
      [5, { rounds: 15, events: 'chaotic' as const }],
      [6, { rounds: 15, events: 'chaotic' as const }],
    ] as const) {
      const { ctx, io, state } = setup(board, seed, over);
      await runMatch(ctx);
      expect(io.finished).toBe(true);
      expect(state.phase).toEqual({ kind: 'over' });
      expect(io.focusErrors).toEqual([]);
      validate(board, state);
    }
  });
});

describe('Hero Heights events', () => {
  it('Blackout sends the Star Coin to another rooftop', async () => {
    const { ctx, state } = setup(HEROES_BOARD);
    for (let i = 0; i < 8; i++) {
      const before = state.board.relicGate;
      await runEvent(ctx, 'heroes_blackout', state.players[i % 4]);
      expect(state.board.relicGate).not.toBe(before);
    }
  });

  it('Searchlight Sweep pushes back whoever is on an open ledge (and the one who set it off)', async () => {
    const { ctx, state } = setup(HEROES_BOARD);
    const [lander, onBridge, sheltered, shielded] = state.players;
    lander.nodeId = 'hb1';
    lander.trail = ['hg1', 'hb0'];
    onBridge.nodeId = 'hs1';
    onBridge.trail = ['hr4', 'hs0'];
    sheltered.nodeId = 'ht3';
    shielded.nodeId = 'hw1';
    shielded.shielded = true;
    expect(searchlightTargets(ctx, lander).map((p) => p.slot).sort()).toEqual([lander.slot, onBridge.slot, shielded.slot].sort());
    await runEvent(ctx, 'heroes_searchlight', lander);
    expect(lander.nodeId).toBe('hg1');
    expect(onBridge.nodeId).toBe('hr4');
    expect(sheltered.nodeId).toBe('ht3');
    expect(shielded.nodeId).toBe('hw1');
    expect(shielded.shielded).toBe(false);
  });

  it('Rooftop Chase swaps with the rival nearest the Star Coin', async () => {
    const { ctx, state } = setup(HEROES_BOARD);
    state.board.relicGate = 'hf2';
    const [p, far, near, mid] = state.players;
    p.nodeId = 'hw1';
    far.nodeId = 'hg0';
    near.nodeId = 'hf1';
    mid.nodeId = 'hk0';
    expect(chaseTarget(ctx, p)).toBe(near);
    await runEvent(ctx, 'heroes_chase', p);
    expect(p.nodeId).toBe('hf1');
    expect(near.nodeId).toBe('hw1');
  });

  it('Rooftop Chase pays the leader instead of swapping them backwards', async () => {
    const { ctx, state } = setup(HEROES_BOARD);
    state.board.relicGate = 'hf2';
    const [p, ...others] = state.players;
    p.nodeId = 'hf1';
    for (const o of others) o.nodeId = 'hp0';
    p.chips = 0;
    expect(chaseTarget(ctx, p)).toBeNull();
    await runEvent(ctx, 'heroes_chase', p);
    expect(p.nodeId).toBe('hf1');
    expect(p.chips).toBe(5);
  });

  it('Subway Shuffle reroutes the portals in pairs', async () => {
    const { ctx, state } = setup(HEROES_BOARD);
    const before = JSON.stringify(state.board.portalLinks);
    await runEvent(ctx, 'heroes_subway', null);
    expect(JSON.stringify(state.board.portalLinks)).not.toBe(before);
    for (const [a, b] of Object.entries(state.board.portalLinks)) expect(state.board.portalLinks[b]).toBe(a);
  });
});

describe('Showtime Strip events', () => {
  it('knows its stages', () => {
    const { ctx } = setup(SHOWTIME_BOARD);
    const stages = SHOWTIME_BOARD.nodes.filter((n) => onStage(ctx, n.id));
    expect(new Set(stages.map((n) => n.metadata?.region))).toEqual(new Set(SHOWTIME_STAGES));
  });

  it('Spotlight Solo pays everyone on a stage', async () => {
    const { ctx, state } = setup(SHOWTIME_BOARD);
    const [lander, diner, crowd, pop] = state.players;
    lander.nodeId = 'sr2';
    diner.nodeId = 'sl15';
    crowd.nodeId = 'sr13';
    pop.nodeId = 'sl6';
    for (const p of state.players) p.chips = 0;
    await runEvent(ctx, 'showtime_spotlight', lander);
    expect([lander.chips, diner.chips, crowd.chips, pop.chips]).toEqual([6, 6, 0, 6]);
  });

  it('Encore spins again and dances on, buying the Star Coin on the way', async () => {
    const { ctx, state } = setup(SHOWTIME_BOARD);
    const p = state.players[0];
    p.nodeId = 'sl5';
    p.chips = 30;
    state.board.relicGate = 'sl6';
    ctx.rng.int = () => 3;
    await runEvent(ctx, 'showtime_encore', p);
    expect(p.nodeId).toBe('sl8');
    expect(p.relics).toBe(1);
    expect(p.trail.slice(-3)).toEqual(['sl5', 'sl6', 'sl7']);
  });

  it('Encore follows the chosen branch at a fork', async () => {
    const { ctx, state } = setup(SHOWTIME_BOARD);
    const p = state.players[0];
    p.nodeId = 'sr7';
    const io = ctx.io as HeadlessIO;
    io.choosePath = async (_p, _at, options) => options[options.length - 1].to;
    await encoreMove(ctx, p, 3);
    expect(p.nodeId).toBe('sa2');
  });

  it('Rodeo Stampede scatters the lander and nearby rivals, never the far ones', async () => {
    const { ctx, state, graph } = setup(SHOWTIME_BOARD);
    const [lander, near, far, shielded] = state.players;
    lander.nodeId = 'sr6';
    near.nodeId = 'sr4';
    far.nodeId = 'sl12';
    shielded.nodeId = 'sr7';
    shielded.shielded = true;
    expect(stampedeTargets(ctx, lander).map((p) => p.slot).sort()).toEqual([lander.slot, near.slot, shielded.slot].sort());
    const before = { lander: lander.nodeId, near: near.nodeId };
    await runEvent(ctx, 'showtime_stampede', lander);
    expect(far.nodeId).toBe('sl12');
    expect(shielded.nodeId).toBe('sr7');
    for (const [who, from] of [
      [lander, before.lander],
      [near, before.near],
    ] as const) {
      const d = Math.min(graph.distance(from, who.nodeId, state.board, true), graph.distance(who.nodeId, from, state.board, true));
      expect(d, `${who.name} scattered`).toBeLessThanOrEqual(3);
    }
  });

  it('Neon Surge doubles eight blue spaces until the end of next round', async () => {
    const { ctx, state } = setup(SHOWTIME_BOARD);
    state.round = 4;
    await runEvent(ctx, 'showtime_neon_surge', null);
    expect(state.board.surge?.nodes).toHaveLength(8);
    expect(state.board.surge?.untilRound).toBe(5);
    for (const id of state.board.surge!.nodes) expect(SHOWTIME_BOARD.nodes.find((n) => n.id === id)?.type).toBe('gleam');
  });
});
