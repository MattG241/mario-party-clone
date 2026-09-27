// Tumble Tower: tower layout (pure, Phaser-free so it can be unit-tested) and scoring.
import type { Random } from '../../util/Random';

// --- World (side view; world y grows downwards and the camera scrolls up) ---------------------
/** Walking surface of the ground floor (world y). The view starts at scrollY 0. */
export const START_Y = 980;
/** Climbable height (100 px = 1 m): the summit ledge sits this far above the floor. */
export const TOWER_H = 5000;
export const PX_PER_M = 100;
export const SUMMIT_Y = START_Y - TOWER_H;
/** Horizontal play span in front of the tower wall (the wall art's drum spans x 280..1640). */
export const PLAY_X0 = 300;
export const PLAY_X1 = 1620;
/** Plank rows: vertical spacing (px) and jitter; "grab" rows are too tall to jump — grab the ledge. */
export const ROW_DY = 180;
export const ROW_JITTER = 10;
export const GRAB_STEP_DY = 250;
export const GRAB_ROWS = [5, 10, 15, 20, 25];
/** Widest gap between one row's plank and the next (edge to edge, px). */
export const MAX_GAP = 170;
/** On a grab row the plank below reaches at least this far past the ledge end (room to stand). */
export const GRAB_STANCE = 70;
/** Edge gap between a side branch and its route plank (px). */
export const BRANCH_GAP = [110, 190] as const;
/** The summit walkway spans the whole tower top. */
export const SUMMIT_W = PLAY_X1 - PLAY_X0 + 40;
/** Rows stop once the summit is within this reach (a plain jump). */
export const SUMMIT_REACH = 185;

export type PlankKind = 'ground' | 'static' | 'moving' | 'tipping' | 'crumble' | 'summit';

