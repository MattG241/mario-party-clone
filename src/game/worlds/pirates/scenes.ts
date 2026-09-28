import type { WorldMinigameScenes } from '../types';
import { StretchSnatchScene } from './games/StretchSnatch';
import { TripleSlashScene } from './games/TripleSlash';

/** Pirate Cove minigame scene classes, registered with the game (keys match PIRATES_INFO's sceneKeys). */
export const PIRATES_SCENES: WorldMinigameScenes = {
  scenes: [StretchSnatchScene, TripleSlashScene],
  keys: ['mg-stretch-snatch', 'mg-triple-slash'],
};
