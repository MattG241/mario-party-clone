import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { CHARACTER_IDS } from '../data/characters';
import { input } from '../input/InputManager';
import { MINIGAMES, type MinigameInfo, type MinigameLaunch, type MinigamePlayer } from '../minigames/MinigameManager';
import { registeredMinigames } from '../minigames/registry';
import { settings } from '../save/SettingsManager';
import { session } from '../state/Session';
import { glyphKindFor, makeGlyph, PromptBar } from '../ui/ControllerPrompt';
import { addPortrait } from '../ui/Portrait';
import { buildBackdrop, drawNavyPanel } from '../ui/Screen';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { centerOrigin } from '../util/spriteUtil';
import { randomSeed } from '../util/Random';

const COLS = 4;
const CARD_W = 392;
const CARD_H = 292;
const GAP = 26;
const GRID_X = (GAME_WIDTH - (COLS * CARD_W + (COLS - 1) * GAP)) / 2;
const GRID_Y = 176;
const ART_H = 200;

interface Card {
  info: MinigameInfo;
  root: Phaser.GameObjects.Container;
  rim: Phaser.GameObjects.Graphics;
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
  private players: MinigamePlayer[] = [];
  private detail!: Phaser.GameObjects.Container;
  private leaving = false;

  constructor() {
    super('MinigameMode');
  }

  init(): void {
    this.cards = [];
    this.leaving = false;
  }

  create(): void {
    enterScene(this);
    audio.playMusic('menu');
    session.mode = 'minigame';
    buildBackdrop(this, 'day', 0.3);
    addTitle(this, GAME_WIDTH / 2, 70, 'MINIGAME MODE', 68);
    this.players = this.resolvePlayers();
    this.buildPlayerStrip();

    const registered = registeredMinigames();
    MINIGAMES.forEach((info, i) => {
      const x = GRID_X + (i % COLS) * (CARD_W + GAP);
      const y = GRID_Y + Math.floor(i / COLS) * (CARD_H + GAP);
      let reason = '';
      if (!registered.has(info.sceneKey)) reason = 'COMING SOON';
      else if (info.teamGame && this.players.length < 3) reason = 'NEEDS 3+ PLAYERS';
      this.cards.push(this.buildCard(info, x, y, reason));
    });
    const last = this.registry.get('mgmode-last') as string | undefined;
    const fromLast = this.cards.findIndex((c) => c.info.id === last);
    this.index = fromLast >= 0 ? fromLast : Math.max(0, this.cards.findIndex((c) => c.playable));

    this.detail = this.add.container(0, 0);
    new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 42, [
      { button: 'STICK', label: 'Choose' },
      { button: 'A', label: 'Play' },
      { button: 'Y', label: 'Random' },
      { button: 'B', label: 'Back' },
    ], { size: 34, fontSize: 22 });
    this.focus(this.index, true);
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
    const arena = info.arena && this.textures.exists(info.arena) ? info.arena : null;
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
    root.add(rim);
    return { info, root, rim, playable, reason };
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
    this.cards.forEach((c, k) => {
      const on = k === i;
      this.drawRim(c, on);
      c.root.setDepth(on ? 10 : 1);
      this.tweens.killTweensOf(c.root);
      const scale = on ? 1.045 : 1;
      if (instant) c.root.setScale(scale);
      else this.tweens.add({ targets: c.root, scale, duration: 140, ease: 'Back.Out' });
      c.root.setAlpha(c.playable || on ? 1 : 0.82);
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
    const desc = addText(this, GRID_X + 36, y0 + 108, info.description, 20, { color: CSS.cream, weight: 500, align: 'left', wrap: 980 });
    desc.setOrigin(0, 0);
    this.detail.add(desc);
    // controls column
    const cx = GRID_X + 1110;
    this.detail.add(addText(this, cx, y0 + 40, 'CONTROLS', 20, { color: CSS.creamDark, weight: 700, align: 'left' }).setOrigin(0, 0.5));
    const kind = glyphKindFor(0);
    info.controls.slice(0, 3).forEach((c, k) => {
      const gy = y0 + 84 + k * 44;
      const glyph = makeGlyph(this, c.button, 34, kind);
      glyph.setPosition(cx + 24 + Math.max(0, glyph.width - 34) / 2, gy);
      this.detail.add(glyph);
      this.detail.add(addText(this, cx + 34 + Math.max(34, glyph.width) + 4, gy, c.label, 22, { color: CSS.cream, weight: 700, align: 'left' }).setOrigin(0, 0.5));
    });
    // status / play pill
    const px = GAME_WIDTH - GRID_X - 36;
    const pill = this.add.graphics();
    const pw = 250;
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
      else if (dir === 'up' || dir === 'down') next = (this.index + COLS) % n;
      next = Math.min(n - 1, Math.max(0, next));
      if (next !== this.index) this.focus(next);
    }
    if (c.pressed('A')) this.play(this.cards[this.index]);
    else if (c.pressed('Y')) {
      const pool = this.cards.map((_, k) => k).filter((k) => this.cards[k].playable);
      if (pool.length) {
        const pick = pool[Math.floor(Math.random() * pool.length)];
        this.focus(pick);
        this.time.delayedCall(260, () => this.play(this.cards[pick]));
      }
    } else if (c.pressed('B')) {
      this.leaving = true;
      audio.play('cancel');
      goTo(this, 'CharacterSelect');
    }
  }
}
