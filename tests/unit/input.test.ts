import { describe, expect, it } from 'vitest';
import { slotForDevice } from '../../src/game/input/assignment';
import { applyRadialDeadzone, MENU_REPEAT_DELAY, MENU_REPEAT_INTERVAL, NavRepeater, stickToNav } from '../../src/game/input/Controls';
import { GamepadDevice } from '../../src/game/input/GamepadManager';
import { deviceLabel, InputManager, sameDevice } from '../../src/game/input/InputManager';
import { KeyboardDevice } from '../../src/game/input/KeyboardManager';
import { VirtualControls } from '../../src/game/input/PlayerInput';

describe('menu navigation repeat', () => {
  it('fires immediately, again after 300 ms, then every ~115 ms', () => {
    const r = new NavRepeater();
    const fired: number[] = [];
    let t = 0;
    for (let i = 0; i < 60; i++) {
      const dt = i === 0 ? 0 : 16;
      t += dt;
      if (r.update('down', dt)) fired.push(t);
    }
    expect(fired[0]).toBe(0);
    expect(fired[1]).toBeGreaterThanOrEqual(MENU_REPEAT_DELAY);
    expect(fired[1]).toBeLessThan(MENU_REPEAT_DELAY + 20);
    const gap = fired[2] - fired[1];
    expect(gap).toBeGreaterThanOrEqual(MENU_REPEAT_INTERVAL - 16);
    expect(gap).toBeLessThanOrEqual(MENU_REPEAT_INTERVAL + 16);
  });

  it('restarts the cycle when the direction changes or is released', () => {
    const r = new NavRepeater();
    expect(r.update('down', 0)).toBe('down');
    expect(r.update('down', 16)).toBeNull();
    expect(r.update('up', 16)).toBe('up');
    expect(r.update(null, 16)).toBeNull();
    expect(r.update('up', 16)).toBe('up');
  });

  it('does not skip choices from a single short push', () => {
    const r = new NavRepeater();
    let count = 0;
    // 250 ms push, shorter than the repeat delay.
    for (let i = 0; i < 16; i++) if (r.update('right', 16)) count++;
    expect(count).toBe(1);
  });
});

describe('analogue sticks', () => {
  it('applies a radial dead zone and rescales the rest', () => {
    expect(applyRadialDeadzone(0.1, 0.1, 0.18)).toEqual([0, 0]);
    const [x] = applyRadialDeadzone(1, 0, 0.18);
    expect(x).toBeCloseTo(1);
    const [hx] = applyRadialDeadzone(0.59, 0, 0.18);
    expect(hx).toBeCloseTo(0.5, 1);
  });

  it('uses hysteresis so drift near the threshold does not re-trigger', () => {
    expect(stickToNav(0.4, 0, null)).toBeNull();
    expect(stickToNav(0.6, 0, null)).toBe('right');
    // Falls to 0.4 while held: still counts as held (no new press).
    expect(stickToNav(0.4, 0, 'right')).toBe('right');
    expect(stickToNav(0.2, 0, 'right')).toBeNull();
    expect(stickToNav(0.1, -0.8, null)).toBe('up');
  });
});

describe('controller assignment', () => {
  it('puts controller N on player N when free, else the first free slot', () => {
    expect(slotForDevice({ kind: 'gamepad', index: 2 }, [true, true, true, true])).toBe(2);
    expect(slotForDevice({ kind: 'gamepad', index: 2 }, [true, true, false, true])).toBe(0);
    expect(slotForDevice({ kind: 'keyboard' }, [false, true, true, true])).toBe(1);
    expect(slotForDevice({ kind: 'gamepad', index: 6 }, [false, false, false, true])).toBe(3);
    expect(slotForDevice({ kind: 'keyboard' }, [false, false, false, false])).toBe(-1);
  });

  it('tracks which device drives which player slot', () => {
    const m = new InputManager();
    m.assign(0, { kind: 'keyboard' });
    m.assign(1, { kind: 'gamepad', index: 0 });
    expect(m.slotOf({ kind: 'gamepad', index: 0 })).toBe(1);
    expect(m.slotOf({ kind: 'keyboard' })).toBe(0);
    expect(m.slotOf({ kind: 'gamepad', index: 3 })).toBeNull();
    expect(sameDevice({ kind: 'gamepad', index: 1 }, { kind: 'gamepad', index: 1 })).toBe(true);
    expect(sameDevice({ kind: 'gamepad', index: 1 }, { kind: 'keyboard' })).toBe(false);
    expect(deviceLabel({ kind: 'gamepad', index: 1 })).toBe('Controller 2');
  });

  it('never lets one slot read another slot\'s device', () => {
    const m = new InputManager();
    m.assign(0, { kind: 'keyboard' });
    // Slot 1 has a disconnected pad → inert controls, not the keyboard.
    m.assign(1, { kind: 'gamepad', index: 0 });
    expect(m.deviceForSlot(1)).toBeNull();
    expect(m.controls(1).pressed('A')).toBe(false);
    expect(m.deviceForSlot(0)).toBe(m.keyboard);
  });
});

