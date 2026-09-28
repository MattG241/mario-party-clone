// Orbit Dodge's pure rules (no Phaser here, so they can be unit tested): which clean dodges were
// genuine near misses. Most dodges earn nothing; only the tight ones get a call-out, so it never
// turns into noise.

export type NearMiss = 'nice' | 'close' | null;

/**
 * A jump over the low arm, judged by the jumper's height as it passed underneath: a hair above
 * the clearance is a close call; a little higher on the way up (a late, sharp jump) is nice.
 */
export function jumpNearMiss(z: number, vz: number, clearZ: number): NearMiss {
  if (z <= clearZ) return null;
  if (z <= clearZ + 28) return 'close';
  if (z <= clearZ + 62 && vz > 0) return 'nice';
  return null;
}

/** A duck under the high arm, judged by how long before it passed the duck began (ms). */
export function duckNearMiss(heldMs: number): NearMiss {
  if (heldMs < 110) return 'close';
  if (heldMs < 220) return 'nice';
  return null;
}
