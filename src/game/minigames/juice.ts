// Shared "game feel" helpers: big readable call-outs, camera kicks and punches, and score pop-ups
// that fly to the HUD. They work on any scene, so the minigames and the board speak one visual
// language. Freeze-frames (hit-stop) and slow motion live on BaseMinigame, because they scale the
// game clock itself (see BaseMinigame.hitStop / slowMo).
import Phaser from 'phaser';
import { CSS, GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { LITE } from '../perf';
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
  /** A dark band behind the words that sweeps in with them (reads on the busiest arena). */
  ribbon?: boolean;
  /** A second, smaller line under the main one ("FINAL 10 SECONDS!" / "CHIP STORM!"). */
  sub?: string;
  subColor?: string;
}

/**
 * A big centre-screen call-out ("FINAL 10 SECONDS!", "PERFECT!") that slams in, holds and lifts
 * away. Returns the text so a caller can restyle it; it destroys itself (with its ribbon and
 * subtitle, when asked for).
 */
export function banner(scene: Phaser.Scene, text: string, o: BannerOpts = {}): Phaser.GameObjects.Text {
  const size = o.size ?? 120;
  const depth = o.depth ?? 9600;
  const y = o.y ?? 440;
  const hold = o.hold ?? 900;
  const subSize = Math.round(size * 0.52);
  // With a subtitle the pair is centred on y: the main line a little above, the subtitle below.
  const mainY = o.sub ? y - subSize * 0.62 : y;
  const t = addTitle(scene, GAME_WIDTH / 2, mainY, text, size, o.color ?? CSS.goldLight).setDepth(depth);
  t.setScrollFactor(0).setScale(1.9).setAlpha(0);
  scene.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 200, ease: 'Back.Out' });
  scene.tweens.add({ targets: t, y: t.y - 40, alpha: 0, scale: 0.92, delay: 200 + hold, duration: 260, ease: 'Quad.In', onComplete: () => t.destroy() });
  if (o.sub) {
    const s = addTitle(scene, GAME_WIDTH / 2, y + size * 0.42, o.sub, subSize, o.subColor ?? CSS.cream).setDepth(depth);
    s.setScrollFactor(0).setScale(0.6).setAlpha(0);
    // The subtitle lands a beat after the headline, so the two read in order.
    scene.tweens.add({ targets: s, scale: 1, alpha: 1, delay: 140, duration: 220, ease: 'Back.Out' });
    scene.tweens.add({ targets: s, y: s.y - 40, alpha: 0, scale: 0.92, delay: 220 + hold, duration: 260, ease: 'Quad.In', onComplete: () => s.destroy() });
  }
  if (o.ribbon) {
    const h = o.sub ? size * 1.95 : size * 1.3;
    const band = scene.add.graphics().setScrollFactor(0).setDepth(depth - 1);
    const half = GAME_WIDTH / 2;
    const fade = 360;
    // Soft-ended navy band with slim gold edges: solid through the middle, fading at both ends.
    band.fillGradientStyle(0x0a1120, 0x0a1120, 0x0a1120, 0x0a1120, 0, 0.55, 0, 0.55);
    band.fillRect(-half, -h / 2, fade, h);
    band.fillStyle(0x0a1120, 0.55);
    band.fillRect(-half + fade, -h / 2, GAME_WIDTH - fade * 2, h);
    band.fillGradientStyle(0x0a1120, 0x0a1120, 0x0a1120, 0x0a1120, 0.55, 0, 0.55, 0);
    band.fillRect(half - fade, -h / 2, fade, h);
    band.fillGradientStyle(0xffe08a, 0xffe08a, 0xffe08a, 0xffe08a, 0, 0.9, 0, 0.9);
    band.fillRect(-half, -h / 2, half, 4);
    band.fillRect(-half, h / 2 - 4, half, 4);
    band.fillGradientStyle(0xffe08a, 0xffe08a, 0xffe08a, 0xffe08a, 0.9, 0, 0.9, 0);
    band.fillRect(0, -h / 2, half, 4);
    band.fillRect(0, h / 2 - 4, half, 4);
    band.setPosition(half, y).setScale(0, 1);
    scene.tweens.add({ targets: band, scaleX: 1, duration: 220, ease: 'Cubic.Out' });
    scene.tweens.add({ targets: band, alpha: 0, scaleY: 0.6, delay: 220 + hold, duration: 260, ease: 'Quad.In', onComplete: () => band.destroy() });
  }
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
 * Stop any kick or punch in flight and put the camera back at rest: call before starting a camera
 * move of your own (a push-in), so a recoil finishing later can't snap it back.
 */
