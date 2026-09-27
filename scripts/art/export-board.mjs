#!/usr/bin/env node
// Export board data (nodes, edges, decorations) as JSON for the Blender art scripts.
//   node scripts/art/export-board.mjs > scripts/art/data/suncoil.json
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = path.join(os.tmpdir(), `boards-${process.pid}.mjs`);
await build({ entryPoints: ['src/game/data/boards.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const mod = await import(out);
fs.unlinkSync(out);
const b = mod.SUNCOIL;
const edges = [];
for (const n of b.nodes) for (const t of n.next) edges.push({ from: n.id, to: t, style: b.edgeStyles?.[`${n.id}>${t}`] ?? 'path' });
process.stdout.write(
  JSON.stringify(
    {
      id: b.id,
      width: b.width,
      height: b.height,
      nodes: b.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, type: n.type, region: n.metadata?.region ?? '', bridge: n.metadata?.bridge, detour: n.metadata?.detour })),
      edges,
      decorations: b.decorations,
      bridges: b.bridges,
      gates: b.gates,
      hostSpot: b.hostSpot,
    },
    null,
    1,
  ),
);
