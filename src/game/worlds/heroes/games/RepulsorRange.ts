import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { CSS, GAME_WIDTH, PLAYER_COLORS, PLAYER_SHAPES } from '../../../constants';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../../data/npcs';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { kick, popToHud, punch, shockwave } from '../../../minigames/juice';
import { bakeWord, calmMotion, liteCount, WordPops } from '../../../minigames/games/stageKit';
import { drawPlayerShape } from '../../../ui/PlayerBadge';
import { addText } from '../../../ui/theme';
import { standOrigin } from '../../../util/spriteUtil';
import { canvasShape, canvasTex, fallbackSky, finishHeroSprites, glowTex, heroTex, playerRing, queueHeroSprites } from '../heroesKit';
import {
  blastHits,
  chargeLevel,
  comboMult,
  isBullseye,
  KINDS,
  makeTarget,
  maxTargets,
  newBrain,
  newGunner,
  padX,
  pickKind,
  RANGE,
  rangeCpu,
  scoreHits,
  spawnInterval,
  stepGunner,
  stepTarget,
  type Gunner,
  type RangeBrain,
  type RangeInput,
  type Shot,
  type Target,
  type TargetKind,
} from '../rangeRules';

/** The rendered test deck (scripts/art/worlds/heroes/mg_range.py) and the drone sprites (mg_sprites.py). */
const ARENA = 'rendered-scene-heroes_range';
const SPRITES: readonly string[] = ['drone', 'zip', 'heavy', 'disc', 'gold', 'balloon', 'balloon_b', 'balloon_c', 'pad'];
const BALLOON_ART = ['balloon', 'balloon_b', 'balloon_c'] as const;
const CHAR_SCALE = 0.6;
const DEPTH = { sky: -100, arena: -50, balloon: 20, target: 30, pad: 80, player: 100, beam: 5100, reticle: 6500, words: 7000 } as const;
/** Where the beam leaves the hand (from the feet, facing right; x flips with facing). */
const HAND = { x: 40, y: -122 };
const POP_SIZE = 56;
const WORDS = {
  oops: { key: 'hrr-w-oops', text: 'OOPS! -3', size: 50, fill: ['#ffe1da', '#ff6b5e'] },
  bull: { key: 'hrr-w-bull', text: 'BULLSEYE!', size: 48, fill: ['#fff6c4', '#ffbf2a'] },
  x2: { key: 'hrr-w-x2', text: 'COMBO x2!', size: 50, fill: ['#ffffff', '#8fe6ff'] },
  x3: { key: 'hrr-w-x3', text: 'COMBO x3!', size: 56, fill: ['#fff6c4', '#ffbf2a'] },
  multi: { key: 'hrr-w-multi', text: 'MULTI-HIT!', size: 52, fill: ['#ffffff', '#ffd05a'] },
  gold: { key: 'hrr-w-gold', text: 'GOLD DRONE!', size: 50, fill: ['#fff6c4', '#ffbf2a'] },
} as const;
const BALLOON_COLS = [0xff6b8a, 0x5ce1ff, 0xffd05a, 0x8bd346, 0xc49bff];
const PASSENGERS: NpcId[] = ['mimi', 'pipper', 'packsprout', 'ora', 'wrench'];

interface Pilot {
  p: MgPlayer;
  c: Character;
  g: Gunner;
  brain: RangeBrain;
  input: RangeInput;
  reticle: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  bob: number;
  flames: Phaser.GameObjects.Image[];
  glow: Phaser.GameObjects.Image;
  pad: Phaser.GameObjects.Image;
  lastMult: number;
  hum: number;
}

interface TargetView {
  t: Target;
  img: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;
  rider?: Phaser.GameObjects.Sprite;
  flash: number;
  tint: number;
  riderId?: NpcId;
}

/**
 * Repulsor Range — hover over a high-tech test range at dusk. Aim your reticle with the stick, tap A
 * for a quick blast or hold and release for a big charged one; pop drones, darting zippers,
 * armoured heavies and pop-up discs for points, keep a combo going, and never hit the civilian
 * balloons drifting through. Top score after 45 seconds wins.
 */
