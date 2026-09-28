import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { GAME_WIDTH, PLAYER_COLORS, PLAYER_COLORS_CSS } from '../../../constants';
import type { VirtualControls } from '../../../input/PlayerInput';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { kick, popToHud, shockwave } from '../../../minigames/juice';
import { bakeWord, calmMotion, WordPops } from '../../../minigames/games/stageKit';
import { LITE } from '../../../perf';
import { glyphKindFor, makeGlyph } from '../../../ui/ControllerPrompt';
import { finishAtlas, hasFrame, mixColor, queueAtlas } from '../toonsKit';
import {
  BUTTON_FOR,
  COOK_FEET_Y,
  CPU_COOK,
  FACE_BUTTONS,
  FRONT_CUT,
  INGREDIENT_FOR,
  makeMenu,
  MAX_LAYERS,
  patienceMs,
  PLATE_Y,
  pressResult,
  ROUND_MS,
  stationX,
  TICKET_TOP,
  TOPPLE_MS,
  type FaceButton,
  type Ingredient,
} from './pattyPanicLogic';

// --- Art ---------------------------------------------------------------------------------------
const IMG_KITCHEN = 'rendered-scene-toons_kitchen';
const IMG_FRONT = 'rendered-scene-toons_kitchen_front';
const ATLAS = 'rendered-toons-patty';
type Layer = Ingredient | 'bun_bottom' | 'bun_top';
/** How much each layer raises the stack (px at the stack's scale 1), from the rendered sprites. */
const THICK: Record<Layer, number> = { bun_bottom: 19, patty: 18, cheese: 7, lettuce: 9, tomato: 10, bun_top: 0 };
const PLATE_THICK = 6;
const STACK_SCALE = 0.86;
const CUSTOMERS = ['fish', 'seahorse', 'turtle', 'jelly'] as const;
const COOK_SCALE = 0.8;
const COOK_DX = -92;
const PLATE_DX = 96;
/** Ticket layout (local to the ticket: origin at its top centre). */
const TICKET_W = 262;
const PORTRAIT_Y = 64;
const PORTRAIT_R = 48;
const ROW_H = 42;
const TOPBUN_Y = PORTRAIT_Y + PORTRAIT_R + 26;
const ICON_SCALE = 0.5;
const GLYPH = 40;
const WORDS = {
  up: { key: 'pp-w-up', text: 'ORDER UP!', size: 44, fill: ['#fffbe0', '#ffd84a'] },
  oops: { key: 'pp-w-oops', text: 'OOPS!', size: 46, fill: ['#ffe1da', '#ff6b5e'] },
  slow: { key: 'pp-w-slow', text: 'TOO SLOW!', size: 40, fill: ['#eef0f4', '#9ba3b2'] },
} as const;

interface Row {
  icon: Phaser.GameObjects.Image;
  glyphs: Record<FaceButton, Phaser.GameObjects.Container>;
  check: Phaser.GameObjects.Image;
}

type StationState = 'cooking' | 'serving' | 'toppled' | 'leaving';

interface Station {
  p: MgPlayer;
  c: Character;
  x: number;
  k: number;
  recipe: Ingredient[];
  placed: number;
  patience: number;
  patienceMax: number;
  busy: number;
  state: StationState;
  customer: number;
  combo: number;
  mistakes: number;
  ticket: Phaser.GameObjects.Container;
  paper: Phaser.GameObjects.Graphics;
  ring: Phaser.GameObjects.Graphics;
  hi: Phaser.GameObjects.Graphics;
  portrait: Phaser.GameObjects.Image;
  topBun: Phaser.GameObjects.Image;
  botBun: Phaser.GameObjects.Image;
  rows: Row[];
  stack: Phaser.GameObjects.Container;
  layers: Phaser.GameObjects.Image[];
  layerN: number;
  stackH: number;
  cpuDelay: number;
  ringKey: number;
}

/**
 * Patty Panic — an undersea diner kitchen. Every cook gets the same run of tickets; press each
 * topping's button in order (X patty, A lettuce, B tomato, Y cheese) to build the burger bottom to
 * top and serve it before the customer's patience runs out. A wrong button topples the stack.
 * Most orders served in 50 s wins.
 */
