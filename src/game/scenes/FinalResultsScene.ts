import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { animHeadTop, Character } from '../characters/Character';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { findBoard } from '../data/boards';
import { CHARACTERS } from '../data/characters';
import { EffectsManager } from '../effects/EffectsManager';
import { input } from '../input/InputManager';
import { LITE } from '../perf';
import { saves } from '../save/SaveManager';
import { settings } from '../save/SettingsManager';
import { createMatch, type MatchState, type PlayerState } from '../state/MatchState';
import { BONUSES, computeStandings, type BonusAward } from '../state/scoring';
import { session } from '../state/Session';
import { onSceneUpdate } from '../util/sceneEvents';
import { Confetti, Fireworks, godRays, Spotlight, stageDressing, winnerBanner } from '../ui/Celebration';
import { PromptBar } from '../ui/ControllerPrompt';
import { TitleLockup } from '../ui/Lockup';
import { Menu } from '../ui/Menu';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addPortrait } from '../ui/Portrait';
import { drawRibbon, shade, strokeTopEdge, UI } from '../ui/Style';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { randomSeed } from '../util/Random';
import { addStrip } from '../ui/Screen';
import { drawPodium, medalY, PODIUM_BASE, PODIUM_H, PODIUM_X } from './ResultsScene';

/** The presentation panel for the awards and the tally: a navy stage card with a gold rim. */
const CARD = { x: 230, y: 200, w: 1460, h: 660 };

