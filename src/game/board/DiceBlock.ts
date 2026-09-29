import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import type { Character } from '../characters/Character';
import { DEPTH, DIAL_MAX, DIAL_MIN, GAME_HEIGHT, GAME_WIDTH } from '../constants';
import type { EffectsManager } from '../effects/EffectsManager';
import type { Controls } from '../input/Controls';
import { lerpColor } from './DayCycle';
import { punch } from '../minigames/juice';
import { LITE } from '../perf';
import { addText } from '../ui/theme';
import { onSceneUpdate } from '../util/sceneEvents';
import { setDebugInfo } from '../debug/debug';

/** Front face size and the depth of the top / side faces, in px. */
const S = 150;
const D = 34;
/** Time each flickering number shows (ms). */
const FLICKER = 62;

/** The Dice Block's cube in a player's colour, with a white number panel on its front face (centred on 0,0). */
export function drawDiceCube(g: Phaser.GameObjects.Graphics, color: number): void {
  const h = S / 2;
  const top = lerpColor(color, 0xffffff, 0.35);
  const side = lerpColor(color, 0x000000, 0.3);
  const v = (x: number, y: number) => new Phaser.Math.Vector2(x, y);
  // Top and right faces, drawn behind the front face.
  g.fillStyle(top, 1);
  g.fillPoints([v(-h + 6, -h), v(h, -h), v(h + D, -h - D * 0.8), v(-h + D + 6, -h - D * 0.8)], true);
  g.fillStyle(side, 1);
  g.fillPoints([v(h, -h + 6), v(h + D, -h - D * 0.8), v(h + D, h - D * 0.8 - 6), v(h, h)], true);
  // Pips on the top face, so it reads as a die from above.
  g.fillStyle(0xffffff, 0.9);
  for (const [px, py] of [
    [-0.28, 0.5],
    [0.12, 0.5],
    [0.52, 0.5],
  ]) {
    g.fillEllipse(px * S + D * py, -h - D * 0.4, 14, 7);
  }
  // Front face: player colour with a white rim, then the white number panel.
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(-h - 5, -h - 5, S + 10, S + 10, 26);
  g.fillStyle(color, 1);
  g.fillRoundedRect(-h, -h, S, S, 22);
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(-h + 18, -h + 18, S - 36, S - 36, 16);
  // A gloss streak across the top-left of the front face.
  g.fillStyle(0xffffff, 0.35);
  g.fillRoundedRect(-h + 8, -h + 6, S * 0.46, 8, 4);
}

/**
 * The Dice Block: it hovers over the active character with its number flickering through 1–10 until
 * the player jumps up and hits it, then bursts and the number pops out. The number itself comes
 * from the match RNG, so the timing of the hit never changes fairness.
 */
