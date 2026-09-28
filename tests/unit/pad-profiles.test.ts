import { describe, expect, it } from 'vitest';
import { decodeHat, identifyPad, readGeneric, readMapped, readStandard, sanitizeMappings, type RawPad } from '../../src/game/input/padProfiles';

function pad(buttons: number[], axes: number[] = [0, 0, 0, 0]): RawPad {
  return { axes, buttons: buttons.map((v) => ({ pressed: v > 0.5, value: v })) };
}

const idle = () => new Array(17).fill(0);

describe('identifyPad', () => {
  it('reads Chrome ids', () => {
    const p = identifyPad('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)');
    expect(p).toMatchObject({ vendor: '054c', product: '0ce6', family: 'playstation', name: 'DualSense Wireless Controller' });
    expect(identifyPad('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)').family).toBe('xbox');
    expect(identifyPad('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)').family).toBe('nintendo');
  });

  it('reads Firefox ids and plain names', () => {
    expect(identifyPad('054c-09cc-Wireless Controller')).toMatchObject({ vendor: '054c', product: '09cc', family: 'playstation', name: 'Wireless Controller' });
    expect(identifyPad('57e-2009-Pro Controller')).toMatchObject({ vendor: '057e', family: 'nintendo' });
    expect(identifyPad('Joy-Con (L)').family).toBe('nintendo');
    expect(identifyPad('USB Gamepad (Vendor: 0079 Product: 0006)')).toMatchObject({ family: 'generic', name: 'USB Gamepad' });
  });
});

describe('decodeHat', () => {
  it('decodes the eight directions and centre', () => {
    expect(decodeHat(-1)).toEqual({ up: true, down: false, left: false, right: false });
    expect(decodeHat(-5 / 7)).toEqual({ up: true, down: false, left: false, right: true });
    expect(decodeHat(-3 / 7)).toEqual({ up: false, down: false, left: false, right: true });
    expect(decodeHat(1 / 7)).toEqual({ up: false, down: true, left: false, right: false });
    expect(decodeHat(5 / 7)).toEqual({ up: false, down: false, left: true, right: false });
    expect(decodeHat(1)).toEqual({ up: true, down: false, left: true, right: false });
    expect(decodeHat(9 / 7)).toEqual({ up: false, down: false, left: false, right: false });
    expect(decodeHat(3.2857)).toEqual({ up: false, down: false, left: false, right: false });
  });
});

describe('readStandard', () => {
  it('maps face buttons by position, or by label for Nintendo pads', () => {
    const b = idle();
    b[1] = 1; // right face button (labelled A on a Switch pad)
    expect(readStandard(pad(b), false).buttons.B).toBe(true);
    const swapped = readStandard(pad(b), true);
    expect(swapped.buttons.A).toBe(true);
    expect(swapped.buttons.B).toBe(false);
  });

  it('reads analogue triggers and the D-pad', () => {
    const b = idle();
    b[7] = 0.8;
    b[12] = 1;
    const f = readStandard(pad(b, [0.5, -0.25, 0, 1]), false);
    expect(f.rt).toBeCloseTo(0.8);
    expect(f.buttons.RT).toBe(true);
    expect(f.buttons.UP).toBe(true);
    expect([f.lx, f.ly, f.ry]).toEqual([0, -0.25, 1].map((v, i) => (i === 0 ? 0.5 : v)));
  });
});

describe('readGeneric', () => {
  it('finds a hat switch D-pad and keeps it off the right stick', () => {
    const hats = new Set<number>();
    const axes = [0, 0, 0, 0, 0, 0, 0, 0, 0, 9 / 7];
    readGeneric(pad(idle(), axes), hats, false);
    expect(hats.has(9)).toBe(true);
    axes[9] = 1 / 7; // down
    expect(readGeneric(pad(idle(), axes), hats, false).buttons.DOWN).toBe(true);
    const hatOnAxis2 = new Set<number>();
    const f = readGeneric(pad(idle(), [0, 0, 9 / 7, 0.4]), hatOnAxis2, false);
    expect(f.rx).toBe(0);
    expect(f.ry).toBe(0);
  });
});

describe('readMapped', () => {
  it('applies a recorded layout: buttons, trigger axes, hats and sticks', () => {
    const m = {
      buttons: {
        A: { t: 'b' as const, i: 2 },
        LT: { t: 'a' as const, i: 4, s: 1 as const, rest: -1 },
        UP: { t: 'h' as const, i: 9, v: -1 },
        RIGHT: { t: 'h' as const, i: 9, v: -3 / 7 },
        DOWN: { t: 'h' as const, i: 9, v: 1 / 7 },
        LEFT: { t: 'h' as const, i: 9, v: 5 / 7 },
      },
      lx: { i: 0, s: 1 as const },
      ly: { i: 1, s: -1 as const },
    };
    const b = idle();
    b[2] = 1;
    const axes = [0.7, 0.5, 0, 0, 1, 0, 0, 0, 0, -5 / 7];
    const f = readMapped(pad(b, axes), m);
    expect(f.buttons.A).toBe(true);
    expect(f.lt).toBeCloseTo(1);
    expect(f.buttons.LT).toBe(true);
    // up-right on the hat reports both directions
    expect(f.buttons.UP && f.buttons.RIGHT).toBe(true);
    expect(f.buttons.DOWN || f.buttons.LEFT).toBe(false);
    expect(f.lx).toBeCloseTo(0.7);
    expect(f.ly).toBeCloseTo(-0.5);
    // a trigger resting at -1 reads 0
    axes[4] = -1;
    expect(readMapped(pad(b, axes), m).lt).toBe(0);
  });
});

describe('sanitizeMappings', () => {
  it('keeps well-formed layouts and drops junk', () => {
    const out = sanitizeMappings({
      good: { buttons: { A: { t: 'b', i: 1 }, B: { t: 'x', i: 2 }, NOPE: { t: 'b', i: 3 } }, lx: { i: 0, s: 1 }, ly: { i: 1, s: 2 } },
      bad: 42,
    });
    expect(Object.keys(out)).toEqual(['good']);
    expect(out.good.buttons).toEqual({ A: { t: 'b', i: 1 } });
    expect(out.good.lx).toEqual({ i: 0, s: 1 });
    expect(out.good.ly).toBeUndefined();
    expect(sanitizeMappings(null)).toEqual({});
  });
});
