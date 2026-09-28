import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { COLORS, CSS, GAME_WIDTH, PLAYER_COLORS, PLAYER_SHAPES } from '../../../constants';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../../data/npcs';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { confettiBurst, punch, shockwave } from '../../../minigames/juice';
import { bakeWord, calmMotion, WordPops } from '../../../minigames/games/stageKit';
import { LITE } from '../../../perf';
import { drawPlayerShape } from '../../../ui/PlayerBadge';
import { addText } from '../../../ui/theme';
import { standOrigin } from '../../../util/spriteUtil';
import { canvasTex, centreOnBody, fallbackSky, finishHeroSprites, glowTex, heroTex, playerRing, queueHeroSprites, standOnFeet, streakTex, uprightBadge } from '../heroesKit';
import {
  buildCourse,
  catchUp,
  COURSE_LEN,
  firstAnchorAfter,
  newBrain,
  newEvents,
  newSwinger,
  ordinal,
  pickAnchor,
  raceScore,
  stepSwinger,
  SWING,
  swingCpu,
  type Anchor,
  type AnchorKind,
  type Course,
  type Swinger,
  type SwingBrain,
  type SwingEvents,
  type SwingInput,
} from '../swingRules';

/** Rendered art (scripts/art/worlds/heroes/mg_skyline.py): the sunset skyline (tiles sideways), the street strip and the buildings. */
const SKYLINE = 'rendered-scene-heroes_skyline';
const SPRITES: readonly string[] = ['street', 'towers'];
const CHAR_SCALE = 0.55;
/** Parallax of the skyline backdrop. */
const BACK_K = 0.14;
/** The street strip's image top (its kerb line is at SWING.STREET_Y). */
const STREET_TOP = 880;
const STREET_H = 220;
/** The leader is kept this far across the screen; stragglers behind the left edge are zipped forward. */
const LEAD_X = 1120;
const CATCH_X = 40;
const CAM_MAX = COURSE_LEN - 1250;
/** Hands above the body centre (the web leaves from here), and the badge above the body centre. */
const HAND = 74;
const MARK = -104;
/** Race bar along the bottom (screen px). */
const BAR = { x0: 560, x1: 1360, y: 1042 };
const DEPTH = { back: -60, tower: -20, hook: -10, street: -5, web: 60, swinger: 100, words: 7000, bar: 8100 } as const;
const WORDS = {
  perfect: { key: 'hws-w-perfect', text: 'PERFECT!', size: 56, fill: ['#ffffff', '#8fe6ff'] },
  good: { key: 'hws-w-good', text: 'GOOD', size: 44, fill: ['#ffffff', '#c8f6ff'] },
  early: { key: 'hws-w-early', text: 'EARLY', size: 40, fill: ['#e8ecf5', '#9aa6bd'] },
  late: { key: 'hws-w-late', text: 'LATE', size: 40, fill: ['#e8ecf5', '#9aa6bd'] },
  whoops: { key: 'hws-w-whoops', text: 'WHOOPS!', size: 52, fill: ['#fff1d6', '#ff8a5c'] },
  chain5: { key: 'hws-w-chain5', text: 'x5 CHAIN!', size: 50, fill: ['#ffffff', '#ffe08a'] },
  chain10: { key: 'hws-w-chain10', text: 'x10 CHAIN!', size: 54, fill: ['#fff6c4', '#ffbf2a'] },
  p1: { key: 'hws-w-1st', text: '1ST!', size: 86, fill: ['#fff6c4', '#ffbf2a'] },
  p2: { key: 'hws-w-2nd', text: '2ND!', size: 76, fill: ['#ffffff', '#c3cfdc'] },
  p3: { key: 'hws-w-3rd', text: '3RD!', size: 72, fill: ['#ffe6cc', '#e0965a'] },
  p4: { key: 'hws-w-4th', text: '4TH!', size: 68, fill: ['#ffffff', '#d6dde8'] },
} as const;
const PLACE_WORDS = [WORDS.p1, WORDS.p2, WORDS.p3, WORDS.p4] as const;

/** A building sprite: texture (and atlas frame), its size and where the web anchor sits on it. */
interface TowerArt {
  key: string;
  frame?: string;
  w: number;
  h: number;
  ax: number;
  ay: number;
  kind: AnchorKind;
}

interface Racer {
  p: MgPlayer;
  c: Character;
  s: Swinger;
  ev: SwingEvents;
  brain: SwingBrain;
  input: SwingInput;
  pose: string;
  tilt: number;
  /** A flip after a PERFECT fling (extra rotation, eases back to 0). */
  flip: number;
  place: number;
  finishedAt: number;
  /** Web shooting out: 0..1 (the line grows towards the anchor). */
  shoot: number;
  /** The anchor a human's web would catch right now (highlighted), or -1. */
  aim: number;
  trailT: number;
  landed: boolean;
  /** Put back on their feet for the finish poses (on the start roof when time ran out). */
  standing: boolean;
}

/**
 * Web Swing — a race across the Hero Heights skyline at sunset. Press A to web the nearest anchor in
 * reach, swing, and let go as you swing up to fling yourself on; chain swing after swing. Miss and
 * you drop to the street (a web zips you back up, but it costs time). First to the finish tower wins,
 * or whoever got furthest when time runs out.
 */
