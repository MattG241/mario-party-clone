import type { WorldMinigameInfo } from '../types';

/**
 * Adam Sandler's minigame (world 'showtime', built alongside the Capitol sports games): metadata.
 * Pure data: no scene imports. Arena render: scripts/art/worlds/sports/mg_rink.py.
 */
export const RINK_INFO: WorldMinigameInfo = {
  infos: [
    {
      id: 'slapshot',
      sceneKey: 'mg-slapshot',
      name: 'Slapshot Showdown',
      tagline: 'Guard your goal, blast the puck!',
      description:
        'A four-sided ice rink under the Showtime lights: everyone guards the goal on their side. Grab the puck, wind up a slapshot and fire it into a rival goal — but every goal you let in costs you. A second puck drops in for the finale!',
      instructions: [
        'Skate into the puck to pick it up',
        'Hold A to wind up a slapshot, let go to fire',
        'Score in a rival goal for +2 — letting one in costs 1',
        'No puck? A checks. Last 10 s: a second puck!',
      ],
      controls: [
        { button: 'STICK', label: 'Skate / aim' },
        { button: 'A', label: 'Shoot / check' },
      ],
      players: '2–4 players',
      duration: '60 s',
      color: 0x3aa7e0,
      preview: { texture: 'items', frame: '0', scale: 0.7 },
      arena: 'rendered-scene-rink_arena',
      ruleIcons: [null, null, null, { texture: 'prism-relic' }],
      world: 'showtime',
      characters: ['sandler'],
    },
  ],
  renders: {
    slapshot: { images: ['rink_arena', 'rink_arena_blur'] },
  },
};
