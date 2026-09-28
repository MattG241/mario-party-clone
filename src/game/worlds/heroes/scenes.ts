import type { WorldMinigameScenes } from '../types';
import { RepulsorRangeScene } from './games/RepulsorRange';
import { RooftopGlideScene } from './games/RooftopGlide';
import { WebSwingScene } from './games/WebSwing';

/** Hero Heights minigame scene classes, registered with the game (keys match HEROES_INFO's sceneKeys). */
export const HEROES_SCENES: WorldMinigameScenes = {
  scenes: [RooftopGlideScene, WebSwingScene, RepulsorRangeScene],
  keys: ['mg-rooftop-glide', 'mg-web-swing', 'mg-repulsor-range'],
};
