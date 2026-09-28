// Pieces shared by the three Pirate Cove minigames: their sprite atlases (loaded with the scene, the
// Lite half-size copy stretched back over full-size frames, released when the scene closes), the
// festival folk cheering from the edges, and a few small drawing helpers.
import Phaser from 'phaser';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../data/npcs';
import { LITE } from '../../perf';
import { settings } from '../../save/SettingsManager';
import { inflateTexture } from '../../util/texture';
import { standOrigin } from '../../util/spriteUtil';

function halfSize(scene: Phaser.Scene): boolean {
  return LITE && scene.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;
}

const inflated = new Set<string>();

/**
 * Queue one of the world's sprite atlases (public/assets/rendered/mg/<file>.webp + .json) on the scene's
 * loader (call from preload). Lite on WebGL loads the half-size copy from public/assets/lite/mg; the JSON
 * is always the full-size one (see finishAtlas).
 */
export function queueAtlas(scene: Phaser.Scene, key: string, file: string): void {
  if (scene.textures.exists(key)) return;
  const dir = halfSize(scene) ? 'assets/lite/mg' : 'assets/rendered/mg';
  scene.load.atlas(key, `${dir}/${file}.webp`, `assets/rendered/mg/${file}.json`);
}

/**
 * After loading (call from createArena): stretch a Lite half-size atlas back over its full-size frame
 * coordinates, and free the atlas once the scene closes (only one minigame's art is held at a time).
 */
export function finishAtlas(scene: Phaser.Scene, key: string): void {
  if (!scene.textures.exists(key)) return;
  if (halfSize(scene) && !inflated.has(key)) {
    inflateTexture(scene.textures.get(key), 2);
    inflated.add(key);
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    // After the display list has let go of its sprites (it shuts down first), on the next step.
    scene.game.events.once(Phaser.Core.Events.POST_STEP, () => {
      if (scene.textures.exists(key) && !scene.sys.isActive()) {
        scene.textures.remove(key);
        inflated.delete(key);
      }
    });
  });
}

/** Whether an atlas frame is there to draw (a failed load falls back to simple shapes). */
export function hasFrame(scene: Phaser.Scene, key: string, frame: string): boolean {
  return scene.textures.exists(key) && scene.textures.get(key).has(frame);
}

/** Reduced Motion: decorative motion is toned down. */
export function calm(): boolean {
  return settings.get().reducedMotion;
}

export interface CrowdSpot {
  id: NpcId;
  pose: string;
  x: number;
  y: number;
  scale: number;
  flip?: boolean;
  tint?: number;
}

/** Festival folk visiting the cove: they sway while they watch and hop when something big happens. */
export class Crowd {
  readonly sprites: Phaser.GameObjects.Sprite[] = [];
  private homes: number[] = [];

  constructor(
    private scene: Phaser.Scene,
    spots: CrowdSpot[],
    depth: number,
  ) {
    const calmNow = calm();
    spots.forEach((s, i) => {
      let frame = npcFrame(s.id, s.pose);
      if (!scene.textures.get(NPC_ATLAS).has(frame)) frame = npcFrame(s.id, 'idle');
      const spr = scene.add.sprite(s.x, s.y, NPC_ATLAS, frame);
      const o = standOrigin(NPC_ATLAS, frame);
      spr.setOrigin(o.x, o.y).setScale(s.scale).setDepth(depth + s.y * 0.001).setFlipX(s.flip ?? s.x > 960);
      if (s.tint !== undefined) spr.setTint(s.tint);
      if (scene.textures.exists('fx-contact')) scene.add.image(s.x, s.y + 2, 'fx-contact').setScale(s.scale * 1.3, s.scale * 0.38).setAlpha(0.42).setDepth(depth - 1);
      if (!calmNow) scene.tweens.add({ targets: spr, angle: { from: -2.5, to: 2.5 }, duration: 800 + (i % 4) * 110, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: (i * 97) % 600 });
      this.sprites.push(spr);
      this.homes.push(s.y);
    });
  }

  /** Everyone hops (twice for a big moment), each a hair after the last. */
  cheer(big = false): void {
    this.sprites.forEach((spr, i) => {
      const y = this.homes[i];
      this.scene.tweens.killTweensOf(spr);
      spr.setY(y);
      this.scene.tweens.add({ targets: spr, y: y - (big ? 16 : 10), duration: 150, yoyo: true, repeat: big ? 2 : 1, delay: i * 30, ease: 'Quad.Out', onComplete: () => spr.setY(y) });
    });
  }
}

/** Stroke a thick polyline with round joints (Graphics has no round line joins). */
export function thickPolyline(g: Phaser.GameObjects.Graphics, pts: readonly { x: number; y: number }[], n: number, width: number, color: number, alpha = 1): void {
  if (n < 2) return;
  g.lineStyle(width, color, alpha);
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < n; i++) g.lineTo(pts[i].x, pts[i].y);
  g.strokePath();
  g.fillStyle(color, alpha);
  for (let i = 0; i < n; i++) g.fillCircle(pts[i].x, pts[i].y, width / 2);
}
