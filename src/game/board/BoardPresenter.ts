import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { CAMERA_ZOOM, COLORS, CSS, PLAYER_COLORS } from '../constants';
import { CHARACTERS } from '../data/characters';
import { ITEMS, type ItemId } from '../data/items';
import type { Controls } from '../input/Controls';
import { input } from '../input/InputManager';
import { pickMinigame, availableMinigames, type MinigameResult } from '../minigames/MinigameManager';
import { saves } from '../save/SaveManager';
import { settings } from '../save/SettingsManager';
import type { MatchState, PlayerState } from '../state/MatchState';
import type { BonusAward, Placement } from '../state/scoring';
import { session } from '../state/Session';
import type { BoardScene } from '../scenes/BoardScene';
import { addText } from '../ui/theme';
import { centerOrigin } from '../util/spriteUtil';
import type { DialogLineSpec, EventPresentation, FlowIO, JumpKind, MinigameRewardView, PathOption, PreRollDecision, ShopOffer, TargetOption } from './flowTypes';
import type { BoardNodeDef } from './types';
import { registeredMinigames } from '../minigames/registry';
import { setDebugInfo } from '../debug/debug';

const EVENT_COLORS: Record<EventPresentation['kind'], number> = {
  festival: 0xff9a2e,
  mischief: 0x8e5cd9,
  board: 0x1fa5a0,
  global: 0xd6307a,
};

/** FlowIO for the real game: animations, camera and controller-driven menus. */
export class BoardPresenter implements FlowIO {
  private pendingAwards: BonusAward[] = [];

  constructor(private scene: BoardScene) {}

  private get state(): MatchState {
    return this.scene.state;
  }
  private get ui() {
    return this.scene.ui;
  }
  private get moves() {
    return this.scene.moves;
  }
  private get fx() {
    return this.scene.fx;
  }
  private get fast(): boolean {
    return this.state.config.speed === 'fast' || settings.get().gameSpeed === 'fast';
  }
  dur(ms: number): number {
    return Math.round(ms * (this.fast ? 0.6 : 1));
  }

  /** Controls of a human player (undefined for CPUs). */
  private controls(p: PlayerState): Controls | undefined {
    return !p.isCpu && session.isHuman(p.slot) ? input.controls(p.slot) : undefined;
  }

  private humanControls(): Controls[] {
    return this.state.players.filter((p) => !p.isCpu).map((p) => input.controls(p.slot));
  }

  private cpuThink(p: PlayerState, base = 500): Promise<void> {
    const level = p.cpuLevel === 'easy' ? 1.3 : p.cpuLevel === 'hard' ? 0.75 : 1;
    return this.ui.wait(this.dur(base * level));
  }

  /** World position → screen position (for UI effects that fly to the HUD). */
  private toScreen(x: number, y: number): { x: number; y: number } {
    const cam = this.scene.cameras.main;
    return { x: (x - cam.worldView.x) * cam.zoom, y: (y - cam.worldView.y) * cam.zoom };
  }

  // --- Rounds and turns ---------------------------------------------------------------------
  async roundStart(round: number, total: number, final: boolean): Promise<void> {
    this.ui.refresh(this.state);
    this.scene.board.refresh(this.state);
    if (final) return;
    await this.ui.banner({ title: `ROUND ${round} OF ${total}`, subtitle: round === 1 ? 'LET THE FESTIVAL BEGIN!' : `${total - round + 1} ROUNDS TO PLAY`, color: COLORS.teal, sound: 'fanfare', hold: this.dur(900) });
  }

  async finalRoundIntro(): Promise<void> {
    audio.playMusic('boardFinal');
    this.scene.bg.setIntensity(1);
    this.moves.setLightTint(true);
    await this.ui.banner({ title: 'FINAL ROUND', subtitle: 'THE FESTIVAL LIGHTS BLAZE!', color: COLORS.coral, sound: 'fanfare', hold: 1400, size: 110 });
    // Camera sweep across the board while everyone reacts.
    await this.scene.overview(this.dur(1400));
    this.state.players.forEach((p, i) => this.scene.time.delayedCall(i * 150, () => this.moves.token(p.slot).play(i % 2 ? 'surprised' : 'celebrate')));
    this.fx.confetti(this.scene.cameras.main.midPoint.x, this.scene.cameras.main.worldView.y + 200, 90);
    await this.ui.dialogLines(
      [
        { npc: 'ora', pose: 'flag', text: 'The final round is here! The festival lights are at full blaze!' },
        { npc: 'ora', pose: 'cheer', text: 'Gleam Spaces now pay 5 chips, event spaces sparkle with bonus chips, and the shops have one extra treasure!' },
      ],
      this.humanControls(),
      true,
    );
  }