export function settleCamera(cam: Phaser.Cameras.Scene2D.Camera): void {
  const r = rest.get(cam);
  if (!r) return;
  const moving = !!(r.kick?.isPlaying() || r.punch?.isPlaying());
  r.kick?.stop();
  r.punch?.stop();
  if (moving) cam.setScroll(r.x, r.y).setZoom(r.zoom);
  rest.delete(cam);
}

/**
 * A display title (addTitle's look) as a plain image, rendered once per text/size/colour and then
 * reused: for pop-ups that repeat many times a round ("+1", "NICE!"), where rasterising a fresh
 * text each time would cost a TV browser a frame. Keep the set of distinct texts small.
 */
export function titleImage(scene: Phaser.Scene, x: number, y: number, text: string, size: number, color: string = '#ffffff'): Phaser.GameObjects.Image {
  return scene.add.image(x, y, titleTexture(scene, text, size, color));
}

/** Texture key of a display title rendered once and kept (see titleImage). */
export function titleTexture(scene: Phaser.Scene, text: string, size: number, color: string = '#ffffff'): string {
  const key = `title:${text}:${size}:${color}`;
  if (!scene.textures.exists(key)) {
    const t = addTitle(scene, 0, 0, text, size, color);
    const src = t.canvas;
    const copy = document.createElement('canvas');
    copy.width = src.width;
    copy.height = src.height;
    copy.getContext('2d')?.drawImage(src, 0, 0);
    t.destroy();
    scene.textures.addCanvas(key, copy);
  }
  return key;
}

/** A score pop-up in flight (see popToHud): its image, and whether it is still gathering before it flies. */
export interface HudPop {
  image: Phaser.GameObjects.Image;
  /** True until the pop-up sets off for the HUD: while it is, retitle() can add to it ("+1" -> "+2"). */
  readonly gathering: boolean;
  /** Change its text (same size and colour, unless given), e.g. to merge quick pickups into one. */
  retitle(text: string, color?: string): void;
}

/** How long a score pop-up hangs where it popped before it sets off for the HUD, and its flight, ms. */
const POP_HANG = 300;
const POP_FLIGHT = 400;

/**
 * A score pop-up ("+1") that jumps out at (x, y) and then arcs into a HUD point, calling onArrive
 * as it lands (bump the HUD there). (x, y) is a world point; the pop-up itself is pinned to the
 * screen, so it lands on the HUD even while the camera scrolls or recoils. Each distinct text is
 * rendered once and reused (titleImage), so frequent pop-ups stay cheap. Returns a handle: while
 * it is still gathering, quick follow-up pickups can be merged into it (HudPop.retitle).
 */
export function popToHud(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  toX: number,
  toY: number,
  o: { color?: string; size?: number; depth?: number; onArrive?: () => void } = {},
): HudPop {
  const cam = scene.cameras.main;
  const size = o.size ?? 54;
  let color = o.color ?? CSS.goldLight;
  // Where (x, y) is on screen, zoom included; then everything is placed in screen terms, divided
  // back out of the zoom (so it keeps course while the camera zooms, e.g. a finish push-in).
  const ox = cam.width * cam.originX;
  const oy = cam.height * cam.originY;
  const z0 = cam.zoom || 1;
  const sx = ox + z0 * (x - cam.scrollX - ox);
  const sy = oy + z0 * (y - cam.scrollY - oy);
  // Named 'juice:' so BaseMinigame's zoom steadying knows it already allows for the zoom.
  const t = titleImage(scene, sx, sy, text, size, color).setDepth(o.depth ?? 9400).setScrollFactor(0).setName('juice:pop');
  // A little extra pop on top of the base scale when a merge bumps it.
  let bump = 0;
  const place = (px: number, py: number, s: number) => {
    const z = cam.zoom || 1;
    t.setPosition(ox + (px - ox) / z, oy + (py - oy) / z).setScale((s + bump) / z);
  };
  place(sx, sy, 0.3);
  const pop = { u: 0 };
  scene.tweens.add({ targets: pop, u: 1, duration: 240, ease: 'Back.Out', onUpdate: () => place(sx, sy - 56 * pop.u, 0.3 + 0.7 * pop.u) });
  // The flight bows up and over on its way in (a quadratic arc), shrinking as it goes.
  const fx = sx;
  const fy = sy - 56;
  const cx = (fx + toX) / 2 + (toX > fx ? -70 : 70);
  const cy = Math.min(fy, toY) - 110;
  const k = { u: 0 };
  let gathering = true;
  scene.tweens.add({
    targets: k,
    u: 1,
    delay: POP_HANG,
    duration: POP_FLIGHT,
    ease: 'Cubic.In',
    onStart: () => {
      gathering = false;
    },
    onUpdate: () => {
      const u = k.u;
      const a = (1 - u) * (1 - u);
      const b = 2 * u * (1 - u);
      const c = u * u;
      place(a * fx + b * cx + c * toX, a * fy + b * cy + c * toY, 1 - 0.45 * u);
    },
    onComplete: () => {
      o.onArrive?.();
      t.destroy();
    },
  });
  return {
    image: t,
    get gathering() {
      return gathering;
    },
    retitle(next: string, c?: string) {
      if (!t.active) return;
      if (c) color = c;
      t.setTexture(titleTexture(scene, next, size, color));
      // A springy swell as it grows (settling back before it sets off).
      const b = { v: 0.28 };
      scene.tweens.add({
        targets: b,
        v: 0,
        duration: 200,
        ease: 'Quad.Out',
        onUpdate: () => {
          bump = b.v;
          if (pop.u >= 1 && gathering) place(sx, fy, 1);
        },
      });
    },
  };
}

