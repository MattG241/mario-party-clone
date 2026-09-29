import type { CpuLevel } from '../constants';
import type { SvgAsset } from '../data/assets';
import type { CharacterId } from '../data/characters';
import type { Placement } from '../state/scoring';
import type { PromptButton } from '../ui/ControllerPrompt';
import type { Random } from '../util/Random';
import { WORLD_MINIGAME_INFOS } from '../worlds/infos';

export interface MinigameInfo {
  id: string;
  sceneKey: string;
  name: string;
  tagline: string;
  description: string;
  instructions: string[];
  controls: { button: PromptButton; label: string }[];
  players: string;
  duration: string;
  color: number;
  /** Card art (atlas frame or placeholder texture). */
  preview: { texture: string; frame?: string; scale: number };
  teamGame?: boolean;
  /** Minigame-specific placeholder art, lazy-loaded by the intro screen. */
  assets?: SvgAsset[];
  /** Pre-rendered arena texture (shown as a live preview on the intro card). */
  arena?: string;
  /** Optional icon per instruction line on the intro card (atlas frame or texture). */
  ruleIcons?: ({ texture: string; frame?: string } | null)[];
  /** The world it belongs to (src/game/worlds/index.ts); the original set is 'festival'. */
  world?: string;
  /** The guests it's themed on (shown on its card, favoured on their world's board). */
  characters?: CharacterId[];
}

export interface MinigamePlayer {
  slot: number;
  characterId: CharacterId;
  isCpu: boolean;
  cpuLevel: CpuLevel;
}

export interface MinigameLaunch {
  id: string;
  players: MinigamePlayer[];
  mode: 'board' | 'free';
  seed: number;
  /** Instruction screen preference for this launch. */
  instructions: 'on' | 'quick' | 'off';
}

export interface MinigameResult {
  id: string;
  placements: Placement[];
  scores: { slot: number; score: number; label: string }[];
}


/** Every minigame: each character world's set (src/game/worlds/<id>/info.ts). */
export const MINIGAMES: MinigameInfo[] = [...WORLD_MINIGAME_INFOS];

export function minigameInfo(id: string): MinigameInfo | undefined {
  return MINIGAMES.find((m) => m.id === id);
}

/** Minigames whose scenes are registered (i.e. playable). */
export function availableMinigames(registered: Set<string>): MinigameInfo[] {
  return MINIGAMES.filter((m) => registered.has(m.sceneKey));
}

/**
 * Pick the next board minigame: never the same as the last two, and prefer ones played least.
 * Team games need at least three players.
 */
export function pickMinigame(pool: MinigameInfo[], history: readonly string[], playerCount: number, rng: Random, favour: readonly string[] = []): MinigameInfo {
  let candidates = pool.filter((m) => !(m.teamGame && playerCount < 3));
  if (candidates.length === 0) candidates = pool;
  // A themed board leans on its own world's games: about half the time, if one is fresh.
  if (favour.length && rng.next() < 0.5) {
    const recent2 = history.slice(-2);
    const themed = candidates.filter((m) => favour.includes(m.id) && !recent2.includes(m.id));
    if (themed.length) candidates = themed;
  }
  const recent = history.slice(-2);
  const fresh = candidates.filter((m) => !recent.includes(m.id));
  const list = fresh.length ? fresh : candidates;
  const counts = new Map<string, number>();
  for (const h of history) counts.set(h, (counts.get(h) ?? 0) + 1);
  const least = Math.min(...list.map((m) => counts.get(m.id) ?? 0));
  const leastPlayed = list.filter((m) => (counts.get(m.id) ?? 0) === least);
  return rng.pick(leastPlayed);
}
