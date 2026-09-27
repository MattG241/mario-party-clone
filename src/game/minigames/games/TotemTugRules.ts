// Totem Tug: team split and team placements (pure, Phaser-free so they can be unit-tested).

export type Team = 0 | 1;

export interface PullerTally {
  slot: number;
  team: Team;
  /** Pull power contribution (HUD score). */
  power: number;
}

/**
 * Team for a player by launch order: 1 & 2 (left) vs 3 & 4 (right); with three players P1 pulls
 * alone on the left against the other two; with two it is 1 v 1.
 */
export function teamOf(index: number, playerCount: number): Team {
  if (playerCount >= 4) return index < 2 ? 0 : 1;
  return index === 0 ? 0 : 1;
}

/**
 * Winner at the buzzer: the side the totem is on (offset < 0 is the left team's side). A totem
 * within `drawEps` of dead centre falls back to total pull power; null when that is level too.
 */
export function buzzerWinner(offset: number, tallies: readonly PullerTally[], drawEps: number): Team | null {
  if (Math.abs(offset) > drawEps) return offset < 0 ? 0 : 1;
  const total = (t: Team) => tallies.filter((u) => u.team === t).reduce((a, u) => a + u.power, 0);
  const a = total(0);
  const b = total(1);
  return a === b ? null : a > b ? 0 : 1;
}

/**
 * Results scores: team-mates always share a place (winning team 2, losing team 1). Only a full
 * draw (winner null) lets individual pull power split the players.
 */
export function teamFinalScores(tallies: readonly PullerTally[], winner: Team | null): { slot: number; score: number; label: string }[] {
  return tallies.map((u) => {
    const pts = Math.round(u.power);
    if (winner === null) return { slot: u.slot, score: u.power, label: `Level · ${pts} pts` };
    const won = u.team === winner;
    return { slot: u.slot, score: won ? 2 : 1, label: `${won ? 'Won!' : 'Lost'} · ${pts} pts` };
  });
}
