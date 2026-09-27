import type { ItemId } from '../data/items';
import { serializeMatch, type MatchState, type PlayerState } from '../state/MatchState';
import { placementsFromScores, type BonusAward, type Placement } from '../state/scoring';
import { Random } from '../util/Random';
import { BoardGraph } from './BoardGraph';
import { freshTurn, type FlowContext, type FlowIO, type PathOption, type PreRollDecision, type ShopOffer, type TargetOption } from './flowTypes';

/**
 * Instant, presentation-free FlowIO. Every decision uses the CPU choice when provided and a
 * sensible default otherwise. Used by unit tests and match simulations.
 */
export class HeadlessIO implements FlowIO {
  saves = 0;
  lastSave = '';
  events: string[] = [];
  minigames = 0;
  finished = false;
  awards: BonusAward[] = [];
  private rng: Random;

  constructor(private opts: { seed?: number; minigame?: (round: number) => Placement[]; slots?: number[] } = {}) {
    this.rng = new Random(opts.seed ?? 1);
  }

  async roundStart(): Promise<void> {}
  async finalRoundIntro(): Promise<void> {}
  async turnStart(): Promise<void> {}
  async turnEnd(): Promise<void> {}
  async preRollChoice(_p: PlayerState, _u: ItemId[], cpu?: PreRollDecision): Promise<PreRollDecision> {
    return cpu ?? { kind: 'roll' };
  }
  async chooseTarget<T>(_p: PlayerState, _prompt: string, options: TargetOption<T>[], cpu?: T): Promise<T | null> {
    return cpu !== undefined ? cpu : (options[0]?.value ?? null);
  }
  async chooseDiscard(_p: PlayerState, incoming: ItemId, cpu?: ItemId): Promise<ItemId> {
    return cpu ?? incoming;
  }
  async spinDial(): Promise<void> {}
  async offerReroll(_p: PlayerState, _r: number, cpu?: boolean): Promise<boolean> {
    return cpu ?? false;
  }
  async choosePath(_p: PlayerState, _at: string, options: PathOption[], cpu?: string): Promise<string> {
    return cpu ?? options[0].to;
  }
  async shop(_p: PlayerState, _o: ShopOffer, cpu?: ItemId | null): Promise<ItemId | null> {
    return cpu ?? null;
  }
  async offerRelic(_p: PlayerState, _price: number, cpu?: boolean): Promise<boolean> {
    return cpu ?? true;
  }
  async moveStep(): Promise<void> {}
  async jumpTo(): Promise<void> {}
  async landed(): Promise<void> {}
  async chips(): Promise<void> {}
  async relicGained(): Promise<void> {}
  async relicMoved(): Promise<void> {}
  async item(): Promise<void> {}
  async shield(): Promise<void> {}
  async trap(): Promise<void> {}
  async event(e: { id: string }): Promise<void> {
    this.events.push(e.id);
  }
  async say(): Promise<void> {}
  boardChanged(): void {}
  async playMinigame(): Promise<Placement[]> {
    this.minigames++;
    if (this.opts.minigame) return this.opts.minigame(this.minigames);
    const slots = this.opts.slots ?? [0, 1, 2, 3];
    return placementsFromScores(slots.map((slot) => ({ slot, score: this.rng.int(0, 100) })));
  }
  async minigameRewards(): Promise<void> {}
  async bonusAwards(awards: BonusAward[]): Promise<void> {
    this.awards = awards;
  }
  async finalResults(): Promise<void> {
    this.finished = true;
  }
  save(state: MatchState): void {
    this.saves++;
    this.lastSave = serializeMatch(state);
  }
  async delay(): Promise<void> {}
}

export function createFlowContext(state: MatchState, graph: BoardGraph, io: FlowIO): FlowContext {
  return { state, board: state.board, graph, rng: new Random(state.rng), io, turn: freshTurn(), interrupt: null };
}
