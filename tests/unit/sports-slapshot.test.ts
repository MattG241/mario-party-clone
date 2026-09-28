import { describe, expect, it } from 'vitest';
import {
  boards,
  BOTTOM,
  crossedGoal,
  GOAL,
  goalFrame,
  goalGeom,
  goalSides,
  LEFT,
  predict,
  PUCK_R,
  RIGHT,
  RINK,
  scoreGoal,
  segment,
  shotSpeed,
  slide,
  TOP,
  type Side,
} from '../../src/game/worlds/rink/games/slapshotRules';

describe('slapshot: the rink', () => {
  it('hands out goals face to face, then the near end, then every side', () => {
    expect(goalSides(2)).toEqual([LEFT, RIGHT]);
    expect(goalSides(3)).toEqual([LEFT, RIGHT, BOTTOM]);
    expect(goalSides(4)).toEqual([LEFT, RIGHT, TOP, BOTTOM]);
    expect(new Set(goalSides(4)).size).toBe(4);
  });

  it('sets every goal inside the boards, the same distance from centre ice, opening inwards', () => {
    const d = new Set<number>();
    for (const side of [0, 1, 2, 3] as Side[]) {
      const g = goalGeom(side);
      d.add(Math.round(Math.hypot(g.mx - RINK.cx, g.my - RINK.cy)));
      // The normal points out through the goal (away from centre ice).
      expect((g.mx - RINK.cx) * g.nx + (g.my - RINK.cy) * g.ny).toBeGreaterThan(0);
      // The net stays inside the boards.
      for (const [a, b] of g.walls) for (const p of [a, b]) expect(Math.max(Math.abs(p.x - RINK.cx), Math.abs(p.y - RINK.cy))).toBeLessThanOrEqual(RINK.half);
    }
    expect(d.size).toBe(1);
  });

  it('keeps a puck inside the boards and bounces it back, corners included', () => {
    const b = { x: RINK.cx + RINK.half + 30, y: RINK.cy, vx: 500, vy: 0 };
    expect(boards(b, PUCK_R, 0.8)).toBeGreaterThan(0);
    expect(b.x).toBeLessThanOrEqual(RINK.cx + RINK.half - PUCK_R + 1e-6);
    expect(b.vx).toBeCloseTo(-400);
    const c = { x: RINK.cx + RINK.half - 5, y: RINK.cy + RINK.half - 5, vx: 300, vy: 300 };
    boards(c, PUCK_R, 0.8);
    const inner = RINK.half - RINK.corner;
    expect(Math.hypot(c.x - (RINK.cx + inner), c.y - (RINK.cy + inner))).toBeLessThanOrEqual(RINK.corner - PUCK_R + 1e-6);
    expect(c.vx + c.vy).toBeLessThan(0);
  });

  it('pushes a puck off a post or a net wall', () => {
    const g = goalGeom(LEFT);
    const post = g.posts[0];
    const b = { x: post.x + 4, y: post.y, vx: -300, vy: 0 };
    expect(goalFrame(b, PUCK_R, g, 0.6)).toBeGreaterThan(0);
    expect(Math.hypot(b.x - post.x, b.y - post.y)).toBeGreaterThanOrEqual(PUCK_R + GOAL.post - 1e-6);
    expect(b.vx).toBeGreaterThan(0);
    const s = { x: 0, y: 5, vx: 0, vy: -100 };
    segment(s, 10, { x: -50, y: 0 }, { x: 50, y: 0 }, 0.5);
    expect(s.y).toBeCloseTo(10);
    expect(s.vy).toBeCloseTo(50);
  });
});

describe('slapshot: goals', () => {
  it('counts a puck crossing the line between the posts, heading in', () => {
    const g = goalGeom(RIGHT);
    expect(crossedGoal(g.mx - 5, g.my, g.mx + 5, g.my, g)).toBe(true);
    expect(crossedGoal(g.mx - 5, g.my + 40, g.mx + 5, g.my + 40, g)).toBe(true);
    // wide of the posts, sliding along the line, or coming back out
    expect(crossedGoal(g.mx - 5, g.my + GOAL.w, g.mx + 5, g.my + GOAL.w, g)).toBe(false);
    expect(crossedGoal(g.mx - 5, g.my, g.mx - 2, g.my, g)).toBe(false);
    expect(crossedGoal(g.mx + 5, g.my, g.mx - 5, g.my, g)).toBe(false);
    const t = goalGeom(TOP);
    expect(crossedGoal(t.mx, t.my + 5, t.mx, t.my - 5, t)).toBe(true);
  });

  it('gives the shooter 2 and takes 1 from the keeper (never below zero); an own goal only costs', () => {
    const s = [3, 0, 5, 1];
    scoreGoal(s, 0, 2);
    expect(s).toEqual([5, 0, 4, 1]);
    scoreGoal(s, 2, 1);
    expect(s).toEqual([5, 0, 6, 1]);
    scoreGoal(s, 3, 3);
    expect(s).toEqual([5, 0, 6, 0]);
    scoreGoal(s, -1, 0);
    expect(s).toEqual([4, 0, 6, 0]);
  });
});

describe('slapshot: the puck', () => {
  it('slides to a stop where predict() says it will', () => {
    const b = { x: 0, y: 0, vx: 900, vy: 300 };
    const out = { x: 0, y: 0 };
    predict(b, 10, out);
    for (let i = 0; i < 2400; i++) slide(b, 1 / 240);
    expect(Math.hypot(b.vx, b.vy)).toBeLessThan(1);
    expect(Math.hypot(b.x - out.x, b.y - out.y)).toBeLessThan(40);
  });

  it('fires harder the longer the wind-up', () => {
    expect(shotSpeed(0)).toBeLessThan(shotSpeed(0.5));
    expect(shotSpeed(0.5)).toBeLessThan(shotSpeed(1));
    expect(shotSpeed(2)).toBe(shotSpeed(1));
  });
});
