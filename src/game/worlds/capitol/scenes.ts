import type { WorldMinigameScenes } from '../types';
import { FairwayScene } from './games/Fairway';
import { FreeThrowScene } from './games/FreeThrow';

/** Capitol Gardens minigame scene classes, registered with the game (keys match CAPITOL_INFO's sceneKeys). */
export const CAPITOL_SCENES: WorldMinigameScenes = {
  scenes: [FreeThrowScene, FairwayScene],
  keys: ['mg-free-throw', 'mg-fairway'],
};
