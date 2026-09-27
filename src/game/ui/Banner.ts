import Phaser from 'phaser';
import { audio, type SfxKey } from '../audio/AudioManager';
import { COLORS, GAME_WIDTH } from '../constants';
import { settings } from '../save/SettingsManager';
import { drawCard, UI } from './Style';
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

/**
 * Announcement card that pops in at the centre, holds and fades away. A white card with an ink
 * title; the accent colour marks a slim chip above it carrying the subtitle. Resolves when gone.
 */
export function showBanner(scene: Phaser.Scene, o: BannerOpts): Promise<void> {
  const y = o.y ?? 470;
  const size = Math.round((o.size ?? 96) * 0.86);
  const c = scene.add.container(GAME_WIDTH / 2, y).setDepth(o.depth ?? 16000);
  const title = addText(scene, 0, 4, o.title, size, { color: UI.inkCss, weight: 700, fixed: true });
  const w = Math.max(720, title.width + 220);
  const h = Math.round(size * 1.5);
  const g = scene.add.graphics();
  drawCard(g, -w / 2, -h / 2, w, h, { radius: 30, shadow: 1.4 });
  c.add([g, title]);
  if (o.subtitle) {
    const color = o.color ?? COLORS.teal;
    const sub = addText(scene, 0, -h / 2, o.subtitle, 26, { color: UI.whiteCss, weight: 700, fixed: true });
    const cw = sub.width + 56;
    const chip = scene.add.graphics();
    chip.fillStyle(color, 1);
    chip.fillRoundedRect(-cw / 2, -h / 2 - 22, cw, 44, 22);
    c.add([chip, sub]);
  }
  o.decorate?.(c, w, h);
  if (o.sound !== null) audio.play(o.sound ?? 'eventAlert');
  const reduced = settings.get().reducedMotion;
  const hold = o.hold ?? 1100;
  return new Promise((resolve) => {
    c.setAlpha(0);
    if (!reduced) c.setScale(0.9);
    scene.tweens.add({ targets: c, alpha: 1, scale: 1, duration: reduced ? 150 : 220, ease: 'Back.Out' });
    scene.time.delayedCall(hold + 220, () =>
      scene.tweens.add({
        targets: c,
        alpha: 0,
        scale: reduced ? 1 : 0.96,
        duration: 180,
        ease: 'Quad.In',
        onComplete: () => {
          c.destroy();
          resolve();
        },
      }),
    );
  });
}
