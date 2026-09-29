// Clone Chaos's stage: where the clones can stand (the roof ridges of the rendered village,
// scripts/art/worlds/dojo/mg_clone_chaos.py ROWS: keep the two in step) and where the players watch
// from (the lookout deck at the bottom).

export interface Spot {
  id: number;
  /** Feet position on screen. */
  x: number;
  y: number;
  row: number;
  /** Character scale there (the back row is further away). */
  scale: number;
}

/** Rows back to front: ridge-top screen y, the spots' x, and a character scale. */
export const ROWS: readonly { y: number; xs: readonly number[]; scale: number }[] = [
  { y: 340, xs: [480, 800, 1120, 1440], scale: 0.54 },
  { y: 545, xs: [320, 640, 960, 1280, 1600], scale: 0.6 },
  { y: 760, xs: [560, 960, 1360], scale: 0.68 },
];

export const SPOTS: readonly Spot[] = ROWS.flatMap((r, row) => r.xs.map((x) => ({ x, y: r.y, row, scale: r.scale }))).map((s, id) => ({ id, ...s }));

/** The deck the players stand on: their feet's y, and x per player (by index). */
export const DECK_FEET = 1040;
export const DECK_XS: readonly number[] = [300, 640, 1280, 1620];
export const DECK_SCALE = 0.6;

/** Where every marker starts when picking begins: the spot nearest the middle of the village. */
export const START_SPOT = SPOTS.reduce((best, s) => (Math.hypot(s.x - 960, s.y - 545) < Math.hypot(best.x - 960, best.y - 545) ? s : best), SPOTS[0]).id;

export function spotDist(a: number, b: number): number {
  const p = SPOTS[a];
  const q = SPOTS[b];
  return Math.hypot(p.x - q.x, (p.y - q.y) * 1.2);
}
