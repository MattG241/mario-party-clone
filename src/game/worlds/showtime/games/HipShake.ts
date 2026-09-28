import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import type { AnimName } from '../../../characters/CharacterAnimations';
import { GAME_WIDTH, PLAYER_COLORS, PLAYER_SHAPES } from '../../../constants';
import { REALTIME_CLOCK } from '../../../debug/debug';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { bakeWord, calmMotion, liteCount, WordPops } from '../../../minigames/games/stageKit';
import { flashScreen, punch, shockwave } from '../../../minigames/juice';
import { glyphKindFor, makeGlyph, type GlyphKind } from '../../../ui/ControllerPrompt';
import { shapePoints } from '../../../ui/PlayerBadge';
import { BEAT_MS, buildChart, DanceCard, JUDGE, LATE_BIAS, type Move, type Note, type PressResult, sectionAt } from '../hipShakeRules';
import { beamTexture, DirReader, glowTexture, heartTexture, sparkleTexture, spread } from '../showtimeKit';

// --- Layout (front view). The rendered bandshell (scripts/art/worlds/showtime/mg_stage.py) matches these. ---
/** Dancers' feet: the checkerboard stage. */
const STAGE_Y = 820;
/** Centre of each lane's target (the player's shape) and where notes appear, under the lighting truss. */
const HIT_Y = 466;
const NOTE_Y0 = 162;
/** A note is on screen this long before it should be hit (it reaches the target on the beat). */
const LEAD_MS = 1200;
/** After its beat a note keeps falling this long (missed ones grey out and fade). */
const FALL_MS = 260;
const NOTE_SCALE = 0.8;
const LANE_W = 150;
/** Spacing between the dancers for 2, 3 and 4 players. */
const GAPS: readonly [number, number, number] = [640, 490, 420];
/** The front marquee arch (centre line of its bulbs), as rendered: a superellipse on row 885. */
const ARCH = { cx: 960, row: 885, a: 852, b: 822, n: 2.7, spacing: 46 };
/** Footlights along the front edge of the stage. */
const FOOT_Y = 872;
const FOOT_X0 = 190;
const FOOT_STEP = 77;
const FOOT_N = 21;
/** The crowd in front of the stage (silhouettes standing on the bottom edge). */
const CROWD_N = 22;
/** Call-outs go over the crowd, clear of the note lanes; the crowd's cheers pop up here too. */
const BANNER_Y = 968;
const CROWD_WORD_Y = 930;

// --- The band -------------------------------------------------------------------------------
/** Swung eighths: the off-beat lands this far through the beat. */
const SWING = 0.64;
/** A twelve-bar progression: chord roots in semitones. */
const PROG = [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7];
/** Walking boogie bass over eight swung eighths. */
const WALK = [0, 4, 7, 9, 10, 9, 7, 4];
const BASS_ROOT = 0.78;
const STAB_ROOT = 0.25;

/** Arrow and pose colours (the arrows' shape is the main cue; colour helps). */
const MOVE_COLORS: Record<Move, [string, string]> = {
  L: ['#ffd1ea', '#ff4fa3'],
  R: ['#fff0c2', '#ffae1f'],
  U: ['#e6dcff', '#9b6bff'],
  D: ['#d2f6ff', '#1fb8ff'],
  A: ['#fff7cf', '#f7b92b'],
};
const MOVE_PITCH: Record<Move, number> = { L: 1, R: 1.122, U: 1.335, D: 0.891, A: 1.5 };

const WORDS = {
  perfect: { key: 'hs-w-perfect', text: 'PERFECT', size: 42, fill: ['#fffbd0', '#ffbf2a'] as const },
  good: { key: 'hs-w-good', text: 'GOOD', size: 40, fill: ['#ffffff', '#aeefff'] as const },
  miss: { key: 'hs-w-miss', text: 'MISS', size: 36, fill: ['#eef0f4', '#9ba3b2'] as const },
  swoon: { key: 'hs-w-swoon', text: 'SWOON!', size: 58, fill: ['#ffe3f1', '#ff5fa8'] as const },
  x2: { key: 'hs-w-x2', text: 'x2', size: 40, fill: ['#fff4c8', '#ffb627'] as const },
  x3: { key: 'hs-w-x3', text: 'x3', size: 40, fill: ['#ffe3f1', '#ff6fb0'] as const },
  x4: { key: 'hs-w-x4', text: 'x4', size: 40, fill: ['#e7fbff', '#35d6ff'] as const },
  pose: { key: 'hs-w-pose', text: 'POSE!', size: 40, fill: ['#fffbd0', '#ffbf2a'] as const },
};

interface Pose {
  anim: AnimName;
  frame: number;
  lean: number;
  dx: number;
  dy: number;
  face?: 'left' | 'right';
}

/** Each move's pose (frames of the rendered hero sheets), with a lean and a little step. */
const POSES: Record<Exclude<Move, 'A'>, Pose> = {
  L: { anim: 'throw', frame: 1, lean: -9, dx: -16, dy: 0, face: 'left' },
  R: { anim: 'throw', frame: 1, lean: 9, dx: 16, dy: 0, face: 'right' },
  U: { anim: 'celebrate', frame: 1, lean: 0, dx: 0, dy: -14 },
  D: { anim: 'jump', frame: 0, lean: 0, dx: 0, dy: 10 },
};
/** The pose (A): a quick spin (front, side, back, side) into arms-up. */
const SPIN: { anim: AnimName; frame: number; flip: boolean }[] = [
  { anim: 'walk', frame: 0, flip: false },
  { anim: 'portal', frame: 1, flip: false },
  { anim: 'walk', frame: 0, flip: true },
];
const POSE_MS = 300;
const SPIN_MS = 230;

