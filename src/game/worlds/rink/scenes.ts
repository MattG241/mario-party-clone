import type { WorldMinigameScenes } from '../types';
import { SlapshotScene } from './games/Slapshot';

/** Adam Sandler's minigame scene (keys match RINK_INFO's sceneKeys). */
export const RINK_SCENES: WorldMinigameScenes = { scenes: [SlapshotScene], keys: ['mg-slapshot'] };
