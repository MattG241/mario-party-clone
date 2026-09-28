// Board data model. Boards are graphs of spaces; players move node to node along `next`.

export type SpaceType = 'start' | 'gleam' | 'festival' | 'mischief' | 'market' | 'portal' | 'relic' | 'event';

export interface BoardNodeDef {
  id: string;
  x: number;
  y: number;
  type: SpaceType;
  /** Directed connections (forward movement). More than one = intersection. */
  next: string[];
  /** Board-specific event triggered on EVENT spaces. */
  eventId?: string;
  metadata?: NodeMeta;
}

export interface NodeMeta {
  /** Market run by this shop. */
  shop?: 'wrench' | 'pipper';
  /** Island / area name shown in UI. */
  region?: string;
  /** Exposed platform: Wind Gust pushes players standing here back. */
  exposed?: boolean;
  /** This node belongs to a breakable bridge. */
  bridge?: string;
  /** This node belongs to the detour that opens when the bridge breaks. */
  detour?: string;
  /** Entering this node from the previous one requires a Prism Key (shortcut gate). */
  gate?: string;
  /** Spring pad used by the Bouncy Trail event. */
  spring?: boolean;
  /** Label for signposts at intersections (per next-id). */
  signs?: Record<string, string>;
}

export interface BoardDecoration {
  texture: string;
  frame?: string;
  x: number;
  y: number;
  scale?: number;
  flipX?: boolean;
  /** Sort by y with characters (true) or draw behind the path layer (false). */
  sorted?: boolean;
  depth?: number;
  anim?: string;
  alpha?: number;
  /** Gentle bobbing for floating things. */
  bob?: number;
  tint?: number;
  id?: string;
}

export interface BoardIsland {
  texture: string;
  x: number;
  y: number;
  scale?: number;
  flipX?: boolean;
  bob?: number;
}

export interface BridgeDef {
  id: string;
  /** Nodes on the bridge (blocked while broken). */
  nodes: string[];
  /** Nodes of the detour (only open while the bridge is broken). */
  detour: string[];
  /** Where to draw the bridge prop. */
  prop: { x: number; y: number; scale: number; flipX?: boolean };
  /** Rounds until Wrench repairs it. */
  repairRounds: number;
}

export interface GateDef {
  id: string;
  /** The gate sits on the edge from → to. */
  from: string;
  to: string;
  prop: { x: number; y: number; scale: number };
}

export interface BoardDef {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  width: number;
  height: number;
  nodes: BoardNodeDef[];
  startNode: string;
  relicGates: string[];
  /** Default portal pairs (bidirectional). */
  portals: [string, string][];
  bridges: BridgeDef[];
  gates: GateDef[];
  islands: BoardIsland[];
  decorations: BoardDecoration[];
  /** How the connection between two nodes is drawn (default: a festival path). Key "from>to". */
  edgeStyles?: Record<string, 'path' | 'steps' | 'bridge'>;
  /** Where the host NPC stands. */
  hostSpot: { x: number; y: number };
  /** A world board's look and flavour beyond its graph (Suncoil uses the defaults). */
  theme?: BoardTheme;
}

/** How a world board looks and plays beyond its graph (see src/game/worlds). */
export interface BoardTheme {
  /** The world it belongs to (src/game/worlds/index.ts). */
  world: string;
  /** How the light runs through a match: the festival day (default), daylight only, or night. */
  time?: 'cycle' | 'day' | 'night';
  /** Its world's minigame ids: picked about half the time when one hasn't just been played. */
  minigames?: string[];
  /** Where falls meet water on its rendered art (board px; lip = top of the falls), for mist. */
  waterfalls?: { x: number; y: number; lipX: number; lipY: number }[];
  /** Setup-screen preview image path (e.g. 'assets/lite/<board>/preview.webp'). */
  preview?: string;
  /** Festival events that don't suit this board (by id), left out of its random pools. */
  skipEvents?: string[];
  /** Its Blender art exists (public/assets/rendered/<id>/ and the Lite copy); until then the board draws its vector placeholder islands. */
  rendered?: boolean;
}
