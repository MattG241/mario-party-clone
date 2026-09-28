import type { MinigameInfo } from '../../minigames/MinigameManager';
import type { WorldMinigameInfo } from '../types';

/** The "wins" line of each card gets the Star Coin icon, like the festival games. */
const STAR = { texture: 'prism-relic' };

const HIP_SHAKE: MinigameInfo = {
  id: 'hip-shake',
  sceneKey: 'mg-hip-shake',
  name: 'Hip-Shake Hustle',
  tagline: 'Rock the bandshell, right on the beat!',
  description: 'A rock-and-roll dance-off on a 1950s bandshell. Moves fall down your spotlight in time with the band: hit them on the beat, chain streaks and make the crowd swoon.',
  instructions: [
    'Arrows fall down your spotlight: push that way (stick or D-pad) as one reaches your shape',
    'Stars are poses: press A on the beat',
    'On the beat is PERFECT; every 8 in a row raises your multiplier',
    'Top score after 45 seconds wins; the final 10 are an encore worth double',
  ],
  controls: [
    { button: 'STICK', label: 'Dance moves' },
    { button: 'A', label: 'Pose' },
  ],
  players: '1–4 players',
  duration: '45 s',
  color: 0xff4f8b,
  preview: { texture: 'hero_elvis', frame: '42', scale: 0.55 },
  arena: 'rendered-scene-showtime_stage',
  ruleIcons: [null, null, null, STAR],
  world: 'showtime',
  characters: ['elvis'],
};

/** Showtime Strip minigame metadata. Pure data: no scene imports. (Adam Sandler's game lives in worlds/rink.) */
export const SHOWTIME_INFO: WorldMinigameInfo = {
  infos: [HIP_SHAKE],
  renders: {
    'hip-shake': { images: ['showtime_stage'] },
  },
};
