import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';

export type SkyVariant = 'day' | 'golden' | 'dusk';

/**
 * Menu-screen backdrop: a rendered sky (vector fallback) with a soft navy veil so the navy/gold
 * panels read clearly.
 */
export function buildBackdrop(scene: Phaser.Scene, sky: SkyVariant = 'golden', veil = 0.35): void {
  const keys = [`rendered-sky-${sky}`, 'rendered-sky-day', 'rendered-sky-golden'];
  const key = keys.find((k) => scene.textures.exists(k));
  if (key) scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, key).setDisplaySize(GAME_WIDTH * 1.04, GAME_HEIGHT * 1.04);
  else scene.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
  if (veil > 0) {
    const g = scene.add.graphics();
    g.fillGradientStyle(0x0a2230, 0x0a2230, 0x06141a, 0x06141a, veil * 0.6, veil * 0.6, veil, veil);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  }
}

export interface NavyPanelOpts {
  radius?: number;
  border?: number;
  alpha?: number;
  /** Optional coloured header band with a title. */
  header?: { color: number; height?: number };
}

/** The HUD material as a panel: translucent navy, soft sheen, coloured rim, drop shadow. */
export function drawNavyPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, o: NavyPanelOpts = {}): void {
  const r = o.radius ?? 28;
  g.fillStyle(0x06141a, 0.3);
  g.fillRoundedRect(x + 5, y + 8, w, h, r);
  g.fillStyle(0x0c2630, o.alpha ?? 0.88);
  g.fillRoundedRect(x, y, w, h, r);
  if (o.header) {
    const hh = o.header.height ?? 70;
    g.fillStyle(o.header.color, 1);
    g.fillRoundedRect(x, y, w, hh, { tl: r, tr: r, bl: 0, br: 0 });
    g.fillStyle(0xffffff, 0.16);
    g.fillRoundedRect(x + 10, y + 6, w - 20, hh * 0.38, { tl: r - 6, tr: r - 6, bl: 6, br: 6 });
  } else {
    g.fillStyle(0xffffff, 0.06);
    g.fillRoundedRect(x + 10, y + 7, w - 20, Math.min(60, h * 0.3), { tl: r - 6, tr: r - 6, bl: 8, br: 8 });
  }
  g.lineStyle(4, o.border ?? 0xf2c14e, 1);
  g.strokeRoundedRect(x, y, w, h, r);
}

/**
 * HUD capsule: drop shadow, a darker base that shows as a bevel along the bottom, a glossy top and
 * a rim in the player's colour with a faint inner highlight (reads as a physical pill, not a flat one).
 */
export function drawCapsule(g: Phaser.GameObjects.Graphics, w: number, h: number, rim: number): void {
  const r = h / 2;
  g.fillStyle(0x06141a, 0.32);
  g.fillRoundedRect(4, 8, w, h, r);
  g.fillStyle(0x05161d, 0.94);
  g.fillRoundedRect(0, 0, w, h, r);
  g.fillStyle(0x0f2d3a, 0.92);
  g.fillRoundedRect(1, 1, w - 2, h - 8, (h - 8) / 2);
  g.fillStyle(0xffffff, 0.1);
  g.fillRoundedRect(10, 5, w - 20, h * 0.36, { tl: r - 8, tr: r - 8, bl: 8, br: 8 });
  g.lineStyle(4, rim, 1);
  g.strokeRoundedRect(0, 0, w, h, r);
  g.lineStyle(1.5, 0xfff4dc, 0.28);
  g.strokeRoundedRect(5, 5, w - 10, h - 10, r - 5);
}
