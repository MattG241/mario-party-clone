import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { liteSvgDivisor } from '../perf';
import { drawSlate, strokeTopEdge } from './Style';

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

/** A tiled backdrop strip (clouds, far islands). Lite loads that art at half size, so it tiles at double scale. */
export function addStrip(scene: Phaser.Scene, x: number, y: number, w: number, h: number, key: string): Phaser.GameObjects.TileSprite {
  const strip = scene.add.tileSprite(x, y, w, h, key);
  const d = liteSvgDivisor(key);
  if (d !== 1) strip.setTileScale(d);
  return strip;
}

export interface NavyPanelOpts {
  radius?: number;
  border?: number;
  alpha?: number;
  /** Optional coloured header band with a title. */
  header?: { color: number; height?: number };
  /** Game-UI finish: a faint top gloss and a light hairline inside the top edge (off by default). */
  gloss?: boolean;
}

/** The HUD material as a panel: calm dark slate, optional flat header band and thin rim. */
export function drawNavyPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, o: NavyPanelOpts = {}): void {
  const r = o.radius ?? 28;
  drawSlate(g, x, y, w, h, { radius: r, alpha: o.alpha ?? 0.9, border: o.border, borderWidth: 3 });
  if (o.gloss) {
    g.fillStyle(0xffffff, 0.045);
    g.fillRoundedRect(x + 3, y + 3, w - 6, Math.min(h * 0.4, 220), { tl: r - 3, tr: r - 3, bl: 0, br: 0 });
  }
  if (o.header) {
    const hh = o.header.height ?? 70;
    g.fillStyle(o.header.color, 1);
    g.fillRoundedRect(x, y, w, hh, { tl: r, tr: r, bl: 0, br: 0 });
    if (o.gloss) {
      g.fillStyle(0xffffff, 0.14);
      g.fillRoundedRect(x, y, w, hh * 0.45, { tl: r, tr: r, bl: 0, br: 0 });
      g.fillStyle(0x000000, 0.12);
      g.fillRect(x, y + hh - 4, w, 4);
    }
  }
  if (o.gloss) strokeTopEdge(g, x, y, w, r, 3, 1.5, 0xffffff, 0.3);
}

/**
 * HUD capsule: a translucent slate pill with a slim player-colour rim. No sheen or bevel, so the
 * portrait and numbers carry the panel.
 */
export function drawCapsule(g: Phaser.GameObjects.Graphics, w: number, h: number, rim: number): void {
  drawSlate(g, 0, 0, w, h, { radius: h / 2, border: rim, borderWidth: 2.5 });
}

/**
 * The capsule with a game-UI finish: the same slate pill and player-colour rim, plus a faint gloss
 * over its top half and a light hairline inside the top edge (the board HUD's panels).
 */
export function drawGlossCapsule(g: Phaser.GameObjects.Graphics, w: number, h: number, rim: number, rimWidth = 2.5): void {
  drawSlate(g, 0, 0, w, h, { radius: h / 2, border: rim, borderWidth: rimWidth });
  const r = h / 2;
  // A fully rounded highlight inset from the ends, so it stays inside the pill's curves (Phaser
  // doesn't clamp corner radii, so a strip following the pill's own radius would poke out).
  const gh = h * 0.36;
  g.fillStyle(0xffffff, 0.07);
  g.fillRoundedRect(h * 0.25, 6, w - h * 0.5, gh, gh / 2);
  strokeTopEdge(g, 0, 0, w, r, rimWidth + 3, 1.5, 0xffffff, 0.22);
}
