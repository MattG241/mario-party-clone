import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { CSS, GAME_WIDTH, PLAYER_COLORS, PLAYER_COLORS_CSS, PLAYER_SHAPES } from '../../../constants';
import { CHARACTERS } from '../../../data/characters';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../../data/npcs';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { burst, ensureArenaFxTextures, RingPool, Spray } from '../../../minigames/games/arenaFx';
import { bakeWord, WordPops } from '../../../minigames/games/stageKit';
import { banner, confettiBurst, kick, popToHud, punch, shockwave, titleTexture } from '../../../minigames/juice';
import { LITE } from '../../../perf';
import { settings } from '../../../save/SettingsManager';
import { drawPlayerShape } from '../../../ui/PlayerBadge';
import { standOrigin } from '../../../util/spriteUtil';
import { finishSprites, queueSprites, spriteKey } from '../rinkKit';
import { CROWD_SPOTS, drawFallbackRink, GOAL_ART, makeFallbackSprites, PUCK_ART, WORD_STYLES } from './slapshotArt';
import * as R from './slapshotRules';

const { COSB, SINB, RINK, GOAL, PUCK_R, SKATER_R } = R;

/** Rendered sprites (public/assets/rendered/mg/<name>.webp, from scripts/art/worlds/sports/mg_rink.py). */
const SPRITES = ['rink_puck', 'rink_goal_l', 'rink_goal_r', 'rink_goal_t', 'rink_goal_b'] as const;
const ARENA = 'rendered-scene-rink_arena';
const CHAR_SCALE = 0.6;
/** Skating: top speed (px/s), push acceleration (px/s²) and the glide's drag (1/s). */
const SKATE_MAX = 440;
const SKATE_ACCEL = 1150;
const GLIDE_DRAG = 0.85;
/** Body check: a short burst (ms, px/s), its cooldown, and how long a checked carrier is dazed. */
const CHECK_MS = 190;
const CHECK_SPEED = 780;
const CHECK_CD = 950;
const STUN_MS = 440;
/** Pucks faster than this bounce off a skater instead of sticking to their stick (a block). */
const CATCH_V = 950;
/** After shooting, the shooter can't collect their own shot for this long (ms). */
const SHOT_COOL = 260;
/** Where the carried puck sits: this far in front of the skater's centre. */
const STICK_REACH = SKATER_R + PUCK_R + 4;
const PICK_R = SKATER_R + PUCK_R + 14;
const SUB = 1 / 120;
const DEPTH = { crease: 4, shadow: 6, meter: 5200, word: 6400, lamp: 6500 };
const POP_SIZE = 60;
/** The puck drops from this height at a face-off (world px). */
const DROP_Z = 420;
const RESPAWN_MS = 1200;

type Mode = 'chase' | 'carry' | 'charge' | 'defend' | 'hunt' | 'idle';

interface Skater {
  p: MgPlayer;
  c: Character;
  i: number;
  goal: R.GoalGeom;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  carry: Puck | null;
  charging: boolean;
  charge: number;
  checkT: number;
  checkCd: number;
  stunT: number;
  swingT: number;
  sprayT: number;
  stick: Phaser.GameObjects.Graphics;
  meter: Phaser.GameObjects.Graphics;
  ai: { mode: Mode; t: number; tx: number; ty: number; aimX: number; aimY: number; chargeGoal: number; checkWish: boolean };
}

interface Puck {
  on: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  px: number;
  py: number;
  holder: Skater | null;
  last: Skater | null;
  cool: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Graphics;
  tx: number[];
  ty: number[];
  tn: number;
}

interface GoalView {
  g: R.GoalGeom;
  owner: Skater | null;
  crease: Phaser.GameObjects.Graphics;
  lamp: Phaser.GameObjects.Image;
  flash: Phaser.GameObjects.Graphics;
}

/**
 * Slapshot Showdown (Adam Sandler) — a four-sided ice rink on the Showtime Strip. Everyone guards
 * the goal on their side of the rink: skate into the puck to pick it up, hold A to wind up a
 * slapshot and let go to fire it at a rival's goal (+2); every goal you let in costs 1. Without the
 * puck, A is a body check that knocks it loose. A second puck drops in for the final ten seconds.
 */
export class SlapshotScene extends BaseMinigame {
  private skaters: Skater[] = [];
  private pucks: Puck[] = [];
  private goals: GoalView[] = [];
  private wrapped = false;
  private clock = 0;
  private words!: WordPops;
  private rings!: RingPool;
  private spray!: Spray;
  private sparks!: Spray;
  private crowd: { spr: Phaser.GameObjects.Sprite; y: number }[] = [];
  private spots: Phaser.GameObjects.Image[] = [];
  private tmp: R.Vec = { x: 0, y: 0 };
  private aim: R.Vec = { x: 1, y: 0 };
  /** The goals' geometry alone (for the aim assist). */
  private goalGeoms: R.GoalGeom[] = [];

  constructor() {
    super('mg-slapshot');
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
    this.skaters = [];
    this.pucks = [];
    this.goals = [];
    this.goalGeoms = [];
    this.wrapped = false;
    this.clock = 0;
    this.crowd = [];
    this.spots = [];
    ensureArenaFxTextures(this);
    this.rings = new RingPool(this, 12);
    this.spray = new Spray(this, 'fx-dot', { depth: DEPTH.word - 30, reserve: burst(90), lifespan: [260, 520], gravity: 300, scale: { start: 0.7, end: 0.1 }, alpha: { start: 0.95, end: 0 }, tint: [0xffffff, 0xe6f6ff, 0xcfeaff] });
    this.sparks = new Spray(this, 'fx-dot', { depth: DEPTH.word - 20, reserve: burst(70), lifespan: [320, 640], gravity: 380, scale: { start: 0.8, end: 0 }, alpha: { start: 1, end: 0 }, tint: [0xffffff, 0xffe08a, 0xff8ad8], add: true });
    this.words = new WordPops(this, DEPTH.word, 14);
    for (const [key, text, fill] of WORD_STYLES) bakeWord(this, key, text, { size: 52, fill });
    for (const slot of this.players.map((p) => p.slot)) titleTexture(this, '+2', POP_SIZE, PLAYER_COLORS_CSS[slot]);

    if (this.textures.exists(ARENA)) this.add.image(0, 0, ARENA).setOrigin(0).setDepth(-50);
    else drawFallbackRink(this);
    this.buildCrowd();
    this.buildSpotlights();
    for (let i = 0; i < 2; i++) this.pucks.push(this.makePuck());
  }

