import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { CSS, PLAYER_COLORS, PLAYER_COLORS_CSS } from '../../../constants';
import type { Button } from '../../../input/buttons';
import type { VirtualControls } from '../../../input/PlayerInput';
import { LITE } from '../../../perf';
import { glyphKindFor, makeGlyph } from '../../../ui/ControllerPrompt';
import { addText } from '../../../ui/theme';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { kick, popToHud, punch, shockwave, titleTexture, type HudPop } from '../../../minigames/juice';
import { AFX, burst, ensureArenaFxTextures, Spray } from '../../../minigames/games/arenaFx';
import { bakeWord, WordPops } from '../../../minigames/games/stageKit';
import { calm, Crowd, finishAtlas, hasFrame, queueAtlas, startHint } from '../piratesKit';
import {
  BOMB_PENALTY,
  BOMB_WINDOW,
  beatTimes,
  buildChart,
  chutesFor,
  comboMult,
  DODGE_POINTS,
  HARBOUR,
  judge,
  laneAt,
  laneX,
  project,
  slicePoints,
  WINDOW,
  type Grade,
  type Note,
  type Proj,
} from './tripleSlashRules';

// --- Tempo and flight ----------------------------------------------------------------------------------
/** 140 bpm, like the minigame music; the final stretch quickens with it (x1.12). */
const BEAT = 60000 / 140;
const FAST_BEAT = BEAT / 1.12;
/** How long a note takes from the ship to the cut line: it shortens as the round goes on. */
const LEAD_START = 1750;
const LEAD_END = 1380;
/** Sprite render scale (px per metre) of the slash atlas, and each kind's size on the chute. */
const SPRITE_PPM = 300;
/** Everything on the chutes is drawn a little larger than life, to read from the sofa. */
const OBJ_SIZE = 1.25;
const PLAYER_SCALE = 0.8;
/** Screen height of the players' feet. */
const FEET_Y = 1005;
/** Button colours for the lanes' strike pads: X blue, A green, B red. */
const PAD_COLORS = [0x3b8ae6, 0x5cc34a, 0xe8483e];
const LANE_BUTTONS: readonly Button[][] = [
  ['X', 'LEFT'],
  ['A', 'Y', 'UP', 'DOWN'],
  ['B', 'RIGHT'],
];
const PAD_KEYS: Button[] = ['X', 'A', 'B'];
const PAD_KEYS_KB: Button[] = ['LEFT', 'UP', 'RIGHT'];
const WHIFF_MS = 150;
const STUN_MS = 750;
const POP_SIZE = 52;
/** Combo tiers colour the slash streaks: white, gold, cyan, pink. */
const TIER_COLORS = [0xffffff, 0xffd84a, 0x5ce1ff, 0xff7ad9];

// --- Depths --------------------------------------------------------------------------------------------
const D_PAD = 20;
const D_OBJ = 100;
const D_HALF = 700;
const D_SLASH = 720;
const D_CHAR = 800;
const D_UI = 8200;

interface Obj {
  active: boolean;
  note: Note;
  lane: number;
  speed: number;
  judged: boolean;
  spr: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  glint: Phaser.GameObjects.Image;
  /** Distance travelled (m), for the roll and tumble frames. */
  roll: number;
  crashed: boolean;
}

interface Half {
  img: Phaser.GameObjects.Image;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  t: number;
}

interface Slasher {
  p: MgPlayer;
  c: Character;
  chute: number;
  x: number;
  combo: number;
  best: number;
  perfects: number;
  stunT: number;
  whiff: number[];
  objs: Obj[];
  next: number;
  pads: Phaser.GameObjects.Container[];
  padFlash: number[];
  comboText: Phaser.GameObjects.Text;
  multText: Phaser.GameObjects.Text;
  words: WordPops;
  poseT: number;
  /** CPU: the lanes it means to slash and when (parallel arrays, reused; notes it lets pass aren't here). */
  planLane: number[];
  planAt: number[];
  /** The score pop-up still gathering over the cut line. */
  pop?: { h: HudPop; value: number };
}

/**
 * Triple Slash (Zoro's minigame) - barrels, crates and flying fish hurtle down each player's cargo
 * chute in three lanes. Slice each as it crosses the line (X left, A centre, B right, or the D-pad): on
 * the beat is PERFECT, and a combo multiplies the points. Let the fizzing bombs roll past. Top score
 * after 40 seconds wins.
 */
export class TripleSlashScene extends BaseMinigame {
  private slashers: Slasher[] = [];
  private chart: Note[] = [];
  private beats: number[] = [];
  private beatNext = 0;
  private beatIdx = 0;
  private hasAtlas = false;
  private padG!: Phaser.GameObjects.Graphics;
  private halves: Half[] = [];
  private slashes: Phaser.GameObjects.Image[] = [];
  private chips?: Spray;
  private drops?: Spray;
  private smoke?: Spray;
  private sparks?: Spray;
  private crowd?: Crowd;
  private pulse = 0;
  private wrapped = false;
  private tmp: Proj = { x: 0, y: 0, s: 0 };
  /** Which of the four chutes have a player on them. */
  private chuteUsed = [false, false, false, false];
  private tmp2: Proj = { x: 0, y: 0, s: 0 };

