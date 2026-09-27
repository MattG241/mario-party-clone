// Pre-rendered environment art (produced by scripts/art/*.py with Blender). Everything here is
// optional: when a manifest or tile is missing the game falls back to the vector placeholder art.

export interface RenderedTile {
  file: string;
  /** Position of the tile's top-left corner in render pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RenderedProp {
  id: string;
  file: string;
  /** Placeholder decoration texture this landmark replaces. */
  tex: string;
  kind: string;
  /** Top-left corner and size in board pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Ground anchor (depth-sorts with characters at this y). */
  anchorX: number;
  baseY: number;
  /** Depth-sort y when it differs from the anchor (flat platforms people stand on). */
  depthY?: number;
  /** Rotation centre for spinning parts (windmill sails). */
  hub?: [number, number];
}

export interface RenderedBoard {
  board: string;
  /** Board coordinate of the render's top-left pixel. */
  origin: [number, number];
  /** Render pixels per board pixel. */
  scale: number;
  tiles: RenderedTile[];
  props?: RenderedProp[];
  /** Trails, stepping stones and island art are baked in, so the board skips drawing them. */
  bakedPaths: boolean;
}

export const RENDERED_BOARDS = ['suncoil'] as const;

export const renderedManifestKey = (board: string): string => `rendered-${board}`;
export const renderedTileKey = (board: string, file: string): string => `rendered-${board}-${file}`;
export const renderedPath = (board: string, file: string): string => `assets/rendered/${board}/${file}`;

/** True for loader keys whose failure must not block the game. */
export const isOptionalAsset = (key: string): boolean => key.startsWith('rendered-');
