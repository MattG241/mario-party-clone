import Phaser from 'phaser';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { CHARACTERS } from '../data/characters';
import { ITEMS, type ItemId } from '../data/items';
import type { MatchState, PlayerState } from '../state/MatchState';
import { computeStandings } from '../state/scoring';
import { centerOrigin } from '../util/spriteUtil';
import { PlayerBadge } from './PlayerBadge';
import { addText } from './theme';
import { drawCapsule } from './Screen';

/** Capsule size (the portrait breaks out of its outer end). */
const W = 262;
const H = 84;
const PAD = 26;
const PR = 52; // portrait radius

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

/** Top-left corner of each slot's HUD: P1 top-left, P2 top-right, P3 bottom-left, P4 bottom-right. */
export function hudCorner(slot: number): { x: number; y: number } {
  const left = slot % 2 === 0;
  const top = slot < 2;
  return { x: left ? PAD : GAME_WIDTH - PAD - W, y: top ? PAD + 6 : GAME_HEIGHT - PAD - H - 6 };
}

/** Medal face / rim colours by place. */
const MEDAL_COLORS: [number, number][] = [
  [0xffd45c, 0xc9901f],
  [0xe8eef3, 0x9aa8b4],
  [0xf0a868, 0xa8622a],
  [0xb9b2cc, 0x6f6a86],
];

/** Stat positions inside the capsule: relic then chips left to right, clear of the portrait end. */
function statX(flip: boolean): { relicIcon: number; relicText: number; chipIcon: number; chipText: number } {
  const x0 = flip ? 26 : 118;
  return { relicIcon: x0, relicText: x0 + 18, chipIcon: x0 + 70, chipText: x0 + 88 };
}

