import { HERO_DATA } from './heroSprites.generated';
import { SPRITE_META as SHEETS, type SheetMeta } from './spriteMeta.generated';

export type { FrameMeta, SheetMeta } from './spriteMeta.generated';

/** Frame metadata for every atlas: the processed sprite sheets plus the rendered 3D heroes. */
export const SPRITE_META: Record<string, SheetMeta> = { ...SHEETS, ...HERO_DATA.meta };
