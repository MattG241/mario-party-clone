import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { animHeadTop, Character } from '../characters/Character';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { CHARACTER_IDS, CHARACTERS } from '../data/characters';
import { EffectsManager } from '../effects/EffectsManager';
import { slotForDevice } from '../input/assignment';
import { input, type DeviceRef } from '../input/InputManager';
import { settings } from '../save/SettingsManager';
import { session } from '../state/Session';
import { makeGlyph, PromptBar } from '../ui/ControllerPrompt';
import { drawPanel } from '../ui/Panel';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { applyGrade } from '../effects/GradePipeline';

type SlotPhase = 'empty' | 'choosing' | 'ready';

interface SlotView {
  phase: SlotPhase;
  device: DeviceRef | null;
  cursor: number;
  panel: Phaser.GameObjects.Container;
  content: Phaser.GameObjects.Container;
  cursorBadge: PlayerBadge;
}

const PODIUM_X = [360, 760, 1160, 1560];
const PODIUM_Y = 560;
const SLOT_W = 440;
const SLOT_H = 118;

/**
 * Controller-first lobby: press A to join, pick a character on the podiums, confirm. Every
 * joined player must confirm before continuing; a character can only be taken once.
 */
export class CharacterSelectScene extends Phaser.Scene {
  private slots: SlotView[] = [];
  private chars: Character[] = [];
  private glows: Phaser.GameObjects.Graphics[] = [];
  private renderedStage = false;
  private namePlates: Phaser.GameObjects.Container[] = [];
  private locked: (number | null)[] = [null, null, null, null]; // character index → slot
  private highlightCount = [0, 0, 0, 0];
  private fx!: EffectsManager;
  private startBanner!: Phaser.GameObjects.Container;
  private footer!: PromptBar;
  private leaving = false;

  constructor() {
    super('CharacterSelect');
  }

  create(): void {
    enterScene(this);
    applyGrade(this, { glow: 0.35, glowThreshold: 0.8, vignette: 0.2 });
    this.leaving = false;
    this.slots = [];
    this.chars = [];
    this.glows = [];
    this.namePlates = [];
    this.locked = [null, null, null, null];
    this.fx = new EffectsManager(this, 800);
    audio.playMusic('menu');
    this.renderedStage = this.textures.exists('rendered-scene-select');
    if (this.renderedStage) {
      // Its own sky: the clear variant, mirrored (the title and board use other skies).
      const skyKey = ['rendered-sky-clear', 'rendered-sky-day', 'rendered-sky-golden'].find((k) => this.textures.exists(k));
      if (skyKey) this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, skyKey).setDisplaySize(GAME_WIDTH * 1.04, GAME_HEIGHT * 1.04).setFlipX(true);
      this.add.image(0, 0, 'rendered-scene-select').setOrigin(0);
    } else {
      this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
      this.add.tileSprite(0, 520, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setAlpha(0.95);
    }
    addTitle(this, GAME_WIDTH / 2, 70, session.mode === 'board' ? 'CHOOSE YOUR ADVENTURERS' : 'MINIGAME MODE · CHOOSE YOUR PLAYERS', 64);
    this.buildPodiums();
    for (let i = 0; i < 4; i++) this.slots.push(this.buildSlot(i));
    this.startBanner = this.buildStartBanner();
    this.footer = new PromptBar(this, GAME_WIDTH / 2, 150, [], { size: 30, fontSize: 21 });
    // Restore players who are already joined (coming back from the setup screen).
    for (const cfg of session.slots) {
      if (cfg.joined && cfg.device && input.device(cfg.device)) {
        const idx = cfg.characterId ? CHARACTER_IDS.indexOf(cfg.characterId) : 0;
        this.join(cfg.slot, cfg.device, idx, true);
        if (cfg.characterId) this.confirm(cfg.slot, true);
      }
    }
    this.refreshFooter();
  }

