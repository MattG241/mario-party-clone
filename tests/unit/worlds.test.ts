import { describe, expect, it } from 'vitest';
import { BoardGraph } from '../../src/game/board/BoardGraph';
import { BOARDS } from '../../src/game/data/boards';
import { CHARACTER_IDS } from '../../src/game/data/characters';
import { MINIGAMES } from '../../src/game/minigames/MinigameManager';
import { WORLDS } from '../../src/game/worlds';
import { WORLD_EVENTS } from '../../src/game/worlds/events';
import { WORLD_MINIGAME_RENDERS } from '../../src/game/worlds/infos';

// Every world adds a board and minigames in its own folder (src/game/worlds/<id>/); these checks
// hold each of them to the same rules as the original set, whoever builds it.
const worldIds = new Set(WORLDS.map((w) => w.id));

describe('worlds', () => {
  it('have unique ids, and casts from the roster', () => {
    expect(worldIds.size).toBe(WORLDS.length);
    for (const w of WORLDS) for (const c of w.cast) expect(CHARACTER_IDS, `${w.id}: ${c}`).toContain(c);
  });

  it('give every minigame a unique id, its scene key, a known world and real characters', () => {
    expect(new Set(MINIGAMES.map((m) => m.id)).size).toBe(MINIGAMES.length);
    for (const m of MINIGAMES) {
      expect(m.sceneKey, m.id).toBe(`mg-${m.id}`);
      expect(worldIds.has(m.world ?? 'festival'), m.id).toBe(true);
      for (const c of m.characters ?? []) expect(CHARACTER_IDS, `${m.id}: ${c}`).toContain(c);
      expect(m.instructions.length, m.id).toBeGreaterThan(0);
      expect(m.controls.length, m.id).toBeGreaterThan(0);
    }
  });

  // (That every world minigame has a registered scene is checked when the game boots, in Game.ts:
  // scene classes need Phaser, which these Node tests don't load.)

  it('only list arena art for minigames that exist', () => {
    const ids = new Set(MINIGAMES.map((m) => m.id));
    for (const id of Object.keys(WORLD_MINIGAME_RENDERS)) expect(ids.has(id), id).toBe(true);
  });

  it('keep world events on their own boards', () => {
    const boardIds = new Set(BOARDS.map((b) => b.id));
    expect(new Set(WORLD_EVENTS.map((e) => e.id)).size).toBe(WORLD_EVENTS.length);
    for (const e of WORLD_EVENTS) {
      expect(e.boards?.length, `${e.id} names its board`).toBeGreaterThan(0);
      for (const b of e.boards ?? []) expect(boardIds.has(b) || worldIds.has(b), `${e.id}: ${b}`).toBe(true);
    }
  });
});

describe.each(BOARDS.map((b) => [b.id, b] as const))('board %s', (_id, board) => {
  const ids = new Set(board.nodes.map((n) => n.id));

  it('has 36–70 spaces with unique ids and valid links', () => {
    expect(board.nodes.length).toBeGreaterThanOrEqual(36);
    expect(board.nodes.length).toBeLessThanOrEqual(70);
    expect(ids.size).toBe(board.nodes.length);
    expect(ids.has(board.startNode)).toBe(true);
    for (const n of board.nodes) {
      expect(n.next.length, `${n.id} leads somewhere`).toBeGreaterThan(0);
      for (const t of n.next) expect(ids.has(t), `${n.id} → ${t}`).toBe(true);
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(board.width);
      expect(n.y).toBeLessThanOrEqual(board.height);
    }
  });

  it('lets every space be reached from the start', () => {
    const seen = new Set([board.startNode]);
    const queue = [board.startNode];
    const byId = new Map(board.nodes.map((n) => [n.id, n]));
    while (queue.length) {
      for (const t of byId.get(queue.shift()!)!.next) {
        if (!seen.has(t)) {
          seen.add(t);
          queue.push(t);
        }
      }
    }
    for (const n of board.nodes) expect(seen.has(n.id), `${n.id} reachable`).toBe(true);
  });

  it('has junctions, relic gates and a market, and its theme points at real things', () => {
    const g = new BoardGraph(board);
    expect(board.nodes.filter((n) => n.next.length > 1).length).toBeGreaterThanOrEqual(2);
    expect(board.relicGates.length).toBeGreaterThanOrEqual(2);
    for (const gate of board.relicGates) expect(g.node(gate).type).toBe('relic');
    expect(board.nodes.some((n) => n.type === 'market')).toBe(true);
    for (const [a, b] of board.portals) {
      expect(ids.has(a) && ids.has(b), `${a} ↔ ${b}`).toBe(true);
    }
    if (board.theme) {
      expect(worldIds.has(board.theme.world)).toBe(true);
      const mgIds = new Set(MINIGAMES.map((m) => m.id));
      for (const m of board.theme.minigames ?? []) expect(mgIds.has(m), m).toBe(true);
    }
  });
});
