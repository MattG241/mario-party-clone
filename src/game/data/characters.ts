import { HERO_DATA } from './heroSprites.generated';

// The playable characters: the four Gleamtrail heroes plus the guest collection (fan-made models
// for private play, scripts/art/char_<id>.py). A guest only joins the roster once its rendered
// sheet exists.

export type CharacterId =
  | 'kip'
  | 'mossi'
  | 'tumble'
  | 'zippa'
  | 'luffy'
  | 'goku'
  | 'naruto'
  | 'batman'
  | 'spiderman'
  | 'ironman'
  | 'sonic'
  | 'spongebob';

/** The original four always have art (a rendered sheet, or the supplied 2D sheets). */
const ORIGINALS: readonly CharacterId[] = ['kip', 'mossi', 'tumble', 'zippa'];
const GUESTS: readonly CharacterId[] = ['luffy', 'goku', 'naruto', 'batman', 'spiderman', 'ironman', 'sonic', 'spongebob'];

/** Every character that can be picked, in roster order. */
export const CHARACTER_IDS: readonly CharacterId[] = [...ORIGINALS, ...GUESTS.filter((id) => !!HERO_DATA.anims[id])];

export interface CharacterDef {
  id: CharacterId;
  name: string;
  /** Name on the roster tiles. */
  short: string;
  role: string;
  blurb: string;
  /** Identifier colour (the character's own colour, separate from the player-slot colour). */
  color: number;
  colorCss: string;
  /** Texture key of the character's processed atlas. */
  atlas: string;
  /**
   * Small minigame handling differences. They are deliberately modest (±8 %) and balanced so no
   * character is strictly better: faster movers are lighter and easier to knock around.
   */
  handling: {
    speed: number;
    accel: number;
    weight: number;
    jump: number;
  };
  /** Voice-ish pitch used by procedural reaction sounds. */
  pitch: number;
}

/** The rendered 3D sheet when it has been generated (scripts/art/characters.py), else the 2D sheet. */
function heroAtlas(id: CharacterId): string {
  return HERO_DATA.meta[`hero_${id}`] ? `hero_${id}` : id;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  kip: {
    id: 'kip',
    short: 'Kip',
    name: 'Kip Quill',
    role: 'Balanced Adventurer',
    blurb: 'Trail-mapper with a teal scarf and a compass for every island.',
    color: 0x1fa5a0,
    colorCss: '#1fa5a0',
    atlas: heroAtlas('kip'),
    handling: { speed: 1, accel: 1, weight: 1, jump: 1 },
    pitch: 1,
  },
  mossi: {
    id: 'mossi',
    short: 'Mossi',
    name: 'Mossi Bloom',
    role: 'Plant Alchemist',
    blurb: 'Brews sprouting potions and never stops bouncing.',
    color: 0x6cc24a,
    colorCss: '#6cc24a',
    atlas: heroAtlas('mossi'),
    handling: { speed: 1.02, accel: 1.06, weight: 0.94, jump: 1.05 },
    pitch: 1.25,
  },
  tumble: {
    id: 'tumble',
    short: 'Tumble',
    name: 'Tumble Flint',
    role: 'Friendly Stone Golem',
    blurb: 'Gentle giant of the ruins. Slow to start, impossible to budge.',
    color: 0x3fd0e0,
    colorCss: '#3fd0e0',
    atlas: heroAtlas('tumble'),
    handling: { speed: 0.95, accel: 0.9, weight: 1.12, jump: 0.94 },
    pitch: 0.7,
  },
  zippa: {
    id: 'zippa',
    short: 'Zippa',
    name: 'Zippa Wren',
    role: 'Flying-Squirrel Courier',
    blurb: 'Delivers parcels across the isles faster than the wind.',
    color: 0xd6307a,
    colorCss: '#d6307a',
    atlas: heroAtlas('zippa'),
    handling: { speed: 1.06, accel: 1.08, weight: 0.9, jump: 1.04 },
    pitch: 1.4,
  },
  luffy: {
    id: 'luffy',
    name: 'Luffy',
    short: 'Luffy',
    role: 'Rubber Pirate Captain',
    blurb: 'Stretchy, fearless and always hungry. Future King of the Pirates.',
    color: 0xe53935,
    colorCss: '#e53935',
    atlas: heroAtlas('luffy'),
    handling: { speed: 1.03, accel: 1.04, weight: 0.95, jump: 1.06 },
    pitch: 1.15,
  },
  goku: {
    id: 'goku',
    name: 'Goku',
    short: 'Goku',
    role: 'Saiyan Martial Artist',
    blurb: 'Trains every day and grins at every stronger opponent.',
    color: 0xf57c00,
    colorCss: '#f57c00',
    atlas: heroAtlas('goku'),
    handling: { speed: 1.03, accel: 1.02, weight: 1.03, jump: 0.96 },
    pitch: 1.05,
  },
  naruto: {
    id: 'naruto',
    name: 'Naruto',
    short: 'Naruto',
    role: 'Ninja of the Leaf',
    blurb: 'Never goes back on his word. Believe it!',
    color: 0xffb300,
    colorCss: '#ffb300',
    atlas: heroAtlas('naruto'),
    handling: { speed: 1.05, accel: 1.05, weight: 0.94, jump: 1.02 },
    pitch: 1.2,
  },
  batman: {
    id: 'batman',
    name: 'Batman',
    short: 'Batman',
    role: 'Dark Knight Detective',
    blurb: 'A gadget for every problem and a plan for every island.',
    color: 0x455a64,
    colorCss: '#455a64',
    atlas: heroAtlas('batman'),
    handling: { speed: 0.97, accel: 0.98, weight: 1.08, jump: 1.0 },
    pitch: 0.72,
  },
  spiderman: {
    id: 'spiderman',
    name: 'Spider-Man',
    short: 'Spider-Man',
    role: 'Friendly Neighbourhood Hero',
    blurb: 'Swings in, cracks a joke and saves the day.',
    color: 0xc2185b,
    colorCss: '#c2185b',
    atlas: heroAtlas('spiderman'),
    handling: { speed: 1.02, accel: 1.06, weight: 0.93, jump: 1.07 },
    pitch: 1.1,
  },
  ironman: {
    id: 'ironman',
    name: 'Iron Man',
    short: 'Iron Man',
    role: 'Armoured Inventor',
    blurb: 'A genius engineer in a suit that flies.',
    color: 0xa8201a,
    colorCss: '#a8201a',
    atlas: heroAtlas('ironman'),
    handling: { speed: 0.96, accel: 0.94, weight: 1.12, jump: 0.98 },
    pitch: 0.9,
  },
  sonic: {
    id: 'sonic',
    name: 'Sonic',
    short: 'Sonic',
    role: 'Fastest Thing Alive',
    blurb: 'Hates waiting. Loves speed, adventure and chili dogs.',
    color: 0x1e63d6,
    colorCss: '#1e63d6',
    atlas: heroAtlas('sonic'),
    handling: { speed: 1.08, accel: 1.08, weight: 0.9, jump: 1.02 },
    pitch: 1.3,
  },
  spongebob: {
    id: 'spongebob',
    name: 'SpongeBob',
    short: 'SpongeBob',
    role: 'Fry Cook Extraordinaire',
    blurb: 'Relentlessly cheerful and ready for anything.',
    color: 0xfdd835,
    colorCss: '#fdd835',
    atlas: heroAtlas('spongebob'),
    handling: { speed: 0.98, accel: 1.03, weight: 0.92, jump: 1.05 },
    pitch: 1.45,
  },
};
