import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { animHeadTop, Character } from '../../../characters/Character';
import { GAME_WIDTH, PLAYER_COLORS } from '../../../constants';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../../data/npcs';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { bakeWord, calmMotion, liteCount, WordPops } from '../../../minigames/games/stageKit';
import { kick, shockwave } from '../../../minigames/juice';
import { standOrigin } from '../../../util/spriteUtil';
import { buildBucks, type Buck, FALL_PENALTY_MS, ridesOut, rideLabel, rideScore } from '../rodeoRules';
import { finishSprites, glowTexture, queueSprites, releaseOnShutdown, sparkleTexture, spread, type SpriteFile } from '../showtimeKit';

// --- Layout (side view). The rendered ring (scripts/art/worlds/showtime/mg_rodeo.py) matches these. ---
/** Centre of each pony's padded mat. */
const PONY_Y = 812;
/** Spacing between the ponies for 2, 3 and 4 riders. */
const GAPS: readonly [number, number, number] = [640, 500, 440];
/** The pony sprites (mg_rodeo.py `pony`): the body turns about its pivot, the column top. */
const PONY_KEY = 'showtime-pony';
const FRONT_KEY = 'showtime-pony-front';
const BASE_KEY = 'showtime-pony-base';
const PONY_ANCHOR = { x: 0.5, y: 0.5916 };
const BASE_ANCHOR = { x: 0.5, y: 0.88 };
const PIVOT_DY = -115;
/** The saddle seat, from the pivot with the pony level. */
const SEAT = { dx: -5, dy: -79 };
const RIDER_SCALE = 0.85;
/** How far riders lean with the stick, and how much of the pony's tilt they follow. */
const LEAN_DEG = 20;
const FOLLOW = 0.7;
/** Wind-up tilt, the buck's swing the other way, and how long the buck plays out. */
const TIP_DEG = 15;
const SNAP_DEG = 27;
const SNAP_MS = 480;
/** The telegraph arrow beside each rider. */
const ARROW_DX = 176;
const ARROW_Y = 452;
/** A thrown rider: flight, time on the mat seeing stars, and the hop back on. */
const FLY_MS = 420;
const DOWN_MS = 1250;
const CLIMB_MS = 700;
/** Bleacher feet lines (the crowd) and the disco ball. */
const CROWD_ROWS = [
  { y: 548, scale: 0.36, n: 14, depth: -18 },
  { y: 470, scale: 0.3, n: 12, depth: -22 },
];
const DISCO = { x: 960, y: 200 };

const SPRITES: readonly SpriteFile[] = [
  [PONY_KEY, 'showtime_pony'],
  [FRONT_KEY, 'showtime_pony_front'],
  [BASE_KEY, 'showtime_pony_base'],
];

const WORDS = {
  steady: { key: 'rodeo-w-steady', text: 'STEADY!', size: 38, fill: ['#ffffff', '#ffb3d9'] as const },
  combo: { key: 'rodeo-w-combo', text: 'WHAT A RIDE!', size: 44, fill: ['#fffbd0', '#ff7ab8'] as const },
  whoa: { key: 'rodeo-w-whoa', text: 'WHOA!', size: 44, fill: ['#ffe2d6', '#ff6b5e'] as const },
  penalty: { key: 'rodeo-w-pen', text: `-${FALL_PENALTY_MS / 1000}s`, size: 36, fill: ['#ffe2d6', '#ff6b5e'] as const },
  back: { key: 'rodeo-w-back', text: 'BACK ON!', size: 34, fill: ['#ffffff', '#aeefff'] as const },
};

type RiderState = 'riding' | 'thrown' | 'down' | 'climb';

interface Rider {
  p: MgPlayer;
  c: Character;
  x: number;
  hip: number;
  badgeY: number;
  body: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  front: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics | null;
  base: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  rosette: Phaser.GameObjects.Image;
  gems: Phaser.GameObjects.Image[];
  arrow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics;
  state: RiderState;
  t: number;
  /** Stick lean, smoothed for the picture (the rules read the raw stick). */
  lean: number;
  /** The pony's tilt (deg) and bounce this frame. */
  tilt: number;
  bounce: number;
  /** Bucks from this index on count for this rider (they were off the pony for earlier ones). */
  from: number;
  saddleMs: number;
  falls: number;
  steady: number;
  comboRun: number;
  fallFrom: { x: number; y: number };
  fallTo: { x: number; y: number };
  // CPU plan for the buck it is reacting to
  cpuFor: number;
  cpuAt: number;
  cpuDir: number;
  cpuWobble: number;
}

