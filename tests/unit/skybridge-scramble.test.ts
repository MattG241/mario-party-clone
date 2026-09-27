import { describe, expect, it } from 'vitest';
import {
  buildPattern,
  COLS,
  findRoute,
  FOOT_MARGIN,
  GRID_CX,
  GRID_CY,
  GRID_H,
  GRID_W,
  guardPattern,
  nearestTile,
  ROWS,
  supportingTile,
  TILE_COUNT,
  TILE_GAP,
  TILE_H,
  TILE_W,
  tileCentre,
  type PatternKind,
} from '../../src/game/minigames/games/skybridgeScrambleLogic';
import { Random } from '../../src/game/util/Random';

const all = (v: boolean) => new Array<boolean>(TILE_COUNT).fill(v);
const idx = (c: number, r: number) => r * COLS + c;

describe('skybridge grid geometry', () => {
  it('is a 6x4 grid of 210x120 tiles with 16 px gaps centred on (960, 640)', () => {
    expect(COLS * ROWS).toBe(24);
    expect(GRID_W).toBe(6 * 210 + 5 * 16);
    expect(GRID_H).toBe(4 * 120 + 3 * 16);
    const first = tileCentre(0);
    const last = tileCentre(TILE_COUNT - 1);
    expect((first.x + last.x) / 2).toBeCloseTo(GRID_CX);
    expect((first.y + last.y) / 2).toBeCloseTo(GRID_CY);
    expect(tileCentre(1).x - first.x).toBe(TILE_W + TILE_GAP);
    expect(tileCentre(COLS).y - first.y).toBe(TILE_H + TILE_GAP);
  });

  it('finds the tile under a point, bridging the crack between two solid tiles', () => {
    const solid = () => true;
    const t = tileCentre(idx(2, 1));
    expect(supportingTile(t.x, t.y, solid)).toBe(idx(2, 1));
    // In the gap between columns 2 and 3: supported while both stand...
    const gapX = t.x + TILE_W / 2 + TILE_GAP / 2;
    expect(supportingTile(gapX, t.y, solid)).toBeGreaterThanOrEqual(0);
    // ...but not once the neighbour is gone and we're past the margin of this tile.
    const onlyLeft = (i: number) => i === idx(2, 1);
    expect(supportingTile(t.x + TILE_W / 2 + FOOT_MARGIN + 2, t.y, onlyLeft)).toBe(-1);
    expect(supportingTile(t.x + TILE_W / 2 + FOOT_MARGIN - 2, t.y, onlyLeft)).toBe(idx(2, 1));
    // Off the grid entirely.
    expect(supportingTile(100, 100, solid)).toBe(-1);
    expect(nearestTile(100, 100)).toBe(0);
    expect(nearestTile(1900, 1000)).toBe(TILE_COUNT - 1);
  });
});

describe('skybridge patterns', () => {
  const kinds: PatternKind[] = ['random', 'row', 'col', 'rows2', 'stripes', 'checker', 'cross', 'ring', 'core', 'wave'];

  it('always returns distinct in-range tiles with non-negative delays', () => {
    const rng = new Random(11);
    for (let k = 0; k < 200; k++) {
      const kind = kinds[k % kinds.length];
      const p = buildPattern(kind, rng, 4);
      expect(new Set(p.tiles).size).toBe(p.tiles.length);
      expect(p.delays.length).toBe(p.tiles.length);
      for (const i of p.tiles) expect(i >= 0 && i < TILE_COUNT).toBe(true);
      for (const d of p.delays) expect(d).toBeGreaterThanOrEqual(0);
    }
  });

  it('builds a true checkerboard and full rows / columns', () => {
    const rng = new Random(3);
    const cb = buildPattern('checker', rng);
    expect(cb.tiles.length).toBe(12);
    const parity = ((cb.tiles[0] % COLS) + Math.floor(cb.tiles[0] / COLS)) % 2;
    for (const i of cb.tiles) expect(((i % COLS) + Math.floor(i / COLS)) % 2).toBe(parity);
    expect(buildPattern('row', rng).tiles.length).toBe(COLS);
    expect(buildPattern('col', rng).tiles.length).toBe(ROWS);
  });

  it('waves spare two or three separated refuges and spread outwards', () => {
    const rng = new Random(77);
    for (let k = 0; k < 50; k++) {
      const w = buildPattern('wave', rng);
      expect(w.spare.length).toBeGreaterThanOrEqual(2);
      expect(w.spare.length).toBeLessThanOrEqual(3);
      expect(w.tiles.length + w.spare.length).toBe(TILE_COUNT);
      for (const s of w.spare) expect(w.tiles).not.toContain(s);
      expect(Math.max(...w.delays)).toBeGreaterThan(0);
    }
    // Late-game waves leave exactly two refuges.
    for (let k = 0; k < 20; k++) expect(buildPattern('wave', rng, 2).spare.length).toBe(2);
  });

  it('guard keeps at least minSafe tiles untouched', () => {
    const rng = new Random(5);
    for (let k = 0; k < 100; k++) {
      const busy = all(false).map(() => rng.chance(0.4));
      const plan = buildPattern(k % 2 ? 'checker' : 'wave', rng);
      const minSafe = 2 + (k % 2);
      const out = guardPattern(plan.tiles, busy, minSafe, rng);
      for (const i of out) expect(busy[i]).toBe(false);
      const free = busy.filter((b, i) => !b && !out.includes(i)).length;
      const freeBefore = busy.filter((b) => !b).length;
      expect(free).toBeGreaterThanOrEqual(Math.min(minSafe, freeBefore));
    }
  });
});

describe('skybridge CPU routing', () => {
  it('walks to the nearest safe tile', () => {
    const walk = all(true);
    const goal = all(false);
    goal[idx(4, 1)] = true;
    const route = findRoute(walk, goal, idx(1, 1));
    expect(route).toEqual([idx(2, 1), idx(3, 1), idx(4, 1)]);
    expect(findRoute(walk, goal, idx(4, 1))).toEqual([]);
  });

  it('hops over a single missing tile but never over two', () => {
    const walk = all(true);
    walk[idx(2, 0)] = walk[idx(2, 1)] = walk[idx(2, 2)] = walk[idx(2, 3)] = false;
    const goal = all(false);
    goal[idx(3, 1)] = true;
    const route = findRoute(walk, goal, idx(1, 1));
    expect(route).toEqual([idx(3, 1)]);
    // A two-tile-wide chasm is impassable.
    for (let r = 0; r < ROWS; r++) walk[idx(3, r)] = false;
    goal[idx(3, 1)] = false;
    goal[idx(4, 1)] = true;
    expect(findRoute(walk, goal, idx(1, 1))).toBeNull();
  });

  it('prefers cheaper tiles when told a tile is crowded', () => {
    const walk = all(true);
    const goal = all(false);
    goal[idx(0, 1)] = true;
    goal[idx(2, 1)] = true;
    const extra = new Array<number>(TILE_COUNT).fill(0);
    extra[idx(0, 1)] = 1000;
    expect(findRoute(walk, goal, idx(1, 1), extra)).toEqual([idx(2, 1)]);
  });
});
