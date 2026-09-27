import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { Character } from '../characters/Character';
import { COLORS, CSS, DEPTH, PLAYER_COLORS } from '../constants';
import { CHARACTERS } from '../data/characters';
import type { EffectsManager } from '../effects/EffectsManager';
import type { MatchState, PlayerState } from '../state/MatchState';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addText } from '../ui/theme';
import type { BoardManager } from './BoardManager';
import type { JumpKind } from './flowTypes';

export const TOKEN_SCALE = 0.6;

const LAYOUTS: [number, number][][] = [
  [[0, 0]],
  [
    [-50, 6],
    [54, -8],
  ],
  [
    [0, 12],
    [-92, -10],
    [94, -14],
  ],
  [
    [-46, 14],
    [48, 10],
    [-124, -14],
    [126, -18],
  ],
];

interface Tag {
  container: Phaser.GameObjects.Container;
  counter: Phaser.GameObjects.Container;
  counterText: Phaser.GameObjects.Text;
  shield: Phaser.GameObjects.Sprite;
}

/** Player tokens on the board and every way they move between spaces. */
export class MovementController {
  readonly tokens = new Map<number, Character>();
  private tags = new Map<number, Tag>();
  activeSlot: number | null = null;

  constructor(
    private scene: Phaser.Scene,
    private board: BoardManager,
    private fx: EffectsManager,
    private dur: (ms: number) => number,
  ) {}

  createTokens(state: MatchState): void {
    for (const p of state.players) {
      const c = new Character(this.scene, 0, 0, p.characterId, { scale: TOKEN_SCALE, slot: p.slot, marker: false });
      this.tokens.set(p.slot, c);
      const container = this.scene.add.container(0, 0).setDepth(DEPTH.worldUi);
      const badge = new PlayerBadge(this.scene, 0, 0, p.slot, 20);
      const counter = this.scene.add.container(0, -58).setVisible(false);
      const cg = this.scene.add.graphics();
      cg.fillStyle(0x1b1530, 0.35);
      cg.fillCircle(0, 5, 40);
      cg.fillStyle(COLORS.gold, 1);
      cg.fillCircle(0, 0, 40);
      cg.lineStyle(5, COLORS.cream, 1);
      cg.strokeCircle(0, 0, 40);
      const counterText = addText(this.scene, 0, -2, '0', 48, { color: CSS.ink, weight: 700, fixed: true });
      counter.add([cg, counterText]);
      const shield = this.scene.add.sprite(0, 0, 'items', '24').play('bubble-idle').setVisible(false).setAlpha(0.7).setScale(0.42);
      container.add([badge, counter]);
      this.tags.set(p.slot, { container, counter, counterText, shield });
      c.add(shield);
      shield.setPosition(0, -130).setScale(0.9);
    }
    this.arrange(state, true);
  }

  token(slot: number): Character {
    return this.tokens.get(slot)!;
  }

  /** Position of a slot on its node, given who else is there. */
  standPos(state: MatchState, slot: number, nodeId?: string): { x: number; y: number } {
    const node = nodeId ?? state.players.find((p) => p.slot === slot)!.nodeId;
    const here = state.players.filter((p) => p.nodeId === node).map((p) => p.slot);
    if (!here.includes(slot)) here.push(slot);
    // Active player takes the front-centre spot.
    here.sort((a, b) => (a === this.activeSlot ? -1 : b === this.activeSlot ? 1 : a - b));
    const layout = LAYOUTS[Math.min(here.length, 4) - 1];
    const i = here.indexOf(slot);
    const [ox, oy] = layout[Math.min(i, layout.length - 1)];
    const base = this.board.pos(node);
    return { x: base.x + ox, y: base.y + oy - 6 };
  }

  arrange(state: MatchState, instant = false, except?: number): void {
    for (const p of state.players) {
      if (p.slot === except) continue;
      const c = this.token(p.slot);
      const t = this.standPos(state, p.slot);
      if (instant) c.setPosition(t.x, t.y);
      else this.scene.tweens.add({ targets: c, x: t.x, y: t.y, duration: this.dur(220), ease: 'Quad.Out' });
    }
  }

  setShield(slot: number, on: boolean): void {
    this.tags.get(slot)?.shield.setVisible(on);
  }

  setCounter(slot: number, n: number | null): void {
    const tag = this.tags.get(slot);
    if (!tag) return;
    if (n === null || n <= 0) {
      tag.counter.setVisible(false);
      return;
    }
    const was = tag.counter.visible;
    tag.counter.setVisible(true);
    tag.counterText.setText(String(n));
    if (was) this.scene.tweens.add({ targets: tag.counter, scale: { from: 1.25, to: 1 }, duration: 150, ease: 'Back.Out' });
    else this.scene.tweens.add({ targets: tag.counter, scale: { from: 0.2, to: 1 }, duration: 240, ease: 'Back.Out' });
  }

  /** Keep tags above heads and y-sort tokens (call every frame). */
  update(): void {
    for (const [slot, c] of this.tokens) {
      c.setDepth(c.y + (slot === this.activeSlot ? 0.5 : 0));
      const tag = this.tags.get(slot);
      if (!tag) continue;
      const lift = c.sprite.y;
      const active = slot === this.activeSlot;
      tag.container.setPosition(c.x, c.y - 170 + lift);
      tag.container.setDepth(DEPTH.worldUi + (active ? 10 : 0));
      // Only the active player's marker is full size, so shared spaces stay readable.
      const want = this.activeSlot === null || active ? 1 : 0.72;
      if (Math.abs(tag.container.scale - want) > 0.01) tag.container.setScale(tag.container.scale + (want - tag.container.scale) * 0.2);
    }
  }

