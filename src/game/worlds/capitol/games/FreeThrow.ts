import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { GAME_WIDTH, PLAYER_COLORS, PLAYER_COLORS_CSS } from '../../../constants';
import { HERO_DATA } from '../../../data/heroSprites.generated';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { burst, ensureArenaFxTextures, RingPool, Spray } from '../../../minigames/games/arenaFx';
import { bakeWord, WordPops } from '../../../minigames/games/stageKit';
import { popToHud, punch, shockwave, titleTexture } from '../../../minigames/juice';
import { LITE } from '../../../perf';
import { glyphKindFor, makeGlyph } from '../../../ui/ControllerPrompt';
import { finishSprites, Gallery, queueSprites, spriteKey } from '../sportsKit';
import { BALL_ART, drawFallbackCourt, GALLERY, HOOP_ART, makeFallbackSprites, RIM_ART, WORD_STYLES } from './freeThrowArt';
import * as R from './freeThrowRules';

const { COSB, SINB, HOOP, BOARD, BALL_R } = R;

/** Rendered sprites (public/assets/rendered/mg/<name>.webp, from scripts/art/worlds/sports/mg_court.py). */
const SPRITES = ['capitol_hoop', 'capitol_rim', 'capitol_ball', 'capitol_ball_gold'] as const;
const ARENA = 'rendered-scene-capitol_court';
const CHAR_SCALE = 0.7;
/** Gravity on loose balls, world px/s². */
const GRAVITY = 1800;
/** Screen height of the rim's centre. */
const RIM_SY = HOOP.gy - HOOP.rimZ * SINB;
/** How far the net hangs below the rim at rest (screen px), and its strands. */
const NET_DROP = 80;
const NET_N = 12;
const DEPTH = { shadow: 260, hoop: 300, netBack: 301, ballIn: 302, netFront: 303, rim: 304, ballOut: 305, fly: 5900, meter: 6000, word: 6400 };
/** Meter sizes (screen px). */
const GAUGE = { w: 36, h: 226, off: 88 };
const NEEDLE = { w: 250, h: 30, above: 92 };
/** Between a release and the next ball in the hands (ms); longer when a fresh rack rolls in. */
const RELOAD_MS = 520;
const REFILL_MS = 900;
/** Where the ball leaves the hands in the throw animation (ms after the press). */
const RELEASE_AT = 130;
const POP_SIZE = 58;

type Stage = 'ready' | 'power' | 'aim' | 'throw' | 'reload';

interface Shooter {
  p: MgPlayer;
  c: Character;
  x: number;
  gy: number;
  /** Facing: +1 right (towards a hoop on its right), -1 left. */
  face: number;
  /** Which side the meters go (away from the middle). */
  side: number;
  stage: Stage;
  t: number;
  /** Clock of the moving meter (ms), reset at each stage. */
  mt: number;
  pVal: number;
  aVal: number;
  pLock: number;
  /** Power error at the lock (in green half-widths) and where the green band was then. */
  pErr: number;
  pShown: number;
  jitter: number;
  pTarget: number;
  aTarget: number;
  shots: number;
  golden: boolean;
  streak: number;
  gauge: Phaser.GameObjects.Graphics;
  needle: Phaser.GameObjects.Graphics;
  held: Phaser.GameObjects.Image;
  rack: Phaser.GameObjects.Image[];
  rackG: Phaser.GameObjects.Graphics;
  prompt: Phaser.GameObjects.Container | null;
  /** Meter flash after a lock (ms left) and its colour. */
  flash: number;
  flashCol: number;
  /** Fade of the meters after the shot (1 shown, 0 gone). */
  fade: number;
  carry: [number, number];
  /** CPU: where it means to stop the current meter (bar units), since when it may press, and the value seen last frame. */
  goal: number;
  readyAt: number;
  last: number;
}

type Phase = 'fly' | 'rattle' | 'bank' | 'drop' | 'loose';

interface Ball {
  on: boolean;
  s: Shooter | null;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Graphics;
  tx: number[];
  ty: number[];
  tn: number;
  golden: boolean;
  outcome: R.ShotOutcome;
  points: number;
  phase: Phase;
  t: number;
  x0: number;
  g0: number;
  z0: number;
  x1: number;
  g1: number;
  z1: number;
  x: number;
  g: number;
  z: number;
  vx: number;
  vg: number;
  vz: number;
  /** Rattle: angle round the rim; bank: the hoop x it drops into. */
  ra: number;
  spin: number;
  bounces: number;
  life: number;
  scored: boolean;
  inNet: boolean;
}

/**
 * Free Throw Frenzy (Barack Obama) — a basketball court on a sunny garden lawn. Stop the power bar
 * in the green, then the aim needle in the green: a basket scores 2, a swish 3, and the golden last
 * ball of every rack doubles it. In the final ten seconds the hoop slides along its track (and
 * every basket is worth one more). Most points after 45 seconds wins.
 */
export class FreeThrowScene extends BaseMinigame {
  private shooters: Shooter[] = [];
  private balls: Ball[] = [];
  private hoopImg!: Phaser.GameObjects.Image;
  private rimImg!: Phaser.GameObjects.Image;
  private netBack!: Phaser.GameObjects.Graphics;
  private netFront!: Phaser.GameObjects.Graphics;
  private trackGlow!: Phaser.GameObjects.Graphics;
  private hx = HOOP.x;
  /** Game time the slide began (null until the final stretch). */
  private slideAt: number | null = null;
  /** The final stretch is on: every basket is worth one more. */
  private bonus = false;
  private netK = 0;
  private netT = 0;
  private clock = 0;
  private wrapped = false;
  private gallery?: Gallery;
  private words!: WordPops;
  private rings!: RingPool;
  private sparks!: Spray;
  /** Scratch: net ring points (top, middle, bottom), no per-frame allocation. */
  private nx = [new Float32Array(NET_N), new Float32Array(NET_N), new Float32Array(NET_N)];
  private ny = [new Float32Array(NET_N), new Float32Array(NET_N), new Float32Array(NET_N)];