  async turnStart(p: PlayerState): Promise<void> {
    this.moves.activeSlot = p.slot;
    this.moves.arrange(this.state);
    this.ui.hud.setActive(p.slot);
    this.ui.refresh(this.state);
    this.ui.setPrompts([]);
    const t = this.moves.token(p.slot);
    await this.scene.focus(t.x, t.y - 160, CAMERA_ZOOM.turn, this.dur(650));
    t.play('wave');
    await this.ui.turnBanner(p);
  }

  async turnEnd(p: PlayerState): Promise<void> {
    this.ui.setPrompts([]);
    this.moves.setCounter(p.slot, null);
    this.ui.refresh(this.state);
    await this.ui.wait(this.dur(250));
  }

  async preRollChoice(p: PlayerState, usable: ItemId[], cpu?: PreRollDecision): Promise<PreRollDecision> {
    const c = this.controls(p);
    if (!c) {
      await this.cpuThink(p, 450);
      if (cpu?.kind === 'item') await this.ui.itemRadial(p, usable, undefined, cpu.item);
      return cpu ?? { kind: 'roll' };
    }
    for (;;) {
      this.ui.setPrompts(
        [
          { button: 'A', label: 'Spin the Orbit Dial' },
          { button: 'Y', label: `Items (${p.items.length}/3)` },
          { button: 'VIEW', label: 'Scores' },
        ],
        p.slot,
      );
      setDebugInfo('awaitRoll', true);
      const b = await this.ui.waitButton(c, ['A', 'Y']);
      setDebugInfo('awaitRoll', false);
      this.ui.setPrompts([]);
      if (b === null || b === 'A') return { kind: 'roll' };
      const item = await this.ui.itemRadial(p, usable, c);
      if (item) return { kind: 'item', item };
    }
  }

  async chooseTarget<T>(p: PlayerState, prompt: string, options: TargetOption<T>[], cpu?: T): Promise<T | null> {
    const c = this.controls(p);
    const idx = await this.ui.listMenu({
      title: prompt,
      options: options.map((o) => ({ label: o.label, slot: o.slot })),
      controls: c,
      slot: p.slot,
      cpuIndex: cpu !== undefined ? options.findIndex((o) => o.value === cpu) : undefined,
      cancellable: !!c,
      onFocus: (i) => {
        const node = options[i]?.nodeId;
        if (node) {
          const pos = this.scene.board.pos(node);
          void this.scene.focus(pos.x, pos.y - 60, 0.8, 380);
        }
      },
    });
    const t = this.moves.token(p.slot);
    void this.scene.focus(t.x, t.y - 80, 0.95, 380);
    return idx === null ? null : options[idx].value;
  }

  async chooseDiscard(p: PlayerState, incoming: ItemId, cpu?: ItemId): Promise<ItemId> {
    const all = [...p.items, incoming];
    const idx = await this.ui.listMenu({
      title: 'Your bag is full!',
      subtitle: 'Choose one item to leave behind.',
      options: all.map((id, i) => ({ label: ITEMS[id].name + (i === all.length - 1 ? '  (new)' : ''), detail: ITEMS[id].description, icon: ITEMS[id].icon })),
      controls: this.controls(p),
      slot: p.slot,
      cpuIndex: cpu !== undefined ? all.lastIndexOf(cpu) : all.length - 1,
    });
    return all[idx ?? all.length - 1];
  }

  async spinDial(p: PlayerState, result: number, bonus: number): Promise<void> {
    const c = this.controls(p);
    const t = this.moves.token(p.slot);
    await this.scene.focus(t.x, t.y - 170, CAMERA_ZOOM.dial, this.dur(420));
    if (c) this.ui.setPrompts([{ button: 'A', label: 'Stop the Orbit Dial!' }], p.slot);
    // The dial takes the marker's place above the head while it spins.
    this.moves.setTagHidden(p.slot, true);
    await this.scene.dial.spin(t, result, bonus, {
      controls: c,
      cpuDelay: this.dur(p.cpuLevel === 'easy' ? 1100 : p.cpuLevel === 'hard' ? 650 : 850),
      fast: this.fast,
      color: PLAYER_COLORS[p.slot],
      waitForInput: (ctrl) =>
        this.ui.waitButton(ctrl, ['A']).then(() => {
          // Clear the prompt the moment the dial is stopped (the reveal animation follows).
          this.ui.setPrompts([]);
          return true;
        }),
    });
    this.ui.setPrompts([]);
    this.moves.setTagHidden(p.slot, false);
    if (c) c.rumble(0.35, 0.5, 90);
    this.moves.setCounter(p.slot, result + bonus);
    this.moves.showRoute(p.nodeId, result + bonus, PLAYER_COLORS[p.slot]);
    this.scene.followToken(p.slot);
  }

