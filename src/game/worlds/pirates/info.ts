import type { WorldMinigameInfo } from '../types';

/**
 * Pirate Cove minigames (Luffy, Zoro, Nami): metadata. Pure data: no scene imports. The scenes live in
 * ./games and register through ./scenes.ts; their arenas are rendered by
 * scripts/art/worlds/pirates/mg_{deck,harbour,stormbay}.py.
 */
export const PIRATES_INFO: WorldMinigameInfo = {
  infos: [
    {
      id: 'stretch-snatch',
      sceneKey: 'mg-stretch-snatch',
      name: 'Stretch & Snatch',
      tagline: 'Reach across the spinning feast!',
      description:
        'A feast table spins on a pirate ship’s deck. Aim your rubbery arm, hold A to stretch it across the table and let go to snap back with whatever you grabbed. Golden roasts are worth the most — but crossed arms tangle, the cook’s rolling pin bonks and the gulls steal!',
      instructions: [
        'Aim with the stick, hold A to stretch — let go to snap back with your grab',
        'Fruit 1, drumsticks 2, golden roasts 5 — up to 3 in one reach',
        'Crossed arms tangle and drop it all; dodge the cook’s rolling pin',
        'Most food after 45 seconds wins',
      ],
      controls: [
        { button: 'STICK', label: 'Aim' },
        { button: 'A', label: 'Hold to stretch' },
      ],
      players: '1–4 players',
      duration: '45 s',
      color: 0xe5484d,
      preview: { texture: 'items', frame: '0', scale: 0.7 },
      arena: 'rendered-scene-pirates_deck',
      world: 'pirates',
      characters: ['luffy'],
    },
    {
      id: 'triple-slash',
      sceneKey: 'mg-triple-slash',
      name: 'Triple Slash',
      tagline: 'Three lanes, three blades — slice on the beat!',
      description:
        'Barrels, crates and flying fish hurtle down the cargo chutes toward you. Slice each one as it crosses the line in its lane — right on the beat for a PERFECT — and build a combo. Let the fizzing bombs roll past!',
      instructions: [
        'X slices the left lane, A the centre, B the right (or the D-pad)',
        'Slice as each one crosses the line — on the beat is PERFECT',
        'Keep slicing for a combo; a miss or a wild swing breaks it',
        'Let bombs roll past! Top score after 40 seconds wins',
      ],
      controls: [
        { button: 'X', label: 'Left' },
        { button: 'A', label: 'Centre' },
        { button: 'B', label: 'Right' },
      ],
      players: '1–4 players',
      duration: '40 s',
      color: 0x3f9e5a,
      preview: { texture: 'items', frame: '0', scale: 0.7 },
      arena: 'rendered-scene-pirates_harbour',
      world: 'pirates',
      characters: ['zoro'],
    },
    {
      id: 'storm-navigator',
      sceneKey: 'mg-storm-navigator',
      name: 'Storm Navigator',
      tagline: 'Read the wind, ride the storm!',
      description:
        'Sail your dinghy round a stormy bay scooping up floating treasure. Watch the weather vane: sailing straight into the wind stalls you, so steer across it. Dodge the lightning strikes and keep clear of the roaming whirlpool!',
      instructions: [
        'Steer with the stick — sailing into the wind stalls you',
        'Watch the vane: sail across or with the wind to go fast',
        'A pumps the sail for a burst; ram a rival to knock treasure loose',
        'Dodge lightning and the whirlpool — most treasure in 50 s wins',
      ],
      controls: [
        { button: 'STICK', label: 'Steer' },
        { button: 'A', label: 'Pump the sail' },
      ],
      players: '1–4 players',
      duration: '50 s',
      color: 0x2f7fb5,
      preview: { texture: 'items', frame: '0', scale: 0.7 },
      arena: 'rendered-scene-pirates_storm',
      world: 'pirates',
      characters: ['nami'],
    },
  ],
  renders: {
    'stretch-snatch': { images: ['pirates_deck'] },
    'triple-slash': { images: ['pirates_harbour'] },
    'storm-navigator': { images: ['pirates_storm'] },
  },
};
