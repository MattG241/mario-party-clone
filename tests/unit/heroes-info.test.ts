import { describe, expect, it } from 'vitest';
import { HEROES_INFO } from '../../src/game/worlds/heroes/info';

// The art on disk (paths only: nothing is loaded).
const FULL = Object.keys(import.meta.glob('../../public/assets/rendered/scene_heroes_*.webp'));
const LITE = Object.keys(import.meta.glob('../../public/assets/lite/scene_heroes_*.webp'));
const WORDS_TO_AVOID = /\bchips?\b|\brelics?\b|prism/i;
// Gameplay sprites the scenes load themselves (RooftopGlide / WebSwing / RepulsorRange SPRITES).
const GAME_SPRITES = ['lamp_head', 'street', 'towers', 'drone', 'zip', 'heavy', 'disc', 'gold', 'balloon', 'balloon_b', 'balloon_c', 'pad'];
const SPRITE_FULL = Object.keys(import.meta.glob('../../public/assets/rendered/mg/heroes_*.webp'));
const SPRITE_LITE = Object.keys(import.meta.glob('../../public/assets/lite/mg/heroes_*.webp'));
const TOWERS = Object.values(import.meta.glob('../../public/assets/rendered/mg/heroes_towers.json', { eager: true, import: 'default' }));

interface TowerAtlas {
  frames: Record<string, { frame: { w: number; h: number } }>;
  anchors: Record<string, { anchor: [number, number]; kind: string }>;
}

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

  it('ship their gameplay sprites (full size and Lite); the buildings atlas places an anchor on every frame', () => {
    for (const n of GAME_SPRITES) {
      expect(SPRITE_FULL.some((f) => f.endsWith(`/heroes_${n}.webp`)), n).toBe(true);
      expect(SPRITE_LITE.some((f) => f.endsWith(`/heroes_${n}.webp`)), `lite ${n}`).toBe(true);
    }
    const atlas = TOWERS[0] as TowerAtlas | undefined;
    expect(atlas).toBeDefined();
    if (!atlas) return;
    const kinds = new Set<string>();
    for (const [name, a] of Object.entries(atlas.anchors)) {
      const f = atlas.frames[name]?.frame;
      expect(f, name).toBeDefined();
      if (!f) continue;
      expect(a.anchor[0], name).toBeGreaterThanOrEqual(0);
      expect(a.anchor[0], name).toBeLessThanOrEqual(f.w);
      expect(a.anchor[1], name).toBeGreaterThanOrEqual(0);
      expect(a.anchor[1], name).toBeLessThanOrEqual(f.h);
      kinds.add(a.kind);
    }
    expect([...kinds].sort()).toEqual(['cornice', 'crane', 'mast', 'tank']);
  });

  it('ship every image they list, full size and for Lite', () => {
    for (const set of Object.values(HEROES_INFO.renders ?? {})) {
      for (const name of set.images) {
        expect(FULL.some((f) => f.endsWith(`/scene_${name}.webp`)), name).toBe(true);
        expect(LITE.some((f) => f.endsWith(`/scene_${name}.webp`)), `lite ${name}`).toBe(true);
      }
    }
  });
});
