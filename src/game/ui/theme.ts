import Phaser from 'phaser';
import { CSS, FONT } from '../constants';
import { settings } from '../save/SettingsManager';

/** Large-text mode multiplier for body text. */
export function textScale(): number {
  return settings.get().largeText ? 1.2 : 1;
}

export interface TextOpts {
  color?: string;
  stroke?: string;
  strokeThickness?: number;
  shadow?: boolean | string;
  weight?: 400 | 500 | 600 | 700;
  align?: 'left' | 'center' | 'right';
  wrap?: number;
  lineSpacing?: number;
  /** Titles keep their size in large-text mode (they're already huge). */
  fixed?: boolean;
}

export function textStyle(size: number, o: TextOpts = {}): Phaser.Types.GameObjects.Text.TextStyle {
  const px = Math.round(size * (o.fixed ? 1 : textScale()));
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: FONT,
    fontSize: `${px}px`,
    fontStyle: String(o.weight ?? 600),
    color: o.color ?? CSS.ink,
    align: o.align ?? 'center',
  };
  if (o.stroke) {
    style.stroke = o.stroke;
    style.strokeThickness = o.strokeThickness ?? Math.max(2, Math.round(px / 9));
  }
  if (o.shadow) {
    style.shadow = {
      offsetX: 0,
      offsetY: Math.max(2, Math.round(px / 14)),
      color: typeof o.shadow === 'string' ? o.shadow : 'rgba(20,12,40,0.45)',
      blur: 0,
      fill: true,
      stroke: true,
    };
  }
  if (o.wrap) style.wordWrap = { width: o.wrap, useAdvancedWrap: true };
  if (o.lineSpacing !== undefined) style.lineSpacing = o.lineSpacing;
  return style;
}

/** Convenience: add a text object with the Gleamtrail style. */
export function addText(scene: Phaser.Scene, x: number, y: number, text: string, size: number, o: TextOpts = {}): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, text, textStyle(size, o));
  t.setOrigin(o.align === 'left' ? 0 : o.align === 'right' ? 1 : 0.5, 0.5);
  return t;
}

/** Big display title: white (or the given colour) with a slim ink outline and a soft drop shadow. */
export function addTitle(scene: Phaser.Scene, x: number, y: number, text: string, size: number, color: string = '#ffffff'): Phaser.GameObjects.Text {
  const t = addText(scene, x, y, text, size, { color, stroke: '#1f2940', strokeThickness: Math.max(3, Math.round(size / 16)), weight: 700, fixed: true });
  t.setShadow(0, Math.max(3, Math.round(size / 18)), 'rgba(10,17,32,0.35)', Math.max(4, Math.round(size / 10)), true, true);
  return t;
}

export const BUTTON_COLORS: Record<string, number> = {
  A: 0x3fbf5f,
  B: 0xe5484d,
  X: 0x3b82f6,
  Y: 0xf5c542,
};
