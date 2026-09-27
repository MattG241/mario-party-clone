import type { CpuLevel } from '../constants';
import type { SvgAsset } from '../data/assets';
import type { CharacterId } from '../data/characters';
import type { Placement } from '../state/scoring';
import type { PromptButton } from '../ui/ControllerPrompt';
import type { Random } from '../util/Random';

export interface MinigameInfo {
  id: string;
  sceneKey: string;
  name: string;
  tagline: string;
  description: string;
  instructions: string[];
  controls: { button: PromptButton; label: string }[];
  players: string;
  duration: string;
  color: number;
  /** Card art (atlas frame or placeholder texture). */
  preview: { texture: string; frame?: string; scale: number };
  teamGame?: boolean;
  /** Minigame-specific placeholder art, lazy-loaded by the intro screen. */
  assets?: SvgAsset[];
}

export interface MinigamePlayer {
  slot: number;
  characterId: CharacterId;
  isCpu: boolean;
  cpuLevel: CpuLevel;
}

export interface MinigameLaunch {
  id: string;
  players: MinigamePlayer[];
  mode: 'board' | 'free';
  seed: number;
  /** Instruction screen preference for this launch. */
  instructions: 'on' | 'quick' | 'off';
}

export interface MinigameResult {
  id: string;
  placements: Placement[];
  scores: { slot: number; score: number; label: string }[];
}

const MG = 'assets/placeholders/minigames/';