export class PattyPanicScene extends BaseMinigame {
  private stations: Station[] = [];
  private menu: Ingredient[][] = [];
  private hasArt = false;
  private words!: WordPops;
  private rush = false;
  private clock = 0;
  private bubbles: { img: Phaser.GameObjects.Image; vy: number; life: number; wob: number }[] = [];
  private bubbleT = 0;
  private wrapped = false;

  constructor() {
    super('mg-patty-panic');
  }

  preload(): void {
    queueAtlas(this, ATLAS, 'toons_patty');
  }

  // --- Arena -------------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = ROUND_MS;
    this.stations = [];
    this.rush = false;
    this.clock = 0;
    this.bubbleT = 0;
    this.bubbles = [];
    this.wrapped = false;
    this.hasArt = finishAtlas(this, ATLAS);
    this.menu = makeMenu(this.rng.fork());
    this.fallbackArt();
    for (const w of Object.values(WORDS)) bakeWord(this, w.key, w.text, { size: w.size, fill: w.fill });
    this.words = new WordPops(this, 7000, 14);
    if (this.textures.exists(IMG_KITCHEN)) this.add.image(0, 0, IMG_KITCHEN).setOrigin(0).setDepth(-50);
    else this.drawFallbackKitchen(false);
    if (this.textures.exists(IMG_FRONT)) this.add.image(0, FRONT_CUT, IMG_FRONT).setOrigin(0).setDepth(1000);
    else this.drawFallbackKitchen(true);
    // bubbles drifting up past the portholes (pooled)
    for (let i = 0; i < (LITE ? 8 : 16); i++) {
      const img = this.add.image(0, 0, 'fx-dot').setTint(0xdffcff).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(-20).setVisible(false);
      this.bubbles.push({ img, vy: 0, life: 0, wob: 0 });
    }
  }

  private fallbackArt(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const tex = (key: string, w: number, h: number, draw: () => void) => {
      if (this.textures.exists(key)) return;
      g.clear();
      draw();
      g.generateTexture(key, w, h);
    };
    tex('pp-check', 44, 44, () => {
      g.fillStyle(0x1f7a3a, 1);
      g.fillCircle(22, 23, 20);
      g.fillStyle(0x3fcf6a, 1);
      g.fillCircle(22, 21, 20);
      g.lineStyle(6, 0xffffff, 1);
      g.beginPath();
      g.moveTo(11, 21);
      g.lineTo(19, 30);
      g.lineTo(33, 13);
      g.strokePath();
    });
    tex('pp-arrow', 26, 30, () => {
      g.fillStyle(0xff8a3a, 1);
      g.fillTriangle(2, 2, 24, 15, 2, 28);
    });
    const oval = (key: string, w: number, h: number, c1: number, c2: number) =>
      tex(key, w, h, () => {
        g.fillStyle(c2, 1);
        g.fillEllipse(w / 2, h / 2 + 3, w - 4, h - 6);
        g.fillStyle(c1, 1);
        g.fillEllipse(w / 2, h / 2, w - 4, h - 8);
      });
    oval('pp-bun_bottom', 140, 30, 0xf7d9a0, 0xe8a456);
    oval('pp-patty', 136, 28, 0x7a4424, 0x5e3219);
    oval('pp-cheese', 144, 16, 0xffc62b, 0xf0a818);
    oval('pp-lettuce', 150, 20, 0x8fd84c, 0x4fae3a);
    oval('pp-tomato', 130, 20, 0xff4a3a, 0xc8321f);
    tex('pp-bun_top', 144, 64, () => {
      g.fillStyle(0xe59a45, 1);
      g.fillEllipse(72, 40, 140, 56);
      g.fillRect(2, 40, 140, 20);
      g.fillStyle(0xfff6dc, 1);
      for (let i = 0; i < 8; i++) g.fillEllipse(24 + i * 14, 24 + (i % 3) * 6, 6, 3);
    });
    oval('pp-plate', 190, 30, 0xfbfbf6, 0x3fb8e8);
    for (const [k, c] of [
      ['fish', 0x5aa9ff],
      ['seahorse', 0xffc93a],
      ['turtle', 0x3fae6a],
      ['jelly', 0xff9ad5],
    ] as const)
      tex(`pp-${k}`, 100, 100, () => {
        g.fillStyle(c, 1);
        g.fillCircle(50, 55, 40);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(36, 44, 11);
        g.fillCircle(64, 44, 11);
        g.fillStyle(0x1d2433, 1);
        g.fillCircle(36, 46, 5);
        g.fillCircle(64, 46, 5);
      });
    g.destroy();
  }

  private drawFallbackKitchen(front: boolean): void {
    const g = this.add.graphics().setDepth(front ? 1000 : -50);
    if (!front) {
      g.fillStyle(0x3fb8b2, 1);
      g.fillRect(0, 0, GAME_WIDTH, 700);
      g.fillStyle(0xaab4c0, 1);
      g.fillRect(0, 547, GAME_WIDTH, 134);
      g.fillStyle(0x3a3a42, 1);
      g.fillRect(0, 547, GAME_WIDTH, 30);
      g.fillStyle(0xfff1d6, 1);
      g.fillRect(0, 681, GAME_WIDTH, 400);
      g.lineStyle(10, 0xe8b04a, 1);
      g.lineBetween(0, 112, GAME_WIDTH, 112);
      return;
    }
    g.fillStyle(0xd9a066, 1);
    g.fillRect(0, FRONT_CUT, GAME_WIDTH, 44);
    g.fillStyle(0x48c1b9, 1);
    g.fillRect(0, 840, GAME_WIDTH, 115);
    g.fillStyle(0x2f9d9a, 1);
    g.fillRect(0, 955, GAME_WIDTH, 130);
  }

  private frame(name: string): { key: string; frame?: string } {
    if (this.hasArt && hasFrame(this, ATLAS, name)) return { key: ATLAS, frame: name };
    return { key: `pp-${name}` };
  }

  private image(x: number, y: number, name: string, fallbackOrigin = 0.5): Phaser.GameObjects.Image {
    const f = this.frame(name);
    const img = this.add.image(x, y, f.key, f.frame);
    if (!f.frame) img.setOrigin(0.5, fallbackOrigin);
    return img;
  }

  private setLayer(img: Phaser.GameObjects.Image, name: string, fallbackOrigin = 0.86): void {
    const f = this.frame(name);
    img.setTexture(f.key, f.frame);
    if (!f.frame) img.setOrigin(0.5, fallbackOrigin);
  }

  // --- Players -----------------------------------------------------------------------------------
  protected createPlayer(p: MgPlayer, index: number): void {
    const n = this.players.length;
    const x = stationX(index, n);
    const c = new Character(this, x + COOK_DX, COOK_FEET_Y, p.characterId, { scale: COOK_SCALE, slot: p.slot, marker: true });
    c.face(false);
    p.character = c;
    // the plate and the stack on it
    const stack = this.add.container(x + PLATE_DX, PLATE_Y).setDepth(1100);
    const plate = this.image(0, 0, 'plate', 0.7);
    stack.add(plate);
    stack.setScale(STACK_SCALE);
    const layers: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < MAX_LAYERS + 2; i++) {
      const img = this.image(0, 0, 'bun_bottom', 0.86).setVisible(false);
      stack.add(img);
      layers.push(img);
    }
    // the order ticket
    const ticket = this.add.container(x, TICKET_TOP).setDepth(1200);
    const paper = this.add.graphics();
    const ring = this.add.graphics();
    const back = this.add.graphics();
    back.fillStyle(0x0d5a8c, 1);
    back.fillCircle(0, PORTRAIT_Y, PORTRAIT_R);
    back.fillStyle(0x6fd6e8, 1);
    back.fillCircle(0, PORTRAIT_Y - 6, PORTRAIT_R - 6);
    back.fillStyle(0xffffff, 0.25);
    back.fillEllipse(-14, PORTRAIT_Y - 26, 36, 16);
    const portrait = this.image(0, PORTRAIT_Y + 12, CUSTOMERS[index % 4]);
    const hi = this.add.graphics();
    const topBun = this.image(0, TOPBUN_Y, 'bun_top', 0.7).setScale(ICON_SCALE * 0.82).setOrigin(0.5, 0.62);
    const botBun = this.image(0, 0, 'bun_bottom', 0.7).setScale(ICON_SCALE * 0.9).setOrigin(0.5, 0.6);
    ticket.add([paper, hi, back, ring, portrait, topBun, botBun]);
    const kind = p.isCpu ? 'xbox' : glyphKindFor(p.slot);
    const rows: Row[] = [];
    for (let i = 0; i < MAX_LAYERS; i++) {
      const icon = this.image(-38, 0, 'patty', 0.7).setScale(ICON_SCALE);
      const glyphs = {} as Record<FaceButton, Phaser.GameObjects.Container>;
      for (const b of FACE_BUTTONS) {
        const gl = makeGlyph(this, b, GLYPH, kind).setPosition(72, 0).setVisible(false);
        glyphs[b] = gl;
        ticket.add(gl);
      }
      const check = this.add.image(72, 0, 'pp-check').setVisible(false);
      ticket.add([icon, check]);
      rows.push({ icon, glyphs, check });
    }
    const st: Station = {
      p,
      c,
      x,
      k: 0,
      recipe: [],
      placed: 0,
      patience: 1,
      patienceMax: 1,
      busy: 0,
      state: 'cooking',
      customer: index,
      combo: 0,
      mistakes: 0,
      ticket,
      paper,
      ring,
      hi,
      portrait,
      topBun,
      botBun,
      rows,
      stack,
      layers,
      layerN: 0,
      stackH: PLATE_THICK,
      cpuDelay: 0,
      ringKey: -1,
    };
    this.stations.push(st);
    this.buildLegend(st, kind);
    this.newOrder(st, false);
  }

  /** Each station's controls on the counter front: the four toppings and their buttons. */
  private buildLegend(st: Station, kind: ReturnType<typeof glyphKindFor>): void {
    const y = 898;
    FACE_BUTTONS.forEach((b, i) => {
      const x = st.x + (i - 1.5) * 96;
      const ing = INGREDIENT_FOR[b];
      const plate = this.add.graphics().setDepth(1105);
      plate.fillStyle(0x0a2a33, 0.32);
      plate.fillRoundedRect(x - 44, y - 46, 88, 96, 18);
      plate.lineStyle(2, 0xffffff, 0.35);
      plate.strokeRoundedRect(x - 44, y - 46, 88, 96, 18);
      this.image(x, y - 12, ing, 0.7).setScale(0.44).setOrigin(0.5, 0.6).setDepth(1106);
      makeGlyph(this, b, 34, kind).setPosition(x, y + 26).setDepth(1107);
    });
    const tag = this.add.graphics().setDepth(1105);
    tag.fillStyle(PLAYER_COLORS[st.p.slot], 1);
    tag.fillRoundedRect(st.x - 200, 848, 400, 5, 2.5);
  }

  /** Call-outs go over the floor in front of the counter, clear of the tickets and the burgers. */
  protected override bannerY(): number {
    return 990;
  }

  protected override onFinalStretch(): void {
    this.rush = true;
    this.showFinalStretch('RUSH HOUR!');
    audio.play('alarm', { volume: 0.4 });
  }

  protected override onStart(): void {
    for (const st of this.stations) st.c.play('wave');
    audio.play('confirm', { volume: 0.6 });
  }

  protected override hudLabel(p: MgPlayer): string {
    return String(p.score);
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} order${p.score === 1 ? '' : 's'}` }));
  }

  // --- Orders ------------------------------------------------------------------------------------
  /** Put up the station's next ticket (the k-th burger on the menu) and a fresh bottom bun. */
  private newOrder(st: Station, animate: boolean): void {
    const recipe = this.menu[Math.min(st.k, this.menu.length - 1)];
    st.recipe = recipe;
    st.placed = 0;
    st.patienceMax = patienceMs(recipe.length, this.elapsed);
    st.patience = st.patienceMax;
    st.state = 'cooking';
    st.customer = (st.customer + 1 + (st.k % 3)) % CUSTOMERS.length;
    this.setLayer(st.portrait, CUSTOMERS[st.customer], 0.5);
    st.portrait.setScale(this.hasArt ? 0.54 : 0.9).setTint(0xffffff).clearTint().setAngle(0).setPosition(0, PORTRAIT_Y + 10);
    const n = recipe.length;
    // rows top to bottom: the last topping first, the first one just above the bottom bun
    for (let i = 0; i < MAX_LAYERS; i++) {
      const row = st.rows[i];
      const shown = i < n;
      const ing = shown ? recipe[n - 1 - i] : 'patty';
      const y = TOPBUN_Y + 36 + i * ROW_H;
      row.icon.setVisible(shown).setY(y).setAlpha(1);
      if (shown) this.setLayer(row.icon, ing, 0.7);
      row.icon.setScale(ICON_SCALE).setOrigin(0.5, 0.6);
      for (const b of FACE_BUTTONS) row.glyphs[b].setVisible(shown && BUTTON_FOR[ing] === b).setY(y).setAlpha(1).setScale(1);
      row.check.setVisible(false).setY(y);
    }
    const botY = TOPBUN_Y + 36 + (n - 1) * ROW_H + 40;
    st.botBun.setY(botY);
    const h = botY + 30;
    this.drawPaper(st, h);
    this.drawHighlight(st);
    this.resetStack(st, animate);
    const t = st.ticket;
    this.tweens.killTweensOf(t);
    t.setAngle(0).setAlpha(1).setScale(1).setPosition(st.x, TICKET_TOP);
    if (animate) {
      t.y = -h - 40;
      this.tweens.add({ targets: t, y: TICKET_TOP, duration: 380, ease: 'Back.Out' });
      audio.play('pop', { volume: 0.35, rate: 0.8 });
    }
    st.cpuDelay = CPU_COOK[st.p.cpuLevel].read * (0.8 + Math.random() * 0.5);
  }

  private drawPaper(st: Station, h: number): void {
    const g = st.paper;
    const w = TICKET_W;
    g.clear();
    g.fillStyle(0x0a1120, 0.22);
    g.fillRoundedRect(-w / 2 + 5, 8, w, h, 14);
    g.fillStyle(0xfffaf0, 1);
    g.fillRoundedRect(-w / 2, 0, w, h, 14);
    // the player's colour along the top, a torn zig-zag along the bottom
    g.fillStyle(PLAYER_COLORS[st.p.slot], 1);
    g.fillRoundedRect(-w / 2, 0, w, 16, { tl: 14, tr: 14, bl: 0, br: 0 });
    g.fillStyle(0xe9dfcc, 1);
    for (let x = -w / 2 + 8; x < w / 2 - 8; x += 16) g.fillTriangle(x, h - 1, x + 8, h - 9, x + 16, h - 1);
    // faint ruled lines, and the brass clip on the rail
    g.lineStyle(1.5, 0xd8cdb8, 1);
    for (let y = TOPBUN_Y + 58; y < h - 40; y += ROW_H) g.lineBetween(-w / 2 + 18, y, w / 2 - 18, y);
    g.fillStyle(0xc98a1b, 1);
    g.fillRoundedRect(-24, -16, 48, 26, 7);
    g.fillStyle(0xf2c14e, 1);
    g.fillRoundedRect(-20, -14, 40, 18, 5);
  }

  /** The next topping to add: a warm bar behind its row and an arrow pointing at it. */
  private drawHighlight(st: Station): void {
    const g = st.hi;
    g.clear();
    if (st.placed >= st.recipe.length) return;
    const i = st.recipe.length - 1 - st.placed;
    const y = TOPBUN_Y + 36 + i * ROW_H;
    g.fillStyle(0xffe08a, 0.85);
    g.fillRoundedRect(-TICKET_W / 2 + 10, y - ROW_H / 2 + 2, TICKET_W - 20, ROW_H - 4, 12);
    g.fillStyle(0xff8a3a, 1);
    g.fillTriangle(-TICKET_W / 2 + 14, y - 10, -TICKET_W / 2 + 28, y, -TICKET_W / 2 + 14, y + 10);
  }

  private resetStack(st: Station, animate: boolean): void {
    for (const l of st.layers) {
      this.tweens.killTweensOf(l);
      l.setVisible(false).setAngle(0).setAlpha(1).setPosition(0, 0).setScale(1);
    }
    this.tweens.killTweensOf(st.stack);
    st.stack.setPosition(st.x + PLATE_DX, PLATE_Y).setAngle(0).setScale(STACK_SCALE).setAlpha(1);
    st.layerN = 0;
    st.stackH = PLATE_THICK;
    this.addLayer(st, 'bun_bottom', animate);
  }

  /** Drop a layer onto the stack: it falls in from above and lands with a squash. */
  private addLayer(st: Station, name: Layer, animate: boolean): void {
    const img = st.layers[st.layerN++];
    if (!img) return;
    this.setLayer(img, name);
    const y = -st.stackH;
    st.stackH += THICK[name];
    img.setVisible(true).setAlpha(1).setAngle(0).setScale(1);
    if (!animate) {
      img.setY(y);
      return;
    }
    img.setY(y - 150);
    this.tweens.add({
      targets: img,
      y,
      duration: 150,
      ease: 'Quad.In',
      onComplete: () => {
        this.tweens.add({ targets: img, scaleX: { from: 1.12, to: 1 }, scaleY: { from: 0.8, to: 1 }, duration: 160, ease: 'Back.Out' });
      },
    });
  }

  // --- Frame -------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.clock += dt;
    for (const st of this.stations) {
      if (st.busy > 0) st.busy -= dt;
      if (st.state === 'cooking') {
        st.patience -= dt * (this.rush ? 1.3 : 1);
        if (st.patience <= 0) this.leave(st);
        else if (st.busy <= 0) this.readInput(st);
      }
      this.drawRing(st);
    }
    this.ambientFx(dt);
  }

  protected override ambient(dt: number): void {
    if (this.phase === 'playing') return;
    this.clock += dt;
    for (const st of this.stations) this.drawRing(st);
    this.ambientFx(dt);
  }

  private readInput(st: Station): void {
    const c = st.p.controls;
    for (const b of FACE_BUTTONS) {
      if (!c.pressed(b)) continue;
      this.press(st, INGREDIENT_FOR[b]);
      return;
    }
  }

  private press(st: Station, ing: Ingredient): void {
    const res = pressResult(st.recipe, st.placed, ing);
    if (res === 'wrong') {
      this.topple(st);
      return;
    }
    // tick the row off and drop the topping on
    const row = st.rows[st.recipe.length - 1 - st.placed];
    for (const b of FACE_BUTTONS) row.glyphs[b].setVisible(false);
    row.check.setVisible(true).setScale(0.3);
    this.tweens.add({ targets: row.check, scale: 1, duration: 180, ease: 'Back.Out' });
    row.icon.setAlpha(0.55);
    st.placed++;
    this.addLayer(st, ing, true);
    this.drawHighlight(st);
    const rate = ing === 'patty' ? 0.75 : ing === 'lettuce' ? 1.25 : ing === 'tomato' ? 1.05 : 1.45;
    audio.play('pop', { volume: 0.5, rate });
    if (ing === 'patty') {
      audio.play('land', { volume: 0.3 });
      // a sizzle of steam off the hot patty
      if (!LITE && !calmMotion()) this.fx.vfx('smoke', st.stack.x, st.stack.y - st.stackH * STACK_SCALE - 10, { scale: 0.26, duration: 520, alpha: 0.5, dy: -36, depth: 1150 });
    }
    st.c.squash(0.08, 120);
    this.rumble(st.p, 0.08, 0.15, 40);
    if (res === 'complete') this.serve(st);
  }

  /** The last topping is on: the top bun lands, and the burger flies up to the customer. */
  private serve(st: Station): void {
    st.state = 'serving';
    st.busy = 900;
    st.hi.clear();
    this.time.delayedCall(170, () => {
      if (!st.stack.active) return;
      this.addLayer(st, 'bun_top', true);
      audio.play('confirm', { volume: 0.7 });
    });
    this.time.delayedCall(360, () => {
      if (!st.stack.active) return;
      const wx = st.ticket.x;
      const wy = st.ticket.y + PORTRAIT_Y;
      const sx = st.stack.x;
      const sy = st.stack.y - st.stackH * STACK_SCALE * 0.5;
      this.words.pop(WORDS.up.key, sx, sy - 110, { owner: st.p.slot, depth: 7000, rise: 40, hold: 480 });
      this.fx.sparks(sx, sy - 40, LITE ? 8 : 16);
      this.tweens.add({
        targets: st.stack,
        x: wx,
        y: wy + 20,
        scale: 0.28,
        angle: 12,
        duration: 340,
        ease: 'Cubic.In',
        onComplete: () => this.served(st),
      });
      audio.play('whoosh', { volume: 0.45, rate: 1.2 });
    });
  }

  private served(st: Station): void {
    // an order still in the air at the buzzer doesn't count
    if (this.phase !== 'playing') return;
    st.p.score += 1;
    st.combo += 1;
    st.stack.setVisible(false);
    const px = st.ticket.x;
    const py = st.ticket.y + PORTRAIT_Y;
    // the customer tucks in: a happy bounce, hearts and a shimmer
    this.tweens.add({ targets: st.portrait, scale: { from: st.portrait.scale * 1.3, to: st.portrait.scale }, duration: 320, ease: 'Back.Out' });
    this.fx.vfx('pinkSwirl', px, py - 20, { scale: 0.5, duration: 600, blend: 'add', depth: 7100 });
    shockwave(this, px, py, { radius: 90, color: PLAYER_COLORS[st.p.slot], alpha: 0.8, duration: 360, depth: 7050 });
    audio.play('crown', { volume: 0.6 });
    this.rumble(st.p, 0.2, 0.3, 90);
    const slot = st.p.slot;
    this.holdHud(slot, 1);
    const h = this.hudPoint(slot);
    popToHud(this, px + 60, py, '+1', h.x, h.y, { color: '#ffe36b', size: 58, onArrive: () => { this.releaseHud(slot, 1); this.bumpHud(slot); } });
    if (st.combo >= 3 && st.combo % 3 === 0) {
      const key = bakeWord(this, `pp-w-combo-${st.combo}-${slot}`, `${st.combo} IN A ROW!`, { size: 38, fill: ['#ffffff', PLAYER_COLORS_CSS[slot]] });
      this.words.pop(key, st.x + COOK_DX, COOK_FEET_Y - 250, { owner: 10 + slot, depth: 7000, rise: 40, hold: 560, tilt: -6 });
      audio.play('streak', { volume: 0.55 });
    }
    if (st.c.current === 'idle' || st.c.current === 'wave') st.c.play('celebrate');
    // the ticket is torn off and flips away; the next one drops in
    this.tweens.add({
      targets: st.ticket,
      y: st.ticket.y - 60,
      angle: 14,
      alpha: 0,
      duration: 260,
      delay: 120,
      ease: 'Quad.In',
      onComplete: () => {
        st.stack.setVisible(true);
        st.k += 1;
        if (this.phase === 'playing') this.newOrder(st, true);
      },
    });
  }

  /** A wrong button: the stack topples off the plate, and the burger starts again from the bun. */
  private topple(st: Station): void {
    st.state = 'toppled';
    st.busy = TOPPLE_MS;
    st.combo = 0;
    st.mistakes += 1;
    audio.play('error', { volume: 0.7 });
    audio.play('crack', { volume: 0.4 });
    this.rumble(st.p, 0.5, 0.3, 160);
    kick(this, 0, 5, 120);
    const sx = st.stack.x;
    const sy = st.stack.y - st.stackH * STACK_SCALE;
    this.words.pop(WORDS.oops.key, sx, sy - 70, { owner: st.p.slot, depth: 7000, rise: 40, tilt: -8 });
    st.c.play('surprised', { force: true });
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < st.layerN; i++) {
      const l = st.layers[i];
      const spread = (i + 1) * 30 * dir + (Math.random() - 0.5) * 60;
      this.tweens.add({ targets: l, x: spread, y: l.y + 260 + Math.random() * 80, angle: dir * (90 + Math.random() * 160), alpha: 0, duration: 520, ease: 'Quad.In' });
    }
    this.fx.vfx('dust', sx, st.stack.y - 10, { scale: 0.4, duration: 400, depth: 1150 });
    // rows go back to waiting
    for (let i = 0; i < st.recipe.length; i++) {
      const row = st.rows[i];
      const ing = st.recipe[st.recipe.length - 1 - i];
      row.check.setVisible(false);
      row.icon.setAlpha(1);
      for (const b of FACE_BUTTONS) row.glyphs[b].setVisible(BUTTON_FOR[ing] === b);
    }
    st.placed = 0;
    this.drawHighlight(st);
    this.tweens.add({ targets: st.ticket, angle: { from: -4, to: 0 }, duration: 300, ease: 'Elastic.Out' });
    this.time.delayedCall(TOPPLE_MS - 80, () => {
      if (st.state !== 'toppled') return;
      this.resetStack(st, true);
      st.state = 'cooking';
    });
  }

  /** Out of patience: the customer storms off, the ticket drops and the half-built burger goes. */
  private leave(st: Station): void {
    st.state = 'leaving';
    st.busy = 800;
    st.combo = 0;
    audio.play('cancel', { volume: 0.7 });
    st.portrait.setTint(0xff8a80);
    this.words.pop(WORDS.slow.key, st.ticket.x, st.ticket.y + PORTRAIT_Y + 40, { owner: st.p.slot, depth: 7000, rise: 30, hold: 520 });
    st.c.play('disappointed', { force: true });
    this.tweens.add({ targets: st.stack, x: st.stack.x + 260, alpha: 0, duration: 420, ease: 'Quad.In' });
    this.tweens.add({
      targets: st.ticket,
      y: st.ticket.y + 520,
      angle: -24,
      alpha: 0,
      duration: 560,
      delay: 180,
      ease: 'Quad.In',
      onComplete: () => {
        st.k += 1;
        if (this.phase === 'playing') this.newOrder(st, true);
      },
    });
  }

  /** The patience ring round the customer: green, then amber, then red and throbbing. */
  private drawRing(st: Station): void {
    const u = st.state === 'cooking' ? Math.max(0, st.patience / st.patienceMax) : st.state === 'leaving' ? 0 : Math.max(0, st.patience / st.patienceMax);
    const q = Math.round(u * 90);
    const low = u < 0.28;
    const pulse = low && !calmMotion() ? Math.floor(this.clock / 140) % 2 : 0;
    const key = q * 2 + pulse;
    if (key !== st.ringKey) {
      st.ringKey = key;
      const g = st.ring;
      g.clear();
      g.lineStyle(10, 0x0a1120, 0.25);
      g.strokeCircle(0, PORTRAIT_Y, PORTRAIT_R + 7);
      const col = u > 0.55 ? mixColor(0xffd23f, 0x3fcf6a, (u - 0.55) / 0.45) : u > 0.28 ? mixColor(0xff5a4a, 0xffd23f, (u - 0.28) / 0.27) : pulse ? 0xffffff : 0xff4a3a;
      if (u > 0) {
        g.lineStyle(9, col, 1);
        g.beginPath();
        g.arc(0, PORTRAIT_Y, PORTRAIT_R + 7, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2, false);
        g.strokePath();
      }
    }
    // the ticket trembles when time is nearly up (the customer is getting cross)
    if (st.state === 'cooking' && low && !calmMotion()) st.portrait.x = Math.sin(this.clock * 0.07) * 3;
    else if (st.state === 'cooking') st.portrait.x = 0;
    // the stack sways a touch as it grows
    if (st.state === 'cooking' && !calmMotion()) st.stack.angle = Math.sin(this.clock * 0.004 + st.x) * Math.min(3, st.layerN * 0.5);
  }

  /** Bubbles rising past the portholes and off the grill. */
  private ambientFx(dt: number): void {
    if (calmMotion()) return;
    this.bubbleT -= dt;
    if (this.bubbleT <= 0) {
      this.bubbleT = LITE ? 380 : 200;
      const b = this.bubbles.find((q) => q.life <= 0);
      if (b) {
        b.life = 2600 + Math.random() * 1400;
        b.vy = 60 + Math.random() * 60;
        b.wob = Math.random() * 6;
        b.img.setPosition(Math.random() * GAME_WIDTH, 560 + Math.random() * 60).setScale(0.18 + Math.random() * 0.3).setAlpha(0).setVisible(true);
      }
    }
    for (const b of this.bubbles) {
      if (b.life <= 0) continue;
      b.life -= dt;
      b.img.y -= (b.vy * dt) / 1000;
      b.img.x += Math.sin(this.clock * 0.003 + b.wob) * 0.4;
      b.img.setAlpha(Math.min(0.55, b.life / 900, (4000 - b.life) / 600));
      if (b.life <= 0) b.img.setVisible(false);
    }
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      for (const st of this.stations) st.hi.clear();
    }
    super.end();
  }

  // --- CPU ---------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const st = this.stations.find((s) => s.p === p);
    if (!st || st.state !== 'cooking' || st.busy > 0) return;
    st.cpuDelay -= dt;
    if (st.cpuDelay > 0) return;
    const cfg = CPU_COOK[p.cpuLevel];
    const want = st.recipe[st.placed];
    let b = BUTTON_FOR[want];
    if (Math.random() < cfg.slip) {
      const others = FACE_BUTTONS.filter((x) => x !== b);
      b = others[Math.floor(Math.random() * others.length)];
    }
    vc.tap(b);
    st.cpuDelay = cfg.press * (0.75 + Math.random() * 0.55);
  }
}
