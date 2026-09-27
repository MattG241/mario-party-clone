import type { ItemId, ShopDef } from '../data/items';
import type { NpcId } from '../data/npcs';
import type { BoardState, MatchState, PlayerState } from '../state/MatchState';
import type { BonusAward, Placement } from '../state/scoring';
import type { Random } from '../util/Random';
import type { BoardGraph } from './BoardGraph';
import type { BoardNodeDef } from './types';

export type PreRollDecision = { kind: 'roll' } | { kind: 'item'; item: ItemId };

export interface PathOption {
  to: string;
  label: string;
  needsKey: boolean;
}

export interface TargetOption<T> {
  value: T;
  label: string;
  /** Optional board node to highlight / pan to. */
  nodeId?: string;
  slot?: number;
}

export interface ShopOffer {
  shop: ShopDef;
  items: { id: ItemId; price: number }[];
}

export interface DialogLineSpec {
  npc: NpcId;
  pose?: string;
  text: string;
}

export type JumpKind = 'portal' | 'warp' | 'swap' | 'cannon' | 'bounce' | 'wind' | 'fall' | 'guide';

export interface EventPresentation {
  id: string;
  title: string;
  kind: 'festival' | 'mischief' | 'board' | 'global';
  lines: DialogLineSpec[];
  /** Node the camera should frame. */
  focus?: string;
  /** Visual effect keyword for the scene (bridge break, surge glow, etc.). */
  fx?: string;
  player?: PlayerState;
}

export interface MinigameRewardView {
  slot: number;
  place: number;
  chips: number;
}

/**
 * Everything the turn logic needs from the presentation layer. The board scene implements it
 * with animations and controller input; tests implement it with instant, headless stubs.
 *
 * Decision methods receive `cpu` when the acting player is a CPU: the decision has already been
 * made by BoardAI and the IO only needs to present it (and return it).
 */
export interface FlowIO {
  roundStart(round: number, total: number, final: boolean): Promise<void>;
  finalRoundIntro(): Promise<void>;
  turnStart(p: PlayerState): Promise<void>;
  turnEnd(p: PlayerState): Promise<void>;

  preRollChoice(p: PlayerState, usable: ItemId[], cpu?: PreRollDecision): Promise<PreRollDecision>;
  chooseTarget<T>(p: PlayerState, prompt: string, options: TargetOption<T>[], cpu?: T): Promise<T | null>;
  chooseDiscard(p: PlayerState, incoming: ItemId, cpu?: ItemId): Promise<ItemId>;
  spinDial(p: PlayerState, result: number, bonus: number): Promise<void>;
  offerReroll(p: PlayerState, result: number, cpu?: boolean): Promise<boolean>;
  choosePath(p: PlayerState, at: string, options: PathOption[], cpu?: string): Promise<string>;
  shop(p: PlayerState, offer: ShopOffer, cpu?: ItemId | null): Promise<ItemId | null>;
  offerRelic(p: PlayerState, price: number, cpu?: boolean): Promise<boolean>;

  moveStep(p: PlayerState, from: string, to: string, remaining: number): Promise<void>;
  jumpTo(p: PlayerState, from: string, to: string, kind: JumpKind): Promise<void>;
  landed(p: PlayerState, node: BoardNodeDef): Promise<void>;
  chips(p: PlayerState, delta: number, reason: string): Promise<void>;
  relicGained(p: PlayerState, source: 'purchase' | 'bonus'): Promise<void>;
  relicMoved(from: string, to: string): Promise<void>;
  item(p: PlayerState, item: ItemId, kind: 'gain' | 'use' | 'lose' | 'discard'): Promise<void>;
  shield(p: PlayerState, kind: 'up' | 'block'): Promise<void>;
  trap(kind: 'plant' | 'spring', nodeId: string, owner: number, victim?: PlayerState): Promise<void>;
  event(e: EventPresentation): Promise<void>;
  say(lines: DialogLineSpec[], p?: PlayerState): Promise<void>;
  boardChanged(): void;

  playMinigame(): Promise<Placement[]>;
  minigameRewards(rewards: MinigameRewardView[]): Promise<void>;
  bonusAwards(awards: BonusAward[]): Promise<void>;
  finalResults(): Promise<void>;

  save(state: MatchState): void;
  delay(ms: number): Promise<void>;
}

/** Thrown to abandon the current turn (debug skip / finish round / launch minigame). */
export class FlowInterrupt extends Error {
  constructor(readonly kind: 'skipTurn' | 'finishRound' | 'minigame') {
    super(`flow interrupt: ${kind}`);
  }
}

export interface TurnScratch {
  itemUsed: boolean;
  bootsBonus: number;
  relicOffered: Set<string>;
  bounced: boolean;
}

export interface FlowContext {
  state: MatchState;
  board: BoardState;
  graph: BoardGraph;
  rng: Random;
  io: FlowIO;
  turn: TurnScratch;
  /** Pending debug interrupt, checked at every checkpoint. */
  interrupt: FlowInterrupt['kind'] | null;
}

export function checkpoint(ctx: FlowContext): void {
  // Keep the saved RNG state in step with the live generator.
  ctx.state.rng = ctx.rng.state;
  const k = ctx.interrupt;
  if (k) {
    ctx.interrupt = null;
    throw new FlowInterrupt(k);
  }
}

export function freshTurn(): TurnScratch {
  return { itemUsed: false, bootsBonus: 0, relicOffered: new Set(), bounced: false };
}
