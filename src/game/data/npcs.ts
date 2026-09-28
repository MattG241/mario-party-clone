// Festival NPCs (one row of six poses per NPC in the NPC atlas).
import { NPC_SHEET } from './npcSprites.generated';

/** Texture key of the NPC poses: the rendered 3D sheet (scripts/art/npcs.py) when present, else the 2D sheet. */
export const NPC_ATLAS = NPC_SHEET ? 'npcs3d' : 'npcs';

export type NpcId = 'ora' | 'wrench' | 'pipper' | 'mimi' | 'packsprout';

export interface NpcDef {
  id: NpcId;
  name: string;
  role: string;
  row: number;
  poses: Record<string, number>;
  color: number;
}

export const NPCS: Record<NpcId, NpcDef> = {
  ora: {
    id: 'ora',
    name: 'Ora',
    role: 'Festival Guide',
    row: 0,
    poses: { idle: 0, wave: 1, welcome: 2, point: 3, flag: 4, cheer: 5 },
    color: 0x1fa5a0,
  },
  wrench: {
    id: 'wrench',
    name: 'Wrench',
    role: 'Inventor',
    row: 1,
    poses: { idle: 0, tool: 1, laugh: 2, idea: 3, gadget: 4, surprised: 5 },
    color: 0xc98a1b,
  },
  pipper: {
    id: 'pipper',
    name: 'Pipper',
    role: 'Travelling Merchant',
    row: 2,
    poses: { idle: 0, wave: 1, gift: 2, point: 3, coin: 4, happy: 5 },
    color: 0x8e5cd9,
  },
  mimi: {
    id: 'mimi',
    name: 'Mimi',
    role: 'Creature Helper',
    row: 3,
    poses: { idle: 0, happy: 1, laugh: 2, alert: 3, apple: 4, surprised: 5 },
    color: 0x5ca8ff,
  },
  packsprout: {
    id: 'packsprout',
    name: 'Packsprout',
    role: 'Delivery Sprout',
    row: 4,
    poses: { idle: 0, happy: 1, gift: 2, cheer: 3, surprised: 4, star: 5 },
    color: 0x6cc24a,
  },
};

export function npcFrame(id: NpcId, pose = 'idle'): string {
  const def = NPCS[id];
  return String(def.row * 6 + (def.poses[pose] ?? 0));
}
