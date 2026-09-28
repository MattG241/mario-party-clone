import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import type { Character } from '../characters/Character';
import { CSS, DEPTH, DIAL_MAX, GAME_HEIGHT, GAME_WIDTH } from '../constants';
import type { EffectsManager } from '../effects/EffectsManager';
import type { Controls } from '../input/Controls';
import { lerpColor } from './DayCycle';
import { punch } from '../minigames/juice';
import { LITE } from '../perf';
import { addText } from '../ui/theme';
import { setDebugInfo } from '../debug/debug';

/** Tick interval (ms) at which the number reads as a blur rather than a count. */
const BLUR_BELOW = 85;

/**
 * The Orbit Dial: Gleamtrail's movement device. It hovers above the active character, cycles
 * through 1–10, and slows down with suspense onto the result when stopped. The result itself
 * comes from the match RNG, so stopping earlier or later never changes fairness.
 *
 * It is staged as an event: the world dims to a spotlight, the medallion glows in the player's
 * colour with slow rays behind it, numbers roll past like a slot reel (blurred while fast), a
 * drumroll rides the slowdown, and the result slams in with a shockwave and a camera punch.
 */
export class OrbitDial {
  constructor(
    private scene: Phaser.Scene,
    private fx: EffectsManager,
  ) {}

