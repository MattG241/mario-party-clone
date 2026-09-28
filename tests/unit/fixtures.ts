import { CHARACTER_IDS } from '../../src/game/data/characters';
import type { KeyValueStore } from '../../src/game/save/SettingsManager';
import type { MatchConfig, Participant } from '../../src/game/state/MatchState';

export function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

export const CONFIG: MatchConfig = { boardId: 'suncoil', rounds: 10, cpuDifficulty: 'normal', instructions: 'on', events: 'normal', speed: 'fast', seed: 424242 };

/** Four players on the first four roster characters (whatever the roster currently holds). */
export const FOUR: Participant[] = (['normal', 'easy', 'hard', 'normal'] as const).map((cpuLevel, slot) => ({
  slot,
  characterId: CHARACTER_IDS[slot],
  isCpu: true,
  cpuLevel,
}));
