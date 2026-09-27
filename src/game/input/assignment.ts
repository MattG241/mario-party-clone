import type { DeviceRef } from './InputManager';

/**
 * Which player slot a newly joining device takes: controller N prefers player N (so Controller 1
 * is Player 1, …); otherwise — or for the keyboard — the first free slot. Returns -1 when full.
 */
export function slotForDevice(ref: DeviceRef, slotFree: readonly boolean[]): number {
  if (ref.kind === 'gamepad' && ref.index < slotFree.length && slotFree[ref.index]) return ref.index;
  return slotFree.findIndex((free) => free);
}