/** Soft ring texture for shockwaves: clear inside, a bright rim that falls off softly both ways. */
function ensureShockTexture(scene: Phaser.Scene): string {
  const key = 'fx-shock';
  if (scene.textures.exists(key)) return key;
  const S = 256;
  const tex = scene.textures.createCanvas(key, S, S);
  if (!tex) return 'fx-ring';
  const ctx = tex.getContext();
  const grd = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0)');
  grd.addColorStop(0.82, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.92, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, S, S);
  tex.refresh();
  return key;
}

export interface ShockOpts {
  color?: number;
  /** Final radius in px (horizontal). */
  radius?: number;
  /** Vertical squash for a ring lying on a floor seen in perspective (1 = round). */
  ratio?: number;
  /** Starting size as a fraction of the final radius (default 0.25). */
  from?: number;
  duration?: number;
  depth?: number;
  alpha?: number;
  /** Pin to the screen (call-outs) instead of the world. */
  screen?: boolean;
  /** Add it to this container instead of the scene's display list (x, y are then local). */
  into?: Phaser.GameObjects.Container;
}

/** An expanding, fading ring: the shock of an impact, a stamp landing or a burst. */
export function shockwave(scene: Phaser.Scene, x: number, y: number, o: ShockOpts = {}): Phaser.GameObjects.Image {
  const ring = scene.add.image(x, y, ensureShockTexture(scene)).setTint(o.color ?? 0xffffff).setBlendMode(Phaser.BlendModes.ADD);
  ring.setDepth(o.depth ?? 9450).setAlpha(o.alpha ?? 0.9);
  if (o.screen) ring.setScrollFactor(0);
  if (o.into) o.into.add(ring);
  const s = ((o.radius ?? 200) * 2) / 256;
  const r = o.ratio ?? 1;
  const f = o.from ?? 0.25;
  ring.setScale(s * f, s * f * r);
  scene.tweens.add({ targets: ring, scaleX: s, scaleY: s * r, alpha: 0, duration: o.duration ?? 420, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
  return ring;
}

/**
 * A burst of confetti in the given colours (the winner's, say). Each burst gets its own small
 * emitter, which tidies itself away once the pieces have fallen; Lite throws fewer pieces.
 */
export function confettiBurst(scene: Phaser.Scene, x: number, y: number, colors: number[], count = 60, depth = 5200): void {
  if (!scene.textures.exists('fx-confetti')) return;
  const n = Math.max(6, Math.round(count * (LITE ? 0.55 : 1) * (settings.get().reducedMotion ? 0.35 : 1)));
  const em = scene.add.particles(0, 0, 'fx-confetti', {
    emitting: false,
    lifespan: { min: 1300, max: 2200 },
    speed: { min: 280, max: 760 },
    angle: { min: 225, max: 315 },
    gravityY: 760,
    rotate: { start: 0, end: 720 },
    scaleX: { start: 1.1, end: 0.35 },
    scaleY: { start: 1.1, end: 1 },
    tint: colors,
    alpha: { start: 1, end: 0 },
    maxParticles: n,
  });
  em.setDepth(depth);
  em.explode(n, x, y);
  scene.time.delayedCall(2600, () => em.destroy());
}

/**
 * A gentle full-screen flash (additive, low alpha): a "GO!" lighting up the stage without the glare
 * of a camera flash. Off with Reduced Motion.
 */
export function flashScreen(scene: Phaser.Scene, color = 0xffffff, alpha = 0.22, ms = 220): void {
  if (settings.get().reducedMotion) return;
  const r = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH * 1.3, GAME_HEIGHT * 1.3, color, 1);
  r.setScrollFactor(0).setDepth(9700).setAlpha(alpha).setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({ targets: r, alpha: 0, duration: ms, ease: 'Quad.Out', onComplete: () => r.destroy() });
}
