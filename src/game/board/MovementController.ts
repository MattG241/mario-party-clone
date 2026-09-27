import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { animHeadTop, Character } from '../characters/Character';
import { COLORS, CSS, DEPTH, PLAYER_COLORS } from '../constants';
import { CHARACTERS } from '../data/characters';
import type { EffectsManager } from '../effects/EffectsManager';
import type { MatchState, PlayerState } from '../state/MatchState';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addText } from '../ui/theme';
import type { BoardManager } from './BoardManager';
import type { JumpKind } from './flowTypes';

export const TOKEN_SCALE = 0.6;

/** Where players stand when sharing a space: a shallow arc facing the camera (active player first). */
const LAYOUTS: [number, number][][] = [
  [[0, 0]],
  [
    [-56, 10],
    [58, 0],
  ],
  [
    [0, 18],
    [-108, -2],
    [108, -4],
  ],
  [
    [-52, 24],
    [54, 22],
    [-156, 2],
    [158, 0],
  ],
];

interface Tag {
  container: Phaser.GameObjects.Container;
  badge: Phaser.GameObjects.Container;
  /** Head top above the feet at token scale (negative). */
  head: number;
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
      // Little pointer under the badge so it clearly belongs to the head below it.
      const stem = this.scene.add.graphics();
      stem.fillStyle(0xffffff, 1);
      stem.fillTriangle(-11, 14, 11, 14, 0, 34);
      stem.fillStyle(PLAYER_COLORS[p.slot], 1);
      stem.fillTriangle(-6, 16, 6, 16, 0, 28);
      const badge = new PlayerBadge(this.scene, 0, 0, p.slot, 20);
      const counter = this.scene.add.container(0, -6).setVisible(false);
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
      container.add([stem, badge, counter]);
      this.tags.set(p.slot, { container, badge, head: animHeadTop(p.characterId) * TOKEN_SCALE, counter, counterText, shield });
      c.add(shield);
      shield.setPosition(0, -130).setScale(0.9);
    }
    this.arrange(state, true);
  }

  /** Tint every token to sit in the scene's light (warm by day, rosy-violet at the dusk finale). */
  setLightTint(dusk: boolean): void {
    for (const c of this.tokens.values()) c.sprite.setTint(dusk ? 0xf2dcf0 : 0xfff5e8);
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
      tag.badge.setVisible(true);
      this.clearRoute();
      return;
    }
    const was = tag.counter.visible;
    // The step counter takes the marker's place while moving (no stacked badges).
    tag.counter.setVisible(true);
    tag.badge.setVisible(false);
    tag.counterText.setText(String(n));
    if (was) this.scene.tweens.add({ targets: tag.counter, scale: { from: 1.25, to: 1 }, duration: 150, ease: 'Back.Out' });
    else this.scene.tweens.add({ targets: tag.counter, scale: { from: 0.2, to: 1 }, duration: 240, ease: 'Back.Out' });
  }

  private route: Phaser.GameObjects.Image[] = [];

  /** Glow the spaces ahead (up to the next fork) so the move reads before it happens. */
  showRoute(from: string, steps: number): void {
    this.clearRoute();
    let id = from;
    for (let i = 0; i < steps; i++) {
      const n = this.board.graph.node(id);
      if (!n || n.next.length !== 1) break;
      id = n.next[0];
      const q = this.board.pos(id);
      const last = i === steps - 1;
      const ring = this.scene.add.image(q.x, q.y, 'fx-ring').setTint(last ? COLORS.goldLight : COLORS.crystalLight).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.spaces + 2);
      ring.setScale(last ? 1.05 : 0.8, last ? 0.8 : 0.6).setAlpha(0);
      this.scene.tweens.add({ targets: ring, alpha: { from: 0, to: last ? 0.95 : 0.6 }, delay: i * 70, duration: 220 });
      this.scene.tweens.add({ targets: ring, scaleX: ring.scaleX * 1.08, scaleY: ring.scaleY * 1.08, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.route.push(ring);
    }
  }

  /** Drop the preview ring for a space the token has just reached. */
  private shiftRoute(): void {
    const r = this.route.shift();
    if (r) {
      this.scene.tweens.killTweensOf(r);
      this.scene.tweens.add({ targets: r, alpha: 0, scaleX: r.scaleX * 1.4, scaleY: r.scaleY * 1.4, duration: 200, onComplete: () => r.destroy() });
    }
  }

  clearRoute(): void {
    for (const r of this.route) {
      this.scene.tweens.killTweensOf(r);
      r.destroy();
    }
    this.route = [];
  }

  /** Keep tags above heads and y-sort tokens (call every frame). */
  update(): void {
    for (const [slot, c] of this.tokens) {
      c.setDepth(c.y + (slot === this.activeSlot ? 0.5 : 0));
      const tag = this.tags.get(slot);
      if (!tag) continue;
      const lift = c.sprite.y;
      const active = slot === this.activeSlot;
      const full = this.activeSlot === null || active;
      tag.container.setPosition(c.x, c.y + tag.head * (c.scale / TOKEN_SCALE) - (full ? 44 : 30) + lift);
      tag.container.setDepth(DEPTH.worldUi + (active ? 10 : 0));
      // Only the active player's marker is full size, so shared spaces stay readable; markers grow
      // when the camera pulls back so players stay easy to find on the overview.
      const zoomK = Phaser.Math.Clamp(0.85 / this.scene.cameras.main.zoom, 1, 1.9);
      const want = (full ? 1 : 0.6) * zoomK;
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
    await this.hopTo(c, target.x, target.y, this.dur(300), 30);
    this.setCounter(p.slot, remaining);
    this.shiftRoute();
    audio.play('step', { rate: CHARACTERS[p.characterId].pitch * (0.95 + Math.random() * 0.1), volume: 0.7 });
    this.fx.vfx('dust', target.x - (c.isFacingLeft ? -30 : 30), target.y - 6, { scale: 0.34, duration: 420, alpha: 0.8 });
    c.squash(0.1, 120);
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
