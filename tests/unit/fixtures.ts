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

export const FOUR: Participant[] = [
  { slot: 0, characterId: 'kip', isCpu: true, cpuLevel: 'normal' },
  { slot: 1, characterId: 'mossi', isCpu: true, cpuLevel: 'easy' },
  { slot: 2, characterId: 'tumble', isCpu: true, cpuLevel: 'hard' },
  { slot: 3, characterId: 'zippa', isCpu: true, cpuLevel: 'normal' },
];
