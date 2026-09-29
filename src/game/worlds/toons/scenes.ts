import type { WorldMinigameScenes } from '../types';
import { DonutDashScene } from './games/DonutDash';
import { PattyPanicScene } from './games/PattyPanic';
import { RingRushScene } from './games/RingRush';

/** Cartoon Coast's minigame scenes (keys must match TOONS_INFO's sceneKeys). */
export const TOONS_SCENES: WorldMinigameScenes = {
  scenes: [RingRushScene, PattyPanicScene, DonutDashScene],
  keys: ['mg-ring-rush', 'mg-patty-panic', 'mg-donut-dash'],
};
