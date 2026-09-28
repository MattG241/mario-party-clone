// Pure rules behind the shared minigame HUD's reactions (no Phaser here, so they can be unit tested).

/**
 * The one slot strictly ahead of everyone else, or null: nobody leads on a tie, or while the best
 * score is still zero (so the crown only ever means "this player is winning").
 */
export function uniqueLeader(scores: readonly { slot: number; score: number }[]): number | null {
  let best = -Infinity;
  let slot: number | null = null;
  let tied = false;
  for (const s of scores) {
    if (s.score > best) {
      best = s.score;
      slot = s.slot;
      tied = false;
    } else if (s.score === best) tied = true;
  }
  return !tied && best > 0 ? slot : null;
}

/**
 * Whether a HUD label change is a score going up (plain numbers only: "12" -> "13"). Labels such as
 * "12 m" or "1st" still bump, but only a rising number earns the colour flash.
 */
export function isScoreGain(before: string, after: string): boolean {
  if (!/^\d+$/.test(before) || !/^\d+$/.test(after)) return false;
  return Number(after) > Number(before);
}

/** Whether a timed round is long enough for the "FINAL 10 SECONDS!" stretch. */
export function hasFinalStretch(durationMs: number): boolean {
  return durationMs >= 25000;
}