  private makePuck(): Puck {
    return {
      on: false,
      x: RINK.cx,
      y: RINK.cy,
      vx: 0,
      vy: 0,
      z: 0,
      vz: 0,
      px: RINK.cx,
      py: RINK.cy,
      holder: null,
      last: null,
      cool: 0,
      img: this.add.image(0, 0, spriteKey('rink_puck')).setScale((2 * PUCK_R) / PUCK_ART).setVisible(false),
      shadow: this.add.image(0, 0, 'fx-contact').setAlpha(0.55).setVisible(false),
      trail: this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.shadow + 1),
      tx: [0, 0, 0, 0, 0, 0, 0, 0],
      ty: [0, 0, 0, 0, 0, 0, 0, 0],
      tn: 0,
    };
  }

  /** Showtime crowd in the stands either side of the rink. */
  private buildCrowd(): void {
    if (!this.textures.exists(NPC_ATLAS)) return;
    const folk: [NpcId, string][] = [
      ['ora', 'cheer'],
      ['pipper', 'happy'],
      ['mimi', 'laugh'],
      ['packsprout', 'cheer'],
      ['wrench', 'laugh'],
      ['mimi', 'happy'],
      ['ora', 'wave'],
      ['packsprout', 'star'],
    ];
    CROWD_SPOTS.forEach(([x, y, k], i) => {
      const [id, pose] = folk[i % folk.length];
      const frame = npcFrame(id, pose);
      const spr = this.add.sprite(x, y, NPC_ATLAS, frame);
      const o = standOrigin(NPC_ATLAS, frame);
      spr.setOrigin(o.x, o.y).setScale(k).setDepth(y - 2000).setFlipX(x > GAME_WIDTH / 2);
      if (k < 0.3) spr.setTint(0xd6dcf0);
      this.tweens.add({ targets: spr, angle: { from: -3, to: 3 }, duration: 760 + (i % 4) * 120, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: (i * 83) % 500 });
      this.crowd.push({ spr, y });
    });
  }

  private cheer(loud: boolean): void {
    audio.play(loud ? 'crowdCheer' : 'cheer', { volume: loud ? 0.6 : 0.35, throttleMs: 300 });
    this.crowd.forEach(({ spr, y }, i) => {
      this.tweens.killTweensOf(spr);
      spr.setY(y);
      this.tweens.add({ targets: spr, y: y - (loud ? 16 : 9), duration: 130, yoyo: true, repeat: loud ? 2 : 1, delay: i * 18, ease: 'Quad.Out', onComplete: () => spr.setY(y) });
      this.tweens.add({ targets: spr, angle: { from: -3, to: 3 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: 450 + i * 18 });
    });
  }

  /** Two soft spotlights that drift over the ice (and swing to a goal when it's scored). */
  private buildSpotlights(): void {
    if (!this.textures.exists('fx-spot')) return;
    for (let i = 0; i < (LITE ? 1 : 2); i++) {
      const s = this.add.image(RINK.cx + (i ? 200 : -200), RINK.cy * COSB, 'fx-spot').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.16).setScale(3.2, 3.2 * COSB).setDepth(DEPTH.crease + 1).setTint(i ? 0xffc6ee : 0xc6e6ff);
      this.spots.push(s);
    }
  }

  private buildGoals(): void {
    const sides = R.goalSides(this.players.length);
    // With a single player every other side has a goal to aim at.
    const all: R.Side[] = this.players.length === 1 ? [R.LEFT, R.RIGHT, R.TOP, R.BOTTOM] : sides;
    for (const side of all) {
      const g = R.goalGeom(side);
      const owner = this.skaters.find((s) => s.goal.side === side) ?? null;
      const color = owner ? PLAYER_COLORS[owner.p.slot] : 0xffffff;
      // The crease: a half disc in front of the mouth, painted in the owner's colour.
      const crease = this.add.graphics().setDepth(DEPTH.crease);
      const pts: Phaser.Types.Math.Vector2Like[] = [];
      for (let k = 0; k <= 20; k++) {
        const a = -Math.PI / 2 + (k / 20) * Math.PI;
        const ix = -g.nx * Math.cos(a) * 92 + g.tx * Math.sin(a) * 92;
        const iy = -g.ny * Math.cos(a) * 92 + g.ty * Math.sin(a) * 92;
        pts.push({ x: g.mx + ix, y: (g.my + iy) * COSB });
      }
      crease.fillStyle(color, 0.34);
      crease.fillPoints(pts, true);
      crease.lineStyle(5, color, 0.95);
      crease.strokePoints(pts, false);
      if (owner) {
        const bx = g.mx - g.nx * 46;
        const by = (g.my - g.ny * 46) * COSB;
        drawPlayerShape(crease, PLAYER_SHAPES[owner.p.slot], bx, by, 20, color, 0xffffff, 4);
      }
      const flash = this.add.graphics().setDepth(DEPTH.crease + 0.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      flash.fillStyle(0xff5252, 0.9);
      flash.fillPoints(pts, true);
      const art = GOAL_ART[side];
      const sx = g.mx;
      const sy = g.my * COSB;
      const img = this.add.image(sx, sy, spriteKey(art.key)).setOrigin(art.ax / art.w, art.ay / art.h);
      img.setDepth(side === R.BOTTOM ? 5000 : side === R.TOP ? sy - 30 : sy + 20);
      // The goal lamp above the net: it blazes when a goal goes in.
      const lamp = this.add.image(sx + g.nx * 40, sy + g.ny * 40 * COSB - 86, 'fx-dot').setTint(0xff4040).setScale(1.2).setAlpha(0.35).setDepth(DEPTH.lamp).setBlendMode(Phaser.BlendModes.ADD);
      this.goals.push({ g, owner, crease, lamp, flash });
      this.goalGeoms.push(g);
    }
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const side = R.goalSides(this.players.length)[index] ?? R.BOTTOM;
    const goal = R.goalGeom(side);
    const x = goal.mx - goal.nx * 170;
    const y = goal.my - goal.ny * 170;
    const c = new Character(this, x, y * COSB, p.characterId, { scale: CHAR_SCALE, slot: p.slot, marker: true });
    c.face(goal.nx > 0 || (goal.nx === 0 && x > RINK.cx));
    p.character = c;
    this.skaters.push({
      p,
      c,
      i: index,
      goal,
      x,
      y,
      vx: 0,
      vy: 0,
      fx: -goal.nx || (x > RINK.cx ? -1 : 1) * 0.001,
      fy: -goal.ny,
      carry: null,
      charging: false,
      charge: 0,
      checkT: 0,
      checkCd: 0,
      stunT: 0,
      swingT: 0,
      sprayT: 0,
      stick: this.add.graphics(),
      meter: this.add.graphics().setDepth(DEPTH.meter),
      ai: { mode: 'idle', t: 300 + index * 90, tx: x, ty: y, aimX: RINK.cx, aimY: RINK.cy, chargeGoal: 0.6, checkWish: false },
    });
    normalizeFacing(this.skaters[this.skaters.length - 1]);
    if (index === this.players.length - 1) this.buildGoals();
  }

  protected override onStart(): void {
    this.faceOff(this.pucks[0], 0);
    this.cheer(false);
  }

  /** Call-outs go up over the far stands. */
  protected override bannerY(): number {
    return 180;
  }

  /** The last ten seconds: a second puck drops in at centre ice. */
  protected override onFinalStretch(): void {
    this.showFinalStretch('SECOND PUCK!');
    const spare = this.pucks.find((q) => !q.on);
    if (spare) this.faceOff(spare, 350);
    this.cheer(true);
  }

  // --- Pucks -------------------------------------------------------------------------------------
  /** Drop a puck at centre ice from above (after `delay` ms). */
  private faceOff(pk: Puck, delay: number): void {
    pk.on = true;
    pk.holder = null;
    pk.last = null;
    pk.x = RINK.cx + (this.rng.next() - 0.5) * 30;
    pk.y = RINK.cy + (this.rng.next() - 0.5) * 30;
    pk.px = pk.x;
    pk.py = pk.y;
    pk.vx = 0;
    pk.vy = 0;
    pk.z = DROP_Z + delay * 0.6;
    pk.vz = 0;
    pk.cool = 0;
    pk.tn = 0;
    pk.img.setVisible(true).setAlpha(1);
    pk.shadow.setVisible(true);
    audio.play('whoosh', { volume: 0.3, rate: 0.7 });
  }

  /**
   * Where a shot would go: the stick's direction (or the facing), nudged towards a rival goal's
   * mouth when it's within a few degrees of one (the same gentle assist for everyone, so an
   * eight-way keyboard can still pick a corner). Written into this.aim.
   */
  private aimOf(s: Skater, pk: Puck): R.Vec {
    const c = s.p.controls;
    let ax = c.moveX;
    let ay = c.moveY / COSB;
    const am = Math.hypot(ax, ay);
    if (am < 0.3) {
      ax = s.fx;
      ay = s.fy;
    } else {
      ax /= am;
      ay /= am;
    }
    this.aim.x = ax;
    this.aim.y = ay;
    return R.assistAim(this.aim, pk.x, pk.y, this.goalGeoms, s.goal.side, this.aim);
  }

  private shoot(s: Skater): void {
    const pk = s.carry;
    s.charging = false;
    if (!pk) return;
    const aim = this.aimOf(s, pk);
    const ax = aim.x;
    const ay = aim.y;
    const v = R.shotSpeed(s.charge);
    pk.holder = null;
    pk.last = s;
    pk.cool = SHOT_COOL;
    pk.vx = ax * v + s.vx * 0.3;
    pk.vy = ay * v + s.vy * 0.3;
    s.carry = null;
    s.fx = ax;
    s.fy = ay;
    s.swingT = 170;
    s.c.play('throw', { force: true, returnTo: 'idle' });
    const big = s.charge > 0.7;
    audio.play('hit', { volume: 0.4 + 0.4 * s.charge, rate: big ? 0.8 : 1.3 });
    audio.play('whoosh', { volume: 0.3 + 0.4 * s.charge, rate: 1.4 - 0.4 * s.charge });
    const sx = pk.x;
    const sy = pk.y * COSB;
    this.spray.fire(sx, sy, burst(big ? 10 : 5), (Math.atan2(-ay * COSB, -ax) * 180) / Math.PI, 40, 120, 260);
    if (big) {
      this.words.pop('rink-slap', sx, sy - 70, { owner: s.p.slot, scale: 0.8 });
      this.fx.vfx('impact', sx, sy - 10, { scale: 0.35, duration: 220, blend: 'add' });
      this.rumble(s.p, 0.4, 0.4, 110);
    }
    s.charge = 0;
  }

  private pickUp(s: Skater, pk: Puck): void {
    pk.holder = s;
    pk.last = s;
    pk.vx = 0;
    pk.vy = 0;
    s.carry = pk;
    audio.play('pop', { volume: 0.3, rate: 0.9, throttleMs: 60 });
    this.rumble(s.p, 0.1, 0.2, 40);
  }

  /** Knock a carried puck loose (a check, or a hard bump). */
  private knockLoose(s: Skater, dirX: number, dirY: number, speed: number): void {
    const pk = s.carry;
    if (!pk) return;
    s.carry = null;
    s.charging = false;
    s.charge = 0;
    pk.holder = null;
    pk.cool = 0;
    pk.vx = dirX * speed + s.vx * 0.4;
    pk.vy = dirY * speed + s.vy * 0.4;
  }

  private goalScored(pk: Puck, gv: GoalView): void {
    const shooter = pk.last;
    const owner = gv.owner;
    const scores = this.players.map((p) => p.score);
    const si = shooter ? this.players.indexOf(shooter.p) : -1;
    const oi = owner ? this.players.indexOf(owner.p) : -1;
    const before = scores.slice();
    R.scoreGoal(scores, si, oi);
    this.players.forEach((p, i) => (p.score = scores[i]));
    const g = gv.g;
    const sx = g.mx;
    const sy = g.my * COSB;
    // The puck goes into the net and away.
    pk.on = false;
    pk.holder = null;
    pk.img.setVisible(false);
    pk.shadow.setVisible(false);
    pk.trail.clear();
    // Lamp, horn, net and crowd.
    this.tweens.killTweensOf(gv.lamp);
    gv.lamp.setAlpha(1).setScale(2.4);
    this.tweens.add({ targets: gv.lamp, alpha: { from: 1, to: 0.35 }, scale: 1.2, duration: 220, yoyo: true, repeat: 3 });
    this.tweens.killTweensOf(gv.flash);
    gv.flash.setAlpha(0.8);
    this.tweens.add({ targets: gv.flash, alpha: 0, duration: 700, ease: 'Quad.Out' });
    audio.play('alarm', { volume: 0.55, rate: 0.75 });
    audio.play('crowdRoar', { volume: 0.7 });
    shockwave(this, sx, sy, { radius: 220, ratio: COSB, color: 0xffe08a, alpha: 0.9, duration: 480, depth: DEPTH.word - 5 });
    this.sparks.fire(sx, sy - 20, burst(24), -90, 80, 180, 480);
    this.hitStop(90);
    kick(this, g.nx * 14, g.ny * 14 * COSB, 180);
    punch(this, 0.02, 280);
    this.cheer(true);
    for (const s of this.spots) this.tweens.add({ targets: s, x: sx, y: sy, duration: 380, ease: 'Cubic.Out' });
    if (shooter && si !== oi) {
      const slot = shooter.p.slot;
      const name = CHARACTERS[shooter.p.characterId].name.split(' ')[0].toUpperCase();
      banner(this, 'GOAL!', { y: this.bannerY(), size: 110, color: PLAYER_COLORS_CSS[slot], hold: 800, ribbon: true, sub: `${name} SCORES!` });
      confettiBurst(this, sx, sy - 60, [PLAYER_COLORS[slot], PLAYER_COLORS[slot], 0xffffff, 0xffe08a], 50);
      shooter.c.play('celebrate', { force: true, returnTo: 'idle' });
      this.rumble(shooter.p, 0.5, 0.5, 200);
      const pts = scores[si] - before[si];
      this.holdHud(slot, pts);
      const h = this.hudPoint(slot);
      popToHud(this, sx - g.nx * 60, sy - 60, `+${pts}`, h.x, h.y, {
        color: PLAYER_COLORS_CSS[slot],
        size: POP_SIZE,
        onArrive: () => {
          this.releaseHud(slot, pts);
          this.bumpHud(slot);
        },
      });
      if (this.duration - this.elapsed < 3000) this.slowMo(0.4, 380);
    } else {
      banner(this, 'OWN GOAL!', { y: this.bannerY(), size: 96, color: CSS.goldLight, hold: 700, ribbon: true });
    }
    if (owner && oi >= 0 && before[oi] > scores[oi]) {
      this.fx.floatText(sx - g.nx * 30, sy - 110, `-${before[oi] - scores[oi]}`, '#ff8a7a', { size: 54, rise: 70, duration: 900, stroke: '#3a0e0a' });
      owner.c.play('disappointed', { force: true, returnTo: 'idle' });
      this.bumpHud(owner.p.slot);
      this.rumble(owner.p, 0.6, 0.4, 220);
    }
    this.time.delayedCall(RESPAWN_MS, () => {
      if (this.phase === 'playing') this.faceOff(pk, 0);
    });
  }

  // --- Frame -------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.clock += dt;
    for (const s of this.skaters) this.control(s, dt);
    const n = Math.max(1, Math.ceil(dt / 1000 / SUB));
    const sub = dt / 1000 / n;
    for (let k = 0; k < n; k++) this.stepPhysics(sub);
    this.syncVisuals(dt);
  }

  /** Buttons and timers (once a frame). */
  private control(s: Skater, dt: number): void {
    const c = s.p.controls;
    s.checkCd = Math.max(0, s.checkCd - dt);
    s.swingT = Math.max(0, s.swingT - dt);
    if (s.stunT > 0) {
      s.stunT -= dt;
      s.charging = false;
      return;
    }
    if (s.checkT > 0) s.checkT -= dt;
    if (s.charging) {
      if (!s.carry) s.charging = false;
      else {
        s.charge = Math.min(1, s.charge + dt / R.WINDUP_MS);
        if (!c.held('A')) this.shoot(s);
      }
      return;
    }
    if (c.pressed('A')) {
      if (s.carry) {
        s.charging = true;
        s.charge = 0;
        s.c.hold('crouch');
        audio.play('dialTick', { volume: 0.3, rate: 0.8 });
      } else if (s.checkCd <= 0) this.startCheck(s);
    }
  }

  private startCheck(s: Skater): void {
    const c = s.p.controls;
    let dx = c.moveX;
    let dy = c.moveY / COSB;
    const m = Math.hypot(dx, dy);
    if (m < 0.3) {
      dx = s.fx;
      dy = s.fy;
    } else {
      dx /= m;
      dy /= m;
    }
    s.fx = dx;
    s.fy = dy;
    s.vx = dx * CHECK_SPEED;
    s.vy = dy * CHECK_SPEED;
    s.checkT = CHECK_MS;
    s.checkCd = CHECK_CD;
    s.c.hold('dash');
    audio.play('whoosh', { volume: 0.5, rate: 1.1 });
    this.spray.fire(s.x, s.y * COSB, burst(6), (Math.atan2(-dy * COSB, -dx) * 180) / Math.PI, 35, 90, 200);
  }

  private stepPhysics(dt: number): void {
    // Skaters: push towards the stick's direction (icy: slow to turn), or glide.
    for (const s of this.skaters) {
      const c = s.p.controls;
      if (s.stunT > 0 || s.checkT > 0) {
        const d = Math.exp(-(s.stunT > 0 ? 2.2 : 0.6) * dt);
        s.vx *= d;
        s.vy *= d;
      } else {
        let mx = c.moveX;
        let my = c.moveY / COSB;
        const m = Math.hypot(mx, my);
        const hand = CHARACTERS[s.p.characterId].handling;
        const max = SKATE_MAX * hand.speed * (s.charging ? 0.35 : s.carry ? 0.9 : 1);
        if (m > 0.2) {
          mx /= Math.max(1, m);
          my /= Math.max(1, m);
          const tvx = mx * max;
          const tvy = my * max;
          const dvx = tvx - s.vx;
          const dvy = tvy - s.vy;
          const dl = Math.hypot(dvx, dvy);
          const step = SKATE_ACCEL * hand.accel * dt;
          if (dl <= step) {
            s.vx = tvx;
            s.vy = tvy;
          } else {
            s.vx += (dvx / dl) * step;
            s.vy += (dvy / dl) * step;
          }
          // Turning hard or braking against the glide throws up a spray of ice.
          if (dl > max * 0.9) s.sprayT += dt;
          if (!s.charging) this.turnToward(s, mx, my, dt * 9);
        } else {
          const d = Math.exp(-(s.charging ? 3 : GLIDE_DRAG) * dt);
          s.vx *= d;
          s.vy *= d;
        }
        if (s.charging && m > 0.3) this.turnToward(s, mx, my, dt * 14);
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      R.boards(s, SKATER_R, 0.35);
      // Skaters can't get into a net: its frame, and its mouth, are walls to them (not to pucks).
      for (const gv of this.goals) {
        R.goalFrame(s, SKATER_R, gv.g, 0.3);
        R.segment(s, SKATER_R, gv.g.posts[0], gv.g.posts[1], 0.3);
      }
    }
    // Skater bumps: push apart; a hard bump or a check knocks the puck loose.
    for (let i = 0; i < this.skaters.length; i++) {
      for (let j = i + 1; j < this.skaters.length; j++) this.bump(this.skaters[i], this.skaters[j]);
    }
    // Pucks.
    for (const pk of this.pucks) {
      if (!pk.on) continue;
      pk.cool = Math.max(0, pk.cool - dt * 1000);
      if (pk.z > 0) {
        pk.vz -= 2200 * dt;
        pk.z = Math.max(0, pk.z + pk.vz * dt);
        if (pk.z === 0) {
          pk.vz = 0;
          audio.play('land', { volume: 0.4, rate: 1.4 });
          this.rings.spawn(pk.x, pk.y * COSB, 12, 70, { squash: COSB, tint: 0xffffff, alpha: 0.8, ms: 360, depth: DEPTH.shadow });
        }
        continue;
      }
      pk.px = pk.x;
      pk.py = pk.y;
      const h = pk.holder;
      if (h) {
        pk.x = h.x + h.fx * STICK_REACH;
        pk.y = h.y + h.fy * STICK_REACH;
        pk.vx = h.vx;
        pk.vy = h.vy;
        // A carried puck pinned on the boards pops free.
        if (Math.abs(pk.x - RINK.cx) > RINK.half - PUCK_R || Math.abs(pk.y - RINK.cy) > RINK.half - PUCK_R) {
          R.boards(pk, PUCK_R, 0.5);
        }
        // Pushed over a goal line on the stick (from in front of the mouth): that counts too.
        for (const gv of this.goals) {
          const g = gv.g;
          const inFront = Math.abs((h.x - g.mx) * g.tx + (h.y - g.my) * g.ty) < GOAL.w / 2 + 10;
          if (!inFront || !R.crossedGoal(pk.px, pk.py, pk.x, pk.y, g)) continue;
          h.carry = null;
          h.charging = false;
          h.charge = 0;
          pk.holder = null;
          pk.last = h;
          this.goalScored(pk, gv);
          break;
        }
      } else {
        R.slide(pk, dt);
        const hit = R.boards(pk, PUCK_R, R.PUCK_BOUNCE);
        if (hit > 260) this.boardHit(pk, hit);
        for (const gv of this.goals) {
          if (R.crossedGoal(pk.px, pk.py, pk.x, pk.y, gv.g)) {
            this.goalScored(pk, gv);
            break;
          }
          const fh = R.goalFrame(pk, PUCK_R, gv.g, 0.6);
          if (fh > 200) this.postHit(pk, fh);
        }
        if (!pk.on) continue;
        this.puckVsSkaters(pk);
      }
    }
  }

  private turnToward(s: Skater, x: number, y: number, k: number): void {
    const m = Math.hypot(x, y);
    if (m < 1e-4) return;
    const t = Math.min(1, k);
    s.fx += (x / m - s.fx) * t;
    s.fy += (y / m - s.fy) * t;
    normalizeFacing(s);
  }

  private bump(a: Skater, b: Skater): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const min = SKATER_R * 2;
    if (d >= min || d < 1e-6) return;
    const nx = dx / d;
    const ny = dy / d;
    const wa = CHARACTERS[a.p.characterId].handling.weight;
    const wb = CHARACTERS[b.p.characterId].handling.weight;
    const push = min - d;
    a.x -= nx * push * (wb / (wa + wb));
    a.y -= ny * push * (wb / (wa + wb));
    b.x += nx * push * (wa / (wa + wb));
    b.y += ny * push * (wa / (wa + wb));
    const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (rv <= 0) return;
    const imp = (rv * 1.3) / (wa + wb);
    a.vx -= imp * wb * nx;
    a.vy -= imp * wb * ny;
    b.vx += imp * wa * nx;
    b.vy += imp * wa * ny;
    // Checks and hard hits jar the puck loose (and a check dazes whoever it hits).
    const aHits = a.checkT > 0;
    const bHits = b.checkT > 0;
    if (aHits || bHits || rv > 340) {
      const victim = aHits ? b : bHits ? a : a.carry ? a : b.carry ? b : null;
      if (victim?.carry) {
        const hitter = victim === a ? b : a;
        const kx = victim === a ? -nx : nx;
        const ky = victim === a ? -ny : ny;
        this.knockLoose(victim, kx, ky, 380);
        this.words.pop('rink-check', (a.x + b.x) / 2, ((a.y + b.y) / 2) * COSB - 110, { owner: 99, scale: 0.85 });
        if (hitter.checkT > 0) this.daze(victim, kx, ky);
      } else if (aHits || bHits) {
        const victim2 = aHits ? b : a;
        this.daze(victim2, aHits ? nx : -nx, aHits ? ny : -ny);
      }
      audio.play('hit', { volume: Math.min(0.7, rv / 700 + 0.25), rate: 0.9, throttleMs: 60 });
      this.fx.vfx('impact', (a.x + b.x) / 2, ((a.y + b.y) / 2) * COSB - 60, { scale: 0.4, duration: 260, blend: 'add' });
      if (aHits || bHits) {
        this.hitStop(60);
        kick(this, nx * 8, ny * 8 * COSB, 140);
      }
    }
  }

  private daze(s: Skater, kx: number, ky: number): void {
    s.stunT = STUN_MS;
    s.charging = false;
    s.charge = 0;
    s.vx += kx * 260;
    s.vy += ky * 260;
    s.c.play('stunned', { force: true, returnTo: 'idle' });
    this.fx.vfx('starSwirl', s.c.x, s.c.y + s.c.headY * CHAR_SCALE - 12, { scale: 0.32, duration: STUN_MS, blend: 'add' });
    this.rumble(s.p, 0.6, 0.4, 180);
  }

  /**
   * A loose puck meets the skaters: a slow one is gathered in by the stick (a generous reach), a fast
   * one only stops if it hits the skater's body, and bounces off (a block).
   */
  private puckVsSkaters(pk: Puck): void {
    for (const s of this.skaters) {
      if (s.carry || s.stunT > 0) continue;
      if (pk.cool > 0 && pk.last === s) continue;
      const sp = Math.hypot(pk.vx - s.vx, pk.vy - s.vy);
      if (sp < CATCH_V) {
        const d = Math.hypot(pk.x - (s.x + s.fx * 18), pk.y - (s.y + s.fy * 18));
        if (d <= PICK_R) {
          this.pickUp(s, pk);
          return;
        }
        continue;
      }
      // Too hot to handle: it ricochets off the body.
      const dx = pk.x - s.x;
      const dy = pk.y - s.y;
      const d = Math.hypot(dx, dy);
      const body = SKATER_R + PUCK_R - 6;
      if (d > body) continue;
      const nx = dx / (d || 1);
      const ny = dy / (d || 1);
      const vn = (pk.vx - s.vx) * nx + (pk.vy - s.vy) * ny;
      if (vn < 0) {
        pk.vx -= 1.5 * vn * nx;
        pk.vy -= 1.5 * vn * ny;
        pk.vx *= 0.7;
        pk.vy *= 0.7;
        pk.x = s.x + nx * body;
        pk.y = s.y + ny * body;
        pk.last = s;
        this.words.pop('rink-block', s.c.x, s.c.y - 170, { owner: 99, scale: 0.8 });
        audio.play('hit', { volume: 0.5, rate: 1.1, throttleMs: 60 });
        this.fx.vfx('impact', pk.x, pk.y * COSB - 20, { scale: 0.3, duration: 220, blend: 'add' });
      }
    }
  }

  private boardHit(pk: Puck, hit: number): void {
    audio.play('land', { volume: Math.min(0.5, hit / 2400), rate: 1.6, throttleMs: 60 });
    const sy = pk.y * COSB;
    this.rings.spawn(pk.x, sy, 8, 40, { squash: COSB, tint: 0xffffff, alpha: 0.7, ms: 260, depth: DEPTH.shadow });
  }

  private postHit(pk: Puck, hit: number): void {
    audio.play('hit', { volume: Math.min(0.6, hit / 1800), rate: 2.2, throttleMs: 80 });
    if (hit > 600) this.words.pop('rink-post', pk.x, pk.y * COSB - 60, { owner: 99, scale: 0.8 });
  }

  // --- Visuals -----------------------------------------------------------------------------------
  private syncVisuals(dt: number): void {
    this.rings.update(dt);
    const ts = this.time.timeScale;
    this.spray.sync(ts);
    this.sparks.sync(ts);
    for (const s of this.skaters) this.drawSkater(s, dt);
    for (const pk of this.pucks) this.drawPuck(pk);
    this.goalDanger();
    // The spotlights drift about (not on the TV, nor with Reduced Motion on).
    if (!LITE && !settings.get().reducedMotion) {
      for (let i = 0; i < this.spots.length; i++) {
        const sp = this.spots[i];
        if (this.tweens.isTweening(sp)) continue;
        const t = this.clock / 2600 + i * 2.1;
        sp.setPosition(RINK.cx + Math.cos(t) * 300, (RINK.cy + Math.sin(t * 1.3) * 250) * COSB);
      }
    }
  }

  /** A goal's lamp flickers while a fast puck is bearing down on its mouth (anticipation). */
  private goalDanger(): void {
    if (this.phase !== 'playing') return;
    for (const gv of this.goals) {
      if (this.tweens.isTweening(gv.lamp)) continue;
      const g = gv.g;
      let danger = 0;
      for (const pk of this.pucks) {
        if (!pk.on || pk.holder || pk.z > 0) continue;
        const sp = Math.hypot(pk.vx, pk.vy);
        if (sp < 500) continue;
        const toX = g.mx - pk.x;
        const toY = g.my - pk.y;
        const d = Math.hypot(toX, toY);
        const aim = (pk.vx * toX + pk.vy * toY) / (sp * (d || 1));
        if (aim > 0.9 && d / sp < 0.45) danger = Math.max(danger, aim);
      }
      const flick = danger > 0 ? 0.55 + 0.4 * (Math.floor(this.clock / 60) % 2) : 0.35;
      gv.lamp.setAlpha(flick).setScale(danger > 0 ? 1.7 : 1.2);
    }
  }

  private drawSkater(s: Skater, dt: number): void {
    const sx = s.x;
    const sy = s.y * COSB;
    s.c.setPosition(sx, sy).setDepth(sy);
    if (Math.abs(s.fx) > 0.15) s.c.face(s.fx < 0);
    const speed = Math.hypot(s.vx, s.vy);
    if (s.stunT <= 0 && s.swingT <= 0 && !s.charging && s.checkT <= 0 && this.phase !== 'finished') {
      const cur = s.c.current;
      const pushing = Math.hypot(s.p.controls.moveX, s.p.controls.moveY) > 0.2;
      const want = speed < 50 ? 'idle' : pushing ? 'run' : 'dash';
      if (want === 'dash') {
        if (cur !== 'dash') s.c.hold('dash');
      } else if (cur !== want && (cur === 'idle' || cur === 'run' || cur === 'dash' || cur === 'crouch')) s.c.play(want);
    }
    // Ice spray from hard turns.
    if (s.sprayT > 0.05) {
      s.sprayT = 0;
      this.spray.fire(sx - s.vx * 0.04, sy + 4, burst(3), (Math.atan2(-s.vy * COSB, -s.vx) * 180) / Math.PI, 70, 60, 170);
    } else s.sprayT = Math.max(0, s.sprayT - dt / 4000);
    this.drawStick(s);
    this.drawMeter(s);
  }

  /** The hockey stick: from the hands down to the blade on the ice (raised back while winding up). */
  private drawStick(s: Skater): void {
    const g = s.stick;
    g.clear();
    if (s.stunT > 0 && this.phase === 'playing') return;
    const k = CHAR_SCALE;
    const face = s.c.isFacingLeft ? -1 : 1;
    const hx = s.c.x + face * 14 * k;
    const hy = s.c.y - 92 * k;
    let bx: number;
    let by: number;
    let lift = 0;
    if (s.charging) {
      const back = 26 + 34 * s.charge;
      bx = s.x - s.fx * back + s.fy * 10;
      by = s.y - s.fy * back - s.fx * 10;
      lift = 40 * s.charge;
    } else if (s.swingT > 0) {
      const u = 1 - s.swingT / 170;
      bx = s.x + s.fx * (STICK_REACH + 20 * u);
      by = s.y + s.fy * (STICK_REACH + 20 * u);
      lift = 16 * u;
    } else {
      bx = s.x + s.fx * (STICK_REACH - 12);
      by = s.y + s.fy * (STICK_REACH - 12);
    }
    const ex = bx;
    const ey = by * COSB - lift * SINB;
    const behind = s.fy < -0.3;
    g.setDepth(s.c.depth + (behind ? -1 : 1));
    g.lineStyle(7, 0x2a1c12, 1);
    g.lineBetween(hx, hy, ex, ey);
    g.lineStyle(3, 0xc79a5c, 1);
    g.lineBetween(hx, hy, ex, ey);
    // The blade, taped in the player's colour.
    const bl = 18;
    g.lineStyle(8, 0x1c1c22, 1);
    g.lineBetween(ex, ey, ex + s.fy * bl * -face, ey + 2);
    g.lineStyle(4, PLAYER_COLORS[s.p.slot], 1);
    g.lineBetween(ex, ey - 1, ex + s.fy * bl * -face, ey + 1);
  }

  /** While winding up: a ring filling round the feet and an arrow showing where the shot will go. */
  private drawMeter(s: Skater): void {
    const g = s.meter;
    g.clear();
    if (!s.charging || !s.carry) return;
    const color = PLAYER_COLORS[s.p.slot];
    const sx = s.x;
    const sy = s.y * COSB;
    g.lineStyle(7, 0x0a1120, 0.35);
    g.strokeEllipse(sx, sy + 2, 104, 104 * COSB);
    g.lineStyle(6, color, 0.95);
    g.beginPath();
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (i / steps) * Math.PI * 2 * s.charge;
      const px = sx + Math.cos(a) * 52;
      const py = sy + Math.sin(a) * 52 * COSB;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.strokePath();
    // Aim arrow from the puck (where the shot will really go), longer with the wind-up.
    const pk = s.carry;
    const aim = this.aimOf(s, pk);
    const ax = aim.x;
    const ay = aim.y;
    const L = 70 + 150 * s.charge;
    const x0 = pk.x;
    const y0 = pk.y * COSB;
    const x1 = x0 + ax * L;
    const y1 = y0 + ay * L * COSB;
    const full = s.charge >= 1;
    g.lineStyle(8, 0x0a1120, 0.3);
    g.lineBetween(x0, y0 + 2, x1, y1 + 2);
    g.lineStyle(6, full ? 0xffe08a : color, 0.95);
    g.lineBetween(x0, y0, x1, y1);
    const sdx = ax;
    const sdy = ay * COSB;
    const m = Math.hypot(sdx, sdy) || 1;
    const ux = sdx / m;
    const uy = sdy / m;
    g.fillStyle(full ? 0xffe08a : color, 1);
    g.fillTriangle(x1 + ux * 18, y1 + uy * 18, x1 - uy * 12, y1 + ux * 12, x1 + uy * 12, y1 - ux * 12);
  }

  private drawPuck(pk: Puck): void {
    if (!pk.on) return;
    const sx = pk.x;
    const sy = pk.y * COSB;
    pk.img.setPosition(sx, sy - pk.z * SINB - 3).setDepth(pk.holder ? pk.holder.c.depth + 0.5 : sy + 1);
    const k = Math.max(0.35, 1 - pk.z / 500);
    pk.shadow.setPosition(sx, sy + 2).setScale(0.36 * k, 0.12 * k).setDepth(DEPTH.shadow);
    // A trail in the shooter's colour behind a fast puck.
    const fast = !pk.holder && pk.z === 0 && Math.hypot(pk.vx, pk.vy) > 520;
    const g = pk.trail;
    if (!fast) {
      if (pk.tn) {
        pk.tn = 0;
        g.clear();
      }
      return;
    }
    const n = pk.tx.length;
    for (let i = n - 1; i > 0; i--) {
      pk.tx[i] = pk.tx[i - 1];
      pk.ty[i] = pk.ty[i - 1];
    }
    pk.tx[0] = sx;
    pk.ty[0] = sy - 3;
    pk.tn = Math.min(n, pk.tn + 1);
    g.clear();
    const col = pk.last ? PLAYER_COLORS[pk.last.p.slot] : 0xffffff;
    const step = LITE ? 2 : 1;
    for (let i = step; i < pk.tn; i += step) {
      const f = 1 - i / n;
      g.lineStyle(20 * f + 3, col, 0.5 * f);
      g.lineBetween(pk.tx[i - step], pk.ty[i - step], pk.tx[i], pk.ty[i]);
    }
  }

  protected override ambient(dt: number): void {
    if (this.phase === 'playing') return;
    this.syncVisuals(dt);
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      for (const s of this.skaters) {
        s.charging = false;
        s.meter.clear();
        s.vx *= 0.2;
        s.vy *= 0.2;
        if (s.c.current === 'crouch' || s.c.current === 'dash' || s.c.current === 'run') s.c.play('idle', { force: true });
      }
    }
    super.end();
  }

  // --- CPU ---------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const s = this.skaters.find((q) => q.p === p);
    if (!s) return;
    if (s.stunT > 0) {
      vc.setMove(0, 0);
      vc.hold('A', false);
      return;
    }
    const sk = this.skill(p);
    const ai = s.ai;
    ai.t -= dt;
    if (ai.t <= 0) {
      ai.t = sk.think * (0.55 + Math.random() * 0.5);
      this.cpuDecide(s);
    }
    // Winding up: hold A, aim at the chosen spot, let go once the wind-up is where it wants it.
    if (s.charging) {
      const ax = ai.aimX - s.x;
      const ay = ai.aimY - s.y;
      vc.setMove(ax, ay * COSB);
      const rival = this.nearestRival(s);
      const rushed = rival !== null && rival.d < 90;
      vc.hold('A', !(s.charge >= ai.chargeGoal || rushed));
      return;
    }
    if (ai.mode === 'charge' && s.carry) {
      // Press (again, if a held press didn't take: the wind-up starts on the press itself).
      vc.hold('A', !vc.held('A'));
      const ax = ai.aimX - s.x;
      const ay = ai.aimY - s.y;
      vc.setMove(ax, ay * COSB);
      return;
    }
    vc.hold('A', false);
    if (ai.checkWish && s.checkCd <= 0 && !s.carry) {
      ai.checkWish = false;
      const t = this.carrierNear(s, 125);
      if (t) {
        vc.setMove(t.x - s.x, (t.y - s.y) * COSB);
        vc.tap('A');
        return;
      }
    }
    const dx = ai.tx - s.x;
    const dy = ai.ty - s.y;
    const d = Math.hypot(dx, dy);
    if (d < 16) vc.setMove(0, 0);
    else {
      // Ease off as it arrives, so it doesn't sail past on the ice.
      const k = Math.min(1, d / 120);
      vc.setMove((dx / d) * k, ((dy / d) * k) * COSB);
    }
  }

  private nearestRival(s: Skater): { s: Skater; d: number } | null {
    let best: { s: Skater; d: number } | null = null;
    for (const o of this.skaters) {
      if (o === s) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (!best || d < best.d) best = { s: o, d };
    }
    return best;
  }

  private carrierNear(s: Skater, r: number): Skater | null {
    for (const o of this.skaters) if (o !== s && o.carry && Math.hypot(o.x - s.x, o.y - s.y) < r) return o;
    return null;
  }

  /** The CPU's plan for the next moment: shoot, chase, defend or hunt the carrier. */
  private cpuDecide(s: Skater): void {
    const sk = this.skill(s.p);
    const ai = s.ai;
    ai.checkWish = false;
    if (Math.random() < sk.mistake * 0.5) {
      ai.mode = 'idle';
      ai.tx = RINK.cx + (Math.random() - 0.5) * 500;
      ai.ty = RINK.cy + (Math.random() - 0.5) * 500;
      return;
    }
    const mine = s.goal;
    if (s.carry) {
      // Pick the rival goal worth shooting at: open (its keeper away), in front of us, not too far.
      let best: GoalView | null = null;
      let bestS = -Infinity;
      for (const gv of this.goals) {
        if (gv.owner === s) continue;
        const g = gv.g;
        const dx = s.x - g.mx;
        const dy = s.y - g.my;
        const dist = Math.hypot(dx, dy) || 1;
        const front = -(dx * g.nx + dy * g.ny) / dist;
        const keeper = gv.owner ? Math.min(400, Math.hypot(gv.owner.x - g.mx, gv.owner.y - g.my)) : 400;
        const score = keeper * 0.8 + front * 260 - dist * 0.45 + Math.random() * 60;
        if (score > bestS) {
          bestS = score;
          best = gv;
        }
      }
      if (!best) return;
      const g = best.g;
      // Aim for the side of the mouth away from its keeper.
      let side = Math.random() < 0.5 ? -1 : 1;
      if (best.owner) side = (best.owner.x - g.mx) * g.tx + (best.owner.y - g.my) * g.ty > 0 ? -1 : 1;
      const off = side * (GOAL.w / 2 - 34) + (Math.random() - 0.5) * 60 * sk.aimNoise * 3;
      ai.aimX = g.mx + g.tx * off;
      ai.aimY = g.my + g.ty * off;
      const dist = Math.hypot(s.x - g.mx, s.y - g.my);
      const front = -((s.x - g.mx) * g.nx + (s.y - g.my) * g.ny) / (dist || 1);
      const rival = this.nearestRival(s);
      if ((dist < 640 && front > 0.12) || (rival && rival.d < 110)) {
        ai.mode = 'charge';
        const base = 0.45 + sk.accuracy * 0.45;
        ai.chargeGoal = Math.min(1, base + (Math.random() - 0.5) * 0.3 * (1 - sk.accuracy + 0.3));
        // Aim error grows with the CPU's noise.
        const err = (Math.random() - 0.5) * 2 * sk.aimNoise * 90;
        ai.aimX += g.tx * err;
        ai.aimY += g.ty * err;
        ai.t = Math.max(ai.t, 520);
      } else {
        ai.mode = 'carry';
        ai.tx = g.mx - g.nx * 270 + g.tx * (Math.random() - 0.5) * 200;
        ai.ty = g.my - g.ny * 270 + g.ty * (Math.random() - 0.5) * 200;
      }
      return;
    }
    // Is a loose puck heading for my goal? Get in its way.
    for (const pk of this.pucks) {
      if (!pk.on || pk.holder || pk.z > 60) continue;
      const toX = mine.mx - pk.x;
      const toY = mine.my - pk.y;
      const dist = Math.hypot(toX, toY);
      const sp = Math.hypot(pk.vx, pk.vy);
      if (sp > 300 && dist < 700 && (pk.vx * toX + pk.vy * toY) / (sp * dist) > 0.85 && Math.random() < sk.accuracy + 0.1) {
        ai.mode = 'defend';
        const k = Math.min(1, 140 / dist);
        ai.tx = mine.mx - mine.nx * 45 + (pk.x - mine.mx) * k * 0.6;
        ai.ty = mine.my - mine.ny * 45 + (pk.y - mine.my) * k * 0.6;
        return;
      }
    }
    // A rival has a puck close to my goal: stand in the lane.
    const threat = this.skaters.find((o) => o !== s && o.carry && Math.hypot(o.x - mine.mx, o.y - mine.my) < 480);
    if (threat && Math.random() < 0.45 + sk.accuracy * 0.5) {
      ai.mode = 'defend';
      const dx = threat.x - mine.mx;
      const dy = threat.y - mine.my;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(0.4, 60 / d);
      ai.tx = mine.mx - mine.nx * 40 + dx * k;
      ai.ty = mine.my - mine.ny * 40 + dy * k;
      ai.checkWish = Math.hypot(threat.x - s.x, threat.y - s.y) < 150 && Math.random() < sk.accuracy;
      return;
    }
    // Otherwise go after a loose puck (leading it) — unless a rival is clearly closer and the puck
    // isn't on our side of the ice, in which case cover the goal (so they don't all pile in).
    let target: Puck | null = null;
    let bestD = Infinity;
    for (const pk of this.pucks) {
      if (!pk.on || pk.holder) continue;
      const d = Math.hypot(pk.x - s.x, pk.y - s.y);
      const closer = this.skaters.some((o) => o !== s && !o.carry && o.stunT <= 0 && Math.hypot(pk.x - o.x, pk.y - o.y) < d * 0.7);
      const ourSide = Math.hypot(pk.x - mine.mx, pk.y - mine.my) < 430;
      if (closer && !ourSide) continue;
      if (d < bestD) {
        bestD = d;
        target = pk;
      }
    }
    if (!target && this.pucks.some((pk) => pk.on && !pk.holder)) {
      const pk = this.pucks.find((q) => q.on && !q.holder) as Puck;
      ai.mode = 'defend';
      const dx = pk.x - mine.mx;
      const dy = pk.y - mine.my;
      const d = Math.hypot(dx, dy) || 1;
      ai.tx = mine.mx - mine.nx * 40 + (dx / d) * 150;
      ai.ty = mine.my - mine.ny * 40 + (dy / d) * 150;
      return;
    }
    if (target) {
      const d = Math.hypot(target.x - s.x, target.y - s.y);
      R.predict(target, Math.min(1.2, d / SKATE_MAX) * (0.4 + sk.accuracy * 0.5), this.tmp);
      ai.mode = 'chase';
      ai.tx = this.tmp.x;
      ai.ty = this.tmp.y;
      return;
    }
    const carrier = this.skaters.find((o) => o !== s && o.carry);
    // Hunt the carrier only if nobody else is nearer to them; otherwise hold the goal mouth.
    const nearer = carrier ? this.skaters.some((o) => o !== s && o !== carrier && Math.hypot(o.x - carrier.x, o.y - carrier.y) < Math.hypot(s.x - carrier.x, s.y - carrier.y)) : false;
    if (carrier && nearer) {
      ai.mode = 'defend';
      const dx = carrier.x - mine.mx;
      const dy = carrier.y - mine.my;
      const d = Math.hypot(dx, dy) || 1;
      ai.tx = mine.mx - mine.nx * 40 + (dx / d) * 120;
      ai.ty = mine.my - mine.ny * 40 + (dy / d) * 120;
      return;
    }
    if (carrier) {
      ai.mode = 'hunt';
      ai.tx = carrier.x + carrier.vx * 0.25;
      ai.ty = carrier.y + carrier.vy * 0.25;
      ai.checkWish = Math.hypot(carrier.x - s.x, carrier.y - s.y) < 170 && Math.random() < 0.3 + sk.accuracy * 0.6;
      return;
    }
    ai.mode = 'idle';
    ai.tx = mine.mx - mine.nx * 140;
    ai.ty = mine.my - mine.ny * 140;
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} points` }));
  }
}

function normalizeFacing(s: { fx: number; fy: number }): void {
  const m = Math.hypot(s.fx, s.fy);
  if (m < 1e-6) {
    s.fx = 1;
    s.fy = 0;
    return;
  }
  s.fx /= m;
  s.fy /= m;
}
