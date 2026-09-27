import { DEFAULT_KEY_BINDINGS, type KeyAction } from './buttons';
import { InputDevice } from './Controls';

/**
 * The keyboard as a controller. Keys are tracked from DOM events, but buttons are sampled once
 * per frame like a gamepad; a key tapped and released between two frames still registers as a
 * press for one frame.
 */
export class KeyboardDevice extends InputDevice {
  readonly kind = 'keyboard' as const;
  readonly label = 'Keyboard';
  bindings: Record<KeyAction, string[]> = DEFAULT_KEY_BINDINGS;

  private down = new Set<string>();
  private tapped = new Set<string>();
  private capture: ((code: string) => void) | null = null;
  private boundCodes = new Set<string>();
  private attached = false;
  /** Extra listeners (debug keys etc.) get raw key-downs. */
  private rawListeners = new Set<(e: KeyboardEvent) => void>();

  setBindings(b: Record<KeyAction, string[]>): void {
    this.bindings = b;
    this.boundCodes = new Set(Object.values(b).flat());
  }

  attach(target: Pick<Window, 'addEventListener'>): void {
    if (this.attached) return;
    this.attached = true;
    this.boundCodes = new Set(Object.values(this.bindings).flat());
    target.addEventListener('keydown', (e) => {
      for (const l of this.rawListeners) l(e);
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(e.code);
        return;
      }
      if (!e.repeat) {
        this.down.add(e.code);
        this.tapped.add(e.code);
      }
      if (this.boundCodes.has(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      if (this.boundCodes.has(e.code)) e.preventDefault();
    });
    target.addEventListener('blur', () => this.down.clear());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.down.clear();
      });
    }
  }

  onRawKey(listener: (e: KeyboardEvent) => void): () => void {
    this.rawListeners.add(listener);
    return () => this.rawListeners.delete(listener);
  }

  /** Next key press is delivered to `cb` instead of the game (used for rebinding). */
  captureNextKey(cb: (code: string) => void): void {
    this.capture = cb;
  }

  cancelCapture(): void {
    this.capture = null;
  }

  get capturing(): boolean {
    return this.capture !== null;
  }

  private on(action: KeyAction): boolean {
    for (const code of this.bindings[action] ?? []) {
      if (this.down.has(code) || this.tapped.has(code)) return true;
    }
    return false;
  }

  update(dtMs: number, now: number): void {
    this.beginFrame();
    const c = this.cur;
    c.A = this.on('A');
    c.B = this.on('B');
    c.X = this.on('X');
    c.Y = this.on('Y');
    c.LB = this.on('LB');
    c.RB = this.on('RB');
    c.LT = this.on('LT');
    c.RT = this.on('RT');
    c.MENU = this.on('MENU');
    c.VIEW = this.on('VIEW');
    c.UP = this.on('up');
    c.DOWN = this.on('down');
    c.LEFT = this.on('left');
    c.RIGHT = this.on('right');
    this.lt = c.LT ? 1 : 0;
    this.rt = c.RT ? 1 : 0;
    const dx = (c.RIGHT ? 1 : 0) - (c.LEFT ? 1 : 0);
    const dy = (c.DOWN ? 1 : 0) - (c.UP ? 1 : 0);
    const m = Math.hypot(dx, dy) || 1;
    this.moveX = dx / m;
    this.moveY = dy / m;
    const ax = (this.on('aimRight') ? 1 : 0) - (this.on('aimLeft') ? 1 : 0);
    const ay = (this.on('aimDown') ? 1 : 0) - (this.on('aimUp') ? 1 : 0);
    const am = Math.hypot(ax, ay) || 1;
    this.aimX = ax / am;
    this.aimY = ay / am;
    this.tapped.clear();
    this.finishFrame(dtMs, now);
  }

  rumble(): void {
    // Keyboards don't vibrate.
  }
}
