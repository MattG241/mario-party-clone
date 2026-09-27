// Asset manifest. Paths are relative to the site root (public/).
//
// Supplied sprite sheets live in public/assets/sprites/ and are processed into trimmed atlases
// (public/assets/atlases/) by `npm run sprites`. Placeholder art lives in
// public/assets/placeholders/ and can be swapped for final art by replacing the files.

export const ATLAS_KEYS = ['kip', 'mossi', 'tumble', 'zippa', 'boardfx', 'npcs', 'actions', 'vfx', 'items', 'props'] as const;
export type AtlasKey = (typeof ATLAS_KEYS)[number];

export interface SvgAsset {
  key: string;
  path: string;
  width: number;
  height: number;
}

const P = 'assets/placeholders/';

/** Placeholder art needed across the game (preloaded). */
export const COMMON_SVGS: SvgAsset[] = [
  { key: 'bg-sky', path: `${P}bg/sky.svg`, width: 1920, height: 1080 },
  { key: 'bg-clouds-far', path: `${P}bg/clouds_far.svg`, width: 2048, height: 420 },
  { key: 'bg-clouds-below', path: `${P}bg/clouds_below.svg`, width: 2048, height: 560 },
  { key: 'bg-islands-far', path: `${P}bg/islands_far.svg`, width: 2048, height: 640 },
  { key: 'island-large', path: `${P}board/island_large.svg`, width: 1000, height: 640 },
  { key: 'island-wide', path: `${P}board/island_wide.svg`, width: 1180, height: 560 },
  { key: 'island-medium', path: `${P}board/island_medium.svg`, width: 660, height: 460 },
  { key: 'island-small', path: `${P}board/island_small.svg`, width: 400, height: 320 },
  { key: 'island-tiny', path: `${P}board/island_tiny.svg`, width: 240, height: 210 },
  { key: 'observatory', path: `${P}board/observatory.svg`, width: 460, height: 700 },
  { key: 'tree-twist', path: `${P}board/tree_twist.svg`, width: 520, height: 700 },
  { key: 'crystal-generator', path: `${P}board/crystal_generator.svg`, width: 320, height: 400 },
  { key: 'bunting', path: `${P}board/bunting.svg`, width: 640, height: 140 },
  { key: 'lantern', path: `${P}board/lantern.svg`, width: 80, height: 120 },
  { key: 'windmill', path: `${P}board/windmill.svg`, width: 280, height: 390 },
  { key: 'workshop', path: `${P}board/workshop.svg`, width: 340, height: 300 },
  { key: 'stall', path: `${P}board/stall.svg`, width: 320, height: 300 },
  { key: 'relic-pedestal', path: `${P}board/relic_pedestal.svg`, width: 160, height: 130 },
  { key: 'prism-gate', path: `${P}board/prism_gate.svg`, width: 200, height: 240 },
  { key: 'cloud-puff', path: `${P}board/cloud_puff.svg`, width: 280, height: 150 },
  { key: 'space-start', path: `${P}board/space_start.svg`, width: 128, height: 88 },
  { key: 'space-gleam', path: `${P}board/space_gleam.svg`, width: 128, height: 88 },
  { key: 'space-festival', path: `${P}board/space_festival.svg`, width: 128, height: 88 },
  { key: 'space-mischief', path: `${P}board/space_mischief.svg`, width: 128, height: 88 },
  { key: 'space-market', path: `${P}board/space_market.svg`, width: 128, height: 88 },
  { key: 'space-portal', path: `${P}board/space_portal.svg`, width: 128, height: 88 },
  { key: 'space-relic', path: `${P}board/space_relic.svg`, width: 128, height: 88 },
  { key: 'space-event', path: `${P}board/space_event.svg`, width: 128, height: 88 },
  { key: 'prism-relic', path: `${P}items/prism_relic.svg`, width: 220, height: 260 },
  { key: 'item-warp-charm', path: `${P}items/warp_charm.svg`, width: 180, height: 180 },
  { key: 'item-magnet-glove', path: `${P}items/magnet_glove.svg`, width: 180, height: 180 },
  { key: 'item-spring-bean', path: `${P}items/spring_bean.svg`, width: 180, height: 180 },
  { key: 'orbit-dial', path: `${P}ui/orbit_dial.svg`, width: 380, height: 380 },
  { key: 'emblem', path: `${P}ui/spiral_emblem.svg`, width: 256, height: 256 },
  { key: 'icon-controller', path: `${P}ui/controller.svg`, width: 220, height: 150 },
  { key: 'icon-keyboard', path: `${P}ui/keyboard.svg`, width: 220, height: 150 },
  { key: 'podium', path: `${P}ui/podium.svg`, width: 320, height: 200 },
  { key: 'ornament', path: `${P}ui/panel_ornament.svg`, width: 96, height: 96 },
  { key: 'path-arrow', path: `${P}ui/path_arrow.svg`, width: 120, height: 120 },
];

export const LOADING_TIPS = [
  'Prism Relics decide the winner. Gleam Chips break ties.',
  'Press Y on your turn to open your items before spinning the Orbit Dial.',
  'Wingstep Boots add +3 to your next Orbit Dial spin.',
  'A Bubble Shield blocks the next mishap that would hit you.',
  'Portals whisk you across the isles — but a Portal Storm can reshuffle them!',
  'The Relic Keeper moves to a new gate every time someone buys a Prism Relic.',
  'In the final round, Gleam Spaces pay out 5 chips instead of 3.',
  'Three bonus Prism Relics are awarded after the final round. Watch your stats!',
  'Press VIEW (or Tab) during the board game to see everyone\'s standing.',
  'Hold a Prism Key to unlock the shortcut through the Spiral Observatory.',
  'Snare Seeds swipe chips from the next rival who lands on them.',
  'Minigame rewards: 10 chips for 1st, 6 for 2nd, 3 for 3rd and 1 for 4th.',
];
