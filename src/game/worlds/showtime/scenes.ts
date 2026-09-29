import type { WorldMinigameScenes } from '../types';
import { CoffeeRushScene } from './games/CoffeeRush';
import { HipShakeScene } from './games/HipShake';
import { RhinestoneRodeoScene } from './games/RhinestoneRodeo';

/** Showtime Strip minigame scene classes, registered with the game (keys match SHOWTIME_INFO's sceneKeys). */
export const SHOWTIME_SCENES: WorldMinigameScenes = {
  scenes: [HipShakeScene, CoffeeRushScene, RhinestoneRodeoScene],
  keys: ['mg-hip-shake', 'mg-coffee-rush', 'mg-rhinestone-rodeo'],
};