  async offerReroll(p: PlayerState, result: number, cpu?: boolean): Promise<boolean> {
    const idx = await this.ui.listMenu({
      title: `You spun a ${result}!`,
      subtitle: 'Eat your Spring Bean to spin again?',
      options: [
        { label: `Keep ${result}`, detail: 'Move now.' },
        { label: 'Re-spin!', detail: 'Uses your Spring Bean.', icon: ITEMS.spring_bean.icon },
      ],
      controls: this.controls(p),
      slot: p.slot,
      cpuIndex: cpu ? 1 : 0,
      width: 760,
    });
    return idx === 1;
  }

  async choosePath(p: PlayerState, at: string, options: PathOption[], cpu?: string): Promise<string> {
    const c = this.controls(p);
    const pos = this.scene.board.pos(at);
    this.scene.cameras.main.stopFollow();
    await this.scene.focus(pos.x, pos.y - 40, 0.9, this.dur(350));
    if (c) this.ui.setPrompts([{ button: 'STICK', label: 'Point at a path' }, { button: 'A', label: 'Go!' }], p.slot);
    const to = await this.scene.paths.choose(at, options, { controls: c, cpu, interrupted: () => this.scene.flowInterrupted(), fast: this.fast });
    this.ui.setPrompts([]);
    this.scene.followToken(p.slot);
    return to;
  }

  async shop(p: PlayerState, offer: ShopOffer, cpu?: ItemId | null): Promise<ItemId | null> {
    const npc = offer.shop.npc;
    const t = this.moves.token(p.slot);
    this.scene.board.npcPose(npc, npc === 'wrench' ? 'laugh' : 'wave');
    await this.scene.focus(t.x, t.y - 80, 1, this.dur(300));
    const c = this.controls(p);
    const idx = await this.ui.listMenu({
      title: offer.shop.name,
      subtitle: `You have ${p.chips} Gleam Chips · ${p.items.length}/3 items`,
      npc: { id: npc, pose: npc === 'wrench' ? 'gadget' : 'gift' },
      options: offer.items.map((it) => ({ label: ITEMS[it.id].name, detail: ITEMS[it.id].description, right: `${it.price}`, icon: ITEMS[it.id].icon, disabled: it.price > p.chips })),
      controls: c,
      slot: p.slot,
      cpuIndex: cpu ? offer.items.findIndex((i) => i.id === cpu) : -1,
      cancellable: true,
      cancelLabel: 'Just browsing',
      width: 1000,
    });
    this.scene.board.npcPose(npc, npc === 'wrench' ? 'tool' : 'wave');
    if (idx === null) return null;
    audio.play('shop');
    return offer.items[idx].id;
  }

  async offerRelic(p: PlayerState, price: number, cpu?: boolean): Promise<boolean> {
    const rp = this.scene.board.relicPos();
    this.scene.cameras.main.stopFollow();
    await this.scene.focus(rp.x, rp.y + 60, 1.05, this.dur(420));
    this.scene.board.keeperSprite().setFrame('26');
    const idx = await this.ui.listMenu({
      title: 'Prism Relic',
      subtitle: `Packsprout offers a Prism Relic for ${price} Gleam Chips. You have ${p.chips}.`,
      npc: { id: 'packsprout', pose: 'gift' },
      options: [
        { label: 'Buy the Prism Relic!', right: `${price}`, icon: { texture: 'prism-relic', scale: 0.5 } },
        { label: 'Not right now' },
      ],
      controls: this.controls(p),
      slot: p.slot,
      cpuIndex: cpu === false ? 1 : 0,
      width: 900,
    });
    this.scene.followToken(p.slot);
    return idx === 0;
  }

