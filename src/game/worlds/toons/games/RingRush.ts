import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { GAME_WIDTH, PLAYER_COLORS, PLAYER_COLORS_CSS } from '../../../constants';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../../data/npcs';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { kick, popToHud, punch, shockwave, titleTexture, type HudPop } from '../../../minigames/juice';
import { AFX, burst, ensureArenaFxTextures, RingPool, Spray } from '../../../minigames/games/arenaFx';
import { bakeWord, calmMotion, WordPops } from '../../../minigames/games/stageKit';
import { LITE } from '../../../perf';
import { standOrigin } from '../../../util/spriteUtil';
import { finishAtlas, hasFrame, queueAtlas } from '../toonsKit';
import {
  BIG_RING,
  BOT_DX,
  CRAWLER_CLEAR,
  DASH_CD,
  DASH_MS,
  FAR_PARALLAX,
  GRAVITY,
  INVULN_MS,
  isHazard,
  JUMP_V,
  LANE_MS,
  LANE_Y,
  LANES,
  laneValue,
  PERIOD,
  RING_DX,
  RING_DZ,
  RING_LIFT,
  ringsBumped,
  ringsLost,
  ROUND_MS,
  RUN_X,
  RushCourse,
  scrollSpeed,
  SPRING_V,
  TRACK_IMG_Y,
  X_MAX,
  X_MIN,
  type ItemKind,
  type Seen,
} from './ringRushLogic';

// --- Art ---------------------------------------------------------------------------------------
/** Rendered scenery (scripts/art/worlds/toons/mg_rush.py): two layers that tile every 1920 px. */
const IMG_FAR = 'rendered-scene-toons_rush_far';
const IMG_TRACK = 'rendered-scene-toons_rush_track';
/** Sprite atlas: rings, the two robot critters, spring, propeller, debris. */
const ATLAS = 'rendered-toons-rush';
const CHAR_SCALE = 0.5;
/** Items spawn just past the right edge and are recycled past the left. */
const SPAWN_X = 2060;
const DESPAWN_X = -160;
/** Scattered rings: how long they last, when they start blinking, and the grab delay. */
const SCATTER_LIFE = 2700;
const SCATTER_BLINK = 900;
const SCATTER_GRAB = 320;
/** A buzzer hits anyone whose feet are below this (only a spring clears it). */
const BUZZER_CLEAR = 175;
/** Ring-streak call-outs every this many rings without a hit. */
const STREAK_STEP = 10;
const POP_SIZE = 58;
/** Festival folk cheering along the back of the track (they scroll past with it). */
const FANS: [NpcId, string][] = [
  ['ora', 'cheer'],
  ['pipper', 'happy'],
  ['packsprout', 'cheer'],
  ['wrench', 'laugh'],
  ['mimi', 'happy'],
  ['ora', 'flag'],
  ['packsprout', 'star'],
  ['pipper', 'wave'],
];
const FAN_Y = 452;
const FAN_GAP = 330;
const WORDS = {
  bonk: { key: 'rr-w-bonk', text: 'BONK!', size: 44, fill: ['#fff6c4', '#ffb12a'] },
  ouch: { key: 'rr-w-ouch', text: 'OUCH!', size: 44, fill: ['#ffe1da', '#ff6b5e'] },
  bump: { key: 'rr-w-bump', text: 'BUMP!', size: 40, fill: ['#e9f7ff', '#6fc8ff'] },
  boing: { key: 'rr-w-boing', text: 'BOING!', size: 40, fill: ['#fff0f6', '#ff7ab8'] },
  big: { key: 'rr-w-big', text: '+5 RINGS!', size: 46, fill: ['#fffbe0', '#ffd84a'] },
} as const;

type Kind = ItemKind | 'scatter';

interface Item {
  id: number;
  kind: Kind;
  active: boolean;
  lane: number;
  /** Continuous lane position (scattered rings drift between lanes). */
  laneF: number;
  laneTo: number;
  wx: number;
  z: number;
  /** Scattered rings: world velocity, life left, grab delay. */
  vx: number;
  vz: number;
  life: number;
  grab: number;
  /** Robots being smashed (no longer dangerous). */
  dying: boolean;
  phase: number;
  spr: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  prop?: Phaser.GameObjects.Image;
}

interface Runner {
  p: MgPlayer;
  c: Character;
  lane: number;
  laneF: number;
  laneFrom: number;
  laneT: number;
  x: number;
  xv: number;
  z: number;
  vz: number;
  jumpBuf: number;
  dashT: number;
  dashCd: number;
  /** Slots already bumped by the current spin-dash (bit mask). */
  bumped: number;
  invuln: number;
  stun: number;
  armed: boolean;
  streak: number;
  markerY: number;
  aura: Phaser.GameObjects.Image;
  /** While spinning the sprite pivots round its middle: how far that sits above the feet (local px). */
  spinDy: number;
  pop?: { h: HudPop; value: number };
  trailT: number;
  // CPU plan
  cpuLane: number;
  cpuTap: number;
  cpuPlan: number;
  cpuPlanDx: number;
  cpuSkip: boolean;
}

/**
 * Ring Rush — a four-lane auto-runner over checkered green hills. Switch lanes to follow the rings,
 * jump the wind-up crawlers (A), spin-dash through anything (X, rivals included) and ride springs up
 * the ring arcs. A robot hit scatters half your rings for anyone to grab. Most rings after 45 s wins.
 */
export class RingRushScene extends BaseMinigame {
  private runners: Runner[] = [];
  private items: Item[] = [];
  private pending: { kind: ItemKind; lane: number; wx: number; z: number }[] = [];
  private course!: RushCourse;
  private scroll = 0;
  private speed = 0;
  /** 0 before GO, easing to 1 as the runners set off (and back to 0 after the finish). */
  private speedK = 0;
  private fever = false;
  private clock = 0;
  private nextId = 1;
  private hasArt = false;
  private far: Phaser.GameObjects.Image[] = [];
  private track: Phaser.GameObjects.Image[] = [];
  private words!: WordPops;
  private rings!: RingPool;
  private sparks?: Spray;
  private streaks?: Spray;
  private debris?: Spray;
  private seen: Seen[] = Array.from({ length: 160 }, () => ({ lane: 0, dx: 0, kind: 'ring' as Kind, z: 0 }) as Seen);
  private seenN = 0;
  private fans: { spr: Phaser.GameObjects.Sprite; wx: number; hop: number }[] = [];
  private wrapped = false;

