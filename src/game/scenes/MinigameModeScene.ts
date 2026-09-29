import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { CHARACTER_IDS } from '../data/characters';
import { arenaThumbKey, queueArenaThumbs, releaseArenaThumbs } from '../data/minigameRenders';
import { input } from '../input/InputManager';
import { MINIGAMES, type MinigameInfo, type MinigameLaunch, type MinigamePlayer } from '../minigames/MinigameManager';
import { WORLDS } from '../worlds';
import type { WorldDef } from '../worlds/types';
import { registeredMinigames } from '../minigames/registry';
import { settings } from '../save/SettingsManager';
import { session } from '../state/Session';
import { glyphKindFor, makeGlyph, PromptBar } from '../ui/ControllerPrompt';
import { addPortrait } from '../ui/Portrait';
import { buildBackdrop, drawNavyPanel } from '../ui/Screen';
import { addGradientTitle, addText } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { centerOrigin } from '../util/spriteUtil';
import { randomSeed } from '../util/Random';

const COLS = 4;
const CARD_W = 392;
const CARD_H = 264;
const GAP = 22;
const GRID_X = (GAME_WIDTH - (COLS * CARD_W + (COLS - 1) * GAP)) / 2;
const GRID_Y = 228;
const ART_H = 180;
/** The world tabs (one per world with minigames), between the title and the grid. */
const TAB_Y = 178;

interface Card {
  info: MinigameInfo;
  root: Phaser.GameObjects.Container;
  rim: Phaser.GameObjects.Graphics;
  /** White overlay flashed when the card takes focus. */
  flash: Phaser.GameObjects.Graphics;
  playable: boolean;
  reason: string;
}

/**
 * Minigame Mode: pick any minigame and play it with the players chosen on the previous screen.
 * Games that are not playable yet (or need more players) are shown but can't be started.
 */
export class MinigameModeScene extends Phaser.Scene {
  private cards: Card[] = [];
  private index = 0;
  /** Worlds that have minigames, each with its games, and the one shown. */
  private tabs: { world: WorldDef; infos: MinigameInfo[] }[] = [];
  private tab = 0;
  private tabLayer!: Phaser.GameObjects.Container;
  private cardLayer!: Phaser.GameObjects.Container;
  private players: MinigamePlayer[] = [];
  private detail!: Phaser.GameObjects.Container;
  private leaving = false;

  constructor() {
    super('MinigameMode');
  }

  init(): void {
    this.cards = [];
    this.tabs = [];
    this.leaving = false;
  }

  preload(): void {
    // Small arena pictures for the cards (the arenas themselves load with each minigame).
    queueArenaThumbs(this);
  }