interface Fan {
  spr: Phaser.GameObjects.Sprite;
  id: NpcId;
  y: number;
  phase: number;
  gaspT: number;
  cheerT: number;
}

const FANS: readonly NpcId[] = ['ora', 'pipper', 'packsprout', 'wrench', 'mimi'];
const CHEER: Record<NpcId, string> = { ora: 'cheer', pipper: 'happy', packsprout: 'cheer', wrench: 'laugh', mimi: 'happy' };
const GASP: Record<NpcId, string> = { ora: 'point', pipper: 'point', packsprout: 'surprised', wrench: 'surprised', mimi: 'surprised' };

function ease(u: number): number {
  return u * u * (3 - 2 * u);
}

/**
 * Rhinestone Rodeo — sparkly mechanical ponies in a pink honky-tonk ring. Every buck is telegraphed:
 * the pony winds up tipping one way (an arrow shows it); lean that way with the stick before it
 * bucks, or you're thrown and lose time climbing back on. Every pony bucks to the same schedule,
 * wilder as the round goes on. The longest ride after 45 seconds wins.
 */
export class RhinestoneRodeoScene extends BaseMinigame {
  private bucks: Buck[] = [];
  private riders: Rider[] = [];
  /** Index of the next buck to snap. */
  private nextSnap = 0;
  private cueIdx = -1;
  private cueStep = 0;
  private fans: Fan[] = [];
  private spots: { img: Phaser.GameObjects.Image; a: number; r: number; speed: number; cy: number }[] = [];
  private glints: Phaser.GameObjects.Image[] = [];
  private pops!: WordPops;
  private wild = false;
  private visT = 0;
  private seatPt = { x: 0, y: 0 };

  constructor() {
    super('mg-rhinestone-rodeo');
  }

  preload(): void {
    queueSprites(this, SPRITES);
  }

