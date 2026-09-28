import type { WorldMinigameScenes } from '../types';
import { HipShakeScene } from './games/HipShake';

/** Showtime Strip minigame scene classes, registered with the game (keys match SHOWTIME_INFO's sceneKeys). */
export const SHOWTIME_SCENES: WorldMinigameScenes = {
  scenes: [HipShakeScene],
  keys: ['mg-hip-shake'],
};
