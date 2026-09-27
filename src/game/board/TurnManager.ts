import { isFinalRound, logMatch, type MatchPhase, type MatchState } from '../state/MatchState';
import { computeBonusAwards, minigameRewards, type Placement } from '../state/scoring';
import { runEvent, runGlobalEvent } from './EventManager';
import { checkpoint, FlowInterrupt, freshTurn, type FlowContext, type MinigameRewardView } from './flowTypes';
import { runTurn } from './TurnFlow';

/** Phase that follows a completed turn. */
export function phaseAfterTurn(s: MatchState, turnIndex: number): MatchPhase {
  const next = turnIndex + 1;
  return next < s.players.length ? { kind: 'turn', index: next } : { kind: 'minigame' };
}

/** Phase that follows the round's minigame. */
export function phaseAfterMinigame(s: MatchState): { phase: MatchPhase; round: number } {
  if (s.round >= s.config.rounds) return { phase: { kind: 'bonus' }, round: s.round };
  return { phase: { kind: 'roundStart' }, round: s.round + 1 };
}

/** Pay out minigame rewards and update stats. */
export function applyMinigameRewards(s: MatchState, placements: readonly Placement[]): MinigameRewardView[] {
  const rewards = minigameRewards(placements);
  for (const r of rewards) {
    const p = s.players.find((pl) => pl.slot === r.slot);
    if (!p) continue;
    p.chips += r.chips;
    p.stats.chipsEarned += r.chips;
    if (r.place === 1) p.stats.minigameWins += 1;
  }
  return rewards;
}

/** Clear effects that have run their course. Returns true when the bridge was just repaired. */
export function expireRoundEffects(s: MatchState): { bridgeRepaired: boolean } {
  const b = s.board;
  const r = s.round;
  let bridgeRepaired = false;
  if (b.bridgeBroken && r > b.bridgeBroken.untilRound) bridgeRepaired = true;
  if (b.surge && r > b.surge.untilRound) b.surge = null;
  if (b.bouncy && r > b.bouncy.untilRound) b.bouncy = null;
  if (b.relicPrice && r > b.relicPrice.untilRound) b.relicPrice = null;
  if (b.gatesOpen && r > b.gatesOpen.untilRound) b.gatesOpen = null;
  return { bridgeRepaired };
}

/**
 * Run the match from whatever phase the state is in until the final results have been shown.
 * Saves at every phase boundary so an unfinished match can be continued.
 */
export async function runMatch(ctx: FlowContext): Promise<void> {
  const s = ctx.state;
  const { io } = ctx;
  for (let guard = 0; guard < 10000; guard++) {
    const phase = s.phase;
    if (phase.kind === 'roundStart') {
      const { bridgeRepaired } = expireRoundEffects(s);
      ctx.io.boardChanged();
      await io.roundStart(s.round, s.config.rounds, isFinalRound(s));
      if (bridgeRepaired) await runEvent(ctx, 'bridge_repair', null);
      if (isFinalRound(s)) await io.finalRoundIntro();
      if (s.config.events === 'chaotic' || isFinalRound(s)) await runGlobalEvent(ctx);
      s.phase = { kind: 'turn', index: 0 };
      save(ctx);
    } else if (phase.kind === 'turn') {
      const p = s.players[phase.index];
      let finishRound = false;
      try {
        await runTurn(ctx, p);
      } catch (e) {
        if (!(e instanceof FlowInterrupt)) throw e;
        ctx.turn = freshTurn();
        logMatch(s, `Turn interrupted (${e.kind})`);
        if (e.kind !== 'skipTurn') finishRound = true;
      }
      s.phase = finishRound ? { kind: 'minigame' } : phaseAfterTurn(s, phase.index);
      save(ctx);
    } else if (phase.kind === 'minigame') {
      const placements = await io.playMinigame();
      const rewards = applyMinigameRewards(s, placements);
      await io.minigameRewards(rewards);
      const next = phaseAfterMinigame(s);
      s.round = next.round;
      s.phase = next.phase;
      save(ctx);
    } else if (phase.kind === 'bonus') {
      const awards = computeBonusAwards(s.players, s.bonusCategories);
      for (const a of awards) {
        for (const slot of a.winners) {
          const p = s.players.find((pl) => pl.slot === slot);
          if (p) p.relics += 1;
        }
      }
      await io.bonusAwards(awards);
      s.phase = { kind: 'over' };
      save(ctx);
    } else {
      await io.finalResults();
      return;
    }
  }
  throw new Error('Match loop exceeded its safety limit');
}

function save(ctx: FlowContext): void {
  try {
    checkpoint(ctx);
  } catch (e) {
    // An interrupt requested between phases only matters inside turns.
    if (!(e instanceof FlowInterrupt)) throw e;
  }
  ctx.state.updatedAt = Date.now();
  ctx.io.save(ctx.state);
}
