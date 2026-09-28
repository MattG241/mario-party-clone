import Phaser from 'phaser';
import { settings } from '../save/SettingsManager';
import { addTitle, GOLD_STOPS, setGradientFill } from './theme';

export interface LockupOpts {
  size: number;
  /** Solid fill instead of the festival gold gradient. */
  color?: string;
  stops?: [number, string][];
  /** Extra space between letters (px). */
  tracking?: number;
}

/**
 * A big display title built letter by letter, so it can drop in with a stagger and ripple now and
 * then: the bespoke lockup for minigame names and winners. Letters are ordinary title texts (the
 * house outline and shadow), centred on the container's origin.
 */
export class TitleLockup extends Phaser.GameObjects.Container {
  readonly letters: Phaser.GameObjects.Text[] = [];
  /** Where each letter rests (animations always return here, never to wherever it happens to be). */
  private readonly restY: number[] = [];
  readonly lockWidth: number;
  readonly lockHeight: number;
  private waveTimer?: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, x: number, y: number, text: string, o: LockupOpts) {
    super(scene, x, y);
    const size = o.size;
    const track = o.tracking ?? Math.round(size * 0.02);
    const space = Math.round(size * 0.3);
    const parts = [...text].map((ch) => {
      if (ch === ' ') return null;
      const t = addTitle(scene, 0, 0, ch, size, o.color ?? '#ffffff');
      if (!o.color) setGradientFill(t, o.stops ?? GOLD_STOPS);
      return t;
    });
    // Neighbouring outlines would double up: advance by the glyph width less its stroke.
    const adv = (t: Phaser.GameObjects.Text | null) => (t ? t.width - (t.style.strokeThickness || 0) : space);
    let total = 0;
    parts.forEach((t, i) => (total += adv(t) + (i < parts.length - 1 ? track : 0)));
    let cx = -total / 2;
    let hMax = 0;
    for (const t of parts) {
      const a = adv(t);
      if (t) {
        t.setPosition(cx + a / 2, 0);
        this.letters.push(t);
        this.restY.push(0);
        this.add(t);
        hMax = Math.max(hMax, t.height);
      }
      cx += a + track;
    }
    this.lockWidth = total;
    this.lockHeight = hMax;
    scene.add.existing(this);
  }

  /** Letters drop in one after another and settle with a bounce. Resolves once all have landed. */
  play(delay = 0, stagger = 38): Promise<void> {
    const scene = this.scene;
    const reduced = settings.get().reducedMotion;
    return new Promise((resolve) => {
      if (reduced) {
        this.setAlpha(0);
        scene.tweens.add({ targets: this, alpha: 1, duration: 180, delay, onComplete: () => resolve() });
        return;
      }
      const drop = this.lockHeight * 0.9;
      this.letters.forEach((t, i) => {
        const y0 = this.restY[i];
        scene.tweens.killTweensOf(t);
        t.setAlpha(0).setY(y0 - drop).setScale(1.5, 1.7);
        scene.tweens.add({ targets: t, alpha: 1, duration: 90, delay: delay + i * stagger });
        scene.tweens.add({
          targets: t,
          y: y0,
          scaleX: 1,
          scaleY: 1,
          duration: 340,
          delay: delay + i * stagger,
          ease: 'Back.Out',
          onComplete: i === this.letters.length - 1 ? () => resolve() : undefined,
        });
      });
      if (this.letters.length === 0) resolve();
    });
  }

  /** A ripple running along the letters (each hops and swells a little in turn). */
  wave(stagger = 45): void {
    if (settings.get().reducedMotion) return;
    const tw = this.scene.tweens;
    // Never ripple over another animation (it would come to rest somewhere else).
    if (this.letters.some((t) => tw.isTweening(t))) return;
    this.letters.forEach((t, i) => {
      const y0 = this.restY[i];
      t.setY(y0).setScale(1);
      tw.add({ targets: t, scaleX: 1.14, scaleY: 1.14, y: y0 - this.lockHeight * 0.08, duration: 140, delay: i * stagger, yoyo: true, ease: 'Sine.Out', onComplete: () => t.setY(y0).setScale(1) });
    });
  }

  /** Ripple every `ms` while the lockup lives. */
  waveEvery(ms: number, first = ms): void {
    this.waveTimer?.remove();
    this.scene.time.delayedCall(first, () => {
      if (!this.active) return;
      this.wave();
      this.waveTimer = this.scene.time.addEvent({ delay: ms, loop: true, callback: () => this.active && this.wave() });
    });
  }

  override destroy(fromScene?: boolean): void {
    this.waveTimer?.remove();
    this.scene?.tweens.killTweensOf(this.letters);
    super.destroy(fromScene);
  }
}
