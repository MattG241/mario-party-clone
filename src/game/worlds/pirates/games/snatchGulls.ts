// Stretch & Snatch: the thieving gulls. They fly in, circle the feast, then dive (their shadow tightening
// on the table as the warning) at the fullest fist left out over the table, or failing that the best
// item on it, and make off with it. A fist punching into a low gull bops it and it drops its loot.
// The scene supplies what they can dive at through GullHost (it owns the arms and the food).
import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import type { Pt } from './stretchSnatchRules';

export interface GullHost<P, L> {
  readonly scene: Phaser.Scene;
  readonly hasAtlas: boolean;
  rand(): number;
  /** Screen position of a table-plane point (x, y) raised z px. */
  screen(x: number, y: number, z: number, out: Pt): Pt;
  /** The juiciest target on offer (null: nothing worth diving for). */
  pickPrey(): P | null;
  /** Where that target is now (table plane); false once it's gone. */
  preyAt(prey: P, out: Pt): boolean;
  /** Take the target's best item (the gull carries it off), or null. */
  snatch(prey: P): L | null;
  /** Whether a reaching fist is in bopping range of table-plane point (x, y). */
  fistHits(x: number, y: number, r: number): boolean;
  /** Loot dropped back onto the table at (x, y), or carried off for good. */
  drop(loot: L, x: number, y: number): void;
  lose(loot: L): void;
  /** Draw the loot dangling under the gull at a screen point. */
  carry(loot: L, x: number, y: number, tilt: number): void;
  /** Feedback words at a screen point. */
  said(word: 'squawk' | 'bop', x: number, y: number): void;
}

type GullState = 'off' | 'enter' | 'circle' | 'dive' | 'flee';

interface Gull<P, L> {
  state: GullState;
  x: number;
  y: number;
  h: number;
  t: number;
  x0: number;
  y0: number;
  h0: number;
  x1: number;
  y1: number;
  h1: number;
  ang: number;
  target: P | null;
  loot: L | null;
  spr: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  flap: number;
}

const DIVE_MS = 850;
const BOP_R = 58;
const ENTER_MS = 1300;
const CIRCLE_MS = 1100;
const FLEE_MS = 1200;

export class GullFlock<P, L> {
  private gulls: Gull<P, L>[] = [];
  private spawnT = 8000;
  private tmp: Pt = { x: 0, y: 0 };
  private scr: Pt = { x: 0, y: 0 };

  constructor(
    private host: GullHost<P, L>,
    private depth: number,
    shadowDepth: number,
    count = 2,
  ) {
    const s = host.scene;
    for (let i = 0; i < count; i++) {
      const spr = (host.hasAtlas ? s.add.image(0, 0, 'pirates-snatch', 'gull_1') : s.add.image(0, 0, 'fx-dot').setScale(4, 2)).setDepth(depth).setVisible(false);
      const shadow = s.add.image(0, 0, 'fx-contact').setDepth(shadowDepth).setVisible(false);
      this.gulls.push({ state: 'off', x: 0, y: 0, h: 0, t: 0, x0: 0, y0: 0, h0: 0, x1: 0, y1: 0, h1: 0, ang: 0, target: null, loot: null, spr, shadow, flap: 0 });
    }
  }

  /** Whether a gull is diving at this target right now (and how far into its dive, 0..1). */
  divingAt(prey: P): number {
    for (const g of this.gulls) if (g.state === 'dive' && g.target === prey) return g.t / DIVE_MS;
    return 0;
  }