  constructor() {
    super('mg-triple-slash');
  }

  preload(): void {
    queueAtlas(this, 'pirates-slash', 'pirates_slash');
  }

  // --- Arena ---------------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = 40000;
    this.slashers = [];
    this.chuteUsed.fill(false);
    this.halves = [];
    this.slashes = [];
    this.beatNext = 0;
    this.beatIdx = 0;
    this.pulse = 0;
    this.wrapped = false;
    finishAtlas(this, 'pirates-slash');
    this.hasAtlas = hasFrame(this, 'pirates-slash', 'barrel_0');
    const opts = { duration: this.duration, beat: BEAT, fastBeat: FAST_BEAT, fastFrom: this.duration - 10000, start: 2200 };
    this.chart = buildChart(() => this.rng.next(), opts);
    this.beats = beatTimes(opts);
    ensureArenaFxTextures(this);
    this.makeSlashTexture();
    for (const [key, text, fill] of [
      ['ts-w-perfect', 'PERFECT!', ['#fff6c0', '#ffc83a']],
      ['ts-w-good', 'GOOD', ['#e6fbff', '#5ce1ff']],
      ['ts-w-ok', 'OK', ['#ffffff', '#d8e2ee']],
      ['ts-w-miss', 'MISS', ['#e8e8ee', '#9aa3b8']],
      ['ts-w-boom', 'BOOM!', ['#ffd0c8', '#ff5a4a']],
      ['ts-w-dodge', 'DODGED!', ['#e6ffd8', '#7fe05a']],
      ['ts-w-whiff', 'WHIFF', ['#e8e8ee', '#9aa3b8']],
    ] as [string, string, readonly [string, string]][]) {
      bakeWord(this, key, text, { size: 50, fill });
    }
    for (let v = 1; v <= 24; v++) titleTexture(this, `+${v}`, POP_SIZE, v >= 9 ? CSS.goldLight : '#ffffff');
    if (this.textures.exists('rendered-scene-pirates_harbour')) this.add.image(0, 0, 'rendered-scene-pirates_harbour').setOrigin(0).setDepth(-50);
    else this.fallbackHarbour();
    this.padG = this.add.graphics().setDepth(D_PAD);
    for (let i = 0; i < 28; i++) {
      this.halves.push({ img: this.add.image(0, 0, '__WHITE').setVisible(false).setDepth(D_HALF), active: false, x: 0, y: 0, vx: 0, vy: 0, spin: 0, t: 0 });
    }
    for (let i = 0; i < 12; i++) this.slashes.push(this.add.image(0, 0, 'ts-slash').setVisible(false).setDepth(D_SLASH).setBlendMode(Phaser.BlendModes.ADD));
    this.chips = new Spray(this, AFX.chip, { depth: D_HALF + 5, reserve: LITE ? 40 : 90, lifespan: [420, 720], gravity: 900, scale: { start: 1.3, end: 0.8 }, alpha: { start: 1, end: 0 }, tint: [0xb8783f, 0x8d5a33, 0xd9a468], spin: 0.03 });
    this.drops = new Spray(this, AFX.drop, { depth: D_HALF + 4, reserve: LITE ? 30 : 60, lifespan: [380, 620], gravity: 800, scale: { start: 1.1, end: 0.5 }, alpha: { start: 1, end: 0 }, tint: [0x9fe2ff, 0xffffff, 0x5ec8ff] });
    this.smoke = new Spray(this, 'fx-dot', { depth: D_HALF + 6, reserve: LITE ? 24 : 48, lifespan: [500, 900], gravity: -120, scale: { start: 1.6, end: 3.4 }, alpha: { start: 0.55, end: 0 }, tint: [0x6a6a72, 0x9a9aa4, 0x4a4a52] });
    this.sparks = new Spray(this, 'fx-dot', { depth: D_OBJ + 90, reserve: LITE ? 30 : 70, lifespan: [160, 320], gravity: 300, scale: { start: 0.55, end: 0 }, alpha: { start: 1, end: 0.2 }, tint: [0xfff1a8, 0xffb347, 0xffffff], add: true });
    this.buildCrowd();
  }

  /** A crescent sword streak (white, additive; tinted per combo tier). */
  private makeSlashTexture(): void {
    if (this.textures.exists('ts-slash')) return;
    const W = 256;
    const H = 96;
    const tex = this.textures.createCanvas('ts-slash', W, H);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.translate(W / 2, H * 1.4);
    for (let i = 0; i < 3; i++) {
      const r = H * 1.25 - i * 6;
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI * 1.22, Math.PI * 1.78);
      ctx.arc(0, -10 - i * 2, r - 18 + i * 4, Math.PI * 1.74, Math.PI * 1.26, true);
      ctx.closePath();
      ctx.fillStyle = i === 2 ? 'rgba(255,255,255,1)' : `rgba(255,255,255,${0.25 + i * 0.2})`;
      ctx.fill();
    }
    tex.refresh();
  }

  private fallbackHarbour(): void {
    const g = this.add.graphics().setDepth(-50);
    g.fillStyle(0x7fb6ff, 1);
    g.fillRect(0, 0, 1920, 200);
    g.fillStyle(0x1b8aae, 1);
    g.fillRect(0, 200, 1920, 880);
    g.fillStyle(0x6e4328, 1);
    g.fillRect(300, 190, 1320, 140);
    const q = this.tmp;
    for (const c of [0, 1, 2, 3]) {
      g.fillStyle(0xc49058, 1);
      const pts: Phaser.Types.Math.Vector2Like[] = [];
      for (const [lane, Y] of [
        [-0.6, HARBOUR.yNear - 0.8],
        [2.6, HARBOUR.yNear - 0.8],
        [2.6, HARBOUR.yFar],
        [-0.6, HARBOUR.yFar],
      ]) {
        project(laneX(c, lane, Y), Y, HARBOUR.floorZ, q);
        pts.push({ x: q.x, y: q.y });
      }
      g.fillPoints(pts, true);
    }
    g.fillStyle(0xb07a48, 1);
    g.fillRect(0, 730, 1920, 350);
  }

  private buildCrowd(): void {
    this.crowd = new Crowd(
      this,
      [
        { id: 'ora', pose: 'cheer', x: 70, y: 560, scale: 0.3 },
        { id: 'pipper', pose: 'happy', x: 150, y: 590, scale: 0.32 },
        { id: 'wrench', pose: 'laugh', x: 1770, y: 590, scale: 0.32 },
        { id: 'mimi', pose: 'happy', x: 1850, y: 560, scale: 0.3 },
      ],
      D_OBJ - 5,
    );
  }

  // --- Players -------------------------------------------------------------------------------------
  protected createPlayer(p: MgPlayer, index: number): void {
    const chute = chutesFor(this.players.length)[index] ?? index;
    const q = project(laneX(chute, 1, HARBOUR.yNear), HARBOUR.yNear, HARBOUR.floorZ, this.tmp);
    const x = q.x;
    // a glowing base in the player's colour stands in for the badge (it would sit on the cut line)
    const base = this.add.graphics().setDepth(D_CHAR - 1);
    base.fillStyle(PLAYER_COLORS[p.slot], 0.35);
    base.fillEllipse(x, FEET_Y + 2, 170, 44);
    base.lineStyle(5, PLAYER_COLORS[p.slot], 1);
    base.strokeEllipse(x, FEET_Y + 2, 170, 44);
    const c = new Character(this, x, FEET_Y, p.characterId, { scale: PLAYER_SCALE, slot: p.slot, marker: false });
    c.setDepth(D_CHAR);
    p.character = c;
    const kb = glyphKindFor(p.slot) === 'keyboard';
    const pads: Phaser.GameObjects.Container[] = [];
    if (!p.isCpu) {
      for (let lane = 0; lane < 3; lane++) {
        const g = makeGlyph(this, (kb ? PAD_KEYS_KB : PAD_KEYS)[lane], 38, glyphKindFor(p.slot));
        const pq = project(laneX(chute, lane, HARBOUR.yCut - 0.62), HARBOUR.yCut - 0.62, HARBOUR.floorZ, this.tmp2);
        g.setPosition(pq.x, pq.y).setDepth(D_PAD + 2);
        pads.push(g);
      }
    }
    const plateY = 1050;
    const plate = this.add.graphics().setDepth(D_UI);
    plate.fillStyle(0x0a1120, 0.6);
    plate.fillRoundedRect(x - 92, plateY - 22, 184, 44, 22);
    plate.lineStyle(3, PLAYER_COLORS[p.slot], 1);
    plate.strokeRoundedRect(x - 92, plateY - 22, 184, 44, 22);
    const comboText = addText(this, x - 22, plateY, 'COMBO 0', 22, { color: '#ffffff', weight: 700 }).setDepth(D_UI + 1);
    const multText = addText(this, x + 58, plateY, 'x1', 26, { color: PLAYER_COLORS_CSS[p.slot], weight: 700 }).setDepth(D_UI + 1);
    this.slashers.push({
      p,
      c,
      chute,
      x,
      combo: 0,
      best: 0,
      perfects: 0,
      stunT: 0,
      whiff: [0, 0, 0],
      objs: [],
      next: 0,
      pads,
      padFlash: [0, 0, 0],
      comboText,
      multText,
      words: new WordPops(this, D_UI - 10, 6),
      poseT: 0,
      planLane: [],
      planAt: [],
    });
    this.chuteUsed[chute] = true;
    for (let i = 0; i < 12; i++) this.slashers[this.slashers.length - 1].objs.push(this.makeObj());
  }

  private makeObj(): Obj {
    const tex = this.hasAtlas ? 'pirates-slash' : 'fx-dot';
    const spr = this.add.image(0, 0, tex, this.hasAtlas ? 'barrel_0' : undefined).setVisible(false);
    const shadow = this.add.image(0, 0, 'fx-contact').setVisible(false).setAlpha(0.45);
    const glint = this.add.image(0, 0, this.textures.exists('fx-rays') ? 'fx-rays' : 'fx-dot').setVisible(false).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd23a);
    return { active: false, note: { t: 0, lane: 1, kind: 'barrel', from: 1 }, lane: 1, speed: 0, judged: false, spr, shadow, glint, roll: 0, crashed: false };
  }

  protected override onStart(): void {
    audio.play('crack', { volume: 0.4 });
    for (const s of this.slashers) s.c.play('wave');
    if (this.humanSlots().length) startHint(this, 'X, A and B slice the left, middle and right lanes \u2014 on the beat!', 560);
  }

  protected override bannerY(): number {
    return 470;
  }

  protected override onFinalStretch(): void {
    this.showFinalStretch('SPEED UP!');
    this.crowd?.cheer(true);
  }

  protected override hudLabel(p: MgPlayer): string {
    return String(p.score);
  }

  // --- Notes on the chutes -------------------------------------------------------------------------
  private leadAt(t: number): number {
    const u = Math.min(1, Math.max(0, t / this.duration));
    return LEAD_START + (LEAD_END - LEAD_START) * u;
  }

  private spawnNotes(s: Slasher): void {
    while (s.next < this.chart.length) {
      const n = this.chart[s.next];
      const lead = this.leadAt(n.t);
      if (n.t - lead > this.elapsed) break;
      s.next++;
      const o = s.objs.find((q) => !q.active);
      if (!o) continue;
      o.active = true;
      o.note = n;
      o.lane = n.from;
      o.speed = (HARBOUR.yFar - HARBOUR.yCut) / lead;
      o.judged = false;
      o.crashed = false;
      o.roll = 0;
      const frame = this.frameFor(n.kind, 0);
      if (this.hasAtlas) o.spr.setTexture('pirates-slash', frame).clearTint();
      else o.spr.setTexture('fx-dot').setTint(n.kind === 'bomb' ? 0x2a2c34 : n.kind === 'gold' ? 0xffc83a : n.kind === 'fish' ? 0x2bb3c8 : 0xb8783f);
      o.spr.setVisible(true).setAlpha(1).setAngle(0);
      o.shadow.setVisible(true);
      o.glint.setVisible(n.kind === 'gold');
      if (!s.p.isCpu) continue;
      this.planCpu(s, n);
    }
  }

  private frameFor(kind: Note['kind'], k: number): string {
    switch (kind) {
      case 'barrel':
        return `barrel_${k % 8}`;
      case 'gold':
        return `gold_${k % 8}`;
      case 'crate':
        return `crate_${k % 4}`;
      case 'fish':
        return `fish_${k % 2}`;
      default:
        return 'bomb';
    }
  }

  /** Where a note is: its world depth, lane and height above the chute floor. */
  private placeObj(o: Obj, s: Slasher): void {
    const n = o.note;
    const Y = HARBOUR.yCut + (n.t - this.elapsed) * o.speed;
    const u = (HARBOUR.yFar - Y) / (HARBOUR.yFar - HARBOUR.yCut);
    const lane = laneAt(n, u);
    o.lane = lane;
    o.roll = HARBOUR.yFar - Y;
    let z = 0;
    let size = OBJ_SIZE;
    if (n.kind === 'fish') {
      // leaps out of the water beside the chute, glides down the lane, hops across if it switches
      const leap = Math.min(1, u / 0.18);
      z = 0.3 + 0.45 * Math.sin(leap * Math.PI * 0.5) + 0.08 * Math.sin(u * Math.PI * 6);
      if (n.from !== n.lane) z += 0.35 * Math.sin(Math.min(1, Math.max(0, (u - 0.45) / 0.2)) * Math.PI);
    } else if (n.kind === 'crate') {
      z = Math.abs(Math.sin(o.roll * 1.9)) * 0.12;
      size = OBJ_SIZE * 1.05;
    } else if (n.kind === 'bomb') {
      size = OBJ_SIZE * 0.92;
    }
    const fx = n.kind === 'fish' && u < 0.18 ? laneX(s.chute, lane < 1 ? -0.8 : 2.8, Y) * (1 - u / 0.18) + laneX(s.chute, lane, Y) * (u / 0.18) : laneX(s.chute, lane, Y);
    const q = project(fx, Y, HARBOUR.floorZ + z, this.tmp);
    const g = project(fx, Y, HARBOUR.floorZ, this.tmp2);
    const k = (q.s / SPRITE_PPM) * size;
    o.spr.setPosition(q.x, q.y).setScale(this.hasAtlas ? k : k * 12).setDepth(D_OBJ + (40 - Y));
    o.shadow.setPosition(g.x, g.y + 2).setScale(k * 1.6, k * 0.55).setDepth(D_OBJ + (40 - Y) - 0.5).setAlpha(n.kind === 'fish' ? 0.25 : 0.45);
    if (this.hasAtlas) {
      const f = n.kind === 'fish' ? Math.floor(this.elapsed / 90) : Math.floor(o.roll * 3.2);
      o.spr.setFrame(this.frameFor(n.kind, f));
    }
    if (n.kind === 'bomb') {
      o.spr.setAngle(Math.sin(o.roll * 4) * 8);
      if (Math.random() < (LITE ? 0.25 : 0.5)) this.sparks?.fire(q.x + 10 * k * 3, q.y - 150 * k, 1, -90, 60, 40, 140);
    }
    if (n.kind === 'gold') o.glint.setPosition(q.x, q.y - 90 * k).setScale(k * 1.6).setAngle(this.elapsed * 0.08).setAlpha(0.7).setDepth(o.spr.depth - 0.2);
  }

  private updateObjs(s: Slasher, dt: number): void {
    for (const o of s.objs) {
      if (!o.active) continue;
      const n = o.note;
      const late = this.elapsed - n.t;
      if (!o.judged && late > (n.kind === 'bomb' ? BOMB_WINDOW : WINDOW.ok)) {
        o.judged = true;
        if (n.kind === 'bomb') this.dodged(s, o);
        else this.missed(s);
      }
      const Y = HARBOUR.yCut + (n.t - this.elapsed) * o.speed;
      if (o.judged && Y < HARBOUR.yNear + 0.35) {
        if (!o.crashed) this.crash(s, o);
        continue;
      }
      this.placeObj(o, s);
    }
    void dt;
  }

  private freeObj(o: Obj): void {
    o.active = false;
    o.spr.setVisible(false);
    o.shadow.setVisible(false);
    o.glint.setVisible(false);
  }

  // --- Slashing ------------------------------------------------------------------------------------
  private readLanes(s: Slasher): void {
    const c = s.p.controls;
    for (let lane = 0; lane < 3; lane++) {
      const btns = LANE_BUTTONS[lane];
      let hit = false;
      for (let i = 0; i < btns.length && !hit; i++) hit = c.pressed(btns[i]);
      if (hit) this.slash(s, lane);
    }
  }

  private slash(s: Slasher, lane: number): void {
    if (s.stunT > 0 || s.whiff[lane] > 0) return;
    // the nearest unjudged note crossing in this lane
    let best: Obj | null = null;
    let bestDt = 1e9;
    for (const o of s.objs) {
      if (!o.active || o.judged || o.note.lane !== lane) continue;
      const dt = this.elapsed - o.note.t;
      if (Math.abs(dt) < Math.abs(bestDt)) {
        bestDt = dt;
        best = o;
      }
    }
    this.pose(s, lane);
    s.padFlash[lane] = 1;
    const cut = project(laneX(s.chute, lane, HARBOUR.yCut), HARBOUR.yCut, HARBOUR.floorZ + 0.3, this.tmp);
    if (best && best.note.kind === 'bomb' && Math.abs(bestDt) <= BOMB_WINDOW) {
      this.boom(s, best, cut.x, cut.y);
      return;
    }
    const grade = best ? judge(bestDt) : null;
    if (!best || !grade || best.note.kind === 'bomb') {
      this.whiffed(s, lane, cut.x, cut.y);
      return;
    }
    this.slice(s, best, grade, cut.x, cut.y, lane);
  }

  private slice(s: Slasher, o: Obj, grade: Grade, x: number, y: number, lane: number): void {
    o.judged = true;
    s.combo++;
    s.best = Math.max(s.best, s.combo);
    if (grade === 'perfect') s.perfects++;
    const pts = slicePoints(grade, o.note.kind, s.combo);
    s.p.score += pts;
    const tier = comboMult(s.combo) - 1;
    this.streak(x, y, lane, tier, o.spr.scaleX / 0.5);
    this.splitObj(o, lane);
    const gold = o.note.kind === 'gold';
    audio.play('whoosh', { volume: 0.4, rate: 1.5 + lane * 0.08, throttleMs: 20 });
    audio.play(grade === 'perfect' ? 'crack' : 'pop', { volume: grade === 'perfect' ? 0.35 : 0.4, rate: grade === 'perfect' ? 1.4 : 1.1, throttleMs: 25 });
    if (gold) audio.play('goldChip', { volume: 0.7 });
    if (o.note.kind === 'fish') this.drops?.fire(x, y, burst(10), -90, 70, 160, 380);
    else this.chips?.fire(x, y, burst(gold ? 16 : 9), -90, 80, 180, 420);
    s.words.pop(grade === 'perfect' ? 'ts-w-perfect' : grade === 'good' ? 'ts-w-good' : 'ts-w-ok', s.x, 700, { scale: grade === 'perfect' ? 0.95 : 0.8, owner: 0, rise: 26, hold: 260 });
    this.popScore(s, pts, x, y - 40);
    this.rumble(s.p, grade === 'perfect' ? 0.25 : 0.12, 0.2, 50);
    if (s.combo === 5 || s.combo === 15 || s.combo === 30) this.comboUp(s);
    this.refreshCombo(s);
  }

  private splitObj(o: Obj, lane: number): void {
    const spr = o.spr;
    const frame = spr.frame;
    const w = frame.realWidth;
    const h = frame.realHeight;
    // cut through the middle of what's drawn (the frame's anchor is the contact point, below the object)
    const ss = (frame as unknown as { data?: { spriteSourceSize?: { y: number; h: number } } }).data?.spriteSourceSize;
    const mid = frame.trimmed && ss ? ss.y + ss.h / 2 : h / 2;
    for (let i = 0; i < 2; i++) {
      const hf = this.halves.find((q) => !q.active);
      if (!hf) break;
      hf.active = true;
      hf.t = 0;
      hf.x = spr.x;
      hf.y = spr.y;
      const side = i === 0 ? -1 : 1;
      hf.vx = side * (160 + Math.random() * 120) + (lane - 1) * 60;
      hf.vy = -260 - Math.random() * 160 - (i === 0 ? 120 : 0);
      hf.spin = side * (240 + Math.random() * 240);
      hf.img.setTexture(spr.texture.key, frame.name).setScale(spr.scaleX, spr.scaleY).setOrigin(0.5, 0.5).setAngle(0).setAlpha(1).setVisible(true).setTint(0xffffff);
      if (this.hasAtlas) hf.img.setCrop(0, i === 0 ? 0 : mid, w, i === 0 ? mid : h - mid);
      hf.img.setPosition(hf.x, hf.y);
    }
    this.freeObj(o);
  }

  private updateHalves(dt: number): void {
    const s = dt / 1000;
    for (const h of this.halves) {
      if (!h.active) continue;
      h.t += dt;
      h.vy += 1500 * s;
      h.x += h.vx * s;
      h.y += h.vy * s;
      h.img.setPosition(h.x, h.y).setAngle(h.img.angle + h.spin * s).setAlpha(Math.max(0, 1 - h.t / 650));
      if (h.t > 650) {
        h.active = false;
        h.img.setVisible(false).setCrop();
      }
    }
  }

  /** A crescent streak across the lane at the cut line, tinted by the combo tier. */
  private streak(x: number, y: number, lane: number, tier: number, k: number): void {
    const img = this.slashes.find((q) => !q.visible);
    if (!img) return;
    const ang = lane === 0 ? -28 : lane === 2 ? 28 : Math.random() < 0.5 ? -8 : 8;
    const scale = Math.max(0.7, Math.min(1.4, k * 0.9));
    img.setPosition(x, y - 30).setAngle(ang).setTint(TIER_COLORS[Math.min(3, tier)]).setAlpha(1).setScale(scale * 0.5, scale).setVisible(true).setFlipX(lane === 2);
    this.tweens.killTweensOf(img);
    this.tweens.add({ targets: img, scaleX: scale * 1.25, duration: 90, ease: 'Quad.Out' });
    this.tweens.add({ targets: img, alpha: 0, delay: 60, duration: 150, ease: 'Quad.In', onComplete: () => img.setVisible(false) });
  }

  /**
   * The points pop off the cut line and fly to the player's capsule. Slices in quick succession add to
   * the pop-up still gathering ("+6" -> "+12") rather than each throwing its own, so a busy stretch
   * doesn't fill the screen with numbers.
   */
  private popScore(s: Slasher, value: number, x: number, y: number): void {
    const slot = s.p.slot;
    this.holdHud(slot, value);
    const open = s.pop;
    if (open && open.h.gathering && open.h.image.active) {
      open.value += value;
      open.h.retitle(`+${open.value}`, open.value >= 9 ? CSS.goldLight : '#ffffff');
      return;
    }
    const h = this.hudPoint(slot);
    const entry: { h?: HudPop; value: number } = { value };
    entry.h = popToHud(this, x, y, `+${value}`, h.x, h.y, {
      color: value >= 9 ? CSS.goldLight : '#ffffff',
      size: POP_SIZE,
      onArrive: () => {
        this.releaseHud(slot, entry.value);
        this.bumpHud(slot);
        if (s.pop === entry) s.pop = undefined;
      },
    });
    s.pop = entry as { h: HudPop; value: number };
  }

  private comboUp(s: Slasher): void {
    const m = comboMult(s.combo);
    const key = titleTexture(this, `x${m} COMBO!`, 46, PLAYER_COLORS_CSS[s.p.slot]);
    const img = this.add.image(s.x, 590, key).setDepth(D_UI).setScale(0.3);
    this.tweens.add({ targets: img, scale: 1, duration: 220, ease: 'Back.Out' });
    this.tweens.add({ targets: img, y: 550, alpha: 0, delay: 700, duration: 300, onComplete: () => img.destroy() });
    shockwave(this, s.x, 590, { radius: 130, ratio: 0.5, color: PLAYER_COLORS[s.p.slot], alpha: 0.8, duration: 380, depth: D_UI - 1 });
    audio.play('streak', { volume: 0.6, rate: 0.9 + m * 0.1 });
    s.c.play('celebrate');
    if (m >= 3) this.crowd?.cheer(m >= 4);
  }

  private whiffed(s: Slasher, lane: number, x: number, y: number): void {
    s.whiff[lane] = WHIFF_MS;
    audio.play('whoosh', { volume: 0.25, rate: 0.9 });
    this.streak(x, y, lane, 0, 0.8);
    if (s.combo > 0) {
      s.words.pop('ts-w-whiff', s.x, 700, { scale: 0.7, owner: 0, rise: 20 });
      this.breakCombo(s);
    }
  }

  private missed(s: Slasher): void {
    if (s.combo > 0 || !s.p.isCpu) s.words.pop('ts-w-miss', s.x, 700, { scale: 0.75, owner: 0, rise: 20 });
    this.breakCombo(s);
  }

  private breakCombo(s: Slasher): void {
    if (s.combo >= 5) audio.play('chipLose', { volume: 0.35 });
    s.combo = 0;
    this.refreshCombo(s);
  }

  private refreshCombo(s: Slasher): void {
    const t = `COMBO ${s.combo}`;
    if (s.comboText.text !== t) {
      s.comboText.setText(t);
      if (s.combo > 0 && !calm()) this.tweens.add({ targets: s.comboText, scale: { from: 1.25, to: 1 }, duration: 140 });
    }
    const m = `x${comboMult(s.combo)}`;
    if (s.multText.text !== m) {
      s.multText.setText(m);
      this.tweens.add({ targets: s.multText, scale: { from: 1.5, to: 1 }, duration: 220, ease: 'Back.Out' });
    }
  }

  /** A missed note slams into the end of the chute at the player's feet. */
  private crash(s: Slasher, o: Obj): void {
    o.crashed = true;
    const q = project(laneX(s.chute, o.note.lane, HARBOUR.yNear + 0.35), HARBOUR.yNear + 0.35, HARBOUR.floorZ + 0.2, this.tmp);
    if (o.note.kind === 'bomb') {
      this.freeObj(o);
      return;
    }
    if (o.note.kind === 'fish') this.drops?.fire(q.x, q.y, burst(8), -90, 60, 120, 300);
    else this.chips?.fire(q.x, q.y, burst(10), -90, 75, 160, 380);
    audio.play('hit', { volume: 0.4, rate: 1.2, throttleMs: 60 });
    s.c.play('surprised', { force: true });
    s.c.squash(0.12, 150);
    this.freeObj(o);
  }

  /** A bomb rolls past the line untouched: its fuse fizzles out (a point for keeping your nerve). */
  private dodged(s: Slasher, o: Obj): void {
    const q = project(laneX(s.chute, o.note.lane, HARBOUR.yCut - 0.3), HARBOUR.yCut - 0.3, HARBOUR.floorZ + 0.3, this.tmp);
    this.smoke?.fire(q.x, q.y - 20, burst(6), -90, 50, 30, 90);
    audio.play('pop', { volume: 0.25, rate: 0.6 });
    s.p.score += DODGE_POINTS;
    s.words.pop('ts-w-dodge', s.x, 700, { scale: 0.7, owner: 0, rise: 20 });
    this.freeObj(o);
  }

  private boom(s: Slasher, o: Obj, x: number, y: number): void {
    o.judged = true;
    this.freeObj(o);
    s.p.score = Math.max(0, s.p.score - BOMB_PENALTY);
    this.breakCombo(s);
    s.stunT = STUN_MS;
    s.c.play('stunned', { force: true, returnTo: 'idle' });
    s.c.sprite.setTint(0x5a5a64);
    this.time.delayedCall(420, () => s.c.sprite.clearTint());
    this.fx.vfx('explosion', x, y - 20, { scale: 0.8, duration: 520, depth: D_SLASH + 5 });
    this.smoke?.fire(x, y - 20, burst(12), -90, 120, 60, 220);
    shockwave(this, x, y, { radius: 200, ratio: 0.45, color: 0xffb070, alpha: 0.9, duration: 420, depth: D_SLASH + 4 });
    audio.play('explosion', { volume: 0.7 });
    s.words.pop('ts-w-boom', s.x, 690, { scale: 1, owner: 0, rise: 30 });
    this.hitStop(90);
    kick(this, 0, 14, 180);
    this.rumble(s.p, 0.8, 0.6, 260);
  }

  private pose(s: Slasher, lane: number): void {
    s.poseT = 150;
    if (lane === 1) s.c.hold('throw', 1);
    else {
      s.c.hold('dash', 0);
      s.c.face(lane === 0);
    }
    s.c.squash(0.1, 120);
  }

  // --- Beat ----------------------------------------------------------------------------------------
  /** The drum: a thump on every beat of the chart's grid (a heavier one each bar); the pads pulse with it. */
  private updateBeat(dt: number): void {
    this.pulse *= Math.exp(-dt / 120);
    while (this.beatNext < this.beats.length && this.elapsed >= this.beats[this.beatNext]) {
      this.beatNext++;
      this.beatIdx++;
      const accent = this.beatIdx % 4 === 1;
      audio.play('step', { volume: accent ? 0.5 : 0.32, rate: accent ? 0.72 : 0.9 });
      this.pulse = accent ? 1 : 0.6;
      if (accent && !calm()) for (const spr of this.crowd?.sprites ?? []) this.tweens.add({ targets: spr, scaleY: { from: spr.scaleY * 0.94, to: spr.scaleY }, duration: 160 });
    }
  }

  /** Each chute's cut line and three strike pads (they pulse on the beat and flash on a slash). */
  private drawPads(dt: number): void {
    const g = this.padG;
    g.clear();
    const Y = HARBOUR.yCut;
    const d = HARBOUR.lane / 2;
    const q = this.tmp;
    const q2 = this.tmp2;
    for (const s of this.slashers) {
      const L = project(laneX(s.chute, -0.5, Y), Y, HARBOUR.floorZ, q);
      const lx = L.x;
      const ly = L.y;
      const R = project(laneX(s.chute, 2.5, Y), Y, HARBOUR.floorZ, q2);
      const glow = 0.45 + 0.4 * this.pulse;
      g.lineStyle(14, 0xffffff, 0.12 + 0.12 * this.pulse);
      g.lineBetween(lx, ly, R.x, R.y);
      g.lineStyle(5, s.stunT > 0 ? 0x9a9aa4 : 0xfff1c8, glow);
      g.lineBetween(lx, ly, R.x, R.y);
      for (let lane = 0; lane < 3; lane++) {
        s.padFlash[lane] = Math.max(0, s.padFlash[lane] - dt / 160);
        s.whiff[lane] = Math.max(0, s.whiff[lane] - dt);
        const a = project(laneX(s.chute, lane, Y), Y, HARBOUR.floorZ, q);
        const w = (d * 2 - 0.08) * a.s;
        const h = w * 0.34;
        const col = PAD_COLORS[lane];
        const f = s.padFlash[lane];
        g.fillStyle(col, (s.p.isCpu ? 0.22 : 0.34) + 0.25 * this.pulse + 0.4 * f);
        g.fillEllipse(a.x, a.y, w * (1 + 0.12 * f), h * (1 + 0.12 * f));
        g.lineStyle(3, f > 0.1 ? 0xffffff : col, 0.9);
        g.strokeEllipse(a.x, a.y, w * (1 + 0.12 * f), h * (1 + 0.12 * f));
      }
    }
    // closed chutes (fewer than four players): a rope across the line
    for (let c = 0; c < 4; c++) {
      if (this.chuteUsed[c]) continue;
      const a = project(laneX(c, -0.6, Y), Y, HARBOUR.floorZ + 0.4, q);
      const b = project(laneX(c, 2.6, Y), Y, HARBOUR.floorZ + 0.4, q2);
      g.lineStyle(7, 0x6a5238, 1);
      g.lineBetween(a.x, a.y, b.x, b.y + 10);
      g.fillStyle(0x3a2e2a, 1);
      g.fillRect(a.x - 5, a.y - 6, 10, 46);
      g.fillRect(b.x - 5, b.y - 6, 10, 46);
    }
  }

  // --- Frame ---------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.updateBeat(dt);
    for (const s of this.slashers) {
      s.stunT = Math.max(0, s.stunT - dt);
      if (s.poseT > 0) {
        s.poseT -= dt;
        if (s.poseT <= 0 && s.stunT <= 0 && (s.c.current === 'throw' || s.c.current === 'dash')) s.c.play('idle');
      }
      this.spawnNotes(s);
      this.readLanes(s);
      this.updateObjs(s, dt);
    }
    this.updateHalves(dt);
    this.drawPads(dt);
  }

  protected override ambient(dt: number): void {
    // Particles follow the minigame clock: frozen in a hit-stop, slowed in slow motion.
    const k = this.time.timeScale;
    this.chips?.sync(k);
    this.drops?.sync(k);
    this.smoke?.sync(k);
    this.sparks?.sync(k);
    if (this.phase === 'countdown') {
      this.pulse *= Math.exp(-dt / 120);
      this.drawPads(dt);
    }
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      for (const s of this.slashers) {
        for (const o of s.objs) if (o.active) this.freeObj(o);
        if (s.c.current === 'throw' || s.c.current === 'dash') s.c.play('idle', { force: true });
      }
      this.padG.clear();
    }
    super.end();
    this.crowd?.cheer(true);
    punch(this, 0.015, 240);
  }

  // --- CPU -----------------------------------------------------------------------------------------
  /** A CPU plans each note once as it appears: when to slash (with its timing error), or to let it pass. */
  private planCpu(s: Slasher, n: Note): void {
    const sk = this.skill(s.p);
    const sigma = 18 + sk.aimNoise * 120;
    const err = (Math.random() + Math.random() + Math.random() - 1.5) * sigma * 1.4;
    if (n.kind === 'bomb') {
      // a nervous swing at a bomb now and then
      if (Math.random() < sk.mistake * 0.5) this.plan(s, n.lane, n.t + err * 0.5);
      return;
    }
    if (Math.random() < sk.mistake * 0.55) return;
    this.plan(s, n.lane, n.t + err);
  }

  private plan(s: Slasher, lane: number, at: number): void {
    s.planLane.push(lane);
    s.planAt.push(at);
  }

  protected cpuThink(p: MgPlayer, vc: VirtualControls): void {
    let s: Slasher | undefined;
    for (const q of this.slashers) if (q.p === p) s = q;
    if (!s || s.stunT > 0) return;
    for (let i = s.planAt.length - 1; i >= 0; i--) {
      const at = s.planAt[i];
      if (this.elapsed < at) continue;
      const lane = s.planLane[i];
      // swap-remove
      s.planAt[i] = s.planAt[s.planAt.length - 1];
      s.planLane[i] = s.planLane[s.planLane.length - 1];
      s.planAt.pop();
      s.planLane.pop();
      if (this.elapsed - at > 200) continue;
      vc.tap(PAD_KEYS[lane]);
    }
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} pts` }));
  }
}

