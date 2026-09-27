import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { animHeadTop, Character } from '../characters/Character';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { EffectsManager } from '../effects/EffectsManager';
import { input } from '../input/InputManager';
import type { MinigameLaunch, MinigameResult } from '../minigames/MinigameManager';
import { rewardForPlace } from '../state/scoring';
import { session } from '../state/Session';
import { PromptBar } from '../ui/ControllerPrompt';
import { Menu } from '../ui/Menu';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { randomSeed } from '../util/Random';

/** Podium x and height by finishing place (1st in the centre). Must match scripts/art/scenes.py. */
const PODIUM_X = [960, 600, 1320, 1680];
const PODIUM_H = [230, 160, 110, 60];
const PODIUM_BASE = 880;
/** Camera elevation of the rendered results stage (degrees). */
const STAGE_ELEV = 16;

/** Screen y of the rank medallion on a rendered podium (same maths as the Blender scene). */
function medalY(rank: number, h: number): number {
  const beta = ((90 - STAGE_ELEV) * Math.PI) / 180;
  const sinb = Math.sin(beta);
  const cosb = Math.cos(beta);
  const H = h / (100 * sinb);
  const R = rank === 0 ? 0.5 : rank < 3 ? 0.42 : 0.2;
  let mz = (h * 0.45 + 1.28 * 100 * cosb) / (100 * sinb);
  const [lo, hi] = rank < 3 ? [0.3, 0.25] : [0.08, 0.1];
  mz = Math.min(Math.max(mz, R + lo), H - R - hi);
  return PODIUM_BASE + 1.28 * 100 * cosb - mz * 100 * sinb;
}

/** A festival drum podium: teal body, cream top with gold rim, the player's colour band. */
export function drawPodium(g: Phaser.GameObjects.Graphics, x: number, baseY: number, h: number, color: number, gold: boolean): void {
  const w = 260;
  g.fillStyle(0x0b1a24, 0.25);
  g.fillEllipse(x, baseY + 14, w + 50, 56);
  // Body with rounded bottom.
  g.fillStyle(COLORS.tealDeep, 1);
  g.fillEllipse(x, baseY, w, 60);
  g.fillRect(x - w / 2, baseY - h, w, h);
  g.fillStyle(gold ? COLORS.goldDark : COLORS.tealDark, 1);
  g.fillRect(x - w / 2 + 14, baseY - h, w - 28, h);
  g.fillEllipse(x, baseY, w - 28, 50);
  g.fillStyle(0xffffff, 0.12);
  g.fillRect(x - w / 2 + 30, baseY - h, 34, h);
  // Player colour band and gold trim.
  g.fillStyle(color, 1);
  g.fillRect(x - w / 2, baseY - h + 18, w, 16);
  g.fillStyle(COLORS.gold, 1);
  g.fillRect(x - w / 2, baseY - h + 34, w, 5);
  // Top.
  g.fillStyle(COLORS.creamDeep, 1);
  g.fillEllipse(x, baseY - h + 6, w, 60);
  g.fillStyle(COLORS.cream, 1);
  g.fillEllipse(x, baseY - h, w, 60);
  g.lineStyle(5, COLORS.gold, 1);
  g.strokeEllipse(x, baseY - h, w, 60);
  g.lineStyle(3, COLORS.creamDeep, 1);
  g.strokeEllipse(x, baseY - h, w - 60, 36);
}

/** Minigame podium: placements, reactions and chip rewards (board mode). */
export class ResultsScene extends Phaser.Scene {
  private result!: MinigameResult;
  private launchData!: MinigameLaunch;
  private canContinue = false;
  private menu?: Menu;
  private done = false;

  constructor() {
    super('Results');
  }

  init(data: { result: MinigameResult; launch: MinigameLaunch }): void {
    this.result = data.result;
    this.launchData = data.launch;
    this.canContinue = false;
    this.menu = undefined;
    this.done = false;
  }

