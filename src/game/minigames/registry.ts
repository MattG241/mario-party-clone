import type Phaser from 'phaser';
import { WORLD_MINIGAME_KEYS, WORLD_MINIGAME_SCENES } from '../worlds/scenes';

/**
 * Every playable minigame scene: each character world registers its games through its own
 * src/game/worlds/<id>/info.ts and scenes.ts.
 */
export const ALL_MINIGAME_SCENES: Phaser.Types.Scenes.SceneType[] = [
  ...WORLD_MINIGAME_SCENES,
];

const KEYS = new Set([...WORLD_MINIGAME_KEYS]);

export function registeredMinigames(): Set<string> {
  return KEYS;
}
