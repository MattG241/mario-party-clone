// Ring Rush rules (no Phaser here, so they can be unit tested): the lane layout shared with the
// rendered scenery (scripts/art/worlds/toons/mg_rush.py), the running physics, the course
// generator that lays rings and robot critters ahead of the runners, and the ring scatter.
import type { Random } from '../../../util/Random';

// --- Layout (screen px; the scenery art must match) ---------------------------------------------
/** Lane centre lines on the ground (top lane first). */
export const LANE_Y = [540, 665, 790, 915] as const;
export const LANES = LANE_Y.length;
/** The scenery tiles horizontally with this period (both layers). */
export const PERIOD = 1920;
/** The far hills layer is drawn at y 0 (1920 x 540) and scrolls slower than the track. */
export const FAR_PARALLAX = 0.32;
/** The track layer (1920 x 860, transparent above the border) is drawn from this height. */
export const TRACK_IMG_Y = 220;

// --- Runners -----------------------------------------------------------------------------------
/** Where runners run on screen (they drift ahead with a spin-dash and fall back when hit). */
export const RUN_X = 520;
export const X_MIN = 380;
export const X_MAX = 820;
/** Jump launch speed and gravity (px/s, px/s²): airtime ~0.7 s, apex ~190 px. */
export const JUMP_V = 1060;
export const GRAVITY = 3000;
/** A spring launches much higher. */
export const SPRING_V = 1480;
/** Spin-dash: how long it lasts, its cooldown (from the start of one to the next) and its surge. */
export const DASH_MS = 460;
export const DASH_CD = 1150;
export const DASH_SURGE = 190;
/** After a hit: blinking invulnerability and how far back it knocks you. */
export const INVULN_MS = 1400;
export const KNOCK_BACK = 150;
/** Lane changes glide over this long. */
export const LANE_MS = 150;

// --- Hit boxes (lane space: same lane, |dx| and height) -----------------------------------------
export const RING_DX = 50;
export const RING_DZ = 78;
export const BOT_DX = 50;
/** A crawler hurts anyone lower than this. */
export const CRAWLER_CLEAR = 58;
/** Rings hang this high above the lane at z = 0 (the runner's middle). */
export const RING_LIFT = 46;
/** Buzzers hover this high (their centre), bobbing a little: too high to jump past, too low to run under. */
export const BUZZER_Z = 88;

// --- Scroll speed ------------------------------------------------------------------------------
export const ROUND_MS = 45000;
/** Scroll speed (px/s) at a moment of the round: it ramps up, and the fever adds a little more. */
export function scrollSpeed(elapsedMs: number, fever: boolean): number {
  const t = Math.min(1, Math.max(0, elapsedMs / ROUND_MS));
  return (560 + 260 * t) * (fever ? 1.06 : 1);
}

// --- Scoring -----------------------------------------------------------------------------------
export const BIG_RING = 5;
/** Most rings a single hit can knock loose. */
export const MAX_SCATTER = 8;

/** Rings knocked loose by a robot hit: half of what you hold (at least one), at most MAX_SCATTER. */
export function ringsLost(held: number): number {
  if (held <= 0) return 0;
  return Math.min(held, MAX_SCATTER, Math.max(1, Math.ceil(held / 2)));
}

/** A rival's spin-dash knocks this many loose. */
export function ringsBumped(held: number): number {
  return Math.min(held, 2);
}

// --- Course ------------------------------------------------------------------------------------
export type ItemKind = 'ring' | 'bigring' | 'crawler' | 'buzzer' | 'spring';

export interface CourseItem {
  kind: ItemKind;
  lane: number;
  /** World x (screen x = wx - scroll). */
  wx: number;
  /** Height above the lane (rings: above RING_LIFT). */
  z: number;
}

export function isHazard(kind: ItemKind): boolean {
  return kind === 'crawler' || kind === 'buzzer';
}

/**
 * Hazards in one lane never come closer together than this (px): time to react and act at the
 * current speed, and for buzzers a spin-dash cooldown (so every hazard can be beaten in its lane).
 */
export function minHazardGap(kind: ItemKind, prevKind: ItemKind, speed: number): number {
  if (kind === 'buzzer' && prevKind === 'buzzer') return speed * (DASH_CD / 1000) * 1.25;
  return speed * 0.72 + 140;
}

type Pattern = 'line' | 'twin' | 'hop' | 'wall' | 'buzz' | 'spring' | 'zigzag' | 'gauntlet';

/**
 * Lays the course ahead of the runners one chunk at a time: ring lines to steer for, crawlers to
 * jump, buzzers to spin-dash (or dodge), springs that launch you along a ring arc. Every hazard
 * keeps its distance from the last one in its lane (minHazardGap) and no chunk ever walls off all
 * four lanes.
 */
