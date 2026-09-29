import { describe, expect, it } from 'vitest';
import { FRUITS } from '../../src/game/worlds/pirates/games/stretchSnatchRules';

// The Pirate Cove sprite atlases are rendered and packed by scripts/art/worlds/pirates/mg_sprites.py. A frame
// the game asks for that isn't in the sheet silently draws the sheet's first frame instead (in Stretch &
// Snatch that is the whole table top), so check the packed sheets against every frame the scenes use.
type Atlas = { frames: Record<string, { frame: { w: number; h: number }; sourceSize: { w: number; h: number } }> };
const ATLASES = import.meta.glob<Atlas>('../../public/assets/rendered/mg/pirates_*.json', { eager: true, import: 'default' });

function frames(name: string): Atlas['frames'] {
  return ATLASES[`../../public/assets/rendered/mg/${name}.json`]?.frames ?? {};
}

const range = (prefix: string, n: number, pad = 0): string[] => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(pad, '0')}`);

const NEEDS: Record<string, string[]> = {
  pirates_snatch: ['table', 'cook_idle', 'cook_shout', 'cook_happy', 'pin', ...range('gull_', 3), ...FRUITS, 'meat', 'roast'],
  pirates_slash: [...range('barrel_', 8), ...range('gold_', 8), ...range('crate_', 4), ...range('fish_', 2), 'bomb'],
  pirates_storm: [...range('boat_', 16, 2), 'pouch', 'chest', 'goldchest', 'vane', 'whirl'],
};

describe('Pirate Cove sprite atlases', () => {
  it.each(Object.keys(NEEDS))('%s has every frame its minigame draws', (name) => {
    const have = frames(name);
    expect(Object.keys(have).length, `${name}.json is missing`).toBeGreaterThan(0);
    for (const f of NEEDS[name]) expect(have[f], `${name}: ${f}`).toBeDefined();
  });

  it.each(Object.keys(NEEDS))('%s frames fit inside their canvas', (name) => {
    for (const [key, f] of Object.entries(frames(name))) {
      expect(f.frame.w, key).toBeLessThanOrEqual(f.sourceSize.w);
      expect(f.frame.h, key).toBeLessThanOrEqual(f.sourceSize.h);
    }
  });
});
