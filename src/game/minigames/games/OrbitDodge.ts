import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { Character } from '../../characters/Character';
import { COLORS, CSS, GAME_WIDTH } from '../../constants';
import type { VirtualControls } from '../../input/PlayerInput';
import { makeGlyph, glyphKindFor } from '../../ui/ControllerPrompt';
import { addText } from '../../ui/theme';
import { npcFrame, type NpcId } from '../../data/npcs';
import { standOrigin } from '../../util/spriteUtil';
import { BaseMinigame, type MgPlayer } from '../BaseMinigame';

interface Dodger {
  p: MgPlayer;
  c: Character;
  angle: number;
  x: number;
  y: number;
  z: number;
  vz: number;
  ducking: boolean;
  lives: number;
  invuln: number;
  jumpBuffer: number;
  windup: number;
  warn: Phaser.GameObjects.Container;
  warnKind: 'low' | 'high' | null;
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
  /** Pre-rendered 3D arms (64 angles each); two sprites per arm cross-fade between frames. */
  private armSprites: [Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite][] = [];
  private armFrames = 0;
  private nextSpeedUp = 10000;
  private dir = 1;

  constructor() {
    super('mg-orbit-dodge');
  }

  protected createArena(): void {
    this.duration = 0;
    this.dodgers = [];
    this.omega = 1.25;
    this.nextSpeedUp = 10000;
    this.dir = 1;
    this.arms = [{ id: 0, angle: Math.PI * 0.25, type: 'low', flipIn: -1 }];
    const rendered = this.textures.exists('rendered-scene-orbit');
    if (rendered) {
      // Pre-rendered observatory rooftop (engraved stone, brass rings, crystal lights).
      const sky = ['rendered-sky-clear', 'rendered-sky-day'].find((k) => this.textures.exists(k));
      // A slightly cooler, deeper sky so the warm platform separates from the cloud sea.
      if (sky) this.add.image(GAME_WIDTH / 2, 480, sky).setDisplaySize(GAME_WIDTH * 1.12, 1210).setDepth(-100).setTint(0xd6e1ef);
      this.add.image(0, 0, 'rendered-scene-orbit').setOrigin(0).setDepth(-10);
      this.buildSpectators();
    } else {
      this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, 1080).setDepth(-100);
      this.add.tileSprite(0, 560, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setDepth(-90);
      this.add.image(CX, CY + 30, 'mg-orbit-platform').setDisplaySize(1400, 760).setDepth(-10);
    }
    this.armG = this.add.graphics().setDepth(2);
    this.highG = this.add.graphics().setDepth(5000);
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
      const spr = this.add.sprite(x, deckY + dy, 'npcs', npcFrame(id, pose));
      const o = standOrigin('npcs', npcFrame(id, pose));
      spr.setOrigin(o.x, o.y).setScale(sc).setDepth(-5 + i * 0.01).setFlipX(x > 960);
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
    this.dodgers.push({ p, c, angle, x, y, z: 0, vz: 0, ducking: false, lives: LIVES, invuln: 0, jumpBuffer: 0, windup: 0, warn, warnKind: null });
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

  // --- Arms --------------------------------------------------------------------------------
  private drawArms(): void {
    const g = this.armG;
    const h = this.highG;
    g.clear();
    h.clear();
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 110);
    const rim = (an: number, lift = 0) => ({ x: CX + Math.cos(an) * (RX + 120), y: CY - lift + Math.sin(an) * (RY + 60) });
    const wedge = (layer: Phaser.GameObjects.Graphics, a0: number, a1: number, lift: number) => {
      layer.beginPath();
      layer.moveTo(CX, CY - lift);
      for (let t = 0; t <= 8; t++) {
        const p = rim(a0 + (a1 - a0) * (t / 8), lift);
        layer.lineTo(p.x, p.y);
      }
      layer.closePath();
      layer.fillPath();
    };
    const sprites = this.armFrames > 0;
    this.armSprites.forEach((pair) => pair.forEach((sp) => sp.setVisible(false)));
    for (const [ai, a] of this.arms.entries()) {
      const low = a.type === 'low';
      const lift = low ? 0 : 150;
      const tip = rim(a.angle, lift);
      const base = { x: CX, y: CY - lift };
      const flashing = a.flipIn > 0 && Math.floor(a.flipIn / 120) % 2 === 0;
      const hue = low ? 0xff4a2a : 0xb45cff;
      const layer = low ? g : h;
      if (this.phase === 'playing') {
        // Warning wedge on the floor ahead of the sweep: where the arm is about to pass.
        const ahead = Math.min(0.85, 0.32 * this.omega);
        for (let k = 0; k < 5; k++) {
          g.fillStyle(hue, (0.14 + 0.1 * pulse) * (1 - k / 5));
          wedge(g, a.angle + this.dir * ahead * (k / 5), a.angle + this.dir * ahead * ((k + 1) / 5), 0);
        }
        // Motion smear trailing behind so speed and direction read at a glance.
        const trail = Math.min(0.55, 0.12 * this.omega);
        for (let k = 0; k < 4; k++) {
          layer.fillStyle(low ? 0xffc27a : 0xd7b0ff, 0.12 * (1 - k / 4));
          wedge(layer, a.angle - this.dir * trail * ((k + 1) / 4), a.angle - this.dir * trail * (k / 4), lift);
        }
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
        const tipY = CY + Math.sin(a.angle) * RY;
        // Depth by the tip: players the arm reaches draw over the log / under the raised beam.
        const depth = low ? tipY - 30 : tipY + 20;
        s0.setFrame(pre + String(i0).padStart(2, '0')).setAlpha(1).setDepth(depth).setVisible(true);
        s1.setFrame(pre + String(i1).padStart(2, '0')).setAlpha(t).setDepth(depth + 0.01).setVisible(true);
        for (const sp of [s0, s1]) {
          if (flashing) sp.setTintFill(0xffffff);
          else sp.clearTint();
        }
        // Pulsing danger glow on the floor under the arm keeps it readable at a glance.
        const floorTip = rim(a.angle);
        g.lineStyle(low ? 70 : 44, hue, 0.12 + 0.14 * pulse);
        g.lineBetween(CX, CY, floorTip.x, floorTip.y);
        continue;
      }
      // Ground shadow (for the high arm this is how you read where it is).
      g.lineStyle(low ? 50 : 30, 0x0b1a24, low ? 0.32 : 0.38);
      g.lineBetween(CX, CY + 14, rim(a.angle).x, rim(a.angle).y + 14);
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
      this.omega = Math.min(4.2, this.omega * 1.2);
      if (this.arms.length === 1) this.arms.push({ id: 1, angle: this.arms[0].angle + Math.PI, type: 'high', flipIn: -1 });
      else if (this.elapsed > 25000 && this.rng.chance(0.5)) {
        const a = this.rng.pick(this.arms);
        a.flipIn = 1100;
      }
      if (this.elapsed > 40000 && this.rng.chance(0.4)) this.dir *= -1;
      audio.play('eventAlert', { volume: 0.6 });
      const t = addText(this, CX, 300, 'SPEED UP!', 72, { color: CSS.goldLight, stroke: '#1b1530', strokeThickness: 10, weight: 700, fixed: true }).setDepth(9000);
      this.tweens.add({ targets: t, y: 250, alpha: 0, delay: 600, duration: 500, onComplete: () => t.destroy() });
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
          d.c.play('idle');
        }
      }
      const wantDuck = grounded && d.windup <= 0 && c.held('B');
      if (wantDuck !== d.ducking) {
        d.ducking = wantDuck;
        if (wantDuck) d.c.hold('crouch');
        else d.c.play('idle');
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
          d.p.score += 0;
          this.fx.vfx('sparkle', d.x, d.y - 120, { scale: 0.3, duration: 300, blend: 'add' });
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
    if (this.elapsed > 120000) this.end();
  }

