import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { Character } from '../characters/Character';
import { GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { CHARACTER_IDS, CHARACTERS, type CharacterId } from '../data/characters';
import { EffectsManager } from '../effects/EffectsManager';
import { slotForDevice } from '../input/assignment';
import { input, type DeviceRef } from '../input/InputManager';
import { settings } from '../save/SettingsManager';
import { session } from '../state/Session';
import { glyphKindFor, makeGlyph, PromptBar } from '../ui/ControllerPrompt';
import { PlayerBadge } from '../ui/PlayerBadge';
import { placePortraitSprite } from '../ui/Portrait';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { applyGrade } from '../effects/GradePipeline';
import { drawCard, UI } from '../ui/Style';
import { addStrip } from '../ui/Screen';
import { rosterLayout, type RosterLayout } from '../ui/rosterLayout';

type SlotPhase = 'empty' | 'choosing' | 'ready';

interface SlotView {
  phase: SlotPhase;
  device: DeviceRef | null;
  /** Index into CHARACTER_IDS of the character this player is pointing at (or has picked). */
  cursor: number;
  panel: Phaser.GameObjects.Container;
  content: Phaser.GameObjects.Container;
  /** The player's pick, standing on their pedestal. */
  hero: Character | null;
}

/**
 * The rendered stage is shown enlarged about a point under the title, so the heroes and pedestals
 * fill more of the screen and less empty lawn shows above the player cards.
 */
const STAGE_K = 1.12;
const STAGE_AY = 120;
const stageX = (x: number) => GAME_WIDTH / 2 + (x - GAME_WIDTH / 2) * STAGE_K;
const stageY = (y: number) => STAGE_AY + (y - STAGE_AY) * STAGE_K;
/** One pedestal per player, left to right. */
const PODIUM_X = [360, 760, 1160, 1560].map(stageX);
const PODIUM_Y = stageY(560);
/** Character scale on the pedestals. */
const CHAR_K = 1.3;
const CARD_Y = 772;
const CARD_W = 410;
const CARD_H = 104;
/** Roster tiles along the bottom. */

/**
 * Controller-first lobby: press A to join, move along the roster, confirm. Each player's pick
 * stands on their own pedestal; every joined player must confirm before continuing, and a
 * character can only be taken once.
 */
export class CharacterSelectScene extends Phaser.Scene {
  private slots: SlotView[] = [];
  private glows: Phaser.GameObjects.Graphics[] = [];
  private pools: Phaser.GameObjects.Image[] = [];
  /** A soft "?" floating over each pedestal until its player joins. */
  private vacant: Phaser.GameObjects.Container[] = [];
  private tileRings: Phaser.GameObjects.Graphics[] = [];
  private tileBadges: Phaser.GameObjects.Container[] = [];
  private layout!: RosterLayout;
  private renderedStage = false;
  /** Character index → the slot that picked it. */
  private locked = new Map<number, number>();
  private fx!: EffectsManager;
  private startBanner!: Phaser.GameObjects.Container;
  private footer!: PromptBar;
  private leaving = false;

  constructor() {
    super('CharacterSelect');
  }

  create(): void {
    enterScene(this);
    applyGrade(this, { vignette: 0.08 });
    this.leaving = false;
    this.slots = [];
    this.glows = [];
    this.pools = [];
    this.vacant = [];
    this.tileRings = [];
    this.tileBadges = [];
    this.layout = rosterLayout(CHARACTER_IDS.length);
    this.locked = new Map();
    this.fx = new EffectsManager(this, 800);
    audio.playMusic('menu');
    this.renderedStage = this.textures.exists('rendered-scene-select');
    if (this.renderedStage) {
      // Its own sky: the clear variant, mirrored (the title and board use other skies).
      const skyKey = ['rendered-sky-clear', 'rendered-sky-day', 'rendered-sky-golden'].find((k) => this.textures.exists(k));
      if (skyKey) this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, skyKey).setDisplaySize(GAME_WIDTH * 1.04, GAME_HEIGHT * 1.04).setFlipX(true);
      this.add.image(stageX(0), stageY(0), 'rendered-scene-select').setOrigin(0).setScale(STAGE_K);
    } else {
      this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
      addStrip(this, 0, 520, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setAlpha(0.95);
    }
    addTitle(this, GAME_WIDTH / 2, 70, session.mode === 'board' ? 'CHOOSE YOUR ADVENTURERS' : 'MINIGAME MODE · CHOOSE YOUR PLAYERS', 64);
    this.buildPedestals();
    this.buildRoster();
    for (let i = 0; i < 4; i++) this.slots.push(this.buildSlot(i));
    this.startBanner = this.buildStartBanner();
    this.footer = new PromptBar(this, GAME_WIDTH / 2, 150, [], { size: 30, fontSize: 21 });
    // Restore players who are already joined (coming back from the setup screen).
    for (const cfg of session.slots) {
      if (cfg.joined && cfg.device && input.device(cfg.device)) {
        const idx = cfg.characterId ? CHARACTER_IDS.indexOf(cfg.characterId) : -1;
        this.join(cfg.slot, cfg.device, idx >= 0 ? idx : undefined, true);
        if (cfg.characterId && idx >= 0) this.confirm(cfg.slot, true);
      }
    }
    this.refreshHighlights();
    this.refreshFooter();
  }

  // --- Layout ---------------------------------------------------------------------------------
  private buildPedestals(): void {
    // Empty pedestals show a pale hologram of a random character until their player joins.
    const ghosts = Phaser.Utils.Array.Shuffle(CHARACTER_IDS.slice());
    PODIUM_X.forEach((x, i) => {
      if (!this.renderedStage) this.add.image(x, PODIUM_Y + 40, 'podium').setScale(0.95);
      // A soft pool of light on the pedestal top once a player stands there.
      const pool = this.add.image(x, PODIUM_Y - 2 * STAGE_K, 'fx-dot').setScale(9.5 * STAGE_K, 2.6 * STAGE_K).setTint(0xfff1cf).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      this.pools.push(pool);
      this.glows.push(this.add.graphics({ x, y: PODIUM_Y - 30 * STAGE_K }).setScale(STAGE_K));
      const holo = new Character(this, 0, 0, ghosts[i % ghosts.length], { scale: CHAR_K, shadow: false });
      holo.sprite.setTintFill(0xc9f3ff).setAlpha(0.3);
      const beam = this.add.image(0, -120, 'fx-dot').setScale(3.4, 9).setTint(0x9fe8ff).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.18);
      const vacant = this.add.container(x, PODIUM_Y - 20 * STAGE_K, [beam, holo]).setDepth(9);
      this.tweens.add({ targets: holo, y: -10, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.tweens.add({ targets: holo.sprite, alpha: { from: 0.3, to: 0.18 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.vacant.push(vacant);
    });
  }

  /** Portrait tiles for every character, in one or two rows along the bottom of the screen. */
  private buildRoster(): void {
    const { k, w, h, pos } = this.layout;
    const back = this.add.graphics().setDepth(19);
    back.fillStyle(0x0a1a26, 0.34);
    const left = Math.min(...pos.map((p) => p.x)) - w / 2 - 22;
    const right = Math.max(...pos.map((p) => p.x)) + w / 2 + 22;
    const top = Math.min(...pos.map((p) => p.y)) - h / 2 - 14;
    const bottom = Math.max(...pos.map((p) => p.y)) + h / 2 + 14;
    back.fillRoundedRect(left, top, right - left, bottom - top, 30);
    // All portraits share one container and one mask (one stencil pass instead of one per tile).
    const faces = this.add.container(0, 0).setDepth(21);
    const maskG = this.make.graphics({ x: 0, y: 0 }, false);
    maskG.fillStyle(0xffffff);
    CHARACTER_IDS.forEach((id, i) => {
      const { x, y } = pos[i];
      const def = CHARACTERS[id];
      const g = this.add.graphics({ x, y }).setDepth(20);
      drawCard(g, -w / 2, -h / 2, w, h, { radius: 20 * k, shadow: 0.8 });
      const art = { x: -w / 2 + 7 * k, y: -h / 2 + 7 * k, w: w - 14 * k, h: h - 44 * k };
      g.fillStyle(def.color, 1);
      g.fillRoundedRect(art.x, art.y, art.w, art.h, 15 * k);
      g.fillStyle(0xffffff, 0.28);
      g.fillRoundedRect(art.x, art.y, art.w, art.h * 0.5, { tl: 15 * k, tr: 15 * k, bl: 0, br: 0 });
      maskG.fillRoundedRect(x + art.x, y + art.y, art.w, art.h, 15 * k);
      const face = this.add.sprite(0, 0, def.atlas, '0');
      placePortraitSprite(face, id, 0.52 * k, 0, false);
      face.x += x;
      face.y += y + art.y + art.h * 0.58;
      faces.add(face);
      addText(this, x, y + h / 2 - 20 * k, def.short.toUpperCase(), Math.max(14, Math.round(17 * k)), { color: UI.inkCss, weight: 700 }).setDepth(22);
      this.tileRings.push(this.add.graphics({ x, y }).setDepth(23));
      this.tileBadges.push(this.add.container(x, y).setDepth(24));
    });
    faces.setMask(maskG.createGeometryMask());
  }

  private buildSlot(slot: number): SlotView {
    const x = PODIUM_X[slot];
    const panel = this.add.container(x, CARD_Y).setDepth(30);
    const g = this.add.graphics();
    drawCard(g, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, { radius: 28 });
    g.fillStyle(PLAYER_COLORS[slot], 1);
    g.fillRoundedRect(-CARD_W / 2 + 24, -CARD_H / 2, CARD_W - 48, 6, { tl: 0, tr: 0, bl: 3, br: 3 });
    const badge = new PlayerBadge(this, -CARD_W / 2 + 36, -CARD_H / 2 + 30, slot, 17);
    const label = addText(this, -CARD_W / 2 + 64, -CARD_H / 2 + 30, `PLAYER ${slot + 1}`, 19, { color: UI.inkSoftCss, weight: 700, align: 'left' });
    const content = this.add.container(0, 14);
    panel.add([g, badge, label, content]);
    const view: SlotView = { phase: 'empty', device: null, cursor: 0, panel, content, hero: null };
    this.renderSlot(slot, view);
    return view;
  }

  private renderSlot(slot: number, v: SlotView = this.slots[slot]): void {
    v.content.removeAll(true);
    const add = (o: Phaser.GameObjects.GameObject) => v.content.add(o);
    if (v.phase === 'empty') {
      const glyph = makeGlyph(this, 'A', 40, glyphKindFor());
      const label = addText(this, 0, 0, 'TO JOIN', 28, { color: UI.inkCss, weight: 700, align: 'left' });
      // Centre "[glyph] TO JOIN" as one line using the glyph's real width (key caps are wider).
      const gw = glyph.width || 44;
      const total = gw + 12 + label.width;
      glyph.setPosition(-total / 2 + gw / 2, 0);
      label.setX(-total / 2 + gw + 12);
      add(glyph);
      add(label);
      this.tweens.add({ targets: glyph, scale: { from: 1, to: 1.06 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      return;
    }
    const def = CHARACTERS[CHARACTER_IDS[v.cursor]];
    const icon = this.add.image(CARD_W / 2 - 34, -CARD_H / 2 + 16, v.device?.kind === 'keyboard' ? 'icon-keyboard' : 'icon-controller').setScale(0.2).setTint(0x3a4560);
    add(icon);
    if (v.phase === 'choosing') {
      add(addText(this, 0, -8, `◀  ${def.name.toUpperCase()}  ▶`, 26, { color: UI.inkCss, weight: 700 }));
      const bar = new PromptBar(this, 0, 26, [
        { button: 'A', label: 'Pick' },
        { button: 'B', label: 'Leave' },
      ], { size: 24, fontSize: 16, color: UI.inkSoftCss, slot });
      // The card is already the backing; drop the bar's own pill.
      bar.list.filter((o) => o instanceof Phaser.GameObjects.Graphics).forEach((o) => o.destroy());
      add(bar);
    } else {
      // "READY" on a gold chip, the character's name beside it.
      const chipG = this.add.graphics();
      chipG.fillStyle(UI.focus, 1);
      chipG.fillRoundedRect(-70, -22, 140, 44, 22);
      const stamp = this.add.container(-110, -4, [chipG, addText(this, 0, -1, 'READY', 26, { color: UI.inkCss, weight: 700 })]);
      add(stamp);
      add(addText(this, -28, -14, def.name, 22, { color: UI.inkCss, weight: 700, align: 'left' }));
      add(addText(this, -28, 12, def.role, 15, { color: UI.inkSoftCss, weight: 600, align: 'left' }));
      stamp.setScale(0.8);
      this.tweens.add({ targets: stamp, scale: 1, duration: 200, ease: 'Back.Out' });
    }
  }

  private buildStartBanner(): Phaser.GameObjects.Container {
    const c = this.add.container(GAME_WIDTH / 2, 150).setDepth(100).setVisible(false);
    const g = this.add.graphics();
    drawCard(g, -440, -44, 880, 88, { radius: 44, fill: UI.focus, shadow: 1.3 });
    const t = addText(this, 0, -2, 'All set! Press A to continue', 36, { color: UI.inkCss, weight: 700 });
    c.add([g, t]);
    this.tweens.add({ targets: c, alpha: { from: 1, to: 0.8 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    return c;
  }

  // --- Pedestals --------------------------------------------------------------------------------
  /** Put the character a player is pointing at on their pedestal. */
  private standHero(slot: number, anim: 'wave' | 'idle' | 'celebrate' = 'wave'): void {
    const v = this.slots[slot];
    const id: CharacterId | null = v.phase === 'empty' ? null : CHARACTER_IDS[v.cursor];
    if (v.hero && (!id || v.hero.charId !== id)) {
      v.hero.destroy();
      v.hero = null;
    }
    if (id && !v.hero) {
      v.hero = new Character(this, PODIUM_X[slot], PODIUM_Y - 20 * STAGE_K, id, { scale: CHAR_K });
      v.hero.setDepth(10);
      // A little hop in so the swap reads as a change of character.
      v.hero.setScale(CHAR_K * 0.9);
      this.tweens.add({ targets: v.hero, scale: CHAR_K, duration: 180, ease: 'Back.Out' });
    }
    if (v.hero && anim !== 'idle') v.hero.play(anim, { force: true });
    this.vacant[slot]?.setVisible(!id);
  }

  // --- Slot actions -----------------------------------------------------------------------------
  private preferredSlot(ref: DeviceRef): number {
    return slotForDevice(ref, this.slots.map((s) => s.phase === 'empty'));
  }

  private join(slot: number, ref: DeviceRef, cursor?: number, silent = false): void {
    const v = this.slots[slot];
    v.phase = 'choosing';
    v.device = ref;
    input.assign(slot, ref);
    const n = CHARACTER_IDS.length;
    const remembered = settings.get().lastCharacters[slot];
    let c = cursor ?? (remembered ? CHARACTER_IDS.indexOf(remembered) : slot % n);
    if (c < 0) c = slot % n;
    // Start on a free character.
    for (let k = 0; k < n && this.locked.has(c); k++) c = (c + 1) % n;
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
    this.standHero(slot, silent ? 'idle' : 'wave');
    this.renderSlot(slot);
    this.refreshHighlights();
    this.refreshFooter();
  }

  private leave(slot: number): void {
    const v = this.slots[slot];
    if (v.phase === 'ready') this.locked.delete(v.cursor);
    v.phase = 'empty';
    v.device = null;
    input.assign(slot, null);
    const cfg = session.slots[slot];
    cfg.joined = false;
    cfg.device = null;
    cfg.characterId = null;
    audio.play('leave');
    this.standHero(slot);
    this.renderSlot(slot);
    this.refreshHighlights();
    this.refreshFooter();
  }

  /** Move along the roster (left/right, wrapping) or between its rows (up/down), skipping taken characters. */
  private moveCursor(slot: number, dir: number, silent = false, vertical = false): void {
    const v = this.slots[slot];
    const n = CHARACTER_IDS.length;
    let c = v.cursor;
    if (vertical) {
      const { cols, rows } = this.layout;
      if (rows < 2) return this.moveCursor(slot, dir, silent);
      // The same column in the other row (or the nearest free tile in that row).
      const row = Math.floor(c / cols);
      const target = (row + (dir > 0 ? 1 : rows - 1)) % rows;
      const start = target * cols;
      const end = Math.min(n, start + cols);
      const col = Math.min(c % cols, end - start - 1);
      let best = -1;
      for (let i = start; i < end; i++) {
        if (this.locked.has(i)) continue;
        if (best < 0 || Math.abs(i - start - col) < Math.abs(best - start - col)) best = i;
      }
      if (best < 0) return;
      c = best;
    } else {
      for (let k = 0; k < n; k++) {
        c = (((c + dir) % n) + n) % n;
        if (!this.locked.has(c)) break;
      }
    }
    if (c === v.cursor || this.locked.has(c)) return;
    v.cursor = c;
    if (!silent) audio.play('menuMove');
    this.standHero(slot);
    this.refreshHighlights();
    this.renderSlot(slot);
  }

  private confirm(slot: number, silent = false): void {
    const v = this.slots[slot];
    if (this.locked.has(v.cursor)) {
      audio.play('error');
      return;
    }
    v.phase = 'ready';
    this.locked.set(v.cursor, slot);
    const id = CHARACTER_IDS[v.cursor];
    session.slots[slot].characterId = id;
    const last = [...settings.get().lastCharacters];
    last[slot] = id;
    settings.set({ lastCharacters: last });
    this.standHero(slot, silent ? 'idle' : 'celebrate');
    if (!silent && v.hero) {
      audio.play('ready');
      input.rumbleSlot(slot, 0.5, 0.6, 160);
      this.fx.confetti(v.hero.x, v.hero.y - 200, 40);
      this.fx.vfx('goldSwirl', v.hero.x, v.hero.y - 60, { scale: 0.9, blend: 'add', alpha: 0.8 });
    }
    // Other players pointing at this character move on to a free one.
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
    this.locked.delete(v.cursor);
    session.slots[slot].characterId = null;
    audio.play('cancel');
    this.standHero(slot, 'idle');
    this.renderSlot(slot);
    this.refreshHighlights();
    this.refreshFooter();
  }

  /** Pedestal glows, and the rings and badges on the roster tiles. */
  private refreshHighlights(): void {
    this.slots.forEach((v, slot) => {
      const g = this.glows[slot];
      g.clear();
      const on = v.phase !== 'empty';
      if (on) {
        // Selection ring lying on the pedestal's top face; filled in once confirmed.
        g.fillStyle(PLAYER_COLORS[slot], v.phase === 'ready' ? 0.5 : 0.28);
        g.fillEllipse(0, 34, 220, 58);
        g.lineStyle(6, PLAYER_COLORS[slot], 1);
        g.strokeEllipse(0, 34, 230, 62);
      }
      this.tweens.add({ targets: this.pools[slot], alpha: on ? 0.62 : 0, duration: 200 });
    });
    const n = CHARACTER_IDS.length;
    const { k, w, h } = this.layout;
    for (let ci = 0; ci < n; ci++) {
      const ring = this.tileRings[ci];
      const badges = this.tileBadges[ci];
      ring.clear();
      badges.removeAll(true);
      const lockedBy = this.locked.get(ci);
      const pointing = this.slots.map((v, s) => (v.phase === 'choosing' && v.cursor === ci ? s : -1)).filter((s) => s >= 0);
      if (lockedBy !== undefined) {
        // Taken: dimmed, with the owner's colour and badge.
        ring.fillStyle(0x0a1120, 0.45);
        ring.fillRoundedRect(-w / 2, -h / 2, w, h, 20 * k);
        ring.lineStyle(5, PLAYER_COLORS[lockedBy], 1);
        ring.strokeRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 22 * k);
        badges.add(new PlayerBadge(this, 0, -h / 2 + 7 * k + (h - 44 * k) / 2, lockedBy, 16));
      }
      // Pointing players: a ring in their colour, and their badges along the tile's top edge.
      pointing.forEach((s, j) => {
        const grow = 4 + j * 6;
        ring.lineStyle(6, PLAYER_COLORS[s], 1);
        ring.strokeRoundedRect(-w / 2 - grow, -h / 2 - grow, w + grow * 2, h + grow * 2, 22 * k + grow);
        badges.add(new PlayerBadge(this, (j - (pointing.length - 1) / 2) * 34, -h / 2 + 2, s, 15));
      });
      badges.setVisible(badges.length > 0);
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
    this.footer.setPrompts(anyJoined ? [{ button: 'A', label: 'Join / Pick' }, { button: 'STICK', label: 'Browse' }, { button: 'B', label: 'Leave' }] : [{ button: 'A', label: 'Join' }, { button: 'B', label: 'Back to title' }]);
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
    for (const ref of input.joinPresses('A')) {
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
        this.leave(slot);
        return;
      }
      if (v.phase === 'choosing') {
        const nav = dev.nav();
        if (nav === 'left') this.moveCursor(slot, -1);
        else if (nav === 'right') this.moveCursor(slot, 1);
        else if (nav === 'up') this.moveCursor(slot, -1, false, true);
        else if (nav === 'down') this.moveCursor(slot, 1, false, true);
        if (dev.pressed('A')) this.confirm(slot);
        else if (dev.pressed('B')) this.leave(slot);
      } else if (v.phase === 'ready') {
        if (dev.pressed('B')) this.unconfirm(slot);
        else if ((dev.pressed('A') || dev.pressed('MENU')) && this.allReady()) this.proceed();
      }
    });
  }
}
