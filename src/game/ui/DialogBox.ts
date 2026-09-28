import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { CSS, GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { NPC_ATLAS, NPCS, npcFrame, type NpcId } from '../data/npcs';
import type { Controls } from '../input/Controls';
import { settings } from '../save/SettingsManager';
import { standOrigin } from '../util/spriteUtil';
import { PromptBar } from './ControllerPrompt';
import { drawPanel } from './Panel';
import { addText } from './theme';

export interface DialogLine {
  npc: NpcId;
  pose?: string;
  text: string;
}

export interface DialogRunOpts {
  /** Controls allowed to advance / skip (defaults to none → auto-advance). */
  controls?: Controls[];
  /** Advance automatically (used during CPU turns); humans can still speed it up. */
  auto?: boolean;
  allowSkip?: boolean;
}

/** Large, TV-readable NPC speech panel with a typewriter effect. */
export class DialogBox extends Phaser.GameObjects.Container {
  private portrait: Phaser.GameObjects.Sprite;
  private nameText: Phaser.GameObjects.Text;
  private roleText: Phaser.GameObjects.Text;
  private bodyText: Phaser.GameObjects.Text;
  private prompts: PromptBar;
  private arrow: Phaser.GameObjects.Text;
  private nameG: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, depth = 15000) {
    super(scene, GAME_WIDTH / 2, GAME_HEIGHT - 170);
    const w = 1420;
    const h = 250;
    const bg = scene.add.graphics();
    drawPanel(bg, -w / 2, -h / 2, w, h, { radius: 30 });
    this.portrait = scene.add.sprite(-w / 2 + 150, h / 2 - 12, NPC_ATLAS, '0').setScale(0.95);
    this.nameG = scene.add.graphics();
    this.nameText = addText(scene, -w / 2 + 300, -h / 2 + 4, '', 32, { color: CSS.white, weight: 700, align: 'left' });
    this.roleText = addText(scene, -w / 2 + 300, -h / 2 + 4, '', 20, { color: 'rgba(255,255,255,0.85)', weight: 600, align: 'left' });
    this.bodyText = addText(scene, -w / 2 + 300, -h / 2 + 50, '', 38, { color: CSS.ink, weight: 600, align: 'left', wrap: w - 360, lineSpacing: 6 });
    this.bodyText.setOrigin(0, 0);
    this.arrow = addText(scene, w / 2 - 50, h / 2 - 40, '▼', 26, { color: '#9aa5b8', weight: 700 });
    this.prompts = new PromptBar(scene, w / 2 - 210, h / 2 + 34, [], { size: 34, fontSize: 24 });
    this.add([bg, this.portrait, this.nameG, this.nameText, this.roleText, this.bodyText, this.arrow, this.prompts]);
    this.setDepth(depth).setVisible(false);
    scene.add.existing(this);
    scene.tweens.add({ targets: this.arrow, y: this.arrow.y + 8, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  private setSpeaker(line: DialogLine): void {
    const npc = NPCS[line.npc];
    const frame = npcFrame(line.npc, line.pose);
    const o = standOrigin(NPC_ATLAS, frame);
    this.portrait.setFrame(frame).setOrigin(o.x, o.y);
    this.nameText.setText(npc.name);
    this.roleText.setText(npc.role);
    const w = 1420;
    const nx = -w / 2 + 290;
    const plaqueW = this.nameText.width + this.roleText.width + 70;
    this.nameG.clear();
    // Speaker name on a pill in the NPC's colour straddling the card's top edge.
    this.nameG.fillStyle(npc.color, 1);
    this.nameG.fillRoundedRect(nx, -125 - 26, plaqueW, 52, 26);
    this.nameText.setPosition(nx + 20, -125 + 1);
    this.roleText.setPosition(nx + 36 + this.nameText.width, -125 + 4);
  }

  /** Show the lines one by one; resolves when finished or skipped. */
  run(lines: DialogLine[], opts: DialogRunOpts = {}): Promise<void> {
    if (lines.length === 0) return Promise.resolve();
    const scene = this.scene;
    const controls = opts.controls ?? [];
    const human = controls.length > 0;
    const allowSkip = opts.allowSkip ?? true;
    const fast = settings.get().gameSpeed === 'fast';
    this.setVisible(true).setAlpha(0);
    this.y = GAME_HEIGHT - 150;
    scene.tweens.add({ targets: this, alpha: 1, y: GAME_HEIGHT - 170, duration: 180, ease: 'Quad.Out' });
    this.prompts.setPrompts(
      human
        ? [
            { button: 'A', label: 'Next' },
            ...(allowSkip ? [{ button: 'B' as const, label: 'Skip' }] : []),
          ]
        : [],
    );
    return new Promise((resolve) => {
      let index = -1;
      let shown = 0;
      let full = '';
      let autoTimer = 0;
      let typeAcc = 0;
      const cps = fast ? 90 : 60;
      const next = () => {
        index++;
        if (index >= lines.length) {
          finish();
          return;
        }
        const line = lines[index];
        this.setSpeaker(line);
        full = line.text;
        shown = 0;
        typeAcc = 0;
        autoTimer = 0;
        this.bodyText.setText('');
        this.arrow.setVisible(false);
        scene.tweens.add({ targets: this.portrait, scaleY: { from: 0.88, to: 0.95 }, duration: 200, ease: 'Back.Out' });
      };
      const finish = () => {
        scene.events.off(Phaser.Scenes.Events.UPDATE, update);
        scene.tweens.add({
          targets: this,
          alpha: 0,
          y: GAME_HEIGHT - 150,
          duration: 150,
          onComplete: () => {
            this.setVisible(false);
            resolve();
          },
        });
      };
      const update = (_t: number, dt: number) => {
        if (!this.visible) return;
        if (shown < full.length) {
          typeAcc += (dt / 1000) * cps;
          const add = Math.floor(typeAcc);
          if (add > 0) {
            typeAcc -= add;
            const before = shown;
            shown = Math.min(full.length, shown + add);
            this.bodyText.setText(full.slice(0, shown));
            if (Math.floor(before / 3) !== Math.floor(shown / 3)) audio.play('menuMove', { volume: 0.25, rate: 1.4, throttleMs: 60 });
          }
          if (shown >= full.length) this.arrow.setVisible(true);
        } else {
          autoTimer += dt;
        }
        const pressedA = controls.some((c) => c.pressed('A'));
        const pressedB = allowSkip && controls.some((c) => c.pressed('B'));
        if (pressedB) {
          audio.play('cancel');
          finish();
          return;
        }
        if (pressedA) {
          if (shown < full.length) {
            shown = full.length;
            this.bodyText.setText(full);
            this.arrow.setVisible(true);
          } else {
            audio.play('menuMove');
            next();
          }
          return;
        }
        if ((opts.auto || !human) && shown >= full.length) {
          const readMs = (fast ? 700 : 1100) + full.length * (fast ? 18 : 28);
          if (autoTimer > readMs) next();
        }
      };
      scene.events.on(Phaser.Scenes.Events.UPDATE, update);
      next();
    });
  }
}
