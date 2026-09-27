import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import type { Character } from '../characters/Character';
import { CSS, DEPTH, DIAL_MAX, GAME_HEIGHT, GAME_WIDTH } from '../constants';
import type { EffectsManager } from '../effects/EffectsManager';
import type { Controls } from '../input/Controls';
import { addText } from '../ui/theme';
import { setDebugInfo } from '../debug/debug';

/**
 * The Orbit Dial: Gleamtrail's movement device. It hovers above the active character, cycles
 * through 1–10, and slows down with suspense onto the result when stopped. The result itself
 * comes from the match RNG, so stopping earlier or later never changes fairness.
 */
export class OrbitDial {
  constructor(
    private scene: Phaser.Scene,
    private fx: EffectsManager,
  ) {}

  async spin(token: Character, result: number, bonus: number, opts: { controls?: Controls; cpuDelay: number; waitForInput: (c: Controls) => Promise<boolean>; fast: boolean }): Promise<void> {
    const s = this.scene;
    const x = token.x;
    const y = token.y - 300;
    const root = s.add.container(x, y).setDepth(DEPTH.worldUi + 50);
    // The hovering dial casts a soft shadow on the ground at the hero's feet.
    const shadow = s.add.image(24, 318, 'fx-shadow').setScale(2.8, 0.7).setAlpha(0.6);
    // The world dims around the hero while the dial spins (a spotlight centred on the screen).
    const dim = s.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'fx-spot').setScrollFactor(0).setDisplaySize(GAME_WIDTH * 1.5, GAME_HEIGHT * 1.5).setDepth(DEPTH.worldUi + 40).setAlpha(0);
    s.tweens.add({ targets: dim, alpha: 1, duration: 300 });
    const rendered = s.textures.exists('rendered-ui-dial');
    const ring = rendered ? s.add.image(0, 0, 'rendered-ui-dial').setDisplaySize(236, 236) : s.add.image(0, 0, 'orbit-dial').setScale(0.52);
    // A darker copy just below reads as the medallion's thickness (a coin edge), not a flat decal.
    const edge = s.add.image(0, 10, ring.texture.key).setDisplaySize(ring.displayWidth, ring.displayHeight).setTint(0x6a4a1c);
    const num = addText(s, 0, -4, '1', 108, { color: '#1f2940', weight: 700, fixed: true });
    root.add([shadow, edge, ring, num]);
    root.setScale(0.1);
    token.play('dial');
    audio.play('pop', { rate: 0.8 });
    await new Promise<void>((r) => s.tweens.add({ targets: root, scale: 1, duration: 320, ease: 'Back.Out', onComplete: () => r() }));
    setDebugInfo('dialShown', true);
    const spinTween = s.tweens.add({ targets: [ring, edge], angle: 360, duration: 900, repeat: -1 });
    let value = 1;
    let acc = 0;
    let interval = 55;
    let stopping = false;
    let stepsLeft = -1;
    let finished = false;
    const tick = (dt: number) => {
      if (finished) return;
      acc += dt;
      while (acc >= interval && !finished) {
        acc -= interval;
        value = (value % DIAL_MAX) + 1;
        num.setText(String(value));
        audio.play('dialTick', { rate: stopping ? 0.9 : 1.1, throttleMs: 20 });
        if (stopping) {
          stepsLeft--;
          interval *= 1.22;
          num.setScale(1.12);
          s.tweens.add({ targets: num, scale: 1, duration: Math.min(160, interval * 0.8) });
          if (stepsLeft <= 0) finished = true;
        }
      }
    };
    const onUpdate = (_t: number, dt: number) => tick(dt);
    s.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    const stopListener = () => s.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    // Wait for the stop press (or CPU reaction time).
    if (opts.controls) await opts.waitForInput(opts.controls);
    else await new Promise<void>((r) => s.time.delayedCall(opts.cpuDelay, () => r()));
    // Slow down so we land exactly on the result after a few more numbers.
    stopping = true;
    const extra = opts.fast ? 4 : 7;
    let dist = (result - value + DIAL_MAX) % DIAL_MAX;
    while (dist < extra) dist += DIAL_MAX;
    stepsLeft = dist;
    interval = opts.fast ? 45 : 60;
    // Fastest path when the tick would take too long.
    const maxTicks = opts.fast ? 10 : 14;
    if (dist > maxTicks) {
      value = ((result - maxTicks - 1 + DIAL_MAX * 3) % DIAL_MAX) + 1;
      stepsLeft = maxTicks;
    }
    await new Promise<void>((r) => {
      const check = s.time.addEvent({
        delay: 16,
        loop: true,
        callback: () => {
          if (finished) {
            check.remove();
            r();
          }
        },
      });
    });
    stopListener();
    spinTween.stop();
    num.setText(String(result)).setColor(CSS.goldDark);
    audio.play('dialStop');
    this.fx.sparks(x, y, 26);
    this.fx.vfx('impact', x, y, { scale: 0.7, blend: 'add', alpha: 0.9 });
    s.tweens.add({ targets: num, scale: { from: 1.7, to: 1.15 }, duration: 380, ease: 'Back.Out' });
    s.tweens.add({ targets: ring, scaleX: ring.scaleX * 1.15, scaleY: ring.scaleY * 1.15, duration: 200, yoyo: true });
    token.play('jump');
    await new Promise<void>((r) => s.time.delayedCall(opts.fast ? 420 : 700, () => r()));
    if (bonus > 0) {
      const plus = addText(s, 150, -80, `+${bonus}`, 72, { color: CSS.coral, weight: 700, stroke: '#ffffff', strokeThickness: 10, fixed: true });
      root.add(plus);
      plus.setScale(0.2);
      audio.play('itemUse');
      await new Promise<void>((r) => s.tweens.add({ targets: plus, scale: 1, duration: 260, ease: 'Back.Out', onComplete: () => r() }));
      await new Promise<void>((r) => s.tweens.add({ targets: plus, x: 0, y: 0, alpha: 0, scale: 0.4, delay: 250, duration: 300, ease: 'Quad.In', onComplete: () => r() }));
      num.setText(String(result + bonus));
      audio.play('chipGain');
      s.tweens.add({ targets: num, scale: { from: 1.6, to: 1.15 }, duration: 300, ease: 'Back.Out' });
      await new Promise<void>((r) => s.time.delayedCall(350, () => r()));
    }
    token.play('celebrate');
    setDebugInfo('dialShown', false);
    s.tweens.add({ targets: dim, alpha: 0, duration: 320, onComplete: () => dim.destroy() });
    await new Promise<void>((r) =>
      s.tweens.add({
        targets: root,
        scale: 0.2,
        alpha: 0,
        y: y + 120,
        duration: 260,
        ease: 'Back.In',
        onComplete: () => {
          root.destroy();
          r();
        },
      }),
    );
  }
}
