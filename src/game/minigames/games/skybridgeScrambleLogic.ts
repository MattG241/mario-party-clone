// Skybridge Scramble: pure grid logic (no Phaser), shared by the scene and the unit tests.
// The layout constants here are the ones to align pre-rendered art with.
import type { Random } from '../../util/Random';

// --- Layout (screen px; orthographic 3/4 view, the floor is flat screen space) -----------------
export const COLS = 6;
export const ROWS = 4;
/** Top face of one platform tile on screen. */
export const TILE_W = 210;
export const TILE_H = 120;
export const TILE_GAP = 16;
/** Centre of the whole grid. */
export const GRID_CX = 960;
export const GRID_CY = 640;
export const PITCH_X = TILE_W + TILE_GAP;
export const PITCH_Y = TILE_H + TILE_GAP;
export const GRID_W = COLS * TILE_W + (COLS - 1) * TILE_GAP;
export const GRID_H = ROWS * TILE_H + (ROWS - 1) * TILE_GAP;
export const GRID_X0 = GRID_CX - GRID_W / 2;
export const GRID_Y0 = GRID_CY - GRID_H / 2;
export const TILE_COUNT = COLS * ROWS;
/** Feet this close to a tile's top face still stand on it (bridges the cracks between two tiles). */
export const FOOT_MARGIN = 12;

/** Screen-vertical moves are slower (the floor is foreshortened). */
export const Y_SPEED = 0.72;
/** Delay between successive steps of a rolling wave. */
export const WAVE_STEP_MS = 300;

export type PatternKind = 'random' | 'row' | 'col' | 'rows2' | 'stripes' | 'checker' | 'cross' | 'ring' | 'core' | 'wave';

/** Centre of a tile's top face. */
export function tileCentre(i: number): { x: number; y: number } {
  const c = i % COLS;
  const r = Math.floor(i / COLS);
  return { x: GRID_X0 + c * PITCH_X + TILE_W / 2, y: GRID_Y0 + r * PITCH_Y + TILE_H / 2 };
}

/** The walkable tile under a point (its top face grown by `margin`), or -1. */
export function supportingTile(x: number, y: number, walkable: (i: number) => boolean, margin = FOOT_MARGIN): number {
  const c0 = Math.floor((x - GRID_X0) / PITCH_X);
  const r0 = Math.floor((y - GRID_Y0) / PITCH_Y);
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    if (r < 0 || r >= ROWS) continue;
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= COLS) continue;
      const i = r * COLS + c;
      const t = tileCentre(i);
      if (Math.abs(x - t.x) <= TILE_W / 2 + margin && Math.abs(y - t.y) <= TILE_H / 2 + margin && walkable(i)) return i;
    }
  }
  return -1;
}

/** Nearest tile (by screen distance) to a point, ignoring state. */
export function nearestTile(x: number, y: number): number {
  const c = Math.max(0, Math.min(COLS - 1, Math.floor((x - GRID_X0 + TILE_GAP / 2) / PITCH_X)));
  const r = Math.max(0, Math.min(ROWS - 1, Math.floor((y - GRID_Y0 + TILE_GAP / 2) / PITCH_Y)));
  return r * COLS + c;
}

/**
 * Tiles a pattern drops, with a per-tile start delay (ms). Waves also name the tiles they spare.
 * `n` sizes the random pattern.
 */