export class WebSwingScene extends BaseMinigame {
  private course!: Course;
  private racers: Racer[] = [];
  private camX = 0;
  private backs: Phaser.GameObjects.Image[] = [];
  private streets: Phaser.GameObjects.Image[] = [];
  private arts: TowerArt[] = [];
  /** Building sprites by anchor index (made as they come into view, recycled behind). */
  private towers = new Map<number, Phaser.GameObjects.Image>();
  private towerPool: Phaser.GameObjects.Image[] = [];
  private hooks = new Map<number, Phaser.GameObjects.Image>();
  private hookPool: Phaser.GameObjects.Image[] = [];
  private webG!: Phaser.GameObjects.Graphics;
  private aimG!: Phaser.GameObjects.Graphics;
  private barG!: Phaser.GameObjects.Graphics;
  private pops!: WordPops;
  private trails: Phaser.GameObjects.Image[] = [];
  private finished = 0;
  private endQueued = false;
  private wrapped = false;
  private crowd: Phaser.GameObjects.Sprite[] = [];
  /** Festival folk waving from some of the rooftops along the course (by anchor index; pooled). */
  private fans = new Map<number, Phaser.GameObjects.Sprite>();
  private fanPool: Phaser.GameObjects.Sprite[] = [];
  private hint = 0;

  constructor() {
    super('mg-web-swing');
  }

  preload(): void {
    queueHeroSprites(this, ['street']);
    const half = LITE && this.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;
    if (!this.textures.exists(heroTex('towers'))) this.load.atlas(heroTex('towers'), `assets/${half ? 'lite' : 'rendered'}/mg/heroes_towers.webp`, 'assets/rendered/mg/heroes_towers.json');
  }

