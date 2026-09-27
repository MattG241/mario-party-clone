import { ECONOMY } from '../constants';
import { ITEM_IDS, ITEMS, type ItemId } from '../data/items';
import type { PlayerState } from '../state/MatchState';
import type { Random } from '../util/Random';

/** Pure inventory rules (max three items per player). */
export const ItemManager = {
  max: ECONOMY.maxItems,

  has(p: Pick<PlayerState, 'items'>, id: ItemId): boolean {
    return p.items.includes(id);
  },

  isFull(p: Pick<PlayerState, 'items'>): boolean {
    return p.items.length >= ECONOMY.maxItems;
  },

  /** Add if there's room. Returns false when the bag is full (caller must ask what to drop). */
  add(p: Pick<PlayerState, 'items'>, id: ItemId): boolean {
    if (p.items.length >= ECONOMY.maxItems) return false;
    p.items.push(id);
    return true;
  },

  /** Remove one copy; returns whether it was present. */
  remove(p: Pick<PlayerState, 'items'>, id: ItemId): boolean {
    const i = p.items.indexOf(id);
    if (i < 0) return false;
    p.items.splice(i, 1);
    return true;
  },

  /** Replace `drop` with `incoming` (used when the bag is full). */
  swap(p: Pick<PlayerState, 'items'>, drop: ItemId, incoming: ItemId): boolean {
    const i = p.items.indexOf(drop);
    if (i < 0) return false;
    p.items[i] = incoming;
    return true;
  },

  /** Items that can be used before spinning this turn. */
  usablePreRoll(p: Pick<PlayerState, 'items' | 'shielded'>, opts: { hasRivals: boolean; canWarp: boolean }): ItemId[] {
    const seen = new Set<ItemId>();
    const out: ItemId[] = [];
    for (const id of p.items) {
      if (seen.has(id)) continue;
      seen.add(id);
      const def = ITEMS[id];
      if (def.timing !== 'preRoll') continue;
      if (id === 'bubble_shield' && p.shielded) continue;
      if (id === 'magnet_glove' && !opts.hasRivals) continue;
      if (id === 'warp_charm' && !opts.canWarp) continue;
      out.push(id);
    }
    return out;
  },

  /** Random item for capsules and deliveries (never another capsule). */
  randomItem(rng: Random, exclude: ItemId[] = ['mystery_capsule']): ItemId {
    const pool = ITEM_IDS.filter((i) => !exclude.includes(i));
    return rng.pick(pool);
  },

  /** Lowest-value item in a set (for CPU discards). */
  leastValuable(items: readonly ItemId[]): ItemId {
    return items.slice().sort((a, b) => ITEMS[a].value - ITEMS[b].value)[0];
  },
};
