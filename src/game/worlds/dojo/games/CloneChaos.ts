import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { CSS, GAME_WIDTH, PLAYER_COLORS } from '../../../constants';
import { CHARACTER_ANIMATIONS } from '../../../characters/CharacterAnimations';
import type { CharacterId } from '../../../data/characters';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { banner, popToHud, punch, shockwave, titleTexture } from '../../../minigames/juice';
import { bakeWord, calmMotion, liteCount, WordPops } from '../../../minigames/games/stageKit';
import { LITE } from '../../../perf';
import { PlayerBadge } from '../../../ui/PlayerBadge';
import { addText } from '../../../ui/theme';
import { DOJO_SPRITES, finishDojoSprites, queueDojoSprites, type DojoSprite } from '../dojoArt';
import { DECK_FEET, DECK_SCALE, DECK_XS, SPOTS, START_SPOT, spotDist } from './cloneChaosLayout';
import { applyStep, initialOccupancy, leapsOf, navFrom, navToward, pickPoints, planShuffle, ROUNDS, roundPlan, spotOf, trackStep, type Occupancy, type RoundPlan, type Step } from './cloneChaosRules';

const SPRITES: DojoSprite[] = ['puff'];
/** The ninja who clones himself (the guest this game celebrates). */
const NINJA: CharacterId = 'naruto';
/** Beat lengths (ms). */
const INTRO_MS = 800;
const REVEAL_MS = 950;
const CLONE_MS = 700;
const STEP_GAP = 90;
const RESULT_MS = 1750;
const TRICK_EXTRA = 160;
/** Depth bands. */
const D_CLONE = 0;
const D_AIR = 3000;
const D_SMOKE = 3500;
const D_DARK = 3600;
const D_MARK = 4000;
const D_PUFF = 4500;
const PLAQUE_Y = 150;
const POP_SIZE = 64;
const POP_COLOR = '#ffffff';

interface Clone {
  id: number;
  spot: number;
  c: Character;
  x: number;
  y: number;
  scale: number;
  leap: { from: number; to: number; t: number; dur: number; h: number; high: boolean } | null;
  shown: boolean;
}

interface Picker {
  p: MgPlayer;
  spot: number;
  locked: boolean;
  lockMs: number | null;
  /** The clone a CPU believes is the real one. */
  belief: number;
  marker: Phaser.GameObjects.Container;
  arrow: Phaser.GameObjects.Graphics;
  ring: Phaser.GameObjects.Graphics;
  /** Marker's drawn position (it glides between clones). */
  mx: number;
  my: number;
  points: number;
}

type Stage = 'intro' | 'reveal' | 'clone' | 'shuffle' | 'pick' | 'result' | 'done';

/**
 * Clone Chaos — the ninja hides among his smoke clones on the village rooftops. Watch the real one as
 * they leap and shuffle, then move your marker onto him and press A before the smoke clears: a right
 * pick scores 2, plus up to 3 more for speed. Five rounds, each with more clones, faster moves and more
 * tricks; the last counts double.
 */
export class CloneChaosScene extends BaseMinigame {
  private stage: Stage = 'intro';
  private stageT = 0;
  private round = 0;
  private plan!: RoundPlan;
  private occ: Occupancy = [];
  private steps: Step[] = [];
  private stepIdx = 0;
  private stepT = 0;
  private stepDur = 0;
  private stepApplied = true;
  /** How long this round's title holds before the ninja appears (the first waits for GO! to clear). */
  private introMs = INTRO_MS;
  private clones: Clone[] = [];
  private pickers: Picker[] = [];
  private puffs: Phaser.GameObjects.Image[] = [];
  private smoke: Phaser.GameObjects.Image[] = [];
  private dark!: Phaser.GameObjects.Rectangle;
  private haze!: Phaser.GameObjects.Graphics;
  private plaque!: Phaser.GameObjects.Container;
  private plaqueText!: Phaser.GameObjects.Text;
  private plaquePips!: Phaser.GameObjects.Graphics;
  private plaqueBar!: Phaser.GameObjects.Graphics;
  private realMark!: Phaser.GameObjects.Container;
  private pillar?: Phaser.GameObjects.Image;
  private words!: WordPops;
  private lastTick = 0;
  private wrapped = false;
  private clock = 0;

  constructor() {
    super('mg-clone-chaos');
  }

  preload(): void {
    queueDojoSprites(this, SPRITES);
  }

