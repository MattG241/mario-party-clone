import { BUTTONS, type Button, type NavDir } from './buttons';

/**
 * A virtual controller. Gamepads, the keyboard and CPU brains all implement this, so gameplay
 * code never needs to know who is holding the controller.
 */
export interface Controls {
  readonly kind: 'gamepad' | 'keyboard' | 'cpu' | 'none';
  readonly label: string;
  /** Went down this frame. */
  pressed(b: Button): boolean;
  /** Went up this frame. */
  released(b: Button): boolean;
  /** Currently down. */
  held(b: Button): boolean;
  /** Left stick (plus D-pad / movement keys), dead-zoned, each axis in [-1, 1]. */
  readonly moveX: number;
  readonly moveY: number;
  /** Right stick (or aim keys), dead-zoned. */
  readonly aimX: number;
  readonly aimY: number;
  /** Analogue triggers in [0, 1]. */
  readonly lt: number;
  readonly rt: number;
  /** Menu navigation with controlled repeat: immediate, then 300 ms, then every ~115 ms. */
  nav(): NavDir | null;
  /** Controller vibration (ignored when unsupported or disabled in settings). */
  rumble(strong: number, weak: number, ms: number): void;
}

export const MENU_REPEAT_DELAY = 300;
export const MENU_REPEAT_INTERVAL = 115;
/** Stick must pass this to start a menu move… */
export const NAV_ENGAGE = 0.55;
/** …and fall below this to count as released (hysteresis stops drift from re-triggering). */
export const NAV_RELEASE = 0.35;

export function emptyButtons(): Record<Button, boolean> {
  const r = {} as Record<Button, boolean>;
  for (const b of BUTTONS) r[b] = false;
  return r;
}

/** Radial dead zone with rescaling so the usable range still reaches 1.0. */
export function applyRadialDeadzone(x: number, y: number, deadzone: number): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag < deadzone || mag === 0) return [0, 0];
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  return [(x / mag) * scaled, (y / mag) * scaled];
}

/**
 * Menu repeat: a new direction fires immediately; holding it fires again after
 * MENU_REPEAT_DELAY, then every MENU_REPEAT_INTERVAL. Changing direction restarts the cycle.
 */
export class NavRepeater {
  private dir: NavDir | null = null;
  private heldFor = 0;
  private nextAt = 0;

  update(dir: NavDir | null, dtMs: number): NavDir | null {
    if (dir !== this.dir) {
      this.dir = dir;
      this.heldFor = 0;
      this.nextAt = MENU_REPEAT_DELAY;
      return dir;
    }
    if (!dir) return null;
    this.heldFor += dtMs;
    if (this.heldFor >= this.nextAt) {
      this.nextAt += MENU_REPEAT_INTERVAL;
      return dir;
    }
    return null;
  }

  reset(): void {
    this.dir = null;
    this.heldFor = 0;
    this.nextAt = 0;
  }
}

/** Pick a menu direction from a stick with hysteresis around the previous direction. */
export function stickToNav(x: number, y: number, prev: NavDir | null): NavDir | null {
  if (prev) {
    const v = prev === 'left' ? -x : prev === 'right' ? x : prev === 'up' ? -y : y;
    if (v > NAV_RELEASE) return prev;
  }
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (Math.max(ax, ay) < NAV_ENGAGE) return null;
  if (ax > ay) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

/** Shared state machine for physical devices (gamepad / keyboard). */
export abstract class InputDevice implements Controls {
  abstract readonly kind: 'gamepad' | 'keyboard';
  abstract readonly label: string;

  cur = emptyButtons();
  prev = emptyButtons();
  moveX = 0;
  moveY = 0;
  aimX = 0;
  aimY = 0;
  lt = 0;
  rt = 0;
  /** Timestamp (ms) of the last meaningful input, used to pick prompt glyphs. */
  lastActivity = 0;

  private repeater = new NavRepeater();
  private stickNav: NavDir | null = null;
  private navFrame: NavDir | null = null;
  private locked = new Set<Button>();
  private navLocked = false;

  pressed(b: Button): boolean {
    return this.cur[b] && !this.prev[b] && !this.locked.has(b);
  }

  released(b: Button): boolean {
    return !this.cur[b] && this.prev[b];
  }

  held(b: Button): boolean {
    return this.cur[b] && !this.locked.has(b);
  }

  nav(): NavDir | null {
    return this.navFrame;
  }

  abstract rumble(strong: number, weak: number, ms: number): void;

  /** Ignore everything currently held until it is released (used on screen changes). */
  lockHeld(): void {
    for (const b of BUTTONS) if (this.cur[b]) this.locked.add(b);
    this.navLocked = true;
    this.repeater.reset();
  }

  /** Subclasses fill cur/axes, then call this once per frame. */
  protected finishFrame(dtMs: number, now: number): void {
    for (const b of this.locked) if (!this.cur[b]) this.locked.delete(b);
    let dir: NavDir | null = null;
    if (this.cur.UP) dir = 'up';
    else if (this.cur.DOWN) dir = 'down';
    else if (this.cur.LEFT) dir = 'left';
    else if (this.cur.RIGHT) dir = 'right';
    this.stickNav = stickToNav(this.moveX, this.moveY, this.stickNav);
    if (!dir) dir = this.stickNav;
    if (this.navLocked) {
      if (dir) {
        this.navFrame = null;
        return this.trackActivity(now);
      }
      this.navLocked = false;
    }
    this.navFrame = this.repeater.update(dir, dtMs);
    this.trackActivity(now);
  }

  private trackActivity(now: number): void {
    for (const b of BUTTONS) {
      if (this.cur[b] && !this.prev[b]) {
        this.lastActivity = now;
        return;
      }
    }
    if (Math.abs(this.moveX) > 0.5 || Math.abs(this.moveY) > 0.5) this.lastActivity = now;
  }

  /** Move current → previous before sampling a new frame. */
  protected beginFrame(): void {
    const p = this.prev;
    this.prev = this.cur;
    this.cur = p;
    for (const b of BUTTONS) this.cur[b] = false;
  }
}

/** Controls that do nothing (unassigned slots). */
export const NO_CONTROLS: Controls = {
  kind: 'none',
  label: 'None',
  pressed: () => false,
  released: () => false,
  held: () => false,
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  lt: 0,
  rt: 0,
  nav: () => null,
  rumble: () => undefined,
};
