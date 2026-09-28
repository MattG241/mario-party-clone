import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import type { Character } from '../characters/Character';
import { COLORS, CSS, GAME_WIDTH, PLAYER_COLORS, type CpuLevel } from '../constants';
import { CHARACTERS, type CharacterId } from '../data/characters';
import { HIDE_CPU_TAGS, REALTIME_CLOCK, setDebugInfo } from '../debug/debug';
import { EffectsManager } from '../effects/EffectsManager';
import { applyGrade } from '../effects/GradePipeline';
import type { Controls } from '../input/Controls';
import { input } from '../input/InputManager';
import { VirtualControls } from '../input/PlayerInput';
import { session } from '../state/Session';
import { placementsFromScores } from '../state/scoring';
import { addPortrait } from '../ui/Portrait';
import { drawCapsule } from '../ui/Screen';
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

/** Minigame HUD capsule size. */
const HUD_W = 272;
const HUD_H = 78;

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
  private hudTags = new Map<number, { score: Phaser.GameObjects.Text; root: Phaser.GameObjects.Container; status: Phaser.GameObjects.Text; pips?: Phaser.GameObjects.Graphics; pipKey?: string; pipX: number; flip: boolean }>();
  private timerText?: Phaser.GameObjects.Text;
  private timerArc?: Phaser.GameObjects.Graphics;
  private ending = false;
  /** Real milliseconds left of a hit-stop freeze and of a slow-motion stretch (see hitStop, slowMo). */
  private freezeLeft = 0;
  private slowLeft = 0;
  private slowFactor = 1;
  private clockK = 1;

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
    this.timerArc = undefined;
    this.freezeLeft = 0;
    this.slowLeft = 0;
    this.slowFactor = 1;
    this.clockK = 1;
    // The clocks outlive a restart, and a round can end mid-freeze.
    this.tweens.timeScale = 1;
    this.time.timeScale = 1;
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
    applyGrade(this, { vignette: 0.08 });
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
  /** Games with lives can show them as hearts in the HUD instead of a number. */
  protected hudPips(_p: MgPlayer): { filled: number; total: number } | null {
    return null;
  }

  /**
   * Freeze the game for a few frames (a hit landing, a pickup snapping in): the classic impact
   * freeze-frame. Game time, tweens and timers all hold, then carry on. Keep it short (40–140 ms).
   */
  hitStop(ms: number): void {
    this.freezeLeft = Math.max(this.freezeLeft, ms);
  }

  /** Run the game at `factor` speed (0.2–0.6) for `ms` real milliseconds: decisive moments. */
  slowMo(factor: number, ms: number): void {
    this.slowFactor = Phaser.Math.Clamp(factor, 0.05, 1);
    this.slowLeft = Math.max(this.slowLeft, ms);
  }

  /** This frame's game-clock scale: 0 during a hit-stop, the slow-motion factor during one. */
  private clockScale(real: number): number {
    let k = 1;
    if (this.freezeLeft > 0) {
      this.freezeLeft -= real;
      k = 0;
    } else if (this.slowLeft > 0) {
      this.slowLeft -= real;
      k = this.slowFactor;
    }
    if (k !== this.clockK) {
      this.clockK = k;
      this.tweens.timeScale = k;
      this.time.timeScale = k;
      // Character flipbooks run on the global animation clock, so scale each one directly.
      for (const p of this.players) if (p.character) p.character.sprite.anims.timeScale = k;
    }
    return k;
  }

  protected skill(p: MgPlayer) {
    return CPU_SKILL[p.cpuLevel];
  }

  get alivePlayers(): MgPlayer[] {
    return this.players.filter((p) => p.alive);
  }

  // --- HUD --------------------------------------------------------------------------------------
  /**
   * Top strip in the same visual language as the board HUD: translucent capsules with the
   * portrait breaking the outer end, plus a round timer medallion with a draining arc.
   */
  private buildHud(): void {
    const n = this.players.length;
    const hasTimer = this.duration > 0;
    const W = HUD_W;
    const H = HUD_H;
    // Capsule left edges: two pairs either side of the centre (clearing the timer when present).
    const gap = 34;
    const inner = hasTimer ? 96 : gap / 2;
    const lefts: number[] = [];
    const leftCount = Math.ceil(n / 2);
    for (let i = 0; i < leftCount; i++) lefts.push(GAME_WIDTH / 2 - inner - (leftCount - i) * W - (leftCount - 1 - i) * gap);
    for (let i = 0; i < n - leftCount; i++) lefts.push(GAME_WIDTH / 2 + inner + i * (W + gap));
    this.players.forEach((p, i) => {
      const flip = i >= leftCount;
      const x = lefts[i];
      const y = 22;
      const color = PLAYER_COLORS[p.slot];
      const root = this.add.container(x, y).setDepth(9000);
      const bg = this.add.graphics();
      drawCapsule(bg, W, H, color);
      const lx = (v: number) => (flip ? W - v : v);
      const pr = 42;
      const portrait = addPortrait(this, p.characterId, p.slot, pr, { flip, worldX: x + lx(34), worldY: y + H / 2 });
      portrait.setPosition(lx(34), H / 2);
      const align = flip ? 'right' : 'left';
      const name = addText(this, lx(92), 22, CHARACTERS[p.characterId].name.split(' ')[0].toUpperCase(), 19, { color: '#dfe5ee', weight: 700, align });
      const parts: Phaser.GameObjects.GameObject[] = [bg, name];
      if (p.isCpu && !HIDE_CPU_TAGS) {
        const tw = 44;
        const tx = flip ? lx(92) - name.width - 8 - tw : lx(92) + name.width + 8;
        const tag = this.add.graphics();
        tag.fillStyle(0xffffff, 0.14);
        tag.fillRoundedRect(tx, 11, tw, 22, 11);
        parts.push(tag, addText(this, tx + tw / 2, 22, 'CPU', 13, { color: '#dfe5ee', weight: 700 }));
      }
      const score = addText(this, lx(92), 52, '0', 40, { color: '#ffffff', weight: 700, align });
      const status = addText(this, lx(W - 46), H / 2, '', 24, { color: CSS.coral, weight: 700 });
      root.add([...parts, score, status, portrait]);
      const tag: { score: Phaser.GameObjects.Text; root: Phaser.GameObjects.Container; status: Phaser.GameObjects.Text; pips?: Phaser.GameObjects.Graphics; pipKey?: string; pipX: number; flip: boolean } = { score, root, status, pipX: lx(92), flip };
      if (this.hudPips(p)) {
        score.setVisible(false);
        tag.pips = this.add.graphics();
        root.add(tag.pips);
      }
      this.hudTags.set(p.slot, tag);
    });
    if (hasTimer) {
      const cx = GAME_WIDTH / 2;
      const cy = 62;
      const g = this.add.graphics().setDepth(9000);
      g.fillStyle(0x0a1120, 0.14);
      g.fillCircle(cx, cy + 4, 56);
      g.fillStyle(0x121b2b, 0.78);
      g.fillCircle(cx, cy, 56);
      g.lineStyle(1.5, 0xffffff, 0.1);
      g.strokeCircle(cx, cy, 55);
      this.timerArc = this.add.graphics().setDepth(9001);
      this.timerText = addText(this, cx, cy + 2, String(Math.ceil(this.duration / 1000)), 48, { color: '#ffffff', weight: 700 }).setDepth(9002);
      this.drawTimerArc(1);
    }
  }

  /** Screen point of a player's HUD score: where score pop-ups (juice.popToHud) should land. */
  hudPoint(slot: number): { x: number; y: number } {
    const tag = this.hudTags.get(slot);
    if (!tag) return { x: GAME_WIDTH / 2, y: 60 };
    return { x: tag.root.x + tag.pipX + (tag.flip ? -24 : 24), y: tag.root.y + 52 };
  }

  /** Bump a player's HUD capsule (a pop-up landing on it). */
  bumpHud(slot: number): void {
    const tag = this.hudTags.get(slot);
    if (tag) this.tweens.add({ targets: tag.root, scale: { from: 1.07, to: 1 }, duration: 200, ease: 'Back.Out' });
  }

  /** Row of hearts: filled ones in coral, lost ones as rimmed hollows. */
  private drawPips(g: Phaser.GameObjects.Graphics, x0: number, y: number, pips: { filled: number; total: number }, flip: boolean): void {
    g.clear();
    const heart = (x: number, cy: number, sz: number, color: number, alpha: number) => {
      g.fillStyle(color, alpha);
      g.fillCircle(x - sz * 0.26, cy - sz * 0.12, sz * 0.3);
      g.fillCircle(x + sz * 0.26, cy - sz * 0.12, sz * 0.3);
      g.fillTriangle(x - sz * 0.55, cy - sz * 0.02, x + sz * 0.55, cy - sz * 0.02, x, cy + sz * 0.56);
    };
    for (let i = 0; i < pips.total; i++) {
      const x = flip ? x0 - 18 - i * 44 : x0 + 18 + i * 44;
      heart(x + 2, y + 3, 40, 0x06141a, 0.45);
      if (i < pips.filled) {
        heart(x, y, 40, 0xffffff, 1);
        heart(x, y + 1, 32, COLORS.coral, 1);
        g.fillStyle(0xffffff, 0.55);
        g.fillCircle(x - 8, y - 8, 4);
      } else {
        // an empty heart: light rim around a dark hollow, so it still reads on the dark plate
        heart(x, y, 38, 0xffffff, 0.42);
        heart(x, y + 1, 29, 0x1c2a36, 1);
      }
    }
  }

  private drawTimerArc(frac: number): void {
    const g = this.timerArc;
    if (!g) return;
    const cx = GAME_WIDTH / 2;
    const cy = 62;
    g.clear();
    g.lineStyle(6, 0xffffff, 0.14);
    g.strokeCircle(cx, cy, 45);
    if (frac <= 0) return;
    const warn = frac * this.duration <= 5000;
    g.lineStyle(6, warn ? COLORS.coral : 0xffffff, 1);
    g.beginPath();
    g.arc(cx, cy, 47, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
    g.strokePath();
  }

  protected refreshHud(): void {
    for (const p of this.players) {
      const tag = this.hudTags.get(p.slot);
      if (!tag) continue;
      const pips = tag.pips ? this.hudPips(p) : null;
      if (tag.pips && pips) {
        const key = `${pips.filled}/${pips.total}`;
        if (key !== tag.pipKey) {
          const lost = tag.pipKey !== undefined;
          tag.pipKey = key;
          this.drawPips(tag.pips, tag.pipX, 53, pips, tag.flip);
          if (lost) this.tweens.add({ targets: tag.root, scale: { from: 1.08, to: 1 }, duration: 220, ease: 'Back.Out' });
        }
      }
      const label = this.hudLabel(p);
      if (tag.score.text !== label) {
        tag.score.setText(label);
        this.tweens.add({ targets: tag.score, scale: { from: 1.3, to: 1 }, duration: 180 });
      }
      tag.status.setText(p.alive ? '' : 'OUT');
      tag.root.setAlpha(p.alive ? 1 : 0.55);
    }
    if (this.timerText) {
      const leftMs = Math.max(0, this.duration - this.elapsed);
      this.drawTimerArc(leftMs / this.duration);
      const left = Math.ceil(leftMs / 1000);
      if (this.timerText.text !== String(left)) {
        this.timerText.setText(String(left));
        if (left <= 5 && this.phase === 'playing') {
          this.timerText.setColor('#ff8a7a');
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
      const lasted = Math.max(1, Math.round((p.doneAt ?? this.elapsed) / 1000));
      return { slot: p.slot, score, label: p.alive ? 'Last one standing!' : `Lasted ${lasted}s` };
    });
  }

  override update(_time: number, delta: number): void {
    const real = Math.min(delta, REALTIME_CLOCK ? 120 : 50);
    const dt = real * this.clockScale(real);
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
