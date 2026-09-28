import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { GAME_WIDTH, PLAYER_COLORS } from '../../../constants';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { flashScreen, kick, popToHud, shockwave, titleTexture, type HudPop } from '../../../minigames/juice';
import { AFX, ensureArenaFxTextures } from '../../../minigames/games/arenaFx';
import { bakeWord, calmMotion, liteCount, WordPops } from '../../../minigames/games/stageKit';
import { LITE } from '../../../perf';
import { PlayerBadge } from '../../../ui/PlayerBadge';
import { finishDojoSprites, queueDojoSprites, DOJO_SPRITES, type DojoSprite } from '../dojoArt';
import { burstPower, COURSE, courseSpeed, nextPattern, PERFECT_BONUS, PERFECT_MIN, resolveBump, ringsLost, WORTH, type CoursePattern } from './cloudRiderRules';

const SPRITES: DojoSprite[] = ['cloud', 'ring', 'orb', 'storm'];
/** Where riders cruise, and how far forward / back they can be. */
const CRUISE_X = 470;
const MIN_X = 240;
const MAX_X = 1160;
/** Cloud-centre limits (screen y). */
const TOP = 250;
const BOTTOM = 870;
/** The body's hit centre sits this far above the cloud's centre (rings are collected there). */
const HIT_DY = -52;
const MAX_VY = 640;
const STEER = 9;
/** Burst: charge time, speed, how long the rider rams for, and the pause before the next charge. */
const CHARGE_MS = 800;
const BURST_V = 1750;
const RAM_MIN = 260;
const RAM_MAX = 560;
const RECHARGE_MS = 1050;
/** The spring back to the cruise line and the damping of forward speed. */
const X_DAMP = 3.2;
const X_SPRING = 2.6;
const DIZZY_BUMP = 720;
const DIZZY_ZAP = 900;
const GUARD_BUMP = 1000;
const GUARD_ZAP = 1300;
/** Riders touch within this distance (between hit centres). */
const RIDER_R = 58;
const STORM_RX = 150;
const STORM_RY = 76;
/** Wind gusts: warning, then blowing; the speed they push riders at. */
const GUST_WARN = 1300;
const GUST_BLOW = 2100;
const GUST_V = 390;
const CLOUD_SCALE = 0.68;
const CHAR_SCALE = 0.56;
/** A rider's feet sit this far above the cloud's centre. */
const FEET_DY = -24;
/** Radius of the charge gauge round a rider. */
const GAUGE_R = 70;
const RING_SCALE = 0.78;
const ORB_SCALE = 0.72;
const STORM_SCALE = 0.86;
/** Parallax strips (screen y of their top edge, scroll factor against the course). */
const PEAKS_Y = 380;
const PEAKS_K = 0.3;
const NEAR_Y = 780;
const NEAR_K = 1.35;
/** Depth bands. */
const D_STORM = 300;
const D_RING_BACK = 500;
const D_ORB = 550;
const D_RIDER = 1000;
const D_RING_FRONT = 1600;
const D_LOOSE = 1650;
const D_GUST = 1700;
const D_WARN = 3000;
const D_NEAR = 3500;
const D_SPEED = 3600;
const POP_WHITE = '#ffffff';
const POP_GOLD = '#ffe36b';
const POP_ORB = '#bff4ff';
const POP_SIZE = 58;

interface Rider {
  p: MgPlayer;
  c: Character;
  cloud: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  aura: Phaser.GameObjects.Image;
  gauge: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  charging: boolean;
  charge: number;
  /** Charge milestones already chimed (quarters). */
  chimes: number;
  ramT: number;
  recharge: number;
  dizzy: number;
  guard: number;
  bob: number;
  streak: number;
  lastRing: number;
  pop?: { h: HudPop; value: number; color: string };
  popN: number;
  popAt: number;
  ghostT: number;
  pose: string;
  /** Gust push on this rider this frame (for its visual lean). */
  gustV: number;
  /** The height it started at (CPUs keep loosely to their own lane, so the riders spread out). */
  home: number;
  /** CPUs: no new ram attempt before this (game ms). */
  nextRam: number;
}

type ItemKind = 'ring' | 'orb' | 'loose';

interface Item {
  kind: ItemKind;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Loose rings can't be caught until this runs out, and vanish when `life` does. */
  wait: number;
  life: number;
  trail: number;
  phase: number;
  img: Phaser.GameObjects.Image;
  back?: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;
  rays?: Phaser.GameObjects.Image;
}

interface Storm {
  active: boolean;
  /** The warning badge at the right edge: up, fading out as the cloud rolls in, or gone. */
  warning: 'on' | 'fading' | 'off';
  x: number;
  y: number;
  phase: number;
  flick: number;
  img: Phaser.GameObjects.Image;
  warn: Phaser.GameObjects.Container;
  /** When (game ms) it was first warned about (CPUs react after their reaction time). */
  seenAt: number;
}

interface Gust {
  y: number;
  half: number;
  dir: -1 | 1;
  /** Game ms when it starts blowing. */
  at: number;
  state: 'wait' | 'warn' | 'blow' | 'done';
  t: number;
}

interface Trail {
  total: number;
  taken: number;
  /** Slot that has taken all of its rings so far (-1 mixed, -2 none yet). */
  by: number;
  missed: boolean;
}

/**
 * Cloud Rider — everyone surfs a little golden cloud through a sky course between the peaks. Steer up
 * and down through ring trails (+1) and energy orbs (+3); hold A to charge and let go to burst ahead,
 * ramming rivals knocks rings loose. Storm clouds zap and wind gusts shove, both announced first. The
 * last ten seconds are a ring rush. Most rings after 45 seconds wins.
 */
export class CloudRiderScene extends BaseMinigame {
  private riders: Rider[] = [];
  private items: Item[] = [];
  private storms: Storm[] = [];
  private gust: Gust | null = null;
  private trails = new Map<number, Trail>();
  private trailSeq = 0;
  private scroll = 0;
  private speed = 0;
  private nextAt = 0;
  private prevPattern = '';
  private rush = false;
  private wrapped = false;
  private clock = 0;
  private peaks: Phaser.GameObjects.Image[] = [];
  private near: Phaser.GameObjects.Image[] = [];
  private wisps: { img: Phaser.GameObjects.Image; k: number }[] = [];
  private streaks: { img: Phaser.GameObjects.Image; vx: number; active: boolean }[] = [];
  private streakT = 0;
  private gustG!: Phaser.GameObjects.Graphics;
  private gustLines: { img: Phaser.GameObjects.Image; x: number; y: number; v: number }[] = [];
  private bolt!: Phaser.GameObjects.Graphics;
  private boltT = 0;
  private ghosts: Phaser.GameObjects.Image[] = [];
  private words!: WordPops;
  private sparks?: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkTint = 0xffffff;

  constructor() {
    super('mg-cloud-rider');
  }

  preload(): void {
    queueDojoSprites(this, SPRITES);
  }

