import { FIXED_FEET, SPRITE_META } from '../data/spriteMeta';

/**
 * Origin that makes an atlas frame stand on its feet: the fixed registration point of the rendered
 * 3D sheets, else the visible base (bottom centre of the solid artwork).
 */
export function standOrigin(texture: string, frame: string | number): { x: number; y: number } {
  const fixed = FIXED_FEET[texture];
  if (fixed) return fixed;
  const meta = SPRITE_META[texture];
  const fm = meta?.frames[Number(frame)];
  if (!fm) return { x: 0.5, y: 1 };
  return { x: (fm.solid[0] + fm.solid[2] / 2) / fm.w, y: Math.min(1, (fm.solid[1] + fm.solid[3]) / fm.h) };
}

/** Origin at the centre of the visible artwork. */
export function centerOrigin(texture: string, frame: string | number): { x: number; y: number } {
  const meta = SPRITE_META[texture];
  const fm = meta?.frames[Number(frame)];
  if (!fm) return { x: 0.5, y: 0.5 };
  return { x: (fm.solid[0] + fm.solid[2] / 2) / fm.w, y: (fm.solid[1] + fm.solid[3] / 2) / fm.h };
}

/** Visible artwork height of a frame in pixels. */
export function solidHeight(texture: string, frame: string | number): number {
  return SPRITE_META[texture]?.frames[Number(frame)]?.solid[3] ?? 200;
}