  constructor() {
    super('mg-free-throw');
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
    this.shooters = [];
    this.balls = [];
    this.hx = HOOP.x;
    this.slideAt = null;
    this.bonus = false;
    this.netK = 0;
    this.netT = 0;
    this.clock = 0;
    this.wrapped = false;
    ensureArenaFxTextures(this);
    this.rings = new RingPool(this, 10);
    this.sparks = new Spray(this, 'fx-dot', { depth: DEPTH.word - 10, reserve: burst(60), lifespan: [320, 620], gravity: 500, scale: { start: 0.8, end: 0 }, alpha: { start: 1, end: 0 }, tint: [0xffffff, 0xffe08a, 0xfff4dc], add: true });
    this.words = new WordPops(this, DEPTH.word, 14);
    for (const [key, text, fill] of WORD_STYLES) bakeWord(this, key, text, { size: 50, fill });
    // Render the score pop-ups' text once now, not on the first basket (no hitch mid-round).
    for (const slot of this.players.map((p) => p.slot)) for (const v of [2, 3, 4, 6, 8]) titleTexture(this, `+${v}`, POP_SIZE, PLAYER_COLORS_CSS[slot]);

    const sky = ['rendered-sky-day', 'rendered-sky-clear'].find((k) => this.textures.exists(k));
    if (sky) this.add.image(GAME_WIDTH / 2, 540, sky).setDisplaySize(GAME_WIDTH * 1.04, 1124).setDepth(-100);
    if (this.textures.exists(ARENA)) this.add.image(0, 0, ARENA).setOrigin(0).setDepth(-50);
    else drawFallbackCourt(this);
    this.trackGlow = this.add.graphics().setDepth(DEPTH.shadow - 1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.hoopImg = this.add.image(HOOP.x, HOOP.gy, spriteKey('capitol_hoop')).setOrigin(HOOP_ART.ax / HOOP_ART.w, HOOP_ART.ay / HOOP_ART.h).setDepth(DEPTH.hoop);
    this.rimImg = this.add.image(HOOP.x, RIM_SY, spriteKey('capitol_rim')).setOrigin(RIM_ART.ax / 100, RIM_ART.ay / 60).setDepth(DEPTH.rim);
    this.netBack = this.add.graphics().setDepth(DEPTH.netBack);
    this.netFront = this.add.graphics().setDepth(DEPTH.netFront);
    for (let i = 0; i < 12; i++) this.balls.push(this.makeBall());
    this.gallery = new Gallery(this, GALLERY);
    this.drawNet();
  }

  private makeBall(): Ball {
    const img = this.add.image(0, 0, spriteKey('capitol_ball')).setVisible(false).setScale((2 * BALL_R) / BALL_ART);
    const shadow = this.add.image(0, 0, 'fx-contact').setVisible(false).setDepth(DEPTH.shadow).setAlpha(0.5);
    const trail = this.add.graphics().setDepth(DEPTH.fly - 1).setBlendMode(Phaser.BlendModes.ADD);
    return {
      on: false,
      s: null,
      img,
      shadow,
      trail,
      tx: [0, 0, 0, 0, 0, 0, 0, 0],
      ty: [0, 0, 0, 0, 0, 0, 0, 0],
      tn: 0,
      golden: false,
      outcome: 'swish',
      points: 0,
      phase: 'fly',
      t: 0,
      x0: 0,
      g0: 0,
      z0: 0,
      x1: 0,
      g1: 0,
      z1: 0,
      x: 0,
      g: 0,
      z: 0,
      vx: 0,
      vg: 0,
      vz: 0,
      ra: 0,
      spin: 0,
      bounces: 0,
      life: 0,
      scored: false,
      inNet: false,
    };
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const n = this.players.length;
    const spot = R.shooterSpot(index, n);
    const face = spot.x <= HOOP.x ? 1 : -1;
    const side = n === 1 ? 1 : spot.x < HOOP.x ? -1 : 1;
    const c = new Character(this, spot.x, spot.gy, p.characterId, { scale: CHAR_SCALE, slot: p.slot, marker: true });
    c.face(face < 0);
    c.setDepth(spot.gy);
    p.character = c;
    const carry = HERO_DATA.points[p.characterId]?.carry ?? [40, -110];
    const held = this.add.image(0, 0, spriteKey('capitol_ball')).setScale((2 * BALL_R) / BALL_ART).setDepth(spot.gy + 0.5);
    const rackG = this.add.graphics().setDepth(spot.gy - 2);
    const rack: Phaser.GameObjects.Image[] = [];
    const rx = spot.x - face * 70;
    rackG.fillStyle(0x0a1120, 0.28);
    rackG.fillEllipse(rx, spot.gy + 10, 118, 26);
    rackG.fillStyle(0x6b6f7a, 1);
    rackG.fillRoundedRect(rx - 56, spot.gy - 2, 112, 8, 4);
    rackG.fillStyle(0xc9ced8, 1);
    rackG.fillRoundedRect(rx - 54, spot.gy - 2, 108, 3, 2);
    for (let k = 0; k < R.RACK; k++) {
      const gold = k === R.RACK - 1;
      const img = this.add.image(rx + (k - 2) * 22 * -face, spot.gy - 12, spriteKey(gold ? 'capitol_ball_gold' : 'capitol_ball')).setScale(24 / BALL_ART).setDepth(spot.gy - 1);
      rack.push(img);
    }
    const s: Shooter = {
      p,
      c,
      x: spot.x,
      gy: spot.gy,
      face,
      side,
      stage: 'ready',
      t: 0,
      mt: 0,
      pVal: 0,
      aVal: -1,
      pLock: 0,
      pErr: 0,
      pShown: R.POWER_BASE,
      jitter: 0,
      pTarget: R.POWER_BASE,
      aTarget: 0,
      shots: 0,
      golden: false,
      streak: 0,
      gauge: this.add.graphics().setDepth(DEPTH.meter),
      needle: this.add.graphics().setDepth(DEPTH.meter),
      held,
      rack,
      rackG,
      prompt: null,
      flash: 0,
      flashCol: 0xffffff,
      fade: 0,
      carry: [carry[0], carry[1]],
      goal: 0,
      readyAt: 0,
      last: 0,
    };
    if (!p.isCpu) {
      s.prompt = makeGlyph(this, 'A', 40, glyphKindFor(p.slot)).setDepth(DEPTH.meter + 1).setVisible(false);
      this.tweens.add({ targets: s.prompt, scale: { from: 1, to: 1.14 }, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    // The first ball is already in the hands.
    s.rack[0].setVisible(false);
    c.hold('carry');
    this.shooters.push(s);
  }

  protected override onStart(): void {
    for (const s of this.shooters) this.beginPower(s);
    this.gallery?.cheer();
  }

  /** Call-outs go over the near end of the court, below the shooters. */
  protected override bannerY(): number {
    return 960;
  }

  /** The last ten seconds: the hoop starts sliding along its track, and every basket is worth one more. */
  protected override onFinalStretch(): void {
    this.bonus = true;
    this.slideAt = this.elapsed;
    this.showFinalStretch('MOVING HOOP · +1 A BASKET');
    audio.play('rumble', { volume: 0.5 });
    this.gallery?.cheer(true);
    this.trackGlow.clear();
    this.trackGlow.fillStyle(0xffe08a, 0.5);
    this.trackGlow.fillRoundedRect(HOOP.x - R.SLIDE_AMP - 90, HOOP.gy - 118 * COSB - 10, 2 * R.SLIDE_AMP + 180, 20, 10);
    this.tweens.add({ targets: this.trackGlow, alpha: { from: 1, to: 0.25 }, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  // --- Shooting ----------------------------------------------------------------------------------
  private beginPower(s: Shooter): void {
    s.stage = 'power';
    s.t = 0;
    s.mt = 0;
    s.pVal = 0;
    s.aVal = -1;
    s.fade = 1;
    s.golden = R.isGoldenBall(s.shots);
    s.jitter = (this.rng.next() - 0.5) * 0.28;
    s.held.setTexture(spriteKey(s.golden ? 'capitol_ball_gold' : 'capitol_ball')).setVisible(true);
    s.c.hold('carry');
    this.cpuArm(s);
    if (s.golden) {
      this.words.pop('cap-ft-golden', s.x, s.gy - 250, { owner: s.p.slot + 10, scale: 0.8, hold: 520 });
      audio.play('itemGet', { volume: 0.45, rate: 1.1 });
    }
  }

  /** Where the hoop will be when a ball thrown now gets there. */
  private arrivalX(): number {
    return R.hoopXAt(this.elapsed + RELEASE_AT + R.FLIGHT_MS, this.slideAt);
  }

  /** Live zone centres: the power band and aim zone follow where the hoop will be when the ball arrives. */
  private updateTargets(s: Shooter): void {
    const hx = this.arrivalX();
    s.pTarget = R.powerTarget(R.hoopDistance(s.x, s.gy, hx), s.jitter);
    s.aTarget = R.aimTarget(s.x, s.gy, hx);
  }

  private meterSpeed(s: Shooter): number {
    return s.golden ? R.GOLD_SPEED : 1;
  }

  private updateShooter(s: Shooter, dt: number): void {
    s.t += dt;
    s.flash = Math.max(0, s.flash - dt);
    const press = s.p.controls.pressed('A');
    switch (s.stage) {
      case 'power':
        this.updateTargets(s);
        if (press) {
          // Judged against the band as it was when the button went down (what the player saw).
          s.pLock = s.pVal;
          s.pShown = s.pTarget;
          const e = (s.pLock - s.pTarget) / R.POWER_MAKE;
          s.pErr = e;
          this.lockFeedback(s, Math.abs(e) <= R.SWISH_K ? 2 : Math.abs(e) <= 1 ? 1 : 0);
          s.stage = 'aim';
          s.t = 0;
          s.mt = 0;
          this.cpuArm(s);
          break;
        }
        s.mt += dt * this.meterSpeed(s);
        s.pVal = R.pingPong(s.mt / R.POWER_MS);
        break;
      case 'aim':
        this.updateTargets(s);
        if (press) {
          this.shoot(s);
          break;
        }
        s.mt += dt * this.meterSpeed(s);
        s.aVal = R.pingPong(s.mt / R.AIM_MS) * 2 - 1;
        break;
      case 'throw':
        if (s.t >= RELEASE_AT && s.held.visible) this.release(s);
        s.fade = Math.max(0, s.fade - dt / 220);
        if (s.t >= 380) {
          s.stage = 'reload';
          s.t = 0;
          if (s.shots % R.RACK === 0) this.refillRack(s);
        }
        break;
      case 'reload': {
        const wait = s.shots % R.RACK === 0 ? REFILL_MS : RELOAD_MS - 380;
        if (s.t >= wait) this.nextBall(s);
        break;
      }
      default:
        break;
    }
  }

  /** A meter just stopped: a flash in green (in the zone), white (bright middle) or amber (off). */
  private lockFeedback(s: Shooter, quality: 0 | 1 | 2): void {
    s.flash = 260;
    s.flashCol = quality === 2 ? 0xffffff : quality === 1 ? 0x7dff8a : 0xffb347;
    audio.play('dialStop', { volume: 0.4, rate: quality === 2 ? 1.25 : quality === 1 ? 1.05 : 0.85 });
    if (!s.p.isCpu) this.rumble(s.p, 0.1, 0.2, 50);
  }

  /** The aim is set: work out the shot, jump and throw. */
  private shoot(s: Shooter): void {
    const ep = s.pErr;
    const ea = (s.aVal - s.aTarget) / R.AIM_MAKE;
    this.lockFeedback(s, Math.abs(ea) <= R.SWISH_K ? 2 : Math.abs(ea) <= 1 ? 1 : 0);
    const outcome = R.shotOutcome(ep, ea);
    s.stage = 'throw';
    s.t = 0;
    s.shots++;
    // A free ball from the pool (reserved for this shooter until it leaves the hands).
    let b = this.balls.find((q) => !q.on && !q.s);
    if (!b) {
      b = this.makeBall();
      this.balls.push(b);
    }
    b.s = s;
    b.golden = s.golden;
    b.outcome = outcome;
    b.points = R.shotPoints(outcome, s.golden, this.bonus);
    // Where it meets the hoop: the hoop's position when it arrives, offset by the errors.
    b.ra = this.arrivalX();
    this.planArrival(b, s, ep, ea);
    s.c.play('throw', { force: true, returnTo: 'idle' });
    this.tweens.add({ targets: s.c.sprite, y: { from: 0, to: -40 }, duration: 170, yoyo: true, ease: 'Quad.Out', onComplete: () => s.c.sprite.setY(0) });
    audio.play('whoosh', { volume: 0.4, rate: 1.2 });
  }

  /** The flight's end point for this outcome (x, ground y, height), relative to the hoop at arrival. */
  private planArrival(b: Ball, s: Shooter, ep: number, ea: number): void {
    const hx = b.ra;
    // Unit ground direction from shooter to hoop (world), and its right-hand normal.
    const dx = hx - s.x;
    const dd = (HOOP.gy - s.gy) / COSB;
    const L = Math.hypot(dx, dd) || 1;
    const ux = dx / L;
    const ud = dd / L;
    const at = (along: number, lat: number, z: number) => {
      b.x1 = hx + ux * along - ud * lat;
      b.g1 = HOOP.gy + (ud * along + ux * lat) * COSB;
      b.z1 = z;
    };
    const r = HOOP.rimR;
    const clampE = (e: number) => Phaser.Math.Clamp(e, -3, 3);
    switch (b.outcome) {
      case 'swish':
        at(0, 0, HOOP.rimZ + 4);
        break;
      case 'rim-in':
        at(clampE(ep) * r * 0.55, clampE(ea) * r * 0.55, HOOP.rimZ + 6);
        break;
      case 'bank':
      case 'board-out':
        // The backboard: in line with the shot, a little above the rim.
        b.x1 = hx - Phaser.Math.Clamp(ea, -1.6, 1.6) * r * 0.9 * ud;
        b.g1 = HOOP.gy - BOARD.back * COSB;
        b.z1 = HOOP.rimZ + (b.outcome === 'bank' ? 46 : 70 + Math.min(40, (ep - 1.9) * 20));
        break;
      case 'rim-out': {
        const m = Math.hypot(ep, ea) || 1;
        at((ep / m) * r, (ea / m) * r, HOOP.rimZ + 4);
        break;
      }
      case 'short':
        at(-r - 30 - Math.min(60, (-ep - 1.9) * 25), clampE(ea) * r * 0.6, HOOP.rimZ - 50);
        break;
      default:
        at(clampE(ep) * r * 0.6, Math.sign(ea || 1) * (r + 28 + Math.min(50, (Math.abs(ea) - 1.9) * 20)), HOOP.rimZ - 20);
        break;
    }
  }

  /** The ball leaves the hands at the top of the jump. */
  private release(s: Shooter): void {
    const b = this.balls.find((q) => q.s === s && !q.on);
    s.held.setVisible(false);
    if (!b) return;
    const hp = this.handPoint(s);
    b.on = true;
    b.phase = 'fly';
    b.t = 0;
    b.x0 = hp.x;
    b.g0 = s.gy - 6;
    b.z0 = (b.g0 - hp.y) / SINB;
    b.x = b.x0;
    b.g = b.g0;
    b.z = b.z0;
    b.spin = s.face * (5 + Math.random() * 3);
    b.bounces = 0;
    b.life = 0;
    b.scored = false;
    b.inNet = false;
    b.tn = 0;
    b.img.setTexture(spriteKey(b.golden ? 'capitol_ball_gold' : 'capitol_ball')).setVisible(true).setAlpha(1).setDepth(DEPTH.fly);
    b.shadow.setVisible(true).setAlpha(0.5);
    b.trail.clear().setVisible(true);
  }

  private nextBall(s: Shooter): void {
    const k = s.shots % R.RACK;
    const icon = s.rack[k];
    icon.setVisible(false);
    this.beginPower(s);
    // The ball hops from the rack into the hands.
    const hp = this.handPoint(s);
    s.held.setPosition(icon.x, icon.y);
    this.tweens.add({ targets: s.held, x: hp.x, y: hp.y, duration: 140, ease: 'Quad.Out' });
    audio.play('bounce', { volume: 0.25, rate: 1.3, throttleMs: 60 });
  }

  /** A fresh rack rolls in: five balls pop up in a row (the golden one last). */
  private refillRack(s: Shooter): void {
    s.rack.forEach((img, k) => {
      img.setVisible(true).setScale(0);
      this.tweens.add({ targets: img, scale: 24 / BALL_ART, duration: 200, delay: 90 + k * 90, ease: 'Back.Out', onStart: () => audio.play('pop', { volume: 0.18, rate: 1 + k * 0.08, throttleMs: 30 }) });
    });
  }

  /** Screen point of the ball in the hands (follows the jump). */
  private handPoint(s: Shooter): { x: number; y: number } {
    const k = CHAR_SCALE;
    return { x: s.c.x + s.face * s.carry[0] * k, y: s.c.y + (s.c.sprite.y + s.carry[1]) * k };
  }

  // --- Balls -------------------------------------------------------------------------------------
  private updateBall(b: Ball, dt: number): void {
    b.t += dt;
    b.life += dt;
    const s = dt / 1000;
    switch (b.phase) {
      case 'fly': {
        const u = Math.min(1, b.t / R.FLIGHT_MS);
        b.x = b.x0 + (b.x1 - b.x0) * u;
        b.g = b.g0 + (b.g1 - b.g0) * u;
        b.z = b.z0 + (b.z1 - b.z0) * u + 4 * R.ARC_H * u * (1 - u);
        if (u > 0.82 && R.isBasket(b.outcome)) b.img.setDepth(DEPTH.ballIn);
        if (u >= 1) this.arrive(b);
        break;
      }
      case 'rattle': {
        // Round the rim once, hopping, then in.
        const u = Math.min(1, b.t / 380);
        const a = b.ra + u * Math.PI * 1.2 * (b.s?.face ?? 1);
        const rr = HOOP.rimR - 10;
        b.x = this.hx + Math.cos(a) * rr;
        b.g = HOOP.gy + Math.sin(a) * rr * COSB;
        b.z = HOOP.rimZ + 6 + Math.abs(Math.sin(u * Math.PI * 2)) * 22 * (1 - u);
        if (u >= 1) this.drop(b, 0.75);
        break;
      }
      case 'bank': {
        // Off the glass: forward and down into the rim.
        const u = Math.min(1, b.t / 220);
        b.x = b.x1 + (this.hx - b.x1) * u;
        b.g = b.g1 + (HOOP.gy - b.g1) * u;
        b.z = b.z1 + (HOOP.rimZ + 4 - b.z1) * u + Math.sin(u * Math.PI) * 10;
        if (u >= 1) this.drop(b, 0.8);
        break;
      }
      case 'drop': {
        b.vz -= GRAVITY * s;
        b.z += b.vz * s;
        // Through the net: pulled to the middle of it, then out of the bottom.
        if (b.z > HOOP.rimZ - 100) {
          b.x += (this.hx - b.x) * Math.min(1, s * 12);
          b.g += (HOOP.gy - b.g) * Math.min(1, s * 12);
        } else {
          b.inNet = false;
          b.img.setDepth(DEPTH.ballOut);
          b.vx = (Math.random() - 0.5) * 60;
          b.vg = 40 + Math.random() * 50;
          b.phase = 'loose';
        }
        break;
      }
      case 'loose': {
        b.vz -= GRAVITY * s;
        b.x += b.vx * s;
        b.g += b.vg * s;
        b.z += b.vz * s;
        // Behind the backboard it passes behind the hoop.
        if (b.img.depth !== DEPTH.ballOut) b.img.setDepth(b.g < HOOP.gy - BOARD.back * COSB ? DEPTH.hoop - 1 : DEPTH.fly);
        if (b.z <= 0) {
          b.z = 0;
          if (b.vz < -160 && b.bounces < 3) {
            b.vz = -b.vz * 0.52;
            b.vx *= 0.78;
            b.vg *= 0.78;
            b.bounces++;
            audio.play('bounce', { volume: 0.22 / b.bounces, rate: 0.8 + Math.random() * 0.2, throttleMs: 40 });
          } else {
            b.vz = 0;
            b.vx *= 1 - Math.min(1, s * 3);
            b.vg *= 1 - Math.min(1, s * 3);
          }
        }
        if (b.life > 1900) {
          const a = Math.max(0, 1 - (b.life - 1900) / 300);
          b.img.setAlpha(a);
          b.shadow.setAlpha(0.5 * a);
          if (a <= 0) this.retire(b);
        }
        break;
      }
    }
    if (!b.on) return;
    // Draw: the ball where it is, its shadow on the court, and a trail in the shooter's colour.
    const sx = b.x;
    const sy = b.g - b.z * SINB;
    b.img.setPosition(sx, sy).setRotation(b.img.rotation + b.spin * s);
    const k = Math.max(0.35, 1 - b.z / 700);
    b.shadow.setPosition(b.x, b.g).setScale(0.62 * k, 0.2 * k);
    if (b.phase === 'fly') this.drawTrail(b, sx, sy);
    else if (b.tn > 0) {
      b.tn = 0;
      b.trail.clear();
    }
  }

  private drawTrail(b: Ball, sx: number, sy: number): void {
    const n = b.tx.length;
    for (let i = n - 1; i > 0; i--) {
      b.tx[i] = b.tx[i - 1];
      b.ty[i] = b.ty[i - 1];
    }
    b.tx[0] = sx;
    b.ty[0] = sy;
    b.tn = Math.min(n, b.tn + 1);
    const g = b.trail;
    g.clear();
    const color = b.golden ? 0xffd23a : PLAYER_COLORS[b.s?.p.slot ?? 0];
    // Lite draws the trail in half as many (longer) segments.
    const step = LITE ? 2 : 1;
    for (let i = step; i < b.tn; i += step) {
      const f = 1 - i / n;
      g.lineStyle(BALL_R * 1.3 * f + 2, color, 0.42 * f);
      g.lineBetween(b.tx[i - step], b.ty[i - step], b.tx[i], b.ty[i]);
    }
  }

  /** The ball reaches the hoop: what happens next depends on the shot. */
  private arrive(b: Ball): void {
    const s = b.s;
    const side = s ? (s.x < HOOP.x ? -1 : 1) : 1;
    const wx = this.hx + side * 96;
    const wy = RIM_SY - 70;
    b.t = 0;
    switch (b.outcome) {
      case 'swish':
        this.drop(b, 1);
        break;
      case 'rim-in':
        b.phase = 'rattle';
        b.ra = Math.atan2((b.g - HOOP.gy) / COSB, b.x - this.hx);
        this.clank(b, 0.55);
        break;
      case 'bank':
        b.phase = 'bank';
        b.x1 = b.x;
        b.g1 = b.g;
        b.z1 = b.z;
        this.boardThud(b);
        this.words.pop('cap-ft-bank', wx, wy, { near: 60, scale: 0.9 });
        break;
      case 'rim-out': {
        this.clank(b, 1);
        const ox = b.x - this.hx;
        const od = (b.g - HOOP.gy) / COSB;
        const m = Math.hypot(ox, od) || 1;
        this.loose(b, (ox / m) * 230, (od / m) * 230 * COSB, 280);
        this.words.pop('cap-ft-rim', wx, wy, { near: 60, scale: 0.85 });
        this.missed(b);
        break;
      }
      case 'board-out':
        this.boardThud(b);
        this.loose(b, (b.x - this.hx) * 1.5, 240 * COSB, 120);
        this.words.pop('cap-ft-board', wx, wy, { near: 60, scale: 0.8 });
        this.missed(b);
        break;
      default: {
        // Short, or wide: it carries on falling past the hoop.
        const T = R.FLIGHT_MS / 1000;
        this.loose(b, (b.x1 - b.x0) / T, (b.g1 - b.g0) / T, (b.z1 - b.z0 - 4 * R.ARC_H) / T);
        this.words.pop(b.outcome === 'short' ? 'cap-ft-short' : 'cap-ft-wide', wx, wy + 40, { near: 60, scale: 0.8 });
        this.missed(b);
        break;
      }
    }
  }

  private loose(b: Ball, vx: number, vg: number, vz: number): void {
    b.phase = 'loose';
    b.vx = vx;
    b.vg = vg;
    b.vz = vz;
    b.img.setDepth(DEPTH.fly);
    b.life = Math.min(b.life, 900);
  }

  /** Into the net: it whips, the ball drops through, and the basket counts. */
  private drop(b: Ball, strength: number): void {
    b.phase = 'drop';
    b.t = 0;
    b.inNet = true;
    b.vz = -260;
    b.x = this.hx + (b.x - this.hx) * 0.5;
    b.img.setDepth(DEPTH.ballIn);
    this.netK = Math.max(this.netK, strength);
    this.netT = 0;
    this.score(b);
  }

  private clank(b: Ball, amount: number): void {
    audio.play('hit', { volume: 0.35 * amount + 0.15, rate: 1.55 + Math.random() * 0.15, throttleMs: 40 });
    this.fx.vfx('impact', b.x, b.g - b.z * SINB, { scale: 0.22 + 0.12 * amount, duration: 220, blend: 'add', depth: DEPTH.word - 20 });
    this.rimImg.setY(RIM_SY + 3);
    this.tweens.add({ targets: this.rimImg, y: RIM_SY, duration: 160, ease: 'Back.Out' });
  }

  private boardThud(b: Ball): void {
    audio.play('land', { volume: 0.4, rate: 1.25, throttleMs: 40 });
    this.hoopImg.setY(HOOP.gy - 2);
    this.tweens.add({ targets: this.hoopImg, y: HOOP.gy, duration: 180, ease: 'Back.Out' });
    this.fx.vfx('dust', b.x, b.g - b.z * SINB, { scale: 0.2, duration: 260, alpha: 0.6, depth: DEPTH.word - 20 });
  }

  private missed(b: Ball): void {
    const s = b.s;
    if (!s) return;
    s.streak = 0;
  }

  private retire(b: Ball): void {
    b.on = false;
    b.s = null;
    b.x1 = 0;
    b.img.setVisible(false);
    b.shadow.setVisible(false);
    b.trail.clear().setVisible(false);
  }

  /** A basket: the net, the words, the points flying to the HUD, the crowd. */
  private score(b: Ball): void {
    if (b.scored) return;
    b.scored = true;
    const s = b.s;
    if (!s) return;
    const slot = s.p.slot;
    const pts = b.points;
    s.p.score += pts;
    s.streak++;
    const swish = b.outcome === 'swish';
    const side = s.x < HOOP.x ? -1 : 1;
    const color = PLAYER_COLORS[slot];
    const bx = this.hx;
    const by = RIM_SY + 30;
    this.rings.spawn(bx, RIM_SY, 30, 120, { squash: COSB, tint: color, alpha: 0.95, ms: 420, depth: DEPTH.rim + 1, add: true });
    this.sparks.fire(bx, by + 30, burst(swish ? 16 : 8), 90, 70, 120, 320);
    if (swish) {
      this.words.pop('cap-ft-swish', bx + side * 110, RIM_SY - 80, { near: 70, scale: 1.05, tilt: side * -8 });
      shockwave(this, bx, RIM_SY, { radius: 150, ratio: COSB, color: 0xffe08a, alpha: 0.8, duration: 380, depth: DEPTH.rim + 2 });
      audio.play('nearMiss', { volume: 0.55, rate: 1.1 });
      this.hitStop(55);
      punch(this, 0.012, 220);
    }
    audio.play(b.golden ? 'goldChip' : 'chipGain', { volume: 0.8, rate: swish ? 1.12 : 1, throttleMs: 30 });
    audio.play('splash', { volume: 0.18, rate: 2.2, throttleMs: 60 });
    if (b.golden) {
      this.fx.sparks(bx, by, LITE ? 12 : 22);
      this.gallery?.cheer(true);
      if (swish) this.slowMo(0.45, 260);
    } else if (swish) this.gallery?.cheer();
    if (s.streak >= 3 && s.streak % 2 === 1) {
      this.words.pop('cap-ft-streak', s.x, s.gy - 300, { owner: slot, scale: 0.85 });
      audio.play('streak', { volume: 0.6, rate: 1 + Math.min(0.3, (s.streak - 3) * 0.05) });
    }
    this.rumble(s.p, swish ? 0.3 : 0.15, 0.3, swish ? 110 : 60);
    this.holdHud(slot, pts);
    const h = this.hudPoint(slot);
    popToHud(this, bx + side * 60, RIM_SY - 20, `+${pts}`, h.x, h.y, {
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
    this.hx = R.hoopXAt(this.elapsed, this.slideAt);
    for (const s of this.shooters) this.updateShooter(s, dt);
    for (const b of this.balls) if (b.on) this.updateBall(b, dt);
    this.syncVisuals(dt);
  }

  private syncVisuals(dt: number): void {
    this.hoopImg.setX(this.hx);
    this.rimImg.setX(this.hx);
    this.netT += dt;
    this.netK = Math.max(0, this.netK - dt / 520);
    this.drawNet();
    this.rings.update(dt);
    const ts = this.time.timeScale;
    this.sparks.sync(ts);
    for (const s of this.shooters) {
      if (s.held.visible && !this.tweens.isTweening(s.held)) {
        const hp = this.handPoint(s);
        s.held.setPosition(hp.x, hp.y);
      }
      this.drawMeters(s);
    }
  }

  /** One ring of the net: n points round an ellipse of radius r at screen height y (shifted dx, turned by off strands). */
  private netRing(L: number, r: number, y: number, dx: number, off: number): void {
    const xs = this.nx[L];
    const ys = this.ny[L];
    for (let i = 0; i < NET_N; i++) {
      const a = ((i + off) / NET_N) * Math.PI * 2;
      xs[i] = this.hx + dx + Math.cos(a) * r;
      ys[i] = y + Math.sin(a) * r * COSB;
    }
  }

  /** The net: diamond strands from the rim to a narrower bottom ring; it flares and whips when a ball goes through. */
  private drawNet(): void {
    const k = this.netK;
    const sway = Math.sin(this.netT / 70) * 7 * k;
    const drop = NET_DROP + 26 * k;
    this.netRing(0, HOOP.rimR, RIM_SY, 0, 0);
    this.netRing(1, HOOP.rimR * (0.8 + 0.22 * k), RIM_SY + drop * 0.48, sway * 0.5, 0.5);
    this.netRing(2, HOOP.rimR * (0.56 + 0.34 * k), RIM_SY + drop, sway, 0);
    const back = this.netBack;
    const front = this.netFront;
    back.clear();
    front.clear();
    back.lineStyle(2.5, 0xd8dde6, 0.75);
    front.lineStyle(3, 0xffffff, 0.92);
    for (let i = 0; i < NET_N; i++) {
      const j = (i + 1) % NET_N;
      // top i -> mid i -> bottom i and bottom i+1; top i+1 -> mid i.
      const midA = ((i + 0.5) / NET_N) * Math.PI * 2;
      const g = Math.sin(midA) >= 0 ? front : back;
      g.lineBetween(this.nx[0][i], this.ny[0][i], this.nx[1][i], this.ny[1][i]);
      g.lineBetween(this.nx[0][j], this.ny[0][j], this.nx[1][i], this.ny[1][i]);
      g.lineBetween(this.nx[1][i], this.ny[1][i], this.nx[2][i], this.ny[2][i]);
      g.lineBetween(this.nx[1][i], this.ny[1][i], this.nx[2][j], this.ny[2][j]);
      g.lineBetween(this.nx[2][i], this.ny[2][i], this.nx[2][j], this.ny[2][j]);
    }
  }

  /** Power gauge beside the shooter and the aim bar over their head (only while they're in use). */
  private drawMeters(s: Shooter): void {
    const g = s.gauge;
    const n = s.needle;
    g.clear();
    n.clear();
    const showPower = s.stage === 'power' || s.stage === 'aim' || (s.stage === 'throw' && s.fade > 0);
    const color = PLAYER_COLORS[s.p.slot];
    const alpha = s.stage === 'throw' ? s.fade : 1;
    if (s.prompt) s.prompt.setVisible(false);
    if (!showPower || this.phase !== 'playing') return;
    const gold = s.golden;
    // --- power gauge (vertical): bar value v sits at height bot - v * h
    const gx = s.x + s.side * GAUGE.off;
    const top = s.gy - 26 - GAUGE.h;
    const w = GAUGE.w;
    const h = GAUGE.h;
    const bot = top + h;
    g.fillStyle(0x0a1120, 0.3 * alpha);
    g.fillRoundedRect(gx - w / 2 - 6 + 3, top - 6 + 4, w + 12, h + 12, 14);
    g.fillStyle(0x10202c, 0.88 * alpha);
    g.fillRoundedRect(gx - w / 2 - 6, top - 6, w + 12, h + 12, 14);
    g.fillStyle(0x2c3d4a, alpha);
    g.fillRoundedRect(gx - w / 2, top, w, h, 9);
    // After the lock the band stays where it was judged.
    const pT = s.stage === 'power' ? s.pTarget : s.pShown;
    g.fillStyle(0x3fbf5f, alpha);
    g.fillRect(gx - w / 2, bot - (pT + R.POWER_MAKE) * h, w, 2 * R.POWER_MAKE * h);
    g.fillStyle(0xc9ffb0, alpha);
    g.fillRect(gx - w / 2, bot - (pT + R.POWER_SWISH) * h, w, 2 * R.POWER_SWISH * h);
    g.lineStyle(3, color, alpha);
    g.strokeRoundedRect(gx - w / 2 - 6, top - 6, w + 12, h + 12, 14);
    const pv = s.stage === 'power' ? s.pVal : s.pLock;
    const my = bot - pv * h;
    const mc = s.stage !== 'power' && s.flash > 0 ? s.flashCol : gold ? 0xffd23a : 0xffffff;
    g.fillStyle(0x0a1120, 0.5 * alpha);
    g.fillRect(gx - w / 2 - 9, my - 3, w + 18, 8);
    g.fillStyle(mc, alpha);
    g.fillRect(gx - w / 2 - 9, my - 4, w + 18, 7);
    const tipX = s.side < 0 ? gx + w / 2 + 6 : gx - w / 2 - 6;
    const dir = s.side < 0 ? 1 : -1;
    g.fillTriangle(tipX + dir * 16, my - 10, tipX + dir * 16, my + 10, tipX + dir * 2, my);
    if (s.stage === 'power' && s.prompt) s.prompt.setPosition(gx, top - 36).setVisible(true);
    // --- aim bar (horizontal), once the power is in
    if (s.stage === 'power') return;
    const cx = s.x;
    const cy = s.c.y + s.c.headY * CHAR_SCALE - NEEDLE.above;
    const bw = NEEDLE.w;
    const bh = NEEDLE.h;
    const half = bw / 2;
    n.fillStyle(0x0a1120, 0.3 * alpha);
    n.fillRoundedRect(cx - bw / 2 - 6 + 3, cy - bh / 2 - 6 + 4, bw + 12, bh + 12, 14);
    n.fillStyle(0x10202c, 0.88 * alpha);
    n.fillRoundedRect(cx - bw / 2 - 6, cy - bh / 2 - 6, bw + 12, bh + 12, 14);
    n.fillStyle(0x2c3d4a, alpha);
    n.fillRoundedRect(cx - bw / 2, cy - bh / 2, bw, bh, 9);
    const aT = s.aTarget;
    const a0 = Math.max(-1, aT - R.AIM_MAKE);
    const a1 = Math.min(1, aT + R.AIM_MAKE);
    n.fillStyle(0x3fbf5f, alpha);
    n.fillRect(cx + a0 * half, cy - bh / 2, (a1 - a0) * half, bh);
    n.fillStyle(0xc9ffb0, alpha);
    n.fillRect(cx + (aT - R.AIM_SWISH) * half, cy - bh / 2, R.AIM_SWISH * bw, bh);
    n.lineStyle(3, color, alpha);
    n.strokeRoundedRect(cx - bw / 2 - 6, cy - bh / 2 - 6, bw + 12, bh + 12, 14);
    const nxp = cx + s.aVal * half;
    const nc = s.stage === 'throw' && s.flash > 0 ? s.flashCol : gold ? 0xffd23a : 0xffffff;
    n.fillStyle(0x0a1120, 0.5 * alpha);
    n.fillRect(nxp - 3, cy - bh / 2 - 9, 8, bh + 18);
    n.fillStyle(nc, alpha);
    n.fillRect(nxp - 4, cy - bh / 2 - 9, 7, bh + 18);
    n.fillTriangle(nxp - 10, cy - bh / 2 - 22, nxp + 10, cy - bh / 2 - 22, nxp, cy - bh / 2 - 8);
    if (s.stage === 'aim' && s.prompt) s.prompt.setPosition(cx + s.side * (bw / 2 + 40), cy).setVisible(true);
  }

  protected override ambient(dt: number): void {
    if (this.phase === 'playing') return;
    this.syncVisuals(dt);
    for (const b of this.balls) if (b.on && this.phase === 'finished') b.trail.clear();
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      for (const s of this.shooters) {
        s.gauge.clear();
        s.needle.clear();
        s.prompt?.setVisible(false);
        s.held.setVisible(false);
        s.c.sprite.setY(0);
        if (s.c.current === 'carry' || s.c.current === 'throw') s.c.play('idle', { force: true });
      }
      this.trackGlow.setVisible(false);
      this.gallery?.cheer(true);
    }
    super.end();
  }

  // --- CPU ---------------------------------------------------------------------------------------
  /** A CPU picks where it will stop the meter now starting (its read of the zone, plus its error). */
  private cpuArm(s: Shooter): void {
    if (!s.p.isCpu) return;
    const sk = this.skill(s.p);
    const sigma = 0.25 + 1.3 * sk.aimNoise;
    let e = gauss() * sigma;
    if (Math.random() < sk.mistake) e += (Math.random() < 0.5 ? -1 : 1) * (1.4 + Math.random() * 1.6);
    s.goal = e;
    s.readyAt = sk.reaction * (0.6 + Math.random() * 0.8);
    s.last = s.stage === 'aim' ? s.aVal : s.pVal;
  }

  protected cpuThink(p: MgPlayer, vc: VirtualControls): void {
    const s = this.shooters.find((q) => q.p === p);
    if (!s || (s.stage !== 'power' && s.stage !== 'aim')) return;
    const aiming = s.stage === 'aim';
    const v = aiming ? s.aVal : s.pVal;
    // (Kept inside the meter's travel, so a wild read still presses eventually.)
    const goal = aiming ? R.clamp(s.aTarget + s.goal * R.AIM_MAKE, -0.97, 0.97) : R.clamp(s.pTarget + s.goal * R.POWER_MAKE, 0.03, 0.97);
    const crossed = (s.last - goal) * (v - goal) <= 0 && s.last !== v;
    s.last = v;
    if (s.t >= s.readyAt && crossed) vc.tap('A');
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} points` }));
  }
}

/** A standard normal sample (Box–Muller). */
function gauss(): number {
  const u = Math.max(1e-6, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * Math.random());
}