  // --- Movement --------------------------------------------------------------------------------
  async moveStep(p: PlayerState, from: string, to: string, remaining: number): Promise<void> {
    this.scene.followToken(p.slot);
    await this.moves.step(this.state, p, from, to, remaining);
  }

  async jumpTo(p: PlayerState, from: string, to: string, kind: JumpKind): Promise<void> {
    const dest = this.scene.board.pos(to);
    const src = this.scene.board.pos(from);
    this.scene.cameras.main.stopFollow();
    if (kind === 'portal' || kind === 'warp' || kind === 'guide') {
      await this.scene.focus(src.x, src.y - 80, 0.95, this.dur(300));
      const jump = this.moves.jump(this.state, p, from, to, kind);
      await this.ui.wait(this.dur(520));
      await this.scene.focus(dest.x, dest.y - 80, 0.95, this.dur(450));
      await jump;
    } else {
      const midX = (src.x + dest.x) / 2;
      const midY = (src.y + dest.y) / 2;
      const far = Math.hypot(dest.x - src.x, dest.y - src.y) > 900;
      void this.scene.focus(midX, midY - 80, far ? 0.62 : 0.85, this.dur(far ? 700 : 400));
      await this.moves.jump(this.state, p, from, to, kind);
    }
    this.scene.followToken(p.slot);
  }

  async landed(p: PlayerState, node: BoardNodeDef): Promise<void> {
    this.moves.settle(this.state, p);
    const colors: Record<string, number> = { gleam: 0x5ce1ff, festival: 0xffb050, mischief: 0xc49bff, event: 0xff8fa3, market: 0xffe08a, portal: 0x9bf2e8, relic: 0xffffff, start: 0x79dcd5 };
    this.scene.board.pulseNode(node.id, colors[node.type] ?? 0xffffff);
    audio.play('land', { volume: 0.7 });
    const c = this.controls(p);
    if (c) c.rumble(0.15, 0.25, 70);
    await this.ui.wait(this.dur(250));
  }

  async chips(p: PlayerState, delta: number, reason: string): Promise<void> {
    const t = this.moves.token(p.slot);
    const head = { x: t.x, y: t.y - 190 };
    if (delta > 0) {
      this.fx.floatText(head.x, head.y, `+${delta}`, CSS.goldLight, { size: 58 });
      audio.play('chipGain', { rate: reason === 'surge' ? 1.2 : 1 });
      if (reason !== 'parade' && reason !== 'minigame') t.play('coins');
      const s = this.toScreen(t.x, t.y - 90);
      const anchor = this.ui.hud.chipAnchor(p.slot);
      await this.scene.uiFx.chipsTo(s.x, s.y, anchor.x, anchor.y, Math.min(delta, 10), { scale: 0.22, onEach: () => audio.play('chipGain', { volume: 0.4, rate: 1.3, throttleMs: 40 }) });
    } else {
      this.fx.floatText(head.x, head.y, `${delta}`, '#ff8a80', { size: 58 });
      this.fx.scatterChips(t.x, t.y - 90, Math.min(-delta, 10));
      audio.play('chipLose');
      t.play('loseCoins');
      const c = this.controls(p);
      if (c) c.rumble(0.5, 0.3, 160);
      await this.ui.wait(this.dur(450));
    }
    this.ui.refresh(this.state);
  }

  async relicGained(p: PlayerState, source: 'purchase' | 'bonus'): Promise<void> {
    const t = this.moves.token(p.slot);
    const rp = this.scene.board.relicPos();
    const relic = this.scene.add.image(rp.x, rp.y, 'prism-relic').setScale(0.4).setDepth(9000);
    audio.play('relic');
    await new Promise<void>((r) =>
      this.scene.tweens.add({ targets: relic, x: t.x, y: t.y - 260, scale: 0.55, duration: 700, ease: 'Sine.InOut', onComplete: () => r() }),
    );
    t.play('victory');
    this.fx.confetti(t.x, t.y - 300, 120);
    this.fx.vfx('rainbowSwirl', t.x, t.y - 120, { scale: 1, blend: 'add', duration: 900 });
    this.fx.shake(0.004, 220);
    audio.play('fanfare');
    const c = this.controls(p);
    if (c) {
      c.rumble(0.7, 0.7, 150);
      this.scene.time.delayedCall(250, () => c.rumble(0.7, 0.7, 150));
    }
    await this.ui.banner({ title: 'PRISM RELIC!', subtitle: `${CHARACTERS[p.characterId].name.toUpperCase()} NOW HAS ${p.relics}`, color: PLAYER_COLORS[p.slot], sound: null, hold: 900 });
    const s = this.toScreen(relic.x, relic.y);
    relic.destroy();
    const anchor = this.ui.hud.relicAnchor(p.slot);
    const flyer = this.ui.add.image(s.x, s.y, 'prism-relic').setScale(0.45).setDepth(9000);
    await new Promise<void>((r) => this.ui.tweens.add({ targets: flyer, x: anchor.x, y: anchor.y, scale: 0.16, duration: 600, ease: 'Quad.In', onComplete: () => r() }));
    flyer.destroy();
    this.ui.refresh(this.state);
    void source;
  }

