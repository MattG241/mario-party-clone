import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { Character } from '../characters/Character';
import { COLORS, CSS, CPU_LEVELS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS, ROUND_OPTIONS, type CpuLevel, type EventMode, type GameSpeed, type InstructionMode, type RoundCount } from '../constants';
import { findBoard } from '../data/boards';
import { CHARACTER_IDS, CHARACTERS, type CharacterId } from '../data/characters';
import { input } from '../input/InputManager';
import { saves } from '../save/SaveManager';
import { settings } from '../save/SettingsManager';
import { createMatch, type Participant } from '../state/MatchState';
import { session } from '../state/Session';
import { PromptBar } from '../ui/ControllerPrompt';
import { Menu } from '../ui/Menu';
import { drawPanel, Panel } from '../ui/Panel';
import { PlayerBadge } from '../ui/PlayerBadge';
import { addText, addTitle } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { randomSeed } from '../util/Random';
import { URL_PARAMS } from '../debug/debug';
import { addStrip } from '../ui/Screen';

const cycle = <T,>(list: readonly T[], cur: T, dir: number): T => list[(list.indexOf(cur) + dir + list.length) % list.length];

/** Match settings + board choice, then starts the board game. */
export class GameSetupScene extends Phaser.Scene {
  private menu!: Menu;
  private rosterLayer!: Phaser.GameObjects.Container;
  private rounds: RoundCount = 10;
  private cpuOn = true;
  private cpuLevel: CpuLevel = 'normal';
  private instructions: InstructionMode = 'on';
  private eventMode: EventMode = 'normal';
  private speed: GameSpeed = 'normal';
  private hint!: Phaser.GameObjects.Text;

  constructor() {
    super('GameSetup');
  }

