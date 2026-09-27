import { describe, expect, it } from 'vitest';
import { buzzerWinner, teamFinalScores, teamOf, type PullerTally } from '../../src/game/minigames/games/TotemTugRules';
import { placementsFromScores } from '../../src/game/state/scoring';

const place = (tallies: PullerTally[], winner: 0 | 1 | null) => {
  const byslot = new Map(placementsFromScores(teamFinalScores(tallies, winner)).map((p) => [p.slot, p.place]));
  return tallies.map((t) => byslot.get(t.slot));
};

describe('totem tug teams', () => {
  it('splits 1&2 v 3&4, 1 v 2&3 and 1 v 1', () => {
    expect([0, 1, 2, 3].map((i) => teamOf(i, 4))).toEqual([0, 0, 1, 1]);
    expect([0, 1, 2].map((i) => teamOf(i, 3))).toEqual([0, 1, 1]);
    expect([0, 1].map((i) => teamOf(i, 2))).toEqual([0, 1]);
  });

  it('team-mates share a place whatever their own pull power', () => {
    const t: PullerTally[] = [
      { slot: 0, team: 0, power: 120 },
      { slot: 1, team: 0, power: 40 },
      { slot: 2, team: 1, power: 300 },
      { slot: 3, team: 1, power: 290 },
    ];
    expect(place(t, 0)).toEqual([1, 1, 3, 3]);
    expect(place(t, 1)).toEqual([3, 3, 1, 1]);
  });

  it('handles the lone puller of a 3-player game', () => {
    const t: PullerTally[] = [
      { slot: 0, team: 0, power: 500 },
      { slot: 1, team: 1, power: 100 },
      { slot: 2, team: 1, power: 90 },
    ];
    expect(place(t, 0)).toEqual([1, 2, 2]);
    expect(place(t, 1)).toEqual([3, 1, 1]);
  });

  it('decides the buzzer by the totem side, then by team pull power', () => {
    const t: PullerTally[] = [
      { slot: 0, team: 0, power: 100 },
      { slot: 1, team: 1, power: 150 },
    ];
    expect(buzzerWinner(-30, t, 2)).toBe(0);
    expect(buzzerWinner(12, t, 2)).toBe(1);
    expect(buzzerWinner(1, t, 2)).toBe(1);
    expect(buzzerWinner(0, [{ slot: 0, team: 0, power: 50 }, { slot: 1, team: 1, power: 50 }], 2)).toBeNull();
  });

  it('only a full draw lets individual power split players', () => {
    const t: PullerTally[] = [
      { slot: 0, team: 0, power: 10 },
      { slot: 1, team: 1, power: 20 },
    ];
    expect(place(t, null)).toEqual([2, 1]);
    expect(teamFinalScores(t, 0).map((s) => s.label)).toEqual(['Won! · 10 pts', 'Lost · 20 pts']);
  });
});
