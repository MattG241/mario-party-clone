import Phaser from 'phaser';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { CHARACTERS } from '../data/characters';
import { ITEMS, type ItemId } from '../data/items';
import type { MatchState, PlayerState } from '../state/MatchState';
import { computeStandings } from '../state/scoring';
import { centerOrigin } from '../util/spriteUtil';
import { drawPanel } from './Panel';
import { PlayerBadge } from './PlayerBadge';
import { addText } from './theme';

const W = 440;
const H = 158;
const PAD = 18;

interface PanelView {
  slot: number;
  root: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Graphics;
  chipsText: Phaser.GameObjects.Text;
  relicText: Phaser.GameObjects.Text;
  rankText: Phaser.GameObjects.Text;
  rankBg: Phaser.GameObjects.Graphics;
  itemSlots: Phaser.GameObjects.Container[];
  shownChips: number;
  shownRelics: number;
  chipTween?: Phaser.Tweens.Tween;
  shieldIcon: Phaser.GameObjects.Container;
  chipIcon: Phaser.GameObjects.Sprite;
  relicIcon: Phaser.GameObjects.Image;
}

/** Corner panels: P1 top-left, P2 top-right, P3 bottom-left, P4 bottom-right. */
export function hudCorner(slot: number): { x: number; y: number } {
  const left = slot % 2 === 0;
  const top = slot < 2;
  return { x: left ? PAD : GAME_WIDTH - PAD - W, y: top ? PAD : GAME_HEIGHT - PAD - H };
}

export class PlayerHUD {
  readonly panels = new Map<number, PanelView>();

  constructor(
    private scene: Phaser.Scene,
    state: MatchState,
  ) {
    for (const p of state.players) this.panels.set(p.slot, this.build(p));
    this.update(state, true);
  }

  private build(p: PlayerState): PanelView {
    const s = this.scene;
    const { x, y } = hudCorner(p.slot);
    const root = s.add.container(x, y).setDepth(500);
    const glow = s.add.graphics();
    const bg = s.add.graphics();
    drawPanel(bg, 0, 0, W, H, { border: PLAYER_COLORS[p.slot], radius: 26, borderWidth: 6, shadowOffset: 8 });
    // Portrait in a round window.
    const pcx = 78;
    const pcy = H / 2;
    const disc = s.add.graphics();
    disc.fillStyle(CHARACTERS[p.characterId].color, 0.35);
    disc.fillCircle(pcx, pcy, 56);
    const portrait = s.add.sprite(pcx, pcy + 72, CHARACTERS[p.characterId].atlas, '0');
    portrait.setOrigin(0.5, 0.62).setScale(0.62);
    const maskG = s.make.graphics({ x: 0, y: 0 }, false);
    maskG.fillStyle(0xffffff);
    maskG.fillCircle(x + pcx, y + pcy, 56);
    portrait.setMask(maskG.createGeometryMask());
    const ring = s.add.graphics();
    ring.lineStyle(6, PLAYER_COLORS[p.slot], 1);
    ring.strokeCircle(pcx, pcy, 56);
    const badge = new PlayerBadge(s, pcx - 44, pcy - 44, p.slot, 19);
    const name = addText(s, 150, 34, CHARACTERS[p.characterId].name.toUpperCase(), 26, { color: CSS.ink, weight: 700, align: 'left' });
    if (name.width > 200) name.setScale(200 / name.width);
    const tag = addText(s, W - 26, 34, p.isCpu ? `CPU·${p.cpuLevel[0].toUpperCase()}` : `P${p.slot + 1}`, 20, { color: CSS.inkSoft, weight: 700, align: 'right' });
    // Relics
    const relicIcon = s.add.image(166, 84, 'prism-relic').setScale(0.16);
    const relicText = addText(s, 190, 86, '0', 36, { color: CSS.ink, weight: 700, align: 'left' });
    // Chips
    const chipIcon = s.add.sprite(270, 84, 'items', '0');
    const co = centerOrigin('items', '0');
    chipIcon.setOrigin(co.x, co.y).setScale(0.2);
    const chipsText = addText(s, 294, 86, '0', 36, { color: CSS.ink, weight: 700, align: 'left' });
    // Items
    const itemSlots: Phaser.GameObjects.Container[] = [];
    for (let i = 0; i < 3; i++) {
      const c = s.add.container(170 + i * 58, 130);
      const g = s.add.graphics();
      g.fillStyle(COLORS.creamDark, 1);
      g.fillRoundedRect(-24, -20, 48, 40, 10);
      g.lineStyle(2, COLORS.teal, 0.6);
      g.strokeRoundedRect(-24, -20, 48, 40, 10);
      c.add(g);
      itemSlots.push(c);
    }
    // Shield indicator
    const shieldIcon = s.add.container(366, 130).setVisible(false);
    const shieldImg = s.add.sprite(0, 0, 'items', '24');
    const so = centerOrigin('items', '24');
    shieldImg.setOrigin(so.x, so.y).setScale(0.16);
    shieldIcon.add(shieldImg);
    // Rank ribbon
    const rankBg = s.add.graphics();
    const rankText = addText(s, W - 44, 128, '1st', 26, { color: CSS.white, weight: 700, stroke: '#1b1530', strokeThickness: 5 });
    root.add([glow, bg, disc, portrait, ring, badge, name, tag, relicIcon, relicText, chipIcon, chipsText, ...itemSlots, shieldIcon, rankBg, rankText]);
    return { slot: p.slot, root, glow, chipsText, relicText, rankText, rankBg, itemSlots, shownChips: p.chips, shownRelics: p.relics, shieldIcon, chipIcon, relicIcon };
  }