  async spin(
    token: Character,
    result: number,
    bonus: number,
    opts: { controls?: Controls; cpuDelay: number; waitForInput: (c: Controls) => Promise<boolean>; fast: boolean; color: number },
  ): Promise<void> {
    const s = this.scene;
    const x = token.x;
    const lift = 262;
    const y = token.y - lift;
    const root = s.add.container(x, y).setDepth(DEPTH.worldUi + 50);
    // The hovering dial casts a soft shadow on the ground at the hero's feet.
    const shadow = s.add.image(20, lift + 16, 'fx-shadow').setScale(2.1, 0.55).setAlpha(0.55);
    // A pointer in the player's colour ties the dial to its hero.
    const tail = s.add.graphics();
    tail.fillStyle(0xffffff, 1);
    tail.fillTriangle(-24, 78, 24, 78, 0, 112);
    tail.fillStyle(opts.color, 1);
    tail.fillTriangle(-16, 80, 16, 80, 0, 104);
    // The world dims around the hero while the dial spins (a spotlight centred on the screen).
    const dim = s.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'fx-spot').setScrollFactor(0).setDisplaySize(GAME_WIDTH * 1.18, GAME_HEIGHT * 1.18).setDepth(DEPTH.worldUi + 40).setAlpha(0);
    s.tweens.add({ targets: dim, alpha: 1, duration: 300 });
    // A pool of light in the player's colour under the hero's feet (under the hero, over the ground).
    const pool = s.add.image(x, token.y + 4, 'fx-dot').setTint(opts.color).setBlendMode(Phaser.BlendModes.ADD).setDepth(token.depth - 0.5).setScale(7.5, 2.4).setAlpha(0);
    s.tweens.add({ targets: pool, alpha: 0.75, duration: 300 });
    s.tweens.add({ targets: pool, scaleX: 8.4, scaleY: 2.7, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    // Behind the medallion: a glow in the player's colour and slow rays, so it reads as a lit event.
    // (Two halo layers: a wide soft bloom and a tighter bright core, strong enough to read on the
    // sunlit board.)
    const light = lerpColor(opts.color, 0xffffff, 0.35);
    const bloom = s.add.image(0, 0, 'fx-dot').setTint(opts.color).setBlendMode(Phaser.BlendModes.ADD).setScale(18).setAlpha(0.6);
    const halo = s.add.image(0, 0, 'fx-dot').setTint(light).setBlendMode(Phaser.BlendModes.ADD).setScale(12).setAlpha(0.85);
    const rays = s.add.image(0, 0, s.textures.exists('fx-rays') ? 'fx-rays' : 'fx-dot').setTint(light).setBlendMode(Phaser.BlendModes.ADD).setScale(0.9).setAlpha(0.75);
    const rendered = s.textures.exists('rendered-ui-dial');
    const ring = rendered ? s.add.image(0, 0, 'rendered-ui-dial').setDisplaySize(180, 180) : s.add.image(0, 0, 'orbit-dial').setScale(0.4);
    // A darker copy just below reads as the medallion's thickness (a coin edge), not a flat decal.
    const edge = s.add.image(0, 8, ring.texture.key).setDisplaySize(ring.displayWidth, ring.displayHeight).setTint(0x6a4a1c);
    // Player-colour rim round the medallion.
    const rim = s.add.graphics();
    rim.fillStyle(0x0a1120, 0.18);
    rim.fillCircle(0, 8, 102);
    rim.fillStyle(0xffffff, 1);
    rim.fillCircle(0, 0, 100);
    rim.fillStyle(opts.color, 1);
    rim.fillCircle(0, 0, 95);
    // The number face: the current number plus a ghost of the last one rolling away (slot reel),
    // clipped to the medallion's face so the roll never spills over the rim.
    const num = addText(s, 0, -3, '1', 84, { color: '#1f2940', weight: 700, fixed: true });
    const ghost = addText(s, 0, -3, '', 84, { color: '#1f2940', weight: 700, fixed: true }).setAlpha(0);
    const face = s.make.graphics({ x: 0, y: 0 }, false);
    face.fillStyle(0xffffff, 1);
    face.fillCircle(0, 0, 64);
    const mask = face.createGeometryMask();
    // The mask follows the root: it is drawn in world space, so keep it on the dial's centre.
    const syncMask = () => face.setPosition(root.x, root.y).setScale(root.scaleX, root.scaleY);
    num.setMask(mask);
    ghost.setMask(mask);
    root.add([shadow, tail, bloom, halo, rays, rim, edge, ring, ghost, num]);
    root.setScale(0.1);
    syncMask();
    token.play('dial');
    audio.play('pop', { rate: 0.8 });
    s.tweens.add({ targets: halo, scale: { from: 11, to: 13.5 }, alpha: { from: 0.7, to: 0.9 }, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    s.tweens.add({ targets: bloom, scale: { from: 16, to: 20 }, duration: 780, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    await new Promise<void>((r) => s.tweens.add({ targets: root, scale: 1, duration: 320, ease: 'Back.Out', onUpdate: syncMask, onComplete: () => r() }));
    setDebugInfo('dialShown', true);
    let value = 1;
    let acc = 0;
    let interval = 55;
    let stopping = false;
    let stepsLeft = -1;
    let finished = false;
    /** 0 → 1 through the roll of the newest number into place. */
    let roll = 1;
    const tick = (dt: number) => {
      if (finished) return;
      acc += dt;
      // The ring turns with the count: fast while spinning freely, winding down with the numbers.
      ring.angle += dt * 0.42 * (55 / interval);
      edge.angle = ring.angle;
      rays.angle += dt * 0.02 * (55 / interval);
      while (acc >= interval && !finished) {
        acc -= interval;
        ghost.setText(num.text);
        value = (value % DIAL_MAX) + 1;
        num.setText(String(value));
        roll = 0;
        audio.play('dialTick', { rate: stopping ? 0.9 : 1.1, throttleMs: 20 });
        if (stopping) {
          stepsLeft--;
          interval *= 1.22;
          if (stepsLeft <= 0) finished = true;
        }
      }
      // Slot-reel roll: the new number drops in from above while the old one falls away. While
      // the numbers fly past they smear (stretched, softer); as the dial slows they sharpen.
      roll = Math.min(1, roll + dt / Math.max(40, interval * 0.8));
      const e = 1 - (1 - roll) * (1 - roll);
      const blur = interval < BLUR_BELOW ? 1 : 0;
      num.setY(-3 - 44 * (1 - e));
      num.setScale(1, 1 + blur * 0.28 * (1 - e * 0.5));
      num.setAlpha(blur ? 0.78 : 1);
      ghost.setY(-3 + 50 * e);
      ghost.setScale(1, 1 + blur * 0.28);
      ghost.setAlpha((1 - e) * (blur ? 0.5 : 0.7));
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
    // A drumroll rides the slowdown.
    audio.play('drumroll', { volume: 0.7 });
    s.tweens.add({ targets: rays, alpha: 0.95, scale: 1.02, duration: 700, ease: 'Sine.In' });
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
    ghost.setAlpha(0);
    num.setText(String(result)).setColor(CSS.goldDark).setY(-3).setAlpha(1).setScale(2.3);
    // The slam: a beat of stillness with the number blown up, then it crashes into the face.
    await new Promise<void>((r) => s.time.delayedCall(opts.fast ? 50 : 90, () => r()));
    audio.play('dialStop');
    audio.play('cymbal', { volume: 0.55 });
    this.fx.sparks(x, y, LITE ? 18 : 30);
    this.fx.shake(0.005, 150);
    punch(s, 0.06, 280);
    // A clean white shockwave ring off the medallion, and one in the player's colour behind it.
    const wave = s.add.image(x, y, 'fx-target').setDepth(DEPTH.worldUi + 49).setDisplaySize(200, 200).setAlpha(0.95);
    s.tweens.add({ targets: wave, displayWidth: 480, displayHeight: 480, alpha: 0, duration: 420, ease: 'Quad.Out', onComplete: () => wave.destroy() });
    const wave2 = s.add.image(x, y, 'fx-ring').setTint(opts.color).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.worldUi + 48).setDisplaySize(220, 220).setAlpha(1);
    s.tweens.add({ targets: wave2, displayWidth: 640, displayHeight: 640, alpha: 0, duration: 560, ease: 'Cubic.Out', onComplete: () => wave2.destroy() });
    s.tweens.add({ targets: num, scale: 1.15, duration: 200, ease: 'Back.Out' });
    // The medallion itself takes the hit: squashes flat and springs back.
    s.tweens.add({ targets: root, scaleX: 1.14, scaleY: 0.84, duration: 70, yoyo: true, ease: 'Quad.Out', onUpdate: syncMask });
    s.tweens.add({ targets: rays, scale: 1.4, alpha: 1, duration: 140, yoyo: true, hold: 120, ease: 'Quad.Out' });
    s.tweens.add({ targets: halo, alpha: 1, duration: 120, yoyo: true });
    token.play('jump');
    await new Promise<void>((r) => s.time.delayedCall(opts.fast ? 420 : 700, () => r()));
    if (bonus > 0) {
      const plus = addText(s, 124, -66, `+${bonus}`, 64, { color: CSS.coral, weight: 700, stroke: '#ffffff', strokeThickness: 10, fixed: true });
      root.add(plus);
      plus.setScale(0.2);
      audio.play('itemUse');
      await new Promise<void>((r) => s.tweens.add({ targets: plus, scale: 1, duration: 260, ease: 'Back.Out', onComplete: () => r() }));
      await new Promise<void>((r) => s.tweens.add({ targets: plus, x: 0, y: 0, alpha: 0, scale: 0.4, delay: 250, duration: 300, ease: 'Quad.In', onComplete: () => r() }));
      num.setText(String(result + bonus));
      audio.play('chipGain');
      punch(s, 0.03, 220);
      s.tweens.add({ targets: num, scale: { from: 1.6, to: 1.15 }, duration: 300, ease: 'Back.Out' });
      await new Promise<void>((r) => s.time.delayedCall(350, () => r()));
    }
    token.play('celebrate');
    setDebugInfo('dialShown', false);
    s.tweens.add({ targets: dim, alpha: 0, duration: 320, onComplete: () => dim.destroy() });
    s.tweens.killTweensOf(pool);
    s.tweens.add({ targets: pool, alpha: 0, duration: 320, onComplete: () => pool.destroy() });
    s.tweens.killTweensOf([halo, bloom]);
    await new Promise<void>((r) =>
      s.tweens.add({
        targets: root,
        scale: 0.2,
        alpha: 0,
        y: y + 120,
        duration: 260,
        ease: 'Back.In',
        onUpdate: syncMask,
        onComplete: () => {
          num.clearMask();
          ghost.clearMask();
          mask.destroy();
          face.destroy();
          root.destroy();
          r();
        },
      }),
    );
  }
}
