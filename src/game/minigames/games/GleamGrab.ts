import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { Character } from '../../characters/Character';
import { GAME_WIDTH } from '../../constants';
import { CHARACTERS } from '../../data/characters';
import type { VirtualControls } from '../../input/PlayerInput';
import { npcFrame, type NpcId } from '../../data/npcs';
import { centerOrigin, standOrigin } from '../../util/spriteUtil';
import { BaseMinigame, type MgPlayer } from '../BaseMinigame';
import { clampRect, dist, drift, separate, steer, type Mover } from '../common';

interface Grabber extends Mover {
  p: MgPlayer;
  c: Character;
  dashT: number;
  dashCd: number;
  stunT: number;
}

type DropKind = 'chip' | 'gold' | 'capsule';

interface Drop {
  kind: DropKind;
  x: number;
  y: number;
  fallT: number;
  fallTotal: number;
  state: 'falling' | 'landed' | 'wobble' | 'gone';
  life: number;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  /** Blast radius shown on the floor while a fake capsule wobbles. */
  zone?: Phaser.GameObjects.Graphics;
}

const ARENA = { x: 250, y: 290, w: 1420, h: 640 };
const FALL_MS = 950;
const DASH_MS = 190;
const DASH_CD = 1200;

/**
 * Gleam Grab — chips rain onto the festival plaza. Collect the most in 45 seconds; golden
 * chips are worth 3; fake capsules wobble, then burst and knock players back.
 */
export class GleamGrabScene extends BaseMinigame {
  private grabbers: Grabber[] = [];
  private drops: Drop[] = [];
  private spawnT = 0;
  private showerAt = 9000;

  constructor() {
    super('mg-gleam-grab');
  }

