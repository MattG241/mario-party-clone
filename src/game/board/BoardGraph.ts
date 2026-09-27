import type { BoardState } from '../state/MatchState';
import type { BoardDef, BoardNodeDef, GateDef, SpaceType } from './types';

export interface Exit {
  to: string;
  gate?: GateDef;
}

/**
 * Pure graph helpers for a board: forward exits (respecting broken bridges, detours and Prism
 * Gates), backwards steps, distances and portal links.
 */
export class BoardGraph {
  readonly nodes = new Map<string, BoardNodeDef>();
  readonly prev = new Map<string, string[]>();

  constructor(readonly def: BoardDef) {
    for (const node of def.nodes) {
      this.nodes.set(node.id, node);
      this.prev.set(node.id, []);
    }
    for (const node of def.nodes) {
      for (const to of node.next) {
        if (!this.nodes.has(to)) throw new Error(`Board ${def.id}: node ${node.id} links to unknown node ${to}`);
        this.prev.get(to)!.push(node.id);
      }
    }
  }

  node(id: string): BoardNodeDef {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Unknown board node ${id}`);
    return n;
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  nodesOfType(type: SpaceType): BoardNodeDef[] {
    return this.def.nodes.filter((n) => n.type === type);
  }

  /** Which bridge/detour group a node belongs to, if any. */
  private group(id: string): { bridge: string; kind: 'bridge' | 'detour' } | null {
    const m = this.node(id).metadata;
    if (m?.bridge) return { bridge: m.bridge, kind: 'bridge' };
    if (m?.detour) return { bridge: m.detour, kind: 'detour' };
    return null;
  }

  /** Is the node currently enterable? Bridge nodes close while broken; detours open only then. */
  isOpen(id: string, board: BoardState): boolean {
    const g = this.group(id);
    if (!g) return true;
    const broken = board.bridgeBroken !== null;
    return g.kind === 'bridge' ? !broken : broken;
  }

  gateBetween(from: string, to: string): GateDef | undefined {
    return this.def.gates.find((g) => g.from === from && g.to === to);
  }

  /** Forward exits that are physically open (gates included; callers check keys). */
  exits(from: string, board: BoardState): Exit[] {
    const fromGroup = this.group(from);
    return this.node(from)
      .next.filter((to) => {
        if (this.isOpen(to, board)) return true;
        // Someone already on a closing bridge/detour may finish crossing it.
        const g = this.group(to);
        return !!fromGroup && !!g && fromGroup.bridge === g.bridge && fromGroup.kind === g.kind;
      })
      .map((to) => ({ to, gate: this.gateBetween(from, to) }));
  }

  /** Exits a player may actually take: gates need a Prism Key unless opened by an event. */
  usableExits(from: string, board: BoardState, hasKey: boolean): (Exit & { needsKey: boolean })[] {
    const gatesOpen = board.gatesOpen !== null;
    const out: (Exit & { needsKey: boolean })[] = [];
    for (const e of this.exits(from, board)) {
      if (!e.gate) out.push({ ...e, needsKey: false });
      else if (gatesOpen) out.push({ ...e, needsKey: false });
      else if (hasKey) out.push({ ...e, needsKey: true });
    }
    // Never strand a player: if every exit is gated and locked, the first exit stays open.
    if (out.length === 0) {
      const all = this.exits(from, board);
      if (all.length) out.push({ ...all[0], needsKey: false });
    }
    return out;
  }

  /** The node one step backwards, retracing the player's trail when possible. */
  stepBack(at: string, trail: readonly string[], board: BoardState): string | null {
    const preds = this.prev.get(at) ?? [];
    const last = trail[trail.length - 1];
    if (last && preds.includes(last) && this.isOpen(last, board)) return last;
    const open = preds.filter((p) => this.isOpen(p, board) && !this.gateBetween(p, at));
    return open[0] ?? preds[0] ?? null;
  }

  /** Forward BFS distance in steps (Infinity if unreachable). */
  distance(from: string, to: string, board: BoardState, allowGates = false): number {
    if (from === to) return 0;
    const seen = new Set([from]);
    let frontier = [from];
    let d = 0;
    while (frontier.length && d < 200) {
      d++;
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of this.usableExits(id, board, allowGates)) {
          if (e.to === to) return d;
          if (!seen.has(e.to)) {
            seen.add(e.to);
            next.push(e.to);
          }
        }
      }
      frontier = next;
    }
    return Infinity;
  }

  /** Nodes reachable in exactly `steps` forward moves (any branch). */
  reachableIn(from: string, steps: number, board: BoardState, allowGates = false): Set<string> {
    let cur = new Set([from]);
    for (let i = 0; i < steps; i++) {
      const next = new Set<string>();
      for (const id of cur) for (const e of this.usableExits(id, board, allowGates)) next.add(e.to);
      cur = next;
    }
    return cur;
  }

  /** Follow single-exit forward links `steps` times (first branch at intersections). */
  aheadOf(from: string, steps: number, board: BoardState): string {
    let at = from;
    for (let i = 0; i < steps; i++) {
      const ex = this.usableExits(at, board, false);
      if (!ex.length) break;
      at = ex[0].to;
    }
    return at;
  }

  portalPartner(id: string, board: BoardState): string | null {
    return board.portalLinks[id] ?? null;
  }
}
