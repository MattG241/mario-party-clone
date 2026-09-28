import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { BUTTONS, type Button } from '../input/buttons';
import type { GamepadDevice } from '../input/GamepadManager';
import { input } from '../input/InputManager';
import { settings } from '../save/SettingsManager';
import { PromptBar } from '../ui/ControllerPrompt';
import { buildBackdrop, drawNavyPanel } from '../ui/Screen';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';

/** Where each button sits on the little controller diagram (relative to its centre). */
const LAYOUT: Partial<Record<Button, [number, number, number]>> = {
  A: [118, 22, 17],
  B: [150, -8, 17],
  X: [86, -8, 17],
  Y: [118, -38, 17],
  LB: [-120, -92, 0],
  RB: [120, -92, 0],
  VIEW: [-36, -26, 11],
  MENU: [36, -26, 11],
  UP: [-120, -28, 0],
  DOWN: [-120, 16, 0],
  LEFT: [-142, -6, 0],
  RIGHT: [-98, -6, 0],
};

const FACE: Partial<Record<Button, number>> = { A: 0x3fbf5f, B: 0xe5484d, X: 0x3b82f6, Y: 0xf5c542 };

/**
 * Controller tester: every connected pad with live buttons, sticks (with the dead-zone ring),
 * triggers and a rumble test, plus the keyboard. Hold B for a second to leave.
 */
