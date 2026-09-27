import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { registerCharacterAnimations } from '../characters/Character';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, SUBTITLE, TITLE } from '../constants';
import { ATLAS_KEYS, COMMON_SVGS, LOADING_TIPS } from '../data/assets';
import { isOptionalAsset, RENDERED_BOARDS, renderedManifestKey, renderedPath, renderedTileKey, type RenderedBoard } from '../data/rendered';
import { URL_PARAMS } from '../debug/debug';
import { generateFxTextures, registerCommonAnimations } from '../effects/animations';
import { drawPanel, drawSpiral } from '../ui/Panel';
import { addText, addTitle } from '../ui/theme';
import { goTo } from '../ui/Transition';

/**
 * Loading screen: logo, animated spiral, percentage and tips. Preloads every common asset
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
    for (const key of ATLAS_KEYS) this.load.atlas(key, `assets/atlases/${key}.png`, `assets/atlases/${key}.json`);
    for (const s of COMMON_SVGS) this.load.svg(s.key, s.path, { width: s.width, height: s.height });
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
    for (const v of ['day', 'clear', 'golden', 'sunset', 'dusk']) this.load.image(`rendered-sky-${v}`, `assets/rendered/sky_${v}.webp`);
    // Optional rendered hero scenes (title island, minigame arenas).
    this.load.atlas('rendered-orbit-arms', 'assets/rendered/orbit_arms.webp', 'assets/rendered/orbit_arms.json');
    this.load.json('rendered-spaces', 'assets/rendered/spaces/spaces.json');
    for (const t of ['start', 'gleam', 'festival', 'mischief', 'market', 'portal', 'relic', 'event']) this.load.image(`rendered-space-${t}`, `assets/rendered/spaces/space_${t}.webp`);
    this.load.json('rendered-gleam3d', 'assets/rendered/scene_gleam3d.json');
    for (const v of ['title', 'gleam', 'gleam_wall', 'gleam3d', 'gleam3d_wall', 'gleam3d_blur', 'orbit', 'orbit_blur', 'select', 'results']) this.load.image(`rendered-scene-${v}`, `assets/rendered/scene_${v}.webp`);
    this.load.image('rendered-ui-dial', 'assets/rendered/ui_dial.webp');
    // Arenas and sprites for the later minigames (scripts/art/mg_arenas.py) and the sky islets.
    for (const v of ['crate', 'crate_wall', 'pond', 'relay', 'totem']) this.load.image(`rendered-scene-${v}`, `assets/rendered/scene_${v}.webp`);
    this.load.json('rendered-mg-sprites', 'assets/rendered/mg/sprites.json');
    const mgSprites: [string, string][] = [
      ['crate', 'crate'],
      ['crate-gold', 'crate_gold'],
      ['pad', 'pad'],
      ['sky-tile', 'sky_tile'],
      ['mace', 'mace'],
      ['spring', 'spring'],
      ['parcel', 'parcel'],
      ['totem', 'totem'],
      ['plank', 'plank'],
      ['tower-wall', 'tower_wall'],
    ];
    for (const [key, file] of mgSprites) this.load.image(`rendered-mg-${key}`, `assets/rendered/mg/${file}.webp`);
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
    const spiral = this.add.graphics({ x: cx, y: 420 });
    spiral.lineStyle(14, COLORS.gold, 1);
    drawSpiral(spiral, 0, 0, 6, 150, 3.2, 0, 140);
    spiral.lineStyle(5, COLORS.crystal, 0.8);
    drawSpiral(spiral, 0, 0, 16, 170, 3.2, Math.PI, 140);
    this.tweens.add({ targets: spiral, rotation: Math.PI * 2, duration: 2600, repeat: -1 });
    this.tweens.add({ targets: spiral, scale: { from: 0.94, to: 1.04 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
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

  create(): void {
    if (this.failed.length > 0) {
      this.showError();
      return;
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
    console.error('[Gleamtrail] Failed to load:', this.failed);
  }
}
