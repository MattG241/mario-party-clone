import Phaser from 'phaser';
import type { Button, KeyAction } from '../input/buttons';
import { keyLabel } from '../input/buttons';
import { padConfig } from '../input/GamepadManager';
import { input } from '../input/InputManager';
import type { PadFamily } from '../input/padProfiles';
import { settings } from '../save/SettingsManager';
import { drawSlate } from './Style';
import { addText, BUTTON_COLORS } from './theme';

/** Glyph set: key caps, or a controller family's buttons ('gamepad' = Xbox-style). */
export type GlyphKind = 'keyboard' | 'gamepad' | 'xbox' | 'playstation' | 'nintendo';

function padGlyphs(f: PadFamily): GlyphKind {
  return f === 'playstation' ? 'playstation' : f === 'nintendo' ? 'nintendo' : 'xbox';
}

/** PlayStation face symbols by position (A = bottom): cross, circle, square, triangle. */
const PS_FACE: Record<'A' | 'B' | 'X' | 'Y', { shape: 'cross' | 'circle' | 'square' | 'triangle'; color: number }> = {
  A: { shape: 'cross', color: 0x86b4ff },
  B: { shape: 'circle', color: 0xff737a },
  X: { shape: 'square', color: 0xf09ad8 },
  Y: { shape: 'triangle', color: 0x63d6a0 },
};

