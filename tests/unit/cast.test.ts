import { describe, expect, it } from 'vitest';
import { castFor, SIDE_CHARACTERS } from '../../src/game/data/npcs';

describe('board cast', () => {
  it('casts the host and Star Keeper from the players’ own shows first', () => {
    const cast = castFor(['goku', 'sonic', 'obama', 'elvis']);
    expect(cast.ora).toBe('krillin');
    expect(cast.packsprout).toBe('tails');
  });

  it('fills every role with a different side character', () => {
    for (const players of [[], ['luffy', 'zoro', 'nami'], ['obama', 'trump'], ['batman', 'spiderman', 'ironman', 'homer']] as const) {
      const cast = castFor(players);
      expect(new Set(Object.values(cast)).size).toBe(5);
    }
  });

  it('falls back to the board’s world, then the default line-up, when the players bring none', () => {
    expect(castFor(['obama', 'trump'], ['spongebob']).ora).toBe('patrick');
    expect(castFor(['elvis', 'sabrina'], ['elvis']).ora).toBe('patrick');
    expect(Object.values(castFor(['elvis'], ['batman']))).toContain('alfred');
  });

  it('gives every side character a franchise from the roster', () => {
    for (const s of SIDE_CHARACTERS) expect(s.from.length).toBeGreaterThan(0);
  });
});
