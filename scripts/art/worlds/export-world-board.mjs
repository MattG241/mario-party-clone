#!/usr/bin/env node
// Export a world board's data (nodes, edges, decorations, bridges, gates) as JSON for its Blender
// art script (the world boards' counterpart of scripts/art/export-board.mjs).
//   node scripts/art/worlds/export-world-board.mjs dojo > scripts/art/worlds/dojo/board.json
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const id = process.argv[2];
if (!id) {
  console.error('usage: export-world-board.mjs <board-id>');
  process.exit(1);
}
const out = path.join(os.tmpdir(), `world-boards-${process.pid}.mjs`);
await build({ entryPoints: ['src/game/data/boards.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const mod = await import(out);
fs.unlinkSync(out);
const b = mod.findBoard(id);
if (!b) {
  console.error(`no board ${id}`);
  process.exit(1);
}
const edges = [];
for (const n of b.nodes) for (const t of n.next) edges.push({ from: n.id, to: t, style: b.edgeStyles?.[`${n.id}>${t}`] ?? 'path' });
process.stdout.write(
  JSON.stringify(
    {
      id: b.id,
      width: b.width,
      height: b.height,
      nodes: b.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, type: n.type, region: n.metadata?.region ?? '', bridge: n.metadata?.bridge, detour: n.metadata?.detour, next: n.next })),
      edges,
      relicGates: b.relicGates,
      portals: b.portals,
      decorations: b.decorations,
      bridges: b.bridges,
      gates: b.gates,
      hostSpot: b.hostSpot,
    },
    null,
    1,
  ),
);
