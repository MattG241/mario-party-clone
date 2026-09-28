import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { REALTIME_CLOCK } from '../debug/debug';
import { settings } from '../save/SettingsManager';

/**
 * The festival scene wipe: a ribbon of the four player colours leads a navy sash across the
 * screen, the next scene is swapped in underneath, and the sash sweeps on off the other side with
 * the colours trailing (a ribbon passing the camera). The spiral emblem rides in the middle of the
 * sash, so a slow load simply shows the emblem. One Graphics redrawn only while it is up: a dozen
 * flat polygons, cheap on TV chips. Reduced Motion gets a plain navy fade instead.
 *
 * It lives on the always-on System scene (on top of every other scene) so it covers stacked
 * scenes such as the board and its HUD alike; Transition.ts drives it.
 */

type Phase = 'clear' | 'covering' | 'covered' | 'revealing';

/** The game's background colour (config backgroundColor), so a camera fade to it hands over seamlessly. */
const NAVY = 0x0d3b47;
const NAVY_DEEP = 0x0a2f39;
/** Horizontal lean of the ribbon's edges from the top of the screen to the bottom. */
const SLANT = 340;
const HALF = SLANT / 2;
/** Each player-colour stripe and the see-through gap after it; LEAD is the whole striped fringe. */
const STRIPE = 54;
const GAP = 12;
const LEAD = 4 * (STRIPE + GAP) + 6;
/** Mid-height x of the sash's edge when it just covers the screen / has just left it (with a
 *  margin so the gold trim is fully off-screen in the corners). */
const EDGE_IN = -HALF - 12;
const EDGE_OUT = GAME_WIDTH + LEAD + HALF + 12;
/** Where the far side of the sash ends (well off-screen). */
const FAR = 3 * GAME_WIDTH;
/** With nothing asking for a reveal (and no scene loading), the sash lifts itself after this many frames. */
const SAFETY_FRAMES = 90;

