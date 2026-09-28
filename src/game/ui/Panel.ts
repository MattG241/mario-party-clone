import Phaser from 'phaser';
import { drawCard, drawRibbon, shade, UI } from './Style';
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
  /** Game-UI bevel on the card (off by default). */
  bevel?: boolean;
}

/** Draw a Gleamtrail card: soft white face and shadow; a thin rim only when a colour is given. */
export function drawPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, s: PanelStyle = {}): void {
  drawCard(g, x, y, w, h, {
    radius: s.radius ?? 26,
    fill: s.fill ?? UI.card,
    alpha: s.fillAlpha ?? 1,
    shadow: s.shadow === false ? 0 : 1,
    border: s.border,
    borderWidth: s.border !== undefined ? Math.min(4, s.borderWidth ?? 4) : undefined,
    bevel: s.bevel,
  });
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

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: PanelStyle & { title?: string; titleColor?: number; ribbon?: number } = {}) {
    super(scene, x, y);
    this.panelWidth = w;
    this.panelHeight = h;
    this.bg = scene.add.graphics();
    drawPanel(this.bg, -w / 2, -h / 2, w, h, opts);
    this.add(this.bg);
    if (opts.title && opts.ribbon !== undefined) {
      // Title on a festival ribbon across the card's top edge, its tails folded behind.
      const rib = scene.add.graphics();
      this.titleText = addText(scene, 0, -h / 2 + 2, opts.title, 30, { color: UI.whiteCss, weight: 700 }).setShadow(0, 3, `#${shade(opts.ribbon, 0.4).toString(16).padStart(6, '0')}`, 0, false, true);
      drawRibbon(rib, 0, -h / 2 + 2, Math.min(w - 60, this.titleText.width + 120), 56, opts.ribbon, { tail: 38 });
      this.add([rib, this.titleText]);
    } else if (opts.title) {
      // Title on a slim ink tab straddling the card's top edge.
      const plaque = scene.add.graphics();
      const tw = Math.min(w - 80, Math.max(240, opts.title.length * 22 + 70));
      plaque.fillStyle(opts.titleColor ?? UI.ink, 1);
      plaque.fillRoundedRect(-tw / 2, -h / 2 - 28, tw, 56, 28);
      this.add(plaque);
      this.titleText = addText(scene, 0, -h / 2, opts.title, 30, { color: UI.whiteCss, weight: 700 });
      this.add(this.titleText);
    }
    scene.add.existing(this);
  }
}