  protected createArena(): void {
    this.duration = 0;
    this.stage = 'intro';
    this.stageT = 0;
    this.round = 0;
    this.occ = [];
    this.steps = [];
    this.stepIdx = 0;
    this.clones = [];
    this.pickers = [];
    this.puffs = [];
    this.smoke = [];
    this.lastTick = 0;
    this.wrapped = false;
    this.clock = 0;
    finishDojoSprites(this, SPRITES);
    for (const n of [2, 3, 4, 5, 6, 8, 10]) titleTexture(this, `+${n}`, POP_SIZE, POP_COLOR);
    this.words = new WordPops(this, 5600, 16);
    bakeWord(this, 'cc-miss', 'MISS', { size: 50, fill: ['#e9edf5', '#9aa6ba'] });
    bakeWord(this, 'cc-locked', 'LOCKED!', { size: 40, fill: ['#ffffff', '#ffe08a'] });
    bakeWord(this, 'cc-real', 'THE REAL ONE!', { size: 52, fill: ['#fff9d6', '#ffcf3a'] });
    bakeWord(this, 'cc-dark', 'LIGHTS OUT!', { size: 60, fill: ['#e6ecff', '#9fb2ff'] });
    bakeWord(this, 'cc-smoke', 'SMOKE SCREEN!', { size: 60, fill: ['#ffffff', '#c7cfdf'] });
    if (this.textures.exists('rendered-scene-dojo_roofs')) this.add.image(0, 0, 'rendered-scene-dojo_roofs').setOrigin(0).setDepth(-100);
    else this.fallbackArena();
    this.dark = this.add.rectangle(GAME_WIDTH / 2, 540, GAME_WIDTH, 1080, 0x0b1030, 1).setAlpha(0).setDepth(D_DARK);
    this.haze = this.add.graphics().setDepth(D_SMOKE - 10);
    this.buildPlaque();
    this.realMark = this.buildRealMark();
    // the clones (created once, hidden until their round needs them)
    const anim = CHARACTER_ANIMATIONS[NINJA] ? NINJA : this.launch.players[0].characterId;
    for (let i = 0; i < 9; i++) {
      const c = new Character(this, -300, -300, anim, { scale: 0.6 });
      c.setVisible(false);
      c.shadow?.setAlpha(0.55);
      this.clones.push({ id: i, spot: -1, c, x: -300, y: -300, scale: 0.6, leap: null, shown: false });
    }
    for (let i = 0; i < (LITE ? 16 : 26); i++) this.puffs.push(this.add.image(0, 0, DOJO_SPRITES.puff.key).setVisible(false).setDepth(D_PUFF));
    for (let i = 0; i < 7; i++) this.smoke.push(this.add.image(0, 0, DOJO_SPRITES.puff.key).setVisible(false).setDepth(D_SMOKE));
  }

  /** Without the rendered village: a dusk sky, three rows of roofs and the deck, drawn plainly. */
  private fallbackArena(): void {
    const g = this.add.graphics().setDepth(-100);
    g.fillGradientStyle(0x3f72c8, 0x3f72c8, 0xffcf96, 0xffcf96, 1);
    g.fillRect(0, 0, GAME_WIDTH, 1080);
    for (const s of SPOTS) {
      const w = 230 + s.row * 35;
      g.fillStyle(s.row === 1 ? 0x9c4f3c : 0x4f6f8f, 1);
      g.fillTriangle(s.x - w / 2, s.y + 70, s.x + w / 2, s.y + 70, s.x, s.y);
      g.fillStyle(0xefe3cc, 1);
      g.fillRect(s.x - w * 0.4, s.y + 70, w * 0.8, 60);
    }
    g.fillStyle(0xa06c3e, 1);
    g.fillRect(0, 975, GAME_WIDTH, 105);
  }

  /** The round plaque under the HUD: ROUND n/5, a pip per round, and the pick timer bar. */
  private buildPlaque(): void {
    const c = this.add.container(GAME_WIDTH / 2, PLAQUE_Y).setDepth(8200).setScrollFactor(0);
    const g = this.add.graphics();
    g.fillStyle(0x0a1120, 0.3);
    g.fillRoundedRect(-172, -30, 344, 70, 30);
    g.fillStyle(0x121b2b, 0.85);
    g.fillRoundedRect(-170, -34, 340, 68, 28);
    g.lineStyle(2, 0xffffff, 0.12);
    g.strokeRoundedRect(-169, -33, 338, 66, 27);
    this.plaqueText = addText(this, -64, -2, 'ROUND 1/5', 30, { color: '#ffffff', weight: 700, fixed: true });
    this.plaquePips = this.add.graphics();
    this.plaqueBar = this.add.graphics();
    c.add([g, this.plaqueText, this.plaquePips, this.plaqueBar]);
    this.plaque = c;
  }