/**
 * Compact corner HUD: a translucent capsule with the character portrait breaking its outer end,
 * a large rank numeral, relic and chip counts, and owned items as small bubbles.
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

  /** Local x inside the capsule, mirrored for right-hand panels. */
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
    const glow = s.add.graphics();
    const bg = s.add.graphics();
    // soft shadow, capsule, player-colour rim and a top sheen
    drawCapsule(bg, W, H, color);

    // Portrait breaking out of the outer end.
    const pcx = this.lx(f, 40);
    const pcy = H / 2;
    const portraitRoot = s.add.container(pcx, pcy);
    const disc = s.add.graphics();
    disc.fillStyle(0x06141a, 0.3);
    disc.fillCircle(3, 5, PR + 4);
    disc.fillStyle(0xfff4dc, 1);
    disc.fillCircle(0, 0, PR + 4);
    disc.fillStyle(CHARACTERS[p.characterId].color, 0.55);
    disc.fillCircle(0, 0, PR);
    disc.fillStyle(0xffffff, 0.25);
    disc.fillEllipse(-PR * 0.25, -PR * 0.45, PR * 1.1, PR * 0.6);
    const portrait = s.add.sprite(0, 74, CHARACTERS[p.characterId].atlas, '0');
    portrait.setOrigin(0.5, 0.62).setScale(0.62).setFlipX(flip);
    const maskG = s.make.graphics({ x: 0, y: 0 }, false);
    maskG.fillStyle(0xffffff);
    maskG.fillCircle(x + pcx, y + pcy, PR);
    portrait.setMask(maskG.createGeometryMask());
    const ring = s.add.graphics();
    ring.lineStyle(6, color, 1);
    ring.strokeCircle(0, 0, PR + 1);
    const badge = new PlayerBadge(s, flip ? -PR * 0.78 : PR * 0.78, -PR * 0.62, p.slot, 16);
    portraitRoot.add([disc, portrait, ring, badge]);

    // Name + CPU tag
    const nameX = this.lx(f, 104);
    const name = addText(s, nameX, 24, CHARACTERS[p.characterId].name.split(' ')[0].toUpperCase(), 21, {
      color: CSS.cream,
      weight: 700,
      align: flip ? 'right' : 'left',
    });
    const parts: Phaser.GameObjects.GameObject[] = [name];
    if (p.isCpu) {
      const tw = 44;
      const tx = flip ? nameX - name.width - 10 - tw : nameX + name.width + 10;
      const tag = s.add.graphics();
      tag.fillStyle(0xffffff, 0.14);
      tag.fillRoundedRect(tx, 12, tw, 24, 12);
      parts.push(tag, addText(s, tx + tw / 2, 24, 'CPU', 13, { color: CSS.creamDark, weight: 700 }));
    }
    // Relics then chips, in the same left-to-right order in every corner (only the portrait mirrors).
    const sx = statX(flip);
    const relicIcon = s.add.image(sx.relicIcon, 58, 'prism-relic').setScale(0.15);
    const relicText = addText(s, sx.relicText, 59, '0', 38, { color: CSS.cream, weight: 700, align: 'left', stroke: '#06141a', strokeThickness: 4 }).setOrigin(0, 0.5);
    const chipIcon = s.add.sprite(sx.chipIcon, 58, 'items', '0');
    const co = centerOrigin('items', '0');
    chipIcon.setOrigin(co.x, co.y).setScale(0.19);
    const chipsText = addText(s, sx.chipText, 59, '0', 38, { color: CSS.cream, weight: 700, align: 'left', stroke: '#06141a', strokeThickness: 4 }).setOrigin(0, 0.5);
    // Rank medal on the portrait's outer lower edge (gold / silver / bronze / steel).
    const medal = s.add.container(flip ? PR * 0.78 : -PR * 0.78, PR * 0.7);
    const medalG = s.add.graphics();
    // Starts empty so the first update always draws the medal (a leader's '1st' would otherwise match).
    const rankText = addText(s, 0, -1, '', 17, { color: '#3a2410', weight: 700 });
    medal.add([medalG, rankText]);
    // Owned items as bubbles hanging below (top row) or above (bottom row) the capsule.
    const items = s.add.container(this.lx(f, 128), top ? H + 26 : -26);
    portraitRoot.add(medal);
    root.add([glow, bg, ...parts, relicIcon, relicText, chipIcon, chipsText, items, portraitRoot]);
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
    return { x: x + statX(slot % 2 === 1).chipIcon, y: y + 58 };
  }

  relicAnchor(slot: number): { x: number; y: number } {
    const { x, y } = hudCorner(slot);
    return { x: x + statX(slot % 2 === 1).relicIcon, y: y + 58 };
  }

  setActive(slot: number | null): void {
    for (const v of this.panels.values()) {
      v.glow.clear();
      this.scene.tweens.killTweensOf(v.glow);
      this.scene.tweens.killTweensOf(v.portraitRoot);
      v.glow.setAlpha(1);
      const active = v.slot === slot;
      this.scene.tweens.add({ targets: v.portraitRoot, scale: active ? 1.1 : 1, duration: 220, ease: 'Back.Out' });
      if (active) {
        const c = PLAYER_COLORS[v.slot];
        v.glow.lineStyle(14, c, 0.28);
        v.glow.strokeRoundedRect(-7, -7, W + 14, H + 14, H / 2 + 7);
        v.glow.lineStyle(5, COLORS.crystalLight, 0.95);
        v.glow.strokeRoundedRect(-4, -4, W + 8, H + 8, H / 2 + 4);
        this.scene.tweens.add({ targets: v.glow, alpha: { from: 1, to: 0.4 }, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
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
        g.fillStyle(0x06141a, 0.35);
        g.fillCircle(2, 3, 24);
        g.fillStyle(mc[1], 1);
        g.fillCircle(0, 0, 24);
        g.fillStyle(mc[0], 1);
        g.fillCircle(0, -1, 20);
        g.fillStyle(0xffffff, 0.35);
        g.fillEllipse(-5, -9, 22, 10);
        g.lineStyle(2, 0x3a2410, 0.55);
        g.strokeCircle(0, 0, 24);
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
        v.chipsText.setColor(CSS.cream);
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
      const bx = (v.flip ? -1 : 1) * i * 56;
      const g = this.scene.add.graphics();
      g.fillStyle(0x06141a, 0.3);
      g.fillCircle(bx + 2, 3, 25);
      g.fillStyle(0x0c2630, 0.9);
      g.fillCircle(bx, 0, 25);
      g.lineStyle(3, i === items.length ? COLORS.crystal : COLORS.gold, 0.95);
      g.strokeCircle(bx, 0, 25);
      const img = icon.frame !== undefined ? this.scene.add.sprite(bx, 0, icon.texture, icon.frame) : this.scene.add.image(bx, 0, icon.texture);
      if (icon.frame !== undefined) {
        const o = centerOrigin(icon.texture, icon.frame);
        img.setOrigin(o.x, o.y);
      }
      img.setScale(icon.scale * 0.34);
      v.items.add([g, img]);
    });
  }

  setVisible(v: boolean): void {
    for (const p of this.panels.values()) p.root.setVisible(v);
  }
}
