import Phaser from 'phaser';
import { LITE, type GraphicsMode } from '../perf';
import { audio } from '../audio/AudioManager';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, type GameSpeed, type InstructionMode } from '../constants';
import { KEY_ACTION_LABELS, KEY_ACTIONS, keyLabel, type KeyAction } from '../input/buttons';
import { input } from '../input/InputManager';
import { settings } from '../save/SettingsManager';
import { PromptBar } from '../ui/ControllerPrompt';
import { Menu, type MenuItem } from '../ui/Menu';
import { buildBackdrop, drawNavyPanel } from '../ui/Screen';
import { addGradientTitle, addText } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const onOff = (v: boolean) => (v ? 'On' : 'Off');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const clamp01 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10) / 10;

/**
 * Settings: audio, controller feel, accessibility and match defaults, plus keyboard rebinding and
 * a jump to the controller tester. Everything saves immediately.
 */
export class SettingsScene extends Phaser.Scene {
  private menu!: Menu;
  private hint!: Phaser.GameObjects.Text;
  private hintTitle!: Phaser.GameObjects.Text;
  private bindLayer: Phaser.GameObjects.Container | null = null;
  private bindMenu: Menu | null = null;
  private resetArmed = false;
  private back = 'Title';

  constructor() {
    super('Settings');
  }

  init(data: { back?: string } = {}): void {
    this.back = data.back ?? 'Title';
    this.bindLayer = null;
    this.bindMenu = null;
    this.resetArmed = false;
  }

