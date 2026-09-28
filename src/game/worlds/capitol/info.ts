import type { WorldMinigameInfo } from '../types';

/**
 * Capitol Gardens minigames: Barack Obama's and Donald Trump's favourite sports on the garden lawns.
 * Pure data: no scene imports. Arena renders: scripts/art/worlds/sports/mg_court.py, mg_green.py.
 */
export const CAPITOL_INFO: WorldMinigameInfo = {
  infos: [
    {
      id: 'free-throw',
      sceneKey: 'mg-free-throw',
      name: 'Free Throw Frenzy',
      tagline: 'Shoot hoops on the garden court!',
      description:
        'Shoot hoops on a sunny garden court. Stop the power bar in the green, then the aim needle — swishes score a bonus, the golden ball of every rack doubles it, and in the final seconds the hoop starts to slide!',
      instructions: [
        'Press A to stop the power bar in the green',
        'Press A again to stop the aim needle in the green',
        'A basket scores 2, a swish 3 — the golden ball doubles it',
        'The hoop slides for the last 10 seconds — most points wins',
      ],
      controls: [{ button: 'A', label: 'Power, then aim' }],
      players: '1–4 players',
      duration: '45 s',
      color: 0xee7a2f,
      preview: { texture: 'items', frame: '0', scale: 0.7 },
      arena: 'rendered-scene-capitol_court',
      ruleIcons: [null, null, null, { texture: 'prism-relic' }],
      world: 'capitol',
      characters: ['obama'],
    },
  ],
  renders: {
    'free-throw': { images: ['capitol_court', 'capitol_court_blur'] },
  },
};
