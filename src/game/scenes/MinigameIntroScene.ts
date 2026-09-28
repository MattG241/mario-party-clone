import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { Character } from '../characters/Character';
import { CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { CHARACTERS } from '../data/characters';
import { EffectsManager } from '../effects/EffectsManager';
import { input } from '../input/InputManager';
import { minigameInfo, type MinigameInfo, type MinigameLaunch } from '../minigames/MinigameManager';
import { LITE } from '../perf';
import { settings } from '../save/SettingsManager';
import { glyphKindFor, makeGlyph, PromptBar } from '../ui/ControllerPrompt';
import { TitleLockup } from '../ui/Lockup';
import { addPortrait } from '../ui/Portrait';
import { addText } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { centerOrigin, solidHeight, standOrigin } from '../util/spriteUtil';
import { drawCard, drawRibbon, drawSlate, innerShadow, shade, UI } from '../ui/Style';
import { HIDE_CPU_TAGS } from '../debug/debug';
import { finishMinigameRenders, queueMinigameRenders } from '../data/minigameRenders';
import { NPC_ATLAS, npcFrame, type NpcId } from '../data/npcs';

/** Card geometry: the live preview on the left, the rules card on the right. */
const PX = 150;
const PY = 262;
const PW = 860;
const PH = 478;
const RX = 1050;
const RW = 720;
const READY_Y = 872;

function css(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** "MINIGAME!" card: the name as a title lockup, rules, controls, and a ready check for every human. */
export class MinigameIntroScene extends Phaser.Scene {
  private launchData!: MinigameLaunch;
  private info!: MinigameInfo;
  private ready = new Map<number, boolean>();
  private readyMarks = new Map<number, Phaser.GameObjects.Text>();
  private readyGlyphs = new Map<number, Phaser.GameObjects.Container>();
  private readyCards = new Map<number, { x: number; y: number; w: number; h: number; flash: Phaser.GameObjects.Graphics }>();
  private started = false;
  private launching = false;
  private autoTimer = 0;
  private fx!: EffectsManager;

  constructor() {
    super('MinigameIntro');
  }

  init(data: MinigameLaunch): void {
    this.launchData = data;
    this.info = minigameInfo(data.id)!;
    this.ready.clear();
    this.readyMarks.clear();
    this.readyGlyphs.clear();
    this.readyCards.clear();
    this.started = false;
    this.launching = false;
    this.autoTimer = 0;
  }

  preload(): void {
    // Lazy-load this minigame's own art while the card is up (and its rendered arena, releasing the last one).
    for (const a of this.info.assets ?? []) {
      if (!this.textures.exists(a.key)) this.load.svg(a.key, a.path, { width: a.width, height: a.height });
    }
    queueMinigameRenders(this, this.info.id);
  }

  create(): void {
    finishMinigameRenders(this, this.info.id);
    enterScene(this);
    const mode = this.launchData.instructions;
    if (mode === 'off') {
      this.start();
      return;
    }
    this.fx = new EffectsManager(this, 800);
    audio.playMusic('minigame');
    const reduced = settings.get().reducedMotion;
    const arenaKey = this.info.arena && this.textures.exists(this.info.arena) ? this.info.arena : null;
    this.buildBackdrop(arenaKey);
    this.buildTitle(reduced);

    // Left: large live preview. Right: rules card.
    const preview = arenaKey ? this.buildArenaPreview(arenaKey, PX, PY, PW, PH) : this.buildPosterPreview(PX, PY, PW, PH);
    const rules = this.buildRules(mode === 'on' ? this.info.instructions : [this.info.description]);
    if (!reduced) {
      // The cards slide in from either side.
      preview.x -= 70;
      preview.alpha = 0;
      this.tweens.add({ targets: preview, x: preview.x + 70, alpha: 1, duration: 320, delay: 120, ease: 'Cubic.Out' });
      rules.x += 70;
      rules.alpha = 0;
      this.tweens.add({ targets: rules, x: rules.x - 70, alpha: 1, duration: 320, delay: 200, ease: 'Cubic.Out' });
    }
    this.buildReadyCheck(reduced);
    new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 58, [{ button: 'A', label: 'Ready!' }], { size: 38, fontSize: 26 });
  }

  // --- Backdrop and title ------------------------------------------------------------------------
  private buildBackdrop(arenaKey: string | null): void {
    // The arena itself (or the sky), dimmed under a navy veil so the cards read.
    const sky = ['rendered-sky-golden', 'rendered-sky-day'].find((k) => this.textures.exists(k));
    if (sky) this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, sky).setDisplaySize(GAME_WIDTH * 1.04, GAME_HEIGHT * 1.04);
    else this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    // Pre-blurred arena backdrop (a live full-screen blur is too costly on weak GPUs).
    if (arenaKey && this.textures.exists(`${arenaKey}_blur`)) {
      this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, `${arenaKey}_blur`).setDisplaySize(GAME_WIDTH * 1.08, GAME_HEIGHT * 1.08);
    } else if (arenaKey) {
      this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, arenaKey).setScale(1.08).setAlpha(0.7);
    }
    const veil = this.add.graphics();
    veil.fillGradientStyle(0x0a2230, 0x0a2230, 0x06141a, 0x06141a, 0.3, 0.3, 0.42, 0.42);
    veil.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  }

  private buildTitle(reduced: boolean): void {
    const color = this.info.color;
    const cx = GAME_WIDTH / 2;
    // A slow sunburst in the game's colour behind the name.
    if (this.textures.exists('fx-rays')) {
      const rays = this.add.image(cx, 136, 'fx-rays').setScale(2.1, 1.25).setTint(color).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      this.tweens.add({ targets: rays, alpha: 0.32, duration: 500, delay: 150 });
      if (!reduced) this.tweens.add({ targets: rays, angle: 360, duration: 40000, repeat: -1 });
    }
    // A soft dark pool so the gold letters stand off the busy backdrop.
    this.add.image(cx, 140, 'fx-dot').setScale(44, 7).setTint(0x06141a).setAlpha(0.5);

    // "MINIGAME" on a small ribbon above the name.
    const tag = this.add.container(cx, 50);
    const tg = this.add.graphics();
    drawRibbon(tg, 0, 0, 230, 40, color, { tail: 30, shadow: 0.6 });
    const tt = addText(this, 0, -1, 'MINIGAME', 24, { color: '#ffffff', weight: 700, fixed: true }).setShadow(0, 2, css(shade(color, 0.4)), 0, false, true);
    tag.add([tg, tt]);
    tag.setScale(0.5);
    this.tweens.add({ targets: tag, scale: 1, duration: 260, ease: 'Back.Out' });
    audio.play('fanfare');

    // The name: gold letters dropping in one by one, rippling now and then while the card is up.
    const name = this.info.name.toUpperCase();
    const size = name.length > 14 ? 96 : 108;
    const lockup = new TitleLockup(this, cx, 136, name, { size });
    const k = Math.min(1, 1500 / lockup.lockWidth);
    lockup.setScale(k);
    void lockup.play(160).then(() => {
      if (!reduced) this.tweens.add({ targets: lockup, scale: { from: k * 1.06, to: k }, duration: 200, ease: 'Quad.Out' });
      audio.play('pop', { rate: 1.2, volume: 0.5 });
      // Now and then a ripple runs along the name while the card is up.
      lockup.waveEvery(4200, 1600);
    });

    // The tagline on a slim slate plate beneath.
    const line = addText(this, cx, 210, this.info.tagline, 30, { color: '#ffffff', weight: 700 });
    const pw = line.width + 64;
    const plate = this.add.graphics();
    drawSlate(plate, cx - pw / 2, 210 - 25, pw, 50, { alpha: 0.62 });
    this.children.moveBelow(plate, line);
    if (!reduced) {
      for (const o of [plate, line]) {
        o.setAlpha(0);
        o.y += 14;
        this.tweens.add({ targets: o, alpha: 1, y: o.y - 14, duration: 260, delay: 620, ease: 'Cubic.Out' });
      }
    }
  }

  // --- Preview -----------------------------------------------------------------------------------
  /** A white photo frame with a "LIVE" chip; returns the container holding the whole preview. */
  private framePreview(x0: number, y0: number, w: number, h: number): Phaser.GameObjects.Container {
    const holder = this.add.container(0, 0);
    const back = this.add.graphics();
    drawCard(back, x0 - 12, y0 - 12, w + 24, h + 24, { radius: 32, bevel: true, shadow: 1.3 });
    holder.add(back);
    return holder;
  }

  private liveChip(holder: Phaser.GameObjects.Container, x0: number, y0: number): void {
    const chip = this.add.graphics();
    drawSlate(chip, x0 + 18, y0 + 18, 196, 38, { alpha: 0.72 });
    const dot = this.add.graphics();
    dot.fillStyle(0xff4d4d, 1);
    dot.fillCircle(x0 + 42, y0 + 37, 7);
    const label = addText(this, x0 + 58, y0 + 37, 'LIVE PREVIEW', 18, { color: '#ffffff', weight: 700, align: 'left' });
    holder.add([chip, dot, label]);
    if (!settings.get().reducedMotion) this.tweens.add({ targets: dot, alpha: { from: 1, to: 0.25 }, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  /** Live mini-preview: the rendered arena with this match's characters playing in it. */
  private buildArenaPreview(key: string, x0: number, y0: number, w: number, h: number): Phaser.GameObjects.Container {
    const holder = this.framePreview(x0, y0, w, h);
    const scale = w / GAME_WIDTH;
    // Content lives in `inner` (preview-local pixels); `root` sits at the centre so it can drift and zoom.
    const root = this.add.container(x0 + w / 2, y0 + h / 2);
    const inner = this.add.container(-w / 2, -h / 2);
    root.add(inner);
    holder.add(root);
    const skyKey = ['rendered-sky-clear', 'rendered-sky-day'].find((k) => this.textures.exists(k));
    if (skyKey) inner.add(this.add.image(w / 2, h / 2, skyKey).setDisplaySize(w * 1.2, h * 1.2).setFlipX(this.info.id === 'gleam-grab'));
    inner.add(this.add.image(0, (h - GAME_HEIGHT * scale) / 2, key).setOrigin(0).setScale(scale));
    if (key === 'rendered-scene-gleam3d') this.previewCrowd(inner, scale, (h - GAME_HEIGHT * scale) / 2);
    const maskG = this.make.graphics({ x: 0, y: 0 }, false);
    maskG.fillStyle(0xffffff);
    maskG.fillRoundedRect(x0, y0, w, h, 22);
    root.setMask(maskG.createGeometryMask());
    // Characters running around the arena (scaled down).
    const cy = (h - GAME_HEIGHT * scale) / 2;
    this.launchData.players.forEach((p, i) => {
      const sx = (560 + i * 260) * scale;
      const sy = cy + (560 + (i % 2) * 180) * scale;
      const c = new Character(this, sx, sy, p.characterId, { scale: 0.58 * scale, shadow: true });
      inner.add(c);
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
    this.previewProps(inner, scale, cy);
    if (!settings.get().reducedMotion) {
      // A slow camera drift (a gentle push in and out), and a sheen crossing the glass now and then.
      this.tweens.add({ targets: root, scale: 1.045, x: root.x - 10, duration: 6000, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      const sheen = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.14);
      sheen.fillStyle(0xffffff, 1);
      sheen.fillPoints([new Phaser.Math.Vector2(0, 0), new Phaser.Math.Vector2(90, 0), new Phaser.Math.Vector2(-60, h), new Phaser.Math.Vector2(-150, h)], true);
      sheen.fillPoints([new Phaser.Math.Vector2(120, 0), new Phaser.Math.Vector2(140, 0), new Phaser.Math.Vector2(-10, h), new Phaser.Math.Vector2(-30, h)], true);
      sheen.x = -200;
      inner.add(sheen);
      this.tweens.add({ targets: sheen, x: w + 220, duration: 1300, delay: 1400, repeat: -1, repeatDelay: 4200, ease: 'Sine.InOut' });
    }
    const frame = this.add.graphics();
    frame.lineStyle(2, 0x000000, 0.1);
    frame.strokeRoundedRect(x0, y0, w, h, 22);
    holder.add(frame);
    this.liveChip(holder, x0, y0);
    return holder;
  }

  /** Games without a rendered arena: their card art on a glowing poster in the game's colour. */
  private buildPosterPreview(x0: number, y0: number, w: number, h: number): Phaser.GameObjects.Container {
    const holder = this.framePreview(x0, y0, w, h);
    const frame = this.add.graphics();
    frame.fillStyle(shade(this.info.color, 0.45), 1);
    frame.fillRoundedRect(x0, y0, w, h, 22);
    frame.fillStyle(shade(this.info.color, 0.7), 1);
    frame.fillRoundedRect(x0, y0, w, h * 0.55, { tl: 22, tr: 22, bl: 0, br: 0 });
    holder.add(frame);
    const glow = this.add.image(x0 + w / 2, y0 + h / 2, 'fx-dot').setScale(20).setTint(this.info.color).setAlpha(0.45).setBlendMode(Phaser.BlendModes.ADD);
    holder.add(glow);
    const pv = this.info.preview;
    if (this.textures.exists(pv.texture)) {
      const art = pv.frame !== undefined ? this.add.sprite(x0 + w / 2, y0 + h / 2, pv.texture, pv.frame) : this.add.image(x0 + w / 2, y0 + h / 2, pv.texture);
      if (pv.frame !== undefined) {
        const o = centerOrigin(pv.texture, pv.frame);
        art.setOrigin(o.x, o.y);
      }
      art.setScale(pv.scale * 1.4);
      holder.add(art);
      if (!settings.get().reducedMotion) this.tweens.add({ targets: art, y: art.y - 15, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    return holder;
  }

  /**
   * Gleam Grab's bleachers filled with festival folk, as in the game (placed from the arena's own
   * tier data), with the arena's front wall drawn back over them.
   */
  private previewCrowd(root: Phaser.GameObjects.Container, scale: number, cy: number): void {
    const meta = this.cache.json.get('rendered-gleam3d') as { tiers?: { y: number; x0: number; x1: number; scale: number }[] } | undefined;
    if (!meta?.tiers?.length) return;
    const ids: NpcId[] = ['ora', 'pipper', 'packsprout', 'wrench', 'mimi'];
    const poses = ['cheer', 'happy', 'wave', 'laugh'];
    const calm = settings.get().reducedMotion;
    let n = 0;
    meta.tiers.forEach((t, ti) => {
      const count = Math.max(5, (LITE ? 9 : 12) - ti * 2);
      const step = (t.x1 - t.x0) / count;
      for (let k = 0; k < count; k++) {
        const id = ids[(n * 2 + ti) % ids.length];
        let frame = npcFrame(id, poses[(n + ti) % poses.length]);
        if (!this.textures.get(NPC_ATLAS).has(frame)) frame = npcFrame(id, 'happy');
        const x = (t.x0 + (k + 0.5) * step) * scale;
        const y = cy + (t.y - 2) * scale;
        const spr = this.add.sprite(x, y, NPC_ATLAS, frame);
        const o = standOrigin(NPC_ATLAS, frame);
        spr.setOrigin(o.x, o.y).setScale(0.28 * t.scale * scale * (1 + ((n * 37) % 7) * 0.02)).setFlipX(x > (GAME_WIDTH * scale) / 2);
        if (ti > 0) spr.setTint(ti === 1 ? 0xf1f4fa : 0xe4e9f2);
        root.add(spr);
        if (!calm) this.tweens.add({ targets: spr, y: y - 3, duration: 380 + (n % 4) * 70, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: (n * 53) % 400 });
        n++;
      }
    });
    if (this.textures.exists('rendered-scene-gleam3d_wall')) root.add(this.add.image(0, cy, 'rendered-scene-gleam3d_wall').setOrigin(0).setScale(scale));
  }

  /** The minigame's own objects in the preview (so it illustrates the rules, not just the arena). */
  private previewProps(root: Phaser.GameObjects.Container, scale: number, cy: number): void {
    if (this.info.id === 'gleam-grab') {
      const spots: [number, number, string][] = [
        [720, 640, '0'],
        [1180, 560, '0'],
        [1340, 780, '12'],
        [900, 820, '0'],
        [1500, 600, '0'],
      ];
      spots.forEach(([ax, ay, frame], i) => {
        const fx = ax * scale;
        const fy = cy + ay * scale;
        const sh = this.add.image(fx, fy, 'fx-contact').setScale(0.09, 0.035).setAlpha(0.5);
        const spr = this.add.sprite(fx, fy - 40, 'items', frame);
        const o = centerOrigin('items', frame);
        spr.setOrigin(o.x, o.y).setScale(0.2);
        spr.play(frame === '12' ? 'capsule-idle' : 'chip-spin');
        root.add([sh, spr]);
        // fall, bounce, rest, repeat
        this.tweens.add({ targets: spr, y: { from: fy - 170, to: fy - 12 }, duration: 700, ease: 'Bounce.Out', delay: i * 380, hold: 1500, repeat: -1, repeatDelay: 600 });
      });
    } else if (this.info.id === 'orbit-dodge' && this.textures.exists('rendered-orbit-arms')) {
      const tex = this.textures.get('rendered-orbit-arms');
      const n = tex.getFrameNames().filter((f) => f.startsWith('low_')).length;
      const meta = (tex.customData as { meta?: { scale?: number } }).meta;
      const arm = this.add.sprite(0, cy, 'rendered-orbit-arms', 'low_00').setOrigin(0).setScale((1 / (meta?.scale ?? 0.6)) * scale);
      root.add(arm);
      let f = 0;
      this.time.addEvent({ delay: 60, loop: true, callback: () => arm.setFrame(`low_${String((f = (f + 1) % n)).padStart(2, '0')}`) });
    }
  }

  // --- Rules card --------------------------------------------------------------------------------
  private buildRules(lines: string[]): Phaser.GameObjects.Container {
    const color = this.info.color;
    const holder = this.add.container(0, 0);
    const panel = this.add.graphics();
    drawCard(panel, RX, PY, RW, PH, { radius: 28, bevel: true, shadow: 1.2 });
    innerShadow(panel, RX + 14, PY + 44, RW - 28, 16, 0.12);
    holder.add(panel);
    // Ribbon header across the top, its tails folded behind the card's edges.
    const rib = this.add.graphics();
    drawRibbon(rib, RX + RW / 2, PY + 6, RW + 40, 62, color, { tail: 46 });
    holder.add(rib);
    holder.add(addText(this, RX + RW / 2, PY + 5, 'HOW TO PLAY', 32, { color: '#ffffff', weight: 700 }).setShadow(0, 3, css(shade(color, 0.35)), 0, false, true));
    // Players and length as two small chips under the ribbon.
    const chips = [this.info.players, this.info.duration];
    const chipTexts = chips.map((t) => addText(this, 0, PY + 64, t.toUpperCase(), 17, { color: UI.inkSecondCss, weight: 700 }));
    const cw = chipTexts.map((t) => t.width + 30);
    let x = RX + RW / 2 - (cw[0] + cw[1] + 12) / 2;
    chipTexts.forEach((t, i) => {
      const g = this.add.graphics();
      g.fillStyle(UI.cardSoft, 1);
      g.fillRoundedRect(x, PY + 64 - 14, cw[i], 28, 14);
      g.lineStyle(1.5, UI.line, 1);
      g.strokeRoundedRect(x, PY + 64 - 14, cw[i], 28, 14);
      t.setX(x + cw[i] / 2);
      holder.add([g, t]);
      x += cw[i] + 12;
    });
    // Up to four rules between the header and the controls tray.
    const minRow = lines.length > 3 ? 62 : 70;
    const gap = lines.length > 3 ? 7 : 10;
    const reduced = settings.get().reducedMotion;
    let cursor = PY + 90;
    lines.forEach((line, i) => {
      // Rows grow to fit their text (quick mode shows the whole description as one row).
      const text = addText(this, RX + 108, 0, line, 24, { color: UI.inkCss, weight: 600, align: 'left', wrap: RW - 140 });
      const rowH = Math.max(minRow, Math.ceil(text.height) + 22);
      const y = cursor + rowH / 2;
      cursor += rowH + gap;
      text.setY(y);
      const row = this.add.container(0, 0);
      const g = this.add.graphics();
      g.fillStyle(UI.cardSoft, 1);
      g.fillRoundedRect(RX + 22, y - rowH / 2, RW - 44, rowH, 20);
      g.fillStyle(0xffffff, 0.8);
      g.fillRoundedRect(RX + 24, y - rowH / 2 + 2, RW - 48, 3, 1.5);
      // Icon medallion: white disc, coloured ring and a small drop shadow.
      g.fillStyle(UI.shadow, 0.14);
      g.fillCircle(RX + 62, y + 3, 28);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(RX + 62, y, 28);
      g.lineStyle(4, color, 1);
      g.strokeCircle(RX + 62, y, 26);
      row.add(g);
      const icon = this.info.ruleIcons?.[i];
      if (icon && this.textures.exists(icon.texture)) {
        const img = icon.frame !== undefined ? this.add.image(RX + 62, y, icon.texture, icon.frame) : this.add.image(RX + 62, y, icon.texture);
        if (icon.frame !== undefined) {
          const o = centerOrigin(icon.texture, icon.frame);
          img.setOrigin(o.x, o.y);
          img.setScale(40 / solidHeight(icon.texture, icon.frame));
        } else img.setScale(40 / Math.max(img.width, img.height));
        row.add(img);
      } else row.add(addText(this, RX + 62, y - 1, String(i + 1), 26, { color: UI.inkCss, weight: 700 }));
      row.add(text);
      holder.add(row);
      if (!reduced) {
        row.setAlpha(0);
        row.x = 40;
        this.tweens.add({ targets: row, alpha: 1, x: 0, duration: 260, delay: 360 + i * 90, ease: 'Cubic.Out' });
      }
    });
    // Controls on their own tray along the bottom of the card.
    const trayY = PY + PH - 58;
    const tray = this.add.graphics();
    tray.fillStyle(shade(UI.cardSoft, 0.95), 1);
    tray.fillRoundedRect(RX + 22, trayY - 38, RW - 44, 76, 22);
    tray.lineStyle(2, UI.line, 1);
    tray.strokeRoundedRect(RX + 22, trayY - 38, RW - 44, 76, 22);
    holder.add(tray);
    holder.add(addText(this, RX + 48, trayY - 38, 'CONTROLS', 15, { color: UI.inkSecondCss, weight: 700, align: 'left' }).setOrigin(0, 0.5).setBackgroundColor(css(shade(UI.cardSoft, 0.95))).setPadding(6, 1, 6, 1));
    holder.add(new PromptBar(this, RX + RW / 2, trayY + 2, this.info.controls, { size: 44, fontSize: 27, color: UI.inkCss }));
    return holder;
  }

  // --- Ready check -------------------------------------------------------------------------------
  private buildReadyCheck(reduced: boolean): void {
    // Slim bevelled capsules with portraits, like the lobby.
    const n = this.launchData.players.length;
    this.launchData.players.forEach((p, i) => {
      const x = GAME_WIDTH / 2 + (i - (n - 1) / 2) * 430;
      const y = READY_Y;
      const w = 390;
      const h = 104;
      const card = this.add.container(0, 0);
      const g = this.add.graphics();
      drawCard(g, x - w / 2, y - h / 2, w, h, { radius: h / 2, bevel: true });
      g.fillStyle(PLAYER_COLORS[p.slot], 1);
      g.fillRoundedRect(x - w / 2 + 110, y + h / 2 - 12, w - 150, 5, 2.5);
      const flash = this.add.graphics().setAlpha(0);
      flash.fillStyle(0xffffff, 1);
      flash.fillRoundedRect(x - w / 2, y - h / 2, w, h, h / 2);
      const portrait = addPortrait(this, p.characterId, p.slot, 46, { worldX: x - w / 2 + 50, worldY: y });
      portrait.setPosition(x - w / 2 + 50, y);
      const name = addText(this, x - w / 2 + 112, y - 22, CHARACTERS[p.characterId].short.toUpperCase(), 22, { color: UI.inkSecondCss, weight: 700, align: 'left' });
      const mark = addText(this, x - w / 2 + 112, y + 14, p.isCpu ? (HIDE_CPU_TAGS ? 'READY!' : 'CPU READY') : 'READY?', 30, { color: p.isCpu ? CSS.tealDark : UI.inkCss, weight: 700, align: 'left' });
      card.add([g, portrait, name, mark, flash]);
      this.readyMarks.set(p.slot, mark);
      this.readyCards.set(p.slot, { x, y, w, h, flash });
      this.ready.set(p.slot, p.isCpu);
      if (!p.isCpu) {
        // "Press A" with the glyph for this player's own device.
        const glyph = makeGlyph(this, 'A', 46, glyphKindFor(p.slot));
        glyph.setPosition(x + w / 2 - 20 - glyph.width / 2, y);
        card.add(glyph);
        this.readyGlyphs.set(p.slot, glyph);
        if (!reduced) this.tweens.add({ targets: glyph, scale: { from: 1, to: 1.1 }, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      }
      if (!reduced) {
        card.setAlpha(0);
        card.y = 60;
        this.tweens.add({ targets: card, alpha: 1, y: 0, duration: 300, delay: 420 + i * 80, ease: 'Back.Out' });
      }
    });
  }

  /** A player checks in: the capsule flashes, READY! stamps on and a little burst goes off. */
  private markReady(slot: number): void {
    const mark = this.readyMarks.get(slot);
    const card = this.readyCards.get(slot);
    const glyph = this.readyGlyphs.get(slot);
    if (glyph) {
      this.tweens.killTweensOf(glyph);
      glyph.destroy();
    }
    this.readyGlyphs.delete(slot);
    if (mark) {
      this.tweens.killTweensOf(mark);
      mark.setY(mark.y - 4).setText('READY!').setColor(CSS.tealDark).setScale(1.6).setAngle(-6);
      this.tweens.add({ targets: mark, scale: 1, angle: 0, duration: 260, ease: 'Back.Out' });
    }
    if (card) {
      card.flash.setAlpha(0.8);
      this.tweens.add({ targets: card.flash, alpha: 0, duration: 320, ease: 'Quad.Out' });
      this.fx.sparks(card.x + card.w / 2 - 60, card.y, LITE ? 10 : 18);
      if (this.textures.exists('fx-ring') && !settings.get().reducedMotion) {
        const ring = this.add.image(card.x - card.w / 2 + 50, card.y, 'fx-ring').setTint(PLAYER_COLORS[slot]).setScale(0.5).setAlpha(0.9);
        this.tweens.add({ targets: ring, scale: 1.3, alpha: 0, duration: 420, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
      }
    }
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
        this.markReady(p.slot);
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