  private hopTo(c: Character, x: number, y: number, ms: number, height: number, ease = 'Linear'): Promise<void> {
    return new Promise((resolve) => {
      const x0 = c.x;
      const y0 = c.y;
      const hold = { t: 0 };
      this.scene.tweens.add({
        targets: hold,
        t: 1,
        duration: ms,
        ease,
        onUpdate: () => {
          c.x = x0 + (x - x0) * hold.t;
          c.y = y0 + (y - y0) * hold.t;
          c.sprite.y = -Math.sin(hold.t * Math.PI) * height;
          c.shadow?.setScale(1 - Math.sin(hold.t * Math.PI) * 0.3);
        },
        onComplete: () => {
          c.sprite.y = 0;
          c.shadow?.setScale(1);
          resolve();
        },
      });
    });
  }

  async step(state: MatchState, p: PlayerState, _from: string, to: string, remaining: number): Promise<void> {
    const c = this.token(p.slot);
    const target = this.standPos(state, p.slot, to);
    c.faceToward(target.x);
    if (c.current !== 'run') c.play('run');
    this.setCounter(p.slot, remaining + 1);
    await this.hopTo(c, target.x, target.y, this.dur(300), 26);
    this.setCounter(p.slot, remaining);
    audio.play('step', { rate: CHARACTERS[p.characterId].pitch * (0.95 + Math.random() * 0.1), volume: 0.7 });
    this.fx.vfx('dust', target.x - (c.isFacingLeft ? -26 : 26), target.y - 8, { scale: 0.22, duration: 360, alpha: 0.7 });
    this.board.pulseNode(to, COLORS.cream);
    if (p.characterId === 'tumble') this.fx.shake(0.0012, 80);
  }

  settle(state: MatchState, p: PlayerState): void {
    const c = this.token(p.slot);
    c.play('idle');
    c.squash(0.12, 160);
    this.setCounter(p.slot, null);
    this.arrange(state);
  }

  async jump(state: MatchState, p: PlayerState, from: string, to: string, kind: JumpKind): Promise<void> {
    const c = this.token(p.slot);
    const a = { x: c.x, y: c.y };
    const b = this.standPos(state, p.slot, to);
    const s = this.scene;
    c.faceToward(b.x);
    switch (kind) {
      case 'portal':
      case 'warp':
      case 'guide': {
        audio.play('portal');
        const swirl = kind === 'portal' ? 'portalSwirl' : kind === 'warp' ? 'pinkSwirl' : 'goldSwirl';
        this.fx.vfx(swirl, a.x, a.y - 60, { scale: 0.8, duration: 900, blend: 'add' });
        c.play(kind === 'portal' ? 'portal' : 'jump');
        await tweenP(s, { targets: c, scale: 0.05, angle: 360, duration: this.dur(520), ease: 'Back.In' });
        c.setPosition(b.x, b.y);
        c.setAngle(0);
        this.fx.vfx(swirl, b.x, b.y - 60, { scale: 0.8, duration: 900, blend: 'add' });
        await tweenP(s, { targets: c, scale: TOKEN_SCALE, duration: this.dur(420), ease: 'Back.Out' });
        c.play('celebrate');
        break;
      }
      case 'swap': {
        audio.play('whoosh');
        this.fx.vfx('tornado', a.x, a.y - 80, { scale: 0.8, duration: 900 });
        c.play('surprised');
        await this.hopTo(c, b.x, b.y, this.dur(700), 220, 'Sine.InOut');
        break;
      }
      case 'cannon': {
        audio.play('explosion');
        this.fx.vfx('smoke', a.x, a.y - 60, { scale: 0.6 });
        this.fx.shake(0.008, 200);
        c.play('jump');
        const trail = s.time.addEvent({ delay: 60, loop: true, callback: () => this.fx.vfx('smoke', c.x, c.y + c.sprite.y - 50, { scale: 0.18, duration: 500, alpha: 0.6 }) });
        await this.hopTo(c, b.x, b.y, this.dur(1300), 520, 'Sine.InOut');
        trail.remove();
        audio.play('land');
        this.fx.vfx('dust', b.x, b.y - 10, { scale: 0.6 });
        this.fx.shake(0.01, 240);
        c.squash(0.25, 220);
        c.play('stunned');
        break;
      }
      case 'bounce': {
        audio.play('bounce');
        c.play('jump');
        await this.hopTo(c, b.x, b.y, this.dur(750), 260, 'Sine.InOut');
        audio.play('land');
        this.fx.vfx('dust', b.x, b.y - 8, { scale: 0.4 });
        c.squash(0.2, 180);
        c.play('celebrate');
        break;
      }
      case 'wind': {
        audio.play('whoosh');
        c.play('surprised');
        this.fx.vfx('waterStreak', a.x, a.y - 70, { scale: 0.7, tint: 0xffffff, alpha: 0.8, flipX: b.x < a.x });
        await this.hopTo(c, b.x, b.y, this.dur(650), 60, 'Quad.Out');
        c.play('stunned');
        break;
      }
      case 'fall': {
        audio.play('crack');
        c.play('fall');
        await this.hopTo(c, b.x, b.y, this.dur(700), 80, 'Quad.In');
        audio.play('land');
        this.fx.vfx('dust', b.x, b.y - 8, { scale: 0.5 });
        c.play('stunned');
        break;
      }
    }
    void from;
    this.arrange(state, false, p.slot);
  }
}

export function tweenP(scene: Phaser.Scene, config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
  return new Promise((resolve) => {
    scene.tweens.add({ ...config, onComplete: () => resolve() });
  });
}

export { PLAYER_COLORS };
