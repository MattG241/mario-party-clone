import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import type { Character } from '../characters/Character';
import { COLORS, CSS, GAME_WIDTH, PLAYER_COLORS, type CpuLevel } from '../constants';
import { CHARACTERS, type CharacterId } from '../data/characters';
import { REALTIME_CLOCK, setDebugInfo } from '../debug/debug';
import { EffectsManager } from '../effects/EffectsManager';
import type { Controls } from '../input/Controls';
import { input } from '../input/InputManager';
import { VirtualControls } from '../input/PlayerInput';
import { session } from '../state/Session';
import { placementsFromScores } from '../state/scoring';
import { drawPanel } from '../ui/Panel';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { Random } from '../util/Random';
import { minigameInfo, type MinigameInfo, type MinigameLaunch, type MinigameResult } from './MinigameManager';

/** CPU skill per difficulty. CPUs only ever press buttons — these just tune how well. */
export const CPU_SKILL: Record<CpuLevel, { reaction: number; accuracy: number; mistake: number; aimNoise: number; think: number }> = {
  easy: { reaction: 520, accuracy: 0.55, mistake: 0.24, aimNoise: 0.55, think: 700 },
  normal: { reaction: 300, accuracy: 0.78, mistake: 0.11, aimNoise: 0.28, think: 420 },
  hard: { reaction: 170, accuracy: 0.9, mistake: 0.05, aimNoise: 0.13, think: 240 },
};

export interface MgPlayer {
  slot: number;
  characterId: CharacterId;
  isCpu: boolean;
  cpuLevel: CpuLevel;
  controls: Controls;
  vc: VirtualControls | null;
  character?: Character;
  score: number;
  alive: boolean;
  /** Time (ms since GO) the player finished a race / was eliminated. */
  doneAt: number | null;
  /** CPU scratch space. */
  brain: { timer: number; target?: { x: number; y: number }; mode?: string; wait?: number; n?: number };
}

type Phase = 'countdown' | 'playing' | 'finished';

/**
 * Base class for every minigame scene. Subclasses build the arena, spawn player visuals, run
 * their gameplay in tick(), drive CPU players in cpuThink() and report scores.
 */
export abstract class BaseMinigame extends Phaser.Scene {
  info!: MinigameInfo;
  launch!: MinigameLaunch;
  players: MgPlayer[] = [];
  fx!: EffectsManager;
  rng!: Random;
  phase: Phase = 'countdown';
  /** Milliseconds since GO. */
  elapsed = 0;
  /** Round length in ms (0 = no timer, e.g. last-one-standing games). */
  protected duration = 0;
  protected eliminated: number[] = [];
  private hudTags = new Map<number, { score: Phaser.GameObjects.Text; root: Phaser.GameObjects.Container; status: Phaser.GameObjects.Text }>();
  private timerText?: Phaser.GameObjects.Text;
  private ending = false;

  constructor(key: string) {
    super(key);
  }

  init(data: MinigameLaunch): void {
    this.launch = data;
    this.info = minigameInfo(data.id)!;
    this.players = [];
    this.phase = 'countdown';
    this.elapsed = 0;
    this.eliminated = [];
    this.ending = false;
    this.hudTags.clear();
    this.timerText = undefined;
  }

  create(): void {
    enterScene(this);
    audio.playMusic('minigame');
    this.fx = new EffectsManager(this, 5000);
    this.rng = new Random(this.launch.seed);
    this.physics?.world?.resume();
    this.players = this.launch.players.map((lp) => {
      const vc = lp.isCpu ? new VirtualControls() : null;
      return {
        slot: lp.slot,
        characterId: lp.characterId,
        isCpu: lp.isCpu,
        cpuLevel: lp.cpuLevel,
        controls: vc ?? input.controls(lp.slot),
        vc,
        score: 0,
        alive: true,
        doneAt: null,
        brain: { timer: 0 },
      };
    });
    this.createArena();
    if (this.renderer.type === Phaser.WEBGL) this.cameras.main.postFX.addVignette(0.5, 0.5, 0.95, 0.2);
    this.players.forEach((p, i) => this.createPlayer(p, i));
    this.buildHud();
    this.startCountdown();
    setDebugInfo('minigame', this.info.name);
  }