  constructor() {
    super('mg-ring-rush');
  }

  preload(): void {
    queueAtlas(this, ATLAS, 'toons_rush');
  }

  // --- Arena -------------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = ROUND_MS;
    this.runners = [];
    this.items = [];
    this.pending = [];
    this.scroll = 0;
    this.speed = 0;
    this.speedK = 0;
    this.fever = false;
    this.clock = 0;
    this.nextId = 1;
    this.wrapped = false;
    this.hasArt = finishAtlas(this, ATLAS);
    this.course = new RushCourse(this.rng.fork(), 1250);
    ensureArenaFxTextures(this);
    this.fallbackArt();
    for (const w of Object.values(WORDS)) bakeWord(this, w.key, w.text, { size: w.size, fill: w.fill });
    for (let n = 1; n <= 8; n++) titleTexture(this, `+${n}`, POP_SIZE, '#ffe36b');
    this.words = new WordPops(this, 7000, 16);
    this.rings = new RingPool(this, 14);
    const sky = ['rendered-sky-clear', 'rendered-sky-day'].find((k) => this.textures.exists(k));
    if (sky) this.add.image(GAME_WIDTH / 2, 540, sky).setDisplaySize(GAME_WIDTH * 1.04, 1124).setDepth(-100);
    else this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, 1080).setDepth(-100);
    this.far = [];
    this.track = [];
    const farKey = this.textures.exists(IMG_FAR) ? IMG_FAR : 'rr-far-fb';
    const trackKey = this.textures.exists(IMG_TRACK) ? IMG_TRACK : 'rr-track-fb';
    for (let i = 0; i < 2; i++) {
      this.far.push(this.add.image(i * PERIOD, 0, farKey).setOrigin(0).setDepth(-60));
      this.track.push(this.add.image(i * PERIOD, TRACK_IMG_Y, trackKey).setOrigin(0).setDepth(-40));
    }
    this.sparks = new Spray(this, 'fx-dot', { depth: 6500, reserve: LITE ? 40 : 90, lifespan: [260, 520], gravity: 500, scale: { start: 0.55, end: 0 }, tint: [0xfff3b0, 0xffd54a, 0xffffff], add: true });
    this.streaks = new Spray(this, AFX.streak, { depth: 1200, reserve: LITE ? 24 : 60, lifespan: [160, 300], scale: { start: 1.1, end: 0.4 }, alpha: { start: 0.8, end: 0 }, add: true, align: true });
    if (this.hasArt) this.debris = new Spray(this, ATLAS, { depth: 6400, reserve: LITE ? 16 : 36, lifespan: [420, 700], gravity: 1500, scale: { start: 0.9, end: 0.6 }, spin: 0.08, frame: 'gear' });
    else this.debris = new Spray(this, AFX.chip, { depth: 6400, reserve: LITE ? 16 : 36, lifespan: [420, 700], gravity: 1500, tint: [0xdfe4ea, 0xb9c2cf], spin: 0.08 });
    this.buildFans();
    // The first stretch of course is laid out before GO, so rings are already waiting down the lanes.
    this.layCourse();
    this.spawnDue();
    this.syncItems();
  }

  /** Stand-in art when the rendered scenery or sprites are missing (the game stays playable). */
  private fallbackArt(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const tex = (key: string, w: number, h: number, draw: () => void) => {
      if (this.textures.exists(key)) return;
      g.clear();
      draw();
      g.generateTexture(key, w, h);
    };
    tex('rr-ring', 76, 76, () => {
      g.lineStyle(12, 0xc98a1b, 1);
      g.strokeCircle(38, 38, 30);
      g.lineStyle(7, 0xffd23f, 1);
      g.strokeCircle(38, 37, 30);
    });
    tex('rr-bigring', 130, 130, () => {
      g.lineStyle(20, 0xc98a1b, 1);
      g.strokeCircle(65, 65, 52);
      g.lineStyle(12, 0xffe066, 1);
      g.strokeCircle(65, 64, 52);
    });
    tex('rr-crawler', 120, 90, () => {
      g.fillStyle(0x3a3444, 1);
      g.fillEllipse(60, 78, 100, 20);
      g.fillStyle(0xff6a2b, 1);
      g.fillEllipse(66, 52, 90, 60);
      g.fillStyle(0xb9c2cf, 1);
      g.fillCircle(18, 56, 16);
      g.fillStyle(0xffe46b, 1);
      g.fillCircle(12, 52, 6);
    });
    tex('rr-buzzer', 96, 96, () => {
      g.fillStyle(0x9b4dff, 1);
      g.fillCircle(48, 48, 34);
      g.fillStyle(0x7ff3ff, 1);
      g.fillEllipse(24, 44, 18, 30);
    });
    tex('rr-spring', 100, 70, () => {
      g.fillStyle(0x6b6f7a, 1);
      g.fillEllipse(50, 56, 90, 22);
      g.fillStyle(0xff4a4a, 1);
      g.fillEllipse(50, 26, 86, 26);
      g.fillStyle(0xffe066, 1);
      g.fillEllipse(50, 22, 44, 12);
    });
    tex('rr-prop', 90, 16, () => {
      g.fillStyle(0xff5f5f, 1);
      g.fillRoundedRect(0, 4, 90, 8, 4);
    });
    g.destroy();
    if (!this.textures.exists(IMG_TRACK) && !this.textures.exists('rr-track-fb')) {
      const t = this.textures.createCanvas('rr-track-fb', PERIOD, 1080 - TRACK_IMG_Y);
      if (t) {
        const ctx = t.getContext();
        for (let l = 0; l < LANES; l++) {
          for (let row = 0; row < 2; row++) {
            for (let cx = 0; cx < PERIOD / 64; cx++) {
              ctx.fillStyle = (cx + row + l * 2) % 2 ? '#58b83f' : '#76d654';
              ctx.fillRect(cx * 64, LANE_Y[l] - 62.5 + row * 62.5 - TRACK_IMG_Y, 64, 63);
            }
          }
        }
        ctx.fillStyle = '#f6faec';
        for (let l = 1; l < LANES; l++) ctx.fillRect(0, LANE_Y[l] - 62.5 - TRACK_IMG_Y - 2, PERIOD, 4);
        for (let cx = 0; cx < PERIOD / 64; cx++) {
          for (let row = 0; row < 2; row++) {
            ctx.fillStyle = (cx + row) % 2 ? '#a8592c' : '#e08e40';
            ctx.fillRect(cx * 64, 982 - TRACK_IMG_Y + row * 50, 64, 50);
          }
        }
        ctx.fillStyle = '#3f9d32';
        ctx.fillRect(0, 472 - TRACK_IMG_Y - 12, PERIOD, 14);
        t.refresh();
      }
    }
    if (!this.textures.exists(IMG_FAR) && !this.textures.exists('rr-far-fb')) {
      const t = this.textures.createCanvas('rr-far-fb', PERIOD, 540);
      if (t) {
        const ctx = t.getContext();
        for (let k = 0; k < 5; k++) {
          const cx = k * 384 + 150;
          ctx.fillStyle = '#6cc24a';
          ctx.beginPath();
          ctx.ellipse(cx, 420, 240, 150 + (k % 2) * 60, 0, Math.PI, 0);
          ctx.fill();
        }
        t.refresh();
      }
    }
  }

  /** A few festival folk on the bank behind the lanes, recycled ahead as they scroll off. */
  private buildFans(): void {
    this.fans = [];
    if (!this.textures.exists(NPC_ATLAS)) return;
    const n = LITE ? 5 : 8;
    for (let i = 0; i < n; i++) {
      const [id, pose] = FANS[i % FANS.length];
      const frame = npcFrame(id, pose);
      if (!this.textures.get(NPC_ATLAS).has(frame)) continue;
      const spr = this.add.sprite(0, FAN_Y, NPC_ATLAS, frame);
      const o = standOrigin(NPC_ATLAS, frame);
      spr.setOrigin(o.x, o.y).setScale(0.3).setDepth(FAN_Y - 30).setFlipX(i % 2 === 0);
      this.fans.push({ spr, wx: 260 + i * FAN_GAP + (i % 3) * 60, hop: i * 0.9 });
    }
  }

  private syncFans(): void {
    const calm = calmMotion();
    const span = this.fans.length * FAN_GAP;
    for (const f of this.fans) {
      if (f.wx - this.scroll < -120) f.wx += span;
      const bounce = calm ? 0 : Math.abs(Math.sin(this.clock * 0.009 + f.hop)) * 9;
      f.spr.setPosition(f.wx - this.scroll, FAN_Y - bounce);
    }
  }

  /** The fans jump for joy (a super ring, a streak, the finish). */
  private cheerFans(): void {
    if (calmMotion()) return;
    for (const f of this.fans) {
      this.tweens.killTweensOf(f.spr);
      f.spr.setScale(0.3);
      this.tweens.add({ targets: f.spr, scaleY: 0.34, scaleX: 0.28, duration: 120, yoyo: true, repeat: 1, ease: 'Quad.Out', onComplete: () => f.spr.setScale(0.3) });
    }
  }

  private art(kind: Kind): { key: string; frame?: string } {
    const f = kind === 'scatter' ? 'ring' : kind === 'crawler' ? 'turtle' : kind === 'buzzer' ? 'heli' : kind;
    if (this.hasArt && hasFrame(this, ATLAS, f)) return { key: ATLAS, frame: f };
    return { key: `rr-${kind === 'scatter' ? 'ring' : kind}` };
  }

  // --- Players -----------------------------------------------------------------------------------
  protected createPlayer(p: MgPlayer, index: number): void {
    const n = this.players.length;
    const lane = n === 1 ? 1 : n === 2 ? [1, 2][index] : n === 3 ? [0, 1, 2][index] : index;
    const x = RUN_X + (index % 2) * 18;
    const c = new Character(this, x, LANE_Y[lane], p.characterId, { scale: CHAR_SCALE, slot: p.slot, marker: true });
    c.face(false);
    p.character = c;
    const aura = this.add.image(x, LANE_Y[lane] - 55, AFX.ring).setTint(PLAYER_COLORS[p.slot]).setBlendMode(Phaser.BlendModes.ADD).setVisible(false).setDepth(LANE_Y[lane] + 6);
    this.runners.push({
      p,
      c,
      lane,
      laneF: lane,
      laneFrom: lane,
      laneT: 1,
      x,
      xv: 0,
      z: 0,
      vz: 0,
      jumpBuf: 0,
      dashT: 0,
      dashCd: 0,
      bumped: 0,
      invuln: 0,
      stun: 0,
      armed: true,
      streak: 0,
      markerY: c.marker?.y ?? 0,
      aura,
      spinDy: 0,
      trailT: 0,
      cpuLane: lane,
      cpuTap: 0,
      cpuPlan: -1,
      cpuPlanDx: 0,
      cpuSkip: false,
    });
  }

  protected override onStart(): void {
    for (const r of this.runners) r.c.play('run', { force: true });
    audio.play('whoosh', { volume: 0.7 });
  }

  protected override bannerY(): number {
    return 300;
  }

  protected override onFinalStretch(): void {
    this.fever = true;
    this.cheerFans();
    this.showFinalStretch('RING FEVER!');
    audio.play('cheer', { volume: 0.6 });
    punch(this, 0.02, 260);
  }

  protected override hudLabel(p: MgPlayer): string {
    return String(p.score);
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} ring${p.score === 1 ? '' : 's'}` }));
  }

  // --- Course ------------------------------------------------------------------------------------
  private layCourse(): void {
    let added = false;
    while (this.course.cursor < this.scroll + SPAWN_X + 600) {
      const intensity = Math.min(1, this.elapsed / ROUND_MS);
      const sp = scrollSpeed(this.elapsed, this.fever);
      for (const it of this.course.nextChunk(sp, intensity, this.fever)) this.pending.push(it);
      added = true;
    }
    if (added) this.pending.sort((a, b) => a.wx - b.wx);
  }

  private spawnDue(): void {
    let k = 0;
    while (k < this.pending.length && this.pending[k].wx - this.scroll < SPAWN_X) {
      const it = this.pending[k];
      this.spawn(it.kind, it.lane, it.wx, it.z);
      k++;
    }
    if (k) this.pending.splice(0, k);
  }

  private take(kind: Kind): Item {
    for (const it of this.items) if (!it.active && it.kind === kind) return it;
    const a = this.art(kind);
    const spr = this.add.image(0, 0, a.key, a.frame);
    if (!a.frame) spr.setOrigin(0.5, kind === 'crawler' || kind === 'spring' ? 0.86 : 0.5);
    const shadow = this.add.image(0, 0, 'fx-contact').setAlpha(0.55);
    const it: Item = { id: 0, kind, active: false, lane: 0, laneF: 0, laneTo: 0, wx: 0, z: 0, vx: 0, vz: 0, life: 0, grab: 0, dying: false, phase: 0, spr, shadow };
    if (kind === 'buzzer') {
      const atlasProp = this.hasArt && hasFrame(this, ATLAS, 'prop');
      it.prop = atlasProp ? this.add.image(0, 0, ATLAS, 'prop') : this.add.image(0, 0, 'rr-prop');
    }
    this.items.push(it);
    return it;
  }

  private spawn(kind: Kind, lane: number, wx: number, z: number): Item {
    const it = this.take(kind);
    it.id = this.nextId++;
    it.active = true;
    it.lane = lane;
    it.laneF = lane;
    it.laneTo = lane;
    it.wx = wx;
    it.z = z;
    it.vx = 0;
    it.vz = 0;
    it.life = 0;
    it.grab = 0;
    it.dying = false;
    it.phase = (wx * 0.013) % (Math.PI * 2);
    this.tweens.killTweensOf(it.spr);
    it.spr.setVisible(true).setAlpha(1).setAngle(0).setScale(1);
    it.shadow.setVisible(true);
    it.prop?.setVisible(true).setAlpha(1);
    return it;
  }

  private release(it: Item): void {
    it.active = false;
    this.tweens.killTweensOf(it.spr);
    it.spr.setVisible(false);
    it.shadow.setVisible(false);
    it.prop?.setVisible(false);
  }

  // --- Frame -------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.clock += dt;
    this.speedK = Math.min(1, this.speedK + dt / 700);
    this.advanceWorld(dt);
    for (const r of this.runners) this.stepRunner(r, dt);
    this.separate();
    this.collide();
    this.bumps();
    this.syncRunners();
    this.syncFx(dt);
  }

  protected override ambient(dt: number): void {
    if (this.phase === 'playing') return;
    this.clock += dt;
    if (this.phase === 'finished') {
      // everyone jogs to a stop as the world slows down under them
      this.speedK = Math.max(0, this.speedK - dt / 900);
      this.advanceWorld(dt);
    } else {
      this.syncItems();
      this.syncFans();
    }
    this.syncRunners();
    this.syncFx(dt);
  }

  private advanceWorld(dt: number): void {
    const s = dt / 1000;
    this.speed = scrollSpeed(this.elapsed, this.fever) * this.speedK;
    this.scroll += this.speed * s;
    const off = this.scroll % PERIOD;
    const farOff = (this.scroll * FAR_PARALLAX) % PERIOD;
    for (let i = 0; i < 2; i++) {
      this.track[i].x = Math.round(i * PERIOD - off);
      this.far[i].x = Math.round(i * PERIOD - farOff);
    }
    if (this.phase === 'playing') {
      this.layCourse();
      this.spawnDue();
    }
    for (const it of this.items) {
      if (!it.active) continue;
      if (it.kind === 'scatter') this.stepScatter(it, dt);
      if (it.wx - this.scroll < DESPAWN_X || (it.kind === 'scatter' && it.life <= 0)) this.release(it);
    }
    this.syncItems();
    this.syncFans();
  }

  private stepScatter(it: Item, dt: number): void {
    const s = dt / 1000;
    it.life -= dt;
    it.grab -= dt;
    it.wx += it.vx * s;
    it.vx *= Math.exp(-2.4 * s);
    if (it.z > 0 || it.vz > 0) {
      it.vz -= GRAVITY * 0.8 * s;
      it.z += it.vz * s;
      if (it.z <= 0) {
        it.z = 0;
        it.vz = Math.abs(it.vz) > 260 ? -it.vz * 0.5 : 0;
      }
    }
    it.laneF += (it.laneTo - it.laneF) * (1 - Math.exp(-7 * s));
    it.lane = Math.round(it.laneF);
  }

  private laneY(f: number): number {
    const i = Math.max(0, Math.min(LANES - 2, Math.floor(f)));
    const t = Math.max(0, Math.min(1, f - i));
    return LANE_Y[i] + (LANE_Y[i + 1] - LANE_Y[i]) * t;
  }

  private syncItems(): void {
    const spin = this.clock * 0.0065;
    const calm = calmMotion();
    for (const it of this.items) {
      if (!it.active) continue;
      const x = it.wx - this.scroll;
      const gy = this.laneY(it.laneF);
      switch (it.kind) {
        case 'ring':
        case 'bigring':
        case 'scatter': {
          const y = gy - RING_LIFT - it.z;
          it.spr.setPosition(x, y).setDepth(gy + (it.z > 60 ? 8 : 1));
          const k = calm ? 1 : 0.22 + 0.78 * Math.abs(Math.cos(spin + (it.kind === 'scatter' ? it.phase : 0)));
          it.spr.setScale(k, 1);
          if (it.kind === 'scatter') it.spr.setAlpha(it.life < SCATTER_BLINK && Math.floor(it.life / 90) % 2 ? 0.25 : 1);
          const hs = Math.max(0.25, 1 - it.z / 360);
          it.shadow.setPosition(x, gy + 2).setScale((it.kind === 'bigring' ? 0.7 : 0.42) * hs, 0.14 * hs).setAlpha(0.35 * hs).setDepth(gy - 3);
          break;
        }
        case 'crawler': {
          if (!it.dying) {
            const bob = calm ? 0 : Math.abs(Math.sin(this.clock * 0.014 + it.phase)) * 4;
            it.spr.setPosition(x, gy - bob).setAngle(calm ? 0 : Math.sin(this.clock * 0.014 + it.phase) * 3).setDepth(gy + 2);
          } else it.spr.x = x;
          it.shadow.setPosition(x + 4, gy + 2).setScale(0.9, 0.24).setAlpha(it.dying ? 0 : 0.55).setDepth(gy - 3);
          break;
        }
        case 'buzzer': {
          const bob = calm ? 0 : Math.sin(this.clock * 0.006 + it.phase) * 9;
          const y = gy - it.z - bob;
          if (!it.dying) it.spr.setPosition(x, y).setAngle(calm ? 0 : Math.sin(this.clock * 0.004 + it.phase) * 5).setDepth(gy + 7);
          else it.spr.x = x;
          it.prop?.setPosition(it.spr.x, it.spr.y - 39).setScale(calm ? 1 : Math.abs(Math.cos(this.clock * 0.045 + it.phase)), 1).setDepth(it.spr.depth + 0.1).setVisible(!it.dying);
          it.shadow.setPosition(x, gy + 2).setScale(0.6, 0.16).setAlpha(it.dying ? 0 : 0.35).setDepth(gy - 3);
          break;
        }
        case 'spring': {
          it.spr.setPosition(x, gy).setDepth(gy + 1);
          it.shadow.setPosition(x + 3, gy + 3).setScale(0.8, 0.22).setDepth(gy - 3);
          break;
        }
      }
    }
  }

  // --- Runners -----------------------------------------------------------------------------------
  private stepRunner(r: Runner, dt: number): void {
    const s = dt / 1000;
    const c = r.p.controls;
    const wasCd = r.dashCd;
    r.dashCd = Math.max(0, r.dashCd - dt);
    // the spin-dash is ready again: a quick pulse round a human runner
    if (wasCd > 0 && r.dashCd <= 0 && !r.p.isCpu && this.phase === 'playing') {
      const gy = this.laneY(r.laneF);
      this.rings.spawn(r.x, gy - 50 - r.z, 30, 70, { alpha: 0.7, ms: 260, tint: PLAYER_COLORS[r.p.slot], add: true, depth: gy + 6 });
    }
    r.invuln = Math.max(0, r.invuln - dt);
    r.stun = Math.max(0, r.stun - dt);
    // lanes: one step per push of the stick (or D-pad)
    const my = c.moveY;
    if (Math.abs(my) < 0.35) r.armed = true;
    else if (r.armed && Math.abs(my) > 0.55 && r.stun <= 0) {
      r.armed = false;
      const to = Phaser.Math.Clamp(r.lane + (my > 0 ? 1 : -1), 0, LANES - 1);
      if (to !== r.lane) {
        r.laneFrom = r.laneF;
        r.lane = to;
        r.laneT = 0;
        audio.play('whoosh', { volume: 0.22, rate: 1.5 });
      }
    }
    if (r.laneT < 1) {
      r.laneT = Math.min(1, r.laneT + dt / LANE_MS);
      const e = 1 - (1 - r.laneT) * (1 - r.laneT);
      r.laneF = r.laneFrom + (r.lane - r.laneFrom) * e;
    }
    // jump (buffered a moment before landing)
    if (c.pressed('A')) r.jumpBuf = 110;
    else r.jumpBuf = Math.max(0, r.jumpBuf - dt);
    const grounded = r.z <= 0 && r.vz <= 0;
    if (grounded && r.jumpBuf > 0 && r.stun <= 0) {
      r.jumpBuf = 0;
      r.vz = JUMP_V;
      audio.play('jump', { volume: 0.55, rate: 1.1 });
      if (r.dashT <= 0) r.c.play('jump', { force: true, returnTo: 'run' });
      r.c.squash(-0.1, 120);
    }
    // spin-dash
    if (c.pressed('X') && r.dashCd <= 0 && r.stun <= 0) this.startDash(r);
    if (r.dashT > 0) {
      r.dashT -= dt;
      if (r.dashT <= 0) this.endDash(r);
    }
    if (!grounded || r.vz > 0) {
      r.vz -= GRAVITY * s;
      r.z = Math.max(0, r.z + r.vz * s);
      if (r.z <= 0 && r.vz < 0) {
        r.vz = 0;
        if (r.dashT <= 0) r.c.squash(0.16, 140);
        audio.play('land', { volume: 0.25 });
        this.rings.spawn(r.x, this.laneY(r.laneF) + 2, 12, 48, { squash: 0.3, alpha: 0.5, ms: 300, tint: 0xeaffd8, depth: this.laneY(r.laneF) - 2 });
        if (r.dashT <= 0 && r.c.current !== 'stunned' && this.phase === 'playing') r.c.play('run');
      }
    }
    // position along the lane: surges and knock-backs ease back to the running line
    r.x += r.xv * s;
    r.xv *= Math.exp(-3.4 * s);
    const back = RUN_X - r.x;
    r.x += Math.sign(back) * Math.min(Math.abs(back), 75 * s);
    r.x = Phaser.Math.Clamp(r.x, X_MIN, X_MAX);
  }

  private startDash(r: Runner): void {
    r.dashT = DASH_MS;
    r.dashCd = DASH_CD;
    r.bumped = 0;
    r.xv = Math.max(r.xv, 560);
    r.trailT = 0;
    audio.play('whoosh', { volume: 0.75, rate: 0.8 });
    audio.play('bounce', { volume: 0.35, rate: 1.6 });
    this.rumble(r.p, 0.2, 0.3, 90);
    r.c.hold('jump', 1);
    const sp = r.c.sprite;
    const base = sp.originY;
    sp.setOrigin(0.5, 0.56);
    r.spinDy = (base - 0.56) * sp.height;
    r.aura.setVisible(true).setAlpha(0.9).setScale(0.2);
    this.tweens.add({ targets: r.aura, scale: 0.62, duration: 120, ease: 'Back.Out' });
    const y = this.laneY(r.laneF) - 55 - r.z;
    this.rings.spawn(r.x - 10, y, 18, 90, { squash: 1, alpha: 0.8, ms: 260, tint: PLAYER_COLORS[r.p.slot], add: true, depth: 6000 });
  }

  private endDash(r: Runner): void {
    r.dashT = 0;
    r.spinDy = 0;
    r.c.sprite.setAngle(0);
    this.tweens.add({ targets: r.aura, alpha: 0, scale: 0.9, duration: 140, onComplete: () => r.aura.setVisible(false) });
    if (this.phase === 'playing' && r.c.current !== 'stunned') r.c.play(r.z > 0 ? 'jump' : 'run', { force: true, returnTo: 'run' });
  }

  private syncRunners(): void {
    const calm = calmMotion();
    for (const r of this.runners) {
      const gy = this.laneY(r.laneF);
      r.c.setPosition(r.x, gy).setDepth(gy + 5);
      r.c.sprite.y = -r.z / CHAR_SCALE - r.spinDy;
      if (r.c.marker) r.c.marker.y = r.markerY - r.z / CHAR_SCALE;
      r.c.shadow?.setScale(Math.max(0.35, 1 - r.z / 300));
      if (r.dashT > 0) {
        if (!calm) r.c.sprite.angle += 22;
        r.aura.setPosition(r.x, gy - 50 - r.z).setDepth(gy + 6);
        if (!calm) r.aura.angle -= 9;
      }
      // blink while invulnerable
      r.c.sprite.setAlpha(r.invuln > 0 && Math.floor(r.invuln / 80) % 2 ? 0.35 : 1);
    }
  }

  private syncFx(dt: number): void {
    const k = this.tweens.timeScale;
    this.sparks?.sync(k);
    this.streaks?.sync(k);
    this.debris?.sync(k);
    this.rings.update(dt);
    // speed lines behind anyone spinning
    for (const r of this.runners) {
      if (r.dashT <= 0 || !this.streaks || calmMotion()) continue;
      r.trailT -= dt;
      if (r.trailT > 0) continue;
      r.trailT = LITE ? 70 : 40;
      const y = this.laneY(r.laneF) - 50 - r.z;
      this.streaks.fire(r.x - 40, y + (Math.random() - 0.5) * 50, 1, 180, 4, 500, 800);
    }
  }

  /**
   * Runners sharing a lane never stand on top of each other: they're eased apart along it, so the
   * one in front meets the rings first (a good reason to take another lane).
   */
  private separate(): void {
    const n = this.runners.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.runners[i];
        const b = this.runners[j];
        if (Math.round(a.laneF) !== Math.round(b.laneF) || Math.abs(a.z - b.z) > 110) continue;
        const d = b.x - a.x;
        const gap = 66;
        if (Math.abs(d) >= gap) continue;
        const push = (gap - Math.abs(d)) / 2;
        const dir = d > 0 || (d === 0 && a.p.slot < b.p.slot) ? 1 : -1;
        a.x = Phaser.Math.Clamp(a.x - dir * push, X_MIN, X_MAX);
        b.x = Phaser.Math.Clamp(b.x + dir * push, X_MIN, X_MAX);
      }
    }
  }

  // --- Collisions --------------------------------------------------------------------------------
  private collide(): void {
    for (const r of this.runners) {
      const lane = Math.round(r.laneF);
      for (const it of this.items) {
        if (!it.active || it.dying) continue;
        const dx = it.wx - this.scroll - r.x;
        if (dx < -80 || dx > 80 || it.lane !== lane) continue;
        switch (it.kind) {
          case 'ring':
          case 'bigring':
          case 'scatter':
            if (Math.abs(dx) < RING_DX + (it.kind === 'bigring' ? 16 : 0) && Math.abs(it.z - r.z) < RING_DZ + (it.kind === 'bigring' ? 30 : 0) && (it.kind !== 'scatter' || it.grab <= 0) && r.stun <= 0) this.collect(r, it);
            break;
          case 'spring':
            if (Math.abs(dx) < 46 && r.z < 14 && r.vz <= 0) this.springUp(r, it);
            break;
          case 'crawler':
          case 'buzzer': {
            if (Math.abs(dx) >= BOT_DX) break;
            if (r.dashT > 0) {
              this.smash(r, it);
              break;
            }
            const clear = it.kind === 'crawler' ? r.z >= CRAWLER_CLEAR : r.z >= BUZZER_CLEAR;
            if (!clear && r.invuln <= 0) this.hurt(r, it);
            break;
          }
        }
      }
    }
  }

  private collect(r: Runner, it: Item): void {
    const value = it.kind === 'bigring' ? BIG_RING : 1;
    r.p.score += value;
    const x = it.spr.x;
    const y = it.spr.y;
    this.release(it);
    const before = r.streak;
    r.streak += value;
    audio.play('shop', { volume: it.kind === 'bigring' ? 0.8 : 0.45, rate: it.kind === 'bigring' ? 0.85 : 1 + Math.min(0.25, (r.streak % STREAK_STEP) * 0.025), throttleMs: 45 });
    this.sparks?.fire(x, y, burst(it.kind === 'bigring' ? 16 : 5), -90, 70, 90, 260);
    this.popScore(r, x, y, value);
    if (it.kind === 'bigring') {
      audio.play('streak', { volume: 0.7 });
      this.words.pop(WORDS.big.key, x, y - 60, { owner: r.p.slot, depth: 7000, rise: 50, hold: 520 });
      shockwave(this, x, y, { radius: 110, color: 0xffe066, alpha: 0.8, duration: 380, depth: 6900 });
      this.rumble(r.p, 0.2, 0.3, 100);
      this.cheerFans();
    }
    if (Math.floor(r.streak / STREAK_STEP) > Math.floor(before / STREAK_STEP)) this.streakCall(r);
  }

  /** "+1" beside the runner, gathering quick pickups ("+1" -> "+4") before it flies to the HUD. */
  private popScore(r: Runner, x: number, y: number, value: number): void {
    const slot = r.p.slot;
    this.holdHud(slot, value);
    const open = r.pop;
    if (open && open.h.gathering && open.h.image.active) {
      open.value += value;
      open.h.retitle(`+${open.value}`);
      return;
    }
    const h = this.hudPoint(slot);
    const entry: { h?: HudPop; value: number } = { value };
    entry.h = popToHud(this, x + 30, y - 40, `+${value}`, h.x, h.y, {
      color: '#ffe36b',
      size: POP_SIZE,
      onArrive: () => {
        this.releaseHud(slot, entry.value);
        this.bumpHud(slot);
        if (r.pop === entry) r.pop = undefined;
      },
    });
    r.pop = entry as { h: HudPop; value: number };
  }

  private streakCall(r: Runner): void {
    const n = Math.floor(r.streak / STREAK_STEP) * STREAK_STEP;
    const key = bakeWord(this, `rr-w-streak-${n}-${r.p.slot}`, `${n} IN A ROW!`, { size: 46, fill: ['#ffffff', PLAYER_COLORS_CSS[r.p.slot]] });
    const y = this.laneY(r.laneF) - 170 - r.z;
    this.words.pop(key, r.x, y, { owner: 10 + r.p.slot, depth: 7050, rise: 40, hold: 560, tilt: -6 });
    this.sparks?.fire(r.x, y, burst(12), -90, 80, 120, 320);
    audio.play('streak', { volume: 0.55, rate: 1 + Math.min(0.3, n / 100) });
    if (n >= 20) this.cheerFans();
  }

  private springUp(r: Runner, it: Item): void {
    r.vz = SPRING_V;
    r.z = Math.max(r.z, 1);
    r.jumpBuf = 0;
    audio.play('bounce', { volume: 0.8 });
    this.rumble(r.p, 0.3, 0.2, 90);
    if (r.dashT <= 0) r.c.play('jump', { force: true, returnTo: 'run' });
    const sp = it.spr;
    this.tweens.killTweensOf(sp);
    sp.setScale(1.15, 0.55);
    this.tweens.add({ targets: sp, scaleX: 1, scaleY: 1, duration: 320, ease: 'Elastic.Out' });
    this.words.pop(WORDS.boing.key, sp.x, sp.y - 90, { near: 60, depth: 7000, rise: 40 });
    this.rings.spawn(sp.x, this.laneY(it.laneF), 20, 90, { squash: 0.3, alpha: 0.7, ms: 320, tint: 0xff7ab8, depth: this.laneY(it.laneF) - 2 });
  }

  /** A spin-dash through a robot: it bursts into bolts and drops two rings ahead. */
  private smash(r: Runner, it: Item): void {
    it.dying = true;
    const x = it.spr.x;
    const y = it.spr.y - (it.kind === 'crawler' ? 30 : 0);
    audio.play('crack', { volume: 0.6 });
    audio.play('pop', { volume: 0.6, rate: 0.7 });
    this.hitStop(55);
    this.fx.vfx('explosion', x, y, { scale: 0.42, duration: 420, depth: 6300 });
    this.debris?.fire(x, y, burst(10), -90, 75, 380, 720);
    this.words.pop(WORDS.bonk.key, x, y - 70, { near: 70, depth: 7000, rise: 44, tilt: 8 });
    this.rumble(r.p, 0.35, 0.3, 110);
    kick(this, 5, 0, 110);
    this.tweens.add({ targets: it.spr, y: y - 90, angle: 280, alpha: 0, scale: 0.6, duration: 360, ease: 'Quad.Out', onComplete: () => this.release(it) });
    it.prop?.setVisible(false);
    for (let k = 0; k < 2; k++) this.scatterOne(it.wx + 30, it.lane, 30, r.x, 240 + k * 140, 140);
  }

  private hurt(r: Runner, it: Item): void {
    const lost = ringsLost(r.p.score);
    r.p.score -= lost;
    r.streak = 0;
    r.invuln = INVULN_MS;
    r.xv = -680;
    r.jumpBuf = 0;
    // any "+N" still flying in lands on the new, lower count
    r.pop = undefined;
    this.releaseHud(r.p.slot, 9999);
    audio.play('hit', { volume: 0.8 });
    if (lost) audio.play('shop', { volume: 0.5, rate: 0.62 });
    this.rumble(r.p, 0.7, 0.5, 240);
    this.hitStop(90);
    kick(this, -12, -4, 170);
    const y = this.laneY(r.laneF) - 60 - r.z;
    this.fx.vfx('impact', r.x + 20, y, { scale: 0.5, blend: 'add', depth: 6600 });
    this.fx.vfx('starSwirl', r.x, y - 60, { scale: 0.34, duration: 700, blend: 'add', depth: 6600 });
    this.words.pop(WORDS.ouch.key, r.x, y - 100, { owner: 20 + r.p.slot, depth: 7000, rise: 44, tilt: -8 });
    r.c.sprite.setTintFill(0xffffff);
    this.time.delayedCall(70, () => r.c.sprite.clearTint());
    if (r.dashT > 0) this.endDash(r);
    r.c.play('stunned', { force: true, returnTo: 'run' });
    for (let k = 0; k < lost; k++) this.scatterOne(this.scroll + r.x, Math.round(r.laneF), r.z + 30, -1, 0, SCATTER_GRAB);
    // the robot gets a jolt too
    const sp = it.spr;
    this.tweens.add({ targets: sp, angle: { from: -14, to: 0 }, duration: 260, ease: 'Elastic.Out' });
  }

  /**
   * One loose ring: it bounces out along the lanes (ahead of the runners, mostly), drifting into a
   * neighbouring lane, and blinks away after a moment. `sx` fixes its forward speed on screen
   * (else random); grab is how long before anyone may pick it up.
   */
  private scatterOne(wx: number, lane: number, z: number, _fromX: number, sx: number, grab: number): void {
    const it = this.spawn('scatter', lane, wx, z);
    const fwd = sx || 60 + Math.random() * 520;
    it.vx = this.speed + fwd;
    it.vz = 520 + Math.random() * 420;
    it.laneTo = Phaser.Math.Clamp(lane + (sx ? 0 : Math.floor(Math.random() * 3) - 1), 0, LANES - 1);
    it.life = SCATTER_LIFE;
    it.grab = grab;
    it.phase = Math.random() * Math.PI * 2;
  }

  /** A spin-dash into a rival in the same lane knocks two of their rings loose. */
  private bumps(): void {
    for (const a of this.runners) {
      if (a.dashT <= 0) continue;
      for (const b of this.runners) {
        if (a === b || b.dashT > 0 || b.invuln > 0 || a.bumped & (1 << b.p.slot)) continue;
        if (Math.round(a.laneF) !== Math.round(b.laneF) || Math.abs(a.x - b.x) > 70 || Math.abs(a.z - b.z) > 90) continue;
        a.bumped |= 1 << b.p.slot;
        const lost = ringsBumped(b.p.score);
        b.p.score -= lost;
        b.pop = undefined;
        this.releaseHud(b.p.slot, 9999);
        b.streak = 0;
        b.stun = 260;
        b.invuln = 700;
        b.xv = a.x < b.x ? 420 : -420;
        a.xv = -160;
        audio.play('hit', { volume: 0.55, rate: 1.25 });
        this.hitStop(60);
        this.rumble(b.p, 0.5, 0.4, 160);
        this.rumble(a.p, 0.3, 0.2, 90);
        const y = this.laneY(b.laneF) - 60 - b.z;
        this.fx.vfx('impact', (a.x + b.x) / 2, y, { scale: 0.42, blend: 'add', depth: 6600 });
        this.words.pop(WORDS.bump.key, b.x, y - 90, { owner: 30 + b.p.slot, depth: 7000, rise: 40, tilt: 6 });
        b.c.play('stunned', { force: true, returnTo: 'run' });
        for (let k = 0; k < lost; k++) this.scatterOne(this.scroll + b.x, Math.round(b.laneF), b.z + 30, -1, 0, 200);
      }
    }
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      for (const r of this.runners) {
        r.z = 0;
        r.vz = 0;
        if (r.dashT > 0) {
          r.dashT = 0;
          r.spinDy = 0;
          r.aura.setVisible(false);
        }
        r.c.sprite.setAngle(0).setAlpha(1);
        r.invuln = 0;
        if (r.c.current === 'jump' || r.c.current === 'stunned') r.c.play('run', { force: true });
      }
      this.cheerFans();
    }
    super.end();
  }

  // --- CPU ---------------------------------------------------------------------------------------
  /** What a runner can see ahead of it: every live item within `look` px (written into a reused list). */
  private perceive(r: Runner, look: number): void {
    let n = 0;
    for (const it of this.items) {
      if (!it.active || it.dying || n >= this.seen.length) continue;
      if (it.kind === 'scatter' && it.grab > 150) continue;
      const dx = it.wx - this.scroll - r.x;
      if (dx < -30 || dx > look) continue;
      const s = this.seen[n++];
      s.lane = it.lane;
      s.dx = dx;
      s.kind = it.kind;
      s.z = it.z;
    }
    this.seenN = n;
  }

  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const r = this.runners.find((q) => q.p === p);
    if (!r) return;
    const sk = this.skill(p);
    const b = p.brain;
    vc.setMove(0, 0);
    const level = p.cpuLevel;
    const look = level === 'hard' ? 1150 : level === 'normal' ? 920 : 680;
    const speed = Math.max(200, this.speed);
    this.perceive(r, look);
    const seen = this.seen;
    const sn = this.seenN;
    // choose a lane now and then (a little rival-aware: rings in a lane someone runs ahead in go to them)
    b.timer -= dt;
    if (b.timer <= 0) {
      b.timer = sk.think * (0.6 + Math.random() * 0.5);
      let best = r.lane;
      let bestV = -Infinity;
      for (let l = Math.max(0, r.lane - 2); l <= Math.min(LANES - 1, r.lane + 2); l++) {
        let v = laneValue(seen, l, look, r.dashCd, speed, sn) - Math.abs(l - r.lane) * 0.45;
        // rivals in a lane take its rings first (level with or ahead of this runner), so spread out
        for (const o of this.runners) {
          if (o === r || Math.round(o.laneF) !== l) continue;
          v -= o.x > r.x - 40 ? 1.6 : 0.5;
        }
        if (v > bestV) {
          bestV = v;
          best = l;
        }
      }
      if (Math.random() < sk.mistake) best = Phaser.Math.Clamp(r.lane + (Math.random() < 0.5 ? -1 : 1), 0, LANES - 1);
      r.cpuLane = best;
    }
    r.cpuTap -= dt;
    if (r.cpuLane !== r.lane && r.cpuTap <= 0 && r.laneT >= 1) {
      vc.setMove(0, r.cpuLane < r.lane ? -1 : 1);
      r.cpuTap = 120 + sk.reaction * 0.35;
    }
    // reflexes: the nearest robot coming down this lane
    const lane = Math.round(r.laneF);
    let hz: Item | null = null;
    let hdx = Infinity;
    for (const it of this.items) {
      if (!it.active || it.dying || !isHazard(it.kind as ItemKind) || it.lane !== lane) continue;
      const dx = it.wx - this.scroll - r.x;
      if (dx > -BOT_DX && dx < hdx) {
        hdx = dx;
        hz = it;
      }
    }
    if (!hz || hdx > 700) return;
    if (r.cpuPlan !== hz.id) {
      // one decision per robot, made with this CPU's timing and slips
      r.cpuPlan = hz.id;
      r.cpuSkip = Math.random() < sk.mistake;
      const noise = (Math.random() - 0.5) * sk.aimNoise * 0.5;
      if (hz.kind === 'crawler') {
        const T = (2 * JUMP_V) / GRAVITY;
        r.cpuPlanDx = speed * (T / 2 + noise);
      } else {
        r.cpuPlanDx = BOT_DX + speed * (0.12 + noise * 0.6);
        // no dash in time: get out of the lane instead
        if (r.dashCd > (hdx / speed) * 1000 - 80) {
          let out = -1;
          for (const l of [lane - 1, lane + 1]) {
            if (l < 0 || l >= LANES) continue;
            let blocked = false;
            for (let i = 0; i < sn; i++) if (seen[i].lane === l && seen[i].kind === 'buzzer' && Math.abs(seen[i].dx - hdx) < 220) blocked = true;
            if (!blocked) out = l;
          }
          if (out >= 0) r.cpuLane = out;
        }
      }
    }
    if (r.cpuSkip) return;
    if (hz.kind === 'crawler' && hdx <= r.cpuPlanDx && r.z <= 0) {
      vc.tap('A');
      r.cpuSkip = true;
    } else if (hz.kind === 'buzzer' && hdx <= r.cpuPlanDx && r.dashCd <= 0 && r.cpuLane === r.lane) {
      vc.tap('X');
      r.cpuSkip = true;
    }
    // hard CPUs spin into a rival running just ahead in their lane now and then
    if (level !== 'easy' && r.dashCd <= 0 && Math.random() < (level === 'hard' ? 0.02 : 0.006)) {
      for (const o of this.runners) {
        if (o !== r && o.invuln <= 0 && o.p.score > 0 && Math.round(o.laneF) === lane && o.x - r.x > 20 && o.x - r.x < 130) vc.tap('X');
      }
    }
  }
}
