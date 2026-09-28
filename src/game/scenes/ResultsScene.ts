import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { animHeadTop, Character } from '../characters/Character';
import { CHARACTERS } from '../data/characters';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { EffectsManager } from '../effects/EffectsManager';
import { input } from '../input/InputManager';
import { punch } from '../minigames/juice';
import { minigameInfo, type MinigameLaunch, type MinigameResult } from '../minigames/MinigameManager';
import { LITE } from '../perf';
import { settings } from '../save/SettingsManager';
import { rewardForPlace } from '../state/scoring';
import { session } from '../state/Session';
import { Confetti, godRays, stageDressing, winnerBanner } from '../ui/Celebration';
import { PromptBar } from '../ui/ControllerPrompt';
import { Menu } from '../ui/Menu';
import { drawCard, drawRibbon, UI } from '../ui/Style';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addText, addTitle } from '../ui/theme';
import { coverThen, enterScene, goTo } from '../ui/Transition';
import { randomSeed } from '../util/Random';
import { applyGrade } from '../effects/GradePipeline';
import { setDebugInfo } from '../debug/debug';
import { addStrip } from '../ui/Screen';

/** Podium x and height by finishing place (1st in the centre). Must match scripts/art/scenes.py. */
export const PODIUM_X = [920, 560, 1280, 1640];
export const PODIUM_H = [330, 215, 150, 95];
export const PODIUM_BASE = 880;
/** Camera elevation of the rendered results stage (degrees). */
const STAGE_ELEV = 16;
/** Figures on the podiums: the winner a head taller than the rest. */
const WINNER_K = 1.3;
const PLACED_K = 1.14;

