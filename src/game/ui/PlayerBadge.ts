import Phaser from 'phaser';
import { PLAYER_COLORS, PLAYER_SHAPES, type PlayerShape } from '../constants';
import { addText } from './theme';

/** Fill + outline a player shape centred at (x, y) with "radius" r. */
export function drawPlayerShape(g: Phaser.GameObjects.Graphics, shape: PlayerShape, x: number, y: number, r: number, fill: number, stroke = 0xffffff, strokeWidth = 4): void {
  const pts = shapePoints(shape, x, y, r);
  g.fillStyle(fill, 1);
  g.lineStyle(strokeWidth, stroke, 1);
  if (!pts) {
    g.fillCircle(x, y, r);
    g.strokeCircle(x, y, r);
    return;
  }
  g.fillPoints(pts, true);
  g.strokePoints(pts, true, true);
}

export function shapePoints(shape: PlayerShape, x: number, y: number, r: number): Phaser.Types.Math.Vector2Like[] | null {
  switch (shape) {
    case 'circle':
      return null;
    case 'triangle':
      return [
        { x, y: y - r * 1.12 },
        { x: x + r * 1.05, y: y + r * 0.72 },
        { x: x - r * 1.05, y: y + r * 0.72 },
      ];
    case 'diamond':
      return [
        { x, y: y - r * 1.15 },
        { x: x + r * 0.95, y },
        { x, y: y + r * 1.15 },
        { x: x - r * 0.95, y },
      ];
    case 'hexagon': {
      const out: Phaser.Types.Math.Vector2Like[] = [];
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        out.push({ x: x + Math.cos(a) * r * 1.05, y: y + Math.sin(a) * r * 1.05 });
      }
      return out;
    }
  }
}

/**
 * Colour-independent player identifier: the slot's shape in the slot's colour, with "P1".."P4".
 */
export class PlayerBadge extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number, slot: number, size = 26, opts: { label?: boolean; labelInside?: boolean } = {}) {
    super(scene, x, y);
    const g = scene.add.graphics();
    drawPlayerShape(g, PLAYER_SHAPES[slot], 0, 0, size, PLAYER_COLORS[slot], 0xffffff, Math.max(3, size / 7));
    this.add(g);
    if (opts.label !== false) {
      const t = addText(scene, 0, opts.labelInside === false ? size + 16 : 1, `P${slot + 1}`, Math.max(14, size * 0.72), {
        color: '#ffffff',
        weight: 700,
        fixed: true,
      });
      t.setShadow(0, 1, 'rgba(10,17,32,0.45)', 2, false, true);
      if (PLAYER_SHAPES[slot] === 'triangle' && opts.labelInside !== false) t.setY(size * 0.18);
      this.add(t);
    }
    scene.add.existing(this);
  }
}
