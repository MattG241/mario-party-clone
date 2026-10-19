// Exports the game's content (boards, characters, items, minigames, worlds, board cast) as JSON for the
// Wii edition's code generator (wii/tools/build_assets.py). Bundled and run with esbuild + node.
import { BOARDS } from '../../src/game/data/boards';
import { CHARACTERS, CHARACTER_IDS } from '../../src/game/data/characters';
import { ITEMS, SHOPS } from '../../src/game/data/items';
import { HERO_DATA } from '../../src/game/data/heroSprites.generated';
import { SIDE_CHARACTERS } from '../../src/game/data/npcs';
import { WORLDS } from '../../src/game/worlds';
import { WORLD_MINIGAME_INFOS, WORLD_MINIGAME_RENDERS } from '../../src/game/worlds/infos';

const out = {
  characters: CHARACTER_IDS.map((id) => {
    const c = CHARACTERS[id] as unknown as Record<string, unknown>;
    return { id, name: c.name, short: c.short, color: c.color, blurb: c.blurb, accent: c.accent };
  }),
  heroAnims: HERO_DATA.anims,
  heroPoints: HERO_DATA.points,
  boards: BOARDS.map((b) => ({
    id: b.id,
    name: b.name,
    subtitle: b.subtitle,
    description: b.description,
    width: b.width,
    height: b.height,
    startNode: b.startNode,
    relicGates: b.relicGates,
    portals: b.portals,
    gates: b.gates.map((g) => ({ from: g.from, to: g.to, x: g.prop.x, y: g.prop.y })),
    bridges: b.bridges.map((br) => ({ nodes: br.nodes, detour: br.detour, repairRounds: br.repairRounds })),
    world: b.theme?.world ?? '',
    time: b.theme?.time ?? 'day',
    minigames: b.theme?.minigames ?? [],
    nodes: b.nodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      type: n.type,
      next: n.next,
      eventId: n.eventId ?? '',
      region: n.metadata?.region ?? '',
      shop: n.metadata?.shop ?? '',
      exposed: !!n.metadata?.exposed,
      bridge: n.metadata?.bridge ?? '',
      detour: n.metadata?.detour ?? '',
      spring: !!n.metadata?.spring,
      signs: n.metadata?.signs ?? {},
    })),
  })),
  items: Object.values(ITEMS).map((i) => ({ id: i.id, name: i.name, description: i.description, price: i.price, timing: i.timing, value: (i as { value?: number }).value ?? 1, icon: i.icon })),
  shops: Object.values(SHOPS).map((s) => ({ id: s.id, name: s.name, stock: s.stock, finalRoundExtra: s.finalRoundExtra })),
  minigames: WORLD_MINIGAME_INFOS.map((m) => ({
    id: m.id,
    name: m.name,
    tagline: m.tagline,
    description: m.description,
    instructions: m.instructions,
    world: m.world,
    characters: m.characters ?? [],
    color: m.color,
    teamGame: !!m.teamGame,
  })),
  minigameRenders: WORLD_MINIGAME_RENDERS,
  worlds: WORLDS.map((w) => ({ id: w.id, name: w.name, cast: w.cast, color: w.color })),
  cast: SIDE_CHARACTERS.map((s) => ({ id: s.id, name: s.name, from: s.from, color: s.color })),
};
process.stdout.write(JSON.stringify(out, null, 1));
