import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import type { Character } from '../characters/Character';
import type { AnimName } from '../characters/CharacterAnimations';
import { COLORS, CSS, GAME_WIDTH, PLAYER_COLORS, PLAYER_COLORS_DARK, type CpuLevel } from '../constants';
import { CHARACTERS, type CharacterId } from '../data/characters';
import { HIDE_CPU_TAGS, REALTIME_CLOCK, setDebugInfo } from '../debug/debug';
import { EffectsManager } from '../effects/EffectsManager';
import { applyGrade } from '../effects/GradePipeline';
import type { Controls } from '../input/Controls';
import { input } from '../input/InputManager';
import { VirtualControls } from '../input/PlayerInput';
import { LITE } from '../perf';
import { session } from '../state/Session';
import { placementsFromScores } from '../state/scoring';
import { addPortrait } from '../ui/Portrait';
import { drawCapsule } from '../ui/Screen';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { Random } from '../util/Random';
import { hasFinalStretch, isScoreGain, uniqueLeader } from './hudRules';
import { banner, cameraMotionOk, confettiBurst, flashScreen, kick, settleCamera, shockwave } from './juice';
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

/** Minigame HUD capsule size and top edge. */
const HUD_W = 272;
const HUD_H = 78;
const HUD_Y = 22;
/** Timer medallion centre. */
const TIMER_X = GAME_WIDTH / 2;
const TIMER_Y = 62;
/** Height of the big call-outs (countdown, FINISH!). */
const CALL_Y = 500;
/** Countdown: a number every COUNT_STEP ms from COUNT_START; the camera eases in this far meanwhile. */
const COUNT_START = 500;
const COUNT_STEP = 700;
const COUNT_PUSH = 1.035;
/** "FINAL 10 SECONDS!": when it starts, and how much the music quickens. */
const FINAL_STRETCH_AT = 10000;
const FINAL_TEMPO = 1.12;
/** The last FINISH_LEAD ms of game time before the buzzer play at FINISH_SLOW speed. */
const FINISH_LEAD = 180;
const FINISH_SLOW = 0.4;
/** The final frame holds this long (real ms) before FINISH! slams in. */
const FINISH_FREEZE = 160;
/** How far the camera pushes in towards the winner. */
const FINISH_ZOOM = 1.1;
/** Knock-outs: a freeze-frame, and when one decides the round its fall plays in slow motion. */
const KO_STOP = 90;
const KO_STOP_LAST = 120;
const KO_SLOW = 0.3;
const KO_SLOW_MS = 520;
const KO_END_DELAY = 600;
/**
 * Animations the finish reaction may interrupt. Anything else (a victory a game has already
 * started, a fall, a ledge hang, a jump in mid-air) is the game's own and is left alone.
 */
const NEUTRAL: readonly AnimName[] = ['idle', 'walk', 'run', 'sprint', 'crouch', 'dash', 'balance', 'carry', 'pull', 'wave'];

interface HudTag {
  /** Capsule wrapper pinned at the capsule's resting centre (shakes move everything on it). */
  wrap: Phaser.GameObjects.Container;
  /** The capsule itself, centred on the wrapper so bumps scale about its middle. */
  root: Phaser.GameObjects.Container;
  score: Phaser.GameObjects.Text;
  pips?: Phaser.GameObjects.Graphics;
  pipKey?: string;
  /** Left edge of the score / hearts, in capsule coordinates (from its top-left corner). */
  pipX: number;
  flip: boolean;
  /** Capsule-shaped additive glow for score flashes. */
  glow: Phaser.GameObjects.Graphics;
  glowColor: number;
  glowTw?: Phaser.Tweens.Tween;
  bump?: Phaser.Tweens.Tween;
  lastFlash: number;
  /** The portrait's circular mask: drawn in screen space, so it is kept in step by hand (syncHud). */
  mask?: Phaser.GameObjects.Graphics;
  mz: number;
  mb: number;
  mx: number;
  my: number;
  /** Resting centre on screen. */
  cx: number;
  cy: number;
  /** Points still flying in on score pop-ups: the number shows the score without them (see holdHud). */
  pending: number;
  holdUntil: number;
  stamp?: Phaser.GameObjects.Container;
}

/** A game's own screen-space UI held steady through a zoom: its resting transform, and what was last written. */
interface Steady {
  rx: number;
  ry: number;
  rsx: number;
  rsy: number;
  wx: number;
  wy: number;
  wsx: number;
  wsy: number;
}

type UiObject = Phaser.GameObjects.GameObject & { x: number; y: number; scaleX: number; scaleY: number; scrollFactorX?: number; depth?: number };

/** Blend two 0xRRGGBB colours (t = 0 gives a, 1 gives b). */
function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** First geometry-mask graphics found on an object or inside a container. */
function findMask(o: Phaser.GameObjects.GameObject): Phaser.GameObjects.Graphics | undefined {
  const m = (o as unknown as { mask?: { geometryMask?: Phaser.GameObjects.Graphics } | null }).mask;
  if (m?.geometryMask) return m.geometryMask;
  if (o instanceof Phaser.GameObjects.Container) {
    for (const child of o.list) {
      const g = findMask(child);
      if (g) return g;
    }
  }
  return undefined;
}

/** The capsule flash: a bright rim in the given colour with only a faint fill inside. */
function drawCapsuleGlow(g: Phaser.GameObjects.Graphics, color: number): void {
  g.clear();
  g.fillStyle(color, 0.3);
  g.fillRoundedRect(0, 0, HUD_W, HUD_H, HUD_H / 2);
  g.lineStyle(6, color, 1);
  g.strokeRoundedRect(3, 3, HUD_W - 6, HUD_H - 6, (HUD_H - 6) / 2);
}

