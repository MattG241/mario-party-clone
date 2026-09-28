// How raw Gamepad API buttons/axes become the game's logical controller (see buttons.ts).
//
// Browsers report most controllers (Xbox, PlayStation, Switch Pro, 8BitDo, Logitech in X mode…)
// with the W3C "standard" mapping, which the game reads directly. Everything else — generic USB
// pads, DirectInput devices, some controllers in Firefox or on Linux — arrives in the device's
// own order. For those the game makes a best guess (including hat-switch D-pads) and players can
// record a custom layout on the Button Setup screen; custom layouts are saved per controller id.
import type { Button } from './buttons';

export type PadFamily = 'xbox' | 'playstation' | 'nintendo' | 'generic';

export interface PadIdentity {
  vendor: string | null;
  product: string | null;
  /** Readable name without the browser's vendor/product decorations. */
  name: string;
  family: PadFamily;
}

/**
 * Parse Gamepad.id. Chrome: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c
 * Product: 0ce6)"; Firefox: "054c-0ce6-DualSense Wireless Controller"; Safari: just a name.
 */
export function identifyPad(id: string): PadIdentity {
  let vendor: string | null = null;
  let product: string | null = null;
  const chrome = /Vendor:\s*([0-9a-f]{1,4})\s*Product:\s*([0-9a-f]{1,4})/i.exec(id);
  const firefox = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  const m = chrome ?? firefox;
  if (m) {
    vendor = m[1].toLowerCase().padStart(4, '0');
    product = m[2].toLowerCase().padStart(4, '0');
  }
  const name =
    id
      .replace(/\(.*?\)/g, '')
      .replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Gamepad';
  const s = id.toLowerCase();
  let family: PadFamily = 'generic';
  if (vendor === '054c' || /dualsense|dualshock|playstation|\bps[345]\b/.test(s)) family = 'playstation';
  else if (vendor === '057e' || /pro controller|joy-con|nintendo|switch/.test(s)) family = 'nintendo';
  else if (vendor === '045e' || /xbox|xinput|x-box/.test(s)) family = 'xbox';
  return { vendor, product, name, family };
}

/** Where a logical input comes from on the raw device. */
export type PadSource =
  /** A button (pressed, or analogue value above half). */
  | { t: 'b'; i: number }
  /** An axis moved from `rest` in direction `s` (triggers resting at -1, digital D-pads on axes…). */
  | { t: 'a'; i: number; s: 1 | -1; rest: number }
  /** A hat switch axis reading `v` (one D-pad direction). */
  | { t: 'h'; i: number; v: number };

/** An analogue stick axis: raw axis index and its sign (so "right" and "down" are positive). */
export interface StickAxis {
  i: number;
  s: 1 | -1;
}

/** A recorded controller layout (Button Setup). */
export interface PadMapping {
  buttons: Partial<Record<Button, PadSource>>;
  lx?: StickAxis;
  ly?: StickAxis;
  rx?: StickAxis;
  ry?: StickAxis;
}

