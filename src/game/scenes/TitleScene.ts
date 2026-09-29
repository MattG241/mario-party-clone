import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { Character } from '../characters/Character';
import { GAME_HEIGHT, GAME_WIDTH, SUBTITLE, TITLE } from '../constants';
import { CHARACTER_IDS } from '../data/characters';
import { EffectsManager } from '../effects/EffectsManager';
import { input } from '../input/InputManager';
import { saves } from '../save/SaveManager';
import { session } from '../state/Session';
import { glyphKindFor, makeGlyph, PromptBar, type GlyphKind } from '../ui/ControllerPrompt';
import { Menu } from '../ui/Menu';
import { drawCard, drawSlate, UI } from '../ui/Style';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { findBoard } from '../data/boards';
import { applyGrade } from '../effects/GradePipeline';
import { addStrip } from '../ui/Screen';
import { settings } from '../save/SettingsManager';
import { LITE } from '../perf';

/**
 * Title screen. Attract state ("PRESS A"), then the main menu. The four heroes hang out on a
 * floating festival island and react to one another.
 */
export class TitleScene extends Phaser.Scene {
  private phase: 'attract' | 'menu' = 'attract';
  private menu!: Menu;
  private pressText!: Phaser.GameObjects.Container;
  private pressKind: GlyphKind | null = null;
  private prompts!: PromptBar;
  private hint!: Phaser.GameObjects.Text;
  /** Slate plate behind the menu hint (so it reads as a caption, not stray text). */
  private hintPlate!: Phaser.GameObjects.Graphics;
  private audioHint!: Phaser.GameObjects.Text;
  private chars: Character[] = [];
  private fx!: EffectsManager;
  private logo!: Phaser.GameObjects.Container;
  private busy = new Set<number>();
  private farIslands?: Phaser.GameObjects.TileSprite;
  private cloudsFar?: Phaser.GameObjects.TileSprite;
  private cloudsBelow?: Phaser.GameObjects.TileSprite;

  constructor() {
    super('Title');
  }