  async relicMoved(from: string, to: string): Promise<void> {
    const a = this.scene.board.pos(from);
    const b = this.scene.board.pos(to);
    this.scene.cameras.main.stopFollow();
    await this.scene.focus(a.x, a.y - 100, 0.9, this.dur(450));
    await this.scene.board.moveRelic(from, to).then(() => undefined);
    await this.scene.focus(b.x, b.y - 100, 0.9, this.dur(700));
    this.scene.board.keeperSprite().setFrame('27');
    this.fx.sparks(b.x, b.y - 150, 26);
    const region = this.scene.board.graph.node(to).metadata?.region ?? 'a new gate';
    await this.ui.dialogLines([{ npc: 'packsprout', pose: 'cheer', text: `I've carried the next Prism Relic to ${region}. Come and find me!` }], this.humanControls(), true);
    this.scene.board.keeperSprite().setFrame('26');
  }

  async item(p: PlayerState, item: ItemId, kind: 'gain' | 'use' | 'lose' | 'discard'): Promise<void> {
    const t = this.moves.token(p.slot);
    const def = ITEMS[item];
    const ic = def.icon;
    const img = ic.frame !== undefined ? this.scene.add.sprite(t.x, t.y - 250, ic.texture, ic.frame) : this.scene.add.image(t.x, t.y - 250, ic.texture);
    if (ic.frame !== undefined) {
      const o = centerOrigin(ic.texture, ic.frame);
      img.setOrigin(o.x, o.y);
      if (ic.anim) (img as Phaser.GameObjects.Sprite).play(ic.anim);
    }
    img.setDepth(9000).setScale(0.1);
    const label = addText(this.scene, t.x, t.y - 340, '', 34, { color: CSS.white, stroke: '#1b1530', strokeThickness: 7, weight: 700, fixed: true }).setDepth(9001);
    if (kind === 'gain') {
      label.setText(def.name);
      audio.play('itemGet');
      t.play('celebrate');
    } else if (kind === 'use') {
      label.setText(`${def.name}!`);
      audio.play('itemUse');
      this.fx.vfx('sparkle', t.x, t.y - 250, { scale: 0.7, blend: 'add' });
    } else if (kind === 'lose') {
      label.setText(`Dropped ${def.name}`);
      audio.play('chipLose');
      t.play('surprised');
    } else {
      label.setText(`Left ${def.name}`);
      audio.play('cancel');
    }
    await new Promise<void>((r) => this.scene.tweens.add({ targets: img, scale: ic.scale * 0.9, duration: 260, ease: 'Back.Out', onComplete: () => r() }));
    await this.ui.wait(this.dur(kind === 'use' ? 450 : 650));
    const endY = kind === 'lose' ? t.y + 100 : t.y - 400;
    await new Promise<void>((r) =>
      this.scene.tweens.add({
        targets: [img, label],
        alpha: 0,
        y: `+=${endY - (t.y - 250)}`,
        duration: 320,
        ease: 'Quad.In',
        onComplete: () => {
          img.destroy();
          label.destroy();
          r();
        },
      }),
    );
    this.ui.refresh(this.state);
  }

  async shield(p: PlayerState, kind: 'up' | 'block'): Promise<void> {
    const t = this.moves.token(p.slot);
    if (kind === 'up') {
      audio.play('shield');
      this.moves.setShield(p.slot, true);
      this.fx.vfx('starSwirl', t.x, t.y - 100, { scale: 0.7, blend: 'add' });
    } else {
      audio.play('pop');
      audio.play('shield');
      this.moves.setShield(p.slot, false);
      this.fx.vfx('impact', t.x, t.y - 110, { scale: 0.8, blend: 'add' });
      this.fx.floatText(t.x, t.y - 250, 'BLOCKED!', CSS.crystal, { size: 52 });
      t.play('celebrate');
    }
    this.ui.refresh(this.state);
    await this.ui.wait(this.dur(600));
  }

