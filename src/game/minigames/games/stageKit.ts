// Small, TV-friendly effect helpers shared by Totem Tug, Relic Relay and Tumble Tower: word pop-ups
// baked once into textures ("PERFECT", "SAVE!", "1ST!"), pooled ground rings, and HUD portraits
// baked into a texture. Frequent effects reuse baked textures and pooled images, so nothing
// re-renders text or builds geometry masks while a round is running.
import Phaser from 'phaser';
import { FONT, PLAYER_COLORS, PLAYER_SHAPES } from '../../constants';
import { CHARACTERS, type CharacterId } from '../../data/characters';
import { LITE } from '../../perf';
import { settings } from '../../save/SettingsManager';
import { drawPlayerShape } from '../../ui/PlayerBadge';
import { placePortraitSprite } from '../../ui/Portrait';

/** Particle and debris counts: halved in Lite (the TV). EffectsManager scales for Reduced Motion itself. */
export function liteCount(n: number): number {
  return LITE ? Math.max(1, Math.round(n / 2)) : n;
}

/** Decorative motion (speed lines, trails, wobbles) is toned down with Reduced Motion on. */
export function calmMotion(): boolean {
  return settings.get().reducedMotion;
}

export interface WordStyle {
  size: number;
  /** Fill gradient, top to bottom: a light-to-deeper ramp reads as a stamped badge. */
  fill: readonly [string, string];
  /** Outline colour (default: the ink used by titles). */
  stroke?: string;
}

/**
 * Bake a short word into a canvas texture once and return its key. Text objects re-render their
 * canvas on every change, so pop-ups that fire several times a second use these instead.
 */
export function bakeWord(scene: Phaser.Scene, key: string, text: string, s: WordStyle): string {
  if (scene.textures.exists(key)) return key;
  const font = `700 ${s.size}px ${FONT}`;
  const probe = document.createElement('canvas').getContext('2d');
  let width = s.size * text.length * 0.62;
  if (probe) {
    probe.font = font;
    width = probe.measureText(text).width;
  }
  const pad = Math.ceil(s.size * 0.32);
  const w = Math.ceil(width + pad * 2);
  const h = Math.ceil(s.size * 1.45 + pad);
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return key;
  const ctx = tex.getContext();
  const cx = w / 2;
  const cy = h / 2 - s.size * 0.04;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // Soft drop shadow under a slim ink outline (the same recipe as addTitle).
  ctx.shadowColor = 'rgba(10,17,32,0.42)';
  ctx.shadowBlur = Math.max(3, s.size / 9);
  ctx.shadowOffsetY = Math.max(2, s.size / 16);
  ctx.lineWidth = Math.max(4, s.size / 7);
  ctx.strokeStyle = s.stroke ?? '#1f2940';
  ctx.strokeText(text, cx, cy);
  ctx.shadowColor = 'rgba(0,0,0,0)';
  const grad = ctx.createLinearGradient(0, cy - s.size * 0.45, 0, cy + s.size * 0.45);
  grad.addColorStop(0, s.fill[0]);
  grad.addColorStop(1, s.fill[1]);
  ctx.fillStyle = grad;
  ctx.fillText(text, cx, cy);
  tex.refresh();
  return key;
}

export interface PopOpts {
  scale?: number;
  /** How far it drifts up while it shows (px). */
  rise?: number;
  /** Time on screen before it fades (ms). */
  hold?: number;
  depth?: number;
  /** Screen-space (for scrolling cameras). */
  fixed?: boolean;
  /** Start angle; it settles to 0 (a little slam). */
  tilt?: number;
  /** Owner id: a new pop replaces the owner's previous one instead of stacking on top of it. */
  owner?: number;
  /** Skip this pop if the same word is already showing within this many px (two players at once). */
  near?: number;
}

/**
 * Pooled word pop-ups: a baked word jumps in, drifts up and fades. They run on the scene's tween
 * clock, so a hit-stop freezes them along with everything else.
 */
export class WordPops {
  private free: Phaser.GameObjects.Image[] = [];
  private count = 0;
  private owned = new Map<number, Phaser.GameObjects.Image>();
  private mine = new Set<Phaser.GameObjects.Image>();

  constructor(
    private scene: Phaser.Scene,
    private depth = 8600,
    private max = 18,
  ) {}

  pop(key: string, x: number, y: number, o: PopOpts = {}): Phaser.GameObjects.Image | null {
    if (o.near !== undefined) {
      for (const img of this.mine) {
        if (img.active && img.texture.key === key && Math.abs(img.x - x) < o.near && Math.abs(img.y - y) < o.near) return null;
      }
    }
    if (o.owner !== undefined) {
      const prev = this.owned.get(o.owner);
      if (prev) this.recycle(prev);
    }
    let img = this.free.pop();
    if (!img) {
      if (this.count >= this.max) return null;
      this.count++;
      img = this.scene.add.image(0, 0, key);
      this.mine.add(img);
    }
    const s = o.scale ?? 1;
    const hold = o.hold ?? 380;
    img.setTexture(key).setPosition(x, y).setScale(s * 0.35).setAlpha(1).setAngle(o.tilt ?? 0).setVisible(true).setActive(true);
    img.setDepth(o.depth ?? this.depth).setScrollFactor(o.fixed ? 0 : 1);
    const tw = this.scene.tweens;
    tw.add({ targets: img, scale: s, angle: 0, duration: 150, ease: 'Back.Out' });
    tw.add({ targets: img, y: y - (o.rise ?? 34), duration: hold + 220, ease: 'Cubic.Out' });
    tw.add({ targets: img, alpha: 0, delay: hold, duration: 220, ease: 'Quad.In', onComplete: () => this.recycle(img) });
    if (o.owner !== undefined) this.owned.set(o.owner, img);
    return img;
  }