  // --- Arena --------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = 45000;
    this.riders = [];
    this.items = [];
    this.storms = [];
    this.gust = null;
    this.trails.clear();
    this.trailSeq = 0;
    this.scroll = 0;
    this.speed = courseSpeed(0, false);
    this.nextAt = 0;
    this.prevPattern = '';
    this.rush = false;
    this.wrapped = false;
    this.clock = 0;
    this.peaks = [];
    this.near = [];
    this.wisps = [];
    this.streaks = [];
    this.streakT = 0;
    this.gustLines = [];
    this.boltT = 0;
    this.ghosts = [];
    finishDojoSprites(this, SPRITES);
    ensureArenaFxTextures(this);
    // Score pop-ups and call-outs are rendered once now, not on the first catch.
    for (let n = 1; n <= 6; n++) titleTexture(this, `+${n}`, POP_SIZE, POP_WHITE);
    titleTexture(this, '+3', POP_SIZE, POP_ORB);
    const word = (key: string, text: string, fill: readonly [string, string], size = 64) => bakeWord(this, key, text, { size, fill });
    word('cr-bonk', 'BONK!', ['#fff6c4', '#ffb52e']);
    word('cr-zap', 'ZAP!', ['#f3e6ff', '#a47bff']);
    word('cr-clash', 'CLASH!', ['#ffffff', '#ffd23f']);
    word('cr-perfect', 'PERFECT TRAIL!', ['#fff9d6', '#ffcf3a'], 56);
    word('cr-lose1', '-1', ['#ffd9d2', '#ff6b5e'], 54);
    word('cr-lose2', '-2', ['#ffd9d2', '#ff6b5e'], 54);
    this.words = new WordPops(this, 5600, 16);
    this.buildSky();
    this.gustG = this.add.graphics().setDepth(D_GUST - 1);
    this.bolt = this.add.graphics().setDepth(D_RIDER + 500).setBlendMode(Phaser.BlendModes.ADD);
    if (this.textures.exists('fx-dot')) {
      this.sparks = this.add.particles(0, 0, 'fx-dot', {
        emitting: false,
        lifespan: { min: 260, max: 520 },
        speed: { min: 60, max: 240 },
        scale: { start: 0.75, end: 0 },
        alpha: { start: 1, end: 0 },
        blendMode: 'ADD',
        maxParticles: LITE ? 70 : 160,
        emitCallback: (pt: Phaser.GameObjects.Particles.Particle) => {
          pt.tint = this.sparkTint;
        },
      });
      this.sparks.setDepth(D_RIDER + 400);
    }
  }

  /** The sky, the scrolling peaks and the cloud tops rushing past in front. */
  private buildSky(): void {
    if (this.textures.exists('rendered-scene-dojo_sky')) this.add.image(0, 0, 'rendered-scene-dojo_sky').setOrigin(0).setDepth(-100);
    else {
      const sky = ['rendered-sky-day', 'rendered-sky-clear'].find((k) => this.textures.exists(k));
      if (sky) this.add.image(GAME_WIDTH / 2, 540, sky).setDisplaySize(GAME_WIDTH * 1.04, 1124).setDepth(-100);
      else this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, 1080).setDepth(-100);
    }
    if (this.textures.exists('rendered-scene-dojo_sky_peaks')) {
      for (let i = 0; i < 2; i++) this.peaks.push(this.add.image(i * GAME_WIDTH, PEAKS_Y, 'rendered-scene-dojo_sky_peaks').setOrigin(0).setDepth(-80));
    }
    // soft clouds drifting behind the course at their own depths
    const n = LITE ? 4 : 7;
    for (let i = 0; i < n; i++) {
      const k = 0.45 + (i % 3) * 0.12;
      const img = this.add
        .image(this.rng.range(0, GAME_WIDTH), this.rng.range(150, 700), DOJO_SPRITES.cloud.key)
        .setTintFill(0xffffff)
        .setAlpha(0.22 + 0.1 * (i % 2))
        .setScale(0.5 + k * 0.9)
        .setDepth(-70 + k);
      this.wisps.push({ img, k });
    }
    if (this.textures.exists('rendered-scene-dojo_sky_near')) {
      for (let i = 0; i < 2; i++) this.near.push(this.add.image(i * GAME_WIDTH, NEAR_Y, 'rendered-scene-dojo_sky_near').setOrigin(0).setDepth(D_NEAR));
    }
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const n = this.players.length;
    const y = n === 1 ? (TOP + BOTTOM) / 2 : TOP + 50 + (index * (BOTTOM - TOP - 100)) / (n - 1);
    const x = CRUISE_X - (index % 2) * 40;
    const glow = this.add.image(x, y, 'fx-dot').setTint(PLAYER_COLORS[p.slot]).setBlendMode(Phaser.BlendModes.ADD).setScale(6, 2.4).setAlpha(0.45);
    const aura = this.add.image(x, y, 'fx-dot').setTint(0xffe27a).setBlendMode(Phaser.BlendModes.ADD).setScale(9).setAlpha(0).setVisible(false);
    const cloud = this.add.image(x, y, DOJO_SPRITES.cloud.key).setScale(CLOUD_SCALE);
    const c = new Character(this, x, y + FEET_DY, p.characterId, { scale: CHAR_SCALE, shadow: false });
    // The player badge rides above the head (no floor ring: the cloud is their stage).
    const badge = new PlayerBadge(this, 0, c.headY - 46, p.slot, 22);
    badge.setScale(Math.min(2.2, 1 / CHAR_SCALE));
    c.add(badge);
    c.marker = badge;
    c.hold('balance');
    p.character = c;
    const gauge = this.add.graphics();
    this.riders.push({ p, c, cloud, glow, aura, gauge, x, y, vx: 0, vy: 0, charging: false, charge: 0, chimes: 0, ramT: 0, recharge: 0, dizzy: 0, guard: 0, bob: index * 1.7, streak: 0, lastRing: -1e9, popN: 0, popAt: -1e9, ghostT: 0, pose: 'balance', gustV: 0, home: y, nextRam: 2500 + index * 700 });
  }

  protected override onStart(): void {
    // Off they go: a lean into the wind, a whoosh, and the first stretch of course right away.
    audio.play('whoosh', { volume: 0.7 });
    for (const r of this.riders) {
      r.vx = 380;
      this.puff(r, 0.8);
    }
    this.spawnPattern(nextPattern(this.rng, 0, false), 2020);
    this.nextAt = this.scroll + 900;
  }

  /** Call-outs go along the bottom, over the cloud tops (the riders fly above them). */
  protected override bannerY(): number {
    return 985;
  }

  protected override onFinalStretch(): void {
    this.rush = true;
    this.showFinalStretch('RING RUSH!');
    audio.play('cheer', { volume: 0.6 });
    this.spawnPattern(nextPattern(this.rng, 1, true, this.prevPattern), COURSE.spawnX - 700);
  }

  // --- The course -----------------------------------------------------------------------------
  private spawnPattern(pat: CoursePattern, x0: number): void {
    this.prevPattern = pat.name;
    const ids = new Map<number, number>();
    for (const it of pat.items) {
      if (it.kind === 'storm') {
        this.spawnStorm(x0 + it.dx, it.y);
        continue;
      }
      let trail = -1;
      if (it.trail >= 0) {
        let id = ids.get(it.trail);
        if (id === undefined) {
          id = ++this.trailSeq;
          ids.set(it.trail, id);
          this.trails.set(id, { total: 0, taken: 0, by: -2, missed: false });
        }
        const tr = this.trails.get(id);
        if (tr) tr.total++;
        trail = id;
      }
      this.spawnItem(it.kind === 'orb' ? 'orb' : 'ring', x0 + it.dx, it.y, trail);
    }
    if (pat.gust && !this.gust) {
      // blowing just as the trail reaches the riders
      const lead = ((x0 + pat.gust.atDx - (CRUISE_X + 330)) / this.speed) * 1000;
      this.gust = { y: pat.gust.y, half: pat.gust.half, dir: pat.gust.dir, at: this.elapsed + Math.max(GUST_WARN + 200, lead), state: 'wait', t: 0 };
    }
  }

  private spawnItem(kind: ItemKind, x: number, y: number, trail: number): Item {
    let it = this.items.find((i) => !i.active && i.kind === kind);
    if (!it) {
      const img = this.add.image(0, 0, kind === 'orb' ? DOJO_SPRITES.orb.key : DOJO_SPRITES.ring.key);
      it = { kind, active: false, x: 0, y: 0, vx: 0, vy: 0, wait: 0, life: 0, trail: -1, phase: 0, img };
      if (kind === 'ring' || kind === 'loose') {
        // the ring's far (left) arc behind the riders, its near (right) arc in front: you fly through it
        const w = DOJO_SPRITES.ring.w;
        const h = DOJO_SPRITES.ring.h;
        it.back = this.add.image(0, 0, DOJO_SPRITES.ring.key).setCrop(0, 0, w / 2, h);
        img.setCrop(w / 2, 0, w / 2, h);
        it.glow = this.add.image(0, 0, 'fx-dot').setTint(0xffd24a).setBlendMode(Phaser.BlendModes.ADD);
      } else {
        it.glow = this.add.image(0, 0, 'fx-dot').setTint(0x6fe0ff).setBlendMode(Phaser.BlendModes.ADD);
        if (this.textures.exists('fx-rays')) it.rays = this.add.image(0, 0, 'fx-rays').setTint(0x9cf0ff).setBlendMode(Phaser.BlendModes.ADD);
      }
      this.items.push(it);
    }
    for (const o of [it.img, it.back, it.glow, it.rays]) if (o) this.tweens.killTweensOf(o);
    it.active = true;
    it.x = x;
    it.y = y;
    it.vx = 0;
    it.vy = 0;
    it.wait = 0;
    it.life = 1e9;
    it.trail = trail;
    it.phase = this.rng.range(0, Math.PI * 2);
    const loose = kind === 'loose';
    const s = kind === 'orb' ? ORB_SCALE : RING_SCALE * (loose ? 0.8 : 1);
    it.img.setVisible(true).setAlpha(1).setScale(s).setAngle(0).clearTint();
    it.img.setDepth(kind === 'orb' ? D_ORB : loose ? D_LOOSE : D_RING_FRONT);
    it.back?.setVisible(true).setAlpha(1).setScale(s).setAngle(0).setDepth(loose ? D_LOOSE - 1 : D_RING_BACK).clearTint();
    it.glow?.setVisible(true).setScale(kind === 'orb' ? 4.4 : 3.2).setAlpha(kind === 'orb' ? 0.7 : 0.4).setDepth(kind === 'orb' ? D_ORB - 1 : D_RING_BACK - 1);
    it.rays?.setVisible(true).setScale(0.34).setAlpha(0.7).setDepth(D_ORB - 2);
    return it;
  }

  private spawnStorm(x: number, y: number): void {
    let s = this.storms.find((q) => !q.active);
    if (!s) {
      const img = this.add.image(0, 0, DOJO_SPRITES.storm.key).setScale(STORM_SCALE).setDepth(D_STORM);
      s = { active: false, warning: 'off', x: 0, y: 0, phase: 0, flick: 0, img, warn: this.makeStormWarning(), seenAt: 0 };
      this.storms.push(s);
    }
    s.active = true;
    s.x = x;
    s.y = y;
    s.phase = this.rng.range(0, 6);
    s.flick = this.rng.range(500, 1400);
    s.seenAt = this.elapsed;
    s.img.setVisible(true).clearTint().setAlpha(1);
    s.warning = 'on';
    this.tweens.killTweensOf(s.warn);
    s.warn.setVisible(true).setPosition(GAME_WIDTH - 70, y).setAlpha(0).setScale(0.6);
    this.tweens.add({ targets: s.warn, alpha: 1, scale: 1, duration: 220, ease: 'Back.Out' });
    audio.play('warn', { volume: 0.35, rate: 0.8 });
  }

  /** The warning at the right edge before a storm cloud rolls in: a violet badge with a bolt and a chevron. */
  private makeStormWarning(): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    g.fillStyle(0x0a0820, 0.35);
    g.fillCircle(3, 5, 46);
    g.fillStyle(0x4b2f9a, 1);
    g.fillCircle(0, 0, 46);
    g.lineStyle(6, 0xffffff, 1);
    g.strokeCircle(0, 0, 42);
    g.fillStyle(0xffe45c, 1);
    g.fillPoints(
      [
        { x: 8, y: -30 },
        { x: -14, y: 4 },
        { x: -1, y: 4 },
        { x: -9, y: 30 },
        { x: 15, y: -6 },
        { x: 2, y: -6 },
      ],
      true,
    );
    // chevrons pointing into the screen (where it's coming from)
    g.fillStyle(0xffffff, 0.95);
    for (const k of [0, 1]) g.fillTriangle(-58 - k * 24, 0, -44 - k * 24, -16, -44 - k * 24, 16);
    const c = this.add.container(0, 0, [g]).setDepth(D_WARN).setVisible(false);
    return c;
  }

  private releaseItem(it: Item): void {
    it.active = false;
    this.tweens.killTweensOf(it.img);
    it.img.setVisible(false);
    it.back?.setVisible(false);
    it.glow?.setVisible(false);
    it.rays?.setVisible(false);
  }

  /** Everything scrolls with the course (also after the finish, slowing to a drift). */
  private scrollWorld(dt: number): void {
    const s = dt / 1000;
    const ds = this.speed * s;
    this.scroll += ds;
    const wrap = (imgs: Phaser.GameObjects.Image[], k: number) => {
      const off = (this.scroll * k) % GAME_WIDTH;
      imgs.forEach((img, i) => img.setX(i * GAME_WIDTH - off));
    };
    wrap(this.peaks, PEAKS_K);
    wrap(this.near, NEAR_K);
    for (const w of this.wisps) {
      w.img.x -= ds * w.k;
      if (w.img.x < -260) {
        w.img.x = GAME_WIDTH + 260;
        w.img.y = this.rng.range(150, 700);
      }
    }
    for (const it of this.items) {
      if (!it.active) continue;
      it.x -= ds;
      if (it.kind === 'loose') {
        it.x += it.vx * s;
        it.y += it.vy * s;
        const k = Math.exp(-2.4 * s);
        it.vx *= k;
        it.vy = it.vy * k + 60 * s;
        it.wait -= dt;
        it.life -= dt;
        if (it.life < 900) {
          const a = Math.floor(it.life / 110) % 2 ? 0.35 : 1;
          it.img.setAlpha(a);
          it.back?.setAlpha(a);
        }
        if (it.life <= 0) {
          this.releaseItem(it);
          continue;
        }
      }
      if (it.x < -120) {
        if (it.trail >= 0) {
          const tr = this.trails.get(it.trail);
          if (tr) tr.missed = true;
        }
        this.releaseItem(it);
      }
    }
    for (const st of this.storms) {
      if (!st.active) continue;
      st.x -= ds;
      if (st.x < -260) {
        st.active = false;
        st.warning = 'off';
        st.img.setVisible(false);
        st.warn.setVisible(false);
      }
    }
  }

  // --- Frame ------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.clock += dt;
    const t = this.elapsed / this.duration;
    this.speed = courseSpeed(t, this.rush);
    this.scrollWorld(dt);
    if (this.scroll >= this.nextAt) {
      const pat = nextPattern(this.rng, t, this.rush, this.prevPattern);
      this.spawnPattern(pat, COURSE.spawnX - (this.scroll - this.nextAt));
      this.nextAt += pat.length;
    }
    this.updateGust(dt);
    for (const r of this.riders) this.moveRider(r, dt);
    this.contacts();
    this.collect();
    this.hazards();
    this.drawGust(dt);
    this.speedLines(dt);
    this.syncVisuals(dt);
  }

  private inGust(y: number): number {
    const g = this.gust;
    if (!g || g.state !== 'blow') return 0;
    return Math.abs(y + HIT_DY - g.y) < g.half ? g.dir : 0;
  }

  private updateGust(dt: number): void {
    const g = this.gust;
    if (!g) return;
    if (g.state === 'wait' && this.elapsed >= g.at - GUST_WARN) {
      g.state = 'warn';
      g.t = 0;
      audio.play('sweep', { volume: 0.45, rate: 0.7 });
      this.words.pop(bakeWord(this, 'cr-wind', 'WIND!', { size: 60, fill: ['#ffffff', '#9fdcff'] }), GAME_WIDTH - 170, g.y - g.half - 34, { hold: 700, scale: 1, rise: 20 });
    } else if (g.state === 'warn' && this.elapsed >= g.at) {
      g.state = 'blow';
      g.t = 0;
      audio.play('whoosh', { volume: 0.8, rate: 0.7 });
      audio.play('rumble', { volume: 0.25 });
    } else if (g.state === 'blow') {
      g.t += dt;
      if (g.t >= GUST_BLOW) {
        g.state = 'done';
        this.gustG.clear();
        for (const l of this.gustLines) l.img.setVisible(false);
        this.gust = null;
      }
    }
  }

  private moveRider(r: Rider, dt: number): void {
    const s = dt / 1000;
    const c = r.p.controls;
    r.guard = Math.max(0, r.guard - dt);
    r.recharge = Math.max(0, r.recharge - dt);
    r.ramT = Math.max(0, r.ramT - dt);
    const gust = this.inGust(r.y);
    r.gustV = gust * GUST_V;
    if (r.dizzy > 0) {
      r.dizzy -= dt;
      r.charging = false;
      r.charge = 0;
      const k = Math.exp(-4 * s);
      r.vy = r.vy * k + r.gustV * (1 - k);
    } else {
      // charge while A is held, burst when it's let go
      if (!r.charging && r.recharge <= 0 && c.held('A') && r.ramT <= 0) {
        r.charging = true;
        r.charge = 0;
        r.chimes = 0;
      }
      if (r.charging) {
        r.charge = Math.min(1, r.charge + dt / CHARGE_MS);
        const q = Math.floor(r.charge * 4);
        if (q > r.chimes) {
          r.chimes = q;
          if (q >= 4) this.fullCharge(r);
          else audio.play('tick', { volume: 0.25, rate: 0.9 + q * 0.15 });
        }
        if (!c.held('A')) this.burst(r);
      }
      const steer = r.charging ? 0.55 : 1;
      const target = c.moveY * MAX_VY * steer + r.gustV;
      r.vy += (target - r.vy) * (1 - Math.exp(-STEER * s));
    }
    r.y += r.vy * s;
    if (r.y < TOP) {
      r.y = TOP;
      r.vy = Math.max(0, r.vy);
    } else if (r.y > BOTTOM) {
      r.y = BOTTOM;
      r.vy = Math.min(0, r.vy);
    }
    // forward speed: bursts shoot ahead, then a spring eases the rider back to the cruise line
    const ax = -X_DAMP * r.vx + X_SPRING * (CRUISE_X - r.x) - (r.charging ? 160 : 0);
    r.vx += ax * s;
    r.x += r.vx * s;
    if (r.x < MIN_X) {
      r.x = MIN_X;
      r.vx = Math.max(0, r.vx);
    } else if (r.x > MAX_X) {
      r.x = MAX_X;
      r.vx = Math.min(0, r.vx);
    }
    if (r.ramT > 0) this.trail(r, dt);
  }

  private fullCharge(r: Rider): void {
    audio.play('streak', { volume: 0.5, rate: 1.2 });
    this.rumble(r.p, 0.15, 0.3, 90);
    shockwave(this, r.x, r.y + HIT_DY, { radius: 90, color: 0xffe27a, alpha: 0.8, duration: 260, depth: D_RIDER + 300 });
  }

  /** Let go: shoot forward, ramming anyone in the way while the burst is hot. */
  private burst(r: Rider): void {
    const k = r.charge;
    const power = burstPower(k);
    r.charging = false;
    r.charge = 0;
    r.vx = Math.max(r.vx, 0) + BURST_V * power;
    r.ramT = RAM_MIN + (RAM_MAX - RAM_MIN) * k;
    r.recharge = RECHARGE_MS;
    r.ghostT = 0;
    audio.play('whoosh', { volume: 0.55 + 0.4 * k, rate: 1.25 - 0.3 * k });
    if (k > 0.95) audio.play('sweep', { volume: 0.35, rate: 1.4 });
    this.rumble(r.p, 0.25 + 0.4 * k, 0.35, 120);
    shockwave(this, r.x - 40, r.y + HIT_DY, { radius: 70 + 90 * k, ratio: 0.7, color: 0xfff1b0, alpha: 0.85, duration: 300, depth: D_RIDER - 5 });
    this.puff(r, 0.6 + 0.6 * k);
    this.tweens.add({ targets: r.cloud, scaleX: { from: CLOUD_SCALE * 1.25, to: CLOUD_SCALE }, scaleY: { from: CLOUD_SCALE * 0.8, to: CLOUD_SCALE }, duration: 260, ease: 'Back.Out' });
  }

  /** A puff of golden cloud streaming off the back of a rider's cloud. */
  private puff(r: Rider, amount: number): void {
    if (!this.sparks) return;
    this.sparkTint = 0xffd24a;
    this.sparks.emitParticleAt(r.x - 70, r.y + 6, liteCount(Math.round(6 * amount)));
  }

  /** Riders touching: rams, clashes, or just a jostle. */
  private contacts(): void {
    const rs = this.riders;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i];
        const b = rs[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) > RIDER_R * 2.1 || Math.abs(dy) > RIDER_R * 1.6) continue;
        const who = resolveBump({ bursting: a.ramT > 0, guarded: a.guard > 0 }, { bursting: b.ramT > 0, guarded: b.guard > 0 });
        if (who === 'a') this.bump(a, b);
        else if (who === 'b') this.bump(b, a);
        else if (who === 'clash') this.clash(a, b);
        else {
          // a jostle: push apart vertically
          const push = (RIDER_R * 1.6 - Math.abs(dy)) / 2;
          const sy = dy >= 0 ? 1 : -1;
          a.y -= sy * push * 0.5;
          b.y += sy * push * 0.5;
          a.vy -= sy * 60;
          b.vy += sy * 60;
        }
      }
    }
  }

  private bump(a: Rider, v: Rider): void {
    const sy = v.y >= a.y ? 1 : -1;
    v.vy = sy * 860;
    v.vx = Math.min(v.vx, 0) - 420;
    v.dizzy = DIZZY_BUMP;
    v.guard = GUARD_BUMP;
    v.charging = false;
    v.charge = 0;
    a.vx *= 0.4;
    a.ramT = Math.min(a.ramT, 60);
    a.vy -= sy * 180;
    const lost = ringsLost(v.p.score, 'bump');
    this.loseRings(v, lost, a.x < v.x ? 1 : -1);
    const mx = (a.x + v.x) / 2;
    const my = (a.y + v.y) / 2 + HIT_DY;
    this.hitStop(70);
    kick(this, 14, sy * 10, 170);
    audio.play('hit', { volume: 0.85 });
    audio.play('bounce', { volume: 0.55, rate: 1.1 });
    shockwave(this, mx, my, { radius: 150, color: 0xffe08a, alpha: 0.9, duration: 360, depth: D_RIDER + 300 });
    this.fx.vfx('impact', mx, my, { scale: 0.62, blend: 'add', depth: D_RIDER + 310 });
    this.words.pop('cr-bonk', mx, my - 90, { scale: 1, hold: 480, tilt: -8 });
    this.stun(v);
    this.rumble(a.p, 0.35, 0.3, 120);
    this.rumble(v.p, 0.8, 0.5, 260);
  }

  private clash(a: Rider, b: Rider): void {
    const sy = b.y >= a.y ? 1 : -1;
    for (const [r, d] of [
      [a, -sy],
      [b, sy],
    ] as const) {
      r.vx = -260;
      r.vy = d * 520;
      r.ramT = 0;
      r.guard = 600;
    }
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 + HIT_DY;
    this.hitStop(60);
    audio.play('crack', { volume: 0.6 });
    audio.play('hit', { volume: 0.6, rate: 1.3 });
    shockwave(this, mx, my, { radius: 190, color: 0xffffff, alpha: 0.95, duration: 380, depth: D_RIDER + 300 });
    this.fx.sparks(mx, my, liteCount(22));
    this.words.pop('cr-clash', mx, my - 90, { scale: 1, hold: 420 });
    kick(this, 0, 12, 150);
  }

  /** Knocked silly: a spin, stars, a white flash. */
  private stun(r: Rider): void {
    r.c.play('stunned', { force: true, returnTo: 'idle' });
    r.pose = 'stunned';
    r.c.sprite.setTintFill(0xffffff);
    this.time.delayedCall(70, () => r.c.sprite.clearTint());
    this.tweens.add({ targets: r.c, angle: { from: 0, to: r.vx < 0 ? -360 : 360 }, duration: 520, ease: 'Cubic.Out', onComplete: () => r.c.setAngle(0) });
    this.fx.vfx('starSwirl', r.x, r.y + FEET_DY + r.c.headY * CHAR_SCALE - 10, { scale: 0.38, duration: 700, blend: 'add', depth: D_RIDER + 320 });
  }

  /** Rings knocked out of a rider fly back into the course, for anyone to catch. */
  private loseRings(r: Rider, n: number, dir: number): void {
    if (n <= 0) return;
    r.p.score -= n;
    this.words.pop(n >= 2 ? 'cr-lose2' : 'cr-lose1', r.x - 70, r.y + 40, { scale: 0.85, hold: 520, rise: 30 });
    audio.play('chipLose', { volume: 0.6 });
    for (let i = 0; i < n; i++) {
      const it = this.spawnItem('loose', r.x, r.y + HIT_DY, -1);
      it.vx = -dir * this.rng.range(80, 220) - 120;
      it.vy = (i % 2 ? 1 : -1) * this.rng.range(160, 320) - 60;
      it.wait = 380;
      it.life = 3200;
    }
  }

  private collect(): void {
    for (const it of this.items) {
      if (!it.active || (it.kind === 'loose' && it.wait > 0)) continue;
      let best: Rider | null = null;
      let bestD = 1e9;
      for (const r of this.riders) {
        if (r.dizzy > 0 && it.kind !== 'orb') continue;
        const hx = r.x + 12;
        const hy = r.y + HIT_DY;
        const dx = Math.abs(it.x - hx);
        const dy = Math.abs(it.y - hy);
        const hit = it.kind === 'orb' ? dx * dx + dy * dy < 80 * 80 : dx < 46 && dy < 74;
        if (hit && dx + dy < bestD) {
          bestD = dx + dy;
          best = r;
        }
      }
      if (best) this.take(best, it);
    }
  }

  private take(r: Rider, it: Item): void {
    const orb = it.kind === 'orb';
    const value = orb ? WORTH.orb : WORTH.ring;
    r.p.score += value;
    r.streak = this.elapsed - r.lastRing < 650 ? r.streak + 1 : 1;
    r.lastRing = this.elapsed;
    if (orb) {
      audio.play('goldChip', { volume: 0.9 });
      audio.play('itemGet', { volume: 0.4 });
      this.sparkTint = 0x9cf0ff;
      this.sparks?.emitParticleAt(it.x, it.y, liteCount(18));
      shockwave(this, it.x, it.y, { radius: 120, color: 0x9cf0ff, alpha: 0.9, duration: 360, depth: D_RIDER + 300 });
      this.rumble(r.p, 0.2, 0.35, 90);
    } else {
      audio.play('chipGain', { rate: Math.min(1.9, 1 + 0.07 * (r.streak - 1)) * (0.98 + Math.random() * 0.04), throttleMs: 25 });
      this.sparkTint = 0xffe27a;
      this.sparks?.emitParticleAt(it.x, it.y, liteCount(7));
      this.rumble(r.p, 0.08, 0.18, 40);
    }
    this.popScore(r, it.x, it.y, value, orb ? POP_ORB : POP_WHITE);
    // the ring flashes and swells as it's flown through, then fades
    const imgs = [it.img, it.back, it.glow].filter((o): o is Phaser.GameObjects.Image => !!o);
    it.active = false;
    it.rays?.setVisible(false);
    for (const o of imgs) {
      this.tweens.killTweensOf(o);
      if (o !== it.glow) o.setTintFill(0xfff6c8);
      this.tweens.add({ targets: o, scale: o.scale * 1.45, alpha: 0, duration: 220, ease: 'Quad.Out', onComplete: () => o.setVisible(false).clearTint() });
    }
    if (it.trail >= 0) this.trailProgress(r, it.trail);
  }

  /** Every ring of a trail, alone: PERFECT TRAIL! (+2). */
  private trailProgress(r: Rider, id: number): void {
    const tr = this.trails.get(id);
    if (!tr) return;
    tr.taken++;
    tr.by = tr.by === -2 || tr.by === r.p.slot ? r.p.slot : -1;
    if (tr.taken < tr.total) return;
    this.trails.delete(id);
    if (tr.by !== r.p.slot || tr.missed || tr.total < PERFECT_MIN) return;
    r.p.score += PERFECT_BONUS;
    this.popScore(r, r.x + 40, r.y + HIT_DY - 60, PERFECT_BONUS, POP_GOLD);
    this.words.pop('cr-perfect', r.x + 60, r.y + HIT_DY - 150, { scale: 0.9, hold: 650, owner: r.p.slot });
    audio.play('streak', { volume: 0.7, rate: 1.1 });
    shockwave(this, r.x, r.y + HIT_DY, { radius: 130, color: PLAYER_COLORS[r.p.slot], alpha: 0.85, duration: 380, depth: D_RIDER + 300 });
  }

  /**
   * "+1" pops off beside the rider and flies to their capsule; quick catches gather into the pop-up
   * still hanging there ("+1" -> "+4") instead of each throwing its own.
   */
  private popScore(r: Rider, x: number, y: number, value: number, color: string): void {
    const slot = r.p.slot;
    this.holdHud(slot, value);
    const open = r.pop;
    if (open && open.h.gathering && open.h.image.active && value < 3) {
      open.value += value;
      open.h.retitle(`+${open.value}`, open.color);
      return;
    }
    r.popN = this.elapsed - r.popAt < 600 ? r.popN + 1 : 0;
    r.popAt = this.elapsed;
    const h = this.hudPoint(slot);
    const entry: { h?: HudPop; value: number; color: string } = { value, color };
    entry.h = popToHud(this, x + 30 + (r.popN % 2) * 30, y - 60 - (r.popN % 3) * 16, `+${value}`, h.x, h.y, {
      color,
      size: POP_SIZE,
      onArrive: () => {
        this.releaseHud(slot, entry.value);
        this.bumpHud(slot);
        if (r.pop === entry) r.pop = undefined;
      },
    });
    r.pop = entry as { h: HudPop; value: number; color: string };
  }

  private hazards(): void {
    for (const st of this.storms) {
      if (!st.active) continue;
      // the warning fades as the cloud itself rolls into view
      if (st.warning === 'on' && st.x - STORM_RX * 1.2 < GAME_WIDTH) {
        st.warning = 'fading';
        this.tweens.killTweensOf(st.warn);
        this.tweens.add({
          targets: st.warn,
          alpha: 0,
          scale: 0.6,
          duration: 200,
          onComplete: () => {
            st.warn.setVisible(false);
            st.warning = 'off';
          },
        });
      }
      for (const r of this.riders) {
        if (r.guard > 0) continue;
        const dx = (r.x + 10 - st.x) / (STORM_RX + 36);
        const dy = (r.y + HIT_DY - st.y) / (STORM_RY + 48);
        if (dx * dx + dy * dy < 1) this.zap(r, st);
      }
    }
  }

  private zap(r: Rider, st: Storm): void {
    const sy = r.y + HIT_DY >= st.y ? 1 : -1;
    r.dizzy = DIZZY_ZAP;
    r.guard = GUARD_ZAP;
    r.vx = Math.min(r.vx, 0) - 320;
    r.vy = sy * 520;
    r.ramT = 0;
    this.loseRings(r, ringsLost(r.p.score, 'zap'), -1);
    this.drawBolt(st.x - 10, st.y + 30, r.x + 8, r.y + HIT_DY);
    st.img.setTintFill(0xf4ecff);
    this.time.delayedCall(90, () => st.img.clearTint());
    this.stun(r);
    this.hitStop(60);
    flashScreen(this, 0xd9ccff, 0.16, 180);
    this.fx.shake(0.005, 180);
    audio.play('crack', { volume: 0.7 });
    audio.play('hit', { volume: 0.6, rate: 0.8 });
    this.fx.vfx('electric', r.x, r.y + HIT_DY, { scale: 0.7, duration: 480, blend: 'add', depth: D_RIDER + 320 });
    this.words.pop('cr-zap', r.x + 20, r.y + HIT_DY - 110, { scale: 1, hold: 480, tilt: 8 });
    this.rumble(r.p, 0.7, 0.6, 280);
  }

  /** A jagged lightning bolt (white core in a violet glow) that flickers out. */
  private drawBolt(x0: number, y0: number, x1: number, y1: number): void {
    const g = this.bolt;
    g.clear();
    const seg = 7;
    const pts: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      const j = i === 0 || i === seg ? 0 : (Math.random() - 0.5) * 60;
      pts.push(x0 + (x1 - x0) * u + j, y0 + (y1 - y0) * u);
    }
    for (const [w, c, a] of [
      [16, 0x8f6dff, 0.5],
      [7, 0xd9ccff, 0.9],
      [3, 0xffffff, 1],
    ] as const) {
      g.lineStyle(w, c, a);
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.strokePath();
    }
    g.setAlpha(1);
    this.boltT = 260;
  }

  // --- Visuals -------------------------------------------------------------------------------
  private syncVisuals(dt: number): void {
    for (const r of this.riders) this.syncRider(r, dt);
    for (const it of this.items) {
      if (!it.active) continue;
      const bob = Math.sin(this.clock / 260 + it.phase) * (it.kind === 'orb' ? 8 : 4);
      const y = it.y + bob;
      it.img.setPosition(it.x, y);
      if (it.kind === 'loose') it.img.setAngle(Math.sin(this.clock / 90 + it.phase) * 25);
      it.back?.setPosition(it.x, y).setAngle(it.img.angle);
      it.glow?.setPosition(it.x, y).setAlpha((it.kind === 'orb' ? 0.55 : 0.3) + 0.2 * Math.sin(this.clock / 180 + it.phase));
      it.rays?.setPosition(it.x, y).setAngle(this.clock * 0.05);
    }
    for (const st of this.storms) {
      if (!st.active) continue;
      st.phase += dt / 1000;
      st.img.setPosition(st.x, st.y + Math.sin(st.phase * 1.7) * 6);
      // a flicker of lightning inside the cloud now and then
      st.flick -= dt;
      if (st.flick <= 0) {
        st.flick = 700 + Math.random() * 1300;
        st.img.setTint(0xe6dcff);
        this.time.delayedCall(60, () => st.img.clearTint());
        if (st.x < GAME_WIDTH + 100) audio.play('crack', { volume: 0.12, rate: 1.6, throttleMs: 300 });
      }
      if (st.warning === 'on' && st.warn.alpha >= 1) st.warn.setScale(1 + 0.08 * Math.sin(this.clock / 90));
    }
    if (this.boltT > 0) {
      this.boltT -= dt;
      this.bolt.setAlpha(Math.max(0, this.boltT / 260) * (Math.floor(this.boltT / 40) % 2 ? 0.6 : 1));
      if (this.boltT <= 0) this.bolt.clear();
    }
  }

  private syncRider(r: Rider, dt: number): void {
    r.bob += dt / 1000;
    const bobY = Math.sin(r.bob * 3.1 + r.p.slot) * 6;
    const cy = r.y + bobY;
    const tilt = Phaser.Math.Clamp(r.vy * 0.014, -12, 12);
    r.cloud.setPosition(r.x, cy).setAngle(tilt).setDepth(D_RIDER + r.y * 0.01);
    r.c.setPosition(r.x + 4, cy + FEET_DY).setDepth(D_RIDER + r.y * 0.01 + 0.005);
    if (r.dizzy <= 0) r.c.setAngle(tilt * 0.7 + Phaser.Math.Clamp(r.vx * 0.004, -4, 8));
    r.glow.setPosition(r.x, cy + 26).setDepth(D_RIDER + r.y * 0.01 - 0.01).setAlpha(0.35 + 0.15 * Math.sin(r.bob * 5));
    // the pose follows what the rider is doing
    let pose = 'balance';
    if (r.dizzy > 0) pose = 'stunned';
    else if (r.charging) pose = 'crouch';
    else if (r.ramT > 0) pose = 'dash';
    if (pose !== r.pose) {
      r.pose = pose;
      if (pose !== 'stunned') r.c.hold(pose as 'balance' | 'crouch' | 'dash');
    }
    // charge aura and the ring gauge round the rider
    const aura = r.aura;
    if (r.charging || r.ramT > 0) {
      const k = r.charging ? r.charge : 1;
      const full = r.charging && r.charge >= 1;
      aura.setVisible(true).setPosition(r.x, cy + HIT_DY + 10).setDepth(D_RIDER + r.y * 0.01 - 0.02);
      aura.setScale(5 + 5 * k + (full ? Math.sin(this.clock / 50) * 0.8 : 0)).setAlpha(0.25 + 0.45 * k);
      aura.setTint(full || r.ramT > 0 ? 0xffe27a : PLAYER_COLORS[r.p.slot]);
      if (r.charging && Math.random() < (LITE ? 0.25 : 0.5)) {
        this.sparkTint = full ? 0xfff1a8 : PLAYER_COLORS[r.p.slot];
        const a = Math.random() * Math.PI * 2;
        this.sparks?.emitParticleAt(r.x + Math.cos(a) * 70, cy + HIT_DY + Math.sin(a) * 60, 1);
      }
    } else aura.setVisible(false);
    const g = r.gauge;
    g.clear();
    if (r.charging) {
      const full = r.charge >= 1;
      g.setDepth(D_RIDER + r.y * 0.01 + 0.02);
      const gx = r.x;
      const gy = cy + HIT_DY - 4;
      g.lineStyle(8, 0x0a1120, 0.35);
      g.strokeCircle(gx, gy, GAUGE_R);
      g.lineStyle(6, full ? 0xffe27a : PLAYER_COLORS[r.p.slot], 1);
      g.beginPath();
      g.arc(gx, gy, GAUGE_R, -Math.PI / 2, -Math.PI / 2 + r.charge * Math.PI * 2, false);
      g.strokePath();
    }
  }

  /** After-images while a rider bursts (a small pool of reused images). */
  private trail(r: Rider, dt: number): void {
    if (calmMotion()) return;
    r.ghostT -= dt;
    if (r.ghostT > 0) return;
    r.ghostT = LITE ? 80 : 45;
    const sp = r.c.sprite;
    for (const [tex, frame, x, y, sx, sy, flip, ox, oy] of [
      [r.cloud.texture.key, undefined, r.cloud.x, r.cloud.y, r.cloud.scaleX, r.cloud.scaleY, false, 0.5, 0.5],
      [sp.texture.key, sp.frame.name, r.c.x, r.c.y, CHAR_SCALE * sp.scaleX, CHAR_SCALE * sp.scaleY, sp.flipX, sp.originX, sp.originY],
    ] as const) {
      let img = this.ghosts.find((gi) => !gi.visible);
      if (!img) {
        img = this.add.image(0, 0, tex).setVisible(false);
        this.ghosts.push(img);
      }
      if (frame !== undefined) img.setTexture(tex, frame);
      else img.setTexture(tex);
      img.setOrigin(ox, oy).setPosition(x, y).setScale(sx, sy).setFlipX(flip).setAngle(0);
      img.setTintFill(PLAYER_COLORS[r.p.slot]).setAlpha(0.4).setDepth(D_RIDER - 1).setVisible(true);
      const ghost = img;
      this.tweens.killTweensOf(ghost);
      this.tweens.add({ targets: ghost, alpha: 0, x: x - 40, duration: 220, ease: 'Quad.Out', onComplete: () => ghost.setVisible(false) });
    }
  }

  /** Streaks of wind rushing past: the sense of speed. */
  private speedLines(dt: number): void {
    if (calmMotion()) return;
    this.streakT -= dt;
    if (this.streakT <= 0) {
      this.streakT = (LITE ? 150 : 80) * (620 / this.speed);
      let s = this.streaks.find((q) => !q.active);
      if (!s && this.streaks.length < (LITE ? 10 : 20)) {
        s = { img: this.add.image(0, 0, AFX.streak).setDepth(D_SPEED).setBlendMode(Phaser.BlendModes.ADD), vx: 0, active: false };
        this.streaks.push(s);
      }
      if (s) {
        s.active = true;
        s.vx = this.speed * this.rng.range(1.5, 2.2);
        s.img.setPosition(GAME_WIDTH + 100, this.rng.range(130, 1000)).setScale(this.rng.range(2, 4.5), this.rng.range(0.8, 1.4)).setAlpha(this.rng.range(0.12, 0.3)).setVisible(true);
      }
    }
    const s = dt / 1000;
    for (const q of this.streaks) {
      if (!q.active) continue;
      q.img.x -= q.vx * s;
      if (q.img.x < -300) {
        q.active = false;
        q.img.setVisible(false);
      }
    }
  }

  /** The gust band: arrows and faint streaks as it warns, then wind lines tearing across it. */
  private drawGust(dt: number): void {
    const g = this.gust;
    const gg = this.gustG;
    gg.clear();
    if (!g || g.state === 'wait' || g.state === 'done') return;
    const warn = g.state === 'warn';
    const top = g.y - g.half;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock / 70);
    gg.fillStyle(0xdff4ff, warn ? 0.05 + 0.05 * pulse : 0.12);
    gg.fillRect(0, top, GAME_WIDTH, g.half * 2);
    gg.lineStyle(3, 0xffffff, warn ? 0.25 + 0.35 * pulse : 0.3);
    gg.lineBetween(0, top, GAME_WIDTH, top);
    gg.lineBetween(0, top + g.half * 2, GAME_WIDTH, top + g.half * 2);
    // big chevrons at the right showing which way it will blow
    gg.fillStyle(0xffffff, warn ? 0.5 + 0.45 * pulse : 0.35);
    for (let k = 0; k < 3; k++) {
      const cx = GAME_WIDTH - 90;
      const cy = g.y + (k - 1) * 70 * g.dir;
      const d = g.dir * 18;
      gg.fillTriangle(cx - 26, cy - d, cx + 26, cy - d, cx, cy + d);
    }
    // wind lines
    const n = warn ? (LITE ? 3 : 5) : LITE ? 8 : 16;
    while (this.gustLines.length < n) {
      this.gustLines.push({ img: this.add.image(0, 0, AFX.streak).setDepth(D_GUST).setVisible(false), x: 0, y: 0, v: 0 });
    }
    const s = dt / 1000;
    this.gustLines.forEach((l, i) => {
      if (i >= n) {
        l.img.setVisible(false);
        return;
      }
      if (!l.img.visible || l.x < -300) {
        l.x = GAME_WIDTH + this.rng.range(0, 600);
        l.y = top + this.rng.range(10, g.half * 2 - 10);
        l.v = this.speed * this.rng.range(2, 3);
        l.img.setVisible(true);
      }
      l.x -= l.v * s;
      l.y += g.dir * (warn ? 20 : 260) * s;
      if (l.y < top || l.y > top + g.half * 2) l.y = g.dir > 0 ? top + 8 : top + g.half * 2 - 8;
      l.img.setPosition(l.x, l.y).setScale(3.2, 1.3).setAngle(g.dir * 8).setAlpha(warn ? 0.25 : 0.6);
    });
  }

  protected override ambient(dt: number): void {
    if (this.phase === 'playing') return;
    this.clock += dt;
    // Before GO the world drifts by slowly; after the finish it glides to a gentle drift.
    if (this.phase === 'countdown') this.speed = courseSpeed(0, false) * 0.35;
    else this.speed = Math.max(courseSpeed(0, false) * 0.25, this.speed * Math.exp(-dt / 900));
    this.scrollWorld(dt);
    if (this.phase === 'finished') {
      for (const r of this.riders) {
        r.vx *= Math.exp(-dt / 200);
        r.x += (r.vx * dt) / 1000;
      }
    }
    this.syncVisuals(dt);
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      for (const r of this.riders) {
        r.charging = false;
        r.charge = 0;
        r.ramT = 0;
        r.vy = 0;
        r.gauge.clear();
        r.aura.setVisible(false);
        if (r.dizzy > 0) {
          r.dizzy = 0;
          r.c.setAngle(0);
        }
        if (r.pose !== 'balance') {
          r.pose = 'balance';
          r.c.hold('balance');
        }
      }
      for (const st of this.storms) {
        this.tweens.killTweensOf(st.warn);
        st.warn.setVisible(false);
        st.warning = 'off';
      }
      if (this.gust) this.gust.state = 'done';
      this.gustG.clear();
      for (const l of this.gustLines) l.img.setVisible(false);
    }
    super.end();
  }

  // --- CPU ------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const r = this.riders.find((q) => q.p === p);
    if (!r) return;
    const sk = this.skill(p);
    const b = p.brain;
    b.timer -= dt;
    if (b.timer <= 0) {
      b.timer = sk.think * (0.55 + Math.random() * 0.4);
      const ty = this.cpuTarget(r, sk);
      b.target = { x: 0, y: ty + (Math.random() - 0.5) * sk.aimNoise * 60 };
      if (b.mode !== 'charge' && !r.charging && r.recharge <= 0 && r.dizzy <= 0) {
        const hold = this.cpuBurstWish(r, sk);
        if (hold > 0) {
          b.mode = 'charge';
          b.wait = hold;
        }
      }
    }
    if (r.dizzy > 0) {
      vc.setMove(0, 0);
      vc.hold('A', false);
      b.mode = undefined;
      return;
    }
    const ty = b.target?.y ?? r.y;
    let my = Phaser.Math.Clamp((ty - r.y) / 70, -1, 1);
    // lean into a gust (better CPUs fight it harder)
    if (r.gustV !== 0) my -= Math.sign(r.gustV) * (0.2 + 0.5 * sk.accuracy);
    vc.setMove(0, Phaser.Math.Clamp(my, -1, 1));
    if (b.mode === 'charge') {
      vc.hold('A', true);
      // count the hold from when the charge actually starts
      if (r.charging) b.wait = (b.wait ?? 0) - dt;
      else if (r.recharge > 0 || r.ramT > 0) b.mode = undefined;
      if (b.mode && (b.wait ?? 0) <= 0) {
        vc.hold('A', false);
        b.mode = undefined;
      }
    } else vc.hold('A', false);
  }

  /** The height a CPU heads for: the best reachable catch ahead, steering round storms it has seen. */
  private cpuTarget(r: Rider, sk: { reaction: number; accuracy: number; mistake: number }): number {
    const hitY = r.y + HIT_DY;
    let bestY = r.y;
    let bestScore = -1e9;
    const pace = this.speed + Math.max(0, r.vx);
    for (const it of this.items) {
      if (!it.active) continue;
      const ahead = it.x - (r.x + 12);
      if (ahead < -20 || ahead > 1050) continue;
      const tArrive = Math.max(0.05, ahead / pace);
      const dy = Math.abs(it.y - hitY);
      if (dy / (MAX_VY * 0.85) > tArrive + 0.1) continue;
      const worth = it.kind === 'orb' ? WORTH.orb : WORTH.ring;
      const needY = it.y - HIT_DY;
      let score = worth * 100 - tArrive * 55 - dy * 0.06 - Math.abs(needY - r.home) * 0.05;
      for (const o of this.riders) {
        if (o === r) continue;
        // someone nearer it, or already heading for it: leave it to them
        const oy = o.p.isCpu && o.p.brain.target ? o.p.brain.target.y : o.y;
        if (Math.abs(oy - needY) < 85) score -= Math.abs(o.y - needY) < Math.abs(r.y - needY) ? 70 : 35;
      }
      for (const st of this.storms) {
        if (st.active && Math.abs(st.x - it.x) < 280 && Math.abs(st.y - it.y) < 170) score -= 150;
      }
      if (score > bestScore) {
        bestScore = score;
        bestY = it.y - HIT_DY;
      }
    }
    // storms it has had time to notice: steer round them (easy CPUs now and then don't)
    for (const st of this.storms) {
      if (!st.active || this.elapsed - st.seenAt < sk.reaction) continue;
      const ahead = st.x - r.x;
      if (ahead < -STORM_RX || ahead > pace * 1.7) continue;
      if (Math.random() < sk.mistake * 0.5) continue;
      const band = STORM_RY + 110;
      const ty = bestY + HIT_DY;
      if (Math.abs(ty - st.y) < band) {
        const up = st.y - band - HIT_DY;
        const down = st.y + band - HIT_DY;
        const upOk = up >= TOP;
        const downOk = down <= BOTTOM;
        bestY = upOk && (!downOk || Math.abs(up - r.y) < Math.abs(down - r.y)) ? up : down;
      }
    }
    return Phaser.Math.Clamp(bestY, TOP, BOTTOM);
  }

  /** How long to charge a burst for right now (0 = don't): ram a rival lined up ahead, or race to a catch. */
  private cpuBurstWish(r: Rider, sk: { accuracy: number; mistake: number }): number {
    const aggression = Math.max(0.12, sk.accuracy * 0.7 - 0.2);
    if (this.elapsed >= r.nextRam) {
      for (const o of this.riders) {
        if (o === r || o.guard > 0 || o.dizzy > 0 || o.p.score <= 0) continue;
        const dx = o.x - r.x;
        const dy = Math.abs(o.y - r.y);
        if (dx > 70 && dx < 430 && dy < 60 && Math.random() < aggression) {
          // a breather before the next attempt (longer for gentler CPUs)
          r.nextRam = this.elapsed + 2400 + (1 - sk.accuracy) * 7000 + Math.random() * 1500;
          return 220 + Math.random() * 480;
        }
      }
    }
    // a valuable catch ahead in line: burst to reach it first
    for (const it of this.items) {
      if (!it.active) continue;
      const dx = it.x - r.x;
      if (dx < 150 || dx > 460 || Math.abs(it.y - (r.y + HIT_DY)) > 45) continue;
      const contested = this.riders.some((o) => o !== r && Math.abs(o.y - r.y) < 120 && o.x > r.x - 60);
      if ((it.kind === 'orb' || contested) && Math.random() < aggression * 0.8) return 150 + Math.random() * 250;
    }
    return 0;
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} ${p.score === 1 ? 'ring' : 'rings'}` }));
  }
}
