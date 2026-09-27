import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { Character } from '../characters/Character';
import { CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { CHARACTERS } from '../data/characters';
import { input } from '../input/InputManager';
import { minigameInfo, type MinigameInfo, type MinigameLaunch } from '../minigames/MinigameManager';
import { glyphKindFor, makeGlyph, PromptBar } from '../ui/ControllerPrompt';
import { addPortrait } from '../ui/Portrait';
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
    const arenaKey = this.info.arena && this.textures.exists(this.info.arena) ? this.info.arena : null;
    // Backdrop: the arena itself (or the sky), dimmed under a navy veil so the card reads.
    if (this.textures.exists('rendered-sky-golden')) this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'rendered-sky-golden').setDisplaySize(GAME_WIDTH * 1.04, GAME_HEIGHT * 1.04);
    else if (this.textures.exists('rendered-sky-day')) this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'rendered-sky-day').setDisplaySize(GAME_WIDTH * 1.04, GAME_HEIGHT * 1.04);
    else this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    if (arenaKey) {
      const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, arenaKey).setScale(1.08);
      if (this.renderer.type === Phaser.WEBGL) bg.preFX?.addBlur(1, 2, 2, 1.2);
    }
    const veil = this.add.graphics();
    veil.fillGradientStyle(0x0a2230, 0x0a2230, 0x06141a, 0x06141a, 0.28, 0.28, 0.5, 0.5);
    veil.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    // Swirling rays behind the title
    const rays = this.add.graphics({ x: GAME_WIDTH / 2, y: 150 });
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      rays.fillStyle(this.info.color, 0.08);
      rays.slice(0, 0, 1400, a0, a0 + 0.12, false);
      rays.fillPath();
    }
    this.tweens.add({ targets: rays, angle: 360, duration: 40000, repeat: -1 });
    const header = addTitle(this, GAME_WIDTH / 2, 62, 'MINIGAME!', 50, CSS.goldLight);
    header.setScale(0.4);
    this.tweens.add({ targets: header, scale: 1, duration: 360, ease: 'Back.Out' });
    audio.play('fanfare');
    const title = addTitle(this, GAME_WIDTH / 2, 140, this.info.name.toUpperCase(), 92);
    title.setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, y: 146, delay: 250, duration: 300, ease: 'Back.Out' });
    addText(this, GAME_WIDTH / 2, 214, this.info.tagline, 30, { color: CSS.creamDark, weight: 700 });

    // Left: large live preview. Right: rules panel.
    const PX = 150;
    const PY = 256;
    const PW = 860;
    const PH = 484;
    if (arenaKey) this.buildArenaPreview(arenaKey, PX, PY, PW, PH);
    else {
      const frame = this.add.graphics();
      frame.fillStyle(0x0c2630, 0.85);
      frame.fillRoundedRect(PX, PY, PW, PH, 28);
      const pv = this.info.preview;
      const art = pv.frame !== undefined ? this.add.sprite(PX + PW / 2, PY + PH / 2, pv.texture, pv.frame) : this.add.image(PX + PW / 2, PY + PH / 2, pv.texture);
      if (pv.frame !== undefined) {
        const o = centerOrigin(pv.texture, pv.frame);
        art.setOrigin(o.x, o.y);
      }
      if (this.textures.exists(pv.texture)) art.setScale(pv.scale * 1.4);
      const glow = this.add.image(PX + PW / 2, PY + PH / 2, 'fx-dot').setScale(20).setTint(this.info.color).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD);
      this.children.moveBelow(glow, art);
      this.tweens.add({ targets: art, y: art.y - 15, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      frame.lineStyle(6, this.info.color, 1);
      frame.strokeRoundedRect(PX, PY, PW, PH, 28);
    }
    const lead = this.launchData.players.find((pl) => !pl.isCpu) ?? this.launchData.players[0];
    if (lead) {
      const hero = new Character(this, PX + PW - 40, PY + PH + 50, lead.characterId, { scale: 0.95 });
      hero.setDepth(50);
      hero.play('celebrate');
      this.time.addEvent({ delay: 2600, loop: true, callback: () => hero.play('celebrate', { force: true }) });
    }
    const RX = 1050;
    const RW = 720;
    // Frosted cream card with a header band in the minigame's colour (bright, like the world).
    const panel = this.add.graphics();
    panel.fillStyle(0x06141a, 0.22);
    panel.fillRoundedRect(RX + 5, PY + 9, RW, PH, 28);
    panel.fillStyle(0xfff8ea, 0.95);
    panel.fillRoundedRect(RX, PY, RW, PH, 28);
    panel.fillStyle(this.info.color, 1);
    panel.fillRoundedRect(RX, PY, RW, 76, { tl: 28, tr: 28, bl: 0, br: 0 });
    panel.fillStyle(0xffffff, 0.18);
    panel.fillRoundedRect(RX + 10, PY + 6, RW - 20, 28, { tl: 22, tr: 22, bl: 6, br: 6 });
    panel.lineStyle(3, 0xffffff, 0.9);
    panel.strokeRoundedRect(RX, PY, RW, PH, 28);
    addText(this, RX + 34, PY + 39, 'HOW TO PLAY', 28, { color: '#ffffff', weight: 700, align: 'left', stroke: '#06141a', strokeThickness: 4 });
    addText(this, RX + RW - 30, PY + 39, `${this.info.players}  ·  ${this.info.duration}`, 20, { color: '#ffffff', weight: 700, align: 'right', stroke: '#06141a', strokeThickness: 3 });
    const lines = mode === 'on' ? this.info.instructions : [this.info.description];
    lines.forEach((line, i) => {
      const y = PY + 116 + i * 78;
      const g = this.add.graphics();
      g.fillStyle(this.info.color, 1);
      g.fillCircle(RX + 56, y, 22);
      g.lineStyle(3, 0xfff4dc, 0.9);
      g.strokeCircle(RX + 56, y, 22);
      addText(this, RX + 56, y - 1, String(i + 1), 24, { color: '#ffffff', weight: 700, stroke: '#06141a', strokeThickness: 4 });
      addText(this, RX + 96, y, line, 25, { color: CSS.ink, weight: 600, align: 'left', wrap: RW - 130 });
    });
    const cg = this.add.graphics();
    cg.fillStyle(0x0c2630, 0.1);
    cg.fillRoundedRect(RX + 24, PY + PH - 92, RW - 48, 70, 35);
    new PromptBar(this, RX + RW / 2, PY + PH - 57, this.info.controls, { size: 42, fontSize: 26, color: CSS.ink });

    // Ready check: slim capsules with portraits, like the lobby.
    const n = this.launchData.players.length;
    this.launchData.players.forEach((p, i) => {
      const x = GAME_WIDTH / 2 + (i - (n - 1) / 2) * 430;
      const y = 870;
      const w = 390;
      const h = 104;
      const g = this.add.graphics();
      g.fillStyle(0x06141a, 0.3);
      g.fillRoundedRect(x - w / 2 + 4, y - h / 2 + 7, w, h, h / 2);
      g.fillStyle(0x0c2630, 0.88);
      g.fillRoundedRect(x - w / 2, y - h / 2, w, h, h / 2);
      g.lineStyle(4, PLAYER_COLORS[p.slot], 1);
      g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, h / 2);
      const portrait = addPortrait(this, p.characterId, p.slot, 46, { worldX: x - w / 2 + 50, worldY: y });
      portrait.setPosition(x - w / 2 + 50, y);
      addText(this, x - w / 2 + 112, y - 22, CHARACTERS[p.characterId].name.split(' ')[0].toUpperCase(), 20, { color: CSS.creamDark, weight: 700, align: 'left' });
      const mark = addText(this, x - w / 2 + 112, y + 14, p.isCpu ? 'CPU READY' : 'READY?', 30, { color: p.isCpu ? CSS.crystal : CSS.cream, weight: 700, align: 'left' });
      this.readyMarks.set(p.slot, mark);
      this.ready.set(p.slot, p.isCpu);
      if (!p.isCpu) {
        // "Press A" with the glyph for this player's own device.
        const glyph = makeGlyph(this, 'A', 46, glyphKindFor(p.slot));
        glyph.setPosition(x + w / 2 - 20 - glyph.width / 2, y);
        this.readyGlyphs.set(p.slot, glyph);
        this.tweens.add({ targets: glyph, scale: { from: 1, to: 1.12 }, duration: 500, yoyo: true, repeat: -1 });
      }
    });
    new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 60, [{ button: 'A', label: 'Ready!' }], { size: 38, fontSize: 26 });
  }

  /** Live mini-preview: the rendered arena with this match's characters playing in it. */
  private buildArenaPreview(key: string, x0: number, y0: number, w: number, h: number): void {
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
    frame.lineStyle(2, 0xfff4dc, 0.5);
    frame.strokeRoundedRect(x0 + 5, y0 + 5, w - 10, h - 10, 18);
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
    const chip = this.add.graphics();
    chip.fillStyle(0x0c2630, 0.85);
    chip.fillRoundedRect(x0 + 18, y0 + 18, 132, 36, 18);
    addText(this, x0 + 84, y0 + 36, 'PREVIEW', 18, { color: CSS.cream, weight: 700 });
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
