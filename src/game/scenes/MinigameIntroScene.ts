import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { Character } from '../characters/Character';
import { CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { input } from '../input/InputManager';
import { minigameInfo, type MinigameInfo, type MinigameLaunch } from '../minigames/MinigameManager';
import { glyphKindFor, makeGlyph, PromptBar } from '../ui/ControllerPrompt';
import { drawPanel } from '../ui/Panel';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { centerOrigin } from '../util/spriteUtil';

/** "MINIGAME!" card: name, instructions, controls, and a ready check for every human. */
export class MinigameIntroScene extends Phaser.Scene {
  private launchData!: MinigameLaunch;
  private info!: MinigameInfo;
  private ready = new Map<number, boolean>();
  private readyMarks = new Map<number, Phaser.GameObjects.Text>();
  private readyGlyphs = new Map<number, Phaser.GameObjects.Container>();
  private started = false;
  private launching = false;
  private autoTimer = 0;

  constructor() {
    super('MinigameIntro');
  }

  init(data: MinigameLaunch): void {
    this.launchData = data;
    this.info = minigameInfo(data.id)!;
    this.ready.clear();
    this.readyMarks.clear();
    this.readyGlyphs.clear();
    this.started = false;
    this.launching = false;
    this.autoTimer = 0;
  }

  preload(): void {
    // Lazy-load this minigame's own art while the card is up.
    for (const a of this.info.assets ?? []) {
      if (!this.textures.exists(a.key)) this.load.svg(a.key, a.path, { width: a.width, height: a.height });
    }
  }

  create(): void {
    enterScene(this);
    const mode = this.launchData.instructions;
    if (mode === 'off') {
      this.start();
      return;
    }
    audio.playMusic('minigame');
    if (this.textures.exists('rendered-sky-day')) this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'rendered-sky-day').setDisplaySize(GAME_WIDTH * 1.04, GAME_HEIGHT * 1.04);
    else this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    const veil = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, this.info.color, 0.28).setOrigin(0);
    void veil;
    // Swirling rays
    const rays = this.add.graphics({ x: GAME_WIDTH / 2, y: 330 });
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      rays.fillStyle(0xffffff, 0.07);
      rays.slice(0, 0, 1400, a0, a0 + 0.12, false);
      rays.fillPath();
    }
    this.tweens.add({ targets: rays, angle: 360, duration: 40000, repeat: -1 });
    const header = addTitle(this, GAME_WIDTH / 2, 90, 'MINIGAME!', 72, CSS.goldLight);
    header.setScale(0.4);
    this.tweens.add({ targets: header, scale: 1, duration: 360, ease: 'Back.Out' });
    audio.play('fanfare');
    const title = addTitle(this, GAME_WIDTH / 2, 190, this.info.name.toUpperCase(), 104);
    title.setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, y: 200, delay: 250, duration: 300, ease: 'Back.Out' });
    addText(this, GAME_WIDTH / 2, 280, this.info.tagline, 34, { color: CSS.cream, weight: 600, stroke: '#1b1530', strokeThickness: 6 });

    // Card: preview art + instructions
    const card = this.add.graphics();
    drawPanel(card, 170, 330, 1580, 420, { radius: 34 });
    if (this.info.arena && this.textures.exists(this.info.arena)) {
      this.buildArenaPreview(this.info.arena);
    } else {
      const pv = this.info.preview;
      const art = pv.frame !== undefined ? this.add.sprite(420, 540, pv.texture, pv.frame) : this.add.image(420, 540, pv.texture);
      if (pv.frame !== undefined) {
        const o = centerOrigin(pv.texture, pv.frame);
        art.setOrigin(o.x, o.y);
      }
      if (this.textures.exists(pv.texture)) art.setScale(pv.scale);
      const glow = this.add.image(420, 540, 'fx-dot').setScale(16).setTint(this.info.color).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD);
      this.children.moveBelow(glow, art);
      this.tweens.add({ targets: art, y: 525, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    if (mode === 'on') {
      this.info.instructions.forEach((line, i) => {
        const y = 400 + i * 62;
        const dot = this.add.graphics();
        dot.fillStyle(this.info.color, 1);
        dot.fillCircle(720, y + 2, 12);
        addText(this, 750, y, line, 32, { color: CSS.ink, weight: 600, align: 'left', wrap: 950 });
      });
    } else {
      addText(this, 1150, 440, this.info.description, 30, { color: CSS.ink, weight: 500, wrap: 900 });
    }
    new PromptBar(this, 1150, 690, this.info.controls, { size: 48, fontSize: 30, color: CSS.ink });
    addText(this, 1650, 360, `${this.info.players} · ${this.info.duration}`, 22, { color: CSS.inkSoft, weight: 600, align: 'right' });

    // Ready check
    const n = this.launchData.players.length;
    this.launchData.players.forEach((p, i) => {
      const x = GAME_WIDTH / 2 + (i - (n - 1) / 2) * 400;
      const y = 900;
      const g = this.add.graphics();
      drawPanel(g, x - 170, y - 110, 340, 200, { radius: 26, border: PLAYER_COLORS[p.slot], borderWidth: 5, engraving: false });
      const c = new Character(this, x - 80, y + 70, p.characterId, { scale: 0.5, shadow: false });
      c.play('idle');
      new PlayerBadge(this, x - 128, y - 72, p.slot, 22);
      const mark = addText(this, x + 60, p.isCpu ? y - 10 : y - 44, p.isCpu ? 'CPU\nREADY' : 'READY?', 34, { color: p.isCpu ? CSS.tealDark : CSS.inkSoft, weight: 700, lineSpacing: -4 });
      this.readyMarks.set(p.slot, mark);
      this.ready.set(p.slot, p.isCpu);
      if (!p.isCpu) {
        // "Press A" with the glyph for this player's own device.
        const glyph = makeGlyph(this, 'A', 54, glyphKindFor(p.slot));
        glyph.setPosition(x + 60, y + 26);
        this.readyGlyphs.set(p.slot, glyph);
        this.tweens.add({ targets: glyph, scale: { from: 1, to: 1.12 }, duration: 500, yoyo: true, repeat: -1 });
      }
    });
    new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 34, [{ button: 'A', label: 'Ready!' }], { size: 38, fontSize: 26 });
  }

  /** Live mini-preview: the rendered arena with this match's characters playing in it. */
  private buildArenaPreview(key: string): void {
    const x0 = 200;
    const y0 = 356;
    const w = 470;
    const h = 368;
    const scale = w / GAME_WIDTH;
    const root = this.add.container(x0, y0);
    const sky = this.textures.exists('rendered-sky-day') ? this.add.image(w / 2, h / 2, 'rendered-sky-day').setDisplaySize(w * 1.2, h * 1.2) : null;
    const arena = this.add.image(0, (h - GAME_HEIGHT * scale) / 2, key).setOrigin(0).setScale(scale);
    if (sky) root.add(sky);
    root.add(arena);
    const maskG = this.make.graphics({ x: 0, y: 0 }, false);
    maskG.fillStyle(0xffffff);
    maskG.fillRoundedRect(x0, y0, w, h, 22);
    root.setMask(maskG.createGeometryMask());
    const frame = this.add.graphics();
    frame.lineStyle(6, this.info.color, 1);
    frame.strokeRoundedRect(x0, y0, w, h, 22);
    // characters wandering around the arena (scaled down)
    const cy = (h - GAME_HEIGHT * scale) / 2;
    this.launchData.players.forEach((p, i) => {
      const sx = (560 + i * 260) * scale;
      const sy = cy + (560 + (i % 2) * 180) * scale;
      const c = new Character(this, sx, sy, p.characterId, { scale: 0.58 * scale, shadow: true });
      root.add(c);
      c.play('run');
      this.tweens.add({
        targets: c,
        x: sx + (i % 2 ? -1 : 1) * 70,
        duration: 1300 + i * 170,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
        onYoyo: () => c.face(!(i % 2)),
        onRepeat: () => c.face(!!(i % 2)),
      });
    });
    addText(this, x0 + w / 2, y0 + h - 22, 'PREVIEW', 18, { color: CSS.cream, weight: 700, stroke: '#1b1530', strokeThickness: 5 });
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    audio.play('ready');
    goTo(this, this.info.sceneKey, this.launchData);
  }

  override update(_t: number, dt: number): void {
    if (this.started || this.launchData.instructions === 'off') return;
    this.autoTimer += dt;
    for (const p of this.launchData.players) {
      if (p.isCpu || this.ready.get(p.slot)) continue;
      const c = input.controls(p.slot);
      if (c.pressed('A')) {
        this.ready.set(p.slot, true);
        const mark = this.readyMarks.get(p.slot);
        this.readyGlyphs.get(p.slot)?.destroy();
        this.readyGlyphs.delete(p.slot);
        if (mark) {
          this.tweens.killTweensOf(mark);
          mark.setY(mark.y + 34).setText('READY!').setColor(CSS.tealDark).setScale(1.4);
          this.tweens.add({ targets: mark, scale: 1, duration: 220, ease: 'Back.Out' });
        }
        audio.play('join', { rate: 1 + p.slot * 0.1 });
        c.rumble(0.3, 0.4, 100);
      }
    }
    if (this.launching) return;
    const allReady = [...this.ready.values()].every(Boolean);
    const quickTimeout = this.launchData.instructions === 'quick' && this.autoTimer > 4500;
    if ((allReady && this.autoTimer > 500) || quickTimeout) {
      this.launching = true;
      this.time.delayedCall(350, () => this.start());
    }
  }
}
