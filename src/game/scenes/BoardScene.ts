import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { BoardManager } from '../board/BoardManager';
import { BoardPresenter } from '../board/BoardPresenter';
import { freshTurn, type FlowContext } from '../board/flowTypes';
import { MovementController } from '../board/MovementController';
import { OrbitDial } from '../board/OrbitDial';
import { PathChooser } from '../board/PathChooser';
import { runMatch } from '../board/TurnManager';
import { CAMERA_ZOOM, COLORS, CSS, GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { findBoard } from '../data/boards';
import { ITEM_IDS } from '../data/items';
import { clearDebugInfo, DEBUG_ENABLED, logError, setDebugInfo, URL_PARAMS } from '../debug/debug';
import { EffectsManager } from '../effects/EffectsManager';
import { applyGrade } from '../effects/GradePipeline';
import { input, type DeviceRef } from '../input/InputManager';
import { ItemManager } from '../items/ItemManager';
import { minigameInfo, type MinigameLaunch, type MinigameResult } from '../minigames/MinigameManager';
import { saves } from '../save/SaveManager';
import { settings } from '../save/SettingsManager';
import { isFinalRound, type MatchState } from '../state/MatchState';
import type { BonusAward } from '../state/scoring';
import { session } from '../state/Session';
import { drawPanel } from '../ui/Panel';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addText } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { Random } from '../util/Random';
import { standOrigin } from '../util/spriteUtil';
import type { BoardBgScene } from './BoardBgScene';
import type { BoardUIScene } from './BoardUIScene';

export interface BoardSceneData {
  intro?: boolean;
  continue?: boolean;
}

/** The board game: world, camera, and the running match flow. */
export class BoardScene extends Phaser.Scene {
  state!: MatchState;
  board!: BoardManager;
  moves!: MovementController;
  fx!: EffectsManager;
  ui!: BoardUIScene;
  bg!: BoardBgScene;
  dial!: OrbitDial;
  paths!: PathChooser;
  presenter!: BoardPresenter;
  ctx!: FlowContext;
  private data0: BoardSceneData = {};
  private offDebug: (() => void) | null = null;
  private running = false;
  private pauseOpen = false;

  constructor() {
    super('Board');
  }

  /** Screen-space effects live on the UI overlay. */
  get uiFx(): EffectsManager {
    return this.ui.fx;
  }

  init(data: BoardSceneData): void {
    this.data0 = data ?? {};
    this.running = false;
    this.pauseOpen = false;
  }

  create(): void {
    enterScene(this, 400);
    const def = findBoard('suncoil');
    if (!def) {
      goTo(this, 'Title');
      return;
    }
    const nodes = new Set(def.nodes.map((n) => n.id));
    let state: MatchState | null = session.match;
    if (this.data0.continue) {
      state = saves.load(nodes);
      if (state) this.rebuildSession(state);
    }
    if (!state) {
      goTo(this, 'Title');
      return;
    }
    session.match = state;
    session.mode = 'board';
    this.state = state;
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');
    this.scene.launch('BoardBg');
    this.scene.launch('BoardUI', { state });
    this.bg = this.scene.get('BoardBg') as BoardBgScene;
    this.ui = this.scene.get('BoardUI') as BoardUIScene;
    this.fx = new EffectsManager(this);
    this.board = new BoardManager(this, def);
    this.board.build(state);
    const dur = (ms: number) => Math.round(ms * (state.config.speed === 'fast' || settings.get().gameSpeed === 'fast' ? 0.6 : 1));
    this.moves = new MovementController(this, this.board, this.fx, dur);
    this.moves.createTokens(state);
    for (const p of state.players) this.moves.setShield(p.slot, p.shielded);
    this.dial = new OrbitDial(this, this.fx);
    this.paths = new PathChooser(this, this.board);
    this.presenter = new BoardPresenter(this);
    this.ctx = { state, board: state.board, graph: this.board.graph, rng: new Random(state.rng), io: this.presenter, turn: freshTurn(), interrupt: null };
    const cam = this.cameras.main;
    cam.setBounds(-400, -300, def.width + 800, def.height + 600);
    const ov = this.overviewRect();
    cam.centerOn(ov.centerX, ov.centerY);
    cam.setZoom(this.overviewZoom());
    // Lifted mid-tones on the board: the valley greens read fresh and sunny rather than murky.
    applyGrade(this, { gamma: 0.95, saturation: 1.1 });
    audio.playMusic(isFinalRound(state) ? 'boardFinal' : 'board');
    this.bg.setIntensity(isFinalRound(state) ? 1 : 0);
    this.moves.setLightTint(isFinalRound(state));
    if (DEBUG_ENABLED) this.offDebug = input.keyboard.onRawKey((e) => this.debugKey(e));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    // UI scene needs a frame to build before the flow starts.
    // ?noflow (debug): show the board without running the match (screenshots, art checks).
    if (DEBUG_ENABLED && URL_PARAMS.has('noflow')) return;
    this.time.delayedCall(60, () => void this.startFlow());
  }

