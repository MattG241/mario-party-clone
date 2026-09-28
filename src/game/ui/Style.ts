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
  /** Secondary text on cards: a softer navy that still reads from the sofa (the grey was too faint). */
  inkSecond: 0x2e3b5e,
  inkSecondCss: '#2e3b5e',
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
  /** Game-UI finish: a light top edge, a soft lower shade and a crisp outline (off by default). */
  bevel?: boolean;
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
  if (o.bevel) bevelFace(g, x, y, w, h, r, fill, o.alpha ?? 1);
  if (o.border !== undefined) {
    const bw = o.borderWidth ?? 4;
    g.lineStyle(bw, o.border, 1);
    g.strokeRoundedRect(x + bw / 2, y + bw / 2, w - bw, h - bw, Math.max(2, r - bw / 2));
  }
}

/** Multiply a colour's channels (k < 1 darkens, > 1 lightens, clamped). */
export function shade(c: number, k: number): number {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
}

/** Mix a colour toward white by t (0..1). */
export function tintToward(c: number, target: number, t: number): number {
  const ch = (s: number) => {
    const a = (c >> s) & 255;
    const b = (target >> s) & 255;
    return Math.round(a + (b - a) * t);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * Stroke the top edge of a rounded rectangle, inset by `inset` (corners included): the light
 * catching a bevel's upper rim.
 */
export function strokeTopEdge(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, r: number, inset: number, width: number, color: number, alpha: number): void {
  const rr = Math.max(1, r - inset);
  g.lineStyle(width, color, alpha);
  g.beginPath();
  g.arc(x + r, y + r, rr, Math.PI * 1.1, Math.PI * 1.5, false);
  g.lineTo(x + w - r, y + inset);
  g.arc(x + w - r, y + r, rr, Math.PI * 1.5, Math.PI * 1.9, false);
  g.strokePath();
}

/** The bevel on a card face: a soft shade over the lower part, a bright top rim and a crisp outline. */
function bevelFace(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number, fill: number, alpha: number): void {
  const lower = Math.max(r, h * 0.42);
  g.fillStyle(shade(fill, 0.9), 0.35 * alpha);
  g.fillRoundedRect(x, y + h - lower, w, lower, { tl: 0, tr: 0, bl: r, br: r });
  strokeTopEdge(g, x, y, w, r, 2.5, 2.5, 0xffffff, 0.75 * alpha);
  g.lineStyle(1.5, shade(fill, 0.62), 0.55 * alpha);
  g.strokeRoundedRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, Math.max(2, r - 0.75));
}

/**
 * A darker band fading down from the top inside edge of an area (under a card's header band),
 * so the face reads as set into the frame rather than printed on it.
 */
export function innerShadow(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, depth = 14, alpha = 0.16): void {
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    g.fillStyle(UI.shadow, (alpha * (steps - i)) / steps / 1.6);
    g.fillRect(x, y + (i * depth) / steps, w, depth / steps);
  }
}

export interface RibbonOpts {
  /** Swallow-tailed ends behind the band (default true). */
  tails?: boolean;
  /** How far each tail sticks out beyond the band. */
  tail?: number;
  /** Drop shadow strength (0 = none). */
  shadow?: number;
  alpha?: number;
}

/**
 * A festival ribbon banner centred on (cx, cy): a bevelled band in front, and swallow-tailed ends
 * folded behind it on either side. Titles sit on the band.
 */
export function drawRibbon(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number, color: number, o: RibbonOpts = {}): void {
  const a = o.alpha ?? 1;
  const L = cx - w / 2;
  const R = cx + w / 2;
  const T = cy - h / 2;
  const B = cy + h / 2;
  const drop = Math.round(h * 0.28);
  const tail = o.tail ?? Math.round(h * 0.95);
  const notch = Math.round(h * 0.34);
  const fold = Math.round(h * 0.42);
  const sh = o.shadow ?? 1;
  if (sh > 0) {
    g.fillStyle(UI.shadow, 0.2 * sh * a);
    g.fillRect(L - (o.tails === false ? 0 : tail) + 4, T + drop + 8, w + (o.tails === false ? 0 : tail * 2) - 8, h);
  }
  if (o.tails !== false) {
    const back = shade(color, 0.74);
    const under = shade(color, 0.52);
    for (const side of [-1, 1]) {
      const edge = side < 0 ? L : R;
      const outer = edge + side * tail;
      const inner = edge - side * fold;
      g.fillStyle(back, a);
      g.fillPoints(
        [
          new Phaser.Math.Vector2(inner, T + drop),
          new Phaser.Math.Vector2(outer, T + drop),
          new Phaser.Math.Vector2(outer - side * notch, cy + drop),
          new Phaser.Math.Vector2(outer, B + drop),
          new Phaser.Math.Vector2(inner, B + drop),
        ],
        true,
      );
      // The fold where the band turns back into its tail.
      g.fillStyle(under, a);
      g.fillTriangle(edge, B, edge - side * fold, B, edge - side * fold, B + drop);
    }
  }
  g.fillStyle(color, a);
  g.fillRect(L, T, w, h);
  // Bevel: a lighter top strip and a darker lower strip, with a bright hairline on top.
  g.fillStyle(0xffffff, 0.16 * a);
  g.fillRect(L, T, w, h * 0.42);
  g.fillStyle(shade(color, 0.8), 0.45 * a);
  g.fillRect(L, B - h * 0.2, w, h * 0.2);
  g.fillStyle(0xffffff, 0.55 * a);
  g.fillRect(L, T + 2, w, 2);
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
