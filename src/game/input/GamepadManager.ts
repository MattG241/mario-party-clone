import { applyRadialDeadzone, InputDevice } from './Controls';

export const DEFAULT_DEADZONE = 0.18;
export const TRIGGER_PRESS = 0.35;

export interface RawButton {
  pressed: boolean;
  value: number;
}

/** How a controller's raw buttons/axes are interpreted. */
export type PadLayout = 'standard' | 'xinput-axes' | 'unknown';

/**
 * One physical gamepad, polled from navigator.getGamepads() every frame.
 *
 * Browsers report Xbox controllers with the W3C "standard" mapping on Windows/macOS (Chrome,
 * Edge, Firefox, Safari). Some Linux setups expose the raw xpad layout instead (triggers and
 * D-pad on axes); that layout is detected and translated. The diagnostics screen shows the raw
 * values so any other layout can be troubleshot.
 */
export class GamepadDevice extends InputDevice {
  readonly kind = 'gamepad' as const;
  id = '';
  mapping = '';
  layout: PadLayout = 'standard';
  connected = true;
  timestamp = 0;
  rawAxes: number[] = [];
  rawButtons: RawButton[] = [];
  /** Un-dead-zoned stick values, for diagnostics. */
  rawLeft: [number, number] = [0, 0];
  rawRight: [number, number] = [0, 0];
  deadzone = DEFAULT_DEADZONE;
  vibrationEnabled = true;
  private triggerAxisSeen = [false, false];

  constructor(readonly index: number) {
    super();
  }

  get label(): string {
    return `Controller ${this.index + 1}`;
  }

  /** Short, readable controller name. */
  get shortName(): string {
    const id = this.id.toLowerCase();
    if (id.includes('xbox') || id.includes('xinput') || id.includes('045e')) return 'Xbox Controller';
    if (id.includes('dualsense') || id.includes('dualshock') || id.includes('054c')) return 'PlayStation Controller';
    if (id.includes('pro controller') || id.includes('057e')) return 'Switch Controller';
    const cleaned = this.id.replace(/\(.*?\)/g, '').trim();
    return cleaned.length > 0 ? cleaned.slice(0, 28) : 'Gamepad';
  }

  get supportsVibration(): boolean {
    const gp = this.pad();
    if (!gp) return false;
    const g = gp as Gamepad & { vibrationActuator?: unknown; hapticActuators?: unknown[] };
    return !!g.vibrationActuator || (Array.isArray(g.hapticActuators) && g.hapticActuators.length > 0);
  }

  private pad(): Gamepad | null {
    try {
      return navigator.getGamepads?.()[this.index] ?? null;
    } catch {
      return null;
    }
  }

  update(gp: Gamepad, dtMs: number, now: number): void {
    this.beginFrame();
    this.id = gp.id;
    this.mapping = gp.mapping;
    this.timestamp = gp.timestamp;
    this.rawAxes = Array.from(gp.axes);
    this.rawButtons = Array.from(gp.buttons, (b) => ({ pressed: b.pressed, value: b.value }));
    const btn = (i: number): boolean => {
      const b = gp.buttons[i];
      return !!b && (b.pressed || b.value > 0.5);
    };
    const val = (i: number): number => gp.buttons[i]?.value ?? 0;
    const ax = (i: number): number => gp.axes[i] ?? 0;

    this.layout = gp.mapping === 'standard' ? 'standard' : gp.axes.length >= 6 && gp.buttons.length <= 15 ? 'xinput-axes' : 'unknown';

    let lx = 0;
    let ly = 0;
    let rx = 0;
    let ry = 0;
    const c = this.cur;
    if (this.layout === 'xinput-axes') {
      c.A = btn(0);
      c.B = btn(1);
      c.X = btn(2);
      c.Y = btn(3);
      c.LB = btn(4);
      c.RB = btn(5);
      c.VIEW = btn(6);
      c.MENU = btn(7);
      c.LS = btn(9);
      c.RS = btn(10);
      lx = ax(0);
      ly = ax(1);
      rx = ax(3);
      ry = ax(4);
      // Trigger axes rest at -1 once touched but often report 0 before first use.
      this.lt = this.triggerFromAxis(0, ax(2));
      this.rt = this.triggerFromAxis(1, ax(5));
      if (gp.axes.length >= 8) {
        c.LEFT = ax(6) < -0.5;
        c.RIGHT = ax(6) > 0.5;
        c.UP = ax(7) < -0.5;
        c.DOWN = ax(7) > 0.5;
      }
      c.UP ||= btn(12);
      c.DOWN ||= btn(13);
      c.LEFT ||= btn(14);
      c.RIGHT ||= btn(15);
    } else {
      c.A = btn(0);
      c.B = btn(1);
      c.X = btn(2);
      c.Y = btn(3);
      c.LB = btn(4);
      c.RB = btn(5);
      this.lt = val(6);
      this.rt = val(7);
      c.VIEW = btn(8);
      c.MENU = btn(9);
      c.LS = btn(10);
      c.RS = btn(11);
      c.UP = btn(12);
      c.DOWN = btn(13);
      c.LEFT = btn(14);
      c.RIGHT = btn(15);
      lx = ax(0);
      ly = ax(1);
      rx = ax(2);
      ry = ax(3);
    }
    c.LT = this.lt > TRIGGER_PRESS;
    c.RT = this.rt > TRIGGER_PRESS;

    this.rawLeft = [lx, ly];
    this.rawRight = [rx, ry];
    [this.moveX, this.moveY] = applyRadialDeadzone(lx, ly, this.deadzone);
    [this.aimX, this.aimY] = applyRadialDeadzone(rx, ry, this.deadzone);
    // The D-pad also moves characters when the stick is centred.
    if (this.moveX === 0 && this.moveY === 0) {
      const dx = (c.RIGHT ? 1 : 0) - (c.LEFT ? 1 : 0);
      const dy = (c.DOWN ? 1 : 0) - (c.UP ? 1 : 0);
      const m = Math.hypot(dx, dy) || 1;
      this.moveX = dx / m;
      this.moveY = dy / m;
    }
    this.finishFrame(dtMs, now);
  }

  private triggerFromAxis(i: 0 | 1, v: number): number {
    if (!this.triggerAxisSeen[i]) {
      if (v === 0) return 0;
      this.triggerAxisSeen[i] = true;
    }
    return Math.min(1, Math.max(0, (v + 1) / 2));
  }

  rumble(strong: number, weak: number, ms: number): void {
    if (!this.vibrationEnabled || ms <= 0) return;
    const gp = this.pad() as
      | (Gamepad & {
          vibrationActuator?: { playEffect?: (type: string, params: Record<string, number>) => Promise<unknown> };
          hapticActuators?: { pulse?: (value: number, duration: number) => Promise<unknown> }[];
        })
      | null;
    if (!gp) return;
    try {
      const act = gp.vibrationActuator;
      if (act?.playEffect) {
        act
          .playEffect('dual-rumble', {
            startDelay: 0,
            duration: ms,
            strongMagnitude: Math.min(1, Math.max(0, strong)),
            weakMagnitude: Math.min(1, Math.max(0, weak)),
          })
          .catch(() => undefined);
        return;
      }
      gp.hapticActuators?.[0]?.pulse?.(Math.max(strong, weak), ms)?.catch(() => undefined);
    } catch {
      // Vibration is optional; never let it break gameplay.
    }
  }
}
