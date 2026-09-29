import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { Character } from '../../characters/Character';
import { GAME_WIDTH, PLAYER_COLORS, PLAYER_COLORS_CSS } from '../../constants';
import { CHARACTERS } from '../../data/characters';
import type { VirtualControls } from '../../input/PlayerInput';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../data/npcs';
import { LITE } from '../../perf';
import { centerOrigin, standOrigin } from '../../util/spriteUtil';
import { BaseMinigame, type MgPlayer } from '../BaseMinigame';
import { clampRect, dist, drift, separate, steer, type Mover } from '../common';
import { kick, popToHud, shockwave, titleTexture, type HudPop } from '../juice';
import { QuadMap } from '../../util/QuadMap';
import { addStrip } from '../../ui/Screen';
import { CHIP_LIFE, goldChance, nextStreak, spawnInterval, STORM_CHIP_LIFE, STORM_MS, streakCallout, streakPitch } from './gleamGrabRules';

interface Grabber extends Mover {
  p: MgPlayer;
  c: Character;
  dashT: number;
  dashCd: number;
  stunT: number;
  /** Recent score pop-ups (fanned out so quick pickups don't stack on top of each other). */
  popN: number;
  popAt: number;
  /** Catch streak and when (game ms) its last catch was. */
  streak: number;
  lastCatch: number;
  /** Knockback dust trail: time left, and time to the next puff. */
  trailT: number;
  dustT: number;
  /** The score pop-up still gathering over their head (quick catches add to it: "+1" -> "+4"). */
  pop?: { h: HudPop; value: number; gold: boolean };
  /** Their streak call-out, re-used while it is up, and when (game ms) it last made a fuss. */
  streakImg?: Phaser.GameObjects.Image;
  streakAt: number;
}

type DropKind = 'chip' | 'gold' | 'capsule';

interface Drop {
  kind: DropKind;
  x: number;
  y: number;
  fallT: number;
  fallTotal: number;
  state: 'falling' | 'landed' | 'wobble' | 'gone';
  life: number;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  /** Landing target for chips (a disc that tightens as the chip falls). */
  ring?: Phaser.GameObjects.Image;
  /** Fake capsules: the blast area drawn on the floor, and its outline (offsets from the landing spot). */
  zone?: Phaser.GameObjects.Graphics;
  zonePts?: Phaser.Types.Math.Vector2Like[];
  /** Soft additive glow that makes chips pop off the flagstones. */
  glow?: Phaser.GameObjects.Image;
  /** Golden chips: a turning star glint behind the chip. */
  glint?: Phaser.GameObjects.Image;
  /** Capsule fuse: wobble phase, and how many warning glints have fired. */
  wob: number;
  warned: number;
  /** Golden chips: time to the next sparkle of their trail. */
  sparkT: number;
  /** Screen position and depth scale of the landing spot. */
  sx: number;
  sy: number;
  ss: number;
}

const ARENA = { x: 250, y: 290, w: 1420, h: 640 };
/** Character scale at a depth scale of 1 (the perspective arena scales it by depth). */
const CHAR_SCALE = 0.58;
const CHAR_SCALE_3D = 0.66;
const FALL_MS = 950;
const DASH_MS = 190;
const DASH_CD = 1200;
/** A fake capsule's blast radius (arena units) and how long it wobbles before bursting. */
const BLAST = 170;
const FUSE_MS = 900;
/**
 * Floor decals (shadows, landing targets, blast areas) share one depth band: above the back wall
 * (250), below everyone standing on the floor, so they batch together and never cover a player.
 */
const FLOOR_DEPTH = 256;
/** Chip glows share one band just under the chips (all chips draw above the players). */
const GLOW_DEPTH = 1300;
/** Score pop-ups: size, and colours (white for chips, gold once a golden chip is in it). */
const POP_SIZE = 60;
const POP_WHITE = '#ffffff';
const POP_GOLD = '#ffe36b';
/** Points round a blast area's outline. */
const ZONE_SEGMENTS = 28;
const ZONE_DIRS = Array.from({ length: ZONE_SEGMENTS }, (_, i) => {
  const a = (i / ZONE_SEGMENTS) * Math.PI * 2;
  return { c: Math.cos(a), s: Math.sin(a) };
});

/**
 * Gleam Grab — chips rain onto the festival plaza. Collect the most in 45 seconds; golden
 * chips are worth 3; fake capsules wobble, then burst and knock players back. The last ten
 * seconds are a chip storm.
 */
export class GleamGrabScene extends BaseMinigame {
  private grabbers: Grabber[] = [];
  private drops: Drop[] = [];
  private spawnT = 0;
  private showerAt = 9000;
  /** Perspective arena: logical ARENA coordinates -> screen (null for the flat fallback art). */
  private map: QuadMap | null = null;
  private storm = false;
  private wrapped = false;
  /** Game-time clock for pulses (so they hold during a hit-stop). */
  private clock = 0;
  private goldEm?: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Scratch points for drawing blast areas (no per-frame allocation). */
  private scratch: Phaser.Types.Math.Vector2Like[] = ZONE_DIRS.map(() => ({ x: 0, y: 0 }));

  constructor() {
    super('mg-gleam-grab');
  }

