import { ECONOMY } from '../constants';
import type { PlayerState, PlayerStats } from './MatchState';

export interface Standing {
  slot: number;
  /** 1-based place; tied players share a place ("1, 1, 3, 4"). */
  place: number;
  relics: number;
  chips: number;
}

/** Final standings: most Prism Relics, then most Gleam Chips; full ties share a place. */
export function computeStandings(players: readonly Pick<PlayerState, 'slot' | 'relics' | 'chips'>[]): Standing[] {
  const sorted = players.slice().sort((a, b) => b.relics - a.relics || b.chips - a.chips || a.slot - b.slot);
  const out: Standing[] = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    const tied = prev && prev.relics === p.relics && prev.chips === p.chips;
    const place = tied ? out[i - 1].place : i + 1;
    out.push({ slot: p.slot, place, relics: p.relics, chips: p.chips });
  });
  return out;
}

/** Slots in first place (several when fully tied). */
export function winners(players: readonly Pick<PlayerState, 'slot' | 'relics' | 'chips'>[]): number[] {
  return computeStandings(players)
    .filter((s) => s.place === 1)
    .map((s) => s.slot);
}

export interface Placement {
  slot: number;
  place: number;
}

/**
 * Turn raw minigame scores into placements (higher score = better) with shared places for ties.
 */
export function placementsFromScores(scores: readonly { slot: number; score: number }[]): Placement[] {
  const sorted = scores.slice().sort((a, b) => b.score - a.score || a.slot - b.slot);
  const out: Placement[] = [];
  sorted.forEach((s, i) => {
    const prev = sorted[i - 1];
    const place = prev && prev.score === s.score ? out[i - 1].place : i + 1;
    out.push({ slot: s.slot, place });
  });
  return out;
}

/** Minigame reward: 1st 10 · 2nd 6 · 3rd 3 · 4th 1. Shared places pay the shared place's amount. */
export function rewardForPlace(place: number): number {
  return ECONOMY.minigameRewards[Math.max(0, Math.min(ECONOMY.minigameRewards.length - 1, place - 1))];
}

export function minigameRewards(placements: readonly Placement[]): { slot: number; place: number; chips: number }[] {
  return placements.map((p) => ({ slot: p.slot, place: p.place, chips: rewardForPlace(p.place) }));
}

// ------------------------------------------------------------------------------------------------
// Bonus awards

export type BonusId = 'trailblazer' | 'treasureKeeper' | 'gameChampion' | 'itemExpert' | 'eventExplorer' | 'bigSpender' | 'luckyLanding';

export const BONUS_IDS: readonly BonusId[] = ['trailblazer', 'treasureKeeper', 'gameChampion', 'itemExpert', 'eventExplorer', 'bigSpender', 'luckyLanding'];

export interface BonusDef {
  id: BonusId;
  name: string;
  description: string;
  stat: keyof PlayerStats;
  unit: string;
}

export const BONUSES: Record<BonusId, BonusDef> = {
  trailblazer: { id: 'trailblazer', name: 'Trailblazer', description: 'Most spaces travelled', stat: 'spacesMoved', unit: 'spaces' },
  treasureKeeper: { id: 'treasureKeeper', name: 'Treasure Keeper', description: 'Most Gleam Chips earned', stat: 'chipsEarned', unit: 'chips' },
  gameChampion: { id: 'gameChampion', name: 'Game Champion', description: 'Most minigame victories', stat: 'minigameWins', unit: 'wins' },
  itemExpert: { id: 'itemExpert', name: 'Item Expert', description: 'Most items used', stat: 'itemsUsed', unit: 'items' },
  eventExplorer: { id: 'eventExplorer', name: 'Event Explorer', description: 'Most event spaces triggered', stat: 'eventsTriggered', unit: 'events' },
  bigSpender: { id: 'bigSpender', name: 'Big Spender', description: 'Most Gleam Chips spent', stat: 'chipsSpent', unit: 'chips' },
  luckyLanding: { id: 'luckyLanding', name: 'Lucky Landing', description: 'Most positive special spaces', stat: 'luckyLandings', unit: 'landings' },
};

export interface BonusAward {
  id: BonusId;
  /** Slots receiving the bonus (all tied leaders). Empty when nobody scored above zero. */
  winners: number[];
  /** Stat value per slot, for the reveal screen. */
  values: { slot: number; value: number }[];
}

/** Compute the chosen bonus categories. Ties: every tied leader gets the relic. */
export function computeBonusAwards(players: readonly Pick<PlayerState, 'slot' | 'stats'>[], categories: readonly BonusId[]): BonusAward[] {
  return categories.map((id) => {
    const stat = BONUSES[id].stat;
    const values = players.map((p) => ({ slot: p.slot, value: p.stats[stat] ?? 0 }));
    const best = Math.max(...values.map((v) => v.value));
    const win = best > 0 ? values.filter((v) => v.value === best).map((v) => v.slot) : [];
    return { id, winners: win, values };
  });
}