interface Dancer {
  p: MgPlayer;
  c: Character;
  x: number;
  card: DanceCard;
  dir: DirReader;
  kind: GlyphKind;
  /** Note sprites by chart index (only for notes on screen). */
  sprites: (Phaser.GameObjects.Image | undefined)[];
  beam: Phaser.GameObjects.Image;
  pool: Phaser.GameObjects.Image;
  target: Phaser.GameObjects.Image;
  targetGlow: Phaser.GameObjects.Image;
  badge: Phaser.GameObjects.Image;
  flare: number;
  targetKick: number;
  /** Current pose: which move, and game ms left of it. */
  pose: Move | null;
  poseT: number;
  stumbleT: number;
  /** Streak glow (after a swoon) fading out. */
  glow: number;
  shownMult: number;
  // CPU plan: the note it is going for, when it will press, and what.
  cpuFor: number;
  cpuAt: number;
  cpuMove: Move | null;
}

interface Fan {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  phase: number;
  cheerT: number;
  kind: number;
}

/** Roughly normal noise with unit spread. */
function gauss(): number {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.73;
}

/**
 * Hip-Shake Hustle — a rock'n'roll dance-off on a 1950s bandshell. Move prompts fall down each
 * dancer's spotlight in time with a procedural backing band; hit them on the beat for PERFECT or
 * GOOD, chain streaks for multipliers and the crowd swoons. Everybody dances the same routine; the
 * top score after 45 seconds wins.
 */
export class HipShakeScene extends BaseMinigame {
  private notes: Note[] = [];
  private dancers: Dancer[] = [];
  /** Band clock: real ms since GO (a hit-stop never shifts the beat). Negative before GO. */
  private beat = -1;
  private started = false;
  private bandStep = -1;
  private bandOn = false;
  /** Chart indices of the notes currently on screen: [lo, hi). */
  private lo = 0;
  private hi = 0;
  private encore = false;
  private free: Phaser.GameObjects.Image[] = [];
  private noteCount = 0;
  private bursts: Phaser.GameObjects.Image[] = [];
  private hearts: Phaser.GameObjects.Image[] = [];
  private bulbs: Phaser.GameObjects.Image[] = [];
  private foot: Phaser.GameObjects.Image[] = [];
  private fans: Fan[] = [];
  private pops!: WordPops;
  private missed: number[] = [];
  private chase = 0;
  private flashAll = 0;
  private visT = 0;
  private wash?: Phaser.GameObjects.Image;

  constructor() {
    super('mg-hip-shake');
  }

  // --- Setup -----------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = 45000;
    this.notes = buildChart(this.launch.seed);
    this.dancers = [];
    this.beat = -1;
    this.started = false;
    this.bandStep = -1;
    this.bandOn = false;
    this.lo = 0;
    this.hi = 0;
    this.encore = false;
    this.free = [];
    this.noteCount = 0;
    this.bursts = [];
    this.hearts = [];
    this.bulbs = [];
    this.foot = [];
    this.fans = [];
    this.missed = [];
    this.chase = 0;
    this.flashAll = 0;
    this.visT = 0;
    // The band is the music here.
    audio.stopMusic(0.4);
    for (const w of Object.values(WORDS)) bakeWord(this, w.key, w.text, { size: w.size, fill: w.fill });
    this.bakeArrows();
    beamTexture(this);
    glowTexture(this);
    heartTexture(this);
    sparkleTexture(this);