  private rebuildSession(state: MatchState): void {
    session.resetSlots();
    for (const p of state.players) {
      const cfg = session.slots[p.slot];
      cfg.characterId = p.characterId;
      cfg.isCpu = p.isCpu;
      cfg.joined = !p.isCpu;
      cfg.cpuLevel = p.cpuLevel;
      cfg.device = input.slots[p.slot];
    }
  }

  private cleanup(): void {
    this.offDebug?.();
    this.offDebug = null;
    clearDebugInfo('board.');
    this.game.events.off('minigame:complete');
  }

  private async startFlow(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.ui.interruptCheck = () => this.ctx.interrupt !== null;
    try {
      await this.claimDevices();
      if (this.data0.intro && this.state.round === 1 && this.state.phase.kind === 'roundStart') await this.intro();
      await runMatch(this.ctx);
    } catch (err) {
      const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
      logError(`Board flow: ${msg}`);
      console.error('[Gleamtrail] board flow error', err);
    }
  }

  /** Continued matches: every human player grabs a controller (or the keyboard). */
  private async claimDevices(): Promise<void> {
    const need = this.state.players.filter((p) => !p.isCpu && !input.device(input.slots[p.slot]));
    if (need.length === 0) return;
    const root = this.ui.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(4000);
    const g = this.ui.add.graphics();
    const h = 220 + need.length * 90;
    drawPanel(g, -560, -h / 2, 1120, h, {});
    root.add([g, addText(this.ui, 0, -h / 2 + 60, 'Welcome back! Grab your controllers', 44, { color: CSS.tealDark, weight: 700 })]);
    const rows = new Map<number, Phaser.GameObjects.Text>();
    need.forEach((p, i) => {
      const y = -h / 2 + 150 + i * 90;
      root.add(new PlayerBadge(this.ui, -380, y, p.slot, 28));
      root.add(addText(this.ui, -330, y, `Player ${p.slot + 1} · ${p.name}`, 32, { color: CSS.ink, weight: 700, align: 'left' }));
      const status = addText(this.ui, 380, y, 'Press A / Enter', 28, { color: CSS.inkSoft, weight: 600, align: 'right' });
      rows.set(p.slot, status);
      root.add(status);
    });
    let idx = 0;
    await this.ui.poll(() => {
      for (const ref of input.devicesPressing('A')) {
        if (input.slotOf(ref) !== null) continue;
        const p = need[idx];
        input.assign(p.slot, ref as DeviceRef);
        session.slots[p.slot].device = ref;
        rows.get(p.slot)?.setText(ref.kind === 'keyboard' ? 'Keyboard ✓' : `Controller ${ref.index + 1} ✓`).setColor(CSS.tealDark);
        audio.play('join');
        idx++;
        if (idx >= need.length) return true;
      }
      return undefined;
    });
    input.lockHeld();
    await this.ui.wait(400);
    root.destroy();
  }

