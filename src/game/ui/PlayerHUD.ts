import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { CHARACTERS } from '../data/characters';
import { ITEMS, type ItemId } from '../data/items';
import type { MatchState, PlayerState } from '../state/MatchState';
import { computeStandings } from '../state/scoring';
import { centerOrigin } from '../util/spriteUtil';
import { PlayerBadge } from './PlayerBadge';
import { placePortraitSprite } from './Portrait';
import { HIDE_CPU_TAGS } from '../debug/debug';
import { drawCapsule } from './Screen';
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
const PCX = 52; // portrait centre x (from the outer edge)

interface PanelView {
  slot: number;
  flip: boolean;
  root: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Graphics;
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
 * Corner HUD: a ringed portrait over a slate capsule (the minigame HUD's style) holding the name
 * and the relic and chip counts in clean white numerals, the placing on a medal chip, and owned
 * items in framed slots.
 */
export class PlayerHUD {
  readonly panels = new Map<number, PanelView>();

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
    // A slate capsule behind the name and counts (the minigame HUD's style), tucked under the portrait.
    const plate = s.add.graphics();
    drawCapsule(plate, W - PCX, PLATE_H, color);
    plate.setPosition(flip ? 0 : PCX, (H - PLATE_H) / 2 - 4);
    const glow = s.add.graphics();

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
    const name = addText(s, nameX, 22, CHARACTERS[p.characterId].name.split(' ')[0].toUpperCase(), 22, {
      color: '#ffffff',
      weight: 700,
      align: flip ? 'right' : 'left',
    }).setShadow(0, 2, NUM_SHADOW, 4, false, true);
    const parts: Phaser.GameObjects.GameObject[] = [name];
    if (p.isCpu && !HIDE_CPU_TAGS) {
      const tw = 44;
      const tx = flip ? nameX - name.width - 10 - tw : nameX + name.width + 10;
      const tag = s.add.graphics();
      tag.fillStyle(0x0a1120, 0.4);
      tag.fillRoundedRect(tx, 11, tw, 22, 11);
      parts.push(tag, addText(s, tx + tw / 2, 22, 'CPU', 13, { color: '#e6ebf2', weight: 700 }));
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
    // Owned items as bubbles below (top row) or above (bottom row) the stats.
    const items = s.add.container(this.lx(f, 150), top ? H + 26 : -26);
    portraitRoot.add(medal);
    root.add([glow, plate, ...parts, relicIcon, relicText, chipIcon, chipsText, items, portraitRoot]);
    return {
      slot: p.slot,
      flip,
      root,
      glow,
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
    };
  }

  /** Where a slot's chip counter sits on screen (for flying-chip effects). */
  chipAnchor(slot: number): { x: number; y: number } {
    const { x, y } = hudCorner(slot);
    return { x: x + statX(slot % 2 === 1).chipIcon, y: y + 62 };
  }

  relicAnchor(slot: number): { x: number; y: number } {
    const { x, y } = hudCorner(slot);
    return { x: x + statX(slot % 2 === 1).relicIcon, y: y + 62 };
  }

  setActive(slot: number | null): void {
    for (const v of this.panels.values()) {
      v.glow.clear();
      this.scene.tweens.killTweensOf(v.portraitRoot);
      const active = v.slot === slot;
      this.scene.tweens.add({ targets: v.portraitRoot, scale: active ? 1.12 : 1, duration: 200, ease: 'Back.Out' });
      if (active) {
        // A steady soft halo in the player's colour behind the portrait.
        const c = PLAYER_COLORS[v.slot];
        const cx = this.lx(v, PCX);
        const cy = H / 2 - 4;
        for (let k = 0; k < 4; k++) {
          v.glow.fillStyle(c, 0.12);
          v.glow.fillCircle(cx, cy, PR + 12 + k * 6);
        }
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
        v.shownChips = p.chips;
        v.chipsText.setText(String(p.chips));
      } else if (v.shownChips !== p.chips) {
        this.countTo(v, p.chips);
      }
      if (v.shownRelics !== p.relics) {
        v.shownRelics = p.relics;
        v.relicText.setText(String(p.relics));
        if (!instant) this.scene.tweens.add({ targets: [v.relicText, v.relicIcon], scale: '*=1.4', duration: 180, yoyo: true, ease: 'Quad.Out' });
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
        if (!instant) this.scene.tweens.add({ targets: v.medal, scale: { from: 1.4, to: 1 }, duration: 260, ease: 'Back.Out' });
      }
    }
  }

  private countTo(v: PanelView, target: number): void {
    v.chipTween?.stop();
    const from = v.shownChips;
    const holder = { n: from };
    const up = target > from;
    v.chipsText.setColor(up ? '#8dffa8' : '#ff9b8f');
    v.chipTween = this.scene.tweens.add({
      targets: holder,
      n: target,
      duration: Math.min(1200, 120 + Math.abs(target - from) * 45),
      ease: 'Quad.Out',
      onUpdate: () => {
        const n = Math.round(holder.n);
        if (String(n) !== v.chipsText.text) {
          v.chipsText.setText(String(n));
          v.chipIcon.setScale(0.23);
          this.scene.tweens.add({ targets: v.chipIcon, scale: 0.19, duration: 90 });
        }
      },
      onComplete: () => {
        v.shownChips = target;
        v.chipsText.setText(String(target));
        v.chipsText.setColor('#ffffff');
      },
    });
  }

  private renderItems(v: PanelView, items: ItemId[], shielded: boolean): void {
    const key = `${items.join(',')}|${shielded}`;
    if (key === v.itemKey) return;
    v.itemKey = key;
    v.items.removeAll(true);
    const list: { texture: string; frame?: string; scale: number }[] = items.map((id) => ITEMS[id].icon);
    if (shielded) list.push({ texture: 'items', frame: '24', scale: 0.46 });
    list.forEach((icon, i) => {
      const bx = (v.flip ? -1 : 1) * i * 66;
      const g = this.scene.add.graphics();
      // framed slot: soft shadow, slate rim, white face
      g.fillStyle(0x0a1120, 0.22);
      g.fillCircle(bx, 4, 30);
      g.fillStyle(UI.slate, 0.9);
      g.fillCircle(bx, 0, 30);
      g.fillStyle(0xffffff, 0.97);
      g.fillCircle(bx, 0, 26);
      if (i === items.length) {
        g.lineStyle(3, COLORS.crystal, 1);
        g.strokeCircle(bx, 0, 24);
      }
      const img = icon.frame !== undefined ? this.scene.add.sprite(bx, 0, icon.texture, icon.frame) : this.scene.add.image(bx, 0, icon.texture);
      if (icon.frame !== undefined) {
        const o = centerOrigin(icon.texture, icon.frame);
        img.setOrigin(o.x, o.y);
      }
      img.setScale(icon.scale * 0.4);
      v.items.add([g, img]);
    });
  }

  setVisible(v: boolean): void {
    for (const p of this.panels.values()) p.root.setVisible(v);
  }
}