  /** Where a slot's chip counter sits on screen (for flying-chip effects). */
  chipAnchor(slot: number): { x: number; y: number } {
    const { x, y } = hudCorner(slot);
    return { x: x + 270, y: y + 84 };
  }

  relicAnchor(slot: number): { x: number; y: number } {
    const { x, y } = hudCorner(slot);
    return { x: x + 166, y: y + 84 };
  }

  setActive(slot: number | null): void {
    for (const v of this.panels.values()) {
      v.glow.clear();
      this.scene.tweens.killTweensOf(v.glow);
      v.glow.setAlpha(1);
      if (v.slot === slot) {
        // Glow ring around the whole panel (shadow included) that gently pulses.
        v.glow.lineStyle(12, COLORS.crystal, 0.35);
        v.glow.strokeRoundedRect(-9, -9, W + 18, H + 26, 34);
        v.glow.lineStyle(6, COLORS.crystalLight, 0.95);
        v.glow.strokeRoundedRect(-6, -6, W + 12, H + 20, 31);
        this.scene.tweens.add({ targets: v.glow, alpha: { from: 1, to: 0.45 }, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      }
    }
  }

  /** Sync numbers, items and ranks. Chip changes count up/down. */
  update(state: MatchState, instant = false): void {
    const standings = computeStandings(state.players);
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
      this.renderItems(v, p.items);
      v.shieldIcon.setVisible(p.shielded);
      const st = standings.find((x) => x.slot === p.slot)!;
      const suffix = st.place === 1 ? 'st' : st.place === 2 ? 'nd' : st.place === 3 ? 'rd' : 'th';
      v.rankText.setText(`${st.place}${suffix}`);
      v.rankBg.clear();
      const col = st.place === 1 ? COLORS.gold : st.place === 2 ? 0xb8c4cc : st.place === 3 ? 0xcd8a52 : 0x8a82a0;
      v.rankBg.fillStyle(col, 1);
      v.rankBg.fillRoundedRect(W - 82, 110, 76, 38, 12);
      v.rankBg.lineStyle(3, COLORS.cream, 1);
      v.rankBg.strokeRoundedRect(W - 82, 110, 76, 38, 12);
    }
  }

  private countTo(v: PanelView, target: number): void {
    v.chipTween?.stop();
    const from = v.shownChips;
    const holder = { n: from };
    const up = target > from;
    v.chipsText.setColor(up ? '#1f8f3a' : '#c0392b');
    v.chipTween = this.scene.tweens.add({
      targets: holder,
      n: target,
      duration: Math.min(1200, 120 + Math.abs(target - from) * 45),
      ease: 'Quad.Out',
      onUpdate: () => {
        const n = Math.round(holder.n);
        if (String(n) !== v.chipsText.text) {
          v.chipsText.setText(String(n));
          v.chipIcon.setScale(0.24);
          this.scene.tweens.add({ targets: v.chipIcon, scale: 0.2, duration: 90 });
        }
      },
      onComplete: () => {
        v.shownChips = target;
        v.chipsText.setText(String(target));
        v.chipsText.setColor(CSS.ink);
      },
    });
  }

  private renderItems(v: PanelView, items: ItemId[]): void {
    v.itemSlots.forEach((c, i) => {
      while (c.length > 1) c.removeAt(1, true);
      const id = items[i];
      if (!id) return;
      const icon = ITEMS[id].icon;
      const img = icon.frame !== undefined ? this.scene.add.sprite(0, 0, icon.texture, icon.frame) : this.scene.add.image(0, 0, icon.texture);
      if (icon.frame !== undefined) {
        const o = centerOrigin(icon.texture, icon.frame);
        img.setOrigin(o.x, o.y);
      }
      img.setScale(icon.scale * 0.3);
      c.add(img);
    });
  }

  setVisible(v: boolean): void {
    for (const p of this.panels.values()) p.root.setVisible(v);
  }
}