function css(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function ordinal(n: number): string {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}

/**
 * The festival's closing ceremony: bonus awards revealed one at a time under sweeping spotlights,
 * the final tally, then the podium: the runners-up take their places, a drumroll, the lights
 * converge and the winner drops in in slow motion to a fanfare, fireworks and confetti. Never
 * auto-skips the celebration for human players.
 */
export class FinalResultsScene extends Phaser.Scene {
  private state!: MatchState;
  private awards: BonusAward[] = [];
  private fx!: EffectsManager;
  /** Per-phase card art (under the spotlights)… */
  private layer!: Phaser.GameObjects.Container;
  /** …and the figures and numbers on it (over the spotlights, so light never washes them out). */
  private front!: Phaser.GameObjects.Container;
  private menu?: Menu;
  private prompt!: PromptBar;
  private veil!: Phaser.GameObjects.Rectangle;
  private spots: Spotlight[] = [];
  private confetti!: Confetti;
  private fireworks!: Fireworks;
  private renderedStage = false;
  private title?: TitleLockup;

  constructor() {
    super('FinalResults');
  }

  init(data: { state: MatchState; awards: BonusAward[] }): void {
    this.state = data.state;
    this.awards = data.awards ?? [];
    this.menu = undefined;
    this.spots = [];
    this.title = undefined;
  }

  create(): void {
    enterScene(this, 500);
    audio.playMusic('final');
    this.fx = new EffectsManager(this, 800);
    this.buildStage();
    // A navy veil dims the stage while the awards and the tally are presented over it.
    this.veil = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x06141a, 0.55).setOrigin(0).setDepth(5);
    // Three spotlights hung above the stage (warm white; the middle one a touch gold). They light
    // whatever is presented, so they draw over the cards and the figures.
    this.spots = [
      new Spotlight(this, 180, -140, 0xfff2d8, 21),
      new Spotlight(this, GAME_WIDTH / 2, -200, 0xffe7a8, 21, 280),
      new Spotlight(this, GAME_WIDTH - 180, -140, 0xfff2d8, 21),
    ];
    this.spots.forEach((l, i) => l.aim(GAME_WIDTH / 2 + (i - 1) * 300, 700));
    this.layer = this.add.container(0, 0).setDepth(20);
    this.front = this.add.container(0, 0).setDepth(22);
    const leader = computeStandings(this.state.players)[0];
    this.confetti = new Confetti(this, 60, leader ? PLAYER_COLORS[leader.slot] : undefined);
    this.fireworks = new Fireworks(this, 6);
    this.prompt = new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 36, [], { size: 38, fontSize: 26 }).setDepth(100);
    void this.sequence();
  }

  /** Dusk over the podium stage (the rendered one when all four play). */
  private buildStage(): void {
    const sky = ['rendered-sky-dusk', 'rendered-sky-sunset', 'rendered-sky-golden', 'rendered-sky-day'].find((k) => this.textures.exists(k));
    if (sky) this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, sky).setDisplaySize(GAME_WIDTH * 1.05, GAME_HEIGHT * 1.05).setDepth(-10);
    else {
      this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-10);
      addStrip(this, 0, 640, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setDepth(-10);
    }
    // Evening falls: a soft navy gradient from the top so the lights and fireworks glow.
    const dusk = this.add.graphics().setDepth(-9);
    dusk.fillGradientStyle(0x0a1a3a, 0x0a1a3a, 0x0a1a3a, 0x0a1a3a, 0.45, 0.45, 0, 0);
    dusk.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT * 0.7);
    this.renderedStage = this.state.players.length === 4 && this.textures.exists('rendered-scene-results');
    if (this.renderedStage) {
      this.add.image(0, 0, 'rendered-scene-results').setOrigin(0).setDepth(-8);
      // Under the veil, so the award and tally cards sit cleanly on top of it.
      stageDressing(this, 4);
    }
  }

  private humans(): number[] {
    return this.state.players.filter((p) => !p.isCpu).map((p) => p.slot);
  }

  private player(slot: number): PlayerState {
    return this.state.players.find((p) => p.slot === slot)!;
  }

  /** Wait for any human to press A (or a timeout when everyone is a CPU). */
  private advance(autoMs: number): Promise<void> {
    const humans = this.humans();
    this.prompt.setPrompts(humans.length ? [{ button: 'A', label: 'Continue' }] : []);
    input.lockHeld();
    return new Promise((resolve) => {
      let t = 0;
      const tick = (_time: number, dt: number) => {
        t += dt;
        const pressed = humans.some((s) => input.controls(s).pressed('A')) || (humans.length === 0 && input.any.pressed('A'));
        if (pressed || (humans.length === 0 && t > autoMs)) {
          stop();
          this.prompt.setPrompts([]);
          audio.play('confirm');
          resolve();
        }
      };
      const stop = onSceneUpdate(this, tick);
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => this.time.delayedCall(ms, () => r()));
  }

  private clear(): void {
    this.layer.removeAll(true);
    this.front.removeAll(true);
  }

  private setTitle(text: string): void {
    this.title?.destroy();
    this.title = new TitleLockup(this, GAME_WIDTH / 2, 104, text, { size: 88 });
    this.title.setDepth(30);
    const t = this.title;
    void t.play(0, 34).then(() => t.active && t.waveEvery(5200, 2200));
  }

  /** A drumroll that builds (chained rolls, the lights sweeping faster). */
  private drumroll(rolls: number): void {
    for (let i = 0; i < rolls; i++) this.time.delayedCall(i * 1000, () => audio.play('drumroll'));
  }

  /** Sweep the lights back and forth across a band of x positions until `until` resolves. */
  private sweepLights(xs: number[], y: number, stepMs: number, until: Promise<void>): void {
    let live = true;
    void until.then(() => (live = false));
    const step = (i: number) => {
      if (!live || !this.sys.isActive()) return;
      this.spots.forEach((l, k) => l.sweepTo(Phaser.Utils.Array.GetRandom(xs) + (k - 1) * 40, y + Phaser.Math.Between(-30, 30), stepMs * 0.9));
      this.time.delayedCall(stepMs, () => step(i + 1));
    };
    step(0);
  }

  private async sequence(): Promise<void> {
    this.setTitle('FESTIVAL AWARDS');
    audio.play('fanfare');
    await this.wait(900);
    for (const award of this.awards) {
      await this.showAward(award);
      await this.advance(3500);
      this.spots.forEach((l) => l.light(false, 200));
      this.clear();
    }
    this.setTitle('FINAL TALLY');
    await this.showTally();
    await this.advance(4500);
    this.clear();
    this.title?.destroy();
    this.title = undefined;
    await this.showPodium();
  }

  // --- The presentation card -----------------------------------------------------------------------
  /** Navy stage card with a gold rim and a ribbon header carrying `heading`. */
  private stageCard(heading: string, color: number = COLORS.gold, h = CARD.h): void {
    const { x, y, w } = CARD;
    const g = this.add.graphics();
    g.fillStyle(0x03080f, 0.35);
    g.fillRoundedRect(x + 6, y + 12, w, h, 34);
    g.fillStyle(UI.slate, 0.94);
    g.fillRoundedRect(x, y, w, h, 34);
    g.fillStyle(0xffffff, 0.04);
    g.fillRoundedRect(x, y, w, h * 0.45, { tl: 34, tr: 34, bl: 0, br: 0 });
    g.lineStyle(4, COLORS.gold, 1);
    g.strokeRoundedRect(x + 2, y + 2, w - 4, h - 4, 32);
    strokeTopEdge(g, x, y, w, 34, 8, 2, 0xffffff, 0.25);
    drawRibbon(g, GAME_WIDTH / 2, y + 8, Math.min(w - 200, heading.length * 34 + 220), 70, color, { tail: 50 });
    this.layer.add(g);
    const dark = color === COLORS.gold ? '#6b4308' : css(shade(color, 0.35));
    this.layer.add(addText(this, GAME_WIDTH / 2, y + 7, heading, 40, { color: '#ffffff', weight: 700, fixed: true }).setShadow(0, 3, dark, 0, false, true));
  }

  // --- Bonus award ---------------------------------------------------------------------------------
  private async showAward(award: BonusAward): Promise<void> {
    const def = BONUSES[award.id];
    this.stageCard(def.name.toUpperCase());
    this.layer.add(addText(this, GAME_WIDTH / 2, CARD.y + 78, def.description, 30, { color: CSS.cream, weight: 600 }));
    const flipIn = this.layer.list.slice();
    if (!settings.get().reducedMotion) {
      for (const o of flipIn) {
        const t = o as unknown as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.AlphaSingle;
        t.setAlpha(0);
        this.tweens.add({ targets: o, alpha: 1, duration: 240 });
      }
    }
    audio.play('drumroll');
    const n = this.state.players.length;
    const floorY = CARD.y + 490;
    const K = 0.9;
    const cols = this.state.players.map((p, i) => {
      const x = GAME_WIDTH / 2 + (i - (n - 1) / 2) * 330;
      const disc = this.add.graphics();
      disc.fillStyle(PLAYER_COLORS[p.slot], 0.22);
      disc.fillEllipse(x, floorY, 210, 52);
      disc.lineStyle(4, PLAYER_COLORS[p.slot], 0.9);
      disc.strokeEllipse(x, floorY, 210, 52);
      const glow = this.add.image(x, floorY - 90, 'fx-dot').setScale(16, 13).setTint(COLORS.goldLight).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      const c = new Character(this, x, floorY, p.characterId, { scale: K });
      const badge = new PlayerBadge(this, x - 100, floorY + animHeadTop(p.characterId) * K + 16, p.slot, 22);
      const valText = addTitle(this, x, floorY + 62, '0', 58, '#ffffff');
      const unit = addText(this, x, floorY + 102, def.unit.toUpperCase(), 20, { color: CSS.creamDark, weight: 700 });
      const name = addText(this, x, floorY + 134, CHARACTERS[p.characterId].short.toUpperCase(), 22, { color: '#ffffff', weight: 700 });
      this.layer.add([glow, disc]);
      this.front.add([c, badge, valText, unit, name]);
      const val = award.values.find((v) => v.slot === p.slot)?.value ?? 0;
      return { p, x, c, val, valText, glow };
    });
    // Lights sweep over the contenders while the counters run.
    this.spots.forEach((l) => l.light(true, 300, 0.8));
    const counted = this.wait(1350);
    this.sweepLights(cols.map((c) => c.x), floorY, 420, counted);
    for (const col of cols) this.countUp(col.valText, col.val, 1100);
    await counted;
    if (award.winners.length === 0) {
      const none = addText(this, GAME_WIDTH / 2, CARD.y + 124, 'Nobody earned this one!', 36, { color: CSS.coral, weight: 700 });
      this.layer.add(none);
      this.spots.forEach((l) => l.light(false, 300));
      audio.play('defeat', { volume: 0.5 });
      return;
    }
    audio.play('cymbal');
    audio.play('relic');
    const winCols = cols.filter((c) => award.winners.includes(c.p.slot));
    // Every light snaps onto a winner.
    this.spots.forEach((l, k) => {
      const wc = winCols[k % winCols.length];
      l.sweepTo(wc.x + (k - 1) * 18, floorY, 180, 'Cubic.Out');
      l.light(true, 150, 1.1);
    });
    for (const col of cols) {
      const won = award.winners.includes(col.p.slot);
      if (won) {
        this.tweens.add({ targets: col.glow, alpha: 0.32, duration: 260 });
        col.c.play('victory');
        this.tweens.add({ targets: col.valText, scale: { from: 1.6, to: 1.15 }, duration: 320, ease: 'Back.Out' });
        col.valText.setColor(CSS.goldLight);
        // The relic flies down from the ribbon to above the winner.
        const relic = this.add.image(GAME_WIDTH / 2, CARD.y + 8, 'prism-relic').setScale(0.08);
        this.front.add(relic);
        const top = floorY + animHeadTop(col.p.characterId) * K - 60;
        this.tweens.add({ targets: relic, x: col.x, y: top, scale: 0.32, duration: 520, ease: 'Cubic.Out' });
        if (!settings.get().reducedMotion) this.tweens.add({ targets: relic, y: top - 12, duration: 900, delay: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
        const plus = addTitle(this, col.x, top - 68, '+1 RELIC', 30, CSS.goldLight);
        plus.setScale(0.3);
        this.tweens.add({ targets: plus, scale: 1, duration: 300, delay: 420, ease: 'Back.Out' });
        this.front.add(plus);
        this.fx.sparks(col.x, top, LITE ? 12 : 24);
        this.confetti.rain(22);
        if (!col.p.isCpu) input.rumbleSlot(col.p.slot, 0.6, 0.6, 180);
      } else {
        col.c.play('disappointed');
        col.c.setAlpha(0.72);
      }
    }
    const names = award.winners.map((s) => CHARACTERS[this.player(s).characterId].name).join(' & ');
    const who = addText(this, GAME_WIDTH / 2, CARD.y + 124, award.winners.length > 1 ? `Tie! ${names} each earn a Prism Relic` : `${names} earns a Prism Relic!`, 32, { color: CSS.goldLight, weight: 700 });
    who.setScale(0.6);
    this.tweens.add({ targets: who, scale: 1, duration: 260, ease: 'Back.Out' });
    this.layer.add(who);
  }

  /** Count a text up to `target` with a soft tick per step. */
  private countUp(t: Phaser.GameObjects.Text, target: number, ms: number): void {
    const holder = { v: 0 };
    let shown = 0;
    this.tweens.add({
      targets: holder,
      v: target,
      duration: ms,
      ease: 'Quad.Out',
      onUpdate: () => {
        const v = Math.round(holder.v);
        if (v === shown) return;
        shown = v;
        t.setText(String(v));
        audio.play('dialTick', { rate: 0.9 + Math.min(0.8, v * 0.02), volume: 0.45, throttleMs: 45 });
      },
      onComplete: () => t.setText(String(target)),
    });
  }

  // --- Tally ---------------------------------------------------------------------------------------
  private async showTally(): Promise<void> {
    const players = this.state.players;
    const bonus = (slot: number) => this.awards.filter((a) => a.winners.includes(slot)).length;
    const rowH = 118;
    const h = 180 + players.length * rowH;
    this.stageCard('THE FINAL COUNT', COLORS.teal, h);
    const heads = ['Gleam Chips', 'Board Relics', 'Bonus Relics', 'Total Relics'];
    const colX = [880, 1100, 1320, 1540];
    heads.forEach((hname, i) => this.layer.add(addText(this, colX[i], CARD.y + 88, hname.toUpperCase(), 22, { color: i === 3 ? CSS.goldLight : CSS.creamDark, weight: 700 })));
    const rows = players.map((p, i) => {
      const y = CARD.y + 170 + i * rowH;
      const band = this.add.graphics();
      band.fillStyle(0xffffff, i % 2 ? 0.03 : 0.06);
      band.fillRoundedRect(CARD.x + 30, y - rowH / 2 + 8, CARD.w - 60, rowH - 16, 22);
      this.layer.add(band);
      const portrait = addPortrait(this, p.characterId, p.slot, 42, { worldX: CARD.x + 100, worldY: y });
      portrait.setPosition(CARD.x + 100, y);
      const name = addText(this, CARD.x + 164, y - 12, CHARACTERS[p.characterId].name, 32, { color: '#ffffff', weight: 700, align: 'left' });
      const tag = addText(this, CARD.x + 164, y + 24, p.isCpu ? 'CPU' : `PLAYER ${p.slot + 1}`, 18, { color: css(PLAYER_COLORS[p.slot]), weight: 700, align: 'left' });
      this.front.add([portrait, name, tag]);
      const texts = colX.map((x, k) => {
        const t = addTitle(this, x, y, '–', k === 3 ? 52 : 44, k === 3 ? CSS.goldLight : '#ffffff');
        this.front.add(t);
        return t;
      });
      return { p, texts, band, y, board: p.relics - bonus(p.slot), bonus: bonus(p.slot) };
    });
    const reveal = async (col: number, value: (r: (typeof rows)[number]) => number) => {
      audio.play('drumroll');
      this.spots.forEach((l, k) => l.sweepTo(colX[col] + (k - 1) * 30, CARD.y + 170 + rows.length * rowH * 0.4, 380));
      await this.wait(520);
      for (const r of rows) this.countUp(r.texts[col], value(r), 650);
      await this.wait(760);
      audio.play('cymbal', { volume: 0.6 });
    };
    this.spots.forEach((l) => l.light(true, 300, 0.6));
    await reveal(0, (r) => r.p.chips);
    await reveal(1, (r) => r.board);
    await reveal(2, (r) => r.bonus);
    await reveal(3, (r) => r.p.relics);
    const standings = computeStandings(players);
    for (const r of rows) {
      const place = standings.find((s) => s.slot === r.p.slot)!.place;
      if (place === 1) {
        // The leader's row lights up in gold.
        r.band.clear();
        r.band.fillStyle(COLORS.gold, 0.22);
        r.band.fillRoundedRect(CARD.x + 30, r.y - rowH / 2 + 8, CARD.w - 60, rowH - 16, 22);
        r.band.lineStyle(3, COLORS.goldLight, 0.9);
        r.band.strokeRoundedRect(CARD.x + 30, r.y - rowH / 2 + 8, CARD.w - 60, rowH - 16, 22);
        this.tweens.add({ targets: r.texts[3], scale: { from: 1.8, to: 1.2 }, duration: 400, ease: 'Back.Out' });
      }
    }
    this.spots.forEach((l) => l.light(false, 400));
    this.layer.add(addText(this, GAME_WIDTH / 2, CARD.y + h + 40, 'Most Prism Relics wins · Gleam Chips break ties', 26, { color: CSS.cream, weight: 600, stroke: '#1b1530', strokeThickness: 5 }));
  }

  // --- Podium ----------------------------------------------------------------------------------------
  private async showPodium(): Promise<void> {
    const reduced = settings.get().reducedMotion;
    const standings = computeStandings(this.state.players);
    const winners = standings.filter((s) => s.place === 1).map((s) => s.slot);
    // The veil lifts to evening light: the lights and fireworks carry the scene now.
    this.tweens.add({ targets: this.veil, alpha: 0.22, duration: 700 });
    const n = standings.length;
    const drawnXs: Record<number, number[]> = { 2: [760, 1160], 3: [960, 560, 1360], 4: PODIUM_X };
    const xs = this.renderedStage ? PODIUM_X : drawnXs[n] ?? PODIUM_X;
    const heights = PODIUM_H;
    const base = PODIUM_BASE;
    const cols = standings.map((s, rankIdx) => {
      const p = this.player(s.slot);
      const x = xs[rankIdx];
      const h = heights[Math.min(3, rankIdx)];
      if (!this.renderedStage) drawPodium(this.add.graphics().setDepth(1), x, base, h, PLAYER_COLORS[s.slot], s.place === 1);
      const ry = this.renderedStage ? medalY(rankIdx, h) : base - h / 2 + 18;
      addTitle(this, x, ry, ordinal(s.place), rankIdx === 0 ? 46 : rankIdx < 3 ? 40 : 24, s.place === 1 ? CSS.goldLight : CSS.cream).setDepth(2);
      const ring = this.add.graphics().setDepth(2);
      ring.lineStyle(5, PLAYER_COLORS[s.slot], 0.95);
      ring.strokeEllipse(x, base - h + 4, 196, 50);
      ring.fillStyle(PLAYER_COLORS[s.slot], 0.22);
      ring.fillEllipse(x, base - h + 4, 196, 50);
      const k = rankIdx === 0 ? 1.3 : 1.12;
      const c = new Character(this, x, base - h + 8, p.characterId, { scale: k }).setDepth(10);
      c.setAlpha(0);
      const badge = new PlayerBadge(this, x, base - h + 8 + animHeadTop(p.characterId) * k - 40, s.slot, 24).setDepth(11).setAlpha(0);
      // Name and haul on a chip under the podium.
      const chip = this.add.container(x, base + 62).setDepth(12).setAlpha(0);
      const label = addText(this, 0, 0, `${CHARACTERS[p.characterId].short.toUpperCase()} · ${plural(p.relics, 'relic')} · ${plural(p.chips, 'chip')}`, 20, { color: UI.inkCss, weight: 700 });
      const lw = label.width + 44;
      const cg = this.add.graphics();
      cg.fillStyle(0x0a1120, 0.2);
      cg.fillRoundedRect(-lw / 2, -17, lw, 38, 19);
      cg.fillStyle(0xfffaf1, 1);
      cg.fillRoundedRect(-lw / 2, -20, lw, 38, 19);
      cg.fillStyle(PLAYER_COLORS[s.slot], 1);
      cg.fillRoundedRect(-lw / 2 + 16, 11, lw - 32, 4, 2);
      chip.add([cg, label]);
      return { s, p, x, h, c, badge, chip, top: base - h };
    });

    const banner = addTitle(this, GAME_WIDTH / 2, 96, 'AND THE WINNER IS…', 64, CSS.cream).setDepth(30);
    if (!reduced) {
      banner.setScale(0.5).setAlpha(0);
      this.tweens.add({ targets: banner, scale: 1, alpha: 1, duration: 320, ease: 'Back.Out' });
    }
    // On the podium the lamps hang behind the figures, which step into their light.
    this.spots.forEach((l) => l.setDepth(9).light(true, 400, 0.9));
    // Runners-up first, from last place up.
    const runners = cols.filter((c) => !winners.includes(c.s.slot)).reverse();
    for (const col of runners) {
      this.spots.forEach((l, k) => l.sweepTo(col.x + (k - 1) * 24, col.top + 4, 260, 'Cubic.Out'));
      await this.wait(260);
      this.dropIn(col, 420, false);
      await this.wait(620);
    }
    // The drumroll: lights race over the stage, then converge on the top step.
    const winCols = cols.filter((c) => winners.includes(c.s.slot));
    const rolls = reduced ? 1 : 3;
    this.drumroll(rolls);
    const rolling = this.wait(rolls * 1000 + 200);
    this.sweepLights(cols.map((c) => c.x), base - 260, 330, rolling);
    await rolling;
    audio.play('cymbal');
    this.spots.forEach((l, k) => {
      const wc = winCols[k % winCols.length];
      l.sweepTo(wc.x + (k - 1) * 20, wc.top + 4, 160, 'Cubic.Out');
      l.light(true, 120, 1.15);
    });
    this.tweens.add({ targets: banner, alpha: 0, scale: 0.9, duration: 200 });
    if (!reduced) this.cameras.main.flash(220, 255, 246, 220);
    await this.wait(240);
    // The winner drops in slowly, lands with a thump, and the festival erupts.
    for (const wc of winCols) this.dropIn(wc, reduced ? 420 : 1150, true);
    await this.wait(reduced ? 420 : 1150);
    this.celebrate(winCols, winners);
    await this.wait(3400);
    this.menu = new Menu(
      this,
      GAME_WIDTH / 2,
      GAME_HEIGHT - 60,
      [
        { label: 'PLAY AGAIN', onSelect: () => this.playAgain() },
        { label: 'MINIGAME MODE', onSelect: () => this.toMinigames() },
        { label: 'MAIN MENU', onSelect: () => goTo(this, 'Title') },
      ],
      { horizontal: true, width: 380, itemHeight: 68, fontSize: 30, gap: 30 },
    );
    this.menu.setDepth(200);
    if (!reduced) {
      this.menu.y += 110;
      this.tweens.add({ targets: this.menu, y: this.menu.y - 110, duration: 340, ease: 'Back.Out' });
    }
  }

  /** A character drops onto their podium (slowly, for the winner) and strikes a pose. */
  private dropIn(col: { s: { place: number }; p: PlayerState; x: number; c: Character; badge: PlayerBadge; chip: Phaser.GameObjects.Container; top: number }, ms: number, winner: boolean): void {
    const c = col.c;
    const y = c.y;
    c.setAlpha(1);
    c.y -= winner ? 420 : 260;
    if (winner) {
      c.play('jump');
      // Slow motion: the fall and the character's own animation both run at a crawl.
      c.sprite.anims.timeScale = 0.35;
    }
    audio.play(winner ? 'whoosh' : 'land', { volume: winner ? 0.5 : 1 });
    this.tweens.add({
      targets: c,
      y,
      duration: ms,
      ease: winner ? 'Sine.InOut' : 'Bounce.Out',
      onComplete: () => {
        c.sprite.anims.timeScale = 1;
        c.squash(winner ? 0.22 : 0.12, winner ? 200 : 140);
        this.fx.vfx('dust', col.x, y + 4, { scale: winner ? 0.6 : 0.38, alpha: 0.65 });
        if (winner) {
          c.play('victory');
          audio.play('land');
          this.fx.shake(0.006, 260);
        } else {
          const last = col.s.place === this.state.players.length && this.state.players.length > 2;
          c.play(last ? 'disappointed' : 'celebrate', { onComplete: () => c.hold(last ? 'disappointed' : 'celebrate', 2) });
        }
      },
    });
    this.tweens.add({ targets: [col.badge, col.chip], alpha: 1, duration: 220, delay: ms });
    if (!settings.get().reducedMotion) this.tweens.add({ targets: col.chip, scale: { from: 0.6, to: 1 }, duration: 260, delay: ms, ease: 'Back.Out' });
  }

  /** Fanfare, god-ray, banner, confetti cannons and fireworks for the winner(s). */
  private celebrate(winCols: { p: PlayerState; x: number; c: Character; top: number }[], winners: number[]): void {
    audio.play('fanfare');
    audio.play('victory');
    audio.play('cheer');
    const first = winCols[0];
    const color = PLAYER_COLORS[first.p.slot];
    for (const wc of winCols) {
      // Above the evening veil (so it glows at full strength), behind the winner.
      const rays = godRays(this, wc.x, wc.top + 6, { depth: 7, scale: 1.1 });
      rays.setAlpha(0);
      this.tweens.add({ targets: rays, alpha: 1, duration: 500 });
      this.fx.vfx('rainbowSwirl', wc.x, wc.top - 150, { scale: 1.4, blend: 'add', duration: 1400 });
      if (this.textures.exists('fx-ring') && !settings.get().reducedMotion) {
        const ring = this.add.image(wc.x, wc.top + 6, 'fx-ring').setTint(PLAYER_COLORS[wc.p.slot]).setScale(1, 0.3).setAlpha(0.9).setDepth(9);
        this.tweens.add({ targets: ring, scaleX: 5, scaleY: 1.5, alpha: 0, duration: 700, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
      }
      if (!wc.p.isCpu) {
        input.rumbleSlot(wc.p.slot, 0.8, 0.8, 180);
        this.time.delayedCall(300, () => input.rumbleSlot(wc.p.slot, 0.8, 0.8, 180));
      }
    }
    const names = winners.map((w) => CHARACTERS[this.player(w).characterId].short.toUpperCase());
    const tie = winners.length > 1;
    winnerBanner(this, GAME_WIDTH / 2, 100, {
      title: tie ? "IT'S A TIE!" : `${names[0]} WINS!`,
      color,
      portraits: winCols.map((w) => ({ characterId: w.p.characterId, slot: w.p.slot })),
      subtitle: tie ? names.join(' & ') : `FESTIVAL CHAMPION · ${first.p.relics} PRISM RELIC${first.p.relics === 1 ? '' : 'S'}`,
      size: 66,
      depth: 50,
    });
    this.confetti.cannons(GAME_HEIGHT - 60, 110);
    this.confetti.rain(60);
    // Fireworks over the island, in every player's colour (the winner's most often).
    const palette = [color, color, ...PLAYER_COLORS, COLORS.goldLight];
    const burst = () => {
      const x = Phaser.Math.Between(220, GAME_WIDTH - 220);
      const y = Phaser.Math.Between(150, 400);
      this.fireworks.launch(x, y, Phaser.Utils.Array.GetRandom(palette));
    };
    if (!settings.get().reducedMotion) {
      for (let i = 0; i < 3; i++) this.time.delayedCall(200 + i * 260, burst);
      this.time.addEvent({ delay: LITE ? 1300 : 800, loop: true, callback: burst });
    }
    // Keep celebrating until the players choose what's next.
    this.time.addEvent({ delay: 1400, loop: true, callback: () => this.confetti.rain(24) });
    this.time.addEvent({
      delay: 3200,
      loop: true,
      callback: () => {
        for (const wc of winCols) wc.c.play('victory');
      },
    });
    if (!settings.get().reducedMotion) {
      // A slow push in on the winner, then back out to the whole stage.
      const cam = this.cameras.main;
      cam.pan(first.x, first.top - 40, 1400, 'Sine.easeInOut');
      cam.zoomTo(1.12, 1400, 'Sine.easeInOut');
      this.time.delayedCall(3000, () => {
        cam.pan(GAME_WIDTH / 2, GAME_HEIGHT / 2, 900, 'Sine.easeInOut');
        cam.zoomTo(1, 900, 'Sine.easeInOut');
      });
    }
  }

  private playAgain(): void {
    const board = findBoard(this.state.config.boardId);
    if (!board) return goTo(this, 'Title');
    const participants = this.state.players.map((p) => ({ slot: p.slot, characterId: p.characterId, isCpu: p.isCpu, cpuLevel: p.cpuLevel }));
    session.match = createMatch({ ...this.state.config, seed: randomSeed() }, participants, board);
    saves.save(session.match);
    goTo(this, 'Board', { intro: false });
  }

  private toMinigames(): void {
    session.mode = 'minigame';
    goTo(this, 'MinigameMode');
  }

  override update(): void {
    if (!this.menu) return;
    for (const s of this.humans()) if (this.menu.handle(input.controls(s))) return;
    this.menu.handle(input.any);
  }
}
