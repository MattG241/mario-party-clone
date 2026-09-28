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

export const HEROES_INFO: WorldMinigameInfo = {
  infos: [ROOFTOP_GLIDE],
  renders: {
    'rooftop-glide': { images: ['heroes_rooftops', 'heroes_rooftops_blur', 'heroes_icon_cape', 'heroes_icon_vent', 'heroes_icon_clue', 'heroes_icon_lamp'] },
  },
};
