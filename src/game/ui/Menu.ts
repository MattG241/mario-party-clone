import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { CSS } from '../constants';
import type { Controls } from '../input/Controls';
import { settings } from '../save/SettingsManager';
import { drawCard, tintToward, UI } from './Style';
import { addText, textScale } from './theme';

export interface MenuItem {
  label: string | (() => string);
  /** Longer description shown by the owner (via onFocus). */
  hint?: string;
  /** Right-aligned value (settings rows). */
  value?: () => string;
  onSelect?: () => void;
  /** Left/right on this row (settings values). */
  onChange?: (dir: -1 | 1) => void;
  disabled?: () => boolean;
}

export interface MenuOptions {
  width?: number;
  itemHeight?: number;
  gap?: number;
  fontSize?: number;
  horizontal?: boolean;
  wrap?: boolean;
  onCancel?: () => void;
  onFocus?: (item: MenuItem, index: number) => void;
  /** Colour theme for the face when focused. */
  focusFill?: number;
}

/**
 * A bevelled card button. The focused one turns gold, pops up with a quick flash and keeps a
 * softly breathing glow; pressing squashes it with a bright click. Every menu shares this, so
 * focus and presses feel the same on every screen.
 */
export class MenuButton extends Phaser.GameObjects.Container {
  private base: Phaser.GameObjects.Graphics;
  private face: Phaser.GameObjects.Container;
  private faceG: Phaser.GameObjects.Graphics;
  private glow: Phaser.GameObjects.Graphics;
  /** White overlay flashed on focus and on press. */
  private flash: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private valueText?: Phaser.GameObjects.Text;
  private glowTween?: Phaser.Tweens.Tween;
  /** The focus pop / settle tween (only this one is replaced on a focus change, so a screen's own
   *  entrance tweens on the button carry on). */
  private scaleTween?: Phaser.Tweens.Tween;
  private selected = false;
  private disabled = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    readonly bw: number,
    readonly bh: number,
    private item: MenuItem,
    fontSize: number,
    private focusFill: number,
  ) {
    super(scene, x, y);
    this.base = scene.add.graphics();
    this.glow = scene.add.graphics().setAlpha(0);
    this.faceG = scene.add.graphics();
    this.flash = scene.add.graphics().setAlpha(0);
    this.face = scene.add.container(0, 0, [this.faceG]);
    const hasValue = !!item.value;
    const w = bw;
    const h = bh;
    this.label = addText(scene, hasValue ? -w / 2 + 34 : 0, -2, '', fontSize, { color: CSS.ink, weight: 700, align: hasValue ? 'left' : 'center' });
    this.face.add(this.label);
    if (hasValue) {
      this.valueText = addText(scene, w / 2 - 34, -2, '', fontSize, { color: CSS.tealDark, weight: 700, align: 'right' });
      this.face.add(this.valueText);
    }
    this.face.add(this.flash);
    this.add([this.glow, this.base, this.face]);
    this.setSize(w, h);
    this.redraw();
    this.refresh();
  }

  refresh(): void {
    const l = typeof this.item.label === 'function' ? this.item.label() : this.item.label;
    this.label.setText(l);
    if (this.valueText && this.item.value) this.valueText.setText(this.item.value());
    const dis = this.item.disabled?.() ?? false;
    if (dis !== this.disabled) {
      this.disabled = dis;
      this.redraw();
    }
    // Keep long labels inside the face.
    const maxW = this.valueText ? this.bw * 0.55 : this.bw - 40;
    this.label.setScale(this.label.width > maxW ? maxW / this.label.width : 1);
  }

  private radius(): number {
    return Math.min(24, this.bh / 2.2);
  }

  private redraw(): void {
    // Bevelled card faces with ink text; the focused one turns warm gold with a bright inner rim.
    const w = this.bw;
    const h = this.bh;
    const r = this.radius();
    this.base.clear();
    this.faceG.clear();
    this.glow.clear();
    this.flash.clear();
    const focused = this.selected && !this.disabled;
    const fill = focused ? this.focusFill : this.disabled ? UI.cardSoft : UI.card;
    drawCard(this.faceG, -w / 2, -h / 2, w, h, {
      radius: r,
      fill,
      alpha: this.disabled ? 0.75 : 1,
      shadow: this.disabled ? 0.4 : focused ? 1.3 : 0.8,
      bevel: !this.disabled,
    });
    if (focused) {
      this.faceG.lineStyle(2, 0xffffff, 0.7);
      this.faceG.strokeRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, Math.max(2, r - 4));
      // Soft halo just outside the face (its alpha breathes while focused).
      for (let k = 0; k < 3; k++) {
        this.glow.lineStyle(6, tintToward(this.focusFill, 0xffffff, 0.35), 0.34 - k * 0.1);
        this.glow.strokeRoundedRect(-w / 2 - 4 - k * 4, -h / 2 - 4 - k * 4, w + 8 + k * 8, h + 8 + k * 8, r + 4 + k * 4);
      }
    }
    this.flash.fillStyle(0xffffff, 1);
    this.flash.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    this.label.setColor(this.disabled ? '#a2a9b8' : UI.inkCss);
    this.valueText?.setColor(focused ? UI.inkCss : '#2a7f9e');
  }

  setSelected(sel: boolean, animate = true): void {
    if (sel === this.selected) return;
    this.selected = sel;
    this.redraw();
    this.glowTween?.stop();
    this.glowTween = undefined;
    const tw = this.scene.tweens;
    this.scaleTween?.stop();
    this.scaleTween = undefined;
    const reduced = settings.get().reducedMotion;
    if (sel) {
      if (animate && !reduced) {
        this.scaleTween = tw.add({ targets: this, scale: { from: 0.97, to: 1.05 }, duration: 180, ease: 'Back.Out' });
        this.flashOnce(0.45, 220);
      } else this.setScale(1.05);
      if (!this.disabled) {
        this.glow.setAlpha(reduced ? 0.7 : 0.45);
        if (!reduced) this.glowTween = tw.add({ targets: this.glow, alpha: { from: 0.45, to: 1 }, duration: 760, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      }
    } else {
      this.glow.setAlpha(0);
      this.scaleTween = tw.add({ targets: this, scale: 1, duration: 120, ease: 'Quad.Out' });
    }
  }

  private flashOnce(from: number, ms: number): void {
    this.scene.tweens.killTweensOf(this.flash);
    this.flash.setAlpha(from);
    this.scene.tweens.add({ targets: this.flash, alpha: 0, duration: ms, ease: 'Quad.Out' });
  }

  /** Click feedback: a quick squash and a bright flash on the face. */
  press(): void {
    const tw = this.scene.tweens;
    tw.killTweensOf(this.face);
    this.face.setScale(1);
    if (settings.get().reducedMotion) {
      tw.add({ targets: this.face, scale: 0.97, duration: 60, yoyo: true, ease: 'Quad.Out' });
    } else {
      tw.add({
        targets: this.face,
        scaleX: 1.06,
        scaleY: 0.86,
        duration: 55,
        ease: 'Quad.Out',
        onComplete: () => tw.add({ targets: this.face, scaleX: 1, scaleY: 1, duration: 200, ease: 'Back.Out' }),
      });
    }
    this.flashOnce(0.75, 240);
  }

  get isDisabled(): boolean {
    return this.disabled;
  }

  override destroy(fromScene?: boolean): void {
    // Looping focus tweens would otherwise keep running on a destroyed button.
    this.glowTween?.stop();
    this.scaleTween?.stop();
    this.scene?.tweens.killTweensOf([this, this.face, this.flash, this.glow]);
    super.destroy(fromScene);
  }
}

/** Vertical or horizontal list of buttons driven by a Controls instance. */
export class Menu extends Phaser.GameObjects.Container {
  readonly buttons: MenuButton[] = [];
  index = 0;
  enabled = true;
  private opts: Required<Omit<MenuOptions, 'onCancel' | 'onFocus'>> & Pick<MenuOptions, 'onCancel' | 'onFocus'>;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    readonly items: MenuItem[],
    opts: MenuOptions = {},
  ) {
    super(scene, x, y);
    const ts = textScale();
    this.opts = {
      width: opts.width ?? 520,
      itemHeight: Math.round((opts.itemHeight ?? 78) * (ts > 1 ? 1.08 : 1)),
      gap: opts.gap ?? 22,
      fontSize: opts.fontSize ?? 34,
      horizontal: opts.horizontal ?? false,
      wrap: opts.wrap ?? true,
      focusFill: opts.focusFill ?? UI.focus,
      onCancel: opts.onCancel,
      onFocus: opts.onFocus,
    };
    const { width, itemHeight, gap, horizontal } = this.opts;
    const n = items.length;
    const total = horizontal ? n * width + (n - 1) * gap : n * itemHeight + (n - 1) * gap;
    items.forEach((item, i) => {
      const off = -total / 2 + i * ((horizontal ? width : itemHeight) + gap) + (horizontal ? width : itemHeight) / 2;
      const b = new MenuButton(scene, horizontal ? off : 0, horizontal ? 0 : off, width, itemHeight, item, this.opts.fontSize, this.opts.focusFill);
      this.buttons.push(b);
      this.add(b);
    });
    scene.add.existing(this);
    this.index = this.firstEnabled(0, 1);
    this.buttons[this.index]?.setSelected(true, false);
    this.opts.onFocus?.(items[this.index], this.index);
  }

  private firstEnabled(from: number, dir: 1 | -1): number {
    const n = this.items.length;
    for (let k = 0; k < n; k++) {
      const i = (((from + dir * k) % n) + n) % n;
      if (!this.buttons[i]?.isDisabled) return i;
    }
    return from;
  }

  focus(i: number, sound = true): void {
    if (i === this.index) return;
    this.buttons[this.index]?.setSelected(false);
    this.index = i;
    this.buttons[i]?.setSelected(true);
    if (sound) audio.play('menuMove');
    this.opts.onFocus?.(this.items[i], i);
  }

  refresh(): void {
    for (const b of this.buttons) b.refresh();
  }

  private step(dir: 1 | -1): void {
    const n = this.items.length;
    let i = this.index;
    for (let k = 0; k < n; k++) {
      i += dir;
      if (i < 0 || i >= n) {
        if (!this.opts.wrap) return;
        i = (i + n) % n;
      }
      if (!this.buttons[i].isDisabled) {
        this.focus(i);
        return;
      }
    }
  }

  /** Process one frame of input. Returns true if something happened. */
  handle(c: Controls): boolean {
    if (!this.enabled || !this.visible) return false;
    const nav = c.nav();
    const { horizontal } = this.opts;
    const item = this.items[this.index];
    if (nav) {
      if ((!horizontal && nav === 'up') || (horizontal && nav === 'left')) {
        this.step(-1);
        return true;
      }
      if ((!horizontal && nav === 'down') || (horizontal && nav === 'right')) {
        this.step(1);
        return true;
      }
      if (!horizontal && item?.onChange && (nav === 'left' || nav === 'right')) {
        item.onChange(nav === 'left' ? -1 : 1);
        audio.play('menuMove', { rate: nav === 'left' ? 0.9 : 1.1 });
        this.refresh();
        return true;
      }
    }
    if (c.pressed('A')) {
      if (!item || this.buttons[this.index].isDisabled) {
        audio.play('error');
        return true;
      }
      this.buttons[this.index].press();
      if (item.onSelect) {
        audio.play('confirm');
        item.onSelect();
      } else if (item.onChange) {
        item.onChange(1);
        audio.play('menuMove');
      }
      this.refresh();
      return true;
    }
    if (c.pressed('B') && this.opts.onCancel) {
      audio.play('cancel');
      this.opts.onCancel();
      return true;
    }
    return false;
  }
}
