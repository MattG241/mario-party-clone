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
    'Arrows fall to your shape: push the stick that way on the beat',
    'Stars are poses: press A on the beat',
    'PERFECT on the beat; 8 in a row raises your multiplier',
    'Top score wins; the final 10 seconds are an encore worth double',
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

const COFFEE_RUSH: MinigameInfo = {
  id: 'coffee-rush',
  sceneKey: 'mg-coffee-rush',
  name: 'Coffee Rush',
  tagline: 'Pull the perfect shot, swirl the perfect heart!',
  description: 'Behind the counter of a pastel café: pull espresso shots right to the line, pour latte art and serve every customer before they give up waiting. Perfect pours score more.',
  instructions: [
    'Hold A to pull a shot; let go on the gold fill line',
    'Then tap A as the milk swirl passes the pink heart',
    'Serve before the order ring runs out; perfect pours score more',
    'Most points wins; the last 10 seconds are rush hour, worth double',
  ],
  controls: [
    { button: 'A', label: 'Hold: pour / Tap: swirl' },
  ],
  players: '1–4 players',
  duration: '50 s',
  color: 0xf7a1c4,
  preview: { texture: 'hero_sabrina', frame: '45', scale: 0.55 },
  arena: 'rendered-scene-showtime_cafe',
  ruleIcons: [null, null, null, STAR],
  world: 'showtime',
  characters: ['sabrina'],
};

const RHINESTONE_RODEO: MinigameInfo = {
  id: 'rhinestone-rodeo',
  sceneKey: 'mg-rhinestone-rodeo',
  name: 'Rhinestone Rodeo',
  tagline: 'Hold on to your hat, partner!',
  description: 'Ride a sparkly mechanical pony in a pink honky-tonk ring. Every buck is telegraphed: lean the right way to stay in the saddle. The bucks get wilder and wilder!',
  instructions: [
    'Before each buck your pony tips one way; an arrow shows which',
    'Lean that way with the stick before it bucks to stay on',
    'Thrown off? You lose 2 seconds and climb back on',
    'The bucks get wilder: longest time in the saddle wins',
  ],
  controls: [{ button: 'STICK', label: 'Lean' }],
  players: '1–4 players',
  duration: '45 s',
  color: 0xff5fa8,
  preview: { texture: 'hero_chappell', frame: '48', scale: 0.55 },
  arena: 'rendered-scene-showtime_rodeo',
  ruleIcons: [null, null, null, STAR],
  world: 'showtime',
  characters: ['chappell'],
};

/** Showtime Strip minigame metadata. Pure data: no scene imports. (Adam Sandler's game lives in worlds/rink.) */
export const SHOWTIME_INFO: WorldMinigameInfo = {
  infos: [HIP_SHAKE, COFFEE_RUSH, RHINESTONE_RODEO],
  renders: {
    'hip-shake': { images: ['showtime_stage'] },
    'coffee-rush': { images: ['showtime_cafe', 'showtime_cafe_counter'] },
    'rhinestone-rodeo': { images: ['showtime_rodeo'] },
  },
};
