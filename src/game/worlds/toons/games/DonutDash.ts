import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { CSS, GAME_WIDTH, PLAYER_COLORS, PLAYER_SHAPES } from '../../../constants';
import { CHARACTERS } from '../../../data/characters';
import { HERO_DATA } from '../../../data/heroSprites.generated';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { clampRect, dist, drift, separate, steer, type Mover } from '../../../minigames/common';
import { banner, kick, popToHud, punch, shockwave, titleTexture, type HudPop } from '../../../minigames/juice';
import { burst, ensureArenaFxTextures, RingPool, Spray } from '../../../minigames/games/arenaFx';
import { bakeWord, calmMotion, WordPops } from '../../../minigames/games/stageKit';
import { LITE } from '../../../perf';
import { drawPlayerShape } from '../../../ui/PlayerBadge';
import { finishAtlas, hasFrame, queueAtlas } from '../toonsKit';
import {
  BELT_END_Y,
  BELT_GAP,
  BELT_GROUND_Y,
  BELT_TOP_Y,
  BELT_X,
  beltSpeed,
  bestTarget,
  catches,
  DROP_MS,
  FLIGHT_MS,
  FLOOR,
  inCatch,
  isBad,
  landingPoint,
  MARK_MS,
  pickItem,
  ROUND_MS,
  scoreDelta,
  spawnRate,
  speedStep,
  STUN_MS,
  type Pick,
  type Target,
} from './donutDashLogic';

// --- Art ---------------------------------------------------------------------------------------
const IMG_FACTORY = 'rendered-scene-toons_donut';
const ATLAS = 'rendered-toons-donut';
const DONUT_FRAMES = ['donut_cyan', 'donut_coral', 'donut_green', 'donut_amber'] as const;
const CHAR_SCALE = 0.64;
const ITEM_SCALE = 0.9;
const BOX_SCALE = 0.6;
/** How far above the feet an item is caught (box height). */
const CATCH_LIFT = 78;
const FLIGHT_ARC = 110;
const BELT_LEN = BELT_END_Y - BELT_TOP_Y;
const DASH_MS = 190;
const DASH_CD = 1000;
const PILE = 4;
/** After a hit, how long (game ms, beyond the stun) before the player can be hit again. */
const GUARD_MS = 600;
const POP_SIZE = 56;
const WORDS = {
  bleh: { key: 'dd-w-bleh', text: 'BLEH!', size: 44, fill: ['#eaffdc', '#6cc24a'] },
  burnt: { key: 'dd-w-burnt', text: 'BURNT!', size: 42, fill: ['#e6e0dc', '#6b5a50'] },
  sweet: { key: 'dd-w-sweet', text: 'SWEET!', size: 46, fill: ['#fff0fa', '#ff7ad0'] },
  bump: { key: 'dd-w-bump', text: 'BUMP!', size: 40, fill: ['#e9f7ff', '#6fc8ff'] },
} as const;

type ItemState = 'belt' | 'fly' | 'fall' | 'splat';

interface Item {
  active: boolean;
  pick: Pick;
  belt: number;
  u: number;
  state: ItemState;
  t: number;
  landX: number;
  landY: number;
  marked: boolean;
  spin: number;
  spr: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  mark: Phaser.GameObjects.Image;
}

interface Catcher extends Mover {
  p: MgPlayer;
  c: Character;
  colour: number;
  box: Phaser.GameObjects.Image;
  pile: Phaser.GameObjects.Image[];
  carry: [number, number];
  dashT: number;
  dashCd: number;
  stun: number;
  /** Game ms before this player can be hit again (no chain-stuns: a hit gives a short grace). */
  guard: number;
  step: number;
  pop?: { h: HudPop; value: number };
  boxDown: boolean;
}

/**
 * Donut Dash — five belts roll donuts down from the ovens and toss them out over the factory
 * floor. Catch the ones frosted in your colour (rainbow ones count double for anyone), dodge the
 * broccoli and the burnt ones; A dashes (and bumps rivals off a good spot). The belts speed up.
 * Most donuts after 45 s wins.
 */
export class DonutDashScene extends BaseMinigame {
  private catchers: Catcher[] = [];
  private items: Item[] = [];
  private hasArt = false;
  private spawnT = 0;
  private rush = false;
  private step = 0;
  private cleatOff = [0, 0, 0, 0, 0];
  private cleats!: Phaser.GameObjects.Graphics;
  private words!: WordPops;
  private rings!: RingPool;
  private crumbs?: Spray;
  private sparkle?: Spray;
  private colours: number[] = [];
  private targets: Target[] = Array.from({ length: 48 }, () => ({ x: 0, y: 0, t: 0, value: 0 }));
  private wrapped = false;

