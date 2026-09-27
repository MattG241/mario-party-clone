import Phaser from 'phaser';
import { PLAYER_COLORS } from '../constants';
import { CHARACTERS, type CharacterId } from '../data/characters';
import { SPRITE_META } from '../data/spriteMeta.generated';
import { PlayerBadge } from '../ui/PlayerBadge';
import { animKey, CHARACTER_ANIMATIONS, LOOPING, type AnimName } from './CharacterAnimations';

const baselineCache = new Map<string, number>();

/**
 * Where the feet are inside an animation's frames (fraction of the frame height). Rows of the
 * supplied sheets sit at slightly different heights, so each animation gets its own baseline;
 * within an animation the artist's registration is kept intact.
 */
export function animBaseline(id: CharacterId, anim: AnimName): number {
  const k = `${id}:${anim}`;
  const cached = baselineCache.get(k);
  if (cached !== undefined) return cached;
  const def = CHARACTER_ANIMATIONS[id][anim];
  const meta = SPRITE_META[def.atlas ?? CHARACTERS[id].atlas];
  let v = 0.8;
  if (meta) {
    const bottoms = def.frames.map((f) => {
      const fm = meta.frames[f];
      return fm ? (fm.solid[1] + fm.solid[3]) / fm.h : 0.8;
    });
    bottoms.sort((a, b) => a - b);
    v = bottoms[Math.floor(bottoms.length / 2)];
  }
  baselineCache.set(k, v);
  return v;
}

const headCache = new Map<string, number>();

/**
 * Top of the character's head relative to the feet, in local (unscaled) pixels, measured from the
 * solid artwork of the animation's frames. Markers hang just above this so they sit on the right
 * character whatever its height.
 */
export function animHeadTop(id: CharacterId, anim: AnimName = 'idle'): number {
  const k = `${id}:${anim}`;
  const cached = headCache.get(k);
  if (cached !== undefined) return cached;
  const def = CHARACTER_ANIMATIONS[id][anim];
  const meta = SPRITE_META[def.atlas ?? CHARACTERS[id].atlas];
  let v = -235;
  if (meta) {
    const base = animBaseline(id, anim);
    const tops = def.frames.map((f) => {
      const fm = meta.frames[f];
      return fm ? fm.solid[1] - base * fm.h : -235;
    });
    tops.sort((a, b) => a - b);
    v = tops[Math.floor(tops.length / 2)] * (def.scale ?? 1);
  }
  headCache.set(k, v);
  return v;
}

/** Register every character animation with Phaser (call once after atlases load). */
export function registerCharacterAnimations(anims: Phaser.Animations.AnimationManager): void {
  for (const id of Object.keys(CHARACTER_ANIMATIONS) as CharacterId[]) {
    const set = CHARACTER_ANIMATIONS[id];
    for (const name of Object.keys(set) as AnimName[]) {
      const def = set[name];
      const key = animKey(id, name);
      if (anims.exists(key)) continue;
      const atlas = def.atlas ?? CHARACTERS[id].atlas;
      anims.create({
        key,
        frames: def.frames.map((f) => ({ key: atlas, frame: String(f) })),
        frameRate: def.fps,
        repeat: def.loop ? -1 : 0,
      });
    }
  }
}

export interface CharacterOpts {
  scale?: number;
  slot?: number;
  marker?: boolean;
  shadow?: boolean;
}

/**
 * A character standing at the container origin (its feet). Plays named animations; one-shot
 * animations return to idle (or another looping animation) automatically.
 */
export class Character extends Phaser.GameObjects.Container {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow?: Phaser.GameObjects.Container;
  marker?: PlayerBadge;
  readonly charId: CharacterId;
  current: AnimName = 'idle';
  private returnTo: AnimName = 'idle';
  private onDone: (() => void) | null = null;
  private baseSpriteScale = 1;
  private facingLeft = false;
  private playId = 0;
  private finished = false;

