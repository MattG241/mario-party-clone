import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { animHeadTop, Character } from '../../characters/Character';
import type { AnimName } from '../../characters/CharacterAnimations';
import { COLORS, CSS, GAME_WIDTH, PLAYER_COLORS } from '../../constants';
import type { CharacterId } from '../../data/characters';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../data/npcs';
import type { VirtualControls } from '../../input/PlayerInput';
import { keyLabel } from '../../input/buttons';
import { settings } from '../../save/SettingsManager';
import { glyphKindFor, makeGlyph } from '../../ui/ControllerPrompt';
import { PlayerBadge } from '../../ui/PlayerBadge';
import { addText, addTitle } from '../../ui/theme';
import { Random } from '../../util/Random';
import { standOrigin } from '../../util/spriteUtil';
import { BaseMinigame, type MgPlayer } from '../BaseMinigame';
import { buzzerWinner, teamFinalScores, teamOf, type Team } from './TotemTugRules';
import { HERO_DATA } from '../../data/heroSprites.generated';

// --- Layout (side view). A pre-rendered `rendered-scene-totem` must match these numbers. ---------
/** Feet line of the pullers = ground line of the festival clearing. */
const GROUND_Y = 820;
/** Nominal rope height: the rope runs through the pullers' hands, roughly this high. */
const ROPE_Y = 740;
/** Rope ends at the start of the round; the whole rope slides with the totem. */
const ROPE_X0 = 260;
const ROPE_X1 = 1660;
const CENTER_X = 960;
/** Win lines at CENTER_X ± WIN_DIST: drag the totem across your line to win on the spot. */
const WIN_DIST = 420;
/** Where pullers stand, measured from the totem along the rope. */
const SPOT_INNER = 200;
const SPOT_OUTER = 350;
const SPOT_SOLO = 270;
/** Depth stagger so team-mates don't paste flat over each other (inner puller is nearer). */
const INNER_DY = 10;
const OUTER_DY = -8;
const SOLO_DY = 4;
const CHAR_SCALE = 1;
/** Totem marker height on screen; its bottom-centre sits on the rope. */
const TOTEM_H = 230;
/** Spiral head of the totem (the beat ring's centre), as a fraction of its height. */
const TOTEM_HEAD = 0.79;
/** Team flag poles (fallback art): x of each pole, top of the pole. */
const FLAG_X = [74, 1846] as const;
const FLAG_TOP = 318;
/** Tension meter under the round timer. */
const METER_Y = 170;
const METER_W = 620;
/** Top-corner team plaques (centre x, top y). */
const PLAQUE_X = [146, 1774] as const;
const PLAQUE_Y = 16;
/** Human LT/RT prompt row under the feet. */
const PROMPT_DY = 104;

// --- Rhythm -----------------------------------------------------------------------------------
const BEAT_MS = 600;
/** ± ms around a beat that still counts as a power pull. */
const BEAT_WINDOW = 95;
const POWER_MULT = 2.4;
/** The lone puller of a 3-player game pulls twice as hard. */
const SOLO_STRENGTH = 2;
/** Team-mates landing power pulls on the same beat: the second one counts this much more. */
const SYNC_MULT = 1.5;
/** Minimum gap between "SYNC!" callouts for an all-CPU team. */
const SYNC_CALLOUT_MS = 3000;
/** A lone puller can't sync, so their power pulls get this instead (keeps 1 v 2 even). */
const SOLO_POWER_BONUS = 1.18;
/** Small random variation in grip per pull (±). */
const GRIP_JITTER = 0.15;
/** Within DIG_RANGE px of your own losing line your team digs in and pulls up to DIG_IN harder. */
const DIG_IN = 0.4;
const DIG_RANGE = 180;
/** HUD pull-power points for one full-strength pull. */
const PULL_POINTS = 10;
/** Pulls in quick succession are weak: strength recovers over this window (ms). */
const RECOVER_MIN = 60;
const RECOVER_MS = 380;
const RECOVER_FLOOR = 0.2;

// --- Rope physics -----------------------------------------------------------------------------
/** Rope velocity (px/s) added per unit of pull. */
const KICK = 24;
/** Velocity decay (1/s): the rope's inertia. */
const ROPE_DAMP = 1.6;
const MAX_ROPE_V = 240;
/** Decay time (s) of the per-team pull force shown on the tension meter. */
const FORCE_TAU = 0.5;
/** Totem this close to dead centre at the buzzer counts as level (pull power decides). */
const DRAW_EPS = 2;

/** Team colours match the win-line banners of the rendered clearing (cyan left, coral right). */
const TEAM_COLORS = [0x22c3d6, 0xff6b5e] as const;
const TEAM_DARK = [0x0b5561, 0x8a2a24] as const;
const TEAM_CSS = ['#8becf7', '#ffa39a'] as const;
const TEAM_NAMES = ['TIDE', 'EMBER'] as const;
/**
 * Origin of `rendered-mg-totem` (bottom-centre = the point that sits on the rope). The anchor in
 * `rendered-mg-sprites` (assets/rendered/mg/sprites.json, key "totem") wins when that file is loaded.
 */
const TOTEM_ORIGIN = { x: 0.5, y: 1 } as const;

type Trigger = 'LT' | 'RT';

interface PullPose {
  anim: AnimName;
  frame: number;
  /** Where the hands grip the rope (local px from the feet, facing right). */
  hand: [number, number];
}

/** The braced pulling pose: the rendered 3D 'pull' pose when available, else a 2D sheet frame. */
function pullPose(id: CharacterId): PullPose {
  const grip = HERO_DATA.points[id]?.pull;
  return grip ? { anim: 'pull', frame: 0, hand: grip } : PULL_POSE[id];
}

/** Braced pulling pose per character (2D sheets). */
const PULL_POSE: Record<CharacterId, PullPose> = {
  kip: { anim: 'crouch', frame: 0, hand: [20, -60] },
  mossi: { anim: 'surprised', frame: 2, hand: [34, -94] },
  tumble: { anim: 'jump', frame: 0, hand: [14, -74] },
  zippa: { anim: 'surprised', frame: 0, hand: [56, -104] },
};

interface Puller {
  p: MgPlayer;
  c: Character;
  pose: PullPose;
  team: 0 | 1;
  /** -1 hauls towards the left, +1 towards the right. */
  dir: -1 | 1;
  spot: number;
  dy: number;
  strength: number;
  last: Trigger | null;
  lastPullAt: number;
  beatUsed: number;
  power: number;
  pulls: number;
  powerPulls: number;
  /** Consecutive power pulls (feedback only). */
  streak: number;
  /** Badge height over the pulling pose (local px). */
  badgeY: number;
  // visuals
  x: number;
  kick: number;
  pulse: number;
  lean: number;
  dustT: number;
  hintT: number;
  hint: Phaser.GameObjects.Container;
  prompt: { root: Phaser.GameObjects.Container; lt: Phaser.GameObjects.Container; rt: Phaser.GameObjects.Container } | null;
  // CPU rhythm
  cpuNext: number;
  cpuHeld: boolean;
  cpuBias: number;
  cpuBurst: number;
}

interface Pt {
  x: number;
  y: number;
}

/** Roughly normal noise with unit spread. */
function gauss(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 2;
}

/**
 * Totem Tug — two teams haul on a rope with a spiral totem tied to its middle. Alternate LT and
 * RT to pull; pulls landing on the drum beat are power pulls, frantic same-trigger mashing does
 * nothing. Drag the totem over your win line, or have it on your side at the buzzer.
 */
export class TotemTugScene extends BaseMinigame {
  private pullers: Puller[] = [];
  private offset = 0;
  private ropeV = 0;
  private prevRopeV = 0;
  private teamForce: [number, number] = [0, 0];
  private beatClock = 0;
  private beatIdx = 0;
  private beatFlash = 0;
  private winner: 0 | 1 | null | undefined = undefined;
  private celebrated = false;
  private ropeDrop = 0;
  private sway = 0;
  private swayV = 0;
  private wobble = 0;
  private dangerTeam: 0 | 1 | null = null;
  private syncShownAt: [number, number] = [-9999, -9999];
  private fallbackArt = true;
  private ropeG!: Phaser.GameObjects.Graphics;
  private beatG!: Phaser.GameObjects.Graphics;
  private meterG!: Phaser.GameObjects.Graphics;
  private flagG!: Phaser.GameObjects.Graphics;
  private stakeG!: Phaser.GameObjects.Graphics;
  private totem!: Phaser.GameObjects.Image;
  /** Height of the beat ring's centre above the totem's rope point (negative = below). */
  private headUp = TOTEM_H * TOTEM_HEAD;
  private headGlow!: Phaser.GameObjects.Image;
  private crowd: Phaser.GameObjects.Sprite[] = [];
  private plaques: { root: Phaser.GameObjects.Container; glow: Phaser.GameObjects.Graphics }[] = [];
  private ropePts: Pt[] = [];

