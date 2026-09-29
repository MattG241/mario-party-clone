// Pre-rendered environment art (produced by scripts/art/*.py with Blender). Everything here is
// optional: when a manifest or tile is missing the game falls back to the vector placeholder art.
import type Phaser from 'phaser';
import { LITE } from '../perf';

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
  /** Soft island shadow cast onto the cloud sea (board px rect). */
  shadow?: { file: string; x: number; y: number; w: number; h: number };
}

/** Boards whose rendered art loads at start-up (none: each board's art loads when it's played). */
export const RENDERED_BOARDS: readonly string[] = [];

export const renderedManifestKey = (board: string): string => `rendered-${board}`;
export const renderedTileKey = (board: string, file: string): string => `rendered-${board}-${file}`;
/** Lite graphics load the half-resolution board (public/assets/lite, same manifest format). */
export const renderedPath = (board: string, file: string): string => `assets/${LITE ? 'lite' : 'rendered'}/${board}/${file}`;

/** True for loader keys whose failure must not block the game. */
export const isOptionalAsset = (key: string): boolean => key.startsWith('rendered-');

/** Boards whose rendered art has been loaded this session (so the others can be released). */
const heldBoards = new Set<string>(RENDERED_BOARDS);

/**
 * Queue a board's rendered art on the scene's loader (call from preload): its manifest if it isn't
 * cached yet, then whichever tiles, props and shadow aren't in memory. Every other board's terrain
 * is released first, so only one board's tiles are held at a time.
 */
export function queueBoardArt(scene: Phaser.Scene, board: string): void {
  for (const other of heldBoards) {
    if (other === board) continue;
    const man = scene.cache.json.get(renderedManifestKey(other)) as RenderedBoard | undefined;
    if (!man?.tiles) continue;
    const files = [...man.tiles.map((t) => t.file), ...(man.shadow ? [man.shadow.file] : []), ...(man.props ?? []).map((pr) => pr.file)];
    for (const f of files) {
      const k = renderedTileKey(other, f);
      if (scene.textures.exists(k)) scene.textures.remove(k);
    }
  }
  heldBoards.add(board);
  const image = (file: string) => {
    const k = renderedTileKey(board, file);
    if (!scene.textures.exists(k)) scene.load.image(k, renderedPath(board, file));
  };
  const queueFiles = (data: RenderedBoard | undefined) => {
    for (const t of data?.tiles ?? []) image(t.file);
    for (const pr of data?.props ?? []) image(pr.file);
    if (data?.shadow) image(data.shadow.file);
  };
  const key = renderedManifestKey(board);
  if (scene.cache.json.exists(key)) queueFiles(scene.cache.json.get(key) as RenderedBoard);
  else {
    scene.load.json(key, renderedPath(board, 'manifest.json'));
    scene.load.once(`filecomplete-json-${key}`, (_k: string, _t: string, data: RenderedBoard) => queueFiles(data));
  }
}
