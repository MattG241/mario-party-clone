import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { DEBUG_ENABLED, debugInfo, errorLog } from '../debug/debug';
import { input, sameDevice } from '../input/InputManager';
import { session } from '../state/Session';
import { PromptBar } from '../ui/ControllerPrompt';
import { drawPanel } from '../ui/Panel';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addText } from '../ui/theme';
import { drawNavyPanel } from '../ui/Screen';

/** Scenes that must pause when a player's controller disconnects. */
function isGameplayScene(key: string): boolean {
  return key === 'Board' || key === 'BoardUI' || key === 'MinigameIntro' || key === 'Results' || key === 'FinalResults' || key.startsWith('mg-');
}

/**
 * Always-running overlay on top of every scene: subtitles, toasts, the controller-disconnect
 * pause, and the F2 debug overlay.
 */
export class SystemScene extends Phaser.Scene {
  private captionBox!: Phaser.GameObjects.Container;
  private captionText!: Phaser.GameObjects.Text;
  private captionBg!: Phaser.GameObjects.Graphics;
  private captionQueue: string[] = [];
  private captionTimer = 0;
  private toastBox!: Phaser.GameObjects.Container;
  private toastText!: Phaser.GameObjects.Text;
  private toastBg!: Phaser.GameObjects.Graphics;
  private disconnect: { slot: number; paused: string[]; box: Phaser.GameObjects.Container } | null = null;
  private debugText!: Phaser.GameObjects.Text;
  private debugBg!: Phaser.GameObjects.Graphics;
  private debugVisible = false;

  constructor() {
    super({ key: 'System', active: false });
  }

  create(): void {
    this.scene.bringToTop();
    // Subtitles
    this.captionBg = this.add.graphics();
    this.captionText = addText(this, 0, 0, '', 30, { color: CSS.white, weight: 600, fixed: false });
    this.captionBox = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT - 44, [this.captionBg, this.captionText]).setDepth(900).setVisible(false);
    audio.onCaption((t) => this.pushCaption(t));
    // Toasts
    this.toastBg = this.add.graphics();
    this.toastText = addText(this, 0, 0, '', 30, { color: CSS.ink, weight: 700 });
    this.toastBox = this.add.container(GAME_WIDTH / 2, -60, [this.toastBg, this.toastText]).setDepth(950);
    // Debug overlay
    this.debugBg = this.add.graphics().setDepth(990).setVisible(false);
    this.debugText = this.add
      .text(24, 24, '', { fontFamily: 'monospace', fontSize: '20px', color: '#c8f6ff', lineSpacing: 4 })
      .setDepth(991)
      .setVisible(false);
    input.on((e) => {
      if (e.type === 'connected') {
        if (!this.disconnect) this.toast(`🎮 Controller ${e.index + 1} connected`);
      } else {
        this.handleDisconnect(e.slot, e.index);
      }
    });
    if (DEBUG_ENABLED) {
      input.keyboard.onRawKey((ev) => {
        if (ev.code === 'F2') {
          ev.preventDefault();
          this.debugVisible = !this.debugVisible;
          this.debugBg.setVisible(this.debugVisible);
          this.debugText.setVisible(this.debugVisible);
        }
      });
    }
    // Unlock audio on the first real gesture (browsers require one).
    const unlock = () => audio.unlock();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  // --- Subtitles -------------------------------------------------------------------------------
  private pushCaption(text: string): void {
    if (this.captionQueue[this.captionQueue.length - 1] === text) return;
    this.captionQueue.push(text);
    if (this.captionQueue.length > 3) this.captionQueue.shift();
    this.renderCaptions();
    this.captionTimer = 2400;
  }

  private renderCaptions(): void {
    if (this.captionQueue.length === 0) {
      this.captionBox.setVisible(false);
      return;
    }
    this.captionText.setText(this.captionQueue.join('\n'));
    const w = this.captionText.width + 48;
    const h = this.captionText.height + 20;
    this.captionBg.clear();
    this.captionBg.fillStyle(0x0b1a24, 0.82);
    this.captionBg.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
    this.captionBox.setY(GAME_HEIGHT - 30 - h / 2).setVisible(true);
  }

  // --- Toasts ----------------------------------------------------------------------------------
  toast(text: string, ms = 2200): void {
    this.toastText.setText(text);
    const w = this.toastText.width + 60;
    this.toastBg.clear();
    drawPanel(this.toastBg, -w / 2, -34, w, 68, { radius: 30, borderWidth: 5, engraving: false, shadowOffset: 6 });
    this.tweens.killTweensOf(this.toastBox);
    this.toastBox.setY(-60);
    this.tweens.add({ targets: this.toastBox, y: 58, duration: 260, ease: 'Back.Out' });
    this.tweens.add({ targets: this.toastBox, y: -60, delay: ms, duration: 220, ease: 'Quad.In' });
  }