  // --- Hooks ------------------------------------------------------------------------------------
  protected abstract createArena(): void;
  protected abstract createPlayer(p: MgPlayer, index: number): void;
  protected abstract tick(dt: number): void;
  protected abstract cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void;
  /** Higher score = better. Label is shown on the results screen. */
  protected abstract finalScores(): { slot: number; score: number; label: string }[];
  protected onStart(): void {}
  /** Called every frame, even before GO (idle animations etc.). */
  protected ambient(_dt: number): void {}
  protected hudLabel(p: MgPlayer): string {
    return String(p.score);
  }

  protected skill(p: MgPlayer) {
    return CPU_SKILL[p.cpuLevel];
  }

  get alivePlayers(): MgPlayer[] {
    return this.players.filter((p) => p.alive);
  }

  // --- HUD --------------------------------------------------------------------------------------
  private buildHud(): void {
    const n = this.players.length;
    const spacing = 400;
    const start = GAME_WIDTH / 2 - ((n - 1) * spacing) / 2;
    const hasTimer = this.duration > 0;
    this.players.forEach((p, i) => {
      let x = start + i * spacing;
      if (hasTimer) x += (i < n / 2 ? -110 : 110);
      const root = this.add.container(x, 58).setDepth(9000);
      const g = this.add.graphics();
      drawPanel(g, -170, -44, 340, 88, { radius: 26, borderWidth: 5, border: PLAYER_COLORS[p.slot], engraving: false, shadowOffset: 6 });
      const badge = new PlayerBadge(this, -128, 0, p.slot, 22);
      const name = addText(this, -92, -14, CHARACTERS[p.characterId].name.split(' ')[0] + (p.isCpu ? ' · CPU' : ''), 22, { color: CSS.inkSoft, weight: 700, align: 'left' });
      const score = addText(this, -92, 16, '0', 32, { color: CSS.ink, weight: 700, align: 'left' });
      const status = addText(this, 120, 0, '', 26, { color: CSS.coral, weight: 700 });
      root.add([g, badge, name, score, status]);
      this.hudTags.set(p.slot, { score, root, status });
    });
    if (hasTimer) {
      const tg = this.add.graphics().setDepth(9000);
      drawPanel(tg, GAME_WIDTH / 2 - 80, 14, 160, 88, { radius: 30, borderWidth: 5, border: COLORS.tealDark, fill: COLORS.gold, accent: COLORS.cream, engraving: false, shadowOffset: 6 });
      this.timerText = addText(this, GAME_WIDTH / 2, 56, String(Math.ceil(this.duration / 1000)), 46, { color: CSS.ink, weight: 700 }).setDepth(9001);
    }
  }

  protected refreshHud(): void {
    for (const p of this.players) {
      const tag = this.hudTags.get(p.slot);
      if (!tag) continue;
      const label = this.hudLabel(p);
      if (tag.score.text !== label) {
        tag.score.setText(label);
        this.tweens.add({ targets: tag.score, scale: { from: 1.3, to: 1 }, duration: 180 });
      }
      tag.status.setText(p.alive ? '' : 'OUT');
      tag.root.setAlpha(p.alive ? 1 : 0.55);
    }
    if (this.timerText) {
      const left = Math.max(0, Math.ceil((this.duration - this.elapsed) / 1000));
      if (this.timerText.text !== String(left)) {
        this.timerText.setText(String(left));
        if (left <= 5 && this.phase === 'playing') {
          this.timerText.setColor('#c0392b');
          audio.play('countdown', { volume: 0.5 });
          this.tweens.add({ targets: this.timerText, scale: { from: 1.4, to: 1 }, duration: 200 });
        }
      }
    }
  }

