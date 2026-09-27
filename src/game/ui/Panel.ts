import Phaser from 'phaser';
import { COLORS } from '../constants';
import { addText } from './theme';

export interface PanelStyle {
  radius?: number;
  fill?: number;
  fillAlpha?: number;
  border?: number;
  borderWidth?: number;
  accent?: number;
  shadow?: boolean;
  shadowOffset?: number;
  engraving?: boolean;
}

/** Draw a Gleamtrail panel (cream face, teal edge, gold inner line, spiral engravings). */
export function drawPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, s: PanelStyle = {}): void {
  const r = s.radius ?? 26;
  const bw = s.borderWidth ?? 6;
  const shadowOff = s.shadowOffset ?? 10;
  if (s.shadow !== false) {
    g.fillStyle(0x0b2a33, 0.35);
    g.fillRoundedRect(x + 2, y + shadowOff, w, h, r);
  }
  g.fillStyle(s.border ?? COLORS.teal, 1);
  g.fillRoundedRect(x, y, w, h, r);
  g.fillStyle(s.fill ?? COLORS.cream, s.fillAlpha ?? 1);
  g.fillRoundedRect(x + bw, y + bw, w - bw * 2, h - bw * 2, Math.max(4, r - bw));
  g.lineStyle(2, s.accent ?? COLORS.gold, 0.9);
  g.strokeRoundedRect(x + bw + 5, y + bw + 5, w - bw * 2 - 10, h - bw * 2 - 10, Math.max(4, r - bw - 4));
  if (s.engraving !== false && w > 160 && h > 90) {
    const corners: [number, number, number][] = [
      [x + bw + 22, y + bw + 22, 0],
      [x + w - bw - 22, y + bw + 22, Math.PI / 2],
      [x + w - bw - 22, y + h - bw - 22, Math.PI],
      [x + bw + 22, y + h - bw - 22, -Math.PI / 2],
    ];
    g.lineStyle(3, s.border ?? COLORS.teal, 0.28);
    for (const [cx, cy, rot] of corners) drawSpiral(g, cx, cy, 2, 11, 1.6, rot);
  }
}

/** Stroke an Archimedean spiral with the current line style. */
export function drawSpiral(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r0: number, r1: number, turns: number, rot = 0, steps = 36): void {
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = rot + t * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * t;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.strokePath();
}

/** A centred panel container with optional title plaque. */
export class Panel extends Phaser.GameObjects.Container {
  readonly bg: Phaser.GameObjects.Graphics;
  readonly panelWidth: number;
  readonly panelHeight: number;
  titleText?: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: PanelStyle & { title?: string; titleColor?: number } = {}) {
    super(scene, x, y);
    this.panelWidth = w;
    this.panelHeight = h;
    this.bg = scene.add.graphics();
    drawPanel(this.bg, -w / 2, -h / 2, w, h, opts);
    this.add(this.bg);
    if (opts.title) {
      const plaque = scene.add.graphics();
      const tw = Math.min(w - 80, Math.max(260, opts.title.length * 24 + 80));
      drawPanel(plaque, -tw / 2, -h / 2 - 34, tw, 64, { radius: 22, border: opts.titleColor ?? COLORS.tealDark, fill: COLORS.gold, accent: COLORS.cream, engraving: false, shadowOffset: 6 });
      this.add(plaque);
      this.titleText = addText(scene, 0, -h / 2 - 3, opts.title, 34, { color: '#2b2340', weight: 700 });
      this.add(this.titleText);
    }
    scene.add.existing(this);
  }
}
