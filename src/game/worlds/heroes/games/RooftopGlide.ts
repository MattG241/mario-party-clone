import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { CSS, GAME_WIDTH, PLAYER_COLORS } from '../../../constants';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { kick, popToHud, shockwave, titleTexture, type HudPop } from '../../../minigames/juice';
import { bakeWord, calmMotion, liteCount, WordPops } from '../../../minigames/games/stageKit';
import { LITE } from '../../../perf';
import { addText } from '../../../ui/theme';
import {
  BEAM_HALF,
  BEAM_LEN,
  CATCH_MS,
  clueInterval,
  GLIDE,
  glideCpu,
  inBeam,
  LAMPS,
  maxClues,
  newBeams,
  newBrain,
  newEvents,
  newFlyer,
  roofAt,
  ROOFS,
  spot,
  stepBeams,
  stepFlyer,
  tokenSpot,
  VENTS,
  type Beam,
  type Flyer,
  type FlyEvents,
  type FlyInput,
  type GlideBrain,
  type GlideClue,
  type GlideView,
} from '../glideRules';
import { canvasTex, centreOnBody, fallbackSky, finishHeroSprites, glowTex, heroTex, playerRing, queueHeroSprites, standOnFeet, streakTex } from '../heroesKit';

/** The rendered night skyline (scripts/art/worlds/heroes/mg_rooftop.py). */
const ARENA = 'rendered-scene-heroes_rooftops';
const SPRITES: readonly string[] = ['lamp_head'];
const CHAR_SCALE = 0.55;
/** Where the cape sits, in screen px from the body centre (open canopy above the raised hands). */
const CANOPY_Y = -104;
const CANOPY_W = 210;
/** The player badge sits on the open canopy while gliding, and just over the head otherwise. */
const MARK_GLIDE = CANOPY_Y + 2;
const MARK_HEAD = -96;
const DEPTH = { sky: -100, arena: -50, draft: 5, shadow: 8, beam: 10, lamp: 12, clue: 20, glider: 100, alarm: 4990, words: 7000 } as const;
const STREAK_MS = 3000;
const CLUE_LIFE = 9000;
const GOLD_LIFE = 7000;
const DROP_LIFE = 5000;
/** Score pop-ups. */
const POP_SIZE = 58;
const POP_WHITE = '#ffffff';
const POP_GOLD = '#ffe36b';
const WORDS = {
  spotted: { key: 'hhg-w-spotted', text: 'SPOTTED!', size: 60, fill: ['#fff1d6', '#ff7a5c'] },
  swoop: { key: 'hhg-w-swoop', text: 'SWOOP!', size: 50, fill: ['#ffffff', '#8fe6ff'] },
  big: { key: 'hhg-w-big', text: 'BIG CLUE!', size: 56, fill: ['#fff6c4', '#ffbf2a'] },
  x3: { key: 'hhg-w-x3', text: 'x3 STREAK!', size: 52, fill: ['#ffffff', '#c8f6ff'] },
  x5: { key: 'hhg-w-x5', text: 'x5 STREAK!', size: 54, fill: ['#ffffff', '#ffe08a'] },
  x8: { key: 'hhg-w-x8', text: 'x8 STREAK!', size: 58, fill: ['#fff6c4', '#ffbf2a'] },
} as const;

type Pose = 'idle' | 'run' | 'glide' | 'dive' | 'stun' | 'leap' | 'dazed';

interface Glider {
  p: MgPlayer;
  c: Character;
  f: Flyer;
  ev: FlyEvents;
  brain: GlideBrain;
  input: FlyInput;
  canopy: Phaser.GameObjects.Image;
  streamer: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  /** Cape openness 0..1 (eases towards open while gliding). */
  cape: number;
  pose: Pose | null;
  /** Body tilt (radians) and the badge's height above the body centre. */
  tilt: number;
  markY: number;
  /** Time lit by a searchlight (ms): CATCH_MS and you're caught. */
  lock: number;
  lockTick: number;
  streak: number;
  lastCatch: number;
  pop?: { h: HudPop; value: number; gold: boolean };
  trailT: number;
  /** Put back on their feet for the finish poses: the flight visuals leave them be. */
  standing: boolean;
}

interface Clue extends GlideClue {
  gold: boolean;
  baseY: number;
  age: number;
  state: 'live' | 'drop' | 'gone';
  vx: number;
  vy: number;
  /** Ms until it can be picked up (a dropped clue), and who dropped it (they wait a little longer). */
  wait: number;
  owner: number;
  phase: number;
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
}

interface Draft {
  column: Phaser.GameObjects.Image;
  streaks: { img: Phaser.GameObjects.Image; y: number; v: number; x: number }[];
  puffT: number;
}

interface BeamView {
  b: Beam;
  cone: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Image;
  head: Phaser.GameObjects.Image;
  lens: Phaser.GameObjects.Image;
  /** Alarm glow while it holds someone (0..1), and a catch flash (ms). */
  heat: number;
  flash: number;
}

/**
 * Rooftop Glide — a night over the rooftops of Hero Heights. Hold A to glide on your cape, let go to
 * dive and open it again to swoop; ride the hot air rising from the vents, collect glowing clues and
 * keep out of the sweeping searchlights (caught: dazed, and a clue drops for anyone to grab). Most
 * clues after 45 seconds wins.
 */
export class RooftopGlideScene extends BaseMinigame {
  private gliders: Glider[] = [];
  private clues: Clue[] = [];
  private free: Clue[] = [];
  private live: GlideClue[] = [];
  private beams: BeamView[] = [];
  private drafts: Draft[] = [];
  private nextId = 1;
  private spawnT = 0;
  private storm = false;
  private beamSpeed = 1;
  private clock = 0;
  private wrapped = false;
  private pops!: WordPops;
  private alarmG!: Phaser.GameObjects.Graphics;
  private trails: Phaser.GameObjects.Image[] = [];
  private blinkers: Phaser.GameObjects.Image[] = [];
  private view!: GlideView & { claimed: Set<number>; rivals: { x: number; y: number }[] };