  create(): void {
    enterScene(this);
    applyGrade(this, { vignette: 0.08 });
    this.phase = 'attract';
    this.chars = [];
    this.busy.clear();
    audio.playMusic('menu');
    this.fx = new EffectsManager(this, 500);
    this.buildBackground();
    this.buildIsland();
    this.buildLogo();
    // Before the menu: it reports its first focus straight away. The hint only shows with the menu.
    this.hintPlate = this.add.graphics().setDepth(599).setVisible(false);
    this.hint = addText(this, 470, 1030, '', 26, { color: '#ffffff', weight: 600 }).setDepth(600).setVisible(false);
    this.buildMenu();
    // "Press A to start" on a clean white card under the logo; it breathes gently.
    this.pressText = this.add.container(440, 648).setDepth(600);
    this.pressKind = null;
    this.refreshPressPlate();
    this.tweens.add({ targets: this.pressText, alpha: { from: 1, to: 0.72 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.prompts = new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 60, [], { size: 40, fontSize: 28 }).setDepth(600).setVisible(false);
    this.audioHint = addText(this, GAME_WIDTH - 30, 36, '🔇 Press any key or click to enable sound', 22, { color: '#ffffff', align: 'right', weight: 600 })
      .setDepth(600)
      .setShadow(0, 2, 'rgba(10,17,32,0.5)', 5, false, true);
    this.time.addEvent({ delay: 2600, loop: true, callback: () => this.direct() });
    this.time.delayedCall(700, () => this.direct());
    if (window.__GLEAMTRAIL__) window.__GLEAMTRAIL__.ready = true;
  }

  private buildBackground(): void {
    this.farIslands = this.cloudsFar = this.cloudsBelow = undefined;
    const skyKey = ['rendered-sky-golden', 'rendered-sky-day'].find((k) => this.textures.exists(k));
    const calm = settings.get().reducedMotion;
    if (skyKey) {
      // Gentle parallax: the sky drifts slowly behind the island, far islets float at their own pace.
      const sky = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, skyKey).setDisplaySize(GAME_WIDTH * 1.08, GAME_HEIGHT * 1.08);
      if (!calm) this.tweens.add({ targets: sky, x: GAME_WIDTH / 2 - 26, duration: 16000, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      const islets: [number, number, number, number][] = [
        [1540, 250, 0.22, 0],
        [120, 620, 0.3, 1],
      ];
      for (const [x, y, k, v] of islets) {
        const key = `rendered-islet-${v}`;
        if (!this.textures.exists(key)) continue;
        const isl = this.add.image(x, y, key).setScale(k).setAlpha(0.9).setTint(0xf4e8e0);
        if (!calm) {
          this.tweens.add({ targets: isl, y: y - 14, duration: 3400 + v * 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
          this.tweens.add({ targets: isl, x: x + (v ? 30 : -30), duration: 12000 + v * 3000, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
        }
      }
      return;
    }
    this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    this.cloudsFar = addStrip(this, 0, 150, GAME_WIDTH, 420, 'bg-clouds-far').setOrigin(0).setAlpha(0.9);
    this.farIslands = addStrip(this, 0, 380, GAME_WIDTH, 640, 'bg-islands-far').setOrigin(0).setAlpha(0.85);
    this.cloudsBelow = addStrip(this, 0, 700, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setAlpha(0.95);
    // Distant floating islets drifting past
    for (let i = 0; i < 3; i++) {
      const isl = this.add.image(200 + i * 620, 600 + (i % 2) * 90, 'island-tiny').setScale(0.55 + i * 0.1).setAlpha(0.75);
      this.tweens.add({ targets: isl, y: isl.y - 18, duration: 2600 + i * 500, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
  }

  private buildIsland(): void {
    const cx = 1300;
    const island = this.add.container(cx, 0);
    if (this.textures.exists('rendered-scene-title')) {
      // Pre-rendered festival island (observatory, bunting, lanterns and trees baked in).
      island.add(this.add.image(-cx, 0, 'rendered-scene-title').setOrigin(0));
      this.animateWaterfall(island, cx);
    } else {
      this.buildVectorIsland(island);
    }
    // Staggered in depth (not a police line-up); nearer heroes a touch larger, added back to front.
    const spots: [number, number][] = [
      [-255, 712],
      [-88, 668],
      [86, 704],
      [248, 672],
    ];
    // Four of the roster, a different line-up each visit.
    const cast = Phaser.Utils.Array.Shuffle(CHARACTER_IDS.slice()).slice(0, spots.length);
    const made = cast.map((id, i) => {
      const [x, y] = spots[i];
      const c = new Character(this, x, y, id, { scale: 0.95 + ((y - 660) / 60) * 0.1 });
      c.face(i >= 2);
      return c;
    });
    [...made].sort((a, b) => a.y - b.y).forEach((c) => island.add(c));
    this.chars.push(...made);
    this.tweens.add({ targets: island, y: -14, duration: 3000, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  /**
   * Life for the rendered waterfall (a still streak in the render): highlights streaming down the
   * fall and mist billowing up from its foot. Placed in the island's coordinates so it bobs with it.
   */
  private animateWaterfall(island: Phaser.GameObjects.Container, cx: number): void {
    const calm = settings.get().reducedMotion;
    // The fall in screen pixels of the render: its lip, and its width near the top and the foot.
    const lipY = 800;
    const footY = 1068;
    const span = (y: number): [number, number] => {
      const k = (y - lipY) / (footY - lipY);
      return [1548 - 38 * k - cx, 1612 + 14 * k - cx];
    };
    if (!calm && this.textures.exists('px')) {
      // Bright streaks sliding down the water, each at a new spot across the fall every pass.
      const n = LITE ? 3 : 6;
      for (let i = 0; i < n; i++) {
        const streak = this.add.image(0, lipY, 'px').setScale(1.1, 15).setTint(0xeafcff).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
        island.add(streak);
        const place = () => {
          const [a, b] = span(lipY);
          streak.setPosition(Phaser.Math.FloatBetween(a + 4, b - 4), lipY);
        };
        place();
        // Only y and alpha are tweened, so each repeat keeps the fresh x that `place` picks.
        this.tweens.add({
          targets: streak,
          y: footY - 20,
          alpha: { from: 0.65, to: 0 },
          duration: Phaser.Math.Between(700, 1000),
          delay: i * 260,
          repeat: -1,
          repeatDelay: Phaser.Math.Between(100, 500),
          ease: 'Quad.In',
          onRepeat: place,
        });
      }
    }
    if (!this.textures.exists('fx-dot')) return;
    // Mist: soft white puffs rising and spreading from the foam at the foot of the fall.
    const [a, b] = span(footY);
    const mist = this.add.particles(0, 0, 'fx-dot', {
      x: { min: a - 10, max: b + 10 },
      y: { min: footY - 40, max: footY - 4 },
      lifespan: { min: 1300, max: 2100 },
      speedY: { min: -60, max: -24 },
      speedX: { min: -22, max: 22 },
      scale: { start: 2, end: 5 },
      alpha: { start: 0.5, end: 0 },
      tint: [0xffffff, 0xeaf8ff],
      frequency: (LITE ? 240 : 110) * (calm ? 2 : 1),
      maxParticles: LITE ? 14 : 30,
    });
    island.add(mist);
  }

  private buildVectorIsland(island: Phaser.GameObjects.Container): void {
    const base = this.add.image(0, 820, 'island-wide').setScale(1.08);
    island.add(base);
    // Festival dressing
    const poleL = this.add.rectangle(-470, 590, 12, 200, 0x5f3b1c).setOrigin(0.5, 1);
    const poleR = this.add.rectangle(470, 590, 12, 200, 0x5f3b1c).setOrigin(0.5, 1);
    const bunting = this.add.image(0, 420, 'bunting').setScale(1.5, 1.2);
    island.add([poleL, poleR, bunting]);
    for (const [x, y] of [
      [-300, 470],
      [0, 500],
      [300, 470],
    ] as const) {
      const l = this.add.image(x, y, 'lantern').setScale(0.7);
      island.add(l);
      this.tweens.add({ targets: l, angle: { from: -5, to: 5 }, duration: 1600 + x, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    const tree = this.add.image(610, 600, 'tree-twist').setScale(0.5);
    island.addAt(tree, 1);
  }

  /**
   * A glint across the rendered wordmark every few seconds: a soft band of light sweeps left to
   * right, then a sparkle twinkles on the last letter. The band is nine nested crops of the logo
   * itself, added over it: the gold faces flare while the dark outline and extrusion add almost
   * nothing, so the light stays on the letters, and the nesting ramps its edges smoothly.
   */
  private addLogoGlint(img: Phaser.GameObjects.Image, into: Phaser.GameObjects.Container): void {
    if (settings.get().reducedMotion) return;
    const tw = img.frame.width;
    const th = img.frame.height;
    const layers = Array.from({ length: 9 }, (_, i) => ({ w: 0.018 * (i + 1), a: 0.075 })).map((l) => ({
      ...l,
      img: this.add.image(img.x, img.y, img.texture.key).setScale(img.scaleX).setBlendMode(Phaser.BlendModes.ADD).setAlpha(l.a).setVisible(false),
    }));
    into.add(layers.map((l) => l.img));
    const star = this.add.graphics();
    star.fillStyle(0xffffff, 1);
    const r = 24;
    star.fillPoints([0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Phaser.Math.Vector2(Math.cos((i * Math.PI) / 4 - Math.PI / 2) * (i % 2 ? r * 0.24 : r), Math.sin((i * Math.PI) / 4 - Math.PI / 2) * (i % 2 ? r * 0.24 : r))), true);
    star.setPosition(img.x + (tw * img.scaleX) / 2 - 40, img.y - (th * img.scaleY) / 2 + 34).setScale(0);
    into.add(star);
    const sweep = { x: 0 };
    const apply = () => {
      for (const l of layers) {
        const bw = tw * l.w;
        l.img.setCrop(Phaser.Math.Clamp(sweep.x - bw / 2, 0, tw), 0, bw, th);
      }
    };
    const run = () => {
      sweep.x = -tw * 0.1;
      for (const l of layers) l.img.setVisible(true);
      apply();
      this.tweens.add({
        targets: sweep,
        x: tw * 1.1,
        duration: 900,
        ease: 'Sine.InOut',
        onUpdate: apply,
        onComplete: () => {
          for (const l of layers) l.img.setVisible(false);
          this.tweens.add({ targets: star, scale: 1, angle: 90, duration: 220, yoyo: true, hold: 80, ease: 'Sine.InOut' });
        },
      });
    };
    this.time.delayedCall(1400, run);
    this.time.addEvent({ delay: 5200, loop: true, callback: run });
  }

  private buildLogo(): void {
    // The rendered 3D wordmark (text fallback) with the subtitle in clean white beneath it.
    this.logo = this.add.container(440, 0).setDepth(400);
    let title: Phaser.GameObjects.Image | Phaser.GameObjects.Text;
    if (this.textures.exists('rendered-ui-logo')) {
      const img = this.add.image(0, 420, 'rendered-ui-logo');
      img.setScale(Math.min(1, 820 / img.width));
      title = img;
    } else title = addTitle(this, 0, 420, TITLE, 124);
    const sub = addTitle(this, 0, 528, SUBTITLE, 40);
    // The wordmark floats gently inside the logo group (which the menu moves and scales).
    const mark = this.add.container(0, 0, [title, sub]);
    this.logo.add(mark);
    if (title instanceof Phaser.GameObjects.Image) this.addLogoGlint(title, mark);
    if (!settings.get().reducedMotion) this.tweens.add({ targets: mark, y: 8, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  private buildMenu(): void {
    // A save made with characters no longer on the roster (or on a board that's gone) can't continue.
    const saved = saves.hasSave() ? saves.load() : null;
    const hasSave = !!saved && !!findBoard(saved.config.boardId);
    this.menu = new Menu(
      this,
      470,
      770,
      [
        { label: 'PLAY', hint: 'Start a new board match on the Spiral Isles.', onSelect: () => this.startPlay('board') },
        { label: 'CONTINUE', hint: 'Resume your saved board match.', disabled: () => !hasSave, onSelect: () => goTo(this, 'Board', { continue: true }) },
        { label: 'MINIGAME MODE', hint: 'Jump straight into minigames with friends.', onSelect: () => this.startPlay('minigame') },
        { label: 'HOW TO PLAY', hint: 'Ora explains the festival rules.', onSelect: () => goTo(this, 'HowToPlay') },
        { label: 'SETTINGS', hint: 'Audio, accessibility, controls and controller test.', onSelect: () => goTo(this, 'Settings', { from: 'Title' }) },
      ],
      {
        width: 460,
        itemHeight: 64,
        gap: 16,
        fontSize: 32,
        onCancel: () => this.closeMenu(),
        onFocus: (item) => this.setHint(item.hint ?? ''),
      },
    );
    this.menu.setDepth(500).setVisible(false);
    this.menu.enabled = false;
  }

  private startPlay(mode: 'board' | 'minigame'): void {
    session.mode = mode;
    session.resetSlots();
    for (let i = 0; i < 4; i++) input.assign(i, null);
    goTo(this, 'CharacterSelect');
  }

  private openMenu(): void {
    this.phase = 'menu';
    audio.play('confirm');
    this.pressText.setVisible(false);
    this.menu.setVisible(true).setAlpha(1);
    this.menu.x = 470;
    // The buttons slide in one after another.
    this.menu.buttons.forEach((b, i) => {
      this.tweens.killTweensOf(b);
      if (settings.get().reducedMotion) {
        b.setAlpha(1);
        return;
      }
      b.setAlpha(0).setX(-120);
      this.tweens.add({ targets: b, alpha: 1, x: 0, duration: 280, delay: i * 45, ease: 'Back.Out' });
    });
    this.tweens.killTweensOf(this.logo);
    this.tweens.add({ targets: this.logo, scale: 0.82, y: -40, duration: 260, ease: 'Quad.Out' });
    this.time.delayedCall(80, () => (this.menu.enabled = true));
    this.prompts.setVisible(true).setPrompts([
      { button: 'A', label: 'Select' },
      { button: 'B', label: 'Back' },
    ]);
    this.prompts.x = 1300;
    this.hint.setVisible(true);
    this.hintPlate.setVisible(true);
    this.setHint(this.menu.items[this.menu.index].hint ?? '');
    this.chars.forEach((c, i) => this.time.delayedCall(i * 120, () => c.play('wave')));
  }

  private closeMenu(): void {
    this.phase = 'attract';
    this.menu.enabled = false;
    this.tweens.add({ targets: this.menu, alpha: 0, x: 300, duration: 180, onComplete: () => this.menu.setVisible(false) });
    this.tweens.killTweensOf(this.logo);
    this.tweens.add({ targets: this.logo, scale: 1, y: 0, duration: 220 });
    this.pressText.setVisible(true);
    this.prompts.setVisible(false);
    this.hint.setVisible(false);
    this.hintPlate.setVisible(false);
  }

  /** The focused item's hint, on a slate plate sized to it. */
  private setHint(text: string): void {
    if (!this.hint) return;
    this.hint.setText(text);
    this.hintPlate.clear();
    if (!text) return;
    const w = this.hint.width + 64;
    drawSlate(this.hintPlate, this.hint.x - w / 2, this.hint.y - 26, w, 52, { alpha: 0.72 });
  }

  private refreshPressPlate(): void {
    const kind = glyphKindFor();
    if (kind === this.pressKind) return;
    this.pressKind = kind;
    const c = this.pressText;
    c.removeAll(true);
    const glyph = makeGlyph(this, 'A', 50, kind);
    const pre = addText(this, 0, 0, 'PRESS', 34, { color: UI.inkCss, weight: 700, align: 'left' });
    const post = addText(this, 0, 0, 'TO START', 34, { color: UI.inkCss, weight: 700, align: 'left' });
    const gw = glyph.width || 50;
    const total = pre.width + 16 + gw + 16 + post.width;
    pre.setX(-total / 2);
    glyph.setPosition(-total / 2 + pre.width + 16 + gw / 2, 0);
    post.setX(-total / 2 + pre.width + 16 + gw + 16);
    const w = total + 70;
    const h = 78;
    const g = this.add.graphics();
    drawCard(g, -w / 2, -h / 2, w, h, { radius: h / 2, shadow: 1.2, bevel: true });
    c.add([g, pre, glyph, post]);
  }

  /** Little ambient scenes between the four heroes. */
  private direct(): void {
    if (this.chars.length < 4) return;
    const free = [0, 1, 2, 3].filter((i) => !this.busy.has(i));
    if (free.length < 2) return;
    const a = Phaser.Utils.Array.GetRandom(free);
    const others = free.filter((i) => i !== a);
    const b = Phaser.Utils.Array.GetRandom(others);
    const ca = this.chars[a];
    const cb = this.chars[b];
    const roll = Math.random();
    const mark = (i: number, ms: number) => {
      this.busy.add(i);
      this.time.delayedCall(ms, () => this.busy.delete(i));
    };
    if (roll < 0.3) {
      // Wave hello, the other waves back.
      mark(a, 1600);
      mark(b, 1600);
      ca.faceToward(cb.x).play('wave');
      this.time.delayedCall(500, () => cb.faceToward(ca.x).play(Math.random() < 0.5 ? 'wave' : 'celebrate'));
    } else if (roll < 0.55) {
      // A happy hop that startles a neighbour.
      mark(a, 1400);
      mark(b, 1400);
      this.hop(ca);
      this.time.delayedCall(450, () => cb.faceToward(ca.x).play('surprised'));
    } else if (roll < 0.75) {
      // Everyone cheers in a ripple.
      [0, 1, 2, 3].forEach((i) => {
        if (this.busy.has(i)) return;
        mark(i, 1500);
        this.time.delayedCall(i * 130, () => this.chars[i].play('celebrate'));
      });
    } else if (roll < 0.88) {
      // Victory pose, others clap along.
      mark(a, 1500);
      ca.play('victory');
      this.time.delayedCall(350, () => cb.faceToward(ca.x).play('celebrate'));
      mark(b, 1500);
    } else {
      // Tumble stomps; everyone jumps in surprise.
      const t = this.chars[2];
      if (this.busy.has(2)) return;
      [0, 1, 2, 3].forEach((i) => mark(i, 1800));
      this.hop(t, 70, () => {
        this.fx.shake(0.004, 200);
        this.fx.vfx('dust', t.parentContainer.x + t.x, t.parentContainer.y + t.y, { scale: 0.6 });
        [0, 1, 3].forEach((i) => this.chars[i].play('surprised'));
      });
    }
  }

  private hop(c: Character, height = 90, onLand?: () => void): void {
    c.play('jump');
    audio.play('jump', { volume: 0.5 });
    const y0 = c.y;
    this.tweens.add({
      targets: c,
      y: y0 - height,
      duration: 260,
      ease: 'Quad.Out',
      yoyo: true,
      onComplete: () => {
        c.y = y0;
        c.squash();
        onLand?.();
      },
    });
  }

  override update(_t: number, delta: number): void {
    const dt = delta / 1000;
    if (this.cloudsFar && this.farIslands && this.cloudsBelow) {
      this.cloudsFar.tilePositionX += 8 * dt;
      this.farIslands.tilePositionX += 4 * dt;
      this.cloudsBelow.tilePositionX += 14 * dt;
    }
    this.refreshPressPlate();
    this.audioHint.setVisible(audio.available && !audio.running);
    if (this.phase === 'attract') {
      if (input.any.pressed('A') || input.any.pressed('MENU')) this.openMenu();
    } else {
      this.menu.handle(input.any);
    }
  }
}

