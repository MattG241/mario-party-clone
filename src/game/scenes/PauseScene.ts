import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH } from '../constants';
import type { Controls } from '../input/Controls';
import { input } from '../input/InputManager';
import type { MinigameLaunch } from '../minigames/MinigameManager';
import { settings } from '../save/SettingsManager';
import { PromptBar } from '../ui/ControllerPrompt';
import { Menu, type MenuItem } from '../ui/Menu';
import { drawPanel } from '../ui/Panel';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addGradientTitle, addText } from '../ui/theme';
import { coverThen } from '../ui/Transition';

interface PauseData {
  owner: number;
  from: string;
  minigame?: MinigameLaunch;
}

type Page = 'main' | 'controls' | 'audio' | 'controller';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const step = (v: number, d: number) => Math.round(Math.min(1, Math.max(0, v + d * 0.1)) * 10) / 10;

/**
 * Pause overlay. Only the player who paused can navigate it — Player 1 may take over with Y.
 */
export class PauseScene extends Phaser.Scene {
  private data0!: PauseData;
  private owner = 0;
  private menu!: Menu;
  private root!: Phaser.GameObjects.Container;
  private ownerBadge!: Phaser.GameObjects.Container;
  private ownerText!: Phaser.GameObjects.Text;
  /** Set once Quit or Restart has been chosen (the wipe is on its way). */
  private leavingTo: 'quit' | 'restart' | null = null;

  constructor() {
    super('Pause');
  }

  init(data: PauseData): void {
    this.data0 = data;
    this.owner = data.owner;
    this.leavingTo = null;
  }