  constructor() {
    super('mg-rooftop-glide');
  }

  preload(): void {
    queueHeroSprites(this, SPRITES);
  }

  // --- Arena -----------------------------------------------------------------------------------
  protected createArena(): void {
    finishHeroSprites(this, SPRITES);
    this.duration = 45000;
    this.gliders = [];
    this.clues = [];
    this.free = [];
    this.live = [];
    this.beams = [];
    this.drafts = [];
    this.trails = [];
    this.blinkers = [];
    this.nextId = 1;
    this.spawnT = 900;
    this.storm = false;
    this.beamSpeed = 1;
    this.clock = 0;
    this.wrapped = false;
    this.view = { clues: this.live, beams: [], beamSpeed: 1, claimed: new Set(), rivals: [], lock: 0 };
    for (const w of Object.values(WORDS)) bakeWord(this, w.key, w.text, { size: w.size, fill: w.fill });
    titleTexture(this, '+1', POP_SIZE, POP_WHITE);
    titleTexture(this, '+3', POP_SIZE, POP_GOLD);
    glowTex(this);
    streakTex(this);
    this.makeTextures();
    if (this.textures.exists(ARENA)) this.add.image(0, 0, ARENA).setOrigin(0).setDepth(DEPTH.arena);
    else this.drawFallbackCity();
    this.buildDrafts();
    this.buildBeams();
    this.buildBlinkers();
    this.pops = new WordPops(this, DEPTH.words, 12);
    this.alarmG = this.add.graphics().setDepth(DEPTH.alarm);
  }

