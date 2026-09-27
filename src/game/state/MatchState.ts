import { ECONOMY, type CpuLevel, type EventMode, type GameSpeed, type InstructionMode } from '../constants';
import type { BoardDef } from '../board/types';
import { CHARACTERS, type CharacterId } from '../data/characters';
import { ITEM_IDS, type ItemId } from '../data/items';
import { Random } from '../util/Random';
import { BONUS_IDS, type BonusId } from './scoring';

export interface PlayerStats {
  spacesMoved: number;
  chipsEarned: number;
  chipsSpent: number;
  minigameWins: number;
  itemsUsed: number;
  eventsTriggered: number;
  luckyLandings: number;
  relicsBought: number;
}

export interface PlayerState {
  /** Player slot 0–3 (P1–P4); also the index into MatchState.players. */
  slot: number;
  characterId: CharacterId;
  name: string;
  isCpu: boolean;
  cpuLevel: CpuLevel;
  nodeId: string;
  /** Recently visited nodes, most recent last (used to retrace steps when moving backwards). */
  trail: string[];
  chips: number;
  relics: number;
  items: ItemId[];
  shielded: boolean;
  stats: PlayerStats;
}

export interface BoardState {
  relicGate: string;
  relicPrice: { price: number; untilRound: number } | null;
  bridgeBroken: { untilRound: number } | null;
  surge: { nodes: string[]; untilRound: number } | null;
  bouncy: { nodes: string[]; untilRound: number } | null;
  portalLinks: Record<string, string>;
  traps: { nodeId: string; owner: number }[];
  gatesOpen: { untilRound: number } | null;
}

export interface MatchConfig {
  boardId: string;
  /** 10, 15 or 20 from the menus (debug launches may use any count). */
  rounds: number;
  cpuDifficulty: CpuLevel;
  instructions: InstructionMode;
  events: EventMode;
  speed: GameSpeed;
  seed: number;
}

export type MatchPhase = { kind: 'roundStart' } | { kind: 'turn'; index: number } | { kind: 'minigame' } | { kind: 'bonus' } | { kind: 'over' };

export interface MatchState {
  version: 1;
  id: string;
  config: MatchConfig;
  /** 1-based round number. */
  round: number;
  phase: MatchPhase;
  players: PlayerState[];
  board: BoardState;
  /** Serialised RNG state. */
  rng: number;
  minigameHistory: string[];
  bonusCategories: BonusId[];
  /** Short log of notable things (shown in debug). */
  log: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Participant {
  slot: number;
  characterId: CharacterId;
  isCpu: boolean;
  cpuLevel: CpuLevel;
}

export function emptyStats(): PlayerStats {
  return { spacesMoved: 0, chipsEarned: 0, chipsSpent: 0, minigameWins: 0, itemsUsed: 0, eventsTriggered: 0, luckyLandings: 0, relicsBought: 0 };
}

export function createMatch(config: MatchConfig, participants: Participant[], board: BoardDef): MatchState {
  if (participants.length < 2 || participants.length > 4) throw new Error('A match needs 2–4 players');
  const rng = new Random(config.seed);
  const players: PlayerState[] = participants
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((p) => ({
      slot: p.slot,
      characterId: p.characterId,
      name: CHARACTERS[p.characterId].name,
      isCpu: p.isCpu,
      cpuLevel: p.cpuLevel,
      nodeId: board.startNode,
      trail: [],
      chips: ECONOMY.startingChips,
      relics: 0,
      items: [],
      shielded: false,
      stats: emptyStats(),
    }));
  const portalLinks: Record<string, string> = {};
  for (const [a, b] of board.portals) {
    portalLinks[a] = b;
    portalLinks[b] = a;
  }
  // First relic gate: a random gate that isn't right next to the start.
  const far = board.relicGates.filter((g) => g !== board.startNode);
  const relicGate = rng.pick(far.length ? far : board.relicGates);
  const bonusCategories = rng.shuffle([...BONUS_IDS]).slice(0, 3);
  const now = Date.now();
  return {
    version: 1,
    id: `m${config.seed.toString(36)}${now.toString(36)}`,
    config,
    round: 1,
    phase: { kind: 'roundStart' },
    players,
    board: {
      relicGate,
      relicPrice: null,
      bridgeBroken: null,
      surge: null,
      bouncy: null,
      portalLinks,
      traps: [],
      gatesOpen: null,
    },
    rng: rng.state,
    minigameHistory: [],
    bonusCategories,
    log: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function isFinalRound(s: MatchState): boolean {
  return s.round === s.config.rounds;
}

export function currentRelicPrice(s: MatchState): number {
  const o = s.board.relicPrice;
  return o && o.untilRound >= s.round ? o.price : ECONOMY.relicPrice;
}

export function serializeMatch(s: MatchState): string {
  return JSON.stringify({ ...s, updatedAt: Date.now() });
}

/** Parse and validate a saved match; returns null for anything malformed or from another version. */
export function deserializeMatch(json: string, knownNodes?: Set<string>): MatchState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as MatchState;
  if (s.version !== 1 || !s.config || !Array.isArray(s.players) || !s.board || typeof s.round !== 'number') return null;
  if (s.players.length < 2 || s.players.length > 4) return null;
  if (typeof s.rng !== 'number' || !s.phase || typeof s.phase.kind !== 'string') return null;
  for (const p of s.players) {
    if (!(p.characterId in CHARACTERS)) return null;
    if (typeof p.chips !== 'number' || typeof p.relics !== 'number' || !Array.isArray(p.items)) return null;
    if (p.items.some((i) => !ITEM_IDS.includes(i))) return null;
    if (knownNodes && !knownNodes.has(p.nodeId)) return null;
    p.stats = { ...emptyStats(), ...(p.stats ?? {}) };
    p.trail = Array.isArray(p.trail) ? p.trail.filter((t) => typeof t === 'string').slice(-16) : [];
    p.shielded = !!p.shielded;
  }
  if (knownNodes && !knownNodes.has(s.board.relicGate)) return null;
  s.board.traps ??= [];
  s.board.portalLinks ??= {};
  s.minigameHistory ??= [];
  s.log ??= [];
  s.bonusCategories = (s.bonusCategories ?? []).filter((b) => BONUS_IDS.includes(b));
  return s;
}

/** Add a short entry to the match log (capped). */
export function logMatch(s: MatchState, text: string): void {
  s.log.push(`R${s.round}: ${text}`);
  if (s.log.length > 40) s.log.shift();
}
