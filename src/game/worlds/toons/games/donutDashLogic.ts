// Donut Dash rules (no Phaser here, so they can be unit tested): the factory layout shared with the
// rendered arena (scripts/art/worlds/toons/mg_donut.py), what rolls down the belts and how fast,
// where it lands, who can catch it and what it's worth.
import type { Random } from '../../../util/Random';

// --- Layout (screen px; the factory art must match) ---------------------------------------------
/** Belt centres; each belt's surface runs from the oven mouth (BELT_TOP_Y) to the drop edge. */
export const BELT_X = [352, 656, 960, 1264, 1568] as const;
export const BELT_TOP_Y = 183;
export const BELT_END_Y = 545;
export const BELT_HALF_W = 65;
/** Ground row under each belt's drop edge (where a falling item's shadow starts). */
export const BELT_GROUND_Y = 640;
/** The floor the players run on. */
export const FLOOR = { x0: 150, x1: 1770, y0: 700, y1: 968 } as const;

// --- Timing ------------------------------------------------------------------------------------
export const ROUND_MS = 45000;
/** The belts speed up every this often (twice: the rush takes over for the last ten seconds). */
export const SPEEDUP_MS = 12000;
export const SPEEDUPS = 2;
/** An item's flight from the drop edge to box height, then on down to the floor. */
export const FLIGHT_MS = 640;
export const DROP_MS = 170;
/** The landing marker shows up this long before an item tips off its belt. */
export const MARK_MS = 900;
/** Items on one belt keep at least this far apart (a share of the belt). */
export const BELT_GAP = 0.2;

/** Belt speed (px/s along its length on screen): it jumps up at every speed-up, and a touch in the rush. */
export function speedStep(elapsedMs: number): number {
  return Math.min(SPEEDUPS, Math.floor(Math.max(0, elapsedMs) / SPEEDUP_MS));
}

export function beltSpeed(elapsedMs: number, rush: boolean): number {
  return 140 * Math.pow(1.2, speedStep(elapsedMs)) * (rush ? 1.12 : 1);
}

/** Items launched per second: more with more players, busier as the belts speed up and in the rush. */
export function spawnRate(elapsedMs: number, players: number, rush: boolean): number {
  return (1.35 + 0.25 * speedStep(elapsedMs)) * (0.8 + 0.25 * players) * (rush ? 1.3 : 1);
}

// --- Items -------------------------------------------------------------------------------------
export type ItemKind = 'donut' | 'rainbow' | 'broccoli' | 'burnt';

export interface Pick {
  kind: ItemKind;
  /** Frosting colour index 0..3 (the player colours) for donuts, -1 otherwise. */
  colour: number;
}

/**
 * What comes out of the oven next. Donuts in the players' colours make up most of it (colours nobody
 * plays turn up now and then as decoys), with a sprinkling of rainbow donuts (anyone's) and the odd
 * broccoli or burnt donut to dodge.
 */
export function pickItem(rng: Random, colours: readonly number[], rush: boolean): Pick {
  const decoys = [0, 1, 2, 3].filter((c) => !colours.includes(c));
  const entries: { item: string; weight: number }[] = [
    { item: 'own', weight: 0.6 },
    { item: 'decoy', weight: decoys.length ? 0.12 : 0 },
    { item: 'rainbow', weight: rush ? 0.14 : 0.08 },
    { item: 'broccoli', weight: 0.11 },
    { item: 'burnt', weight: 0.09 },
  ];
  const k = rng.weighted(entries);
  if (k === 'own') return { kind: 'donut', colour: rng.pick(colours) };
  if (k === 'decoy') return { kind: 'donut', colour: rng.pick(decoys) };
  return { kind: k as ItemKind, colour: -1 };
}

/** Where an item from belt `belt` lands: faster belts throw it further out over the floor. */
export function landingPoint(rng: Random, belt: number, speed: number): { x: number; y: number } {
  const x = BELT_X[belt] + rng.range(-85, 85);
  const reach = (speed - 140) * 0.55;
  const y = FLOOR.y0 + 30 + reach + rng.range(0, 150);
  return { x: Math.max(FLOOR.x0 + 20, Math.min(FLOOR.x1 - 20, x)), y: Math.max(FLOOR.y0 + 20, Math.min(FLOOR.y1 - 16, y)) };
}

/** Whether a player with frosting colour `mine` catches this item when under it (other colours fall past). */
export function catches(p: Pick, mine: number): boolean {
  return p.kind !== 'donut' || p.colour === mine;
}

/** What catching it does to the donut count. */
export function scoreDelta(p: Pick, mine: number): number {
  switch (p.kind) {
    case 'donut':
      return p.colour === mine ? 1 : 0;
    case 'rainbow':
      return 2;
    default:
      return -1;
  }
}

export function isBad(p: Pick): boolean {
  return p.kind === 'broccoli' || p.kind === 'burnt';
}

/** Catch zone round a player's feet (an ellipse flattened like the floor). */
export const CATCH_RX = 80;
export const CATCH_RY = 46;

export function inCatch(px: number, py: number, lx: number, ly: number): boolean {
  const dx = (px - lx) / CATCH_RX;
  const dy = (py - ly) / CATCH_RY;
  return dx * dx + dy * dy <= 1;
}

/** Stuns from the things you should have dodged (ms). */
export const STUN_MS: Record<ItemKind, number> = { donut: 0, rainbow: 0, broccoli: 900, burnt: 600 };

// --- CPU helper --------------------------------------------------------------------------------
export interface Target {
  x: number;
  y: number;
  /** ms until it reaches box height. */
  t: number;
  value: number;
}

/**
 * The most worthwhile target a runner at (x, y) moving `speed` px/s can reach in time: value over
 * waiting time, less a little for distance. Returns -1 if nothing is reachable.
 */
export function bestTarget(x: number, y: number, speed: number, targets: readonly Target[], count = targets.length): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < count; i++) {
    const tg = targets[i];
    if (tg.value <= 0) continue;
    const d = Math.hypot(tg.x - x, (tg.y - y) * 1.4);
    const eta = (Math.max(0, d - CATCH_RX * 0.6) / Math.max(1, speed)) * 1000;
    if (eta > tg.t + 120) continue;
    const score = (tg.value * 1000) / (tg.t + 500) - d * 0.0015;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