  constructor() {
    super('mg-totem-tug');
  }

  // --- Setup -----------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = 40000;
    this.pullers = [];
    this.offset = 0;
    this.ropeV = 0;
    this.prevRopeV = 0;
    this.teamForce = [0, 0];
    // Line the drum up so a beat lands on GO (the countdown says GO 2.6 s after the scene starts).
    this.beatClock = 400;
    this.beatIdx = 0;
    this.beatFlash = 0;
    this.winner = undefined;
    this.celebrated = false;
    this.ropeDrop = 0;
    this.sway = 0;
    this.swayV = 0;
    this.wobble = 0;
    this.dangerTeam = null;
    this.syncShownAt = [-9999, -9999];
    this.crowd = [];
    this.plaques = [];
    this.ropePts = [];

    const rendered = this.textures.exists('rendered-scene-totem');
    this.fallbackArt = !rendered;
    if (this.textures.exists('rendered-sky-day')) this.add.image(GAME_WIDTH / 2, 470, 'rendered-sky-day').setDisplaySize(GAME_WIDTH * 1.04, 1170).setDepth(-100);
    else {
      const sky = this.add.graphics().setDepth(-100);
      sky.fillGradientStyle(0x5aa8f0, 0x5aa8f0, 0xd4eeff, 0xd4eeff, 1);
      sky.fillRect(0, 0, GAME_WIDTH, 1080);
    }
    if (rendered) {
      // Pre-rendered side-view festival clearing (ground line at GROUND_Y).
      this.add.image(0, 0, 'rendered-scene-totem').setOrigin(0).setDepth(-50);
    } else {
      this.ensureBackdrop();
      this.add.image(0, 0, 'tt-backdrop').setOrigin(0).setDepth(-50);
    }
    this.flagG = this.add.graphics().setDepth(-12);
    this.stakeG = this.add.graphics().setDepth(-14);
    this.buildCrowd();
    this.ropeG = this.add.graphics().setDepth(900);
    // Totem marker: pre-rendered sprite when supplied, else the carved fallback.
    let totemKey = 'rendered-mg-totem';
    if (!this.textures.exists(totemKey)) {
      this.ensureTotemTexture();
      totemKey = 'tt-totem';
    }
    this.totem = this.add.image(CENTER_X, ROPE_Y, totemKey).setDepth(910);
    if (totemKey === 'tt-totem') {
      this.totem.setOrigin(0.5, 1).setScale(TOTEM_H / this.totem.height);
      this.headUp = TOTEM_H * TOTEM_HEAD;
    } else {
      // Rendered sprites come at screen scale with their anchor listed in the sprite sheet meta.
      const meta = this.cache.json.get('rendered-mg-sprites') as Record<string, { anchor?: [number, number]; scale?: number }> | undefined;
      const a = meta?.totem?.anchor ?? [TOTEM_ORIGIN.x, TOTEM_ORIGIN.y];
      this.totem.setOrigin(a[0], a[1]).setScale(1 / (meta?.totem?.scale ?? 1));
      this.headUp = (a[1] - 0.5) * this.totem.displayHeight;
    }
    this.headGlow = this.add.image(CENTER_X, ROPE_Y - this.headUp, 'fx-dot').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd36b).setAlpha(0).setDepth(911);
    this.beatG = this.add.graphics().setDepth(920);
    this.meterG = this.add.graphics().setDepth(8000);
    this.buildPlaques();
  }

  /** Which team a player (by launch order) pulls for: 1&2 v 3&4, 1 v 2&3, or 1 v 1. */
  private teamOf(index: number): Team {
    return teamOf(index, this.players.length);
  }

  private membersOf(team: Team): number[] {
    return this.players.map((_, i) => i).filter((i) => this.teamOf(i) === team);
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const team = this.teamOf(index);
    const mates = this.membersOf(team);
    const k = mates.indexOf(index);
    // Screen order matches the HUD: P1 outer-left, P2 inner-left, P3 inner-right, P4 outer-right.
    let spot = SPOT_SOLO;
    let dy = SOLO_DY;
    if (mates.length > 1) {
      const inner = team === 0 ? k === mates.length - 1 : k === 0;
      spot = inner ? SPOT_INNER : SPOT_OUTER;
      dy = inner ? INNER_DY : OUTER_DY;
    }
    const dir: -1 | 1 = team === 0 ? -1 : 1;
    const x = CENTER_X + dir * spot;
    const c = new Character(this, x, GROUND_Y + dy, p.characterId, { scale: CHAR_SCALE, slot: p.slot });
    c.face(team === 1);
    const pose = pullPose(p.characterId);
    c.hold(pose.anim, pose.frame);
    c.setDepth(GROUND_Y + dy);
    p.character = c;
    const hint = this.buildHint(p);
    let prompt: Puller['prompt'] = null;
    if (!p.isCpu) {
      const kind = glyphKindFor(p.slot);
      const root = this.add.container(x, GROUND_Y + PROMPT_DY).setDepth(8500);
      const back = this.add.graphics();
      back.fillStyle(0x0c2630, 0.72);
      back.fillRoundedRect(-78, -30, 156, 60, 30);
      back.lineStyle(3, PLAYER_COLORS[p.slot], 0.9);
      back.strokeRoundedRect(-78, -30, 156, 60, 30);
      const lt = makeGlyph(this, 'LT', 40, kind);
      lt.x = -36;
      const rt = makeGlyph(this, 'RT', 40, kind);
      rt.x = 36;
      root.add([back, lt, rt]);
      prompt = { root, lt, rt };
    }
    const strength = this.players.length === 3 && mates.length === 1 ? SOLO_STRENGTH : 1;
    this.pullers.push({
      p,
      c,
      pose,
      team,
      dir,
      spot,
      dy,
      strength,
      last: null,
      lastPullAt: -1000,
      beatUsed: -99,
      power: 0,
      pulls: 0,
      powerPulls: 0,
      streak: 0,
      badgeY: animHeadTop(p.characterId, pose.anim) - 40,
      x,
      kick: 0,
      pulse: 0,
      lean: 8,
      dustT: 0,
      hintT: 0,
      hint,
      prompt,
      cpuNext: -1,
      cpuHeld: false,
      cpuBias: gauss() * this.skill(p).aimNoise * 50,
      cpuBurst: 0,
    });
  }

  /** "Alternate!" bubble shown above a puller who mashes one trigger (with the right glyphs). */
  private buildHint(p: MgPlayer): Phaser.GameObjects.Container {
    const root = this.add.container(0, 0).setDepth(8600).setVisible(false);
    const g = this.add.graphics();
    const w = p.isCpu ? 150 : 270;
    g.fillStyle(0x06141a, 0.25);
    g.fillRoundedRect(-w / 2 + 3, -28 + 5, w, 56, 28);
    g.fillStyle(0xfff4dc, 1);
    g.fillRoundedRect(-w / 2, -28, w, 56, 28);
    g.fillTriangle(-12, 26, 12, 26, 0, 42);
    g.lineStyle(3, COLORS.coral, 1);
    g.strokeRoundedRect(-w / 2, -28, w, 56, 28);
    root.add(g);
    if (p.isCpu) root.add(addText(this, 0, -1, 'Fumble!', 26, { color: '#c0392b', weight: 700, fixed: true }));
    else {
      const kind = glyphKindFor(p.slot);
      root.add(addText(this, -50, -1, 'ALTERNATE', 22, { color: '#c0392b', weight: 700, fixed: true }));
      const lt = makeGlyph(this, 'LT', 34, kind);
      lt.setPosition(48, 0);
      const rt = makeGlyph(this, 'RT', 34, kind);
      rt.setPosition(100, 0);
      root.add([lt, rt]);
    }
    return root;
  }

  /** What the humans call their triggers ("LT / RT", or the bound keys when everyone is on keys). */
  private triggerNames(): string {
    const humans = this.players.filter((p) => !p.isCpu);
    if (humans.length > 0 && humans.every((p) => glyphKindFor(p.slot) === 'keyboard')) {
      const b = settings.get().keyBindings;
      return `${keyLabel(b.LT[0] ?? 'KeyR')} / ${keyLabel(b.RT[0] ?? 'KeyF')}`;
    }
    return 'LT / RT';
  }

  /** Team plaques in the top corners: emblem, name and members (the HUD order can't show teams). */
  private buildPlaques(): void {
    for (const team of [0, 1] as const) {
      const members = this.membersOf(team);
      const x = PLAQUE_X[team];
      const root = this.add.container(x, PLAQUE_Y).setDepth(8000);
      const glow = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      glow.fillStyle(TEAM_COLORS[team], 0.35);
      glow.fillRoundedRect(-134, -8, 268, 132, 30);
      const g = this.add.graphics();
      g.fillStyle(0x06141a, 0.3);
      g.fillRoundedRect(-122 + 4, 0 + 7, 244, 112, 24);
      g.fillStyle(TEAM_DARK[team], 0.92);
      g.fillRoundedRect(-122, 0, 244, 112, 24);
      g.fillStyle(0xffffff, 0.08);
      g.fillRoundedRect(-114, 5, 228, 44, { tl: 20, tr: 20, bl: 8, br: 8 });
      g.lineStyle(4, TEAM_COLORS[team], 1);
      g.strokeRoundedRect(-122, 0, 244, 112, 24);
      const flip = team === 1 ? -1 : 1;
      drawEmblem(g, team, -92 * flip, 36, 19, TEAM_DARK[team]);
      const name = addText(this, 18 * flip, 35, `${TEAM_NAMES[team]} TEAM`, 25, { color: TEAM_CSS[team], weight: 700, stroke: '#06141a', strokeThickness: 5, fixed: true });
      root.add([glow, g, name]);
      const solo = members.length === 1 && this.players.length === 3;
      members.forEach((idx, i) => {
        const slot = this.players[idx].slot;
        const bx = solo ? -70 * flip : -52 + i * 64;
        root.add(new PlayerBadge(this, bx, 80, slot, 18));
      });
      if (solo) root.add(addText(this, 30 * flip, 80, 'x2 STRENGTH', 20, { color: CSS.goldLight, weight: 700, stroke: '#06141a', strokeThickness: 4, fixed: true }));
      this.plaques.push({ root, glow });
    }
  }

  /** Festival folk cheering along the back of the clearing. */
  private buildCrowd(): void {
    const feetY = GROUND_Y - 22;
    const folk: [NpcId, string, number][] = [
      ['mimi', 'happy', 188],
      ['packsprout', 'cheer', 262],
      ['ora', 'flag', 344],
      ['wrench', 'laugh', 1574],
      ['pipper', 'happy', 1652],
      ['mimi', 'laugh', 1730],
    ];
    folk.forEach(([id, pose, x], i) => {
      const spr = this.add.sprite(x, feetY, NPC_ATLAS, npcFrame(id, pose));
      const o = standOrigin(NPC_ATLAS, npcFrame(id, pose));
      spr.setOrigin(o.x, o.y).setScale(0.34).setDepth(-20 + i * 0.01).setFlipX(x > CENTER_X);
      this.tweens.add({ targets: spr, y: feetY - 6, duration: 360 + (i % 3) * 80, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 90 });
      this.crowd.push(spr);
    });
  }

  private crowdCheer(): void {
    for (const [i, spr] of this.crowd.entries()) {
      this.tweens.add({ targets: spr, scaleY: { from: 0.3, to: 0.4 }, duration: 150, yoyo: true, repeat: 2, delay: i * 45 });
    }
  }

  protected override onStart(): void {
    audio.play('rumble', { volume: 0.4 });
    if (this.humanSlots().length === 0) return;
    const t = addText(this, CENTER_X, 300, `Alternate ${this.triggerNames()} — pull on the beat!`, 40, { color: CSS.cream, stroke: '#06141a', strokeThickness: 7, weight: 700, fixed: true }).setDepth(8800);
    const back = this.add.graphics().setDepth(8799);
    back.fillStyle(0x06141a, 0.55);
    back.fillRoundedRect(CENTER_X - t.width / 2 - 28, 300 - 32, t.width + 56, 64, 32);
    for (const o of [t, back]) {
      o.setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, delay: 700, duration: 250 });
      this.tweens.add({ targets: o, alpha: 0, delay: 3400, duration: 500, onComplete: () => o.destroy() });
    }
  }

  // --- Pulling ---------------------------------------------------------------------------------
  private readInput(u: Puller): void {
    const c = u.p.controls;
    const l = c.pressed('LT');
    const r = c.pressed('RT');
    if (!l && !r) return;
    const trig: Trigger = l && r ? (u.last === 'LT' ? 'RT' : 'LT') : l ? 'LT' : 'RT';
    if (trig === u.last) this.mash(u);
    else this.pull(u, trig);
  }

  private pull(u: Puller, trig: Trigger): void {
    const k = Math.round(this.beatClock / BEAT_MS);
    const onBeat = Math.abs(this.beatClock - k * BEAT_MS) <= BEAT_WINDOW && u.beatUsed !== k;
    if (onBeat) u.beatUsed = k;
    const since = this.elapsed - u.lastPullAt;
    const recovery = Phaser.Math.Clamp((since - RECOVER_MIN) / RECOVER_MS, RECOVER_FLOOR, 1);
    const sync = onBeat && this.pullers.some((m) => m !== u && m.team === u.team && m.beatUsed === k);
    const bonus = sync ? SYNC_MULT : onBeat && u.strength > 1 ? SOLO_POWER_BONUS : 1;
    const amount = u.strength * recovery * (onBeat ? POWER_MULT : 1) * bonus * (1 + DIG_IN * this.danger(u)) * (1 - GRIP_JITTER + 2 * GRIP_JITTER * this.rng.next());
    u.last = trig;
    u.lastPullAt = this.elapsed;
    u.pulls++;
    if (onBeat) u.powerPulls++;
    u.streak = onBeat ? u.streak + 1 : 0;
    u.power += amount * PULL_POINTS;
    u.p.score = Math.round(u.power);
    this.ropeV = Phaser.Math.Clamp(this.ropeV + u.dir * KICK * amount, -MAX_ROPE_V, MAX_ROPE_V);
    this.teamForce[u.team] += amount;
    // Feedback: step back, squash, rope ripple.
    u.kick = onBeat ? 18 : 5 + 7 * recovery;
    u.pulse = onBeat ? 1 : 0.35 + 0.35 * recovery;
    u.c.squash(onBeat ? 0.17 : 0.09, onBeat ? 170 : 120);
    this.wobble = Math.min(14, this.wobble + (onBeat ? 7 : 2.5));
    const hand = this.handPos(u);
    if (onBeat) {
      audio.play('chipGain', { volume: 0.32, rate: u.team === 0 ? 0.8 : 0.92, throttleMs: 45 });
      audio.play('land', { volume: 0.3, throttleMs: 45 });
      this.fx.sparks(hand.x, hand.y, 10);
      this.fx.vfx('impact', hand.x, hand.y, { scale: 0.32, duration: 260, blend: 'add', tint: TEAM_COLORS[u.team] });
      if (sync) {
        // Both team-mates hit the same beat (the callout is rationed so it stays special).
        const mates = this.pullers.filter((m) => m.team === u.team);
        const mx = mates.reduce((a, m) => a + m.c.x, 0) / mates.length;
        this.fx.vfx('goldSwirl', mx, GROUND_Y - 150, { scale: 0.4, duration: 380, blend: 'add', alpha: 0.7 });
        if (this.elapsed >= this.syncShownAt[u.team] + SYNC_CALLOUT_MS || mates.some((m) => !m.p.isCpu)) {
          this.syncShownAt[u.team] = this.elapsed;
          this.fx.floatText(mx, GROUND_Y - 300, 'SYNC!', '#fff4a8', { size: 48, rise: 70, duration: 700, stroke: '#06141a' });
          audio.play('pop', { volume: 0.35, rate: 1.3, throttleMs: 80 });
        }
        for (const m of mates) this.rumble(m.p, 0.3, 0.3, 80);
      } else if (!u.p.isCpu) {
        const label = u.streak >= 3 ? `RHYTHM x${u.streak}!` : u.strength > 1 ? 'POWER x2!' : 'POWER!';
        this.fx.floatText(u.c.x, GROUND_Y + u.c.headY * 0.7 - 70, label, TEAM_CSS[u.team], { size: u.streak >= 3 ? 38 : 34, rise: 60, duration: 650 });
      }
      this.fx.vfx('dust', u.c.x - u.dir * -30, GROUND_Y + u.dy, { scale: 0.24, duration: 320, alpha: 0.7, flipX: u.dir > 0 });
      this.rumble(u.p, 0.25, 0.4, 70);
    } else {
      audio.play('land', { volume: 0.16, throttleMs: 60 });
      this.rumble(u.p, 0.08, 0.18, 40);
    }
  }

  /** 0..1: how close the totem is to this puller's own losing line (dig-in strength). */
  private danger(u: Puller): number {
    return Phaser.Math.Clamp((-u.dir * this.offset - (WIN_DIST - DIG_RANGE)) / DIG_RANGE, 0, 1);
  }

  private mash(u: Puller): void {
    u.hintT = u.p.isCpu ? 700 : 1300;
    u.c.squash(0.05, 80);
    if (!u.p.isCpu) audio.play('cancel', { volume: 0.2, throttleMs: 300 });
  }

  // --- Frame -----------------------------------------------------------------------------------
  protected tick(dt: number): void {
    const s = dt / 1000;
    if (this.winner === undefined) for (const u of this.pullers) this.readInput(u);
    this.prevRopeV = this.ropeV;
    this.ropeV *= Math.exp(-ROPE_DAMP * s);
    this.offset += this.ropeV * s;
    const k = Math.exp(-s / FORCE_TAU);
    this.teamForce[0] *= k;
    this.teamForce[1] *= k;
    // Anticipation: the crowd roars when a team gets close to its line.
    const near = this.offset <= -(WIN_DIST - 110) ? 0 : this.offset >= WIN_DIST - 110 ? 1 : null;
    if (near !== null && near !== this.dangerTeam) {
      audio.play('drumroll', { volume: 0.4 });
      this.crowdCheer();
      // The team about to be dragged over digs its heels in (they pull harder near their line).
      const losers = this.pullers.filter((u) => u.team !== near);
      if (losers.length > 0) {
        const lx = losers.reduce((a, u) => a + u.c.x, 0) / losers.length;
        this.fx.floatText(lx, GROUND_Y - 300, 'DIG IN!', TEAM_CSS[losers[0].team], { size: 44, rise: 60, duration: 900 });
      }
    }
    this.dangerTeam = near;
    if (this.winner === undefined) {
      if (this.offset <= -WIN_DIST) this.win(0);
      else if (this.offset >= WIN_DIST) this.win(1);
    }
  }

  private win(team: 0 | 1): void {
    this.winner = team;
    this.offset = team === 0 ? -WIN_DIST : WIN_DIST;
    const sx = CENTER_X + (team === 0 ? -WIN_DIST : WIN_DIST);
    this.fx.sparks(sx, ROPE_Y - 40, 30);
    this.fx.flash(0xffffff, 140);
    this.end();
  }

  private tallies() {
    return this.pullers.map((u) => ({ slot: u.p.slot, team: u.team, power: u.power }));
  }

  protected override end(): void {
    // At the buzzer the side the totem is on wins; dead level falls back to total pull power.
    if (this.winner === undefined) this.winner = buzzerWinner(this.offset, this.tallies(), DRAW_EPS);
    super.end();
    if (!this.celebrated) {
      this.celebrated = true;
      this.celebrate();
    }
  }

  private celebrate(): void {
    const w = this.winner ?? null;
    for (const u of this.pullers) {
      u.prompt?.root.setVisible(false);
      u.hint.setVisible(false);
      u.c.sprite.setAngle(0);
      u.c.marker?.setPosition(0, animHeadTop(u.p.characterId) - 46);
    }
    this.tweens.add({ targets: this, ropeDrop: 1, duration: 420, ease: 'Quad.In' });
    if (w === null) {
      for (const u of this.pullers) u.c.play('surprised', { force: true, returnTo: 'idle' });
      const t = addTitle(this, CENTER_X, 340, 'DEAD LEVEL!', 90, CSS.cream).setDepth(9400).setScale(0.4);
      this.tweens.add({ targets: t, scale: 1, duration: 300, ease: 'Back.Out' });
      return;
    }
    audio.play('cheer', { volume: 0.7 });
    this.crowdCheer();
    for (const u of this.pullers) {
      if (u.team === w) {
        u.c.play('victory', { force: true, returnTo: 'celebrate' });
        this.tweens.add({ targets: u.c, y: u.c.y - 36, duration: 200, yoyo: true, repeat: 2, ease: 'Quad.Out', delay: 120 });
      } else {
        // Yanked off their feet towards the winners.
        u.c.play('fall', { force: true, returnTo: 'fall' });
        const dx = (w === 0 ? -1 : 1) * 80;
        this.tweens.add({ targets: u.c, x: u.c.x + dx, duration: 380, ease: 'Quad.Out' });
        this.fx.vfx('dust', u.c.x + dx * 0.5, GROUND_Y + u.dy, { scale: 0.34, duration: 420, alpha: 0.8 });
        this.time.delayedCall(900, () => u.c.hold('disappointed', 2));
      }
    }
    const sideX = CENTER_X + (w === 0 ? -520 : 520);
    this.fx.confetti(sideX, 420, 90);
    const ts = this.totem.scale;
    this.tweens.add({ targets: this.totem, scale: ts * 1.18, duration: 180, yoyo: true, repeat: 1, ease: 'Quad.Out' });
    this.fx.sparks(this.headGlow.x, this.headGlow.y, 24);
    const t = addTitle(this, CENTER_X, 340, `${TEAM_NAMES[w]} TEAM WINS!`, 88, TEAM_CSS[w]).setDepth(9400).setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 320, ease: 'Back.Out' });
    this.plaques[w].glow.setAlpha(1);
    this.tweens.add({ targets: this.plaques[w].root, scale: { from: 1.15, to: 1 }, duration: 260, ease: 'Back.Out' });
  }

  protected override ambient(dt: number): void {
    this.beatClock += dt;
    const k = Math.floor(this.beatClock / BEAT_MS);
    if (k !== this.beatIdx) {
      this.beatIdx = k;
      this.onBeat(k);
    }
    this.beatFlash = Math.max(0, this.beatFlash - dt / 260);
    this.syncVisuals(dt);
  }

  private onBeat(k: number): void {
    if (this.phase === 'finished') return;
    const accent = k % 4 === 0;
    audio.play('step', { volume: (this.phase === 'playing' ? 0.55 : 0.3) * (accent ? 1.3 : 1), rate: accent ? 0.8 : 1 });
    this.beatFlash = 1;
    for (const u of this.pullers) {
      if (!u.prompt) continue;
      const next = u.last === 'LT' ? u.prompt.rt : u.last === 'RT' ? u.prompt.lt : null;
      for (const gl of next ? [next] : [u.prompt.lt, u.prompt.rt]) this.tweens.add({ targets: gl, scale: { from: 1.25, to: 1 }, duration: 180, ease: 'Quad.Out' });
    }
  }

  // --- Visuals ---------------------------------------------------------------------------------
  /** Where a puller's hands grip the rope (screen px), following their lean. */
  private handPos(u: Puller): Pt {
    const hx = u.pose.hand[0] * (u.dir < 0 ? 1 : -1);
    const hy = u.pose.hand[1];
    const a = Phaser.Math.DegToRad(u.c.sprite.angle);
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    return { x: u.c.x + (hx * cs - hy * sn) * CHAR_SCALE, y: u.c.y + (hx * sn + hy * cs) * CHAR_SCALE };
  }

  private syncVisuals(dt: number): void {
    const s = dt / 1000;
    const markerX = CENTER_X + this.offset;
    const playing = this.winner === undefined;
    for (const u of this.pullers) {
      u.kick *= Math.exp(-9 * s);
      u.pulse *= Math.exp(-5 * s);
      u.hintT = Math.max(0, u.hintT - dt);
      if (playing) {
        // Dragged towards the rivals? Lean forward and skid.
        const drag = Phaser.Math.Clamp((-u.dir * this.ropeV) / 120, 0, 1) * (this.phase === 'playing' ? 1 : 0);
        const target = 10 + 16 * u.pulse - 16 * drag + 10 * this.danger(u);
        u.lean += (target - u.lean) * (1 - Math.exp(-14 * s));
        u.x = markerX + u.dir * (u.spot + u.kick);
        u.c.setPosition(u.x, GROUND_Y + u.dy);
        u.c.sprite.setAngle(u.dir * u.lean);
        // Keep the player badge over the leaning head.
        const a = Phaser.Math.DegToRad(u.dir * u.lean);
        u.c.marker?.setPosition(-u.badgeY * Math.sin(a), u.badgeY * Math.cos(a));
        u.dustT -= dt;
        if (drag > 0.45 && u.dustT <= 0) {
          u.dustT = 150;
          this.fx.vfx('dust', u.x - u.dir * 20, GROUND_Y + u.dy, { scale: 0.2, duration: 300, alpha: 0.55, flipX: u.dir < 0 });
        }
      }
      if (u.prompt) {
        u.prompt.root.setPosition(u.c.x, GROUND_Y + PROMPT_DY);
        const expectL = u.last !== 'LT';
        const expectR = u.last !== 'RT';
        u.prompt.lt.setAlpha(expectL ? 1 : 0.3);
        u.prompt.rt.setAlpha(expectR ? 1 : 0.3);
        if (u.hintT > 0) u.prompt.root.x += Math.sin(this.time.now / 22) * 5;
      }
      u.hint.setVisible(u.hintT > 0 && playing);
      if (u.hintT > 0) u.hint.setPosition(u.c.x, GROUND_Y + u.c.headY * CHAR_SCALE - 64 - (u.p.isCpu ? 0 : 6));
    }
    this.drawRope(s);
    this.syncTotem(s);
    this.drawBeat();
    this.drawStakes();
    this.drawMeter();
    if (this.fallbackArt) this.drawFlags();
    const lead = this.offset < -30 ? 0 : this.offset > 30 ? 1 : null;
    if (playing) this.plaques.forEach((pl, t) => pl.glow.setAlpha(lead === t ? 0.5 + 0.5 * Math.sin(this.time.now / 160) : 0));
  }

  /** Rope polyline: tail on the ground, through every hand, dipping at the totem, and out again. */
  private ropePath(): Pt[] {
    const markerX = CENTER_X + this.offset;
    const side = (team: 0 | 1): Pt[] => {
      const us = this.pullers.filter((u) => u.team === team).sort((a, b) => a.spot - b.spot);
      const dir = team === 0 ? -1 : 1;
      const hands = us.map((u) => this.handPos(u));
      const outer = hands[hands.length - 1] ?? { x: markerX + dir * SPOT_SOLO, y: ROPE_Y };
      const endX = (team === 0 ? ROPE_X0 : ROPE_X1) + this.offset;
      const groundY = GROUND_Y - 5;
      // Tail: droops from the anchor's hands to the grass, then lies along it to the end.
      const tail: Pt[] = [];
      const touch = { x: outer.x + dir * 120, y: groundY };
      const ctrl = { x: outer.x + dir * 50, y: groundY - 6 };
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const c = t * t;
        tail.push({ x: a * outer.x + b * ctrl.x + c * touch.x, y: a * outer.y + b * ctrl.y + c * touch.y });
      }
      if (dir * (endX - touch.x) > 10) tail.push({ x: (touch.x + endX) / 2, y: groundY + 3 }, { x: endX, y: groundY });
      return [...hands, ...tail];
    };
    const left = side(0);
    const right = side(1);
    const lIn = left[0];
    const rIn = right[0];
    // Totem point on the middle span: a V under the totem's weight, flatter when both sides haul.
    const t = (markerX - lIn.x) / Math.max(1, rIn.x - lIn.x);
    const tension = Math.min(1, (this.teamForce[0] + this.teamForce[1]) / 6);
    const sag = 12 - 7 * tension;
    const mid = { x: markerX, y: lIn.y + (rIn.y - lIn.y) * t + sag };
    const pts = [...left.reverse(), mid, ...right];
    if (this.ropeDrop > 0) {
      for (const p of pts) p.y += (GROUND_Y - 5 - p.y) * this.ropeDrop;
    }
    return pts;
  }

  private drawRope(s: number): void {
    const g = this.ropeG;
    g.clear();
    this.wobble *= Math.exp(-5 * s);
    const pts = this.ropePath();
    // Ripple travelling along the rope after pulls.
    const now = this.time.now / 1000;
    for (let i = 1; i < pts.length - 1; i++) {
      if (pts[i].y > GROUND_Y - 12) continue;
      pts[i].y += Math.sin(now * 26 + i * 1.7) * this.wobble * 0.25;
    }
    this.ropePts = pts;
    // Soft shadow on the grass under the rope.
    g.lineStyle(10, 0x173a12, 0.14);
    g.beginPath();
    g.moveTo(pts[0].x + 16, GROUND_Y + 14);
    g.lineTo(pts[pts.length - 1].x - 16, GROUND_Y + 14);
    g.strokePath();
    const stroke = (w: number, color: number, alpha: number, dy: number) => {
      g.lineStyle(w, color, alpha);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y + dy);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y + dy);
      g.strokePath();
      g.fillStyle(color, alpha);
      for (let i = 1; i < pts.length - 1; i++) g.fillCircle(pts[i].x, pts[i].y + dy, w / 2);
    };
    stroke(17, 0x4a2c10, 1, 1);
    stroke(12, 0xc4914e, 1, 0);
    stroke(4, 0xf6dea4, 0.85, -3);
    // Woven twist: slanted strands every 11 px of rope length, sliding with the rope.
    g.lineStyle(2.5, 0x7a4f22, 0.9);
    let along = -this.offset;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ux = dx / len;
      const uy = dy / len;
      const start = (((11 - (along % 11)) % 11) + 11) % 11;
      for (let d = start; d < len; d += 11) {
        const px = a.x + ux * d;
        const py = a.y + uy * d;
        g.lineBetween(px - uy * 5 - ux * 3, py + ux * 5 - uy * 3, px + uy * 5 + ux * 3, py - ux * 5 + uy * 3);
      }
      along += len;
    }
    // Frayed knots at both ends.
    for (const [e, dir] of [
      [pts[0], -1],
      [pts[pts.length - 1], 1],
    ] as [Pt, number][]) {
      g.fillStyle(0x4a2c10, 1);
      g.fillCircle(e.x, e.y, 10);
      g.fillStyle(0xb98543, 1);
      g.fillCircle(e.x, e.y - 1, 7);
      g.lineStyle(3, 0xd9ac6a, 1);
      for (let j = -1; j <= 1; j++) g.lineBetween(e.x + dir * 6, e.y + j * 4, e.x + dir * 20, e.y + j * 7 + 2);
    }
  }

  private syncTotem(s: number): void {
    const pts = this.ropePts;
    const mid = pts.find((p) => Math.abs(p.x - (CENTER_X + this.offset)) < 0.01) ?? { x: CENTER_X + this.offset, y: ROPE_Y };
    // Springy sway from the rope's acceleration.
    const acc = s > 0 ? (this.ropeV - this.prevRopeV) / s : 0;
    this.swayV += (-acc * 0.012 - this.sway * 60) * s;
    this.swayV *= Math.exp(-3.5 * s);
    this.sway = Phaser.Math.Clamp(this.sway + this.swayV * s, -18, 18);
    this.totem.setPosition(mid.x, mid.y + 4);
    if (!this.tweens.isTweening(this.totem)) this.totem.setAngle(this.sway - this.ropeV * 0.03);
    const a = Phaser.Math.DegToRad(this.totem.angle);
    const hx = mid.x + Math.sin(a) * this.headUp;
    const hy = this.totem.y - Math.cos(a) * this.headUp;
    this.headGlow.setPosition(hx, hy).setScale(3.2 + this.beatFlash * 2.6).setAlpha(0.25 + this.beatFlash * 0.7);
    // Lashing where the totem is tied on.
    const g = this.ropeG;
    g.fillStyle(0x3b1f0c, 1);
    g.fillRoundedRect(mid.x - 13, mid.y - 11, 26, 22, 6);
    g.fillStyle(0xd8453a, 1);
    g.fillRoundedRect(mid.x - 10, mid.y - 9, 20, 18, 5);
    g.lineStyle(2, 0xffd08a, 0.9);
    for (const dx of [-5, 0, 5]) g.lineBetween(mid.x + dx - 2, mid.y - 8, mid.x + dx + 2, mid.y + 8);
  }

  /** Metronome ring on the totem's spiral: it closes on the ring exactly on the beat. */
  private drawBeat(): void {
    const g = this.beatG;
    g.clear();
    if (this.phase === 'finished') return;
    const hx = this.headGlow.x;
    const hy = this.headGlow.y;
    const phase = (this.beatClock % BEAT_MS) / BEAT_MS;
    const toNext = BEAT_MS - (this.beatClock % BEAT_MS);
    const sinceLast = this.beatClock % BEAT_MS;
    const inWindow = toNext <= BEAT_WINDOW || sinceLast <= BEAT_WINDOW;
    const R = 34;
    // Target ring: bright gold inside the timing window.
    g.lineStyle(inWindow ? 7 : 4, inWindow ? 0xfff0a0 : 0xffffff, inWindow ? 1 : 0.55);
    g.strokeCircle(hx, hy, R);
    // Approach ring shrinking onto it.
    const r = R + (1 - phase) * 70;
    g.lineStyle(5, COLORS.gold, 0.25 + 0.75 * phase);
    g.strokeCircle(hx, hy, r);
    if (this.beatFlash > 0) {
      g.lineStyle(10 * this.beatFlash, 0xfff4c0, this.beatFlash);
      g.strokeCircle(hx, hy, R + (1 - this.beatFlash) * 30);
    }
  }

  /** Win-line stakes with team pennants; they glow as the totem closes in. */
  private drawStakes(): void {
    const g = this.stakeG;
    g.clear();
    const now = this.time.now;
    for (const team of [0, 1] as const) {
      const x = CENTER_X + (team === 0 ? -WIN_DIST : WIN_DIST);
      const dist = team === 0 ? this.offset + WIN_DIST : WIN_DIST - this.offset;
      const heat = Phaser.Math.Clamp(1 - dist / 160, 0, 1);
      const pulse = heat > 0 ? 0.5 + 0.5 * Math.sin(now / (70 + 90 * (1 - heat))) : 0;
      const top = ROPE_Y - 150;
      // Glow column (anticipation)
      if (heat > 0) {
        g.fillStyle(TEAM_COLORS[team], 0.12 + 0.22 * heat * pulse);
        g.fillRoundedRect(x - 26, top - 20, 52, GROUND_Y - top + 44, 26);
      }
      if (!this.fallbackArt) continue; // the rendered clearing has its own win-line posts
      // Ground marker
      g.fillStyle(0x06141a, 0.18);
      g.fillEllipse(x + 6, GROUND_Y + 22, 70, 16);
      g.fillStyle(TEAM_COLORS[team], 0.85);
      g.fillEllipse(x, GROUND_Y + 18, 58, 14);
      // Post
      g.fillStyle(0x4a2c10, 1);
      g.fillRoundedRect(x - 7, top, 14, GROUND_Y + 18 - top, 5);
      g.fillStyle(0x9a6536, 1);
      g.fillRoundedRect(x - 5, top, 8, GROUND_Y + 16 - top, 4);
      g.fillStyle(0xd9a367, 0.8);
      g.fillRect(x - 4, top + 4, 2, GROUND_Y + 8 - top);
      // Pennant pointing out to its team's side, with the team emblem.
      const fdir = team === 0 ? -1 : 1;
      const wave = Math.sin(now / 240 + team) * 5;
      g.fillStyle(TEAM_DARK[team], 1);
      g.fillTriangle(x, top + 2, x, top + 56, x + fdir * (86 + wave), top + 26 + wave * 0.4);
      g.fillStyle(heat > 0 && pulse > 0.5 ? 0xffffff : TEAM_COLORS[team], 1);
      g.fillTriangle(x, top + 6, x, top + 50, x + fdir * (78 + wave), top + 27 + wave * 0.4);
      drawEmblem(g, team, x + fdir * 28, top + 28, 10, heat > 0 && pulse > 0.5 ? 0xffffff : TEAM_COLORS[team]);
      g.fillStyle(COLORS.gold, 1);
      g.fillCircle(x, top - 4, 9);
      g.fillStyle(0xfff0b0, 1);
      g.fillCircle(x - 2, top - 6, 4);
    }
  }

  /** Tug gauge: totem position between the two win lines, plus which way the rope is going. */
  private drawMeter(): void {
    const g = this.meterG;
    g.clear();
    const cx = CENTER_X;
    const y = METER_Y;
    const w = METER_W;
    const h = 22;
    const x0 = cx - w / 2;
    g.fillStyle(0x06141a, 0.3);
    g.fillRoundedRect(x0 - 50 + 4, y - 26 + 6, w + 100, 52, 26);
    g.fillStyle(0x0c2630, 0.9);
    g.fillRoundedRect(x0 - 50, y - 26, w + 100, 52, 26);
    g.lineStyle(3, 0xffffff, 0.18);
    g.strokeRoundedRect(x0 - 50, y - 26, w + 100, 52, 26);
    g.fillStyle(TEAM_DARK[0], 1);
    g.fillRoundedRect(x0, y - h / 2, w / 2, h, { tl: h / 2, bl: h / 2, tr: 0, br: 0 });
    g.fillStyle(TEAM_DARK[1], 1);
    g.fillRoundedRect(cx, y - h / 2, w / 2, h, { tl: 0, bl: 0, tr: h / 2, br: h / 2 });
    const f = Phaser.Math.Clamp(this.offset / WIN_DIST, -1, 1);
    const fx = cx + (f * w) / 2;
    const lead = f < 0 ? 0 : 1;
    g.fillStyle(TEAM_COLORS[lead], 1);
    if (f < 0) g.fillRect(fx, y - h / 2 + 3, cx - fx, h - 6);
    else g.fillRect(cx, y - h / 2 + 3, fx - cx, h - 6);
    g.fillStyle(0xffffff, 0.2);
    g.fillRect(x0 + 8, y - h / 2 + 3, w - 16, 4);
    g.fillStyle(0xffffff, 0.95);
    g.fillRect(cx - 2, y - h / 2 - 5, 4, h + 10);
    drawEmblem(g, 0, x0 - 26, y, 14, 0x0c2630);
    drawEmblem(g, 1, x0 + w + 26, y, 14, 0x0c2630);
    // Momentum arrow (rope velocity).
    const v = Phaser.Math.Clamp(this.ropeV / 90, -1, 1);
    if (Math.abs(v) > 0.06) {
      const col = v < 0 ? TEAM_COLORS[0] : TEAM_COLORS[1];
      const len = 18 + Math.abs(v) * 46;
      const d = Math.sign(v);
      g.fillStyle(col, 0.95);
      g.fillRect(Math.min(fx, fx + d * len), y - 29 - 4, len, 8);
      g.fillTriangle(fx + d * (len + 16), y - 29, fx + d * len, y - 29 - 11, fx + d * len, y - 29 + 11);
    }
    // Knob: a tiny totem head.
    g.fillStyle(0x06141a, 0.35);
    g.fillCircle(fx + 2, y + 4, 17);
    g.fillStyle(0x4a2c10, 1);
    g.fillCircle(fx, y, 17);
    g.fillStyle(COLORS.gold, 1);
    g.fillCircle(fx, y, 13);
    g.lineStyle(3, 0x4a2c10, 1);
    g.beginPath();
    for (let i = 0; i <= 18; i++) {
      const a = i * 0.62;
      const r = 1.5 + i * 0.52;
      if (i === 0) g.moveTo(fx + Math.cos(a) * r, y + Math.sin(a) * r);
      else g.lineTo(fx + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.strokePath();
  }

  /** Big team flags on poles at both edges (fallback art only), waving in the breeze. */
  private drawFlags(): void {
    const g = this.flagG;
    g.clear();
    const now = this.time.now / 1000;
    for (const team of [0, 1] as const) {
      const x = FLAG_X[team];
      const dir = team === 0 ? 1 : -1;
      g.fillStyle(0x06141a, 0.2);
      g.fillEllipse(x + 10, GROUND_Y + 30, 60, 14);
      g.fillStyle(0x4a2c10, 1);
      g.fillRoundedRect(x - 8, FLAG_TOP, 16, GROUND_Y + 30 - FLAG_TOP, 6);
      g.fillStyle(0x9a6536, 1);
      g.fillRoundedRect(x - 5, FLAG_TOP, 9, GROUND_Y + 26 - FLAG_TOP, 4);
      g.fillStyle(COLORS.gold, 1);
      g.fillCircle(x, FLAG_TOP - 6, 12);
      g.fillStyle(0xfff0b0, 1);
      g.fillCircle(x - 3, FLAG_TOP - 9, 5);
      // Cloth: a grid of points displaced by a travelling wave.
      const W = 170;
      const H = 112;
      const cols = 10;
      const P = (u: number, v: number): Pt => {
        const wave = Math.sin(now * 4.2 - u * 5.5 + team * 2) * 9 * u;
        return { x: x + dir * (8 + u * W), y: FLAG_TOP + 10 + v * H + wave + u * 10 };
      };
      for (let i = 0; i < cols; i++) {
        const u0 = i / cols;
        const u1 = (i + 1) / cols;
        const a = P(u0, 0);
        const b = P(u1, 0);
        const c = P(u1, 1);
        const d = P(u0, 1);
        const shade = 0.82 + 0.18 * Math.cos(now * 4.2 - u0 * 5.5 + team * 2);
        const col = Phaser.Display.Color.ValueToColor(TEAM_COLORS[team]);
        const fill = Phaser.Display.Color.GetColor(Math.min(255, col.red * shade), Math.min(255, col.green * shade), Math.min(255, col.blue * shade));
        g.fillStyle(fill, 1);
        g.fillPoints([a, b, c, d], true);
      }
      // Trim + emblem
      g.lineStyle(4, TEAM_DARK[team], 0.9);
      g.beginPath();
      for (let i = 0; i <= cols; i++) {
        const p = P(i / cols, 1);
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.strokePath();
      const e = P(0.45, 0.5);
      drawEmblem(g, team, e.x, e.y, 26, TEAM_COLORS[team]);
    }
  }

  // --- CPU -------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const u = this.pullers.find((x) => x.p === p);
    if (!u) return;
    if (u.cpuHeld) {
      // Let go of the trigger for a frame so the next squeeze registers as a fresh press.
      vc.setTriggers(0, 0);
      u.cpuHeld = false;
      return;
    }
    if (this.winner !== undefined) return;
    const sk = this.skill(p);
    const now = this.beatClock;
    if (u.cpuNext < 0) u.cpuNext = Math.ceil((now + sk.reaction) / BEAT_MS) * BEAT_MS + u.cpuBias + gauss() * sk.aimNoise * 220;
    if (now + dt * 0.5 < u.cpuNext) return;
    let trig: Trigger = u.last === 'LT' ? 'RT' : 'LT';
    // Fumble: squeezes the same trigger twice.
    if (u.last && Math.random() < sk.mistake * 0.45) trig = u.last;
    vc.setTriggers(trig === 'LT' ? 1 : 0, trig === 'RT' ? 1 : 0);
    u.cpuHeld = true;
    if (u.cpuBurst > 0) {
      u.cpuBurst--;
      u.cpuNext = now + 100 + Math.random() * 70;
      return;
    }
    const k = Math.round(now / BEAT_MS);
    let next = (k + 1) * BEAT_MS;
    const r = Math.random();
    if (r < sk.mistake * 0.5) next += BEAT_MS; // loses the rhythm for a beat
    else if (r < sk.mistake * 0.5 + (1 - sk.accuracy) * 0.9) next -= BEAT_MS / 2; // an extra off-beat tug
    // Panic mash when the rivals are about to win (weaker CPUs panic more).
    if (u.dir * this.offset < -(WIN_DIST - 120) && Math.random() < (1 - sk.accuracy) * 1.4) u.cpuBurst = 3;
    u.cpuNext = next + u.cpuBias + gauss() * sk.aimNoise * 220;
  }

  // --- Scores ----------------------------------------------------------------------------------
  protected override hudLabel(p: MgPlayer): string {
    return String(Math.round(this.pullers.find((u) => u.p === p)?.power ?? 0));
  }

  /** Team-mates always share a place (see TotemTugRules.teamFinalScores). */
  protected finalScores(): { slot: number; score: number; label: string }[] {
    return teamFinalScores(this.tallies(), this.winner ?? null);
  }

  // --- Fallback art ----------------------------------------------------------------------------
  /** Hills, trees, tents and the grassy clearing, painted once into a canvas texture. */
  private ensureBackdrop(): void {
    if (this.textures.exists('tt-backdrop')) return;
    const tex = this.textures.createCanvas('tt-backdrop', GAME_WIDTH, 1080);
    if (!tex) return;
    const ctx = tex.getContext();
    const rng = new Random(9127);
    const W = GAME_WIDTH;
    const ridge = (x: number, base: number, amps: number[], freqs: number[], phase: number) => amps.reduce((y, a, i) => y + a * Math.sin(x * freqs[i] + phase * (i + 1)), base);
    const fillRidge = (base: number, amps: number[], freqs: number[], phase: number, top: string, bottom: string, y0: number, y1: number) => {
      const grad = ctx.createLinearGradient(0, y0, 0, y1);
      grad.addColorStop(0, top);
      grad.addColorStop(1, bottom);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 1080);
      for (let x = 0; x <= W; x += 8) ctx.lineTo(x, ridge(x, base, amps, freqs, phase));
      ctx.lineTo(W, 1080);
      ctx.closePath();
      ctx.fill();
    };
    // Far misty hills with little tree clumps.
    const farA = [34, 20, 8];
    const farF = [0.0027, 0.0073, 0.019];
    fillRidge(578, farA, farF, 0.7, '#b6dfcf', '#9fcdb6', 520, 800);
    for (let i = 0; i < 46; i++) {
      const x = rng.range(0, W);
      const y = ridge(x, 578, farA, farF, 0.7) + 5;
      const r = rng.range(6, 11);
      ctx.fillStyle = rng.chance(0.5) ? '#8fc4a6' : '#86bb9e';
      ctx.beginPath();
      ctx.arc(x, y - r * 0.6, r, 0, Math.PI * 2);
      ctx.arc(x + r * 0.8, y - r * 0.3, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    const haze = ctx.createLinearGradient(0, 560, 0, 720);
    haze.addColorStop(0, 'rgba(230,245,255,0)');
    haze.addColorStop(1, 'rgba(230,245,255,0.35)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 560, W, 160);
    // Mid hills with a sunlit rim.
    const midA = [28, 15, 6];
    const midF = [0.0034, 0.0091, 0.024];
    fillRidge(686, midA, midF, 2.1, '#92d36b', '#5fae47', 640, 820);
    ctx.strokeStyle = 'rgba(255,252,210,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = ridge(x, 686, midA, midF, 2.1) + 1.5;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Round-canopy trees on the flanks (kept away from the tug in the middle).
    const tree = (x: number, s: number) => {
      const y = ridge(x, 686, midA, midF, 2.1) + 18 * s;
      ctx.fillStyle = 'rgba(20,50,20,0.18)';
      ctx.beginPath();
      ctx.ellipse(x + 14 * s, y + 4, 48 * s, 10 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6b4424';
      ctx.fillRect(x - 7 * s, y - 70 * s, 14 * s, 72 * s);
      const blobs: [number, number, number][] = [
        [-30, -92, 36],
        [26, -96, 34],
        [0, -128, 42],
        [-6, -84, 38],
      ];
      for (const [bx, by, br] of blobs) {
        const gx = x + bx * s;
        const gy = y + by * s;
        const grad = ctx.createRadialGradient(gx - br * s * 0.4, gy - br * s * 0.5, br * s * 0.1, gx, gy, br * s);
        grad.addColorStop(0, '#b4ec86');
        grad.addColorStop(0.55, '#77c257');
        grad.addColorStop(1, '#4b943a');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(gx, gy, br * s, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    tree(150, 1.05);
    tree(300, 0.8);
    tree(1628, 0.85);
    tree(1790, 1.1);
    // Festival tents behind the clearing.
    const tent = (x: number, stripe: string, s: number) => {
      const baseY = 796;
      const w = 190 * s;
      const h = 150 * s;
      ctx.fillStyle = 'rgba(20,50,20,0.2)';
      ctx.beginPath();
      ctx.ellipse(x + 10, baseY + 2, w * 0.62, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a2a3a';
      ctx.fillRect(x - w * 0.36, baseY - h * 0.45, w * 0.72, h * 0.45);
      // Striped canopy
      const n = 8;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i % 2 === 0 ? stripe : '#fff4dc';
        ctx.beginPath();
        ctx.moveTo(x, baseY - h);
        ctx.lineTo(x - w / 2 + (w / n) * i, baseY - h * 0.42);
        ctx.lineTo(x - w / 2 + (w / n) * (i + 1), baseY - h * 0.42);
        ctx.closePath();
        ctx.fill();
      }
      // Scalloped valance
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i % 2 === 0 ? stripe : '#fff4dc';
        ctx.beginPath();
        ctx.arc(x - w / 2 + (w / n) * (i + 0.5), baseY - h * 0.42, w / n / 2, 0, Math.PI);
        ctx.fill();
      }
      const shade = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      shade.addColorStop(0, 'rgba(255,255,255,0.15)');
      shade.addColorStop(1, 'rgba(40,20,60,0.22)');
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.moveTo(x, baseY - h);
      ctx.lineTo(x - w / 2, baseY - h * 0.42);
      ctx.lineTo(x + w / 2, baseY - h * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6b4424';
      ctx.fillRect(x - 2, baseY - h - 34 * s, 4, 36 * s);
      ctx.fillStyle = stripe;
      ctx.beginPath();
      ctx.moveTo(x + 2, baseY - h - 34 * s);
      ctx.lineTo(x + 30 * s, baseY - h - 26 * s);
      ctx.lineTo(x + 2, baseY - h - 18 * s);
      ctx.fill();
    };
    tent(430, '#ff6b5e', 1);
    tent(1488, '#1fa5a0', 1);
    tent(560, '#8e5cd9', 0.7);
    tent(1360, '#f4b83b', 0.7);
    // The clearing: sunlit grass with a trodden tug lane.
    const edge = (x: number) => 792 + Math.sin(x * 0.013) * 3 + Math.sin(x * 0.041) * 2;
    const grass = ctx.createLinearGradient(0, 790, 0, 1080);
    grass.addColorStop(0, '#a8de6a');
    grass.addColorStop(0.35, '#7cc451');
    grass.addColorStop(1, '#4a9136');
    ctx.fillStyle = grass;
    ctx.beginPath();
    ctx.moveTo(0, 1080);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, edge(x));
    ctx.lineTo(W, 1080);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.filter = 'blur(9px)';
    ctx.fillStyle = 'rgba(214,176,112,0.75)';
    ctx.beginPath();
    ctx.ellipse(W / 2, GROUND_Y + 12, 900, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(236,206,146,0.5)';
    ctx.beginPath();
    ctx.ellipse(W / 2, GROUND_Y + 8, 820, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Pebbles and scuffs in the lane.
    for (let i = 0; i < 70; i++) {
      const x = rng.range(80, W - 80);
      const y = GROUND_Y + rng.range(-14, 34);
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(150,112,70,0.55)' : 'rgba(250,236,200,0.6)';
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(2, 5), rng.range(1.2, 2.6), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Chalk lines: centre (white) and the two win lines (team colours).
    const chalk = (x: number, color: string) => {
      ctx.save();
      ctx.filter = 'blur(1.2px)';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - 4, 800);
      ctx.lineTo(x + 4, 800);
      ctx.lineTo(x + 8, 870);
      ctx.lineTo(x - 8, 870);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    chalk(CENTER_X, 'rgba(255,255,255,0.8)');
    chalk(CENTER_X - WIN_DIST, 'rgba(255,190,110,0.85)');
    chalk(CENTER_X + WIN_DIST, 'rgba(170,176,255,0.85)');
    // Grass tufts along the back edge and blades in the foreground.
    for (let i = 0; i < 420; i++) {
      const x = rng.range(0, W);
      const y = edge(x) + rng.range(-2, 6);
      ctx.strokeStyle = rng.chance(0.5) ? '#b9ea7c' : '#8fcf5c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y + 4);
      ctx.lineTo(x + rng.range(-4, 4), y - rng.range(4, 10));
      ctx.stroke();
    }
    for (let i = 0; i < 520; i++) {
      const y = rng.range(870, 1075);
      const x = rng.range(0, W);
      const k = (y - 860) / 220;
      ctx.strokeStyle = rng.chance(0.55) ? 'rgba(60,120,40,0.55)' : 'rgba(170,225,110,0.55)';
      ctx.lineWidth = 1.5 + k * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + rng.range(-3, 3), y - 6 - k * 8, x + rng.range(-7, 7), y - 10 - k * 14);
      ctx.stroke();
    }
    // Wildflowers, bigger towards the camera.
    const petals = ['#ffffff', '#ffe27a', '#ff9ec2', '#c9a8ff', '#ffb46b'];
    for (let i = 0; i < 150; i++) {
      const y = rng.range(880, 1070);
      const x = rng.range(0, W);
      const k = 0.6 + ((y - 880) / 190) * 0.9;
      const r = 4.2 * k;
      ctx.fillStyle = 'rgba(40,90,30,0.35)';
      ctx.beginPath();
      ctx.ellipse(x + 2, y + r * 1.4, r * 1.6, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rng.pick(petals);
      for (let j = 0; j < 5; j++) {
        const a = (j / 5) * Math.PI * 2 + i;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8, r * 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#f4b83b';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    // Gentle darkening at the very bottom so the HUD-free foreground doesn't glare.
    const foot = ctx.createLinearGradient(0, 960, 0, 1080);
    foot.addColorStop(0, 'rgba(20,60,20,0)');
    foot.addColorStop(1, 'rgba(20,60,20,0.25)');
    ctx.fillStyle = foot;
    ctx.fillRect(0, 960, W, 120);
    tex.refresh();
  }

  /** Carved spiral totem (fallback marker), origin bottom-centre where it is lashed to the rope. */
  private ensureTotemTexture(): void {
    if (this.textures.exists('tt-totem')) return;
    const TW = 180;
    const TH = 270;
    const tex = this.textures.createCanvas('tt-totem', TW, TH);
    if (!tex) return;
    const ctx = tex.getContext();
    const cx = TW / 2;
    const ink = '#3b1f0c';
    const block = (y0: number, y1: number, w: number, paint: string) => {
      const grad = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
      grad.addColorStop(0, '#e2a86a');
      grad.addColorStop(0.45, '#b97a42');
      grad.addColorStop(1, '#7c4a24');
      ctx.fillStyle = grad;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, y0, w, y1 - y0, 16);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = paint;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2 + 3, y0 + 3, w - 6, 13, [13, 13, 3, 3]);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(cx - w / 2 + 7, y0 + 18, 5, y1 - y0 - 26);
    };
    const face = (y: number, mouth: 'grin' | 'o', paint: string) => {
      for (const dx of [-22, 22]) {
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.ellipse(cx + dx, y, 13, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff6e4';
        ctx.beginPath();
        ctx.ellipse(cx + dx, y, 9.5, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = paint;
        ctx.beginPath();
        ctx.arc(cx + dx + 2, y + 1, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#8a5530';
      ctx.beginPath();
      ctx.moveTo(cx, y + 2);
      ctx.lineTo(cx - 8, y + 18);
      ctx.lineTo(cx + 8, y + 18);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (mouth === 'grin') ctx.arc(cx, y + 20, 16, 0.15 * Math.PI, 0.85 * Math.PI);
      else ctx.ellipse(cx, y + 30, 8, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    };
    // Lashing peg at the bottom (sits on the rope).
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.roundRect(cx - 11, TH - 36, 22, 36, 6);
    ctx.fill();
    ctx.fillStyle = '#9a6536';
    ctx.beginPath();
    ctx.roundRect(cx - 7, TH - 34, 14, 30, 4);
    ctx.fill();
    // Wings on the middle block
    for (const d of [-1, 1]) {
      ctx.fillStyle = '#1fa5a0';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx + d * 44, 120);
      ctx.quadraticCurveTo(cx + d * 92, 104, cx + d * 86, 150);
      ctx.quadraticCurveTo(cx + d * 70, 160, cx + d * 44, 164);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + d * 52, 128);
      ctx.quadraticCurveTo(cx + d * 76, 124, cx + d * 78, 146);
      ctx.stroke();
    }
    block(168, TH - 30, 92, '#ff6b5e');
    face(196, 'grin', '#1fa5a0');
    block(100, 176, 100, '#1fa5a0');
    face(126, 'o', '#ff6b5e');
    // Spiral head
    const hy = TH - TH * TOTEM_HEAD;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(cx, hy, 47, 0, Math.PI * 2);
    ctx.fill();
    const disc = ctx.createRadialGradient(cx - 14, hy - 16, 6, cx, hy, 44);
    disc.addColorStop(0, '#fff0a8');
    disc.addColorStop(0.5, '#f4b83b');
    disc.addColorStop(1, '#b77a14');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(cx, hy, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7a4a0c';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const a = i * 0.21;
      const r = 3 + i * 0.58;
      const x = cx + Math.cos(a) * r;
      const y = hy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Leaf crest on top
    for (const [a, c] of [
      [-0.5, '#6cc24a'],
      [0, '#8bd346'],
      [0.5, '#6cc24a'],
    ] as [number, string][]) {
      ctx.save();
      ctx.translate(cx, hy - 42);
      ctx.rotate(a);
      ctx.fillStyle = c;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, -16, 8, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    tex.refresh();
  }
}

/** Team emblem: a curling wave (Tide) or a flame (Ember); `bg` is unused by the shapes but kept for callers. */
function drawEmblem(g: Phaser.GameObjects.Graphics, team: 0 | 1, x: number, y: number, r: number, _bg: number): void {
  if (team === 0) {
    g.fillStyle(0xe8fcff, 1);
    g.fillCircle(x, y, r);
    const pts: Pt[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      pts.push({ x: x - r + 2 * r * t, y: y + r * 0.02 - Math.sin(t * Math.PI * 2 + 0.6) * r * 0.24 });
    }
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI;
      pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
    }
    g.fillStyle(0x0e97b0, 1);
    g.fillPoints(pts, true);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(x - r * 0.42, y - r * 0.16, r * 0.16);
    g.fillCircle(x + r * 0.3, y + r * 0.2, r * 0.1);
    g.lineStyle(Math.max(2, r * 0.12), 0x06141a, 0.5);
    g.strokeCircle(x, y, r);
  } else {
    const flame = (s: number, color: number, dy: number) => {
      const pts: Pt[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = (i / 24) * Math.PI * 2;
        const sh = Math.sin(t / 2);
        pts.push({ x: x + r * s * Math.sin(t) * sh * sh * 1.05, y: y + dy - r * s * Math.cos(t) * 1.12 });
      }
      g.fillStyle(color, 1);
      g.fillPoints(pts, true);
    };
    flame(1.05, 0x6b1a14, 1);
    flame(1, 0xff6b3d, 0);
    flame(0.62, 0xffc94a, r * 0.28);
    g.fillStyle(0xfff4c0, 1);
    g.fillCircle(x, y + r * 0.55, r * 0.16);
  }
}
