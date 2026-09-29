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
        'Last 10 seconds: the hoop slides, baskets +1 — most points wins',
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
    {
      id: 'fairway',
      sceneKey: 'mg-fairway',
      name: 'Fairway Frenzy',
      tagline: 'Pitch and putt on the rolling green!',
      description:
        'Pitch and putt on a rolling green in the gardens. Aim, hold A to power up and let go — the tee shot rides the wind and the ball rolls with the slopes. Hole out in fewer strokes for more points; when time runs out on a hole, the ball closest to the pin scores too.',
      instructions: [
        'Stick aims, hold A to power up, let go to hit',
        'Tee shots fly through the wind; then the ball rolls with the slope',
        'Hole out in 1 stroke for 5, in 2 for 3, in 3 for 2',
        'Closest to the pin when a hole ends scores 2 — last 10 s double',
      ],
      controls: [
        { button: 'STICK', label: 'Aim' },
        { button: 'A', label: 'Hold: power' },
      ],
      players: '1–4 players',
      duration: '50 s',
      color: 0x4caf50,
      preview: { texture: 'items', frame: '0', scale: 0.7 },
      arena: 'rendered-scene-capitol_green',
      ruleIcons: [null, null, null, { texture: 'prism-relic' }],
      world: 'capitol',
      characters: ['trump'],
    },
  ],
  renders: {
    'free-throw': { images: ['capitol_court', 'capitol_court_blur'] },
    fairway: { images: ['capitol_green', 'capitol_green_blur'] },
  },
};