export class GamepadDebugScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private back = 'Title';
  private holdB = 0;

  constructor() {
    super('GamepadDebug');
  }

  init(data: { back?: string } = {}): void {
    this.back = data.back ?? 'Title';
    this.holdB = 0;
  }

  create(): void {
    enterScene(this);
    buildBackdrop(this, 'day');
    addTitle(this, GAME_WIDTH / 2, 74, 'CONTROLLER TEST', 66);
    addText(this, GAME_WIDTH / 2, 132, 'Press any button on a controller to wake it · A on a controller tests rumble', 22, { color: CSS.cream, weight: 600, stroke: '#06141a', strokeThickness: 4 });
    const bg = this.add.graphics();
    for (let i = 0; i < 4; i++) {
      const [x, y] = this.slotPos(i);
      drawNavyPanel(bg, x - 420, y - 190, 840, 380, { border: PLAYER_COLORS[i] });
    }
    this.g = this.add.graphics();
    this.labels = [0, 1, 2, 3].map((i) => {
      const [x, y] = this.slotPos(i);
      return addText(this, x - 390, y - 160, '', 22, { color: CSS.cream, weight: 700, align: 'left' }).setOrigin(0, 0.5);
    });
    new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 40, [{ button: 'B', label: 'Hold to go back' }], { size: 34, fontSize: 22 });
  }

  private slotPos(i: number): [number, number] {
    return [GAME_WIDTH / 2 + (i % 2 === 0 ? -440 : 440), i < 2 ? 380 : 800];
  }

  override update(_t: number, delta: number): void {
    const pads = input.connectedPads();
    const g = this.g;
    g.clear();
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = this.slotPos(i);
      const pad = pads[i];
      if (i === 3 && !pad) {
        this.drawKeyboard(cx, cy);
        continue;
      }
      if (!pad) {
        this.labels[i].setText(`Slot ${i + 1}: connect a controller and press any button`).setColor(CSS.creamDark);
        this.drawEmpty(cx, cy + 20);
        continue;
      }
      const layout = pad.layout === 'custom' ? 'your Button Setup' : pad.layout === 'generic' ? 'unusual layout: try Button Setup in Settings' : 'standard layout';
      this.labels[i].setText(`${pad.label} · ${pad.shortName} · ${layout}${pad.supportsVibration ? ' · rumble' : ''}`).setColor(CSS.cream);
      this.drawPad(pad, cx, cy + 20);
      if (pad.pressed('A')) pad.rumble(0.6, 0.6, 180);
    }
    // Hold B (any device) to leave, so B presses can still be tested.
    if (input.any.held('B')) {
      this.holdB += delta;
      if (this.holdB > 900) {
        this.holdB = -99999;
        audio.play('cancel');
        goTo(this, this.back);
      }
    } else if (this.holdB > 0) this.holdB = 0;
  }

  private drawPad(pad: GamepadDevice, cx: number, cy: number): void {
    const g = this.g;
    // body
    g.fillStyle(0x1f3f4c, 1);
    g.fillRoundedRect(cx - 200, cy - 70, 400, 150, 70);
    g.lineStyle(3, 0xfff4dc, 0.4);
    g.strokeRoundedRect(cx - 200, cy - 70, 400, 150, 70);
    for (const b of BUTTONS) {
      const pos = LAYOUT[b];
      if (!pos) continue;
      const [dx, dy, r] = pos;
      const on = pad.held(b);
      if (b === 'LB' || b === 'RB') {
        g.fillStyle(on ? COLORS.goldLight : 0x35535f, 1);
        g.fillRoundedRect(cx + dx - 44, cy + dy - 12, 88, 24, 10);
      } else if (r === 0) {
        g.fillStyle(on ? COLORS.goldLight : 0x35535f, 1);
        g.fillRoundedRect(cx + dx - 11, cy + dy - 11, 22, 22, 4);
      } else {
        g.fillStyle(on ? 0xffffff : FACE[b] ?? 0x35535f, on ? 1 : FACE[b] ? 0.85 : 1);
        g.fillCircle(cx + dx, cy + dy, r);
      }
    }
    // sticks with the dead-zone ring
    const dz = settings.get().deadzone;
    const sticks: [number, number, [number, number], boolean][] = [
      [cx - 60, cy + 40, pad.rawLeft, pad.held('LS')],
      [cx + 60, cy + 40, pad.rawRight, pad.held('RS')],
    ];
    for (const [sx, sy, raw, click] of sticks) {
      g.fillStyle(0x0c2630, 1);
      g.fillCircle(sx, sy, 30);
      g.lineStyle(2, COLORS.coral, 0.8);
      g.strokeCircle(sx, sy, 30 * dz);
      g.fillStyle(click ? COLORS.goldLight : 0xfff4dc, 1);
      g.fillCircle(sx + raw[0] * 24, sy + raw[1] * 24, 11);
    }
    // triggers
    const trig: [number, number][] = [
      [cx - 290, pad.lt],
      [cx + 262, pad.rt],
    ];
    for (const [tx, v] of trig) {
      g.fillStyle(0x0c2630, 1);
      g.fillRoundedRect(tx, cy - 70, 28, 150, 10);
      g.fillStyle(COLORS.crystal, 1);
      const h = 146 * Math.max(0, Math.min(1, v));
      g.fillRoundedRect(tx + 2, cy + 78 - h, 24, h, 8);
    }
  }

  /** A faded controller outline for an empty slot. */
  private drawEmpty(cx: number, cy: number): void {
    const g = this.g;
    g.fillStyle(0xfff4dc, 0.06);
    g.fillRoundedRect(cx - 200, cy - 70, 400, 150, 70);
    g.lineStyle(3, 0xfff4dc, 0.22);
    g.strokeRoundedRect(cx - 200, cy - 70, 400, 150, 70);
    g.strokeCircle(cx - 60, cy + 40, 30);
    g.strokeCircle(cx + 60, cy + 40, 30);
    for (const b of ['A', 'B', 'X', 'Y'] as Button[]) {
      const [dx, dy, r] = LAYOUT[b]!;
      g.strokeCircle(cx + dx, cy + dy, r);
    }
    g.strokeRoundedRect(cx - 164, cy - 104, 88, 24, 10);
    g.strokeRoundedRect(cx + 76, cy - 104, 88, 24, 10);
  }

  private drawKeyboard(cx: number, cy: number): void {
    const kb = input.keyboard;
    this.labels[3].setText('Keyboard').setColor(CSS.cream);
    const g = this.g;
    const shown: Button[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'MENU', 'VIEW'];
    shown.forEach((b, k) => {
      const x = cx - 330 + (k % 7) * 110;
      const y = cy - 40 + Math.floor(k / 7) * 110;
      const on = kb.held(b);
      g.fillStyle(on ? COLORS.goldLight : 0x35535f, 1);
      g.fillRoundedRect(x - 44, y - 34, 88, 68, 14);
    });
    // key names are static text: create once
    if (!this.data.get('kbText')) {
      shown.forEach((b, k) => {
        const x = cx - 330 + (k % 7) * 110;
        const y = cy - 40 + Math.floor(k / 7) * 110;
        addText(this, x, y, b, 20, { color: '#ffffff', weight: 700, stroke: '#06141a', strokeThickness: 3 }).setDepth(2);
      });
      this.data.set('kbText', true);
    }
  }
}
