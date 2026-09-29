// Gleamtrail items. Icons come from the supplied item sheet where it has art; the other three
// use placeholder SVGs (public/assets/placeholders/items/).

export type ItemId = 'prism_key' | 'mystery_capsule' | 'wingstep_boots' | 'bubble_shield' | 'snare_seed' | 'warp_charm' | 'magnet_glove' | 'spring_bean';

export const ITEM_IDS: readonly ItemId[] = ['prism_key', 'mystery_capsule', 'wingstep_boots', 'bubble_shield', 'snare_seed', 'warp_charm', 'magnet_glove', 'spring_bean'];

/** When an item can be used. */
export type ItemTiming = 'preRoll' | 'postRoll' | 'passive';

export interface ItemIcon {
  texture: string;
  frame?: string;
  /** Scale so the icon fits a ~100 px slot. */
  scale: number;
  anim?: string;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  price: number;
  timing: ItemTiming;
  icon: ItemIcon;
  /** Relative value used by CPUs when deciding what to buy or discard. */
  value: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  prism_key: {
    id: 'prism_key',
    name: 'Prism Key',
    description: 'Unlocks a Prism Gate shortcut. Used automatically when you pass one.',
    price: 8,
    timing: 'passive',
    icon: { texture: 'items', frame: '6', scale: 0.46, anim: 'key-spin' },
    value: 6,
  },
  mystery_capsule: {
    id: 'mystery_capsule',
    name: 'Mystery Capsule',
    description: 'Pop it open for a random item.',
    price: 5,
    timing: 'preRoll',
    icon: { texture: 'items', frame: '12', scale: 0.46, anim: 'capsule-idle' },
    value: 4,
  },
  wingstep_boots: {
    id: 'wingstep_boots',
    name: 'Wingstep Boots',
    description: 'Adds +3 to your next Orbit Dial spin.',
    price: 6,
    timing: 'preRoll',
    icon: { texture: 'items', frame: '18', scale: 0.46, anim: 'boots-idle' },
    value: 6,
  },
  bubble_shield: {
    id: 'bubble_shield',
    name: 'Bubble Shield',
    description: 'Surrounds you with a bubble that blocks the next mishap.',
    price: 7,
    timing: 'preRoll',
    icon: { texture: 'items', frame: '24', scale: 0.44, anim: 'bubble-idle' },
    value: 5,
  },
  snare_seed: {
    id: 'snare_seed',
    name: 'Snare Seed',
    description: 'Plants a trap on your space. The next rival to land there pays you 5 coins.',
    price: 5,
    timing: 'preRoll',
    icon: { texture: 'items', frame: '30', scale: 0.46, anim: 'seed-idle' },
    value: 4,
  },
  warp_charm: {
    id: 'warp_charm',
    name: 'Warp Charm',
    description: 'Warp to a rival or to any portal before you spin.',
    price: 10,
    timing: 'preRoll',
    icon: { texture: 'item-warp-charm', scale: 0.62 },
    value: 7,
  },
  magnet_glove: {
    id: 'magnet_glove',
    name: 'Magnet Glove',
    description: 'Pulls up to 5 coins from a rival of your choice.',
    price: 8,
    timing: 'preRoll',
    icon: { texture: 'item-magnet-glove', scale: 0.62 },
    value: 6,
  },
  spring_bean: {
    id: 'spring_bean',
    name: 'Spring Bean',
    description: 'Lets you re-spin the Orbit Dial once after seeing the result.',
    price: 4,
    timing: 'postRoll',
    icon: { texture: 'item-spring-bean', scale: 0.62 },
    value: 3,
  },
};

export type ShopId = 'wrench' | 'pipper';

export interface ShopDef {
  id: ShopId;
  npc: 'wrench' | 'pipper';
  name: string;
  stock: ItemId[];
  /** Extra item offered during the final round. */
  finalRoundExtra: ItemId;
}

export const SHOPS: Record<ShopId, ShopDef> = {
  wrench: {
    id: 'wrench',
    npc: 'wrench',
    name: "Wrench's Workshop",
    stock: ['wingstep_boots', 'magnet_glove', 'prism_key', 'spring_bean'],
    finalRoundExtra: 'warp_charm',
  },
  pipper: {
    id: 'pipper',
    npc: 'pipper',
    name: "Pipper's Curios",
    stock: ['mystery_capsule', 'bubble_shield', 'snare_seed', 'warp_charm'],
    finalRoundExtra: 'prism_key',
  },
};