  // --- Setup -----------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = 45000;
    this.bucks = buildBucks(this.launch.seed);
    this.riders = [];
    this.nextSnap = 0;
    this.cueIdx = -1;
    this.cueStep = 0;
    this.fans = [];
    this.spots = [];
    this.glints = [];
    this.wild = false;
    this.visT = 0;
    finishSprites(this, SPRITES);
    releaseOnShutdown(this, SPRITES);
    for (const w of Object.values(WORDS)) bakeWord(this, w.key, w.text, { size: w.size, fill: w.fill });
    glowTexture(this);
    sparkleTexture(this);
    this.bakeArrow();
    this.bakeRosette();
    const sky = ['rendered-sky-sunset', 'rendered-sky-dusk', 'rendered-sky-golden'].find((k) => this.textures.exists(k));
    if (sky) this.add.image(GAME_WIDTH / 2, 470, sky).setDisplaySize(GAME_WIDTH * 1.04, 1170).setDepth(-100).setTint(0xffe0ee);
    if (this.textures.exists('rendered-scene-showtime_rodeo')) this.add.image(0, 0, 'rendered-scene-showtime_rodeo').setOrigin(0).setDepth(-50);
    else this.drawFallbackRing();
    this.buildCrowd();
    this.buildDisco();
    this.pops = new WordPops(this, 8700, 20);
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const x = spread(this.players.length, GAPS)[index];
    const color = PLAYER_COLORS[p.slot];
    const d = 700 + index * 0.5;
    const hasArt = this.textures.exists(PONY_KEY);
    const base = hasArt && this.textures.exists(BASE_KEY) ? this.add.image(x, PONY_Y, BASE_KEY).setOrigin(BASE_ANCHOR.x, BASE_ANCHOR.y) : this.fallbackBase(x);
    base.setDepth(d);
    // The rider's colour on the mat (a ring) and on the pony (a rosette); their shape rides on their badge.
    const ringG = this.add.graphics().setDepth(d + 0.01);
    ringG.lineStyle(6, color, 0.95);
    ringG.strokeEllipse(x, PONY_Y + 2, 300, 72);
    ringG.lineStyle(2, 0xffffff, 0.8);
    ringG.strokeEllipse(x, PONY_Y + 2, 312, 78);
    const body = hasArt ? this.add.image(x, PONY_Y + PIVOT_DY, PONY_KEY).setOrigin(PONY_ANCHOR.x, PONY_ANCHOR.y) : this.fallbackPony(x, false);
    body.setDepth(d + 0.1);
    const front = hasArt ? (this.textures.exists(FRONT_KEY) ? this.add.image(x, PONY_Y + PIVOT_DY, FRONT_KEY).setOrigin(PONY_ANCHOR.x, PONY_ANCHOR.y) : null) : this.fallbackPony(x, true);
    front?.setDepth(d + 0.3);
    const rosette = this.add.image(x, PONY_Y, 'rodeo-rosette').setTint(color).setDepth(d + 0.35);
    const c = new Character(this, x, PONY_Y - 40, p.characterId, { scale: RIDER_SCALE, slot: p.slot });
    c.setDepth(d + 0.2);
    c.hold('balance', 0);
    p.character = c;
    const gems: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < liteCount(4); i++) gems.push(this.add.image(x, PONY_Y, 'showtime-sparkle').setBlendMode(Phaser.BlendModes.ADD).setDepth(d + 0.36).setAlpha(0));
    const arrow = this.add.image(x, ARROW_Y, 'rodeo-arrow').setVisible(false).setDepth(8300);
    const ring = this.add.graphics().setDepth(8301);
    const top = animHeadTop(p.characterId, 'balance');
    this.riders.push({
      p,
      c,
      x,
      hip: -top * 0.42 * RIDER_SCALE,
      badgeY: top - 46,
      body,
      front,
      base,
      rosette,
      gems,
      arrow,
      ring,
      state: 'riding',
      t: 0,
      lean: 0,
      tilt: 0,
      bounce: 0,
      from: 0,
      saddleMs: 0,
      falls: 0,
      steady: 0,
      comboRun: 0,
      fallFrom: { x, y: 0 },
      fallTo: { x, y: 0 },
      cpuFor: -1,
      cpuAt: 0,
      cpuDir: 0,
      cpuWobble: 0,
    });
  }

  protected override bannerY(): number {
    return 330;
  }

  protected override onStart(): void {
    audio.play('bounce', { volume: 0.4 });
  }

  /** The wild ride: the last ten seconds buck fastest. */
  protected override onFinalStretch(): void {
    this.wild = true;
    this.showFinalStretch('WILD RIDE!');
    audio.play('crowdRoar', { volume: 0.6 });
    for (const f of this.fans) f.cheerT = 1200;
  }

  // --- The ride --------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.visT += dt;
    const now = this.elapsed;
    // Shared cues (every pony bucks together): a swish as a wind-up starts, rising pips, the buck.
    this.cues(now);
    while (this.nextSnap < this.bucks.length && this.bucks[this.nextSnap].snapAt <= now) {
      this.snap(this.nextSnap);
      this.nextSnap++;
    }
    for (const r of this.riders) {
      const stick = Phaser.Math.Clamp(r.p.controls.moveX, -1, 1);
      r.lean += (stick - r.lean) * (1 - Math.exp(-dt / 70));
      if (r.state === 'riding') r.saddleMs += dt;
      else this.updateFall(r, dt);
      r.p.score = rideScore(r.saddleMs, r.falls);
    }
  }

  /** Wind-up cues, once for everyone (the schedule is shared). */
  private cues(now: number): void {
    const i = this.nextSnap;
    const b = this.bucks[i];
    if (!b || now < b.windAt) return;
    if (this.cueIdx !== i) {
      this.cueIdx = i;
      this.cueStep = 0;
      audio.play('sweep', { volume: b.combo ? 0.18 : 0.3, throttleMs: 60 });
    }
    const u = (now - b.windAt) / (b.snapAt - b.windAt);
    const marks = [0.3, 0.6, 0.85];
    if (this.cueStep < marks.length && u >= marks[this.cueStep]) {
      audio.play('warn', { rate: 1 + this.cueStep * 0.18, volume: 0.3, throttleMs: 40 });
      this.cueStep++;
    }
  }

  /** The buck: everyone on board who leans the way their pony tipped rides it out; the rest are thrown. */
  private snap(i: number): void {
    const b = this.bucks[i];
    audio.play('bounce', { volume: 0.4, rate: 0.9, throttleMs: 40 });
    audio.play('land', { volume: 0.5, throttleMs: 40 });
    let thrown = 0;
    let steadyHuman = false;
    for (const r of this.riders) {
      if (r.state !== 'riding' || i < r.from) continue;
      if (ridesOut(r.p.controls.moveX, b.dir)) {
        r.steady++;
        r.comboRun = b.combo > 0 ? r.comboRun + 1 : 1;
        const endOfCombo = !this.bucks[i + 1] || this.bucks[i + 1].combo === 0;
        const big = endOfCombo && r.comboRun >= 2;
        this.pops.pop(big ? WORDS.combo.key : WORDS.steady.key, r.x, ARROW_Y - 90, { rise: big ? 40 : 26, hold: big ? 560 : 300, owner: r.p.slot, tilt: b.dir * -6 });
        this.fx.sparks(r.x + SEAT.dx, PONY_Y + PIVOT_DY + SEAT.dy - 40, liteCount(big ? 16 : 8));
        if (big) {
          shockwave(this, r.x, PONY_Y, { radius: 190, ratio: 0.28, color: 0xff7ab8, alpha: 0.8, duration: 420, depth: 699 });
          for (const f of this.fans) if (Math.abs(f.spr.x - r.x) < 420) f.cheerT = 700;
          audio.play('cheer', { volume: 0.3, throttleMs: 600 });
        }
        if (!r.p.isCpu) {
          steadyHuman = true;
          this.rumble(r.p, 0.25, 0.35, 90);
        }
      } else {
        this.throwOff(r, b.dir);
        thrown++;
      }
    }
    if (steadyHuman) audio.play('nearMiss', { rate: 1.05, volume: 0.45, throttleMs: 60 });
    if (thrown > 0) for (const f of this.fans) f.gaspT = 600;
  }

  private throwOff(r: Rider, dir: number): void {
    r.state = 'thrown';
    r.t = FLY_MS;
    r.falls++;
    r.comboRun = 0;
    // Thrown the way the buck went (the opposite of its wind-up).
    const side = -dir;
    const seat = this.seatPoint(r);
    r.fallFrom.x = seat.x;
    r.fallFrom.y = seat.y + r.hip;
    r.fallTo.x = r.x + side * 175;
    r.fallTo.y = PONY_Y + 44;
    r.c.play('fall', { force: true });
    r.c.face(side < 0);
    r.c.setDepth(705 + r.x * 0.0001);
    r.arrow.setVisible(false);
    r.ring.clear();
    this.pops.pop(WORDS.whoa.key, seat.x, ARROW_Y - 90, { rise: 30, hold: 380, owner: r.p.slot, tilt: side * 8 });
    audio.play('hit', { volume: 0.5, throttleMs: 50 });
    audio.play('whoosh', { volume: 0.4, throttleMs: 50 });
    if (!r.p.isCpu) {
      this.rumble(r.p, 0.6, 0.5, 220);
      kick(this, side * 10, -4, 160);
    }
  }

  private updateFall(r: Rider, dt: number): void {
    r.t -= dt;
    if (r.state === 'thrown') {
      const u = 1 - Math.max(0, r.t) / FLY_MS;
      const x = r.fallFrom.x + (r.fallTo.x - r.fallFrom.x) * u;
      const y = r.fallFrom.y + (r.fallTo.y - r.fallFrom.y) * u - Math.sin(u * Math.PI) * 110;
      r.c.setPosition(x, y);
      r.c.sprite.setAngle((r.fallTo.x > r.fallFrom.x ? 1 : -1) * 320 * u);
      this.placeBadge(r, 0);
      if (r.t <= 0) {
        r.state = 'down';
        r.t = DOWN_MS;
        r.c.sprite.setAngle(0);
        r.c.setPosition(r.fallTo.x, r.fallTo.y);
        r.c.play('stunned', { force: true, returnTo: 'stunned' });
        this.fx.vfx('dust', r.fallTo.x, r.fallTo.y, { scale: 0.4, duration: 420, alpha: 0.8, depth: 706 });
        this.fx.vfx('pinkSwirl', r.fallTo.x, r.fallTo.y - 20, { scale: 0.35, duration: 460, blend: 'add', alpha: 0.7, depth: 706 });
        audio.play('stamp', { volume: 0.35, throttleMs: 50 });
        this.pops.pop(WORDS.penalty.key, r.fallTo.x, r.fallTo.y - 150, { rise: 36, hold: 420, owner: 10 + r.p.slot });
        this.bumpHud(r.p.slot);
      }
    } else if (r.state === 'down') {
      if (r.t <= 0) {
        r.state = 'climb';
        r.t = CLIMB_MS;
        r.c.play('jump', { force: true });
        audio.play('jump', { volume: 0.35, throttleMs: 50 });
      }
    } else if (r.state === 'climb') {
      const u = 1 - Math.max(0, r.t) / CLIMB_MS;
      const seat = this.seatPoint(r);
      const x = r.fallTo.x + (seat.x - r.fallTo.x) * ease(u);
      const y = r.fallTo.y + (seat.y + r.hip - r.fallTo.y) * ease(u) - Math.sin(u * Math.PI) * 120;
      r.c.setPosition(x, y);
      this.placeBadge(r, 0);
      if (r.t <= 0) {
        r.state = 'riding';
        r.c.face(false);
        r.c.hold('balance', 0);
        r.c.setDepth(700 + this.riders.indexOf(r) * 0.5 + 0.2);
        // Bucks whose wind-up already began don't count for them.
        let j = this.nextSnap;
        while (j < this.bucks.length && this.bucks[j].windAt < this.elapsed) j++;
        r.from = j;
        this.pops.pop(WORDS.back.key, seat.x, ARROW_Y - 90, { rise: 24, hold: 300, owner: r.p.slot });
        audio.play('confirm', { volume: 0.3, throttleMs: 80 });
      }
    }
  }

  // --- Pony motion -----------------------------------------------------------------------------
  /** The pony's tilt and bounce from the shared schedule (a rider who is off just gets the idle rock). */
  private ponyMotion(r: Rider): void {
    const now = this.elapsed;
    const rock = (calmMotion() ? 1.5 : 3) * Math.sin(this.visT / 190);
    let tilt = rock;
    let bounce = Math.abs(Math.sin(this.visT / 190)) * -3;
    if (r.state === 'riding' && this.phase === 'playing') {
      const i = this.nextSnap;
      const b = this.bucks[i];
      const prev = this.bucks[i - 1];
      let t = 0;
      let moving = false;
      // The last buck's swing the other way, recoiling with a wobble...
      if (prev && i - 1 >= r.from && now < prev.snapAt + SNAP_MS) {
        const v = (now - prev.snapAt) / SNAP_MS;
        const k = v < 0.18 ? v / 0.18 : Math.exp(-5 * (v - 0.18)) * Math.cos(11 * (v - 0.18));
        t += -prev.dir * SNAP_DEG * k;
        bounce = -26 * Math.max(0, Math.sin(Math.min(1, v * 2.2) * Math.PI));
        moving = true;
      }
      // ...plus the next one winding up: tipping its way, buzzing harder as it nears the buck.
      if (b && i >= r.from && now >= b.windAt) {
        const u = Math.min(1, (now - b.windAt) / (b.snapAt - b.windAt));
        t += b.dir * TIP_DEG * ease(u) + Math.sin(now / 11) * 2.2 * u * u;
        bounce = Math.min(bounce, 6 * ease(u));
        moving = true;
      }
      if (moving) tilt = t + rock * 0.2;
    }
    r.tilt = tilt;
    r.bounce = bounce;
  }

  /** Where a rider's saddle seat is this frame (written into a reused point: called every frame). */
  private seatPoint(r: Rider): { x: number; y: number } {
    const a = Phaser.Math.DegToRad(r.tilt);
    const px = r.x;
    const py = PONY_Y + PIVOT_DY + r.bounce;
    const out = this.seatPt;
    out.x = px + SEAT.dx * Math.cos(a) - SEAT.dy * Math.sin(a);
    out.y = py + SEAT.dx * Math.sin(a) + SEAT.dy * Math.cos(a);
    return out;
  }

  /** Keep the player badge over the head whatever the lean. */
  private placeBadge(r: Rider, angDeg: number): void {
    const a = Phaser.Math.DegToRad(angDeg);
    r.c.marker?.setPosition(-r.badgeY * Math.sin(a), r.badgeY * Math.cos(a));
  }

  private syncRiders(): void {
    const now = this.elapsed;
    const b = this.bucks[this.nextSnap];
    for (const r of this.riders) {
      this.ponyMotion(r);
      const py = PONY_Y + PIVOT_DY + r.bounce;
      r.body.setPosition(r.x, py).setAngle(r.tilt);
      r.front?.setPosition(r.x, py).setAngle(r.tilt);
      const a = Phaser.Math.DegToRad(r.tilt);
      const rx = 92;
      const ry = -52;
      r.rosette.setPosition(r.x + rx * Math.cos(a) - ry * Math.sin(a), py + rx * Math.sin(a) + ry * Math.cos(a)).setAngle(r.tilt);
      for (let i = 0; i < r.gems.length; i++) {
        const g = r.gems[i];
        const ph = (this.visT / 700 + i * 0.37) % 1;
        const ox = -80 + ((i * 53) % 160);
        const oy = -30 + ((i * 29) % 40);
        g.setPosition(r.x + ox * Math.cos(a) - oy * Math.sin(a), py + ox * Math.sin(a) + oy * Math.cos(a)).setAlpha(ph < 0.2 ? Math.sin((ph / 0.2) * Math.PI) : 0).setScale(0.35 + 0.2 * Math.sin(ph * 9));
      }
      if (r.state === 'riding') {
        const seat = this.seatPoint(r);
        const ang = r.tilt * FOLLOW + r.lean * LEAN_DEG;
        const t = Phaser.Math.DegToRad(ang);
        r.c.setPosition(seat.x - r.hip * Math.sin(t) * 1, seat.y + r.hip * Math.cos(t));
        r.c.sprite.setAngle(ang);
        this.placeBadge(r, ang);
      } else {
        this.placeBadge(r, 0);
      }
      // The telegraph: an arrow on the side the pony tips, with a ring closing on the buck.
      const cue = r.state === 'riding' && this.phase === 'playing' && b && this.nextSnap >= r.from && now >= b.windAt;
      if (cue && b) {
        const u = Math.min(1, (now - b.windAt) / (b.snapAt - b.windAt));
        const ax = r.x + b.dir * ARROW_DX;
        const beat = 0.5 + 0.5 * Math.sin((now - b.windAt) / (60 + 120 * (1 - u)));
        r.arrow.setVisible(true).setPosition(ax, ARROW_Y).setFlipX(b.dir < 0).setScale((0.9 + 0.12 * beat) * (u > 0.8 ? 1.1 : 1)).setTint(u > 0.78 && beat > 0.5 ? 0xffffff : 0xffc2e0);
        const g = r.ring;
        g.clear();
        g.lineStyle(8, 0x2a1030, 0.45);
        g.strokeCircle(ax, ARROW_Y, 56);
        g.lineStyle(6, u > 0.78 ? 0xffffff : 0xff5fa8, 1);
        g.beginPath();
        g.arc(ax, ARROW_Y, 56, -Math.PI / 2, -Math.PI / 2 + (1 - u) * Math.PI * 2, false);
        g.strokePath();
      } else if (r.arrow.visible) {
        r.arrow.setVisible(false);
        r.ring.clear();
      }
    }
  }

  // --- Crowd and lights ------------------------------------------------------------------------
  private buildCrowd(): void {
    for (const row of CROWD_ROWS) {
      for (let k = 0; k < row.n; k++) {
        const id = FANS[(k * 3 + row.n) % FANS.length];
        const x = 150 + (k + 0.5) * ((1620) / row.n) + ((k * 37) % 25) - 12;
        const frame = npcFrame(id, 'idle');
        const spr = this.add.sprite(x, row.y, NPC_ATLAS, frame);
        const o = standOrigin(NPC_ATLAS, frame);
        spr.setOrigin(o.x, o.y).setScale(row.scale).setDepth(row.depth + k * 0.001).setFlipX(x > 960);
        if (row.depth < -20) spr.setTint(0xf2e4ee);
        this.fans.push({ spr, id, y: row.y, phase: ((k * 53) % 11) / 11, gaspT: 0, cheerT: 0 });
      }
    }
  }

  private syncCrowd(dt: number): void {
    const calm = calmMotion();
    for (const f of this.fans) {
      f.gaspT = Math.max(0, f.gaspT - dt);
      f.cheerT = Math.max(0, f.cheerT - dt);
      const pose = f.gaspT > 0 ? GASP[f.id] : f.cheerT > 0 || this.wild ? CHEER[f.id] : 'idle';
      const frame = npcFrame(f.id, pose);
      if (f.spr.frame.name !== frame) {
        f.spr.setFrame(frame);
        const o = standOrigin(NPC_ATLAS, frame);
        f.spr.setOrigin(o.x, o.y);
      }
      const hop = calm ? 0 : f.cheerT > 0 ? Math.abs(Math.sin(this.visT / 110 + f.phase * 6)) * 10 : Math.abs(Math.sin(this.visT / 420 + f.phase * 6)) * 2;
      f.spr.y = f.y - hop;
    }
  }

  /** The disco ball's glints and the spots of light it throws across the ring and the crowd. */
  private buildDisco(): void {
    const n = liteCount(10);
    const tints = [0xff9ed0, 0xffffff, 0x9ff0ff, 0xffe39a];
    for (let i = 0; i < n; i++) {
      const img = this.add.image(0, 0, 'showtime-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(tints[i % tints.length]).setAlpha(0.22).setDepth(i % 2 ? -12 : 699);
      img.setDisplaySize(90, 34);
      this.spots.push({ img, a: (i / n) * Math.PI * 2, r: 380 + (i % 3) * 230, speed: 0.00022 + (i % 4) * 0.00004, cy: i % 2 ? 520 : 880 });
    }
    for (let i = 0; i < liteCount(4); i++) this.glints.push(this.add.image(DISCO.x, DISCO.y, 'showtime-sparkle').setBlendMode(Phaser.BlendModes.ADD).setDepth(-11).setAlpha(0));
  }

  private syncDisco(dt: number): void {
    const k = this.wild ? 2.2 : 1;
    for (const s of this.spots) {
      s.a += s.speed * dt * k * (calmMotion() ? 0.3 : 1);
      const x = DISCO.x + Math.cos(s.a) * s.r * 1.25;
      const y = s.cy + Math.sin(s.a) * (s.cy > 700 ? 110 : 50);
      s.img.setPosition(x, y).setAlpha(this.wild ? 0.32 : 0.2);
    }
    for (let i = 0; i < this.glints.length; i++) {
      const g = this.glints[i];
      const ph = (this.visT / 600 + i * 0.27) % 1;
      if (ph < 0.02) g.setPosition(DISCO.x + (Math.random() - 0.5) * 70, DISCO.y + (Math.random() - 0.5) * 70);
      g.setAlpha(ph < 0.25 ? Math.sin((ph / 0.25) * Math.PI) : 0).setScale(0.5 + ph);
    }
  }

  protected override ambient(dt: number): void {
    this.syncRiders();
    this.syncCrowd(dt);
    this.syncDisco(dt);
  }

  protected override end(): void {
    for (const r of this.riders) {
      r.arrow.setVisible(false);
      r.ring.clear();
      // Riders still in the saddle can celebrate there (the finish plays a victory from idle).
      if (r.state === 'riding') r.c.play('idle', { force: true });
    }
    this.pops.clear();
    super.end();
  }

  // --- CPU -------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const r = this.riders.find((x) => x.p === p);
    if (!r) return;
    if (r.state !== 'riding') {
      vc.setMove(0, 0);
      return;
    }
    const sk = this.skill(p);
    const now = this.elapsed;
    const i = this.nextSnap;
    const b = this.bucks[i];
    r.cpuWobble += dt;
    if (b && i >= r.from && now >= b.windAt) {
      if (r.cpuFor !== i) {
        r.cpuFor = i;
        // React after a moment (a combo's quick follow-up leaves less time), sometimes misreading it.
        r.cpuAt = b.windAt + sk.reaction * (0.75 + Math.random() * 0.5);
        const roll = Math.random();
        r.cpuDir = roll < sk.mistake * 0.55 ? -b.dir : roll < sk.mistake ? 0 : b.dir;
      }
      if (now >= r.cpuAt) vc.setMove(r.cpuDir * (0.85 + Math.random() * 0.1), 0);
      else vc.setMove(0.12 * Math.sin(r.cpuWobble / 300), 0);
      return;
    }
    // Between bucks: settle back upright (holding a lean for a moment after the buck).
    const prev = this.bucks[i - 1];
    if (prev && now < prev.snapAt + 160) return;
    vc.setMove(0.15 * Math.sin(r.cpuWobble / 350), 0);
  }

  protected override hudLabel(p: MgPlayer): string {
    return rideLabel(p.score);
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.riders.map((r) => {
      const s = rideScore(r.saddleMs, r.falls);
      return { slot: r.p.slot, score: s, label: `${(s / 1000).toFixed(1)}s in the saddle · ${r.falls} fall${r.falls === 1 ? '' : 's'}` };
    });
  }

  // --- Baked art and fallbacks -----------------------------------------------------------------
  /** A chunky rhinestone chevron pointing right (flipped for left), white so it can be tinted. */
  private bakeArrow(): void {
    const key = 'rodeo-arrow';
    if (this.textures.exists(key)) return;
    const W = 120;
    const H = 110;
    const tex = this.textures.createCanvas(key, W, H);
    if (!tex) return;
    const ctx = tex.getContext();
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(10, 32);
      ctx.lineTo(62, 32);
      ctx.lineTo(62, 10);
      ctx.lineTo(110, 55);
      ctx.lineTo(62, 100);
      ctx.lineTo(62, 78);
      ctx.lineTo(10, 78);
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    path();
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#3a1030';
    ctx.stroke();
    const g = ctx.createLinearGradient(0, 10, 0, 100);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#ffe0f0');
    g.addColorStop(1, '#ffb8dc');
    path();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    for (const [x, y] of [
      [24, 55],
      [42, 55],
      [60, 55],
      [78, 55],
      [94, 55],
      [70, 34],
      [70, 76],
    ]) {
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    tex.refresh();
  }

  /** A ribbon rosette (white, tinted with the rider's colour). */
  private bakeRosette(): void {
    const key = 'rodeo-rosette';
    if (this.textures.exists(key)) return;
    const S = 64;
    const tex = this.textures.createCanvas(key, S, S);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.fillStyle = '#e8e8e8';
    ctx.beginPath();
    ctx.moveTo(26, 34);
    ctx.lineTo(18, 62);
    ctx.lineTo(28, 56);
    ctx.lineTo(32, 36);
    ctx.moveTo(38, 34);
    ctx.lineTo(46, 62);
    ctx.lineTo(36, 56);
    ctx.lineTo(32, 36);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 ? 17 : 21;
      const x = 32 + Math.cos(a) * r;
      const y = 26 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,20,40,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath();
    ctx.arc(32, 26, 8, 0, Math.PI * 2);
    ctx.fill();
    tex.refresh();
  }

  private drawFallbackRing(): void {
    const g = this.add.graphics().setDepth(-50);
    g.fillGradientStyle(0xff9ec8, 0xff9ec8, 0xffd2a8, 0xffd2a8, 1);
    g.fillRect(0, 0, GAME_WIDTH, 560);
    g.fillStyle(0xf3cfb2, 1);
    g.fillRect(0, 560, GAME_WIDTH, 520);
    g.fillStyle(0xfff4e8, 1);
    for (let x = 40; x < GAME_WIDTH; x += 140) g.fillRect(x - 10, 540, 20, 125);
    g.fillStyle(0xff7ab8, 1);
    g.fillRect(0, 575, GAME_WIDTH, 14);
    g.fillRect(0, 625, GAME_WIDTH, 14);
  }

  private fallbackBase(x: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics({ x, y: PONY_Y });
    g.fillStyle(0xffb3d4, 1);
    g.fillEllipse(0, 0, 320, 80);
    g.fillStyle(0xf2c14e, 1);
    g.fillRect(-8, PIVOT_DY, 16, -PIVOT_DY);
    return g;
  }

  private fallbackPony(x: number, frontOnly: boolean): Phaser.GameObjects.Graphics {
    const g = this.add.graphics({ x, y: PONY_Y + PIVOT_DY });
    g.fillStyle(0xff9ccb, 1);
    g.fillEllipse(0, -34, 224, 90);
    if (!frontOnly) {
      g.fillEllipse(128, -120, 90, 44);
      g.fillStyle(0xff9ccb, 1);
      g.fillTriangle(80, -60, 120, -140, 150, -100);
      g.fillStyle(0xfff8fb, 1);
      g.fillCircle(-112, -40, 18);
    }
    g.fillStyle(0xffffff, 1);
    g.fillEllipse(-5, -78, 90, 22);
    return g;
  }
}
