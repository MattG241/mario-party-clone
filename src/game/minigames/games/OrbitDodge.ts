import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { Character } from '../../characters/Character';
import { COLORS, CSS, GAME_WIDTH, PLAYER_COLORS } from '../../constants';
import type { VirtualControls } from '../../input/PlayerInput';
import { makeGlyph, glyphKindFor } from '../../ui/ControllerPrompt';
import { addText } from '../../ui/theme';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../data/npcs';
import { LITE } from '../../perf';
import { standOrigin } from '../../util/spriteUtil';
import { BaseMinigame, type MgPlayer } from '../BaseMinigame';
import { banner, kick, punch, titleImage } from '../juice';
import { addStrip } from '../../ui/Screen';
import { duckNearMiss, jumpNearMiss, type NearMiss } from './orbitDodgeRules';

interface Dodger {
  p: MgPlayer;
  c: Character;
  angle: number;
  x: number;
  y: number;
  z: number;
  vz: number;
  ducking: boolean;
  /** When (game ms) the current duck began (judges near misses under the high arm). */
  duckAt: number;
  lives: number;
  invuln: number;
  jumpBuffer: number;
  windup: number;
  warn: Phaser.GameObjects.Container;
  warnKind: 'low' | 'high' | null;
  /** After-image trail while tumbling or falling: time left, and time to the next ghost. */
  ghostT: number;
  ghostEvery: number;
  /** Depth scale of their spot on the disc (nearer players are drawn larger). */
  k: number;
}

interface Arm {
  id: number;
  angle: number;
  type: 'low' | 'high';
  flipIn: number;
}

const CX = 960;
const CY = 598;
const RX = 505;
const RY = 215;
const JUMP_V = 980;
const GRAVITY = 3100;
const CLEAR_Z = 34;
const BUFFER_MS = 100;
const LIVES = 3;
/** Radii the arm tips sweep (and the edge of the disc's playing surface). */
const TIP_RX = RX + 120;
const TIP_RY = RY + 60;
/** Raise of the high arm above the disc, on screen. */
const HIGH_LIFT = 150;
/** Seconds of warning at a player's spot before an arm reaches them (humans, CPUs). */
const WARN_T = 0.55;
const WARN_T_CPU = 0.35;
/** The speed-up's light sweep round the disc, ms. */
const SWEEP_MS = 700;
/** Arm colours: the low (jump) arm warm, the high (duck) arm violet. */
const LOW_HUE = 0xffa21f;
const HIGH_HUE = 0xb86bff;
const LOW_SPARKS = [0xfff1a8, 0xffb347, 0xffffff];
const HIGH_SPARKS = [0xf3c6ff, 0xff8cf0, 0xffffff];

/**
 * Orbit Dodge — mechanical arms sweep around the observatory platform. Jump the low arm (A),
 * duck the high arm (hold B). Three bonks and you're out; it speeds up every 10 seconds.
 */
