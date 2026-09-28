import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBoard } from '../../src/game/data/boards';

// A world board that says its Blender art exists (theme.rendered) must ship every file the game
// loads for it, Full and Lite, plus the setup-screen preview; otherwise it falls back to placeholders.
const PUBLIC = path.resolve(__dirname, '../../public');

describe.each(['dojo', 'capitol'])('board art: %s', (id) => {
  const board = findBoard(id)!;

  it('has its rendered files in place when it says so', () => {
    if (!board.theme?.rendered) return;
    for (const variant of ['rendered', 'lite']) {
      const dir = path.join(PUBLIC, 'assets', variant, id);
      const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      expect(man.board).toBe(id);
      expect(man.tiles.length).toBeGreaterThan(0);
      const files = [...man.tiles.map((t: { file: string }) => t.file), ...(man.props ?? []).map((p: { file: string }) => p.file)];
      if (man.shadow) files.push(man.shadow.file);
      for (const f of files) expect(fs.existsSync(path.join(dir, f)), `${variant}/${id}/${f}`).toBe(true);
    }
    expect(board.theme.preview).toBe(`assets/lite/previews/${id}.webp`);
    expect(fs.existsSync(path.join(PUBLIC, board.theme.preview!))).toBe(true);
  });

  it('keeps every space inside the rendered frame', () => {
    if (!board.theme?.rendered) return;
    const man = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'assets', 'rendered', id, 'manifest.json'), 'utf8'));
    const [ox, oy] = man.origin;
    const w = Math.max(...man.tiles.map((t: { x: number; w: number }) => t.x + t.w)) / man.scale;
    const h = Math.max(...man.tiles.map((t: { y: number; h: number }) => t.y + t.h)) / man.scale;
    for (const n of board.nodes) {
      expect(n.x).toBeGreaterThan(ox);
      expect(n.y).toBeGreaterThan(oy);
      expect(n.x).toBeLessThan(ox + w);
      expect(n.y).toBeLessThan(oy + h);
    }
  });
});