  // --- Controller disconnects ------------------------------------------------------------------
  private handleDisconnect(slot: number | null, index: number): void {
    if (slot === null || !session.isHuman(slot)) {
      this.toast(`Controller ${index + 1} disconnected`);
      return;
    }
    const running = this.scene.manager.getScenes(true).map((s) => s.scene.key);
    if (!running.some(isGameplayScene)) {
      // Menus handle missing controllers themselves (e.g. the join screen frees the slot).
      this.toast(`Controller ${index + 1} disconnected`);
      return;
    }
    if (this.disconnect) return;
    const paused = running.filter(isGameplayScene);
    for (const k of paused) this.scene.pause(k);
    const box = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(800);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x06141a, 0.72);
    const g = this.add.graphics();
    drawNavyPanel(g, -560, -210, 1120, 420, { border: COLORS.coral, header: { color: COLORS.coral, height: 64 } });
    const badge = new PlayerBadge(this, -430, -110, slot, 40);
    const title = addText(this, 40, -120, 'Controller disconnected', 54, { color: '#ffffff', weight: 700, stroke: '#06141a', strokeThickness: 5 });
    const body = addText(this, 0, 10, `Player ${slot + 1}, reconnect your controller\nor press Enter to continue on the keyboard.`, 36, { color: CSS.cream, weight: 500 });
    const prompts = new PromptBar(this, 0, 140, [], { size: 40, fontSize: 28 });
    prompts.setPrompts([{ button: 'A', label: 'Press A on a controller to take over' }], undefined);
    box.add([dim, g, badge, title, body, prompts]);
    this.disconnect = { slot, paused, box };
    audio.play('pause');
  }

  private resolveDisconnect(): void {
    const d = this.disconnect;
    if (!d) return;
    // Any controller not owned by another player can take over.
    for (const pad of input.connectedPads()) {
      const ref = { kind: 'gamepad' as const, index: pad.index };
      const owner = input.slotOf(ref);
      if ((owner === null || owner === d.slot) && pad.pressed('A')) {
        this.finishDisconnect(d.slot, ref);
        return;
      }
    }
    if (input.keyboard.pressed('A')) {
      this.finishDisconnect(d.slot, { kind: 'keyboard' });
    }
  }

  private finishDisconnect(slot: number, ref: { kind: 'gamepad'; index: number } | { kind: 'keyboard' }): void {
    const d = this.disconnect;
    if (!d) return;
    input.assign(slot, ref);
    const cfg = session.slots[slot];
    if (cfg) cfg.device = ref;
    input.lockHeld();
    d.box.destroy();
    for (const k of d.paused) if (this.scene.isPaused(k)) this.scene.resume(k);
    this.disconnect = null;
    audio.play('confirm');
    this.toast(`Player ${slot + 1} is back on ${ref.kind === 'keyboard' ? 'the keyboard' : `Controller ${ref.index + 1}`}`);
  }

  get disconnectActive(): boolean {
    return this.disconnect !== null;
  }

  // --- Frame ------------------------------------------------------------------------------------
  override update(_time: number, delta: number): void {
    this.scene.bringToTop();
    if (this.captionTimer > 0) {
      this.captionTimer -= delta;
      if (this.captionTimer <= 0) {
        this.captionQueue.shift();
        this.renderCaptions();
        if (this.captionQueue.length) this.captionTimer = 1600;
      }
    }
    if (this.disconnect) this.resolveDisconnect();
    if (this.debugVisible) this.renderDebug();
  }

  private renderDebug(): void {
    const loop = this.game.loop;
    const scenes = this.scene.manager
      .getScenes(true)
      .map((s) => s.scene.key)
      .filter((k) => k !== 'System');
    const lines: string[] = [];
    lines.push(`FPS ${loop.actualFps.toFixed(1)}   renderer ${this.game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas'}`);
    lines.push(`Scene: ${scenes.join(', ') || '-'}`);
    const pads = input.connectedPads();
    lines.push(`Controllers: ${pads.length === 0 ? 'none' : ''}`);
    for (const p of pads) {
      const slot = input.slotOf({ kind: 'gamepad', index: p.index });
      lines.push(`  #${p.index} ${p.shortName} [${p.mapping || 'no mapping'} → ${p.layout}] ${slot !== null ? `P${slot + 1}` : 'unassigned'}`);
    }
    const kbSlot = input.slots.findIndex((s) => sameDevice(s, { kind: 'keyboard' }));
    lines.push(`Keyboard: ${kbSlot >= 0 ? `P${kbSlot + 1}` : 'unassigned'}`);
    for (const [k, v] of Object.entries(debugInfo)) lines.push(`${k}: ${v}`);
    if (errorLog.length) {
      lines.push('Errors:');
      for (const e of errorLog) lines.push(`  ${e.slice(0, 90)}`);
    }
    lines.push('F3 skip turn · F4 minigame · F5 +20 chips · F6 item · F7 to relic · F8 finish round');
    this.debugText.setText(lines.join('\n'));
    this.debugBg.clear();
    this.debugBg.fillStyle(0x03121a, 0.82);
    this.debugBg.fillRoundedRect(12, 12, this.debugText.width + 28, this.debugText.height + 24, 12);
  }
}

export function system(scene: Phaser.Scene): SystemScene {
  return scene.scene.get('System') as SystemScene;
}