  // --- Arena -----------------------------------------------------------------------------------
  protected createArena(): void {
    finishHeroSprites(this, SPRITES);
    this.duration = 50000;
    this.course = buildCourse(this.rng);
    this.racers = [];
    this.camX = 0;
    this.backs = [];
    this.streets = [];
    this.towers = new Map();
    this.towerPool = [];
    this.hooks = new Map();
    this.hookPool = [];
    this.trails = [];
    this.crowd = [];
    this.fans = new Map();
    this.fanPool = [];
    this.finished = 0;
    this.endQueued = false;
    this.wrapped = false;
    this.hint = 0;
    this.cameras.main.setScroll(0, 0);
    for (const w of Object.values(WORDS)) bakeWord(this, w.key, w.text, { size: w.size, fill: w.fill });
    glowTex(this);
    streakTex(this);
    this.makeTextures();
    this.arts = this.towerArts();
    // Backdrop: the sunset skyline, two copies leapfrogging as the camera pans (slow parallax).
    if (this.textures.exists(SKYLINE)) {
      for (let i = 0; i < 2; i++) this.backs.push(this.add.image(i * GAME_WIDTH, 0, SKYLINE).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.back).setDisplaySize(GAME_WIDTH + 2, 1080));
    } else {
      fallbackSky(this, DEPTH.back - 1, true);
      for (let i = 0; i < 2; i++) this.backs.push(this.add.image(i * GAME_WIDTH, 0, 'hws-far').setOrigin(0).setScrollFactor(0).setDepth(DEPTH.back));
    }
    const streetKey = this.textures.exists(heroTex('street')) ? heroTex('street') : 'hws-street';
    for (let i = 0; i < 2; i++) this.streets.push(this.add.image(i * GAME_WIDTH, STREET_TOP, streetKey).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.street).setDisplaySize(GAME_WIDTH + 2, STREET_H));
    this.buildStart();
    this.buildFinish();
    this.webG = this.add.graphics().setDepth(DEPTH.web);
    this.aimG = this.add.graphics().setDepth(DEPTH.hook + 1);
    this.pops = new WordPops(this, DEPTH.words, 14);
    this.buildBar();
    this.syncWorld();
  }

  private makeTextures(): void {
    canvasTex(this, 'hws-hook', 56, 56, (ctx) => {
      const g = ctx.createRadialGradient(28, 28, 2, 28, 28, 27);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.3, 'rgba(200,246,255,0.55)');
      g.addColorStop(1, 'rgba(200,246,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 56, 56);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(28, 28, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#2b3550';
      ctx.beginPath();
      ctx.arc(28, 28, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    // Fallback art: a far skyline strip (sideways-tiling) and the street.
    canvasTex(this, 'hws-far', 1920, 1080, (ctx) => {
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (const [col, lo, hi] of [
        ['#6b4f86', 480, 700],
        ['#4d3f74', 560, 820],
      ] as const) {
        ctx.fillStyle = col;
        for (let x = -60; x < 1980; ) {
          const w = 70 + rnd() * 120;
          const top = lo + rnd() * (hi - lo);
          ctx.fillRect(x, top, w, 1080 - top);
          if (x + w > 1920) ctx.fillRect(x - 1920, top, w, 1080 - top);
          x += w + rnd() * 20;
        }
      }
    });
    canvasTex(this, 'hws-street', 1920, 220, (ctx) => {
      ctx.fillStyle = '#9aa1b3';
      ctx.fillRect(0, 96, 1920, 16);
      ctx.fillStyle = '#6e7486';
      ctx.fillRect(0, 112, 1920, 16);
      ctx.fillStyle = '#3a3f4f';
      ctx.fillRect(0, 128, 1920, 92);
      ctx.fillStyle = '#e8d27a';
      for (let x = 20; x < 1920; x += 160) ctx.fillRect(x, 170, 80, 8);
    });
    for (const kind of ['cornice', 'mast', 'tank', 'crane'] as const) this.fallbackTower(kind);
  }

  /** Painted building for a kind of anchor, used until the rendered buildings exist. */
  private fallbackTower(kind: AnchorKind): void {
    const W = kind === 'crane' ? 380 : 320;
    canvasTex(this, `hws-fb-${kind}`, W, 900, (ctx) => {
      const top = kind === 'cornice' ? 40 : kind === 'mast' ? 250 : kind === 'tank' ? 220 : 290;
      const bw = kind === 'crane' ? 300 : 300;
      const hue = { cornice: '#8f7a96', mast: '#7d8fae', tank: '#a48b7c', crane: '#8594a8' }[kind];
      ctx.fillStyle = hue;
      ctx.fillRect(10, top, bw, 900 - top);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(10, top, bw, 10);
      for (let y = top + 40; y < 900; y += 54)
        for (let x = 34; x < bw - 10; x += 52) {
          ctx.fillStyle = (x * 7 + y * 3) % 5 < 2 ? '#ffd98a' : '#3b4668';
          ctx.fillRect(x, y, 24, 30);
        }
      ctx.fillStyle = '#4c5266';
      if (kind === 'mast') ctx.fillRect(156, 20, 8, top - 20);
      if (kind === 'tank') {
        ctx.fillStyle = '#8a5a3a';
        ctx.fillRect(110, 70, 100, 110);
        ctx.fillStyle = '#5a4a44';
        ctx.beginPath();
        ctx.moveTo(104, 70);
        ctx.lineTo(160, 36);
        ctx.lineTo(216, 70);
        ctx.fill();
        ctx.fillStyle = '#4c5266';
        ctx.fillRect(120, 180, 8, top - 180);
        ctx.fillRect(192, 180, 8, top - 180);
      }
      if (kind === 'crane') {
        ctx.fillStyle = '#e0a93f';
        ctx.fillRect(60, 40, 18, top - 40);
        ctx.fillRect(40, 48, 330, 16);
      }
    });
  }

  /** Building sprites by kind: the rendered atlas when loaded (anchors from its frame names), else the painted ones. */
  private towerArts(): TowerArt[] {
    const key = heroTex('towers');
    if (this.textures.exists(key)) {
      const tex = this.textures.get(key);
      const data = (tex.customData as { anchors?: Record<string, { anchor: [number, number]; kind: AnchorKind }> }).anchors;
      if (data) {
        const out: TowerArt[] = [];
        for (const [frame, d] of Object.entries(data)) {
          const f = tex.get(frame);
          if (f) out.push({ key, frame, w: f.realWidth, h: f.realHeight, ax: d.anchor[0], ay: d.anchor[1], kind: d.kind });
        }
        if (out.length) return out;
      }
    }
    const anchors: Record<AnchorKind, [number, number]> = { cornice: [304, 40], mast: [160, 20], tank: [160, 38], crane: [366, 56] };
    return (['cornice', 'mast', 'tank', 'crane'] as const).map((kind) => ({ key: `hws-fb-${kind}`, w: kind === 'crane' ? 380 : 320, h: 900, ax: anchors[kind][0], ay: anchors[kind][1], kind }));
  }

  /**
   * A row of flat-roofed (cornice) buildings whose roof line sits at `roofY` from x0 to x1: the
   * start rooftop and the finish tower are made of the same rendered blocks as the course.
   * Returns false when the rendered buildings aren't loaded (the painted versions are used then).
   */
  private roofRow(x0: number, x1: number, roofY: number, depth: number): boolean {
    const flat = this.arts.filter((a) => a.kind === 'cornice' && a.frame);
    if (!flat.length) return false;
    let x = x0;
    let k = 0;
    while (x < x1) {
      const art = flat[k % flat.length];
      this.add.image(x, roofY - art.ay, art.key, art.frame).setOrigin(0).setDepth(depth + k * 0.01);
      x += art.w - 14;
      k++;
    }
    return true;
  }

  private buildStart(): void {
    // The start rooftop: its roof line at SWING.ROOF_Y, running a little past the start line.
    if (this.roofRow(-700, SWING.ROOF_END - 40, SWING.ROOF_Y, DEPTH.tower + 1)) return;
    const g = this.add.graphics().setDepth(DEPTH.tower + 1);
    g.fillStyle(0x7d6f92, 1);
    g.fillRect(-700, SWING.ROOF_Y, 700 + SWING.ROOF_END, 400);
    g.fillStyle(0xb8aecd, 1);
    g.fillRect(-700, SWING.ROOF_Y - 14, 700 + SWING.ROOF_END + 8, 16);
    g.fillStyle(0xffd98a, 0.8);
    for (let y = SWING.ROOF_Y + 40; y < 1000; y += 56) for (let x = -660; x < SWING.ROOF_END - 30; x += 58) if ((x + y) % 3) g.fillRect(x, y, 24, 30);
  }

  /** The finish tower: a tall block with a chequered banner; finishers land on its roof among cheering folk. */
  private buildFinish(): void {
    const x0 = COURSE_LEN;
    const top = SWING.FINISH_ROOF_Y;
    const g = this.add.graphics().setDepth(DEPTH.tower + 2);
    if (!this.roofRow(x0 - 6, x0 + 1100, top, DEPTH.tower + 1.5)) {
      g.fillStyle(0x5f6f9e, 1);
      g.fillRect(x0, top, 900, 700);
      g.fillStyle(0xc9d2ec, 1);
      g.fillRect(x0 - 10, top - 16, 920, 18);
      g.fillStyle(0xffd98a, 0.85);
      for (let y = top + 50; y < 1000; y += 60) for (let x = x0 + 30; x < x0 + 880; x += 62) if ((x + y) % 4) g.fillRect(x, y, 26, 32);
    }
    // chequered finish banner hanging down the front
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 2; c++) {
        g.fillStyle((r + c) % 2 ? 0x1d1d26 : 0xfafafa, 1);
        g.fillRect(x0 + 8 + c * 22, top + 10 + r * 22, 22, 22);
      }
    // posts and a finish ribbon between them
    g.fillStyle(COLORS.gold, 1);
    g.fillRect(x0 + 60, top - 150, 10, 150);
    g.fillRect(x0 + 520, top - 150, 10, 150);
    const folk: [NpcId, string][] = [
      ['ora', 'cheer'],
      ['pipper', 'happy'],
      ['mimi', 'happy'],
      ['packsprout', 'cheer'],
      ['wrench', 'laugh'],
    ];
    folk.forEach(([id, pose], i) => {
      const x = x0 + 600 + i * 58;
      const frame = npcFrame(id, pose);
      const spr = this.add.sprite(x, top - 2, NPC_ATLAS, frame);
      const o = standOrigin(NPC_ATLAS, frame);
      spr.setOrigin(o.x, o.y).setScale(0.36).setDepth(DEPTH.tower + 3).setFlipX(true);
      this.tweens.add({ targets: spr, y: top - 8, duration: 380 + (i % 3) * 80, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 60 });
      this.crowd.push(spr);
    });
    const tape = this.add.graphics().setDepth(DEPTH.tower + 3);
    tape.fillStyle(0xff6b5e, 1);
    tape.fillRect(x0 + 64, top - 110, 460, 8);
  }

  private buildBar(): void {
    const { x0, x1, y } = BAR;
    const bg = this.add.graphics().setDepth(DEPTH.bar).setScrollFactor(0);
    bg.fillStyle(0x06141a, 0.3);
    bg.fillRoundedRect(x0 - 76, y - 30 + 6, x1 - x0 + 152, 60, 30);
    bg.fillStyle(0x0c2630, 0.86);
    bg.fillRoundedRect(x0 - 80, y - 30, x1 - x0 + 160, 60, 30);
    bg.lineStyle(4, COLORS.gold, 0.9);
    bg.strokeRoundedRect(x0 - 80, y - 30, x1 - x0 + 160, 60, 30);
    bg.fillStyle(0xffffff, 0.14);
    bg.fillRoundedRect(x0, y - 4, x1 - x0, 8, 4);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 2; c++) {
        bg.fillStyle((r + c) % 2 ? 0x1d1d26 : 0xfafafa, 1);
        bg.fillRect(x1 - 2 + c * 7, y - 14 + r * 7, 7, 7);
      }
    this.barG = this.add.graphics().setDepth(DEPTH.bar + 1).setScrollFactor(0);
    addText(this, x0 - 44, y + 1, 'RACE', 20, { color: CSS.creamDark, weight: 700, fixed: true }).setDepth(DEPTH.bar + 2).setScrollFactor(0);
  }

  // --- Players ---------------------------------------------------------------------------------
  protected createPlayer(p: MgPlayer, index: number): void {
    // Start spots along the roof, in an order drawn from the seed (no seat is always in front).
    const order = [0, 1, 2, 3].sort((a, b) => ((a * 7 + this.launch.seed) % 5) - ((b * 7 + this.launch.seed) % 5));
    const x = 170 + order[index % 4] * 105;
    const s = newSwinger(x);
    const c = new Character(this, x, s.y, p.characterId, { scale: CHAR_SCALE, slot: p.slot });
    c.shadow?.setVisible(false);
    playerRing(c)?.setVisible(false);
    c.setDepth(DEPTH.swinger + index);
    p.character = c;
    const r: Racer = { p, c, s, ev: newEvents(), brain: newBrain(), input: { stickX: 0, holdA: false, pressA: false }, pose: '', tilt: 0, flip: 0, place: 0, finishedAt: 0, shoot: 1, aim: -1, trailT: 0, landed: false, standing: false };
    this.racers.push(r);
    this.setPose(r, 'idle');
    this.syncRacer(r, 0);
  }

  private setPose(r: Racer, pose: string): void {
    if (r.pose === pose) return;
    r.pose = pose;
    const c = r.c;
    if (pose === 'idle') c.play('idle', { force: true });
    else if (pose === 'run') c.play('run', { force: true });
    else if (pose === 'hang') c.hold('jump', 2);
    else if (pose === 'fly') c.hold('jump', 1);
    else if (pose === 'fall') c.hold('fall', 0);
    else if (pose === 'down') c.hold('stunned', 1);
    else if (pose === 'zip') c.hold('pull', 0);
    else if (pose === 'dive') c.hold('dash', 0);
    centreOnBody(c, SWING.BODY, CHAR_SCALE);
  }

  protected override onStart(): void {
    audio.play('whoosh', { volume: 0.5, rate: 1.2 });
    if (this.humanSlots().length === 0) return;
    const t = addText(this, 960, 250, 'A: web the glowing anchor  ·  let go as you swing up!', 36, { color: CSS.cream, stroke: '#06141a', strokeThickness: 7, weight: 700, fixed: true });
    const back = this.add.graphics().setDepth(8799).setScrollFactor(0);
    back.fillStyle(0x06141a, 0.6);
    back.fillRoundedRect(960 - t.width / 2 - 28, 250 - 30, t.width + 56, 60, 30);
    t.setDepth(8800).setScrollFactor(0);
    for (const o of [t, back]) {
      o.setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, delay: 500, duration: 250 });
      this.tweens.add({ targets: o, alpha: 0, delay: 4000, duration: 500, onComplete: () => o.destroy() });
    }
  }

  protected override bannerY(): number {
    return 330;
  }

  protected override hudLabel(p: MgPlayer): string {
    const r = this.racers.find((x) => x.p === p);
    return r ? ordinal(this.rankOf(r)) : '';
  }

  /** Live race position: finishers by finishing order, then distance. */
  private rankOf(r: Racer): number {
    const key = (o: Racer) => (o.place ? 1e6 - o.place : o.s.x);
    let rank = 1;
    for (const o of this.racers) if (o !== r && key(o) > key(r)) rank++;
    return rank;
  }

  protected override leaderSlot(): number | null {
    if (this.racers.length < 2) return null;
    let best: Racer | null = null;
    for (const r of this.racers) if (!best || (r.place || 99) < (best.place || 99) || (!r.place && !best.place && r.s.x > best.s.x + 40)) best = r;
    return best && best.s.x > 900 ? best.p.slot : null;
  }

  // --- Frame -----------------------------------------------------------------------------------
  protected tick(dt: number): void {
    for (const r of this.racers) {
      if (r.s.mode === 'done') {
        this.landOnFinish(r, dt);
        continue;
      }
      const ctl = r.p.controls;
      r.input.stickX = ctl.moveX;
      r.input.holdA = ctl.held('A');
      r.input.pressA = ctl.pressed('A');
      stepSwinger(r.s, r.input, this.course, dt, r.ev);
      this.swingFx(r);
      if ((r.s.mode as Swinger['mode']) === 'done') this.finish(r);
    }
    this.updateCamera(dt);
    // Stragglers who fall behind the picture are zipped back into it.
    for (const r of this.racers) {
      const m = r.s.mode;
      if (m !== 'done' && m !== 'zip' && r.s.x < this.camX + CATCH_X) {
        catchUp(r.s, this.camX + 300);
        audio.play('whoosh', { volume: 0.4, rate: 1.4 });
        r.shoot = 0;
      }
    }
    if (!this.endQueued && this.finished >= this.racers.length) {
      this.endQueued = true;
      this.time.delayedCall(1200, () => this.end());
    }
  }

  private updateCamera(dt: number): void {
    let lead = -Infinity;
    for (const r of this.racers) if (r.s.mode !== 'done') lead = Math.max(lead, r.s.x);
    if (lead === -Infinity) lead = COURSE_LEN + 200;
    const target = Phaser.Math.Clamp(lead - LEAD_X, 0, CAM_MAX);
    // Only ever forward, eased.
    if (target > this.camX) this.camX += (target - this.camX) * (1 - Math.exp((-5 * dt) / 1000));
    this.cameras.main.setScroll(this.camX, 0);
  }

  /** Effects for what the swing step reported. */
  private swingFx(r: Racer): void {
    const e = r.ev;
    const s = r.s;
    const slot = r.p.slot;
    if (e.attach) {
      r.shoot = 0;
      audio.play('whoosh', { volume: 0.3, rate: 1.9, throttleMs: 60 });
      audio.play('pop', { volume: 0.25, rate: 0.7, throttleMs: 60 });
      const a = this.course.anchors[e.attach - 1];
      shockwave(this, a.x, a.y, { radius: 40, color: 0xffffff, alpha: 0.8, duration: 260, depth: DEPTH.hook + 2 });
      r.c.squash(0.1, 120);
    }
    if (e.miss && !r.p.isCpu) audio.play('pop', { volume: 0.2, rate: 0.5, throttleMs: 150 });
    if (e.jump) audio.play('jump', { volume: 0.5 });
    if (e.release) {
      const q = e.release;
      const wx = s.x;
      const wy = s.y - 120;
      if (q === 'perfect') {
        audio.play('nearMiss', { volume: 0.5, rate: 1.05 + Math.min(0.3, s.chain * 0.02) });
        this.pops.pop(WORDS.perfect.key, wx, wy, { owner: slot, scale: r.p.isCpu ? 0.8 : 1, rise: 36, hold: 380 });
        shockwave(this, s.x, s.y, { radius: 100, color: PLAYER_COLORS[slot], alpha: 0.8, duration: 320, depth: DEPTH.web - 1 });
        if (!calmMotion()) r.flip = Math.PI * 2;
        this.rumble(r.p, 0.12, 0.25, 70);
      } else if (q === 'good') this.pops.pop(WORDS.good.key, wx, wy, { owner: slot, scale: 0.8, rise: 30, hold: 300 });
      else if (!r.p.isCpu && (q === 'early' || q === 'late')) this.pops.pop((q === 'early' ? WORDS.early : WORDS.late).key, wx, wy, { owner: slot, scale: 0.8, rise: 26, hold: 300 });
      if (s.chain === 5 || s.chain === 10 || (s.chain > 10 && s.chain % 10 === 0)) {
        this.pops.pop((s.chain >= 10 ? WORDS.chain10 : WORDS.chain5).key, s.x, s.y - 190, { owner: slot + 10, scale: 1, rise: 40, hold: 520, tilt: -6 });
        audio.play('streak', { volume: 0.5, rate: 1 + Math.min(0.4, s.chain * 0.02) });
      }
    }
    if (e.down) {
      audio.play('hit', { volume: 0.6 });
      audio.play('land', { volume: 0.6 });
      this.fx.vfx('dust', s.x, SWING.STREET_Y, { scale: 0.45, duration: 420, alpha: 0.75, depth: DEPTH.swinger - 1 });
      this.fx.vfx('starSwirl', s.x, s.y - 70, { scale: 0.42, duration: 700, blend: 'add' });
      this.pops.pop(WORDS.whoops.key, s.x, s.y - 150, { owner: slot, scale: 1, rise: 36, hold: 520, tilt: 6 });
      this.fx.shake(0.003, 140);
      this.rumble(r.p, 0.5, 0.35, 200);
      r.c.squash(0.25, 180);
    }
    if (e.zipped) {
      audio.play('whoosh', { volume: 0.45, rate: 1.5 });
      r.shoot = 0;
    }
    if (e.up) this.fx.vfx('sparkle', s.x, s.y, { scale: 0.3, duration: 260, blend: 'add' });
  }

  /** Crossing the finish: a place call-out, confetti in their colour and the crowd on the tower goes wild. */
  private finish(r: Racer): void {
    this.finished++;
    r.place = this.finished;
    // A last fling carries them up onto the tower roof, wherever they crossed the line.
    const floor = SWING.FINISH_ROOF_Y - SWING.BODY;
    const rise = Math.max(90, r.s.y - floor + 90);
    r.s.vy = Math.min(r.s.vy, -Math.sqrt(2 * SWING.GRAV * 0.8 * rise));
    r.s.vx = Math.max(260, r.s.vx * 0.6);
    r.finishedAt = this.elapsed;
    r.p.doneAt = this.elapsed;
    const w = PLACE_WORDS[Math.min(3, r.place - 1)];
    this.pops.pop(w.key, r.s.x + 160, SWING.FINISH_ROOF_Y - 220, { owner: 20 + r.p.slot, scale: 1, rise: 50, hold: 900, tilt: -8 });
    audio.play(r.place === 1 ? 'fanfare' : 'victory', { volume: r.place === 1 ? 0.7 : 0.5 });
    audio.play('crowdCheer', { volume: 0.6 });
    const col = PLAYER_COLORS[r.p.slot];
    confettiBurst(this, r.s.x + 120, SWING.FINISH_ROOF_Y - 160, [col, col, 0xffffff, COLORS.goldLight], r.place === 1 ? 70 : 40, DEPTH.words - 1);
    if (r.place === 1) {
      this.hitStop(90);
      punch(this, 0.03, 300);
    }
    for (const spr of this.crowd) {
      const y = spr.y;
      this.tweens.add({ targets: spr, y: y - 16, duration: 140, yoyo: true, repeat: 1, ease: 'Quad.Out' });
    }
    this.rumble(r.p, 0.4, 0.5, 220);
  }

  /** A finisher sails onto the tower roof and celebrates there. */
  private landOnFinish(r: Racer, dt: number): void {
    if (r.landed) return;
    const s = r.s;
    const sec = dt / 1000;
    const spot = COURSE_LEN + 140 + (r.place - 1) * 105;
    s.vx += (Math.max(120, (spot - s.x) * 3) - s.vx) * (1 - Math.exp(-4 * sec));
    s.vy += SWING.GRAV * 0.8 * sec;
    s.x += s.vx * sec;
    s.y += s.vy * sec;
    const floor = SWING.FINISH_ROOF_Y - SWING.BODY;
    if (s.y >= floor && s.vy > 0) {
      s.y = floor;
      r.landed = true;
      r.tilt = 0;
      r.flip = 0;
      standOnFeet(r.c, s.x, SWING.FINISH_ROOF_Y);
      r.c.play(r.place === 1 ? 'victory' : 'celebrate', { force: true, returnTo: 'idle' });
      r.pose = 'finished';
      audio.play('land', { volume: 0.5 });
      this.fx.vfx('dust', s.x, SWING.FINISH_ROOF_Y, { scale: 0.3, duration: 360, alpha: 0.6 });
    }
  }

  // --- Visuals ---------------------------------------------------------------------------------
  protected override ambient(dt: number): void {
    if (this.phase === 'countdown') this.cameras.main.setScroll(this.camX, 0);
    this.syncWorld();
    const sec = dt / 1000;
    for (const r of this.racers) this.syncRacer(r, sec);
    this.drawWebs();
    this.drawAim();
    this.drawBar();
  }

  /** Scroll the backdrop and street, and keep building sprites and anchor hooks only where the camera is. */
  private syncWorld(): void {
    const cam = this.cameras.main.scrollX;
    const bx = -((cam * BACK_K) % GAME_WIDTH);
    this.backs[0]?.setX(bx);
    this.backs[1]?.setX(bx + GAME_WIDTH);
    const sx = -(cam % GAME_WIDTH);
    this.streets[0]?.setX(sx);
    this.streets[1]?.setX(sx + GAME_WIDTH);
    const A = this.course.anchors;
    const x0 = cam - 500;
    const x1 = cam + GAME_WIDTH + 500;
    this.hint = firstAnchorAfter(A, x0, this.hint);
    for (const [i, img] of this.towers) {
      if (A[i].x < x0 || A[i].x > x1) {
        img.setVisible(false);
        this.towerPool.push(img);
        this.towers.delete(i);
        const h = this.hooks.get(i);
        if (h) {
          h.setVisible(false);
          this.hookPool.push(h);
          this.hooks.delete(i);
        }
        const fan = this.fans.get(i);
        if (fan) {
          this.tweens.killTweensOf(fan);
          fan.setVisible(false);
          this.fanPool.push(fan);
          this.fans.delete(i);
        }
      }
    }
    for (let i = this.hint; i < A.length && A[i].x <= x1; i++) if (!this.towers.has(i)) this.placeTower(i, A[i]);
    const pulse = 0.75 + 0.25 * Math.sin(this.time.now / 260);
    for (const h of this.hooks.values()) h.setScale(0.85 * pulse + 0.2);
  }

  private placeTower(i: number, a: Anchor): void {
    const choices = this.arts.filter((t) => t.kind === a.kind);
    const art = (choices.length ? choices : this.arts)[i % Math.max(1, choices.length || this.arts.length)];
    const flip = art.kind === 'cornice' && i % 2 === 1;
    let img = this.towerPool.pop();
    if (!img) img = this.add.image(0, 0, art.key, art.frame);
    img.setTexture(art.key, art.frame).setOrigin(0).setFlipX(flip).setVisible(true);
    const ax = flip ? art.w - art.ax : art.ax;
    img.setPosition(a.x - ax, a.y - art.ay).setDepth(DEPTH.tower + (i % 2) * 0.5);
    // Alternate buildings sit a touch further back: slightly darker.
    img.setTint(i % 2 ? 0xd8dcf0 : 0xffffff);
    this.towers.set(i, img);
    let h = this.hookPool.pop();
    if (!h) h = this.add.image(0, 0, 'hws-hook').setDepth(DEPTH.hook).setBlendMode(Phaser.BlendModes.NORMAL);
    h.setPosition(a.x, a.y).setVisible(true);
    this.hooks.set(i, h);
    // Every so often a flat roof has someone on it, waving the racers on (clear of the hook).
    if (art.kind === 'cornice' && i % 4 === 1) {
      const folk: [NpcId, string][] = [
        ['ora', 'wave'],
        ['pipper', 'wave'],
        ['packsprout', 'cheer'],
        ['mimi', 'happy'],
        ['wrench', 'laugh'],
      ];
      const [id, pose] = folk[i % folk.length];
      const frame = npcFrame(id, pose);
      let fan = this.fanPool.pop();
      if (!fan) fan = this.add.sprite(0, 0, NPC_ATLAS, frame);
      const o = standOrigin(NPC_ATLAS, frame);
      const fx = a.x + (flip ? 1 : -1) * Math.min(120, art.w * 0.4);
      fan.setTexture(NPC_ATLAS, frame).setOrigin(o.x, o.y).setScale(0.3).setPosition(fx, a.y + 2).setFlipX(!flip).setDepth(DEPTH.tower + 0.8).setVisible(true);
      if (!calmMotion()) this.tweens.add({ targets: fan, y: a.y - 5, duration: 360 + (i % 3) * 70, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.fans.set(i, fan);
    }
  }

  private syncRacer(r: Racer, sec: number): void {
    const s = r.s;
    const c = r.c;
    if (r.landed || r.standing) return;
    const A = this.course.anchors;
    let pose = 'idle';
    let tilt = 0;
    switch (s.mode) {
      case 'roof':
        pose = Math.abs(s.vx) > 60 ? 'run' : 'idle';
        break;
      case 'swing': {
        pose = 'hang';
        const a = A[s.anchor];
        tilt = Math.atan2(a.x - s.x, s.y - a.y);
        break;
      }
      case 'air':
      case 'done':
        pose = s.vy < -80 ? 'fly' : s.vy > 520 ? 'fall' : 'dive';
        tilt = Phaser.Math.Clamp(Math.atan2(s.vy, Math.abs(s.vx) + 1) * 0.5, -0.5, 0.7) * (s.vx >= 0 ? 1 : -1);
        break;
      case 'down':
        pose = 'down';
        break;
      case 'zip':
        pose = 'zip';
        break;
    }
    this.setPose(r, pose);
    c.face(s.mode === 'roof' ? s.face < 0 : s.vx < -60);
    if (r.flip > 0 && s.mode !== 'swing') {
      r.flip = Math.max(0, r.flip - sec * 11);
    } else if (s.mode === 'swing') r.flip = 0;
    r.tilt += (tilt - r.tilt) * (1 - Math.exp(-14 * sec));
    const rot = r.tilt + (s.vx >= 0 ? 1 : -1) * r.flip;
    c.setPosition(s.x, s.y).setRotation(rot);
    uprightBadge(c, MARK, rot, CHAR_SCALE);
    r.shoot = Math.min(1, r.shoot + sec * 14);
    // Speed lines behind a fast fling.
    if (sec > 0 && this.phase === 'playing' && Math.hypot(s.vx, s.vy) > 820 && !calmMotion()) {
      r.trailT -= sec * 1000;
      if (r.trailT <= 0) {
        r.trailT = LITE ? 90 : 45;
        this.speedLine(s.x - s.vx * 0.05, s.y - s.vy * 0.05, Math.atan2(s.vy, s.vx), PLAYER_COLORS[r.p.slot]);
      }
    }
  }

  private speedLine(x: number, y: number, ang: number, tint: number): void {
    let img = this.trails.find((t) => !t.visible);
    if (!img) {
      if (this.trails.length >= (LITE ? 12 : 28)) return;
      img = this.add.image(0, 0, 'hh-streak').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.swinger - 2);
      this.trails.push(img);
    }
    const im = img;
    im.setPosition(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30).setRotation(ang + Math.PI / 2).setTint(tint).setAlpha(0.7).setScale(1.4, 1).setVisible(true);
    this.tweens.add({ targets: im, alpha: 0, scaleY: 0.4, duration: 220, onComplete: () => im.setVisible(false) });
  }

  /** Web lines: from each swinger's hands to their anchor (shooting out as they fire), and zip lines. */
  private drawWebs(): void {
    const g = this.webG;
    g.clear();
    const A = this.course.anchors;
    for (const r of this.racers) {
      const s = r.s;
      let tx: number;
      let ty: number;
      if (s.mode === 'swing' && s.anchor >= 0) {
        tx = A[s.anchor].x;
        ty = A[s.anchor].y;
      } else if (s.mode === 'zip') {
        tx = s.zipFrom.x + s.zipDX + 60;
        ty = 140;
      } else continue;
      const hx = s.x + Math.sin(r.tilt) * HAND;
      const hy = s.y - Math.cos(r.tilt) * HAND;
      const u = r.shoot;
      const ex = hx + (tx - hx) * u;
      const ey = hy + (ty - hy) * u;
      g.lineStyle(7, 0x0d1830, 0.28);
      g.lineBetween(hx, hy + 2, ex, ey + 2);
      g.lineStyle(4, 0xffffff, 0.95);
      g.lineBetween(hx, hy, ex, ey);
      g.lineStyle(2, PLAYER_COLORS[r.p.slot], 0.9);
      g.lineBetween(hx, hy, ex, ey);
    }
  }

  /** For people: a ring in their colour on the anchor their web would catch right now. */
  private drawAim(): void {
    const g = this.aimG;
    g.clear();
    if (this.phase !== 'playing') return;
    const A = this.course.anchors;
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 140);
    for (const r of this.racers) {
      if (r.p.isCpu || (r.s.mode !== 'air' && r.s.mode !== 'roof')) {
        r.aim = -1;
        continue;
      }
      r.aim = pickAnchor(A, r.s.x, r.s.y, this.hint);
      if (r.aim < 0) continue;
      const a = A[r.aim];
      const col = PLAYER_COLORS[r.p.slot];
      g.lineStyle(9, 0x0d1830, 0.35);
      g.strokeCircle(a.x, a.y + 2, 30 + pulse * 5);
      g.lineStyle(6, col, 0.95);
      g.strokeCircle(a.x, a.y, 30 + pulse * 5);
      drawPlayerShape(g, PLAYER_SHAPES[r.p.slot], a.x + 34, a.y - 30, 11, col, 0xffffff, 3);
      g.lineStyle(2, col, 0.35);
      g.lineBetween(r.s.x, r.s.y - HAND, a.x, a.y);
    }
  }

  private drawBar(): void {
    const g = this.barG;
    if (!g) return;
    const { x0, x1, y } = BAR;
    g.clear();
    const sorted = this.racers.slice().sort((a, b) => a.s.x - b.s.x);
    sorted.forEach((r, k) => {
      const f = Phaser.Math.Clamp(r.s.x / COURSE_LEN, 0, 1);
      const px = x0 + f * (x1 - x0);
      drawPlayerShape(g, PLAYER_SHAPES[r.p.slot], px, y - 8 - (k % 2) * 6, 13, PLAYER_COLORS[r.p.slot], 0xffffff, 3);
      if (r.place) {
        g.fillStyle(0xffd86a, 1);
        g.fillCircle(px + 11, y - 22 - (k % 2) * 6, 5);
      }
    });
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      this.webG?.clear();
      this.aimG?.clear();
      for (const r of this.racers) {
        // Racers on the start roof stand for the finish poses (everyone else is caught mid-swing).
        if (r.s.mode === 'roof') {
          r.tilt = 0;
          r.standing = true;
          standOnFeet(r.c, r.s.x, SWING.ROOF_Y);
          r.pose = 'idle';
        }
      }
    }
    super.end();
  }

  // --- CPU -------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const r = this.racers.find((x) => x.p === p);
    if (!r || r.s.mode === 'done') {
      vc.releaseAll();
      return;
    }
    const inp = swingCpu(r.brain, r.s, this.course, this.skill(p), dt, Math.random, r.input);
    vc.setMove(inp.stickX, 0);
    vc.hold('A', inp.holdA || inp.pressA);
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.racers.map((r) => ({ slot: r.p.slot, ...raceScore(!!r.place, r.finishedAt, r.s.x) }));
  }
}