export function buildPattern(kind: PatternKind, rng: Random, n = 3): { tiles: number[]; delays: number[]; spare: number[] } {
  const all = Array.from({ length: TILE_COUNT }, (_, i) => i);
  const col = (i: number) => i % COLS;
  const row = (i: number) => Math.floor(i / COLS);
  let tiles: number[] = [];
  let delays: number[] = [];
  let spare: number[] = [];
  // Lines ripple from one end so the telegraph reads as a sweep.
  const ripple = (list: number[], key: (i: number) => number, step: number) => {
    const flip = rng.chance(0.5);
    return list.map((i) => (flip ? -key(i) : key(i)) * step).map((d, _, arr) => d - Math.min(...arr));
  };
  switch (kind) {
    case 'random':
      tiles = rng.shuffle(all.slice()).slice(0, n);
      delays = tiles.map(() => 0);
      break;
    case 'row': {
      const r = rng.int(0, ROWS - 1);
      tiles = all.filter((i) => row(i) === r);
      delays = ripple(tiles, col, 55);
      break;
    }
    case 'col': {
      const c = rng.int(0, COLS - 1);
      tiles = all.filter((i) => col(i) === c);
      delays = ripple(tiles, row, 70);
      break;
    }
    case 'rows2': {
      const parity = rng.int(0, 1);
      tiles = all.filter((i) => row(i) % 2 === parity);
      delays = ripple(tiles, col, 50);
      break;
    }
    case 'stripes': {
      const parity = rng.int(0, 1);
      tiles = all.filter((i) => col(i) % 2 === parity);
      delays = ripple(tiles, row, 60);
      break;
    }
    case 'checker': {
      const parity = rng.int(0, 1);
      tiles = all.filter((i) => (col(i) + row(i)) % 2 === parity);
      delays = tiles.map(() => 0);
      break;
    }
    case 'cross': {
      const r = rng.int(0, ROWS - 1);
      const c = rng.int(1, COLS - 2);
      tiles = all.filter((i) => row(i) === r || col(i) === c);
      delays = tiles.map((i) => (Math.abs(col(i) - c) + Math.abs(row(i) - r)) * 60);
      break;
    }
    case 'ring':
      tiles = all.filter((i) => row(i) === 0 || row(i) === ROWS - 1 || col(i) === 0 || col(i) === COLS - 1);
      delays = tiles.map(() => 0);
      break;
    case 'core':
      tiles = all.filter((i) => !(row(i) === 0 || row(i) === ROWS - 1 || col(i) === 0 || col(i) === COLS - 1));
      delays = tiles.map(() => 0);
      break;
    case 'wave': {
      // Origin: an edge, a corner or the middle. The wave spreads out from it.
      const origins: { c: number; r: number; metric: 'col' | 'row' | 'manhattan' | 'cheb' }[] = [
        { c: 0, r: 0, metric: 'col' },
        { c: COLS - 1, r: 0, metric: 'col' },
        { c: 0, r: 0, metric: 'row' },
        { c: 0, r: ROWS - 1, metric: 'row' },
        { c: 0, r: 0, metric: 'manhattan' },
        { c: COLS - 1, r: 0, metric: 'manhattan' },
        { c: 0, r: ROWS - 1, metric: 'manhattan' },
        { c: COLS - 1, r: ROWS - 1, metric: 'manhattan' },
        { c: 2.5, r: 1.5, metric: 'cheb' },
      ];
      const o = rng.pick(origins);
      const dist = (i: number) => {
        const dc = Math.abs(col(i) - o.c);
        const dr = Math.abs(row(i) - o.r);
        if (o.metric === 'col') return dc;
        if (o.metric === 'row') return dr;
        if (o.metric === 'manhattan') return dc + dr;
        return Math.floor(Math.max(dc, dr));
      };
      // Spare two or three refuges, spread apart and not on the wave's first step.
      const want = rng.chance(0.5) ? 3 : 2;
      const pool = rng.shuffle(all.filter((i) => dist(i) >= 1));
      for (const i of pool) {
        if (spare.length >= want) break;
        if (spare.every((s) => Math.abs(col(s) - col(i)) + Math.abs(row(s) - row(i)) >= 3)) spare.push(i);
      }
      tiles = all.filter((i) => !spare.includes(i));
      delays = tiles.map((i) => dist(i) * WAVE_STEP_MS);
      break;
    }
  }
  return { tiles, delays, spare };
}

/**
 * Trim a pattern so at least `minSafe` tiles stay untouched. `busy[i]` marks tiles that are
 * already down, shaking or scheduled; they are never part of the result.
 */
export function guardPattern(tiles: readonly number[], busy: readonly boolean[], minSafe: number, rng: Random): number[] {
  const out = tiles.filter((i) => !busy[i]);
  const inPattern = new Set(out);
  let free = 0;
  for (let i = 0; i < busy.length; i++) if (!busy[i] && !inPattern.has(i)) free++;
  while (free < minSafe && out.length > 0) {
    out.splice(Math.floor(rng.next() * out.length), 1);
    free++;
  }
  return out;
}

/**
 * Cheapest route over the grid to any goal tile: walk to a 4-neighbour, or hop over exactly one
 * missing tile. Returns the tiles to visit after `start` (empty when already on a goal), or null.
 */
export function findRoute(walkable: readonly boolean[], goal: readonly boolean[], start: number, extraCost: readonly number[] = []): number[] | null {
  const n = walkable.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[start] = 0;
  const stepX = PITCH_X;
  const stepY = PITCH_Y / Y_SPEED;
  const dirs = [
    [1, 0, stepX],
    [-1, 0, stepX],
    [0, 1, stepY],
    [0, -1, stepY],
  ];
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) return null;
    done[u] = true;
    if (goal[u]) {
      const path: number[] = [];
      for (let v = u; v !== start && v >= 0; v = prev[v]) path.unshift(v);
      return path;
    }
    const uc = u % COLS;
    const ur = Math.floor(u / COLS);
    for (const [dc, dr, step] of dirs) {
      const c1 = uc + dc;
      const r1 = ur + dr;
      if (c1 < 0 || c1 >= COLS || r1 < 0 || r1 >= ROWS) continue;
      const v = r1 * COLS + c1;
      let target = -1;
      let cost = 0;
      if (walkable[v]) {
        target = v;
        cost = step;
      } else {
        const c2 = c1 + dc;
        const r2 = r1 + dr;
        if (c2 < 0 || c2 >= COLS || r2 < 0 || r2 >= ROWS) continue;
        const w = r2 * COLS + c2;
        if (!walkable[w]) continue;
        target = w;
        cost = step * 2 + 90;
      }
      const nd = dist[u] + cost + (extraCost[target] ?? 0);
      if (nd < dist[target]) {
        dist[target] = nd;
        prev[target] = u;
      }
    }
  }
}
