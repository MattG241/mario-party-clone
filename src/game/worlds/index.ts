import type { WorldDef } from './types';

/** Every world, in menu order. */
export const WORLDS: WorldDef[] = [
  { id: 'pirates', name: 'Pirate Cove', short: 'Pirate Cove', cast: ['luffy', 'zoro', 'nami'], color: 0xe5484d },
  { id: 'dojo', name: 'Dojo Summit', short: 'Dojo Summit', cast: ['goku', 'naruto'], color: 0xf28c28 },
  { id: 'heroes', name: 'Hero Heights', short: 'Hero Heights', cast: ['batman', 'spiderman', 'ironman'], color: 0x5b6ee1 },
  { id: 'toons', name: 'Cartoon Coast', short: 'Cartoon Coast', cast: ['sonic', 'spongebob', 'homer'], color: 0x2fb7e9 },
  { id: 'showtime', name: 'Showtime Strip', short: 'Showtime', cast: ['elvis', 'sabrina', 'chappell', 'sandler'], color: 0xe85aa8 },
  { id: 'capitol', name: 'Capitol Gardens', short: 'Capitol', cast: ['obama', 'trump'], color: 0x3f7fd9 },
];

export function worldDef(id: string | undefined): WorldDef {
  return WORLDS.find((w) => w.id === id) ?? WORLDS[0];
}
