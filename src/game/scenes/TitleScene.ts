import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { Character } from '../characters/Character';
import { CSS, GAME_HEIGHT, GAME_WIDTH, SUBTITLE, TITLE } from '../constants';
import { CHARACTER_IDS } from '../data/characters';
import { EffectsManager } from '../effects/EffectsManager';
import { input } from '../input/InputManager';
import { saves } from '../save/SaveManager';
import { settings } from '../save/SettingsManager';
import { session } from '../state/Session';
import { PromptBar } from '../ui/ControllerPrompt';
import { Menu } from '../ui/Menu';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { findBoard } from '../data/boards';

/**
 * Title screen. Attract state ("PRESS A"), then the main menu. The four heroes hang out on a
 * floating festival island and react to one another.
 */
export class TitleScene extends Phaser.Scene {
  private phase: 'attract' | 'menu' = 'attract';
  private menu!: Menu;
  private pressText!: Phaser.GameObjects.Text;
  private prompts!: PromptBar;
  private hint!: Phaser.GameObjects.Text;
  private audioHint!: Phaser.GameObjects.Text;
  private chars: Character[] = [];
  private fx!: EffectsManager;
  private logo!: Phaser.GameObjects.Container;
  private busy = new Set<number>();
  private farIslands!: Phaser.GameObjects.TileSprite;
  private cloudsFar!: Phaser.GameObjects.TileSprite;
  private cloudsBelow!: Phaser.GameObjects.TileSprite;

  constructor() {
    super('Title');
  }