  constructor(scene: Phaser.Scene, x: number, y: number, id: CharacterId, opts: CharacterOpts = {}) {
    super(scene, x, y);
    this.charId = id;
    if (opts.shadow !== false) {
      this.shadow = scene.add.container(0, 0);
      if (scene.textures.exists('fx-contact')) {
        // Soft cast shadow falling back-right (the key light is front-left) + a dense contact blob.
        const cast = scene.add.image(44, -18, 'fx-shadow').setScale(2.3, 0.62).setAngle(-14).setAlpha(0.42);
        const contact = scene.add.image(2, 2, 'fx-contact').setScale(1.75, 0.5).setAlpha(0.8);
        this.shadow.add([cast, contact]);
      } else {
        this.shadow.add(scene.add.ellipse(0, 0, 120, 36, 0x0b1a24, 0.28));
      }
      this.add(this.shadow);
    }
    this.sprite = scene.add.sprite(0, 0, CHARACTERS[id].atlas, '0');
    this.add(this.sprite);
    if (opts.slot !== undefined && opts.marker !== false) {
      this.marker = new PlayerBadge(scene, 0, animHeadTop(id) - 46, opts.slot, 22);
      this.add(this.marker);
      const ring = scene.add.ellipse(0, 0, 150, 44);
      ring.setStrokeStyle(5, PLAYER_COLORS[opts.slot], 0.9);
      this.addAt(ring, 1);
    }
    this.setScale(opts.scale ?? 1);
    // Keep the player marker a readable size whatever the character's scale.
    this.marker?.setScale(Math.min(2.2, 1 / (opts.scale ?? 1)));
    this.sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onAnimComplete, this);
    scene.add.existing(this);
    this.play('idle');
  }

  /** Head height above the feet, in local (unscaled) pixels. */
  get headY(): number {
    return animHeadTop(this.charId);
  }

  play(anim: AnimName, opts: { onComplete?: () => void; returnTo?: AnimName; force?: boolean; startFrame?: number } = {}): this {
    const def = CHARACTER_ANIMATIONS[this.charId][anim];
    if (!def) return this;
    if (!opts.force && anim === this.current && this.sprite.anims.isPlaying && LOOPING.includes(anim)) return this;
    // A pending completion callback from an interrupted one-shot still fires.
    const pending = this.onDone;
    this.onDone = null;
    pending?.();
    this.current = anim;
    this.returnTo = opts.returnTo ?? 'idle';
    this.onDone = opts.onComplete ?? null;
    const id = ++this.playId;
    this.finished = false;
    this.baseSpriteScale = def.scale ?? 1;
    this.sprite.setScale(this.baseSpriteScale);
    this.sprite.setOrigin(0.5, animBaseline(this.charId, anim));
    this.sprite.play({ key: animKey(this.charId, anim), startFrame: opts.startFrame ?? 0 }, true);
    if (!def.loop) {
      // Safety net: one-shots always complete, even if the sprite is hidden or paused oddly.
      const ms = (def.frames.length / def.fps) * 1000 + 120;
      this.scene.time.delayedCall(ms, () => this.finish(id));
    }
    this.sprite.setFlipX(this.facingLeft);
    return this;
  }

  /** Hold a pose (single frame) without auto-returning. */
  hold(anim: AnimName, frameIndex = 0): this {
    const def = CHARACTER_ANIMATIONS[this.charId][anim];
    this.onDone = null;
    this.playId++;
    this.finished = true;
    this.current = anim;
    this.returnTo = anim;
    this.baseSpriteScale = def.scale ?? 1;
    this.sprite.stop();
    this.sprite.setTexture(def.atlas ?? CHARACTERS[this.charId].atlas, String(def.frames[Math.min(frameIndex, def.frames.length - 1)]));
    this.sprite.setScale(this.baseSpriteScale);
    this.sprite.setOrigin(0.5, animBaseline(this.charId, anim));
    this.sprite.setFlipX(this.facingLeft);
    return this;
  }

  private onAnimComplete(): void {
    this.finish(this.playId);
  }

  private finish(id: number): void {
    if (id !== this.playId || this.finished || !this.active) return;
    this.finished = true;
    const done = this.onDone;
    this.onDone = null;
    if (!LOOPING.includes(this.current)) {
      const next = this.returnTo;
      if (next !== this.current) this.play(next);
    }
    done?.();
  }

  face(left: boolean): this {
    this.facingLeft = left;
    this.sprite.setFlipX(left);
    return this;
  }

  faceToward(x: number): this {
    if (Math.abs(x - this.x) > 2) this.face(x < this.x);
    return this;
  }

  get isFacingLeft(): boolean {
    return this.facingLeft;
  }

  /** Play a one-shot and resolve when it finishes. */
  playAsync(anim: AnimName, returnTo: AnimName = 'idle'): Promise<void> {
    return new Promise((resolve) => this.play(anim, { onComplete: resolve, returnTo, force: true }));
  }

  /** Little squash-and-stretch landing. */
  squash(amount = 0.14, duration = 150): void {
    this.scene.tweens.add({
      targets: this.sprite,
      scaleX: this.baseSpriteScale * (1 + amount),
      scaleY: this.baseSpriteScale * (1 - amount),
      duration: duration / 2,
      yoyo: true,
      ease: 'Quad.Out',
      onComplete: () => this.sprite.setScale(this.baseSpriteScale),
    });
  }

  override destroy(fromScene?: boolean): void {
    this.sprite?.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onAnimComplete, this);
    this.onDone = null;
    super.destroy(fromScene);
  }
}
