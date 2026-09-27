import { STORAGE_KEYS } from '../constants';
import { deserializeMatch, serializeMatch, type MatchState } from '../state/MatchState';
import { browserStore, type KeyValueStore } from './SettingsManager';

/** Saves one unfinished board match in localStorage (“Continue Game” on the title screen). */
export class SaveManager {
  constructor(private store: KeyValueStore | null = browserStore()) {}

  hasSave(): boolean {
    if (!this.store) return false;
    try {
      return this.store.getItem(STORAGE_KEYS.save) !== null;
    } catch {
      return false;
    }
  }

  save(state: MatchState): boolean {
    if (!this.store) return false;
    try {
      this.store.setItem(STORAGE_KEYS.save, serializeMatch(state));
      return true;
    } catch {
      return false;
    }
  }

  load(knownNodes?: Set<string>): MatchState | null {
    if (!this.store) return null;
    try {
      const raw = this.store.getItem(STORAGE_KEYS.save);
      if (!raw) return null;
      const s = deserializeMatch(raw, knownNodes);
      if (!s) this.clear();
      return s;
    } catch {
      return null;
    }
  }

  clear(): void {
    try {
      this.store?.removeItem(STORAGE_KEYS.save);
    } catch {
      // ignore
    }
  }
}

export const saves = new SaveManager();
