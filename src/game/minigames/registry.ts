import type Phaser from 'phaser';
import { CrateCrazeScene } from './games/CrateCraze';
import { SkybridgeScrambleScene } from './games/SkybridgeScramble';
import { TotemTugScene } from './games/TotemTug';
import { SpiralSplashScene } from './games/SpiralSplash';
import { RelicRelayScene } from './games/RelicRelay';
import { TumbleTowerScene } from './games/TumbleTower';
import { GleamGrabScene } from './games/GleamGrab';
import { OrbitDodgeScene } from './games/OrbitDodge';

/**
 * Every playable minigame scene. To add a minigame: create a BaseMinigame subclass in games/,
 * add its metadata to MINIGAMES in MinigameManager.ts, and list its class here.
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
];

const KEYS = new Set(['mg-gleam-grab', 'mg-orbit-dodge', 'mg-crate-craze', 'mg-skybridge-scramble', 'mg-totem-tug', 'mg-spiral-splash', 'mg-relic-relay', 'mg-tumble-tower']);

export function registeredMinigames(): Set<string> {
  return KEYS;
}