export class RepulsorRangeScene extends BaseMinigame {
  private pilots: Pilot[] = [];
  private targets: Target[] = [];
  private views = new Map<number, TargetView>();
  private free: TargetView[] = [];
  private beams: Phaser.GameObjects.Image[] = [];
  private spawnT = 0;
  private balloonT = 0;
  private storm = false;
  private wrapped = false;
  private pops!: WordPops;
  private claimed = new Set<number>();
  private hits: { kind: TargetKind; killed: boolean; bullseye: boolean }[] = [];

  constructor() {
    super('mg-repulsor-range');
  }

  preload(): void {
    queueHeroSprites(this, SPRITES);
  }

  // --- Arena -----------------------------------------------------------------------------------
  protected createArena(): void {
    finishHeroSprites(this, SPRITES);
    this.duration = 45000;
    this.pilots = [];
    this.targets = [];
    this.views = new Map();
    this.free = [];
    this.beams = [];
    this.spawnT = 700;
    this.balloonT = 3000;
    this.storm = false;
    this.wrapped = false;
    this.claimed = new Set();
    for (const w of Object.values(WORDS)) bakeWord(this, w.key, w.text, { size: w.size, fill: w.fill });
    glowTex(this);
    this.makeTextures();
    if (this.textures.exists(ARENA)) this.add.image(0, 0, ARENA).setOrigin(0).setDepth(DEPTH.arena);
    else this.drawFallbackDeck();
    this.pops = new WordPops(this, DEPTH.words, 16);
  }

  private tex(name: string): string {
    return this.textures.exists(heroTex(name)) ? heroTex(name) : `hrr-${name}`;
  }

