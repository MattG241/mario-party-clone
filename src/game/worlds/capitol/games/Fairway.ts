import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { CSS, GAME_WIDTH, PLAYER_COLORS, PLAYER_COLORS_CSS, PLAYER_SHAPES } from '../../../constants';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { burst, ensureArenaFxTextures, RingPool, Spray } from '../../../minigames/games/arenaFx';
import { bakeWord, WordPops } from '../../../minigames/games/stageKit';
import { banner, popToHud, punch, shockwave, titleTexture } from '../../../minigames/juice';
import { LITE } from '../../../perf';
import { glyphKindFor, makeGlyph } from '../../../ui/ControllerPrompt';
import { drawPlayerShape } from '../../../ui/PlayerBadge';
import { addText } from '../../../ui/theme';
import { canvasTexture, finishSprites, Gallery, queueSprites, spriteKey, type GallerySpot } from '../sportsKit';
import * as R from './fairwayRules';

const { COSB, SINB } = R;

/** Rendered sprites (public/assets/rendered/mg/<name>.webp, from scripts/art/worlds/sports/mg_green.py). */
const SPRITES = ['capitol_golfball', 'capitol_flag'] as const;
const ARENA = 'rendered-scene-capitol_green';
/** The golf ball render is 32 px across (drawn 2 * BALL_R across). */
const BALL_ART = 32;
/** The flagstick render: 80x200, the foot of the pole (in the cup) at its pixel (22, 190). */
const FLAG_ART = { w: 80, h: 200, ax: 22, ay: 190 };
const CHAR_SCALE = 0.62;
/** Aim turns this fast (radians/s) at full stick; the power bar sweeps 0 -> 1 in POWER_MS. */
const AIM_RATE = 1.35;
const POWER_MS = 1100;
/** Physics sub-step (s). */
const SUB = 1 / 120;
/** Golfers run to their ball at this speed (screen px/s). */
const RUN_SPEED = 720;
/** Beats: a holed / spent ball comes back to the tee after RESPAWN_MS. */
const RESPAWN_MS = 1000;
const DEPTH = { dots: 5, tee: 6, cup: 7, preview: 8, meter: 6000, word: 6400, ui: 8300 };
const POP_SIZE = 58;

type GState = 'wait' | 'walk' | 'address' | 'charge' | 'swing' | 'watch';

interface GBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Chip flight: height and time in the air (s), launch point, velocity and flight length. */
  air: boolean;
  z: number;
  at: number;
  ax0: number;
  ay0: number;
  avx: number;
  avy: number;
  aT: number;
  apex: number;
  moving: boolean;
  holed: boolean;
  hidden: boolean;
  lipT: number;
  hop: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics;
  trail: Phaser.GameObjects.Graphics;
  tx: number[];
  ty: number[];
  tn: number;
}

interface Golfer {
  p: MgPlayer;
  c: Character;
  i: number;
  ball: GBall;
  state: GState;
  t: number;
  aim: number;
  power: number;
  chargeT: number;
  strokes: number;
  /** Points this attempt would be worth, for the ball being knocked in by someone else. */
  face: number;
  walkX: number;
  walkY: number;
  swingK: number;
  club: Phaser.GameObjects.Graphics;
  preview: Phaser.GameObjects.Graphics;
  gauge: Phaser.GameObjects.Graphics;
  prompt: Phaser.GameObjects.Container | null;
  respawnT: number;
  cpuPlan: { angle: number; power: number } | null;
  /** The shot search in progress (a few simulations a frame, so planning never stalls a frame). */
  cpuGen: Generator<void, void, void> | null;
  cpuThinkT: number;
  cpuLast: number;
}

/**
 * Fairway Frenzy (Donald Trump) — a rolling putting green in the gardens. Aim with the stick, hold
 * A to power up and release to hit: the tee shot chips through the wind, then the ball rolls with the
 * slope. Holing out in fewer strokes scores more (5, 3, 2); when a hole's time runs out the ball
 * resting closest to the pin scores 2. Three holes; the last ten seconds score double.
 */
export class FairwayScene extends BaseMinigame {
  private golfers: Golfer[] = [];
  private hole = 0;
  private holePlaying = false;
  private cup: R.Vec = { x: 0, y: 0 };
  private wind = { angle: 0, strength: 0, vec: { x: 0, y: 0 } as R.Vec };
  private double = false;
  private wrapped = false;
  private closestDone = -1;
  private clock = 0;
  private flagImg!: Phaser.GameObjects.Image;
  private flagG!: Phaser.GameObjects.Graphics;
  private cupG!: Phaser.GameObjects.Graphics;
  private dotsG!: Phaser.GameObjects.Graphics;
  private teeG!: Phaser.GameObjects.Graphics;
  private flagX = 0;
  private flagY = 0;
  private flagLift = 0;
  private dots: { x: number; y: number; dx: number; dy: number; k: number }[] = [];
  private windUi!: Phaser.GameObjects.Container;
  private windArrow!: Phaser.GameObjects.Graphics;
  private windPips!: Phaser.GameObjects.Graphics;
  private holeUi!: Phaser.GameObjects.Container;
  private holeText!: Phaser.GameObjects.Text;
  private holeBar!: Phaser.GameObjects.Graphics;
  private gallery?: Gallery;
  private words!: WordPops;
  private rings!: RingPool;
  private sparks!: Spray;
  private gusts!: Spray;
  private gustT = 0;
  private tmp: R.Vec = { x: 0, y: 0 };

  constructor() {
    super('mg-fairway');
  }

  preload(): void {
    queueSprites(this, SPRITES);
  }

  override create(): void {
    finishSprites(this, SPRITES);
    makeFallbackSprites(this);
    super.create();
  }

  // --- Arena -------------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = R.ROUND_MS;
    this.golfers = [];
    this.hole = 0;
    this.holePlaying = false;
    this.double = false;
    this.wrapped = false;
    this.closestDone = -1;
    this.clock = 0;
    this.gustT = 0;
    ensureArenaFxTextures(this);
    this.rings = new RingPool(this, 10);
    this.sparks = new Spray(this, 'fx-dot', { depth: DEPTH.word - 10, reserve: burst(60), lifespan: [320, 620], gravity: 400, scale: { start: 0.8, end: 0 }, alpha: { start: 1, end: 0 }, tint: [0xffffff, 0xffe08a, 0xfff4dc], add: true });
    this.gusts = new Spray(this, 'afx-streak', { depth: DEPTH.word - 20, reserve: burst(24), lifespan: [700, 1100], scale: { start: 1.3, end: 0.9 }, alpha: { start: 0.55, end: 0 }, align: true });
    this.words = new WordPops(this, DEPTH.word, 14);
    for (const [key, text, fill] of WORD_STYLES) bakeWord(this, key, text, { size: 50, fill });
    for (const slot of this.players.map((p) => p.slot)) for (const v of [2, 3, 4, 5, 6, 10]) titleTexture(this, `+${v}`, POP_SIZE, PLAYER_COLORS_CSS[slot]);

