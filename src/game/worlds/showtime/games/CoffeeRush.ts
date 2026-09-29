import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { GAME_WIDTH, PLAYER_COLORS, PLAYER_SHAPES } from '../../../constants';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../../data/npcs';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { bakeWord, liteCount, WordPops } from '../../../minigames/games/stageKit';
import { kick, popToHud, shockwave } from '../../../minigames/juice';
import { glyphKindFor, makeGlyph } from '../../../ui/ControllerPrompt';
import { drawPlayerShape } from '../../../ui/PlayerBadge';
import { standOrigin } from '../../../util/spriteUtil';
import {
  coffeePoints,
  gradeShot,
  gradeSwirl,
  orderTarget,
  patienceMs,
  pourRate,
  SHOT,
  SWIRL,
  SWIRL_GRACE_MS,
  SWIRL_LAPS,
  swirlPeriod,
  swirlStart,
  type ShotGrade,
  type SwirlGrade,
} from '../coffeeRushRules';
import { finishSprites, glowTexture, heartTexture, queueSprites, releaseOnShutdown, sparkleTexture, spread, type SpriteFile } from '../showtimeKit';

// --- Layout (front view). The rendered café (scripts/art/worlds/showtime/mg_cafe.py) matches these. ---
/** Machines stand on the counter top here; served cups wait at its front edge. */
const COUNTER_TOP_Y = 579;
const COUNTER_EDGE_Y = 598;
/** Baristas stand behind the counter (their legs hidden by the counter layer). */
const BARISTA_Y = 612;
/** Customers step up to the counter here. */
const CUSTOMER_Y = 770;
const CUSTOMER_SCALE = 0.62;
/** Each station's gauge panel (the shot glass, then the milk swirl) hangs here. */
const PANEL_Y = 270;
const PANEL_W = 176;
const PANEL_H = 214;
/** Spacing between stations for 2, 3 and 4 players. */
const GAPS: readonly [number, number, number] = [680, 560, 450];
/** Offsets from a station's centre. */
const MACHINE_DX = -112;
const BARISTA_DX = 40;
const CUSTOMER_DX = 70;
const BUBBLE_DX = 70;
const BUBBLE_DY = -178;
/** The espresso machine sprite (mg_cafe.py `machine`): anchored at its base; spout and drip tray from there. */
const MACHINE_KEY = 'showtime-espresso';
const MACHINE_ANCHOR = { x: 0.5, y: 0.9 };
const SPOUT = { dx: -5, dy: -21 };
const TRAY = { dx: -5, dy: 3 };
/** The shot glass on the panel: its cavity (from the panel centre). */
const MUG = { x0: -40, x1: 40, top: -66, bottom: 70 };
/** The milk swirl: the orbit's radius on the panel. */
const ORBIT_R = 42;
/** Corner radii of the shot glass (made once: drawing runs every frame). */
const GLASS_CORNERS = { tl: 4, tr: 4, bl: 16, br: 16 };

const SPRITES: readonly SpriteFile[] = [[MACHINE_KEY, 'showtime_espresso']];

const WORDS = {
  perfect: { key: 'coffee-w-perfect', text: 'PERFECT SHOT!', size: 36, fill: ['#fffbd0', '#ffbf2a'] as const },
  good: { key: 'coffee-w-good', text: 'GOOD', size: 34, fill: ['#ffffff', '#aeefff'] as const },
  weak: { key: 'coffee-w-weak', text: 'TOO WEAK', size: 32, fill: ['#eef0f4', '#9ba3b2'] as const },
  over: { key: 'coffee-w-over', text: 'TOO STRONG', size: 32, fill: ['#eef0f4', '#9ba3b2'] as const },
  spill: { key: 'coffee-w-spill', text: 'SPILL!', size: 40, fill: ['#ffe2d6', '#ff6b5e'] as const },
  art: { key: 'coffee-w-art', text: 'LATTE ART!', size: 36, fill: ['#ffe3f1', '#ff5fa8'] as const },
  nice: { key: 'coffee-w-nice', text: 'NICE!', size: 34, fill: ['#ffffff', '#aeefff'] as const },
  messy: { key: 'coffee-w-messy', text: 'MESSY', size: 32, fill: ['#eef0f4', '#9ba3b2'] as const },
  brew: { key: 'coffee-w-brew', text: 'PERFECT BREW!', size: 44, fill: ['#fffbd0', '#ff9f1a'] as const },
  slow: { key: 'coffee-w-slow', text: 'TOO SLOW...', size: 32, fill: ['#eef0f4', '#9ba3b2'] as const },
  hold: { key: 'coffee-w-hold', text: 'HOLD', size: 28, fill: ['#ffffff', '#ffe3a0'] as const },
  tap: { key: 'coffee-w-tap', text: 'TAP', size: 28, fill: ['#ffffff', '#ffe3a0'] as const },
};

type CupState = 'refill' | 'ready' | 'pouring' | 'graded' | 'dump' | 'swirl' | 'art' | 'slide' | 'waitCustomer' | 'handoff';

interface Customer {
  spr: Phaser.GameObjects.Sprite;
  id: NpcId;
  state: 'walkin' | 'waiting' | 'happy' | 'leaving';
  t: number;
  patience: number;
  patienceMax: number;
  impatient: boolean;
  angry: boolean;
  fromX: number;
}

interface Station {
  p: MgPlayer;
  c: Character;
  x: number;
  px: number;
  machine: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  cupG: Phaser.GameObjects.Graphics;
  stream: Phaser.GameObjects.Graphics;
  panel: Phaser.GameObjects.Graphics;
  heart: Phaser.GameObjects.Image;
  bubble: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics;
  hint?: Phaser.GameObjects.Container;
  hintWord?: Phaser.GameObjects.Image;
  state: CupState;
  t: number;
  level: number;
  target: number;
  shot: ShotGrade | null;
  swirl: SwirlGrade | null;
  swirlAng: number;
  heartAng: number;
  swirlT: number;
  period: number;
  band: 0 | 1 | 2;
  fizzT: number;
  cupX: number;
  cupY: number;
  cupTilt: number;
  customer: Customer | null;
  nextCustomer: number;
  served: number;
  perfectBrews: number;
  cupsMade: number;
  swirlsMade: number;
  // CPU plan
  cpuWait: number;
  cpuRelease: number;
  cpuTapAt: number;
  cpuPlanned: boolean;
}

