import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { CHARACTERS } from '../data/characters';
import { ITEMS, type ItemId } from '../data/items';
import { settings } from '../save/SettingsManager';
import type { MatchState, PlayerState } from '../state/MatchState';
import { computeStandings } from '../state/scoring';
import { centerOrigin } from '../util/spriteUtil';
import { PlayerBadge } from './PlayerBadge';
import { placePortraitSprite } from './Portrait';
import { HIDE_CPU_TAGS } from '../debug/debug';
import { drawGlossCapsule } from './Screen';
import { UI } from './Style';
import { addText } from './theme';

/** Corner block size (portrait + name + stats); items hang below/above it. */
const W = 300;
const H = 104;
/** Title-safe margins from the screen edges. */
const MX = 44;
const MY = 30;
const PR = 46; // portrait radius
const PLATE_H = 88; // stats plate height
const PLATE_Y = (H - PLATE_H) / 2 - 4;
const PCX = 52; // portrait centre x (from the outer edge)
/** Item slots: spacing, and where the first sits (local x from the outer edge). */
const ITEM_STEP = 64;
const ITEM_X = 150;
/** The TURN tab and, under it, the steps-to-the-Star-Coin tab, stacked at the capsule's inner end. */
const TURN_Y = PLATE_Y + 34;
const STEPS_Y = PLATE_Y + PLATE_H - 14;
const STEPS_H = 30;

interface PanelView {
  slot: number;
  flip: boolean;
  top: boolean;
  root: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Graphics;
  /** Bright pulsing rim around the capsule while it's this player's turn. */
  activeRim: Phaser.GameObjects.Graphics;
  /** "TURN" tab that slides out of the capsule's inner end on this player's turn. */
  turnTab: Phaser.GameObjects.Container;
  tray: Phaser.GameObjects.Graphics;
  portraitRoot: Phaser.GameObjects.Container;
  chipsText: Phaser.GameObjects.Text;
  relicText: Phaser.GameObjects.Text;
  rankText: Phaser.GameObjects.Text;
  medal: Phaser.GameObjects.Container;
  medalG: Phaser.GameObjects.Graphics;
  items: Phaser.GameObjects.Container;
  shownChips: number;
  shownRelics: number;
  chipTween?: Phaser.Tweens.Tween;
  chipIcon: Phaser.GameObjects.Sprite;
  relicIcon: Phaser.GameObjects.Image;
  itemKey: string;
  /** Steps to the Star Coin (see syncSteps). */
  steps: Phaser.GameObjects.Container;
  stepsG: Phaser.GameObjects.Graphics;
  stepsIcon: Phaser.GameObjects.Image;
  stepsNum: Phaser.GameObjects.Text;
  stepsWord: Phaser.GameObjects.Text;
  shownSteps: number;
}

/** Top-left corner of each slot's HUD block: P1 top-left, P2 top-right, P3 bottom-left, P4 bottom-right. */
export function hudCorner(slot: number): { x: number; y: number } {
  const left = slot % 2 === 0;
  const top = slot < 2;
  return { x: left ? MX : GAME_WIDTH - MX - W, y: top ? MY : GAME_HEIGHT - MY - H };
}

/** Medal face / rim colours by place. */
const MEDAL_COLORS: [number, number][] = [
  [0xffd45c, 0xd89b22],
  [0xe9eef3, 0xa7b2bd],
  [0xf2ae70, 0xb86d33],
  [0x8fd8d0, 0x4f9f98],
];

/** Stat positions (local x): relic then chips left to right, clear of the portrait. */
function statX(flip: boolean): { relicIcon: number; relicText: number; chipIcon: number; chipText: number } {
  const x0 = flip ? 40 : 128;
  return { relicIcon: x0, relicText: x0 + 20, chipIcon: x0 + 78, chipText: x0 + 98 };
}

const NUM_SHADOW = 'rgba(8,14,28,0.55)';

/**
 * Corner HUD: a ringed portrait over a glossy slate capsule holding the name and the relic and chip
 * counts in clean white numerals, the placing on a medal chip, and owned items in a tray hanging off
 * the capsule. The player whose turn it is gets a bright pulsing rim and a TURN tab, and the others
 * step back a little.
 */
export class PlayerHUD {
  readonly panels = new Map<number, PanelView>();
  private activeSlot: number | null = null;

