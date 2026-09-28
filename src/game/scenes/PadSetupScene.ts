import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { CSS, GAME_HEIGHT, GAME_WIDTH } from '../constants';
import type { Button } from '../input/buttons';
import type { GamepadDevice } from '../input/GamepadManager';
import { input } from '../input/InputManager';
import { isHatRest, type PadMapping, type PadSource, type StickAxis } from '../input/padProfiles';
import { settings } from '../save/SettingsManager';
import { makeGlyph, PromptBar } from '../ui/ControllerPrompt';
import { buildBackdrop, drawNavyPanel } from '../ui/Screen';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';

type StickKey = 'lx' | 'ly' | 'rx' | 'ry';
type Step =
  | { kind: 'button'; button: Button; title: string; hint: string; optional: boolean }
  | { kind: 'stick'; axis: StickKey; glyph: 'STICK' | 'RSTICK'; title: string; hint: string; optional: boolean };

const STEPS: Step[] = [
  { kind: 'button', button: 'A', title: 'CONFIRM / JUMP', hint: 'Usually the bottom face button (the right one on Nintendo pads).', optional: false },
  { kind: 'button', button: 'B', title: 'BACK / DUCK', hint: 'Usually the right face button.', optional: false },
  { kind: 'button', button: 'X', title: 'ACTION', hint: 'Usually the left face button.', optional: true },
  { kind: 'button', button: 'Y', title: 'ITEMS', hint: 'Usually the top face button.', optional: true },
  { kind: 'button', button: 'UP', title: 'D-PAD UP', hint: 'Press up on the D-pad.', optional: true },
  { kind: 'button', button: 'DOWN', title: 'D-PAD DOWN', hint: 'Press down on the D-pad.', optional: true },
  { kind: 'button', button: 'LEFT', title: 'D-PAD LEFT', hint: 'Press left on the D-pad.', optional: true },
  { kind: 'button', button: 'RIGHT', title: 'D-PAD RIGHT', hint: 'Press right on the D-pad.', optional: true },
  { kind: 'stick', axis: 'lx', glyph: 'STICK', title: 'LEFT STICK: PUSH RIGHT', hint: 'Push the left stick all the way right, then let go.', optional: true },
  { kind: 'stick', axis: 'ly', glyph: 'STICK', title: 'LEFT STICK: PUSH DOWN', hint: 'Push the left stick all the way down, then let go.', optional: true },
  { kind: 'button', button: 'LB', title: 'LEFT BUMPER', hint: 'The upper left shoulder button.', optional: true },
  { kind: 'button', button: 'RB', title: 'RIGHT BUMPER', hint: 'The upper right shoulder button.', optional: true },
  { kind: 'button', button: 'LT', title: 'LEFT TRIGGER', hint: 'The lower left shoulder button or trigger.', optional: true },
  { kind: 'button', button: 'RT', title: 'RIGHT TRIGGER', hint: 'The lower right shoulder button or trigger.', optional: true },
  { kind: 'button', button: 'MENU', title: 'START / PAUSE', hint: 'Start, Options, Menu or +.', optional: true },
  { kind: 'button', button: 'VIEW', title: 'SELECT / SCORES', hint: 'Select, Share, View or -.', optional: true },
  { kind: 'stick', axis: 'rx', glyph: 'RSTICK', title: 'RIGHT STICK: PUSH RIGHT', hint: 'Push the right stick all the way right, then let go.', optional: true },
  { kind: 'stick', axis: 'ry', glyph: 'RSTICK', title: 'RIGHT STICK: PUSH DOWN', hint: 'Push the right stick all the way down, then let go.', optional: true },
];

/** An optional step skips itself after this long without input. */
const SKIP_MS = 5000;

/**
 * Button Setup: teaches the game an unusual controller. The player presses each button when asked
 * (raw buttons, axes and hat switches are all understood); the layout is saved for that controller
 * (by its Gamepad.id) and used from then on. Keyboard: Esc cancels, Space skips an optional step.
 */
export class PadSetupScene extends Phaser.Scene {
  private back = 'Settings';
  private pad: GamepadDevice | null = null;
  private phase: 'pick' | 'step' | 'done' = 'pick';
  private stepIndex = 0;
  private waitNeutral = true;
  private idleMs = 0;
  /** Where each raw axis rests, measured once after the pad is picked. */
  private rest: number[] = [];
  /** Axes recorded as triggers moving up from 0: some report 0 until first used, then rest at -1. */
  private quirkAxes = new Set<number>();
  private prevPressed = new Map<number, boolean[]>();
  private mapping: PadMapping = { buttons: {} };
  private used = new Map<string, string>();
  private titleText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private noteText!: Phaser.GameObjects.Text;
  private glyph: Phaser.GameObjects.Container | null = null;
  private bar!: Phaser.GameObjects.Graphics;
  private keys: { esc?: Phaser.Input.Keyboard.Key; space?: Phaser.Input.Keyboard.Key } = {};