  create(): void {
    enterScene(this);
    audio.playMusic('menu');
    buildBackdrop(this, 'golden');
    addGradientTitle(this, GAME_WIDTH / 2, 74, 'SETTINGS', 72);

    const g = this.add.graphics();
    drawNavyPanel(g, 120, 150, 980, 820, { gloss: true });
    drawNavyPanel(g, 1160, 150, 640, 820, { header: { color: COLORS.tealDark }, gloss: true });
    this.hintTitle = addText(this, 1200, 186, '', 28, { color: '#ffffff', weight: 700, align: 'left', stroke: '#06141a', strokeThickness: 4 });
    this.hint = addText(this, 1200, 300, '', 26, { color: CSS.cream, weight: 600, align: 'left', wrap: 560 });
    this.hint.setOrigin(0, 0);

    const s = () => settings.get();
    const items: MenuItem[] = [
      { label: 'Master Volume', value: () => pct(s().masterVolume), onChange: (d) => settings.set({ masterVolume: clamp01(s().masterVolume + d * 0.1) }), hint: 'Overall loudness of the game.' },
      { label: 'Music Volume', value: () => pct(s().musicVolume), onChange: (d) => settings.set({ musicVolume: clamp01(s().musicVolume + d * 0.1) }), hint: 'Background music level.' },
      { label: 'Effects Volume', value: () => pct(s().sfxVolume), onChange: (d) => { settings.set({ sfxVolume: clamp01(s().sfxVolume + d * 0.1) }); audio.play('menuMove'); }, hint: 'Sound effects level (you will hear a sample as you change it).' },
      { label: 'Vibration', value: () => onOff(s().vibration), onChange: () => { settings.set({ vibration: !s().vibration }); if (s().vibration) input.rumbleAll(0.4, 0.4, 120); }, hint: 'Controller rumble for hits, landings and big moments.' },
      {
        label: 'Stick Dead Zone',
        value: () => pct(s().deadzone),
        onChange: (d) => settings.set({ deadzone: Math.round(Math.min(0.3, Math.max(0.1, s().deadzone + d * 0.02)) * 100) / 100 }),
        hint: 'How far a stick must move before it counts. Raise it if your character drifts on its own.',
      },
      { label: 'Screen Shake', value: () => onOff(s().screenShake), onChange: () => settings.set({ screenShake: !s().screenShake }), hint: 'Camera shake on impacts and explosions.' },
      { label: 'Reduced Motion', value: () => onOff(s().reducedMotion), onChange: () => settings.set({ reducedMotion: !s().reducedMotion }), hint: 'Shorter camera moves and fewer pulsing effects.' },
      { label: 'Large Text', value: () => onOff(s().largeText), onChange: () => settings.set({ largeText: !s().largeText }), hint: 'Bigger text across menus and the board (applies on the next screen).' },
      { label: 'Game Speed', value: () => cap(s().gameSpeed), onChange: () => settings.set({ gameSpeed: (s().gameSpeed === 'normal' ? 'fast' : 'normal') as GameSpeed }), hint: 'Fast shortens board animations and CPU thinking time.' },
      {
        label: 'Graphics',
        value: () => ({ auto: LITE ? 'Auto (Lite)' : 'Auto (Full)', full: 'Full detail', lite: 'Lite' })[s().graphics],
        onChange: (d) => {
          const order: GraphicsMode[] = ['auto', 'lite', 'full'];
          const next = order[(order.indexOf(s().graphics) + (d < 0 ? order.length - 1 : 1)) % order.length];
          settings.set({ graphics: next });
          // Textures are chosen when the game loads, so apply it with a quick restart.
          this.time.delayedCall(350, () => window.location.reload());
        },
        hint: 'Lite loads smaller art and turns off heavy effects, for TV browsers and other low-power devices. Auto picks Lite on TVs and slow devices. Changing it restarts the game (a board game in progress can be continued).',
      },
      {
        label: 'Minigame Instructions',
        value: () => cap(s().instructions),
        onChange: (d) => {
          const order: InstructionMode[] = ['on', 'quick', 'off'];
          settings.set({ instructions: order[(order.indexOf(s().instructions) + d + 3) % 3] });
        },
        hint: 'On: full instruction screen · Quick: controls only · Off: straight to the countdown.',
      },
      { label: 'Keyboard Controls', onSelect: () => this.openBindings(), hint: 'Rebind the keyboard keys for every action.' },
      { label: 'Test Controllers', onSelect: () => goTo(this, 'GamepadDebug', { back: 'Settings' }), hint: 'See every connected controller and check buttons, sticks and triggers live.' },
      { label: 'Controller Button Setup', onSelect: () => goTo(this, 'PadSetup', { back: 'Settings' }), hint: 'Buttons on a controller doing the wrong thing? Press each button when asked and the game remembers that controller\u2019s layout.' },
      {
        label: 'Nintendo Controllers',
        value: () => (s().nintendoByLabel ? 'A confirms' : 'Bottom confirms'),
        onChange: () => settings.set({ nintendoByLabel: !s().nintendoByLabel }),
        hint: 'Switch Pro Controllers and Joy-Cons: confirm with the button labelled A (Nintendo style) or with the bottom face button (like Xbox and PlayStation).',
      },
      {
        label: () => `Forget Button Setups (${Object.keys(s().padMappings).length})`,
        onSelect: () => {
          settings.set({ padMappings: {} });
          audio.play('confirm');
          this.menu.refresh();
        },
        hint: 'Clear every layout recorded with Controller Button Setup (controllers go back to their automatic layout).',
      },
      { label: () => (this.resetArmed ? 'Press again to reset' : 'Reset to Defaults'), onSelect: () => this.reset(), hint: 'Restore every setting (and the keyboard layout) to its default.' },
      { label: 'BACK', onSelect: () => this.leave(), hint: 'Return to the previous screen.' },
    ];
    this.menu = new Menu(this, 610, 560, items, {
      width: 900,
      itemHeight: 42,
      gap: 5,
      fontSize: 23,
      onCancel: () => this.leave(),
      onFocus: (it) => this.showHint(it),
    });
    this.showHint(items[0]);
    new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 44, [
      { button: 'STICK', label: 'Choose' },
      { button: 'LEFT', label: 'Change' },
      { button: 'A', label: 'Select' },
      { button: 'B', label: 'Back' },
    ], { size: 34, fontSize: 22 });
  }

  private showHint(it: MenuItem): void {
    const label = typeof it.label === 'function' ? it.label() : it.label;
    this.hintTitle.setText(label.toUpperCase());
    this.hint.setText(it.hint ?? '');
    // Moving off the reset row disarms it.
    const onReset = label === 'Reset to Defaults' || label.startsWith('Press again');
    if (!onReset && this.resetArmed) {
      this.resetArmed = false;
      this.menu?.refresh();
    }
  }

  private reset(): void {
    if (!this.resetArmed) {
      this.resetArmed = true;
      audio.play('eventAlert', { volume: 0.5 });
      this.menu.refresh();
      return;
    }
    this.resetArmed = false;
    settings.resetAll();
    audio.play('confirm');
    this.menu.refresh();
  }

  private leave(): void {
    if (this.bindLayer) {
      this.closeBindings();
      return;
    }
    audio.play('cancel');
    goTo(this, this.back);
  }

  // --- Keyboard rebinding -------------------------------------------------------------------
  private openBindings(): void {
    const layer = this.add.container(0, 0).setDepth(100);
    const g = this.add.graphics();
    g.fillStyle(0x06141a, 0.6);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    drawNavyPanel(g, 360, 110, 1200, 860, { header: { color: COLORS.coral }, gloss: true });
    layer.add(g);
    layer.add(addText(this, 400, 146, 'KEYBOARD CONTROLS', 30, { color: '#ffffff', weight: 700, align: 'left', stroke: '#06141a', strokeThickness: 4 }));
    const status = addText(this, 960, 930, 'Select an action, then press the new key · Esc cancels', 22, { color: CSS.creamDark, weight: 600 });
    layer.add(status);
    const binding = (a: KeyAction) => (settings.get().keyBindings[a] ?? []).map(keyLabel).join(' / ') || '—';
    const items: MenuItem[] = KEY_ACTIONS.map((a) => ({
      label: KEY_ACTION_LABELS[a],
      value: () => binding(a),
      onSelect: () => {
        status.setText(`Press a key for "${KEY_ACTION_LABELS[a]}"…`).setColor(CSS.goldLight);
        if (this.bindMenu) this.bindMenu.enabled = false;
        input.keyboard.captureNextKey((code) => {
          this.time.delayedCall(120, () => {
            if (this.bindMenu) this.bindMenu.enabled = true;
          });
          if (code === 'Escape') {
            status.setText('Cancelled').setColor(CSS.creamDark);
            return;
          }
          const all = { ...settings.get().keyBindings };
          // A key can only do one job: remove it from any other action first.
          for (const k of KEY_ACTIONS) all[k] = (all[k] ?? []).filter((c) => c !== code);
          all[a] = [code, ...(all[a] ?? []).filter((c) => c !== code)].slice(0, 2);
          settings.set({ keyBindings: all });
          audio.play('confirm');
          status.setText(`${KEY_ACTION_LABELS[a]} → ${keyLabel(code)}`).setColor(CSS.crystal);
          this.bindMenu?.refresh();
        });
      },
    }));
    items.push({ label: 'Restore Default Keys', onSelect: () => { settings.resetBindings(); audio.play('confirm'); this.bindMenu?.refresh(); } });
    items.push({ label: 'DONE', onSelect: () => this.closeBindings() });
    this.bindMenu = new Menu(this, 960, 540, items, { width: 1080, itemHeight: 36, gap: 4, fontSize: 20, onCancel: () => this.closeBindings() });
    layer.add(this.bindMenu);
    this.bindLayer = layer;
    this.menu.enabled = false;
  }

  private closeBindings(): void {
    input.keyboard.cancelCapture();
    this.bindLayer?.destroy();
    this.bindLayer = null;
    this.bindMenu = null;
    this.time.delayedCall(80, () => (this.menu.enabled = true));
    audio.play('cancel');
  }

  override update(): void {
    if (this.bindMenu) {
      if (!input.keyboard.capturing) this.bindMenu.handle(input.any);
      return;
    }
    this.menu.handle(input.any);
  }
}