  protected createArena(): void {
    this.duration = 45000;
    this.grabbers = [];
    this.drops = [];
    this.spawnT = 800;
    this.showerAt = 9000;
    this.map = null;
    this.storm = false;
    this.wrapped = false;
    this.clock = 0;
    this.goldEm = undefined;
    // Render the score pop-ups' text once now, not on the first catch (no hitch mid-round).
    titleTexture(this, '+1', POP_SIZE, POP_WHITE);
    titleTexture(this, '+3', POP_SIZE, POP_GOLD);
    if (this.textures.exists('fx-dot')) {
      // Gold dust shed by golden chips as they fall (and now and then while they wait).
      this.goldEm = this.add.particles(0, 0, 'fx-dot', {
        emitting: false,
        lifespan: { min: 380, max: 650 },
        speed: { min: 15, max: 70 },
        gravityY: 90,
        scale: { start: 0.7, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [0xfff3b0, 0xffd54a, 0xffffff],
        blendMode: 'ADD',
        maxParticles: LITE ? 60 : 140,
      });
      this.goldEm.setDepth(GLOW_DEPTH + 1);
    }
    const meta3d = this.cache.json.get('rendered-gleam3d') as
      | { corners?: [number, number][]; wallTopY?: number; backLeftX?: number; backRightX?: number; tiers?: { y: number; x0: number; x1: number; scale: number }[] }
      | undefined;
    if (this.textures.exists('rendered-scene-gleam3d') && meta3d?.corners?.length === 4) {
      // Pre-rendered plaza seen through a perspective camera; gameplay maps onto its floor.
      this.map = new QuadMap(ARENA, meta3d.corners);
      const sky = ['rendered-sky-clear', 'rendered-sky-day'].find((k) => this.textures.exists(k));
      if (sky) this.add.image(GAME_WIDTH / 2, 540, sky).setDisplaySize(GAME_WIDTH * 1.04, 1124).setDepth(-100).setFlipX(true);
      this.add.image(0, 0, 'rendered-scene-gleam3d').setOrigin(0).setDepth(-50);
      if (meta3d.tiers?.length) this.buildStands(meta3d.tiers);
      else this.buildCrowd(meta3d.wallTopY ?? 314, meta3d.backLeftX ?? 300, meta3d.backRightX ?? 1620);
      if (this.textures.exists('rendered-scene-gleam3d_wall')) this.add.image(0, 0, 'rendered-scene-gleam3d_wall').setOrigin(0).setDepth(250);
      return;
    }
    if (this.textures.exists('rendered-scene-gleam')) {
      // Pre-rendered festival plaza on its floating island, with a cheering crowd behind the curb.
      if (this.textures.exists('rendered-sky-day')) this.add.image(GAME_WIDTH / 2, 540, 'rendered-sky-day').setDisplaySize(GAME_WIDTH * 1.04, 1124).setDepth(-100);
      this.add.image(0, 0, 'rendered-scene-gleam').setOrigin(0).setDepth(-50);
      this.buildCrowd();
      // The back wall again, drawn over the crowd so the spectators stand behind it.
      if (this.textures.exists('rendered-scene-gleam_wall')) this.add.image(0, 0, 'rendered-scene-gleam_wall').setOrigin(0).setDepth(250);
      return;
    }
    this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, 1080);
    addStrip(this, 0, 700, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setAlpha(0.9);
    this.add.image(960, 620, 'island-wide').setScale(1.7, 1.25).setOrigin(0.5, 0.36);
    this.add.image(960, 610, 'mg-plaza-floor').setDisplaySize(1560, 780);
    this.add.image(400, 200, 'bunting').setScale(1.1).setDepth(1);
    this.add.image(1520, 200, 'bunting').setScale(1.1).setDepth(1);
    for (const [x, y] of [
      [230, 250],
      [1690, 250],
    ]) {
      const l = this.add.image(x, y, 'lantern').setScale(0.8);
      this.tweens.add({ targets: l, angle: { from: -6, to: 6 }, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
  }

  /** Festival folk cheering from behind the back curb (bob, and hop when chips rain). */
  private crowd: Phaser.GameObjects.Sprite[] = [];

  private buildCrowd(wallTopY = 202, x0 = 250, x1 = 1670): void {
    this.crowd = [];
    const feetY = wallTopY + 30;
    const sx = (x: number) => x0 + ((x - 250) / 1420) * (x1 - x0);
    const folk: [NpcId, string, number][] = [
      ['mimi', 'happy', 262],
      ['packsprout', 'cheer', 340],
      ['ora', 'cheer', 650],
      ['pipper', 'happy', 740],
      ['wrench', 'laugh', 1185],
      ['mimi', 'laugh', 1265],
      ['packsprout', 'star', 1595],
      ['ora', 'wave', 1675],
    ];
    folk.push(['wrench', 'idea', 480], ['pipper', 'coin', 1440], ['mimi', 'apple', 930]);
    folk.forEach(([id, pose, lx], i) => {
      const x = sx(lx);
      const spr = this.add.sprite(x, feetY, NPC_ATLAS, npcFrame(id, pose));
      const o = standOrigin(NPC_ATLAS, npcFrame(id, pose));
      spr.setOrigin(o.x, o.y).setScale(0.42).setDepth(200 + i * 0.01).setFlipX(x > 960);
      this.tweens.add({ targets: spr, y: feetY - 8, duration: 420 + (i % 3) * 90, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 70 });
      this.crowd.push(spr);
    });
    // A second, smaller row further up the slope (slightly hazed) makes it read as a crowd.
    const ids: NpcId[] = ['ora', 'pipper', 'packsprout', 'wrench', 'mimi'];
    const poses: Record<NpcId, string[]> = {
      ora: ['cheer', 'wave', 'flag'],
      pipper: ['happy', 'wave', 'coin'],
      packsprout: ['cheer', 'happy', 'star'],
      wrench: ['laugh', 'idea', 'gadget'],
      mimi: ['happy', 'laugh', 'surprised'],
    };
    const backY = feetY - 44;
    for (let k = 0; k < 13; k++) {
      const id = ids[(k * 3) % ids.length];
      const pose = poses[id][k % 3];
      const x = sx(300 + k * 111 + ((k * 37) % 23));
      const spr = this.add.sprite(x, backY + ((k * 13) % 9), NPC_ATLAS, npcFrame(id, pose));
      const o = standOrigin(NPC_ATLAS, npcFrame(id, pose));
      spr.setOrigin(o.x, o.y).setScale(0.33).setDepth(190 + k * 0.01).setFlipX(k % 2 === 0).setTint(0xdfe6f2);
      this.tweens.add({ targets: spr, y: spr.y - 6, duration: 380 + (k % 4) * 80, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: k * 55 });
      this.crowd.push(spr);
    }
  }

  /** Spectators filling the bleacher tiers behind the back wall (front tier nearest, largest). */
  private buildStands(tiers: { y: number; x0: number; x1: number; scale: number }[]): void {
    this.crowd = [];
    const ids: NpcId[] = ['ora', 'pipper', 'packsprout', 'wrench', 'mimi'];
    const poses: Record<NpcId, string[]> = {
      ora: ['cheer', 'wave', 'flag', 'welcome'],
      pipper: ['happy', 'wave', 'coin', 'gift'],
      packsprout: ['cheer', 'happy', 'star', 'gift'],
      wrench: ['laugh', 'idea', 'gadget', 'tool'],
      mimi: ['happy', 'laugh', 'surprised', 'apple'],
    };
    let n = 0;
    // Full-figure spectators along the benches, shoulder to shoulder so each row overlaps the one
    // behind it; a gentle sway, the back rows a touch hazier.
    tiers.forEach((t, ti) => {
      const count = 15 - ti * 2;
      const step = (t.x1 - t.x0) / count;
      for (let k = 0; k < count; k++) {
        const id = ids[(n * 2 + ti) % ids.length];
        const pose = poses[id][(n + ti) % 4];
        const x = t.x0 + (k + 0.5) * step + (((n * 37) % 11) - 5);
        const frame = npcFrame(id, pose);
        const spr = this.add.sprite(x, t.y - 2, NPC_ATLAS, frame);
        const o = standOrigin(NPC_ATLAS, frame);
        spr.setOrigin(o.x, o.y).setScale(0.28 * t.scale).setDepth(200 - ti + k * 0.001).setFlipX(x > 960);
        const haze = ti === 0 ? 0xffffff : ti === 1 ? 0xf1f4fa : 0xe4e9f2;
        spr.setTint(haze);
        const shadow = this.add.image(x, t.y, 'fx-contact').setScale(0.55 * t.scale, 0.16 * t.scale).setAlpha(0.5).setDepth(199.9 - ti);
        void shadow;
        this.tweens.add({ targets: spr, angle: { from: -2, to: 2 }, duration: 900 + ((n * 53) % 5) * 90, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: (n * 61) % 500 });
        this.crowd.push(spr);
        n++;
      }
    });
  }

  private crowdCheer(): void {
    for (const [i, spr] of this.crowd.entries()) {
      const y = spr.y;
      this.tweens.add({ targets: spr, y: y - 10, duration: 150, yoyo: true, repeat: 1, delay: i * 25, ease: 'Quad.Out', onComplete: () => spr.setY(y) });
    }
  }

  /** Screen position + depth scale for a logical arena point. */
  private P(x: number, y: number): { x: number; y: number; s: number } {
    if (!this.map) return { x, y, s: 1 };
    const q = this.map.point(x, y);
    return { x: q.x, y: q.y, s: this.map.scaleAt(x, y) };
  }

  /**
   * The outline of a blast area on the floor: the arena-space circle it really covers, projected
   * through the floor's perspective (offsets from the projected centre), so what's drawn is exactly
   * what hits.
   */
  private floorOutline(x: number, y: number, r: number): Phaser.Types.Math.Vector2Like[] {
    const c = this.P(x, y);
    return ZONE_DIRS.map((d) => {
      const q = this.P(x + d.c * r, y + d.s * r);
      return { x: q.x - c.x, y: q.y - c.y };
    });
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const spots = [
      [ARENA.x + 180, ARENA.y + 120],
      [ARENA.x + ARENA.w - 180, ARENA.y + 120],
      [ARENA.x + 180, ARENA.y + ARENA.h - 80],
      [ARENA.x + ARENA.w - 180, ARENA.y + ARENA.h - 80],
    ];
    const [x, y] = spots[index % 4];
    const q = this.P(x, y);
    const c = new Character(this, q.x, q.y, p.characterId, { scale: (this.map ? CHAR_SCALE_3D : CHAR_SCALE) * q.s, slot: p.slot, marker: true });
    c.face(x > 960);
    p.character = c;
    this.grabbers.push({ p, c, x, y, vx: 0, vy: 0, dashT: 0, dashCd: 0, stunT: 0, popN: 0, popAt: -1e9, streak: 0, lastCatch: -1e9, trailT: 0, dustT: 0, streakAt: -1e9 });
  }

  protected override onStart(): void {
    for (const g of this.grabbers) g.c.play('wave');
  }

  /** Call-outs go up over the stands, clear of the plaza floor. */
  protected override bannerY(): number {
    return 240;
  }

  /** The last ten seconds: the chip storm, announced under "FINAL 10 SECONDS!". */
  protected override onFinalStretch(): void {
    this.storm = true;
    this.showFinalStretch('COIN STORM!');
    audio.play('cheer', { volume: 0.6 });
    this.crowdCheer();
    // Kick it off with a burst of chips spread over the plaza.
    for (let i = 0; i < 5; i++) this.spawnDrop(i === 2 ? 'gold' : 'chip');
  }

  // --- Drops -----------------------------------------------------------------------------------
  private spawnDrop(kind: DropKind, x?: number, y?: number): void {
    const px = x ?? ARENA.x + 40 + this.rng.next() * (ARENA.w - 80);
    const py = y ?? ARENA.y + 30 + this.rng.next() * (ARENA.h - 60);
    const frame = kind === 'capsule' ? '12' : '0';
    const q = this.P(px, py);
    const sprite = this.add.sprite(q.x, q.y - 700 * q.s, 'items', frame);
    const o = centerOrigin('items', frame);
    sprite.setOrigin(o.x, o.y).setScale((kind === 'gold' ? 0.48 : kind === 'capsule' ? 0.36 : 0.34) * q.s).setDepth(q.y + 1000);
    if (kind === 'capsule') sprite.play('capsule-idle');
    else sprite.play('chip-spin');
    if (kind === 'gold') sprite.setTint(0xffe27a);
    const glow =
      kind === 'capsule'
        ? undefined
        : this.add
            .image(q.x, q.y - 700 * q.s, 'fx-dot')
            .setScale((kind === 'gold' ? 3.8 : 2.6) * q.s)
            .setTint(kind === 'gold' ? 0xffd23a : 0xfff4dc)
            .setAlpha(kind === 'gold' ? 0.75 : 0.55)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(GLOW_DEPTH);
    const glint =
      kind === 'gold' && this.textures.exists('fx-rays')
        ? this.add
            .image(q.x, q.y - 700 * q.s, 'fx-rays')
            .setScale(0.3 * q.s)
            .setTint(0xffe27a)
            .setAlpha(0.8)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(GLOW_DEPTH)
        : undefined;
    // The falling drop's shadow grows as it nears the floor (a capsule's is bigger and redder).
    const shadow = this.add
      .image(q.x, q.y, 'fx-contact')
      .setScale(0.15 * q.s, 0.05 * q.s)
      .setAlpha(0.3)
      .setDepth(FLOOR_DEPTH);
    if (kind === 'capsule') shadow.setTint(0x6a1830);
    let ring: Phaser.GameObjects.Image | undefined;
    let zone: Phaser.GameObjects.Graphics | undefined;
    let zonePts: Phaser.Types.Math.Vector2Like[] | undefined;
    if (kind === 'capsule') {
      // A fake capsule shows the area its burst will hit from the moment it starts falling.
      zone = this.add.graphics().setPosition(q.x, q.y).setDepth(FLOOR_DEPTH + 0.5);
      zonePts = this.floorOutline(px, py, BLAST);
    } else {
      // Landing target: a disc that closes in on the spot as the chip falls (cyan, or amber for gold).
      ring = this.add.image(q.x, q.y, 'fx-target').setTint(kind === 'gold' ? 0xffa600 : 0x14c8f0).setAlpha(0.5).setScale(1.5 * q.s, 0.6 * q.s).setDepth(FLOOR_DEPTH + 1);
    }
    this.drops.push({ kind, x: px, y: py, fallT: FALL_MS, fallTotal: FALL_MS, state: 'falling', life: CHIP_LIFE, sprite, shadow, ring, zone, zonePts, glow, glint, wob: 0, warned: 0, sparkT: 0, sx: q.x, sy: q.y, ss: q.s });
  }

  /**
   * A fake capsule's blast area. Falling: a faint outline that firms up as it drops. Landed: a red
   * area that throbs faster and faster, filling from the centre out to the rim as the fuse burns
   * (u = 0..1), so everyone can see both where and when it will go off.
   */
  private drawZone(d: Drop, u: number): void {
    const g = d.zone;
    const pts = d.zonePts;
    if (!g || !pts) return;
    g.clear();
    if (d.state === 'falling') {
      g.fillStyle(0xff2d2d, 0.05 + 0.13 * u);
      this.fillOutline(g, pts, 1);
      g.lineStyle(4, 0xff3a3a, 0.25 + 0.55 * u);
      this.strokeOutline(g, pts, 1);
      return;
    }
    const throb = 0.5 + 0.5 * Math.sin(d.wob * 0.5);
    g.fillStyle(0xff2d2d, 0.16 + 0.16 * u + 0.12 * throb);
    this.fillOutline(g, pts, 1);
    g.fillStyle(0xff5533, 0.3 + 0.25 * u);
    this.fillOutline(g, pts, 0.12 + 0.88 * u);
    g.lineStyle(9, 0xffffff, 0.75 + 0.25 * throb);
    this.strokeOutline(g, pts, 1);
    g.lineStyle(5, 0xff2a2a, 1);
    this.strokeOutline(g, pts, 1);
  }

  private fillOutline(g: Phaser.GameObjects.Graphics, pts: Phaser.Types.Math.Vector2Like[], k: number): void {
    const s = this.scratch;
    for (let i = 0; i < pts.length; i++) {
      s[i].x = (pts[i].x ?? 0) * k;
      s[i].y = (pts[i].y ?? 0) * k;
    }
    g.fillPoints(s, true);
  }

  private strokeOutline(g: Phaser.GameObjects.Graphics, pts: Phaser.Types.Math.Vector2Like[], k: number): void {
    const s = this.scratch;
    for (let i = 0; i < pts.length; i++) {
      s[i].x = (pts[i].x ?? 0) * k;
      s[i].y = (pts[i].y ?? 0) * k;
    }
    g.strokePoints(s, true, true);
  }

  private updateDrops(dt: number): void {
    for (const d of this.drops) {
      if (d.state === 'gone') continue;
      if (d.state === 'falling') {
        d.fallT -= dt;
        const t = 1 - Math.max(0, d.fallT) / d.fallTotal;
        d.sprite.y = d.sy - (700 * (1 - t * t) + 20) * d.ss;
        d.glow?.setY(d.sprite.y);
        d.glint?.setY(d.sprite.y).setAngle(this.clock * 0.12);
        const grow = d.kind === 'capsule' ? 1.35 : 1;
        d.shadow.setScale((0.15 + t * 0.62) * d.ss * grow, (0.05 + t * 0.2) * d.ss * grow).setAlpha(0.3 + t * 0.55);
        if (d.ring) {
          const rs = 1.5 - t * 0.95;
          d.ring.setScale(rs * d.ss, rs * 0.4 * d.ss).setAlpha(0.4 + t * 0.6);
        }
        if (d.zone) this.drawZone(d, t);
        if (d.kind === 'gold') this.goldSparkle(d, dt, LITE ? 70 : 35);
        if (d.fallT <= 0) this.land(d);
      } else if (d.state === 'landed') {
        d.life -= dt;
        if (d.glow) d.glow.setY(d.sprite.y).setAlpha((d.kind === 'gold' ? 0.55 : 0.4) + 0.25 * Math.sin(this.clock / 160 + d.x));
        d.glint?.setY(d.sprite.y).setAngle(this.clock * 0.06);
        if (d.kind === 'gold') this.goldSparkle(d, dt, LITE ? 260 : 140);
        if (d.life < 1000) d.sprite.setAlpha(Math.floor(d.life / 120) % 2 ? 0.35 : 1);
        if (d.life <= 0) this.removeDrop(d);
      } else if (d.state === 'wobble') {
        d.life -= dt;
        this.fuse(d, dt);
        if (d.life <= 0) this.burst(d);
      }
    }
    // Drop the finished ones in place (no new array every frame).
    let w = 0;
    for (const d of this.drops) if (d.state !== 'gone') this.drops[w++] = d;
    this.drops.length = w;
  }

  /** Gold dust trailing a golden chip (every `every` ms). */
  private goldSparkle(d: Drop, dt: number, every: number): void {
    d.sparkT -= dt;
    if (d.sparkT > 0 || !this.goldEm) return;
    d.sparkT = every;
    this.goldEm.emitParticleAt(d.sx + (Math.random() - 0.5) * 30 * d.ss, d.sprite.y + (Math.random() - 0.5) * 24 * d.ss, 1);
  }

  private land(d: Drop): void {
    d.ring?.destroy();
    d.ring = undefined;
    d.sprite.y = d.sy - 20 * d.ss;
    audio.play(d.kind === 'capsule' ? 'land' : 'pop', { volume: 0.4, throttleMs: 50 });
    this.fx.vfx('dust', d.sx, d.sy, { scale: 0.25 * d.ss, duration: 360, alpha: 0.6, depth: FLOOR_DEPTH + 2 });
    this.tweens.add({ targets: d.sprite, y: d.sy - 44 * d.ss, duration: 150, yoyo: true, ease: 'Quad.Out' });
    if (d.kind === 'capsule') {
      d.state = 'wobble';
      d.life = FUSE_MS;
      d.sprite.setTint(0xff9a9a);
      d.shadow.setScale(0.95 * d.ss, 0.3 * d.ss).setAlpha(0.8);
      audio.play('fuse', { volume: 0.5, throttleMs: 120 });
      this.drawZone(d, 0);
      return;
    }
    d.state = 'landed';
    d.life = this.storm ? STORM_CHIP_LIFE : CHIP_LIFE;
    // a firm contact shadow so the resting chip sits on the flagstones
    d.shadow.setScale(0.62 * d.ss, 0.2 * d.ss).setAlpha(0.7);
    if (d.kind === 'gold') {
      this.fx.sparks(d.sx, d.sy - 30 * d.ss, LITE ? 6 : 10);
      shockwave(this, d.sx, d.sy, { radius: 70 * d.ss, ratio: 0.42, color: 0xffd23a, alpha: 0.8, duration: 360, depth: FLOOR_DEPTH + 1 });
    }
  }

  /**
   * A landed fake capsule's fuse: it wobbles harder and faster, flashes red glints (with rising
   * warning pips), and swells over its last moments before it bursts.
   */
  private fuse(d: Drop, dt: number): void {
    const u = 1 - Math.max(0, d.life) / FUSE_MS;
    d.wob += (dt / 1000) * (3 + 9 * u) * Math.PI * 2;
    d.sprite.setAngle(Math.sin(d.wob) * (7 + 13 * u));
    const swell = 1 + Math.max(0, (u - 0.72) / 0.28) * 0.3;
    d.sprite.setScale(0.36 * d.ss * swell);
    d.sprite.setTint(u > 0.82 && Math.sin(d.wob * 2) > 0 ? 0xffffff : 0xff9a9a);
    const marks = [0.3, 0.6, 0.85];
    if (d.warned < marks.length && u >= marks[d.warned]) {
      // A sharp red glint on the capsule, and a pip that climbs with each one.
      this.fx.vfx('sparkle', d.sx + 10 * d.ss, d.sprite.y - 30 * d.ss, { scale: 0.34 * d.ss, duration: 260, tint: 0xff5a5a, blend: 'add', depth: d.sprite.depth + 1 });
      audio.play('warn', { volume: 0.22, rate: 1 + d.warned * 0.14, throttleMs: 90 });
      d.warned++;
    }
    this.drawZone(d, u);
  }

  private removeDrop(d: Drop): void {
    d.state = 'gone';
    this.tweens.killTweensOf(d.sprite);
    d.sprite.destroy();
    d.shadow.destroy();
    d.ring?.destroy();
    d.zone?.destroy();
    d.glow?.destroy();
    d.glint?.destroy();
  }

  private burst(d: Drop): void {
    audio.play('explosion', { volume: 0.7 });
    this.fx.vfx('explosion', d.sx, d.sy - 40 * d.ss, { scale: 0.62 * d.ss, duration: 520 });
    // A shock ring runs out across the floor to the edge of the blast, throwing up dust at its rim.
    const pts = d.zonePts ?? [];
    let rx = BLAST * d.ss;
    let ry = rx * 0.6;
    if (pts.length) {
      rx = Math.max(...pts.map((p) => Math.abs(p.x ?? 0)));
      ry = Math.max(...pts.map((p) => Math.abs(p.y ?? 0)));
    }
    shockwave(this, d.sx, d.sy, { radius: rx * 1.1, ratio: ry / rx, color: 0xffb070, alpha: 0.95, duration: 420, depth: FLOOR_DEPTH + 1 });
    shockwave(this, d.sx, d.sy, { radius: rx * 0.7, ratio: ry / rx, color: 0xffffff, alpha: 0.7, duration: 300, depth: FLOOR_DEPTH + 1 });
    const puffs = LITE ? 4 : 7;
    for (let i = 0; i < puffs && pts.length; i++) {
      const p = pts[Math.floor((i / puffs) * pts.length)];
      const px = p.x ?? 0;
      const py = p.y ?? 0;
      this.fx.vfx('dust', d.sx + px * 0.85, d.sy + py * 0.85, { scale: 0.3 * d.ss, duration: 460, alpha: 0.7, dx: px * 0.25, dy: py * 0.25, depth: FLOOR_DEPTH + 2 });
    }
    let first: Grabber | null = null;
    for (const g of this.grabbers) {
      const dd = dist(g.x, g.y, d.x, d.y);
      if (dd < BLAST && this.canHit(g.p)) {
        this.markHit(g.p, 1100);
        const ang = Math.atan2(g.y - d.y, g.x - d.x);
        const weight = CHARACTERS[g.p.characterId].handling.weight;
        const force = 1050 / weight;
        g.vx = Math.cos(ang) * force;
        g.vy = Math.sin(ang) * force * 0.7;
        g.stunT = 750;
        g.trailT = 650;
        g.dustT = 0;
        g.streak = 0;
        g.c.play('stunned', { returnTo: 'idle' });
        // Blown off their feet: a hop, and stars circling their head.
        this.tweens.add({ targets: g.c.sprite, y: { from: 0, to: -46 }, duration: 170, yoyo: true, ease: 'Quad.Out', onComplete: () => g.c.sprite.setY(0) });
        // The badge rides the hop, so it never lands on their face.
        const badge = g.c.marker;
        if (badge) {
          // Its resting height, kept from the first hop (a second hit mid-hop must not strand it).
          const by = (badge.getData('restY') as number | undefined) ?? badge.y;
          badge.setData('restY', by);
          this.tweens.killTweensOf(badge);
          this.tweens.add({ targets: badge, y: { from: by, to: by - 46 }, duration: 170, yoyo: true, ease: 'Quad.Out', onComplete: () => badge.setY(by) });
        }
        const q = this.P(g.x, g.y);
        this.fx.vfx('starSwirl', q.x, q.y + g.c.headY * g.c.scaleY - 10, { scale: 0.42 * q.s, duration: 700, blend: 'add' });
        audio.play('hit');
        this.rumble(g.p, 0.6, 0.4, 220);
        if (!first) first = g;
      }
    }
    if (first) {
      // An impact: a freeze-frame and a camera kick the way the blast threw its victim.
      this.hitStop(90);
      const q0 = this.P(d.x, d.y);
      const q1 = this.P(first.x, first.y);
      const kx = q1.x - q0.x;
      const ky = q1.y - q0.y;
      const len = Math.hypot(kx, ky) || 1;
      kick(this, (kx / len) * 12, (ky / len) * 12, 160);
    } else this.fx.shake(0.004, 150);
    this.removeDrop(d);
  }

  private collect(g: Grabber, d: Drop): void {
    const value = d.kind === 'gold' ? 3 : 1;
    g.p.score += value;
    g.streak = nextStreak(g.streak, g.lastCatch, this.elapsed);
    g.lastCatch = this.elapsed;
    // The chime climbs with a quick streak of catches.
    if (d.kind === 'gold') audio.play('goldChip', { volume: 0.9 });
    else audio.play('chipGain', { rate: streakPitch(g.streak) * (0.98 + Math.random() * 0.04), throttleMs: 30 });
    this.popScore(g, d, value);
    if (streakCallout(g.streak)) this.streakFlourish(g);
    if (d.kind === 'gold') {
      this.fx.sparks(d.sx, d.sy - 40 * d.ss, LITE ? 12 : 20);
      g.c.play('celebrate');
    }
    this.rumble(g.p, 0.1, 0.2, 50);
    const spr = d.sprite;
    d.state = 'gone';
    d.glow?.destroy();
    d.glint?.destroy();
    d.shadow.destroy();
    d.ring?.destroy();
    this.tweens.killTweensOf(spr);
    const gq = this.P(g.x, g.y);
    this.tweens.add({ targets: spr, x: gq.x, y: gq.y - 150 * gq.s, scale: 0.08, alpha: 0.2, duration: 200, ease: 'Quad.In', onComplete: () => spr.destroy() });
  }

  /**
   * The "+1" pops off to the side of the grabber (never on the marker) and flies to their capsule,
   * where the number ticks up as it lands. Catches in quick succession add to the pop-up still
   * gathering ("+1" -> "+4") instead of each throwing its own, so a lucky scoop reads as one big
   * haul rather than a swarm.
   */
  private popScore(g: Grabber, d: Drop, value: number): void {
    const slot = g.p.slot;
    this.holdHud(slot, value);
    const open = g.pop;
    if (open && open.h.gathering && open.h.image.active) {
      open.value += value;
      open.gold ||= d.kind === 'gold';
      open.h.retitle(`+${open.value}`, open.gold ? POP_GOLD : POP_WHITE);
      return;
    }
    // Successive pop-ups fan out to alternate sides.
    g.popN = this.elapsed - g.popAt < 650 ? g.popN + 1 : 0;
    g.popAt = this.elapsed;
    const side = g.popN % 2 === 0 ? 1 : -1;
    const fan = g.popN % 3;
    const h = this.hudPoint(slot);
    const entry: { h?: HudPop; value: number; gold: boolean } = { value, gold: d.kind === 'gold' };
    entry.h = popToHud(this, d.sx + side * (64 + fan * 16) * d.ss, d.sy - (70 + fan * 24) * d.ss, `+${value}`, h.x, h.y, {
      color: entry.gold ? POP_GOLD : POP_WHITE,
      size: POP_SIZE,
      onArrive: () => {
        this.releaseHud(slot, entry.value);
        this.bumpHud(slot);
        if (g.pop === entry) g.pop = undefined;
      },
    });
    g.pop = entry as { h: HudPop; value: number; gold: boolean };
  }

  /**
   * "x3 STREAK!" in the player's colour over their head, with a burst of sparks. One call-out per
   * player: a longer streak landing while it's up just updates it (and only makes a fresh fuss
   * after a moment), so a quick scoop never stacks them.
   */
  private streakFlourish(g: Grabber): void {
    const q = this.P(g.x, g.y);
    const y = q.y + g.c.headY * Math.abs(g.c.scaleY) - 60;
    const slot = g.p.slot;
    const key = titleTexture(this, `x${g.streak} STREAK!`, 46, PLAYER_COLORS_CSS[slot]);
    let t = g.streakImg;
    if (t?.active) {
      this.tweens.killTweensOf(t);
      t.setTexture(key).setPosition(q.x, y).setAlpha(1).setScale(1.3).setAngle(0);
    } else {
      t = this.add.image(q.x, y, key).setDepth(5600).setScale(0.3).setAngle(-6);
      g.streakImg = t;
    }
    const img = t;
    this.tweens.add({ targets: img, scale: 1, angle: 0, duration: 240, ease: 'Back.Out' });
    this.tweens.add({
      targets: img,
      y: y - 50,
      alpha: 0,
      delay: 620,
      duration: 320,
      ease: 'Quad.In',
      onComplete: () => {
        img.destroy();
        if (g.streakImg === img) g.streakImg = undefined;
      },
    });
    if (this.elapsed - g.streakAt < 450) return;
    g.streakAt = this.elapsed;
    shockwave(this, q.x, y, { radius: 110, ratio: 0.55, color: PLAYER_COLORS[slot], alpha: 0.8, duration: 380, depth: 5590 });
    this.fx.sparks(q.x, y, LITE ? 8 : 14);
    audio.play('streak', { volume: 0.7, rate: Math.sqrt(streakPitch(g.streak)) });
  }

  // --- Frame -----------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.clock += dt;
    // Spawning gets busier over time, and busier still in the storm.
    this.spawnT -= dt;
    const progress = this.elapsed / this.duration;
    if (this.spawnT <= 0) {
      this.spawnT = spawnInterval(progress, this.storm);
      const roll = this.rng.next();
      const capChance = 0.1 + progress * 0.1;
      this.spawnDrop(roll < capChance ? 'capsule' : roll < capChance + goldChance(this.storm) ? 'gold' : 'chip');
      if (this.players.length > 2 && this.rng.chance(0.35)) this.spawnDrop('chip');
      if (this.storm && this.rng.chance(0.5)) this.spawnDrop('chip');
    }
    // The storm is one long shower, so the timed showers stop once it begins.
    if (this.elapsed > this.showerAt && this.duration - this.elapsed > STORM_MS) {
      this.showerAt += 11000;
      const cx = ARENA.x + 200 + this.rng.next() * (ARENA.w - 400);
      const cy = ARENA.y + 150 + this.rng.next() * (ARENA.h - 300);
      audio.play('cheer', { volume: 0.5 });
      for (let i = 0; i < 7; i++) this.spawnDrop(i === 3 ? 'gold' : 'chip', cx + Math.cos(i) * 130, cy + Math.sin(i * 1.7) * 90);
      this.crowdCheer();
    }
    this.updateDrops(dt);
    // Players
    for (const g of this.grabbers) {
      const c = g.p.controls;
      const hand = CHARACTERS[g.p.characterId].handling;
      g.dashCd = Math.max(0, g.dashCd - dt);
      if (g.stunT > 0) {
        g.stunT -= dt;
        drift(g, dt, 5);
      } else if (g.dashT > 0) {
        g.dashT -= dt;
        drift(g, dt, 2);
        if (Math.random() < 0.5) {
          const q = this.P(g.x, g.y);
          this.fx.vfx('dust', q.x, q.y, { scale: 0.18 * q.s, duration: 300, alpha: 0.5, depth: q.y - 1 });
        }
        if (g.dashT <= 0) g.c.play('run');
      } else {
        steer(g, c.moveX, c.moveY, dt, { maxSpeed: 440 * hand.speed, accel: 15 * hand.accel, friction: 8 });
        if (c.pressed('A') && g.dashCd <= 0) {
          const mx = c.moveX || (g.c.isFacingLeft ? -1 : 1);
          const my = c.moveY;
          const m = Math.hypot(mx, my) || 1;
          g.vx = (mx / m) * 1150 * hand.speed;
          g.vy = (my / m) * 1150 * hand.speed * 0.8;
          g.dashT = DASH_MS;
          g.dashCd = DASH_CD;
          g.c.play('dash', { force: true });
          audio.play('whoosh', { volume: 0.6 });
          this.rumble(g.p, 0.2, 0.3, 80);
        }
      }
      // Knocked back by a burst: a trail of dust puffs while they skid.
      if (g.trailT > 0) {
        g.trailT -= dt;
        g.dustT -= dt;
        if (g.dustT <= 0 && Math.hypot(g.vx, g.vy) > 140) {
          g.dustT = LITE ? 75 : 45;
          const q = this.P(g.x, g.y);
          this.fx.vfx('dust', q.x, q.y, { scale: 0.24 * q.s, duration: 420, alpha: 0.7, depth: q.y - 1 });
        }
      }
      clampRect(g, ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    }
    for (let i = 0; i < this.grabbers.length; i++) {
      for (let j = i + 1; j < this.grabbers.length; j++) {
        const a = this.grabbers[i];
        const b = this.grabbers[j];
        separate(a, b, 118, CHARACTERS[a.p.characterId].handling.weight, CHARACTERS[b.p.characterId].handling.weight);
      }
    }
    // Pickups (a chip can be snatched just as it lands).
    for (const d of this.drops) {
      if (d.kind === 'capsule' || d.state === 'gone') continue;
      if (d.state === 'falling' && d.fallT > 110) continue;
      let best: Grabber | null = null;
      let bestD = 66;
      for (const g of this.grabbers) {
        if (g.stunT > 0) continue;
        const dd = dist(g.x, g.y, d.x, d.y);
        if (dd < bestD) {
          bestD = dd;
          best = g;
        }
      }
      if (best) this.collect(best, d);
    }
    this.syncVisuals();
  }

  private syncVisuals(): void {
    for (const g of this.grabbers) {
      const q = this.P(g.x, g.y);
      g.c.setPosition(q.x, q.y).setDepth(q.y);
      if (this.map) g.c.setScale(CHAR_SCALE_3D * q.s);
      if (Math.abs(g.vx) > 40) g.c.face(g.vx < 0);
      if (g.stunT <= 0 && g.dashT <= 0 && this.phase !== 'finished') {
        const moving = Math.hypot(g.vx, g.vy) > 70;
        if (moving && g.c.current !== 'run') g.c.play('run');
        else if (!moving && g.c.current === 'run') g.c.play('idle');
      }
    }
  }

  protected override ambient(): void {
    if (this.phase !== 'playing') this.syncVisuals();
  }

  protected override end(): void {
    const first = !this.wrapped;
    this.wrapped = true;
    if (first) {
      // Everyone stops where they are, so the finish poses aren't run over by a running cycle.
      for (const g of this.grabbers) {
        g.vx = 0;
        g.vy = 0;
        g.dashT = 0;
        g.trailT = 0;
        if (g.c.current === 'run' || g.c.current === 'dash') g.c.play('idle', { force: true });
      }
    }
    super.end();
    if (first) this.crowdCheer();
  }

  // --- CPU -------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const g = this.grabbers.find((x) => x.p === p);
    if (!g) return;
    const sk = this.skill(p);
    const b = p.brain;
    b.timer -= dt;
    if (b.timer <= 0) {
      b.timer = sk.think * (0.8 + Math.random() * 0.4);
      b.target = undefined;
      b.mode = 'seek';
      // Danger first: flee wobbling capsules.
      const danger = this.drops.find((d) => d.kind === 'capsule' && (d.state === 'wobble' || d.fallT < 500) && dist(g.x, g.y, d.x, d.y) < 200);
      if (danger && Math.random() < sk.accuracy + 0.1) {
        const ang = Math.atan2(g.y - danger.y, g.x - danger.x);
        b.target = { x: g.x + Math.cos(ang) * 260, y: g.y + Math.sin(ang) * 260 };
        b.mode = 'flee';
      } else if (Math.random() < sk.mistake) {
        b.target = { x: ARENA.x + Math.random() * ARENA.w, y: ARENA.y + Math.random() * ARENA.h };
      } else {
        let best: Drop | null = null;
        let bestScore = -Infinity;
        for (const d of this.drops) {
          if (d.kind === 'capsule' || d.state === 'gone') continue;
          const dd = dist(g.x, g.y, d.x, d.y);
          const eta = (dd / 440) * 1000;
          if (d.state === 'falling' && eta < d.fallT - 400) continue;
          const value = d.kind === 'gold' ? 3 : 1;
          // Rivals closer to it make it less attractive.
          const rival = Math.min(...this.grabbers.filter((o) => o !== g).map((o) => dist(o.x, o.y, d.x, d.y)), 9999);
          // …and so does a chip another CPU is already heading for (they spread out instead of piling up).
          const claimed = this.players.some((o) => o !== g.p && o.brain.target && dist(o.brain.target.x, o.brain.target.y, d.x, d.y) < 40);
          const score = value * 300 - dd - (rival < dd ? 120 : 0) - (claimed ? 260 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = d;
          }
        }
        if (best) b.target = { x: best.x, y: best.y };
      }
      if (b.target && b.mode === 'seek' && g.dashCd <= 0 && dist(g.x, g.y, b.target.x, b.target.y) > 280 && Math.random() < sk.accuracy * 0.6) b.n = 1;
    }
    const t = b.target;
    if (!t || g.stunT > 0) {
      vc.setMove(0, 0);
      return;
    }
    const dx = t.x - g.x;
    const dy = t.y - g.y;
    const dd = Math.hypot(dx, dy);
    if (dd < 18) vc.setMove(0, 0);
    else {
      const noise = sk.aimNoise * 0.3;
      vc.setMove(dx / dd + (Math.random() - 0.5) * noise, dy / dd + (Math.random() - 0.5) * noise);
    }
    if (b.n === 1) {
      b.n = 0;
      vc.tap('A');
    }
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} coins` }));
  }
}