  constructor() {
    super('PadSetup');
  }

  init(data: { back?: string } = {}): void {
    this.back = data.back ?? 'Settings';
    this.pad = null;
    this.phase = 'pick';
    this.stepIndex = 0;
    this.waitNeutral = true;
    this.idleMs = 0;
    this.prevPressed = new Map();
    this.mapping = { buttons: {} };
    this.used = new Map();
    this.rest = [];
    this.quirkAxes = new Set();
  }

  create(): void {
    enterScene(this);
    buildBackdrop(this, 'day');
    addTitle(this, GAME_WIDTH / 2, 74, 'BUTTON SETUP', 70);
    const g = this.add.graphics();
    drawNavyPanel(g, 360, 170, 1200, 700);
    this.infoText = addText(this, GAME_WIDTH / 2, 222, '', 26, { color: CSS.cream, weight: 600 });
    this.titleText = addText(this, GAME_WIDTH / 2, 470, '', 64, { color: '#ffffff', weight: 700, stroke: '#06141a', strokeThickness: 6 });
    this.hintText = addText(this, GAME_WIDTH / 2, 560, '', 30, { color: CSS.cream, weight: 600, wrap: 1040 });
    this.noteText = addText(this, GAME_WIDTH / 2, 650, '', 28, { color: CSS.goldLight, weight: 700 });
    this.bar = this.add.graphics();
    new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 44, [], { size: 34, fontSize: 22 });
    addText(this, GAME_WIDTH / 2, GAME_HEIGHT - 110, 'Keyboard: Esc cancels · Space skips a button your controller does not have', 22, { color: CSS.cream, weight: 600, stroke: '#06141a', strokeThickness: 4 });
    const kb = this.input.keyboard;
    if (kb) this.keys = { esc: kb.addKey('ESC'), space: kb.addKey('SPACE') };
    this.showPick();
  }

  private showPick(): void {
    this.phase = 'pick';
    this.infoText.setText(input.hasGamepad() ? '' : 'No controller found yet: connect one and press any of its buttons.');
    this.titleText.setText('PRESS ANY BUTTON');
    this.hintText.setText('on the controller you want to set up.');
    this.noteText.setText('');
    this.setGlyph(null);
  }

  private setGlyph(button: Button | 'STICK' | 'RSTICK' | null): void {
    this.glyph?.destroy();
    this.glyph = button ? makeGlyph(this, button, 110, 'xbox').setPosition(GAME_WIDTH / 2, 350) : null;
  }

  private showStep(): void {
    const st = STEPS[this.stepIndex];
    const p = this.pad!;
    this.infoText.setText(`${p.label} · ${p.shortName} · step ${this.stepIndex + 1} of ${STEPS.length}`);
    this.titleText.setText(st.title);
    this.hintText.setText(st.hint);
    this.noteText.setText('');
    this.setGlyph(st.kind === 'button' ? st.button : st.glyph);
    this.waitNeutral = true;
    this.idleMs = 0;
  }

  override update(_t: number, dt: number): void {
    if (this.keys.esc && Phaser.Input.Keyboard.JustDown(this.keys.esc)) {
      audio.play('cancel');
      goTo(this, this.back);
      return;
    }
    if (this.phase === 'pick') {
      for (const p of input.connectedPads()) {
        if (this.newlyPressed(p).length > 0) {
          this.pad = p;
          this.phase = 'step';
          this.stepIndex = 0;
          audio.play('confirm');
          this.showStep();
          break;
        }
      }
      if (this.phase === 'pick') this.infoText.setText(input.hasGamepad() ? '' : 'No controller found yet: connect one and press any of its buttons.');
      return;
    }
    if (this.phase !== 'step') return;
    const p = this.pad;
    if (!p || !p.connected) {
      this.noteText.setText('Controller disconnected.');
      this.pad = null;
      this.time.delayedCall(900, () => this.showPick());
      this.phase = 'done';
      return;
    }
    const st = STEPS[this.stepIndex];
    const pressedNow = this.newlyPressed(p);
    // Wait until everything is let go. The first time, that is where the axes rest.
    if (this.waitNeutral) {
      if (!p.rawButtons.some((b) => b.pressed || b.value > 0.5) && (this.rest.length === 0 || this.axesCentred(p))) {
        this.waitNeutral = false;
        if (this.rest.length === 0) this.rest = p.rawAxes.slice();
      }
      return;
    }
    const skip = this.keys.space && Phaser.Input.Keyboard.JustDown(this.keys.space);
    let captured: PadSource | StickAxis | null = null;
    if (st.kind === 'button') captured = this.captureButton(p, pressedNow);
    else captured = this.captureStick(p);
    if (captured) {
      const key = JSON.stringify(captured);
      const clash = this.used.get(st.kind === 'button' ? key : `axis${(captured as StickAxis).i}`);
      if (clash) {
        this.noteText.setText(`Already used for ${clash}: try another`);
        audio.play('error');
        this.waitNeutral = true;
        return;
      }
      if (st.kind === 'button') {
        const src = captured as PadSource;
        this.mapping.buttons[st.button] = src;
        this.used.set(key, st.title);
        if (src.t === 'a' && src.s === 1 && Math.abs(src.rest) < 0.1 && (st.button === 'LT' || st.button === 'RT')) this.quirkAxes.add(src.i);
      } else {
        this.mapping[st.axis] = captured as StickAxis;
        this.used.set(`axis${(captured as StickAxis).i}`, st.title);
      }
      audio.play('menuMove');
      this.advance();
      return;
    }
    if (skip && st.optional) {
      this.advance();
      return;
    }
    if (st.optional) {
      this.idleMs += dt;
      const f = Math.min(1, this.idleMs / SKIP_MS);
      this.bar.clear();
      this.bar.fillStyle(0xffffff, 0.15);
      this.bar.fillRoundedRect(GAME_WIDTH / 2 - 220, 720, 440, 12, 6);
      this.bar.fillStyle(0xffd45c, 0.9);
      this.bar.fillRoundedRect(GAME_WIDTH / 2 - 220, 720, 440 * f, 12, 6);
      this.noteText.setText('Not on your controller? Wait and it skips.');
      if (f >= 1) this.advance();
    }
  }

  private advance(): void {
    this.bar.clear();
    this.stepIndex++;
    if (this.stepIndex < STEPS.length) {
      this.showStep();
      return;
    }
    // Movement needs a D-pad or a left stick.
    const b = this.mapping.buttons;
    const canMove = (b.UP && b.DOWN && b.LEFT && b.RIGHT) || (this.mapping.lx && this.mapping.ly);
    if (!canMove) {
      this.noteText.setText('');
      this.stepIndex = STEPS.findIndex((s) => s.kind === 'button' && s.button === 'UP');
      for (const k of ['UP', 'DOWN', 'LEFT', 'RIGHT'] as const) delete b[k];
      delete this.mapping.lx;
      delete this.mapping.ly;
      this.showStep();
      this.noteText.setText('A D-pad or the left stick is needed to move: let’s set one up.');
      audio.play('error');
      return;
    }
    this.finish();
  }

  private finish(): void {
    this.phase = 'done';
    const p = this.pad!;
    settings.set({ padMappings: { ...settings.get().padMappings, [p.id]: this.mapping } });
    input.lockHeld();
    audio.play('ready');
    this.setGlyph(null);
    this.infoText.setText(`${p.label} · ${p.shortName}`);
    this.titleText.setText('ALL SET!');
    this.hintText.setText('This controller will use its new layout from now on (it is remembered for next time).');
    this.noteText.setText('');
    this.time.delayedCall(2200, () => goTo(this, this.back));
  }

  /** Raw button indices that went down this frame on a pad. */
  private newlyPressed(p: GamepadDevice): number[] {
    const now = p.rawButtons.map((b) => b.pressed || b.value > 0.5);
    const prev = this.prevPressed.get(p.index) ?? now.map(() => true);
    this.prevPressed.set(p.index, now);
    const out: number[] = [];
    now.forEach((d, i) => {
      if (d && !prev[i]) out.push(i);
    });
    return out;
  }

  /**
   * Every axis back where it rests: a hat centred again, anything else within 0.3 of its rest. A
   * trigger recorded from a resting 0 may settle at -1 instead (it reported 0 until first used).
   */
  private axesCentred(p: GamepadDevice): boolean {
    return p.rawAxes.every((v, i) => {
      const r = this.rest[i] ?? v;
      if (isHatRest(r)) return isHatRest(v);
      if (Math.abs(v - r) < 0.3) return true;
      if (this.quirkAxes.has(i) && Math.abs(r) < 0.1 && v <= -0.9) {
        this.rest[i] = v;
        return true;
      }
      return false;
    });
  }

  private captureButton(p: GamepadDevice, pressedNow: number[]): PadSource | null {
    if (pressedNow.length > 0) return { t: 'b', i: pressedNow[0] };
    for (let i = 0; i < p.rawAxes.length; i++) {
      const v = p.rawAxes[i];
      const r = this.rest[i] ?? 0;
      if (isHatRest(r)) {
        if (!isHatRest(v) && Math.abs(v - r) > 0.2) return { t: 'h', i, v: Math.round(v * 1000) / 1000 };
      } else if (Math.abs(v - r) > 0.6) {
        return { t: 'a', i, s: v > r ? 1 : -1, rest: Math.round(r * 1000) / 1000 };
      }
    }
    return null;
  }

  private captureStick(p: GamepadDevice): StickAxis | null {
    let best = -1;
    let bestD = 0.6;
    for (let i = 0; i < p.rawAxes.length; i++) {
      const r = this.rest[i] ?? 0;
      if (isHatRest(r)) continue;
      const d = Math.abs(p.rawAxes[i] - r);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return null;
    return { i: best, s: p.rawAxes[best] > (this.rest[best] ?? 0) ? 1 : -1 };
  }
}