export const MINIGAMES: MinigameInfo[] = [
  {
    id: 'gleam-grab',
    sceneKey: 'mg-gleam-grab',
    name: 'Gleam Grab',
    tagline: 'Chips are raining from the sky!',
    description: 'Scramble around the plaza catching falling Gleam Chips. Dodge the wobbly fake capsules — they pop and knock you back.',
    instructions: ['Catch falling Gleam Chips (golden ones are worth 3!)', 'Fake capsules wobble before they burst — keep clear', 'Dash to reach chips first (short cooldown)', 'Most chips after 45 seconds wins'],
    controls: [
      { button: 'STICK', label: 'Move' },
      { button: 'A', label: 'Dash' },
    ],
    players: '1–4 players',
    duration: '45 s',
    color: 0xf4b83b,
    preview: { texture: 'items', frame: '0', scale: 0.7 },
    assets: [{ key: 'mg-plaza-floor', path: `${MG}gleam-grab/plaza_floor.svg`, width: 1600, height: 820 }],
  },
  {
    id: 'orbit-dodge',
    sceneKey: 'mg-orbit-dodge',
    name: 'Orbit Dodge',
    tagline: 'Jump the low arm, duck the high arm!',
    description: 'Stand your ground on a spinning observatory platform while mechanical arms sweep around. Low arms must be jumped, high arms ducked. It speeds up every 10 seconds!',
    instructions: ['Low spiked arm coming? Press A to JUMP', 'High swinging arm coming? Hold B to DUCK', 'Three bonks and you are out', 'Speed rises every 10 seconds — last one standing wins'],
    controls: [
      { button: 'A', label: 'Jump' },
      { button: 'B', label: 'Duck' },
    ],
    players: '1–4 players',
    duration: 'Until one remains',
    color: 0x8e5cd9,
    preview: { texture: 'props', frame: '19', scale: 0.62 },
    assets: [{ key: 'mg-orbit-platform', path: `${MG}orbit-dodge/platform.svg`, width: 1400, height: 760 }],
  },
  {
    id: 'crate-craze',
    sceneKey: 'mg-crate-craze',
    name: 'Crate Craze',
    tagline: 'Push crates into your own zone!',
    description: 'The festival supplies are everywhere! Shove crates into your coloured corner zone before the time runs out.',
    instructions: ['Walk into crates to push them', 'A to shove crates (and rivals!) hard', 'X to dash across the yard', 'Most crates in your zone after 60 seconds wins'],
    controls: [
      { button: 'STICK', label: 'Move' },
      { button: 'A', label: 'Shove' },
      { button: 'X', label: 'Dash' },
    ],
    players: '1–4 players',
    duration: '60 s',
    color: 0x9a6334,
    preview: { texture: 'mg-crate', scale: 0.9 },
    assets: [
      { key: 'mg-crate', path: `${MG}crate-craze/crate.svg`, width: 120, height: 120 },
      { key: 'mg-yard-floor', path: `${MG}crate-craze/yard_floor.svg`, width: 1600, height: 860 },
    ],
  },
  {
    id: 'skybridge-scramble',
    sceneKey: 'mg-skybridge-scramble',
    name: 'Skybridge Scramble',
    tagline: 'The platforms are falling!',
    description: 'Stay on the floating wooden platforms as they shake and drop into the clouds. Jump across the gaps to survive.',
    instructions: ['Platforms shake before they fall', 'A to jump over gaps (you are safe in the air)', 'Falling off loses a life — three lives each', 'Last player standing wins'],
    controls: [
      { button: 'STICK', label: 'Move' },
      { button: 'A', label: 'Jump' },
    ],
    players: '1–4 players',
    duration: 'Until one remains',
    color: 0x5ca8ff,
    preview: { texture: 'props', frame: '1', scale: 0.62 },
    assets: [{ key: 'mg-sky-tile', path: `${MG}skybridge-scramble/tile.svg`, width: 150, height: 110 }],
  },
  {
    id: 'totem-tug',
    sceneKey: 'mg-totem-tug',
    name: 'Totem Tug',
    tagline: 'Two teams, one spiral totem!',
    description: 'Two teams haul on the spiral totem rope. Alternate LT and RT in rhythm — steady timing beats frantic mashing!',
    instructions: ['Teams: players 1 & 2 vs players 3 & 4', 'Alternate LT and RT to pull', 'Pull on the glowing beat for power pulls', 'Drag the marker to your side to win'],
    controls: [
      { button: 'LT', label: 'Pull' },
      { button: 'RT', label: 'Pull' },
    ],
    players: '2–4 players (teams)',
    duration: '40 s',
    color: 0xff6b5e,
    preview: { texture: 'mg-totem', scale: 0.55 },
    teamGame: true,
    assets: [{ key: 'mg-totem', path: `${MG}totem-tug/totem.svg`, width: 260, height: 420 }],
  },
  {
    id: 'spiral-splash',
    sceneKey: 'mg-spiral-splash',
    name: 'Spiral Splash',
    tagline: 'Soak your rivals off the lily pads!',
    description: 'Hop between drifting lily pads and fire water blasts at your rivals. Every hit pushes them back — fall in three times and you are out.',
    instructions: ['Right stick aims, RT fires a water blast', 'Hits push rivals backwards', 'Stay on the pads! Three splashes and you are out', 'Last dry adventurer wins'],
    controls: [
      { button: 'STICK', label: 'Move' },
      { button: 'RSTICK', label: 'Aim' },
      { button: 'RT', label: 'Blast' },
    ],
    players: '1–4 players',
    duration: '60 s',
    color: 0x3fc6e8,
    preview: { texture: 'vfx', frame: '9', scale: 0.7 },
    assets: [{ key: 'mg-lily-pad', path: `${MG}spiral-splash/pad.svg`, width: 220, height: 150 }],
  },
  {
    id: 'relic-relay',
    sceneKey: 'mg-relic-relay',
    name: 'Relic Relay',
    tagline: 'Carry the parcel to the finish!',
    description: 'Race your glowing relic parcel through an obstacle course of spiked logs, springs and swinging maces. Get bonked and you drop it!',
    instructions: ['A to jump, B to pick up your parcel', 'X throws the parcel ahead (then go get it!)', 'Obstacles make you drop your parcel', 'First to the finish with a parcel wins'],
    controls: [
      { button: 'STICK', label: 'Run' },
      { button: 'A', label: 'Jump' },
      { button: 'X', label: 'Throw' },
      { button: 'B', label: 'Pick up' },
    ],
    players: '1–4 players',
    duration: '75 s',
    color: 0xc49bff,
    preview: { texture: 'mg-parcel', scale: 0.8 },
    assets: [{ key: 'mg-parcel', path: `${MG}relic-relay/parcel.svg`, width: 110, height: 110 }],
  },
  {
    id: 'tumble-tower',
    sceneKey: 'mg-tumble-tower',
    name: 'Tumble Tower',
    tagline: 'Climb higher than everyone!',
    description: 'Leap up a tower of moving and tipping platforms. Grab ledges to save yourself. Whoever is highest when time runs out wins.',
    instructions: ['A to jump up through platforms', 'X near a ledge to grab and climb', 'Tipping platforms slide you off!', 'Highest climber after 50 seconds wins'],
    controls: [
      { button: 'STICK', label: 'Move' },
      { button: 'A', label: 'Jump' },
      { button: 'X', label: 'Grab' },
    ],
    players: '1–4 players',
    duration: '50 s',
    color: 0x6cc24a,
    preview: { texture: 'props', frame: '14', scale: 0.62 },
    assets: [{ key: 'mg-tower-plank', path: `${MG}tumble-tower/plank.svg`, width: 260, height: 60 }],
  },
];

export function minigameInfo(id: string): MinigameInfo | undefined {
  return MINIGAMES.find((m) => m.id === id);
}

/** Minigames whose scenes are registered (i.e. playable). */
export function availableMinigames(registered: Set<string>): MinigameInfo[] {
  return MINIGAMES.filter((m) => registered.has(m.sceneKey));
}

/**
 * Pick the next board minigame: never the same as the last two, and prefer ones played least.
 * Team games need at least three players.
 */
export function pickMinigame(pool: MinigameInfo[], history: readonly string[], playerCount: number, rng: Random): MinigameInfo {
  let candidates = pool.filter((m) => !(m.teamGame && playerCount < 3));
  if (candidates.length === 0) candidates = pool;
  const recent = history.slice(-2);
  const fresh = candidates.filter((m) => !recent.includes(m.id));
  const list = fresh.length ? fresh : candidates;
  const counts = new Map<string, number>();
  for (const h of history) counts.set(h, (counts.get(h) ?? 0) + 1);
  const least = Math.min(...list.map((m) => counts.get(m.id) ?? 0));
  const leastPlayed = list.filter((m) => (counts.get(m.id) ?? 0) === least);
  return rng.pick(leastPlayed);
}