/** Quadratic ease in-out (symmetric, so a reversed sweep lines up with the one it replaces). */
function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class Wipe {
  private readonly g: Phaser.GameObjects.Graphics;
  /** Made on first use: the System scene starts before the emblem's texture has loaded. */
  private emblem: Phaser.GameObjects.Image | null = null;
  private phase: Phase = 'clear';
  /** Progress through the current phase, 0..1. */
  private t = 0;
  private coverMs = 200;
  private revealMs = 220;
  /** Covering again after an interrupted reveal: the trailing edge slides back to the left. */
  private backwards = false;
  private onCovered: (() => void)[] = [];
  private revealWanted = false;
  private holdFrames = 0;
  private coveredFrames = 0;
  private readonly pts: Phaser.Math.Vector2[] = [0, 1, 2, 3].map(() => new Phaser.Math.Vector2());

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {
    this.g = scene.add.graphics().setDepth(depth).setVisible(false);
  }

  /** True while the screen is covered, or being covered or uncovered. */
  get busy(): boolean {
    return this.phase !== 'clear';
  }

  get alive(): boolean {
    return this.scene.sys.isActive();
  }

  /** Sweep the sash over the screen; `done` runs once it covers everything. */
  cover(ms: number, done?: () => void): void {
    if (done) this.onCovered.push(done);
    this.revealWanted = false;
    this.coverMs = ms;
    if (this.phase === 'covered') {
      this.flushCovered();
      return;
    }
    if (this.phase === 'covering') return;
    if (this.phase === 'revealing') {
      // A second transition straight after the first: slide the sash back from where it is.
      this.phase = 'covering';
      this.backwards = true;
      this.t = 1 - this.t;
    } else {
      this.phase = 'covering';
      this.backwards = false;
      this.t = 0;
      audio.play('whoosh', { volume: 0.32, rate: 1.1 });
    }
    this.draw();
  }

  /** The new scene is ready: sweep the sash away (putting it up at once first if it isn't up). */
  reveal(ms: number): void {
    this.revealMs = ms;
    if (this.phase === 'clear' || this.phase === 'revealing') {
      // A scene entered without a cover (after a camera fade to the same navy, or started
      // directly): the sash appears at once and sweeps off, so there is never a hard cut.
      this.phase = 'covered';
      this.backwards = false;
      this.coveredFrames = 0;
    }
    this.revealWanted = true;
    // Let the new scene draw one frame under the sash before it moves: that first frame is often
    // a long one (the scene building itself) and would otherwise swallow the sweep.
    this.holdFrames = 1;
    this.draw();
  }

  private flushCovered(): void {
    const list = this.onCovered;
    if (list.length === 0) return;
    this.onCovered = [];
    // Whatever these start asks for its own reveal when it's ready.
    this.revealWanted = false;
    for (const fn of list) fn();
  }

  update(delta: number): void {
    if (this.phase === 'clear') return;
    // Long frames (a scene building itself) must not swallow the sweep; tests on a software
    // renderer (?realtime) keep wall-clock timing instead.
    const dt = Math.min(delta, REALTIME_CLOCK ? 1000 : 50);
    if (this.phase === 'covering') {
      this.t = Math.min(1, this.t + dt / Math.max(1, this.coverMs));
      if (this.t >= 1) {
        this.phase = 'covered';
        this.backwards = false;
        this.coveredFrames = 0;
        this.draw();
        this.flushCovered();
        return;
      }
    } else if (this.phase === 'covered') {
      this.coveredFrames++;
      if (this.revealWanted) {
        if (this.holdFrames > 0) this.holdFrames--;
        else {
          this.phase = 'revealing';
          this.revealWanted = false;
          this.t = 0;
        }
      } else if (this.coveredFrames > SAFETY_FRAMES && !this.sceneOnItsWay()) {
        // Safety net for a scene that never calls enterScene: never leave the screen covered.
        this.reveal(this.revealMs);
      }
    } else {
      this.t = Math.min(1, this.t + dt / Math.max(1, this.revealMs));
      if (this.t >= 1) {
        this.phase = 'clear';
        this.g.clear().setVisible(false);
        this.emblem?.setVisible(false);
        return;
      }
    }
    this.draw();
  }

  /** A scene is still starting, loading or creating (it will call enterScene when it's ready). */
  private sceneOnItsWay(): boolean {
    const S = Phaser.Scenes;
    return this.scene.game.scene.getScenes(false).some((s) => {
      const st = s.sys.settings.status;
      return st >= S.INIT && st <= S.CREATING;
    });
  }

  // --- Drawing --------------------------------------------------------------------------------
  private draw(): void {
    this.g.clear().setVisible(true);
    if (settings.get().reducedMotion) {
      this.drawFade();
      return;
    }
    const k = ease(this.t);
    if (this.phase === 'covered') this.drawLeading(EDGE_OUT);
    else if (this.phase === 'covering' && !this.backwards) this.drawLeading(EDGE_IN + (EDGE_OUT - EDGE_IN) * k);
    else if (this.phase === 'covering') this.drawTrailing(EDGE_OUT + (EDGE_IN - EDGE_OUT) * k);
    else this.drawTrailing(EDGE_IN + (EDGE_OUT - EDGE_IN) * k);
  }

  /** Stripes ahead of `front`, the sash behind them (covering sweeps left to right). */
  private drawLeading(front: number): void {
    // A soft shadow the ribbon casts ahead of itself.
    this.band(front + 26, front, 0x06141a, 0.16);
    for (let i = 0; i < 4; i++) {
      const a = front - i * (STRIPE + GAP);
      this.band(a, a - STRIPE, PLAYER_COLORS[i], 1);
      // A light edge on each stripe, like satin catching the light.
      this.band(a, a - 5, 0xffffff, 0.35);
    }
    const body = front - LEAD;
    this.band(body, -FAR, NAVY, 1);
    this.band(body - 18, -FAR, NAVY_DEEP, 0.5);
    this.band(body, body - 7, COLORS.gold, 1);
    // The emblem rides inside the sash, arriving at the centre as it covers the screen.
    this.placeEmblem(body - (EDGE_OUT - LEAD) + GAME_WIDTH / 2);
  }

  /** The sash ahead of `back`, the stripes trailing behind it (a mirror of the leading fringe). */
  private drawTrailing(back: number): void {
    this.band(FAR, back, NAVY, 1);
    this.band(FAR, back + 18, NAVY_DEEP, 0.5);
    this.band(back + 7, back, COLORS.gold, 1);
    for (let i = 0; i < 4; i++) {
      // The last colour off the screen is player 1's.
      const a = back - 6 - i * (STRIPE + GAP);
      this.band(a, a - STRIPE, PLAYER_COLORS[3 - i], 1);
      this.band(a, a - 5, 0xffffff, 0.35);
    }
    const tail = back - LEAD;
    this.band(tail, tail - 26, 0x06141a, 0.12);
    this.placeEmblem(back - EDGE_IN + GAME_WIDTH / 2);
  }

  /** A slanted full-height band between two mid-height x positions (right edge first). */
  private band(right: number, left: number, color: number, alpha: number): void {
    const [a, b, c, d] = this.pts;
    a.set(right + HALF, 0);
    b.set(right - HALF, GAME_HEIGHT);
    c.set(left - HALF, GAME_HEIGHT);
    d.set(left + HALF, 0);
    this.g.fillStyle(color, alpha);
    this.g.fillPoints(this.pts, true);
  }

  private emblemImage(): Phaser.GameObjects.Image | null {
    if (!this.emblem && this.scene.textures.exists('emblem')) this.emblem = this.scene.add.image(0, GAME_HEIGHT / 2, 'emblem').setDepth(this.depth + 1).setScale(0.9).setVisible(false);
    return this.emblem;
  }

  private placeEmblem(x: number): void {
    const e = this.emblemImage();
    if (!e) return;
    const on = x > -200 && x < GAME_WIDTH + 200;
    e.setVisible(on).setAlpha(1).setPosition(x, GAME_HEIGHT / 2);
    // A slow turn while it waits (only noticeable on a slow load).
    if (on) e.rotation += 0.02;
  }

  /** Reduced Motion: the same navy, faded in and out in place. */
  private drawFade(): void {
    const a = this.phase === 'covered' ? 1 : this.phase === 'covering' ? this.t : 1 - this.t;
    this.g.fillStyle(NAVY, a);
    this.g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.emblemImage()?.setVisible(a > 0.02).setAlpha(a).setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setRotation(0);
  }
}

// --- Host registry (the System scene owns the one instance) -------------------------------------
let host: Wipe | null = null;

export function setWipeHost(w: Wipe | null): void {
  host = w;
}

/** The live wipe, or null before the System scene is up (transitions then fall back to fades). */
export function wipeHost(): Wipe | null {
  return host && host.alive ? host : null;
}