  constructor(
    private scene: Phaser.Scene,
    state: MatchState,
  ) {
    for (const p of state.players) this.panels.set(p.slot, this.build(p));
    this.update(state, true);
  }

  /** Local x inside the block, mirrored for right-hand panels. */
  private lx(v: PanelView | { flip: boolean }, x: number): number {
    return v.flip ? W - x : x;
  }

  private build(p: PlayerState): PanelView {
    const s = this.scene;
    const { x, y } = hudCorner(p.slot);
    const flip = p.slot % 2 === 1;
    const top = p.slot < 2;
    const f = { flip };
    const color = PLAYER_COLORS[p.slot];
    const root = s.add.container(x, y).setDepth(500);
    // The item tray sits behind the capsule so the capsule's edge overlaps it (it reads as attached).
    const tray = s.add.graphics();
    // A glossy slate capsule behind the name and counts, tucked under the portrait.
    const plate = s.add.graphics();
    drawGlossCapsule(plate, W - PCX, PLATE_H, color);
    plate.setPosition(flip ? 0 : PCX, PLATE_Y);
    const activeRim = s.add.graphics().setAlpha(0);
    activeRim.setPosition(flip ? 0 : PCX, PLATE_Y);
    for (let k = 0; k < 3; k++) {
      activeRim.lineStyle(6 - k * 1.5, color, 0.55 - k * 0.15);
      activeRim.strokeRoundedRect(-3 - k * 4, -3 - k * 4, W - PCX + 6 + k * 8, PLATE_H + 6 + k * 8, PLATE_H / 2 + 3 + k * 4);
    }
    activeRim.lineStyle(3, 0xffffff, 0.9);
    activeRim.strokeRoundedRect(1.5, 1.5, W - PCX - 3, PLATE_H - 3, PLATE_H / 2 - 1.5);
    const glow = s.add.graphics();

    // "TURN" tab at the capsule's inner end (hidden until this player's turn).
    const tabW = 86;
    const turnTab = s.add.container(flip ? -6 : W + 6, TURN_Y).setAlpha(0);
    const tg = s.add.graphics();
    tg.fillStyle(0x0a1120, 0.3);
    tg.fillRoundedRect(flip ? -tabW : 0, -15, tabW, 34, 17);
    tg.fillStyle(color, 1);
    tg.fillRoundedRect(flip ? -tabW : 0, -18, tabW, 34, 17);
    tg.fillStyle(0xffffff, 0.25);
    tg.fillRoundedRect((flip ? -tabW : 0) + 6, -15, tabW - 12, 11, 5);
    const tt = addText(s, flip ? -tabW / 2 : tabW / 2, -2, 'TURN', 18, { color: '#ffffff', weight: 700, fixed: true }).setShadow(0, 2, 'rgba(8,14,28,0.45)', 0, false, true);
    turnTab.add([tg, tt]);
    // How many steps to the Star Coin, in a small tab under it (always shown on the board).
    const steps = s.add.container(flip ? -6 : W + 6, STEPS_Y).setVisible(false);
    const stepsG = s.add.graphics();
    const stepsIcon = s.add.image(0, 0, 'prism-relic').setScale(0.1);
    const stepsNum = addText(s, 0, -1, '', 22, { color: '#ffffff', weight: 700, align: 'left', fixed: true }).setShadow(0, 2, NUM_SHADOW, 3, false, true);
    const stepsWord = addText(s, 0, 1, '', 14, { color: UI.focusCss, weight: 700, align: 'left', fixed: true });
    steps.add([stepsG, stepsIcon, stepsNum, stepsWord]);

    // Portrait: character on its colour disc inside a white ring with a slim player-colour ring.
    const pcx = this.lx(f, PCX);
    const pcy = H / 2 - 4;
    const portraitRoot = s.add.container(pcx, pcy);
    const disc = s.add.graphics();
    disc.fillStyle(0x0a1120, 0.3);
    disc.fillCircle(0, 4, PR + 6);
    disc.fillStyle(0xffffff, 1);
    disc.fillCircle(0, 0, PR + 6);
    disc.fillStyle(color, 1);
    disc.fillCircle(0, 0, PR + 1);
    disc.fillStyle(CHARACTERS[p.characterId].color, 1);
    disc.fillCircle(0, 0, PR - 3);
    disc.fillStyle(0xffffff, 0.22);
    disc.fillCircle(0, -PR * 0.35, PR * 0.62);
    const portrait = s.add.sprite(0, 0, CHARACTERS[p.characterId].atlas, '0');
    placePortraitSprite(portrait, p.characterId, 0.6, 0.26 * PR, flip);
    const maskG = s.make.graphics({ x: 0, y: 0 }, false);
    maskG.fillStyle(0xffffff);
    maskG.fillCircle(x + pcx, y + pcy, PR - 3);
    portrait.setMask(maskG.createGeometryMask());
    const badge = new PlayerBadge(s, flip ? -PR * 0.8 : PR * 0.8, -PR * 0.66, p.slot, 15);
    portraitRoot.add([disc, portrait, badge]);

    // Name + CPU tag
    const nameX = this.lx(f, 124);
    const name = addText(s, nameX, 22, CHARACTERS[p.characterId].short.toUpperCase(), 23, {
      color: '#ffffff',
      weight: 700,
      align: flip ? 'right' : 'left',
    }).setShadow(0, 2, NUM_SHADOW, 4, false, true);
    const parts: Phaser.GameObjects.GameObject[] = [name];
    const cpuTag = p.isCpu && !HIDE_CPU_TAGS;
    // Long names ("SPIDER-MAN") shrink to stay inside the capsule, clear of the CPU tag.
    const room = W - 124 - 16 - (cpuTag ? 56 : 0);
    if (name.width > room) name.setScale(room / name.width);
    if (cpuTag) {
      const tw = 46;
      const tx = flip ? nameX - name.displayWidth - 10 - tw : nameX + name.displayWidth + 10;
      const tag = s.add.graphics();
      tag.fillStyle(0xffffff, 0.16);
      tag.fillRoundedRect(tx, 11, tw, 23, 11.5);
      parts.push(tag, addText(s, tx + tw / 2, 22.5, 'CPU', 14, { color: '#ffffff', weight: 700 }));
    }
    // Relics then chips, in the same left-to-right order in every corner (only the portrait mirrors).
    const sx = statX(flip);
    const relicIcon = s.add.image(sx.relicIcon, 62, 'prism-relic').setScale(0.16);
    const relicText = addText(s, sx.relicText, 63, '0', 40, { color: '#ffffff', weight: 700, align: 'left' })
      .setOrigin(0, 0.5)
      .setShadow(0, 2, NUM_SHADOW, 5, false, true);
    const chipIcon = s.add.sprite(sx.chipIcon, 62, 'items', '0');
    const co = centerOrigin('items', '0');
    chipIcon.setOrigin(co.x, co.y).setScale(0.2);
    const chipsText = addText(s, sx.chipText, 63, '0', 40, { color: '#ffffff', weight: 700, align: 'left' })
      .setOrigin(0, 0.5)
      .setShadow(0, 2, NUM_SHADOW, 5, false, true);
    // Placing on a medal chip under the portrait (gold / silver / bronze / slate), always on-screen.
    const medal = s.add.container(0, PR + 8);
    const medalG = s.add.graphics();
    // Starts empty so the first update always draws the medal (a leader's '1st' would otherwise match).
    const rankText = addText(s, 0, -2, '', 25, { color: '#2a1d0c', weight: 700 });
    medal.add([medalG, rankText]);
    // Owned items in slots on the tray below (top row) or above (bottom row) the capsule.
    const items = s.add.container(this.lx(f, ITEM_X), top ? H + 22 : -22);
    portraitRoot.add(medal);
    root.add([tray, glow, activeRim, plate, turnTab, steps, ...parts, relicIcon, relicText, chipIcon, chipsText, items, portraitRoot]);
    return {
      slot: p.slot,
      flip,
      top,
      root,
      glow,
      activeRim,
      turnTab,
      tray,
      portraitRoot,
      chipsText,
      relicText,
      rankText,
      medal,
      medalG,
      items,
      shownChips: p.chips,
      shownRelics: p.relics,
      chipIcon,
      relicIcon,
      itemKey: '',
      steps,
      stepsG,
      stepsIcon,
      stepsNum,
      stepsWord,
      shownSteps: NaN,
    };
  }