  private makeTextures(): void {
    canvasTex(this, 'hrr-beam', 64, 24, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(0.65, 'rgba(255,255,255,0.75)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    canvasTex(this, 'hrr-flame', 24, 56, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.3, 'rgba(160,230,255,0.9)');
      g.addColorStop(1, 'rgba(80,160,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.lineTo(w - 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.closePath();
      ctx.fill();
    });
    canvasTex(this, 'hrr-drone', 110, 80, (ctx) => {
      // A round scout bot: two rotor pods, a visor with a glowing eye.
      ctx.fillStyle = 'rgba(200,230,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(22, 16, 20, 5, 0, 0, Math.PI * 2);
      ctx.ellipse(88, 16, 20, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5b6680';
      ctx.fillRect(20, 16, 6, 18);
      ctx.fillRect(84, 16, 6, 18);
      const g = ctx.createLinearGradient(0, 22, 0, 76);
      g.addColorStop(0, '#dfe6f4');
      g.addColorStop(1, '#7f8ba6');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(55, 48, 34, 27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#23304a';
      ctx.beginPath();
      ctx.ellipse(55, 46, 22, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff5a4a';
      ctx.beginPath();
      ctx.arc(55, 46, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(53, 44, 2, 0, Math.PI * 2);
      ctx.fill();
    });
    canvasTex(this, 'hrr-zip', 96, 64, (ctx) => {
      // A darting arrowhead with a cyan light.
      const g = ctx.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, '#ffc36b');
      g.addColorStop(1, '#e0702a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(92, 32);
      ctx.lineTo(10, 4);
      ctx.lineTo(26, 32);
      ctx.lineTo(10, 60);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#5ce1ff';
      ctx.beginPath();
      ctx.arc(52, 32, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    canvasTex(this, 'hrr-heavy', 150, 130, (ctx) => {
      // An armoured hexagonal pod.
      const hex = (r: number) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          const x = 75 + Math.cos(a) * r;
          const y = 65 + Math.sin(a) * r * 0.86;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      };
      ctx.fillStyle = '#3c4458';
      hex(70);
      ctx.fill();
      const g = ctx.createLinearGradient(0, 10, 0, 120);
      g.addColorStop(0, '#aab4c8');
      g.addColorStop(1, '#5c6680');
      ctx.fillStyle = g;
      hex(62);
      ctx.fill();
      ctx.fillStyle = '#23304a';
      ctx.fillRect(45, 52, 60, 22);
      ctx.fillStyle = '#ffb02a';
      ctx.fillRect(52, 58, 46, 10);
    });
    canvasTex(this, 'hrr-gold', 110, 80, (ctx) => {
      ctx.fillStyle = 'rgba(255,240,180,0.45)';
      ctx.beginPath();
      ctx.ellipse(22, 16, 20, 5, 0, 0, Math.PI * 2);
      ctx.ellipse(88, 16, 20, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createLinearGradient(0, 22, 0, 76);
      g.addColorStop(0, '#fff6c4');
      g.addColorStop(1, '#d99a1e');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(55, 48, 34, 27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6a3c08';
      ctx.beginPath();
      ctx.ellipse(55, 46, 22, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(55, 46, 6, 0, Math.PI * 2);
      ctx.fill();
    });
    canvasTex(this, 'hrr-disc', 120, 160, (ctx) => {
      // A bullseye target on a post.
      ctx.fillStyle = '#5c6680';
      ctx.fillRect(56, 100, 8, 60);
      for (const [r, c] of [
        [54, '#ffffff'],
        [44, '#e5484d'],
        [32, '#ffffff'],
        [20, '#e5484d'],
        [9, '#ffd05a'],
      ] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(60, 56, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    canvasTex(this, 'hrr-balloon', 140, 200, (ctx) => {
      // A friendly passenger balloon (white: tinted per balloon) with a wicker basket.
      ctx.strokeStyle = 'rgba(60,40,30,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(50, 118);
      ctx.lineTo(56, 150);
      ctx.moveTo(90, 118);
      ctx.lineTo(84, 150);
      ctx.stroke();
      const g = ctx.createRadialGradient(56, 44, 8, 70, 64, 70);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#c8c8d0');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(70, 62, 56, 62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b07a45';
      ctx.fillRect(50, 150, 40, 30);
      ctx.fillStyle = '#8a5a30';
      for (let i = 0; i < 4; i++) ctx.fillRect(50, 154 + i * 7, 40, 2);
    });
    canvasTex(this, 'hrr-pad', 200, 70, (ctx) => {
      const g = ctx.createRadialGradient(100, 30, 10, 100, 30, 96);
      g.addColorStop(0, 'rgba(160,240,255,0.9)');
      g.addColorStop(0.5, 'rgba(90,180,255,0.35)');
      g.addColorStop(1, 'rgba(90,180,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(100, 32, 96, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(100, 32, 70, 18, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    for (let slot = 0; slot < 4; slot++) {
      canvasTex(this, `hrr-shape-${slot}`, 40, 40, (ctx) => {
        ctx.fillStyle = Phaser.Display.Color.IntegerToColor(PLAYER_COLORS[slot]).rgba;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        canvasShape(ctx, PLAYER_SHAPES[slot], 20, 20, 12);
        ctx.fill();
        ctx.stroke();
      });
    }
  }

  /** Painted deck for when the render isn't there: a dusk sky, the city far below and a lit deck. */
  private drawFallbackDeck(): void {
    fallbackSky(this, DEPTH.sky, true);
    const g = this.add.graphics().setDepth(DEPTH.arena);
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let x = -40; x < GAME_WIDTH; x += 60 + rnd() * 70) {
      const top = 600 + rnd() * 160;
      g.fillStyle(0x3d3a72, 1);
      g.fillRect(x, top, 60 + rnd() * 60, 1080 - top);
    }
    g.fillStyle(0x4a5578, 1);
    g.fillRect(0, RANGE.DECK_Y, GAME_WIDTH, 1080 - RANGE.DECK_Y);
    g.fillStyle(0x8fa2c8, 1);
    g.fillRect(0, RANGE.DECK_Y - 8, GAME_WIDTH, 10);
    g.fillStyle(0x5ce1ff, 0.5);
    for (let x = 60; x < GAME_WIDTH; x += 180) g.fillRect(x, RANGE.DECK_Y + 60, 90, 6);
  }

  // --- Players ---------------------------------------------------------------------------------
  protected createPlayer(p: MgPlayer, index: number): void {
    const n = this.players.length;
    const x = padX(index, n);
    const y = RANGE.PAD_Y - 18;
    const pad = this.add.image(x, RANGE.PAD_Y, this.tex('pad')).setDepth(DEPTH.pad).setAlpha(0.95);
    const c = new Character(this, x, y, p.characterId, { scale: CHAR_SCALE, slot: p.slot });
    c.shadow?.setVisible(false);
    playerRing(c)?.setVisible(false);
    c.setDepth(DEPTH.player + index).face(x > 960);
    p.character = c;
    const flames = [-14, 14].map((dx) => this.add.image(x + dx, y + 4, 'hrr-flame').setOrigin(0.5, 0).setBlendMode(Phaser.BlendModes.ADD).setTint(PLAYER_COLORS[p.slot]).setDepth(DEPTH.player - 1).setScale(0.9));
    const glow = this.add.image(x, y - 60, 'hh-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(PLAYER_COLORS[p.slot]).setAlpha(0).setScale(2.4).setDepth(DEPTH.player - 2);
    const g = newGunner(x);
    g.y = 470;
    const reticle = this.add.graphics().setDepth(DEPTH.reticle + index);
    this.pilots.push({ p, c, g, brain: newBrain(), input: { stickX: 0, stickY: 0, holdA: false, pressA: false }, reticle, x, y, bob: index * 1.7, flames, glow, pad, lastMult: 1, hum: 0 });
  }

  protected override onStart(): void {
    audio.play('shield', { volume: 0.4, rate: 0.8 });
    if (this.humanSlots().length === 0) return;
    const t = addText(this, 960, 250, 'Tap A: quick blast  ·  hold A, let go: big blast  ·  never hit the balloons!', 34, { color: CSS.cream, stroke: '#06141a', strokeThickness: 7, weight: 700, fixed: true });
    const back = this.add.graphics().setDepth(8799);
    back.fillStyle(0x06141a, 0.6);
    back.fillRoundedRect(960 - t.width / 2 - 28, 250 - 30, t.width + 56, 60, 30);
    t.setDepth(8800);
    for (const o of [t, back]) {
      o.setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, delay: 500, duration: 250 });
      this.tweens.add({ targets: o, alpha: 0, delay: 4200, duration: 500, onComplete: () => o.destroy() });
    }
  }

  protected override bannerY(): number {
    return 990;
  }

  protected override onFinalStretch(): void {
    this.storm = true;
    this.showFinalStretch('DRONE SWARM!');
    for (let i = 0; i < 3; i++) this.spawnTarget(i === 1 ? 'gold' : 'drone');
  }

  protected override hudLabel(p: MgPlayer): string {
    return String(p.score);
  }

  // --- Targets ---------------------------------------------------------------------------------
  private spawnTarget(kind: TargetKind): void {
    const t = makeTarget(kind, () => this.rng.next());
    this.targets.push(t);
    let v = this.free.pop();
    const rendered = this.textures.exists(heroTex('balloon'));
    const key = kind === 'balloon' && rendered ? heroTex(BALLOON_ART[Math.floor(this.rng.next() * BALLOON_ART.length)]) : this.tex(kind);
    if (!v) v = { t, img: this.add.image(0, 0, key), flash: 0, tint: 0xffffff };
    v.t = t;
    v.flash = 0;
    v.img.setTexture(key).setVisible(true).setAlpha(1).setAngle(0).setScale(kind === 'balloon' ? 1 : 0.95);
    v.img.setDepth(kind === 'balloon' ? DEPTH.balloon : DEPTH.target).clearTint();
    if (kind === 'balloon') {
      v.tint = BALLOON_COLS[Math.floor(this.rng.next() * BALLOON_COLS.length)];
      if (!rendered) v.img.setTint(v.tint);
      v.img.setOrigin(0.5, 62 / 200);
      v.riderId = PASSENGERS[Math.floor(this.rng.next() * PASSENGERS.length)];
      const frame = npcFrame(v.riderId, v.riderId === 'wrench' ? 'laugh' : v.riderId === 'mimi' ? 'happy' : 'wave');
      if (!v.rider) v.rider = this.add.sprite(0, 0, NPC_ATLAS, frame);
      const o = standOrigin(NPC_ATLAS, frame);
      v.rider.setTexture(NPC_ATLAS, frame).setOrigin(o.x, o.y).setScale(0.2).setVisible(true).setDepth(DEPTH.balloon - 0.5);
    } else {
      v.img.setOrigin(0.5, 0.5);
      v.rider?.setVisible(false);
      if (kind === 'gold') {
        if (!v.glow) v.glow = this.add.image(0, 0, 'hh-glow').setBlendMode(Phaser.BlendModes.ADD);
        v.glow.setTint(0xffd24a).setScale(2.2).setAlpha(0.7).setVisible(true).setDepth(DEPTH.target - 1);
        this.pops.pop(WORDS.gold.key, 960, 300, { scale: 0.9, rise: 30, hold: 700, near: 400 });
        audio.play('shield', { volume: 0.4, rate: 1.4 });
      } else v.glow?.setVisible(false);
      if (kind === 'zip') shockwave(this, t.x, t.y, { radius: 60, color: 0xffb05a, alpha: 0.8, duration: 300, depth: DEPTH.target - 1 });
    }
    this.views.set(t.id, v);
  }

  private retire(t: Target): void {
    const v = this.views.get(t.id);
    if (!v) return;
    this.views.delete(t.id);
    this.tweens.killTweensOf(v.img);
    v.img.setVisible(false);
    v.glow?.setVisible(false);
    v.rider?.setVisible(false);
    this.free.push(v);
  }

  private stepTargets(dt: number): void {
    const rnd = () => this.rng.next();
    let w = 0;
    for (const t of this.targets) {
      const alive = !t.dead && stepTarget(t, dt, rnd);
      if (!alive) {
        if (!t.dead) this.retire(t);
        continue;
      }
      this.targets[w++] = t;
    }
    this.targets.length = w;
  }

  private syncTargets(dt: number): void {
    for (const v of this.views.values()) {
      const t = v.t;
      if (t.dead) continue;
      v.flash = Math.max(0, v.flash - dt);
      const img = v.img;
      img.setPosition(t.x, t.y);
      if (t.kind === 'balloon') {
        img.setAngle(Math.sin(t.age / 700 + t.phase) * 5 + (t.safe > 0 ? Math.sin(t.age / 40) * 10 : 0));
        v.rider?.setPosition(t.x, t.y + 176 - 62 + 8).setAngle(img.angle);
      } else if (t.kind === 'zip') {
        img.setFlipX(t.vx < 0).setAngle(t.vx || t.vy ? Phaser.Math.RadToDeg(Math.atan2(t.vy, Math.abs(t.vx) + 1)) * 0.3 : Math.sin(t.age / 200) * 4);
      } else if (t.kind === 'disc') {
        img.setY(t.y + 22);
      } else {
        img.setFlipX(t.vx < 0).setAngle(Math.sin(t.age / 300 + t.phase) * 6);
        if (t.kind === 'heavy') img.setScale(0.95 * (0.9 + 0.1 * (t.hp / KINDS.heavy.hp)));
      }
      v.glow?.setPosition(t.x, t.y);
      if (v.flash > 0) img.setTintFill(0xffffff);
      else if (t.kind === 'balloon' && !this.textures.exists(heroTex('balloon'))) img.setTint(v.tint);
      else if (t.kind === 'heavy' && t.hp < KINDS.heavy.hp) img.setTint(t.hp === 1 ? 0xffa08a : 0xffd0b8);
      else img.clearTint();
    }
  }

  // --- Shots -----------------------------------------------------------------------------------
  private fire(pl: Pilot, shot: NonNullable<Shot>): void {
    const big = shot.kind === 'big';
    const face = shot.x < pl.x ? -1 : 1;
    pl.c.face(face < 0);
    pl.c.play('throw', { force: true, returnTo: 'idle' });
    const hx = pl.x + HAND.x * face;
    const hy = pl.y + pl.bob + HAND.y;
    this.beam(hx, hy, shot.x, shot.y, PLAYER_COLORS[pl.p.slot], big ? 46 : 18, big ? 240 : 130);
    audio.play(big ? 'explosion' : 'pop', big ? { volume: 0.55 } : { volume: 0.4, rate: 1.4 + Math.random() * 0.2, throttleMs: 40 });
    if (big) {
      audio.play('shield', { volume: 0.5, rate: 0.7 });
      shockwave(this, shot.x, shot.y, { radius: shot.r, color: PLAYER_COLORS[pl.p.slot], alpha: 0.9, duration: 380, depth: DEPTH.beam - 1 });
      shockwave(this, shot.x, shot.y, { radius: shot.r * 0.6, color: 0xffffff, alpha: 0.7, duration: 260, depth: DEPTH.beam - 1 });
      punch(this, 0.02, 220);
      this.rumble(pl.p, 0.5, 0.4, 160);
    } else {
      this.fx.vfx('sparkle', shot.x, shot.y, { scale: 0.35, duration: 200, blend: 'add', tint: PLAYER_COLORS[pl.p.slot] });
      this.rumble(pl.p, 0.08, 0.15, 40);
    }
    // What did it hit?
    this.hits.length = 0;
    let first: Target | null = null;
    for (const t of this.targets) {
      if (!blastHits(t, shot.x, shot.y, shot.r)) continue;
      if (t.kind === 'balloon') {
        t.safe = RANGE.BALLOON_SAFE_MS;
        this.hits.push({ kind: 'balloon', killed: false, bullseye: false });
        this.startle(t);
        continue;
      }
      t.hp -= big ? 3 : 1;
      const killed = t.hp <= 0;
      const bull = isBullseye(t, shot.x, shot.y);
      this.hits.push({ kind: t.kind, killed, bullseye: bull });
      if (killed) this.pop(t, pl, bull);
      else this.dent(t);
      first ??= t;
    }
    const before = pl.p.score;
    const r = scoreHits(pl.g, this.hits);
    pl.p.score = Math.max(0, pl.p.score + r.points);
    const gained = pl.p.score - before;
    if (r.balloon) this.oops(pl, shot);
    if (gained > 0) this.popScore(pl, shot.x, shot.y, gained);
    const kills = this.hits.filter((h) => h.killed).length;
    if (kills >= 3) {
      this.pops.pop(WORDS.multi.key, shot.x, shot.y - 90, { owner: pl.p.slot + 10, scale: 1, rise: 40, hold: 520, tilt: -5 });
      audio.play('streak', { volume: 0.6 });
    }
    if (first && !big) this.hitStop(35);
    else if (first && big) this.hitStop(70);
    const mult = comboMult(pl.g.combo);
    if (mult > pl.lastMult) {
      const w = mult >= 3 ? WORDS.x3 : WORDS.x2;
      this.pops.pop(w.key, pl.x, pl.y - 230, { owner: pl.p.slot + 20, scale: 1, rise: 40, hold: 620, tilt: -6 });
      audio.play('streak', { volume: 0.6, rate: 1 + mult * 0.1 });
    }
    pl.lastMult = mult;
  }

  private beam(x0: number, y0: number, x1: number, y1: number, tint: number, thick: number, ms: number): void {
    let img = this.beams.find((b) => !b.visible);
    if (!img) {
      img = this.add.image(0, 0, 'hrr-beam').setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.beam);
      this.beams.push(img);
    }
    const im = img;
    const len = Math.hypot(x1 - x0, y1 - y0);
    im.setPosition(x0, y0).setRotation(Math.atan2(y1 - y0, x1 - x0)).setDisplaySize(len, thick).setTint(tint).setAlpha(1).setVisible(true);
    this.tweens.killTweensOf(im);
    this.tweens.add({ targets: im, alpha: 0, scaleY: im.scaleY * 0.3, duration: ms, ease: 'Quad.In', onComplete: () => im.setVisible(false) });
  }

  /** A target destroyed: a burst of sparks and debris, a pop, and it's gone. */
  private pop(t: Target, pl: Pilot, bull: boolean): void {
    t.dead = true;
    const v = this.views.get(t.id);
    const heavy = t.kind === 'heavy';
    audio.play(heavy ? 'explosion' : 'crack', { volume: heavy ? 0.6 : 0.4, rate: 1.1, throttleMs: 30 });
    this.fx.vfx(heavy ? 'explosion' : 'impact', t.x, t.y, { scale: heavy ? 0.7 : 0.5, duration: 420, blend: heavy ? 'normal' : 'add' });
    this.fx.sparks(t.x, t.y, liteCount(heavy ? 22 : 12));
    shockwave(this, t.x, t.y, { radius: t.r * 1.8, color: t.kind === 'gold' ? 0xffd24a : 0xffc070, alpha: 0.85, duration: 320, depth: DEPTH.target + 1 });
    if (bull) this.pops.pop(WORDS.bull.key, t.x, t.y - 80, { owner: pl.p.slot + 30, scale: 0.9, rise: 36, hold: 460 });
    if (t.kind === 'gold') audio.play('goldChip', { volume: 0.9 });
    if (heavy) kick(this, 0, 8, 140);
    if (v) {
      const img = v.img;
      this.tweens.add({
        targets: img,
        scale: img.scale * 1.35,
        alpha: 0,
        angle: img.angle + (Math.random() < 0.5 ? -40 : 40),
        duration: 180,
        ease: 'Quad.Out',
        onComplete: () => this.retire(t),
      });
    }
  }

  /** An armoured heavy takes a hit: a flash, a plate knocked loose, a shove. */
  private dent(t: Target): void {
    const v = this.views.get(t.id);
    if (v) v.flash = 90;
    audio.play('hit', { volume: 0.45, throttleMs: 40 });
    this.fx.sparks(t.x, t.y, liteCount(8));
    t.x += (Math.random() - 0.5) * 16;
  }

  /** A civilian balloon got blasted: it wobbles, its passenger jumps, and the shooter loses points. */
  private startle(t: Target): void {
    const v = this.views.get(t.id);
    if (v?.rider && v.riderId) {
      const frame = npcFrame(v.riderId, v.riderId === 'wrench' || v.riderId === 'mimi' ? 'surprised' : v.riderId === 'packsprout' ? 'surprised' : 'point');
      v.rider.setFrame(frame);
      this.time.delayedCall(900, () => v.rider?.visible && v.riderId && v.rider.setFrame(npcFrame(v.riderId, 'wave')));
    }
    t.vy -= 30;
  }

  private oops(pl: Pilot, shot: NonNullable<Shot>): void {
    this.pops.pop(WORDS.oops.key, shot.x, shot.y - 100, { owner: pl.p.slot + 40, scale: 1, rise: 44, hold: 700, tilt: 7 });
    audio.play('error', { volume: 0.6 });
    audio.play('chipLose', { volume: 0.6 });
    this.rumble(pl.p, 0.6, 0.4, 220);
    this.fx.shake(0.004, 150);
    pl.lastMult = 1;
  }

  /** "+N" flies from the hit to the shooter's HUD capsule (quick hits add to the one still gathering). */
  private popScore(pl: Pilot, x: number, y: number, value: number): void {
    const slot = pl.p.slot;
    this.holdHud(slot, value);
    const to = this.hudPoint(slot);
    const color = value >= 5 ? '#ffe36b' : '#ffffff';
    popToHud(this, x, y - 40, `+${value}`, to.x, to.y, {
      color,
      size: POP_SIZE,
      onArrive: () => {
        this.releaseHud(slot, value);
        this.bumpHud(slot);
      },
    });
  }

  // --- Frame -----------------------------------------------------------------------------------
  protected tick(dt: number): void {
    const n = this.players.length;
    this.spawnT -= dt;
    this.balloonT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = spawnInterval(n, this.storm);
      let live = 0;
      for (const t of this.targets) if (t.kind !== 'balloon') live++;
      if (live < maxTargets(n, this.storm)) this.spawnTarget(pickKind(this.rng.next(), this.storm));
    }
    if (this.balloonT <= 0) {
      this.balloonT = 3600 + this.rng.next() * 1400;
      let b = 0;
      for (const t of this.targets) if (t.kind === 'balloon') b++;
      if (b < 3) this.spawnTarget('balloon');
    }
    this.stepTargets(dt);
    for (const pl of this.pilots) {
      const ctl = pl.p.controls;
      if (!pl.p.isCpu) {
        // Either stick aims.
        const useAim = Math.hypot(ctl.aimX, ctl.aimY) > Math.hypot(ctl.moveX, ctl.moveY);
        pl.input.stickX = useAim ? ctl.aimX : ctl.moveX;
        pl.input.stickY = useAim ? ctl.aimY : ctl.moveY;
      } else {
        pl.input.stickX = ctl.moveX;
        pl.input.stickY = ctl.moveY;
      }
      pl.input.holdA = ctl.held('A');
      pl.input.pressA = ctl.pressed('A');
      const shot = stepGunner(pl.g, pl.input, dt);
      if (shot) this.fire(pl, shot);
      // A charging hum that climbs with the charge.
      const c = pl.g.charging ? chargeLevel(pl.g.held) : 0;
      if (c > 0) {
        pl.hum -= dt;
        if (pl.hum <= 0) {
          pl.hum = 120;
          audio.play('tick', { volume: 0.18, rate: 0.7 + c * 0.9, throttleMs: 60 });
        }
      }
    }
  }

  protected override ambient(dt: number): void {
    const s = dt / 1000;
    this.syncTargets(dt);
    for (const pl of this.pilots) this.syncPilot(pl, s);
  }

  private syncPilot(pl: Pilot, s: number): void {
    const calm = calmMotion();
    pl.bob += s * 2.2;
    const b = calm ? 0 : Math.sin(pl.bob) * 6;
    pl.c.setPosition(pl.x, pl.y + b);
    const charge = pl.g.charging ? chargeLevel(pl.g.held) : 0;
    const flick = 0.85 + Math.random() * 0.3;
    pl.flames.forEach((f, i) => f.setPosition(pl.x + (i ? 14 : -14), pl.y + b + 2).setScale(0.9, (0.8 + charge * 0.6) * flick));
    pl.glow.setPosition(pl.x, pl.y + b - 70).setAlpha(charge * 0.8).setScale(2 + charge * 1.6);
    if (charge > 0 && pl.c.current === 'idle') pl.c.face(pl.g.x < pl.x);
    this.drawReticle(pl, charge);
  }

  /** The reticle in the player's colour, with their shape; charging fills a ring and previews the big blast. */
  private drawReticle(pl: Pilot, charge: number): void {
    const g = pl.reticle;
    const x = pl.g.x;
    const y = pl.g.y;
    const col = PLAYER_COLORS[pl.p.slot];
    g.clear();
    if (this.phase === 'finished') return;
    const r = 30;
    g.lineStyle(8, 0x0a1120, 0.45);
    g.strokeCircle(x, y + 2, r);
    g.lineStyle(5, col, 1);
    g.strokeCircle(x, y, r);
    g.lineStyle(2, 0xffffff, 0.9);
    g.strokeCircle(x, y, r - 5);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      g.lineStyle(5, col, 1);
      g.lineBetween(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6), x + Math.cos(a) * (r + 18), y + Math.sin(a) * (r + 18));
    }
    g.fillStyle(0xffffff, 1);
    g.fillCircle(x, y, 4);
    drawPlayerShape(g, PLAYER_SHAPES[pl.p.slot], x + r + 16, y - r - 12, 10, col, 0xffffff, 3);
    if (charge > 0) {
      g.lineStyle(7, 0xffffff, 0.9);
      g.beginPath();
      g.arc(x, y, r + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge, false);
      g.strokePath();
      if (charge >= RANGE.CHARGE_MIN) {
        const br = RANGE.BIG_R0 + (RANGE.BIG_R1 - RANGE.BIG_R0) * charge;
        g.lineStyle(3, col, 0.35 + 0.4 * charge);
        g.strokeCircle(x, y, br);
        if (charge >= 1) {
          g.lineStyle(4, 0xffffff, 0.5 + 0.5 * Math.sin(this.time.now / 60));
          g.strokeCircle(x, y, br);
        }
      }
    }
    // Combo badge under the reticle once the multiplier is going.
    const mult = comboMult(pl.g.combo);
    if (mult > 1) {
      g.fillStyle(col, 0.95);
      g.fillRoundedRect(x - 22, y + r + 12, 44, 22, 11);
      g.fillStyle(0xffffff, 1);
      // tick marks: one per multiplier step
      for (let i = 0; i < mult; i++) g.fillRect(x - 14 + i * 10, y + r + 18, 6, 10);
    }
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      for (const pl of this.pilots) {
        pl.reticle.clear();
        pl.glow.setAlpha(0);
      }
    }
    super.end();
  }

  // --- CPU -------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const pl = this.pilots.find((x) => x.p === p);
    if (!pl) return;
    this.claimed.clear();
    for (const o of this.pilots) if (o !== pl && o.p.isCpu && o.brain.tid >= 0) this.claimed.add(o.brain.tid);
    const inp = rangeCpu(pl.brain, pl.g, this.targets, this.claimed, this.skill(p), dt, Math.random, pl.input);
    vc.setMove(inp.stickX, inp.stickY);
    vc.hold('A', inp.holdA || inp.pressA);
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} pts` }));
  }
}