    const sky = ['rendered-sky-dusk', 'rendered-sky-sunset', 'rendered-sky-day'].find((k) => this.textures.exists(k));
    if (sky) this.add.image(GAME_WIDTH / 2, 470, sky).setDisplaySize(GAME_WIDTH * 1.04, 1170).setDepth(-100).setTint(0xd9c4ff);
    if (this.textures.exists('rendered-scene-showtime_stage')) this.add.image(0, 0, 'rendered-scene-showtime_stage').setOrigin(0).setDepth(-50);
    else this.drawFallbackStage();
    // A warm wash over the back of the stage that throbs with the kick drum.
    this.wash = this.add.image(960, 560, 'st-glow').setDisplaySize(1500, 700).setTint(0xff7ab8).setAlpha(0.12).setBlendMode(Phaser.BlendModes.ADD).setDepth(-40);
    this.buildBulbs();
    this.buildCrowd();
    this.pops = new WordPops(this, 8700, 18);
    // Pooled bursts (hit notes flying apart) and hearts (swoons).
    for (let i = 0; i < 12; i++) this.bursts.push(this.add.image(0, 0, 'hs-arrow-L').setVisible(false).setDepth(8420));
    for (let i = 0; i < liteCount(28); i++) this.hearts.push(this.add.image(0, 0, 'st-heart').setVisible(false).setDepth(8410));
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const xs = spread(this.players.length, GAPS);
    const x = xs[index];
    const color = PLAYER_COLORS[p.slot];
    const beam = this.add.image(x, NOTE_Y0 - 20, 'st-beam').setOrigin(0.5, 0).setDisplaySize(LANE_W * 1.5, STAGE_Y + 30 - NOTE_Y0).setTint(mixColor(0xfff2dc, color, 0.25)).setAlpha(0.2).setBlendMode(Phaser.BlendModes.ADD).setDepth(10);
    const pool = this.add.image(x, STAGE_Y + 6, 'st-glow').setDisplaySize(300, 70).setTint(color).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(STAGE_Y - 30);
    const targetGlow = this.add.image(x, HIT_Y, 'st-glow').setDisplaySize(190, 190).setTint(color).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(8390);
    const target = this.add.image(x, HIT_Y, this.bakeTarget(p.slot)).setDepth(8395);
    const badge = this.add.image(x + 74, HIT_Y + 34, WORDS.x2.key).setDepth(8396).setVisible(false);
    const c = new Character(this, x, STAGE_Y, p.characterId, { scale: 1, slot: p.slot });
    c.setDepth(STAGE_Y);
    p.character = c;
    // Everyone faces the crowd; the lanes above them light up in their colour.
    this.dancers.push({
      p,
      c,
      x,
      card: new DanceCard(this.notes),
      dir: new DirReader(),
      kind: glyphKindFor(p.slot),
      sprites: new Array(this.notes.length),
      beam,
      pool,
      target,
      targetGlow,
      badge,
      flare: 0,
      targetKick: 0,
      pose: null,
      poseT: 0,
      stumbleT: 0,
      glow: 0,
      shownMult: 1,
      cpuFor: -1,
      cpuAt: 0,
      cpuMove: null,
    });
    this.bakeStar(glyphKindFor(p.slot));
  }

  /** Call-outs go over the crowd, clear of the note lanes. */
  protected override bannerY(): number {
    return BANNER_Y;
  }

  protected override onStart(): void {
    this.started = true;
    this.beat = 0;
    this.bandStep = -1;
    this.bandOn = true;
    for (const d of this.dancers) d.c.play('idle');
  }

  /** The last ten seconds: the encore, worth double. */
  protected override onFinalStretch(): void {
    this.encore = true;
    this.showFinalStretch('ENCORE! DOUBLE POINTS');
    audio.play('crowdRoar', { volume: 0.7 });
    audio.play('cymbal', { volume: 0.4 });
    this.flashAll = 1;
    for (const f of this.fans) f.cheerT = 900;
    for (const d of this.dancers) d.flare = 1;
    if (!calmMotion()) this.fx.confetti(960, -20, liteCount(70));
  }

  // --- The band --------------------------------------------------------------------------------
  private stepTime(k: number): number {
    return (Math.floor(k / 2) + (k % 2 ? SWING : 0)) * BEAT_MS;
  }

  private runBand(): void {
    if (!this.bandOn) return;
    for (let guard = 0; guard < 8; guard++) {
      const k = this.bandStep + 1;
      if (this.stepTime(k) > this.beat) break;
      this.bandStep = k;
      this.playStep(k);
    }
  }

  /** One swung eighth of the backing band: drums, walking bass, piano stabs, crashes. */
  private playStep(k: number): void {
    const beat = Math.floor(k / 2);
    const off = k % 2 === 1;
    const inBar = beat % 4;
    const bar = Math.floor(beat / 4);
    const sec = sectionAt(beat);
    const busy = sec === 'hot' || sec === 'encore';
    const root = PROG[bar % 12];
    const semi = (n: number) => Math.pow(2, n / 12);
    if (!off) {
      if (inBar === 0 || inBar === 2) audio.play('land', { volume: 0.9 });
      if (inBar === 1 || inBar === 3) {
        audio.play('hit', { volume: busy ? 0.46 : 0.38 });
        if (this.encore) audio.play('stamp', { volume: 0.12 });
      }
      audio.play('tick', { rate: 1.9, volume: 0.14 });
      this.onBeat(beat, inBar);
      if ((beat === 0 || [24, 44, 68].includes(beat)) && this.phase === 'playing') audio.play('cymbal', { volume: 0.26 });
    } else {
      audio.play('tick', { rate: 2.2, volume: busy ? 0.22 : 0.17 });
      if (busy && inBar === 3) audio.play('land', { volume: 0.5 });
    }
    // Walking bass on every eighth (from the second bar in the warm-up, so it builds).
    if (beat >= 4 || !off) audio.play('step', { rate: BASS_ROOT * semi(root + WALK[inBar * 2 + (off ? 1 : 0)]), volume: 0.8 });
    // Piano stabs on the "and" of two and four once the groove is going.
    if (off && (inBar === 1 || inBar === 3) && beat >= 24) {
      for (const n of [0, 4, 7]) audio.play('warn', { rate: STAB_ROOT * semi(root + n + 12), volume: 0.85, throttleMs: 0 });
    }
    this.chase++;
  }

  /** Every beat: the targets and beams throb, the footlights flash on the downbeat, the crowd bobs. */
  private onBeat(beat: number, inBar: number): void {
    const accent = inBar === 0;
    for (const d of this.dancers) {
      d.targetKick = Math.max(d.targetKick, accent ? 1 : 0.6);
      d.flare = Math.max(d.flare, accent ? 0.35 : 0.2);
    }
    for (let i = 0; i < this.foot.length; i++) {
      const on = accent || (beat % 2 === 0 && i % 2 === 0);
      if (on) this.foot[i].setAlpha(accent ? 0.9 : 0.55);
    }
    if (this.wash) this.wash.setAlpha(accent ? 0.26 : 0.18);
  }

  // --- Frame -----------------------------------------------------------------------------------
  protected tick(_dt: number): void {
    for (const d of this.dancers) {
      const c = d.p.controls;
      const dir = d.dir.read(c, this.beat);
      if (dir) this.press(d, dir);
      if (c.pressed('A')) this.press(d, 'A');
      this.missed.length = 0;
      d.card.sweep(this.beat, this.missed);
      for (const i of this.missed) this.onMiss(d, i);
      d.p.score = d.card.score;
    }
  }

  private press(d: Dancer, move: Move): void {
    const r = d.card.press(move, this.beat, this.encore);
    if (r.kind === 'hit') this.onHit(d, r);
    else if (r.kind === 'bad' || r.kind === 'wrong') this.onFlub(d, r.index);
    else if (r.kind === 'whiff') this.onWhiff(d);
  }

  private onHit(d: Dancer, r: Extract<PressResult, { kind: 'hit' }>): void {
    const n = this.notes[r.index];
    const perfect = r.grade === 'perfect';
    const human = !d.p.isCpu;
    this.releaseNote(d, r.index, true);
    this.strikePose(d, n.move);
    d.flare = 1;
    d.targetKick = 1.3;
    d.targetGlow.setAlpha(perfect ? 0.95 : 0.6);
    this.pops.pop(perfect ? WORDS.perfect.key : WORDS.good.key, d.x, HIT_Y + 66, { rise: 20, hold: perfect ? 260 : 200, owner: d.p.slot });
    audio.play('pop', { rate: MOVE_PITCH[n.move] * (perfect ? 1 : 0.94), volume: perfect ? 0.45 : 0.3, throttleMs: 20 });
    if (n.move === 'A') {
      audio.play('streak', { rate: perfect ? 1 : 0.9, volume: 0.5, throttleMs: 60 });
      this.pops.pop(WORDS.pose.key, d.x, CROWD_WORD_Y, { rise: 40, hold: 380, owner: 20 + d.p.slot });
      shockwave(this, d.x, HIT_Y, { radius: 120, color: 0xffe08a, alpha: 0.9, duration: 360, depth: 8398 });
      this.fx.sparks(d.x, STAGE_Y - 150, liteCount(18));
      if (human && !calmMotion()) flashScreen(this, 0xfff4dc, 0.08, 140);
    }
    if (perfect) {
      this.fx.sparks(d.x, HIT_Y, liteCount(8));
      if (Math.random() < 0.5) this.floatHeart(d.x + (Math.random() - 0.5) * 80, STAGE_Y - 180, d.x + (Math.random() - 0.5) * 120, STAGE_Y - 340, 0xff6fb0, 0.5);
    }
    if (human) this.rumble(d.p, perfect ? 0.25 : 0.12, perfect ? 0.35 : 0.2, 50);
    if (r.swoon > 0) this.swoon(d, r.swoon);
  }

  /** Off the beat, or the wrong move: the note is lost and the dancer stumbles. */
  private onFlub(d: Dancer, index: number): void {
    this.greyNote(d, index);
    this.stumble(d);
  }

  private onMiss(d: Dancer, index: number): void {
    this.greyNote(d, index);
    this.stumble(d);
  }

  /** A press with nothing to hit breaks the streak (so mashing never pays), quietly. */
  private onWhiff(d: Dancer): void {
    d.c.squash(0.05, 90);
    if (!d.p.isCpu) audio.play('cancel', { volume: 0.12, throttleMs: 120 });
    this.syncBadge(d);
  }

  private stumble(d: Dancer): void {
    d.stumbleT = 260;
    d.pose = null;
    d.poseT = 0;
    d.c.hold('surprised', 1);
    this.pops.pop(WORDS.miss.key, d.x, HIT_Y + 66, { rise: 14, hold: 200, owner: d.p.slot });
    if (!d.p.isCpu) {
      audio.play('cancel', { volume: 0.22, throttleMs: 90 });
      this.rumble(d.p, 0.1, 0.25, 70);
    }
    this.syncBadge(d);
  }

  /** A streak milestone: the crowd swoons for this dancer (hearts, arms up, a sparkly sigh). */
  private swoon(d: Dancer, level: number): void {
    const word = level === 1 ? WORDS.x2 : level === 2 ? WORDS.x3 : level === 3 ? WORDS.x4 : WORDS.swoon;
    this.pops.pop(word.key, d.x, CROWD_WORD_Y, { rise: 60, hold: 620, owner: 20 + d.p.slot, tilt: -8, scale: 1.2 });
    if (level >= 3) this.pops.pop(WORDS.swoon.key, d.x + (d.x < 960 ? 150 : -150), CROWD_WORD_Y + 30, { rise: 40, hold: 620, owner: 40 + d.p.slot });
    d.glow = 1;
    audio.play('shield', { volume: 0.45, throttleMs: 150 });
    audio.play('cheer', { volume: 0.35, throttleMs: 400 });
    shockwave(this, d.x, STAGE_Y - 120, { radius: 200, ratio: 0.5, color: 0xff7ab8, alpha: 0.7, duration: 480, depth: STAGE_Y - 25 });
    const n = liteCount(level >= 3 ? 10 : 7);
    for (let i = 0; i < n; i++) {
      const sx = d.x + (Math.random() - 0.5) * 380;
      this.floatHeart(sx, 1040 + Math.random() * 30, d.x + (Math.random() - 0.5) * 160, STAGE_Y - 260 - Math.random() * 120, i % 3 === 0 ? 0xffffff : 0xff5fa8, 0.7 + Math.random() * 0.3, i * 45);
    }
    for (const f of this.fans) if (Math.abs(f.x - d.x) < 360) f.cheerT = 800 + Math.random() * 300;
    if (!d.p.isCpu) {
      punch(this, 0.02, 260);
      this.rumble(d.p, 0.35, 0.4, 120);
    }
    this.syncBadge(d);
  }

  private syncBadge(d: Dancer): void {
    const m = 1 + Math.min(3, Math.floor(d.card.streak / 8));
    if (m === d.shownMult) return;
    d.shownMult = m;
    if (m <= 1) {
      d.badge.setVisible(false);
      return;
    }
    d.badge.setTexture(m === 2 ? WORDS.x2.key : m === 3 ? WORDS.x3.key : WORDS.x4.key).setVisible(true).setScale(1.5);
    this.tweens.add({ targets: d.badge, scale: 1, duration: 220, ease: 'Back.Out' });
  }

  // --- Poses -----------------------------------------------------------------------------------
  private strikePose(d: Dancer, move: Move): void {
    d.pose = move;
    d.stumbleT = 0;
    d.poseT = move === 'A' ? SPIN_MS + POSE_MS + 120 : POSE_MS;
    if (move === 'A') {
      d.c.hold(SPIN[0].anim, SPIN[0].frame);
      return;
    }
    const pose = POSES[move];
    if (pose.face) d.c.face(pose.face === 'left');
    d.c.hold(pose.anim, pose.frame);
    d.c.squash(move === 'D' ? 0.14 : 0.08, 120);
  }

  /** Dancers groove between moves: bob on the beat, a hip sway, the pose's lean and step easing out. */
  private syncDancers(dt: number): void {
    const beatPhase = this.beat >= 0 ? (this.beat % BEAT_MS) / BEAT_MS : 0;
    const bob = 4 * beatPhase * (1 - beatPhase);
    for (const d of this.dancers) {
      let dx = 0;
      let dy = 0;
      let lean = 0;
      if (d.pose && d.poseT > 0) {
        d.poseT -= dt;
        if (d.pose === 'A') {
          const total = SPIN_MS + POSE_MS + 120;
          const el = total - d.poseT;
          if (el < SPIN_MS) {
            const step = Math.min(SPIN.length - 1, Math.floor((el / SPIN_MS) * SPIN.length));
            const s = SPIN[step];
            d.c.face(s.flip);
            d.c.hold(s.anim, s.frame);
          } else if (d.c.current !== 'victory') {
            d.c.face(false);
            d.c.hold('victory', 2);
            d.c.squash(0.12, 160);
          }
          dy = el < SPIN_MS ? -18 * Math.sin((el / SPIN_MS) * Math.PI) : 0;
        } else {
          const pose = POSES[d.pose];
          const k = Math.max(0, d.poseT / POSE_MS);
          const e = k * k * (3 - 2 * k);
          dx = pose.dx * e;
          dy = pose.dy * e;
          lean = pose.lean * e;
        }
        if (d.poseT <= 0) {
          d.pose = null;
          d.c.face(false);
          d.c.play('idle', { force: true });
        }
      } else if (d.stumbleT > 0) {
        d.stumbleT -= dt;
        dx = Math.sin(d.stumbleT / 18) * 6 * (d.stumbleT / 260);
        if (d.stumbleT <= 0) d.c.play('idle', { force: true });
      } else if (this.started && this.phase === 'playing') {
        // The groove: a little hip sway and a bounce on every beat.
        lean = Math.sin((this.beat / BEAT_MS) * Math.PI) * 3.5;
        dy = -bob * 7;
      }
      d.c.setPosition(d.x + dx, STAGE_Y + dy);
      d.c.sprite.setAngle(lean);
      // Lights.
      d.flare = Math.max(0, d.flare - dt / 420);
      d.targetKick = Math.max(0, d.targetKick - dt / 180);
      d.glow = Math.max(0, d.glow - dt / 1400);
      const gold = this.encore ? 1 : 0;
      d.beam.setAlpha(0.14 + 0.2 * d.flare + 0.12 * d.glow + 0.06 * gold);
      d.pool.setAlpha(0.28 + 0.3 * d.flare + 0.35 * d.glow);
      d.target.setScale(1 + 0.09 * d.targetKick);
      d.targetGlow.setAlpha(Math.max(0, d.targetGlow.alpha - dt / 260));
    }
  }

  // --- Notes -----------------------------------------------------------------------------------
  private noteY(n: Note): number {
    return HIT_Y - ((n.t - this.beat) / LEAD_MS) * (HIT_Y - NOTE_Y0);
  }

  /** Keep every lane's note sprites in step with the band clock (pooled, nothing allocated per frame). */
  private syncNotes(): void {
    const t = this.beat;
    if (!this.started) return;
    while (this.hi < this.notes.length && this.notes[this.hi].t - LEAD_MS <= t) this.hi++;
    while (this.lo < this.hi && this.notes[this.lo].t + FALL_MS < t) {
      for (const d of this.dancers) this.releaseNote(d, this.lo, false);
      this.lo++;
    }
    for (let i = this.lo; i < this.hi; i++) {
      const n = this.notes[i];
      const y = this.noteY(n);
      const fadeIn = Phaser.Math.Clamp((y - NOTE_Y0 + 6) / 46, 0, 1);
      for (const d of this.dancers) {
        const st = d.card.state[i];
        if (st === 1) continue;
        let img = d.sprites[i];
        if (!img) {
          img = this.takeNote(n.move === 'A' ? `hs-star-${d.kind}` : `hs-arrow-${n.move}`);
          if (!img) continue;
          d.sprites[i] = img;
        }
        const past = t > n.t ? (t - n.t) / FALL_MS : 0;
        const k = n.move === 'A' ? NOTE_SCALE * 1.12 : NOTE_SCALE;
        img.setPosition(d.x, y).setScale(k * (1 + (n.move === 'A' ? 0.06 * Math.sin(this.visT / 90) : 0)));
        if (st === 2) img.setAlpha(Math.max(0, 0.6 - past * 0.6) * fadeIn).setTint(0x8a8f9c);
        else img.setAlpha(fadeIn * (past > 0 ? Math.max(0, 1 - past) : 1)).clearTint();
      }
    }
  }

  private takeNote(key: string): Phaser.GameObjects.Image | undefined {
    let img = this.free.pop();
    if (!img) {
      // A lane shows at most a handful of notes at once; the pool never needs to grow past this.
      if (this.noteCount >= 64) return undefined;
      this.noteCount++;
      img = this.add.image(0, 0, key).setDepth(8400);
    }
    img.setTexture(key).setVisible(true).setActive(true).setAngle(0).clearTint().setAlpha(1);
    return img;
  }

  /** Put a note's sprite back in the pool; `burst` sends a copy flying apart from the target first. */
  private releaseNote(d: Dancer, i: number, burst: boolean): void {
    const img = d.sprites[i];
    if (!img) return;
    d.sprites[i] = undefined;
    if (burst) {
      const b = this.bursts.find((o) => !o.visible);
      if (b) {
        this.tweens.killTweensOf(b);
        b.setTexture(img.texture.key).setPosition(d.x, HIT_Y).setScale(img.scaleX).setAlpha(1).setVisible(true).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: b, scale: img.scaleX * 1.9, alpha: 0, duration: 220, ease: 'Cubic.Out', onComplete: () => b.setVisible(false) });
      }
    }
    img.setVisible(false).setActive(false);
    this.free.push(img);
  }

  private greyNote(d: Dancer, i: number): void {
    const img = d.sprites[i];
    if (img) img.setTint(0x8a8f9c);
  }

  // --- Hearts, bulbs and the crowd -----------------------------------------------------------
  private floatHeart(x0: number, y0: number, x1: number, y1: number, tint: number, scale: number, delay = 0): void {
    const h = this.hearts.find((o) => !o.visible);
    if (!h) return;
    this.tweens.killTweensOf(h);
    h.setPosition(x0, y0).setTint(tint).setScale(scale * 0.4).setAlpha(0).setVisible(true).setAngle((Math.random() - 0.5) * 30);
    const k = { u: 0 };
    const cx = (x0 + x1) / 2 + (Math.random() - 0.5) * 160;
    const cy = Math.min(y0, y1) - 80;
    this.tweens.add({
      targets: k,
      u: 1,
      delay,
      duration: 900,
      ease: 'Sine.Out',
      onStart: () => h.setAlpha(1),
      onUpdate: () => {
        const u = k.u;
        const a = (1 - u) * (1 - u);
        const b = 2 * u * (1 - u);
        const c = u * u;
        h.setPosition(a * x0 + b * cx + c * x1, a * y0 + b * cy + c * y1).setScale(scale * (0.4 + 0.6 * Math.min(1, u * 2)));
        if (u > 0.7) h.setAlpha((1 - u) / 0.3);
      },
      onComplete: () => h.setVisible(false),
    });
  }

  /** Glows over the arch's marquee bulbs (a chase runs along them) and over the footlights. */
  private buildBulbs(): void {
    const pts = archPoints(ARCH.cx, ARCH.row, ARCH.a, ARCH.b, ARCH.n, ARCH.spacing);
    for (const [x, y] of pts) {
      if (y > 1000) continue;
      this.bulbs.push(this.add.image(x, y, 'st-glow').setDisplaySize(34, 34).setTint(0xffe7a0).setBlendMode(Phaser.BlendModes.ADD).setVisible(false).setDepth(-30));
    }
    for (let i = 0; i < FOOT_N; i++) {
      this.foot.push(this.add.image(FOOT_X0 + i * FOOT_STEP, FOOT_Y, 'st-glow').setDisplaySize(90, 46).setTint(0xffc46b).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(STAGE_Y + 40));
    }
  }

  private syncBulbs(dt: number): void {
    this.flashAll = Math.max(0, this.flashAll - dt / 700);
    const n = this.bulbs.length;
    const all = this.flashAll > 0.5 && Math.floor(this.visT / 90) % 2 === 0;
    for (let i = 0; i < n; i++) {
      const lit = all || (i + this.chase) % 4 === 0 || (this.encore && (n - i + this.chase) % 4 === 0);
      this.bulbs[i].setVisible(this.started && lit);
    }
    for (const f of this.foot) f.setAlpha(Math.max(0, f.alpha - dt / 380));
  }

  /** The audience: silhouettes along the bottom edge, bobbing to the beat and swooning. */
  private buildCrowd(): void {
    const keys = [0, 1, 2, 3].map((k) => this.bakeFan(k));
    for (let i = 0; i < CROWD_N; i++) {
      const x = 20 + (i + 0.5) * ((GAME_WIDTH - 40) / CROWD_N) + ((i * 37) % 23) - 11;
      const y = 1082 + ((i * 13) % 3) * 12;
      const kind = (i * 7) % 3;
      const img = this.add.image(x, y, keys[kind]).setOrigin(0.5, 1).setScale(0.95 + ((i * 17) % 5) * 0.06).setDepth(9000 - 100 + (i % 2)).setFlipX(i % 2 === 1);
      this.fans.push({ img, x, y, phase: ((i * 53) % 7) / 7, cheerT: 0, kind });
    }
  }

  private syncCrowd(dt: number): void {
    const calm = calmMotion();
    const b = this.beat >= 0 ? this.beat : this.visT;
    for (const f of this.fans) {
      const ph = ((b / BEAT_MS + f.phase) % 1 + 1) % 1;
      const hop = calm ? 0 : 4 * ph * (1 - ph);
      f.cheerT = Math.max(0, f.cheerT - dt);
      const up = f.cheerT > 0;
      const key = up ? 'hs-fan-3' : `hs-fan-${f.kind}`;
      if (f.img.texture.key !== key) f.img.setTexture(key);
      f.img.y = f.y - hop * (up ? 16 : 7);
    }
  }

  protected override ambient(dt: number): void {
    // The band keeps real time (a hit-stop or pause never pulls it off the beat); once the round is
    // over it stops.
    const real = Math.min(this.game.loop.delta, REALTIME_CLOCK ? 120 : 50);
    this.visT += dt;
    if (this.started && this.phase === 'playing') {
      this.beat += real;
      this.runBand();
    }
    this.syncNotes();
    this.syncDancers(dt);
    this.syncBulbs(dt);
    this.syncCrowd(dt);
    if (this.wash) this.wash.setAlpha(Math.max(0.1, this.wash.alpha - dt / 900));
  }

  protected override end(): void {
    const first = this.bandOn;
    this.bandOn = false;
    if (first) {
      // The band's big finish, and everyone back to neutral for the finish poses.
      audio.play('cymbal', { volume: 0.45 });
      audio.play('land', { volume: 0.7 });
      for (const n of [0, 4, 7, 12]) audio.play('warn', { rate: STAB_ROOT * Math.pow(2, (n + 12) / 12), volume: 1.4, throttleMs: 0 });
      for (const d of this.dancers) {
        d.pose = null;
        d.poseT = 0;
        d.stumbleT = 0;
        d.c.face(false);
        d.c.sprite.setAngle(0);
        d.c.setPosition(d.x, STAGE_Y);
        d.c.play('idle', { force: true });
        d.badge.setVisible(false);
        for (let i = this.lo; i < this.hi; i++) this.releaseNote(d, i, false);
      }
      this.pops.clear();
      this.flashAll = 1;
      for (const f of this.fans) f.cheerT = 1600;
    }
    super.end();
  }

  // --- CPU -------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, _dt: number): void {
    const d = this.dancers.find((x) => x.p === p);
    if (!d || !this.started) return;
    const sk = this.skill(p);
    // The next open note it hasn't planned for yet.
    let i = d.cpuFor < 0 ? 0 : d.cpuFor;
    while (i < this.notes.length && (d.card.state[i] !== 0 || this.notes[i].t + LATE_BIAS + JUDGE.good < this.beat)) i++;
    if (i >= this.notes.length) return;
    if (i !== d.cpuFor) {
      d.cpuFor = i;
      const n = this.notes[i];
      // Timing spread by skill (hard mostly PERFECT, easy often GOOD or off), and an occasional
      // slip: a wrong step or a missed one.
      const sigma = 16 + sk.aimNoise * 150;
      d.cpuAt = n.t + LATE_BIAS + gauss() * sigma;
      const r = Math.random();
      if (r < sk.mistake * 0.4) d.cpuMove = wrongMove(n.move);
      else if (r < sk.mistake) d.cpuMove = null;
      else d.cpuMove = n.move;
    }
    if (d.cpuMove && this.beat >= d.cpuAt) {
      const m = d.cpuMove;
      d.cpuMove = null;
      vc.tap(m === 'A' ? 'A' : m === 'L' ? 'LEFT' : m === 'R' ? 'RIGHT' : m === 'U' ? 'UP' : 'DOWN');
    }
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.dancers.map((d) => ({ slot: d.p.slot, score: d.card.score, label: `${d.card.score} pts · best streak ${d.card.best}` }));
  }

  // --- Baked art -------------------------------------------------------------------------------
  /** Chunky arrows (one per direction) and the pose star, drawn once into textures. */
  private bakeArrows(): void {
    const S = 96;
    for (const m of ['L', 'R', 'U', 'D'] as const) {
      const key = `hs-arrow-${m}`;
      if (this.textures.exists(key)) continue;
      const tex = this.textures.createCanvas(key, S, S);
      if (!tex) continue;
      const ctx = tex.getContext();
      ctx.translate(S / 2, S / 2);
      ctx.rotate(m === 'U' ? 0 : m === 'R' ? Math.PI / 2 : m === 'D' ? Math.PI : -Math.PI / 2);
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(0, -38);
        ctx.lineTo(34, -2);
        ctx.lineTo(14, -2);
        ctx.lineTo(14, 34);
        ctx.lineTo(-14, 34);
        ctx.lineTo(-14, -2);
        ctx.lineTo(-34, -2);
        ctx.closePath();
      };
      ctx.lineJoin = 'round';
      path();
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#1b1430';
      ctx.stroke();
      const [c0, c1] = MOVE_COLORS[m];
      const g = ctx.createLinearGradient(0, -38, 0, 34);
      g.addColorStop(0, c0);
      g.addColorStop(0.55, c1);
      g.addColorStop(1, shade(c1));
      path();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(-24, -5);
      ctx.lineTo(0, -29);
      ctx.stroke();
      tex.refresh();
    }
    const key = 'hs-star-base';
    if (!this.textures.exists(key)) {
      const tex = this.textures.createCanvas(key, 112, 112);
      if (tex) {
        const ctx = tex.getContext();
        const path = () => {
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + (i * Math.PI) / 5;
            const r = i % 2 === 0 ? 52 : 24;
            const x = 56 + Math.cos(a) * r;
            const y = 58 + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
        };
        ctx.lineJoin = 'round';
        path();
        ctx.lineWidth = 9;
        ctx.strokeStyle = '#1b1430';
        ctx.stroke();
        const g = ctx.createLinearGradient(0, 8, 0, 104);
        g.addColorStop(0, '#fff7cf');
        g.addColorStop(0.5, '#ffc93a');
        g.addColorStop(1, '#e08a12');
        path();
        ctx.fillStyle = g;
        ctx.fill();
        tex.refresh();
      }
    }
  }

  /** The pose star with the A button (in the player's controller glyphs) in its middle. */
  private bakeStar(kind: GlyphKind): void {
    const key = `hs-star-${kind}`;
    if (this.textures.exists(key)) return;
    const dt = this.textures.addDynamicTexture(key, 112, 112);
    if (!dt) return;
    const star = this.make.image({ key: 'hs-star-base' }, false);
    const glyph = makeGlyph(this, 'A', 40, kind);
    // Key caps can be wide ("Enter"): shrink the glyph to sit inside the star.
    const fit = Math.min(1, 50 / Math.max(1, glyph.width));
    glyph.setScale(fit);
    dt.draw(star, 56, 56);
    dt.draw(glyph, 56, 60);
    star.destroy();
    glyph.destroy();
  }

  /** A lane target: the player's shape as a thick ring in their colour (colour is never the only cue). */
  private bakeTarget(slot: number): string {
    const key = `hs-target-${slot}`;
    if (this.textures.exists(key)) return key;
    const S = 128;
    const dt = this.textures.addDynamicTexture(key, S, S);
    if (!dt) return key;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const shape = PLAYER_SHAPES[slot];
    const r = 44;
    const stroke = (w: number, color: number, alpha: number, rr: number) => {
      g.lineStyle(w, color, alpha);
      const pts = shapePoints(shape, 0, 0, rr);
      if (!pts) g.strokeCircle(0, 0, rr);
      else g.strokePoints(pts, true, true);
    };
    g.fillStyle(0x0c0818, 0.35);
    const pts = shapePoints(shape, 0, 0, r);
    if (!pts) g.fillCircle(0, 0, r);
    else g.fillPoints(pts, true);
    stroke(13, 0x0c0818, 0.55, r + 2);
    stroke(9, 0xffffff, 1, r);
    stroke(5, PLAYER_COLORS[slot], 1, r);
    dt.draw(g, S / 2, S / 2);
    g.destroy();
    return key;
  }

  /** Audience silhouettes: three head-and-shoulder shapes and one with both arms up. */
  private bakeFan(k: number): string {
    const key = `hs-fan-${k}`;
    if (this.textures.exists(key)) return key;
    const W = 150;
    const H = 190;
    const tex = this.textures.createCanvas(key, W, H);
    if (!tex) return key;
    const ctx = tex.getContext();
    const body = '#1a0f2e';
    const rim = 'rgba(255,140,200,0.55)';
    const draw = (stroke: boolean) => {
      ctx.beginPath();
      // shoulders
      ctx.moveTo(18, H);
      ctx.bezierCurveTo(18, 130, 40, 118, 75, 118);
      ctx.bezierCurveTo(110, 118, 132, 130, 132, H);
      ctx.closePath();
      // head
      ctx.moveTo(75 + 30, 88);
      ctx.arc(75, 88, 30, 0, Math.PI * 2);
      if (k === 0) {
        // a tall quiff
        ctx.moveTo(52, 70);
        ctx.bezierCurveTo(50, 40, 90, 34, 104, 56);
        ctx.bezierCurveTo(92, 52, 70, 54, 52, 70);
      } else if (k === 1) {
        // a high ponytail with a bow
        ctx.moveTo(96, 66);
        ctx.bezierCurveTo(124, 58, 128, 96, 112, 108);
        ctx.bezierCurveTo(118, 90, 110, 74, 96, 72);
        ctx.moveTo(98, 60);
        ctx.arc(94, 60, 9, 0, Math.PI * 2);
      } else if (k === 2) {
        // a bouffant
        ctx.moveTo(40, 86);
        ctx.arc(75, 74, 38, Math.PI, 0);
      } else {
        // both arms up
        ctx.moveTo(30, 132);
        ctx.bezierCurveTo(14, 100, 8, 60, 16, 30);
        ctx.lineTo(34, 30);
        ctx.bezierCurveTo(30, 62, 40, 100, 50, 122);
        ctx.moveTo(120, 132);
        ctx.bezierCurveTo(136, 100, 142, 60, 134, 30);
        ctx.lineTo(116, 30);
        ctx.bezierCurveTo(120, 62, 110, 100, 100, 122);
      }
      if (stroke) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = rim;
        ctx.stroke();
      } else {
        ctx.fillStyle = body;
        ctx.fill();
      }
    };
    draw(true);
    draw(false);
    tex.refresh();
    return key;
  }

  /** A simple painted stage when the rendered bandshell is missing. */
  private drawFallbackStage(): void {
    const g = this.add.graphics().setDepth(-50);
    g.fillGradientStyle(0x2a1648, 0x2a1648, 0x5b2a6e, 0x5b2a6e, 1);
    g.fillRect(0, 0, GAME_WIDTH, 700);
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2;
      const a1 = ((i + 0.5) / 24) * Math.PI * 2;
      g.fillStyle(i % 2 ? 0x1fa5a0 : 0xffe9cf, 0.35);
      g.fillTriangle(960, 470, 960 + Math.cos(a0) * 1400, 470 + Math.sin(a0) * 1400, 960 + Math.cos(a1) * 1400, 470 + Math.sin(a1) * 1400);
    }
    g.fillStyle(0x20182a, 1);
    g.fillRect(0, 640, GAME_WIDTH, 250);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 17; c++) {
        if ((r + c) % 2) continue;
        g.fillStyle(0xfff4e4, 1);
        g.fillRect(120 + c * 100, 645 + r * 30, 100, 30);
      }
    }
    g.fillStyle(0x7a1830, 1);
    g.fillRect(0, 885, GAME_WIDTH, 200);
    g.fillStyle(0xb0123a, 1);
    g.fillRect(0, 0, 200, 900);
    g.fillRect(GAME_WIDTH - 200, 0, 200, 900);
    g.fillRect(0, 0, GAME_WIDTH, 180);
  }
}

