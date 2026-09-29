import Phaser from 'phaser';
import { isLiteHalfAtlas, LITE, LITE_HALF_SCENES, liteSvgDivisor } from '../perf';
import { audio } from '../audio/AudioManager';
import { registerCharacterAnimations } from '../characters/Character';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, SUBTITLE, TITLE } from '../constants';
import { ATLAS_KEYS, COMMON_SVGS, LOADING_TIPS } from '../data/assets';
import { isOptionalAsset, RENDERED_BOARDS, renderedManifestKey, renderedPath, renderedTileKey, type RenderedBoard } from '../data/rendered';
import { URL_PARAMS } from '../debug/debug';
import { generateFxTextures, registerCommonAnimations } from '../effects/animations';
import { drawPanel } from '../ui/Panel';
import { addText, addTitle } from '../ui/theme';
import { goTo } from '../ui/Transition';
import { inflateTexture } from '../util/texture';

/**
 * Loading screen: logo, animated star, percentage and tips. Preloads every common asset
 * (sprite atlases + placeholder art). Minigame-specific art is lazy-loaded by the minigame
 * intro screen. Failures are reported on screen instead of leaving a blank page.
 */
export class PreloadScene extends Phaser.Scene {
  private failed: string[] = [];
  private startTime = 0;
  private pctText!: Phaser.GameObjects.Text;
  private barFill!: Phaser.GameObjects.Graphics;
  private tipText!: Phaser.GameObjects.Text;

  constructor() {
    super('Preload');
  }

