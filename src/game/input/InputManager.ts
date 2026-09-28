import type { Button, NavDir } from './buttons';
import { NO_CONTROLS, type Controls, type InputDevice } from './Controls';
import { DEFAULT_DEADZONE, GamepadDevice, padConfig } from './GamepadManager';
import type { PadFamily, PadMapping } from './padProfiles';
import { KeyboardDevice } from './KeyboardManager';
import { SlotControls, type SlotResolver } from './PlayerInput';

/** Frames of play two controllers must match exactly before one counts as a copy of the other (about a fifth of a second). */
const MIRROR_FRAMES = 12;

export type DeviceRef = { kind: 'gamepad'; index: number } | { kind: 'keyboard' };

export function sameDevice(a: DeviceRef | null, b: DeviceRef | null): boolean {
  if (!a || !b) return false;
  if (a.kind === 'keyboard' || b.kind === 'keyboard') return a.kind === b.kind;
  return a.index === b.index;
}

export function deviceLabel(ref: DeviceRef | null): string {
  if (!ref) return 'None';
  return ref.kind === 'keyboard' ? 'Keyboard' : `Controller ${ref.index + 1}`;
}

type InputEvent =
  | { type: 'connected'; index: number; name: string }
  | { type: 'disconnected'; index: number; slot: number | null };

/**
 * Owns every input device. Polls the Gamepad API once per frame (called from the game's
 * pre-step hook, before any scene updates), keeps previous/current states for press / hold /
 * release detection, and maps devices to player slots.
 */
export class InputManager implements SlotResolver {
  readonly keyboard = new KeyboardDevice();
  /** Active frames in a row each pair of controllers has matched exactly ("a:b", a < b). */
  private mirrorRun = new Map<string, number>();
  readonly pads = new Map<number, GamepadDevice>();
  /** Device assigned to each player slot (null = unassigned or CPU). */
  readonly slots: (DeviceRef | null)[] = [null, null, null, null];
  readonly any: AnyControls;
  private slotControls: SlotControls[];
  private listeners = new Set<(e: InputEvent) => void>();
  private lastUpdate = 0;
  private deadzone = DEFAULT_DEADZONE;
  private vibration = true;
  /** Kind of device that most recently produced input (drives prompt glyphs). */
  lastKind: 'gamepad' | 'keyboard' = 'keyboard';
  /** The gamepad that most recently produced input. */
  private lastPad: GamepadDevice | null = null;

  constructor() {
    this.slotControls = [0, 1, 2, 3].map((i) => new SlotControls(this, i));
    this.any = new AnyControls(this);
  }

  attach(win: Window): void {
    this.keyboard.attach(win);
    // Connection events are advisory; polling in update() is the source of truth.
    win.addEventListener('gamepadconnected', () => this.poll(performance.now(), 0));
    win.addEventListener('gamepaddisconnected', () => this.poll(performance.now(), 0));
  }

  configure(opts: { deadzone?: number; vibration?: boolean; padMappings?: Record<string, PadMapping>; nintendoByLabel?: boolean }): void {
    if (opts.deadzone !== undefined) this.deadzone = opts.deadzone;
    if (opts.vibration !== undefined) this.vibration = opts.vibration;
    if (opts.padMappings !== undefined) padConfig.mappings = opts.padMappings;
    if (opts.nintendoByLabel !== undefined) padConfig.nintendoByLabel = opts.nintendoByLabel;
    for (const p of this.pads.values()) {
      p.deadzone = this.deadzone;
      p.vibrationEnabled = this.vibration;
    }
  }