const NPCS: readonly NpcId[] = ['ora', 'wrench', 'pipper', 'mimi', 'packsprout'];
const ORDER_POSE: Record<NpcId, string> = { ora: 'point', wrench: 'idea', pipper: 'point', mimi: 'happy', packsprout: 'happy' };
const IMPATIENT_POSE: Record<NpcId, string> = { ora: 'idle', wrench: 'surprised', pipper: 'idle', mimi: 'alert', packsprout: 'surprised' };
const HAPPY_POSE: Record<NpcId, string> = { ora: 'cheer', wrench: 'laugh', pipper: 'happy', mimi: 'laugh', packsprout: 'star' };

/** A unit heart outline (the latte art), made once. */
const HEART_PTS = Array.from({ length: 28 }, (_, i) => {
  const t = (i / 28) * Math.PI * 2;
  return { x: Math.pow(Math.sin(t), 3), y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16 };
});

function gauss(): number {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.73;
}

/**
 * Coffee Rush — a pastel café counter. Hold A to pull an espresso shot and let go on the cup's fill
 * line, then tap A as the milk swirl passes the heart for latte art. Serve each customer before
 * their patience runs out; perfect pours score more. The most points after 50 seconds wins.
 */
export class CoffeeRushScene extends BaseMinigame {
  private stations: Station[] = [];
  private pops!: WordPops;
  private rush = false;
  private scratch: Phaser.Types.Math.Vector2Like[] = HEART_PTS.map(() => ({ x: 0, y: 0 }));
  private hearts: Phaser.GameObjects.Image[] = [];
  private visT = 0;
  /** Reused corner radii for the coffee inside the glass. */
  private coffeeCorners = { tl: 0, tr: 0, bl: 12, br: 12 };

  constructor() {
    super('mg-coffee-rush');
  }

  preload(): void {
    queueSprites(this, SPRITES);
  }

