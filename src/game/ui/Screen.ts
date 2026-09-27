import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { drawSlate } from './Style';

export type SkyVariant = 'day' | 'golden' | 'dusk';

/**
 * Menu-screen backdrop: a rendered sky (vector fallback) with a soft veil so panels read clearly.
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

/** The HUD material as a panel: calm translucent slate, optional flat header band and thin rim. */
export function drawNavyPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, o: NavyPanelOpts = {}): void {
  const r = o.radius ?? 28;
  drawSlate(g, x, y, w, h, { radius: r, alpha: o.alpha ?? 0.82, border: o.border, borderWidth: 3 });
  if (o.header) {
    const hh = o.header.height ?? 70;
    g.fillStyle(o.header.color, 1);
    g.fillRoundedRect(x, y, w, hh, { tl: r, tr: r, bl: 0, br: 0 });
  }
}

/**
 * HUD capsule: a translucent slate pill with a slim player-colour rim. No sheen or bevel, so the
 * portrait and numbers carry the panel.
 */
export function drawCapsule(g: Phaser.GameObjects.Graphics, w: number, h: number, rim: number): void {
  drawSlate(g, 0, 0, w, h, { radius: h / 2, border: rim, borderWidth: 2.5 });
}
