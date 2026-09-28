// Small visual constants shared by the board's presentation classes (kept apart from
// BoardManager so its helpers can use them without an import cycle).
import type { SpaceType } from './types';

/** Vertical squash of the ground plane in the board renders (camera 52° above the horizon). */
export const GROUND_SQUASH = Math.cos((38 * Math.PI) / 180);

/** Each space type's signature colour: landing bursts, night halos and route accents. */
export const SPACE_COLORS: Record<SpaceType, number> = {
  start: 0x79dcd5,
  gleam: 0x5ce1ff,
  festival: 0xffb050,
  mischief: 0xc49bff,
  market: 0xffe08a,
  portal: 0x9bf2e8,
  relic: 0xffffff,
  event: 0xff8fa3,
};

/** How far the camera is pulled back, as a growth factor for markers that must stay readable. */
export function overviewScale(zoom: number, ref = 0.95, max = 2.3): number {
  const k = ref / Math.max(0.05, zoom);
  return k < 1 ? 1 : k > max ? max : k;
}
