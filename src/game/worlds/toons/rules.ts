// Cartoon Coast's event rules, kept pure (no presentation) so they can be unit tested.
import type { BoardGraph } from '../../board/BoardGraph';
import { checkpoint, type DialogLineSpec, type EventPresentation, type FlowContext } from '../../board/flowTypes';
import type { BoardState, PlayerState } from '../../state/MatchState';
import type { BoardEventDef } from '../types';

/** How far the loop-the-loop can fling someone (spaces along the trail, first branch at forks). */
export const LOOP_MIN = 6;
export const LOOP_MAX = 9;
/** Where a jellyfish swarm drifts: the bay and the pier beside it. */
export const SWARM_REGIONS = ['Bubble Bay', 'Seaside Pier'];
/** Coins a sting costs, and what a donut delivery hands out (the caller's box, everyone else's). */
export const STING = 3;
export const DONUT_CALLER = 5;
export const DONUT_OTHERS = 2;

/** Where the loop flings a runner: `steps` spaces on, taking the first branch at every fork. */
export function loopLanding(graph: BoardGraph, board: BoardState, from: string, steps: number): string {
  return graph.aheadOf(from, steps, board);
}

/** Who a jellyfish swarm stings: everyone in the bay or on the pier, and whoever stirred it up. */
export function swarmVictims(graph: BoardGraph, players: readonly PlayerState[], caller: PlayerState | null): PlayerState[] {
  return players.filter((pl) => pl === caller || SWARM_REGIONS.includes(graph.node(pl.nodeId).metadata?.region ?? ''));
}

/** Chaotic board events hit harder (the same factor as the festival's own events). */
export function scaled(ctx: FlowContext, n: number): number {
  return Math.round(n * (ctx.state.config.events === 'chaotic' ? 1.5 : 1));
}

/**
 * TurnFlow's helpers (gainChips, teleport…), loaded when an event runs. A static import would close
 * the cycle TurnFlow → EventManager → the world events → TurnFlow, which breaks whenever the world
 * events are the first of these to load (the worlds unit test imports them directly).
 */
export const turnFlow = () => import('../../board/TurnFlow');

/** Show an event's banner and dialogue (EventManager's own helper isn't exported). */
export function present(ctx: FlowContext, def: BoardEventDef, lines: DialogLineSpec[], extra: Partial<EventPresentation> = {}): Promise<void> {
  return ctx.io.event({ id: def.id, title: def.title, kind: def.kind === 'global' ? 'global' : def.kind, lines, ...extra }).then(() => checkpoint(ctx));
}
