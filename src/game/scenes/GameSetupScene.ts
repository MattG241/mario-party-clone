import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { Character } from '../characters/Character';
import { COLORS, CSS, CPU_LEVELS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS, ROUND_OPTIONS, type CpuLevel, type EventMode, type GameSpeed, type InstructionMode, type RoundCount } from '../constants';
import type { BoardDef } from '../board/types';
import { BOARDS } from '../data/boards';
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
import { addPortrait } from '../ui/Portrait';
import { worldDef } from '../worlds';
import { addGradientTitle, addText } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';
import { randomSeed } from '../util/Random';
import { URL_PARAMS } from '../debug/debug';
import { buildBackdrop } from '../ui/Screen';
import { UI } from '../ui/Style';

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
  /** The order CPUs take the free characters in: shuffled once per visit so the preview matches the match. */
  private cpuOrder: CharacterId[] = [];
  /** The chosen board (index into BOARDS) and its card on the right. */
  private boardIndex = 0;
  private boardLayer!: Phaser.GameObjects.Container;

  constructor() {
    super('GameSetup');
  }

  preload(): void {
    // Small preview pictures of the boards for the board card.
    for (const b of BOARDS) {
      const path = previewPath(b);
      if (path && !this.textures.exists(previewKey(b))) this.load.image(previewKey(b), path);
    }
  }

  create(): void {
    enterScene(this);
    const lastBoard = this.registry.get('setup-board') as string | undefined;
    this.boardIndex = Math.max(0, BOARDS.findIndex((b) => b.id === lastBoard));
    this.cpuOrder = Phaser.Utils.Array.Shuffle(CHARACTER_IDS.slice());
    const s = settings.get();
    this.rounds = s.rounds;
    this.cpuOn = s.cpuPlayers;
    this.cpuLevel = s.cpuDifficulty;
    this.instructions = s.instructions;
    this.eventMode = s.boardEvents;
    this.speed = s.gameSpeed;
    if (session.humans().length < 2) this.cpuOn = true;
    buildBackdrop(this, 'golden', 0.22);
    addGradientTitle(this, GAME_WIDTH / 2, 66, 'GAME SETTINGS', 70);

    new Panel(this, 520, 520, 860, 700, { title: 'MATCH RULES', ribbon: COLORS.teal, bevel: true });
    const humans = session.humans().length;
    // Before the menu: it reports its first focus straight away.
    // The focused rule's explanation, at the foot of the rules card.
    this.hint = addText(this, 520, 814, '', 24, { color: UI.inkSecondCss, weight: 600, wrap: 780 });
    this.menu = new Menu(
      this,
      520,
      480,
      [
        {
          label: 'Board',
          value: () => BOARDS[this.boardIndex].name,
          onChange: (d) => {
            this.boardIndex = (this.boardIndex + d + BOARDS.length) % BOARDS.length;
            this.registry.set('setup-board', BOARDS[this.boardIndex].id);
            this.renderBoardCard();
          },
          hint: 'Where the match is played: Suncoil Sanctuary, or one of the guests\u2019 home isles.',
        },
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
        { label: 'START ADVENTURE', onSelect: () => this.start(), hint: 'Travel to the board and let the festival begin!' },
      ],
      { width: 760, itemHeight: 60, gap: 10, fontSize: 30, onCancel: () => goTo(this, 'CharacterSelect'), onFocus: (it) => this.hint?.setText(it.hint ?? '') },
    );
    this.hint.setText(this.menu.items[0].hint ?? '');

    // Board card
    new Panel(this, 1420, 360, 800, 470, { title: 'BOARD', border: COLORS.gold, ribbon: COLORS.gold, bevel: true });
    this.boardLayer = this.add.container(0, 0);
    this.renderBoardCard();

    // Roster
    new Panel(this, 1420, 800, 800, 330, { title: 'PLAYERS', ribbon: COLORS.purple, bevel: true });
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
      const free = this.cpuOrder.filter((c) => !taken.has(c));
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
      drawPanel(g, x - 88, y - 120, 176, 220, { radius: 22, borderWidth: 5, border: PLAYER_COLORS[p.slot], engraving: false, shadowOffset: 6, bevel: true });
      const c = new Character(this, x, y + 40, p.characterId, { scale: 0.48, shadow: false });
      const badge = new PlayerBadge(this, x - 60, y - 92, p.slot, 18);
      const name = addText(this, x + 14, y - 92, p.isCpu ? `CPU · ${cap(p.cpuLevel)}` : `P${p.slot + 1}`, 20, { color: CSS.ink, weight: 700 });
      const cname = addText(this, x, y + 78, CHARACTERS[p.characterId].short, 23, { color: UI.inkSecondCss, weight: 700 });
      this.rosterLayer.add([g, c, badge, name, cname]);
    });
  }

  /** The chosen board's card: its picture (or its guests), name, subtitle and description. */
  private renderBoardCard(): void {
    const board = BOARDS[this.boardIndex];
    const L = this.boardLayer;
    this.tweens.killTweensOf(L.list);
    L.removeAll(true);
    const key = previewKey(board);
    if (this.textures.exists(key)) {
      const img = this.add.image(1420, 385, key);
      img.setScale(Math.min(700 / img.width, 236 / img.height));
      L.add(img);
    } else if (!board.theme) {
      // Suncoil's vector preview: the island, the observatory, the twisting tree and a crystal generator.
      const preview = this.add.container(1420, 380);
      preview.add([this.add.image(0, 20, 'island-medium').setScale(0.55), this.add.image(-150, 10, 'tree-twist').setScale(0.2), this.add.image(150, 0, 'crystal-generator').setScale(0.25), this.add.image(0, -40, 'observatory').setScale(0.3)]);
      this.tweens.add({ targets: preview, y: 370, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      L.add(preview);
    } else {
      // A world isle whose art isn't rendered yet: its guests on a band of its colour.
      const world = worldDef(board.theme.world);
      const g = this.add.graphics();
      g.fillStyle(world.color, 0.9);
      g.fillRoundedRect(1420 - 330, 300, 660, 170, 30);
      g.lineStyle(4, 0xfff4dc, 1);
      g.strokeRoundedRect(1420 - 330, 300, 660, 170, 30);
      L.add(g);
      world.cast.forEach((id, i) => {
        const x = 1420 + (i - (world.cast.length - 1) / 2) * 136;
        L.add(addPortrait(this, id, 0, 54, { worldX: x, worldY: 385 }).setPosition(x, 385));
      });
    }
    L.add(addText(this, 1420, 205, board.name, 44, { color: CSS.tealDark, weight: 700 }));
    L.add(addText(this, 1420, 250, board.subtitle, 26, { color: UI.inkSecondCss, weight: 600 }));
    L.add(addText(this, 1420, 545, board.description, 22, { color: CSS.ink, weight: 500, wrap: 700 }));
    if (BOARDS.length > 1) L.add(addText(this, 1420 + 360, 205, `${this.boardIndex + 1}/${BOARDS.length}`, 20, { color: UI.inkSecondCss, weight: 700 }).setOrigin(1, 0.5));
  }

  private start(): void {
    const board = BOARDS[this.boardIndex];
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

/** A board's setup-screen picture: its world's preview, or Suncoil's (when rendered). */
function previewPath(b: BoardDef): string | undefined {
  return b.theme?.preview ?? (b.id === 'suncoil' ? 'assets/lite/suncoil/preview.webp' : undefined);
}

function previewKey(b: BoardDef): string {
  return `board-preview-${b.id}`;
}