  // --- Flow -------------------------------------------------------------------------------------
  private startCountdown(): void {
    const steps = ['3', '2', '1', 'GO!'];
    steps.forEach((s, i) => {
      this.time.delayedCall(500 + i * 700, () => {
        const t = addTitle(this, GAME_WIDTH / 2, 520, s, s === 'GO!' ? 200 : 170, s === 'GO!' ? CSS.goldLight : CSS.cream).setDepth(9500);
        t.setScale(0.3);
        this.tweens.add({ targets: t, scale: 1, duration: 260, ease: 'Back.Out' });
        this.tweens.add({ targets: t, alpha: 0, scale: 1.3, delay: 420, duration: 260, onComplete: () => t.destroy() });
        if (s === 'GO!') {
          audio.play('go');
          input.rumbleAll(0.4, 0.6, 180);
          this.phase = 'playing';
          this.onStart();
        } else audio.play('countdown');
      });
    });
  }

  /** Knock a player out (elimination games end when one remains). */
  protected eliminate(p: MgPlayer): void {
    if (!p.alive) return;
    p.alive = false;
    p.doneAt = this.elapsed;
    this.eliminated.push(p.slot);
    audio.play('defeat', { volume: 0.6 });
    if (!p.isCpu) input.rumbleSlot(p.slot, 0.7, 0.5, 260);
    const alive = this.alivePlayers.length;
    if (alive <= 1 && this.players.length > 1) this.time.delayedCall(700, () => this.end());
    else if (alive === 0) this.time.delayedCall(700, () => this.end());
  }

  /** End the round and move to the results podium. */
  protected end(): void {
    if (this.ending) return;
    this.ending = true;
    this.phase = 'finished';
    for (const p of this.players) p.vc?.releaseAll();
    audio.play('finish');
    const t = addTitle(this, GAME_WIDTH / 2, 520, 'FINISH!', 170, CSS.goldLight).setDepth(9500);
    t.setScale(0.3);
    this.tweens.add({ targets: t, scale: 1, duration: 300, ease: 'Back.Out' });
    const scores = this.finalScores();
    const result: MinigameResult = {
      id: this.info.id,
      placements: placementsFromScores(scores),
      scores,
    };
    this.time.delayedCall(1700, () => goTo(this, 'Results', { result, launch: this.launch }));
  }

  /** Scores for elimination games: survivors best, then later eliminations. */
  protected eliminationScores(extra: (p: MgPlayer) => number = () => 0): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => {
      const outIndex = this.eliminated.indexOf(p.slot);
      const score = p.alive ? 1000 + extra(p) : outIndex * 10 + extra(p);
      return { slot: p.slot, score, label: p.alive ? 'Survived!' : `Out #${this.players.length - outIndex}` };
    });
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, REALTIME_CLOCK ? 120 : 50);
    for (const p of this.players) p.vc?.step();
    this.ambient(dt);
    if (this.phase !== 'playing') {
      this.refreshHud();
      return;
    }
    // Pause: any human pressing Menu.
    for (const p of this.players) {
      if (!p.isCpu && p.controls.pressed('MENU')) {
        this.openPause(p.slot);
        return;
      }
    }
    for (const p of this.players) {
      if (p.vc && p.alive) this.cpuThink(p, p.vc, dt);
    }
    this.tick(dt);
    this.elapsed += dt;
    if (this.duration > 0 && this.elapsed >= this.duration) this.end();
    this.refreshHud();
  }

  protected openPause(owner: number): void {
    audio.play('pause');
    this.scene.launch('Pause', { owner, from: this.scene.key, minigame: this.launch });
    this.scene.pause();
  }

  /** Human slots taking part (for prompts). */
  protected humanSlots(): number[] {
    return this.players.filter((p) => !p.isCpu).map((p) => p.slot);
  }

  /** Controller vibration helper that respects CPUs. */
  protected rumble(p: MgPlayer, strong: number, weak: number, ms: number): void {
    if (!p.isCpu) p.controls.rumble(strong, weak, ms);
  }

  protected sessionMode(): 'board' | 'minigame' {
    return session.mode;
  }
}
