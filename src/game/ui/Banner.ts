import Phaser from 'phaser';
import { audio, type SfxKey } from '../audio/AudioManager';
import { COLORS, CSS, GAME_WIDTH } from '../constants';
import { settings } from '../save/SettingsManager';
import { drawSpiral } from './Panel';
import { addText, addTitle } from './theme';

export interface BannerOpts {
  title: string;
  subtitle?: string;
  color?: number;
  hold?: number;
  y?: number;
  size?: number;
  sound?: SfxKey | null;
  depth?: number;
  /** Extra content drawn on the ribbon (e.g. a player badge). */
  decorate?: (c: Phaser.GameObjects.Container) => void;
}

/** Ribbon banner that sweeps in, holds, and sweeps out. Resolves when gone. */
export function showBanner(scene: Phaser.Scene, o: BannerOpts): Promise<void> {
  const y = o.y ?? 470;
  const size = o.size ?? 96;
  const c = scene.add.container(GAME_WIDTH / 2, y).setDepth(o.depth ?? 16000);
  const h = size * 1.55 + (o.subtitle ? 44 : 0);
  const w = GAME_WIDTH + 200;
  const g = scene.add.graphics();
  const color = o.color ?? COLORS.teal;
  g.fillStyle(0x0b1a24, 0.35);
  g.fillRect(-w / 2, -h / 2 + 12, w, h);
  g.fillStyle(color, 0.96);
  g.fillRect(-w / 2, -h / 2, w, h);
  g.fillStyle(0xffffff, 0.14);
  g.fillRect(-w / 2, -h / 2, w, h * 0.3);
  g.lineStyle(5, COLORS.gold, 1);
  g.lineBetween(-w / 2, -h / 2 + 8, w / 2, -h / 2 + 8);
  g.lineBetween(-w / 2, h / 2 - 8, w / 2, h / 2 - 8);
  g.lineStyle(4, 0xffffff, 0.22);
  for (let x = -w / 2 + 80; x < w / 2; x += 260) drawSpiral(g, x, 0, 3, h * 0.28, 1.8, 0);
  c.add(g);
  const title = addTitle(scene, 0, o.subtitle ? 18 : 0, o.title, size);
  c.add(title);
  if (o.subtitle) {
    const sub = addText(scene, 0, -h / 2 + 38, o.subtitle, 38, { color: CSS.goldLight, stroke: '#1b1530', strokeThickness: 6, weight: 700 });
    c.add(sub);
  }
  o.decorate?.(c);
  if (o.sound !== null) audio.play(o.sound ?? 'eventAlert');
  const reduced = settings.get().reducedMotion;
  const hold = o.hold ?? 1100;
  return new Promise((resolve) => {
    if (reduced) {
      c.setAlpha(0);
      scene.tweens.add({ targets: c, alpha: 1, duration: 150 });
      scene.time.delayedCall(hold + 150, () =>
        scene.tweens.add({
          targets: c,
          alpha: 0,
          duration: 150,
          onComplete: () => {
            c.destroy();
            resolve();
          },
        }),
      );
      return;
    }
    c.x = -GAME_WIDTH;
    title.setScale(0.6);
    scene.tweens.add({ targets: c, x: GAME_WIDTH / 2, duration: 380, ease: 'Back.Out' });
    scene.tweens.add({ targets: title, scale: 1, delay: 180, duration: 320, ease: 'Back.Out' });
    scene.time.delayedCall(380 + hold, () =>
      scene.tweens.add({
        targets: c,
        x: GAME_WIDTH * 2,
        duration: 320,
        ease: 'Back.In',
        onComplete: () => {
          c.destroy();
          resolve();
        },
      }),
    );
  });
}
