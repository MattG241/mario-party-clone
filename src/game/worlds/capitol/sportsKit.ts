// Pieces shared by the Capitol Gardens sports minigames (Free Throw Frenzy, Fairway Frenzy): their
// rendered sprites (with Lite's half-size copies) and a gallery of festival folk who cheer.
import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../data/npcs';
import { LITE } from '../../perf';
import { standOrigin } from '../../util/spriteUtil';
import { inflateTexture } from '../../util/texture';

/** Texture key of a world minigame sprite (public/assets/rendered/mg/<file>.webp). */
export function spriteKey(file: string): string {
  return `wmg-${file}`;
}

function halfSize(scene: Phaser.Scene): boolean {
  return LITE && scene.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;
}

/** Queue sprites on the scene's loader (call from preload): Lite on WebGL loads the half-size copies. */
export function queueSprites(scene: Phaser.Scene, files: readonly string[]): void {
  const dir = halfSize(scene) ? 'assets/lite/mg' : 'assets/rendered/mg';
  for (const f of files) {
    const key = spriteKey(f);
    if (!scene.textures.exists(key)) scene.load.image(key, `${dir}/${f}.webp`);
  }
}

/** Half-size textures already stretched back to full size (so a reused texture isn't stretched twice). */
const inflated = new Set<string>();

/** After loading (call from create): stretch Lite's half-size sprites back over full-size coordinates. */
export function finishSprites(scene: Phaser.Scene, files: readonly string[]): void {
  if (!halfSize(scene)) return;
  for (const f of files) {
    const key = spriteKey(f);
    if (scene.textures.exists(key) && !inflated.has(key)) {
      inflateTexture(scene.textures.get(key), 2);
      inflated.add(key);
    }
  }
}

/**
 * Paint a small canvas texture once (fallback art when a rendered sprite is missing). It is drawn at
 * full size, so it is marked as never to be stretched by finishSprites on a later run.
 */
export function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  paint(tex.getContext());
  tex.refresh();
  inflated.add(key);
}

export interface GallerySpot {
  x: number;
  y: number;
  id: NpcId;
  pose: string;
  scale?: number;
  /** Faces left (towards the middle when standing on the right). */
  flip?: boolean;
}

/**
 * Festival folk watching from the edges of an arena: they sway on the spot and hop when something
 * big happens (cheer). Each stands on a soft contact shadow; farther rows are hazed a touch.
 */
export class Gallery {
  private folk: { spr: Phaser.GameObjects.Sprite; y: number }[] = [];
  private cheerAt = -1e9;

  constructor(
    private scene: Phaser.Scene,
    spots: readonly GallerySpot[],
    depthOf: (y: number) => number = (y) => y,
  ) {
    if (!scene.textures.exists(NPC_ATLAS)) return;
    spots.forEach((s, i) => {
      const frame = npcFrame(s.id, s.pose);
      const k = s.scale ?? 0.36;
      const spr = scene.add.sprite(s.x, s.y, NPC_ATLAS, frame);
      const o = standOrigin(NPC_ATLAS, frame);
      spr.setOrigin(o.x, o.y).setScale(k).setDepth(depthOf(s.y) + i * 0.001).setFlipX(!!s.flip);
      if (k < 0.33) spr.setTint(0xe8edf5);
      scene.add.image(s.x, s.y + 2, 'fx-contact').setScale(k * 1.4, k * 0.42).setAlpha(0.45).setDepth(depthOf(s.y) - 0.5);
      scene.tweens.add({ targets: spr, angle: { from: -2.5, to: 2.5 }, duration: 820 + (i % 4) * 110, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: (i * 97) % 600 });
      this.folk.push({ spr, y: s.y });
    });
  }

  /** Everyone hops (a Mexican-wave ripple from one side); rationed so a burst of scoring doesn't blur it. */
  cheer(loud = false): void {
    const now = this.scene.time.now;
    if (now - this.cheerAt < 450) return;
    this.cheerAt = now;
    audio.play(loud ? 'crowdCheer' : 'cheer', { volume: loud ? 0.55 : 0.35, throttleMs: 300 });
    this.folk.forEach(({ spr, y }, i) => {
      this.scene.tweens.killTweensOf(spr);
      spr.setY(y);
      this.scene.tweens.add({ targets: spr, y: y - (loud ? 16 : 10), duration: 140, yoyo: true, repeat: loud ? 2 : 1, delay: i * 22, ease: 'Quad.Out', onComplete: () => spr.setY(y) });
      this.scene.tweens.add({ targets: spr, angle: { from: -3, to: 3 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: 500 + i * 22 });
    });
  }
}
