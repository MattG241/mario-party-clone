import { describe, expect, it } from 'vitest';
import { ITEM_IDS, ITEMS, SHOPS } from '../../src/game/data/items';
import { ItemManager } from '../../src/game/items/ItemManager';
import { Random } from '../../src/game/util/Random';

describe('item inventory', () => {
  it('holds at most three items', () => {
    const p = { items: [] as (typeof ITEM_IDS)[number][] };
    expect(ItemManager.add(p, 'wingstep_boots')).toBe(true);
    expect(ItemManager.add(p, 'snare_seed')).toBe(true);
    expect(ItemManager.add(p, 'spring_bean')).toBe(true);
    expect(ItemManager.isFull(p)).toBe(true);
    expect(ItemManager.add(p, 'prism_key')).toBe(false);
    expect(p.items).toHaveLength(3);
  });

  it('removes and swaps items', () => {
    const p = { items: ['wingstep_boots', 'snare_seed'] as (typeof ITEM_IDS)[number][] };
    expect(ItemManager.remove(p, 'snare_seed')).toBe(true);
    expect(ItemManager.remove(p, 'snare_seed')).toBe(false);
    expect(ItemManager.swap(p, 'wingstep_boots', 'warp_charm')).toBe(true);
    expect(p.items).toEqual(['warp_charm']);
  });

  it('lists only usable pre-roll items', () => {
    const p = { items: ['prism_key', 'spring_bean', 'bubble_shield', 'wingstep_boots', 'wingstep_boots'] as (typeof ITEM_IDS)[number][], shielded: false };
    expect(ItemManager.usablePreRoll(p, { hasRivals: true, canWarp: true })).toEqual(['bubble_shield', 'wingstep_boots']);
    expect(ItemManager.usablePreRoll({ ...p, shielded: true }, { hasRivals: true, canWarp: true })).toEqual(['wingstep_boots']);
  });

  it('never rolls another capsule from a capsule', () => {
    const r = new Random(4);
    for (let i = 0; i < 200; i++) expect(ItemManager.randomItem(r)).not.toBe('mystery_capsule');
  });

  it('defines all eight items with prices and shops stocking them', () => {
    expect(ITEM_IDS).toHaveLength(8);
    for (const id of ITEM_IDS) expect(ITEMS[id].price).toBeGreaterThan(0);
    const stocked = new Set([...SHOPS.wrench.stock, ...SHOPS.pipper.stock]);
    for (const id of ITEM_IDS) expect(stocked.has(id), id).toBe(true);
  });

  it('picks the least valuable item to discard', () => {
    expect(ItemManager.leastValuable(['warp_charm', 'spring_bean', 'magnet_glove'])).toBe('spring_bean');
  });
});
