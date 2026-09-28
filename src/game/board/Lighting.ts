// Drives the festival day (see DayCycle): eases from one moment to the next and hands the blended
// look to the sky, the land, the heroes, the ambient life and (Full only) the colour grade.
import Phaser from 'phaser';
import { GradePipeline } from '../effects/GradePipeline';
import type { BoardScene } from '../scenes/BoardScene';
import { dayTime, lookAt } from './DayCycle';

export class Lighting {
  private holder = { t: 0 };
  private tween: Phaser.Tweens.Tween | null = null;
  private grade: GradePipeline | null = null;
  private readonly onUpdate = (): void => this.apply();

  constructor(private scene: BoardScene) {}

  /** Snap to the match's current moment (call once everything lit exists). */
  init(): void {
    const pipe = this.scene.renderer.type === Phaser.WEBGL ? this.scene.cameras.main.getPostPipeline(GradePipeline) : undefined;
    this.grade = ((Array.isArray(pipe) ? pipe[0] : pipe) as GradePipeline | undefined) ?? null;
    // The grade's settings share their arrays with the defaults: take a private copy to animate.
    if (this.grade) this.grade.settings.highTint = [...this.grade.settings.highTint];
    this.holder.t = this.target();
    this.apply();
  }

  /** Time of day the match is at right now. */
  target(): number {
    const s = this.scene.state;
    return dayTime(s.round, s.config.rounds, s.phase, s.players.length);
  }

  get time(): number {
    return this.holder.t;
  }

  /** Ease to the match's current moment over `ms` (time passes while a banner is up). */
  follow(ms = 2600): Promise<void> {
    return this.to(this.target(), ms);
  }

  to(t: number, ms: number): Promise<void> {
    this.tween?.stop();
    this.tween = null;
    if (ms <= 0 || Math.abs(t - this.holder.t) < 0.002) {
      this.holder.t = t;
      this.apply();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tween = this.scene.tweens.add({ targets: this.holder, t, duration: ms, ease: 'Sine.InOut', onUpdate: this.onUpdate, onComplete: () => resolve(), onStop: () => resolve() });
    });
  }

  private apply(): void {
    const look = lookAt(this.holder.t);
    const s = this.scene;
    s.bg?.setLook(look);
    s.board.setLight(look.land, look.spaces, look.glow);
    s.moves.setLightTint(look.chars);
    s.ambient?.setMood(look);
    const g = this.grade;
    if (g) {
      // Warm highlights at golden hour and sunset, a slightly deeper vignette as night falls.
      const h = g.settings.highTint;
      h[0] = look.high[0];
      h[1] = look.high[1];
      h[2] = look.high[2];
      g.settings.vignette = look.vignette;
    }
  }
}