// --- Helpers ---------------------------------------------------------------------------------
function wrongMove(m: Move): Move {
  const opts: Move[] = m === 'A' ? ['L', 'R'] : m === 'L' ? ['R', 'U'] : m === 'R' ? ['L', 'D'] : m === 'U' ? ['D', 'L'] : ['U', 'R'];
  return opts[Math.floor(Math.random() * opts.length)];
}

function mixColor(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function shade(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const f = (s: number) => Math.round(((v >> s) & 255) * 0.62);
  return `rgb(${f(16)},${f(8)},${f(0)})`;
}

/** Evenly spaced points along the upper half of a superellipse arch (as in mg_kit.arch_points). */
function archPoints(cx: number, row: number, a: number, b: number, n: number, spacing: number): [number, number][] {
  const out: [number, number][] = [];
  let prevX = 0;
  let prevY = 0;
  let acc = 0;
  const steps = 2000;
  for (let i = 0; i <= steps; i++) {
    const t = (Math.PI * i) / steps;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = cx + a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = row - b * Math.pow(Math.abs(s), 2 / n);
    if (i === 0) out.push([x, y]);
    else {
      acc += Math.hypot(x - prevX, y - prevY);
      if (acc >= spacing) {
        out.push([x, y]);
        acc = 0;
      }
    }
    prevX = x;
    prevY = y;
  }
  return out;
}
