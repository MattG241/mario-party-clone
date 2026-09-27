import { describe, expect, it } from 'vitest';
import { emptyStats } from '../../src/game/state/MatchState';
import { computeBonusAwards, computeStandings, minigameRewards, placementsFromScores, rewardForPlace, winners } from '../../src/game/state/scoring';

describe('final standings', () => {
  it('ranks by relics, then chips', () => {
    const s = computeStandings([
      { slot: 0, relics: 2, chips: 5 },
      { slot: 1, relics: 3, chips: 0 },
      { slot: 2, relics: 2, chips: 30 },
      { slot: 3, relics: 0, chips: 99 },
    ]);
    expect(s.map((x) => [x.slot, x.place])).toEqual([
      [1, 1],
      [2, 2],
      [0, 3],
      [3, 4],
    ]);
  });

  it('allows shared places on full ties', () => {
    const s = computeStandings([
      { slot: 0, relics: 2, chips: 10 },
      { slot: 1, relics: 2, chips: 10 },
      { slot: 2, relics: 1, chips: 50 },
    ]);
    expect(s.map((x) => x.place)).toEqual([1, 1, 3]);
    expect(winners([
      { slot: 0, relics: 2, chips: 10 },
      { slot: 1, relics: 2, chips: 10 },
    ])).toEqual([0, 1]);
  });
});

describe('minigame rewards', () => {
  it('pays 10 / 6 / 3 / 1', () => {
    expect([1, 2, 3, 4].map(rewardForPlace)).toEqual([10, 6, 3, 1]);
  });

  it('turns scores into placements with ties', () => {
    const p = placementsFromScores([
      { slot: 0, score: 5 },
      { slot: 1, score: 9 },
      { slot: 2, score: 5 },
      { slot: 3, score: 1 },
    ]);
    expect(p).toEqual([
      { slot: 1, place: 1 },
      { slot: 0, place: 2 },
      { slot: 2, place: 2 },
      { slot: 3, place: 4 },
    ]);
    expect(minigameRewards(p).map((r) => r.chips)).toEqual([10, 6, 6, 1]);
  });
});

describe('bonus awards', () => {
  const players = [0, 1, 2, 3].map((slot) => ({ slot, stats: emptyStats() }));
  players[0].stats.spacesMoved = 40;
  players[1].stats.spacesMoved = 55;
  players[2].stats.spacesMoved = 55;
  players[3].stats.minigameWins = 4;

  it('gives the bonus to every tied leader', () => {
    const [trail] = computeBonusAwards(players, ['trailblazer']);
    expect(trail.winners).toEqual([1, 2]);
    expect(trail.values.find((v) => v.slot === 0)?.value).toBe(40);
  });

  it('awards nobody when nobody scored', () => {
    const [items] = computeBonusAwards(players, ['itemExpert']);
    expect(items.winners).toEqual([]);
  });

  it('awards the single leader', () => {
    const [champ] = computeBonusAwards(players, ['gameChampion']);
    expect(champ.winners).toEqual([3]);
  });
});
