import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { Character } from '../characters/Character';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { EffectsManager } from '../effects/EffectsManager';
import { input } from '../input/InputManager';
import type { MinigameLaunch, MinigameResult } from '../minigames/MinigameManager';
import { rewardForPlace } from '../state/scoring';
import { session } from '../state/Session';
import { PromptBar } from '../ui/ControllerPrompt';
import { Menu } from '../ui/Menu';
import { drawPanel } from '../ui/Panel';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { randomSeed } from '../util/Random';

/** Podium heights by place (1st highest). */
const PODIUM_H = [230, 160, 110, 70];

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
    this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    this.add.tileSprite(0, 640, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0);
    addTitle(this, GAME_WIDTH / 2, 80, 'RESULTS', 84);
    const board = this.launchData.mode === 'board';
    // Order podium columns: 2nd, 1st, 3rd, 4th (by rank index)
    const ranked = [...this.result.placements].sort((a, b) => a.place - b.place || a.slot - b.slot);
    const columns = [1, 0, 2, 3].filter((i) => i < ranked.length);
    const xs = ranked.length === 2 ? [760, 1160] : ranked.length === 3 ? [560, 960, 1360] : [460, 820, 1180, 1540];
    columns.forEach((rankIdx, col) => {
      const pl = ranked[rankIdx];
      const lp = this.launchData.players.find((p) => p.slot === pl.slot)!;
      const x = xs[col];
      const h = PODIUM_H[Math.min(3, pl.place - 1)];
      const baseY = 900;
      drawPodium(this.add.graphics(), x, baseY, h, PLAYER_COLORS[pl.slot], pl.place === 1);
      const suffix = pl.place === 1 ? 'st' : pl.place === 2 ? 'nd' : pl.place === 3 ? 'rd' : 'th';
      addTitle(this, x, baseY - h / 2 + 30, `${pl.place}${suffix}`, 64, pl.place === 1 ? CSS.goldLight : CSS.cream);
      const c = new Character(this, x, baseY - h + 10, lp.characterId, { scale: 0.9 });
      c.setAlpha(0);
      new PlayerBadge(this, x - 110, baseY - h - 250, pl.slot, 26);
      const scoreLabel = this.result.scores.find((s) => s.slot === pl.slot)?.label ?? '';
      addText(this, x, baseY + 50, scoreLabel, 28, { color: CSS.cream, weight: 700, stroke: '#1b1530', strokeThickness: 6 });
      if (board) {
        const panel = this.add.graphics();
        drawPanel(panel, x - 90, baseY + 78, 180, 64, { radius: 24, borderWidth: 4, engraving: false, shadowOffset: 5 });
        const chip = this.add.sprite(x - 44, baseY + 110, 'items', '0').setScale(0.22).play('chip-spin');
        addText(this, x + 20, baseY + 110, `+${rewardForPlace(pl.place)}`, 34, { color: CSS.ink, weight: 700 });
        void chip;
      }
      // Staggered reveal: 4th → 1st
      const delay = 400 + (ranked.length - 1 - rankIdx) * 450;
      this.time.delayedCall(delay, () => {
        c.setAlpha(1);
        c.y -= 200;
        this.tweens.add({ targets: c, y: c.y + 200, duration: 380, ease: 'Bounce.Out' });
        audio.play('land');
        const anim = pl.place === 1 ? 'victory' : pl.place === ranked.length && ranked.length > 1 ? 'disappointed' : 'celebrate';
        this.time.delayedCall(380, () => c.play(anim, { returnTo: anim === 'disappointed' ? 'idle' : 'idle' }));
        if (pl.place === 1) {
          audio.play('victory');
          fx.confetti(x, baseY - h - 280, 90);
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
          GAME_HEIGHT - 70,
          [
            { label: 'REMATCH', onSelect: () => this.rematch() },
            { label: 'CHANGE GAME', onSelect: () => goTo(this, 'MinigameMode') },
            { label: 'MAIN MENU', onSelect: () => goTo(this, 'Title') },
          ],
          { horizontal: true, width: 340, itemHeight: 70, fontSize: 30, gap: 28 },
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