  create(): void {
    input.lockHeld();
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x06141a, 0.62).setOrigin(0);
    const title = addGradientTitle(this, GAME_WIDTH / 2, 130, 'PAUSED', 96);
    if (!settings.get().reducedMotion) {
      // The overlay settles in: the dim fades up and the title drops onto it.
      dim.setAlpha(0);
      this.tweens.add({ targets: dim, alpha: 1, duration: 160 });
      title.setScale(1.4).setAlpha(0);
      this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 240, ease: 'Back.Out' });
    }
    this.ownerBadge = this.add.container(GAME_WIDTH / 2 - 190, 222);
    this.ownerText = addText(this, GAME_WIDTH / 2 - 150, 222, '', 28, { color: CSS.cream, weight: 600, align: 'left', stroke: '#1b1530', strokeThickness: 5 });
    this.root = this.add.container(0, 0);
    this.refreshOwner();
    new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 40, [
      { button: 'A', label: 'Select' },
      { button: 'B', label: 'Back' },
      { button: 'MENU', label: 'Resume' },
    ], { size: 38, fontSize: 26 });
    this.showPage('main');
  }

  private refreshOwner(): void {
    this.ownerBadge.removeAll(true);
    this.ownerBadge.add(new PlayerBadge(this, 0, 0, this.owner, 22));
    this.ownerText.setText(this.owner === 0 ? 'Player 1 has the pause menu' : `Player ${this.owner + 1} has the pause menu · P1: press Y to take over`);
  }

  private showPage(page: Page): void {
    this.root.removeAll(true);
    if (!settings.get().reducedMotion) {
      this.tweens.killTweensOf(this.root);
      this.root.setAlpha(0).setY(24);
      this.tweens.add({ targets: this.root, alpha: 1, y: 0, duration: 200, ease: 'Cubic.Out' });
    }
    const panel = this.add.graphics();
    this.root.add(panel);
    let items: MenuItem[] = [];
    if (page === 'main') {
      items = [
        { label: 'RESUME', onSelect: () => this.resume() },
        { label: 'CONTROLS', onSelect: () => this.showPage('controls') },
        { label: 'AUDIO', onSelect: () => this.showPage('audio') },
        { label: 'GAME SPEED', value: () => (settings.get().gameSpeed === 'fast' ? 'Fast' : 'Normal'), onChange: () => settings.set({ gameSpeed: settings.get().gameSpeed === 'fast' ? 'normal' : 'fast' }) },
        { label: 'CONTROLLER SETTINGS', onSelect: () => this.showPage('controller') },
        ...(this.data0.minigame ? [{ label: 'RESTART MINIGAME', onSelect: () => this.restartMinigame() }] : []),
        { label: 'QUIT TO MENU', onSelect: () => this.quit() },
      ];
    } else if (page === 'audio') {
      items = [
        { label: 'Master Volume', value: () => pct(settings.get().masterVolume), onChange: (d) => settings.set({ masterVolume: step(settings.get().masterVolume, d) }) },
        { label: 'Music Volume', value: () => pct(settings.get().musicVolume), onChange: (d) => settings.set({ musicVolume: step(settings.get().musicVolume, d) }) },
        { label: 'Sound Effects', value: () => pct(settings.get().sfxVolume), onChange: (d) => settings.set({ sfxVolume: step(settings.get().sfxVolume, d) }) },
        { label: 'Subtitles', value: () => (settings.get().subtitles ? 'On' : 'Off'), onChange: () => settings.set({ subtitles: !settings.get().subtitles }) },
        { label: 'BACK', onSelect: () => this.showPage('main') },
      ];
    } else if (page === 'controller') {
      items = [
        { label: 'Controller Vibration', value: () => (settings.get().vibration ? 'On' : 'Off'), onChange: () => {
          settings.set({ vibration: !settings.get().vibration });
          if (settings.get().vibration) input.rumbleSlot(this.owner, 0.5, 0.5, 150);
        } },
        { label: 'Stick Dead Zone', value: () => settings.get().deadzone.toFixed(2), onChange: (d) => settings.set({ deadzone: Math.round(Math.min(0.3, Math.max(0.1, settings.get().deadzone + d * 0.02)) * 100) / 100 }) },
        { label: 'Screen Shake', value: () => (settings.get().screenShake ? 'On' : 'Off'), onChange: () => settings.set({ screenShake: !settings.get().screenShake }) },
        { label: 'BACK', onSelect: () => this.showPage('main') },
      ];
    } else {
      const g = this.add.graphics();
      drawPanel(g, GAME_WIDTH / 2 - 620, 280, 1240, 600, { radius: 32, bevel: true });
      this.root.add(g);
      const rows: [string, string][] = [
        ['Left stick / D-pad', 'Move · menu navigation'],
        ['A', 'Confirm · jump · primary action · spin the Orbit Dial'],
        ['B', 'Back · cancel · duck'],
        ['X', 'Secondary action (dash, grab, throw)'],
        ['Y', 'Use / inspect items'],
        ['LB / RB', 'Cycle options and items'],
        ['LT / RT', 'Minigame actions (pull, blast)'],
        ['Menu', 'Pause'],
        ['View', 'Scores (hold)'],
        ['Keyboard', 'WASD/arrows · Enter/Space = A · Esc = B · E = X · Q = Y · Tab = View · P = Pause'],
      ];
      rows.forEach(([k, v], i) => {
        this.root.add(addText(this, GAME_WIDTH / 2 - 560, 330 + i * 52, k, 28, { color: CSS.tealDark, weight: 700, align: 'left' }));
        this.root.add(addText(this, GAME_WIDTH / 2 - 250, 330 + i * 52, v, 26, { color: CSS.ink, weight: 500, align: 'left', wrap: 780 }));
      });
      items = [{ label: 'BACK', onSelect: () => this.showPage('main') }];
      this.menu = new Menu(this, GAME_WIDTH / 2, 950, items, { width: 360, itemHeight: 66, fontSize: 30, onCancel: () => this.showPage('main') });
      this.root.add(this.menu);
      return;
    }
    const h = items.length * 86 + 90;
    drawPanel(panel, GAME_WIDTH / 2 - 400, 290, 800, h, { radius: 32, border: COLORS.teal, bevel: true });
    this.menu = new Menu(this, GAME_WIDTH / 2, 290 + h / 2, items, {
      width: 680,
      itemHeight: 68,
      gap: 18,
      fontSize: 30,
      onCancel: () => (page === 'main' ? this.resume() : this.showPage('main')),
    });
    this.root.add(this.menu);
  }

  private ownerControls(): Controls {
    return input.controls(this.owner);
  }

  private resume(): void {
    audio.play('pause');
    const from = this.data0.from;
    if (this.scene.isPaused(from)) this.scene.resume(from);
    this.scene.stop();
  }

  private restartMinigame(): void {
    if (this.leavingTo) return;
    this.leavingTo = 'restart';
    const from = this.data0.from;
    const launch = this.data0.minigame;
    // The wipe sweeps over the paused game, then the minigame starts afresh underneath.
    coverThen(this, () => {
      this.scene.stop(from);
      if (launch) this.scene.start(from, launch);
      this.scene.stop();
    });
  }

  private quit(): void {
    if (this.leavingTo) return;
    this.leavingTo = 'quit';
    audio.stopMusic(0.3);
    coverThen(this, () => {
      for (const key of ['Board', 'BoardUI', 'BoardBg', this.data0.from]) if (this.scene.isActive(key) || this.scene.isPaused(key) || this.scene.isSleeping(key)) this.scene.stop(key);
      this.scene.start('Title');
    });
  }

  override update(): void {
    // Leaving behind the wipe: the menu is done.
    if (this.leavingTo) return;
    // Player 1 may take over the pause menu.
    if (this.owner !== 0 && input.controls(0).pressed('Y')) {
      this.owner = 0;
      audio.play('confirm');
      this.refreshOwner();
    }
    const c = this.ownerControls();
    if (c.pressed('MENU')) {
      this.resume();
      return;
    }
    this.menu?.handle(c);
  }
}