export interface PlankSpec {
  kind: PlankKind;
  /** Centre x and walking-surface y (world px). */
  x: number;
  y: number;
  w: number;
  /** Moving planks: horizontal swing (px), period (s) and phase (rad). */
  amp: number;
  period: number;
  phase: number;
  /** Too tall to jump onto from the row below: grab the ledge (drawn with brass handles). */
  grabRow: boolean;
  /** Part of the guaranteed zigzag route (the rest are side branches). */
  main: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function plank(kind: PlankKind, x: number, y: number, w: number, main: boolean, grabRow = false): PlankSpec {
  return { kind, x, y, w, amp: 0, period: 3, phase: 0, grabRow, main };
}

/**
 * Seeded zigzag of plank rows from the floor to the summit: one route plank per row (never more
 * than MAX_GAP from the one below, tall "grab" rows leave room to stand beside the ledge), plus
 * side branches. Moving / tipping / crumbling planks get more common higher up.
 */
export function generateTower(rng: Random): PlankSpec[] {
  const out: PlankSpec[] = [plank('ground', 960, START_Y, PLAY_X1 - PLAY_X0 + 260, true)];
  let y = START_Y;
  let prevX = 960;
  let prevW = 520;
  let prevKind = 'ground' as PlankKind;
  let dir: 1 | -1 = rng.chance(0.5) ? 1 : -1;
  for (let row = 1; row < 60; row++) {
    const remaining = y - SUMMIT_Y;
    if (remaining <= SUMMIT_REACH) break;
    let grab: boolean = GRAB_ROWS.includes(row) && remaining > GRAB_STEP_DY + 200 && prevKind !== 'moving';
    let dy: number = grab ? GRAB_STEP_DY : ROW_DY + rng.range(-ROW_JITTER, ROW_JITTER);
    if (!grab && remaining - dy < 110) dy = remaining - 140;
    const f: number = (START_Y - (y - dy)) / TOWER_H;
    const w = Math.round(rng.range(215, 285) - f * 40);
    let x: number;
    if (grab) {
      // Tall step: overlap the plank below so there's room to stand beside this one's end.
      const shift = (prevW + w) / 2 - rng.range(GRAB_STANCE + 10, GRAB_STANCE + 50);
      x = prevX + dir * shift;
      if (x - w / 2 < PLAY_X0 + 10 || x + w / 2 > PLAY_X1 - 10) {
        dir = dir > 0 ? -1 : 1;
        x = prevX + dir * shift;
      }
      x = clamp(x, PLAY_X0 + w / 2 + 10, PLAY_X1 - w / 2 - 10);
      const reachL = x - w / 2 - (prevX - prevW / 2);
      const reachR = prevX + prevW / 2 - (x + w / 2);
      if (Math.max(reachL, reachR) < GRAB_STANCE) {
        // No room beside the ledge after all: make it an ordinary row.
        grab = false;
        dy = ROW_DY;
      }
    } else {
      if (rng.chance(0.2)) dir = dir > 0 ? -1 : 1;
      const shift = rng.range(250, 390);
      x = prevX + dir * shift;
      if (x - w / 2 < PLAY_X0 + 10 || x + w / 2 > PLAY_X1 - 10) {
        dir = dir > 0 ? -1 : 1;
        x = prevX + dir * shift;
      }
      // Keep the jump makeable.
      const gap = Math.abs(x - prevX) - (w + prevW) / 2;
      if (gap > MAX_GAP) x = prevX + Math.sign(x - prevX) * ((w + prevW) / 2 + MAX_GAP);
      x = clamp(x, PLAY_X0 + w / 2 + 10, PLAY_X1 - w / 2 - 10);
    }
    y -= dy;
    let kind: PlankKind = 'static';
    if (!grab && row > 2 && !GRAB_ROWS.includes(row + 1)) {
      const calm: number = prevKind !== 'static' && prevKind !== 'ground' ? 0.5 : 1;
      const pm: number = (0.16 + 0.24 * f) * calm;
      const pt: number = (0.12 + 0.18 * f) * calm;
      const pc: number = (0.08 + 0.14 * f) * calm;
      const r = rng.next();
      kind = r < pm ? 'moving' : r < pm + pt ? 'tipping' : r < pm + pt + pc ? 'crumble' : 'static';
    }
    // A moving plank needs room to swing inside the tower (else it stays put).
    const room = Math.min(x - w / 2 - PLAY_X0, PLAY_X1 - x - w / 2);
    if (kind === 'moving' && room < 50) kind = 'static';
    const q = plank(kind, x, y, w, true, grab);
    if (kind === 'moving') {
      q.amp = clamp(rng.range(90, 170), 40, room);
      q.period = rng.range(2.8, 4.4);
      q.phase = rng.range(0, Math.PI * 2);
    }
    out.push(q);
    // Side branch: a plank beside the route plank at about the same height, always within a hop
    // of it (so nobody gets stranded on it, even after a bubble rescue).
    if (!grab && row > 1 && rng.chance(0.42)) {
      const bw = Math.round(rng.range(200, 250));
      const side = x < 960 ? 1 : -1;
      const bx = x + side * ((w + bw) / 2 + rng.range(BRANCH_GAP[0], BRANCH_GAP[1]));
      if (bx - bw / 2 > PLAY_X0 && bx + bw / 2 < PLAY_X1) {
        const bk: PlankKind = rng.chance(0.72) ? 'static' : rng.pick(['tipping', 'crumble'] as PlankKind[]);
        out.push(plank(bk, bx, y + rng.range(-24, 24), bw, false));
      }
    }
    prevX = x;
    prevW = w;
    prevKind = kind;
  }
  out.push(plank('summit', 960, SUMMIT_Y, SUMMIT_W, true));
  return out;
}

/** Results score: best standing height, ties broken by who got there first. */
export function towerScore(bestPx: number, bestAtMs: number): number {
  return Math.round(bestPx) * 100000 + Math.max(0, 99999 - Math.floor(bestAtMs));
}
