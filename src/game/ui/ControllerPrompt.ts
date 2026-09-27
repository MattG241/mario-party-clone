import Phaser from 'phaser';
import type { Button, KeyAction } from '../input/buttons';
import { keyLabel } from '../input/buttons';
import { input } from '../input/InputManager';
import { settings } from '../save/SettingsManager';
import { addText, BUTTON_COLORS } from './theme';

export type GlyphKind = 'gamepad' | 'keyboard';

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
    if (ref) return ref.kind === 'keyboard' ? 'keyboard' : 'gamepad';
  }
  if (!input.hasGamepad()) return 'keyboard';
  return input.lastKind;
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
    g.fillStyle(0x4b4163, 1);
    g.fillRoundedRect(-w / 2, -size / 2 + 4, w, size, 8);
    g.fillStyle(0xfff4dc, 1);
    g.fillRoundedRect(-w / 2, -size / 2, w, size, 8);
    g.lineStyle(2, 0x2b2340, 0.8);
    g.strokeRoundedRect(-w / 2, -size / 2, w, size, 8);
    c.add(addText(scene, 0, -1, label, size * 0.5, { color: '#2b2340', weight: 700, fixed: true }));
    c.setSize(w, size);
    return c;
  }
  const r = size / 2;
  switch (button) {
    case 'A':
    case 'B':
    case 'X':
    case 'Y': {
      g.fillStyle(0x1b1530, 1);
      g.fillCircle(0, 3, r);
      g.fillStyle(BUTTON_COLORS[button], 1);
      g.fillCircle(0, 0, r);
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeCircle(0, 0, r);
      c.add(addText(scene, 0, -1, button, size * 0.58, { color: '#ffffff', stroke: '#1b1530', strokeThickness: 3, weight: 700, fixed: true }));
      c.setSize(size, size);
      return c;
    }
    case 'LB':
    case 'RB':
    case 'LT':
    case 'RT': {
      const w = size * 1.5;
      g.fillStyle(0x1b1530, 1);
      g.fillRoundedRect(-w / 2, -r + 3, w, size, button.endsWith('T') ? { tl: r, tr: r, bl: 6, br: 6 } : 8);
      g.fillStyle(0x3a3150, 1);
      g.fillRoundedRect(-w / 2, -r, w, size, button.endsWith('T') ? { tl: r, tr: r, bl: 6, br: 6 } : 8);
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeRoundedRect(-w / 2, -r, w, size, button.endsWith('T') ? { tl: r, tr: r, bl: 6, br: 6 } : 8);
      c.add(addText(scene, 0, -1, button, size * 0.46, { color: '#ffffff', weight: 700, fixed: true }));
      c.setSize(w, size);
      return c;
    }
    case 'MENU':
    case 'VIEW': {
      g.fillStyle(0x3a3150, 1);
      g.fillCircle(0, 0, r);
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeCircle(0, 0, r);
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
  private size: number;
  private fontSize: number;
  private color: string;

  constructor(scene: Phaser.Scene, x: number, y: number, prompts: PromptSpec[] = [], opts: { size?: number; fontSize?: number; color?: string; slot?: number } = {}) {
    super(scene, x, y);
    this.size = opts.size ?? 38;
    this.fontSize = opts.fontSize ?? 26;
    this.color = opts.color ?? '#fff4dc';
    scene.add.existing(this);
    this.setPrompts(prompts, opts.slot);
  }

  setPrompts(prompts: PromptSpec[], slot?: number): this {
    this.removeAll(true);
    const kind = glyphKindFor(slot);
    let x = 0;
    const parts: Phaser.GameObjects.Container[] = [];
    for (const p of prompts) {
      const item = this.scene.add.container(0, 0);
      const glyph = makeGlyph(this.scene, p.button, this.size, kind);
      glyph.x = glyph.width / 2;
      const dark = this.color === '#2b2340' || this.color.toLowerCase() === '#2b2340';
      const label = addText(this.scene, glyph.width + 10, 0, p.label, this.fontSize, dark ? { color: this.color, align: 'left', weight: 600 } : { color: this.color, align: 'left', stroke: '#1b1530', strokeThickness: 4, weight: 600 });
      item.add([glyph, label]);
      const w = glyph.width + 10 + label.width;
      item.setSize(w, this.size);
      item.x = x;
      x += w + 34;
      parts.push(item);
    }
    const total = Math.max(0, x - 34);
    for (const p of parts) {
      p.x -= total / 2;
      this.add(p);
    }
    return this;
  }
}