  on(listener: (e: InputEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: InputEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** Poll all devices. Call exactly once per frame. */
  update(now: number): void {
    const dt = this.lastUpdate ? Math.min(100, now - this.lastUpdate) : 16;
    this.lastUpdate = now;
    this.poll(now, dt);
    this.trackMirrors();
    this.keyboard.update(dt, now);
    const kbAct = this.keyboard.lastActivity;
    let padAct = 0;
    for (const p of this.pads.values()) {
      if (p.lastActivity > padAct) {
        padAct = p.lastActivity;
        this.lastPad = p;
      }
    }
    if (kbAct || padAct) this.lastKind = padAct > kbAct ? 'gamepad' : 'keyboard';
  }

  /** Controller family of a slot's pad, or of the most recently used pad (for prompt glyphs). */
  padFamily(slot?: number): PadFamily {
    const ref = slot !== undefined ? this.slots[slot] : null;
    if (ref && ref.kind === 'gamepad') return this.pads.get(ref.index)?.family ?? 'generic';
    const last = this.lastPad && this.lastPad.connected ? this.lastPad : this.connectedPads()[0];
    return last?.family ?? 'generic';
  }

  private poll(now: number, dt: number): void {
    let list: (Gamepad | null)[] = [];
    try {
      list = Array.from(navigator.getGamepads?.() ?? []);
    } catch {
      list = [];
    }
    const seen = new Set<number>();
    for (const gp of list) {
      if (!gp || !gp.connected) continue;
      seen.add(gp.index);
      let dev = this.pads.get(gp.index);
      if (!dev || !dev.connected) {
        dev = new GamepadDevice(gp.index);
        dev.deadzone = this.deadzone;
        dev.vibrationEnabled = this.vibration;
        this.pads.set(gp.index, dev);
        dev.update(gp, 0, now);
        // Buttons held while connecting shouldn't fire as presses.
        dev.lockHeld();
        this.emit({ type: 'connected', index: gp.index, name: dev.shortName });
      }
      if (dt > 0) dev.update(gp, dt, now);
    }
    for (const [index, dev] of this.pads) {
      if (!seen.has(index) && dev.connected) {
        dev.connected = false;
        this.pads.delete(index);
        this.emit({ type: 'disconnected', index, slot: this.slotOf({ kind: 'gamepad', index }) });
      }
    }
  }

  /** Physical device for a reference (null if disconnected). */
  device(ref: DeviceRef | null): InputDevice | null {
    if (!ref) return null;
    if (ref.kind === 'keyboard') return this.keyboard;
    const p = this.pads.get(ref.index);
    return p && p.connected ? p : null;
  }

  deviceForSlot(slot: number): Controls | null {
    return this.device(this.slots[slot] ?? null);
  }

  /** Controls for a player slot (follows reassignment). */
  controls(slot: number): Controls {
    return this.slotControls[slot] ?? NO_CONTROLS;
  }

  assign(slot: number, ref: DeviceRef | null): void {
    this.slots[slot] = ref;
  }

  slotOf(ref: DeviceRef): number | null {
    const i = this.slots.findIndex((s) => sameDevice(s, ref));
    return i >= 0 ? i : null;
  }

  connectedPads(): GamepadDevice[] {
    return [...this.pads.values()].filter((p) => p.connected).sort((a, b) => a.index - b.index);
  }

  hasGamepad(): boolean {
    return this.connectedPads().length > 0;
  }

  /** All devices that pressed `b` this frame. */
  devicesPressing(b: Button): DeviceRef[] {
    const out: DeviceRef[] = [];
    if (this.keyboard.pressed(b)) out.push({ kind: 'keyboard' });
    for (const p of this.connectedPads()) if (p.pressed(b)) out.push({ kind: 'gamepad', index: p.index });
    return out;
  }

  /**
   * Devices that pressed `b` this frame to join a game, minus echoes of one physical press: some
   * setups show a controller twice (adapters with two interfaces, DS4Windows, Steam) or also type
   * keys (Steam's desktop mode). When a controller pressed, a same-frame key press is dropped, and
   * of several controllers pressing with identical buttons held only the first counts (including
   * against a controller that already has a seat). A second player who really pressed at that
   * very instant just presses again.
   */
  joinPresses(b: Button): DeviceRef[] {
    const pads = this.connectedPads().filter((p) => p.pressed(b));
    if (pads.length === 0) return this.keyboard.pressed(b) ? [{ kind: 'keyboard' }] : [];
    // Every controller joins, except one already caught copying another frame for frame. (Two
    // friends pressing A in the same frame are two players, so a matching press alone proves
    // nothing; a copy is recognised as soon as it has mirrored some real play, see mirrorOf.)
    return pads.filter((p) => this.mirrorOf(p.index) === null).map((p) => ({ kind: 'gamepad' as const, index: p.index }));
  }

  /**
   * Update how long each pair of controllers has mirrored each other exactly (call once a frame,
   * after polling). Any frame where they differ while one of them is in use resets the pair.
   */
  trackMirrors(): void {
    const pads = this.connectedPads();
    const live = new Set<string>();
    for (let i = 0; i < pads.length; i++) {
      for (let j = i + 1; j < pads.length; j++) {
        const a = pads[i];
        const c = pads[j];
        const key = a.index < c.index ? `${a.index}:${c.index}` : `${c.index}:${a.index}`;
        live.add(key);
        const sa = a.stateSignature();
        const sc = c.stateSignature();
        if (!sa && !sc) continue;
        this.mirrorRun.set(key, sa === sc ? Math.min(10000, (this.mirrorRun.get(key) ?? 0) + 1) : 0);
      }
    }
    for (const k of [...this.mirrorRun.keys()]) if (!live.has(k)) this.mirrorRun.delete(k);
  }

  /**
   * The controller this one is a copy of (an adapter, DS4Windows or Steam showing one controller
   * twice), once they have matched frame for frame through MIRROR_FRAMES frames of play. Of the
   * two, the copy is the one without a seat, or the later seat, or the higher index.
   */
  mirrorOf(index: number): number | null {
    for (const [key, run] of this.mirrorRun) {
      if (run < MIRROR_FRAMES) continue;
      const [a, c] = key.split(':').map(Number);
      if (index !== a && index !== c) continue;
      const other = index === a ? c : a;
      const seat = (i: number) => this.slotOf({ kind: 'gamepad', index: i }) ?? 99;
      const mine = seat(index);
      const theirs = seat(other);
      if (mine > theirs || (mine === theirs && index > other)) return other;
    }
    return null;
  }

  allDevices(): InputDevice[] {
    return [this.keyboard, ...this.connectedPads()];
  }

  /** Swallow everything currently held until released (call when a screen opens). */
  lockHeld(): void {
    for (const d of this.allDevices()) d.lockHeld();
  }

  rumbleSlot(slot: number, strong: number, weak: number, ms: number): void {
    this.deviceForSlot(slot)?.rumble(strong, weak, ms);
  }

  rumbleAll(strong: number, weak: number, ms: number): void {
    for (const p of this.connectedPads()) p.rumble(strong, weak, ms);
  }
}

/** "Any device" controls for shared menus (title screen, settings…). */
export class AnyControls implements Controls {
  readonly kind = 'keyboard' as const;
  readonly label = 'Any';
  constructor(private mgr: InputManager) {}

  private devs(): InputDevice[] {
    return this.mgr.allDevices();
  }
  pressed(b: Button): boolean {
    return this.devs().some((d) => d.pressed(b));
  }
  released(b: Button): boolean {
    return this.devs().some((d) => d.released(b));
  }
  held(b: Button): boolean {
    return this.devs().some((d) => d.held(b));
  }
  private strongest(pick: (d: InputDevice) => number): number {
    let best = 0;
    for (const d of this.devs()) {
      const v = pick(d);
      if (Math.abs(v) > Math.abs(best)) best = v;
    }
    return best;
  }
  get moveX() {
    return this.strongest((d) => d.moveX);
  }
  get moveY() {
    return this.strongest((d) => d.moveY);
  }
  get aimX() {
    return this.strongest((d) => d.aimX);
  }
  get aimY() {
    return this.strongest((d) => d.aimY);
  }
  get lt() {
    return this.strongest((d) => d.lt);
  }
  get rt() {
    return this.strongest((d) => d.rt);
  }
  nav(): NavDir | null {
    for (const d of this.devs()) {
      const n = d.nav();
      if (n) return n;
    }
    return null;
  }
  rumble(strong: number, weak: number, ms: number): void {
    this.mgr.rumbleAll(strong, weak, ms);
  }
}

export const input = new InputManager();
