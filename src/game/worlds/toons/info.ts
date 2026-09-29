import type { WorldMinigameInfo } from '../types';

// Cartoon Coast's minigames, one for each of its guests. Pure data: no scene imports.
// Arena art: scripts/art/worlds/toons/mg_*.py -> public/assets/rendered/scene_toons_*.webp (+ Lite).
// The small scene_toons_ic_* images are the intro card's rule icons (loaded with the arena).

/** The last rule line ("most ... wins") shows the game's Star Coin icon (internal key 'prism-relic'). */
const WIN_ICON = { texture: 'prism-relic' };

export const TOONS_INFO: WorldMinigameInfo = {
  infos: [
    {
      id: 'ring-rush',
      sceneKey: 'mg-ring-rush',
      name: 'Ring Rush',
      tagline: 'Race the checkered hills and grab every ring!',
      description:
        'Four lanes of checkered hills rush past. Hop between lanes to scoop up rings, jump the wind-up crawler bots and spin-dash through the propeller bots. Get bonked and your rings go flying for anyone to grab!',
      instructions: [
        'Up / Down switches lanes: follow the rings',
        'A jumps crawler bots; X spin-dashes through any bot (and rivals!)',
        'A bot hit scatters your rings for anyone to grab',
        'Most rings after 45 seconds wins',
      ],
      controls: [
        { button: 'STICK', label: 'Lanes' },
        { button: 'A', label: 'Jump' },
        { button: 'X', label: 'Spin-dash' },
      ],
      players: '1–4 players',
      duration: '45 s',
      color: 0x1e63d6,
      preview: { texture: 'rendered-scene-toons_ic_ring', scale: 1 },
      arena: 'rendered-scene-toons_rush',
      ruleIcons: [{ texture: 'rendered-scene-toons_ic_ring' }, { texture: 'rendered-scene-toons_ic_turtle' }, { texture: 'rendered-scene-toons_ic_heli' }, WIN_ICON],
      world: 'toons',
      characters: ['sonic'],
    },
    {
      id: 'patty-panic',
      sceneKey: 'mg-patty-panic',
      name: 'Patty Panic',
      tagline: 'Order up! Stack them fast and stack them right!',
      description:
        'The undersea diner is packed! Each ticket shows a burger from the bottom bun up. Press each topping’s button in order to stack it, and serve it before the customer loses patience. One wrong button and the whole stack topples!',
      instructions: [
        'Each ticket shows a burger, bottom to top',
        'Press the toppings in order: X patty, A lettuce, B tomato, Y cheese',
        'A wrong button topples the stack: start again!',
        'Serve before the customer gives up: most orders in 50 seconds wins',
      ],
      controls: [
        { button: 'X', label: 'Patty' },
        { button: 'A', label: 'Lettuce' },
        { button: 'B', label: 'Tomato' },
        { button: 'Y', label: 'Cheese' },
      ],
      players: '1–4 players',
      duration: '50 s',
      color: 0xf2c418,
      preview: { texture: 'rendered-scene-toons_ic_burger', scale: 1 },
      arena: 'rendered-scene-toons_kitchen',
      ruleIcons: [{ texture: 'rendered-scene-toons_ic_burger' }, { texture: 'rendered-scene-toons_ic_patty' }, { texture: 'rendered-scene-toons_ic_fish' }, WIN_ICON],
      world: 'toons',
      characters: ['spongebob'],
    },
    {
      id: 'donut-dash',
      sceneKey: 'mg-donut-dash',
      name: 'Donut Dash',
      tagline: 'Catch your colour, dodge the broccoli!',
      description:
        'Five conveyor belts roll fresh donuts out of the ovens and toss them across the factory floor. Catch the ones frosted in your colour, grab the rainbow ones before anyone else and keep clear of the broccoli and the burnt ones. The belts keep speeding up!',
      instructions: [
        'Catch donuts frosted in your colour (your shape shows on their landing ring)',
        'Rainbow donuts count double for anyone; broccoli and burnt ones cost a donut',
        'A dashes, and bumps rivals off a good spot',
        'The belts speed up: most donuts after 45 seconds wins',
      ],
      controls: [
        { button: 'STICK', label: 'Move' },
        { button: 'A', label: 'Dash' },
      ],
      players: '1–4 players',
      duration: '45 s',
      color: 0xff8fb1,
      preview: { texture: 'rendered-scene-toons_ic_donut', scale: 1 },
      arena: 'rendered-scene-toons_donut',
      ruleIcons: [{ texture: 'rendered-scene-toons_ic_donut' }, { texture: 'rendered-scene-toons_ic_broccoli' }, { texture: 'rendered-scene-toons_ic_box' }, WIN_ICON],
      world: 'toons',
      characters: ['homer'],
    },
  ],
  renders: {
    'ring-rush': { images: ['toons_rush', 'toons_rush_far', 'toons_rush_track', 'toons_ic_ring', 'toons_ic_turtle', 'toons_ic_heli'] },
    'patty-panic': { images: ['toons_kitchen', 'toons_kitchen_front', 'toons_ic_burger', 'toons_ic_patty', 'toons_ic_fish'] },
    'donut-dash': { images: ['toons_donut', 'toons_ic_donut', 'toons_ic_broccoli', 'toons_ic_box'] },
  },
};