  create(): void {
    enterScene(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => releaseArenaThumbs(this));
    audio.playMusic('menu');
    session.mode = 'minigame';
    buildBackdrop(this, 'day', 0.3);
    addGradientTitle(this, GAME_WIDTH / 2, 70, 'MINIGAME MODE', 68);
    this.players = this.resolvePlayers();
    this.buildPlayerStrip();

    // One tab per world that has minigames (the original set first).
    this.tabs = WORLDS.map((world) => ({ world, infos: MINIGAMES.filter((m) => (m.world ?? 'festival') === world.id) })).filter((t) => t.infos.length > 0);
    const last = this.registry.get('mgmode-last') as string | undefined;
    const lastWorld = MINIGAMES.find((m) => m.id === last)?.world ?? 'festival';
    this.tab = Math.max(0, this.tabs.findIndex((t) => t.world.id === lastWorld));
    this.tabLayer = this.add.container(0, 0);
    this.cardLayer = this.add.container(0, 0);
    this.detail = this.add.container(0, 0);
    const prompts: { button: 'STICK' | 'A' | 'Y' | 'B' | 'LB'; label: string }[] = [
      { button: 'STICK', label: 'Choose' },
      { button: 'A', label: 'Play' },
      { button: 'Y', label: 'Random' },
      { button: 'B', label: 'Back' },
    ];
    if (this.tabs.length > 1) prompts.splice(1, 0, { button: 'LB', label: 'World' });
    new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 42, prompts, { size: 34, fontSize: 22 });
    this.showTab(this.tab, last, true);
  }

  /** The world tabs: the shown world filled in its colour, the others as quiet chips. */
  private drawTabs(): void {
    this.tabLayer.removeAll(true);
    if (this.tabs.length < 2) return;
    const h = 44;
    const pad = 26;
    const gap = 12;
    const labels = this.tabs.map((t) => addText(this, 0, TAB_Y, t.world.short.toUpperCase(), 20, { color: '#ffffff', weight: 700 }));
    const widths = labels.map((l) => l.width + pad * 2);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
    let x = GAME_WIDTH / 2 - total / 2;
    const kind = glyphKindFor(0);
    const lb = makeGlyph(this, 'LB', 30, kind).setPosition(x - 40, TAB_Y);
    const rb = makeGlyph(this, 'RB', 30, kind).setPosition(x + total + 40, TAB_Y);
    this.tabLayer.add([lb, rb]);
    this.tabs.forEach((t, i) => {
      const w = widths[i];
      const on = i === this.tab;
      const g = this.add.graphics();
      if (on) {
        g.fillStyle(0x06141a, 0.35);
        g.fillRoundedRect(x + 3, TAB_Y - h / 2 + 5, w, h, h / 2);
        g.fillStyle(t.world.color, 1);
        g.fillRoundedRect(x, TAB_Y - h / 2, w, h, h / 2);
        g.lineStyle(3, 0xfff4dc, 1);
        g.strokeRoundedRect(x, TAB_Y - h / 2, w, h, h / 2);
      } else {
        g.fillStyle(0x0c2630, 0.8);
        g.fillRoundedRect(x, TAB_Y - h / 2, w, h, h / 2);
        g.lineStyle(2, t.world.color, 0.9);
        g.strokeRoundedRect(x, TAB_Y - h / 2, w, h, h / 2);
      }
      labels[i].setX(x + w / 2).setColor(on ? '#ffffff' : CSS.cream).setAlpha(on ? 1 : 0.85);
      this.tabLayer.add([g, labels[i]]);
      x += w + gap;
    });
  }

  /** Show a world's minigames (focusing `focusId` if it's among them, else the first playable). */
  private showTab(t: number, focusId?: string, instant = false): void {
    this.tab = (t + this.tabs.length) % this.tabs.length;
    this.drawTabs();
    this.cardLayer.removeAll(true);
    this.cards = [];
    const registered = registeredMinigames();
    this.tabs[this.tab].infos.forEach((info, i) => {
      const x = GRID_X + (i % COLS) * (CARD_W + GAP);
      const y = GRID_Y + Math.floor(i / COLS) * (CARD_H + GAP);
      let reason = '';
      if (!registered.has(info.sceneKey)) reason = 'COMING SOON';
      else if (info.teamGame && this.players.length < 3) reason = 'NEEDS 3+ PLAYERS';
      const card = this.buildCard(info, x, y, reason);
      this.cardLayer.add(card.root);
      this.cards.push(card);
    });
    const fromId = this.cards.findIndex((c) => c.info.id === focusId);
    this.index = fromId >= 0 ? fromId : Math.max(0, this.cards.findIndex((c) => c.playable));
    this.focus(this.index, instant);
  }

  /** Everyone chosen on the select screen; if there's nobody (direct launch), P1 plus three CPUs. */
  private resolvePlayers(): MinigamePlayer[] {
    const parts = session.participants();
    if (parts.length >= 1) return parts.map((s) => ({ slot: s.slot, characterId: s.characterId!, isCpu: s.isCpu, cpuLevel: s.cpuLevel }));
    session.resetSlots();
    return [0, 1, 2, 3].map((slot) => {
      const cfg = session.slots[slot];
      cfg.characterId = CHARACTER_IDS[slot];
      if (slot === 0) {
        const pad = input.connectedPads()[0];
        cfg.joined = true;
        cfg.device = pad ? { kind: 'gamepad', index: pad.index } : { kind: 'keyboard' };
        input.assign(0, cfg.device);
      } else {
        cfg.isCpu = true;
        input.assign(slot, null);
      }
      return { slot, characterId: CHARACTER_IDS[slot], isCpu: slot !== 0, cpuLevel: cfg.cpuLevel };
    });
  }

  private buildPlayerStrip(): void {
    const n = this.players.length;
    const step = 118;
    const x0 = GAME_WIDTH - 90 - (n - 1) * step;
    this.players.forEach((p, i) => {
      const x = x0 + i * step;
      addPortrait(this, p.characterId, p.slot, 36, { worldX: x, worldY: 84, badge: true }).setPosition(x, 84);
      const tag = p.isCpu ? 'CPU' : `P${p.slot + 1}`;
      const t = addText(this, x, 136, tag, 18, { color: '#ffffff', weight: 700, stroke: '#06141a', strokeThickness: 4 });
      t.setColor(p.isCpu ? CSS.creamDark : Phaser.Display.Color.IntegerToColor(PLAYER_COLORS[p.slot]).rgba);
    });
  }

  private buildCard(info: MinigameInfo, x: number, y: number, reason: string): Card {
    const playable = reason === '';
    const root = this.add.container(x + CARD_W / 2, y + CARD_H / 2);
    const L = -CARD_W / 2;
    const T = -CARD_H / 2;
    const bg = this.add.graphics();
    bg.fillStyle(0x06141a, 0.35);
    bg.fillRoundedRect(L + 5, T + 9, CARD_W, CARD_H, 24);
    bg.fillStyle(0x0c2630, 0.94);
    bg.fillRoundedRect(L, T, CARD_W, CARD_H, 24);
    root.add(bg);

    // Art: the rendered arena where there is one, otherwise a poster in the game's colour.
    const art = this.add.container(0, 0);
    root.add(art);
    const arena = info.arena && this.textures.exists(arenaThumbKey(info.arena)) ? arenaThumbKey(info.arena) : null;
    if (arena) {
      const src = this.textures.get(arena).getSourceImage() as HTMLImageElement;
      const s = CARD_W / src.width;
      const cropH = ART_H / s;
      const cropY = (src.height - cropH) * 0.55;
      const img = this.add.image(L, T - cropY * s, arena).setOrigin(0).setScale(s);
      img.setCrop(0, cropY, src.width, cropH);
      art.add(img);
    } else {
      const g = this.add.graphics();
      const c = Phaser.Display.Color.IntegerToColor(info.color);
      const dark = c.clone().darken(30).color;
      g.fillGradientStyle(info.color, info.color, dark, dark, 1);
      g.fillRect(L, T, CARD_W, ART_H);
      g.fillStyle(0xffffff, 0.08);
      for (let k = -6; k < 14; k++) {
        const sx = L + k * 44;
        g.fillPoints([
          new Phaser.Math.Vector2(sx, T + ART_H),
          new Phaser.Math.Vector2(sx + 22, T + ART_H),
          new Phaser.Math.Vector2(sx + 22 + ART_H * 0.6, T),
          new Phaser.Math.Vector2(sx + ART_H * 0.6, T),
        ], true);
      }
      art.add(g);
      art.add(this.add.image(0, T + ART_H / 2, 'fx-dot').setScale(9).setTint(0xffffff).setAlpha(0.28).setBlendMode(Phaser.BlendModes.ADD));
      const pv = info.preview;
      if (this.textures.exists(pv.texture)) {
        const spr = pv.frame !== undefined ? this.add.image(0, T + ART_H / 2, pv.texture, pv.frame) : this.add.image(0, T + ART_H / 2, pv.texture);
        if (pv.frame !== undefined) {
          const o = centerOrigin(pv.texture, pv.frame);
          spr.setOrigin(o.x, o.y);
        }
        const fit = Math.min(1, (ART_H * 0.72) / spr.height, (CARD_W * 0.6) / spr.width);
        spr.setScale(fit);
        art.add(spr);
      }
    }
    // top corners: cover the square art corners with the card colour so the card stays rounded
    const corners = this.add.graphics();
    corners.fillStyle(0x0c2630, 1);
    for (const sx of [1, -1]) {
      const cx = sx > 0 ? L : -L;
      corners.beginPath();
      corners.moveTo(cx, T);
      corners.lineTo(cx + sx * 24, T);
      corners.arc(cx + sx * 24, T + 24, 24, -Math.PI / 2, sx > 0 ? Math.PI : 0, sx > 0);
      corners.closePath();
      corners.fillPath();
    }
    root.add(corners);
    // The guests a world minigame is themed on, as portraits on the art's corner.
    (info.characters ?? []).slice(0, 3).forEach((id, k) => {
      const px = L + 34 + k * 50;
      const py = T + 34;
      root.add(addPortrait(this, id, 0, 24, { worldX: root.x + px, worldY: root.y + py }).setPosition(px, py));
    });

    // colour band + name plate
    const plate = this.add.graphics();
    plate.fillStyle(info.color, 1);
    plate.fillRect(L, T + ART_H, CARD_W, 6);
    root.add(plate);
    root.add(addText(this, L + 22, T + ART_H + 38, info.name, 30, { color: '#ffffff', weight: 700, align: 'left', stroke: '#06141a', strokeThickness: 4 }).setOrigin(0, 0.5));
    root.add(addText(this, L + 22, T + ART_H + 72, `${info.players.replace(' players', '')}  ·  ${info.duration}`, 18, { color: CSS.creamDark, weight: 600, align: 'left' }).setOrigin(0, 0.5));
    if (info.teamGame) {
      const chip = this.add.graphics();
      chip.fillStyle(COLORS.coral, 1);
      chip.fillRoundedRect(-L - 96, T + ART_H + 24, 76, 28, 14);
      root.add(chip);
      root.add(addText(this, -L - 58, T + ART_H + 38, 'TEAMS', 16, { color: '#ffffff', weight: 700 }));
    }

    if (!playable) {
      const veil = this.add.graphics();
      veil.fillStyle(0x06141a, 0.55);
      veil.fillRoundedRect(L, T, CARD_W, ART_H, { tl: 24, tr: 24, bl: 0, br: 0 });
      root.add(veil);
      const tagW = reason.length * 13 + 60;
      const tag = this.add.graphics();
      tag.fillStyle(0x0c2630, 0.95);
      tag.fillRoundedRect(-tagW / 2, T + ART_H / 2 - 22, tagW, 44, 22);
      tag.lineStyle(2, 0xfff4dc, 0.6);
      tag.strokeRoundedRect(-tagW / 2, T + ART_H / 2 - 22, tagW, 44, 22);
      root.add(tag);
      root.add(addText(this, 0, T + ART_H / 2, reason, 20, { color: CSS.cream, weight: 700 }));
    }

    const rim = this.add.graphics();
    const flash = this.add.graphics().setAlpha(0);
    flash.fillStyle(0xffffff, 1);
    flash.fillRoundedRect(L, T, CARD_W, CARD_H, 24);
    root.add([rim, flash]);
    return { info, root, rim, flash, playable, reason };
  }

  private drawRim(card: Card, focused: boolean): void {
    const g = card.rim;
    g.clear();
    const L = -CARD_W / 2;
    const T = -CARD_H / 2;
    if (focused) {
      g.lineStyle(12, COLORS.goldLight, 0.35);
      g.strokeRoundedRect(L - 4, T - 4, CARD_W + 8, CARD_H + 8, 28);
      g.lineStyle(5, COLORS.gold, 1);
      g.strokeRoundedRect(L, T, CARD_W, CARD_H, 24);
      g.lineStyle(2, 0xfff4dc, 0.9);
      g.strokeRoundedRect(L + 5, T + 5, CARD_W - 10, CARD_H - 10, 20);
    } else {
      g.lineStyle(3, 0xfff4dc, card.playable ? 0.45 : 0.2);
      g.strokeRoundedRect(L, T, CARD_W, CARD_H, 24);
    }
  }

  private focus(i: number, instant = false): void {
    const prev = this.cards[this.index];
    this.index = i;
    const reduced = settings.get().reducedMotion;
    this.cards.forEach((c, k) => {
      const on = k === i;
      this.drawRim(c, on);
      c.root.setDepth(on ? 10 : 1);
      this.tweens.killTweensOf([c.root, c.rim]);
      c.rim.setAlpha(1);
      const scale = on ? 1.045 : 1;
      if (instant || reduced) c.root.setScale(scale);
      else if (on) this.tweens.add({ targets: c.root, scale: { from: 1.0, to: scale }, duration: 180, ease: 'Back.Out' });
      else this.tweens.add({ targets: c.root, scale, duration: 140, ease: 'Quad.Out' });
      c.root.setAlpha(c.playable || on ? 1 : 0.82);
      if (on && !reduced) {
        // The same focus language as the menus: a quick flash, then a softly breathing rim.
        if (!instant) {
          c.flash.setAlpha(0.35);
          this.tweens.add({ targets: c.flash, alpha: 0, duration: 220, ease: 'Quad.Out' });
        }
        this.tweens.add({ targets: c.rim, alpha: { from: 1, to: 0.55 }, duration: 760, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      }
    });
    if (!instant && prev !== this.cards[i]) audio.play('menuMove');
    this.buildDetail(this.cards[i]);
  }

  private buildDetail(card: Card): void {
    this.detail.removeAll(true);
    const info = card.info;
    const y0 = GRID_Y + 2 * CARD_H + GAP + 28;
    const h = GAME_HEIGHT - 96 - y0;
    const g = this.add.graphics();
    drawNavyPanel(g, GRID_X, y0, GAME_WIDTH - 2 * GRID_X, h, { border: info.color, radius: 24 });
    this.detail.add(g);
    this.detail.add(addText(this, GRID_X + 36, y0 + 40, info.name.toUpperCase(), 32, { color: '#ffffff', weight: 700, align: 'left', stroke: '#06141a', strokeThickness: 4 }).setOrigin(0, 0.5));
    this.detail.add(addText(this, GRID_X + 36, y0 + 80, info.tagline, 22, { color: Phaser.Display.Color.IntegerToColor(info.color).lighten(25).rgba, weight: 700, align: 'left' }).setOrigin(0, 0.5));
    const desc = addText(this, GRID_X + 36, y0 + 108, info.description, 20, { color: CSS.cream, weight: 500, align: 'left', wrap: 880 });
    desc.setOrigin(0, 0);
    this.detail.add(desc);
    // controls column (between the description and the PLAY pill)
    const cx = GRID_X + 960;
    this.detail.add(addText(this, cx, y0 + 40, 'CONTROLS', 20, { color: CSS.creamDark, weight: 700, align: 'left' }).setOrigin(0, 0.5));
    const kind = glyphKindFor(0);
    // status / play pill (placed first: the control labels must stop short of it)
    const px = GAME_WIDTH - GRID_X - 36;
    const pw = 250;
    const shown = info.controls.slice(0, 3);
    // Three rows sit a little closer so the last stays inside the panel.
    const rowGap = shown.length > 2 ? 38 : 44;
    shown.forEach((c, k) => {
      const gy = y0 + (shown.length > 2 ? 78 : 84) + k * rowGap;
      const glyph = makeGlyph(this, c.button, 34, kind);
      glyph.setPosition(cx + 24 + Math.max(0, glyph.width - 34) / 2, gy);
      this.detail.add(glyph);
      const lx = cx + 34 + Math.max(34, glyph.width) + 4;
      const label = addText(this, lx, gy, c.label, 22, { color: CSS.cream, weight: 700, align: 'left' }).setOrigin(0, 0.5);
      // Long labels ("Hold: pour / Tap: swirl") shrink rather than run under the PLAY pill.
      const room = px - pw - 18 - lx;
      if (label.width > room) label.setScale(Math.max(0.6, room / label.width));
      this.detail.add(label);
    });
    const pill = this.add.graphics();
    if (card.playable) {
      pill.fillStyle(COLORS.goldDark, 1);
      pill.fillRoundedRect(px - pw, y0 + h / 2 - 30 + 5, pw, 60, 30);
      pill.fillStyle(COLORS.gold, 1);
      pill.fillRoundedRect(px - pw, y0 + h / 2 - 30, pw, 60, 30);
      pill.lineStyle(3, 0xfff4dc, 1);
      pill.strokeRoundedRect(px - pw, y0 + h / 2 - 30, pw, 60, 30);
      this.detail.add(pill);
      const glyph = makeGlyph(this, 'A', 38, kind);
      glyph.setPosition(px - pw + 40, y0 + h / 2);
      this.detail.add(glyph);
      this.detail.add(addText(this, px - pw / 2 + 22, y0 + h / 2 - 1, 'PLAY', 28, { color: CSS.ink, weight: 700 }));
    } else {
      pill.fillStyle(0x06141a, 0.5);
      pill.fillRoundedRect(px - pw, y0 + h / 2 - 30, pw, 60, 30);
      pill.lineStyle(2, 0xfff4dc, 0.35);
      pill.strokeRoundedRect(px - pw, y0 + h / 2 - 30, pw, 60, 30);
      this.detail.add(pill);
      this.detail.add(addText(this, px - pw / 2, y0 + h / 2 - 1, card.reason, 20, { color: CSS.creamDark, weight: 700 }));
    }
  }

  private play(card: Card): void {
    if (this.leaving) return;
    if (!card.playable) {
      audio.play('error');
      this.tweens.add({ targets: card.root, x: card.root.x + 10, duration: 50, yoyo: true, repeat: 2 });
      return;
    }
    this.leaving = true;
    audio.play('confirm');
    // Press feedback: the card squashes and flashes as it's picked.
    this.tweens.killTweensOf([card.root, card.flash]);
    card.flash.setAlpha(0.6);
    this.tweens.add({ targets: card.flash, alpha: 0, duration: 260, ease: 'Quad.Out' });
    this.tweens.add({ targets: card.root, scaleX: 1.07, scaleY: 0.96, duration: 70, yoyo: true, ease: 'Quad.Out' });
    this.registry.set('mgmode-last', card.info.id);
    const launch: MinigameLaunch = {
      id: card.info.id,
      players: this.players,
      mode: 'free',
      seed: randomSeed(),
      instructions: settings.get().instructions,
    };
    goTo(this, 'MinigameIntro', launch);
  }

  override update(): void {
    if (this.leaving) return;
    const c = input.any;
    const dir = c.nav();
    if (dir) {
      const n = this.cards.length;
      const col = this.index % COLS;
      let next = this.index;
      if (dir === 'left') next = col === 0 ? this.index + COLS - 1 : this.index - 1;
      else if (dir === 'right') next = col === COLS - 1 ? this.index - COLS + 1 : this.index + 1;
      else if ((dir === 'up' || dir === 'down') && n > COLS) next = (this.index + COLS) % n;
      next = Math.min(n - 1, Math.max(0, next));
      if (next !== this.index) this.focus(next);
    }
    if (this.tabs.length > 1 && (c.pressed('LB') || c.pressed('RB'))) {
      audio.play('menuMove');
      this.showTab(this.tab + (c.pressed('RB') ? 1 : -1));
      return;
    }
    if (c.pressed('A')) this.play(this.cards[this.index]);
    else if (c.pressed('Y')) {
      // Any playable minigame from any world: hop to its tab, focus it, then play.
      const registered = registeredMinigames();
      const pool = this.tabs.flatMap((t, ti) => t.infos.filter((m) => registered.has(m.sceneKey) && !(m.teamGame && this.players.length < 3)).map((m) => ({ ti, id: m.id })));
      if (pool.length) {
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick.ti !== this.tab) this.showTab(pick.ti, pick.id);
        const k = this.cards.findIndex((cd) => cd.info.id === pick.id);
        this.focus(k);
        this.time.delayedCall(260, () => this.play(this.cards[k]));
      }
    } else if (c.pressed('B')) {
      this.leaving = true;
      audio.play('cancel');
      goTo(this, 'CharacterSelect');
    }
  }
}
