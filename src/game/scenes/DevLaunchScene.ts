import Phaser from 'phaser';
import type { CpuLevel } from '../constants';
import { BoardGraph } from '../board/BoardGraph';
import type { BoardDef } from '../board/types';
import { findBoard } from '../data/boards';
import type { ItemId } from '../data/items';
import { CHARACTER_IDS } from '../data/characters';
import { URL_PARAMS } from '../debug/debug';
import { input } from '../input/InputManager';
import { minigameInfo, type MinigameLaunch } from '../minigames/MinigameManager';
import { registeredMinigames } from '../minigames/registry';
import { saves } from '../save/SaveManager';
import { createMatch, type Participant } from '../state/MatchState';
import { session } from '../state/Session';
import { addText } from '../ui/theme';
import { goTo } from '../ui/Transition';
import { randomSeed } from '../util/Random';

interface DevLaunchData {
  minigame?: string;
  quick?: boolean;
}

/**
 * Developer shortcut launcher (URL parameters, never reachable from menus):
 *   ?minigame=<id>   jump straight into a minigame (P1 = keyboard / first pad, CPUs fill)
 *   ?quick           start a board match immediately (P1 human + 3 CPUs)
 * Modifiers: &humans=0..4 (0 = all CPU), &players=2..4, &rounds=N, &seed=N, &cpu=easy|normal|hard,
 *            &intro (play the board intro), &instructions=on|quick|off, &midgame (round 4, spread out).
 */
export class DevLaunchScene extends Phaser.Scene {
  private data0: DevLaunchData = {};

  constructor() {
    super('DevLaunch');
  }

  init(data: DevLaunchData): void {
    this.data0 = data ?? {};
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#10262e');
    const text = addText(this, 960, 540, 'Launching…', 48, { color: '#fff4dc' });
    const error = this.launch();
    if (error) {
      text.setText(`${error}\n\nPress B to return to the title screen`);
      this.events.on(Phaser.Scenes.Events.UPDATE, () => {
        if (input.any.pressed('B')) goTo(this, 'Title');
      });
    }
  }

  private num(key: string, fallback: number, min: number, max: number): number {
    const v = Number(URL_PARAMS.get(key));
    return URL_PARAMS.has(key) && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
  }

  private participants(): Participant[] {
    const players = this.num('players', 4, 2, 4);
    const humans = this.num('humans', 1, 0, players);
    const level = (['easy', 'normal', 'hard'].includes(URL_PARAMS.get('cpu') ?? '') ? URL_PARAMS.get('cpu') : 'normal') as CpuLevel;
    session.resetSlots();
    const pads = input.connectedPads();
    const out: Participant[] = [];
    for (let slot = 0; slot < players; slot++) {
      const human = slot < humans;
      const characterId = CHARACTER_IDS[slot];
      const cfg = session.slots[slot];
      cfg.characterId = characterId;
      cfg.cpuLevel = level;
      if (human) {
        const pad = pads[slot];
        const device = slot === 0 && !pad ? { kind: 'keyboard' as const } : pad ? { kind: 'gamepad' as const, index: pad.index } : slot === 0 ? { kind: 'keyboard' as const } : null;
        cfg.joined = true;
        cfg.device = device;
        input.assign(slot, device);
      } else {
        cfg.isCpu = true;
        input.assign(slot, null);
      }
      out.push({ slot, characterId, isCpu: !human, cpuLevel: level });
    }
    return out;
  }

  private seed(): number {
    const s = Number(URL_PARAMS.get('seed'));
    return Number.isFinite(s) && s > 0 ? s >>> 0 : randomSeed();
  }

  private instructions(): 'on' | 'quick' | 'off' {
    const v = URL_PARAMS.get('instructions');
    return v === 'on' || v === 'quick' || v === 'off' ? v : 'quick';
  }

  /**
   * &midgame: jump to round 4 with players spread along the trail and varied chips, relics and
   * items (for testing and screenshots of a match in progress).
   */
  private midgame(board: BoardDef): void {
    const m = session.match;
    if (!m) return;
    const graph = new BoardGraph(board);
    const walk = (n: number): string => {
      let id = board.startNode;
      for (let i = 0; i < n; i++) id = graph.node(id).next[0] ?? id;
      return id;
    };
    // P1 two spaces past the start (by the plaza: a scenic spot for turn screenshots)
    const spread = [2, 9, 14, 5];
    const chips = [23, 14, 31, 9];
    const relics = [1, 0, 2, 1];
    const items: ItemId[][] = [['wingstep_boots'], ['snare_seed', 'bubble_shield'], [], ['mystery_capsule']];
    m.round = Math.min(4, m.config.rounds);
    m.players.forEach((p, i) => {
      p.nodeId = walk(spread[i % 4]);
      p.trail = [];
      p.chips = chips[i % 4];
      p.relics = relics[i % 4];
      p.items = items[i % 4];
    });
  }

  /** Returns an error message, or null when a scene was started. */
  private launch(): string | null {
    if (this.data0.minigame) {
      const info = minigameInfo(this.data0.minigame);
      if (!info) return `Unknown minigame "${this.data0.minigame}"`;
      if (!registeredMinigames().has(info.sceneKey)) return `Minigame "${info.name}" is not available yet`;
      session.mode = 'minigame';
      const parts = this.participants();
      const launch: MinigameLaunch = {
        id: info.id,
        players: parts.map((p) => ({ slot: p.slot, characterId: p.characterId, isCpu: p.isCpu, cpuLevel: p.cpuLevel })),
        mode: 'free',
        seed: this.seed(),
        instructions: this.instructions(),
      };
      goTo(this, 'MinigameIntro', launch);
      return null;
    }
    if (this.data0.quick) {
      const board = findBoard(URL_PARAMS.get('board') ?? 'suncoil');
      if (!board) return `Unknown board "${URL_PARAMS.get('board')}"`;
      session.mode = 'board';
      const parts = this.participants();
      const level = parts.find((p) => p.isCpu)?.cpuLevel ?? 'normal';
      session.match = createMatch(
        {
          boardId: board.id,
          rounds: this.num('rounds', 10, 1, 30),
          cpuDifficulty: level,
          instructions: this.instructions(),
          events: URL_PARAMS.get('events') === 'chaotic' ? 'chaotic' : 'normal',
          speed: URL_PARAMS.get('speed') === 'normal' ? 'normal' : 'fast',
          seed: this.seed(),
        },
        parts,
        board,
      );
      if (URL_PARAMS.has('midgame')) this.midgame(board);
      saves.save(session.match);
      goTo(this, 'Board', { intro: URL_PARAMS.has('intro') });
      return null;
    }
    return 'Nothing to launch (use ?quick or ?minigame=<id>)';
  }
}
