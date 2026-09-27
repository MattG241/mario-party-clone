// Per-character animation mappings.
//
// Heroes with a rendered 3D sheet (scripts/art/characters.py → heroSprites.generated.ts) take every
// animation from it. The tables below describe the supplied 2D sheets, used as a fallback.
//
// Frame numbers refer to the processed atlases (see scripts/sprite-layouts.mjs). They were
// chosen by inspecting every supplied sheet — adjust them here, never elsewhere in the code.
//
//   Character sheets (kip / mossi / zippa): standard order
//     0–2 idle · 3–5 walk · 6–8 run · 9–11 jump · 12–14 celebrate · 15–17 disappointed
//     18–20 surprised · 21–23 stunned · 24–26 wave · 27–29 victory
//   Tumble Flint's sheet uses a different order (verified visually):
//     0–2 idle · 3–5 walk · 6–11 run · 12–16 jump (crouch, rise, apex, land, recover)
//     17 low crouch · 18–20 celebrate · 21–23 disappointed · 24–25 surprised · 26 stunned
//     27–29 victory · (no wave row: a fist-raise greeting is used instead)
//   Character-action sheet ('actions', 36 frames): per character K/M/T/Z in that order
//     0–3 sprint · 4–7 carry · 8–11 throw · 12–15 balance · 16–19 swim · 20–23 climb
//     24–27 dash · 28–31 fall · 32–35 cheer   (24–35 are drawn ~1.45× smaller)
//   Board-action sheet ('boardfx'): 0–2 Kip Orbit Dial · 3–5 Mossi Orbit Dial
//     12–13 Tumble coins · 14–15 Kip coins · 16 Zippa coins · 17 Zippa loses coins
//     18–20 Mossi portal · 21–23 Tumble portal · 29 group pose
import type { CharacterId } from '../data/characters';
import { HERO_DATA } from '../data/heroSprites.generated';

export type AnimName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'celebrate'
  | 'disappointed'
  | 'surprised'
  | 'stunned'
  | 'wave'
  | 'victory'
  | 'crouch'
  | 'sprint'
  | 'carry'
  | 'throw'
  | 'balance'
  | 'swim'
  | 'climb'
  | 'dash'
  | 'fall'
  | 'cheer'
  | 'dial'
  | 'coins'
  | 'loseCoins'
  | 'portal'
  | 'pull';

export interface AnimDef {
  frames: number[];
  fps: number;
  loop: boolean;
  /** Atlas key; defaults to the character's own sheet. */
  atlas?: string;
  /** Size correction for frames drawn at a different scale. */
  scale?: number;
}

export const LOOPING: readonly AnimName[] = ['idle', 'walk', 'run', 'swim', 'climb'];

/** Frame rates from the design brief: idle 4–5, walk 8–10, run 10–12, jump 8–10, emotes 6–8. */
export const FPS = { idle: 4.5, walk: 9, run: 11, jump: 9, emote: 7 } as const;

const BAND_SCALE = 1.45;

type AnimSet = Record<AnimName, AnimDef>;

type BoardAnims = Pick<AnimSet, 'dial' | 'coins' | 'loseCoins' | 'portal'>;

/** The standard 30-frame character layout (Kip, Mossi, Zippa). */
function standard(slot: number, board: BoardAnims): AnimSet {
  return {
    idle: { frames: [0, 1, 2, 1], fps: FPS.idle, loop: true },
    walk: { frames: [3, 4, 5, 4], fps: FPS.walk, loop: true },
    run: { frames: [6, 7, 8], fps: FPS.run, loop: true },
    jump: { frames: [9, 10, 11], fps: FPS.jump, loop: false },
    celebrate: { frames: [12, 13, 14, 13, 14], fps: FPS.emote, loop: false },
    disappointed: { frames: [15, 16, 17, 17], fps: 6, loop: false },
    surprised: { frames: [18, 19, 20, 19], fps: FPS.emote, loop: false },
    stunned: { frames: [21, 22, 23, 22, 23], fps: 6, loop: false },
    wave: { frames: [24, 25, 26, 25, 26], fps: FPS.emote, loop: false },
    victory: { frames: [27, 28, 29, 28, 29], fps: FPS.emote, loop: false },
    crouch: { frames: [9], fps: 3, loop: false },
    pull: { frames: [9], fps: 3, loop: false },
    ...actionAnims(slot),
    ...board,
  };
}

