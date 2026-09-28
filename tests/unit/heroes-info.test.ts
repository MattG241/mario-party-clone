import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEROES_INFO } from '../../src/game/worlds/heroes/info';

const ROOT = resolve(__dirname, '..', '..');
const WORDS_TO_AVOID = /\bchips?\b|\brelics?\b|prism/i;

describe('Hero Heights minigames', () => {
  it('are the three the boards expect, each themed on its guest', () => {
    const ids = HEROES_INFO.infos.map((m) => m.id);
    expect(ids).toEqual(['rooftop-glide', 'web-swing', 'repulsor-range']);
    const guests = HEROES_INFO.infos.map((m) => m.characters);
    expect(guests).toEqual([['batman'], ['spiderman'], ['ironman']]);
    for (const m of HEROES_INFO.infos) {
      expect(m.world).toBe('heroes');
      expect(m.sceneKey).toBe(`mg-${m.id}`);
      expect(m.instructions.length).toBeGreaterThanOrEqual(3);
      expect(m.instructions.length).toBeLessThanOrEqual(4);
    }
  });

  it('use the players\' words (coins and Star Coins, never chips or relics)', () => {
    for (const m of HEROES_INFO.infos) {
      for (const text of [m.name, m.tagline, m.description, ...m.instructions, ...m.controls.map((c) => c.label)]) expect(text, m.id).not.toMatch(WORDS_TO_AVOID);
    }
  });

  it('load their own arena art, and the intro card finds its arena, backdrop and rule icons in it', () => {
    const renders = HEROES_INFO.renders ?? {};
    for (const m of HEROES_INFO.infos) {
      const set = renders[m.id];
      expect(set, m.id).toBeDefined();
      for (const name of set.images) expect(name.startsWith('heroes_'), name).toBe(true);
      expect(m.arena).toBe(`rendered-scene-${set.images[0]}`);
      expect(set.images).toContain(`${set.images[0]}_blur`);
      for (const icon of m.ruleIcons ?? []) {
        if (!icon) continue;
        expect(set.images.map((n) => `rendered-scene-${n}`), m.id).toContain(icon.texture);
      }
    }
  });

  it('ship every image they list, full size and for Lite', () => {
    for (const set of Object.values(HEROES_INFO.renders ?? {})) {
      for (const name of set.images) {
        expect(existsSync(resolve(ROOT, 'public/assets/rendered', `scene_${name}.webp`)), name).toBe(true);
        expect(existsSync(resolve(ROOT, 'public/assets/lite', `scene_${name}.webp`)), `lite ${name}`).toBe(true);
      }
    }
  });
});