  /** Clear every pop-up on screen now (e.g. before a result banner, so nothing collides with it). */
  clear(): void {
    for (const img of this.mine) this.recycle(img);
  }

  private recycle(img: Phaser.GameObjects.Image): void {
    if (!img.active) return;
    this.scene.tweens.killTweensOf(img);
    img.setVisible(false).setActive(false);
    this.free.push(img);
    for (const [k, v] of this.owned) if (v === img) this.owned.delete(k);
  }
}

export interface RingOpts {
  tint?: number;
  /** Start and end width (px). */
  from?: number;
  to?: number;
  /** Height as a share of the width (flat rings lie on the ground). */
  squash?: number;
  duration?: number;
  alpha?: number;
  depth?: number;
  add?: boolean;
}

/** Pooled expanding rings (dust rings, beat thumps, shockwaves) from the shared 'fx-ring' texture. */
export class RingBursts {
  private free: Phaser.GameObjects.Image[] = [];
  private count = 0;

  constructor(
    private scene: Phaser.Scene,
    private max = 12,
  ) {}

  burst(x: number, y: number, o: RingOpts = {}): void {
    if (!this.scene.textures.exists('fx-ring')) return;
    let img = this.free.pop();
    if (!img) {
      if (this.count >= this.max) return;
      this.count++;
      img = this.scene.add.image(0, 0, 'fx-ring');
    }
    const squash = o.squash ?? 0.34;
    const k0 = (o.from ?? 40) / 128;
    const k1 = (o.to ?? 200) / 128;
    img.setPosition(x, y).setScale(k0, k0 * squash).setAlpha(o.alpha ?? 0.8).setTint(o.tint ?? 0xffffff).setVisible(true).setActive(true);
    img.setDepth(o.depth ?? 0).setBlendMode(o.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    this.scene.tweens.add({
      targets: img,
      scaleX: k1,
      scaleY: k1 * squash,
      alpha: 0,
      duration: o.duration ?? 420,
      ease: 'Cubic.Out',
      onComplete: () => {
        img.setVisible(false).setActive(false);
        this.free.push(img);
      },
    });
  }
}

/**
 * Bake a round character portrait (white rim, player-colour ring, head and shoulders on the
 * character's colour, the player's shape badge on the rim, since colour is never the only cue)
 * into a texture, so a marker can move freely without a geometry mask. Baked once per character,
 * slot and size; returns the texture key (about 2.4r + 14 px square).
 */
export function bakePortrait(scene: Phaser.Scene, id: CharacterId, slot: number, r: number): string {
  const key = `stage-port-${id}-${slot}-${r}`;
  if (scene.textures.exists(key)) return key;
  const size = Math.ceil(r * 2.4 + 14);
  const c = size / 2;
  const dt = scene.textures.addDynamicTexture(key, size, size);
  if (!dt) return key;
  const k = r / 56;
  const disc = scene.make.graphics({ x: 0, y: 0 }, false);
  disc.fillStyle(CHARACTERS[id].color, 1);
  disc.fillCircle(0, 0, r - 3 * k);
  disc.fillStyle(0xffffff, 0.22);
  disc.fillCircle(0, -r * 0.35, r * 0.62);
  const spr = scene.make.sprite({ key: CHARACTERS[id].atlas, frame: '0' }, false);
  placePortraitSprite(spr, id, 0.62 * k, 0.26 * r, false);
  // Everything outside the disc is erased with a thick ring, then the rim goes on top.
  const cut = scene.make.graphics({ x: 0, y: 0 }, false);
  cut.lineStyle(size, 0xffffff, 1);
  cut.strokeCircle(0, 0, r - 3 * k + size / 2);
  const rim = scene.make.graphics({ x: 0, y: 0 }, false);
  rim.lineStyle(5 * k + 2, 0x0a1120, 0.25);
  rim.strokeCircle(0, 3, r + 3 * k);
  rim.lineStyle(9 * k, 0xffffff, 1);
  rim.strokeCircle(0, 0, r + 1.5 * k);
  rim.lineStyle(4 * k, PLAYER_COLORS[slot], 1);
  rim.strokeCircle(0, 0, r - 1 * k);
  drawPlayerShape(rim, PLAYER_SHAPES[slot], -r * 0.78, -r * 0.72, Math.max(6, r * 0.3), PLAYER_COLORS[slot], 0xffffff, 2.5);
  dt.draw(disc, c, c);
  dt.draw(spr, c + spr.x, c + spr.y);
  dt.erase(cut, c, c);
  dt.draw(rim, c, c);
  disc.destroy();
  spr.destroy();
  cut.destroy();
  rim.destroy();
  return key;
}
