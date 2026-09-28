import type Phaser from 'phaser';
import { CrateCrazeScene } from './games/CrateCraze';
import { SkybridgeScrambleScene } from './games/SkybridgeScramble';
import { TotemTugScene } from './games/TotemTug';
import { SpiralSplashScene } from './games/SpiralSplash';
import { RelicRelayScene } from './games/RelicRelay';
import { TumbleTowerScene } from './games/TumbleTower';
import { GleamGrabScene } from './games/GleamGrab';
import { OrbitDodgeScene } from './games/OrbitDodge';
import { WORLD_MINIGAME_KEYS, WORLD_MINIGAME_SCENES } from '../worlds/scenes';

/**
 * Every playable minigame scene. To add one to the original set: create a BaseMinigame subclass in
 * games/, add its metadata to CORE_MINIGAMES in MinigameManager.ts, and list its class here. A
 * world's minigames register through its own src/game/worlds/<id>/info.ts and scenes.ts instead.
 */
export const ALL_MINIGAME_SCENES: Phaser.Types.Scenes.SceneType[] = [
  GleamGrabScene,
  OrbitDodgeScene,
  CrateCrazeScene,
  SkybridgeScrambleScene,
  TotemTugScene,
  SpiralSplashScene,
  RelicRelayScene,
  TumbleTowerScene,
  // The guests' worlds (src/game/worlds/<id>/scenes.ts).
  ...WORLD_MINIGAME_SCENES,
];

const KEYS = new Set(['mg-gleam-grab', 'mg-orbit-dodge', 'mg-crate-craze', 'mg-skybridge-scramble', 'mg-totem-tug', 'mg-spiral-splash', 'mg-relic-relay', 'mg-tumble-tower', ...WORLD_MINIGAME_KEYS]);

export function registeredMinigames(): Set<string> {
  return KEYS;
}
