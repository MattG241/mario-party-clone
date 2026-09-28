import {
  STORAGE_KEYS,
  type CpuLevel,
  type EventMode,
  type GameSpeed,
  type InstructionMode,
  type RoundCount,
} from '../constants';
import { DEFAULT_KEY_BINDINGS, KEY_ACTIONS, type KeyAction } from '../input/buttons';
import { CHARACTER_IDS, type CharacterId } from '../data/characters';
import { sanitizeMappings, type PadMapping } from '../input/padProfiles';
import type { GraphicsMode } from '../perf';

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  vibration: boolean;
  /** Radial stick dead zone (0.10–0.30). */
  deadzone: number;
  screenShake: boolean;
  reducedMotion: boolean;
  largeText: boolean;
  subtitles: boolean;
  gameSpeed: GameSpeed;
  instructions: InstructionMode;
  keyBindings: Record<KeyAction, string[]>;
  /** Controller layouts recorded on the Button Setup screen, keyed by Gamepad.id. */
  padMappings: Record<string, PadMapping>;
  /** Nintendo controllers: the button labelled A confirms (true) or the bottom button does (false). */
  nintendoByLabel: boolean;
  /** Graphics level: automatic, full detail, or Lite for TVs and low-memory devices (see perf.ts). */
  graphics: GraphicsMode;
  /** Last character chosen by each player slot (pre-highlighted on the select screen). */
  lastCharacters: (CharacterId | null)[];
  /** Match defaults remembered from the previous setup. */
  rounds: RoundCount;
  cpuPlayers: boolean;
  cpuDifficulty: CpuLevel;
  boardEvents: EventMode;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  vibration: true,
  deadzone: 0.18,
  screenShake: true,
  reducedMotion: false,
  largeText: false,
  subtitles: false,
  gameSpeed: 'normal',
  instructions: 'on',
  keyBindings: cloneBindings(DEFAULT_KEY_BINDINGS),
  padMappings: {},
  nintendoByLabel: true,
  graphics: 'auto',
  lastCharacters: [null, null, null, null],
  rounds: 10,
  cpuPlayers: true,
  cpuDifficulty: 'normal',
  boardEvents: 'normal',
};

function cloneBindings(b: Record<KeyAction, string[]>): Record<KeyAction, string[]> {
  const out = {} as Record<KeyAction, string[]>;
  for (const k of KEY_ACTIONS) out[k] = [...(b[k] ?? [])];
  return out;
}

/** Minimal storage interface so tests can inject an in-memory implementation. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function browserStore(): KeyValueStore | null {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    if (!ls) return null;
    const probe = '__gleamtrail_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

type Listener = (s: Readonly<Settings>, changed: (keyof Settings)[]) => void;

export class SettingsManager {
  private data: Settings;
  private listeners = new Set<Listener>();

  constructor(private store: KeyValueStore | null = browserStore()) {
    this.data = this.load();
  }

  get(): Readonly<Settings> {
    return this.data;
  }

  set(patch: Partial<Settings>): void {
    const changed = Object.keys(patch) as (keyof Settings)[];
    this.data = { ...this.data, ...patch };
    this.persist();
    for (const l of this.listeners) l(this.data, changed);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resetBindings(): void {
    this.set({ keyBindings: cloneBindings(DEFAULT_KEY_BINDINGS) });
  }

  resetAll(): void {
    this.data = { ...DEFAULT_SETTINGS, keyBindings: cloneBindings(DEFAULT_KEY_BINDINGS), padMappings: {} };
    this.persist();
    for (const l of this.listeners) l(this.data, Object.keys(this.data) as (keyof Settings)[]);
  }

  private load(): Settings {
    const base: Settings = { ...DEFAULT_SETTINGS, keyBindings: cloneBindings(DEFAULT_KEY_BINDINGS), padMappings: {}, lastCharacters: [null, null, null, null] };
    if (!this.store) return base;
    try {
      const raw = this.store.getItem(STORAGE_KEYS.settings);
      if (!raw) return base;
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const merged: Settings = { ...base, ...sanitize(parsed) };
      // Bindings: keep defaults for any action missing from older saves.
      merged.keyBindings = cloneBindings({ ...DEFAULT_KEY_BINDINGS, ...(parsed.keyBindings ?? {}) });
      return merged;
    } catch {
      return base;
    }
  }

  private persist(): void {
    if (!this.store) return;
    try {
      this.store.setItem(STORAGE_KEYS.settings, JSON.stringify(this.data));
    } catch {
      // Storage full or blocked: settings still apply for this session.
    }
  }
}

function clamp01(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function sanitize(p: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (p.masterVolume !== undefined) out.masterVolume = clamp01(p.masterVolume, DEFAULT_SETTINGS.masterVolume);
  if (p.musicVolume !== undefined) out.musicVolume = clamp01(p.musicVolume, DEFAULT_SETTINGS.musicVolume);
  if (p.sfxVolume !== undefined) out.sfxVolume = clamp01(p.sfxVolume, DEFAULT_SETTINGS.sfxVolume);
  if (typeof p.deadzone === 'number' && Number.isFinite(p.deadzone)) out.deadzone = Math.min(0.3, Math.max(0.1, p.deadzone));
  if (p.padMappings !== undefined) out.padMappings = sanitizeMappings(p.padMappings);
  if (p.graphics === 'auto' || p.graphics === 'full' || p.graphics === 'lite') out.graphics = p.graphics;
  for (const k of ['vibration', 'screenShake', 'reducedMotion', 'largeText', 'subtitles', 'cpuPlayers', 'nintendoByLabel'] as const) {
    if (typeof p[k] === 'boolean') out[k] = p[k];
  }
  if (p.gameSpeed === 'normal' || p.gameSpeed === 'fast') out.gameSpeed = p.gameSpeed;
  if (p.instructions === 'on' || p.instructions === 'quick' || p.instructions === 'off') out.instructions = p.instructions;
  if (p.rounds === 10 || p.rounds === 15 || p.rounds === 20) out.rounds = p.rounds;
  if (p.cpuDifficulty === 'easy' || p.cpuDifficulty === 'normal' || p.cpuDifficulty === 'hard') out.cpuDifficulty = p.cpuDifficulty;
  if (p.boardEvents === 'normal' || p.boardEvents === 'chaotic') out.boardEvents = p.boardEvents;
  if (Array.isArray(p.lastCharacters)) {
    out.lastCharacters = [0, 1, 2, 3].map((i) => {
      const v = p.lastCharacters?.[i];
      return typeof v === 'string' && (CHARACTER_IDS as readonly string[]).includes(v) ? (v as CharacterId) : null;
    });
  }
  return out;
}

export const settings = new SettingsManager();
