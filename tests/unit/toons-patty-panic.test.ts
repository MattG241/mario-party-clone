import { describe, expect, it } from 'vitest';
import {
  BUTTON_FOR,
  FACE_BUTTONS,
  INGREDIENT_FOR,
  INGREDIENTS,
  makeMenu,
  MAX_LAYERS,
  patienceMs,
  pressResult,
  recipeLength,
  stationX,
} from '../../src/game/worlds/toons/games/pattyPanicLogic';
import { Random } from '../../src/game/util/Random';

describe('Patty Panic rules', () => {
  it('gives every topping its own button, both ways round', () => {
    expect(new Set(Object.values(BUTTON_FOR)).size).toBe(INGREDIENTS.length);
    for (const b of FACE_BUTTONS) expect(BUTTON_FOR[INGREDIENT_FOR[b]]).toBe(b);
  });

  it('builds a menu that grows from two toppings to five', () => {
    expect(recipeLength(0)).toBe(2);
    expect(recipeLength(3)).toBe(3);
    expect(recipeLength(40)).toBe(MAX_LAYERS);
    for (let k = 1; k < 40; k++) expect(recipeLength(k)).toBeGreaterThanOrEqual(recipeLength(k - 1));
  });

  it('puts a patty in every burger and never the same topping twice running (bar a double patty)', () => {
    for (const seed of [1, 7, 42, 999, 31337]) {
      const menu = makeMenu(new Random(seed));
      expect(menu.length).toBeGreaterThanOrEqual(40);
      menu.forEach((r, k) => {
        expect(r.length).toBe(recipeLength(k));
        expect(r).toContain('patty');
        for (let i = 1; i < r.length; i++) if (r[i] === r[i - 1]) expect(r[i]).toBe('patty');
      });
    }
  });

  it('is the same menu for the same seed', () => {
    expect(makeMenu(new Random(5))).toEqual(makeMenu(new Random(5)));
  });

  it('places, completes and rejects presses', () => {
    const r = ['patty', 'cheese', 'lettuce'] as const;
    expect(pressResult(r, 0, 'patty')).toBe('placed');
    expect(pressResult(r, 1, 'cheese')).toBe('placed');
    expect(pressResult(r, 2, 'lettuce')).toBe('complete');
    expect(pressResult(r, 1, 'tomato')).toBe('wrong');
    expect(pressResult(r, 0, 'cheese')).toBe('wrong');
  });

  it('gives bigger orders more patience, and less as the round goes on', () => {
    expect(patienceMs(5, 0)).toBeGreaterThan(patienceMs(2, 0));
    expect(patienceMs(3, 45000)).toBeLessThan(patienceMs(3, 0));
    // always enough time to press every topping at a steady pace
    for (let n = 2; n <= MAX_LAYERS; n++) expect(patienceMs(n, 50000)).toBeGreaterThan(n * 700 + 2000);
  });

  it('lays the stations out evenly across the screen', () => {
    expect(stationX(0, 1)).toBe(960);
    expect(stationX(0, 2) + stationX(1, 2)).toBe(1920);
    expect(stationX(0, 4)).toBeGreaterThan(200);
    expect(stationX(3, 4)).toBeLessThan(1720);
  });
});
