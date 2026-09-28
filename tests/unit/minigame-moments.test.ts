import { describe, expect, it } from 'vitest';
import { hasFinalStretch, isScoreGain, uniqueLeader } from '../../src/game/minigames/hudRules';
import { CHIP_LIFE, goldChance, nextStreak, spawnInterval, STORM_CHIP_LIFE, STREAK_GAP, streakCallout, streakPitch } from '../../src/game/minigames/games/gleamGrabRules';
import { duckNearMiss, jumpNearMiss } from '../../src/game/minigames/games/orbitDodgeRules';

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

describe('gleam grab: streaks and the chip storm', () => {
  it('keeps a streak going only while catches come quickly', () => {
    expect(nextStreak(0, -1e9, 1000)).toBe(1);
    expect(nextStreak(1, 1000, 1000 + STREAK_GAP)).toBe(2);
    expect(nextStreak(4, 1000, 1000 + STREAK_GAP + 1)).toBe(1);
  });

  it('calls out streaks at 3, 5, 7, 10 and every five after', () => {
    const called = Array.from({ length: 21 }, (_, n) => n).filter(streakCallout);
    expect(called).toEqual([3, 5, 7, 10, 15, 20]);
  });

  it('climbs the chime a semitone per catch, capped at an octave', () => {
    expect(streakPitch(1)).toBe(1);
    expect(streakPitch(2)).toBeCloseTo(Math.pow(2, 1 / 12));
    expect(streakPitch(13)).toBeCloseTo(2);
    expect(streakPitch(40)).toBeCloseTo(2);
  });

  it('rains harder over the round and harder still in the storm', () => {
    expect(spawnInterval(0, false)).toBe(620);
    expect(spawnInterval(1, false)).toBe(320);
    expect(spawnInterval(0.8, true)).toBeLessThan(spawnInterval(0.8, false));
    expect(goldChance(true)).toBeGreaterThan(goldChance(false));
    expect(STORM_CHIP_LIFE).toBeLessThan(CHIP_LIFE);
  });
});

describe('orbit dodge: near misses', () => {
  const CLEAR = 34;

  it('rates a jump by how close it came to the arm', () => {
    expect(jumpNearMiss(20, 500, CLEAR)).toBeNull();
    expect(jumpNearMiss(50, 700, CLEAR)).toBe('close');
    expect(jumpNearMiss(50, -700, CLEAR)).toBe('close');
    expect(jumpNearMiss(80, 400, CLEAR)).toBe('nice');
    // Clearing it high, or coming back down, is just a dodge.
    expect(jumpNearMiss(80, -400, CLEAR)).toBeNull();
    expect(jumpNearMiss(140, 100, CLEAR)).toBeNull();
  });

  it('rates a duck by how late it began', () => {
    expect(duckNearMiss(60)).toBe('close');
    expect(duckNearMiss(180)).toBe('nice');
    expect(duckNearMiss(400)).toBeNull();
  });
});