  update(dt: number, playing: boolean, busy: boolean, frenzy: boolean): void {
    if (playing) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = 6500 + this.host.rand() * 3500 - (frenzy ? 2000 : 0);
        let active = 0;
        for (const g of this.gulls) if (g.state !== 'off') active++;
        if (active < (busy ? 2 : 1)) this.spawn();
      }
    }
    for (const g of this.gulls) {
      if (g.state === 'off') continue;
      g.t += dt;
      g.flap += dt;
      if (g.state === 'enter') {
        const u = Math.min(1, g.t / ENTER_MS);
        this.lerp(g, 1 - (1 - u) * (1 - u));
        if (u >= 1) {
          g.state = 'circle';
          g.t = 0;
        }
      } else if (g.state === 'circle') {
        g.ang += (dt / 1000) * 1.6;
        g.x = Math.cos(g.ang) * 180;
        g.y = Math.sin(g.ang) * 150;
        g.h = 240 + Math.sin(g.t / 200) * 8;
        if (g.t > CIRCLE_MS) {
          g.target = this.host.pickPrey();
          if (!g.target) this.flee(g);
          else {
            g.state = 'dive';
            g.t = 0;
            g.x0 = g.x;
            g.y0 = g.y;
            g.h0 = g.h;
            audio.play('warn', { volume: 0.45, rate: 2.1 });
            audio.play('whoosh', { volume: 0.4, rate: 0.8 });
          }
        }
      } else if (g.state === 'dive') {
        const u = Math.min(1, g.t / DIVE_MS);
        const ok = g.target !== null && this.host.preyAt(g.target, this.tmp);
        if (ok) {
          g.x1 = this.tmp.x;
          g.y1 = this.tmp.y;
        }
        const e = u * u;
        g.x = g.x0 + (g.x1 - g.x0) * e;
        g.y = g.y0 + (g.y1 - g.y0) * e;
        g.h = g.h0 * (1 - e) + 24 * e;
        if (this.bopped(g)) continue;
        if (u >= 1) this.strike(g, ok);
      } else if (g.state === 'flee') {
        const u = Math.min(1, g.t / FLEE_MS);
        g.x = g.x0 + (g.x1 - g.x0) * u * u;
        g.y = g.y0 + (g.y1 - g.y0) * u * u;
        g.h = g.h0 + (g.h1 - g.h0) * u;
        if (g.t < 350 && g.loot && this.bopped(g)) continue;
        if (u >= 1) {
          this.hide(g);
          continue;
        }
      }
      this.draw(g);
    }
  }

  /** Everyone off (the round is over): loot in the air is lost. */
  clear(): void {
    for (const g of this.gulls) if (g.state !== 'off') this.hide(g);
  }

  private lerp(g: Gull<P, L>, e: number): void {
    g.x = g.x0 + (g.x1 - g.x0) * e;
    g.y = g.y0 + (g.y1 - g.y0) * e;
    g.h = g.h0 + (g.h1 - g.h0) * e;
  }

  private spawn(): void {
    const g = this.gulls.find((q) => q.state === 'off');
    if (!g) return;
    const left = this.host.rand() < 0.5;
    g.state = 'enter';
    g.t = 0;
    g.x0 = left ? -1150 : 1150;
    g.y0 = -520 + this.host.rand() * 200;
    g.h0 = 420;
    g.ang = this.host.rand() * Math.PI * 2;
    g.x1 = Math.cos(g.ang) * 180;
    g.y1 = Math.sin(g.ang) * 150;
    g.h1 = 240;
    g.target = null;
    g.loot = null;
    g.spr.setVisible(true).setAlpha(1);
    g.shadow.setVisible(true);
    audio.play('warn', { volume: 0.3, rate: 1.9 });
  }

  private strike(g: Gull<P, L>, ok: boolean): void {
    if (ok && g.target) {
      const loot = this.host.snatch(g.target);
      if (loot) {
        g.loot = loot;
        audio.play('chipLose', { volume: 0.5 });
        audio.play('warn', { volume: 0.5, rate: 2.3 });
        const p = this.host.screen(g.x, g.y, g.h, this.scr);
        this.host.said('squawk', p.x, p.y);
      }
    }
    this.flee(g);
  }

  private flee(g: Gull<P, L>): void {
    g.state = 'flee';
    g.t = 0;
    g.x0 = g.x;
    g.y0 = g.y;
    g.h0 = g.h;
    g.x1 = (g.x > 0 ? 1 : -1) * 1250;
    g.y1 = -600;
    g.h1 = 460;
  }

  /** A fist passing close to a low gull bops it: it drops its loot back onto the table. */
  private bopped(g: Gull<P, L>): boolean {
    if (g.h > 110 || !this.host.fistHits(g.x, g.y, BOP_R)) return false;
    const p = this.host.screen(g.x, g.y, g.h, this.scr);
    audio.play('bounce', { volume: 0.5, rate: 1.6 });
    audio.play('warn', { volume: 0.35, rate: 2.4 });
    this.host.said('bop', p.x, p.y);
    if (g.loot) {
      this.host.drop(g.loot, g.x, g.y);
      g.loot = null;
    }
    g.target = null;
    this.flee(g);
    return true;
  }

  private hide(g: Gull<P, L>): void {
    g.state = 'off';
    g.spr.setVisible(false);
    g.shadow.setVisible(false);
    if (g.loot) this.host.lose(g.loot);
    g.loot = null;
    g.target = null;
  }

  private draw(g: Gull<P, L>): void {
    const floor = this.host.screen(g.x, g.y, 0, this.scr);
    const x = floor.x;
    const y = floor.y;
    const f = Math.floor(g.flap / (g.state === 'dive' ? 70 : 110)) % 4;
    if (this.host.hasAtlas) g.spr.setFrame(f === 0 ? 'gull_0' : f === 2 ? 'gull_2' : 'gull_1');
    g.spr.setPosition(x, y - g.h).setFlipX(g.x1 - g.x0 < 0).setScale(1 + g.h / 900).setDepth(this.depth + g.y * 0.001);
    const k = Math.max(0.25, 1 - g.h / 420);
    g.shadow.setPosition(x, y + 2).setScale(0.9 * (1.3 - k * 0.3), 0.3 * (1.3 - k * 0.3)).setAlpha(0.15 + 0.5 * k);
    if (g.loot) this.host.carry(g.loot, x, y - g.h + 34, Math.sin(g.flap / 80) * 12);
  }
}
