import { HERO_DATA, HERO_FEET } from './heroSprites.generated';
import { NPC_SHEET } from './npcSprites.generated';
import { SPRITE_META as SHEETS, type SheetMeta } from './spriteMeta.generated';

export type { FrameMeta, SheetMeta } from './spriteMeta.generated';

const RENDERED: Record<string, SheetMeta> = { ...HERO_DATA.meta, ...(NPC_SHEET ? { npcs3d: NPC_SHEET } : {}) };

/** Frame metadata for every atlas: the processed sprite sheets plus the rendered 3D heroes and NPCs. */
export const SPRITE_META: Record<string, SheetMeta> = { ...SHEETS, ...RENDERED };

/** Rendered sheets keep a fixed registration: the feet sit at the same point in every frame. */
export const FIXED_FEET: Record<string, { x: number; y: number }> = Object.fromEntries(
  Object.keys(RENDERED).map((k) => [k, { x: HERO_FEET.x / HERO_FEET.size, y: HERO_FEET.y / HERO_FEET.size }]),
);