const SHOULDER_LABELS: Record<'playstation' | 'nintendo', Record<'LB' | 'RB' | 'LT' | 'RT', string>> = {
  playstation: { LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2' },
  nintendo: { LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR' },
};

/** The letter printed on a Nintendo pad's button for a logical face button. */
function nintendoLabel(b: 'A' | 'B' | 'X' | 'Y'): string {
  if (padConfig.nintendoByLabel) return b;
  return ({ A: 'B', B: 'A', X: 'Y', Y: 'X' } as const)[b];
}

const BUTTON_TO_ACTION: Partial<Record<Button, KeyAction>> = {
  A: 'A',
  B: 'B',
  X: 'X',
  Y: 'Y',
  LB: 'LB',
  RB: 'RB',
  LT: 'LT',
  RT: 'RT',
  MENU: 'MENU',
  VIEW: 'VIEW',
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
};

/** Which glyph set to show for a player slot (or globally when slot is undefined). */
export function glyphKindFor(slot?: number): GlyphKind {
  if (slot !== undefined) {
    const ref = input.slots[slot];
    if (ref) return ref.kind === 'keyboard' ? 'keyboard' : padGlyphs(input.padFamily(slot));
  }
  if (!input.hasGamepad()) return 'keyboard';
  return input.lastKind === 'keyboard' ? 'keyboard' : padGlyphs(input.padFamily());
}

export type PromptButton = Button | 'STICK' | 'RSTICK' | 'DPAD';

/** A single controller button glyph (Xbox face buttons / bumpers / triggers, or a key cap). */
export function makeGlyph(scene: Phaser.Scene, button: PromptButton, size: number, kind: GlyphKind): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  c.add(g);
  if (kind === 'keyboard' && button !== 'RSTICK') {
    let label: string;
    if (button === 'STICK' || button === 'DPAD') {
      const b = settings.get().keyBindings;
      label = [b.up[0], b.left[0], b.down[0], b.right[0]].map((k) => keyLabel(k ?? '')).join('');
      if (label === 'WASD') label = 'WASD';
    } else {
      const action = BUTTON_TO_ACTION[button];
      label = action ? keyLabel(settings.get().keyBindings[action]?.[0] ?? '?') : button;
    }
    const w = Math.max(size * 1.1, label.length * size * 0.42 + size * 0.6);
    // A light keycap with a darker lip: reads on dark HUD pills and on white cards alike.
    g.fillStyle(0x9aa5b8, 1);
    g.fillRoundedRect(-w / 2, -size / 2 + 3, w, size, 9);
    g.fillStyle(0xeef1f6, 1);
    g.fillRoundedRect(-w / 2, -size / 2, w, size - 1, 9);
    g.lineStyle(1.5, 0x9aa5b8, 0.8);
    g.strokeRoundedRect(-w / 2, -size / 2, w, size - 1, 9);
    c.add(addText(scene, 0, -1, label, size * 0.5, { color: '#1f2940', weight: 700, fixed: true }));
    c.setSize(w, size);
    return c;
  }
  const r = size / 2;
  switch (button) {
    case 'A':
    case 'B':
    case 'X':
    case 'Y': {
      g.fillStyle(0x000000, 0.22);
      g.fillCircle(0, 2.5, r);
      if (kind === 'playstation') {
        // dark button with the family's coloured symbol, drawn (not a font glyph)
        const f = PS_FACE[button];
        g.fillStyle(0x2a2438, 1);
        g.fillCircle(0, 0, r);
        g.lineStyle(Math.max(2, size * 0.1), f.color, 1);
        const k = r * 0.46;
        if (f.shape === 'cross') {
          g.lineBetween(-k, -k, k, k);
          g.lineBetween(-k, k, k, -k);
        } else if (f.shape === 'circle') g.strokeCircle(0, 0, k * 1.05);
        else if (f.shape === 'square') g.strokeRect(-k * 0.9, -k * 0.9, k * 1.8, k * 1.8);
        else g.strokeTriangle(0, -k * 1.1, k * 1.05, k * 0.75, -k * 1.05, k * 0.75);
      } else if (kind === 'nintendo') {
        g.fillStyle(0x2a2438, 1);
        g.fillCircle(0, 0, r);
        g.lineStyle(2, 0xffffff, 0.85);
        g.strokeCircle(0, 0, r - 1);
        c.add(addText(scene, 0, -1, nintendoLabel(button), size * 0.56, { color: '#ffffff', weight: 700, fixed: true }));
      } else {
        g.fillStyle(BUTTON_COLORS[button], 1);
        g.fillCircle(0, 0, r);
        c.add(addText(scene, 0, -1, button, size * 0.56, { color: '#ffffff', weight: 700, fixed: true }));
      }
      c.setSize(size, size);
      return c;
    }
    case 'LB':
    case 'RB':
    case 'LT':
    case 'RT': {
      const label = kind === 'playstation' || kind === 'nintendo' ? SHOULDER_LABELS[kind][button] : button;
      const w = size * 1.5;
      g.fillStyle(0x1b1530, 1);
      g.fillRoundedRect(-w / 2, -r + 3, w, size, button.endsWith('T') ? { tl: r, tr: r, bl: 6, br: 6 } : 8);
      g.fillStyle(0x3a3150, 1);
      g.fillRoundedRect(-w / 2, -r, w, size, button.endsWith('T') ? { tl: r, tr: r, bl: 6, br: 6 } : 8);
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeRoundedRect(-w / 2, -r, w, size, button.endsWith('T') ? { tl: r, tr: r, bl: 6, br: 6 } : 8);
      c.add(addText(scene, 0, -1, label, size * 0.46, { color: '#ffffff', weight: 700, fixed: true }));
      c.setSize(w, size);
      return c;
    }
    case 'MENU':
    case 'VIEW': {
      g.fillStyle(0x3a3150, 1);
      g.fillCircle(0, 0, r);
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeCircle(0, 0, r);
      if (kind === 'nintendo') {
        // + and − buttons
        g.lineStyle(Math.max(2, size / 9), 0xffffff, 1);
        g.lineBetween(-r * 0.45, 0, r * 0.45, 0);
        if (button === 'MENU') g.lineBetween(0, -r * 0.45, 0, r * 0.45);
        c.setSize(size, size);
        return c;
      }
      g.lineStyle(Math.max(2, size / 12), 0xffffff, 1);
      if (button === 'MENU') {
        for (const dy of [-r * 0.35, 0, r * 0.35]) g.lineBetween(-r * 0.45, dy, r * 0.45, dy);
      } else {
        g.strokeRect(-r * 0.45, -r * 0.3, r * 0.6, r * 0.45);
        g.strokeRect(-r * 0.15, -r * 0.05, r * 0.6, r * 0.45);
      }
      c.setSize(size, size);
      return c;
    }
    case 'STICK':
    case 'RSTICK': {
      g.fillStyle(0x1b1530, 1);
      g.fillCircle(0, 3, r);
      g.fillStyle(0x3a3150, 1);
      g.fillCircle(0, 0, r);
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeCircle(0, 0, r);
      g.strokeCircle(0, 0, r * 0.55);
      c.add(addText(scene, 0, -1, button === 'STICK' ? 'L' : 'R', size * 0.44, { color: '#ffffff', weight: 700, fixed: true }));
      c.setSize(size, size);
      return c;
    }
    default: {
      // D-pad
      const t = size * 0.34;
      g.fillStyle(0x3a3150, 1);
      g.fillRoundedRect(-t / 2, -r, t, size, 3);
      g.fillRoundedRect(-r, -t / 2, size, t, 3);
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeRoundedRect(-t / 2, -r, t, size, 3);
      g.strokeRoundedRect(-r, -t / 2, size, t, 3);
      c.setSize(size, size);
      return c;
    }
  }
}

export interface PromptSpec {
  button: PromptButton;
  label: string;
}

/** A row of "glyph + label" prompts, centred on its position. */
export class PromptBar extends Phaser.GameObjects.Container {
  /** Width of the prompts themselves (unscaled), so a tight spot can shrink the bar to fit. */
  contentWidth = 0;
  private size: number;
  private fontSize: number;
  private color: string;

  constructor(scene: Phaser.Scene, x: number, y: number, prompts: PromptSpec[] = [], opts: { size?: number; fontSize?: number; color?: string; slot?: number } = {}) {
    super(scene, x, y);
    this.size = opts.size ?? 38;
    this.fontSize = opts.fontSize ?? 26;
    this.color = opts.color ?? '#ffffff';
    scene.add.existing(this);
    this.setPrompts(prompts, opts.slot);
  }

  setPrompts(prompts: PromptSpec[], slot?: number): this {
    this.removeAll(true);
    const kind = glyphKindFor(slot);
    let x = 0;
    const parts: Phaser.GameObjects.Container[] = [];
    // Light labels sit on a translucent slate pill (the HUD's material) instead of an outline.
    const dark = !isLightColor(this.color);
    for (const p of prompts) {
      const item = this.scene.add.container(0, 0);
      const glyph = makeGlyph(this.scene, p.button, this.size, kind);
      glyph.x = glyph.width / 2;
      const label = addText(this.scene, glyph.width + 10, 0, p.label, this.fontSize, { color: this.color, align: 'left', weight: 700 });
      item.add([glyph, label]);
      const w = glyph.width + 10 + label.width;
      item.setSize(w, this.size);
      item.x = x;
      x += w + 34;
      parts.push(item);
    }
    const total = Math.max(0, x - 34);
    this.contentWidth = total;
    if (!dark && parts.length) {
      const h = this.size + 18;
      const pill = this.scene.add.graphics();
      drawSlate(pill, -total / 2 - 22, -h / 2, total + 44, h, { alpha: 0.88 });
      this.add(pill);
    }
    for (const p of parts) {
      p.x -= total / 2;
      this.add(p);
    }
    return this;
  }
}

function isLightColor(css: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return l > 140;
}