  create(): void {
    enterScene(this);
    const s = settings.get();
    this.rounds = s.rounds;
    this.cpuOn = s.cpuPlayers;
    this.cpuLevel = s.cpuDifficulty;
    this.instructions = s.instructions;
    this.eventMode = s.boardEvents;
    this.speed = s.gameSpeed;
    if (session.humans().length < 2) this.cpuOn = true;
    this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    addStrip(this, 0, 560, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setAlpha(0.9);
    addTitle(this, GAME_WIDTH / 2, 66, 'GAME SETTINGS', 70);

    new Panel(this, 520, 520, 860, 700, { title: 'Match Rules' });
    const humans = session.humans().length;
    // Before the menu: it reports its first focus straight away.
    this.hint = addText(this, 520, 912, '', 26, { color: CSS.inkSoft, weight: 500, wrap: 780 });
    this.menu = new Menu(
      this,
      520,
      480,
      [
        { label: 'Rounds', value: () => String(this.rounds), onChange: (d) => (this.rounds = cycle(ROUND_OPTIONS, this.rounds, d)), hint: 'How many rounds the match lasts. Each round: everyone moves, then a minigame.' },
        {
          label: 'CPU Players',
          value: () => (this.cpuOn ? 'On' : 'Off'),
          onChange: () => {
            if (humans < 2) {
              audio.play('error');
              return;
            }
            this.cpuOn = !this.cpuOn;
            this.renderRoster();
          },
          hint: humans < 2 ? 'At least two players are needed, so CPUs fill the empty spots.' : 'Fill empty spots with computer players.',
        },
        { label: 'CPU Difficulty', value: () => cap(this.cpuLevel), onChange: (d) => { this.cpuLevel = cycle(CPU_LEVELS, this.cpuLevel, d); this.renderRoster(); }, disabled: () => !this.cpuOn, hint: 'Easy CPUs make mistakes; Hard CPUs react quickly (but are never perfect).' },
        { label: 'Minigame Instructions', value: () => cap(this.instructions), onChange: (d) => (this.instructions = cycle(['on', 'quick', 'off'] as const, this.instructions, d)), hint: 'On: full instruction screen · Quick: controls only · Off: straight to the countdown.' },
        { label: 'Board Events', value: () => cap(this.eventMode), onChange: (d) => (this.eventMode = cycle(["normal", "chaotic"] as const, this.eventMode, d)), hint: 'Chaotic: an extra surprise event kicks off every round.' },
        { label: 'Game Speed', value: () => cap(this.speed), onChange: (d) => (this.speed = cycle(['normal', 'fast'] as const, this.speed, d)), hint: 'Fast shortens board animations and CPU thinking time.' },
        { label: 'START ADVENTURE', onSelect: () => this.start(), hint: 'Travel to Suncoil Sanctuary!' },
      ],
      { width: 760, itemHeight: 66, gap: 14, fontSize: 30, onCancel: () => goTo(this, 'CharacterSelect'), onFocus: (it) => this.hint?.setText(it.hint ?? '') },
    );
    this.hint.setText(this.menu.items[0].hint ?? '');

    // Board card
    const board = findBoard('suncoil');
    const card = new Panel(this, 1420, 360, 800, 470, { title: 'Board', border: COLORS.gold });
    const preview = this.add.container(1420, 380);
    const isl = this.add.image(0, 20, 'island-medium').setScale(0.55);
    const obs = this.add.image(0, -40, 'observatory').setScale(0.3);
    const tree = this.add.image(-150, 10, 'tree-twist').setScale(0.2);
    const cg = this.add.image(150, 0, 'crystal-generator').setScale(0.25);
    preview.add([isl, tree, cg, obs]);
    this.tweens.add({ targets: preview, y: 370, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    addText(this, 1420, 205, board?.name ?? 'Suncoil Sanctuary', 44, { color: CSS.tealDark, weight: 700 });
    addText(this, 1420, 250, board?.subtitle ?? '', 26, { color: CSS.inkSoft, weight: 500 });
    addText(this, 1420, 545, board?.description ?? '', 22, { color: CSS.ink, weight: 500, wrap: 700 });
    void card;

    // Roster
    new Panel(this, 1420, 800, 800, 330, { title: 'Players' });
    this.rosterLayer = this.add.container(0, 0);
    this.renderRoster();
    new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 34, [
      { button: 'STICK', label: 'Choose' },
      { button: 'LEFT', label: 'Change' },
      { button: 'A', label: 'Select' },
      { button: 'B', label: 'Back' },
    ], { size: 36, fontSize: 24 });
    audio.playMusic('menu');
    if (URL_PARAMS.has('autostart')) this.time.delayedCall(300, () => this.start());
  }

  /** Participants: joined humans plus CPU fills with the remaining characters. */
  private participants(): Participant[] {
    const out: Participant[] = [];
    const taken = new Set<CharacterId>();
    for (const s of session.slots) {
      if (s.joined && s.characterId) {
        out.push({ slot: s.slot, characterId: s.characterId, isCpu: false, cpuLevel: this.cpuLevel });
        taken.add(s.characterId);
      }
    }
    if (this.cpuOn || out.length < 2) {
      const free = CHARACTER_IDS.filter((c) => !taken.has(c));
      for (const s of session.slots) {
        if (out.some((p) => p.slot === s.slot)) continue;
        const c = free.shift();
        if (!c) break;
        out.push({ slot: s.slot, characterId: c, isCpu: true, cpuLevel: this.cpuLevel });
      }
    }
    return out.sort((a, b) => a.slot - b.slot);
  }

  private renderRoster(): void {
    this.rosterLayer.removeAll(true);
    const parts = this.participants();
    parts.forEach((p, i) => {
      const x = 1420 - 300 + i * 200;
      const y = 830;
      const g = this.add.graphics();
      drawPanel(g, x - 88, y - 120, 176, 220, { radius: 22, borderWidth: 5, border: PLAYER_COLORS[p.slot], engraving: false, shadowOffset: 6 });
      const c = new Character(this, x, y + 40, p.characterId, { scale: 0.48, shadow: false });
      const badge = new PlayerBadge(this, x - 60, y - 92, p.slot, 18);
      const name = addText(this, x + 14, y - 92, p.isCpu ? `CPU · ${cap(p.cpuLevel)}` : `P${p.slot + 1}`, 20, { color: CSS.ink, weight: 700 });
      const cname = addText(this, x, y + 78, CHARACTERS[p.characterId].name.split(' ')[0], 22, { color: CSS.inkSoft, weight: 600 });
      this.rosterLayer.add([g, c, badge, name, cname]);
    });
  }

  private start(): void {
    const board = findBoard('suncoil');
    if (!board) {
      audio.play('error');
      return;
    }
    const parts = this.participants();
    if (parts.length < 2) {
      audio.play('error');
      return;
    }
    settings.set({ rounds: this.rounds, cpuPlayers: this.cpuOn, cpuDifficulty: this.cpuLevel, instructions: this.instructions, boardEvents: this.eventMode, gameSpeed: this.speed });
    // Mark CPU fills in the session so later screens know who is who.
    for (const p of parts) {
      const cfg = session.slots[p.slot];
      if (p.isCpu) {
        cfg.isCpu = true;
        cfg.characterId = p.characterId;
        cfg.cpuLevel = p.cpuLevel;
      }
    }
    const seedParam = Number(URL_PARAMS.get('seed'));
    const seed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam >>> 0 : randomSeed();
    session.match = createMatch(
      { boardId: board.id, rounds: this.rounds, cpuDifficulty: this.cpuLevel, instructions: this.instructions, events: this.eventMode, speed: this.speed, seed },
      parts,
      board,
    );
    saves.save(session.match);
    audio.play('fanfare');
    goTo(this, 'Board', { intro: true });
  }

  override update(): void {
    // Any joined human may drive the setup menu.
    for (const s of session.humans()) {
      const c = input.controls(s.slot);
      if (this.menu.handle(c)) break;
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
