import { GAME_WIDTH } from '../constants';

// Where the character select screen puts its roster tiles (kept apart from the scene so it can be tested).

export const TILE_W = 132;
export const TILE_H = 142;
export const TILE_GAP = 10;
/** One row sits here; two rows fill the band from ROSTER_TOP to ROSTER_BOTTOM. */
export const TILE_Y = 978;
export const ROSTER_TOP = 838;
export const ROSTER_BOTTOM = 1070;

export interface RosterLayout {
  /** Tile scale, size and gap. */
  k: number;
  w: number;
  h: number;
  gap: number;
  cols: number;
  rows: number;
  /** Centre of each tile. */
  pos: { x: number; y: number }[];
}

/** Up to twelve characters in one row; more in two rows (tiles shrink to fit either way). */
export function rosterLayout(n: number): RosterLayout {
  const rows = n <= 12 ? 1 : 2;
  const cols = Math.ceil(n / rows);
  const kW = (GAME_WIDTH - 80) / (cols * TILE_W + (cols - 1) * TILE_GAP);
  const kH = rows === 1 ? 1 : (ROSTER_BOTTOM - ROSTER_TOP - TILE_GAP) / (2 * TILE_H);
  const k = Math.min(1, kW, kH);
  const w = TILE_W * k;
  const h = TILE_H * k;
  const gap = TILE_GAP * k;
  const pos: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const inRow = Math.min(cols, n - r * cols);
    const c = i - r * cols;
    const x0 = GAME_WIDTH / 2 - (inRow * w + (inRow - 1) * gap) / 2 + w / 2;
    const y = rows === 1 ? TILE_Y : ROSTER_TOP + h / 2 + r * (h + gap);
    pos.push({ x: x0 + c * (w + gap), y });
  }
  return { k, w, h, gap, cols, rows, pos };
}
