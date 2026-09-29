// Pure rules behind Capitol Gardens' board events (kept apart from the presentation so they can be
// unit tested): the fountain wish and the garden party's shared picnic pot.

/** Coins tossed into the fountain to make a wish. */
export const WISH_COST = 2;

export type WishOutcome = 'shower' | 'item' | 'bargain' | 'splash';

/** What the fountain grants for a roll in [0, 1): a coin shower (40%), an item (25%), a Star Coin bargain (20%) or a cheeky splash (15%). */
export function wishOutcome(roll: number): WishOutcome {
  if (roll < 0.4) return 'shower';
  if (roll < 0.65) return 'item';
  if (roll < 0.85) return 'bargain';
  return 'splash';
}

/**
 * The garden party: everyone brings a third of their coins (rounded down) to the picnic and the pot is
 * shared out evenly; whatever doesn't split evenly stays with the host (index `host`). `deltas` is each
 * player's change, and the changes add up to zero.
 */
export function partyShares(chips: readonly number[], host: number): { pot: number; share: number; deltas: number[] } {
  const brought = chips.map((c) => Math.floor(Math.max(0, c) / 3));
  const pot = brought.reduce((a, b) => a + b, 0);
  const share = Math.floor(pot / Math.max(1, chips.length));
  const rest = pot - share * chips.length;
  const keeper = host >= 0 && host < chips.length ? host : 0;
  return { pot, share, deltas: brought.map((b, i) => share - b + (i === keeper ? rest : 0)) };
}
