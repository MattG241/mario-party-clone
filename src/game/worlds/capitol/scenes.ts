import type { WorldMinigameScenes } from '../types';
import { FreeThrowScene } from './games/FreeThrow';

/** Capitol Gardens minigame scene classes, registered with the game (keys match CAPITOL_INFO's sceneKeys). */
export const CAPITOL_SCENES: WorldMinigameScenes = {
  scenes: [FreeThrowScene],
  keys: ['mg-free-throw'],
};
