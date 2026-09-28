import Phaser from 'phaser';
import { audio, type SfxKey } from '../audio/AudioManager';
import { COLORS, GAME_WIDTH } from '../constants';
import { settings } from '../save/SettingsManager';
import { drawCard, shade, UI } from './Style';
import { addText } from './theme';

export interface BannerOpts {
  title: string;
  subtitle?: string;
  color?: number;
  hold?: number;
  y?: number;
  size?: number;
  sound?: SfxKey | null;
  depth?: number;
  /** Extra content drawn on the card (e.g. a player badge); gets the card's size. */
  decorate?: (c: Phaser.GameObjects.Container, w: number, h: number) => void;
}

/** A slanted streak (parallelogram) centred on the origin, for the banner's swoosh. */
function streak(g: Phaser.GameObjects.Graphics, w: number, h: number, lean: number, color: number, alpha: number, dy = 0): void {
  g.fillStyle(color, alpha);
  g.fillPoints(
    [
      new Phaser.Math.Vector2(-w / 2 + lean, dy - h / 2),
      new Phaser.Math.Vector2(w / 2 + lean, dy - h / 2),
      new Phaser.Math.Vector2(w / 2 - lean, dy + h / 2),
      new Phaser.Math.Vector2(-w / 2 - lean, dy + h / 2),
    ],
    true,
  );
}

/** A four-pointed glint. */
function glint(g: Phaser.GameObjects.Graphics, r: number, color = 0xffffff): void {
  g.fillStyle(color, 1);
  g.fillPoints(
    [
      new Phaser.Math.Vector2(0, -r),
      new Phaser.Math.Vector2(r * 0.22, -r * 0.22),
      new Phaser.Math.Vector2(r, 0),
      new Phaser.Math.Vector2(r * 0.22, r * 0.22),
      new Phaser.Math.Vector2(0, r),
      new Phaser.Math.Vector2(-r * 0.22, r * 0.22),
      new Phaser.Math.Vector2(-r, 0),
      new Phaser.Math.Vector2(-r * 0.22, -r * 0.22),
    ],
    true,
  );
}

/**
 * Announcement card that pops in at the centre, holds and fades away. A bevelled white card with an
 * ink title, riding a swoosh of the accent colour that sweeps in behind it; the accent also marks a
 * chip above it carrying the subtitle. Resolves when gone.
 */
export function showBanner(scene: Phaser.Scene, o: BannerOpts): Promise<void> {
  const y = o.y ?? 470;
  const size = Math.round((o.size ?? 96) * 0.86);
  const color = o.color ?? COLORS.teal;
  const depth = o.depth ?? 16000;
  const c = scene.add.container(GAME_WIDTH / 2, y).setDepth(depth);
  const title = addText(scene, 0, 4, o.title, size, { color: UI.inkCss, weight: 700, fixed: true });
  const w = Math.max(720, title.width + 220);
  const h = Math.round(size * 1.5);
  const reduced = settings.get().reducedMotion;

  // The swoosh: a wide slanted streak of the accent colour (a lighter one above it) behind the card.
  const swoosh = scene.add.container(GAME_WIDTH / 2, y).setDepth(depth - 1);
  const sg = scene.add.graphics();
  streak(sg, w + 520, h * 0.62, h * 0.22, color, 0.92, h * 0.1);
  streak(sg, w + 380, h * 0.16, h * 0.22, shade(color, 1.25), 0.85, -h * 0.34);
  streak(sg, w + 600, 6, h * 0.22, 0xffffff, 0.6, h * 0.42);
  swoosh.add(sg);

  const g = scene.add.graphics();
  drawCard(g, -w / 2, -h / 2, w, h, { radius: 30, shadow: 1.4, bevel: true });
  // A slim accent bar along the bottom of the face ties the card to its swoosh.
  g.fillStyle(color, 1);
  g.fillRoundedRect(-w / 2 + 40, h / 2 - 12, w - 80, 5, 2.5);
  c.add([g, title]);
  if (o.subtitle) {
    const sub = addText(scene, 0, -h / 2, o.subtitle, 26, { color: UI.whiteCss, weight: 700, fixed: true });
    const cw = sub.width + 56;
    const chip = scene.add.graphics();
    chip.fillStyle(shade(color, 0.72), 1);
    chip.fillRoundedRect(-cw / 2, -h / 2 - 19, cw, 44, 22);
    chip.fillStyle(color, 1);
    chip.fillRoundedRect(-cw / 2, -h / 2 - 22, cw, 44, 22);
    chip.fillStyle(0xffffff, 0.22);
    chip.fillRoundedRect(-cw / 2 + 6, -h / 2 - 19, cw - 12, 14, 7);
    c.add([chip, sub]);
  }
  o.decorate?.(c, w, h);
  // Two glints that twinkle on the card's corners as it lands.
  const glints = [
    { x: -w / 2 + 26, y: -h / 2 + 18, d: 160 },
    { x: w / 2 - 30, y: h / 2 - 20, d: 260 },
  ].map((p) => {
    const gg = scene.add.graphics({ x: p.x, y: p.y });
    glint(gg, 18);
    gg.setScale(0).setAlpha(0.95);
    c.add(gg);
    return { gg, d: p.d };
  });
  if (o.sound !== null) audio.play(o.sound ?? 'eventAlert');
  const hold = o.hold ?? 1100;
  return new Promise((resolve) => {
    c.setAlpha(0);
    if (reduced) {
      swoosh.setAlpha(0);
      scene.tweens.add({ targets: [c, swoosh], alpha: 1, duration: 150 });
    } else {
      c.setScale(0.72).setAngle(-3);
      scene.tweens.add({ targets: c, alpha: 1, scale: 1, angle: 0, duration: 260, ease: 'Back.Out' });
      title.setScale(1.25);
      scene.tweens.add({ targets: title, scale: 1, duration: 300, delay: 80, ease: 'Back.Out' });
      // The swoosh sweeps in from the left, just ahead of the card.
      swoosh.setScale(0.05, 1).setX(GAME_WIDTH / 2 - (w + 520) * 0.45).setAlpha(1);
      scene.tweens.add({ targets: swoosh, scaleX: 1, x: GAME_WIDTH / 2, duration: 220, ease: 'Cubic.Out' });
      for (const { gg, d } of glints) {
        scene.tweens.add({ targets: gg, scale: 1, angle: 90, duration: 220, delay: d, yoyo: true, hold: 60, ease: 'Sine.InOut' });
      }
    }
    scene.time.delayedCall(hold + 260, () => {
      if (!reduced) {
        // Out: the swoosh carries on to the right and thins away.
        scene.tweens.add({ targets: swoosh, x: GAME_WIDTH / 2 + (w + 520) * 0.4, scaleX: 0.1, alpha: 0, duration: 220, ease: 'Cubic.In' });
      } else scene.tweens.add({ targets: swoosh, alpha: 0, duration: 180 });
      scene.tweens.add({
        targets: c,
        alpha: 0,
        scale: reduced ? 1 : 0.96,
        duration: 180,
        ease: 'Quad.In',
        onComplete: () => {
          c.destroy();
          swoosh.destroy();
          resolve();
        },
      });
    });
  });
}
