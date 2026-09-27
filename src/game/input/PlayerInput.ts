import { BUTTONS, type Button, type NavDir } from './buttons';
import { emptyButtons, NO_CONTROLS, type Controls } from './Controls';

/**
 * Controls driven by a CPU brain. Brains can only press buttons and push sticks — exactly what a
 * human can do — so CPU players never get abilities humans don't have.
 *
 * Call step() once at the start of every frame, then let the brain set its intent.
 */
export class VirtualControls implements Controls {
  readonly kind = 'cpu' as const;
  readonly label = 'CPU';
  moveX = 0;
  moveY = 0;
  aimX = 0;
  aimY = 0;
  lt = 0;
  rt = 0;
  private cur = emptyButtons();
  private prev = emptyButtons();
  private taps = new Set<Button>();
  private navQueue: NavDir | null = null;
  private navFrame: NavDir | null = null;

  step(): void {
    for (const b of BUTTONS) this.prev[b] = this.cur[b];
    for (const b of this.taps) this.cur[b] = false;
    this.taps.clear();
    this.navFrame = this.navQueue;
    this.navQueue = null;
  }

  setMove(x: number, y: number): void {
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    this.moveX = x;
    this.moveY = y;
  }

  setAim(x: number, y: number): void {
    this.aimX = x;
    this.aimY = y;
  }

  setTriggers(lt: number, rt: number): void {
    this.lt = lt;
    this.rt = rt;
    this.cur.LT = lt > 0.35;
    this.cur.RT = rt > 0.35;
  }

  hold(b: Button, on = true): void {
    this.cur[b] = on;
  }

  /** Press for exactly one frame. */
  tap(b: Button): void {
    this.cur[b] = true;
    this.taps.add(b);
  }

  navigate(dir: NavDir): void {
    this.navQueue = dir;
  }

  releaseAll(): void {
    for (const b of BUTTONS) this.cur[b] = false;
    this.moveX = this.moveY = this.aimX = this.aimY = this.lt = this.rt = 0;
  }

  pressed(b: Button): boolean {
    return this.cur[b] && !this.prev[b];
  }

  released(b: Button): boolean {
    return !this.cur[b] && this.prev[b];
  }

  held(b: Button): boolean {
    return this.cur[b];
  }

  nav(): NavDir | null {
    return this.navFrame;
  }

  rumble(): void {
    // CPUs don't hold a controller.
  }
}

/** Resolves a player slot to whatever device is currently assigned to it. */
export interface SlotResolver {
  deviceForSlot(slot: number): Controls | null;
}

/** Controls for one player slot; follows reassignment (e.g. after a controller reconnects). */
export class SlotControls implements Controls {
  constructor(
    private resolver: SlotResolver,
    readonly slot: number,
  ) {}

  private get dev(): Controls {
    return this.resolver.deviceForSlot(this.slot) ?? NO_CONTROLS;
  }

  get kind() {
    return this.dev.kind;
  }
  get label() {
    return this.dev.label;
  }
  pressed(b: Button) {
    return this.dev.pressed(b);
  }
  released(b: Button) {
    return this.dev.released(b);
  }
  held(b: Button) {
    return this.dev.held(b);
  }
  get moveX() {
    return this.dev.moveX;
  }
  get moveY() {
    return this.dev.moveY;
  }
  get aimX() {
    return this.dev.aimX;
  }
  get aimY() {
    return this.dev.aimY;
  }
  get lt() {
    return this.dev.lt;
  }
  get rt() {
    return this.dev.rt;
  }
  nav() {
    return this.dev.nav();
  }
  rumble(strong: number, weak: number, ms: number) {
    this.dev.rumble(strong, weak, ms);
  }
}