export class DiceBlock {
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
    const lift = 280;
    const y = token.y - lift;
    const baseY = token.y;
    const root = s.add.container(x, y).setDepth(DEPTH.worldUi + 50);
    // The world dims around the hero while the block hovers (a spotlight centred on the screen).
    const dim = s.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'fx-spot').setScrollFactor(0).setDisplaySize(GAME_WIDTH * 1.18, GAME_HEIGHT * 1.18).setDepth(DEPTH.worldUi + 40).setAlpha(0);
    s.tweens.add({ targets: dim, alpha: 1, duration: 300 });
    // A pool of light in the player's colour under the hero's feet.
    const pool = s.add.image(x, token.y + 4, 'fx-dot').setTint(opts.color).setBlendMode(Phaser.BlendModes.ADD).setDepth(token.depth - 0.5).setScale(7.5, 2.4).setAlpha(0);
    s.tweens.add({ targets: pool, alpha: 0.75, duration: 300 });
    s.tweens.add({ targets: pool, scaleX: 8.4, scaleY: 2.7, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    // A soft glow behind the block, and its shadow on the ground at the hero's feet.
    const glow = s.add.image(0, 0, 'fx-dot').setTint(lerpColor(opts.color, 0xffffff, 0.4)).setBlendMode(Phaser.BlendModes.ADD).setScale(12).setAlpha(0.45);
    const shadow = s.add.image(12, lift + 16, 'fx-shadow').setScale(1.9, 0.5).setAlpha(0.5);
    const cube = s.add.graphics();
    drawDiceCube(cube, opts.color);
    const num = addText(s, 0, -2, String(DIAL_MIN), 86, { color: '#1f2940', weight: 700, fixed: true });
    const block = s.add.container(0, 0, [cube, num]);
    root.add([shadow, glow, block]);
    root.setScale(0.1);
    token.play('idle');
    audio.play('pop', { rate: 0.8 });
    await new Promise<void>((r) => s.tweens.add({ targets: root, scale: 1, duration: 300, ease: 'Back.Out', onComplete: () => r() }));
    setDebugInfo('dialShown', true);
    // Hover: a gentle bob and wobble while the numbers flicker.
    const bob = s.tweens.add({ targets: block, y: -10, angle: { from: -3, to: 3 }, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    s.tweens.add({ targets: glow, scale: { from: 11, to: 13.5 }, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    let value = DIAL_MIN;
    let acc = 0;
    const tick = (dt: number) => {
      acc += dt;
      while (acc >= FLICKER) {
        acc -= FLICKER;
        let next = value;
        while (next === value) next = Phaser.Math.Between(DIAL_MIN, DIAL_MAX);
        value = next;
        num.setText(String(value));
        audio.play('dialTick', { rate: 1.1, throttleMs: 40, volume: 0.6 });
      }
    };
    const stopListener = onSceneUpdate(s, (_t: number, dt: number) => tick(dt));
    // Wait for the hit (or the CPU's reaction time).
    if (opts.controls) await opts.waitForInput(opts.controls);
    else await new Promise<void>((r) => s.time.delayedCall(opts.cpuDelay, () => r()));
    // The jump: the hero springs up into the block, which takes the hit at the top of the jump.
    token.play('jump');
    const rise = opts.fast ? 110 : 150;
    await new Promise<void>((r) => s.tweens.add({ targets: token, y: baseY - 96, duration: rise, ease: 'Quad.Out', onComplete: () => r() }));
    s.tweens.add({ targets: token, y: baseY, duration: rise * 1.3, ease: 'Quad.In' });
    stopListener();
    bob.stop();
    num.setText(String(result));
    audio.play('dialStop');
    audio.play('cymbal', { volume: 0.55 });
    this.fx.sparks(x, y, LITE ? 18 : 30);
    this.fx.shake(0.006, 160);
    punch(s, 0.06, 280);
    // The block bursts: shards in the player's colour fly out and fall away.
    const shards = LITE ? 8 : 14;
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * Math.PI * 2 + Math.random() * 0.4;
      const sz = 16 + Math.random() * 20;
      const tint = i % 3 === 0 ? 0xffffff : i % 3 === 1 ? opts.color : lerpColor(opts.color, 0xffffff, 0.35);
      const shard = s.add.rectangle(x, y, sz, sz, tint).setDepth(DEPTH.worldUi + 52).setAngle(Math.random() * 90);
      s.tweens.add({
        targets: shard,
        x: x + Math.cos(a) * (150 + Math.random() * 110),
        y: y + Math.sin(a) * (110 + Math.random() * 80) + 140,
        angle: shard.angle + (Math.random() < 0.5 ? -1 : 1) * 260,
        alpha: 0,
        scale: 0.4,
        duration: 620 + Math.random() * 220,
        ease: 'Quad.Out',
        onComplete: () => shard.destroy(),
      });
    }
    const wave = s.add.image(x, y, 'fx-target').setDepth(DEPTH.worldUi + 49).setDisplaySize(200, 200).setAlpha(0.95);
    s.tweens.add({ targets: wave, displayWidth: 480, displayHeight: 480, alpha: 0, duration: 420, ease: 'Quad.Out', onComplete: () => wave.destroy() });
    const wave2 = s.add.image(x, y, 'fx-ring').setTint(opts.color).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.worldUi + 48).setDisplaySize(220, 220).setAlpha(1);
    s.tweens.add({ targets: wave2, displayWidth: 640, displayHeight: 640, alpha: 0, duration: 560, ease: 'Cubic.Out', onComplete: () => wave2.destroy() });
    // The cube vanishes and the number pops out on its own, big and bold.
    cube.setVisible(false);
    shadow.setVisible(false);
    block.setAngle(0).setY(0);
    num.setColor('#ffffff').setStroke('#1f2940', 14).setScale(0.6);
    s.tweens.add({ targets: num, scale: 1.5, duration: 260, ease: 'Back.Out' });
    s.tweens.add({ targets: glow, scale: 17, alpha: 0.7, duration: 160, yoyo: true });
    await new Promise<void>((r) => s.time.delayedCall(opts.fast ? 420 : 720, () => r()));
    if (bonus > 0) {
      const plus = addText(s, 130, -70, `+${bonus}`, 64, { color: '#ff6b5e', weight: 700, stroke: '#ffffff', strokeThickness: 10, fixed: true });
      root.add(plus);
      plus.setScale(0.2);
      audio.play('itemUse');
      await new Promise<void>((r) => s.tweens.add({ targets: plus, scale: 1, duration: 260, ease: 'Back.Out', onComplete: () => r() }));
      await new Promise<void>((r) => s.tweens.add({ targets: plus, x: 0, y: 0, alpha: 0, scale: 0.4, delay: 250, duration: 300, ease: 'Quad.In', onComplete: () => r() }));
      num.setText(String(result + bonus));
      audio.play('chipGain');
      punch(s, 0.03, 220);
      s.tweens.add({ targets: num, scale: { from: 2, to: 1.5 }, duration: 300, ease: 'Back.Out' });
      await new Promise<void>((r) => s.time.delayedCall(350, () => r()));
    }
    token.play('celebrate');
    setDebugInfo('dialShown', false);
    s.tweens.add({ targets: dim, alpha: 0, duration: 320, onComplete: () => dim.destroy() });
    s.tweens.killTweensOf(pool);
    s.tweens.add({ targets: pool, alpha: 0, duration: 320, onComplete: () => pool.destroy() });
    s.tweens.killTweensOf(glow);
    await new Promise<void>((r) =>
      s.tweens.add({
        targets: root,
        scale: 0.3,
        alpha: 0,
        y: y + 140,
        duration: 260,
        ease: 'Back.In',
        onComplete: () => {
          root.destroy();
          r();
        },
      }),
    );
    token.setY(baseY);
  }
}
