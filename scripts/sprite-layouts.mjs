// Sprite sheet layout manifest.
//
// Every supplied sheet was inspected programmatically (see README → "Sprite pipeline").
// All sheets are 1374 × 1145 RGBA, but they are NOT all a uniform 6 × 5 grid of 229 px cells:
//
//   * Characters, NPCs, VFX and board-action sheets: 6 × 5 grid, but sprites overflow their
//     cells by up to ~30 px, so naive 229 px slicing clips limbs and pulls in neighbours.
//   * Items and props: 6 columns × 6 rows (row pitch ≈ 191 px, uneven), i.e. 36 frames.
//   * Character-action sheet: four 229 px grid rows (24 frames) followed by a squeezed band of
//     12 smaller sprites in two half-rows (5 + 7).
//
// Each frame is described by two rectangles:
//   partition – the region used to decide pixel ownership (connected components whose pixels
//               mostly fall inside a partition belong entirely to that frame).
//   logical   – the frame's coordinate box. The output frame is this box grown by PAD on every
//               side, so relative positions inside a row stay exactly as the artist drew them
//               (animations keep their registration) while overflow is preserved.

export const SHEET_W = 1374;
export const SHEET_H = 1145;
export const CELL = 229;

/** Uniform 6 × 5 grid of 229 px cells. */
function grid(cols = 6, rows = 5) {
  const frames = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rect = [c * CELL, r * CELL, CELL, CELL];
      frames.push({ partition: rect, logical: rect });
    }
  }
  return frames;
}

/** 6 columns with explicit (uneven) row boundaries. */
function rows(bounds, cols = 6) {
  const frames = [];
  for (let r = 0; r < bounds.length - 1; r++) {
    const y0 = bounds[r];
    const h = bounds[r + 1] - y0;
    for (let c = 0; c < cols; c++) {
      const rect = [c * CELL, y0, CELL, h];
      frames.push({ partition: rect, logical: rect });
    }
  }
  return frames;
}

/** A band of sprites split at explicit x boundaries, with a shared baseline for the logical box. */
function band(xBounds, y0, y1, baseline) {
  const frames = [];
  for (let i = 0; i < xBounds.length - 1; i++) {
    const x0 = xBounds[i];
    const x1 = xBounds[i + 1];
    // logical: null → the build script centres a CELL-wide box on the frame's artwork.
    frames.push({ partition: [x0, y0, x1 - x0, y1 - y0], logical: null, baseline });
  }
  return frames;
}

function actionSheet() {
  const frames = [];
  // Rows 0–3 sit on the 229 grid. Row 3's ownership region stops where the squeezed band starts.
  const partRows = [
    [0, 229],
    [229, 458],
    [458, 687],
    [687, 858],
  ];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      frames.push({
        partition: [c * CELL, partRows[r][0], CELL, partRows[r][1] - partRows[r][0]],
        logical: [c * CELL, r * CELL, CELL, CELL],
      });
    }
  }
  // 24–28: Kip dash, Mossi dash, Tumble dash, Zippa dash, Kip fall.
  frames.push(...band([0, 242, 482, 747, 985, 1374], 858, 1000, 1016));
  // 29–35: Mossi fall, Tumble fall, Zippa fall, Kip cheer, Mossi cheer, Tumble cheer, Zippa cheer.
  frames.push(...band([0, 220, 438, 615, 790, 987, 1211, 1374], 1000, SHEET_H, SHEET_H));
  return frames;
}

/**
 * key      – texture key used in the game (also the atlas file name).
 * file     – the supplied sheet under public/assets/sprites/.
 * frames   – frame rectangles (see above).
 * anchor   – how the frame is usually displayed: 'feet' (characters on the ground) or 'center'.
 * overrides – optional hand fixes: strong pixels inside `rect` (sheet coordinates) are forced to
 *             belong to `frame`. Use only where the artwork physically fuses two frames.
 */
export const SHEETS = [
  { key: 'kip', file: 'cartoon_adventurer_animation_sprite_sheet.png', frames: grid(), anchor: 'feet' },
  {
    key: 'mossi',
    file: 'plant_hero_animation_sprite_sheet.png',
    frames: grid(),
    anchor: 'feet',
    // Frame 21's planted shoe sits flush on frame 27's hair; hand it back to frame 21.
    overrides: [{ frame: 21, rect: [786, 896, 56, 52] }],
  },
  { key: 'tumble', file: 'tumble_flint_30_frame_sprite_sheet.png', frames: grid(), anchor: 'feet' },
  { key: 'zippa', file: 'zippa_wren_dynamic_squirrel_sprite_sheet.png', frames: grid(), anchor: 'feet' },
  { key: 'boardfx', file: 'board_game_adventure_action_sprite_sheet.png', frames: grid(), anchor: 'feet' },
  { key: 'npcs', file: 'colourful_3d_npc_sprite_sheet.png', frames: grid(), anchor: 'feet' },
  { key: 'actions', file: 'colourful_cartoon_game_character_sprite_sheet.png', frames: actionSheet(), anchor: 'feet' },
  { key: 'vfx', file: 'colourful_cartoon_game_vfx_sprite_sheet.png', frames: grid(), anchor: 'center' },
  {
    key: 'items',
    file: 'fantasy_adventure_item_sprite_sheet.png',
    frames: rows([0, 205, 410, 604, 779, 950, SHEET_H]),
    anchor: 'center',
  },
  {
    key: 'props',
    file: 'glossy_fantasy_prop_sprite_sheet.png',
    frames: rows([0, 212, 415, 612, 802, 998, SHEET_H]),
    anchor: 'feet',
  },
];