  async trap(kind: 'plant' | 'spring', nodeId: string, owner: number, victim?: PlayerState): Promise<void> {
    const pos = this.scene.board.pos(nodeId);
    if (kind === 'plant') {
      audio.play('pop');
      this.fx.vfx('leafSwirl', pos.x, pos.y - 30, { scale: 0.5 });
      this.scene.board.refresh(this.state);
      await this.ui.wait(this.dur(500));
      return;
    }
    const seed = this.scene.add.sprite(pos.x, pos.y - 20, 'items', '31').play('seed-trap').setScale(0.35).setDepth(pos.y + 5);
    audio.play('trap');
    this.fx.shake(0.004, 160);
    if (victim) this.moves.token(victim.slot).play('stunned');
    this.scene.board.refresh(this.state);
    await this.ui.dialogLines([{ npc: 'mimi', pose: 'surprised', text: `Snap! A Snare Seed planted by ${this.state.players.find((pl) => pl.slot === owner)?.name ?? 'a rival'}!` }], this.humanControls(), true);
    seed.destroy();
  }

  async event(e: EventPresentation): Promise<void> {
    const focusNode = e.focus ?? e.player?.nodeId;
    if (focusNode) {
      const pos = this.scene.board.pos(focusNode);
      this.scene.cameras.main.stopFollow();
      await this.scene.focus(pos.x, pos.y - 80, 0.85, this.dur(450));
    }
    audio.play('eventAlert');
    const sub = e.kind === 'festival' ? 'FESTIVAL SPACE' : e.kind === 'mischief' ? 'MISCHIEF SPACE' : e.kind === 'board' ? 'BOARD EVENT' : 'SURPRISE!';
    await this.ui.banner({ title: e.title, subtitle: sub, color: EVENT_COLORS[e.kind], sound: null, hold: this.dur(800), size: 88 });
    await this.scene.playEventFx(e.fx);
    if (e.lines.length) await this.ui.dialogLines(e.lines, this.humanControls(), true);
  }

  async say(lines: DialogLineSpec[]): Promise<void> {
    await this.ui.dialogLines(lines, this.humanControls(), true);
  }

  boardChanged(): void {
    this.scene.board.refresh(this.state);
    this.ui.refresh(this.state);
    for (const p of this.state.players) this.moves.setShield(p.slot, p.shielded);
  }

  // --- Minigames and the end ----------------------------------------------------------------------
  async playMinigame(): Promise<Placement[]> {
    const pool = availableMinigames(registeredMinigames());
    const info = pickMinigame(pool, this.state.minigameHistory, this.state.players.length, this.scene.ctx.rng);
    this.state.minigameHistory.push(info.id);
    this.moves.activeSlot = null;
    this.ui.hud.setActive(null);
    await this.scene.overview(this.dur(700));
    this.state.players.forEach((p) => this.moves.token(p.slot).play('celebrate'));
    await this.ui.banner({ title: 'MINIGAME TIME!', subtitle: 'EVERYONE GET READY', color: COLORS.purple, sound: 'fanfare', hold: 900 });
    const result = await this.scene.runMinigame(info.id);
    return result.placements;
  }

  async minigameRewards(rewards: MinigameRewardView[]): Promise<void> {
    this.ui.refresh(this.state);
    for (const r of rewards) {
      const p = this.state.players.find((pl) => pl.slot === r.slot);
      if (!p) continue;
      const t = this.moves.token(p.slot);
      this.fx.floatText(t.x, t.y - 190, `+${r.chips}`, CSS.goldLight, { size: 56 });
      if (r.place === 1) t.play('victory');
    }
    audio.play('chipGain');
    await this.ui.wait(this.dur(900));
  }

  async bonusAwards(awards: BonusAward[]): Promise<void> {
    this.pendingAwards = awards;
    await this.ui.banner({ title: 'THE FESTIVAL ENDS!', subtitle: 'TIME FOR THE BONUS AWARDS', color: COLORS.coral, sound: 'fanfare', hold: 1200 });
  }

  async finalResults(): Promise<void> {
    saves.clear();
    this.scene.finishMatch(this.pendingAwards);
  }

  save(state: MatchState): void {
    saves.save(state);
  }

  delay(ms: number): Promise<void> {
    return this.ui.wait(ms);
  }
}

export type { MinigameResult };