  protected createArena(): void {
    this.duration = 45000;
    this.grabbers = [];
    this.drops = [];
    this.spawnT = 800;
    this.showerAt = 9000;
    if (this.textures.exists('rendered-scene-gleam')) {
      // Pre-rendered festival plaza on its floating island, with a cheering crowd behind the curb.
      if (this.textures.exists('rendered-sky-day')) this.add.image(GAME_WIDTH / 2, 540, 'rendered-sky-day').setDisplaySize(GAME_WIDTH * 1.04, 1124).setDepth(-100);
      this.add.image(0, 0, 'rendered-scene-gleam').setOrigin(0).setDepth(-50);
      this.buildCrowd();
      // The back wall again, drawn over the crowd so the spectators stand behind it.
      if (this.textures.exists('rendered-scene-gleam_wall')) this.add.image(0, 0, 'rendered-scene-gleam_wall').setOrigin(0).setDepth(250);
      return;
    }
    this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, 1080);
    this.add.tileSprite(0, 700, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setAlpha(0.9);
    this.add.image(960, 620, 'island-wide').setScale(1.7, 1.25).setOrigin(0.5, 0.36);
    this.add.image(960, 610, 'mg-plaza-floor').setDisplaySize(1560, 780);
    this.add.image(400, 200, 'bunting').setScale(1.1).setDepth(1);
    this.add.image(1520, 200, 'bunting').setScale(1.1).setDepth(1);
    for (const [x, y] of [
      [230, 250],
      [1690, 250],
    ]) {
      const l = this.add.image(x, y, 'lantern').setScale(0.8);
      this.tweens.add({ targets: l, angle: { from: -6, to: 6 }, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
  }

  /** Festival folk cheering from behind the back curb (bob, and hop when chips rain). */
  private crowd: Phaser.GameObjects.Sprite[] = [];

  private buildCrowd(): void {
    this.crowd = [];
    const folk: [NpcId, string, number][] = [
      ['mimi', 'happy', 262],
      ['packsprout', 'cheer', 340],
      ['ora', 'cheer', 650],
      ['pipper', 'happy', 740],
      ['wrench', 'laugh', 1185],
      ['mimi', 'laugh', 1265],
      ['packsprout', 'star', 1595],
      ['ora', 'wave', 1675],
    ];
    folk.forEach(([id, pose, x], i) => {
      const spr = this.add.sprite(x, 236, 'npcs', npcFrame(id, pose));
      const o = standOrigin('npcs', npcFrame(id, pose));
      spr.setOrigin(o.x, o.y).setScale(0.42).setDepth(200 + i * 0.01).setFlipX(x > 960);
      this.tweens.add({ targets: spr, y: 228, duration: 420 + (i % 3) * 90, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 70 });
      this.crowd.push(spr);
    });
  }

  private crowdCheer(): void {
    for (const [i, spr] of this.crowd.entries()) {
      this.tweens.add({ targets: spr, scaleY: { from: 0.36, to: 0.46 }, duration: 160, yoyo: true, repeat: 2, delay: i * 40 });
    }
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const spots = [
      [ARENA.x + 180, ARENA.y + 120],
      [ARENA.x + ARENA.w - 180, ARENA.y + 120],
      [ARENA.x + 180, ARENA.y + ARENA.h - 80],
      [ARENA.x + ARENA.w - 180, ARENA.y + ARENA.h - 80],
    ];
    const [x, y] = spots[index % 4];
    const c = new Character(this, x, y, p.characterId, { scale: 0.58, slot: p.slot, marker: true });
    c.face(x > 960);
    p.character = c;
    this.grabbers.push({ p, c, x, y, vx: 0, vy: 0, dashT: 0, dashCd: 0, stunT: 0 });
  }

  protected override onStart(): void {
    for (const g of this.grabbers) g.c.play('wave');
  }

  // --- Drops -----------------------------------------------------------------------------------
  private spawnDrop(kind: DropKind, x?: number, y?: number): void {
    const px = x ?? ARENA.x + 40 + this.rng.next() * (ARENA.w - 80);
    const py = y ?? ARENA.y + 30 + this.rng.next() * (ARENA.h - 60);
    const frame = kind === 'capsule' ? '12' : '0';
    const sprite = this.add.sprite(px, py - 700, 'items', frame);
    const o = centerOrigin('items', frame);
    sprite.setOrigin(o.x, o.y).setScale(kind === 'gold' ? 0.34 : kind === 'capsule' ? 0.28 : 0.24).setDepth(py + 1000);
    if (kind === 'capsule') sprite.play('capsule-idle');
    else sprite.play('chip-spin');
    if (kind === 'gold') sprite.setTint(0xfff1a0);
    const shadow = this.add
      .image(px, py, 'fx-contact')
      .setScale(0.15, 0.05)
      .setAlpha(0.3)
      .setDepth(py - 1);
    if (kind === 'capsule') shadow.setTint(0x6a1830);
    // Landing telegraph: a colour-coded ring that closes in on the landing spot as the drop falls
    // (danger red for fake capsules).
    const ringColor = kind === 'capsule' ? 0xff4a4a : kind === 'gold' ? 0xffe066 : 0xffc94a;
    const ring = this.add.image(px, py, 'fx-ring').setTint(ringColor).setAlpha(0.2).setScale(1.5, 0.6).setDepth(py - 0.5).setBlendMode(Phaser.BlendModes.ADD);
    this.drops.push({ kind, x: px, y: py, fallT: FALL_MS, fallTotal: FALL_MS, state: 'falling', life: 4500, sprite, shadow, ring });
  }

  private updateDrops(dt: number): void {
    for (const d of this.drops) {
      if (d.state === 'gone') continue;
      if (d.state === 'falling') {
        d.fallT -= dt;
        const t = 1 - Math.max(0, d.fallT) / d.fallTotal;
        d.sprite.y = d.y - 700 * (1 - t * t) - 20;
        d.shadow.setScale(0.15 + t * 0.62, 0.05 + t * 0.2).setAlpha(0.3 + t * 0.55);
        const rs = 1.5 - t * 0.95;
        const wob = d.kind === 'capsule' ? Math.sin(t * 40) * 0.06 : 0;
        d.ring.setScale(rs + wob, (rs - wob) * 0.4).setAlpha(0.25 + t * 0.7);
        if (d.fallT <= 0) {
          d.ring.destroy();
          d.sprite.y = d.y - 20;
          audio.play(d.kind === 'capsule' ? 'land' : 'pop', { volume: 0.4, throttleMs: 50 });
          this.fx.vfx('dust', d.x, d.y, { scale: 0.25, duration: 360, alpha: 0.6 });
          this.tweens.add({ targets: d.sprite, y: d.y - 44, duration: 150, yoyo: true, ease: 'Quad.Out' });
          if (d.kind === 'capsule') {
            d.state = 'wobble';
            d.life = 900;
            this.tweens.add({ targets: d.sprite, angle: { from: -14, to: 14 }, duration: 70, yoyo: true, repeat: -1 });
            d.sprite.setTint(0xff9a9a);
            // Show the blast radius on the floor while it wobbles.
            const zone = this.add.graphics({ x: d.x, y: d.y }).setDepth(d.y - 2);
            zone.fillStyle(0xff3b3b, 0.18);
            zone.fillEllipse(0, 0, 340, 150);
            zone.lineStyle(5, 0xff5a4a, 0.9);
            zone.strokeEllipse(0, 0, 340, 150);
            zone.lineStyle(3, 0xffffff, 0.5);
            zone.strokeEllipse(0, 0, 300, 130);
            zone.setScale(0.3);
            this.tweens.add({ targets: zone, scale: 1, duration: 180, ease: 'Back.Out' });
            this.tweens.add({ targets: zone, alpha: { from: 1, to: 0.45 }, duration: 110, yoyo: true, repeat: -1 });
            d.zone = zone;
          } else d.state = 'landed';
        }
      } else if (d.state === 'landed') {
        d.life -= dt;
        if (d.life < 1000) d.sprite.setAlpha(Math.floor(d.life / 120) % 2 ? 0.35 : 1);
        if (d.life <= 0) this.removeDrop(d);
      } else if (d.state === 'wobble') {
        d.life -= dt;
        if (d.life <= 0) this.burst(d);
      }
    }
    this.drops = this.drops.filter((d) => d.state !== 'gone');
  }

  private removeDrop(d: Drop): void {
    d.state = 'gone';
    this.tweens.killTweensOf(d.sprite);
    d.sprite.destroy();
    d.shadow.destroy();
    if (d.ring.active) d.ring.destroy();
    if (d.zone) {
      this.tweens.killTweensOf(d.zone);
      d.zone.destroy();
    }
  }

  private burst(d: Drop): void {
    audio.play('explosion', { volume: 0.7 });
    this.fx.vfx('explosion', d.x, d.y - 40, { scale: 0.55, duration: 500 });
    this.fx.shake(0.006, 180);
    for (const g of this.grabbers) {
      const dd = dist(g.x, g.y, d.x, d.y);
      if (dd < 170) {
        const ang = Math.atan2(g.y - d.y, g.x - d.x);
        const weight = CHARACTERS[g.p.characterId].handling.weight;
        const force = 1050 / weight;
        g.vx = Math.cos(ang) * force;
        g.vy = Math.sin(ang) * force * 0.7;
        g.stunT = 750;
        g.c.play('stunned', { returnTo: 'idle' });
        audio.play('hit');
        this.rumble(g.p, 0.6, 0.4, 220);
      }
    }
    this.removeDrop(d);
  }

  private collect(g: Grabber, d: Drop): void {
    const value = d.kind === 'gold' ? 3 : 1;
    g.p.score += value;
    audio.play('chipGain', { rate: d.kind === 'gold' ? 0.8 : 1 + Math.random() * 0.15, throttleMs: 30 });
    this.fx.floatText(d.x, d.y - 80, `+${value}`, d.kind === 'gold' ? '#fff1a0' : '#ffffff', {
      size: d.kind === 'gold' ? 58 : 46,
      rise: 80,
      duration: 750,
      stroke: d.kind === 'gold' ? '#8a4b00' : '#b86e00',
    });
    if (d.kind === 'gold') {
      this.fx.sparks(d.x, d.y - 40, 18);
      g.c.play('celebrate');
    }
    this.rumble(g.p, 0.1, 0.2, 50);
    const spr = d.sprite;
    d.state = 'gone';
    d.shadow.destroy();
    if (d.ring.active) d.ring.destroy();
    this.tweens.killTweensOf(spr);
    this.tweens.add({ targets: spr, x: g.x, y: g.y - 150, scale: 0.08, alpha: 0.2, duration: 200, ease: 'Quad.In', onComplete: () => spr.destroy() });
  }

  // --- Frame -----------------------------------------------------------------------------------
  protected tick(dt: number): void {
    // Spawning gets busier over time.
    this.spawnT -= dt;
    const progress = this.elapsed / this.duration;
    if (this.spawnT <= 0) {
      this.spawnT = 620 - progress * 300;
      const roll = this.rng.next();
      const capChance = 0.1 + progress * 0.1;
      this.spawnDrop(roll < capChance ? 'capsule' : roll < capChance + 0.09 ? 'gold' : 'chip');
      if (this.players.length > 2 && this.rng.chance(0.35)) this.spawnDrop('chip');
    }
    if (this.elapsed > this.showerAt) {
      this.showerAt += 11000;
      const cx = ARENA.x + 200 + this.rng.next() * (ARENA.w - 400);
      const cy = ARENA.y + 150 + this.rng.next() * (ARENA.h - 300);
      audio.play('cheer', { volume: 0.5 });
      for (let i = 0; i < 7; i++) this.spawnDrop(i === 3 ? 'gold' : 'chip', cx + Math.cos(i) * 130, cy + Math.sin(i * 1.7) * 90);
      this.crowdCheer();
    }
    this.updateDrops(dt);
    // Players
    for (const g of this.grabbers) {
      const c = g.p.controls;
      const hand = CHARACTERS[g.p.characterId].handling;
      g.dashCd = Math.max(0, g.dashCd - dt);
      if (g.stunT > 0) {
        g.stunT -= dt;
        drift(g, dt, 5);
      } else if (g.dashT > 0) {
        g.dashT -= dt;
        drift(g, dt, 2);
        if (Math.random() < 0.5) this.fx.vfx('dust', g.x, g.y, { scale: 0.18, duration: 300, alpha: 0.5 });
        if (g.dashT <= 0) g.c.play('run');
      } else {
        steer(g, c.moveX, c.moveY, dt, { maxSpeed: 440 * hand.speed, accel: 15 * hand.accel, friction: 8 });
        if (c.pressed('A') && g.dashCd <= 0) {
          const mx = c.moveX || (g.c.isFacingLeft ? -1 : 1);
          const my = c.moveY;
          const m = Math.hypot(mx, my) || 1;
          g.vx = (mx / m) * 1150 * hand.speed;
          g.vy = (my / m) * 1150 * hand.speed * 0.8;
          g.dashT = DASH_MS;
          g.dashCd = DASH_CD;
          g.c.play('dash', { force: true });
          audio.play('whoosh', { volume: 0.6 });
          this.rumble(g.p, 0.2, 0.3, 80);
        }
      }
      clampRect(g, ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    }
    for (let i = 0; i < this.grabbers.length; i++) {
      for (let j = i + 1; j < this.grabbers.length; j++) {
        const a = this.grabbers[i];
        const b = this.grabbers[j];
        separate(a, b, 78, CHARACTERS[a.p.characterId].handling.weight, CHARACTERS[b.p.characterId].handling.weight);
      }
    }
    // Pickups (a chip can be snatched just as it lands).
    for (const d of this.drops) {
      if (d.kind === 'capsule' || d.state === 'gone') continue;
      if (d.state === 'falling' && d.fallT > 110) continue;
      let best: Grabber | null = null;
      let bestD = 66;
      for (const g of this.grabbers) {
        if (g.stunT > 0) continue;
        const dd = dist(g.x, g.y, d.x, d.y);
        if (dd < bestD) {
          bestD = dd;
          best = g;
        }
      }
      if (best) this.collect(best, d);
    }
    this.syncVisuals();
  }

  private syncVisuals(): void {
    for (const g of this.grabbers) {
      g.c.setPosition(g.x, g.y).setDepth(g.y);
      if (Math.abs(g.vx) > 40) g.c.face(g.vx < 0);
      if (g.stunT <= 0 && g.dashT <= 0) {
        const moving = Math.hypot(g.vx, g.vy) > 70;
        if (moving && g.c.current !== 'run') g.c.play('run');
        else if (!moving && g.c.current === 'run') g.c.play('idle');
      }
    }
  }

  protected override ambient(): void {
    if (this.phase !== 'playing') this.syncVisuals();
  }

  // --- CPU -------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const g = this.grabbers.find((x) => x.p === p);
    if (!g) return;
    const sk = this.skill(p);
    const b = p.brain;
    b.timer -= dt;
    if (b.timer <= 0) {
      b.timer = sk.think * (0.8 + Math.random() * 0.4);
      b.target = undefined;
      b.mode = 'seek';
      // Danger first: flee wobbling capsules.
      const danger = this.drops.find((d) => d.kind === 'capsule' && (d.state === 'wobble' || d.fallT < 500) && dist(g.x, g.y, d.x, d.y) < 200);
      if (danger && Math.random() < sk.accuracy + 0.1) {
        const ang = Math.atan2(g.y - danger.y, g.x - danger.x);
        b.target = { x: g.x + Math.cos(ang) * 260, y: g.y + Math.sin(ang) * 260 };
        b.mode = 'flee';
      } else if (Math.random() < sk.mistake) {
        b.target = { x: ARENA.x + Math.random() * ARENA.w, y: ARENA.y + Math.random() * ARENA.h };
      } else {
        let best: Drop | null = null;
        let bestScore = -Infinity;
        for (const d of this.drops) {
          if (d.kind === 'capsule' || d.state === 'gone') continue;
          const dd = dist(g.x, g.y, d.x, d.y);
          const eta = (dd / 440) * 1000;
          if (d.state === 'falling' && eta < d.fallT - 400) continue;
          const value = d.kind === 'gold' ? 3 : 1;
          // Rivals closer to it make it less attractive.
          const rival = Math.min(...this.grabbers.filter((o) => o !== g).map((o) => dist(o.x, o.y, d.x, d.y)), 9999);
          const score = value * 300 - dd - (rival < dd ? 120 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = d;
          }
        }
        if (best) b.target = { x: best.x, y: best.y };
      }
      if (b.target && b.mode === 'seek' && g.dashCd <= 0 && dist(g.x, g.y, b.target.x, b.target.y) > 280 && Math.random() < sk.accuracy * 0.6) b.n = 1;
    }
    const t = b.target;
    if (!t || g.stunT > 0) {
      vc.setMove(0, 0);
      return;
    }
    const dx = t.x - g.x;
    const dy = t.y - g.y;
    const dd = Math.hypot(dx, dy);
    if (dd < 18) vc.setMove(0, 0);
    else {
      const noise = sk.aimNoise * 0.3;
      vc.setMove(dx / dd + (Math.random() - 0.5) * noise, dy / dd + (Math.random() - 0.5) * noise);
    }
    if (b.n === 1) {
      b.n = 0;
      vc.tap('A');
    }
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} chips` }));
  }
}
