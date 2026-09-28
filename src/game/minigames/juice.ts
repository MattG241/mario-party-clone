// Shared "game feel" helpers: big readable call-outs, camera kicks and punches, and score pop-ups
// that fly to the HUD. They work on any scene, so the minigames and the board speak one visual
// language. Freeze-frames (hit-stop) and slow motion live on BaseMinigame, because they scale the
// game clock itself (see BaseMinigame.hitStop / slowMo).
import Phaser from 'phaser';
import { CSS, GAME_WIDTH } from '../constants';
import { settings } from '../save/SettingsManager';
import { addTitle } from '../ui/theme';

/** Camera motion (kicks, punches) is off when Screen Shake is off or Reduced Motion is on. */
export function cameraMotionOk(): boolean {
  const s = settings.get();
  return s.screenShake && !s.reducedMotion;
}

export interface BannerOpts {
  /** Centre height (default: just above the middle of the screen). */
  y?: number;
  size?: number;
  color?: string;
  /** How long it stays up before lifting away, ms. */
  hold?: number;
  depth?: number;
}

/**
 * A big centre-screen call-out ("FINAL 10 SECONDS!", "PERFECT!") that slams in, holds and lifts
 * away. Returns the text so a caller can restyle it; it destroys itself.
 */
export function banner(scene: Phaser.Scene, text: string, o: BannerOpts = {}): Phaser.GameObjects.Text {
  const t = addTitle(scene, GAME_WIDTH / 2, o.y ?? 440, text, o.size ?? 120, o.color ?? CSS.goldLight).setDepth(o.depth ?? 9600);
  t.setScrollFactor(0).setScale(1.9).setAlpha(0);
  const hold = o.hold ?? 900;
  scene.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 200, ease: 'Back.Out' });
  scene.tweens.add({ targets: t, y: t.y - 40, alpha: 0, scale: 0.92, delay: 200 + hold, duration: 260, ease: 'Quad.In', onComplete: () => t.destroy() });
  return t;
}

interface CamRest {
  x: number;
  y: number;
  zoom: number;
  kick?: Phaser.Tweens.Tween;
  punch?: Phaser.Tweens.Tween;
}

/** Where each camera sits at rest, so overlapping kicks and punches never make it drift. */
const rest = new WeakMap<Phaser.Cameras.Scene2D.Camera, CamRest>();

function restOf(cam: Phaser.Cameras.Scene2D.Camera): CamRest {
  let r = rest.get(cam);
  if (!r || (!r.kick?.isPlaying() && !r.punch?.isPlaying())) {
    r = { x: cam.scrollX, y: cam.scrollY, zoom: cam.zoom };
    rest.set(cam, r);
  }
  return r;
}

/**
 * Knock the camera a few pixels along (dx, dy) and spring back: the recoil of a hit, pointing the
 * way the blow travelled. Only for cameras that aren't following or panning.
 */
export function kick(scene: Phaser.Scene, dx: number, dy: number, ms = 140, cam: Phaser.Cameras.Scene2D.Camera = scene.cameras.main): void {
  if (!cameraMotionOk()) return;
  const r = restOf(cam);
  r.kick?.stop();
  cam.setScroll(r.x, r.y);
  r.kick = scene.tweens.add({ targets: cam, scrollX: r.x - dx, scrollY: r.y - dy, duration: ms * 0.35, ease: 'Quad.Out', yoyo: true, hold: 0, onComplete: () => cam.setScroll(r.x, r.y) });
}

/** A quick zoom in and back out on a big moment. */
export function punch(scene: Phaser.Scene, amount = 0.04, ms = 280, cam: Phaser.Cameras.Scene2D.Camera = scene.cameras.main): void {
  if (!cameraMotionOk()) return;
  const r = restOf(cam);
  r.punch?.stop();
  cam.setZoom(r.zoom);
  r.punch = scene.tweens.add({ targets: cam, zoom: r.zoom * (1 + amount), duration: ms * 0.3, ease: 'Quad.Out', yoyo: true, onComplete: () => cam.setZoom(r.zoom) });
}

/**
 * A score pop-up ("+1") that jumps out at (x, y) and then flies into a HUD point, calling onArrive
 * as it lands (bump the HUD there). Text objects are few and short-lived, so no pool is needed.
 */
export function popToHud(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  toX: number,
  toY: number,
  o: { color?: string; size?: number; depth?: number; onArrive?: () => void } = {},
): void {
  const t = addTitle(scene, x, y, text, o.size ?? 54, o.color ?? CSS.goldLight).setDepth(o.depth ?? 9400).setScale(0.3);
  scene.tweens.add({ targets: t, scale: 1, y: y - 56, duration: 240, ease: 'Back.Out' });
  scene.tweens.add({
    targets: t,
    x: toX,
    y: toY,
    scale: 0.55,
    delay: 380,
    duration: 420,
    ease: 'Cubic.In',
    onComplete: () => {
      o.onArrive?.();
      t.destroy();
    },
  });
}
