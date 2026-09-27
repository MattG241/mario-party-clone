// Global constants shared by every part of Gleamtrail.

export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;
export const MAX_PLAYERS = 4;

export const TITLE = 'GLEAMTRAIL';
export const SUBTITLE = 'Festival of the Spiral Isles';

/** Font stack: Fredoka is bundled via @fontsource; the rest are safety fallbacks. */
export const FONT = 'Fredoka, "Trebuchet MS", "Segoe UI", sans-serif';

/** Gleamtrail UI palette (numbers for Phaser graphics, strings for text). */
export const COLORS = {
  cream: 0xfff4dc,
  creamDark: 0xf2e2bf,
  creamDeep: 0xe3cc9c,
  teal: 0x1fa5a0,
  tealDark: 0x117a77,
  tealDeep: 0x0d4f57,
  night: 0x0d3b47,
  gold: 0xf4b83b,
  goldLight: 0xffe08a,
  goldDark: 0xc98a1b,
  crystal: 0x5ce1ff,
  crystalLight: 0xc8f6ff,
  purple: 0x8e5cd9,
  purpleLight: 0xc49bff,
  purpleDark: 0x5e3494,
  coral: 0xff6b5e,
  grass: 0x6cc24a,
  ink: 0x2b2340,
  stone: 0xa9a59a,
  white: 0xffffff,
  black: 0x000000,
} as const;

export const CSS = {
  cream: '#fff4dc',
  creamDark: '#f2e2bf',
  teal: '#1fa5a0',
  tealDark: '#117a77',
  tealDeep: '#0d4f57',
  gold: '#f4b83b',
  goldLight: '#ffe08a',
  goldDark: '#c98a1b',
  crystal: '#5ce1ff',
  purple: '#8e5cd9',
  purpleLight: '#c49bff',
  coral: '#ff6b5e',
  grass: '#6cc24a',
  ink: '#2b2340',
  inkSoft: '#5a4f73',
  white: '#ffffff',
} as const;

/**
 * Player identifiers. Colour is never the only cue: every player also has a shape
 * (P1 circle, P2 triangle, P3 diamond, P4 hexagon) drawn on badges, markers and HUD panels.
 */
export const PLAYER_COLORS = [0x22c3d6, 0xff6b5e, 0x8bd346, 0xffb020] as const;
export const PLAYER_COLORS_CSS = ['#22c3d6', '#ff6b5e', '#8bd346', '#ffb020'] as const;
export const PLAYER_COLORS_DARK = [0x0e7f8e, 0xb8392f, 0x4f8f1f, 0xb87400] as const;
export type PlayerShape = 'circle' | 'triangle' | 'diamond' | 'hexagon';
export const PLAYER_SHAPES: readonly PlayerShape[] = ['circle', 'triangle', 'diamond', 'hexagon'];
export const PLAYER_SHAPE_NAMES = ['Circle', 'Triangle', 'Diamond', 'Hexagon'] as const;

/** Render depth bands. */
export const DEPTH = {
  sky: -100,
  farBg: -90,
  clouds: -80,
  islands: -50,
  paths: -20,
  spaces: -10,
  world: 0, // characters & props are y-sorted from here
  worldFx: 5000,
  worldUi: 6000,
  ui: 10000,
  overlay: 20000,
} as const;

/** Board economy. */
export const ECONOMY = {
  startingChips: 10,
  relicPrice: 20,
  relicRushPrice: 15,
  gleamSpace: 3,
  gleamSpaceFinal: 5,
  maxItems: 3,
  snareSteal: 5,
  magnetSteal: 5,
  minigameRewards: [10, 6, 3, 1] as readonly number[],
} as const;

export const DIAL_MIN = 1;
export const DIAL_MAX = 10;
export const BOOTS_BONUS = 3;

export const ROUND_OPTIONS = [10, 15, 20] as const;
export type RoundCount = (typeof ROUND_OPTIONS)[number];

export type CpuLevel = 'easy' | 'normal' | 'hard';
export const CPU_LEVELS: readonly CpuLevel[] = ['easy', 'normal', 'hard'];

export type GameSpeed = 'normal' | 'fast';
export type InstructionMode = 'on' | 'quick' | 'off';
export type EventMode = 'normal' | 'chaotic';

/** Local storage keys (versioned so incompatible data is ignored rather than crashing). */
export const STORAGE_KEYS = {
  settings: 'gleamtrail.settings.v1',
  save: 'gleamtrail.save.v1',
} as const;
