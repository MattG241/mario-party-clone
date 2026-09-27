import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { Character } from '../../characters/Character';
import { COLORS, CSS, GAME_WIDTH } from '../../constants';
import type { VirtualControls } from '../../input/PlayerInput';
import { makeGlyph, glyphKindFor } from '../../ui/ControllerPrompt';
import { addText } from '../../ui/theme';
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
    this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, 1080).setDepth(-100);
    this.add.tileSprite(0, 560, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setDepth(-90);
    this.add.image(CX, CY + 30, 'mg-orbit-platform').setDisplaySize(1400, 760).setDepth(-10);
    this.armG = this.add.graphics().setDepth(2);
    this.highG = this.add.graphics().setDepth(5000);
    const hub = this.add.sprite(CX, CY + 20, 'props', '19').play('barrier-spin');
    const o = standOrigin('props', '19');
    hub.setOrigin(o.x, o.y).setScale(0.8).setDepth(CY);
    this.add.image(250, 330, 'observatory').setScale(0.26).setDepth(-20).setAlpha(0.9);
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const n = this.players.length;
    const base = Math.PI / 2;
    const angle = base + (index * Math.PI * 2) / n;
    const x = CX + Math.cos(angle) * RX;
    const y = CY + Math.sin(angle) * RY;
    const c = new Character(this, x, y, p.characterId, { scale: 0.62, slot: p.slot });
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

  protected override onStart(): void {
    audio.play('rumble', { volume: 0.5 });
  }

  // --- Arms --------------------------------------------------------------------------------
  private drawArms(): void {
    const g = this.armG;
    const h = this.highG;
    g.clear();
    h.clear();
    for (const a of this.arms) {
      const tipX = CX + Math.cos(a.angle) * (RX + 120);
      const tipY = CY + Math.sin(a.angle) * (RY + 60);
      const flashing = a.flipIn > 0 && Math.floor(a.flipIn / 120) % 2 === 0;
      if (a.type === 'low') {
        // Shadow + spiked log along the ground.
        g.lineStyle(44, 0x0b1a24, 0.25);
        g.lineBetween(CX, CY + 12, tipX, tipY + 12);
        g.lineStyle(36, flashing ? 0xffffff : 0x7a4f28, 1);
        g.lineBetween(CX, CY, tipX, tipY);
        g.lineStyle(20, 0xb07a45, 1);
        g.lineBetween(CX, CY - 4, tipX, tipY - 4);
        for (let i = 1; i <= 6; i++) {
          const t = 0.22 + i * 0.13;
          const px = CX + (tipX - CX) * t;
          const py = CY + (tipY - CY) * t;
          g.fillStyle(COLORS.gold, 1);
          g.fillTriangle(px - 9, py - 8, px + 9, py - 8, px, py - 30);
        }
      } else {
        // Ground shadow so you can read where the high arm is.
        g.lineStyle(26, 0x2b2340, 0.35);
        g.lineBetween(CX, CY + 8, tipX, tipY + 8);
        const lift = 150;
        h.lineStyle(26, flashing ? 0xffffff : 0x5e3494, 1);
        h.lineBetween(CX, CY - lift, tipX, tipY - lift);
        h.lineStyle(10, 0xc49bff, 1);
        h.lineBetween(CX, CY - lift - 5, tipX, tipY - lift - 5);
        h.fillStyle(0x3a3150, 1);
        h.fillCircle(tipX, tipY - lift, 36);
        h.fillStyle(COLORS.gold, 1);
        for (let i = 0; i < 8; i++) {
          const an = (i / 8) * Math.PI * 2;
          h.fillTriangle(tipX + Math.cos(an) * 30, tipY - lift + Math.sin(an) * 30, tipX + Math.cos(an + 0.3) * 30, tipY - lift + Math.sin(an + 0.3) * 30, tipX + Math.cos(an + 0.15) * 50, tipY - lift + Math.sin(an + 0.15) * 50);
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
