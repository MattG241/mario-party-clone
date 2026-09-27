// The four playable Gleamtrail characters.

export type CharacterId = 'kip' | 'mossi' | 'tumble' | 'zippa';
export const CHARACTER_IDS: readonly CharacterId[] = ['kip', 'mossi', 'tumble', 'zippa'];

export interface CharacterDef {
  id: CharacterId;
  name: string;
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

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  kip: {
    id: 'kip',
    name: 'Kip Quill',
    role: 'Balanced Adventurer',
    blurb: 'Trail-mapper with a teal scarf and a compass for every island.',
    color: 0x1fa5a0,
    colorCss: '#1fa5a0',
    atlas: 'kip',
    handling: { speed: 1, accel: 1, weight: 1, jump: 1 },
    pitch: 1,
  },
  mossi: {
    id: 'mossi',
    name: 'Mossi Bloom',
    role: 'Plant Alchemist',
    blurb: 'Brews sprouting potions and never stops bouncing.',
    color: 0x6cc24a,
    colorCss: '#6cc24a',
    atlas: 'mossi',
    handling: { speed: 1.02, accel: 1.06, weight: 0.94, jump: 1.05 },
    pitch: 1.25,
  },
  tumble: {
    id: 'tumble',
    name: 'Tumble Flint',
    role: 'Friendly Stone Golem',
    blurb: 'Gentle giant of the ruins. Slow to start, impossible to budge.',
    color: 0x3fd0e0,
    colorCss: '#3fd0e0',
    atlas: 'tumble',
    handling: { speed: 0.95, accel: 0.9, weight: 1.12, jump: 0.94 },
    pitch: 0.7,
  },
  zippa: {
    id: 'zippa',
    name: 'Zippa Wren',
    role: 'Flying-Squirrel Courier',
    blurb: 'Delivers parcels across the isles faster than the wind.',
    color: 0xd6307a,
    colorCss: '#d6307a',
    atlas: 'zippa',
    handling: { speed: 1.06, accel: 1.08, weight: 0.9, jump: 1.04 },
    pitch: 1.4,
  },
};