/**
 * Base class for every minigame scene. Subclasses build the arena, spawn player visuals, run
 * their gameplay in tick(), drive CPU players in cpuThink() and report scores. The base runs the
 * shared big moments: the countdown, the final-seconds stretch, knock-outs, the leader's crown and
 * the FINISH! with the winner's celebration.
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
  private hudTags = new Map<number, HudTag>();
  /** HUD layer and big call-out layer: pinned to the screen and held steady through camera zooms. */
  private hudRoot?: Phaser.GameObjects.Container;
  private callRoot?: Phaser.GameObjects.Container;
  private hudZoom = 1;
  /** A game's own screen-space UI (the UI depth band), steadied the same way while the camera is zoomed. */
  private steady = new Map<UiObject, Steady>();
  private timerC?: Phaser.GameObjects.Container;
  private timerText?: Phaser.GameObjects.Text;
  private timerArc?: Phaser.GameObjects.Graphics;
  private timerGlow?: Phaser.GameObjects.Graphics;
  private bigNum?: Phaser.GameObjects.Text;
  private crown?: Phaser.GameObjects.Container;
  private crownSlot: number | null = null;
  private crownT = 0;
  /** A new leader waiting to be confirmed, and since when (real ms). */
  private crownNext: number | null | undefined = undefined;
  private crownSeen = 0;
  private crownTweens: Phaser.Tweens.Tween[] = [];
  private countPush?: Phaser.Tweens.Tween;
  private finalStretch = false;
  private finishLead = false;
  private ending = false;
  /** Real milliseconds since the scene started (HUD throttles, safety timeouts). */
  private realNow = 0;
  /** Real milliseconds left of a hit-stop freeze and of a slow-motion stretch (see hitStop, slowMo). */
  private freezeLeft = 0;
  private slowLeft = 0;
  private slowFactor = 1;
  private clockK = 1;
  /** ?realtime only: how much of a (very slow) frame's raw delta the timers may use (see update). */
  private rtK = 1;

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
    this.hudRoot = undefined;
    this.callRoot = undefined;
    this.hudZoom = 1;
    this.steady.clear();
    this.timerC = undefined;
    this.timerText = undefined;
    this.timerArc = undefined;
    this.timerGlow = undefined;
    this.bigNum = undefined;
    this.crown = undefined;
    this.crownSlot = null;
    this.crownT = 0;
    this.crownNext = undefined;
    this.crownSeen = 0;
    this.crownTweens = [];
    this.countPush = undefined;
    this.finalStretch = false;
    this.finishLead = false;
    this.realNow = 0;
    this.freezeLeft = 0;
    this.slowLeft = 0;
    this.slowFactor = 1;
    this.clockK = 1;
    this.rtK = 1;
    // The clocks outlive a restart, and a round can end mid-freeze.
    this.tweens.timeScale = 1;
    this.time.timeScale = 1;
    // ?realtime (automated runs on software GL, where one frame can take seconds): tweens keep
    // their own clock, which would crawl at 33 ms a frame once frames pass 500 ms; step them by
    // the same capped amount as the game logic instead, so every clock stays in step.
    if (REALTIME_CLOCK) this.tweens.setLagSmooth(120, 120);
  }

  create(): void {
    enterScene(this);
    audio.playMusic('minigame');
    audio.setMusicTempo(1);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => audio.setMusicTempo(1));
    if (REALTIME_CLOCK) this.holdTimersToRealtime();
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
   * The last ten seconds of a long timed round have begun (the music has already quickened). By
   * default a "FINAL 10 SECONDS!" call-out; override to add to it (see showFinalStretch).
   */
  protected onFinalStretch(): void {
    this.showFinalStretch();
  }
  /**
   * Screen height for mid-round call-outs ("FINAL 10 SECONDS!", "LAST 2!"): override to put them
   * where they hide the least play (over a crowd, below a stage).
   */
  protected bannerY(): number {
    return 390;
  }
  /**
   * Who wears the leader's crown on the HUD: by default the one player strictly ahead on
   * finalScores() (none on a tie, before anyone scores, or in team games).
   */
  protected leaderSlot(): number | null {
    if (this.info.teamGame || this.players.length < 2) return null;
    return uniqueLeader(this.finalScores());
  }

  /**
   * Freeze the game for a few frames (a hit landing, a pickup snapping in): the classic impact
   * freeze-frame. Game time, tweens and timers all hold, then carry on. Keep it short (40–140 ms).
   */
  hitStop(ms: number): void {
    this.freezeLeft = Math.max(this.freezeLeft, ms);
    // Take hold at once, so anything started this frame waits for the freeze too.
    this.applyClock(0);
  }

  /** Run the game at `factor` speed (0.2–0.6) for `ms` real milliseconds: decisive moments. */
  slowMo(factor: number, ms: number): void {
    this.slowFactor = Phaser.Math.Clamp(factor, 0.05, 1);
    this.slowLeft = Math.max(this.slowLeft, ms);
    if (this.freezeLeft <= 0) this.applyClock(this.slowFactor);
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
    this.applyClock(k);
    return k;
  }

  /**
   * ?realtime only (automated runs on software GL, where one frame can take seconds, the first
   * after create() longest of all): the timers take the loop's raw delta, so hold them to the
   * game logic's capped step before they advance each frame. Otherwise a whole countdown's delayed
   * calls could fire in a single frame.
   */
  private holdTimersToRealtime(): void {
    const cap = (_time: number, delta: number) => {
      const rk = delta > 0 ? Math.min(1, 120 / delta) : 1;
      if (rk === this.rtK) return;
      this.rtK = rk;
      this.time.timeScale = this.clockK * rk;
    };
    this.events.on(Phaser.Scenes.Events.PRE_UPDATE, cap);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.PRE_UPDATE, cap));
  }

  private applyClock(k: number): void {
    if (k === this.clockK) return;
    this.clockK = k;
    this.tweens.timeScale = k;
    this.time.timeScale = k * this.rtK;
    // Character flipbooks run on the global animation clock, so scale each one directly.
    for (const p of this.players) if (p.character) p.character.sprite.anims.timeScale = k;
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
   * portrait breaking the outer end, plus a round timer medallion with a draining arc. It is
   * pinned to the screen (camera kicks and scrolls don't shove it) and held steady through camera
   * zooms (see syncHud).
   */
  private buildHud(): void {
    const n = this.players.length;
    const hasTimer = this.duration > 0;
    const W = HUD_W;
    const H = HUD_H;
    const hud = this.add.container(0, 0).setDepth(9000);
    this.hudRoot = hud;
    this.callRoot = this.add.container(0, 0).setDepth(9500);
    // Capsule left edges: two pairs either side of the centre (clearing the timer when present).
    const gap = 34;
    const inner = hasTimer ? 96 : gap / 2;
    const lefts: number[] = [];
    const leftCount = Math.ceil(n / 2);
    for (let i = 0; i < leftCount; i++) lefts.push(GAME_WIDTH / 2 - inner - (leftCount - i) * W - (leftCount - 1 - i) * gap);
    for (let i = 0; i < n - leftCount; i++) lefts.push(GAME_WIDTH / 2 + inner + i * (W + gap));
    // Children sit in capsule coordinates (from its top-left corner), shifted so the capsule's
    // middle is the container origin.
    const ox = -W / 2;
    const oy = -H / 2;
    this.players.forEach((p, i) => {
      const flip = i >= leftCount;
      const x = lefts[i];
      const y = HUD_Y;
      const cx = x + W / 2;
      const cy = y + H / 2;
      const color = PLAYER_COLORS[p.slot];
      const wrap = this.add.container(cx, cy);
      const root = this.add.container(0, 0);
      wrap.add(root);
      const bg = this.add.graphics().setPosition(ox, oy);
      drawCapsule(bg, W, H, color);
      const glow = this.add.graphics().setPosition(ox, oy).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
      drawCapsuleGlow(glow, color);
      const lx = (v: number) => (flip ? W - v : v);
      const pr = 42;
      const portrait = addPortrait(this, p.characterId, p.slot, pr, { flip, worldX: x + lx(34), worldY: y + H / 2 });
      portrait.setPosition(ox + lx(34), 0);
      const align = flip ? 'right' : 'left';
      const name = addText(this, ox + lx(92), oy + 22, CHARACTERS[p.characterId].name.split(' ')[0].toUpperCase(), 19, { color: '#dfe5ee', weight: 700, align });
      const parts: Phaser.GameObjects.GameObject[] = [bg, glow, name];
      if (p.isCpu && !HIDE_CPU_TAGS) {
        const tw = 44;
        const tx = flip ? lx(92) - name.width - 8 - tw : lx(92) + name.width + 8;
        const tag = this.add.graphics().setPosition(ox, oy);
        tag.fillStyle(0xffffff, 0.14);
        tag.fillRoundedRect(tx, 11, tw, 22, 11);
        parts.push(tag, addText(this, ox + tx + tw / 2, oy + 22, 'CPU', 13, { color: '#dfe5ee', weight: 700 }));
      }
      const score = addText(this, ox + lx(92), oy + 52, '0', 40, { color: '#ffffff', weight: 700, align });
      root.add([...parts, score, portrait]);
      const tag: HudTag = { wrap, root, score, pipX: lx(92), flip, glow, glowColor: color, lastFlash: -1e9, mask: findMask(portrait), mz: 1, mb: 1, mx: cx, my: cy, cx, cy, pending: 0, holdUntil: 0 };
      if (this.hudPips(p)) {
        score.setVisible(false);
        tag.pips = this.add.graphics().setPosition(ox, oy);
        root.add(tag.pips);
      }
      hud.add(wrap);
      this.hudTags.set(p.slot, tag);
    });
    if (hasTimer) {
      const c = this.add.container(TIMER_X, TIMER_Y);
      const g = this.add.graphics();
      g.fillStyle(0x0a1120, 0.14);
      g.fillCircle(0, 4, 56);
      g.fillStyle(0x121b2b, 0.78);
      g.fillCircle(0, 0, 56);
      g.lineStyle(1.5, 0xffffff, 0.1);
      g.strokeCircle(0, 0, 55);
      // A coral halo that throbs with each of the last five seconds.
      const halo = this.add.graphics().setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
      halo.lineStyle(12, COLORS.coral, 0.9);
      halo.strokeCircle(0, 0, 62);
      halo.lineStyle(5, 0xffd2c8, 0.8);
      halo.strokeCircle(0, 0, 58);
      this.timerGlow = halo;
      this.timerArc = this.add.graphics();
      this.timerText = addText(this, 0, 2, String(Math.ceil(this.duration / 1000)), 48, { color: '#ffffff', weight: 700 });
      c.add([halo, g, this.timerArc, this.timerText]);
      hud.add(c);
      this.timerC = c;
      this.drawTimerArc(1);
    }
    this.pinTree(hud);
  }

  /** Pin an object (and everything inside it, masks included) to the screen. */
  private pinTree(o: Phaser.GameObjects.GameObject): void {
    const sf = o as unknown as { setScrollFactor?: (x: number, y?: number) => unknown };
    sf.setScrollFactor?.(0, 0);
    const masked = o as unknown as { mask?: { geometryMask?: Phaser.GameObjects.Graphics } | null };
    masked.mask?.geometryMask?.setScrollFactor(0, 0);
    if (o instanceof Phaser.GameObjects.Container) for (const child of o.list) this.pinTree(child);
  }

  /** Add a big call-out to the pinned call-out layer (above the HUD, steady through zooms). */
  private callAdd<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.callRoot?.add(o);
    this.pinTree(o);
    return o;
  }

  /**
   * Keep the pinned layers steady on screen whatever the camera's zoom (a countdown push-in, a
   * punch, the finish push towards the winner): scale them by 1/zoom about the camera's centre. The
   * portraits' masks are drawn in screen space, so each follows its capsule's bump and shake too.
   */
  private syncHud(): void {
    const cam = this.cameras.main;
    const z = cam.zoom || 1;
    const k = 1 / z;
    const ox = cam.width * cam.originX * (1 - k);
    const oy = cam.height * cam.originY * (1 - k);
    if (z !== this.hudZoom) {
      this.hudZoom = z;
      this.hudRoot?.setPosition(ox, oy).setScale(k);
      this.callRoot?.setPosition(ox, oy).setScale(k);
    }
    for (const tag of this.hudTags.values()) {
      const m = tag.mask;
      if (!m) continue;
      const b = tag.root.scaleX;
      const wx = tag.wrap.x;
      const wy = tag.wrap.y;
      if (b === tag.mb && z === tag.mz && wx === tag.mx && wy === tag.my) continue;
      tag.mb = b;
      tag.mz = z;
      tag.mx = wx;
      tag.my = wy;
      m.setPosition(ox + k * (wx - b * tag.cx), oy + k * (wy - b * tag.cy)).setScale(k * b);
    }
    this.steadyUi(z, k, ox, oy);
  }

  /**
   * A game's own screen-space UI (scroll factor 0 in the UI depth band, 8000 and up: gauges,
   * prompts, banners) gets the same treatment while the camera is zoomed, and its own transform
   * back once it isn't. Whatever else moves or scales one meanwhile (its own tweens, a per-frame
   * layout) is taken as its new resting place, so the two never fight. Pop-ups that already
   * allow for the zoom (juice.popToHud) are named 'juice:' and left alone.
   */
  private steadyUi(z: number, k: number, ox: number, oy: number): void {
    if (z === 1) {
      if (this.steady.size === 0) return;
      for (const [o, s] of this.steady) {
        if (!o.active) continue;
        if (o.x === s.wx) o.x = s.rx;
        if (o.y === s.wy) o.y = s.ry;
        if (o.scaleX === s.wsx) o.scaleX = s.rsx;
        if (o.scaleY === s.wsy) o.scaleY = s.rsy;
      }
      this.steady.clear();
      return;
    }
    for (const child of this.children.list) {
      const o = child as UiObject;
      if (o.scrollFactorX !== 0 || (o.depth ?? 0) < 8000 || o === this.hudRoot || o === this.callRoot || o.name.startsWith('juice:')) continue;
      let s = this.steady.get(o);
      if (!s) {
        s = { rx: o.x, ry: o.y, rsx: o.scaleX, rsy: o.scaleY, wx: NaN, wy: NaN, wsx: NaN, wsy: NaN };
        this.steady.set(o, s);
      } else {
        if (o.x !== s.wx) s.rx = o.x;
        if (o.y !== s.wy) s.ry = o.y;
        if (o.scaleX !== s.wsx) s.rsx = o.scaleX;
        if (o.scaleY !== s.wsy) s.rsy = o.scaleY;
      }
      s.wx = ox + k * s.rx;
      s.wy = oy + k * s.ry;
      s.wsx = k * s.rsx;
      s.wsy = k * s.rsy;
      o.x = s.wx;
      o.y = s.wy;
      o.scaleX = s.wsx;
      o.scaleY = s.wsy;
    }
  }

  /** Screen point of a player's HUD score (the middle of the number or hearts): where score pop-ups (juice.popToHud) should land. */
  hudPoint(slot: number): { x: number; y: number } {
    const tag = this.hudTags.get(slot);
    if (!tag) return { x: GAME_WIDTH / 2, y: 60 };
    const left = tag.cx - HUD_W / 2;
    const top = tag.cy - HUD_H / 2;
    const dir = tag.flip ? -1 : 1;
    if (tag.pips) {
      const p = this.players.find((q) => q.slot === slot);
      const total = (p && this.hudPips(p)?.total) || 3;
      return { x: left + tag.pipX + dir * (18 + 22 * (total - 1)), y: top + 53 };
    }
    return { x: left + tag.pipX + dir * Math.max(22, tag.score.width / 2), y: top + 52 };
  }

  /** Bump a player's HUD capsule (a pop-up landing on it): a springy pulse and a flash in their colour. */
  bumpHud(slot: number): void {
    const tag = this.hudTags.get(slot);
    if (!tag) return;
    this.bumpCapsule(tag, 1.08);
    this.flashCapsule(tag, PLAYER_COLORS[slot], 0.42);
  }

  /**
   * A score pop-up worth `amount` is on its way to a player's capsule: their HUD number leaves it
   * out until releaseHud(slot, amount) is called as it lands (popToHud's onArrive), so the number
   * ticks up right then. Only plain-number labels are held; holds lapse on their own after two
   * seconds, and at the finish.
   */
  holdHud(slot: number, amount = 1): void {
    const tag = this.hudTags.get(slot);
    if (!tag) return;
    tag.pending += amount;
    tag.holdUntil = this.realNow + 2000;
  }

  releaseHud(slot: number, amount = 1): void {
    const tag = this.hudTags.get(slot);
    if (tag) tag.pending = Math.max(0, tag.pending - amount);
  }

  private bumpCapsule(tag: HudTag, amount: number): void {
    tag.bump?.stop();
    tag.root.setScale(1);
    tag.bump = this.tweens.add({ targets: tag.root, scale: { from: amount, to: 1 }, duration: 240, ease: 'Back.Out' });
  }

  private flashCapsule(tag: HudTag, color: number, alpha: number): void {
    tag.lastFlash = this.realNow;
    if (color !== tag.glowColor) {
      tag.glowColor = color;
      drawCapsuleGlow(tag.glow, color);
    }
    // A quick, bright ping (the rim does the work) rather than a slow tinted wash, which any
    // single frame would catch looking like a see-through fill.
    tag.glowTw?.stop();
    tag.glow.setAlpha(Math.min(1, alpha * 2.2));
    tag.glowTw = this.tweens.add({ targets: tag.glow, alpha: 0, duration: 230, ease: 'Cubic.Out' });
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
    g.clear();
    g.lineStyle(6, 0xffffff, 0.14);
    g.strokeCircle(0, 0, 45);
    if (frac <= 0) return;
    const left = frac * this.duration;
    const color = left <= 5000 ? COLORS.coral : this.finalStretch && left <= FINAL_STRETCH_AT ? COLORS.goldLight : 0xffffff;
    g.lineStyle(6, color, 1);
    g.beginPath();
    g.arc(0, 0, 47, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
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
          if (lost) {
            this.bumpCapsule(tag, 1.1);
            this.flashCapsule(tag, COLORS.coral, 0.5);
          }
        }
      }
      if (tag.pending > 0 && this.realNow > tag.holdUntil) tag.pending = 0;
      let label = this.hudLabel(p);
      if (tag.pending > 0 && /^\d+$/.test(label)) label = String(Math.max(0, Number(label) - tag.pending));
      if (tag.score.text !== label) {
        const gain = isScoreGain(tag.score.text, label);
        tag.score.setText(label);
        this.tweens.add({ targets: tag.score, scale: { from: 1.3, to: 1 }, duration: 180 });
        // A score going up bumps the capsule and flashes it in the player's colour (not too often:
        // some labels climb fast).
        if (gain && this.realNow - tag.lastFlash > 280) {
          this.bumpCapsule(tag, 1.06);
          this.flashCapsule(tag, PLAYER_COLORS[p.slot], 0.38);
        }
      }
      tag.root.setAlpha(p.alive ? 1 : 0.55);
      // Out without going through eliminate() (a game marking it directly): stamp it anyway.
      if (!p.alive && !tag.stamp) this.stampOut(p.slot);
    }
    if (this.timerText) {
      const leftMs = Math.max(0, this.duration - this.elapsed);
      this.drawTimerArc(leftMs / this.duration);
      const left = Math.ceil(leftMs / 1000);
      if (this.timerText.text !== String(left)) {
        this.timerText.setText(String(left));
        if (this.phase === 'playing') this.timerBeat(left);
      }
    }
  }

  /** Each second of the final stretch: a tick and a pulse; the last five get a beep and a big numeral. */
  private timerBeat(left: number): void {
    if (left <= 0) return;
    if (left <= 5) {
      this.timerText?.setColor('#ff8a7a');
      audio.play('countdown', { volume: 0.5 });
      this.pulseTimer(1.16);
      this.showBigNumber(left);
      if (this.timerGlow) {
        this.tweens.killTweensOf(this.timerGlow);
        this.timerGlow.setAlpha(0.9);
        this.tweens.add({ targets: this.timerGlow, alpha: 0, duration: 700, ease: 'Quad.In' });
      }
    } else if (left <= FINAL_STRETCH_AT / 1000 && this.finalStretch) {
      this.timerText?.setColor(CSS.goldLight);
      audio.play('tick', { volume: 0.3, rate: left % 2 ? 1 : 0.84 });
      this.pulseTimer(1.08);
    }
  }

  private pulseTimer(amount: number): void {
    const c = this.timerC;
    if (!c) return;
    this.tweens.killTweensOf(c);
    c.setScale(1);
    this.tweens.add({ targets: c, scale: { from: amount, to: 1 }, duration: 260, ease: 'Back.Out' });
  }

  /** The last five seconds: a big, faint numeral in the middle of the screen (it fades within the second). */
  private showBigNumber(n: number): void {
    let t = this.bigNum;
    if (!t) {
      t = this.callAdd(addTitle(this, GAME_WIDTH / 2, 560, '', 300, '#ffffff'));
      this.bigNum = t;
    }
    this.tweens.killTweensOf(t);
    t.setText(String(n)).setScale(1.35).setAlpha(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.Out' });
    this.tweens.add({ targets: t, alpha: 0, delay: 240, duration: 620, ease: 'Quad.In' });
  }

  /** The "FINAL 10 SECONDS!" call-out, with an optional second line (e.g. "CHIP STORM!"). */
  protected showFinalStretch(sub?: string): void {
    banner(this, 'FINAL 10 SECONDS!', { y: this.bannerY(), size: 92, color: CSS.goldLight, hold: 1150, ribbon: true, sub });
    audio.play('finalCall', { volume: 0.8 });
    this.pulseTimer(1.25);
  }

  // --- The leader's crown -----------------------------------------------------------------------
  private updateCrown(real: number): void {
    this.crownT -= real;
    if (this.crownT > 0) return;
    this.crownT = 150;
    let slot: number | null = null;
    try {
      slot = this.leaderSlot();
    } catch {
      slot = null;
    }
    if (slot === this.crownSlot) {
      this.crownNext = undefined;
      return;
    }
    if (slot !== this.crownNext) {
      this.crownNext = slot;
      this.crownSeen = this.realNow;
      return;
    }
    // A new leader has to hold the lead for a moment, so a neck-and-neck race doesn't send the
    // crown flickering back and forth; and the score pop-up that decided it lands first (never
    // waiting long), so the crown moves just as the numbers on the HUD change.
    const age = this.realNow - this.crownSeen;
    if (age < 300) return;
    if (age < 900) for (const [s, tag] of this.hudTags) if (tag.pending > 0 && (slot === null || s === slot)) return;
    this.crownNext = undefined;
    this.moveCrown(slot);
  }

  /** Where the crown sits on a capsule: tipped on the portrait's outer shoulder (clear of the player badge). */
  private crownPoint(slot: number): { x: number; y: number; angle: number } | null {
    const tag = this.hudTags.get(slot);
    if (!tag) return null;
    const px = tag.flip ? tag.cx + HUD_W / 2 - 34 : tag.cx - HUD_W / 2 + 34;
    return { x: px + (tag.flip ? 30 : -30), y: tag.cy - 36, angle: tag.flip ? 24 : -24 };
  }

  private makeCrown(): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    const pts = [
      { x: -21, y: 8 },
      { x: -25, y: -13 },
      { x: -11, y: -2 },
      { x: 0, y: -18 },
      { x: 11, y: -2 },
      { x: 25, y: -13 },
      { x: 21, y: 8 },
    ];
    g.fillStyle(0x0a1120, 0.35);
    g.fillPoints(
      pts.map((p) => ({ x: p.x + 2, y: p.y + 4 })),
      true,
    );
    g.fillStyle(COLORS.gold, 1);
    g.fillPoints(pts, true);
    g.fillStyle(COLORS.goldLight, 1);
    g.fillTriangle(-19, 5, -22, -9, -11, 1);
    g.fillStyle(COLORS.goldDark, 1);
    g.fillRect(-21, 2, 42, 6);
    g.lineStyle(3, 0x7a4600, 1);
    g.strokePoints(pts, true, true);
    g.fillStyle(0xffffff, 1);
    for (const [x, y] of [
      [-25, -13],
      [0, -18],
      [25, -13],
    ])
      g.fillCircle(x, y, 3.8);
    g.fillStyle(COLORS.coral, 1);
    g.fillCircle(0, 5, 3.4);
    const c = this.add.container(0, 0, [g]).setScale(0);
    this.hudRoot?.add(c);
    this.pinTree(c);
    return c;
  }

  /** Crown the new leader: it pops on, hops across between capsules, or bows out on a tie. */
  private moveCrown(slot: number | null): void {
    const prev = this.crownSlot;
    this.crownSlot = slot;
    for (const t of this.crownTweens) t.stop();
    this.crownTweens = [];
    const crown = this.crown;
    if (slot === null) {
      if (crown) this.crownTweens.push(this.tweens.add({ targets: crown, scale: 0, duration: 180, ease: 'Quad.In' }));
      return;
    }
    const to = this.crownPoint(slot);
    if (!to) return;
    const c = crown ?? (this.crown = this.makeCrown());
    const land = () => {
      c.setPosition(to.x, to.y).setAngle(to.angle);
      audio.play('crown', { volume: 0.5 });
      if (this.hudRoot) shockwave(this, to.x, to.y, { radius: 44, color: COLORS.goldLight, duration: 320, screen: true, into: this.hudRoot });
      this.crownTweens.push(this.tweens.add({ targets: c, scale: { from: 1.3, to: 1 }, duration: 220, ease: 'Back.Out' }));
    };
    if (prev === null || c.scale < 0.3) {
      c.setPosition(to.x, to.y).setAngle(to.angle).setScale(0);
      this.crownTweens.push(this.tweens.add({ targets: c, scale: 1, duration: 200, ease: 'Quad.Out', onComplete: land }));
      return;
    }
    if (prev === slot) {
      // Already theirs (the finish): a victory pop and wiggle where it sits (never a spin, which
      // any single frame could catch lying on its side).
      c.setPosition(to.x, to.y).setAngle(to.angle);
      this.crownTweens.push(this.tweens.add({ targets: c, angle: { from: to.angle + (to.x > GAME_WIDTH / 2 ? 18 : -18), to: to.angle }, duration: 520, ease: 'Elastic.Out' }));
      this.crownTweens.push(this.tweens.add({ targets: c, scale: { from: 1.6, to: 1 }, duration: 520, ease: 'Back.Out', onComplete: land }));
      return;
    }
    // Hop across to the new leader: a dipping arc that swells at its height and settles into the
    // new tilt (growing back to full size if it was caught halfway through bowing out). No spin,
    // so it always reads as a crown.
    const fx = c.x;
    const fy = c.y;
    const fa = c.angle;
    const fs = c.scale;
    const k = { u: 0 };
    this.crownTweens.push(
      this.tweens.add({
        targets: k,
        u: 1,
        duration: 480,
        ease: 'Sine.InOut',
        onUpdate: () => {
          const u = k.u;
          c.setPosition(fx + (to.x - fx) * u, fy + (to.y - fy) * u + Math.sin(u * Math.PI) * 46);
          c.setAngle(fa + (to.angle - fa) * u).setScale((fs + (1 - fs) * u) * (1 + 0.28 * Math.sin(u * Math.PI)));
        },
        onComplete: land,
      }),
    );
  }

  // --- Flow -------------------------------------------------------------------------------------
  /**
   * "Get ready": 3, 2, 1 slam in on drum hits with ring shockwaves while the camera eases in, the
   * players bouncing on the beat; GO! bursts out as the camera springs back.
   */
  private startCountdown(): void {
    if (cameraMotionOk()) this.countPush = this.tweens.add({ targets: this.cameras.main, zoom: COUNT_PUSH, delay: COUNT_START, duration: COUNT_STEP * 3, ease: 'Sine.InOut' });
    ['3', '2', '1'].forEach((s, i) => this.time.delayedCall(COUNT_START + i * COUNT_STEP, () => this.countBeat(s, i)));
    this.time.delayedCall(COUNT_START + 3 * COUNT_STEP, () => this.countGo());
  }

  private countBeat(s: string, i: number): void {
    const t = this.callAdd(addTitle(this, GAME_WIDTH / 2, CALL_Y, s, 200, CSS.cream));
    t.setScale(2.3).setAlpha(0);
    this.tweens.add({
      targets: t,
      scale: 1,
      alpha: 1,
      duration: 160,
      ease: 'Cubic.In',
      onComplete: () => {
        // Impact: the numeral squashes, a ring rolls out, a drum hits, everyone bounces.
        this.tweens.add({ targets: t, scaleX: { from: 1.16, to: 1 }, scaleY: { from: 0.86, to: 1 }, duration: 160, ease: 'Back.Out' });
        if (this.callRoot) shockwave(this, GAME_WIDTH / 2, CALL_Y, { radius: 240 + i * 40, color: COLORS.cream, alpha: 0.7, duration: 420, screen: true, into: this.callRoot });
        audio.play('countHit', { rate: 1 + i * 0.07 });
        audio.play('countdown', { volume: 0.45 });
        this.readyBounce(0.08);
        this.tweens.add({ targets: t, alpha: 0, scale: 0.7, delay: 330, duration: 150, ease: 'Quad.In', onComplete: () => t.destroy() });
      },
    });
  }

  private countGo(): void {
    const rays = this.callAdd(this.add.image(GAME_WIDTH / 2, CALL_Y, 'fx-rays'));
    rays.setTint(COLORS.goldLight).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(0.9);
    const t = this.callAdd(addTitle(this, GAME_WIDTH / 2, CALL_Y, 'GO!', 250, CSS.goldLight));
    t.setScale(2.2).setAlpha(0);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 140, ease: 'Cubic.In', onComplete: () => this.goBurst(t, rays) });
  }

  private goBurst(t: Phaser.GameObjects.Text, rays: Phaser.GameObjects.Image): void {
    this.phase = 'playing';
    this.onStart();
    audio.play('go');
    audio.play('crowdRoar', { volume: 0.9 });
    audio.play('countHit', { rate: 0.8, volume: 0.9 });
    input.rumbleAll(0.4, 0.6, 180);
    // A quick punch in on GO!, then the camera springs back out of the push-in to rest (no
    // overshoot: it never shows past the arena's edges).
    this.countPush?.stop();
    const cam = this.cameras.main;
    if (cameraMotionOk()) {
      this.tweens.chain({
        targets: cam,
        tweens: [
          { zoom: cam.zoom * 1.025, duration: 70, ease: 'Quad.Out' },
          { zoom: 1, duration: 320, ease: 'Cubic.Out' },
        ],
      });
    } else cam.setZoom(1);
    if (this.callRoot) {
      shockwave(this, GAME_WIDTH / 2, CALL_Y, { radius: 520, color: COLORS.goldLight, alpha: 0.85, duration: 520, screen: true, into: this.callRoot });
      this.time.delayedCall(70, () => this.callRoot && shockwave(this, GAME_WIDTH / 2, CALL_Y, { radius: 420, from: 0.5, color: 0xffffff, alpha: 0.45, duration: 380, screen: true, into: this.callRoot }));
    }
    this.fx.sparks(GAME_WIDTH / 2 + cam.scrollX, CALL_Y + cam.scrollY, LITE ? 22 : 40);
    flashScreen(this, 0xfff4dc, 0.18, 220);
    this.readyBounce(0.12);
    this.tweens.add({ targets: rays, alpha: { from: 0.55, to: 0 }, scale: 2.3, angle: 35, duration: 720, ease: 'Cubic.Out', onComplete: () => rays.destroy() });
    this.tweens.add({ targets: t, scaleX: { from: 1.18, to: 1 }, scaleY: { from: 0.84, to: 1 }, duration: 180, ease: 'Back.Out' });
    this.tweens.add({ targets: t, alpha: 0, scale: 1.25, y: CALL_Y - 30, delay: 440, duration: 240, ease: 'Quad.In', onComplete: () => t.destroy() });
  }

  /** A little squash on the beat for everyone standing ready (idle only: never over a game's own pose). */
  private readyBounce(amount: number): void {
    for (const p of this.players) {
      const c = p.character;
      if (c && c.active && c.visible && c.current === 'idle') c.squash(amount, 180);
    }
  }

  /** Called each frame of a timed round: the final stretch, then slow motion into the buzzer. */
  private timedBeats(): void {
    const left = this.duration - this.elapsed;
    if (!this.finalStretch && hasFinalStretch(this.duration) && left <= FINAL_STRETCH_AT && left > 0) {
      this.finalStretch = true;
      audio.setMusicTempo(FINAL_TEMPO);
      this.onFinalStretch();
    }
    if (!this.finishLead && left <= FINISH_LEAD && left > 0) {
      this.finishLead = true;
      this.slowMo(FINISH_SLOW, FINISH_LEAD / FINISH_SLOW);
    }
  }

  /**
   * Knock a player out (elimination games end when one remains). `blow` is the direction the hit
   * travelled, for the camera kick (default: outwards from the middle of the view, towards them).
   */
  protected eliminate(p: MgPlayer, blow?: { x: number; y: number }): void {
    if (!p.alive) return;
    p.alive = false;
    p.doneAt = this.elapsed;
    this.eliminated.push(p.slot);
    audio.play('defeat', { volume: 0.6 });
    if (!p.isCpu) input.rumbleSlot(p.slot, 0.7, 0.5, 260);
    const alive = this.alivePlayers.length;
    const last = (alive <= 1 && this.players.length > 1) || alive === 0;
    this.knockout(p, last, blow);
    if (last) this.time.delayedCall(KO_END_DELAY, () => this.end());
    else if (alive === 2 && this.players.length >= 3) {
      this.time.delayedCall(420, () => {
        if (this.phase !== 'playing' || this.alivePlayers.length !== 2) return;
        banner(this, 'LAST 2!', { y: this.bannerY(), size: 116, color: '#ff9d8f', hold: 900, ribbon: true });
        audio.play('finalCall', { volume: 0.6 });
      });
    }
  }

  /** The knock-out beat: a freeze-frame, a camera kick, OUT! stamped on their capsule (and slow motion if it decides the round). */
  private knockout(p: MgPlayer, last: boolean, blow?: { x: number; y: number }): void {
    this.hitStop(last ? KO_STOP_LAST : KO_STOP);
    let kx = blow?.x ?? 0;
    let ky = blow?.y ?? 0;
    const c = p.character;
    if (!blow && c) {
      const cam = this.cameras.main;
      kx = c.x - (cam.scrollX + cam.width / 2);
      ky = c.y - (cam.scrollY + cam.height / 2);
    }
    const len = Math.hypot(kx, ky);
    if (len > 1) kick(this, (kx / len) * 14, (ky / len) * 14, 170);
    if (last) this.slowMo(KO_SLOW, KO_SLOW_MS);
    this.stampOut(p.slot);
  }

  /** "OUT!" stamped across a knocked-out player's capsule, which shudders under it. */
  private stampOut(slot: number): void {
    const tag = this.hudTags.get(slot);
    if (!tag || tag.stamp) return;
    const s = this.add.container(tag.flip ? -22 : 22, 2);
    const g = this.add.graphics();
    const w = 132;
    const h = 54;
    g.fillStyle(0x0a1120, 0.35);
    g.fillRoundedRect(-w / 2 + 3, -h / 2 + 5, w, h, 12);
    g.fillStyle(COLORS.coral, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    g.lineStyle(4, 0xffffff, 1);
    g.strokeRoundedRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 8);
    const t = addText(this, 0, 1, 'OUT!', 34, { color: '#ffffff', weight: 700, fixed: true });
    s.add([g, t]);
    s.setAngle(tag.flip ? 8 : -8).setScale(2.6).setAlpha(0);
    tag.wrap.add(s);
    this.pinTree(s);
    tag.stamp = s;
    this.tweens.add({
      targets: s,
      scale: 1,
      alpha: 1,
      duration: 150,
      ease: 'Cubic.In',
      onComplete: () => {
        audio.play('stamp', { volume: 0.55 });
        shockwave(this, s.x, s.y, { radius: 120, ratio: 0.6, color: COLORS.coral, alpha: 0.8, duration: 320, screen: true, into: tag.wrap });
        if (!cameraMotionOk()) return;
        const k = { v: 1 };
        this.tweens.add({
          targets: k,
          v: 0,
          duration: 320,
          onUpdate: () => tag.wrap.setX(tag.cx + Math.sin(k.v * 26) * 9 * k.v),
          onComplete: () => tag.wrap.setX(tag.cx),
        });
      },
    });
  }

  /** End the round: freeze the final frame, slam FINISH!, celebrate the winner, then the results podium. */
  protected end(): void {
    if (this.ending) return;
    this.ending = true;
    this.phase = 'finished';
    for (const p of this.players) p.vc?.releaseAll();
    const scores = this.finalScores();
    const result: MinigameResult = {
      id: this.info.id,
      placements: placementsFromScores(scores),
      scores,
    };
    audio.setMusicTempo(1);
    for (const tag of this.hudTags.values()) tag.pending = 0;
    if (this.bigNum) {
      this.tweens.killTweensOf(this.bigNum);
      this.bigNum.setAlpha(0);
    }
    // Hold the final frame for a beat; both delays run on the game clock, so they wait it out.
    this.slowLeft = 0;
    this.hitStop(FINISH_FREEZE);
    this.time.delayedCall(1, () => this.finishSlam(result));
    this.time.delayedCall(1700, () => goTo(this, 'Results', { result, launch: this.launch }));
  }

  private finishSlam(result: MinigameResult): void {
    audio.play('finish');
    audio.play('stamp', { volume: 0.6 });
    audio.play('crowdCheer', { volume: 0.85 });
    input.rumbleAll(0.3, 0.5, 200);
    const winners = result.placements.filter((pl) => pl.place === 1).map((pl) => pl.slot);
    const everyone = winners.length >= this.players.length;
    const stars: Character[] = [];
    for (const p of this.players) {
      const c = p.character;
      const won = !everyone && winners.includes(p.slot);
      const shown = !!c && c.active && c.visible && c.alpha > 0.2;
      if (c && shown && NEUTRAL.includes(c.current)) {
        if (won) c.play(winners.length === 1 ? 'victory' : 'celebrate', { force: true, returnTo: 'celebrate' });
        else c.play(everyone ? 'celebrate' : 'disappointed', { force: true });
      }
      if (!won) continue;
      if (c && shown) stars.push(c);
      this.winnerConfetti(p, shown ? c : undefined, winners.length);
    }
    this.moveCrown(winners.length === 1 && !everyone && !this.info.teamGame ? winners[0] : null);
    const cam = this.cameras.main;
    const n = stars.length;
    const at = n ? { x: stars.reduce((a, c) => a + c.x, 0) / n, y: stars.reduce((a, c) => a + c.y - 110 * Math.abs(c.scaleY), 0) / n } : { x: cam.scrollX + cam.width / 2, y: cam.scrollY + cam.height / 2 };
    const push = this.pushIn(at.x, at.y);
    const t = this.callAdd(addTitle(this, GAME_WIDTH / 2, CALL_Y, 'FINISH!', 190, CSS.goldLight));
    t.setScale(2.4).setAlpha(0);
    this.tweens.add({
      targets: t,
      scale: 1,
      alpha: 1,
      duration: 160,
      ease: 'Cubic.In',
      onComplete: () => {
        this.tweens.add({ targets: t, scaleX: { from: 1.14, to: 1 }, scaleY: { from: 0.88, to: 1 }, duration: 200, ease: 'Back.Out' });
        if (this.callRoot) shockwave(this, GAME_WIDTH / 2, CALL_Y, { radius: 520, from: 0.5, color: COLORS.goldLight, alpha: 0.8, duration: 520, screen: true, into: this.callRoot });
        flashScreen(this, 0xffffff, 0.14, 200);
        // Then it steps aside (above or below the winners, wherever they aren't) for the celebration.
        this.tweens.add({ targets: t, y: this.clearOf(stars, push), scale: 0.6, delay: 520, duration: 380, ease: 'Cubic.InOut' });
      },
    });
  }

  /** A screen height for the shrunken FINISH! that doesn't cover any of the winners once the camera has pushed in. */
  private clearOf(stars: Character[], push: { z: number; sx: number; sy: number }): number {
    const cam = this.cameras.main;
    const oy = cam.height * cam.originY;
    const toScreen = (y: number) => oy + push.z * (y - push.sy - oy);
    const spans = stars.map((c) => ({ top: toScreen(c.y + c.headY * Math.abs(c.scaleY)) - 30, feet: toScreen(c.y) + 10 }));
    const clash = (y: number) => spans.some((s) => s.top < y + 62 && s.feet > y - 62);
    return !clash(250) ? 250 : !clash(900) ? 900 : 250;
  }

  /** Confetti in the winner's colours over their head (or from their HUD capsule if they're off stage). */
  private winnerConfetti(p: MgPlayer, c: Character | undefined, shared: number): void {
    const base = PLAYER_COLORS[p.slot];
    const colors = [base, base, mix(base, 0xffffff, 0.5), PLAYER_COLORS_DARK[p.slot], 0xffffff, COLORS.goldLight];
    const cam = this.cameras.main;
    const tag = this.hudTags.get(p.slot);
    const x = c ? c.x : (tag?.cx ?? GAME_WIDTH / 2) + cam.scrollX;
    const y = c ? c.y - 170 * Math.abs(c.scaleY) : (tag?.cy ?? 60) + 60 + cam.scrollY;
    confettiBurst(this, x, y, colors, shared > 1 ? 45 : 80);
  }

  /**
   * The finish shot: the camera pushes in towards the winner (kept within what was already on
   * screen). Returns where the camera ends up (zoom and scroll).
   */
  private pushIn(x: number, y: number): { z: number; sx: number; sy: number } {
    const cam = this.cameras.main;
    this.countPush?.stop();
    if (!cameraMotionOk()) return { z: cam.zoom, sx: cam.scrollX, sy: cam.scrollY };
    settleCamera(cam);
    const z = FINISH_ZOOM;
    const mx = (cam.width - cam.width / z) / 2;
    const my = (cam.height - cam.height / z) / 2;
    const sx = cam.scrollX + Phaser.Math.Clamp((x - (cam.scrollX + cam.width / 2)) * 0.7, -mx, mx);
    const sy = cam.scrollY + Phaser.Math.Clamp((y - (cam.scrollY + cam.height / 2)) * 0.7, -my, my);
    this.tweens.add({ targets: cam, zoom: z, scrollX: sx, scrollY: sy, duration: 700, ease: 'Cubic.Out' });
    return { z, sx, sy };
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
    this.realNow += real;
    const dt = real * this.clockScale(real);
    for (const p of this.players) p.vc?.step();
    this.ambient(dt);
    if (this.phase !== 'playing') {
      this.refreshHud();
      this.syncHud();
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
    if (this.phase === 'playing' && this.duration > 0) {
      this.timedBeats();
      if (this.elapsed >= this.duration) this.end();
    }
    if (this.phase === 'playing') this.updateCrown(real);
    this.refreshHud();
    this.syncHud();
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