/** Screen y of the rank medallion on a rendered podium (same maths as the Blender scene). */
export function medalY(rank: number, h: number): number {
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
    applyGrade(this, { vignette: 0.08 });
    audio.playMusic('results');
    const fx = new EffectsManager(this, 800);
    const reduced = settings.get().reducedMotion;
    // Warm late-afternoon sky for the podium (the board is day, the title golden hour).
    const skyKey = ['rendered-sky-sunset', 'rendered-sky-golden', 'rendered-sky-day'].find((k) => this.textures.exists(k));
    if (skyKey) {
      this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, skyKey).setDisplaySize(GAME_WIDTH * 1.05, GAME_HEIGHT * 1.05).setDepth(-10).setFlipX(true);
    } else {
      this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-10);
      addStrip(this, 0, 640, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setDepth(-10);
    }
    const info = minigameInfo(this.result.id);
    // Until the winner is revealed, the minigame's name on a slim ribbon at the top.
    const header = this.add.container(GAME_WIDTH / 2, 62).setDepth(5);
    const hg = this.add.graphics();
    const hname = addText(this, 0, -1, (info?.name ?? 'Results').toUpperCase(), 30, { color: '#ffffff', weight: 700, fixed: true });
    drawRibbon(hg, 0, 0, hname.width + 120, 54, UI.slate, { tail: 40, shadow: 0.7 });
    header.add([hg, hname]);
    if (!reduced) {
      header.setScale(0.6).setAlpha(0);
      this.tweens.add({ targets: header, scale: 1, alpha: 1, duration: 260, ease: 'Back.Out' });
    }
    const board = this.launchData.mode === 'board';
    const ranked = [...this.result.placements].sort((a, b) => a.place - b.place || a.slot - b.slot);
    // The rendered stage has all four podiums; fewer players fall back to drawn podiums.
    const stage = ranked.length === 4 && this.textures.exists('rendered-scene-results');
    if (stage) {
      this.add.image(0, 0, 'rendered-scene-results').setOrigin(0).setDepth(-8);
      stageDressing(this, 40);
    }
    const winner = ranked[0];
    const confetti = new Confetti(this, 60, winner ? PLAYER_COLORS[winner.slot] : undefined);
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
      const k = rankIdx === 0 ? WINNER_K : PLACED_K;
      const c = new Character(this, x, baseY - h + 8, lp.characterId, { scale: k });
      c.setAlpha(0);
      // Marker hangs just above this character's head.
      const badge = new PlayerBadge(this, x, baseY - h + 8 + animHeadTop(lp.characterId) * k - 40, pl.slot, 24);
      badge.setAlpha(0);
      const scoreLabel = this.result.scores.find((s) => s.slot === pl.slot)?.label ?? '';
      // Score on a small bevelled chip with a dot in the player's colour.
      const pill = this.add.graphics();
      const label = addText(this, x + 9, baseY + 53, scoreLabel, 21, { color: UI.inkCss, weight: 700 });
      const lw = Math.max(140, label.width + 58);
      drawCard(pill, x - lw / 2, baseY + 34, lw, 38, { radius: 19, shadow: 0.8, bevel: true });
      pill.fillStyle(PLAYER_COLORS[pl.slot], 1);
      pill.fillCircle(x - label.width / 2 - 8, baseY + 53, 7);
      label.setDepth(1);
      let reward: { text: Phaser.GameObjects.Text; chip: Phaser.GameObjects.Sprite; target: number } | null = null;
      if (board) {
        const panel = this.add.graphics();
        drawCard(panel, x - 76, baseY + 100, 152, 50, { radius: 25, shadow: 0.8, bevel: true });
        const chip = this.add.sprite(x - 38, baseY + 125, 'items', '0').setScale(0.18).play('chip-spin');
        const text = addText(this, x + 18, baseY + 125, '+0', 30, { color: UI.inkCss, weight: 700 });
        reward = { text, chip, target: rewardForPlace(pl.place) };
      }
      // Staggered reveal: 4th → 1st
      const delay = 400 + (ranked.length - 1 - rankIdx) * 450;
      this.time.delayedCall(delay, () => {
        c.setAlpha(1);
        this.tweens.add({ targets: badge, alpha: 1, duration: 200, delay: 300 });
        c.y -= 200;
        this.tweens.add({
          targets: c,
          y: c.y + 200,
          duration: 380,
          ease: 'Bounce.Out',
          onComplete: () => {
            c.squash(0.12, 140);
            fx.vfx('dust', x, baseY - h + 12, { scale: 0.38, alpha: 0.6 });
          },
        });
        audio.play('land');
        const last = pl.place === ranked.length && ranked.length > 1;
        this.time.delayedCall(380, () => {
          // Everyone keeps a pose that fits their placing instead of snapping back to idle.
          if (last) c.play('disappointed', { onComplete: () => c.hold('disappointed', 2) });
          else if (pl.place === 1) {
            const cheer = () => {
              c.play('victory', { onComplete: () => c.hold('victory', 2) });
              confetti.rain(26);
            };
            cheer();
            this.time.addEvent({ delay: 2600, loop: true, callback: cheer });
          } else c.play('celebrate', { onComplete: () => c.hold('celebrate', 2) });
          if (reward) this.countReward(reward.text, reward.chip, reward.target, pl.place === 1);
        });
        if (pl.place === 1) this.revealWinner(ranked, lp.characterId, x, baseY - h, header, confetti, fx);
      });
    });
    const revealDone = 600 + ranked.length * 450;
    setDebugInfo('resultsReady', false);
    this.time.delayedCall(revealDone, () => {
      this.canContinue = true;
      setDebugInfo('resultsReady', true);
      if (board) {
        new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 40, [{ button: 'A', label: 'Back to the board' }], { size: 40, fontSize: 28 }).setDepth(70);
      } else {
        this.menu = new Menu(
          this,
          GAME_WIDTH / 2,
          GAME_HEIGHT - 44,
          [
            { label: 'REMATCH', onSelect: () => this.rematch() },
            { label: 'CHANGE GAME', onSelect: () => goTo(this, 'MinigameMode') },
            { label: 'MAIN MENU', onSelect: () => goTo(this, 'Title') },
          ],
          { horizontal: true, width: 300, itemHeight: 58, fontSize: 26, gap: 28 },
        );
        this.menu.setDepth(70);
        if (!settings.get().reducedMotion) {
          this.menu.y += 90;
          this.tweens.add({ targets: this.menu, y: this.menu.y - 90, duration: 320, ease: 'Back.Out' });
        }
      }
    });
  }

  /** The winner's moment: their banner replaces the header, light pours down and the cannons fire. */
  private revealWinner(ranked: { slot: number; place: number }[], characterId: MinigameLaunch['players'][number]['characterId'], x: number, topY: number, header: Phaser.GameObjects.Container, confetti: Confetti, fx: EffectsManager): void {
    const lp = this.launchData.players.find((p) => p.characterId === characterId)!;
    const winners = ranked.filter((r) => r.place === 1);
    const team = minigameInfo(this.result.id)?.teamGame ?? false;
    const name = CHARACTERS[characterId].short.toUpperCase();
    const title = winners.length > 1 ? (team ? 'TEAM VICTORY!' : 'TIE!') : `${name} WINS!`;
    audio.play('victory');
    this.tweens.add({ targets: header, alpha: 0, scale: 0.85, duration: 180 });
    const portraits = winners.map((w) => ({ slot: w.slot, characterId: this.launchData.players.find((p) => p.slot === w.slot)!.characterId }));
    winnerBanner(this, GAME_WIDTH / 2, 96, { title, color: PLAYER_COLORS[lp.slot], portraits, subtitle: minigameInfo(this.result.id)?.name.toUpperCase(), depth: 50 });
    // A god-ray and a warm pool of light on the winner's podium.
    const rays = godRays(this, x, topY + 6, { depth: -1 });
    rays.setAlpha(0);
    this.tweens.add({ targets: rays, alpha: 1, duration: 500 });
    confetti.cannons(GAME_HEIGHT - 70, 80);
    confetti.rain(40);
    fx.sparks(x, topY - 150, LITE ? 14 : 26);
    punch(this, 0.025, 320);
    if (!settings.get().reducedMotion) this.cameras.main.flash(160, 255, 244, 214);
    if (!lp.isCpu) {
      input.rumbleSlot(lp.slot, 0.6, 0.6, 150);
      this.time.delayedCall(260, () => input.rumbleSlot(lp.slot, 0.6, 0.6, 150));
    }
  }

  /** "+10" chips counting up with a tick per chip, then a pop. */
  private countReward(text: Phaser.GameObjects.Text, chip: Phaser.GameObjects.Sprite, target: number, big: boolean): void {
    const holder = { n: 0 };
    let shown = 0;
    this.tweens.add({
      targets: holder,
      n: target,
      duration: 90 + target * 55,
      ease: 'Linear',
      onUpdate: () => {
        const n = Math.round(holder.n);
        if (n === shown) return;
        shown = n;
        text.setText(`+${n}`);
        audio.play('dialTick', { rate: 1 + n * 0.03, volume: 0.6, throttleMs: 30 });
        chip.setScale(0.22);
        this.tweens.add({ targets: chip, scale: 0.18, duration: 90 });
      },
      onComplete: () => {
        text.setText(`+${target}`);
        audio.play('chipGain', { rate: big ? 1.1 : 1, volume: 0.7 });
        this.tweens.add({ targets: text, scale: { from: 1.35, to: 1 }, duration: 240, ease: 'Back.Out' });
      },
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
    // Back to the board behind the wipe; the board reveals itself when it wakes.
    coverThen(this, () => {
      this.game.events.emit('minigame:complete', this.result);
      this.scene.stop();
    });
  }
}