  constructor() {
    super('mg-donut-dash');
  }

  preload(): void {
    queueAtlas(this, ATLAS, 'toons_donut');
  }

  // --- Arena -------------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = ROUND_MS;
    this.catchers = [];
    this.items = [];
    this.spawnT = 900;
    this.rush = false;
    this.step = 0;
    this.cleatOff = [0, 0, 0, 0, 0];
    this.wrapped = false;
    this.colours = this.launch.players.map((p) => p.slot);
    this.hasArt = finishAtlas(this, ATLAS);
    ensureArenaFxTextures(this);
    this.fallbackArt();
    for (const w of Object.values(WORDS)) bakeWord(this, w.key, w.text, { size: w.size, fill: w.fill });
    for (const t of ['+1', '+2', '-1']) titleTexture(this, t, POP_SIZE, t === '-1' ? '#ff9d8f' : '#ffe36b');
    this.words = new WordPops(this, 7000, 14);
    this.rings = new RingPool(this, 12);
    if (this.textures.exists(IMG_FACTORY)) this.add.image(0, 0, IMG_FACTORY).setOrigin(0).setDepth(-50);
    else this.drawFallbackFactory();
    this.cleats = this.add.graphics().setDepth(2);
    this.crumbs = new Spray(this, 'fx-dot', { depth: 900, reserve: LITE ? 30 : 70, lifespan: [300, 560], gravity: 900, scale: { start: 0.5, end: 0.1 }, tint: [0xe8a456, 0xf0bb70, 0xc9803c] });
    this.sparkle = new Spray(this, 'fx-dot', { depth: 6500, reserve: LITE ? 30 : 80, lifespan: [300, 600], gravity: 300, scale: { start: 0.6, end: 0 }, tint: [0xff7ab8, 0xffe066, 0x5ce1ff, 0x8bd346, 0xffffff], add: true });
    this.drawCleats(0);
  }

  private fallbackArt(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const tex = (key: string, w: number, h: number, draw: () => void) => {
      if (this.textures.exists(key)) return;
      g.clear();
      draw();
      g.generateTexture(key, w, h);
    };
    const donut = (key: string, frost: number) =>
      tex(key, 100, 70, () => {
        g.fillStyle(0xc9803c, 1);
        g.fillEllipse(50, 40, 96, 58);
        g.fillStyle(frost, 1);
        g.fillEllipse(50, 34, 86, 46);
        g.fillStyle(0xc9803c, 1);
        g.fillEllipse(50, 34, 28, 14);
      });
    DONUT_FRAMES.forEach((k, i) => donut(`dd-${k}`, PLAYER_COLORS[i]));
    donut('dd-donut_rainbow', 0xfffaf2);
    donut('dd-donut_burnt', 0x3a2418);
    tex('dd-broccoli', 90, 90, () => {
      g.fillStyle(0xa8d86a, 1);
      g.fillRect(38, 50, 16, 36);
      g.fillStyle(0x3f9b33, 1);
      for (const [x, y] of [
        [30, 40],
        [60, 40],
        [45, 26],
        [45, 48],
      ])
        g.fillCircle(x, y, 20);
    });
    tex('dd-box', 120, 80, () => {
      g.fillStyle(0xd8d4ca, 1);
      g.fillRect(4, 20, 112, 58);
      g.fillStyle(0xfbfaf6, 1);
      g.fillRect(4, 30, 112, 48);
    });
    tex('dd-mark', 128, 128, () => {
      g.lineStyle(16, 0x1a1a2a, 0.45);
      g.strokeCircle(64, 64, 54);
      g.lineStyle(10, 0xffffff, 1);
      g.strokeCircle(64, 64, 54);
      g.fillStyle(0xffffff, 0.22);
      g.fillCircle(64, 64, 54);
    });
    // a donut's marker carries its owner's shape too (colour is never the only cue)
    PLAYER_SHAPES.forEach((shape, i) =>
      tex(`dd-mark-s${i}`, 128, 128, () => {
        g.lineStyle(16, 0x1a1a2a, 0.45);
        g.strokeCircle(64, 64, 54);
        g.lineStyle(10, 0xffffff, 1);
        g.strokeCircle(64, 64, 54);
        g.fillStyle(0xffffff, 0.22);
        g.fillCircle(64, 64, 54);
        drawPlayerShape(g, shape, 64, 66, 24, 0xffffff, 0x1a1a2a, 6);
      }),
    );
    tex('dd-mark-bad', 128, 128, () => {
      g.lineStyle(16, 0x1a1a2a, 0.45);
      g.strokeCircle(64, 64, 54);
      g.lineStyle(10, 0xffffff, 1);
      g.strokeCircle(64, 64, 54);
      g.lineStyle(14, 0xffffff, 1);
      g.lineBetween(38, 38, 90, 90);
      g.lineBetween(90, 38, 38, 90);
    });
    g.destroy();
  }

  private drawFallbackFactory(): void {
    const g = this.add.graphics().setDepth(-50);
    g.fillStyle(0xfff3dc, 1);
    g.fillRect(0, 0, GAME_WIDTH, 300);
    for (let y = 300; y < 1080; y += 64) {
      for (let x = 0; x < GAME_WIDTH; x += 64) {
        g.fillStyle(((x + y) / 64) % 2 ? 0xffc2d6 : 0xfff4e8, 1);
        g.fillRect(x, y, 64, 64);
      }
    }
    for (const bx of BELT_X) {
      g.fillStyle(0x7fd8c8, 1);
      g.fillRoundedRect(bx - 110, 90, 220, 110, 24);
      g.fillStyle(0xff9a3c, 1);
      g.fillRect(bx - 70, 150, 140, 40);
      g.fillStyle(0x3b4150, 1);
      g.fillRect(bx - 65, BELT_TOP_Y, 130, BELT_LEN);
      g.fillStyle(0xff8fb1, 1);
      g.fillRect(bx - 72, BELT_TOP_Y, 7, BELT_LEN);
      g.fillRect(bx + 65, BELT_TOP_Y, 7, BELT_LEN);
    }
  }

  private frame(name: string): { key: string; frame?: string } {
    if (this.hasArt && hasFrame(this, ATLAS, name)) return { key: ATLAS, frame: name };
    return { key: `dd-${name}` };
  }

  private itemFrame(p: Pick): string {
    if (p.kind === 'donut') return DONUT_FRAMES[p.colour];
    if (p.kind === 'rainbow') return 'donut_rainbow';
    if (p.kind === 'burnt') return 'donut_burnt';
    return 'broccoli';
  }

  // --- Players -----------------------------------------------------------------------------------
  protected createPlayer(p: MgPlayer, index: number): void {
    const n = this.players.length;
    const x = 960 + (index - (n - 1) / 2) * 300;
    const y = 830 + (index % 2) * 40;
    const c = new Character(this, x, y, p.characterId, { scale: CHAR_SCALE, slot: p.slot, marker: true });
    c.face(x > 960);
    c.hold('carry');
    p.character = c;
    const bf = this.frame('box');
    const box = this.add.image(0, 0, bf.key, bf.frame).setScale(BOX_SCALE).setTint(PLAYER_COLORS[p.slot]);
    if (!bf.frame) box.setOrigin(0.5, 0.8);
    const df = this.frame(DONUT_FRAMES[p.slot]);
    const pile: Phaser.GameObjects.Image[] = [];
    for (let k = 0; k < PILE; k++) {
      const img = this.add.image(0, 0, df.key, df.frame).setScale(0.34).setVisible(false);
      if (!df.frame) img.setOrigin(0.5, 0.7);
      pile.push(img);
    }
    const pt = HERO_DATA.points[p.characterId]?.carry;
    this.catchers.push({ p, c, x, y, vx: 0, vy: 0, colour: p.slot, box, pile, carry: pt ? [pt[0], pt[1]] : [36, -100], dashT: 0, dashCd: 0, stun: 0, guard: 0, step: 0, boxDown: false });
  }

  protected override bannerY(): number {
    return 400;
  }

  protected override onStart(): void {
    audio.play('rumble', { volume: 0.4 });
  }

  protected override onFinalStretch(): void {
    this.rush = true;
    this.showFinalStretch('DONUT RUSH!');
    audio.play('cheer', { volume: 0.6 });
    this.ovenPuffs();
  }

  protected override hudLabel(p: MgPlayer): string {
    return String(p.score);
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} donut${p.score === 1 ? '' : 's'}` }));
  }

  // --- Items -------------------------------------------------------------------------------------
  private take(): Item {
    for (const it of this.items) if (!it.active) return it;
    const spr = this.add.image(0, 0, 'dd-box');
    const shadow = this.add.image(0, 0, 'fx-contact').setAlpha(0.5).setDepth(651);
    const mark = this.add.image(0, 0, 'dd-mark').setDepth(650).setVisible(false);
    const it: Item = { active: false, pick: { kind: 'donut', colour: 0 }, belt: 0, u: 0, state: 'belt', t: 0, landX: 0, landY: 0, marked: false, spin: 0, spr, shadow, mark };
    this.items.push(it);
    return it;
  }

  private spawn(): void {
    const speed = beltSpeed(this.elapsed, this.rush);
    // a belt with room at its top
    let belt = -1;
    for (let tries = 0; tries < 8 && belt < 0; tries++) {
      const b = this.rng.int(0, BELT_X.length - 1);
      if (!this.items.some((it) => it.active && it.state === 'belt' && it.belt === b && it.u < BELT_GAP)) belt = b;
    }
    if (belt < 0) return;
    const it = this.take();
    it.active = true;
    it.pick = pickItem(this.rng, this.colours, this.rush);
    it.belt = belt;
    it.u = 0;
    it.state = 'belt';
    it.t = 0;
    it.marked = false;
    it.spin = this.rng.range(-1, 1) * 420;
    const land = landingPoint(this.rng, belt, speed);
    it.landX = land.x;
    it.landY = land.y;
    const f = this.frame(this.itemFrame(it.pick));
    this.tweens.killTweensOf(it.spr);
    it.spr.setTexture(f.key, f.frame).setScale(ITEM_SCALE).setAngle(0).setAlpha(0).setVisible(true).clearTint();
    if (!f.frame) it.spr.setOrigin(0.5, 0.7);
    it.shadow.setVisible(false);
    it.mark.setVisible(false);
    // a puff of steam as it comes out of the oven
    if (!LITE && !calmMotion()) this.fx.vfx('smoke', BELT_X[belt], BELT_TOP_Y - 8, { scale: 0.22, duration: 480, alpha: 0.45, dy: -30, depth: 559 });
  }

  private release(it: Item): void {
    it.active = false;
    this.tweens.killTweensOf(it.spr);
    it.spr.setVisible(false);
    it.shadow.setVisible(false);
    it.mark.setVisible(false);
  }

  private markTexture(p: Pick): string {
    if (isBad(p)) return 'dd-mark-bad';
    return p.kind === 'donut' && this.colours.includes(p.colour) ? `dd-mark-s${p.colour}` : 'dd-mark';
  }

  private markColour(p: Pick): number {
    if (p.kind === 'donut') return PLAYER_COLORS[p.colour];
    if (p.kind === 'rainbow') return 0xffe9ff;
    return 0xff4a3a;
  }

  private stepItems(dt: number): void {
    const s = dt / 1000;
    const speed = beltSpeed(this.elapsed, this.rush);
    const du = (speed * s) / BELT_LEN;
    const markU = 1 - (MARK_MS / 1000) * (speed / BELT_LEN);
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      switch (it.state) {
        case 'belt': {
          it.u += du;
          const x = BELT_X[it.belt];
          const y = BELT_TOP_Y + it.u * BELT_LEN;
          it.spr.setPosition(x, y + 6).setDepth(560 + it.u).setAlpha(Math.min(1, it.u / 0.08));
          if (!it.marked && it.u >= markU) {
            it.marked = true;
            it.mark.setTexture(this.markTexture(it.pick)).setTint(this.markColour(it.pick)).setVisible(true);
          }
          if (it.marked) {
            const k = Math.max(0, Math.min(1, (it.u - markU) / (1 - markU)));
            const sc = (1.5 - 0.5 * k) * 0.95;
            it.mark.setPosition(it.landX, it.landY).setScale(sc, sc * 0.42).setAlpha(0.3 + 0.5 * k);
          }
          if (it.u >= 1) {
            it.state = 'fly';
            it.t = 0;
            it.shadow.setVisible(true);
            audio.play('whoosh', { volume: 0.18, rate: 1.4, throttleMs: 80 });
          }
          break;
        }
        case 'fly': {
          const u = Math.min(1, it.t / FLIGHT_MS);
          const x0 = BELT_X[it.belt];
          const y0 = BELT_END_Y - 6;
          const x1 = it.landX;
          const y1 = it.landY - CATCH_LIFT;
          const x = x0 + (x1 - x0) * u;
          const y = y0 + (y1 - y0) * u - FLIGHT_ARC * 4 * u * (1 - u);
          it.spr.setPosition(x, y).setDepth(5000).setAngle(it.spr.angle + it.spin * s).setScale(ITEM_SCALE * (1 + 0.15 * u)).setAlpha(1);
          const gx = x0 + (x1 - x0) * u;
          const gyy = BELT_GROUND_Y + (it.landY - BELT_GROUND_Y) * u;
          it.shadow.setPosition(gx, gyy).setScale(0.3 + 0.35 * u, (0.3 + 0.35 * u) * 0.34).setAlpha(0.2 + 0.4 * u);
          it.mark.setPosition(it.landX, it.landY).setScale(0.95, 0.4).setAlpha(0.85);
          if (u >= 1) this.arrive(it);
          break;
        }
        case 'fall': {
          const u = Math.min(1, it.t / DROP_MS);
          it.spr.setPosition(it.landX, it.landY - CATCH_LIFT * (1 - u * u) - 8).setAngle(it.spr.angle + it.spin * s * 0.5);
          if (u >= 1) this.splat(it);
          break;
        }
        case 'splat':
          break;
      }
    }
  }

  /** An item reaches box height: the nearest player it can land on catches it, or it drops. */
  private arrive(it: Item): void {
    let best: Catcher | null = null;
    let bestD = Infinity;
    for (const c of this.catchers) {
      if (c.stun > 0 || c.boxDown || !catches(it.pick, c.colour) || !inCatch(c.x, c.y, it.landX, it.landY)) continue;
      // just hit: a bad one drops past them (they still catch good ones once they're steady)
      if (c.guard > 0 && isBad(it.pick)) continue;
      const d = dist(c.x, c.y, it.landX, it.landY);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    it.mark.setVisible(false);
    if (best) {
      this.caught(best, it);
      return;
    }
    it.state = 'fall';
    it.t = 0;
  }

  private splat(it: Item): void {
    it.state = 'splat';
    it.shadow.setVisible(false);
    const x = it.landX;
    const y = it.landY - 8;
    if (it.pick.kind === 'broccoli') {
      audio.play('land', { volume: 0.25, throttleMs: 60 });
      this.tweens.add({ targets: it.spr, y: y - 30, duration: 140, yoyo: true, ease: 'Quad.Out' });
      this.tweens.add({ targets: it.spr, alpha: 0, delay: 300, duration: 220, onComplete: () => this.release(it) });
      return;
    }
    audio.play('splash', { volume: 0.12, throttleMs: 90 });
    audio.play('land', { volume: 0.2, throttleMs: 60 });
    this.crumbs?.fire(x, y, burst(it.pick.kind === 'burnt' ? 5 : 8), -90, 70, 120, 320);
    if (it.pick.kind === 'burnt') this.fx.vfx('smoke', x, y - 20, { scale: 0.35, duration: 520, alpha: 0.7, depth: 900 });
    this.rings.spawn(x, y + 8, 10, 46, { squash: 0.36, alpha: 0.5, ms: 280, tint: 0xf0bb70, depth: 652 });
    this.tweens.add({ targets: it.spr, scaleY: ITEM_SCALE * 0.45, scaleX: ITEM_SCALE * 1.2, angle: 0, duration: 90, ease: 'Quad.Out' });
    this.tweens.add({ targets: it.spr, alpha: 0, delay: 260, duration: 240, onComplete: () => this.release(it) });
  }

  private caught(c: Catcher, it: Item): void {
    const delta = scoreDelta(it.pick, c.colour);
    it.state = 'splat';
    it.shadow.setVisible(false);
    const bx = c.box.x;
    const by = c.box.y - 30;
    if (delta > 0) {
      c.p.score += delta;
      const rainbow = it.pick.kind === 'rainbow';
      audio.play('shop', { volume: rainbow ? 0.8 : 0.55, rate: rainbow ? 0.9 : 1.05 + Math.random() * 0.08, throttleMs: 40 });
      if (rainbow) {
        audio.play('streak', { volume: 0.6 });
        this.sparkle?.fire(bx, by, burst(18), -90, 90, 160, 420);
        this.words.pop(WORDS.sweet.key, bx, by - 70, { owner: c.p.slot, depth: 7000, rise: 44, hold: 460, tilt: -6 });
        shockwave(this, bx, by, { radius: 90, color: 0xffe9ff, alpha: 0.8, duration: 360, depth: 6900 });
      } else this.sparkle?.fire(bx, by, burst(6), -90, 60, 90, 240);
      this.rumble(c.p, 0.15, 0.25, 60);
      c.c.squash(0.1, 140);
      this.tweens.add({ targets: it.spr, x: bx, y: by + 10, scale: 0.34, angle: 0, duration: 120, ease: 'Quad.In', onComplete: () => this.release(it) });
      this.popScore(c, bx, by - 40, delta);
      this.refreshPile(c, true);
      return;
    }
    // bad luck: broccoli or a burnt one knocks a donut out of the box and leaves you dazed
    const lost = c.p.score > 0 ? 1 : 0;
    c.p.score -= lost;
    c.pop = undefined;
    this.releaseHud(c.p.slot, 9999);
    c.stun = STUN_MS[it.pick.kind];
    c.guard = c.stun + GUARD_MS;
    c.dashT = 0;
    c.vx *= 0.2;
    c.vy *= 0.2;
    const broc = it.pick.kind === 'broccoli';
    audio.play('hit', { volume: 0.6 });
    audio.play(broc ? 'cancel' : 'crack', { volume: 0.5 });
    this.rumble(c.p, 0.5, 0.4, 180);
    this.hitStop(70);
    kick(this, 0, -8, 140);
    this.words.pop((broc ? WORDS.bleh : WORDS.burnt).key, c.x, c.y - 200, { owner: c.p.slot, depth: 7000, rise: 40, tilt: 6 });
    this.fx.vfx(broc ? 'leafSwirl' : 'smoke', c.x, c.y - 150, { scale: 0.5, duration: 700, depth: 6600, blend: broc ? 'add' : 'normal' });
    c.c.play('stunned', { force: true, returnTo: 'idle' });
    if (broc) c.c.sprite.setTint(0xc8f0a8);
    this.tweens.add({ targets: it.spr, y: it.spr.y - 60, alpha: 0, angle: it.spr.angle + 200, duration: 360, ease: 'Quad.Out', onComplete: () => this.release(it) });
    if (lost) {
      this.popScore(c, bx, by - 40, -1);
      // the lost donut tumbles out of the box
      const df = this.frame(DONUT_FRAMES[c.colour]);
      const d = this.add.image(bx, by, df.key, df.frame).setScale(0.4).setDepth(5000);
      this.tweens.add({ targets: d, x: bx + (Math.random() < 0.5 ? -70 : 70), y: c.y - 4, angle: 240, duration: 420, ease: 'Quad.In', onComplete: () => {
        this.crumbs?.fire(d.x, d.y, burst(6), -90, 70, 100, 260);
        d.destroy();
      } });
      this.refreshPile(c, false);
    }
  }

  /** "+1" off the box, merging quick catches, flying to the HUD ("-1" when a donut is lost). */
  private popScore(c: Catcher, x: number, y: number, value: number): void {
    const slot = c.p.slot;
    if (value < 0) {
      this.words.pop(titleTexture(this, '-1', POP_SIZE, '#ff9d8f'), x + 40, y, { depth: 7100, rise: 50, hold: 400 });
      return;
    }
    this.holdHud(slot, value);
    const open = c.pop;
    if (open && open.h.gathering && open.h.image.active) {
      open.value += value;
      open.h.retitle(`+${open.value}`);
      return;
    }
    const h = this.hudPoint(slot);
    const entry: { h?: HudPop; value: number } = { value };
    entry.h = popToHud(this, x + 40, y, `+${value}`, h.x, h.y, {
      color: '#ffe36b',
      size: POP_SIZE,
      onArrive: () => {
        this.releaseHud(slot, entry.value);
        this.bumpHud(slot);
        if (c.pop === entry) c.pop = undefined;
      },
    });
    c.pop = entry as { h: HudPop; value: number };
  }

  /** The donuts peeking out of the box (up to four). */
  private refreshPile(c: Catcher, grow: boolean): void {
    const n = Math.min(PILE, Math.max(0, c.p.score));
    c.pile.forEach((img, k) => {
      const was = img.visible;
      img.setVisible(k < n);
      if (grow && k === n - 1 && !was && !calmMotion()) {
        img.setScale(0.5);
        this.tweens.add({ targets: img, scale: 0.34, duration: 180, ease: 'Back.Out' });
      }
    });
  }

  // --- Frame -------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    const st = speedStep(this.elapsed);
    if (st > this.step) {
      this.step = st;
      banner(this, 'SPEED UP!', { y: this.bannerY(), size: 96, color: CSS.goldLight, hold: 900, ribbon: true, sub: 'THE BELTS ARE FASTER' });
      audio.play('alarm', { volume: 0.6 });
      punch(this, 0.02, 280);
      this.ovenPuffs();
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 1000 / spawnRate(this.elapsed, this.players.length, this.rush);
      this.spawn();
    }
    this.stepItems(dt);
    for (const c of this.catchers) this.stepCatcher(c, dt);
    for (let i = 0; i < this.catchers.length; i++) {
      for (let j = i + 1; j < this.catchers.length; j++) {
        const a = this.catchers[i];
        const b = this.catchers[j];
        if (separate(a, b, 92, CHARACTERS[a.p.characterId].handling.weight, CHARACTERS[b.p.characterId].handling.weight)) this.shove(a, b);
      }
    }
    this.drawCleats(dt);
    this.syncCatchers(dt);
    this.syncFx(dt);
  }

  protected override ambient(dt: number): void {
    if (this.phase === 'playing') return;
    if (this.phase === 'countdown') this.drawCleats(dt);
    this.syncCatchers(dt);
    this.syncFx(dt);
  }

  private stepCatcher(c: Catcher, dt: number): void {
    const ctl = c.p.controls;
    const hand = CHARACTERS[c.p.characterId].handling;
    c.dashCd = Math.max(0, c.dashCd - dt);
    c.guard = Math.max(0, c.guard - dt);
    if (c.stun > 0) {
      c.stun -= dt;
      drift(c, dt, 6);
      if (c.stun <= 0) {
        c.c.sprite.clearTint();
        c.c.hold('carry');
      }
    } else if (c.dashT > 0) {
      c.dashT -= dt;
      drift(c, dt, 2);
    } else {
      steer(c, ctl.moveX, ctl.moveY, dt, { maxSpeed: 430 * hand.speed, accel: 15 * hand.accel, friction: 9 });
      if (ctl.pressed('A') && c.dashCd <= 0) {
        const mx = ctl.moveX || (c.c.isFacingLeft ? -1 : 1);
        const my = ctl.moveY;
        const m = Math.hypot(mx, my) || 1;
        c.vx = (mx / m) * 1120 * hand.speed;
        c.vy = (my / m) * 1120 * hand.speed * 0.8;
        c.dashT = DASH_MS;
        c.dashCd = DASH_CD;
        audio.play('whoosh', { volume: 0.55 });
        this.rumble(c.p, 0.2, 0.3, 70);
        this.fx.vfx('dust', c.x, c.y, { scale: 0.22, duration: 300, alpha: 0.5, depth: c.y - 1 });
      }
    }
    clampRect(c, FLOOR.x0, FLOOR.y0, FLOOR.x1 - FLOOR.x0, FLOOR.y1 - FLOOR.y0);
  }

  /** Two players bumped together: whoever was dashing sends the other skidding. */
  private shove(a: Catcher, b: Catcher): void {
    this.shoveOne(a, b);
    this.shoveOne(b, a);
  }

  private shoveOne(hitter: Catcher, other: Catcher): void {
    if (hitter.dashT <= 0 || other.stun > 0 || other.guard > 0 || other.dashT > 0) return;
    const ang = Math.atan2(other.y - hitter.y, other.x - hitter.x);
    other.vx = Math.cos(ang) * 720;
    other.vy = Math.sin(ang) * 520;
    other.stun = 240;
    other.guard = other.stun + GUARD_MS;
    hitter.dashT = 0;
    hitter.vx *= 0.3;
    hitter.vy *= 0.3;
    audio.play('hit', { volume: 0.45, rate: 1.3 });
    this.rumble(other.p, 0.4, 0.3, 120);
    this.words.pop(WORDS.bump.key, other.x, other.y - 190, { owner: 10 + other.p.slot, depth: 7000, rise: 36 });
    this.fx.vfx('impact', (hitter.x + other.x) / 2, (hitter.y + other.y) / 2 - 70, { scale: 0.36, blend: 'add', depth: 6600 });
  }

  private syncCatchers(dt: number): void {
    const calm = calmMotion();
    for (const c of this.catchers) {
      const moving = Math.hypot(c.vx, c.vy) > 60 && c.stun <= 0;
      if (Math.abs(c.vx) > 40 && c.stun <= 0) c.c.face(c.vx < 0);
      c.step = moving ? c.step + dt * 0.022 : 0;
      const bob = calm || !moving ? 0 : Math.abs(Math.sin(c.step)) * 7;
      c.c.setPosition(c.x, c.y).setDepth(c.y);
      c.c.sprite.y = -bob;
      c.c.sprite.angle = calm || !moving ? 0 : Math.sin(c.step) * 3;
      // a blink while the post-hit grace lasts
      c.c.sprite.setAlpha(c.guard > 0 && c.stun <= 0 && !c.boxDown && Math.floor(c.guard / 80) % 2 ? 0.5 : 1);
      if (!c.boxDown) {
        const left = c.c.isFacingLeft;
        const bx = c.x + (left ? -1 : 1) * c.carry[0] * CHAR_SCALE * 0.7;
        const by = c.y + c.carry[1] * CHAR_SCALE - bob + 22;
        c.box.setPosition(bx, by).setDepth(c.y + 0.5);
        for (let k = 0; k < c.pile.length; k++) {
          // two donuts at the front of the heap, two tucked in behind them
          c.pile[k].setPosition(bx - 22 + (k % 2) * 26 + (k > 1 ? 12 : 0), by - 26 - (k > 1 ? 10 : 0) - (k % 2) * 3).setDepth(c.y + 0.6 + (k > 1 ? -0.02 : 0) + k * 0.001);
        }
      }
    }
  }

  private drawCleats(dt: number): void {
    const g = this.cleats;
    g.clear();
    const speed = this.phase === 'playing' ? beltSpeed(this.elapsed, this.rush) : this.phase === 'countdown' ? 60 : 0;
    const spacing = 46;
    for (let b = 0; b < BELT_X.length; b++) {
      this.cleatOff[b] = (this.cleatOff[b] + (speed * dt) / 1000) % spacing;
      const x = BELT_X[b];
      for (let y = BELT_TOP_Y + this.cleatOff[b]; y < BELT_END_Y - 4; y += spacing) {
        const edge = Math.min(1, (y - BELT_TOP_Y) / 40, (BELT_END_Y - y) / 30);
        g.lineStyle(5, 0x5a6272, 0.9 * edge);
        g.lineBetween(x - 56, y, x + 56, y);
        g.lineStyle(2, 0x8a93a3, 0.7 * edge);
        g.lineBetween(x - 56, y - 3, x + 56, y - 3);
      }
    }
  }

  private syncFx(dt: number): void {
    const k = this.tweens.timeScale;
    this.crumbs?.sync(k);
    this.sparkle?.sync(k);
    this.rings.update(dt);
  }

  private ovenPuffs(): void {
    for (const bx of BELT_X) this.fx.vfx('smoke', bx + 55, 110, { scale: 0.45, duration: 700, alpha: 0.6, dy: -40, depth: 100 });
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      // everyone sets their box down for the finish
      for (const c of this.catchers) {
        c.boxDown = true;
        c.vx = 0;
        c.vy = 0;
        c.dashT = 0;
        c.c.sprite.clearTint().setAngle(0).setY(0);
        const side = c.c.isFacingLeft ? -1 : 1;
        this.tweens.add({ targets: c.box, x: c.x + side * 62, y: c.y + 6, duration: 220, ease: 'Quad.In' });
        c.pile.forEach((img, k) => this.tweens.add({ targets: img, x: c.x + side * 62 - 16 + (k % 2) * 22, y: c.y - 24 - (k > 1 ? 10 : 0), duration: 220, ease: 'Quad.In' }));
        c.c.play('idle', { force: true });
      }
    }
    super.end();
  }

  // --- CPU ---------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    let c: Catcher | undefined;
    for (const q of this.catchers) if (q.p === p) c = q;
    if (!c) return;
    if (c.stun > 0) {
      vc.setMove(0, 0);
      return;
    }
    const sk = this.skill(p);
    const b = p.brain;
    const speed = 430 * CHARACTERS[p.characterId].handling.speed;
    const beltV = beltSpeed(this.elapsed, this.rush);
    b.timer -= dt;
    if (b.timer <= 0) {
      b.timer = sk.think * (0.6 + Math.random() * 0.5);
      // what's coming: exact spots once their markers show, rough ones further up the belts
      let n = 0;
      let danger: { x: number; y: number } | null = null;
      for (const it of this.items) {
        if (!it.active || (it.state !== 'belt' && it.state !== 'fly') || n >= this.targets.length) continue;
        const t = it.state === 'fly' ? FLIGHT_MS - it.t : ((1 - it.u) * BELT_LEN * 1000) / beltV + FLIGHT_MS;
        const known = it.state === 'fly' || it.marked;
        const x = known ? it.landX : BELT_X[it.belt];
        const y = known ? it.landY : 830;
        if (isBad(it.pick)) {
          if (known && t < 1000 && dist(c.x, c.y, x, y) < 120 && Math.random() > sk.mistake) danger = { x, y };
          continue;
        }
        let value = catches(it.pick, c.colour) ? scoreDelta(it.pick, c.colour) : 0;
        if (!known) value *= 0.6;
        const tg = this.targets[n++];
        tg.x = x;
        tg.y = y;
        tg.t = t - sk.reaction * 0.5;
        tg.value = value;
      }
      const pick = bestTarget(c.x, c.y, speed, this.targets, n);
      if (danger) {
        const ang = Math.atan2(c.y - danger.y, c.x - danger.x);
        b.target = { x: c.x + Math.cos(ang) * 200, y: c.y + Math.sin(ang) * 140 };
        b.mode = 'flee';
      } else if (pick >= 0) {
        const tg = this.targets[pick];
        const err = sk.aimNoise * 60;
        b.target = { x: tg.x + (Math.random() - 0.5) * err, y: tg.y + (Math.random() - 0.5) * err * 0.5 };
        b.mode = 'seek';
        b.n = dist(c.x, c.y, tg.x, tg.y) > 260 && tg.t < 900 && Math.random() < sk.accuracy * 0.7 ? 1 : 0;
      } else {
        // nothing in reach: drift towards the middle of the floor
        b.target = { x: 960 + (c.colour - 1.5) * 260, y: 830 };
        b.mode = 'idle';
      }
    }
    const t = b.target;
    if (!t) {
      vc.setMove(0, 0);
      return;
    }
    const dx = t.x - c.x;
    const dy = t.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d < 14) vc.setMove(0, 0);
    else vc.setMove(dx / d, dy / d);
    if (b.n === 1 && c.dashCd <= 0) {
      b.n = 0;
      vc.tap('A');
    }
  }
}
