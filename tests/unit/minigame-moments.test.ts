import { describe, expect, it } from 'vitest';
import { hasFinalStretch, isScoreGain, uniqueLeader } from '../../src/game/minigames/hudRules';

describe('minigame HUD: the leader crown', () => {
  it('crowns the one player strictly ahead', () => {
    expect(
      uniqueLeader([
        { slot: 0, score: 3 },
        { slot: 1, score: 7 },
        { slot: 2, score: 5 },
      ]),
    ).toBe(1);
  });

  it('crowns nobody on a tie for the lead, or before anyone has scored', () => {
    expect(
      uniqueLeader([
        { slot: 0, score: 7 },
        { slot: 1, score: 7 },
        { slot: 2, score: 5 },
      ]),
    ).toBeNull();
    expect(
      uniqueLeader([
        { slot: 0, score: 0 },
        { slot: 1, score: 0 },
      ]),
    ).toBeNull();
    // A lone leader still needs a score above zero.
    expect(
      uniqueLeader([
        { slot: 0, score: 0 },
        { slot: 1, score: -10 },
      ]),
    ).toBeNull();
  });

  it('flashes only for plain numbers going up', () => {
    expect(isScoreGain('4', '5')).toBe(true);
    expect(isScoreGain('5', '5')).toBe(false);
    expect(isScoreGain('6', '5')).toBe(false);
    expect(isScoreGain('12 m', '13 m')).toBe(false);
    expect(isScoreGain('2nd', '1st')).toBe(false);
  });

  it('gives only long timed rounds the final stretch', () => {
    expect(hasFinalStretch(45000)).toBe(true);
    expect(hasFinalStretch(25000)).toBe(true);
    expect(hasFinalStretch(20000)).toBe(false);
    expect(hasFinalStretch(0)).toBe(false);
  });
});