  create(): void {
    enterScene(this);
    this.phase = 'attract';
    this.chars = [];
    this.busy.clear();
    audio.playMusic('menu');
    this.fx = new EffectsManager(this, 500);
    this.buildBackground();
    this.buildIsland();
    this.buildLogo();
    this.buildMenu();
    this.pressText = addTitle(this, GAME_WIDTH / 2, GAME_HEIGHT - 86, 'PRESS A', 54, CSS.goldLight).setDepth(600);
    this.tweens.add({ targets: this.pressText, alpha: { from: 1, to: 0.35 }, scale: { from: 1, to: 1.05 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.prompts = new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 60, [], { size: 40, fontSize: 28 }).setDepth(600).setVisible(false);
    this.hint = addText(this, 470, 1030, '', 26, { color: CSS.cream, weight: 500, stroke: '#0b2a33', strokeThickness: 5 }).setDepth(600);
    this.audioHint = addText(this, GAME_WIDTH - 30, 36, '🔇 Press any key or click to enable sound', 22, { color: CSS.cream, align: 'right', weight: 500, stroke: '#0b2a33', strokeThickness: 5 }).setDepth(600);
    this.time.addEvent({ delay: 2600, loop: true, callback: () => this.direct() });
    this.time.delayedCall(700, () => this.direct());
    this.time.addEvent({
      delay: 5200,
      loop: true,
      callback: () => {
        if (!settings.get().reducedMotion) this.fx.confetti(Phaser.Math.Between(900, 1700), Phaser.Math.Between(260, 420), 26);
      },
    });
    if (window.__GLEAMTRAIL__) window.__GLEAMTRAIL__.ready = true;
  }

  private buildBackground(): void {
    this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    this.cloudsFar = this.add.tileSprite(0, 150, GAME_WIDTH, 420, 'bg-clouds-far').setOrigin(0).setAlpha(0.9);
    this.farIslands = this.add.tileSprite(0, 380, GAME_WIDTH, 640, 'bg-islands-far').setOrigin(0).setAlpha(0.85);
    this.cloudsBelow = this.add.tileSprite(0, 700, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setAlpha(0.95);
    // Distant floating islets drifting past
    for (let i = 0; i < 3; i++) {
      const isl = this.add.image(200 + i * 620, 600 + (i % 2) * 90, 'island-tiny').setScale(0.55 + i * 0.1).setAlpha(0.75);
      this.tweens.add({ targets: isl, y: isl.y - 18, duration: 2600 + i * 500, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
  }

  private buildIsland(): void {
    const cx = 1300;
    const island = this.add.container(cx, 0);
    const base = this.add.image(0, 820, 'island-wide').setScale(1.08);
    island.add(base);
    // Festival dressing
    const poleL = this.add.rectangle(-470, 590, 12, 200, 0x5f3b1c).setOrigin(0.5, 1);
    const poleR = this.add.rectangle(470, 590, 12, 200, 0x5f3b1c).setOrigin(0.5, 1);
    const bunting = this.add.image(0, 420, 'bunting').setScale(1.5, 1.2);
    island.add([poleL, poleR, bunting]);
    for (const [x, y] of [
      [-300, 470],
      [0, 500],
      [300, 470],
    ] as const) {
      const l = this.add.image(x, y, 'lantern').setScale(0.7);
      island.add(l);
      this.tweens.add({ targets: l, angle: { from: -5, to: 5 }, duration: 1600 + x, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    const tree = this.add.image(610, 600, 'tree-twist').setScale(0.5);
    island.addAt(tree, 1);
    const xs = [-330, -110, 110, 330];
    CHARACTER_IDS.forEach((id, i) => {
      const c = new Character(this, xs[i], 690 + (i % 2) * 14, id, { scale: 0.95 });
      c.face(i >= 2);
      island.add(c);
      this.chars.push(c);
    });
    this.tweens.add({ targets: island, y: -14, duration: 3000, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  private buildLogo(): void {
    this.logo = this.add.container(470, 0).setDepth(400);
    const emblem = this.add.image(0, 230, 'emblem').setScale(0.95);
    const title = addTitle(this, 0, 425, TITLE, 132);
    const sub = addText(this, 0, 518, SUBTITLE, 44, { color: CSS.goldLight, weight: 700, stroke: CSS.tealDeep, strokeThickness: 8, shadow: true, fixed: true });
    this.logo.add([emblem, title, sub]);
    this.tweens.add({ targets: emblem, angle: 360, duration: 24000, repeat: -1 });
    this.tweens.add({ targets: [emblem, title, sub], y: '+=10', duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  private buildMenu(): void {
    const hasSave = saves.hasSave() && !!findBoard('suncoil');
    this.menu = new Menu(
      this,
      470,
      770,
      [
        { label: 'PLAY', hint: 'Start a new board match on the Spiral Isles.', onSelect: () => this.startPlay('board') },
        { label: 'CONTINUE', hint: 'Resume your saved board match.', disabled: () => !hasSave, onSelect: () => goTo(this, 'Board', { continue: true }) },
        { label: 'MINIGAME MODE', hint: 'Jump straight into minigames with friends.', onSelect: () => this.startPlay('minigame') },
        { label: 'HOW TO PLAY', hint: 'Ora explains the festival rules.', onSelect: () => goTo(this, 'HowToPlay') },
        { label: 'SETTINGS', hint: 'Audio, accessibility, controls and controller test.', onSelect: () => goTo(this, 'Settings', { from: 'Title' }) },
      ],
      {
        width: 460,
        itemHeight: 64,
        gap: 16,
        fontSize: 32,
        onCancel: () => this.closeMenu(),
        onFocus: (item) => this.hint?.setText(item.hint ?? ''),
      },
    );
    this.menu.setDepth(500).setVisible(false);
    this.menu.enabled = false;
  }

  private startPlay(mode: 'board' | 'minigame'): void {
    session.mode = mode;
    session.resetSlots();
    for (let i = 0; i < 4; i++) input.assign(i, null);
    goTo(this, 'CharacterSelect');
  }

  private openMenu(): void {
    this.phase = 'menu';
    audio.play('confirm');
    this.pressText.setVisible(false);
    this.menu.setVisible(true).setAlpha(0);
    this.menu.x = 300;
    this.tweens.add({ targets: this.menu, alpha: 1, x: 470, duration: 260, ease: 'Back.Out' });
    this.tweens.add({ targets: this.logo, scale: 0.82, y: -40, duration: 260, ease: 'Quad.Out' });
    this.time.delayedCall(80, () => (this.menu.enabled = true));
    this.prompts.setVisible(true).setPrompts([
      { button: 'A', label: 'Select' },
      { button: 'B', label: 'Back' },
    ]);
    this.prompts.x = 1300;
    this.hint.setText(this.menu.items[this.menu.index].hint ?? '');
    this.chars.forEach((c, i) => this.time.delayedCall(i * 120, () => c.play('wave')));
  }

  private closeMenu(): void {
    this.phase = 'attract';
    this.menu.enabled = false;
    this.tweens.add({ targets: this.menu, alpha: 0, x: 300, duration: 180, onComplete: () => this.menu.setVisible(false) });
    this.tweens.add({ targets: this.logo, scale: 1, y: 0, duration: 220 });
    this.pressText.setVisible(true);
    this.prompts.setVisible(false);
    this.hint.setText('');
  }

  /** Little ambient scenes between the four heroes. */
  private direct(): void {
    if (this.chars.length < 4) return;
    const free = [0, 1, 2, 3].filter((i) => !this.busy.has(i));
    if (free.length < 2) return;
    const a = Phaser.Utils.Array.GetRandom(free);
    const others = free.filter((i) => i !== a);
    const b = Phaser.Utils.Array.GetRandom(others);
    const ca = this.chars[a];
    const cb = this.chars[b];
    const roll = Math.random();
    const mark = (i: number, ms: number) => {
      this.busy.add(i);
      this.time.delayedCall(ms, () => this.busy.delete(i));
    };
    if (roll < 0.3) {
      // Wave hello, the other waves back.
      mark(a, 1600);
      mark(b, 1600);
      ca.faceToward(cb.x).play('wave');
      this.time.delayedCall(500, () => cb.faceToward(ca.x).play(Math.random() < 0.5 ? 'wave' : 'celebrate'));
    } else if (roll < 0.55) {
      // A happy hop that startles a neighbour.
      mark(a, 1400);
      mark(b, 1400);
      this.hop(ca);
      this.time.delayedCall(450, () => cb.faceToward(ca.x).play('surprised'));
    } else if (roll < 0.75) {
      // Everyone cheers in a ripple.
      [0, 1, 2, 3].forEach((i) => {
        if (this.busy.has(i)) return;
        mark(i, 1500);
        this.time.delayedCall(i * 130, () => this.chars[i].play('celebrate'));
      });
    } else if (roll < 0.88) {
      // Victory pose, others clap along.
      mark(a, 1500);
      ca.play('victory');
      this.time.delayedCall(350, () => cb.faceToward(ca.x).play('celebrate'));
      mark(b, 1500);
    } else {
      // Tumble stomps; everyone jumps in surprise.
      const t = this.chars[2];
      if (this.busy.has(2)) return;
      [0, 1, 2, 3].forEach((i) => mark(i, 1800));
      this.hop(t, 70, () => {
        this.fx.shake(0.004, 200);
        this.fx.vfx('dust', t.parentContainer.x + t.x, t.parentContainer.y + t.y, { scale: 0.6 });
        [0, 1, 3].forEach((i) => this.chars[i].play('surprised'));
      });
    }
  }

  private hop(c: Character, height = 90, onLand?: () => void): void {
    c.play('jump');
    audio.play('jump', { volume: 0.5 });
    const y0 = c.y;
    this.tweens.add({
      targets: c,
      y: y0 - height,
      duration: 260,
      ease: 'Quad.Out',
      yoyo: true,
      onComplete: () => {
        c.y = y0;
        c.squash();
        onLand?.();
      },
    });
  }

  override update(_t: number, delta: number): void {
    const dt = delta / 1000;
    this.cloudsFar.tilePositionX += 8 * dt;
    this.farIslands.tilePositionX += 4 * dt;
    this.cloudsBelow.tilePositionX += 14 * dt;
    const pad = input.hasGamepad();
    this.pressText.setText(pad ? 'PRESS  A' : 'PRESS ENTER');
    this.audioHint.setVisible(audio.available && !audio.running);
    if (this.phase === 'attract') {
      if (input.any.pressed('A') || input.any.pressed('MENU')) this.openMenu();
    } else {
      this.menu.handle(input.any);
    }
  }
}

