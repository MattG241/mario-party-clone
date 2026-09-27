import type Phaser from 'phaser';
import { GleamGrabScene } from './games/GleamGrab';
import { OrbitDodgeScene } from './games/OrbitDodge';

/**
 * Every playable minigame scene. To add a minigame: create a BaseMinigame subclass in games/,
 * add its metadata to MINIGAMES in MinigameManager.ts, and list its class here.
 */
export const ALL_MINIGAME_SCENES: Phaser.Types.Scenes.SceneType[] = [GleamGrabScene, OrbitDodgeScene];

const KEYS = new Set(['mg-gleam-grab', 'mg-orbit-dodge']);

export function registeredMinigames(): Set<string> {
  return KEYS;
}
