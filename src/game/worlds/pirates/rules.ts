// Pirate Cove's event rules, kept pure (no presentation) so they can be unit tested.
import type { BoardGraph } from '../../board/BoardGraph';
import { checkpoint, type DialogLineSpec, type EventPresentation, type FlowContext } from '../../board/flowTypes';
import type { BoardState, PlayerState } from '../../state/MatchState';
import type { BoardEventDef } from '../types';

/** How far ahead of the galleon the cannon volley reaches (spaces along the trail). */
export const VOLLEY_RANGE = 10;
/** Spaces a cannonball or a wave knocks someone back. */
export const KNOCKBACK = 3;

/** Rivals the volley reaches: everyone else standing up to `range` spaces ahead of the gunner. */
export function volleyTargets(graph: BoardGraph, board: BoardState, players: readonly PlayerState[], gunner: PlayerState, range = VOLLEY_RANGE): PlayerState[] {
  return players.filter((o) => {
    if (o.slot === gunner.slot || o.nodeId === gunner.nodeId) return false;
    const d = graph.distance(gunner.nodeId, o.nodeId, board);
    return d >= 1 && d <= range;
  });
}

/** Who the tide catches: everyone on a shoreline (exposed) space, and whoever called it in. */
export function tideVictims(graph: BoardGraph, players: readonly PlayerState[], caller: PlayerState | null): PlayerState[] {
  return players.filter((pl) => pl === caller || !!graph.node(pl.nodeId).metadata?.exposed);
}

/** Chaotic board events hit harder (the same factor as the festival's own events). */
export function scaled(ctx: FlowContext, n: number): number {
  return Math.round(n * (ctx.state.config.events === 'chaotic' ? 1.5 : 1));
}

/**
 * TurnFlow's helpers (gainChips, pushBackward…), loaded when an event runs. A static import would
 * close the cycle TurnFlow → EventManager → the world events → TurnFlow, which breaks whenever the
 * world events are the first of these to load (the worlds unit test imports them directly).
 */
export const turnFlow = () => import('../../board/TurnFlow');

/** Show an event's banner and dialogue (EventManager's own helper isn't exported). */
export function present(ctx: FlowContext, def: BoardEventDef, lines: DialogLineSpec[], extra: Partial<EventPresentation> = {}): Promise<void> {
  return ctx.io.event({ id: def.id, title: def.title, kind: def.kind === 'global' ? 'global' : def.kind, lines, ...extra }).then(() => checkpoint(ctx));
}