function actionAnims(slot: number): Pick<AnimSet, 'sprint' | 'carry' | 'throw' | 'balance' | 'swim' | 'climb' | 'dash' | 'fall' | 'cheer'> {
  const a = 'actions';
  return {
    sprint: { frames: [slot], fps: 2, loop: false, atlas: a },
    carry: { frames: [4 + slot], fps: 2, loop: false, atlas: a },
    throw: { frames: [8 + slot], fps: 3, loop: false, atlas: a },
    balance: { frames: [12 + slot], fps: 2, loop: false, atlas: a },
    swim: { frames: [16 + slot], fps: 1, loop: true, atlas: a },
    climb: { frames: [20 + slot], fps: 1, loop: true, atlas: a },
    dash: { frames: [24 + slot], fps: 3, loop: false, atlas: a, scale: BAND_SCALE },
    fall: { frames: [28 + slot], fps: 1.5, loop: false, atlas: a, scale: BAND_SCALE },
    cheer: { frames: [32 + slot], fps: 1.5, loop: false, atlas: a, scale: BAND_SCALE },
  };
}

const SHEET_ANIMATIONS: Record<CharacterId, AnimSet> = {
  kip: standard(0, {
    dial: { frames: [0, 1, 2, 1, 2], fps: 10, loop: false, atlas: 'boardfx' },
    coins: { frames: [14, 15, 14, 15], fps: FPS.emote, loop: false, atlas: 'boardfx' },
    loseCoins: { frames: [15, 16, 17, 17], fps: 6, loop: false },
    portal: { frames: [9, 10, 11], fps: FPS.jump, loop: false },
  }),
  mossi: standard(1, {
    dial: { frames: [3, 4, 5, 4, 5], fps: 10, loop: false, atlas: 'boardfx' },
    coins: { frames: [12, 13, 14, 13, 14], fps: FPS.emote, loop: false },
    loseCoins: { frames: [15, 16, 17, 17], fps: 6, loop: false },
    portal: { frames: [18, 19, 20], fps: 6, loop: false, atlas: 'boardfx' },
  }),
  tumble: {
    idle: { frames: [0, 1, 2, 1], fps: FPS.idle, loop: true },
    walk: { frames: [3, 4, 5, 4], fps: 8, loop: true },
    run: { frames: [6, 7, 8, 9], fps: 10, loop: true },
    jump: { frames: [12, 13, 14, 15], fps: FPS.jump, loop: false },
    celebrate: { frames: [18, 19, 20, 19, 20], fps: FPS.emote, loop: false },
    disappointed: { frames: [21, 22, 22], fps: 6, loop: false },
    surprised: { frames: [24, 25, 24, 25], fps: FPS.emote, loop: false },
    stunned: { frames: [25, 26, 26, 26], fps: 6, loop: false },
    wave: { frames: [16, 27, 16, 27], fps: 6, loop: false },
    victory: { frames: [27, 28, 29, 28, 29], fps: FPS.emote, loop: false },
    crouch: { frames: [17], fps: 3, loop: false },
    pull: { frames: [12], fps: 3, loop: false },
    ...actionAnims(2),
    dial: { frames: [16, 27, 27], fps: 6, loop: false },
    coins: { frames: [12, 13, 12, 13], fps: FPS.emote, loop: false, atlas: 'boardfx' },
    loseCoins: { frames: [21, 22, 22], fps: 6, loop: false },
    portal: { frames: [21, 22, 23], fps: 6, loop: false, atlas: 'boardfx' },
  },
  zippa: standard(3, {
    dial: { frames: [24, 25, 26, 25, 26], fps: 8, loop: false },
    coins: { frames: [16, 16], fps: 3, loop: false, atlas: 'boardfx' },
    loseCoins: { frames: [17, 17], fps: 2, loop: false, atlas: 'boardfx' },
    portal: { frames: [9, 10, 11], fps: FPS.jump, loop: false },
  }),
};

/** The rendered 3D sheet's animations (scripts/art/characters.py), when present. */
function renderedAnims(id: CharacterId): AnimSet | null {
  const data = HERO_DATA.anims[id];
  if (!data) return null;
  const out = {} as AnimSet;
  for (const [name, a] of Object.entries(data)) out[name as AnimName] = { frames: a.frames, fps: a.fps, loop: a.loop };
  return out;
}

export const CHARACTER_ANIMATIONS: Record<CharacterId, AnimSet> = {
  kip: renderedAnims('kip') ?? SHEET_ANIMATIONS.kip,
  mossi: renderedAnims('mossi') ?? SHEET_ANIMATIONS.mossi,
  tumble: renderedAnims('tumble') ?? SHEET_ANIMATIONS.tumble,
  zippa: renderedAnims('zippa') ?? SHEET_ANIMATIONS.zippa,
};

/** Phaser animation key for a character + animation. */
export function animKey(id: CharacterId, anim: AnimName): string {
  return `${id}:${anim}`;
}

/** NPC poses (npcs atlas): six frames per NPC in the order listed in data/npcs.ts. */
export const NPC_FRAMES_PER_ROW = 6;