  preload(): void {
    this.startTime = performance.now();
    this.buildScreen();
    this.load.setPath('');
    const half = this.halfSize();
    for (const key of ATLAS_KEYS) {
      // rendered 3D sheets (heroes, NPCs) are WebP; the processed 2D sheets are PNG
      const ext = key.startsWith('hero_') || key === 'npcs3d' ? 'webp' : 'png';
      const image = half && isLiteHalfAtlas(key) ? `assets/lite/atlases/${key}.webp` : `assets/atlases/${key}.${ext}`;
      this.load.atlas(key, image, `assets/atlases/${key}.json`);
    }
    for (const s of COMMON_SVGS) {
      const d = liteSvgDivisor(s.key);
      this.load.svg(s.key, s.path, { width: s.width / d, height: s.height / d });
    }
    // Optional pre-rendered environment art: the manifest lists its tiles.
    for (const board of RENDERED_BOARDS) {
      const key = renderedManifestKey(board);
      this.load.json(key, renderedPath(board, 'manifest.json'));
      this.load.once(`filecomplete-json-${key}`, (_k: string, _t: string, data: RenderedBoard) => {
        for (const t of data?.tiles ?? []) this.load.image(renderedTileKey(board, t.file), renderedPath(board, t.file));
        for (const pr of data?.props ?? []) this.load.image(renderedTileKey(board, pr.file), renderedPath(board, pr.file));
        if (data?.shadow) this.load.image(renderedTileKey(board, data.shadow.file), renderedPath(board, data.shadow.file));
      });
    }
    // Optional rendered sky backdrops (day, and dusk for the final round).
    // Lite graphics (TVs, low-memory devices; see perf.ts) load one half-size sky and skip the
    // biggest optional renders below; every scene has lighter built-in art for what is missing.
    if (LITE) this.load.image('rendered-sky-day', 'assets/lite/sky_day.webp');
    else for (const v of ['day', 'clear', 'golden', 'sunset', 'dusk']) this.load.image(`rendered-sky-${v}`, `assets/rendered/sky_${v}.webp`);
    // Optional rendered hero scenes (title island, minigame arenas).
    this.load.json('rendered-spaces', 'assets/rendered/spaces/spaces.json');
    for (const t of ['start', 'gleam', 'festival', 'mischief', 'market', 'portal', 'relic', 'event']) {
      this.load.image(`rendered-space-${t}`, `assets/rendered/spaces/space_${t}.webp`);
      this.load.image(`rendered-space-${t}-base`, `assets/rendered/spaces/space_${t}_base.webp`);
    }
    // The title island, lobby stage and podium (half size on Lite with WebGL; plain Lite keeps only the
    // title). Minigame arenas load with each minigame's intro card (data/minigameRenders.ts).
    const scenes = LITE && !half ? ['title'] : LITE_HALF_SCENES;
    for (const v of scenes) this.load.image(`rendered-scene-${v}`, `assets/${half ? 'lite' : 'rendered'}/scene_${v}.webp`);
    // The Star Coin (scripts/art/coins.py; the key is the old Prism Relic's, at its 220×260 size).
    this.load.image('prism-relic', 'assets/rendered/items/star_coin.webp');
    this.load.image('rendered-ui-logo', 'assets/rendered/ui_logo.webp');
    // Sprites for the later minigames (scripts/art/mg_arenas.py) and the sky islets.
    this.load.json('rendered-mg-sprites', 'assets/rendered/mg/sprites.json');
    const mgSprites: [string, string][] = [
      ['crate', 'crate'],
      ['crate-gold', 'crate_gold'],
      ['crate-shadow', 'crate_shadow'],
      ['pad', 'pad'],
      ['sky-tile', 'sky_tile'],
      ['mace', 'mace'],
      ['spring', 'spring'],
      ['parcel', 'parcel'],
      ['totem', 'totem'],
      ['plank', 'plank'],
      ['tower-wall', 'tower_wall'],
    ];
    // Lite's Tumble Tower wall is half size (the minigame scales its tiling to fit).
    for (const [key, file] of mgSprites) this.load.image(`rendered-mg-${key}`, `assets/${LITE && key === 'tower-wall' ? 'lite' : 'rendered'}/mg/${file}.webp`);
    this.load.spritesheet('rendered-mg-log', 'assets/rendered/mg/log.webp', { frameWidth: 180, frameHeight: 180 });
    for (let k = 0; k < 3; k++) this.load.image(`rendered-islet-${k}`, `assets/rendered/mg/islet_${k}.webp`);
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => this.setProgress(p));
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (isOptionalAsset(file.key)) return;
      this.failed.push(typeof file.src === 'string' ? file.src : file.key);
    });
  }

  private buildScreen(): void {
    const cx = GAME_WIDTH / 2;
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.night).setOrigin(0);
    const glow = this.add.graphics();
    for (let r = 420; r > 0; r -= 20) {
      glow.fillStyle(COLORS.teal, 0.018);
      glow.fillCircle(cx, 420, r);
    }
    // A big gold star (drawn: nothing has loaded yet) that spins and pulses while the game loads.
    const star = this.add.graphics({ x: cx, y: 420 });
    const pts = (r0: number, r1: number) => Array.from({ length: 10 }, (_, i) => {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const r = i % 2 ? r1 : r0;
      return new Phaser.Math.Vector2(Math.cos(a) * r, Math.sin(a) * r);
    });
    star.fillStyle(0xffffff, 1);
    star.fillPoints(pts(170, 80), true);
    star.fillStyle(COLORS.gold, 1);
    star.fillPoints(pts(150, 68), true);
    star.fillStyle(0xffe79a, 1);
    star.fillPoints(pts(92, 42), true);
    this.tweens.add({ targets: star, angle: { from: -8, to: 8 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.tweens.add({ targets: star, scale: { from: 0.94, to: 1.04 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    addTitle(this, cx, 650, TITLE, 118);
    addText(this, cx, 735, SUBTITLE, 40, { color: CSS.goldLight, weight: 600, stroke: '#0b2a33', strokeThickness: 6 });
    const bar = this.add.graphics();
    drawPanel(bar, cx - 420, 800, 840, 56, { radius: 28, borderWidth: 5, engraving: false, shadowOffset: 6 });
    this.barFill = this.add.graphics();
    this.pctText = addText(this, cx, 828, '0%', 30, { color: CSS.ink, weight: 700 });
    this.tipText = addText(this, cx, 930, LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)], 32, { color: CSS.cream, weight: 500, wrap: 1400 });
    this.time.addEvent({
      delay: 2600,
      loop: true,
      callback: () => this.tipText.setText(LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]),
    });
  }

  private setProgress(p: number): void {
    const cx = GAME_WIDTH / 2;
    this.barFill.clear();
    const w = Math.max(0, 800 * p);
    if (w > 4) {
      this.barFill.fillStyle(COLORS.teal, 1);
      this.barFill.fillRoundedRect(cx - 400, 812, w, 32, 16);
      this.barFill.fillStyle(0xffffff, 0.3);
      this.barFill.fillRoundedRect(cx - 396, 815, Math.max(0, w - 8), 10, 5);
    }
    this.pctText.setText(`${Math.round(p * 100)}%`);
  }

  /** Lite on WebGL loads the big atlases and full-screen renders at half size. */
  private halfSize(): boolean {
    return LITE && this.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;
  }

  create(): void {
    if (this.failed.length > 0) {
      this.showError();
      return;
    }
    if (this.halfSize()) {
      const keys = [...ATLAS_KEYS.filter(isLiteHalfAtlas), ...LITE_HALF_SCENES.map((v) => `rendered-scene-${v}`)];
      for (const key of keys) if (this.textures.exists(key)) inflateTexture(this.textures.get(key), 2);
    }
    generateFxTextures(this);
    registerCommonAnimations(this.anims);
    registerCharacterAnimations(this.anims);
    audio.init();
    // Keep the logo on screen for a moment so the transition doesn't flash.
    const wait = Math.max(0, 500 - (performance.now() - this.startTime));
    this.time.delayedCall(wait, () => {
      const target = URL_PARAMS.get('scene');
      const minigame = URL_PARAMS.get('minigame');
      if (minigame) goTo(this, 'DevLaunch', { minigame });
      else if (URL_PARAMS.has('quick')) goTo(this, 'DevLaunch', { quick: true });
      else if (target && this.scene.get(target)) goTo(this, target);
      else goTo(this, 'Title');
    });
  }

  private showError(): void {
    const cx = GAME_WIDTH / 2;
    const panel = this.add.graphics();
    drawPanel(panel, cx - 700, 250, 1400, 580, { border: COLORS.coral });
    addText(this, cx, 320, 'Some game files could not be loaded', 48, { color: CSS.ink, weight: 700 });
    const list = this.failed.slice(0, 6).join('\n') + (this.failed.length > 6 ? `\n…and ${this.failed.length - 6} more` : '');
    addText(this, cx, 480, list, 26, { color: '#9c2f28', weight: 500, wrap: 1250 });
    addText(
      this,
      cx,
      700,
      'Make sure the game is served over http (npm run dev or npm run preview), not opened as a file,\nand that public/assets/ is present. Regenerate atlases with "npm run sprites".',
      26,
      { color: CSS.ink, weight: 500, wrap: 1300 },
    );
    this.pctText.setText('Error');
    console.error('[All-Star Party] Failed to load:', this.failed);
  }
}