  /** Canvas art for the capes, clues, searchlight cones and lamp heads (small, made once). */
  private makeTextures(): void {
    for (let slot = 0; slot < 4; slot++) {
      const col = Phaser.Display.Color.IntegerToColor(PLAYER_COLORS[slot]);
      const css = (k: number) => `rgb(${Math.round(col.red * k)},${Math.round(col.green * k)},${Math.round(col.blue * k)})`;
      canvasTex(this, `hhg-canopy-${slot}`, 232, 92, (ctx) => {
        // A wide glider canopy: a bowed top edge, a gentler trailing edge, ribs and the player's shape.
        const path = () => {
          ctx.beginPath();
          ctx.moveTo(8, 70);
          ctx.quadraticCurveTo(116, -26, 224, 70);
          ctx.quadraticCurveTo(170, 50, 116, 58);
          ctx.quadraticCurveTo(62, 50, 8, 70);
          ctx.closePath();
        };
        ctx.save();
        ctx.translate(0, 6);
        ctx.fillStyle = 'rgba(8,14,30,0.35)';
        path();
        ctx.fill();
        ctx.restore();
        const g = ctx.createLinearGradient(0, 8, 0, 70);
        g.addColorStop(0, css(1.25));
        g.addColorStop(0.55, css(1));
        g.addColorStop(1, css(0.62));
        ctx.fillStyle = g;
        path();
        ctx.fill();
        ctx.strokeStyle = css(0.5);
        ctx.lineWidth = 2.5;
        for (const x of [60, 116, 172]) {
          ctx.beginPath();
          ctx.moveTo(x, x === 116 ? 20 : 34);
          ctx.lineTo(x + (x - 116) * 0.08, 58);
          ctx.stroke();
        }
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ffffff';
        path();
        ctx.stroke();
      });
      canvasTex(this, `hhg-streamer-${slot}`, 150, 44, (ctx) => {
        // The folded cape streaming out behind (tip on the left: flipped when facing left).
        const gr = ctx.createLinearGradient(150, 0, 0, 0);
        gr.addColorStop(0, css(1.1));
        gr.addColorStop(1, css(0.7));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(146, 10);
        ctx.quadraticCurveTo(80, 4, 6, 18);
        ctx.quadraticCurveTo(30, 22, 10, 30);
        ctx.quadraticCurveTo(80, 36, 146, 32);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
      });
    }
    canvasTex(this, 'hhg-clue', 76, 76, (ctx) => this.paintClue(ctx, 38, 30, ['#e6fdff', '#5ce1ff', '#1b7fa8'], '#ffffff'));
    canvasTex(this, 'hhg-clue-gold', 96, 96, (ctx) => this.paintClue(ctx, 48, 39, ['#fffbe0', '#ffd24a', '#c07a10'], '#fffdf2'));
    canvasTex(this, 'hhg-beam', 128, 512, (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const v = y / (h - 1);
        const half = Math.max(1, (1 - v) * (w / 2));
        const along = (0.28 + 0.72 * Math.pow(v, 0.7)) * Math.min(1, (1 - v) / 0.04) * Math.min(1, v / 0.12 + 0.05);
        for (let x = 0; x < w; x++) {
          const u = Math.abs(x + 0.5 - w / 2) / half;
          const a = u >= 1 ? 0 : (1 - u * u) * along;
          const i = (y * w + x) * 4;
          img.data[i] = 255;
          img.data[i + 1] = 255;
          img.data[i + 2] = 255;
          img.data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
    });
    canvasTex(this, 'hhg-lamphead', 56, 60, (ctx) => {
      // A searchlight drum on a yoke, lens up (it turns about its pivot at (28, 44)).
      ctx.fillStyle = '#2a3140';
      ctx.fillRect(10, 40, 36, 12);
      ctx.fillStyle = '#4a5468';
      ctx.beginPath();
      ctx.moveTo(12, 44);
      ctx.lineTo(16, 10);
      ctx.lineTo(40, 10);
      ctx.lineTo(44, 44);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6d7a94';
      ctx.fillRect(17, 16, 5, 24);
      ctx.fillStyle = '#fff6d0';
      ctx.fillRect(14, 4, 28, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(18, 5, 12, 3);
      ctx.fillStyle = '#1b2230';
      ctx.beginPath();
      ctx.arc(28, 44, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    canvasTex(this, 'hhg-draft', 64, 256, (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const v = y / (h - 1);
        const along = Math.min(1, v / 0.35) * (0.55 + 0.45 * v);
        for (let x = 0; x < w; x++) {
          const u = Math.abs(x + 0.5 - w / 2) / (w / 2);
          const a = Math.max(0, 1 - u * u) * along;
          const i = (y * w + x) * 4;
          img.data[i] = 255;
          img.data[i + 1] = 255;
          img.data[i + 2] = 255;
          img.data[i + 3] = Math.round(a * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
    });
  }

  /** A clue: a faceted hexagonal badge with a magnifying glass on it. */
  private paintClue(ctx: CanvasRenderingContext2D, c: number, r: number, ramp: readonly [string, string, string], ink: string): void {
    const hex = (rad: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        const x = c + Math.cos(a) * rad;
        const y = c + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    ctx.fillStyle = 'rgba(10,20,40,0.35)';
    ctx.save();
    ctx.translate(0, 3);
    hex(r + 4);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    hex(r + 4);
    ctx.fill();
    const g = ctx.createLinearGradient(0, c - r, 0, c + r);
    g.addColorStop(0, ramp[0]);
    g.addColorStop(0.45, ramp[1]);
    g.addColorStop(1, ramp[2]);
    ctx.fillStyle = g;
    hex(r);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(c - r * 0.8, c - r * 0.2);
    ctx.lineTo(c, c - r * 0.95);
    ctx.lineTo(c + r * 0.8, c - r * 0.2);
    ctx.closePath();
    ctx.fill();
    // The magnifying glass.
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.17;
    ctx.beginPath();
    ctx.arc(c - r * 0.1, c - r * 0.1, r * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    ctx.moveTo(c + r * 0.15, c + r * 0.15);
    ctx.lineTo(c + r * 0.48, c + r * 0.48);
    ctx.stroke();
  }

  /** Painted skyline for when the render isn't there: night sky, the roofs, vents and lamp towers. */
  private drawFallbackCity(): void {
    fallbackSky(this, DEPTH.sky);
    const g = this.add.graphics().setDepth(DEPTH.arena);
    // Distant towers.
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let x = -40; x < GAME_WIDTH; x += 70 + rnd() * 60) {
      const w = 60 + rnd() * 80;
      const top = 420 + rnd() * 260;
      g.fillStyle(0x223262, 1);
      g.fillRect(x, top, w, 1080 - top);
      g.fillStyle(0xffe7a0, 0.35);
      for (let wy = top + 16; wy < 1000; wy += 26) for (let wx = x + 8; wx < x + w - 10; wx += 18) if (rnd() < 0.3) g.fillRect(wx, wy, 7, 10);
    }
    for (const r of ROOFS) {
      const x0 = Math.max(-10, r.x0);
      const x1 = Math.min(GAME_WIDTH + 10, r.x1);
      g.fillStyle(0x3b4668, 1);
      g.fillRect(x0, r.y, x1 - x0, 1080 - r.y);
      g.fillStyle(0x59668c, 1);
      g.fillRect(x0 - 4, r.y - 10, x1 - x0 + 8, 14);
      g.fillStyle(0xffd98a, 0.55);
      for (let wy = r.y + 40; wy < 1060; wy += 48) for (let wx = x0 + 22; wx < x1 - 30; wx += 44) if (rnd() < 0.45) g.fillRect(wx, wy, 18, 24);
    }
    for (const v of VENTS) {
      g.fillStyle(0x6d7890, 1);
      g.fillRoundedRect(v.x - 46, v.y - 34, 92, 36, 6);
      g.fillStyle(0x2a3140, 1);
      for (let i = 0; i < 5; i++) g.fillRect(v.x - 38 + i * 16, v.y - 28, 8, 22);
    }
    for (const l of LAMPS) {
      g.fillStyle(0x4a5468, 1);
      g.fillRect(l.x - 26, l.y + 16, 52, roofAt(l.x) - l.y - 16);
    }
  }

  /** The hot air rising from each vent: a faint shimmering column, streaks climbing it, steam puffs. */
  private buildDrafts(): void {
    const n = liteCount(8);
    for (const v of VENTS) {
      const h = v.y - GLIDE.CEIL + 30;
      const column = this.add.image(v.x, v.y - 20, 'hhg-draft').setOrigin(0.5, 1).setDisplaySize(v.half * 2.2, h).setBlendMode(Phaser.BlendModes.ADD).setTint(0xbfe6ff).setAlpha(0.14).setDepth(DEPTH.draft);
      const streaks: Draft['streaks'] = [];
      for (let i = 0; i < n; i++) {
        const img = this.add.image(0, 0, 'hh-streak').setBlendMode(Phaser.BlendModes.ADD).setTint(0xe6f6ff).setDepth(DEPTH.draft + 0.1);
        const s = { img, y: v.y - Math.random() * h, v: 340 + Math.random() * 260, x: v.x + (Math.random() - 0.5) * v.half * 1.5 };
        streaks.push(s);
      }
      this.drafts.push({ column, streaks, puffT: Math.random() * 400 });
    }
  }

  private buildBeams(): void {
    const beams = newBeams();
    this.view.beams = beams;
    const w = 2 * Math.tan(BEAM_HALF) * BEAM_LEN * 1.35;
    for (const b of beams) {
      const cone = this.add.image(b.lamp.x, b.lamp.y, 'hhg-beam').setOrigin(0.5, 1).setDisplaySize(w, BEAM_LEN).setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff1c4).setAlpha(0.3).setDepth(DEPTH.beam);
      const core = this.add.image(b.lamp.x, b.lamp.y, 'hhg-beam').setOrigin(0.5, 1).setDisplaySize(w * 0.42, BEAM_LEN * 0.96).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffffff).setAlpha(0.2).setDepth(DEPTH.beam);
      const headKey = this.textures.exists(heroTex('lamp_head')) ? heroTex('lamp_head') : 'hhg-lamphead';
      const head = this.add.image(b.lamp.x, b.lamp.y + 18, headKey).setOrigin(0.5, 44 / 60).setDepth(DEPTH.lamp);
      const lens = this.add.image(b.lamp.x, b.lamp.y, 'hh-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff3c8).setScale(1.1).setDepth(DEPTH.lamp + 0.1);
      this.beams.push({ b, cone, core, head, lens, heat: 0, flash: 0 });
    }
    this.syncBeams(0);
  }

  /** Red aircraft-warning lights blinking on the tall towers' masts (the render's antennas). */
  private buildBlinkers(): void {
    for (const [x, y] of [
      [128, 470],
      [1790, 486],
    ]) {
      const img = this.add.image(x, y, 'hh-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xff4a3a).setScale(0.55).setDepth(DEPTH.draft);
      this.blinkers.push(img);
    }
  }

  // --- Players ---------------------------------------------------------------------------------
  protected createPlayer(p: MgPlayer, index: number): void {
    const spots = [300, 1620, 860, 1060];
    const f = newFlyer(spots[index % 4]);
    const c = new Character(this, f.x, f.y, p.characterId, { scale: CHAR_SCALE, slot: p.slot });
    c.shadow?.setVisible(false);
    playerRing(c)?.setVisible(false);
    c.setDepth(DEPTH.glider + index);
    p.character = c;
    const canopy = this.add.image(0, CANOPY_Y / CHAR_SCALE, `hhg-canopy-${p.slot}`).setScale(CANOPY_W / 232 / CHAR_SCALE).setAlpha(0);
    const streamer = this.add.image(0, -40 / CHAR_SCALE, `hhg-streamer-${p.slot}`).setOrigin(1, 0.4).setScale(1.1 / CHAR_SCALE).setAlpha(0);
    // The canopy and streamer ride inside the character (behind the body), tilting with it.
    c.addAt(streamer, c.getIndex(c.sprite));
    c.addAt(canopy, c.getIndex(c.sprite));
    const shadow = this.add.image(f.x, roofAt(f.x), 'fx-contact').setDepth(DEPTH.shadow).setAlpha(0.5);
    const g: Glider = {
      p,
      c,
      f,
      ev: newEvents(),
      brain: newBrain(),
      input: { stickX: 0, holdA: false, pressA: false },
      canopy,
      streamer,
      shadow,
      cape: 0,
      pose: null,
      tilt: 0,
      markY: MARK_HEAD,
      lock: 0,
      lockTick: 0,
      streak: 0,
      lastCatch: -1e9,
      trailT: 0,
      standing: false,
    };
    this.gliders.push(g);
    this.setPose(g, 'idle');
    this.syncGlider(g, 0);
  }

  /** Change animation; the sprite is re-registered on the body centre so tilts turn about the middle. */
  private setPose(g: Glider, pose: Pose): void {
    if (g.pose === pose) return;
    g.pose = pose;
    const c = g.c;
    switch (pose) {
      case 'idle':
        c.play('idle', { force: true });
        break;
      case 'run':
        c.play('run', { force: true });
        break;
      case 'glide':
        c.hold('jump', 2);
        break;
      case 'leap':
        c.hold('jump', 1);
        break;
      case 'dive':
        c.hold('dash', 0);
        break;
      case 'stun':
        c.hold('fall', 0);
        break;
      case 'dazed':
        c.hold('stunned', 1);
        break;
    }
    this.centreSprite(g);
  }

  private centreSprite(g: Glider): void {
    centreOnBody(g.c, GLIDE.BODY, CHAR_SCALE);
  }

  protected override onStart(): void {
    audio.play('whoosh', { volume: 0.5, rate: 0.8 });
    for (let i = 0; i < 2 + this.players.length; i++) this.spawnClue(i === 2);
    if (this.humanSlots().length === 0) return;
    const t = addText(this, 960, 1000, 'Hold A to glide  ·  let go to dive  ·  vents lift you up', 34, { color: CSS.cream, stroke: '#06141a', strokeThickness: 7, weight: 700, fixed: true });
    const back = this.add.graphics().setDepth(8799);
    back.fillStyle(0x06141a, 0.6);
    back.fillRoundedRect(960 - t.width / 2 - 28, 1000 - 30, t.width + 56, 60, 30);
    t.setDepth(8800);
    for (const o of [t, back]) {
      o.setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, delay: 500, duration: 250 });
      this.tweens.add({ targets: o, alpha: 0, delay: 4200, duration: 500, onComplete: () => o.destroy() });
    }
  }

  /** Mid-round call-outs sit low, over the building fronts, clear of the sky where the clues are. */
  protected override bannerY(): number {
    return 972;
  }

  protected override onFinalStretch(): void {
    this.storm = true;
    this.beamSpeed = 1.3;
    this.showFinalStretch('CLUE STORM!');
    for (let i = 0; i < 3; i++) this.spawnClue(i === 1);
  }

  protected override hudLabel(p: MgPlayer): string {
    return String(p.score);
  }

  // --- Clues -----------------------------------------------------------------------------------
  private takeClue(gold: boolean): Clue {
    let c = this.free.pop();
    const key = gold ? 'hhg-clue-gold' : 'hhg-clue';
    if (!c) {
      const img = this.add.image(0, 0, key).setDepth(DEPTH.clue + 1);
      const glow = this.add.image(0, 0, 'hh-glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.clue);
      c = { id: 0, x: 0, y: 0, value: 1, life: 0, gold, baseY: 0, age: 0, state: 'gone', vx: 0, vy: 0, wait: 0, owner: -1, phase: 0, img, glow };
    }
    c.img.setTexture(key).setVisible(true).setAlpha(1).setAngle(0);
    c.glow.setTint(gold ? 0xffd24a : 0x7fe8ff).setVisible(true).setAlpha(0.6);
    c.id = this.nextId++;
    c.gold = gold;
    c.value = gold ? 3 : 1;
    c.age = 0;
    c.vx = 0;
    c.vy = 0;
    c.wait = 0;
    c.owner = -1;
    c.phase = Math.random() * Math.PI * 2;
    this.clues.push(c);
    return c;
  }

  private spawnClue(gold: boolean): void {
    const s = tokenSpot(() => this.rng.next(), this.clues, gold);
    const c = this.takeClue(gold);
    c.x = s.x;
    c.y = s.y;
    c.baseY = s.y;
    c.state = 'live';
    c.life = gold ? GOLD_LIFE : CLUE_LIFE;
    const k = gold ? 1 : 0.8;
    c.img.setPosition(c.x, c.y).setScale(0.1);
    c.glow.setPosition(c.x, c.y).setScale(0.1);
    this.tweens.add({ targets: c.img, scale: k, duration: 280, ease: 'Back.Out' });
    this.tweens.add({ targets: c.glow, scale: gold ? 2.3 : 1.7, duration: 280, ease: 'Quad.Out' });
    shockwave(this, c.x, c.y, { radius: gold ? 80 : 56, color: gold ? 0xffd24a : 0x7fe8ff, alpha: 0.7, duration: 360, depth: DEPTH.clue - 1 });
    if (gold) audio.play('shield', { volume: 0.35, rate: 1.3 });
  }

  /** A clue shaken loose by a searchlight: it pops out and flutters down for anyone to catch. */
  private dropClue(g: Glider): void {
    const c = this.takeClue(false);
    c.x = g.f.x;
    c.y = g.f.y - 20;
    c.state = 'drop';
    c.life = DROP_LIFE;
    c.vx = (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 80);
    c.vy = -330;
    c.wait = 380;
    c.owner = g.p.slot;
    c.img.setPosition(c.x, c.y).setScale(0.8);
    c.glow.setPosition(c.x, c.y).setScale(1.7);
    audio.play('chipLose', { volume: 0.6 });
  }

  private releaseClue(c: Clue): void {
    c.state = 'gone';
    this.tweens.killTweensOf(c.img);
    this.tweens.killTweensOf(c.glow);
    c.img.setVisible(false);
    c.glow.setVisible(false);
    this.free.push(c);
  }

  private updateClues(dt: number): void {
    const s = dt / 1000;
    for (const c of this.clues) {
      if (c.state === 'gone') continue;
      c.age += dt;
      c.life -= dt;
      if (c.wait > 0) c.wait -= dt;
      if (c.state === 'drop') {
        // Out of the glider in an arc, then fluttering down.
        c.vy = c.vy < 70 ? c.vy + 1100 * s : 70;
        c.vx *= Math.exp(-2.2 * s);
        c.x = Phaser.Math.Clamp(c.x + (c.vx + Math.sin(c.age / 260) * 60) * s, 90, 1830);
        c.y += c.vy * s;
        const floor = roofAt(c.x) - 30;
        if (c.y > floor) {
          c.y = floor;
          c.vy = 0;
        }
        c.img.setAngle(Math.sin(c.age / 200) * 18);
      } else c.y = c.baseY + Math.sin(c.age / 420 + c.phase) * 7;
      const pulse = 0.5 + 0.5 * Math.sin(c.age / 180 + c.phase);
      c.img.setPosition(c.x, c.y);
      c.glow.setPosition(c.x, c.y).setAlpha((c.gold ? 0.55 : 0.4) + 0.25 * pulse);
      if (c.life < 1500) c.img.setAlpha(Math.floor(c.life / 110) % 2 ? 0.35 : 1);
      if (c.life <= 0) this.releaseClue(c);
    }
    let w = 0;
    for (const c of this.clues) if (c.state !== 'gone') this.clues[w++] = c;
    this.clues.length = w;
  }

  private collect(g: Glider, c: Clue): void {
    const slot = g.p.slot;
    g.p.score += c.value;
    g.streak = this.elapsed - g.lastCatch < STREAK_MS ? g.streak + 1 : 1;
    g.lastCatch = this.elapsed;
    if (c.gold) {
      audio.play('goldChip', { volume: 0.9 });
      this.pops.pop(WORDS.big.key, c.x, c.y - 70, { owner: slot * 10 + 1, scale: 1, rise: 40, hold: 520 });
      this.fx.sparks(c.x, c.y, liteCount(22));
      shockwave(this, c.x, c.y, { radius: 120, color: 0xffd24a, alpha: 0.9, duration: 420, depth: DEPTH.clue - 1 });
    } else {
      audio.play('chipGain', { rate: Math.min(1.5, 0.92 + g.streak * 0.06), throttleMs: 40 });
      this.fx.sparks(c.x, c.y, liteCount(10));
      shockwave(this, c.x, c.y, { radius: 70, color: 0x7fe8ff, alpha: 0.75, duration: 320, depth: DEPTH.clue - 1 });
    }
    this.popScore(g, c);
    const word = g.streak === 3 ? WORDS.x3 : g.streak === 5 ? WORDS.x5 : g.streak === 8 ? WORDS.x8 : null;
    if (word) {
      this.pops.pop(word.key, g.f.x, g.f.y - 150, { owner: slot * 10 + 2, scale: 1, rise: 36, hold: 560, tilt: -6 });
      audio.play('streak', { volume: 0.6, rate: 1 + g.streak * 0.03 });
    }
    this.rumble(g.p, 0.12, 0.25, 60);
    g.c.squash(0.12, 140);
    // The clue zips into the glider.
    const img = c.img;
    const glow = c.glow;
    c.state = 'gone';
    this.tweens.add({
      targets: [img, glow],
      x: g.f.x,
      y: g.f.y,
      scale: 0.1,
      alpha: 0.2,
      duration: 160,
      ease: 'Quad.In',
      onComplete: () => {
        img.setVisible(false);
        glow.setVisible(false);
        this.free.push(c);
      },
    });
  }

  /** The "+1" flies to their HUD capsule; quick catches add to the one still gathering ("+1" -> "+3"). */
  private popScore(g: Glider, c: Clue): void {
    const slot = g.p.slot;
    this.holdHud(slot, c.value);
    const open = g.pop;
    if (open && open.h.gathering && open.h.image.active) {
      open.value += c.value;
      open.gold ||= c.gold;
      open.h.retitle(`+${open.value}`, open.gold ? POP_GOLD : POP_WHITE);
      return;
    }
    const to = this.hudPoint(slot);
    const entry: { h?: HudPop; value: number; gold: boolean } = { value: c.value, gold: c.gold };
    entry.h = popToHud(this, c.x + (c.x < 960 ? 60 : -60), c.y - 60, `+${c.value}`, to.x, to.y, {
      color: c.gold ? POP_GOLD : POP_WHITE,
      size: POP_SIZE,
      onArrive: () => {
        this.releaseHud(slot, entry.value);
        this.bumpHud(slot);
        if (g.pop === entry) g.pop = undefined;
      },
    });
    g.pop = entry as { h: HudPop; value: number; gold: boolean };
  }

  // --- Frame -----------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.clock += dt;
    const n = this.players.length;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = clueInterval(n, this.storm);
      let live = 0;
      for (const c of this.clues) if (c.state === 'live') live++;
      if (live < maxClues(n, this.storm)) this.spawnClue(this.rng.chance(this.storm ? 0.22 : 0.12));
    }
    this.updateClues(dt);
    for (const g of this.gliders) {
      const ctl = g.p.controls;
      g.input.stickX = ctl.moveX;
      g.input.holdA = ctl.held('A');
      g.input.pressA = ctl.pressed('A');
      const was = g.f.mode;
      stepFlyer(g.f, g.input, dt, g.ev);
      this.flightFx(g, was);
      this.searchlights(g, dt);
    }
    // Pick-ups: each clue goes to the nearest glider in reach (not a dazed one; a dropped clue's
    // owner waits a moment before they can snatch it back).
    for (const c of this.clues) {
      if (c.state === 'gone' || c.wait > 0) continue;
      let best: Glider | null = null;
      let bestD = GLIDE.REACH + (c.gold ? 10 : 0);
      for (const g of this.gliders) {
        if (g.f.mode === 'stun' || (g.f.mode === 'roof' && g.f.stunT > 0) || (c.owner === g.p.slot && c.age < 800)) continue;
        const d = Math.hypot(c.x - g.f.x, c.y - g.f.y);
        if (d < bestD) {
          bestD = d;
          best = g;
        }
      }
      if (best) this.collect(best, c);
    }
  }

  /** Searchlights: the beam's hold on a glider builds (an alarm ring closes in); held long enough, they're spotted. */
  private searchlights(g: Glider, dt: number): void {
    const f = g.f;
    if (f.invuln > 0 || f.mode === 'stun') {
      g.lock = 0;
      return;
    }
    let lit: BeamView | null = null;
    for (const bv of this.beams) if (inBeam(bv.b.lamp, bv.b.angle, f.x, f.y)) lit = bv;
    if (!lit) {
      g.lock = Math.max(0, g.lock - dt * 2);
      return;
    }
    g.lock += dt;
    lit.heat = Math.min(1, lit.heat + dt / 200);
    g.lockTick -= dt;
    if (g.lockTick <= 0) {
      g.lockTick = 90;
      audio.play('warn', { volume: 0.3, rate: 1 + g.lock / CATCH_MS, throttleMs: 60 });
    }
    if (g.lock >= CATCH_MS) this.caught(g, lit);
  }

  private caught(g: Glider, bv: BeamView): void {
    g.lock = 0;
    spot(g.f);
    g.streak = 0;
    bv.flash = 320;
    this.hitStop(70);
    const dx = g.f.x - bv.b.lamp.x;
    const dy = g.f.y - bv.b.lamp.y;
    const d = Math.hypot(dx, dy) || 1;
    kick(this, (dx / d) * 12, (dy / d) * 12, 160);
    audio.play('hit', { volume: 0.7 });
    audio.play('alarm', { volume: 0.35 });
    this.pops.pop(WORDS.spotted.key, g.f.x, g.f.y - 140, { owner: g.p.slot * 10, scale: 1, rise: 40, hold: 620, tilt: 8 });
    this.fx.vfx('starSwirl', g.f.x, g.f.y - 70, { scale: 0.45, duration: 800, blend: 'add' });
    shockwave(this, g.f.x, g.f.y, { radius: 110, color: 0xff6a4a, alpha: 0.85, duration: 380, depth: DEPTH.alarm });
    g.c.sprite.setTintFill(0xffffff);
    this.time.delayedCall(90, () => g.c.sprite.clearTint());
    this.rumble(g.p, 0.6, 0.4, 220);
    if (!calmMotion()) this.tweens.add({ targets: g, tilt: g.tilt + Math.PI * 2 * g.f.face, duration: 520, ease: 'Cubic.Out', onComplete: () => (g.tilt = 0) });
    if (g.p.score > 0) {
      g.p.score--;
      this.dropClue(g);
    }
  }

  /** Effects for what the flight step reported: leaps, cape snaps, swoops, updrafts, landings. */
  private flightFx(g: Glider, was: Flyer['mode']): void {
    const e = g.ev;
    const f = g.f;
    const feetY = f.y + GLIDE.BODY;
    if (e.leap) {
      audio.play('jump', { volume: 0.5, rate: 0.95 });
      this.fx.vfx('dust', f.x, feetY, { scale: 0.3, duration: 320, alpha: 0.6, depth: DEPTH.glider - 1 });
      g.c.squash(0.16, 160);
    }
    if (e.openCape && !e.leap) audio.play('whoosh', { volume: 0.35, rate: 0.75, throttleMs: 80 });
    if (e.closeCape) audio.play('whoosh', { volume: 0.3, rate: 1.35, throttleMs: 80 });
    if (e.swoop > 380) {
      audio.play('nearMiss', { volume: 0.55, rate: 0.9 + e.swoop / 1600 });
      shockwave(this, f.x, f.y, { radius: 90, ratio: 0.5, color: PLAYER_COLORS[g.p.slot], alpha: 0.75, duration: 320, depth: DEPTH.glider - 2 });
      if (e.swoop > 540) this.pops.pop(WORDS.swoop.key, f.x, f.y - 150, { owner: g.p.slot * 10 + 3, near: 80, scale: 0.9, rise: 30, hold: 360 });
      this.rumble(g.p, 0.15, 0.3, 90);
    }
    if (e.updraft) {
      audio.play('sweep', { volume: 0.25, rate: 1.2, throttleMs: 200 });
      this.fx.vfx('smoke', f.x, f.y + 40, { scale: 0.3, duration: 500, alpha: 0.35, tint: 0xd8ecff, dy: -80, depth: DEPTH.glider - 1 });
    }
    if (e.land) {
      const hard = e.hardLand;
      audio.play('land', { volume: hard ? 0.7 : 0.4 });
      this.fx.vfx('dust', f.x, feetY, { scale: hard ? 0.42 : 0.26, duration: 380, alpha: 0.7, depth: DEPTH.glider - 1 });
      g.c.squash(hard ? 0.24 : 0.14, 170);
      if (hard) this.fx.shake(0.003, 120);
    }
    if (e.bonk && was !== 'roof') {
      audio.play('hit', { volume: 0.35, throttleMs: 150 });
      this.fx.sparks(f.x + f.face * 30, f.y, liteCount(8));
    }
  }

  // --- Visuals ---------------------------------------------------------------------------------
  protected override ambient(dt: number): void {
    const s = dt / 1000;
    if (this.phase !== 'finished') stepBeams(this.view.beams, dt, this.beamSpeed);
    this.syncBeams(dt);
    this.syncDrafts(dt);
    for (let i = 0; i < this.blinkers.length; i++) this.blinkers[i].setAlpha(Math.sin(this.time.now / 380 + i * 2) > 0.2 ? 0.95 : 0.12);
    for (const g of this.gliders) this.syncGlider(g, s);
    this.drawAlarms();
  }

  private syncBeams(dt: number): void {
    for (const bv of this.beams) {
      const a = bv.b.angle;
      bv.flash = Math.max(0, bv.flash - dt);
      bv.heat = Math.max(0, bv.heat - dt / 500);
      const hot = bv.flash > 0 ? 1 : bv.heat;
      const tint = bv.flash > 0 ? 0xff7a5a : hot > 0.05 ? 0xffd9a0 : 0xfff1c4;
      bv.cone.setRotation(a).setTint(tint).setAlpha(0.28 + 0.2 * hot);
      bv.core.setRotation(a).setAlpha(0.18 + 0.2 * hot);
      bv.head.setRotation(a);
      const lx = bv.b.lamp.x + Math.sin(a) * 4;
      const ly = bv.b.lamp.y - Math.cos(a) * 4;
      bv.lens.setPosition(lx, ly).setScale(1 + 0.4 * hot);
      bv.cone.setPosition(lx, ly);
      bv.core.setPosition(lx, ly);
    }
  }

  private syncDrafts(dt: number): void {
    const s = dt / 1000;
    const calm = calmMotion();
    this.drafts.forEach((d, i) => {
      const v = VENTS[i];
      d.column.setAlpha(0.12 + 0.05 * Math.sin(this.time.now / 300 + i));
      for (const st of d.streaks) {
        st.y -= st.v * s;
        if (st.y < GLIDE.CEIL) {
          st.y = v.y - 10;
          st.x = v.x + (Math.random() - 0.5) * v.half * 1.5;
          st.v = 340 + Math.random() * 260;
        }
        const u = (v.y - st.y) / (v.y - GLIDE.CEIL);
        st.img.setPosition(st.x + (calm ? 0 : Math.sin(st.y / 60) * 6), st.y).setAlpha(0.42 * Math.sin(Math.min(1, u) * Math.PI)).setScale(1, 0.8 + 0.4 * (1 - u));
      }
      d.puffT -= dt;
      if (d.puffT <= 0) {
        d.puffT = LITE ? 700 : 420;
        this.fx.vfx('smoke', v.x + (Math.random() - 0.5) * 40, v.y - 26, { scale: 0.32, duration: 900, alpha: 0.3, tint: 0xd8e6f5, dy: -150, depth: DEPTH.draft + 0.2 });
      }
    });
  }

  private syncGlider(g: Glider, s: number): void {
    if (g.standing) return;
    const f = g.f;
    const c = g.c;
    const air = f.mode === 'glide' || f.mode === 'dive' || f.mode === 'stun';
    let pose: Pose;
    if (f.mode === 'roof') pose = f.stunT > 0 ? 'dazed' : Math.abs(f.vx) > 60 ? 'run' : 'idle';
    else if (f.mode === 'stun') pose = 'stun';
    else if (f.mode === 'dive') pose = 'dive';
    else pose = f.rise && f.vy < -200 ? 'leap' : 'glide';
    if (this.phase === 'finished' && (pose === 'idle' || pose === 'run')) pose = g.pose ?? 'idle';
    this.setPose(g, pose);
    c.face(f.face < 0);
    // Tilt: nose down in a dive, a gentle bank while gliding, upright on a roof.
    let target = 0;
    if (f.mode === 'dive') target = f.face * Phaser.Math.Clamp(Math.atan2(f.vy, Math.abs(f.vx) + 1) * 0.75, -0.2, 0.95);
    else if (f.mode === 'glide') target = f.face * Phaser.Math.Clamp(f.vx / 2400 + f.vy / 1800, -0.18, 0.2);
    if (!this.tweens.isTweening(g)) g.tilt += (target - g.tilt) * (1 - Math.exp(-12 * s));
    c.setPosition(f.x, f.y).setRotation(g.tilt);
    // Cape: open canopy while gliding, a streamer when folded.
    const open = f.mode === 'glide' && !(f.rise && f.vy < -200) ? 1 : 0;
    g.cape += (open - g.cape) * (1 - Math.exp(-(open ? 16 : 20) * s));
    const k = CANOPY_W / 232 / CHAR_SCALE;
    g.canopy.setAlpha(Math.min(1, g.cape * 1.6)).setScale(k * (0.35 + 0.65 * g.cape), k * (0.6 + 0.4 * g.cape));
    g.canopy.setY((CANOPY_Y + (1 - g.cape) * 30) / CHAR_SCALE);
    const trail = air && f.mode !== 'stun' ? 1 - g.cape : 0;
    g.streamer.setAlpha(trail).setFlipX(f.face < 0).setOrigin(f.face < 0 ? 0 : 1, 0.4);
    g.streamer.setX((-f.face * 10) / CHAR_SCALE).setScale((1.1 + Math.min(0.6, Math.hypot(f.vx, f.vy) / 1400)) / CHAR_SCALE, 1.1 / CHAR_SCALE);
    // Badge: over the canopy while gliding, over the head otherwise; always upright.
    const want = g.cape > 0.5 ? MARK_GLIDE : MARK_HEAD;
    g.markY += (want - g.markY) * (1 - Math.exp(-10 * s));
    const badge = c.marker;
    if (badge) {
      const m = g.markY / CHAR_SCALE;
      badge.setPosition(m * Math.sin(g.tilt), m * Math.cos(g.tilt)).setRotation(-g.tilt);
    }
    // Soft shadow on the roof below, smaller and fainter the higher they fly.
    const floor = roofAt(f.x);
    const h = Math.max(0, floor - (f.y + GLIDE.BODY));
    const u = Math.min(1, h / 520);
    g.shadow.setPosition(f.x, floor + 2).setScale(0.9 - 0.5 * u, 0.28 - 0.14 * u).setAlpha(0.55 - 0.4 * u);
    // Invulnerable after a catch: flicker.
    c.setAlpha(f.invuln > 0 && f.mode !== 'stun' ? (Math.floor(this.time.now / 90) % 2 ? 0.45 : 1) : 1);
    // Speed lines behind a fast dive.
    if (s > 0 && this.phase === 'playing' && Math.hypot(f.vx, f.vy) > 620 && !calmMotion()) {
      g.trailT -= s * 1000;
      if (g.trailT <= 0) {
        g.trailT = LITE ? 90 : 45;
        this.speedLine(f.x - f.vx * 0.05, f.y - f.vy * 0.05, Math.atan2(f.vy, f.vx), PLAYER_COLORS[g.p.slot]);
      }
    }
  }

  private speedLine(x: number, y: number, ang: number, tint: number): void {
    let img = this.trails.find((t) => !t.visible);
    if (!img) {
      if (this.trails.length >= (LITE ? 12 : 28)) return;
      img = this.add.image(0, 0, 'hh-streak').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glider - 3);
      this.trails.push(img);
    }
    const im = img;
    im.setPosition(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30).setRotation(ang + Math.PI / 2).setTint(tint).setAlpha(0.7).setScale(1.4, 1).setVisible(true);
    this.tweens.add({ targets: im, alpha: 0, scaleY: 0.4, duration: 220, onComplete: () => im.setVisible(false) });
  }

  /** The searchlight alarm: a ring closing in on a glider the beam is holding, amber to red. */
  private drawAlarms(): void {
    const g = this.alarmG;
    g.clear();
    if (this.phase !== 'playing') return;
    for (const gl of this.gliders) {
      if (gl.lock <= 0) continue;
      const u = Math.min(1, gl.lock / CATCH_MS);
      const r = 86 - 44 * u;
      const col = u > 0.6 ? 0xff5a3c : 0xffc24a;
      g.lineStyle(9, 0x1a0c08, 0.35 * (0.4 + u));
      g.strokeCircle(gl.f.x, gl.f.y + 3, r);
      g.lineStyle(6, col, 0.55 + 0.45 * u);
      g.strokeCircle(gl.f.x, gl.f.y, r);
      g.fillStyle(col, 0.9);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + this.clock / 300;
        const x = gl.f.x + Math.cos(a) * r;
        const y = gl.f.y + Math.sin(a) * r;
        g.fillTriangle(x, y, x - Math.cos(a) * 16 + Math.sin(a) * 8, y - Math.sin(a) * 16 - Math.cos(a) * 8, x - Math.cos(a) * 16 - Math.sin(a) * 8, y - Math.sin(a) * 16 + Math.cos(a) * 8);
      }
    }
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      this.alarmG.clear();
      for (const g of this.gliders) {
        g.lock = 0;
        // Anyone standing on a roof goes back to standing on their feet for the finish poses.
        if (g.f.mode === 'roof') {
          g.tilt = 0;
          g.standing = true;
          standOnFeet(g.c, g.f.x, g.f.y + GLIDE.BODY);
          g.pose = 'idle';
          g.canopy.setAlpha(0);
          g.streamer.setAlpha(0);
        }
      }
    }
    super.end();
  }

  // --- CPU -------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const g = this.gliders.find((x) => x.p === p);
    if (!g) return;
    const v = this.view;
    this.live.length = 0;
    for (const c of this.clues) if (c.state !== 'gone' && (c.owner !== p.slot || c.age > 800)) this.live.push(c);
    v.claimed.clear();
    v.rivals.length = 0;
    for (const o of this.gliders) {
      if (o === g) continue;
      v.rivals.push(o.f);
      if (o.p.isCpu && o.brain.tid >= 0) v.claimed.add(o.brain.tid);
    }
    v.beamSpeed = this.beamSpeed;
    v.lock = g.lock;
    const inp = glideCpu(g.brain, g.f, v, this.skill(p), dt, Math.random, g.input);
    vc.setMove(inp.stickX, 0);
    vc.hold('A', inp.holdA || inp.pressA);
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} clue${p.score === 1 ? '' : 's'}` }));
  }
}

