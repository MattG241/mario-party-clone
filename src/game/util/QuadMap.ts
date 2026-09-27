/**
 * Projective map from a logical rectangle onto a screen quadrilateral (corners in TL, TR, BR, BL
 * order). Used to lay flat gameplay coordinates onto a floor rendered in perspective.
 */
export class QuadMap {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private e: number;
  private f: number;
  private g: number;
  private h: number;

  constructor(
    private rect: { x: number; y: number; w: number; h: number },
    quad: [number, number][],
  ) {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const dy3 = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    this.g = (dx3 * dy2 - dx2 * dy3) / den;
    this.h = (dx1 * dy3 - dx3 * dy1) / den;
    this.a = x1 - x0 + this.g * x1;
    this.b = x3 - x0 + this.h * x3;
    this.c = x0;
    this.d = y1 - y0 + this.g * y1;
    this.e = y3 - y0 + this.h * y3;
    this.f = y0;
  }

  /** Screen position of a logical point. */
  point(x: number, y: number): { x: number; y: number } {
    const u = (x - this.rect.x) / this.rect.w;
    const v = (y - this.rect.y) / this.rect.h;
    const w = this.g * u + this.h * v + 1;
    return { x: (this.a * u + this.b * v + this.c) / w, y: (this.d * u + this.e * v + this.f) / w };
  }

  /** Screen pixels per logical pixel (horizontally) at a logical point: the depth scale. */
  scaleAt(x: number, y: number): number {
    const p0 = this.point(x - 10, y);
    const p1 = this.point(x + 10, y);
    return Math.hypot(p1.x - p0.x, p1.y - p0.y) / 20;
  }
}