    const sky = ['rendered-sky-day', 'rendered-sky-clear'].find((k) => this.textures.exists(k));
    if (sky) this.add.image(GAME_WIDTH / 2, 540, sky).setDisplaySize(GAME_WIDTH * 1.04, 1124).setDepth(-100);
    if (this.textures.exists(ARENA)) this.add.image(0, 0, ARENA).setOrigin(0).setDepth(-50);
    else drawFallbackGreen(this);
    this.dotsG = this.add.graphics().setDepth(DEPTH.dots);
    this.teeG = this.add.graphics().setDepth(DEPTH.tee);
    this.cupG = this.add.graphics().setDepth(DEPTH.cup);
    this.flagG = this.add.graphics();
    this.flagImg = this.add.image(0, 0, spriteKey('capitol_flag')).setOrigin(FLAG_ART.ax / FLAG_ART.w, FLAG_ART.ay / FLAG_ART.h);
    this.buildDots();
    this.buildUi();
    this.gallery = new Gallery(this, GALLERY);
    this.setupHole(0, true);
  }

  /** A grid of dots over the green that drift slowly downhill: the slopes made visible. */
  private buildDots(): void {
    this.dots = [];
    const step = LITE ? 78 : 58;
    for (let sy = R.GREEN.cy - R.GREEN.ry; sy <= R.GREEN.cy + R.GREEN.ry; sy += step * 0.8) {
      for (let x = R.GREEN.cx - R.GREEN.rx; x <= R.GREEN.cx + R.GREEN.rx; x += step) {
        const ox = x + ((Math.round(sy / step) % 2) * step) / 2;
        const y = sy / COSB;
        if (R.surfaceAt(ox, y) !== 'green') continue;
        R.gradAt(ox, y, this.tmp);
        const ax = -this.tmp.x;
        const ay = -this.tmp.y;
        const m = Math.hypot(ax, ay);
        if (m < 1e-4) continue;
        // Steeper ground: a longer, brighter drift.
        this.dots.push({ x: ox, y: sy, dx: ax / m, dy: (ay / m) * COSB, k: Math.min(1, m / 0.05) });
      }
    }
  }

  private buildUi(): void {
    // Wind chip (top left) and hole chip (top right), beside the HUD and pinned to the screen.
    const y = 62;
    this.windUi = this.add.container(142, y).setDepth(DEPTH.ui).setScrollFactor(0);
    const wb = this.add.graphics();
    chip(wb, 250, 0x2f6b4f);
    const wl = addText(this, -80, 0, 'WIND', 22, { color: '#ffffff', weight: 700 });
    this.windArrow = this.add.graphics();
    this.windArrow.setPosition(0, 0);
    this.windPips = this.add.graphics();
    this.windUi.add([wb, wl, this.windArrow, this.windPips]);
    this.holeUi = this.add.container(GAME_WIDTH - 142, y).setDepth(DEPTH.ui).setScrollFactor(0);
    const hb = this.add.graphics();
    chip(hb, 250, 0x6b4a2f);
    this.holeText = addText(this, -30, -1, 'HOLE 1/3', 22, { color: '#ffffff', weight: 700 });
    this.holeBar = this.add.graphics();
    this.holeUi.add([hb, this.holeText, this.holeBar]);
  }

  private drawWindUi(): void {
    const g = this.windArrow;
    g.clear();
    const s = this.wind.strength;
    if (s === 0) {
      g.fillStyle(0xffffff, 0.8);
      g.fillCircle(22, 0, 7);
    } else {
      // The wind's direction as seen on screen.
      const dx = Math.cos(this.wind.angle);
      const dy = Math.sin(this.wind.angle) * COSB;
      const m = Math.hypot(dx, dy) || 1;
      const ux = dx / m;
      const uy = dy / m;
      const L = 24;
      g.lineStyle(7, 0xffffff, 1);
      g.lineBetween(22 - ux * L, -uy * L, 22 + ux * L, uy * L);
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(22 + ux * (L + 12), uy * (L + 12), 22 + ux * L - uy * 11, uy * L + ux * 11, 22 + ux * L + uy * 11, uy * L - ux * 11);
    }
    const p = this.windPips;
    p.clear();
    for (let k = 0; k < 3; k++) {
      p.fillStyle(k < s ? 0xffe08a : 0xffffff, k < s ? 1 : 0.25);
      p.fillRoundedRect(62 + k * 18, -11, 12, 22, 4);
    }
  }

  /** Start hole h: the cup and flag, the wind, fresh tees; `first` sets it up before the countdown. */
  private setupHole(h: number, first = false): void {
    this.hole = h;
    this.cup = R.cupOf(h);
    this.wind = R.windFor(h, () => this.rng.next());
    this.closestDone = -1;
    this.drawWindUi();
    this.holeText.setText(`HOLE ${h + 1}/${R.HOLES.length}`);
    // The cup, with its white liner.
    const cx = this.cup.x;
    const cy = this.cup.y * COSB;
    const g = this.cupG;
    g.clear();
    g.fillStyle(0xffffff, 0.9);
    g.fillEllipse(cx, cy, (R.CUP_R + 4) * 2, (R.CUP_R + 4) * 2 * COSB);
    g.fillStyle(0x1b2a1c, 1);
    g.fillEllipse(cx, cy, R.CUP_R * 2, R.CUP_R * 2 * COSB);
    g.fillStyle(0x0b140c, 1);
    g.fillEllipse(cx, cy + 2, R.CUP_R * 1.5, R.CUP_R * 1.2 * COSB);
    if (first) {
      this.flagX = cx;
      this.flagY = cy;
    } else {
      // The flag lifts out of the old cup and drops into the new one.
      this.tweens.add({ targets: this, flagX: cx, flagY: cy, duration: 700, ease: 'Sine.InOut' });
      this.tweens.add({ targets: this, flagLift: { from: 0, to: 120 }, duration: 350, yoyo: true, ease: 'Quad.Out' });
    }
    this.flagImg.setDepth(cy + 2);
    // Tees in the players' colours (their shape on each mat).
    const t = this.teeG;
    t.clear();
    this.golfers.forEach((gf) => {
      const tee = R.teeOf(h, gf.i);
      drawTee(t, tee.x, tee.y * COSB, PLAYER_COLORS[gf.p.slot], PLAYER_SHAPES[gf.p.slot]);
      this.resetBall(gf, true);
      if (!first) this.snapToTee(gf);
    });
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const tee = R.teeOf(0, index);
    const face = tee.x < this.cup.x ? 1 : -1;
    const c = new Character(this, tee.x - face * 38, tee.y * COSB + 4, p.characterId, { scale: CHAR_SCALE, slot: p.slot, marker: true });
    c.face(face < 0);
    p.character = c;
    const ball: GBall = {
      x: tee.x,
      y: tee.y,
      vx: 0,
      vy: 0,
      air: false,
      z: 0,
      at: 0,
      ax0: 0,
      ay0: 0,
      avx: 0,
      avy: 0,
      aT: 1,
      apex: 0,
      moving: false,
      holed: false,
      hidden: false,
      lipT: 0,
      hop: 0,
      img: this.add.image(0, 0, spriteKey('capitol_golfball')).setScale((2 * R.BALL_R) / BALL_ART),
      shadow: this.add.image(0, 0, 'fx-contact').setAlpha(0.5),
      ring: this.add.graphics(),
      trail: this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.preview),
      tx: [0, 0, 0, 0, 0, 0, 0, 0],
      ty: [0, 0, 0, 0, 0, 0, 0, 0],
      tn: 0,
    };
    ball.ring.lineStyle(3, PLAYER_COLORS[p.slot], 1);
    ball.ring.strokeEllipse(0, 0, 30, 30 * COSB);
    ball.ring.fillStyle(PLAYER_COLORS[p.slot], 0.25);
    ball.ring.fillEllipse(0, 0, 30, 30 * COSB);
    const gf: Golfer = {
      p,
      c,
      i: index,
      ball,
      state: 'wait',
      t: 0,
      aim: Math.atan2(this.cup.y - tee.y, this.cup.x - tee.x),
      power: 0,
      chargeT: 0,
      strokes: 0,
      face,
      walkX: 0,
      walkY: 0,
      swingK: 0,
      club: this.add.graphics(),
      preview: this.add.graphics().setDepth(DEPTH.preview),
      gauge: this.add.graphics().setDepth(DEPTH.meter),
      prompt: null,
      respawnT: 0,
      cpuPlan: null,
      cpuGen: null,
      cpuThinkT: 0,
      cpuLast: 0,
    };
    if (!p.isCpu) {
      gf.prompt = makeGlyph(this, 'A', 38, glyphKindFor(p.slot)).setDepth(DEPTH.meter + 1).setVisible(false);
      this.tweens.add({ targets: gf.prompt, scale: { from: 1, to: 1.14 }, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    this.golfers.push(gf);
    drawTee(this.teeG, tee.x, tee.y * COSB, PLAYER_COLORS[p.slot], PLAYER_SHAPES[p.slot]);
    this.placeGolfer(gf);
  }

  protected override onStart(): void {
    this.holePlaying = true;
    for (const g of this.golfers) this.address(g);
    this.gallery?.cheer();
  }

  /** Call-outs go over the lawn at the bottom of the island, clear of the green. */
  protected override bannerY(): number {
    return 930;
  }

  /** The last ten seconds (the final hole): every hole-out and the closest-to-the-pin bonus count double. */
  protected override onFinalStretch(): void {
    this.double = true;
    this.showFinalStretch('DOUBLE POINTS!');
    this.gallery?.cheer(true);
  }

  // --- Balls and golfers -------------------------------------------------------------------------
  /** Put a golfer's ball back on their tee for a fresh attempt. */
  private resetBall(g: Golfer, instant: boolean): void {
    const tee = R.teeOf(this.hole, g.i);
    const b = g.ball;
    b.x = tee.x;
    b.y = tee.y;
    b.vx = 0;
    b.vy = 0;
    b.air = false;
    b.z = 0;
    b.moving = false;
    b.holed = false;
    b.hidden = false;
    b.lipT = 0;
    b.tn = 0;
    b.trail.clear();
    g.strokes = 0;
    g.cpuPlan = null;
    g.cpuGen = null;
    b.img.setVisible(true).setAlpha(1).setScale((2 * R.BALL_R) / BALL_ART);
    b.shadow.setVisible(true);
    b.ring.setVisible(true);
    if (!instant) {
      b.img.setScale(0);
      this.tweens.add({ targets: b.img, scale: (2 * R.BALL_R) / BALL_ART, duration: 220, ease: 'Back.Out' });
      this.walkTo(g);
    }
  }

  /** Between holes everyone is whisked to their new tee (a hop and a puff), so nobody starts late. */
  private snapToTee(g: Golfer): void {
    g.aim = Math.atan2(this.cup.y - g.ball.y, this.cup.x - g.ball.x);
    this.placeGolfer(g);
    g.state = 'wait';
    g.respawnT = 0;
    g.c.play('jump', { force: true, returnTo: 'idle' });
    this.fx.vfx('dust', g.c.x, g.c.y, { scale: 0.3, duration: 360, alpha: 0.6, depth: g.c.y + 1 });
  }

  /** Where the golfer stands to hit their ball: beside it, facing the aim. */
  private standPoint(g: Golfer): { x: number; y: number } {
    const dx = Math.cos(g.aim);
    if (Math.abs(dx) > 0.2) g.face = dx > 0 ? 1 : -1;
    return { x: g.ball.x - g.face * 40, y: g.ball.y * COSB + 5 };
  }

  private placeGolfer(g: Golfer): void {
    const s = this.standPoint(g);
    g.c.setPosition(s.x, s.y);
    g.c.face(g.face < 0);
  }

  /** Run over to the ball (then address it). */
  private walkTo(g: Golfer): void {
    g.aim = Math.atan2(this.cup.y - g.ball.y, this.cup.x - g.ball.x);
    const s = this.standPoint(g);
    g.walkX = s.x;
    g.walkY = s.y;
    g.state = 'walk';
    g.t = 0;
    g.c.face(s.x < g.c.x);
    g.c.play('run');
  }

  private address(g: Golfer): void {
    g.state = 'address';
    g.t = 0;
    g.power = 0;
    g.chargeT = 0;
    g.aim = Math.atan2(this.cup.y - g.ball.y, this.cup.x - g.ball.x);
    this.placeGolfer(g);
    g.c.play('idle');
    g.cpuPlan = null;
    g.cpuGen = null;
    g.cpuThinkT = this.skill(g.p).think * (0.5 + Math.random() * 0.6);
  }

  private hit(g: Golfer): void {
    const b = g.ball;
    const kind = R.shotKind(g.strokes, b.x, b.y);
    g.strokes++;
    g.state = 'swing';
    g.t = 0;
    g.swingK = 0;
    this.tweens.add({ targets: g, swingK: 1, duration: 110, ease: 'Quad.In' });
    g.c.play('throw', { force: true, returnTo: 'idle' });
    const dx = Math.cos(g.aim);
    const dy = Math.sin(g.aim);
    if (kind === 'chip') {
      const C = R.chipCarry(g.power);
      b.aT = R.chipTime(C);
      b.apex = R.chipApex(C);
      b.air = true;
      b.at = 0;
      b.ax0 = b.x;
      b.ay0 = b.y;
      b.avx = (dx * C) / b.aT;
      b.avy = (dy * C) / b.aT;
      audio.play('whoosh', { volume: 0.45, rate: 1.05 });
      audio.play('hit', { volume: 0.3, rate: 1.9 });
    } else {
      const v = R.puttSpeed(g.power);
      b.vx = dx * v;
      b.vy = dy * v;
      audio.play('pop', { volume: 0.45, rate: 0.75 });
    }
    b.moving = true;
    this.rumble(g.p, 0.15, 0.25, 60);
    this.fx.vfx('dust', b.x, b.y * COSB, { scale: 0.18, duration: 300, alpha: 0.5, depth: b.y * COSB + 1 });
  }

  /** One golfer's turn logic for a frame. */
  private updateGolfer(g: Golfer, dt: number): void {
    g.t += dt;
    const c = g.p.controls;
    const b = g.ball;
    switch (g.state) {
      case 'walk': {
        const dx = g.walkX - g.c.x;
        const dy = g.walkY - g.c.y;
        const d = Math.hypot(dx, dy);
        const step = (RUN_SPEED * dt) / 1000;
        if (d <= step) {
          g.c.setPosition(g.walkX, g.walkY);
          if (this.holePlaying) this.address(g);
          else {
            g.state = 'wait';
            g.c.play('idle');
          }
        } else g.c.setPosition(g.c.x + (dx / d) * step, g.c.y + (dy / d) * step);
        break;
      }
      case 'address':
      case 'charge': {
        if (b.moving) {
          // Knocked by someone else's ball: wait for it to settle.
          g.state = 'watch';
          break;
        }
        const mx = c.moveX;
        if (Math.abs(mx) > 0.15) g.aim += Math.sign(mx) * Math.pow(Math.abs(mx), 1.6) * AIM_RATE * (dt / 1000);
        if (g.state === 'address') {
          this.placeGolfer(g);
          if (c.pressed('A')) {
            g.state = 'charge';
            g.chargeT = 0;
            g.power = 0;
            g.c.hold('crouch');
            audio.play('dialTick', { volume: 0.3 });
          }
        } else {
          g.chargeT += dt;
          g.power = pingPong(g.chargeT / POWER_MS);
          this.placeGolfer(g);
          if (!c.held('A')) this.hit(g);
        }
        break;
      }
      case 'swing':
        if (g.t > 260) g.state = 'watch';
        break;
      case 'watch':
        if (!b.moving && !b.holed) this.settled(g);
        break;
      case 'wait':
        if (g.respawnT > 0) {
          g.respawnT -= dt;
          if (g.respawnT <= 0 && this.holePlaying) this.resetBall(g, false);
        }
        break;
    }
  }

  /** The ball has stopped: out of strokes sends it back to the tee, otherwise walk up for the next one. */
  private settled(g: Golfer): void {
    if (g.strokes >= R.MAX_STROKES) {
      this.words.pop('cap-fw-tee', g.ball.x, g.ball.y * COSB - 60, { owner: g.p.slot, scale: 0.7 });
      g.c.play('disappointed', { force: true, returnTo: 'idle' });
      this.hideBall(g);
      g.state = 'wait';
      g.respawnT = RESPAWN_MS;
      return;
    }
    if (this.holePlaying) this.walkTo(g);
    else g.state = 'wait';
  }

  private hideBall(g: Golfer): void {
    const b = g.ball;
    b.hidden = true;
    this.tweens.add({ targets: b.img, alpha: 0, scale: 0.2, duration: 220, onComplete: () => b.img.setVisible(false) });
    b.shadow.setVisible(false);
    b.ring.setVisible(false);
    b.trail.clear();
  }

  // --- Physics -----------------------------------------------------------------------------------
  private stepBalls(dt: number): void {
    const s = dt / 1000;
    // Chips in the air (analytic flight, drifting with the wind).
    for (const g of this.golfers) {
      const b = g.ball;
      if (!b.air) continue;
      b.at = Math.min(b.aT, b.at + s);
      const u = b.at / b.aT;
      b.x = b.ax0 + b.avx * b.at + 0.5 * this.wind.vec.x * b.at * b.at;
      b.y = b.ay0 + b.avy * b.at + 0.5 * this.wind.vec.y * b.at * b.at;
      b.z = 4 * b.apex * u * (1 - u);
      if (u >= 1) this.land(g);
    }
    // Rolling, in fixed sub-steps, with ball-to-ball knocks and the cup.
    const n = Math.max(1, Math.ceil(s / SUB));
    const sub = s / n;
    for (let k = 0; k < n; k++) {
      for (const g of this.golfers) {
        const b = g.ball;
        if (!b.moving || b.air || b.holed || b.hidden) continue;
        b.lipT = Math.max(0, b.lipT - sub);
        if (!R.rollStep(b, sub)) {
          b.moving = false;
          continue;
        }
        this.checkCup(g);
      }
      this.collideBalls();
    }
  }

  private land(g: Golfer): void {
    const b = g.ball;
    b.air = false;
    b.z = 0;
    const T = b.aT;
    b.vx = (b.avx + this.wind.vec.x * T) * R.BITE;
    b.vy = (b.avy + this.wind.vec.y * T) * R.BITE;
    // The first bounce is never quite true.
    R.bounceKick(b, this.rng.next(), this.rng.next());
    b.hop = 1;
    const sy = b.y * COSB;
    const sand = R.surfaceAt(b.x, b.y) === 'sand';
    audio.play(sand ? 'land' : 'bounce', { volume: 0.35, rate: sand ? 0.7 : 1.4 });
    this.fx.vfx('dust', b.x, sy, { scale: sand ? 0.3 : 0.16, duration: 320, alpha: 0.55, depth: sy + 1, tint: sand ? 0xf2dca0 : undefined });
    this.rings.spawn(b.x, sy, 8, 40, { squash: COSB, tint: 0xffffff, alpha: 0.6, ms: 320, depth: DEPTH.preview });
    if (sand) this.words.pop('cap-fw-sand', b.x, sy - 50, { near: 60, scale: 0.7 });
    // Straight in from the air!
    if (Math.hypot(b.x - this.cup.x, b.y - this.cup.y) < R.DUNK_R) this.holeOut(g);
  }

  private checkCup(g: Golfer): void {
    const b = g.ball;
    const d = Math.hypot(b.x - this.cup.x, b.y - this.cup.y);
    if (d >= R.CUP_R) return;
    const sp = Math.hypot(b.vx, b.vy);
    // Through the middle slowly enough, or dying at the edge: it drops.
    if ((d < R.CAPTURE_R && sp < R.CAPTURE_V) || sp < 70) {
      this.holeOut(g);
      return;
    }
    if (b.lipT > 0) return;
    // Too quick: it catches the lip and spins out.
    b.lipT = 0.25;
    const side = (b.x - this.cup.x) * b.vy - (b.y - this.cup.y) * b.vx >= 0 ? 1 : -1;
    const turn = side * (0.35 + 0.5 * (1 - d / R.CUP_R));
    const cs = Math.cos(turn);
    const sn = Math.sin(turn);
    const vx = b.vx * cs - b.vy * sn;
    const vy = b.vx * sn + b.vy * cs;
    b.vx = vx * 0.72;
    b.vy = vy * 0.72;
    audio.play('hit', { volume: 0.3, rate: 2.1, throttleMs: 80 });
    this.words.pop('cap-fw-lip', this.cup.x + (b.x < this.cup.x ? -90 : 90), this.cup.y * COSB - 60, { near: 80, scale: 0.75 });
  }

  private collideBalls(): void {
    const gs = this.golfers;
    const min = R.BALL_R * 2;
    for (let i = 0; i < gs.length; i++) {
      const a = gs[i].ball;
      if (a.air || a.holed || a.hidden) continue;
      for (let j = i + 1; j < gs.length; j++) {
        const b = gs[j].ball;
        if (b.air || b.holed || b.hidden) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= min || d < 1e-6) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (min - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rv <= 0) continue;
        const imp = rv * 0.95;
        a.vx -= imp * nx;
        a.vy -= imp * ny;
        b.vx += imp * nx;
        b.vy += imp * ny;
        a.moving = true;
        b.moving = true;
        if (rv > 40) {
          audio.play('pop', { volume: Math.min(0.5, rv / 600), rate: 1.8, throttleMs: 50 });
          if (rv > 200) this.words.pop('cap-fw-knock', (a.x + b.x) / 2, ((a.y + b.y) / 2) * COSB - 50, { near: 80, scale: 0.7 });
        }
      }
    }
  }

  /** In the cup! Points by strokes this attempt (the owner's, even if someone else knocked it in). */
  private holeOut(g: Golfer): void {
    const b = g.ball;
    b.holed = true;
    b.moving = false;
    b.air = false;
    b.vx = 0;
    b.vy = 0;
    const cx = this.cup.x;
    const cy = this.cup.y * COSB;
    this.tweens.add({ targets: b.img, x: cx, y: cy, scale: 0.25, alpha: 0.2, duration: 170, ease: 'Quad.In', onComplete: () => b.img.setVisible(false) });
    b.shadow.setVisible(false);
    b.ring.setVisible(false);
    b.trail.clear();
    const strokes = Math.max(1, g.strokes);
    const pts = R.holePoints(strokes, this.double);
    const slot = g.p.slot;
    g.p.score += pts;
    const key = strokes === 1 ? 'cap-fw-chipin' : strokes === 2 ? 'cap-fw-putt' : 'cap-fw-in';
    const side = g.c.x < cx ? -1 : 1;
    this.words.pop(key, cx + side * 70, cy - 120, { near: 60, scale: strokes === 1 ? 1.1 : 0.95, owner: slot });
    this.rings.spawn(cx, cy, 14, 90, { squash: COSB, tint: PLAYER_COLORS[slot], alpha: 0.95, ms: 460, depth: DEPTH.preview, add: true });
    this.sparks.fire(cx, cy - 10, burst(strokes === 1 ? 20 : 10), -90, 70, 140, 360);
    audio.play('chipGain', { volume: 0.8, rate: strokes === 1 ? 1.15 : 1 });
    audio.play('pop', { volume: 0.35, rate: 0.6 });
    // The flag shivers as the ball drops.
    this.flagLift = 0;
    this.tweens.add({ targets: this.flagImg, angle: { from: 7, to: 0 }, duration: 420, ease: 'Elastic.Out' });
    if (strokes === 1) {
      shockwave(this, cx, cy, { radius: 170, ratio: COSB, color: 0xffe08a, alpha: 0.85, duration: 420, depth: DEPTH.preview });
      this.hitStop(70);
      this.slowMo(0.45, 300);
      punch(this, 0.018, 260);
      this.gallery?.cheer(true);
      audio.play('streak', { volume: 0.7 });
    } else this.gallery?.cheer(strokes === 2);
    g.c.play(strokes <= 2 ? 'celebrate' : 'cheer', { force: true, returnTo: 'idle' });
    this.rumble(g.p, 0.35, 0.35, 120);
    this.holdHud(slot, pts);
    const h = this.hudPoint(slot);
    popToHud(this, cx + side * 60, cy - 60, `+${pts}`, h.x, h.y, {
      color: PLAYER_COLORS_CSS[slot],
      size: POP_SIZE,
      onArrive: () => {
        this.releaseHud(slot, pts);
        this.bumpHud(slot);
      },
    });
    g.state = 'wait';
    g.respawnT = RESPAWN_MS;
  }

  // --- Holes -------------------------------------------------------------------------------------
  private updateHoles(): void {
    const { hole, playing } = R.holeAt(this.elapsed);
    if (this.holePlaying && (!playing || hole !== this.hole)) this.endHole();
    if (!this.holePlaying && playing) {
      if (hole !== this.hole) this.setupHole(hole);
      this.holePlaying = true;
      banner(this, hole === R.HOLES.length - 1 ? 'FINAL HOLE' : `HOLE ${hole + 1}`, { y: this.bannerY(), size: 84, color: CSS.goldLight, hold: 700, ribbon: true });
      audio.play('go', { volume: 0.4 });
      for (const g of this.golfers) if (g.state === 'wait' && !g.ball.hidden) this.walkTo(g);
    }
  }

  /** Time's up on this hole: the ball resting closest to the pin scores, then everyone lines up for the next. */
  private endHole(): void {
    this.holePlaying = false;
    const h = this.hole;
    // Time's up: every ball stops where it is (one in the air drops on the spot).
    for (const g of this.golfers) {
      const b = g.ball;
      b.vx = 0;
      b.vy = 0;
      b.air = false;
      b.z = 0;
      b.moving = false;
    }
    this.awardClosest(h);
    for (const g of this.golfers) {
      g.preview.clear();
      g.gauge.clear();
      g.club.clear();
      g.prompt?.setVisible(false);
      if (g.state === 'address' || g.state === 'charge') {
        g.state = 'wait';
        g.c.play('idle', { force: true });
      }
    }
    if (h + 1 < R.HOLES.length) {
      audio.play('whoosh', { volume: 0.4, rate: 0.8 });
      this.time.delayedCall(900, () => {
        if (this.phase !== 'playing' || this.hole !== h) return;
        this.setupHole(h + 1);
      });
    }
  }

  private awardClosest(h: number): void {
    if (this.closestDone === h) return;
    this.closestDone = h;
    const list = this.golfers.map((g) => ({ x: g.ball.x, y: g.ball.y, strokes: g.strokes, holed: g.ball.holed || g.ball.hidden }));
    const i = R.closestToPin(list, this.cup);
    if (i < 0) return;
    const g = this.golfers[i];
    const pts = R.CLOSEST_POINTS * (this.double ? 2 : 1);
    const slot = g.p.slot;
    g.p.score += pts;
    const bx = g.ball.x;
    const by = g.ball.y * COSB;
    this.words.pop('cap-fw-closest', bx, by - 70, { scale: 0.95 });
    this.rings.spawn(bx, by, 12, 70, { squash: COSB, tint: PLAYER_COLORS[slot], alpha: 0.95, ms: 520, depth: DEPTH.preview, add: true });
    // A tape measure from the ball to the pin.
    const tape = this.add.graphics().setDepth(DEPTH.preview + 1);
    tape.lineStyle(4, 0xffe08a, 0.9);
    tape.lineBetween(bx, by, this.cup.x, this.cup.y * COSB);
    this.tweens.add({ targets: tape, alpha: 0, delay: 700, duration: 400, onComplete: () => tape.destroy() });
    audio.play('streak', { volume: 0.55, rate: 1.1 });
    this.holdHud(slot, pts);
    const hp = this.hudPoint(slot);
    popToHud(this, bx, by - 40, `+${pts}`, hp.x, hp.y, {
      color: PLAYER_COLORS_CSS[slot],
      size: POP_SIZE,
      onArrive: () => {
        this.releaseHud(slot, pts);
        this.bumpHud(slot);
      },
    });
  }

  // --- Frame -------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.clock += dt;
    this.updateHoles();
    for (const g of this.golfers) this.updateGolfer(g, dt);
    this.stepBalls(dt);
    this.windGusts(dt);
    this.syncVisuals(dt);
  }

  /** Streaks of wind blowing across the lawn (more of them in a stronger wind). */
  private windGusts(dt: number): void {
    const s = this.wind.strength;
    if (s < 1) return;
    this.gustT -= dt;
    if (this.gustT > 0) return;
    this.gustT = (LITE ? 900 : 520) / s;
    const dx = Math.cos(this.wind.angle);
    const dy = Math.sin(this.wind.angle) * COSB;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const x = 300 + Math.random() * 1320;
    const y = 300 + Math.random() * 600;
    this.gusts.fire(x - dx * 200, y - dy * 200, 1, ang, 4, 260 + s * 90, 340 + s * 110);
  }

  private syncVisuals(dt: number): void {
    this.rings.update(dt);
    const ts = this.time.timeScale;
    this.sparks.sync(ts);
    this.gusts.sync(ts);
    this.drawDots();
    this.drawFlag();
    this.drawHoleUi();
    for (const g of this.golfers) {
      const b = g.ball;
      b.hop = Math.max(0, b.hop - dt / 260);
      const sx = b.x;
      const sy = b.y * COSB;
      const lift = b.z * SINB + Math.sin(b.hop * Math.PI) * 10 * b.hop;
      if (!b.holed) b.img.setPosition(sx, sy - lift - 4);
      b.img.setDepth(sy + 1);
      b.shadow.setPosition(sx, sy).setScale(0.26 * Math.max(0.5, 1 - b.z / 400), 0.09 * Math.max(0.5, 1 - b.z / 400)).setDepth(sy);
      b.ring.setPosition(sx, sy).setDepth(sy - 0.5);
      this.drawTrail(g, sx, sy - lift - 4);
      g.c.setDepth(g.c.y);
      if (g.state !== 'walk' && g.state !== 'wait' && !b.moving && Math.abs(Math.cos(g.aim)) > 0.2) g.c.face(g.face < 0);
      this.drawGolferUi(g);
    }
  }

  private drawTrail(g: Golfer, sx: number, sy: number): void {
    const b = g.ball;
    const fast = b.moving && (b.air || Math.hypot(b.vx, b.vy) > 160);
    if (!fast) {
      if (b.tn > 0) {
        b.tn = 0;
        b.trail.clear();
      }
      return;
    }
    const n = b.tx.length;
    for (let i = n - 1; i > 0; i--) {
      b.tx[i] = b.tx[i - 1];
      b.ty[i] = b.ty[i - 1];
    }
    b.tx[0] = sx;
    b.ty[0] = sy;
    b.tn = Math.min(n, b.tn + 1);
    const tg = b.trail;
    tg.clear();
    const col = PLAYER_COLORS[g.p.slot];
    const step = LITE ? 2 : 1;
    for (let i = step; i < b.tn; i += step) {
      const f = 1 - i / n;
      tg.lineStyle(10 * f + 2, col, 0.45 * f);
      tg.lineBetween(b.tx[i - step], b.ty[i - step], b.tx[i], b.ty[i]);
    }
  }

  /** The aim line and landing ring, the power bar and the club. */
  private drawGolferUi(g: Golfer): void {
    const pv = g.preview;
    const gauge = g.gauge;
    const club = g.club;
    pv.clear();
    gauge.clear();
    club.clear();
    g.prompt?.setVisible(false);
    const aiming = (g.state === 'address' || g.state === 'charge') && this.phase === 'playing' && this.holePlaying;
    const b = g.ball;
    const color = PLAYER_COLORS[g.p.slot];
    const bx = b.x;
    const by = b.y * COSB;
    const dx = Math.cos(g.aim);
    const dy = Math.sin(g.aim);
    // The club: from the hands to the ball; drawn back with the power, and through on the swing.
    if (aiming || g.state === 'swing') {
      const hx = g.c.x + g.face * 16;
      const hy = g.c.y - 52;
      const sdx = dx;
      const sdy = dy * COSB;
      const back = g.state === 'charge' ? g.power * 46 : 0;
      const through = g.state === 'swing' ? g.swingK * 40 : 0;
      const kx = bx - sdx * (12 + back) + sdx * through;
      const ky = by - sdy * (12 + back) + sdy * through - 3;
      club.setDepth(g.c.depth + 1);
      club.lineStyle(5, 0x2a2f38, 1);
      club.lineBetween(hx, hy, kx, ky);
      club.lineStyle(2, 0xd8dde6, 1);
      club.lineBetween(hx, hy, kx, ky);
      club.fillStyle(0x3a404a, 1);
      club.fillRoundedRect(kx - 9, ky - 4, 18, 8, 3);
    }
    if (!aiming) return;
    const kind = R.shotKind(g.strokes, b.x, b.y);
    const human = !g.p.isCpu;
    const a = human ? 1 : 0.55;
    // How far this power sends it (flat ground, no wind): the ring shows it.
    let dist: number;
    let roll = 0;
    if (g.state === 'charge') {
      if (kind === 'chip') {
        dist = R.chipCarry(g.power);
        const v = (dist / R.chipTime(dist)) * R.BITE;
        roll = (v * v) / (2 * R.FRICTION.green);
      } else dist = R.puttDistance(g.power);
    } else dist = kind === 'chip' ? 160 : 120;
    const ex = bx + dx * dist;
    const ey = by + dy * dist * COSB;
    // Dotted aim line.
    const dots = Math.max(3, Math.floor(dist / 26));
    pv.fillStyle(0xffffff, 0.85 * a);
    for (let k = 1; k <= dots; k++) {
      const u = k / (dots + 1);
      pv.fillCircle(bx + (ex - bx) * u, by + (ey - by) * u, 3.2);
    }
    if (g.state === 'charge') {
      pv.lineStyle(5, 0x0a1120, 0.35 * a);
      pv.strokeEllipse(ex, ey + 2, 54, 54 * COSB);
      pv.lineStyle(4, color, a);
      pv.strokeEllipse(ex, ey, 54, 54 * COSB);
      pv.lineStyle(2, 0xffffff, a);
      pv.strokeEllipse(ex, ey, 40, 40 * COSB);
      if (roll > 0) {
        pv.fillStyle(color, 0.9 * a);
        pv.fillCircle(ex + dx * roll, ey + dy * roll * COSB, 5);
      }
      // Power bar beside the golfer.
      const gx = g.c.x - g.face * 54;
      const top = g.c.y - 150;
      gauge.fillStyle(0x10202c, 0.88);
      gauge.fillRoundedRect(gx - 12, top - 4, 24, 128, 10);
      gauge.fillStyle(0x2c3d4a, 1);
      gauge.fillRoundedRect(gx - 8, top, 16, 120, 7);
      gauge.fillStyle(g.power > 0.8 ? 0xffb020 : 0x7dff8a, 1);
      gauge.fillRoundedRect(gx - 8, top + 120 - 120 * g.power, 16, 120 * g.power, 7);
      gauge.lineStyle(3, color, 1);
      gauge.strokeRoundedRect(gx - 12, top - 4, 24, 128, 10);
    } else {
      // Arrowhead at the end of the aim line.
      const sdx = dx;
      const sdy = dy * COSB;
      const m = Math.hypot(sdx, sdy) || 1;
      const ux = sdx / m;
      const uy = sdy / m;
      pv.fillStyle(color, a);
      pv.fillTriangle(ex + ux * 16, ey + uy * 16, ex - uy * 10, ey + ux * 10, ex + uy * 10, ey - ux * 10);
      if (g.prompt) g.prompt.setPosition(g.c.x, g.c.y + g.c.headY * CHAR_SCALE - 70).setVisible(true);
    }
  }

  private drawDots(): void {
    const g = this.dotsG;
    g.clear();
    const ph = (this.clock / 1600) % 1;
    for (const d of this.dots) {
      const u = (ph + (d.x * 0.013 + d.y * 0.021)) % 1;
      const off = u * 16 * (0.5 + d.k);
      const alpha = Math.sin(u * Math.PI) * (0.18 + 0.32 * d.k);
      g.fillStyle(0xffffff, alpha);
      g.fillCircle(d.x + d.dx * off, d.y + d.dy * off, 2.6);
    }
  }

  /** The flag at the cup, fluttering downwind. */
  private drawFlag(): void {
    const x = this.flagX;
    const y = this.flagY - this.flagLift;
    // Someone standing at the cup: the flag steps aside (fades), so it never hides a golfer.
    let near = false;
    for (const gf of this.golfers) if (Math.abs(gf.c.x - x) < 70 && Math.abs(gf.c.y - this.flagY) < 60) near = true;
    const alpha = Phaser.Math.Linear(this.flagImg.alpha, near ? 0.3 : 1, 0.2);
    this.flagImg.setPosition(x, y).setDepth(this.flagY + 2).setAlpha(alpha);
    const g = this.flagG;
    g.clear();
    g.setDepth(this.flagY + 2.1).setAlpha(alpha);
    const top = y - (FLAG_ART.ay - 12);
    const wind = this.wind.strength;
    const dir = Math.cos(this.wind.angle) >= 0 ? 1 : -1;
    const len = 58;
    const wave = this.clock / (wind > 1 ? 110 : 200);
    const droop = wind === 0 ? 0.55 : 0.1;
    g.fillStyle(0xffd23a, 1);
    g.beginPath();
    g.moveTo(x + 3, top);
    for (let k = 1; k <= 6; k++) {
      const u = k / 6;
      g.lineTo(x + 3 + dir * len * u * (1 - droop * 0.5), top + Math.sin(wave + u * 3) * 4 * u + droop * 30 * u);
    }
    for (let k = 6; k >= 0; k--) {
      const u = k / 6;
      g.lineTo(x + 3 + dir * len * u * (1 - droop * 0.5), top + 34 - 17 * u + Math.sin(wave + u * 3) * 4 * u + droop * 30 * u);
    }
    g.closePath();
    g.fillPath();
    g.lineStyle(2, 0xb87400, 1);
    g.strokePath();
  }

  private drawHoleUi(): void {
    const g = this.holeBar;
    g.clear();
    const hole = R.HOLES[this.hole];
    const left = this.holePlaying ? Math.max(0, (hole.end - this.elapsed) / (hole.end - hole.start)) : 0;
    g.fillStyle(0xffffff, 0.2);
    g.fillRoundedRect(38, -8, 72, 16, 8);
    g.fillStyle(left < 0.25 ? 0xff8a7a : 0xffe08a, 1);
    g.fillRoundedRect(38, -8, Math.max(8, 72 * left), 16, 8);
  }

  protected override ambient(dt: number): void {
    if (this.phase === 'playing') return;
    this.syncVisuals(dt);
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      // The final hole's closest-to-the-pin bonus counts before the whistle.
      if (this.holePlaying) this.awardClosest(this.hole);
      this.holePlaying = false;
      for (const g of this.golfers) {
        g.preview.clear();
        g.gauge.clear();
        g.club.clear();
        g.prompt?.setVisible(false);
        if (g.state === 'walk' || g.c.current === 'crouch' || g.c.current === 'throw') g.c.play('idle', { force: true });
        g.state = 'wait';
      }
    }
    super.end();
  }

  // --- CPU ---------------------------------------------------------------------------------------
  /**
   * Read the green and pick a shot by simulating candidates (a coarse sweep of aims and powers, then
   * a finer one round the best), then spoil it a little by skill: weaker CPUs misread the slope and
   * wind and execute less precisely. A generator, so the search is spread over a few frames.
   */
  private *cpuPlanShot(g: Golfer): Generator<void, void, void> {
    const sk = this.skill(g.p);
    const b = g.ball;
    const readK = Math.min(1, Math.max(0.3, (sk.accuracy - 0.45) * 1.6 + 0.25));
    const kind = R.shotKind(g.strokes, b.x, b.y);
    const base = Math.atan2(this.cup.y - b.y, this.cup.x - b.x);
    const wind = this.wind.vec;
    const cup = this.cup;
    const sx = b.x;
    const sy = b.y;
    let bestA = base;
    let bestP = 0.5;
    let bestS = -Infinity;
    let n = 0;
    const span = kind === 'chip' ? 0.35 : 0.42;
    for (let pass = 0; pass < 2; pass++) {
      const a0 = pass === 0 ? base : bestA;
      const p0 = bestP;
      const na = pass === 0 ? 11 : 5;
      const np = pass === 0 ? 17 : 7;
      for (let i = 0; i < na; i++) {
        const angle = pass === 0 ? a0 - span + (2 * span * i) / (na - 1) : a0 + (i - 2) * 0.016;
        for (let j = 0; j < np; j++) {
          const power = pass === 0 ? 0.04 + (0.96 * j) / (np - 1) : Math.min(1, Math.max(0.02, p0 + (j - 3) * 0.012));
          const r = R.simulateShot(sx, sy, kind, angle, power, wind, cup, readK, readK, pass === 0 ? 1 / 40 : 1 / 60);
          const score = r.holed ? 10000 - r.t * 10 : -Math.hypot(r.x - cup.x, r.y - cup.y) - (R.surfaceAt(r.x, r.y) === 'sand' ? 160 : 0);
          if (score > bestS) {
            bestS = score;
            bestA = angle;
            bestP = power;
          }
          if (++n % 24 === 0) yield;
        }
      }
    }
    // Chips are harder to judge than putts: a touch of error even for the best.
    const chip = kind === 'chip';
    let angle = bestA + gauss() * (chip ? 0.014 + sk.aimNoise * 0.12 : sk.aimNoise * 0.085);
    let power = bestP + gauss() * (chip ? 0.018 + sk.aimNoise * 0.07 : sk.aimNoise * 0.05);
    if (Math.random() < sk.mistake) {
      angle += (Math.random() - 0.5) * 0.3;
      power += (Math.random() - 0.5) * 0.3;
    }
    g.cpuPlan = { angle, power: Math.min(0.98, Math.max(0.03, power)) };
  }

  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const g = this.golfers.find((q) => q.p === p);
    if (!g) return;
    if (g.state !== 'address' && g.state !== 'charge') {
      vc.setMove(0, 0);
      vc.hold('A', false);
      return;
    }
    if (g.state === 'address') {
      vc.hold('A', false);
      if (!g.cpuPlan) {
        g.cpuGen ??= this.cpuPlanShot(g);
        if (g.cpuGen.next().done) g.cpuGen = null;
      }
      g.cpuThinkT -= dt;
      const plan = g.cpuPlan;
      if (g.cpuThinkT > 0 || !plan) return;
      const err = angleDiff(plan.angle, g.aim);
      if (Math.abs(err) > 0.008) {
        const x = Math.max(-1, Math.min(1, err / 0.25));
        vc.setMove(Math.sign(x) * Math.max(0.3, Math.pow(Math.abs(x), 0.625)), 0);
        return;
      }
      vc.setMove(0, 0);
      vc.hold('A', true);
      g.cpuLast = 0;
      return;
    }
    // Charging: let go as the bar passes the planned power on its way up.
    const plan = g.cpuPlan;
    vc.setMove(0, 0);
    if (!plan) {
      vc.hold('A', false);
      return;
    }
    const rising = g.power >= g.cpuLast;
    const release = rising && g.power >= plan.power;
    g.cpuLast = g.power;
    vc.hold('A', !release);
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} points` }));
  }
}

function pingPong(u: number): number {
  const m = ((u % 2) + 2) % 2;
  return m <= 1 ? m : 2 - m;
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

function gauss(): number {
  const u = Math.max(1e-6, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * Math.random());
}

/** A rounded dark pill for the bottom chips. */
function chip(g: Phaser.GameObjects.Graphics, w: number, color: number): void {
  g.fillStyle(0x0a1120, 0.3);
  g.fillRoundedRect(-w / 2 + 3, -26 + 4, w, 52, 26);
  g.fillStyle(0x10202c, 0.88);
  g.fillRoundedRect(-w / 2, -26, w, 52, 26);
  g.lineStyle(3, color, 1);
  g.strokeRoundedRect(-w / 2, -26, w, 52, 26);
}

/** A tee mat in a player's colour with their shape on it. */
function drawTee(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, shape: (typeof PLAYER_SHAPES)[number]): void {
  g.fillStyle(0x0a1120, 0.22);
  g.fillEllipse(x, y + 4, 92, 92 * COSB * 0.62);
  g.fillStyle(color, 0.5);
  g.fillEllipse(x, y, 84, 84 * COSB * 0.6);
  g.lineStyle(3, 0xffffff, 0.75);
  g.strokeEllipse(x, y, 84, 84 * COSB * 0.6);
  drawPlayerShape(g, shape, x + 30, y - 2, 9, color, 0xffffff, 2);
}

const WORD_STYLES: [string, string, readonly [string, string]][] = [
  ['cap-fw-chipin', 'CHIP-IN!', ['#fff7c2', '#ffc93a']],
  ['cap-fw-putt', 'NICE PUTT!', ['#eaffe0', '#7ed957']],
  ['cap-fw-in', 'IN THE HOLE!', ['#ffffff', '#bde8ff']],
  ['cap-fw-lip', 'LIPPED OUT', ['#ffffff', '#c9d2dc']],
  ['cap-fw-sand', 'SAND!', ['#fff6dd', '#e8c173']],
  ['cap-fw-tee', 'BACK TO THE TEE', ['#ffffff', '#c9d2dc']],
  ['cap-fw-closest', 'CLOSEST TO THE PIN!', ['#fff7c2', '#ffb020']],
  ['cap-fw-knock', 'KNOCK!', ['#ffffff', '#ffd0a8']],
];

/** Spectators along the edges of the lawn (clear spots in the render). */
const GALLERY: GallerySpot[] = [
  { x: 118, y: 560, id: 'pipper', pose: 'happy' },
  { x: 150, y: 700, id: 'ora', pose: 'cheer' },
  { x: 240, y: 930, id: 'mimi', pose: 'laugh' },
  { x: 1802, y: 560, id: 'packsprout', pose: 'cheer', flip: true },
  { x: 1770, y: 700, id: 'wrench', pose: 'laugh', flip: true },
  { x: 1680, y: 930, id: 'ora', pose: 'wave', flip: true },
];

// --- Fallback art (when the rendered sprites or the green render are missing) ----------------------
function makeFallbackSprites(scene: Phaser.Scene): void {
  canvasTexture(scene, spriteKey('capitol_golfball'), BALL_ART, BALL_ART, (ctx) => {
    const g = ctx.createRadialGradient(12, 11, 2, 16, 16, 15);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.7, '#eef1f5');
    g.addColorStop(1, '#b9c0cc');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, Math.PI * 2);
    ctx.fill();
  });
  canvasTexture(scene, spriteKey('capitol_flag'), FLAG_ART.w, FLAG_ART.h, (ctx) => {
    ctx.fillStyle = 'rgba(10,17,32,0.3)';
    ctx.beginPath();
    ctx.ellipse(FLAG_ART.ax + 6, FLAG_ART.ay, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f6fa';
    ctx.fillRect(FLAG_ART.ax - 3, 10, 6, FLAG_ART.ay - 10);
    ctx.fillStyle = '#c9ced8';
    ctx.fillRect(FLAG_ART.ax + 1, 10, 2, FLAG_ART.ay - 10);
  });
}

function drawFallbackGreen(scene: Phaser.Scene): void {
  const g = scene.add.graphics().setDepth(-50);
  g.fillStyle(0x4f9a3c, 1);
  g.fillEllipse(R.BOUNDS.cx, R.BOUNDS.cy, R.BOUNDS.rx * 2 + 60, R.BOUNDS.ry * 2 + 60);
  g.fillStyle(0x62b04a, 1);
  g.fillEllipse(R.GREEN.cx, R.GREEN.cy, R.GREEN.rx * 2 * R.FRINGE_K, R.GREEN.ry * 2 * R.FRINGE_K);
  g.fillStyle(0x7cc95a, 1);
  const pts: Phaser.Types.Math.Vector2Like[] = [];
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    const r = R.outlineK(a);
    pts.push({ x: R.GREEN.cx + Math.cos(a) * R.GREEN.rx * r, y: R.GREEN.cy + Math.sin(a) * R.GREEN.ry * r });
  }
  g.fillPoints(pts, true);
  g.fillStyle(0xe6cf8e, 1);
  for (const b of R.BUNKERS) g.fillEllipse(b.cx, b.cy, b.rx * 2, b.ry * 2);
}