export interface RawPad {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

const HAT_STEP = 2 / 7;

/** A value only a hat switch produces at rest (browsers report ~1.29 or ~3.29 for "centred"). */
export function isHatRest(v: number): boolean {
  return v > 1.05;
}

/**
 * Standard hat encoding (Chrome and Firefox for DirectInput hats): -1 up, then clockwise in
 * steps of 2/7 to 1 = up-left; anything outside [-1, 1] is centred.
 */
export function decodeHat(v: number): { up: boolean; down: boolean; left: boolean; right: boolean } {
  const none = { up: false, down: false, left: false, right: false };
  if (!Number.isFinite(v) || v < -1.05 || v > 1.05) return none;
  const d = Math.round((v + 1) / HAT_STEP);
  if (Math.abs(v + 1 - d * HAT_STEP) > 0.1) return none;
  const k = ((d % 8) + 8) % 8;
  return { up: k === 7 || k === 0 || k === 1, right: k >= 1 && k <= 3, down: k >= 3 && k <= 5, left: k >= 5 && k <= 7 };
}

/** Strength in [0, 1] of one source on a raw pad. */
export function sourceValue(src: PadSource, pad: RawPad): number {
  if (src.t === 'b') {
    const b = pad.buttons[src.i];
    if (!b) return 0;
    // digital buttons report 1 when down; analogue triggers keep their travel
    return b.pressed ? Math.max(0.51, b.value) : b.value;
  }
  const v = pad.axes[src.i];
  if (v === undefined || !Number.isFinite(v)) return 0;
  if (src.t === 'h') return Math.abs(v - src.v) < 0.1 ? 1 : 0;
  const span = 1 - src.rest * src.s;
  if (span < 0.2) return 0;
  return Math.min(1, Math.max(0, ((v - src.rest) * src.s) / span));
}

export function sourcePressed(src: PadSource, pad: RawPad): boolean {
  return sourceValue(src, pad) > 0.5;
}

export function stickValue(ax: StickAxis | undefined, pad: RawPad): number {
  if (!ax) return 0;
  const v = pad.axes[ax.i];
  return v === undefined || !Number.isFinite(v) || Math.abs(v) > 1.05 ? 0 : v * ax.s;
}

/** A logical frame read from a raw pad: buttons, sticks and analogue triggers. */
export interface LogicalFrame {
  buttons: Record<Button, boolean>;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lt: number;
  rt: number;
}

const FACE_SWAP: Partial<Record<Button, Button>> = { A: 'B', B: 'A', X: 'Y', Y: 'X' };

function blank(): Record<Button, boolean> {
  return { A: false, B: false, X: false, Y: false, LB: false, RB: false, LT: false, RT: false, VIEW: false, MENU: false, LS: false, RS: false, UP: false, DOWN: false, LEFT: false, RIGHT: false };
}

export const TRIGGER_PRESS = 0.35;

/**
 * W3C standard mapping. `swapFace` reads Nintendo controllers by their labels: the standard
 * mapping is positional (bottom face button = index 0), but on a Switch pad the bottom button is
 * labelled B, so with the swap the button labelled A confirms.
 */
export function readStandard(pad: RawPad, swapFace: boolean): LogicalFrame {
  const btn = (i: number) => {
    const b = pad.buttons[i];
    return !!b && (b.pressed || b.value > 0.5);
  };
  const val = (i: number) => pad.buttons[i]?.value ?? 0;
  const ax = (i: number) => pad.axes[i] ?? 0;
  const b = blank();
  const face: [Button, number][] = [
    ['A', 0],
    ['B', 1],
    ['X', 2],
    ['Y', 3],
  ];
  for (const [name, i] of face) b[swapFace ? (FACE_SWAP[name] as Button) : name] = btn(i);
  b.LB = btn(4);
  b.RB = btn(5);
  const lt = val(6);
  const rt = val(7);
  b.VIEW = btn(8);
  b.MENU = btn(9);
  b.LS = btn(10);
  b.RS = btn(11);
  b.UP = btn(12);
  b.DOWN = btn(13);
  b.LEFT = btn(14);
  b.RIGHT = btn(15);
  b.LT = lt > TRIGGER_PRESS;
  b.RT = rt > TRIGGER_PRESS;
  return { buttons: b, lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(3), lt, rt };
}

/** Find a hat switch: an axis resting outside [-1, 1] (seen now or earlier on this device). */
export function findHatAxis(pad: RawPad, known: Set<number>): number | null {
  for (let i = 0; i < pad.axes.length; i++) if (isHatRest(pad.axes[i])) known.add(i);
  for (const i of known) if (i < pad.axes.length) return i;
  return null;
}

/**
 * Best guess for a non-standard controller without a recorded layout: DirectInput-style button
 * order (0–3 face, 4/5 bumpers, 6/7 triggers, 8/9 select/start, 10/11 stick clicks), sticks on
 * axes 0/1 and 2/3, and the D-pad from a hat switch, buttons 12–15 or axes 6/7.
 */
export function readGeneric(pad: RawPad, hatAxes: Set<number>, swapFace: boolean): LogicalFrame {
  const f = readStandard(pad, swapFace);
  const hat = findHatAxis(pad, hatAxes);
  if (hat !== null) {
    const d = decodeHat(pad.axes[hat]);
    f.buttons.UP ||= d.up;
    f.buttons.DOWN ||= d.down;
    f.buttons.LEFT ||= d.left;
    f.buttons.RIGHT ||= d.right;
  } else if (pad.axes.length >= 8) {
    const x = pad.axes[6] ?? 0;
    const y = pad.axes[7] ?? 0;
    f.buttons.LEFT ||= x < -0.5;
    f.buttons.RIGHT ||= x > 0.5;
    f.buttons.UP ||= y < -0.5;
    f.buttons.DOWN ||= y > 0.5;
  }
  // Only use axes 2/3 as the right stick when they aren't the hat.
  if (hat === 2 || hat === 3) {
    f.rx = 0;
    f.ry = 0;
  }
  return f;
}

/** A recorded layout. Unmapped buttons stay up; unmapped sticks stay centred. */
export function readMapped(pad: RawPad, m: PadMapping): LogicalFrame {
  const b = blank();
  let lt = 0;
  let rt = 0;
  for (const [name, src] of Object.entries(m.buttons) as [Button, PadSource][]) {
    if (!src) continue;
    if (name === 'LT') lt = sourceValue(src, pad);
    else if (name === 'RT') rt = sourceValue(src, pad);
    else b[name] = sourcePressed(src, pad);
  }
  // A D-pad recorded on a hat also reports diagonals (between two recorded directions).
  const up = m.buttons.UP;
  if (up?.t === 'h' && m.buttons.RIGHT?.t === 'h' && m.buttons.DOWN?.t === 'h' && m.buttons.LEFT?.t === 'h') {
    const v = pad.axes[up.i];
    if (v !== undefined && Math.abs(up.v + 1) < 0.1) {
      const d = decodeHat(v);
      b.UP ||= d.up;
      b.DOWN ||= d.down;
      b.LEFT ||= d.left;
      b.RIGHT ||= d.right;
    }
  }
  b.LT = lt > TRIGGER_PRESS;
  b.RT = rt > TRIGGER_PRESS;
  return { buttons: b, lx: stickValue(m.lx, pad), ly: stickValue(m.ly, pad), rx: stickValue(m.rx, pad), ry: stickValue(m.ry, pad), lt, rt };
}

/** Keep only well-formed mappings (settings come from localStorage). */
export function sanitizeMappings(raw: unknown): Record<string, PadMapping> {
  const out: Record<string, PadMapping> = {};
  if (!raw || typeof raw !== 'object') return out;
  const okIndex = (i: unknown) => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < 64;
  const okSign = (s: unknown) => s === 1 || s === -1;
  const src = (v: unknown): PadSource | null => {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (o.t === 'b' && okIndex(o.i)) return { t: 'b', i: o.i as number };
    if (o.t === 'a' && okIndex(o.i) && okSign(o.s) && typeof o.rest === 'number' && Number.isFinite(o.rest)) return { t: 'a', i: o.i as number, s: o.s as 1 | -1, rest: o.rest };
    if (o.t === 'h' && okIndex(o.i) && typeof o.v === 'number' && Number.isFinite(o.v)) return { t: 'h', i: o.i as number, v: o.v };
    return null;
  };
  const stick = (v: unknown): StickAxis | undefined => {
    if (!v || typeof v !== 'object') return undefined;
    const o = v as Record<string, unknown>;
    return okIndex(o.i) && okSign(o.s) ? { i: o.i as number, s: o.s as 1 | -1 } : undefined;
  };
  for (const [id, m] of Object.entries(raw as Record<string, unknown>)) {
    if (!m || typeof m !== 'object' || id.length > 200) continue;
    const mm = m as Record<string, unknown>;
    const buttons: Partial<Record<Button, PadSource>> = {};
    if (mm.buttons && typeof mm.buttons === 'object') {
      for (const [k, v] of Object.entries(mm.buttons as Record<string, unknown>)) {
        const s = src(v);
        if (s && k in blank()) buttons[k as Button] = s;
      }
    }
    out[id] = { buttons, lx: stick(mm.lx), ly: stick(mm.ly), rx: stick(mm.rx), ry: stick(mm.ry) };
  }
  return out;
}
