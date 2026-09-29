// The festival day: the match runs from a fresh morning through midday and golden hour to a
// sunset, and the final round is a lantern-lit dusk that deepens into night with every turn.
// Everything here is cheap colour work (a sky cross-fade and multiplicative tints), so it costs
// the same on Lite as on Full; Full also nudges the colour grade it already runs.
import type { MatchPhase } from '../state/MatchState';

export type SkyKey = 'day' | 'clear' | 'golden' | 'sunset' | 'dusk';

/** One moment of the day. Colours are multiplicative tints (0xffffff = untouched). */
interface Key {
  t: number;
  sky: SkyKey;
  /** Tint over the rendered sky of that moment (Full). */
  skyTint: number;
  /** Lite has only the day sky, so it tints that one to stand in for the others. */
  liteSky: number;
  /** Terrain, landmarks and NPCs. */
  land: number;
  /** The space discs and trail arrows: kept lighter than the land so the route always reads. */
  spaces: number;
  chars: number;
  /** Lanterns, space halos and the relic's night bloom (0–1). */
  glow: number;
  /** Strength of sunlit extras: cloud shadows, water glints, drifting petals, birds (0–1). */
  sun: number;
  /** Warm highlight tint for the Full colour grade. */
  high: [number, number, number];
  vignette: number;
}

const KEYS: Key[] = [
  { t: 0, sky: 'day', skyTint: 0xffffff, liteSky: 0xffffff, land: 0xf6f9ff, spaces: 0xffffff, chars: 0xfff8f0, glow: 0, sun: 1, high: [1.02, 1.0, 0.98], vignette: 0.1 },
  { t: 0.3, sky: 'clear', skyTint: 0xffffff, liteSky: 0xf4f9ff, land: 0xffffff, spaces: 0xffffff, chars: 0xfff5e8, glow: 0, sun: 1, high: [1.03, 1.0, 0.96], vignette: 0.1 },
  { t: 0.6, sky: 'golden', skyTint: 0xfff4e4, liteSky: 0xffe4c4, land: 0xffe9cc, spaces: 0xfff6ea, chars: 0xffeed8, glow: 0, sun: 1, high: [1.07, 1.0, 0.91], vignette: 0.12 },
  { t: 0.8, sky: 'sunset', skyTint: 0xffeae2, liteSky: 0xffcfba, land: 0xffdcc6, spaces: 0xfff1e8, chars: 0xffe6d8, glow: 0.35, sun: 0.7, high: [1.08, 0.99, 0.92], vignette: 0.14 },
  { t: 0.9, sky: 'dusk', skyTint: 0xe8daf2, liteSky: 0xd6b8e0, land: 0xd8c4dc, spaces: 0xf6ecf6, chars: 0xf2e0f0, glow: 0.8, sun: 0.15, high: [1.04, 0.98, 1.02], vignette: 0.17 },
  { t: 1, sky: 'dusk', skyTint: 0xab9bcf, liteSky: 0x9a8ac2, land: 0xb4a8d4, spaces: 0xefe6f8, chars: 0xede2f6, glow: 1, sun: 0, high: [1.02, 0.98, 1.06], vignette: 0.2 },
];

/** The look at one moment, blended between the two nearest keys (one shared object: read, don't keep). */
export interface Look {
  t: number;
  skyA: SkyKey;
  skyB: SkyKey;
  /** 0 = all skyA, 1 = all skyB. */
  skyMix: number;
  skyTint: number;
  liteSky: number;
  land: number;
  spaces: number;
  chars: number;
  glow: number;
  sun: number;
  high: [number, number, number];
  vignette: number;
}

const look: Look = {
  t: 0,
  skyA: 'day',
  skyB: 'day',
  skyMix: 0,
  skyTint: 0xffffff,
  liteSky: 0xffffff,
  land: 0xffffff,
  spaces: 0xffffff,
  chars: 0xffffff,
  glow: 0,
  sun: 1,
  high: [1, 1, 1],
  vignette: 0.1,
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Blend two 0xRRGGBB colours. */
export function lerpColor(a: number, b: number, k: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** Multiply two 0xRRGGBB colours (a tint on top of a tint). */
export function mulColor(a: number, b: number): number {
  const r = Math.round((((a >> 16) & 255) * ((b >> 16) & 255)) / 255);
  const g = Math.round((((a >> 8) & 255) * ((b >> 8) & 255)) / 255);
  const bl = Math.round(((a & 255) * (b & 255)) / 255);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Time of day for a moment of the match: 0 = morning … 0.82 = sunset for the penultimate round;
 * the final round starts at dusk (0.9) and reaches night (1) by its last turn and the finale.
 */
export function dayTime(round: number, rounds: number, phase: MatchPhase, players: number): number {
  if (rounds <= 1 || round >= rounds) {
    if (phase.kind === 'roundStart') return 0.9;
    if (phase.kind === 'turn') return 0.9 + 0.1 * (players > 1 ? clamp01(phase.index / (players - 1)) : 1);
    return 1;
  }
  return 0.82 * clamp01((round - 1) / Math.max(1, rounds - 2));
}

/**
 * A board's own hours: the festival day (default), a match that stays in daylight (morning to golden
 * hour), or one held at night (dusk deepening to full night).
 */
export function themedTime(t: number, time: 'cycle' | 'day' | 'night' = 'cycle'): number {
  if (time === 'day') return 0.62 * t;
  if (time === 'night') return 0.9 + 0.1 * t;
  return t;
}

/** What the players would call a moment of the day (named on the round banner when it changes). */
export function dayName(t: number): string {
  if (t < 0.18) return 'MORNING';
  if (t < 0.45) return 'MIDDAY';
  if (t < 0.7) return 'GOLDEN HOUR';
  if (t < 0.86) return 'SUNSET';
  return 'NIGHTFALL';
}

/** The blended look at time t (0–1). Returns a shared object. */
export function lookAt(t: number): Look {
  const tt = clamp01(t);
  let i = 0;
  while (i < KEYS.length - 2 && tt > KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const k = clamp01((tt - a.t) / Math.max(1e-6, b.t - a.t));
  look.t = tt;
  look.skyA = a.sky;
  look.skyB = b.sky;
  look.skyMix = a.sky === b.sky ? 0 : k;
  look.skyTint = lerpColor(a.skyTint, b.skyTint, k);
  look.liteSky = lerpColor(a.liteSky, b.liteSky, k);
  look.land = lerpColor(a.land, b.land, k);
  look.spaces = lerpColor(a.spaces, b.spaces, k);
  look.chars = lerpColor(a.chars, b.chars, k);
  look.glow = a.glow + (b.glow - a.glow) * k;
  look.sun = a.sun + (b.sun - a.sun) * k;
  for (let c = 0; c < 3; c++) look.high[c] = a.high[c] + (b.high[c] - a.high[c]) * k;
  look.vignette = a.vignette + (b.vignette - a.vignette) * k;
  return look;
}