  private async intro(): Promise<void> {
    await this.overview(10);
    const humans = this.state.players.filter((p) => !p.isCpu).map((p) => input.controls(p.slot));
    const sweep = this.tweens.add({ targets: this.cameras.main, scrollX: '+=200', duration: 6000, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    await this.ui.banner({ title: 'SUNCOIL SANCTUARY', subtitle: 'WELCOME TO THE FESTIVAL', color: COLORS.teal, sound: 'fanfare', hold: 1400, size: 96 });
    await this.ui.dialogLines(
      [
        { npc: 'ora', pose: 'welcome', text: 'Welcome to Suncoil Sanctuary, adventurers! I\'m Ora, your festival guide.' },
        { npc: 'ora', pose: 'point', text: 'Spin the Orbit Dial to travel. Land on blue Gleam Spaces for chips, and watch out for purple Mischief!' },
        { npc: 'ora', pose: 'flag', text: 'Most Prism Relics wins the festival — Gleam Chips break ties. Press Y for items and VIEW for scores.' },
      ],
      humans,
      humans.length === 0,
    );
    sweep.stop();
    const rp = this.board.relicPos();
    await this.focus(rp.x, rp.y + 80, 0.95, 900);
    this.board.keeperSprite().setFrame('27');
    await this.ui.dialogLines([{ npc: 'packsprout', pose: 'cheer', text: 'Bring me 20 Gleam Chips and I\'ll trade you a Prism Relic! I move to a new gate after every sale.' }], humans, humans.length === 0);
    this.board.keeperSprite().setFrame('26');
    await this.overview(900);
  }

  // --- Camera -------------------------------------------------------------------------------------
  /** Board area the overview shot frames: every space plus room for tall landmarks above. */
  overviewRect(): Phaser.Geom.Rectangle {
    // Every space (with room for the island rims and undersides) plus every landmark sprite.
    const b = this.board.bounds();
    let x0 = b.x - 170;
    let y0 = b.y - 150;
    let x1 = b.right + 170;
    let y1 = b.bottom + 240;
    for (const d of this.board.decorations.values()) {
      const g = (d as unknown as Phaser.GameObjects.Image).getBounds?.();
      if (!g) continue;
      x0 = Math.min(x0, g.x - 30);
      y0 = Math.min(y0, g.y - 30);
      x1 = Math.max(x1, g.right + 30);
      y1 = Math.max(y1, g.bottom + 30);
    }
    return new Phaser.Geom.Rectangle(x0, y0, x1 - x0, y1 - y0);
  }

  overviewZoom(): number {
    const r = this.overviewRect();
    return Math.min(GAME_WIDTH / r.width, GAME_HEIGHT / r.height);
  }

  focus(x: number, y: number, zoom = 0.95, ms = 600): Promise<void> {
    const cam = this.cameras.main;
    cam.stopFollow();
    const reduced = settings.get().reducedMotion;
    const d = reduced ? Math.min(ms, 250) : ms;
    if (d <= 20) {
      cam.centerOn(x, y);
      cam.setZoom(zoom);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      cam.pan(x, y, d, 'Sine.easeInOut', true);
      cam.zoomTo(zoom, d, 'Sine.easeInOut', true);
      this.time.delayedCall(d + 10, () => resolve());
    });
  }

  overview(ms = 900): Promise<void> {
    const b = this.board.bounds();
    const r = this.overviewRect();
    void b;
    return this.focus(r.centerX, r.centerY, this.overviewZoom(), ms);
  }

  followToken(slot: number): void {
    const cam = this.cameras.main;
    const t = this.moves.token(slot);
    if (Math.abs(cam.zoom - CAMERA_ZOOM.follow) > 0.02) cam.zoomTo(CAMERA_ZOOM.follow, 350, 'Sine.easeInOut', true);
    cam.startFollow(t, false, 0.1, 0.1, 0, 150);
  }

  flowInterrupted(): boolean {
    return this.ctx.interrupt !== null;
  }

  // --- Event effects --------------------------------------------------------------------------------
  async playEventFx(fx?: string): Promise<void> {
    if (!fx) return;
    const s = this;
    const deco = (id: string) => this.board.decorations.get(id) as Phaser.GameObjects.Sprite | undefined;
    const wait = (ms: number) => new Promise<void>((r) => s.time.delayedCall(ms, () => r()));
    switch (fx) {
      case 'bridge-break': {
        const bridge = this.board.def.bridges[0];
        const mid = this.board.pos(bridge.nodes[1]);
        await this.focus(mid.x, mid.y, 0.85, 400);
        audio.play('crack');
        this.fx.shake(0.01, 400);
        const spr = this.add.sprite(mid.x, mid.y + 40, 'props', '0').play('bridge-break');
        const o = standOrigin('props', '0');
        spr.setOrigin(o.x, o.y).setScale(0.7).setDepth(mid.y + 100);
        for (let i = 0; i < 8; i++) {
          const plank = this.add.image(mid.x + (i - 4) * 40, mid.y, 'bridge-plank').setDepth(mid.y + 90).setAngle(90);
          this.tweens.add({ targets: plank, y: mid.y + 700, angle: 90 + (i % 2 ? 200 : -200), alpha: 0, duration: 1200 + i * 60, ease: 'Quad.In', onComplete: () => plank.destroy() });
        }
        await wait(700);
        this.tweens.add({ targets: spr, alpha: 0, y: '+=200', duration: 500, onComplete: () => spr.destroy() });
        audio.play('rumble');
        break;
      }
      case 'bridge-repair': {
        audio.play('itemUse');
        const mid = this.board.pos(this.board.def.bridges[0].nodes[1]);
        this.fx.sparks(mid.x, mid.y, 30);
        this.fx.vfx('goldSwirl', mid.x, mid.y - 40, { scale: 1, blend: 'add' });
        await wait(500);
        break;
      }
      case 'surge': {
        const gen = deco('crystal-gen');
        if (gen) {
          this.fx.vfx('electric', gen.x, gen.y - 120, { scale: 0.9, blend: 'add' });
          this.tweens.add({ targets: gen, scale: gen.scale * 1.08, duration: 120, yoyo: true, repeat: 3 });
        }
        audio.play('portal');
        await wait(700);
        break;
      }
      case 'wind': {
        audio.play('whoosh');
        const cam = this.cameras.main;
        for (let i = 0; i < 5; i++) {
          this.time.delayedCall(i * 120, () => this.fx.vfx('waterStreak', cam.worldView.x + Phaser.Math.Between(200, cam.worldView.width - 200), cam.worldView.y + Phaser.Math.Between(200, cam.worldView.height - 200), { scale: 1, tint: 0xffffff, alpha: 0.8, dx: 300 }));
        }
        await wait(600);
        break;
      }
      case 'portal-storm': {
        audio.play('portal');
        for (const id of Object.keys(this.state.board.portalLinks)) {
          const p = this.board.pos(id);
          this.fx.vfx('electric', p.x, p.y - 80, { scale: 0.7, blend: 'add' });
        }
        this.fx.shake(0.004, 300);
        await wait(700);
        break;
      }
      case 'cannon': {
        const c = deco('cannon');
        if (c) c.play('cannon-fire');
        await wait(300);
        break;
      }
      case 'bouncy': {
        for (const id of ['spring-gi0', 'spring-gi1', 'spring-gi2']) deco(id)?.play('spring-launch');
        audio.play('bounce');
        await wait(400);
        break;
      }
      case 'log': {
        const log = deco('log');
        if (log) {
          log.play('log-roll');
          const start = { x: log.x, y: log.y };
          const path = ['d6', 'd5', 'd4', 'd3', 'd2'].map((id) => this.board.pos(id)).reverse();
          audio.play('rumble');
          for (const pt of path) {
            await new Promise<void>((r) => this.tweens.add({ targets: log, x: pt.x, y: pt.y - 30, duration: 260, onComplete: () => r() }));
            this.fx.vfx('dust', pt.x, pt.y - 10, { scale: 0.4 });
          }
          log.stop();
          log.setPosition(start.x, start.y);
        }
        break;
      }
      case 'parade': {
        audio.play('cheer');
        const cam = this.cameras.main;
        for (let i = 0; i < 4; i++) this.time.delayedCall(i * 200, () => this.fx.confetti(cam.worldView.x + cam.worldView.width * (0.2 + i * 0.2), cam.worldView.y + 150, 60));
        this.board.npcPose('mimi', 'laugh');
        await wait(600);
        this.board.npcPose('mimi', 'happy');
        break;
      }
      case 'lanterns': {
        const cam = this.cameras.main;
        for (let i = 0; i < 6; i++) {
          const l = this.add.image(cam.midPoint.x + (i - 3) * 110, cam.worldView.bottom, 'lantern').setScale(0.6).setDepth(8000);
          this.tweens.add({ targets: l, y: cam.worldView.y - 100, duration: 1800 + i * 150, ease: 'Sine.Out', onComplete: () => l.destroy() });
        }
        await wait(500);
        break;
      }
      default: {
        const cam = this.cameras.main;
        this.fx.vfx(fx === 'swap' ? 'tornado' : fx === 'topsy' ? 'pinkSwirl' : fx === 'drop' || fx === 'leak' ? 'smoke' : 'sparkle', cam.midPoint.x, cam.midPoint.y, { scale: 0.9, blend: fx === 'drop' || fx === 'leak' ? 'normal' : 'add' });
        await wait(300);
      }
    }
  }

  // --- Minigames & match end ---------------------------------------------------------------------------
  runMinigame(id: string): Promise<MinigameResult> {
    const info = minigameInfo(id)!;
    const launch: MinigameLaunch = {
      id: info.id,
      players: this.state.players.map((p) => ({ slot: p.slot, characterId: p.characterId, isCpu: p.isCpu, cpuLevel: p.cpuLevel })),
      mode: 'board',
      seed: Math.floor(this.ctx.rng.next() * 4294967296),
      instructions: this.state.config.instructions,
    };
    return new Promise((resolve) => {
      this.game.events.once('minigame:complete', (result: MinigameResult) => {
        this.scene.wake('BoardBg');
        this.scene.wake('BoardUI');
        this.scene.wake('Board');
        enterScene(this, 400);
        audio.playMusic(isFinalRound(this.state) ? 'boardFinal' : 'board');
        this.ui.refresh(this.state);
        resolve(result);
      });
      this.cameras.main.fadeOut(300, 13, 59, 71);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.sleep('BoardUI');
        this.scene.sleep('BoardBg');
        this.scene.run('MinigameIntro', launch);
        this.scene.sleep();
      });
    });
  }

  finishMatch(awards: BonusAward[]): void {
    const state = this.state;
    this.cameras.main.fadeOut(500, 13, 59, 71);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop('BoardUI');
      this.scene.stop('BoardBg');
      this.scene.start('FinalResults', { state, awards });
    });
  }

  // --- Frame --------------------------------------------------------------------------------------------
  override update(_t: number, _delta: number): void {
    if (!this.moves) return;
    this.board.scaleForZoom(this.cameras.main.zoom);
    this.moves.update();
    if (!this.running || this.pauseOpen) return;
    // Scoreboard while VIEW is held (any human).
    const humans = this.state.players.filter((p) => !p.isCpu).map((p) => input.controls(p.slot));
    const viewHeld = humans.some((c) => c.held('VIEW'));
    if (viewHeld && !this.ui.scoreboardOpen) this.ui.showScoreboard(this.state);
    else if (!viewHeld && this.ui.scoreboardOpen) this.ui.hideScoreboard();
    // Pause (the player who pressed Menu owns the pause menu).
    for (const p of this.state.players) {
      if (!p.isCpu && input.controls(p.slot).pressed('MENU')) {
        this.openPause(p.slot);
        break;
      }
    }
    const active = this.state.phase.kind === 'turn' ? this.state.players[this.state.phase.index] : null;
    setDebugInfo('board.round', `${this.state.round}/${this.state.config.rounds} (${this.state.phase.kind})`);
    setDebugInfo('board.seed', this.state.config.seed);
    if (active) {
      const t = this.moves.token(active.slot);
      setDebugInfo('board.player', `${active.name} @ ${active.nodeId} (${Math.round(t.x)}, ${Math.round(t.y)}) chips ${active.chips}`);
    }
    setDebugInfo('board.relic', this.state.board.relicGate);
  }

  private openPause(owner: number): void {
    this.pauseOpen = true;
    audio.play('pause');
    this.scene.pause('BoardUI');
    this.scene.pause();
    this.scene.launch('Pause', { owner, from: 'Board' });
    const pause = this.scene.get('Pause');
    pause.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.pauseOpen = false;
      if (this.scene.isPaused('BoardUI')) this.scene.resume('BoardUI');
      if (this.scene.isPaused()) this.scene.resume();
      input.lockHeld();
    });
  }

  // --- Debug ----------------------------------------------------------------------------------------------
  private debugKey(e: KeyboardEvent): void {
    if (!this.sys.isActive()) return;
    const keys = ['F3', 'F4', 'F5', 'F6', 'F7', 'F8'];
    if (!keys.includes(e.code)) return;
    e.preventDefault();
    const s = this.state;
    const active = s.phase.kind === 'turn' ? s.players[s.phase.index] : s.players[0];
    switch (e.code) {
      case 'F3':
        this.ctx.interrupt = 'skipTurn';
        break;
      case 'F4':
        this.ctx.interrupt = 'minigame';
        break;
      case 'F5':
        active.chips += 20;
        this.ui.refresh(s);
        this.fx.floatText(this.moves.token(active.slot).x, this.moves.token(active.slot).y - 200, '+20 (debug)', CSS.goldLight);
        break;
      case 'F6': {
        const id = ITEM_IDS[Math.floor(Math.random() * ITEM_IDS.length)];
        if (!ItemManager.add(active, id)) active.items[0] = id;
        this.ui.refresh(s);
        break;
      }
      case 'F7': {
        active.nodeId = s.board.relicGate;
        active.trail = [];
        this.moves.arrange(s, true);
        break;
      }
      case 'F8':
        this.ctx.interrupt = 'finishRound';
        break;
    }
  }
}
