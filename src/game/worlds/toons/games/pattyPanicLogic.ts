// Patty Panic rules (no Phaser here, so they can be unit tested): the kitchen layout shared with the
// rendered arena (scripts/art/worlds/toons/mg_patty.py), the menu every cook works through, the
// button for each topping, and how long customers wait.
import type { Random } from '../../../util/Random';

export type Ingredient = 'patty' | 'lettuce' | 'tomato' | 'cheese';
export type FaceButton = 'A' | 'B' | 'X' | 'Y';

export const INGREDIENTS: readonly Ingredient[] = ['patty', 'lettuce', 'tomato', 'cheese'];
/** Each topping has its own face button (the buttons' colours match: green lettuce, red tomato, yellow cheese). */
export const BUTTON_FOR: Record<Ingredient, FaceButton> = { patty: 'X', lettuce: 'A', tomato: 'B', cheese: 'Y' };
export const INGREDIENT_FOR: Record<FaceButton, Ingredient> = { X: 'patty', A: 'lettuce', B: 'tomato', Y: 'cheese' };
export const FACE_BUTTONS: readonly FaceButton[] = ['X', 'A', 'B', 'Y'];

// --- Layout (screen px; the kitchen art must match) ---------------------------------------------
/** Cooks stand behind the counter with their feet here (hidden by it). */
export const COOK_FEET_Y = 880;
/** The counter top runs from its back edge (y 800) to its front edge (y 840); its face spans 840..955. */
export const COUNTER_BACK_Y = 800;
export const COUNTER_FRONT_Y = 840;
export const COUNTER_FACE_BOTTOM = 955;
/** The front layer (counter) is the arena render from this row down, drawn over the cooks. */
export const FRONT_CUT = 798;
/** Where the plates sit on the counter top. */
export const PLATE_Y = 824;
/** Order tickets hang from the brass rail at this height. */
export const TICKET_TOP = 126;
export const STATION_GAP = 450;

/** Centre x of cook i's station when n cook. */
export function stationX(i: number, n: number): number {
  return 960 + (i - (n - 1) / 2) * STATION_GAP;
}

// --- Orders ------------------------------------------------------------------------------------
export const ROUND_MS = 50000;
export const MAX_LAYERS = 5;

/** Toppings between the buns on the k-th order: two to start, up to five. */
export function recipeLength(k: number): number {
  return k < 2 ? 2 : k < 5 ? 3 : k < 9 ? 4 : MAX_LAYERS;
}

/**
 * The menu: every cook's k-th order is the same burger (so nobody gets luckier tickets). Each has at
 * least one patty, and no topping twice running except a double patty.
 */
export function makeMenu(rng: Random, count = 48): Ingredient[][] {
  const menu: Ingredient[][] = [];
  for (let k = 0; k < count; k++) {
    const n = recipeLength(k);
    const r: Ingredient[] = [];
    for (let i = 0; i < n; i++) {
      let pick = rng.pick(INGREDIENTS);
      let guard = 0;
      while (i > 0 && pick === r[i - 1] && pick !== 'patty' && guard++ < 20) pick = rng.pick(INGREDIENTS);
      r.push(pick);
    }
    if (!r.includes('patty')) r[rng.int(0, n - 1)] = 'patty';
    menu.push(r);
  }
  return menu;
}

export type PressResult = 'placed' | 'complete' | 'wrong';

/** Pressing a topping with `placed` layers already on the bun. */
export function pressResult(recipe: readonly Ingredient[], placed: number, ing: Ingredient): PressResult {
  if (recipe[placed] !== ing) return 'wrong';
  return placed + 1 >= recipe.length ? 'complete' : 'placed';
}

/** How long a customer waits for an order with n toppings; they get less patient as the round goes on. */
export function patienceMs(n: number, elapsedMs: number): number {
  const rush = Math.min(1, Math.max(0, elapsedMs / ROUND_MS));
  return (5600 + 1500 * n) * (1 - 0.22 * rush);
}

/** A stack knocked over by a wrong button takes this long to clear before the cook can go again. */
export const TOPPLE_MS = 650;

/** CPU cooks: time per topping (ms) and the chance a press goes wrong, by difficulty. */
export const CPU_COOK = {
  easy: { press: 640, slip: 0.08, read: 700 },
  normal: { press: 420, slip: 0.035, read: 480 },
  hard: { press: 285, slip: 0.015, read: 320 },
} as const;