describe('keyboard device', () => {
  function fakeWindow() {
    const handlers: Record<string, ((e: unknown) => void)[]> = {};
    return {
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        (handlers[type] ??= []).push(fn);
      },
      fire(type: string, code: string, repeat = false) {
        for (const fn of handlers[type] ?? []) fn({ code, repeat, preventDefault() {} });
      },
    };
  }

  it('reports pressed / held / released and catches sub-frame taps', () => {
    const w = fakeWindow();
    const kb = new KeyboardDevice();
    kb.attach(w as unknown as Window);
    kb.update(16, 0);
    w.fire('keydown', 'Enter');
    kb.update(16, 16);
    expect(kb.pressed('A')).toBe(true);
    expect(kb.held('A')).toBe(true);
    kb.update(16, 32);
    expect(kb.pressed('A')).toBe(false);
    expect(kb.held('A')).toBe(true);
    w.fire('keyup', 'Enter');
    kb.update(16, 48);
    expect(kb.released('A')).toBe(true);
    // Tap entirely between two frames.
    w.fire('keydown', 'Space');
    w.fire('keyup', 'Space');
    kb.update(16, 64);
    expect(kb.pressed('A')).toBe(true);
  });

  it('maps movement keys to the stick and menu navigation', () => {
    const w = fakeWindow();
    const kb = new KeyboardDevice();
    kb.attach(w as unknown as Window);
    w.fire('keydown', 'KeyD');
    kb.update(16, 0);
    expect(kb.moveX).toBe(1);
    expect(kb.nav()).toBe('right');
    kb.update(16, 16);
    expect(kb.nav()).toBeNull();
  });

  it('ignores keys held across a screen change until released', () => {
    const w = fakeWindow();
    const kb = new KeyboardDevice();
    kb.attach(w as unknown as Window);
    w.fire('keydown', 'Enter');
    kb.update(16, 0);
    kb.lockHeld();
    kb.update(16, 16);
    expect(kb.held('A')).toBe(false);
    w.fire('keyup', 'Enter');
    kb.update(16, 32);
    w.fire('keydown', 'Enter');
    kb.update(16, 48);
    expect(kb.pressed('A')).toBe(true);
  });
});

describe('CPU virtual controls', () => {
  it('taps last exactly one frame', () => {
    const v = new VirtualControls();
    v.step();
    v.tap('A');
    expect(v.pressed('A')).toBe(true);
    v.step();
    expect(v.pressed('A')).toBe(false);
    expect(v.released('A')).toBe(true);
  });

  it('holds and clamps the stick', () => {
    const v = new VirtualControls();
    v.setMove(3, 4);
    expect(Math.hypot(v.moveX, v.moveY)).toBeCloseTo(1);
    v.hold('X');
    v.step();
    expect(v.held('X')).toBe(true);
  });
});

describe('joining without echoes', () => {
  const gp = (index: number, id: string, down: number[]) =>
    ({
      id,
      index,
      mapping: 'standard',
      connected: true,
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), touched: false, value: down.includes(i) ? 1 : 0 })),
    }) as unknown as Gamepad;
  const pressing = (index: number, id: string, down: number[]) => {
    const d = new GamepadDevice(index);
    d.update(gp(index, id, []), 16, 0);
    d.update(gp(index, id, down), 16, 16);
    return d;
  };

  it('counts one physical press once when a controller shows up twice', () => {
    const m = new InputManager();
    m.pads.set(0, pressing(0, 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', [0]));
    m.pads.set(1, pressing(1, 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', [0]));
    expect(m.joinPresses('A')).toEqual([{ kind: 'gamepad', index: 0 }]);
    // the mirror of a seated controller doesn't take a second seat
    m.assign(0, { kind: 'gamepad', index: 0 });
    expect(m.joinPresses('A').filter((r) => m.slotOf(r) === null)).toEqual([]);
  });

  it('still lets different controllers join together', () => {
    const m = new InputManager();
    m.pads.set(0, pressing(0, 'pad one', [0]));
    m.pads.set(1, pressing(1, 'pad two', [0, 4]));
    expect(m.joinPresses('A')).toHaveLength(2);
  });
});