  private buildPodiums(): void {
    CHARACTER_IDS.forEach((id, i) => {
      const x = PODIUM_X[i];
      if (!this.renderedStage) this.add.image(x, PODIUM_Y + 40, 'podium').setScale(0.95);
      const glow = this.add.graphics({ x, y: PODIUM_Y - 30 });
      this.glows.push(glow);
      const c = new Character(this, x, PODIUM_Y - 20, id, { scale: 1.02 });
      c.setDepth(10);
      this.chars.push(c);
      const plate = this.add.container(x, PODIUM_Y + 150);
      const g = this.add.graphics();
      g.fillStyle(0x06141a, 0.3);
      g.fillRoundedRect(-160 + 4, -40 + 7, 320, 80, 40);
      g.fillStyle(0x0c2630, 0.86);
      g.fillRoundedRect(-160, -40, 320, 80, 40);
      g.fillStyle(0xffffff, 0.07);
      g.fillRoundedRect(-152, -35, 304, 32, { tl: 34, tr: 34, bl: 8, br: 8 });
      g.lineStyle(4, CHARACTERS[id].color, 1);
      g.strokeRoundedRect(-160, -40, 320, 80, 40);
      const name = addText(this, 0, -11, CHARACTERS[id].name.toUpperCase(), 30, { color: CSS.cream, weight: 700 });
      const role = addText(this, 0, 20, CHARACTERS[id].role, 18, { color: CSS.creamDark, weight: 600 });
      plate.add([g, name, role]);
      plate.setScale(0.94);
      this.namePlates.push(plate);
    });
  }