export class RushCourse {
  /** World x where the next chunk begins. */
  cursor: number;
  private lastHazard: number[] = [-1e9, -1e9, -1e9, -1e9];
  private lastKind: ItemKind[] = ['ring', 'ring', 'ring', 'ring'];
  private lastPattern: Pattern | null = null;

  constructor(
    private rng: Random,
    start: number,
  ) {
    this.cursor = start;
  }

  /** The next chunk's items (in any order); advances the cursor past it. intensity 0..1 over the round. */
  nextChunk(speed: number, intensity: number, fever: boolean): CourseItem[] {
    const pattern = this.pickPattern(intensity, fever);
    this.lastPattern = pattern;
    let items = this.build(pattern, 0, fever, intensity, speed);
    // Push the whole chunk back until each hazard keeps its distance from the last in its lane.
    let shift = 0;
    for (const it of items) {
      if (!isHazard(it.kind)) continue;
      const need = this.lastHazard[it.lane] + minHazardGap(it.kind, this.lastKind[it.lane], speed) - (this.cursor + it.wx);
      if (need > shift) shift = need;
    }
    items = items.map((it) => ({ ...it, wx: it.wx + this.cursor + shift }));
    let end = this.cursor + shift;
    for (const it of items) {
      end = Math.max(end, it.wx);
      if (isHazard(it.kind) && it.wx > this.lastHazard[it.lane]) {
        this.lastHazard[it.lane] = it.wx;
        this.lastKind[it.lane] = it.kind;
      }
    }
    this.cursor = end + this.rng.range(150, 260) * (fever ? 0.75 : 1);
    return items;
  }

  private pickPattern(intensity: number, fever: boolean): Pattern {
    const w = (base: number, grow: number) => Math.max(0, base + grow * intensity);
    const entries: { item: Pattern; weight: number }[] = [
      { item: 'line', weight: fever ? 5 : w(3, -1) },
      { item: 'twin', weight: fever ? 4 : w(1.5, 0.5) },
      { item: 'hop', weight: w(2.5, 0.5) },
      { item: 'wall', weight: w(0.6, 1.4) },
      { item: 'buzz', weight: w(1.6, 1) },
      { item: 'spring', weight: fever ? 2 : w(1, 0.4) },
      { item: 'zigzag', weight: w(1.4, 0.2) },
      { item: 'gauntlet', weight: fever ? 0.5 : w(-0.2, 2) },
    ];
    // never the same pattern twice running
    for (const e of entries) if (e.item === this.lastPattern) e.weight *= 0.15;
    return this.rng.weighted(entries);
  }

  private lane(): number {
    return this.rng.int(0, LANES - 1);
  }

  private otherLane(not: number[]): number {
    const free = [0, 1, 2, 3].filter((l) => !not.includes(l));
    return this.rng.pick(free);
  }

  private line(out: CourseItem[], lane: number, x0: number, n: number, step = 70, z = 0): void {
    for (let i = 0; i < n; i++) out.push({ kind: 'ring', lane, wx: x0 + i * step, z });
  }

  /**
   * Rings along the path of a jump launched at `v0` from world x `from` at scroll `speed`: rings
   * spread over the middle of the flight (u0..u1 of the airtime), a touch under the true arc so a
   * jump taken a little early or late still sweeps them up.
   */
  private flight(out: CourseItem[], lane: number, from: number, speed: number, v0: number, n: number, u0 = 0.1, u1 = 0.9): void {
    const T = (2 * v0) / GRAVITY;
    for (let i = 0; i < n; i++) {
      const t = T * (u0 + ((u1 - u0) * i) / Math.max(1, n - 1));
      out.push({ kind: 'ring', lane, wx: from + speed * t, z: (v0 * t - (GRAVITY * t * t) / 2) * 0.9 });
    }
  }

  /** Rings over a crawler at world x `at`: the arc of a jump taken to clear it. */
  private hopArc(out: CourseItem[], lane: number, at: number, speed: number, n: number): void {
    const T = (2 * JUMP_V) / GRAVITY;
    this.flight(out, lane, at - (speed * T) / 2, speed, JUMP_V, n, 0.08, 0.92);
  }

