import type { WorldMinigameInfo } from '../types';

/**
 * Dojo Summit's minigames (pure data: no scene imports). Arenas are rendered by
 * scripts/art/worlds/dojo/mg_cloud_rider.py and mg_clone_chaos.py; the gameplay sprites by mg_sprites.py.
 */
export const DOJO_INFO: WorldMinigameInfo = {
  infos: [
    {
      id: 'cloud-rider',
      sceneKey: 'mg-cloud-rider',
      name: 'Cloud Rider',
      tagline: 'Surf the golden clouds between the peaks!',
      description:
        'Ride a little golden cloud through a sky course between the mountain peaks. Fly through rings, grab glowing energy orbs and burst ahead to bump rivals off their line, but steer clear of storm clouds and wind gusts!',
      instructions: [
        'Steer up and down: fly through rings (+1) and energy orbs (+3)',
        'Hold A to charge, let go to burst ahead: ram rivals to knock rings loose',
        'Storm clouds zap you and gusts push you off course: watch for their warnings',
        'Most rings after 45 seconds wins',
      ],
      controls: [
        { button: 'STICK', label: 'Steer' },
        { button: 'A', label: 'Hold: charge · Let go: burst' },
      ],
      players: '1–4 players',
      duration: '45 s',
      color: 0xf5a524,
      preview: { texture: 'prism-relic', scale: 0.8 },
      arena: 'rendered-scene-dojo_sky',
      ruleIcons: [null, null, null, { texture: 'prism-relic' }],
      world: 'dojo',
      characters: ['goku'],
    },
    {
      id: 'clone-chaos',
      sceneKey: 'mg-clone-chaos',
      name: 'Clone Chaos',
      tagline: 'Which one is the real ninja?',
      description:
        'A ninja hides among a crowd of identical smoke clones that leap and shuffle across the village rooftops. Keep your eyes on the real one and lock in your pick before the smoke clears: quick, correct answers score the most. Five rounds, each faster and trickier than the last.',
      instructions: [
        'Watch the real ninja: smoke clones pop up and shuffle across the rooftops',
        'When they stop, move your marker and press A to lock in your pick',
        'Right and fast scores most (up to +5): the clones play tricks, trust your eyes!',
        'Five rounds (the last counts double): most points wins',
      ],
      controls: [
        { button: 'STICK', label: 'Move marker' },
        { button: 'A', label: 'Lock in' },
      ],
      players: '1–4 players',
      duration: '5 rounds',
      color: 0xff8a1f,
      preview: { texture: 'prism-relic', scale: 0.8 },
      arena: 'rendered-scene-dojo_roofs',
      ruleIcons: [null, null, null, { texture: 'prism-relic' }],
      world: 'dojo',
      characters: ['naruto'],
    },
  ],
  renders: {
    'cloud-rider': { images: ['dojo_sky', 'dojo_sky_peaks', 'dojo_sky_near'] },
    'clone-chaos': { images: ['dojo_roofs'] },
  },
};