export class OrbitDodgeScene extends BaseMinigame {
  private dodgers: Dodger[] = [];
  private arms: Arm[] = [];
  private omega = 1.25;
  private armG!: Phaser.GameObjects.Graphics;
  private highG!: Phaser.GameObjects.Graphics;
  /** Floor warnings at the players' feet, and a bright streak along each arm tip's path. */
  private warnG!: Phaser.GameObjects.Graphics;
  private streakG: Phaser.GameObjects.Graphics[] = [];
  /** The speed-up's light sweep over the disc. */
  private sweepG!: Phaser.GameObjects.Graphics;
  private sweepT = -1;
  private sweepFrom = 0;
  /** Sparks thrown off the arm tips (one emitter; direction and colour are set per emit). */
  private sparks?: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkDir = { x: 0, y: 0 };
  private sparkTints: number[] = LOW_SPARKS;
  private sparkFrame = 0;
  private ghosts: Phaser.GameObjects.Image[] = [];
  /** Pre-rendered 3D arms (64 angles each); two sprites per arm cross-fade between frames. */
  private armSprites: [Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite][] = [];
  private armFrames = 0;
  private nextSpeedUp = 10000;
  private dir = 1;
  private wrapped = false;
  /** Scratch points for the shadow and sweep polygons (no per-frame allocation). */
  private quad: Phaser.Types.Math.Vector2Like[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));
  private fan: Phaser.Types.Math.Vector2Like[] = Array.from({ length: 12 }, () => ({ x: 0, y: 0 }));
  private tan = { x: 0, y: 0 };

  constructor() {
    super('mg-orbit-dodge');
  }

  protected createArena(): void {
    this.duration = 0;
    this.dodgers = [];
    this.omega = 1.25;
    this.nextSpeedUp = 10000;
    this.dir = 1;
    this.wrapped = false;
    this.sweepT = -1;
    this.sparkFrame = 0;
    this.ghosts = [];
    // Render the near-miss call-outs once now, not mid-round (no hitch on the first one).
    titleImage(this, -500, -500, 'NICE!', 54, '#c8f6ff').destroy();
    titleImage(this, -500, -500, 'CLOSE CALL!', 50, CSS.goldLight).destroy();
    this.arms = [{ id: 0, angle: Math.PI * 0.25, type: 'low', flipIn: -1 }];
    const rendered = this.textures.exists('rendered-scene-orbit');
    if (rendered) {
      // Pre-rendered observatory rooftop (engraved stone, brass rings, crystal lights).
      const sky = ['rendered-sky-clear', 'rendered-sky-day'].find((k) => this.textures.exists(k));
      if (sky) this.add.image(GAME_WIDTH / 2, 480, sky).setDisplaySize(GAME_WIDTH * 1.12, 1210).setDepth(-100);
      this.add.image(0, 0, 'rendered-scene-orbit').setOrigin(0).setDepth(-10);
      this.buildSpectators();
    } else {
      this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, 1080).setDepth(-100);
      addStrip(this, 0, 560, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setDepth(-90);
      this.add.image(CX, CY + 30, 'mg-orbit-platform').setDisplaySize(1400, 760).setDepth(-10);
    }
    this.armG = this.add.graphics().setDepth(2);
    this.warnG = this.add.graphics().setDepth(3);
    this.sweepG = this.add.graphics().setDepth(3.5).setBlendMode(Phaser.BlendModes.ADD);
    this.highG = this.add.graphics().setDepth(5000);
    this.streakG = [0, 1].map(() => this.add.graphics().setBlendMode(Phaser.BlendModes.ADD));
    this.armSprites = [];
    this.armFrames = 0;
    if (this.textures.exists('rendered-orbit-arms')) {
      const tex = this.textures.get('rendered-orbit-arms');
      this.armFrames = tex.getFrameNames().filter((n) => n.startsWith('low_')).length;
      const meta = (tex.customData as { meta?: { scale?: number } }).meta;
      const k = 1 / (meta?.scale ?? 0.6);
      for (let i = 0; i < 2; i++) {
        const mk = () => this.add.sprite(0, 0, 'rendered-orbit-arms', 'low_00').setOrigin(0).setScale(k).setVisible(false);
        this.armSprites.push([mk(), mk()]);
      }
    }
    this.sparks = undefined;
    if (this.textures.exists('fx-dot')) {
      this.sparks = this.add.particles(0, 0, 'fx-dot', {
        emitting: false,
        lifespan: { min: 240, max: 420 },
        speed: 0,
        scale: { start: 0.62, end: 0 },
        alpha: { start: 1, end: 0.2 },
        gravityY: 260,
        blendMode: 'ADD',
        maxParticles: LITE ? 50 : 150,
        emitCallback: (p: Phaser.GameObjects.Particles.Particle) => this.aimSpark(p),
      });
      this.sparks.setDepth(5500);
    }
    const hub = this.add.sprite(CX, CY + 20, 'props', '19').play('barrier-spin');
    const o = standOrigin('props', '19');
    hub.setOrigin(o.x, o.y).setScale(0.8).setDepth(CY);
    if (!rendered) this.add.image(250, 330, 'observatory').setScale(0.26).setDepth(-20).setAlpha(0.9);
  }

  /**
   * Festival folk cheering from the floating balconies either side of the platform. Deck heights
   * match ORBIT_BALCONIES / BALCONY_Z in scripts/art/scenes.py (deck y = 380 - 0.55 * 100 * sin 65deg).
   */
  private buildSpectators(): void {
    const deckY = 380 - 0.55 * 100 * Math.sin((65 * Math.PI) / 180);
    const folk: [NpcId, string, number, number][] = [
      ['mimi', 'laugh', 185, 6],
      ['pipper', 'happy', 255, -10],
      ['packsprout', 'star', 325, 6],
      ['wrench', 'laugh', 1595, 6],
      ['ora', 'cheer', 1665, -10],
      ['mimi', 'happy', 1735, 6],
    ];
    // a second, smaller row at the back of each deck
    const back: [NpcId, string, number, number][] = [
      ['pipper', 'wave', 150, -34],
      ['wrench', 'idea', 220, -40],
      ['ora', 'flag', 290, -40],
      ['packsprout', 'happy', 360, -34],
      ['mimi', 'surprised', 1560, -34],
      ['packsprout', 'cheer', 1630, -40],
      ['pipper', 'coin', 1700, -40],
      ['wrench', 'tool', 1770, -34],
    ];
    [...back.map((b) => [...b, 0.3] as const), ...folk.map((f) => [...f, 0.36] as const)].forEach(([id, pose, x, dy, sc], i) => {
      const spr = this.add.sprite(x, deckY + dy, NPC_ATLAS, npcFrame(id, pose));
      const o = standOrigin(NPC_ATLAS, npcFrame(id, pose));
      spr.setOrigin(o.x, o.y).setScale(sc).setDepth(-5 + i * 0.01).setFlipX(x > 960);
      // soft contact shadow on the balcony deck so the spectators stand on it
      this.add.image(x, deckY + dy + 2, 'fx-contact').setScale(sc * 1.35, sc * 0.4).setAlpha(0.45).setDepth(-5.5);
      if (sc < 0.36) spr.setTint(0xe6ebf4);
      this.tweens.add({ targets: spr, y: deckY + dy - 7, duration: 380 + (i % 3) * 90, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 80 });
    });
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const n = this.players.length;
    // Start on the diagonals so nobody stands right in front of (or behind) the central hub.
    const base = Math.PI * 0.75;
    const angle = base + (index * Math.PI * 2) / n;
    const x = CX + Math.cos(angle) * RX;
    const y = CY + Math.sin(angle) * RY;
    // Nearer (lower on screen) players are drawn a little larger for depth.
    const depthK = 0.84 + 0.32 * ((y - (CY - RY)) / (2 * RY));
    const c = new Character(this, x, y, p.characterId, { scale: 0.62 * depthK, slot: p.slot });
    c.face(x > CX);
    p.character = c;
    const warn = this.add.container(x, y - 250).setDepth(6000).setVisible(false);
    this.dodgers.push({ p, c, angle, x, y, z: 0, vz: 0, ducking: false, duckAt: 0, lives: LIVES, invuln: 0, jumpBuffer: 0, windup: 0, warn, warnKind: null, ghostT: 0, ghostEvery: 0, k: depthK });
    p.score = LIVES;
  }

  protected override hudLabel(p: MgPlayer): string {
    const d = this.dodgers.find((x) => x.p === p);
    return d ? (d.lives > 0 ? `Lives ${d.lives}` : 'Out') : '';
  }

  protected override hudPips(p: MgPlayer): { filled: number; total: number } {
    const d = this.dodgers.find((x) => x.p === p);
    return { filled: Math.max(0, d?.lives ?? LIVES), total: LIVES };
  }

  protected override onStart(): void {
    audio.play('rumble', { volume: 0.5 });
  }

  /** Call-outs go below the disc, so they never hide a player while the arms sweep. */
  protected override bannerY(): number {
    return 945;
  }

  // --- Arms --------------------------------------------------------------------------------
  /** Point on an arm tip's path at angle `an`, raised by `lift`. */
  private rim(an: number, lift = 0): { x: number; y: number } {
    return { x: CX + Math.cos(an) * TIP_RX, y: CY - lift + Math.sin(an) * TIP_RY };
  }

  /**
   * Unit screen direction an arm is travelling at angle `an` (the sweep's tangent on the disc).
   * Written into one reused object (it's asked for every frame): read it straight away.
   */
  private sweepAt(an: number): { x: number; y: number } {
    const tx = -Math.sin(an) * RX * this.dir;
    const ty = Math.cos(an) * RY * this.dir;
    const l = Math.hypot(tx, ty) || 1;
    this.tan.x = tx / l;
    this.tan.y = ty / l;
    return this.tan;
  }

  private drawArms(): void {
    const g = this.armG;
    const h = this.highG;
    g.clear();
    h.clear();
    for (const s of this.streakG) s.clear();
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 110);
    const wedge = (layer: Phaser.GameObjects.Graphics, a0: number, a1: number, lift: number) => {
      layer.beginPath();
      layer.moveTo(CX, CY - lift);
      for (let t = 0; t <= 8; t++) {
        const p = this.rim(a0 + (a1 - a0) * (t / 8), lift);
        layer.lineTo(p.x, p.y);
      }
      layer.closePath();
      layer.fillPath();
    };
    const sprites = this.armFrames > 0;
    const playing = this.phase === 'playing';
    // Lite throws sparks every other frame (counted per frame, so both arms get their turn).
    this.sparkFrame++;
    this.armSprites.forEach((pair) => pair.forEach((sp) => sp.setVisible(false)));
    for (const [ai, a] of this.arms.entries()) {
      const low = a.type === 'low';
      const lift = low ? 0 : HIGH_LIFT;
      const tip = this.rim(a.angle, lift);
      const base = { x: CX, y: CY - lift };
      const flashing = a.flipIn > 0 && Math.floor(a.flipIn / 120) % 2 === 0;
      const hue = low ? 0xff4a2a : 0xb45cff;
      const layer = low ? g : h;
      const tipY = CY + Math.sin(a.angle) * RY;
      // Depth by the tip: players the arm reaches draw over the log / under the raised beam.
      const depth = low ? tipY - 30 : tipY + 20;
      this.drawShadow(a.angle, lift);
      if (playing) {
        // Motion smear trailing behind (faint), and a bright streak along the tip's path.
        const trail = Math.min(0.55, 0.12 * this.omega);
        for (let k = 0; k < 4; k++) {
          layer.fillStyle(low ? 0xffc27a : 0xd7b0ff, 0.07 * (1 - k / 4));
          wedge(layer, a.angle - this.dir * trail * ((k + 1) / 4), a.angle - this.dir * trail * (k / 4), lift);
        }
        this.drawStreak(ai, a, lift, depth);
        this.emitSparks(a, tip);
      }
      if (sprites && this.armSprites[ai]) {
        // 3D arm: pick the two nearest pre-rendered angles and cross-fade between them.
        const n = this.armFrames;
        const tau = Math.PI * 2;
        const f = ((((a.angle % tau) + tau) % tau) / tau) * n;
        const i0 = Math.floor(f) % n;
        const i1 = (i0 + 1) % n;
        const t = f - Math.floor(f);
        const [s0, s1] = this.armSprites[ai];
        const pre = low ? 'low_' : 'high_';
        s0.setFrame(pre + String(i0).padStart(2, '0')).setAlpha(1).setDepth(depth).setVisible(true);
        s1.setFrame(pre + String(i1).padStart(2, '0')).setAlpha(t).setDepth(depth + 0.01).setVisible(true);
        for (const sp of [s0, s1]) {
          if (flashing) sp.setTintFill(0xffffff);
          else sp.clearTint();
        }
        continue;
      }
      // Pulsing danger glow, dark outline, saturated body.
      const w = low ? 34 : 26;
      layer.lineStyle(w + 40, hue, 0.16 + 0.16 * pulse);
      layer.lineBetween(base.x, base.y, tip.x, tip.y);
      layer.lineStyle(w + 10, low ? 0x3b1a0e : 0x2a1446, 1);
      layer.lineBetween(base.x, base.y, tip.x, tip.y);
      layer.lineStyle(w, flashing ? 0xffffff : low ? 0xe0532a : 0x7a3fd0, 1);
      layer.lineBetween(base.x, base.y - 2, tip.x, tip.y - 2);
      // Hazard stripes along the beam.
      if (!flashing) {
        layer.lineStyle(w, low ? 0xffd23f : 0xf0d8ff, 1);
        for (let i = 0; i < 11; i++) {
          const t0 = 0.14 + i * 0.078;
          const t1 = t0 + 0.036;
          layer.lineBetween(base.x + (tip.x - base.x) * t0, base.y - 2 + (tip.y - base.y) * t0, base.x + (tip.x - base.x) * t1, base.y - 2 + (tip.y - base.y) * t1);
        }
      }
      layer.lineStyle(6, 0xffffff, 0.4);
      layer.lineBetween(base.x, base.y - w / 2 + 2, tip.x, tip.y - w / 2 + 2);
      // Glowing leading edge on the side the arm is sweeping towards.
      const dx = tip.x - base.x;
      const dy = tip.y - base.y;
      const len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len;
      let ny = dx / len;
      const sweepX = -Math.sin(a.angle) * this.dir;
      const sweepY = Math.cos(a.angle) * this.dir;
      if (nx * sweepX + ny * sweepY < 0) {
        nx = -nx;
        ny = -ny;
      }
      const off = w / 2 + 5;
      layer.lineStyle(7, low ? 0xfff27a : 0xff9cf5, 0.55 + 0.45 * pulse);
      layer.lineBetween(base.x + nx * off, base.y + ny * off, tip.x + nx * off, tip.y + ny * off);
      if (low) {
        for (let i = 1; i <= 6; i++) {
          const t = 0.22 + i * 0.13;
          const px = CX + (tip.x - CX) * t;
          const py = CY + (tip.y - CY) * t;
          g.fillStyle(0x3b1a0e, 1);
          g.fillTriangle(px - 12, py - 10, px + 12, py - 10, px, py - 38);
          g.fillStyle(COLORS.goldLight, 1);
          g.fillTriangle(px - 8, py - 12, px + 8, py - 12, px, py - 32);
        }
      } else {
        h.fillStyle(0x2a1446, 1);
        h.fillCircle(tip.x, tip.y, 40);
        h.fillStyle(0x5e3494, 1);
        h.fillCircle(tip.x, tip.y, 33);
        h.fillStyle(COLORS.gold, 1);
        for (let i = 0; i < 8; i++) {
          const an = (i / 8) * Math.PI * 2;
          h.fillTriangle(tip.x + Math.cos(an) * 30, tip.y + Math.sin(an) * 30, tip.x + Math.cos(an + 0.3) * 30, tip.y + Math.sin(an + 0.3) * 30, tip.x + Math.cos(an + 0.15) * 54, tip.y + Math.sin(an + 0.15) * 54);
        }
      }
    }
  }

  /**
   * The arm's shadow on the disc: a tapered band under it, light from the upper left. The low log's
   * sits tight and dark right beneath it; the raised beam's falls further off and softer, which is
   * what tells the two heights apart at a glance.
   */
  private drawShadow(an: number, lift: number): void {
    const g = this.armG;
    const low = lift === 0;
    // The log itself stands ~30 px off the disc, so even its shadow falls a little clear of it.
    const sx = 18 + lift * 0.2;
    const sy = 22 + lift * 0.55;
    const c = Math.cos(an);
    const s = Math.sin(an);
    const bx = CX + sx;
    const by = CY + sy;
    const tx = CX + c * TIP_RX + sx;
    const ty = CY + s * TIP_RY + sy;
    // The band's half-width, square to the arm on the disc and foreshortened with it.
    const nx = -s * RX;
    const ny = c * RY;
    const layers: [number, number][] = low
      ? [
          [0.13, 0.12],
          [0.09, 0.16],
          [0.055, 0.24],
        ]
      : [
          [0.19, 0.06],
          [0.14, 0.08],
          [0.09, 0.11],
        ];
    const q = this.quad;
    for (const [w, alpha] of layers) {
      q[0].x = bx + nx * w * 0.55;
      q[0].y = by + ny * w * 0.55;
      q[1].x = tx + nx * w;
      q[1].y = ty + ny * w;
      q[2].x = tx - nx * w;
      q[2].y = ty - ny * w;
      q[3].x = bx - nx * w * 0.55;
      q[3].y = by - ny * w * 0.55;
      g.fillStyle(0x1d1430, alpha);
      g.fillPoints(q, true);
    }
  }

  /** A bright streak along the path the tip has just swept (longer as the arms speed up). */
  private drawStreak(ai: number, a: Arm, lift: number, depth: number): void {
    const s = this.streakG[ai];
    if (!s) return;
    s.setDepth(depth + 0.02);
    const col = a.type === 'low' ? 0xffd27a : 0xe2b4ff;
    const span = Math.min(0.62, 0.15 * this.omega);
    const steps = 7;
    const tipX = CX + Math.cos(a.angle) * TIP_RX;
    const tipY = CY - lift + Math.sin(a.angle) * TIP_RY;
    let px = tipX;
    let py = tipY;
    for (let i = 1; i <= steps; i++) {
      const an = a.angle - this.dir * span * (i / steps);
      const x = CX + Math.cos(an) * TIP_RX;
      const y = CY - lift + Math.sin(an) * TIP_RY;
      const k = 1 - (i - 1) / steps;
      s.lineStyle(3 + 11 * k, col, 0.6 * k);
      s.lineBetween(px, py, x, y);
      px = x;
      py = y;
    }
    s.fillStyle(0xffffff, 0.8);
    s.fillCircle(tipX, tipY, 9);
  }

  /** Sparks thrown back off a moving tip, along its wake (fewer in Lite). */
  private emitSparks(a: Arm, tip: { x: number; y: number }): void {
    const em = this.sparks;
    if (!em) return;
    if (LITE && this.sparkFrame % 2) return;
    const t = this.sweepAt(a.angle);
    this.sparkDir.x = -t.x;
    this.sparkDir.y = -t.y;
    this.sparkTints = a.type === 'low' ? LOW_SPARKS : HIGH_SPARKS;
    em.emitParticleAt(tip.x, tip.y, LITE ? 1 : this.omega > 2.2 ? 3 : 2);
  }

  /** Each spark flies back along the arm's wake with a little spread, in the arm's colours. */
  private aimSpark(p: Phaser.GameObjects.Particles.Particle): void {
    const sp = 90 + Math.random() * 190;
    const spread = (Math.random() - 0.5) * 1.1;
    const c = Math.cos(spread);
    const s = Math.sin(spread);
    const dx = this.sparkDir.x * c - this.sparkDir.y * s;
    const dy = this.sparkDir.x * s + this.sparkDir.y * c;
    p.velocityX = dx * sp;
    p.velocityY = dy * sp - 60;
    p.tint = this.sparkTints[(Math.random() * this.sparkTints.length) | 0];
  }

  /**
   * Warnings on the floor: as an arm closes on a player, a ring in the arm's colour tightens round
   * their feet with a chevron on the side it's coming from (humans get it earlier and bolder).
   */
  private drawWarnings(): void {
    const g = this.warnG;
    g.clear();
    if (this.phase !== 'playing') return;
    for (const d of this.dodgers) {
      if (!d.p.alive) continue;
      let soonest: Arm | null = null;
      let t = 99;
      for (const a of this.arms) {
        const tt = this.timeUntil(a, d.angle);
        if (tt < t) {
          t = tt;
          soonest = a;
        }
      }
      const lead = d.p.isCpu ? WARN_T_CPU : WARN_T;
      if (!soonest || t >= lead) continue;
      const k = 1 - t / lead;
      const alpha = (d.p.isCpu ? 0.5 : 1) * (0.3 + 0.7 * k);
      const col = soonest.type === 'low' ? LOW_HUE : HIGH_HUE;
      const rx = 52 * d.k * (2 - k);
      const ry = rx * 0.32;
      g.lineStyle(7, 0x1d1430, alpha * 0.35);
      g.strokeEllipse(d.x, d.y + 3, rx * 2, ry * 2);
      g.lineStyle(5, col, alpha);
      g.strokeEllipse(d.x, d.y, rx * 2, ry * 2);
      // Chevron on the incoming side, pointing the way the arm travels.
      const s = this.sweepAt(d.angle);
      const cx = d.x - s.x * (rx + 16);
      const cy = d.y - s.y * (ry + 16);
      const nx = -s.y;
      const ny = s.x;
      const sz = 15 * d.k;
      g.fillStyle(col, alpha);
      g.fillTriangle(cx + s.x * sz, cy + s.y * sz * 0.6, cx - s.x * sz * 0.6 + nx * sz, cy - s.y * sz * 0.4 + ny * sz * 0.5, cx - s.x * sz * 0.6 - nx * sz, cy - s.y * sz * 0.4 - ny * sz * 0.5);
    }
  }

  /** The speed-up's light sweep: a bright wedge that runs once round the disc in the arms' direction. */
  private drawSweep(dt: number): void {
    const g = this.sweepG;
    if (this.sweepT < 0) return;
    this.sweepT += dt;
    g.clear();
    const u = this.sweepT / SWEEP_MS;
    if (u >= 1) {
      this.sweepT = -1;
      return;
    }
    const head = this.sweepFrom + this.dir * u * Math.PI * 2;
    const span = 0.55;
    const f = this.fan;
    f[0].x = CX;
    f[0].y = CY;
    const n = f.length - 1;
    for (let i = 0; i < n; i++) {
      const an = head - this.dir * span * (i / (n - 1));
      f[i + 1].x = CX + Math.cos(an) * (TIP_RX + 10);
      f[i + 1].y = CY + Math.sin(an) * (TIP_RY + 6);
    }
    const fade = Math.sin(u * Math.PI);
    g.fillStyle(0xfff1c8, 0.3 * fade);
    g.fillPoints(f, true);
    g.lineStyle(6, 0xffffff, 0.55 * fade);
    g.lineBetween(CX, CY, f[1].x ?? CX, f[1].y ?? CY);
  }

  /** Seconds until an arm reaches an angle (rotation direction aware). */
  private timeUntil(arm: Arm, angle: number): number {
    const tau = Math.PI * 2;
    const d = this.dir > 0 ? (((angle - arm.angle) % tau) + tau) % tau : (((arm.angle - angle) % tau) + tau) % tau;
    return d / this.omega;
  }

  protected tick(dt: number): void {
    const s = dt / 1000;
    // Difficulty ramp
    if (this.elapsed > this.nextSpeedUp) {
      this.nextSpeedUp += 10000;
      const before = this.omega;
      this.omega = Math.min(4.2, this.omega * 1.2);
      let sub: string | undefined;
      if (this.arms.length === 1) {
        this.arms.push({ id: 1, angle: this.arms[0].angle + Math.PI, type: 'high', flipIn: -1 });
        sub = 'DUCK THE HIGH ARM!';
      } else if (this.elapsed > 25000 && this.rng.chance(0.5)) {
        const a = this.rng.pick(this.arms);
        a.flipIn = 1100;
      }
      let reversed = false;
      if (this.elapsed > 40000 && this.rng.chance(0.4)) {
        this.dir *= -1;
        reversed = true;
      }
      if (this.omega > before) this.speedUp('SPEED UP!', reversed ? 'REVERSE!' : sub);
      else if (reversed) this.speedUp('REVERSE!');
    }
    const prev = this.arms.map((a) => a.angle);
    for (const a of this.arms) {
      a.angle += this.dir * this.omega * s;
      if (a.flipIn > 0) {
        a.flipIn -= dt;
        if (a.flipIn <= 0) {
          a.type = a.type === 'low' ? 'high' : 'low';
          audio.play('crack', { volume: 0.5 });
        }
      }
    }
    // Players
    for (const d of this.dodgers) {
      this.trail(d, dt);
      if (!d.p.alive) continue;
      const c = d.p.controls;
      d.invuln = Math.max(0, d.invuln - dt);
      const grounded = d.z <= 0 && d.vz <= 0;
      if (c.pressed('A')) d.jumpBuffer = BUFFER_MS;
      else d.jumpBuffer = Math.max(0, d.jumpBuffer - dt);
      if (d.windup > 0) {
        d.windup -= dt;
        if (d.windup <= 0) {
          d.vz = JUMP_V;
          audio.play('jump', { volume: 0.6 });
          d.c.play('jump', { force: true });
        }
      } else if (grounded && d.jumpBuffer > 0) {
        // Brief anticipation squat, then a strong launch.
        d.jumpBuffer = 0;
        d.windup = 55;
        d.ducking = false;
        d.c.hold('crouch');
      }
      if (!grounded || d.vz > 0) {
        d.vz -= GRAVITY * s;
        d.z = Math.max(0, d.z + d.vz * s);
        if (d.z <= 0 && d.vz < 0) {
          d.vz = 0;
          d.c.squash(0.18, 140);
          audio.play('land', { volume: 0.5 });
          this.fx.vfx('dust', d.x, d.y, { scale: 0.22, duration: 300, alpha: 0.6 });
          // (A bonked player comes down still dazed: 'stunned' returns to idle by itself.)
          if (d.c.current !== 'stunned') d.c.play('idle');
        }
      }
      const wantDuck = grounded && d.windup <= 0 && c.held('B');
      if (wantDuck !== d.ducking) {
        d.ducking = wantDuck;
        if (wantDuck) {
          d.duckAt = this.elapsed;
          d.c.hold('crouch');
        } else d.c.play('idle');
      }
      d.c.sprite.y = -d.z;
      d.c.shadow?.setScale(1 - Math.min(0.5, d.z / 300));
    }
    // Arm crossings
    this.arms.forEach((a, i) => {
      const before = prev[i];
      for (const d of this.dodgers) {
        if (!d.p.alive) continue;
        const tau = Math.PI * 2;
        const moved = Math.abs(a.angle - before);
        const dAng = this.dir > 0 ? (((d.angle - before) % tau) + tau) % tau : (((before - d.angle) % tau) + tau) % tau;
        if (dAng > moved) continue;
        const safe = a.type === 'low' ? d.z > CLEAR_Z : d.ducking;
        if (safe) {
          const near = d.invuln > 0 ? null : a.type === 'low' ? jumpNearMiss(d.z, d.vz, CLEAR_Z) : duckNearMiss(this.elapsed - d.duckAt);
          if (near) this.nearMiss(d, near);
          else this.fx.vfx('sparkle', d.x, d.y - 120 - d.z, { scale: 0.3, duration: 300, blend: 'add' });
          continue;
        }
        if (d.invuln > 0) continue;
        this.hit(d);
      }
    });
    // Warnings: show which button is needed when an arm is close (humans only).
    for (const d of this.dodgers) {
      if (!d.p.alive || d.p.isCpu) {
        d.warn.setVisible(false);
        continue;
      }
      let soonest: Arm | null = null;
      let t = 99;
      for (const a of this.arms) {
        const tt = this.timeUntil(a, d.angle);
        if (tt < t) {
          t = tt;
          soonest = a;
        }
      }
      const show = soonest && t < 0.7;
      if (show && soonest!.type !== d.warnKind) {
        d.warnKind = soonest!.type;
        d.warn.removeAll(true);
        const glyph = makeGlyph(this, soonest!.type === 'low' ? 'A' : 'B', 56, glyphKindFor(d.p.slot));
        const txt = addText(this, 0, 50, soonest!.type === 'low' ? 'JUMP!' : 'DUCK!', 34, { color: CSS.white, stroke: '#1b1530', strokeThickness: 7, weight: 700, fixed: true });
        d.warn.add([glyph, txt]);
      }
      d.warn.setVisible(!!show);
      d.warn.setPosition(d.x, d.y - 250 - d.z);
      if (!show) d.warnKind = null;
    }
    this.drawArms();
    this.drawWarnings();
    if (this.elapsed > 120000) this.end();
  }

  /** "SPEED UP!" (or "REVERSE!"): a banner, an alarm, and a sweep of light round the disc. */
  private speedUp(title: string, sub?: string): void {
    banner(this, title, { y: this.bannerY(), size: 96, color: CSS.goldLight, hold: 900, ribbon: true, sub });
    audio.play('alarm', { volume: 0.7 });
    audio.play('sweep', { volume: 0.5 });
    this.sweepT = 0;
    this.sweepFrom = this.arms[0]?.angle ?? 0;
    punch(this, 0.022, 300);
  }

  /** A genuine near miss: "NICE!" or "CLOSE CALL!" over their head, a ding and a few sparks. */
  private nearMiss(d: Dodger, kind: NearMiss): void {
    const close = kind === 'close';
    const x = d.x;
    const y = d.y + d.c.headY * Math.abs(d.c.scaleY) - d.z - 70;
    const t = titleImage(this, x, y, close ? 'CLOSE CALL!' : 'NICE!', close ? 50 : 54, close ? CSS.goldLight : '#c8f6ff').setDepth(6100).setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 200, ease: 'Back.Out' });
    this.tweens.add({ targets: t, y: y - 44, alpha: 0, delay: 460, duration: 260, ease: 'Quad.In', onComplete: () => t.destroy() });
    this.fx.sparks(x, d.y - 110 - d.z, LITE ? 6 : 12);
    audio.play('nearMiss', { volume: 0.7, rate: close ? 1.12 : 1 });
    this.rumble(d.p, 0.15, 0.25, 70);
  }

  private hit(d: Dodger): void {
    d.lives -= 1;
    d.invuln = 1000;
    audio.play('hit');
    this.fx.vfx('impact', d.x, d.y - 100 - d.z, { scale: 0.6, blend: 'add' });
    // brief white hit flash on the character
    d.c.sprite.setTintFill(0xffffff);
    this.time.delayedCall(70, () => d.c.sprite.clearTint());
    this.rumble(d.p, 0.7, 0.5, 220);
    const t = this.sweepAt(d.angle);
    const blow = { x: t.x, y: t.y };
    if (d.lives <= 0) {
      d.warn.setVisible(false);
      const out = { x: CX + Math.cos(d.angle) * (RX + 400), y: CY + Math.sin(d.angle) * (RY + 300) };
      d.c.play('fall', { force: true, returnTo: 'fall' });
      this.tweens.add({ targets: d.c, x: out.x, y: out.y + 300, alpha: 0, angle: 200, duration: 900, ease: 'Quad.In' });
      d.ghostT = 800;
      d.ghostEvery = 0;
      this.eliminate(d.p, blow);
      return;
    }
    // A hit: a freeze-frame, a kick the way the arm swept, and the player knocked up tumbling
    // head over heels with a trail of after-images.
    this.hitStop(110);
    kick(this, blow.x * 16, blow.y * 16, 170);
    d.c.play('stunned', { force: true });
    d.windup = 0;
    d.jumpBuffer = 0;
    d.ducking = false;
    d.vz = Math.max(d.vz, 560);
    d.z = Math.max(d.z, 1);
    const spin = blow.x >= 0 ? 360 : -360;
    this.tweens.add({ targets: d.c.sprite, angle: { from: 0, to: spin }, duration: 480, ease: 'Cubic.Out', onComplete: () => d.c.sprite.setAngle(0) });
    this.tweens.add({ targets: d.c, alpha: { from: 0.3, to: 1 }, duration: 120, repeat: 4 });
    this.fx.vfx('starSwirl', d.x, d.y + d.c.headY * Math.abs(d.c.scaleY) - 20, { scale: 0.4, duration: 800, blend: 'add' });
    d.ghostT = 420;
    d.ghostEvery = 0;
  }

  /** After-images left behind while tumbling or falling (a small pool of reused images). */
  private trail(d: Dodger, dt: number): void {
    if (d.ghostT <= 0) return;
    d.ghostT -= dt;
    d.ghostEvery -= dt;
    if (d.ghostEvery > 0) return;
    d.ghostEvery = LITE ? 90 : 50;
    const sp = d.c.sprite;
    let img = this.ghosts.find((gi) => !gi.visible);
    if (!img) {
      img = this.add.image(0, 0, sp.texture.key, sp.frame.name).setVisible(false);
      this.ghosts.push(img);
    }
    const k = Math.abs(d.c.scaleX);
    const cosA = Math.cos(d.c.rotation);
    const sinA = Math.sin(d.c.rotation);
    // The sprite's offset inside the (possibly rotating) character container.
    const ox = sp.x * k;
    const oy = sp.y * k;
    img.setTexture(sp.texture.key, sp.frame.name).setOrigin(sp.originX, sp.originY).setFlipX(sp.flipX);
    img.setPosition(d.c.x + ox * cosA - oy * sinA, d.c.y + ox * sinA + oy * cosA);
    img.setScale(k * sp.scaleX, k * sp.scaleY).setRotation(d.c.rotation + sp.rotation);
    img.setTintFill(PLAYER_COLORS[d.p.slot]).setAlpha(0.45 * d.c.alpha).setDepth(d.c.depth - 0.5).setVisible(true);
    this.tweens.killTweensOf(img);
    this.tweens.add({ targets: img, alpha: 0, duration: 240, ease: 'Quad.Out', onComplete: () => img.setVisible(false) });
  }

  protected override ambient(dt: number): void {
    if (this.phase === 'countdown') this.drawArms();
    else if (this.phase === 'finished') this.warnG.clear();
    this.drawSweep(dt);
    for (const d of this.dodgers) d.c.setDepth(d.y + 10);
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      // Everyone still standing lands for the finish (the round can end mid-jump).
      for (const d of this.dodgers) {
        d.warn.setVisible(false);
        if (!d.p.alive) continue;
        d.z = 0;
        d.vz = 0;
        d.windup = 0;
        d.c.sprite.y = 0;
        d.c.shadow?.setScale(1);
        if (d.ducking || d.c.current === 'jump') {
          d.ducking = false;
          d.c.play('idle', { force: true });
        }
      }
      this.warnG.clear();
      for (const s of this.streakG) s.clear();
    }
    super.end();
  }

  // --- CPU -----------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls): void {
    const d = this.dodgers.find((x) => x.p === p);
    if (!d) return;
    const sk = this.skill(p);
    const b = p.brain;
    let soonest: Arm | null = null;
    let t = 99;
    for (const a of this.arms) {
      const tt = this.timeUntil(a, d.angle);
      if (tt < t) {
        t = tt;
        soonest = a;
      }
    }
    if (!soonest) return;
    // Decide once per approaching arm (with reaction noise and occasional mistakes).
    if (b.n !== soonest.id || t > 1.2) {
      b.n = soonest.id;
      const reactionErr = (Math.random() - 0.5) * (sk.aimNoise * 0.35);
      b.wait = (soonest.type === 'low' ? 0.2 : 0.28) + reactionErr;
      const wrong = Math.random() < sk.mistake;
      b.mode = wrong ? (Math.random() < 0.5 ? 'none' : soonest.type === 'low' ? 'duck' : 'jump') : soonest.type === 'low' ? 'jump' : 'duck';
    }
    const lead = b.wait ?? 0.22;
    if (b.mode === 'jump') {
      vc.hold('B', false);
      if (t < lead && t > lead - 0.1 && d.z <= 0) vc.tap('A');
    } else {
      // Hold duck while the high arm is about to pass; releases once it has gone by.
      vc.hold('B', b.mode === 'duck' && t < lead + 0.05);
    }
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.eliminationScores((p) => (this.dodgers.find((d) => d.p === p)?.lives ?? 0) * 100);
  }
}