  /** The active panel steps 10 px in towards the middle of the screen. */
  private nudge(slot: number): number {
    return slot === this.activeSlot ? (slot % 2 === 1 ? -10 : 10) : 0;
  }

  /** Where a slot's chip counter sits on screen (for flying-chip effects). */
  chipAnchor(slot: number): { x: number; y: number } {
    const { x, y } = hudCorner(slot);
    return { x: x + this.nudge(slot) + statX(slot % 2 === 1).chipIcon, y: y + 62 };
  }

  relicAnchor(slot: number): { x: number; y: number } {
    const { x, y } = hudCorner(slot);
    return { x: x + this.nudge(slot) + statX(slot % 2 === 1).relicIcon, y: y + 62 };
  }

  setActive(slot: number | null): void {
    const tw = this.scene.tweens;
    const reduced = settings.get().reducedMotion;
    const changed = slot !== this.activeSlot;
    this.activeSlot = slot;
    for (const v of this.panels.values()) {
      v.glow.clear();
      tw.killTweensOf([v.portraitRoot, v.activeRim, v.turnTab, v.root]);
      const active = v.slot === slot;
      tw.add({ targets: v.portraitRoot, scale: active ? 1.12 : 1, duration: 200, ease: 'Back.Out' });
      // Everyone else steps back a touch so the active corner stands out.
      tw.add({ targets: v.root, alpha: slot === null || active ? 1 : 0.8, duration: 220 });
      const { x: hx } = hudCorner(v.slot);
      tw.add({ targets: v.root, x: hx + this.nudge(v.slot), duration: 240, ease: 'Back.Out' });
      if (active) {
        // A steady soft halo in the player's colour behind the portrait.
        const c = PLAYER_COLORS[v.slot];
        const cx = this.lx(v, PCX);
        const cy = H / 2 - 4;
        for (let k = 0; k < 4; k++) {
          v.glow.fillStyle(c, 0.12);
          v.glow.fillCircle(cx, cy, PR + 12 + k * 6);
        }
        v.activeRim.setAlpha(1);
        if (!reduced) tw.add({ targets: v.activeRim, alpha: { from: 1, to: 0.45 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
        const out = v.flip ? -6 : W + 6;
        if (changed && !reduced) {
          v.turnTab.setAlpha(0).setX(out + (v.flip ? 40 : -40));
          tw.add({ targets: v.turnTab, alpha: 1, x: out, duration: 260, delay: 80, ease: 'Back.Out' });
        } else v.turnTab.setAlpha(1).setX(out);
      } else {
        v.activeRim.setAlpha(0);
        tw.add({ targets: v.turnTab, alpha: 0, duration: 140 });
      }
    }
  }

  /** Sync numbers, items and ranks. Chip changes count up/down. */
  update(state: MatchState, instant = false): void {
    const standings = computeStandings(state.players);
    const allTied = standings.every((st) => st.place === standings[0].place);
    for (const p of state.players) {
      const v = this.panels.get(p.slot);
      if (!v) continue;
      if (instant) {
        v.chipTween?.stop();
        v.shownChips = p.chips;
        v.chipsText.setText(String(p.chips));
      } else if (v.shownChips !== p.chips) {
        this.countTo(v, p.chips);
      }
      if (v.shownRelics !== p.relics) {
        const gained = p.relics > v.shownRelics;
        v.shownRelics = p.relics;
        v.relicText.setText(String(p.relics));
        if (!instant) {
          this.scene.tweens.add({ targets: [v.relicText, v.relicIcon], scale: '*=1.4', duration: 180, yoyo: true, ease: 'Quad.Out' });
          if (gained) this.popDelta(v, '+1', true, statX(v.flip).relicIcon);
        }
      } else v.relicText.setText(String(p.relics));
      this.renderItems(v, p.items, p.shielded);
      const st = standings.find((x) => x.slot === p.slot)!;
      const suffix = st.place === 1 ? 'st' : st.place === 2 ? 'nd' : st.place === 3 ? 'rd' : 'th';
      const txt = allTied ? '' : `${st.place}${suffix}`;
      if (v.rankText.text !== txt) {
        v.rankText.setText(txt);
        v.medal.setVisible(txt !== '');
        const mc = MEDAL_COLORS[Math.min(3, st.place - 1)];
        const g = v.medalG;
        g.clear();
        g.fillStyle(0x0a1120, 0.3);
        g.fillRoundedRect(-36, -15, 72, 38, 19);
        g.fillStyle(mc[1], 1);
        g.fillRoundedRect(-36, -19, 72, 38, 19);
        g.fillStyle(mc[0], 1);
        g.fillRoundedRect(-33, -19, 66, 34, 17);
        g.fillStyle(0xffffff, 0.35);
        g.fillRoundedRect(-28, -17, 56, 11, 5.5);
        if (!instant) this.scene.tweens.add({ targets: v.medal, scale: { from: 1.4, to: 1 }, duration: 260, ease: 'Back.Out' });
      }
    }
  }

  /**
   * Show how many steps each player is from the Star Coin (called every frame; redraws only on a
   * change). A step closer punches the number; a jump (the Star Coin moved, a warp) pops the tab.
   */
  syncSteps(state: MatchState, stepsTo: (p: PlayerState) => number): void {
    for (const p of state.players) {
      const v = this.panels.get(p.slot);
      if (!v) continue;
      const n = stepsTo(p);
      if (n === v.shownSteps || (Number.isNaN(n) && Number.isNaN(v.shownSteps))) continue;
      const prev = v.shownSteps;
      v.shownSteps = n;
      this.drawSteps(v, n);
      if (Number.isNaN(prev) || settings.get().reducedMotion) continue;
      const tw = this.scene.tweens;
      if (n === prev - 1) {
        tw.killTweensOf(v.stepsNum);
        v.stepsNum.setScale(1.3);
        tw.add({ targets: v.stepsNum, scale: 1, duration: 160, ease: 'Quad.Out' });
      } else {
        tw.killTweensOf(v.steps);
        v.steps.setScale(1);
        tw.add({ targets: v.steps, scale: { from: 1.25, to: 1 }, duration: 260, ease: 'Back.Out' });
      }
    }
  }

  private drawSteps(v: PanelView, n: number): void {
    v.steps.setVisible(!Number.isNaN(n));
    if (Number.isNaN(n)) return;
    const here = n === 0;
    v.stepsNum.setText(!Number.isFinite(n) ? '–' : here ? '' : String(n));
    v.stepsWord.setText(!Number.isFinite(n) ? '' : here ? 'HERE!' : n === 1 ? 'STEP' : 'STEPS');
    // Laid out left to right from 0, then shifted to hang left of the capsule on right-hand panels.
    const pad = 10;
    const iconW = 24;
    let x = pad + iconW + 6;
    const numX = x;
    x += v.stepsNum.width + (v.stepsNum.text ? 4 : 0);
    const wordX = x;
    x += v.stepsWord.width;
    const w = Math.max(64, x + pad + 2);
    const off = v.flip ? -w : 0;
    v.stepsIcon.setPosition(off + pad + iconW / 2, 0);
    v.stepsNum.setPosition(off + numX, -1);
    v.stepsWord.setPosition(off + wordX, 1);
    const g = v.stepsG;
    g.clear();
    g.fillStyle(0x0a1120, 0.3);
    g.fillRoundedRect(off, -STEPS_H / 2 + 3, w, STEPS_H, STEPS_H / 2);
    g.fillStyle(UI.slate, UI.slateAlpha);
    g.fillRoundedRect(off, -STEPS_H / 2, w, STEPS_H, STEPS_H / 2);
    g.lineStyle(2, UI.focus, here ? 1 : 0.75);
    g.strokeRoundedRect(off + 1, -STEPS_H / 2 + 1, w - 2, STEPS_H - 2, STEPS_H / 2 - 1);
  }

  /** "+3" / "-5" popping out beside a counter and drifting away. */
  private popDelta(v: PanelView, text: string, up: boolean, atX: number): void {
    const s = this.scene;
    const y0 = v.top ? H + 8 : -12;
    const t = addText(s, atX + (v.flip ? -6 : 6), y0, text, 30, { color: up ? '#8dffa8' : '#ff9b8f', weight: 700, stroke: '#0a1120', fixed: true });
    v.root.add(t);
    t.setScale(0.4);
    s.tweens.add({ targets: t, scale: 1, duration: 200, ease: 'Back.Out' });
    s.tweens.add({ targets: t, y: y0 + (v.top ? 26 : -26), alpha: 0, duration: 700, delay: 420, ease: 'Quad.In', onComplete: () => t.destroy() });
  }

  private countTo(v: PanelView, target: number): void {
    v.chipTween?.stop();
    const from = v.shownChips;
    const holder = { n: from };
    const up = target > from;
    v.chipsText.setColor(up ? '#8dffa8' : '#ff9b8f');
    this.popDelta(v, `${up ? '+' : '-'}${Math.abs(target - from)}`, up, statX(v.flip).chipText + 28);
    v.chipTween = this.scene.tweens.add({
      targets: holder,
      n: target,
      duration: Math.min(1200, 120 + Math.abs(target - from) * 45),
      ease: 'Quad.Out',
      onUpdate: () => {
        const n = Math.round(holder.n);
        if (String(n) !== v.chipsText.text) {
          v.chipsText.setText(String(n));
          // A tick and a punch on every step, rising as it climbs (falling as it drops).
          audio.play('dialTick', { rate: up ? 1.25 : 0.8, volume: 0.35, throttleMs: 40 });
          const tw = this.scene.tweens;
          tw.killTweensOf([v.chipsText, v.chipIcon]);
          v.chipsText.setScale(1.18);
          tw.add({ targets: v.chipsText, scale: 1, duration: 110, ease: 'Quad.Out' });
          v.chipIcon.setScale(0.23);
          tw.add({ targets: v.chipIcon, scale: 0.19, duration: 90 });
        }
      },
      onComplete: () => {
        v.shownChips = target;
        v.chipsText.setText(String(target)).setScale(1);
        v.chipsText.setColor('#ffffff');
      },
    });
  }

  private renderItems(v: PanelView, items: ItemId[], shielded: boolean): void {
    const key = `${items.join(',')}|${shielded}`;
    if (key === v.itemKey) return;
    v.itemKey = key;
    v.items.removeAll(true);
    v.tray.clear();
    const list: { texture: string; frame?: string; scale: number }[] = items.map((id) => ITEMS[id].icon);
    if (shielded) list.push({ texture: 'items', frame: '24', scale: 0.46 });
    if (list.length === 0) return;
    // The tray: a slate tab in the capsule's material, hanging off its edge (drawn in the panel's
    // coordinates, behind the capsule, so the two read as one piece).
    const n = list.length;
    const x0 = this.lx(v, ITEM_X);
    const span = (n - 1) * ITEM_STEP;
    const left = v.flip ? x0 - span - 38 : x0 - 38;
    const tw = span + 76;
    const trayTop = v.top ? PLATE_Y + PLATE_H - 20 : -22 - 34;
    const trayH = 20 + 34 + 34;
    const g = v.tray;
    g.fillStyle(UI.shadow, 0.18);
    g.fillRoundedRect(left, trayTop + 4, tw, trayH, 26);
    g.fillStyle(UI.slate, UI.slateAlpha);
    g.fillRoundedRect(left, trayTop, tw, trayH, 26);
    g.lineStyle(2.5, PLAYER_COLORS[v.slot], 1);
    g.strokeRoundedRect(left + 1.25, trayTop + 1.25, tw - 2.5, trayH - 2.5, 25);
    list.forEach((icon, i) => {
      const bx = (v.flip ? -1 : 1) * i * ITEM_STEP;
      const slot = this.scene.add.graphics();
      // Framed slot: white face with a soft inner shade.
      slot.fillStyle(0xffffff, 0.97);
      slot.fillCircle(bx, 0, 27);
      slot.fillStyle(0xdfe4ec, 1);
      slot.fillCircle(bx, 4, 25);
      slot.fillStyle(0xffffff, 1);
      slot.fillCircle(bx, 1, 24);
      if (i === items.length) {
        slot.lineStyle(3, COLORS.crystal, 1);
        slot.strokeCircle(bx, 0, 24);
      }
      const img = icon.frame !== undefined ? this.scene.add.sprite(bx, 0, icon.texture, icon.frame) : this.scene.add.image(bx, 0, icon.texture);
      if (icon.frame !== undefined) {
        const o = centerOrigin(icon.texture, icon.frame);
        img.setOrigin(o.x, o.y);
      }
      img.setScale(icon.scale * 0.4);
      v.items.add([slot, img]);
    });
  }

  setVisible(v: boolean): void {
    for (const p of this.panels.values()) p.root.setVisible(v);
  }
}
