import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { COLORS, CSS, DEPTH } from '../constants';
import type { Controls } from '../input/Controls';
import { addText } from '../ui/theme';
import type { BoardManager } from './BoardManager';
import type { PathOption } from './flowTypes';

interface Arrow {
  option: PathOption;
  angle: number;
  root: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
}

/** Arrows at an intersection; the stick points at a path, A confirms. */
export class PathChooser {
  constructor(
    private scene: Phaser.Scene,
    private board: BoardManager,
  ) {}

  choose(at: string, options: PathOption[], opts: { controls?: Controls; cpu?: string; interrupted: () => boolean; fast: boolean }): Promise<string> {
    const s = this.scene;
    const origin = this.board.pos(at);
    const arrows: Arrow[] = options.map((o) => {
      const target = this.board.pos(o.to);
      const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
      const r = 125;
      const root = s.add.container(origin.x + Math.cos(angle) * r, origin.y + Math.sin(angle) * r - 30).setDepth(DEPTH.worldUi + 20);
      const img = s.add.image(0, 0, 'path-arrow').setScale(0.62).setRotation(angle + Math.PI / 2);
      const label = addText(s, Math.cos(angle) * 90, Math.sin(angle) * 70 - 50, o.label, 30, { color: CSS.white, weight: 700, stroke: '#1b1530', strokeThickness: 7, fixed: true });
      root.add([img, label]);
      if (o.needsKey) {
        const key = s.add.sprite(-Math.sin(angle) * 70, Math.cos(angle) * 70 - 20, 'items', '6').play('key-spin').setScale(0.22);
        const kt = addText(s, -Math.sin(angle) * 70, Math.cos(angle) * 70 + 30, 'uses Prism Key', 20, { color: CSS.goldLight, weight: 700, stroke: '#1b1530', strokeThickness: 5, fixed: true });
        root.add([key, kt]);
      }
      root.setScale(0);
      s.tweens.add({ targets: root, scale: 1, duration: 220, ease: 'Back.Out' });
      return { option: o, angle, root, img };
    });
    let index = 0;
    const draw = () => {
      arrows.forEach((a, i) => {
        const sel = i === index;
        a.img.setTint(sel ? 0xffffff : 0x9a9aa8);
        s.tweens.killTweensOf(a.root);
        s.tweens.add({ targets: a.root, scale: sel ? 1.18 : 0.88, alpha: sel ? 1 : 0.7, duration: 140, ease: 'Back.Out' });
      });
    };
    draw();
    const glow = s.add.image(origin.x, origin.y, 'fx-ring').setScale(1.2, 0.6).setTint(COLORS.crystal).setDepth(DEPTH.spaces + 3).setBlendMode(Phaser.BlendModes.ADD);
    s.tweens.add({ targets: glow, alpha: { from: 1, to: 0.3 }, duration: 500, yoyo: true, repeat: -1 });
    const cleanup = () => {
      glow.destroy();
      for (const a of arrows) {
        s.tweens.add({ targets: a.root, scale: 0, alpha: 0, duration: 160, onComplete: () => a.root.destroy() });
      }
    };
    return new Promise((resolve) => {
      let t = 0;
      let lastMove = 0;
      const target = opts.cpu ? Math.max(0, options.findIndex((o) => o.to === opts.cpu)) : 0;
      const done = (i: number) => {
        s.events.off(Phaser.Scenes.Events.UPDATE, update);
        audio.play('confirm');
        const a = arrows[i];
        s.tweens.add({ targets: a.root, scale: 1.4, duration: 120, yoyo: true });
        s.time.delayedCall(140, () => {
          cleanup();
          resolve(a.option.to);
        });
      };
      const update = (_time: number, dt: number) => {
        t += dt;
        if (opts.interrupted()) {
          done(index);
          return;
        }
        const c = opts.controls;
        if (!c) {
          if (t < (opts.fast ? 350 : 650)) return;
          if (index !== target && t - lastMove > (opts.fast ? 200 : 380)) {
            index = target;
            lastMove = t;
            audio.play('menuMove');
            draw();
            return;
          }
          if (index === target && t - lastMove > (opts.fast ? 250 : 450)) done(index);
          return;
        }
        let moved = false;
        const mag = Math.hypot(c.moveX, c.moveY);
        if (mag > 0.55) {
          const ang = Math.atan2(c.moveY, c.moveX);
          let best = index;
          let bestD = Infinity;
          arrows.forEach((a, i) => {
            const d = Math.abs(Phaser.Math.Angle.Wrap(a.angle - ang));
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          if (best !== index) {
            index = best;
            moved = true;
          }
        }
        if (c.pressed('RB')) {
          index = (index + 1) % arrows.length;
          moved = true;
        } else if (c.pressed('LB')) {
          index = (index - 1 + arrows.length) % arrows.length;
          moved = true;
        }
        if (moved) {
          audio.play('menuMove');
          draw();
        }
        if (c.pressed('A')) done(index);
      };
      s.events.on(Phaser.Scenes.Events.UPDATE, update);
    });
  }
}