  private build(p: Pattern, x: number, fever: boolean, intensity: number, speed: number): CourseItem[] {
    const out: CourseItem[] = [];
    const rng = this.rng;
    switch (p) {
      case 'line': {
        const l = this.lane();
        this.line(out, l, x, rng.int(5, 8));
        if (fever) this.line(out, this.otherLane([l]), x + 140, 5);
        break;
      }
      case 'twin': {
        const a = this.lane();
        const b = this.otherLane([a]);
        this.line(out, a, x, 5);
        this.line(out, b, x + 60, 5);
        break;
      }
      case 'hop': {
        // a crawler with a ring arc over it (jump for the lot); a thinner line elsewhere
        const l = this.lane();
        out.push({ kind: 'crawler', lane: l, wx: x + 260, z: 0 });
        this.hopArc(out, l, x + 260, speed, 7);
        if (rng.chance(0.6)) this.line(out, this.otherLane([l]), x + 120, 3);
        break;
      }
      case 'wall': {
        // crawlers across two or three lanes at once, a ring over each; one lane stays open
        const open = this.lane();
        const blocked = [0, 1, 2, 3].filter((l) => l !== open);
        rng.shuffle(blocked);
        const count = intensity > 0.5 && rng.chance(0.5) ? 3 : 2;
        for (const l of blocked.slice(0, count)) {
          out.push({ kind: 'crawler', lane: l, wx: x + 240, z: 0 });
          this.hopArc(out, l, x + 240, speed, 3);
        }
        this.line(out, open, x + 120, 3);
        break;
      }
      case 'buzz': {
        // a buzzer guarding a line of rings (spin-dash through it), a few rings next door
        const l = this.lane();
        out.push({ kind: 'buzzer', lane: l, wx: x + 160, z: BUZZER_Z });
        this.line(out, l, x + 250, 4);
        if (rng.chance(0.25 + 0.3 * intensity)) out.push({ kind: 'bigring', lane: l, wx: x + 540, z: 20 });
        this.line(out, this.otherLane([l]), x + 60, 3);
        break;
      }
      case 'spring': {
        // a spring into a tall arc of rings over a crawler, a big ring at the top
        const l = this.lane();
        const T = (2 * SPRING_V) / GRAVITY;
        const apex = (SPRING_V * SPRING_V) / (2 * GRAVITY);
        out.push({ kind: 'spring', lane: l, wx: x + 60, z: 0 });
        out.push({ kind: 'crawler', lane: l, wx: x + 60 + (speed * T) / 2, z: 0 });
        this.flight(out, l, x + 60, speed, SPRING_V, 9, 0.12, 0.88);
        if (fever || rng.chance(0.45)) out.push({ kind: 'bigring', lane: l, wx: x + 60 + (speed * T) / 2, z: apex * 0.92 });
        break;
      }
      case 'zigzag': {
        // rings stepping across the lanes: follow them
        let l = this.lane();
        const dir = l === 0 ? 1 : l === LANES - 1 ? -1 : rng.chance(0.5) ? 1 : -1;
        let d = dir;
        for (let i = 0; i < 8; i++) {
          out.push({ kind: 'ring', lane: l, wx: x + i * 95, z: 0 });
          if (i % 2 === 1) {
            if (l + d < 0 || l + d >= LANES) d = -d;
            l += d;
          }
        }
        break;
      }
      case 'gauntlet': {
        // two lanes of mixed hazards, staggered, with rings between them
        const a = this.lane();
        const b = this.otherLane([a]);
        out.push({ kind: 'crawler', lane: a, wx: x + 200, z: 0 });
        out.push({ kind: 'buzzer', lane: b, wx: x + 360, z: BUZZER_Z });
        this.hopArc(out, a, x + 200, speed, 3);
        this.line(out, b, x + 450, 3);
        this.line(out, this.otherLane([a, b]), x + 200, 4);
        break;
      }
    }
    return out;
  }
}

// --- CPU helpers -------------------------------------------------------------------------------
/** What a runner sees ahead in a lane (screen px ahead of it, the item's kind and height). */
export interface Seen {
  lane: number;
  dx: number;
  kind: ItemKind | 'scatter';
  z: number;
}

/**
 * How much a lane is worth to a runner looking `look` px ahead: rings pull (nearer ones more),
 * hazards push (a buzzer much harder when the spin-dash won't be ready in time).
 */
export function laneValue(seen: readonly Seen[], lane: number, look: number, dashReadyIn: number, speed: number, count = seen.length): number {
  let v = 0;
  for (let i = 0; i < count; i++) {
    const s = seen[i];
    if (s.lane !== lane || s.dx < -20 || s.dx > look) continue;
    const near = 1 - (s.dx / look) * 0.6;
    switch (s.kind) {
      case 'ring':
      case 'scatter':
        v += (s.z > 160 ? 0.5 : 1) * near;
        break;
      case 'bigring':
        v += (s.z > 160 ? 1.5 : BIG_RING) * near;
        break;
      case 'crawler':
        v -= 1.2 * near;
        break;
      case 'buzzer': {
        const arrive = (s.dx / Math.max(1, speed)) * 1000;
        v -= (dashReadyIn < arrive - 60 ? 1.4 : 6) * near;
        break;
      }
      case 'spring':
        v += 1.5 * near;
        break;
    }
  }
  return v;
}
