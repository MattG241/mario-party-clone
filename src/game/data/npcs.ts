// The board cast: side characters from the players' own shows, films and games. Five roles (host,
// Star Keeper, two shopkeepers and a helper) are filled from the side characters of whoever is
// playing, then from the board's world, then from a default line-up. Each side character is one row
// of six poses in the cast atlas (scripts/art/npcs.py, models in scripts/art/npc_<id>.py).
import { WORLDS } from '../worlds';
import type { CharacterId } from './characters';
import { NPC_SHEET } from './npcSprites.generated';

/** Texture key of the cast poses: the rendered 3D sheet when present, else the 2D sheet. */
export const NPC_ATLAS = NPC_SHEET ? 'npcs3d' : 'npcs';

/** The five roles (the ids are the roles' original names). */
export type NpcId = 'ora' | 'wrench' | 'pipper' | 'mimi' | 'packsprout';

export type SideId = 'chopper' | 'krillin' | 'kakashi' | 'alfred' | 'venom' | 'warmachine' | 'tails' | 'patrick' | 'bart';

/** The cast sheet's pose columns. */
export const CAST_POSES = ['idle', 'wave', 'cheer', 'point', 'surprised', 'happy'] as const;

export interface SideDef {
  id: SideId;
  name: string;
  /** The playable characters whose show, film or game this side character comes from. */
  from: readonly CharacterId[];
  color: number;
}

/** In atlas row order. */
export const SIDE_CHARACTERS: readonly SideDef[] = [
  { id: 'chopper', name: 'Chopper', from: ['luffy', 'zoro', 'nami'], color: 0xe86a92 },
  { id: 'krillin', name: 'Krillin', from: ['goku'], color: 0xf47b20 },
  { id: 'kakashi', name: 'Kakashi', from: ['naruto'], color: 0x4f7a5a },
  { id: 'alfred', name: 'Alfred', from: ['batman'], color: 0x3a3f4f },
  { id: 'venom', name: 'Venom', from: ['spiderman'], color: 0x2b2d3a },
  { id: 'warmachine', name: 'War Machine', from: ['ironman'], color: 0x6b7280 },
  { id: 'tails', name: 'Tails', from: ['sonic'], color: 0xf2a33a },
  { id: 'patrick', name: 'Patrick', from: ['spongebob'], color: 0xf28bb0 },
  { id: 'bart', name: 'Bart', from: ['homer'], color: 0xe5484d },
];

/** Who fills the roles when the players and the board don't bring enough side characters. */
const DEFAULT_ORDER: readonly SideId[] = ['patrick', 'tails', 'chopper', 'krillin', 'bart', 'kakashi', 'alfred', 'warmachine', 'venom'];

/** Roles in the order they are cast. */
const ROLE_ORDER: readonly NpcId[] = ['ora', 'packsprout', 'wrench', 'pipper', 'mimi'];

export interface NpcDef {
  id: NpcId;
  /** The side character currently playing the role. */
  readonly name: string;
  role: string;
  /** The role's pose names, as columns of the cast sheet. */
  poses: Record<string, number>;
  readonly color: number;
}

const ROLE_INFO: Record<NpcId, { role: string; poses: Record<string, number> }> = {
  ora: { role: 'Party Host', poses: { idle: 0, wave: 1, welcome: 1, point: 3, flag: 2, cheer: 2 } },
  wrench: { role: 'Shopkeeper', poses: { idle: 0, tool: 3, laugh: 5, idea: 4, gadget: 3, surprised: 4 } },
  pipper: { role: 'Travelling Merchant', poses: { idle: 0, wave: 1, gift: 3, point: 3, coin: 5, happy: 5 } },
  mimi: { role: 'Helper', poses: { idle: 0, happy: 5, laugh: 5, alert: 4, apple: 3, surprised: 4 } },
  packsprout: { role: 'Star Keeper', poses: { idle: 0, happy: 5, gift: 3, cheer: 2, surprised: 4, star: 2 } },
};

/** Fill the roles: side characters of the players (in turn order), then of the board's world, then the defaults. */
export function castFor(players: readonly CharacterId[], world: readonly CharacterId[] = []): Record<NpcId, SideId> {
  const picks: SideId[] = [];
  for (const c of [...players, ...world]) {
    for (const s of SIDE_CHARACTERS) if (s.from.includes(c) && !picks.includes(s.id)) picks.push(s.id);
  }
  for (const d of DEFAULT_ORDER) if (!picks.includes(d)) picks.push(d);
  return Object.fromEntries(ROLE_ORDER.map((r, i) => [r, picks[i]])) as Record<NpcId, SideId>;
}

let cast: Record<NpcId, SideId> = castFor([]);

/** Recast the roles for these players (and the board's world); call when a match or minigame starts. */
export function setCast(players: readonly CharacterId[], world: readonly CharacterId[] = []): void {
  cast = castFor(players, world);
}

/** setCast with a world id (src/game/worlds/index.ts) for the fallback. */
export function setCastForWorld(players: readonly CharacterId[], worldId: string | undefined): void {
  setCast(players, (WORLDS.find((w) => w.id === worldId)?.cast ?? []) as CharacterId[]);
}

function side(id: SideId): SideDef {
  return SIDE_CHARACTERS.find((s) => s.id === id) ?? SIDE_CHARACTERS[0];
}

/** The side character playing a role right now. */
export function castOf(id: NpcId): SideDef {
  return side(cast[id]);
}

/** The name of whoever plays a role right now. */
export function npcName(id: NpcId): string {
  return castOf(id).name;
}

export const NPCS: Record<NpcId, NpcDef> = Object.fromEntries(
  ROLE_ORDER.map((id) => [
    id,
    {
      id,
      get name() {
        return castOf(id).name;
      },
      role: ROLE_INFO[id].role,
      poses: ROLE_INFO[id].poses,
      get color() {
        return castOf(id).color;
      },
    },
  ]),
) as Record<NpcId, NpcDef>;

export function npcFrame(id: NpcId, pose = 'idle'): string {
  const row = SIDE_CHARACTERS.indexOf(castOf(id));
  return String(row * CAST_POSES.length + (ROLE_INFO[id].poses[pose] ?? 0));
}