  private buildSlot(slot: number): SlotView {
    const w = SLOT_W;
    const h = SLOT_H;
    const x = 255 + slot * 470;
    const y = 988;
    const panel = this.add.container(x, y);
    const g = this.add.graphics();
    g.fillStyle(0x06141a, 0.3);
    g.fillRoundedRect(-w / 2 + 4, -h / 2 + 7, w, h, 34);
    g.fillStyle(0x0c2630, 0.84);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 34);
    g.fillStyle(0xffffff, 0.07);
    g.fillRoundedRect(-w / 2 + 8, -h / 2 + 5, w - 16, h * 0.4, { tl: 28, tr: 28, bl: 10, br: 10 });
    g.lineStyle(4, PLAYER_COLORS[slot], 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 34);
    const badge = new PlayerBadge(this, -w / 2 + 40, -h / 2 + 34, slot, 20);
    const label = addText(this, -w / 2 + 72, -h / 2 + 34, `PLAYER ${slot + 1}`, 22, { color: CSS.cream, weight: 700, align: 'left' });
    const content = this.add.container(0, 22);
    panel.add([g, badge, label, content]);
    const cursorBadge = new PlayerBadge(this, 0, 0, slot, 24).setVisible(false).setDepth(50);
    const view: SlotView = { phase: 'empty', device: null, cursor: 0, panel, content, cursorBadge };
    this.renderSlot(slot, view);
    return view;
  }

  private renderSlot(slot: number, v: SlotView = this.slots[slot]): void {
    v.content.removeAll(true);
    const add = (o: Phaser.GameObjects.GameObject) => v.content.add(o);
    if (v.phase === 'empty') {
      const glyphKind = input.hasGamepad() ? 'gamepad' : 'keyboard';
      const glyph = makeGlyph(this, 'A', 40, glyphKind);
      const label = addText(this, 0, 0, 'TO JOIN', 28, { color: CSS.cream, weight: 700, align: 'left' });
      // Centre "[glyph] TO JOIN" as one line using the glyph's real width (key caps are wider).
      const gw = glyph.width || 44;
      const total = gw + 12 + label.width;
      glyph.setPosition(-total / 2 + gw / 2, 0);
      label.setX(-total / 2 + gw + 12);
      add(glyph);
      add(label);
      this.tweens.add({ targets: glyph, scale: { from: 1, to: 1.12 }, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      return;
    }
    const icon = this.add.image(-SLOT_W / 2 + 46, 2, v.device?.kind === 'keyboard' ? 'icon-keyboard' : 'icon-controller').setScale(0.26);
    add(icon);
    const id = CHARACTER_IDS[v.cursor];
    if (v.phase === 'choosing') {
      add(addText(this, 18, -8, `◀  ${CHARACTERS[id].name}  ▶`, 26, { color: CSS.cream, weight: 700 }));
      const bar = new PromptBar(this, 18, 26, [
        { button: 'A', label: 'Pick' },
        { button: 'B', label: 'Leave' },
      ], { size: 24, fontSize: 16, color: CSS.creamDark, slot });
      // The slot panel is already the backing; drop the bar's own pill.
      bar.list.filter((o) => o instanceof Phaser.GameObjects.Graphics).forEach((o) => o.destroy());
      add(bar);
    } else {
      const stamp = addText(this, -30, -2, 'READY!', 38, { color: CSS.goldLight, stroke: '#06141a', strokeThickness: 6, weight: 700 });
      add(stamp);
      add(addText(this, 70, -8, CHARACTERS[id].name, 20, { color: CSS.cream, weight: 700, align: 'left' }));
      const bar = new PromptBar(this, 120, 20, [{ button: 'B', label: 'Change' }], { size: 22, fontSize: 15, color: CSS.creamDark, slot });
      bar.list.filter((o) => o instanceof Phaser.GameObjects.Graphics).forEach((o) => o.destroy());
      add(bar);
      stamp.setScale(1.6).setAngle(-6);
      this.tweens.add({ targets: stamp, scale: 1, duration: 260, ease: 'Back.Out' });
    }
  }

  private buildStartBanner(): Phaser.GameObjects.Container {
    const c = this.add.container(GAME_WIDTH / 2, 150).setDepth(100).setVisible(false);
    const g = this.add.graphics();
    drawPanel(g, -440, -44, 880, 88, { radius: 40, border: COLORS.gold, fill: COLORS.tealDark, accent: COLORS.goldLight, engraving: false });
    const t = addText(this, 0, -2, 'All set! Press A to continue', 38, { color: CSS.cream, weight: 700 });
    c.add([g, t]);
    this.tweens.add({ targets: c, scale: { from: 1, to: 1.04 }, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    return c;
  }

  // --- Slot actions -------------------------------------------------------------------------
  private preferredSlot(ref: DeviceRef): number {
    return slotForDevice(ref, this.slots.map((s) => s.phase === 'empty'));
  }

  private join(slot: number, ref: DeviceRef, cursor?: number, silent = false): void {
    const v = this.slots[slot];
    v.phase = 'choosing';
    v.device = ref;
    input.assign(slot, ref);
    const remembered = settings.get().lastCharacters[slot];
    let c = cursor ?? (remembered ? CHARACTER_IDS.indexOf(remembered) : slot);
    if (c < 0) c = 0;
    // Start on a free character.
    for (let k = 0; k < 4 && this.locked[c] !== null; k++) c = (c + 1) % 4;
    v.cursor = c;
    const cfg = session.slots[slot];
    cfg.joined = true;
    cfg.device = ref;
    cfg.isCpu = false;
    cfg.characterId = null;
    if (!silent) {
      audio.play('join', { rate: 1 + slot * 0.08 });
      input.rumbleSlot(slot, 0.3, 0.5, 120);
      this.tweens.add({ targets: v.panel, scale: { from: 1.08, to: 1 }, duration: 260, ease: 'Back.Out' });
      this.fx.sparks(v.panel.x, v.panel.y - 60, 20);
    }
    v.cursorBadge.setVisible(true);
    this.moveCursor(slot, 0, true);
    this.renderSlot(slot);
    this.refreshFooter();
  }

  private leave(slot: number): void {
    const v = this.slots[slot];
    v.phase = 'empty';
    v.device = null;
    v.cursorBadge.setVisible(false);
    input.assign(slot, null);
    const cfg = session.slots[slot];
    cfg.joined = false;
    cfg.device = null;
    cfg.characterId = null;
    audio.play('leave');
    this.renderSlot(slot);
    this.refreshHighlights();
    this.refreshFooter();
  }

  private moveCursor(slot: number, dir: number, silent = false): void {
    const v = this.slots[slot];
    if (dir !== 0) {
      let c = v.cursor;
      for (let k = 0; k < 4; k++) {
        c = (c + dir + 4) % 4;
        if (this.locked[c] === null) break;
      }
      if (c === v.cursor) return;
      v.cursor = c;
      if (!silent) audio.play('menuMove');
    }
    const ch = this.chars[v.cursor];
    if (ch.current === 'idle' || ch.current === 'wave') ch.play('wave', { force: true });
    this.refreshHighlights();
    this.renderSlot(slot);
  }

  private confirm(slot: number, silent = false): void {
    const v = this.slots[slot];
    if (this.locked[v.cursor] !== null) {
      audio.play('error');
      return;
    }
    v.phase = 'ready';
    this.locked[v.cursor] = slot;
    const id = CHARACTER_IDS[v.cursor];
    session.slots[slot].characterId = id;
    const last = [...settings.get().lastCharacters];
    last[slot] = id;
    settings.set({ lastCharacters: last });
    const ch = this.chars[v.cursor];
    ch.play('celebrate', { force: true });
    if (!silent) {
      audio.play('ready');
      input.rumbleSlot(slot, 0.5, 0.6, 160);
      this.fx.confetti(ch.x, ch.y - 200, 40);
      this.fx.vfx('goldSwirl', ch.x, ch.y - 60, { scale: 0.9, blend: 'add', alpha: 0.8 });
    }
    // Other players standing on this character get pushed to a free one.
    this.slots.forEach((o, i) => {
      if (i !== slot && o.phase === 'choosing' && o.cursor === v.cursor) this.moveCursor(i, 1, true);
    });
    this.renderSlot(slot);
    this.refreshHighlights();
    this.refreshFooter();
  }

  private unconfirm(slot: number): void {
    const v = this.slots[slot];
    v.phase = 'choosing';
    this.locked[v.cursor] = null;
    session.slots[slot].characterId = null;
    audio.play('cancel');
    this.renderSlot(slot);
    this.refreshHighlights();
    this.refreshFooter();
  }

  private refreshHighlights(): void {
    this.highlightCount = [0, 0, 0, 0];
    const perChar: number[][] = [[], [], [], []];
    this.slots.forEach((v, i) => {
      if (v.phase !== 'empty') {
        this.highlightCount[v.cursor]++;
        perChar[v.cursor].push(i);
      }
    });
    CHARACTER_IDS.forEach((_, ci) => {
      const g = this.glows[ci];
      g.clear();
      const owners = perChar[ci];
      const lockedBy = this.locked[ci];
      const active = owners.length > 0;
      if (active) {
        owners.forEach((slot, k) => {
          // Selection ring lying on the pedestal's top face.
          g.fillStyle(PLAYER_COLORS[slot], 0.3);
          g.fillEllipse(0, 30, 216 - k * 30, 54 - k * 8);
          g.lineStyle(6, PLAYER_COLORS[slot], 1);
          g.strokeEllipse(0, 30, 226 - k * 34, 58 - k * 9);
        });
      }
      const ch = this.chars[ci];
      const target = active ? 1.12 : 1.02;
      this.tweens.add({ targets: ch, scale: target, duration: 180, ease: 'Back.Out' });
      // Characters nobody is pointing at (or has picked) step back into the shade.
      const lit = active || lockedBy !== null || this.slots.every((v) => v.phase === 'empty');
      if (lit) ch.sprite.clearTint();
      else ch.sprite.setTint(0x7d8196);
      const plate = this.namePlates[ci];
      this.tweens.add({ targets: plate, scale: active || lockedBy !== null ? 1 : 0.94, duration: 160 });
      // Cursor badges hover above the head, side by side.
      owners.forEach((slot, k) => {
        if (this.slots[slot].phase !== 'choosing') return;
        const b = this.slots[slot].cursorBadge;
        const tx = PODIUM_X[ci] + (k - (owners.length - 1) / 2) * 62;
        b.setVisible(this.slots[slot].phase === 'choosing');
        this.tweens.add({ targets: b, x: tx, y: PODIUM_Y - 20 + animHeadTop(CHARACTER_IDS[ci]) * 1.12 - 44, duration: 140, ease: 'Quad.Out' });
      });
      if (lockedBy !== null) {
        g.fillStyle(PLAYER_COLORS[lockedBy], 0.5);
        g.fillEllipse(0, 50, 250, 70);
      }
    });
    // Ready badges sit on the podium.
    for (const v of this.slots) {
      if (v.phase !== 'ready') continue;
      this.tweens.killTweensOf(v.cursorBadge);
      v.cursorBadge.setVisible(true).setPosition(PODIUM_X[v.cursor], PODIUM_Y + 66);
    }
  }

  private allReady(): boolean {
    const joined = this.slots.filter((s) => s.phase !== 'empty');
    return joined.length > 0 && joined.every((s) => s.phase === 'ready');
  }

  private refreshFooter(): void {
    const ready = this.allReady();
    this.startBanner.setVisible(ready);
    this.footer.setVisible(!ready);
    const anyJoined = this.slots.some((s) => s.phase !== 'empty');
    this.footer.setPrompts(anyJoined ? [{ button: 'A', label: 'Join / Pick' }, { button: 'B', label: 'Leave' }] : [{ button: 'A', label: 'Join' }, { button: 'B', label: 'Back to title' }]);
  }

  private proceed(): void {
    if (this.leaving) return;
    this.leaving = true;
    audio.play('confirm');
    goTo(this, session.mode === 'board' ? 'GameSetup' : 'MinigameMode');
  }

  // --- Frame --------------------------------------------------------------------------------
  override update(): void {
    if (this.leaving) return;
    // New players joining with A (that same press must not also pick a character).
    const joinedNow = new Set<number>();
    for (const ref of input.devicesPressing('A')) {
      if (input.slotOf(ref) !== null) continue;
      const slot = this.preferredSlot(ref);
      if (slot >= 0) {
        this.join(slot, ref);
        joinedNow.add(slot);
      }
    }
    // Unjoined device pressing B returns to the title (only when nobody has joined).
    for (const ref of input.devicesPressing('B')) {
      if (input.slotOf(ref) === null && !this.slots.some((s) => s.phase !== 'empty')) {
        audio.play('cancel');
        this.leaving = true;
        goTo(this, 'Title');
        return;
      }
    }
    // Joined players drive their own cursor.
    this.slots.forEach((v, slot) => {
      if (v.phase === 'empty' || !v.device || joinedNow.has(slot)) return;
      const dev = input.device(v.device);
      if (!dev) {
        // Controller unplugged on the lobby: free the slot.
        if (v.phase === 'ready') this.locked[v.cursor] = null;
        this.leave(slot);
        return;
      }
      if (v.phase === 'choosing') {
        const nav = dev.nav();
        if (nav === 'left') this.moveCursor(slot, -1);
        else if (nav === 'right') this.moveCursor(slot, 1);
        if (dev.pressed('A')) this.confirm(slot);
        else if (dev.pressed('B')) this.leave(slot);
      } else if (v.phase === 'ready') {
        if (dev.pressed('B')) this.unconfirm(slot);
        else if ((dev.pressed('A') || dev.pressed('MENU')) && this.allReady()) this.proceed();
      }
    });
  }
}
