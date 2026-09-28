import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { Character } from '../characters/Character';
import { COLORS, CSS, ECONOMY, GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { CHARACTER_IDS } from '../data/characters';
import { ITEM_IDS, ITEMS } from '../data/items';
import { NPC_ATLAS, npcFrame } from '../data/npcs';
import { input } from '../input/InputManager';
import { glyphKindFor, makeGlyph, PromptBar, type PromptButton } from '../ui/ControllerPrompt';
import { buildBackdrop, drawNavyPanel } from '../ui/Screen';
import { addGradientTitle, addText } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { centerOrigin, solidHeight, standOrigin } from '../util/spriteUtil';

/** Panel geometry (the page body is laid out inside it). */
const PX = 400;
const PY = 150;
const PW = 1400;
const PH = 790;
const HEADER = 84;

interface Page {
  title: string;
  color: number;
  ora: string;
  line: string;
  build: (s: HowToPlayScene, c: Phaser.GameObjects.Container) => void;
}

const SPACE_ROWS: [string, string, string][] = [
  ['gleam', 'Gleam Space', `+${ECONOMY.gleamSpace} chips (+${ECONOMY.gleamSpaceFinal} in the final round)`],
  ['mischief', 'Mischief', 'Something sneaky happens…'],
  ['festival', 'Festival', 'A lucky festival surprise'],
  ['market', 'Market', 'Shop for items (even passing by)'],
  ['portal', 'Portal', 'Warp to its twin portal'],
  ['relic', 'Relic Gate', 'Where the Relic Keeper waits'],
  ['event', 'Event', 'Triggers this board\'s special event'],
  ['start', 'Start', 'Where everyone begins — pays chips too'],
];

/** "How to Play": a short illustrated guide, presented by Ora. Left/right to turn pages. */
export class HowToPlayScene extends Phaser.Scene {
  private page = 0;
  private body!: Phaser.GameObjects.Container;
  private header!: Phaser.GameObjects.Graphics;
  private headerText!: Phaser.GameObjects.Text;
  private ora!: Phaser.GameObjects.Sprite;
  private bubble!: Phaser.GameObjects.Text;
  private dots!: Phaser.GameObjects.Graphics;
  private pages: Page[] = [];
  private leaving = false;

  constructor() {
    super('HowToPlay');
  }

  init(): void {
    this.page = 0;
    this.leaving = false;
  }

  create(): void {
    enterScene(this);
    audio.playMusic('menu');
    buildBackdrop(this, 'golden', 0.3);
    addGradientTitle(this, GAME_WIDTH / 2 + 180, 76, 'HOW TO PLAY', 68);
    this.pages = this.definePages();

    const g = this.add.graphics();
    drawNavyPanel(g, PX, PY, PW, PH, { radius: 30, gloss: true });
    this.header = this.add.graphics();
    this.headerText = addText(this, PX + 44, PY + HEADER / 2, '', 34, { color: '#ffffff', weight: 700, align: 'left', stroke: '#06141a', strokeThickness: 5 }).setOrigin(0, 0.5);
    this.body = this.add.container(0, 0);
    this.dots = this.add.graphics();

    // Ora presents from the left, with a speech bubble.
    const frame = npcFrame('ora', 'welcome');
    this.ora = this.add.sprite(200, 930, NPC_ATLAS, frame);
    const o = standOrigin(NPC_ATLAS, frame);
    this.ora.setOrigin(o.x, o.y).setScale(1.25);
    this.add.image(200, 934, 'fx-shadow').setScale(2.2, 0.6).setAlpha(0.45).setDepth(-1);
    this.children.bringToTop(this.ora);
    const bub = this.add.graphics();
    bub.fillStyle(0xfff8ea, 0.97);
    bub.fillRoundedRect(40, 310, 330, 250, 26);
    bub.fillTriangle(170, 556, 230, 556, 200, 600);
    bub.lineStyle(3, COLORS.gold, 1);
    bub.strokeRoundedRect(40, 310, 330, 250, 26);
    this.bubble = addText(this, 205, 435, '', 23, { color: CSS.ink, weight: 600, wrap: 290 });
    this.tweens.add({ targets: this.ora, scaleY: 1.27, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

    new PromptBar(this, GAME_WIDTH / 2 + 180, GAME_HEIGHT - 42, [
      { button: 'LEFT', label: 'Previous' },
      { button: 'RIGHT', label: 'Next' },
      { button: 'B', label: 'Back' },
    ], { size: 34, fontSize: 22 });
    this.show(0);
  }

  private definePages(): Page[] {
    return [
      { title: 'THE GOAL', color: COLORS.teal, ora: 'welcome', line: 'Welcome, adventurer! Here\'s how the Festival of the Spiral Isles works.', build: (s, c) => s.pageGoal(c) },
      { title: 'YOUR TURN', color: COLORS.gold, ora: 'point', line: 'Spin the Orbit Dial and follow the trail. Every fork is a choice!', build: (s, c) => s.pageTurn(c) },
      { title: 'BOARD SPACES', color: 0x39c7ea, ora: 'point', line: 'Where you land matters. Blue is good — purple, not so much!', build: (s, c) => s.pageSpaces(c) },
      { title: 'PRISM RELICS', color: 0x7fb4e6, ora: 'flag', line: 'Packsprout trades Relics for chips. Follow the beam of light to find him.', build: (s, c) => s.pageRelics(c) },
      { title: 'ITEMS', color: COLORS.coral, ora: 'wave', line: 'Market stalls sell handy items. Carry up to three and use them before you spin.', build: (s, c) => s.pageItems(c) },
      { title: 'MINIGAMES', color: 0x8e5cd9, ora: 'cheer', line: 'After everyone moves, it\'s minigame time! Win for a big chip prize.', build: (s, c) => s.pageMinigames(c) },
      { title: 'CONTROLS', color: 0x6cc24a, ora: 'idle', line: 'Controllers or keyboard — up to four players on one screen. Have fun!', build: (s, c) => s.pageControls(c) },
    ];
  }

  private show(i: number): void {
    const forward = i >= this.page;
    this.page = i;
    const p = this.pages[i];
    this.body.removeAll(true);
    this.header.clear();
    this.header.fillStyle(p.color, 1);
    this.header.fillRoundedRect(PX, PY, PW, HEADER, { tl: 30, tr: 30, bl: 0, br: 0 });
    this.header.fillStyle(0xffffff, 0.16);
    this.header.fillRoundedRect(PX + 10, PY + 6, PW - 20, HEADER * 0.38, { tl: 24, tr: 24, bl: 6, br: 6 });
    this.header.lineStyle(4, COLORS.gold, 1);
    this.header.strokeRoundedRect(PX, PY, PW, PH, 30);
    this.headerText.setText(`${i + 1}. ${p.title}`);
    p.build(this, this.body);
    // Pages slide in from the side you're turning towards.
    this.body.setAlpha(0);
    this.body.x = forward ? 48 : -48;
    this.tweens.killTweensOf(this.body);
    this.tweens.add({ targets: this.body, alpha: 1, x: 0, duration: 240, ease: 'Cubic.Out' });
    const frame = npcFrame('ora', p.ora);
    this.ora.setFrame(frame);
    const o = standOrigin(NPC_ATLAS, frame);
    this.ora.setOrigin(o.x, o.y);
    this.bubble.setText(p.line);
    // page dots
    const d = this.dots;
    d.clear();
    const n = this.pages.length;
    const x0 = PX + PW - 40 - (n - 1) * 30;
    for (let k = 0; k < n; k++) {
      d.fillStyle(k === i ? COLORS.goldLight : 0xfff4dc, k === i ? 1 : 0.35);
      d.fillCircle(x0 + k * 30, PY + HEADER / 2, k === i ? 10 : 7);
    }
  }

  // --- Page builders ------------------------------------------------------------------------------
  private para(c: Phaser.GameObjects.Container, x: number, y: number, text: string, size = 26, wrap = 1240, color: string = CSS.cream): Phaser.GameObjects.Text {
    const t = addText(this, x, y, text, size, { color, weight: 600, align: 'left', wrap }).setOrigin(0, 0);
    c.add(t);
    return t;
  }

  private stepCard(c: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, n: number, title: string, text: string, color: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x06141a, 0.4);
    g.fillRoundedRect(x, y, w, h, 22);
    g.lineStyle(3, color, 0.9);
    g.strokeRoundedRect(x, y, w, h, 22);
    g.fillStyle(color, 1);
    g.fillCircle(x + 38, y + 40, 24);
    c.add(g);
    c.add(addText(this, x + 38, y + 39, String(n), 28, { color: '#ffffff', weight: 700, stroke: '#06141a', strokeThickness: 4 }));
    c.add(addText(this, x + 76, y + 40, title, 26, { color: '#ffffff', weight: 700, align: 'left' }).setOrigin(0, 0.5));
    c.add(addText(this, x + 24, y + 78, text, 21, { color: CSS.cream, weight: 500, align: 'left', wrap: w - 48 }).setOrigin(0, 0));
  }

  private icon(c: Phaser.GameObjects.Container, key: string, frame: string | undefined, x: number, y: number, size: number): Phaser.GameObjects.Image | null {
    if (!this.textures.exists(key)) return null;
    const img = frame !== undefined ? this.add.image(x, y, key, frame) : this.add.image(x, y, key);
    if (frame !== undefined) {
      const o = centerOrigin(key, frame);
      img.setOrigin(o.x, o.y);
    }
    // atlas frames carry padding: size them by their visible artwork
    const extent = frame !== undefined ? solidHeight(key, frame) : Math.max(img.width, img.height);
    img.setScale(size / extent);
    c.add(img);
    return img;
  }

  pageGoal(c: Phaser.GameObjects.Container): void {
    const top = PY + HEADER + 40;
    this.para(c, PX + 60, top, 'Travel the board, collect Gleam Chips and trade them for Prism Relics.\nWhoever holds the most Relics after the final round wins the festival — chips break ties.', 28);
    const y = top + 170;
    const w = 400;
    const cols = [PX + 60, PX + 60 + w + 30, PX + 60 + 2 * (w + 30)];
    const glow = (x: number, yy: number, tint: number) => c.add(this.add.image(x, yy, 'fx-dot').setScale(6).setTint(tint).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD));
    // 1: chips
    const g = this.add.graphics();
    for (const x of cols) {
      g.fillStyle(0x06141a, 0.4);
      g.fillRoundedRect(x, y, w, 400, 26);
    }
    c.add(g);
    glow(cols[0] + w / 2, y + 150, COLORS.gold);
    [[-60, 20], [50, -10], [0, 60], [80, 70], [-90, 90]].forEach(([dx, dy], k) => {
      const chip = this.icon(c, 'items', '0', cols[0] + w / 2 + dx, y + 130 + dy, 92 - k * 6);
      chip?.setAngle(-12 + k * 9);
    });
    c.add(addText(this, cols[0] + w / 2, y + 290, 'Earn Gleam Chips', 30, { color: '#ffffff', weight: 700 }));
    c.add(addText(this, cols[0] + w / 2, y + 340, 'Gleam Spaces, minigames and\nlucky events pay out chips', 21, { color: CSS.creamDark, weight: 500 }));
    // 2: relic
    glow(cols[1] + w / 2, y + 150, 0x9be8ff);
    const relic = this.icon(c, 'prism-relic', undefined, cols[1] + w / 2, y + 140, 190);
    if (relic) this.tweens.add({ targets: relic, y: relic.y - 12, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    c.add(addText(this, cols[1] + w / 2, y + 290, `${ECONOMY.relicPrice} chips = 1 Relic`, 30, { color: '#ffffff', weight: 700 }));
    c.add(addText(this, cols[1] + w / 2, y + 340, 'Trade with Packsprout, the\nRelic Keeper, as you pass him', 21, { color: CSS.creamDark, weight: 500 }));
    // 3: winner
    glow(cols[2] + w / 2, y + 150, COLORS.goldLight);
    const hero = new Character(this, cols[2] + w / 2, y + 240, CHARACTER_IDS[0], { scale: 0.62 });
    hero.play('celebrate');
    c.add(hero);
    this.time.addEvent({ delay: 2400, loop: true, callback: () => hero.active && hero.play('celebrate', { force: true }) });
    c.add(addText(this, cols[2] + w / 2, y + 290, 'Most Relics wins', 30, { color: '#ffffff', weight: 700 }));
    c.add(addText(this, cols[2] + w / 2, y + 340, 'Festival Awards hand out bonus\nRelics at the very end!', 21, { color: CSS.creamDark, weight: 500 }));
  }

  pageTurn(c: Phaser.GameObjects.Container): void {
    const x = PX + 60;
    const y0 = PY + HEADER + 40;
    const w = 780;
    const steps: [string, string][] = [
      ['Use an item (optional)', 'Press Y before you spin to open your item bag — boots, warps, traps and more.'],
      ['Spin the Orbit Dial', `Press A to stop the dial. You move ${1}–${10} spaces, one at a time.`],
      ['Choose your path', 'At a fork, tilt the stick toward the trail you want. Gates may need a Prism Key.'],
      ['Land and react', 'Wherever you stop, that space takes effect. Passing the Keeper or a market lets you trade.'],
    ];
    steps.forEach(([t, d], k) => this.stepCard(c, x, y0 + k * 160, w, 140, k + 1, t, d, [COLORS.teal, COLORS.gold, COLORS.coral, 0x8e5cd9][k]));
    const cx = PX + PW - 290;
    const cy = PY + HEADER + 300;
    c.add(this.add.image(cx, cy + 190, 'fx-shadow').setScale(2.6, 0.7).setAlpha(0.5));
    const dial = this.textures.exists('rendered-ui-dial') ? this.add.image(cx, cy, 'rendered-ui-dial').setDisplaySize(400, 400) : this.add.image(cx, cy, 'orbit-dial').setScale(0.9);
    c.add(dial);
    this.tweens.add({ targets: dial, angle: 360, duration: 9000, repeat: -1 });
    c.add(addText(this, cx, cy + 2, '7', 120, { color: '#ffffff', weight: 700, stroke: '#06141a', strokeThickness: 10 }));
    c.add(addText(this, cx, cy + 260, 'The Orbit Dial', 30, { color: '#ffffff', weight: 700 }));
    c.add(addText(this, cx, cy + 300, 'Wingstep Boots add +3!', 21, { color: CSS.creamDark, weight: 500 }));
  }

  pageSpaces(c: Phaser.GameObjects.Container): void {
    const x0 = PX + 50;
    const y0 = PY + HEADER + 34;
    const cw = 318;
    const ch = 316;
    const meta = this.cache.json.get('rendered-spaces') as { anchor?: [number, number] } | undefined;
    SPACE_ROWS.forEach(([type, name, desc], i) => {
      const x = x0 + (i % 4) * (cw + 12);
      const y = y0 + Math.floor(i / 4) * (ch + 16);
      const g = this.add.graphics();
      g.fillStyle(0x06141a, 0.4);
      g.fillRoundedRect(x, y, cw, ch, 22);
      c.add(g);
      const key = `rendered-space-${type}`;
      if (this.textures.exists(key)) {
        const img = this.add.image(x + cw / 2, y + 100, key);
        const tex = this.textures.get(key).getSourceImage() as HTMLImageElement;
        if (meta?.anchor) img.setOrigin(meta.anchor[0] / tex.width, meta.anchor[1] / tex.height);
        img.setScale(0.62);
        c.add(img);
      } else {
        const d = this.add.graphics();
        d.fillStyle(0xffffff, 0.8);
        d.fillEllipse(x + cw / 2, y + 100, 150, 90);
        c.add(d);
      }
      c.add(addText(this, x + cw / 2, y + 206, name, 27, { color: '#ffffff', weight: 700 }));
      c.add(addText(this, x + cw / 2, y + 256, desc, 20, { color: CSS.creamDark, weight: 500, wrap: cw - 40 }));
    });
  }

  pageRelics(c: Phaser.GameObjects.Container): void {
    const x = PX + 60;
    const y0 = PY + HEADER + 40;
    this.para(c, x, y0, 'Packsprout, the Relic Keeper, waits at one of the Relic Gates — look for the tall beam of light.', 28, 820);
    const steps: [string, string][] = [
      ['Reach the Keeper', 'You can trade just by passing him — you don\'t have to land on his space.'],
      [`Pay ${ECONOMY.relicPrice} Gleam Chips`, 'You\'ll be asked whether you want to buy. Save up so you\'re ready!'],
      ['He moves on', 'After every sale the Keeper hops to a different gate, so plan your route.'],
    ];
    steps.forEach(([t, d], k) => this.stepCard(c, x, y0 + 150 + k * 170, 820, 150, k + 1, t, d, [0x7fb4e6, COLORS.gold, COLORS.teal][k]));
    const cx = PX + PW - 280;
    const cy = PY + HEADER + 520;
    const beamH = cy - PY - HEADER;
    const beam = this.add.image(cx, cy - beamH / 2, 'fx-dot').setScale(2.6, beamH / 60).setTint(0xbff4ff).setAlpha(0.8).setBlendMode(Phaser.BlendModes.ADD);
    c.add(beam);
    c.add(this.add.image(cx, cy - beamH / 2, 'fx-dot').setScale(0.9, beamH / 64).setTint(0xffffff).setAlpha(0.6).setBlendMode(Phaser.BlendModes.ADD));
    this.tweens.add({ targets: beam, alpha: 0.55, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    c.add(this.add.image(cx, cy + 8, 'fx-shadow').setScale(2.4, 0.7).setAlpha(0.5));
    const frame = npcFrame('packsprout', 'gift');
    const keeper = this.add.sprite(cx, cy, NPC_ATLAS, frame);
    const o = standOrigin(NPC_ATLAS, frame);
    keeper.setOrigin(o.x, o.y).setScale(1.3);
    c.add(keeper);
    const relic = this.icon(c, 'prism-relic', undefined, cx + 150, cy - 250, 150);
    if (relic) this.tweens.add({ targets: relic, y: relic.y - 14, angle: 6, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    c.add(addText(this, cx, cy + 60, 'Packsprout', 30, { color: '#ffffff', weight: 700 }));
    c.add(addText(this, cx, cy + 98, 'Relic Keeper', 21, { color: CSS.creamDark, weight: 500 }));
  }

  pageItems(c: Phaser.GameObjects.Container): void {
    const x0 = PX + 50;
    const y0 = PY + HEADER + 34;
    const list = ITEM_IDS.slice(0, 8).map((id) => ITEMS[id]);
    const cw = 645;
    const ch = 146;
    list.forEach((it, i) => {
      const x = x0 + (i % 2) * (cw + 10);
      const y = y0 + Math.floor(i / 2) * (ch + 12);
      const g = this.add.graphics();
      g.fillStyle(0x06141a, 0.4);
      g.fillRoundedRect(x, y, cw, ch, 20);
      g.fillStyle(0xfff4dc, 0.1);
      g.fillCircle(x + 74, y + ch / 2, 54);
      c.add(g);
      this.icon(c, it.icon.texture, it.icon.frame, x + 74, y + ch / 2, 96);
      c.add(addText(this, x + 146, y + 36, it.name, 26, { color: '#ffffff', weight: 700, align: 'left' }).setOrigin(0, 0.5));
      c.add(addText(this, x + cw - 24, y + 36, `${it.price} chips`, 21, { color: CSS.goldLight, weight: 700, align: 'right' }).setOrigin(1, 0.5));
      c.add(addText(this, x + 146, y + 62, it.description, 19, { color: CSS.creamDark, weight: 500, align: 'left', wrap: cw - 170 }).setOrigin(0, 0));
    });
  }

  pageMinigames(c: Phaser.GameObjects.Container): void {
    const x = PX + 60;
    const y0 = PY + HEADER + 40;
    this.para(c, x, y0, 'When every player has moved, the round ends with a minigame for everyone. Each one takes under a minute, and you\'ll see the rules and controls first.', 28, 1260);
    const places = ['1ST', '2ND', '3RD', '4TH'];
    const cols = [COLORS.gold, 0xcfd8e3, 0xd08a4e, 0x8aa0ad];
    places.forEach((pl, k) => {
      const w = 290;
      const xx = x + k * (w + 26);
      const h = 250 - k * 30;
      const yy = y0 + 520 - h;
      const g = this.add.graphics();
      g.fillStyle(0x06141a, 0.45);
      g.fillRoundedRect(xx + 4, yy + 8, w, h, 20);
      g.fillStyle(cols[k], 1);
      g.fillRoundedRect(xx, yy, w, h, 20);
      g.fillStyle(0xffffff, 0.22);
      g.fillRoundedRect(xx + 10, yy + 8, w - 20, 26, 12);
      c.add(g);
      c.add(addText(this, xx + w / 2, yy + 58, pl, 40, { color: '#ffffff', weight: 700, stroke: '#06141a', strokeThickness: 6 }));
      this.icon(c, 'items', '0', xx + w / 2 - 56, yy + 116, 52);
      c.add(addText(this, xx + w / 2 + 24, yy + 116, `+${ECONOMY.minigameRewards[k]}`, 40, { color: '#ffffff', weight: 700, stroke: '#06141a', strokeThickness: 6 }));
      const hero = new Character(this, xx + w / 2, yy - 6, CHARACTER_IDS[k], { scale: 0.44 - k * 0.02 });
      hero.play(k === 0 ? 'celebrate' : k === 3 ? 'disappointed' : 'idle');
      c.add(hero);
    });
    this.para(c, x, y0 + 560, 'Play any minigame on its own from Minigame Mode on the title screen.', 23, 1260, CSS.creamDark);
  }

  pageControls(c: Phaser.GameObjects.Container): void {
    const x = PX + 60;
    const y0 = PY + HEADER + 40;
    const kind = glyphKindFor(0);
    const rows: [PromptButton, string][] = [
      ['STICK', 'Move · choose a path · menus'],
      ['A', 'Confirm · stop the dial · jump / dash'],
      ['B', 'Back · duck (in some minigames)'],
      ['Y', 'Open your items'],
      ['VIEW', 'Scoreboard and board map'],
      ['MENU', 'Pause'],
    ];
    rows.forEach(([b, label], k) => {
      const y = y0 + k * 88;
      const g = this.add.graphics();
      g.fillStyle(0x06141a, 0.35);
      g.fillRoundedRect(x, y, 760, 72, 18);
      c.add(g);
      const glyph = makeGlyph(this, b, 46, kind);
      glyph.setPosition(x + 60 + Math.max(0, glyph.width - 46) / 2, y + 36);
      c.add(glyph);
      c.add(addText(this, x + 150, y + 36, label, 25, { color: '#ffffff', weight: 700, align: 'left' }).setOrigin(0, 0.5));
    });
    const bx = PX + 880;
    const g = this.add.graphics();
    g.fillStyle(0x06141a, 0.35);
    g.fillRoundedRect(bx, y0, 460, 520, 22);
    c.add(g);
    c.add(addText(this, bx + 230, y0 + 44, 'PLAYING TOGETHER', 26, { color: '#ffffff', weight: 700 }));
    this.para(
      c,
      bx + 32,
      y0 + 90,
      '• Up to 4 players, each with a controller\n• One player can use the keyboard (rebind keys in Settings)\n• Empty seats are filled by CPU players\n• Unplug a controller mid-game and the game pauses until it\'s back\n• Test your controllers in Settings',
      22,
      400,
    );
  }

  override update(): void {
    if (this.leaving) return;
    const c = input.any;
    const dir = c.nav();
    if (dir === 'right' && this.page < this.pages.length - 1) {
      audio.play('menuMove');
      this.show(this.page + 1);
    } else if (dir === 'left' && this.page > 0) {
      audio.play('menuMove');
      this.show(this.page - 1);
    } else if (c.pressed('A')) {
      if (this.page < this.pages.length - 1) {
        audio.play('menuMove');
        this.show(this.page + 1);
      } else this.leave();
    } else if (c.pressed('B')) this.leave();
  }

  private leave(): void {
    this.leaving = true;
    audio.play('cancel');
    goTo(this, 'Title');
  }
}