  private drawPlaque(pickFrac: number | null): void {
    const g = this.plaquePips;
    g.clear();
    for (let i = 0; i < ROUNDS; i++) {
      const x = 58 + i * 22;
      const done = i < this.round - 1;
      const cur = i === this.round - 1;
      g.fillStyle(cur ? 0xffe08a : done ? 0xffffff : 0xffffff, cur ? 1 : done ? 0.85 : 0.18);
      g.fillCircle(x, -2, cur ? 8 : 6);
    }
    const b = this.plaqueBar;
    b.clear();
    if (pickFrac === null) return;
    b.fillStyle(0x000000, 0.35);
    b.fillRoundedRect(-150, 22, 300, 8, 4);
    const col = pickFrac < 0.34 ? 0xff6b5e : 0xffe08a;
    b.fillStyle(col, 1);
    b.fillRoundedRect(-150, 22, Math.max(8, 300 * pickFrac), 8, 4);
  }

  /** The golden arrow and light that point out the real ninja. */
  private buildRealMark(): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    g.fillStyle(0x7a4600, 0.4);
    g.fillTriangle(-26, -30, 26, -30, 0, 8);
    g.fillStyle(0xffd23f, 1);
    g.fillTriangle(-24, -34, 24, -34, 0, 2);
    g.fillStyle(0xfff4b8, 1);
    g.fillTriangle(-14, -30, 6, -30, -4, -14);
    return this.add.container(0, 0, [g]).setDepth(D_MARK + 50).setVisible(false);
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const n = this.players.length;
    const xs = n === 4 ? DECK_XS : n === 3 ? [540, 960, 1380] : n === 2 ? [700, 1220] : [960];
    const x = xs[index] ?? DECK_XS[index % 4];
    const c = new Character(this, x, DECK_FEET, p.characterId, { scale: DECK_SCALE, slot: p.slot, marker: true });
    c.face(x > GAME_WIDTH / 2);
    c.setDepth(5000 + index);
    p.character = c;
    const arrow = this.add.graphics();
    const badge = new PlayerBadge(this, 0, -56, p.slot, 20);
    const marker = this.add.container(0, 0, [arrow, badge]).setDepth(D_MARK + index).setVisible(false);
    const ring = this.add.graphics().setDepth(D_MARK - 10 + index).setVisible(false);
    this.pickers.push({ p, spot: START_SPOT, locked: false, lockMs: null, belief: 0, marker, arrow, ring, mx: 0, my: 0, points: 0 });
  }

  protected override onStart(): void {
    this.startRound();
  }

  // --- Round flow ------------------------------------------------------------------------------
  private setStage(s: Stage): void {
    this.stage = s;
    this.stageT = 0;
  }

  private startRound(): void {
    this.round++;
    this.plan = roundPlan(this.round);
    this.occ = initialOccupancy(this.rng, this.plan.clones);
    this.steps = planShuffle(this.rng, this.plan, this.occ);
    this.stepIdx = 0;
    this.plaqueText.setText(`ROUND ${this.round}/${ROUNDS}`);
    this.drawPlaque(null);
    this.tweens.add({ targets: this.plaque, scale: { from: 1.25, to: 1 }, duration: 260, ease: 'Back.Out' });
    for (const pk of this.pickers) {
      pk.locked = false;
      pk.lockMs = null;
      pk.belief = 0;
      pk.marker.setVisible(false);
      pk.ring.setVisible(false);
    }
    const title = this.plan.double ? 'FINAL ROUND' : `ROUND ${this.round}`;
    const wait = this.round === 1 ? 620 : 0;
    this.introMs = INTRO_MS + wait;
    this.time.delayedCall(wait, () => {
      banner(this, title, { y: 520, size: 118, color: CSS.goldLight, hold: 700, ribbon: true, sub: this.plan.double ? 'DOUBLE POINTS!' : this.round === 1 ? 'FIND THE REAL ONE!' : undefined });
      audio.play('countHit', { rate: 0.9 + this.round * 0.05 });
    });
    this.setStage('intro');
  }

  /** The real ninja leaps onto his roof in a shaft of golden light. */
  private reveal(): void {
    const spot = spotOf(this.occ, 0);
    const cl = this.clones[0];
    this.placeClone(cl, spot);
    cl.shown = true;
    cl.c.setVisible(true).setAlpha(1);
    const s = SPOTS[spot];
    // he drops in from above
    cl.c.y = s.y - 420;
    cl.c.hold('jump', 2);
    this.tweens.add({
      targets: cl.c,
      y: s.y,
      duration: 360,
      ease: 'Quad.In',
      onComplete: () => {
        cl.c.squash(0.2, 180);
        cl.c.play('wave', { force: true });
        this.puffAt(s.x, s.y - 10, 0.5 * s.scale, 0);
        audio.play('land', { volume: 0.5 });
      },
    });
    if (this.textures.exists('fx-shaft')) {
      this.pillar = this.add.image(s.x, s.y + 10, 'fx-shaft').setOrigin(0.5, 1).setTint(0xffe27a).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(220 * s.scale, 640).setAlpha(0).setDepth(D_CLONE + s.y - 1);
      this.tweens.add({ targets: this.pillar, alpha: 0.75, duration: 300 });
    }
    this.realMark.setVisible(true).setPosition(s.x, s.y + cl.c.headY * s.scale - 40).setScale(0.3);
    this.tweens.add({ targets: this.realMark, scale: 1, duration: 260, delay: 300, ease: 'Back.Out' });
    this.tweens.add({ targets: this.realMark, y: this.realMark.y - 14, duration: 320, delay: 560, yoyo: true, repeat: 1, ease: 'Sine.InOut' });
    this.words.pop('cc-real', s.x, s.y + cl.c.headY * s.scale - 110, { hold: 750, rise: 10 });
    audio.play('relic', { volume: 0.6 });
    audio.play('whoosh', { volume: 0.5 });
  }

  /** Smoke puffs: the clones pop into existence on the other roofs. */
  private cloneUp(): void {
    this.realMark.setVisible(false);
    if (this.pillar) {
      const pl = this.pillar;
      this.tweens.add({ targets: pl, alpha: 0, duration: 260, onComplete: () => pl.destroy() });
      this.pillar = undefined;
    }
    this.clones[0].c.hold('cheer');
    const order = this.occ.map((c, spot) => ({ c, spot })).filter((o) => o.c > 0);
    order.sort((a, b) => spotDist(spotOf(this.occ, 0), a.spot) - spotDist(spotOf(this.occ, 0), b.spot));
    order.forEach((o, i) => {
      this.time.delayedCall(90 + i * 60, () => {
        const cl = this.clones[o.c];
        this.placeClone(cl, o.spot);
        cl.shown = true;
        cl.c.setVisible(true).setAlpha(1).setScale(cl.scale * 0.3);
        this.tweens.add({ targets: cl.c, scale: cl.scale, duration: 220, ease: 'Back.Out' });
        const s = SPOTS[o.spot];
        this.puffAt(s.x, s.y - 50 * s.scale, 0.9 * s.scale, 1);
        audio.play('pop', { volume: 0.55, rate: 0.8 + i * 0.07, throttleMs: 20 });
      });
    });
    audio.play('whoosh', { volume: 0.6, rate: 1.2 });
    punch(this, 0.015, 240);
  }

  private startShuffle(): void {
    for (const cl of this.clones) if (cl.shown) cl.c.play('idle', { force: true });
    this.stepIdx = 0;
    this.beginStep();
    this.setStage('shuffle');
  }

  private beginStep(): void {
    const s = this.steps[this.stepIdx];
    // CPUs watch the move (and may lose track of the real one)
    for (const pk of this.pickers) if (pk.p.isCpu) pk.belief = trackStep(pk.belief, this.occ, s, this.plan, this.skill(pk.p).mistake, Math.random);
    const leaps = leapsOf(this.occ, s);
    this.stepDur = this.plan.moveMs + (s.trick ? TRICK_EXTRA : 0);
    this.stepT = 0;
    this.stepApplied = false;
    leaps.forEach((l, i) => {
      const cl = this.clones[l.clone];
      if (!cl) return;
      const d = spotDist(l.from, l.to);
      // paths never coincide: in a swap one clone vaults high while the other scurries low
      const high = i % 2 === 0;
      const h = high ? 95 + d * 0.32 : 26 + d * 0.08;
      cl.leap = { from: l.from, to: l.to, t: 0, dur: this.stepDur, h, high };
      cl.c.face(SPOTS[l.to].x < SPOTS[l.from].x);
      cl.c.shadow?.setVisible(false);
    });
    audio.play('jump', { volume: 0.35, rate: 0.9 + Math.random() * 0.25, throttleMs: 40 });
    if (s.trick === 'smoke') this.smokeScreen(s);
    else if (s.trick === 'blackout') this.lightsOut();
    else if (s.trick === 'decoy' && s.decoy !== undefined) this.decoy(s.decoy);
  }

  private endStep(): void {
    const s = this.steps[this.stepIdx];
    this.stepApplied = true;
    applyStep(this.occ, s);
    for (const cl of this.clones) {
      if (!cl.leap) continue;
      cl.leap = null;
      cl.spot = spotOf(this.occ, cl.id);
      this.placeClone(cl, cl.spot);
      cl.c.shadow?.setVisible(true);
      cl.c.squash(0.16, 140);
      const sp = SPOTS[cl.spot];
      if (!calmMotion()) this.fx.vfx('dust', sp.x, sp.y, { scale: 0.22 * sp.scale, duration: 300, alpha: 0.6, depth: sp.y + 1 });
    }
    audio.play('land', { volume: 0.3, throttleMs: 40 });
    // everyone back in step, so no clone gives itself away by being out of time
    for (const cl of this.clones) if (cl.shown) cl.c.play('idle', { force: true });
  }

  private startPick(): void {
    this.setStage('pick');
    const taken = this.takenSpots();
    const start = taken.reduce((b, id) => (spotDist(id, START_SPOT) < spotDist(b, START_SPOT) ? id : b), taken[0]);
    this.pickers.forEach((pk) => {
      pk.spot = start;
      pk.locked = false;
      pk.lockMs = null;
      const s = SPOTS[start];
      pk.mx = s.x;
      pk.my = s.y;
      pk.marker.setVisible(true).setAlpha(1).setScale(0.3);
      this.tweens.add({ targets: pk.marker, scale: 1, duration: 220, ease: 'Back.Out' });
      pk.ring.setVisible(true).setAlpha(1);
      const b = pk.p.brain;
      b.timer = this.skill(pk.p).reaction * (1.8 + Math.random() * 1.0);
      b.n = 0;
    });
    banner(this, 'PICK THE REAL ONE!', { y: 965, size: 76, color: CSS.goldLight, hold: 650, ribbon: true });
    audio.play('finalCall', { volume: 0.5 });
    this.lastTick = Math.ceil(this.plan.pickMs / 1000);
  }

  private lockIn(pk: Picker, auto = false): void {
    if (pk.locked) return;
    pk.locked = true;
    pk.lockMs = auto ? null : this.stageT;
    const s = SPOTS[pk.spot];
    this.tweens.add({ targets: pk.marker, scale: { from: 1.35, to: 1 }, duration: 220, ease: 'Back.Out' });
    if (!auto) {
      audio.play('confirm', { volume: 0.6 });
      this.words.pop('cc-locked', pk.mx + this.markerOffset(pk), s.y + this.clones[0].c.headY * s.scale - 150, { scale: 0.8, hold: 400, rise: 18, owner: pk.p.slot });
      shockwave(this, pk.mx, s.y, { radius: 70 * s.scale, ratio: 0.35, color: PLAYER_COLORS[pk.p.slot], alpha: 0.9, duration: 300, depth: D_MARK - 20 });
      this.rumble(pk.p, 0.2, 0.3, 80);
    }
  }

  private resolveRound(): void {
    this.setStage('result');
    for (const pk of this.pickers) if (!pk.locked) this.lockIn(pk, true);
    this.words.clear();
    const real = spotOf(this.occ, 0);
    // the smoke clears: every clone vanishes in a ripple of puffs, leaving the real ninja
    const fakes = this.clones.filter((c) => c.shown && c.id !== 0);
    fakes.sort((a, b) => spotDist(real, b.spot) - spotDist(real, a.spot));
    fakes.forEach((cl, i) => {
      this.time.delayedCall(i * 75, () => {
        const s = SPOTS[cl.spot];
        this.puffAt(s.x, s.y - 50 * s.scale, 0.95 * s.scale, 2);
        cl.shown = false;
        cl.c.setVisible(false);
        audio.play('pop', { volume: 0.5, rate: 1 + i * 0.06, throttleMs: 20 });
      });
    });
    const at = fakes.length * 75 + 120;
    this.time.delayedCall(at, () => this.showReal(real));
  }

  private showReal(real: number): void {
    const s = SPOTS[real];
    const cl = this.clones[0];
    cl.c.play('victory', { force: true, returnTo: 'idle' });
    this.hitStop(60);
    shockwave(this, s.x, s.y - 60 * s.scale, { radius: 180 * s.scale, color: 0xffe27a, alpha: 0.9, duration: 420, depth: D_MARK - 30 });
    this.fx.sparks(s.x, s.y - 80 * s.scale, liteCount(20));
    this.realMark.setVisible(true).setPosition(s.x, s.y + cl.c.headY * s.scale - 40).setScale(0.3);
    this.tweens.add({ targets: this.realMark, scale: 1, duration: 240, ease: 'Back.Out' });
    audio.play('goldChip', { volume: 0.8 });
    let found = 0;
    this.pickers.forEach((pk) => {
      const correct = pk.spot === real;
      const pts = pickPoints(correct, pk.lockMs, this.plan.double);
      pk.points = pts;
      const c = pk.p.character;
      if (correct) {
        found++;
        pk.p.score += pts;
        this.holdHud(pk.p.slot, pts);
        const h = this.hudPoint(pk.p.slot);
        const x = pk.mx + this.markerOffset(pk) * 1.9;
        const y = s.y + cl.c.headY * s.scale - 120 - (found % 2) * 46;
        // one after another, so several right answers read as several pops
        this.time.delayedCall((found - 1) * 110, () =>
          popToHud(this, x, y, `+${pts}`, h.x, h.y, {
            color: POP_COLOR,
            size: POP_SIZE,
            onArrive: () => {
              this.releaseHud(pk.p.slot, pts);
              this.bumpHud(pk.p.slot);
            },
          }),
        );
        shockwave(this, x, s.y + cl.c.headY * s.scale - 40, { radius: 90, color: PLAYER_COLORS[pk.p.slot], alpha: 0.9, duration: 360, depth: D_MARK + 10 });
        c?.play('celebrate', { force: true });
        this.rumble(pk.p, 0.3, 0.4, 140);
      } else {
        this.tweens.add({ targets: pk.marker, alpha: 0.35, y: pk.marker.y + 30, duration: 320, ease: 'Quad.In' });
        const ps = SPOTS[pk.spot];
        this.words.pop('cc-miss', pk.mx + this.markerOffset(pk), ps.y - 120 * ps.scale, { scale: 0.75, hold: 600, rise: 12, owner: pk.p.slot });
        c?.play('disappointed', { force: true });
      }
    });
    const n = this.pickers.length;
    const line = found === 0 ? 'NOBODY FOUND HIM!' : found === n && n > 1 ? 'EVERYONE FOUND HIM!' : found === 1 && n > 1 ? '1 FOUND HIM!' : n === 1 ? 'FOUND HIM!' : `${found} FOUND HIM!`;
    this.time.delayedCall(260, () => banner(this, line, { y: 965, size: 72, color: found ? CSS.goldLight : '#dfe5ee', hold: 800, ribbon: true }));
    if (found) audio.play('cheer', { volume: 0.5 });
    else audio.play('defeat', { volume: 0.45 });
  }

  private clearRound(): void {
    const cl = this.clones[0];
    const s = SPOTS[cl.spot];
    if (cl.shown && s) this.puffAt(s.x, s.y - 50 * s.scale, 0.9 * s.scale, 0);
    for (const c of this.clones) {
      c.shown = false;
      c.leap = null;
      c.c.setVisible(false);
    }
    this.realMark.setVisible(false);
    for (const pk of this.pickers) {
      pk.marker.setVisible(false);
      pk.ring.setVisible(false);
    }
  }

  // --- Frame ------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.clock += dt;
    this.stageT += dt;
    switch (this.stage) {
      case 'intro':
        if (this.stageT >= this.introMs) {
          this.reveal();
          this.setStage('reveal');
        }
        break;
      case 'reveal':
        if (this.stageT >= REVEAL_MS) {
          this.cloneUp();
          this.setStage('clone');
        }
        break;
      case 'clone':
        if (this.stageT >= CLONE_MS + (this.plan.clones - 1) * 60) this.startShuffle();
        break;
      case 'shuffle':
        this.stepT += dt;
        this.updateLeaps(dt);
        if (this.stepT >= this.stepDur) {
          if (!this.stepApplied) this.endStep();
          if (this.stepT >= this.stepDur + STEP_GAP) {
            this.stepIdx++;
            if (this.stepIdx >= this.steps.length) this.startPick();
            else this.beginStep();
          }
        }
        break;
      case 'pick':
        this.updatePick();
        break;
      case 'result':
        if (this.stageT >= RESULT_MS) {
          this.clearRound();
          if (this.round >= ROUNDS) {
            this.setStage('done');
            this.time.delayedCall(250, () => this.end());
          } else this.startRound();
        }
        break;
      default:
        break;
    }
    this.syncMarkers(dt);
    this.drawHaze();
  }

  private updateLeaps(dt: number): void {
    for (const cl of this.clones) {
      const lp = cl.leap;
      if (!lp) continue;
      lp.t = Math.min(lp.dur, lp.t + dt);
      const u = lp.t / lp.dur;
      const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
      const a = SPOTS[lp.from];
      const b = SPOTS[lp.to];
      cl.x = a.x + (b.x - a.x) * e;
      cl.y = a.y + (b.y - a.y) * e - lp.h * 4 * u * (1 - u);
      cl.scale = a.scale + (b.scale - a.scale) * e;
      cl.c.setPosition(cl.x, cl.y).setScale(cl.scale).setDepth(D_AIR + (lp.high ? 2 : 1) + cl.y * 0.001);
      cl.c.hold('jump', u < 0.14 ? 0 : u < 0.5 ? 1 : u < 0.86 ? 2 : 3);
    }
  }

  private updatePick(): void {
    const left = this.plan.pickMs - this.stageT;
    this.drawPlaque(Math.max(0, left / this.plan.pickMs));
    const secs = Math.ceil(left / 1000);
    if (secs < this.lastTick && secs > 0) {
      this.lastTick = secs;
      audio.play('tick', { volume: secs <= 2 ? 0.5 : 0.3, rate: secs <= 2 ? 1.2 : 1 });
    }
    const taken = this.takenSpots();
    for (const pk of this.pickers) {
      if (pk.locked) continue;
      const d = pk.p.controls.nav();
      if (d) {
        const to = navFrom(pk.spot, d, taken);
        if (to !== pk.spot) {
          pk.spot = to;
          audio.play('menuMove', { volume: 0.4, throttleMs: 30 });
        }
      }
      if (pk.p.controls.pressed('A')) this.lockIn(pk);
    }
    if (left <= 0 || this.pickers.every((pk) => pk.locked)) {
      this.drawPlaque(null);
      this.resolveRound();
    }
  }

  private takenSpots(): number[] {
    const out: number[] = [];
    this.occ.forEach((c, id) => {
      if (c >= 0) out.push(id);
    });
    return out;
  }

  /** Markers sharing a clone stand side by side. */
  private markerOffset(pk: Picker): number {
    const same = this.pickers.filter((q) => q.spot === pk.spot && q.marker.visible);
    if (same.length < 2) return 0;
    const i = same.indexOf(pk);
    return (i - (same.length - 1) / 2) * 46;
  }

  private syncMarkers(dt: number): void {
    const k = 1 - Math.exp(-dt / 55);
    for (const pk of this.pickers) {
      if (!pk.marker.visible) continue;
      const s = SPOTS[pk.spot];
      pk.mx += (s.x - pk.mx) * k;
      pk.my += (s.y - pk.my) * k;
      const head = this.clones[0].c.headY * s.scale;
      const off = this.markerOffset(pk);
      const bob = pk.locked || this.stage !== 'pick' ? 0 : Math.sin(this.clock / 150 + pk.p.slot) * 6;
      if (this.stage === 'pick' || this.stage === 'result') pk.marker.setPosition(pk.mx + off, pk.my + head - 70 + bob);
      const g = pk.arrow;
      g.clear();
      const col = PLAYER_COLORS[pk.p.slot];
      g.fillStyle(0x0a1120, 0.35);
      g.fillTriangle(-18, -18, 18, -18, 0, 12);
      g.fillStyle(pk.locked ? 0xffffff : col, 1);
      g.fillTriangle(-17, -21, 17, -21, 0, 8);
      if (pk.locked) {
        g.fillStyle(col, 1);
        g.fillTriangle(-10, -17, 10, -17, 0, 0);
      }
      const r = pk.ring;
      r.clear();
      const rw = (64 + Math.abs(off) * 0.2) * s.scale * 1.6;
      r.lineStyle(pk.locked ? 7 : 4, col, pk.locked ? 1 : 0.85);
      r.strokeEllipse(pk.mx + off * 0.3, pk.my + 4, rw, rw * 0.34);
    }
  }

  /** The haze hanging over the village while picking: thins away as the time runs out. */
  private drawHaze(): void {
    const g = this.haze;
    g.clear();
    if (this.stage !== 'pick') return;
    const left = Math.max(0, 1 - this.stageT / this.plan.pickMs);
    g.fillStyle(0xffffff, 0.12 * left);
    g.fillRect(0, 880, GAME_WIDTH, 200);
    g.fillStyle(0xffffff, 0.08 * left);
    g.fillRect(0, 200, GAME_WIDTH, 680);
  }

  private placeClone(cl: Clone, spot: number): void {
    const s = SPOTS[spot];
    cl.spot = spot;
    cl.x = s.x;
    cl.y = s.y;
    cl.scale = s.scale;
    cl.c.setPosition(s.x, s.y).setScale(s.scale).setDepth(D_CLONE + s.y);
  }

  // --- Tricks -----------------------------------------------------------------------------------
  /** Smoke rolls across the rows the move crosses (you can still make out shapes through it). */
  private smokeScreen(s: Step): void {
    const ys = s.spots.map((id) => SPOTS[id].y);
    const top = Math.min(...ys) - 150;
    const bottom = Math.max(...ys) + 20;
    const fromLeft = Math.random() < 0.5;
    const dur = this.stepDur + 380;
    this.smoke.forEach((img, i) => {
      const y = top + ((i + 0.5) / this.smoke.length) * (bottom - top);
      const x0 = fromLeft ? -200 - i * 60 : GAME_WIDTH + 200 + i * 60;
      const x1 = fromLeft ? GAME_WIDTH * 0.62 + i * 70 : GAME_WIDTH * 0.38 - i * 70;
      img.setPosition(x0, y).setScale(1.6 + (i % 3) * 0.35).setAlpha(0).setVisible(true).setAngle(i * 40);
      this.tweens.killTweensOf(img);
      this.tweens.add({ targets: img, x: x1, angle: img.angle + 40, duration: dur, ease: 'Sine.InOut' });
      this.tweens.add({ targets: img, alpha: 0.6, duration: dur * 0.3, yoyo: true, hold: dur * 0.4, ease: 'Sine.InOut', onComplete: () => img.setVisible(false) });
    });
    this.words.pop('cc-smoke', GAME_WIDTH / 2, 965, { hold: 500, rise: 10 });
    audio.play('sweep', { volume: 0.4, rate: 0.8 });
  }

  /** The lanterns gutter out for a move: only the clones' shapes are left to follow. */
  private lightsOut(): void {
    const dur = this.stepDur;
    this.tweens.killTweensOf(this.dark);
    this.tweens.add({ targets: this.dark, alpha: 0.58, duration: 120, yoyo: true, hold: Math.max(0, dur - 200), ease: 'Quad.Out' });
    this.words.pop('cc-dark', GAME_WIDTH / 2, 965, { hold: 500, rise: 10 });
    audio.play('rumble', { volume: 0.3 });
  }

  /** A clone that isn't moving hams it up: a wave and a sparkle to draw the eye (it may or may not be him). */
  private decoy(spot: number): void {
    const id = this.occ[spot];
    const cl = this.clones[id];
    if (!cl) return;
    const s = SPOTS[spot];
    cl.c.play('wave', { force: true });
    this.fx.vfx('sparkle', s.x + 20, s.y - 150 * s.scale, { scale: 0.45, duration: 420, blend: 'add', depth: D_MARK - 5 });
    shockwave(this, s.x, s.y - 70 * s.scale, { radius: 90 * s.scale, color: 0xffe27a, alpha: 0.7, duration: 320, depth: D_MARK - 6 });
    audio.play('pop', { volume: 0.4, rate: 1.3 });
  }

  /** A cartoon puff of smoke (pooled): kind 0 small, 1 a clone appearing, 2 a clone vanishing. */
  private puffAt(x: number, y: number, scale: number, kind: number): void {
    const n = kind === 0 ? 2 : liteCount(4);
    for (let i = 0; i < n; i++) {
      const img = this.puffs.find((p) => !p.visible);
      if (!img) return;
      const a = (i / n) * Math.PI * 2 + Math.random();
      const r = 26 * scale;
      img.setPosition(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6).setScale(scale * 0.35).setAlpha(0.95).setAngle(Math.random() * 360).setVisible(true);
      this.tweens.killTweensOf(img);
      this.tweens.add({ targets: img, scale: scale * (0.95 + Math.random() * 0.3), x: img.x + Math.cos(a) * r * 1.5, y: img.y + Math.sin(a) * r - 16, angle: img.angle + 30, duration: 300, ease: 'Cubic.Out' });
      this.tweens.add({ targets: img, alpha: 0, delay: 180 + (kind === 2 ? 120 : 0), duration: 300, ease: 'Quad.In', onComplete: () => img.setVisible(false) });
    }
    if (kind === 2 && !LITE) this.fx.sparks(x, y, 6);
  }

  // --- Ending and CPUs --------------------------------------------------------------------------
  protected override ambient(dt: number): void {
    if (this.phase !== 'playing') {
      this.clock += dt;
      this.syncMarkers(dt);
    }
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      this.drawPlaque(null);
      this.haze.clear();
    }
    super.end();
  }

  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    if (this.stage !== 'pick') return;
    const pk = this.pickers.find((q) => q.p === p);
    if (!pk || pk.locked) return;
    const b = p.brain;
    b.timer -= dt;
    if (b.timer > 0) return;
    const sk = this.skill(p);
    const target = spotOf(this.occ, pk.belief);
    const dir = target >= 0 ? navToward(pk.spot, target, this.takenSpots()) : null;
    if (dir && (b.n ?? 0) < 10) {
      vc.navigate(dir);
      b.n = (b.n ?? 0) + 1;
      b.timer = sk.think * 0.55 * (0.8 + Math.random() * 0.5);
    } else {
      vc.tap('A');
      b.timer = 1e9;
    }
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} ${p.score === 1 ? 'point' : 'points'}` }));
  }
}
