import { BUTTONS } from './buttons';
import { applyRadialDeadzone, InputDevice } from './Controls';
import { identifyPad, readGeneric, readMapped, readStandard, TRIGGER_PRESS, type LogicalFrame, type PadFamily, type PadIdentity, type PadMapping } from './padProfiles';

export const DEFAULT_DEADZONE = 0.18;
export { TRIGGER_PRESS };

/** Controller preferences shared by every pad (set through InputManager.configure). */
export const padConfig = {
  /** Recorded layouts from the Button Setup screen, keyed by Gamepad.id. */
  mappings: {} as Record<string, PadMapping>,
  /** Nintendo controllers: the button labelled A confirms (true) or the bottom one does (false). */
  nintendoByLabel: true,
};

export interface RawButton {
  pressed: boolean;
  value: number;
}

/** How a controller's raw buttons/axes are interpreted. */
export type PadLayout = 'standard' | 'xinput-axes' | 'generic' | 'custom';

/**
 * One physical gamepad, polled from navigator.getGamepads() every frame.
 *
 * Most controllers arrive with the W3C "standard" mapping (Xbox, PlayStation, Switch Pro, 8BitDo…
 * in Chrome, Edge and Safari). Linux's raw xpad layout (triggers and D-pad on axes) is detected
 * and translated; any other layout gets a best guess (with hat-switch D-pads) until the player
 * records it on the Button Setup screen (see padProfiles.ts).
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
  /** Axes seen resting outside [-1, 1]: hat-switch D-pads on non-standard pads. */
  private hatAxes = new Set<number>();
  /** Axis values when the pad first appeared (where a non-standard pad's axes rest). */
  private axisRest: number[] | null = null;
  private ident: PadIdentity = identifyPad('');

  constructor(readonly index: number) {
    super();
  }

  get label(): string {
    return `Controller ${this.index + 1}`;
  }

  /** Xbox, PlayStation, Nintendo or generic (drives prompt glyphs and the Nintendo layout). */
  get family(): PadFamily {
    return this.ident.family;
  }

  /** Logical buttons held right now, as a comparable signature (spotting a mirrored device). */
  heldSignature(): string {
    return BUTTONS.filter((b) => this.cur[b]).join(',');
  }

  /** True when the pad needs (or has) a recorded layout: its browser mapping isn't standard. */
  get nonStandard(): boolean {
    return this.layout === 'generic' || this.layout === 'custom';
  }

  /** Short, readable controller name. */
  get shortName(): string {
    if (this.family === 'xbox') return 'Xbox Controller';
    if (this.family === 'playstation') return 'PlayStation Controller';
    if (this.family === 'nintendo') return this.ident.name.toLowerCase().includes('joy-con') ? 'Joy-Con' : 'Switch Controller';
    return this.ident.name.slice(0, 28);
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
    if (gp.id !== this.id) {
      this.ident = identifyPad(gp.id);
      this.hatAxes.clear();
      this.axisRest = Array.from(gp.axes);
    }
    this.id = gp.id;
    this.mapping = gp.mapping;
    this.timestamp = gp.timestamp;
    this.rawAxes = Array.from(gp.axes);
    this.rawButtons = Array.from(gp.buttons, (b) => ({ pressed: b.pressed, value: b.value }));
    const raw = { axes: this.rawAxes, buttons: this.rawButtons };
    const swap = this.family === 'nintendo' && padConfig.nintendoByLabel;
    const custom = padConfig.mappings[gp.id];
    let f: LogicalFrame;
    if (custom) {
      this.layout = 'custom';
      f = readMapped(raw, custom);
    } else if (gp.mapping === 'standard') {
      this.layout = 'standard';
      f = readStandard(raw, swap);
    } else if (this.family === 'xbox' && gp.axes.length >= 6 && gp.buttons.length <= 15) {
      this.layout = 'xinput-axes';
      f = this.readXinputAxes(gp);
    } else {
      this.layout = 'generic';
      f = readGeneric(raw, this.hatAxes, swap, this.axisRest ?? undefined);
    }
    const c = this.cur;
    for (const b of BUTTONS) c[b] = f.buttons[b];
    this.lt = f.lt;
    this.rt = f.rt;
    const { lx, ly, rx, ry } = f;

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

  /** Linux xpad (Xbox pads without the standard mapping): triggers and D-pad on axes. */
  private readXinputAxes(gp: Gamepad): LogicalFrame {
    const btn = (i: number): boolean => {
      const b = gp.buttons[i];
      return !!b && (b.pressed || b.value > 0.5);
    };
    const ax = (i: number): number => gp.axes[i] ?? 0;
    // Trigger axes rest at -1 once touched but often report 0 before first use.
    const lt = this.triggerFromAxis(0, ax(2));
    const rt = this.triggerFromAxis(1, ax(5));
    const hatX = gp.axes.length >= 8 ? ax(6) : 0;
    const hatY = gp.axes.length >= 8 ? ax(7) : 0;
    return {
      buttons: {
        A: btn(0),
        B: btn(1),
        X: btn(2),
        Y: btn(3),
        LB: btn(4),
        RB: btn(5),
        LT: lt > TRIGGER_PRESS,
        RT: rt > TRIGGER_PRESS,
        VIEW: btn(6),
        MENU: btn(7),
        LS: btn(9),
        RS: btn(10),
        UP: hatY < -0.5 || btn(12),
        DOWN: hatY > 0.5 || btn(13),
        LEFT: hatX < -0.5 || btn(14),
        RIGHT: hatX > 0.5 || btn(15),
      },
      lx: ax(0),
      ly: ax(1),
      rx: ax(3),
      ry: ax(4),
      lt,
      rt,
    };
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
