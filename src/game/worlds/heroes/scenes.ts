import type { WorldMinigameScenes } from '../types';
import { RooftopGlideScene } from './games/RooftopGlide';

/** Hero Heights minigame scene classes, registered with the game (keys match HEROES_INFO's sceneKeys). */
export const HEROES_SCENES: WorldMinigameScenes = {
  scenes: [RooftopGlideScene],
  keys: ['mg-rooftop-glide'],
};
