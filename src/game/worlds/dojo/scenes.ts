import type { WorldMinigameScenes } from '../types';
import { CloneChaosScene } from './games/CloneChaos';
import { CloudRiderScene } from './games/CloudRider';

/** Dojo Summit's minigame scenes (keys match DOJO_INFO's sceneKeys). */
export const DOJO_SCENES: WorldMinigameScenes = {
  scenes: [CloudRiderScene, CloneChaosScene],
  keys: ['mg-cloud-rider', 'mg-clone-chaos'],
};
