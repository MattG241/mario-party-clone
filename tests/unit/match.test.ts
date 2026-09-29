import { CHARACTER_IDS } from '../../src/game/data/characters';
import { describe, expect, it } from 'vitest';
import { SUNCOIL } from './suncoilBoard';
import { SaveManager } from '../../src/game/save/SaveManager';
import { SettingsManager } from '../../src/game/save/SettingsManager';
import { createMatch, currentRelicPrice, deserializeMatch, isFinalRound, serializeMatch } from '../../src/game/state/MatchState';
import { BONUS_IDS } from '../../src/game/state/scoring';
import { CONFIG, FOUR, memoryStore } from './fixtures';

describe('match creation', () => {
  it('starts everyone on the start space with 10 chips and no relics', () => {
    const m = createMatch(CONFIG, FOUR, SUNCOIL);
    expect(m.players).toHaveLength(4);
    for (const p of m.players) {
      expect(p.nodeId).toBe('p0');
      expect(p.chips).toBe(10);
      expect(p.relics).toBe(0);
      expect(p.items).toEqual([]);
    }
    expect(m.round).toBe(1);
    expect(m.phase).toEqual({ kind: 'roundStart' });
  });

  it('places the relic on a real gate and chooses three distinct bonus categories', () => {
    const m = createMatch(CONFIG, FOUR, SUNCOIL);
    expect(SUNCOIL.relicGates).toContain(m.board.relicGate);
    expect(new Set(m.bonusCategories).size).toBe(3);
    for (const b of m.bonusCategories) expect(BONUS_IDS).toContain(b);
  });

  it('is deterministic for a given seed', () => {
    const a = createMatch(CONFIG, FOUR, SUNCOIL);
    const b = createMatch(CONFIG, FOUR, SUNCOIL);
    expect(a.board.relicGate).toBe(b.board.relicGate);
    expect(a.bonusCategories).toEqual(b.bonusCategories);
    expect(a.rng).toBe(b.rng);
  });

  it('requires 2–4 players and sorts them by slot', () => {
    expect(() => createMatch(CONFIG, FOUR.slice(0, 1), SUNCOIL)).toThrow();
    const m = createMatch(CONFIG, [FOUR[2], FOUR[0]], SUNCOIL);
    expect(m.players.map((p) => p.slot)).toEqual([0, 2]);
  });

  it('knows the final round and relic price overrides', () => {
    const m = createMatch({ ...CONFIG, rounds: 10 }, FOUR, SUNCOIL);
    expect(isFinalRound(m)).toBe(false);
    m.round = 10;
    expect(isFinalRound(m)).toBe(true);
    expect(currentRelicPrice(m)).toBe(20);
    m.board.relicPrice = { price: 15, untilRound: 10 };
    expect(currentRelicPrice(m)).toBe(15);
    m.round = 11;
    expect(currentRelicPrice(m)).toBe(20);
  });
});

describe('save serialization', () => {
  const nodes = new Set(SUNCOIL.nodes.map((n) => n.id));

  it('round-trips a match through JSON', () => {
    const m = createMatch(CONFIG, FOUR, SUNCOIL);
    m.round = 4;
    m.phase = { kind: 'turn', index: 2 };
    m.players[1].chips = 33;
    m.players[1].relics = 2;
    m.players[1].items = ['prism_key', 'spring_bean'];
    m.players[2].nodeId = 't3';
    m.board.bridgeBroken = { untilRound: 6 };
    m.board.traps.push({ nodeId: 'g1', owner: 3 });
    const restored = deserializeMatch(serializeMatch(m), nodes)!;
    expect(restored).not.toBeNull();
    expect(restored.round).toBe(4);
    expect(restored.phase).toEqual({ kind: 'turn', index: 2 });
    expect(restored.players[1]).toMatchObject({ chips: 33, relics: 2, items: ['prism_key', 'spring_bean'] });
    expect(restored.players[2].nodeId).toBe('t3');
    expect(restored.board.bridgeBroken).toEqual({ untilRound: 6 });
    expect(restored.board.traps).toEqual([{ nodeId: 'g1', owner: 3 }]);
    expect(restored.rng).toBe(m.rng);
    expect(restored.config.seed).toBe(CONFIG.seed);
  });

  it('rejects corrupted or incompatible saves', () => {
    expect(deserializeMatch('not json')).toBeNull();
    expect(deserializeMatch('{"version":2}')).toBeNull();
    const m = createMatch(CONFIG, FOUR, SUNCOIL);
    const bad = JSON.parse(serializeMatch(m));
    bad.players[0].nodeId = 'nowhere';
    expect(deserializeMatch(JSON.stringify(bad), nodes)).toBeNull();
    const badItem = JSON.parse(serializeMatch(m));
    badItem.players[0].items = ['laser_sword'];
    expect(deserializeMatch(JSON.stringify(badItem))).toBeNull();
  });

  it('saves, detects and restores via the SaveManager', () => {
    const store = memoryStore();
    const saves = new SaveManager(store);
    expect(saves.hasSave()).toBe(false);
    const m = createMatch(CONFIG, FOUR, SUNCOIL);
    m.players[0].chips = 17;
    expect(saves.save(m)).toBe(true);
    expect(saves.hasSave()).toBe(true);
    const loaded = saves.load(nodes)!;
    expect(loaded.players[0].chips).toBe(17);
    saves.clear();
    expect(saves.hasSave()).toBe(false);
  });

  it('drops an unreadable save instead of crashing', () => {
    const store = memoryStore();
    store.setItem('gleamtrail.save.v1', '{broken');
    const saves = new SaveManager(store);
    expect(saves.load(nodes)).toBeNull();
    expect(saves.hasSave()).toBe(false);
  });
});

describe('settings persistence', () => {
  it('stores and reloads settings, clamping bad values', () => {
    const store = memoryStore();
    const s = new SettingsManager(store);
    s.set({ musicVolume: 0.25, largeText: true, gameSpeed: 'fast', lastCharacters: [CHARACTER_IDS[3], null, CHARACTER_IDS[0], null] });
    const again = new SettingsManager(store);
    expect(again.get()).toMatchObject({ musicVolume: 0.25, largeText: true, gameSpeed: 'fast', lastCharacters: [CHARACTER_IDS[3], null, CHARACTER_IDS[0], null] });
    store.setItem('gleamtrail.settings.v1', JSON.stringify({ sfxVolume: 7, rounds: 13, deadzone: 0.9 }));
    const clamped = new SettingsManager(store).get();
    expect(clamped.sfxVolume).toBe(1);
    expect(clamped.rounds).toBe(10);
    expect(clamped.deadzone).toBe(0.3);
  });

  it('keeps default key bindings for missing actions', () => {
    const store = memoryStore();
    store.setItem('gleamtrail.settings.v1', JSON.stringify({ keyBindings: { A: ['KeyJ'] } }));
    const s = new SettingsManager(store).get();
    expect(s.keyBindings.A).toEqual(['KeyJ']);
    expect(s.keyBindings.B).toEqual(['Escape', 'Backspace']);
  });
});
