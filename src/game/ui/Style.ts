import Phaser from 'phaser';

/**
 * House UI style: calm, clean surfaces with few accents.
 *  - Cards: warm-white rounded panels with a slim darker lip (they read as solid panels, not web
 *    cards), a soft drop shadow and ink text (menus, info cards).
 *  - Slate: a near-opaque dark pill over gameplay (HUD), white text, no outlines or sheens. It
 *    stays solid enough that busy art behind it never shows through the numbers.
 * Colour is used sparingly: player colours as small accents, gold only for the focused item.
 */
export const UI = {
  card: 0xfffaf1,
  cardSoft: 0xf3f5f9,
  line: 0xdfe4ec,
  ink: 0x1f2940,
  inkCss: '#1f2940',
  inkSoftCss: '#5f6a84',
  slate: 0x121b2b,
  slateAlpha: 0.93,
  shadow: 0x0a1120,
  focus: 0xffc83d,
  focusCss: '#ffc83d',
  whiteCss: '#ffffff',
} as const;

/** A soft drop shadow: stacked translucent rounded rects stand in for a blur. */
export function softShadow(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number, strength = 1): void {
  const layers: [number, number, number][] = [
    [10, 6, 0.05],
    [6, 3, 0.07],
    [3, 1, 0.09],
  ];
  for (const [dy, grow, a] of layers) {
    g.fillStyle(UI.shadow, a * strength);
    g.fillRoundedRect(x - grow, y + dy - grow * 0.5, w + grow * 2, h + grow, Math.min(r + grow, (h + grow) / 2));
  }
}

export interface CardOpts {
  radius?: number;
  fill?: number;
  alpha?: number;
  shadow?: number;
  /** Thin outline (e.g. a player colour or the focus gold). */
  border?: number;
  borderWidth?: number;
}

/** A colour a little darker and warmer (a card's lip). */
function lipOf(c: number): number {
  const k = 0.86;
  const r = ((c >> 16) & 255) * k;
  const gg = ((c >> 8) & 255) * k * 0.98;
  const b = (c & 255) * k * 0.93;
  return (Math.round(r) << 16) | (Math.round(gg) << 8) | Math.round(b);
}

/** Warm-white rounded card with a slim lip and a soft shadow. */
export function drawCard(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, o: CardOpts = {}): void {
  const r = Math.min(o.radius ?? 24, h / 2);
  const fill = o.fill ?? UI.card;
  const lip = Math.max(3, Math.min(6, Math.round(h * 0.06)));
  if ((o.shadow ?? 1) > 0) softShadow(g, x, y + lip, w, h, r, o.shadow ?? 1);
  g.fillStyle(lipOf(fill), o.alpha ?? 1);
  g.fillRoundedRect(x, y + lip, w, h, r);
  g.fillStyle(fill, o.alpha ?? 1);
  g.fillRoundedRect(x, y, w, h, r);
  if (o.border !== undefined) {
    const bw = o.borderWidth ?? 4;
    g.lineStyle(bw, o.border, 1);
    g.strokeRoundedRect(x + bw / 2, y + bw / 2, w - bw, h - bw, Math.max(2, r - bw / 2));
  }
}

export interface SlateOpts {
  radius?: number;
  alpha?: number;
  /** Optional thin accent outline (player colour). */
  border?: number;
  borderWidth?: number;
}

/** Dark HUD surface. */
export function drawSlate(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, o: SlateOpts = {}): void {
  const r = Math.min(o.radius ?? h / 2, h / 2);
  g.fillStyle(UI.shadow, 0.14);
  g.fillRoundedRect(x, y + 4, w, h, r);
  g.fillStyle(UI.slate, o.alpha ?? UI.slateAlpha);
  g.fillRoundedRect(x, y, w, h, r);
  if (o.border !== undefined) {
    const bw = o.borderWidth ?? 3;
    g.lineStyle(bw, o.border, 1);
    g.strokeRoundedRect(x + bw / 2, y + bw / 2, w - bw, h - bw, Math.max(2, r - bw / 2));
  } else {
    g.lineStyle(1.5, 0xffffff, 0.1);
    g.strokeRoundedRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, Math.max(2, r - 0.75));
  }
}

/** Small rounded label chip (e.g. "CPU", a player tag). */
export function drawChip(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number, fill: number, alpha = 1): void {
  g.fillStyle(fill, alpha);
  g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, h / 2);
}