  private hit(d: Dodger): void {
    d.lives -= 1;
    d.invuln = 1000;
    audio.play('hit');
    this.fx.vfx('impact', d.x, d.y - 100, { scale: 0.6, blend: 'add' });
    this.fx.shake(0.006, 180);
    // brief white hit flash on the character
    d.c.sprite.setTintFill(0xffffff);
    this.time.delayedCall(70, () => d.c.sprite.clearTint());
    this.rumble(d.p, 0.7, 0.5, 220);
    d.c.play('stunned', { force: true });
    this.tweens.add({ targets: d.c, alpha: { from: 0.3, to: 1 }, duration: 120, repeat: 4 });
    if (d.lives <= 0) {
      d.warn.setVisible(false);
      const out = { x: CX + Math.cos(d.angle) * (RX + 400), y: CY + Math.sin(d.angle) * (RY + 300) };
      d.c.play('fall', { force: true, returnTo: 'fall' });
      this.tweens.add({ targets: d.c, x: out.x, y: out.y + 300, alpha: 0, angle: 200, duration: 900, ease: 'Quad.In' });
      this.eliminate(d.p);
    }
  }

  protected override ambient(): void {
    if (this.phase === 'countdown') this.drawArms();
    for (const d of this.dodgers) d.c.setDepth(d.y + 10);
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
