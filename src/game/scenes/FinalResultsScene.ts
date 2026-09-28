import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { Character } from '../characters/Character';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { findBoard } from '../data/boards';
import { CHARACTERS } from '../data/characters';
import { EffectsManager } from '../effects/EffectsManager';
import { input } from '../input/InputManager';
import { saves } from '../save/SaveManager';
import { createMatch, type MatchState } from '../state/MatchState';
import { BONUSES, computeStandings, type BonusAward } from '../state/scoring';
import { session } from '../state/Session';
import { PromptBar } from '../ui/ControllerPrompt';
import { Menu } from '../ui/Menu';
import { drawPanel } from '../ui/Panel';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { randomSeed } from '../util/Random';
import { addStrip } from '../ui/Screen';

/** Bonus awards, the final tally and the winner's podium. Never auto-skips the celebration. */
export class FinalResultsScene extends Phaser.Scene {
  private state!: MatchState;
  private awards: BonusAward[] = [];
  private fx!: EffectsManager;
  private layer!: Phaser.GameObjects.Container;
  private menu?: Menu;
  private prompt!: PromptBar;

  constructor() {
    super('FinalResults');
  }

  init(data: { state: MatchState; awards: BonusAward[] }): void {
    this.state = data.state;
    this.awards = data.awards ?? [];
    this.menu = undefined;
  }