  create(): void {
    enterScene(this);
    audio.playMusic('results');
    const fx = new EffectsManager(this, 800);
    // Festive dusk for the podium (the board is day, the title golden hour).
    const skyKey = ['rendered-sky-dusk', 'rendered-sky-golden', 'rendered-sky-day'].find((k) => this.textures.exists(k));
    if (skyKey) {
      this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, skyKey).setDisplaySize(GAME_WIDTH * 1.05, GAME_HEIGHT * 1.05).setDepth(-10);
    } else {
      this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-10);
      this.add.tileSprite(0, 640, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setDepth(-10);
    }
    addTitle(this, GAME_WIDTH / 2, 74, 'RESULTS', 80);
    const board = this.launchData.mode === 'board';
    const ranked = [...this.result.placements].sort((a, b) => a.place - b.place || a.slot - b.slot);
    // The rendered stage has all four podiums; fewer players fall back to drawn podiums.
    const stage = ranked.length === 4 && this.textures.exists('rendered-scene-results');
    if (stage) this.add.image(0, 0, 'rendered-scene-results').setOrigin(0).setDepth(-8);
    const baseY = PODIUM_BASE;
    ranked.forEach((pl, rankIdx) => {
      const lp = this.launchData.players.find((p) => p.slot === pl.slot)!;
      // Columns follow finishing order; tied places share heights by their place.
      const x = PODIUM_X[rankIdx];
      const h = PODIUM_H[rankIdx];
      if (!stage) drawPodium(this.add.graphics(), x, baseY, h, PLAYER_COLORS[pl.slot], pl.place === 1);
      const suffix = pl.place === 1 ? 'st' : pl.place === 2 ? 'nd' : pl.place === 3 ? 'rd' : 'th';
      const ry = stage ? medalY(rankIdx, h) : baseY - h / 2 + 18;
      addTitle(this, x, ry, `${pl.place}${suffix}`, rankIdx === 0 ? 46 : rankIdx < 3 ? 40 : 24, pl.place === 1 ? CSS.goldLight : CSS.cream);
      // Player-colour ring on the podium top so each column reads as that player's.
      const ring = this.add.graphics();
      ring.lineStyle(5, PLAYER_COLORS[pl.slot], 0.95);
      ring.strokeEllipse(x, baseY - h + 4, 196, 50);
      ring.fillStyle(PLAYER_COLORS[pl.slot], 0.22);
      ring.fillEllipse(x, baseY - h + 4, 196, 50);
      const c = new Character(this, x, baseY - h + 8, lp.characterId, { scale: rankIdx === 0 ? 0.98 : 0.88 });
      c.setAlpha(0);
      // Marker hangs just above this character's head.
      const badge = new PlayerBadge(this, x, baseY - h + 8 + animHeadTop(lp.characterId) * c.scale - 40, pl.slot, 24);
      badge.setAlpha(0);
      const scoreLabel = this.result.scores.find((s) => s.slot === pl.slot)?.label ?? '';
      const pill = this.add.graphics();
      const lw = Math.max(150, scoreLabel.length * 15 + 40);
      pill.fillStyle(0x0c2630, 0.8);
      pill.fillRoundedRect(x - lw / 2, baseY + 48, lw, 44, 22);
      pill.lineStyle(3, PLAYER_COLORS[pl.slot], 0.9);
      pill.strokeRoundedRect(x - lw / 2, baseY + 48, lw, 44, 22);
      addText(this, x, baseY + 70, scoreLabel, 24, { color: CSS.cream, weight: 700 });
      if (board) {
        const panel = this.add.graphics();
        panel.fillStyle(0x0c2630, 0.85);
        panel.fillRoundedRect(x - 70, baseY + 100, 140, 48, 24);
        panel.lineStyle(3, COLORS.gold, 1);
        panel.strokeRoundedRect(x - 70, baseY + 100, 140, 48, 24);
        const chip = this.add.sprite(x - 34, baseY + 124, 'items', '0').setScale(0.18).play('chip-spin');
        addText(this, x + 18, baseY + 124, `+${rewardForPlace(pl.place)}`, 28, { color: CSS.goldLight, weight: 700 });
        void chip;
      }
      // Staggered reveal: 4th → 1st
      const delay = 400 + (ranked.length - 1 - rankIdx) * 450;
      this.time.delayedCall(delay, () => {
        c.setAlpha(1);
        this.tweens.add({ targets: badge, alpha: 1, duration: 200, delay: 300 });
        c.y -= 200;
        this.tweens.add({ targets: c, y: c.y + 200, duration: 380, ease: 'Bounce.Out' });
        audio.play('land');
        const last = pl.place === ranked.length && ranked.length > 1;
        const anim = pl.place === 1 ? 'victory' : last ? 'disappointed' : 'celebrate';
        this.time.delayedCall(380, () => {
          if (last) {
            // Last place keeps a disappointed pose instead of snapping back to idle.
            c.play('disappointed', { onComplete: () => c.hold('disappointed', 2) });
          } else if (pl.place === 1) {
            c.play('victory');
            this.time.addEvent({ delay: 2200, loop: true, callback: () => c.play('victory') });
          } else c.play(anim);
        });
        if (pl.place === 1) {
          audio.play('victory');
          fx.confetti(x, baseY - h - 280, 90);
          // Spotlight from above onto the winner.
          const beam = this.add.graphics().setDepth(-6).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
          for (let k = 0; k < 6; k++) {
            beam.fillStyle(0xfff1c4, 0.05);
            beam.fillTriangle(x - 30 - k * 4, -40, x + 30 + k * 4, -40, x + 170 + k * 22, baseY - h + 20);
            beam.fillTriangle(x - 30 - k * 4, -40, x - 170 - k * 22, baseY - h + 20, x + 170 + k * 22, baseY - h + 20);
          }
          beam.fillStyle(0xfff1c4, 0.16);
          beam.fillEllipse(x, baseY - h + 8, 360, 80);
          this.tweens.add({ targets: beam, alpha: 1, duration: 500 });
          // Sunburst behind the winner and a ribbon above.
          const rays = this.add.image(x, baseY - h - 120, 'fx-rays').setDisplaySize(1180, 1180).setTint(0xffe7a6).setBlendMode(Phaser.BlendModes.ADD).setDepth(-5).setAlpha(0);
          this.tweens.add({ targets: rays, alpha: 0.6, duration: 400 });
          this.tweens.add({ targets: rays, angle: 360, duration: 24000, repeat: -1 });
          const ribbon = addTitle(this, x, baseY - h - 330, 'WINNER!', 48, CSS.goldLight).setScale(0.3);
          this.tweens.add({ targets: ribbon, scale: 1, duration: 360, ease: 'Back.Out' });
          if (!lp.isCpu) {
            input.rumbleSlot(lp.slot, 0.6, 0.6, 150);
            this.time.delayedCall(260, () => input.rumbleSlot(lp.slot, 0.6, 0.6, 150));
          }
        }
      });
    });
    const revealDone = 600 + ranked.length * 450;
    this.time.delayedCall(revealDone, () => {
      this.canContinue = true;
      if (board) {
        new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 40, [{ button: 'A', label: 'Back to the board' }], { size: 40, fontSize: 28 });
      } else {
        this.menu = new Menu(
          this,
          GAME_WIDTH / 2,
          GAME_HEIGHT - 54,
          [
            { label: 'REMATCH', onSelect: () => this.rematch() },
            { label: 'CHANGE GAME', onSelect: () => goTo(this, 'MinigameMode') },
            { label: 'MAIN MENU', onSelect: () => goTo(this, 'Title') },
          ],
          { horizontal: true, width: 320, itemHeight: 64, fontSize: 28, gap: 28 },
        );
      }
    });
  }

  private rematch(): void {
    goTo(this, 'MinigameIntro', { ...this.launchData, seed: randomSeed(), instructions: 'quick' });
  }

  override update(): void {
    if (!this.canContinue || this.done) return;
    if (this.menu) {
      for (const s of session.humans()) if (this.menu.handle(input.controls(s.slot))) return;
      this.menu.handle(input.any);
      return;
    }
    const humans = this.launchData.players.filter((p) => !p.isCpu);
    const pressed = humans.length ? humans.some((p) => input.controls(p.slot).pressed('A')) : input.any.pressed('A');
    if (pressed || humans.length === 0) {
      if (humans.length === 0 && !pressed) {
        // All-CPU (debug) matches continue automatically.
        this.canContinue = false;
        this.time.delayedCall(1500, () => this.finishBoard());
        return;
      }
      this.finishBoard();
    }
  }

  private finishBoard(): void {
    if (this.done) return;
    this.done = true;
    audio.play('confirm');
    const cam = this.cameras.main;
    cam.fadeOut(220, 13, 59, 71);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.game.events.emit('minigame:complete', this.result);
      this.scene.stop();
    });
  }
}