  // --- Setup -----------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = 50000;
    this.stations = [];
    this.rush = false;
    this.hearts = [];
    this.visT = 0;
    finishSprites(this, SPRITES);
    releaseOnShutdown(this, SPRITES);
    for (const w of Object.values(WORDS)) bakeWord(this, w.key, w.text, { size: w.size, fill: w.fill });
    glowTexture(this);
    heartTexture(this);
    sparkleTexture(this);
    this.bakeBubble();
    const sky = ['rendered-sky-day', 'rendered-sky-clear', 'rendered-sky-golden'].find((k) => this.textures.exists(k));
    if (sky) this.add.image(GAME_WIDTH / 2, 470, sky).setDisplaySize(GAME_WIDTH * 1.04, 1170).setDepth(-100);
    if (this.textures.exists('rendered-scene-showtime_cafe')) this.add.image(0, 0, 'rendered-scene-showtime_cafe').setOrigin(0).setDepth(-50);
    else this.drawFallbackCafe();
    if (this.textures.exists('rendered-scene-showtime_cafe_counter')) this.add.image(0, 0, 'rendered-scene-showtime_cafe_counter').setOrigin(0).setDepth(500);
    else this.drawFallbackCounter();
    this.pops = new WordPops(this, 8700, 20);
    for (let i = 0; i < liteCount(24); i++) this.hearts.push(this.add.image(0, 0, 'showtime-heart').setVisible(false).setDepth(8450));
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const x = spread(this.players.length, GAPS)[index];
    const mx = x + MACHINE_DX;
    let machine: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
    if (this.textures.exists(MACHINE_KEY)) machine = this.add.image(mx, COUNTER_TOP_Y, MACHINE_KEY).setOrigin(MACHINE_ANCHOR.x, MACHINE_ANCHOR.y);
    else machine = this.drawFallbackMachine(mx);
    machine.setDepth(560);
    this.add.image(mx, COUNTER_TOP_Y + 2, 'fx-contact').setScale(1.3, 0.3).setAlpha(0.45).setDepth(555);
    const c = new Character(this, x + BARISTA_DX, BARISTA_Y, p.characterId, { scale: 1, slot: p.slot });
    c.setDepth(300);
    p.character = c;
    const px = x + (MACHINE_DX + BARISTA_DX) / 2;
    const panel = this.add.graphics().setDepth(8300);
    const heart = this.add.image(px, PANEL_Y, 'showtime-heart').setVisible(false).setDepth(8302).setScale(0.36).setTint(0xffffff);
    const cupG = this.add.graphics().setDepth(570);
    const stream = this.add.graphics().setDepth(575);
    const bubble = this.add.image(0, 0, 'coffee-bubble').setVisible(false).setDepth(8350);
    const ring = this.add.graphics().setDepth(8351);
    const st: Station = {
      p,
      c,
      x,
      px,
      machine,
      cupG,
      stream,
      panel,
      heart,
      bubble,
      ring,
      state: 'refill',
      t: 0,
      level: 0,
      target: 0.6,
      shot: null,
      swirl: null,
      swirlAng: 0,
      heartAng: 0,
      swirlT: 0,
      period: 1150,
      band: 0,
      fizzT: 0,
      cupX: mx + TRAY.dx,
      cupY: COUNTER_TOP_Y + TRAY.dy,
      cupTilt: 0,
      customer: null,
      nextCustomer: 250 + index * 220,
      served: 0,
      perfectBrews: 0,
      cupsMade: 0,
      swirlsMade: 0,
      cpuWait: 0,
      cpuRelease: 0,
      cpuTapAt: 0,
      cpuPlanned: false,
    };
    if (!p.isCpu) this.buildHint(st);
    this.stations.push(st);
    this.newCup(st, true);
  }

  /** Human players get a small "A: HOLD / TAP" reminder under their panel for the first cups. */
  private buildHint(st: Station): void {
    const root = this.add.container(st.px, PANEL_Y + PANEL_H / 2 + 6).setDepth(8320);
    const back = this.add.graphics();
    back.fillStyle(0x1a0f24, 0.78);
    back.fillRoundedRect(-74, -24, 148, 48, 24);
    back.lineStyle(3, PLAYER_COLORS[st.p.slot], 0.9);
    back.strokeRoundedRect(-74, -24, 148, 48, 24);
    const glyph = makeGlyph(this, 'A', 34, glyphKindFor(st.p.slot));
    glyph.setScale(Math.min(1, 44 / Math.max(1, glyph.width))).setPosition(-38, 0);
    const word = this.add.image(22, 0, WORDS.hold.key);
    root.add([back, glyph, word]);
    st.hint = root;
    st.hintWord = word;
  }

  protected override bannerY(): number {
    return 460;
  }

  protected override onStart(): void {
    for (const st of this.stations) st.c.play('wave');
  }

  /** Rush hour: every coffee counts double. */
  protected override onFinalStretch(): void {
    this.rush = true;
    this.showFinalStretch('RUSH HOUR! DOUBLE POINTS');
    audio.play('cheer', { volume: 0.5 });
  }

  // --- Cups ------------------------------------------------------------------------------------
  private newCup(st: Station, first = false): void {
    st.state = 'refill';
    st.t = first ? 0 : 320;
    st.level = 0;
    st.shot = null;
    st.swirl = null;
    st.band = 0;
    st.cupTilt = 0;
    st.target = orderTarget(this.rng);
    st.cupX = st.x + MACHINE_DX + TRAY.dx;
    st.cupY = COUNTER_TOP_Y + TRAY.dy;
    st.cpuPlanned = false;
    st.heart.setVisible(false);
    if (!first) {
      st.cupG.setScale(0);
      this.tweens.add({ targets: st.cupG, scale: 1, duration: 220, ease: 'Back.Out' });
    }
  }

  private startPour(st: Station): void {
    st.state = 'pouring';
    st.t = 0;
    st.fizzT = 0;
    st.c.face(true);
    st.c.hold('pull', 1);
    audio.play('whoosh', { volume: 0.25, throttleMs: 60 });
    this.fx.vfx('smoke', st.x + MACHINE_DX + SPOUT.dx, COUNTER_TOP_Y + SPOUT.dy - 60, { scale: 0.25, duration: 600, alpha: 0.5, dy: -30, depth: 580 });
    this.rumble(st.p, 0.1, 0.25, 90);
  }

  private release(st: Station): void {
    const g = gradeShot(st.level, st.target);
    st.shot = g;
    st.state = g === 'perfect' || g === 'good' ? 'graded' : 'dump';
    st.t = g === 'spill' ? 950 : g === 'perfect' || g === 'good' ? 380 : 700;
    st.stream.clear();
    st.cupsMade++;
    const wx = st.px;
    const wy = PANEL_Y - PANEL_H / 2 + 36;
    const human = !st.p.isCpu;
    if (g === 'perfect') {
      this.pops.pop(WORDS.perfect.key, wx, wy, { rise: 24, hold: 420, owner: st.p.slot });
      audio.play('nearMiss', { rate: 1.1, volume: 0.6, throttleMs: 40 });
      this.fx.sparks(st.px, PANEL_Y + MUG.bottom - (MUG.bottom - MUG.top) * st.level, liteCount(14));
      st.c.hold('celebrate', 1);
      if (human) this.rumble(st.p, 0.3, 0.4, 90);
    } else if (g === 'good') {
      this.pops.pop(WORDS.good.key, wx, wy, { rise: 20, hold: 320, owner: st.p.slot });
      audio.play('pop', { rate: 1.1, volume: 0.4, throttleMs: 40 });
      st.c.play('idle', { force: true });
    } else if (g === 'spill') {
      this.pops.pop(WORDS.spill.key, wx, wy, { rise: 20, hold: 520, owner: st.p.slot, tilt: -8 });
      audio.play('splash', { volume: 0.45, throttleMs: 80 });
      this.fx.vfx('splash', st.cupX, st.cupY - 20, { scale: 0.32, duration: 480, tint: 0x8a5a3a, depth: 580 });
      this.fx.vfx('splash', st.cupX + 18, st.cupY - 6, { scale: 0.22, duration: 420, tint: 0xc98a4a, depth: 580 });
      st.c.play('surprised', { force: true });
      if (human) {
        kick(this, 0, 6, 120);
        this.rumble(st.p, 0.5, 0.4, 160);
      }
    } else {
      this.pops.pop(g === 'weak' ? WORDS.weak.key : WORDS.over.key, wx, wy, { rise: 16, hold: 420, owner: st.p.slot });
      audio.play('cancel', { volume: 0.3, throttleMs: 60 });
      st.c.play('disappointed', { force: true });
      if (human) this.rumble(st.p, 0.15, 0.3, 90);
    }
    this.drawCup(st);
  }

  private startSwirl(st: Station): void {
    st.state = 'swirl';
    const s = swirlStart(this.rng);
    st.heartAng = s.heart;
    st.swirlAng = s.start;
    st.swirlT = 0;
    st.period = swirlPeriod(this.elapsed);
    st.cpuPlanned = false;
    st.c.face(false);
    st.c.hold('carry', 0);
    audio.play('whoosh', { volume: 0.2, rate: 1.3, throttleMs: 60 });
    const a = Phaser.Math.DegToRad(st.heartAng);
    st.heart.setPosition(st.px + Math.cos(a) * ORBIT_R, PANEL_Y + 4 + Math.sin(a) * ORBIT_R).setVisible(true).setTint(0xff5fa8).setScale(0.3);
  }

  private tapSwirl(st: Station, auto = false): void {
    const g: SwirlGrade = auto ? 'messy' : gradeSwirl(st.swirlAng, st.heartAng);
    st.swirl = g;
    st.state = 'art';
    st.t = 440;
    st.swirlsMade++;
    st.heart.setVisible(false);
    const wx = st.px;
    const wy = PANEL_Y - PANEL_H / 2 + 36;
    if (g === 'perfect') {
      this.pops.pop(WORDS.art.key, wx, wy, { rise: 24, hold: 420, owner: st.p.slot });
      audio.play('streak', { volume: 0.5, throttleMs: 60 });
      for (let i = 0; i < liteCount(5); i++) this.floatHeart(st.px + (Math.random() - 0.5) * 60, PANEL_Y, st.px + (Math.random() - 0.5) * 120, PANEL_Y - 130, 0xff6fb0, 0.45, i * 50);
      if (!st.p.isCpu) this.rumble(st.p, 0.25, 0.35, 80);
    } else if (g === 'good') {
      this.pops.pop(WORDS.nice.key, wx, wy, { rise: 20, hold: 320, owner: st.p.slot });
      audio.play('pop', { rate: 1.25, volume: 0.35, throttleMs: 40 });
    } else {
      this.pops.pop(WORDS.messy.key, wx, wy, { rise: 16, hold: 360, owner: st.p.slot });
      audio.play('cancel', { volume: 0.22, throttleMs: 60 });
    }
  }

  /** The finished coffee slides along the counter to the customer's spot. */
  private slideCup(st: Station): void {
    st.state = 'slide';
    st.t = 0;
    st.c.face(false);
    st.c.play('throw', { force: true });
    audio.play('whoosh', { volume: 0.3, throttleMs: 60 });
    const tx = st.x + CUSTOMER_DX;
    this.tweens.add({
      targets: st,
      cupX: tx,
      cupY: COUNTER_EDGE_Y,
      duration: 360,
      ease: 'Cubic.Out',
      onUpdate: () => this.placeCup(st),
      onComplete: () => {
        if (st.state === 'slide') st.state = 'waitCustomer';
      },
    });
  }

  /** The customer takes their coffee: points fly to the HUD, hearts, a happy wiggle. */
  private handOff(st: Station, cu: Customer): void {
    st.state = 'handoff';
    st.t = 260;
    const shot = st.shot === 'perfect' ? 'perfect' : 'good';
    const swirl = st.swirl ?? 'messy';
    const pts = coffeePoints(shot, swirl, this.rush);
    const perfect = shot === 'perfect' && swirl === 'perfect';
    st.served++;
    st.p.score += pts;
    if (perfect) st.perfectBrews++;
    cu.state = 'happy';
    cu.t = 700;
    this.setPose(cu, HAPPY_POSE[cu.id]);
    this.tweens.add({ targets: cu.spr, y: CUSTOMER_Y - 26, duration: 140, yoyo: true, repeat: 1, ease: 'Quad.Out' });
    this.tweens.add({ targets: st.cupG, x: cu.spr.x, y: CUSTOMER_Y - 70, scale: 0.4, alpha: 0, duration: 240, ease: 'Quad.In' });
    const slot = st.p.slot;
    this.holdHud(slot, pts);
    const h = this.hudPoint(slot);
    popToHud(this, cu.spr.x, CUSTOMER_Y - 150, `+${pts}`, h.x, h.y, {
      color: perfect ? '#ffe36b' : '#ffffff',
      size: 56,
      onArrive: () => {
        this.releaseHud(slot, pts);
        this.bumpHud(slot);
      },
    });
    audio.play('confirm', { volume: 0.5, throttleMs: 40 });
    for (let i = 0; i < liteCount(perfect ? 6 : 3); i++) this.floatHeart(cu.spr.x + (Math.random() - 0.5) * 50, CUSTOMER_Y - 110, cu.spr.x + (Math.random() - 0.5) * 140, CUSTOMER_Y - 240, perfect ? 0xff5fa8 : 0xffffff, 0.5, i * 60);
    if (perfect) {
      this.pops.pop(WORDS.brew.key, cu.spr.x, CUSTOMER_Y - 230, { rise: 40, hold: 560, owner: 30 + slot, tilt: -6 });
      audio.play('cheer', { volume: 0.3, throttleMs: 500 });
      shockwave(this, cu.spr.x, CUSTOMER_Y - 80, { radius: 130, ratio: 0.6, color: 0xffd23f, alpha: 0.8, duration: 380, depth: 8440 });
      this.fx.sparks(cu.spr.x, CUSTOMER_Y - 120, liteCount(16));
      st.c.play('celebrate', { force: true });
      if (!st.p.isCpu) {
        this.hitStop(50);
        this.rumble(st.p, 0.35, 0.45, 120);
      }
    }
  }

  // --- Customers -------------------------------------------------------------------------------
  private spawnCustomer(st: Station): void {
    const id = NPCS[this.rng.int(0, NPCS.length - 1)];
    const x = st.x + CUSTOMER_DX;
    const fromX = x + (this.rng.next() < 0.5 ? -1 : 1) * 60;
    const spr = this.add.sprite(fromX, 1200, NPC_ATLAS, npcFrame(id, 'idle'));
    const o = standOrigin(NPC_ATLAS, npcFrame(id, 'idle'));
    spr.setOrigin(o.x, o.y).setScale(CUSTOMER_SCALE).setDepth(700 + st.x * 0.001);
    const max = patienceMs(this.elapsed);
    st.customer = { spr, id, state: 'walkin', t: 620, patience: max, patienceMax: max, impatient: false, angry: false, fromX };
  }

  private setPose(cu: Customer, pose: string): void {
    const f = npcFrame(cu.id, pose);
    cu.spr.setFrame(f);
    const o = standOrigin(NPC_ATLAS, f);
    cu.spr.setOrigin(o.x, o.y);
  }

  private updateCustomer(st: Station, dt: number): void {
    const cu = st.customer;
    if (!cu) {
      st.nextCustomer -= dt;
      if (st.nextCustomer <= 0 && this.phase === 'playing') this.spawnCustomer(st);
      return;
    }
    const x = st.x + CUSTOMER_DX;
    cu.t -= dt;
    if (cu.state === 'walkin') {
      const u = 1 - Math.max(0, cu.t) / 620;
      const e = 1 - (1 - u) * (1 - u);
      cu.spr.setPosition(cu.fromX + (x - cu.fromX) * e, 1200 + (CUSTOMER_Y - 1200) * e - Math.abs(Math.sin(u * Math.PI * 3)) * 26 * (1 - u));
      if (cu.t <= 0) {
        cu.state = 'waiting';
        cu.spr.setPosition(x, CUSTOMER_Y);
        this.setPose(cu, ORDER_POSE[cu.id]);
        st.bubble.setPosition(x + BUBBLE_DX, CUSTOMER_Y + BUBBLE_DY).setVisible(true).setScale(0.3);
        this.tweens.add({ targets: st.bubble, scale: 1, duration: 220, ease: 'Back.Out' });
        audio.play('pop', { rate: 0.9, volume: 0.25, throttleMs: 60 });
      }
    } else if (cu.state === 'waiting') {
      cu.patience -= dt * (this.rush ? 1.15 : 1);
      const k = cu.patience / cu.patienceMax;
      if (!cu.impatient && k < 0.35) {
        cu.impatient = true;
        this.setPose(cu, IMPATIENT_POSE[cu.id]);
        audio.play('warn', { rate: 0.8, volume: 0.35, throttleMs: 200 });
      }
      if (cu.impatient) cu.spr.x = x + Math.sin(this.visT / 40) * 3;
      if (st.state === 'waitCustomer') this.handOff(st, cu);
      else if (cu.patience <= 0) this.customerLeaves(st, cu);
    } else if (cu.state === 'happy') {
      if (cu.t <= 0) {
        cu.state = 'leaving';
        cu.t = 520;
        st.bubble.setVisible(false);
      }
    } else if (cu.state === 'leaving') {
      const u = 1 - Math.max(0, cu.t) / 520;
      cu.spr.setPosition(x + (cu.angry ? -1 : 1) * 40 * u, CUSTOMER_Y + (1220 - CUSTOMER_Y) * u * u).setAlpha(1 - u * 0.3);
      if (cu.t <= 0) {
        cu.spr.destroy();
        st.customer = null;
        st.nextCustomer = cu.angry ? 700 : 260;
      }
    }
    this.drawRing(st);
  }

  private customerLeaves(st: Station, cu: Customer): void {
    cu.state = 'leaving';
    cu.angry = true;
    cu.t = 620;
    st.bubble.setVisible(false);
    this.pops.pop(WORDS.slow.key, cu.spr.x, CUSTOMER_Y - 200, { rise: 30, hold: 420, owner: 30 + st.p.slot });
    this.fx.vfx('smoke', cu.spr.x, CUSTOMER_Y - 150, { scale: 0.3, duration: 700, alpha: 0.7, dy: -40, depth: 8440 });
    audio.play('error', { volume: 0.35, throttleMs: 200 });
    if (!st.p.isCpu) {
      st.c.play('disappointed', { force: true });
      this.rumble(st.p, 0.15, 0.3, 120);
    }
  }

  // --- Frame -----------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.visT += dt;
    for (const st of this.stations) {
      const c = st.p.controls;
      st.t -= dt;
      switch (st.state) {
        case 'refill':
          if (st.t <= 0) st.state = 'ready';
          break;
        case 'ready':
          if (c.pressed('A')) this.startPour(st);
          break;
        case 'pouring': {
          // A release is judged at the level on screen (before this frame's pour).
          if (!c.held('A')) {
            this.release(st);
            break;
          }
          st.level += dt * pourRate(this.elapsed);
          const d = Math.abs(st.level - st.target);
          const band: 0 | 1 | 2 = d <= SHOT.perfect ? 2 : d <= SHOT.good ? 1 : 0;
          if (band > st.band) {
            audio.play('tick', { rate: band === 2 ? 1.8 : 1.35, volume: 0.35, throttleMs: 40 });
            if (band === 2) this.rumble(st.p, 0.05, 0.2, 40);
          }
          st.band = band;
          st.fizzT -= dt;
          if (st.fizzT <= 0) {
            st.fizzT = 520;
            audio.play('fuse', { volume: 0.18, throttleMs: 200 });
          }
          if (st.level >= 1) {
            st.level = 1;
            this.release(st);
          }
          break;
        }
        case 'graded':
          if (st.t <= 0) this.startSwirl(st);
          break;
        case 'dump':
          st.cupTilt = Math.min(1, st.cupTilt + dt / 260);
          if (st.t <= 0) {
            st.c.play('idle', { force: true });
            this.newCup(st);
          }
          break;
        case 'swirl': {
          // A tap is judged where the milk is on screen (before this frame's turn).
          if (st.swirlT > SWIRL_GRACE_MS && c.pressed('A')) {
            this.tapSwirl(st);
            break;
          }
          st.swirlT += dt;
          st.swirlAng = (st.swirlAng + (dt / st.period) * 360) % 360;
          if (st.swirlT > st.period * SWIRL_LAPS + SWIRL_GRACE_MS) this.tapSwirl(st, true);
          break;
        }
        case 'art':
          if (st.t <= 0) this.slideCup(st);
          break;
        case 'handoff':
          if (st.t <= 0) {
            st.cupG.setAlpha(1);
            st.c.play('idle', { force: true });
            this.newCup(st);
          }
          break;
        default:
          break;
      }
      this.updateCustomer(st, dt);
      this.drawStation(st);
    }
  }

  protected override ambient(dt: number): void {
    if (this.phase !== 'playing') for (const st of this.stations) this.drawStation(st);
    void dt;
  }

  // --- Drawing ---------------------------------------------------------------------------------
  private placeCup(st: Station): void {
    st.cupG.setPosition(st.cupX, st.cupY);
  }

  private drawStation(st: Station): void {
    this.placeCup(st);
    this.drawCup(st);
    this.drawPanel(st);
    this.drawStream(st);
    if (st.hint && st.hintWord) {
      const show = this.phase === 'playing' && ((st.state === 'ready' && st.cupsMade < 2) || (st.state === 'swirl' && st.swirlsMade < 2));
      st.hint.setVisible(show);
      if (show) st.hintWord.setTexture(st.state === 'swirl' ? WORDS.tap.key : WORDS.hold.key);
    }
  }

  /** The little glass on the drip tray (it fills as the panel's does, and slides to the customer). */
  private drawCup(st: Station): void {
    const g = st.cupG;
    g.clear();
    const tilt = st.cupTilt;
    g.setAngle(st.state === 'dump' ? -70 * tilt : 0);
    g.fillStyle(0x000000, 0.18);
    g.fillEllipse(0, 1, 30, 7);
    const lv = st.state === 'art' || st.state === 'slide' || st.state === 'waitCustomer' || st.state === 'handoff' ? Math.max(st.level, 0.5) : st.level;
    const h = 24;
    if (lv > 0) {
      const fh = Math.min(1, lv) * (h - 3);
      g.fillStyle(0x5a3521, 1);
      g.fillRect(-10, -fh - 1, 20, fh);
      g.fillStyle(0xc98a4a, 1);
      g.fillRect(-10, -fh - 1, 20, Math.min(3, fh));
      if (st.swirl) {
        g.fillStyle(0xfff6ec, 1);
        g.fillEllipse(0, -fh + 1, 16, 4);
      }
    }
    g.lineStyle(2.5, 0xffffff, 0.9);
    g.strokeRect(-12, -h, 24, h);
    g.lineStyle(2.5, 0xffffff, 0.8);
    g.strokeCircle(15, -h / 2, 5);
    g.fillStyle(0xffffff, 0.25);
    g.fillRect(-10, -h + 2, 4, h - 4);
  }

  private drawStream(st: Station): void {
    const g = st.stream;
    g.clear();
    if (st.state !== 'pouring') return;
    const sx = st.x + MACHINE_DX + SPOUT.dx;
    const sy = COUNTER_TOP_Y + SPOUT.dy;
    const ey = st.cupY - 4 - st.level * 20;
    const w = Math.sin(this.visT / 45) * 1.2;
    g.lineStyle(5, 0x4a2a18, 1);
    g.lineBetween(sx, sy, sx + w, ey);
    g.lineStyle(2, 0xb07040, 1);
    g.lineBetween(sx - 0.5, sy, sx + w - 0.5, ey);
  }

  /** The station's gauge panel: the shot glass while pulling, the milk swirl, then the latte art. */
  private drawPanel(st: Station): void {
    const g = st.panel;
    g.clear();
    const x = st.px;
    const y = PANEL_Y;
    const color = PLAYER_COLORS[st.p.slot];
    g.fillStyle(0x0a0614, 0.22);
    g.fillRoundedRect(x - PANEL_W / 2 + 4, y - PANEL_H / 2 + 7, PANEL_W, PANEL_H, 24);
    g.fillStyle(0x24142f, 0.8);
    g.fillRoundedRect(x - PANEL_W / 2, y - PANEL_H / 2, PANEL_W, PANEL_H, 24);
    g.lineStyle(4, color, 1);
    g.strokeRoundedRect(x - PANEL_W / 2, y - PANEL_H / 2, PANEL_W, PANEL_H, 24);
    drawPlayerShape(g, PLAYER_SHAPES[st.p.slot], x - PANEL_W / 2 + 20, y - PANEL_H / 2 + 20, 10, color, 0xffffff, 3);
    const s = st.state;
    if (s === 'swirl') this.drawSwirl(g, st, x, y + 4);
    else if (s === 'art' || s === 'slide' || s === 'waitCustomer' || s === 'handoff') this.drawArt(g, st, x, y + 4);
    else this.drawMug(g, st, x, y + 4);
  }

  private drawMug(g: Phaser.GameObjects.Graphics, st: Station, x: number, y: number): void {
    const H = MUG.bottom - MUG.top;
    const levelY = (v: number) => y + MUG.bottom - H * v;
    // glass body
    g.fillStyle(0xffffff, 0.08);
    g.fillRoundedRect(x + MUG.x0 - 6, y + MUG.top - 4, MUG.x1 - MUG.x0 + 12, H + 10, GLASS_CORNERS);
    // the fill line: a gold band (GOOD), its brighter middle (PERFECT) and the line itself
    const t = st.target;
    const pulse = st.state === 'pouring' && st.band > 0 ? 0.5 + 0.5 * Math.sin(this.visT / 60) : 0;
    g.fillStyle(0xffd23f, 0.16 + 0.12 * pulse);
    g.fillRect(x + MUG.x0, levelY(t + SHOT.good), MUG.x1 - MUG.x0, H * SHOT.good * 2);
    g.fillStyle(0xffe27a, 0.32 + 0.2 * pulse);
    g.fillRect(x + MUG.x0, levelY(t + SHOT.perfect), MUG.x1 - MUG.x0, H * SHOT.perfect * 2);
    // coffee
    const lv = Math.min(1, st.level);
    if (lv > 0) {
      const top = levelY(lv);
      g.fillStyle(0x5a3521, 1);
      const r = this.coffeeCorners;
      r.bl = r.br = Math.min(12, (y + MUG.bottom - top) / 2);
      g.fillRoundedRect(x + MUG.x0, top, MUG.x1 - MUG.x0, y + MUG.bottom - top, r);
      g.fillStyle(0xc98a4a, 1);
      g.fillRect(x + MUG.x0, top, MUG.x1 - MUG.x0, Math.min(9, y + MUG.bottom - top));
      g.fillStyle(0xe8b87a, 0.9);
      for (let i = 0; i < 5; i++) g.fillCircle(x + MUG.x0 + 10 + i * 15 + Math.sin(this.visT / 200 + i) * 2, top + 4, 2.4);
    }
    // the line on top of the coffee, with arrows on both sides of the glass
    const ly = levelY(t);
    g.lineStyle(4, 0xffe27a, 1);
    g.lineBetween(x + MUG.x0 - 2, ly, x + MUG.x1 + 2, ly);
    g.fillStyle(0xffe27a, 1);
    g.fillTriangle(x + MUG.x0 - 20, ly - 9, x + MUG.x0 - 20, ly + 9, x + MUG.x0 - 7, ly);
    g.fillTriangle(x + MUG.x1 + 20, ly - 9, x + MUG.x1 + 20, ly + 9, x + MUG.x1 + 7, ly);
    // stream into the glass while pouring
    if (st.state === 'pouring') {
      const top = levelY(lv);
      const w = Math.sin(this.visT / 40) * 1.5;
      g.lineStyle(9, 0x4a2a18, 1);
      g.lineBetween(x + w, y + MUG.top - 22, x + w * 0.5, top);
      g.lineStyle(3, 0xb07040, 1);
      g.lineBetween(x + w - 1, y + MUG.top - 22, x + w * 0.5 - 1, top);
    }
    // glass outline and handle
    g.lineStyle(5, 0xffffff, 0.92);
    g.strokeRoundedRect(x + MUG.x0 - 6, y + MUG.top - 4, MUG.x1 - MUG.x0 + 12, H + 10, GLASS_CORNERS);
    g.lineStyle(7, 0xffffff, 0.85);
    g.beginPath();
    g.arc(x + MUG.x1 + 8, y + 4, 24, -Math.PI / 2.4, Math.PI / 2.4, false);
    g.strokePath();
    g.fillStyle(0xffffff, 0.28);
    g.fillRect(x + MUG.x0, y + MUG.top + 6, 7, H - 16);
    if (st.state === 'dump' || st.state === 'refill') {
      g.fillStyle(0x24142f, 0.55);
      g.fillRoundedRect(x - PANEL_W / 2 + 4, y - PANEL_H / 2 + 2, PANEL_W - 8, PANEL_H - 12, 20);
    }
  }

  private drawSwirl(g: Phaser.GameObjects.Graphics, st: Station, x: number, y: number): void {
    g.fillStyle(0x000000, 0.2);
    g.fillCircle(x + 3, y + 6, 78);
    g.fillStyle(0xfff6ec, 1);
    g.fillCircle(x, y, 78);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(x, y, 66);
    g.fillStyle(0xb87a4a, 1);
    g.fillCircle(x, y, 58);
    g.fillStyle(0x6a4028, 1);
    g.fillCircle(x, y, 52);
    const h = Phaser.Math.DegToRad(st.heartAng);
    const good = Phaser.Math.DegToRad(SWIRL.good);
    const perf = Phaser.Math.DegToRad(SWIRL.perfect);
    g.lineStyle(22, 0xff8fc0, 0.55);
    g.beginPath();
    g.arc(x, y, ORBIT_R, h - good, h + good, false);
    g.strokePath();
    g.lineStyle(22, 0xffd0e6, 0.95);
    g.beginPath();
    g.arc(x, y, ORBIT_R, h - perf, h + perf, false);
    g.strokePath();
    // the milk: a trail and the pour point
    const a = Phaser.Math.DegToRad(st.swirlAng);
    g.lineStyle(9, 0xffffff, 0.4);
    g.beginPath();
    g.arc(x, y, ORBIT_R, a - 1.0, a, false);
    g.strokePath();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(x + Math.cos(a) * ORBIT_R, y + Math.sin(a) * ORBIT_R, 11);
    g.lineStyle(3, 0x6a4028, 0.8);
    g.strokeCircle(x + Math.cos(a) * ORBIT_R, y + Math.sin(a) * ORBIT_R, 11);
  }

  private drawArt(g: Phaser.GameObjects.Graphics, st: Station, x: number, y: number): void {
    g.fillStyle(0xfff6ec, 1);
    g.fillCircle(x, y, 78);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(x, y, 66);
    g.fillStyle(0xb87a4a, 1);
    g.fillCircle(x, y, 58);
    g.fillStyle(0x7a4a2c, 1);
    g.fillCircle(x, y, 52);
    g.fillStyle(0xfff8f0, 1);
    if (st.swirl === 'perfect') this.fillHeart(g, x, y + 2, 34);
    else if (st.swirl === 'good') {
      g.fillCircle(x, y, 26);
      g.fillStyle(0x7a4a2c, 1);
      g.fillCircle(x + 6, y - 4, 12);
      g.fillStyle(0xfff8f0, 1);
      g.fillCircle(x + 6, y - 4, 6);
    } else {
      g.fillCircle(x - 14, y + 6, 14);
      g.fillCircle(x + 10, y - 8, 11);
      g.fillCircle(x + 16, y + 14, 8);
    }
    g.lineStyle(5, 0x8bd346, 1);
    g.beginPath();
    g.moveTo(x + 44, y + 54);
    g.lineTo(x + 54, y + 66);
    g.lineTo(x + 76, y + 40);
    g.strokePath();
  }

  private fillHeart(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number): void {
    for (let i = 0; i < HEART_PTS.length; i++) {
      this.scratch[i].x = x + HEART_PTS[i].x * size;
      this.scratch[i].y = y + HEART_PTS[i].y * size;
    }
    g.fillPoints(this.scratch, true);
  }

  /** The order bubble's patience ring: green, then amber, then red and throbbing. */
  private drawRing(st: Station): void {
    const g = st.ring;
    g.clear();
    const cu = st.customer;
    if (!cu || cu.state !== 'waiting' || !st.bubble.visible) return;
    const k = Math.max(0, cu.patience / cu.patienceMax);
    const x = st.bubble.x;
    const y = st.bubble.y - 4;
    const col = k > 0.6 ? 0x8bd346 : k > 0.35 ? 0xffb020 : 0xff5a4a;
    const r = 44 + (k < 0.35 ? Math.sin(this.visT / 70) * 2 : 0);
    g.lineStyle(9, 0x1a0f24, 0.55);
    g.strokeCircle(x, y, r);
    g.lineStyle(7, col, 1);
    g.beginPath();
    g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2, false);
    g.strokePath();
  }

  private floatHeart(x0: number, y0: number, x1: number, y1: number, tint: number, scale: number, delay = 0): void {
    const h = this.hearts.find((o) => !o.visible);
    if (!h) return;
    this.tweens.killTweensOf(h);
    h.setPosition(x0, y0).setTint(tint).setScale(scale * 0.4).setAlpha(0).setVisible(true);
    this.tweens.add({ targets: h, x: x1, y: y1, scale, delay, duration: 800, ease: 'Sine.Out', onStart: () => h.setAlpha(1) });
    this.tweens.add({ targets: h, alpha: 0, delay: delay + 520, duration: 280, onComplete: () => h.setVisible(false) });
  }

  protected override end(): void {
    for (const st of this.stations) {
      st.stream.clear();
      if (st.hint) st.hint.setVisible(false);
      if (st.state === 'pouring') st.state = 'ready';
      if (!['idle', 'celebrate', 'victory'].includes(st.c.current)) st.c.play('idle', { force: true });
      st.c.face(false);
    }
    this.pops.clear();
    super.end();
  }

  // --- CPU -------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const st = this.stations.find((s) => s.p === p);
    if (!st) return;
    const sk = this.skill(p);
    if (st.state === 'ready') {
      if (!st.cpuPlanned) {
        st.cpuPlanned = true;
        st.cpuWait = sk.reaction * (0.7 + Math.random() * 0.8);
        // Release spread by skill: hard lands PERFECT about 4 times in 5, easy under half the time.
        st.cpuRelease = st.target + gauss() * (0.02 + sk.aimNoise * 0.1);
        if (Math.random() < sk.mistake * 0.45) st.cpuRelease += (Math.random() < 0.5 ? -1 : 1) * (0.13 + Math.random() * 0.1);
        st.cpuRelease = Math.min(0.995, st.cpuRelease);
      }
      st.cpuWait -= dt;
      vc.hold('A', false);
      if (st.cpuWait <= 0) vc.tap('A');
      return;
    }
    if (st.state === 'pouring') {
      // Let go on the frame whose level is nearest the aim (so the frame rate doesn't make CPUs late).
      vc.hold('A', st.level + pourRate(this.elapsed) * dt * 0.5 < st.cpuRelease);
      return;
    }
    if (st.state === 'swirl') {
      if (!st.cpuPlanned) {
        st.cpuPlanned = true;
        // When the milk reaches the heart (after the grace moment), give or take a reaction slip.
        const toHeart = ((((st.heartAng - st.swirlAng) % 360) + 360) % 360) / 360;
        let at = st.swirlT + toHeart * st.period;
        if (at < SWIRL_GRACE_MS + 30) at += st.period;
        st.cpuTapAt = at + gauss() * (14 + sk.aimNoise * 105) + (Math.random() < sk.mistake * 0.5 ? st.period * 0.3 : 0);
      }
      vc.hold('A', false);
      // (tap on the frame nearest the aim)
      if (st.swirlT + dt * 0.5 >= st.cpuTapAt) vc.tap('A');
      return;
    }
    vc.hold('A', false);
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.stations.map((st) => ({ slot: st.p.slot, score: st.p.score, label: `${st.p.score} pts · ${st.served} coffee${st.served === 1 ? '' : 's'}` }));
  }

  // --- Baked art and fallbacks -----------------------------------------------------------------
  /** The order bubble: a speech bubble with a steaming pink cup. */
  private bakeBubble(): void {
    const key = 'coffee-bubble';
    if (this.textures.exists(key)) return;
    const W = 96;
    const H = 96;
    const tex = this.textures.createCanvas(key, W, H);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.fillStyle = 'rgba(26,15,36,0.35)';
    ctx.beginPath();
    ctx.arc(49, 47, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(48, 44, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(20, 66);
    ctx.lineTo(12, 88);
    ctx.lineTo(36, 74);
    ctx.fill();
    // cup
    ctx.fillStyle = '#ff8fb8';
    ctx.beginPath();
    ctx.moveTo(30, 40);
    ctx.lineTo(62, 40);
    ctx.lineTo(58, 64);
    ctx.lineTo(34, 64);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ff8fb8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(63, 49, 6, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.fillStyle = '#7a4a2c';
    ctx.fillRect(31, 40, 30, 5);
    ctx.fillStyle = '#ffd6e6';
    ctx.fillRect(30, 66, 34, 4);
    // steam
    ctx.strokeStyle = '#c9b8d8';
    ctx.lineWidth = 3;
    for (const sx of [40, 50]) {
      ctx.beginPath();
      ctx.moveTo(sx, 34);
      ctx.bezierCurveTo(sx - 5, 28, sx + 5, 24, sx, 17);
      ctx.stroke();
    }
    tex.refresh();
  }

  private drawFallbackCafe(): void {
    const g = this.add.graphics().setDepth(-50);
    g.fillStyle(0xffc9da, 1);
    g.fillRect(0, 0, GAME_WIDTH, 520);
    for (let x = 0; x < GAME_WIDTH; x += 100) {
      g.fillStyle(0xfff0e8, 1);
      g.fillRect(x, 0, 50, 520);
    }
    g.fillStyle(0xe2b087, 1);
    g.fillRect(0, 520, GAME_WIDTH, 170);
    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < 20; c++) {
        g.fillStyle((r + c) % 2 ? 0xffd3e0 : 0xfff6ec, 1);
        g.fillRect(c * 100, 690 + r * 37.5, 100, 37.5);
      }
    }
  }

  private drawFallbackCounter(): void {
    const g = this.add.graphics().setDepth(500);
    g.fillStyle(0xfbf8f6, 1);
    g.fillRect(30, 565, 1860, 30);
    g.fillStyle(0xffb8cf, 1);
    g.fillRect(30, 593, 1860, 97);
    g.fillStyle(0xe8b04a, 1);
    g.fillRect(30, 593, 1860, 6);
    g.fillStyle(0x7fd8c4, 1);
    g.fillRect(30, 677, 1860, 13);
  }

  private drawFallbackMachine(x: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics({ x, y: COUNTER_TOP_Y });
    g.fillStyle(0x8fe0cc, 1);
    g.fillRoundedRect(-56, -104, 112, 100, 12);
    g.fillStyle(0xeef0f6, 1);
    g.fillRect(-60, -112, 120, 10);
    g.fillStyle(0xc9ccd6, 1);
    g.fillRect(-30, -2, 50, 8);
    g.fillStyle(0xe6e8ef, 1);
    g.fillRect(-14, -48, 18, 14);
    g.lineStyle(5, 0xe6e8ef, 1);
    g.lineBetween(-5, -112, -5, -160);
    g.fillStyle(0xff4f8b, 1);
    g.fillCircle(-5, -164, 8);
    return g;
  }
}

