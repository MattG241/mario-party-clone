import type { MinigameInfo } from '../../minigames/MinigameManager';
import type { WorldMinigameInfo } from '../types';

// Hero Heights minigames (Batman, Spider-Man, Iron Man). Pure data: no scene imports.
// Arena art: public/assets/rendered/scene_heroes_*.webp (scripts/art/worlds/heroes/). Each set also
// carries a pre-blurred backdrop for the intro card (`<arena>_blur`) and the rule icons, which load
// with it while the card is up.

const ROOFTOP_GLIDE: MinigameInfo = {
  id: 'rooftop-glide',
  sceneKey: 'mg-rooftop-glide',
  name: 'Rooftop Glide',
  tagline: 'Glide the night skyline and dodge the searchlights!',
  description:
    'Cape-glide over the rooftops of Hero Heights at night. Ride the warm air rising from the vents, swoop onto glowing clues and keep out of the sweeping searchlights: get spotted and you drop a clue for someone else to grab.',
  instructions: [
    'Hold A to glide on your cape, let go to dive',
    'Open the cape out of a dive to swoop up; vents lift you high',
    'Grab glowing clues: gold ones are worth 3',
    'Searchlights daze you and shake a clue loose! Most clues in 45 s wins',
  ],
  controls: [
    { button: 'STICK', label: 'Steer' },
    { button: 'A', label: 'Glide (hold)' },
  ],
  players: '1–4 players',
  duration: '45 s',
  color: 0x4a5fc1,
  preview: { texture: 'items', frame: '18', scale: 0.7 },
  arena: 'rendered-scene-heroes_rooftops',
  ruleIcons: [
    { texture: 'rendered-scene-heroes_icon_cape' },
    { texture: 'rendered-scene-heroes_icon_vent' },
    { texture: 'rendered-scene-heroes_icon_clue' },
    { texture: 'rendered-scene-heroes_icon_lamp' },
  ],
  world: 'heroes',
  characters: ['batman'],
};

const WEB_SWING: MinigameInfo = {
  id: 'web-swing',
  sceneKey: 'mg-web-swing',
  name: 'Web Swing',
  tagline: 'Swing across the skyline to the finish tower!',
  description:
    'A race over the rooftops of Hero Heights at sunset. Web the glowing anchor points, swing, and let go on the upswing to fling yourself onward. Chain swing after swing; miss and you drop to the street and lose time.',
  instructions: [
    'Press A to web the nearest glowing anchor, hold to swing',
    'Let go as you swing up for a PERFECT fling',
    'Miss and you drop to the street, losing time',
    'First to the finish tower wins (or furthest after 50 s)',
  ],
  controls: [
    { button: 'A', label: 'Web (hold to swing)' },
    { button: 'STICK', label: 'Lean' },
  ],
  players: '1–4 players',
  duration: '50 s',
  color: 0xe0485a,
  preview: { texture: 'items', frame: '18', scale: 0.7 },
  arena: 'rendered-scene-heroes_skyline_card',
  ruleIcons: [
    { texture: 'rendered-scene-heroes_icon_web' },
    { texture: 'rendered-scene-heroes_icon_fling' },
    { texture: 'rendered-scene-heroes_icon_street' },
    { texture: 'rendered-scene-heroes_icon_flag' },
  ],
  world: 'heroes',
  characters: ['spiderman'],
};

const REPULSOR_RANGE: MinigameInfo = {
  id: 'repulsor-range',
  sceneKey: 'mg-repulsor-range',
  name: 'Repulsor Range',
  tagline: 'Blast the drones, spare the balloons!',
  description:
    'Hover over the Hero Heights test range at dusk and put your blasters to the test. Aim with the stick, tap A for quick blasts or charge a big one, pop drones and targets for points and keep a combo going. Never hit the passenger balloons!',
  instructions: [
    'Aim your reticle with the stick',
    'Tap A: quick blast. Hold A and let go: a big charged blast',
    'Pop drones and targets; keep hitting for a combo',
    'Hitting a balloon costs 3 points! Top score in 45 s wins',
  ],
  controls: [
    { button: 'STICK', label: 'Aim' },
    { button: 'A', label: 'Blast (hold to charge)' },
  ],
  players: '1–4 players',
  duration: '45 s',
  color: 0xd9a02a,
  preview: { texture: 'items', frame: '18', scale: 0.7 },
  arena: 'rendered-scene-heroes_range',
  ruleIcons: [
    { texture: 'rendered-scene-heroes_icon_reticle' },
    { texture: 'rendered-scene-heroes_icon_blast' },
    { texture: 'rendered-scene-heroes_icon_drone' },
    { texture: 'rendered-scene-heroes_icon_balloon' },
  ],
  world: 'heroes',
  characters: ['ironman'],
};

export const HEROES_INFO: WorldMinigameInfo = {
  infos: [ROOFTOP_GLIDE, WEB_SWING, REPULSOR_RANGE],
  renders: {
    'rooftop-glide': { images: ['heroes_rooftops', 'heroes_rooftops_blur', 'heroes_icon_cape', 'heroes_icon_vent', 'heroes_icon_clue', 'heroes_icon_lamp'] },
    'web-swing': { images: ['heroes_skyline_card', 'heroes_skyline_card_blur', 'heroes_skyline', 'heroes_icon_web', 'heroes_icon_fling', 'heroes_icon_street', 'heroes_icon_flag'] },
    'repulsor-range': { images: ['heroes_range', 'heroes_range_blur', 'heroes_icon_reticle', 'heroes_icon_blast', 'heroes_icon_drone', 'heroes_icon_balloon'] },
  },
};