  create(): void {
    enterScene(this, 500);
    audio.playMusic('final');
    this.fx = new EffectsManager(this, 800);
    this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    addStrip(this, 0, 640, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0);
    this.add.image(480, 120, 'bunting').setScale(1.3);
    this.add.image(1440, 120, 'bunting').setScale(1.3);
    this.layer = this.add.container(0, 0);
    this.prompt = new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 36, [], { size: 38, fontSize: 26 }).setDepth(100);
    void this.sequence();
  }

  private humans(): number[] {
    return this.state.players.filter((p) => !p.isCpu).map((p) => p.slot);
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
          this.events.off(Phaser.Scenes.Events.UPDATE, tick);
          this.prompt.setPrompts([]);
          audio.play('confirm');
          resolve();
        }
      };
      this.events.on(Phaser.Scenes.Events.UPDATE, tick);
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => this.time.delayedCall(ms, () => r()));
  }

  private clear(): void {
    this.layer.removeAll(true);
  }

  private async sequence(): Promise<void> {
    const title = addTitle(this, GAME_WIDTH / 2, 110, 'BONUS AWARDS', 84);
    title.setScale(0.4);
    this.tweens.add({ targets: title, scale: 1, duration: 360, ease: 'Back.Out' });
    audio.play('fanfare');
    await this.wait(700);
    for (const award of this.awards) {
      await this.showAward(award);
      await this.advance(3500);
      this.clear();
    }
    title.setText('FINAL TALLY');
    await this.showTally();
    await this.advance(4500);
    this.clear();
    title.destroy();
    await this.showPodium();
  }

  // --- Bonus award card ---------------------------------------------------------------------------
  private async showAward(award: BonusAward): Promise<void> {
    const def = BONUSES[award.id];
    const card = this.add.graphics();
    drawPanel(card, 260, 200, 1400, 660, { radius: 36, border: COLORS.gold });
    this.layer.add(card);
    const name = addText(this, GAME_WIDTH / 2, 270, def.name.toUpperCase(), 64, { color: CSS.tealDark, weight: 700 });
    const desc = addText(this, GAME_WIDTH / 2, 335, def.description, 32, { color: CSS.inkSoft, weight: 600 });
    this.layer.add([name, desc]);
    audio.play('drumroll');
    const n = this.state.players.length;
    const cols = this.state.players.map((p, i) => {
      const x = GAME_WIDTH / 2 + (i - (n - 1) / 2) * 320;
      const c = new Character(this, x, 700, p.characterId, { scale: 0.62 });
      const badge = new PlayerBadge(this, x - 90, 440, p.slot, 24);
      const val = award.values.find((v) => v.slot === p.slot)?.value ?? 0;
      const valText = addText(this, x, 770, '0', 48, { color: CSS.ink, weight: 700 });
      const unit = addText(this, x, 815, def.unit, 22, { color: CSS.inkSoft, weight: 600 });
      this.layer.add([c, badge, valText, unit]);
      return { p, x, c, val, valText };
    });
    // Count up every player's stat first.
    for (const col of cols) {
      const holder = { v: 0 };
      this.tweens.add({ targets: holder, v: col.val, duration: 900, ease: 'Quad.Out', onUpdate: () => col.valText.setText(String(Math.round(holder.v))) });
    }
    await this.wait(1300);
    if (award.winners.length === 0) {
      const none = addText(this, GAME_WIDTH / 2, 400, 'Nobody earned this one!', 36, { color: CSS.coral, weight: 700 });
      this.layer.add(none);
      audio.play('defeat', { volume: 0.5 });
      return;
    }
    audio.play('cymbal');
    for (const col of cols) {
      const won = award.winners.includes(col.p.slot);
      if (won) {
        const glow = this.add.image(col.x, 620, 'fx-dot').setScale(18).setTint(COLORS.goldLight).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD);
        this.layer.addAt(glow, 1);
        col.c.play('victory');
        const relic = this.add.image(col.x, 380, 'prism-relic').setScale(0.1);
        this.layer.add(relic);
        this.tweens.add({ targets: relic, scale: 0.34, y: 420, duration: 500, ease: 'Back.Out' });
        const plus = addText(this, col.x, 520, '+1 PRISM RELIC', 28, { color: CSS.white, stroke: '#1b1530', strokeThickness: 6, weight: 700 });
        this.layer.add(plus);
        this.fx.confetti(col.x, 360, 60);
        if (!col.p.isCpu) input.rumbleSlot(col.p.slot, 0.6, 0.6, 180);
      } else {
        col.c.play('disappointed');
        col.c.setAlpha(0.75);
      }
    }
    audio.play('relic');
    const names = award.winners.map((s) => CHARACTERS[this.state.players.find((p) => p.slot === s)!.characterId].name).join(' & ');
    const who = addText(this, GAME_WIDTH / 2, 395, award.winners.length > 1 ? `Tie! ${names} each earn a relic` : `${names} earns a Prism Relic!`, 32, { color: CSS.tealDeep, weight: 700 });
    this.layer.add(who);
  }

  // --- Tally ------------------------------------------------------------------------------------
  private async showTally(): Promise<void> {
    const players = this.state.players;
    const bonus = (slot: number) => this.awards.filter((a) => a.winners.includes(slot)).length;
    const panel = this.add.graphics();
    const h = 170 + players.length * 150;
    drawPanel(panel, 200, 190, 1520, h, { radius: 36 });
    this.layer.add(panel);
    const heads = ['Gleam Chips', 'Board Relics', 'Bonus Relics', 'Total Relics'];
    const colX = [860, 1100, 1330, 1560];
    heads.forEach((hname, i) => this.layer.add(addText(this, colX[i], 250, hname, 28, { color: CSS.tealDark, weight: 700 })));
    const rows = players.map((p, i) => {
      const y = 350 + i * 150;
      const c = new Character(this, 330, y + 60, p.characterId, { scale: 0.5, shadow: false });
      const badge = new PlayerBadge(this, 440, y, p.slot, 24);
      const name = addText(this, 480, y, CHARACTERS[p.characterId].name, 34, { color: CSS.ink, weight: 700, align: 'left' });
      this.layer.add([c, badge, name]);
      const texts = colX.map((x) => {
        const t = addText(this, x, y, '–', 44, { color: CSS.ink, weight: 700 });
        this.layer.add(t);
        return t;
      });
      return { p, texts, board: p.relics - bonus(p.slot), bonus: bonus(p.slot) };
    });
    const reveal = async (col: number, value: (r: (typeof rows)[number]) => number) => {
      audio.play('drumroll');
      await this.wait(600);
      for (const r of rows) {
        const holder = { v: 0 };
        const target = value(r);
        this.tweens.add({ targets: holder, v: target, duration: 700, ease: 'Quad.Out', onUpdate: () => r.texts[col].setText(String(Math.round(holder.v))) });
      }
      await this.wait(800);
      audio.play('cymbal', { volume: 0.6 });
    };
    await reveal(0, (r) => r.p.chips);
    await reveal(1, (r) => r.board);
    await reveal(2, (r) => r.bonus);
    await reveal(3, (r) => r.p.relics);
    const standings = computeStandings(players);
    for (const r of rows) {
      const place = standings.find((s) => s.slot === r.p.slot)!.place;
      if (place === 1) {
        r.texts[3].setColor(CSS.goldDark);
        this.tweens.add({ targets: r.texts[3], scale: { from: 1.8, to: 1.2 }, duration: 400, ease: 'Back.Out' });
      }
    }
    this.layer.add(addText(this, GAME_WIDTH / 2, 190 + h + 40, 'Most Prism Relics wins · Gleam Chips break ties', 26, { color: CSS.cream, weight: 600, stroke: '#1b1530', strokeThickness: 5 }));
  }

  // --- Podium --------------------------------------------------------------------------------------
  private async showPodium(): Promise<void> {
    const standings = computeStandings(this.state.players);
    const winners = standings.filter((s) => s.place === 1).map((s) => s.slot);
    const heights = [260, 180, 120, 70];
    const order = standings.map((s, i) => ({ s, i }));
    const xsByCount: Record<number, number[]> = { 2: [760, 1160], 3: [560, 960, 1360], 4: [460, 820, 1180, 1540] };
    // Centre the winner: column order 2nd, 1st, 3rd, 4th.
    const colOrder = [1, 0, 2, 3].filter((i) => i < order.length);
    const xs = xsByCount[order.length] ?? xsByCount[4];
    const chars: { c: Character; slot: number; place: number }[] = [];
    colOrder.forEach((rankIdx, col) => {
      const { s } = order[rankIdx];
      const p = this.state.players.find((pl) => pl.slot === s.slot)!;
      const x = xs[col];
      const h = heights[Math.min(3, s.place - 1)];
      const base = 930;
      const g = this.add.graphics();
      g.fillStyle(0x0b1a24, 0.25);
      g.fillEllipse(x, base + 12, 320, 56);
      g.fillStyle(0x9c9a92, 1);
      g.fillRect(x - 140, base - h, 280, h);
      g.fillStyle(0xc9c6bb, 1);
      g.fillEllipse(x, base - h, 280, 64);
      g.fillStyle(PLAYER_COLORS[s.slot], 1);
      g.fillRect(x - 140, base - h + 30, 280, 16);
      g.lineStyle(5, COLORS.goldDark, 1);
      g.strokeEllipse(x, base - h, 280, 64);
      const suffix = s.place === 1 ? 'st' : s.place === 2 ? 'nd' : s.place === 3 ? 'rd' : 'th';
      addTitle(this, x, base - h / 2 + 34, `${s.place}${suffix}`, 60, s.place === 1 ? CSS.goldLight : CSS.cream);
      const c = new Character(this, x, base - h + 12, p.characterId, { scale: 1 });
      new PlayerBadge(this, x - 120, base - h - 280, s.slot, 28);
      addText(this, x, base + 50, `${p.relics} relics · ${p.chips} chips`, 26, { color: CSS.cream, weight: 700, stroke: '#1b1530', strokeThickness: 6 });
      c.setAlpha(0);
      chars.push({ c, slot: s.slot, place: s.place });
    });
    // Reveal from last place to first.
    const sorted = [...chars].sort((a, b) => b.place - a.place);
    for (const ch of sorted) {
      ch.c.setAlpha(1);
      const y = ch.c.y;
      ch.c.y -= 260;
      this.tweens.add({ targets: ch.c, y, duration: 420, ease: 'Bounce.Out' });
      audio.play(ch.place === 1 ? 'fanfare' : 'land');
      await this.wait(ch.place === 1 ? 200 : 520);
    }
    const winnerNames = winners.map((w) => CHARACTERS[this.state.players.find((p) => p.slot === w)!.characterId].name.toUpperCase());
    const banner = addTitle(this, GAME_WIDTH / 2, 150, winners.length > 1 ? 'IT\'S A TIE!' : `${winnerNames[0]} WINS!`, 96, CSS.goldLight);
    banner.setScale(0.3);
    this.tweens.add({ targets: banner, scale: 1, duration: 420, ease: 'Back.Out' });
    if (winners.length > 1) addText(this, GAME_WIDTH / 2, 230, winnerNames.join(' & '), 36, { color: CSS.cream, weight: 700, stroke: '#1b1530', strokeThickness: 6 });
    audio.play('victory');
    audio.play('cheer');
    for (const ch of chars) {
      const anim = ch.place === 1 ? 'victory' : ch.place === chars.length && chars.length > 2 ? 'disappointed' : 'celebrate';
      ch.c.play(anim, { returnTo: ch.place === 1 ? 'idle' : 'idle' });
      if (ch.place === 1) {
        this.fx.vfx('rainbowSwirl', ch.c.x, ch.c.y - 140, { scale: 1.4, blend: 'add', duration: 1400 });
        const p = this.state.players.find((pl) => pl.slot === ch.slot)!;
        if (!p.isCpu) {
          input.rumbleSlot(ch.slot, 0.8, 0.8, 180);
          this.time.delayedCall(300, () => input.rumbleSlot(ch.slot, 0.8, 0.8, 180));
        }
      }
    }
    // Keep celebrating until the players choose what's next.
    this.time.addEvent({ delay: 900, loop: true, callback: () => this.fx.confetti(Phaser.Math.Between(300, 1620), 80, 50) });
    this.time.addEvent({
      delay: 3200,
      loop: true,
      callback: () => {
        for (const ch of chars) if (ch.place === 1) ch.c.play('victory');
      },
    });
    const winnerChar = chars.find((c) => c.place === 1);
    if (winnerChar) {
      this.cameras.main.pan(winnerChar.c.x, 560, 1200, 'Sine.easeInOut');
      this.cameras.main.zoomTo(1.12, 1200, 'Sine.easeInOut');
      this.time.delayedCall(2600, () => {
        this.cameras.main.pan(GAME_WIDTH / 2, GAME_HEIGHT / 2, 900, 'Sine.easeInOut');
        this.cameras.main.zoomTo(1, 900, 'Sine.easeInOut');
      });
    }
    await this.wait(3600);
    this.menu = new Menu(
      this,
      GAME_WIDTH / 2,
      GAME_HEIGHT - 70,
      [
        { label: 'PLAY AGAIN', onSelect: () => this.playAgain() },
        { label: 'MINIGAME MODE', onSelect: () => this.toMinigames() },
        { label: 'MAIN MENU', onSelect: () => goTo(this, 'Title') },
      ],
      { horizontal: true, width: 380, itemHeight: 72, fontSize: 30, gap: 30 },
    );
    this.menu.setDepth(200);
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
