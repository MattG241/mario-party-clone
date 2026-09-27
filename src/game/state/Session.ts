import type { CpuLevel } from '../constants';
import type { CharacterId } from '../data/characters';
import type { DeviceRef } from '../input/InputManager';
import type { MatchState } from './MatchState';

/** One of the four player slots on the join / character-select screen. */
export interface SlotConfig {
  slot: number;
  /** A human joined this slot. */
  joined: boolean;
  device: DeviceRef | null;
  characterId: CharacterId | null;
  /** Filled by a CPU (either chosen explicitly or auto-filled). */
  isCpu: boolean;
  cpuLevel: CpuLevel;
}

export type GameMode = 'board' | 'minigame';

function freshSlots(): SlotConfig[] {
  return [0, 1, 2, 3].map((slot) => ({ slot, joined: false, device: null, characterId: null, isCpu: false, cpuLevel: 'normal' as CpuLevel }));
}

/** In-memory state for the current play session (not persisted; matches are saved separately). */
export class Session {
  mode: GameMode = 'board';
  slots: SlotConfig[] = freshSlots();
  match: MatchState | null = null;

  resetSlots(): void {
    this.slots = freshSlots();
  }

  /** Slots taking part (humans + CPUs), in slot order. */
  participants(): SlotConfig[] {
    return this.slots.filter((s) => (s.joined || s.isCpu) && s.characterId !== null);
  }

  humans(): SlotConfig[] {
    return this.slots.filter((s) => s.joined && !s.isCpu);
  }

  isHuman(slot: number): boolean {
    const s = this.slots[slot];
    return !!s && s.joined && !s.isCpu;
  }
}

export const session = new Session();
