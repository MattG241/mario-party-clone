import { describe, expect, it } from 'vitest';
import { BoardGraph } from '../../src/game/board/BoardGraph';
import { SUNCOIL } from './suncoilBoard';
import type { BoardState } from '../../src/game/state/MatchState';

function boardState(over: Partial<BoardState> = {}): BoardState {
  const portalLinks: Record<string, string> = {};
  for (const [a, b] of SUNCOIL.portals) {
    portalLinks[a] = b;
    portalLinks[b] = a;
  }
  return { relicGate: 'c2', relicPrice: null, bridgeBroken: null, surge: null, bouncy: null, portalLinks, traps: [], gatesOpen: null, ...over };
}

describe('Suncoil Sanctuary board data', () => {
  const g = new BoardGraph(SUNCOIL);

  it('has roughly 48–57 spaces with unique ids', () => {
    expect(SUNCOIL.nodes.length).toBeGreaterThanOrEqual(48);
    expect(SUNCOIL.nodes.length).toBeLessThanOrEqual(57);
    expect(new Set(SUNCOIL.nodes.map((n) => n.id)).size).toBe(SUNCOIL.nodes.length);
  });

  it('gives every space the required fields', () => {
    for (const n of SUNCOIL.nodes) {
      expect(typeof n.x).toBe('number');
      expect(typeof n.y).toBe('number');
      expect(n.next.length).toBeGreaterThan(0);
      if (n.type === 'event') expect(n.eventId).toBeTruthy();
      if (n.type === 'market') expect(n.metadata?.shop).toBeTruthy();
    }
  });

  it('lets every space be reached from the start (with a key, bridge intact or broken)', () => {
    for (const broken of [false, true]) {
      const b = boardState({ bridgeBroken: broken ? { untilRound: 99 } : null });
      const seen = new Set<string>([SUNCOIL.startNode]);
      const queue = [SUNCOIL.startNode];
      while (queue.length) {
        const id = queue.shift()!;
        for (const e of g.usableExits(id, b, true)) {
          if (!seen.has(e.to)) {
            seen.add(e.to);
            queue.push(e.to);
          }
        }
      }
      const expectMissing = SUNCOIL.nodes.filter((n) => (broken ? n.metadata?.bridge : n.metadata?.detour)).map((n) => n.id);
      for (const n of SUNCOIL.nodes) if (!expectMissing.includes(n.id)) expect(seen.has(n.id), `${n.id} reachable`).toBe(true);
    }
  });

  it('has intersections, portals, relic gates and markets', () => {
    expect(SUNCOIL.nodes.filter((n) => n.next.length > 1).length).toBeGreaterThanOrEqual(3);
    expect(SUNCOIL.portals.length).toBeGreaterThanOrEqual(2);
    for (const gate of SUNCOIL.relicGates) expect(g.node(gate).type).toBe('relic');
    expect(g.nodesOfType('market').length).toBe(2);
  });
});

describe('board movement rules', () => {
  const g = new BoardGraph(SUNCOIL);

  it('hides the Prism Gate shortcut unless the player holds a key', () => {
    const b = boardState();
    expect(g.usableExits('p1', b, false).map((e) => e.to)).toEqual(['p2']);
    const withKey = g.usableExits('p1', b, true);
    expect(withKey.map((e) => e.to).sort()).toEqual(['o0', 'p2']);
    expect(withKey.find((e) => e.to === 'o0')?.needsKey).toBe(true);
  });

  it('opens gates for everyone while gatesOpen is active', () => {
    const b = boardState({ gatesOpen: { untilRound: 3 } });
    const exits = g.usableExits('p1', b, false);
    expect(exits.find((e) => e.to === 'o0')?.needsKey).toBe(false);
  });

  it('switches between the bridge and the detour', () => {
    expect(g.usableExits('c5', boardState(), false).map((e) => e.to)).toEqual(['b0']);
    expect(g.usableExits('c5', boardState({ bridgeBroken: { untilRound: 5 } }), false).map((e) => e.to)).toEqual(['bd0']);
  });

  it('lets someone already on the detour finish it after repairs', () => {
    expect(g.usableExits('bd0', boardState(), false).map((e) => e.to)).toEqual(['bd1']);
  });

  it('retraces the trail when stepping back at a merge point', () => {
    const b = boardState();
    expect(g.stepBack('g2', ['g1', 'gi0', 'gi1', 'gi2'], b)).toBe('gi2');
    expect(g.stepBack('g2', ['go3', 'go4'], b)).toBe('go4');
  });

  it('computes forward distances', () => {
    const b = boardState();
    expect(g.distance('p0', 'p1', b)).toBe(1);
    expect(g.distance('p0', 'g1', b)).toBe(5);
    // The key shortcut makes the Brass Terrace much closer.
    expect(g.distance('p0', 't2', b, true)).toBeLessThan(g.distance('p0', 't2', b, false));
  });

  it('links portals in pairs', () => {
    const b = boardState();
    for (const [a, c] of SUNCOIL.portals) {
      expect(g.portalPartner(a, b)).toBe(c);
      expect(g.portalPartner(c, b)).toBe(a);
    }
  });
});
