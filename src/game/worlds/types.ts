// The guests' home worlds. Each world brings a themed board and minigames built around its
// characters; everything a world adds lives in its own folder (src/game/worlds/<id>/) and is
// gathered here, so worlds can be built side by side without touching shared files.
import type Phaser from 'phaser';
import type { BoardEventDef } from '../board/EventManager';
import type { BoardDef } from '../board/types';
import type { CharacterId } from '../data/characters';
import type { RenderSet } from '../data/minigameRenders';
import type { MinigameInfo } from '../minigames/MinigameManager';

export interface WorldDef {
  id: string;
  /** Display name ("Pirate Cove"). */
  name: string;
  /** Short name for tabs and chips. */
  short: string;
  /** The guests this world celebrates. */
  cast: CharacterId[];
  /** Accent colour for tabs, cards and banners. */
  color: number;
}

/** A world's minigame metadata (pure data: safe to import anywhere, no scene classes). */
export interface WorldMinigameInfo {
  infos: MinigameInfo[];
  /** Rendered arena art per minigame id, lazy-loaded with its intro card (see minigameRenders). */
  renders?: Record<string, RenderSet>;
}

/** A world's minigame scenes (imported only by the scene registry). */
export interface WorldMinigameScenes {
  scenes: Phaser.Types.Scenes.SceneType[];
  /** The scene key of every class in `scenes` (mg-<id>). */
  keys: string[];
}

export type { BoardDef, BoardEventDef };
